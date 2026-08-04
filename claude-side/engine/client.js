'use strict';
const Anthropic = require('@anthropic-ai/sdk');

function createClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY não definida no ambiente. Gere uma em console.anthropic.com/settings/keys ' +
      '(é uma chave de API cobrada à parte, diferente da assinatura do Claude Code) e defina antes de rodar.'
    );
  }
  return new Anthropic({ apiKey, maxRetries: 3 });
}

module.exports = { createClient };
