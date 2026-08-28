'use strict';
// Log de eventos ao vivo de uma rodada — runs/<id>/events.ndjson, uma linha
// JSON por evento, append-only. dashboard/server.js faz tail desse arquivo
// pra alimentar o SSE (GET /api/runs/:id/stream). Escrita é best-effort: um
// erro aqui nunca derruba a rodada, só perde aquele evento de progresso.
const fs = require('fs');

function writeEvent(eventsPath, evt) {
  try {
    fs.appendFileSync(eventsPath, `${JSON.stringify({ ts: Date.now(), ...evt })}\n`);
  } catch (e) {
    // best-effort — ver comentário acima
  }
}

// Emissor já amarrado a uma `key` (nome do especialista/agente), pra quem
// chama não repetir `key` em todo evento.
function createEventEmitter(eventsPath, key) {
  return (evt) => writeEvent(eventsPath, { key, ...evt });
}

module.exports = { writeEvent, createEventEmitter };
