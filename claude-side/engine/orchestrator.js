'use strict';
const fs = require('fs');
const path = require('path');
const { runAgentLoop, AgentAbortedError } = require('./agent-loop');
const { buildToolset } = require('./tools');
const { createTranscriptLogger } = require('./transcript');
const { runClaudeCodeAgent } = require('./providers/claude-code-local');
const { runGroupWithMutualAid } = require('../../mutual-aid');

const CONTEXT_NOTE =
  '\n\nVocê também tem acesso a um contexto extra (context_read_file/context_grep/context_list_files) — NÃO é o código do projeto, é material de referência (ex.: notas de PRs anteriores, bugs já corrigidos). Vale a pena checar antes de sugerir algo que talvez já tenha sido tentado ou decidido — mas não confunda com o escopo de código real.';

function buildSystemPrompt(persona, outputContract, hasContext) {
  return `${persona}\n\nExplore o código real dentro do escopo usando as ferramentas disponíveis antes de concluir qualquer coisa — nunca opine sem checar. Ao final, siga este contrato de saída:\n\n${outputContract}${hasContext ? CONTEXT_NOTE : ''}`;
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

async function runOneAgent({ client, name, model, systemPrompt, task, schemas, handlers, limits, outDir, onStateChange, onEvent, signal }) {
  const startedAt = Date.now();
  const logger = createTranscriptLogger(outDir, name);
  onStateChange?.({ state: 'running' });
  try {
    const loopResult = await runAgentLoop({
      client, model, systemPrompt, userPrompt: task, tools: schemas, toolHandlers: handlers, limits, signal,
      onTranscriptLine: (line) => logger.append(line),
      onEvent: (ev) => {
        if (ev.type === 'tool_call') onEvent?.({ type: 'tool-call-start', tool: ev.tool });
        else onEvent?.(ev);
      },
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

// Escolhe entre os dois motores do lado Claude por especialista:
// claude-code-local (padrão — usa `claude -p` já autenticado na assinatura
// do usuário, sem custo de API) ou claude-api (o motor original, Messages
// API, cobrado por token via ANTHROPIC_API_KEY — mantido pra ambientes sem
// Claude Code logado, ex. servidor/CI). Espelha exatamente
// openai-side/src/orchestrator.js → runOneAgentAny. Ver
// claude-side/engine/providers/claude-code-local.js pras diferenças de
// garantia de segurança entre os dois.
async function runOneAgentAny({ client, name, model, systemPrompt, task, schemas, handlers, limits, outDir, scope, contextPath, provider, onStateChange, onEvent, signal }) {
  if (provider === 'claude-code-local') {
    onStateChange?.({ state: 'running' });
    onEvent?.({ type: 'state-change', state: 'running' });
    const result = await runClaudeCodeAgent({ name, model, systemPrompt, task, scope, contextPath, limits, outDir, signal });
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(result, null, 2));
    onStateChange?.({
      state: result.status === 'ok' ? 'done' : result.status,
      findings: countFindings(result.finalText),
      usage: result.usage,
      elapsedMs: result.elapsedMs,
    });
    // claude-code-local roda como processo único, sem streaming possível —
    // um único evento de conclusão é a granularidade honesta disponível
    // (ver providers/openai-compat.js pro motor que tem streaming de verdade).
    onEvent?.({ type: 'done', status: result.status, finalText: result.finalText });
    return result;
  }
  if (!client) {
    const result = { agent: name, model, status: 'failed', reason: 'claude_client_missing', error: 'provider "claude-api" pedido mas ANTHROPIC_API_KEY não está definida', elapsedMs: 0 };
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(result, null, 2));
    onStateChange?.({ state: 'failed', elapsedMs: 0 });
    return result;
  }
  return runOneAgent({ client, name, model, systemPrompt, task, schemas, handlers, limits, outDir, onStateChange, onEvent, signal });
}

/**
 * Roda os especialistas Claude em paralelo (falha de um não derruba os
 * outros) e depois o Juiz. Espelha openai-side/src/orchestrator.js — mesma
 * forma de retorno, pra o script de nível superior (orchestrate.js) tratar
 * os dois lados de forma simétrica.
 */
async function runClaudeSide({ client, agentsConfig, models, limits, scope, task, outDir, onAgentUpdate, contextPath }) {
  const outputContract = fs.readFileSync(path.join(__dirname, '..', '..', 'contracts', 'output-contract.md'), 'utf8');
  const { schemas, handlers } = buildToolset(scope, limits.run_command, contextPath);

  // Auxílio mútuo: se um especialista ainda não terminou depois de ~55% do
  // próprio prazo E outro do grupo já concluiu com sucesso, um "ajudante"
  // (Haiku, orçamento menor) tenta a MESMA tarefa em paralelo — usa quem
  // terminar primeiro com sucesso. Ver mutual-aid.js pra limitações reais
  // (não cancela a tentativa original em andamento).
  const helperLimits = {
    ...limits.claude_specialist,
    maxIterations: Math.max(3, Math.ceil(limits.claude_specialist.maxIterations / 2)),
    maxOutputTokensPerTurn: Math.ceil(limits.claude_specialist.maxOutputTokensPerTurn * 0.6),
  };
  const providerFor = (spec) => spec.provider || models.claude_provider || 'claude-code-local';
  const specialistResults = await runGroupWithMutualAid(
    agentsConfig.specialists,
    (spec) =>
      runOneAgentAny({
        client,
        name: spec.name,
        model: spec.model || models.claude_specialists,
        systemPrompt: buildSystemPrompt(loadPersona(spec), outputContract, !!contextPath),
        task,
        schemas,
        handlers,
        limits: limits.claude_specialist,
        outDir,
        scope,
        contextPath,
        provider: providerFor(spec),
        onStateChange: (u) => onAgentUpdate?.(spec.name, u),
      }),
    (spec) =>
      runOneAgentAny({
        client,
        name: `${spec.name}-assist`,
        model: providerFor(spec) === 'claude-code-local' ? (spec.model || models.claude_specialists) : models.claude_writer_low_cost,
        systemPrompt: buildSystemPrompt(loadPersona(spec), outputContract, !!contextPath),
        task,
        schemas,
        handlers,
        limits: helperLimits,
        outDir,
        scope,
        contextPath,
        provider: providerFor(spec),
      }),
    {
      staleAfterMs: Math.ceil(limits.claude_specialist.maxWallClockMs * 0.55),
      onHelperTriggered: (spec) => onAgentUpdate?.(spec.name, { helperTriggered: true }),
    }
  );
  // Estado final autoritativo por especialista — sobrescreve qualquer
  // atualização intermediária conflitante (ex.: se o ajudante venceu, a
  // tentativa original ainda pode terminar depois e emitir seu próprio
  // onStateChange; isso garante que o painel reflita quem realmente venceu).
  agentsConfig.specialists.forEach((spec, i) => {
    const r = specialistResults[i];
    onAgentUpdate?.(spec.name, {
      state: r.status === 'ok' ? 'done' : r.status,
      findings: countFindings(r.finalText),
      usage: r.usage,
      elapsedMs: r.elapsedMs,
      assisted: (r.agent || '').endsWith('-assist'),
    });
  });

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

  const judgeProvider = providerFor(agentsConfig.judge);
  const judgeResult = await runOneAgentAny({
    client,
    name: agentsConfig.judge.name,
    model: agentsConfig.judge.model || models.claude_judge,
    systemPrompt: buildSystemPrompt(loadPersona(agentsConfig.judge), outputContract, !!contextPath),
    task: judgeTask,
    schemas,
    handlers,
    limits: limits.claude_judge,
    outDir,
    scope,
    contextPath,
    provider: judgeProvider,
    onStateChange: (u) => onAgentUpdate?.(agentsConfig.judge.name, u),
  });

  return { specialists: specialistResults, judge: judgeResult };
}

module.exports = { runClaudeSide, runOneAgent, runOneAgentAny, buildSystemPrompt, loadPersona };
