import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMutation, cloneLinkedTree, concurrencyFor, createRunRoot, detachFile, laws, outputMatches, producerSet, removeProof, supportedNodeVersion, verifyResults } from './laws-check.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const rows = [
  { law: 'first_law', file: join(root, 'bend2', 'src', 'fixture-one.bend') },
  { law: 'second_law', file: join(root, 'bend2', 'src', 'fixture-two.bend') },
];
const mutations = [
  { name: 'changes-first', law: 'first_law', file: 'bend2/src/fixture-one.bend', find: 'old', replace: 'new' },
  { name: 'changes-second', law: 'second_law', file: 'bend2/src/fixture-two.bend', find: 'left', replace: 'right' },
];
const controls = producerSet(rows, mutations);
const dispatched = controls.map((control) => ({ ...control, workToken: randomUUID() }));
const artifactRoot = mkdtempSync(join(tmpdir(), 'laws-check-scheduler-fixture-'));
const workspaceRoot = mkdtempSync(join(tmpdir(), 'laws-check-workspace-fixture-'));
const complete = dispatched.map((control, index) => {
  const diagnostic = control.kind === 'proof'
    ? 'Error: 1 TODO found.\nThe code is incomplete, and not a valid proof yet.'
    : `Error:\n- expected : {left == right}\n- observed : {left == different}\nLocation: ../laws.${control.payload.law}\n`;
  const stdoutPath = join(artifactRoot, `${index}.stdout.log`);
  const stderrPath = join(artifactRoot, `${index}.stderr.log`);
  writeFileSync(stdoutPath, diagnostic);
  writeFileSync(stderrPath, '');
  const receipt = (path) => {
    const bytes = readFileSync(path);
    return { artifact: path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  return {
    id: control.id,
    kind: control.kind,
    descriptorSha256: control.descriptorSha256,
    workToken: control.workToken,
    completed: true,
    applied: true,
    passed: true,
    processId: 10000 + index,
    completedAt: new Date(0).toISOString(),
    exitCode: 1,
    signal: null,
    startupError: null,
    peakRssBytes: 1200 + index,
    peakProcessCount: 3 + index,
    peakCpuCores: 2 + index,
    cpuTicksPerSecond: 100,
    outputs: { stdout: receipt(stdoutPath), stderr: receipt(stderrPath) },
  };
});

test.after(() => {
  rmSync(artifactRoot, { recursive: true, force: true });
  rmSync(workspaceRoot, { recursive: true, force: true });
});

test('control workspaces share unchanged source and isolate the edited producer file', () => {
  const source = join(workspaceRoot, 'source');
  const first = join(workspaceRoot, 'first');
  const second = join(workspaceRoot, 'second');
  mkdirSync(source);
  writeFileSync(join(source, 'proof.bend'), 'proof source\n');
  writeFileSync(join(source, 'dependency.bend'), 'shared dependency\n');
  cloneLinkedTree(source, first);
  cloneLinkedTree(source, second);

  assert.equal(readFileSync(join(first, 'proof.bend'), 'utf8'), 'proof source\n');
  assert.equal(readFileSync(join(second, 'proof.bend'), 'utf8'), 'proof source\n');
  assert.equal(statSync(join(first, 'proof.bend')).ino, statSync(join(source, 'proof.bend')).ino);
  assert.equal(statSync(join(first, 'dependency.bend')).ino, statSync(join(source, 'dependency.bend')).ino);

  const edited = join(first, 'proof.bend');
  detachFile(edited);
  writeFileSync(edited, 'proof removed\n');
  assert.equal(readFileSync(edited, 'utf8'), 'proof removed\n');
  assert.equal(readFileSync(join(source, 'proof.bend'), 'utf8'), 'proof source\n');
  assert.equal(readFileSync(join(second, 'proof.bend'), 'utf8'), 'proof source\n');
  assert.notEqual(statSync(edited).ino, statSync(join(source, 'proof.bend')).ino);
});

test('Node support follows the published minimum and preserves exact runtime identity', () => {
  assert.equal(supportedNodeVersion('v22.14.9'), false);
  assert.equal(supportedNodeVersion('v22.15.0'), true);
  assert.equal(supportedNodeVersion('v22.23.3'), true);
  assert.equal(supportedNodeVersion('v23.0.0'), false);
  assert.equal(supportedNodeVersion('v22'), false);
});

test('law discovery includes new nested producer files and rejects malformed declarations', () => {
  const source = join(workspaceRoot, 'law-discovery');
  mkdirSync(join(source, 'nested'), { recursive: true });
  writeFileSync(join(source, 'first.bend'), 'law first_law:\n\ndef first_law():\n  True\n');
  writeFileSync(join(source, 'nested', 'second.bend'), 'law second_law:\n\ndef second_law():\n  True\n');
  assert.deepEqual(laws(source).map(({ law }) => law), ['first_law', 'second_law']);
  writeFileSync(join(source, 'nested', 'third.bend'), 'law third_law:\n');
  assert.deepEqual(laws(source).map(({ law }) => law), ['first_law', 'second_law', 'third_law']);
  writeFileSync(join(source, 'nested', 'malformed.bend'), '  law omitted_law:\n');
  assert.throws(() => laws(source), /malformed law declaration/);
});

test('proof removal removes exactly one definition and leaves other definitions intact', () => {
  const modulePath = join(workspaceRoot, 'proof-removal.bend');
  writeFileSync(modulePath, 'def first_law():\n  True\n\ndef second_law():\n  True\n');
  assert.equal(removeProof(modulePath, 'first_law'), true);
  assert.equal(readFileSync(modulePath, 'utf8'), 'def second_law():\n  True\n');
  assert.equal(removeProof(modulePath, 'missing_law'), false);
  writeFileSync(modulePath, 'def duplicate_law():\n  True\n\ndef duplicate_law():\n  False\n');
  const before = readFileSync(modulePath, 'utf8');
  assert.equal(removeProof(modulePath, 'duplicate_law'), false);
  assert.equal(readFileSync(modulePath, 'utf8'), before);
});

test('implementation mutations require one exact source match', () => {
  const modulePath = join(workspaceRoot, 'mutation.bend');
  const mutation = { find: 'target expression', replace: 'changed expression' };
  writeFileSync(modulePath, 'before\ntarget expression\nafter\n');
  assert.equal(applyMutation(modulePath, mutation), true);
  assert.equal(readFileSync(modulePath, 'utf8'), 'before\nchanged expression\nafter\n');
  writeFileSync(modulePath, 'target expression\ntarget expression\n');
  const before = readFileSync(modulePath, 'utf8');
  assert.equal(applyMutation(modulePath, mutation), false);
  assert.equal(readFileSync(modulePath, 'utf8'), before);
  writeFileSync(modulePath, 'another expression\n');
  assert.equal(applyMutation(modulePath, mutation), false);
});

test('proof removal and implementation mutation require their distinct law diagnostics', async () => {
  const genericError = join(artifactRoot, 'generic-error.log');
  const incompleteProof = join(artifactRoot, 'incomplete-proof.log');
  const namedGenericError = join(artifactRoot, 'named-generic-error.log');
  const namedProofFailure = join(artifactRoot, 'named-proof-failure.log');
  writeFileSync(genericError, 'Error: unrelated type mismatch');
  writeFileSync(namedGenericError, 'Error in first_law: unrelated type mismatch');
  writeFileSync(incompleteProof, 'Error: 1 TODO found.\nThe code is incomplete, and not a valid proof yet.');
  writeFileSync(namedProofFailure, 'Error:\n- expected : {left == right}\n- observed : {left == different}\nLocation: ../laws.first_law\n');
  assert.equal(await outputMatches([genericError], 'proof'), false);
  assert.equal(await outputMatches([incompleteProof], 'proof'), true);
  assert.equal(await outputMatches([namedGenericError], { kind: 'mutation', law: 'first_law' }), false);
  assert.equal(await outputMatches([namedProofFailure], { kind: 'mutation', law: 'first_law' }), true);
});

test('request and job artifacts cannot overwrite a prior execution', () => {
  const runRoot = join(workspaceRoot, 'run-root-collision', 'request', 'artifacts', 'job');
  createRunRoot(runRoot);
  assert.throws(() => createRunRoot(runRoot), /EEXIST/);
});

test('producer discovery returns each proof and mutation identity once', async () => {
  assert.deepEqual(controls.map(({ id }) => id), [
    'proof:bend2/src/fixture-one.bend:first_law',
    'proof:bend2/src/fixture-two.bend:second_law',
    'mutation:changes-first',
    'mutation:changes-second',
  ]);
  assert.deepEqual(await verifyResults(dispatched, complete), []);
  assert.throws(() => producerSet([rows[0], rows[0]], mutations), /not unique/);
  assert.throws(() => producerSet(rows, [mutations[0], mutations[0]]), /not unique/);
});

test('mutation results reject output that names the law without a failed proof step', async () => {
  const resultIndex = dispatched.findIndex(({ kind }) => kind === 'mutation');
  const result = complete[resultIndex];
  const stdoutPath = join(artifactRoot, 'mutation-generic-error.log');
  writeFileSync(stdoutPath, `Error in ${dispatched[resultIndex].payload.law}: unrelated type mismatch`);
  const bytes = readFileSync(stdoutPath);
  const results = complete.map((item, index) => index === resultIndex ? {
    ...item,
    outputs: {
      ...item.outputs,
      stdout: { artifact: stdoutPath, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
    },
  } : item);
  assert.ok((await verifyResults(dispatched, results)).some(({ id, reason }) =>
    id === result.id && reason === 'compiler output does not contain the producer diagnostic'));
});

test('aggregation rejects an omitted producer result', async () => {
  const failures = await verifyResults(dispatched, complete.slice(1));
  assert.equal(failures.filter(({ reason }) => reason === 'producer result omitted').length, 1);
  assert.ok(failures.some(({ id, reason }) => id === controls[0].id && reason === 'producer result omitted'));
});

test('aggregation rejects duplicate and unknown results', async () => {
  const failures = await verifyResults(dispatched, [...complete, complete[0], { ...complete[0], id: 'unknown:producer' }]);
  assert.ok(failures.some(({ reason }) => reason === 'duplicate producer result'));
  assert.ok(failures.some(({ reason }) => reason === 'unknown producer'));
});

test('aggregation rejects a changed producer descriptor', async () => {
  const results = complete.map((result, index) => index === 0
    ? { ...result, descriptorSha256: '0'.repeat(64) }
    : result);
  assert.ok((await verifyResults(dispatched, results)).some(({ reason }) => reason === 'altered producer descriptor'));
});

test('aggregation rejects a changed producer kind', async () => {
  const results = complete.map((result, index) => index === 0
    ? { ...result, kind: 'mutation' }
    : result);
  assert.ok((await verifyResults(dispatched, results)).some(({ reason }) => reason === 'altered producer kind'));
});

test('aggregation rejects a result from a different producer execution', async () => {
  const results = complete.map((result, index) => index === 0
    ? { ...result, workToken: randomUUID() }
    : result);
  assert.ok((await verifyResults(dispatched, results)).some(({ reason }) => reason === 'execution token mismatch'));
});

test('aggregation rejects unfinished and unsuccessful work', async () => {
  const results = complete.map((result, index) => index === 0
    ? { ...result, completed: false }
    : index === 1 ? { ...result, passed: false } : result);
  const failures = await verifyResults(dispatched, results);
  assert.ok(failures.some(({ reason }) => reason === 'producer did not complete'));
  assert.ok(failures.some(({ reason }) => reason === 'control failed'));
});

test('aggregation rejects startup failure and a successful compiler exit', async () => {
  const startup = complete.map((result, index) => index === 0
    ? { ...result, completed: false, exitCode: null, startupError: 'ENOENT' }
    : result);
  assert.ok((await verifyResults(dispatched, startup)).some(({ reason }) => reason === 'compiler process did not report an ordinary completed exit'));
  const accepted = complete.map((result, index) => index === 0 ? { ...result, exitCode: 0 } : result);
  assert.ok((await verifyResults(dispatched, accepted)).some(({ reason }) => reason === 'compiler did not return the expected rejection exit code'));
});

test('aggregation rejects a result without actual process completion evidence', async () => {
  const results = complete.map((result, index) => index === 0
    ? { ...result, processId: null, completedAt: null }
    : result);
  assert.ok((await verifyResults(dispatched, results)).some(({ reason }) => reason === 'compiler process identity or completion time is missing'));
});

test('aggregation rejects a result without compiler process-tree resource evidence', async () => {
  const results = complete.map((result, index) => index === 0
    ? { ...result, peakRssBytes: 0, peakProcessCount: 0, peakCpuCores: 0 }
    : result);
  assert.ok((await verifyResults(dispatched, results)).some(({ reason }) => reason === 'compiler process-tree resource evidence is missing'));
});

test('aggregation rejects compiler artifacts changed after completion', async () => {
  const stdoutPath = complete[0].outputs.stdout.artifact;
  writeFileSync(stdoutPath, 'changed after compiler completion');
  const failures = await verifyResults(dispatched, complete);
  assert.ok(failures.some(({ reason }) => reason === 'stdout artifact changed after completion'));
});

test('admission uses CPU, available memory, and runner capacity', () => {
  assert.equal(concurrencyFor({
    cpuCapacity: 32,
    memoryAvailableBytes: 8 * 1024,
    memoryEstimateBytes: 1024,
    runnerCapacity: 6,
  }).admitted, 6);
  assert.equal(concurrencyFor({
    cpuCapacity: 32,
    memoryAvailableBytes: 3 * 1024,
    memoryEstimateBytes: 1024,
    runnerCapacity: 6,
  }).admitted, 3);
  assert.equal(concurrencyFor({
    cpuCapacity: 2,
    memoryAvailableBytes: 64 * 1024,
    memoryEstimateBytes: 1024,
    runnerCapacity: 6,
  }).admitted, 2);
  assert.equal(concurrencyFor({
    cpuCapacity: 32,
    cpuLoadAverage: 4,
    memoryAvailableBytes: 64 * 1024,
    memoryEstimateBytes: 1024,
    runnerCapacity: 20,
  }).admitted, 20);
  assert.equal(concurrencyFor({
    cpuCapacity: 32,
    cpuLoadAverage: 4,
    cpuDemandPerCompiler: 8,
    memoryAvailableBytes: 64 * 1024,
    memoryEstimateBytes: 1024,
    runnerCapacity: 20,
  }).admitted, 3);
  const loadLimited = concurrencyFor({
    cpuCapacity: 32,
    cpuLoadAverage: 4,
    memoryAvailableBytes: 64 * 1024,
    memoryEstimateBytes: 1024,
  });
  assert.equal(loadLimited.admitted, 28);
  assert.equal(loadLimited.runnerCapacity, 32);
  assert.equal(loadLimited.runnerCapacitySource, 'available CPU capacity');
  assert.equal(concurrencyFor({
    cpuCapacity: 32,
    cpuLoadAverage: 32,
    memoryAvailableBytes: 64 * 1024,
    memoryEstimateBytes: 1024,
  }).admitted, 0);
  assert.equal(concurrencyFor({
    cpuCapacity: 32,
    memoryAvailableBytes: 0,
    memoryEstimateBytes: 1024,
  }).admitted, 0);
  assert.equal(concurrencyFor({
    cpuCapacity: 32,
    memoryAvailableBytes: 64 * 1024,
    memoryEstimateBytes: 1024,
    runnerCapacity: 0,
  }).admitted, 0);
});
