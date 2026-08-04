# Quorum

Framework de orquestração multi-agente cross-vendor: um "conselho" que roda especialistas Claude e especialistas OpenAI em paralelo sobre o mesmo problema, com juízes por vendor, verificação adversarial cruzada, e um líder que sintetiza os dois lados antes de entregar um relatório único.

Template genérico — não referencia nenhum projeto específico. Todo agente recebe o escopo e a tarefa via parâmetro (`--scope`, `--task`), nunca hardcoded.

## Papéis

**Lado Claude** (10 especialistas Sonnet + 1 Juiz Opus com ferramentas): arquitetura, segurança, regras de negócio, usabilidade, melhorias, engenharia de software, QA, dados, design/UI, infraestrutura/deploy.

**Lado OpenAI** (5 especialistas GPT-5.6 Terra + 1 Juiz GPT-5.6 Sol com ferramentas): pesquisa, segurança, bug hunter, melhorias, dependências.

**Depois dos dois grupos:**
- Verificação adversarial (2-3 agentes Claude Sonnet) confere as afirmações do lado OpenAI contra o código real antes delas entrarem na síntese.
- Líder/Sintetizador (Claude Opus) cruza os dois lados, resolve divergências, e entrega o relatório final documentado.

Ver `docs/ARCHITECTURE.md` para o diagrama completo e `claude-side/ORCHESTRATION.md` para a sequência exata de execução.

## Como rodar o lado OpenAI

```bash
cd openai-side
npm install
cp ../.env.example ../.env   # preencha OPENAI_API_KEY (nunca commite este arquivo)
node run.js --scope /caminho/do/projeto --task "descrição da revisão" --out ../runs/<id>/openai-side/
```

O lado Claude roda dentro de uma sessão do Claude Code (usa a ferramenta `Workflow`, não é standalone) — ver `claude-side/ORCHESTRATION.md`.

## Segurança

Todo agente do lado OpenAI tem acesso real a ferramentas (ler arquivo, grep, listar arquivos, rodar comando) contra o `--scope` informado. Isso é intencional (o objetivo é uma segunda opinião que explora o código de verdade, não uma opinião de texto solto) e por isso as guardas em `openai-side/src/security/` não são opcionais — ver `docs/SECURITY.md`.
