'use strict';

// Preço por MTok (USD) — mantido aqui pra ficar fácil de atualizar sem
// tocar no motor do laço. Fonte: pesquisa feita na montagem do Quorum
// (04/08/2026) — confirmar antes de confiar cegamente se muito tempo passar.
const PRICE_PER_MTOK = {
  'gpt-5.6-terra': { input: 2, output: 12 },
  'gpt-5.6-sol': { input: 5, output: 30 },
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
};

class CostTracker {
  constructor(model, maxCostUsd) {
    this.model = model;
    this.maxCostUsd = maxCostUsd;
    this.totalUsd = 0;
    this.turns = 0;
    this.inputTokens = 0;
    this.outputTokens = 0;
  }

  record(usage) {
    this.turns++;
    if (!usage) return;
    const price = PRICE_PER_MTOK[this.model] || PRICE_PER_MTOK['gpt-5.6-terra'];
    const inputTok = usage.input_tokens || 0;
    const outputTok = usage.output_tokens || 0;
    this.inputTokens += inputTok;
    this.outputTokens += outputTok;
    this.totalUsd += (inputTok / 1_000_000) * price.input + (outputTok / 1_000_000) * price.output;
  }

  exceeded() {
    return this.totalUsd > this.maxCostUsd;
  }

  summary() {
    return {
      turns: this.turns,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      estimatedUsd: Number(this.totalUsd.toFixed(4)),
    };
  }
}

module.exports = { CostTracker, PRICE_PER_MTOK };
