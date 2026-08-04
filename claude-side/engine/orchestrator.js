'use strict';
const fs = require('fs');
const path = require('path');
const { runAgentLoop, AgentAbortedError } = require('./agent-loop');
const { buildToolset } = require('./tools');
const { createTranscriptLogger } = require('./transcript');

function buildSystemPrompt(persona, outputContract) {
  return `${persona}\n\nExplore o código real dentro do escopo usando as ferramentas disponíveis antes de concluir qualquer coisa — nunca opine sem checar. Ao final, siga este contrato de saída:\n\n${outputContract}`;
}

// spec pode vir de config/agents.json (promptFile aponta pra claude-side/agents/*.md,
// a mesma fonte que os agentes rodados via Agent tool usam) ou ser um agente
// avulso pedido numa rodada (foco inline, sem arquivo — ver "agentes diferentes"
// em ORCHESTRATION.md).
function loadPersona(spec) {
  if (spec.foco) return spec.foco;
  if (spec.promptFile) return fs.readFileSync(path.join(__dirname, '..', 'agents', spec.promptFile), 'utf8');
  throw new Error(`agente "${spec.name}" sem "foco" nem "promptFile" — nada pra usar como persona`);
}

function countFindings(text) {
  if (!text) return 0;
  const matches = text.match(/^### /gm);
  return matches ? matches.length : 0;
}

async function runOneAgent({ client, name, model, systemPrompt, task, schemas, handlers, limits, outDir, onStateChange }) {
  const startedAt = Date.now();
  const logger = createTranscriptLogger(outDir, name);
  onStateChange?.({ state: 'running' });
  try {
    const loopResult = await runAgentLoop({
      client, model, systemPrompt, userPrompt: task, tools: schemas, toolHandlers: handlers, limits,
      onTranscriptLine: (line) => logger.append(line),
      onEvent: (ev) => onStateChange?.({ event: ev }),
    });
    const result = { agent: name, model, ...loopResult, elapsedMs: Date.now() - startedAt, chatFile: logger.filePath };
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(result, null, 2));
    onStateChange?.({
      state: loopResult.status === 'ok' ? 'done' : loopResult.status,
      findings: countFindings(loopResult.finalText),
      usage: loopResult.usage,
      elapsedMs: result.elapsedMs,
    });
    return result;
  } catch (err) {
    const result = err instanceof AgentAbortedError
      ? { agent: name, model, status: 'failed', reason: err.reason, detail: err.detail, elapsedMs: Date.now() - startedAt }
      : { agent: name, model, status: 'failed', reason: 'unexpected_error', error: err.message, elapsedMs: Date.now() - startedAt };
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(result, null, 2));
    onStateChange?.({ state: 'failed', elapsedMs: result.elapsedMs });
    return result;
  }
}

/**
 * Roda os especialistas Claude em paralelo (falha de um não derruba os
 * outros) e depois o Juiz. Espelha openai-side/src/orchestrator.js — mesma
 * forma de retorno, pra o script de nível superior (orchestrate.js) tratar
 * os dois lados de forma simétrica.
 */
async function runClaudeSide({ client, agentsConfig, models, limits, scope, task, outDir, onAgentUpdate }) {
  const outputContract = fs.readFileSync(path.join(__dirname, '..', '..', 'contracts', 'output-contract.md'), 'utf8');
  const { schemas, handlers } = buildToolset(scope, limits.run_command);

  const specialistResults = await Promise.allSettled(
    agentsConfig.specialists.map((spec) =>
      runOneAgent({
        client,
        name: spec.name,
        model: spec.model || models.claude_specialists,
        systemPrompt: buildSystemPrompt(loadPersona(spec), outputContract),
        task,
        schemas,
        handlers,
        limits: limits.claude_specialist,
        outDir,
        onStateChange: (u) => onAgentUpdate?.(spec.name, u),
      })
    )
  ).then((settled) => settled.map((s) => (s.status === 'fulfilled' ? s.value : { status: 'failed', reason: 'promise_rejected', error: String(s.reason) })));

  const okCount = specialistResults.filter((r) => r.status === 'ok').length;
  const failedNames = specialistResults.filter((r) => r.status !== 'ok').map((r) => r.agent || '?');

  const digestForJudge = specialistResults
    .map((r) => {
      const header = `### Relatório de "${r.agent}" (status: ${r.status})`;
      let body;
      if (r.status === 'ok') body = r.finalText;
      else if (r.status === 'refused') body = `Este agente RECUSOU produzir a análise. Texto: "${r.finalText || '(sem detalhe)'}". Trate como cobertura ausente, não como relatório vazio.`;
      else body = `Este agente falhou (${r.reason || r.error}) — não produziu relatório.`;
      return `${header}\n\n${body}`;
    })
    .join('\n\n---\n\n');

  const judgeTask =
    `Tarefa original dada aos especialistas: ${task}\n\n` +
    (failedNames.length ? `Atenção: os agentes [${failedNames.join(', ')}] falharam e não produziram relatório — não finja cobertura completa.\n\n` : '') +
    `Relatórios brutos dos ${okCount}/${specialistResults.length} especialistas que concluíram:\n\n${digestForJudge}`;

  const judgeResult = await runOneAgent({
    client,
    name: agentsConfig.judge.name,
    model: agentsConfig.judge.model || models.claude_judge,
    systemPrompt: buildSystemPrompt(loadPersona(agentsConfig.judge), outputContract),
    task: judgeTask,
    schemas,
    handlers,
    limits: limits.claude_judge,
    outDir,
    onStateChange: (u) => onAgentUpdate?.(agentsConfig.judge.name, u),
  });

  return { specialists: specialistResults, judge: judgeResult };
}

module.exports = { runClaudeSide, runOneAgent, buildSystemPrompt, loadPersona };
