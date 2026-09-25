# Issue #164 — blind waits fail loud (terminal state + dead authority)

The implementation contract for issue #164: the wait/poll verbs (`run.wait`, `run_view`'s
continuation, `run.follow`, MCP `fleet_run_wait`, and the wait-capable `run.episode` /
`run.workstreams`) return empty or hang to timeout when the truth is already terminal or the
caller's authority is dead. Observed: a 25-iteration pump loop against an expired credential
(#148's instance), and `run.wait` on a terminal run waiting out the clock.
This contract is a **Ring-2 contract** (ground truths → decisions → refusal vocabulary → red-first
acceptance pins → open questions). It **specifies behavior**; it does not amend implementation in
this artifact. It cross-references — it does not re-specify — the landed lease-revalidation
discipline (the RA6/RA7 rows in the phase77 recursive-red suite), the #10 waiting-on vocabulary,
and the FP-05 unknown ≡ foreign law at the policy seam.

- **Date:** 2026-08-13
- **Version:** v2 — the v1 contract with the #164 red-team (`redteam-164.md`, same dir), the
  coordinator QA §4 (`docs/reference/evidence/review-foundry-2026-08-13/review-qa.md`), and the
  top-orchestrator decision DR-1 folded in. See the `## Fold record`.
- **Status:** DRAFT — implementation contract (red-first; no code landed for this rung). **Folded
  to v2** (2026-08-13): the red-team blockers, the QA §4.4 fold instruction set, and DR-1 are
  resolved in this text.
- **Verification HEAD:** `e371f70` ("Baton private effective-tree snapshot"), the tree the v2 fold
  was verified against. v1 was verified at `02e60a399cfcf4a08109087086b78d561f6e0c0e`; the delta
  `02e60a3..e371f70` touches only `impl/baton-0.1.0.tgz`, `workflow-interpreter.mjs`, and
  `workflow-as-data-red.test.mjs` — none of this contract's cited files moved. Every `file:line`
  citation below was re-verified this session (fold) with `grep -an`/`sed -n`/`Read` at `e371f70`,
  not inherited. The two NUL-bearing files whose anchors are grep/sed/Read-verified, never
  whole-file reads: `application.mjs` and `coordination-store.mjs`. `web-northbound.mjs`,
  `mcp-northbound.mjs`, `application-cli.mjs`, `application-semantics.mjs`, `coordinator.mjs`, and
  the phase16/phase77 test files were read directly (NUL-free).
- **Brief:** `contract-164-brief.md` (same dir) — read fully. The issue texts (`gh issue view 164`
  / `gh issue view 148`) could not be fetched (`gh` is not authenticated in this worktree); the
  requirements are carried by the brief, the friction ledger, and the read-order below.
- **Read-order executed.** (1) this brief; (2) the friction ledger Appendix D (2026-08-13 rows),
  row 2 = the #148 credential instance and its driver law; (3) the RA6/RA7 lease-revalidation
  rows in `phase77-recursive-application-red.test.mjs:394-467`; (4) the wait/poll verbs' current
  seams — `run.wait` (`application.mjs:7979-8022`), `run.inspect`'s continuation
  (`application.mjs:10926-11040`), `run.follow` (`application.mjs:8315-8375`), MCP
  `fleet_run_wait`/`fleet_run_follow` (`mcp-northbound.mjs:1505-1520`), web `run_wait`/`run_follow`
  (`web-northbound.mjs:684-689`); (5) the terminal vocabulary — the phase sets
  (`application.mjs:156-161`), the canonical predicates (`application-semantics.mjs:94-116`), and
  the waitingOn spine (#10, `application.mjs:406-498`); (6) the FP-05 unknown ≡ foreign law
  (`facade-projection-contract.md:1227`).
- **Scope of the rung, in one sentence:** every wait/poll verb re-checks terminality on the
  wait-local truth and authority on the seams that deliver each authority class — a terminal run
  returns the terminal view with the cause immediately, a dead application-layer authority
  (recursive lease, deployment policy) refuses the typed code naming the renewal path on the
  cycle that observes it, a dead transport principal refuses the typed code naming the renewal
  path at the surface's post-wait/post-dispatch seam, and no wait ever returns empty or burns the
  full clock on a truth that was already decided.

---

## Ground truths (verified this session)

- **G1 — the observed instances are real and receipted.** The friction ledger Appendix D, row 2
  (`orchestrator-friction-ledger.md:118`): "The resident's local token returned `unauthenticated`
  on byte-identical envelopes ~24h after incarnation publish, mid-pump — no expiry surface, no
  renewal verb, no named fence. The pump loop ran 25 blind iterations because it never printed
  non-ok responses." Filed **#148** (resident credential lifetime + programmatic renewal); the
  DRIVER LAW it produced: "any loop over the bus must log the full non-ok envelope and stop on
  repeated auth failure — never retry-blind." The brief's second observed instance — `run.wait` on
  a terminal run waiting out the clock — is the literal-set gap in G3.
- **G2 — `run.wait`'s loop re-checks terminality AND the application authority legs every cycle
  via `status()`, but the sleep is a blind wall-clock sleep, not `waitAfter`.** `application.mjs:7979-8022`: after the
  head `status()`, the `until === 'terminal'` branch loops
  `while (!APPLICATION_RUN_TERMINAL_PHASES.has(view.phase) && Date.now() < deadline)` and the
  default (settle-block) branch loops
  `while (!PROVIDER_EXECUTION_SETTLED_PHASES.has(view.phase) && Date.now() < deadline)`, each
  iteration sleeping `this.driver.coordinator.wait(min(100, …))` and re-reading
  `view = await this.status(runId, observer, {}, context)`. `status()` itself re-runs
  `_findRun` → `_authorizeRecursiveCommand` → `_authorize` (`application.mjs:4795-4804`), so a
  cycle re-checks the **recursive-lease + deployment-policy** legs (`_authorizeRecursiveCommand` /
  `_authorize` — the application layer has no transport principal; that check lives at the
  surface's post-wait seam, G7/G8); but the sleep is `coordinator.wait()` (`coordinator.mjs:12054`), a
  blind digest sleep with **no abort on authority revocation and no wake on change** — unlike the
  change-aware, abortable `waitAfter` (`coordination-store.mjs:8880-8918`). Because run.wait uses
  the blind sleep, the RA6/RA7 fixture that patches `waitAfter` (phase77:370-392) never fires for
  it, and its loop's exit iteration is always a fresh `status()` (there is no return-seam gap of
  the RA6/RA7 kind inside `run.wait` — H-4 folded).
- **G3 — the terminal-truth gap: the literal phase sets miss the admitted-but-uncompleted stop.**
  The runStop lifecycle separates admission from completion: admission
  (`coordination-store.mjs:8651`) mints the runStop with `status: 'stopping'` and **no receipt**
  (receipt null); completion (`coordination-store.mjs:8727`) flips it to `status: 'stopped'`,
  atomically attaching the receipt. The phase logic (`application.mjs:7598-7600`) reads
  `if (runStop?.status === 'stopped') phase = 'stopped'; else if (runStop) phase = 'stopping';` —
  so a run whose **receipt is durable** reads `'stopped'`, which IS in
  `APPLICATION_RUN_TERMINAL_PHASES` (`application.mjs:160` = {completed, failed, cancelled,
  denied, stopped}), while a run whose stop was **admitted but whose completion ceremony has not
  minted** reads **`stopping`**, which is in NEITHER `APPLICATION_RUN_TERMINAL_PHASES`
  (`application.mjs:160`) NOR `PROVIDER_EXECUTION_SETTLED_PHASES` (`application.mjs:157`). The
  admitted stop is durable and irreversible (new effects refuse `run_stopping`,
  `coordination-store.mjs:2842`/`:4420`/`:4453`), the run's authority is closed, and its terminal
  cause is already projected (`projectTypedTerminalCause`, `application.mjs:7648`) — yet
  `run.wait` keeps its loop for the full deadline while the completion ceremony is slow or hung.
  This is the brief's "run.wait on a terminal run waiting out the clock." The same enumeration
  shows `interruption_uncertain`, `paused`, and `reviewing` are also outside both sets (the honest
  stall/uncertain states — #10's `provider_stalled` and the #50 lane).
- **G4 — the RA6/RA7 lease-revalidation discipline is LANDED and is this contract's template.**
  `phase77-recursive-application-red.test.mjs:394-467`: RA6 (`run.inspect` revalidates the
  recipient lease after wait and before projection; asserts `projectedAfterWait === false` and the
  refusal code `run_orchestrator_lease_expired`/`run_orchestrator_lease_revoked`) and RA7
  (`run.follow` revalidates after wait immediately before return). The fixture
  `invalidateRecipientWhenWaitWakes` (phase77:370-392) patches `coordination.waitAfter` so the
  invalidation lands exactly inside the durable wait boundary. The law: **after a durable wait and
  before any projection/return, revalidate the recipient's authority; if it changed, refuse with
  the typed code — never project stale content.**
- **G5 — `run.inspect`'s continuation already executes the discipline (pin, don't move).**
  `application.mjs:10926-11040`: after the change-aware `waitAfter` wake it re-runs
  `_authorizeRecursiveCommand('run.status', …)` (`:11011`), rebuilds the view, re-runs
  `_authorize('run.status', …)` (`:11015`), and before the envelope again re-runs
  `_authorizeRecursiveCommand` (`:11030`). RA6 pins it. The semantic envelope marks terminal truth
  (`_semanticEnvelope`, `application.mjs:10051-10073`: `terminal: APPLICATION_RUN_TERMINAL_PHASES
  .has(view.phase)`, no continuation on terminal).
- **G6 — `run.follow` already executes the discipline (pin, don't move).**
  `application.mjs:8362-8363`: on the return seam, before projecting the follow page,
  `this._authorizeRecursiveCommand('run.status', …)` then `await this._authorize('run.follow', …)`.
  RA7 pins it.
- **G7 — the MCP wait verbs re-check the transport principal authority AFTER dispatch — once,
  post-wait, never per-cycle — and the refusal shape does not name the renewal path.**
  `mcp-northbound.mjs:1505-1520`: after `_dispatch` returns,
  `const refused = ['fleet_run_follow', 'fleet_run_wait'].includes(name)
  ? this._authority(name, args) : null; if (refused) return toolError(refused);`. `_authority`
  (`mcp-northbound.mjs:1325-1335`) returns `'unauthenticated'` (expired/revoked/unknown principal
  or inactive session) or `'forbidden'` (capability or repo scope). `toolError` (`:198-200`) emits
  `{ ok: false, error: { code } }` — code only, no renewal path, no refresh verb. The MCP
  `fleet_run_wait` tool (`:389`) and the `fleet_run_follow` tool (`:386`) are the two
  post-dispatch-rechecked names; the wait-capable `fleet_run_episode`/`fleet_run_workstreams`
  (`:394`/`:395`) are NOT rechecked today — the fold closes that gap (D2, A2). `fleet_run_wait`'s
  schema carries no `until` field — it always dispatches the default settle-block.
- **G8 — the web wait verbs already re-authenticate + re-authorize after wait, but the refusal
  shape does not name the renewal path.** `web-northbound.mjs:684-689`
  (`_postWaitAuthorization`): for `run.follow`/`run.wait` it returns
  `this._authenticate(ctx) ?? this._authorize(ctx, envelope)`, applied at the three dispatch
  seams (`:746`, `:895`, `:971`). `_authenticate` (`:629-647`) returns
  `error(401, 'unauthenticated')` on expired/revoked/malformed principal; `_authorize`
  (`:674-683`) returns `error(403, 'forbidden')`. The renewal path exists — `AUTH_PATHS`
  (`web-northbound.mjs:166` = {`/v1/auth/login`, `/v1/auth/refresh`, `/v1/auth/logout`}) — but
  neither refusal names it. The web `run_wait` ceiling is 30 s (`application_wait_timeout_exceeds_
  web_ceiling`, `web-northbound.mjs:417`).
- **G9 — the terminal vocabulary is closed and rides the canonical predicates.** The literal sets
  at `application.mjs:156-161` (`PROVIDER_EXECUTION_SETTLED_PHASES`, `APPLICATION_RUN_TERMINAL_
  PHASES`) are the still-legacy machine literals. The canonical predicates
  `providerSettled`/`applicationTerminal` (`application-semantics.mjs:94-116`) own the canonical
  vocabulary and canonicalize legacy inputs. The waitingOn spine (#10) is the closed
  `WAITING_ON_KINDS` = {capacity_ceiling, dispatch_pending, plan_approval, provider_stalled,
  spawning} (`application-semantics.mjs:60-62`); `projectWaitingOn` (`application.mjs:406-498`)
  returns **null** for a terminal run, and the terminal view carries `waitingOn: null` + the typed
  `terminalCause` (`application.mjs:7649`, `:7963`). The fail-loud law must ride these predicates,
  not re-invent vocabulary.
- **G10 — unknown run ≡ foreign stays byte-identical (the FP-05 law), and unknown runs already
  fail without burning a clock.** `_findRun` throws `application_run_not_found`
  (`application.mjs:3486`) for a never-existing run; `status()` resolves `_findRun` **before**
  `_authorize` (`application.mjs:4799-4803`), so an unknown run id refuses with
  `application_run_not_found` — byte-identical regardless of the caller's authority state, and no
  wait is entered. FP-05 (`facade-projection-contract.md:1227`): "Unknown messageId ≡ foreign
  messageId ≡ application_unauthorized (resolve-then-authorize)" — the resolve-then-authorize
  ordering is the law and must not move.

---

## D1 — the fail-loud law

Every wait/poll verb re-checks **terminality** on the wait-local truth and **authority** on the
seams that actually deliver each authority class. The application-layer loop delivers the
recursive-lease + deployment-policy legs per cycle; the transport-principal leg is delivered at
the surface's post-wait/post-dispatch seams. This contract does **not** claim a mid-wait
transport recheck that no cited code performs (red-team blocker 1 folded) — each leg's honesty is
scoped to the seam that delivers it:

1. **Terminal run → the terminal view with the cause, immediately.** The moment the run's truth is
   terminal (a phase in `APPLICATION_RUN_TERMINAL_PHASES`, or the wait-local durable-stop signal —
   a run whose stop was admitted, see D3.1), the verb returns the terminal view carrying `phase`,
   `terminalCause`, and `waitingOn: null` (G9) on that cycle. It never keeps sleeping to the
   caller's deadline, never returns an empty digest, never projects a pre-terminal view after the
   truth changed. The durable-stop signal rides a **wait-local terminal-truth helper** (DR-1,
   OQ2): it does not amend `applicationTerminal` or the closed vocabulary.
2. **Dead authority → the typed refusal naming the renewal path.** Authority failure splits into
   two honest classes: (a) the **per-cycle application legs** — the recursive orchestrator lease
   (`run_orchestrator_lease_expired`/`run_orchestrator_lease_revoked`,
   `coordination-store.mjs:1835`/`:1834`) and the deployment policy (`application_unauthorized`,
   `application.mjs:3222`) — which the `status()` loop re-checks every cycle (G2) and which refuse
   the typed code AND name the renewal path on the cycle that observes them (re-authorize the
   recursive lease; renew the deployment-policy credential/seat, and refresh the web session via
   `/v1/auth/refresh` when the principal's session is dead); and (b) the **transport-principal
   leg** (`unauthenticated`/`forbidden`, `mcp-northbound.mjs:1325-1335`,
   `web-northbound.mjs:629-683`) — a post-wait/post-dispatch surface check (MCP
   `mcp-northbound.mjs:1510`; web `web-northbound.mjs:684-689`) that refuses with the typed code
   AND names the renewal path (MCP re-authentication; the web `/v1/auth/refresh` lane, G8). The
   refusal is never `ok:true` with an empty body, and never a generic error that hides which
   authority died.
3. **Never silence, never the full clock — for the legs that can observe mid-wait.** A cycle that
   finds neither a terminal truth nor a dead application-layer authority (lease/policy) may
   continue to wait, but it must re-check on every cycle — and the check is against the canonical
   predicates / durable truth, not a stale snapshot captured before the sleep. The transport-
   principal leg is post-wait/post-dispatch by construction (the application wait loop has no
   transport principal, G2): a transport-principal expiry mid-wait burns the wait clock it was
   owed and refuses at the seam — the honest scope of the surface checks, not a per-cycle claim
   (D3.2). A pump loop over the bus follows the #148 driver law (G1): log the full non-ok envelope
   and stop on repeated auth failure, never retry-blind.

The RA6/RA7 shape is the enforcement template (G4): revalidate **after** the durable wait and
**before** projection/return. `run.wait`'s loop always ends with a fresh `status()` — its exit
iteration's view IS the revalidated product, so there is no post-wait-before-projection gap of
the RA6/RA7 kind inside `run.wait` (H-4 folded: no redundant return-seam revalidation is added);
the D2 seam map pins where each verb gains or already has its check.

---

## D2 — the per-verb seam map

Each row names the verb, its current seam (verified), and exactly where the fail-loud check is
added or already lives. **Scope:** this map is exhaustive over the wait/poll verbs — it includes
`run.episode` and `run.workstreams` (wait-capable on every surface, red-team blocker 3) and names
`run_watch`'s resolution (H-3).

| Verb | Current seam (verified) | Fail-loud revalidation point |
|---|---|---|
| **`run.wait`** (application command) | `application.mjs:7979-8022`; per-cycle `status()` + blind `coordinator.wait()` (G2); terminal check against the literal `APPLICATION_RUN_TERMINAL_PHASES` (terminal loop, `:7997`) and `PROVIDER_EXECUTION_SETTLED_PHASES` (settle-block loop, `:8003`) sets | **The gap verb.** (a) Ride the canonical predicates (G9) **and the wait-local durable-stop terminal-truth helper (D3.1, DR-1) on BOTH loops** — the `until === 'terminal'` loop AND the default settle-block loop — so an admitted-but-uncompleted stop (`stopping`) is recognized as terminal-truth for wait purposes in either mode (QA H1). The helper is #164-owned; it does not amend the literal sets or `applicationTerminal`. (c) adopt the change-aware `waitAfter` (or an abortable sleep) so a mid-wait terminalization or application-layer revocation is observed on the change, not only at the next 100 ms wall-clock tick (OQ1). *(The v1 draft's (b) — a distinct return-seam revalidation — is folded out as redundant and layer-confused (H-4): the loop's exit iteration is always a fresh `status()` revalidation, and the transport-principal check belongs to the surface rows, not the application layer.)* |
| **`run.episode` / `run.workstreams`** | wait-capable on every surface (`application.mjs:178-179`, `waitMs` in args; MCP `fleet_run_episode`/`fleet_run_workstreams`, `mcp-northbound.mjs:394-395`); route through `run.inspect`'s continuation machinery (change-aware wait path, `application.mjs:11273+`) which already revalidates after the wait and before projection | **PIN, don't move.** They already execute the RA6 shape inside the inspect continuation — the D3.1 wait-local durable-stop predicate and the renewal-path naming apply on the same seams. **Add both verbs to the MCP post-dispatch transport recheck list** (`mcp-northbound.mjs:1510` today covers only `fleet_run_follow`/`fleet_run_wait`) so a mid-wait MCP session expiry on these two is also caught post-dispatch (red-team blocker 3). |
| **`run_view`'s continuation** (`run.inspect` with cursor) | `application.mjs:10926-11040`; already change-aware (`waitAfter`), already revalidates at `:11011`/`:11015` after the wait and at `:11030` before the envelope (G5) | **PIN, don't move.** RA6 pins the refusal code (`run_orchestrator_lease_expired`/`run_orchestrator_lease_revoked`, `coordination-store.mjs:1835`/`:1834`) and `projectedAfterWait === false`. The D3.1 wait-local durable-stop predicate and the renewal-path naming in the refusal (OQ3) apply on the same seams. |
| **`run.follow`** | `application.mjs:8362-8363`; return-seam revalidation already present (G6) | **PIN, don't move.** RA7 pins the after-wait-before-return revalidation. The D3.1 `stopping` terminal-truth and the refusal's renewal path (OQ3) apply on the same seams. |
| **Web `run_watch`** | resolves to `run.follow`; inherits its seams | **PIN, don't move — named for exhaustiveness (H-3).** `run_watch` has no seam of its own; the `run.follow` row governs it. |
| **MCP `fleet_run_wait` / `fleet_run_follow`** | `mcp-northbound.mjs:1505-1520`; post-dispatch `_authority` recheck already present (G7) — **post-wait once, never per-cycle** | **Keep the post-dispatch recheck; extend it to `fleet_run_episode`/`fleet_run_workstreams`; add the renewal path to the refusal.** `toolError(refused)` (`:198-200`) must carry the named renewal lane (re-authenticate / refresh) instead of code-only `unauthenticated`/`forbidden`. `fleet_run_wait` gains no `until` field in this rung unless OQ5 resolves otherwise — it keeps the settle-block, but the settle-block's wait-local terminal-truth predicate follows D1/D3.1 (QA H1). |
| **Web `run_wait` / `run_follow`** | `web-northbound.mjs:684-689` (`_postWaitAuthorization`), applied at `:746`/`:895`/`:971`; `_authenticate` + `_authorize` after wait (G8) — **post-wait once, never per-cycle** | **Keep the post-wait reauth; name the renewal path.** The `401 unauthenticated` / `403 forbidden` bodies must name `/v1/auth/refresh` (the AUTH_PATHS lane, G8) so a caller whose session died mid-wait knows the exact renewal verb instead of re-probing blind. |
| **CLI `run view --until settled\|terminal` / `run status --wait`** | `application-cli.mjs:1646-1656` (`run view --until` → `run.wait` with `until`); `application-cli.mjs:1712` (`run status --wait` → `run.wait`); server-side wait budget `_requestTimeoutForCommand` (`application-cli.mjs:2028-2035` sets `serverWaitMs` for `run.follow`/`run.wait`) | **No new seam of its own — it delegates to `run.wait`/`run.follow`.** The CLI inherits D1/D3.1 from the verbs it dispatches and the per-cycle application legs (lease + policy + terminal truth); there is no transport-principal leg at the CLI surface (local, no session fence — the #148 instance class, G1). The only CLI-facing obligation is to print the full non-ok envelope on a typed refusal (the #148 driver law, G1) rather than retry-blind. |
| **Driver pump loops** (the #148 instance's loop) | `orchestrator-friction-ledger.md:118` — the 25-iteration blind loop that never printed non-ok responses | **The #148 driver law, landed as client discipline:** log the full non-ok envelope; stop on repeated auth failure; never retry-blind. This is the caller side of D1.3. The server side (typed refusal + renewal path, A2/A3) is what makes the stop actionable (A4's #164 server counterpart). |

---

## D3 — the honesty edge cases

- **D3.1 — a run that terminalizes (or whose stop is admitted) MID-wait.** The wait returns the
  terminal truth on the cycle that observes it, not the timeout it was owed. Concretely: (a) a run
  whose phase enters `APPLICATION_RUN_TERMINAL_PHASES` mid-wait must return the terminal view with
  `terminalCause` immediately; (b) a run whose **stop was admitted** (runStop present, status
  `'stopping'`, no receipt, `coordination-store.mjs:8651`) but whose completion ceremony has not
  minted the receipt reads `stopping` (G3) — the stop is durable and irreversible (new effects
  refuse `run_stopping`, `coordination-store.mjs:2842`/`:4420`/`:4453`), the authority is closed,
  and the terminal cause is already projected (`projectTypedTerminalCause`, `application.mjs:7648`)
  — and must return that terminal view immediately rather than burn the clock waiting for the
  ceremony. This recognition is the **wait-local durable-stop terminal-truth helper**, and **both**
  of `run.wait`'s loops consult it: the `until === 'terminal'` loop AND the default settle-block
  loop (QA H1). The contract does NOT amend the phase vocabulary (additive-only law, below; DR-1):
  the helper is #164-owned, it treats an admitted stop as terminal-truth **for wait purposes only**,
  `applicationTerminal` is not touched, and `stopping` stays non-terminal in the closed vocabulary.
  The helper's breadth is pinned: **any admitted stop returns immediately, even while the
  completion ceremony is legitimately in progress** — that is the semantic meaning `until:
  'terminal'` and the settle block carry for a stopping run.
- **D3.2 — an authority that expires mid-wait.** The per-cycle `status()` re-check delivers the
  recursive-lease + deployment-policy legs on every cycle (G2); a flip in either refuses the typed
  code **naming the renewal path** (D1.2) on the cycle that observes it. The transport-principal
  leg is checked at the surface's post-wait/post-dispatch seams (MCP `mcp-northbound.mjs:1510`;
  web `web-northbound.mjs:684-689` at `:746`/`:895`/`:971`) — a mid-wait transport-principal expiry
  burns the wait clock it was owed and refuses at the seam with the renewal path (D1.2); this
  contract does **not** claim a mid-wait transport recheck that no cited code performs (red-team
  blocker 1 folded). The RA6/RA7 `invalidateRecipientWhenWaitWakes` scenario (phase77:370-392) is
  the recursive-lease leg applied to the wait verbs. The mid-wait revocation must produce the same
  refusal whether the run terminalized at the same instant or not: **a dead authority refuses even
  when the run truth is terminal** (the two checks are independent, D1).
- **D3.3 — a run id that never existed.** Unknown run ≡ foreign run stays byte-identical — the
  FP-05 law (G10). The wait/poll verbs already resolve `_findRun` before authorizing
  (`application.mjs:4799-4803`), so a never-existing run refuses with `application_run_not_found`
  on the first cycle, no clock burned, byte-identical for every caller authority state. This must
  not move; the fail-loud law is additive on top of it. An unknown run is never conflated with a
  dead authority (`application_unauthorized`) — resolve-then-authorize ordering preserves the
  distinction.

---

## Refusal vocabulary

Typed codes the wait/poll verbs may emit at the fail-loud seams, with the renewal path each must
name (D1.2). Codes marked (existing) are already emitted by the kernel/transports today; the
contract changes which seams surface them and what the refusal body names. **Surface mapping
(H-7):** the kernel codes below are emitted verbatim at the application/CLI surface; at the MCP
surface the kernel code is projected through `stateFailureCode` (`mcp-northbound.mjs:201-204`) —
`application_unauthorized` → `'forbidden'` and `application_run_not_found` → `'not_found'` — so a
pin against an MCP refusal asserts the MCP code, and a pin against the application layer asserts
the kernel code (A5). The web surface emits HTTP `401 unauthenticated` / `403 forbidden` bodies.

| Code | Authority that died | Renewal path the refusal must name | Status |
|---|---|---|---|
| `application_run_not_found` | none — the run never existed (G10) | none — byte-identical, FP-05 (no renewal; the caller misspelled or lost the run) | (existing) `application.mjs:3486`; MCP surface emits `'not_found'` (`stateFailureCode`, `mcp-northbound.mjs:203`) — pin, don't move |
| `run_orchestrator_lease_expired` | the recursive orchestrator lease (RA6/RA7) | re-authorize a fresh recursive lease for the run (the coordinator-seat authority boundary) | (existing) `coordination-store.mjs:1835` — surfaces change; renewal naming added |
| `run_orchestrator_lease_revoked` | the recursive orchestrator lease, explicitly revoked | same — re-authorize the lease (revocation is durable until a new lease mints) | (existing) `coordination-store.mjs:1834` — same |
| `application_unauthorized` | the deployment policy authorize (`_authorize`) | renew the deployment-policy credential/seat; if the principal's session is dead, refresh the session (web `/v1/auth/refresh`) | (existing) `application.mjs:3222`; MCP surface emits `'forbidden'` (`stateFailureCode`, `mcp-northbound.mjs:202`) — refusal naming added |
| `unauthenticated` | the transport principal (MCP `_authority` / web `_authenticate`) | MCP: re-authenticate the MCP session; web: `/v1/auth/refresh` (G8 AUTH_PATHS) | (existing) `mcp-northbound.mjs:1325-1335` (`_authority`), `web-northbound.mjs:629-647` (`_authenticate`) — renewal naming added |
| `forbidden` | the principal's capability/repo scope (MCP `_authority` / web `_authorize`) | not a lifetime renewal — re-request with the required capability/repo scope, or ask an authority that holds it | (existing) `mcp-northbound.mjs:1325-1335` (`_authority`), `web-northbound.mjs:665-683` (`_authorize`) — renewal naming added |
| `invalid_run_wait` | the wait request itself (timeout past the deployment ceiling) | none — resubmit with `timeoutMs` within the ceiling | (existing) `mcp-northbound.mjs:954-955` — pin |
| `application_wait_timeout_exceeds_web_ceiling` | the web wait request (timeout past 30 s) | none — resubmit within 30 s | (existing) `web-northbound.mjs:417` — pin |
| `application_wait_invalid` | the application-layer wait request (timeout past the 24 h application ceiling, or an invalid wait request, `application.mjs:7989`) | none — resubmit with `timeoutMs` within the ceiling | (existing) `application.mjs:7989` — pin; the CLI surface surfaces it verbatim (H-6) |

---

## Red-first acceptance pins

**RED at HEAD (current behavior — these must flip with the landing):**

- **A1 (RED) — `run.wait` on an admitted-but-uncompleted stop burns the full clock, in BOTH
  loops.** A run whose stop was **admitted** (runStop present, status `'stopping'`, no receipt,
  `coordination-store.mjs:8651`) and whose completion ceremony does not mint the receipt within
  the wait budget: `run.wait` with `until: 'terminal'` **or the default settle-block** loops to
  the deadline and returns the deadline view instead of the terminal view with the stop cause (G3,
  QA H1). The fixture `invalidateRecipientWhenWaitWakes` (phase77:370-392) does not fire because
  run.wait sleeps on the blind `coordinator.wait()` (G2), and neither literal set contains
  `stopping` (G3). **The pin's green mechanism is the wait-local durable-stop terminal-truth
  helper (D3.1, DR-1) — a one-line edit admitting `stopping` to
  `APPLICATION_RUN_TERMINAL_PHASES` must NOT pass it (A9).**
- **A2 (RED) — MCP `fleet_run_wait`/`fleet_run_follow` (and, after this rung,
  `fleet_run_episode`/`fleet_run_workstreams`) refuse with code-only bodies after a mid-wait
  revocation.** When `isPrincipalActive` flips to false during the wait, the post-dispatch
  `_authority` recheck (`mcp-northbound.mjs:1510`) returns `toolError('unauthenticated')` (`:198`)
  with no renewal path — the caller cannot learn the renewal verb from the refusal (G7). (The CE5/MN
  post-wait revocation pin at `phase16-mcp-northbound.test.mjs:239-253` asserts the `unauthenticated`
  code; the contract ADDs the renewal naming on top, it does not remove the code.) **Scope honesty:**
  this pin asserts the refusal *shape* (code + renewal path) at the post-dispatch seam; it does not
  assert promptness — the transport-principal leg is post-wait and burns the wait clock it was owed
  (D1/D3.2).
- **A3 (RED) — web `run_wait`/`run_follow` refuse with `401 unauthenticated` naming no renewal
  path.** `_postWaitAuthorization` (`web-northbound.mjs:684-689`) returns the bare
  `error(401, 'unauthenticated')` after a mid-wait session expiry, even though `/v1/auth/refresh`
  is in `AUTH_PATHS` (`:166`) — the refusal does not point at the renewal lane (G8). **Same scope
  honesty as A2:** the pin asserts the post-wait refusal shape, not promptness (D1/D3.2).
- **A4 (RED) — a driver pump loop stops on the typed refusal the wait verbs emit.** The #148
  instance's loop ran 25 blind iterations because it never printed the non-ok envelope (G1). The
  acceptance is the driver law **over the #164 server mechanism**: a loop over the bus that
  receives the typed auth refusal from the wait verbs' post-wait/post-dispatch recheck (A2/A3
  shape — code + renewal path) logs the full envelope and stops on repeated auth failure. The pure
  client discipline is #148's ledger law (G1); the #164 obligation is the refusal shape that makes
  the stop actionable (the A2/A3 server side this pin gates end-to-end).

**GREEN / must-not-move at HEAD (these are the invariants the fail-loud landing rides, not
breaks):**

- **A5 (GREEN) — unknown run ids refuse `application_run_not_found` byte-identical, no clock.**
  `_findRun` before authorize (G10) — FP-05 preserved for every wait verb; unknown ≡ foreign. At
  the application/CLI surface the emitted code is `application_run_not_found`; at the MCP surface
  it is `'not_found'` (`stateFailureCode`, `mcp-northbound.mjs:203`) — the pin asserts the kernel
  code at the application layer and `'not_found'` at the MCP surface (H-7).
- **A6 (GREEN) — `run.inspect`'s continuation refuses after mid-wait lease invalidation, never
  projects.** RA6 (phase77:394-432): `projectedAfterWait === false`, refusal code
  `run_orchestrator_lease_expired`/`run_orchestrator_lease_revoked` (`coordination-store.mjs:1835`/
  `:1834`). Pin.
- **A7 (GREEN) — `run.follow` revalidates after wait immediately before return.** RA7
  (phase77:436-467). Pin.
- **A8 (GREEN) — terminal views carry `waitingOn: null` + `terminalCause`; the canonical
  predicates own the vocabulary.** G9 — the terminal truth the waits return rides the existing
  closed vocabulary; nothing is re-invented.
- **A9 (GREEN) — the terminal/settled literal sets, `WAITING_ON_KINDS`, and `applicationTerminal`
  are unchanged.** Additive-only law (below) + DR-1 — the contract adds a wait-local terminal-truth
  helper for the admitted stop; it does not edit the phase or waitingOn vocabulary, and `stopping`
  stays non-terminal in the closed vocabulary.
- **A10 (GREEN) — the MCP `invalid_run_wait`, web `application_wait_timeout_exceeds_web_ceiling`,
  and application `application_wait_invalid` ceilings stay.** `mcp-northbound.mjs:954-955`,
  `web-northbound.mjs:417`, `application.mjs:7989` — request-shape refusals, unchanged.

---

## Open questions

- **OQ1 — does `run.wait` adopt the change-aware `waitAfter` for its loop, or an abortable sleep?**
  The RA6/RA7 fixture patches `waitAfter` (phase77:370-392); G2 shows run.wait never enters that
  path today. If run.wait adopts `waitAfter` with the run's cursor as `afterSeq`, a mid-wait
  terminalization or application-layer revocation wakes it on the change (bounded, honest) rather
  than at the next 100 ms tick. The alternative is keeping the poll loop but making each cycle's
  re-check authoritative. The contract's D1 only demands per-cycle re-check; OQ1 is the mechanism.
  Note: `waitAfter` wakes on store events, not on transport-principal expiry (the store does not
  know the surface session) — OQ1 does not close the transport-principal leg (D3.2).
- **OQ2 — how does the wait-local terminal-truth predicate recognize an admitted stop?**
  **RESOLVED by DR-1 (top orchestrator, 2026-08-13): option (a) — a wait-local terminal-truth
  helper only.** `applicationTerminal` is NOT amended (the #10/#74 closed vocabulary stays closed);
  the durable-stop signal rides the wait-local helper; `stopping` stays non-terminal. Rejected:
  (b) admitting `stopping` to the terminal predicate via `canonicalRunPhase`/`applicationTerminal`
  (a closed-vocabulary amendment requiring #10/#74 sign-off); (c) surfacing the durable stop via
  the waitingOn spine (a stopping run is not *waiting*; the spine is the wrong surface). The
  helper treats an admitted stop (`runStop` present, status `'stopping'`, no receipt) as
  terminal-truth for wait purposes, on both `run.wait` loops (QA H1), and its breadth is pinned in
  D3.1.
- **OQ3 — what shape does "naming the renewal path" take in each refusal body?** For the web, the
  renewal lane is `AUTH_PATHS` (`/v1/auth/refresh`, G8) — a `renewal: { path: '/v1/auth/refresh',
  method: 'POST' }` field on the error body is a candidate. For MCP, re-authentication is the lane.
  For the recursive lease, the lane is the coordinator-seat re-authorization. For the #148 resident,
  the renewal verb is a #148 deliverable (G1) — the #164 refusals must be able to name it when it
  exists without breaking on its absence (a stable `renewal` shape that may carry a `path` or
  `verb` or `seat` depending on which authority died). The shape must also carry the MCP surface
  codes (H-7).
- **OQ4 — does the driver pump-loop law (A4) get a shared client helper, or stay per-driver
  discipline?** The #148 driver law is stated in the ledger (G1). A shared "poll with fail-loud
  envelope logging and stop-on-repeated-auth-failure" helper would make it structural; the contract
  only requires the behavior (log the full non-ok envelope, stop on repeated auth failure), leaving
  the helper to a later rung. A4's #164 scope is the server-side refusal shape it gates (see A4).
- **OQ5 — does MCP `fleet_run_wait` gain an `until` field?** Today it carries no `until` (G7), so
  it always dispatches the default settle-block. The brief lists `fleet_run_wait` as a wait verb but
  does not ask for a terminal selector; OQ5 is whether this rung adds `until: 'terminal'` to the
  MCP schema or leaves the MCP surface settle-block-only (the fail-loud law applies either way;
  the settle-block's wait-local terminal-truth predicate lands regardless, QA H1).

---

## Cross-references

- The landed read/write contract's ring-2 form and deliverable boundary:
  `docs/reference/evidence/scratchpad-write-2026-08-13/scratchpad-write-contract.md`.
- The #10 waiting-on vocabulary (five closed kinds, `waitingOn: null` on terminal, honest-null law):
  `docs/reference/evidence/waiting-vocabulary-2026-08-06/waiting-vocabulary-contract.md`.
- The FP-05 unknown ≡ foreign law at the policy seam:
  `docs/reference/evidence/facade-projection-2026-08-03/facade-projection-contract.md:1227`.
- The #148 credential instance and its driver law:
  `docs/reference/evidence/frontier-sweep-2026-08-03/orchestrator-friction-ledger.md:118`.
- The RA6/RA7 lease-revalidation pins:
  `impl/test/phase77-recursive-application-red.test.mjs:394-432` (RA6), `:436-467` (RA7),
  fixture `:370-392`.
- The MCP post-wait revocation pin:
  `impl/test/phase16-mcp-northbound.test.mjs:239-253`.
- The `waitAfter` change-aware wait: `impl/src/coordination-store.mjs:8880-8918`. The blind
  `coordinator.wait()`: `impl/src/coordinator.mjs:12054`. The recursive lease failures:
  `coordination-store.mjs:1834` (`run_orchestrator_lease_revoked`), `:1835`
  (`run_orchestrator_lease_expired`), `authorizeRunOrchestratorCommand` at `:2069`.
- The MCP surface code mapping (`stateFailureCode`): `impl/src/mcp-northbound.mjs:201-204`.
- The runStop admission/completion lifecycle: `impl/src/coordination-store.mjs:8651` (admission,
  no receipt) / `:8727` (completion, receipt attached).

---

## Campaign-law constraints

- **No clocks.** The fail-loud law is a per-cycle re-check, never a wall-clock decision: the verb
  returns terminal truth or a dead application-layer authority refusal on the cycle that observes
  it, and a wait that continues does so only because its per-cycle check found neither. The
  transport-principal leg is a post-wait/post-dispatch surface check (D1.2, D3.2) — its clock burn
  is the honest scope of the surface seams, not a new control. No new clock or deadline is
  introduced; the existing `Date.now()`/`deadline` shape in `run.wait` (`application.mjs:7997`,
  `:8003`) stays the wait budget, not the honesty mechanism.
- **Additive-only.** The literal phase sets, `WAITING_ON_KINDS`, `applicationTerminal`, and the
  refusal codes exist and stay; the contract adds (a) a wait-local terminal-truth helper for the
  admitted stop (D3.1, OQ2/DR-1), (b) renewal-path naming on the typed refusals (OQ3), and (c) the
  driver law (A4). Nothing existing is renamed or retired; the canonical predicates and the FP-05
  resolve-then-authorize ordering are pinned (A5, A8, A9).
- **Deliverable boundary.** This artifact is the deliverable for the rung:
  `docs/reference/evidence/blind-waits-2026-08-13/blind-waits-contract.md` (folded v2) and its
  fold map `fold-164.md` (same dir). No implementation file is amended here; the acceptance pins
  (A1-A10) are the landing criteria for the code rung that follows.

---

## Fold record (v2, 2026-08-13)

- **Red-team:** `docs/reference/evidence/blind-waits-2026-08-13/redteam-164.md` — verdict NOT
  FOLD-READY, five numbered blockers + four non-blocking items.
- **QA:** `docs/reference/evidence/review-foundry-2026-08-13/review-qa.md` §4 — verdict NEEDS-WORK;
  fold instruction set §4.4.
- **Top-orchestrator decisions applied:** **DR-1** (OQ2) — option (a): a wait-local terminal-truth
  helper only. `applicationTerminal` and the #10/#74 closed vocabulary are NOT amended; `stopping`
  stays non-terminal; the durable-stop signal rides the wait-local helper. Stated at the
  vocabulary boundary (D1.1, D3.1, OQ2, A9, campaign-law "Additive-only").
- **Blocker → resolution (each gets exactly one of FOLDED / STRUCK / ESCALATED):**
  - **B1 (D1.2/D3.2 over-claim the per-cycle transport-principal recheck; "never the full clock"
    not delivered for that leg) → FOLDED.** D1.2/D3.2 scoped: the per-cycle `status()` loop
    delivers the recursive-lease + deployment-policy legs; the transport-principal leg is a
    post-wait/post-dispatch surface check (MCP `mcp-northbound.mjs:1510`; web
    `web-northbound.mjs:684-689`) that burns the clock it was owed. Applied across the scope
    sentence, D1, D2 (MCP/web/CLI rows), D3.2, A2/A3 scope notes, campaign-law "No clocks".
  - **B2 (G3's mechanism wrong; A1 unbuildable as written) → FOLDED.** G3, D3.1, and A1 reworded
    to the runStop admission mechanism (`coordination-store.mjs:8651` admission with no receipt vs
    `:8727` completion attaching the receipt); A1 names the wait-local-helper green mechanism so a
    literal-set edit cannot pass it (A9).
  - **B3 (`run.episode`/`run.workstreams` omitted from the seam map AND the MCP recheck) →
    FOLDED.** D2 gains a row pinning the RA6 shape they already run; the MCP post-dispatch
    transport recheck list is extended to `fleet_run_episode`/`fleet_run_workstreams` (D2 MCP row,
    A2, G7).
  - **B4 (`application_wait_invalid` missing; MCP surface mapping unstated) → FOLDED.** Refusal
    table gains the `application_wait_invalid` row (`application.mjs:7989`) and a surface-mapping
    note (`stateFailureCode`, `mcp-northbound.mjs:201-204`); A5 states its surface.
  - **B5 (A4 shallow-greenable, #148 client acceptance) → FOLDED.** A4 restated over the #164
    server mechanism (the A2/A3 refusal shape it gates end-to-end); the pure client discipline
    remains #148's ledger law (G1).
  - **Non-blocking items → FOLDED.** H-4 (D2 `run.wait` (b) return-seam revalidation removed as
    redundant and layer-confused); H-3 (web `run_watch` row added for exhaustiveness); OQ2
    predicate breadth pinned (D3.1: any admitted stop returns immediately); citation nits
    corrected (lease codes `:1834`/`:1835`, MCP `_authority` span, web `_authorize` span, phase77
    RA6 span `:394-432`, RA7 span `:436-467`).
- **QA §4.4 instructions:**
  1. Fix H1 (durable-stop predicate on BOTH loops) → **FOLDED** — D2 `run.wait` row (a) + D3.1.
  2. Add `application_wait_invalid` (existing) to the refusal table (H2) → **FOLDED** — refusal
     vocabulary table.
  3. Keep the RA6/RA7 pins, the FP-05 unknown≡foreign pin (A5), and the additive-only law as
     written → **KEPT** (A6/A7, A5, campaign-law "Additive-only"; A5 gains its surface statement,
     A6/A7 their corrected spans — substance unchanged).
  4. Escalate OQ2 → **RESOLVED** by DR-1 (option (a)) — see above and OQ2.
- **Re-verification (this fold):** every anchor the fold touches was re-verified at the worktree
  HEAD `e371f70` with `grep -an`/`sed -n` (NUL discipline on `application.mjs` and
  `coordination-store.mjs`; direct reads of the NUL-free files). No wrong citation found.
