'use strict';

const DEMO_RUN_ID = 'demo';
const POLL_MS = 3000;

/* ---------- dados demo (fallback quando não há nenhuma rodada real ainda) ---------- */

const DEMO = {
  run: {
    runId: 'a3f0-2608', round: 2, task: 'demo — exemplo ilustrativo, não é uma rodada real',
    status: 'done', parallelism: '4 especialistas em 4 especialidades', elapsed: '04:12', cost: 'US$ 0,38',
  },
  allocation: [
    { key: 'seguranca', models: ['claude-sonnet-5', 'gpt-5.6-terra'] },
    { key: 'dados', models: ['claude-sonnet-5'] },
    { key: 'docs-legibilidade', models: ['nvidia/nemotron-3-super-120b-a12b'] },
    { key: 'design-produto', models: ['kimi-k2.6:cloud'] },
  ],
  specialistAgents: [
    { key: 'seguranca', name: 'Segurança', model: 'claude-sonnet-5', engine: 'claude', provider: 'claude', group: 'claude', state: 'done', findings: 4, lens: 'Injeção, autenticação, segredos em texto plano.', elapsed: '1m 12s', usage: { inputTokens: 24100, outputTokens: 2800, estimatedUsd: 0.076 } },
    { key: 'seguranca__gpt-5-6-terra', name: 'Segurança', model: 'gpt-5.6-terra', engine: 'openai', provider: 'openai', group: 'openai', state: 'done', findings: 3, lens: 'Vulnerabilidades citáveis por arquivo e linha, segundo parecer independente.', elapsed: '1m 08s', usage: { inputTokens: 19800, outputTokens: 2200, estimatedUsd: 0.066 } },
    { key: 'dados', name: 'Dados', model: 'claude-sonnet-5', engine: 'claude', provider: 'claude', group: 'claude', state: 'done', findings: 3, lens: 'Modelagem, migrações, integridade referencial.', elapsed: '1m 20s', usage: { inputTokens: 26300, outputTokens: 2900, estimatedUsd: 0.082 } },
    { key: 'docs-legibilidade', name: 'Documentação & Legibilidade', model: 'nvidia/nemotron-3-super-120b-a12b', engine: 'nvidia', provider: 'nvidia', group: 'nvidia', state: 'done', findings: 1, lens: 'README/comentários batendo com o código real, nomes que escondem o que fazem.', elapsed: '31s', usage: { source: 'plano free NVIDIA (sem custo)' } },
    { key: 'design-produto', name: 'Qualidade & Design de Produto', model: 'kimi-k2.6:cloud', engine: 'community', provider: 'ollama', group: 'community', state: 'done', findings: 2, lens: 'Qualidade de produto, interface e refinamento visual.', elapsed: '39s', free: 'Ollama Cloud Free' },
  ],
  arbiters: [
    { key: 'juiz', name: 'Juiz', model: 'Opus 5 · com leitura', state: 'done', role: 'Consolidou os 5 relatórios, descartou 1 achado de baixa confiança, checou pessoalmente os de severidade alta antes de aceitar.', chips: ['5 relatórios lidos', '1 descartado', '6 confirmados'], usage: { inputTokens: 48200, outputTokens: 5100, estimatedUsd: 0.369 } },
    { key: 'lider', name: 'Líder / Sintetizador', model: 'Opus 5', state: 'done', role: 'Decidiu a alocação desta rodada, cruzou os relatórios, verificou pessoalmente os achados de severidade alta.', chips: ['6/7 pontos convergentes', '1 divergência aberta'], usage: { inputTokens: 22100, outputTokens: 2600, estimatedUsd: 0.176 } },
  ],
  debate: [
    { time: '14:02:11', author: 'Claude · segurança', side: 'claude', kind: 'afirmação',
      text: 'O endpoint /api/pedidos/buscar monta a query concatenando o parâmetro numero_nf diretamente — SQL injection confirmado, não é hipótese.',
      evidence: "app/Controllers/PedidoController.php:212 — \"WHERE numero_nf = '\" . $_GET['numero_nf'] . \"'\"" },
    { time: '14:02:47', author: 'GPT · segurança', side: 'openai', kind: 'confirmação',
      text: 'Confirmo lendo o mesmo arquivo. Testei o padrão de escape usado em outros 4 controllers do mesmo diretório — nenhum protege esse parâmetro específico, então não é um caso isolado.', evidence: null },
    { time: '14:03:30', author: 'Claude · dados', side: 'claude', kind: 'afirmação',
      text: 'Isso se soma a um problema estrutural: não há camada de acesso a dados única, cada controller escreve SQL cru. A correção pontual desse endpoint não resolve a classe do problema.', evidence: null },
    { time: '14:05:02', author: 'GPT · bug-hunter', side: 'openai', kind: 'contestação',
      text: 'Discordo que seja urgente introduzir uma camada de ORM agora — isso é reescrita grande, não um bloqueador de deploy. O bloqueador real é só o endpoint exposto.', evidence: null },
    { time: '14:05:41', author: 'Claude · arquitetura', side: 'claude', kind: 'concessão',
      text: 'Aceito — a camada de acesso a dados unificada vira melhoria P1, não P0. O que bloqueia deploy é só a injeção ativa e os segredos vazando no build, tratados separadamente.', evidence: null },
    { time: '14:07:15', author: 'Claude · infraestrutura-deploy', side: 'claude', kind: 'afirmação',
      text: 'O pipeline de build inclui o arquivo .env.production dentro do artefato final publicado — confirmei abrindo o zip gerado pelo último workflow do CI.',
      evidence: 'ci/build.yml:34 — "cp .env.production dist/" · artefato do último run inspecionado diretamente' },
    { time: '14:08:03', author: 'GPT · dependências', side: 'openai', kind: 'confirmação',
      text: 'Mesma conclusão a partir de outro ângulo: o .gitignore ignora .env.production no repositório, mas o step de build roda depois do checkout e copia o arquivo de um secret de CI para dentro do dist/ — o problema é o step, não o git.', evidence: null },
    { time: '14:10:22', author: 'Claude · dados', side: 'claude', kind: 'afirmação',
      text: 'Recomendo migrar o schema da tabela de eventos agora — o índice atual não escala para o volume que a arquitetura sugere que vem a seguir, e adiar aumenta o custo de migração depois.',
      evidence: 'schema/events.sql — índice composto ausente em (tipo, criado_em), tabela já em 2,1M linhas' },
    { time: '14:11:09', author: 'GPT · pesquisa', side: 'openai', kind: 'contestação',
      text: 'Sem dado de volume projetado, migrar agora é risco não justificado — é uma tabela quente, qualquer migração tem janela de lock. Prefiro esperar o próximo trimestre com um número real de eventos/dia.', evidence: null },
    { time: '14:12:40', author: 'Claude · arquitetura', side: 'claude', kind: 'impasse',
      text: 'Não temos como resolver isso lendo mais código — os dois lados têm evidência válida, e o desempate depende de uma projeção de negócio que nenhum agente tem. Isso vai para divergência aberta na síntese.', evidence: null },
  ],
  judgeReports: {
    unified: '## Resumo\nConsolidação dos 5 especialistas alocados nesta rodada (Claude, GPT, Nemotron e Kimi). 2 achados de severidade alta checados pessoalmente antes de aceitar; 1 achado descartado por falta de evidência.\n\n## Achados\n\n### SQL injection em /api/pedidos/buscar\n- Severidade: alto\n- Evidência: app/Controllers/PedidoController.php:212\n- Confiança: alta (reli o arquivo pessoalmente)\n- Origem: Segurança (Claude) + Segurança (GPT), segundo parecer independente confirmou o mesmo padrão em outros controllers\n\n### README desatualizado sobre o fluxo de reenvio\n- Severidade: baixo\n- Evidência: README.md:88\n- Confiança: média\n- Origem: Documentação & Legibilidade (Nemotron)\n\n(relatório completo omitido no exemplo demo)',
  },
  headline: 'Deploy pode seguir, com um bloqueio: segredos ainda saem no build.',
  lede: 'Os dois grupos convergiram em 9 dos 12 pontos materiais. A divergência que importa é sobre o custo de migrar o schema agora — e ela não é resolvível com leitura de código, precisa de um número seu.',
  synthBlocks: [
    { tag: 'P0 · BLOQUEIA', title: 'Antes de qualquer deploy',
      items: [
        { text: 'Corrigir a SQL injection em /api/pedidos/buscar — trocar concatenação por bind parameter. É exploração trivial, não teórica.', source: 'Claude · segurança + GPT · segurança, confirmado por verificação adversarial' },
        { text: 'Remover o passo do CI que copia .env.production para dentro do artefato publicado — segredo de produção sai no build hoje.', source: 'Claude · infraestrutura-deploy + GPT · dependências, confirmado por verificação adversarial' },
      ] },
    { tag: 'P1 · ALTO RETORNO', title: 'Depois do deploy, prioridade alta',
      items: [
        { text: 'Reduzir o timeout de sessão de 30 dias — desproporcional ao dado sensível que protege.', source: 'Claude · segurança, confirmado' },
        { text: 'Unificar o cálculo de frete duplicado em 3 controllers antes que a quarta cópia apareça.', source: 'GPT · melhorias, confirmado' },
        { text: 'Adicionar teste para o fluxo de reenvio de pedido original — hoje sem cobertura nenhuma.', source: 'Claude · QA, confirmado' },
        { text: 'Introduzir uma camada de acesso a dados única — não é bloqueio, mas o padrão atual (SQL cru por controller) é o que permitiu a injeção passar despercebida.', source: 'Claude · arquitetura, rebaixado de P0 durante o debate' },
      ] },
    { tag: 'DESCARTADO', title: 'Considerado e rejeitado',
      items: [
        { text: 'CVE na dependência travada — real, mas severidade baixa; entra no próximo ciclo normal de atualização, não é exceção.', source: 'GPT · dependências, rebaixado por verificação adversarial' },
        { text: 'Import não usado no módulo de relatórios — referência de arquivo/linha não confere, achado descartado.', source: 'GPT · dependências, refutado por verificação adversarial' },
      ] },
  ],
  dissent: {
    text: 'Migrar o schema de eventos agora (Claude/dados, Claude/arquitetura) ou congelar até o próximo trimestre (GPT/pesquisa, GPT/melhorias). Ambos os lados citam evidência válida; o desempate depende de quantos eventos/dia você espera em 6 meses.',
    note: 'o orquestrador para aqui e pergunta em vez de escolher — divergência silenciada é o pior resultado possível deste sistema.',
  },
  activity: [
    { time: '14:12', text: 'Claude · arquitetura marcou a migração de schema como impasse — indo para divergência aberta.' },
    { time: '14:11', text: 'GPT · pesquisa contestou a urgência da migração de eventos.' },
    { time: '14:10', text: 'Claude · dados propôs migrar o schema de eventos agora.' },
    { time: '14:08', text: 'GPT · dependências confirmou o vazamento de segredo por outro ângulo.' },
    { time: '14:07', text: 'Claude · infraestrutura-deploy encontrou .env.production no artefato de build.' },
    { time: '14:05', text: 'Claude · arquitetura rebaixou a camada de dados única para P1.' },
    { time: '14:05', text: 'GPT · bug-hunter contestou urgência de reescrita de acesso a dados.' },
    { time: '14:03', text: 'Claude · dados apontou ausência de camada de acesso a dados única.' },
    { time: '14:02', text: 'GPT · segurança confirmou o padrão de injeção em outros controllers.' },
    { time: '14:02', text: 'Claude · segurança abriu o debate com a SQL injection confirmada.' },
  ],
  decisions: {},
};

