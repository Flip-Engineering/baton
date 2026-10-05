// CDP lane: the authoritative mutation and control metadata for this lane's law
// controls.
//
// This module is importable with no side effects: it defines data and pure digest
// functions only, so the Interfaces owner can import it as the definition handoff. The
// runnable entrypoints (cdp-laws.mjs, cdp-native-laws.mjs) import from here rather than
// carrying their own copies.
//
// Canonical definition. A mutation definition is exactly these five members in this order,
// as UTF-8 JSON with no additional whitespace:
//   {"name":..., "file":..., "law":..., "find":..., "replace":...}
// `file` is the repository-relative path, so a digest is reproducible from the definition
// text alone and names the same file the Interfaces patch names.
//
// Metadata binds to that digest: a control's entry, its intended law and the diagnostic
// markers declared for it are reported beside `definitionSha256` and never re-enter it, so
// the digest stays stable when metadata is refined.
//
// Expectations are declarations, not observations: this lane states what a control expects
// to see and records what the compiler or the law registry actually produced. Attribution
// is left to the shared classification endpoint (bend2/scripts/laws-check.mjs --classify,
// CI f6108315, correction-required and pending); no local predicate decides a control.

import { createHash } from 'node:crypto';

export const NATIVE_ENTRY = 'bend2/src/context/runtime/cdp-runtime-laws.bend';

// The exact Darwin proof-removal diagnostic, as the reported first line and its second
// line. It names no law, so a proof removal carries this declared expectation beside its
// exact proof edit.
export const PROOF_REMOVAL_DIAGNOSTIC = Object.freeze([
  'Error: 1 TODO found.',
  'The code is incomplete, and not a valid proof yet.',
]);

