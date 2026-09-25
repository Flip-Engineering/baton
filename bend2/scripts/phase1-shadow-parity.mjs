#!/usr/bin/env node
// bend2/scripts/phase1-shadow-parity.mjs — the Phase 1 shadow-core harness.
//
// It builds the native Bend2 module from bend2/src/replay/projection.bend with the pinned bend
// 2.0.25, runs the JS arm (resident-fold-baseline.mjs) and the Bend2 binary as child processes on
// the same Contract A stream, times each spawn to its child's exit with a wall clock, digests each
// child's stdout with sha256, compares the two byte for byte, and prints one JSON report line:
//
//   {streamPath, streamRows, jsMs, bendMs, jsDigest, bendDigest, equal, firstDifference}
//
//   streamRows      the rows the stream file holds
//   jsMs, bendMs    wall milliseconds of each spawn, or null for an arm that did not run
//   jsDigest        sha256 of the arm's stdout, hex; null for an arm that did not run
//   equal           true only when both arms ran and their stdout is identical
//   firstDifference the 1-based line number of the first difference, or null
//
// Every other line the harness prints goes to stderr and is named: the bend module's absence, the
// build time, the decoder's time when it had to make the stream, each arm's own stderr, and the
// reference measurement. stdout stays exactly one JSON line.
//
// When bend2/src/replay/projection.bend is absent the harness prints a named line saying so and
// still reports the JS arm's numbers, with bendMs, bendDigest, equal and firstDifference null.
//
// The reference measurement is the resident's own store opened on a copy of the real state
// directory, taken into .scratch/ because opening the live directory lets that open rewrite the
// live projection checkpoint, which is outside this seat's write authority. The harness copies
// events.jsonl and projection.checkpoint, opens the copy in its own child process with a bounded
// heap, times the open, times the roster read (store.swarms()), and reports the cost or the reason
// it could not run.
//
// Usage:
//   node bend2/scripts/phase1-shadow-parity.mjs [--stream <file>] [--ledger <events.jsonl>]
//        [--bend-src <file>] [--binary <file>] [--skip-build] [--no-reference]

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { DEFAULT_LEDGER } from './ledger-stream.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SCRATCH = join(ROOT, '.scratch', 'phase1-shadow');
const DEFAULT_STREAM = join(SCRATCH, 'stream.tsv');
const DECODER = join(ROOT, 'bend2', 'scripts', 'ledger-stream.mjs');
const JS_ARM = join(ROOT, 'bend2', 'scripts', 'resident-fold-baseline.mjs');
const BEND_SRC = join(ROOT, 'bend2', 'src', 'replay', 'projection.bend');
const BEND_BIN = join(ROOT, '.scratch', 'bend2', 'phase1-shadow-projection');
const PINNED_VERSION = 'bend 2.0.25';

class HarnessRefusal extends Error {
  constructor(message, code, detail = null) {
    super(message);
    this.name = 'HarnessRefusal';
    this.code = code;
    this.detail = detail;
  }
}

function named(line) {
  process.stderr.write(`phase1-shadow-parity: ${line}\n`);
}

function digestOf(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function countLines(buffer) {
  let rows = 0;
  for (const byte of buffer) if (byte === 0x0a) rows += 1;
  return rows;
}

function resolveBend() {
  const installed = join(ROOT, 'node_modules', '.bend', 'bin', 'bend');
  const fallback = join(ROOT, '.bend', 'bin', 'bend');
  if (existsSync(installed)) return installed;
  if (existsSync(fallback)) return fallback;
  throw new HarnessRefusal(
    'no bend binary under node_modules/.bend/bin or .bend/bin', 'bend_missing',
    { looked: [installed, fallback] },
  );
}

/** Runs one child to its exit, returning its stdout, stderr, exit code and wall milliseconds. */
function runTimed(command, args, { timeoutMs = 900_000, cwd = ROOT } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const started = process.hrtime.bigint();
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.once('error', (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      resolvePromise({
        code, ms, timedOut, stdout: Buffer.concat(out), stderr: Buffer.concat(err),
      });
    });
  });
}

function firstDifferingLine(left, right) {
  const a = left.toString('utf8').split('\n');
  const b = right.toString('utf8').split('\n');
  const limit = Math.max(a.length, b.length);
  for (let i = 0; i < limit; i += 1) {
    if (a[i] !== b[i]) return { line: i + 1, js: a[i] ?? null, bend: b[i] ?? null };
  }
  return null;
}

/** The package's own projection families, counted for the report. */
function rosterTotals(swarms) {
  let participants = 0;
  for (const swarm of swarms) participants += Object.keys(swarm.participants ?? {}).length;
  return { swarms: swarms.length, participants };
}

