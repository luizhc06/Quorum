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

// Ferramentas do contexto extra (--context-path) — mesma ideia do lado
// OpenAI (openai-side/src/tools/index.js): read_file/grep/list_files de
// novo, mas confinadas a uma SEGUNDA raiz separada do código, com nome
// próprio pra deixar claro que não é o código do projeto (ex.: vault do
// Obsidian com notas de PRs/bugs anteriores). Só existem quando uma
// rodada passa --context-path.
const CONTEXT_TOOL_SCHEMAS = [
  {
    name: 'context_read_file',
    description: 'Lê um arquivo dentro do contexto extra (NÃO é o código do projeto — é material de referência, ex.: notas de PRs anteriores, bugs já corrigidos).',
    input_schema: {
      type: 'object',
      properties: { file_path: { type: 'string', description: 'Caminho relativo à raiz do contexto extra, ou absoluto dentro dela.' } },
      required: ['file_path'],
    },
  },
  {
    name: 'context_grep',
    description: 'Busca um padrão de texto (regex) recursivamente nos arquivos do contexto extra (não é o código do projeto).',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Expressão regular a buscar (case-insensitive).' },
        path: { type: 'string', description: 'Subpasta onde buscar. Omitir = raiz do contexto extra.' },
        glob: { type: 'string', description: 'Filtro simples de nome de arquivo, ex: "*.md". Omitir = todos.' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'context_list_files',
    description: 'Lista arquivos e pastas dentro do contexto extra, recursivamente até uma profundidade máxima (não é o código do projeto).',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Subpasta a listar. Omitir = raiz do contexto extra.' },
        max_depth: { type: 'integer', description: 'Profundidade máxima de recursão. Omitir = 3.' },
      },
    },
  },
];

function buildToolset(scopeRoot, runCommandLimits, contextPath) {
  const guardPath = createPathGuard(scopeRoot);
  const handlers = {
    read_file: makeReadFile(guardPath),
    grep: makeGrep(guardPath, scopeRoot),
    list_files: makeListFiles(guardPath, scopeRoot),
    run_command: makeRunCommand(scopeRoot, runCommandLimits),
  };
  let schemas = TOOL_SCHEMAS;
  if (contextPath) {
    const guardContext = createPathGuard(contextPath);
    handlers.context_read_file = makeReadFile(guardContext);
    handlers.context_grep = makeGrep(guardContext, contextPath);
    handlers.context_list_files = makeListFiles(guardContext, contextPath);
    schemas = [...TOOL_SCHEMAS, ...CONTEXT_TOOL_SCHEMAS];
  }
  return { schemas, handlers };
}

module.exports = { buildToolset, TOOL_SCHEMAS };
