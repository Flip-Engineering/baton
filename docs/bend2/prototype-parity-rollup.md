# Prototype parity rollup — the five replay corpora (Phase 1)

This file rolls up the prototype-parity state of the Bend2 rewrite across the five replay corpora
of the architecture review's track 1: `arch-replay-stop`, `arch-replay-basis`,
`arch-replay-cursor`, `arch-replay-mutation` and `arch-replay-vocabulary`, all under
`docs/bend2/examples/`. For each corpus it records the claim, the requirement and contract rows the
corpus names, the parity verdict measured on this lane's own run, and every open explained
real-code divergence with its status. The divergence ledger is
[`arch-close-status.md`](arch-close-status.md).

## Method, revisions and environment

- Lane worktree cut from `origin/bend2-rewrite` at `a01b9713`; all five corpora are on that branch
  and were read and run there.
- Host: Darwin 27.0.0, arm64 (Apple M4); Node v25.8.0; `bend 2.0.25` (the language pin
  `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868`), binary from the pinned toolchain
  install under `node_modules/.bend`. `bend version` printed `bend 2.0.25` before the runs.
- Per corpus, three measurements: `node docs/bend2/examples/arch-replay-<name>.mjs --compare`
  (the recorded three-way expect/reference/prototype verdict), a live reference run
  (`--run`, which drives the branch's own `impl/src` code), and a live prototype run
  (`bend docs/bend2/examples/arch-replay-<name>.bend`). Both live halves were compared
  byte-for-byte against the committed `reference.txt` and `prototype.txt`. `--run` rewrites the
  committed `.reference.txt`; this lane snapshotted and restored those bytes, and `git status`
  reported a clean tree after every corpus. No file under `docs/bend2/examples/` and nothing under
  `impl/` was modified.

| Corpus | Cases | Disagreements (my run) | Committed verdict | Live halves match committed .txt |
|---|---|---|---|---|
| arch-replay-stop | 3 | 2 | 2 | yes, both |
| arch-replay-basis | 4 | 2 | 2 | yes, both |
| arch-replay-cursor | 4 | 0 | 0 | yes, both |
| arch-replay-mutation | 3 | 2 | 2 | yes, both |
| arch-replay-vocabulary | 5 | 0 | 0 | yes, both |

Every corpus reproduces its recorded verdict exactly at the revisions above.

## arch-replay-stop

**Claim** (`arch-replay-stop.evidence.md`): one frozen source trace — two `task.created` rows and
one policy-bearing `run.stop_admitted` row — replayed under a supplied policy basis and a stated
row state, decides the same required logical behaviour in the pure Bend2 model and in the branch's
coordination fold: the recorded stop is admitted when the basis that authorized it is supplied, and
a refusal classifies its cause, preserves the projection and owed delivery it was admitted against,
and enters quarantine only for corrupt source bytes.

**Requirement and contract rows**: `ARCH-CLOSE-11`, with `M-5`, `M-14` and `M-17`
(`target-architecture.md`). The corpus drives the coordination fold, so it names no `CS`/`CL`/`AB`
contract row.

**Parity verdict, this run** (`--compare` at `2fc5fdaf`): 3 cases compared, 2 disagreements.
`stop-policy-bearing` agrees on every field. `stop-missing-policy` disagrees on `classification`
(required `missing_policy_basis`, reference `replay_refused`). `stop-corrupt-row` disagrees on
`classification` and `quarantine` (required `corrupt_source_bytes` with quarantine `true`,
reference `replay_refused` with quarantine `false`). Both halves' committed result files match the
live runs byte-for-byte.

**Open explained real-code divergence** — status: open, gap reproduced (carried by the
`ARCH-CLOSE-11` row of `arch-close-status.md`):

- Refusal-class separation. A valid row the supplied basis cannot validate and a row whose own
  binding no longer recomputes both return `run_stop_integrity` / `replay_refused`, with the same
  projection fields (cursor 2, owed 1) and no quarantine for the corrupt row. The doctor probe adds
  no distinction and falls back to `restart after repairing the coordination ledger`:
  `impl/src/coordination-store.mjs` reads `error?.remedy ?? 'restart after repairing the
  coordination ledger'` and `CoordinationIntegrityError`
  (`impl/src/coordination-internals.mjs`) carries no `remedy`. An operator reading either result
  cannot tell a missing basis from damaged bytes. The required separation
  (`missing_policy_basis` against `corrupt_source_bytes`, quarantine on the second only) exists in
  the Bend2 model and is absent from the fold.

## arch-replay-basis

**Claim** (`arch-replay-basis.evidence.md`): one frozen lease trace — `task.created`,
`task.claimed` and the `run.orchestrator_lease_issued` row with its `policyDigest`, written by the
implementation's own admission verbs — replayed under the basis that issued it, under a changed
basis, and under no basis, decides the same required logical behaviour in the pure Bend2 model and
in the branch's coordination fold: a self-consistent recorded row reconstructs from its own bytes
and folds, a basis that changed out from under it is refused and classified as its own cause, and
the diagnostic path reaches the verdict the same basis implies.

**Requirement and contract rows**: `ARCH-CLOSE-11`, with `M-5`, `M-14` and `M-17`. The corpus
drives the coordination fold, so it names no `CS`/`CL`/`AB` contract row.

**Parity verdict, this run** (`--compare` at `2fc5fdaf`): 4 cases compared, 2 disagreements.
`lease-same-basis` and `lease-missing-basis` agree on every field — the missing-basis row is
admitted and folds to cursor 3, the required behaviour. `lease-changed-basis` disagrees on
`classification` and on `doctor` (required `authorization_basis_changed` and `doctor=refused`;
reference `replay_refused` and `doctor=clean`). `lease-invalid-row` disagrees on `classification`
(required `invalid_payload`, reference `replay_refused`). Both halves' committed result files match
the live runs byte-for-byte.

**Open explained real-code divergences** — status: open, gap reproduced (carried by the
`ARCH-CLOSE-11` row):

- Refusal-class separation. The changed-basis case and the invalid-payload case both return
  `run_orchestrator_lease_integrity`; the repair each needs is not derivable from the refusal.
- Diagnostic verdict. Replayed with a basis whose `maxChildrenPerRun` differs by one, the resident
  fold refuses the recorded row, and the diagnostic probe behind `baton doctor`
  (`coordinationReplayFailure`) reports the same ledger clean, because it constructs its store with
  no deployment basis at all. A restart and a doctor run of the same ledger reach opposite
  verdicts; the required behaviour is one recorded policy basis for startup, doctor and recovery.

## arch-replay-cursor

**Claim** (`arch-replay-cursor.evidence.md`): one frozen trace of four task rows, opened live,
reopened behind a projection checkpoint, and reopened under a changed or absent authority, decides
the same required logical behaviour in the pure Bend2 model and in the branch's coordination store:
the projection a consumer resumes from and the rows that consumer is still owed survive the
restart, and a checkpoint written under one authority is rebuilt from the ledger when the next open
supplies another.

**Requirement and contract rows**: `ARCH-CLOSE-11`, with `M-5`, `M-13` and `M-17`. The corpus
drives the coordination store, so it names no `CS`/`CL`/`AB` contract row.

**Parity verdict, this run** (`--compare` at `2fc5fdaf`): 4 cases compared, 0 disagreements.
`cursor-live` reports `source=live`; the same-basis restart reports `source=checkpoint,
checkpoint=valid`; the changed-basis and missing-basis restarts report
`source=ledger_fallback, checkpoint=stale_authority`; every case covers cursor 4 with 3 rows owed.
Both halves' committed result files match the live runs byte-for-byte.

**Open explained real-code divergences**: none. This corpus is the conforming path the
`ARCH-CLOSE-11` ledger row cites: `stale_authority` is a verdict the store's open already reaches
and records for checkpoints, nothing is refused or quarantined on the rebuild path, and the
projection and cursor survive every case.

## arch-replay-mutation

**Claim** (`arch-replay-mutation.evidence.md`): one case file of requests the implementation must
judge decides the same required logical behaviour in the pure Bend2 model and in the branch's
admission verb: the accepted request writes one row and advances the projection, and each refused
request writes no row, leaves the cursor and the owed delivery where they were, and reports the
cause the refusal names.

**Requirement and contract rows**: `M-14`, with `M-5` and `ARCH-CLOSE-11`. The corpus drives the
coordination admission verb, so it names no `CS`/`CL`/`AB` contract row.

**Parity verdict, this run** (`--compare` at `2fc5fdaf`): 3 cases compared, 2 disagreements.
`mutation-valid` agrees on every field (admitted, one row written, cursor 3, owed 2).
`mutation-unknown-field` and `mutation-expired-session` agree on admission, on `rows_written=0`,
and on the state the attempt left behind (cursor 2, owed 1), and disagree on `refusal_class`
(required `invalid_request` and `expired_authority`; reference names
`run_orchestrator_lease_invalid` for both). Both halves' committed result files match the live
runs byte-for-byte.

**Open explained real-code divergence** — status: open, gap reproduced (carried by the
`ARCH-CLOSE-11` row):

- Refusal-vocabulary separation. One code covers two causes: the request shape that is not
  admitted and the authority that expired before the event clock both return
  `run_orchestrator_lease_invalid`. The distinction survives in the message text only
  ("run orchestrator lease request is invalid" against "run orchestrator lease timestamp is
  invalid"), so the code alone names no repair. This is the vocabulary `M-14` asks for and the
  same class of gap the stop and basis corpora record for the fold.

## arch-replay-vocabulary

**Claim** (`arch-replay-vocabulary.evidence.md`): a frozen thirty-row swarm trace — twelve of the
thirteen caller-submittable event kinds (the thirteenth, `swarm.holder_released`, is an operation
the runtime expands into assignment releases before anything folds) and all twenty-five kinds the
durable vocabulary holds, over one seeded swarm — answers the same required logical behaviour in
the pure Bend2 model and in the branch's real durable fold (`impl/src/swarm-state.mjs`,
`impl/src/swarm-contract.mjs`): the whole trace decodes and folds into its collections, a kind no
vocabulary admits refuses decode at its own row with the prefix before it retained, a payload
missing a required field refuses decode the same way, a runtime-composed row the contract set
excludes still folds, and folding the same trace twice yields one projection.

**Requirement and contract rows**: the corpus is derived from the contract directly — `CS-01`
(closed event vocabulary, `unknown_event_kind`), `CS-07` (required payload fields,
`invalid_payload`), `CS-17`/`CL-17` (two vocabularies, one fold: the caller-submittable set
excludes the runtime-composed bypass row), `AB-06` (handoff and release rewrite their rows in
place), and migration rule 3 (phase-boundary decode with preserved history).

**Parity verdict, this run** (`--compare` at `a01b9713`): 5 cases compared, 0 disagreements.
`vocabulary-full` and `vocabulary-rerun` fold all thirty rows (fifteen caller rows, fingerprint
`pa3,gr1,wo2,cl2,as1,pr1,cx1,co1,rv1,cp1,po1`, `rerun_identical=true`). `vocabulary-forged-kind`
stops decode at row 7 with `unknown_event_kind`, retaining the six-row prefix.
`vocabulary-missing-field` stops decode at row 11 with `invalid_payload`, retaining the ten-row
prefix. `vocabulary-driver-row` folds the composed bypass row while the caller set reads fourteen
rows. Both halves' committed result files match the live runs byte-for-byte.

**Open explained real-code divergences**: none. The corpus records one structural fact beside the
agreement: the contract's `swarm.holder_released` operation never reaches the fold — the runtime
expands it into assignment releases before anything is folded, so the fold vocabulary never sees
the kind.

## The divergence ledger and the finding an implementation phase must close

[`arch-close-status.md`](arch-close-status.md) carries every divergence above on one row:
`ARCH-CLOSE-11` — one recorded schema and policy basis for startup, doctor and recovery, with
cause classification before repair — stands at *gap reproduced, conforming path evidenced*, citing
the stop, basis and mutation corpora for the gaps and the cursor corpus for the conforming path.

**`ARCH-CLOSE-11` refusal-class separation — `missing_policy_basis` against `corrupt_source_bytes`
— is the one finding an implementation phase must close.** Its content, as reproduced by the
corpora: classify the cause of a replay refusal (missing basis, changed basis, invalid payload,
invalid request shape, expired authority), quarantine corrupt source bytes only, and make startup,
doctor and recovery consume one recorded policy basis so the fold and the diagnostic probe reach
the same verdict on the same ledger. The Bend2 models already produce the required classification
on every corpus; the fold, the admission verb and the diagnostic probe produce it on none of the
refused cases. No other open divergence appears in any of the five corpora.

## What the Phase 1 zero-unexplained-differences gate still owes

The gate is decision rule 6 of `go-no-go.md` (line 100): *Phase 1 produces zero unexplained
differences across the frozen corpus, extracted laws, closed validation mutations, replay
prefixes, and wake projections.* Measured against that sentence at `a01b9713`, the gate still
owes:

1. **Implementation of `ARCH-CLOSE-11`.** The six reproduced case-level differences —
   classification on four stop/basis cases plus quarantine on the corrupt row, classification plus
   the doctor verdict on the changed-basis case, and `refusal_class` on both mutation cases — are
   the frozen corpus's unexplained differences. The proving-test rule
   (`rewrite-plan.md`, Phase 1) requires a regression fixture before each correction; the five
   corpora's `expect` files are those fixtures, and the Bend2 halves already state the required
   behaviour on every one.
2. **The vocabulary corpus landed.** `arch-replay-vocabulary` landed on `bend2-rewrite` as
   `a01b9713`; the target branch carries all five corpora.
3. **The proving test assembled.** `phase1-shadow-parity.test.mjs` — every Phase 0 fixture plus
   generated mutations through both implementations, deterministic repeated runs, identical replay
   projections at every fixture cursor — exists on neither branch at the measured revisions. The
   five corpora cover the frozen corpus and the replay-prefix surface of the gate; the test is the
   mechanism that carries the remaining surfaces.
4. **Gate surfaces the corpora do not measure.** Extracted laws: the plan assigns each approved law
   a parity proof per phase, and these corpora exercise the decision halves of `M-5`, `M-13`,
   `M-14` and `M-17` only. Closed validation mutations: none of the five corpora generates
   mutations. Wake projections: the cursor corpus covers projection checkpoints and states in its
   limits that `WakeStream` is not constructed, so wake-class derivation and the wake attachment
   cursor are unmeasured on this track.

The rollup's own state: every recorded verdict reproduced on this lane's run, both halves of every
corpus byte-identical to their committed result files, and one new divergence in the ledger's
vocabulary — none. The parity evidence is current; the gap it names is an implementation debt,
carried by `ARCH-CLOSE-11`.
