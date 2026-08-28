'use strict';
const { CostTracker } = require('./cost-tracker');

class AgentAbortedError extends Error {
  constructor(reason, detail) {
    super(`agente abortado: ${reason}`);
    this.reason = reason;
    this.detail = detail;
  }
}

function truncate(text, maxChars) {
  const s = String(text == null ? '' : text);
  return s.length > maxChars ? s.slice(0, maxChars) + '\n...(saída truncada)' : s;
}

/**
 * Laço genérico de ferramentas contra a Responses API. Sem
 * previous_response_id confirmado — cada turno reenvia o `input` inteiro
 * (por isso truncamos toda saída de ferramenta: é o que mais infla esse
 * histórico reenviado). Três tetos independentes: iterações, relógio e
 * custo em USD — nenhum sozinho basta (ver plano de segurança).
 */
async function runAgentLoop({ client, model, systemPrompt, userPrompt, tools, toolHandlers, limits, onEvent, signal }) {
  let input = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  const startedAt = Date.now();
  const costTracker = new CostTracker(model, limits.maxCostUsd);
  const transcript = [];

  for (let iter = 0; iter < limits.maxIterations; iter++) {
    if (signal?.aborted) throw new AgentAbortedError('aborted', { iter });
    if (Date.now() - startedAt > limits.maxWallClockMs) {
      throw new AgentAbortedError('wall_clock_exceeded', { iter, elapsedMs: Date.now() - startedAt });
    }

    let resp;
    try {
      resp = await client.responses.create({
        model,
        input,
        tools,
        tool_choice: 'auto',
        max_output_tokens: limits.maxOutputTokensPerTurn,
      }, { signal });
    } catch (err) {
      // Recusa de modelo (ex.: análise de segurança recusada) chega como
      // conteúdo normal (200), não como exceção — ver checagem de `refusal`
      // logo abaixo. Erros pegos AQUI são falha de rede/API de verdade, já
      // passaram pelo retry do SDK.
      if (err.name === 'AbortError' || signal?.aborted) throw new AgentAbortedError('aborted', { iter });
      throw new AgentAbortedError('api_error', { message: err.message, status: err.status });
    }

    costTracker.record(resp.usage);
    if (costTracker.exceeded()) {
      throw new AgentAbortedError('cost_ceiling_exceeded', costTracker.summary());
    }

    if (resp.status === 'incomplete' || (resp.incomplete_details && resp.incomplete_details.reason)) {
      onEvent?.({ type: 'incomplete', reason: resp.incomplete_details?.reason });
    }

    const refusal = resp.output
      .filter((o) => o.type === 'message')
      .flatMap((o) => o.content || [])
      .find((c) => c.type === 'refusal');
    if (refusal) {
      onEvent?.({ type: 'refusal', reason: refusal.refusal });
      return {
        finalText: refusal.refusal || '',
        status: 'refused',
        iterations: iter + 1,
        usage: costTracker.summary(),
        transcript,
      };
    }

    input.push(...resp.output);

    const calls = resp.output.filter((o) => o.type === 'function_call');
    if (calls.length === 0) {
      return {
        finalText: resp.output_text || '',
        status: 'ok',
        iterations: iter + 1,
        usage: costTracker.summary(),
        transcript,
      };
    }

    for (const call of calls) {
      let output;
      try {
        const args = call.arguments ? JSON.parse(call.arguments) : {};
        output = await toolHandlers[call.name](args);
      } catch (err) {
        output = `ERROR: ${err.message}`;
      }
      const truncated = truncate(output, limits.maxToolOutputChars);
      input.push({ type: 'function_call_output', call_id: call.call_id, output: truncated });
      transcript.push({ tool: call.name, argsPreview: (call.arguments || '').slice(0, 200), resultChars: truncated.length });
      onEvent?.({ type: 'tool_call', tool: call.name });
    }
  }

  throw new AgentAbortedError('max_iterations_exceeded', { maxIterations: limits.maxIterations, transcript });
}

module.exports = { runAgentLoop, AgentAbortedError, truncate };
