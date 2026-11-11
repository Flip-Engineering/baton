// Exact numeric records shared by the private Fine7 cache client and fixtures.
const encoder = new TextEncoder(), decoder = new TextDecoder();
const MAGIC = new Uint8Array([70, 55, 67, 65, 67, 72, 69, 49]);
const types = Object.fromEntries([Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array].map(T => [T.name, T]));
const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
}
export function equalBytes(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}
export function encode(value, maxBytes, canonicalObjects = true) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Explicit record byte budget required');
  const blocks = [], active = new Set(); let size = 0;
  function visit(x) {
    if (x === null) return ['null'];
    if (x === undefined) return ['undefined'];
    if (typeof x === 'boolean' || typeof x === 'string') return [typeof x, x];
    if (typeof x === 'number') return ['number', Number.isNaN(x) ? 'NaN' : x === Infinity ? '+Infinity' : x === -Infinity ? '-Infinity' : Object.is(x, -0) ? '-0' : x];
    if (typeof x !== 'object' || active.has(x)) throw new Error('Unsupported or cyclic record value');
    if (ArrayBuffer.isView(x)) {
      const T = types[x.constructor.name];
      if (!T || x instanceof DataView || !(x.buffer instanceof ArrayBuffer) || Object.getPrototypeOf(x) !== T.prototype) throw new Error('Unsupported or concurrently shared array type');
      if (size + x.byteLength > maxBytes) throw new Error('Record exceeds byte budget');
      const data = new Uint8Array(x.buffer, x.byteOffset, x.byteLength).slice();
      const row = ['typed', T.name, x.length, size, data.byteLength];
      size += data.byteLength; if (size > maxBytes) throw new Error('Record exceeds byte budget');
      blocks.push(data); return row;
    }
    active.add(x);
    let out;
    if (Array.isArray(x)) {
      if (Object.getPrototypeOf(x) !== Array.prototype || Object.getOwnPropertySymbols(x).length) throw new Error('Unsupported array prototype');
      if (x.length > Math.floor(maxBytes / 8)) throw new Error('Array exceeds record byte budget');
      for (const key of Object.getOwnPropertyNames(x)) {
        if (key === 'length') continue;
        const d = Object.getOwnPropertyDescriptor(x, key);
        if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= x.length || !Object.hasOwn(d, 'value') || !d.enumerable) throw new Error('Unsupported array property');
      }
      out = ['array', Array.from({ length: x.length }, (_, i) => Object.hasOwn(x, i) ? visit(x[i]) : ['hole'])];
    }
    else {
      if (Object.getPrototypeOf(x) !== Object.prototype && Object.getPrototypeOf(x) !== null) throw new Error('Unsupported object prototype');
      if (Object.getOwnPropertySymbols(x).length || Object.getOwnPropertyNames(x).length !== Object.keys(x).length) throw new Error('Hidden properties are unsupported');
      const rows = [];
      const keys = Object.keys(x);
      if (canonicalObjects) keys.sort();
      for (const key of keys) {
        const d = Object.getOwnPropertyDescriptor(x, key);
        if (!Object.hasOwn(d, 'value')) throw new Error('Accessor properties are unsupported');
        rows.push([key, visit(d.value)]);
      }
      out = ['object', Object.getPrototypeOf(x) === null ? 'null' : 'plain', rows];
    }
    active.delete(x); return out;
  }
  const tree = visit(value), header = encoder.encode(JSON.stringify({ schema: 1, littleEndian, tree, dataBytes: size }));
  const total = MAGIC.length + 4 + header.byteLength + size;
  if (total > maxBytes) throw new Error('Record exceeds byte budget');
  const out = new Uint8Array(total); out.set(MAGIC); new DataView(out.buffer).setUint32(MAGIC.length, header.byteLength);
  out.set(header, MAGIC.length + 4); let off = MAGIC.length + 4 + header.byteLength;
  for (const data of blocks) { out.set(data, off); off += data.byteLength; }
  return out;
}
export function decode(bytes, maxBytes) {
  if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(maxBytes) || maxBytes <= 0 || bytes.byteLength > maxBytes || bytes.byteLength < 12) throw new Error('Invalid record size');
  if (!equalBytes(bytes.subarray(0, 8), MAGIC)) throw new Error('Unknown record encoding');
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8);
  if (n > bytes.byteLength - 12) throw new Error('Truncated record header');
  const h = JSON.parse(decoder.decode(bytes.subarray(12, 12 + n))), data = bytes.subarray(12 + n);
  if (h.schema !== 1 || h.littleEndian !== littleEndian || h.dataBytes !== data.byteLength) throw new Error('Record ABI mismatch');
  let next = 0;
  function visit(x) {
    if (!Array.isArray(x)) throw new Error('Malformed record tree');
    switch (x[0]) {
      case 'null': if (x.length !== 1) break; return null;
      case 'undefined': if (x.length !== 1) break; return undefined;
      case 'boolean': if (x.length !== 2 || typeof x[1] !== 'boolean') break; return x[1];
      case 'string': if (x.length !== 2 || typeof x[1] !== 'string') break; return x[1];
      case 'number': {
        if (x.length !== 2) break;
        if (x[1] === 'NaN') return NaN; if (x[1] === '+Infinity') return Infinity; if (x[1] === '-Infinity') return -Infinity; if (x[1] === '-0') return -0;
        if (typeof x[1] !== 'number' || !Number.isFinite(x[1])) break; return x[1];
      }
      case 'typed': {
        const T = types[x[1]];
        if (x.length !== 5 || !T || !Number.isSafeInteger(x[2]) || x[2] < 0 || x[3] !== next || x[4] !== x[2] * T.BYTES_PER_ELEMENT || x[4] > data.byteLength - next) break;
        const copy = data.slice(next, next + x[4]); next += x[4]; return new T(copy.buffer);
      }
      case 'array': {
        if (x.length !== 2 || !Array.isArray(x[1])) break;
        const out = new Array(x[1].length);
        x[1].forEach((v, i) => { if (!(Array.isArray(v) && v.length === 1 && v[0] === 'hole')) out[i] = visit(v); }); return out;
      }
      case 'object': {
        if (x.length !== 3 || !['plain', 'null'].includes(x[1]) || !Array.isArray(x[2])) break;
        const out = Object.create(x[1] === 'null' ? null : Object.prototype), seen = new Set();
        for (const row of x[2]) {
          if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || seen.has(row[0])) throw new Error('Malformed object keys');
          Object.defineProperty(out, row[0], { value: visit(row[1]), enumerable: true, writable: true, configurable: true }); seen.add(row[0]);
        }
        return out;
      }
    }
    throw new Error('Malformed record tree');
  }
  const out = visit(h.tree); if (next !== data.byteLength) throw new Error('Unreferenced record bytes'); return out;
}
export function validateBake(B) {
  const keys = ['W', 'H', 'h', 'grad', 'cav', 'mask', 'cov', 'pos', 'hLo', 'hHi', 'cavHi', 'vHi', 'voHi', 'fHi', 'report'];
  if (!B || typeof B !== 'object' || Object.keys(B).sort().join('|') !== keys.sort().join('|')) throw new Error('Unknown bake result shape');
  if (!Number.isSafeInteger(B.W) || B.W < 1 || !Number.isSafeInteger(B.H) || B.H < 1 || !Number.isSafeInteger(B.W * B.H)) throw new Error('Invalid bake dimensions');
  const n = B.W * B.H;
  for (const [key, count, type, optional] of [['h', n, 'Float32Array'], ['grad', n * 2, 'Float32Array'], ['cav', n, 'Float32Array'], ['mask', n * 4, 'Uint8Array'], ['cov', n, 'Uint8Array'], ['pos', n * 3, 'Float32Array', true], ...['hLo', 'hHi', 'cavHi', 'vHi', 'voHi', 'fHi'].map(key => [key, n, 'Float32Array', true])]) {
    if (optional && B[key] === null) continue;
    if (!ArrayBuffer.isView(B[key]) || B[key].constructor.name !== type || B[key].length !== count) throw new Error('Invalid bake array: ' + key);
  }
  if (!B.report || typeof B.report !== 'object' || Array.isArray(B.report)) throw new Error('Invalid bake report');
  return B;
}
