import { createHash } from 'node:crypto';
import { TextDecoder, types as utilTypes } from 'node:util';

const AUTHORITY_FIELDS = Object.freeze([
  'maxJoinMembers', 'maxProgramBytes', 'maxProgramDepth', 'maxProgramNodes',
  'maxSchemaDefinitions', 'maxValueBytes',
]);
const authorities = new WeakSet();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export class ProgramIrError extends TypeError {
  constructor(message, code = 'program_invalid') {
    super(message);
    this.name = 'ProgramIrError';
    this.code = code;
  }
}

function fail(message, code = 'program_invalid') {
  throw new ProgramIrError(message, code);
}

function ownDataObject(value, fields, label) {
  if (utilTypes.isProxy(value)) fail(`${label} cannot be a Proxy`);
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    fail(`${label} must be a plain object`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')
    || keys.length !== fields.length || fields.some((field) => !keys.includes(field))) {
    fail(`${label} has an invalid field set`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) => !('value' in descriptor) || !descriptor.enumerable)) {
    fail(`${label} must contain only enumerable data properties`);
  }
}

export function createProgramValueAuthority(value) {
  ownDataObject(value, AUTHORITY_FIELDS, 'Program value authority');
  const result = {};
  for (const field of AUTHORITY_FIELDS) {
    if (!Number.isSafeInteger(value[field]) || value[field] <= 0) {
      fail(`Program value authority ${field} is invalid`, 'program_policy_invalid');
    }
    result[field] = value[field];
  }
  Object.freeze(result);
  authorities.add(result);
  return result;
}

export function isProgramValueAuthority(value) {
  return Boolean(value && typeof value === 'object' && authorities.has(value));
}

function requireAuthority(value) {
  if (!isProgramValueAuthority(value)) {
    fail('Program value authority must be deployment-injected', 'program_policy_invalid');
  }
  return value;
}

// Relational string comparison is defined over unsigned UTF-16 code units. This deliberately
// belongs to the Program identity domain and does not alter the historical canonical-order module.
export function compareProgramIdentityKeys(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') {
    fail('Program identity keys must be strings');
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}

export function normalizeProgramString(value, label = 'Program string') {
  if (typeof value !== 'string' || hasLoneSurrogate(value)) {
    fail(`${label} contains invalid Unicode`);
  }
  return value.normalize('NFC');
}

function denseArrayDescriptors(value, label) {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    fail(`${label} has a custom prototype`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) fail(`${label} is decorated`);
  const expected = new Set(['length']);
  for (let index = 0; index < value.length; index += 1) expected.add(String(index));
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
    fail(`${label} must be dense and undecorated`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
      fail(`${label} must contain only enumerable data elements`);
    }
  }
}

function plainObjectDescriptors(value, label) {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${label} has a custom prototype`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) fail(`${label} contains a symbol key`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!('value' in descriptor) || !descriptor.enumerable) {
      fail(`${label}.${key} must be an enumerable data property`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(descriptors, 'toJSON')) {
    fail(`${label} cannot define toJSON`);
  }
  return Object.keys(descriptors);
}

function normalizeChecked(value, authority, byteLimit) {
  const active = new Set();
  let nodes = 0;
  const visit = (item, depth, label) => {
    nodes += 1;
    if (nodes > authority.maxProgramNodes) fail('Program canonical value exceeds its node authority');
    if (depth > authority.maxProgramDepth) fail('Program canonical value exceeds its depth authority');
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'string') return normalizeProgramString(item, label);
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail(`${label} must be finite`);
      return Object.is(item, -0) ? 0 : item;
    }
    if (typeof item !== 'object' || item === null) fail(`${label} is not JSON data`);
    if (utilTypes.isProxy(item)) fail(`${label} cannot be a Proxy`);
    if (active.has(item)) fail('Program canonical value cannot contain cycles');
    active.add(item);
    try {
      if (Array.isArray(item)) {
        denseArrayDescriptors(item, label);
        return item.map((child, index) => visit(child, depth + 1, `${label}[${index}]`));
      }
      const rawKeys = plainObjectDescriptors(item, label);
      const normalizedKeys = new Map();
      for (const rawKey of rawKeys) {
        const key = normalizeProgramString(rawKey, `${label} key`);
        if (normalizedKeys.has(key)) fail(`${label} contains an NFC key collision`);
        normalizedKeys.set(key, rawKey);
      }
      const result = {};
      for (const key of [...normalizedKeys.keys()].sort(compareProgramIdentityKeys)) {
        Object.defineProperty(result, key, {
          value: visit(item[normalizedKeys.get(key)], depth + 1, `${label}.${key}`),
          enumerable: true, configurable: true, writable: true,
        });
      }
      return result;
    } finally {
      active.delete(item);
    }
  };
  const normalized = visit(value, 0, 'Program canonical value');
  const bytes = Buffer.from(serializeCanonical(normalized), 'utf8');
  if (bytes.byteLength > byteLimit) fail('Program canonical value exceeds its byte authority');
  return { normalized, bytes };
}

function serializeCanonical(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(serializeCanonical).join(',')}]`;
  return `{${Object.keys(value).sort(compareProgramIdentityKeys)
    .map((key) => `${JSON.stringify(key)}:${serializeCanonical(value[key])}`).join(',')}}`;
}

