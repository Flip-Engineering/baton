// Read the generic project policy through the retained owner-worktree custody reader.
import { createRetainedWorktreeCapture } from './context-worktree-capture.mjs';

const POLICY_RELATIVE_PATH = '.baton/context.json';

function refusal(reason, detail = null) {
  return Object.freeze({ status: 'refused', reason, detail });
}

function hasDuplicateObjectKeys(text) {
  const stack = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') {
      stack.push({ object: true, keys: new Set(), expectKey: true });
    } else if (char === '[') {
      stack.push({ object: false });
    } else if (char === '}' || char === ']') {
      stack.pop();
    } else if (char === ',' && stack.at(-1)?.object) {
      stack.at(-1).expectKey = true;
    } else if (char === '"') {
      const start = index;
      index += 1;
      while (index < text.length) {
        if (text[index] === '\\') index += 2;
        else if (text[index] === '"') break;
        else index += 1;
      }
      const parent = stack.at(-1);
      if (parent?.object && parent.expectKey) {
        const key = JSON.parse(text.slice(start, index + 1));
        if (parent.keys.has(key)) return true;
        parent.keys.add(key);
        parent.expectKey = false;
      }
    }
  }
  return false;
}

export function decodePolicy(bytes) {
  let value;
  try {
    value = JSON.parse(bytes);
  } catch (error) {
    return refusal('projectPolicyMalformed', error.message);
  }
  if (hasDuplicateObjectKeys(bytes) || value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('\0') !== ['disabled', 'preferred', 'schema'].join('\0')
      || value.schema !== 'baton2-context-project-v1'
      || !Array.isArray(value.disabled) || !Array.isArray(value.preferred)) {
    return refusal('projectPolicyMalformed');
  }
  for (const entries of [value.disabled, value.preferred]) {
    if (entries.some((entry) => typeof entry !== 'string' || entry.length === 0)
        || new Set(entries).size !== entries.length) return refusal('projectPolicyMalformed');
  }
  return Object.freeze({ status: 'decoded', disabled: Object.freeze(value.disabled),
    preferred: Object.freeze(value.preferred) });
}

export function observeProjectPolicy({ owner, worktree } = {}) {
  if (typeof owner !== 'string' || owner.length === 0
      || typeof worktree !== 'string' || worktree.length === 0) {
    return refusal('projectPolicyAuthorityMissing');
  }
  const retained = createRetainedWorktreeCapture({ owner, worktree });
  if (retained.status !== 'ready') return refusal(retained.reason, retained.detail);

  const reader = retained.capture.forOwner(owner);
  const requested = `${retained.roots[0].path}/${POLICY_RELATIVE_PATH}`;
  const resolved = reader.resolve(requested);
  if (resolved.status !== 'resolved') {
    retained.capture.seal(owner);
    return refusal('projectPolicyPathUnavailable', resolved.reason ?? null);
  }
  if (resolved.exists !== true) {
    const sealed = retained.capture.seal(owner);
    if (sealed.status !== 'sealed') return refusal('projectPolicyCaptureFailed', sealed.reason ?? null);
    return Object.freeze({ status: 'absent', owner, worktree: retained.roots[0].path,
      path: resolved.identity, marker: 'absent', disabled: Object.freeze([]),
      preferred: Object.freeze([]), retainedReadSet: sealed });
  }

  const captured = reader.read(resolved.identity);
  if (captured.status !== 'captured') {
    retained.capture.seal(owner);
    return refusal('projectPolicyReadFailed', captured.reason ?? null);
  }
  let bytes;
  try {
    bytes = new TextDecoder('utf-8', { fatal: true }).decode(captured.bytes);
  } catch (error) {
    retained.capture.seal(owner);
    return refusal('projectPolicyEncodingInvalid', error.message);
  }
  const sealed = retained.capture.seal(owner);
  if (sealed.status !== 'sealed') return refusal('projectPolicyCaptureFailed', sealed.reason ?? null);
  const policy = decodePolicy(bytes);
  if (policy.status !== 'decoded') return policy;
  return Object.freeze({ status: 'present', owner, worktree: retained.roots[0].path,
    path: captured.identity, sha256: captured.sha256, bytes,
    disabled: policy.disabled, preferred: policy.preferred, retainedReadSet: sealed });
}
