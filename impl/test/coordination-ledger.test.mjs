// coordination-ledger.test.mjs — issue #259, slice 4. Pins the module the store's observation bucket
// moved into (impl/src/coordination-ledger.mjs) and the store that now delegates to it. Five claims
// are load-bearing:
//
//   1. CONTEXT-FREE — the module has no `this`, no module-level mutable state, and never imports the
//      store back: every helper is a function of what it is handed, nothing else.
//   2. THE PORT IS EXPLICIT — every moved member keeps a same-name, same-arity delegate on
//      `CoordinationStore`, and the committed seam map, the delegates, the module's exports and the
//      store's imports agree, one delegate per helper.
//   3. THE SAME INPUT GIVES THE SAME OUTPUT — calling every exported helper against two independently
//      built, identically seeded stores produces identical values (or identical refusals), and the
//      helpers handed one collection do not write it.
//   4. THE STORE'S BEHAVIOR IS UNCHANGED — a real CoordinationStore fixture (create, idempotent
//      retry, claim, restart) writes the exact ledger bytes the pre-move store wrote, and replay
//      reconstructs the identical projection.
//   5. THE DISPATCH IS UNCHANGED — a moved member is still reached THROUGH the class, so a store
//      whose `_apply` is patched in place (phase85-coordination-projection-poison-red CP85-P1) still
//      sees the patch. A moved body calls its siblings as `store.<member>(`, never as a bare
//      module-local function.
//
// `CL6` pins the half of this slice that is not the move: the source scans that read a member's own
// text (the fold's event kinds, the scratchpad replay terms, the run-stop sites) now resolve the
// member through `test/seam-member-source.mjs` instead of reading `coordination-store.mjs` — the
// mechanism slice 2 introduced for `frame-economics-red` F1 and `worker-verdict-surface-red` C4/E4,
// applied to the six pins that still keyed on the file.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as coordinationLedger from '../src/coordination-ledger.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { memberSource, memberSpans } from './seam-member-source.mjs';

const require = createRequire(import.meta.url);
const { Lang, parse } = require('@ast-grep/napi');

const MODULE = Object.freeze({
  file: 'src/coordination-ledger.mjs',
  artifact: 'impl/src/coordination-ledger.mjs',
  namespace: 'coordinationLedger',
  exports: coordinationLedger,
});

/** `Function.length`'s rule: parameters before the first default or rest parameter. A destructuring
 * parameter is one parameter, so a member's declared shape and its delegate's are compared on the
 * same measure — the one an external caller sees. */
function lengthOf(parameters) {
  let count = 0;
  for (const parameter of parameters) {
    if (parameter.kind() === 'assignment_pattern' || parameter.kind() === 'rest_pattern') break;
    count += 1;
  }
  return count;
}

const STORE_FILE = 'src/coordination-store.mjs';
const MAP_STORE_FILE = 'impl/src/coordination-store.mjs';
const MAP_MODULE_FILE = 'impl/src/coordination-ledger.mjs';
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

