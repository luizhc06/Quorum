#!/usr/bin/env node
'use strict';

require('./env').loadEnvFile(__dirname);
const { getProviderHealth } = require('./provider-health');

const providers = getProviderHealth();
console.log('\nQuorum · diagnóstico de provedores\n');
for (const provider of providers) {
  console.log(`${provider.available ? '✓' : '○'} ${provider.name.padEnd(34)} ${provider.detail}`);
}
console.log('\n○ significa opcional/indisponível; a rodada continua com os demais provedores.\n');
