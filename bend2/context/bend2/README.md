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
- `parse_col` computes a column as `pos - src.lastIndexOf("\n", pos - 1)` (`1586`); that yields 1 at an ordinary line start and 0 at index 0 of text beginning with a line feed, because the platform `lastIndexOf` clamps its search position.
- The loader reads the file as decoded UTF-8 text (`fs.readFileSync(file, "utf8")` `1057`) and splits
  that string on `"\n"` (`1058`), replaces each matched import line with the empty string (`1089`)
  and parses `lines.join("\n")` (`1097`). The import-line characters are removed and the newline
  separators remain.
- The loader's own import span is zero-width at the specifier start (`1065`).

The pins constrain the compatible frontend implementation and the transformation observed in it: a
caller must supply the correspondence that this pinned loader produced. Capture identity and digest
refer to the target source bytes the caller supplies, which are not frontend artifact bytes. The
library records the digest of those bytes; it does not authenticate them and cannot verify which
frontend read them.

## Files and import closure

| File | Imports |
| --- | --- |
| `source-binding.mjs` | `node:crypto` |
| `frontend-hook-events.mjs` | none |
| `frontend-adapter.mjs` | `./source-binding.mjs`, `./frontend-hook-events.mjs` |
| `frontend-hooks.mjs` | `node:crypto` |
| `source-binding.test.mjs` | `node:test`, `node:assert/strict`, `./source-binding.mjs` |
| `frontend-adapter.test.mjs` | `node:test`, `node:assert/strict`, `./frontend-adapter.mjs`, `./frontend-hook-events.mjs`, `./frontend-hooks.mjs` |
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

## Producer hooks and adapter

`frontend-hooks.mjs` is the retained patch. It carries no frontend source and imports no frontend:
it applies an ordered set of anchored operations to a caller-supplied copy of an upstream file and
returns the derived text, the applied operation ids and the output digest. Every anchor must occur
exactly once, so a missing or ambiguous anchor refuses the derivation instead of producing a
partially hooked file. `verifyHookAnchors` reports the counts without deriving anything.

Upstream inputs, retrieved read-only from the repository's documented pin
`a49524265bdfa5753a4bf38e25f0574a705dd868` under the Apache-2.0 license (HigherOrderCO 2026):

| File | SHA256 |
| --- | --- |
| `bend2/bend.ts` | `93c2a43deeb82c15683e4e25bbc5dec5ac3edff9f54e09acc0975e290fcaeb85` |
| `bend2/main.ts` | `92dcdb49e82fd59443e3aea10784f7dcf03a93f5a21920666543098b657b6b1e` |
| `bend2/comp.ts` | `ad8b82137e5decf588d507d008cb8ccf24bd0b94043de8bd6e048d0faedcf959` |
| `bend2/base.bend` | `e5639663177f2de93ef34867c029698aa4e68a98d46629f0b15452b67b99d798` |
| `LICENSE` | `0beb288abd3d067e231f3fbe7df1f8ee37344061fc67f22018150a19e4b26c35` |

The upstream originals stay intact. The derived copy is an owned artifact of this task, identified by
its upstream input digest and its own output digest; nothing here writes to an upstream file.

Operations cover the real statements: the hook registry and emit helper; the hook-aware source read
where the loader consumes input (`bend.ts` 1057); the hub-fetch guard in capture-only mode (1030);
the import-line removal with its exact removed range (1089) and the alias table and load completion
at the parse call (1097); the file identity carried on the `Parse` record and through `parse_book`;
declaration events for `def`, law-fill, `type` and `law`; parse-time reference events for the bound,
dotted and unbound-fallback branches of `parse_var`; the parse diagnostic; the `Err` constructor;
checker entry, success and failure around `def_check`; the `book_valid` start and its successful
exit; and in `main.ts` the PROOF/LAWS gate, the ownership gate around `Comp.book_owned(book,
Comp.SYNTH)`, and the incomplete-proof text diagnostic thrown as its original string.

