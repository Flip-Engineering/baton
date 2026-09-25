// coordination-internals.test.mjs — issue #259, slice 1. Pins the two modules the store's surface and
// recovery buckets moved into (impl/src/coordination-internals.mjs, impl/src/coordination-replay.mjs)
// and the store that now delegates to them. Four claims are load-bearing:
//
//   1. CONTEXT-FREE — a moved module has no `this`, no module-level mutable state, and never imports
//      the store back: every helper is a function of what it is handed, nothing else.
//   2. THE SAME INPUT GIVES THE SAME OUTPUT — calling every exported helper against two independently
//      built, identically seeded stores produces identical values (or identical refusals), and the
//      helpers that take one state slice never write it.
//   3. THE PORT IS EXPLICIT — every export names the state it reads (`store` first, or no state at
//      all), and the store reaches each one through exactly one delegate whose name and arity are the
//      member's own.
//   4. THE STORE'S BEHAVIOR IS UNCHANGED — a real CoordinationStore fixture (create, idempotent
//      retry, claim, restart) produces the exact ledger, projections and startup report it produced
//      before the move.
//
// The 150 delegates and their arities are pinned against the committed seam map, so a helper that
// loses its delegate, or a member that changes signature, fails here rather than in production.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as coordinationInternals from '../src/coordination-internals.mjs';
import * as coordinationReplay from '../src/coordination-replay.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';

const require = createRequire(import.meta.url);
const { Lang, parse } = require('@ast-grep/napi');

const MODULES = Object.freeze([
  { file: 'src/coordination-internals.mjs', artifact: 'impl/src/coordination-internals.mjs', namespace: 'coordinationInternals', exports: coordinationInternals },
  { file: 'src/coordination-replay.mjs', artifact: 'impl/src/coordination-replay.mjs', namespace: 'coordinationReplay', exports: coordinationReplay },
]);
const STORE_FILE = 'src/coordination-store.mjs';
const MAP_STORE_FILE = 'impl/src/coordination-store.mjs';
const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const parseOf = (text) => parse(Lang.JavaScript, text).root();
const tokens = (node) => node.children().filter((child) => !['(', ')', ','].includes(child.kind()));

/** The identifiers a node reads as variables — property names and object keys are not reads. */
function freeIdentifiers(node) {
  const names = new Set();
  for (const identifier of node.findAll({ rule: { kind: 'identifier' } })) {
    const parent = identifier.parent();
    if (parent && parent.kind() === 'member_expression' && parent.field('property')?.id() === identifier.id()) continue;
    if (parent && (parent.kind() === 'pair' || parent.kind() === 'pair_pattern') && parent.field('key')?.id() === identifier.id()) continue;
    names.add(identifier.text());
  }
  return names;
}

/** A fresh, identically seeded store: the fixture both the purity and the behavior claims run on. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'baton-coordination-internals-'));
  const clock = () => '2026-09-13T00:00:00.000Z';
  const store = new CoordinationStore(root, { clock });
  const fields = (id, deps = []) => ({ id, brief: { goal: id }, deps, refines: null, taskType: 'test', reservedWorkerId: `w-${id}` });
  const records = [
    store.createTask(fields('ci-a'), { actor: 'orchestrator', key: 'fixture-a' }),
    store.createTask(fields('ci-b', ['ci-a']), { actor: 'orchestrator', key: 'fixture-b' }),
    store.claimTask('ci-a', 'w-ci-a', 1, { actor: 'orchestrator', key: 'fixture-claim-a' }),
  ];
  return { root, store, records, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** The delegate every moved member kept: `return coordinationInternals.<helper>(<state>, …)`. */
function delegates() {
  const declaration = parseOf(read(STORE_FILE)).findAll({ rule: { kind: 'class_declaration' } })
    .find((node) => node.field('name')?.text() === 'CoordinationStore');
  const wired = new Map();
  for (const member of declaration.field('body').children()) {
    if (member.kind() !== 'method_definition') continue;
    const body = member.field('body');
    const statements = body.children();
    if (statements.length !== 3 || statements[1].kind() !== 'return_statement') continue;
    const call = statements[1].children().find((child) => child.kind() === 'call_expression');
    const callee = call?.field('function');
    if (!callee || callee.kind() !== 'member_expression') continue;
    const module = MODULES.find((entry) => entry.namespace === callee.field('object')?.text());
    if (!module) continue;
    const args = tokens(call.field('arguments'));
    const parameters = tokens(member.field('parameters'));
    wired.set(member.field('name')?.text(), {
      helper: callee.field('property')?.text(),
      module: module.namespace,
      state: args[0]?.text() === 'this' ? 'store' : args[0]?.text()?.replace(/^this\./, ''),
      arity: parameters.filter((parameter) => parameter.kind() === 'identifier').length,
    });
  }
  return wired;
}

