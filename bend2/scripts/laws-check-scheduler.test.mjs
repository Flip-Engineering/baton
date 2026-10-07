import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloneLinkedTree, concurrencyFor, detachFile, producerSet, verifyResults } from './laws-check.mjs';

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
  const diagnostic = control.kind === 'proof' ? 'Error expected :' : control.payload.law;
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

test('aggregation rejects an omitted producer result', async () => {
  const failures = await verifyResults(dispatched, complete.slice(1));
  assert.equal(failures.filter(({ reason }) => reason === 'producer result omitted').length, 1);
  assert.equal(failures[0].id, controls[0].id);
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
  assert.ok((await verifyResults(dispatched, accepted)).some(({ reason }) => reason === 'compiler accepted the control'));
});

test('aggregation rejects a result without actual process completion evidence', async () => {
  const results = complete.map((result, index) => index === 0
    ? { ...result, processId: null, completedAt: null }
    : result);
  assert.ok((await verifyResults(dispatched, results)).some(({ reason }) => reason === 'compiler process identity or completion time is missing'));
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
  const loadLimited = concurrencyFor({
    cpuCapacity: 32,
    cpuLoadAverage: 4,
    memoryAvailableBytes: 64 * 1024,
    memoryEstimateBytes: 1024,
  });
  assert.equal(loadLimited.admitted, 28);
  assert.equal(loadLimited.runnerCapacity, 32);
  assert.equal(loadLimited.runnerCapacitySource, 'available CPU capacity');
});
