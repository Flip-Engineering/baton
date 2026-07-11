# System Validation — phase 11 control, model, and persistent-session gates

Validated 2026-07-11 against `master` through phase 11 persistent sessions. Phase 10.1's assembled
fleet baseline remains below; the phase-11 additions are control integrity, exact orchestrator
model selection, and persistent follow-up/resume/fork/recovery contracts.

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

The red→green and coverage policies are real `accept()` options, but red→green remains phase-11
debt because `createDriver()` does not yet build/pass the base sandbox required to produce a
non-null `verdict.redGreen`. The default fresh-result check is fully wired and live-proven.

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

## Verification evidence

| Gate | Current evidence |
|---|---|
| Zero-quota suite | **472/472 passing** via bare `node --test` in `impl/` |
| U-1…U-11 | All reproduced before repair; verdict ledger in `docs/handoff/evidence/phase10.1-reverification.md` |
| Fresh adversarial review | No unresolved critical/major finding; `docs/handoff/evidence/phase10.1-adversarial-review.md` |
| Three-vendor live fleet | `docs/reference/evidence/phase10.1-capstone-2026-07-10/summary.json` has every check true; 573-event raw ledger beside it |
| Recursive output | Three trust-gated review artifacts under `reviews/dogfood/`, authored by real Claude, Codex, and Grok workers and integrated into `master` |
| Multi-Grok kill/reap | `docs/reference/evidence/grok-multi-reap-2026-07-10/summary.json` has every check true; raw ledger beside it |
| Concurrent exact models | `docs/reference/evidence/phase11-grok-model-selection-2026-07-11/summary.json` has every check true |
| Persistent two-turn Grok | `docs/reference/evidence/phase11-grok-persistent-session-2026-07-11/summary.json` has all 16 checks true; same session/PID, two fresh verdicts, full reap |
| Credential discipline | GLM checked by presence only and recorded `PENDING-LIVE-no-credential`; no credential value was logged |

The three-vendor capstone checks were: no harness error; Claude/Codex/Grok all completed; every
completion had `verify.reverified.accept:true`; native Claude steer landed; native Codex interrupt
confirmed and ended `cancelled`; real approvals were consumed; and all three vendor turns
overlapped before the earliest terminal.

## Honest remaining limits

These are absent, not implied by the green suite:

1. **Token/USD governance and watchdog action.** Wall-time is enforced. Usage is observed, but
   `handle.budgetUsed`, threshold events, hard spend stops, and automatic stall/loop response are
   not wired end to end.
2. **Red→green base-sandbox execution.** The acceptance policy exists; the public assembly cannot
   currently generate the required base verdict.
3. **Merge/push lifecycle.** Baton ends at a verified task branch. Integration remains an explicit
   operator action; irreversible push approval is absent. Retaining completed branches enables
   review/integration, while cancelled stress branches were cleaned explicitly.
4. **Automatic rejoin and remaining vendor depth.** Explicit native resume/recovery is shipped;
   automatic startup rejoin to an already-running broker/process is not. Grok's vendor-specific
   fork/rewind schemas remain `planned`, and checkpoint/rewind depth remains incomplete.
5. **GLM live proof.** `GlmSessionCli` is built to the credential boundary, but no credential was
   present in this run.
6. **Production runtime and northbound surfaces.** The implementation remains dependency-free Node
   ESM; MCP and the authenticated HTTPS/WebSocket user-to-orchestrator control connection have not
   shipped, nor has the eventual Go/Elixir production core.
7. **Cross-vendor decorrelation eval (E2).** The fleet required to run it now exists; the eval is a
   phase-11 research decision, not evidence retroactively required for phase-10 wiring completion.

The full researched-versus-shipped inventory and phase boundary are in
`docs/25-capability-gap.md`.

## Final judgment

Phase 10 is complete as a wiring-and-live-proof milestone, and the first three phase-11 gates are
complete. The system is no longer a set of
unit-green modules or hand-run vendor adapters: the public driver controlled a heterogeneous live
fleet recursively on its own repository, accepted only independently verified work, and then
proved it could stop and reap four same-vendor sessions concurrently, select exact models, and run
two independently verified turns on one native session. The next pursuit is enforcement:
credential/home isolation, token/USD budgets, watchdog action, and hardened acceptance.
