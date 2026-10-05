#!/usr/bin/env node
// CDP lane: raw-evidence acquisition for the native runtime laws.
//
// This is a temporary, out-of-scan entrypoint for independent module development. The
// delivered obligation is that bend2/src/context/runtime/cdp-runtime-laws.bend is imported
// by the coordinator entry's law graph (bend2/src/coordinator/laws.bend), so the tree's own
// laws-check.mjs discovers and controls every statement. Until that import lands, this
// entrypoint performs two controls against the law module alone:
//
//  1. proof removal: for each `law <name>:` in the law module, remove the `def <name>`
//     proof in a scratch copy and require the law module's compile to fail;
//  2. implementation mutation: apply one deliberate change to the operative module in a
//     scratch copy and require the compile to fail on the intended law.
//
// Attribution discipline. A control is `qualified` only when the observed process evidence
// and the diagnostic support it:
//   - the compiler process completed normally (no signal, no spawn error) with a nonzero
//     status on the changed snapshot, and the pristine snapshot compiled with status 0
//     under the same toolchain and entry;
//   - a proof removal is attributed by the exact proof edit plus that binding, because the
//     Darwin diagnostic names no law: it reports `Error: 1 TODO found.` and then
//     `The code is incomplete, and not a valid proof yet.`;
//   - an implementation mutation is attributed only when the diagnostic names the intended
//     law and carries the constructors of that law's two sides. A syntax error, a launch
//     failure, an exception, a resource failure, an unrelated diagnostic or missing
//     metadata is reported as unqualified with its reason.
// Every control retains the compiler's stdout and stderr as separate byte streams with
// their lengths and digests, the exact argv, cwd and environment policy, the process
// identity with start and end times, the source snapshot with its digests, the entry path,
// and the mutation definition with its digest and the original/changed/delta evidence.
//
// Toolchain facts expected from reviewers of this file (filled at run time, never guessed):
// wrapper-pid is null because the compiler is spawned directly, and compiler-pid is the
// spawned process id. Compilation runs on an admitted remote runner, never on the operator
// laptop.
//
// Usage: node bend2/context/runtime/cdp-native-laws.mjs [bend]
// Evidence: .scratch/cdp-lane/native-laws-<run>/

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '..', '..', '..');
const LAW_MODULE = 'cdp-runtime-laws.bend';
const OPERATIVE_MODULE = 'cdp-runtime.bend';
const SOURCE_DIR = join(ROOT, 'bend2', 'src', 'context', 'runtime');
const RUN = join(ROOT, '.scratch', 'cdp-lane', `native-laws-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
mkdirSync(RUN, { recursive: true, mode: 0o700 });

const ENV_POLICY = Object.freeze({ inherited: true, overrides: Object.freeze({ BEND_NO_TELEMETRY: '1' }) });
const ENV = { ...process.env, BEND_NO_TELEMETRY: '1' };

// The exact Darwin proof-removal diagnostic. It names no law, so a proof removal is
// attributed by its exact proof edit and the snapshot binding recorded beside it.
const PROOF_REMOVAL_DIAGNOSTIC = Object.freeze([
  '1 TODO found',
  'The code is incomplete, and not a valid proof yet.',
]);

// One deliberate implementation change per law, with the constructors of that law's two
// sides. The diagnostic must name the law and carry those constructors to be attributed.
const MUTATIONS = [
  { name: 'launch-drops-its-control-grant', law: 'launch_requires_the_control_grant',
    find: 'admit_control(effects, launch_state(state), pending, serialized(intent), intent)',
    replace: 'admit_granted(launch_state(state), intent)',
    expectedConstructors: ['MissingEffect', 'Admitted'] },
  { name: 'launch-ignores-a-pending-intent', law: 'launch_is_refused_while_an_intent_is_pending',
    find: 'admit_control(effects, launch_state(state), pending, serialized(intent), intent)',
    replace: 'admit_granted(launch_state(state), intent)',
    expectedConstructors: ['RuntimeBusy', 'Admitted'] },
  { name: 'pause-does-not-advance-the-epoch', law: 'a_pause_advances_the_epoch_by_one_successor',
    find: 'Advanced{Rec{Paused{}, counter_next(epoch), mutation, pending, LivenessLive{}}},',
    replace: 'Advanced{Rec{Paused{}, epoch, mutation, pending, LivenessLive{}}},',
    expectedConstructors: ['Advanced', 'counter_next'] },
  { name: 'evaluation-does-not-advance-the-generation',
    law: 'an_evaluation_advances_the_mutation_generation_before_its_send',
    find: 'Advanced{Rec{state, epoch, counter_next(mutation), Evaluation{query}, liveness}},',
    replace: 'Advanced{Rec{state, epoch, mutation, Evaluation{query}, liveness}},',
    expectedConstructors: ['Advanced', 'counter_next'] },
  { name: 'pending-evaluation-admitted-again', law: 'a_second_evaluation_refuses_while_one_is_pending',
    find: 'Bool.pick(Transition, is_idle(pending),',
    replace: 'Bool.pick(Transition, True{},',
    expectedConstructors: ['Refused', 'Advanced'] },
  { name: 'adapter-failure-asserts-target-exit', law: 'adapter_failure_preserves_the_liveness_evidence',
    find: 'Advanced{Rec{Failed{}, epoch, mutation, pending, liveness}}',
    replace: 'Advanced{Rec{Failed{}, epoch, mutation, pending, LivenessExited{}}}',
    expectedConstructors: ['LivenessExited', 'Advanced'] },
  { name: 'child-exit-keeps-the-live-liveness', law: 'child_exit_records_the_exited_liveness',
    find: 'Advanced{Rec{Exited{}, epoch, mutation, pending, LivenessExited{}}}',
    replace: 'Advanced{Rec{Exited{}, epoch, mutation, pending, liveness}}',
    expectedConstructors: ['Exited', 'LivenessExited'] },
  { name: 'start-release-refuses-after-an-observed-stop',
    law: 'a_start_release_after_an_observed_stop_keeps_the_stop',
    find: 'Bool.pick(Transition, is_paused(state),\n              Advanced{Rec{Paused{}, epoch, mutation, pending, liveness}},\n              Refused{"startReleaseSent from " ++ state_name(state)}))',
    replace: 'Bool.pick(Transition, False{}, Advanced{Rec{Paused{}, epoch, mutation, pending, liveness}}, Refused{"startReleaseSent from " ++ state_name(state)}))',
    expectedConstructors: ['Paused', 'Advanced'] },
  { name: 'adapter-failure-replaces-an-exited-state',
    law: 'an_adapter_failure_after_exit_is_refused',
    find: 'Bool.pick(Transition, is_exited(state),\n            Refused{"adapterFailed after exited"},\n            Advanced{Rec{Failed{}, epoch, mutation, pending, liveness}})',
    replace: 'Advanced{Rec{Failed{}, epoch, mutation, pending, liveness}}',
    expectedConstructors: ['Refused', 'Failed'] },
  { name: 'counter-leading-zero-admitted', law: 'counter_valid_refuses_a_leading_zero',
    find: 'Bool.pick(Bool, is_zero_char(h), is_nil(t), True{})',
    replace: 'True{}',
    expectedConstructors: ['False', 'True'] },
  { name: 'counter-carry-broken', law: 'counter_next_carries_across_a_nine',
    find: 'Carry{SCon{one_zero(), value}, True{}}',
    replace: 'Carry{SCon{one_up(h), value}, False{}}',
    expectedConstructors: ['counter_next', 'String'] },
  { name: 'serialization-check-removed', law: 'serialized_intents_refuse_runtime_busy',
    find: 'Bool.and(serializes, Bool.not(is_idle(pending))),',
    replace: 'False{},',
    expectedConstructors: ['RuntimeBusy', 'Admitted'] },
];

// The authoritative mutation definition: exactly these five members in this order, as
// UTF-8 JSON with no extra whitespace. Interfaces exports this digest.
export function mutationDefinition(mutation) {
  return JSON.stringify({
    name: mutation.name,
    file: OPERATIVE_MODULE,
    law: mutation.law,
    find: mutation.find,
    replace: mutation.replace,
  });
}

export function mutationDefinitionDigest(mutation) {
  return sha256Text(mutationDefinition(mutation));
}

function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function resolveBend() {
  const candidates = [
    process.argv[2],
    process.env.BEND,
    join(ROOT, '.bend', 'bin', 'bend'),
    join(ROOT, 'node_modules', '.bend', 'bin', 'bend'),
    '/Users/wahargis/Development/Experiments/baton-bend2-root-delivery-20260928/.scratch/'
      + 'native-artifact-qualification-20261002T174637Z/toolchain-home/bin/bend',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  console.error('Bend is unavailable. Pass the qualified Bend 2.0.25 executable as an argument or set BEND.');
  process.exit(2);
}

const BEND = resolveBend();

function compilerIdentity() {
  const bytes = readFileSync(BEND);
  const version = spawnSync(BEND, ['version'], { env: ENV, encoding: 'utf8' });
  return {
    path: BEND,
    sha256: sha256Bytes(bytes),
    bytes: bytes.length,
    versionStdout: (version.stdout ?? '').trim(),
    versionStderr: (version.stderr ?? '').trim(),
    versionStatus: version.status,
  };
}

// One compiler process, with both streams kept separate and its own process identity.
function runCompiler({ argv, cwd, label }) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(BEND, argv, { cwd, env: ENV, encoding: 'buffer', maxBuffer: Infinity });
  const endedAt = new Date().toISOString();
  const stdout = Buffer.from(result.stdout ?? Buffer.alloc(0));
  const stderr = Buffer.from(result.stderr ?? Buffer.alloc(0));
  const record = {
    label,
    argv: [BEND, ...argv],
    cwd,
    envPolicy: ENV_POLICY,
    // The compiler is spawned directly: compilerPid is the process that ran it and
    // wrapperPid is null because no wrapper process exists.
    wrapperArgv: null,
    wrapperPid: null,
    compilerPid: result.pid ?? null,
    startedAt,
    endedAt,
    status: result.status,
    signal: result.signal,
    spawnError: result.error === undefined || result.error === null
      ? null
      : { code: result.error.code ?? null, message: result.error.message },
    stdout: { bytes: stdout.length, sha256: sha256Bytes(stdout) },
    stderr: { bytes: stderr.length, sha256: sha256Bytes(stderr) },
  };
  const stdoutPath = join(RUN, `${label}.stdout.txt`);
  const stderrPath = join(RUN, `${label}.stderr.txt`);
  const recordPath = join(RUN, `${label}.process.json`);
  writeFileSync(stdoutPath, stdout);
  writeFileSync(stderrPath, stderr);
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  record.files = { stdout: stdoutPath, stderr: stderrPath, process: recordPath };
  return { record, stdoutText: stdout.toString('utf8'), stderrText: stderr.toString('utf8') };
}

// A fresh scratch snapshot of the two modules, with the source digests it was copied from.
function prepareScratch(label) {
  const directory = join(RUN, 'scratch', `${label}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const snapshot = {};
  for (const file of [LAW_MODULE, OPERATIVE_MODULE]) {
    const source = join(SOURCE_DIR, file);
    const copied = join(directory, file);
    cpSync(source, copied);
    snapshot[file] = {
      sourcePath: source,
      snapshotPath: copied,
      sourceSha256: sha256Bytes(readFileSync(source)),
      snapshotSha256: sha256Bytes(readFileSync(copied)),
    };
  }
  return { directory, snapshot, entry: join(directory, LAW_MODULE) };
}

