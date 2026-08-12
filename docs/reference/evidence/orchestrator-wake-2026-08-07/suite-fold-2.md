# #71 SUITE-FOLD-2 — blue-team findings → suite resolutions

- **Fold target:** `impl/test/orchestrator-wake-red.test.mjs` (the red-first acceptance suite),
  `suite-draft-notes.md` (updated), `orchestrator-wake-contract.md` (v1.2 amendment).
- **Blue-team report:** `suite-blueteam.md` (this directory) — verdict **NEEDS-FOLD**, ten
  findings F1-F10, each with its concrete fix.
- **Fold brief:** `suite-fold-2-brief.md` (this directory) — read fully; the green-side blockers
  first, the shallow-greenability hardening, and all ten findings resolved or explicitly deferred.
- **Verification HEAD:** `0792e5e` (this worktree's effective-tree snapshot; the suite's prior
  recorded HEAD `e9cdd0c` drifted — F10). Every `file:line` citation below was re-verified with
  `grep -an`/`sed -n` at this HEAD. NUL discipline held: `application.mjs` and
  `coordination-store.mjs` were read only through `readFileSync`/`grep -an` slices, never whole.
- **Date:** 2026-08-07.

## Verdict

All ten findings are addressed: nine by folds into the suite (F1-F5, F8-F10) plus the contract
v1.2 amendment (F3's wake-cancelled code, F7's W-9 reconciliation), F6 by a strengthened
source-pin with its behavioral half explicitly deferred (the 65+ live-member staging is
infeasible under the hermetic single-member fixture — see the Deferred section), and F9 by a
settled-boundary seam. The suite stays red-first: 36 rows, 6 PINs green, 30 RED rows each failing
at a named stage, the split deterministic across two runs from the repo root.

## Verified split (both runs from the repo root)

```
$ node --test impl/test/orchestrator-wake-red.test.mjs   # run from repo root
ℹ tests 36
ℹ pass 6
ℹ fail 30
```

Run 1 and Run 2 are identical (36 tests / 6 pass / 30 fail; the normalized `✔`/`✖` spec lines
diff → empty). All 30 RED rows fail at a named stage — mechanically verified: every failing
assertion carries a `stage[…]` marker (22 at `attention-wait-command-missing`, 3 at
`baton-attention-wait-tool-missing`, 2 at `web-envelope-missing`, 1 each at
`cli-grammar-missing` / `mcp-allowlist-missing` / `WAKE_REASONS-missing`). The 6 PINs
(ALREADY-RESOLVED, WAITING-ON-KINDS-PIN, ATTENTION-TYPES-PIN, LIMITS-PIN, STORE-VISIBLE,
EXISTING-PINS) are green.

Deployment verification: executable `true`, arguments `[]`, cwd `.` → exit **0** (the suite's
own `PROFILE.verification`; verified at fold time).

---

## 1. Finding → resolution (all 10)

### F1 — RETURN-TRIP depends on real wall time with no injectable clock (#7-class) → RESOLVED

**Gap (blueteam).** RETURN-TRIP escaped the 500 ms member-terminal storm-coalescing window with
`await sleep(600)` — real wall time, exactly the #7 class the brief bans. A correct v1.1 impl
with a raised coalescing window would go red; a shortened window would let a wrong impl go green.

**Resolution.** The fixture clock is now injectable: `wakeFixture(t, { now })` forwards
`now.now` into `createDriver`, and — verified at `0792e5e` — `createDriver` DOES pass `now` into
the `Coordinator` (`index.mjs:1488`, `const now = opts.now ?? Date.now` at `:1170`), so the
controllable clock is a pure fixture seam; no source edit was needed (the blueteam's claim that
`createDriver` "never forwards it" does not hold at this HEAD). RETURN-TRIP now constructs a
`controllableClock()`, passes it to `wakeFixture`, and calls `clock.advance(600)` between the two
`lifecycle.turn_completed` emits. `sleep(600)` is deleted. The advance is explicit and
deterministic — never wall-time-derived.

