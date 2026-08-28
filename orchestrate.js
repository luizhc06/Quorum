#!/usr/bin/env node
'use strict';
// Ponto de entrada de uma rodada Quorum completa e automática. Fluxo desde a
// alocação dinâmica (substitui os grupos fixos por fornecedor que existiam
// antes — ver config/specialties.json e providers/registry.js):
//   1. Líder faz o kickoff: pesquisa rápida + brief + decide QUAIS
//      especialidades do catálogo esta tarefa precisa e QUAL modelo
//      disponível roda cada uma (config/routing.json.pinned pode forçar
//      uma escolha específica, sempre vencendo o que o kickoff sugeriu).
//   2. Os especialistas alocados rodam em paralelo, via
//      providers/registry.js (que despacha pro motor certo — Claude, GPT,
//      NVIDIA ou o laço genérico OpenAI-compatível de Ollama/OpenRouter/
//      OmniRoute/Antigravity — sem o orquestrador principal precisar saber
//      qual é qual).
//   3. Um único Juiz (config/judge.md, modelo configurável em
//      config/routing.json.judgeModel) consolida todos os relatórios.
//   4. O Líder faz a síntese final, escrevendo runs/<run-id>/FINAL_REPORT.md.
// Nenhuma parte deste script depende de uma conversa ativa do Claude Code —
// roda sozinho até o fim, escrevendo progresso em runs/<run-id>/state.json
// (é isso que o painel em dashboard/ lê via polling) e eventos ao vivo em
// runs/<run-id>/events.ndjson (é isso que o SSE do painel tail-eia).
//
// Este processo roda DESTACADO (dashboard/server.js faz spawn com
// {detached:true} + child.unref()) de propósito — reiniciar o dashboard não
// pode matar uma rodada em andamento. Por isso o controle da rodada (pausar/
// retomar/cancelar/trocar modelo/ajustar limite/conversar) é um servidor TCP
// em loopback (ver control/channel.js) que este processo abre numa porta
// efêmera — o dashboard só manda comandos por ele, nunca segura uma
// referência direta a este processo.
const fs = require('fs');
const path = require('path');

require('./env').loadEnvFile(__dirname);

const { createClient: createClaudeClient } = require('./claude-side/engine/client');
const { createClient: createOpenaiClient } = require('./openai-side/src/client');
const { getProviderHealth } = require('./provider-health');
const { loadSpecialties, loadModelPool, loadRouting, loadPersona, findModel } = require('./config/specialty-catalog');
const { parseKickoff, sanitizeAllocation, defaultAllocation, applyPins } = require('./config/allocation');
const { createRegistry } = require('./providers/registry');
const { startControlServer } = require('./control/channel');
const { createEventEmitter } = require('./control/events');

