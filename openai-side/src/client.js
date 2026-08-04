'use strict';
const OpenAI = require('openai');

/**
 * Wrapper fino sobre o SDK oficial. O SDK já faz retry com backoff embutido
 * pra erros retryable (429/5xx, ver maxRetries) — não reimplementamos isso
 * na mão. Erros de schema/validação (4xx que não são 429) não são retryable
 * por definição do próprio SDK, então já saem sem retry.
 */
function createClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY não encontrada no ambiente. Configure como variável de ambiente do sistema (nunca em arquivo commitado).'
    );
  }
  return new OpenAI({ apiKey, maxRetries: 3 });
}

module.exports = { createClient };
