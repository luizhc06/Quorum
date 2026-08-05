'use strict';
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { buildToolset } = require('../tools');
const { writeAgentResult } = require('../log');
const { runNvidiaAgentLoop, AgentAbortedError } = require('./nvidia-agent-loop');

// Grupo NVIDIA/Hermes: 3º grupo de especialistas do conselho, de um
// fornecedor de modelo independente dos outros dois (Anthropic e OpenAI) —
// reduz o risco de viés compartilhado entre fornecedores. Roda sobre a
// Solenne, IA pessoal do Rizu (bot de Discord "hermes-bot"), via a API da
// NVIDIA NIM (plano free, 40 RPM — sem custo por token, só limite de taxa).
// Endpoint compatível com OpenAI mas via Chat Completions, não a Responses
// API que o resto do lado OpenAI usa — confirmado lendo
// hermes-bot/ai_client.py ao vivo (05/08/2026).
//
// Diferente da v1 (que só lia os relatórios dos dois juízes e opinava como
// um 3º juiz), este grupo roda EM PARALELO com Claude/OpenAI, não depois:
// explora o código real dentro do escopo com as mesmas ferramentas
// confinadas (path-guard/secret-denylist) que os outros 15. Sem juiz
// próprio — o(s) especialista(s) alimentam o Líder direto (ver
// orchestrate.js). Escopo de tarefa deliberadamente mais leve/objetivo,
// adequado ao tamanho do modelo (Nemotron 3 Super, 120B).
const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
const BASE_URL = 'https://integrate.api.nvidia.com/v1';

function createSolenneClient() {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL: BASE_URL, maxRetries: 3 });
}

function buildSystemPrompt(persona, outputContract) {
  return `${persona}\n\nExplore o código real dentro do escopo usando as ferramentas disponíveis antes de concluir qualquer coisa — nunca opine sem checar. Ao final, siga este contrato de saída:\n\n${outputContract}`;
}

async function runNvidiaAgent({ client, name, model, persona, task, schemas, handlers, limits, outDir, outputContract, onStateChange }) {
  const startedAt = Date.now();
  const resolvedModel = model || DEFAULT_MODEL;
  onStateChange?.({ state: 'running' });
  if (!client) {
    const result = {
      agent: name, model: resolvedModel, status: 'failed', provider: 'nvidia-solenne',
      reason: 'nvidia_key_missing',
      error: 'NVIDIA_API_KEY não configurada — Grupo NVIDIA/Hermes fica de fora desta rodada.',
      elapsedMs: 0,
    };
    writeAgentResult(outDir, name, result);
    onStateChange?.({ state: 'skipped', elapsedMs: 0 });
    return result;
  }
  try {
    const loopResult = await runNvidiaAgentLoop({
      client, model: resolvedModel, systemPrompt: buildSystemPrompt(persona, outputContract), userPrompt: task,
      tools: schemas, toolHandlers: handlers, limits,
    });
    const result = {
      agent: name, model: resolvedModel, status: loopResult.status, provider: 'nvidia-solenne',
      finalText: loopResult.finalText,
      usage: { source: 'plano free NVIDIA NIM (sem custo, 40 RPM)', toolCallCount: loopResult.toolCallCount },
      elapsedMs: Date.now() - startedAt,
    };
    writeAgentResult(outDir, name, result);
    onStateChange?.({
      state: result.status === 'ok' ? 'done' : result.status,
      findings: (result.finalText.match(/^### /gm) || []).length,
      usage: result.usage, elapsedMs: result.elapsedMs,
    });
    return result;
  } catch (err) {
    const isAborted = err instanceof AgentAbortedError;
    const result = {
      agent: name, model: resolvedModel, status: 'failed', provider: 'nvidia-solenne',
      reason: isAborted ? err.reason : 'nvidia_api_error',
      error: err.message, elapsedMs: Date.now() - startedAt,
    };
    writeAgentResult(outDir, name, result);
    onStateChange?.({ state: 'failed', elapsedMs: result.elapsedMs });
    return result;
  }
}

/**
 * Roda os especialistas do Grupo NVIDIA/Hermes em paralelo — sem juiz
 * próprio (grupo pequeno, tarefa deliberadamente básica). Espelha
 * claude-side/engine/orchestrator.js:runClaudeSide e
 * openai-side/src/orchestrator.js:runOrchestration até o ponto dos
 * especialistas, mas para por aí — o Líder consome os relatórios brutos
 * direto (ver orchestrate.js).
 */
async function runNvidiaSide({ agentsConfig, models, limits, scope, task, outDir, onAgentUpdate }) {
  const outputContract = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'contracts', 'output-contract.md'), 'utf8');
  const client = createSolenneClient();
  const { schemas, handlers } = buildToolset(scope, limits.run_command);

  const specialistResults = await Promise.allSettled(
    (agentsConfig.specialists || []).map((spec) =>
      runNvidiaAgent({
        client, name: spec.name, model: spec.model || models.nvidia_specialists, persona: spec.foco, task,
        schemas, handlers, limits: limits.nvidia_specialist, outDir, outputContract,
        onStateChange: (u) => onAgentUpdate?.(spec.name, u),
      })
    )
  ).then((settled) => settled.map((s) => (s.status === 'fulfilled' ? s.value : { status: 'failed', reason: 'promise_rejected', error: String(s.reason) })));

  return { specialists: specialistResults };
}

module.exports = { runNvidiaAgent, runNvidiaSide };
