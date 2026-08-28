'use strict';
// OpenRouter (openrouter.ai) — agregador cloud com dezenas de modelos,
// vários com sufixo ":free" (camada gratuita, sujeita a rate limit).
// Endpoint compatível com Chat Completions da OpenAI — mesmo formato já
// comprovado por nvidia-solenne.js, aqui sobre o laço genérico em
// ./openai-compat.js. Precisa de OPENROUTER_API_KEY (ver .env.example);
// sem a chave, o especialista volta 'failed'/'openrouter_key_missing' e a
// rodada segue sem ele, mesmo padrão do Grupo NVIDIA quando falta chave.
const { runOpenAICompatToolLoop } = require('./openai-compat');

const BASE_URL = 'https://openrouter.ai/api/v1';

async function listOpenRouterModels() {
  const response = await fetch(`${BASE_URL}/models`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`OpenRouter respondeu HTTP ${response.status}`);
  const data = await response.json();
  return (data.data || [])
    .map((entry) => ({ id: entry.id, name: entry.name || entry.id, free: /:free$/.test(entry.id || '') }))
    .filter((entry) => entry.id);
}

async function runOpenRouter({ model, systemPrompt, userPrompt, schemas, handlers, limits, onEvent, signal }) {
  return runOpenAICompatToolLoop({
    baseURL: BASE_URL, apiKey: process.env.OPENROUTER_API_KEY, model, systemPrompt, userPrompt, schemas, handlers, limits, onEvent, signal,
    maxRetries: 2, timeoutMs: 60_000,
    preflight: async () => {
      if (!process.env.OPENROUTER_API_KEY) {
        return { status: 'failed', reason: 'openrouter_key_missing', error: 'OPENROUTER_API_KEY não configurada — defina no ambiente ou em .env para habilitar o OpenRouter.' };
      }
      return { status: 'ok' };
    },
  });
}

module.exports = { BASE_URL, listOpenRouterModels, runOpenRouter };
