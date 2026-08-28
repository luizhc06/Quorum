'use strict';
const fs = require('fs');
const path = require('path');
const { runAgentLoop, AgentAbortedError } = require('./agent-loop');
const { buildToolset } = require('./tools');
const { writeAgentResult } = require('./log');
const { runCodexAgent } = require('./providers/codex-local');
const { runGroupWithMutualAid } = require('../../mutual-aid');

const CONTEXT_NOTE =
  '\n\nVocê também tem acesso a um contexto extra (context_read_file/context_grep/context_list_files) — NÃO é o código do projeto, é material de referência (ex.: notas de PRs anteriores, bugs já corrigidos). Vale a pena checar antes de sugerir algo que talvez já tenha sido tentado ou decidido — mas não confunda com o escopo de código real.';

function buildSystemPrompt(persona, outputContract, hasContext) {
  return `${persona}\n\nExplore o código real dentro do escopo usando as ferramentas disponíveis antes de concluir qualquer coisa — nunca opine sem checar. Ao final, siga este contrato de saída:\n\n${outputContract}${hasContext ? CONTEXT_NOTE : ''}`;
}

async function runOneAgent({ client, name, model, systemPrompt, task, schemas, handlers, limits, outDir, onEvent, signal }) {
  const startedAt = Date.now();
  try {
    const loopResult = await runAgentLoop({
      client,
      model,
      systemPrompt,
      userPrompt: task,
      tools: schemas,
      toolHandlers: handlers,
      limits,
      signal,
      onEvent: (ev) => {
        if (ev.type === 'tool_call') onEvent?.({ type: 'tool-call-start', tool: ev.tool });
        else onEvent?.(ev);
      },
    });
    const result = { agent: name, model, ...loopResult, elapsedMs: Date.now() - startedAt };
    writeAgentResult(outDir, name, result);
    return result;
  } catch (err) {
    const result =
      err instanceof AgentAbortedError
        ? { agent: name, model, status: 'failed', reason: err.reason, detail: err.detail, elapsedMs: Date.now() - startedAt }
        : { agent: name, model, status: 'failed', reason: 'unexpected_error', error: err.message, elapsedMs: Date.now() - startedAt };
    writeAgentResult(outDir, name, result);
    return result;
  }
}

// Escolhe entre os dois motores do lado OpenAI por especialista: codex-local
// (padrão — usa `codex exec` já autenticado na conta ChatGPT, sem custo de
// API) ou openai-api (o motor original, Responses API, cobrado por token —
// mantido como opção pra ambientes sem Codex logado, ex. servidor/CI).
// Ver openai-side/src/providers/codex-local.js para as diferenças de
// garantia de segurança entre os dois.
async function runOneAgentAny({ client, name, model, persona, task, schemas, handlers, limits, outDir, scope, provider, outputContract, hasContext, onEvent, signal }) {
  if (provider === 'codex-local') {
    // Limitação conhecida: o Codex CLI usa suas próprias ferramentas
    // internas confinadas só a --cd <scope> — não há como estender pra uma
    // segunda raiz (--context-path) sem mexer no sandbox dele. Com
    // codex-local (o padrão), o contexto extra simplesmente não chega
    // pros especialistas OpenAI ainda; só funciona com o provedor
    // openai-api. Não finjo cobertura completa — documentado aqui e no
    // relatório de qualquer rodada que usar --context-path.
    const result = await runCodexAgent({ name, model, persona, task, scope, limits, outDir, outputContract, signal });
    writeAgentResult(outDir, name, result);
    // codex-local roda como processo único, sem streaming possível — um
    // único evento de conclusão é a granularidade honesta disponível.
    onEvent?.({ type: 'done', status: result.status, finalText: result.finalText });
    return result;
  }
  if (!client) {
    const result = { agent: name, model, status: 'failed', reason: 'openai_client_missing', error: 'provider "openai-api" pedido mas OPENAI_API_KEY não está definida', elapsedMs: 0 };
    writeAgentResult(outDir, name, result);
    return result;
  }
  return runOneAgent({ client, name, model, systemPrompt: buildSystemPrompt(persona, outputContract, hasContext), task, schemas, handlers, limits, outDir, onEvent, signal });
}

/**
 * Roda os 5 especialistas em paralelo (Promise.allSettled — falha de um não
 * derruba os outros), depois o Juiz Sol recebendo os 5 relatórios como
 * contexto. Cada resultado (inclusive o do juiz) é escrito em outDir via
 * log.js — é isso que o lado Claude lê depois, nunca chamando a API OpenAI
 * diretamente.
 */
