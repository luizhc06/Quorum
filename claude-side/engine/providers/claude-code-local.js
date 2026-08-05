'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// Provedor alternativo pro lado Claude: em vez de chamar a Messages API
// (cobrada por token via ANTHROPIC_API_KEY), roda o próprio Claude Code CLI
// (`claude -p`) já autenticado na conta/assinatura do usuário — consome o
// plano assinado, não a API paga. Espelha openai-side/src/providers/
// codex-local.js (mesma ideia, provedor irmão do lado OpenAI).
//
// Confirmado ao vivo (05/08/2026) antes de escrever este arquivo, contra o
// `claude` real instalado nesta máquina — não por suposição:
// - `claude -p` lê o prompt do stdin quando nenhum argumento posicional é
//   passado (mesmo truque que o codex-local usa com `-` — evita limite de
//   tamanho de argumento de linha de comando).
// - `--output-format json` devolve um único objeto JSON com `result` (texto
//   final), `total_cost_usd`, `usage`, `is_error`, `session_id`,
//   `permission_denials`. `total_cost_usd` é reportado mesmo sob assinatura
//   (não API paga) — é o valor "como se fosse" cobrado por token, útil só
//   pra estimativa/telemetria no painel, nunca uma cobrança real aqui.
// - `--tools "Read,Grep,Glob"` restringe de verdade: testado pedindo pro
//   agente tentar escrever um arquivo — ele respondeu que nem tinha uma
//   ferramenta de shell disponível (a ferramenta nem existe no set dele,
//   não é uma permissão negada em tempo de execução).
// - Não precisou de --dangerously-skip-permissions: com só Read/Grep/Glob
//   disponíveis (nada que precise de aprovação), `-p` roda até o fim sem
//   travar esperando confirmação interativa.
// - `--model` aceita tanto alias ('opus'/'sonnet'/'haiku') quanto o ID
//   completo (ex. 'claude-sonnet-5') — os mesmos IDs já usados em
//   config/models.json pro motor da API funcionam aqui sem tradução.
// - `--append-system-prompt-file <path>` existe de verdade (testado ao
//   vivo — não documentado na listagem principal de --help, só citado de
//   passagem na descrição de --bare, por isso a checagem empírica antes de
//   confiar) e é o que usamos pra persona/contrato: eles quase sempre têm
//   crase, parênteses e aspas (ex. `Confiança: média`, `.env*`), que
//   quebrariam validateNoShellMetacharacters se fossem inline. Só a TAREFA
//   (texto que pode vir de código/comentário hostil) vai por stdin — a
//   persona/contrato (sempre nosso próprio texto estático) vai por arquivo.
//
// Diferença de segurança em relação ao provedor claude-api: lá, o
// confinamento de escopo é garantido em CÓDIGO (path-guard.js) — o modelo
// não tem como ler fora do escopo mesmo tentando. Aqui, o Code CLI roda
// com cwd = escopo e só ferramentas de leitura (Read/Grep/Glob) — a
// exclusão de Bash/Edit/Write no --tools impede escrita e execução de
// comando, mas Read/Grep ainda podem, em tese, seguir um caminho absoluto
// pra fora do escopo se o modelo tentar (o Code CLI não tem um path-guard
// próprio equivalente). Pra escopos confiáveis (o próprio código do
// usuário) isso é aceitável — mesma escolha já aceita pro codex-local.
//
// Limitação conhecida, documentada (não escondida): --tools não inclui Bash
// nesta v1, então não há equivalente ao run_command (ex. `git log`) que o
// provedor claude-api oferece — os especialistas rodando por aqui perdem
// esse ângulo. Se isso importar no futuro, dá pra reabilitar Bash com
// --allowedTools "Bash(git log:*) Bash(git diff:*)" pra manter só leitura.

const CLAUDE_BINARY = 'claude';

