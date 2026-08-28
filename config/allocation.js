'use strict';
// Lógica pura da alocação dinâmica de especialistas — extraída de
// orchestrate.js pra ficar testável sem precisar rodar uma rodada de
// verdade (ver tests/allocation.test.js). Nenhuma função aqui faz I/O.

const RANK = { alta: 2, media: 1, baixa: 0 };

// Separa o brief (texto livre) do bloco JSON cercado com a alocação — o
// kickoff do Líder responde com os dois juntos (ver a tarefa montada em
// orchestrate.js::runRound). Tolerante: se o bloco não vier ou vier mal
// formado, `rawAllocation` fica null e quem chama cai no fallback
// determinístico (defaultAllocation).
function parseKickoff(text) {
  if (!text) return { brief: '', rawAllocation: null };
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) return { brief: text.trim(), rawAllocation: null };
  const brief = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim();
  try {
    const parsed = JSON.parse(match[1]);
    return { brief, rawAllocation: Array.isArray(parsed?.specialties) ? parsed.specialties : null };
  } catch (e) {
    return { brief, rawAllocation: null };
  }
}

// Valida a alocação sugerida pelo kickoff contra o catálogo real e os
// modelos REALMENTE disponíveis nesta rodada — nunca confia cegamente no
// que o modelo respondeu. Descarta silenciosamente qualquer
// especialidade/model id que não exista ou não esteja disponível agora.
function sanitizeAllocation(rawAllocation, { specialties, availableModelIds, maxSpecialties }) {
  if (!Array.isArray(rawAllocation)) return null;
  const specialtyKeys = new Set(specialties.map((s) => s.key));
  const availableSet = new Set(availableModelIds);
  const cleaned = [];
  for (const entry of rawAllocation) {
    if (!entry || typeof entry.key !== 'string' || !specialtyKeys.has(entry.key)) continue;
    const models = Array.isArray(entry.models)
      ? [...new Set(entry.models.filter((m) => typeof m === 'string' && availableSet.has(m)))]
      : [];
    if (models.length) cleaned.push({ key: entry.key, models });
    if (cleaned.length >= maxSpecialties) break;
  }
  return cleaned.length ? cleaned : null;
}

// Fallback determinístico (kickoff falhou, ou não devolveu alocação
// válida): cada especialidade vai pro modelo disponível de maior força
// conhecida (config/specialties.json), até o teto de especialidades —
// nunca "roda tudo em tudo" como efeito colateral de uma falha de parse.
function defaultAllocation({ specialties, availableModelIds, maxSpecialties }) {
  const availableSet = new Set(availableModelIds);
  const picked = [];
  for (const spec of specialties) {
    const ranked = Object.entries(spec.strengths || {})
      .filter(([modelId]) => availableSet.has(modelId))
      .sort((a, b) => (RANK[b[1]] ?? 0) - (RANK[a[1]] ?? 0));
    if (ranked.length) picked.push({ key: spec.key, models: [ranked[0][0]] });
    if (picked.length >= maxSpecialties) break;
  }
  if (!picked.length && availableModelIds.length) {
    picked.push({ key: specialties[0].key, models: [availableModelIds[0]] });
  }
  return picked;
}

// Overrides do usuário (config/routing.json → pinned) SEMPRE vencem o que o
// alocador sugeriu — inclusive adicionando uma especialidade que o kickoff
// nem tinha escolhido, se o usuário fixou um modelo pra ela.
function applyPins(allocation, pinned, availableModelIds) {
  const availableSet = new Set(availableModelIds);
  const byKey = new Map(allocation.map((a) => [a.key, a]));
  for (const [key, models] of Object.entries(pinned || {})) {
    const validModels = [...new Set((Array.isArray(models) ? models : [models]).filter((m) => availableSet.has(m)))];
    if (validModels.length) byKey.set(key, { key, models: validModels });
  }
  return [...byKey.values()];
}

module.exports = { parseKickoff, sanitizeAllocation, defaultAllocation, applyPins };
