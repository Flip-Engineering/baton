# row-cadence notes — [attempt: 65fd1578-0c44-4f81-a2e2-2701900a3ec8 row-cadence]

Deliverable: implementation + red-first pin suite. Two smaller #163 follow-ons in one row
(they touch the same files; the handoff lists them as items 2-3). Row brief: the sibling
dispatch in this directory (wave-h/row-cadence-brief.md, byte-identical to the wave-f/wave-g
canonical), contract items 2-5.

## What landed

- `impl/src/wave.mjs` (additive hunks only):
  - `close({ reason, basis })` accepts an optional structured `basis = { verdict, signal }`.
    When present it rides BOTH the member-facing stop reason (composed as
    `${reason} basis=${verdict} signal=${signal}`, so the ledger's `run.stop_admitted`
    `reasonDigest` is a digest of a reason that NAMES verdict+signal — never an opaque digest
    of a constant string) and the per-member stop entry. A close without a basis (plain
    callers, back-compat) passes the reason through verbatim and adds no fields — the W1-W10
    wave-driver rows and every other `wave.close({ reason })` caller are byte-unchanged.
- `impl/src/wave-driver.mjs` (additive hunks only):
  - `basisSignal` is set exactly where `basis` is set: `abort-signal` (aborted),
    `member-terminality` (all members settled on member evidence, including the
    claim-on-stall recovery re-read), `stall-clock` (the wave-level stall window), and the
    abnormal-exit fallback `{ verdict: 'interrupted', signal: 'abnormal-exit' }` when the
    loop never set a basis (thrown settle/loop — close is still guaranteed, L1).
  - The guaranteed `finally` close now passes `basis` to `wave.close` — 'Wave driver settled.'
    is never the reason a member sees when the basis was stall/abort.
  - settleTimeoutMs's pacing-only law is documented at the policy field AND at the settle call
    (contract 2 documentation).
- `impl/src/workflow-interpreter.mjs` (additive hunk only): the interpreter's guaranteed close
  passes the drive's own decision basis — `{ verdict: driveExit, signal }` with the closed
  exit-signal map (`pending_empty`→`member-terminality`, `quiesced`→`quiescence-window`,
  `terminalized_unrecoverable`→`unrecoverable-terminal`, `stuck_handled`→`handled-decision-stuck`).
  Same class of gap as the driver (the measured 2026-08-15 instance's members were stopped
  with a generic close reason); the same wave.close threading carries it.
