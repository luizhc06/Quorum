#!/usr/bin/env node
'use strict';
// Ponto de entrada de uma rodada Quorum completa e automática: o Líder faz
// um kickoff (pesquisa rápida + monta o brief da rodada), depois os três
// grupos (Claude via claude-side/engine, OpenAI via openai-side/src,
// NVIDIA/Hermes via openai-side/src/providers/nvidia-solenne) rodam em
// paralelo, escrevendo o progresso ao vivo em runs/<run-id>/state.json —
// é isso que o painel (dashboard/) lê via polling. Nenhuma parte deste
// script depende de uma conversa ativa do Claude Code: uso
// `node orchestrate.js --scope <dir> --task "..." --run-id <id> --out
// runs/<id>` e ele roda sozinho até o fim.
const fs = require('fs');
const path = require('path');

require('./env').loadEnvFile(__dirname);

const { createClient: createClaudeClient } = require('./claude-side/engine/client');
const { runClaudeSide, runOneAgent: runOneClaudeAgent, buildSystemPrompt, loadPersona } = require('./claude-side/engine/orchestrator');
const { buildToolset: buildClaudeToolset } = require('./claude-side/engine/tools');

const { createClient: createOpenaiClient } = require('./openai-side/src/client');
const { runOrchestration: runOpenaiSide } = require('./openai-side/src/orchestrator');
const { runNvidiaSide } = require('./openai-side/src/providers/nvidia-solenne');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[key] = val;
    }
  }
  return out;
}
function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function nowLabel() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtElapsed(ms) {
  const totalS = Math.floor(ms / 1000);
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function patchState(statePath, updater) {
  let state = {};
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) { /* primeira escrita */ }
  updater(state);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function extractFindingBlocks(markdown) {
  if (!markdown) return [];
  const lines = markdown.split('\n');
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith('### ')) {
      if (current) blocks.push(current.join('\n'));
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) blocks.push(current.join('\n'));
  return blocks;
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.scope || !args.task || !args['run-id'] || !args.out) {
    console.error('Uso: node orchestrate.js --scope <dir> --task "<descrição>" --run-id <id> --out runs/<id> [--context-path <dir>] [--extra-agents \'{"claude":[...],"openai":[...]}\']');
    process.exit(1);
  }

  const runId = args['run-id'];
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const statePath = path.join(outDir, 'state.json');
  const scope = path.resolve(args.scope);
  // Contexto extra opcional (ex.: vault do Obsidian) — genérico, não
  // hardcoded a nenhum projeto específico. Sem essa flag, o Quorum roda
  // exatamente como antes (nada muda). Ver openai-side/src/tools/index.js
  // e claude-side/engine/tools.js para as ferramentas context_*.
  const contextPath = args['context-path'] ? path.resolve(args['context-path']) : undefined;
  let tickTimer = null;

  try {
    await runRound();
  } catch (err) {
    if (tickTimer) clearInterval(tickTimer);
    patchState(statePath, (state) => {
      state.run = state.run || { runId };
      state.run.status = 'failed';
      state.activity = state.activity || [];
      state.activity.unshift({ time: nowLabel(), text: `Rodada falhou: ${err.message}` });
    });
    throw err;
  }

  async function runRound() {
  const models = loadJson(path.join(__dirname, 'config', 'models.json'));
  const limits = loadJson(path.join(__dirname, 'config', 'limits.json'));
  const claudeAgentsConfig = loadJson(path.join(__dirname, 'claude-side', 'config', 'agents.json'));
  const openaiAgentsConfig = loadJson(path.join(__dirname, 'openai-side', 'config', 'agents.json'));

  let extra = { claude: [], openai: [] };
  if (args['extra-agents']) {
    try { extra = { claude: [], openai: [], ...JSON.parse(args['extra-agents']) }; }
    catch (e) { console.error('--extra-agents inválido (precisa ser JSON), ignorando:', e.message); }
  }
  const claudeSpecs = [...claudeAgentsConfig.specialists, ...extra.claude];
  const openaiSpecs = [...openaiAgentsConfig.specialists, ...extra.openai];
  const nvidiaSpecs = openaiAgentsConfig.nvidia?.specialists || [];

  const startedAt = Date.now();

  patchState(statePath, (state) => {
    state.run = {
      runId, round: 1, task: args.task, status: 'running',
      startedAt: new Date(startedAt).toISOString(),
      parallelism: `${claudeSpecs.length + openaiSpecs.length + nvidiaSpecs.length} agentes`,
      elapsed: '00:00', cost: 'US$ 0,00',
    };
    state.claudeAgents = claudeSpecs.map((s) => ({
      key: s.name, name: s.titulo || s.name, model: s.model ? s.model : 'Sonnet 5',
      state: 'queued', findings: 0, lens: s.foco ? s.foco.slice(0, 140) : '', elapsed: '—',
    }));
    state.openaiAgents = openaiSpecs.map((s) => ({
      key: s.name, name: s.titulo || s.name, model: s.model ? s.model : 'GPT-5.6 Terra',
      state: 'queued', findings: 0, lens: s.foco ? s.foco.slice(0, 140) : '', elapsed: '—',
    }));
    state.nvidiaAgents = nvidiaSpecs.map((s) => ({
      key: s.name, name: s.titulo || s.name, model: s.model ? s.model : 'Nemotron 3 Super',
      state: 'queued', findings: 0, lens: s.foco ? s.foco.slice(0, 140) : '', elapsed: '—',
    }));
    state.arbiters = [
      { key: 'juiz-claude', name: 'Juiz Claude', model: 'Opus 5 · com leitura', state: 'queued', role: 'Aguardando os especialistas Claude.', chips: [] },
      { key: 'juiz-openai', name: 'Juiz OpenAI', model: 'GPT-5.6 Sol · com leitura', state: 'queued', role: 'Aguardando os especialistas OpenAI.', chips: [] },
      { key: 'juiz-nvidia', name: 'Juiz NVIDIA', model: 'Sonnet 5 · com leitura', state: 'queued', role: 'Aguardando o Hermes.', chips: [] },
      { key: 'lider', name: 'Líder / Sintetizador', model: 'Opus 5', state: 'queued', role: 'Vai pesquisar e montar o brief da rodada antes de liberar os grupos.', chips: [] },
    ];
    state.judgeReports = { claude: '', openai: '', nvidia: '' };
    state.headline = ''; state.lede = ''; state.synthBlocks = []; state.dissent = null;
    state.activity = [{ time: nowLabel(), text: `Rodada iniciada: "${args.task}"` }];
    state.decisions = state.decisions || {};
  });

  tickTimer = setInterval(() => {
    patchState(statePath, (state) => { state.run.elapsed = fmtElapsed(Date.now() - startedAt); });
  }, 5000);

  function pushActivity(text) {
    patchState(statePath, (state) => {
      state.activity = state.activity || [];
      state.activity.unshift({ time: nowLabel(), text });
      if (state.activity.length > 300) state.activity.length = 300;
    });
  }
  function updateAgent(side, key, patch) {
    patchState(statePath, (state) => {
      const list = side === 'claude' ? state.claudeAgents : side === 'openai' ? state.openaiAgents : state.nvidiaAgents;
      const agent = (list || []).find((a) => a.key === key);
      if (agent) Object.assign(agent, patch);
    });
  }
  function updateArbiter(key, patch) {
    patchState(statePath, (state) => {
      const arb = (state.arbiters || []).find((a) => a.key === key);
      if (arb) Object.assign(arb, patch);
    });
  }

  const claudeClient = createClaudeClient();
  const outputContract = fs.readFileSync(path.join(__dirname, 'contracts', 'output-contract.md'), 'utf8');
  const { schemas: claudeSchemas, handlers: claudeHandlers } = buildClaudeToolset(scope, limits.run_command, contextPath);

  // --- Líder: kickoff (pesquisa rápida + monta o brief da rodada) ---
  // Antes dos 3 grupos rodarem, o Líder mesmo confere o código (e o
  // contexto extra, se houver) e produz o brief que os grupos vão receber
  // como tarefa — isso É a "liberação": não existe um gate separado
  // esperando aprovação humana no meio da rodada automática, o brief
  // pronto já é o sinal de "pode ir". Se o kickoff falhar, cai pra tarefa
  // original sem brief refinado — a rodada não trava por isso.
  updateArbiter('lider', { state: 'running', role: 'Pesquisando o código (e contexto extra, se houver) pra montar o brief da rodada.' });
  pushActivity('Líder começou o kickoff — vai definir o brief antes de liberar os grupos.');
  const kickoffTask =
    `Tarefa pedida pelo usuário para esta rodada do conselho:\n\n"${args.task}"\n\n` +
    `Antes de liberar os 3 grupos de especialistas (${claudeSpecs.length} Claude, ${openaiSpecs.length} OpenAI, ${nvidiaSpecs.length} NVIDIA/Hermes — todos recebem o MESMO brief que você produzir, já que as lentes Claude/OpenAI são espelhadas), faça uma pesquisa rápida: explore a estrutura geral do código no escopo (list_files, alguns read_file/grep pontuais)` +
    (contextPath ? ' e do contexto extra disponível (context_list_files/context_read_file/context_grep)' : '') +
    ` o suficiente pra entender o projeto e calibrar o brief — não precisa ser exaustivo, isso é trabalho dos especialistas depois.\n\n` +
    `Produza um BRIEF final (ainda não é o relatório, não há achados nesta etapa) que os 3 grupos vão receber como a tarefa deles. O brief deve: (1) esclarecer/expandir a tarefa original se ela for vaga, mantendo a intenção do usuário; (2) apontar, se você notou algo relevante na pesquisa rápida, onde os especialistas devem focar; (3) mencionar explicitamente se algo no contexto extra parece relevante (ex. uma decisão ou correção anterior relacionada), se houver contexto extra disponível. Responda SÓ com o texto do brief final, pronto pra ser repassado — sem preâmbulo, sem comentário sobre o processo.`;
  const kickoffResult = await runOneClaudeAgent({
    client: claudeClient, name: 'leader-kickoff', model: models.claude_leader,
    systemPrompt: buildSystemPrompt(loadPersona(claudeAgentsConfig.leader), outputContract, !!contextPath),
    task: kickoffTask, schemas: claudeSchemas, handlers: claudeHandlers,
    limits: limits.claude_leader_kickoff, outDir,
  });
  const roundTask = kickoffResult.status === 'ok' && kickoffResult.finalText.trim() ? kickoffResult.finalText.trim() : args.task;
  patchState(statePath, (state) => { state.roundBrief = kickoffResult.status === 'ok' ? kickoffResult.finalText : null; });
  updateArbiter('lider', {
    role: kickoffResult.status === 'ok'
      ? 'Brief pronto — grupos liberados, aguardando os relatórios.'
      : `Kickoff falhou (${kickoffResult.reason || kickoffResult.error || kickoffResult.status}) — grupos liberados com a tarefa original, sem brief refinado.`,
  });
  pushActivity(kickoffResult.status === 'ok' ? 'Líder liberou os 3 grupos — brief da rodada pronto.' : 'Líder não conseguiu montar o brief — seguindo com a tarefa original mesmo assim.');

  // --- lado Claude ---
  const claudeSidePromise = runClaudeSide({
    client: claudeClient, agentsConfig: { specialists: claudeSpecs, judge: claudeAgentsConfig.judge },
    models, limits, scope, task: roundTask, outDir: path.join(outDir, 'claude-side'), contextPath,
    onAgentUpdate: (name, u) => {
      if (u.state) {
        updateAgent('claude', name, { state: u.state, findings: u.findings ?? undefined, usage: u.usage, elapsed: u.elapsedMs ? fmtElapsed(u.elapsedMs) : undefined });
        if (u.state === 'running') pushActivity(`Claude · ${name} começou.`);
        if (u.state === 'done') pushActivity(`Claude · ${name} concluiu — ${u.findings ?? 0} achado(s).`);
        if (u.state === 'failed') pushActivity(`Claude · ${name} falhou.`);
        if (u.state === 'refused') pushActivity(`Claude · ${name} recusou a análise.`);
      }
    },
  }).then((r) => {
    updateArbiter('juiz-claude', { state: r.judge.status === 'ok' ? 'done' : r.judge.status, role: 'Consolidou os relatórios dos especialistas Claude.' });
    pushActivity(`Juiz Claude concluiu (status: ${r.judge.status}).`);
    return r;
  });

  // --- lado OpenAI ---
  // Só cria o client da API se algo realmente precisar dele — com o
  // provedor padrão (codex-local) isso nunca acontece.
  let openaiClient = null;
  try { openaiClient = createOpenaiClient(); } catch (e) { /* ok — provedor padrão não usa a API */ }
  const openaiSidePromise = runOpenaiSide({
    client: openaiClient, agentsConfig: { specialists: openaiSpecs, judge: openaiAgentsConfig.judge },
    models, limits, scope, task: roundTask, outDir: path.join(outDir, 'openai-side'), contextPath,
  }).then((r) => {
    // openai-side/src/orchestrator.js não expõe callback por agente (motor mais antigo,
    // sem live-update) — refletimos o resultado final de uma vez quando chega.
    r.specialists.forEach((res, i) => {
      const name = openaiSpecs[i]?.name;
      if (!name) return;
      updateAgent('openai', name, {
        state: res.status === 'ok' ? 'done' : res.status,
        findings: res.finalText ? extractFindingBlocks(res.finalText).length : 0,
        usage: res.usage, elapsed: res.elapsedMs ? fmtElapsed(res.elapsedMs) : undefined,
      });
      pushActivity(`GPT · ${name} concluiu (status: ${res.status}).`);
    });
    updateArbiter('juiz-openai', { state: r.judge.status === 'ok' ? 'done' : r.judge.status, role: 'Consolidou os relatórios dos especialistas GPT.' });
    pushActivity(`Juiz OpenAI concluiu (status: ${r.judge.status}).`);
    return r;
  });

  // --- Grupo NVIDIA/Hermes — roda em paralelo com Claude/OpenAI, não
  // depois: é um 3º grupo de especialistas (sem juiz próprio), não um
  // juiz. Se NVIDIA_API_KEY não estiver configurada, cada especialista
  // volta 'nvidia_key_missing' individualmente e a rodada segue normal.
  const nvidiaSidePromise = nvidiaSpecs.length
    ? runNvidiaSide({
        agentsConfig: { specialists: nvidiaSpecs }, models, limits, scope, task: roundTask,
        outDir: path.join(outDir, 'nvidia-side'), contextPath,
        onAgentUpdate: (name, u) => {
          if (u.state) {
            updateAgent('nvidia', name, { state: u.state, findings: u.findings ?? undefined, usage: u.usage, elapsed: u.elapsedMs ? fmtElapsed(u.elapsedMs) : undefined });
            if (u.state === 'running') pushActivity(`Hermes (NVIDIA) · ${name} começou.`);
            if (u.state === 'done') pushActivity(`Hermes (NVIDIA) · ${name} concluiu — ${u.findings ?? 0} achado(s).`);
            if (u.state === 'failed') pushActivity(`Hermes (NVIDIA) · ${name} falhou.`);
            if (u.state === 'skipped') pushActivity(`Hermes (NVIDIA) · ${name} pulado — chave não configurada.`);
          }
        },
      })
    : Promise.resolve({ specialists: [] });

  // marca todos como "running" já de cara — os três grupos rodam os especialistas
  // em paralelo internamente (Promise.allSettled), não dá pra saber o instante exato
  // que cada um começa sem instrumentar mais fundo; "running" desde o início é uma
  // aproximação honesta (todos disparam juntos).
  patchState(statePath, (state) => {
    (state.claudeAgents || []).forEach((a) => { a.state = 'running'; });
    (state.openaiAgents || []).forEach((a) => { a.state = 'running'; });
    (state.nvidiaAgents || []).forEach((a) => { a.state = 'running'; });
  });

  const [claudeSide, openaiSide, nvidiaSide] = await Promise.all([claudeSidePromise, openaiSidePromise, nvidiaSidePromise]);

  // --- Juiz NVIDIA (Sonnet 5, sobre o(s) relatório(s) bruto(s) do Hermes) —
  // agora simétrico com os outros dois: todo grupo tem juiz próprio. Sem
  // etapa de verificação adversarial separada — esse trabalho passou pro
  // Líder, sobre os três lados de uma vez (ver leader-synthesizer.md).
  updateArbiter('juiz-nvidia', { state: 'running', role: 'Consolidando o(s) relatório(s) do Hermes.' });
  pushActivity('Juiz NVIDIA começou.');
  const nvidiaOk = nvidiaSide.specialists.filter((r) => r.status === 'ok');
  const nvidiaDigest = nvidiaOk.length
    ? nvidiaOk.map((r) => `### Relatório de "${r.agent}"\n\n${r.finalText}`).join('\n\n---\n\n')
    : '(nenhum especialista do Grupo NVIDIA/Hermes concluiu com sucesso nesta rodada)';
  const judgeNvidiaResult = await runOneClaudeAgent({
    client: claudeClient, name: 'judge-nvidia', model: models.claude_verifier,
    systemPrompt: buildSystemPrompt(loadPersona(claudeAgentsConfig.judgeNvidia), outputContract, !!contextPath),
    task: `Relatório(s) bruto(s) do especialista Hermes:\n\n${nvidiaDigest}`,
    schemas: claudeSchemas, handlers: claudeHandlers, limits: limits.claude_verifier,
    outDir: path.join(outDir, 'claude-side'),
  });
  updateArbiter('juiz-nvidia', { state: judgeNvidiaResult.status === 'ok' ? 'done' : judgeNvidiaResult.status, role: 'Consolidou o relatório do Grupo NVIDIA/Hermes.' });
  pushActivity(`Juiz NVIDIA concluiu (status: ${judgeNvidiaResult.status}).`);

  patchState(statePath, (state) => {
    state.judgeReports = {
      claude: claudeSide.judge.status === 'ok' ? claudeSide.judge.finalText : `(status: ${claudeSide.judge.status})`,
      openai: openaiSide.judge.status === 'ok' ? openaiSide.judge.finalText : `(status: ${openaiSide.judge.status})`,
      nvidia: judgeNvidiaResult.status === 'ok' ? judgeNvidiaResult.finalText : `(status: ${judgeNvidiaResult.status})`,
    };
  });

  // --- líder / sintetizador — agora também faz a verificação cruzada dos
  // três lados (ver leader-synthesizer.md), não existe mais uma etapa
  // separada de verificação adversarial ---
  updateArbiter('lider', { state: 'running', role: 'Cruzando os três lados e conferindo achados de severidade alta.' });
  pushActivity('Líder/Sintetizador começou.');
  const leaderPersona = loadPersona(claudeAgentsConfig.leader);
  const leaderTask =
    `## Relatório do Juiz Claude\n\n${claudeSide.judge.status === 'ok' ? claudeSide.judge.finalText : `(status: ${claudeSide.judge.status})`}\n\n` +
    `## Relatório do Juiz OpenAI\n\n${openaiSide.judge.status === 'ok' ? openaiSide.judge.finalText : `(status: ${openaiSide.judge.status})`}\n\n` +
    `## Relatório do Juiz NVIDIA\n\n${judgeNvidiaResult.status === 'ok' ? judgeNvidiaResult.finalText : `(status: ${judgeNvidiaResult.status})`}\n\n` +
    `Produza o relatório final seguindo exatamente o formato pedido no seu prompt de sistema (headline, lede, blocos P0/P1/DESCARTADO, e uma seção de divergência não resolvida se houver).`;

  const leaderResult = await runOneClaudeAgent({
    client: claudeClient, name: 'leader-synthesizer', model: models.claude_leader,
    systemPrompt: buildSystemPrompt(leaderPersona, outputContract, !!contextPath),
    task: leaderTask, schemas: claudeSchemas, handlers: claudeHandlers,
    limits: limits.claude_leader || limits.claude_judge, outDir,
  });

  if (leaderResult.status === 'ok') {
    const parsed = parseLeaderOutput(leaderResult.finalText);
    patchState(statePath, (state) => {
      state.headline = parsed.headline; state.lede = parsed.lede;
      state.synthBlocks = parsed.synthBlocks; state.dissent = parsed.dissent;
    });
    fs.writeFileSync(path.join(outDir, 'FINAL_REPORT.md'), leaderResult.finalText);
  }
  updateArbiter('lider', { state: leaderResult.status === 'ok' ? 'done' : leaderResult.status, role: 'Síntese final entregue.' });
  pushActivity(`Líder/Sintetizador concluiu (status: ${leaderResult.status}).`);

  clearInterval(tickTimer);
  patchState(statePath, (state) => {
    state.run.status = 'done';
    state.run.elapsed = fmtElapsed(Date.now() - startedAt);
  });
  pushActivity('Rodada concluída.');
  console.log(`[orchestrate] rodada ${runId} concluída — ver ${outDir}`);
  }
}

