# Dogfood review — validation claims to change after phase 10.1

*A Claude session worker, driven by `createDriver()` through the phase-10.1 capstone harness
(`docs/reference/evidence/phase10.1-capstone-2026-07-10/run.mjs`), reviewing the harness that
spawned it. Scope: which claims in `impl/VALIDATION.md` are now stale, and what the live capstone
must show to be accepted.*

**Baseline.** `impl/VALIDATION.md` is a phase-6 judgment with addenda appended through phase 9; its
last recorded suite is **372/372** (`impl/VALIDATION.md:147`) and its completeness-audit addendum
(`impl/VALIDATION.md:47–59`) is written against pre-phase-10 code. Phase 10 wired the session
adapters into `createDriver()`; phase 10.1 (`spec/phase10.1/spawn-stop-reconciliation.md`) is the
erratum that reconciled the spawn/stop races that assembly introduced, closing SC12–SC20. The suite
is now **427/427** (`docs/handoff/evidence/phase10.1-reverification.md:49`;
`docs/handoff/evidence/phase10.1-adversarial-review.md:82`). VALIDATION.md has not yet been
rewritten to reflect any of this — `docs/24-goal-system-completion.md:54` lists that rewrite as an
open definition-of-done item.

## Validation claims that must change after phase 10.1

Each row: the stale claim (with its current location), and what phase-10/10.1 evidence requires it
to become.

1. **Suite size — every count is stale.** VALIDATION cites 259, 273, 336, 340, 370, 372
   (`impl/VALIDATION.md:3,26,65,83,104,147`). Must become **427/427**
   (`docs/handoff/evidence/phase10.1-reverification.md:49`).

2. **"`accept()` ... never actually gates 'done.'"** (`impl/VALIDATION.md:51`). **Retire.** G2 is
   FIXED: the accept return is captured and branches the done-gate
   (`docs/24-goal-system-completion.md:116`, coordinator.mjs:839/856, index.mjs:93–94).

3. **"Interruption is dependable — PARTIAL ... `_forceStop` fires only inside `tick()` ... can
   hang."** (`impl/VALIDATION.md:52`). **Upgrade.** G4 is FIXED — a real unref'd deadline timer is
   armed in `_beginStop`, tick sweep demoted to backup, test-locked
   (`docs/24-goal-system-completion.md:118`). Phase 10.1 then hardened interrupt/kill against the
   *spawn/delivery* races assembly exposed: SC12 makes a pending spawn cancellable so interrupt/kill
   during `worktreeReady` creates zero children; SC14 stops a queued send from crossing a stop
   boundary; R-4 clears the wall timer on native interrupt
   (`spec/phase10.1/spawn-stop-reconciliation.md:14–36,54–67`;
   `docs/handoff/evidence/phase10.1-adversarial-review.md:61–66`). The dependability claim now rests
   on SC12–SC14 + R-4, not only phase-6 two-phase stop.

4. **"Routing learns ... but it never ROUTES. `router.pick()` is never called in `src/`."**
   (`impl/VALIDATION.md:54`). **Retire.** G6 is FIXED — real selection with null-means-queue and a
   first-listed-wins collision rule, learn-hook fed from the verified accept
   (`docs/24-goal-system-completion.md:120`, index.mjs:77–84). `route()` now also selects on
   `nonRefuserFor` capability tags (`impl/src/index.mjs:76–79`), which VALIDATION lists as not-built
   (`impl/VALIDATION.md:34`).

5. **"Vendor attribution — BROKEN in the shipped path."** (`impl/VALIDATION.md:55`). **Retire.** G3
   is FIXED — C5 threads `handle.vendor` through capture to the `Baton-Vendor` trailer
   (`docs/24-goal-system-completion.md:117`).

6. **"'.baton/' exclusion is a setup requirement ... a small gap to close."**
   (`impl/VALIDATION.md:32`). **Retire.** G8 is FIXED — `ensureBatonExcluded` is idempotent and
   called from `pinBaseSha` on the shipped path (`docs/24-goal-system-completion.md:122`).

