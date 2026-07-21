# Phase 89 — Authenticated resident application: resident-architecture review

Role: independent resident-architecture reviewer (route `glm`/`glm-5.2`/`xhigh`).
Date: 2026-07-18 evidence pack (review written 2026-07-19).
Companion: `codex-application-review.md` (application-ax-security role).

## 1. Scope, method, and verification evidence

Inspected against `spec/phase89-authenticated-resident-application.md` and the
acceptance-red `spec/phase89-authenticated-resident-security-matrix.md`:

- `impl/src/application.mjs` — command definitions, `validateApplicationCommandArgs`,
  `listRuns`, `command` dispatch, recursive-orchestrator guard, `_progressTiming`.
- `impl/src/application-client.mjs` — `BatonRun`/`BatonRuns`/`BatonClient`,
  `bindBaton`/`bindBatonPort`, validating `attach`.
- `impl/src/application-deployment.mjs` — `BatonDeployment`, `openBatonDeployment`,
  `assertRouteReady`, `DEFAULT_BUDGET`/capacity privacy.
- `impl/src/application-cli.mjs` — `BatonWebClient`, `connectBaton`, discovery, `serve`.
- `impl/src/application-host.mjs` — `BatonWebHost`, `SignalLifecycleOwner`.
- `impl/src/web-northbound.mjs` — `/v1/commands`, `/v1/session`, `/v1/application-card`,
  `execute` admission/quota ordering, `_readBody`/`_write`.
- `impl/test/phase89-resident-application-red.test.mjs` — RA1–RA7 RED contracts.

Method: static read of the above plus live execution. No nested Baton was invoked; only
read-only inspection and the repo's own test/verification commands were run.

Verification evidence (deployment verification command is `node`, per this evidence pack's
`run.mjs`):

```
node --test impl/test/phase89-resident-application-red.test.mjs
ℹ tests 10  ℹ pass 10  ℹ fail 0   (RA1…RA7, incl. RA7 sub-cases)
```

The bare deployment-verification command `node` exits 0 in this non-interactive context. The
Phase 89 RED surface is green.

## 2. Verdict

The seven reviewed surfaces are **landed and RED-green** and they preserve TLS, repository,
session/semantic authority, and the non-exposure of caller budgets/limits:

- bounded `runs.list`, validating `attach`, exposed `deployment.runs`, the common Web
  command-port binding, the `connectBaton` handshake, and the centralized progress-timing
  model are all present and behave as specified.
- The **ordered resident-host plan is not yet wired**: `openBaton().host()` does not exist.
  The host machinery (`BatonWebHost`, `SignalLifecycleOwner`) exists and is exported, but it
  is not owned by `openBaton()`. This is the central acceptance-red gap, not a defect in what
  landed.

Four concrete landed-surface issues are listed in §4 (separated from the acceptance-red
backlog in §5), and the smallest integrated fix that advances `openBaton().host()` and
`connectBaton()` without weakening authority is in §6.

## 3. What landed correctly (with evidence)

### 3.1 Bounded `runs.list`
`runs.list` is one closed, authenticated, idempotent observe operation:
`APPLICATION_COMMAND_DEFINITIONS['runs.list'] = { args:[], capabilities:['observe'], web:true, mcp:true, mcpStateful:false, reconcilable:true }`
(`application.mjs:59`); registry entry `inputSchema` is a closed empty object, `idempotent`,
non-destructive (`application-semantics.mjs:92-95`); `validateApplicationCommandArgs` rejects
any argument (`exactObject(args, [], …)`, `application.mjs:865-868`), so caller-managed
`limit`/`cursor`/`receiptCursor` are refused (RA1).

`listRuns` (`application.mjs:7714-7783`) is repo-scoped (`goal.repoId === this.repoId`),
deduplicates to the latest Goal version per Run, authorizes `runs.list` once and then
`run.status` per visible Run (skipping unauthorized Runs rather than failing), binds the
semantic-registry digest, and enforces both a record ceiling (`MAX_RUN_RECORDS = 100_000`,
line 39), an item ceiling (`MAX_RUN_LIST_ITEMS = 64`, line 42), and a byte ceiling
(`MAX_RUN_VIEW_BYTES = 512KiB`, line 40; checked at 7778). The item shape carries only safe
fields (`id, objective, phase, stage, timing, terminal, attention, route, resources{state,ownedCount}, actions`) — RA2's `forbiddenKeys` corpus is absent. Recursive (Baton-on-Baton)
catalog access is explicitly forbidden to orchestrator sessions
(`authorizeReplay` 1606-1608; `command` 8081-8086) — a correct safety property, not a bug.

