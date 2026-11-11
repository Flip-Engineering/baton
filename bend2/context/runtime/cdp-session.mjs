// CDP runtime lane: the adapter session.
//
// Contract: docs/bend2/semantic-context-spec.md, "Runtime contract". This is the
// importable interface the rest of the lane composes against. It owns protocol state,
// the pause epoch, the mutation generation, reference admission and the validated
// request paths; the observations owner composes frames, scopes, values, previews and
// source-map resolution on top of it.
//
// Ownership boundary: the adapter never owns or reaps the target. Release only
// communicates the owner's committed intent to the native keeper and adopts that
// keeper's reported result. It never signals a raw pid, never reaps a child and never
// waits for a CDP evaluation response. The keeper remains the target's process parent
// and the only writer of target exit evidence.
//
// Request paths: `send` is the zero-grant read path and carries only non-effectful
// requests. `control` is the grant-gated configuration path (domain enablement, the
// startup release, generated-location breakpoints without a condition, worker session
// plumbing whose nested message must itself be a read). Evaluation and pause-state
// requests are reachable only through their intents.
//
// Counters: the pause epoch and the mutation generation are canonical unsigned decimal
// text (runtime-counter-boundary-69) and advance with the exact successor, so no retired
// reference can be re-admitted by an overflow.
//
// Transport loss: a lost or closed connection sets the runtime's adapter-failure state,
// marks the recorded stop historical and asserts nothing about the target, whose custody
// stays with the native keeper.
//
// Reference decisions: `admitRef` returns {decision:'admitted',identity} or
// {decision:'refused',condition,detail}. Only an admitted decision lets a caller send.
// A pause-scoped ref additionally requires a stop whose recorded liveness is live, and
// every ref must name a live thread. `connect` is the connection factory (the real
// inspector transport by default); a source fixture may inject a failing or reordering
// stub to exercise a rejected send without a target.

import { counterNext } from './cdp-counter.mjs';
import { admitControlRequest, admitIntent, admitReadRequest, requestForIntent, startupStopRequests } from './cdp-intents.mjs';
import { admitFrame, encodeFrame, sequenceAdmit } from './cdp-protocol.mjs';
import { admitRef, decodeRefId } from './cdp-refs.mjs';
import { createScriptTable } from './cdp-scripts.mjs';
import { initialRecord, nextState, StateRefusal } from './cdp-state.mjs';
import { CdpTransport, TransportRefusal } from './cdp-transport.mjs';

export const ADAPTER_VERSION = 1;

export class SessionRefusal extends Error {
  constructor(condition, detail) {
    super(detail === undefined || detail === null ? condition : `${condition}: ${detail}`);
    this.name = 'SessionRefusal';
    this.condition = condition;
    this.detail = detail === undefined ? null : detail;
  }
}

const PAUSE_SCOPED = Object.freeze(['frame', 'scope', 'object']);

