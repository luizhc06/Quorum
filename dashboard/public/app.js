'use strict';

const DEMO_RUN_ID = 'demo';
const POLL_MS = 3000;

/* ---------- dados demo (fallback quando não há nenhuma rodada real ainda) ---------- */

const DEMO = {
  run: {
    runId: 'a3f0-2608', round: 2, task: 'demo — exemplo ilustrativo, não é uma rodada real',
    status: 'done', parallelism: '15 agentes', elapsed: '04:12', cost: 'US$ 0,38',
  },
  claudeAgents: [
    { key: 'arquitetura', name: 'Arquitetura', model: 'Sonnet 5', state: 'done', findings: 3, lens: 'Mapeia módulos, acoplamento e limites de responsabilidade.', elapsed: '58s', usage: { inputTokens: 18400, outputTokens: 2100, estimatedUsd: 0.058 } },
    { key: 'seguranca-c', name: 'Segurança', model: 'Sonnet 5', state: 'done', findings: 4, lens: 'Injeção, autenticação, segredos em texto plano.', elapsed: '1m 12s', usage: { inputTokens: 24100, outputTokens: 2800, estimatedUsd: 0.076 } },
    { key: 'regras-negocio', name: 'Regras de negócio', model: 'Sonnet 5', state: 'done', findings: 2, lens: 'Logística, fluxo de pedido, consistência de estado.', elapsed: '49s', usage: { inputTokens: 15200, outputTokens: 1700, estimatedUsd: 0.047 } },
    { key: 'usabilidade', name: 'Usabilidade', model: 'Sonnet 5', state: 'done', findings: 1, lens: 'Fricção de fluxo, feedback ao usuário, acessibilidade.', elapsed: '41s', usage: { inputTokens: 12800, outputTokens: 1300, estimatedUsd: 0.038 } },
    { key: 'melhorias-c', name: 'Melhorias gerais', model: 'Sonnet 5', state: 'done', findings: 3, lens: 'Duplicação, complexidade desnecessária, simplificação.', elapsed: '55s', usage: { inputTokens: 17600, outputTokens: 1900, estimatedUsd: 0.054 } },
    { key: 'engenharia', name: 'Engenharia de software', model: 'Sonnet 5', state: 'done', findings: 2, lens: 'Testabilidade, tratamento de erro, dívida técnica.', elapsed: '1m 03s', usage: { inputTokens: 20500, outputTokens: 2300, estimatedUsd: 0.064 } },
    { key: 'qa', name: 'Qualidade / QA', model: 'Sonnet 5', state: 'done', findings: 2, lens: 'Cobertura de teste, casos de borda não exercitados.', elapsed: '47s', usage: { inputTokens: 14700, outputTokens: 1600, estimatedUsd: 0.045 } },
    { key: 'dados', name: 'Dados', model: 'Sonnet 5', state: 'done', findings: 3, lens: 'Modelagem, migrações, integridade referencial.', elapsed: '1m 20s', usage: { inputTokens: 26300, outputTokens: 2900, estimatedUsd: 0.082 } },
    { key: 'design-ui', name: 'Design / UI', model: 'Sonnet 5', state: 'done', findings: 0, lens: 'Sem superfície de UI relevante neste escopo — sinalizado e encerrado.', elapsed: '18s', usage: { inputTokens: 3200, outputTokens: 300, estimatedUsd: 0.009 } },
    { key: 'infra', name: 'Infraestrutura / Deploy', model: 'Sonnet 5', state: 'done', findings: 2, lens: 'CI/CD, gestão de segredos em produção, rollback.', elapsed: '2m 41s', usage: { inputTokens: 34800, outputTokens: 3600, estimatedUsd: 0.106 } },
  ],
  openaiAgents: [
    { key: 'pesquisa', name: 'Pesquisa', model: 'GPT-5.6 Terra', state: 'done', findings: 0, lens: 'Mapeamento factual da arquitetura real do repositório.', elapsed: '52s', usage: { inputTokens: 11200, outputTokens: 1400, estimatedUsd: 0.039 } },
    { key: 'seguranca-o', name: 'Segurança', model: 'GPT-5.6 Terra', state: 'done', findings: 3, lens: 'Vulnerabilidades citáveis por arquivo e linha.', elapsed: '1m 08s', usage: { inputTokens: 19800, outputTokens: 2200, estimatedUsd: 0.066 } },
    { key: 'bug-hunter', name: 'Bug Hunter', model: 'GPT-5.6 Terra', state: 'done', findings: 2, lens: 'Condição de corrida, exceção engolida, off-by-one.', elapsed: '1m 01s', usage: { inputTokens: 17300, outputTokens: 1900, estimatedUsd: 0.057 } },
    { key: 'melhorias-o', name: 'Melhorias gerais', model: 'GPT-5.6 Terra', state: 'done', findings: 2, lens: 'Padrões já usados em um lugar, não replicados em outro.', elapsed: '46s', usage: { inputTokens: 13600, outputTokens: 1500, estimatedUsd: 0.045 } },
    { key: 'dependencias', name: 'Dependências', model: 'GPT-5.6 Terra', state: 'done', findings: 1, lens: 'Supply-chain, versões travadas, ausência de lockfile.', elapsed: '2m 10s', usage: { inputTokens: 28900, outputTokens: 3100, estimatedUsd: 0.095 } },
  ],
  arbiters: [
    { key: 'juiz-claude', name: 'Juiz Claude', model: 'Opus 5 · com leitura', state: 'done', role: 'Consolidou os 10 relatórios, descartou 3 achados de baixa confiança, checou pessoalmente os de severidade alta antes de aceitar.', chips: ['10 relatórios lidos', '3 descartados', '15 confirmados'], usage: { inputTokens: 48200, outputTokens: 5100, estimatedUsd: 0.369 } },
    { key: 'juiz-openai', name: 'Juiz OpenAI', model: 'GPT-5.6 Sol · com leitura', state: 'done', role: 'Consolidou os 5 relatórios, checou o achado de dependência travada contra o lockfile antes de aceitar.', chips: ['5 relatórios lidos', '1 rebaixado'], usage: { inputTokens: 31500, outputTokens: 3400, estimatedUsd: 0.26 } },
    { key: 'lider', name: 'Líder / Sintetizador', model: 'Opus 5', state: 'done', role: 'Cruzou os dois lados e decidiu o que vai para a síntese final.', chips: ['9/12 pontos convergentes', '1 divergência aberta'], usage: { inputTokens: 22100, outputTokens: 2600, estimatedUsd: 0.176 } },
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
  claims: [
    { text: 'SQL injection em /api/pedidos/buscar via numero_nf sem escape.', origin: 'Claude · segurança', check: 'Verificador leu o arquivo, reproduziu o payload em ambiente isolado.', verdict: 'CONFIRMADO' },
    { text: '.env.production copiado para dentro do artefato de build publicado.', origin: 'Claude · infra-deploy', check: 'Verificador abriu o artefato do último CI run, confirmou o arquivo presente.', verdict: 'CONFIRMADO' },
    { text: 'Nenhum dos 4 controllers vizinhos escapa esse mesmo parâmetro.', origin: 'GPT · segurança', check: 'Verificador checou os 4 arquivos citados, confirma o padrão em 3 de 4.', verdict: 'PARCIAL' },
    { text: 'Condição de corrida no worker de confirmação de entrega sob picos.', origin: 'GPT · bug-hunter', check: 'Verificador não conseguiu reproduzir sem acesso a carga real de produção.', verdict: 'NÃO VERIFICÁVEL' },
    { text: 'Dependência left-pad-like travada em versão com CVE conhecido.', origin: 'GPT · dependências', check: 'Verificador confirmou a versão travada; CVE citado é de severidade baixa, não crítica como o relatório original sugeriu.', verdict: 'PARCIAL' },
    { text: 'Falta de camada de acesso a dados única é urgência de deploy.', origin: 'Claude · arquitetura', check: 'Retirado pelo próprio agente durante o debate — virou melhoria P1.', verdict: 'IMPROCEDENTE' },
    { text: 'Índice ausente na tabela de eventos exige migração imediata.', origin: 'Claude · dados', check: 'Evidência do índice é real; a urgência depende de projeção de negócio, não de código — virou divergência aberta.', verdict: 'PARCIAL' },
    { text: 'Timeout de sessão de 30 dias é excessivo para dados sensíveis.', origin: 'Claude · segurança', check: 'Verificador confirmou o valor no config, e que o dado exposto é de fato sensível.', verdict: 'CONFIRMADO' },
    { text: 'Duplicação de lógica de cálculo de frete em 3 controllers.', origin: 'GPT · melhorias', check: 'Verificador localizou os 3 pontos citados, confirma duplicação quase literal.', verdict: 'CONFIRMADO' },
    { text: 'Ausência de teste para o fluxo de reenvio de pedido original.', origin: 'Claude · qa', check: 'Verificador confirmou ausência via grep na suíte de testes.', verdict: 'CONFIRMADO' },
    { text: 'Botão de reenvio não dá feedback visual durante a chamada.', origin: 'Claude · usabilidade', check: 'Verificador confirmou lendo o componente — nenhum estado de loading implementado.', verdict: 'CONFIRMADO' },
    { text: 'Módulo de relatórios importa um pacote não usado em nenhum lugar.', origin: 'GPT · dependências', check: 'Verificador não encontrou o import citado no arquivo apontado — referência incorreta.', verdict: 'IMPROCEDENTE' },
  ],
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
};

const STAGES = [
  { key: 'conselho', num: '01', title: 'Rodada paralela', state: () => {
    const total = STATE.data.claudeAgents.length + STATE.data.openaiAgents.length;
    const done = [...STATE.data.claudeAgents, ...STATE.data.openaiAgents].filter(a => a.state === 'done').length;
    return `${total} agentes · ${done} concluídos`;
  } },
  { key: 'debate', num: '02', title: 'Debate cruzado', state: () => `${(STATE.data.debate || []).length} mensagens` },
  { key: 'verify', num: '04', title: 'Verificação adversarial', state: () => `${(STATE.data.claims || []).length} afirmações` },
  { key: 'synth', num: '05', title: 'Síntese Opus', state: () => STATE.data.headline ? (STATE.data.dissent ? '1 divergência aberta' : 'sem divergência') : 'aguardando' },
];

/* ---------- helpers ---------- */

function stateColor(state) {
  if (state === 'done') return 'var(--green-3)';
  if (state === 'running') return 'var(--amber)';
  if (state === 'failed' || state === 'refused') return 'var(--red-2)';
  return 'var(--text-9)';
}
function stateLabel(state) {
  if (state === 'done') return 'CONCLUÍDO';
  if (state === 'running') return 'EM ANDAMENTO';
  if (state === 'failed') return 'FALHOU';
  if (state === 'refused') return 'RECUSOU';
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
  const all = [
    ...STATE.data.claudeAgents.map(a => ({ ...a, side: 'claude' })),
    ...STATE.data.openaiAgents.map(a => ({ ...a, side: 'openai' })),
  ];
  const agent = all.find(a => a.key === key);
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

function normalizeRunData(raw) {
  return {
    run: raw.run || {},
    claudeAgents: raw.claudeAgents || [],
    openaiAgents: raw.openaiAgents || [],
    arbiters: raw.arbiters || [],
    debate: raw.debate || [],
    claims: raw.claims || [],
    headline: raw.headline || '',
    lede: raw.lede || '',
    synthBlocks: raw.synthBlocks || [],
    dissent: raw.dissent || null,
    activity: raw.activity || [],
    decisions: raw.decisions || {},
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
  let claudeIn = 0, claudeOut = 0, claudeCost = 0;
  let openaiIn = 0, openaiOut = 0, openaiCost = 0;
  (data.claudeAgents || []).forEach((a) => { if (a.usage) { claudeIn += a.usage.inputTokens || 0; claudeOut += a.usage.outputTokens || 0; claudeCost += a.usage.estimatedUsd || 0; } });
  (data.openaiAgents || []).forEach((a) => { if (a.usage) { openaiIn += a.usage.inputTokens || 0; openaiOut += a.usage.outputTokens || 0; openaiCost += a.usage.estimatedUsd || 0; } });
  (data.arbiters || []).forEach((a) => {
    if (!a.usage) return;
    const isOpenai = (a.key || '').includes('openai');
    if (isOpenai) { openaiIn += a.usage.inputTokens || 0; openaiOut += a.usage.outputTokens || 0; openaiCost += a.usage.estimatedUsd || 0; }
    else { claudeIn += a.usage.inputTokens || 0; claudeOut += a.usage.outputTokens || 0; claudeCost += a.usage.estimatedUsd || 0; }
  });
  const claudeTotal = claudeIn + claudeOut;
  const openaiTotal = openaiIn + openaiOut;
  const grandTotal = claudeTotal + openaiTotal;
  return {
    claudeTotal, openaiTotal, grandTotal,
    claudeCost, openaiCost, totalCost: claudeCost + openaiCost,
    pctClaude: grandTotal ? Math.round((claudeTotal / grandTotal) * 100) : 0,
    pctOpenai: grandTotal ? Math.round((openaiTotal / grandTotal) * 100) : 0,
  };
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
  document.getElementById('pctAnthropic').textContent = totals.grandTotal ? `${totals.pctClaude}%` : '—';
  document.getElementById('pctOpenai').textContent = totals.grandTotal ? `${totals.pctOpenai}%` : '—';

  const dot = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  const isDemo = STATE.currentRunId === DEMO_RUN_ID;
  dot.classList.toggle('demo', isDemo);
  dot.classList.toggle('failed', !isDemo && r.status === 'failed');
  label.textContent = isDemo ? 'demo' : r.status === 'done' ? 'concluída' : r.status === 'failed' ? 'falhou' : 'ao vivo';
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

function agentCard(agent, side) {
  const card = el('button', `agent-card${side === 'openai' ? ' openai' : ''}`);
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
    <div class="agent-foot"><span>${escapeHtml(agent.model || '')}</span><span>${escapeHtml(agent.elapsed || '')}</span></div>`;
  card.addEventListener('click', () => { STATE.sel = { ...agent, side }; render(); });
  return card;
}

function renderConselho() {
  const container = document.getElementById('view-conselho');
  const hasAny = STATE.data.claudeAgents.length || STATE.data.openaiAgents.length;
  if (!hasAny) {
    container.innerHTML = '';
    container.appendChild(emptyState('Nenhuma rodada iniciada ainda para este run. O painel atualiza sozinho assim que os agentes começarem.'));
    return;
  }

  const cGrid = document.getElementById('claudeGrid'); cGrid.innerHTML = '';
  STATE.data.claudeAgents.forEach(a => cGrid.appendChild(agentCard(a, 'claude')));
  const oGrid = document.getElementById('openaiGrid'); oGrid.innerHTML = '';
  STATE.data.openaiAgents.forEach(a => oGrid.appendChild(agentCard(a, 'openai')));

  document.getElementById('claudeDone').textContent = `${STATE.data.claudeAgents.filter(a => a.state === 'done').length}/${STATE.data.claudeAgents.length} concluídos`;
  document.getElementById('openaiDone').textContent = `${STATE.data.openaiAgents.filter(a => a.state === 'done').length}/${STATE.data.openaiAgents.length} concluídos`;

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
  const claims = STATE.data.claims || [];
  if (!claims.length) {
    view.innerHTML = '';
    view.appendChild(emptyState('Nenhuma afirmação verificada ainda nesta rodada. Esta tela popula assim que a verificação adversarial concluir.'));
    return;
  }
  const counts = { CONFIRMADO: 0, PARCIAL: 0, IMPROCEDENTE: 0, 'NÃO VERIFICÁVEL': 0 };
  claims.forEach(c => { counts[c.verdict] = (counts[c.verdict] || 0) + 1; });
  const summaryDefs = [
    ['CONFIRMADOS', counts.CONFIRMADO], ['PARCIAIS', counts.PARCIAL],
    ['IMPROCEDENTES', counts.IMPROCEDENTE], ['NÃO VERIFICÁVEL', counts['NÃO VERIFICÁVEL']],
  ];
  view.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">
      <p class="verify-lede">Verificação adversarial: antes de qualquer coisa do lado OpenAI virar recomendação, um agente Claude tenta derrubá-la lendo a fonte. O inverso também roda — o lado GPT audita os achados Claude.</p>
      <div class="verdict-summary" id="verdictSummary"></div>
      <div class="claims-table">
        <div class="claims-head"><div>AFIRMAÇÃO</div><div>ORIGEM</div><div>CHECAGEM</div><div>VEREDICTO</div></div>
        <div id="claimsRows"></div>
      </div>
    </div>`;

  const summary = document.getElementById('verdictSummary');
  summaryDefs.forEach(([label, n]) => {
    const vc = verdictColor(label === 'CONFIRMADOS' ? 'CONFIRMADO' : label === 'PARCIAIS' ? 'PARCIAL' : label === 'IMPROCEDENTES' ? 'IMPROCEDENTE' : 'X');
    const box = el('div', 'verdict-stat');
    box.style.borderColor = vc.border;
    box.innerHTML = `<span class="verdict-n" style="color:${vc.color}">${n}</span><span class="verdict-label">${label}</span>`;
    summary.appendChild(box);
  });

  const rows = document.getElementById('claimsRows');
  claims.forEach(c => {
    const vc = verdictColor(c.verdict);
    const row = el('div', 'claim-row');
    row.innerHTML = `
      <div class="claim-text">${escapeHtml(c.text || '')}</div>
      <div class="claim-origin" style="color:${(c.origin || '').startsWith('Claude') ? 'var(--accent-2)' : 'var(--blue)'}">${escapeHtml(c.origin || '')}</div>
      <div class="claim-check">${escapeHtml(c.check || '')}</div>
      <div><span class="verdict-pill" style="color:${vc.color};border-color:${vc.border}">${escapeHtml(c.verdict || '')}</span></div>`;
    rows.appendChild(row);
  });
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
    selPanel.innerHTML = `
      <div class="sel-head">
        <div>
          <div class="sel-eyebrow" style="color:${a.side === 'claude' ? 'var(--accent-2)' : 'var(--blue)'}">${a.side === 'claude' ? 'GRUPO ANTHROPIC' : 'GRUPO OPENAI'}</div>
          <div class="sel-name">${escapeHtml(a.name)}</div>
          <div class="sel-meta">${escapeHtml(a.model || '')} · ${stateLabel(a.state)}</div>
        </div>
        <button class="btn-close" id="btnCloseSel">FECHAR</button>
      </div>
      <div class="sel-lens">${escapeHtml(a.lens || '')}</div>
      <div class="hr"></div>
      <div class="activity-eyebrow">ACHADOS (${a.findings ?? 0})</div>
      <div style="display:flex;flex-direction:column;gap:9px" id="selFindings"></div>`;

    const findWrap = selPanel.querySelector('#selFindings');
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
    document.getElementById('btnCloseSel').addEventListener('click', () => { STATE.sel = null; render(); });
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
    agents: { claude: data.claudeAgents.length, openai: data.openaiAgents.length, juizes_e_lider: data.arbiters.length },
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
    opus: { label: 'TASK · OPUS FINAL', color: 'var(--accent-2)', border: '#6b4f33', path: `.conselho/runs/${data.run.runId}/export-task-opus.md`, text: opusLines.join('\n') },
    resumo: { label: 'RESUMO EXECUTIVO', color: 'var(--text-2)', border: 'var(--border-6)', path: `.conselho/runs/${data.run.runId}/export-resumo.md`, text: resumoLines.join('\n') },
    json: { label: 'JSON · MÁQUINA', color: 'var(--blue)', border: '#2c3d47', path: `.conselho/runs/${data.run.runId}/export.json`, text: JSON.stringify(jsonObj, null, 2) },
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
  STATE.data.activity.unshift({ time: 'agora', text: 'Rodada interrompida pelo usuário — achados já gravados preservados em .conselho/runs/' + (STATE.data.run.runId || '') + '/.' });
  render();
});
document.getElementById('draftInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendDraft(); });
document.getElementById('btnSend').addEventListener('click', sendDraft);
document.getElementById('runSelector').addEventListener('change', (e) => loadRun(e.target.value));

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
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope, task }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'falha ao iniciar rodada');
    document.getElementById('newRoundModal').classList.remove('show');
    document.getElementById('newRoundScope').value = '';
    document.getElementById('newRoundTask').value = '';
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
  await loadRunsList();
  const latestReal = STATE.runsList[0];
  await loadRun(latestReal ? latestReal.runId : DEMO_RUN_ID);
  setInterval(loadRunsList, 5000);
}

boot();
