'use strict';

/* ---------- dados mockados ---------- */

const RUN = {
  runId: 'a3f0-2608',
  round: 2,
  parallelism: '15 agentes',
  elapsed: '04:12',
  cost: 'US$ 0,38',
};

const CLAUDE_AGENTS = [
  { key: 'arquitetura', name: 'Arquitetura', model: 'Sonnet 5', state: 'done', findings: 3, lens: 'Mapeia módulos, acoplamento e limites de responsabilidade.', elapsed: '58s' },
  { key: 'seguranca-c', name: 'Segurança', model: 'Sonnet 5', state: 'done', findings: 4, lens: 'Injeção, autenticação, segredos em texto plano.', elapsed: '1m 12s' },
  { key: 'regras-negocio', name: 'Regras de negócio', model: 'Sonnet 5', state: 'done', findings: 2, lens: 'Logística, fluxo de pedido, consistência de estado.', elapsed: '49s' },
  { key: 'usabilidade', name: 'Usabilidade', model: 'Sonnet 5', state: 'done', findings: 1, lens: 'Fricção de fluxo, feedback ao usuário, acessibilidade.', elapsed: '41s' },
  { key: 'melhorias-c', name: 'Melhorias gerais', model: 'Sonnet 5', state: 'done', findings: 3, lens: 'Duplicação, complexidade desnecessária, simplificação.', elapsed: '55s' },
  { key: 'engenharia', name: 'Engenharia de software', model: 'Sonnet 5', state: 'done', findings: 2, lens: 'Testabilidade, tratamento de erro, dívida técnica.', elapsed: '1m 03s' },
  { key: 'qa', name: 'Qualidade / QA', model: 'Sonnet 5', state: 'done', findings: 2, lens: 'Cobertura de teste, casos de borda não exercitados.', elapsed: '47s' },
  { key: 'dados', name: 'Dados', model: 'Sonnet 5', state: 'done', findings: 3, lens: 'Modelagem, migrações, integridade referencial.', elapsed: '1m 20s' },
  { key: 'design-ui', name: 'Design / UI', model: 'Sonnet 5', state: 'done', findings: 0, lens: 'Sem superfície de UI relevante neste escopo — sinalizado e encerrado.', elapsed: '18s' },
  { key: 'infra', name: 'Infraestrutura / Deploy', model: 'Sonnet 5', state: 'running', findings: 2, lens: 'CI/CD, gestão de segredos em produção, rollback.', elapsed: '2m 41s' },
];

const OPENAI_AGENTS = [
  { key: 'pesquisa', name: 'Pesquisa', model: 'GPT-5.6 Terra', state: 'done', findings: 0, lens: 'Mapeamento factual da arquitetura real do repositório.', elapsed: '52s' },
  { key: 'seguranca-o', name: 'Segurança', model: 'GPT-5.6 Terra', state: 'done', findings: 3, lens: 'Vulnerabilidades citáveis por arquivo e linha.', elapsed: '1m 08s' },
  { key: 'bug-hunter', name: 'Bug Hunter', model: 'GPT-5.6 Terra', state: 'done', findings: 2, lens: 'Condição de corrida, exceção engolida, off-by-one.', elapsed: '1m 01s' },
  { key: 'melhorias-o', name: 'Melhorias gerais', model: 'GPT-5.6 Terra', state: 'done', findings: 2, lens: 'Padrões já usados em um lugar, não replicados em outro.', elapsed: '46s' },
  { key: 'dependencias', name: 'Dependências', model: 'GPT-5.6 Terra', state: 'running', findings: 1, lens: 'Supply-chain, versões travadas, ausência de lockfile.', elapsed: '2m 10s' },
];

const ARBITERS = [
  { key: 'juiz-claude', name: 'Juiz Claude', model: 'Opus 5 · com leitura', state: 'done', role: 'Consolidou os 10 relatórios, descartou 3 achados de baixa confiança, checou pessoalmente os de severidade alta antes de aceitar.', chips: ['10 relatórios lidos', '3 descartados', '15 confirmados'] },
  { key: 'juiz-openai', name: 'Juiz OpenAI', model: 'GPT-5.6 Sol · com leitura', state: 'running', role: 'Re-checando o achado de dependência travada contra o lockfile antes de consolidar o relatório dos 5.', chips: ['5 relatórios lidos', '1 em checagem'] },
  { key: 'lider', name: 'Líder / Sintetizador', model: 'Opus 5', state: 'queued', role: 'Aguarda os dois juízes e a verificação adversarial para cruzar os lados e decidir o que vai para a síntese final.', chips: ['aguardando'] },
];

