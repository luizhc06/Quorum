# Orquestração — a sequência que o Claude Code executa

Este documento descreve o laço real que o Claude Code (ou qualquer agente orquestrador compatível) segue para rodar uma rodada completa do Quorum contra um repositório-alvo. Os dois lados (Claude e OpenAI) são independentes e rodam em paralelo; a verificação adversarial só começa depois do Juiz OpenAI; o Líder só começa depois que Juiz Claude **e** verificação adversarial terminarem.

## 0. Preflight

- Confirme que `OPENAI_API_KEY` está disponível no ambiente (`openai-side/src/client.js` lança erro claro se ausente).
- Rode `npm install` em `openai-side/` se `node_modules/` não existir.
- Defina `--scope` (raiz do repositório-alvo, **nunca** este próprio repositório Quorum) e `--task` (o que investigar).
- Crie `runs/<run-id>/` (sugestão de id: `<8 chars aleatórios>-<HHMM>`).

## 1. Disparo em paralelo

**Lado Claude** (bloco que precisa terminar antes do passo 3): dispare os 10 agentes de `claude-side/agents/*.md` (exceto `judge.md`, `verifier-adversarial.md`, `leader-synthesizer.md`) em paralelo, cada um recebendo:
- o prompt do arquivo `.md` correspondente,
- `--scope` explícito,
- a tarefa/pergunta do usuário (`--task`),
- instrução de gravar a saída em `runs/<run-id>/claude-side/<agente>.md`.

**Lado OpenAI** (não bloqueia o passo 2 — dispare e continue): rode em background
```
node openai-side/run.js --scope <dir> --task "<task>" --out runs/<run-id>/openai-side/
```
Isso internamente roda os 5 especialistas de `openai-side/config/agents.json` via `Promise.allSettled` (uma falha não derruba os outros) e depois o Juiz Sol, escrevendo `runs/<run-id>/openai-side/<agente>.json`/`.md` e `runs/<run-id>/openai-side/judge.md`.

## 2. Juiz Claude

Quando os 10 especialistas Claude terminarem, dispare `judge.md` (modelo Opus, com Read/Grep/Glob) recebendo os 10 relatórios anexados. Grave a saída em `runs/<run-id>/claude-side/judge.md`.

## 3. Verificação adversarial

Quando o script Node do lado OpenAI terminar (notificação do processo em background), leia `runs/<run-id>/openai-side/judge.md`. Particione os achados dele em 2-3 grupos por categoria e dispare essa quantidade de agentes `verifier-adversarial.md` em paralelo, cada um recebendo sua partição. Grave a saída consolidada (concatenação dos veredictos) em `runs/<run-id>/claude-side/verification.md`.

## 4. Líder / Sintetizador

Quando o Juiz Claude (passo 2) **e** a verificação adversarial (passo 3) estiverem prontos, dispare `leader-synthesizer.md` (Opus) recebendo:
- `runs/<run-id>/claude-side/judge.md`,
- `runs/<run-id>/openai-side/judge.md` + `runs/<run-id>/claude-side/verification.md` (o relatório OpenAI já anotado com veredictos).

O próprio Líder grava `runs/<run-id>/FINAL_REPORT.md` e sua saída é apresentada diretamente ao usuário nesta mesma conversa — não há um passo de "repasse" separado.

## 5. Entrega

Apresente o conteúdo de `FINAL_REPORT.md` ao usuário. A partir daí, o fluxo sai do escopo deste framework: o usuário revisa, decide o que fazer com a(s) divergência(s) não resolvida(s) se houver, e repassa a um agente de escrita de código de baixo custo para implementar o que foi aprovado.

## Sobre falha parcial

Cada agente carrega um status (`ok`/`failed`/`timeout`, conforme `contracts/output-contract.md`). Juízes e Líder precisam saber lidar com lentes faltando — a seção "Cobertura e limites desta rodada" do relatório final deve sempre refletir isso, nunca fingir cobertura completa.

## Alimentando o painel visual (`dashboard/`) com uma rodada real

O painel (`dashboard/public/`) lê `runs/<run-id>/state.json` via `GET /api/runs/:id` (servido por `dashboard/server.js`) e faz polling a cada 3s enquanto a rodada não estiver `"status":"done"`. **Não existe nenhum processo automático escrevendo esse arquivo** — durante uma rodada real, é o próprio Claude Code (orquestrador) quem cria e atualiza `runs/<run-id>/state.json` a cada passo, usando Write/Edit como em qualquer outro arquivo. Não há CLI nem script auxiliar — o schema é simples o bastante pra editar direto.

