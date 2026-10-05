#!/usr/bin/env node
// CDP lane runnable law check with negative implementation mutations.
//
// Each law in cdp-law-checks.mjs is stated over the real exported functions of this
// lane's modules. This entrypoint runs every law against the shipped modules, then, for
// each mutation below, copies the module set to a scratch directory, applies one
// deliberate implementation change and requires the named law to refuse it. A mutation
// that the named law still accepts means the law is not bound to that function, and it
// is a failure here.
//
// Usage: node bend2/context/runtime/cdp-laws.mjs
// Evidence: .scratch/cdp-lane/laws-<run>/verdict.json

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as nodeFs from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { laws as lawStatements } from './cdp-law-checks.mjs';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '..', '..', '..');
const RUN = join(ROOT, '.scratch', 'cdp-lane', `laws-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
mkdirSync(RUN, { recursive: true, mode: 0o700 });

const MODULE_FILES = [
  'cdp-counter.mjs',
  'cdp-protocol.mjs',
  'cdp-refs.mjs',
  'cdp-state.mjs',
  'cdp-intents.mjs',
  'cdp-transport.mjs',
  'cdp-endpoint.mjs',
  'cdp-scripts.mjs',
  'cdp-session.mjs',
  'bootstrap-admission.mjs',
];

// One deliberate implementation change per law. `find` must occur exactly once in the
// named file: an ambiguous or missing subject is itself a failure.
const MUTATIONS = [
  { name: 'foreign-identity-check-removed', file: 'cdp-protocol.mjs',
    find: 'if (expect[member] !== undefined && parsed[member] !== expect[member]) {',
    replace: 'if (expect[member] !== undefined && false) {',
    law: 'frame_admission_refuses_a_foreign_runtime_identity' },
  { name: 'complete-frame-result-check-removed', file: 'cdp-protocol.mjs',
    find: "if (type === 'complete' && !isPlainObject(payload.result)) {",
    replace: "if (type === 'complete' && false) {",
    law: 'frame_complete_requires_the_validated_result_object' },
  { name: 'sequence-conflict-accepted-as-replay', file: 'cdp-protocol.mjs',
    find: 'if (retained === bytes) return { ok: true, sequence, bytes, replay: true, retained: previous.retained };',
    replace: 'if (true) return { ok: true, sequence, bytes, replay: true, retained: previous.retained };',
    law: 'sequence_replay_is_idempotent_and_conflicting_bytes_refuse' },
  { name: 'start-release-refused-after-an-observed-stop', file: 'cdp-state.mjs',
    find: "      if (record.state === 'paused') return { ok: true, record };",
    replace: '      if (false) return { ok: true, record };',
    law: 'startup_release_after_an_observed_stop_keeps_the_stop' },
  { name: 'adapter-failure-replaces-an-exited-state', file: 'cdp-state.mjs',
    find: "  if (record.state === 'exited' && type !== 'childExit') {",
    replace: '  if (false) {',
    law: 'startup_release_after_an_observed_stop_keeps_the_stop' },
  { name: 'counter-admits-a-trailing-terminator', file: 'cdp-counter.mjs',
    find: '    if (code < 48 || code > 57) return false;',
    replace: '    if (code !== 10 && (code < 48 || code > 57)) return false;',
    law: 'counter_text_admits_only_canonical_unsigned_decimal' },
  { name: 'counter-leading-zero-admitted', file: 'cdp-counter.mjs',
    find: "  if (text.length > 1 && text[0] === '0') return false;",
    replace: '  if (false) return false;',
    law: 'counter_text_admits_only_canonical_unsigned_decimal' },
  { name: 'counter-carry-broken', file: 'cdp-counter.mjs',
    find: "    if (digits[index] === '9') {",
    replace: '    if (false) {',
    law: 'counter_successor_is_exact_past_the_u32_and_double_ranges' },
  { name: 'stale-epoch-accepted', file: 'cdp-refs.mjs',
    find: 'if (identity.epoch !== scope.epoch) {',
    replace: 'if (false) {',
    law: 'ref_epoch_mismatch_is_stale_before_any_backend_request' },
  { name: 'retired-mutation-generation-accepted', file: 'cdp-refs.mjs',
    find: 'if (identity.mutationGeneration !== scope.mutationGeneration) {',
    replace: 'if (false) {',
    law: 'ref_mutation_generation_retires_live_value_refs' },
  { name: 'pause-does-not-advance-the-epoch', file: 'cdp-state.mjs',
    find: "state: 'paused', epoch: epoch.value, targetLiveness: 'live',",
    replace: "state: 'paused', epoch: record.epoch, targetLiveness: 'live',",
    law: 'pause_advances_the_epoch_by_exactly_one_successor' },
  { name: 'epoch-increment-through-a-js-number', file: 'cdp-state.mjs',
    find: "state: 'paused', epoch: epoch.value, targetLiveness: 'live',",
    replace: "state: 'paused', epoch: String(Number(record.epoch) + 1), targetLiveness: 'live',",
    law: 'counter_advance_never_wraps_at_the_u32_or_double_boundary' },
  { name: 'evaluation-does-not-advance-the-generation', file: 'cdp-state.mjs',
    find: 'mutationGeneration: mutation.value,',
    replace: 'mutationGeneration: record.mutationGeneration,',
    law: 'evaluation_advances_the_mutation_generation_before_its_send' },
  { name: 'context-destruction-leaves-the-stop', file: 'cdp-state.mjs',
    find: "      const wasStopped = record.state === 'paused' || record.state === 'pausePending';",
    replace: '      const wasStopped = false;',
    law: 'context_destruction_advances_the_epoch_and_ends_a_stop' },
  { name: 'adapter-failure-asserts-target-exit', file: 'cdp-state.mjs',
    find: "      return { ok: true, record: { ...record, state: 'failed' } };",
    replace: "      return { ok: true, record: { ...record, state: 'failed', targetLiveness: 'exited' } };",
    law: 'adapter_failure_never_asserts_target_exit' },
  { name: 'effect-grant-check-removed', file: 'cdp-intents.mjs',
    find: '    if (!Array.isArray(effects) || !effects.includes(required)) {',
    replace: '    if (false) {',
    law: 'intent_without_its_grant_refuses_before_the_effect' },
  { name: 'pending-serialized-intent-admitted', file: 'cdp-intents.mjs',
    find: '  if (entry.serialized && record.pending !== null) {',
    replace: '  if (false) {',
    law: 'serialized_intents_refuse_runtime_busy_while_one_is_pending' },
  { name: 'every-intent-serializes-against-a-pending-evaluation', file: 'cdp-intents.mjs',
    find: '  if (entry.serialized && record.pending !== null) {',
    replace: '  if (record.pending !== null) {',
    law: 'release_is_admitted_while_an_evaluation_is_pending' },
  { name: 'read-path-admits-control-requests', file: 'cdp-intents.mjs',
    find: "  if (CONTROL_REQUESTS.includes(method)) return refusal('controlRequiresGrant', method);",
    replace: "  if (false) return refusal('controlRequiresGrant', method);",
    law: 'observation_read_path_carries_only_non_effectful_requests' },
  { name: 'control-path-grant-check-removed', file: 'cdp-intents.mjs',
    find: "  if (!Array.isArray(effects) || !effects.includes('controlRuntime')) {",
    replace: '  if (false) {',
    law: 'control_path_requires_the_control_grant_and_refuses_evaluation' },
  { name: 'nested-worker-control-request-admitted', file: 'cdp-intents.mjs',
    find: "  if (CONTROL_REQUESTS.includes(parsed.method)) return refusal('nestedControlNotAdmitted', parsed.method);",
    replace: "  if (false) return refusal('nestedControlNotAdmitted', parsed.method);",
    law: 'nested_worker_message_must_itself_be_a_read' },
  { name: 'breakpoint-condition-admitted', file: 'cdp-intents.mjs',
    find: "  if (BREAKPOINT_REQUESTS.includes(method) && params !== null && Object.hasOwn(params, 'condition')) {",
    replace: '  if (false) {',
    law: 'breakpoint_condition_is_refused_because_it_is_target_javascript' },
  { name: 'control-requests-bypass-the-pending-intent', file: 'cdp-intents.mjs',
    find: "  if (record.pending !== null) {\n    return refusal('runtimeBusy', `pending ${record.pending.intent}`);\n  }\n  if (method === 'NodeWorker.sendMessageToWorker') {",
    replace: "  if (method === 'NodeWorker.sendMessageToWorker') {",
    law: 'control_requests_serialize_against_a_pending_evaluation' },
  { name: 'breakpoint-parameter-set-open', file: 'cdp-intents.mjs',
    find: "      if (!BREAKPOINT_PARAMS[method].includes(key)) {",
    replace: '      if (false) {',
    law: 'breakpoint_condition_is_refused_because_it_is_target_javascript' },
  { name: 'signal-downgrade-admitted', file: 'cdp-intents.mjs',
    find: "    if (priorSignal === 'SIGKILL' && signal === 'SIGTERM') {",
    replace: '    if (false) {',
    law: 'release_signal_order_refuses_a_downgrade' },
  { name: 'non-loopback-endpoint-admitted', file: 'cdp-transport.mjs',
    find: 'if (!LOOPBACK_HOSTS.includes(parsed.hostname)) {',
    replace: 'if (false) {',
    law: 'transport_refuses_a_non_loopback_endpoint' },
  { name: 'banner-line-terminator-removed', file: 'cdp-endpoint.mjs',
    find: 'const BANNER = /Debugger listening on (ws:\\/\\/[^\\s]+)\\r?\\n/;',
    replace: 'const BANNER = /Debugger listening on (ws:\\/\\/[^\\s]+)/;',
    law: 'endpoint_banner_requires_its_complete_line_and_loopback_host' },
  { name: 'stderr-replacement-adopted', file: 'cdp-endpoint.mjs',
    find: 'if (current.dev !== identity.dev || current.ino !== identity.ino) {',
    replace: 'if (false) {',
    law: 'endpoint_watch_refuses_replacement_and_truncation' },
  { name: 'string-ref-bypasses-the-pause-scope', file: 'cdp-session.mjs',
    find: "      if (PAUSE_SCOPED.includes(identity?.kind) && record.state !== 'paused') {",
    replace: '      if (false) {',
    law: 'session_read_path_refuses_control_requests_and_string_refs_outside_a_pause' },
  { name: 'argv-wrapper-admitted', file: 'bootstrap-admission.mjs',
    find: 'if (parsed.argv[0] !== parsed.node) {',
    replace: 'if (false) {',
    law: 'launch_document_refuses_an_argument_vector_that_keeps_a_wrapper' },
  { name: 'numeric-environment-value-coerced', file: 'bootstrap-admission.mjs',
    find: 'if (typeof value !== \'string\') return refusal(\'launchEnvInvalid\', `value for ${key} is not text`);',
    replace: 'if (false) return refusal(\'launchEnvInvalid\', `value for ${key} is not text`);',
    law: 'launch_document_refuses_a_non_string_environment_value' },
  { name: 'script-identity-conflict-overwrites', file: 'cdp-scripts.mjs',
    find: 'if (existing !== undefined && existing.url !== entry.url) {',
    replace: 'if (false) {',
    law: 'script_identity_conflict_refuses_rather_than_overwriting' },
  { name: 'loaded-source-digest-is-not-a-sha256', file: 'cdp-scripts.mjs',
    find: "return createHash('sha256').update(text, 'utf8').digest('hex');",
    replace: "return createHash('sha1').update(text, 'utf8').digest('hex');",
    law: 'loaded_source_identity_is_the_digest_of_the_loaded_bytes' },
];

async function loadModules(directory) {
  const load = async (name) => import(pathToFileURL(join(directory, name)).href);
  const [counter, protocol, refs, state, intents, transport, endpoint, scripts, session, bootstrap] = await Promise.all([
    load('cdp-counter.mjs'),
    load('cdp-protocol.mjs'),
    load('cdp-refs.mjs'),
    load('cdp-state.mjs'),
    load('cdp-intents.mjs'),
    load('cdp-transport.mjs'),
    load('cdp-endpoint.mjs'),
    load('cdp-scripts.mjs'),
    load('cdp-session.mjs'),
    load('bootstrap-admission.mjs'),
  ]);
  return {
    counter, protocol, refs, state, intents, transport, endpoint, scripts, session, bootstrap,
    fs: nodeFs,
    scratchPrefix: join(RUN, 'tmp-'),
  };
}

async function runLaws(moduleSet, statementNames) {
  const failures = [];
  const statements = lawStatements(moduleSet);
  for (const statement of statements) {
    try {
      // A law may be asynchronous (a session refusal is observed through a promise).
      await statement.run();
    } catch (error) {
      failures.push({ law: statement.name, detail: error.message });
    }
  }
  const seen = new Set(statements.map((statement) => statement.name));
  for (const name of statementNames) {
    if (!seen.has(name)) failures.push({ law: name, detail: 'the law statement is missing from the module set' });
  }
  return failures;
}

async function main() {
  const statementNames = lawStatements(await loadModules(HERE)).map((statement) => statement.name);
  const baseline = await runLaws(await loadModules(HERE), statementNames);
  const rows = [{
    control: 'shipped-modules',
    laws: statementNames.length,
    failed: baseline.length,
    passed: baseline.length === 0,
    failures: baseline,
  }];

  for (const mutation of MUTATIONS) {
    const directory = mkdtempSync(join(RUN, 'mut-'));
    for (const file of MODULE_FILES) cpSync(join(HERE, file), join(directory, file));
    const path = join(directory, mutation.file);
    const source = readFileSync(path, 'utf8');
    const occurrences = source.split(mutation.find).length - 1;
    if (occurrences !== 1) {
      rows.push({
        control: mutation.name,
        law: mutation.law,
        passed: false,
        detail: `mutation subject occurs ${occurrences} times in ${mutation.file}`,
      });
      rmSync(directory, { recursive: true, force: true });
      continue;
    }
    writeFileSync(path, source.replace(mutation.find, mutation.replace));
    const mutated = await loadModules(directory);
    const failures = await runLaws(mutated, statementNames);
    const refused = failures.some((failure) => failure.law === mutation.law);
    rows.push({
      control: mutation.name,
      law: mutation.law,
      passed: refused,
      alsoFailed: failures.filter((failure) => failure.law !== mutation.law).map((failure) => failure.law),
      detail: refused ? null : `the law accepted the mutation: ${JSON.stringify(failures)}`,
    });
    rmSync(directory, { recursive: true, force: true });
  }

  const failed = rows.filter((row) => !row.passed);
  const verdict = { suite: 'cdp-laws', statementCount: statementNames.length, controls: rows.length, failed: failed.length, rows };
  writeFileSync(join(RUN, 'verdict.json'), `${JSON.stringify(verdict, null, 2)}\n`);
  for (const row of rows) {
    process.stdout.write(`${row.passed ? 'ok  ' : 'FAIL'} ${row.control}${row.law === undefined ? '' : ` -> ${row.law}`}\n`);
  }
  process.stdout.write(`${JSON.stringify({ verdict: failed.length === 0 ? 'pass' : 'fail', statements: statementNames.length, controls: rows.length, failed: failed.length, run: RUN })}\n`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

await main();