// --- parser tolerante: o formato pedido no prompt do líder é o contrato,
// mas o parser não pode quebrar a rodada se o texto vier levemente diferente
// — nesse caso o painel simplesmente mostra menos detalhe, nunca trava.
function parseLeaderOutput(text) {
  const headline = (text.match(/^#\s+(.+)/m) || [, ''])[1].trim();
  const afterHeadline = text.split(/^#\s+.+$/m)[1] || '';
  const lede = (afterHeadline.trim().split(/\n##\s/)[0] || '').trim();

  const sectionRe = /^##\s+(.+)$/gm;
  const sections = [];
  let match; let lastIndex = 0; let lastTitle = null;
  while ((match = sectionRe.exec(text))) {
    if (lastTitle !== null) sections.push({ title: lastTitle, body: text.slice(lastIndex, match.index).trim() });
    lastTitle = match[1].trim(); lastIndex = sectionRe.lastIndex;
  }
  if (lastTitle !== null) sections.push({ title: lastTitle, body: text.slice(lastIndex).trim() });

  const tagFor = (title) => {
    const t = title.toLowerCase();
    if (t.includes('p0') || t.includes('bloqueia')) return 'P0 · BLOQUEIA';
    if (t.includes('p1') || t.includes('retorno')) return 'P1 · ALTO RETORNO';
    if (t.includes('descart')) return 'DESCARTADO';
    return null;
  };
  const synthBlocks = [];
  let dissent = null;
  for (const sec of sections) {
    const tag = tagFor(sec.title);
    if (tag) {
      const items = sec.body.split(/\n(?=-\s)/).filter((l) => l.trim().startsWith('-')).map((l) => {
        const clean = l.replace(/^-\s*/, '').trim();
        const parts = clean.split(/\s+—\s+/);
        return { text: parts[0], source: parts.slice(1).join(' — ') || '' };
      });
      synthBlocks.push({ tag, title: sec.title.replace(/^P[01]\s*·\s*/i, '').trim() || sec.title, items });
    } else if (sec.title.toLowerCase().includes('diverg')) {
      const lines = sec.body.split('\n').filter(Boolean);
      dissent = { text: lines[0] || sec.body, note: lines.slice(1).join(' ').trim() };
    }
  }
  return { headline, lede, synthBlocks, dissent };
}

main().catch((err) => {
  console.error('[orchestrate] erro fatal:', err);
  process.exit(1);
});
