#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const targets = {
  openai: path.join(root, 'openai-side'),
  claude: path.join(root, 'claude-side', 'engine'),
};

const selected = process.argv[2] ? [process.argv[2]] : Object.keys(targets);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath não encontrado; execute este instalador via npm run install:all');

for (const key of selected) {
  const cwd = targets[key];
  if (!cwd) throw new Error(`alvo de instalação desconhecido: ${key}`);
  const env = { ...process.env };
  delete env.npm_config_local_prefix;
  delete env.NPM_CONFIG_LOCAL_PREFIX;
  delete env.npm_config_allow_scripts;
  delete env.NPM_CONFIG_ALLOW_SCRIPTS;
  delete env.npm_package_json;
  delete env.NPM_PACKAGE_JSON;
  const result = spawnSync(process.execPath, [npmCli, 'install', '--ignore-scripts'], {
    cwd, env, stdio: 'inherit', windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
