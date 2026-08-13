# Issue #164 — blind-waits fold (v2): red-first suite draft notes

[attempt: 08d0dac7-8ad0-4e7c-a13e-9d7a3bb855bc row-suite-164]

- **row-suite-164 · attempt `08d0dac7-8ad0-4e7c-a13e-9d7a3bb855bc`** — the red-first suite for the folded
  #164 blind-waits contract (v2). Attempt echo law (normalized verbatim at landing per the wave-b QA's
  needs-fold item): the verbatim `[attempt: …]` line heads BOTH deliverables.
- **Suite:** `impl/test/blind-waits-red.test.mjs`
- **Contract:** `blind-waits-contract.md` (v1 DRAFT at HEAD) + the v2 FOLD directives carried by this row
  dispatch — the wait-local terminal-truth helper per DR-1(a) with the durable-stop predicate extended to
  the settle-block loop, the RA6/RA7 pins, the FP-05 unknown≡foreign pin, `application_wait_invalid` in the
  refusal table, and the additive-only law. `redteam-164.md` and `fold-164.md` are referenced by the dispatch
  but are NOT present in this worktree — recorded as judgment call §J1 (the suite is written against the v1
  DRAFT contract text + the v2 fold directives verbatim from the dispatch).
- **Date:** 2026-08-13
- **Split (verified):** `node --test impl/test/blind-waits-red.test.mjs` from the repo root at HEAD
  `e371f70`, run TWICE — run e1 and run e2 BOTH measure **tests 31 · pass 23 · fail 8**, with IDENTICAL pass
  and fail sets on both runs. Row accounting: the 31 runner-counted tests = 23 top-level rows + 8 nested
  subtest legs (A6/A7's expired+revoked invalidation legs, D3.2's MCP/web legs, P-FORBIDDEN's MCP/web legs).
  Of the 23 rows: **15 GREEN pass, 8 RED fail**. Every red row fails at its NAMED stage (the assert message
  names the stage): `terminal-truth-predicate-missing` (A1-a), `settle-block-durable-stop-missing` (A1-b),
  `mcp-refusal-renewal-missing` (A2-a AND A2-b — both MCP wait verbs), `web-refusal-renewal-missing` (A3-a
  AND A3-b — both web wait verbs), `return-seam-revalidation-missing` (B1),
  `driver-stop-on-repeated-auth-missing` (A4). All fifteen green rows pass at HEAD and MUST stay green — each
  green pin kills a plausible wrong implementation of the fold.
- **Done-when (from the dispatch):** "Baton preserves exact route, result, and cleanup truth." The green
  legs pin the exact-route of the wait/poll verbs (the typed refusal codes never move, the literal phase
  sets and `WAITING_ON_KINDS` never grow), result truth (a mid-wait terminalization returns the TERMINAL
  view on the observing cycle, never the pre-terminal snapshot), and cleanup truth (every fixture tears down
  its mkdtemp repo + log dir in `t.after`; no residue). The eight red rows are the seams the fold must land:
  the wait-local terminal-truth predicate (DR-1(a), in BOTH `run.wait` loops — the `until==='terminal'` loop
  AND the default settle-block loop), the transport renewal naming on the wait refusals (D1.2/G7/G8, on BOTH
  wait verbs per transport — MCP `fleet_run_wait`/`fleet_run_follow` and web `run_wait`/`run_follow`), the
  distinct return-seam revalidation (D2(b)), and the driver-layer stop-on-repeated-auth guard (the #148
  instance shape at the wave-driver pump loop).

## Invented surfaces (all absent at HEAD; accessed absence-proof)

Every invented surface is driven through surfaces that EXIST at HEAD (`run.wait` `application.mjs:7979`,
`run.status` `:4795`, `run.follow` / `run.inspect` through the direct ports, the MCP post-dispatch recheck
`mcp-northbound.mjs:1510`, the web post-wait authorization `web-northbound.mjs:684-689`, the wave-driver
poll/steer pump loop `wave-driver.mjs:544-893`, the CLI wait delegation `application-cli.mjs:1655/:1712/
:2030`, `run.scratchpad.*` direct ports `application.mjs:12522-12523`). The invented behavior is asserted
BEHAVIORALLY — a missing code at HEAD is a red assertion, never a load-time crash (no invented export is
imported statically; the three static pins, B1/A4/P-CLI, read EXISTING source with `grep -Fna` / `sed -n`).

| Surface | Exact signature | Where pinned |
|---|---|---|
| The wait-local terminal-truth predicate (DR-1(a)/OQ2(a)) | a helper consulted by `run.wait`'s `until==='terminal'` loop AND the default settle-block loop that classifies a DURABLY-STOPPED run (phase `'stopping'`, `application.mjs:7598` — `runStop.status==='stopped'` while the run is not yet reaped) as terminal-truth, ADDITIVE to the canonical predicates (`applicationTerminal('stopping')` stays `false`) | A1-a (terminal loop), A1-b (settle-block loop) |
| The mid-wait transport renewal naming (D1.2/G7/G8) | MCP: the post-dispatch `toolError(refused)` envelope carries `error.renewal` naming the re-authentication lane; web: the 401/403 body carries `error.renewal.path === '/v1/auth/refresh'`. ADDITIVE on the typed `unauthenticated`/`forbidden` codes — never a code swap | A2-a AND A2-b (both MCP wait verbs), A3-a AND A3-b (both web wait verbs) |
| The distinct return-seam revalidation (D2(b)) | `run.wait` performs a lease/authority revalidation AFTER the loop's last wait and BEFORE `return view` — lexically a `this._authorize` / `this._authorizeRecursiveCommand` call after the last `while (` in the method body | B1 (static) |
| The driver stop-on-repeated-auth guard (the #148 instance shape) | the wave-driver L4-L6 poll/steer pump loop (`wave-driver.mjs:544-893`) logs the full non-ok envelope and stops on a repeated auth failure instead of retrying blind — at HEAD the L5/D10 catch (`:566-571`) blankets every status failure as `'unavailable'` | A4 (static scan of the pump-loop region) |
| The authority check's independence from the run truth (D3.2) | a DEAD principal refuses even when the run truth is terminal — the transport's post-wait authority check runs regardless of the dispatched value, never short-circuited by an early terminal-return | D3.2 (MCP leg + web leg) |
| The CLI wait delegation (D2 seam map) | the CLI `run view --until` / `run status --wait` delegate to the `run.wait` verb — no CLI-local wait seam of its own; the `serverWaitMs` budget is forwarded from the verb (`application-cli.mjs:1655/:1712/:2030`) | P-CLI (static anchors, line ordering) |
| The `forbidden` wait refusal shape (OQ3) | the capability/repo-scope `forbidden` refusal at the wait seams is the DEATH of the call, never a lifetime renewal — it must NOT carry `renewal.path === '/v1/auth/refresh'` | P-FORBIDDEN (MCP leg + web leg) |

## Row map

### Red rows (must FAIL at HEAD at the named stage)

| Row | Stage | Green when |
|---|---|---|
| A1-a | `terminal-truth-predicate-missing` | `run.wait({until:'terminal'})` on a durably-stopped run (phase `'stopping'`) returns the already-projected terminal truth WITHOUT sleeping — the wait-local helper recognizes the durable stop on the first cycle. At HEAD `'stopping'` is outside `APPLICATION_RUN_TERMINAL_PHASES` (`application.mjs:160`), so the loop enters the blind `coordinator.wait` burn (G2/G3) and the assertion `waitCalls() === 0` FAILS → RED |
| A1-b | `settle-block-durable-stop-missing` | the SAME durable-stop predicate is consulted by the default settle-block loop — a durably-stopped run returns immediately there too. At HEAD `'stopping'` is outside `PROVIDER_EXECUTION_SETTLED_PHASES` (`application.mjs:157`) → RED |
| A2-a | `mcp-refusal-renewal-missing` | MCP `fleet_run_wait`'s mid-wait revocation (the `isPrincipalActive` toggle flips while the dispatch is parked) refuses `unauthenticated` AND carries `error.renewal` naming the MCP re-authentication lane. At HEAD `toolError(refused)` is code-only (`mcp-northbound.mjs:198-200` via the `:1505-1520` recheck) with no renewal field → RED |
| A2-b | `mcp-refusal-renewal-missing` | the SECOND MCP wait verb — `fleet_run_follow`'s mid-wait revocation, the SAME post-dispatch recheck seam, refuses `unauthenticated` AND names the renewal path. At HEAD it is code-only like A2-a → RED. An impl that fixes only `fleet_run_wait` leaves `fleet_run_follow` bare, so this row stays RED at the same stage (the renewal naming is wait-verb-scoped, not single-verb) |
| A3-a | `web-refusal-renewal-missing` | web `run_wait`'s mid-wait expiry (same toggle) refuses 401 `unauthenticated` AND carries `error.renewal.path === '/v1/auth/refresh'`. At HEAD `_postWaitAuthorization` returns the bare `error(401, unauthenticated)` (`web-northbound.mjs:684-689`) → RED |
| A3-b | `web-refusal-renewal-missing` | the SECOND web wait verb — `run_follow`'s mid-wait expiry, the SAME post-wait reauth seam (`:895`), refuses 401 `unauthenticated` AND names `/v1/auth/refresh`. At HEAD it is bare like A3-a → RED. An impl that fixes only `run_wait` leaves `run_follow` bare, so this row stays RED at the same stage |
| B1 | `return-seam-revalidation-missing` | `run.wait`'s body has a `this._authorize` / `this._authorizeRecursiveCommand` call LEXICALLY AFTER the last `while (` and before `return view`. At HEAD the settle-block loop is immediately followed by `return view` (`application.mjs:8005-8006`) → the static pin FAILS → RED. A per-cycle `status()` re-check (which status() runs internally) does NOT match the literal source text, so a wrong impl that keeps only the loop's re-check stays RED |
| A4 | `driver-stop-on-repeated-auth-missing` | the wave-driver L4-L6 poll/steer pump loop (`wave-driver.mjs:544-893`) must log the full non-ok envelope and stop on a repeated auth failure (the #148 driver law as client discipline). At HEAD the region carries NO auth-stop guard and NO full-envelope log — the L5/D10 catch (`:566-571`) blankets every status failure as `'unavailable'`, so a typed refusal is pumped to the deadline blind → the static scan FAILS → RED. (Behaviorally un-drivable in a minimal fixture — see design decision §D7) |

### Green guards / pins (must stay green at HEAD)

| Row | Pin |
|---|---|
| A5 | FP-05 unknown≡foreign byte-identical: a never-existing run id refuses `application_run_not_found` for BOTH a lease-holding caller and an authority-less foreign caller, and the two refusal envelopes are byte-identical — resolve-then-authorize ordering (`application.mjs:4799-4803`, `_findRun` throws `:3486`) never moves, and the fail-loud law never conflates the unknown run with a dead authority. No clock burned |
| A1-c | a run that terminalizes MID-wait (the patched `coordinator.wait` performs `admitRunStop` + `completeRunStop`) returns the TERMINAL view (`phase 'stopped'`, `waitingOn:null`, `terminalCause` operator_stop) on the observing cycle — exactly ONE sleep, never the deadline. Kills a snapshot-only impl that sleeps once and returns the pre-terminal view |
| A8 | terminal views carry `waitingOn:null` + the typed `terminalCause` (`operator_stop` for a stopped run), and the canonical predicates own the vocabulary — `applicationTerminal('stopping')` stays FALSE and the literal terminal set stays unchanged (additive-only) |
| A6 | RA6 pin: `run.inspect`'s continuation revalidates its recipient lease after wait and NEVER projects — mid-wait lease invalidation (expired/revoked, via the `mutableClock` / `revokeRunOrchestratorLease` doubles) refuses `run_orchestrator_lease_expired`/`_revoked`, no semantic Run content is projected, and the post-invalidation driver record exists as the would-be-leak. The fail-loud landing must not break this landed discipline |
| A7 | RA7 pin: `run.follow` revalidates its recipient lease after wait and immediately before return — same invalidation legs refuse with the typed codes, no follow page is returned |
| D3.2 | a DEAD authority refuses even when the run truth is terminal — the two per-cycle checks are INDEPENDENT. Both legs (MCP + web) drive a dispatch that returns the terminal view while `isPrincipalActive` is false: the refusal (`unauthenticated`/401) wins over the terminal truth. At HEAD the post-dispatch rechecks run after dispatch regardless of the dispatched value → GREEN. Kills an impl that early-returns terminal truth BEFORE the transport recheck (short-circuiting the authority check) |
| P-MCP | the MCP wait-verb post-dispatch recheck enumerates EXACTLY `['fleet_run_follow','fleet_run_wait']` (static `-F` anchor, `mcp-northbound.mjs:1510`), the typed `unauthenticated` code is preserved, and the `invalid_run_wait` ceiling (`:954-955`) stays — the renewal naming is wait-verb-scoped and additive-only, never a blanket all-tool rename |
| P-WEB | the web wait refusal keeps the typed 401/403 codes AND the `application_wait_timeout_exceeds_web_ceiling` token (`web-northbound.mjs:417`) — the renewal naming is additive on the code, never a code swap |
| P-CLI | the CLI `run view --until` / `run status --wait` delegate to the `run.wait` verb — `application-cli.mjs:1655` (the command table), `:1712` (the `run.status --wait` envelope forwarding `timeoutMs`), `:2030` (`serverWaitMs = args.timeoutMs` for the wait verbs) — with the anchors in line order. Kills an impl that patches the CLI dispatch with a CLI-local wait seam instead of the verbs |
| P-FORBIDDEN | the `forbidden` wait refusal (MCP + web legs, a principal missing `observe`) is the capability/repo-scope DEATH of the call — code `forbidden`/403 preserved, and `renewal.path` is NOT `/v1/auth/refresh` (the lifetime lane). At HEAD the bare `403 forbidden` is returned with no renewal → GREEN. Kills an impl that blanket-names `/v1/auth/refresh` on EVERY refusal |
| P-APP | the APPLICATION layer's `run.wait` deployment-policy refusal stays `application_unauthorized` with NO renewal field — renewal naming is a TRANSPORT-surface concern (A2-a/A3-a), never an application-command concern. Kills the transport-principal over-claim that moves the renewal into the application layer |
| A9 | the terminal/settled literal sets and the `WAITING_ON_KINDS` closed five stay byte-unchanged (actual order) — `'stopping'` is NEVER admitted to the waitingOn or terminal vocabulary |
| A10 | `run.wait`'s request-shape refusal stays `application_wait_invalid` for invalid `timeoutMs`/`until` (the refusal-table fold) |
| A4-pin | the #148 DRIVER LAW is documented in the friction ledger (`frontier-sweep-2026-08-03/orchestrator-friction-ledger.md:118`) — the typed refusal + renewal naming is what makes the stop actionable rather than a blind retry pump |
| P-PUBLISH | the shared-scratchpad publish lane (`run.scratchpad.append`, #158) is NOT landed at HEAD — the publish attempt refuses `application_command_unavailable`. The refusal IS the publish-as-you-go evidence (see §J3) |

## Design decisions made in the draft (beyond the contract's text)

1. **A1-a/A1-b use the verb's own timeout budget, with the SLEEP doubled — no wall-clock control.** The
   `run.wait` deadline is `Date.now() + timeoutMs` (`application.mjs:7989`) — a real contract budget, not a
   test control. The suite passes a small budget (30ms) and doubles `coordinator.wait` to an immediate
   resolve, so the RED observation is the wait CALL COUNT (`waitCalls() === 0`), not elapsed time. The
   fixture's fake clock (`mutableClock`) is used ONLY where the contract has a clock seam — the RA6/RA7
   lease-expiry legs (campaign law: fake timers as doubles, never as controls).

2. **The B1 static discriminator is the LITERAL source text after the last `while (`.** A per-cycle
   `status()` re-check runs `_authorize('run.status', …)` INSIDE `status()` — but the literal `run.wait`
   body only contains `this.status(...)`, never `this._authorize(...)`. The regex
   `/this\._authorize(?:RecursiveCommand)?\(/u` on the tail after the settle-block loop therefore matches
   ONLY a distinct lexical revalidation, and a wrong impl that keeps just the loop's internal re-check stays
   RED. The `srcAnchor` helper uses `grep -Fna` (fixed-string) because the MCP recheck anchor is a
   bracket-expression trap under BRE (verified: BRE fails to match the exact `['fleet_run_follow', ...]`
   text; `-F` matches).

3. **The A2-a/A3-a mid-wait revocation lands via a blocked-promise + `isPrincipalActive` toggle.** The
   fixture parks the dispatch with a promise, flips the transport's `isPrincipalActive` predicate, releases,
   and the RED assertion is on the RESULT envelope: the typed code is PRESERVED (`unauthenticated`, matching
   the landed CE5/MN pins) and the `renewal` field is absent at HEAD. A wrong impl that renames the code
   instead of adding the renewal fails the code-preservation assertion FIRST (a cleaner discrimination than
   asserting only the missing field).

4. **P-APP flips the deployment-policy authorize AFTER the run is live.** The fixture starts the run under
   the permissive policy (so `run.start` stays green), then reassigns `application.authorize` to refuse, and
   the refusal is observed on the wait verb alone. This keeps the application-layer refusal assertion on the
   exact seam (`authorizeReplay` maps `run.wait` to the read-only `'run.status'` command,
   `application.mjs:3432`) without breaking the run-start leg.

5. **A5's byte-identical check is on the serialized refusal envelopes, not just the code.** The FP-05 pin
   asserts `JSON.stringify(recursiveRefusal) === JSON.stringify(foreignRefusal)` — a wrong impl that keeps
   the code but adds a lease-dependent detail field fails the byte-equality, not merely the code check.

6. **The RA6/RA7 green legs reuse the phase77 invalidation idiom** (`waitInvalidationCases` × expired/
   revoked, the `invalidateRecipientWhenWaitWakes` patch of `coordination.waitAfter`). They pin the LANDED
   discipline the fold must not break; a landed impl that touches the lease-revalidation path regresses
   these green rows.

7. **A4 is a STATIC scan of the pump-loop region, not a behavioral test** — the wave-driver L4-L6
   poll/steer loop is un-drivable in a minimal fixture: it runs on the worker-orchestrated-swarm readiness/
   doctor gate (the design decision #4 of the wave suite), so no `createDriver`-level fixture can reach the
   auth-stop seam without the full orchestrated-swarm harness. The row pins the EXISTING region
   (`wave-driver.mjs:544-893` via `srcAnchor('wave-driver.mjs', '      for (;;) {')` + `srcRegion`) with a
   regex for an auth-stop guard / full-non-ok-envelope log — the #148 instance shape. At HEAD the region
   carries NEITHER (verified by grep), so the row is RED. A wrong impl that keeps blanket-swallowing the
   typed refusal at the driver layer fails this pin.

8. **A2-b/A3-b pin the renewal naming on BOTH wait verbs per transport.** A fold that names the renewal only
   on `fleet_run_wait` / `run_wait` leaves the sibling verb bare. The rows drive the IDENTICAL mid-wait
   revocation/expiry against `fleet_run_follow` / `run_follow`; they fail at the SAME stage as their sibling
   (the seam is shared — the MCP post-dispatch recheck for both verbs, the web `_postWaitAuthorization` for
   both), which keeps the stage distribution honest: 2× `mcp-refusal-renewal-missing`, 2×
   `web-refusal-renewal-missing`.

9. **D3.2 feeds the TERMINAL view + a dead principal through the SAME dispatch.** Both legs mock
   `application.command` to return the stopped-phase terminal view while `isPrincipalActive` is false; the
   assertion is that the typed refusal arrives and the terminal view does NOT — proving the transport's
   post-wait authority check is independent of the run truth. At HEAD the MCP recheck and web
   `_postWaitAuthorization` run after dispatch regardless of the dispatched value, so D3.2 is GREEN; the
   discriminator is an impl that early-returns terminal truth BEFORE the transport recheck (short-circuiting
   the authority check and letting a dead principal see terminal content).

10. **P-CLI is a line-ORDERED static pin; P-FORBIDDEN is a shape pin on the dead refusal.** The three CLI
    anchors (`:1655`, `:1712`, `:2030`) are asserted in ascending line order so a wrong impl that inserts a
    CLI-local wait seam (breaking the delegation chain) fails the ordering. P-FORBIDDEN drives the 
    `isPrincipalActive` toggle with a principal missing the `observe` capability and asserts BOTH the code
    preservation (`forbidden`/403) AND that no lifetime-refresh lane is claimed — the capability/repo-scope
    death is never a renewal (OQ3), so a blanket `/v1/auth/refresh` on every refusal is the wrong impl the
    row kills.

## Judgment calls (recorded)

- **J1 — `redteam-164.md` and `fold-164.md` are absent from the worktree.** The dispatch references them as
  attack-surface and fold-map documents. Verified absent at HEAD (`git ls-files` shows neither). Decision:
  the suite is written against the v1 DRAFT `blind-waits-contract.md` text + the v2 fold directives carried
  VERBATIM in the dispatch (the wait-local terminal-truth helper per DR-1(a) extended to the settle-block
  loop, the RA6/RA7 pins, the FP-05 pin, `application_wait_invalid` in the refusal table, the additive-only
  law). These directives are enumerated in the suite's first-five-line attempt-echo block.
- **J2 — the attempt-echo law has no definition in any foundry brief.** No brief, contract, or ledger line
  defines "attempt echo" beyond the dispatch's "echo the attempt ID and row id in the FIRST FIVE lines of
  both deliverables." Interpretation adopted: the attempt uuid (`08d0dac7-8ad0-4e7c-a13e-9d7a3bb855bc`) and
  row id (`row-suite-164`) appear in the first five lines of BOTH the test file and these notes. If a stricter
  reading was intended (e.g. byte-exact boilerplate), this is the divergence point.
- **J3 — publish-as-you-go: the `shared` scratchpad lane is not landed, so the REFUSAL is the evidence.** The
  foundry-brief publish-as-you-go law expects the member to publish notes to the `shared` scratchpad
  partition as it works. Verified that `run.scratchpad.append` (the #158 publish verb) is NOT in the
  `application.mjs` command table at HEAD — the only scratchpad direct ports are `run.scratchpad.read` and
  `run.scratchpad.elevate`. The P-PUBLISH row drives the publish attempt and asserts the
  `application_command_unavailable` refusal. A failed publish is evidence — this refusal is recorded here as
  that evidence, per the mid-turn UNTRUSTED dispatch instruction.
- **J4 — authority-class ambiguity resolved as judgment calls, not DECISION_REQUEST.** The dispatch's
  escalation posture (authority-class ambiguity → DECISION_REQUEST with 2-4 options) was invoked once: the
  `redteam-164.md`/`fold-164.md` absence (J1) sits on the line between "missing input file" and "contract
  ambiguity." Resolution: recorded as a judgment call rather than a DECISION_REQUEST because the v2 fold
  directives are carried verbatim in the dispatch itself — the missing files add attack-surface context but
  do not change the acceptance pins the dispatch enumerates.

## Hermeticity & hygiene

- Real `createDriver` stack over a `MockAdapter` (scenario `{outcome:'completed', delayMs:25}`), mkdtemp
  repo + log dirs, git init/commit, and `rmSync` inside `t.after` — no network, no real provider spawns, no
  real sleeps (the `coordinator.wait` sleep is doubled to an immediate resolve in every row that enters the
  loop; the fixture's `mutableClock` supplies fake time for the lease-expiry legs).
- NUL-byte discipline: the NUL-carrying `application.mjs` / `coordination-store.mjs` are imported (fine) but
  never whole-file-read; every static source pin uses `execFileSync('/usr/bin/grep', ['-Fna', ...])` or
  `sed -n` (the `srcAnchor` / `srcRegion` helpers). `-F` fixed-string is deliberate: the MCP recheck anchor
  is a bracket-expression trap under BRE (verified empirically — BRE fails the exact
  `['fleet_run_follow', 'fleet_run_wait']` text; `-F` matches at `mcp-northbound.mjs:1510`).
- The three static pins (B1 `run.wait` body, A4 wave-driver pump-loop region, P-CLI CLI delegation) are
  PURE source reads — no runtime fixture, no driver, no clock. They are hermetic by construction: the 
  assertion is the absence/presence of literal text in the EXISTING source at HEAD.
- No clocks as controls: the `run.wait` timeout budget is the verb's own contract budget (small 30ms for the
  RED legs, 100ms for the mid-wait flip), never a test throttle; lease expiry is driven by the fake clock,
  never real time.
- `localeCompare` banned; sorted-key literals appear in ACTUAL order (A9 pins the closed phase sets and
  `WAITING_ON_KINDS` in actual order).

## Deployment verification

The execution contract (direct executable `"true"`, empty argv, cwd `.`, expected exit 0) passes trivially
and is unchanged by this suite — this is the red-first acceptance for the fold's implementation, not the
deployment gate. A reviewer enforces the deployment contract separately. Run the suite with:

```sh
node --test impl/test/blind-waits-red.test.mjs
```

Expected at this draft at HEAD `e371f70`: **tests 31 · pass 23 · fail 8 — measured TWICE, identical sets**
(run e1 and run e2 both measured pass 23 / fail 8; the pass set is the fifteen GREEN rows — A5, A1-c, A8,
A6, A7, D3.2, P-MCP, P-WEB, P-CLI, P-FORBIDDEN, P-APP, A9, A10, A4-pin, P-PUBLISH — and the fail set is the
eight RED rows at their named stages: A1-a `terminal-truth-predicate-missing`, A1-b
`settle-block-durable-stop-missing`, A2-a AND A2-b `mcp-refusal-renewal-missing` (both MCP wait verbs),
A3-a AND A3-b `web-refusal-renewal-missing` (both web wait verbs), B1 `return-seam-revalidation-missing`,
A4 `driver-stop-on-repeated-auth-missing`). The named stages are the seam closures the #164 v2 fold must
land: the wait-local terminal-truth predicate in BOTH `run.wait` loops (DR-1(a)), the transport renewal
naming on BOTH wait verbs per MCP/web (D1.2/G7/G8), the distinct return-seam revalidation (D2(b)), and the
driver-layer stop-on-repeated-auth guard (the #148 instance shape).
