'use strict';
// Canal de controle entre o dashboard (dashboard/server.js) e uma rodada em
// andamento (orchestrate.js). orchestrate.js roda como processo filho
// DESTACADO (spawn(..., {detached:true}); child.unref()) de propósito —
// reiniciar o dashboard não pode matar uma rodada em andamento. Sem
// referência de processo compartilhada, o controle (pausar/cancelar/trocar
// modelo/ajustar limite/conversar) vira um servidor TCP em loopback que o
// próprio orchestrate.js abre numa porta efêmera, gravada em
// runs/<id>/control.port; o dashboard é só um proxy fino que conecta, manda
// um comando JSON de uma linha, lê a resposta, fecha.
const net = require('net');
const fs = require('fs');
const path = require('path');

function controlPortPath(outDir) {
  return path.join(outDir, 'control.port');
}

// Usado por orchestrate.js. `onCommand(msg)` pode ser síncrono ou devolver
// uma Promise; o retorno é serializado como `{ok:true, ...retorno}\n`. Uma
// exceção lançada/rejeitada vira `{ok:false, error}\n` — nunca derruba o
// servidor nem a rodada.
function startControlServer(outDir, onCommand) {
  const server = net.createServer((socket) => {
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch (e) {
          socket.write(`${JSON.stringify({ ok: false, error: 'json inválido' })}\n`);
          continue;
        }
        Promise.resolve()
          .then(() => onCommand(msg))
          .then((result) => socket.write(`${JSON.stringify({ ok: true, ...result })}\n`))
          .catch((err) => socket.write(`${JSON.stringify({ ok: false, error: err.message })}\n`));
      }
    });
    socket.on('error', () => { /* cliente desconectou no meio — ignora */ });
  });
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    fs.writeFileSync(controlPortPath(outDir), String(port));
  });
  server.on('error', () => { /* porta indisponível — controle fica fora do ar, a rodada continua normalmente */ });
  return server;
}

// Usado por dashboard/server.js. NUNCA lança — sempre devolve {ok, ...}, pra
// quem chama poder tratar "rodada não está mais ativa" como resposta normal,
// não exceção.
function sendControl(outDir, message, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    let port;
    try {
      port = Number(fs.readFileSync(controlPortPath(outDir), 'utf8').trim());
    } catch (e) {
      return resolve({ ok: false, error: 'run não está mais ativo (control.port ausente)' });
    }
    if (!Number.isInteger(port) || port <= 0) {
      return resolve({ ok: false, error: 'control.port inválido' });
    }
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'controle não respondeu a tempo' }), timeoutMs);
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(`${JSON.stringify(message)}\n`);
    });
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl >= 0) {
        try {
          finish(JSON.parse(buf.slice(0, nl)));
        } catch (e) {
          finish({ ok: false, error: 'resposta inválida do controle' });
        }
      }
    });
    socket.on('error', (err) => finish({ ok: false, error: `run não está mais ativo (${err.code || err.message})` }));
  });
}

module.exports = { startControlServer, sendControl, controlPortPath };