const DEBATE = [
  { time: '14:02:11', author: 'Claude · segurança', side: 'claude', kind: 'afirmação',
    text: 'O endpoint /api/pedidos/buscar monta a query concatenando o parâmetro numero_nf diretamente — SQL injection confirmado, não é hipótese.',
    evidence: 'app/Controllers/PedidoController.php:212 — "WHERE numero_nf = \'" . $_GET[\'numero_nf\'] . "\'"' },
  { time: '14:02:47', author: 'GPT · segurança', side: 'openai', kind: 'confirmação',
    text: 'Confirmo lendo o mesmo arquivo. Testei o padrão de escape usado em outros 4 controllers do mesmo diretório — nenhum protege esse parâmetro específico, então não é um caso isolado.',
    evidence: null },
  { time: '14:03:30', author: 'Claude · dados', side: 'claude', kind: 'afirmação',
    text: 'Isso se soma a um problema estrutural: não há camada de acesso a dados única, cada controller escreve SQL cru. A correção pontual desse endpoint não resolve a classe do problema.',
    evidence: null },
  { time: '14:05:02', author: 'GPT · bug-hunter', side: 'openai', kind: 'contestação',
    text: 'Discordo que seja urgente introduzir uma camada de ORM agora — isso é reescrita grande, não um bloqueador de deploy. O bloqueador real é só o endpoint exposto.',
    evidence: null },
  { time: '14:05:41', author: 'Claude · arquitetura', side: 'claude', kind: 'concessão',
    text: 'Aceito — a camada de acesso a dados unificada vira melhoria P1, não P0. O que bloqueia deploy é só a injeção ativa e os segredos vazando no build, tratados separadamente.',
    evidence: null },
  { time: '14:07:15', author: 'Claude · infraestrutura-deploy', side: 'claude', kind: 'afirmação',
    text: 'O pipeline de build inclui o arquivo .env.production dentro do artefato final publicado — confirmei abrindo o zip gerado pelo último workflow do CI.',
    evidence: 'ci/build.yml:34 — "cp .env.production dist/" · artefato do último run inspecionado diretamente' },
  { time: '14:08:03', author: 'GPT · dependências', side: 'openai', kind: 'confirmação',
    text: 'Mesma conclusão a partir de outro ângulo: o .gitignore ignora .env.production no repositório, mas o step de build roda depois do checkout e copia o arquivo de um secret de CI para dentro do dist/ — o problema é o step, não o git.',
    evidence: null },
  { time: '14:10:22', author: 'Claude · dados', side: 'claude', kind: 'afirmação',
    text: 'Recomendo migrar o schema da tabela de eventos agora — o índice atual não escala para o volume que a arquitetura sugere que vem a seguir, e adiar aumenta o custo de migração depois.',
    evidence: 'schema/events.sql — índice composto ausente em (tipo, criado_em), tabela já em 2,1M linhas' },
  { time: '14:11:09', author: 'GPT · pesquisa', side: 'openai', kind: 'contestação',
    text: 'Sem dado de volume projetado, migrar agora é risco não justificado — é uma tabela quente, qualquer migração tem janela de lock. Prefiro esperar o próximo trimestre com um número real de eventos/dia.',
    evidence: null },
  { time: '14:12:40', author: 'Claude · arquitetura', side: 'claude', kind: 'impasse',
    text: 'Não temos como resolver isso lendo mais código — os dois lados têm evidência válida, e o desempate depende de uma projeção de negócio que nenhum agente tem. Isso vai para divergência aberta na síntese.',
    evidence: null },
];

const VERDICT_SUMMARY = [
  { n: 6, label: 'CONFIRMADOS', color: 'var(--green-3)', border: '#2f4527' },
  { n: 3, label: 'PARCIAIS', color: 'var(--amber)', border: '#4a3b22' },
  { n: 2, label: 'IMPROCEDENTES', color: 'var(--red-2)', border: '#4a2a20' },
  { n: 1, label: 'NÃO VERIFICÁVEL', color: 'var(--text-5)', border: 'var(--border-5)' },
];

