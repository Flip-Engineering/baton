// Regressions for the Bend2 frontend producer adapter and the derived-frontend patch spec.
//
// The adapter is driven by a synthetic event stream that follows the patched frontend's contract
// (a test double for the producer, not a parser), while every span is resolved through the real
// source-binding functions over real bytes. Nothing in this file imports a frontend, and no
// execution of the frontend is claimed. Authored for later remote execution under exact Root
// admission:
//
//   node --test bend2/context/bend2/frontend-adapter.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFrontendAdapter } from './frontend-adapter.mjs';
import { HOOK_KINDS, HOOK_PHASES, validateHookEvent } from './frontend-hook-events.mjs';
import { HOOK_OPERATIONS, UPSTREAM_INPUTS, UPSTREAM_PIN, applyHookOperations, deriveHookedSource, verifyHookAnchors } from './frontend-hooks.mjs';

const bytesOf = (text) => Buffer.from(text, 'utf8');

function adapterWith(files) {
  const read = (identity) => {
    const entry = files[identity];
    if (entry === undefined) return { refuse: 'not in the captured closure' };
    return { identity, bytes: typeof entry === 'string' ? bytesOf(entry) : entry };
  };
  return createFrontendAdapter({ acquisition: { read }, captureOnly: true });
}

function loadFile(adapter, file, namespace = '') {
  adapter.sink.emit({ kind: HOOK_KINDS.loadStart, phase: HOOK_PHASES.load, file, namespace });
}

function completeFile(adapter, file, orderLength) {
  adapter.sink.emit({ kind: HOOK_KINDS.loadComplete, phase: HOOK_PHASES.load, file, orderLength });
}

function declare(adapter, file, name, span, form = 'def') {
  adapter.sink.emit({
    kind: HOOK_KINDS.declaration,
    phase: HOOK_PHASES.parse,
    file,
    form,
    name,
    qualified: name,
    namespace: '',
    unsafe: false,
    span,
  });
}

test('identical text in two files keeps the reported file identity', () => {
  const text = 'def value() -> U32:\n  1\n';
  const adapter = adapterWith({ '/work/a.bend': text, '/work/b.bend': text });
  adapter.beginQuery({ identity: '/work/a.bend' });
  loadFile(adapter, '/work/a.bend');
  completeFile(adapter, '/work/a.bend', 1);
  declare(adapter, '/work/a.bend', 'value', { src: text, beg: 0, end: 3 });
  loadFile(adapter, '/work/b.bend');
  completeFile(adapter, '/work/b.bend', 1);
  declare(adapter, '/work/b.bend', 'value', { src: text, beg: 0, end: 3 });
  adapter.endQuery();

  const session = adapter.report().sessions[0];
  assert.equal(session.declarations.length, 2);
  assert.equal(session.declarations[0].span.identity, '/work/a.bend');
  assert.equal(session.declarations[1].span.identity, '/work/b.bend');
  assert.equal(session.declarations[0].span.digest, session.declarations[1].span.digest, 'equal bytes share a digest');
  assert.notEqual(session.declarations[0].span.identity, session.declarations[1].span.identity);
  assert.deepEqual(session.declarations[0].span.byteRange, { start: 0, end: 3 });
});

test('import-line blanking maps kept text and refuses spans across the removal', () => {
  const text = 'aaa\nimport Base\nbody\n';
  const transformed = 'aaa\n\nbody\n';
  const adapter = adapterWith({ '/work/imports.bend': text });
  adapter.beginQuery({ identity: '/work/imports.bend' });
  loadFile(adapter, '/work/imports.bend');
  adapter.sink.emit({
    kind: HOOK_KINDS.importLine,
    phase: HOOK_PHASES.load,
    file: '/work/imports.bend',
    namespace: '',
    alias: null,
    specifier: 'Base',
    removedFrom: 4,
    removedTo: 15,
    removedText: 'import Base',
    specifierSpan: null,
  });
  completeFile(adapter, '/work/imports.bend', 2);
  // The kept segments are original [0,4) and [15,21); the transformed string is 'aaa\n\nbody\n'.
  declare(adapter, '/work/imports.bend', 'body', { src: transformed, beg: 5, end: 9 });
  declare(adapter, '/work/imports.bend', 'across', { src: transformed, beg: 3, end: 6 });
  adapter.endQuery();

  const session = adapter.report().sessions[0];
  assert.deepEqual(session.imports[0].removed, { from: 4, to: 15 });
  assert.equal(session.declarations[0].span.status, 'mapped');
  assert.deepEqual(session.declarations[0].span.original.start, { index: 16, line: 2, column: 1 });
  assert.deepEqual(session.declarations[0].span.original.end, { index: 20, line: 2, column: 5 });
  assert.equal(session.declarations[0].span.text, 'body');
  assert.equal(session.declarations[1].span.status, 'unavailable');
  assert.equal(session.declarations[1].span.reason, 'spansOmitted');
});

