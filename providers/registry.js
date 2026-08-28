'use strict';
// Ponto único de despacho de agentes: dado um model id (de config/model-pool.json
// ou de config/routing.json → customModels), decide qual motor de execução
// roda esse especialista/juiz/líder. Substitui as 3 promises fixas
// (runClaudeSide/runOpenaiSide/runNvidiaSide) que orchestrate.js usava
// quando os grupos eram fixos por fornecedor — agora a alocação vem do
// kickoff (ver orchestrate.js::parseAllocation) e pode escolher QUALQUER
// modelo disponível pra QUALQUER especialidade, então o despacho por model
// id (não mais por "lado") precisa viver num lugar só, sem crescer em
// if/elses espalhados pelo orquestrador principal.
const fs = require('fs');
const path = require('path');
const { findModel } = require('../config/specialty-catalog');

const { runOneAgentAny: runClaudeAgentAny, buildSystemPrompt: buildClaudeSystemPrompt } = require('../claude-side/engine/orchestrator');
const { buildToolset: buildClaudeToolset } = require('../claude-side/engine/tools');

const { runOneAgentAny: runOpenaiAgentAny } = require('../openai-side/src/orchestrator');
const { buildToolset: buildOpenaiToolset } = require('../openai-side/src/tools');

const { runNvidiaAgent } = require('../openai-side/src/providers/nvidia-solenne');
const { runCommunityAgent } = require('../openai-side/src/providers/community');

function loadOutputContract() {
  return fs.readFileSync(path.join(__dirname, '..', 'contracts', 'output-contract.md'), 'utf8');
}

function countFindings(text) {
  if (!text) return 0;
  const matches = text.match(/^### /gm);
  return matches ? matches.length : 0;
}

/**
 * Monta, UMA vez por rodada, o que os motores precisam (clients, toolsets,
 * contrato de saída) — evita reconstruir isso a cada agente disparado.
 * `run(modelId, args)` é o único ponto que orchestrate.js chama pra rodar
 * QUALQUER especialista/juiz/líder, independente do motor por trás do
 * modelo escolhido pelo alocador.
 */
function createRegistry({ scope, contextPath, limits, models, routing, modelPool, claudeClient, openaiClient }) {
  const outputContract = loadOutputContract();
  const hasContext = !!contextPath;

  const claudeToolset = buildClaudeToolset(scope, limits.run_command, contextPath);
  const openaiToolset = buildOpenaiToolset(scope, limits.run_command, undefined, contextPath);

  async function run(modelId, { name, persona, task, limits: agentLimits, outDir, onStateChange, onEvent, signal }) {
    const model = findModel(modelId, { modelPool, routing });
    if (!model) {
      const result = {
        agent: name, model: modelId, status: 'failed', reason: 'unknown_model',
        error: `model id "${modelId}" não está em config/model-pool.json nem em config/routing.json → customModels`,
        elapsedMs: 0,
      };
      onStateChange?.({ state: 'failed', elapsedMs: 0 });
      return result;
    }

    if (model.engine === 'claude') {
      return runClaudeAgentAny({
        client: claudeClient, name, model: modelId,
        systemPrompt: buildClaudeSystemPrompt(persona, outputContract, hasContext),
        task, schemas: claudeToolset.schemas, handlers: claudeToolset.handlers,
        limits: agentLimits, outDir, scope, contextPath,
        provider: models.claude_provider || 'claude-code-local', onStateChange, onEvent, signal,
      });
    }

    if (model.engine === 'openai') {
      // openai-side/src/orchestrator.js::runOneAgentAny não chama
      // onStateChange (motor mais antigo, sem live-update — mesma
      // limitação que orchestrate.js já documentava pro lado OpenAI antes
      // desta mudança); já repassa onEvent (tool-call/text-delta no motor
      // -api, um único 'done' no codex-local). Reportamos running/done
      // manualmente aqui pra o painel refletir início/fim mesmo quando o
      // motor for o codex-local (só grosso, sem streaming).
      onStateChange?.({ state: 'running' });
      const startedAt = Date.now();
      const result = await runOpenaiAgentAny({
        client: openaiClient, name, model: modelId, persona, task,
        schemas: openaiToolset.schemas, handlers: openaiToolset.handlers,
        limits: agentLimits, outDir, scope,
        provider: models.openai_provider || 'codex-local', outputContract, hasContext, onEvent, signal,
      });
      onStateChange?.({
        state: result.status === 'ok' ? 'done' : result.status,
        findings: countFindings(result.finalText), usage: result.usage,
        elapsedMs: result.elapsedMs ?? (Date.now() - startedAt),
      });
      return result;
    }

    if (model.engine === 'nvidia') {
      return runNvidiaAgent({
        name, model: modelId, persona, task,
        schemas: openaiToolset.schemas, handlers: openaiToolset.handlers,
        limits: agentLimits, outDir, outputContract, hasContext, onStateChange, onEvent, signal,
      });
    }

    if (model.engine === 'community') {
      // runCommunityAgent já sabe despachar por spec.provider
      // ('ollama'/'openrouter'/'omniroute' via openai-compat.js, ou
      // 'antigravity-cli' via runAntigravityHeadless) — um spec sintético
      // basta, não precisa vir de config/community-agents.json.
      const spec = {
        key: name, name, provider: model.provider, model: modelId,
        focus: persona, skills: [], free: model.free,
        baseUrl: model.provider === 'omniroute' ? routing.omnirouteBaseUrl : undefined,
      };
      return runCommunityAgent({
        spec, scope, task, outDir, contextPath, onStateChange, onEvent, signal,
        limits: { community_specialist: agentLimits },
      });
    }

    const result = { agent: name, model: modelId, status: 'failed', reason: 'unknown_engine', error: `engine "${model.engine}" não reconhecido`, elapsedMs: 0 };
    onStateChange?.({ state: 'failed', elapsedMs: 0 });
    return result;
  }

  return { run };
}

module.exports = { createRegistry };
