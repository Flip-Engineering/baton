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

`spawn(vendor, brief, {model, effort, modelPolicy})` filters exact tuple eligibility before routing,
maps exact model/effort/service controls to native harness wires, carries
requested/resolved/observed identity
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
| Canonical zero-quota suite | **729/729 passing** via `npm test` in `impl/`; its lifecycle owner reaps the private suite root, and the real linked-worktree regression covers recursive Baton execution without relying on a directory-shaped `.git` |
| U-1…U-11 | All reproduced before repair; verdict ledger in `docs/handoff/evidence/phase10.1-reverification.md` |
| Fresh adversarial review | No unresolved critical/major finding; `docs/handoff/evidence/phase10.1-adversarial-review.md` |
| Three-vendor live fleet | `docs/reference/evidence/phase10.1-capstone-2026-07-10/summary.json` has every check true; 573-event raw ledger beside it |
| Recursive output | Three trust-gated review artifacts under `reviews/dogfood/`, authored by real Claude, Codex, and Grok workers and integrated into `master` |
| Multi-Grok kill/reap | `docs/reference/evidence/grok-multi-reap-2026-07-10/summary.json` has every check true; raw ledger beside it |
| Concurrent exact models | `docs/reference/evidence/phase11-grok-model-selection-2026-07-11/summary.json` has every check true |
| Current concurrent Grok rerun | `docs/handoff/evidence/phase21-grok-concurrent-reap-2026-07-11.md`; exact `grok-4.5` and `grok-composer-2.5-fast` were concurrently requested/resolved/provider-observed on distinct PIDs, both first turns were interrupted, one session resumed and was killed while working, idempotent kills passed, and all process/worktree/runtime/metadata/branch checks passed |
| Persistent two-turn Grok | `docs/reference/evidence/phase11-grok-persistent-session-2026-07-11/summary.json` has all 16 checks true; same session/PID, two fresh verdicts, full reap |
| Isolated governance Grok | `docs/reference/evidence/phase11-grok-governance-2026-07-11/summary.json` has all 16 checks true; private credential scope, real sandbox denial, canonical usage, automatic budget kill, full reap |
| Acceptance/integration | `docs/handoff/evidence/phase11-acceptance-integration-2026-07-11.md`; 16 focused temp-repo tests cover AC1–AC6 and the full suite is 502/502 |
| Coordination foundation | `docs/handoff/evidence/phase11-coordination-foundation-2026-07-11.md`; 28 coordination, 20 persistent-session, and 23 acceptance/integration focused contracts plus the 575/575 full suite cover mandatory durable authority, centralized fail-closed mutations, pre-effect intents, bounded post-effect ambiguity, accepted question/approval single-consumer release, injected create/claim/input/stop/cancel/follow-up/recovery/review/trust/integration/publication/read crash windows, turn-crash versus process-exit cleanup, fatal dual-stream writes, atomic artifact/contamination/integration/publication writes, post-merge authority-loss replay, refinement runtime cleanup, replay refusal of telemetry-only and asymmetric decision-only success, named promotion/provenance, mediated Scratch, logged `ReadBy` recall, and refusal auditing; exact-model Codex review and correction review passed full lifecycle/reap gates with no remaining CK9 major, while reauthenticated Grok remains pending |
| Authenticated web command/auth vertical | `docs/handoff/evidence/phase12-web-northbound-2026-07-11.md`; 16 focused contracts plus the 542/542 full suite cover durable cookie/Bearer issue/expiry/revocation with hashed secrets, auth/origin/CSRF/scope checks, strict envelopes, independent harness/model forwarding, restart-safe idempotency, fail-closed audit completion, bounded HTTP/CORS, non-leaking errors, TLS/auth server refusal, and real stale-fence stop/reap behavior; streaming/login/rotation/adversarial WN gates remain explicit |
| Authenticated web SSE WN6 | `docs/handoff/evidence/phase12-web-stream-2026-07-11.md`; 62 focused Phase 11/12 contracts plus the 598/598 full suite cover authenticated single-use stream nonces, exact binding, snapshot/reconnect cursors, bounded replay/backpressure/tickets/connections, fail-closed audit/read/write/setup behavior, split trust labels, live expiry/revocation including per-event replay checks, HTTP/CORS integration, and disconnect-without-fleet-control; four exact-model recursive Baton turns all integrated or rejected honestly and fully reaped, ending in a no-actionable-finding review |
| Atlas structural delta | `docs/handoff/evidence/phase13-atlas-structural-2026-07-11.md`; 7 focused contracts plus the 551/551 full suite use pinned real ast-grep parsing for confined, deterministic, token-bounded, content-addressed JS/TS-family AST deltas and live-prove Baton's own added export; shared index/overlay, search, symbols/SCIP, and later representation rungs remain explicit |
| Atlas index/symbol/SCIP | `docs/handoff/evidence/phase13-atlas-index-symbols-2026-07-11.md`; 9 focused contracts plus the 576/576 full suite cover projection-committing explicit epochs, artifact/epoch tamper refusal, base-plus-worktree overlay reconciliation/staleness, lexical/repo-map/code-seed orientation, parsed symbol/reference/call graphs, SCIP JSON artifacts, bounded resumable output, cancellation/confinement, result ceilings, typed ambiguity, deterministic reverify, and a live 75-document Baton self-index; exact-model semantic review awaits quota reset, while live LSP, structural rewrite, semantic/CPG/IR/merge rungs remain explicit |
| Atlas structural search/rewrite proposals | `docs/handoff/evidence/phase17-atlas-structural-rewrite-2026-07-11.md`; AR1–AR10, 9/9 focused tests, and 701/701 full-suite tests cover real AST-pattern search, capture provenance, single/variadic deterministic edits, immutable proposed-source/manifests, parse health, path/UTF-8/cancellation/resource refusal, bounded resume, tamper refusal, and reverify. A Baton-on-Baton run found and rewrote-previewed real `sha($A)` calls while proving the source stayed byte-identical; direct apply, full rule configs, live LSP, CPG/IR/behavior/semantic/e-graph rungs remain explicit |
| Atlas CPG seed | `docs/handoff/evidence/phase18-atlas-cpg-2026-07-11.md`; CG1–CG8, 8/8 focused tests, and current 721/721 full-suite tests cover source-bound function/statement/identifier/call graphs, containment, control skeleton including branches and terminal exits, lexical reaching definitions, assignment/argument value edges, honest local-call resolution/ambiguity and arrow binding names, parse health, deployment bounds, exact-path/schema/digest resume, tamper refusal, and reverify. Baton built and reverified a substantial graph of its MCP northbound; SSA, path-sensitive PDG, aliases, interprocedural returns, and dynamic dispatch remain explicit |
| Atlas CPG delta and impact | `docs/handoff/evidence/phase19-atlas-cpg-delta-2026-07-11.md`; CD1–CD8, 6/6 delta tests (20/20 combined R3), and 721/721 full-suite tests cover immutable before/after graphs, formatting-invariant semantic keys, node/edge deltas, rename honesty, bounded containment/def-use/reverse-call impact, unresolved-call non-propagation, parse/cancel/resource refusal, resume integrity, and reverify. Baton self-proved a `sha`-helper delta; repository-wide overlays and full SSA/PDG remain explicit |
| Atlas operator-specified taint reachability | `docs/handoff/evidence/phase20-atlas-cpg-taint-2026-07-11.md`; CT1–CT8, 6/6 taint tests (20/20 combined R3), and 721/721 full-suite tests cover source/sink/sanitizer policy, assignment/reaching-def/argument witnesses, sanitizer cuts, deterministic shortest paths, deployment depth/path/result bounds, parse/cancel/resume/tamper gates, and reverify. Baton traced its real `JSON.parse` message into `server.handle`; path feasibility, aliases, heap/implicit flows, dynamic dispatch, and interprocedural returns remain unclaimed |
| Atlas bounded path-sensitive CPG | `docs/handoff/evidence/phase22-atlas-cpg-path-sensitive-2026-07-11.md`; PS1–PS8, 7/7 focused tests (27/27 combined R3), and 729/729 canonical tests cover correct braced-if/else and `else if` entry/join, literal dead-branch pruning, deployment-bounded CFG may-reaching definitions, identifier copies, immediate-only nested value edges, sanitizer non-bypass, unsupported-control atomic collapse, and deterministic reverify. Baton rebuilt its own CPG and preserved the real MCP taint witness; full path-condition solving, SSA/PDG, aliases/heap/implicit flow, exceptions, interprocedural returns, and dynamic dispatch remain unclaimed |
| Harness/model/effort route tuple | `docs/handoff/evidence/phase14-route-tuple-2026-07-11.md`; 609/609 full-suite contracts plus recursive exact `CodexAppServerCli` + `gpt-5.6-sol` + `low` runs cover direct/auto/web selection, native mapping, honest nullable observation, recovery, durable event/coordination/story/result/replay/review/integration/commit attribution, exact learning buckets with read-only legacy fallback, mismatch kill/reap, and heterogeneous assembled-driver filtering; the final detached review found no actionable defect and every lifecycle/reap check passed |
| Authenticated web session lifecycle | `docs/handoff/evidence/phase12-web-session-lifecycle-2026-07-11.md`; 44 focused contracts plus the 619/619 full suite cover injected-provider-only claims, cookie/Bearer login, fsynced atomic credential rotation, restart-safe predecessor refusal, refresh/logout TLS/origin/JSON/CSRF/CORS controls, shared claim/TTL validation, audit-before-mutation failure ordering, non-leakage, live stream revocation, and zero fleet side effects; recursive exact-model build and correction review fully reaped, ending with no actionable IL1–IL8 finding |
| Authenticated web edge policy | `docs/handoff/evidence/phase12-web-edge-2026-07-11.md`; 82 focused Phase 12 contracts plus the current 678/678 full suite cover canonical direct/trusted-proxy identity, raw forwarding provenance, listener-wide HTTPS, bounded and ordered quotas, non-disclosing readiness, audit-amplification resistance, atomic ticket delivery, and bounded shutdown/stream cleanup. Eleven recursive exact-route corrective reviews were integrated and fully reaped; a twelfth clean review was provider-refused before verdict, so the final independent clean-review gate remains pending |
| Owned test-fixture lifecycle | `docs/handoff/evidence/phase15-test-fixture-lifecycle-2026-07-11.md`; TF1–TF4 red/green nested process tests prove pass, fail, SIGTERM, descendant-process reap, sibling preservation, and result truth. The canonical `npm test` run passes 660/660 and leaves zero `baton-suite-*` roots in its configured parent |
| Browser OIDC and operator seat | `docs/handoff/evidence/phase12-browser-control-2026-07-11.md`; 12 new BO/BU contracts, 100/100 combined Phase 12 tests, and the 678/678 full suite cover browser-bound PKCE state, exact verified identity, provider/mapper timeouts and capacity, durable session/CSRF cookies, clean callback redirect, delivery-failure revocation, authenticated no-store/CSP assets, sanitized session projection, exact harness/model/effort inputs, fenced controls, and existing SSE/logout wiring. A real TLS socket proof passes eight end-to-end redirect/cookie/command/SSE/revocation gates and fully cleans up; in-app browser interaction and provider-backed review remain pending because their execution/quota providers were unavailable |
| Durable web command reconciliation | `docs/handoff/evidence/phase12-web-command-reconciliation-2026-07-11.md`; 6 RC contracts, 22/22 focused status/operator/northbound tests, and 678/678 full-suite tests cover server-derived durable user ownership, admitted/completed/failed sanitized reads, restart and same-user credential rotation, cross-user/legacy/malformed hidden-object posture, observe/repo scope, audit failure, zero coordinator calls, bounded routable IDs, and same-ID browser polling |
| MCP stdio northbound | `docs/handoff/evidence/phase16-mcp-northbound-2026-07-11.md`; MN1–MN10, 14/14 focused tests, and 692/692 full-suite tests cover the stable 2025-11-25 handshake, eight closed fleet tools, the packaged subprocess, fixed injected authority and deployment quota, exact harness/model/effort dispatch, fences, bounded wait, durable pre-effect admission, restart replay, typed versus ambiguous post-effect refusal, structured/text results, fatal UTF-8 and output failures, and deployment-bounded newline stdio framing. Recursive exact-route review reached native `gpt-5.6-sol` then hit the provider usage limit; full reap passed but no review verdict is claimed |
| Credential discipline | Grok auth was presence-checked and explicitly projected into private runtime homes without logging values. An ignored operator-owned GLM credential file is present and remains unread; live GLM evidence is not inferred from presence |

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
   dependency-free Node ESM. The authenticated HTTPS command/session vertical, resumable SSE WN6,
   EP1–EP9 edge policy, BO1–BO7 OIDC bootstrap, and BU1–BU7 minimal operator seat ship, but a
   production OIDC provider adapter, optional WebSocket parity,
   Streamable HTTP MCP authorization, MCP Tasks/daemon supervision, deeper operator surfaces, real-browser/end-to-end
   adversarial proof, and the eventual Go/Elixir production core remain incomplete.
