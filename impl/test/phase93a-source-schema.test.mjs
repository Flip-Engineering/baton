import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ProgramIrError, canonicalValueText, createProgramValueAuthority, createSchemaRegistry,
  deepFreezeProgramValue, normalizeCanonicalValue, parseRawProgramJson,
} from '../src/program-ir/index.mjs';

const authority = createProgramValueAuthority({
  maxJoinMembers: 64, maxProgramBytes: 64 * 1024, maxProgramDepth: 32,
  maxProgramNodes: 256, maxSchemaDefinitions: 64, maxValueBytes: 16 * 1024,
});

test('P93A1-S1: raw JSON rejects duplicate keys, Unicode faults, and invalid numbers before semantics', () => {
  for (const raw of [
    '{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"é":1,"e\\u0301":2}',
    '"\\ud800"', '"\\udc00"', '1e9999', '01', '[1,]', '{"x":1,}',
  ]) assert.throws(() => parseRawProgramJson(raw, authority), { code: 'program_invalid' });
  assert.throws(() => parseRawProgramJson(Buffer.from([0x22, 0xed, 0xa0, 0x80, 0x22]), authority),
    { code: 'program_invalid' });
  assert.equal(Object.is(parseRawProgramJson('-0', authority), -0), false);
  assert.equal(parseRawProgramJson('-0', authority), 0);
});

test('P93A1-S1b: maxProgramNodes bounds raw and in-memory values independently of byte authority', () => {
  const threeNodes = createProgramValueAuthority({
    maxJoinMembers: 64, maxProgramBytes: 64 * 1024, maxProgramDepth: 32,
    maxProgramNodes: 3, maxSchemaDefinitions: 64, maxValueBytes: 16 * 1024,
  });
  assert.deepEqual(parseRawProgramJson('[0,1]', threeNodes), [0, 1]);
  assert.deepEqual(normalizeCanonicalValue([0, 1], threeNodes), [0, 1]);
  assert.throws(() => parseRawProgramJson('[0,1,2]', threeNodes), /node authority/u);
  assert.throws(() => normalizeCanonicalValue([0, 1, 2], threeNodes), /node authority/u);
  assert.throws(() => parseRawProgramJson('{"a":0,"b":1,"c":2}', threeNodes), /node authority/u);
  assert.throws(() => normalizeCanonicalValue({ a: 0, b: 1, c: 2 }, threeNodes), /node authority/u);
});

test('P93A1-S1c: authority, raw JSON, and registry Proxy boundaries reject without traps', () => {
  const trapped = (target) => {
    let traps = 0;
    const trip = () => { traps += 1; throw new Error('Proxy trap must not run'); };
    return {
      proxy: new Proxy(target, {
        get: trip, getOwnPropertyDescriptor: trip, getPrototypeOf: trip, has: trip, ownKeys: trip,
      }),
      count: () => traps,
    };
  };
  for (const attempt of [
    (() => {
      const observed = trapped({
        maxJoinMembers: 64, maxProgramBytes: 1024, maxProgramDepth: 8,
        maxProgramNodes: 8, maxSchemaDefinitions: 8, maxValueBytes: 1024,
      });
      return { observed, run: () => createProgramValueAuthority(observed.proxy) };
    })(),
    (() => {
      const observed = trapped(Buffer.from('{}'));
      return { observed, run: () => parseRawProgramJson(observed.proxy, authority) };
    })(),
    (() => {
      const observed = trapped([]);
      return { observed, run: () => createSchemaRegistry(observed.proxy, authority) };
    })(),
    (() => {
      const observed = trapped({ value: 1 });
      return { observed, run: () => deepFreezeProgramValue(observed.proxy) };
    })(),
  ]) {
    assert.throws(attempt.run, (error) => error instanceof ProgramIrError && error.code === 'program_invalid');
    assert.equal(attempt.observed.count(), 0);
  }
});

test('P93A1-S2: hostile JavaScript values fail before any clone or accessor execution', () => {
  let accessorReads = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'value', { enumerable: true, get() { accessorReads += 1; return 1; } });
  const symbol = { value: 1 }; symbol[Symbol('hidden')] = 2;
  const symbolArray = [1]; symbolArray[Symbol('hidden')] = 2;
  const accessorArray = [1];
  Object.defineProperty(accessorArray, '0', { enumerable: true, configurable: true,
    get() { accessorReads += 1; return 1; } });
  const inherited = Object.create({ inherited: true }); inherited.value = 1;
  const custom = Object.create(null); custom.value = 1; // null prototypes are intentionally valid JSON objects.
  const toJSON = { value: 1, toJSON() { return 1; } };
  const decorated = [1]; decorated.extra = true;
  const sparse = []; sparse.length = 2; sparse[1] = 1;
  const arrayPrototype = [1]; Object.setPrototypeOf(arrayPrototype, Object.create(Array.prototype));
  const cyclic = {}; cyclic.self = cyclic;
  let proxyReads = 0;
  const proxy = new Proxy({ value: 1 }, { ownKeys(target) { proxyReads += 1; return Reflect.ownKeys(target); } });

  for (const value of [accessor, symbol, symbolArray, accessorArray, inherited, toJSON,
    decorated, sparse, arrayPrototype, cyclic, proxy]) {
    assert.throws(() => normalizeCanonicalValue(value, authority), { code: 'program_invalid' });
  }
  assert.equal(accessorReads, 0);
  assert.equal(proxyReads, 0);
  assert.equal(canonicalValueText(custom, authority), '{"value":1}');
  assert.throws(() => normalizeCanonicalValue(new Date(0), authority), { code: 'program_invalid' });
});

test('P93A1-S3: NFC normalization is immutable and property collisions are refused', () => {
  const source = { text: 'e\u0301' };
  const normalized = normalizeCanonicalValue(source, authority);
  assert.deepEqual(normalized, { text: 'é' });
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(source.text, 'e\u0301');
  assert.throws(() => normalizeCanonicalValue({ é: 1, 'e\u0301': 2 }, authority),
    /NFC key collision/u);
});

test('P93A1-S4: invalid source processing has no artifact or execution surface', () => {
  let reads = 0;
  const reader = { readArtifact() { reads += 1; throw new Error('must not run'); } };
  assert.throws(() => parseRawProgramJson('{"kind":"unknown","kind":"other"}', authority));
  assert.equal(reads, 0);
  assert.equal(typeof reader.writeArtifact, 'undefined');
});
