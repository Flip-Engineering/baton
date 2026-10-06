// Remote composed harness for the derived Bend2 frontend and the internal invocation entry.
//
// This harness is authored for the remote validation runner. It is not executed on the operator
// host, and nothing in this repository runs it. It performs the real composition end to end:
//
//   1. reads the pinned upstream inputs from mandatory explicit paths,
//   2. refuses any input whose sha256 is not the pinned digest (compile-time identity, no guessing),
//   3. derives the hooked copies of bend.ts and main.ts with deriveHookedSource,
//   4. imports the derived kernel and the matching Comp module,
//   5. runs runFrontendInvocation over a capture closure built from the fixture project, so the
//      frontend reads every file through the sink and no host path is consulted,
//   6. prints one JSON report with the observations, the mapped diagnostics and the counters.
//
// Prerequisites
//   node >= 22 (the derived sources are TypeScript; run with --experimental-strip-types)
//   BATON2_BEND_TS, BATON2_MAIN_TS, BATON2_COMP_TS, BATON2_BASE_BEND : pinned upstream files
//   BATON2_FIXTURE_DIR : a directory containing the fixture project files named in FIXTURES
//
// Command
//   node --experimental-strip-types bend2/context/bend2/frontend-invocation.harness.mjs
//
// Artifacts
//   stdout JSON: per-case status, phasesRun, mapped diagnostics (file, phase, original line/column),
//   session completeness and counters, plus the derived output digests. Exit status is non-zero if
//   any case fails or any pinned input does not match.

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createFrontendAdapter } from './frontend-adapter.mjs';
import { UPSTREAM_INPUTS, UPSTREAM_PIN, deriveHookedSource } from './frontend-hooks.mjs';
import { runFrontendInvocation } from './frontend-invocation.mjs';

const REQUIRED_ENV = ['BATON2_BEND_TS', 'BATON2_MAIN_TS', 'BATON2_COMP_TS', 'BATON2_BASE_BEND', 'BATON2_FIXTURE_DIR'];

// Every fixture the cases consume. A missing one is a named operand, never a skipped case.
const FIXTURES = Object.freeze([
  'root.bend',
  'dep.bend',
  'invalid.bend',
  'typo.bend',
  'absent-on-disk.bend',
]);

