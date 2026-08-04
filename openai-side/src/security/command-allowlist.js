'use strict';

// Só binários nativos (.exe) — no Windows, .cmd/.bat (npm, composer via
// installer padrão) exigem shell:true pra rodar, o que reabriria a
// superfície de shell injection que execFile sem shell fecha de propósito
// (ver run_command.js). Confirmado por teste real (04/08/2026): não há
// workaround seguro sem afrouxar essa garantia.
const ALLOWED_BINARIES = ['git', 'node', 'php'];
// execFile (usado em run_command.js) já não passa por shell nenhum — isto é
// defesa em profundidade, não a única barreira contra shell injection.
const FORBIDDEN_OPERATORS = /[&|;`$()<>]/;

function checkCommand(command) {
  if (typeof command !== 'string' || command.trim() === '') {
    throw new Error('comando vazio');
  }
  if (FORBIDDEN_OPERATORS.test(command)) {
    throw new Error('comando contém operador de shell não permitido (& | ; ` $ ( ) < >)');
  }
  const firstToken = command.trim().split(/\s+/)[0];
  const binary = firstToken.split(/[\\/]/).pop();
  if (!ALLOWED_BINARIES.includes(binary)) {
    throw new Error(`binário não permitido: "${binary}". Permitidos: ${ALLOWED_BINARIES.join(', ')}`);
  }
  return true;
}

module.exports = { checkCommand, ALLOWED_BINARIES };
