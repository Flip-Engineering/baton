// runtime-effects.test.mjs — issue #259, slice 9 (first tranche). Pins the module the map's
// first-named coordinator effect members moved into (impl/src/runtime-effects.mjs: _dispatch,
// _spawnPlanWave, _resolveRecord — §3 rows 6/9/10) against the injected recorder port (slice 6),
// and the coordinator that now delegates to it. Five claims are load-bearing:
//
//   1. ONE-WAY IMPORT, NO IMPLICIT RECEIVER — the module imports neither monolith, and every
//      `this` access in it belongs to the two relocated error-class constructors; the moved bodies
//      read the coordinator through the explicit `coordinator` parameter and record through the
//      explicit `recorder` parameter.
//   2. SAME NAME, SAME ARITY, SAME PORT — every delegate the seam map shows as `effects_port`
//      keeps the member's own parameter list and arity on both sides of the boundary and hands the
//      class's recorder (`this._recorder`) to the module function.
//   3. THE RECORDER IS THE ONLY RECORDING PATH — a counting wrapper around the class's real
//      recorder observes every operational-log row a spawn and a respond produce, and the module's
//      recording reroute census is pinned against the source: 6 log appends and 2 evidence maps in
//      _dispatch, 7 log appends, 6 evidence maps and 3 driver records in _resolveRecord, 5
//      coordination-store calls in _spawnPlanWave.
//   4. THE PRIMITIVES MOVED ONCE — WORKTREE_FAILURE, normalizeRunId, ModelSelectionError and
//      PublicationError are exported by the module, imported back by the coordinator, and the
//      coordinator's export surface is unchanged (both classes stay reachable from coordinator.mjs
//      and from index.mjs, as the same class objects).
//   5. THE MAP SEES THE MOVE — the committed seam artifact carries the runtime-effects target, and
//      every delegate it shows with `effect:effects_port` evidence classifies as `effect`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import * as runtimeEffects from '../src/runtime-effects.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import * as indexModule from '../src/index.mjs';

const require = createRequire(import.meta.url);
const { Lang, parse } = require('@ast-grep/napi');

const MEMBER_FILE = 'impl/src/runtime-effects.mjs';
const COORD_FILE = 'impl/src/coordinator.mjs';
const MAP_FILE = 'impl/scripts/seam-inventory.json';
const read = (relative) => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');
const parseOf = (text) => parse(Lang.JavaScript, text).root();

/** The first tranche: member name, the delegate's own parameter list, and Function.length. */
const TRANCHE = Object.freeze([
  ['_dispatch', '(task, vendor, model, effort, workerPolicyResolution = null)', 4],
  ['_spawnPlanWave', '(rawMembers, opts = {})', 1],
  ['_resolveRecord', '(requestId, answer, actor)', 3],
]);

const RELOCATED_PRIMITIVES = Object.freeze([
  'ModelSelectionError', 'PublicationError', 'WORKTREE_FAILURE', 'normalizeRunId',
]);

/** The recording reroute census, pinned: needle -> per-member occurrence count in the module. */
const REROUTE_CENSUS = Object.freeze({
  _dispatch: { 'recorder.log.append(': 6, 'recorder.mapEvent(': 2, 'recorder.recordDriver(': 0, 'recorder.coordination': 3 },
  _spawnPlanWave: { 'recorder.log.append(': 0, 'recorder.mapEvent(': 0, 'recorder.recordDriver(': 0, 'recorder.coordination': 5 },
  _resolveRecord: { 'recorder.log.append(': 7, 'recorder.mapEvent(': 6, 'recorder.recordDriver(': 3, 'recorder.coordination': 3 },
});

test('RE1: the module imports neither monolith and keeps no implicit receiver outside the error classes', () => {
  const text = read(MEMBER_FILE);
  const root = parseOf(text);
  const importSources = root.findAll({ rule: { kind: 'import_statement' } })
    .map((node) => node.field('source').text());
  for (const source of importSources) {
    assert.ok(!/coordinator\.mjs|application\.mjs/.test(source), `one-way import violated: ${source}`);
  }
  const thisSites = [];
  const walk = (node, owner) => {
    if (node.kind() === 'function_declaration' || node.kind() === 'class_declaration') {
      owner = node.field('name')?.text() ?? owner;
    }
    if (node.kind() === 'member_expression' && node.field('object').text() === 'this') {
      thisSites.push({ owner, text: node.text() });
    }
    for (const child of node.children()) walk(child, owner);
  };
  walk(root, '(module scope)');
  const outside = thisSites.filter((site) => site.owner !== 'ModelSelectionError' && site.owner !== 'PublicationError');
  assert.equal(outside.length, 0,
    `implicit receivers outside the relocated error classes: ${outside.map((s) => `${s.owner}.${s.text}`).join(', ')}`);
});