/* ---------- estado ---------- */

const STATE = {
  view: 'conselho',
  sel: null,
  draft: '',
  exportOpen: false,
  exportFormat: 'opus',
  copied: false,
  runsList: [],
  currentRunId: DEMO_RUN_ID,
  data: DEMO,
  pollTimer: null,
  editingNoteKey: null,
  providers: [],
  providersOpen: false,
  selectedProviders: new Set(['deepseek-local', 'kimi-free', 'antigravity-free']),
  settingsOpen: false,
  settingsLoaded: false,
  settingsSpecialties: [],
  settingsModelPool: [],
  settingsProviderModels: { openrouter: [], omniroute: [] },
  settingsDraft: { judgeModel: '', leaderModel: '', pinned: {}, maxSpecialtiesPerRound: 6, omnirouteBaseUrl: '', customModels: [] },
  selTab: 'findings',
  liveSource: null,
  liveKey: null,
  liveLines: [],
  chatThread: [],
  chatSending: false,
  playgroundOpen: false,
  playgroundSessionId: null,
  playgroundThread: [],
  playgroundSending: false,
};

const STAGES = [
  { key: 'conselho', num: '01', title: 'Alocação dinâmica', state: () => {
    const all = STATE.data.specialistAgents || [];
    const total = all.length;
    const done = all.filter(a => a.state === 'done').length;
    return total ? `${total} especialista(s) · ${done} concluído(s)` : 'aguardando alocação';
  } },
  { key: 'debate', num: '02', title: 'Debate cruzado', state: () => `${(STATE.data.debate || []).length} mensagens` },
  { key: 'verify', num: '04', title: 'Juiz', state: () => (STATE.data.judgeReports || {}).unified ? '1/1 relatório' : 'aguardando' },
  { key: 'synth', num: '05', title: 'Síntese', state: () => STATE.data.headline ? (STATE.data.dissent ? '1 divergência aberta' : 'sem divergência') : 'aguardando' },
];

/* ---------- helpers ---------- */

function stateColor(state) {
  if (state === 'done') return 'var(--green-3)';
  if (state === 'running') return 'var(--amber)';
  if (state === 'failed' || state === 'refused') return 'var(--red-2)';
  if (state === 'skipped') return 'var(--text-5)';
  return 'var(--text-9)';
}
function stateLabel(state) {
  if (state === 'done') return 'CONCLUÍDO';
  if (state === 'running') return 'EM ANDAMENTO';
  if (state === 'failed') return 'FALHOU';
  if (state === 'refused') return 'RECUSOU';
  if (state === 'skipped') return 'PULADA';
  return 'NA FILA';
}
function verdictColor(verdict) {
  if (verdict === 'CONFIRMADO') return { color: 'var(--green-3)', border: '#2f4527' };
  if (verdict === 'PARCIAL') return { color: 'var(--amber)', border: '#4a3b22' };
  if (verdict === 'IMPROCEDENTE') return { color: 'var(--red-2)', border: '#4a2a20' };
  return { color: 'var(--text-5)', border: 'var(--border-5)' };
}
function tagColor(tag) {
  if (tag.startsWith('P0')) return { color: 'var(--red-2)', border: '#4a2a20' };
  if (tag.startsWith('P1')) return { color: 'var(--amber)', border: '#4a3b22' };
  return { color: 'var(--text-5)', border: 'var(--border-5)' };
}
function findingsFor(key) {
  const claims = STATE.data.claims || [];
  const agent = (STATE.data.specialistAgents || []).find(a => a.key === key);
  if (!agent || !agent.findings) return [];
  const firstName = agent.name.toLowerCase().split(' ')[0];
  return claims.filter(c => c.origin.toLowerCase().includes(firstName)).slice(0, agent.findings);
}
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function emptyState(text) {
  const box = el('div', 'empty-state', escapeHtml(text));
  return box;
}

/* ---------- carregamento de rodadas ---------- */

async function loadRunsList() {
  try {
    const res = await fetch('/api/runs');
    STATE.runsList = res.ok ? await res.json() : [];
  } catch (e) {
    STATE.runsList = [];
  }
  populateRunSelector();
}

function populateRunSelector() {
  const sel = document.getElementById('runSelector');
  const current = STATE.currentRunId;
  sel.innerHTML = '';
  const demoOpt = el('option', null, 'demo — exemplo mockado');
  demoOpt.value = DEMO_RUN_ID;
  sel.appendChild(demoOpt);
  STATE.runsList.forEach(r => {
    const statusLabel = r.status === 'done' ? 'concluída' : r.status === 'failed' ? 'falhou' : 'em andamento';
    const opt = el('option', null, `${r.runId} — ${statusLabel}`);
    opt.value = r.runId;
    sel.appendChild(opt);
  });
  sel.value = current;
}

async function loadRun(runId) {
  stopPolling();
  STATE.currentRunId = runId;
  STATE.view = 'conselho';
  STATE.sel = null;
  populateRunSelector();
  if (runId === DEMO_RUN_ID) {
    STATE.data = DEMO;
    render();
    return;
  }
  try {
    const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
    if (res.ok) {
      STATE.data = normalizeRunData(await res.json());
      render();
      startPolling();
    }
  } catch (e) {
    // rodada pode ter sumido ou state.json estar sendo escrito — mantém o que já tinha na tela
  }
}

// Refaz só o fetch do state.json atual e renderiza — usado depois de uma
// ação de controle (pausar/cancelar/trocar modelo), pra refletir na hora
// sem esperar o próximo tick do polling nem resetar view/seleção como
// loadRun() faria.
async function refreshCurrentRun() {
  if (STATE.currentRunId === DEMO_RUN_ID) return;
  try {
    const res = await fetch(`/api/runs/${encodeURIComponent(STATE.currentRunId)}`);
    if (res.ok) { STATE.data = normalizeRunData(await res.json()); render(); }
  } catch (e) { /* o próximo tick do polling cobre */ }
}

