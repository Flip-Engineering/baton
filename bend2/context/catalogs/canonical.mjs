// Digests for catalog snapshots and statement plans.
//
// This module makes provider inputs hashable in a fixed order. It is not the
// request canonical form: `bend2/src/json/canonical.bend` owns request
// identity. Catalog digests cover provider rows and never enter request replay.

import { createHash } from 'node:crypto';

const ESCAPES = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' };

function encodeString(value) {
  let out = '"';
  for (const character of value) {
    const escape = ESCAPES[character];
    if (escape !== undefined) {
      out += escape;
    } else {
      const code = character.codePointAt(0);
      out += code < 0x20 ? `\\u${code.toString(16).padStart(4, '0')}` : character;
    }
  }
  return `${out}"`;
}

function encodeNumber(value) {
  if (!Number.isFinite(value)) throw new TypeError('canonical JSON admits finite numbers only');
  if (Number.isInteger(value)) return String(value);
  // Shortest round-tripping spelling; catalog digests admit measured values only.
  return String(value);
}

// Objects serialize with code-unit-sorted keys, arrays keep their order, and
// the output carries no insignificant whitespace.
export function canonicalJson(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return encodeNumber(value);
    case 'string':
      return encodeString(value);
    case 'object':
      break;
    default:
      throw new TypeError(`canonical JSON does not admit ${typeof value}`);
  }
  if (Array.isArray(value)) {
    return `[${value.map(entry => canonicalJson(entry)).join(',')}]`;
  }
  if (value instanceof Uint8Array) throw new TypeError('canonical JSON does not admit raw bytes');
  return `{${Object.keys(value)
    .sort()
    .map(key => `${encodeString(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

export function sha256Hex(input) {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  return createHash('sha256').update(bytes).digest('hex');
}

export function digestJson(value) {
  return sha256Hex(canonicalJson(value));
}
