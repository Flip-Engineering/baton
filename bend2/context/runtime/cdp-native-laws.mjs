#!/usr/bin/env node
// CDP lane: the development control for the native runtime laws.
//
// This is a temporary, out-of-scan entrypoint for independent module development. The
// delivered obligation is that bend2/src/context/runtime/cdp-runtime-laws.bend is
// imported by the coordinator entry's law graph (bend2/src/coordinator/laws.bend), so the
// tree's own laws-check.mjs discovers and controls every statement. Until that import
// lands, this entrypoint performs the same two controls against the law module alone:
//
//  1. proof removal: for each `law <name>:` in the law module, remove the `def <name>`
//     proof in a scratch copy and require the law module's compile to fail;
//  2. implementation mutation: apply one deliberate change to the operative module in a
//     scratch copy and require the named law's compile to fail.
//
// Compilation runs on an admitted remote runner, never on the operator laptop.
//
// Usage: node bend2/context/runtime/cdp-native-laws.mjs [bend]
// Evidence: .scratch/cdp-lane/native-laws-<run>/verdict.json

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '..', '..', '..');
const LAW_MODULE = 'cdp-runtime-laws.bend';
const OPERATIVE_MODULE = 'cdp-runtime.bend';
const SOURCE_DIR = join(ROOT, 'bend2', 'src', 'context', 'runtime');
const RUN = join(ROOT, '.scratch', 'cdp-lane', `native-laws-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
mkdirSync(RUN, { recursive: true, mode: 0o700 });

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
const ENV = { ...process.env, BEND_NO_TELEMETRY: '1' };

// One deliberate implementation change per law.
const MUTATIONS = [
  { name: 'pause-does-not-advance-the-epoch', law: 'a_pause_advances_the_epoch_by_one_successor',
    find: 'Advanced{Rec{Paused{}, counter_next(epoch), mutation, pending, LivenessLive{}}},',
    replace: 'Advanced{Rec{Paused{}, epoch, mutation, pending, LivenessLive{}}},' },
  { name: 'evaluation-does-not-advance-the-generation',
    law: 'an_evaluation_advances_the_mutation_generation_before_its_send',
    find: 'Advanced{Rec{state, epoch, counter_next(mutation), Evaluation{query}, liveness}},',
    replace: 'Advanced{Rec{state, epoch, mutation, Evaluation{query}, liveness}},' },
  { name: 'pending-evaluation-admitted-again', law: 'a_second_evaluation_refuses_while_one_is_pending',
    find: 'Bool.pick(Transition, is_idle(pending),',
    replace: 'Bool.pick(Transition, True{},' },
  { name: 'adapter-failure-asserts-target-exit', law: 'adapter_failure_preserves_the_liveness_evidence',
    find: 'Advanced{Rec{Failed{}, epoch, mutation, pending, liveness}}',
    replace: 'Advanced{Rec{Failed{}, epoch, mutation, pending, LivenessExited{}}}' },
  { name: 'child-exit-keeps-the-live-liveness', law: 'child_exit_records_the_exited_liveness',
    find: 'Advanced{Rec{Exited{}, epoch, mutation, pending, LivenessExited{}}}',
    replace: 'Advanced{Rec{Exited{}, epoch, mutation, pending, liveness}}' },
  { name: 'signal-downgrade-admitted', law: 'sigterm_cannot_overwrite_an_explicit_sigkill_intent',
    find: 'Bool.and(String.eq(prior_signal, "SIGKILL"), String.eq(signal, "SIGTERM")),',
    replace: 'False{},' },
  { name: 'counter-leading-zero-admitted', law: 'counter_valid_refuses_a_leading_zero',
    find: 'Bool.pick(Bool, is_zero_char(h), is_nil(t), True{})',
    replace: 'True{}' },
  { name: 'counter-carry-broken', law: 'counter_next_carries_across_a_nine',
    find: 'Carry{SCon{one_zero(), value}, True{}}',
    replace: 'Carry{SCon{one_up(h), value}, False{}}' },
  { name: 'start-release-refuses-after-an-observed-stop',
    law: 'a_start_release_after_an_observed_stop_keeps_the_stop',
    find: 'Bool.pick(Transition, is_paused(state),\n              Advanced{Rec{Paused{}, epoch, mutation, pending, liveness}},\n              Refused{"startReleaseSent from " ++ state_name(state)}))',
    replace: 'Bool.pick(Transition, False{}, Advanced{Rec{Paused{}, epoch, mutation, pending, liveness}}, Refused{"startReleaseSent from " ++ state_name(state)}))' },
  { name: 'adapter-failure-replaces-an-exited-state',
    law: 'an_adapter_failure_after_exit_is_refused',
    find: 'Bool.pick(Transition, is_exited(state),\n            Refused{"adapterFailed after exited"},\n            Advanced{Rec{Failed{}, epoch, mutation, pending, liveness}})',
    replace: 'Advanced{Rec{Failed{}, epoch, mutation, pending, liveness}}' },
  { name: 'serialization-check-removed', law: 'serialized_intents_refuse_runtime_busy',
    find: 'Bool.and(serializes, Bool.not(is_idle(pending))),',
    replace: 'False{},' },
];

function prepareScratch() {
  const directory = join(RUN, `run-${Math.random().toString(36).slice(2)}`, 'runtime');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const file of [LAW_MODULE, OPERATIVE_MODULE]) {
    cpSync(join(SOURCE_DIR, file), join(directory, file));
  }
  return directory;
}

function compile(directory) {
  const lawPath = join(directory, LAW_MODULE);
  try {
    execFileSync(BEND, [lawPath, '--check-only'], { env: ENV, cwd: directory, encoding: 'utf8', maxBuffer: Infinity });
    return { ok: true, output: '' };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

// Remove the `def <name>(...)` block that proves <name>: the def line and every following
// blank or indented line.
function removeProof(path, name) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const start = lines.findIndex((line) => line.startsWith(`def ${name}(`));
  if (start === -1) return false;
  let end = start + 1;
  while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end += 1;
  lines.splice(start, end - start);
  writeFileSync(path, lines.join('\n'));
  return true;
}

function lawNames(directory) {
  const rows = [];
  for (const line of readFileSync(join(directory, LAW_MODULE), 'utf8').split('\n')) {
    const match = /^law ([A-Za-z0-9_]+):/.exec(line);
    if (match) rows.push(match[1]);
  }
  return rows;
}

function main() {
  const rows = [];
  const baselineDir = prepareScratch();
  const baseline = compile(baselineDir);
  rows.push({ control: 'entry-compiles-with-every-law-proven', passed: baseline.ok, detail: baseline.ok ? null : baseline.output.trimEnd() });
  if (!baseline.ok) return finish(rows);

  const names = lawNames(baselineDir);
  for (const name of names) {
    const directory = prepareScratch();
    const removed = removeProof(join(directory, LAW_MODULE), name);
    const control = removed ? compile(directory) : { ok: true, output: '' };
    const passed = removed && !control.ok && /TODO found|expected :|Error/.test(control.output);
    rows.push({
      control: `proof-removal:${name}`,
      law: name,
      proof: removed ? 'removed' : 'missing',
      passed,
      detail: passed ? null : (removed ? 'the compile accepted a removed proof' : 'the law has no proof beside it'),
    });
  }

  for (const mutation of MUTATIONS) {
    const directory = prepareScratch();
    const path = join(directory, OPERATIVE_MODULE);
    const source = readFileSync(path, 'utf8');
    const occurrences = source.split(mutation.find).length - 1;
    if (occurrences !== 1) {
      rows.push({
        control: `mutation:${mutation.name}`,
        law: mutation.law,
        passed: false,
        detail: `the mutation subject occurs ${occurrences} times in ${OPERATIVE_MODULE}`,
      });
      continue;
    }
    writeFileSync(path, source.replace(mutation.find, mutation.replace));
    const control = compile(directory);
    const passed = !control.ok && /TODO found|expected :|Error/.test(control.output);
    rows.push({
      control: `mutation:${mutation.name}`,
      law: mutation.law,
      passed,
      detail: passed ? null : 'the law accepted the mutation under compile',
    });
  }
  return finish(rows);
}

function finish(rows) {
  const failed = rows.filter((row) => !row.passed);
  const verdict = { suite: 'cdp-native-laws', bend: BEND, laws: rows.filter((row) => row.law !== undefined).length, controls: rows.length, failed: failed.length, rows };
  writeFileSync(join(RUN, 'verdict.json'), `${JSON.stringify(verdict, null, 2)}\n`);
  for (const row of rows) process.stdout.write(`${row.passed ? 'ok  ' : 'FAIL'} ${row.control}\n`);
  process.stdout.write(`${JSON.stringify({ verdict: failed.length === 0 ? 'pass' : 'fail', controls: rows.length, failed: failed.length, run: RUN })}\n`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main();
