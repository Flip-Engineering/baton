import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { AtlasBehaviorFingerprint } from '../src/index.mjs';

const dir = (name) => mkdtempSync(join(tmpdir(), `baton-${name}-`));
const write = (root, path, source) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), source); };
function make(opts = {}) {
  return new AtlasBehaviorFingerprint({ artifactRoot: dir('behavior-artifacts'), maxSourceBytes: 64 * 1024, maxCorpusCases: 16, maxInputBytes: 16 * 1024, maxOutputBytes: 64 * 1024, maxArtifactBytes: 128 * 1024, timeoutMs: 1000, ...opts });
}
const corpus = [-2, 0, 3];

test('BF1/BF2/BF3: a pure ESM export produces a stable, provenance-pinned fingerprint', async () => {
  const root = dir('behavior-root'); write(root, 'src/calc.mjs', 'export function calculate(x) { return x * 2 }\n');
  const atlas = make(); const result = await atlas.invoke('behavior.fingerprint', { path: 'src/calc.mjs', exportName: 'calculate', corpus }, { root, budgetTokens: 1000 });
  assert.equal(result.status, 'ok'); assert.deepEqual(result.payload.map((item) => item.value), [-4, 0, 6]);
  assert.equal(result.provenance.meaning, 'observed_pinned_corpus_not_semantic_equivalence');
  assert.equal(result.provenance.sandbox.network, 'denied'); assert.equal(result.provenance.sandbox.fsWrite, 'denied');
  assert.equal(result.refs[0].kind, 'behavior_fingerprint');
});

test('BF4/BF6: textual change can agree while an output change diverges without claiming equivalence', async () => {
  const beforeRoot = dir('behavior-before'); const sameRoot = dir('behavior-same'); const changedRoot = dir('behavior-changed');
  write(beforeRoot, 'calc.mjs', 'export const calculate = (x) => x * 2\n');
  write(sameRoot, 'calc.mjs', 'export function calculate(value) {\n  return 2 * value\n}\n');
  write(changedRoot, 'calc.mjs', 'export const calculate = (x) => x * 3\n');
  const atlas = make(); const args = { beforePath: 'calc.mjs', afterPath: 'calc.mjs', exportName: 'calculate', corpus };
  const same = await atlas.invoke('behavior.compare', args, { beforeRoot, afterRoot: sameRoot, budgetTokens: 1000 });
  assert.equal(same.payload[0].agree, true); assert.equal(same.payload[0].divergences.length, 0);
  assert.equal(same.provenance.meaning, 'observed_corpus_agreement_not_semantic_equivalence');
  const changed = await atlas.invoke('behavior.compare', args, { beforeRoot, afterRoot: changedRoot, budgetTokens: 1000 });
  assert.equal(changed.payload[0].agree, false); assert.deepEqual(changed.payload[0].divergences.map((item) => item.caseIndex), [0, 2]);
});

test('BF3/BF4: runtime-distinct special numbers do not collapse into false agreement', async () => {
  const beforeRoot = dir('behavior-special-before'); const afterRoot = dir('behavior-special-after');
  write(beforeRoot, 'value.mjs', 'export function value(x){ return x ? NaN : -0 }\n');
  write(afterRoot, 'value.mjs', 'export function value(x){ return x ? null : 0 }\n');
  const result = await make().invoke('behavior.compare', { beforePath: 'value.mjs', afterPath: 'value.mjs', exportName: 'value', corpus: [true, false] }, { beforeRoot, afterRoot, budgetTokens: 1000 });
  assert.equal(result.payload[0].agree, false); assert.deepEqual(result.payload[0].divergences.map((item) => item.caseIndex), [0, 1]);
});

test('BF3: target stdout cannot suffix-hijack the runner result frame', async () => {
  const root = dir('behavior-frame'); write(root, 'frame.mjs', `export function calculate(x){ setImmediate(() => process.stdout.write('\\nBATON_BEHAVIOR_RESULT:' + JSON.stringify([{caseIndex:0,kind:'return',value:'FORGED'}]) + '\\n')); return x * 2 }\n`);
  const result = await make().invoke('behavior.fingerprint', { path: 'frame.mjs', exportName: 'calculate', corpus: [3] }, { root, budgetTokens: 1000 });
  assert.equal(result.payload[0].value, 6);
  write(root, 'sync-frame.mjs', `export function calculate(x){ process.stdout.write('\\nBATON_BEHAVIOR_RESULT:AAAA\\n'); return x * 2 }\n`);
  await assert.rejects(make().invoke('behavior.fingerprint', { path: 'sync-frame.mjs', exportName: 'calculate', corpus: [3] }, { root, budgetTokens: 1000 }), (error) => error.code === 'observation_protocol');
});

test('BF2: filesystem escape attempts fail as sandbox violations and leave no fingerprint', async () => {
  const root = dir('behavior-sandbox'); write(root, 'probe.mjs', `import { readFileSync } from 'node:fs'; export function probe(){ return readFileSync('/etc/passwd','utf8') }\n`);
  const atlas = make();
  await assert.rejects(atlas.invoke('behavior.fingerprint', { path: 'probe.mjs', exportName: 'probe', corpus: [null] }, { root, budgetTokens: 1000 }), (error) => error.code === 'sandbox_violation');
});