- `impl/test/cadence-settle-basis-red.test.mjs` (new pin suite, 5 rows):
  - C1 (settle-timeout pin, RED at pre-change head): a member still parked when the stall
    clock fires and the settle window expires keeps `basis 'stall'` and a NON-terminal settle
    outcome — the timeout never produces a terminal basis; the member stop carries
    `{ verdict: 'stall', signal: 'stall-clock' }` and the ledger `reasonDigest` is the digest
    of the composed reason, not of the constant.
  - C2 (RED at pre-change head): a claim-settled wave stops with
    `{ verdict: 'completed', signal: 'member-terminality' }`.
  - C3 (classifier pin, GREEN at pre-change head — the sibling #236 fix landed it): a
    tool-call-only member (content.tool_call evidence, NO checkpoints/messages) classifies
    'progressing' at the silence-threshold edge. The store projection already carries the
    liveness (application.mjs `_progressTiming` unions content evidence into
    `lastProgress.at`, pinned by quiescence-activity-red.test.mjs); this row pins the
    CLASSIFIER output the driver folds (contract 1 + 3a).
  - C4 (RED at pre-change head): wave.close threads verdict+signal into every member stop
    entry AND the member-facing reason (ledger digest of the composed reason); close without
    a basis stays byte-identical (back-compat guard).
  - C5 (RED at pre-change head): an aborted drive stops with
    `{ verdict: 'aborted', signal: 'abort-signal' }`.

## settleTimeoutMs audit (contract 2) — pacing-only, no terminal path

Every use of `settleTimeoutMs` at this HEAD:

| Site | Role | Terminal? |
|---|---|---|
| `wave-driver.mjs` `DEFAULT_POLICY.settleTimeoutMs = 5_000` | policy default | no — consumed only by the settle call below |
| `wave-driver.mjs` `freezePolicy` validation | closed-set integer check | no |
| `wave-driver.mjs` `outcomes = await wave.settle({ timeoutMs: policy.settleTimeoutMs })` | bounds the post-loop settle WAIT | no — the drive's basis is decided BEFORE settle (member terminality / stall / abort); `wave.settle` (wave.mjs) builds outcomes from member status reads, and a timeout only stops the wait — non-terminal members stay non-terminal |
| `recipes.mjs` policy field + defaults (5_000/15_000) | forwarded verbatim into the driver policy | no |
| test policy overrides | short relative timeouts | no |

`wave.settle`'s internal default `timeoutMs = 60_000` and `stopMember`'s `timeoutMs = 5_000`
are the same pacing-only class (wait/retry bounds; neither classifies a member terminal on a
clock). No terminal path reads `settleTimeoutMs`; the #163 law's retired `hardCapMs` remains
the only clock that ever terminated fate, and it is refused loudly (D4). C1 pins this: the
settle timeout cannot produce a terminal basis, and the stop names the stall-clock signal.

## Red-first verification (exact runs, this worktree)

| Check | Command | Result |
|---|---|---|
| RED at pre-change head (pin suite, 4/5 fail) | `node --test test/cadence-settle-basis-red.test.mjs` | C1/C2/C4/C5 fail on the missing stop basis (C1's settle-semantics guardrails — basis 'stall', outcome terminal:false — pass at both heads); C3 passes (sibling fix landed) |
| GREEN at changed head | same | 5/5 pass |
| wave-driver suites | `node --test test/wave-driver-red.test.mjs test/wave-driver-policy-red.test.mjs test/quiescence-activity-red.test.mjs` | 22/22 pass |
| quiescence battery | `node --test test/quiescence-completion-red.test.mjs` | 15/15 pass |
| interpreter consumer | `node --test test/workflow-as-data-red.test.mjs` | 31/31 pass |
| other driver consumers | `node --test test/claim-preflight-red.test.mjs test/issue10-waiting-vocabulary-red.test.mjs test/bidirectional-driver-red.test.mjs test/briefing-pack-red.test.mjs test/recipes-red.test.mjs test/semantic-progress-red.test.mjs` | pass |
| fixture-clock-lint | `node scripts/fixture-clock-lint.mjs` | clean |
| wide consumer battery (16 suites: tight-cell, workflow-dsl, readiness, kg-activation, frame-economics, launch-validation, grammar-m3, turn-checkpoints-31b, wire-settle-detach, + the 7 above) | `node --test <16 files>` | failure set byte-IDENTICAL to pristine HEAD (51 unique pre-existing reds — sibling rows' red-first pins and the KS5 machinery red); zero new failures from this row |

## Pre-existing HEAD reds observed (not caused by this row, verified by source swap)

- `kg-settlement-red.test.mjs` KS5 ("the re-drive completes the candidacy exactly once",
  23/24 pass): fails identically at pristine HEAD with this row's three source files swapped
  to `HEAD` — a pre-existing machinery red in the kg-ritual crash-walk, outside the
  coordinator's named acceptance battery (my pins + quiescence-completion + wave-driver).
- `quiescence-completion-red.test.mjs` R5 fails when the suite runs in the node test runner's
  PARALLEL multi-file mode (5+ heavy suites together) and passes standalone 15/15 — the flake
  reproduces at pristine HEAD in the same parallel configuration. The acceptance battery runs
  the suite standalone, which is green.
- The 51 pre-existing reds across tight-cell / workflow-dsl / readiness-credentials /
  readiness-honesty / kg-activation / frame-economics / launch-validation / grammar-m3 are
  sibling rows' red-first pins (their wave-h implementations are in flight on other
  worktrees) — red at HEAD by design, byte-identical with and without this row.

## Terminal semantics — byte-stable

Same bases (`completed` / `stall` / `aborted`), same loop decisions, same receipt fields
(plus the additive per-stop `basis`), no new event kinds, no new commands, no new policy
fields, no new public surfaces. `wave.close({ reason })` callers are byte-unchanged. The only
behavior change is the composed per-member stop reason when a drive passes its basis (the
driver and the interpreter now do), so a member's stop names the verdict + signal that fired
it.

## Judgment calls (recorded)

1. **Authority class — the pin file path and the interpreter scope.** The Path scope header
   lists only `docs/.../wave-h/**`, `impl/src/**`, `impl/test/**`; the contract's items 3-5
   name the red-first pins and the stop-basis law. The pin suite lives at
   `impl/test/cadence-settle-basis-red.test.mjs` (within the listed scope) and the stop-basis
   threading is implemented for BOTH drive paths that issue member stops — the wave driver
   (the contract's named string 'Wave driver settled.') AND the workflow interpreter (the
   measured 2026-08-15 instance's close path, same class of gap, one additive hunk). The
   interpreter change rides the same wave.close composition and is covered by the wave-level
   C4 pin; no end-to-end interpreter drive row was added (the interpreter's quiescence
   declaration evidence is already pinned by the quiescence-completion battery).
2. **Basis composition format.** The member-facing reason is `${reason} basis=${verdict}
   signal=${signal}` — stable, parseable, bounded (1KB reason ceiling), and pinned byte-for-
   byte by C1/C4 via the ledger `reasonDigest`. The structured `basis` also rides the stop
   entry for machine consumers. A malformed/absent basis falls back to the verbatim reason
   (defensive; close runs in the guaranteed path and must never throw on caller data).
3. **Abnormal-exit naming.** When the loop never sets a basis (a thrown settle/loop before
   break), close still runs (L1) and names `{ verdict: 'interrupted', signal: 'abnormal-exit' }`
   — an honest label, never a silent relabeling as a normal settle.
4. **Pre-existing reds are recorded, not fixed.** KS5 and the parallel-mode R5 flake fail at
   pristine HEAD; fixing them would be outside the closed contract and would touch suites the
   row must not edit ("no suite edits").
