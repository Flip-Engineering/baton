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
  return {
    stage,
    code: cleanupError?.code ?? null,
    message: asText(cleanupError?.message ?? cleanupError, 'unreadable cleanup failure'),
  };
}

function asText(value, fallback) {
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function readMember(target, key) {
  try {
    return { status: 'read', value: target[key] };
  } catch (error) {
    return { status: 'unreadable', detail: asText(error?.message ?? error, 'unreadable member') };
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
      : `unreadable message: ${message.detail}`,
    code: code.status === 'read' ? (code.value ?? null) : null,
    stack: stack.status === 'read' ? (stack.value ?? null) : null,
    cleanup: cleanup.status === 'read' && Array.isArray(cleanup.value) ? cleanup.value : [],
    cause: cause.status === 'read' && cause.value !== null && cause.value !== undefined
      ? describe(cause.value, seen)
      : null,
  };
}
