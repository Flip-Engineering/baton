# BLUETEAM-161 — blue-team attack on `impl/test/orchestrator-plan-object-red.test.mjs`

`[attempt: 08338cdd-d549-4375-98ee-af1a313938d5 row-bt161]`

- **Row:** `row-bt161` (blue-team foundry wave-a) · **Date:** 2026-08-13
- **Target:** `impl/test/orchestrator-plan-object-red.test.mjs` (47 rows — 42 RED + 5 pins)
- **Authority:** `docs/reference/evidence/orchestrator-plan-object-2026-08-13/orchestrator-plan-object-contract.md`
  (v2.0 FOLDED) + `redteam-161.md` + `fold-161.md` + `blue-team-2026-08-13-a/foundry-brief.md` (law)
- **Suite attempt marker (header):** `[attempt: 08d0dac7-8ad0-4e7c-a13e-9d7a3bb855bc row-suite-161]`
- **Verification HEAD:** `master` = `f14cf69` (the tree the suite is anchored to; the fold's
  verification HEAD `e371f70` is a branch snapshot not reachable from master — red-team §1)
- **Verdict:** **NEEDS-FOLD**

---

## 1. Split re-run (twice, pristine `master` = `f14cf69`)

`node --test test/orchestrator-plan-object-red.test.mjs` from `impl/` in a pristine worktree at
`f14cf69` (`/tmp/bt161-pristine`), `impl/node_modules` symlinked:

| Run | tests | pass | fail | exit | green pins |
|---|---|---|---|---|---|
| 1 | 47 | 5 | 42 | 1 | F4, R1, R2, R3, R4 |
| 2 | 47 | 5 | 42 | 1 | F4, R1, R2, R3, R4 |

Both runs match the declared notes (**5 pass / 42 fail = 47**, exit code 1). Stable — no
instability finding. Raw records: `/tmp/split-a1.txt` (47/5/42), `/tmp/split-a2.txt` (47/5/42).

## 2. The empirical bite-test: a whole-suite wrong implementation flips 47/47 green

The cheapest wrong implementation that turns the ENTIRE suite green is an **in-memory plan lane**
with **no-op store fold seams**, **string-seat authority**, and **hand-edited surface artifacts**:

- **`application.mjs`** — a `WeakMap`-keyed in-memory lane (`_planLaneRegistry`: `byId`/`byKey`
  Maps) with `plan.write`/`plan.read` direct ports dispatched pre-gate (the G6 pattern). Version
  CAS runs BEFORE the G4 replay dedup (so a stale write refuses `plan_stale_version` even under a
  previously-seen versioned key). Authority is **principalId-string discrimination**:
  `/^worker:member-(.+)$/` → role string, `/^worker:coordinator-wave(\d+)$/` → wave string,
  `'orchestrator'` → full access. No durability, no `plan:*` capability composition (H2.1), no
  wave-registry roster (H2.2). Done-task evidence is **synthesized at read time**.
- **`coordination-store.mjs`** — `'plan_auto_demote'` added to the closed `_appendBatch`
  batch-kind list; a **no-op** `else if (event.kind === 'plan.minted' || …) ` fold branch so the
  events append without building any `_plans`/`_planTasks` projection.
- **`application-cli.mjs`** — `baton plan read`/`baton plan write --mutation JSON` parse branches
  + `CLI_WEB_COMMANDS` entries.
- **Hand-edits** — `surface-divergence-ledger.json` (2 rows), `application-semantics.mjs` (a
  comment claiming `plan.read`/`plan.write` surfaces), `mcp-northbound.mjs` (tool defs),
  `CLI.md`/`MCP.md` (doc rows).

Result: **47/47 green, exit 0, stable across two runs** (`/tmp/run-wrongimpl2.txt`,
`/tmp/run-wrongimpl3.txt`). Every RED row and every pin flips green under it. The suite as a
whole does not pin D1 durability, H2.1/H2.2 authority, the wave.closed elevation hook, the
interpreter gate, or the surface-regeneration seams.

## 3. The decisive suite defect (construction-order vs sorted-order)

