#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const implRoot = resolve(here, '..');
const testRoot = resolve(implRoot, 'test');
const manifest = JSON.parse(readFileSync(resolve(here, 'expected-red.json'), 'utf8'));
const expectedRed = new Set(manifest.contracts
  .filter((entry) => typeof entry?.file === 'string' && entry.file.length > 0)
  .map((entry) => entry.file.replace(/^test\//u, '')));

const tests = readdirSync(testRoot)
  .filter((name) => name.endsWith('.test.mjs'))
  .filter((name) => !name.endsWith('-red.test.mjs'))
  .filter((name) => !expectedRed.has(name))
  .sort()
  .map((name) => resolve(testRoot, name));

if (tests.length === 0) {
  process.stderr.write('shipped-suite: no shipped tests discovered\n');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...tests, ...process.argv.slice(2)], {
  cwd: implRoot,
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  process.stderr.write(`shipped-suite: could not start node test: ${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
