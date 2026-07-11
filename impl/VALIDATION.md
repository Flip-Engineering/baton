# System Validation — phase 10.1 and the live recursive capstone

Validated 2026-07-10 against `master` after phase 10.1. This file replaces the former phase-6
judgment and its accumulated addenda; those historical corrections remain in docs/22–24 and the
committed evidence ledgers.

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

## Verification evidence

| Gate | Current evidence |
|---|---|
| Zero-quota suite | **427/427 passing** via bare `node --test` in `impl/` |
| U-1…U-11 | All reproduced before repair; verdict ledger in `docs/handoff/evidence/phase10.1-reverification.md` |
| Fresh adversarial review | No unresolved critical/major finding; `docs/handoff/evidence/phase10.1-adversarial-review.md` |
| Three-vendor live fleet | `docs/reference/evidence/phase10.1-capstone-2026-07-10/summary.json` has every check true; 573-event raw ledger beside it |
| Recursive output | Three trust-gated review artifacts under `reviews/dogfood/`, authored by real Claude, Codex, and Grok workers and integrated into `master` |
| Multi-Grok kill/reap | `docs/reference/evidence/grok-multi-reap-2026-07-10/summary.json` has every check true; raw ledger beside it |
| Credential discipline | GLM checked by presence only and recorded `PENDING-LIVE-no-credential`; no credential value was logged |

The three-vendor capstone checks were: no harness error; Claude/Codex/Grok all completed; every
completion had `verify.reverified.accept:true`; native Claude steer landed; native Codex interrupt
confirmed and ended `cancelled`; real approvals were consumed; and all three vendor turns
overlapped before the earliest terminal.

## Honest remaining limits

These are absent, not implied by the green suite:

1. **Worker-session resume/fork through the driver.** All three vendors expose it, but the
   coordinator always cold-spawns and cannot recover/fork a durable vendor session.
2. **Token/USD governance and watchdog action.** Wall-time is enforced. Usage is observed, but
   `handle.budgetUsed`, threshold events, hard spend stops, and automatic stall/loop response are
   not wired end to end.
3. **Red→green base-sandbox execution.** The acceptance policy exists; the public assembly cannot
   currently generate the required base verdict.
4. **Merge/push lifecycle.** Baton ends at a verified task branch. Integration remains an explicit
   operator action; irreversible push approval is absent. Retaining completed branches enables
   review/integration, while cancelled stress branches were cleaned explicitly.
5. **Restart reattachment.** Replay reconstructs terminal task truth, but a new coordinator process
   cannot reattach to already-running vendor processes/threads.
6. **GLM live proof.** `GlmSessionCli` is built to the credential boundary, but no credential was
   present in this run.
7. **Production runtime and northbound surface.** The implementation remains dependency-free Node
   ESM; no Go/Elixir port or MCP northbound server has shipped.
8. **Cross-vendor decorrelation eval (E2).** The fleet required to run it now exists; the eval is a
   phase-11 research decision, not evidence retroactively required for phase-10 wiring completion.

The full researched-versus-shipped inventory and phase boundary are in
`docs/25-capability-gap.md`.

## Final judgment

Phase 10 is complete as a wiring-and-live-proof milestone. The system is no longer a set of
unit-green modules or hand-run vendor adapters: the public driver controlled a heterogeneous live
fleet recursively on its own repository, accepted only independently verified work, and then
proved it could stop and reap four same-vendor sessions concurrently. The next work should deepen
session continuity and governance rather than reopen phase-10 assembly.