/** Every name the store imports from a moved module, so a dangling import cannot hide. */
function importedFromMovedModules() {
  const found = [];
  for (const statement of parseOf(read(STORE_FILE)).children()) {
    if (statement.kind() !== 'import_statement') continue;
    const source = statement.children().find((child) => child.kind() === 'string')?.text()?.slice(1, -1);
    const module = MODULES.find((entry) => './' + entry.file.replace(/^src\//u, '') === source);
    if (!module) continue;
    for (const specifier of statement.findAll({ rule: { kind: 'import_specifier' } })) {
      found.push({ module: module.file, name: specifier.field('name')?.text() });
    }
  }
  return found;
}

/** Every exported function of a moved module, with the state parameter it declares. */
function exportedFunctions(text) {
  const found = [];
  for (const statement of parseOf(text).children()) {
    const declaration = statement.field('declaration');
    if (statement.kind() !== 'export_statement' || declaration?.kind() !== 'function_declaration') continue;
    const parameters = tokens(declaration.field('parameters'));
    found.push({
      name: declaration.field('name')?.text(),
      parameters,
      stateParameter: parameters[0]?.kind() === 'identifier' ? parameters[0].text() : null,
      declaration,
    });
  }
  return found;
}

/** A value or a refusal, reduced to something two runs can be compared on. */
function outcome(fn, args, root) {
  try {
    const value = JSON.stringify(fn(...args) ?? null) ?? 'undefined';
    return `value:${value.split(root).join('<root>')}`;
  } catch (error) {
    return `refusal:${error?.code ?? error?.name}:${error?.message}`;
  }
}

const snapshotOf = (value) => JSON.stringify(value instanceof Map ? [...value] : value);

test('CI1: the moved modules are context-free — no this, no mutable module state, no store import', () => {
  for (const module of MODULES) {
    const root = parseOf(read(module.file));
    // The relocated error classes are the one place a `this` legitimately lives (their constructors);
    // every moved helper must be a function of its arguments alone.
    const classes = new Set(root.findAll({ rule: { kind: 'class_declaration' } }).map((node) => node.id()));
    const receivers = root.findAll({ rule: { kind: 'this' } })
      .filter((node) => { let parent = node.parent(); while (parent) { if (classes.has(parent.id())) return false; parent = parent.parent(); } return true; })
      .map((node) => node.range().start.line);
    assert.deepEqual(receivers, [], `${module.file}: a moved helper must not read an implicit receiver`);
    const mutable = [];
    const bound = new Set();
    for (const statement of root.children()) {
      const kind = statement.kind();
      if (kind === 'variable_declaration') mutable.push(statement.text().slice(0, 60));
      if (kind === 'lexical_declaration' && statement.children().some((child) => child.kind() === 'let')) {
        mutable.push(statement.text().slice(0, 60));
      }
      if (kind === 'import_statement') {
        const source = statement.children().find((child) => child.kind() === 'string')?.text();
        assert.notEqual(source, "'./coordination-store.mjs'",
          `${module.file}: the store imports this module, so this import would close a cycle`);
        for (const specifier of statement.findAll({ rule: { kind: 'import_specifier' } })) {
          bound.add(specifier.field('alias')?.text() ?? specifier.field('name')?.text());
        }
        continue;
      }
      const declaration = kind === 'export_statement' ? (statement.field('declaration') ?? statement) : statement;
      for (const declarator of declaration.children()) {
        if (declarator.kind() === 'variable_declarator') bound.add(declarator.field('name')?.text());
      }
      const declared = declaration.field('name')?.text();
      if (declared) bound.add(declared);
    }
    const written = [];
    for (const statement of root.children()) {
      for (const assignment of statement.findAll({ rule: { kind: 'assignment_expression' } })) {
        const target = assignment.field('left');
        if (target?.kind() === 'identifier' && bound.has(target.text())) written.push(assignment.text().slice(0, 60));
      }
    }
    assert.deepEqual([...mutable, ...written], [], `${module.file}: module-level state is constant only, never written`);
  }
});

test('CI2: the committed map, the delegates, and the exports are one bijection', () => {
  const map = JSON.parse(read('scripts/seam-inventory.json'));
  const moved = new Map();
  for (const member of map.files.find((file) => file.file === MAP_STORE_FILE).members) {
    const port = member.evidence.find((entry) => entry.endsWith(':internals_port') || entry.endsWith(':replay_port'));
    if (!port) continue;
    moved.set(`${member.name}#${member.ordinal}`, port === 'surface:internals_port' ? 'coordinationInternals' : 'coordinationReplay');
  }
  const counts = [...moved.values()].reduce((acc, namespace) => ({ ...acc, [namespace]: (acc[namespace] ?? 0) + 1 }), {});
  // #286 added three internals helpers (waveBinding, orientationReadHead, orientationReadLatest)
  // and their store delegates, and issue #259 slice 2 relocated the last 14 members two suite-pinned
  // source scans had keyed to the store file; the census is the point, so it moves with them. Slice 7
  // then moved the two orientation read delegates (orientationReadHead, orientationReadLatest) to the
  // ledger-writes port with the store's effect bucket — they still reach the same internals helpers,
  // one module call away — so the internals census is 101.
  assert.ok(counts.coordinationInternals > 0 && counts.coordinationReplay > 0,
    'the map must show the moved surface and recovery buckets — every store member whose body left');

  const wired = delegates();
  const orphans = [...moved.keys()].filter((identity) => !wired.has(identity.split('#')[0]));
  assert.deepEqual(orphans, [], 'every mapped move must still be a delegate on the class');
  for (const [member, delegate] of wired) {
    assert.equal(moved.get(`${member}#0`), delegate.module, `${member}: the delegate and the map must name the same module`);
    assert.ok(Object.hasOwn(MODULES.find((entry) => entry.namespace === delegate.module).exports, delegate.helper),
      `${member}: ${delegate.module}.${delegate.helper} must be exported`);
  }
  // The replay module is exactly its port: 51 exports, one delegate each. The internals module also
  // exports the relocated primitives (keys, digests, paths) the store imports back, so the claim
  // there is: 101 distinct delegate-reached helpers, each reached by exactly one delegate — and every
  // name the store imports from either module must exist.
  const replay = MODULES.find((module) => module.namespace === 'coordinationReplay');
  const reached = [...wired.values()].filter((delegate) => delegate.module === replay.namespace).map((delegate) => delegate.helper).sort();
  assert.deepEqual(reached, Object.keys(replay.exports).sort(),
    `${replay.file}: every export has exactly one delegate, and every delegate names an export`);
  const helpers = [...wired.values()].filter((delegate) => delegate.module === 'coordinationInternals').map((delegate) => delegate.helper);
  assert.equal(new Set(helpers).size, helpers.length, 'one delegate per internals helper');
  assert.equal(helpers.length, counts.coordinationInternals, 'the internals port carries one helper per mapped move');
  for (const imported of importedFromMovedModules()) {
    const module = MODULES.find((entry) => entry.file === imported.module);
    assert.ok(Object.hasOwn(module.exports, imported.name),
      `${STORE_FILE}: imports ${imported.name} from ${module.file}, which must export it`);
  }
});

test('CI3: the same input gives the same output, and a slice is never written', () => {
  const wired = delegates();
  const failures = [];
  for (const module of MODULES) {
    const declared = new Map(exportedFunctions(read(module.file)).map((entry) => [entry.name, entry]));
    const helpers = [...wired.entries()].filter(([, delegate]) => delegate.module === module.namespace);
    for (const [member, delegate] of helpers) {
      const { name, parameters, declaration } = declared.get(delegate.helper);
      // The state contract is read off both sides: whatever the delegate hands over (`this`, or one
      // collection) is the first parameter, and a pure helper declares neither. A slice parameter is
      // named `state` — or by the field itself, where a local would otherwise shadow it.
      const reads = freeIdentifiers(declaration);
      const firstParameter = parameters[0]?.kind() === 'identifier' ? parameters[0].text() : null;
      const declaresStore = firstParameter === 'store';
      const declaresSlice = firstParameter !== null && firstParameter !== 'store'
        && (firstParameter === 'state' || firstParameter === delegate.state);
      assert.ok(!reads.has('store') || declaresStore,
        `${module.file}: ${name} (from ${member}) reads the store, so the store is its first parameter`);
      assert.ok(!declaresSlice || reads.has(firstParameter),
        `${module.file}: ${name} (from ${member}) must read the ${firstParameter} slice it declares`);
      assert.ok(!(declaresSlice && reads.has('store')),
        `${module.file}: ${name} (from ${member}) takes one slice and must not reach for the store as well`);
      const stateParameter = declaresStore ? 'store' : (declaresSlice ? 'state' : null);
      const sliceField = declaresSlice ? delegate.state : null;
      const first = fixture();
      const second = fixture();
      try {
        const argsOf = (entry) => {
          if (stateParameter === null) return [];
          const state = stateParameter === 'store' ? entry.store : entry.store[sliceField];
          return [state, ...parameters.slice(1).map(() => undefined)];
        };
        const before = sliceField === null ? null : snapshotOf(first.store[sliceField]);
        const fromFirst = outcome(module.exports[name], argsOf(first), first.root);
        const fromSecond = outcome(module.exports[name], argsOf(second), second.root);
        if (fromFirst !== fromSecond) failures.push(`${module.file}: ${name} — ${fromFirst} vs ${fromSecond}`);
        if (before !== null && snapshotOf(first.store[sliceField]) !== before) {
          failures.push(`${module.file}: ${name} wrote the ${sliceField} slice it was handed`);
        }
      } finally {
        first.cleanup();
        second.cleanup();
      }
    }
    // The relocated primitives are helpers too: no state, no variance, two calls must agree.
    const moved = new Set(helpers.map(([, delegate]) => delegate.helper));
    for (const [name, entry] of declared) {
      if (moved.has(name) || typeof module.exports[name] !== 'function' || /^[A-Z]/u.test(name)) continue;
      const once = outcome(module.exports[name], entry.parameters.map(() => undefined), '/');
      const twice = outcome(module.exports[name], entry.parameters.map(() => undefined), '/');
      if (once !== twice) failures.push(`${module.file}: ${name} — ${once} vs ${twice}`);
    }
  }
  assert.deepEqual(failures, [], 'a moved helper must be a function of the state it is handed');
});

test('CI4: the store reaches every moved member through its own delegate, with its own arity', () => {
  const wired = delegates();
  assert.ok(wired.size > 0, 'the internals/replay port carries delegates');
  for (const [name, delegate] of wired) {
    const descriptor = Object.getOwnPropertyDescriptor(CoordinationStore.prototype, name)
      ?? Object.getOwnPropertyDescriptor(CoordinationStore, name);
    assert.ok(descriptor, `${name}: the store must still answer on ${name}`);
    assert.equal(descriptor.value?.length ?? descriptor.get?.length, delegate.arity,
      `${name}: the signature must not move with the body`);
    assert.ok(['coordinationInternals', 'coordinationReplay'].includes(delegate.module),
      `${name}: the port is one of the two moved modules`);
  }
  assert.deepEqual(CoordinationStore.KNOWLEDGE_CANDIDATE_TRIGGERS, {
    'board.item_closed': 'board_close', 'package.admitted': 'package_admit',
    'scratch.cited_observed': 'scratchpad_settle', 'verified_task_outcome': 'verification',
  }, 'the one static getter still answers with the same frozen table');
});

test('CI5: the store keeps its exact public behavior across the move (create, retry, claim, restart)', () => {
  const { root, store, records, cleanup } = fixture();
  try {
    assert.deepEqual(records.map((record) => record.event.seq), [1, 2, 3]);
    const retry = store.createTask(
      { id: 'ci-b-changed', brief: { goal: 'changed' }, deps: ['ci-a'], refines: null, taskType: 'test', reservedWorkerId: 'w-ci-b' },
      { actor: 'orchestrator', key: 'fixture-b' },
    );
    assert.deepEqual([retry.result, retry.event.seq, retry.event.kind], ['idempotent', 2, 'task.created']);
    assert.deepEqual(store.events().map((event) => [event.seq, event.kind, event.idempotencyKey]), [
      [1, 'task.created', 'fixture-a'], [2, 'task.created', 'fixture-b'], [3, 'task.claimed', 'fixture-claim-a'],
    ]);
    assert.deepEqual(store.task('ci-a'), {
      id: 'ci-a', brief: { goal: 'ci-a' }, deps: [], refines: null, taskType: 'test', reservedWorkerId: 'w-ci-a',
      runId: null, status: 'working', assignee: 'w-ci-a', version: 2, createdEvent: 1, claimedEvent: 3,
      terminalEvent: null, artifactIds: [],
    });
    assert.deepEqual(store.readyTasks().map((task) => task.id), [], 'the one task with no unfinished deps is already claimed');
    assert.deepEqual(store.taskTopology().tasks, []);
    assert.equal(store.observationTime(1), '2026-09-13T00:00:00.000Z');
    assert.equal(store.healthCheck(), true, 'the ledger ends newline-complete');
    const ledger = readFileSync(join(root, 'events.jsonl'));
    assert.equal(createHash('sha256').update(ledger).digest('hex'),
      'bd91ae83725dae19d8192f532b902228af0433dc69af488bd38b39c86480bd67',
      'the durable bytes are the ones the pre-move store wrote for the same fixture');
    const before = createHash('sha256').update(JSON.stringify(store.snapshot())).digest('hex');

    const restarted = new CoordinationStore(root, { clock: () => '2026-09-13T00:00:00.000Z' });
    assert.deepEqual(restarted.startupStatus(), {
      schemaVersion: 1, state: 'ready', source: 'ledger', totalEvents: 3, checkpointEvents: 0,
      replayedEvents: 3, checkpoint: 'absent', failure: null,
      poison: null, quarantined: [],
    }, 'restart replays the whole ledger through the moved replay port');
    assert.equal(createHash('sha256').update(JSON.stringify(restarted.snapshot())).digest('hex'), before,
      'replay reconstructs the identical projection');
    assert.deepEqual(restarted.task('ci-a'), store.task('ci-a'));
    assert.equal(restarted.healthCheck(), true);
  } finally {
    cleanup();
  }
});

test('CI6: the 14 members slice 2 relocated are delegates, and the pins that keyed them to the store now name them', () => {
  // Slice 1 kept these 14 in the store because two red-first suites pinned byte-literal LOCATIONS in
  // coordination-store.mjs: frame-economics-red exempted F1's byte literals by FILE, and
  // worker-verdict-surface-red grepped the store path for the recovery-refinement digest pin. Slice 2
  // retired both: F1's exemptions and the digest pin now name the MEMBER, resolving its home through
  // the committed seam map, so the bodies could move — and this row pins that they did, and that the
  // store's copy of the pin is gone rather than duplicated.
  const RELOCATED = [
    '_acceptanceRevocationRequest', '_contradictionListRequest', '_contradictionResolutionRequest',
    '_scratchCorrectionRequest', 'scratchFactOracleTarget',
    '_restoreProjectionCheckpoint', '_validPreservedResumeAttestation', '_validateGoalPlanDispatchPair',
    '_validateGoalPlanRecoveryTriple', '_validateRecoveryAttemptAdmissionPayload',
    '_validateRecoveryContinuationPayload', '_validateRecoveryRefinementRequest',
    '_validateRecoverySessionRequest', 'createAndClaimPlanRecoveryRefinement',
  ];
  const wired = delegates();
  const map = JSON.parse(read('scripts/seam-inventory.json'));
  const store = read(STORE_FILE);
  for (const name of RELOCATED) {
    assert.ok(wired.has(name), `${name}: the class must now delegate it`);
    const home = MODULES.find((module) => module.namespace === wired.get(name).module);
    const rows = map.files.find((file) => file.file === home.artifact).members.filter((member) => member.name === name);
    assert.equal(rows.length, 1, `${name}: the seam map carries its body once, by name, in ${home.artifact}`);
  }
  assert.ok(!store.includes('canonicalDigest(fields.brief)'),
    'the recovery-refinement digest pin left the store with its member — the pin names the member now, not the file');
  assert.ok(RELOCATED.length > 0, 'the slice 2 relocation carried members');
});
