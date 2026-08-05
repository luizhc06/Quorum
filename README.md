<p align="center">
  <img src="docs/assets/icon.png" width="120" alt="Ícone do Quorum">
</p>

<h1 align="center">Quorum</h1>

<p align="center">Framework de orquestração multi-agente cross-vendor: um "conselho" que roda especialistas Claude, GPT/Codex e um fornecedor independente (NVIDIA) em paralelo sobre o mesmo problema, cada grupo com juiz próprio, e um líder que cruza os três lados antes de entregar um relatório único.</p>

Template genérico — não referencia nenhum projeto específico. Todo agente recebe o escopo e a tarefa via parâmetro (`--scope`, `--task`), nunca hardcoded.

## Fluxo

![Fluxo do Conselho](docs/fluxo-conselho.svg)

1. **Kickoff** — o Líder (Opus) faz uma pesquisa rápida no código e monta o brief que os 3 grupos recebem como tarefa.
2. **3 grupos em paralelo**, mesmo brief, mesmas 6 lentes espelhadas (arquitetura, segurança, regras de negócio, bug hunter, engenharia de software, dados):
   - **Grupo Claude** — 6 especialistas Sonnet 5, via `claude -p` (`claude-code-local`) — usa a assinatura Claude Code já logada na máquina, sem custo de API.
   - **Grupo OpenAI/Codex** — 6 especialistas GPT-5.6 Terra/Luna, via `codex exec` (`codex-local`) — usa a assinatura ChatGPT/Codex, sem custo de API.
   - **Grupo NVIDIA/Hermes** — 1 especialista (documentação & legibilidade) sobre Nemotron 3 Super 120B, plano free da NVIDIA NIM — fornecedor de modelo independente, reduz viés compartilhado entre os outros dois.
3. **Um juiz por grupo** (Juiz Claude, Juiz OpenAI, Juiz NVIDIA) relê o código antes de aceitar qualquer achado e consolida o relatório do próprio lado.
4. **Líder/Sintetizador** cruza os 3 relatórios já julgados, resolve divergência de FATO sozinho (reabrindo o código), e nunca decide divergência de DECISÃO sozinho — isso vai pro usuário. Substitui a etapa antiga de "verificação adversarial" separada.
5. **Relatório final** (`runs/<run-id>/FINAL_REPORT.md`) — headline, P0/P1/Descartado, e divergência não resolvida quando houver.

Cada provedor local (`claude-code-local`/`codex-local`) tem um fallback pago por token (`claude-api`/`openai-api`, exige `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`) para ambientes sem as CLIs logadas — ver `config/models.json`.

## Como rodar

```bash
npm run install:all   # instala node_modules de claude-side/engine e openai-side
node dashboard/server.js   # painel em http://localhost:7331 — dispara e acompanha rodadas
```

Ou direto por linha de comando, sem o painel:

```bash
node orchestrate.js --scope /caminho/do/projeto --task "descrição da revisão" --run-id <id> --out runs/<id>
```

`NVIDIA_API_KEY` no `.env` é opcional (Grupo NVIDIA/Hermes só roda se estiver presente). `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` só são necessárias se você trocar `claude_provider`/`openai_provider` pra `claude-api`/`openai-api` em `config/models.json`.

## Segurança

O provedor `-api` de cada lado tem acesso a ferramentas (ler arquivo, grep, listar arquivos, rodar comando) contra o `--scope` informado, com path-guard e allowlist de comando em código (`openai-side/src/security/`) — não são opcionais. O provedor `-local` (padrão) usa as próprias ferramentas de leitura da CLI (Read/Grep/Glob, sem Bash), confinadas ao `--scope` via diretório de trabalho — mesma intenção, garantia por sandbox da CLI em vez de por código. Ver `claude-side/engine/providers/claude-code-local.js` e `openai-side/src/providers/codex-local.js` para o detalhe de cada garantia.