export function deepFreezeProgramValue(value) {
  if (!value || typeof value !== 'object') return value;
  if (utilTypes.isProxy(value)) fail('Program value cannot be a Proxy');
  if (Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreezeProgramValue(child);
  return Object.freeze(value);
}

export function normalizeCanonicalValue(value, authority) {
  const checked = normalizeChecked(value, requireAuthority(authority), authority.maxValueBytes);
  return deepFreezeProgramValue(checked.normalized);
}

export function normalizeCanonicalProgramValue(value, authority) {
  const checked = normalizeChecked(value, requireAuthority(authority), authority.maxProgramBytes);
  return deepFreezeProgramValue(checked.normalized);
}

export function canonicalValueBytes(value, authority) {
  const checked = normalizeChecked(value, requireAuthority(authority), authority.maxValueBytes);
  return Buffer.from(checked.bytes);
}

export function canonicalValueText(value, authority) {
  return canonicalValueBytes(value, authority).toString('utf8');
}

export function canonicalValueDigest(value, authority) {
  return createHash('sha256').update(canonicalValueBytes(value, authority)).digest('hex');
}

export function canonicalProgramBytes(value, authority) {
  const checked = normalizeChecked(value, requireAuthority(authority), authority.maxProgramBytes);
  return Buffer.from(checked.bytes);
}

export function canonicalProgramDigest(value, authority) {
  return createHash('sha256').update(canonicalProgramBytes(value, authority)).digest('hex');
}

function rawText(raw, authority) {
  if (utilTypes.isProxy(raw)) fail('Raw Program JSON cannot be a Proxy');
  let bytes;
  if (typeof raw === 'string') bytes = Buffer.from(raw, 'utf8');
  else if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) bytes = Buffer.from(raw);
  else fail('Raw Program JSON must be a string or UTF-8 bytes');
  if (bytes.byteLength > authority.maxProgramBytes) fail('Raw Program JSON exceeds its byte authority');
  try {
    return typeof raw === 'string' ? raw : utf8Decoder.decode(bytes);
  } catch {
    fail('Raw Program JSON is not valid UTF-8');
  }
}

class StrictJsonParser {
  constructor(text, authority) {
    this.text = text;
    this.authority = authority;
    this.offset = 0;
    this.nodes = 0;
  }

  parse() {
    this.space();
    const value = this.value(0);
    this.space();
    if (this.offset !== this.text.length) fail('Raw Program JSON has trailing data');
    return value;
  }

  space() {
    while (/[\t\n\r ]/u.test(this.text[this.offset] ?? '')) this.offset += 1;
  }