async function runOrchestration({ client, agentsConfig, models, limits, scope, task, outDir, contextPath }) {
  const outputContract = fs.readFileSync(path.join(__dirname, '..', '..', 'contracts', 'output-contract.md'), 'utf8');
  // Toolset base (leitura local) só é usado pelo provedor openai-api — o
  // codex-local usa as ferramentas internas do próprio Codex CLI, não estas.
  const { schemas: baseSchemas, handlers } = buildToolset(scope, limits.run_command, undefined, contextPath);
  const schemasFor = (spec) => (spec.tools?.length ? buildToolset(scope, limits.run_command, spec.tools, contextPath).schemas : baseSchemas);
  const providerFor = (spec) => spec.provider || models.openai_provider || 'codex-local';

  // Auxílio mútuo: se um especialista ainda não terminou depois de ~55% do
  // próprio prazo E outro do grupo já concluiu com sucesso, um "ajudante"
  // tenta a MESMA tarefa em paralelo — usa quem terminar primeiro com
  // sucesso. No provedor openai-api o ajudante usa gpt-5.6-luna (mais
  // barato) com orçamento menor; no codex-local (padrão, sem custo por
  // token) o ajudante é só uma 2ª chamada `codex exec` com prazo mais
  // curto — ganha em velocidade, não em custo (Codex já é de graça). Ver
  // mutual-aid.js pra limitações reais (não cancela a tentativa original).
  const helperLimits = {
    ...limits.openai_specialist,
    maxIterations: Math.max(3, Math.ceil(limits.openai_specialist.maxIterations / 2)),
    maxOutputTokensPerTurn: Math.ceil(limits.openai_specialist.maxOutputTokensPerTurn * 0.6),
  };
  const specialistResults = await runGroupWithMutualAid(
    agentsConfig.specialists,
    (spec) =>
      runOneAgentAny({
        client,
        name: spec.name,
        // codex-local: sem -m usa o modelo padrão já configurado no Codex CLI
        // do usuário (spec.model, se houver, é ignorado — Codex não
        // necessariamente aceita qualquer id de modelo da API); openai-api:
        // spec.model (ex. gpt-5.6-luna nas lentes mais baratas) ou o padrão.
        model: providerFor(spec) === 'codex-local' ? spec.codexModel : (spec.model || models.openai_specialists),
        persona: spec.foco,
        task,
        schemas: schemasFor(spec),
        handlers,
        limits: limits.openai_specialist,
        outDir,
        scope,
        provider: providerFor(spec),
        outputContract,
        hasContext: !!contextPath,
      }),
    (spec) =>
      runOneAgentAny({
        client,
        name: `${spec.name}-assist`,
        model: providerFor(spec) === 'codex-local' ? spec.codexModel : 'gpt-5.6-luna',
        persona: spec.foco,
        task,
        schemas: schemasFor(spec),
        handlers,
        limits: helperLimits,
        outDir,
        scope,
        provider: providerFor(spec),
        outputContract,
        hasContext: !!contextPath,
      }),
    { staleAfterMs: Math.ceil(limits.openai_specialist.maxWallClockMs * 0.55) }
  );

  const okCount = specialistResults.filter((r) => r.status === 'ok').length;
  const failedNames = specialistResults.filter((r) => r.status !== 'ok').map((r) => r.agent || '?');

  const digestForJudge = specialistResults
    .map((r) => {
      const header = `### Relatório de "${r.agent}" (status: ${r.status})`;
      let body;
      if (r.status === 'ok') {
        body = r.finalText;
      } else if (r.status === 'refused') {
        body = `Este agente RECUSOU produzir a análise (não é falha de rede/API — o modelo se negou). Texto da recusa: "${r.finalText || '(sem detalhe)'}". Trate isso como cobertura ausente nesta área, não como um relatório vazio.`;
      } else {
        body = `Este agente falhou (${r.reason || r.error}) — não produziu relatório.`;
      }
      return `${header}\n\n${body}`;
    })
    .join('\n\n---\n\n');

  const judgeTask =
    `Tarefa original dada aos ${agentsConfig.specialists.length} especialistas: ${task}\n\n` +
    (failedNames.length ? `Atenção: os agentes [${failedNames.join(', ')}] falharam e não produziram relatório — não finja cobertura completa.\n\n` : '') +
    `Relatórios brutos dos ${okCount}/${specialistResults.length} especialistas que concluíram:\n\n${digestForJudge}`;

  const judgeProvider = providerFor(agentsConfig.judge);
  const judgeResult = await runOneAgentAny({
    client,
    name: agentsConfig.judge.name,
    model: judgeProvider === 'codex-local' ? agentsConfig.judge.codexModel : models.openai_judge,
    persona: agentsConfig.judge.foco,
    task: judgeTask,
    schemas: schemasFor(agentsConfig.judge),
    handlers,
    limits: limits.openai_judge,
    outDir,
    scope,
    provider: judgeProvider,
    outputContract,
    hasContext: !!contextPath,
  });

  return { specialists: specialistResults, judge: judgeResult };
}

module.exports = { runOrchestration, runOneAgentAny, buildSystemPrompt };
