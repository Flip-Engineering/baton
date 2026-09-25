# AX report — the ax-opus worker seat

**Seat:** ax-opus (`claude-code / claude-opus-4-8 / high`), driven by the W6.1 AX-report wave
(`reviews/ax-report-2026-07-31/run-ax-wave.mjs`: `steering: nudge-on-checkpoint`,
`finalization: claim-on-stall`, `stallTimeoutMs 15m`, `hardCapMs 1h`, `saltObjectives: true`).
This campaign I sat three red-team seats and read this report's machinery live: `#11`
setup-token verification (`docs/reference/evidence/setup-token-2026-07-31/redteam-v2.md`), the
S-2 board/package authority security review (`.../control-surface-2026-07-31/s2-redteam-v1.md`),
and the docs/35 grammar review (`.../grammar-2026-07-24/redteam-opus.md`). Method below is the
same as those receipts: every claim grounded in a path/line I actually looked at, all reads
targeted (grep→range), no file over ~1500 lines read whole (issue #28).

---

## 1. FRICTIONS I actually hit

**Task shape was clear; coordinates were mostly given.** My objective named the three receipts by
exact path, handed me the section skeleton, and stated `#28` up front — the good case. Contrast the
grammar seat, where the target `impl/src/application.mjs` **is not valid UTF-8 to `grep(1)`** and
every search silently returned zero until I switched to `grep -a` (grammar receipt line 8). No
signal told me it was binary-to-grep; I found it by a zero-hit that should have hit.
Coordinates-in-the-brief is the difference between a productive first turn and one burned on
discovery.

**The receipts-vs-boilerplate contradiction.** The standing Brief boilerplate (assembled at
`impl/src/adapter.mjs:107-108`) says: *"do not inspect repository files, prior Run artifacts,
receipts, or ledgers to reconstruct or broaden it… Writing a named output path does not authorize
reading its preexisting contents."* My objective, in the same Brief, **names three receipts and
tells me to cite them**. A literal-minded worker either refuses its own inputs or reads them and
feels out of contract. The more-specific objective wins, but the worker has to adjudicate a
contradiction the Brief should have resolved.

**`wire_frame_oversize` discipline (#28) works, but the cost is all on me.** In redteam-v2 I held
the line — the two >1500-line files (`application-semantics.mjs` 1728, `application-deployment.mjs`
1619) were navigated grep→range, never read whole (that receipt's grounding note). Right
discipline — but there is **no in-worker signal of how close I am to the limit**, no read of
bytes/lines consumed this frame, so it is manual vigilance and one careless full read kills the
run. A sharp edge left un-instrumented on the one axis that is a hard kill.

**Turn/checkpoint ergonomics — nudges were noise for this task.** The driver steers
`nudge-on-checkpoint`; the three delivery modes are `nudge | now | turn`
(`application-semantics.mjs:266,491`; semantics of each at `:1025`: *"Nudge is the default. Now
redirects the current turn… turn requests a distinct provider turn"*). For a batch report with no
genuine checkpoints, I never paused, so any nudge would arrive **mid-turn as undifferentiated
prose** — indistinguishable from task context. There is no typed "this is orchestrator steering"
frame the worker recognizes. Worse, the grammar receipt found the `run.steer` alias mis-pins
`delivery` and that a schema-required `reason` *"turns previously-valid emergency stops into
refusals"* (grammar receipt R-OP-13, line 558): an emergency `now` stop can be **rejected for
lack of a reason string.**

**The trust/verification gate is opaque to the worker.** My Brief carries *"Do not claim
completion without the deployment verification command"* plus a **salted** contract
(`saltObjectives: true`) reducing here to exe `true`, argv `[]`, exit `0`. I cannot tell whether
`true` is the real test or a decoy, and `explicit change_v1` silently requires an in-scope edit
for acceptance (`adapter.mjs:123`: *"Objective prose does not weaken this requirement"*). Writing
this file satisfies it — but **nothing tells the worker a correct-but-no-op answer would be
rejected**, and nothing lets me self-verify against the gate that decides my fate. Same shape my
security receipts flagged: the gate certifies the *route*, not the *work* — `true` proves nothing
about this report's correctness (cf. redteam-v2 R11V-2, "green against a fixture that encodes the
assumption under test").

**Scope rules were clean but have a subtle trap.** `reviews/ax-report-2026-07-31/**` is a crisp,
enforced boundary. But *"writing a named output path does not authorize reading its preexisting
contents"* (`adapter.mjs:107`) means a worker **resuming its own prior draft** trips the contract —
a real hazard for a stall-restarted seat.

**Stall clocks — the single biggest worker risk.** Before the `#55` fix (commit `e14a4dd`),
single-run views were pure event projections with resource events noise-filtered from "meaningful"
progress, so **long unpaused turns read as stalls — three waves killed in two days.** My own sonnet
peer this campaign died to exactly this (its receipts: BD wave, stall-killed twice, zero-output).
The fix projects `activity {providerCalls, tokens, lastActivityAt}` so mid-turn calls move the
clock — but for claude it is `{observation: 'native', enforcement: 'unavailable'}`
(`claude-session.mjs:436`): **observed, not enforced**, so a long silent tool call or a batching
provider still risks the 15-minute axe. And **the worker has no view of its own stall clock** — I
cannot see time-since-last-tick, cannot tell "about to be reaped" from "fine," cannot self-heartbeat.

**Scratchpad/grammar lines.** The control grammar's headline portability claim is broken from the
worker's side: docs/35 §5 L2 says an advertised action's `do` block *"executes verbatim… on every
surface — byte-identical resulting view."* But the `actionId` folds `viewDigest` **and**
`principalScopeDigest {principalId, sessionId}` (`application.mjs:7310-7323`), and `run.act`
refuses `application_action_scope_mismatch` on the second execution or a cross-principal replay
(grammar receipt R-OP-1). So an action a view advertises to me is **not reliably re-executable** —
the scratchpad grammar over-promises.

---

## 2. GAPS — what I needed from inside that does not exist

- **A `run.self` projection.** A worker cannot read its own run view: stall deadline and
  time-since-last-activity-tick, turns used vs `hardCapMs`, token spend, and its lifecycle state.
  I fly blind on the exact signals (`#55` activity, `hardCap`) that decide whether I am killed.
- **A self-heartbeat / activity tick.** During a legitimate long tool call there is no way to emit
  "still working" to reset the stall clock. The only liveness is incidental provider chatter.
- **An acceptance preview.** The salted verification and `change_v1` in-scope-edit requirement are
  enforced by an external reviewer; the worker has no salt-stripped read of "what will be run to
  accept me," so no self-check is possible before claiming done.
- **A typed steering channel.** `nudge/now/turn` arrive as prose with no envelope declaring
  delivery mode, priority, or origin — the worker cannot distinguish steering from context.
- **Oversize + grep-safety signals.** No per-frame read-budget readout for `#28`, and no hint that
  a source file needs `grep -a` (application.mjs).
- **A principal/admission readout.** From S-2, admission resolves by non-secret identifiers and
  the read projection is an unguarded cross-session oracle (s2-redteam R-BA-1, R-BA-6). A worker
  or embedded facade has no surfaced "you are admitted as X, with authority Y" — it cannot even
  observe the trust boundary it lives inside.
- **Explicit idle vs working state.** The grammar receipt (lines 313-319) found no distinct
  `idle` vs `working + awaitingTurn` state; a finished turn's stall-risk classification is
  invisible to the worker producing it.

---

## 3. PROPOSALS (ranked, worker perspective)

### P0-1 — Expose the worker's own stall clock and let it heartbeat
**Grounding.** `#55` killed three waves in two days (commit `e14a4dd`); claude enforcement is
`'unavailable'` (`claude-session.mjs:436`); my sonnet peer was stall-killed twice this campaign;
driver `stallTimeoutMs` is 15m and the worker never sees it. **Failure.** A worker doing correct
long work is reaped for looking idle, with zero warning it can act on. **Repair.** A read-only
`run.self` projection carrying `{lastActivityAt, stallDeadline, turnsUsed, hardCapDeadline}` in the
worker's tooling, **plus** a worker-emittable heartbeat tick that resets the stall clock during a
long tool call. Cheap; it turns a silent kill into an avoidable one.

### P0-2 — Reconcile the receipts-vs-boilerplate contradiction
**Grounding.** `adapter.mjs:107-108` bans inspecting "receipts or ledgers"; my objective names
three receipts to cite. **Failure.** A compliant worker either refuses its named inputs or reads
them out of contract — the Brief contradicts itself. **Repair.** When the objective names explicit
paths, the assembled Brief should emit an in-scope-reading whitelist (*"These paths are authorized
inputs: …"*) instead of a blanket ban the objective silently overrides.

### P1-1 — Ship a salt-stripped acceptance preview
**Grounding.** My Brief holds *"Do not claim completion without the deployment verification
command,"* a salted `true`/`[]` contract, and a hidden `change_v1` in-scope-edit requirement
(`adapter.mjs:123`) — none readable by the worker. **Failure.** A correct no-op answer is silently
rejected; the worker cannot self-verify before claiming done. **Repair.** Surface the *shape* of
acceptance without decoy specifics: *"acceptance requires an in-scope edit under `<scope>` and a
command that exits 0."* Keeps the salt's anti-gaming value; removes the blind gate.

### P1-2 — Typed steering envelope; make `reason` optional for emergency `now`
**Grounding.** Driver steers `nudge-on-checkpoint`; modes at `application-semantics.mjs:1025`;
grammar receipt R-OP-13 (line 558): required `reason` *"turns previously-valid emergency stops into
refusals,"* and the `run.steer` alias mis-pins `delivery`. **Failure.** Steering is
indistinguishable from context, and an emergency stop can be refused for a missing string.
**Repair.** Deliver steering in a typed frame `{delivery, reason?, from}` the worker recognizes;
drop the `reason` requirement on `now`.

### P1-3 — Oversize read-budget + grep-safety signal
**Grounding.** `#28` is a hard kill; grammar receipt line 8 — application.mjs is non-UTF-8 to
`grep(1)`, silent zero-hit. **Failure.** The worker burns turns discovering binary-to-grep files
and has no read of how close it is to the oversize limit. **Repair.** Advertise per-frame
read-bytes consumed in `run.self`, and a one-line Brief hint listing sources that need `grep -a`.

### P2-1 — Surface the run's own lifecycle state to the worker
**Grounding.** Grammar receipt lines 313-319 (no explicit `idle` vs `working + awaitingTurn`);
checkpoint kinds at `:329/:335`. **Failure.** The worker cannot tell whether a finished turn reads
as stall-risky idle or as awaiting. **Repair.** Include lifecycle state in the `run.self`
projection (folds into P0-1).

### P2-2 — Make advertised actions actually re-executable (grammar L2)
**Grounding.** grammar receipt R-OP-1 — `actionId` folds `viewDigest` + `principalScopeDigest`
(`application.mjs:7310-7323`) → `application_action_scope_mismatch` on re-exec/cross-principal.
**Failure.** A `do` block a view offers me is not the portable primitive §5 L2 promises.
**Repair.** As R-OP-1: drop `viewDigest`/`principalScopeDigest` from the id, or scope C2 to "the
surface on which it is enabled" and defer L2 to M2 (grammar receipt line 625).

---

*Meta, carried from all three security receipts: the pattern that bites the worst — in
setup-token (R11V-1/2), in S-2 (R-BA-1/3), and in the verification gate driving this very report —
is **green-but-broken**: a check that passes against a fixture or a salt encoding the assumption
under test. The `true`/`[]` gate proves the route and cleanup truth; it does not prove this report
is right. Every proposal above is an attempt to give the worker enough self-observability to close
that gap from the inside.*
