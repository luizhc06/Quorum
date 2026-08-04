'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Confina toda leitura/escuta ao --scope informado na linha de comando.
 * Resolve o caminho real (segue symlink) e rejeita qualquer coisa que
 * escape da raiz depois de resolvido — inclusive symlink apontando pra
 * fora, path absoluto de outro drive no Windows, e "..".
 */
function createPathGuard(scopeRoot) {
  const realScopeRoot = fs.realpathSync(path.resolve(scopeRoot));

  return function guardPath(inputPath) {
    if (typeof inputPath !== 'string' || inputPath.trim() === '') {
      throw new Error('caminho vazio ou inválido');
    }
    const resolved = path.isAbsolute(inputPath) ? inputPath : path.join(realScopeRoot, inputPath);

    let real;
    try {
      real = fs.realpathSync(resolved);
    } catch (e) {
      // arquivo pode não existir ainda — normaliza sem exigir existência
      real = path.resolve(resolved);
    }

    const rel = path.relative(realScopeRoot, real);
    const escapou = rel === '' ? false : rel.startsWith('..') || path.isAbsolute(rel);
    if (escapou) {
      throw new Error(`caminho fora do escopo permitido (--scope): ${inputPath}`);
    }
    return real;
  };
}

module.exports = { createPathGuard };