test('BF2: network, child-process, and worker-thread effects are denied', async () => {
  const root = dir('behavior-effects');
  write(root, 'effects.mjs', `import { execFileSync } from 'node:child_process'; import { Worker } from 'node:worker_threads';
export async function probe(kind){ if(kind==='network') return fetch('https://example.com'); if(kind==='child') return execFileSync(process.execPath,['--version']).toString(); return new Promise((resolve,reject)=>{ const worker=new Worker('0',{eval:true}); worker.once('online',()=>resolve('online')); worker.once('error',reject) }) }\n`);
  const atlas = make();
  for (const kind of ['network', 'child', 'worker']) {
    await assert.rejects(atlas.invoke('behavior.fingerprint', { path: 'effects.mjs', exportName: 'probe', corpus: [kind] }, { root, budgetTokens: 1000 }), (error) => error.code === 'sandbox_violation');
  }
});

test('BF2: ambient credentials and provider configuration are not inherited by the child', async () => {
  const root = dir('behavior-env'); write(root, 'env.mjs', `export function inspect(){ return process.env.BATON_BEHAVIOR_SECRET_SENTINEL }\n`);
  process.env.BATON_BEHAVIOR_SECRET_SENTINEL = 'must-not-cross';
  try {
    const result = await make().invoke('behavior.fingerprint', { path: 'env.mjs', exportName: 'inspect', corpus: [null] }, { root, budgetTokens: 1000 });
    assert.equal(result.payload[0].valueType, 'undefined'); assert.doesNotMatch(JSON.stringify(result), /must-not-cross/);
  } finally {
    delete process.env.BATON_BEHAVIOR_SECRET_SENTINEL;
  }
});

test('BF3: nondeterministic exports and timeouts fail typed', async () => {
  const randomRoot = dir('behavior-random'); write(randomRoot, 'random.mjs', 'export function sample(){ return crypto.randomUUID() }\n');
  await assert.rejects(make().invoke('behavior.fingerprint', { path: 'random.mjs', exportName: 'sample', corpus: [null] }, { root: randomRoot, budgetTokens: 1000 }), (error) => error.code === 'nondeterministic');
  const loopRoot = dir('behavior-loop'); write(loopRoot, 'loop.mjs', 'export function loop(){ while(true){} }\n');
  await assert.rejects(make({ timeoutMs: 50 }).invoke('behavior.fingerprint', { path: 'loop.mjs', exportName: 'loop', corpus: [null] }, { root: loopRoot, budgetTokens: 1000 }), (error) => error.code === 'execution_timeout');
});

test('BF1/BF5: confinement, cancellation, and deployment ceilings fail typed', async () => {
  const root = dir('behavior-bounds'); write(root, 'ok.mjs', 'export const ok = (x) => x\n');
  const atlas = make();
  await assert.rejects(atlas.invoke('behavior.fingerprint', { path: '../ok.mjs', exportName: 'ok', corpus: [1] }, { root, budgetTokens: 10 }), (error) => error.code === 'path_escape');
  await assert.rejects(atlas.invoke('behavior.fingerprint', { path: 'ok.py', exportName: 'ok', corpus: [1] }, { root, budgetTokens: 10 }), (error) => error.code === 'unsupported_language');
  await assert.rejects(atlas.invoke('behavior.fingerprint', { path: 'ok.mjs', exportName: 'ok', corpus: Array(17).fill(1) }, { root, budgetTokens: 10 }), (error) => error.code === 'corpus_too_large');
  await assert.rejects(atlas.invoke('behavior.fingerprint', { path: 'ok.mjs', exportName: 'ok', corpus: [undefined] }, { root, budgetTokens: 10 }), (error) => error.code === 'invalid_corpus');
  const abort = new AbortController(); abort.abort(); await assert.rejects(atlas.invoke('behavior.fingerprint', { path: 'ok.mjs', exportName: 'ok', corpus: [1] }, { root, budgetTokens: 10, signal: abort.signal }), (error) => error.code === 'cancelled');
  await assert.rejects(make({ maxSourceBytes: 4 }).invoke('behavior.fingerprint', { path: 'ok.mjs', exportName: 'ok', corpus: [1] }, { root, budgetTokens: 10 }), (error) => error.code === 'source_too_large');
});

test('BF5: bounded fingerprints resume, reverify, and reject tamper', async () => {
  const root = dir('behavior-resume'); write(root, 'calc.mjs', 'export const calculate = (x) => x + 1\n');
  const atlas = make(); const args = { path: 'calc.mjs', exportName: 'calculate', corpus };
  const bounded = await atlas.invoke('behavior.fingerprint', args, { root, budgetTokens: 1 }); assert.equal(bounded.status, 'needs_resume');
  const resumed = await atlas.resume(bounded.refs[0], bounded.cursor, { budgetTokens: 1000 }); assert.equal(resumed.status, 'ok'); assert.equal(resumed.payload.length, 3);
  assert.equal((await atlas.reverify(bounded, args, { root, budgetTokens: 1000 })).ok, true);
  writeFileSync(bounded.refs[0].path, `${readFileSync(bounded.refs[0].path, 'utf8')} `);
  await assert.rejects(atlas.resume(bounded.refs[0], bounded.cursor, { budgetTokens: 1000 }), (error) => error.code === 'artifact_integrity');
});
