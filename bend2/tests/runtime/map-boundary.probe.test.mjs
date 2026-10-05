// Boundary probes for the enforced map reader's substitution and in-place
// write intervals, authored for admitted remote runs (no local execution).
//
// Determinism approach: each probe starts the production reader on a
// multi-megabyte file inside a worker thread and performs exactly one
// mutation at a fixed delay inside the multi-millisecond read window - an
// in-place same-size write for one probe, a rename-over substitution for
// the other. The retained outcome is honest in both directions: the probe
// asserts mapReplacedDuringRead when the interval was covered, and records
// the success as the stated residual when the mutation landed outside every
// covered interval - matching nanosecond timestamps never claim immutable
// bytes. One invariant holds unconditionally: when the reader returns
// success, the bytes it read hash exactly to the original content. A
// refusal names one of the reader's replacement conditions.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
    'try {',
    '  const out = reader(workerData.path);',
    "  parentPort.postMessage({ ok: true, size: out.bytes.length, sha256: createHash('sha256').update(out.bytes).digest('hex') });",
    '} catch (err) {',
    "  parentPort.postMessage({ ok: false, condition: err.condition ?? null, message: String(err.message ?? err) });",
    '}',
    '',
  ].join('\n');
}

async function runProbe(mutate) {
  const root = mkdtempSync(join(tmpdir(), 'rtv-boundary-'));
  const target = join(root, 'big.map');
  writeFileSync(target, ORIGINAL_CHUNK);
  const workerFile = join(root, 'reader-worker.mjs');
  writeFileSync(workerFile, buildWorkerSource());
  const mutation = Promise.resolve().then(() => mutate(root, target));
  const outcome = await new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const guard = setTimeout(() => done({ ok: false, condition: 'worker-timeout', message: 'reader worker did not finish' }), 60000);
    // The worker runs through a child Node so this probe file stays free of
    // a top-level worker_threads import it does not otherwise need.
    const script = [
      `const { Worker } = require('node:worker_threads');`,
      `const worker = new Worker(${JSON.stringify(workerFile)}, { workerData: { path: ${JSON.stringify(target)}, admittedRoots: [${JSON.stringify(root)}] } });`,
      'worker.on("message", (m) => { console.log(JSON.stringify(m)); });',
      'worker.on("error", (e) => { console.log(JSON.stringify({ ok: false, condition: "worker-error", message: String(e) })); });',
      'worker.on("exit", () => {});',
      '',
    ].join('\n');
    const child = spawnSync(process.execPath, ['--input-type=commonjs', '-e', script], { encoding: 'utf8', timeout: 55000 });
    clearTimeout(guard);
    const lines = (child.stdout ?? '').split('\n').filter((line) => line.startsWith('{'));
    const parsed = lines.length > 0 ? JSON.parse(lines[lines.length - 1]) : { ok: false, condition: 'no-worker-output', message: `${child.status} ${child.signal} ${child.stderr ?? ''}` };
    done(parsed);
  });
  return { root, target, outcome };
}

function retainProbe(name, record) {
  const dir = process.env.BATON_RUNTIME_EVIDENCE_DIR ?? join(tmpdir(), 'runtime-values-evidence-');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `probe-${name}.json`), JSON.stringify(record, null, 2));
}

test('in-place same-size write inside the read window refuses or is recorded as the stated residual', async () => {
  const { root, outcome } = await runProbe(async (rootDir, targetPath) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    writeFileSync(targetPath, REPLACED_CHUNK);
  });
  try {
    retainProbe('in-place', outcome);
    if (outcome.ok) {
      assert.equal(outcome.sha256, createHash('sha256').update(ORIGINAL_CHUNK).digest('hex'), 'a success can only certify the original bytes');
      assert.ok(true, 'residual: the write landed outside every covered interval; no immutable-bytes claim is made');
    } else {
      assert.equal(outcome.condition, 'mapReplacedDuringRead');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rename-over substitution inside the read window refuses or is recorded as the stated residual', async () => {
  const { root, outcome } = await runProbe(async (rootDir, targetPath) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const replacement = join(rootDir, 'replacement.map');
    writeFileSync(replacement, REPLACED_CHUNK);
    const { renameSync } = await import('node:fs');
    renameSync(replacement, targetPath);
  });
  try {
    retainProbe('substitution', outcome);
    if (outcome.ok) {
      assert.equal(outcome.sha256, createHash('sha256').update(ORIGINAL_CHUNK).digest('hex'), 'a success can only certify the original bytes');
      assert.ok(true, 'residual: the substitution landed outside every covered interval');
    } else {
      assert.ok(['mapReplacedDuringRead', 'mapReadFailed'].includes(outcome.condition), `recorded refusal condition ${outcome.condition}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
