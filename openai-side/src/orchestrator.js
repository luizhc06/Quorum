'use strict';
const fs = require('fs');
const path = require('path');
const { runAgentLoop, AgentAbortedError } = require('./agent-loop');
const { buildToolset } = require('./tools');
const { writeAgentResult } = require('./log');
const { runCodexAgent } = require('./providers/codex-local');

function buildSystemPrompt(persona, outputContract) {
  return `${persona}\n\nExplore o código real dentro do escopo usando as ferramentas disponíveis antes de concluir qualquer coisa — nunca opine sem checar. Ao final, siga este contrato de saída:\n\n${outputContract}`;
}

async function runOneAgent({ client, name, model, systemPrompt, task, schemas, handlers, limits, outDir }) {
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
async function runOneAgentAny({ client, name, model, persona, task, schemas, handlers, limits, outDir, scope, provider, outputContract }) {
  if (provider === 'codex-local') {
    const result = await runCodexAgent({ name, model, persona, task, scope, limits, outDir, outputContract });
    writeAgentResult(outDir, name, result);
    return result;
  }
  if (!client) {
    const result = { agent: name, model, status: 'failed', reason: 'openai_client_missing', error: 'provider "openai-api" pedido mas OPENAI_API_KEY não está definida', elapsedMs: 0 };
    writeAgentResult(outDir, name, result);
    return result;
  }
  return runOneAgent({ client, name, model, systemPrompt: buildSystemPrompt(persona, outputContract), task, schemas, handlers, limits, outDir });
}

/**
 * Roda os 5 especialistas em paralelo (Promise.allSettled — falha de um não
 * derruba os outros), depois o Juiz Sol recebendo os 5 relatórios como
 * contexto. Cada resultado (inclusive o do juiz) é escrito em outDir via
 * log.js — é isso que o lado Claude lê depois, nunca chamando a API OpenAI
 * diretamente.
 */
async function runOrchestration({ client, agentsConfig, models, limits, scope, task, outDir }) {
  const outputContract = fs.readFileSync(path.join(__dirname, '..', '..', 'contracts', 'output-contract.md'), 'utf8');
  // Toolset base (leitura local) só é usado pelo provedor openai-api — o
  // codex-local usa as ferramentas internas do próprio Codex CLI, não estas.
  const { schemas: baseSchemas, handlers } = buildToolset(scope, limits.run_command);
  const schemasFor = (spec) => (spec.tools?.length ? buildToolset(scope, limits.run_command, spec.tools).schemas : baseSchemas);
  const providerFor = (spec) => spec.provider || models.openai_provider || 'codex-local';

  const specialistResults = await Promise.allSettled(
    agentsConfig.specialists.map((spec) =>
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
      })
    )
  ).then((settled) => settled.map((s) => (s.status === 'fulfilled' ? s.value : { status: 'failed', reason: 'promise_rejected', error: String(s.reason) })));

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
    `Tarefa original dada aos 5 especialistas: ${task}\n\n` +
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
  });

  return { specialists: specialistResults, judge: judgeResult };
}

module.exports = { runOrchestration };
