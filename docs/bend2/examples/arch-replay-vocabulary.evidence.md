# arch-replay-vocabulary.evidence.md

## Claim

A frozen thirty-row swarm trace — twelve of the thirteen caller-submittable event kinds (the
thirteenth, `swarm.holder_released`, is an operation the runtime expands into assignment releases
before anything folds) and all twenty-five kinds the durable vocabulary holds, over one seeded
swarm — answers the same required logical behaviour in a pure Bend2 decision model and in
the branch's real durable fold: the whole trace decodes and folds into its collections, a kind no
vocabulary admits refuses decode at its own row with the prefix before it retained, a payload
missing a required field refuses decode the same way, a runtime-composed row the contract set
excludes still folds, and folding the same trace twice yields one projection. Five cases, zero
disagreements across required, reference and prototype.

Review track 1 (Codex architecture review): "run the same admission/fold/projection cases through
both implementations", covering the phase-boundary decode and preserved-history facts the go/no-go
record names. The corpus is design-lane evidence: it imports `impl/src` read-only and modifies
nothing in it.

## Host and pin

- Host: darwin 24.x arm64, Apple M4.
- Reference pin: `bendlang/bend` at `a49524265bdfa5753a4bf38e25f0574a705dd868`, Bend 2.0.25
  (installed from `docs/bend2/reference/toolchain/install-2.0.25.sh` under `node_modules/.bend`;
  `bend version` prints `bend 2.0.25`).
- Node: v25.8.0. The reference half imports the checkout's own `impl/src/swarm-state.mjs` and
  `impl/src/swarm-contract.mjs` (branch `bend2-rewrite` at the corpus commit) read-only.

## Halves

| File | Holds |
|---|---|
| `arch-replay-vocabulary.ledger.jsonl` | the frozen source trace: thirty rows as the fold decodes them |
| `arch-replay-vocabulary.cases` | the five case inputs both halves read (`mutation`, `replays`) |
| `arch-replay-vocabulary.mjs` | the reference half: replays the trace through the real `foldSwarmEvent`, reports decode/fold stops, caller-set membership and the retained-collection fingerprint |
| `arch-replay-vocabulary.bend` | the prototype half: the same case file answered by the pure composition model (closed caller set, per-kind collection, arrival semantics, replace-in-place handoff and release) |
| `arch-replay-vocabulary.expect` | the required behaviour per case, read by neither half, derived from the contract (CS-01, CS-07, CS-17/CL-17, AB-06, migration rule 3) |

## Commands and observed output

```
$ node docs/bend2/examples/arch-replay-vocabulary.mjs --emit-ledger
wrote /Users/wahargis/Development/Experiments/baton-resident/.baton/wt/ws-bb964de517ed7cdcfb2ab5bf2ed09021/docs/bend2/examples/arch-replay-vocabulary.ledger.jsonl (30 rows)

$ node docs/bend2/examples/arch-replay-vocabulary.mjs --run
RESULT|vocabulary-full|rows=30|admitted=30|decode_stop=0|decode_code=none|fold_stop=0|fold_code=none|caller_rows=15|fp=pa3,gr1,wo2,cl2,as1,pr1,cx1,co1,rv1,cp1,po1|rerun_identical=na
RESULT|vocabulary-rerun|rows=30|admitted=30|decode_stop=0|decode_code=none|fold_stop=0|fold_code=none|caller_rows=15|fp=pa3,gr1,wo2,cl2,as1,pr1,cx1,co1,rv1,cp1,po1|rerun_identical=true
RESULT|vocabulary-forged-kind|rows=30|admitted=6|decode_stop=7|decode_code=unknown_event_kind|fold_stop=0|fold_code=none|caller_rows=3|fp=pa2,gr1,wo1,cl0,as0,pr0,cx0,co0,rv0,cp1,po0|rerun_identical=na
RESULT|vocabulary-missing-field|rows=30|admitted=10|decode_stop=11|decode_code=invalid_payload|fold_stop=0|fold_code=none|caller_rows=7|fp=pa2,gr1,wo2,cl2,as1,pr1,cx1,co0,rv0,cp1,po0|rerun_identical=na
RESULT|vocabulary-driver-row|rows=30|admitted=30|decode_stop=0|decode_code=none|fold_stop=0|fold_code=none|caller_rows=14|fp=pa3,gr1,wo2,cl2,as1,pr1,cx1,co1,rv1,cp1,po1|rerun_identical=na
```
Exit code 0. The `--run` mode records the same lines to `arch-replay-vocabulary.reference.txt`.

