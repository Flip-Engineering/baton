# Bend2 source binding

A bridge support library that validates captured Bend2 frontend source bytes and converts frontend
source locations into original source identity. It is an isolated component: it imports nothing from
the coordinator, registers no provider, reads no file, scans no import, resolves no name and checks
no type. It grants no input authority. A caller supplies the admitted file identity, the exact
captured bytes and, when the frontend parsed a transformed string, the exact transformation
correspondence.

## Contract pins

| Artifact | Frontend path | SHA256 |
| --- | --- | --- |
| `bend-v2.0.25-kernel.ts` | `bend.ts` | `93c2a43deeb82c15683e4e25bbc5dec5ac3edff9f54e09acc0975e290fcaeb85` |
| `bend-v2.0.25-main.ts` | `main.ts` | `92dcdb49e82fd59443e3aea10784f7dcf03a93f5a21920666543098b657b6b1e` |

Frontend version 2.0.25. The pins are exported as `FRONTEND_PINS`.

Frontend facts this library relies on, with their kernel anchors:

- `Loc` is a UTF-16 code-unit index into a source string (`332`, `parse_peek` `1599`).
- `Span` is `{ src, beg, end }`, where `src` is source text rather than a path (`336`, `parse_span` `1590`).
- `parse_col` computes a one-based column as `pos - src.lastIndexOf("\n", pos - 1)` (`1586`).
- The loader reads the file as decoded UTF-8 text (`fs.readFileSync(file, "utf8")` `1057`) and splits
  that string on `"\n"` (`1058`), replaces each matched import line with the empty string (`1089`)
  and parses `lines.join("\n")` (`1097`). The import-line characters are removed and the newline
  separators remain.
- The loader's own import span is zero-width at the specifier start (`1065`).

The pins are a requirement on the input: a caller must supply bytes read from the frontend build
identified by these digests, and must supply the correspondence the pinned loader produced. The
library records the digest of the bytes it receives; it does not authenticate them and cannot verify
which frontend read them.

## Files and import closure

| File | Imports |
| --- | --- |
| `source-binding.mjs` | `node:crypto` |
| `source-binding.test.mjs` | `node:test`, `node:assert/strict`, `./source-binding.mjs` |
| `README.md` | none |

## API

- `captureSource({ identity, bytes })` returns a frozen capture `{ status: "captured", identity, digest, byteLength, utf16Length, text, frontend, byteOffsetForUtf16, utf16IndexForByteOffset }`, or `{ status: "unavailable", reason, detail? }`. One private snapshot of the input is copied before any derivation, decoded strictly and hashed, and then discarded: the capture retains the digest, the decoded text and the boundary maps, never the byte array. Shared-memory input is refused (`sharedBufferUnsupported`) because this component has no qualified synchronization contract for it. Decoding is strict UTF-8 with no BOM removal, no newline normalization and no replacement character. Strict decoding is a deliberate acceptance boundary for captured bytes and requires loader integration; it is not the behaviour of an ambient `fs` UTF-8 read.
- `decodeStrictUtf8(bytes)` validates its own byte domain and returns `bytesMissing` for anything that is not a `Uint8Array` and `sharedBufferUnsupported` for shared memory; otherwise it returns the decoded code points with their byte offsets, or a malformed-input outcome carrying the offending byte offset.
- `createView(capture, { segments })` returns a frozen view `{ status: "view", identity, digest, text, utf16Length, segments, mapRange }`. Each segment is `{ kind: "original", from, to }` (a UTF-16 range of the captured text kept verbatim) or `{ kind: "unmapped", text }` (transformed text with no original correspondence). Segments are ordered, may leave gaps, and must be nonempty.
- `view.mapRange(start, end)` returns `{ status: "mapped", originalStart, originalEnd }` or an unavailable outcome. It validates both mapped original endpoints against the capture boundary table before returning, so a surrogate-interior endpoint refuses here as well as in `locateSpan`.
- `locationOf(capture, index)` returns `{ status: "mapped", index, line, column, byteOffset }` with a zero-based line and the column of the frontend `parse_col` rule, whose edge at a leading line feed is declared below.
- `locateSpan(capture, view, span)` returns a frozen `{ status: "mapped", claim: "source-identity", identity, digest, text, original: { start, end }, byteRange: { start, end }, limits }` or an unavailable outcome. `span.src` is compared with the supplied view text to check the association; it never selects a file.
- `REPRESENTATION_LIMITS` lists the declared representation limits described below.

