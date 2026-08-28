'use strict';
const { writeAgentResult } = require('../log');
const { runOpenAICompatToolLoop } = require('./openai-compat');

// Grupo NVIDIA/Hermes: fornecedor de modelo independente (NVIDIA, não
// Anthropic nem OpenAI) — reduz o risco de viés compartilhado entre
// fornecedores. Roda sobre a Solenne, IA pessoal do Rizu (bot de Discord
// "hermes-bot"), via a API da NVIDIA NIM (plano free, 40 RPM — sem custo por
// token, só limite de taxa). Endpoint Chat Completions, igual a Ollama/
// OpenRouter/OmniRoute — unificado no laço genérico compartilhado
// (openai-compat.js) em vez de manter um laço próprio (nvidia-agent-loop.js,
// removido): a única diferença real era `chat_template_kwargs` (desligar a
// cadeia de pensamento do Nemotron), que agora vira `extraBody` — não valia
// a pena escrever/testar o acumulador de streaming duas vezes por causa só
// disso.
const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
const BASE_URL = 'https://integrate.api.nvidia.com/v1';

const CONTEXT_NOTE =
  '\n\nVocê também tem acesso a um contexto extra (context_read_file/context_grep/context_list_files) — NÃO é o código do projeto, é material de referência (ex.: notas de PRs anteriores, bugs já corrigidos). Vale a pena checar antes de sugerir algo que talvez já tenha sido tentado ou decidido — mas não confunda com o escopo de código real.';

function buildSystemPrompt(persona, outputContract, hasContext) {
  return `${persona}\n\nExplore o código real dentro do escopo usando as ferramentas disponíveis antes de concluir qualquer coisa — nunca opine sem checar. Ao final, siga este contrato de saída:\n\n${outputContract}${hasContext ? CONTEXT_NOTE : ''}`;
}

async function runNvidiaAgent({ name, model, persona, task, schemas, handlers, limits, outDir, outputContract, hasContext, onStateChange, onEvent, signal }) {
  const startedAt = Date.now();
  const resolvedModel = model || DEFAULT_MODEL;
  onStateChange?.({ state: 'running' });

  const loopResult = await runOpenAICompatToolLoop({
    baseURL: BASE_URL, apiKey: process.env.NVIDIA_API_KEY, model: resolvedModel,
    systemPrompt: buildSystemPrompt(persona, outputContract, hasContext), userPrompt: task,
    schemas, handlers, limits, onEvent, signal, maxRetries: 3, timeoutMs: 45_000,
    // nemotron-3-super é modelo de raciocínio — sem isso ele gasta o
    // max_tokens inteiro na cadeia de pensamento (mesmo ajuste do
    // hermes-bot original, ai_client.py).
    extraBody: { chat_template_kwargs: { enable_thinking: false } },
    preflight: async () => {
      if (!process.env.NVIDIA_API_KEY) {
        return {
          status: 'failed', reason: 'nvidia_key_missing',
          error: 'NVIDIA_API_KEY não configurada — Grupo NVIDIA/Hermes fica de fora desta rodada.',
        };
      }
      return { status: 'ok' };
    },
  });

  const result = {
    agent: name, model: resolvedModel, status: loopResult.status, provider: 'nvidia-solenne',
    finalText: loopResult.finalText || '', reason: loopResult.reason, error: loopResult.error,
    usage: { source: 'plano free NVIDIA NIM (sem custo, 40 RPM)', toolCallCount: loopResult.toolCallCount },
    elapsedMs: Date.now() - startedAt,
  };
  writeAgentResult(outDir, name, result);
  onStateChange?.({
    state: result.status === 'ok' ? 'done' : result.status,
    findings: (result.finalText.match(/^### /gm) || []).length,
    usage: result.usage, elapsedMs: result.elapsedMs,
  });
  return result;
}

module.exports = { runNvidiaAgent, DEFAULT_MODEL, BASE_URL };
