// CDP lane: the operative law statements for this lane.
//
// Each law is stated over the real exported function of an operative module and takes
// the module set as its subject, so the same statements run against the shipped modules
// and against a mutated copy of them. A law that cannot refuse a mutated implementation
// is not a law: cdp-laws.mjs performs exactly that negative control for each statement.
//
// The statements pin the runtime contract of docs/bend2/semantic-context-spec.md and the
// retained corrections: closed transport envelopes with bound identities and sequence,
// canonical decimal text counters that never wrap, pause-epoch and mutation-generation
// scoped references, a zero-grant read path distinct from the grant-gated control path,
// a nested worker message that must itself be a read, a refused breakpoint condition,
// adapter failure that asserts no target exit, endpoint banner discovery over the
// watched descriptor that refuses replacement, loopback-only connections,
// credential-free launch documents, and loaded-source identity.

function expect(condition, detail) {
  if (!condition) throw new Error(detail);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, saw ${JSON.stringify(actual)}`);
  }
}

const REF_RUNTIME = 'rt:q7';
const REF_ADAPTER = 'adapter:1';

export function laws(modules) {
  const { protocol, refs, state, intents, transport, endpoint, bootstrap, scripts, session, counter } = modules;

  const liveScope = { runtime: REF_RUNTIME, adapter: REF_ADAPTER, epoch: '2', mutationGeneration: '1' };
  const liveRef = refs.refIdentity({
    runtime: REF_RUNTIME, adapter: REF_ADAPTER, thread: 'main:0',
    epoch: '2', mutationGeneration: '1', kind: 'object', handle: 'h1',
  });
  const running = { state: 'running', epoch: '2', mutationGeneration: '1', pending: null, targetLiveness: 'live' };
  const paused = { ...running, state: 'paused' };
  const pending = { ...paused, pending: { query: 'q-eval', intent: 'evaluate' } };
  const frame = ({ runtime = REF_RUNTIME, role = 'adapter', incarnation = '0', query = 'q1', sequence = 0, type = 'state', payload = { state: 'running' } } = {}) => ({
    version: 1, query, runtime, role, incarnation, sequence, type, payload,
  });

  return [
    {
      name: 'frame_admission_refuses_a_foreign_runtime_identity',
      run() {
        const admitted = protocol.admitFrame(
          protocol.encodeFrame(frame()),
          { runtime: 'rt:other', role: 'adapter', incarnation: '0', query: 'q1' },
        );
        assertEqual(admitted.ok, false, 'foreign identity admitted');
        assertEqual(admitted.condition, 'foreignIdentity', 'condition');
        expect(protocol.admitFrame(protocol.encodeFrame(frame()), { runtime: REF_RUNTIME }).ok,
          'the bound frame was refused');
      },
    },
    {
      name: 'frame_complete_requires_the_validated_result_object',
      run() {
        const admitted = protocol.admitFrame(
          protocol.encodeFrame(frame({ type: 'complete', payload: { result: null } })),
        );
        assertEqual(admitted.ok, false, 'a complete frame without a result object was admitted');
        assertEqual(admitted.condition, 'incompleteResult', 'condition');
      },
    },
    {
      name: 'sequence_replay_is_idempotent_and_conflicting_bytes_refuse',
      run() {
        const first = protocol.sequenceAdmit(null, 0, '{"a":1}');
        expect(first.ok, 'first frame refused');
        assertEqual(protocol.sequenceAdmit({ sequence: 0, retained: first.retained }, 0, '{"a":1}').replay, true,
          'identical replay is not idempotent');
        assertEqual(protocol.sequenceAdmit({ sequence: 0, retained: first.retained }, 0, '{"a":2}').condition,
          'sequenceConflict', 'different bytes at a retained sequence were admitted');
      },
    },
    {
      name: 'counter_text_admits_only_canonical_unsigned_decimal',
      run() {
        expect(counter.counterValid('0'), 'the initial counter was refused');
        expect(counter.counterValid('1'), 'a single digit was refused');
        expect(counter.counterValid('4294967296'), 'a counter above the U32 range was refused');
        expect(counter.counterValid('9'.repeat(40)), 'a long counter was refused');
        for (const invalid of ['', '00', '01', '007', '-1', '+1', '1.0', '1e3', ' 1', '1 ', '0x1', '١٢',
          '1\n', '1\r', '0\n', '1\r\n', '1\u2028', '1\u2029', '\u00b9', '1\u0000']) {
          assertEqual(counter.counterValid(invalid), false, `counterValid admitted ${JSON.stringify(invalid)}`);
        }
      },
    },
    {
      name: 'counter_next_refuses_a_counter_with_a_trailing_terminator',
      run() {
        for (const invalid of ['1\n', '1\r', '1\u2028', '1\u2029', '0\n']) {
          assertEqual(counter.counterNext(invalid).ok, false,
            `counterNext accepted ${JSON.stringify(invalid)}`);
        }
        assertEqual(counter.counterNext('4294967295').value, '4294967296', 'U32 boundary successor');
        assertEqual(counter.counterNext('9007199254740991').value, '9007199254740992', 'safe-integer boundary successor');
        assertEqual(counter.counterNext('9'.repeat(40)).value, `1${'0'.repeat(40)}`, 'long all-nine carry');
      },
    },
    {
      name: 'counter_successor_is_exact_past_the_u32_and_double_ranges',
      run() {
        assertEqual(counter.counterNext('0').value, '1', 'initial successor');
        assertEqual(counter.counterNext('4294967295').value, '4294967296', 'U32 boundary successor');
        assertEqual(counter.counterNext('9007199254740991').value, '9007199254740992', 'double boundary successor');
        const long = '9'.repeat(40);
        const successor = counter.counterNext(long);
        expect(successor.ok, 'a long all-nine counter was refused');
        assertEqual(successor.value, `1${'0'.repeat(40)}`, 'long all-nine carry');
        assertEqual(counter.counterNext('01').ok, false, 'a non-canonical counter was normalized');
        assertEqual(counter.counterNext('-1').ok, false, 'a signed counter was normalized');
      },
    },
    {
      name: 'ref_epoch_mismatch_is_stale_before_any_backend_request',
      run() {
        assertEqual(refs.admitRef(liveRef, liveScope).ok, true, 'the live ref was refused');
        assertEqual(refs.admitRef({ ...liveRef, epoch: '1' }, liveScope).condition, 'staleReference',
          'a previous-pause ref was admitted');
        assertEqual(refs.admitRef({ ...liveRef, runtime: 'rt:other' }, liveScope).condition, 'foreignRuntime',
          'a foreign-runtime ref was admitted');
        assertEqual(refs.admitRef({ ...liveRef, epoch: 2 }, liveScope).condition, 'refMalformed',
          'a numeric epoch was admitted as counter text');
      },
    },
    {
      name: 'ref_mutation_generation_retires_live_value_refs',
      run() {
        assertEqual(refs.admitRef({ ...liveRef, mutationGeneration: '0' }, liveScope).condition,
          'refRetiredByMutation', 'a retired live-value ref was admitted');
        assertEqual(refs.admitRef({ ...liveRef, mutationGeneration: '2' }, liveScope).condition,
          'refRetiredByMutation', 'a future-generation ref was admitted');
        const advanced = state.nextState(paused, { type: 'evaluationSent', query: 'q-eval' });
        expect(advanced.ok, 'an evaluation from paused was refused');
        assertEqual(refs.admitRef(liveRef, {
          runtime: REF_RUNTIME, adapter: REF_ADAPTER,
          epoch: advanced.record.epoch, mutationGeneration: advanced.record.mutationGeneration,
        }).condition, 'refRetiredByMutation', 'the evaluation did not retire the previous generation');
      },
    },
    {
      name: 'pause_advances_the_epoch_by_exactly_one_successor',
      run() {
        const first = state.nextState(running, { type: 'paused' });
        expect(first.ok, 'a pause from running was refused');
        assertEqual(first.record.epoch, '3', 'the pause did not advance the epoch exactly once');
        const second = state.nextState(first.record, { type: 'paused' });
        assertEqual(second.record.epoch, '4', 'a repeated stop did not advance the epoch');
      },
    },
    {
      name: 'counter_advance_never_wraps_at_the_u32_or_double_boundary',
      run() {
        const u32 = state.nextState({ ...running, epoch: '4294967295' }, { type: 'paused' });
        expect(u32.ok, 'the U32 boundary pause was refused');
        assertEqual(u32.record.epoch, '4294967296', 'the U32 boundary epoch wrapped');
        const double = state.nextState({ ...running, epoch: '9007199254740992' }, { type: 'paused' });
        expect(double.ok, 'the double boundary pause was refused');
        assertEqual(double.record.epoch, '9007199254740993', 'the double boundary epoch lost exactness');
        const repeated = state.nextState({ ...running, epoch: '9'.repeat(30) }, { type: 'paused' });
        assertEqual(repeated.record.epoch, `1${'0'.repeat(30)}`, 'a long all-nine epoch carry');
        assertEqual(state.nextState({ ...running, epoch: '01' }, { type: 'paused' }).condition,
          'counterMalformed', 'a non-canonical epoch was advanced');
      },
    },
    {
      name: 'evaluation_advances_the_mutation_generation_before_its_send',
      run() {
        const sent = state.nextState(paused, { type: 'evaluationSent', query: 'q-eval' });
        expect(sent.ok, 'an evaluation from paused was refused');
        assertEqual(sent.record.mutationGeneration, '2', 'the mutation generation did not advance exactly once');
        assertEqual(sent.record.pending.intent, 'evaluate', 'the pending evaluation was not recorded');
        assertEqual(state.nextState(sent.record, { type: 'evaluationSent', query: 'q2' }).condition, 'runtimeBusy',
          'a second pending evaluation was admitted');
      },
    },
    {
      name: 'context_destruction_advances_the_epoch_and_ends_a_stop',
      run() {
        const destroyed = state.nextState(paused, { type: 'contextDestroyed' });
        expect(destroyed.ok, 'a context destruction from paused was refused');
        assertEqual(destroyed.record.epoch, '3', 'the destruction did not advance the epoch');
        assertEqual(destroyed.record.state, 'running', 'a destroyed context left the runtime stopped');
        const runningDestroyed = state.nextState(running, { type: 'contextDestroyed' });
        assertEqual(runningDestroyed.record.epoch, '3', 'the destruction did not advance the running epoch');
        assertEqual(state.nextState({ ...running, state: 'exited' }, { type: 'contextDestroyed' }).condition,
          'illegalTransition', 'a destruction after exit was admitted');
      },
    },
    {
      name: 'startup_release_after_an_observed_stop_keeps_the_stop',
      run() {
        let record = state.initialRecord();
        record = state.nextState(record, { type: 'launchStarted' }).record;
        record = state.nextState(record, { type: 'endpointDiscovered' }).record;
        const stopped = state.nextState(record, { type: 'paused' });
        expect(stopped.ok, 'a stop during the startup wait was refused');
        assertEqual(stopped.record.state, 'paused', 'the stop during the startup wait');
        assertEqual(stopped.record.epoch, '1', 'the stop advanced the epoch');
        const released = state.nextState(stopped.record, { type: 'startReleaseSent' });
        expect(released.ok, 'the start release after an observed stop was refused');
        assertEqual(released.record.state, 'paused', 'the start release did not keep the observed stop');
        assertEqual(released.record.epoch, '1', 'the start release changed the epoch');
        assertEqual(
          state.nextState({ ...record, state: 'starting' }, { type: 'startReleaseSent' }).condition,
          'illegalTransition',
          'a start release before the endpoint was admitted',
        );
        const exited = state.nextState(record, { type: 'childExit' }).record;
        assertEqual(state.nextState(exited, { type: 'adapterFailed' }).condition, 'illegalTransition',
          'an adapter failure after exit was admitted');
      },
    },
    {
      name: 'ref_decision_admits_only_an_explicit_validated_success',
      run() {
        const admitted = refs.admitRef(liveRef, liveScope);
        assertEqual(admitted.decision, 'admitted', 'the live ref decision');
        assertEqual(refs.refDecision(admitted).decision, 'admitted', 'an admitted decision revalidated');
        for (const candidate of [null, undefined, 'admitted', 42, [], {},
          { ok: true },
          { decision: 'admitted' },
          { decision: 'admitted', identity: { ...liveRef, epoch: 7 } },
          { decision: 'refused', condition: 'staleReference', detail: 'x' },
          { decision: 'unknown', ok: true }]) {
          assertEqual(refs.refDecision(candidate).decision, 'refused',
            `refDecision admitted ${JSON.stringify(candidate)}`);
        }
        assertEqual(refs.refDecision({ decision: 'refused', condition: 'staleReference' }).condition,
          'staleReference', 'a refusal keeps its condition');
        let thrown = null;
        try {
          refs.requireAdmittedRef({ ok: true });
        } catch (error) {
          thrown = error.condition;
        }
        assertEqual(thrown, 'refDecisionMalformed', 'requireAdmittedRef admitted a bare ok');
        assert(refs.requireAdmittedRef(admitted) === admitted.identity, 'the admitted identity is returned');
      },
    },
    {
      name: 'ref_decision_refuses_a_contradictory_candidate',
      run() {
        assertEqual(refs.refDecision({ decision: 'admitted', ok: false, identity: liveRef }).condition,
          'refDecisionContradictory', 'an admitted decision carrying ok:false was accepted');
        assertEqual(refs.refDecision({ decision: 'admitted', ok: true, identity: liveRef }).decision,
          'admitted', 'the agreed admitted shape was refused');
        assertEqual(refs.refDecision(refs.admitRef(liveRef, liveScope)).decision, 'admitted',
          'the current-scope admission was refused');
        assertEqual(refs.refDecision({ decision: 'refused', ok: true, condition: 'staleReference' }).condition,
          'staleReference', 'a refused decision lost its condition');
      },
    },
    {
      name: 'worker_channel_requires_an_owned_active_session',
      run() {
        const owned = ['ws-1'];
        const send = (method, params, workers) => intents.admitControlRequest(running, method, params,
          ['controlRuntime'], workers);
        assertEqual(send('NodeWorker.sendMessageToWorker', {
          sessionId: 'ws-1',
          message: JSON.stringify({ id: 1, method: 'Runtime.getProperties', params: {} }),
        }, owned).ok, true, 'a read on an owned worker session was refused');
        assertEqual(send('NodeWorker.sendMessageToWorker', {
          sessionId: 'ws-9',
          message: JSON.stringify({ id: 1, method: 'Runtime.getProperties', params: {} }),
        }, owned).condition, 'workerSessionUnknown', 'a foreign worker session was admitted');
        assertEqual(send('NodeWorker.sendMessageToWorker', {
          message: JSON.stringify({ id: 1, method: 'Runtime.getProperties', params: {} }),
        }, owned).condition, 'workerSessionMissing', 'a message without a session id was admitted');
        assertEqual(send('NodeWorker.detach', { sessionId: 'ws-9' }, owned).condition, 'workerSessionUnknown',
          'detaching a foreign worker session was admitted');
        assertEqual(send('NodeWorker.detach', { sessionId: 'ws-1' }, owned).ok, true,
          'detaching an owned worker session was refused');
        assertEqual(send('NodeWorker.sendMessageToWorker', {
          sessionId: 'ws-1',
          message: JSON.stringify({ id: 1, method: 'Runtime.getProperties', params: {} }),
        }, []).condition, 'workerSessionUnknown', 'an unowned session list admitted a worker message');
      },
    },
    {
      name: 'resume_rejection_retains_the_stop_without_live_evidence',
      run() {
        const sent = state.nextState(paused, { type: 'resumeSent' });
        expect(sent.ok, 'the resume send transition was refused');
        assertEqual(sent.record.state, 'running', 'the resume send state');
        assertEqual(sent.record.epoch, '3', 'the resume send advanced the epoch');
        const rejected = state.nextState(sent.record, { type: 'resumeRejected' });
        expect(rejected.ok, 'the resume rejection was refused');
        assertEqual(rejected.record.state, 'paused', 'the rejection did not retain the stop');
        assertEqual(rejected.record.epoch, '3', 'the rejection changed the invalidating epoch');
        assertEqual(rejected.record.targetLiveness, 'live', 'the rejection asserted a target exit');
        assertEqual(state.nextState(paused, { type: 'resumeRejected' }).condition, 'illegalTransition',
          'a rejection outside a resume attempt was admitted');
      },
    },
    {
      name: 'pause_acknowledgment_after_a_stopped_event_keeps_the_stop',
      run() {
        let record = { ...running, pending: { query: 'q-pause', intent: 'pause' } };
        const stopped = state.nextState(record, { type: 'paused' });
        expect(stopped.ok, 'a stop during an acknowledged pause was refused');
        record = state.nextState(stopped.record, { type: 'intentSettled' }).record;
        assertEqual(record.state, 'paused', 'the settled request lost the stop');
        assertEqual(record.pending, null, 'the request stayed pending');
        // The acknowledgment must not be applied as pauseRequested from a stopped record.
        assertEqual(state.nextState(record, { type: 'pauseRequested' }).condition, 'illegalTransition',
          'a stopped record accepted a new pause request');
      },
    },
    {
      name: 'adapter_failure_never_asserts_target_exit',
      run() {
        const failed = state.nextState(paused, { type: 'adapterFailed' });
        expect(failed.ok, 'adapter failure was refused');
        assertEqual(failed.record.state, 'failed', 'the failure state');
        assertEqual(failed.record.targetLiveness, 'live', 'adapter failure changed the recorded target liveness');
        const exited = state.nextState(failed.record, { type: 'childExit' });
        assertEqual(exited.record.targetLiveness, 'exited', 'target exit evidence did not set liveness');
      },
    },
    {
      name: 'intent_without_its_grant_refuses_before_the_effect',
      run() {
        assertEqual(intents.admitIntent(paused, 'evaluate', { effects: [] }).condition, 'missingEffect',
          'an evaluation without grants was admitted');
        assertEqual(intents.admitIntent(paused, 'evaluate', { effects: ['controlRuntime'] }).condition, 'missingEffect',
          'an evaluation without evaluateRuntime was admitted');
        assertEqual(intents.admitIntent(paused, 'observe', {}).ok, true, 'a zero-grant observe was refused');
        assertEqual(intents.admitIntent(paused, 'resume-step', { effects: ['controlRuntime'] }).ok, true,
          'a granted resume was refused');
      },
    },
    {
      name: 'serialized_intents_refuse_runtime_busy_while_one_is_pending',
      run() {
        assertEqual(
          intents.admitIntent(pending, 'evaluate', { effects: ['controlRuntime', 'evaluateRuntime'] }).condition,
          'runtimeBusy',
          'a second serialized intent was admitted while one was pending',
        );
        assertEqual(intents.admitIntent(pending, 'observe', {}).ok, true,
          'observe was refused while an evaluation is pending');
      },
    },
    {
      name: 'release_is_admitted_while_an_evaluation_is_pending',
      run() {
        const release = intents.admitIntent(pending, 'release', { effects: ['controlRuntime'], signal: 'SIGKILL' });
        assertEqual(release.ok, true, 'release was refused while an evaluation is pending');
        assertEqual(intents.admitIntent(pending, 'release', { effects: [], signal: 'SIGKILL' }).condition, 'missingEffect',
          'release without its grant was admitted');
      },
    },
    {
      name: 'observation_read_path_carries_only_non_effectful_requests',
      run() {
        for (const method of ['Runtime.runIfWaitingForDebugger', 'Debugger.enable',
          'NodeWorker.detach', 'NodeWorker.sendMessageToWorker', 'Debugger.setBreakpointByUrl']) {
          assertEqual(intents.admitReadRequest(running, method).condition, 'controlRequiresGrant',
            `${method} was admitted on the zero-grant read path`);
        }
        assertEqual(intents.admitReadRequest(running, 'Runtime.getProperties').category, 'read',
          'a non-effectful read was refused');
        assertEqual(intents.admitReadRequest(running, 'Runtime.evaluate').condition, 'evaluationRequiresIntent',
          'an evaluation was admitted on the read path');
        assertEqual(intents.admitReadRequest(running, 'Debugger.pause').condition, 'stateChangeRequiresIntent',
          'a pause-state request was admitted on the read path');
        assertEqual(intents.admitReadRequest(running, 'Debugger.wasThrown').condition, 'requestUnlisted',
          'an unlisted request was admitted on the read path');
        assertEqual(intents.admitReadRequest({ ...running, state: 'exited' }, 'Runtime.getProperties').condition,
          'requestNotAdmitted', 'a read after exit was admitted');
        assertEqual(intents.admitReadRequest({ ...running, state: 'failed' }, 'Runtime.getProperties').condition,
          'requestNotAdmitted', 'a read after adapter failure was admitted');
      },
    },
    {
      name: 'control_path_requires_the_control_grant_and_refuses_evaluation',
      run() {
        assertEqual(intents.admitControlRequest(running, 'NodeWorker.detach', {}, []).condition, 'missingEffect',
          'a control request without its grant was admitted');
        assertEqual(intents.admitControlRequest(running, 'NodeWorker.detach', {}, ['controlRuntime']).category,
          'control', 'a granted worker detach was refused');
        assertEqual(intents.admitControlRequest(running, 'Debugger.enable', {}, ['controlRuntime']).ok, true,
          'a granted domain enablement was refused');
        assertEqual(intents.admitControlRequest(running, 'Runtime.evaluate', {}, ['controlRuntime']).condition,
          'evaluationRequiresIntent', 'an evaluation was admitted on the control path');
        assertEqual(intents.admitControlRequest(running, 'Debugger.pause', {}, ['controlRuntime']).condition,
          'stateChangeRequiresIntent', 'a pause-state request was admitted on the control path');
        assertEqual(intents.admitControlRequest(running, 'Runtime.getProperties', {}, ['controlRuntime']).condition,
          'readRequiresNoGrant', 'a zero-grant read was admitted on the control path');
        assertEqual(intents.admitControlRequest({ ...running, state: 'exited' }, 'Debugger.enable', {}, ['controlRuntime']).condition,
          'requestNotAdmitted', 'a control request after exit was admitted');
      },
    },
    {
      name: 'control_requests_serialize_against_a_pending_evaluation',
      run() {
        const denied = intents.admitControlRequest(pending, 'Debugger.enable', {}, ['controlRuntime']);
        assertEqual(denied.condition, 'runtimeBusy',
          'a control request was admitted while an evaluation is pending');
        assertEqual(denied.detail, 'pending evaluate', 'the refusal names the pending intent');
        for (const method of ['Runtime.runIfWaitingForDebugger', 'Debugger.setBreakpointByUrl',
          'NodeWorker.detach', 'NodeWorker.sendMessageToWorker']) {
          assertEqual(intents.admitControlRequest(pending, method, {}, ['controlRuntime']).ok, false,
            `${method} was admitted while an evaluation is pending`);
        }
        assertEqual(intents.admitControlRequest(running, 'Debugger.enable', {}, ['controlRuntime']).ok, true,
          'a control request was refused while the runtime is idle');
        assertEqual(intents.admitIntent(pending, 'release', { effects: ['controlRuntime'], signal: 'SIGKILL' }).ok, true,
          'release was refused while an evaluation is pending');
      },
    },
    {
      name: 'nested_worker_message_must_itself_be_a_read',
      run() {
        const reads = intents.admitControlRequest(running, 'NodeWorker.sendMessageToWorker', {
          message: JSON.stringify({ id: 2, method: 'Runtime.getProperties', params: {} }),
        }, ['controlRuntime']);
        assertEqual(reads.ok, true, 'a nested read was refused');
        const evaluate = intents.admitControlRequest(running, 'NodeWorker.sendMessageToWorker', {
          message: JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: '1+1' } }),
        }, ['controlRuntime']);
        assertEqual(evaluate.condition, 'evaluationRequiresIntent', 'a nested evaluation was admitted');
        const control = intents.admitControlRequest(running, 'NodeWorker.sendMessageToWorker', {
          message: JSON.stringify({ id: 3, method: 'Debugger.setBreakpointByUrl', params: {} }),
        }, ['controlRuntime']);
        assertEqual(control.condition, 'nestedControlNotAdmitted', 'a nested control request was admitted');
        const malformed = intents.admitControlRequest(running, 'NodeWorker.sendMessageToWorker', { message: 'not json' },
          ['controlRuntime']);
        assertEqual(malformed.condition, 'workerMessageMalformed', 'a malformed nested message was admitted');
      },
    },
    {
      name: 'breakpoint_condition_is_refused_because_it_is_target_javascript',
      run() {
        const refused = intents.admitControlRequest(running, 'Debugger.setBreakpointByUrl',
          { url: 'file:///a.js', lineNumber: 3, condition: 'x > 1' }, ['controlRuntime']);
        assertEqual(refused.condition, 'breakpointConditionUnsupported', 'a conditional breakpoint was admitted');
        const located = intents.admitControlRequest(running, 'Debugger.setBreakpointByUrl',
          { url: 'file:///a.js', lineNumber: 3 }, ['controlRuntime']);
        assertEqual(located.ok, true, 'a generated-location breakpoint was refused');
        const urlRegex = intents.admitControlRequest(running, 'Debugger.setBreakpointByUrl',
          { urlRegex: '.*a\\.js$', lineNumber: 3 }, ['controlRuntime']);
        assertEqual(urlRegex.condition, 'breakpointParamsUnsupported', 'a URL pattern was admitted');
        const locatedByScript = intents.admitControlRequest(running, 'Debugger.setBreakpoint',
          { location: { scriptId: '1', lineNumber: 3 } }, ['controlRuntime']);
        assertEqual(locatedByScript.ok, true, 'a located breakpoint was refused');
        const withCondition = intents.admitControlRequest(running, 'Debugger.setBreakpoint',
          { location: { scriptId: '1', lineNumber: 3 }, condition: 'x > 1' }, ['controlRuntime']);
        assertEqual(withCondition.condition, 'breakpointConditionUnsupported', 'a located condition was admitted');
        // Absent location metadata refuses here rather than passing on a table entry and
        // failing later at the backend.
        const noUrl = intents.admitControlRequest(running, 'Debugger.setBreakpointByUrl', {}, ['controlRuntime']);
        assertEqual(noUrl.condition, 'breakpointLocationMissing', 'a breakpoint without a url was admitted');
        assertEqual(noUrl.detail, 'url', 'the missing url member');
        const noLine = intents.admitControlRequest(running, 'Debugger.setBreakpointByUrl',
          { url: 'file:///a.js' }, ['controlRuntime']);
        assertEqual(noLine.detail, 'lineNumber', 'a breakpoint without a line was admitted');
        const noLocation = intents.admitControlRequest(running, 'Debugger.setBreakpoint', {}, ['controlRuntime']);
        assertEqual(noLocation.detail, 'location', 'a located breakpoint without a location was admitted');
        const noId = intents.admitControlRequest(running, 'Debugger.removeBreakpoint', {}, ['controlRuntime']);
        assertEqual(noId.detail, 'breakpointId', 'a removal without an id was admitted');
        let thrown = null;
        try {
          intents.startupStopRequests([{ url: 'file:///a.js', lineNumber: 3, condition: 'x > 1' }]);
        } catch (error) {
          thrown = error.condition;
        }
        assertEqual(thrown, 'breakpointConditionUnsupported', 'a conditional startup stop was admitted');
        assertEqual(intents.startupStopRequests([{ url: 'file:///a.js', lineNumber: 3 }])[0].method,
          'Debugger.setBreakpointByUrl', 'a located startup stop was refused');
      },
    },
    {
      name: 'release_signal_order_refuses_a_downgrade',
      run() {
        assertEqual(
          intents.admitIntent(paused, 'release', { effects: ['controlRuntime'], signal: 'SIGTERM', priorSignal: 'SIGKILL' }).condition,
          'signalDowngrade',
          'SIGTERM overwrote an explicit SIGKILL intent',
        );
        assertEqual(intents.admitIntent(paused, 'release', { effects: ['controlRuntime'], signal: 'SIGKILL' }).ok, true,
          'SIGKILL was refused');
        assertEqual(intents.admitIntent(paused, 'release', { effects: ['controlRuntime'], signal: 'SIGUSR1' }).condition,
          'releaseSignalUnsupported', 'an unlisted signal was admitted');
      },
    },
    {
      name: 'transport_refuses_a_non_loopback_endpoint',
      run() {
        const foreign = transport.admitLoopbackEndpoint('ws://10.0.0.5:9229/uuid');
        assertEqual(foreign.condition, 'endpointNotLoopback', 'a non-loopback endpoint was admitted');
        expect(transport.admitLoopbackEndpoint('ws://127.0.0.1:9229/uuid').ok, 'a loopback endpoint was refused');
        expect(transport.admitLoopbackEndpoint('ws://localhost:9229/uuid').ok, 'localhost was refused');
        assertEqual(transport.admitLoopbackEndpoint('http://127.0.0.1:9229/uuid').condition, 'endpointNotWebSocket',
          'a non-websocket endpoint was admitted');
        assertEqual(transport.admitLoopbackEndpoint('not a url').condition, 'endpointMalformed',
          'a malformed endpoint was admitted');
      },
    },
    {
      name: 'endpoint_banner_requires_its_complete_line_and_loopback_host',
      run() {
        assertEqual(endpoint.parseInspectorBanner('Debugger listening on ws://127.0.0.1:9000/abc'), null,
          'a banner without its newline was reported as an endpoint');
        const parsed = endpoint.parseInspectorBanner('Debugger listening on ws://127.0.0.1:9000/abc\n');
        assertEqual(parsed.port, 9000, 'port');
        assertEqual(parsed.uuid, 'abc', 'uuid');
        assertEqual(endpoint.parseInspectorBanner('ws://127.0.0.1:9000/abc\n'), null,
          'a line without the banner phrase was reported');
        assertEqual(endpoint.parseInspectorBanner('Debugger listening on ws://10.0.0.5:9000/abc\n'), null,
          'a non-loopback endpoint was admitted');
      },
    },
    {
      name: 'endpoint_watch_refuses_replacement_and_truncation',
      run() {
        const { mkdtempSync, writeFileSync, renameSync, truncateSync } = modules.fs;
        const dir = mkdtempSync(modules.scratchPrefix);
        const path = `${dir}/stderr`;
        writeFileSync(path, 'start\n');
        const seen = [];
        const failures = [];
        const handle = endpoint.watchTargetStderr({
          path,
          onEndpoint: (value) => seen.push(value),
          onFailure: (value) => failures.push(value),
        });
        writeFileSync(`${dir}/other`, 'Debugger listening on ws://127.0.0.1:9001/aaaa\n');
        renameSync(`${dir}/other`, path);
        handle.scan();
        assertEqual(seen.length, 0, 'a replaced stderr file supplied an endpoint');
        assertEqual(failures.length, 1, 'the replacement was not refused');
        assertEqual(failures[0].condition, 'endpointReplaced', 'replacement condition');
        handle.stop();

        const truncPath = `${dir}/trunc`;
        writeFileSync(truncPath, 'noise\n');
        const truncFailures = [];
        const truncHandle = endpoint.watchTargetStderr({ path: truncPath, onFailure: (value) => truncFailures.push(value) });
        truncateSync(truncPath, 2);
        truncHandle.scan();
        assertEqual(truncFailures[0]?.condition, 'endpointTruncated', 'the truncation was not refused');
        truncHandle.stop();

        const missingFailures = [];
        const missing = endpoint.watchTargetStderr({ path: `${dir}/absent`, onFailure: (value) => missingFailures.push(value) });
        assertEqual(missingFailures[0]?.condition, 'endpointWatchFailed', 'a missing recorded stderr file was admitted');
        missing.stop();
      },
    },
    {
      name: 'session_read_path_refuses_control_requests_and_string_refs_outside_a_pause',
      run() {
        const adapter = session.createAdapterSession({ runtime: REF_RUNTIME, adapter: REF_ADAPTER, incarnation: '0' });
        const refusedSend = adapter.send({ query: 'q', method: 'Runtime.runIfWaitingForDebugger' });
        return refusedSend.then(
          () => { throw new Error('a control request was admitted on the read path'); },
          (error) => {
            assertEqual(error.condition, 'controlRequiresGrant', 'the read path refusal condition');
            const encoded = refs.encodeRefId(liveRef);
            assertEqual(adapter.admitRef(encoded).condition, 'refOutsidePause',
              'a canonical ref string bypassed the pause scope while starting');
            assertEqual(adapter.snapshot().epoch, '0', 'the initial epoch is the canonical initial counter');
          },
        );
      },
    },
    {
      name: 'launch_document_refuses_an_argument_vector_that_keeps_a_wrapper',
      run() {
        const node = '/usr/bin/node';
        const good = { version: 1, node, argv: [node, '/target.mjs'], env: { PATH: '/usr/bin:/bin' } };
        expect(bootstrap.admitLaunchDocument(JSON.stringify(good)).ok, 'a valid launch document was refused');
        assertEqual(
          bootstrap.admitLaunchDocument(JSON.stringify({ ...good, argv: ['/bin/sh', node, '/target.mjs'] })).condition,
          'launchArgvMismatch',
          'an argument vector with a wrapper was admitted',
        );
      },
    },
    {
      name: 'launch_document_refuses_a_non_string_environment_value',
      run() {
        const node = '/usr/bin/node';
        const base = { version: 1, node, argv: [node, '/target.mjs'] };
        assertEqual(
          bootstrap.admitLaunchDocument(JSON.stringify({ ...base, env: { PORT: 8080 } })).condition,
          'launchEnvInvalid',
          'a numeric environment value was admitted',
        );
        assertEqual(
          bootstrap.admitLaunchDocument(JSON.stringify({ ...base, env: { 'A=B': 'x' } })).condition,
          'launchEnvInvalid',
          'an environment name carrying an assignment was admitted',
        );
        expect(bootstrap.admitLaunchDocument(JSON.stringify({ ...base, env: {} })).ok,
          'a complete empty environment was refused');
      },
    },
    {
      name: 'script_identity_conflict_refuses_rather_than_overwriting',
      run() {
        const table = scripts.createScriptTable();
        table.record({ scriptId: '1', url: 'file:///a.js' });
        let condition = null;
        try {
          table.record({ scriptId: '1', url: 'file:///b.js' });
        } catch (error) {
          condition = error.condition;
        }
        assertEqual(condition, 'scriptIdentityConflict', 'a conflicting script identity overwrote the record');
      },
    },
    {
      name: 'loaded_source_identity_is_the_digest_of_the_loaded_bytes',
      run() {
        const table = scripts.createScriptTable();
        table.record({ scriptId: '7', url: 'file:///m.js', sourceMapURL: 'file:///m.js.map' });
        const first = table.attachLoaded({ scriptId: '7', source: 'const a = 1;\n' });
        assertEqual(first.loaded.length, 13, 'loaded length');
        assertEqual(first.loaded.sha256.length, 64, 'loaded digest is not a SHA-256');
        assertEqual(first.mapReference.url, 'file:///m.js.map', 'map reference');
        assertEqual(first.mapReference.urlTextSha256.length, 64, 'the URL text digest');
        assertEqual(first.mapReference.embedded, false, 'the map is not embedded');
        const second = table.attachLoaded({ scriptId: '7', source: 'const a = 2;\n' });
        expect(first.loaded.sha256 !== second.loaded.sha256, 'a changed loaded source kept its identity');
        // The map reference is the URL text identity only; it is not a decoded map-byte
        // digest, which the source-map owner produces.
        assert(!Object.hasOwn(first.mapReference, 'sha256'), 'the map reference claims a map-byte digest');
      },
    },
  ];
}
