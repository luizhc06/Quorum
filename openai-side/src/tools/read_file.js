'use strict';
const fs = require('fs');
const { isDenied } = require('../security/secret-denylist');

const MAX_FILE_BYTES = 500_000;

function makeReadFile(guardPath) {
  return async function read_file({ file_path }) {
    const real = guardPath(file_path);
    if (isDenied(real)) {
      throw new Error(`acesso negado: arquivo bloqueado por política de segredo (${file_path})`);
    }
    const stat = fs.statSync(real);
    if (stat.isDirectory()) {
      throw new Error(`"${file_path}" é um diretório — use list_files`);
    }
    if (stat.size > MAX_FILE_BYTES) {
      throw new Error(`arquivo grande demais (${stat.size} bytes) — use grep para buscar um trecho específico`);
    }
    return fs.readFileSync(real, 'utf8');
  };
}

module.exports = { makeReadFile };
