'use strict';
const fs = require('fs');
const path = require('path');

// "Chat local" por agente — mesmo espírito de como o próprio Claude Code
// guarda suas sessões: um .jsonl append-only, uma linha por turno
// (user/assistant/tool_result), legível depois sem precisar re-rodar nada.
function createTranscriptLogger(outDir, agentName) {
  const dir = path.join(outDir, 'chats');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${agentName}.jsonl`);
  return {
    filePath,
    append(line) {
      fs.appendFileSync(filePath, JSON.stringify(line) + '\n');
    },
  };
}

module.exports = { createTranscriptLogger };
