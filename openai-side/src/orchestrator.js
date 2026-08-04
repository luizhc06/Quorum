'use strict';
const fs = require('fs');
const path = require('path');
const { runAgentLoop, AgentAbortedError } = require('./agent-loop');
const { buildToolset } = require('./tools');
const { writeAgentResult } = require('./log');

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

/**
 * Roda os 5 especialistas em paralelo (Promise.allSettled — falha de um não
 * derruba os outros), depois o Juiz Sol recebendo os 5 relatórios como
 * contexto. Cada resultado (inclusive o do juiz) é escrito em outDir via
 * log.js — é isso que o lado Claude lê depois, nunca chamando a API OpenAI
 * diretamente.
 */
async function runOrchestration({ client, agentsConfig, models, limits, scope, task, outDir }) {
  const outputContract = fs.readFileSync(path.join(__dirname, '..', '..', 'contracts', 'output-contract.md'), 'utf8');
  const { schemas, handlers } = buildToolset(scope, limits.run_command);

  const specialistResults = await Promise.allSettled(
    agentsConfig.specialists.map((spec) =>
      runOneAgent({
        client,
        name: spec.name,
        model: models.openai_specialists,
        systemPrompt: buildSystemPrompt(spec.foco, outputContract),
        task,
        schemas,
        handlers,
        limits: limits.openai_specialist,
        outDir,
      })
    )
  ).then((settled) => settled.map((s) => (s.status === 'fulfilled' ? s.value : { status: 'failed', reason: 'promise_rejected', error: String(s.reason) })));

  const okCount = specialistResults.filter((r) => r.status === 'ok').length;
  const failedNames = specialistResults.filter((r) => r.status !== 'ok').map((r) => r.agent || '?');

  const digestForJudge = specialistResults
    .map((r) => {
      const header = `### Relatório de "${r.agent}" (status: ${r.status})`;
      const body = r.status === 'ok' ? r.finalText : `Este agente falhou (${r.reason || r.error}) — não produziu relatório.`;
      return `${header}\n\n${body}`;
    })
    .join('\n\n---\n\n');

  const judgeTask =
    `Tarefa original dada aos 5 especialistas: ${task}\n\n` +
    (failedNames.length ? `Atenção: os agentes [${failedNames.join(', ')}] falharam e não produziram relatório — não finja cobertura completa.\n\n` : '') +
    `Relatórios brutos dos ${okCount}/${specialistResults.length} especialistas que concluíram:\n\n${digestForJudge}`;

  const judgeResult = await runOneAgent({
    client,
    name: agentsConfig.judge.name,
    model: models.openai_judge,
    systemPrompt: buildSystemPrompt(agentsConfig.judge.foco, outputContract),
    task: judgeTask,
    schemas,
    handlers,
    limits: limits.openai_judge,
    outDir,
  });

  return { specialists: specialistResults, judge: judgeResult };
}

module.exports = { runOrchestration };