function normalizeRunData(raw) {
  // specialistAgents é o formato atual (um array só, qualquer proveniência).
  // Runs gravadas pela arquitetura antiga (grupos fixos por fornecedor)
  // caem no fallback abaixo, achatando os 4 arrays separados num só —
  // assim uma rodada antiga ainda abre no painel em vez de aparecer vazia.
  const specialistAgents = raw.specialistAgents || [
    ...(raw.claudeAgents || []).map(a => ({ ...a, group: 'claude', provider: 'claude' })),
    ...(raw.openaiAgents || []).map(a => ({ ...a, group: 'openai', provider: 'openai' })),
    ...(raw.nvidiaAgents || []).map(a => ({ ...a, group: 'nvidia', provider: 'nvidia' })),
    ...(raw.communityAgents || []).map(a => ({ ...a, group: 'community', provider: a.provider || 'community' })),
  ];
  const judgeReports = raw.judgeReports && raw.judgeReports.unified !== undefined
    ? raw.judgeReports
    : { unified: [raw.judgeReports?.claude, raw.judgeReports?.openai, raw.judgeReports?.nvidia, raw.judgeReports?.community].filter(Boolean).join('\n\n---\n\n') };
  return {
    run: raw.run || {},
    specialistAgents,
    arbiters: raw.arbiters || [],
    judgeReports,
    debate: raw.debate || [],
    claims: raw.claims || [],
    headline: raw.headline || '',
    lede: raw.lede || '',
    synthBlocks: raw.synthBlocks || [],
    dissent: raw.dissent || null,
    activity: raw.activity || [],
    decisions: raw.decisions || {},
    allocation: raw.allocation || null,
    roundBrief: raw.roundBrief || null,
  };
}

function startPolling() {
  stopPolling();
  STATE.pollTimer = setInterval(async () => {
    if (STATE.currentRunId === DEMO_RUN_ID) return stopPolling();
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(STATE.currentRunId)}`);
      if (!res.ok) return;
      const fresh = normalizeRunData(await res.json());
      STATE.data = fresh;
      render();
      if (fresh.run.status === 'done' || fresh.run.status === 'failed') stopPolling();
    } catch (e) { /* tenta de novo no próximo tick */ }
  }, POLL_MS);
}
function stopPolling() {
  if (STATE.pollTimer) { clearInterval(STATE.pollTimer); STATE.pollTimer = null; }
}

/* ---------- render: header/nav ---------- */

function computeTokenTotals(data) {
  let grandTotal = 0, totalCost = 0;
  const allAgents = [...(data.specialistAgents || []), ...(data.arbiters || [])];
  allAgents.forEach((a) => {
    if (!a.usage) return;
    grandTotal += (a.usage.inputTokens || 0) + (a.usage.outputTokens || 0);
    totalCost += a.usage.estimatedUsd || 0;
  });
  return { grandTotal, totalCost };
}
function fmtTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function renderHeader() {
  const r = STATE.data.run || {};
  document.getElementById('runId').textContent = r.runId || '—';
  document.getElementById('round').textContent = r.round ?? '—';
  document.getElementById('parallelism').textContent = r.parallelism || '—';
  document.getElementById('elapsed').textContent = r.elapsed || '—';
  document.getElementById('cost').textContent = r.cost || '—';
  document.getElementById('runIdHint').textContent = r.runId || '—';

  const totals = computeTokenTotals(STATE.data);
  document.getElementById('tokensTotal').textContent = totals.grandTotal ? fmtTokens(totals.grandTotal) : '—';
  const specialists = STATE.data.specialistAgents || [];
  const distinctProviders = new Set(specialists.map((a) => a.provider || a.group).filter(Boolean));
  document.getElementById('statSpecialists').textContent = specialists.length ? String(specialists.length) : '—';
  document.getElementById('statProviders').textContent = distinctProviders.size ? String(distinctProviders.size) : '—';

  const dot = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  const isDemo = STATE.currentRunId === DEMO_RUN_ID;
  dot.classList.toggle('demo', isDemo);
  dot.classList.toggle('failed', !isDemo && r.status === 'failed');
  label.textContent = isDemo ? 'demo' : r.status === 'done' ? 'concluída' : r.status === 'failed' ? 'falhou' : 'ao vivo';
  const ready = STATE.providers.filter((provider) => provider.available).length;
  const providerCount = document.getElementById('providerCount');
  if (providerCount) providerCount.textContent = STATE.providers.length ? `${ready}/${STATE.providers.length} prontos` : 'verificando';
}

function renderTabs() {
  const wrap = document.getElementById('stageTabs');
  wrap.innerHTML = '';
  STAGES.forEach(s => {
    const btn = el('button', 'stage-btn');
    const active = STATE.view === s.key;
    btn.innerHTML = `
      <span class="stage-num">${s.num}</span>
      <span class="stage-labels">
        <span class="stage-title" style="color:${active ? '#f2ece0' : '#b5ad9d'}">${s.title}</span>
        <span class="stage-state" style="color:${active ? 'var(--accent-2)' : 'var(--text-9)'}">${s.state()}</span>
      </span>
      ${active ? '<span class="stage-active-bar"></span>' : ''}`;
    btn.addEventListener('click', () => { STATE.view = s.key; STATE.sel = null; render(); });
    wrap.appendChild(btn);
  });
}

/* ---------- render: view 01 conselho ---------- */

async function controlAction(action, key, body) {
  try {
    const res = await fetch(`/api/runs/${encodeURIComponent(STATE.currentRunId)}/agents/${encodeURIComponent(key)}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function agentCard(agent, side) {
  // <div>, não <button> — os controles (pausar/cancelar/trocar modelo) têm
  // seus próprios <button>/<select>, e aninhar elemento interativo dentro de
  // <button> é HTML inválido (o navegador "escapa" o filho pra fora, quebrando clique).
  const card = el('div', `agent-card${side === 'openai' ? ' openai' : side === 'nvidia' ? ' nvidia' : side === 'community' ? ' community' : ''}${agent.state === 'running' ? ' is-running' : ''}`);
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  const isDemo = STATE.currentRunId === DEMO_RUN_ID;
  const modelOptions = STATE.settingsModelPool.length
    ? STATE.settingsModelPool.map((m) => `<option value="${escapeHtml(m.id)}" ${m.id === agent.model ? 'selected' : ''}>${escapeHtml(m.label || m.id)}</option>`).join('')
    : '';
  card.innerHTML = `
    <div class="agent-top">
      <span class="agent-dot" style="background:${stateColor(agent.state)}"></span>
      <div class="agent-mid">
        <span class="agent-name">${escapeHtml(agent.name)}</span>
        <span class="agent-state" style="color:${stateColor(agent.state)}">${stateLabel(agent.state)}</span>
      </div>
      <span class="agent-findings">${agent.findings ?? 0}</span>
    </div>
    <div class="agent-lens">${escapeHtml(agent.lens || '')}</div>
    <div class="agent-foot"><span>${escapeHtml(agent.model || '')}</span><span>${escapeHtml(agent.elapsed || '')}</span></div>
    ${!isDemo && agent.state === 'running' ? `
    <div class="agent-controls">
      <button class="agent-ctrl-btn" data-act="pause" title="Pausa (recomeça do zero se retomar)">PAUSAR</button>
      <button class="agent-ctrl-btn" data-act="cancel" title="Cancela de vez">CANCELAR</button>
      ${modelOptions ? `<select class="agent-ctrl-select" data-act="reassign">${modelOptions}</select>` : ''}
    </div>` : ''}
    ${!isDemo && agent.state === 'paused' ? `
    <div class="agent-controls">
      <button class="agent-ctrl-btn" data-act="resume" title="Recomeça do zero">RETOMAR</button>
    </div>` : ''}`;
  card.addEventListener('click', (e) => {
    if (e.target.closest('.agent-controls')) return;
    STATE.sel = { ...agent, side };
    STATE.selTab = 'findings';
    render();
  });
  card.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.agent-controls')) {
      e.preventDefault();
      STATE.sel = { ...agent, side };
      STATE.selTab = 'findings';
      render();
    }
  });
  const controls = card.querySelector('.agent-controls');
  if (controls) {
    controls.addEventListener('click', (e) => e.stopPropagation());
    const pauseBtn = controls.querySelector('[data-act="pause"]');
    const cancelBtn = controls.querySelector('[data-act="cancel"]');
    const resumeBtn = controls.querySelector('[data-act="resume"]');
    const reassignSel = controls.querySelector('[data-act="reassign"]');
    pauseBtn?.addEventListener('click', async () => { await controlAction('pause', agent.key); await refreshCurrentRun(); });
    cancelBtn?.addEventListener('click', async () => { await controlAction('cancel', agent.key); await refreshCurrentRun(); });
    resumeBtn?.addEventListener('click', async () => { await controlAction('resume', agent.key); await refreshCurrentRun(); });
    reassignSel?.addEventListener('change', async () => { await controlAction('reassign', agent.key, { model: reassignSel.value }); await refreshCurrentRun(); });
  }
  return card;
}