const CLAIMS = [
  { text: 'SQL injection em /api/pedidos/buscar via numero_nf sem escape.', origin: 'Claude · segurança', check: 'Verificador leu o arquivo, reproduziu o payload em ambiente isolado.', verdict: 'CONFIRMADO', color: 'var(--green-3)', border: '#2f4527' },
  { text: '.env.production copiado para dentro do artefato de build publicado.', origin: 'Claude · infra-deploy', check: 'Verificador abriu o artefato do último CI run, confirmou o arquivo presente.', verdict: 'CONFIRMADO', color: 'var(--green-3)', border: '#2f4527' },
  { text: 'Nenhum dos 4 controllers vizinhos escapa esse mesmo parâmetro.', origin: 'GPT · segurança', check: 'Verificador checou os 4 arquivos citados, confirma o padrão em 3 de 4.', verdict: 'PARCIAL', color: 'var(--amber)', border: '#4a3b22' },
  { text: 'Condição de corrida no worker de confirmação de entrega sob picos.', origin: 'GPT · bug-hunter', check: 'Verificador não conseguiu reproduzir sem acesso a carga real de produção.', verdict: 'NÃO VERIFICÁVEL', color: 'var(--text-5)', border: 'var(--border-5)' },
  { text: 'Dependência left-pad-like travada em versão com CVE conhecido.', origin: 'GPT · dependências', check: 'Verificador confirmou a versão travada; CVE citado é de severidade baixa, não crítica como o relatório original sugeriu.', verdict: 'PARCIAL', color: 'var(--amber)', border: '#4a3b22' },
  { text: 'Falta de camada de acesso a dados única é urgência de deploy.', origin: 'Claude · arquitetura', check: 'Retirado pelo próprio agente durante o debate — virou melhoria P1.', verdict: 'IMPROCEDENTE', color: 'var(--red-2)', border: '#4a2a20' },
  { text: 'Índice ausente na tabela de eventos exige migração imediata.', origin: 'Claude · dados', check: 'Evidência do índice é real; a urgência depende de projeção de negócio, não de código — virou divergência aberta.', verdict: 'PARCIAL', color: 'var(--amber)', border: '#4a3b22' },
  { text: 'Timeout de sessão de 30 dias é excessivo para dados sensíveis.', origin: 'Claude · segurança', check: 'Verificador confirmou o valor no config, e que o dado exposto é de fato sensível.', verdict: 'CONFIRMADO', color: 'var(--green-3)', border: '#2f4527' },
  { text: 'Duplicação de lógica de cálculo de frete em 3 controllers.', origin: 'GPT · melhorias', check: 'Verificador localizou os 3 pontos citados, confirma duplicação quase literal.', verdict: 'CONFIRMADO', color: 'var(--green-3)', border: '#2f4527' },
  { text: 'Ausência de teste para o fluxo de reenvio de pedido original.', origin: 'Claude · qa', check: 'Verificador confirmou ausência via grep na suíte de testes.', verdict: 'CONFIRMADO', color: 'var(--green-3)', border: '#2f4527' },
  { text: 'Botão de reenvio não dá feedback visual durante a chamada.', origin: 'Claude · usabilidade', check: 'Verificador confirmou lendo o componente — nenhum estado de loading implementado.', verdict: 'CONFIRMADO', color: 'var(--green-3)', border: '#2f4527' },
  { text: 'Módulo de relatórios importa um pacote não usado em nenhum lugar.', origin: 'GPT · dependências', check: 'Verificador não encontrou o import citado no arquivo apontado — referência incorreta.', verdict: 'IMPROCEDENTE', color: 'var(--red-2)', border: '#4a2a20' },
];

