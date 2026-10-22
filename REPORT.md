# Literal-string match continuation sharing (#776/#900)

Candidate compiler: `compiler-src/bend2/` (copy of consumer 27629713, Bend 2.0.25).
Reference tree unchanged. No full Main, no recovery-helper build, no clang, no push.

## Candidate diff

Line numbers are the candidate's, against the reference `bend2/`.

`bend.ts`

- 322: `Case` gains `o?: Body`, the fallback row's stable origin.
- 338-346: `SHARES` (shared-term span registry) and `SHARE_TYPES` (checked
  goal type per shared term).
- 791: `term_higher` leaves an application of a `SHARES`-marked lambda
  unreduced.
- 2739: `body_sub` preserves `o`.
- 2754-2779: `Alt`, `patt_ground`, and `match_flatten`'s `alts` parameter.
- 2809-2810: variable column preserves the row origin and passes `alts`.
- 2834-2907: constructor split. Rows created by `ps` carry origins; the
  fallback rows `ds` are compared with the enclosing splits' rows; on a match
  the default is a wrapper that rebuilds the enclosing constructor value from
  the current column and the ground fields, applies the shared term to it and
  the outer rest, and is marked with a sentinel span; the split registers a
  new `Alt`.
- 3783-3788: the match check records the default arm's goal type against the
  default term's sentinel.
- 3536-3543: `term_infer` infers a shared application from its reduced form.
- 3832-3862: `term_check` checks a shared application from its reduced form
  and keeps the application, with the shared head annotated by `SHARE_TYPES`.

`comp.ts`

- 122-125: `File.clom`.
- 1608-1610: `file_new` initializes `clom`.
- 2337-2364: `emit_clo` memoizes the segment by sentinel span and ordered
  capture layout; each copy allocates its own closure over that segment.
- 2496-2505, 2575-2584: `emit_expr` and `emit_body` resolve a null type for a
  `SHARE_TYPES` lambda.
- 2937-2939: `compile_def` clears `clom`.

The `bend.ts` and `comp.ts` changes are semantic. Temporary tracing was
removed before these runs; `compiler-src/debug_flat.ts` is scratch and is not
part of the compiler.

## Check-only

| fixture | result |
| --- | --- |
| `fixtures/dispatch_literal.bend` (21-character literal plus 2/13/4-element siblings) | pass |
| `tests/flatten/dead_residue_elision_004.bend` | pass |
| `tests/compile/string_match_sparse.bend` | pass |

## Same-source measurement

Focused fixture: `fixtures/dispatch_literal.bend`.

| compiler | C bytes | wall | max RSS | WL_CASE |
| --- | ---: | ---: | ---: | ---: |
| unmodified consumer 27629713 | 202750 | 4.29 s | 311672 KiB | 7 |
| candidate | not produced | 7.04 s | 612180 KiB | not produced |

The candidate exits 1 during C emission with `an untyped cut`
(`comp.ts:1397`, `anf`). No `after.c` exists.

## Blocker

The shared continuation is applied at a default branch whose checked goal type
is the refined datatype (the datatype minus the matched constructor). The
checker accepts the reconstructed value because the layout of the refined and
full datatypes is the same, and C emission passes the earlier `an untyped
binder` failure after the lambda type is resolved from `SHARE_TYPES`.
`anf` still needs the application's result type at the deeper default site,
and that type is not carried by the term there. The remaining work is to carry
the result type to the shared application, or to move the sharing from the
term into emission.

## RESULTS.json

Not written. `after_c_bytes` is not measurable for this candidate, and a
results record with a substituted value would misstate the proof.
