# Codec oracle native report, 2026-10-06

Lane: `integration-codec-oracle-muse-20261006`, continuing from
`d4129e49` (preserved; this report adds new commits on top). Review
basis is latest root source at `642d30ca` in
`/Users/wahargis/Development/Experiments/baton-integration-20261006`.
The stale fb903 diagnostics from `d4129e49` sections 2-3 are superseded
by the root repairs below; this report covers latest source only. No
build ran in this lane; retained evidence was inspected read-only. Root
owns all context source edits and active remote builds.

## Artifact paths and status

| Artifact | Path | Status |
|---|---|---|
| Codec fixture byte proposal, 14 lines | `docs/bend2/codec-expected-proposal-20261006.txt` | PROPOSED, unaccepted |
| Proposed rendering contract | `docs/bend2/codec-rendering-contract-20261006.md` | PROPOSED, unaccepted |
| Operations fixture bytes (reviewed dir) | `/private/tmp/baton-native-context-integration-review/operations.expected.txt` | ACCEPTED selector-only, with scope limits |
| This report | `docs/bend2/codec-oracle-native-report-20261006.md` | record |

The codec byte proposal is not admitted to `bend2/src/context/` and no
collector compares against it. Admission needs root explicit review of
the rendering contract first.

## Codec byte derivation (latest source)

Each line derives from the current `main` inputs plus a cited law or
renderer. Retained candidates predate the repairs and are 0 bytes, so
derivation used sources only:

- `frame-engines ...` and `frame-query ...`: the frame laws pin both
  full documents (engines id 7; query id -1 with canonical
  `{"version":1}`).
- `metadata`, two empty lines, `invalidProgressToken`: `0.5` and
  `1e400` admit per the spec strict-number profile and the MetaOk
  laws; `MetaOk` renders empty. Null refuses per spec and the
  MetaBadProgressToken law.
- `envelope`, engines success doc, query success doc, `invalidJsonrpc`:
  the two accepted envelopes render through `codec_success_text`
  with the same arguments the contracts success laws pin; version
  `1.0` refuses at the jsonrpc check before the tool is consulted.
- `dispatch`, `refused:validationRefusal:effectNotGranted`,
  `refused:validationRefusal:unknownOperation`, `end`: the repaired
  main now calls the three-parameter `dispatch_admission` with the
  exact law call shapes, so the missing-grant and empty-chain laws pin
  both lines through `admission_text` and `refusal_class_name`.
  The prior-turn arity observation is resolved by the source repair.

Spec-defined meaning versus rendering: admit/refuse classes and the
input corpus come from the spec; every spelling (empty admit lines,
bare conditions, `dispatch:`/`refused:` prefixes, document key order)
is implementation-carried and proposed in the rendering contract, not
previously spec-pinned.

## Review verdicts

- Operations proposal (`operations.expected.txt` + rationale):
  ACCEPTED for selector-only review with the stated scope limits. The
  six samples, two overrides, render fields, and headers are unchanged
  at root HEAD; re-derivation reproduces all ten bytes. The seven
  operation names appear in the `engines.bend` closed vocabulary. The
  provenance qualification stands: names and printer spellings are
  implementation-carried, so byte-gate use needs the admitted fixture
  format, and the oracle stays out of admission/provider/effects
  qualification.
- Raw ancestry `5ebef9dd`: ACCEPTED. The `raw_finish` rewrite walks
  the frame path structurally instead of recursing on the attached
  result; traced equivalent on root/leaf/object/array/bad cases
  because `raw_attach` preserves the spine and propagates `RFBad`
  identically in both forms. The companion law hunk unifies the owner
  notice with the shared `C.message_upsert()` contract.
- Empty-notice law `ce36bbe7`: ACCEPTED. The `present_raw` move
  repairs another use-before-definition in the same class as the old
  contracts defect. The empty-id guard matches the implementation;
  callers concatenate the result into larger statements where an empty
  contribution is harmless, and a dedicated law pins the empty case.
- SQL grouping `4dcc73d1`: ACCEPTED. String-concatenation regrouping
  only; no semantic content.
- DS collector `7ab35339`: ACCEPTED. The outcome taxonomy
  (refused / refused-other-law as unqualified-for-classifier /
  unattributed and survived as failures / baseline-unqualified) keeps
  the classifier as the verdict owner and records location plus
  retained source. Whole-identifier named-law matching is retained.
  (An earlier read flagged a possibly undefined variable; full-context
  read shows `mutated` is assigned at the application site. No defect.)

## Evidence and build discipline

Retained root-job evidence inspected read-only over SSH
(`candidate-context-codec.*`, `evidence/codec/*`); the fb903-era exit-1
record is superseded and left in place. This lane launched no build;
root's active builds run unduplicated. The scoped proof for the current
proposal is root's next collector run against repaired sources, which
this lane does not own.

Next: root explicit review of the rendering contract; on admission,
place admitted bytes at `bend2/src/context/codec.expected.txt` through
root integration and run the collector; the operations proposal follows
the same admission path.