The suite's own `task()` fixture (`suite line ~287`) builds every task in **construction order**
`schemaVersion, id, title, status, blockedBy, ownedBy, evidence, taskVersion`. The contract D1
pins the task object as **validating** in the canonical **sorted** literal
`['blockedBy','evidence','id','ownedBy','schemaVersion','status','taskVersion','title']`, and
**S3** mints a reordered literal and expects `plan_task_invalid` ("a key set in any other order is
a non-closed shape"). A correct fold implementing the D1/S3 sorted-order refusal **refuses the
suite's own valid mints** (M1, S4–S8, L1–L7, A1–A5, W1/W2, Q1/Q2, O1 — every fixture-driven mint).
The suite is internally inconsistent: **S3's pin and the valid fixtures cannot both hold under the
correct implementation.** The wrong impl resolves it by accepting BOTH orders (sorted AND
construction), which is exactly why the whole suite flips green. This is a top-tier
**NEEDS-FOLD** finding.

## 4. Per-row verdicts

Legend: **SOUND** = the cheapest passing wrong impl is the contract behavior itself (no shortcut) ·
**SHALLOW** = a named cheap wrong impl passes · **BROKEN** = green/red for the wrong reason (the
row's fixture is inert or the row is self-contradictory) · **DECORATIVE** = pin bites nothing.

### §P1 mint + update + idempotency (M1–M5)

| Row | Verdict | Cheapest wrong impl / note |
|---|---|---|
| M1 | SHALLOW | In-memory `Map<planId,plan>` mint + read round-trip; D1 **durability is never asserted** (no durable event, no replay check). |
| M2 | SHALLOW | In-memory `byKey` dedup returning the prior outcome; G4's store-level prior-key adjudication is not pinned. |
| M3 | SHALLOW | In-memory digest compare on the `byKey` map; the store content-digest seam is not pinned. |
| M4 | SOUND | Update path asserted directly (upsert v1→v2, `taskVersion` becomes 2) — requires real versioned upsert. |
| M5 | SOUND | Stale `expectedTaskVersion` must refuse `plan_stale_version` — requires the real version-CAS. |

### §P2 replay / fold seam (F1–F3 RED + F4 pin)

| Row | Verdict | Cheapest wrong impl / note |
|---|---|---|
| F1 | SHALLOW | A 2-line no-op `_apply` branch (register the kind) suffices; only durability of the event is asserted — **no projection is read back**. |
| F2 | SHALLOW | Same no-op fold branch; `plan.task_transitioned` accepted without folding. |
| F3 | SHALLOW | Adding `'plan_auto_demote'` to the closed batch-kind list suffices; the batch is **never exercised**. |
| F4 PIN | SOUND | Bites a fold that loses facts across checkpoint/replay (byte-identical snapshot asserted on close/reopen). |

### §P3 closed shape + topology (S1–S8, N1, N2)

| Row | Verdict | Cheapest wrong impl / note |
|---|---|---|
| S1 | SOUND | Closed-shape refusal requires real key-set/title validation. |
| S2 | SOUND | Unknown-field refusal requires real closed-key validation. |
| S3 | **BROKEN** | The sorted-order pin contradicts the suite's own construction-order fixtures — a sorted-only fold refuses every valid mint (see §3). The row cannot hold in context. |
| S4 | SOUND | Self-edge topology refusal requires real DAG validation. |
| S5 | SOUND | Dangling-edge topology refusal. |
| S6 | SOUND | Cycle topology refusal. |
| S7 | SOUND | Closed-status refusal. |
| S8 | SOUND | Canonical sorted emission on read is asserted directly. |
| N1 | SOUND | `plan_not_found` on an unminted id requires an existence check. |
| N2 | SOUND | `plan_task_not_found` on an absent task. |

### §P4 status law / exactly-one-in-progress (L1–L7)

| Row | Verdict | Cheapest wrong impl / note |
|---|---|---|
| L1 | SHALLOW | The **subtree key is underdetermined**: only same-wave-same-run is exercised; a wave-only doing-check suffices, and the contract's `wave/run` composite key is never pinned (no same-wave/diff-run case). |
| L2 | SHALLOW | Only diff-wave/diff-run exercised; does not pin the composite key either. |
| L3 | SOUND | Immediate done marking + version bump + stale re-transition refusal all asserted directly. |
| L4 | SHALLOW | The review boundary is the **principalId string `'orchestrator'`**; the H2.1 capability seam is never exercised. |
| L5 | SHALLOW | Same string-seat re-open (the one admitted `done → todo` path). |
| L6 | SHALLOW | A hardcoded `maxFocusTasks === 4` ceiling satisfies the row; the deployment-owned `planPolicy` seam (foundry law: no arbitrary numeric limits) is not pinned. |
| L7 | SOUND | Focus version-CAS + stale refusal asserted directly (1 → 2 bump). |

### §P5 authority matrix (A1–A5)

| Row | Verdict | Cheapest wrong impl / note |
|---|---|---|
| A1–A5 | SHALLOW (each) | The whole matrix is **principalId-string satisfiable** (member/coordinator regex + `'orchestrator'` string). The fixture principals carry **no capabilities** and no wave-registry roster is set up, so H2.1 (deployment-authorize `plan:*`) and H2.2 (roster resolution) are never exercised. |

### §P6 elevation at wave close (W1, W2)

| Row | Verdict | Cheapest wrong impl / note |
|---|---|---|
| W1 | SHALLOW | The wave.closed hook is **never triggered or asserted** — the row's own `try/catch` explicitly tolerates the record being gated at HEAD. Read-time evidence synthesis passes without any `plan.task_evidence_linked` event; the incomplete-task revert is trivially the minted `todo`. |
| W2 | SHALLOW | The review re-open is the `'orchestrator'` string seat; "an unreviewed/incomplete task never reads done" is satisfied by the minted state. |

### §P7 three-surface admission (X1–X7)

| Row | Verdict | Cheapest wrong impl / note |
|---|---|---|
| X1 | SOUND | The parser must actually compile `baton plan read` → `plan.read`; a ghost/refusal shortcut fails. |
| X2 | SOUND | The parser must compile `plan write --mutation JSON` AND refuse a malformed body with `cli_invalid` naming the mutation shape. |
| X3 | SOUND | The whitelist must admit both names (with X1/X2, admission is pinned end-to-end). |
| X4 | SHALLOW | A **hand-edit of `surface-divergence-ledger.json`** suffices; no regeneration/conformance gate. |
| X5 | SHALLOW | **Advertise-but-dead** tool — the row asserts `tools/list` + `mcpApplicationToolNames` only, never a dispatch. |
| X6 | SHALLOW | A **comment in the OPERATION_ROWS region** satisfies the text scan (the wrong impl literally inserted a comment claiming the surfaces). |
| X7 | SHALLOW | Doc-text rows hand-edited into `CLI.md`/`MCP.md`; no regeneration gate asserted. |

### §P8 #74 integration (Q1, Q2)

| Row | Verdict | Cheapest wrong impl / note |
|---|---|---|
| Q1 | SHALLOW | String wave-match + ownedBy pass-through; the wave-registry roster resolution (H2.2) is never exercised. |
| Q2 | **BROKEN** | The row's stated intent — the interpreter gate (`blocked → dispatch_pending`, `done → settleable`) — is **never asserted**. The body only checks two transitions succeed; it is a duplicate of the A1 admission pattern with an inert fixture for its named gate. |

### §P9 orchestrator practice migration (O1)

| Row | Verdict | Cheapest wrong impl / note |
|---|---|---|
| O1 | SHALLOW | A pass-through read of the minted statuses satisfies it; the "per-wave-subtree exactly-one-in-progress is observable" claim is the fixture's minted value, not an enforcement. |

### Pins (F4, R1–R4) — pin-bite

| Pin | Kills | Verdict |
|---|---|---|
| F4 | A fold that loses facts across checkpoint/replay (byte-identical snapshot). | SOUND |
| R1 | A wrong impl that renames/refolds `application_unauthorized` (routes the facade denial through a plan code). | SOUND |
| R2 | A wrong impl that renames/removes/reorders a `WAITING_ON_KINDS` member (e.g. swapping `dispatch_pending` for a plan-task gate kind). | SOUND |
| R3 | A wrong impl that adds a fourth `SCRATCHPAD_STEP_STATES` status. | SOUND |
| R4 | A wrong impl that widens the goal-plan `^plan:[a-f0-9]{64}$` validator to accept a `plan:<hex32>` plan-object id (collapsing the two `plan:` namespaces). | SOUND |

No pin is decorative.

### Pin bite-test evidence (empirical, all five pins)

Each pin was bite-tested by mutating the exact seam it guards in the `/tmp/bt161-bite` worktree at
`master` (`f14cf69`), running only that pin via `node --test --test-name-pattern="<PIN>"`, confirming
it goes RED, then reverting with `git checkout --`:

| Pin | Mutation (the wrong impl seam) | Result | Reverted |
|---|---|---|---|
| F4 | `coordination-store.mjs` checkpoint-restore replay tail-drop: the `checkpoint.events` replay loop `index < (checkpoint.events ?? []).length` → `...length - 1` (a fold that loses the last fact across close/reopen) | **RED** — `replay.snapshot()` has `lastSeq: 0` vs live `lastSeq: 1`; `replay.events().length` 0 vs 1 | yes |
| R1 | `application.mjs:3222` facade denial rerouted through a plan-authority code instead of `application_unauthorized` | **RED** | yes |
| R2 | `application-semantics.mjs:59-61` `WAITING_ON_KINDS` member `dispatch_pending` → `plan_blocked` | **RED** | yes |
| R3 | `coordination-store.mjs:537` `SCRATCHPAD_STEP_STATES` gains a fourth status (`'paused'`) | **RED** | yes |
| R4 | `web-northbound.mjs:457` (and `:354`) goal-plan validator widened `^plan:[a-f0-9]{64}$` → `{32,64}` (admits `plan:<hex32>`) | **RED** | yes |

Note on F4's seam: a naive tail-drop of the ledger `lines` loop does **not** bite — after
`releaseWriterLease()` writes `projection.checkpoint`, the reopen replays from the checkpoint's
cached `_events` array (`checkpoint.throughSeq = 1`, `lines` empty). The genuinely lossy seam is the
checkpoint-restore replay loop. A wrong impl that drops the checkpointed tail fact (or skips the
checkpoint-restore replay entirely) is what F4 kills.

## 5. Law re-check (the blue-team frame)

- **Named stages on every capability row:** PASS — all 47 rows carry `'stage: …'` strings.
- **Hermetic fixtures:** PASS — `mkdtemp`/`tmpdir` + `t.after` cleanup, `MockAdapter`, no network/provider.
- **No clocks as controls:** PASS — fixed `NOW = Date.parse(...)`; `watchdog.stallMs 60_000` + comment.
- **Namespace imports for invented surfaces:** PASS — imports via `../src/index.mjs` namespaced bindings.
- **Sorted-key literals ACTUAL order:** PASS — `TASK_KEY_ORDER` and `OWNED_BY_KEY_ORDER` are the
  alphabetical (sorted) literals matching contract D1.
- **No absolute line-window anchors:** PASS — X6 is content-anchored (`indexOf` region).
- **Verbatim `[attempt: …]` in suite header:** PASS — line 2.

## 6. Shared-scratchpad publish (title `#161`) — exact refusal recorded

The row brief requires the full report also be published to the `shared` scratchpad partition. I
attempted the publish against the pristine tree by driving the real application:

- `application.command('runs.list', {}, principal('orchestrator'))` → **OK** (the principal shape
  and application boot are fine).
- `application.command('run.scratchpad.append', { runId: 'run:r1', scope: 'shared', kind: 'note',
  title: '#161', body }, principal('orchestrator'))` → **REFUSED** with
  `{"code":"application_command_unavailable","message":"unsupported application command run.scratchpad.append"}`.

The verb is **unlanded at this HEAD** (`run.scratchpad.append` appears in 0 of
`application.mjs`/`application-cli.mjs` — it is the RED state of the #158 scratchpad-write row), so
no publish channel is reachable from this worktree. This matches red-team §10 and fold §0. The
durable file is the runtime handoff.

## 7. Execution contract

Per the row's execution contract (executable `"true"`, argv `[]`, cwd `.`, expected exit code
`0`): no code is changed — the deliverable is this report. Only files edited/created in the main
repo: `docs/reference/evidence/blue-team-2026-08-13-a/blueteam-161.md` (this file). All empirical
work was run in throwaway `/tmp` worktrees (`/tmp/bt161-pristine` — split re-runs; `/tmp/bt161-bite`
— the five pin bite-tests; `/tmp/bt161-master` — the whole-suite wrong impl).

## 8. Final verdict: **NEEDS-FOLD**

The suite is fully attackable by a cheap in-memory facade + string-seat authority + no-op fold
wrong impl (47/47 green), and it contains two genuinely broken rows:

- **S3 (BROKEN)** — the sorted-order pin is unrepresentable in context: the suite's own fixtures
  are construction-order, so a correct sorted-only fold refuses every valid mint. Either the
  fixtures must build the canonical sorted literal, or the fold canonicalizes mint input and S3's
  refusal is reworded to a canonicalization seam.
- **Q2 (BROKEN)** — the named interpreter gate is never asserted; the row is admission-only.

**Concrete fold instruction set:**
1. Rebuild the `task()` fixture to emit the canonical sorted literal (or pin the canonicalization
   seam explicitly) so S3 and the fixtures stop contradicting (§3).
2. Q2 must actually exercise the interpreter gate (`dispatch_pending` on a blocked task,
   settleable on a done task) — assert the gate output, not just two successful transitions.
3. W1 must trigger/assert the wave.closed hook (a `plan.task_evidence_linked` event or a
   projection-level elevation) instead of tolerating the record being gated.
4. The authority rows (A1–A5, L4/L5, Q1) must pin H2.1/H2.2: capability-carrying principals
   and/or a wave-registry roster, so the string-seat facade fails.
5. M1–M3 and F1–F3 must assert the durable projection (a store snapshot read-back of the plan /
   replay-derived `_plans` map), so the in-memory lane and the no-op fold fail.
6. L1/L2 need a same-wave/different-run case to pin the `wave/run` subtree key; L6 must read the
   bound from the deployment `planPolicy`, not a hardcoded `4`.
7. X4/X5/X6/X7 need regeneration/conformance gates (grep-the-doc-from-registry, a dispatch call,
   a real registry row claim) so the hand-edit/advertise-but-dead/comment shortcuts fail.
