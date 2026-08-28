'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { getProviderHealth } = require('../provider-health');
const { loadSpecialties, loadModelPool, loadRouting, ROUTING_DEFAULTS } = require('../config/specialty-catalog');
const { listOpenRouterModels } = require('../openai-side/src/providers/openrouter');
const { listOmniRouteModels } = require('../openai-side/src/providers/omniroute');
const { sendControl } = require('../control/channel');
const { findModel } = require('../config/specialty-catalog');
const { createRegistry } = require('../providers/registry');
const { createClient: createClaudeClient } = require('../claude-side/engine/client');
const { createClient: createOpenaiClient } = require('../openai-side/src/client');

const PORT = 7331;
const PUBLIC_DIR = path.join(__dirname, 'public');
const RUNS_DIR = path.join(__dirname, '..', 'runs');
const REPO_ROOT = path.join(__dirname, '..');

// Playground: chat avulso com qualquer modelo do pool, sem rodada/tarefa de
// revisão — roda direto neste processo (dashboard/server.js), não no
// orchestrate.js (não há canal de controle envolvido, é síncrono ao pedido
// HTTP). Sessões ficam em runs/_sessions/<id>/ — fora do padrão de nome de
// run real, listRuns() já pula esse diretório explicitamente.
const SESSIONS_DIR = path.join(RUNS_DIR, '_sessions');
const PLAYGROUND_LIMITS = { maxIterations: 10, maxWallClockMs: 120_000, maxOutputTokensPerTurn: 2000, maxToolOutputChars: 15_000, maxCostUsd: 1.0 };

function loadFullLimits() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'limits.json'), 'utf8'));
}
function loadModelsConfig() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'models.json'), 'utf8'));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
  });
  res.end(body);
}

const MAX_BODY_BYTES = 20_000;
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('corpo grande demais')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// Nome de diretório de run: só [a-zA-Z0-9-_], nunca aceita caminho vindo da URL sem checagem.
const RUN_ID_RE = /^[a-zA-Z0-9_-]+$/;

function listRuns() {
  if (!fs.existsSync(RUNS_DIR)) return [];
  const out = [];
  for (const entry of fs.readdirSync(RUNS_DIR, { withFileTypes: true })) {
    if (entry.name === '_sessions') continue; // sessões avulsas do Playground, não são rodadas
    if (!entry.isDirectory() || !RUN_ID_RE.test(entry.name)) continue;
    const statePath = path.join(RUNS_DIR, entry.name, 'state.json');
    if (!fs.existsSync(statePath)) continue;
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      out.push({
        runId: entry.name,
        task: state.run?.task || '',
        status: state.run?.status || 'running',
        startedAt: state.run?.startedAt || null,
      });
    } catch (e) {
      // state.json malformado (rodada sendo escrita agora) — pula, não derruba a listagem.
    }
  }
  out.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  return out;
}

