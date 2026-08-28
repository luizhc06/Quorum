'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseKickoff, sanitizeAllocation, defaultAllocation, applyPins } = require('../config/allocation');

test('parseKickoff separa o brief do bloco JSON cercado', () => {
  const text = 'Brief aqui.\nMais uma linha.\n\n```json\n{"specialties":[{"key":"seguranca","models":["deepseek-r1:8b"]}]}\n```';
  const { brief, rawAllocation } = parseKickoff(text);
  assert.equal(brief, 'Brief aqui.\nMais uma linha.');
  assert.deepEqual(rawAllocation, [{ key: 'seguranca', models: ['deepseek-r1:8b'] }]);
});

test('parseKickoff tolera ausência do bloco JSON', () => {
  const { brief, rawAllocation } = parseKickoff('só o brief, sem alocação');
  assert.equal(brief, 'só o brief, sem alocação');
  assert.equal(rawAllocation, null);
});

test('parseKickoff tolera JSON malformado dentro do bloco', () => {
  const { rawAllocation } = parseKickoff('brief\n```json\n{ isso não é json }\n```');
  assert.equal(rawAllocation, null);
});

test('sanitizeAllocation descarta especialidade fora do catálogo e model id indisponível', () => {
  const specialties = [{ key: 'seguranca' }, { key: 'dados' }];
  const raw = [
    { key: 'seguranca', models: ['deepseek-r1:8b', 'modelo-fantasma'] },
    { key: 'especialidade-inexistente', models: ['deepseek-r1:8b'] },
  ];
  const cleaned = sanitizeAllocation(raw, { specialties, availableModelIds: ['deepseek-r1:8b'], maxSpecialties: 6 });
  assert.deepEqual(cleaned, [{ key: 'seguranca', models: ['deepseek-r1:8b'] }]);
});

test('sanitizeAllocation respeita o teto de especialidades', () => {
  const specialties = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  const raw = [
    { key: 'a', models: ['m1'] },
    { key: 'b', models: ['m1'] },
    { key: 'c', models: ['m1'] },
  ];
  const cleaned = sanitizeAllocation(raw, { specialties, availableModelIds: ['m1'], maxSpecialties: 2 });
  assert.equal(cleaned.length, 2);
});

test('sanitizeAllocation devolve null quando nada sobrevive à validação', () => {
  const specialties = [{ key: 'seguranca' }];
  const cleaned = sanitizeAllocation([{ key: 'seguranca', models: ['indisponivel'] }], { specialties, availableModelIds: [], maxSpecialties: 6 });
  assert.equal(cleaned, null);
});

test('defaultAllocation escolhe o modelo de maior força disponível por especialidade', () => {
  const specialties = [
    { key: 'seguranca', strengths: { 'deepseek-r1:8b': 'alta', 'claude-sonnet-5': 'media' } },
    { key: 'dados', strengths: { 'claude-sonnet-5': 'media' } },
  ];
  const allocation = defaultAllocation({ specialties, availableModelIds: ['deepseek-r1:8b', 'claude-sonnet-5'], maxSpecialties: 6 });
  assert.deepEqual(allocation, [
    { key: 'seguranca', models: ['deepseek-r1:8b'] },
    { key: 'dados', models: ['claude-sonnet-5'] },
  ]);
});

test('defaultAllocation ignora especialidade sem nenhum modelo disponível mapeado', () => {
  const specialties = [
    { key: 'seguranca', strengths: { 'modelo-fantasma': 'alta' } },
    { key: 'dados', strengths: { 'claude-sonnet-5': 'alta' } },
  ];
  const allocation = defaultAllocation({ specialties, availableModelIds: ['claude-sonnet-5'], maxSpecialties: 6 });
  assert.deepEqual(allocation, [{ key: 'dados', models: ['claude-sonnet-5'] }]);
});

test('defaultAllocation nunca "roda tudo em tudo" quando não há nenhum modelo disponível', () => {
  const specialties = [{ key: 'seguranca', strengths: { 'claude-sonnet-5': 'alta' } }];
  const allocation = defaultAllocation({ specialties, availableModelIds: [], maxSpecialties: 6 });
  assert.deepEqual(allocation, []);
});

test('defaultAllocation respeita o teto de especialidades', () => {
  const specialties = [
    { key: 'a', strengths: { m: 'alta' } },
    { key: 'b', strengths: { m: 'alta' } },
    { key: 'c', strengths: { m: 'alta' } },
  ];
  const allocation = defaultAllocation({ specialties, availableModelIds: ['m'], maxSpecialties: 2 });
  assert.equal(allocation.length, 2);
});

test('applyPins força o modelo fixado, mesmo substituindo a escolha do alocador', () => {
  const allocation = [{ key: 'seguranca', models: ['claude-sonnet-5'] }];
  const result = applyPins(allocation, { seguranca: ['deepseek-r1:8b'] }, ['deepseek-r1:8b', 'claude-sonnet-5']);
  assert.deepEqual(result, [{ key: 'seguranca', models: ['deepseek-r1:8b'] }]);
});

test('applyPins adiciona especialidade fixada mesmo se o alocador não tinha escolhido', () => {
  const allocation = [{ key: 'seguranca', models: ['claude-sonnet-5'] }];
  const result = applyPins(allocation, { dados: ['claude-sonnet-5'] }, ['claude-sonnet-5']);
  assert.deepEqual(result, [
    { key: 'seguranca', models: ['claude-sonnet-5'] },
    { key: 'dados', models: ['claude-sonnet-5'] },
  ]);
});

test('applyPins ignora modelo fixado que não está disponível agora', () => {
  const allocation = [{ key: 'seguranca', models: ['claude-sonnet-5'] }];
  const result = applyPins(allocation, { seguranca: ['modelo-indisponivel'] }, ['claude-sonnet-5']);
  assert.deepEqual(result, [{ key: 'seguranca', models: ['claude-sonnet-5'] }]);
});
