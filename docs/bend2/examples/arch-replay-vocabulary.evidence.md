# arch-replay-vocabulary.evidence.md

## Claim

A frozen sixteen-row swarm trace — eleven of the thirteen caller-submittable event kinds
(`swarm.participant_left` stays unexercised) and thirteen of the twenty-five kinds the durable
vocabulary holds, over one seeded swarm — answers the same required logical behaviour in a pure
Bend2 decision model and in
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
| `arch-replay-vocabulary.ledger.jsonl` | the frozen source trace: sixteen rows as the fold decodes them |
| `arch-replay-vocabulary.cases` | the five case inputs both halves read (`mutation`, `replays`) |
| `arch-replay-vocabulary.mjs` | the reference half: replays the trace through the real `foldSwarmEvent`, reports decode/fold stops, caller-set membership and the retained-collection fingerprint |
| `arch-replay-vocabulary.bend` | the prototype half: the same case file answered by the pure composition model (closed caller set, per-kind collection, arrival semantics, replace-in-place handoff and release) |
| `arch-replay-vocabulary.expect` | the required behaviour per case, read by neither half, derived from the contract (CS-01, CS-07, CS-17/CL-17, AB-06, migration rule 3) |

## Commands and observed output

```
$ node docs/bend2/examples/arch-replay-vocabulary.mjs --emit-ledger
wrote /private/tmp/bend2-o10-vocab/docs/bend2/examples/arch-replay-vocabulary.ledger.jsonl (16 rows)

$ node docs/bend2/examples/arch-replay-vocabulary.mjs --run
RESULT|vocabulary-full|rows=16|admitted=16|decode_stop=0|decode_code=none|fold_stop=0|fold_code=none|caller_rows=13|fp=pa2,gr1,wo2,cl2,as1,pr1,cx1,co1,rv1,cp1,po1|rerun_identical=na
RESULT|vocabulary-rerun|rows=16|admitted=16|decode_stop=0|decode_code=none|fold_stop=0|fold_code=none|caller_rows=13|fp=pa2,gr1,wo2,cl2,as1,pr1,cx1,co1,rv1,cp1,po1|rerun_identical=true
RESULT|vocabulary-forged-kind|rows=16|admitted=6|decode_stop=7|decode_code=unknown_event_kind|fold_stop=0|fold_code=none|caller_rows=3|fp=pa2,gr1,wo1,cl0,as0,pr0,cx0,co0,rv0,cp1,po0|rerun_identical=na
RESULT|vocabulary-missing-field|rows=16|admitted=10|decode_stop=11|decode_code=invalid_payload|fold_stop=0|fold_code=none|caller_rows=7|fp=pa2,gr1,wo2,cl2,as1,pr1,cx1,co0,rv0,cp1,po0|rerun_identical=na
RESULT|vocabulary-driver-row|rows=16|admitted=16|decode_stop=0|decode_code=none|fold_stop=0|fold_code=none|caller_rows=12|fp=pa2,gr1,wo2,cl2,as1,pr1,cx1,co1,rv1,cp1,po0|rerun_identical=na
```
Exit code 0. The `--run` mode records the same lines to `arch-replay-vocabulary.reference.txt`.

```
$ bend docs/bend2/examples/arch-replay-vocabulary.bend
RESULT|vocabulary-full|rows=16|admitted=16|decode_stop=0|decode_code=none|fold_stop=0|fold_code=none|caller_rows=13|fp=pa2,gr1,wo2,cl2,as1,pr1,cx1,co1,rv1,cp1,po1|rerun_identical=na
RESULT|vocabulary-rerun|rows=16|admitted=16|decode_stop=0|decode_code=none|fold_stop=0|fold_code=none|caller_rows=13|fp=pa2,gr1,wo2,cl2,as1,pr1,cx1,co1,rv1,cp1,po1|rerun_identical=true
RESULT|vocabulary-forged-kind|rows=16|admitted=6|decode_stop=7|decode_code=unknown_event_kind|fold_stop=0|fold_code=none|caller_rows=3|fp=pa2,gr1,wo1,cl0,as0,pr0,cx0,co0,rv0,cp1,po0|rerun_identical=na
RESULT|vocabulary-missing-field|rows=16|admitted=10|decode_stop=11|decode_code=invalid_payload|fold_stop=0|fold_code=none|caller_rows=7|fp=pa2,gr1,wo2,cl2,as1,pr1,cx1,co0,rv0,cp1,po0|rerun_identical=na
RESULT|vocabulary-driver-row|rows=16|admitted=16|decode_stop=0|decode_code=none|fold_stop=0|fold_code=none|caller_rows=12|fp=pa2,gr1,wo2,cl2,as1,pr1,cx1,co1,rv1,cp1,po0|rerun_identical=na
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

- **Decode coverage at a phase boundary (migration rule 3).** Thirteen of the twenty-five kinds
  the durable vocabulary holds decode through the real fold, and the whole trace replays into one
  projection:
  `pa2,gr1,wo2,cl2,as1,pr1,cx1,co1,rv1,cp1,po1`.
- **Preserved history under refusal.** A refusal stops the replay at its own row and retains every
  row before it: the forged-kind case keeps the six-row prefix, the missing-field case the
  ten-row prefix.
- **Two vocabularies, one fold (CS-17/CL-17).** The contract's caller-submittable set admits
  thirteen of the sixteen rows, covering eleven of its thirteen kinds
  (`swarm.participant_left` stays unexercised); the runtime seeds and the composed bypass row
  fold while staying
  outside it (caller_rows 13 vs 12 on the driver case); the contract's own `swarm.holder_released`
  operation is not a fold row at all — the runtime expands it into assignment releases before
  anything is folded.
- **Deterministic replay.** Folding the frozen trace twice into fresh maps yields one projection
  byte for byte (`rerun_identical=true`).

## Scope and limits

The corpus freezes one hand-built trace; it is not a quantified corpus over all payload shapes
(the shape validator's per-kind refusals beyond the two mutation cases stay unexercised). The
admission half of the two vocabularies is read from the contract's own kind table; the command
admission layer (`validateSwarmCommand`) is not exercised here. No impl/src file is modified; no
full Baton suite runs in this lane.