const server = http.createServer(async (req, res) => {
  const reqPath = req.url.split('?')[0];

  if (reqPath === '/api/runs') {
    return sendJson(res, 200, listRuns());
  }

  if (reqPath === '/api/providers' && req.method === 'GET') {
    return sendJson(res, 200, { providers: await getProviderHealth() });
  }

  if (reqPath === '/api/config' && req.method === 'GET') {
    const specialties = loadSpecialties();
    const modelPool = loadModelPool();
    const routing = loadRouting();
    const providerModels = { openrouter: [], omniroute: [] };
    try { providerModels.openrouter = await listOpenRouterModels(); } catch (e) { /* sem chave ou offline — lista vazia, não é erro fatal */ }
    try { providerModels.omniroute = await listOmniRouteModels(routing.omnirouteBaseUrl); } catch (e) { /* gateway local fora do ar */ }
    return sendJson(res, 200, { specialties, modelPool, routing, providerModels });
  }

  // routing.json é o ÚNICO arquivo de config/ que o painel pode escrever —
  // specialties.json/model-pool.json continuam "donos do código". Nenhum
  // segmento de caminho vem do usuário aqui (o destino é sempre este
  // arquivo fixo), então não há traversal a validar, diferente de
  // /api/runs/:id que resolve caminho a partir de entrada do usuário.
  if (reqPath === '/api/config' && req.method === 'POST') {
    let body;
    try { body = await readJsonBody(req); }
    catch (e) { return sendJson(res, 400, { error: 'corpo inválido: ' + e.message }); }

    const modelPool = loadModelPool();
    const knownModelIds = new Set(modelPool.map((m) => m.id));
    const customModels = Array.isArray(body.customModels)
      ? body.customModels
          .filter((m) => m && typeof m.id === 'string' && m.id.trim() && ['openrouter', 'omniroute'].includes(m.provider))
          .map((m) => ({ id: m.id.trim(), provider: m.provider, label: typeof m.label === 'string' && m.label.trim() ? m.label.trim() : m.id.trim(), engine: 'community' }))
      : [];
    const isKnownModel = (id) => knownModelIds.has(id) || customModels.some((m) => m.id === id);

    const judgeModel = typeof body.judgeModel === 'string' && isKnownModel(body.judgeModel) ? body.judgeModel : null;
    const leaderModel = typeof body.leaderModel === 'string' && isKnownModel(body.leaderModel) ? body.leaderModel : null;

    const pinned = {};
    if (body.pinned && typeof body.pinned === 'object') {
      for (const [key, value] of Object.entries(body.pinned)) {
        const models = (Array.isArray(value) ? value : [value]).filter((m) => typeof m === 'string' && isKnownModel(m));
        if (models.length) pinned[key] = models;
      }
    }

    const maxSpecialtiesPerRound = Number.isInteger(body.maxSpecialtiesPerRound) && body.maxSpecialtiesPerRound > 0
      ? Math.min(body.maxSpecialtiesPerRound, 20)
      : ROUTING_DEFAULTS.maxSpecialtiesPerRound;

    const omnirouteBaseUrl = typeof body.omnirouteBaseUrl === 'string' && body.omnirouteBaseUrl.trim()
      ? body.omnirouteBaseUrl.trim()
      : ROUTING_DEFAULTS.omnirouteBaseUrl;

    const routing = {
      _comment: 'Overrides do usuário sobre a alocação dinâmica do conselho. Gravado/lido pelo dashboard via GET/POST /api/config (dashboard/server.js) — nunca edite os outros arquivos de config/ pelo painel, só este. Valores \'null\' significam \'automático\' (o kickoff decide sozinho, ver orchestrate.js::parseAllocation). SEMPRE que presentes, os campos daqui vencem a sugestão do alocador.',
      judgeModel, leaderModel, pinned, maxSpecialtiesPerRound, omnirouteBaseUrl, customModels,
    };
    try {
      fs.writeFileSync(path.join(REPO_ROOT, 'config', 'routing.json'), JSON.stringify(routing, null, 2));
      return sendJson(res, 200, { ok: true, routing });
    } catch (e) {
      return sendJson(res, 503, { error: 'não foi possível gravar config/routing.json agora, tente de novo' });
    }
  }

  if (reqPath === '/api/sessions' && req.method === 'POST') {
    let body = {};
    try { body = await readJsonBody(req); }
    catch (e) { return sendJson(res, 400, { error: 'corpo inválido: ' + e.message }); }
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    if (!model) return sendJson(res, 400, { error: 'model é obrigatório' });
    const routing = loadRouting();
    const modelPool = [...loadModelPool(), ...(routing.customModels || [])];
    if (!findModel(model, { modelPool, routing })) return sendJson(res, 400, { error: `model id "${model}" não reconhecido` });
    const systemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : '';

    const sessionId = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const sessionDir = path.join(SESSIONS_DIR, sessionId);
    const workspaceDir = path.join(sessionDir, 'workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify({ id: sessionId, model, systemPrompt, createdAt: new Date().toISOString() }, null, 2));
    return sendJson(res, 200, { ok: true, sessionId });
  }

  const sessionChatMatch = reqPath.match(/^\/api\/sessions\/([^/]+)\/chat$/);
  if (sessionChatMatch && req.method === 'POST') {
    const sessionId = decodeURIComponent(sessionChatMatch[1]);
    if (!RUN_ID_RE.test(sessionId)) return sendJson(res, 400, { error: 'session id inválido' });
    const sessionDir = path.join(SESSIONS_DIR, sessionId);
    if (!sessionDir.startsWith(SESSIONS_DIR)) return sendJson(res, 403, { error: 'forbidden' });
    const sessionMetaPath = path.join(sessionDir, 'session.json');
    if (!fs.existsSync(sessionMetaPath)) return sendJson(res, 404, { error: 'sessão não encontrada' });

    let body = {};
    try { body = await readJsonBody(req); }
    catch (e) { return sendJson(res, 400, { error: 'corpo inválido: ' + e.message }); }
    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 4000) : '';
    if (!message) return sendJson(res, 400, { error: 'message é obrigatório' });

    const session = JSON.parse(fs.readFileSync(sessionMetaPath, 'utf8'));
    const routing = loadRouting();
    const modelPool = [...loadModelPool(), ...(routing.customModels || [])];
    const models = loadModelsConfig();
    const limits = loadFullLimits();

    let claudeClient = null;
    try { claudeClient = createClaudeClient(); } catch (e) { /* ok — provedor padrão não usa API */ }
    let openaiClient = null;
    try { openaiClient = createOpenaiClient(); } catch (e) { /* ok — provedor padrão não usa API */ }
    const registry = createRegistry({
      scope: path.join(sessionDir, 'workspace'), contextPath: undefined, limits, models, routing, modelPool, claudeClient, openaiClient,
    });

    const chatPath = path.join(sessionDir, 'chat.jsonl');
    const priorLines = fs.existsSync(chatPath)
      ? fs.readFileSync(chatPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];
    fs.appendFileSync(chatPath, `${JSON.stringify({ role: 'user', content: message, ts: Date.now() })}\n`);
    const historyText = priorLines.map((l) => `${l.role === 'user' ? 'Usuário' : 'Você'}: ${l.content}`).join('\n\n');
    const task = historyText ? `Conversa até agora:\n\n${historyText}\n\nNova mensagem do usuário:\n${message}` : message;

    const result = await registry.run(session.model, {
      name: 'playground-chat', persona: session.systemPrompt || 'Você é um assistente técnico útil, direto e honesto sobre incerteza.',
      task, limits: PLAYGROUND_LIMITS, outDir: sessionDir,
    });
    const replyText = result.status === 'ok' ? result.finalText : `(não consegui responder: ${result.reason || result.error || result.status})`;
    fs.appendFileSync(chatPath, `${JSON.stringify({ role: 'assistant', content: replyText, ts: Date.now() })}\n`);
    return sendJson(res, 200, { ok: true, reply: replyText });
  }

  if (reqPath === '/api/rounds' && req.method === 'POST') {
    let body;
    try { body = await readJsonBody(req); }
    catch (e) { return sendJson(res, 400, { error: 'corpo inválido: ' + e.message }); }

    const task = typeof body.task === 'string' ? body.task.trim() : '';
    const scope = typeof body.scope === 'string' ? body.scope.trim() : '';
    const contextPath = typeof body.contextPath === 'string' ? body.contextPath.trim() : '';
    if (!task) return sendJson(res, 400, { error: 'task é obrigatório' });
    if (!scope) return sendJson(res, 400, { error: 'scope (caminho do projeto) é obrigatório' });
    if (!fs.existsSync(scope) || !fs.statSync(scope).isDirectory()) {
      return sendJson(res, 400, { error: `scope não existe ou não é uma pasta: ${scope}` });
    }
    if (contextPath && (!fs.existsSync(contextPath) || !fs.statSync(contextPath).isDirectory())) {
      return sendJson(res, 400, { error: `contextPath não existe ou não é uma pasta: ${contextPath}` });
    }
    let extraAgentsJson = '';
    if (body.extraAgents && (body.extraAgents.claude?.length || body.extraAgents.openai?.length)) {
      extraAgentsJson = JSON.stringify(body.extraAgents);
    }
    const allowedProviders = new Set(
      JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'community-agents.json'), 'utf8')).agents.map((agent) => agent.key)
    );
    const selectedProviders = Array.isArray(body.providers)
      ? body.providers.filter((provider) => typeof provider === 'string' && allowedProviders.has(provider))
      : null;

    const runId = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
    const outDir = path.join(RUNS_DIR, runId);
    fs.mkdirSync(outDir, { recursive: true });

    const logPath = path.join(outDir, 'orchestrate.log');
    const logFd = fs.openSync(logPath, 'a');
    const scriptArgs = ['orchestrate.js', '--scope', scope, '--task', task, '--run-id', runId, '--out', outDir];
    if (contextPath) scriptArgs.push('--context-path', contextPath);
    if (extraAgentsJson) scriptArgs.push('--extra-agents', extraAgentsJson);
    if (selectedProviders) scriptArgs.push('--providers', JSON.stringify(selectedProviders));

    const child = spawn(process.execPath, scriptArgs, {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    });
    child.unref();

    return sendJson(res, 200, { ok: true, runId, log: logPath });
  }

  const noteMatch = reqPath.match(/^\/api\/runs\/([^/]+)\/notes$/);
  if (noteMatch && req.method === 'POST') {
    const runId = decodeURIComponent(noteMatch[1]);
    if (!RUN_ID_RE.test(runId)) return sendJson(res, 400, { error: 'run id inválido' });
    const statePath = path.join(RUNS_DIR, runId, 'state.json');
    if (!statePath.startsWith(RUNS_DIR)) return sendJson(res, 403, { error: 'forbidden' });
    if (!fs.existsSync(statePath)) return sendJson(res, 404, { error: 'run não encontrada' });
    let body;
    try { body = await readJsonBody(req); }
    catch (e) { return sendJson(res, 400, { error: 'corpo inválido: ' + e.message }); }
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : '';
    if (!text) return sendJson(res, 400, { error: 'text é obrigatório' });
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      state.activity = state.activity || [];
      const now = new Date();
      const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      state.activity.unshift({ time, text: `Instrução do usuário: "${text}"` });
      if (state.activity.length > 300) state.activity.length = 300;
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 503, { error: 'não foi possível atualizar state.json agora, tente de novo' });
    }
  }

  const decisionsMatch = reqPath.match(/^\/api\/runs\/([^/]+)\/decisions$/);
  if (decisionsMatch && req.method === 'POST') {
    const runId = decodeURIComponent(decisionsMatch[1]);
    if (!RUN_ID_RE.test(runId)) return sendJson(res, 400, { error: 'run id inválido' });
    const statePath = path.join(RUNS_DIR, runId, 'state.json');
    if (!statePath.startsWith(RUNS_DIR)) return sendJson(res, 403, { error: 'forbidden' });
    if (!fs.existsSync(statePath)) return sendJson(res, 404, { error: 'run não encontrada' });
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      return sendJson(res, 400, { error: 'corpo inválido: ' + e.message });
    }
    const { key, status: decisionStatus, note } = body;
    if (typeof key !== 'string' || !key) return sendJson(res, 400, { error: 'key é obrigatório' });
    if (!['implementar', 'revisar', null].includes(decisionStatus)) return sendJson(res, 400, { error: 'status inválido' });
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      state.decisions = state.decisions || {};
      if (decisionStatus === null) {
        delete state.decisions[key];
      } else {
        state.decisions[key] = { status: decisionStatus, note: typeof note === 'string' ? note.slice(0, 2000) : '', updatedAt: new Date().toISOString() };
      }
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
      return sendJson(res, 200, { ok: true, decisions: state.decisions });
    } catch (e) {
      return sendJson(res, 503, { error: 'não foi possível atualizar state.json agora, tente de novo' });
    }
  }

  // Nome de agente/especialista: mesmo charset de RUN_ID_RE — nunca aceita
  // caminho vindo da URL sem checagem.
  const AGENT_KEY_RE = /^[a-zA-Z0-9_-]+$/;

  const streamMatch = reqPath.match(/^\/api\/runs\/([^/]+)\/stream$/);
  if (streamMatch && req.method === 'GET') {
    const runId = decodeURIComponent(streamMatch[1]);
    if (!RUN_ID_RE.test(runId)) return sendJson(res, 400, { error: 'run id inválido' });
    const outDir = path.join(RUNS_DIR, runId);
    if (!outDir.startsWith(RUNS_DIR)) return sendJson(res, 403, { error: 'forbidden' });
    const eventsPath = path.join(outDir, 'events.ndjson');
    const filterKey = new URL(req.url, 'http://localhost').searchParams.get('key');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      ...SECURITY_HEADERS,
    });
    res.write(': conectado\n\n');

    // Tail por polling (não fs.watch — o arquivo pode nem existir ainda
    // quando o painel conecta, antes do kickoff terminar de alocar
    // especialistas). Só lê os bytes novos desde a última checagem.
    let offset = 0;
    let closed = false;
    const timer = setInterval(() => {
      if (closed) return;
      fs.stat(eventsPath, (err, stat) => {
        if (closed || err || stat.size <= offset) return;
        const stream = fs.createReadStream(eventsPath, { start: offset, end: stat.size - 1, encoding: 'utf8' });
        let buf = '';
        stream.on('data', (chunk) => { buf += chunk; });
        stream.on('end', () => {
          offset = stat.size;
          for (const line of buf.split('\n')) {
            if (!line.trim()) continue;
            let evt;
            try { evt = JSON.parse(line); } catch (e) { continue; }
            if (filterKey && evt.key !== filterKey) continue;
            res.write(`data: ${JSON.stringify(evt)}\n\n`);
          }
        });
        stream.on('error', () => { /* leitura concorrente com a escrita — tenta de novo no próximo tick */ });
      });
    }, 500);
    req.on('close', () => { closed = true; clearInterval(timer); });
    return;
  }

  const controlActionMatch = reqPath.match(/^\/api\/runs\/([^/]+)\/agents\/([^/]+)\/(pause|resume|cancel|reassign|limits|chat)$/);
  if (controlActionMatch && req.method === 'POST') {
    const runId = decodeURIComponent(controlActionMatch[1]);
    const agentKey = decodeURIComponent(controlActionMatch[2]);
    const action = controlActionMatch[3];
    if (!RUN_ID_RE.test(runId)) return sendJson(res, 400, { error: 'run id inválido' });
    if (!AGENT_KEY_RE.test(agentKey)) return sendJson(res, 400, { error: 'agent key inválido' });
    const outDir = path.join(RUNS_DIR, runId);
    if (!outDir.startsWith(RUNS_DIR)) return sendJson(res, 403, { error: 'forbidden' });

    let body = {};
    try { body = await readJsonBody(req); }
    catch (e) { return sendJson(res, 400, { error: 'corpo inválido: ' + e.message }); }

    let message;
    if (action === 'reassign') {
      const model = typeof body.model === 'string' ? body.model.trim() : '';
      if (!model) return sendJson(res, 400, { error: 'model é obrigatório' });
      message = { type: 'reassign', key: agentKey, model };
    } else if (action === 'limits') {
      const patch = {};
      for (const field of ['maxIterations', 'maxWallClockMs', 'maxOutputTokensPerTurn', 'maxCostUsd']) {
        if (typeof body[field] === 'number') patch[field] = body[field];
      }
      message = { type: 'limits', key: agentKey, patch };
    } else if (action === 'chat') {
      const msg = typeof body.message === 'string' ? body.message.trim().slice(0, 4000) : '';
      if (!msg) return sendJson(res, 400, { error: 'message é obrigatório' });
      message = { type: 'chat', key: agentKey, message: msg };
    } else {
      message = { type: action, key: agentKey };
    }

    const result = await sendControl(outDir, message, { timeoutMs: action === 'chat' ? 120_000 : 5000 });
    return sendJson(res, result.ok ? 200 : 409, result);
  }

  const runMatch = reqPath.match(/^\/api\/runs\/([^/]+)$/);
  if (runMatch) {
    const runId = decodeURIComponent(runMatch[1]);
    if (!RUN_ID_RE.test(runId)) return sendJson(res, 400, { error: 'run id inválido' });
    const statePath = path.join(RUNS_DIR, runId, 'state.json');
    if (!statePath.startsWith(RUNS_DIR)) return sendJson(res, 403, { error: 'forbidden' });
    if (!fs.existsSync(statePath)) return sendJson(res, 404, { error: 'run não encontrada' });
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      return sendJson(res, 200, state);
    } catch (e) {
      return sendJson(res, 503, { error: 'state.json sendo escrito agora, tente de novo' });
    }
  }

  const relativePath = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relativePath);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      ...SECURITY_HEADERS,
    });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dashboard] Conselho rodando em http://localhost:${PORT}`);
  console.log(`[dashboard] lendo rodadas reais de ${RUNS_DIR}`);
});
