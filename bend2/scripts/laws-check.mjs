#!/usr/bin/env node
// The negative control for the tree's law gate. The entry module imports
// bend2/src/coordinator/laws.bend, so a compile of the entry verifies every law
// the module states. This script proves that each law is really verified: for
// every `law` in bend2/src it copies the tree, removes that law's proof, and
// requires the entry's compile to fail. A law whose proof can be removed while
// the entry still compiles is not part of the gate, and the script reports it.
//
// Usage: node bend2/scripts/laws-check.mjs [compiler]

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SRC = join(ROOT, 'bend2', 'src');
const ENTRY = join('bend2', 'src', 'coordinator', 'main.bend');
const SCRATCH = join(ROOT, '.scratch', 'bend2-laws-check');
const ENV = { ...process.env, BEND_NO_TELEMETRY: '1' };

function resolveBend() {
  const candidates = [
    process.argv[2],
    process.env.BEND,
    join(ROOT, 'node_modules', '.bend', 'bin', 'bend'),
    join(ROOT, '.bend', 'bin', 'bend'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  console.error('Bend is unavailable. Set BEND to an installed Bend 2.0.25 executable.');
  process.exit(1);
}

const BEND = resolveBend();

function run(args, cwd) {
  return execFileSync(BEND, args, { env: ENV, cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function compile(cwd) {
  try {
    run([ENTRY, '--check-only'], cwd);
    return { ok: true, output: '' };
  } catch (err) {
    return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

function discover(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...discover(full));
    else if (entry.name.endsWith('.bend')) found.push(full);
  }
  return found.sort();
}

// One row per `law <name>:` in the tree, with the module that states it.
function laws() {
  const rows = [];
  for (const file of discover(SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const line of lines) {
      const match = /^law ([A-Za-z0-9_]+):/.exec(line);
      if (match) rows.push({ law: match[1], file });
    }
  }
  return rows;
}

// Remove the `def <name>(...)` block that proves <name>: the def line and every
// following blank or indented line. Returns false when no such def exists.
function removeProof(modulePath, name) {
  const text = readFileSync(modulePath, 'utf8');
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`def ${name}(`));
  if (start === -1) return false;
  let end = start + 1;
  while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end++;
  lines.splice(start, end - start);
  writeFileSync(modulePath, lines.join('\n'));
  return true;
}

const version = run(['version'], ROOT).trim();
if (version !== 'bend 2.0.25') {
  console.error(`expected bend 2.0.25, got: ${version}`);
  process.exit(1);
}

rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(SCRATCH, { recursive: true });
cpSync(join(ROOT, 'bend2'), join(SCRATCH, 'bend2'), { recursive: true });

const rows = laws();
let failures = 0;

const baseline = compile(SCRATCH);
console.log(JSON.stringify({ check: 'entry compiles with every law proven', passed: baseline.ok }));
if (!baseline.ok) {
  failures++;
  console.log(baseline.output.trimEnd());
  console.log(`laws-check: red - ${rows.length} laws, 1 compile, ${failures} failure; proof-removal controls did not run`);
  process.exit(1);
}

for (const { law, file } of rows) {
  const copied = join(SCRATCH, relative(ROOT, file));
  cpSync(file, copied);
  const removed = removeProof(copied, law);
  const control = removed ? compile(SCRATCH) : { ok: true, output: '' };
  const passed = removed && !control.ok && /TODO found|expected :|Error/.test(control.output);
  if (!passed) failures++;
  console.log(JSON.stringify({
    law,
    module: relative(ROOT, file),
    proof: removed ? 'removed' : 'missing',
    gate: passed ? 'refuses' : 'accepts',
    passed,
  }));
  cpSync(file, copied);
}

// A mutation is a deliberate change to an implementation, made in the scratch
// copy, that a law must refuse. The proof-removal loop above shows every law's
// proof is required; these controls show that a law's right-hand side is not
// the function under test, so that changing the function breaks the proof. A
// mutation that still compiles means the law it names does not bind the code
// it claims to bind, and it is reported as a failure.
const MUTATIONS = [
  {
    name: 'm18-push-destination-substituted',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'Con{"push", Con{remote, Con{branch, Nil{}}}}',
    replace: 'Con{"push", Con{"origin", Con{branch, Nil{}}}}',
    law: 'm18_push_destination_is_the_declared_remote',
  },
  {
    name: 'm3a-passing-candidate-contributes',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'match cv:\n    case VPass{}: acc',
    replace: 'match cv:\n    case VPass{}: Con{"uncovered", acc}',
    law: 'm3a_passing_candidate_contributes_nothing',
  },
];

for (const mutation of MUTATIONS) {
  const copied = join(SCRATCH, mutation.file);
  cpSync(join(ROOT, mutation.file), copied);
  const text = readFileSync(copied, 'utf8');
  const applied = text.includes(mutation.find);
  writeFileSync(copied, applied ? text.replace(mutation.find, mutation.replace) : text);
  const control = applied ? compile(SCRATCH) : { ok: true, output: '' };
  const passed = applied && !control.ok && control.output.includes(mutation.law);
  if (!passed) failures++;
  console.log(JSON.stringify({
    mutation: mutation.name,
    law: mutation.law,
    applied,
    gate: passed ? 'refuses' : 'accepts',
    passed,
  }));
  if (applied && !control.ok && !control.output.includes(mutation.law)) {
    console.log(control.output.trimEnd());
  }
  cpSync(join(ROOT, mutation.file), copied);
}

console.log(`laws-check: ${failures === 0 ? 'green' : 'red'} - ${rows.length} laws, ${MUTATIONS.length} mutations, ${rows.length + MUTATIONS.length + 1} compiles, ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
