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

function extractText(content) {
  return (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

/**
 * Laço genérico de ferramentas contra a Messages API (tool_use/tool_result).
 * Equivalente Claude do openai-side/src/agent-loop.js — mesma forma de
 * retorno ({finalText, status, iterations, usage, transcript}) pra dar pra
 * reaproveitar orchestrator/log em ambos os lados sem casos especiais.
 *
 * stop_reason "refusal" chega como resposta HTTP 200 normal (não exceção) —
 * ver claude-side/agents/judge.md e leader-synthesizer.md sobre por que isso
 * importa pros papéis que fazem síntese de achado de segurança.
 *
 * Prompt caching (ver shared/prompt-caching.md do skill claude-api): o
 * system prompt (persona+contrato) é idêntico em toda chamada deste laço —
 * marcado com cache_control uma vez, fica "grátis" (~0.1x) do 2º turno em
 * diante. Além disso, um marcador anda junto com o último bloco do
 * histórico a cada turno — cacheia "tudo até aqui" (system+tools+turnos
 * anteriores), a maior economia real do laço, já que sem
 * previous_response_id cada turno reenviava o histórico inteiro descoberto
 * (comentário original do arquivo, agora corrigido). O marcador antigo é
 * removido antes de mover pro novo — nunca mais de 2 breakpoints por
 * requisição (system + 1 no histórico), bem abaixo do limite de 4.
 */
async function runAgentLoop({ client, model, systemPrompt, userPrompt, tools, toolHandlers, limits, onEvent, onTranscriptLine, signal }) {
  let messages = [{ role: 'user', content: userPrompt }];
  const startedAt = Date.now();
  const costTracker = new CostTracker(model, limits.maxCostUsd);
  const transcript = [];
  onTranscriptLine?.({ role: 'user', content: userPrompt, at: Date.now() });

  const system = [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }];
  let lastCachedBlock = null;
  function markCachePoint() {
    if (lastCachedBlock) delete lastCachedBlock.cache_control;
    const lastMsg = messages[messages.length - 1];
    if (typeof lastMsg.content === 'string') lastMsg.content = [{ type: 'text', text: lastMsg.content }];
    const lastBlock = lastMsg.content[lastMsg.content.length - 1];
    lastBlock.cache_control = { type: 'ephemeral' };
    lastCachedBlock = lastBlock;
  }

  for (let iter = 0; iter < limits.maxIterations; iter++) {
    if (signal?.aborted) throw new AgentAbortedError('aborted', { iter });
    if (Date.now() - startedAt > limits.maxWallClockMs) {
      throw new AgentAbortedError('wall_clock_exceeded', { iter, elapsedMs: Date.now() - startedAt });
    }

    markCachePoint();

    let resp;
    try {
      resp = await client.messages.create({
        model,
        max_tokens: limits.maxOutputTokensPerTurn,
        system,
        messages,
        tools,
        tool_choice: { type: 'auto' },
      }, { signal });
    } catch (err) {
      if (err.name === 'AbortError' || signal?.aborted) throw new AgentAbortedError('aborted', { iter });
      throw new AgentAbortedError('api_error', { message: err.message, status: err.status });
    }

    costTracker.record(resp.usage);
    if (costTracker.exceeded()) {
      throw new AgentAbortedError('cost_ceiling_exceeded', costTracker.summary());
    }

    onTranscriptLine?.({ role: 'assistant', content: resp.content, stopReason: resp.stop_reason, at: Date.now() });

    if (resp.stop_reason === 'refusal') {
      onEvent?.({ type: 'refusal' });
      return {
        finalText: extractText(resp.content) || '(recusado sem texto explicativo)',
        status: 'refused', iterations: iter + 1, usage: costTracker.summary(), transcript,
      };
    }

    if (resp.stop_reason === 'max_tokens' || resp.stop_reason === 'model_context_window_exceeded') {
      onEvent?.({ type: 'truncated', reason: resp.stop_reason });
      return {
        finalText: extractText(resp.content), status: 'ok', truncated: true,
        iterations: iter + 1, usage: costTracker.summary(), transcript,
      };
    }

    messages.push({ role: 'assistant', content: resp.content });

    if (resp.stop_reason !== 'tool_use') {
      return { finalText: extractText(resp.content), status: 'ok', iterations: iter + 1, usage: costTracker.summary(), transcript };
    }

    const toolUseBlocks = resp.content.filter((b) => b.type === 'tool_use');
    const toolResults = [];
    for (const block of toolUseBlocks) {
      let output;
      try {
        output = await toolHandlers[block.name](block.input || {});
      } catch (err) {
        output = `ERROR: ${err.message}`;
      }
      const truncated = truncate(output, limits.maxToolOutputChars);
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: truncated });
      transcript.push({ tool: block.name, argsPreview: JSON.stringify(block.input || {}).slice(0, 200), resultChars: truncated.length });
      onEvent?.({ type: 'tool_call', tool: block.name });
    }
    messages.push({ role: 'user', content: toolResults });
    onTranscriptLine?.({ role: 'user', content: toolResults, at: Date.now() });
  }

  throw new AgentAbortedError('max_iterations_exceeded', { maxIterations: limits.maxIterations, transcript });
}

module.exports = { runAgentLoop, AgentAbortedError, truncate };