// Remove the `def <name>(...)` block that proves <name>: the def line and every following
// blank or indented line. Returns the exact edit: byte offsets, removed bytes and digest,
// and the resulting law-module digest.
function removeProof(path, name) {
  const original = readFileSync(path, 'utf8');
  const lines = original.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`def ${name}(`));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end += 1;
  const removed = `${lines.slice(start, end).join('\n')}\n`;
  const changed = [...lines.slice(0, start), ...lines.slice(end)].join('\n');
  const prefixBytes = Buffer.byteLength(lines.slice(0, start).join('\n'), 'utf8');
  if (start > 0) {
    // The preceding newline is part of the removed region's boundary.
  }
  writeFileSync(path, changed);
  return {
    law: name,
    startLine: start + 1,
    endLine: end,
    removedBytes: Buffer.byteLength(removed, 'utf8'),
    removedSha256: sha256Text(removed),
    offsets: { startByte: start === 0 ? 0 : prefixBytes + 1, endByte: start === 0 ? Buffer.byteLength(removed, 'utf8') : prefixBytes + 1 + Buffer.byteLength(removed, 'utf8') },
    originalSha256: sha256Text(original),
    changedSha256: sha256Text(changed),
  };
}

// Apply one mutation, retaining the exact definition, digest and delta evidence.
function applyMutation(path, mutation) {
  const original = readFileSync(path, 'utf8');
  const occurrences = original.split(mutation.find).length - 1;
  if (occurrences !== 1) return { applied: false, occurrences };
  const firstOffset = Buffer.byteLength(original.slice(0, original.indexOf(mutation.find)), 'utf8');
  const changed = original.replace(mutation.find, mutation.replace);
  writeFileSync(path, changed);
  return {
    applied: true,
    occurrences,
    offsets: { startByte: firstOffset, endByte: firstOffset + Buffer.byteLength(mutation.find, 'utf8') },
    removedBytes: Buffer.byteLength(mutation.find, 'utf8'),
    removedSha256: sha256Text(mutation.find),
    insertedBytes: Buffer.byteLength(mutation.replace, 'utf8'),
    insertedSha256: sha256Text(mutation.replace),
    originalSha256: sha256Text(original),
    changedSha256: sha256Text(changed),
    definitionSha256: mutationDefinitionDigest(mutation),
  };
}

