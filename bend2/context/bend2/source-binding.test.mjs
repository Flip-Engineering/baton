// Source-level regressions for the Bend2 source-binding component.
//
// Authored for later remote execution under exact Root admission. Nothing here was executed while
// authoring. Run with: node --test bend2/context/bend2/source-binding.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FRONTEND_PINS,
  REPRESENTATION_LIMITS,
  captureSource,
  createView,
  decodeStrictUtf8,
  locateSpan,
  locationOf,
} from './source-binding.mjs';

const bytesOf = (text) => Buffer.from(text, 'utf8');
const wholeText = (capture) =>
  createView(capture, { segments: [{ kind: 'original', from: 0, to: capture.utf16Length }] });

test('decodeStrictUtf8 reports code points and their byte offsets', () => {
  const decoded = decodeStrictUtf8(bytesOf('aé😀'));
  assert.equal(decoded.status, 'decoded');
  assert.deepEqual(decoded.codePoints, [0x61, 0xe9, 0x1f600]);
  assert.deepEqual(decoded.codePointByteOffsets, [0, 1, 3]);
});

test('identical text in two files keeps each caller identity', () => {
  const bytes = bytesOf('same\n');
  const first = captureSource({ identity: '/work/a.bend', bytes });
  const second = captureSource({ identity: '/work/b.bend', bytes });
  assert.equal(first.status, 'captured');
  assert.equal(second.status, 'captured');
  assert.equal(first.digest, second.digest, 'equal bytes share a digest');
  assert.notEqual(first.identity, second.identity);

  const span = { src: 'same\n', beg: 0, end: 4 };
  const viaFirst = locateSpan(first, wholeText(first), span);
  const viaSecond = locateSpan(second, wholeText(second), span);
  assert.equal(viaFirst.identity, '/work/a.bend');
  assert.equal(viaSecond.identity, '/work/b.bend');
  assert.equal(viaFirst.digest, first.digest);

  const foreignView = locateSpan(first, wholeText(second), span);
  assert.equal(foreignView.status, 'unavailable');
  assert.equal(foreignView.reason, 'viewCaptureMismatch');
});

test('a byte order mark is retained and counted', () => {
  const capture = captureSource({ identity: '/work/bom.bend', bytes: bytesOf('\ufeffx') });
  assert.equal(capture.status, 'captured');
  assert.equal(capture.text.length, 2);
  assert.equal(capture.text[0], '\ufeff');
  assert.equal(capture.byteLength, 4, 'three byte order mark bytes plus one ascii byte');
  assert.equal(capture.utf16Length, 2);
});

test('carriage returns are preserved without normalization', () => {
  const capture = captureSource({ identity: '/work/crlf.bend', bytes: bytesOf('a\r\nb') });
  assert.equal(capture.text, 'a\r\nb');
  const carriage = locationOf(capture, 1);
  assert.equal(carriage.status, 'mapped');
  assert.equal(carriage.line, 0);
  assert.equal(carriage.column, 2);
  assert.equal(carriage.byteOffset, 1);
  const afterNewline = locationOf(capture, 3);
  assert.equal(afterNewline.line, 1);
  assert.equal(afterNewline.column, 1);
  assert.equal(afterNewline.byteOffset, 3);
});

test('supplementary characters map through UTF-16 and refuse surrogate interiors', () => {
  const capture = captureSource({ identity: '/work/astral.bend', bytes: bytesOf('a😀b') });
  assert.equal(capture.utf16Length, 4);
  assert.equal(capture.byteLength, 6);

  assert.deepEqual(capture.byteOffsetForUtf16(0), { status: 'mapped', byteOffset: 0 });
  assert.deepEqual(capture.byteOffsetForUtf16(1), { status: 'mapped', byteOffset: 1 });
  assert.equal(capture.byteOffsetForUtf16(2).reason, 'surrogateInterior');
  assert.deepEqual(capture.byteOffsetForUtf16(3), { status: 'mapped', byteOffset: 5 });
  assert.deepEqual(capture.byteOffsetForUtf16(4), { status: 'mapped', byteOffset: 6 });

  assert.equal(capture.utf16IndexForByteOffset(2).reason, 'byteInterior');
  assert.equal(capture.utf16IndexForByteOffset(4).reason, 'byteInterior');
  assert.deepEqual(capture.utf16IndexForByteOffset(5), { status: 'mapped', utf16Index: 3 });

  const view = wholeText(capture);
  const mapped = locateSpan(capture, view, { src: 'a😀b', beg: 1, end: 3 });
  assert.equal(mapped.status, 'mapped');
  assert.deepEqual(mapped.original.start, { index: 1, line: 0, column: 2 });
  assert.deepEqual(mapped.original.end, { index: 3, line: 0, column: 4 });
  assert.deepEqual(mapped.byteRange, { start: 1, end: 5 });
  assert.equal(mapped.text, '😀');

  const interior = locateSpan(capture, view, { src: 'a😀b', beg: 2, end: 3 });
  assert.equal(interior.status, 'unavailable');
  assert.equal(interior.reason, 'surrogateInterior');
});

