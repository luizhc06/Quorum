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

// Preço de escrita/leitura de cache é um multiplicador sobre o preço de
// input do próprio modelo (não um valor fixo) — confirmado no skill
// claude-api: ~1.25x pra escrita (TTL de 5min, o único usado aqui) e ~0.1x
// pra leitura. Antes desta correção, record() ignorava completamente
// cache_creation_input_tokens/cache_read_input_tokens — subestimava o
// custo real (escrita custa mais que input normal) e não mostrava a
// economia real de ativar prompt caching no laço de ferramentas.
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

class CostTracker {
  constructor(model, maxCostUsd) {
    this.model = model;
    this.maxCostUsd = maxCostUsd;
    this.totalUsd = 0;
    this.turns = 0;
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cacheWriteTokens = 0;
    this.cacheReadTokens = 0;
  }

  record(usage) {
    this.turns++;
    if (!usage) return;
    const price = PRICE_PER_MTOK[this.model] || PRICE_PER_MTOK['claude-sonnet-5'];
    const inputTok = usage.input_tokens || 0;
    const outputTok = usage.output_tokens || 0;
    const cacheWriteTok = usage.cache_creation_input_tokens || 0;
    const cacheReadTok = usage.cache_read_input_tokens || 0;
    this.inputTokens += inputTok;
    this.outputTokens += outputTok;
    this.cacheWriteTokens += cacheWriteTok;
    this.cacheReadTokens += cacheReadTok;
    this.totalUsd +=
      (inputTok / 1_000_000) * price.input +
      (outputTok / 1_000_000) * price.output +
      (cacheWriteTok / 1_000_000) * price.input * CACHE_WRITE_MULTIPLIER +
      (cacheReadTok / 1_000_000) * price.input * CACHE_READ_MULTIPLIER;
  }

  exceeded() {
    return this.totalUsd > this.maxCostUsd;
  }

  summary() {
    const price = PRICE_PER_MTOK[this.model] || PRICE_PER_MTOK['claude-sonnet-5'];
    // quanto os tokens lidos do cache teriam custado a preço cheio de
    // input, menos o que realmente custaram (0.1x) — a economia real
    const cacheSavedUsd = (this.cacheReadTokens / 1_000_000) * price.input * (1 - CACHE_READ_MULTIPLIER);
    return {
      turns: this.turns,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheSavedUsd: Number(cacheSavedUsd.toFixed(4)),
      estimatedUsd: Number(this.totalUsd.toFixed(4)),
    };
  }
}

module.exports = { CostTracker, PRICE_PER_MTOK };