// Quanto tempo o processo fica de pé depois que a rodada terminou (Juiz +
// Líder concluídos), só pra continuar servindo chat de acompanhamento —
// sem chat nenhum nesse intervalo, o processo se encerra sozinho, evitando
// acumular processos Node pendurados indefinidamente a cada rodada.
const IDLE_EXIT_AFTER_MS = 30 * 60 * 1000;

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
function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function nowLabel() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtElapsed(ms) {
  const totalS = Math.floor(ms / 1000);
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function patchState(statePath, updater) {
  let state = {};
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) { /* primeira escrita */ }
  updater(state);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

// Espera todas as promises ATUALMENTE no Map, mas sem condição de corrida
// contra reatribuições (troca de modelo) que aconteçam durante a espera: se
// o Map mudou (uma entrada foi substituída/removida/adicionada) entre o
// início e o fim do `await`, espera de novo com o snapshot atualizado — só
// devolve quando um ciclo inteiro passa sem nenhuma mudança.
async function waitAllStable(promiseMap) {
  for (;;) {
    const snapshot = [...promiseMap.entries()];
    await Promise.allSettled(snapshot.map(([, p]) => p));
    const current = [...promiseMap.entries()];
    const unchanged = current.length === snapshot.length && current.every(([k, p], i) => k === snapshot[i][0] && p === snapshot[i][1]);
    if (unchanged) return;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.scope || !args.task || !args['run-id'] || !args.out) {
    console.error('Uso: node orchestrate.js --scope <dir> --task "<descrição>" --run-id <id> --out runs/<id> [--context-path <dir>] [--providers \'["deepseek-local","openrouter-free",...]\'] [--extra-agents \'[{"key":"...","titulo":"...","foco":"...","models":["..."]}]\']');
    process.exit(1);
  }

  const runId = args['run-id'];
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const statePath = path.join(outDir, 'state.json');
  const eventsPath = path.join(outDir, 'events.ndjson');
  const scope = path.resolve(args.scope);
  const contextPath = args['context-path'] ? path.resolve(args['context-path']) : undefined;
  let tickTimer = null;
  let idleTimer = null;
  let controlServer = null;

  function scheduleIdleExit(delayMs = IDLE_EXIT_AFTER_MS) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      controlServer?.close(() => process.exit(0));
    }, delayMs);
  }

  try {
    await runRound();
  } catch (err) {
    if (tickTimer) clearInterval(tickTimer);
    patchState(statePath, (state) => {
      state.run = state.run || { runId };
      state.run.status = 'failed';
      state.activity = state.activity || [];
      state.activity.unshift({ time: nowLabel(), text: `Rodada falhou: ${err.message}` });
    });
    throw err;
  }

  async function runRound() {
    const models = loadJson(path.join(__dirname, 'config', 'models.json'));
    const limits = loadJson(path.join(__dirname, 'config', 'limits.json'));
    const communityAgentsConfig = loadJson(path.join(__dirname, 'config', 'community-agents.json'));
    const specialties = loadSpecialties();
    const modelPool = loadModelPool();
    const routing = loadRouting();

    let requestedProviders = null;
    if (args.providers) {
      try {
        const parsed = JSON.parse(args.providers);
        if (Array.isArray(parsed)) requestedProviders = new Set(parsed.filter((value) => typeof value === 'string'));
      } catch (error) {
        console.error('--providers inválido (precisa ser um array JSON), usando os padrões:', error.message);
      }
    }
    const enabledCommunitySpecs = (communityAgentsConfig.agents || []).filter((spec) =>
      requestedProviders ? requestedProviders.has(spec.key) : spec.defaultEnabled !== false
    );

    // Especialidades avulsas pedidas nesta rodada (POST /api/rounds ainda
    // aceita o campo antigo {claude:[...],openai:[...]} do painel — vira
    // especialidade avulsa com "models" explícito; formato novo é um array
    // direto de {key,titulo,foco,models}).
    let extraSpecialties = [];
    if (args['extra-agents']) {
      try {
        const parsed = JSON.parse(args['extra-agents']);
        if (Array.isArray(parsed)) {
          extraSpecialties = parsed;
        } else if (parsed && (Array.isArray(parsed.claude) || Array.isArray(parsed.openai))) {
          extraSpecialties = [...(parsed.claude || []), ...(parsed.openai || [])].map((s) => ({
            key: s.name, titulo: s.titulo || s.name, foco: s.foco, models: s.model ? [s.model] : [],
          }));
        }
      } catch (e) {
        console.error('--extra-agents inválido (precisa ser JSON), ignorando:', e.message);
      }
    }
    const allSpecialties = [...specialties, ...extraSpecialties];
    const fullModelPool = [...modelPool, ...(routing.customModels || [])];

    const startedAt = Date.now();
    const health = await getProviderHealth();
    const healthByKey = new Map(health.map((h) => [h.key, h]));
    const enabledCommunityKeys = new Set(enabledCommunitySpecs.map((s) => s.key));

    // Disponibilidade real de cada modelo do pool nesta rodada — cruza
    // saúde ao vivo (provider-health.js) com os toggles de provedor
    // gratuito (--providers). O kickoff só pode alocar entre esses ids.
    function isModelAvailable(model) {
      if (model.engine === 'claude') return Boolean(healthByKey.get('claude-local')?.available) || Boolean(process.env.ANTHROPIC_API_KEY);
      if (model.engine === 'openai') return Boolean(healthByKey.get('codex-local')?.available) || Boolean(process.env.OPENAI_API_KEY);
      if (model.engine === 'nvidia') return Boolean(healthByKey.get('nvidia-nim')?.available);
      if (model.engine === 'community') {
        const matchingSpec = enabledCommunitySpecs.find((s) => s.provider === model.provider && s.model === model.id);
        if (matchingSpec) return Boolean(healthByKey.get(matchingSpec.key)?.available);
        // model id avulso do mesmo provider (ex. outro id do OpenRouter não
        // listado em community-agents.json) — usa a saúde do provedor base.
        const baseKey = model.provider === 'openrouter' ? 'openrouter-free' : model.provider === 'omniroute' ? 'omniroute-free' : null;
        return Boolean(baseKey && enabledCommunityKeys.has(baseKey) && healthByKey.get(baseKey)?.available);
      }
      return false;
    }
    const availableModelIds = fullModelPool.filter(isModelAvailable).map((m) => m.id);

    function specialistLimitsFor(model) {
      if (model.engine === 'claude') return limits.claude_specialist;
      if (model.engine === 'openai') return limits.openai_specialist;
      if (model.engine === 'nvidia') return limits.nvidia_specialist;
      return limits.community_specialist;
    }

    patchState(statePath, (state) => {
      state.run = {
        runId, round: 1, task: args.task, status: 'running',
        startedAt: new Date(startedAt).toISOString(),
        parallelism: 'a definir pelo Líder', elapsed: '00:00', cost: 'US$ 0,00',
      };
      state.specialistAgents = [];
      state.arbiters = [
        { key: 'lider', name: 'Líder / Sintetizador', model: routing.leaderModel || models.claude_leader, state: 'queued', role: 'Vai pesquisar o código, montar o brief e decidir quais especialistas esta rodada precisa.', chips: [] },
        { key: 'juiz', name: 'Juiz', model: routing.judgeModel || models.claude_judge, state: 'queued', role: 'Aguardando os especialistas.', chips: [] },
      ];
      state.judgeReports = { unified: '' };
      state.headline = ''; state.lede = ''; state.synthBlocks = []; state.dissent = null;
      state.activity = [{ time: nowLabel(), text: `Rodada iniciada: "${args.task}"` }];
      state.decisions = state.decisions || {};
      state.allocation = null;
    });

    tickTimer = setInterval(() => {
      patchState(statePath, (state) => { state.run.elapsed = fmtElapsed(Date.now() - startedAt); });
    }, 5000);

    function pushActivity(text) {
      patchState(statePath, (state) => {
        state.activity = state.activity || [];
        state.activity.unshift({ time: nowLabel(), text });
        if (state.activity.length > 300) state.activity.length = 300;
      });
    }
    function updateSpecialist(key, patch) {
      patchState(statePath, (state) => {
        const agent = (state.specialistAgents || []).find((a) => a.key === key);
        if (agent) Object.assign(agent, patch);
      });
    }
    function updateArbiter(key, patch) {
      patchState(statePath, (state) => {
        const arb = (state.arbiters || []).find((a) => a.key === key);
        if (arb) Object.assign(arb, patch);
      });
    }

    let claudeClient = null;
    try { claudeClient = createClaudeClient(); } catch (e) { /* ok — provedor padrão (claude-code-local) não usa a API */ }
    let openaiClient = null;
    try { openaiClient = createOpenaiClient(); } catch (e) { /* ok — provedor padrão (codex-local) não usa a API */ }

    const registry = createRegistry({ scope, contextPath, limits, models, routing, modelPool: fullModelPool, claudeClient, openaiClient });

    const leaderModel = routing.leaderModel || models.claude_leader;
    const judgeModel = routing.judgeModel || models.claude_judge;
    const leaderPersona = fs.readFileSync(path.join(__dirname, 'claude-side', 'agents', 'leader-synthesizer.md'), 'utf8');

    // --- Registro de atribuições: uma entrada por especialista disparado,
    // viva do início ao fim da rodada (mesmo depois de concluído — é o que
    // permite o comando 'chat' achar a especialidade/persona/modelo de um
    // especialista já terminado). `promiseMap` só guarda o que está sendo
    // ESPERADO agora (pausar remove, retomar/trocar modelo recoloca) —
    // `finalResults` é a fonte de verdade do último resultado conhecido de
    // cada `key`, usada tanto pro digest do Juiz quanto pelo chat.
    const assignmentRegistry = new Map();
    const promiseMap = new Map();
    const finalResults = new Map();
    let roundTask = args.task; // atualizado depois do kickoff — 'chat'/'reassign' via controle podem chegar antes ou depois

    function launchAssignment(key, specialty, modelId) {
      const model = findModel(modelId, { modelPool: fullModelPool, routing });
      const controller = new AbortController();
      const agentLimits = { ...specialistLimitsFor(model) };
      const persona = loadPersona(specialty);
      const onEvent = createEventEmitter(eventsPath, key);
      const onStateChange = (u) => {
        if (!u.state) return;
        updateSpecialist(key, { state: u.state, findings: u.findings ?? undefined, usage: u.usage, elapsed: u.elapsedMs ? fmtElapsed(u.elapsedMs) : undefined });
        onEvent({ type: 'state-change', state: u.state, findings: u.findings, usage: u.usage, elapsedMs: u.elapsedMs });
        const label = `${specialty.titulo} (${modelId})`;
        if (u.state === 'running') pushActivity(`${label} começou.`);
        if (u.state === 'done') pushActivity(`${label} concluiu — ${u.findings ?? 0} achado(s).`);
        if (u.state === 'failed') pushActivity(`${label} falhou.`);
        if (u.state === 'skipped') pushActivity(`${label} indisponível; rodada segue sem ele.`);
        if (u.state === 'refused') pushActivity(`${label} recusou a análise.`);
      };

      const promise = registry.run(modelId, {
        name: key, persona, task: roundTask, limits: agentLimits, outDir, onStateChange, onEvent, signal: controller.signal,
      }).then((result) => {
        const finalResult = { ...result, assignmentName: key, specialtyKey: specialty.key, specialtyTitulo: specialty.titulo };
        finalResults.set(key, finalResult);
        onEvent({ type: 'done', status: result.status, finalText: result.finalText });
        return finalResult;
      }).catch((err) => {
        const finalResult = { agent: key, model: modelId, status: 'failed', reason: 'promise_rejected', error: err.message, assignmentName: key, specialtyKey: specialty.key, specialtyTitulo: specialty.titulo };
        finalResults.set(key, finalResult);
        return finalResult;
      });

      assignmentRegistry.set(key, { controller, limits: agentLimits, specialty, modelId, persona, terminal: false });
      promiseMap.set(key, promise);
      return promise;
    }

    // --- comandos de controle (ver control/channel.js) ---
    function handlePause(key) {
      const entry = assignmentRegistry.get(key);
      if (!entry) return { error: 'especialista não encontrado' };
      if (entry.terminal) return { error: 'especialista já foi cancelado — não dá pra pausar' };
      entry.controller.abort();
      promiseMap.delete(key);
      finalResults.set(key, { agent: key, model: entry.modelId, status: 'skipped', reason: 'paused_by_user', specialtyKey: entry.specialty.key, specialtyTitulo: entry.specialty.titulo, assignmentName: key, elapsedMs: 0 });
      updateSpecialist(key, { state: 'paused' });
      createEventEmitter(eventsPath, key)({ type: 'state-change', state: 'paused' });
      pushActivity(`${entry.specialty.titulo} (${entry.modelId}) pausado pelo usuário.`);
      return { paused: true };
    }
    function handleResume(key) {
      const entry = assignmentRegistry.get(key);
      if (!entry) return { error: 'especialista não encontrado' };
      if (entry.terminal) return { error: 'especialista foi cancelado — não dá pra retomar, só trocar de modelo' };
      updateSpecialist(key, { state: 'running' });
      pushActivity(`${entry.specialty.titulo} (${entry.modelId}) retomado — recomeça do zero (nenhum motor suporta retomar de onde parou).`);
      launchAssignment(key, entry.specialty, entry.modelId);
      return { resumed: true };
    }
    function handleCancel(key) {
      const entry = assignmentRegistry.get(key);
      if (!entry) return { error: 'especialista não encontrado' };
      entry.controller.abort();
      entry.terminal = true;
      promiseMap.delete(key);
      finalResults.set(key, { agent: key, model: entry.modelId, status: 'skipped', reason: 'cancelled_by_user', specialtyKey: entry.specialty.key, specialtyTitulo: entry.specialty.titulo, assignmentName: key, elapsedMs: 0 });
      updateSpecialist(key, { state: 'cancelled' });
      createEventEmitter(eventsPath, key)({ type: 'state-change', state: 'cancelled' });
      pushActivity(`${entry.specialty.titulo} (${entry.modelId}) cancelado pelo usuário.`);
      return { cancelled: true };
    }
    function handleReassign(key, newModelId) {
      const entry = assignmentRegistry.get(key);
      if (!entry) return { error: 'especialista não encontrado' };
      const newModel = findModel(newModelId, { modelPool: fullModelPool, routing });
      if (!newModel) return { error: `model id "${newModelId}" não reconhecido` };
      entry.controller.abort();
      updateSpecialist(key, { model: newModelId, engine: newModel.engine, provider: newModel.provider || newModel.engine, state: 'running', findings: 0, elapsed: '—' });
      pushActivity(`${entry.specialty.titulo} trocado de ${entry.modelId} para ${newModelId} pelo usuário.`);
      launchAssignment(key, entry.specialty, newModelId);
      return { reassigned: true, model: newModelId };
    }
    function handleLimits(key, patch) {
      const entry = assignmentRegistry.get(key);
      if (!entry) return { error: 'especialista não encontrado' };
      const clean = {};
      for (const field of ['maxIterations', 'maxWallClockMs', 'maxOutputTokensPerTurn', 'maxCostUsd']) {
        if (typeof patch[field] === 'number' && patch[field] > 0) clean[field] = patch[field];
      }
      Object.assign(entry.limits, clean);
      return { limits: entry.limits };
    }
    async function handleChat(key, message) {
      if (typeof message !== 'string' || !message.trim()) return { error: 'mensagem vazia' };
      const result = finalResults.get(key);
      if (!result || result.status !== 'ok') return { error: 'este especialista ainda não concluiu com sucesso — só dá pra conversar depois' };
      const entry = assignmentRegistry.get(key);
      const modelId = entry ? entry.modelId : result.model;
      const model = findModel(modelId, { modelPool: fullModelPool, routing });
      if (!model) return { error: `modelo "${modelId}" não reconhecido` };
      const specialty = entry ? entry.specialty : allSpecialties.find((s) => s.key === result.specialtyKey);
      const persona = entry ? entry.persona : (specialty ? loadPersona(specialty) : leaderPersona);

      const chatDir = path.join(outDir, 'chats');
      fs.mkdirSync(chatDir, { recursive: true });
      const chatPath = path.join(chatDir, `${key}.jsonl`);
      const priorLines = fs.existsSync(chatPath)
        ? fs.readFileSync(chatPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
        : [];
      fs.appendFileSync(chatPath, `${JSON.stringify({ role: 'user', content: message, ts: Date.now() })}\n`);

      const historyText = priorLines.map((l) => `${l.role === 'user' ? 'Usuário' : 'Você'}: ${l.content}`).join('\n\n');
      const chatTask =
        `Você já concluiu sua análise nesta rodada. Seu relatório final foi:\n\n${result.finalText}\n\n` +
        (historyText ? `Conversa de acompanhamento até agora:\n\n${historyText}\n\n` : '') +
        `Nova pergunta do usuário:\n${message}\n\nResponda com base no que você já viu — não invente evidência nova que você não checou, e não repita o relatório inteiro, vá direto à resposta.`;

      const onEvent = createEventEmitter(eventsPath, key);
      const chatResult = await registry.run(modelId, {
        name: `${key}-chat`, persona, task: chatTask,
        limits: entry ? entry.limits : specialistLimitsFor(model), outDir: chatDir, onEvent,
      });
      const replyText = chatResult.status === 'ok' ? chatResult.finalText : `(não consegui responder: ${chatResult.reason || chatResult.error || chatResult.status})`;
      fs.appendFileSync(chatPath, `${JSON.stringify({ role: 'assistant', content: replyText, ts: Date.now() })}\n`);
      onEvent({ type: 'chat-done', text: replyText });
      return { reply: replyText };
    }

    controlServer = startControlServer(outDir, (msg) => {
      scheduleIdleExit();
      switch (msg.type) {
        case 'ping': return { alive: true };
        case 'pause': return handlePause(msg.key);
        case 'resume': return handleResume(msg.key);
        case 'cancel': return handleCancel(msg.key);
        case 'reassign': return handleReassign(msg.key, msg.model);
        case 'limits': return handleLimits(msg.key, msg.patch || {});
        case 'chat': return handleChat(msg.key, msg.message);
        default: return { error: `comando desconhecido: ${msg.type}` };
      }
    });

    // --- Líder: kickoff (brief + alocação dinâmica de especialistas) ---
    updateArbiter('lider', { state: 'running', role: 'Pesquisando o código (e contexto extra, se houver) pra montar o brief e decidir a alocação.' });
    pushActivity('Líder começou o kickoff — vai definir o brief e quais especialistas esta rodada precisa.');

    const availableSummary = allSpecialties.map((s) => {
      const strengths = Object.entries(s.strengths || {}).filter(([id]) => availableModelIds.includes(id));
      const strengthsText = strengths.length ? strengths.map(([id, level]) => `${id} (${level})`).join(', ') : '(nenhum modelo com força mapeada disponível agora — ainda pode ser alocada com outro modelo disponível se fizer sentido)';
      return `- ${s.key} — ${s.titulo}: ${strengthsText}`;
    }).join('\n');

    const kickoffTask =
      `Tarefa pedida pelo usuário para esta rodada do conselho:\n\n"${args.task}"\n\n` +
      `Antes de liberar os especialistas, faça uma pesquisa rápida (list_files, alguns read_file/grep pontuais)` +
      (contextPath ? ' e do contexto extra disponível (context_list_files/context_read_file/context_grep)' : '') +
      ` o suficiente pra entender o projeto e decidir o que esta tarefa realmente precisa — não precisa ser exaustivo.\n\n` +
      `Especialidades do catálogo, com os modelos DISPONÍVEIS AGORA (só pode escolher entre eles) e a força conhecida de cada um nessa especialidade:\n${availableSummary}\n\n` +
      `Modelos disponíveis agora, no total: ${availableModelIds.join(', ') || '(nenhum — situação excepcional, avise isso no brief)'}\n\n` +
      `Produza DUAS coisas na sua resposta, nesta ordem:\n\n` +
      `1. Um BRIEF final (texto livre) que os especialistas escolhidos vão receber como a tarefa deles: esclareça/expanda a tarefa original se for vaga (mantendo a intenção do usuário), aponte onde focar, mencione contexto extra relevante se houver.\n\n` +
      '2. Um bloco JSON cercado, exatamente neste formato:\n```json\n{"specialties":[{"key":"<key do catálogo>","models":["<model id disponível>"]}]}\n```\n\n' +
      `Regras da alocação: escolha só especialidades REALMENTE relevantes pra tarefa pedida (uma tarefa estreita como "revisar segurança" deve escolher 1-2 especialidades, não o catálogo inteiro) — no máximo ${routing.maxSpecialtiesPerRound} especialidades. Pra cada uma, escolha o(s) modelo(s) mais forte(s) DENTRE OS DISPONÍVEIS AGORA (prefira 1 modelo por especialidade; use 2 só quando a severidade potencial justificar um segundo parecer independente de outro fornecedor). NUNCA escolha um model id fora da lista de disponíveis acima. Responda só com o brief e o bloco JSON, sem preâmbulo nem comentário sobre o processo.`;

    const kickoffResult = await registry.run(leaderModel, {
      name: 'leader-kickoff', persona: leaderPersona, task: kickoffTask,
      limits: limits.claude_leader_kickoff, outDir,
    });

    const { brief, rawAllocation } = kickoffResult.status === 'ok' ? parseKickoff(kickoffResult.finalText) : { brief: '', rawAllocation: null };
    roundTask = brief || args.task;
    patchState(statePath, (state) => { state.roundBrief = brief || null; });

    let allocation = sanitizeAllocation(rawAllocation, { specialties: allSpecialties, availableModelIds, maxSpecialties: routing.maxSpecialtiesPerRound });
    if (!allocation) {
      pushActivity(kickoffResult.status === 'ok'
        ? 'Líder não retornou uma alocação válida — usando alocação padrão baseada nas forças conhecidas.'
        : `Kickoff falhou (${kickoffResult.reason || kickoffResult.error || kickoffResult.status}) — usando alocação padrão e a tarefa original.`);
      allocation = defaultAllocation({ specialties: allSpecialties, availableModelIds, maxSpecialties: routing.maxSpecialtiesPerRound });
    }
    allocation = applyPins(allocation, routing.pinned, availableModelIds);
    patchState(statePath, (state) => { state.allocation = allocation; });

    const totalAssigned = allocation.reduce((n, a) => n + a.models.length, 0);
    updateArbiter('lider', {
      role: kickoffResult.status === 'ok'
        ? `Brief e alocação prontos — ${totalAssigned} especialista(s) em ${allocation.length} especialidade(s).`
        : 'Kickoff falhou — seguindo com alocação padrão e a tarefa original.',
    });
    pushActivity(`Líder liberou ${totalAssigned} especialista(s) em ${allocation.length} especialidade(s).`);

    if (!totalAssigned) {
      clearInterval(tickTimer);
      updateArbiter('lider', { state: 'failed' });
      updateArbiter('juiz', { state: 'failed', role: 'Sem especialistas pra consolidar.' });
      patchState(statePath, (state) => {
        state.run.status = 'failed';
        state.activity.unshift({ time: nowLabel(), text: 'Nenhum modelo disponível pra nenhuma especialidade — rodada não pode continuar. Rode `npm run doctor` pra ver o que falta configurar.' });
      });
      console.log(`[orchestrate] rodada ${runId} falhou — nenhum modelo disponível`);
      // Sem isso, o servidor de controle (já aberto) mantém o processo vivo
      // pra sempre. Nenhum especialista rodou, não há nada pra conversar —
      // sai logo (bem mais curto que o idle padrão pós-rodada bem-sucedida).
      scheduleIdleExit(10_000);
      return;
    }

    // --- monta a lista de especialistas a disparar ---
    const assignments = [];
    for (const item of allocation) {
      const specialty = allSpecialties.find((s) => s.key === item.key);
      for (const modelId of item.models) {
        const model = findModel(modelId, { modelPool: fullModelPool, routing });
        if (!model) continue;
        const shortModel = modelId.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const name = item.models.length > 1 ? `${specialty.key}__${shortModel}` : specialty.key;
        assignments.push({ name, specialty, model, modelId });
      }
    }

    patchState(statePath, (state) => {
      state.run.parallelism = `${assignments.length} especialista(s) em ${allocation.length} especialidade(s)`;
      state.specialistAgents = assignments.map((a) => ({
        key: a.name, name: a.specialty.titulo, model: a.modelId, engine: a.model.engine,
        provider: a.model.provider || a.model.engine, specialty: a.specialty.key,
        state: 'running', findings: 0, lens: loadPersona(a.specialty).slice(0, 140), elapsed: '—',
      }));
    });

    for (const a of assignments) launchAssignment(a.name, a.specialty, a.modelId);
    await waitAllStable(promiseMap);
    const specialistResults = assignments.map((a) => finalResults.get(a.name)).filter(Boolean);

    // --- Juiz único ---
    const okResults = specialistResults.filter((r) => r.status === 'ok');
    const failedResults = specialistResults.filter((r) => r.status !== 'ok');
    const digestForJudge = specialistResults.map((r) => {
      const header = `### Relatório de "${r.specialtyTitulo}" (modelo: ${r.model}, status: ${r.status})`;
      let body;
      if (r.status === 'ok') body = r.finalText;
      else if (r.status === 'refused') body = `Este agente RECUSOU produzir a análise. Texto: "${r.finalText || '(sem detalhe)'}". Trate como cobertura ausente, não como relatório vazio.`;
      else body = `Este agente falhou/foi pulado/pausado/cancelado (${r.reason || r.error}) — não produziu relatório.`;
      return `${header}\n\n${body}`;
    }).join('\n\n---\n\n');

    updateArbiter('juiz', { state: 'running', role: `Consolidando ${okResults.length}/${specialistResults.length} relatório(s).` });
    pushActivity('Juiz começou.');
    const judgePersona = fs.readFileSync(path.join(__dirname, 'config', 'judge.md'), 'utf8');
    const judgeTask =
      `Tarefa desta rodada: ${roundTask}\n\n` +
      (failedResults.length ? `Atenção: [${failedResults.map((r) => r.specialtyTitulo).join(', ')}] falharam/foram pulados/pausados/cancelados — não finja cobertura completa.\n\n` : '') +
      `Relatórios brutos dos ${okResults.length}/${specialistResults.length} especialistas que concluíram:\n\n${digestForJudge}`;
    const judgeResult = await registry.run(judgeModel, {
      name: 'judge', persona: judgePersona, task: judgeTask, limits: limits.claude_judge, outDir,
    });
    updateArbiter('juiz', { state: judgeResult.status === 'ok' ? 'done' : judgeResult.status, role: 'Relatório consolidado entregue.' });
    pushActivity(`Juiz concluiu (status: ${judgeResult.status}).`);
    patchState(statePath, (state) => {
      state.judgeReports = { unified: judgeResult.status === 'ok' ? judgeResult.finalText : `(status: ${judgeResult.status})` };
    });

    // --- Líder — síntese final ---
    updateArbiter('lider', { state: 'running', role: 'Conferindo achados de severidade alta e escrevendo a síntese final.' });
    pushActivity('Líder/Sintetizador começou a síntese final.');
    const leaderTask =
      `## Relatório do Juiz\n\n${judgeResult.status === 'ok' ? judgeResult.finalText : `(status: ${judgeResult.status})`}\n\n` +
      `Produza o relatório final seguindo exatamente o formato pedido no seu prompt de sistema (headline, lede, blocos P0/P1/DESCARTADO, e uma seção de divergência não resolvida se houver).`;
    const leaderResult = await registry.run(leaderModel, {
      name: 'leader-synthesizer', persona: leaderPersona, task: leaderTask,
      limits: limits.claude_leader || limits.claude_judge, outDir,
    });

    if (leaderResult.status === 'ok') {
      const parsed = parseLeaderOutput(leaderResult.finalText);
      patchState(statePath, (state) => {
        state.headline = parsed.headline; state.lede = parsed.lede;
        state.synthBlocks = parsed.synthBlocks; state.dissent = parsed.dissent;
      });
      fs.writeFileSync(path.join(outDir, 'FINAL_REPORT.md'), leaderResult.finalText);
    }
    updateArbiter('lider', { state: leaderResult.status === 'ok' ? 'done' : leaderResult.status, role: 'Síntese final entregue.' });
    pushActivity(`Líder/Sintetizador concluiu (status: ${leaderResult.status}).`);

    clearInterval(tickTimer);
    patchState(statePath, (state) => {
      state.run.status = 'done';
      state.run.elapsed = fmtElapsed(Date.now() - startedAt);
    });
    pushActivity('Rodada concluída.');
    console.log(`[orchestrate] rodada ${runId} concluída — ver ${outDir}`);
    // O processo continua de pé (o controlServer é um handle ativo) só pra
    // servir chat de acompanhamento com os especialistas já concluídos —
    // se auto-encerra depois de IDLE_EXIT_AFTER_MS sem nenhum comando.
    scheduleIdleExit();
  }
}

