# Codec qualification review, 2026-10-06

Basis: root source at `a583742d` (`04d80837` in history) in
`/Users/wahargis/Development/Experiments/baton-integration-20261006`.
Read-only review; no compilation, no tests, no builds launched from
this lane. The root codec qualification job at
`/home/atari2036/baton-context-root-fa89b203/codec-qualification` is
active and was not touched; only its directory listing and file
timestamps were observed. No candidate output bytes were read.

## Admission verification

- `bend2/src/context/codec.expected.txt` is byte-identical to the
  pre-execution proposal; `bend2/src/context/operations.expected.txt`
  is byte-identical to the reviewed `/private/tmp` proposal.
- The admitted rendering document keeps every proposed rule and adds
  the operations selector section plus the review-before-comparison
  requirement. Admission commit `c381cf1b` adds exactly those three
  files (+82/-0).
- Codec `main`, its samples, and the renderers are unchanged from
  `642d30ca` to HEAD (no added/removed print, envelope, or dispatch
  lines); the operations printer, samples, and headers are likewise
  untouched. The admitted bytes still match current sources.

## Accepted source changes

Equality proofs (`equality.bend`): `append_associative` is standard
list induction; `prefix_a_before_b` strips the common prefix and
decides at the first differing character; `prefix_a_differs_from_b`
lifts the LT outcome to inequality through `eq.fin`. All three are
sound structural lemmas; the compiler checks the proof terms remotely.

Plan/schema distinction laws: the two universal statements
(`two_different_plans_do_not_share_an_association_insert`,
`two_different_schemas_do_not_share_an_association_insert`) are
byte-unchanged since `63f909c0`. Only the proof bodies changed,
decomposing each SQL string at the first differing literal
(`plan-a`/`plan-b`, `schema-a`/`schema-b`) with `append_associative`
reassociation and the prefix lemmas. The decompositions match the
pinned strings exactly.

SQL grouping and literal audit (`63f909c0` to HEAD across `laws.bend`):
every quoted literal is preserved except four intended changes. The
owner-notice law unifies on the shared `C.message_upsert()` clause and
adds the empty-id guard, matching the implementation. The admission
insert law and the association insert law are pure concatenation
regroupings. The duty fixture input changes `notice` to `unknown`,
exercising the unknown-kind refusal with the verdict unchanged. The
ref, absent-association, and present-association fixtures now supply
complete framings that reach their named refusal arms (verified
against `ref_decide` check order and `association_fields`/
`association_mark` structure below).

UTF-8 decoding (`98455a2f`): the `three_cp`/`four_cp` continuation
mask fix is correct (full low-6-bit decoding; verified `中` =
U+4E2D against the old mis-decode U+462D). Association values now pass
hex decode plus `decode_scalar_utf8` text-scalar validation with a
first-failure `scalar` arm. Fixture rows hex-encode every field,
exercising the full decode path. The remaining `tail_pair` use is the
two-byte path, where the five-bit mask is correct.

Exact-tab parsing (`bc30f59a`): association, admission, duty, and
receipt decoding move from the git splitter to the context splitter,
which preserves trailing empty columns under law. The added symbol
`name` field keeps the accepted request sample complete; dispatch and
operation fixtures are unaffected.

Retained-reference and scalar laws (`9b123055`, `59ab3e08`,
`2ba56500`, `d08b0d4a`, `66cfa481`, `e0bc4c98`, `2beb29a3`): the
`container` first-refusal name matches `ref_decide` check order (the
container arm precedes the count check). The four-byte scalar law pins
U+1F9EA with all continuation bits. Hex pairs decode non-overlapping
with a pinned example. The unknown-root frame is now complete except
its extra field, so the refusal names the unknown field. Binder-only
proof repairs carry no semantics.

Checkpoint logging (`ecfbdd0b`): `logs.bend` hunks are comments only.
The rotation test now asserts the fourth segment end to end, and the
new migration test pins refusal plus original-row preservation with no
legacy table. Test strengthening around unchanged implementation.

U32 widened-bound mutation: the record `codec-u32-bound-widened` names
`contracts_law_u32_token_refuses_the_next_number`, the first law in
file order that fails under the widened bound (traced: `digits_le`
accepts `4294967296` against `9999999999`, breaking the `== False`
proof). The find string occurs exactly once. Static detection path
verified; remote negative control executes it.

## Genuine behavioral defects (found in predecessors, repaired at HEAD)

- The `three_cp`/`four_cp` five-bit middle-byte mask mis-decoded
  three- and four-byte sequences whose second byte carries bit 5
  (e.g. U+4E2D read as U+462D). Fixed with a law that fails on the
  old code.
- The fb903-era `contracts.bend` use-before-definition and the
  `cdp-runtime.bend` comment syntax are repaired (definition
  relocated; comments converted). Prior-turn diagnostics are stale.

Contained observations, not blockers: `hex_decode`/`hex_val` are
partial (odd tails dropped, non-hex nibbles unvalidated), but every
caller gates on `hex_ok` first; `hex_decode` odd-length input cannot
arrive through a gated path.

## Blocked and ongoing (outside this lane)

- Lifecycle executable fixture interface/type repairs are underway
  (lock, inspection-effect, diagnostics, and duty-result commits in
  the log); not reviewed here.
- Collector qualification verdicts belong to the active root job;
  observed state only: collection artifacts present, lane check
  streams empty at observation time. No conclusion drawn from
  observed output; admitted goldens stay fixed regardless.
- The admitted goldens activate on root's gate run, which this lane
  does not own or duplicate.
