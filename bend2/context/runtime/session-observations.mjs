import { requireAdmittedRef } from './cdp-refs.mjs';
import { captureIdentity, captureScopes, createCaptureBinding } from './observations.mjs';

function abortFailure(signal) {
  const error = new Error('scope capture cancelled', { cause: signal.reason });
  error.condition = 'captureAborted';
  error.detail = signal.reason;
  return error;
}

// The pending read keeps its rejection handler after caller cancellation.
// Backend cancellation remains with loadScope and its transport.
function readScope(loadScope, scope, binding, signal) {
  if (signal?.aborted) return Promise.reject(abortFailure(signal));
  if (!signal) return Promise.resolve(loadScope(scope, { binding, signal }));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(abortFailure(signal));
    };
    const settle = (callback, value) => {
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) reject(abortFailure(signal));
      else callback(value);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      Promise.resolve(loadScope(scope, { binding, signal })).then(
        (record) => settle(resolve, record),
        (error) => settle(reject, error),
      );
    } catch (error) {
      settle(reject, error);
    }
  });
}

function refused(error) {
  return {
    status: 'refused',
    condition: error?.condition ?? 'scopeReadFailed',
    detail: error?.detail ?? error?.message ?? String(error),
    cause: error,
  };
}

// loadScope returns the CDP getProperties result. It samples binding immediately
// before each session.send and owns the request query and transport effects.
// The consumer encodes the returned Map and publishes the selected result.
export async function assembleTargetObservation({ session, ref, scopes, loadScope, signal = null }) {
  if (signal?.aborted) return refused(abortFailure(signal));
  const binding = createCaptureBinding({
    admitRef: (candidate) => session.admitRef(candidate),
    ref,
    liveNow: () => session.snapshot(),
    requireAdmittedRef,
  });
  const admitted = binding.sample();
  if (!admitted.admitted) return { ...admitted, status: 'refused' };
  const identity = admitted.identity;
  const startEvent = { index: session.frames().length };
  let captured;
  try {
    captured = await captureScopes({
      scopeChain: scopes,
      identity,
      binding,
      loadScope: typeof loadScope === 'function'
        ? (scope) => readScope(loadScope, scope, binding, signal)
        : loadScope,
    });
  } catch (error) {
    return refused(error);
  }
  if (signal?.aborted) return refused(abortFailure(signal));
  const capture = captureIdentity({
    startEvent,
    endEvent: { index: session.frames().length },
    epoch: identity.epoch,
  });
  if (captured.condition !== undefined) {
    return {
      ...captured,
      status: 'refused',
      detail: captured.refusal?.detail ?? null,
      identity,
      capture,
    };
  }
  // Sample after the awaited capture resumes in this caller's continuation.
  const atReturn = binding.sample();
  if (!atReturn.admitted) {
    return {
      status: 'refused',
      condition: 'changedDuringCapture',
      detail: atReturn.detail,
      refusal: atReturn,
      stage: 'publication',
      scopes: captured.scopes,
      identity,
      capture,
    };
  }
  return { status: 'observed', ...captured, identity, capture };
}