function renderConselho() {
  const container = document.getElementById('view-conselho');
  const specialists = STATE.data.specialistAgents || [];
  if (!specialists.length) {
    container.innerHTML = '';
    container.appendChild(emptyState('Nenhuma rodada iniciada ainda para este run. O painel atualiza sozinho assim que o Líder decidir a alocação e os especialistas começarem.'));
    return;
  }

  const grid = document.getElementById('specialistGrid'); grid.innerHTML = '';
  specialists.forEach(a => grid.appendChild(agentCard(a, a.group || a.provider)));
  document.getElementById('specialistDone').textContent = `${specialists.filter(a => a.state === 'done').length}/${specialists.length} concluídos`;
  const sub = document.getElementById('allocationSub');
  if (sub) {
    const specialtyCount = new Set(specialists.map((a) => a.specialty || a.key)).size;
    sub.textContent = `${specialists.length} especialista(s) em ${specialtyCount} especialidade(s) — decidido pelo Líder nesta rodada`;
  }

  const aGrid = document.getElementById('arbiterGrid'); aGrid.innerHTML = '';
  STATE.data.arbiters.forEach(a => {
    const card = el('div', 'arbiter-card');
    card.innerHTML = `
      <div class="arbiter-top">
        <span class="arbiter-name">${escapeHtml(a.name)}</span>
        <span class="arbiter-state" style="color:${stateColor(a.state)}">${stateLabel(a.state)}</span>
      </div>
      <span class="arbiter-model">${escapeHtml(a.model || '')}</span>
      <div class="arbiter-role">${escapeHtml(a.role || '')}</div>
      <div class="chip-row">${(a.chips || []).map(c => `<span class="chip">${escapeHtml(c)}</span>`).join('')}</div>`;
    aGrid.appendChild(card);
  });
}

/* ---------- render: view 02 debate ---------- */

function renderDebate() {
  const view = document.getElementById('view-debate');
  const debate = STATE.data.debate || [];
  if (!debate.length) {
    view.innerHTML = '';
    view.appendChild(emptyState('Sem mensagens de debate nesta rodada. O protocolo de debate multi-turno entre os dois lados ainda não está implementado no backend real (ver claude-side/ORCHESTRATION.md) — esta tela funciona com dados reais assim que essa peça existir.'));
    return;
  }
  view.innerHTML = `
    <div class="debate-wrap">
      <p class="debate-lede">Cada afirmação entra no debate com a evidência anexada. Quem não cita arquivo, linha ou comando não é citável na síntese.</p>
      <div id="debateList"></div>
    </div>`;
  const wrap = document.getElementById('debateList');
  debate.forEach(m => {
    const borderColor = m.side === 'claude' ? '#6b4f33' : '#2c4a5c';
    const authorColor = m.side === 'claude' ? 'var(--accent-2)' : 'var(--blue)';
    const row = el('div', 'debate-msg');
    row.innerHTML = `
      <span class="debate-time">${escapeHtml(m.time || '')}</span>
      <div class="debate-body" style="border-left-color:${borderColor}">
        <div class="debate-head">
          <span class="debate-author" style="color:${authorColor}">${escapeHtml((m.author || '').toUpperCase())}</span>
          <span class="debate-kind">${escapeHtml(m.kind || '')}</span>
        </div>
        <div class="debate-text">${escapeHtml(m.text || '')}</div>
        ${m.evidence ? `<div class="debate-evidence">${escapeHtml(m.evidence)}</div>` : ''}
      </div>`;
    wrap.appendChild(row);
  });
}

/* ---------- render: view 04 verify ---------- */

function renderVerify() {
  const view = document.getElementById('view-verify');
  const jr = STATE.data.judgeReports || {};
  if (!jr.unified) {
    view.innerHTML = '';
    view.appendChild(emptyState('O Juiz ainda não concluiu nesta rodada. Esta tela popula assim que ele terminar.'));
    return;
  }
  view.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">
      <p class="verify-lede">O Juiz consolida os relatórios de todos os especialistas alocados nesta rodada (podem vir de fornecedores diferentes) antes da síntese final do Líder — não há mais um juiz por fornecedor.</p>
      <div id="judgeReportPanels" style="display:flex;flex-direction:column;gap:14px"></div>
    </div>`;
  const wrap = document.getElementById('judgeReportPanels');
  const card = el('div', 'judge-report-card');
  card.style.cssText = 'border:1px solid var(--border-2);border-radius:8px;padding:14px 16px;background:var(--bg-6)';
  card.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:var(--accent-2);margin-bottom:8px">Juiz — relatório consolidado</div>
    <div style="white-space:pre-wrap;font-size:12.5px;line-height:1.6;color:var(--text-3);max-height:480px;overflow-y:auto">${escapeHtml(jr.unified)}</div>`;
  wrap.appendChild(card);
}

/* ---------- decisões (implementar / revisar) por item de síntese ---------- */