// Implementation mutations of bend2/src/context/runtime/cdp-runtime.bend, each with the
// constructors of the intended law's two sides declared as its diagnostic expectation.
export const NATIVE_MUTATIONS = Object.freeze([
  { name: 'launch-drops-its-control-grant', law: 'launch_requires_the_control_grant',
    file: 'bend2/src/context/runtime/cdp-runtime.bend',
    find: 'admit_control(effects, launch_state(state), pending, serialized(intent), intent)',
    replace: 'admit_granted(launch_state(state), intent)',
    expectedConstructors: Object.freeze(['MissingEffect', 'Admitted']) },
  { name: 'launch-ignores-a-pending-intent', law: 'launch_is_refused_while_an_intent_is_pending',
    file: 'bend2/src/context/runtime/cdp-runtime.bend',
    find: 'admit_control(effects, launch_state(state), pending, serialized(intent), intent)',
    replace: 'admit_granted(launch_state(state), intent)',
    expectedConstructors: Object.freeze(['RuntimeBusy', 'Admitted']) },
  { name: 'signal-downgrade-admitted', law: 'sigterm_cannot_overwrite_an_explicit_sigkill_intent',
    file: 'bend2/src/context/runtime/cdp-runtime.bend',
    find: 'Bool.and(String.eq(prior_signal, "SIGKILL"), String.eq(signal, "SIGTERM")),',
    replace: 'False{},',
    expectedConstructors: Object.freeze(['SignalDowngrade', 'Admitted']) },
  { name: 'pause-does-not-advance-the-epoch', law: 'a_pause_advances_the_epoch_by_one_successor',
    file: 'bend2/src/context/runtime/cdp-runtime.bend',
    find: 'Advanced{Rec{Paused{}, counter_next(epoch), mutation, pending, LivenessLive{}}},',
    replace: 'Advanced{Rec{Paused{}, epoch, mutation, pending, LivenessLive{}}},',
    expectedConstructors: Object.freeze(['Advanced', 'counter_next']) },
  { name: 'evaluation-does-not-advance-the-generation',
    law: 'an_evaluation_advances_the_mutation_generation_before_its_send',
    file: 'bend2/src/context/runtime/cdp-runtime.bend',
    find: 'Advanced{Rec{state, epoch, counter_next(mutation), Evaluation{query}, liveness}},',
    replace: 'Advanced{Rec{state, epoch, mutation, Evaluation{query}, liveness}},',
    expectedConstructors: Object.freeze(['Advanced', 'counter_next']) },
  { name: 'pending-evaluation-admitted-again', law: 'a_second_evaluation_refuses_while_one_is_pending',
    file: 'bend2/src/context/runtime/cdp-runtime.bend',
    find: 'Bool.pick(Transition, is_idle(pending),',
    replace: 'Bool.pick(Transition, True{},',
    expectedConstructors: Object.freeze(['Refused', 'Advanced']) },
  { name: 'adapter-failure-asserts-target-exit', law: 'adapter_failure_preserves_the_liveness_evidence',
    file: 'bend2/src/context/runtime/cdp-runtime.bend',
    find: 'Advanced{Rec{Failed{}, epoch, mutation, pending, liveness}}',
    replace: 'Advanced{Rec{Failed{}, epoch, mutation, pending, LivenessExited{}}}',
    expectedConstructors: Object.freeze(['LivenessExited', 'Advanced']) },
  { name: 'child-exit-keeps-the-live-liveness', law: 'child_exit_records_the_exited_liveness',
    file: 'bend2/src/context/runtime/cdp-runtime.bend',
    find: 'Advanced{Rec{Exited{}, epoch, mutation, pending, LivenessExited{}}}',
    replace: 'Advanced{Rec{Exited{}, epoch, mutation, pending, liveness}}',
    expectedConstructors: Object.freeze(['Exited', 'LivenessExited']) },
  { name: 'start-release-refuses-after-an-observed-stop',
    law: 'a_start_release_after_an_observed_stop_keeps_the_stop',
    file: 'bend2/src/context/runtime/cdp-runtime.bend',
    find: 'Bool.pick(Transition, is_paused(state),\n              Advanced{Rec{Paused{}, epoch, mutation, pending, liveness}},\n              Refused{"startReleaseSent from " ++ state_name(state)}))',
    replace: 'Bool.pick(Transition, False{}, Advanced{Rec{Paused{}, epoch, mutation, pending, liveness}}, Refused{"startReleaseSent from " ++ state_name(state)}))',
    expectedConstructors: Object.freeze(['Paused', 'Advanced']) },
  { name: 'adapter-failure-replaces-an-exited-state',
    law: 'an_adapter_failure_after_exit_is_refused',
    file: 'bend2/src/context/runtime/cdp-runtime.bend',
    find: 'Bool.pick(Transition, is_exited(state),\n            Refused{"adapterFailed after exited"},\n            Advanced{Rec{Failed{}, epoch, mutation, pending, liveness}})',
    replace: 'Advanced{Rec{Failed{}, epoch, mutation, pending, liveness}}',
    expectedConstructors: Object.freeze(['Refused', 'Failed']) },
  { name: 'counter-leading-zero-admitted', law: 'counter_valid_refuses_a_leading_zero',
    file: 'bend2/src/context/runtime/cdp-runtime.bend',
    find: 'Bool.pick(Bool, is_zero_char(h), is_nil(t), True{})',
    replace: 'True{}',
    expectedConstructors: Object.freeze(['False', 'True']) },
  { name: 'counter-carry-broken', law: 'counter_next_carries_across_a_nine',
    file: 'bend2/src/context/runtime/cdp-runtime.bend',
    find: 'Carry{SCon{one_zero(), value}, True{}}',
    replace: 'Carry{SCon{one_up(h), value}, False{}}',
    expectedConstructors: Object.freeze(['counter_next', 'String']) },
  { name: 'serialization-check-removed', law: 'serialized_intents_refuse_runtime_busy',
    file: 'bend2/src/context/runtime/cdp-runtime.bend',
    find: 'Bool.and(serializes, Bool.not(is_idle(pending))),',
    replace: 'False{},',
    expectedConstructors: Object.freeze(['RuntimeBusy', 'Admitted']) },
  { name: 'child-exit-marks-a-live-stop-absent',
    law: 'a_child_exit_marks_a_live_stop_historical',
    file: 'bend2/src/context/runtime/cdp-runtime.bend',
    find: '    case EvChildExit{}: stop_lost(previous)',
    replace: '    case EvChildExit{}: StopAbsent{}',
    expectedConstructors: Object.freeze(['StopHistorical', 'StopAbsent']),
    // Declared from the law's two sides, not measured in a run, and concrete rather than
    // symbolic: the mutant returns an absent stop for a live one.
    expectedTerm: 'StopHistorical{}',
    observedTerm: 'StopAbsent{}' },
  { name: 'pause-scoped-admission-ignores-the-stop',
    law: 'a_pause_scoped_reference_is_refused_against_a_historical_stop',
    file: 'bend2/src/context/runtime/cdp-runtime.bend',
    find: '  Bool.pick(Bool, pause_scoped, stop_is_live(stop), True{})',
    replace: '  True{}',
    expectedConstructors: Object.freeze(['False', 'True']),
    // Declared from the predicate's two sides, not measured in a run.
    expectedTerm: 'False{}',
    observedTerm: 'True{}' },
  { name: 'evaluation-settlement-accepted-after-exit',
    law: 'an_evaluation_settlement_after_exit_is_refused',
    file: 'bend2/src/context/runtime/cdp-runtime.bend',
    find: '        case EvEvaluationSettled{}:\n          Bool.pick(Transition, is_exited(state),',
    replace: '        case EvEvaluationSettled{}:\n          Bool.pick(Transition, False{},',
    expectedConstructors: Object.freeze(['Refused', 'Advanced']),
    // Declared from the law's two sides, not measured in a run: the law's right side is the
    // refusal, and the mutant's outer result is Advanced with the evaluation cleared.
    expectedTerm: 'Refused{"evaluationSettled after exited"}',
    observedTerm: 'Advanced{Rec{Exited{}, epoch, mutation, Idle{}, LivenessExited{}}}' },
  { name: 'in-flight-intent-not-recorded', law: 'an_in_flight_intent_is_recorded_while_it_runs',
    file: 'bend2/src/context/runtime/cdp-runtime.bend',
    find: 'Advanced{Rec{state, epoch, mutation, InFlight{intent, query}, liveness}},',
    replace: 'Advanced{Rec{state, epoch, mutation, Idle{}, liveness}},',
    expectedConstructors: Object.freeze(['InFlight', 'Idle']) },
  { name: 'second-intent-admitted-while-one-is-in-flight',
    law: 'a_second_intent_refuses_while_one_is_in_flight',
    file: 'bend2/src/context/runtime/cdp-runtime.bend',
    find: '        case EvIntentStarted{intent, query}:\n          Bool.pick(Transition, is_idle(pending),',
    replace: '        case EvIntentStarted{intent, query}:\n          Bool.pick(Transition, True{},',
    expectedConstructors: Object.freeze(['Refused', 'InFlight']) },
  { name: 'settle-admitted-without-an-in-flight-intent',
    law: 'settling_without_an_in_flight_intent_is_refused',
    file: 'bend2/src/context/runtime/cdp-runtime.bend',
    find: '        case EvIntentSettled{}:\n          Bool.pick(Transition, is_idle(pending),',
    replace: '        case EvIntentSettled{}:\n          Bool.pick(Transition, False{},',
    expectedConstructors: Object.freeze(['Refused', 'Idle']) },
  { name: 'rejected-resume-asserts-resumption',
    law: 'a_rejected_resume_retains_the_stop_and_the_advanced_epoch',
    file: 'bend2/src/context/runtime/cdp-runtime.bend',
    find: '        case EvResumeRejected{}:\n          Bool.pick(Transition, is_running(state),\n            Advanced{Rec{Paused{}, epoch, mutation, pending, liveness}},',
    replace: '        case EvResumeRejected{}:\n          Bool.pick(Transition, is_running(state),\n            Advanced{Rec{Running{}, epoch, mutation, pending, liveness}},',
    expectedConstructors: Object.freeze(['Paused', 'Running']) },
  { name: 'stop-liveness-ignores-a-resume',
    law: 'a_resume_leaves_the_recorded_stop_historical',
    file: 'bend2/src/context/runtime/cdp-runtime.bend',
    find: '    case EvResumeSent{}: StopHistorical{}',
    replace: '    case EvResumeSent{}: previous',
    expectedConstructors: Object.freeze(['StopHistorical', 'previous']) },
]);

