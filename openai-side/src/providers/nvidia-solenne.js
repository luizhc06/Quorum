'use strict';
const OpenAI = require('openai');

// Terceira voz do conselho, de um fornecedor de modelo independente dos outros
// dois (Anthropic e OpenAI): a Solenne, IA pessoal do Rizu (bot de Discord
// "hermes-bot"), rodando sobre a API da NVIDIA NIM (plano free, 40 RPM — sem
// custo por token, só limite de taxa). Endpoint compatível com OpenAI mas via
// Chat Completions, não a Responses API que o resto do lado OpenAI usa —
// confirmado lendo openai-side/../hermes-bot/ai_client.py ao vivo (05/08/2026).
//
// Diferente dos especialistas Claude/OpenAI, ela não tem ferramentas de
// leitura de repositório nesta v1 — recebe só os relatórios finais dos dois
// juízes como contexto e dá um parecer independente. Sem tool loop, uma
// chamada só.
const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
const BASE_URL = 'https://integrate.api.nvidia.com/v1';

function createSolenneClient() {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL: BASE_URL, maxRetries: 3 });
}

async function runSolenneAgent({ persona, task, model, maxOutputTokens }) {
  const startedAt = Date.now();
  const resolvedModel = model || DEFAULT_MODEL;
  const client = createSolenneClient();
  if (!client) {
    return {
      agent: 'solenne', model: resolvedModel, status: 'failed', provider: 'nvidia-solenne',
      reason: 'nvidia_key_missing',
      error: 'NVIDIA_API_KEY não configurada — Solenne fica de fora desta rodada.',
      elapsedMs: 0,
    };
  }
  try {
    const completion = await client.chat.completions.create({
      model: resolvedModel,
      messages: [
        { role: 'system', content: persona },
        { role: 'user', content: task },
      ],
      temperature: 0.4,
      max_tokens: maxOutputTokens || 3000,
      // nemotron-3-super é um modelo de raciocínio: sem isso, ele gasta o
      // max_tokens inteiro numa cadeia de pensamento antes da resposta final
      // e o parecer sai cortado no meio (mesmo ajuste do bot original).
      chat_template_kwargs: { enable_thinking: false },
    });
    const finalText = completion.choices?.[0]?.message?.content || '';
    return {
      agent: 'solenne', model: resolvedModel, status: finalText.trim() ? 'ok' : 'failed',
      provider: 'nvidia-solenne', finalText,
      usage: completion.usage
        ? { source: 'plano free NVIDIA NIM (sem custo, 40 RPM)', promptTokens: completion.usage.prompt_tokens, completionTokens: completion.usage.completion_tokens }
        : { source: 'plano free NVIDIA NIM (sem custo, 40 RPM)' },
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      agent: 'solenne', model: resolvedModel, status: 'failed', provider: 'nvidia-solenne',
      reason: 'nvidia_api_error', error: err.message, elapsedMs: Date.now() - startedAt,
    };
  }
}

module.exports = { runSolenneAgent };