async function saveDecision(key, status, note) {
  STATE.data.decisions = STATE.data.decisions || {};
  if (status === null) {
    delete STATE.data.decisions[key];
  } else {
    STATE.data.decisions[key] = { status, note: note || '', updatedAt: 'agora' };
  }
  STATE.editingNoteKey = null;
  render();
  if (STATE.currentRunId === DEMO_RUN_ID) return; // demo é só local, nada pra persistir
  try {
    await fetch(`/api/runs/${encodeURIComponent(STATE.currentRunId)}/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, status, note: note || '' }),
    });
  } catch (e) {
    // fica salvo localmente na tela; próxima rodada de polling pode sobrescrever se a escrita falhou
  }
}

function renderSynthItem(it, key) {
  const row = el('div', 'synth-item');
  row.innerHTML = `
    <div class="synth-item-text">${escapeHtml(it.text || '')}</div>
    <div class="synth-item-source">${escapeHtml(it.source || '')}</div>`;

  const decision = (STATE.data.decisions || {})[key];
  const actions = el('div', 'item-actions');

  if (STATE.editingNoteKey === key) {
    const noteRow = el('div', 'item-note-row');
    noteRow.innerHTML = `<input type="text" placeholder="O que não gostou ou por que não precisa…" id="noteInput-${key}">`;
    const saveBtn = el('button', null, 'Salvar');
    saveBtn.addEventListener('click', () => {
      const val = document.getElementById(`noteInput-${key}`).value.trim();
      saveDecision(key, 'revisar', val);
    });
    noteRow.appendChild(saveBtn);
    actions.appendChild(noteRow);
    row.appendChild(actions);
    return row;
  }

  if (!decision) {
    const implBtn = el('button', 'item-btn implementar', 'Implementar');
    implBtn.addEventListener('click', () => saveDecision(key, 'implementar', ''));
    const revBtn = el('button', 'item-btn revisar', 'Revisar');
    revBtn.addEventListener('click', () => { STATE.editingNoteKey = key; render(); });
    actions.appendChild(implBtn);
    actions.appendChild(revBtn);
  } else if (decision.status === 'implementar') {
    const pill = el('span', 'item-pill implementar', '✓ Implementar <span class="undo">· desfazer</span>');
    pill.addEventListener('click', () => saveDecision(key, null, ''));
    actions.appendChild(pill);
  } else if (decision.status === 'revisar') {
    const pill = el('span', 'item-pill revisar', '⚑ Revisar <span class="undo">· desfazer</span>');
    pill.addEventListener('click', () => saveDecision(key, null, ''));
    actions.appendChild(pill);
    if (decision.note) {
      row.appendChild(actions);
      const note = el('div', 'item-note', escapeHtml(decision.note));
      row.appendChild(note);
      return row;
    }
  }
  row.appendChild(actions);
  return row;
}

/* ---------- render: view 05 synth ---------- */

function renderSynth() {
  const view = document.getElementById('view-synth');
  if (!STATE.data.headline) {
    view.innerHTML = '';
    view.appendChild(emptyState('Ainda não há síntese final nesta rodada — aguardando o Líder/Sintetizador concluir.'));
    return;
  }
  view.innerHTML = `
    <article class="synth-wrap">
      <div>
        <div class="synth-top-row">
          <div class="synth-eyebrow">SÍNTESE · LÍDER</div>
          <button class="btn-export" id="btnExport">EXTRAIR RELATÓRIO RESUMIDO</button>
        </div>
        <h2 class="synth-headline">${escapeHtml(STATE.data.headline)}</h2>
        <p class="synth-lede">${escapeHtml(STATE.data.lede || '')}</p>
      </div>
      <div id="synthBlocks"></div>
      <div id="dissentBox"></div>
    </article>`;
  document.getElementById('btnExport').addEventListener('click', () => { STATE.exportOpen = true; STATE.copied = false; render(); });

  const wrap = document.getElementById('synthBlocks');
  (STATE.data.synthBlocks || []).forEach((b, blockIdx) => {
    const tc = tagColor(b.tag);
    const block = el('div', 'synth-block');
    const head = el('div', 'synth-block-head', `
      <span class="synth-tag" style="color:${tc.color};border-color:${tc.border}">${escapeHtml(b.tag || '')}</span>
      <h3>${escapeHtml(b.title || '')}</h3>`);
    block.appendChild(head);
    (b.items || []).forEach((it, itemIdx) => {
      block.appendChild(renderSynthItem(it, `${blockIdx}-${itemIdx}`));
    });
    wrap.appendChild(block);
  });

  const dissentBox = document.getElementById('dissentBox');
  if (STATE.data.dissent) {
    dissentBox.className = 'dissent-box';
    dissentBox.innerHTML = `
      <div class="dissent-eyebrow">DIVERGÊNCIA NÃO RESOLVIDA</div>
      <div class="dissent-text">${escapeHtml(STATE.data.dissent.text || '')}</div>
      <div class="dissent-note">${escapeHtml(STATE.data.dissent.note || '')}</div>`;
  } else {
    dissentBox.className = '';
    dissentBox.innerHTML = '';
  }
}

/* ---------- render: sidebar ---------- */

function renderSidebar() {
  const selPanel = document.getElementById('selectionPanel');
  const actPanel = document.getElementById('activityPanel');

  if (STATE.sel) {
    selPanel.style.display = 'flex';
    selPanel.style.flexDirection = 'column';
    selPanel.style.gap = '14px';
    actPanel.style.display = 'none';

    const a = STATE.sel;
    const findings = findingsFor(a.key);
    const eyebrowColor = a.side === 'claude' ? 'var(--accent-2)' : a.side === 'openai' ? 'var(--blue)' : a.side === 'nvidia' ? 'var(--nvidia)' : 'var(--community)';
    const isDemo = STATE.currentRunId === DEMO_RUN_ID;
    const tabs = [
      { key: 'findings', label: 'ACHADOS' },
      { key: 'live', label: 'AO VIVO' },
      { key: 'chat', label: 'CHAT' },
    ];
    selPanel.innerHTML = `
      <div class="sel-head">
        <div>
          <div class="sel-eyebrow" style="color:${eyebrowColor}">${escapeHtml((a.provider || a.side || '').toUpperCase())}</div>
          <div class="sel-name">${escapeHtml(a.name)}</div>
          <div class="sel-meta">${escapeHtml(a.model || '')} · ${stateLabel(a.state)}</div>
          ${a.usage?.cacheReadTokens ? `<div class="sel-meta" style="color:var(--green-3)">${fmtTokens(a.usage.cacheReadTokens)} tokens do cache (economizou ~US$ ${a.usage.cacheSavedUsd?.toFixed(3) ?? '0'})</div>` : ''}
        </div>
        <button class="btn-close" id="btnCloseSel">FECHAR</button>
      </div>
      <div class="sel-lens">${escapeHtml(a.lens || '')}</div>
      <div class="hr"></div>
      ${isDemo ? '' : `<div class="sel-tabs">${tabs.map((t) => `<button class="sel-tab-btn${STATE.selTab === t.key ? ' active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}</div>`}
      <div id="selTabBody"></div>`;

    const body = selPanel.querySelector('#selTabBody');
    const effectiveTab = isDemo ? 'findings' : STATE.selTab;

    if (effectiveTab === 'findings') {
      body.innerHTML = `<div class="activity-eyebrow">ACHADOS (${a.findings ?? 0})</div><div style="display:flex;flex-direction:column;gap:9px;margin-top:9px" id="selFindings"></div>`;
      const findWrap = body.querySelector('#selFindings');
      if (findings.length === 0 && a.findings > 0) {
        findWrap.innerHTML = `<div class="sel-lens">Detalhe consolidado no relatório do juiz — ainda não desmembrado por afirmação individual.</div>`;
      } else if (findings.length === 0) {
        findWrap.innerHTML = `<div class="sel-lens">Nenhum achado reportado por este agente.</div>`;
      } else {
        findings.forEach(f => {
          const vc = verdictColor(f.verdict);
          const card = el('div', 'finding-card');
          card.innerHTML = `
            <div class="finding-top"><span class="sev-pill" style="color:${vc.color};border-color:${vc.border}">${escapeHtml(f.verdict || '')}</span></div>
            <div class="finding-text">${escapeHtml(f.text || '')}</div>
            <div class="finding-at">${escapeHtml(f.origin || '')}</div>`;
          findWrap.appendChild(card);
        });
      }
    } else if (effectiveTab === 'live') {
      renderLivePanel(body, a);
    } else if (effectiveTab === 'chat') {
      renderChatPanel(body, a);
    }

    selPanel.querySelectorAll('.sel-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        if (tab === STATE.selTab) return;
        STATE.selTab = tab;
        if (tab === 'live') openLiveStream(a.key); else closeLiveStream();
        if (tab === 'chat') loadChatThread(a.key);
        render();
      });
    });
    document.getElementById('btnCloseSel').addEventListener('click', () => { closeLiveStream(); STATE.sel = null; render(); });
  } else {
    selPanel.style.display = 'none';
    actPanel.style.display = 'block';
    const list = document.getElementById('activityList');
    list.innerHTML = '';
    const activity = STATE.data.activity || [];
    if (!activity.length) {
      list.appendChild(emptyState('Sem atividade registrada ainda.'));
    } else {
      activity.forEach(a => {
        const item = el('div', 'activity-item');
        item.innerHTML = `<span class="activity-time">${escapeHtml(a.time || '')}</span><span class="activity-text">${escapeHtml(a.text || '')}</span>`;
        list.appendChild(item);
      });
    }
  }
}

/* ---------- painel "Ao vivo" (SSE) ---------- */

function openLiveStream(key) {
  closeLiveStream();
  STATE.liveKey = key;
  STATE.liveLines = [];
  try {
    const es = new EventSource(`/api/runs/${encodeURIComponent(STATE.currentRunId)}/stream?key=${encodeURIComponent(key)}`);
    es.onmessage = (ev) => {
      let evt;
      try { evt = JSON.parse(ev.data); } catch (e) { return; }
      STATE.liveLines.push(evt);
      if (STATE.liveLines.length > 400) STATE.liveLines.shift();
      if (STATE.sel && STATE.sel.key === key && STATE.selTab === 'live') {
        const body = document.getElementById('selTabBody');
        if (body) renderLivePanel(body, STATE.sel);
      }
    };
    es.onerror = () => { /* o navegador tenta reconectar sozinho; se a rodada acabou, o servidor fecha e paramos de tentar ao trocar de aba/seleção */ };
    STATE.liveSource = es;
  } catch (e) { /* EventSource indisponível — painel mostra vazio */ }
}
function closeLiveStream() {
  STATE.liveSource?.close();
  STATE.liveSource = null;
  STATE.liveKey = null;
}

function liveLineLabel(evt) {
  if (evt.type === 'text-delta') return { cls: '', text: evt.text };
  if (evt.type === 'tool-call-start') return { cls: 'tool', text: `→ ${evt.tool}(${evt.argsPreview || ''})` };
  if (evt.type === 'tool-call-result') return { cls: 'tool-result', text: `← ${evt.tool} (${evt.resultChars ?? 0} chars)` };
  if (evt.type === 'state-change') return { cls: 'tool-result', text: `[estado: ${evt.state}]` };
  if (evt.type === 'done') return { cls: 'tool-result', text: `[concluído: ${evt.status}]` };
  if (evt.type === 'chat-done') return { cls: '', text: evt.text };
  return null;
}

function renderLivePanel(body, agent) {
  const isRunning = agent.state === 'running';
  body.innerHTML = `
    <div class="activity-eyebrow">AO VIVO ${isRunning ? '· transmitindo' : ''}</div>
    <div class="live-panel" id="liveLines" style="margin-top:9px"></div>
    ${agent.engine && agent.engine !== 'community' && agent.engine !== 'nvidia' ? '<div class="form-hint" style="margin-top:6px">Este motor não transmite token a token — o texto aparece de uma vez quando a chamada de ferramenta ou a resposta termina.</div>' : ''}`;
  const wrap = body.querySelector('#liveLines');
  // agrupa text-delta consecutivos numa única linha (senão vira uma linha por token)
  const grouped = [];
  for (const evt of STATE.liveLines) {
    const label = liveLineLabel(evt);
    if (!label) continue;
    const last = grouped[grouped.length - 1];
    if (evt.type === 'text-delta' && last && last.type === 'text-delta') last.text += label.text;
    else grouped.push({ type: evt.type, cls: label.cls, text: label.text });
  }
  if (!grouped.length) {
    wrap.innerHTML = `<div class="live-empty">${isRunning ? 'aguardando os primeiros eventos…' : 'nenhum evento registrado pra este especialista ainda.'}</div>`;
  } else {
    wrap.innerHTML = grouped.map((g, i) => {
      const isLastText = i === grouped.length - 1 && g.type === 'text-delta' && isRunning;
      return `<div class="live-line ${g.cls}">${escapeHtml(g.text)}${isLastText ? '<span class="live-cursor"></span>' : ''}</div>`;
    }).join('');
    wrap.scrollTop = wrap.scrollHeight;
  }
}

/* ---------- chat pós-conclusão ---------- */

async function loadChatThread(key) {
  STATE.chatThread = [];
  if (STATE.sel) render();
  // Não há endpoint dedicado de histórico — a primeira mensagem enviada já
  // persiste no runs/<id>/chats/<key>.jsonl; carregar o que já existe antes
  // da primeira mensagem desta sessão do painel não é crítico (o histórico
  // sobrevive no arquivo de qualquer forma, só a tela começa em branco).
}

function renderChatPanel(body, agent) {
  const canChat = agent.state === 'done';
  body.innerHTML = `
    <div class="activity-eyebrow">CHAT COM O ESPECIALISTA</div>
    <div class="chat-thread" id="chatThread" style="margin-top:9px"></div>
    ${canChat ? `
    <div class="chat-input-row">
      <textarea id="chatInput" placeholder="Pergunta de acompanhamento…"></textarea>
      <button id="btnChatSend" ${STATE.chatSending ? 'disabled' : ''}>${STATE.chatSending ? '...' : 'Enviar'}</button>
    </div>` : '<div class="form-hint" style="margin-top:6px">Só dá pra conversar depois que o especialista concluir com sucesso.</div>'}`;
  const threadWrap = body.querySelector('#chatThread');
  if (!STATE.chatThread.length) {
    threadWrap.innerHTML = '<div class="live-empty">Nenhuma mensagem ainda — pergunte algo sobre o relatório dele.</div>';
  } else {
    threadWrap.innerHTML = STATE.chatThread.map((m) => `<div class="chat-msg ${m.role}">${escapeHtml(m.content)}</div>`).join('');
    threadWrap.scrollTop = threadWrap.scrollHeight;
  }
  const sendBtn = body.querySelector('#btnChatSend');
  const input = body.querySelector('#chatInput');
  const send = async () => {
    const text = input?.value.trim();
    if (!text || STATE.chatSending) return;
    STATE.chatThread.push({ role: 'user', content: text });
    STATE.chatSending = true;
    render();
    const res = await controlAction('chat', agent.key, { message: text });
    STATE.chatThread.push({ role: 'assistant', content: res.ok ? res.reply : `(erro: ${res.error || 'falha ao conversar'})` });
    STATE.chatSending = false;
    render();
  };
  sendBtn?.addEventListener('click', send);
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
}

/* ---------- exportação (gerada a partir dos dados carregados, reais ou demo) ---------- */

function decidedItems(data, status) {
  const decisions = data.decisions || {};
  const out = [];
  (data.synthBlocks || []).forEach((b, blockIdx) => {
    (b.items || []).forEach((it, itemIdx) => {
      const d = decisions[`${blockIdx}-${itemIdx}`];
      if (d && d.status === status) out.push({ ...it, note: d.note });
    });
  });
  return out;
}

function buildExportFormats(data) {
  const claims = data.claims || [];
  const byVerdict = (v) => claims.filter(c => c.verdict === v);
  const toImplement = decidedItems(data, 'implementar');
  const toReview = decidedItems(data, 'revisar');

  const opusLines = [];
  opusLines.push(`# Digest para síntese final — run ${data.run.runId || '—'}`, '');
  if (toImplement.length || toReview.length) {
    opusLines.push(`## Decisão do usuário após revisão (${toImplement.length} pra implementar, ${toReview.length} pra revisar)`);
    toImplement.forEach(i => opusLines.push(`- [IMPLEMENTAR] ${i.text}`));
    toReview.forEach(i => opusLines.push(`- [REVISAR${i.note ? `: ${i.note}` : ''}] ${i.text}`));
    opusLines.push('');
  }
  opusLines.push(`## Confirmados (${byVerdict('CONFIRMADO').length})`);
  byVerdict('CONFIRMADO').forEach(c => opusLines.push(`- ${c.text} — ${c.origin}`));
  opusLines.push('', `## Parciais (${byVerdict('PARCIAL').length})`);
  byVerdict('PARCIAL').forEach(c => opusLines.push(`- ${c.text} — ${c.origin}`));
  opusLines.push('', '## Divergência aberta — NÃO DECIDIR');
  opusLines.push(data.dissent ? `- ${data.dissent.text}\n  → ${data.dissent.note}` : '- Nenhuma divergência aberta nesta rodada.');
  opusLines.push('', `## Descartado com motivo (${byVerdict('IMPROCEDENTE').length})`);
  byVerdict('IMPROCEDENTE').forEach(c => opusLines.push(`- ${c.text} — ${c.check}`));

  const resumoLines = [
    data.headline || '(síntese ainda não disponível)', '',
    data.lede || '', '',
    `Tempo total: ${data.run.elapsed || '—'} · Custo estimado: ${data.run.cost || '—'} · ${claims.length} afirmações checadas.`,
  ];

  const jsonObj = {
    run: data.run.runId, round: data.run.round,
    agents: { especialistas: (data.specialistAgents || []).length, juiz_e_lider: (data.arbiters || []).length },
    verdicts: {
      confirmados: byVerdict('CONFIRMADO').length, parciais: byVerdict('PARCIAL').length,
      improcedentes: byVerdict('IMPROCEDENTE').length, nao_verificaveis: byVerdict('NÃO VERIFICÁVEL').length,
    },
    blockers: (data.synthBlocks.find(b => b.tag.startsWith('P0'))?.items || []).map(i => i.text),
    dropped: (data.synthBlocks.find(b => b.tag === 'DESCARTADO')?.items || []).map(i => i.text),
    open_dissent: data.dissent ? [data.dissent.text] : [],
    cost_usd: data.run.cost, elapsed: data.run.elapsed,
    user_decisions: {
      implementar: toImplement.map(i => i.text),
      revisar: toReview.map(i => ({ text: i.text, nota: i.note })),
    },
  };

  return {
    opus: { label: 'TASK · OPUS FINAL', color: 'var(--accent-2)', border: '#6b4f33', path: `runs/${data.run.runId}/export-task-opus.md`, text: opusLines.join('\n') },
    resumo: { label: 'RESUMO EXECUTIVO', color: 'var(--text-2)', border: 'var(--border-6)', path: `runs/${data.run.runId}/export-resumo.md`, text: resumoLines.join('\n') },
    json: { label: 'JSON · MÁQUINA', color: 'var(--blue)', border: '#2c3d47', path: `runs/${data.run.runId}/export.json`, text: JSON.stringify(jsonObj, null, 2) },
  };
}

function renderModal() {
  const backdrop = document.getElementById('exportModal');
  backdrop.classList.toggle('show', STATE.exportOpen);
  if (!STATE.exportOpen) return;

  const formats = buildExportFormats(STATE.data);
  const fmt = formats[STATE.exportFormat];
  document.getElementById('modalSub').textContent = `run ${STATE.data.run.runId || '—'} · rodada ${STATE.data.run.round ?? '—'} · escolha o formato de saída`;
  document.getElementById('modalText').textContent = fmt.text;
  document.getElementById('modalPath').textContent = fmt.path;

  const row = document.getElementById('formatRow');
  row.innerHTML = '';
  Object.entries(formats).forEach(([key, f]) => {
    const active = key === STATE.exportFormat;
    const btn = el('button', 'format-btn', f.label);
    btn.style.color = active ? f.color : 'var(--text-6)';
    btn.style.borderColor = active ? f.border : 'var(--border-4)';
    btn.style.background = active ? '#161310' : 'transparent';
    btn.addEventListener('click', () => { STATE.exportFormat = key; STATE.copied = false; render(); });
    row.appendChild(btn);
  });

  document.getElementById('btnCopy').textContent = STATE.copied ? 'Copiado' : 'Copiar';
}

async function loadProviderHealth() {
  try {
    const response = await fetch('/api/providers');
    const data = response.ok ? await response.json() : { providers: [] };
    STATE.providers = data.providers || [];
  } catch (error) {
    STATE.providers = [];
  }
}

function renderProviderChoices() {
  const target = document.getElementById('newRoundProviders');
  if (!target) return;
  const optional = STATE.providers.filter((provider) => ['deepseek-local', 'kimi-free', 'antigravity-free', 'openrouter-free', 'omniroute-free'].includes(provider.key));
  target.innerHTML = optional.map((provider) => `
    <label class="provider-choice">
      <input type="checkbox" value="${escapeHtml(provider.key)}" ${STATE.selectedProviders.has(provider.key) ? 'checked' : ''}>
      <span class="provider-choice-copy">
        <span class="provider-choice-title">${escapeHtml(provider.name)}</span>
        <span class="provider-choice-meta">${escapeHtml(provider.model)} · ${escapeHtml(provider.detail || '')}</span>
      </span>
      <span class="provider-state ${provider.available ? 'ready' : 'optional'}">${provider.available ? 'PRONTO' : 'OPCIONAL'}</span>
    </label>`).join('') || '<div class="form-hint">Diagnóstico de provedores indisponível.</div>';
  target.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) STATE.selectedProviders.add(input.value);
      else STATE.selectedProviders.delete(input.value);
    });
  });
}