// Implementation mutations of this lane's JavaScript modules. Each is attributed by the
// named law that must fail over the mutated in-process module set.
export const JS_MUTATIONS = Object.freeze([
  { name: 'foreign-identity-check-removed', file: 'bend2/context/runtime/cdp-protocol.mjs',
    law: 'frame_admission_refuses_a_foreign_runtime_identity',
    find: 'if (expect[member] !== undefined && parsed[member] !== expect[member]) {',
    replace: 'if (expect[member] !== undefined && false) {' },
  { name: 'complete-frame-result-check-removed', file: 'bend2/context/runtime/cdp-protocol.mjs',
    law: 'frame_complete_requires_the_validated_result_object',
    find: "if (type === 'complete' && !isPlainObject(payload.result)) {",
    replace: "if (type === 'complete' && false) {" },
  { name: 'sequence-conflict-accepted-as-replay', file: 'bend2/context/runtime/cdp-protocol.mjs',
    law: 'sequence_replay_is_idempotent_and_conflicting_bytes_refuse',
    find: 'if (retained === bytes) return { ok: true, sequence, bytes, replay: true, retained: previous.retained };',
    replace: 'if (true) return { ok: true, sequence, bytes, replay: true, retained: previous.retained };' },
  { name: 'stale-epoch-accepted', file: 'bend2/context/runtime/cdp-refs.mjs',
    law: 'ref_epoch_mismatch_is_stale_before_any_backend_request',
    find: 'if (identity.epoch !== scope.epoch) {',
    replace: 'if (false) {' },
  { name: 'retired-mutation-generation-accepted', file: 'bend2/context/runtime/cdp-refs.mjs',
    law: 'ref_mutation_generation_retires_live_value_refs',
    find: 'if (identity.mutationGeneration !== scope.mutationGeneration) {',
    replace: 'if (false) {' },
  { name: 'ref-decision-contradiction-accepted', file: 'bend2/context/runtime/cdp-refs.mjs',
    law: 'ref_decision_refuses_a_contradictory_candidate',
    find: '  if (value.ok !== true) {',
    replace: '  if (value.ok === null) {' },
  { name: 'wrong-decision-reported-as-no-decision',
    file: 'bend2/context/runtime/cdp-refs.mjs',
    law: 'ref_decision_refuses_a_contradictory_candidate',
    find: "    return refusedDecision('refDecisionMalformed', `decision ${JSON.stringify(value.decision)}`);",
    replace: "    return refusedDecision('refDecisionRefused', `decision ${JSON.stringify(value.decision)}`);" },
  { name: 'ref-decision-gate-removed', file: 'bend2/context/runtime/cdp-refs.mjs',
    law: 'ref_decision_admits_only_an_explicit_validated_success',
    find: "  if (value.decision !== 'admitted') {",
    replace: '  if (false) {' },
  { name: 'pause-does-not-advance-the-epoch', file: 'bend2/context/runtime/cdp-state.mjs',
    law: 'pause_advances_the_epoch_by_exactly_one_successor',
    find: "state: 'paused', epoch: epoch.value, targetLiveness: 'live',",
    replace: "state: 'paused', epoch: record.epoch, targetLiveness: 'live'," },
  { name: 'epoch-increment-through-a-js-number', file: 'bend2/context/runtime/cdp-state.mjs',
    law: 'counter_advance_never_wraps_at_the_u32_or_double_boundary',
    find: "state: 'paused', epoch: epoch.value, targetLiveness: 'live',",
    replace: "state: 'paused', epoch: String(Number(record.epoch) + 1), targetLiveness: 'live'," },
  { name: 'evaluation-does-not-advance-the-generation', file: 'bend2/context/runtime/cdp-state.mjs',
    law: 'evaluation_advances_the_mutation_generation_before_its_send',
    find: 'mutationGeneration: mutation.value,',
    replace: 'mutationGeneration: record.mutationGeneration,' },
  { name: 'context-destruction-leaves-the-stop', file: 'bend2/context/runtime/cdp-state.mjs',
    law: 'context_destruction_advances_the_epoch_and_ends_a_stop',
    find: "      const wasStopped = record.state === 'paused' || record.state === 'pausePending';",
    replace: '      const wasStopped = false;' },
  { name: 'rejected-resume-asserts-resumption', file: 'bend2/context/runtime/cdp-state.mjs',
    law: 'resume_rejection_retains_the_stop_without_live_evidence',
    find: "      return { ok: true, record: { ...record, state: 'paused' } };",
    replace: "      return { ok: true, record: { ...record, state: 'running' } };" },
  { name: 'pause-request-admitted-after-a-stop', file: 'bend2/context/runtime/cdp-state.mjs',
    law: 'pause_acknowledgment_after_a_stopped_event_keeps_the_stop',
    find: "      if (record.state !== 'running') return refusal('illegalTransition', `pauseRequested from ${record.state}`);",
    replace: "      if (false) return refusal('illegalTransition', `pauseRequested from ${record.state}`);" },
  { name: 'adapter-failure-asserts-target-exit', file: 'bend2/context/runtime/cdp-state.mjs',
    law: 'adapter_failure_never_asserts_target_exit',
    find: "      return { ok: true, record: { ...record, state: 'failed' } };",
    replace: "      return { ok: true, record: { ...record, state: 'failed', targetLiveness: 'exited' } };" },
  { name: 'effect-grant-check-removed', file: 'bend2/context/runtime/cdp-intents.mjs',
    law: 'intent_without_its_grant_refuses_before_the_effect',
    find: '    if (!Array.isArray(effects) || !effects.includes(required)) {',
    replace: '    if (false) {' },
  { name: 'pending-serialized-intent-admitted', file: 'bend2/context/runtime/cdp-intents.mjs',
    law: 'serialized_intents_refuse_runtime_busy_while_one_is_pending',
    find: '  if (entry.serialized && record.pending !== null) {',
    replace: '  if (false) {' },
  { name: 'every-intent-serializes-against-a-pending-evaluation', file: 'bend2/context/runtime/cdp-intents.mjs',
    law: 'release_is_admitted_while_an_evaluation_is_pending',
    find: '  if (entry.serialized && record.pending !== null) {',
    replace: '  if (record.pending !== null) {' },
  { name: 'read-path-admits-control-requests', file: 'bend2/context/runtime/cdp-intents.mjs',
    law: 'observation_read_path_carries_only_non_effectful_requests',
    find: "  if (CONTROL_REQUESTS.includes(method)) return refusal('controlRequiresGrant', method);",
    replace: "  if (false) return refusal('controlRequiresGrant', method);" },
  { name: 'control-path-grant-check-removed', file: 'bend2/context/runtime/cdp-intents.mjs',
    law: 'control_path_requires_the_control_grant_and_refuses_evaluation',
    find: "  if (!Array.isArray(effects) || !effects.includes('controlRuntime')) {",
    replace: '  if (false) {' },
  { name: 'worker-session-ownership-check-removed', file: 'bend2/context/runtime/cdp-intents.mjs',
    law: 'worker_channel_requires_an_owned_active_session',
    find: 'if (!Array.isArray(workers) || !workers.includes(sessionId)) {',
    replace: 'if (false) {' },
  { name: 'control-requests-bypass-the-pending-intent', file: 'bend2/context/runtime/cdp-intents.mjs',
    law: 'control_requests_serialize_against_a_pending_evaluation',
    find: "  if (record.pending !== null) {\n    return refusal('runtimeBusy', `pending ${record.pending.intent}`);\n  }\n  if (method === 'NodeWorker.sendMessageToWorker') {",
    replace: "  if (method === 'NodeWorker.sendMessageToWorker') {" },
  { name: 'breakpoint-condition-admitted', file: 'bend2/context/runtime/cdp-intents.mjs',
    law: 'breakpoint_condition_is_refused_because_it_is_target_javascript',
    find: "  if (BREAKPOINT_REQUESTS.includes(method) && params !== null && Object.hasOwn(params, 'condition')) {",
    replace: '  if (false) {' },
  { name: 'breakpoint-location-requirement-removed', file: 'bend2/context/runtime/cdp-intents.mjs',
    law: 'breakpoint_condition_is_refused_because_it_is_target_javascript',
    find: '    const location = admitBreakpointLocation(method, params);\n    if (!location.ok) return location;',
    replace: '    const location = admitBreakpointLocation(method, params);\n    if (location.ok && false) return location;' },
  { name: 'breakpoint-parameter-set-open', file: 'bend2/context/runtime/cdp-intents.mjs',
    law: 'breakpoint_condition_is_refused_because_it_is_target_javascript',
    find: '      if (!BREAKPOINT_PARAMS[method].includes(key)) {',
    replace: '      if (false) {' },
  { name: 'signal-downgrade-admitted', file: 'bend2/context/runtime/cdp-intents.mjs',
    law: 'release_signal_order_refuses_a_downgrade',
    find: "    if (priorSignal === 'SIGKILL' && signal === 'SIGTERM') {",
    replace: '    if (false) {' },
  { name: 'non-loopback-endpoint-admitted', file: 'bend2/context/runtime/cdp-transport.mjs',
    law: 'transport_refuses_a_non_loopback_endpoint',
    find: 'if (!LOOPBACK_HOSTS.includes(parsed.hostname)) {',
    replace: 'if (false) {' },
  { name: 'banner-line-terminator-removed', file: 'bend2/context/runtime/cdp-endpoint.mjs',
    law: 'endpoint_banner_requires_its_complete_line_and_loopback_host',
    find: 'const BANNER = /Debugger listening on (ws:\\/\\/[^\\s]+)\\r?\\n/;',
    replace: 'const BANNER = /Debugger listening on (ws:\\/\\/[^\\s]+)/;' },
  { name: 'stderr-replacement-adopted', file: 'bend2/context/runtime/cdp-endpoint.mjs',
    law: 'endpoint_watch_refuses_replacement_and_truncation',
    find: 'if (current.dev !== identity.dev || current.ino !== identity.ino) {',
    replace: 'if (false) {' },
  // Rebound: the previous definition targeted the single-line
  // `PAUSE_SCOPED.includes(identity?.kind) && record.state !== 'paused'` expression, which
  // no longer exists since the session grew the nested stop-liveness branch. The
  // superseded definition and its digest are not reusable; this one names the current
  // operative branch and inverts the gate so the pause-scope block is skipped for a
  // pause-scoped kind, leaving the epoch comparison to judge the ref by name instead.
  { name: 'string-ref-bypasses-the-pause-scope', file: 'bend2/context/runtime/cdp-session.mjs',
    law: 'session_read_path_refuses_control_requests_and_string_refs_outside_a_pause',
    find: '      if (PAUSE_SCOPED.includes(identity?.kind)) {',
    replace: '      if (!PAUSE_SCOPED.includes(identity?.kind)) {' },
  { name: 'argv-wrapper-admitted', file: 'bend2/context/runtime/bootstrap-admission.mjs',
    law: 'launch_document_refuses_an_argument_vector_that_keeps_a_wrapper',
    find: 'if (parsed.argv[0] !== parsed.node) {',
    replace: 'if (false) {' },
  { name: 'numeric-environment-value-coerced', file: 'bend2/context/runtime/bootstrap-admission.mjs',
    law: 'launch_document_refuses_a_non_string_environment_value',
    find: 'if (typeof value !== \'string\') return refusal(\'launchEnvInvalid\', `value for ${key} is not text`);',
    replace: 'if (false) return refusal(\'launchEnvInvalid\', `value for ${key} is not text`);' },
  { name: 'script-identity-conflict-overwrites', file: 'bend2/context/runtime/cdp-scripts.mjs',
    law: 'script_identity_conflict_refuses_rather_than_overwriting',
    find: 'if (existing !== undefined && existing.url !== entry.url) {',
    replace: 'if (false) {' },
  { name: 'loaded-source-digest-is-not-a-sha256', file: 'bend2/context/runtime/cdp-scripts.mjs',
    law: 'loaded_source_identity_is_the_digest_of_the_loaded_bytes',
    find: "return createHash('sha256').update(text, 'utf8').digest('hex');",
    replace: "return createHash('sha1').update(text, 'utf8').digest('hex');" },
]);

