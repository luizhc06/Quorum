'use strict';

const fs = require('fs');
const path = require('path');

const SKILL_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DEFAULT_SKILLS_DIR = path.resolve(__dirname, '..', '..', '..', '.agents', 'skills');

function stripFrontmatter(markdown) {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
}

function loadSkill(skillId, skillsDir = DEFAULT_SKILLS_DIR) {
  if (!SKILL_ID_RE.test(skillId)) throw new Error(`skill inválida: ${skillId}`);
  const root = path.resolve(skillsDir);
  const filePath = path.resolve(root, skillId, 'SKILL.md');
  if (!filePath.startsWith(root + path.sep)) throw new Error(`skill fora do diretório permitido: ${skillId}`);
  if (!fs.existsSync(filePath)) throw new Error(`skill não encontrada: ${skillId}`);
  return { id: skillId, prompt: stripFrontmatter(fs.readFileSync(filePath, 'utf8')) };
}

function loadSkillSet(skillIds = [], skillsDir = DEFAULT_SKILLS_DIR) {
  const uniqueIds = [...new Set(skillIds)];
  return uniqueIds.map((id) => loadSkill(id, skillsDir));
}

function formatSkillSet(skills) {
  if (!skills.length) return '';
  return `\n\n## Skills aplicadas nesta execução\n\n${skills.map((skill) => `### ${skill.id}\n${skill.prompt}`).join('\n\n')}`;
}

module.exports = { DEFAULT_SKILLS_DIR, loadSkill, loadSkillSet, formatSkillSet, stripFrontmatter };
