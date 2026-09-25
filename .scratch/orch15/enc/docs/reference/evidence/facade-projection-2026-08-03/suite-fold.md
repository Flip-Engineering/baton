# Suite fold: workflow-surface red suite (#87+#48) — blue-team fold record

(Authority: `suite-blueteam.md` in this directory — **NOT-READY, 4 blockers** against
`impl/test/workflow-surface-red.test.mjs`, verified against the v2.1 contract. Fold target:
the suite plus `facade-projection-contract.md` where a blocker is contract-side. Fold date:
2026-08-04. Suite run from repo root: `node --test impl/test/workflow-surface-red.test.mjs`,
node v25.8.0. NUL-byte discipline held: `coordinator.mjs`/`application.mjs`/
`coordination-store.mjs` were inspected via `grep -an` + `sed -n` only.)

## Run record (exact splits)

```
BEFORE (baseline, re-measured this fold):   ℹ tests 37   ℹ pass 3   ℹ fail 34   ℹ duration_ms 18274
AFTER  (post-fold, same command):           ℹ tests 37   ℹ pass 3   ℹ fail 34   ℹ duration_ms 18205
```

The split is unchanged **by design**: the fold repairs the future-green path and tightens
oracles — it never flips a red row green (the implementation does not exist yet) and never
weakens a red row. The three guards stay green for their original legitimate reasons:
FP-10-store-direct (now also carrying the stale-fence leg), FP-19, FP-16-conformance.
Every edited red row was re-confirmed to fail AT its named stage (see Verification).

No `test()` rows were added or removed — 37 rows before and after. Blocker 4 and the flag
folds ride INSIDE existing rows as new legs/asserts.

## Blocker → change map

### BLOCKER 1 — WS-01 never approved the member plans (ungreenable sequence)

Suite, `scriptPartA` (`impl/test/workflow-surface-red.test.mjs`): after `waves.start`, a new
**step 2b** drives each member's plan approval THROUGH THE FACADE, exactly the verbs an
orchestrating agent uses: `run.status` until `nextActions` advertises
`{kind: 'approve_plan', planDigest}` (the advertised-action shape,
`impl/src/application.mjs:7150-7151`/`:7590-7591`), then `run.approve` with the advertised
`planDigest` (arg shape `['runId', 'planDigest']`, `impl/src/application.mjs:166`, `:4514`).
Both are EXISTING commands, so the Decision 13 static assertion stays clean (re-verified:
WS-01 still fails at step 1, `run.knowledge.seed` — never at the static assertion).

Probe-verified end-to-end on the suite's exact fixture (throwaway probe, deleted after use):
members stall at `awaiting_plan_approval` (`progressClass blocked_interaction:approve_plan`);
the approval drive unblocks dispatch → the scenario's `answer_decision` gate appears →
`run.answer` → terminal completion → taskId discovery through the `run.status` walk —
matching the blue team's probe. Without step 2b, step 3's run-target sends return
`run_not_active` with no `messageId` against a contract-correct implementation.

### BLOCKER 2 — WS-01 `waves.attach` carried truncated objectives

Suite, `scriptPartA` + `scriptPartC`: the full member objectives
(`survey slice <role> — cite board ws01-tasks and node <nodeId>`) are built ONCE, passed to
`waves.start`, carried verbatim on `stateA.queries[].objective`, and handed to
`waves.attach` — `attachWave` matches members by EXACT objective equality
(`impl/src/application.mjs:11214-11227`; `waves.start`'s returned members carry only
`{role, runId, phase?, progressClass?}`, never the objective, `:11358-11381`). WS-01 gained
the attach-identity assertion on the full text (regex over role + board + seeded node id +
`query.objective.includes(stateA.seedNodeId)`). Probe-verified: truncated objectives throw
`wave_attach_unknown_wave`; the full text attaches (`outcomes: 2`, `waveDriverDetached: true`).

### BLOCKER 3 — FP-09 pinned `frame`/`digest` field names the contract did not name

