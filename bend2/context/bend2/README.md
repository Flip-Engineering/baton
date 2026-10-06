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
- The loader reads bytes (`fs.readFileSync(file, "utf8")` `1057`), splits on `"\n"` (`1058`),
  replaces each matched import line with the empty string (`1089`) and parses `lines.join("\n")`
  (`1097`). The import-line characters are removed and the newline separators remain.
- The loader's own import span is zero-width at the specifier start (`1065`).

## Files and import closure

| File | Imports |
| --- | --- |
| `source-binding.mjs` | `node:crypto` |
| `source-binding.test.mjs` | `node:test`, `node:assert/strict` |
| `README.md` | none |

## API

- `captureSource({ identity, bytes })` returns a frozen capture `{ status: "captured", identity, digest, byteLength, utf16Length, text, frontend, byteOffsetForUtf16, utf16IndexForByteOffset }`, or `{ status: "unavailable", reason, detail? }`. Decoding is strict UTF-8 with no BOM removal, no newline normalization and no replacement character; the digest is SHA-256 over the captured bytes, which are held privately.
- `createView(capture, { segments })` returns a frozen view `{ status: "view", identity, digest, text, utf16Length, segments, mapRange }`. Each segment is `{ kind: "original", from, to }` (a UTF-16 range of the captured text kept verbatim) or `{ kind: "unmapped", text }` (transformed text with no original correspondence). Segments are ordered, may leave gaps, and must be nonempty.
- `view.mapRange(start, end)` returns `{ status: "mapped", originalStart, originalEnd }` or an unavailable outcome.
- `locationOf(capture, index)` returns `{ status: "mapped", index, line, column, byteOffset }` with a zero-based line and one-based column.
- `locateSpan(capture, view, span)` returns a frozen `{ status: "mapped", claim: "source-identity", identity, digest, text, original: { start, end }, byteRange: { start, end }, limits }` or an unavailable outcome. `span.src` is compared with the supplied view text to check the association; it never selects a file.
- `decodeStrictUtf8(bytes)` returns the decoded code points with their byte offsets, or an unavailable outcome carrying the offending byte offset.
- `REPRESENTATION_LIMITS` lists the declared representation limits described below.

Unavailable reasons are `identityMissing`, `bytesMissing`, `captureUnavailable`, `segmentsMissing`, `segmentInvalid`, `segmentKindUnsupported`, `segmentsNotOrdered`, `emptySegment`, `emptyView`, `notInteger`, `outOfRange`, `reversedRange`, `surrogateInterior`, `byteInterior`, `unmappedSegment`, `unmappedBoundary`, `spansOmitted`, `viewUnavailable`, `viewCaptureMismatch`, `spanMissing`, `spanSourceMissing`, `sourceAssociationMismatch`, and the UTF-8 decoding reasons `unexpectedContinuation`, `truncatedSequence`, `invalidContinuation`, `overlongEncoding`, `surrogateEncoding`, `outOfRangeCodePoint`, `invalidStartByte`.

## Mapping model

Original UTF-16 indices and UTF-8 byte offsets are validated against each other at capture time.
A byte offset is defined only at a code-point boundary, and a UTF-16 index inside a surrogate pair is
refused. Line and column follow the frontend's own `parse_col` rule, so a location states the
zero-based line and the one-based UTF-16 column of the original file.

A transformed view exists only for the correspondence the caller supplies. A range that lies inside
one original segment maps exactly; a range that crosses two original segments maps only when those
segments are adjacent in the original text; a range that crosses text left out of the transformed
string is unavailable (`spansOmitted`), and a range or point inside substituted text is unavailable
(`unmappedSegment`, `unmappedBoundary`). A zero-length point at a join between two segments maps to
the start of the later segment.

## Representation limits

`REPRESENTATION_LIMITS` declares: `utf16CodeUnits`, `lineZeroBasedColumnOneBased`,
`codePointBoundaries`, `callerSuppliedTransformation`, `noFilenameInference`, `noViewAuthority`,
`loaderImportSpanWidth`, `noImportScanNoResolution`.

## Status and authority

A mapped result is a source-identity claim about the caller's captured bytes. It is not a checked or
proof verdict, and the library publishes no classification. The library grants no input authority:
the admitted identity and the transformation association come from the caller through a future
reviewed interface, and a view or a transformed string carries no authority over the bytes the
frontend consumed. No pre/post digest comparison happens here; capture verification belongs to the
capture owner.

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