// The frozen module set one JavaScript control copies before it is mutated. The law entry
// itself is part of the set, so the statements a case runs are bound to frozen, digested
// bytes rather than to the live working tree.
export const JS_MODULES = Object.freeze([
  'bend2/context/runtime/cdp-law-checks.mjs',
  'bend2/context/runtime/cdp-counter.mjs',
  'bend2/context/runtime/cdp-protocol.mjs',
  'bend2/context/runtime/cdp-refs.mjs',
  'bend2/context/runtime/cdp-state.mjs',
  'bend2/context/runtime/cdp-intents.mjs',
  'bend2/context/runtime/cdp-transport.mjs',
  'bend2/context/runtime/cdp-endpoint.mjs',
  'bend2/context/runtime/cdp-scripts.mjs',
  'bend2/context/runtime/cdp-session.mjs',
  'bend2/context/runtime/bootstrap-admission.mjs',
]);

// The two native source files one native control copies before it is mutated or edited.
export const NATIVE_MODULES = Object.freeze([
  'bend2/src/context/runtime/cdp-runtime-laws.bend',
  'bend2/src/context/runtime/cdp-runtime.bend',
]);

export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// The authoritative definition text of one control: five members, this order, no extra
// whitespace, repository-relative file.
export function mutationDefinition(mutation) {
  return JSON.stringify({
    name: mutation.name,
    file: mutation.file,
    law: mutation.law,
    find: mutation.find,
    replace: mutation.replace,
  });
}

