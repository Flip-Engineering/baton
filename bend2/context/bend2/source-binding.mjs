// Source binding for the Bend2 frontend bridge.
//
// This is an isolated support library. It imports nothing from the coordinator, registers no
// provider, reads no file, scans no import, resolves no name and checks no type. A caller supplies
// captured exact bytes, the file identity that admission recorded, and (when the frontend parsed a
// transformed string) the exact transformation correspondence. The library returns source identity
// and checked location conversion, or an explicit unavailable outcome with its actual reason.
//
// Pinned frontend, inspected by direct byte read (frontend version 2.0.25):
//   kernel artifact bend-v2.0.25-kernel.ts (frontend path bend.ts)
//     SHA256 93c2a43deeb82c15683e4e25bbc5dec5ac3edff9f54e09acc0975e290fcaeb85
//   main artifact bend-v2.0.25-main.ts (frontend path main.ts)
//     SHA256 92dcdb49e82fd59443e3aea10784f7dcf03a93f5a21920666543098b657b6b1e
//
// Frontend facts this module relies on, with their anchors in the kernel:
//   Loc is a UTF-16 code-unit index into a source string (332, parse_peek 1599).
//   Span is { src: string, beg: Loc, end: Loc }; src is source text, not a path (336, 1590).
//   parse_col computes a column as pos - src.lastIndexOf("\n", pos - 1) (1586); that yields 1 at
//     an ordinary line start and 0 at index 0 of text beginning with a line feed, because the
//     platform lastIndexOf clamps its search position.
//   The loader reads the file as decoded UTF-8 text (fs.readFileSync(file, "utf8"), 1057), splits
//     that string on "\n" (1058),
//   replaces each matched import line with the empty string (1089) and parses lines.join("\n")
//   (1097). The transformation is therefore a removal of the import-line characters with the
//   newline separators retained; this module never recomputes it, it consumes the caller's
//   exact correspondence. The loader's own import span is zero-width at the specifier start
//   (1065), so a caller needing a width must compute it from captured text.
//
// Representation limits are exported in REPRESENTATION_LIMITS and repeated in the README.

import { createHash } from 'node:crypto';

export const FRONTEND_PINS = Object.freeze({
  version: '2.0.25',
  kernel: Object.freeze({
    artifact: 'bend-v2.0.25-kernel.ts',
    frontendPath: 'bend.ts',
    sha256: '93c2a43deeb82c15683e4e25bbc5dec5ac3edff9f54e09acc0975e290fcaeb85',
  }),
  main: Object.freeze({
    artifact: 'bend-v2.0.25-main.ts',
    frontendPath: 'main.ts',
    sha256: '92dcdb49e82fd59443e3aea10784f7dcf03a93f5a21920666543098b657b6b1e',
  }),
});

export const REPRESENTATION_LIMITS = Object.freeze([
  Object.freeze({
    code: 'utf16CodeUnits',
    detail: 'indices, columns and frontend Loc are UTF-16 code units of the captured source',
  }),
  Object.freeze({
    code: 'lineZeroBasedColumnFollowsParseCol',
    detail: 'line is zero-based; column is pos - src.lastIndexOf("\\n", pos - 1) exactly as parse_col, which yields 1 at an ordinary line start and 0 at index 0 of text that begins with a line feed',
  }),
  Object.freeze({
    code: 'junctionRightAffinity',
    detail: 'a zero-length point at a join between two segments maps to the later segment; that is a mapping convention for a frontend position, not evidence of which side an arbitrary span originated on',
  }),
  Object.freeze({
    code: 'bytesNotRetained',
    detail: 'the capture retains the digest and the derived text and maps; the private byte snapshot taken for decoding and hashing is discarded',
  }),
  Object.freeze({
    code: 'codePointBoundaries',
    detail: 'a byte offset is defined only at a code-point boundary; an interior continuation byte or a trailing surrogate index is refused',
  }),
  Object.freeze({
    code: 'callerSuppliedTransformation',
    detail: 'a transformed view exists only for the segments the caller supplies; removed or substituted text yields unavailable, never a guessed offset',
  }),
  Object.freeze({
    code: 'noFilenameInference',
    detail: 'a frontend Span.src is checked against the supplied view; it never names the file, which comes only from the caller identity',
  }),
  Object.freeze({
    code: 'noViewAuthority',
    detail: 'a view carries no consumed-byte authority; every identity claim names the capture digest of the captured bytes',
  }),
  Object.freeze({
    code: 'loaderImportSpanWidth',
    detail: 'the pinned loader records zero-width import spans at the specifier start; a width requires caller computation from captured text',
  }),
  Object.freeze({
    code: 'noImportScanNoResolution',
    detail: 'this component does not scan imports, resolve names, check types or verify capture consistency',
  }),
]);

