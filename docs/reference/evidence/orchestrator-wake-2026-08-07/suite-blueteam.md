# #71 BLUE-TEAM REPORT — orchestrator-wake red-first suite

Verdict: **NEEDS-FOLD**

The suite's red-keeping power is real — the 27 RED rows fail at named stages at HEAD, the 6
PINs are green, the split is deterministic, and the fixture stack (decision park, plan
proposal, candidacy admission, blocking-question park, terminal mint, reply hop) is verified
capable of minting every state the rows need. But the suite cannot *keep* several red rows
red against plausible wrong implementations, and one row violates the campaign's own #7 law
(real wall time) with no injectable clock to repair it. Ten findings follow; the two highest
(F1, F2) attack the suite's headline properties (W-1's no-poll-timer guarantee and the D1.6
reason-notifier discipline).

All line citations below were verified with `grep -an`/`sed -n` at the current tree HEAD
**14af9e0** (`git rev-parse --short HEAD`). The two NUL-bearing files (application.mjs,
coordination-store.mjs) were read only through `grep -an`/`sed -n`/`readFileSync`; NUL byte
counts confirmed 3 and 3.

---

## Suite-run splits (both from the repo root)

Run 1 — `node --test impl/test/orchestrator-wake-red.test.mjs` → exit 1:
`ℹ tests 33 / ℹ pass 6 / ℹ fail 27 / ℹ cancelled 0 / ℹ skipped 0 / ℹ todo 0`

Run 2 — same command, immediately repeated → exit 1:
`ℹ tests 33 / ℹ pass 6 / ℹ fail 27 / ℹ cancelled 0 / ℹ skipped 0 / ℹ todo 0`

The 33 spec lines, normalized by stripping `(NNNms)` timing suffixes, are byte-identical
across the two runs (`diff` → IDENTICAL). The split is deterministic.

Verified green at HEAD: ALREADY-RESOLVED, WAITING-ON-KINDS-PIN, ATTENTION-TYPES-PIN,
LIMITS-PIN, STORE-VISIBLE, EXISTING-PINS. Verified red at their named stages: the remaining
27 (dispatch / WAKE_REASONS-missing / tool-missing / web-envelope-missing /
cli-grammar-missing / mcp-allowlist-missing).

Deployment verification: executable `true`, args `[]`, cwd `.` → exit **0** (verified).

---

## Verified sound (axes that held up)

- **B1 two-cursor costume-fold is caught.** A one-token-on-the-wire impl that internally
  splits is killed by CURSOR-SHAPE (both tokens returned and distinct); a two-token impl that
  ignores `reasonsCursor` (echoes 0) is killed by REASONS-ALONE (the honest-empty continuation
  re-pages r1 → woken true, but the row pins woken false). The MCP schema regex plus
  RETURN-TRIP/REASONS-ALONE together close the fold from both the surface and the behavior.
- **Decision-park fixtures are state-sound.** The green ALREADY-RESOLVED/STORE-VISIBLE pins
  prove the DECISION_SCENARIO park, the plan proposal, and candidacy admission all append/read
  at HEAD; every decision-lane red row rides that proven stack.
- **Blocking-question park works at HEAD.** `projectBlockedInteraction` (application.mjs:378)
  projects a pending `answer_question` attention entry to `blockedInteraction.kind ===
  'answer_question'`, and the adapter's blocking `ask` path (adapter.mjs:646-650) parks the
  task at `input_required`. BLOCKING-ESCALATES's park precondition holds today.
- **NUL discipline is correct.** The suite reads application.mjs and coordination-store.mjs
  via `readFileSync`, matching the brief's `grep -a`/`sed` mandate; both files carry exactly 3
  NUL bytes and the suite is NUL-free.
- **Every red row fails at its named stage at HEAD.** No row's first assertion is ahead of its
  stage (the 27 red rows throw `application_command_unavailable` at application.mjs:12616, or
  the absent-export/tool/envelope/grammar asserts fire first).

---

## Findings

### F1 — RETURN-TRIP depends on real wall time with no injectable clock (#7-class; also a green-side blocker)

**Row/Gap.** RETURN-TRIP (§C) must emit a second `lifecycle.turn_completed` for the *same
worker* and have it mint a **fresh** `member_terminal` reason (D1.6, `r2.seq > r1.seq`). But
the member-terminal notifier coalesces within `ATTENTION_COALESCE_WINDOW_MS = 500`
(coordinator.mjs:46, applied at coordinator.mjs:7143). The fixture escapes the window with
`await sleep(600)` — real wall time. The draft notes call this a "coalescing-window bypass",
but it is exactly the #7 class the brief bans: the row's correctness depends on real elapsed
time exceeding 500ms.

**Attack.** Raise `ATTENTION_COALESCE_WINDOW_MS` to ≥ 600 (or run under a coarse timer) and a
*correct* v1.1 impl coalesces the second mint into r1 → `r2.seq === r1.seq` → RETURN-TRIP goes
red on a right implementation. Conversely, shorten the window below the sleep and the row goes
green on a wrong impl. The window value is a moving target the suite does not control.

