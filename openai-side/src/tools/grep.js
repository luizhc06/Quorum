'use strict';
const fs = require('fs');
const path = require('path');
const { isDenied } = require('../security/secret-denylist');

const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', 'dist', 'build', 'runs']);
const MAX_MATCHES = 200;
const MAX_LINE_CHARS = 200;

function matchesGlob(filename, glob) {
  if (!glob) return true;
  if (glob.startsWith('*.')) return filename.endsWith(glob.slice(1));
  return filename.includes(glob);
}

function makeGrep(guardPath, scopeRoot) {
  return async function grep({ pattern, path: subPath, glob }) {
    if (!pattern) throw new Error('pattern é obrigatório');
    const startDir = subPath == null ? guardPath(scopeRoot) : guardPath(subPath);
    let re;
    try {
      re = new RegExp(pattern, 'i');
    } catch (e) {
      throw new Error(`regex inválida: ${e.message}`);
    }
    const matches = [];

    function walk(dir) {
      if (matches.length >= MAX_MATCHES) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) {
        return;
      }
      for (const entry of entries) {
        if (matches.length >= MAX_MATCHES) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          walk(full);
        } else if (entry.isFile()) {
          if (!matchesGlob(entry.name, glob)) continue;
          if (isDenied(full)) continue;
          let content;
          try {
            content = fs.readFileSync(full, 'utf8');
          } catch (e) {
            continue;
          }
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= MAX_MATCHES) break;
            if (re.test(lines[i])) {
              const rel = path.relative(scopeRoot, full).split(path.sep).join('/');
              matches.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, MAX_LINE_CHARS)}`);
            }
          }
        }
      }
    }
    walk(startDir);
    return matches.length ? matches.join('\n') : '(nenhum resultado)';
  };
}

module.exports = { makeGrep };
