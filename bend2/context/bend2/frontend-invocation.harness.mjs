// Remote composed harness for the derived Bend2 frontend and the internal invocation entry.
//
// Authored for the remote validation runner. Nothing in this repository runs it and no result is
// claimed from it here. It performs the real composition and asserts per case, so a run either
// establishes the behavior or names the assertion that failed.
//
// What it does
//   1. reads the pinned upstream inputs from mandatory explicit paths and refuses any input whose
//      sha256 is not the pinned digest,
//   2. derives the hooked copies of bend.ts and main.ts,
//   3. materializes bend.ts, main.ts and the pinned comp.ts in ONE directory, so every relative
//      import of the derived sources resolves inside that directory and no original sibling kernel
//      is reached, and verifies that layout,
//   4. imports the derived kernel and the completion module from that directory,
//   5. runs runFrontendInvocation over capture closures built from the committed fixtures, so the
//      frontend reads every file through the sink and consults no host path,
//   6. asserts per case and prints one JSON report.
//
// Prerequisites
//   The pinned sources import the node builtins and their siblings by explicit `.ts` specifier
//   (`import * as Bend from "./bend.ts"`, `import * as Comp from "./comp.ts"`; the `bun` import is
//   type-only), so Node 22.7 or later with TypeScript stripping runs the derived copies directly:
//     BATON2_BEND_TS BATON2_MAIN_TS BATON2_COMP_TS BATON2_BASE_BEND : pinned upstream files
//     BATON2_FIXTURE_DIR : the committed fixture directory (bend2/context/bend2/fixtures)
//
// Command
//   BATON2_BEND_TS=... BATON2_MAIN_TS=... BATON2_COMP_TS=... BATON2_BASE_BEND=... \
//   BATON2_FIXTURE_DIR=bend2/context/bend2/fixtures \
//   node --experimental-strip-types bend2/context/bend2/frontend-invocation.harness.mjs
//
// Fixture expectations, each derived from the pinned kernel source
//   valid.bend          a def with a U32 parameter and a variable body: loads and checks
//   invalid.bend        a body calling an undefined name: book_valid reports an undefined reference
//   invalid-root.bend   imports invalid.bend; the check failure belongs to the imported file
//   typo.bend           an unbalanced parenthesis: parse_fail throws at the transformed position
//   dep.bend            loaded through two aliases from alias-root.bend
//   virtual.bend        supplied only by the closure, never present on disk
//   holes.bend          a law with no fill: an open declaration, so the hole refusal fires
//   proof/**/PROOF.bend with and without an import of its sibling LAWS.bend

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createFrontendAdapter } from './frontend-adapter.mjs';
import { createRetainedAcquisition } from './acquisition.mjs';
import { UPSTREAM_INPUTS, UPSTREAM_PIN, HOOK_OPERATIONS, applyHookOperations, deriveHookedSource, verifyHookAnchors } from './frontend-hooks.mjs';
import { runFrontendInvocation } from './frontend-invocation.mjs';

const ENV = ['BATON2_BEND_TS', 'BATON2_MAIN_TS', 'BATON2_COMP_TS', 'BATON2_BASE_BEND', 'BATON2_FIXTURE_DIR'];

// Every fixture that must exist on disk. virtual.bend is deliberately absent: it is supplied only by
// the capture closure, so the run proves that a captured module needs no host file.
const ON_DISK = [
  'valid.bend', 'invalid.bend', 'invalid-root.bend', 'typo.bend', 'dep.bend', 'alias-root.bend',
  'virtual-root.bend', 'holes.bend', 'proof/with-import/PROOF.bend', 'proof/with-import/LAWS.bend',
  'proof/without-import/PROOF.bend', 'proof/without-import/LAWS.bend',
];
const VIRTUAL = 'virtual.bend';
const VIRTUAL_SOURCE = 'import Base\n\ndef pick(x: U32) -> U32:\n  x\n';