Unavailable reasons are `identityMissing`, `bytesMissing`, `sharedBufferUnsupported`, `captureUnavailable`, `segmentsMissing`, `segmentInvalid`, `segmentKindUnsupported`, `segmentsNotOrdered`, `emptySegment`, `emptyView`, `notInteger`, `outOfRange`, `reversedRange`, `surrogateInterior`, `byteInterior`, `unmappedSegment`, `unmappedBoundary`, `spansOmitted`, `viewUnavailable`, `viewCaptureMismatch`, `spanMissing`, `spanSourceMissing`, `sourceAssociationMismatch`, and the UTF-8 decoding reasons `unexpectedContinuation`, `truncatedSequence`, `invalidContinuation`, `overlongEncoding`, `surrogateEncoding`, `outOfRangeCodePoint`, `invalidStartByte`.

## Mapping model

Original UTF-16 indices and UTF-8 byte offsets are validated against each other at capture time.
A byte offset is defined only at a code-point boundary, and a UTF-16 index inside a surrogate pair is
refused. Line and column follow the frontend's own `parse_col` rule, which is `pos - src.lastIndexOf("\n", pos - 1)`
with the platform's `lastIndexOf` clamping: an ordinary line start yields column 1, and index 0 of
text that begins with a line feed yields column 0. The library reports the frontend formula rather
than a corrected one, and the edge is declared in `REPRESENTATION_LIMITS` and covered by a test.

A transformed view exists only for the correspondence the caller supplies. A range that lies inside
one original segment maps exactly; a range that crosses two original segments maps only when those
segments are adjacent in the original text; a range that crosses text left out of the transformed
string is unavailable (`spansOmitted`), and a range or point inside substituted text is unavailable
(`unmappedSegment`, `unmappedBoundary`). A zero-length point at a join between two segments maps to
the later segment by a stated right-affinity convention (`junctionRightAffinity`); that convention
places a frontend position, and it is not evidence of which side an arbitrary span originated on. A
missing association cannot be reconstructed from source strings, so it stays unavailable.

## Representation limits

`REPRESENTATION_LIMITS` declares: `utf16CodeUnits`, `lineZeroBasedColumnFollowsParseCol`,
`junctionRightAffinity`, `bytesNotRetained`, `codePointBoundaries`, `callerSuppliedTransformation`,
`noFilenameInference`, `noViewAuthority`, `loaderImportSpanWidth`, `noImportScanNoResolution`.

## Status and authority

A mapped result is a source-identity claim about the caller's captured bytes. It is not a checked or
proof verdict, and the library publishes no classification. The library grants no input authority:
the admitted identity and the transformation association come from the caller through a future
reviewed interface, and a view or a transformed string carries no authority over the bytes the
frontend consumed. The capture records the digest of the bytes the caller supplied; it does not
authenticate them and cannot establish which frontend read them. No pre/post digest comparison
happens here; capture verification belongs to the capture owner.

## Out of scope

This component does not implement: import scanning or import-range computation; name resolution,
type checking or any checker call; loader instrumentation or parse/check event hooks; capture
consistency verification; the common native declaration, selection, installation or invocation
caller; or the proposed common result/ref format migration. The full `Comp`, `Base` and runtime
closure, the loader instrumented bridge, declaration and event hooks, resolved checker context and
the admitted caller remain separate unqualified dependencies.

## Regression command

Authored for remote execution under exact Root admission:

```text
node --test bend2/context/bend2/source-binding.test.mjs
```

Covered areas: strict decoding and code-point byte offsets; identical text under two caller
identities with a foreign-view refusal; byte order mark retention; carriage-return preservation with
exact line and column; supplementary characters including direct surrogate-interior refusals from
`mapRange`; malformed UTF-8 with exact byte offsets; an import-blanked correspondence with mapped,
contiguous-join, junction-point and crossing-refusal outcomes; invalid, reversed, out-of-range and
noninteger boundaries; substituted text; caller-byte mutation; shared-memory refusal; decoder byte
domain validation; and the leading line-feed column edge.
