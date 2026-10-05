// JSON sample input for schema validation and JSON dataset projections.
//
// A sample is a JSON file: its exact bytes, their SHA-256 and the parsed value
// are separate facts. Addresses are RFC 6901 JSON Pointers, with the empty
// string selecting the document root.

import { readFileSync } from 'node:fs';

import { sha256Hex } from '../catalogs/canonical.mjs';

export function readJsonSample({ path, bytes = null }) {
  const raw = bytes === null ? readFileSync(path) : Buffer.from(bytes);
  const text = raw.toString('utf8');
  if (raw.includes(0)) {
    return { status: 'refused', reason: 'nulByte', detail: 'the sample bytes carry a NUL byte' };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { status: 'refused', reason: 'invalidJson', detail: error.message, sha256: sha256Hex(raw), bytes: raw.length };
  }
  return {
    status: 'ok',
    path,
    bytes: raw.length,
    sha256: sha256Hex(raw),
    value,
    evidence: { kind: 'document', path, sha256: sha256Hex(raw), pointer: '' },
  };
}

function decodeToken(token) {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

export function resolveJsonPointer(value, pointer) {
  if (typeof pointer !== 'string') return { status: 'refused', reason: 'pointerNotString' };
  if (pointer === '') return { status: 'resolved', value, pointer, trace: [] };
  if (!pointer.startsWith('/')) return { status: 'refused', reason: 'pointerNotAbsolute', detail: 'a nonempty JSON Pointer starts with /' };
  const tokens = pointer.slice(1).split('/').map(decodeToken);
  let current = value;
  const trace = [];
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) return { status: 'refused', reason: 'invalidArrayIndex', detail: `token ${JSON.stringify(token)} is not a canonical array index` };
      const index = Number(token);
      if (index >= current.length) return { status: 'refused', reason: 'pointerOutOfRange', detail: `index ${index} is beyond array length ${current.length}` };
      current = current[index];
      trace.push({ kind: 'index', index });
      continue;
    }
    if (current !== null && typeof current === 'object') {
      if (!Object.prototype.hasOwnProperty.call(current, token)) return { status: 'refused', reason: 'pointerAbsent', detail: `no member ${JSON.stringify(token)}` };
      current = current[token];
      trace.push({ kind: 'member', name: token });
      continue;
    }
    return { status: 'refused', reason: 'pointerNotContainer', detail: `token ${JSON.stringify(token)} addresses no container` };
  }
  return { status: 'resolved', value: current, pointer, trace };
}

// The JSON type of a value, as the JSON data model names it.
export function jsonTypeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    default:
      return 'unsupported';
  }
}

// A child pointer for a located member or element, using RFC 6901 escaping.
export function childPointer(pointer, token) {
  const escaped = String(token).replace(/~/g, '~0').replace(/\//g, '~1');
  return pointer === '' ? `/${escaped}` : `${pointer}/${escaped}`;
}

export { sha256Hex };
