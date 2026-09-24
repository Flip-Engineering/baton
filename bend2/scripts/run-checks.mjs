#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const BEND_INSTALLED = join(ROOT, 'node_modules', '.bend', 'bin', 'bend');
const BEND_FALLBACK = join(ROOT, '.bend', 'bin', 'bend');
const INSTALLER = join(ROOT, 'docs', 'bend2', 'reference', 'toolchain', 'install-2.0.25.sh');
const SRC = join(ROOT, 'bend2', 'src');
const SCRATCH = join(ROOT, '.scratch', 'bend2');

const ENV = { ...process.env, BEND_NO_TELEMETRY: '1' };

function resolveBend() {
  if (existsSync(BEND_INSTALLED)) return BEND_INSTALLED;
  if (existsSync(BEND_FALLBACK)) return BEND_FALLBACK;
  if (!existsSync(INSTALLER)) {
    console.error(`bend not found and installer missing: ${INSTALLER}`);
    process.exit(1);
  }
  execFileSync('bash', [INSTALLER], {
    env: { ...ENV, BEND_HOME: join(ROOT, '.bend') },
    stdio: 'inherit',
  });
  if (existsSync(BEND_FALLBACK)) return BEND_FALLBACK;
  console.error('bend installation failed');
  process.exit(1);
}

const BEND = resolveBend();

const version = execFileSync(BEND, ['version'], { env: ENV, encoding: 'utf8' }).trim();
if (version !== 'bend 2.0.25') {
  console.error(`expected bend 2.0.25, got: ${version}`);
  process.exit(1);
}

function discoverModules(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...discoverModules(full));
    } else if (entry.name.endsWith('.bend')) {
      results.push(full);
    }
  }
  return results.sort();
}

function moduleName(path) {
  return relative(SRC, path).replace(/\.bend$/, '');
}

function run(args, opts = {}) {
  return execFileSync(BEND, args, { env: ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

const modules = discoverModules(SRC);
let totalModules = 0;
let totalRuns = 0;
let failures = 0;

for (const mod of modules) {
  const name = moduleName(mod);
  const expectedPath = mod.replace(/\.bend$/, '.expected.txt');
  const result = { module: name, checkOnly: null, interpreted: null, native: null };

  if (!existsSync(expectedPath)) {
    result.checkOnly = 'skip';
    result.interpreted = 'fail';
    result.native = 'fail';
    result.error = 'missing expected file';
    failures++;
    console.log(JSON.stringify(result));
    totalModules++;
    continue;
  }

  const expected = readFileSync(expectedPath, 'utf8');

  try {
    run(['--check-only', mod]);
    result.checkOnly = 'pass';
  } catch (err) {
    result.checkOnly = 'fail';
    result.error = 'check-only failed';
    failures++;
    console.log(JSON.stringify(result));
    totalModules++;
    continue;
  }

  let interpretedOut;
  try {
    interpretedOut = run([mod]);
    totalRuns++;
    if (interpretedOut === expected) {
      result.interpreted = 'pass';
    } else {
      result.interpreted = 'fail';
      result.error = 'interpreted output mismatch';
      failures++;
      console.log(JSON.stringify(result));
      totalModules++;
      continue;
    }
  } catch (err) {
    result.interpreted = 'fail';
    result.error = 'interpreted run failed';
    failures++;
    console.log(JSON.stringify(result));
    totalModules++;
    continue;
  }

  mkdirSync(SCRATCH, { recursive: true });
  const binaryPath = join(SCRATCH, name.replace(/\//g, '-'));
  let nativeOut;
  try {
    run([mod, '-o', binaryPath]);
    nativeOut = execFileSync(binaryPath, [], { env: ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    totalRuns++;
    if (nativeOut === expected) {
      result.native = 'pass';
    } else {
      result.native = 'fail';
      result.error = 'native output mismatch';
      failures++;
    }
  } catch (err) {
    result.native = 'fail';
    result.error = `native build or run failed: ${err.message}`;
    failures++;
  }

  console.log(JSON.stringify(result));
  totalModules++;
}

const verdict = failures === 0 ? 'green' : 'FAILED';
console.log(`bend2 checks: ${verdict} - ${totalModules} modules, ${totalRuns} runs, ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
