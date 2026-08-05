'use strict';

// Auxílio mútuo entre agentes de um mesmo grupo: se um especialista está
// demorando (ainda não terminou depois de `staleAfterMs`) E pelo menos um
// outro do MESMO grupo já concluiu com sucesso, dispara um "ajudante" —
// uma segunda tentativa da MESMA tarefa, mais barata/rápida (modelo mais
// barato e/ou orçamento menor, decidido por quem chama) — em paralelo com
// a tentativa original. Usa o que terminar primeiro com sucesso.
//
// Limitação real, deliberada: não existe cancelamento de verdade da
// chamada de API já em andamento (os SDKs não estão conectados a um
// AbortController aqui) — a "economia de tokens" pedida vem de só disparar
// o ajudante quando realmente necessário (não pra todo mundo) e dele ser
// deliberadamente mais barato, não de interromper a tentativa original no
// meio. Documentado aqui pra não vender cancelamento que não existe.
//
// Compartilhado pelos três lados (Claude/OpenAI/NVIDIA) porque a lógica de
// corrida não depende de motor de agente nenhum — só de duas funções que
// cada lado já sabe construir: startFn (a tentativa normal) e helperStartFn
// (a tentativa de apoio).
async function runGroupWithMutualAid(specs, startFn, helperStartFn, opts = {}) {
  const { staleAfterMs, checkIntervalMs = 2000, onHelperTriggered } = opts;
  const n = specs.length;
  if (n === 0) return [];
  if (!staleAfterMs) return Promise.all(specs.map((spec, i) => startFn(spec, i)));

  const startedAt = Date.now();
  const settled = new Array(n).fill(false);
  const helperLaunched = new Array(n).fill(false);
  const finalResults = new Array(n).fill(undefined);
  let settledCount = 0;
  let resolveAll;
  const allSettledPromise = new Promise((resolve) => { resolveAll = resolve; });

  function record(i, result) {
    if (finalResults[i]?.status === 'ok') return; // já temos sucesso pra esse índice — nunca piora
    finalResults[i] = result;
    if (!settled[i]) {
      settled[i] = true;
      settledCount++;
      if (settledCount === n) resolveAll();
    }
  }

  function attach(i, promise) {
    promise
      .then((r) => record(i, r))
      .catch((e) => record(i, { status: 'failed', reason: 'promise_rejected', error: String(e) }));
  }

  specs.forEach((spec, i) => attach(i, startFn(spec, i)));

  const timer = setInterval(() => {
    const anyOk = finalResults.some((r) => r?.status === 'ok');
    if (!anyOk) return; // só faz sentido ajudar quem tá parado se alguém do grupo já provou que dá pra terminar
    for (let i = 0; i < n; i++) {
      if (settled[i] || helperLaunched[i]) continue;
      if (Date.now() - startedAt < staleAfterMs) continue;
      helperLaunched[i] = true;
      onHelperTriggered?.(specs[i], i);
      attach(i, helperStartFn(specs[i], i));
    }
  }, checkIntervalMs);

  await allSettledPromise;
  clearInterval(timer);
  return finalResults;
}

module.exports = { runGroupWithMutualAid };