### 3.2 Validating `attach`
`BatonRuns.attach` (`application-client.mjs:931-941`) is asynchronous and validates existence
**and** observation authority through a single `run.inspect` outline read before returning a
`BatonRun` whose `last` caches that view; it rejects when `view.runId !== runId` or the
outline is missing (`application_attach_invalid`). Observation authority is enforced
server-side by `run.inspect`'s own `_authorize`, so cross-repo/unauthorized attach fails with
the standard not-found/forbidden (AA6/AA7) without a second ledger. The non-validating
`open(runId)` compatibility alias is retained (line 916). RA3 green.

### 3.3 Exposed `deployment.runs`
`BatonDeployment` binds the owner principal via `bindBaton(application, principal)` and
exposes `this.runs = this.#baton.runs` (`application-deployment.mjs:945`), so the owner gets
the same `BatonRuns` surface a connected client gets. Concise aliases `run`/`open`/
`startMany`/`workflow`/`close` are preserved, and `close()` delegates exactly once to
`application.shutdown(principal)` (978-981). RA4 green.

### 3.4 Common Web command-port binding
One `ApplicationCommandPort` contract, two bindings. The direct port (`bindBaton`) bakes the
principal into the handles. The Web port (`bindBatonPort`, `application-client.mjs:1168-1176`)
wraps `command: (name, args) => client.command(name, args)` — the caller principal is dropped
at the port boundary, so the bound principal (`{ kind:'bound-command-port' }`) is never sent
and never becomes an idempotency key (RA6 asserts this). On the server, `execute`
(`web-northbound.mjs:532-618`) derives the actor from the authenticated session
(`webActor = actor(ctx.principal)`, line 554) and dispatches with a context whose
`transport:'web'`, `requestId`, `idempotencyKey`, capabilities, and semantic authority are all
server-supplied — request JSON cannot choose actor/principal/session/capabilities/fence
(AA16). The envelope's `idempotencyKey` is a fresh `randomUUID` (`application-cli.mjs:1031,
1037`), not the principal. RA5 green.

### 3.5 `connectBaton` handshake
`connectBaton` (`application-cli.mjs:1134-1178`) discovers one authority via the repository
selector → owner-only XDG profile → owner-only token file, constructs an HTTPS-only
`BatonWebClient` (protocol enforced at 954-961), runs `doctor()` (`/readyz` +
`/v1/application-card`) and `session()` (`/v1/session`) with `sec-fetch-site:'none'`, then
gates on `ready`, `agentExperience.registryDigest === APPLICATION_SEMANTIC_REGISTRY.digest`,
and repo membership before binding. The card's `agentExperience.registryDigest` is the live
registry digest (`application.mjs:8035-8037`), so the compatibility check is real. Incompatible
handshakes fail before `/v1/commands` is ever admitted (RA7). HTTPS is mandatory and there is
no implicit wildcard bind. RA6/RA7 green.

### 3.6 Progress timing
`_progressTiming` (`application.mjs:5806-5843`) is the single model used by single-Run, list,
and group projections: `startedAt = goal.definedAt` (Goal admission, not provider-process
start), server-derived `observedAt`, non-negative bounded `elapsedMs`, `lastProgress` derived
only from meaningful follow-category events (`_followCategory !== null`, so audit/HTTP/poll/
clock passage do not advance it), terminal `completedAt`, and `silenceMs`. This matches
SV10/SV11/SV12/SV15 and excludes volatile clocks from the semantic view digest
(`semanticViewDigest` strips `cursor`, `application.mjs:99-102`). No forbidden key is leaked
through the list projection (RA2).

## 4. Concrete landed-surface defects (correctness / security / AX)

These are reachable on the surface Phase 89 just promoted. Ranked by severity.

### D1 — `runs.list` item ceiling is computed before per-Run authorization (AA5 count side-channel) · security-adjacent
`listRuns` builds `ordered` from **all** repo Goals (`application.mjs:7724-7734`), applies the
`MAX_RUN_LIST_ITEMS` (64) ceiling at **7735-7738**, and only then authorizes each Run and
skips unauthorized ones at **7740-7746**. Consequences:

1. Unauthorized Runs count toward the caller's 64-item ceiling, so a caller can be **denied a
   listing by Runs it cannot observe** — a caller authorized for zero Runs still gets
   `application_run_list_continuation_required` once the repo holds >64 Runs total.
2. The throw at the boundary is a **count side-channel**: a caller can distinguish "repo has
   ≤64 Runs" (list returns) from "repo has >64 Runs" (throw). AA5/AA7 require that unauthorized
   Runs not affect visible counts, cursors, timing, or error text.

Note the **byte** ceiling is already applied post-filter (7778, on authorized `items` only);
only the **item** ceiling is mis-ordered. Smallest fix: authorize-filter into the authorized
subset first, then apply the item ceiling to that subset. Authorization is unchanged; only the
ordering of the ceiling check moves, so no authority is weakened.

### D2 — `deployment.runs.start` bypasses the route-readiness gate · AX
`BatonDeployment.run(objective, route)` calls `assertRouteReady(route, readiness)`
(`application-deployment.mjs:953-956`) before delegating, but `this.runs = this.#baton.runs`
(line 945) exposes `BatonRuns.start` directly, which does **not**
(`application-client.mjs:951-953`). So the promoted `deployment.runs.start(...)` dispatches
`run.start` and surfaces a later, less-typed error instead of the early
`route_unavailable`/`route_ambiguous`/`authentication_required` summary that `run()` provides.
Not a security hole — the driver still validates the route against the profile — but an AX
inconsistency on the exact surface Phase 89 elevates. Smallest fix: route `BatonDeployment`
starts through a wrapper that applies `assertRouteReady`, or give `BatonRuns` an optional
readiness hook.

