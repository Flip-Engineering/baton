// The native observer supplies retained target identity and control outcomes.
// One adapter keeps the CDP connection and reference state across query invocations.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createAdapterSession } from './cdp-session.mjs';
import { CdpTransport } from './cdp-transport.mjs';
import { watchTargetStderr } from './cdp-endpoint.mjs';
import { encodeRefId, requireAdmittedRef } from './cdp-refs.mjs';
import { captureException, mapStackFrames } from './observations.mjs';
import { assembleTargetObservation } from './session-observations.mjs';
import { loadSourceMap, mapGeneratedPosition } from './source-maps.mjs';

const OPERATIONS = Object.freeze({ launch: 'runtimeLaunch', observe: 'runtimeObserve',
  pause: 'runtimePause', 'resume-step': 'runtimeResume', evaluate: 'runtimeEvaluate',
  release: 'runtimeRelease' });
const RESULT_SCHEMA = 'baton2.context.runtime.result.v1';

function failure(condition, detail = null) {
  return Object.assign(new Error(condition), { condition, detail });
}

function invocationSubject(value, setup) {
  if (value?.version !== 2 || !value.query || value.owner !== setup.owner) {
    throw failure('runtimeInvocationIdentityMismatch');
  }
  const subject = value.request?.subject;
  const operation = OPERATIONS[subject?.intent];
  if (subject?.kind !== 'runtime' || !operation) throw failure('runtimeIntentUnknown');
  if (value.moduleBinding?.id !== 'runtime' || value.moduleBinding.operation !== operation) {
    throw failure('runtimeOperationMismatch');
  }
  if (subject.intent !== 'launch' && subject.session !== setup.runtime) {
    throw failure('runtimeSessionMismatch');
  }
  return subject;
}