**Fix.** Make the fixture's clock injectable, then drive it across the window — no sleep.
`createDriver` already accepts `opts.now` (index.mjs:1168-1170) but never forwards it to the
Coordinator (constructed at index.mjs:1437 without `now`; the Coordinator's `_now` falls back
to `Date.now` at coordinator.mjs:996). Forward `opts.now` through `createDriver` into the
Coordinator and have `wakeFixture` pass a controllable clock; advance it past 500ms between the
two emits and delete `sleep(600)`.

### F2 — W-1's no-poll-timer property is unpinned; every row is transport-blind

**Row/Gap.** The suite's headline W-1 pin — "the wake holds a `waitAfter`, no poll timer on the
hot path" — is asserted in prose only. No row asserts the transport: none checks that
`coordination.waitAfter` (application.mjs:8343 is the existing `run.follow` precedent) was
actually invoked with the two cursors.

**Attack.** Implement `attention.wait` as a `_waitPollMs`-style poll loop (re-page
`attentionFollow`/the run view every ~100ms). It passes **every** red row: WAIT-HONEST-EMPTY
(polls, finds nothing, honest-empty at the 300ms bound), DECISION-PARK-WAKES (poll sees the
park), RETURN-TRIP/REASONS-ALONE (poll sees the fresh reason), CANDIDACY-* (poll sees the
stable candidacy). Only the outcome asserts stand in its way, and it meets them all. The suite
cannot distinguish a waitAfter-anchored wake from a poll loop.

**Fix.** In WAIT-HONEST-EMPTY, wrap/spy `fx.coordination.waitAfter` before the wake and assert
it was invoked with `storeCursor`/`reasonsCursor`, and that the honest empty returns the cursor
passed to it (the waiter it held). That pins "holds a waitAfter" deterministically, with no
clock and no timing assumption.

### F3 — the cancellation path (H7) has zero coverage

**Row/Gap.** H7's disconnect→abort discipline is folded into the contract but never tested.
No row exercises: (a) aborting an in-flight wake and asserting the cancelled receipt; (b) the
`coordination_wait_aborted` → wake-cancelled translation (the `run.follow` precedent at
application.mjs:8344-8347 maps it to `application_follow_cancelled`; the wake's analog is
unpinned); (c) the MCP TIGHT 30s ceiling guard end-to-end through the MCP dispatch
(`invalid_run_wait`-class refusal); (d) disconnect→abort on the stdio channel.

**Attack.** An impl that surfaces an abort as a generic error, or leaks the raw
`coordination_wait_aborted` code, passes every row — nothing asserts the wake-cancelled
contract, so the H7 mapping is free to be wrong.

**Fix.** Add a row that opens a wake, aborts the transport mid-wait (AbortSignal/close), and
asserts the wake settles cancelled (not honest-empty, not `application_command_unavailable`).
Add an MCP row invoking `baton_attention_wait` with `timeoutMs` past the web ceiling and
asserting the pinned refusal code (and, if the transport allows, an abort-on-close mapping).

### F4 — REVALIDATED leaves the page→return revalidation race unpinned

**Row/Gap.** REVALIDATED (§B) answers the decision *before* invoking the wake, so the wake's
registration-time page is already fresh and the "resolved → not delivered" outcome is
trivially achieved. The stale-delivery direction the row's name advertises — an answer landing
*between* the wake's page and its serialized return — is never exercised.

**Attack.** Implement the wake to build its payload from a page captured at registration and
not re-read before delivery. It passes REVALIDATED (the registration page is post-answer and
already filtered) and DECISION-PARK-WAKES (the registration page captures the park); it fails
only if the answer lands mid-wake, which no fixture stages.

**Fix.** Two-trip pattern: park → wake (deliver, hold the item) → answer → re-wake with the
*same* `storeCursor` and assert the resolved item is not re-delivered. A revalidating impl
re-pages and filters it; a stale-cache impl re-delivers it. Deterministic, no interleave
needed.

### F5 — authority run-scoping is unpinned; WORKER-REFUSED is claimed-class-blind

**Row/Gap.** TWO-WAITERS (§E) exercises only *one* run, so `_isReviewAuthority`'s run-matching
(the lease must target *this* run) is never tested — the lease holder's session trivially
matches the single run. WORKER-REFUSED's worker makes no orchestrator claim, so the row cannot
distinguish a genuine authority refusal from a "no claim to refuse" pass.

**Attack.** (1) An impl admitting any principal holding *any* live run-orchestrator lease (not
scoped to the target run) passes TWO-WAITERS and WORKER-REFUSED. (2) An impl trusting a caller-
claimed principal class (`role`/`actor` on the principal) also passes WORKER-REFUSED, because
the fixture worker carries no such claim — the row proves nothing about class-trust.

**Fix.** Add a row issuing the lease on run A (`authorityOn` with run A) and asserting the
lease holder is refused `attention_scope_forbidden` on run B's wake — pinning the run-scoped
target. Extend WORKER-REFUSED to present a worker carrying a claimed orchestrator class
(`{...principalOf('worker-1'), role: 'orchestrator', actor: 'orchestrator:worker-1'}`) and
assert the refusal persists — closing the claimed-class hole.