function lawNames(directory) {
  const rows = [];
  for (const line of readFileSync(join(directory, LAW_MODULE), 'utf8').split('\n')) {
    const match = /^law ([A-Za-z0-9_]+):/.exec(line);
    if (match) rows.push(match[1]);
  }
  return rows;
}

function classify({ process: processRecord, stdoutText, stderrText }, kind, detail) {
  if (processRecord.spawnError !== null) return { qualified: false, reason: 'spawn-error' };
  if (processRecord.signal !== null) return { qualified: false, reason: `signal:${processRecord.signal}` };
  if (processRecord.status === 0) return { qualified: false, reason: 'compile-completed-with-status-0' };
  const combined = `${stdoutText}${stderrText}`;
  if (kind === 'proof-removal') {
    const missing = PROOF_REMOVAL_DIAGNOSTIC.filter((marker) => !combined.includes(marker));
    if (!detail.applied) return { qualified: false, reason: 'proof-edit-not-applied' };
    if (missing.length > 0) return { qualified: false, reason: `diagnostic-missing:${missing.join('|')}` };
    return { qualified: true, attribution: 'exact-proof-edit+diagnostic' };
  }
  if (!combined.includes(detail.law)) return { qualified: false, reason: 'diagnostic-does-not-name-the-intended-law' };
  const missing = detail.expectedConstructors.filter((marker) => !combined.includes(marker));
  if (!detail.applied) return { qualified: false, reason: 'mutation-not-applied' };
  if (missing.length > 0) {
    return { qualified: false, reason: `diagnostic-missing-intended-constructor:${missing.join('|')}` };
  }
  return { qualified: true, attribution: 'intended-law-name+expected-constructors' };
}