export function createRuntimeProvider({ setup, write }) {
  const bindings = new Map([[setup.invocation.query, setup.invocation.moduleBinding]]);
  let sequence = 0n;
  let endpointWatch = null;
  let pendingRelease = null;
  let exit = null;
  let exitPublished = false;
  let releasing = false;
  const ended = new AbortController();
  const requests = new Map();
  const failures = new Map();
  const emit = (query, type, payload) => {
    const frame = { version: 2, query, owner: setup.owner,
      moduleBinding: bindings.get(query) ?? setup.invocation.moduleBinding,
      runtime: setup.runtime, role: 'adapter', incarnation: setup.incarnation,
      sequence: String(sequence++), type, payload };
    write(frame);
    return frame;
  };
  const session = createAdapterSession({ runtime: setup.runtime, adapter: setup.adapter,
    incarnation: setup.incarnation,
    connect: async (...args) => {
      const transport = await CdpTransport.connect(...args);
      transport.subscribeFailure((error) => ended.abort(error));
      return transport;
    },
    emit: ({ frame, bytes, replay }) => {
      if (frame.type === 'complete') return;
      if (frame.type === 'failed') {
        const evidence = failures.get(frame.query) ?? [];
        evidence.push({ version: 1, bytes, replay });
        failures.set(frame.query, evidence);
        return;
      }
      emit(frame.query, frame.type, { ...frame.payload,
        adapterEvidence: { version: 1, bytes, replay } });
    },
    control: { release: ({ signal }) => new Promise((resolve, reject) => {
      if (pendingRelease !== null) {
        reject(failure('runtimeReleasePending'));
        return;
      }
      pendingRelease = { query: setup.releaseQuery, resolve, reject };
      write({ type: 'keeperRelease', query: setup.releaseQuery, runtime: setup.runtime,
        incarnation: setup.incarnation, signal });
    }) },
  });

  function reference(kind, handle, thread = 'main:0') {
    const snapshot = session.snapshot();
    return encodeRefId({ runtime: setup.runtime, adapter: setup.adapter, thread,
      epoch: snapshot.epoch, mutationGeneration: snapshot.mutationGeneration,
      kind, handle });
  }

  function publishExit() {
    if (exit === null || exitPublished || releasing) return;
    session.childExited(exit);
    exitPublished = true;
    ended.abort(failure('runtimeTargetExited', exit));
  }

  function admittedHandle(ref, kind) {
    const identity = requireAdmittedRef(session.admitRef(ref));
    if (identity.kind !== kind) throw failure('runtimeReferenceKindMismatch', kind);
    return identity;
  }

  function pausedParameters() {
    const frames = session.frames();
    for (let index = frames.length - 1; index >= 0; index--) {
      const frame = frames[index];
      if (frame.direction === 'in' && frame.method === 'Debugger.paused') {
        return JSON.parse(frame.text).params;
      }
    }
    return null;
  }

  async function observe(invocation, subject) {
    const observation = session.observe();
    const snapshot = session.snapshot();
    const result = { state: observation.state, pause: observation.pause,
      epoch: snapshot.epoch, mutationGeneration: snapshot.mutationGeneration,
      threads: session.threads().map((row) => ({ ...row,
        ref: reference('thread', row.thread, row.thread) })) };
    const select = invocation.request.select ?? [];
    if (observation.state !== 'paused') {
      if (select.includes('exception')) {
        const recorded = session.frames().findLast((frame) =>
          frame.direction === 'in' && frame.method === 'Runtime.exceptionThrown');
        result.exception = captureException({ paused: false,
          exceptionThrownEvent: recorded ? JSON.parse(recorded.text).params : null });
        result.exceptionEvent = recorded ?? null;
      }
      return result;
    }
    const paused = pausedParameters();
    const thread = observation.pause.thread;
    if (subject.thread !== undefined) admittedHandle(subject.thread, 'thread');
    const frames = paused?.callFrames ?? [];
    const selected = subject.frame === undefined ? frames[0]
      : frames.find((frame) => frame.callFrameId === admittedHandle(subject.frame, 'frame').handle);
    if (subject.frame !== undefined && selected === undefined) throw failure('runtimeFrameUnavailable');
    if (select.includes('frames')) {
      const maps = new Map();
      const resolveOriginal = (scriptId, line, column) => {
        const script = session.scripts().get(scriptId);
        if (script === null) return { condition: 'unknownScript' };
        let loaded = maps.get(scriptId);
        if (loaded === undefined) {
          const generatedPath = script.url.startsWith('file://') ? fileURLToPath(script.url)
            : isAbsolute(script.url) ? script.url : null;
          loaded = loadSourceMap({ sourceMapURL: script.sourceMapURL, generatedPath });
          maps.set(scriptId, loaded);
        }
        if (loaded.condition) return { condition: loaded.condition, detail: loaded.detail ?? null };
        return mapGeneratedPosition(loaded.map, { line, column },
          { mapPath: loaded.path ?? null, generatedPath: script.url || null });
      };
      const mapped = mapStackFrames({ callFrames: frames, asyncStackTrace: paused?.asyncStackTrace,
        asyncCaptureEnabled: true, thread, resolveOriginal });
      result.frames = mapped.frames.map((frame) => ({ ...frame,
        ref: reference('frame', frame.callFrameId, thread) }));
      result.async = mapped.async;
    }
    if (select.includes('exception')) result.exception = captureException({ paused: true, pausedData: paused?.data });
    let scopes = selected?.scopeChain ?? [];
    let ref = selected ? reference('frame', selected.callFrameId, thread) : null;
    if (subject.object !== undefined) {
      const identity = admittedHandle(subject.object, 'object');
      ref = subject.object;
      scopes = [{ type: 'object', object: { type: 'object', objectId: identity.handle } }];
    }
    if (ref !== null && (subject.object !== undefined || select.includes('scopes') || select.includes('values'))) {
      const observedRecords = new Map();
      const captured = await assembleTargetObservation({ session, ref, scopes,
        signal: ended.signal,
        loadScope: async (scope, { binding: captureBinding }) => {
          const admitted = captureBinding.sample();
          if (!admitted.admitted) throw failure(admitted.condition, admitted.detail);
          const objectRef = reference('object', scope.object.objectId, thread);
          const object = admittedHandle(objectRef, 'object');
          const response = (await session.send({ query: invocation.query, method: 'Runtime.getProperties',
            params: { objectId: object.handle, ownProperties: true, accessorPropertiesOnly: false,
              generatePreview: true } })).result;
          observedRecords.set(scope, response);
          return response;
        } });
      result.capture = captured.capture ?? null;
      result.identity = captured.identity ?? null;
      result.scopes = captured.scopes ?? [];
      if (captured.status === 'observed') {
        for (const scope of result.scopes) {
          const exposeRef = (value) => {
            if (typeof value?.objectId === 'string') value.ref = encodeRefId({ ...captured.identity,
              kind: 'object', handle: value.objectId });
          };
          exposeRef(scope.object);
          for (const property of scope.properties) {
            exposeRef(property.value); exposeRef(property.get); exposeRef(property.set); exposeRef(property.symbol);
          }
          for (const property of scope.internalProperties) exposeRef(property.value);
        }
      }
      result.records = [...observedRecords].map(([scope, response]) => ({ scope, response }));
      if (captured.status !== 'observed') {
        result.refusal = { condition: captured.condition, detail: captured.detail ?? null,
          stage: captured.stage ?? null, rawRecord: captured.rawRecord ?? null };
      }
    }
    return result;
  }

  function discoverEndpoint() {
    return new Promise((resolve, reject) => {
      if (ended.signal.aborted) { reject(ended.signal.reason); return; }
      const onAbort = () => { endpointWatch?.stop(); reject(ended.signal.reason); };
      ended.signal.addEventListener('abort', onAbort, { once: true });
      endpointWatch = watchTargetStderr({ path: setup.stderrPath,
        onEndpoint(endpoint) { ended.signal.removeEventListener('abort', onAbort); resolve(endpoint.url); },
        onFailure(error) { ended.signal.removeEventListener('abort', onAbort); reject(error); } });
    });
  }

  async function execute(invocation) {
    const subject = invocationSubject(invocation, setup);
    bindings.set(invocation.query, invocation.moduleBinding);
    const effects = invocation.request.effects ?? [];
    let result;
    if (subject.intent === 'launch') {
      const webSocketUrl = await discoverEndpoint();
      session.markEndpointDiscovered();
      result = await session.execute('launch', { query: invocation.query, webSocketUrl, effects,
        stopAt: subject.stopAt, startup: false, signal: ended.signal });
      if (subject.stopOnException !== undefined) {
        await session.control({ query: invocation.query, method: 'Debugger.setPauseOnExceptions',
          params: { state: subject.stopOnException }, effects });
      }
      await session.control({ query: invocation.query, method: 'Runtime.runIfWaitingForDebugger', effects });
      result = { ...result, state: session.snapshot().state };
      endpointWatch?.stop();
    } else if (subject.intent === 'observe') {
      result = await observe(invocation, subject);
    } else if (subject.intent === 'release') {
      if (exit !== null) return emit(invocation.query, 'event',
        { schema: RESULT_SCHEMA, intent: subject.intent, runtime: setup.runtime,
          state: session.snapshot().state, exit });
      setup.releaseQuery = invocation.query;
      releasing = true;
      try {
        result = await session.execute('release', { query: invocation.query, effects, signal: subject.signal });
        if (Object.hasOwn(result.keeper ?? {}, 'code')) {
          exit = { code: result.keeper.code, signal: result.keeper.signal ?? null };
        }
      } finally {
        releasing = false;
        publishExit();
      }
      result = { ...result, exit };
    } else {
      const params = { query: invocation.query, effects, action: subject.action,
        expression: subject.expression };
      if (subject.thread !== undefined) admittedHandle(subject.thread, 'thread');
      if (subject.frame !== undefined) params.frame = admittedHandle(subject.frame, 'frame').handle;
      const cursor = session.frames().length;
      result = await session.execute(subject.intent, params);
      if (subject.intent === 'pause') {
        const stopped = await session.waitFor('Debugger.paused', { after: cursor, signal: ended.signal });
        result = { ...result, state: session.snapshot().state, stopped };
      }
    }
    if (result.identity !== null && result.identity !== undefined) {
      try { requireAdmittedRef(session.admitRef(result.identity)); }
      catch (error) { result.refusal = { condition: 'changedDuringCapture', stage: 'publication',
        refusal: { condition: error.condition, detail: error.detail } }; }
    }
    const payload = { schema: RESULT_SCHEMA, intent: subject.intent, runtime: setup.runtime,
      state: session.snapshot().state, ...result };
    if (failures.has(invocation.query)) payload.adapterEvidence = failures.get(invocation.query);
    return emit(invocation.query, 'event', payload);
  }

  return {
    executeInvocation: execute,
    accept(message) {
      if (message.type === 'targetExited') {
        exit = { code: message.code ?? null, signal: message.signal ?? null };
        publishExit();
        return;
      }
      if (message.type === 'keeperReleased') {
        if (pendingRelease === null || message.query !== pendingRelease.query) {
          throw failure('runtimeReleaseResponseMismatch');
        }
        const pending = pendingRelease;
        pendingRelease = null;
        if (message.error) pending.reject(failure(message.error.condition, message.error.detail));
        else pending.resolve(message.result);
        return;
      }
      if (requests.has(message.query)) throw failure('runtimeQueryPending', message.query);
      const work = execute(message).catch((error) => emit(message.query ?? null, 'failed',
        { error: { condition: error.condition ?? 'runtimeProviderFailed', detail: error.detail ?? error.message },
          adapterEvidence: failures.get(message.query) ?? [] }))
        .finally(() => { requests.delete(message.query); failures.delete(message.query); });
      requests.set(message.query, work);
    },
    close(reason = failure('runtimeObserverClosed')) {
      ended.abort(reason);
      endpointWatch?.stop();
      if (pendingRelease !== null) pendingRelease.reject(reason);
      session.close();
    },
  };
}

export async function executeInvocation(invocation, { runtimeProvider } = {}) {
  if (!runtimeProvider) return { status: 'refused', reason: 'runtimeObserverUnavailable' };
  return runtimeProvider.executeInvocation(invocation);
}

export async function runRuntimeAdapter({ setup, input = process.stdin, output = process.stdout }) {
  const provider = createRuntimeProvider({ setup, write: (value) => output.write(`${JSON.stringify(value)}\n`) });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    provider.accept(setup.invocation);
    for await (const line of lines) provider.accept(JSON.parse(line));
  } finally {
    provider.close();
    lines.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--runtime-adapter-file') {
    await runRuntimeAdapter({ setup: JSON.parse(readFileSync(process.argv[3], 'utf8')) });
  }
}
