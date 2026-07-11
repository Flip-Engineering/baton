# System Validation — phase 11 control, model, and persistent-session gates

Validated 2026-07-11 against `master` through phase 11 acceptance/integration. Phase 10.1's assembled fleet
baseline remains below; the phase-11 additions are control integrity, exact orchestrator model
selection, persistent follow-up/resume/fork/recovery, isolated runtime homes, canonical budgets,
deterministic watchdog actions, hardened acceptance, local integration, and publication approval.

## Verdict

**Baton's reference implementation now does what the phase-10 fleet-driver goal claims.** Through
the public `createDriver()` assembly, real Claude Code, Codex app-server, and Grok ACP session
workers ran concurrently in isolated git worktrees; Claude accepted a native mid-turn steer; Codex
confirmed a real interrupt; Claude and Grok permission requests were approved through the
coordinator; and every completing worker was accepted only after the hub re-ran its pinned check in
a fresh worktree. The live capstone passed every machine-checked gate.

The result is a reference implementation/executable specification, not yet the intended Go or
Elixir production port. The important durable assets are its numbered contracts, wire-faithful
fakes, event/replay semantics, and live protocol ledgers.

Phase 11 additionally proves that model selection is an orchestrator-level choice independent of
harness selection, and that an attached verified session can execute another public turn without
respawning. Durable session references replay honestly as orphaned; explicit bounded recovery
requires a fresh exact-identity handshake and validated worktree ownership.

## What is shipped and proven

### One assembled session fleet

`createDriver()` assembles the event log, fencing, worktree manager, referee/accept gate, adaptive
router, story compiler, coordinator, and the exported session adapter surface:

- `ClaudeSessionCli` — Claude Code 2.1.206 stream-json, native mid-turn user-frame steering,
  interrupt, approvals/questions, multi-turn sessions, and process-group kill;
- `CodexAppServerCli` — Codex CLI 0.144.0 app-server, native turn steer/interrupt, keyed approvals
  and questions, token/rate-limit telemetry, and persistent threads;
- `GrokAcpCli` — Grok Build 0.1.216 ACP, native prompt/interrupt/approval/kill, explicit
  cancel-then-reprompt steer emulation, and prompt `_meta` usage;
- `GlmSessionCli` — the Claude-session implementation with Z.ai's supported Anthropic-compatible
  environment and capability tag. It is built and fake-proven to the credential boundary; this
  machine had no Z.ai credential, so live GLM is honestly `PENDING-LIVE`.

The legacy one-shot adapters remain an explicitly limited fire-and-forget tier. They are not the
phase-10 product posture or the live-capstone path.

### The trust gate is the done gate

When a worker reports completion, Baton captures its work, creates a fresh detached verification
worktree, runs the brief's pinned command there, passes the resulting verdict through `accept()`,
and records the result in routing only as a verified win/loss. A worker's text or exit claim cannot
mark the task complete by itself. Vendor attribution is threaded into snapshot commits.

The public driver can require a fresh base/result red→green proof, coverage of the actual changed
lines, and a nonzero all-killed mutation population. Independent oracle/review tasks receive the
immutable original brief plus captured Git references rather than implementer prose; a required
oracle must complete through its own trust gate under a different vendor/model family.

Hard token/USD stops retain authority while allowing a bounded terminal-frame grace (250ms by
default): final cumulative usage can no longer kill a worker between its finished output and the
adjacent terminal protocol frame. A terminal claim only cancels the transport kill; it still enters
the same independent trust gate.

### Explicit integration and publication authority

`integrate(worker, {strategy:'ff-only'})` accepts only a captured, trust-gated result, reaps the
worker/worktree/branch, refuses dirty or diverged main without history rewriting, and preserves a
durable result ref when integration refuses. Successful integration records exact before/result/
after SHAs. Publication is a separate single-consumer approval over an exact integrated SHA,
credential-free remote name, full branch ref, and current authority fence. Missing approval,
deny, timeout, stale fence, or restart performs no push. The default publisher uses argument-safe
`git push`; tests inject a no-network publisher, so no real remote mutation was performed here.

### Stop and delivery authority is reconciled

Phase 10's assembly introduced an async-spawn race cluster that the then-green suite missed. Phase
10.1 re-reproduced U-1 through U-11 and pinned SC12–SC20:

- each session adapter synchronously reserves a worker before awaiting `worktreeReady`;
- interrupt/kill while pending confirms the stop and prevents child creation;
- duplicate same-worker spawn cannot create an unreachable second child;
- late-created worktrees are reaped after an early stop;
- cancellation is terminal and monotonic in memory and replay;
- queued delivery cannot cross a finalized interrupt/kill or revive a task;
- refused and rejected spawn share one durable failure channel;
- Codex first-turn setup failure reaps its child before refusal;
- session wall-time budgets emit an observable timeout crash and reap the child;
- confirmed interrupt clears that wall timer; and
- story completion follows crash/exit/turn facts rather than stale warning/verdict proxies.

