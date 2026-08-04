'use strict';
const { createPathGuard } = require('../security/path-guard');
const { makeReadFile } = require('./read_file');
const { makeGrep } = require('./grep');
const { makeListFiles } = require('./list_files');
const { makeRunCommand } = require('./run_command');

// strict:true (Responses API) exige que TODO campo, mesmo opcional, apareça
// em "required" — o modelo sempre manda a chave, usando null quando não
// informado. Os handlers tratam null e undefined da mesma forma.
const TOOL_SCHEMAS = [
  {
    type: 'function',
    name: 'read_file',
    description: 'Lê o conteúdo completo de um arquivo de texto dentro do escopo permitido.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Caminho relativo à raiz do escopo, ou absoluto dentro dela.' },
      },
      required: ['file_path'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'grep',
    description: 'Busca um padrão de texto (regex) recursivamente nos arquivos dentro do escopo.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Expressão regular a buscar (case-insensitive).' },
        path: { type: ['string', 'null'], description: 'Subpasta onde buscar. null = raiz do escopo.' },
        glob: { type: ['string', 'null'], description: 'Filtro simples de nome de arquivo, ex: "*.php". null = todos.' },
      },
      required: ['pattern', 'path', 'glob'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'list_files',
    description: 'Lista arquivos e pastas dentro do escopo, recursivamente até uma profundidade máxima.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: ['string', 'null'], description: 'Subpasta a listar. null = raiz do escopo.' },
        max_depth: { type: ['integer', 'null'], description: 'Profundidade máxima de recursão. null = 3.' },
      },
      required: ['path', 'max_depth'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'run_command',
    description:
      'Roda um comando de leitura/diagnóstico dentro do escopo (ex.: git log, npm test). ' +
      'Só binários de uma allowlist são permitidos; nenhum operador de shell (&&, |, ;, etc) funciona.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Comando completo, ex: "git log --oneline -10".' },
      },
      required: ['command'],
      additionalProperties: false,
    },
    strict: true,
  },
];

function buildToolset(scopeRoot, runCommandLimits) {
  const guardPath = createPathGuard(scopeRoot);
  const handlers = {
    read_file: makeReadFile(guardPath),
    grep: makeGrep(guardPath, scopeRoot),
    list_files: makeListFiles(guardPath, scopeRoot),
    run_command: makeRunCommand(scopeRoot, runCommandLimits),
  };
  return { schemas: TOOL_SCHEMAS, handlers };
}

module.exports = { buildToolset, TOOL_SCHEMAS };