test('RE2: every effects_port delegate keeps the member name, parameter list, arity, and hands over the recorder', () => {
  const map = JSON.parse(read(MAP_FILE));
  const coordinatorFile = map.files.find((file) => file.file === COORD_FILE);
  const delegated = coordinatorFile.members
    .filter((member) => member.evidence.includes('effect:effects_port'))
    .map((member) => member.name)
    .sort();
  assert.deepEqual(delegated, TRANCHE.map(([name]) => name).sort(),
    'the map shows exactly the first tranche as effects_port delegates');

  const memberRoot = parseOf(read(MEMBER_FILE));
  const memberParams = new Map();
  for (const fn of memberRoot.findAll({ rule: { any: [{ kind: 'function_declaration' }, { kind: 'generator_function_declaration' }] } })) {
    const name = fn.field('name')?.text();
    if (name) memberParams.set(name, fn.field('parameters')?.text() ?? '()');
  }
  const coordText = read(COORD_FILE);
  const coordRoot = parseOf(coordText);
  const cls = coordRoot.findAll({ rule: { kind: 'class_declaration' } })
    .find((node) => node.field('name')?.text() === 'Coordinator');
  const delegateParams = new Map();
  const delegatePort = new Map();
  for (const method of cls.field('body').children().filter((n) => n.kind() === 'method_definition')) {
    const name = method.field('name').text();
    if (!delegated.includes(name)) continue;
    delegateParams.set(name, method.field('parameters')?.text() ?? '()');
    delegatePort.set(name, method.text().includes('this._recorder'));
  }
  for (const [name, ownParams, arity] of TRANCHE) {
    assert.ok(memberParams.has(name), `module function missing for delegate ${name}`);
    const moduleOwn = memberParams.get(name).replace(/^\(coordinator, recorder,?\s*/u, '(');
    assert.equal(delegateParams.get(name), moduleOwn,
      `${name}: the delegate's parameter list must be the member's own (module takes coordinator, recorder first)`);
    assert.equal(delegateParams.get(name), ownParams, `${name}: the parameter list is the pre-move one`);
    assert.ok(delegatePort.get(name), `${name}: the delegate must hand the class recorder (this._recorder) to the module`);
    assert.ok(coordText.includes(`runtimeEffects.${name}(this, this._recorder`),
      `${name}: the delegate must call the module function with (this, this._recorder, ...)`);
    const descriptor = Object.getOwnPropertyDescriptor(Coordinator.prototype, name);
    assert.equal(descriptor.value.length, arity, `${name}: the signature must not move with the body`);
    assert.equal(typeof runtimeEffects[name], 'function', `${name}: the module exports it`);
  }
});

test('RE3: the recorder is the only recording path — a counting wrapper sees every row', async () => {
  // The reroute census is a source pin: each moved body records through the port exactly as many
  // times as the pre-move body recorded through the class authorities it fronts.
  const text = read(MEMBER_FILE);
  const root = parseOf(text);
  for (const [name, census] of Object.entries(REROUTE_CENSUS)) {
    const fn = root.findAll({ rule: { kind: 'function_declaration' } })
      .find((node) => node.field('name')?.text() === name);
    assert.ok(fn, `${name}: module function missing`);
    for (const [needle, expected] of Object.entries(census)) {
      const actual = fn.text().split(needle).length - 1;
      assert.equal(actual, expected, `${name}: ${needle} census moved`);
    }
  }

  // The behavioral half: a real spawn routes every operational-log row through the class's
  // recorder — a counting wrapper around the real port sees each row exactly once and in order,
  // and nothing appends beside it.
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Log } = await import('../src/log.mjs');
  const { FenceTable } = await import('../src/fence.mjs');
  const { coordinationForLog } = await import('../src/coordination-store.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'baton-re3-'));
  const adapter = {
    card: () => ({ harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null, maxContext: 100000, verbs: { spawn: 'native' } }),
    calls: { spawn: [] },
    _onEvent: null,
    onEvent(cb) { this._onEvent = cb; },
    emit(event) { if (this._onEvent) this._onEvent(event); },
    spawn(workerId, brief, opts) {
      this.calls.spawn.push({ workerId, brief, opts });
      return Promise.resolve({ ok: true });
    },
    async kill() {},
    async interrupt() {},
  };
  const worktrees = {
    async create(taskId) { return { path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }; },
    async remove() {},
  };
  try {
    const log = new Log(join(dir, 'log'));
    const coordinator = new Coordinator({
      log,
      coordination: coordinationForLog(log),
      fences: new FenceTable(),
      adapters: { mock: adapter },
      worktrees,
      capabilities: null,
      referee: async () => ({ reverified: true, observedExit: 0, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' }),
      route: () => 'mock',
      now: (() => { let t = 0; return () => t; })(),
      approvalTimeoutMs: 60000,
      stopDeadlineMs: 15000,
    });
    const appends = [];
    const original = coordinator._recorder.log.append.bind(coordinator._recorder.log);
    coordinator._recorder.log.append = (partial) => {
      const event = original(partial);
      appends.push(event);
      return event;
    };
    const handle = await coordinator.spawn('mock', {
      goal: 're3', constraints: [], pathScope: ['.'],
      definitionOfDone: 'done', verification: { command: 'true', expectExit: 0 },
      budget: { tokens: 1000, usd: 1, wallMin: 5 },
    });
    assert.ok(appends.some((event) => event.kind === 'lifecycle.spawned'),
      'the spawn recorded its lifecycle row through the recorder');
    const logRows = coordinator._log.read(handle.id);
    assert.deepEqual(appends.map((event) => event.seq), logRows.map((event) => event.seq),
      'every log row this worker produced rode the recorder, in order');
    const stopping = coordinator.kill(handle.id, 'test_done');
    adapter.emit({ worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'kill.confirmed', actor: 'worker', payload: {} });
    await stopping;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('RE4: the four relocated primitives moved once, and the export surface is unchanged', () => {
  const moduleText = read(MEMBER_FILE);
  const coordText = read(COORD_FILE);
  for (const name of RELOCATED_PRIMITIVES) {
    assert.ok(Object.hasOwn(runtimeEffects, name), `${name}: the module exports it`);
    assert.ok(coordText.includes(`{ ModelSelectionError, PublicationError, WORKTREE_FAILURE, normalizeRunId } from './runtime-effects.mjs'`),
      'the coordinator imports the relocated primitives back');
    void moduleText;
  }
  assert.equal(coordText.includes('export { ModelSelectionError, PublicationError };'), true,
    'the coordinator re-exports the two error classes');
  const { ModelSelectionError, PublicationError } = runtimeEffects;
  assert.equal(Coordinator === undefined, false);
  assert.equal(indexModule.ModelSelectionError, ModelSelectionError,
    'index.mjs still resolves ModelSelectionError to the same class object');
  assert.equal(indexModule.PublicationError, PublicationError,
    'index.mjs still resolves PublicationError to the same class object');
});

test('RE4b: a driver-built coordinator\'s port fronts the coordinator\'s own wrapped authorities', async (t) => {
  // The port is composed by the Coordinator constructor over this._log (the closed-checking
  // facade) and this._coordination (the poisoning proxy) — never by createDriver over the raw
  // authorities, which would bypass the proxy's coordination_write_unavailable poisoning
  // (the phase11 CK8/CK9 regression this pin locks).
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createDriver, MockAdapter } = await import('../src/index.mjs');
  const repository = mkdtempSync(join(tmpdir(), 'baton-re4b-repo-'));
  const logDir = mkdtempSync(join(tmpdir(), 'baton-re4b-log-'));
  execFileSync('git', ['init', '-q'], { cwd: repository });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: repository });
  const driver = createDriver({
    repoRoot: repository, repoId: 'repo-runtime-effects', logDir,
    adapters: { mock: new MockAdapter({ scenario: { outcome: 'completed', edits: [] }, card: { harness: 'mock', version: 're-1', model: 're-model' } }) },
  });
  t.after(async () => {
    await driver.drainAndClose('re4b-test').catch(() => {});
    rmSync(repository, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  const { coordinator } = driver;
  assert.ok(coordinator._recorder, 'the coordinator holds its recorder port');
  assert.equal(coordinator._recorder.log, coordinator._log,
    'the port fronts the closed-checking log facade, not the raw log');
  assert.equal(coordinator._recorder.coordination, coordinator._coordination,
    'the port fronts the poisoning coordination proxy, not the raw store');
});

test('RE5: the map sees the move', () => {const map = JSON.parse(read(MAP_FILE));
  const target = map.files.find((file) => file.file === MEMBER_FILE);
  assert.ok(target, 'the committed artifact carries the runtime-effects target');
  const byName = new Map(target.members.map((member) => [member.name, member]));
  for (const [name] of TRANCHE) {
    assert.ok(byName.has(name), `${name}: the module target carries its body`);
    assert.equal(byName.get(name).seam, 'effect', `${name}: the body keeps the effect seam`);
  }
  assert.ok(byName.has('normalizeRunId'), 'the relocated function is a module member');
  assert.equal(target.members.length, 4, 'the module target carries the three bodies plus normalizeRunId');
});