A fresh adversarial pass found four further seams—late worktree cleanup, replay monotonicity,
accepted-verdict crash inheritance, and interrupt timer cleanup—and closed each before live spend.

### Multiple real workers can be stopped and reaped

The dedicated Grok stress ran one `GrokAcpCli` instance at its four-session ceiling. Four distinct
real Grok PIDs reached active turns concurrently; two workers confirmed native interrupt; all four
then confirmed kill. The test independently proved all PIDs gone, all task worktree directories and
git worktree registrations gone, every task terminal, and all temporary stress branches deleted.

### Exact model and persistent-session control

`spawn(vendor, brief, {model, modelPolicy})` filters model eligibility before routing, maps exact
model/effort/service controls to native harness wires, carries requested/resolved/observed identity
through replay and verification, and kills silent non-alias fallbacks. Two real Grok models ran
concurrently and were fully reaped.

`send(worker, text, 'turn')` now reopens an idle verified attached session only after a truthful
adapter Ack, advances the coordinator generation, and independently verifies the new turn. Claude
and Codex support explicit resume/fork mappings; Grok supports ACP `session/load`. Resume requires
the recorded worktree owner/context, while fork allocates a fresh worktree and lineage edge.
Restart replay never trusts a stored PID. `recover()` is bounded and attaches only when a fresh
native handshake reports the exact persisted identity; ambiguity triggers cleanup.

Each driver worker now receives a private home/tmp/vendor-config scope. Ambient provider secrets,
proxy credentials, and code-injection environment variables are stripped; credentials are
explicit projections whose values never enter public state or logs. Claude, Codex, and Grok map
their available sandbox controls with honest cards. Canonical token/USD deltas drive durable
50/80/100% thresholds and confirmed hard stops. Mechanical stall, repeated-failure loop, and
out-of-scope edit rules invoke bounded interrupt/kill without pretending to judge semantics.

## Verification evidence

| Gate | Current evidence |
|---|---|
| Zero-quota suite | **526/526 passing** via bare `node --test` in `impl/`; every direct Coordinator fixture supplies durable authority, terminal task state plus manifests and invalidation plus contamination each commit as one batch, trust-gate coordination failure poisons then restarts durably failed, worker artifact claims remain untrusted manifests, named promotions are durable, and the two-Grok ACP process test proves concurrent native child PIDs, confirmed kills, and process/worktree/branch reap |
| U-1…U-11 | All reproduced before repair; verdict ledger in `docs/handoff/evidence/phase10.1-reverification.md` |
| Fresh adversarial review | No unresolved critical/major finding; `docs/handoff/evidence/phase10.1-adversarial-review.md` |
| Three-vendor live fleet | `docs/reference/evidence/phase10.1-capstone-2026-07-10/summary.json` has every check true; 573-event raw ledger beside it |
| Recursive output | Three trust-gated review artifacts under `reviews/dogfood/`, authored by real Claude, Codex, and Grok workers and integrated into `master` |
| Multi-Grok kill/reap | `docs/reference/evidence/grok-multi-reap-2026-07-10/summary.json` has every check true; raw ledger beside it |
| Concurrent exact models | `docs/reference/evidence/phase11-grok-model-selection-2026-07-11/summary.json` has every check true |
| Current Grok rerun | `docs/reference/evidence/phase11-grok-model-selection-2026-07-11/attempt-2026-07-11-auth-expired.md` is honestly `PENDING-LIVE-grok-reauth`; provider rejected both isolated sessions before PID/model establishment, while cleanup remained complete |
| Persistent two-turn Grok | `docs/reference/evidence/phase11-grok-persistent-session-2026-07-11/summary.json` has all 16 checks true; same session/PID, two fresh verdicts, full reap |
| Isolated governance Grok | `docs/reference/evidence/phase11-grok-governance-2026-07-11/summary.json` has all 16 checks true; private credential scope, real sandbox denial, canonical usage, automatic budget kill, full reap |
| Acceptance/integration | `docs/handoff/evidence/phase11-acceptance-integration-2026-07-11.md`; 16 focused temp-repo tests cover AC1–AC6 and the full suite is 502/502 |
| Coordination foundation | `docs/handoff/evidence/phase11-coordination-foundation-2026-07-11.md`; 28 coordination, 20 persistent-session, and 23 acceptance/integration focused contracts plus the 567/567 full suite cover mandatory durable authority, centralized fail-closed mutations, pre-effect intents, bounded post-effect ambiguity, accepted question/approval single-consumer release, injected create/claim/input/stop/cancel/follow-up/recovery/review/trust/integration/publication/read crash windows, fatal dual-stream writes, atomic artifact/contamination/integration/publication writes, post-merge authority-loss replay, refinement runtime cleanup, replay refusal of telemetry-only and asymmetric decision-only success, named promotion/provenance, mediated Scratch, logged `ReadBy` recall, and refusal auditing; exact-model Codex review and correction review passed full lifecycle/reap gates with no remaining CK9 major, while reauthenticated Grok remains pending |
| Authenticated web command/auth vertical | `docs/handoff/evidence/phase12-web-northbound-2026-07-11.md`; 16 focused contracts plus the 542/542 full suite cover durable cookie/Bearer issue/expiry/revocation with hashed secrets, auth/origin/CSRF/scope checks, strict envelopes, independent harness/model forwarding, restart-safe idempotency, fail-closed audit completion, bounded HTTP/CORS, non-leaking errors, TLS/auth server refusal, and real stale-fence stop/reap behavior; streaming/login/rotation/adversarial WN gates remain explicit |
| Atlas structural delta | `docs/handoff/evidence/phase13-atlas-structural-2026-07-11.md`; 7 focused contracts plus the 551/551 full suite use pinned real ast-grep parsing for confined, deterministic, token-bounded, content-addressed JS/TS-family AST deltas and live-prove Baton's own added export; shared index/overlay, search, symbols/SCIP, and later representation rungs remain explicit |
| Credential discipline | GLM checked by presence only and recorded `PENDING-LIVE-no-credential`; no credential value was logged |

