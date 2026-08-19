#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const implRoot = resolve(here, '..');
const repoRoot = resolve(implRoot, '..');
const expected = JSON.parse(readFileSync(resolve(here, 'expected-red.json'), 'utf8'));
const shipped = JSON.parse(readFileSync(resolve(here, 'shipped-holistic-contracts.json'), 'utf8'));
const spec = readFileSync(resolve(repoRoot, 'docs/37-holistic-runtime-convergence.md'), 'utf8');

for (const [label, manifest] of [['unresolved', expected], ['shipped', shipped]]) {
  if (![1, 2].includes(manifest.schemaVersion) || !Array.isArray(manifest.contracts)) {
    throw new Error(`holistic-contracts: ${label} manifest invalid`);
  }
}

const rows = [...expected.contracts, ...shipped.contracts];
const ids = new Set();
const cell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
for (const contract of rows) {
  if (typeof contract.id !== 'string' || typeof contract.owner !== 'string'
    || typeof contract.status !== 'string' || typeof contract.requirement !== 'string') {
    throw new Error('holistic-contracts: malformed row');
  }
  if (ids.has(contract.id)) throw new Error(`holistic-contracts: duplicate id ${contract.id}`);
  ids.add(contract.id);
  const proof = contract.proof ?? contract.file ?? '';
  const normative = `| ${cell(contract.id)} | ${cell(contract.owner)} | ${cell(contract.status)} | ${cell(proof)} | ${cell(contract.requirement)} |`;
  if (!spec.includes(normative)) {
    throw new Error(`holistic-contracts: ${contract.id} differs from normative acceptance matrix`);
  }
  if (contract.status === 'shipped') {
    if (typeof contract.proof !== 'string' || contract.proof.length === 0) {
      throw new Error(`holistic-contracts: shipped ${contract.id} lacks production proof`);
    }
    const proofPath = resolve(repoRoot, contract.proof);
    if (!existsSync(proofPath)) {
      throw new Error(`holistic-contracts: shipped ${contract.id} proof path is missing: ${contract.proof}`);
    }
    if (contract.proof.includes('holistic-contract-harness')) {
      throw new Error(`holistic-contracts: shipped ${contract.id} cannot rely on the synthetic holistic harness`);
    }
  } else if (!['production_wiring_required', 'production_verification_required', 'contract_only'].includes(contract.status)) {
    throw new Error(`holistic-contracts: unsupported unresolved status ${contract.status}`);
  }
}

const documented = [...spec.matchAll(/^\| ([A-Z]+-\d{3}) \|/gmu)].map((match) => match[1]);
for (const id of documented) {
  if (!ids.has(id)) throw new Error(`holistic-contracts: documented acceptance id ${id} has no manifest row`);
}
if (new Set(documented).size !== documented.length || documented.length !== rows.length) {
  throw new Error('holistic-contracts: normative acceptance matrix cardinality differs from manifests');
}

const requiredFamilies = [
  'CP', 'REG', 'ERR', 'LIF', 'ATT', 'MSG', 'STORE', 'READY', 'ISO', 'DEP',
  'MOD', 'REL', 'E2E', 'EVAL', 'SURF',
];
for (const family of requiredFamilies) {
  if (![...ids].some((id) => id.startsWith(`${family}-`))) {
    throw new Error(`holistic-contracts: remediation family ${family} has no contract`);
  }
}

process.stdout.write(`holistic-contracts: ${shipped.contracts.length} shipped, ${expected.contracts.length} unresolved across ${requiredFamilies.length} families; docs matrix exact\n`);
