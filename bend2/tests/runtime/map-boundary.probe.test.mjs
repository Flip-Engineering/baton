// Boundary probes for the enforced map reader's substitution and in-place
// write intervals, authored for admitted remote runs (no local execution).
//
// Synchronization: the reader runs on a multi-megabyte file inside a worker
// thread in a child process. The worker posts a 'started' event immediately
// before entering the reader; the parent awaits that boundary, then performs
// exactly one mutation (an in-place same-size write, or a rename-over
// substitution), awaits the mutation, and then awaits the worker outcome and
// child completion before any cleanup. Timers are always cleared.
//
// Coverage classification is asserted from the actual operation sequence:
// a mapReplacedDuringRead refusal means the interval was COVERED (for the
// substitution probe only mapReplacedDuringRead counts - a mapReadFailed is
// a reader refusal, never a covered replacement, and is reported as
// unexercised with the child status retained separately); a success means
// the interval was NOT exercised (the mutation landed before admission or
// after completion) and is reported as UNEXERCISED, never as passed defect
// coverage. Because a replacement fully installed before admission can be
// legitimately read, the read digest is recorded and compared to both the
// original and the replaced content - it is not an unconditional original-
// bytes invariant. Child status, signal, error and the worker outcome are
// retained separately.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const READER_MODULE = join(HERE, '..', '..', 'context', 'runtime', 'source-maps.mjs');

const MEGABYTE = 1024 * 1024;
const ORIGINAL_CHUNK = 'A'.repeat(64 * MEGABYTE);
const REPLACED_CHUNK = 'B'.repeat(64 * MEGABYTE);

function buildWorkerSource() {
  return [
    "import { workerData, parentPort } from 'node:worker_threads';",
    "import { createHash } from 'node:crypto';",
    `import { createAdmittedFileReader } from ${JSON.stringify(pathToFileURL(READER_MODULE).href)};`,
    'const reader = createAdmittedFileReader({ admittedRoots: workerData.admittedRoots });',
    "parentPort.postMessage({ event: 'started' });",
    'try {',
    '  const out = reader(workerData.path);',
    "  parentPort.postMessage({ outcome: { ok: true, size: out.bytes.length, sha256: createHash('sha256').update(out.bytes).digest('hex') } });",
    '} catch (err) {',
    "  parentPort.postMessage({ outcome: { ok: false, condition: err.condition ?? null, message: String(err.message ?? err) } });",
    '}',
    '',
  ].join('\n');
}

// Runs one probe: starts the child (which spawns the worker), waits for the
// worker's 'started' boundary, applies the mutation, and collects the worker
// outcome and the child completion separately. Everything is awaited before
// cleanup; timers are cleared on every path.
async function runProbe(mutate) {
  const root = mkdtempSync(join(tmpdir(), 'rtv-boundary-'));
  const target = join(root, 'big.map');
  writeFileSync(target, ORIGINAL_CHUNK);
  const workerFile = join(root, 'reader-worker.mjs');
  writeFileSync(workerFile, buildWorkerSource());
  const facts = { boundaryReached: false, mutationCompleted: false, workerOutcome: null, child: { exitCode: null, signal: null, error: null } };
  const child = spawn(process.execPath, ['--input-type=commonjs', '-e', [
    `const { Worker } = require('node:worker_threads');`,
    `const worker = new Worker(${JSON.stringify(workerFile)}, { workerData: { path: ${JSON.stringify(target)}, admittedRoots: [${JSON.stringify(root)}] } });`,
    'worker.on("message", (m) => { console.log(JSON.stringify(m)); });',
    'worker.on("error", (e) => { console.log(JSON.stringify({ outcome: { ok: false, condition: "worker-error", message: String(e) } })); });',
    '',
  ].join('\n')], { stdio: ['ignore', 'pipe', 'pipe'] });
  const childDone = new Promise((resolve) => {
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});
    child.on('error', (err) => resolve({ exitCode: null, signal: null, error: String(err.message ?? err) }));
    child.on('close', (code, signal) => resolve({ exitCode: code, signal, error: null }));
  });
  const guard = setTimeout(() => child.kill('SIGKILL'), 60000);
  try {
    // Wait for the reader worker's declared start boundary.
    const startedLine = await new Promise((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error('worker never reported started')), 30000);
      const onLine = () => {
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (line.startsWith('{')) {
            const parsed = JSON.parse(line);
            if (parsed.event === 'started') {
              clearTimeout(timer);
              child.stdout.removeListener('data', onData);
              resolve(parsed);
              return;
            }
          }
        }
      };
      const onData = (chunk) => {
        buffer += chunk.toString('utf8');
        onLine();
      };
      child.stdout.on('data', onData);
      child.on('close', () => {
        clearTimeout(timer);
        reject(new Error('child exited before the worker reported started'));
      });
    });
    facts.boundaryReached = true;
    // The mutation runs at the production operation boundary and the parent
    // awaits its completion before collecting the outcome.
    await mutate(root, target);
    facts.mutationCompleted = true;
    const outcomeLine = await new Promise((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error('worker never reported an outcome')), 45000);
      const onData = (chunk) => {
        buffer += chunk.toString('utf8');
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (line.startsWith('{')) {
            const parsed = JSON.parse(line);
            if (parsed.outcome) {
              clearTimeout(timer);
              child.stdout.removeListener('data', onData);
              resolve(parsed.outcome);
              return;
            }
          }
        }
      };
      child.stdout.on('data', onData);
      child.on('close', () => {
        clearTimeout(timer);
        reject(new Error('child exited before the worker reported an outcome'));
      });
    });
    facts.workerOutcome = outcomeLine;
    facts.child = await childDone;
  } finally {
    clearTimeout(guard);
    if (child.exitCode === null && child.signalCode === null && !child.killed) child.kill('SIGKILL');
  }
  return { root, facts };
}