### D3 — `BatonWebClient` follows redirects; bearer is forwarded on 3xx · security (inherited, newly exposed)
`_json`/`command`/`reconcile`/`doctor`/`session` (`application-cli.mjs:978-1091`) set no
`redirect` option, so the transport default (`redirect:'follow'`) applies. A 3xx from a
compromised/MITM resident or TLS-terminating proxy would be followed with
`Authorization: Bearer <token>` attached, forwarding the bearer to the redirect target —
violating RD12 and LX6. Phase 89's new `connectBaton` handshake and **every** subsequent
command/attach/status travels this client, so the exposure spans the entire new connected
surface. The hardening already exists in-repo — `setupRemoteRead` uses `redirect:'error'`
(line 259) — it simply is not applied to the connected client. Smallest fix: default
`BatonWebClient` fetches to `redirect:'error'` (match `setupRemoteRead`). No authority
weakened.

### D4 — `BatonWebClient` does not bound per-response wait or body size · DoS/AX (inherited)
`await response.json()` (line 983) reads without a per-response timeout or byte cap; only the
**server-side request** body is bounded (`_readBody`, `web-northbound.mjs:1505-1516`) and the
application bounds its own list/inspection outputs. A hostile or runaway resident could return
an unbounded JSON body and stall/OOM the client (LX7). Smallest fix: wrap each response with
`AbortSignal.timeout(...)` and a bounded read (cap bytes, then parse). Note: the application
already caps its own outputs, so this is defense-in-depth on the client read path.

### D5 — `connectBaton` proves only `observe`, not "required semantic capabilities" · AX (acceptable, not a defect)
The handshake requires `observe` (enforced in `session()` at `application-cli.mjs:1016`) plus
repo membership, registry-digest compatibility, and readiness, but not `control` or other
effect capabilities that spec §3.3 calls "required semantic capabilities." This is acceptable
because every effect command is re-authorized server-side (fail-closed per command), but an
observe-only session resolves `connectBaton` and only fails later on `run.start`. Flagged for
completeness; no change required for fail-closed safety.

## 5. Later acceptance-red gaps (owned by the matrix / spec §8 later slices — not Phase 89 defects)

