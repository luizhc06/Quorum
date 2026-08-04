'use strict';
// Reaproveita as guardas de segurança e os handlers do lado OpenAI —
// path-guard/secret-denylist/command-allowlist e a lógica de read_file/grep/
// list_files/run_command são independentes de fornecedor (só recebem um
// scopeRoot e devolvem texto). Só o formato de schema muda: Anthropic usa
// `input_schema` sem exigir modo strict com uniões [tipo, "null"].
const { createPathGuard } = require('../../openai-side/src/security/path-guard');
const { makeReadFile } = require('../../openai-side/src/tools/read_file');
const { makeGrep } = require('../../openai-side/src/tools/grep');
const { makeListFiles } = require('../../openai-side/src/tools/list_files');
const { makeRunCommand } = require('../../openai-side/src/tools/run_command');

const TOOL_SCHEMAS = [
  {
    name: 'read_file',
    description: 'Lê o conteúdo completo de um arquivo de texto dentro do escopo permitido.',
    input_schema: {
      type: 'object',
      properties: { file_path: { type: 'string', description: 'Caminho relativo à raiz do escopo, ou absoluto dentro dela.' } },
      required: ['file_path'],
    },
  },
  {
    name: 'grep',
    description: 'Busca um padrão de texto (regex) recursivamente nos arquivos dentro do escopo.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Expressão regular a buscar (case-insensitive).' },
        path: { type: 'string', description: 'Subpasta onde buscar. Omitir = raiz do escopo.' },
        glob: { type: 'string', description: 'Filtro simples de nome de arquivo, ex: "*.php". Omitir = todos.' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'list_files',
    description: 'Lista arquivos e pastas dentro do escopo, recursivamente até uma profundidade máxima.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Subpasta a listar. Omitir = raiz do escopo.' },
        max_depth: { type: 'integer', description: 'Profundidade máxima de recursão. Omitir = 3.' },
      },
    },
  },
  {
    name: 'run_command',
    description: 'Roda um comando de leitura/diagnóstico dentro do escopo (ex.: git log). Só binários de uma allowlist são permitidos; nenhum operador de shell funciona.',
    input_schema: {
      type: 'object',
      properties: { command: { type: 'string', description: 'Comando completo, ex: "git log --oneline -10".' } },
      required: ['command'],
    },
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