Disposition: **the contract amendment** (the report's recommended option — the names are the
renderer's own). Contract v2.2, Decision 6's response enumeration now reads
`{schemaVersion: 1, runId, scope, frame, scratchpadFence, observedSeq, entries, nextCursor,
truncated, digest?}`, naming `frame` (the `UNTRUSTED_SCRATCHPAD` marker on every page) and
`digest` (the full-id-set citation, riding only on truncated pages) explicitly — the field
names of the landed renderer `_renderContextRead`
(`impl/src/coordinator.mjs:10474-10499`, verified: `frame` map at `:10474-10479`,
`...(truncated ? { truncated, digest: … })` at `:10496-10499`). The suite's exact FP-09
asserts are UNCHANGED (the marker-tolerant loosening was rejected). Decision 1's carve-out
needed no amendment: `frame`/`digest` are the projected renderer's own output fields, not
envelope completions.

### BLOCKER 4 — Decision 4 note(b)'s dead-handle resolve-to-null had no oracle

Suite, FP-05: new dead-handle leg, staged per the C3 honesty idiom
(`bidirectional-v3-red.test.mjs:526`): lane-direct send to a spawned worker, then
`lifecycle.process_closed` (turnEpoch 2, `{code: 143}`) + `flush()`. The leg asserts the
contrast the contract pins: the LANE still serves the honest receipt
(`{delivered: true, read: null, actedOn: null, reply: null}` — C3) while the FACADE, under
the permissive stub, refuses `application_unauthorized` with the SAME message constant as
the unknown-id case. An accessor resolving through durable task records (returning the run
and serving the receipt — the blue team's named wrong implementation) now fails exactly
here. The row's comment no longer overclaims: it stages what it claims.

## Contract amendments (v2.1 → v2.2)

1. **Header**: title v2.2; a v2.2 fold-note paragraph naming this fold, its four blockers,
   and this file as the blocker→change map.
2. **Decision 6** (BLOCKER 3): the response enumeration names `frame` and `digest` (above).
3. **Decision 4** (report §5 D2 — the "e.g." hedge, pin chosen): the accessor is pinned as
   `coordinator.messageRunId(messageId)` — "the name is the pin, not an example" (FP-18 is
   the oracle). The suite's hard pin stands; the alternative (any read-only accessor name +
   a loosened FP-18) was rejected per instruction.
4. **Refusal vocabulary, MCP wire** (report §5 D3): one sentence recording that the new
   ordinary `baton_run_scratchpad_elevate` guard SHARES the `invalid_scratchpad_elevate`
   string the existing settlement `baton_scratchpad_elevate` guard already returns
   (`impl/src/mcp-northbound.mjs:1004-1008`, verified) — lawful same-class reuse; no
   invented distinct code. The same bullet now also states the two-tier refusal law the
   suite pins: a malformed DECLARED field earns the tool's own `invalid_*` guard code; a
   forged UNDECLARED field dies earlier at the generic key-closure
   (`unknown_argument_field`, `:813-816`).

## Non-blocking flags — folded

- **T2 (FP-08 conditional coalescing)** — folded: after the `until` page, the row now
  requires `coalesced.some(reason => (reason.count ?? 1) > 1)` — an implementation emitting
  two separate count-1 reasons (never coalescing) no longer greens the storm shape. The
  landed lane coalesces deterministically inside the 500 ms window (both emits same tick),
  so the correct implementation greens it.
- **T3 (FP-11-race binding-revalidation half)** — documented residual, per instruction: a
  binding moves only unbound→bound and the facade's own first post already bound the board
  at capture time, so no honest binding flip is stageable between capture and invocation
  through the projected path. The row's comment now says so; the check-then-write wrong
  implementation stays caught (no gate → the `typeof` assert fails).
- **F7 (FP-16-parse stale mechanism claim)** — fixed: the Section I banner and the inline
  comment now state the truth (today every new spelling THROWS `cli_invalid: unexpected
  argument <verb>`, loud) and mark the negative `assert.throws` pins as already-green
  regression guards; the row's red rides on the positive dispatches (re-verified live:
  fails at `unexpected argument send`).
- **Report §5 D4 ("Thirty rows")** — fixed: the suite header now reads "Thirty-seven rows
  (34 red + 3 guards)".
- **Report §5 D5 (no 33-count assert)** — folded: FP-14-tools asserts
  `names.length === 33` (the landed 27 + the six; a seventh stowaway greens nothing). It
  fires after the includes loop, so the named stage is unchanged (re-verified live).
