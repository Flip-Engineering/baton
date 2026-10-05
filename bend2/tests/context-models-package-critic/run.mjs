// Orchestrator for the context-models package critic checks.
//
// Usage:
//   node run.mjs --node22 <path> [--node22-sha256 <hex>]
//               [--context-dir <bend2/context>] [--staged-dir <payload root>]
//               [--real-zod <dir>] [--psql <path>] [--work <dir>] [--out <file>]
//
// Every check is a separate child process so a crash cannot mask a gate.
// Each check prints one JSON line; this runner aggregates them, writes the
// report, and exits:
//   0  every executed check passed and no gate is open
//   1  at least one check failed
//   3  at least one gate is open (an owned artifact is unavailable; missing
//      artifacts remain a gate, never a successful acceptance)
//
// Invocation roles (all execution happens on admitted remote runners):
//   node22 run.mjs ...  executes the Node22.15.0 floor gate plus every
//                       artifact-dependent discriminator
//   host run.mjs --floor-host-only
//                       executes the host-Node differential probe only

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--floor-host-only') { args.floorHostOnly = true; continue; }
    if (token.startsWith('--')) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) { args[token] = true; continue; }
      args[token] = next;
      index += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv);

const repoRoot = resolve(new URL('../..', new URL(`file://${process.argv[1]}`).pathname).pathname);
const node22 = args['--node22'] ?? null;
const contextDir = args['--context-dir'] ?? join(repoRoot, 'bend2/context');
const stagedDir = args['--staged-dir'] ?? null;
const realZod = args['--real-zod'] ?? '/Users/wahargis/node_modules/zod';
const workParent = args['--work'] ?? join(repoRoot, '.scratch/context-models-package-critic');
const outPath = args['--out'] ?? join(workParent, 'last-report.json');

mkdirSync(workParent, { recursive: true, mode: 0o700 });

function runCheck(name, argv, env) {
  const result = spawnSync(argv[0], argv.slice(1), { env, encoding: 'buffer', maxBuffer: Infinity });
  const stdoutText = result.stdout?.toString('utf8') ?? '';
  let line = null;
  for (const candidate of stdoutText.trim().split('\n').reverse()) {
    if (candidate.startsWith('{')) { try { line = JSON.parse(candidate); break; } catch { /* keep scanning */ } }
  }
  return {
    check: name,
    argv,
    status: result.status,
    signal: result.signal,
    spawnError: result.error ? String(result.error) : null,
    stderrBytes: result.stderr?.length ?? 0,
    stderrUtf8: result.stderr?.toString('utf8') ?? '',
    report: line,
  };
}

const baseEnv = { ...process.env, PCM_WORK: workParent };
const rows = [];

if (args.floorHostOnly) {
  baseEnv.PCM_NODE_MODE = 'host';
  rows.push(runCheck('node-floor-host-differential', [process.execPath, join(repoRoot, 'bend2/tests/context-models-package-critic/checks/node-floor.mjs')], baseEnv));
} else {
  if (!node22 || !existsSync(node22)) {
    process.stdout.write(JSON.stringify({ runner: 'context-models-package-critic', status: 'gate-open', reason: 'the exact Node 22.15.0 toolchain is required: pass --node22 <path>', contextDir, stagedDir }) + '\n');
    process.exit(3);
  }
  if (args['--node22-sha256']) {
    const digest = createHash('sha256').update(readFileSync(node22)).digest('hex');
    if (digest !== args['--node22-sha256']) {
      process.stdout.write(JSON.stringify({ runner: 'context-models-package-critic', status: 'fail', reason: `node22 digest ${digest} does not match the pinned ${args['--node22-sha256']}` }) + '\n');
      process.exit(1);
    }
  }
  const nodeEnv = { ...baseEnv, PCM_NODE22: node22, PCM_NODE_MODE: 'floor' };
  const sourceEnv = { ...nodeEnv, PCM_CONTEXT_DIR: contextDir };
  const stagedEnv = { ...nodeEnv, PCM_STAGED_DIR: stagedDir };
  const checksDir = join(repoRoot, 'bend2/tests/context-models-package-critic/checks');

  rows.push(runCheck('node-floor', [node22, join(checksDir, 'node-floor.mjs')], nodeEnv));
  rows.push(runCheck('dependency-pins', [node22, join(checksDir, 'dependency-pins.mjs')], sourceEnv));
  rows.push(runCheck('psql-prereq', [node22, join(checksDir, 'psql-prereq.mjs')], { ...nodeEnv, PCM_PSQL: args['--psql'] ?? process.env.PCM_PSQL ?? '' }));
  if (stagedDir) {
    rows.push(runCheck('ancestor-isolation', [node22, join(checksDir, 'ancestor-isolation.mjs')], stagedEnv));
    rows.push(runCheck('useful-results', [node22, join(checksDir, 'useful-results.mjs')], stagedEnv));
    rows.push(runCheck('target-zod', [node22, join(checksDir, 'target-zod.mjs')], { ...stagedEnv, PCM_CONTEXT_DIR: contextDir, PCM_REAL_ZOD_436: realZod }));
  } else {
    rows.push({ check: 'ancestor-isolation', gate: 'staged payload not supplied (--staged-dir)' });
    rows.push({ check: 'useful-results', gate: 'staged payload not supplied (--staged-dir)' });
    rows.push({ check: 'target-zod', gate: 'staged payload not supplied (--staged-dir)' });
  }
}

const summary = { pass: 0, fail: 0, gateOpen: 0 };
const lines = [];
for (const row of rows) {
  const status = row.report?.status ?? (row.gate ? 'gate-open' : 'no-report');
  if (status === 'pass') summary.pass += 1;
  else if (status === 'fail') summary.fail += 1;
  else summary.gateOpen += 1;
  lines.push({ check: row.check, status, report: row.report ?? null, argv: row.argv ?? null, childStatus: row.status ?? null, stderr: row.stderrUtf8 || null, gate: row.gate ?? null });
}

const report = {
  runner: 'context-models-package-critic',
  node22: args['--node22'] ?? null,
  contextDir,
  stagedDir,
  floorHostOnly: Boolean(args.floorHostOnly),
  summary,
  checks: lines,
};
writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
process.stdout.write(JSON.stringify({ runner: report.runner, summary, report: outPath }) + '\n');
process.exit(summary.fail > 0 ? 1 : summary.gateOpen > 0 ? 3 : 0);