Schema atual (todos os campos exceto `run` são opcionais/podem começar vazios) — reflete a alocação dinâmica: uma lista única de especialistas (não mais separada por fornecedor) e um Juiz único, ambos configuráveis via `config/routing.json`:

```json
{
  "run": { "runId": "...", "round": 1, "task": "...", "status": "running|done|failed",
           "startedAt": "2026-08-04T18:00:00", "parallelism": "3 especialista(s) em 2 especialidade(s)", "elapsed": "—", "cost": "US$ 0,00" },
  "allocation": [ { "key": "seguranca", "models": ["deepseek-r1:8b", "claude-sonnet-5"] } ],
  "specialistAgents": [ { "key": "seguranca", "name": "Segurança", "model": "deepseek-r1:8b", "engine": "community", "provider": "ollama", "specialty": "seguranca",
                            "state": "queued|running|done|failed|refused|skipped", "findings": 0, "lens": "texto curto", "elapsed": "—" } ],
  "arbiters": [ { "key": "juiz", "name": "Juiz", "model": "Opus 5 · com leitura", "state": "...", "role": "texto", "chips": ["..."] },
                 { "key": "lider", "name": "Líder / Sintetizador", "model": "Opus 5", "state": "...", "role": "texto", "chips": ["..."] } ],
  "judgeReports": { "unified": "..." },
  "headline": "", "lede": "",
  "synthBlocks": [ { "tag": "P0 · BLOQUEIA|P1 · ALTO RETORNO|DESCARTADO", "title": "...", "items": [ { "text": "...", "source": "..." } ] } ],
  "dissent": { "text": "...", "note": "..." },
  "activity": [ { "time": "18:03", "text": "..." } ]
}
```

`dashboard/public/app.js::normalizeRunData` ainda aceita o schema antigo (`claudeAgents`/`openaiAgents`/`nvidiaAgents`/`communityAgents`, `arbiters` com `juiz-claude`/`juiz-openai`/`juiz-nvidia`) e o achata em `specialistAgents`, pra runs gravadas antes desta mudança não sumirem do painel.

Pontos de atualização recomendados (cada um é um `Edit` no `state.json`, não precisa reescrever o arquivo inteiro):
1. **Início da rodada**: crie o arquivo com `run` preenchido; `specialistAgents` só é populado DEPOIS do kickoff decidir a alocação (ver `orchestrate.js::runRound`) — antes disso a lista fica vazia, é esperado.
2. **Cada especialista que dispara**: mude o `state` dele pra `"running"`.
3. **Cada especialista que termina**: mude pra `"done"` (ou `"failed"`/`"refused"`/`"skipped"`), preencha `findings` e `elapsed`. Adicione uma entrada em `activity`.
4. **Juiz e Líder**: mesma lógica em `arbiters` (agora só 2 entradas, `juiz` e `lider`).
5. **Juiz**: preencha `judgeReports.unified` com o relatório consolidado único.
6. **Líder/Sintetizador**: preencha `headline`, `lede`, `synthBlocks` e `dissent` (ou omita `dissent` se não houver divergência genuína nesta rodada).
7. **Fim**: `run.status = "done"` (ou `"failed"`), `run.elapsed`/`run.cost` finais.

O painel tolera campos ausentes/arrays vazios (mostra um estado vazio explicando o que falta) — não é preciso preencher tudo de uma vez.

## O que este documento NÃO cobre ainda

O dashboard (`dashboard/public/`) já foi desenhado e construído com dados mockados prevendo um protocolo de debate multi-turno entre os dois lados (afirmação/contestação/concessão/confirmação/impasse) e rodadas plurais — isso é uma extensão de arquitetura ainda **não implementada** no backend real descrito acima. A sequência atual é "cada lado roda uma vez, juízes consolidam, verificação adversarial audita, líder sintetiza" — sem um mecanismo de troca de mensagens entre os agentes dos dois lados. Formalizar esse protocolo (e como ele se encaixa nesta orquestração) é trabalho futuro, não coberto por este documento nem pelas verificações da Ordem de construção do plano original.
