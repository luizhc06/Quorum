'use strict';
// Laço genérico de ferramentas sobre qualquer endpoint Chat Completions
// compatível com a API da OpenAI (baseURL + apiKey arbitrários), COM
// streaming real (token a token). É o motor usado por Ollama/NVIDIA/
// OpenRouter/OmniRoute — os provedores gratuitos onde o streaming ao vivo
// pedido pelo usuário é tecnicamente viável sem custo de API (ver painel
// "Ao vivo" no dashboard e config/allocation.js). Motores CLI
// (claude-code-local/codex-local) e o motor Antigravity não passam por
// aqui — só devolvem resultado completo no final, sem streaming possível
// sem trocar de transporte (ver comentário em orchestrate.js).
const OpenAI = require('openai');

function toChatTools(schemas) {
  return schemas.map((schema) => ({
    type: 'function',
    function: { name: schema.name, description: schema.description, parameters: schema.parameters },
  }));
}

function truncate(value, maxChars) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...(saída truncada)` : text;
}

/**
 * `preflight`, se passado, roda ANTES de abrir o client — deve devolver
 * `{status:'ok'}` pra seguir, ou um resultado terminal (`{status:'skipped'|'failed', reason, error}`)
 * pra interromper sem gastar uma chamada de API. `extraBody` é repassado
 * cru dentro do corpo da requisição (ex.: NVIDIA usa `chat_template_kwargs`
 * pra desligar a cadeia de pensamento do Nemotron — ver nvidia-solenne.js).
 * `onEvent` recebe `text-delta`/`tool-call-start`/`tool-call-result`.
 * `signal` (AbortSignal) cancela tanto a chamada de rede em andamento
 * quanto o laço entre turnos.
 */
async function runOpenAICompatToolLoop({
  baseURL, apiKey, model, systemPrompt, userPrompt, schemas, handlers, limits, onEvent, signal,
  maxRetries = 1, timeoutMs = 60_000, preflight, extraBody,
}) {
  if (preflight) {
    const check = await preflight();
    if (check && check.status !== 'ok') return check;
  }

  const client = new OpenAI({ apiKey: apiKey || 'not-needed', baseURL, maxRetries, timeout: timeoutMs });
  const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }];
  const tools = toChatTools(schemas);
  const startedAt = Date.now();
  let toolCallCount = 0;

  for (let iteration = 0; iteration < limits.maxIterations; iteration++) {
    if (signal?.aborted) return { status: 'failed', reason: 'aborted', error: 'cancelado pelo usuário', toolCallCount };
    if (Date.now() - startedAt > limits.maxWallClockMs) {
      return { status: 'failed', reason: 'wall_clock_exceeded', error: 'tempo máximo excedido', toolCallCount };
    }

    let contentBuf = '';
    // Chunks de tool call chegam fragmentados por índice — cada delta só
    // tem um pedaço de `arguments`, tem que acumular até o fim do turno
    // pra ter um JSON válido pra dar parse.
    const toolCallAcc = {};
    try {
      const stream = await client.chat.completions.create({
        model, messages, tools, tool_choice: 'auto', temperature: 0.2,
        max_tokens: limits.maxOutputTokensPerTurn, stream: true,
        ...extraBody,
      }, { signal });
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          contentBuf += delta.content;
          onEvent?.({ type: 'text-delta', text: delta.content });
        }
        for (const tc of delta?.tool_calls || []) {
          const acc = (toolCallAcc[tc.index] ??= { id: tc.id, name: tc.function?.name, argsBuf: '' });
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.argsBuf += tc.function.arguments;
        }
      }
    } catch (error) {
      if (error.name === 'AbortError' || signal?.aborted) return { status: 'failed', reason: 'aborted', error: 'cancelado pelo usuário', toolCallCount };
      return { status: 'failed', reason: 'openai_compat_error', error: error.message, toolCallCount };
    }

    const toolCalls = Object.values(toolCallAcc);
    if (!toolCalls.length) {
      return { status: contentBuf.trim() ? 'ok' : 'failed', finalText: contentBuf, toolCallCount };
    }

    messages.push({
      role: 'assistant', content: contentBuf || null,
      tool_calls: toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.argsBuf } })),
    });

    for (const tc of toolCalls) {
      toolCallCount++;
      onEvent?.({ type: 'tool-call-start', tool: tc.name, argsPreview: tc.argsBuf.slice(0, 200) });
      let output;
      try {
        const args = tc.argsBuf ? JSON.parse(tc.argsBuf) : {};
        const handler = handlers[tc.name];
        output = handler ? await handler(args) : `ERROR: ferramenta desconhecida ${tc.name}`;
      } catch (error) {
        output = `ERROR: ${error.message}`;
      }
      const truncated = truncate(output, limits.maxToolOutputChars);
      onEvent?.({ type: 'tool-call-result', tool: tc.name, resultChars: truncated.length });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: truncated });
    }
  }
  return { status: 'failed', reason: 'max_iterations_exceeded', error: 'número máximo de iterações excedido', toolCallCount };
}

module.exports = { runOpenAICompatToolLoop, toChatTools, truncate };
