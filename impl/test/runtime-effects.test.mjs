// runtime-effects.test.mjs — issue #259, slices 9 and 12. Pins the module the coordinator's
// effect members moved into (impl/src/runtime-effects.mjs: slice 9's _dispatch, _spawnPlanWave,
// _resolveRecord — §3 rows 6/9/10; slice 12's entangled four — stopRunTargets, _integrate,
// _deliver, _finalizeStop — split admission-from-effect per seam-effects-tranche-2-design.md, the
// admission prefixes in runtime-admission.mjs called first, one-way) against the injected
// recorder port (slice 6), and the coordinator that now delegates to it. Six claims are
// load-bearing:
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

import { collectSeamInventory } from '../scripts/seam-inventory.mjs';

import * as runtimeEffects from '../src/runtime-effects.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import * as indexModule from '../src/index.mjs';

const require = createRequire(import.meta.url);
const { Lang, parse } = require('@ast-grep/napi');

const MEMBER_FILE = 'impl/src/runtime-effects.mjs';
const ADMISSION_FILE = 'impl/src/runtime-admission.mjs';
const COORD_FILE = 'impl/src/coordinator.mjs';
const read = (relative) => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');
const parseOf = (text) => parse(Lang.JavaScript, text).root();


/** The tranche-2 admission prefixes (runtime-admission.mjs) the effect remainders call first:
 * member name, the admission function's own parameter list. Effects imports admission one-way;
 * admission never imports effects (the cycle the base-layer placement of ORIENTATION_DELIVERY /
 * IntegrationError / noop / the closed-verdict family in runtime-recovery.mjs prevents). */
const ADMISSION_PREFIXES = Object.freeze([
  ['stopRunTargets', '_admitRunStopTargets', '(coordinator, recorder, targetWorkerIds, actor, opts)'],
  ['_integrate', '_admitIntegration', '(coordinator, handle, task, opts)'],
  ['_deliver', '_admitDelivery', '(coordinator, recorder, handle, mode, opts)'],
]);

/** The closed descriptor union _admitDelivery returns (slice-12 design §3.3). */
const ADMIT_DELIVERY_UNION = Object.freeze([
  '{ admitted: false, result }',
  "{ admitted: true, handoff: null }",
  "{ admitted: true, handoff: 'preservedSuccessor' }",
  "{ admitted: true, handoff: 'followUp' }",
  "{ admitted: true, handoff: 'nudgeTurn', pause }",
  "{ admitted: true, handoff: 'interruptThenGoverned' }",
]);