test('malformed utf-8 is refused with the offending byte offset', () => {
  const cases = [
    { bytes: [0x80], reason: 'unexpectedContinuation', byteOffset: 0 },
    { bytes: [0xc2], reason: 'truncatedSequence', byteOffset: 0 },
    { bytes: [0xc0, 0x80], reason: 'overlongEncoding', byteOffset: 0 },
    { bytes: [0xe0, 0x80, 0x80], reason: 'overlongEncoding', byteOffset: 0 },
    { bytes: [0xed, 0xa0, 0x80], reason: 'surrogateEncoding', byteOffset: 0 },
    { bytes: [0xf4, 0x90, 0x80, 0x80], reason: 'outOfRangeCodePoint', byteOffset: 0 },
    { bytes: [0xe1, 0x41, 0x80], reason: 'invalidContinuation', byteOffset: 1 },
    { bytes: [0xf0, 0x9f, 0x98], reason: 'truncatedSequence', byteOffset: 0 },
    { bytes: [0xff], reason: 'invalidStartByte', byteOffset: 0 },
  ];
  for (const entry of cases) {
    const capture = captureSource({ identity: '/work/bad.bend', bytes: Uint8Array.from(entry.bytes) });
    assert.equal(capture.status, 'unavailable', `bytes ${entry.bytes.join(',')}`);
    assert.equal(capture.reason, entry.reason);
    assert.equal(capture.detail.byteOffset, entry.byteOffset);
  }
});

test('removed import text yields an explicit unmapped boundary', () => {
  const original = 'aaa\nbbb\nccc\n';
  const capture = captureSource({ identity: '/work/imports.bend', bytes: bytesOf(original) });
  assert.equal(capture.utf16Length, 12);

  // The pinned loader blanks the import line's characters and keeps the newline separators, so the
  // transformed string is 'aaa\n' + '\n' + 'ccc\n' and the caller supplies that exact correspondence.
  const view = createView(capture, {
    segments: [
      { kind: 'original', from: 0, to: 4 },
      { kind: 'original', from: 7, to: 8 },
      { kind: 'original', from: 8, to: 12 },
    ],
  });
  assert.equal(view.status, 'view');
  assert.equal(view.text, 'aaa\n\nccc\n');
  assert.equal(view.utf16Length, 9);

  assert.deepEqual(view.mapRange(0, 4), { status: 'mapped', originalStart: 0, originalEnd: 4 });
  assert.deepEqual(view.mapRange(4, 5), { status: 'mapped', originalStart: 7, originalEnd: 8 });
  assert.deepEqual(view.mapRange(4, 9), { status: 'mapped', originalStart: 7, originalEnd: 12 });
  assert.equal(view.mapRange(3, 5).reason, 'spansOmitted', 'a range crossing removed text');
  assert.equal(view.mapRange(5, 6).reason, 'spansOmitted');
  assert.deepEqual(view.mapRange(4, 4), { status: 'mapped', originalStart: 7, originalEnd: 7 });
  assert.deepEqual(view.mapRange(9, 9), { status: 'mapped', originalStart: 12, originalEnd: 12 });

  const across = locateSpan(capture, view, { src: view.text, beg: 3, end: 5 });
  assert.equal(across.status, 'unavailable');
  assert.equal(across.reason, 'spansOmitted');

  const afterImport = locateSpan(capture, view, { src: view.text, beg: 4, end: 9 });
  assert.equal(afterImport.status, 'mapped');
  assert.equal(afterImport.text, '\nccc\n');
  assert.deepEqual(afterImport.original.start, { index: 7, line: 1, column: 4 });
  assert.deepEqual(afterImport.original.end, { index: 12, line: 2, column: 1 });
  assert.deepEqual(afterImport.byteRange, { start: 7, end: 12 });
});