The three-vendor capstone checks were: no harness error; Claude/Codex/Grok all completed; every
completion had `verify.reverified.accept:true`; native Claude steer landed; native Codex interrupt
confirmed and ended `cancelled`; real approvals were consumed; and all three vendor turns
overlapped before the earliest terminal.

## Honest remaining limits

These are absent, not implied by the green suite:

1. **Quota-window and fleet-seat governance.** Per-task wall/token/USD budgets and mechanical
   watchdog actions ship. Proactive account/rate-limit reads, quota-window scheduling, and
   automatic seat degradation remain incomplete; provider cost is zero where the wire reports no
   USD amount.
2. **Cross-harness sandbox parity.** Grok workspace sandbox denial is live-proven and Codex's
   native network-denied workspace policy is wire-mapped. Claude's isolated sandbox settings and
   Codex's effect require dedicated live denial probes; Grok child-network restriction is not
   available under macOS workspace mode and remains honestly carded uncontrolled.
3. **Semantic merge depth.** Exact fast-forward-only integration and approval-gated publication
   ship. Conflict classification, semantic merge, stacked integration, rollback, deploy adapters,
   and a live remote-push proof remain absent.
4. **Automatic rejoin and remaining vendor depth.** Explicit native resume/recovery is shipped;
   automatic startup rejoin to an already-running broker/process is not. Grok's vendor-specific
   fork/rewind schemas remain `planned`, and checkpoint/rewind depth remains incomplete.
5. **GLM live proof.** `GlmSessionCli` is built to the credential boundary, but no credential was
   present in this run.
6. **Production runtime and complete northbound surfaces.** The implementation remains
   dependency-free Node ESM. The first authenticated HTTPS command vertical ships, but durable
   session lifecycle, resumable WebSocket/SSE delivery, MCP, browser/adversarial proof, and the
   eventual Go/Elixir production core remain incomplete.
7. **Cross-vendor decorrelation eval (E2).** The fleet required to run it now exists; the eval is a
   phase-11 research decision, not evidence retroactively required for phase-10 wiring completion.
8. **Atlas and representation depth.** The first real AST/CST structural-delta vertical ships for
   the built-in JS/TS-family grammars. Shared base/overlay indexing, structural search/rewrite,
   symbol/SCIP graphs, CPG/dataflow, IR, behavioral fingerprints, semantic diff/merge, and e-graph
   evaluation remain incomplete and explicitly catalogued.

The full researched-versus-shipped inventory and phase boundary are in
`docs/25-capability-gap.md`.

## Final judgment

Phase 10 is complete as a wiring-and-live-proof milestone, and the control/model/session/governance
phase-11 gates are complete. The system is no longer a set of
unit-green modules or hand-run vendor adapters: the public driver controlled a heterogeneous live
fleet recursively on its own repository, accepted only independently verified work, and then
proved it could stop and reap four same-vendor sessions concurrently, select exact models, and run
two independently verified turns on one native session, isolate a live credentialed Grok worker,
deny an outside-worktree write in its native sandbox, and auto-kill/reap it at a hard token budget.
The next pursuit is the durable task/artifact/Scratch/shared-knowledge-graph substrate, followed by
the first Atlas AST/symbol-graph vertical and the authenticated northbound control surface.