const SYNTH_BLOCKS = [
  { tag: 'P0 · BLOQUEIA', tagColor: 'var(--red-2)', tagBorder: '#4a2a20', title: 'Antes de qualquer deploy',
    items: [
      { text: 'Corrigir a SQL injection em /api/pedidos/buscar — trocar concatenação por bind parameter. É exploração trivial, não teórica.', source: 'Claude · segurança + GPT · segurança, confirmado por verificação adversarial' },
      { text: 'Remover o passo do CI que copia .env.production para dentro do artefato publicado — segredo de produção sai no build hoje.', source: 'Claude · infraestrutura-deploy + GPT · dependências, confirmado por verificação adversarial' },
    ] },
  { tag: 'P1 · ALTO RETORNO', tagColor: 'var(--amber)', tagBorder: '#4a3b22', title: 'Depois do deploy, prioridade alta',
    items: [
      { text: 'Reduzir o timeout de sessão de 30 dias — desproporcional ao dado sensível que protege.', source: 'Claude · segurança, confirmado' },
      { text: 'Unificar o cálculo de frete duplicado em 3 controllers antes que a quarta cópia apareça.', source: 'GPT · melhorias, confirmado' },
      { text: 'Adicionar teste para o fluxo de reenvio de pedido original — hoje sem cobertura nenhuma.', source: 'Claude · QA, confirmado' },
      { text: 'Introduzir uma camada de acesso a dados única — não é bloqueio, mas o padrão atual (SQL cru por controller) é o que permitiu a injeção passar despercebida.', source: 'Claude · arquitetura, rebaixado de P0 durante o debate' },
    ] },
  { tag: 'DESCARTADO', tagColor: 'var(--text-5)', tagBorder: 'var(--border-5)', title: 'Considerado e rejeitado',
    items: [
      { text: 'CVE na dependência travada — real, mas severidade baixa; entra no próximo ciclo normal de atualização, não é exceção.', source: 'GPT · dependências, rebaixado por verificação adversarial' },
      { text: 'Import não usado no módulo de relatórios — referência de arquivo/linha não confere, achado descartado.', source: 'GPT · dependências, refutado por verificação adversarial' },
    ] },
];

const ACTIVITY = [
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
];

const EXPORT_FORMATS = {
  opus: {
    label: 'TASK · OPUS FINAL', color: 'var(--accent-2)', border: '#6b4f33',
    path: '.conselho/runs/a3f0-2608/export-task-opus.md',
    text: `# Digest para síntese final — run a3f0-2608

## Confirmados (6)
- SQL injection em /api/pedidos/buscar (numero_nf sem escape) — app/Controllers/PedidoController.php:212
- .env.production copiado para dist/ no build — ci/build.yml:34
- Timeout de sessão de 30 dias em dado sensível
- Duplicação de cálculo de frete em 3 controllers
- Ausência de teste no fluxo de reenvio de pedido original
- Botão de reenvio sem feedback de loading

## Parciais (3)
- Padrão de injeção replicado em 3 de 4 controllers vizinhos (não 4 de 4)
- CVE em dependência travada — severidade baixa, não crítica
- Índice ausente em tabela de eventos — evidência real, urgência não decidível por código

## Divergência aberta — NÃO DECIDIR (1)
- Migrar schema de eventos agora vs. aguardar próximo trimestre.
  Claude/dados e Claude/arquitetura defendem migrar já; GPT/pesquisa e
  GPT/melhorias defendem esperar. Ambos os lados citam evidência válida.
  Depende de projeção de eventos/dia que nenhum agente possui.
  → Perguntar ao usuário antes de incluir em qualquer recomendação.

## Descartado com motivo (2)
- Camada de acesso a dados única como bloqueio de deploy — rebaixado
  para melhoria P1 pelo próprio autor durante o debate.
- Import não usado no módulo de relatórios — referência de arquivo
  incorreta, refutado por verificação adversarial.`,
  },
  resumo: {
    label: 'RESUMO EXECUTIVO', color: 'var(--text-2)', border: 'var(--border-6)',
    path: '.conselho/runs/a3f0-2608/export-resumo.md',
    text: `Deploy pode seguir, com um bloqueio: segredos ainda saem no build.

Os dois grupos (10 agentes Claude + 5 GPT) convergiram em 9 de 12
pontos materiais depois de debate e verificação cruzada. Dois itens
precisam ser resolvidos antes do próximo deploy:

1. SQL injection ativa no endpoint de busca de pedidos.
2. Arquivo de produção com segredos sendo incluído no artefato de build.

Um ponto ficou como divergência real entre os dois grupos — migrar
o schema da tabela de eventos agora ou esperar — e depende de uma
projeção de volume que só você tem. O sistema não escolheu por você
de propósito.

Tempo total: 4min 12s · Custo estimado: US$ 0,38 · 31 afirmações checadas.`,
  },
  json: {
    label: 'JSON · MÁQUINA', color: 'var(--blue)', border: '#2c3d47',
    path: '.conselho/runs/a3f0-2608/export.json',
    text: `{
  "run": "a3f0-2608",
  "round": 2,
  "agents": { "claude": 10, "openai": 5, "juizes": 2, "lider": 1 },
  "verdicts": { "confirmados": 6, "parciais": 3, "improcedentes": 2, "nao_verificaveis": 1 },
  "blockers": [
    "SQL injection em /api/pedidos/buscar (numero_nf)",
    ".env.production copiado para artefato de build (ci/build.yml:34)"
  ],
  "dropped": [
    "camada de acesso a dados única como bloqueio de deploy",
    "import não usado no módulo de relatórios"
  ],
  "open_dissent": [
    "migrar schema de eventos agora vs. próximo trimestre"
  ],
  "cost_usd": 0.38,
  "elapsed_s": 252
}`,
  },
};

