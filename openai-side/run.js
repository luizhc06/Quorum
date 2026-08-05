#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { createClient } = require('./src/client');
const { runAgentLoop, AgentAbortedError } = require('./src/agent-loop');
const { buildToolset } = require('./src/tools');
const { writeAgentResult } = require('./src/log');
const { runOrchestration } = require('./src/orchestrator');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.scope || !args.task || !args.out) {
    console.error('Uso: node run.js --scope <dir> --task "<descrição>" --out <dir> [--agent-name <nome>] [--model <id>] [--prompt <texto>]');
    process.exit(1);
  }

  const repoRoot = path.resolve(__dirname, '..');
  const models = loadJson(path.join(repoRoot, 'config', 'models.json'));
  const limits = loadJson(path.join(repoRoot, 'config', 'limits.json'));
  const outputContract = fs.readFileSync(path.join(repoRoot, 'contracts', 'output-contract.md'), 'utf8');

  const scope = path.resolve(args.scope);
  if (!fs.existsSync(scope) || !fs.statSync(scope).isDirectory()) {
    console.error(`--scope não existe ou não é um diretório: ${scope}`);
    process.exit(1);
  }

  const outDir = path.resolve(args.out);

  if (args['agent-name']) {
    // Modo de teste/depuração do motor openai-api especificamente — sempre
    // exige OPENAI_API_KEY, mesmo com o padrão geral agora sendo codex-local.
    const client = createClient();
    const agentName = args['agent-name'];
    const model = args.model || models.openai_specialists;
    const systemPrompt =
      args.prompt ||
      `Você é o agente "${agentName}" de um conselho de revisão de código. Explore o código real dentro do escopo usando as ferramentas disponíveis antes de concluir qualquer coisa — nunca opine sem checar. Ao final, siga este contrato de saída:\n\n${outputContract}`;

    const { schemas, handlers } = buildToolset(scope, limits.run_command);
    console.log(`[${agentName}] modelo=${model} escopo=${scope}`);

    const startedAt = Date.now();
    let result;
    try {
      const loopResult = await runAgentLoop({
        client,
        model,
        systemPrompt,
        userPrompt: args.task,
        tools: schemas,
        toolHandlers: handlers,
        limits: limits.openai_specialist,
        onEvent: (ev) => console.log(`[${agentName}] evento:`, ev),
      });
      result = { agent: agentName, model, ...loopResult, elapsedMs: Date.now() - startedAt };
    } catch (err) {
      result =
        err instanceof AgentAbortedError
          ? { agent: agentName, model, status: 'failed', reason: err.reason, detail: err.detail, elapsedMs: Date.now() - startedAt }
          : { agent: agentName, model, status: 'failed', reason: 'unexpected_error', error: err.message, elapsedMs: Date.now() - startedAt };
    }

    const { jsonPath, mdPath } = writeAgentResult(outDir, agentName, result);
    console.log(`[${agentName}] status=${result.status} escrito em:\n  ${jsonPath}\n  ${mdPath}`);
    process.exit(result.status === 'ok' ? 0 : 1);
    return;
  }

  // Modo padrão: orquestra os 5 especialistas + Juiz Sol. Só cria o client
  // da API OpenAI se algo no agents.json realmente precisar dele — com o
  // provedor padrão (codex-local) isso nunca é necessário, então rodar sem
  // OPENAI_API_KEY definida é o caminho normal agora, não um erro.
  let client = null;
  try { client = createClient(); } catch (e) { /* ok — provedor padrão não usa a API */ }

  const agentsConfig = loadJson(path.join(__dirname, 'config', 'agents.json'));
  console.log(`[orquestrador] escopo=${scope}`);
  console.log(`[orquestrador] tarefa: ${args.task}`);
  console.log(`[orquestrador] especialistas: ${agentsConfig.specialists.map((s) => s.name).join(', ')}`);

  const { specialists, judge } = await runOrchestration({
    client,
    agentsConfig,
    models,
    limits,
    scope,
    task: args.task,
    outDir,
  });

  const okCount = specialists.filter((r) => r.status === 'ok').length;
  console.log(`[orquestrador] especialistas concluídos: ${okCount}/${specialists.length}`);
  console.log(`[orquestrador] juiz: status=${judge.status}`);
  console.log(`[orquestrador] resultados em: ${outDir}`);
  process.exit(judge.status === 'ok' ? 0 : 1);
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