7. **"the story narrative still shows a completed worker as 'active' ... cosmetic gap."**
   (`impl/VALIDATION.md:33`). **Rewrite — it was correctness, not cosmetic.** SC17 derives story
   completion from lifecycle facts: `lifecycle.crashed` is never counted/rendered as done, a clean
   `lifecycle.exited` counts as done, and `lastVerdict` is cleared by the next `turn_started` so a
   worker cannot be simultaneously active and done
   (`spec/phase10.1/spawn-stop-reconciliation.md:83–89`). R-3 further closed an accepted-verdict
   OR-branch that could still count a crashed worker as done
   (`docs/handoff/evidence/phase10.1-adversarial-review.md:57–60`).

8. **"Assembly into `createDriver()` remains the shared next milestone ... deliberately unwired."**
   (`impl/VALIDATION.md:123–124`). **Retire.** The three session adapters are now exported and
   constructible (`impl/src/index.mjs:22–24`) and driven through `createDriver()` by the capstone
   harness (`run.mjs:10,42`). Note SC12's finding that assembly was *worse than believed* pre-fix —
   two incompatible `spawn()` contracts, with codex/grok silently running in the orchestrator's own
   cwd (`docs/24-goal-system-completion.md:115`) — is exactly what phase 10.1 closed.

9. **"One-shot mode only ... Mid-run steering/answers/approvals return 'unsupported.'"**
   (`impl/VALIDATION.md:31`). **Reframe.** Session-mode is now the product posture; one-shot is the
   explicitly fire-and-forget legacy tier, not the harness's ceiling
   (`docs/24-goal-system-completion.md:64–65`;
   `docs/handoff/evidence/phase10.1-adversarial-review.md:74–75`). Live mid-turn steer, interrupt,
   and approvals are exercised by the capstone (`run.mjs:139–148,90`).

10. **New terminal vocabulary VALIDATION never records.** Phase 10.1 adds `cancelled` as a terminal
    task status distinct from `failed` — a user cancellation must never become `failed`, and a
    confirmed stop must never be followed by a fabricated `lifecycle.crashed{phase:'spawn'}` (SC13,
    `spec/phase10.1/spawn-stop-reconciliation.md:37–52`). VALIDATION's status vocabulary
    (completed/failed) is incomplete.

11. **"rebuilds its state from [the log] on restart" as an unqualified strength.**
    (`impl/VALIDATION.md:11`). **Qualify.** R-2 found runtime terminal monotonicity was *not* replay
    monotonicity — a restart could change a completed/cancelled result until terminal monotonicity
    was applied to every replay row (`docs/handoff/evidence/phase10.1-adversarial-review.md:50–55`).
    The strength is now real, but only as of the phase-10.1 fix.

12. **"Recommended next step: driving a real vendor pair ... is now done (phase 7) ... E2
    remains."** (`impl/VALIDATION.md:43`). **Reframe.** The current milestone is the *driver-level*
    multi-vendor live capstone (≥3 real vendors concurrently through `createDriver()`,
    `docs/24-goal-system-completion.md:38–40,144–147`), not a hand-wired vendor pair. E2 cross-vendor
    decorrelation is now an explicit **phase-11 non-goal** (`docs/24-goal-system-completion.md:150`).

## Recursive dogfood implications

This review is itself the `dogfood-claude-validation` capstone task (`run.mjs:52–56`): a real Claude
session worker, spawned and steered by the very coordinator it is assessing. The steer that added
this heading arrived mid-turn over `control.steer` (`run.mjs:139–143`) — a live demonstration of the
SC14 delivery path and the session-mode posture that VALIDATION.md still labels "unsupported."
Baton-on-Baton dogfooding is only sanctioned because SC20's zero-quota safety gate passed first
(`spec/phase10.1/spawn-stop-reconciliation.md:107–110`;
`docs/handoff/evidence/phase10.1-adversarial-review.md:81–85`). The implication for VALIDATION.md:
the honest record can no longer be a phase-6 judgment with a trailing audit-addendum; it must state
that the built-not-wired seams the audit named are now wired *and* that wiring them surfaced a new
race cluster (U-1…U-11) which required its own erratum before the system was safe to self-host.

Keeping the record honest means separating what shipped from what is still owed:

**Shipped session behavior (SC12–SC20, 427/427 green, review-gated):**
- SC12 — spawn is a reserved, cancellable lifecycle; no interval where a child is owned by neither
  the pending-spawn reservation nor the live registry (`spec/…:14–36`).
- SC13/SC15 — `cancelled` is terminal and monotonic; rejected and refused spawns are one durable
  failure channel; cancellation never degrades to `failed` (`spec/…:37–52,70–74`).