/* ---------- estado ---------- */

const STATE = {
  view: 'conselho',
  sel: null,
  draft: '',
  exportOpen: false,
  exportFormat: 'opus',
  copied: false,
};

const STAGES = [
  { key: 'conselho', num: '01', title: 'Rodada paralela', state: () => '15 agentes · 13 concluídos' },
  { key: 'debate', num: '02', title: 'Debate cruzado', state: () => `${DEBATE.length} mensagens` },
  { key: 'verify', num: '04', title: 'Verificação adversarial', state: () => `${CLAIMS.length} afirmações` },
  { key: 'synth', num: '05', title: 'Síntese Opus', state: () => '1 divergência aberta' },
];

/* ---------- helpers ---------- */

function stateColor(state) {
  if (state === 'done') return 'var(--green-3)';
  if (state === 'running') return 'var(--amber)';
  return 'var(--text-9)';
}
function stateLabel(state) {
  if (state === 'done') return 'CONCLUÍDO';
  if (state === 'running') return 'EM ANDAMENTO';
  return 'NA FILA';
}
function findingsFor(key) {
  const all = [
    ...CLAUDE_AGENTS.map(a => ({ ...a, side: 'claude' })),
    ...OPENAI_AGENTS.map(a => ({ ...a, side: 'openai' })),
  ];
  const agent = all.find(a => a.key === key);
  if (!agent || !agent.findings) return [];
  return CLAIMS.filter(c => c.origin.toLowerCase().includes(agent.name.toLowerCase().split(' ')[0])).slice(0, agent.findings);
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

/* ---------- render: header/nav ---------- */

function renderHeader() {
  document.getElementById('runId').textContent = RUN.runId;
  document.getElementById('round').textContent = RUN.round;
  document.getElementById('parallelism').textContent = RUN.parallelism;
  document.getElementById('elapsed').textContent = RUN.elapsed;
  document.getElementById('cost').textContent = RUN.cost;
  document.getElementById('runIdHint').textContent = RUN.runId;
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
        <span class="agent-name">${agent.name}</span>
        <span class="agent-state" style="color:${stateColor(agent.state)}">${stateLabel(agent.state)}</span>
      </div>
      <span class="agent-findings">${agent.findings}</span>
    </div>
    <div class="agent-lens">${agent.lens}</div>
    <div class="agent-foot"><span>${agent.model}</span><span>${agent.elapsed}</span></div>`;
  card.addEventListener('click', () => { STATE.sel = { ...agent, side }; render(); });
  return card;
}

function renderConselho() {
  const cGrid = document.getElementById('claudeGrid'); cGrid.innerHTML = '';
  CLAUDE_AGENTS.forEach(a => cGrid.appendChild(agentCard(a, 'claude')));
  const oGrid = document.getElementById('openaiGrid'); oGrid.innerHTML = '';
  OPENAI_AGENTS.forEach(a => oGrid.appendChild(agentCard(a, 'openai')));

  document.getElementById('claudeDone').textContent = `${CLAUDE_AGENTS.filter(a => a.state === 'done').length}/${CLAUDE_AGENTS.length} concluídos`;
  document.getElementById('openaiDone').textContent = `${OPENAI_AGENTS.filter(a => a.state === 'done').length}/${OPENAI_AGENTS.length} concluídos`;

  const aGrid = document.getElementById('arbiterGrid'); aGrid.innerHTML = '';
  ARBITERS.forEach(a => {
    const card = el('div', 'arbiter-card');
    card.innerHTML = `
      <div class="arbiter-top">
        <span class="arbiter-name">${a.name}</span>
        <span class="arbiter-state" style="color:${stateColor(a.state)}">${stateLabel(a.state)}</span>
      </div>
      <span class="arbiter-model">${a.model}</span>
      <div class="arbiter-role">${a.role}</div>
      <div class="chip-row">${a.chips.map(c => `<span class="chip">${c}</span>`).join('')}</div>`;
    aGrid.appendChild(card);
  });
}

/* ---------- render: view 02 debate ---------- */

function renderDebate() {
  const wrap = document.getElementById('debateList');
  wrap.innerHTML = '';
  DEBATE.forEach(m => {
    const borderColor = m.side === 'claude' ? '#4b6b3d' : '#6b4f33';
    const authorColor = m.side === 'claude' ? 'var(--green-3)' : 'var(--blue)';
    const row = el('div', 'debate-msg');
    row.innerHTML = `
      <span class="debate-time">${m.time}</span>
      <div class="debate-body" style="border-left-color:${borderColor}">
        <div class="debate-head">
          <span class="debate-author" style="color:${authorColor}">${m.author.toUpperCase()}</span>
          <span class="debate-kind">${m.kind}</span>
        </div>
        <div class="debate-text">${m.text}</div>
        ${m.evidence ? `<div class="debate-evidence">${m.evidence}</div>` : ''}
      </div>`;
    wrap.appendChild(row);
  });
}

/* ---------- render: view 04 verify ---------- */

function renderVerify() {
  const summary = document.getElementById('verdictSummary');
  summary.innerHTML = '';
  VERDICT_SUMMARY.forEach(v => {
    const box = el('div', 'verdict-stat');
    box.style.borderColor = v.border;
    box.innerHTML = `<span class="verdict-n" style="color:${v.color}">${v.n}</span><span class="verdict-label">${v.label}</span>`;
    summary.appendChild(box);
  });

  const rows = document.getElementById('claimsRows');
  rows.innerHTML = '';
  CLAIMS.forEach(c => {
    const row = el('div', 'claim-row');
    row.innerHTML = `
      <div class="claim-text">${c.text}</div>
      <div class="claim-origin" style="color:${c.origin.startsWith('Claude') ? 'var(--green-3)' : 'var(--blue)'}">${c.origin}</div>
      <div class="claim-check">${c.check}</div>
      <div><span class="verdict-pill" style="color:${c.color};border-color:${c.border}">${c.verdict}</span></div>`;
    rows.appendChild(row);
  });
}

/* ---------- render: view 05 synth ---------- */

function renderSynth() {
  const wrap = document.getElementById('synthBlocks');
  wrap.innerHTML = '';
  SYNTH_BLOCKS.forEach(b => {
    const block = el('div', 'synth-block');
    const items = b.items.map(it => `
      <div class="synth-item">
        <div class="synth-item-text">${it.text}</div>
        <div class="synth-item-source">${it.source}</div>
      </div>`).join('');
    block.innerHTML = `
      <div class="synth-block-head">
        <span class="synth-tag" style="color:${b.tagColor};border-color:${b.tagBorder}">${b.tag}</span>
        <h3>${b.title}</h3>
      </div>
      ${items}`;
    wrap.appendChild(block);
  });
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
          <div class="sel-eyebrow">${a.side === 'claude' ? 'GRUPO CLAUDE' : 'GRUPO OPENAI'}</div>
          <div class="sel-name">${a.name}</div>
          <div class="sel-meta">${a.model} · ${stateLabel(a.state)}</div>
        </div>
        <button class="btn-close" id="btnCloseSel">FECHAR</button>
      </div>
      <div class="sel-lens">${a.lens}</div>
      <div class="hr"></div>
      <div class="activity-eyebrow">ACHADOS (${a.findings})</div>
      <div style="display:flex;flex-direction:column;gap:9px" id="selFindings"></div>`;

    const findWrap = selPanel.querySelector('#selFindings');
    if (findings.length === 0 && a.findings > 0) {
      findWrap.innerHTML = `<div class="sel-lens">Detalhe consolidado no relatório do juiz — ainda não desmembrado por afirmação individual.</div>`;
    } else if (findings.length === 0) {
      findWrap.innerHTML = `<div class="sel-lens">Nenhum achado reportado por este agente.</div>`;
    } else {
      findings.forEach(f => {
        const card = el('div', 'finding-card');
        card.innerHTML = `
          <div class="finding-top"><span class="sev-pill" style="color:${f.color};border-color:${f.border}">${f.verdict}</span></div>
          <div class="finding-text">${f.text}</div>
          <div class="finding-at">${f.origin}</div>`;
        findWrap.appendChild(card);
      });
    }
    document.getElementById('btnCloseSel').addEventListener('click', () => { STATE.sel = null; render(); });
  } else {
    selPanel.style.display = 'none';
    actPanel.style.display = 'block';
    const list = document.getElementById('activityList');
    list.innerHTML = '';
    ACTIVITY.forEach(a => {
      const item = el('div', 'activity-item');
      item.innerHTML = `<span class="activity-time">${a.time}</span><span class="activity-text">${a.text}</span>`;
      list.appendChild(item);
    });
  }
}

