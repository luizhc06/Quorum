'use strict';
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', 'dist', 'build', 'runs']);
const MAX_ENTRIES = 2000;

function makeListFiles(guardPath, scopeRoot) {
  return async function list_files({ path: subPath, max_depth }) {
    const startDir = subPath == null ? guardPath(scopeRoot) : guardPath(subPath);
    const depth = typeof max_depth === 'number' && max_depth != null ? max_depth : 3;
    const out = [];

    function walk(dir, level) {
      if (level > depth || out.length >= MAX_ENTRIES) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) {
        return;
      }
      for (const entry of entries) {
        if (out.length >= MAX_ENTRIES) return;
        if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        out.push(path.relative(scopeRoot, full).split(path.sep).join('/') + (entry.isDirectory() ? '/' : ''));
        if (entry.isDirectory()) walk(full, level + 1);
      }
    }
    walk(startDir, 0);
    return out.length ? out.join('\n') : '(vazio)';
  };
}

module.exports = { makeListFiles };