```
$ bend docs/bend2/examples/arch-replay-vocabulary.bend
RESULT|vocabulary-full|rows=30|admitted=30|decode_stop=0|decode_code=none|fold_stop=0|fold_code=none|caller_rows=15|fp=pa3,gr1,wo2,cl2,as1,pr1,cx1,co1,rv1,cp1,po1|rerun_identical=na
RESULT|vocabulary-rerun|rows=30|admitted=30|decode_stop=0|decode_code=none|fold_stop=0|fold_code=none|caller_rows=15|fp=pa3,gr1,wo2,cl2,as1,pr1,cx1,co1,rv1,cp1,po1|rerun_identical=true
RESULT|vocabulary-forged-kind|rows=30|admitted=6|decode_stop=7|decode_code=unknown_event_kind|fold_stop=0|fold_code=none|caller_rows=3|fp=pa2,gr1,wo1,cl0,as0,pr0,cx0,co0,rv0,cp1,po0|rerun_identical=na
RESULT|vocabulary-missing-field|rows=30|admitted=10|decode_stop=11|decode_code=invalid_payload|fold_stop=0|fold_code=none|caller_rows=7|fp=pa2,gr1,wo2,cl2,as1,pr1,cx1,co0,rv0,cp1,po0|rerun_identical=na
RESULT|vocabulary-driver-row|rows=30|admitted=30|decode_stop=0|decode_code=none|fold_stop=0|fold_code=none|caller_rows=14|fp=pa3,gr1,wo2,cl2,as1,pr1,cx1,co1,rv1,cp1,po1|rerun_identical=na
```
Exit code 0. Recorded to `arch-replay-vocabulary.prototype.txt`.

```
$ node docs/bend2/examples/arch-replay-vocabulary.mjs --compare
CASE vocabulary-full: agreement
CASE vocabulary-rerun: agreement
CASE vocabulary-forged-kind: agreement
CASE vocabulary-missing-field: agreement
CASE vocabulary-driver-row: agreement
cases compared: 5; disagreements: 0
```
Exit code 0.

## Verdict

The claim holds at the pin. Required, reference and prototype agree on every case: five cases,
zero disagreements.

## What the corpus establishes

- **Decode coverage at a phase boundary (migration rule 3).** All twenty-five kinds the durable
  vocabulary holds decode through the real fold, and the whole trace replays into one projection:
  `pa3,gr1,wo2,cl2,as1,pr1,cx1,co1,rv1,cp1,po1`.
- **Preserved history under refusal.** A refusal stops the replay at its own row and retains every
  row before it: the forged-kind case keeps the six-row prefix, the missing-field case the
  ten-row prefix.
- **Two vocabularies, one fold (CS-17/CL-17).** The contract's caller-submittable set admits
  fifteen of the thirty rows, covering twelve of its thirteen kinds, `swarm.participant_left`
  among them; the runtime seeds and the runtime-composed rows — the binding, the revision, the
  landing receipt, the writer bypass, the runtime loss, the provider fault, the re-route
  proposal, the successor's join, the workspace carry, the performed re-route and the resume
  question with its answer — fold while staying outside it (caller_rows 14 vs 15 on the driver
  case, whose swapped-out row is the first of the trace's two policy rows); the contract's own
  `swarm.holder_released` operation is not a fold row at all — the runtime expands it into
  assignment releases before anything is folded.
- **Deterministic replay.** Folding the frozen trace twice into fresh maps yields one projection
  byte for byte (`rerun_identical=true`).

## Scope and limits

The corpus freezes one hand-built trace; it is not a quantified corpus over all payload shapes
(the shape validator's per-kind refusals beyond the two mutation cases stay unexercised). The
admission half of the two vocabularies is read from the contract's own kind table; the command
admission layer (`validateSwarmCommand`) is not exercised here. Every fold kind appears in the
trace once; `swarm.holder_released` appears only as the operation the runtime expands, never as a
fold row. No impl/src file is modified; no full Baton suite runs in this lane.