### C1 — `openBaton().host()` is not implemented (the central gap)
`openBaton` (`index.mjs:47-48`) delegates to `openBatonDeployment`; `BatonDeployment`
(`application-deployment.mjs:931-982`) exposes `card/doctor/run/startMany/workflow/open/close/
runs` but **no `host()`** (confirmed: no `host` method on the deployment/client surface; the
only `host` token in `application.mjs` is help prose at line 7804). The host building blocks
exist and are exported (`BatonWebHost`, `SignalLifecycleOwner`, `application-host.mjs`;
`index.mjs:181`) but are not owned by the deployment. Consequently `baton serve <module>`
still requires a caller-authored assembly module (`application-cli.mjs:813-818` requires
`CONFIG_MODULE`), contra spec §6 ("ordinary `baton serve` opens the repository deployment and
invokes its integrated host; no user-authored JS assembly module is required"). This is
matrix §1's "integrated resident host is not yet owned by `openBaton()`" and blocks spec §7.1,
§7.10 and the spec §1 owner example. The Phase 89 dogfood (`run.mjs` in this evidence pack)
confirms it: the loop is `openBaton → doctor → runs.startMany → complete → inspect → stop →
close` — the **owner** path only; it never calls `host()` and never runs a live `connectBaton`
against a real listener.

### C2 — Resident transport/lease/publication not in the `openBaton` path
Owner-local Unix-domain socket transport and explicit network mode (spec §3.1/§3.2, slice 5)
are absent from `openBaton`. There is no resident writer lease with instance-epoch +
PID-start/incarnation identity (RD6-RD8), no atomic, directory-synced, owner-only coordinate
publication (RD1-RD3), and no token-file compare-and-swap rotation (RD10, AA11). `connectBaton`
discovers a **hand-installed** selector/profile (the test fixture and dogfood write them
directly), not one published by `host()`.

### C3 — `runs.list` continuation is never produced
`continuation` is always `null` (`application.mjs:7776`) and >64 active Runs throws
`application_run_list_continuation_required` (7735-7738). Fail-closed is the correct interim
(no silent truncation), but the advertised pagination contract (spec §2.2, AA5, SV17) is
unrealized. (The throw's interaction with authorization is the separate D1 defect above.)

### C4 — Command-cost quota taken before durable admission
`execute` calls `this.edge.takeCommand(...)` at `web-northbound.mjs:585-594` **before**
`coordination.admitWebCommand(...)` at 598, so reconcilable retries — including a `runs.list`
reconciliation re-POST — consume privileged quota. This is LX11 / matrix §1's known gap; Phase
89's reconcilable `runs.list` inherits it.

### C5 — Crash-safe control and Run-scoped streaming are later slices
Crash-safe send/steer and interrupt settlement (CS1-CS12), Run-scoped progressive streaming
with re-ticket/cursor resume (SV1-SV7), and ordinary `run.send`/`run.interrupt` semantic
actions (spec §2.3) are not in this slice. `run.steer` remains explicitly non-reconcilable
(`reconcilable:false`, `application.mjs:69`) and there is no ordinary Run-level `interrupt`.

### C6 — Client redirect/size/wait bounds are tracked matrix gaps
D3 and D4 above are also listed in matrix §1 ("the low-level Web client does not explicitly
reject redirects or bound every individual response wait/size"). They are acceptance-red by
category, but called out in §4 because they are directly reachable from the newly-landed
`connectBaton` surface.

## 6. Smallest integrated fix that advances `openBaton().host()` and `connectBaton()`

The goal: advance the two entrypoints named in the brief without weakening TLS/auth/
repository/semantic authority and without exposing caller budgets or limits.

1. **Own the host on the deployment (closes C1).** Add `BatonDeployment.host()` as a thin
   owner-local seam that reuses the existing `BatonWebHost` + `SignalLifecycleOwner`
   (`application-host.mjs`): construct the authenticated listener bound to the **owner
   principal already on the deployment**, run the same readiness/card/session checks
   `connectBaton` performs, then publish the **non-secret** selector + owner-only XDG
   profile/token via an atomic directory-synced replace (reuse the
   `installRepositorySelector` pattern at `application-cli.mjs:285-335`, which already does
   `O_EXCL`+`fsync`+`link` and owner-only perms). Return a non-secret outline only. `connectBaton`
   already consumes such a listener (RA6), so this unblocks spec §1 and acceptance §7.1/§7.10
   with **no second control plane**. `DEFAULT_BUDGET` and capacity ceilings
   (`application-deployment.mjs:26-45`) stay private deployment authority — `host()` does not
   surface them.
2. **Harden `connectBaton`'s transport (closes D3/D4, partially C6).** Default
   `BatonWebClient` fetches to `redirect:'error'` and add per-response `AbortSignal.timeout`
   plus a bounded body read. Mirrors `setupRemoteRead` exactly; one-line-each per call site.
3. **Authorize-filter before the list item ceiling (closes D1).** In `listRuns`, build the
   authorized subset first and apply `MAX_RUN_LIST_ITEMS` to it; keep `MAX_RUN_VIEW_BYTES`
   post-filter as today.
4. **Route deployment starts through `assertRouteReady` (closes D2).**

None of (1)-(4) exposes caller budgets, byte/file ceilings, PIDs, worker IDs, session IDs, or
private paths; none weakens HTTPS, the repository challenge, session capability checks, or
semantic-action authority. (1) is the only structural addition; (2)-(4) are small, localized
corrections to already-landed code.

## 7. Verification

- Deployment verification command `node` exits 0.
- `node --test impl/test/phase89-resident-application-red.test.mjs` → 10 pass / 0 fail
  (RA1–RA7, including all RA7 sub-cases).
- The Phase 89 dogfood (`run.mjs`) drives the **owner** path
  (`openBaton → doctor → runs.startMany → complete → inspect → stop → close`) and writes this
  report from the preserved result. It does **not** exercise `host()` or a live `connectBaton`
  against a real listener — consistent with C1: the integrated resident host is the next slice
  to land.
