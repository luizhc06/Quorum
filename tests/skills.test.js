'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadSkill, loadSkillSet, stripFrontmatter } = require('../openai-side/src/skills/registry');

test('carrega e remove frontmatter de uma skill versionada', () => {
  const skill = loadSkill('security-audit');
  assert.equal(skill.id, 'security-audit');
  assert.match(skill.prompt, /Auditoria de segurança/);
  assert.doesNotMatch(skill.prompt, /^---/);
});

test('deduplica skill sets', () => {
  const skills = loadSkillSet(['performance', 'performance', 'token-economy']);
  assert.deepEqual(skills.map((skill) => skill.id), ['performance', 'token-economy']);
});

test('bloqueia traversal no id da skill', () => {
  assert.throws(() => loadSkill('../segredo'), /skill inválida/);
});

test('todas as skills configuradas existem', () => {
  const root = path.resolve(__dirname, '..');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'community-agents.json'), 'utf8'));
  const ids = config.agents.flatMap((agent) => agent.skills || []);
  assert.doesNotThrow(() => loadSkillSet(ids));
});

test('stripFrontmatter preserva markdown sem metadados', () => {
  assert.equal(stripFrontmatter('# Título\ntexto'), '# Título\ntexto');
});