/* ---------- render: export modal ---------- */

function renderModal() {
  const backdrop = document.getElementById('exportModal');
  backdrop.classList.toggle('show', STATE.exportOpen);
  if (!STATE.exportOpen) return;

  const fmt = EXPORT_FORMATS[STATE.exportFormat];
  document.getElementById('modalSub').textContent = `run ${RUN.runId} · rodada ${RUN.round} · escolha o formato de saída`;
  document.getElementById('modalText').textContent = fmt.text;
  document.getElementById('modalPath').textContent = fmt.path;

  const row = document.getElementById('formatRow');
  row.innerHTML = '';
  Object.entries(EXPORT_FORMATS).forEach(([key, f]) => {
    const active = key === STATE.exportFormat;
    const btn = el('button', 'format-btn', f.label);
    btn.style.color = active ? f.color : 'var(--text-6)';
    btn.style.borderColor = active ? f.border : 'var(--border-4)';
    btn.style.background = active ? '#161310' : 'transparent';
    btn.addEventListener('click', () => { STATE.exportFormat = key; STATE.copied = false; render(); });
    row.appendChild(btn);
  });

  const copyBtn = document.getElementById('btnCopy');
  copyBtn.textContent = STATE.copied ? 'Copiado' : 'Copiar';
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

/* ---------- eventos ---------- */

document.getElementById('btnExport').addEventListener('click', () => { STATE.exportOpen = true; STATE.copied = false; render(); });
document.getElementById('btnCloseModal').addEventListener('click', () => { STATE.exportOpen = false; render(); });
document.getElementById('exportModal').addEventListener('click', (e) => {
  if (e.target.id === 'exportModal') { STATE.exportOpen = false; render(); }
});
document.getElementById('btnCopy').addEventListener('click', () => {
  const fmt = EXPORT_FORMATS[STATE.exportFormat];
  navigator.clipboard?.writeText(fmt.text).catch(() => {});
  STATE.copied = true;
  render();
});
document.getElementById('btnDownload').addEventListener('click', () => {
  const fmt = EXPORT_FORMATS[STATE.exportFormat];
  const blob = new Blob([fmt.text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fmt.path.split('/').pop();
  a.click();
  URL.revokeObjectURL(url);
});
document.getElementById('btnInterrupt').addEventListener('click', () => {
  const list = document.getElementById('activityList');
  ACTIVITY.unshift({ time: 'agora', text: 'Rodada interrompida pelo usuário — achados já gravados preservados em .conselho/runs/' + RUN.runId + '/.' });
  render();
});
document.getElementById('draftInput').addEventListener('input', (e) => { STATE.draft = e.target.value; });
document.getElementById('draftInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendDraft(); });
document.getElementById('btnSend').addEventListener('click', sendDraft);

function sendDraft() {
  const input = document.getElementById('draftInput');
  const text = input.value.trim();
  if (!text) return;
  ACTIVITY.unshift({ time: 'agora', text: `Instrução enfileirada para o conselho: "${escapeHtml(text)}"` });
  input.value = '';
  STATE.draft = '';
  render();
}

render();
