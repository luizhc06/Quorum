'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;

function commandProbe(command, args = ['--version']) {
  const options = { encoding: 'utf8', timeout: 4000, windowsHide: true, shell: false };
  // npm instala CLIs como wrappers .cmd no Windows. spawnSync não executa
  // esses wrappers diretamente; cmd.exe é usado apenas com nomes/flags
  // constantes e validados, nunca com entrada do usuário.
  const isSafeToken = (value) => /^[a-zA-Z0-9._:@/\\-]+$/.test(value);
  const result = process.platform === 'win32' && isSafeToken(command) && args.every(isSafeToken)
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${command} ${args.join(' ')}`], options)
    : spawnSync(command, args, options);
  if (result.error) return { available: false, detail: result.error.code === 'ENOENT' ? 'não instalado' : result.error.message };
  if (result.status !== 0) return { available: false, detail: 'não instalado ou indisponível' };
  const firstLine = `${result.stdout || result.stderr || ''}`.trim().split(/\r?\n/)[0];
  return { available: true, detail: firstLine || 'disponível' };
}

function ollamaProbe(model) {
  const base = commandProbe('ollama');
  if (!base.available) return base;
  const list = spawnSync('ollama', ['list'], { encoding: 'utf8', timeout: 5000, windowsHide: true, shell: false });
  const output = list.stdout || '';
  const modelAvailable = output.split(/\r?\n/).some((line) => line.trim().startsWith(model));
  return {
    available: modelAvailable,
    runtimeAvailable: true,
    detail: modelAvailable ? `${model} pronto` : `${model} ainda não baixado`,
  };
}

function getProviderHealth() {
  const community = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'community-agents.json'), 'utf8')).agents;
  const fixed = [
    { key: 'claude-local', name: 'Claude Code', model: 'configuração local', free: 'Usa a sessão local autenticada.', ...commandProbe('claude') },
    { key: 'codex-local', name: 'Codex', model: 'configuração local', free: 'Usa a sessão local autenticada.', ...commandProbe('codex') },
    {
      key: 'nvidia-nim', name: 'NVIDIA / Nemotron', model: 'Nemotron 3 Super',
      free: 'NVIDIA NIM free tier; sujeito à quota.',
      available: Boolean(process.env.NVIDIA_API_KEY), detail: process.env.NVIDIA_API_KEY ? 'chave configurada' : 'NVIDIA_API_KEY ausente',
    },
  ];
  const optional = community.map((spec) => {
    const probe = spec.provider === 'ollama' ? ollamaProbe(spec.model) : commandProbe('agy');
    return { key: spec.key, name: spec.name, model: spec.model, provider: spec.provider, free: spec.free, ...probe };
  });
  return [...fixed, ...optional];
}

module.exports = { commandProbe, ollamaProbe, getProviderHealth };
