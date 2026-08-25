<p align="center">
  <img src="docs/assets/icon.png" width="140" alt="Quorum">
</p>

<h1 align="center">Quorum</h1>

<p align="center">
  <strong>Um conselho de IAs de fornecedores diferentes revisando o mesmo código, em paralelo.</strong>
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-0.1.0-6C5CE7?style=flat-square">
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A518-3C873A?style=flat-square&logo=node.js&logoColor=white">
  <img alt="Claude" src="https://img.shields.io/badge/Claude-Sonnet%205-D97757?style=flat-square&logo=anthropic&logoColor=white">
  <img alt="OpenAI" src="https://img.shields.io/badge/GPT-5.6-412991?style=flat-square&logo=openai&logoColor=white">
  <img alt="NVIDIA" src="https://img.shields.io/badge/Nemotron-3%20Super-76B900?style=flat-square&logo=nvidia&logoColor=white">
</p>

<p align="center">
  <a href="#fluxo">Fluxo</a> ·
  <a href="#como-rodar">Como rodar</a> ·
  <a href="#segurança">Segurança</a>
</p>

---

Framework de orquestração multi-agente **cross-vendor**: especialistas Claude, GPT/Codex e um
fornecedor independente (NVIDIA) atacam o mesmo problema em paralelo, cada grupo com juiz próprio,
e um líder cruza os três lados antes de entregar um relatório único.

Template genérico — não referencia nenhum projeto específico. Todo agente recebe o escopo e a
tarefa via parâmetro (`--scope`, `--task`), nunca hardcoded.

## Fluxo

<p align="center">
  <img src="docs/fluxo-conselho.svg" alt="Fluxo do Conselho">
</p>

**1 · Kickoff** — o Líder (Opus) faz uma pesquisa rápida no código e monta o brief que os 3 grupos
recebem como tarefa.

**2 · Três grupos em paralelo** — mesmo brief, mesmas 6 lentes espelhadas (arquitetura, segurança,
regras de negócio, bug hunter, engenharia de software, dados):

| Grupo | Especialistas | Modelo | Execução | Custo |
|---|---|---|---|---|
| **Claude** | 6 | Sonnet 5 | `claude -p` (`claude-code-local`) | assinatura já logada, sem custo de API |
| **OpenAI/Codex** | 6 | GPT-5.6 Terra/Luna | `codex exec` (`codex-local`) | assinatura ChatGPT/Codex, sem custo de API |
| **NVIDIA/Hermes** | 1 | Nemotron 3 Super 120B | NVIDIA NIM | plano free |

> O Grupo NVIDIA cobre documentação & legibilidade. Ele existe para ser um **fornecedor de modelo
> independente** dos outros dois — reduz o viés compartilhado de quem foi treinado parecido.

**3 · Um juiz por grupo** (Claude, OpenAI, NVIDIA) relê o código antes de aceitar qualquer achado e
consolida o relatório do próprio lado.

**4 · Líder/Sintetizador** cruza os 3 relatórios já julgados. Divergência de **fato** ele resolve
sozinho, reabrindo o código. Divergência de **decisão** ele nunca decide sozinho — isso vai pro
usuário. Substitui a etapa antiga de verificação adversarial separada.

**5 · Relatório final** em `runs/<run-id>/FINAL_REPORT.md` — headline, P0/P1/Descartado, e a
divergência não resolvida quando houver.

## Como rodar

```bash
npm run install:all        # node_modules de claude-side/engine e openai-side
node dashboard/server.js   # painel em http://localhost:7331
```

Ou direto por linha de comando, sem o painel:

```bash
node orchestrate.js \
  --scope /caminho/do/projeto \
  --task "descrição da revisão" \
  --run-id <id> \
  --out runs/<id>
```

<details>
<summary><strong>Chaves de API</strong> — o padrão não precisa de nenhuma</summary>

<br>

| Variável | Quando é necessária |
|---|---|
| `NVIDIA_API_KEY` | Opcional. Sem ela, o Grupo NVIDIA/Hermes simplesmente não roda. |
| `ANTHROPIC_API_KEY` | Só se trocar `claude_provider` pra `claude-api` em `config/models.json`. |
| `OPENAI_API_KEY` | Só se trocar `openai_provider` pra `openai-api` em `config/models.json`. |

Cada provedor local (`claude-code-local` / `codex-local`) tem um fallback pago por token
(`claude-api` / `openai-api`) para ambientes sem as CLIs logadas.

</details>

## Segurança

Os agentes leem código de verdade, então o confinamento ao `--scope` não é opcional — e a garantia
muda conforme o provedor:

| Provedor | Ferramentas | Como o `--scope` é garantido |
|---|---|---|
| `-local` *(padrão)* | Read/Grep/Glob da própria CLI, **sem Bash** | sandbox da CLI, via diretório de trabalho |
| `-api` | ler arquivo, grep, listar, rodar comando | path-guard + allowlist de comando **em código** |

O detalhe de cada garantia está em `openai-side/src/security/`,
`claude-side/engine/providers/claude-code-local.js` e `openai-side/src/providers/codex-local.js`.
