// Regressions for the Bend2 frontend producer adapter, the invocation entry and the patch spec.
//
// The adapter is driven by an explicit event stream that follows the patched frontend's contract (a
// test double for the producer, not a parser), while every span is resolved through the real
// source-binding functions over real bytes. The invocation entry is driven by a frontend double that
// records the calls it receives, so phase order, dependency requirements and cleanup are asserted
// rather than assumed. Nothing in this file imports a frontend, and no execution of a frontend is
// claimed. The real derived-frontend run is frontend-invocation.harness.mjs.
//
//   node --test bend2/context/bend2/frontend-adapter.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFrontendAdapter } from './frontend-adapter.mjs';
import { HOOK_KINDS, HOOK_PHASES } from './frontend-hook-events.mjs';
import { applyHookOperations, deriveHookedSource } from './frontend-hooks.mjs';

const bytesOf = (text) => Buffer.from(text, 'utf8');

function adapterWith(files, options = {}) {
  const reads = [];
  const acquisition = {
    read(identity) {
      reads.push(identity);
      const entry = files[identity];
      if (entry === undefined) return { refuse: 'not in the captured closure' };
      return { identity, bytes: typeof entry === 'string' ? bytesOf(entry) : entry };
    },
    resolve(identity) {
      return { exists: files[identity] !== undefined, identity };
    },
  };
  if (options.baseBend !== undefined) acquisition.baseBend = options.baseBend;
  const adapter = createFrontendAdapter({ acquisition, captureOnly: options.captureOnly ?? true });
  adapter.reads = reads;
  return adapter;
}

function start(adapter, identity) {
  const started = adapter.beginQuery({ identity });
  assert.equal(started.status, 'started');
  return started.token;
}

// The owner token is the invocation identity every event and sink call carries.
function emit(adapter, owner, event) {
  adapter.sink.emit({ owner, ...event }, owner);
}

function loadFile(adapter, owner, file, namespace = '') {
  emit(adapter, owner, { kind: HOOK_KINDS.loadStart, phase: HOOK_PHASES.load, file, namespace });
}

