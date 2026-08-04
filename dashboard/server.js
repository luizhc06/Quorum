'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 7331;
const PUBLIC_DIR = path.join(__dirname, 'public');
const RUNS_DIR = path.join(__dirname, '..', 'runs');

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

const server = http.createServer((req, res) => {
  const reqPath = req.url.split('?')[0];

  if (reqPath === '/api/runs') {
    return sendJson(res, 200, listRuns());
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