**Consequence.** The row's green path no longer depends on real elapsed time; a right v1.1 impl
coalescing within the window stays green only when the clock is advanced past it, and the row
fails at `attention-wait-command-missing` at HEAD exactly as before.

### F2 — W-1's no-poll-timer property is unpinned; every row is transport-blind → RESOLVED

**Gap (blueteam).** No row asserted that `coordination.waitAfter` was actually invoked — a
`_waitPollMs`-style poll loop passes every outcome assertion.

**Resolution.** WAIT-HONEST-EMPTY now wraps/spies `fx.coordination.waitAfter` (bind-and-replace
on the fixture) before the wake, records `{afterSeq, timeoutMs}` on every call, and asserts:
the wake held a `waitAfter` on the quiet hot path (`waitCalls.length >= 1`), the held anchor is
the `storeCursor` the wake pages (`waitCalls[0].afterSeq === 0`), the bound is a positive safe
integer, and the honest empty echoes the cursor the waiter held
(`result.storeCursor === waitCalls[0].afterSeq`). No clock, no timing assumption.

**Consequence.** A poll-loop costume no longer passes: it would have to call `waitAfter` with the
split cursor and return the held cursor, which pins the waitAfter-anchored transport itself.

### F3 — the cancellation path (H7) has zero coverage → RESOLVED (two new rows + v1.2 code)

**Gap (blueteam).** H7's disconnect→abort discipline was never tested: the
`coordination_wait_aborted` → wake-cancelled translation is unpinned, and the MCP TIGHT ceiling
guard had no end-to-end row.

**Resolution.** Two new rows plus a contract movement:

- **WAKE-ABORT (§H H7/F3)** — a quiet run (nothing to wake on), an in-flight wake opened with an
  injected `AbortSignal` (the transport-bound, non-wire seam the `wake()` helper already
  carries), a settled boundary (`flush(80)`), then `ac.abort()`. The wake settles
  `application_attention_wait_cancelled` — never a generic error, never the raw
  `coordination_wait_aborted`. At HEAD the row fails at `attention-wait-command-missing` (no wake
  to abort).
- **MCP-CEILING (§H D4/F3)** — a source-pin (readFileSync on mcp-northbound.mjs) that the wake
  tool name sits within 600 chars of the `invalid_run_wait` ceiling guard — i.e. it JOINS the
  tight ceiling list (`['fleet_run_wait','fleet_run_follow', …]`), so a `timeoutMs` past the 30s
  ceiling refuses by name through the MCP dispatch. At HEAD it fails at
  `baton-attention-wait-tool-missing` (no wake tool row).
- **Contract v1.2 (D6)** — the wake-cancelled receipt `application_attention_wait_cancelled` is
  added to the refusal vocabulary, named as the wake's analog of `run.follow`'s
  `application_follow_cancelled` (the `coordination_wait_aborted` → cancelled mapping at
  `application.mjs:8344-8347`).

**Consequence.** The H7 mapping is now pinned by a behavioral row and the ceiling by a source row;
an impl that leaks the raw abort code or a generic error cannot go green.

### F4 — REVALIDATED leaves the page→return revalidation race unpinned → RESOLVED (two-trip)

**Gap (blueteam).** REVALIDATED answered the decision BEFORE invoking the wake, so the
registration-time page was already fresh — the stale-delivery direction was never exercised.

**Resolution.** REVALIDATED is now a two-trip pattern: park → wake (deliver and hold the
`answer_decision` item) → answer the decision → re-wake with the SAME `storeCursor` (0) →
assert the resolved item is not re-delivered. The re-trip re-pages the item's window, so a
revalidating impl re-checks the live state and filters it; a stale-cache impl that builds from a
registration-time page re-delivers it. Deterministic — no interleave needed.

**Consequence.** The answer-from-wake row now exercises the stale-payload revalidation the brief
names; the blueteam's two-trip recipe is exactly what the row encodes.

### F5 — authority run-scoping is unpinned; WORKER-REFUSED is claimed-class-blind → RESOLVED