test('a changed closure is acquired again and never reuses a stale capture', () => {
  const files = { '/work/dep.bend': 'def value() -> U32:\n  1\n' };
  const adapter = adapterWith(files);
  adapter.beginQuery({ identity: '/work/dep.bend' });
  loadFile(adapter, '/work/dep.bend');
  completeFile(adapter, '/work/dep.bend', 1);
  adapter.endQuery();
  const first = adapter.report().sessions[0];

  files['/work/dep.bend'] = 'def value() -> String:\n  "x"\n';
  adapter.beginQuery({ identity: '/work/dep.bend' });
  loadFile(adapter, '/work/dep.bend');
  completeFile(adapter, '/work/dep.bend', 1);
  adapter.endQuery();
  const second = adapter.report().sessions[1];

  assert.notEqual(first.files[0].digest, second.files[0].digest);
  assert.notEqual(first.files[0].byteLength, second.files[0].byteLength);
});

test('an uncaptured dependency is refused without a host read', () => {
  const adapter = adapterWith({ '/work/root.bend': 'import ./other.bend as O\n' });
  adapter.beginQuery({ identity: '/work/root.bend' });
  loadFile(adapter, '/work/root.bend');
  assert.equal(adapter.sink.readSource('/work/other.bend'), undefined);
  const session = adapter.report().sessions[0];
  assert.equal(adapter.counters.uncapturedDependencies, 1);
  assert.ok(session.limitations.some((entry) => entry.code === 'uncapturedDependency'));
  assert.equal(adapter.sink.captureOnly, true, 'capture-only mode makes the patched loader refuse the missing file');
});

test('a throwing acquisition callback is a counted failure, not a frontend diagnostic', () => {
  const adapter = createFrontendAdapter({
    acquisition: {
      read() {
        throw new Error('closure reader unavailable');
      },
    },
  });
  adapter.beginQuery({ identity: '/work/broken.bend' });
  loadFile(adapter, '/work/broken.bend');
  const session = adapter.report().sessions[0];
  assert.equal(adapter.counters.acquisitionFailures, 1);
  assert.equal(adapter.counters.adapterFailures, 0);
  assert.equal(session.diagnostics.length, 0);
  assert.ok(session.limitations.some((entry) => entry.code === 'acquisitionFailed'));
});

test('a parsed reference keeps its actual branch and never claims resolution', () => {
  const text = 'def use(other) -> U32:\n  other\n';
  const adapter = adapterWith({ '/work/refs.bend': text });
  adapter.beginQuery({ identity: '/work/refs.bend' });
  loadFile(adapter, '/work/refs.bend');
  completeFile(adapter, '/work/refs.bend', 1);
  adapter.sink.emit({
    kind: HOOK_KINDS.reference,
    phase: HOOK_PHASES.parse,
    file: '/work/refs.bend',
    name: 'other',
    branch: 'bound',
    binderIndex: 1,
    qualified: null,
    namespace: '',
    span: { src: text, beg: 22, end: 27 },
  });
  adapter.sink.emit({
    kind: HOOK_KINDS.reference,
    phase: HOOK_PHASES.parse,
    file: '/work/refs.bend',
    name: 'missing',
    branch: 'unboundFallback',
    frameIndex: 0,
    qualified: 'missing',
    namespace: '',
    span: { src: text, beg: 29, end: 36 },
  });
  adapter.endQuery();

  const references = adapter.report().sessions[0].references;
  assert.equal(references.length, 2);
  assert.equal(references[0].branch, 'bound');
  assert.equal(references[0].resolution, 'binderLookup');
  assert.equal(references[0].binderIndex, 1);
  assert.equal(references[1].branch, 'unboundFallback');
  assert.equal(references[1].resolution, 'fallbackFrame');
  assert.equal(references[1].frameIndex, 0);
  for (const reference of references) {
    assert.equal(reference.phase, 'parse');
    assert.ok(reference.scope.namespace !== undefined);
  }
});

