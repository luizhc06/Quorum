'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Grava o resultado de um agente em dois formatos: .json (auditoria
 * completa, machine-readable) e .md (o texto limpo que vira contexto pro
 * juiz/verificador do lado Claude — Claude Code nunca chama a API da
 * OpenAI diretamente, só lê arquivo). A chave da API nunca passa por aqui
 * — ela vai só como header HTTP dentro do SDK, nunca em log.
 */
function writeAgentResult(outDir, agentName, result) {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${agentName}.json`);
  const mdPath = path.join(outDir, `${agentName}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');

  const md = [
    `# ${agentName}`,
    '',
    `**Status:** ${result.status}`,
    result.status !== 'ok' ? `**Motivo:** ${result.reason || result.error || 'não especificado'}` : '',
    `**Modelo:** ${result.model || 'n/a'}`,
    `**Chamadas de ferramenta:** ${result.iterations ?? 'n/a'}`,
    '',
    '---',
    '',
    result.finalText || '(sem texto final — ver .json para detalhe do erro)',
  ]
    .filter(Boolean)
    .join('\n');

  fs.writeFileSync(mdPath, md, 'utf8');
  return { jsonPath, mdPath };
}

module.exports = { writeAgentResult };