export function createAdapterSession({
  runtime,
  adapter,
  incarnation,
  control = null,
  emit = null,
  connect = CdpTransport.connect,
}) {
  if (typeof runtime !== 'string' || runtime.length === 0) throw new SessionRefusal('runtimeMissing', null);
  if (typeof adapter !== 'string' || adapter.length === 0) throw new SessionRefusal('adapterMissing', null);
  if (typeof incarnation !== 'string' || incarnation.length === 0) {
    throw new SessionRefusal('incarnationMissing', null);
  }

  let record = initialRecord();
  let sequenceState = null;
  let transport = null;
  let lastPause = null;
  let lastResume = null;
  let releaseSignal = null;
  let published = 0;
  const scripts = createScriptTable();
  const workers = new Map();
  const subscriptions = [];

  const apply = (event) => {
    const result = nextState(record, event);
    if (!result.ok) throw new StateRefusal(result.condition, result.detail);
    record = result.record;
    return record;
  };

  // One frame on the adapter -> native observer channel, with a monotone sequence per
  // adapter. A request-associated frame carries the caller's own request identity: the
  // publisher refuses an absent one rather than inventing an identity that would hide the
  // caller's defect. The exact chosen envelope bytes are admitted before any state change or
  // emission, so a refused frame consumes no sequence and no publication count. No endpoint
  // identity appears.
  const publish = ({ query, type, payload }) => {
    if (type !== 'state' && (typeof query !== 'string' || query.length === 0)) {
      throw new SessionRefusal('publishQueryMissing',
        `a ${type} frame carries the caller's request identity`);
    }
    const sequence = sequenceState === null ? 0 : sequenceState.sequence + 1;
    const frame = {
      version: ADAPTER_VERSION,
      query: query ?? null,
      runtime,
      role: 'adapter',
      incarnation,
      sequence,
      type,
      payload,
    };
    const bytes = encodeFrame(frame);
    const envelope = admitFrame(bytes, { runtime, role: 'adapter', incarnation, query: frame.query });
    if (!envelope.ok) throw new SessionRefusal(envelope.condition, envelope.detail);
    const admitted = sequenceAdmit(sequenceState, sequence, bytes);
    if (!admitted.ok) throw new SessionRefusal(admitted.condition, admitted.detail);
    sequenceState = { sequence, retained: admitted.retained };
    published += 1;
    if (typeof emit === 'function') emit({ frame, bytes, replay: admitted.replay });
    return frame;
  };

  // Secondary evidence never replaces the failure it describes. Everything is inspected
  // inside the guard, because both inputs can throw on inspection: the failure may be frozen,
  // sealed or carry a throwing setter, and the secondary thrown value may be null, undefined,
  // a primitive or an object with a throwing condition accessor. The original failure always
  // reaches the caller; the record is best effort.
  const recordPublicationFailure = (failure, secondary) => {
    try {
      if (failure === null || typeof failure !== 'object' || !Object.isExtensible(failure)) {
        return;
      }
      const condition = secondary !== null && typeof secondary === 'object'
        ? secondary.condition ?? null
        : null;
      failure.publicationFailure = typeof condition === 'string' ? condition : null;
    } catch {
      // A refused or unavailable secondary record is dropped; the original failure stands.
    }
  };

  // A lost or closed connection is an adapter failure. It is never a target-exit
  // assertion: the target keeps its own custody and its own observer.
  const onTransportFailure = (failure) => {
    if (lastPause !== null && lastPause.liveness !== 'historical') {
      lastPause = { ...lastPause, liveness: 'historical' };
    }
    if (record.state !== 'exited' && record.state !== 'failed') {
      apply({ type: 'adapterFailed' });
    }
    // This evidence path never masks the failure it reports: a refused publication of the
    // state frame is recorded on the failure instead of replacing it.
    try {
      publish({
        query: null,
        type: 'state',
        payload: {
          state: record.state,
          evidence: { transport: { condition: failure.condition, historicalPause: lastPause !== null } },
        },
      });
    } catch (publication) {
      recordPublicationFailure(failure, publication);
    }
  };

  const handleEvent = (params, message) => {
    switch (message.method) {
      case 'Debugger.scriptParsed':
        scripts.record(params);
        break;
      case 'Debugger.paused': {
        apply({ type: 'paused' });
        lastPause = {
          epoch: record.epoch,
          thread: params.threadId ?? 'main:0',
          reason: params.reason ?? null,
          hitBreakpoints: Array.isArray(params.hitBreakpoints) ? [...params.hitBreakpoints] : [],
          callFrameCount: Array.isArray(params.callFrames) ? params.callFrames.length : 0,
          liveness: 'live',
        };
        publish({ query: null, type: 'state', payload: { state: record.state, evidence: { pause: lastPause } } });
        break;
      }
      case 'Debugger.resumed':
        // An observed resume is evidence for the epoch it arrived in, whether or not the
        // record still shows a stop. After resumeSent the record is already running, so the
        // event advances nothing; it is recorded so a later query can see that a resume was
        // observed rather than inferred.
        lastResume = { epoch: record.epoch };
        if (record.state === 'paused' || record.state === 'pausePending') {
          apply({ type: 'resumed' });
          lastResume = { epoch: record.epoch };
          markPauseLiveness('historical');
          publish({ query: null, type: 'state', payload: { state: record.state, evidence: { resumedEpoch: record.epoch } } });
        }
        break;
      // An invalidating context destruction: every pause-scoped ref from the destroyed
      // context is gone, so the epoch advances and a stop returns to running.
      case 'Runtime.executionContextDestroyed':
      case 'Runtime.executionContextsCleared':
        if (record.state !== 'exited') {
          apply({ type: 'contextDestroyed' });
          lastPause = lastPause === null ? null : { ...lastPause, liveness: 'historical' };
          publish({
            query: null,
            type: 'state',
            payload: { state: record.state, evidence: { contextDestroyedEpoch: record.epoch } },
          });
        }
        break;
      case 'NodeWorker.attachedToWorker': {
        const info = params.workerInfo ?? {};
        const sessionId = String(params.sessionId ?? '');
        if (sessionId.length > 0) {
          workers.set(sessionId, {
            workerId: String(info.workerId ?? sessionId),
            sessionId,
            type: info.type ?? null,
            title: info.title ?? null,
            url: info.url ?? null,
          });
          publish({
            query: null,
            type: 'state',
            payload: { state: record.state, evidence: { worker: workers.get(sessionId) } },
          });
        }
        break;
      }
      case 'NodeWorker.detachedFromWorker': {
        const sessionId = String(params.sessionId ?? '');
        workers.delete(sessionId);
        publish({
          query: null,
          type: 'state',
          payload: { state: record.state, evidence: { workerDetached: sessionId } },
        });
        break;
      }
      // Runtime.exceptionThrown fires only while not paused; during a pause the
      // exception value is Debugger.paused data. It is retained in the transport frames
      // for the observations owner and changes no state here.
      case 'Runtime.exceptionThrown':
        break;
      default:
        break;
    }
  };

  const requireTransport = () => {
    if (transport === null) throw new SessionRefusal('transportMissing', 'launch establishes the connection');
    if (transport.failure() !== null) throw transport.failure();
    return transport;
  };

  const threadList = () => [
    { thread: 'main:0', workerId: null },
    ...[...workers.values()].map((worker) => ({ thread: `worker:${worker.workerId}`, workerId: worker.workerId })),
  ];

  const liveThreads = () => threadList().map((row) => row.thread);
  const workerSessions = () => [...workers.keys()];

  const refusedRefDecision = (condition, detail) => ({
    decision: 'refused', ok: false, condition, detail: detail === undefined ? null : detail,
  });

  // The recorded stop's liveness: live while a stop is current evidence, historical once
  // a resume or context destruction leaves it, unknown when a rejected resume established
  // no resumption and no fresh stop has arrived.
  const markPauseLiveness = (liveness) => {
    if (lastPause !== null && lastPause.liveness !== liveness) lastPause = { ...lastPause, liveness };
  };

  // Settle the in-flight intent only when one is recorded, so a cleanup path never masks
  // the error it is handling.
  const settlePendingIntent = () => {
    if (record.pending !== null) apply({ type: 'intentSettled' });
  };

  const session = {
    runtime,
    adapter,
    incarnation,

    snapshot() {
      return {
        runtime,
        adapter,
        role: 'adapter',
        incarnation,
        state: record.state,
        epoch: record.epoch,
        mutationGeneration: record.mutationGeneration,
        pending: record.pending === null ? null : { ...record.pending },
        targetLiveness: record.targetLiveness,
        lastPause: lastPause === null ? null : { ...lastPause },
        lastResume: lastResume === null ? null : { ...lastResume },
        releaseSignal,
        emitted: published,
        failure: transport === null ? null : transport.failure(),
        // A non-reversible correlation identity for the connection; the endpoint URL and
        // UUID never leave the transport.
        endpointIdentity: transport === null ? null : transport.endpointIdentity,
        scripts: { count: scripts.count(), urls: scripts.list().map((entry) => entry.url) },
        threads: threadList(),
        workers: [...workers.values()].map((worker) => ({ ...worker })),
        refScope: {
          runtime,
          adapter,
          epoch: record.epoch,
          mutationGeneration: record.mutationGeneration,
        },
      };
    },

    // The native observer reports the discovered endpoint for this runtime.
    markEndpointDiscovered() {
      if (record.state === 'starting') apply({ type: 'endpointDiscovered' });
      return record.state;
    },

    // Explicit target-exit evidence. Only the target observer supplies it.
    childExited({ code = null, signal = null } = {}) {
      apply({ type: 'childExit' });
      publish({ query: null, type: 'state', payload: { state: record.state, evidence: { exit: { code, signal } } } });
      return record.state;
    },

    admit(intent, options = {}) {
      return admitIntent(record, intent, options);
    },

    // The production ref decision. Only an admitted decision lets a caller send. A
    // pause-scoped kind additionally requires a stop whose recorded liveness is live, and
    // every ref must name a live thread, so a detached worker or an invalidated stop is
    // refused here rather than at the backend.
    admitRef(ref) {
      let identity = ref;
      if (typeof ref === 'string') {
        try {
          identity = decodeRefId(ref);
        } catch (error) {
          return refusedRefDecision(error.condition ?? 'refMalformed', error.detail ?? error.message);
        }
      }
      if (PAUSE_SCOPED.includes(identity?.kind)) {
        if (record.state !== 'paused' || lastPause === null) {
          return refusedRefDecision('refOutsidePause', record.state);
        }
        if (lastPause.liveness !== 'live') {
          return refusedRefDecision('refStopNotLive', lastPause.liveness);
        }
      }
      if (typeof identity?.thread === 'string' && !liveThreads().includes(identity.thread)) {
        return refusedRefDecision('refThreadUnknown', identity.thread);
      }
      return admitRef(identity, {
        runtime,
        adapter,
        epoch: record.epoch,
        mutationGeneration: record.mutationGeneration,
      });
    },

    // The observations owner publishes the schema-validated complete result. The
    // adapter's own CDP responses stay internal until that composition supplies one:
    // this lane never claims the canonical result shape.
    publishResult({ query, result }) {
      if (typeof result !== 'object' || result === null || Array.isArray(result)) {
        throw new SessionRefusal('resultShapeMalformed', 'a complete frame carries a result object');
      }
      return publish({ query, type: 'complete', payload: { result } });
    },

    scripts() {
      return scripts;
    },

    // Event subscription over the adapter session. `*` receives every event.
    subscribe(method, handler) {
      return requireTransport().subscribe(method, handler);
    },

    // Every protocol frame, in order, with direction and exact text.
    frames() {
      return transport === null ? [] : transport.frames();
    },

    threads() {
      return threadList();
    },

    // The zero-grant read path: non-effectful requests only.
    async send({ query, method, params = {} }) {
      const admitted = admitReadRequest(record, method);
      if (!admitted.ok) throw new SessionRefusal(admitted.condition, admitted.detail);
      const connection = requireTransport();
      publish({ query, type: 'accepted', payload: { state: record.state } });
      try {
        const result = await connection.send(method, params);
        return { category: admitted.category, method, result };
      } catch (error) {
        const condition = error instanceof TransportRefusal ? error.condition : 'transportError';
        // Publishing the failure frame must not mask the failure it reports: a refused
        // publication is recorded on the original error instead of replacing it.
        try {
          publish({ query, type: 'failed', payload: { error: { condition, detail: error.detail ?? error.message } } });
        } catch (publication) {
          recordPublicationFailure(error, publication);
        }
        if (error instanceof TransportRefusal && error.condition !== 'cdpError') {
          onTransportFailure(error);
        }
        throw error;
      }
    },

    // The grant-gated control path: configuration and session plumbing, never
    // evaluation. `effects` are the caller's declared grants.
    async control({ query, method, params = {}, effects = [] }) {
      const admitted = admitControlRequest(record, method, params, effects, workerSessions());
      if (!admitted.ok) throw new SessionRefusal(admitted.condition, admitted.detail);
      const connection = requireTransport();
      if (method === 'Runtime.runIfWaitingForDebugger' && record.state === 'waitingForStart') {
        apply({ type: 'startReleaseSent' });
      }
      publish({ query, type: 'accepted', payload: { state: record.state } });
      try {
        const result = await connection.send(method, params);
        return { category: admitted.category, method, result };
      } catch (error) {
        const condition = error instanceof TransportRefusal ? error.condition : 'transportError';
        // Publishing the failure frame must not mask the failure it reports: a refused
        // publication is recorded on the original error instead of replacing it.
        try {
          publish({ query, type: 'failed', payload: { error: { condition, detail: error.detail ?? error.message } } });
        } catch (publication) {
          recordPublicationFailure(error, publication);
        }
        if (error instanceof TransportRefusal && error.condition !== 'cdpError') {
          onTransportFailure(error);
        }
        throw error;
      }
    },

    // Observe the current stop. Not paused is an explicit state, never a wait.
    observe() {
      const admitted = admitIntent(record, 'observe', {});
      if (!admitted.ok) throw new SessionRefusal(admitted.condition, admitted.detail);
      if (record.state !== 'paused') return { state: record.state, pause: null };
      return { state: record.state, pause: { ...lastPause } };
    },

    // Wait for one event. `after` is the event index a previous wait returned, so
    // repeated waits see successive events. No timeout converts silence into an
    // outcome: the caller may abort through the signal.
    waitFor(method, { predicate = null, after = 0, signal = null } = {}) {
      const connection = requireTransport();
      const seen = () => {
        const frames = connection.frames();
        for (let index = after; index < frames.length; index += 1) {
          const frame = frames[index];
          if (frame.direction !== 'in' || frame.method !== method) continue;
          const params = JSON.parse(frame.text).params ?? {};
          if (predicate === null || predicate(params)) return { index: index + 1, params };
        }
        return null;
      };
      const already = seen();
      if (already !== null) return Promise.resolve(already);
      return new Promise((resolve, reject) => {
        const unsubscribe = connection.subscribe(method, () => {
          const found = seen();
          if (found === null) return;
          cleanup();
          resolve(found);
        });
        const onAbort = () => {
          cleanup();
          reject(new SessionRefusal('waitAborted', method));
        };
        const cleanup = () => {
          unsubscribe();
          if (signal !== null) signal.removeEventListener('abort', onAbort);
        };
        if (signal !== null) {
          if (signal.aborted) {
            cleanup();
            reject(new SessionRefusal('waitAborted', method));
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
        }
      });
    },

    // Perform one intent. Admission (grant, state, serialization) precedes every send
    // and every effect.
    async execute(intent, params = {}) {
      const effects = params.effects ?? [];
      const admitted = admitIntent(record, intent, {
        effects,
        signal: params.signal ?? null,
        priorSignal: releaseSignal,
      });
      if (!admitted.ok) throw new SessionRefusal(admitted.condition, admitted.detail);

      switch (intent) {
        case 'launch': {
          if (typeof params.webSocketUrl !== 'string' || params.webSocketUrl.length === 0) {
            throw new SessionRefusal('endpointMissing', 'launch needs the discovered endpoint');
          }
          if (typeof params.query !== 'string' || params.query.length === 0) {
            throw new SessionRefusal('publishQueryMissing',
              'launch publishes a request-associated frame: pass the caller request identity');
          }
          // The startup stop positions are generated locations the caller decoded; a
          // condition is refused because it is target JavaScript.
          const stops = startupStopRequests(params.stopAt);
          transport = await connect(params.webSocketUrl, { signal: params.signal ?? null });
          subscriptions.push(transport.subscribeFailure(onTransportFailure));
          subscriptions.push(
            transport.subscribe('Debugger.scriptParsed', handleEvent),
            transport.subscribe('Debugger.paused', handleEvent),
            transport.subscribe('Debugger.resumed', handleEvent),
            transport.subscribe('Runtime.executionContextDestroyed', handleEvent),
            transport.subscribe('Runtime.executionContextsCleared', handleEvent),
            transport.subscribe('Runtime.exceptionThrown', handleEvent),
            transport.subscribe('NodeWorker.attachedToWorker', handleEvent),
            transport.subscribe('NodeWorker.detachedFromWorker', handleEvent),
          );
          if (record.state === 'starting') apply({ type: 'endpointDiscovered' });
          publish({ query: params.query ?? null, type: 'accepted', payload: { state: record.state } });
          try {
            await transport.send('Runtime.enable');
            await transport.send('Debugger.enable');
            // The async-call-stack depth must be set before any async chain forms, or
            // asyncStackTrace stays null for the whole run.
            await transport.send('Debugger.setAsyncCallStackDepth', { maxDepth: 32 });
            for (const stop of stops) await transport.send(stop.method, stop.params);
            if (params.startup !== false) {
              // An observed stop may already have arrived: the stop itself ended the
              // startup wait, so the record is advanced through the event only while it is
              // still waiting for the start release.
              if (record.state === 'waitingForStart') apply({ type: 'startReleaseSent' });
              await transport.send('Runtime.runIfWaitingForDebugger');
            }
          } catch (error) {
            onTransportFailure(error);
            throw error;
          }
          return { state: record.state, stopAt: stops.length };
        }

        case 'observe':
          return session.observe();

        case 'pause': {
          const connection = requireTransport();
          apply({ type: 'intentStarted', intent, query: params.query ?? null });
          const request = requestForIntent(intent, params);
          try {
            await connection.send(request.method, request.params);
          } catch (error) {
            settlePendingIntent();
            throw error;
          }
          settlePendingIntent();
          // A stopped event may have completed this pause before the acknowledgment: that
          // event is the stronger evidence, and the record already says paused, so the
          // acknowledgment does not move a stopped runtime back to pausePending.
          if (record.state === 'running') apply({ type: 'pauseRequested' });
          return { state: record.state };
        }

        case 'resume-step': {
          const connection = requireTransport();
          const request = requestForIntent(intent, params);
          // The invalidating epoch advance happens before the send: a ref admitted against
          // the previous pause refuses from this point. The stop that is being left is no
          // longer live evidence from the moment the resume is written.
          apply({ type: 'resumeSent' });
          markPauseLiveness('historical');
          // The epoch this request advanced to. A later observed event (a stop, a resume or
          // a context destruction) changes it, and that stronger evidence is never
          // overwritten by this request's outcome.
          const requestEpoch = record.epoch;
          apply({ type: 'intentStarted', intent, query: params.query ?? null });
          try {
            await connection.send(request.method, request.params);
          } catch (error) {
            settlePendingIntent();
            const transportFailure = error instanceof TransportRefusal && error.condition !== 'cdpError';
            if (transportFailure) {
              // A lost connection is an adapter failure. It asserts nothing about the
              // target and never reports an exit.
              onTransportFailure(error);
            } else if (record.state === 'running'
              && record.epoch === requestEpoch
              && (lastResume === null || lastResume.epoch !== requestEpoch)) {
              // Nothing observed after this request changed the record, and no resumed event
              // was observed for the epoch this request advanced to, so the rejection is the
              // strongest evidence for this epoch: no resumption was established and the
              // retained stop has no live evidence until a fresh stop arrives.
              apply({ type: 'resumeRejected' });
              markPauseLiveness('unknown');
            }
            // Otherwise a later observation stands — an intervening stop, an observed resume
            // or a context destruction — and only the caller learns of the rejection.
            throw error;
          }
          settlePendingIntent();
          return { state: record.state };
        }

        case 'evaluate': {
          if (typeof params.query !== 'string' || params.query.length === 0) {
            throw new SessionRefusal('publishQueryMissing',
              'evaluate publishes a request-associated frame: pass the caller request identity');
          }
          const connection = requireTransport();
          const request = requestForIntent(intent, params);
          apply({ type: 'evaluationSent', query: params.query ?? null });
          publish({ query: params.query ?? null, type: 'accepted', payload: { state: record.state } });
          try {
            const outcome = await connection.evaluate(request.method, request.params);
            apply({ type: 'evaluationSettled' });
            return {
              state: record.state,
              result: outcome.result,
              exceptionDetails: outcome.exceptionDetails,
              inBandException: outcome.inBandException,
            };
          } catch (error) {
            // A transport failure is an observed adapter failure. The evaluation never
            // responded, so it stays pending until release or owner stop.
            onTransportFailure(error);
            throw error;
          }
        }

        case 'release': {
          if (control === null || typeof control.release !== 'function') {
            throw new SessionRefusal('keeperControlUnavailable', 'release is a native keeper operation');
          }
          // Communicate the committed intent to the native keeper and adopt its reported
          // result. No pid signal, no reap, no CDP wait.
          const keeper = await control.release({
            runtime,
            role: 'target',
            incarnation,
            signal: params.signal,
          });
          releaseSignal = params.signal;
          apply({ type: 'releaseCommitted' });
          publish({
            query: params.query ?? null,
            type: 'state',
            payload: { state: record.state, evidence: { release: keeper } },
          });
          return { state: record.state, keeper };
        }

        default:
          throw new SessionRefusal('intentUnknown', String(intent));
      }
    },

    close() {
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions.length = 0;
      if (transport !== null) transport.close();
    },
  };

  return session;
}

// The exact successor of an admitted counter, exported so a caller composes the same
// increment this lane uses without re-implementing it.
export function nextCounter(text) {
  return counterNext(text);
}
