'use strict';
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { buildToolset } = require('../tools');
const { writeAgentResult } = require('../log');
const { runNvidiaAgentLoop, AgentAbortedError } = require('./nvidia-agent-loop');
const { runGroupWithMutualAid } = require('../../../mutual-aid');

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
  // timeout adicionado em 06/08/2026: sem isso, o SDK usa o padrão de 10min
  // por requisição — combinado com maxRetries:3, uma única chamada lenta
  // (fila do plano free, 40 RPM) podia sozinha estourar todo o
  // maxWallClockMs do agente sem chance de abortar no meio (o laço só
  // confere o tempo total no TOPO de cada iteração, não durante uma
  // chamada em andamento). Achado ao vivo: run de 06/08 estourou em
  // 260793ms contra um teto de 180000ms configurado na época — a diferença
  // é exatamente uma chamada lenta que não tinha como ser cortada.
  // 45s por tentativa deixa até ~3min em retries no pior caso (3 tentativas
  // do maxRetries), ainda dentro de uma folga razoável do teto do agente.
  return new OpenAI({ apiKey, baseURL: BASE_URL, maxRetries: 3, timeout: 45_000 });
}

const CONTEXT_NOTE =
  '\n\nVocê também tem acesso a um contexto extra (context_read_file/context_grep/context_list_files) — NÃO é o código do projeto, é material de referência (ex.: notas de PRs anteriores, bugs já corrigidos). Vale a pena checar antes de sugerir algo que talvez já tenha sido tentado ou decidido — mas não confunda com o escopo de código real.';

function buildSystemPrompt(persona, outputContract, hasContext) {
  return `${persona}\n\nExplore o código real dentro do escopo usando as ferramentas disponíveis antes de concluir qualquer coisa — nunca opine sem checar. Ao final, siga este contrato de saída:\n\n${outputContract}${hasContext ? CONTEXT_NOTE : ''}`;
}

async function runNvidiaAgent({ client, name, model, persona, task, schemas, handlers, limits, outDir, outputContract, hasContext, onStateChange }) {
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
      client, model: resolvedModel, systemPrompt: buildSystemPrompt(persona, outputContract, hasContext), userPrompt: task,
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
async function runNvidiaSide({ agentsConfig, models, limits, scope, task, outDir, onAgentUpdate, contextPath }) {
  const outputContract = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'contracts', 'output-contract.md'), 'utf8');
  const client = createSolenneClient();
  const { schemas, handlers } = buildToolset(scope, limits.run_command, undefined, contextPath);

  // Auxílio mútuo (ver mutual-aid.js) — hoje o grupo só tem 1 especialista,
  // então isso fica inerte na prática (não há outro pra provar que dá pra
  // terminar), mas já vem pronto pra quando o grupo crescer.
  const helperLimits = {
    ...limits.nvidia_specialist,
    maxIterations: Math.max(3, Math.ceil(limits.nvidia_specialist.maxIterations / 2)),
    maxOutputTokensPerTurn: Math.ceil(limits.nvidia_specialist.maxOutputTokensPerTurn * 0.6),
  };
  const specialistResults = await runGroupWithMutualAid(
    agentsConfig.specialists || [],
    (spec) =>
      runNvidiaAgent({
        client, name: spec.name, model: spec.model || models.nvidia_specialists, persona: spec.foco, task,
        schemas, handlers, limits: limits.nvidia_specialist, outDir, outputContract,
        hasContext: !!contextPath,
        onStateChange: (u) => onAgentUpdate?.(spec.name, u),
      }),
    (spec) =>
      runNvidiaAgent({
        client, name: `${spec.name}-assist`, model: spec.model || models.nvidia_specialists, persona: spec.foco, task,
        schemas, handlers, limits: helperLimits, outDir, outputContract,
        hasContext: !!contextPath,
      }),
    { staleAfterMs: Math.ceil(limits.nvidia_specialist.maxWallClockMs * 0.55) }
  );

  return { specialists: specialistResults };
}

module.exports = { runNvidiaAgent, runNvidiaSide };
