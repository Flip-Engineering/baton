// Regressions for the producer-side capture records.
//
// These exercise the producer module against the consumer that reads the same rendering, so the two
// sides are checked against each other rather than each against its own copy of the contract. Nothing
// here reads a real file or runs a frontend; the closure and the records are supplied.
//
//   node --test bend2/context/bend2/capture-records.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { captureRecord, createCaptureRecords, encodeExactBytes, producerOf } from './capture-records.mjs';
import { decodeCoreCapture } from './source-binding.mjs';
import { createFrontendAdapter } from './frontend-adapter.mjs';

const bytesOf = (text) => Buffer.from(text, 'utf8');

function closure(files, options = {}) {
  const reads = [];
  return {
    reads,
    resolve(identity) {
      if (options.resolve !== undefined) return options.resolve(identity);
      return { exists: files[identity] !== undefined, identity };
    },
    read(identity) {
      reads.push(identity);
      if (options.read !== undefined) return options.read(identity, reads.length);
      if (files[identity] === undefined) return { refuse: 'not in the captured closure' };
      return { identity, bytes: files[identity] };
    },
  };
}

test('exact bytes survive the encoding, including a byte order mark and a byte that is not UTF-8', () => {
  const bytes = Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a, 0xff, 0x62]);
  const record = captureRecord({ identity: '/src/bom.bend', bytes });
  assert.equal(record.captureKind, 'file');
  assert.equal(record.path, '/src/bom.bend');
  assert.equal(record.marker, createHash('sha256').update(bytes).digest('hex'));
  const decoded = decodeCoreCapture(record);
  assert.equal(decoded.status, 'bytes');
  assert.deepEqual([...decoded.bytes], [...bytes], 'the consumer recovers the exact bytes');
  const hex = captureRecord({ identity: '/src/bom.bend', bytes, encoding: 'hex' });
  assert.equal(hex.payloadEncoding, 'hex');
  assert.deepEqual([...decodeCoreCapture(hex).bytes], [...bytes]);
  assert.equal(encodeExactBytes('not bytes').reason, 'bytesMissing');
  assert.equal(encodeExactBytes(bytes, 'utf8-text').reason, 'payloadEncodingUnsupported');
});

test('descriptor kinds never carry source bytes and the consumer refuses them as input', () => {
  const absent = captureRecord({ identity: '/src/gone.bend', kind: 'absent' });
  assert.equal(absent.marker, 'absent');
  assert.equal(absent.payload, '');
  assert.equal(absent.payloadEncoding, 'none');
  const link = captureRecord({ identity: '/src/link.bend', kind: 'link', target: '/src/real.bend' });
  assert.equal(link.marker, '/src/real.bend');
  assert.equal(captureRecord({ identity: '/src/link.bend', kind: 'link' }).reason, 'targetRequired');
  const dir = captureRecord({ identity: '/src/dir', kind: 'dir', marker: 'd'.repeat(64) });
  assert.equal(dir.captureKind, 'dir');
  assert.equal(captureRecord({ identity: '/src/dir', kind: 'dir' }).reason, 'markerRequired');
  assert.equal(captureRecord({ identity: '/src/x.bend', kind: 'nonsense' }).reason, 'captureKindUnsupported');

  // The consumer side classifies them exactly as it must: an absence is an absence, and a link or
  // directory descriptor is not source content.
  assert.equal(decodeCoreCapture(absent).status, 'absent');
  assert.equal(decodeCoreCapture(link).status, 'descriptor');
  assert.equal(decodeCoreCapture(dir).kind, 'dir');
});

test('a produced file record is accepted by the consumer adapter unchanged', () => {
  const text = 'def id(x: U32) -> U32:\n  x\n';
  const bytes = bytesOf(text);
  const record = captureRecord({ identity: '/src/valid.bend', bytes, role: 'frontend-source' });
  const adapter = createFrontendAdapter({
    captureOnly: true,
    acquisition: { read: () => record, resolve: () => ({ exists: true, identity: '/src/valid.bend' }) },
  });
  const started = adapter.beginQuery({ identity: '/src/valid.bend' });
  assert.equal(started.status, 'started');
  assert.equal(adapter.sink.readSource('/src/valid.bend', started.token), text);
  adapter.endQuery();
  const session = adapter.report().sessions[0];
  assert.equal(session.completeness, 'complete');
  assert.equal(session.acquisitions[0].status, 'captured');
  assert.equal(session.acquisitions[0].role, 'frontend-source');
});

test('an empty file is a valid record and an admitted-empty capture, not an absence', () => {
  const record = captureRecord({ identity: '/src/empty.bend', bytes: new Uint8Array(0) });
  assert.equal(record.captureKind, 'file');
  assert.equal(record.payload, '');
  assert.equal(record.marker, createHash('sha256').update(Buffer.alloc(0)).digest('hex'));
  const decoded = decodeCoreCapture(record);
  assert.equal(decoded.status, 'bytes');
  assert.equal(decoded.bytes.byteLength, 0);
});