function renderProvidersModal() {
  const backdrop = document.getElementById('providersModal');
  if (!backdrop) return;
  backdrop.classList.toggle('show', STATE.providersOpen);
  if (!STATE.providersOpen) return;
  const grid = document.getElementById('providersGrid');
  grid.innerHTML = STATE.providers.map((provider) => {
    const canConfigure = !provider.available && provider.howTo;
    const stateTag = provider.available ? 'span' : (canConfigure ? 'button' : 'span');
    return `
    <article class="provider-card">
      <div class="provider-card-top">
        <span class="provider-orb ${provider.available ? 'ready' : ''}"></span>
        <${stateTag} class="provider-state ${provider.available ? 'ready' : 'optional'}" ${canConfigure ? `data-copy-howto="${escapeHtml(provider.howTo)}"` : ''}>${provider.available ? 'PRONTO' : 'CONFIGURAR'}</${stateTag}>
      </div>
      <h3>${escapeHtml(provider.name)}</h3>
      <div class="provider-model">${escapeHtml(provider.model || '')}</div>
      <p>${escapeHtml(provider.free || '')}</p>
      <div class="provider-detail">${escapeHtml(provider.detail || '')}</div>
      ${canConfigure ? `<div class="provider-howto">→ ${escapeHtml(provider.howTo)}</div>` : ''}
    </article>`;
  }).join('');
  grid.querySelectorAll('button[data-copy-howto]').forEach((btn) => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.copyHowto).catch(() => {});
      const original = btn.textContent;
      btn.textContent = 'COPIADO';
      setTimeout(() => { btn.textContent = original; }, 1500);
    });
  });
}