test('invalid, reversed and out-of-range boundaries are refused', () => {
  const capture = captureSource({ identity: '/work/edges.bend', bytes: bytesOf('ab\ncd') });
  const view = wholeText(capture);

  assert.equal(view.mapRange(-1, 1).reason, 'outOfRange');
  assert.equal(view.mapRange(0, 6).reason, 'outOfRange');
  assert.equal(view.mapRange(2, 1).reason, 'reversedRange');
  assert.equal(view.mapRange(0.5, 1).reason, 'notInteger');
  assert.equal(view.mapRange(1, 1.5).reason, 'notInteger');

  assert.equal(locateSpan(capture, view, { src: 'other', beg: 0, end: 1 }).reason, 'sourceAssociationMismatch');
  assert.equal(locateSpan(capture, view, { beg: 0, end: 1 }).reason, 'spanSourceMissing');
  assert.equal(locateSpan(capture, view, null).reason, 'spanMissing');
  assert.equal(locateSpan(capture, view, { src: 'ab\ncd', beg: 4, end: 4 }).status, 'mapped');

  const empty = createView(capture, { segments: [] });
  assert.equal(empty.status, 'view');
  assert.equal(empty.mapRange(0, 0).reason, 'emptyView');
  assert.equal(createView(capture, { segments: [{ kind: 'original', from: 2, to: 2 }] }).reason, 'emptySegment');
  assert.equal(createView(capture, { segments: [{ kind: 'original', from: 3, to: 1 }] }).reason, 'reversedRange');
  assert.equal(createView(capture, { segments: [{ kind: 'original', from: 0, to: 99 }] }).reason, 'outOfRange');
  assert.equal(createView(capture, { segments: [{ kind: 'nope' }] }).reason, 'segmentKindUnsupported');
  assert.equal(createView(capture).reason, 'segmentsMissing');
  assert.equal(createView(null, { segments: [] }).reason, 'captureUnavailable');
});

test('substituted text has no original correspondence', () => {
  const capture = captureSource({ identity: '/work/sub.bend', bytes: bytesOf('keep\n') });
  const view = createView(capture, {
    segments: [
      { kind: 'original', from: 0, to: 5 },
      { kind: 'unmapped', text: '<removed>' },
    ],
  });
  assert.equal(view.text, 'keep\n<removed>');
  assert.equal(view.mapRange(5, 14).reason, 'unmappedSegment');
  assert.equal(view.mapRange(4, 6).reason, 'spansOmitted');
  assert.equal(view.mapRange(5, 5).reason, 'unmappedBoundary');
});

test('returned data is immutable and caller mutation does not change a view', () => {
  const capture = captureSource({ identity: '/work/immutable.bend', bytes: bytesOf('abc') });
  const segments = [{ kind: 'original', from: 0, to: 3 }];
  const view = createView(capture, { segments });
  assert.equal(Object.isFrozen(capture), true);
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.segments), true);
  assert.equal(Object.isFrozen(view.segments[0]), true);
  assert.throws(() => {
    view.segments[0].from = 0;
  }, TypeError);

  segments[0].from = 1;
  segments.push({ kind: 'unmapped', text: 'zzz' });
  assert.deepEqual(view.mapRange(0, 3), { status: 'mapped', originalStart: 0, originalEnd: 3 });
  assert.equal(view.utf16Length, 3);
});

test('declared pins and representation limits are exposed', () => {
  assert.equal(FRONTEND_PINS.version, '2.0.25');
  assert.equal(FRONTEND_PINS.kernel.sha256, '93c2a43deeb82c15683e4e25bbc5dec5ac3edff9f54e09acc0975e290fcaeb85');
  assert.equal(FRONTEND_PINS.main.sha256, '92dcdb49e82fd59443e3aea10784f7dcf03a93f5a21920666543098b657b6b1e');
  const codes = REPRESENTATION_LIMITS.map((limit) => limit.code);
  for (const required of ['utf16CodeUnits', 'callerSuppliedTransformation', 'noFilenameInference', 'noViewAuthority', 'loaderImportSpanWidth']) {
    assert.ok(codes.includes(required), required);
  }
  assert.equal(Object.isFrozen(REPRESENTATION_LIMITS), true);
});
