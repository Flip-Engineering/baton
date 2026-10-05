// Concurrent stress acquisition probes for the enforced map reader,
// authored for admitted remote runs (no local execution).
//
// These probes are CONCURRENT STRESS ACQUISITION, not interval-coverage
// proofs: the worker declares a start boundary before entering the reader,
// but no internal admission/open/read sequence is observed, so interval
// coverage stays UNKNOWN. A mapReplacedDuringRead refusal is recorded as
// the reader's verdict; it does not by itself prove the tested predicate
// (a defective reader could refuse unconditionally). A success does not
// prove the mutation landed outside the read - it may be missed detection.
// Noncoverage and reader errors are reported as UNEXERCISED or FAILED
// acquisition outcomes, never as passed defect coverage. Every run retains
// the boundary, mutation-completion, worker outcome and child completion
// facts separately, with complete raw child streams.
//
// Synchronization and ownership: the child (which spawns the worker) is
// spawned asynchronously; the parent waits for the worker's 'started'
// message through one continuously installed line queue, applies the
// mutation, awaits its completion, then collects the outcome and the child
// close through the same queue and a separate close promise. runProbe owns
// all cleanup in its own finally: the child is killed if still alive, its
// close is awaited even on failures, and every failure field is retained.
// No artificial child outcome is ever produced.

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

// One continuously installed byte-retaining parser: every chunk is kept in
// the raw log and complete lines are queued from spawn onward, so messages
// that arrive before a wait - or several in one chunk - are never
// discarded. waitFor scans the queue first, then waits for new lines.
class LineQueue {
  constructor(stream) {
    this.lines = [];
    this.rawChunks = [];
    this.waiters = [];
    let buffer = '';
    stream.on('data', (chunk) => {
      this.rawChunks.push(Buffer.from(chunk));
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.startsWith('{')) {
          const parsed = JSON.parse(line);
          this.lines.push(parsed);
          const stillWaiting = this.waiters.filter((waiter) => !waiter.settled);
          for (const waiter of stillWaiting) {
            const hit = this.lines.find(waiter.predicate);
            if (hit) {
              waiter.settled = true;
              clearTimeout(waiter.timer);
              waiter.resolve(hit);
            }
          }
        }
      }
    });
  }

  waitFor(predicate, timeoutMs, onTimeout) {
    const existing = this.lines.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const waiter = { predicate, settled: false, resolve, timer: null };
      waiter.timer = setTimeout(() => {
        if (!waiter.settled) {
          waiter.settled = true;
          resolve(onTimeout());
        }
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }
}

// Runs one stress probe. Owns all cleanup: on any failure the child is
// killed and its close awaited inside this function, the facts retain the
// actual failure fields, and no exception escapes before the caller has the
// root and facts.
async function runProbe(mutate, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rtv-boundary-'));
  const target = join(root, 'big.map');
  writeFileSync(target, ORIGINAL_CHUNK);
  const workerFile = join(root, 'reader-worker.mjs');
  writeFileSync(workerFile, buildWorkerSource());
  const facts = {
    boundaryReached: false,
    mutationCompleted: false,
    mutationError: null,
    workerOutcome: null,
    child: { exitCode: null, signal: null, error: null, closeTimedOut: false },
    rawStdout: [],
    coverage: 'unknown',
  };
  let child = null;
  let childClosed = null;
  const guard = setTimeout(() => {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, 90000);
  try {
    child = spawn(process.execPath, ['--input-type=commonjs', '-e', [
      `const { Worker } = require('node:worker_threads');`,
      `const worker = new Worker(${JSON.stringify(workerFile)}, { workerData: { path: ${JSON.stringify(target)}, admittedRoots: [${JSON.stringify(root)}] } });`,
      'worker.on("message", (m) => { console.log(JSON.stringify(m)); });',
      'worker.on("error", (e) => { console.log(JSON.stringify({ outcome: { ok: false, condition: "worker-error", message: String(e) } })); });',
      'worker.on("exit", (code, signal) => { console.log(JSON.stringify({ workerExit: { code, signal } })); });',
      '',
    ].join('\n')], { stdio: ['ignore', 'pipe', 'pipe'] });
    const queue = new LineQueue(child.stdout);
    child.stderr.on('data', (chunk) => facts.rawStdout.push(Buffer.from(`[stderr] ${chunk}`)));
    childClosed = new Promise((resolve) => {
      child.on('error', (err) => {
        facts.child.error = String(err.message ?? err);
        resolve({ exitCode: null, signal: null, error: facts.child.error });
      });
      child.on('close', (code, signal) => resolve({ exitCode: code, signal, error: null }));
    });

    const started = await queue.waitFor((message) => message.event === 'started', options.startTimeoutMs ?? 30000, () => null);
    facts.boundaryReached = started !== null;
    if (started) {
      try {
        await mutate(root, target);
        facts.mutationCompleted = true;
      } catch (err) {
        facts.mutationError = String(err.message ?? err);
      }
    }
    const outcome = await queue.waitFor((message) => message.outcome !== undefined, options.outcomeTimeoutMs ?? 45000, () => null);
    facts.workerOutcome = outcome ? outcome.outcome : null;
    const workerExitLine = await queue.waitFor((message) => message.workerExit !== undefined, options.exitTimeoutMs ?? 10000, () => null);
    facts.workerExit = workerExitLine ? workerExitLine.workerExit : null;
  } catch (err) {
    facts.probeError = String(err.message ?? err);
  } finally {
    clearTimeout(guard);
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (childClosed) {
      const close = await Promise.race([childClosed, new Promise((resolve) => setTimeout(() => resolve({ closeTimedOut: true }), 8000))]);
      if (close && close.closeTimedOut) facts.child.closeTimedOut = true;
      else if (close) {
        facts.child.exitCode = close.exitCode;
        facts.child.signal = close.signal;
        facts.child.error = close.error;
      }
    }
    facts.rawStdoutBytes = Buffer.concat(facts.rawStdout);
    facts.rawStdoutText = facts.rawStdoutBytes.toString('utf8');
  }
  // Coverage stays UNKNOWN by design: no internal admission/open/read
  // sequence is observed, so neither the refusal nor the success identifies
  // the tested interval.
  if (facts.workerOutcome && facts.workerOutcome.ok === false && facts.workerOutcome.condition === 'mapReplacedDuringRead') {
    facts.readerVerdict = 'mapReplacedDuringRead';
  } else if (facts.workerOutcome && facts.workerOutcome.ok === true) {
    facts.readerVerdict = 'accepted';
    facts.readDigest = facts.workerOutcome.sha256;
    facts.readDigestMatchesOriginal = facts.readDigest === createHash('sha256').update(ORIGINAL_CHUNK).digest('hex');
    facts.readDigestMatchesReplaced = facts.readDigest === createHash('sha256').update(REPLACED_CHUNK).digest('hex');
  } else {
    facts.readerVerdict = facts.workerOutcome ? `condition:${facts.workerOutcome.condition ?? 'unknown'}` : 'no-outcome';
  }
  return { root, facts };
}

function retainProbe(name, record) {
  const dir = process.env.BATON_RUNTIME_EVIDENCE_DIR ?? join(tmpdir(), 'runtime-values-evidence-');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `probe-${name}.json`), JSON.stringify(record, null, 2));
}