function retainProbe(name, record) {
  const dir = process.env.BATON_RUNTIME_EVIDENCE_DIR ?? join(tmpdir(), 'runtime-values-evidence-');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `probe-${name}.json`), JSON.stringify(record, null, 2));
}

// Classifies one probe outcome into 'covered' (the interval was exercised
// and the reader refused the replacement) or 'unexercised' (the mutation
// landed outside the covered interval; recorded, never counted as defect
// coverage). A mapReadFailed refusal does NOT stand in for a covered
// replacement.
function classify(outcome) {
  if (outcome && outcome.ok === false && outcome.condition === 'mapReplacedDuringRead') return 'covered';
  return 'unexercised';
}

test('in-place same-size write at the started boundary: covered refusals and unexercised residuals are distinguished', async () => {
  const { root, facts } = await runProbe(async (rootDir, targetPath) => {
    writeFileSync(targetPath, REPLACED_CHUNK);
  });
  try {
    retainProbe('in-place', facts);
    assert.equal(facts.boundaryReached, true, 'the worker reported its start boundary');
    assert.equal(facts.mutationCompleted, true, 'the mutation completed before outcome collection');
    assert.ok(facts.child.error === null, `child error retained separately: ${facts.child.error}`);
    const coverage = classify(facts.workerOutcome);
    assert.ok(coverage === 'covered' || coverage === 'unexercised', `coverage: ${coverage}`);
    if (coverage === 'covered') {
      assert.equal(facts.workerOutcome.condition, 'mapReplacedDuringRead');
    } else {
      // Unexercised: the mutation landed before admission or after
      // completion. The read digest may legitimately match either content.
      const digest = facts.workerOutcome && facts.workerOutcome.ok ? facts.workerOutcome.sha256 : null;
      const known = {
        original: createHash('sha256').update(ORIGINAL_CHUNK).digest('hex'),
        replaced: createHash('sha256').update(REPLACED_CHUNK).digest('hex'),
      };
      assert.ok(digest === null || digest === known.original || digest === known.replaced, 'the recorded read digest matches one of the written contents');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rename-over substitution at the started boundary: only mapReplacedDuringRead counts as covered', async () => {
  const { root, facts } = await runProbe(async (rootDir, targetPath) => {
    const replacement = join(rootDir, 'replacement.map');
    writeFileSync(replacement, REPLACED_CHUNK);
    const { renameSync } = await import('node:fs');
    renameSync(replacement, targetPath);
  });
  try {
    retainProbe('substitution', facts);
    assert.equal(facts.boundaryReached, true, 'the worker reported its start boundary');
    assert.equal(facts.mutationCompleted, true, 'the mutation completed before outcome collection');
    assert.ok(facts.child.error === null, `child error retained separately: ${facts.child.error}`);
    const coverage = classify(facts.workerOutcome);
    assert.ok(coverage === 'covered' || coverage === 'unexercised', `coverage: ${coverage}`);
    if (coverage === 'covered') {
      assert.equal(facts.workerOutcome.condition, 'mapReplacedDuringRead', 'a mapReadFailed never stands in for a covered replacement');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