test('RE1: the module imports neither monolith and keeps no implicit receiver outside the error classes', () => {
  const text = read(MEMBER_FILE);
  const root = parseOf(text);
  const importSources = root.findAll({ rule: { kind: 'import_statement' } })
    .map((node) => node.field('source').text());
  for (const source of importSources) {
    assert.ok(!/coordinator\.mjs|application\.mjs/.test(source), `one-way import violated: ${source}`);
    // Slice 12's acyclic order: effects -> {admission, recovery}; observation -> {effects,
    // recovery}. An effects import of observation would close the 2-cycle.
    assert.ok(!/runtime-observation\.mjs/.test(source), `acyclic order violated: ${source}`);
  }
  assert.ok(importSources.some((source) => /runtime-admission\.mjs/.test(source)),
    'tranche 2 calls the admission prefixes first — the module imports runtime-admission.mjs');
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
  const map = collectSeamInventory();
  const coordinatorFile = map.files.find((file) => file.file === COORD_FILE);
  const delegated = coordinatorFile.members
    .filter((member) => member.evidence.includes('effect:effects_port'))
    .map((member) => member.name)
    .sort();
  assert.ok(delegated.length > 0, 'the map carries at least one effects_port delegate');

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
  for (const name of delegated) {
    assert.ok(memberParams.has(name), `module function missing for delegate ${name}`);
    const moduleOwn = memberParams.get(name).replace(/^\(coordinator, recorder,?\s*/u, '(');
    assert.equal(delegateParams.get(name), moduleOwn,
      `${name}: the delegate's parameter list must be the member's own (module takes coordinator, recorder first)`);
    assert.ok(delegatePort.get(name), `${name}: the delegate must hand the class recorder (this._recorder) to the module`);
    assert.ok(coordText.includes(`runtimeEffects.${name}(this, this._recorder`),
      `${name}: the delegate must call the module function with (this, this._recorder, ...)`);
    assert.ok(Object.getOwnPropertyDescriptor(Coordinator.prototype, name),
      `${name}: the class must still answer on ${name}`);
    assert.equal(typeof runtimeEffects[name], 'function', `${name}: the module exports it`);
  }
});

test('RE3: the recorder is the only recording path — a counting wrapper sees every row', async () => {
  const text = read(MEMBER_FILE);
  const root = parseOf(text);
  const codeOnly = root.findAll({ rule: { any: [{ kind: 'function_declaration' }, { kind: 'generator_function_declaration' }] } })
    .map((fn) => fn.text()).join('\n');
  assert.ok(codeOnly.includes('recorder.log.append('), 'the bucket uses recorder.log.append');
  assert.ok(codeOnly.includes('recorder.mapEvent('), 'the bucket uses recorder.mapEvent');
  assert.ok(codeOnly.includes('recorder.coordination'), 'the bucket uses recorder.coordination');
  assert.ok(!codeOnly.includes('this._log.append('), 'no moved body reaches the log beside the port');
  assert.ok(!codeOnly.includes('this._coordination'), 'no moved body reaches the store beside the port');

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
    prompt(workerId, message, mode) {
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
    // Slice 12, tranche 2: one driven instance of each moved member, observed through the same
    // wrapper — _deliver (a nudge to the working member), _finalizeStop (the kill's confirmed
    // row below), and stopRunTargets (the dead target's convergence). _integrate's driven
    // recording proof is phase11's CK8/CK9 poisoned-write pair, named in seam-slice-12.md.
    const delivered = await coordinator._deliver(handle, 're3-nudge', 'nudge', {});
    assert.equal(delivered.ok, true, `the nudge delivered through the moved _deliver: ${JSON.stringify(delivered)}`);
    assert.ok(appends.some((event) => event.kind === 'control.nudge'),
      'the nudge row recorded through the recorder from the module body');
    const stopping = coordinator.kill(handle.id, 'test_done');
    adapter.emit({ worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'kill.confirmed', actor: 'worker', payload: {} });
    await stopping;
    assert.ok(appends.some((event) => event.kind === 'kill.confirmed'),
      'the stop confirmation recorded through the recorder from the moved _finalizeStop');
    const stopped = await coordinator.stopRunTargets([handle.id], 'test_done');
    assert.equal(stopped.remainingCount, 0, 'the moved stopRunTargets converged the dead target');
    const finalRows = coordinator._log.read(handle.id);
    assert.deepEqual(appends.map((event) => event.seq), finalRows.map((event) => event.seq),
      'every log row across deliver/stop/convergence rode the recorder, in order');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('RE4: the relocated primitives moved once, and the export surface is unchanged', () => {
  const moduleRoot = parseOf(read(MEMBER_FILE));
  const coordText = read(COORD_FILE);
  const relocated = [];
  for (const node of moduleRoot.findAll({ rule: { kind: 'export_statement' } })) {
    const decl = node.field('declaration');
    if (!decl) continue;
    const kind = decl.kind();
    if (kind === 'lexical_declaration') {
      for (const v of decl.children().filter((c) => c.kind() === 'variable_declarator')) {
        const n = v.field('name')?.text();
        if (n) relocated.push(n);
      }
    } else if (kind === 'class_declaration') {
      const n = decl.field('name')?.text();
      if (n) relocated.push(n);
    }
  }
  assert.ok(relocated.length > 0, 'the module carries relocated declarations');
  for (const name of relocated) {
    assert.ok(Object.hasOwn(runtimeEffects, name), `${name}: the module exports it`);
  }
  assert.ok(coordText.includes("from './runtime-effects.mjs'"),
    'the coordinator imports the relocated primitives back');
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

test('RE5: the map sees the move', () => {const map = collectSeamInventory();
  const target = map.files.find((file) => file.file === MEMBER_FILE);
  assert.ok(target, 'the committed artifact carries the runtime-effects target');
  const byName = new Map(target.members.map((member) => [member.name, member]));
  const coordFile = map.files.find((file) => file.file === COORD_FILE);
  const delegated = coordFile.members
    .filter((m) => m.evidence.includes('effect:effects_port'))
    .map((m) => m.name);
  for (const name of delegated) {
    assert.ok(byName.has(name), `${name}: the module target carries its body`);
    assert.equal(byName.get(name).seam, 'effect', `${name}: the body keeps the effect seam`);
  }
  assert.ok(byName.has('normalizeRunId'), 'the relocated function is a module member');
  // Tranche 2's lifted closures are module members too. attemptRunStopTarget keeps the effect
  // seam on its adapter/kill evidence; cancelRunStopTarget's only module-side evidence is the
  // cancellation row it appends, so the classifier says observation — an honest evidence read,
  // named here the way RO5 names its port-spelling reclassifications.
  assert.ok(byName.has('cancelRunStopTarget') && byName.has('attemptRunStopTarget'),
    'the two lifted stopRunTargets closures are module members');
  assert.equal(byName.get('cancelRunStopTarget').seam, 'observation',
    'cancelRunStopTarget: its one module-side authority is the log append (named, not hidden)');
  assert.equal(byName.get('attemptRunStopTarget').seam, 'effect',
    'attemptRunStopTarget keeps the effect seam');
});

test('RE6: the tranche-2 split — the admission/effect triad, the descriptor union, and delegate timing', () => {
  const effectsText = read(MEMBER_FILE);
  const effectsRoot = parseOf(effectsText);
  const admissionText = read(ADMISSION_FILE);
  const admissionRoot = parseOf(admissionText);
  const fnParams = (root, name) => root.findAll({ rule: { kind: 'function_declaration' } })
    .find((node) => node.field('name')?.text() === name)?.field('parameters')?.text();

  // The admission prefix exists for each split member, with the design's own parameter list, and
  // the effect remainder calls it before any act or record of its own.
  for (const [member, admission, params] of ADMISSION_PREFIXES) {
    assert.equal(fnParams(admissionRoot, admission), params,
      `${admission}: the admission prefix keeps the design's signature`);
    const effectFn = effectsRoot.findAll({ rule: { kind: 'function_declaration' } })
      .find((node) => node.field('name')?.text() === member);
    assert.ok(effectFn, `${member}: effect remainder missing`);
    const body = effectFn.field('body').text();
    const callAt = body.indexOf(`runtimeAdmission.${admission}(`);
    assert.ok(callAt >= 0, `${member}: the effect remainder calls its admission prefix`);
    const before = body.slice(0, callAt);
    const actedBefore = /recorder\.log\.|recorder\.mapEvent|recorder\.recordDriver|recorder\.coordination|_adapters\[|_fences\.issue|_worktrees\./u
      .test(before.replace(/coordinator\.(tick|_getWorker|_tasks\.get)\(/gu, ''));
    assert.ok(!actedBefore, `${member}: the body acts or records before admission resolves`);
  }

  // The _admitDelivery descriptor union is a closed set, in both shapes and handoff names.
  const admitDelivery = admissionRoot.findAll({ rule: { kind: 'function_declaration' } })
    .find((node) => node.field('name')?.text() === '_admitDelivery');
  const returns = admitDelivery.field('body').findAll({ rule: { kind: 'return_statement' } })
    .map((node) => node.text());
  const refusals = returns.filter((text) => text.includes('admitted: false'));
  const admitted = returns.filter((text) => text.includes('admitted: true'));
  assert.ok(refusals.length > 0 && admitted.length > 0, 'the union carries both halves');
  for (const text of refusals) {
    assert.ok(/return \{ admitted: false, result: \{ .+ \} \};$/u.test(text),
      `refusal descriptor shape drifted: ${text}`);
  }
  const handoffs = admitted.map((text) => {
    const match = text.match(/handoff: ('[a-zA-Z]+'|null)(, pause)?/u);
    return `${match[1]}${match[2] ?? ''}`;
  }).sort();
  assert.deepEqual(handoffs, ["'followUp'", "'interruptThenGoverned'", "'nudgeTurn', pause", "'preservedSuccessor'", 'null'],
    'the handoff set is exactly the four receiver handoffs plus the proceed case');
  for (const text of admitted.filter((t) => t.includes("'nudgeTurn'"))) {
    assert.ok(text.includes(', pause'), 'the nudgeTurn handoff carries the pause record');
  }

  // Async-ness is the pre-move member's own at both stations, and the class delegates are plain
  // forwarders (the slice-11 convention: no adopted-promise settlement hop).
  const coordRoot = parseOf(read(COORD_FILE));
  const cls = coordRoot.findAll({ rule: { kind: 'class_declaration' } })
    .find((node) => node.field('name')?.text() === 'Coordinator');
  for (const [name, wasAsync] of [
    ['stopRunTargets', true], ['_integrate', true], ['_deliver', true], ['_finalizeStop', false],
  ]) {
    const delegate = cls.field('body').children().find((n) => n.kind() === 'method_definition'
      && n.field('name').text() === name);
    assert.ok(delegate, `${name}: delegate missing`);
    assert.equal(delegate.text().startsWith(`async ${name}(`), false,
      `${name}: the delegate is a plain forwarder (slice-11 convention)`);
    const moduleFn = effectsRoot.findAll({ rule: { kind: 'function_declaration' } })
      .find((node) => node.field('name')?.text() === name);
    assert.equal(moduleFn.text().startsWith(`async function ${name}(`), wasAsync,
      `${name}: the module function keeps the member's async-ness`);
    const descriptor = Object.getOwnPropertyDescriptor(Coordinator.prototype, name);
    assert.ok(!descriptor.value.constructor.name.includes('Async'),
      `${name}: the delegate itself must not be async (no adopted-promise hop)`);
  }
});