// --- parser tolerante: o formato pedido no prompt do líder é o contrato,
// mas o parser não pode quebrar a rodada se o texto vier levemente diferente
// — nesse caso o painel simplesmente mostra menos detalhe, nunca trava.
function parseLeaderOutput(text) {
  const headline = (text.match(/^#\s+(.+)/m) || [, ''])[1].trim();
  const afterHeadline = text.split(/^#\s+.+$/m)[1] || '';
  const lede = (afterHeadline.trim().split(/\n##\s/)[0] || '').trim();

  const sectionRe = /^##\s+(.+)$/gm;
  const sections = [];
  let match; let lastIndex = 0; let lastTitle = null;
  while ((match = sectionRe.exec(text))) {
    if (lastTitle !== null) sections.push({ title: lastTitle, body: text.slice(lastIndex, match.index).trim() });
    lastTitle = match[1].trim(); lastIndex = sectionRe.lastIndex;
  }
  if (lastTitle !== null) sections.push({ title: lastTitle, body: text.slice(lastIndex).trim() });

  const tagFor = (title) => {
    const t = title.toLowerCase();
    if (t.includes('p0') || t.includes('bloqueia')) return 'P0 · BLOQUEIA';
    if (t.includes('p1') || t.includes('retorno')) return 'P1 · ALTO RETORNO';
    if (t.includes('descart')) return 'DESCARTADO';
    return null;
  };
  const synthBlocks = [];
  let dissent = null;
  for (const sec of sections) {
    const tag = tagFor(sec.title);
    if (tag) {
      const items = sec.body.split(/\n(?=-\s)/).filter((l) => l.trim().startsWith('-')).map((l) => {
        const clean = l.replace(/^-\s*/, '').trim();
        const parts = clean.split(/\s+—\s+/);
        return { text: parts[0], source: parts.slice(1).join(' — ') || '' };
      });
      synthBlocks.push({ tag, title: sec.title.replace(/^P[01]\s*·\s*/i, '').trim() || sec.title, items });
    } else if (sec.title.toLowerCase().includes('diverg')) {
      const lines = sec.body.split('\n').filter(Boolean);
      dissent = { text: lines[0] || sec.body, note: lines.slice(1).join(' ').trim() };
    }
  }
  return { headline, lede, synthBlocks, dissent };
}

main().catch((err) => {
  console.error('[orchestrate] erro fatal:', err);
  process.exit(1);
});