### F6 — ACTIONS-SLICE source pin is too weak and the spill has no behavioral row

**Row/Gap.** ACTIONS-SLICE (§I/H6) requires `/slice\(0,\s*MAX_ATTENTION\)/` within 30000 chars
after the `'attention.wait'` dispatch literal. The regex neither anchors the slice to
`actions` nor requires the head+digest spill.

**Attack.** Slice `reasons` (or `waitingOn`) to `MAX_ATTENTION` inside the wake region and the
row passes; or slice `actions` but drop the spill. H6's bounded-payload contract is therefore
only half-pinned, and the oversize *spill* shape (first 64 + digest) is untested entirely.

**Fix.** Anchor the regex on the actions operand (e.g. `actions:\s*[^.\n]*\.slice\(0,\s*MAX_ATTENTION\)`)
and add a behavioral row staging 65+ actions and asserting the head (first 64) plus the digest
spill ride the payload.

### F7 — the W-9 pin contradicts the draft notes on the decision park

**Row/Gap.** STORE-VISIBLE (§J) pins W-9's "no wake-worthy STORE change is store-invisible"
for exactly two transitions (plan proposal, candidacy admission) and the draft notes document
that a decision park is *store-invisible at HEAD*. But DECISION-PARK-WAKES requires a decision
park to wake the waiter — making the park wake-worthy by the suite's own definition. The
transition W-9's principle is most about (a park that wakes) is the one the pin explicitly
declines to cover, and the notes' "store-invisible at HEAD" is never reconciled with the
v1.1 contract.

**Attack.** Implement the park as a reason-only mint (no store append) — legitimate if the
contract's "wake-worthy" means reason-mintable rather than store-appended — and W-9's
store-visibility guarantee is silently weaker than the principle states; no row pins the park's
store visibility either way.

**Fix.** Extend STORE-VISIBLE to the decision park (assert the park advances the store seq), or
close the loop in the draft notes by stating explicitly that the park is wake-visible *only*
via the reason lane and that W-9's store-visibility principle applies only to the two appending
transitions.

### F8 — malformed-closure coverage gaps

**Row/Gap.** WAIT-DISPATCH (§A) and WAIT-INVALID (§K) cover bad runId and negative
cursor/timeout values, but not: `timeoutMs: 0` (waitAfter requires > 0), non-integer cursors
(`storeCursor: '3'`), a missing `afterCursor`, or an unknown `kind`. Every one of these must
draw `attention_wait_invalid` under D6.

**Attack.** An impl that throws a `TypeError` on `timeoutMs: 0` (letting the raw
`timeout must be > 0` escape) or a generic `application_command_invalid` on a non-integer
cursor passes every row.

**Fix.** Extend the malformed list in WAIT-DISPATCH with `timeoutMs: 0`, non-integer cursors,
missing `afterCursor`, and an unknown `kind`, each asserting `attention_wait_invalid`.

### F9 — CANDIDACY-REFRESH is ordering-sensitive on the fixture side (green-side)

**Row/Gap.** CANDIDACY-REFRESH (§D) admits candidacy n=2 then immediately re-wakes with default
cursors and asserts `r2.count === 2` and `r2.seq === r1.seq`. The row passes only if the stable
candidacy's count refresh is synchronous with the admission (or lazy at page time). A correct
impl that refreshes on a macrotask notifier would fail the row — a green-side blocker.

**Fix.** Stage a continuation wake with the s1 cursors after the second admission (or `await
flush()` after `admitCandidacy(fx, 2)`), so the refresh has a settled boundary before the page.
The queue-count assert already pins the admission; only the refresh→page ordering needs the
seam.

### F10 — citation drift vs the tree the suite ships in

**Row/Gap.** The suite's recorded verification HEAD (e9cdd0c) does not match the current tree
HEAD (14af9e0), and its line citations are stale: `application_command_unavailable` is cited at
application.mjs:12467 but now throws at 12616; `validateWebCommandEnvelope` is cited at
web-northbound.mjs:1838 but its export is now at 1885; `mcpApplicationToolNames` is cited at
mcp-northbound.mjs:2170 but now starts at 2215. The suite's NUL discipline is correct, so this
is navigational drift, not a reading hazard — but the implementer's map is wrong.

**Fix.** Re-pin the suite to the current HEAD (the contract's §5 re-pin precedent) and
re-verify each cited line at 14af9e0.

---

## Bottom line

The 27 red rows are honest at HEAD and the fixtures are sound, but the suite as written cannot
*keep* its two strongest red pins against a wrong implementation: W-1's transport guarantee
(F2) and the D1.6 reason-notifier discipline (F1, which is also #7-class and currently
unfixable without an injectable clock). The H7 cancellation path (F3) and the D2.3 stale-delivery
race (F4) are real missing rows the brief explicitly names. **NEEDS-FOLD** until F1/F2 are
addressed and F3/F4 are added.
