# Issue #164 — blind waits fail loud (terminal state + dead authority)

The implementation contract for issue #164: the wait/poll verbs (`run.wait`, `run_view`'s
continuation, `run.follow`, MCP `fleet_run_wait`) return empty or hang to timeout when the truth
is already terminal or the caller's authority is dead. Observed: a 25-iteration pump loop against
an expired credential (#148's instance), and `run.wait` on a terminal run waiting out the clock.
This contract is a **Ring-2 contract** (ground truths → decisions → refusal vocabulary → red-first
acceptance pins → open questions). It **specifies behavior**; it does not amend implementation in
this artifact. It cross-references — it does not re-specify — the landed lease-revalidation
discipline (the RA6/RA7 rows in the phase77 recursive-red suite), the #10 waiting-on vocabulary,
and the FP-05 unknown ≡ foreign law at the policy seam.

- **Date:** 2026-08-13
- **Status:** DRAFT — implementation contract (red-first; no code landed for this rung)
- **Verification HEAD:** `02e60a399cfcf4a08109087086b78d561f6e0c0e` ("Baton private effective-tree
  snapshot"), the tree this contract was verified against. Every `file:line` citation below was
  re-verified this session with `grep -an`/`sed -n`/`Read` at this HEAD, not inherited. The two
  NUL-bearing files whose anchors are grep/sed/Read-verified, never whole-file reads:
  `application.mjs` and `coordination-store.mjs`. `web-northbound.mjs`, `mcp-northbound.mjs`,
  `application-cli.mjs`, `application-semantics.mjs`, `coordinator.mjs`, and the phase16/phase77
  test files were read directly (NUL-free).
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
- **Scope of the rung, in one sentence:** every wait/poll verb re-checks authority AND terminality
  per cycle — a terminal run returns the terminal view with the cause immediately, a dead
  authority returns the typed refusal naming the renewal path, and no wait ever returns empty or
  burns the full clock on a truth that was already decided.

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
- **G2 — `run.wait`'s loop re-checks authority AND terminality every cycle via `status()`, but the
  sleep is a blind wall-clock sleep, not `waitAfter`.** `application.mjs:7979-8022`: after the
  head `status()`, the `until === 'terminal'` branch loops
  `while (!APPLICATION_RUN_TERMINAL_PHASES.has(view.phase) && Date.now() < deadline)` and the
  default (settle-block) branch loops
  `while (!PROVIDER_EXECUTION_SETTLED_PHASES.has(view.phase) && Date.now() < deadline)`, each
  iteration sleeping `this.driver.coordinator.wait(min(100, …))` and re-reading
  `view = await this.status(runId, observer, {}, context)`. `status()` itself re-runs
  `_findRun` → `_authorizeRecursiveCommand` → `_authorize` (`application.mjs:4795-4804`), so a
  cycle re-checks authority; but the sleep is `coordinator.wait()` (`coordinator.mjs:12054`), a
  blind digest sleep with **no abort on authority revocation and no wake on change** — unlike the
  change-aware, abortable `waitAfter` (`coordination-store.mjs:8880-8918`). Because run.wait uses
  the blind sleep, the RA6/RA7 fixture that patches `waitAfter` (phase77:370-392) never fires for
  it, and there is no return-seam revalidation distinct from the loop's own last `status()`.
- **G3 — the terminal-truth gap: the literal phase sets miss the durably-stopped run.** The view
  phase for a run whose stop receipt is durable but not yet reaped reads **`stopping`**
  (`application.mjs:7598`: `if (runStop?.status === 'stopped') phase = 'stopped'; else if (runStop)
  phase = 'stopping';`). `stopping` is in NEITHER `APPLICATION_RUN_TERMINAL_PHASES`
  (`application.mjs:160` = {completed, failed, cancelled, denied, stopped}) NOR
  `PROVIDER_EXECUTION_SETTLED_PHASES` (`application.mjs:157`). A durably-stopped run whose reap is
  slow or hung therefore keeps `run.wait` in its loop for the full deadline even though its stop
  was admitted, its authority is closed, and its terminal cause is already projected. This is the
  brief's "run.wait on a terminal run waiting out the clock." The same enumeration shows
  `interruption_uncertain`, `paused`, and `reviewing` are also outside both sets (the honest
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
- **G7 — the MCP wait verbs re-check the transport principal authority AFTER dispatch, but the
  refusal shape does not name the renewal path.** `mcp-northbound.mjs:1505-1520`: after
  `_dispatch`, `const refused = ['fleet_run_follow', 'fleet_run_wait'].includes(name)
  ? this._authority(name, args) : null; if (refused) return toolError(refused);`. `_authority`
  (`mcp-northbound.mjs:1325-1335`) returns `'unauthenticated'` (expired/revoked/unknown principal
  or inactive session) or `'forbidden'` (capability or repo scope). `toolError` (`:198-200`) emits
  `{ ok: false, error: { code } }` — code only, no renewal path, no refresh verb. The MCP
  `fleet_run_wait` tool (`:389`) and the `fleet_run_follow` tool (`:386`) are the two
  post-dispatch-rechecked names. `fleet_run_wait`'s schema carries no `until` field — it always
  dispatches the default settle-block.
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

Every wait/poll verb re-checks **authority** AND **terminality** per cycle:

1. **Terminal run → the terminal view with the cause, immediately.** The moment the run's truth is
   terminal (a phase in `APPLICATION_RUN_TERMINAL_PHASES`, or a durable stop receipt — see D3.1),
   the verb returns the terminal view carrying `phase`, `terminalCause`, and `waitingOn: null` (G9)
   on that cycle. It never keeps sleeping to the caller's deadline, never returns an empty digest,
   never projects a pre-terminal view after the truth changed.
2. **Dead authority → the typed refusal naming the renewal path.** The moment any authority check
   fails — the recursive orchestrator lease (`run_orchestrator_lease_expired`/`_revoked`,
   `coordination-store.mjs:1834-1835`), the deployment policy (`application_unauthorized`,
   `application.mjs:3222`), or the transport principal (`unauthenticated`/`forbidden`,
   `mcp-northbound.mjs:1325-1335`, `web-northbound.mjs:629-683`) — the verb refuses with the typed
   code AND names the renewal path (the web `/v1/auth/refresh` lane in G8; MCP re-authentication;
   the recursive lease re-authorization; the #148 resident renewal verb when it lands). The refusal
   is never `ok:true` with an empty body, and never a generic error that hides which authority died.
3. **Never silence, never the full clock.** A cycle that finds neither a terminal truth nor a dead
   authority may continue to wait, but it must re-check on every cycle — and the check is against
   the canonical predicates / durable truth, not a stale snapshot captured before the sleep.
   A pump loop over the bus follows the #148 driver law (G1): log the full non-ok envelope and stop
   on repeated auth failure, never retry-blind.

The RA6/RA7 shape is the enforcement template (G4): revalidate **after** the durable wait and
**before** projection/return. `run.wait` lacks a return-seam revalidation distinct from its loop's
last `status()` (G2); the D2 seam map pins exactly where each verb gains the check.

---

## D2 — the per-verb seam map

Each row names the verb, its current seam (verified), and exactly where the fail-loud check is
added or already lives.

| Verb | Current seam (verified) | Fail-loud revalidation point |
|---|---|---|
| **`run.wait`** (application command) | `application.mjs:7979-8022`; per-cycle `status()` + blind `coordinator.wait()` (G2); terminal check against the literal `APPLICATION_RUN_TERMINAL_PHASES` / `PROVIDER_EXECUTION_SETTLED_PHASES` sets | **The gap verb.** (a) Ride the canonical predicates (G9) so the per-cycle terminal check recognizes terminal truth including the durably-stopped `stopping` run (D3.1); (b) add a return-seam revalidation after the loop's last wait, before `return view`, matching RA6/RA7 — the revalidation must re-run the recursive-lease + deployment-policy + (surface-side) principal checks that `status()` already runs, so a mid-wait revocation refuses the typed code instead of projecting; (c) adopt the change-aware `waitAfter` (or an abortable sleep) so a mid-wait terminalization or revocation is observed on the change, not only at the next 100 ms wall-clock tick. |
| **`run_view`'s continuation** (`run.inspect` with cursor) | `application.mjs:10926-11040`; already change-aware (`waitAfter`), already revalidates at `:11011`/`:11015` after the wait and at `:11030` before the envelope (G5) | **PIN, don't move.** RA6 pins the refusal code (`run_orchestrator_lease_expired`/`_revoked`) and `projectedAfterWait === false`. The only open item is the D3.1 terminal-truth predicate for the `stopping` case and the renewal-path naming in the refusal (OQ3). |
| **`run.follow`** | `application.mjs:8362-8363`; return-seam revalidation already present (G6) | **PIN, don't move.** RA7 pins the after-wait-before-return revalidation. The D3.1 `stopping` terminal-truth and the refusal's renewal path (OQ3) apply on the same seams. |
| **MCP `fleet_run_wait` / `fleet_run_follow`** | `mcp-northbound.mjs:1505-1520`; post-dispatch `_authority` recheck already present (G7) | **Keep the post-dispatch recheck; add the renewal path to the refusal.** `toolError(refused)` (`:198-200`) must carry the named renewal lane (re-authenticate / refresh) instead of code-only `unauthenticated`/`forbidden`. `fleet_run_wait` gains no `until` field in this rung unless OQ5 resolves otherwise — it keeps the settle-block, but the settle-block's terminal-truth predicate follows D1/D3.1. |
| **Web `run_wait` / `run_follow`** | `web-northbound.mjs:684-689` (`_postWaitAuthorization`), applied at `:746`/`:895`/`:971`; `_authenticate` + `_authorize` after wait (G8) | **Keep the post-wait reauth; name the renewal path.** The `401 unauthenticated` / `403 forbidden` bodies must name `/v1/auth/refresh` (the AUTH_PATHS lane, G8) so a caller whose session died mid-wait knows the exact renewal verb instead of re-probing blind. |
| **CLI `run view --until settled\|terminal` / `run status --wait`** | `application-cli.mjs:1646-1656` (`run view --until` → `run.wait` with `until`); `application-cli.mjs:1712` (`run status --wait` → `run.wait`); server-side wait budget `_requestTimeoutForCommand` (`application-cli.mjs:2028-2035` sets `serverWaitMs` for `run.follow`/`run.wait`) | **No new seam of its own — it delegates to `run.wait`/`run.follow`.** The CLI inherits D1/D3.1 from the verbs it dispatches; the only CLI-facing obligation is to print the full non-ok envelope on a typed refusal (the #148 driver law, G1) rather than retry-blind. |
| **Driver pump loops** (the #148 instance's loop) | `orchestrator-friction-ledger.md:118` — the 25-iteration blind loop that never printed non-ok responses | **The #148 driver law, landed as client discipline:** log the full non-ok envelope; stop on repeated auth failure; never retry-blind. This is the caller side of D1.3. The server side (typed refusal + renewal path) is what makes the stop actionable. |

---

## D3 — the honesty edge cases

- **D3.1 — a run that terminalizes (or is durably stopped) MID-wait.** The wait returns the
  terminal truth on the cycle that observes it, not the timeout it was owed. Concretely: (a) a run
  whose phase enters `APPLICATION_RUN_TERMINAL_PHASES` mid-wait must return the terminal view with
  `terminalCause` immediately; (b) a run whose **stop receipt is durable** but whose reap has not
  yet flipped the phase literal to `stopped` reads `stopping` — terminal-truth with the cause
  already projected (G3) — and must return that terminal view immediately rather than burn the
  clock waiting for the reap. The contract does NOT amend the phase vocabulary (additive-only law,
  below): it extends the **predicate** the wait consults to recognize the durable stop
  (`runStop` present) as terminal-truth for wait purposes, and leaves OQ2 to decide whether that
  recognition rides `applicationTerminal` or a wait-local terminal-truth helper.
- **D3.2 — an authority that expires mid-wait.** Every cycle re-checks the recursive lease, the
  deployment policy, and (at the surface) the transport principal (G2, G7, G8). When any of them
  flips mid-wait, the verb refuses with the typed code **naming the renewal path** (D1.2) — it does
  not return the view it would have projected, and it does not keep sleeping. This is exactly the
  RA6/RA7 `invalidateRecipientWhenWaitWakes` scenario (phase77:370-392) applied to the wait verbs.
  The mid-wait revocation must produce the same refusal whether the run terminalized at the same
  instant or not: **a dead authority refuses even when the run truth is terminal** (the two checks
  are independent per-cycle checks, D1).
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
contract changes which seams surface them and what the refusal body names.

| Code | Authority that died | Renewal path the refusal must name | Status |
|---|---|---|---|
| `application_run_not_found` | none — the run never existed (G10) | none — byte-identical, FP-05 (no renewal; the caller misspelled or lost the run) | (existing) `application.mjs:3486` — pin, don't move |
| `run_orchestrator_lease_expired` | the recursive orchestrator lease (RA6/RA7) | re-authorize a fresh recursive lease for the run (the coordinator-seat authority boundary) | (existing) `coordination-store.mjs:1834` — surfaces change; renewal naming added |
| `run_orchestrator_lease_revoked` | the recursive orchestrator lease, explicitly revoked | same — re-authorize the lease (revocation is durable until a new lease mints) | (existing) `coordination-store.mjs:1835` — same |
| `application_unauthorized` | the deployment policy authorize (`_authorize`) | renew the deployment-policy credential/seat; if the principal's session is dead, refresh the session (web `/v1/auth/refresh`) | (existing) `application.mjs:3222` — refusal naming added |
| `unauthenticated` | the transport principal (MCP `_authority` / web `_authenticate`) | MCP: re-authenticate the MCP session; web: `/v1/auth/refresh` (G8 AUTH_PATHS) | (existing) `mcp-northbound.mjs:1334`, `web-northbound.mjs:631` — renewal naming added |
| `forbidden` | the principal's capability/repo scope (MCP `_authority` / web `_authorize`) | not a lifetime renewal — re-request with the required capability/repo scope, or ask an authority that holds it | (existing) `mcp-northbound.mjs:1333`, `web-northbound.mjs:675` — renewal naming added |
| `invalid_run_wait` | the wait request itself (timeout past the deployment ceiling) | none — resubmit with `timeoutMs` within the ceiling | (existing) `mcp-northbound.mjs:954-955` — pin |
| `application_wait_timeout_exceeds_web_ceiling` | the web wait request (timeout past 30 s) | none — resubmit within 30 s | (existing) `web-northbound.mjs:417` — pin |

---

## Red-first acceptance pins

**RED at HEAD (current behavior — these must flip with the landing):**

- **A1 (RED) — `run.wait` on a durably-stopped run burns the full clock.** A run whose stop
  receipt is durable (phase reads `stopping`, `application.mjs:7598`) and whose reap does not
  complete within the wait budget: `run.wait(until: 'terminal')` loops to the deadline and returns
  the deadline view instead of the terminal view with the stop cause. The fixture
  `invalidateRecipientWhenWaitWakes` (phase77:370-392) does not fire because run.wait sleeps on the
  blind `coordinator.wait()` (G2), and the literal terminal set misses `stopping` (G3).
- **A2 (RED) — MCP `fleet_run_wait`/`fleet_run_follow` refuse with code-only bodies after a
  mid-wait revocation.** When `isPrincipalActive` flips to false during the wait, the post-dispatch
  `_authority` recheck (`mcp-northbound.mjs:1510`) returns `toolError('unauthenticated')` (`:198`)
  with no renewal path — the caller cannot learn the renewal verb from the refusal (G7). (The CE5/MN
  post-wait revocation pin at `phase16-mcp-northbound.test.mjs:239-253` asserts the `unauthenticated`
  code; the contract ADDs the renewal naming on top, it does not remove the code.)
- **A3 (RED) — web `run_wait`/`run_follow` refuse with `401 unauthenticated` naming no renewal
  path.** `_postWaitAuthorization` (`web-northbound.mjs:684-689`) returns the bare
  `error(401, 'unauthenticated')` after a mid-wait session expiry, even though `/v1/auth/refresh`
  is in `AUTH_PATHS` (`:166`) — the refusal does not point at the renewal lane (G8).
- **A4 (RED) — the driver pump loop retries blind on a typed refusal.** The #148 instance's loop
  ran 25 blind iterations because it never printed the non-ok envelope (G1). The acceptance is the
  driver law: a loop over the bus that receives a typed auth refusal logs the full envelope and
  stops on repeated auth failure.

**GREEN / must-not-move at HEAD (these are the invariants the fail-loud landing rides, not
breaks):**

- **A5 (GREEN) — unknown run ids refuse `application_run_not_found` byte-identical, no clock.**
  `_findRun` before authorize (G10) — FP-05 preserved for every wait verb; unknown ≡ foreign.
- **A6 (GREEN) — `run.inspect`'s continuation refuses after mid-wait lease invalidation, never
  projects.** RA6 (phase77:394-420): `projectedAfterWait === false`, refusal code
  `run_orchestrator_lease_expired`/`_revoked`. Pin.
- **A7 (GREEN) — `run.follow` revalidates after wait immediately before return.** RA7
  (phase77:425-467). Pin.
- **A8 (GREEN) — terminal views carry `waitingOn: null` + `terminalCause`; the canonical
  predicates own the vocabulary.** G9 — the terminal truth the waits return rides the existing
  closed vocabulary; nothing is re-invented.
- **A9 (GREEN) — the terminal/settled literal sets and the `WAITING_ON_KINDS` closed set are
  unchanged.** Additive-only law (below) — the contract adds a wait-local terminal-truth predicate
  for the durable stop; it does not edit the phase or waitingOn vocabulary.
- **A10 (GREEN) — the MCP `invalid_run_wait` and web `application_wait_timeout_exceeds_web_ceiling`
  ceilings stay.** `mcp-northbound.mjs:954-955`, `web-northbound.mjs:417` — request-shape refusals,
  unchanged.

---

## Open questions

- **OQ1 — does `run.wait` adopt the change-aware `waitAfter` for its loop, or an abortable sleep?**
  The RA6/RA7 fixture patches `waitAfter` (phase77:370-392); G2 shows run.wait never enters that
  path today. If run.wait adopts `waitAfter` with the run's cursor as `afterSeq`, a mid-wait
  terminalization/revocation wakes it on the change (bounded, honest) rather than at the next
  100 ms tick. The alternative is keeping the poll loop but making each cycle's re-check
  authoritative. The contract's D1 only demands per-cycle re-check; OQ1 is the mechanism.
- **OQ2 — how does the wait-local terminal-truth predicate recognize a durably-stopped run?**
  Options: (a) extend the predicate the wait consults to treat `runStop` presence as terminal-truth
  (the run's authority is closed and its cause is projected even at `stopping`); (b) admit
  `stopping` to the terminal predicate via `canonicalRunPhase`/`applicationTerminal` — but that is
  an amendment to the closed vocabulary and needs the #10/#74 owners' sign-off; (c) keep `stopping`
  as a non-terminal wait state and instead surface the durable stop via the waitingOn spine.
  The brief's observed instance ("run.wait on a terminal run waiting out the clock") points at (a)
  or (b).
- **OQ3 — what shape does "naming the renewal path" take in each refusal body?** For the web, the
  renewal lane is `AUTH_PATHS` (`/v1/auth/refresh`, G8) — a `renewal: { path: '/v1/auth/refresh',
  method: 'POST' }` field on the error body is a candidate. For MCP, re-authentication is the lane.
  For the recursive lease, the lane is the coordinator-seat re-authorization. For the #148 resident,
  the renewal verb is a #148 deliverable (G1) — the #164 refusals must be able to name it when it
  exists without breaking on its absence (a stable `renewal` shape that may carry a `path` or
  `verb` or `seat` depending on which authority died).
- **OQ4 — does the driver pump-loop law (A4) get a shared client helper, or stay per-driver
  discipline?** The #148 driver law is stated in the ledger (G1). A shared "poll with fail-loud
  envelope logging and stop-on-repeated-auth-failure" helper would make it structural; the contract
  only requires the behavior (log the full non-ok envelope, stop on repeated auth failure), leaving
  the helper to a later rung.
- **OQ5 — does MCP `fleet_run_wait` gain an `until` field?** Today it carries no `until` (G7), so
  it always dispatches the default settle-block. The brief lists `fleet_run_wait` as a wait verb but
  does not ask for a terminal selector; OQ5 is whether this rung adds `until: 'terminal'` to the
  MCP schema or leaves the MCP surface settle-block-only (the fail-loud law applies either way).

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
  `impl/test/phase77-recursive-application-red.test.mjs:394-467` (fixture `:370-392`).
- The MCP post-wait revocation pin:
  `impl/test/phase16-mcp-northbound.test.mjs:239-253`.
- The `waitAfter` change-aware wait: `impl/src/coordination-store.mjs:8880-8918`. The blind
  `coordinator.wait()`: `impl/src/coordinator.mjs:12054`. The recursive lease failures:
  `coordination-store.mjs:1834-1835`, `authorizeRunOrchestratorCommand` at `:2069`.

---

## Campaign-law constraints

- **No clocks.** The fail-loud law is a per-cycle re-check, never a wall-clock decision: the verb
  returns terminal truth or a dead-authority refusal on the cycle that observes it, and a wait that
  continues does so only because its per-cycle check found neither. No new clock or deadline is
  introduced; the existing `Date.now()`/`deadline` shape in `run.wait` (`application.mjs:7997`,
  `:8003`) stays the wait budget, not the honesty mechanism.
- **Additive-only.** The literal phase sets, `WAITING_ON_KINDS`, and the refusal codes exist and
  stay; the contract adds (a) a wait-local terminal-truth predicate for the durable stop (OQ2), (b)
  renewal-path naming on the typed refusals (OQ3), and (c) the driver law (A4). Nothing existing is
  renamed or retired; the canonical predicates and the FP-05 resolve-then-authorize ordering are
  pinned (A5, A8, A9).
- **Deliverable boundary.** This artifact is the single deliverable for the rung:
  `docs/reference/evidence/blind-waits-2026-08-13/blind-waits-contract.md`. No implementation file
  is amended here; the acceptance pins (A1-A10) are the landing criteria for the code rung that
  follows.