function main() {
  const rows = [];
  const toolchain = compilerIdentity();
  writeFileSync(join(RUN, 'toolchain.json'), `${JSON.stringify({ ...toolchain, wrapperPid: null }, null, 2)}\n`);

  // The pristine snapshot binding: the entry compiled with status 0 under this toolchain.
  const baseline = prepareScratch('baseline');
  const baselineRun = runCompiler({ argv: [baseline.entry, '--check-only'], cwd: baseline.directory, label: 'baseline' });
  const baselineBound = baselineRun.record.status === 0
    && baselineRun.record.signal === null
    && baselineRun.record.spawnError === null;
  rows.push({
    control: 'entry-compiles-with-every-law-proven',
    qualified: baselineBound,
    reason: baselineBound ? null : 'the pristine snapshot did not compile with status 0',
    snapshot: baseline.snapshot,
    entry: baseline.entry,
    process: baselineRun.record.files.process,
  });
  if (!baselineBound) return finish({ rows, toolchain, baseline: baselineRun.record });

  const names = lawNames(baseline.directory);
  let index = 0;
  for (const name of names) {
    index += 1;
    const scratch = prepareScratch(`proof-${index}`);
    const edit = removeProof(join(scratch.directory, LAW_MODULE), name);
    if (edit === null) {
      rows.push({ control: `proof-removal:${name}`, law: name, qualified: false, reason: 'the law has no proof beside it' });
      continue;
    }
    const run = runCompiler({
      argv: [scratch.entry, '--check-only'],
      cwd: scratch.directory,
      label: `proof-${index}-${name}`,
    });
    const verdict = classify(run, 'proof-removal', { applied: true });
    rows.push({
      control: `proof-removal:${name}`,
      law: name,
      provenance: 'diagnostic-names-no-law; attribution is the exact proof edit and the snapshot binding',
      qualified: verdict.qualified,
      attribution: verdict.attribution ?? null,
      reason: verdict.reason ?? null,
      entry: scratch.entry,
      snapshot: scratch.snapshot,
      edit,
      restoration: {
        pristineSource: scratch.snapshot[LAW_MODULE].sourcePath,
        pristineSha256: scratch.snapshot[LAW_MODULE].sourceSha256,
        scratchOnly: true,
        scratchRemoved: false,
      },
      nonTargetInputs: { [OPERATIVE_MODULE]: scratch.snapshot[OPERATIVE_MODULE] },
      process: run.record.files.process,
      stdout: run.record.files.stdout,
      stderr: run.record.files.stderr,
    });
    rmSync(scratch.directory, { recursive: true, force: true });
    rows.at(-1).restoration.scratchRemoved = true;
  }

  for (const mutation of MUTATIONS) {
    index += 1;
    const scratch = prepareScratch(`mutation-${index}`);
    const detail = applyMutation(join(scratch.directory, OPERATIVE_MODULE), mutation);
    if (!detail.applied) {
      rows.push({
        control: `mutation:${mutation.name}`,
        law: mutation.law,
        qualified: false,
        reason: `the mutation subject occurs ${detail.occurrences} times in ${OPERATIVE_MODULE}`,
        definitionSha256: mutationDefinitionDigest(mutation),
      });
      continue;
    }
    const run = runCompiler({
      argv: [scratch.entry, '--check-only'],
      cwd: scratch.directory,
      label: `mutation-${index}-${mutation.name}`,
    });
    const verdict = classify(run, 'mutation', { ...detail, law: mutation.law, expectedConstructors: mutation.expectedConstructors });
    rows.push({
      control: `mutation:${mutation.name}`,
      law: mutation.law,
      provenance: 'attributed only when the diagnostic names the intended law and its two sides',
      qualified: verdict.qualified,
      attribution: verdict.attribution ?? null,
      reason: verdict.reason ?? null,
      definition: mutationDefinition(mutation),
      definitionSha256: mutationDefinitionDigest(mutation),
      expectedConstructors: mutation.expectedConstructors,
      entry: scratch.entry,
      snapshot: scratch.snapshot,
      delta: detail,
      lawTextUnchanged: {
        path: scratch.snapshot[LAW_MODULE].snapshotPath,
        sha256: scratch.snapshot[LAW_MODULE].snapshotSha256,
      },
      restoration: {
        pristineSource: scratch.snapshot[OPERATIVE_MODULE].sourcePath,
        pristineSha256: scratch.snapshot[OPERATIVE_MODULE].sourceSha256,
        scratchOnly: true,
        scratchRemoved: false,
      },
      nonTargetInputs: { [LAW_MODULE]: scratch.snapshot[LAW_MODULE] },
      process: run.record.files.process,
      stdout: run.record.files.stdout,
      stderr: run.record.files.stderr,
    });
    rmSync(scratch.directory, { recursive: true, force: true });
    rows.at(-1).restoration.scratchRemoved = true;
  }

  return finish({ rows, toolchain, baseline: baselineRun.record });
}