export function mutationDefinitionDigest(mutation) {
  return sha256Text(mutationDefinition(mutation));
}

// Metadata bound to the authoritative digest. It never re-enters the definition, so the
// digest stays stable when an expectation is refined. `options` declares the rule the
// shared endpoint will use for this control and, where the terms are known, the intended
// expected and observed terms of the diagnostic; every declared diagnostic term is marked
// as declared rather than measured, because no compiler run has confirmed its wording.
export function controlMetadata(mutation, entry, options = {}) {
  return {
    control: mutation.name,
    law: mutation.law,
    file: mutation.file,
    entry,
    expectedConstructors: mutation.expectedConstructors === undefined ? null : [...mutation.expectedConstructors],
    diagnosticMarkers: options.diagnosticMarkers === undefined ? null : [...options.diagnosticMarkers],
    attributionRule: options.attributionRule ?? null,
    // The intended expected and observed terms, where the mutation declares them. They are
    // declarations from the law's two sides, not compiler wording observed in a run.
    declaredDiagnostic: mutation.expectedTerm === undefined && mutation.observedTerm === undefined
      ? null
      : {
        expectedTerm: mutation.expectedTerm ?? null,
        observedTerm: mutation.observedTerm ?? null,
        wordingSource: 'declared-not-measured',
      },
    definitionSha256: mutationDefinitionDigest(mutation),
  };
}
