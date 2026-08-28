'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { normalizeOllamaHost, runCommunityStage } = require('../openai-side/src/providers/community');

const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'config', 'community-agents.json'), 'utf8'));

test('normaliza hosts do Ollama sem duplicar protocolo', () => {
  assert.equal(normalizeOllamaHost('127.0.0.1:11434/'), 'http://127.0.0.1:11434');
  assert.equal(normalizeOllamaHost('https://ollama.internal/'), 'https://ollama.internal');
});

test('configuração comunitária usa ids únicos e transportes conhecidos', () => {
  const ids = config.agents.map((agent) => agent.key);
  assert.equal(new Set(ids).size, ids.length);
  for (const agent of config.agents) {
    assert.match(agent.key, /^[a-z0-9-]+$/);
    assert.ok(['ollama', 'antigravity-cli', 'openrouter', 'omniroute'].includes(agent.provider));
    assert.ok(['exploration', 'post-judge'].includes(agent.stage));
    assert.ok(agent.model);
    assert.ok(agent.free);
  }
});

test('uma exceção de provedor fica isolada e vira resultado failed', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorum-community-'));
  try {
    const result = await runCommunityStage({
      specs: [{
        key: 'broken-provider', name: 'Broken', provider: 'ollama', model: 'fake',
        skills: ['skill-that-does-not-exist'], free: 'teste',
      }],
      scope: path.resolve(__dirname, '..'), task: 'teste', outDir, contextPath: undefined,
      limits: { run_command: {}, community_specialist: { maxIterations: 1, maxWallClockMs: 1, maxOutputTokensPerTurn: 1, maxToolOutputChars: 1 } },
    });
    assert.equal(result.specialists[0].status, 'failed');
    assert.equal(result.specialists[0].reason, 'provider_exception');
    assert.ok(fs.existsSync(path.join(outDir, 'broken-provider', 'broken-provider.json')));
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
