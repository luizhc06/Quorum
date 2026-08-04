'use strict';

// Preço por MTok (USD). Fonte: platform.claude.com/docs/en/about-claude/models/overview,
// confirmado ao vivo na montagem deste motor (04/08/2026).
// Sonnet 5 tem preço promocional $2/$10 até 31/08/2026 — depois disso volta a $3/$15,
// então este valor fica desatualizado a partir dessa data se não for revisado.
const PRICE_PER_MTOK = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
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
    const price = PRICE_PER_MTOK[this.model] || PRICE_PER_MTOK['claude-sonnet-5'];
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
