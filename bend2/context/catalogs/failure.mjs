// Bounded failure representation shared by the catalog providers.
//
// Cleanup evidence must survive hostile shapes: an original failure that cannot
// carry it (a frozen object, a non-writable or throwing `cleanup` member), a
// primitive thrown value, and a cause chain that is cyclic or whose members
// throw when read. Every read in this module is guarded, so describing or
// attaching a failure can neither skip a physical cleanup step nor mask the
// original cause.
//
// Documented scope: the guarantees cover defensive reads of ordinary objects and
// proxies whose traps throw. A failure that prevents the host from constructing
// an Error at all, or from calling any of the functions below, is outside them.
//
// The common and public result formats stay with the codec; this module only
// describes a failure for a retained internal channel.

export function cleanupDiagnostic(stage, cleanupError) {
  const code = readMember(cleanupError, 'code');
  const message = readMember(cleanupError, 'message');
  // An unreadable member reports the fixed text; a readable but missing message
  // falls back to the thrown value itself, which is what a primitive failure
  // carries.
  let text;
  if (message.status === 'unreadable') {
    text = 'unreadable message';
  } else if (message.value !== null && message.value !== undefined) {
    text = asText(message.value, 'unreadable message');
  } else {
    text = asText(cleanupError, 'unreadable cleanup failure');
  }
  return {
    stage,
    code: code.status === 'read' ? (code.value ?? null) : null,
    message: text,
  };
}

// Formats raw cleanup outcomes once every physical release has been attempted.
// Keeping formatting separate from the release attempts means an unreadable
// failure object cannot stop a later close.
export function formatCleanupOutcomes(outcomes) {
  return (Array.isArray(outcomes) ? outcomes : []).map(outcome => cleanupDiagnostic(outcome.stage, outcome.cleanupError));
}

function asText(value, fallback) {
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

// A guarded member read. The catch performs no property read on the thrown
// value, so a getter that throws another object with its own throwing members
// cannot escape this function.
function readMember(target, key) {
  try {
    return { status: 'read', value: target[key] };
  } catch {
    return { status: 'unreadable' };
  }
}

function wrappedFailure(original, diagnostics) {
  const message = original !== null && typeof original === 'object'
    ? asText(readMember(original, 'message').value ?? original, 'failure without a readable message')
    : `non-error throw: ${asText(original, 'unreadable value')}`;
  let wrapper;
  try {
    wrapper = new Error(message);
  } catch {
    wrapper = null;
  }
  if (wrapper === null) {
    // Constructing the wrapper failed; the diagnostics still travel with a plain
    // record so the caller keeps them.
    return { cleanup: diagnostics, cause: original, message };
  }
  try {
    wrapper.cause = original;
  } catch {
    // The cause is optional evidence.
  }
  try {
    wrapper.cleanup = diagnostics;
  } catch {
    // A wrapper that cannot carry them still retains the original.
  }
  return wrapper;
}

// Returns the error to throw. An extensible object error receives the diagnostics
// as a `cleanup` member; anything else is wrapped with the original kept as the
// cause. Attachment never throws and never discards the diagnostics, and it reads
// the existing member defensively so a throwing getter cannot skip cleanup.
export function attachDiagnostics(error, diagnostics) {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) return error;
  if (error !== null && typeof error === 'object') {
    const existing = readMember(error, 'cleanup');
    const merged = [
      ...(existing.status === 'read' && Array.isArray(existing.value) ? existing.value : []),
      ...diagnostics,
    ];
    try {
      Object.defineProperty(error, 'cleanup', {
        value: merged,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      return error;
    } catch {
      return wrappedFailure(error, merged);
    }
  }
  return wrappedFailure(error, diagnostics);
}

// A retained internal description of a failure: the original provider message and
// code, the cleanup evidence, and the original value when the thrown value was
// not an error object. No field is truncated, an unreadable member is reported as
// such, and a cyclic cause chain is cut rather than followed.
export function describeFailure(error) {
  return describe(error, new WeakSet());
}

function describe(error, seen) {
  const isObject = error !== null && typeof error === 'object';
  if (!isObject) {
    return {
      kind: 'non-error-throw',
      message: asText(error, 'unreadable value'),
      code: null,
      stack: null,
      cleanup: [],
      cause: null,
    };
  }
  if (seen.has(error)) {
    return { kind: 'cycle', message: 'cause cycle', code: null, stack: null, cleanup: [], cause: null };
  }
  seen.add(error);
  const name = readMember(error, 'name');
  const message = readMember(error, 'message');
  const code = readMember(error, 'code');
  const stack = readMember(error, 'stack');
  const cleanup = readMember(error, 'cleanup');
  const cause = readMember(error, 'cause');
  return {
    kind: name.status === 'read' && name.value !== null && name.value !== undefined ? asText(name.value, 'Error') : 'Error',
    message: message.status === 'read'
      ? asText(message.value ?? '', 'unreadable message')
      : 'unreadable message',
    code: code.status === 'read' ? (code.value ?? null) : null,
    stack: stack.status === 'read' ? (stack.value ?? null) : null,
    cleanup: cleanup.status === 'read' && Array.isArray(cleanup.value) ? cleanup.value : [],
    cause: cause.status === 'read' && cause.value !== null && cause.value !== undefined
      ? describe(cause.value, seen)
      : null,
  };
}