`frontend-adapter.mjs` installs the sink the patched frontend calls and turns those events into
source-identity records by driving `source-binding.mjs`. It never parses, resolves, checks, fetches
or writes. Its behaviour:

- source capture happens at `readSource`, the same call the loader uses for its text, so the captured
  bytes are the consumed bytes; a file the caller did not capture is refused with an explicit
  `uncapturedDependency` limitation, and in capture-only mode the patched loader raises its own
  missing-file diagnostic instead of reading the host;
- captures, views and pending transformations are query-local: a later query acquires its bytes
  again and never reuses a stale capture;
- every span is attributed by the file the frontend reported for it, never by matching source text,
  and a span the frontend did not supply stays `missingSpan`; a span that crosses removed import
  text stays `spansOmitted`;
- parse references record their actual branch, binder index or frame index, and are marked
  `resolved: false` with basis `parseOutcome`;
- checker failures and completion gates are recorded as phase observations; no proved-law claim is
  made, and hook or adapter failures are counted separately from frontend diagnostics.

Derive a hooked copy (remote, exact Root admission):

```text
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; import { deriveHookedSource } from './bend2/context/bend2/frontend-hooks.mjs'; const text = readFileSync(process.env.BATON2_FRONTEND_BEND, 'utf8'); const derived = deriveHookedSource({ target: 'bend', text }); if (derived.status !== 'derived') { throw new Error(JSON.stringify(derived)); } writeFileSync(process.env.BATON2_DERIVED_BEND, derived.text); console.log(derived.outputDigest);"
```

`deriveHookedSource` hashes the supplied text and refuses `inputIdentityMismatch` unless it equals the
pinned digest for that target, so an alteration outside the anchors cannot pass under the original
pin. `applyHookOperations` exposes the anchor mechanics alone for tests.

The internal invocation entry installs the scoped producer, loads a caller-supplied closure, calls
the frontend's actual parser, checker and completion primitives for the requested phases, and returns
the observations plus the raw outcome, restoring the hooks in `finally`:

```text
node --test bend2/context/bend2/frontend-adapter.test.mjs
```

Its prerequisite for a real run: a derived frontend module (from the derivation command above, for
`bend` and `main`), the supplied `comp.ts` module for the completion phase, and Node 22.15.0 or
later. The `bend` module needs `bend.ts`'s exports plus, for the completion phase, `main.ts`'s
composition; a run that only parses needs no completion module.

The same command with `target: 'main'` derives the main-side hooks. The hooks are inert until a caller
installs the sink with `bendHooks(...)`; no module in this repository imports a frontend, and no
frontend behaviour changes when the sink is absent or declines.

Remaining: the `comp.ts` `book_owned` entry and throw detail (its exact anchor text is not yet read,
so no replacement is guessed), the admitted selected-step invocation ABI and its native export, the
`BASE_BEND` import-time realpath (a captured base must arrive through acquisition; suppressing the
import-time access needs a bootstrap or a lazy accessor with its main caller updated), and all
runtime, deployment and semantic-equivalence qualification.

## Regression command

Authored for remote execution under exact Root admission:

```text
node --test bend2/context/bend2/source-binding.test.mjs
node --test bend2/context/bend2/frontend-adapter.test.mjs
```

Covered areas: strict decoding and code-point byte offsets; identical text under two caller
identities with a foreign-view refusal; byte order mark retention; carriage-return preservation with
exact line and column; supplementary characters including direct surrogate-interior refusals from
`mapRange`; malformed UTF-8 with exact byte offsets; an import-blanked correspondence with mapped,
contiguous-join, junction-point and crossing-refusal outcomes; invalid, reversed, out-of-range and
noninteger boundaries; substituted text; caller-byte mutation; shared-memory refusal; decoder byte
domain validation; and the leading line-feed column edge.
