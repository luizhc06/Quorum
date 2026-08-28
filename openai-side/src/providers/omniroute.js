'use strict';
// OmniRoute (omniroute.online, pacote npm "omniroute") — gateway LOCAL
// self-hosted (roda em http://localhost:20128 por padrão, `npm install -g
// omniroute && omniroute`), agrega 90+ provedores com camada gratuita.
// Compatível com Chat Completions, funciona zero-config (sem chave pros
// upstreams "keyless"). Arquitetura mais parecida com Ollama (local, sem
// custo, só precisa estar rodando) do que com OpenRouter (cloud, com
// chave) — por isso a checagem de disponibilidade aqui é um GET /models
// alcançável, igual ao padrão já usado em ./ollama.js, não presença de env
// var.
const { runOpenAICompatToolLoop } = require('./openai-compat');

const DEFAULT_BASE_URL = 'http://localhost:20128/v1';

function normalizeBaseUrl(value) {
  return (value || DEFAULT_BASE_URL).trim().replace(/\/$/, '');
}

async function listOmniRouteModels(baseUrl) {
  const url = normalizeBaseUrl(baseUrl);
  const response = await fetch(`${url}/models`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`OmniRoute respondeu HTTP ${response.status}`);
  const data = await response.json();
  return (data.data || []).map((entry) => entry.id).filter(Boolean);
}

async function runOmniRoute({ model, systemPrompt, userPrompt, schemas, handlers, limits, onEvent, signal, baseUrl }) {
  const url = normalizeBaseUrl(baseUrl || process.env.OMNIROUTE_BASE_URL);
  return runOpenAICompatToolLoop({
    baseURL: url, apiKey: process.env.OMNIROUTE_API_KEY || 'omniroute-local', model, systemPrompt, userPrompt, schemas, handlers, limits, onEvent, signal,
    maxRetries: 1, timeoutMs: 60_000,
    preflight: async () => {
      try {
        await listOmniRouteModels(url);
        return { status: 'ok' };
      } catch (error) {
        return { status: 'skipped', reason: 'omniroute_unavailable', error: `OmniRoute não está acessível em ${url}: ${error.message}` };
      }
    },
  });
}

module.exports = { DEFAULT_BASE_URL, normalizeBaseUrl, listOmniRouteModels, runOmniRoute };