**Gap (blueteam).** TWO-WAITERS exercised only one run, so the lease's run-scoped target match was
never tested; WORKER-REFUSED's worker made no orchestrator claim, so class-trust could not be
distinguished from a genuine refusal.

**Resolution.** Two folds:

- **WORKER-REFUSED extended** — after the plain worker refusal, the row presents
  `{...principalOf('worker-1'), actor: 'orchestrator:worker-1'}` and asserts
  `attention_scope_forbidden` persists. The claimed orchestrator class rides the **actor** field
  because `normalizePrincipal` (`application.mjs:1107`) admits exactly
  `{actor, principalId, sessionId}` and REJECTS unknown fields — a `role` field would throw
  `application_authority_invalid` before the dispatch tail and break the red-first property.
- **AUTHORITY-RUN-SCOPED (§E D3/F5, new row)** — `authorityOn` issues a live run-orchestrator
  lease on run A; the lease holder's wake on run A dispatches (the run-scoped admit), and its
  wake on run B refuses `attention_scope_forbidden` — the any-live-lease attack dies here.

**Consequence.** Both halves of the blueteam attack (any-live-lease, caller-claimed class) are now
pinned; the authority is run-scoped principal identity, never a claimed class.

### F6 — ACTIONS-SLICE source pin is too weak and the spill has no behavioral row → PARTIAL (pin strengthened; behavioral row deferred)

**Gap (blueteam).** The `/slice\(0,\s*MAX_ATTENTION\)/` regex neither anchored the slice to
`actions` nor required the head+digest spill — a wrong impl could slice `reasons` (or `waitingOn`)
or drop the spill and pass.

**Resolution.** The source-pin regex is now anchored on the actions operand —
`/actions:\s*[^.\n]*\.slice\(0,\s*MAX_ATTENTION\)/` — so a `reasons`/`waitingOn` slice inside the
wake region cannot pass, and it additionally requires the spill shape (`/(spilled|digest)/`) in
the wake region, so a silent drop cannot pass. The behavioral 65+ spill row is **deferred** (see
Deferred): staging 65+ actions requires 65 live wave members each holding a pending blocking
interaction, which violates the one-pending-per-worker rule and is unstageable in the hermetic
single-member fixture without an order-of-magnitude heavier setup.

### F7 — the W-9 pin contradicts the draft notes on the decision park → RESOLVED (reconciliation, no pin extension)

**Gap (blueteam).** STORE-VISIBLE pinned only plan proposal + candidacy admission while
DECISION-PARK-WAKES makes a decision park wake-worthy — the transition W-9's principle is most
about is the one the pin declines to cover, and the notes' "store-invisible at HEAD" was never
reconciled.

**Resolution.** A probe at `0792e5e` confirmed the premise: a decision park advances the store seq
by **delta 0** (`coordination.events()` length unchanged after the park). Extending the STORE-VISIBLE
pin would therefore break it (it would fail green-at-HEAD), so the fold closes the loop instead:
- The §J comment and the §B header now state explicitly that the park is wake-visible ONLY via the
  reason lane (`answer_decision`), and that W-9's store-visibility principle covers the appending
  transitions (plan proposal, candidacy admission, wave close) — the two claims are consistent
  because wake-visible does not require store-appended.
- `suite-draft-notes.md` records the park's store-invisibility as an accepted v1.1/v1.2 boundary.
- `orchestrator-wake-contract.md` v1.2 amends W-9's text (which asserted the decision park
  "advances the store seq" — empirically false at HEAD).

### F8 — malformed-closure coverage gaps → RESOLVED

**Gap (blueteam).** WAIT-DISPATCH covered bad `runId` and negative cursor/timeout values, but not
`timeoutMs: 0`, non-integer cursors, a missing `afterCursor`, or an unknown `kind`.

**Resolution.** The WAIT-DISPATCH malformed list is extended with exactly those four closures —
`zero timeoutMs`, `non-integer storeCursor` (`'3'`), `non-integer reasonsCursor` (`'7'`),
`missing afterCursor` (a direct `command` call without the block), and `unknown kind` — each
asserting `attention_wait_invalid` (never a `TypeError`, never a generic `application_*` code).