test('a failed checker records the phase and makes no proof claim', () => {
  const trace = 'def bad() -> U32:\n  true\n';
  const adapter = adapterWith({ '/work/bad.bend': trace });
  adapter.beginQuery({ identity: '/work/bad.bend' });
  loadFile(adapter, '/work/bad.bend');
  completeFile(adapter, '/work/bad.bend', 1);
  adapter.sink.emit({ kind: HOOK_KINDS.checkEntry, phase: HOOK_PHASES.check, definition: 'bad' });
  adapter.sink.emit({ kind: HOOK_KINDS.diagnostic, phase: HOOK_PHASES.check, form: 'err', file: null, condition: 'U32', observed: 'true', definition: 'bad', note: null, span: { src: trace, beg: 16, end: 20 } });
  adapter.sink.emit({ kind: HOOK_KINDS.checkFailure, phase: HOOK_PHASES.check, definition: 'bad', thrownDiagnostic: true });
  adapter.endQuery();

  const session = adapter.report().sessions[0];
  assert.deepEqual(session.phases.map((entry) => entry.kind), ['checkEntry', 'checkFailure']);
  assert.equal(session.diagnostics[0].condition, 'U32');
  assert.equal(session.diagnostics[0].form, 'err');
  assert.ok(session.limitations.some((entry) => entry.code === 'proofStatusUnavailable'));
});

test('completion gates are recorded as gate observations', () => {
  const adapter = adapterWith({ '/work/proof.bend': 'def p(): {1 == 1 : U32}\n  {==}\n' });
  adapter.beginQuery({ identity: '/work/proof.bend' });
  adapter.sink.emit({ kind: HOOK_KINDS.completionGate, phase: HOOK_PHASES.completion, gate: 'ownership', checkSet: 'SYNTH', started: true });
  adapter.sink.emit({ kind: HOOK_KINDS.completionGate, phase: HOOK_PHASES.completion, gate: 'ownership', checkSet: 'SYNTH', completed: true });
  adapter.sink.emit({ kind: HOOK_KINDS.diagnostic, phase: HOOK_PHASES.completion, form: 'text', file: null, text: 'Error: 1 TODO found.', definition: null, span: null });
  adapter.sink.emit({ kind: HOOK_KINDS.completionGate, phase: HOOK_PHASES.completion, gate: 'holes', started: true });
  adapter.endQuery();

  const session = adapter.report().sessions[0];
  const gates = session.phases.filter((entry) => entry.kind === HOOK_KINDS.completionGate);
  assert.equal(gates.length, 3);
  assert.equal(gates[1].completed, true);
  assert.equal(gates[1].checkSet, 'SYNTH');
  assert.equal(session.diagnostics[0].form, 'text');
  assert.equal(session.diagnostics[0].text, 'Error: 1 TODO found.');
});

test('a missing span stays unavailable and an invalid event is ignored', () => {
  const adapter = adapterWith({ '/work/spans.bend': 'def a() -> U32:\n  1\n' });
  adapter.beginQuery({ identity: '/work/spans.bend' });
  loadFile(adapter, '/work/spans.bend');
  completeFile(adapter, '/work/spans.bend', 1);
  declare(adapter, '/work/spans.bend', 'a', null);
  adapter.sink.emit({ kind: HOOK_KINDS.reference, phase: HOOK_PHASES.parse, name: 'x', branch: 'bound' });
  adapter.sink.emit({ kind: 'unknownKind', phase: HOOK_PHASES.parse });
  adapter.endQuery();

  const session = adapter.report().sessions[0];
  assert.equal(session.declarations[0].span.status, 'unavailable');
  assert.equal(session.declarations[0].span.reason, 'missingSpan');
  assert.equal(session.references.length, 0);
  assert.equal(adapter.counters.invalidEvents, 2);
  assert.equal(session.limitations.filter((entry) => entry.code === 'invalidEvent').length, 2);
});

test('events outside a query session are not attributed', () => {
  const adapter = adapterWith({ '/work/idle.bend': 'def a() -> U32:\n  1\n' });
  adapter.sink.emit({ kind: HOOK_KINDS.loadStart, phase: HOOK_PHASES.load, file: '/work/idle.bend', namespace: '' });
  adapter.sink.emit({ kind: HOOK_KINDS.validationStart, phase: HOOK_PHASES.validate });
  assert.equal(adapter.counters.outsideQuery, 2);
  assert.equal(adapter.report().sessions.length, 0);
});

