# #182 implementation contract — death certificates: the derived suspicionClass for every terminal run — v1

[attempt: 80552279-c801-4c49-af1b-1276392abdf3 row-death]

Date: 2026-08-14. Status: contract for implementation, **v1** (red-first; no fold yet). Every
citation was re-verified this session against the working tree at HEAD `3bb5791` ("Baton private
effective-tree snapshot") with `grep -an`/`sed -n`; **NUL discipline applied to `application.mjs`
and `coordination-store.mjs** (`coordination-store.mjs` carries one NUL byte per line — cache-key
separators, `kernel-honesty-audit.md:76`, not corruption; `application.mjs` is NUL-free but is read
under the same discipline). Plain `grep`/`Read` elsewhere. No wall-clock claims anywhere; durations
(`stallMs`, `elapsedMs`) are measured intervals, not clocks. Sorted-key literals are written in
ACTUAL sorted order (the `coordinator.mjs:67-76` discipline — the literal IS its own `.sort()`
result). No redesign of what the audit found SOUND; the three manual-recovery cases named in the
row brief are mapped to derivation inputs, not waved away.

**The law this contract enforces.** Every **terminal** run carries a derived `suspicionClass` (one
of a closed seven) **and** the durable evidence that produced it — derived from policy/orchestrator
sources, **never the worker's self-reported cause** — and a suite PROVES it: a terminal run shipped
without a derived `suspicionClass`, or with a class the evidence does not support, fails the suite.
The three classes of death that today force a manual recovery — the suite-fold member, the
trust-gate-killed impl member (`worker_path_scope_violation` at completion), and the `#169` drives
— become an automatic, honest classification. *The closed seven, in ACTUAL sorted order:*
`capacity_reap`, `clean_terminal`, `credential_death`, `explicit_stop`, `provider_refusal`,
`watchdog_stall`, `wave_close_teardown`.

**The pattern source.** Issue #169's honesty posture is stated in-tree at
`coordinator.mjs:4` ("the hub re-runs it — the trust gate") and instantiated at `referee.mjs:258`
("refusing to trust-gate a worker's own worktree (R1)"). The death certificate is the trust gate
applied to the *termination itself*: the run does not get to say why it died; the durable record
re-derives it. #67 (the stall watchdog), #79 (the delivery receipts), the route-liveness probe, and
the wave-close path are the four derivation seams this contract binds under one classifier. #182 is
the lifecycle-honesty (package ④) face of the #169 kernel-honesty umbrella.

**Provenance (recorded judgment call).** `gh issue view 182` was unreachable this session — the
GitHub CLI is unauthenticated in this worktree (`gh auth status` → "not logged into any GitHub
hosts"). The seven-class taxonomy and the three manual-recovery cases are therefore taken from the
row brief (`row-death.md:5`) and the campaign evidence (the `kernel-honesty-audit.md` findings table
+ the in-tree code), NOT from a quote of the #182 issue body. This mirrors the kernel-honesty
audit's own seed-row provenance (`kernel-honesty-audit.md:16-23`): if the issue's framing differs,
the derivation-input → class mapping (G2, D2) holds and only the issue-body phrasing relabels. The
seven class names are taken verbatim from the row brief and are not relabeled.

---

## 1. GROUND TRUTHS (re-verified this session at HEAD `3bb5791`)

**G1 — A termination vocabulary EXISTS today, but it is scattered across four shapes and does not
cover the seven death modes.** There is no `suspicionClass` anywhere in the tree (`grep -rn
suspicionClass impl/src` is empty — the G8 RED). What exists is `terminalCause`, in four
incompatible shapes:

- **Coordinator task-level** — `handle.terminalCause = deepFreeze({ kind, code, … })`, assigned at
  `coordinator.mjs:3270` (`policy_failure` / `worker_policy_mismatch`), `:3352`
  (`policy_failure` / `worker_worktree_authority_lost`), `:4191` (`provider_failure`), `:9468`
  (`budget_exceeded` / `budget_hard_limit_exceeded`), `:12823`
  (`provider_failure` / `transport_closed_after_preservation`), `:12953`
  (`provider_failure` / `provider_crashed`), `:13460` (`provider_failure`), `:13850`
  (`policy_failure` — the trust-gate set), `:14004` and `:14415` (`policy_failure`). The `kind`
  literals in ACTUAL sorted order: `budget_exceeded`, `policy_failure`, `provider_failure`.
- **Adapter wire-level** — a bare *string* `terminalCause ∈ {timeout, wire_frame_oversize,
  process_error}` at `cli-adapters.mjs:422` and `:464`, `kimi-acp.mjs:695`,
  `codex-appserver.mjs:1094`, `grok-acp.mjs:952`, `claude-session.mjs:1527`.
- **Wave launch-level** — a bare string `terminalCause: 'start'` for a member that never started,
  at `wave.mjs:353` and `:472`.
- **Coordination-store child-level** — `terminalCause(task) → { code, retryable, summary }`,
  mapping source-event kinds to codes (`provider_crashed`, `provider_exited`,
  `verification_failed`, `provider_turn_failed`, `context_child_cancelled`,
  `task_acceptance_revoked`) at `coordination-store.mjs:6395`, surfaced at `:6510`.

The wire projection collapses all four to one closed field set — `TERMINAL_CAUSE_FIELDS = {category,
code, dimension, kind, limit, ratio, remediation, retryable, summary, used}`
(`web-stream.mjs:39-42`, validated by `validCause` at `web-operator.mjs:187`). So the *slot* for a
derived cause exists on every surface; what does not exist is the closed, one-per-terminal
*suspicion* classification. The four `kind`s admit no `explicit_stop`, no `clean_terminal`, no
`watchdog_stall`, no `wave_close_teardown` — four of the seven modes have no representation at all,
and a `provider_failure` crash is indistinguishable on the wire from a `budget_exceeded` hard-stop
(both collapse to the same field set with different `code`s).

**G2 — Each of the seven derivation inputs EXISTS as durable policy/orchestrator evidence.** The
classifier's inputs are already recorded; the classifier is missing.

- **Watchdog (#67)** — the closed re-arm set `REARM_KINDS = {approval.resolved, decision.settled,
  lifecycle.turn_started, question.answered}` (`coordinator.mjs:71-76`, ACTUAL sorted order); the
  deployment-frozen budget `_watchdog = { stallMs, blockingInteractionTimeoutMs, loopThreshold,
  scopeAction, orientation, loopAction, stallAction }` (`coordinator.mjs:1086-1094`).
- **Delivery receipts (#79)** — `PUSH_REFUSAL_CODES` (`coordinator.mjs:80-85`), the worker-delivery
  push projection (`coordinator.mjs:3908-3914`), the `run.send` receipt (`wave.mjs:404`), and the
  `run.stop` receipt captured into `state.stops` (`wave.mjs:420-421`).
- **Adapter refusals** — the route-liveness `_fail` codes `route_unavailable` (`route-liveness.mjs:182`),
  `probe_oversize` (`:189`), `provider_unreachable` (`:204`, `:231`, `:246`), `probe_content_mismatch`
  (`:241`), `authentication_refresh_required` (`:244`); and the launch-time `refusalCode ∈
  {worktree_unavailable, authentication_required}` (`coordinator.mjs:4188-4192`).
- **The wave-close path** — `close()` (`wave.mjs:492`), the per-member stop and its resources block
  (`wave.mjs:500-527`), `drainPumps` (`:487`), `pumpDrained` (`:488`, `:539`).
- **Credential death** — the closed `credentialState` death-set `{absent, expired, invalid, revoked,
  unavailable}` (`application-deployment.mjs:357`, `:389`, `:405`, `:410`, `:430`, `:490`, `:497`,
  `:1170`).
- **Explicit stop** — `run.stop` / `run_stop` / `run_member_stop` (`wave.mjs:409-429`;
  `web-operator.mjs:154`, `:174`, `:177`); the closed stop-receipt shape
  `{checks, counts, remainingCount, targetCount}` (`application.mjs:6510`).
- **Capacity reap** — `lifecycle.process_reap_unconfirmed` (`coordinator.mjs:12849`),
  `control.recovery_reap_unconfirmed` (`coordinator.mjs:9069`),
  `worker_worktree_authority_lost` (`coordinator.mjs:3352`), and the dead-owner reaps
  (`worktree-capacity.mjs:535-560`, #169 instance 4).

**G3 — The trust gate kills at completion — the named manual case.** `_runTrustGate(handle,
workerResult)` (`coordinator.mjs:13480`) runs *after* the worker reports done. It sets a
`trustPhase` then throws: `path_scope` → `worker_path_scope_violation` with `pathScopeEvidence`
(`coordinator.mjs:13518-13529`); `forbidden_effect` → `forbidden_effect_observed` (`:13509-13513`);
`required_effect` → `required_effect_absent` (`:13537-13550`). The gate verdict is re-derived from
the worker's OWN durable events (`coordinator.mjs:3920-3938`), and the live code → gate map is
closed (`worker_path_scope_violation` → `scope`, `forbidden_effect_observed` → `forbidden_effect`,
`verification_red_green_failed` → `red_green`, `verification_coverage_failed` → `coverage`, the
route mismatches → `route_mismatch`). A worker that legitimately finished is retroactively killed
here; today that death is a bare `policy_failure` `terminalCause` (`coordinator.mjs:13850`)
indistinguishable from a worker-policy mismatch — the manual recovery the contract must end.

**G4 — The wave close path captures teardown truth but does not classify the death.** `close()`
returns `{reason, stops, remainingCount, residueUnknown, knowledge}` (`wave.mjs:527`). A member whose
stop throws is pushed as `{role, ownedCount: null, error: {code, message}}` (`wave.mjs:520-521`);
`residueUnknown` is true when any stop's `ownedCount` is null (`wave.mjs:526`), and the code refuses
to coalesce that to zero ("a stop view without it is reported as unknown, never coalesced to zero",
`wave.mjs:505-507`). `settle()` marks a never-started member `{phase: 'failed', terminalCause:
'start', terminal: true}` (`wave.mjs:472`). The suite-fold member dies inside `close()`/`settle()`
with no suspicion classification — only raw `residueUnknown`/`error`/`terminalCause`.

**G5 — The watchdog emits mechanical `health.*` events that already carry the evidence.** On stall,
`_armWatchdog` appends `health.stall_suspected` with `{elapsedMs, action, basis:
'no_progress_evidence', mechanical: true}` (`coordinator.mjs:9119-9122`) then applies the action
(`:9124`); a turn in flight re-arms the window *without declaring* (`coordinator.mjs:9111-9113`).
The loop detector appends `health.loop_suspected` with `{command, exitCode, count, action,
mechanical: true}` (`coordinator.mjs:9650-9653`); the scope detector appends `health.scope_violation`
with `{path, observedPath, action, mechanical: true}` (`coordinator.mjs:9672-9675`, `:9681-9684`).
`_applyWatchdogAction` (`coordinator.mjs:9129-9134`) maps `kill`/`interrupt` → `_beginStop(handle,
…, 'policy')` and `escalate` → `_mintStallDeclared`. Every watchdog death is already an
actor:`policy`, `mechanical: true` event — the classifier only needs to read it.

**G6 — Credential death is a closed state set, and one `#169` drive is its hidden expiry.** The
`credentialState` death-set `{absent, expired, invalid, revoked, unavailable}` is minted at the
deployment probes (`application-deployment.mjs:357/389/405/410/430/490/497`) and gated at
`:1053-1063`/`:1170`. The `#148` drive (#169 instance 2): the resident credential's ~24 h death is
"written nowhere an operator can read" — the token is issued with `ttlMs = sessionTtlMs` (default
`24 * 60 * 60 * 1000`) but the publication files carry no `expiresAt`, so a mid-pump death surfaces
as blind `unauthenticated` retries, not a death (`kernel-honesty-audit.md:43`, ranked fix #5). That
is a `credential_death` the classifier must surface from the durable probe record, not from the
worker's retry noise.

**G7 — The stop receipt is a closed shape that already carries the reap truth.** The receipt is
`{checks, counts, remainingCount, targetCount}` (`application.mjs:6510`) with `checks =
{interactionsResolved, runAuthorityReleased}` (`application.mjs:4215`, `:6515`). Stop admission
throws `application_run_stop_incomplete` unless `checks.interactionsResolved === true &&
checks.runAuthorityReleased === true` (`application.mjs:4212-4213`); `resourcesSettled` is defined
as `runStop?.receipt?.remainingCount === 0` (`application.mjs:5772`). So an explicit stop whose
reap did NOT settle is already distinguishable on the wire — the classifier reads `remainingCount`
and `runAuthorityReleased` to separate `explicit_stop` (settled) from `capacity_reap`
(unsettled/incomplete).

**G8 — `suspicionClass` is ABSENT today (the RED).** `grep -rn suspicionClass impl` returns nothing.
Every terminal run is classified only by the scattered `terminalCause` of G1. The three
manual-recovery cases — (a) the suite-fold member (G4), (b) the trust-gate-killed impl member (G3),
(c) the `#169` drives (G6 #148 + the dead-owner reaps of G2 + the `run.result` empty-over-pin
non-finding below) — have no honest class. A `provider_crashed` and a `budget_hard_limit_exceeded`
are wire-indistinguishable; a trust-gate rejection is wire-indistinguishable from a worker-policy
mismatch; a clean completion is wire-indistinguishable from a `run.result` section that reports bare
`empty` over an existing result pin (`kernel-honesty-audit.md:53`, ranked fix #4 — the AX-wave
report, "a correctness-of-record failure, not a polish issue"). This last is the
`clean_terminal` honesty boundary: a terminal run whose result did not materialize is NOT clean.

**Sanity checks re-run this session (all hold at HEAD `3bb5791`):** `grep -rn suspicionClass impl`
is empty (G8). `validCause`'s field set (`web-operator.mjs:187`) equals `TERMINAL_CAUSE_FIELDS`
(`web-stream.mjs:39-42`) — the slot is uniform across surfaces (G1). `_runTrustGate` throws
`worker_path_scope_violation` only after capture, with `pathScopeEvidence` attached
(`coordinator.mjs:13517-13529`) — the trust-gate kill is post-completion (G3). `health.*` events all
carry `mechanical: true` (`coordinator.mjs:9122`, `:9653`, `:9675`, `:9684`) — the watchdog evidence
is self-identifying (G5). The stop-receipt key set is exactly `{checks, counts, remainingCount,
targetCount}` (`application.mjs:6510`) and `checks` is exactly `{interactionsResolved,
runAuthorityReleased}` (`application.mjs:6515`) — the reap truth is closed (G7).

---

## 2. DECISIONS

### D1 — The suspicionClass: closed set of seven, DERIVED not reported

Every terminal run carries exactly one `suspicionClass`, a member of the frozen set (ACTUAL sorted
order):

```
SUSPICION_CLASSES = Object.freeze([
  'capacity_reap',
  'clean_terminal',
  'credential_death',
  'explicit_stop',
  'provider_refusal',
  'watchdog_stall',
  'wave_close_teardown',
]);
```

It is carried on the terminal outcome *alongside* `terminalCause`, not replacing it: `terminalCause`
is the raw input (G1); `suspicionClass` is the derived classification. The derivation is a pure
function of durable sources — the run/wave record + the policy/orchestrator event log + the
deployment probe record — exactly the sources the trust gate already re-derives from
(`coordinator.mjs:3920`). Replay-safe by construction: the classifier, like `_gateVerdictItemForWorker`
(`coordinator.mjs:3920-3926`), reads the durable log and never in-memory "already classified"
bookkeeping.

### D2 — The derivation cascade (first matching evidence wins)

The classifier evaluates the seven in a fixed priority and assigns the first class whose evidence is
present. Recommended order, with the rationale for each tier:

| # | class | evidence that selects it (the FIRST present wins) | rationale |
|---|-------|---------------------------------------------------|-----------|
| 1 | `explicit_stop` | a `run.stop`/`run_stop`/`run_member_stop` receipt in `state.stops` (`wave.mjs:416`,`:421`) with `runAuthorityReleased === true` | operator intent is the proximate cause; it supersedes concurrent pathology |
| 2 | `watchdog_stall` | a `health.stall_suspected`/`health.loop_suspected`/`health.scope_violation` event for this run (`coordinator.mjs:9121`,`:9652`,`:9674`) OR a `budget_exceeded` hard-stop (`:9468`) — see DR2 | a mechanical, actor:`policy`, `mechanical: true` kill is hard evidence the system terminated the run for cause |
| 3 | `credential_death` | `credentialState ∈ {absent, expired, invalid, revoked, unavailable}` (`application-deployment.mjs:389/405/410/490/497/1170`) OR `authentication_refresh_required` (`route-liveness.mjs:244`) | a credential death is a definitive infra precondition; never the run's fault, never clean |
| 4 | `provider_refusal` | `terminalCause.kind === 'provider_failure'` (`coordinator.mjs:13460/4191/12823/12953`) OR an adapter wire `terminalCause ∈ {timeout, wire_frame_oversize, process_error}` OR a route-liveness provider code (`route-liveness.mjs:182/204/241/246`) | a provider-side crash/refusal is a proximate cause that precedes the reap it triggers |
| 5 | `capacity_reap` | `lifecycle.process_reap_unconfirmed` (`coordinator.mjs:12849`) OR `control.recovery_reap_unconfirmed` (`:9069`) OR `worker_worktree_authority_lost` (`:3352`) OR stop `remainingCount !== 0` / `application_run_stop_incomplete` (`application.mjs:4213`) OR a dead-owner reap (`worktree-capacity.mjs:535-560`) | resource/authority reclamation — often the consequence of 2–4, so it follows them |
| 6 | `wave_close_teardown` | the run is terminal *and* its death is attributable to the close operation: a stop error (`wave.mjs:520-521`), `residueUnknown === true` (`:526`), or `pumpDrained === false` (`:488`) | a teardown-operation failure is a contextual death, distinct from a crash that merely occurred during close |
| 7 | `clean_terminal` | residual: `terminalFrom(outline) === true` (`wave.mjs:139`) AND canonical phase `result_ready` (`wave.mjs:458`) AND no evidence for 1–6 AND the result section materialized (not bare `empty` over an existing pin — G8) | the only non-suspicious death; its honesty depends on the result actually existing |

The three inter-tier adjacencies — **explicit_stop(1) vs watchdog(2)** when a stop races a stall
kill, **provider(4) vs capacity(5)** when a crash triggers a reap, and **capacity(5) vs
wave_close(6)** when a reap fails inside close — are genuine tie-breaks whose order is an
authority-class decision: see **DR3**. The order above is the recommendation; the contract's pins
assert the *classification*, and DR3 fixes the exact race resolution.

### D3 — The evidence shape, closed per class (sorted keys)

Each `suspicionClass` carries a frozen evidence object whose keys are the closed set for that class.
No class ships without its evidence (refusal `death_evidence_absent`, §3).

- **`capacity_reap`** → `{cleanupState, ownedCount, reapBasis, remainingCount}`;
  `reapBasis ∈ {dead_owner_reap, process_reap_unconfirmed, recovery_reap_unconfirmed,
  stop_incomplete, worktree_authority_lost}`.
- **`clean_terminal`** → `{phase, resultSha}`; `phase === 'result_ready'`; `resultSha` present
  (never bare `empty` over a pin — G8).
- **`credential_death`** → `{credentialKind, credentialState, expiresAt}`;
  `credentialState ∈ {absent, expired, invalid, revoked, unavailable}`.
- **`explicit_stop`** → `{remainingCount, runAuthorityReleased, targetCount, via}`;
  `via ∈ {run.stop, stop_member}`.
- **`provider_refusal`** → `{adapter, harness, providerCode}`; `providerCode` is the typed code
  (`provider_crashed` | `provider_turn_failed` | `transport_closed_after_preservation` |
  `worktree_unavailable` | `authentication_required` | `timeout` | `wire_frame_oversize` |
  `process_error` | `provider_unreachable` | `route_unavailable` | `probe_content_mismatch` |
  `authentication_refresh_required`).
- **`watchdog_stall`** → `{action, basis, mechanical, trigger}`; `action ∈ {escalate, interrupt,
  kill, orient}`; `basis ∈ {budget, command_loop, no_progress_evidence, scope_drift}` (budget pending
  DR2); `trigger` carries the basis-specific scalar (`elapsedMs` | `{command, exitCode}` | `path` |
  `{dimension, limit, ratio, used}`).
- **`wave_close_teardown`** → `{closePhase, pumpDrained, residueUnknown, stopError}`;
  `closePhase ∈ {pumps_not_drained, residue_unknown, stop_failed}`.

All seven are surface-constant (one shape per class across the web/MCP/CLI/wire projections) and
shape-only safe: they name codes, counts, and digests — never worker content, never secrets (the
`#41`/`#169` posture, `kernel-honesty-audit.md:5-8`).

### D4 — The derivation-source law: durable policy/orchestrator events, never the worker's claim

The death certificate is the trust gate (R1, `referee.mjs:258`) applied to the termination. The
classifier reads the same durable sources `_gateVerdictItemForWorker` reads
(`coordinator.mjs:3920-3926`): the event log, the wave `evidence()` record (`wave.mjs:530-541`), and
the deployment probe record. It **never** reads a worker-authored "why I died" field. A worker that
self-reports `clean_terminal` while the durable log shows a `health.scope_violation` is classified
`watchdog_stall` — the self-report is ignored (refusal `death_self_reported`, §3). This is the
honesty invariant: the dead cannot certify their own death.

### D5 — The three manual-recovery cases become automatic

- **The suite-fold member** → classified `wave_close_teardown` when its death is attributable to
  `close()`/`settle()` (G4): a stop error, `residueUnknown`, or `pumpDrained === false`. No more
  manual diff of the fold record.
- **The trust-gate-killed impl member (`worker_path_scope_violation` at completion)** → the
  post-completion trust-gate rejection (`coordinator.mjs:13518-13529`). Its mapping is the one
  genuine taxonomy gap: see **DR1**.
- **The `#169` drives** → `credential_death` for the `#148` hidden-expiry drive (G6); `capacity_reap`
  for the silent dead-owner reaps (G2, #169 instance 4); and the `run.result` empty-over-pin case
  pins the `clean_terminal` boundary (a terminal run whose result did not materialize is NOT clean,
  G8). The silent `coordination_writer_busy`/lease-recovery drives (#169 instance 1) surface as
  `capacity_reap` evidence, not silent reclamation.

### D6 — Where the death certificate attaches (two surfaces, one derivation)

`suspicionClass` rides the existing terminal-cause slots — no new transport, no new projection — at
exactly the two surfaces a terminal run already reports:

- **The wave outcome** — `evidence().outcomes[]` already carries `{role, phase, terminal, narrative,
  resultSha, terminalCause, error}` per member (`wave.mjs:468-485`); the `suspicionClass` + its D3
  evidence object attach here, beside the existing `terminalCause`. This is the home for
  `wave_close_teardown` (P6) and the suite-fold member: the outcome is built inside `settle()`
  (`wave.mjs:449-490`), the same scope that builds `close()`'s `residueUnknown` (`wave.mjs:526`), so
  the teardown evidence is in scope where the class is assigned.
- **The run outline** — `projectRunOutline` already projects `outline.terminalCause`
  (`web-stream.mjs:84`) and `outline.resources.terminalCause` (`web-stream.mjs:88`), and
  `projectRunProgress` projects `terminalCause` (`web-stream.mjs:118`); the `suspicionClass`
  projects beside each, under the same `projectTerminalCause`-style closed-scalar gate. This is the
  home for `explicit_stop`/`provider_refusal`/`capacity_reap`/`watchdog_stall`/`credential_death`
  (P1–P5): the run outline is the surface `run.status` returns, and it is where the operator (web
  `renderExecution` `web-operator.mjs:145`, already reading `terminalCause.code`) reads the death.

`clean_terminal` (P7) attaches at both — it is the residual class on whichever surface the run
settled on. The derivation (D4) is one function; the two surfaces are its two read points. No pin
asserts a `suspicionClass` floating free of these slots — every pin's class is read from one of
them, which is what makes the pins behaviorally checkable at the edge.

---

## 3. REFUSAL VOCABULARY (closed, typed, surface-constant)

The classifier refuses four ways. Each is a typed code carrying its holder/cause/next action (the
`#160` actionability triple, `contract-fold.md` D1) — never a silent drop.

- **`death_evidence_absent`** — refuses to emit a `suspicionClass` without the class's closed
  evidence object (D3). A terminal run whose evidence is genuinely missing is surfaced as a RED
  conformance finding, never a bare class. *Holder:* the terminal outcome; *cause:* the missing
  evidence key; *next:* re-derive from the durable log (D4).
- **`death_class_open`** — refuses an open/unknown class. The seven are closed (D1); a terminal run
  no class can honestly name is a defect (the DR1 gap made visible), surfaced as a RED finding —
  never coerced to `clean_terminal` to close the loop. *Holder:* the run; *cause:* the unmapped
  terminalCause; *next:* resolve the DR that owns it.
- **`death_self_reported`** — refuses a worker-authored cause (D4). *Holder:* the worker; *cause:*
  the self-reported field; *next:* re-derive from the policy/orchestrator log.
- **`death_coalesced_unknown`** — refuses to coalesce a missing reap/residue value to zero or known
  (the `wave.mjs:505-507` law, "never coalesced to zero"; #169's anti-silent-reclamation posture).
  *Holder:* the stop receipt / resources block; *cause:* the null `ownedCount`/`remainingCount`;
  *next:* treat as `residueUnknown` → `capacity_reap` or `wave_close_teardown`, never `clean_terminal`.

The four are the ONLY ways the classifier declines to classify. There is no fifth "death_unknown"
escape hatch — a terminal run that triggers none of the four refusals and none of the seven classes
is, by D2 tier 7, `clean_terminal`, and that classification is itself pinned (P7) and conformance-gated.

---

## 4. RED-FIRST ACCEPTANCE PINS

The suite rows that must be RED at HEAD (each `stage:` names the HEAD failure seam — the absence of
`suspicionClass`, G8) and green only for a correct impl. Shallow-greenability is a defect: a pin
passes only when the derived class AND its closed evidence (D3) are both present and both correct.

| Pin | Scenario (constructed at the edge) | Assertion (RED at HEAD `3bb5791`) |
|-----|------------------------------------|-----------------------------------|
| **P1** | `explicit_stop`: a run admitted via `run.stop` (`wave.mjs:420`) whose receipt has `runAuthorityReleased === true` (`application.mjs:4212`) and `remainingCount === 0` | `suspicionClass === 'explicit_stop'` + evidence `{remainingCount: 0, runAuthorityReleased: true, targetCount, via}` (D3). `stage:` `suspicionClass` absent — the outcome carries only `terminalCause` (`wave.mjs:472`). |
| **P2** | `watchdog_stall`: a run with a `health.stall_suspected` event (`coordinator.mjs:9121`, `mechanical: true`, `basis: 'no_progress_evidence'`) | `suspicionClass === 'watchdog_stall'` + `{action, basis: 'no_progress_evidence', mechanical: true, trigger: {elapsedMs}}`. `stage:` no classifier reads `health.*`. |
| **P3** | `credential_death`: a route whose probe returned `credentialState: 'expired'` (`application-deployment.mjs:405`) — the `#148` drive | `suspicionClass === 'credential_death'` + `{credentialKind, credentialState: 'expired', expiresAt}`. `stage:` `credentialState` is recorded but never projected onto the death. |
| **P4** | `provider_refusal`: a worker that crashed (`lifecycle.crashed` → `terminalCause.kind: 'provider_failure'`, `code: 'provider_crashed'`, `coordinator.mjs:12953/4191`) | `suspicionClass === 'provider_refusal'` + `{adapter, harness, providerCode: 'provider_crashed'}`. `stage:` the kind is `provider_failure`, indistinguishable from `budget_exceeded` on the wire (G1). |
| **P5** | `capacity_reap`: a reap that did not confirm (`lifecycle.process_reap_unconfirmed`, `coordinator.mjs:12849`) with `remainingCount !== 0` | `suspicionClass === 'capacity_reap'` + `{cleanupState, ownedCount, reapBasis: 'process_reap_unconfirmed', remainingCount}`. `stage:` the reap event is logged but not classified. |
| **P6** | `wave_close_teardown`: a member whose stop throws inside `close()` (`wave.mjs:520-521`), `residueUnknown === true` (`:526`) — the suite-fold member | `suspicionClass === 'wave_close_teardown'` + `{closePhase: 'stop_failed', pumpDrained, residueUnknown: true, stopError: {code}}`. `stage:` `close()` returns the raw error/residue, no class. |
| **P7** | `clean_terminal`: a run with `terminal === true`, phase `result_ready` (`wave.mjs:458`), a materialized `resultSha`, and no evidence for P1–P6 | `suspicionClass === 'clean_terminal'` + `{phase: 'result_ready', resultSha}`. `stage:` no suspicion slot exists. |
| **P7-neg** | `clean_terminal` boundary: a terminal run whose `result` section reports bare `empty` over an existing pin (`kernel-honesty-audit.md:53`, ranked fix #4) | `suspicionClass !== 'clean_terminal'` — it is surfaced via `death_evidence_absent` / `death_class_open` (§3), NOT coerced clean. `stage:` the AX-wave bare-`empty` report is still present. |
| **P8** | trust-gate kill: a worker that completed then threw `worker_path_scope_violation` in `_runTrustGate` (`coordinator.mjs:13518-13529`) | `suspicionClass` is the DR1 resolution; at HEAD it degenerates to `clean_terminal`/`policy_failure` (the misclassification the contract ends). The pin is GREEN only under the chosen DR1 option; RED under the status quo. `stage:` `terminalCause.kind: 'policy_failure'` (`coordinator.mjs:13850`). |
| **P9** | `death_self_reported` negative: a worker that self-reports "done/clean" while the durable log shows `health.scope_violation` (`coordinator.mjs:9674`) | the self-report is ignored; `suspicionClass === 'watchdog_stall'`, NOT `clean_terminal`. `stage:` no derivation-source law exists (D4). |
| **P10** | `death_coalesced_unknown` negative: a stop with `ownedCount: null` (`wave.mjs:526`) | the null is NOT coalesced to 0; `residueUnknown === true` flows to `wave_close_teardown`/`capacity_reap`, never `clean_terminal`. `stage:` the residue is captured but not classified. |
| **P11** | `budget_exceeded` (DR2): a run hard-stopped at the budget limit (`coordinator.mjs:9468`, `_scheduleProviderStop('kill')` `:9477`) | `suspicionClass` is the DR2 resolution (recommended `watchdog_stall`, basis `budget`). RED at HEAD under any reading — `budget_exceeded` is a 4th `terminalCause` kind with no suspicion home (G1). `stage:` `terminalCause.kind: 'budget_exceeded'`. |

Static pin: **S1** — a conformance check (appended to the existing surface-conformance main,
`impl/scripts/surface-conformance.mjs`, per the `error-actionability` D3 model) computes the closed
`suspicionClass` set and fails on (a) a terminal outcome lacking a `suspicionClass`, (b) a class
whose evidence keys are not exactly its D3 closed set, (c) a `terminalCause`/`health.*`/`credential`
input that no class consumes (an unmapped death → RED, the DR1/DR2 surface). It is shape-only
(codes/counts/digests, never content) and prints `death-conformance: ok` when closed.

---

## 5. OPEN QUESTIONS → DECISION_REQUEST (authority-class; options + recommendation)

These three are authority-class: each changes either the closed class count, the closed evidence
shape, or the cascade ordering, and none is resolvable from the code alone. Each is recorded with
options and a recommendation; the contract is GREEN only under the authority's choice.

### DR1 — Where does the trust-gate rejection (and `policy_failure`) live? (the named manual case)

The post-completion trust-gate rejection (`worker_path_scope_violation`, `forbidden_effect_observed`,
`required_effect_absent`, `verification_red_green_failed`, `verification_coverage_failed`;
`coordinator.mjs:13518-13550`, `:3920-3938`, terminalCause `policy_failure` at `:13850`) and
`worker_policy_mismatch` (`:3270`, `:14004`) are `policy_failure` deaths with no natural home in the
seven. Under the D2 cascade a completed-then-rejected run falls through to `clean_terminal` (P7) — a
misclassification, exactly the defect the contract exists to prevent. `worker_worktree_authority_lost`
(`:3352`) is unambiguously `capacity_reap` and is NOT part of this DR.

- **(a) Fold into `watchdog_stall`** — both are actor:`policy`, mechanical rejections of the run;
  extend `watchdog_stall.basis` to `{budget, command_loop, no_progress_evidence, scope_drift,
  trust_gate_effect, trust_gate_scope, trust_gate_verification}`. *Preserves the seven; semantically
  lossy (in-flight watchdog vs at-completion trust gate collapse to one class).*
- **(b) Add an eighth class `trust_rejection`** — the honest home: at-completion,
  `verify.reverified accept=false`, distinct mechanism. *Contradicts the row brief's explicit seven;
  most semantically honest.*
- **(c) Fold into `capacity_reap`** — the trust gate does reap the worker's worktree on rejection.
  *Stretch; conflates untrustworthy work with resource reclamation.*

**Recommendation: (a).** It respects the brief's closed seven, and the unifying property
(actor:`policy`, mechanical, evidence-backed) is real. **Escalated** because it determines whether
the seven-class taxonomy is complete — the honest answer may be (b), and that is the authority's
call. P8 is GREEN only under the chosen option.

### DR2 — Where does `budget_exceeded` live?

`budget_exceeded` / `budget_hard_limit_exceeded` (`coordinator.mjs:9468`, replay-built at `:14294`)
is a fourth `terminalCause` kind (G1) with no suspicion home. It hard-stops via
`_scheduleProviderStop(handle, 'kill')` (`coordinator.mjs:9477`) — the same policy-kill machinery as
the watchdog.

- **(a) Fold into `watchdog_stall`** with `basis: 'budget'`, `trigger: {dimension, limit, ratio,
  used}`. *Both are mechanical policy hard-stops; same `_beginStop('kill')` seam.*
- **(b) Fold into `explicit_stop`** — it is a policy-initiated stop. *Conflates operator intent with
  an automatic ceiling.*
- **(c) Fold into `capacity_reap`** — tokens/usd are a resource ceiling. *Conflates spend with
  worktree/process reaping.*

**Recommendation: (a).** The budget hard-stop is mechanically a policy kill (`_applyWatchdogAction`
→ `_beginStop`), and its evidence `{dimension, limit, ratio, used}` fits `trigger`. **Escalated** —
the brief's seven name no budget class, so a fold is required, and which fold is authority-class.
P11 is GREEN only under the chosen option.

### DR3 — The cascade tie-break ordering (three adjacencies)

The D2 order has three races whose resolution is authority-class (the pins assert the *classification*;
DR3 fixes which class wins a genuine tie):

1. **explicit_stop(1) vs watchdog(2)** — a run an operator stopped while a stall kill was in flight.
   Does operator intent (1) or the mechanical kill (2) win? *Recommendation: explicit_stop wins iff
   the stop was admitted before the `health.*` event fired; else watchdog_stall.* The ordering is
   durable-event-timestamped, not wall-clock (no clocks).
2. **provider(4) vs capacity(5)** — a crash that triggers a reap. *Recommendation: provider_refusal
   wins (the crash is the proximate cause; the reap is the consequence), which is the D2 order.*
3. **capacity(5) vs wave_close(6)** — a reap that fails inside `close()`. *Recommendation:
   wave_close_teardown wins iff the failure is the close operation itself (stop threw / pumps did not
   drain); else capacity_reap.*

**Recommendation: as stated per adjacency.** **Escalated** because the three are genuine
authority-class judgment calls where two honest engineers could order them differently, and the
contract must not silently pick. The S1 conformance check pins whichever order the authority chooses.

---

## 6. PUBLISH

This contract is the `row-death` deliverable. It carries the closed `suspicionClass` taxonomy (D1),
the derivation cascade (D2), the per-class evidence (D3), the derivation-source law (D4), the three
manual-recovery resolutions (D5), the two attachment surfaces (D6), the closed refusal vocabulary
(§3), and the RED-first pin matrix
(§4) with three authority-class DECISION_REQUESTs (§5) surfaced, not buried. `suspicionClass` is
absent at HEAD `3bb5791` (G8); every pin is RED at HEAD and green only for a correct impl. The
harvest pin (`contract-death.md mustContain "contract"`) is satisfied. Shared publish deferred to the
coordinator's `contract-qa.md` cross-check per the wavefile harvest contract
(`lch-contracts.wavefile:42-47`); this row settles on its own evidence.