function unavailable(reason, detail) {
  if (detail === undefined) return Object.freeze({ status: 'unavailable', reason });
  return Object.freeze({ status: 'unavailable', reason, detail });
}

function isCapture(value) {
  return value !== null && typeof value === 'object' && value.status === 'captured';
}

function isView(value) {
  return value !== null && typeof value === 'object' && value.status === 'view';
}

function isContinuation(byte) {
  return byte >= 0x80 && byte <= 0xbf;
}

// Strict UTF-8 decoding. No BOM removal, no normalization, no replacement character: an invalid
// sequence is an outcome with the offending byte offset. The code-point byte lengths are returned
// so the caller can build validated UTF-16/byte mappings.
export function decodeStrictUtf8(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    return unavailable('bytesMissing', { detail: 'exact captured bytes are required' });
  }
  if (typeof SharedArrayBuffer !== 'undefined' && bytes.buffer instanceof SharedArrayBuffer) {
    return unavailable('sharedBufferUnsupported', { detail: 'shared memory has no qualified synchronization contract' });
  }
  const codePoints = [];
  const codePointByteOffsets = [];
  let index = 0;
  while (index < bytes.length) {
    const start = index;
    const first = bytes[index];
    let codePoint;
    let length;
    if (first <= 0x7f) {
      codePoint = first;
      length = 1;
    } else if (first >= 0x80 && first <= 0xbf) {
      return unavailable('unexpectedContinuation', { byteOffset: start });
    } else if (first === 0xc0 || first === 0xc1) {
      return unavailable('overlongEncoding', { byteOffset: start });
    } else if (first >= 0xc2 && first <= 0xdf) {
      length = 2;
      if (start + length > bytes.length) return unavailable('truncatedSequence', { byteOffset: start });
      const b1 = bytes[start + 1];
      if (!isContinuation(b1)) return unavailable('invalidContinuation', { byteOffset: start + 1 });
      codePoint = ((first & 0x1f) << 6) | (b1 & 0x3f);
    } else if (first >= 0xe0 && first <= 0xef) {
      length = 3;
      if (start + length > bytes.length) return unavailable('truncatedSequence', { byteOffset: start });
      const b1 = bytes[start + 1];
      const b2 = bytes[start + 2];
      if (!isContinuation(b1)) return unavailable('invalidContinuation', { byteOffset: start + 1 });
      if (!isContinuation(b2)) return unavailable('invalidContinuation', { byteOffset: start + 2 });
      if (first === 0xe0 && b1 < 0xa0) return unavailable('overlongEncoding', { byteOffset: start });
      if (first === 0xed && b1 > 0x9f) return unavailable('surrogateEncoding', { byteOffset: start });
      codePoint = ((first & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
    } else if (first >= 0xf0 && first <= 0xf4) {
      length = 4;
      if (start + length > bytes.length) return unavailable('truncatedSequence', { byteOffset: start });
      const b1 = bytes[start + 1];
      const b2 = bytes[start + 2];
      const b3 = bytes[start + 3];
      if (!isContinuation(b1)) return unavailable('invalidContinuation', { byteOffset: start + 1 });
      if (!isContinuation(b2)) return unavailable('invalidContinuation', { byteOffset: start + 2 });
      if (!isContinuation(b3)) return unavailable('invalidContinuation', { byteOffset: start + 3 });
      if (first === 0xf0 && b1 < 0x90) return unavailable('overlongEncoding', { byteOffset: start });
      if (first === 0xf4 && b1 > 0x8f) return unavailable('outOfRangeCodePoint', { byteOffset: start });
      codePoint = ((first & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
    } else {
      return unavailable('invalidStartByte', { byteOffset: start });
    }
    codePoints.push(codePoint);
    codePointByteOffsets.push(start);
    index += length;
  }
  return Object.freeze({
    status: 'decoded',
    codePoints: Object.freeze(codePoints),
    codePointByteOffsets: Object.freeze(codePointByteOffsets),
  });
}

// Capture the exact bytes a caller read from admission. One private snapshot is copied before any
// derivation, decoded strictly and hashed; the snapshot is then discarded, so no caller can mutate
// the identity after capture and no byte array is retained. The decoded text retains a byte order
// mark, carriage returns and every other code point.
export function captureSource({ identity, bytes } = {}) {
  if (typeof identity !== 'string' || identity.length === 0) {
    return unavailable('identityMissing', { detail: 'a file identity from admission is required' });
  }
  if (!(bytes instanceof Uint8Array)) {
    return unavailable('bytesMissing', { detail: 'exact captured bytes are required' });
  }
  if (typeof SharedArrayBuffer !== 'undefined' && bytes.buffer instanceof SharedArrayBuffer) {
    return unavailable('sharedBufferUnsupported', { detail: 'shared memory has no qualified synchronization contract' });
  }
  // One private snapshot is taken before any derivation, so a caller that keeps writing to its own
  // view cannot mix the decoded text with the digest. Every derived field reads that snapshot, and
  // the snapshot is discarded once the capture is built.
  const snapshot = new Uint8Array(bytes.length);
  snapshot.set(bytes);
  const decoded = decodeStrictUtf8(snapshot);
  if (decoded.status !== 'decoded') return decoded;

  const byteLength = snapshot.length;
  let utf16Length = 0;
  for (const codePoint of decoded.codePoints) utf16Length += codePoint > 0xffff ? 2 : 1;

  const utf16ToByte = new Array(utf16Length + 1).fill(-1);
  const byteToUtf16 = new Array(byteLength + 1).fill(-1);
  let utf16Index = 0;
  for (let i = 0; i < decoded.codePoints.length; i += 1) {
    const byteOffset = decoded.codePointByteOffsets[i];
    utf16ToByte[utf16Index] = byteOffset;
    byteToUtf16[byteOffset] = utf16Index;
    utf16Index += decoded.codePoints[i] > 0xffff ? 2 : 1;
  }
  utf16ToByte[utf16Length] = byteLength;
  byteToUtf16[byteLength] = utf16Length;

  // Build the text in bounded chunks: a whole-file argument spread would exceed the engine's
  // argument limit on a real source file.
  const parts = [];
  let chunk = [];
  const flush = () => {
    if (chunk.length > 0) {
      parts.push(String.fromCharCode(...chunk));
      chunk = [];
    }
  };
  for (const codePoint of decoded.codePoints) {
    if (codePoint <= 0xffff) {
      chunk.push(codePoint);
    } else {
      const value = codePoint - 0x10000;
      chunk.push(0xd800 + (value >> 10));
      chunk.push(0xdc00 + (value & 0x3ff));
    }
    if (chunk.length >= 4096) flush();
  }
  flush();
  const text = parts.join('');

  const digest = createHash('sha256').update(snapshot).digest('hex');
  const byteOffsetForUtf16 = (index) => {
    if (!Number.isInteger(index)) return unavailable('notInteger');
    if (index < 0 || index > utf16Length) return unavailable('outOfRange');
    const offset = utf16ToByte[index];
    if (offset < 0) return unavailable('surrogateInterior');
    return Object.freeze({ status: 'mapped', byteOffset: offset });
  };
  const utf16IndexForByteOffset = (byteOffset) => {
    if (!Number.isInteger(byteOffset)) return unavailable('notInteger');
    if (byteOffset < 0 || byteOffset > byteLength) return unavailable('outOfRange');
    const index = byteToUtf16[byteOffset];
    if (index < 0) return unavailable('byteInterior');
    return Object.freeze({ status: 'mapped', utf16Index: index });
  };

  return Object.freeze({
    status: 'captured',
    identity,
    digest,
    byteLength,
    utf16Length,
    text,
    frontend: FRONTEND_PINS,
    byteOffsetForUtf16,
    utf16IndexForByteOffset,
  });
}

function segmentTable(capture, segments) {
  const table = [];
  let transformedLength = 0;
  let previousOriginalTo = null;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment === null || typeof segment !== 'object') return unavailable('segmentInvalid');
    if (segment.kind === 'original') {
      const from = segment.from;
      const to = segment.to;
      if (!Number.isInteger(from) || !Number.isInteger(to)) return unavailable('notInteger');
      if (from < 0 || to > capture.utf16Length) return unavailable('outOfRange');
      if (to < from) return unavailable('reversedRange');
      if (to === from) {
        return unavailable('emptySegment', { detail: 'an empty segment is not a mapping boundary' });
      }
      if (previousOriginalTo !== null && from < previousOriginalTo) {
        return unavailable('segmentsNotOrdered');
      }
      const fromByte = capture.byteOffsetForUtf16(from);
      if (fromByte.status !== 'mapped') return fromByte;
      const toByte = capture.byteOffsetForUtf16(to);
      if (toByte.status !== 'mapped') return toByte;
      table.push(
        Object.freeze({
          kind: 'original',
          transformedStart: transformedLength,
          transformedEnd: transformedLength + (to - from),
          originalFrom: from,
          originalTo: to,
        }),
      );
      transformedLength += to - from;
      previousOriginalTo = to;
      continue;
    }
    if (segment.kind === 'unmapped') {
      if (typeof segment.text !== 'string') return unavailable('segmentInvalid');
      if (segment.text.length === 0) {
        return unavailable('emptySegment', { detail: 'an empty segment is not a mapping boundary' });
      }
      table.push(
        Object.freeze({
          kind: 'unmapped',
          transformedStart: transformedLength,
          transformedEnd: transformedLength + segment.text.length,
          text: segment.text,
        }),
      );
      transformedLength += segment.text.length;
      continue;
    }
    return unavailable('segmentKindUnsupported');
  }
  return Object.freeze({ table: Object.freeze(table), transformedLength });
}

function locateSegment(table, index) {
  for (let i = 0; i < table.length; i += 1) {
    const segment = table[i];
    if (index >= segment.transformedStart && index < segment.transformedEnd) {
      return Object.freeze({ status: 'located', index: i });
    }
  }
  return unavailable('outOfRange');
}

// A mapped range is validated against the capture boundary table before it is returned, so the
// public mapRange contract refuses a surrogate-interior endpoint on its own.
function validatedPoint(capture, originalStart, originalEnd) {
  const startBoundary = capture.byteOffsetForUtf16(originalStart);
  if (startBoundary.status !== 'mapped') return startBoundary;
  const endBoundary = capture.byteOffsetForUtf16(originalEnd);
  if (endBoundary.status !== 'mapped') return endBoundary;
  return mappedPoint(originalStart, originalEnd);
}

function mapRange(capture, table, transformedLength, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return unavailable('notInteger');
  if (end < start) return unavailable('reversedRange');
  if (start < 0 || end > transformedLength) return unavailable('outOfRange');

  if (start === end) {
    if (start === transformedLength) {
      const last = table[table.length - 1];
      if (last === undefined) return unavailable('emptyView');
      if (last.kind !== 'original') return unavailable('unmappedBoundary');
      return validatedPoint(capture, last.originalTo, last.originalTo);
    }
    const located = locateSegment(table, start);
    if (located.status !== 'located') return located;
    const segment = table[located.index];
    if (segment.kind !== 'original') return unavailable('unmappedBoundary');
    const originalIndex = segment.originalFrom + (start - segment.transformedStart);
    return validatedPoint(capture, originalIndex, originalIndex);
  }

  const first = locateSegment(table, start);
  if (first.status !== 'located') return first;
  const last = locateSegment(table, end - 1);
  if (last.status !== 'located') return last;
  for (let i = first.index; i <= last.index; i += 1) {
    const segment = table[i];
    if (segment.kind !== 'original') {
      if (first.index === last.index) {
        return unavailable('unmappedSegment', { detail: 'the range lies inside text with no original correspondence' });
      }
      return unavailable('spansOmitted', { detail: 'a removed or substituted piece lies inside the range' });
    }
    if (i > first.index) {
      const previous = table[i - 1];
      if (previous.originalTo !== segment.originalFrom) {
        return unavailable('spansOmitted', { detail: 'the range crosses text left out of the transformed string' });
      }
    }
  }
  const firstSegment = table[first.index];
  const lastSegment = table[last.index];
  const originalStart = firstSegment.originalFrom + (start - firstSegment.transformedStart);
  const originalEnd = lastSegment.originalFrom + (end - lastSegment.transformedStart);
  return validatedPoint(capture, originalStart, originalEnd);
}

function mappedPoint(originalStart, originalEnd) {
  return Object.freeze({ status: 'mapped', originalStart, originalEnd });
}

// Build the transformed string the frontend actually parsed, from the caller's exact correspondence.
export function createView(capture, { segments } = {}) {
  if (!isCapture(capture)) return unavailable('captureUnavailable');
  if (!Array.isArray(segments)) return unavailable('segmentsMissing');
  const built = segmentTable(capture, segments);
  if (built.table === undefined) return built;
  const table = built.table;
  const pieces = [];
  for (const segment of table) {
    pieces.push(segment.kind === 'original' ? capture.text.slice(segment.originalFrom, segment.originalTo) : segment.text);
  }
  const text = pieces.join('');
  const identity = capture.identity;
  const digest = capture.digest;
  const utf16Length = built.transformedLength;
  return Object.freeze({
    status: 'view',
    identity,
    digest,
    text,
    utf16Length,
    segments: table,
    mapRange: (start, end) => mapRange(capture, table, utf16Length, start, end),
  });
}

// Decode a Core capture record into the exact accepted bytes.
//
// The record's payload_encoding must name a lossless byte-exact encoding of the accepted bytes, so a
// byte order mark, a carriage return or a byte that is not valid UTF-8 survives. A payload that does
// not reproduce byte for byte is refused rather than re-encoded. Nothing here authenticates the bytes:
// the marker is returned for the caller to compare, and a comparison is not custody.
export function decodeCoreCapture(record) {
  if (record === null || typeof record !== 'object') return unavailable('captureRecordMissing');
  const kind = record.capture_kind;
  if (kind === 'absent') return Object.freeze({ status: 'absent' });
  if (kind !== 'file' && kind !== 'dir' && kind !== 'link' && kind !== 'config') {
    return unavailable('captureKindUnsupported', typeof kind === 'string' ? kind : 'missing');
  }
  const payload = record.payload;
  const encoding = record.payload_encoding;
  if (typeof payload !== 'string') return unavailable('payloadMissing');
  const marker = typeof record.marker === 'string' ? record.marker : null;
  if (encoding === 'base64') {
    if (payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return unavailable('payloadEncodingInvalid', 'base64');
    const bytes = Buffer.from(payload, 'base64');
    if (bytes.toString('base64') !== payload) return unavailable('payloadNotRoundTrip', 'base64');
    return Object.freeze({ status: 'bytes', bytes, marker, kind });
  }
  if (encoding === 'hex') {
    if (payload.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(payload)) return unavailable('payloadEncodingInvalid', 'hex');
    const bytes = Buffer.from(payload, 'hex');
    if (bytes.toString('hex') !== payload.toLowerCase()) return unavailable('payloadNotRoundTrip', 'hex');
    return Object.freeze({ status: 'bytes', bytes, marker, kind });
  }
  return unavailable('payloadEncodingUnsupported', typeof encoding === 'string' ? encoding : 'missing');
}

// The zero-based line and the parse_col column of a validated original index; following parse_col,
// the column is 0 at index 0 of text that begins with a line feed.
export function locationOf(capture, index) {
  if (!isCapture(capture)) return unavailable('captureUnavailable');
  const bytes = capture.byteOffsetForUtf16(index);
  if (bytes.status !== 'mapped') return bytes;
  const column = index - capture.text.lastIndexOf('\n', index - 1);
  let line = 0;
  for (let i = capture.text.indexOf('\n'); i !== -1 && i < index; i = capture.text.indexOf('\n', i + 1)) {
    line += 1;
  }
  return Object.freeze({ status: 'mapped', index, line, column, byteOffset: bytes.byteOffset });
}

// Convert one frontend Span into original source identity and location. Span.src is used only to
// check that the span belongs to the supplied view; it never selects a file.
export function locateSpan(capture, view, span) {
  if (!isCapture(capture)) return unavailable('captureUnavailable');
  if (!isView(view)) return unavailable('viewUnavailable');
  if (view.identity !== capture.identity || view.digest !== capture.digest) {
    return unavailable('viewCaptureMismatch');
  }
  if (span === null || typeof span !== 'object') return unavailable('spanMissing');
  if (typeof span.src !== 'string') return unavailable('spanSourceMissing');
  if (span.src !== view.text) return unavailable('sourceAssociationMismatch');

  const mapped = view.mapRange(span.beg, span.end);
  if (mapped.status !== 'mapped') return mapped;
  const start = locationOf(capture, mapped.originalStart);
  if (start.status !== 'mapped') return start;
  const end = locationOf(capture, mapped.originalEnd);
  if (end.status !== 'mapped') return end;

  return Object.freeze({
    status: 'mapped',
    claim: 'source-identity',
    identity: capture.identity,
    digest: capture.digest,
    text: capture.text.slice(mapped.originalStart, mapped.originalEnd),
    original: Object.freeze({
      start: Object.freeze({ index: start.index, line: start.line, column: start.column }),
      end: Object.freeze({ index: end.index, line: end.line, column: end.column }),
    }),
    byteRange: Object.freeze({ start: start.byteOffset, end: end.byteOffset }),
    limits: REPRESENTATION_LIMITS,
  });
}
