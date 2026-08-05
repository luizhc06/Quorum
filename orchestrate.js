#!/usr/bin/env node
'use strict';
// Ponto de entrada de uma rodada Quorum completa e automática: os dois lados
// (Claude via claude-side/engine, OpenAI via openai-side/src) rodam em
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
const { runSolenneAgent } = require('./openai-side/src/providers/nvidia-solenne');

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
function chunkRoundRobin(items, n) {
  const chunks = Array.from({ length: n }, () => []);
  items.forEach((item, i) => chunks[i % n].push(item));
  return chunks;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.scope || !args.task || !args['run-id'] || !args.out) {
    console.error('Uso: node orchestrate.js --scope <dir> --task "<descrição>" --run-id <id> --out runs/<id> [--extra-agents \'{"claude":[...],"openai":[...]}\']');
    process.exit(1);
  }

  const runId = args['run-id'];
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const statePath = path.join(outDir, 'state.json');
  const scope = path.resolve(args.scope);
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

  const startedAt = Date.now();

  patchState(statePath, (state) => {
    state.run = {
      runId, round: 1, task: args.task, status: 'running',
      startedAt: new Date(startedAt).toISOString(),
      parallelism: `${claudeSpecs.length + openaiSpecs.length} agentes`,
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
    state.arbiters = [
      { key: 'juiz-claude', name: 'Juiz Claude', model: 'Opus 5 · com leitura', state: 'queued', role: 'Aguardando os especialistas Claude.', chips: [] },
      { key: 'juiz-openai', name: 'Juiz OpenAI', model: 'GPT-5.6 Sol · com leitura', state: 'queued', role: 'Aguardando os especialistas OpenAI.', chips: [] },
      { key: 'verificador', name: 'Verificação adversarial', model: 'Sonnet 5', state: 'queued', role: 'Aguardando o Juiz OpenAI.', chips: [] },
      { key: 'solenne', name: 'Solenne (NVIDIA)', model: 'Nemotron 3 Super · 3º parecer', state: 'queued', role: 'Aguardando os dois juízes.', chips: [] },
      { key: 'lider', name: 'Líder / Sintetizador', model: 'Opus 5', state: 'queued', role: 'Aguardando os dois lados.', chips: [] },
    ];
    state.claims = [];
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
      const list = side === 'claude' ? state.claudeAgents : state.openaiAgents;
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

  // --- lado Claude ---
  const claudeClient = createClaudeClient();
  const claudeSidePromise = runClaudeSide({
    client: claudeClient, agentsConfig: { specialists: claudeSpecs, judge: claudeAgentsConfig.judge },
    models, limits, scope, task: args.task, outDir: path.join(outDir, 'claude-side'),
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
    models, limits, scope, task: args.task, outDir: path.join(outDir, 'openai-side'),
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

  // marca todos como "running" já de cara — os dois motores rodam os especialistas
  // em paralelo internamente (Promise.allSettled), não dá pra saber o instante exato
  // que cada um começa sem instrumentar mais fundo; "running" desde o início é uma
  // aproximação honesta (todos disparam juntos).
  patchState(statePath, (state) => {
    (state.claudeAgents || []).forEach((a) => { a.state = 'running'; });
    (state.openaiAgents || []).forEach((a) => { a.state = 'running'; });
  });

  const [claudeSide, openaiSide] = await Promise.all([claudeSidePromise, openaiSidePromise]);

  // --- Solenne (NVIDIA, 3º parecer independente) — dispara em paralelo com a
  // verificação adversarial abaixo, já que as duas só dependem dos dois
  // juízes e não uma da outra; o await fica lá embaixo, perto do líder.
  updateArbiter('solenne', { state: 'running', role: 'Lendo os dois pareceres pra dar uma opinião independente.' });
  pushActivity('Solenne (NVIDIA) começou seu parecer.');
  const solennePromise = runSolenneAgent({
    persona: openaiAgentsConfig.solenne.foco,
    task:
      `## Relatório do Juiz Claude\n\n${claudeSide.judge.status === 'ok' ? claudeSide.judge.finalText : `(status: ${claudeSide.judge.status})`}\n\n` +
      `## Relatório do Juiz OpenAI\n\n${openaiSide.judge.status === 'ok' ? openaiSide.judge.finalText : `(status: ${openaiSide.judge.status})`}`,
    model: models.solenne_model,
  }).then((result) => {
    if (result.status === 'ok') {
      updateArbiter('solenne', { state: 'done', role: 'Deu seu parecer independente sobre os dois lados.' });
      pushActivity('Solenne (NVIDIA) concluiu seu parecer.');
    } else if (result.reason === 'nvidia_key_missing') {
      updateArbiter('solenne', { state: 'skipped', role: 'NVIDIA_API_KEY não configurada — fora desta rodada.' });
      pushActivity('Solenne (NVIDIA) pulada — chave não configurada.');
    } else {
      updateArbiter('solenne', { state: 'failed', role: `Falhou: ${result.error || result.reason}` });
      pushActivity(`Solenne (NVIDIA) falhou: ${result.error || result.reason}.`);
    }
    return result;
  });

  // --- verificação adversarial (Claude, sobre o relatório do Juiz OpenAI) ---
  updateArbiter('verificador', { state: 'running', role: 'Lendo o código pra confirmar ou refutar os achados do Juiz OpenAI.' });
  pushActivity('Verificação adversarial começou.');
  const outputContract = fs.readFileSync(path.join(__dirname, 'contracts', 'output-contract.md'), 'utf8');
  const { schemas: verifierSchemas, handlers: verifierHandlers } = buildClaudeToolset(scope, limits.run_command);
  const findingBlocks = openaiSide.judge.status === 'ok' ? extractFindingBlocks(openaiSide.judge.finalText) : [];
  const VERIFIER_COUNT = Math.min(3, Math.max(1, findingBlocks.length));
  const chunks = chunkRoundRobin(findingBlocks, VERIFIER_COUNT).filter((c) => c.length);

  let claims = [];
  if (chunks.length === 0) {
    updateArbiter('verificador', { state: 'done', role: 'Nada pra verificar — o Juiz OpenAI não produziu achados citáveis nesta rodada.' });
    pushActivity('Verificação adversarial encerrada — nenhum achado do lado OpenAI pra checar.');
  } else {
    const verifierPersona = loadPersona(claudeAgentsConfig.verifier);
    const verifierResults = await Promise.all(
      chunks.map((chunk, i) =>
        runOneClaudeAgent({
          client: claudeClient, name: `verificador-${i + 1}`, model: models.claude_verifier,
          systemPrompt: buildSystemPrompt(verifierPersona, outputContract),
          task: `Verifique os achados abaixo, um a um, no formato pedido:\n\n${chunk.join('\n\n---\n\n')}`,
          schemas: verifierSchemas, handlers: verifierHandlers, limits: limits.claude_verifier,
          outDir: path.join(outDir, 'claude-side'),
        })
      )
    );
    claims = parseVerifierOutput(verifierResults);
    patchState(statePath, (state) => { state.claims = claims; });
    updateArbiter('verificador', { state: 'done', role: `Verificou ${claims.length} afirmações do Juiz OpenAI.`, chips: [`${claims.length} checadas`] });
    pushActivity(`Verificação adversarial concluída — ${claims.length} afirmações checadas.`);
  }

  const solenneResult = await solennePromise;

  // --- líder / sintetizador ---
  updateArbiter('lider', { state: 'running', role: 'Cruzando os dois lados pra decidir o que vai para a síntese final.' });
  pushActivity('Líder/Sintetizador começou.');
  const leaderPersona = loadPersona(claudeAgentsConfig.leader);
  const leaderTask =
    `## Relatório do Juiz Claude\n\n${claudeSide.judge.status === 'ok' ? claudeSide.judge.finalText : `(status: ${claudeSide.judge.status})`}\n\n` +
    `## Relatório do Juiz OpenAI (com veredictos da verificação adversarial anexados)\n\n${openaiSide.judge.status === 'ok' ? openaiSide.judge.finalText : `(status: ${openaiSide.judge.status})`}\n\n` +
    (claims.length ? `## Veredictos da verificação adversarial\n\n${claims.map((c) => `- [${c.verdict}] ${c.text} — ${c.check}`).join('\n')}\n\n` : '') +
    (solenneResult.status === 'ok' ? `## Parecer da Solenne (3º voto, fornecedor independente — NVIDIA)\n\n${solenneResult.finalText}\n\n` : '') +
    `Produza o relatório final seguindo exatamente o formato pedido no seu prompt de sistema (headline, lede, blocos P0/P1/DESCARTADO, e uma seção de divergência não resolvida se houver). Se a Solenne discordou de algo que os outros dois juízes concordaram, trate isso como candidato a divergência não resolvida.`;

  const { schemas: leaderSchemas, handlers: leaderHandlers } = buildClaudeToolset(scope, limits.run_command);
  const leaderResult = await runOneClaudeAgent({
    client: claudeClient, name: 'leader-synthesizer', model: models.claude_leader,
    systemPrompt: buildSystemPrompt(leaderPersona, outputContract),
    task: leaderTask, schemas: leaderSchemas, handlers: leaderHandlers,
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

// --- parsers tolerantes: o formato pedido no prompt do líder é o contrato,
// mas o parser não pode quebrar a rodada se o texto vier levemente diferente
// — nesse caso o painel simplesmente mostra menos detalhe, nunca trava.
function parseVerifierOutput(results) {
  const claims = [];
  for (const r of results) {
    if (r.status !== 'ok' || !r.finalText) continue;
    const blocks = r.finalText.split(/\n(?=### )/).filter((b) => b.trim().startsWith('###'));
    for (const block of blocks) {
      const title = (block.match(/^###\s*(.+)/) || [, block.slice(0, 80)])[1].trim();
      const verdict = (block.match(/\*\*Veredicto:\*\*\s*(CONFIRMADO|PARCIAL|IMPROCEDENTE|NÃO VERIFICÁVEL)/i) || [, 'NÃO VERIFICÁVEL'])[1].toUpperCase();
      const evidencia = (block.match(/\*\*Evidência checada:\*\*\s*(.+)/) || [, ''])[1].trim();
      const justificativa = (block.match(/\*\*Justificativa:\*\*\s*(.+)/) || [, ''])[1].trim();
      claims.push({ text: title, origin: 'GPT · especialista', check: justificativa || evidencia || '(sem justificativa extraída)', verdict });
    }
  }
  return claims;
}

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
