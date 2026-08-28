'use strict';
// Ponto único de leitura do catálogo de especialidades, pool de modelos e
// overrides do usuário — usado por orchestrate.js e providers/registry.js
// pra não duplicar (de novo) a lógica que antes existia espelhada em
// claude-side/engine/orchestrator.js::loadPersona e
// openai-side/config/agents.json.
const fs = require('fs');
const path = require('path');

const CONFIG_DIR = __dirname;
const SPECIALISTS_DIR = path.join(CONFIG_DIR, 'specialists');

const ROUTING_DEFAULTS = {
  judgeModel: null,
  leaderModel: null,
  pinned: {},
  maxSpecialtiesPerRound: 6,
  omnirouteBaseUrl: 'http://localhost:20128/v1',
  customModels: [],
};

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, name), 'utf8'));
}

function loadSpecialties() {
  return loadJson('specialties.json').specialties;
}

function loadModelPool() {
  return loadJson('model-pool.json').models;
}

// routing.json é o único arquivo desta pasta que o usuário edita (via
// dashboard); se estiver ausente/corrompido, cai pros defaults em vez de
// derrubar a rodada — mesma filosofia de tolerância a falha do resto do
// projeto (ver orchestrate.js::patchState).
function loadRouting() {
  try {
    return { ...ROUTING_DEFAULTS, ...loadJson('routing.json') };
  } catch (e) {
    return { ...ROUTING_DEFAULTS };
  }
}

// spec pode ser uma especialidade do catálogo (promptFile) ou um agente
// avulso pedido numa rodada (foco inline, sem arquivo).
function loadPersona(spec) {
  if (spec.foco) return spec.foco;
  if (spec.promptFile) return fs.readFileSync(path.join(SPECIALISTS_DIR, spec.promptFile), 'utf8');
  throw new Error(`especialidade "${spec.key || spec.name}" sem "foco" nem "promptFile" — nada pra usar como persona`);
}

function findSpecialty(key, specialties) {
  return (specialties || loadSpecialties()).find((s) => s.key === key);
}

// Procura primeiro no pool fixo (config/model-pool.json); se não achar, no
// customModels do usuário (routing.json — é onde vivem os modelos
// escolhidos de OpenRouter/OmniRoute, agregadores com dezenas/centenas de
// IDs que não fazem sentido fixar aqui um por um).
function findModel(modelId, { modelPool, routing } = {}) {
  const pool = modelPool || loadModelPool();
  const found = pool.find((m) => m.id === modelId);
  if (found) return found;
  const rt = routing || loadRouting();
  return (rt.customModels || []).find((m) => m.id === modelId);
}

module.exports = { loadSpecialties, loadModelPool, loadRouting, loadPersona, findSpecialty, findModel, ROUTING_DEFAULTS };
