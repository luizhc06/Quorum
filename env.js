'use strict';
const fs = require('fs');
const path = require('path');

// Loader mínimo de .env — sem dependência nova (nada como o pacote `dotenv`
// pra um formato KEY=value tão simples). Só preenche o que ainda não está
// definido no ambiente real, então uma variável já exportada pelo SO sempre
// vence o arquivo (mesma prioridade que o dotenv real usa).
function loadEnvFile(rootDir) {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) return;
  let raw = fs.readFileSync(envPath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // remove BOM, se tiver
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

module.exports = { loadEnvFile };
