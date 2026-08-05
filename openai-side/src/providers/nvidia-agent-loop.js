'use strict';

// Laço de ferramentas via Chat Completions — formato diferente do
// agent-loop.js do resto do lado OpenAI (que usa a Responses API), porque é
// o único formato que o endpoint da NVIDIA NIM aceita (confirmado lendo
// hermes-bot/ai_client.py ao vivo). As ferramentas em si (read_file/grep/
// list_files) são as mesmas de openai-side/src/tools — só o schema muda de
// forma (Responses API é plano: {type,name,description,parameters};
// Chat Completions aninha em {type:'function', function:{...}}).
class AgentAbortedError extends Error {
  constructor(reason, detail) {
    super(`agente abortado: ${reason}`);
    this.reason = reason;
    this.detail = detail;
  }
}

function toChatTools(responsesSchemas) {
  return responsesSchemas.map((s) => ({
    type: 'function',
    function: { name: s.name, description: s.description, parameters: s.parameters },
  }));
}

function truncate(text, maxChars) {
  const s = typeof text === 'string' ? text : JSON.stringify(text);
  return s.length > maxChars ? s.slice(0, maxChars) + '\n...(saída truncada)' : s;
}

async function runNvidiaAgentLoop({ client, model, systemPrompt, userPrompt, tools, toolHandlers, limits }) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  const chatTools = toChatTools(tools);
  const startedAt = Date.now();
  let toolCallCount = 0;

  for (let iter = 0; iter < limits.maxIterations; iter++) {
    if (Date.now() - startedAt > limits.maxWallClockMs) {
      throw new AgentAbortedError('wall_clock_exceeded', { iter, elapsedMs: Date.now() - startedAt });
    }

    let completion;
    try {
      completion = await client.chat.completions.create({
        model,
        messages,
        tools: chatTools,
        tool_choice: 'auto',
        max_tokens: limits.maxOutputTokensPerTurn,
        temperature: 0.3,
        // nemotron-3-super é modelo de raciocínio — sem isso ele gasta o
        // max_tokens inteiro na cadeia de pensamento (mesmo ajuste do
        // hermes-bot original, ai_client.py).
        chat_template_kwargs: { enable_thinking: false },
      });
    } catch (err) {
      throw new AgentAbortedError('api_error', { message: err.message, status: err.status });
    }

    const message = completion.choices?.[0]?.message;
    if (!message) throw new AgentAbortedError('resposta_vazia', { completion });
    messages.push(message);

    const toolCalls = message.tool_calls || [];
    if (toolCalls.length === 0) {
      return { finalText: message.content || '', status: 'ok', toolCallCount, usage: completion.usage };
    }

    for (const call of toolCalls) {
      toolCallCount++;
      let output;
      try {
        const args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
        const handler = toolHandlers[call.function?.name];
        output = handler ? await handler(args) : `ERROR: ferramenta desconhecida "${call.function?.name}"`;
      } catch (err) {
        output = `ERROR: ${err.message}`;
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: truncate(output, limits.maxToolOutputChars) });
    }
  }

  throw new AgentAbortedError('max_iterations_exceeded', { maxIterations: limits.maxIterations, toolCallCount });
}

module.exports = { runNvidiaAgentLoop, AgentAbortedError };