- SC14 — queued delivery cannot cross a stop boundary; adapter `{ok:false}` is a failed delivery,
  not a logged success (`spec/…:54–67`).
- SC16 — failed setup owns child teardown; a refused Ack means no process remains (`spec/…:76–80`).
- SC17 — story completion derived from lifecycle facts, not stale verdicts (`spec/…:83–89`).
- SC18 — session **wall-time** budget enforced: `timeoutMs` arms one timer, expiry emits one
  `lifecycle.crashed{phase:'timeout'}` and reaps the child (`spec/…:90–98`).
- R-1…R-4 — late-worktree reap, replay monotonicity, story crash-fact, interrupt-clears-timer, all
  fixed and test-locked during the SC20 review
  (`docs/handoff/evidence/phase10.1-adversarial-review.md:40–69`).

**Phase-11 governance debt (explicitly NOT shipped, do not claim):**
- **Token/USD threshold policy and the governance watchdog** — SC18 closes only the lost wall-time
  bound; spend-based enforcement and story-driven watchdog action are separate phase-11 work
  (`spec/phase10.1/spawn-stop-reconciliation.md:97–98`;
  `docs/handoff/evidence/phase10.1-adversarial-review.md:76–77`).
- **Coordinator restart *reattachment* to live vendor sessions** — SC13 guarantees replayed task
  *truth*, not process reattachment; a named phase-11/non-goal
  (`docs/handoff/evidence/phase10.1-adversarial-review.md:78`;
  `docs/24-goal-system-completion.md:157`).
- **E2 cross-vendor decorrelation eval** and the **MCP northbound surface** — phase-11 candidates,
  named non-goals here (`docs/24-goal-system-completion.md:150–154`).

VALIDATION.md must not let the shipped wall-time bound (SC18) read as spend governance, and must not
recite E2 as a "recommended next step" — it now sits behind the completed-fleet gate.

## Live-capstone acceptance checklist

The capstone (`run.mjs`) is accepted only when `summary.pass === true` — every check below is true
(`run.mjs:191–201`). This maps directly onto `docs/24-goal-system-completion.md:38–40,144–147`.

- [ ] **No harness error** — `fatal === null` (`run.mjs:192`).
- [ ] **Three vendors completed** — claude, codex, grok all reach `status: 'completed'`
  concurrently (`run.mjs:193`; `docs/24…:38`).
- [ ] **Every completion trust-gated** — each completing worker carries a `verify.reverified` event
  with `accept === true` (fresh-worktree re-verification, never the worker's word)
  (`run.mjs:194`; `docs/24…:39–40`).
- [ ] **Steer landed** — the Claude steer Ack is `ok` and a `control.steer` event is present
  (`run.mjs:195`) — i.e. this review's own steer is recorded on-wire.
- [ ] **Interrupt landed** — the interrupt-target (codex broad-source audit) Ack is `confirmed` and
  its task result is `cancelled`, not `failed` (`run.mjs:196`; SC13).
- [ ] **Approval exercised** — at least one live approval was answered `allow` (`run.mjs:90,197`).
- [ ] **Vendors overlapped** — all worker turn-starts precede the earliest terminal, proving genuine
  concurrency rather than serialized runs (`run.mjs:173–175,198`).
- [ ] **GLM recorded, not faked** — if `Z_AI_API_KEY`/`ZHIPU_API_KEY` is present, GLM is
  `credential-present-not-run`; if absent, it is logged `PENDING-LIVE-no-credential`, checked by
  presence only, value never printed (`run.mjs:182`;
  `docs/24-goal-system-completion.md:48–49,75`).
- [ ] **Evidence committed** — `events.jsonl` and `summary.json` written under
  `docs/reference/evidence/phase10.1-capstone-2026-07-10/` (`run.mjs:204–205`; `docs/24…:40,147`).
- [ ] **Then, and only then, rewrite the record** — `impl/VALIDATION.md` rewritten (not appended) to
  the completed-system state, folding claims 1–12 above; docs/01–02 matrix rows made accurate
  (`docs/24-goal-system-completion.md:54–56`).

*Pre-condition already met:* SC20's zero-quota gate (full suite + fresh adversarial review, no
unresolved critical/major correctness finding) passed before this capstone was allowed to spend
vendor quota (`spec/phase10.1/spawn-stop-reconciliation.md:107–110`;
`docs/handoff/evidence/phase10.1-adversarial-review.md:81–85`).