test('the producing triple is attached by claim, and the acquired record is never mutated', () => {
  const produced = createCaptureRecords({
    acquisition: closure({ '/src/a.bend': bytesOf('def a() -> U32:\n  1\n') }),
  });
  const acquired = produced.acquire('/src/a.bend');
  assert.equal(acquired.status, 'captured');
  assert.equal(acquired.record.producerModule, null);
  assert.equal(produced.claim('/src/a.bend', { module: 'bend2-frontend-capture' }).reason, 'producerIncomplete');
  const claimed = produced.claim('/src/a.bend', { module: 'bend2-frontend-capture', digest: 'd'.repeat(64), operation: 'sourceAnalyze' });
  assert.equal(claimed.status, 'claimed');
  assert.equal(claimed.record.producerOperation, 'sourceAnalyze');
  assert.equal(acquired.record.producerOperation, null, 'the record read before the claim is unchanged');
  assert.equal(produced.records().length, 1);
  assert.equal(produced.records()[0].producerDigest, 'd'.repeat(64));
  assert.equal(produced.claim('/src/never.bend', { module: 'm', digest: 'd', operation: 'o' }).reason, 'notCaptured');
  assert.equal(producerOf(null).status, 'unclaimed');
});

test('acquisition keeps absent, unavailable and conflict distinct without a host fallback', () => {
  const files = { '/src/root.bend': bytesOf('def a() -> U32:\n  1\n') };
  const produced = createCaptureRecords({ acquisition: closure(files) });
  assert.equal(produced.acquire('/src/other.bend').status, 'absent', 'the closure answered that it is not there');
  assert.equal(produced.acquire('/src/other.bend').record.captureKind, 'absent');
  assert.equal(produced.counters.absent, 1, 'the repeat is served from the record already made');

  const unanswered = createCaptureRecords({ acquisition: { read: () => ({ bytes: bytesOf('x') }) } });
  const missingResolver = unanswered.acquire('/src/root.bend');
  assert.equal(missingResolver.status, 'unavailable');
  assert.equal(missingResolver.reason, 'resolutionUnavailable');
  assert.equal(missingResolver.detail, 'closureResolutionMissing');

  const malformed = createCaptureRecords({ acquisition: { read: () => ({ bytes: bytesOf('x') }), resolve: () => ({ identity: '/src/root.bend' }) } });
  assert.equal(malformed.acquire('/src/root.bend').detail, 'resolutionAnswerMalformed');

  const throwing = createCaptureRecords({ acquisition: { read: () => { throw new Error('reader unavailable'); }, resolve: () => ({ exists: true, identity: '/src/root.bend' }) } });
  const threw = throwing.acquire('/src/root.bend');
  assert.equal(threw.reason, 'readerThrew');
  assert.equal(threw.detail, 'reader unavailable');
  assert.equal(throwing.counters.unavailable, 1, 'a throwing reader is counted once');

  const refusing = createCaptureRecords({ acquisition: { read: () => ({ refuse: 'not captured for this query' }), resolve: () => ({ exists: true, identity: '/src/root.bend' }) } });
  const refused = refusing.acquire('/src/root.bend');
  assert.equal(refused.reason, 'readerRefused');
  assert.equal(refused.detail, 'not captured for this query');

  // One canonical identity, two different byte sets: the second is a conflict, not a silent overwrite.
  let served = 0;
  const conflicting = createCaptureRecords({
    acquisition: {
      resolve: () => ({ exists: true, identity: '/src/real.bend' }),
      read: (identity) => {
        served += 1;
        return { identity, bytes: bytesOf(served === 1 ? 'def a() -> U32:\n  1\n' : 'def a() -> U32:\n  0\n') };
      },
    },
  });
  assert.equal(conflicting.acquire('/src/alias.bend').status, 'captured');
  assert.equal(conflicting.acquire('/src/alias.bend').status, 'captured', 'the recorded bytes are reused for the same canonical identity');
  assert.equal(conflicting.acquire('/src/other-alias.bend').status, 'unavailable');
  assert.equal(conflicting.acquire('/src/other-alias.bend').reason, 'aliasConflict');
  assert.equal(conflicting.counters.conflicts, 1);
  assert.equal(served, 2, 'the conflict is detected from the second read, not by re-reading the first');
});

test('the produced records are immutable', () => {
  const produced = createCaptureRecords({ acquisition: closure({ '/src/a.bend': bytesOf('def a() -> U32:\n  1\n') }) });
  const acquired = produced.acquire('/src/a.bend');
  assert.equal(Object.isFrozen(acquired.record), true);
  assert.throws(() => { acquired.record.captureKind = 'link'; }, TypeError);
  assert.equal(acquired.record.captureKind, 'file');
});
