'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = 7331;
const PUBLIC_DIR = path.join(__dirname, 'public');
const RUNS_DIR = path.join(__dirname, '..', 'runs');
const REPO_ROOT = path.join(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
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

    const runId = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
    const outDir = path.join(RUNS_DIR, runId);
    fs.mkdirSync(outDir, { recursive: true });

    const logPath = path.join(outDir, 'orchestrate.log');
    const logFd = fs.openSync(logPath, 'a');
    const scriptArgs = ['orchestrate.js', '--scope', scope, '--task', task, '--run-id', runId, '--out', outDir];
    if (contextPath) scriptArgs.push('--context-path', contextPath);
    if (extraAgentsJson) scriptArgs.push('--extra-agents', extraAgentsJson);

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

  let filePath = path.join(PUBLIC_DIR, reqPath === '/' ? '/index.html' : reqPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
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
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`[dashboard] Conselho rodando em http://localhost:${PORT}`);
  console.log(`[dashboard] lendo rodadas reais de ${RUNS_DIR}`);
});