test('in-place same-size concurrent stress: acquired facts retained, coverage unknown by design', async () => {
  const { root, facts } = await runProbe(async (rootDir, targetPath) => {
    writeFileSync(targetPath, REPLACED_CHUNK);
  });
  try {
    retainProbe('in-place', facts);
    // Acquisition health is the failure surface: a missing boundary, an
    // incomplete mutation, a child error, a close timeout, or a missing
    // outcome is a FAILED acquisition, never successful coverage.
    assert.equal(facts.boundaryReached, true, 'the worker reported its start boundary');
    assert.equal(facts.mutationError, null, `mutation completed: ${facts.mutationError ?? ''}`);
    assert.equal(facts.child.error, null, `no child error: ${facts.child.error}`);
    assert.equal(facts.child.closeTimedOut, false, 'the child close was observed');
    assert.ok(facts.child.exitCode !== null || facts.child.signal !== null, 'the child close was observed with status or signal');
    assert.ok(facts.workerOutcome, 'the reader outcome was observed');
    // Interval coverage is reported unknown; only the recorded verdict and
    // read digest facts stand.
    assert.equal(facts.coverage, 'unknown');
    if (facts.readerVerdict === 'accepted') {
      assert.ok(
        facts.readDigestMatchesOriginal || facts.readDigestMatchesReplaced,
        'the accepted read digest matches one of the written contents',
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rename-over substitution concurrent stress: verdicts are recorded, coverage stays unknown', async () => {
  const { root, facts } = await runProbe(async (rootDir, targetPath) => {
    const replacement = join(rootDir, 'replacement.map');
    writeFileSync(replacement, REPLACED_CHUNK);
    const { renameSync } = await import('node:fs');
    renameSync(replacement, targetPath);
  });
  try {
    retainProbe('substitution', facts);
    assert.equal(facts.boundaryReached, true, 'the worker reported its start boundary');
    assert.equal(facts.mutationError, null, `mutation completed: ${facts.mutationError ?? ''}`);
    assert.equal(facts.child.error, null, `no child error: ${facts.child.error}`);
    assert.equal(facts.child.closeTimedOut, false, 'the child close was observed');
    assert.ok(facts.child.exitCode !== null || facts.child.signal !== null, 'the child close was observed with status or signal');
    assert.ok(facts.workerOutcome, 'the reader outcome was observed');
    assert.equal(facts.coverage, 'unknown');
    // A mapReadFailed refusal is recorded as a reader condition, never as
    // covered replacement coverage.
    if (facts.readerVerdict === 'condition:mapReadFailed') {
      assert.ok(true, 'reader refusal recorded; interval coverage remains unknown');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
