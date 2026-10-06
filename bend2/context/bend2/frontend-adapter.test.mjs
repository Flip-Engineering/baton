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
import { HOOK_OPERATIONS, UPSTREAM_INPUTS, UPSTREAM_PIN, deriveHookedSource, verifyHookAnchors } from './frontend-hooks.mjs';

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
  assert.equal(references[0].binderIndex, 1);
  assert.equal(references[1].branch, 'unboundFallback');
  assert.equal(references[1].frameIndex, 0);
  for (const reference of references) {
    assert.equal(reference.resolved, false);
    assert.equal(reference.basis, 'parseOutcome');
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

test('the patch spec binds the upstream inputs and refuses a missing or ambiguous anchor', () => {
  assert.equal(UPSTREAM_INPUTS.bend.sha256, '93c2a43deeb82c15683e4e25bbc5dec5ac3edff9f54e09acc0975e290fcaeb85');
  assert.equal(UPSTREAM_INPUTS.main.sha256, '92dcdb49e82fd59443e3aea10784f7dcf03a93f5a21920666543098b657b6b1e');
  assert.equal(UPSTREAM_INPUTS.comp.sha256, 'ad8b82137e5decf588d507d008cb8ccf24bd0b94043de8bd6e048d0faedcf959');
  assert.equal(UPSTREAM_PIN, 'a49524265bdfa5753a4bf38e25f0574a705dd868');
  assert.equal(HOOK_OPERATIONS.bend.length > 0, true);
  assert.equal(HOOK_OPERATIONS.main.length > 0, true);

  const registryAnchor = HOOK_OPERATIONS.bend[0].anchor;
  assert.equal(verifyHookAnchors({ target: 'bend', text: registryAnchor }).counts[0].count, 1);

  const missing = deriveHookedSource({ target: 'bend', text: registryAnchor });
  assert.equal(missing.status, 'unavailable');
  assert.equal(missing.reason, 'anchorMissing');
  assert.equal(missing.detail.id, HOOK_OPERATIONS.bend[1].id);

  const ambiguous = deriveHookedSource({ target: 'bend', text: `${registryAnchor}\n${registryAnchor}\n` });
  assert.equal(ambiguous.reason, 'anchorAmbiguous');
  assert.equal(ambiguous.detail.count, 2);

  const unsupported = deriveHookedSource({ target: 'comp', text: 'x' });
  assert.equal(unsupported.reason, 'targetUnsupported');
});