  value(depth) {
    this.nodes += 1;
    if (this.nodes > this.authority.maxProgramNodes) fail('Raw Program JSON exceeds its node authority');
    if (depth > this.authority.maxProgramDepth) fail('Raw Program JSON exceeds its depth authority');
    const char = this.text[this.offset];
    if (char === '"') return this.string();
    if (char === '{') return this.object(depth);
    if (char === '[') return this.array(depth);
    if (char === 't' && this.take('true')) return true;
    if (char === 'f' && this.take('false')) return false;
    if (char === 'n' && this.take('null')) return null;
    return this.number();
  }

  take(token) {
    if (!this.text.startsWith(token, this.offset)) return false;
    this.offset += token.length;
    return true;
  }

  string() {
    this.offset += 1;
    let result = '';
    while (this.offset < this.text.length) {
      const char = this.text[this.offset++];
      if (char === '"') return normalizeProgramString(result, 'Raw Program JSON string');
      if (char === '\\') {
        const escape = this.text[this.offset++];
        const simple = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (Object.hasOwn(simple, escape)) result += simple[escape];
        else if (escape === 'u') {
          const digits = this.text.slice(this.offset, this.offset + 4);
          if (!/^[0-9a-fA-F]{4}$/u.test(digits)) fail('Raw Program JSON has an invalid Unicode escape');
          result += String.fromCharCode(Number.parseInt(digits, 16));
          this.offset += 4;
        } else fail('Raw Program JSON has an invalid escape');
      } else {
        if (char.charCodeAt(0) < 0x20) fail('Raw Program JSON has an unescaped control character');
        result += char;
      }
    }
    fail('Raw Program JSON has an unterminated string');
  }

  object(depth) {
    this.offset += 1;
    this.space();
    const result = Object.create(null);
    const rawKeys = new Set();
    const normalizedKeys = new Set();
    if (this.text[this.offset] === '}') { this.offset += 1; return result; }
    while (true) {
      if (this.text[this.offset] !== '"') fail('Raw Program JSON object key must be a string');
      const start = this.offset;
      const key = this.string();
      const rawKeyToken = this.text.slice(start, this.offset);
      if (rawKeys.has(rawKeyToken)) fail('Raw Program JSON contains a duplicate object key');
      if (normalizedKeys.has(key)) fail('Raw Program JSON contains a duplicate or NFC-colliding object key');
      rawKeys.add(rawKeyToken);
      normalizedKeys.add(key);
      this.space();
      if (this.text[this.offset++] !== ':') fail('Raw Program JSON object is missing a colon');
      this.space();
      result[key] = this.value(depth + 1);
      this.space();
      const separator = this.text[this.offset++];
      if (separator === '}') return result;
      if (separator !== ',') fail('Raw Program JSON object is invalid');
      this.space();
    }
  }

  array(depth) {
    this.offset += 1;
    this.space();
    const result = [];
    if (this.text[this.offset] === ']') { this.offset += 1; return result; }
    while (true) {
      if (result.length >= this.authority.maxProgramNodes) fail('Raw Program JSON array exceeds its node authority');
      result.push(this.value(depth + 1));
      this.space();
      const separator = this.text[this.offset++];
      if (separator === ']') return result;
      if (separator !== ',') fail('Raw Program JSON array is invalid');
      this.space();
    }
  }

  number() {
    const rest = this.text.slice(this.offset);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(rest);
    if (!match) fail('Raw Program JSON contains an invalid value');
    const token = match[0];
    const next = rest[token.length];
    if (next !== undefined && !/[\t\n\r ,\]}]/u.test(next)) fail('Raw Program JSON contains an invalid number');
    this.offset += token.length;
    const value = Number(token);
    if (!Number.isFinite(value)) fail('Raw Program JSON number is not finite');
    return Object.is(value, -0) ? 0 : value;
  }
}

export function parseRawProgramJson(raw, authority) {
  const deployed = requireAuthority(authority);
  const parsed = new StrictJsonParser(rawText(raw, deployed), deployed).parse();
  const checked = normalizeChecked(parsed, deployed, deployed.maxProgramBytes);
  return deepFreezeProgramValue(checked.normalized);
}

export const parseRawJson = parseRawProgramJson;
