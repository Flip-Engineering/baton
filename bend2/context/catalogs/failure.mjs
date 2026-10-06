// Bounded failure representation shared by the catalog providers.
//
// Cleanup evidence must survive two hostile shapes: an original failure that
// cannot carry it (a frozen object, a non-writable `cleanup` member) and a
// primitive thrown value. Attaching diagnostics must therefore never throw, and
// every cleanup action must run before any attachment is attempted.
//
// The common and public result formats stay with the codec; this module only
// describes a failure for a retained internal channel.

export function cleanupDiagnostic(stage, cleanupError) {
  return {
    stage,
    code: cleanupError?.code ?? null,
    message: String(cleanupError?.message ?? cleanupError),
  };
}

function wrappedFailure(original, diagnostics) {
  const text = original !== null && typeof original === 'object'
    ? String(original.message ?? original)
    : `non-error throw: ${String(original)}`;
  const wrapper = new Error(text);
  wrapper.cause = original;
  try {
    wrapper.cleanup = diagnostics;
  } catch {
    // A wrapper that cannot carry the evidence still retains the original.
  }
  return wrapper;
}

// Returns the error to throw. An extensible object error receives the diagnostics
// as a `cleanup` member; anything else is wrapped with the original kept as the
// cause. Attachment never throws and never discards the diagnostics.
export function attachDiagnostics(error, diagnostics) {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) return error;
  if (error !== null && typeof error === 'object') {
    const existing = Array.isArray(error.cleanup) ? error.cleanup : [];
    try {
      Object.defineProperty(error, 'cleanup', {
        value: [...existing, ...diagnostics],
        writable: true,
        enumerable: true,
        configurable: true,
      });
      return error;
    } catch {
      return wrappedFailure(error, diagnostics);
    }
  }
  return wrappedFailure(error, diagnostics);
}

export function attachCleanup(error, stage, cleanupError) {
  return attachDiagnostics(error, [cleanupDiagnostic(stage, cleanupError)]);
}

// A retained internal description of a failure: the original provider message and
// code, the cleanup evidence, and the original value when the thrown value was
// not an error object. No field is truncated and no diagnostic is dropped.
export function describeFailure(error) {
  const isObject = error !== null && typeof error === 'object';
  return {
    kind: isObject ? (error.name ?? 'Error') : 'non-error-throw',
    message: isObject ? String(error.message ?? error) : String(error),
    code: isObject ? (error.code ?? null) : null,
    stack: isObject ? (error.stack ?? null) : null,
    cleanup: isObject && Array.isArray(error.cleanup) ? error.cleanup : [],
    cause: isObject && 'cause' in error && error.cause !== undefined
      ? describeFailure(error.cause)
      : null,
  };
}