### F9 — CANDIDACY-REFRESH is ordering-sensitive on the fixture side (green-side) → RESOLVED

**Gap (blueteam).** A correct v1.1 impl that refreshes the stable-identity candidacy on a
macrotask notifier would fail CANDIDACY-REFRESH, because the fixture re-woke in the same tick as
the second admission.

**Resolution.** The row now `await yieldMacrotask()` after `admitCandidacy(fx, 2)` — a settled
boundary (one macrotask queue yield), never a clock or a workflow gate — so a notifier-delivered
refresh lands before the re-wake pages the stable-identity `candidacy_review`. The queue-count
assert still pins the admission itself.

### F10 — citation drift vs the tree the suite ships in → RESOLVED

**Gap (blueteam).** The suite's recorded verification HEAD (`e9cdd0c`) did not match the tree HEAD
at blueteam time (`14af9e0`), and line citations were stale.

**Resolution.** Re-pinned to the suite's ship HEAD `0792e5e` and every cited line re-verified:
`application_command_unavailable` at `application.mjs:12616`; `validateWebCommandEnvelope`
(defined `web-northbound.mjs:387`, exported `:1885`); `mcpApplicationToolNames` at
`mcp-northbound.mjs:2215`; `waitAfter` at `coordination-store.mjs:8880`;
`_attentionScopeAuthorized` at `coordinator.mjs:7080`; `_attentionPage` at `coordinator.mjs:7106`;
`FRAME_LIMITS` at `limits.mjs:110`; `ATTENTION_TYPES` at `messages.mjs:18`. The row inventory and
VERIFIED SPLIT are updated to the fold's 36 rows (30 RED / 6 PIN).

---

## 2. New rows (this fold)

| Row | § | Stage at HEAD | What it pins |
|-----|---|----------------|--------------|
| **AUTHORITY-RUN-SCOPED** | §E D3/F5 | `attention-wait-command-missing` | a live lease on run A never authorizes run B's wake — the any-live-lease attack (F5) |
| **MCP-CEILING** | §H D4/F3 | `baton-attention-wait-tool-missing` | the wake tool joins the TIGHT ceiling guard beside `invalid_run_wait` (F3) |
| **WAKE-ABORT** | §H H7/F3 | `attention-wait-command-missing` | an aborted in-flight wake settles `application_attention_wait_cancelled` (F3) |

Plus the strengthened rows: WAIT-HONEST-EMPTY (F2 spy), REVALIDATED (F4 two-trip),
RETURN-TRIP (F1 injectable clock), CANDIDACY-REFRESH (F9 settled boundary), WORKER-REFUSED
(F5 claimed-class), WAIT-DISPATCH (F8 malformed closures), ACTIONS-SLICE (F6 anchored pin).

## 3. Deferred (with reason)

- **F6 behavioral spill row** — a wake with 65+ pending actions asserting the head (first 64) plus
  the digest spill ride the payload. Staging 65+ actionable items requires 65 live wave members
  each parked on a blocking interaction, which trips the one-pending-per-worker admission rule and
  is not stageable in the hermetic single-member fixture without an order-of-magnitude heavier
  setup. The contract's H6 spill shape is already pinned by the strengthened source-pin (the
  `actions:` operand slice + the `(spilled|digest)` spill requirement); the behavioral leg is
  recorded here and in the draft notes so a future multi-member fixture can add it without
  re-litigating the decision.

## 4. Bottom line

The blueteam's two headline attacks are dead: W-1's transport guarantee is pinned behaviorally
(F2), and the D1.6 reason-notifier discipline no longer depends on real wall time (F1). The
missing rows the brief names — the H7 cancellation path (F3) and the stale-delivery revalidation
(F4) — are added. The authority row no longer trusts a claimed principal class (F5). The suite
stays red-first: 30 RED / 6 PIN, every RED row failing at a named stage, the split deterministic
across two consecutive runs from the repo root.
