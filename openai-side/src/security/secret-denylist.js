'use strict';

/**
 * Bloqueia leitura de qualquer arquivo cujo NOME (não conteúdo) sugira
 * credencial — aplicado por cima do confinamento de path-guard.js, não no
 * lugar dele. Achado real desta sessão: agentes exploram amplamente e
 * "leem o que encontram" mesmo sem serem instruídos a procurar segredo —
 * a denylist é a última linha de defesa quando isso acontece por acidente.
 */
const DENY_PATTERNS = [
  /(^|[\\/])\.env(\..+)?$/i,
  /credencia/i,
  /credential/i,
  /\bsenha/i,
  /password/i,
  /\bsecret/i,
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /id_rsa/i,
  /\.ppk$/i,
];

function isDenied(filePath) {
  return DENY_PATTERNS.some((re) => re.test(filePath));
}

module.exports = { isDenied, DENY_PATTERNS };