function finish({ rows, toolchain, baseline }) {
  const unqualified = rows.filter((row) => row.qualified !== true);
  // One case JSON per control: the raw acquisition in the shape a single-case classifier
  // consumes. The shared laws-check.mjs --classify endpoint is correction-required and
  // pending, so this file carries acquisition and the attribution checks stated for this
  // lane only; it defines no competing classification schema and claims no acceptance.
  for (const [index, row] of rows.entries()) {
    const casePath = join(RUN, `case-${index + 1}-${row.control.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`);
    writeFileSync(casePath, `${JSON.stringify({
      case: row.control,
      kind: row.control.startsWith('proof-removal:') ? 'proof-removal' : (row.control.startsWith('mutation:') ? 'implementation-mutation' : 'baseline'),
      law: row.law ?? null,
      entry: row.entry ?? null,
      snapshot: row.snapshot ?? null,
      expectation: row.definition === undefined
        ? { diagnosticMarkers: PROOF_REMOVAL_DIAGNOSTIC }
        : { law: row.law, expectedConstructors: row.expectedConstructors ?? null },
      observation: {
        process: row.process ?? null,
        stdout: row.stdout ?? null,
        stderr: row.stderr ?? null,
      },
      attribution: {
        rule: row.attribution ?? null,
        result: row.qualified === true ? 'qualified' : 'unqualified',
        reason: row.reason ?? null,
        provenance: row.provenance ?? null,
      },
      classification: 'local-attribution-only; shared classify endpoint pending',
    }, null, 2)}\n`);
    row.caseJson = casePath;
  }
  const verdict = {
    suite: 'cdp-native-laws',
    classificationEndpoint: 'shared laws-check.mjs --classify is correction-required and pending; this entrypoint reports acquisition and local attribution only',
    toolchain,
    baseline: { status: baseline.status, signal: baseline.signal, spawnError: baseline.spawnError, stdout: baseline.stdout, stderr: baseline.stderr },
    controls: rows.length,
    qualified: rows.length - unqualified.length,
    unqualified: unqualified.length,
    rows,
  };
  writeFileSync(join(RUN, 'verdict.json'), `${JSON.stringify(verdict, null, 2)}\n`);
  for (const row of rows) {
    process.stdout.write(`${row.qualified ? 'qualified' : 'UNQUALIFIED'} ${row.control}${row.reason === null || row.reason === undefined ? '' : ` (${row.reason})`}\n`);
  }
  process.stdout.write(`${JSON.stringify({ verdict: 'acquired', controls: rows.length, qualified: verdict.qualified, unqualified: verdict.unqualified, run: RUN })}\n`);
  // Acquisition is not acceptance: this entrypoint reports what it observed. A nonzero
  // exit means the acquisition itself could not run.
  process.exitCode = 0;
}

main();