/* ---------- painel de configuração do conselho ---------- */

async function loadSettingsConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return;
    const data = await res.json();
    STATE.settingsSpecialties = data.specialties || [];
    STATE.settingsModelPool = data.modelPool || [];
    STATE.settingsProviderModels = data.providerModels || { openrouter: [], omniroute: [] };
    const routing = data.routing || {};
    STATE.settingsDraft = {
      judgeModel: routing.judgeModel || '',
      leaderModel: routing.leaderModel || '',
      pinned: { ...(routing.pinned || {}) },
      maxSpecialtiesPerRound: routing.maxSpecialtiesPerRound || 6,
      omnirouteBaseUrl: routing.omnirouteBaseUrl || 'http://localhost:20128/v1',
      customModels: [...(routing.customModels || [])],
    };
    STATE.settingsLoaded = true;
  } catch (e) {
    // painel de config indisponível — modal mostra o que já tiver (provavelmente nada ainda)
  }
}

function allSettingsModelOptions() {
  return [...STATE.settingsModelPool, ...STATE.settingsDraft.customModels];
}

function renderSettingsModal() {
  const backdrop = document.getElementById('settingsModal');
  if (!backdrop) return;
  backdrop.classList.toggle('show', STATE.settingsOpen);
  if (!STATE.settingsOpen) return;

  const options = allSettingsModelOptions();
  const optionsHtml = (selected) => [
    `<option value="" ${!selected ? 'selected' : ''}>Automático</option>`,
    ...options.map((m) => `<option value="${escapeHtml(m.id)}" ${selected === m.id ? 'selected' : ''}>${escapeHtml(m.label || m.id)}</option>`),
  ].join('');

  const judgeSel = document.getElementById('settingsJudge');
  const leaderSel = document.getElementById('settingsLeader');
  if (judgeSel) judgeSel.innerHTML = optionsHtml(STATE.settingsDraft.judgeModel);
  if (leaderSel) leaderSel.innerHTML = optionsHtml(STATE.settingsDraft.leaderModel);
  const maxInput = document.getElementById('settingsMaxSpecialties');
  if (maxInput) maxInput.value = STATE.settingsDraft.maxSpecialtiesPerRound;

  renderSettingsPins(options);
  renderSettingsCustomModels();
}

function renderSettingsPins(options) {
  const wrap = document.getElementById('settingsPins');
  if (!wrap) return;
  const opts = options || allSettingsModelOptions();
  wrap.innerHTML = STATE.settingsSpecialties.map((s) => {
    const pinned = (STATE.settingsDraft.pinned[s.key] || [])[0] || '';
    const optionsHtml = [
      `<option value="">Automático</option>`,
      ...opts.map((m) => `<option value="${escapeHtml(m.id)}" ${pinned === m.id ? 'selected' : ''}>${escapeHtml(m.label || m.id)}</option>`),
    ].join('');
    return `
      <label class="provider-choice" style="cursor:default">
        <span class="provider-choice-copy">
          <span class="provider-choice-title">${escapeHtml(s.titulo)}</span>
        </span>
        <select class="run-selector" data-pin-key="${escapeHtml(s.key)}" style="min-width:220px">${optionsHtml}</select>
      </label>`;
  }).join('') || '<div class="form-hint">Catálogo de especialidades indisponível.</div>';
  wrap.querySelectorAll('select[data-pin-key]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const key = sel.dataset.pinKey;
      if (sel.value) STATE.settingsDraft.pinned[key] = [sel.value];
      else delete STATE.settingsDraft.pinned[key];
    });
  });
}

function renderSettingsCustomModels() {
  const wrap = document.getElementById('settingsCustomModels');
  if (!wrap) return;
  const list = STATE.settingsDraft.customModels;
  wrap.innerHTML = list.length ? list.map((m, i) => `
    <div class="provider-choice" style="cursor:default">
      <span class="provider-choice-copy">
        <span class="provider-choice-title">${escapeHtml(m.id)}</span>
        <span class="provider-choice-meta">${escapeHtml(m.provider)}</span>
      </span>
      <button class="btn-close" data-remove-idx="${i}">REMOVER</button>
    </div>`).join('') : '<div class="form-hint">Nenhum modelo avulso adicionado ainda.</div>';
  wrap.querySelectorAll('button[data-remove-idx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      list.splice(Number(btn.dataset.removeIdx), 1);
      renderSettingsCustomModels();
    });
  });
}

