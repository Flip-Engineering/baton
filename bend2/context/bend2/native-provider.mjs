// Selected Bend2 provider boundary for the frozen context invocation protocol.
// This package currently reports its missing frontend invocation hook as an
// explicit event. It does not turn the internal frontend runner into a result.
import { pathToFileURL } from 'node:url';

const INVOCATION_KEYS = Object.freeze([
  'version', 'query', 'owner', 'moduleBinding', 'request',
  'inputIdentities', 'operationPlan', 'role', 'incarnation',
]);

function exactKeys(value, expected) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index]);
}

function optionalText(value) {
  return value === null || typeof value === 'string';
}

export function validateInvocation(value) {
  if (!exactKeys(value, INVOCATION_KEYS)) return { status: 'refused', reason: 'invocationShape' };
  if (value.version !== 2) return { status: 'refused', reason: 'invocationVersion' };
  if (!optionalText(value.query) || !optionalText(value.owner)
      || !optionalText(value.role) || !optionalText(value.incarnation)) {
    return { status: 'refused', reason: 'invocationIdentityKind' };
  }
  if (value.moduleBinding === null || typeof value.moduleBinding !== 'object' || Array.isArray(value.moduleBinding)) {
    return { status: 'refused', reason: 'moduleBindingKind' };
  }
  if (value.request === null || typeof value.request !== 'object' || Array.isArray(value.request)) {
    return { status: 'refused', reason: 'requestKind' };
  }
  if (!Array.isArray(value.inputIdentities) || !Array.isArray(value.operationPlan)) {
    return { status: 'refused', reason: 'invocationArrayKind' };
  }
  return { status: 'accepted', invocation: value };
}

export function unavailableEvent(invocation) {
  const validation = validateInvocation(invocation);
  if (validation.status !== 'accepted') return validation;
  const frame = validation.invocation;
  return {
    version: 2,
    query: frame.query,
    owner: frame.owner,
    moduleBinding: frame.moduleBinding,
    runtime: null,
    role: frame.role,
    incarnation: frame.incarnation,
    sequence: '1',
    type: 'event',
    payload: { status: 'unavailable', reason: 'selectedFrontendInvocationUnavailable' },
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let response;
  try {
    response = unavailableEvent(JSON.parse(input));
  } catch {
    response = { status: 'refused', reason: 'invocationJsonInvalid' };
  }
  process.stdout.write(JSON.stringify(response) + '\n');
}
