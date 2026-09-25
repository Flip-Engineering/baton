#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const implRoot = resolve(here, '..');
const manifest = JSON.parse(readFileSync(resolve(here, 'expected-red.json'), 'utf8'));

if (![1, 2].includes(manifest.schemaVersion) || !Array.isArray(manifest.contracts)) {
  process.stderr.write('contract-suite: invalid unresolved-contract manifest\n');
  process.exit(1);
}

let failed = false;
for (const contract of manifest.contracts) {
  if (!contract || typeof contract.id !== 'string' || typeof contract.owner !== 'string'
    || typeof contract.status !== 'string' || typeof contract.requirement !== 'string'
    || contract.requirement.length === 0) {
    process.stderr.write('contract-suite: malformed unresolved contract row\n');
    failed = true;
    continue;
  }
  if (!['production_wiring_required', 'production_verification_required', 'contract_only'].includes(contract.status)) {
    process.stderr.write(`contract-suite: ${contract.id}: unsupported unresolved status ${contract.status}\n`);
    failed = true;
    continue;
  }
  // Legacy red-first rows may still carry an executable failure pin. New convergence rows do not
  // fabricate a failing toy test: their unresolved status is the machine truth until a production
  // path test/gate exists and the row is promoted to shipped-holistic-contracts.json.
  if (contract.file) {
    const file = resolve(implRoot, contract.file);
    if (!existsSync(file)) {
      process.stderr.write(`contract-suite: ${contract.id}: missing contract file ${contract.file}\n`);
      failed = true;
      continue;
    }
    const result = spawnSync(process.execPath, ['--test', file], {
      cwd: implRoot,
      env: { ...process.env, BATON_EXPECTED_RED_CONTRACT: contract.id },
      encoding: 'utf8',
    });
    if (result.error || result.status === 0 || !`${result.stdout ?? ''}\n${result.stderr ?? ''}`.includes(contract.id)) {
      process.stderr.write(`contract-suite: ${contract.id}: executable red contract drifted\n`);
      failed = true;
      continue;
    }
  }
  process.stdout.write(`contract-suite: ${contract.id}: ${contract.status}\n`);
}

process.exit(failed ? 1 : 0);
