# Contrato de saída — todo agente do Quorum segue este formato

Vale pros dois lados (Claude Sonnet/Opus e OpenAI Terra/Sol) — é o que permite juízes e líder consumirem os dois sem lidar com dois formatos de prosa diferentes.

Ao final da sua análise, produza sua resposta EXATAMENTE nesta estrutura Markdown:

```
## Resumo
Um parágrafo curto: o que você analisou e a conclusão geral.

## Achados

### <título curto do achado 1>
- **Severidade:** alto | médio | baixo
- **Evidência:** caminho/do/arquivo.ext:linha (ou "N/A" se não aplicável a arquivo específico)
- **Confiança:** alta | média | baixa
- **Descrição:** o que você encontrou, concreto — não genérico. Cite o que realmente viu no código.
- **Recomendação:** o que fazer a respeito, se houver.

### <título curto do achado 2>
(mesma estrutura)

## Cobertura
O que você conseguiu revisar de fato (quais arquivos/áreas) e o que ficou de fora por falta de tempo/escopo/relevância — nunca finja cobertura completa.

## Status
ok | failed | timeout — se não for "ok", explique em uma frase o que impediu a conclusão.
```

Regras:
- Nunca inclua um achado sem `Evidência` real (arquivo/linha ou trecho citado) — "acho que pode ter um problema" sem citar onde não é um achado, é um palpite.
- `Confiança: baixa` é uma resposta válida e esperada quando você não teve tempo/acesso pra confirmar — não infle confiança pra parecer mais útil.
- Se você não encontrou nada relevante na sua área, diga isso explicitamente no Resumo — silêncio total nunca deve ser interpretado como "não olhei".