// Evidence must survive a failing exit: when stdout is a pipe the write is
// asynchronous, so the process exits only after the write flushes. Exiting
// immediately truncates the stream (observed: exactly 65536 bytes ending
// mid-JSON on the failing case).
function emitAndExit(text, code) {
  process.stdout.write(`${text}\n`, () => process.exit(code));
}

function refuse(reason, detail) {
  emitAndExit(JSON.stringify({ status: 'refused', reason, detail }, null, 2), 2);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function check(report, claim, ok, observed) {
  report.assertions.push({ claim, ok: ok === true, observed: observed === undefined ? null : observed });
  if (ok !== true) report.failed = true;
}

function pinnedInputs() {
  const missing = ENV.filter((name) => typeof process.env[name] !== 'string' || process.env[name].length === 0);
  if (missing.length > 0) refuse('missingInputPath', missing.join(','));
  const read = (envName, key) => {
    const bytes = readFileSync(process.env[envName]);
    const digest = sha256(bytes);
    if (digest !== UPSTREAM_INPUTS[key].sha256) refuse('inputIdentityMismatch', { envName, expected: UPSTREAM_INPUTS[key].sha256, observed: digest });
    return bytes;
  };
  return { bend: read('BATON2_BEND_TS', 'bend'), main: read('BATON2_MAIN_TS', 'main'), comp: read('BATON2_COMP_TS', 'comp'), base: read('BATON2_BASE_BEND', 'base') };
}

function materialize(inputs) {
  const dir = mkdtempSync(join(tmpdir(), 'bend2-harness-'));
  const bend = deriveHookedSource({ target: 'bend', text: inputs.bend.toString('utf8') });
  if (bend.status !== 'derived') refuse('deriveRefused', bend);
  const main = deriveHookedSource({ target: 'main', text: inputs.main.toString('utf8') });
  if (main.status !== 'derived') refuse('deriveRefused', main);
  // One directory: the derived kernel, the derived main and the pinned completion module. Their
  // relative imports resolve among these copies, never among the original siblings.
  writeFileSync(join(dir, 'bend.ts'), bend.text);
  writeFileSync(join(dir, 'main.ts'), main.text);
  writeFileSync(join(dir, 'comp.ts'), inputs.comp);
  const layout = ['bend.ts', 'main.ts', 'comp.ts'].map((name) => existsSync(join(dir, name)));
  if (layout.some((present) => !present)) refuse('layoutIncomplete', layout);
  return { dir, bend, main };
}

function fixtures(baseBytes) {
  const dir = process.env.BATON2_FIXTURE_DIR;
  const missing = ON_DISK.filter((name) => !existsSync(join(dir, name)));
  if (missing.length > 0) refuse('fixtureMissing', missing.join(','));
  const files = new Map();
  for (const name of ON_DISK) files.set(join(dir, name), readFileSync(join(dir, name)));
  files.set(join(dir, 'base.bend'), baseBytes);
  files.set(join(dir, VIRTUAL), Buffer.from(VIRTUAL_SOURCE, 'utf8'));
  return { dir, files, basePath: join(dir, 'base.bend') };
}

function closureReader(files, options = {}) {
  const reads = [];
  const read = (identity) => {
    reads.push(identity);
    if (options.readHook !== undefined) {
      const hooked = options.readHook(identity, reads.length);
      if (hooked !== undefined) return hooked;
    }
    if (!files.has(identity)) return { refuse: 'not in the captured closure' };
    return { identity, bytes: files.get(identity) };
  };
  // The non-acquiring resolver answers existence from the same immutable fixture catalog the reads
  // come from, so a presence question never depends on whether the bytes were acquired yet.
  const resolve = options.resolveHook === undefined
    ? (identity) => ({ exists: files.has(identity), identity })
    : (identity) => options.resolveHook(identity, files);
  return { reads, read, resolve };
}

// The harness proves the retained-acquisition path, not an inline closure:
// the operand is built by createRetainedAcquisition over a capture-host view
// of the primed fixture catalog, so existence, identity and bytes come from
// the retained set and the base is located by the pinned digest. The reads
// log wraps the operand's read answers (one entry per acquisition the
// adapter performs), matching the closure reader's lazy logging —
// construction-time retention reads stay invisible to the assertions.
function adapterFor(fixture) {
  const digests = new Map();
  for (const [path, bytes] of fixture.files) digests.set(path, sha256(bytes));
  const capture = {
    descriptors: () => [...fixture.files.keys()].map((path) => ({ kind: 'file', path, real: path, sha256: digests.get(path) })),
    readBytes: (path) => fixture.files.get(path),
  };
  const operand = createRetainedAcquisition({ capture, basePin: UPSTREAM_INPUTS.base });
  if (operand.status === 'refused') refuse('acquisitionRefused', operand);
  const reads = [];
  const adapter = createFrontendAdapter({
    captureOnly: true,
    acquisition: {
      resolve: (identity) => operand.resolve(identity),
      read: (identity) => {
        reads.push(identity);
        return operand.read(identity);
      },
      baseBend: operand.baseBend,
    },
  });
  return { adapter, reads };
}

function reportOf(name, result, adapter, extra) {
  const session = result.session ?? null;
  const report = {
    name,
    status: result.status,
    reason: result.reason ?? null,
    phasesRun: result.phasesRun === undefined ? [] : [...result.phasesRun],
    outcome: result.outcome === null || result.outcome === undefined ? null : {
      phase: result.outcome.phase,
      gate: result.outcome.gate ?? null,
      // A refusal carries no thrown summary at all (refusalOf sets null
      // rather than inventing one); only a real summary names a kind.
      thrownKind: result.outcome.thrownSummary === undefined || result.outcome.thrownSummary === null ? null : result.outcome.thrownSummary.kind,
      thrownIsValue: result.outcome.thrownValue !== undefined,
      rendered: result.outcome.rendered ?? null,
    },
    diagnostics: session === null ? [] : session.diagnostics.map((entry) => ({
      phase: entry.phase,
      form: entry.form,
      file: entry.file,
      definition: entry.definition,
      thrownKind: entry.thrown === null ? null : entry.thrown.kind,
      span: entry.span.status === 'mapped'
        ? { status: 'mapped', identity: entry.span.identity, line: entry.span.original.start.line, column: entry.span.original.start.column, text: entry.span.text }
        : { status: entry.span.status, reason: entry.span.reason ?? null },
    })),
    gates: session === null ? [] : session.phases.filter((entry) => entry.kind === 'completionGate'),
    types: session === null ? [] : session.types.map((entry) => ({ status: entry.status, qualified: entry.qualified, file: entry.file })),
    acquisitions: session === null ? [] : session.acquisitions,
    assertions: [],
    failed: false,
  };
  Object.assign(report, extra ?? {});
  void adapter;
  return report;
}

async function runCase(name, body) {
  try {
    return await body();
  } catch (error) {
    const report = { name, status: 'harnessError', failed: true, assertions: [{ claim: 'case runs', ok: false, observed: String(error && error.message ? error.message : error) }] };
    return report;
  }
}

async function cases(kernel, compModule, fixture, inputs, derived) {
  const reports = [];
  const dir = fixture.dir;
  const compCalls = [];

  // D5 capture priming: the glue answers exactly the names the capture
  // recorded, so the harness asserts the primed set itself. Every name the
  // loader may ask for (each on-disk fixture, the base pin, the virtual
  // module) must resolve present, and a name outside the primed set must
  // resolve absent with reads refused — a mismatch then surfaces as
  // unavailable and refuses the gate instead of being papered over.
  reports.push(await runCase('capture-primed-set', async () => {
    const { adapter } = adapterFor(fixture);
    const started = adapter.beginQuery({ identity: join(dir, 'valid.bend') });
    const owner = started.token;
    const primedAnswers = [...ON_DISK.map((entry) => join(dir, entry)), join(dir, 'base.bend'), join(dir, VIRTUAL)]
      .map((name) => ({ name, answer: adapter.sink.lookupSource(name, owner) }));
    const outside = join(dir, 'unprimed.bend');
    const absent = adapter.sink.lookupSource(outside, owner);
    adapter.endQuery();
    const report = reportOf('capture-primed-set', { status: 'checked', phasesRun: [], outcome: null, session: null }, adapter, {
      primed: [...fixture.files.keys()],
      sessionClosed: adapter.currentSession() === null,
    });
    for (const entry of primedAnswers) {
      check(report, `primed name resolves present: ${entry.name}`, entry.answer.status === 'present', entry.answer);
    }
    // No absence is inferred from a missing row: the glue answers nothing for
    // an unrecorded name, so the lookup reports unknown rather than absent.
    // Only a recorded absence row would answer absent.
    check(report, 'an unprimed name resolves unknown, never absent', absent.status === 'unknown', absent);
    check(report, 'the primed set covers fixtures, base pin and virtual module',
      ON_DISK.every((entry) => fixture.files.has(join(dir, entry))) && fixture.files.has(join(dir, 'base.bend')) && fixture.files.has(join(dir, VIRTUAL)),
      [...fixture.files.keys()]);
    check(report, 'the session was closed', report.sessionClosed === true, report.sessionClosed);
    return report;
  }));
  const comp = {
    SYNTH: compModule.SYNTH,
    book_owned(book, checkSet) {
      compCalls.push(checkSet);
      return compModule.book_owned(book, checkSet);
    },
  };

  reports.push(await runCase('valid-root-parse-check', async () => {
    const { adapter, reads } = adapterFor(fixture);
    const result = await runFrontendInvocation({ frontend: kernel, adapter, root: join(dir, 'valid.bend'), phases: ['parse', 'check'] });
    const report = reportOf('valid-root-parse-check', result, adapter, { reads: [...reads], ownerAfter: kernel.bendHookOwner(), sessionClosed: adapter.currentSession() === null });
    check(report, 'the run completes', report.status === 'completed', report.status);
    check(report, 'both phases ran in order', JSON.stringify(report.phasesRun) === JSON.stringify(['parse', 'check']), report.phasesRun);
    check(report, 'no diagnostic was reported', report.diagnostics.length === 0, report.diagnostics);
    check(report, 'the fixture declaration has both required type observations',
      ['declared', 'elaboratedTerm'].every((status) => report.types.some((entry) => entry.qualified === 'id' && entry.status === status)),
      report.types.filter((entry) => entry.qualified === 'id'));
    report.unrenderedSamples = [...(kernel.bendHookState?.unrenderedSamples ?? [])];
    check(report, 'the owned hook was released', report.ownerAfter === '', report.ownerAfter);
    check(report, 'the session was closed', report.sessionClosed === true, report.sessionClosed);
    check(report, 'the root was acquired once', reads.filter((identity) => identity.endsWith('valid.bend')).length === 1, reads);
    return report;
  }));

  reports.push(await runCase('imported-invalid-definition', async () => {
    const { adapter } = adapterFor(fixture);
    const result = await runFrontendInvocation({ frontend: kernel, adapter, root: join(dir, 'invalid-root.bend'), phases: ['parse', 'check'] });
    const report = reportOf('imported-invalid-definition', result, adapter, { ownerAfter: kernel.bendHookOwner(), sessionClosed: adapter.currentSession() === null });
    check(report, 'the check fails', report.status === 'failed' && report.outcome !== null && report.outcome.phase === 'check', report.outcome);
    check(report, 'the real thrown value is retained', report.outcome !== null && report.outcome.thrownIsValue === true, report.outcome);
    const diagnostic = report.diagnostics.find((entry) => entry.form === 'thrown');
    check(report, 'a thrown diagnostic was reported', diagnostic !== undefined, report.diagnostics);
    check(report, 'the failure is attributed to the imported file', diagnostic !== undefined && typeof diagnostic.file === 'string' && diagnostic.file.endsWith('invalid.bend'), diagnostic);
    check(report, 'its span is mapped into that file', diagnostic !== undefined && diagnostic.span.status === 'mapped' && diagnostic.span.identity.endsWith('invalid.bend'), diagnostic === undefined ? null : diagnostic.span);
    check(report, 'the failing fixture declaration has its declared type observation',
      report.types.some((entry) => entry.qualified === 'invalid.broken' && entry.status === 'declared'),
      report.types.filter((entry) => entry.qualified === 'invalid.broken'));
    check(report, 'the hook was released and the session closed', report.ownerAfter === '' && report.sessionClosed === true, { ownerAfter: report.ownerAfter, closed: report.sessionClosed });
    return report;
  }));

  reports.push(await runCase('parse-error-mapped-span', async () => {
    const { adapter } = adapterFor(fixture);
    const result = await runFrontendInvocation({ frontend: kernel, adapter, root: join(dir, 'typo.bend'), phases: ['parse'] });
    const report = reportOf('parse-error-mapped-span', result, adapter, { ownerAfter: kernel.bendHookOwner(), sessionClosed: adapter.currentSession() === null });
    check(report, 'the load or parse step fails', report.status === 'failed' && report.outcome !== null, report.outcome);
    const diagnostic = report.diagnostics.find((entry) => entry.phase === 'parse');
    check(report, 'a parse diagnostic was reported', diagnostic !== undefined, report.diagnostics);
    check(report, 'the diagnostic names the parsed file', diagnostic !== undefined && typeof diagnostic.file === 'string' && diagnostic.file.endsWith('typo.bend'), diagnostic);
    check(report, 'the span is mapped to the original capture', diagnostic !== undefined && diagnostic.span.status === 'mapped', diagnostic === undefined ? null : diagnostic.span);
    // The unbalanced open paren sits on fixture line 4 (`  (x`); line 3 is
    // the balanced def line, so the kernel's 1-based line 4 is the truthful
    // mapping and the old literal was a 0-based slip.
    check(report, 'the span sits on the unbalanced line', diagnostic !== undefined && diagnostic.span.line === 4, diagnostic === undefined ? null : diagnostic.span);
    check(report, 'the hook was released and the session closed', report.ownerAfter === '' && report.sessionClosed === true, { ownerAfter: report.ownerAfter, closed: report.sessionClosed });
    return report;
  }));

  reports.push(await runCase('acquisition-refused', async () => {
    const reader = closureReader(fixture.files, { readHook: (identity) => (identity.endsWith('invalid.bend') ? { refuse: 'not captured for this query' } : undefined) });
    const adapter = createFrontendAdapter({ captureOnly: true, acquisition: { read: reader.read, resolve: (identity) => (fixture.files.has(identity) ? { exists: true, identity } : { exists: false, identity }), baseBend: fixture.basePath } });
    const result = await runFrontendInvocation({ frontend: kernel, adapter, root: join(dir, 'invalid-root.bend'), phases: ['parse'] });
    const report = reportOf('acquisition-refused', result, adapter, { ownerAfter: kernel.bendHookOwner(), sessionClosed: adapter.currentSession() === null });
    check(report, 'the load step fails', report.status === 'failed' && report.outcome !== null && report.outcome.phase === 'load', report.outcome);
    check(report, 'the closure refusal is recorded', report.acquisitions.some((entry) => entry.status === 'refused' || entry.status === 'failed'), report.acquisitions);
    check(report, 'the hook was released and the session closed', report.ownerAfter === '' && report.sessionClosed === true, { ownerAfter: report.ownerAfter, closed: report.sessionClosed });
    return report;
  }));

  reports.push(await runCase('throwing-reader', async () => {
    const reader = closureReader(fixture.files, { readHook: (identity) => { if (identity.endsWith('invalid.bend')) throw new Error('closure reader unavailable'); return undefined; } });
    const adapter = createFrontendAdapter({ captureOnly: true, acquisition: { read: reader.read, resolve: (identity) => (fixture.files.has(identity) ? { exists: true, identity } : { exists: false, identity }), baseBend: fixture.basePath } });
    const result = await runFrontendInvocation({ frontend: kernel, adapter, root: join(dir, 'invalid-root.bend'), phases: ['parse'] });
    const report = reportOf('throwing-reader', result, adapter, { ownerAfter: kernel.bendHookOwner(), sessionClosed: adapter.currentSession() === null });
    check(report, 'the acquisition detail is retained', report.acquisitions.some((entry) => entry.detail === 'closure reader unavailable' || entry.status === 'failed'), report.acquisitions);
    check(report, 'the hook was released and the session closed', report.ownerAfter === '' && report.sessionClosed === true, { ownerAfter: report.ownerAfter, closed: report.sessionClosed });
    return report;
  }));

  reports.push(await runCase('pinned-derivation', async () => {
    const report = { name: 'pinned-derivation', status: 'checked', assertions: [], failed: false };
    const bendText = inputs.bend.toString('utf8');
    const preflight = verifyHookAnchors({ target: 'bend', text: bendText });
    check(report, 'every operation anchor occurs exactly once in the pinned kernel', preflight.status === 'checked' && preflight.counts.every((entry) => entry.count === 1), preflight.counts.filter((entry) => entry.count !== 1));
    check(report, 'the pinned kernel derives', derived.bend.status === 'derived', derived.bend.status === 'derived' ? { operations: derived.bend.operations.length, outputDigest: derived.bend.outputDigest } : derived.bend);
    const mainPreflight = verifyHookAnchors({ target: 'main', text: inputs.main.toString('utf8') });
    check(report, 'every main-side anchor occurs exactly once', mainPreflight.status === 'checked' && mainPreflight.counts.every((entry) => entry.count === 1), mainPreflight.counts.filter((entry) => entry.count !== 1));
    check(report, 'the pinned main derives', derived.main.status === 'derived', derived.main.status === 'derived' ? { operations: derived.main.operations.length, outputDigest: derived.main.outputDigest } : derived.main);
    // A real missing anchor refuses: the first anchored statement is replaced by unrelated text.
    const missing = bendText.replace(HOOK_OPERATIONS.bend[0].anchor, 'const bendRemovedAnchor = 1;');
    const refused = applyHookOperations({ target: 'bend', text: missing });
    check(report, 'a missing anchor refuses the derivation', refused.status === 'unavailable' && refused.reason === 'anchorMissing' && refused.detail.id === HOOK_OPERATIONS.bend[0].id, refused);
    // An ambiguous anchor refuses as well.
    const ambiguous = bendText.replace(HOOK_OPERATIONS.bend[0].anchor, `${HOOK_OPERATIONS.bend[0].anchor}\n${HOOK_OPERATIONS.bend[0].anchor}`);
    const duplicated = applyHookOperations({ target: 'bend', text: ambiguous });
    check(report, 'an ambiguous anchor refuses the derivation', duplicated.status === 'unavailable' && duplicated.reason === 'anchorAmbiguous', duplicated);
    return report;
  }));

  reports.push(await runCase('virtual-absent-module', async () => {
    const virtualPath = join(dir, VIRTUAL);
    const { adapter, reads } = adapterFor(fixture);
    const result = await runFrontendInvocation({ frontend: kernel, adapter, root: join(dir, 'virtual-root.bend'), phases: ['parse', 'check'] });
    const report = reportOf('virtual-absent-module', result, adapter, { reads: [...reads], virtualOnDisk: existsSync(virtualPath), ownerAfter: kernel.bendHookOwner(), sessionClosed: adapter.currentSession() === null });
    check(report, 'the module is not on disk', report.virtualOnDisk === false, report.virtualOnDisk);
    check(report, 'the run completes from the closure', report.status === 'completed', { status: report.status, outcome: report.outcome });
    check(report, 'the virtual module was acquired', reads.some((identity) => identity.endsWith(VIRTUAL)), reads);
    check(report, 'the hook was released and the session closed', report.ownerAfter === '' && report.sessionClosed === true, { ownerAfter: report.ownerAfter, closed: report.sessionClosed });
    return report;
  }));

  reports.push(await runCase('alias-canonical-single-acquisition', async () => {
    let depReads = 0;
    const reader = closureReader(fixture.files, {
      // Every request for this path returns the retained fixture bytes.
      readHook: (identity) => {
        if (!identity.endsWith('dep.bend')) return undefined;
        depReads += 1;
        const bytes = readFileSync(join(dir, 'dep.bend'));
        return { identity, bytes };
      },
    });
    const adapter = createFrontendAdapter({ captureOnly: true, acquisition: { read: reader.read, resolve: (identity) => ({ exists: fixture.files.has(identity), identity }), baseBend: fixture.basePath } });
    const result = await runFrontendInvocation({ frontend: kernel, adapter, root: join(dir, 'alias-root.bend'), phases: ['parse', 'check'] });
    const report = reportOf('alias-canonical-single-acquisition', result, adapter, { depReads, ownerAfter: kernel.bendHookOwner(), sessionClosed: adapter.currentSession() === null });
    check(report, 'the aliased file is acquired once', depReads === 1, depReads);
    check(report, 'the run completes', report.status === 'completed', { status: report.status, outcome: report.outcome });
    check(report, 'the hook was released and the session closed', report.ownerAfter === '' && report.sessionClosed === true, { ownerAfter: report.ownerAfter, closed: report.sessionClosed });
    return report;
  }));

  for (const [name, fixtureName, expectImported] of [['proof-laws-with-import', 'with-import', true], ['proof-laws-without-import', 'without-import', false]]) {
    reports.push(await runCase(name, async () => {
      const proofDir = join(dir, 'proof', fixtureName);
      const { adapter } = adapterFor(fixture);
      const result = await runFrontendInvocation({ frontend: kernel, adapter, root: join(proofDir, 'PROOF.bend'), phases: ['parse', 'check', 'completion'], comp });
      const report = reportOf(name, result, adapter, { calls: compCalls.length, ownerAfter: kernel.bendHookOwner(), sessionClosed: adapter.currentSession() === null });
      const gate = report.gates.filter((entry) => entry.gate === 'proofLawsRule');
      check(report, 'the PROOF/LAWS gate was recorded', gate.length >= 1, report.gates);
      check(report, `the gate reports imported=${String(expectImported)}`, gate.some((entry) => (entry.completed === true) === expectImported), gate);
      if (expectImported) {
        check(report, 'completion was entered', report.phasesRun.includes('completion'), report.phasesRun);
        check(report, 'the completion check ran', compCalls.length >= 1, compCalls);
      } else {
        check(report, 'completion was not entered', !report.phasesRun.includes('completion'), report.phasesRun);
        check(report, 'the refusal names the missing import', report.outcome !== null && report.outcome.rendered === 'PROOF.bend must import ./LAWS.bend', report.outcome);
      }
      check(report, 'the hook was released and the session closed', report.ownerAfter === '' && report.sessionClosed === true, { ownerAfter: report.ownerAfter, closed: report.sessionClosed });
      return report;
    }));
  }

  reports.push(await runCase('holes-refused', async () => {
    const { adapter } = adapterFor(fixture);
    const result = await runFrontendInvocation({ frontend: kernel, adapter, root: join(dir, 'holes.bend'), phases: ['parse', 'check', 'completion'], comp });
    const report = reportOf('holes-refused', result, adapter, { ownerAfter: kernel.bendHookOwner(), sessionClosed: adapter.currentSession() === null });
    check(report, 'parse and check ran', report.phasesRun.includes('parse') && report.phasesRun.includes('check'), report.phasesRun);
    check(report, 'a completion gate outcome was reached', report.outcome !== null && report.outcome.gate !== undefined, report.outcome);
    check(report, 'the real thrown value is retained', report.outcome !== null && report.outcome.thrownIsValue === true, report.outcome);
    check(report, 'the hook was released and the session closed', report.ownerAfter === '' && report.sessionClosed === true, { ownerAfter: report.ownerAfter, closed: report.sessionClosed });
    return report;
  }));

  reports.push(await runCase('second-adapter-refused', async () => {
    const first = adapterFor(fixture);
    const second = adapterFor(fixture);
    const install = kernel.bendHooks(first.adapter.sink, 'harness-owner');
    const result = await runFrontendInvocation({ frontend: kernel, adapter: second.adapter, root: join(dir, 'valid.bend'), phases: ['parse'] });
    const report = reportOf('second-adapter-refused', result, second.adapter, {
      install,
      ownerDuringRefusal: kernel.bendHookOwner(),
      firstSessionClosed: first.adapter.currentSession() === null,
      secondSessionClosed: second.adapter.currentSession() === null,
    });
    check(report, 'another owner holds the hook', report.ownerDuringRefusal === 'harness-owner', report.ownerDuringRefusal);
    check(report, 'the second invocation is refused', report.status === 'rejected' && report.reason === 'frontendOwned', { status: report.status, reason: report.reason });
    check(report, 'the second session was closed', report.secondSessionClosed === true, report.secondSessionClosed);
    check(report, 'the first invocation sink was not disturbed', first.adapter.currentSession() === null, first.adapter.currentSession());
    kernel.bendHooks(null, 'harness-owner');
    const after = await runFrontendInvocation({ frontend: kernel, adapter: second.adapter, root: join(dir, 'valid.bend'), phases: ['parse'] });
    check(report, 'a later invocation starts normally', after.status === 'completed', after.status);
    check(report, 'the hook is released afterwards', kernel.bendHookOwner() === '', kernel.bendHookOwner());
    return report;
  }));

  reports.push(await runCase('throwing-install-session-closed', async () => {
    const { adapter } = adapterFor(fixture);
    const throwing = new Proxy(kernel, {
      get(target, property) {
        if (property === 'bendHooks') return () => { throw new Error('hook installation refused by the consumer'); };
        return target[property];
      },
    });
    const result = await runFrontendInvocation({ frontend: throwing, adapter, root: join(dir, 'valid.bend'), phases: ['parse'] });
    const report = reportOf('throwing-install-session-closed', result, adapter, { sessionClosed: adapter.currentSession() === null, ownerAfter: kernel.bendHookOwner() });
    check(report, 'the run fails at installation', report.status === 'failed', report.status);
    check(report, 'the session was closed', report.sessionClosed === true, report.sessionClosed);
    check(report, 'the kernel hook is untouched', report.ownerAfter === '', report.ownerAfter);
    const after = await runFrontendInvocation({ frontend: kernel, adapter, root: join(dir, 'valid.bend'), phases: ['parse'] });
    check(report, 'a subsequent invocation starts', after.status === 'completed', after.status);
    return report;
  }));

  reports.push(await runCase('ownerless-install-refused', async () => {
    const { adapter } = adapterFor(fixture);
    const install = kernel.bendHooks(adapter.sink);
    const report = { name: 'ownerless-install-refused', status: 'checked', assertions: [], failed: false };
    check(report, 'an ownerless installation is refused', install.status === 'refused' && install.reason === 'ownerRequired', install);
    check(report, 'no owner was recorded', kernel.bendHookOwner() === '', kernel.bendHookOwner());
    return report;
  }));

  return reports;
}

async function main() {
  const inputs = pinnedInputs();
  const derived = materialize(inputs);
  const fixture = fixtures(inputs.base);
  const kernel = await import(pathToFileURL(join(derived.dir, 'bend.ts')).href);
  const compModule = await import(pathToFileURL(join(derived.dir, 'comp.ts')).href);
  const reports = await cases(kernel, compModule, fixture, inputs, derived);
  const failed = reports.filter((report) => report.failed === true);
  emitAndExit(JSON.stringify({
    upstreamPin: UPSTREAM_PIN,
    derivedDigests: { bend: derived.bend.outputDigest, main: derived.main.outputDigest },
    fixtureDir: process.env.BATON2_FIXTURE_DIR,
    cases: reports,
    failedCases: failed.map((report) => ({ name: report.name, failedClaims: report.assertions.filter((entry) => entry.ok !== true).map((entry) => entry.claim) })),
  }, null, 2), failed.length === 0 ? 0 : 1);
}

await main();
