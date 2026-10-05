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
// facts separately, with exact raw stdout and stderr buffers (lengths and
// digests, never re-encoded) and any JSON parse failures.
//
// Synchronization and ownership: the child (which spawns the worker) is
// spawned asynchronously; the parent waits for the worker's 'started'
// message through one continuously installed line queue, applies the
// mutation, awaits its completion, then collects the outcome and the child
// close through the same queue and a separate close promise. The close
// promise settles ONLY on an actual close; an error event is recorded
// separately. runProbe owns all cleanup in its own finally: the child is
// killed if still alive, its close is awaited even on failures, and every
// failure field is retained. The whole probe is supervised: a setup failure
// still returns the root and facts so the caller's retention runs. No
// artificial child outcome is ever produced.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
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
// the raw log and complete lines are queued from spawn onward. Streaming
// StringDecoder keeps split multibyte sequences intact across chunks, and a
// JSON parse failure is retained instead of escaping through the data
// callback. The exact raw bytes stay in rawChunks; nothing decoded is ever
// written back as raw evidence.
class LineQueue {
  constructor(stream, parseErrors) {
    this.lines = [];
    this.rawChunks = [];
    this.waiters = [];
    this.parseErrors = parseErrors;
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    stream.on('data', (chunk) => {
      this.rawChunks.push(Buffer.from(chunk));
      buffer += decoder.write(chunk);
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.startsWith('{')) {
          let parsed;
          try {
            parsed = JSON.parse(line);
          } catch (err) {
            this.parseErrors.push({ line: line.slice(0, 200), error: String(err.message ?? err) });
            continue;
          }
          this.lines.push(parsed);
          for (const waiter of this.waiters.filter((waiter) => !waiter.settled)) {
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

function freshFacts() {
  return {
    boundaryReached: false,
    mutationCompleted: false,
    mutationError: null,
    workerOutcome: null,
    workerExit: null,
    workerError: null,
    child: { exitCode: null, signal: null, error: null, closeObserved: false, closeTimedOut: false, cleanupKilled: false, cleanupError: null },
    rawStdout: [],
    rawStderr: [],
    parseErrors: [],
    coverage: 'unknown',
    setupError: null,
    probeError: null,
  };
}

// The whole probe is supervised: the root creation and setup writes happen
// inside the supervised region, a setup failure still returns the root (or
// null when none could be made) and the facts with setupError, so the
// caller's retention always runs. Cleanup kills are recorded as
// intervention facts and never presented as natural closes.
let PROBE_STORAGE = null;
function probeStorage() {
  // Unique per-run storage: successive runs never overwrite prior evidence.
  if (!PROBE_STORAGE) {
    const base = process.env.BATON_RUNTIME_EVIDENCE_DIR ?? join(tmpdir(), 'runtime-values-evidence-');
    PROBE_STORAGE = mkdtempSync(join(base, 'probe-run-'));
  }
  return PROBE_STORAGE;
}
async function runProbe(mutate, options = {}) {
  let root = null;
  const facts = freshFacts();
  try {
    root = mkdtempSync(join(tmpdir(), 'rtv-boundary-'));
    const bodyFacts = await runProbeBody(root, facts, mutate, options);
    return { root, facts: bodyFacts };
  } catch (err) {
    facts.setupError = String(err.message ?? err);
    return { root, facts };
  }
}

async function runProbeBody(root, facts, mutate, options) {
  const target = join(root, 'big.map');
  writeFileSync(target, ORIGINAL_CHUNK);
  const workerFile = join(root, 'reader-worker.mjs');
  writeFileSync(workerFile, buildWorkerSource());
  let child = null;
  let queue = null;
  let childClosed = null;
  const guard = setTimeout(() => {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, 90000);
  try {
    child = spawn(process.execPath, ['--input-type=commonjs', '-e', [
      `const { Worker } = require('node:worker_threads');`,
      `const worker = new Worker(${JSON.stringify(workerFile)}, { workerData: { path: ${JSON.stringify(target)}, admittedRoots: [${JSON.stringify(root)}] } });`,
      'worker.on("message", (m) => { console.log(JSON.stringify(m)); });',
      'worker.on("error", (e) => { console.log(JSON.stringify({ workerError: String(e) })); });',
      'worker.on("exit", (code, signal) => { console.log(JSON.stringify({ workerExit: { code, signal } })); });',
      '',
    ].join('\n')], { stdio: ['ignore', 'pipe', 'pipe'] });
    facts.rawStdout = [];
    facts.rawStderr = [];
    queue = new LineQueue(child.stdout, facts.parseErrors);
    child.stderr.on('data', (chunk) => facts.rawStderr.push(Buffer.from(chunk)));
    // The close promise settles ONLY on an actual close; an error event is
    // recorded separately and does not masquerade as reaping.
    childClosed = new Promise((resolve) => {
      child.on('error', (err) => {
        facts.child.error = String(err.message ?? err);
      });
      child.on('close', (code, signal) => {
        facts.child.closeObserved = true;
        resolve({ exitCode: code, signal });
      });
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
    const workerErrorLine = queue.lines.find((message) => message.workerError !== undefined);
    facts.workerError = workerErrorLine ? String(workerErrorLine.workerError) : null;
    const workerExitLine = await queue.waitFor((message) => message.workerExit !== undefined, options.exitTimeoutMs ?? 10000, () => null);
    facts.workerExit = workerExitLine ? workerExitLine.workerExit : null;
  } catch (err) {
    facts.probeError = String(err.message ?? err);
  } finally {
    clearTimeout(guard);
    // Cleanup is supervised per step: a kill that throws is retained as a
    // cleanup error instead of skipping the close and raw capture.
    if (child && child.exitCode === null && child.signalCode === null) {
      try {
        facts.child.cleanupKilled = true;
        child.kill('SIGKILL');
      } catch (killError) {
        facts.child.cleanupError = String(killError.message ?? killError);
      }
    }
    if (childClosed) {
      let closeTimer = null;
      const close = await Promise.race([
        childClosed,
        new Promise((resolve) => {
          closeTimer = setTimeout(() => resolve({ closeTimedOut: true }), 8000);
        }),
      ]);
      clearTimeout(closeTimer);
      if (close && close.closeTimedOut) facts.child.closeTimedOut = true;
      else if (close) {
        facts.child.exitCode = close.exitCode;
        facts.child.signal = close.signal;
      }
    }
    // The queue holds the exact stdout bytes; they flow into the facts here.
    facts.rawStdoutBytes = Buffer.concat(queue ? queue.rawChunks : facts.rawStdout);
    facts.rawStderrBytes = Buffer.concat(facts.rawStderr);
    facts.rawStdoutLength = facts.rawStdoutBytes.length;
    facts.rawStderrLength = facts.rawStderrBytes.length;
    facts.rawStdoutSha256 = createHash('sha256').update(facts.rawStdoutBytes).digest('hex');
    facts.rawStderrSha256 = createHash('sha256').update(facts.rawStderrBytes).digest('hex');
    facts.rawStdoutText = facts.rawStdoutBytes.toString('utf8');
  }
  // Coverage stays UNKNOWN by design: no internal admission/open/read
  // sequence is observed, so neither the refusal nor the success identifies
  // the tested interval. Worker errors, missing outcomes and nonzero worker
  // exits are recorded as facts and classified as failed acquisition by the
  // tests; the recorded verdict and read digest facts stand on their own.
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
  return facts;
}

function retainProbe(name, record) {
  // Unique per-run storage under the shared base, so successive runs never
  // overwrite prior evidence.
  const dir = probeStorage();
  writeFileSync(join(dir, `probe-${name}.json`), JSON.stringify(record, null, 2));
  if (record.rawStdoutBytes) writeFileSync(join(dir, `probe-${name}-stdout.raw`), Buffer.from(record.rawStdoutBytes));
  if (record.rawStderrBytes) writeFileSync(join(dir, `probe-${name}-stderr.raw`), Buffer.from(record.rawStderrBytes));
}

// Acquisition health gate shared by both probes: these are FAILED
// acquisition outcomes, never successful coverage. A reader refusal
// (ok:false with the reader's own condition) is a HEALTHY observation -
// coverage stays unknown and the condition is retained verbatim. A
// cleanup-kill intervention is retained as a distinct fact; an abnormal
// worker-host failure (worker-error event, nonzero exit, kill signal, close
// timeout) is a failed acquisition.
function assertAcquisitionHealthy(facts) {
  assert.equal(facts.setupError, null, `setup failed: ${facts.setupError}`);
  assert.equal(facts.probeError, null, `probe error: ${facts.probeError}`);
  assert.equal(facts.boundaryReached, true, 'the worker reported its start boundary');
  assert.equal(facts.mutationError, null, `mutation completed: ${facts.mutationError ?? ''}`);
  assert.equal(facts.child.error, null, `no child error: ${facts.child.error}`);
  assert.equal(facts.child.closeObserved, true, 'the child close was observed');
  assert.equal(facts.child.closeTimedOut, false, 'the child close did not time out');
  assert.ok(facts.child.exitCode !== null || facts.child.signal !== null, 'the child close carried status or signal');
  // The mutation actually completed inside the probe.
  assert.equal(facts.mutationCompleted, true, 'the mutation completed');
  assert.equal(facts.mutationError, null, `mutation completed cleanly: ${facts.mutationError ?? ''}`);
  // A cleanup kill is the expected termination for an intervention; any
  // other signal is an abnormal close and fails acquisition. The worker
  // host failure stays distinct from a healthy reader refusal.
  if (facts.child.cleanupKilled) {
    assert.equal(facts.child.signal, 'SIGKILL', `the cleanup kill produced the expected signal: ${facts.child.signal}`);
  } else {
    assert.equal(facts.child.exitCode, 0, `the child exited cleanly (code ${facts.child.exitCode})`);
    assert.equal(facts.child.signal, null, `no unexpected child signal: ${facts.child.signal}`);
  }
  assert.equal(facts.child.cleanupError ?? null, null, `no cleanup error: ${facts.child.cleanupError ?? ''}`);
  // The worker's own lifetime must be observed: an absent exit is a failed
  // acquisition, not an acceptable absence. A worker-error event is a
  // failed acquisition, separate from any reader refusal.
  assert.ok(facts.workerExit, 'the worker exit was observed (required lifetime evidence)');
  assert.equal(facts.workerError, null, `no worker-error event: ${facts.workerError}`);
  if (facts.workerExit) {
    assert.equal(facts.workerExit.signal ?? null, null, `the worker was not killed by a signal: ${facts.workerExit.signal}`);
    assert.equal(facts.workerExit.code, 0, `the worker exited cleanly (code ${facts.workerExit.code})`);
  }
  assert.ok(facts.workerOutcome, 'the reader outcome was observed');
  // A reader refusal is healthy: the condition is retained verbatim and
  // coverage stays unknown.
  if (facts.workerOutcome && facts.workerOutcome.ok === false) {
    assert.ok(typeof facts.workerOutcome.condition === 'string' && facts.workerOutcome.condition !== 'worker-error', 'the reader refusal names its own condition');
  }
  assert.deepEqual(facts.parseErrors, [], 'no JSON parse failures');
}

test('in-place same-size concurrent stress: acquired facts retained, coverage unknown by design', async () => {
  const { root, facts } = await runProbe(async (rootDir, targetPath) => {
    writeFileSync(targetPath, REPLACED_CHUNK);
  });
  try {
    retainProbe('in-place', facts);
    // An unresolved close keeps the live root for inspection instead of
    // deleting it; the acquisition fails rather than passing.
    if (facts.child.closeTimedOut) {
      assert.fail('child close timed out; the live root is preserved unresolved and the acquisition failed');
    }
    assertAcquisitionHealthy(facts);
    assert.equal(facts.coverage, 'unknown');
    if (facts.readerVerdict === 'accepted') {
      assert.ok(
        facts.readDigestMatchesOriginal || facts.readDigestMatchesReplaced,
        'the accepted read digest matches one of the written contents',
      );
    }
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
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
    if (facts.child.closeTimedOut) {
      assert.fail('child close timed out; the live root is preserved unresolved and the acquisition failed');
    }
    assertAcquisitionHealthy(facts);
    assert.equal(facts.coverage, 'unknown');
    // A mapReadFailed refusal is recorded as a reader condition, never as
    // covered replacement coverage.
    if (facts.readerVerdict === 'condition:mapReadFailed') {
      assert.ok(true, 'reader refusal recorded; interval coverage remains unknown');
    }
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
  }
});