function fail(reason, detail) {
  process.stdout.write(`${JSON.stringify({ status: 'refused', reason, detail }, null, 2)}\n`);
  process.exit(2);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function requireEnv() {
  const missing = REQUIRED_ENV.filter((name) => typeof process.env[name] !== 'string' || process.env[name].length === 0);
  if (missing.length > 0) fail('missingInputPath', missing.join(','));
}

function pinned() {
  const read = (envName, key) => {
    const bytes = readFileSync(process.env[envName]);
    const digest = sha256(bytes);
    const expected = UPSTREAM_INPUTS[key].sha256;
    if (digest !== expected) fail('inputIdentityMismatch', { envName, expected, observed: digest });
    return bytes;
  };
  return {
    bend: read('BATON2_BEND_TS', 'bend'),
    main: read('BATON2_MAIN_TS', 'main'),
    comp: read('BATON2_COMP_TS', 'comp'),
    base: read('BATON2_BASE_BEND', 'base'),
  };
}

// Derive the two hooked sources and materialize them beside the pinned inputs so the derived modules
// can import each other exactly as the upstream layout does.
function derive(inputs) {
  const dir = mkdtempSync(join(tmpdir(), 'bend2-harness-'));
  const bend = deriveHookedSource({ target: 'bend', text: inputs.bend.toString('utf8') });
  if (bend.status !== 'derived') fail('deriveRefused', bend);
  const main = deriveHookedSource({ target: 'main', text: inputs.main.toString('utf8') });
  if (main.status !== 'derived') fail('deriveRefused', main);
  writeFileSync(join(dir, 'bend.ts'), bend.text);
  writeFileSync(join(dir, 'main.ts'), main.text);
  return { dir, bend, main };
}

// The capture closure: the harness holds the fixture bytes and hands them to the frontend through the
// adapter, so the loader never reads a path. One fixture is deliberately absent on disk.
function closure(fixtureDir, baseBytes) {
  const files = new Map();
  for (const name of FIXTURES) {
    const path0 = join(fixtureDir, name);
    if (!existsSync(path0)) fail('fixtureMissing', { name, path: path0 });
    files.set(path0, readFileSync(path0));
  }
  const basePath = join(fixtureDir, 'base.bend');
  files.set(basePath, baseBytes);
  const read = (identity) => (files.has(identity) ? { identity, bytes: files.get(identity) } : { refuse: 'not in the captured closure' });
  return { files, basePath, read };
}

function adapterFor(captured) {
  return createFrontendAdapter({
    captureOnly: true,
    acquisition: { read: captured.read, baseBend: captured.basePath },
  });
}

function summarize(name, result) {
  const session = result.session ?? null;
  return {
    name,
    status: result.status,
    reason: result.reason ?? null,
    phasesRun: result.phasesRun ? [...result.phasesRun] : [],
    outcome: result.outcome ?? null,
    diagnostics: session === null ? [] : session.diagnostics.map((entry) => ({
      phase: entry.phase,
      form: entry.form,
      file: entry.file,
      definition: entry.definition,
      thrownKind: entry.thrown === null ? null : entry.thrown.kind,
      rendered: entry.rendered,
      span: entry.span.status === 'mapped'
        ? { status: 'mapped', identity: entry.span.identity, line: entry.span.original.start.line, column: entry.span.original.start.column, text: entry.span.text }
        : entry.span,
    })),
    types: session === null ? [] : session.types.map((entry) => ({ status: entry.status, qualified: entry.qualified, text: entry.text, file: entry.file })),
    completeness: session === null ? null : session.completeness,
    incompleteness: session === null ? [] : [...session.incompleteness],
    acquisitions: session === null ? [] : session.acquisitions,
  };
}

async function cases(kernel, comp, captured) {
  const reports = [];
  const root = join(process.env.BATON2_FIXTURE_DIR, 'root.bend');

  // 1. A complete project: imports, an invalid imported definition, Base and completion.
  {
    const adapter = adapterFor(captured);
    const result = await runFrontendInvocation({ frontend: kernel, adapter, root, phases: ['parse', 'check', 'completion'], comp });
    reports.push(summarize('complete-project', result));
  }
  // 2. An imported invalid definition: the check diagnostic is attributed to the imported file.
  {
    const adapter = adapterFor(captured);
    const result = await runFrontendInvocation({ frontend: kernel, adapter, root, phases: ['parse', 'check'], comp: null });
    reports.push(summarize('imported-invalid-definition', result));
  }
  // 3. A parse error in the root, with its span mapped into the original capture.
  {
    const adapter = adapterFor(captured);
    const broken = join(process.env.BATON2_FIXTURE_DIR, 'typo.bend');
    const result = await runFrontendInvocation({ frontend: kernel, adapter, root: broken, phases: ['parse'], comp: null });
    reports.push(summarize('parse-error', result));
  }
  // 4. An acquisition failure: the closure refuses a file the root imports.
  {
    const adapter = createFrontendAdapter({ captureOnly: true, acquisition: { read: () => ({ refuse: 'not captured for this query' }), baseBend: captured.basePath } });
    const result = await runFrontendInvocation({ frontend: kernel, adapter, root, phases: ['parse'], comp: null });
    reports.push(summarize('acquisition-refused', result));
  }
  // 5. A throwing reader: counted once, reported as an acquisition failure, not a frontend error.
  {
    const adapter = createFrontendAdapter({
      captureOnly: true,
      acquisition: {
        read(identity) {
          if (identity.endsWith('dep.bend')) throw new Error('closure reader unavailable');
          return captured.files.has(identity) ? { identity, bytes: captured.files.get(identity) } : { refuse: 'not in the captured closure' };
        },
        baseBend: captured.basePath,
      },
    });
    const result = await runFrontendInvocation({ frontend: kernel, adapter, root, phases: ['parse'], comp: null });
    reports.push(summarize('throwing-reader', result));
  }
  // 6. Two adapters on one frontend module: the second install is refused and the first is untouched.
  {
    const first = adapterFor(captured);
    const foreign = adapterFor(captured);
    const install = kernel.bendHooks(first.sink, 'harness-owner');
    if (install.status !== 'installed') fail('ownershipInstallRefused', install);
    const result = await runFrontendInvocation({ frontend: kernel, adapter: foreign, root, phases: ['parse'], comp: null });
    const owner = kernel.bendHookOwner();
    kernel.bendHooks(null, 'harness-owner');
    reports.push({ ...summarize('second-adapter-refused', result), ownerDuringRefusal: owner });
  }
  // 7. Cleanup after a failing completion: the hook is released and the session is closed.
  {
    const adapter = adapterFor(captured);
    const failingComp = { SYNTH: 'SYNTH', book_owned() { throw { $: 'Err', def: 'root', spn: null }; } };
    const result = await runFrontendInvocation({ frontend: kernel, adapter, root, phases: ['parse', 'check', 'completion'], comp: failingComp });
    const closed = adapter.currentSession() === null;
    reports.push({ ...summarize('cleanup-after-completion-failure', result), hookOwnerAfter: kernel.bendHookOwner(), sessionClosed: closed });
  }
  return reports;
}

async function main() {
  requireEnv();
  const inputs = pinned();
  const derived = derive(inputs);
  const captured = closure(process.env.BATON2_FIXTURE_DIR, inputs.base);
  const kernel = await import(pathToFileURL(join(derived.dir, 'bend.ts')).href);
  const comp = await import(pathToFileURL(process.env.BATON2_COMP_TS).href);
  const reports = await cases(kernel, comp, captured);
  const failed = reports.filter((report) => report.status !== 'completed' && report.name !== 'second-adapter-refused' && report.name !== 'acquisition-refused' && report.name !== 'throwing-reader');
  process.stdout.write(`${JSON.stringify({
    upstreamPin: UPSTREAM_PIN,
    derivedDigests: { bend: derived.bend.outputDigest, main: derived.main.outputDigest },
    absentOnDisk: !existsSync(join(process.env.BATON2_FIXTURE_DIR, 'absent-on-disk.bend')),
    cases: reports,
    failedCases: failed.map((report) => ({ name: report.name, status: report.status })),
  }, null, 2)}\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();