async function saveSettings() {
  const errBox = document.getElementById('settingsError');
  const statusBox = document.getElementById('settingsStatus');
  const btn = document.getElementById('btnSaveSettings');
  errBox.style.display = 'none';
  btn.disabled = true;
  statusBox.textContent = 'salvando…';
  const draft = STATE.settingsDraft;
  const maxInput = document.getElementById('settingsMaxSpecialties');
  draft.maxSpecialtiesPerRound = Number(maxInput.value) || 6;
  try {
    const res = await fetch('/api/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        judgeModel: document.getElementById('settingsJudge').value || null,
        leaderModel: document.getElementById('settingsLeader').value || null,
        pinned: draft.pinned,
        maxSpecialtiesPerRound: draft.maxSpecialtiesPerRound,
        omnirouteBaseUrl: draft.omnirouteBaseUrl,
        customModels: draft.customModels,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'falha ao salvar');
    statusBox.textContent = 'salvo';
    setTimeout(() => { statusBox.textContent = ''; }, 2000);
  } catch (e) {
    errBox.textContent = e.message;
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
}

/* ---------- render principal ---------- */

function render() {
  renderHeader();
  renderTabs();

  ['conselho', 'debate', 'verify', 'synth'].forEach(v => {
    document.getElementById(`view-${v}`).classList.toggle('active', STATE.view === v);
  });

  if (STATE.view === 'conselho') renderConselho();
  if (STATE.view === 'debate') renderDebate();
  if (STATE.view === 'verify') renderVerify();
  if (STATE.view === 'synth') renderSynth();

  renderSidebar();
  renderModal();
  renderProvidersModal();
  renderSettingsModal();
  renderPlaygroundModal();
}

/* ---------- eventos fixos (fora das views que são reconstruídas) ---------- */

document.getElementById('btnCloseModal').addEventListener('click', () => { STATE.exportOpen = false; render(); });
document.getElementById('exportModal').addEventListener('click', (e) => {
  if (e.target.id === 'exportModal') { STATE.exportOpen = false; render(); }
});
document.getElementById('btnCopy').addEventListener('click', () => {
  const fmt = buildExportFormats(STATE.data)[STATE.exportFormat];
  navigator.clipboard?.writeText(fmt.text).catch(() => {});
  STATE.copied = true;
  render();
});
document.getElementById('btnDownload').addEventListener('click', () => {
  const fmt = buildExportFormats(STATE.data)[STATE.exportFormat];
  const blob = new Blob([fmt.text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fmt.path.split('/').pop();
  a.click();
  URL.revokeObjectURL(url);
});
document.getElementById('btnInterrupt').addEventListener('click', () => {
  STATE.data.activity = STATE.data.activity || [];
  STATE.data.activity.unshift({ time: 'agora', text: 'Rodada interrompida pelo usuário — achados já gravados preservados em runs/' + (STATE.data.run.runId || '') + '/.' });
  render();
});
document.getElementById('draftInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendDraft(); });
document.getElementById('btnSend').addEventListener('click', sendDraft);
document.getElementById('runSelector').addEventListener('change', (e) => loadRun(e.target.value));
document.getElementById('btnProviders').addEventListener('click', async () => {
  await loadProviderHealth();
  STATE.providersOpen = true;
  render();
});
document.getElementById('btnCloseProviders').addEventListener('click', () => { STATE.providersOpen = false; render(); });
document.getElementById('providersModal').addEventListener('click', (event) => {
  if (event.target.id === 'providersModal') { STATE.providersOpen = false; render(); }
});
document.getElementById('btnSettings').addEventListener('click', async () => {
  if (!STATE.settingsLoaded) await loadSettingsConfig();
  STATE.settingsOpen = true;
  render();
});
document.getElementById('btnCloseSettings').addEventListener('click', () => { STATE.settingsOpen = false; render(); });
document.getElementById('settingsModal').addEventListener('click', (event) => {
  if (event.target.id === 'settingsModal') { STATE.settingsOpen = false; render(); }
});
document.getElementById('btnSaveSettings').addEventListener('click', saveSettings);
document.getElementById('btnAddCustomModel').addEventListener('click', () => {
  const provider = document.getElementById('settingsCustomProvider').value;
  const idInput = document.getElementById('settingsCustomModelId');
  const id = idInput.value.trim();
  if (!id) return;
  STATE.settingsDraft.customModels.push({ id, provider, label: id, engine: 'community' });
  idInput.value = '';
  renderSettingsCustomModels();
  renderSettingsPins();
});

/* ---------- playground ---------- */

function renderPlaygroundModal() {
  const backdrop = document.getElementById('playgroundModal');
  backdrop.classList.toggle('show', STATE.playgroundOpen);
  if (!STATE.playgroundOpen) return;

  const setupWrap = document.getElementById('playgroundSetup');
  const chatWrap = document.getElementById('playgroundChatArea');
  const started = !!STATE.playgroundSessionId;
  setupWrap.style.display = started ? 'none' : 'flex';
  chatWrap.style.display = started ? 'flex' : 'none';

  if (!started) {
    const select = document.getElementById('playgroundModelSelect');
    const options = [...STATE.settingsModelPool, ...(STATE.settingsDraft.customModels || [])];
    select.innerHTML = options.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label || m.id)}</option>`).join('') || '<option value="">(nenhum modelo carregado ainda)</option>';
  } else {
    const threadWrap = document.getElementById('playgroundThread');
    threadWrap.innerHTML = STATE.playgroundThread.length
      ? STATE.playgroundThread.map((m) => `<div class="chat-msg ${m.role}">${escapeHtml(m.content)}</div>`).join('')
      : '<div class="live-empty">Comece a conversa abaixo.</div>';
    threadWrap.scrollTop = threadWrap.scrollHeight;
  }
  document.getElementById('btnPlaygroundSend').disabled = STATE.playgroundSending;
  document.getElementById('playgroundStatus').textContent = STATE.playgroundSending ? 'pensando…' : '';
}

document.getElementById('btnPlayground').addEventListener('click', async () => {
  if (!STATE.settingsLoaded) await loadSettingsConfig();
  STATE.playgroundOpen = true;
  render();
});
document.getElementById('btnClosePlayground').addEventListener('click', () => { STATE.playgroundOpen = false; render(); });
document.getElementById('playgroundModal').addEventListener('click', (event) => {
  if (event.target.id === 'playgroundModal') { STATE.playgroundOpen = false; render(); }
});
document.getElementById('btnResetPlayground').addEventListener('click', () => {
  STATE.playgroundSessionId = null;
  STATE.playgroundThread = [];
  render();
});
document.getElementById('btnStartPlayground').addEventListener('click', async () => {
  const model = document.getElementById('playgroundModelSelect').value;
  const systemPrompt = document.getElementById('playgroundSystemPrompt').value.trim();
  const errBox = document.getElementById('playgroundError');
  errBox.style.display = 'none';
  if (!model) { errBox.textContent = 'Escolha um modelo.'; errBox.style.display = 'block'; return; }
  try {
    const res = await fetch('/api/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, systemPrompt }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'falha ao criar sessão');
    STATE.playgroundSessionId = data.sessionId;
    STATE.playgroundThread = [];
    render();
  } catch (e) {
    errBox.textContent = e.message;
    errBox.style.display = 'block';
  }
});
document.getElementById('btnPlaygroundSend').addEventListener('click', async () => {
  const input = document.getElementById('playgroundInput');
  const text = input.value.trim();
  if (!text || STATE.playgroundSending || !STATE.playgroundSessionId) return;
  input.value = '';
  STATE.playgroundThread.push({ role: 'user', content: text });
  STATE.playgroundSending = true;
  render();
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(STATE.playgroundSessionId)}/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    STATE.playgroundThread.push({ role: 'assistant', content: res.ok ? data.reply : `(erro: ${data.error || 'falha ao conversar'})` });
  } catch (e) {
    STATE.playgroundThread.push({ role: 'assistant', content: `(erro: ${e.message})` });
  }
  STATE.playgroundSending = false;
  render();
});
document.getElementById('playgroundInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('btnPlaygroundSend').click(); }
});

async function sendDraft() {
  const input = document.getElementById('draftInput');
  const text = input.value.trim();
  if (!text) return;
  STATE.data.activity = STATE.data.activity || [];
  STATE.data.activity.unshift({ time: 'agora', text: `Instrução do usuário: "${escapeHtml(text)}"` });
  input.value = '';
  render();
  // persiste no state.json pra não sumir no próximo polling — hoje isso é só uma
  // anotação registrada na rodada, não interrompe nem redireciona os agentes em
  // andamento (não existe ainda um mecanismo de "direção ao vivo" no motor).
  if (STATE.currentRunId !== DEMO_RUN_ID) {
    try {
      await fetch(`/api/runs/${encodeURIComponent(STATE.currentRunId)}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
      });
    } catch (e) { /* fica só local se a escrita falhar */ }
  }
}

/* ---------- nova rodada ---------- */

document.getElementById('btnNewRound').addEventListener('click', () => {
  document.getElementById('newRoundModal').classList.add('show');
  document.getElementById('newRoundError').style.display = 'none';
  document.getElementById('newRoundStatus').textContent = '';
  renderProviderChoices();
});
document.getElementById('btnCloseNewRound').addEventListener('click', () => {
  document.getElementById('newRoundModal').classList.remove('show');
});
document.getElementById('newRoundModal').addEventListener('click', (e) => {
  if (e.target.id === 'newRoundModal') document.getElementById('newRoundModal').classList.remove('show');
});
document.getElementById('btnStartRound').addEventListener('click', async () => {
  const scope = document.getElementById('newRoundScope').value.trim();
  const task = document.getElementById('newRoundTask').value.trim();
  const contextPath = document.getElementById('newRoundContextPath').value.trim();
  const errBox = document.getElementById('newRoundError');
  const statusBox = document.getElementById('newRoundStatus');
  const btn = document.getElementById('btnStartRound');
  errBox.style.display = 'none';

  if (!scope || !task) {
    errBox.textContent = 'Preencha a pasta do projeto e a tarefa.';
    errBox.style.display = 'block';
    return;
  }
  btn.disabled = true;
  statusBox.textContent = 'iniciando…';
  try {
    const res = await fetch('/api/rounds', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        scope, task, contextPath: contextPath || undefined, providers: [...STATE.selectedProviders],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'falha ao iniciar rodada');
    document.getElementById('newRoundModal').classList.remove('show');
    document.getElementById('newRoundScope').value = '';
    document.getElementById('newRoundTask').value = '';
    document.getElementById('newRoundContextPath').value = '';
    await loadRunsList();
    await loadRun(data.runId);
  } catch (e) {
    errBox.textContent = e.message;
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    statusBox.textContent = '';
  }
});

/* ---------- boot ---------- */

async function boot() {
  // O diagnóstico de CLIs pode levar alguns segundos. O conteúdo principal
  // deve aparecer imediatamente; a rede de modelos se atualiza em paralelo.
  loadProviderHealth().then(() => {
    // Primeira vez que o painel abre nesta máquina: mostra o diagnóstico de
    // provedores sozinho, sem precisar clicar em nada — depois disso, só sob pedido.
    if (!localStorage.getItem('quorum_setup_visto')) {
      localStorage.setItem('quorum_setup_visto', '1');
      STATE.providersOpen = true;
    }
    render();
    if (document.getElementById('newRoundModal').classList.contains('show')) renderProviderChoices();
  });
  // Carrega o pool de modelos cedo (não só quando o modal de config abre) —
  // é o que alimenta o <select> de troca de modelo nos cards em execução.
  loadSettingsConfig().then(() => render());
  await loadRunsList();
  const latestReal = STATE.runsList[0];
  await loadRun(latestReal ? latestReal.runId : DEMO_RUN_ID);
  setInterval(loadRunsList, 5000);
}

boot();