7. **Cross-vendor decorrelation eval (E2).** The fleet required to run it now exists; the eval is a
   phase-11 research decision, not evidence retroactively required for phase-10 wiring completion.
8. **Atlas and representation depth.** The real AST/CST structural-delta and proposal-only
   structural search/rewrite verticals plus shared base/worktree indexing,
   lexical/repo-map/code-seed orientation, symbol/reference/call graphs,
   and SCIP JSON interchange ship. A single-file intraprocedural CPG seed plus formatting-invariant
   node/edge delta, bounded impact, operator-specified taint witnesses, structured braced-if CFG,
   bounded may-reaching definitions, copies, and literal dead-branch pruning now also ship;
   direct rewrite apply, full rule configs, live LSP, semantic retrieval, general path-condition
   solving/full PDG, IR, behavioral fingerprints, semantic diff/merge, and e-graph evaluation remain incomplete and
   explicitly catalogued.
9. **Test-fixture crash reconciliation.** Repeated dogfood/full-suite runs leaked 14,070
   Baton-named temporary fixture directories and exhausted the host disk even though registered
   worker processes, worktrees, branches, and runtime scopes were clean. TF1–TF4 now gives the
   canonical `npm test` command one owned root and reaps it after pass, fail, `SIGINT`, `SIGTERM`,
   and descendant termination. Direct bare `node --test` still bypasses that owner, and an
   uncatchable wrapper `SIGKILL` still requires later supervisor-side stale-root reconciliation.

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
Those coordination/knowledge, Atlas index/symbol, and authenticated SSE milestones now ship. The
harness + exact-model + effort route specificity gate (issue #2) now also ships. EP1–EP9 closes
the quota/proxy/readiness/shutdown edge-policy increment locally; its final detached clean review
is pending a provider reset. The next active pursuit is real-browser OIDC/control proof,
WebSocket parity, MCP, and deeper operator surfaces, followed by the next measured
representation rungs. Isolated authenticated concurrent Grok exact-route/interrupt/resume/kill/reap
now passes with provider-observed identities and complete cleanup. Canonical test
fixture lifecycle is now owned and green; stale-root reconciliation after uncatchable wrapper
death remains explicit runtime depth.