// Mesma exceção pontual e justificada de shell:true que o codex-local
// documenta: confirmado nesta máquina que o CLI instalado via npm tem um
// wrapper claude.cmd no Windows (além do script POSIX sem extensão) —
// execFile sem shell:true falha com ENOENT pra esse tipo de arquivo, é
// limitação do Node, não escolha. O conteúdo de risco real (persona/tarefa,
// possivelmente derivado de código hostil) nunca passa pela linha de
// comando — vai inteiro via stdin. Só `scope`/`contextPath` (caminho local
// digitado pelo usuário) e `model` (vindo de config/models.json, nunca de
// entrada externa) entram na linha de comando, e passam por
// validateNoShellMetacharacters como defesa extra.
const SHELL_METACHARACTERS = /[&|;`$()<>^%"]/;
function validateNoShellMetacharacters(value, label) {
  if (SHELL_METACHARACTERS.test(value)) {
    throw new Error(`${label} contém caractere não permitido para uso em linha de comando: ${value}`);
  }
}
function quoteArg(value) {
  return /\s/.test(value) ? `"${value}"` : value;
}

function runClaudeExec({ model, scope, contextPath, systemPromptFile, prompt, timeoutMs, maxCostUsd }) {
  validateNoShellMetacharacters(scope, 'scope');
  if (contextPath) validateNoShellMetacharacters(contextPath, 'contextPath');
  if (model) validateNoShellMetacharacters(model, 'model');
  // systemPromptFile é sempre construído pelo nosso próprio código
  // (path.join(outDir, ...)), nunca conteúdo externo — mas valida mesmo
  // assim, defesa em profundidade, já que também vira argumento de linha
  // de comando.
  validateNoShellMetacharacters(systemPromptFile, 'systemPromptFile');

  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--output-format', 'json',
      '--no-session-persistence',
      '--tools', 'Read,Grep,Glob',
      '--append-system-prompt-file', quoteArg(systemPromptFile),
    ];
    if (model) args.push('--model', quoteArg(model));
    if (contextPath) args.push('--add-dir', quoteArg(contextPath));
    if (maxCostUsd) args.push('--max-budget-usd', String(maxCostUsd));

    const child = execFile(
      CLAUDE_BINARY,
      args,
      { cwd: scope, timeout: timeoutMs, maxBuffer: 20_000_000, windowsHide: true, shell: true },
      (err, stdout, stderr) => {
        if (err) {
          if (err.killed) return reject(new Error('tempo esgotado'));
          const lastLine = stderr.trim().split('\n').filter(Boolean).pop() || err.message;
          return reject(new Error(lastLine.slice(0, 500)));
        }
        resolve({ stdout, stderr });
      }
    );
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function runClaudeCodeAgent({ name, model, systemPrompt, task, scope, contextPath, limits, outDir }) {
  const startedAt = Date.now();
  fs.mkdirSync(outDir, { recursive: true });
  const systemPromptFile = path.join(outDir, `${name}.system-prompt.md`);
  fs.writeFileSync(systemPromptFile, systemPrompt);

  try {
    const { stdout } = await runClaudeExec({
      model, scope, contextPath, systemPromptFile, prompt: task,
      timeoutMs: limits.maxWallClockMs, maxCostUsd: limits.maxCostUsd,
    });

    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch (e) {
      throw new Error(`saída do claude -p não é JSON válido: ${stdout.slice(0, 300)}`);
    }
    fs.writeFileSync(path.join(outDir, `${name}.claude-code-output.json`), JSON.stringify(parsed, null, 2));

    const finalText = typeof parsed.result === 'string' ? parsed.result : '';
    const result = {
      agent: name,
      model: model || 'claude-code-local',
      finalText,
      status: parsed.is_error ? 'failed' : (finalText.trim() ? 'ok' : 'failed'),
      provider: 'claude-code-local',
      usage: {
        source: 'assinatura Claude Code (sem custo de API separado)',
        estimatedUsd: typeof parsed.total_cost_usd === 'number' ? Number(parsed.total_cost_usd.toFixed(4)) : null,
        inputTokens: parsed.usage?.input_tokens ?? null,
        outputTokens: parsed.usage?.output_tokens ?? null,
      },
      permissionDenials: parsed.permission_denials || [],
      elapsedMs: Date.now() - startedAt,
    };
    if (parsed.is_error) {
      result.reason = 'claude_code_error';
      result.error = finalText || parsed.subtype || 'erro não especificado pelo CLI';
    }
    return result;
  } catch (err) {
    return {
      agent: name,
      model: model || 'claude-code-local',
      status: 'failed',
      provider: 'claude-code-local',
      reason: 'claude_exec_error',
      error: err.message,
      elapsedMs: Date.now() - startedAt,
    };
  }
}

module.exports = { runClaudeCodeAgent };
