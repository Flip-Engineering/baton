# Codec range review fc265b4c..69ae6831, 2026-10-06

Read-only review of five root commits in
`/Users/wahargis/Development/Experiments/baton-integration-20261006`
(HEAD `69ae6831`). No source edits, no builds, no candidate output
bytes read. This review does not declare runtime qualified; gate
verdicts belong to root's active qualification runs.

## Corrected literal q1 oracle, and a prior-review miss

Commit `912311b2` changes admitted `codec.expected.txt` line 9 from
`"query":"q7"` to `"query":"q1"`. The correction is right: codec `main`
sample g passes `Context.Present{"q1"}` to the envelope, so the
rendered document carries q1. The q7 value came from the contracts
`main` sample r2 (`Present{"q7"}`), which shares the renderer but not
the input. The prior-turn proposal recorded the renderer correctly and
the input literally wrong on that one line; the frame-query line
(q1, law-pinned) and all other lines were unaffected. The two C host
effect renames in the same commit (`CID_PREPARE_GUARD_ANCHOR`,
`CID_ROLE_GUARD_KEY`) match the Bend definition names in
`identity.bend:57,64`, which the old `CID_CONTEXT_*` names did not.

## Statx identity checks (`c2691d9a`)

`baton_sql_birth` on Linux requests creation time, inode, and type via
`statx`, requires all three in the mask, requires a regular file, and
requires the statx inode and device to equal the preceding status
observation before accepting the birth timestamp, with range and
overflow guards on the nanosecond value. Any gap returns 0, which the
caller treats as unavailable binding. The inode/device equality closes
the observation-to-open identity gap for the stated purpose; grants
remain explicit consent, not a sandbox. The companion spec paragraph
documents exactly this behavior. The lifecycle fixture hunks render
booleans through a local `bool_text` and hex-encode the lock digest,
matching the driver expectations on both sides.

## Mutation attribution and renamed laws (`d53f7d57`, `54593766`)

`mutation_outcome` keys detection strictly on the compiler `Location:`
value with module-qualified resolution, and the new unit test pins the
taxonomy: direct hit, imported hit, other-law review, mention-in-error
unattributed, partial-name unattributed, exit-0 survived. The
whole-identifier substring match is removed from the decision path.
All ten distinct renamed record laws exist exactly once in the lane,
and each rename traces to a law the mutation genuinely breaks
(verified per record: chain-count, frame-acceptance, scalar,
scope-duplicate, engine-scope, success-text, container-first,
empty-chain, and grant laws). Exact compiler placement is settled
empirically by the remote negative control, not by this trace.

## Control kind predicate (`bf5906e0`, `69ae6831`)

The `controllable` predicate changed from three-valued NULL logic to
`coalesce(json_extract(result_json,'$.kind'),'')<>'queryControl'`.
Source-derived truth table: ordinary retained JSON without a kind
member admits; absent result admits; `queryControl` kind refuses;
foreign owner, attached runtime, and unknown id refuse. The old form
excluded kind-less results; the new form excludes exactly the control
kind, preserving the intended control exclusion while admitting
completed ordinary subjects. The law tracks the implementation text,
and the lifecycle driver pins the foreign-owner refusal as the exact
`control-subject-unavailable` error. Uppercase hex admission uses
three exact ranges (0-9, A-F, a-f) with fresh laws for mixed case
acceptance and non-hex refusal; all retained-hex decode callers gate
on `hex_ok` first.

## Native evidence

- Admitted goldens: `bend2/src/context/codec.expected.txt`,
  `bend2/src/context/operations.expected.txt`; rendering doc:
  `docs/bend2/codec-fixture-rendering.md` (all under root integration).
- Reviewed commits: `912311b2`, `d53f7d57`, `c2691d9a`, `54593766`,
  `bf5906e0`, `69ae6831`.
- Active runs (untouched, read-only listing only):
  `/home/atari2036/baton-context-root-fa89b203/codec-qualification/`
  and the lifecycle job at `69ae6831`. No remote test was launched
  from this lane; root's running coverage already exercises
  collection and the negative control, so a duplicate would add no
  signal.
- This lane's history (`d4129e49`, `b1e36b90`) is preserved; this
  report is the only new commit.