/**
 * The deployment repository id the store's run lineage authority is scoped to. It rides the
 * ledger's own profile registration row, so the reference reads it from the state it opens
 * instead of repeating a literal.
 */
function deploymentRepoId(root) {
  const fd = openSync(join(root, 'events.jsonl'), 'r');
  try {
    const head = Buffer.allocUnsafe(65_536);
    const read = readSync(fd, head, 0, head.length, 0);
    const found = head.subarray(0, read).toString('utf8').match(/"repoId":"(repo-[a-f0-9]{32})"/u);
    if (found === null) {
      throw new HarnessRefusal('the ledger head carries no repository id', 'reference_repo_id_missing', { root });
    }
    return found[1];
  } finally {
    closeSync(fd);
  }
}

async function referenceOpen(root) {
  // The resident opens through the deployment's async path with the policy set the deployment
  // passes (application-deployment.mjs); a bare open reads a different run-stop admission and
  // refuses rows the resident itself recorded.
  const { openCoordinationStoreAsync } = await import('../../impl/src/coordination-store.mjs');
  const { DEFAULT_RUN_LINEAGE_POLICY } = await import('../../impl/src/run-lineage.mjs');
  const report = { ok: false, root };
  try {
    const repoId = deploymentRepoId(root);
    const started = process.hrtime.bigint();
    const store = await openCoordinationStoreAsync(root, {
      repoId, runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY,
    });
    report.openMs = Number(process.hrtime.bigint() - started) / 1e6;
    const readStarted = process.hrtime.bigint();
    const swarms = store.swarms();
    report.rosterMs = Number(process.hrtime.bigint() - readStarted) / 1e6;
    report.roster = rosterTotals(swarms);
    const startup = store.startupStatus?.() ?? null;
    if (startup !== null) {
      report.startup = {
        checkpoint: startup.checkpoint, source: startup.source,
        totalEvents: startup.totalEvents, checkpointEvents: startup.checkpointEvents,
        replayedEvents: startup.replayedEvents,
        rewrite: startup.checkpointRewrite ?? null, reason: startup.checkpointReason ?? null,
      };
    }
    report.ok = true;
  } catch (error) {
    report.error = {
      code: error?.code ?? error?.name ?? 'reference_failed',
      message: String(error?.message ?? error),
      at: String(error?.stack ?? '').split('\n').slice(0, 3).join(' | ').slice(0, 400),
    };
  }
  process.stdout.write(JSON.stringify(report) + '\n');
  return 0;
}

/** The state files the store opens on, copied out of the live directory. */
function stageReferenceState({ timeoutMs }) {
  const source = dirname(DEFAULT_LEDGER);
  const target = join(SCRATCH, 'reference', 'coordination');
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const copied = [];
  for (const name of ['events.jsonl', 'projection.checkpoint']) {
    const from = join(source, name);
    if (!existsSync(from)) continue;
    copyFileSync(from, join(target, name));
    copied.push({ name, bytes: statSync(join(target, name)).size });
  }
  return { target, copied };
}