test('the event contract rejects malformed events and accepts the real shapes', () => {
  assert.equal(validateHookEvent({ kind: HOOK_KINDS.loadStart, phase: HOOK_PHASES.load, file: '/a.bend', namespace: '' }).ok, true);
  assert.equal(validateHookEvent({ kind: HOOK_KINDS.reference, phase: HOOK_PHASES.parse, branch: 'bound', name: 'x', file: '/a.bend', span: null }).reason, 'binderIndexMissing');
  assert.equal(validateHookEvent({ kind: HOOK_KINDS.declaration, phase: HOOK_PHASES.parse, form: 'law', name: 'l', qualified: 'l', file: null, span: null }).ok, true);
  assert.equal(validateHookEvent({ kind: HOOK_KINDS.diagnostic, phase: HOOK_PHASES.check, form: 'text', file: null, text: 'x', span: null }).ok, true);
  assert.equal(validateHookEvent({ kind: HOOK_KINDS.completionGate, phase: HOOK_PHASES.completion, gate: 'nope' }).reason, 'completionGateUnsupported');
  assert.equal(validateHookEvent({ kind: HOOK_KINDS.importLine, phase: HOOK_PHASES.load, file: '/a.bend', removedFrom: 5, removedTo: 2, removedText: 'x' }).reason, 'removedRangeInvalid');
});

test('multiple imports finalize one view and resolve spans emitted before completion', () => {
  const text = 'import Base\nimport ./d.bend as D\nvalue\n';
  const captureLength = text.length;
  const adapter = adapterWith({ '/work/multi.bend': text });
  adapter.beginQuery({ identity: '/work/multi.bend' });
  loadFile(adapter, '/work/multi.bend');
  // Two removals: 'import Base' at [0,11) and 'import ./d.bend as D' at [12,31).
  adapter.sink.emit({ kind: HOOK_KINDS.importLine, phase: HOOK_PHASES.load, file: '/work/multi.bend', namespace: '', alias: null, specifier: 'Base', removedFrom: 0, removedTo: 11, removedText: 'import Base', specifierSpan: { src: text, beg: 7, end: 11 } });
  adapter.sink.emit({ kind: HOOK_KINDS.importLine, phase: HOOK_PHASES.load, file: '/work/multi.bend', namespace: '', alias: 'D', specifier: './d.bend', removedFrom: 12, removedTo: 31, removedText: 'import ./d.bend as D', specifierSpan: { src: text, beg: 19, end: 27 } });
  // The declaration precedes loadComplete, exactly as the patched frontend orders it; its span is in
  // the transformed text '\n\nvalue\n' where 'value' starts at index 2.
  declare(adapter, '/work/multi.bend', 'value', { src: '\n\nvalue\n', beg: 2, end: 7 });
  completeFile(adapter, '/work/multi.bend', 1);
  adapter.endQuery();

  const session = adapter.report().sessions[0];
  assert.equal(session.imports.length, 2);
  // The loader span belongs to the original text, so it maps even though that text left the parse view.
  assert.equal(session.imports[1].specifierSpan.status, 'mapped');
  assert.deepEqual(session.imports[1].specifierSpan.byteRange, { start: 19, end: 27 });
  // The declaration span was deferred until the view was finalized after both removals.
  assert.equal(session.declarations[0].span.status, 'mapped');
  assert.equal(session.declarations[0].span.original.start.index, captureLength - 'value\n'.length);
  assert.equal(captureLength > 31, true);
  assert.equal(session.completeness, 'complete');
});

test('an import attempt and a closure-supplied identity are recorded without a host check', () => {
  const text = 'import ./dep.bend as P\n';
  const adapter = createFrontendAdapter({
    acquisition: {
      resolve: (identity) => ({ exists: identity === '/work/dep.bend', identity }),
      read: (identity) => (identity === '/work/dep.bend' ? { identity, bytes: bytesOf('def d() -> U32:\n  1\n') } : { refuse: 'not in closure' }),
    },
  });
  adapter.beginQuery({ identity: '/work/root.bend' });
  adapter.sink.emit({ kind: HOOK_KINDS.importAttempt, phase: HOOK_PHASES.load, file: '/work/dep.bend', identity: '/work/dep.bend', exists: true, captured: true });
  assert.deepEqual(adapter.sink.resolveSource('/work/dep.bend'), { exists: true, identity: '/work/dep.bend' });
  adapter.sink.emit({ kind: HOOK_KINDS.importAttempt, phase: HOOK_PHASES.load, file: '/work/other.bend', identity: '/work/other.bend', exists: false, captured: true });
  assert.deepEqual(adapter.sink.resolveSource('/work/other.bend'), { exists: false, identity: '/work/other.bend' });
  adapter.sink.sourceFailure('/work/other.bend', 'missingInClosure');
  adapter.endQuery();

  const session = adapter.report().sessions[0];
  assert.equal(session.attempts.length, 2);
  assert.equal(adapter.counters.acquisitionFailures, 1);
  assert.ok(session.limitations.some((entry) => entry.code === 'acquisitionFailure'));
  assert.equal(session.completeness, 'incomplete');
  assert.ok(session.incompleteness.includes('acquisitionFailure'));
  assert.equal(text.length > 0, true);
});

