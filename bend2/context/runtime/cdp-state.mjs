// CDP runtime lane: the runtime state machine, pause epoch and mutation generation.
//
// Contract: docs/bend2/semantic-context-spec.md, "Runtime contract". Runtime state is
// starting, waitingForStart, running, pausePending, paused, releasing, exited or failed.
// The startup wait and a later actual paused event are distinct states. A pause request
// acknowledged by the protocol records pausePending; the stopped event completes it. An
// adapter failure may coexist with a still-running target, so `failed` alone is never a
// target-exit assertion: the record keeps an explicit targetLiveness fact that only
// target exit evidence changes.
//
// Counter identities (runtime-counter-boundary-69): `epoch` and `mutationGeneration` are
// canonical unsigned decimal text. They start at "0" and advance with the exact
// successor from cdp-counter.mjs, so no increment wraps and no retired reference can be
// re-admitted by a numeric overflow. A counter that is not admitted text refuses the
// transition rather than being normalized.
//
// The record is a plain immutable value: {state, epoch, mutationGeneration, pending,
// targetLiveness}. This module reads no clock, no filesystem and no process. "No timer
// establishes inspector readiness" and no elapsed time drives any transition here.

import { INITIAL_COUNTER, counterNext, counterPair } from './cdp-counter.mjs';

export const STATES = Object.freeze([
  'starting',
  'waitingForStart',
  'running',
  'pausePending',
  'paused',
  'releasing',
  'exited',
  'failed',
]);

export const TARGET_LIVENESS = Object.freeze(['unknown', 'live', 'exited']);

export class StateRefusal extends Error {
  constructor(condition, detail) {
    super(detail === undefined || detail === null ? condition : `${condition}: ${detail}`);
    this.name = 'StateRefusal';
    this.condition = condition;
    this.detail = detail === undefined ? null : detail;
  }
}

function refusal(condition, detail) {
  return { ok: false, condition, detail: detail === undefined ? null : detail };
}

export function initialRecord() {
  return {
    state: 'starting',
    epoch: INITIAL_COUNTER,
    mutationGeneration: INITIAL_COUNTER,
    pending: null,
    targetLiveness: 'unknown',
  };
}

const TERMINAL = Object.freeze(['exited']);

export function isTerminal(record) {
  return TERMINAL.includes(record.state);
}

function advanceCounter(record, member) {
  const next = counterNext(record[member]);
  if (!next.ok) return refusal('counterMalformed', `${member}: ${next.detail}`);
  return { ok: true, value: next.value };
}