/** The fixture claims 3 and 4 run on: create two tasks, claim the first, restart through the ledger. */
function fixture(clock = () => '2026-09-18T00:00:00.000Z') {
  const root = mkdtempSync(join(tmpdir(), 'baton-coordination-ledger-'));
  const store = new CoordinationStore(root, { clock, repoId: 'repo-ledger' });
  const fields = (id, deps = []) => ({ id, brief: { goal: id }, deps, refines: null, taskType: 'test', reservedWorkerId: `w-${id}` });
  const records = [
    store.createTask(fields('cl-a'), { actor: 'orchestrator', key: 'fixture-a' }),
    store.createTask(fields('cl-b', ['cl-a']), { actor: 'orchestrator', key: 'fixture-b' }),
    store.claimTask('cl-a', 'w-cl-a', 1, { actor: 'orchestrator', key: 'fixture-claim-a' }),
  ];
  return { root, store, records, clock, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** The delegate every moved member kept: `return coordinationLedger.<helper>(<state>, …)`. */
function delegates() {
  const declaration = parseOf(read(STORE_FILE)).findAll({ rule: { kind: 'class_declaration' } })
    .find((node) => node.field('name')?.text() === 'CoordinationStore');
  const wired = new Map();
  for (const member of declaration.field('body').children()) {
    if (member.kind() !== 'method_definition') continue;
    const body = member.field('body');
    const statements = body.children();
    if (statements.length !== 3 || statements[1].kind() !== 'return_statement') continue;
    const call = statements[1].children().find((child) => child.kind() === 'call_expression' || child.kind() === 'yield_expression');
    const invoked = call?.kind() === 'yield_expression' ? call.children().find((child) => child.kind() === 'call_expression') : call;
    const callee = invoked?.field('function');
    if (!callee || callee.kind() !== 'member_expression' || callee.field('object')?.text() !== MODULE.namespace) continue;
    const args = tokens(invoked.field('arguments'));
    wired.set(member.field('name')?.text(), {
      helper: callee.field('property')?.text(),
      state: args[0]?.text() === 'this' ? 'store' : args[0]?.text()?.replace(/^this\./u, ''),
      arity: lengthOf(tokens(member.field('parameters'))),
    });
  }
  return wired;
}

/** Every name the store imports from the moved module, so a dangling import cannot hide. */
function importedFromMovedModule() {
  const found = [];
  for (const statement of parseOf(read(STORE_FILE)).children()) {
    if (statement.kind() !== 'import_statement') continue;
    const source = statement.children().find((child) => child.kind() === 'string')?.text()?.slice(1, -1);
    if (source !== './coordination-ledger.mjs') continue;
    for (const specifier of statement.findAll({ rule: { kind: 'import_specifier' } })) {
      found.push(specifier.field('name')?.text());
    }
  }
  return found;
}

/** Every exported function of the moved module, with its declared parameters. */
function exportedFunctions(text) {
  const found = [];
  for (const statement of parseOf(text).children()) {
    const declaration = statement.field('declaration');
    if (statement.kind() !== 'export_statement' || !['function_declaration', 'generator_function_declaration'].includes(declaration?.kind())) continue;
    found.push({
      name: declaration.field('name')?.text(),
      parameters: tokens(declaration.field('parameters')),
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

test('CL1: the moved module is context-free — no this, no mutable module state, no store import', () => {
  const root = parseOf(read(MODULE.file));
  // The relocated error class is the one place a `this` legitimately lives (its constructor); every
  // moved helper must be a function of its arguments alone.
  const classes = new Set(root.findAll({ rule: { kind: 'class_declaration' } }).map((node) => node.id()));
  const receivers = root.findAll({ rule: { kind: 'this' } })
    .filter((node) => { let parent = node.parent(); while (parent) { if (classes.has(parent.id())) return false; parent = parent.parent(); } return true; })
    .map((node) => node.range().start.line);
  assert.deepEqual(receivers, [], `${MODULE.file}: a moved helper must not read an implicit receiver`);
  const mutable = [];
  const bound = new Set();
  for (const statement of root.children()) {
    const kind = statement.kind();
    if (kind === 'variable_declaration') mutable.push(statement.text().slice(0, 60));
    if (kind === 'lexical_declaration' && statement.children().some((child) => child.kind() === 'let')) mutable.push(statement.text().slice(0, 60));
    if (kind === 'import_statement') {
      const source = statement.children().find((child) => child.kind() === 'string')?.text();
      assert.notEqual(source, "'./coordination-store.mjs'",
        `${MODULE.file}: the store imports this module, so this import would close a cycle`);
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
  assert.deepEqual([...mutable, ...written], [], `${MODULE.file}: module-level state is constant only, never written`);
});

test('CL2: the committed map, the delegates, the exports and the store imports are one bijection', () => {
  const map = JSON.parse(read('scripts/seam-inventory.json'));
  // Identity is (name, ordinal), and a name may itself begin with `#`: the separator is a NUL, the
  // same one the inventory's own identity uses.
  const moved = new Map();
  for (const member of map.files.find((file) => file.file === MAP_STORE_FILE).members) {
    if (member.evidence.some((entry) => entry.endsWith(':ledger_port'))) moved.set(`${member.name}\u0000${member.ordinal}`, member.name);
  }
  assert.ok(moved.size > 0, 'the map must show the observation bucket — every store member whose body left');
  const movedNames = new Set(moved.values());
  const wired = delegates();
  const orphans = [...moved.keys()].filter((identity) => !wired.has(identity.split('\u0000')[0]));
  assert.deepEqual(orphans, [], 'every mapped move must still be a delegate on the class');
  for (const [member, delegate] of wired) {
    assert.ok(movedNames.has(member), `${member}: the delegate must carry the ledger_port evidence`);
    assert.ok(Object.hasOwn(MODULE.exports, delegate.helper), `${member}: ${MODULE.namespace}.${delegate.helper} must be exported`);
  }
  // The module also exports the relocated primitives (board bounds, knowledge vocabularies, digest
  // helpers) the store imports back, so the claim is: N distinct delegate-reached helpers, one
  // delegate each — and every name the store imports from the module exists.
  const helpers = [...wired.values()].map((delegate) => delegate.helper);
  assert.equal(new Set(helpers).size, helpers.length, 'one delegate per ledger helper');
  assert.equal(helpers.length, moved.size, 'the port carries one helper per moved member');
  const moduleRows = map.files.find((file) => file.file === MAP_MODULE_FILE).members;
  for (const name of new Set(helpers)) {
    assert.equal(moduleRows.filter((member) => member.name === name).length, 1,
      `${name}: the seam map carries the body once, by name, in ${MAP_MODULE_FILE}`);
  }
  for (const imported of importedFromMovedModule()) {
    assert.ok(Object.hasOwn(MODULE.exports, imported), `${STORE_FILE}: imports ${imported}, which the module must export`);
  }
});

test('CL3: the same input gives the same output, and a handed slice is never written', () => {
  const wired = delegates();
  const failures = [];
  const declared = new Map(exportedFunctions(read(MODULE.file)).map((entry) => [entry.name, entry]));
  for (const [member, delegate] of wired) {
    const entry = declared.get(delegate.helper);
    assert.ok(entry, `${member}: ${delegate.helper} must be an exported function`);
    const { name, parameters, declaration } = entry;
    const reads = freeIdentifiers(declaration);
    const firstParameter = parameters[0]?.kind() === 'identifier' ? parameters[0].text() : null;
    const declaresStore = firstParameter === 'store';
    const declaresSlice = firstParameter !== null && firstParameter !== 'store'
      && (firstParameter === 'state' || firstParameter === delegate.state);
    assert.ok(!declaresSlice || reads.has(firstParameter),
      `${MODULE.file}: ${name} (from ${member}) must read the ${firstParameter} slice it declares`);
    assert.ok(!(declaresSlice && reads.has('store')),
      `${MODULE.file}: ${name} (from ${member}) takes one slice and must not reach for the store as well`);
    const stateParameter = declaresStore ? 'store' : (declaresSlice ? 'state' : null);
    const sliceField = declaresSlice ? delegate.state : null;
    const first = fixture();
    const second = fixture();
    try {
      const argsOf = (built) => {
        if (stateParameter === null) return [];
        const state = stateParameter === 'store' ? built.store : built.store[sliceField];
        return [state, ...parameters.slice(1).map(() => undefined)];
      };
      const before = sliceField === null ? null : snapshotOf(first.store[sliceField]);
      const fromFirst = outcome(MODULE.exports[name], argsOf(first), first.root);
      const fromSecond = outcome(MODULE.exports[name], argsOf(second), second.root);
      if (fromFirst !== fromSecond) failures.push(`${MODULE.file}: ${name} — ${fromFirst} vs ${fromSecond}`);
      if (before !== null && snapshotOf(first.store[sliceField]) !== before) {
        failures.push(`${MODULE.file}: ${name} wrote the ${sliceField} slice it was handed`);
      }
    } finally {
      first.cleanup();
      second.cleanup();
    }
  }
  // The relocated primitives are helpers too: no state, no variance, two calls must agree.
  const moved = new Set([...wired.values()].map((delegate) => delegate.helper));
  for (const [name, entry] of declared) {
    if (moved.has(name) || typeof MODULE.exports[name] !== 'function' || /^[A-Z]/u.test(name)) continue;
    const once = outcome(MODULE.exports[name], entry.parameters.map(() => undefined), '/');
    const twice = outcome(MODULE.exports[name], entry.parameters.map(() => undefined), '/');
    if (once !== twice) failures.push(`${MODULE.file}: ${name} — ${once} vs ${twice}`);
  }
  assert.deepEqual(failures, [], 'a moved helper must be a function of the state it is handed');
});

test('CL4: the store reaches every moved member through its own delegate, with its own arity', () => {
  const wired = delegates();
  assert.ok(wired.size > 0, 'the ledger port carries delegates');
  for (const [name, delegate] of wired) {
    assert.equal(delegate.helper, name === '#knowledgeRecallPreview' ? 'knowledgeRecallPreview' : name,
      `${name}: the delegate names the member's own body`);
    if (name.startsWith('#')) continue;
    const descriptor = Object.getOwnPropertyDescriptor(CoordinationStore.prototype, name)
      ?? Object.getOwnPropertyDescriptor(CoordinationStore, name);
    assert.ok(descriptor, `${name}: the store must still answer on ${name}`);
    assert.equal(descriptor.value?.length ?? descriptor.get?.length, delegate.arity,
      `${name}: the signature must not move with the body`);
  }
});

test('CL5: the store keeps its exact behavior across the move, and a moved member is still dispatched through the class', () => {
  const { root, store, records, clock, cleanup } = fixture();
  try {
    assert.deepEqual(records.map((record) => record.event.seq), [1, 2, 3]);
    const retry = store.createTask(
      { id: 'cl-b-changed', brief: { goal: 'changed' }, deps: ['cl-a'], refines: null, taskType: 'test', reservedWorkerId: 'w-cl-b' },
      { actor: 'orchestrator', key: 'fixture-b' },
    );
    assert.deepEqual([retry.result, retry.event.seq, retry.event.kind], ['idempotent', 2, 'task.created']);
    assert.deepEqual(store.task('cl-a'), {
      id: 'cl-a', brief: { goal: 'cl-a' }, deps: [], refines: null, taskType: 'test', reservedWorkerId: 'w-cl-a',
      runId: null, status: 'working', assignee: 'w-cl-a', version: 2, createdEvent: 1, claimedEvent: 3,
      terminalEvent: null, artifactIds: [],
    });
    const ledger = readFileSync(join(root, 'events.jsonl'));
    assert.equal(createHash('sha256').update(ledger).digest('hex'),
      '5ca071974bfd257f484103ab482443d9e5e7994142f10f405104fc2e82c9de72',
      'the durable bytes are the ones the pre-move store wrote for the same fixture');
    const before = createHash('sha256').update(JSON.stringify(store.snapshot())).digest('hex');
    // Issue #66 (D3): snapshot().knowledge gained the folded `doubts` projection, so the
    // golden moves with the projection — the fold still builds exactly what the live class
    // builds, and replay reconstructs the identical bytes (asserted below).
    assert.equal(before, '7f3c4a340e08aab4060b5ff3eb5b86e098ce905d53be91bd8cf705a6e2dd567b',
      'the projection the moved fold builds is the one the pre-move store built');
    const restarted = new CoordinationStore(root, { clock });
    assert.equal(restarted.healthCheck(), true);
    assert.equal(createHash('sha256').update(JSON.stringify(restarted.snapshot())).digest('hex'), before,
      'replay reconstructs the identical projection');
  } finally {
    cleanup();
  }

  // The moved member is reached THROUGH the class: a store whose `_apply` is patched in place sees
  // the patch, exactly as it did when the body lived on the class (CP85-P1's shape). A moved body
  // that called its siblings as bare module-local functions would bypass this patch.
  const other = fixture(clock);
  try {
    let patched = 0;
    const apply = other.store._apply.bind(other.store);
    other.store._apply = (event) => { patched += 1; return apply(event); };
    const record = other.store.createTask(
      { id: 'cl-c', brief: { goal: 'cl-c' }, deps: [], refines: null, taskType: 'test', reservedWorkerId: 'w-cl-c' },
      { actor: 'orchestrator', key: 'fixture-c' },
    );
    assert.equal(record.result, 'created');
    assert.ok(patched > 0, 'the write path still dispatches `_apply` through the store');
  } finally {
    other.cleanup();
  }
});

test('CL6: the pins that read a moved member\'s text resolve it through the live seam map', () => {
  // `memberSource` reads the member wherever the split put it — the class delegate and the module
  // body together — and normalizes a module receiver back to `this.`, so a scan keyed to the member
  // reads the same source it read before the move.
  const apply = memberSource('_apply');
  assert.deepEqual(memberSpans('_apply').map((span) => span.file).sort(), ['coordination-ledger.mjs', 'coordination-store.mjs'],
    '_apply is a delegate on the class and a body in the module');
  assert.ok(apply.includes('repl.manifest_admitted'),
    'the fold source the repl kind-inventory pin reads is reachable by member name');
  assert.ok(apply.includes('unsupported_event_kind'),
    'and carries the fold tripwire the pin names');
  assert.ok(apply.includes('this._') && !apply.includes('store._'),
    'a module target\'s receiver is normalized back to `this.`, which is the spelling a scan expects');
  const scratch = memberSource('writeScratchpad');
  assert.ok(scratch.includes("'scratchpad_partition_exhausted'"),
    'the worker-partition refusal is read off the member, wherever it lives');
  assert.ok(scratch.includes('prior.payload?.runId !=='),
    'and so are the replay terms the P-A4 pin names');
  assert.equal(memberSource('no-such-member'), '', 'a name that is not a member resolves to nothing, never to a stray file');

  // The scans themselves name the member now. The store file no longer carries these member texts,
  // so a scan that still read the file would silently read nothing.
  const store = read(STORE_FILE);
  assert.equal(store.includes('scratchpad_partition_exhausted'), false,
    'the ledger bodies left the store file: a file-keyed scan would now miss them');
  for (const file of [
    'test/repl1-kind-inventory-red.test.mjs',
    'test/scratchpad-33-red.test.mjs',
    'test/scratchpad-write-red.test.mjs',
    'test/issue366-run-stop-replay-ceiling.test.mjs',
  ]) {
    assert.ok(read(file).includes('memberSource('), `${file}: a moved member's text is read by name`);
  }
  for (const file of ['test/issue391-store-goal-plan-pages.test.mjs', 'test/orchestrator-plan-object-red.test.mjs']) {
    assert.ok(read(file).includes('coordination-ledger.mjs'), `${file}: the module list the scan walks names the ledger`);
  }
});