test('an overlapping invocation and an outside read are refused', () => {
  const adapter = adapterWith({ '/work/one.bend': 'def a() -> U32:\n  1\n' });
  assert.equal(adapter.sink.readSource('/work/one.bend'), undefined);
  assert.equal(adapter.counters.outsideQueryReads, 1);
  const first = adapter.beginQuery({ identity: '/work/one.bend' });
  assert.equal(first.status, 'started');
  const second = adapter.beginQuery({ identity: '/work/two.bend' });
  assert.equal(second.status, 'rejected');
  assert.equal(second.reason, 'queryActive');
  assert.equal(adapter.counters.overlappingQueries, 1);
  loadFile(adapter, '/work/one.bend');
  completeFile(adapter, '/work/one.bend', 1);
  const session = adapter.endQuery();
  assert.equal(session.token, first.token);
  assert.ok(session.incompleteness.includes('outsideQueryRead'));
  assert.ok(session.incompleteness.includes('overlappingQuery'));
});

test('declared and inferred type observations keep their status and quantities', () => {
  const adapter = adapterWith({ '/work/types.bend': 'def id(+x: U32) -> U32:\n  x\n' });
  adapter.beginQuery({ identity: '/work/types.bend' });
  loadFile(adapter, '/work/types.bend');
  completeFile(adapter, '/work/types.bend', 1);
  adapter.sink.emit({ kind: HOOK_KINDS.typeObservation, phase: HOOK_PHASES.parse, status: 'declared', qualified: 'id', file: '/work/types.bend', text: 'U32 -> U32', quantities: [{ quant: '2', name: 'x' }], span: null });
  adapter.sink.emit({ kind: HOOK_KINDS.typeObservation, phase: HOOK_PHASES.parse, status: 'inferred', qualified: 'id', file: '/work/types.bend', text: 'U32', quantities: [], span: null });
  adapter.endQuery();

  const types = adapter.report().sessions[0].types;
  assert.deepEqual(types.map((entry) => entry.status), ['declared', 'inferred']);
  assert.deepEqual(types[0].quantities, [{ quant: '2', name: 'x' }]);
  assert.equal(types[0].text, 'U32 -> U32');
});

test('the invocation entry rejects a frontend that lacks the required exports', async () => {
  const { runFrontendInvocation } = await import('./frontend-invocation.mjs');
  const adapter = adapterWith({ '/work/root.bend': 'def a() -> U32:\n  1\n' });
  const rejected = await runFrontendInvocation({ frontend: {}, adapter, root: '/work/root.bend' });
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.reason, 'frontendExportMissing');
  const missingAdapter = await runFrontendInvocation({ frontend: null, adapter, root: '/work/root.bend' });
  assert.equal(missingAdapter.reason, 'frontendMissing');
});

test('the patch spec verifies the input identity and applies anchors mechanically', () => {
  const registryAnchor = HOOK_OPERATIONS.bend[0].anchor;
  assert.equal(verifyHookAnchors({ target: 'bend', text: registryAnchor }).counts[0].count, 1);

  // A synthetic input cannot stand in for the pinned upstream file: the identity check refuses it.
  const refused = deriveHookedSource({ target: 'bend', text: registryAnchor });
  assert.equal(refused.status, 'unavailable');
  assert.equal(refused.reason, 'inputIdentityMismatch');
  assert.equal(refused.detail.expected, UPSTREAM_INPUTS.bend.sha256);
  assert.notEqual(refused.detail.observed, refused.detail.expected);

  // Anchor mechanics are exercised separately from the identity check.
  const missing = applyHookOperations({ target: 'bend', text: registryAnchor });
  assert.equal(missing.reason, 'anchorMissing');
  assert.equal(missing.detail.id, HOOK_OPERATIONS.bend[1].id);

  const ambiguous = applyHookOperations({ target: 'bend', text: `${registryAnchor}\n${registryAnchor}\n` });
  assert.equal(ambiguous.reason, 'anchorAmbiguous');
  assert.equal(ambiguous.detail.count, 2);

  assert.equal(applyHookOperations({ target: 'comp', text: 'x' }).reason, 'targetUnsupported');
});