function declare(adapter, owner, file, name, span, form = 'def') {
  emit(adapter, owner, {
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

// The pre-parse boundary: every import removal is already emitted and parsedText is the exact string
// the loader hands to the parser.
function preParse(adapter, owner, file, parsedText, aliases = {}) {
  emit(adapter, owner, { kind: HOOK_KINDS.importAliases, phase: HOOK_PHASES.load, file, namespace: '', aliases, parsedText });
}

function loadComplete(adapter, owner, file, orderLength) {
  emit(adapter, owner, { kind: HOOK_KINDS.loadComplete, phase: HOOK_PHASES.load, file, orderLength });
}

function importLine(adapter, owner, file, removedFrom, removedTo, removedText) {
  emit(adapter, owner, {
    kind: HOOK_KINDS.importLine,
    phase: HOOK_PHASES.load,
    file,
    namespace: '',
    alias: null,
    specifier: removedText,
    removedFrom,
    removedTo,
    removedText,
    specifierSpan: null,
  });
}

test('two imports finalize one view at the pre-parse boundary and resolve earlier spans', () => {
  const text = 'import Base\nimport ./d.bend as D\nvalue\n';
  const transformed = '\n\nvalue\n';
  const adapter = adapterWith({ '/work/multi.bend': text });
  const owner = start(adapter, '/work/multi.bend');
  loadFile(adapter, owner, '/work/multi.bend');
  importLine(adapter, owner, '/work/multi.bend', 0, 11, 'import Base');
  importLine(adapter, owner, '/work/multi.bend', 12, 31, 'import ./d.bend as D');
  // The declaration is emitted before the boundary, exactly as the patched frontend orders it.
  declare(adapter, owner, '/work/multi.bend', 'value', { src: transformed, beg: 2, end: 7 });
  preParse(adapter, owner, '/work/multi.bend', transformed, { D: './d' });
  loadComplete(adapter, owner, '/work/multi.bend', 3);
  adapter.endQuery();

  const session = adapter.report().sessions[0];
  assert.equal(session.imports.length, 2);
  assert.equal(session.aliases[0].preParse, true);
  assert.equal(session.aliases[0].parsedTextMatchesView, true);
  const declaration = session.declarations[0];
  assert.equal(declaration.span.status, 'mapped');
  assert.equal(declaration.span.text, 'value');
  assert.equal(declaration.span.original.start.index, 32);
  assert.equal(session.completeness, 'complete');
});

test('a parser failure still has a finalized view to map its span through', () => {
  const text = 'import Base\nbody(\n';
  const transformed = '\nbody(\n';
  const adapter = adapterWith({ '/work/bad.bend': text });
  const owner = start(adapter, '/work/bad.bend');
  loadFile(adapter, owner, '/work/bad.bend');
  importLine(adapter, owner, '/work/bad.bend', 0, 11, 'import Base');
  preParse(adapter, owner, '/work/bad.bend', transformed);
  // The parser fails at the transformed position of '(' and no loadComplete ever arrives.
  emit(adapter, owner, {
    kind: HOOK_KINDS.diagnostic,
    phase: HOOK_PHASES.parse,
    form: 'thrown',
    file: '/work/bad.bend',
    thrown: { $: 'Err' },
    rendered: 'expected an expression',
    definition: null,
    span: { src: transformed, beg: 5, end: 5 },
  });
  adapter.endQuery();

  const session = adapter.report().sessions[0];
  assert.equal(session.diagnostics.length, 1);
  assert.equal(session.diagnostics[0].span.status, 'mapped');
  assert.equal(session.diagnostics[0].span.original.start.index, 16);
  assert.equal(session.diagnostics[0].thrown.kind, 'Err');
  assert.equal(session.diagnostics[0].rendered, 'expected an expression');
  assert.equal(session.completeness, 'complete');
});

test('a span crossing a removed import is refused, and a mismatched pre-parse text is recorded', () => {
  const text = 'aaa\nimport Base\nbody\n';
  const transformed = 'aaa\n\nbody\n';
  const adapter = adapterWith({ '/work/imports.bend': text });
  const owner = start(adapter, '/work/imports.bend');
  loadFile(adapter, owner, '/work/imports.bend');
  importLine(adapter, owner, '/work/imports.bend', 4, 15, 'import Base');
  declare(adapter, owner, '/work/imports.bend', 'body', { src: transformed, beg: 5, end: 9 });
  declare(adapter, owner, '/work/imports.bend', 'across', { src: transformed, beg: 3, end: 6 });
  preParse(adapter, owner, '/work/imports.bend', 'aaa\n\nbody\n', {});
  adapter.endQuery();

  const session = adapter.report().sessions[0];
  assert.equal(session.declarations[0].span.status, 'mapped');
  assert.equal(session.declarations[0].span.original.start.index, 16);
  assert.equal(session.declarations[1].span.status, 'unavailable');
  assert.equal(session.declarations[1].span.reason, 'spansOmitted');
  assert.equal(session.aliases[0].parsedTextMatchesView, false);
  assert.equal(adapter.counters.preParseMismatches, 1);
  assert.ok(session.incompleteness.includes('preParseMismatch'));
});

test('a diagnostic names its file or stays unattributed, even when two captures share text', () => {
  const importer = 'import ./dep.bend as P\nvalue\n';
  const adapter = adapterWith({ '/work/importer.bend': importer, '/work/twin.bend': importer });
  const owner = start(adapter, '/work/importer.bend');
  loadFile(adapter, owner, '/work/importer.bend');
  // The loader carries the importer identity, so the cycle event names it directly.
  emit(adapter, owner, { kind: HOOK_KINDS.diagnostic, phase: HOOK_PHASES.load, form: 'err', file: '/work/importer.bend', condition: 'an import cycle through /work/dep.bend', observed: null, definition: null, note: null, span: { src: importer, beg: 0, end: 0 } });
  // With no named file and no unique owning declaration the diagnostic stays unattributed: identical
  // text in two captures is a normal case, not an identity.
  emit(adapter, owner, { kind: HOOK_KINDS.diagnostic, phase: HOOK_PHASES.load, form: 'err', file: null, condition: 'a cycle with no importer named', observed: null, definition: null, note: null, span: { src: importer, beg: 0, end: 0 } });
  adapter.endQuery();

  const session = adapter.report().sessions[0];
  assert.equal(session.diagnostics[0].file, '/work/importer.bend');
  assert.equal(session.diagnostics[0].span.status, 'mapped');
  assert.equal(session.diagnostics[0].span.identity, '/work/importer.bend');
  assert.equal(session.diagnostics[1].file, null);
  assert.equal(session.diagnostics[1].span.status, 'unavailable');
});

test('an ambiguous owning name is recorded instead of attributed', () => {
  const text = 'def value() -> U32:\n  1\n';
  const adapter = adapterWith({ '/work/one.bend': text, '/work/two.bend': text });
  const owner = start(adapter, '/work/one.bend');
  loadFile(adapter, owner, '/work/one.bend');
  declare(adapter, owner, '/work/one.bend', 'value', { src: text, beg: 0, end: 3 });
  declare(adapter, owner, '/work/two.bend', 'value', { src: text, beg: 0, end: 3 });
  emit(adapter, owner, { kind: HOOK_KINDS.diagnostic, phase: HOOK_PHASES.check, form: 'thrown', file: null, thrown: { $: 'Err' }, rendered: 'r', definition: 'value', span: null });
  adapter.endQuery();

  const session = adapter.report().sessions[0];
  assert.equal(session.diagnostics[0].file, null);
  assert.ok(session.incompleteness.includes('ambiguousDeclaration'));
});

test('capture-only resolution answers from the closure and carries one cached acquisition', () => {
  const text = 'def value() -> U32:\n  1\n';
  const adapter = adapterWith({ '/work/root.bend': text, '/lib/base.bend': 'law base()\n' }, { baseBend: '/lib/base.bend' });
  const owner = start(adapter, '/work/root.bend');
  const first = adapter.sink.resolveSource('/work/root.bend', owner);
  assert.equal(first.status, 'captured');
  assert.equal(first.identity, '/work/root.bend');
  assert.equal(adapter.sink.readSource('/work/root.bend', owner), text);
  assert.equal(adapter.sink.readSource('/work/root.bend', owner), text);
  assert.equal(adapter.sink.resolveSource('/work/root.bend', owner).status, 'captured');
  // Three lookups, one acquisition: the cached bytes are reused.
  assert.deepEqual(adapter.reads, ['/work/root.bend']);

  const absent = adapter.sink.resolveSource('/work/other.bend', owner);
  assert.equal(absent.status, 'absent');
  assert.equal(adapter.sink.readSource('/work/other.bend', owner), undefined);
  assert.equal(adapter.counters.uncapturedDependencies, 1);

  const base = adapter.sink.baseBendPath(owner);
  assert.equal(base.status, 'captured');
  assert.equal(base.path, '/lib/base.bend');
  adapter.endQuery();
});

test('an alias and its canonical identity share one acquisition', () => {
  const canonical = '/work/real/dep.bend';
  const alias = '/work/alias/dep.bend';
  const reads = [];
  let served = 0;
  const adapter = createFrontendAdapter({
    captureOnly: true,
    acquisition: {
      resolve: (identity) => ({ exists: true, identity: canonical }),
      read(identity) {
        reads.push(identity);
        served += 1;
        // The second read would return different bytes: a second acquisition would be visible as a
        // different capture, and a conflicting alias must be refused rather than overwritten.
        const text = served === 1 ? 'def twice(x: U32) -> U32:\n  x\n' : 'def twice(x: U32) -> U32:\n  0\n';
        return { identity, bytes: bytesOf(text) };
      },
    },
  });
  const owner = start(adapter, alias);
  assert.equal(adapter.sink.readSource(alias, owner), 'def twice(x: U32) -> U32:\n  x\n');
  assert.equal(adapter.sink.readSource(canonical, owner), 'def twice(x: U32) -> U32:\n  x\n');
  assert.deepEqual(reads, [canonical], 'the canonical identity is acquired once and reused');
  const conflict = adapter.sink.resolveSource(alias, owner);
  assert.equal(conflict.status, 'captured');
  adapter.endQuery();
  const session = adapter.report().sessions[0];
  assert.equal(session.completeness, 'complete');
  assert.equal(session.acquisitions.length, 1, 'requested and canonical names share one record');
});

test('a non-acquiring lookup answers presence without reading bytes', () => {
  const text = 'import Base\n';
  const adapter = adapterWith({ '/work/root.bend': text });
  const owner = start(adapter, '/work/root.bend');
  const missing = adapter.sink.lookupSource('/work/elsewhere/LAWS.bend', owner);
  assert.equal(missing.status, 'absent');
  const present = adapter.sink.lookupSource('/work/root.bend', owner);
  assert.equal(present.status, 'present');
  assert.equal(adapter.reads.length, 0, 'a lookup acquires nothing');
  assert.equal(adapter.counters.uncapturedDependencies, 0);
  adapter.endQuery();
});


test('a closure with no base answers unavailable rather than resolving a host path', () => {
  const adapter = adapterWith({ '/work/root.bend': 'def a() -> U32:\n  1\n' });
  const owner = start(adapter, '/work/root.bend');
  const base = adapter.sink.baseBendPath(owner);
  assert.equal(base.status, 'unavailable');
  assert.equal(base.detail, 'closureBaseMissing');
  adapter.endQuery();
});

test('a throwing reader is one acquisition failure with its detail retained', () => {
  const adapter = createFrontendAdapter({
    acquisition: {
      resolve: () => ({ exists: true, identity: '/work/broken.bend' }),
      read() {
        throw new Error('closure reader unavailable');
      },
    },
  });
  const owner = start(adapter, '/work/broken.bend');
  loadFile(adapter, owner, '/work/broken.bend');
  assert.equal(adapter.sink.readSource('/work/broken.bend', owner), undefined);
  adapter.endQuery();

  const session = adapter.report().sessions[0];
  assert.equal(adapter.counters.acquisitionFailures, 1);
  assert.equal(adapter.counters.evidenceFailures, 0);
  assert.equal(session.diagnostics.length, 0);
  assert.equal(session.acquisitions[0].status, 'failed');
  assert.equal(session.acquisitions[0].detail, 'closure reader unavailable');
  assert.ok(session.incompleteness.includes('acquisitionFailure'));
});

test('an event from another owner is refused and never recorded', () => {
  const text = 'def value() -> U32:\n  1\n';
  const adapter = adapterWith({ '/work/a.bend': text, '/work/b.bend': text });
  const first = start(adapter, '/work/a.bend');
  declare(adapter, first, '/work/a.bend', 'value', { src: text, beg: 0, end: 3 });
  // A sink retained by an older invocation tries to publish into this one.
  emit(adapter, `${first}-stale`, { kind: HOOK_KINDS.declaration, phase: HOOK_PHASES.parse, file: '/work/b.bend', form: 'def', name: 'other', qualified: 'other', namespace: '', unsafe: false, span: { src: text, beg: 0, end: 3 } });
  // And a read from that stale caller is refused.
  assert.equal(adapter.sink.readSource('/work/b.bend', `${first}-stale`), undefined);
  adapter.endQuery();

  const session = adapter.report().sessions[0];
  assert.equal(session.declarations.length, 1);
  assert.equal(adapter.counters.foreignOwnerEvents, 1);
  assert.equal(adapter.counters.outsideQueryReads, 1);
  assert.ok(session.incompleteness.includes('foreignOwnerEvent'));
});

test('a read outside every invocation belongs to no session', () => {
  const adapter = adapterWith({ '/work/one.bend': 'def a() -> U32:\n  1\n' });
  assert.equal(adapter.sink.readSource('/work/one.bend', 'no-owner'), undefined);
  const owner = start(adapter, '/work/one.bend');
  loadFile(adapter, owner, '/work/one.bend');
  preParse(adapter, owner, '/work/one.bend', 'def a() -> U32:\n  1\n');
  loadComplete(adapter, owner, '/work/one.bend', 1);
  const overlapping = adapter.beginQuery({ identity: '/work/two.bend' });
  assert.equal(overlapping.status, 'rejected');
  assert.equal(overlapping.reason, 'queryActive');
  adapter.endQuery();

  const session = adapter.report().sessions[0];
  assert.equal(adapter.counters.outsideQueryReads, 1, 'the pre-invocation read is counted process-wide');
  assert.ok(!session.incompleteness.includes('outsideQueryRead'), 'it is not attributed to the later invocation');
  assert.ok(session.incompleteness.includes('overlappingQuery'), 'the overlap happened during the invocation');
});

test('an invalid event and an unfinished view both make the capture incomplete', () => {
  const text = 'def value() -> U32:\n  1\n';
  const adapter = adapterWith({ '/work/root.bend': text });
  const owner = start(adapter, '/work/root.bend');
  loadFile(adapter, owner, '/work/root.bend');
  declare(adapter, owner, '/work/root.bend', 'value', { src: text, beg: 0, end: 3 });
  emit(adapter, owner, { kind: HOOK_KINDS.declaration, phase: HOOK_PHASES.parse, file: '/work/root.bend', form: 'nonsense', name: 'x', qualified: 'x', namespace: '', unsafe: false, span: null });
  adapter.endQuery();

  const session = adapter.report().sessions[0];
  assert.equal(session.declarations.length, 1);
  assert.equal(session.declarations[0].span.reason, 'viewNotFinalized');
  assert.ok(session.incompleteness.includes('invalidEvent'));
  assert.ok(session.incompleteness.includes('unresolvedSpans'));
  assert.equal(session.completeness, 'incomplete');
});

test('declared type and elaborated term observations keep their status and quantities', () => {
  const text = 'def id(+x: U32) -> U32:\n  x\n';
  const adapter = adapterWith({ '/work/types.bend': text });
  const owner = start(adapter, '/work/types.bend');
  loadFile(adapter, owner, '/work/types.bend');
  declare(adapter, owner, '/work/types.bend', 'id', { src: text, beg: 0, end: 3 });
  preParse(adapter, owner, '/work/types.bend', text);
  emit(adapter, owner, { kind: HOOK_KINDS.typeObservation, phase: HOOK_PHASES.check, status: 'declared', qualified: 'id', definition: 'id', file: null, text: 'U32 -o U32', quantities: [{ quant: '+', name: 'x' }], span: null });
  emit(adapter, owner, { kind: HOOK_KINDS.typeObservation, phase: HOOK_PHASES.check, status: 'elaboratedTerm', qualified: 'id', definition: 'id', file: null, text: 'U32', quantities: [], span: null });
  adapter.endQuery();

  const types = adapter.report().sessions[0].types;
  assert.deepEqual(types.map((entry) => entry.status), ['declared', 'elaboratedTerm']);
  assert.deepEqual(types[0].quantities, [{ quant: '+', name: 'x' }]);
  // The checker site names no file, so the declaration that owns the name attributes the observation.
  assert.equal(types[0].file, '/work/types.bend');
});

// A frontend double for the invocation entry: it records the calls it receives and can be told to
// fail at a chosen step. It is not a frontend and proves nothing about Bend2 semantics.
function frontendDouble({ failAt = null, owned = null, throwInstall = false, importLaws = false, lawsIdentity = null } = {}) {
  const calls = [];
  const state = { owner: owned };
  return {
    calls,
    state,
    err_show: (value) => `err:${value && value.$ === 'Err' ? 'Err' : 'other'}`,
    bendHooks(sink, owner) {
      calls.push(['bendHooks', sink === null ? null : 'sink', owner]);
      if (throwInstall && sink !== null) throw new Error('hook installation refused by the consumer');
      if (sink === null) {
        if (state.owner !== null && state.owner !== owner) return { status: 'refused', owner: state.owner, reason: 'ownedByAnother' };
        state.owner = null;
        return { status: 'installed', owner: '' };
      }
      if (state.owner !== null && state.owner !== owner) return { status: 'refused', owner: state.owner, reason: 'ownedByAnother' };
      state.owner = owner;
      return { status: 'installed', owner };
    },
    book_nil() {
      calls.push(['book_nil']);
      return { tlds: {}, ctrs: {}, order: [], hols: 0, open: 0, tmps: {} };
    },
    async book_load(book, file, ns, seen) {
      calls.push(['book_load', file, seen instanceof Map]);
      if (failAt === 'load') throw { $: 'Err', def: 'imported', spn: null };
      // The real loader keys the seen map by the canonical identity it loaded.
      if (importLaws && lawsIdentity !== null) seen.set(lawsIdentity, '');
      return 2;
    },
    book_valid(book, done) {
      calls.push(['book_valid', done]);
      if (failAt === 'check') throw { $: 'Err', def: 'body', spn: null };
    },
  };
}

test('the invocation entry runs the real phase order and validates from zero', async () => {
  const { runFrontendInvocation } = await import('./frontend-invocation.mjs');
  const adapter = adapterWith({ '/work/root.bend': 'def a() -> U32:\n  1\n' });
  const frontend = frontendDouble();
  const owned = [];
  const comp = { SYNTH: 'SYNTH', book_owned(book, checkSet) { owned.push([book, checkSet]); } };
  const result = await runFrontendInvocation({ frontend, adapter, root: '/work/root.bend', phases: ['parse', 'check', 'completion'], comp });

  assert.equal(result.status, 'completed');
  assert.deepEqual([...result.phasesRun], ['parse', 'check', 'completion']);
  assert.equal(result.rootDeclarationStart, 2);
  const check = frontend.calls.find((call) => call[0] === 'book_valid');
  assert.deepEqual(check, ['book_valid', 0]);
  assert.equal(owned.length, 1);
  assert.equal(owned[0][1], 'SYNTH');
  assert.equal(frontend.state.owner, null, 'the owned hook is released');
  assert.equal(result.session.owner, result.owner);
  assert.equal(adapter.currentSession(), null, 'the adapter session is closed');
});

test('a failing check stops before completion and still restores the hook', async () => {
  const { runFrontendInvocation } = await import('./frontend-invocation.mjs');
  const adapter = adapterWith({ '/work/root.bend': 'def a() -> U32:\n  oops\n' });
  const frontend = frontendDouble({ failAt: 'check' });
  let ownedCalls = 0;
  const comp = { SYNTH: 'SYNTH', book_owned() { ownedCalls += 1; } };
  const result = await runFrontendInvocation({ frontend, adapter, root: '/work/root.bend', phases: ['parse', 'check', 'completion'], comp });

  assert.equal(result.status, 'failed');
  assert.deepEqual([...result.phasesRun], ['parse']);
  assert.equal(result.outcome.phase, 'check');
  assert.equal(result.outcome.thrown.kind, 'Err');
  assert.equal(ownedCalls, 0, 'completion is never reported as reached');
  assert.equal(frontend.state.owner, null);
  assert.equal(frontend.calls.some((call) => call[0] === 'book_valid'), true);
  assert.equal(adapter.currentSession(), null);
});

test('the invocation entry refuses an unknown phase and a missing completion dependency', async () => {
  const { runFrontendInvocation } = await import('./frontend-invocation.mjs');
  const adapter = adapterWith({ '/work/root.bend': 'def a() -> U32:\n  1\n' });
  const frontend = frontendDouble();

  const unknown = await runFrontendInvocation({ frontend, adapter, root: '/work/root.bend', phases: ['parse', 'types'] });
  assert.equal(unknown.status, 'rejected');
  assert.equal(unknown.reason, 'phaseUnsupported');
  assert.equal(adapter.currentSession(), null, 'a refused request starts no invocation');

  const noCheck = await runFrontendInvocation({ frontend, adapter, root: '/work/root.bend', phases: ['parse', 'completion'], comp: { SYNTH: 'S', book_owned() {} } });
  assert.equal(noCheck.reason, 'completionRequiresCheck');

  const noComp = await runFrontendInvocation({ frontend, adapter, root: '/work/root.bend', phases: ['parse', 'check', 'completion'] });
  assert.equal(noComp.reason, 'completionModuleMissing');

  const missingExport = await runFrontendInvocation({ frontend: {}, adapter, root: '/work/root.bend', phases: ['parse'] });
  assert.equal(missingExport.reason, 'frontendExportMissing');
});

test('a frontend owned by another invocation is refused without touching its sink', async () => {
  const { runFrontendInvocation } = await import('./frontend-invocation.mjs');
  const adapter = adapterWith({ '/work/root.bend': 'def a() -> U32:\n  1\n' });
  const frontend = frontendDouble({ owned: 'other-invocation' });
  const result = await runFrontendInvocation({ frontend, adapter, root: '/work/root.bend', phases: ['parse'] });

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'frontendOwned');
  assert.equal(result.detail, 'other-invocation');
  assert.equal(frontend.state.owner, 'other-invocation', "the active owner is unchanged");
  assert.equal(adapter.currentSession(), null);
});

test('a throwing install closes the session and frees the adapter for the next invocation', async () => {
  const { runFrontendInvocation } = await import('./frontend-invocation.mjs');
  const adapter = adapterWith({ '/work/root.bend': 'def a() -> U32:\n  1\n' });
  const result = await runFrontendInvocation({ frontend: frontendDouble({ throwInstall: true }), adapter, root: '/work/root.bend', phases: ['parse'] });
  assert.equal(result.status, 'failed');
  assert.equal(result.outcome.phase, 'install');
  assert.equal(adapter.currentSession(), null, 'the session is ended on the install branch');
  assert.ok(result.session.incompleteness.includes('evidenceFailure') || result.session.incompleteness.includes('hookInstallFailure'));

  const after = await runFrontendInvocation({ frontend: frontendDouble(), adapter, root: '/work/root.bend', phases: ['parse'] });
  assert.equal(after.status, 'completed', 'a later invocation starts on the same adapter');
  assert.equal(adapter.currentSession(), null);
});

test('the PROOF rule refuses a present unimported LAWS and passes an imported one', async () => {
  const { runFrontendInvocation } = await import('./frontend-invocation.mjs');
  const proofDir = '/work/proof';
  const root = `${proofDir}/PROOF.bend`;
  const lawsIdentity = `${proofDir}/LAWS.bend`;
  const files = { [root]: 'import Base\n', [lawsIdentity]: 'import Base\n' };
  const comp = { SYNTH: 'SYNTH', book_owned() {} };

  const importedAdapter = adapterWith(files);
  const imported = await runFrontendInvocation({ frontend: frontendDouble({ importLaws: true, lawsIdentity }), adapter: importedAdapter, root, phases: ['parse', 'check', 'completion'], comp });
  assert.equal(imported.status, 'completed');
  assert.deepEqual([...imported.phasesRun], ['parse', 'check', 'completion']);
  const satisfied = imported.session.phases.filter((entry) => entry.kind === 'completionGate' && entry.gate === 'proofLawsRule');
  assert.equal(satisfied.length, 1);
  assert.equal(satisfied[0].completed, true);

  const missingAdapter = adapterWith(files);
  const refused = await runFrontendInvocation({ frontend: frontendDouble(), adapter: missingAdapter, root, phases: ['parse', 'check', 'completion'], comp });
  assert.equal(refused.status, 'failed');
  assert.equal(refused.outcome.gate, 'proofLawsRule');
  assert.equal(refused.outcome.rendered, 'PROOF.bend must import ./LAWS.bend');
  assert.ok(!refused.phasesRun.includes('completion'), 'completion is never reported without the gate');
  assert.equal(refused.session.phases.filter((entry) => entry.kind === 'completionGate' && entry.gate === 'proofLawsRule')[0].completed, false);
});


test('the patch spec refuses a foreign input and reports anchor mechanics', () => {
  const registryAnchor = 'export function Err(bok: Book, ctx: Ctx, exp: Expr, obs?: Expr, spn?: Span, def?: Name, nte?: string): Err {';

  // A synthetic input is not the pinned upstream file: the identity check refuses it and names both
  // digests, so an alteration outside the anchors cannot pass under the original pin.
  const refused = deriveHookedSource({ target: 'bend', text: registryAnchor });
  assert.equal(refused.status, 'unavailable');
  assert.equal(refused.reason, 'inputIdentityMismatch');
  assert.equal(refused.detail.observed.length, 64);
  assert.notEqual(refused.detail.observed, refused.detail.expected);

  // Anchor mechanics are separate from the identity check.
  const missing = applyHookOperations({ target: 'bend', text: registryAnchor });
  assert.equal(missing.reason, 'anchorMissing');
  const ambiguous = applyHookOperations({ target: 'bend', text: `${registryAnchor}\n${registryAnchor}\n` });
  assert.equal(ambiguous.reason, 'anchorAmbiguous');
  assert.equal(ambiguous.detail.count, 2);
  assert.equal(applyHookOperations({ target: 'comp', text: 'x' }).reason, 'targetUnsupported');
  assert.equal(applyHookOperations({ target: 'bend', text: 42 }).reason, 'textMissing');
});