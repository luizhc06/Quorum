'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// Provedor alternativo pro lado OpenAI: em vez de chamar a Responses API
// (cobrada por token), roda o Codex CLI (`codex exec`) já autenticado via
// `codex login` na conta ChatGPT do usuário — consome o plano assinado, não
// a API paga. Confirmado ao vivo (05/08/2026): achou uma SQL injection real
// e respeitou a instrução de não ler .env, sem gastar um centavo de API.
//
// Diferença de segurança importante em relação ao provedor openai-api: lá,
// o confinamento de escopo e o bloqueio de segredo são garantidos em CÓDIGO
// (path-guard.js/secret-denylist.js) — o modelo não tem como ler um .env
// mesmo que tente. Aqui, o Codex usa suas PRÓPRIAS ferramentas internas
// dentro do próprio sandbox --sandbox read-only (que impede ESCRITA fora do
// escopo) — a proteção contra LEITURA de segredo é só a instrução no prompt,
// não um bloqueio de código. Pra escopos confiáveis (o próprio código do
// usuário) isso é aceitável; não é o mesmo nível de garantia do outro lado.
//
// Achado ao testar: o sandbox read-only do Codex no Windows nega acesso a
// caminhos dentro de AppData\Local\Temp — funciona normalmente em caminhos
// padrão (Desktop, Documents, etc). Evite apontar --scope pra dentro de temp.

const CODEX_BINARY = 'codex';

// codex-local precisa de shell:true no Windows — exceção pontual e
// justificada à regra "nunca shell:true" que vale pro resto do projeto
// (ver command-allowlist.js). Motivo técnico: no Windows, o binário do
// Codex CLI instalado via npm é um wrapper .cmd, e execFile SEM shell
// sempre falha com ENOENT pra esse tipo de arquivo — é uma limitação do
// Node, não uma escolha (confirmado por teste real, 05/08/2026, mesma
// classe de bug já encontrada com npm/composer em run_command.js).
// Por que é seguro aqui mesmo assim: o conteúdo de risco real — o prompt
// gerado a partir de código potencialmente hostil que o agente vai ler —
// nunca passa pela linha de comando, vai inteiro via stdin. O único texto
// que entra na linha de comando é `scope` (um caminho de pasta digitado
// localmente pelo usuário, não conteúdo de arquivo nem saída de modelo) e
// `outputFile` (construído pelo próprio código, nunca por entrada externa).
// scope ainda passa por validateNoShellMetacharacters como defesa extra.
const SHELL_METACHARACTERS = /[&|;`$()<>^%"]/;
function validateNoShellMetacharacters(value, label) {
  if (SHELL_METACHARACTERS.test(value)) {
    throw new Error(`${label} contém caractere não permitido para uso em linha de comando: ${value}`);
  }
}
// Com shell:true, o Node NÃO escapa os elementos do array — só concatena
// (aviso oficial do próprio Node). Caminhos com espaço ("Valence Store")
// quebram sem aspas manuais. Como já validamos que não há metacaracteres
// de shell (inclusive aspas duplas) em cada valor, envolver em "..." aqui é
// seguro: não há como o conteúdo escapar das aspas.
function quoteArg(value) {
  return /\s/.test(value) ? `"${value}"` : value;
}

function buildFullPrompt(persona, task, outputContract) {
  return `${persona}\n\nTarefa: ${task}\n\nAo final, siga este contrato de saída:\n\n${outputContract}`;
}

function runCodexExec({ model, scope, prompt, outputFile, timeoutMs }) {
  validateNoShellMetacharacters(scope, 'scope');
  validateNoShellMetacharacters(outputFile, 'outputFile');
  if (model) validateNoShellMetacharacters(model, 'model');
  return new Promise((resolve, reject) => {
    const args = ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--cd', quoteArg(scope), '-o', quoteArg(outputFile)];
    if (model) args.push('-m', quoteArg(model));
    args.push('-'); // lê o prompt do stdin — evita limite de tamanho de argumento de linha de comando

    const child = execFile(CODEX_BINARY, args, { timeout: timeoutMs, maxBuffer: 20_000_000, windowsHide: true, shell: true }, (err, stdout, stderr) => {
      if (err && !fs.existsSync(outputFile)) {
        // só trata como falha de verdade se nem o arquivo de saída foi escrito —
        // o codex às vezes retorna código de saída != 0 mesmo tendo concluído
        if (err.killed) return reject(new Error('tempo esgotado'));
        if (/out of credits/i.test(stderr)) {
          return reject(new Error('cota do plano ChatGPT/Codex esgotada — espere o plano renovar (ou peça pro dono do workspace reabastecer) antes de tentar de novo'));
        }
        // pega só a última linha não vazia — é o resumo do erro; o resto do
        // stderr costuma ser o banner + todo o prompt ecoado de volta
        const lastLine = stderr.trim().split('\n').filter(Boolean).pop() || err.message;
        return reject(new Error(lastLine.slice(0, 500)));
      }
      resolve({ stdout, stderr });
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function runCodexAgent({ name, model, persona, task, scope, limits, outDir, outputContract }) {
  const startedAt = Date.now();
  const outputFile = path.join(outDir, `${name}.codex-output.md`);
  fs.mkdirSync(outDir, { recursive: true });
  const prompt = buildFullPrompt(persona, task, outputContract);

  try {
    const { stdout } = await runCodexExec({ model, scope, prompt, outputFile, timeoutMs: limits.maxWallClockMs });
    const finalText = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : '';
    const tokensMatch = stdout.match(/tokens used[^\d]*([\d.,]+)/i);
    return {
      agent: name,
      model: model || 'codex-local',
      finalText,
      status: finalText.trim() ? 'ok' : 'failed',
      provider: 'codex-local',
      usage: { source: 'plano ChatGPT/Codex (sem custo de API)', tokensReported: tokensMatch ? tokensMatch[1] : null },
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      agent: name,
      model: model || 'codex-local',
      status: 'failed',
      provider: 'codex-local',
      reason: 'codex_exec_error',
      error: err.message,
      elapsedMs: Date.now() - startedAt,
    };
  }
}

module.exports = { runCodexAgent };
