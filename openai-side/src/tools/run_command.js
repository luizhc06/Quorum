'use strict';
const { execFile } = require('child_process');
const { checkCommand } = require('../security/command-allowlist');

/**
 * execFile (não exec/spawn com shell:true) NUNCA passa o comando por um
 * shell — os operadores bloqueados em command-allowlist.js são defesa em
 * profundidade, não a única barreira: mesmo que um passasse pelo regex,
 * não haveria shell nenhum pra interpretá-lo como injeção.
 *
 * Por isso a allowlist (command-allowlist.js) só tem binários nativos
 * (.exe) — no Windows, .cmd/.bat (ex.: npm, composer via installer padrão)
 * SÓ rodam com shell:true, que reabriria a superfície de injeção. Testado
 * e confirmado (04/08/2026): tentar resolver pra "npm.cmd" direto no
 * execFile falha com EINVAL, não é workaround viável sem shell:true.
 * Agentes que precisam avaliar dependências leem package.json/composer.json
 * via read_file em vez de rodar o instalador.
 */
function makeRunCommand(scopeRoot, limits) {
  return function run_command({ command }) {
    checkCommand(command);
    const parts = command.trim().split(/\s+/);
    const bin = parts[0];
    const args = parts.slice(1);

    return new Promise((resolve) => {
      execFile(
        bin,
        args,
        {
          cwd: scopeRoot,
          timeout: limits.timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
        },
        (err, stdout, stderr) => {
          const combined = (stdout || '') + (stderr ? `\n[stderr]\n${stderr}` : '');
          const truncated =
            combined.length > limits.maxOutputChars
              ? combined.slice(0, limits.maxOutputChars) + '\n...(saída truncada)'
              : combined;
          if (err && err.killed) {
            resolve(`ERROR: comando excedeu o tempo limite (${limits.timeoutMs}ms)`);
          } else if (err) {
            resolve(`EXIT ${err.code ?? '?'}\n${truncated}`);
          } else {
            resolve(truncated || '(sem saída)');
          }
        }
      );
    });
  };
}

module.exports = { makeRunCommand };