export async function main(argv) {
  if (argv[0] === '--reference-open') return referenceOpen(argv[1]);

  let streamPath = DEFAULT_STREAM;
  let ledgerPath = DEFAULT_LEDGER;
  let bendSrc = BEND_SRC;
  let binary = BEND_BIN;
  let skipBuild = false;
  let withReference = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new HarnessRefusal(`${arg} needs a value`, 'parity_usage');
      i += 1;
      return argv[i];
    };
    if (arg === '--stream') streamPath = resolve(next());
    else if (arg === '--ledger') ledgerPath = resolve(next());
    else if (arg === '--bend-src') bendSrc = resolve(next());
    else if (arg === '--binary') binary = resolve(next());
    else if (arg === '--skip-build') skipBuild = true;
    else if (arg === '--no-reference') withReference = false;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('usage: node bend2/scripts/phase1-shadow-parity.mjs'
        + ' [--stream <file>] [--ledger <events.jsonl>] [--bend-src <file>] [--binary <file>]'
        + ' [--skip-build] [--no-reference]\n');
      return 0;
    } else {
      throw new HarnessRefusal(`unknown option ${arg}`, 'parity_usage', { option: arg });
    }
  }

  mkdirSync(SCRATCH, { recursive: true });

  if (!existsSync(streamPath)) {
    named(`stream ${streamPath} is absent; decoding the ledger with ${DECODER}`);
    const decoded = await runTimed(process.execPath, [DECODER, ledgerPath, '--out', streamPath]);
    if (decoded.code !== 0) {
      throw new HarnessRefusal(
        `the decoder exited ${decoded.code}`, 'decoder_failed',
        { stderr: decoded.stderr.toString('utf8').trim().slice(0, 500) },
      );
    }
    named(`decoder_ms=${decoded.ms.toFixed(1)} ${decoded.stderr.toString('utf8').trim()}`);
  }

  const streamBytes = readFileSync(streamPath);
  const streamRows = countLines(streamBytes);

  // Arm 1 — the JS resident.
  const js = await runTimed(process.execPath, [JS_ARM, streamPath, '--ledger', ledgerPath]);
  for (const line of js.stderr.toString('utf8').trim().split('\n')) {
    if (line.length !== 0) named(`js-arm: ${line}`);
  }
  if (js.code !== 0) {
    throw new HarnessRefusal(
      `the JS arm exited ${js.code}`, 'js_arm_failed',
      { stderr: js.stderr.toString('utf8').trim().slice(0, 500) },
    );
  }

  // Arm 2 — the Bend2 module, when it exists.
  let bend = null;
  if (!existsSync(bendSrc)) {
    named(`bend arm not run: ${bendSrc} is absent`);
  } else {
    const bendExe = resolveBend();
    const version = (await runTimed(bendExe, ['version'])).stdout.toString('utf8').trim();
    if (version !== PINNED_VERSION) {
      throw new HarnessRefusal(
        `bend reports ${version} where ${PINNED_VERSION} is pinned`, 'bend_version_mismatch', { version },
      );
    }
    if (skipBuild && existsSync(binary)) {
      named(`bend build skipped; using ${binary}`);
    } else {
      mkdirSync(dirname(binary), { recursive: true });
      const built = await runTimed(bendExe, [bendSrc, '-o', binary]);
      if (built.code !== 0) {
        throw new HarnessRefusal(
          `the bend build exited ${built.code}`, 'bend_build_failed',
          { stderr: built.stderr.toString('utf8').trim().slice(0, 500) },
        );
      }
      named(`bend_build_ms=${built.ms.toFixed(1)} source=${bendSrc}`);
    }
    bend = await runTimed(binary, [streamPath]);
    for (const line of bend.stderr.toString('utf8').trim().split('\n')) {
      if (line.length !== 0) named(`bend-arm: ${line}`);
    }
    if (bend.code !== 0) {
      named(`bend arm exited ${bend.code}`);
    }
  }

  const jsDigest = digestOf(js.stdout);
  const bendDigest = bend === null ? null : digestOf(bend.stdout);
  const equal = bend !== null && bendDigest === jsDigest;
  const difference = bend !== null && !equal ? firstDifferingLine(js.stdout, bend.stdout) : null;
  if (difference !== null) {
    named(`first difference at line ${difference.line}`);
    named(`  js   : ${difference.js}`);
    named(`  bend : ${difference.bend}`);
  }

  process.stdout.write(JSON.stringify({
    streamPath,
    streamRows,
    jsMs: Number(js.ms.toFixed(1)),
    bendMs: bend === null ? null : Number(bend.ms.toFixed(1)),
    jsDigest,
    bendDigest,
    equal,
    firstDifference: difference === null ? null : difference.line,
  }) + '\n');

  if (withReference) {
    named('reference: copying the live state files into .scratch and opening the copy');
    try {
      const staged = stageReferenceState({ timeoutMs: 300_000 });
      named(`reference: copied ${staged.copied.map((row) => `${row.name}=${row.bytes}B`).join(' ')}`);
      const measured = await runTimed(
        process.execPath, ['--max-old-space-size=2048', import.meta.filename,
          '--reference-open', staged.target],
        { timeoutMs: 600_000 },
      );
      const text = measured.stdout.toString('utf8').trim();
      named(`reference: exit=${measured.code}${measured.timedOut ? ' timed_out' : ''} ${text || '(no output)'}`);
      const referenceError = measured.stderr.toString('utf8').trim();
      if (referenceError.length !== 0) named(`reference: stderr ${referenceError.slice(0, 400)}`);
    } catch (error) {
      named(`reference: could not run: ${error?.message ?? error}`);
    }
  } else {
    named('reference: skipped by --no-reference');
  }
  return 0;
}

/** True when this module is the process entry, given either a path or a file URL in argv[1]. */
function invokedDirectly() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === (entry.startsWith('file:') ? entry : pathToFileURL(entry).href);
}

if (invokedDirectly()) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => {
      if (error instanceof HarnessRefusal) {
        named(`refused ${error.code}: ${error.message}`);
      } else {
        named(`failed: ${error?.stack ?? error}`);
      }
      process.exitCode = 1;
    },
  );
}