- **T7 (per-tool `invalid_*` codes)** — folded, with one ground-truth correction to the
  report's suggestion. The report proposed `/invalid_message_send/` on the FORGED-field
  legs; verification of the shipped idiom (`validateArguments`,
  `impl/src/mcp-northbound.mjs:807-817`) shows a forged undeclared field dies at the
  generic key-closure as `unknown_argument_field` BEFORE any per-tool guard runs (the
  guards validate declared fields only — "no schema evaluator, hand-rolled validation
  stays the authority", `:976-980`). Pinning `invalid_message_send` there would be
  false-red against the wave-tools idiom. The fold therefore pins
  `/unknown_argument_field/` on the forged legs (sibling suites pin the same code:
  `phase62-mcp-goal-plan.test.mjs:252`) and adds six new malformed-DECLARED-field legs,
  one per tool, matching the named guard codes: `invalid_message_send`,
  `invalid_message_receipt`, `invalid_attention_watch`, `invalid_scratchpad_read`,
  `invalid_scratchpad_elevate`, `invalid_knowledge_seed`.
- **`stale_scratchpad_fence` behavioral hole** — folded cheap: FP-10-store-direct (guard)
  gains a store-direct leg — a caller pinning a non-live fence with no prior reap under it
  (`expectedScratchpadFence: fence + 1`) throws `stale_scratchpad_fence`
  (check order verified at `impl/src/coordination-store.mjs:13786-13809`: reapKey prior-hit
  first, fence mismatch second). The guard stays green — the lane throws it today. The
  RACE half (the facade wrapper's live fence read vs a concurrent reap) is not
  deterministically stageable and stays a documented note.
- **`scratchpad_partition_exhausted` behavioral hole** — deferral documented in the same
  guard row: staging needs the shared partition filled to its 512-entry ceiling
  (`MAX_SCRATCHPAD_SHARED_ENTRIES`, `:491-492`), not a cheap fixture; the static wire
  mapping (FP-15) stands as its only pin today.

## Deliberately NOT changed

- **FP-19's WEAK six-tool loop** — left as-is per the report (G2: today-substance accepted;
  the loop is vacuous today by construction and gains teeth post-implementation; the
  settlement half is SOUND and live) and per the fold instruction.
- **No red row weakened.** Every fold addition is an oracle tightening, a future-green
  repair, a guard strengthening, or a comment/header correction.
- **No new `test()` rows** — the suite stays at 37 rows; legs fold inside existing rows.
- **Decision 1's carve-out, the C3/C3b receipt semantics, the static assertion's banned
  pattern list** — untouched.
- **T5** (FP-09-read post-write freshness leg) — outside the fold's flag list; not staged.

## Verification

1. Baseline re-measured before any edit: 37 / 3 / 34 (matches the blue team's §0 record).
2. WS-01 future-green shapes probe-verified end-to-end with ONLY today's facade verbs
   (run.start / waves.start / run.status / run.approve / run.debug / run.answer /
   decisionList / waves.attach) on the suite's exact fixture: stall → advertised
   `{kind: 'approve_plan', planDigest}` → approve → dispatch → decision gate → answer →
   terminal → taskId discovery; truncated attach → `wave_attach_unknown_wave`, full attach →
   2 outcomes + detached.
3. Post-fold re-run from the repo root: 37 / 3 / 34. Guards green: FP-10-store-direct
   (with the new stale-fence leg), FP-19, FP-16-conformance.
4. Stage re-checks on every edited red row: WS-01 fails at step 1
   (`unsupported application command run.knowledge.seed`, AFTER the static assertion
   passes — the script additions carry zero banned patterns); FP-05 at the first constancy
   assert; FP-08 at `unsupported application command run.attention.watch`; FP-14-tools at
   the includes loop; FP-14-dispatch at the first dispatch case; FP-16-parse at
   `unexpected argument send`.
5. `node --check` clean on the suite.

## Files touched

- `impl/test/workflow-surface-red.test.mjs` — suite edits (above).
- `docs/reference/evidence/facade-projection-2026-08-03/facade-projection-contract.md` —
  v2.2 (above).
- `docs/reference/evidence/facade-projection-2026-08-03/suite-fold.md` — this file.
