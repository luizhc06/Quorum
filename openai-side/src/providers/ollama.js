'use strict';
// Refactor comportamento-preservado: era runOllamaToolLoop dentro de
// community.js, agora só a casca específica do Ollama (host, checagem de
// modelo instalado) sobre o laço genérico em ./openai-compat.js.
const { runOpenAICompatToolLoop } = require('./openai-compat');

function normalizeOllamaHost(value) {
  const raw = (value || 'http://127.0.0.1:11434').trim().replace(/\/$/, '');
  return /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
}

async function listOllamaModels(host) {
  const response = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`Ollama respondeu HTTP ${response.status}`);
  const data = await response.json();
  return (data.models || []).map((entry) => entry.name || entry.model).filter(Boolean);
}

async function runOllama({ model, systemPrompt, userPrompt, schemas, handlers, limits, onEvent, signal }) {
  const host = normalizeOllamaHost(process.env.OLLAMA_HOST);
  return runOpenAICompatToolLoop({
    baseURL: `${host}/v1`, apiKey: 'ollama-local', model, systemPrompt, userPrompt, schemas, handlers, limits, onEvent, signal,
    maxRetries: 1, timeoutMs: 60_000,
    preflight: async () => {
      let installed;
      try {
        installed = await listOllamaModels(host);
      } catch (error) {
        return { status: 'skipped', reason: 'ollama_unavailable', error: `Ollama não está acessível em ${host}: ${error.message}` };
      }
      if (!installed.includes(model)) {
        return { status: 'skipped', reason: 'model_not_installed', error: `Modelo ${model} não encontrado. Execute: ollama pull ${model}` };
      }
      return { status: 'ok' };
    },
  });
}

module.exports = { normalizeOllamaHost, listOllamaModels, runOllama };