// The pure transition function. Every event is closed and typed; an event the record's
// state does not admit is an illegalTransition refusal rather than a silent state change.
export function nextState(record, event) {
  if (typeof record !== 'object' || record === null) return refusal('transitionMalformed', 'record');
  if (!STATES.includes(record.state)) return refusal('transitionMalformed', `state ${record.state}`);
  const counters = counterPair(record.epoch, record.mutationGeneration);
  if (!counters.ok) return refusal('counterMalformed', counters.detail);
  if (typeof event !== 'object' || event === null) return refusal('transitionMalformed', 'event');
  const type = event.type;

  if (record.state === 'exited' && type !== 'childExit') {
    return refusal('illegalTransition', `${type} after exited`);
  }

  switch (type) {
    // The owned child was launched by the target keeper; the inspector endpoint has not
    // been discovered yet.
    case 'launchStarted':
      if (record.state !== 'starting') return refusal('illegalTransition', `launchStarted from ${record.state}`);
      return { ok: true, record: { ...record, targetLiveness: 'live' } };

    // The endpoint appears in the recorded target stderr. The subject still waits for
    // runIfWaitingForDebugger.
    case 'endpointDiscovered':
      if (record.state !== 'starting') return refusal('illegalTransition', `endpointDiscovered from ${record.state}`);
      return { ok: true, record: { ...record, state: 'waitingForStart', targetLiveness: 'live' } };

    // Runtime.runIfWaitingForDebugger was sent: the startup wait ended. An observed stop
    // may precede this response, in which case that stop already ended the wait and the
    // record stays stopped.
    case 'startReleaseSent':
      if (record.state === 'waitingForStart') return { ok: true, record: { ...record, state: 'running' } };
      if (record.state === 'paused') return { ok: true, record };
      return refusal('illegalTransition', `startReleaseSent from ${record.state}`);

    // A pause request was acknowledged by the protocol. The actual stop is a later
    // stopped event; no timeout may convert this into either outcome.
    case 'pauseRequested':
      if (record.state !== 'running') return refusal('illegalTransition', `pauseRequested from ${record.state}`);
      return { ok: true, record: { ...record, state: 'pausePending' } };

    // An observed stopped event. It advances the epoch. It can precede the protocol
    // response of the request that caused it.
    case 'paused': {
      if (record.state !== 'running' && record.state !== 'pausePending' && record.state !== 'paused'
        && record.state !== 'waitingForStart') {
        return refusal('illegalTransition', `paused from ${record.state}`);
      }
      const epoch = advanceCounter(record, 'epoch');
      if (!epoch.ok) return epoch;
      return {
        ok: true,
        record: { ...record, state: 'paused', epoch: epoch.value, targetLiveness: 'live' },
      };
    }

    // An observed resumed event. A resume invalidates every pause-scoped ref, so it
    // advances the epoch as well.
    case 'resumed': {
      if (record.state !== 'paused' && record.state !== 'pausePending') {
        return refusal('illegalTransition', `resumed from ${record.state}`);
      }
      const epoch = advanceCounter(record, 'epoch');
      if (!epoch.ok) return epoch;
      return { ok: true, record: { ...record, state: 'running', epoch: epoch.value } };
    }

    // A resume/step was sent by the adapter: the pause it leaves is invalidated at send,
    // so a ref admitted before this point refuses immediately.
    case 'resumeSent': {
      if (record.state !== 'paused') return refusal('illegalTransition', `resumeSent from ${record.state}`);
      const epoch = advanceCounter(record, 'epoch');
      if (!epoch.ok) return epoch;
      return { ok: true, record: { ...record, state: 'running', epoch: epoch.value } };
    }

    // An invalidating execution-context destruction. Every pause-scoped ref from the
    // destroyed context is invalid, so the epoch advances, and a stop or an acknowledged
    // pause request returns to running.
    case 'contextDestroyed': {
      const epoch = advanceCounter(record, 'epoch');
      if (!epoch.ok) return epoch;
      const wasStopped = record.state === 'paused' || record.state === 'pausePending';
      return {
        ok: true,
        record: { ...record, state: wasStopped ? 'running' : record.state, epoch: epoch.value },
      };
    }

    // An evaluation was admitted and sent: the mutation generation advances before the
    // send, retiring previously issued live-value refs. The evaluation stays pending
    // until it responds or the runtime is released.
    case 'evaluationSent': {
      if (record.state !== 'paused' && record.state !== 'running') {
        return refusal('illegalTransition', `evaluationSent from ${record.state}`);
      }
      if (record.pending !== null) return refusal('runtimeBusy', `pending ${record.pending.intent}`);
      const mutation = advanceCounter(record, 'mutationGeneration');
      if (!mutation.ok) return mutation;
      return {
        ok: true,
        record: {
          ...record,
          mutationGeneration: mutation.value,
          pending: { query: event.query ?? null, intent: 'evaluate' },
        },
      };
    }

    // The evaluation response arrived, in band or as a transport error.
    case 'evaluationSettled':
      if (record.pending === null || record.pending.intent !== 'evaluate') {
        return refusal('illegalTransition', 'no pending evaluation');
      }
      return { ok: true, record: { ...record, pending: null } };

    // Another state-changing intent is in flight. Release does not use this event:
    // release is always available to the owner.
    case 'intentStarted':
      if (record.pending !== null) return refusal('runtimeBusy', `pending ${record.pending.intent}`);
      return { ok: true, record: { ...record, pending: { query: event.query ?? null, intent: event.intent } } };

    case 'intentSettled':
      if (record.pending === null) return refusal('illegalTransition', 'no pending intent');
      return { ok: true, record: { ...record, pending: null } };

    // The owner committed a release intent. The state records that the release was
    // communicated to the native keeper; it asserts no exit and no reap.
    case 'releaseCommitted':
      if (record.state === 'exited') return refusal('illegalTransition', 'releaseCommitted after exited');
      return { ok: true, record: { ...record, state: 'releasing' } };

    // The adapter failed. The target may still be live; only target exit evidence changes
    // targetLiveness.
    case 'adapterFailed':
      return { ok: true, record: { ...record, state: 'failed' } };

    // Target exit evidence, written only by the target observer.
    case 'childExit':
      if (record.state === 'exited') return refusal('illegalTransition', 'childExit after exited');
      return { ok: true, record: { ...record, state: 'exited', targetLiveness: 'exited' } };

    default:
      return refusal('transitionMalformed', `unknown event ${type}`);
  }
}

export { refusal as stateRefusal };
