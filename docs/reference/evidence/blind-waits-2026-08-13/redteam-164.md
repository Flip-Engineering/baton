# #164 RED-TEAM — adversarial attack on the blind-waits contract v1

Adversarial red-team of `docs/reference/evidence/blind-waits-2026-08-13/blind-waits-contract.md`
(the wait/poll fail-loud contract for issue #164), per the shared frame (`foundry-brief.md`):
citation law (every anchor re-verified THIS session at the current HEAD with `grep -an`/`sed -n`;
wrong citation = automatic blocker), no clocks as controls, per-decision verdicts SOUND/HOLE with
numbered findings, pins judged for shallow-greenability, open questions verdict'd, final
FOLD-READY or NOT with numbered blockers.

- **Date:** 2026-08-13
- **Verification HEAD:** `e371f70` ("Baton private effective-tree snapshot") — the worktree HEAD
  for this review. The target's stated HEAD was `02e60a399cfcf4a08109087086b78d561f6e0c0e`; the
  delta `02e60a3..e371f70` touches only `impl/baton-0.1.0.tgz`, `workflow-interpreter.mjs` (adds
  `code: 'harvest_ok'`, unrelated), and `workflow-as-data-red.test.mjs` — **none of the contract's
  cited files moved**. All anchors below were re-verified at `e371f70`.
- **NUL discipline:** `application.mjs` and `coordination-store.mjs` each carry 3 NUL bytes
  (`tr -cd '\000' | wc -c` authoritative); all anchors in those two files were verified with
  `grep -an` / `sed -n`, never a whole-file read. The other files (`web-northbound.mjs`,
  `mcp-northbound.mjs`, `application-cli.mjs`, `application-semantics.mjs`, `coordinator.mjs`,
  `phase77-recursive-application-red.test.mjs`, `phase16-mcp-northbound.test.mjs`) are NUL-free
  and were read directly.

---

## Citation re-verification

Every `file:line` anchor in the target was re-verified at `e371f70`. **No wrong citation found —
no automatic blocker.** The anchors split into:

**Verified exact (the load-bearing citations):**

| Target cite | Verified at HEAD | Notes |
|---|---|---|
| `application.mjs:7979-8022` (run.wait) | `7979-8022` present; loop + `coordinator.wait` + `status()` re-read confirmed; `application_wait_invalid` throw at `7989` | exact |
| `application.mjs:4795-4804` (status) | `async status(runId…)` at `4795`; `_authorizeRecursiveCommand('run.status'…)` at `4802` | exact |
| `application.mjs:156-161` (phase sets) | `PROVIDER_EXECUTION_SETTLED_PHASES` at `157`; `APPLICATION_RUN_TERMINAL_PHASES` at `160` | exact |
| `application.mjs:7598` (G3 phase logic) | `if (runStop?.status === 'stopped') phase = 'stopped'; else if (runStop) phase = 'stopping';` at `7598-7600` | exact (line 5767 is a *different* view — the outline; the run-view anchor at 7598 is right) |
| `application.mjs:8362-8363` (run.follow return seam) | `_authorizeRecursiveCommand('run.status'…)` at `8362`; `_authorize('run.follow'…)` at `8363` | exact |
| `application.mjs:10926-11040` (run.inspect continuation) | continuation confirmed; `_authorizeRecursiveCommand` at `11011`/`11030`; `_authorize('run.status'…)` at `11015` | exact |
| `application.mjs:10051-10073` (`_semanticEnvelope`) | present | exact |
| `application.mjs:7649`, `:7963` (`terminalCause`) | `projectTypedTerminalCause({terminalResult: result, runStop, …})` at `7648`; `terminalCause` in the run.wait view at `7963` | exact |
| `application.mjs:3486` (`_findRun` throw) | `throw applicationError('unknown run …', 'application_run_not_found')` at `3486` | exact |
| `application.mjs:3222` (`application_unauthorized`) | throw at `3222` (inside `_authorize`, which starts at `3214`) | exact |
| `application.mjs:406-498` (projectWaitingOn) | present | exact |
| `coordination-store.mjs:8880-8918` (waitAfter) | `waitAfter(afterSeq, timeoutMs, options)` at `8880` | exact |
| `coordinator.mjs:12054` (blind coordinator.wait) | `async wait(timeoutMs = 25000)` at `12054` | exact |
| `mcp-northbound.mjs:1505-1520` (post-dispatch recheck) | recheck at `1510` | exact |
| `mcp-northbound.mjs:1325-1335` (`_authority`) | present | exact |
| `mcp-northbound.mjs:198-200` (toolError) | `function toolError(code, message, detail)` at `198` | exact |
| `mcp-northbound.mjs:389` / `:386` (fleet_run_wait/follow) | tools at `389` / `386`; `fleet_run_wait` schema carries **no `until` field** | exact |
| `mcp-northbound.mjs:954-955` (`invalid_run_wait`) | `return 'invalid_run_wait'` at `954-955` | exact |
| `web-northbound.mjs:684-689` (`_postWaitAuthorization`) | `_postWaitAuthorization(ctx, envelope)` at `684`; `return this._authenticate(ctx) ?? this._authorize(ctx, envelope)` at `688` | exact |
| `web-northbound.mjs:746`/`:895`/`:971` (seams) | `_postWaitAuthorization(ctx, envelope)` applied at all three | exact |
| `web-northbound.mjs:629-647` (`_authenticate`) | `_authenticate(ctx)` at `629` | exact |
| `web-northbound.mjs:166` (AUTH_PATHS) | `new Set(['/v1/auth/login', '/v1/auth/refresh', '/v1/auth/logout'])` at `166` | exact |
| `web-northbound.mjs:417` (30 s ceiling) | `envelope.args.timeoutMs > 30_000` → `application_wait_timeout_exceeds_web_ceiling` at `417` | exact |
| `application-cli.mjs:1646-1656` (run view --until) | `run view --until settled\|terminal` → `run.wait` at `1646-1656` | exact |
| `application-cli.mjs:1712` (run status --wait) | present | exact |
| `application-cli.mjs:2028-2035` (`_requestTimeoutForCommand`) | starts at `2028` | exact |
| `application-semantics.mjs:94-116` (canonical predicates) | present | exact |
| `application-semantics.mjs:60-62` (WAITING_ON_KINDS) | present | exact |
| `phase77-recursive-application-red.test.mjs:394-467` | fixture at `370`; RA6 test at `394`; RA7 test at `436-467` | RA7 span cite `425-467` starts ~11 lines early (the RA6 tail); nit |
| `phase77-recursive-application-red.test.mjs:370-392` (fixture) | `function invalidateRecipientWhenWaitWakes(…)` at `370`; `waitInvalidationCases` at `349` | exact |
| `phase16-mcp-northbound.test.mjs:239-253` | `fleet_run_wait` admission at `201`; `unauthenticated` assertion at `247` | assertion inside the cited range; the test *starts* at 201 — the contract's range is the assertion block, acceptable |
| `orchestrator-friction-ledger.md:118` | Appendix D row 2 = the #148 credential instance | exact |

**Minor per-line nits (in-range, no wrong citation):**

1. **Refusal-table lease lines swapped.** The table cites `run_orchestrator_lease_expired` →
   `coordination-store.mjs:1834` and `run_orchestrator_lease_revoked` → `:1835`. At HEAD the
   *revoked* check is `:1834` and the *expired* check is `:1835` (`if (lease.status === 'revoked')
   … 'run_orchestrator_lease_revoked'` at 1834; `Date.parse(now) >= Date.parse(lease.expiresAt)
   … 'run_orchestrator_lease_expired'` at 1835). Both codes exist; the line mapping is swapped.
2. **MCP `unauthenticated`/`forbidden` lines.** Table cites `mcp-northbound.mjs:1334`
   (`unauthenticated`) / `:1333` (`forbidden`). `_authority` spans 1325-1335; the returns sit
   within it (`unauthenticated` at ~1328-1333, `forbidden` at ~1331-1332). In-range, off by a
   couple of lines.
3. **Web `forbidden` line.** Table cites `web-northbound.mjs:675`; `_authorize` starts at `665`
   (contract's `_authorize` cite in D1.2 says `web-northbound.mjs:629-683`, which spans
   `_authenticate`+`_authorize` — the `403 forbidden` return is at ~676). In-range.
4. **phase77 RA7 span** (`425-467` vs actual test `436-467`) — nit (see above).

**Method note:** the target's "Verification HEAD `02e60a3`" differs from the review HEAD
`e371f70`; the delta is verified irrelevant to every cited file (see header). No anchor moved.

---

## D1 — the fail-loud law → **HOLE** (H-1; the law as written is not delivered on the
transport-principal leg)

The core law is directionally right and its terminal-truth leg is already delivered by the
`status()`-per-cycle loop for the *literal* terminal set (a run whose phase enters
`APPLICATION_RUN_TERMINAL_PHASES` mid-wait returns on the next ≤100 ms cycle — verified). But the
"dead authority" leg over-claims for the **transport principal**, and that is exactly the leg the
#148 instance burned.

- **H-1 (blocking) — "the moment any authority check fails" (D1.2) and "never the full clock"
  (D1.3) are NOT delivered for the transport-principal leg at any surface.** The three
  transport-principal checks the contract cites are all *post-wait* surface checks, never
  per-cycle, and the application layer the wait verbs sleep in has no transport principal at all:
  - MCP: the post-dispatch recheck (`mcp-northbound.mjs:1510`) fires **once, after** `_dispatch`
    returns. `fleet_run_wait` dispatches into application `run.wait` (verified via the
    phase16 admission mapping `fleet_run_wait → run.wait`), which sleeps on the **blind**
    `coordinator.wait()` (`coordinator.mjs:12054`). A session that expires mid-wait is observed
    only when the dispatched wait returns — up to `maxWaitMs` (`mcp-northbound.mjs:1261`,
    default `25_000` ms). The contract's D2 MCP row says "Keep the post-dispatch recheck" — it
    *preserves* the post-wait-only shape; it does not add per-cycle transport rechecking.
  - Web: `_postWaitAuthorization` (`web-northbound.mjs:684-689`) is applied at the three dispatch
    seams (`:746`/`:895`/`:971`) — post-wait only. A mid-wait session expiry burns up to the 30 s
    ceiling (`web-northbound.mjs:417`) before the 401 surfaces.
  - CLI: `run view --until`/`run status --wait` delegate to `run.wait` with **no surface layer
    after dispatch at all** (the CLI row itself says "No new seam of its own"). The application
    wait ceiling is `timeoutMs > 24 * 60 * 60 * 1000` (`application.mjs:7989`), so a CLI
    `run wait --timeout` of up to 24 h against an expired local credential (the exact #148 shape,
    `orchestrator-friction-ledger.md:118`) burns the full requested clock with no recheck. The
    #148 observed instance is the CLI/local-surface class, and this contract does not fix it.
  - **Why the application layer cannot close the gap:** the per-cycle re-check run.wait does
    perform via `status()` (`application.mjs:4802`) is
    `_authorizeRecursiveCommand` (recursive lease) + `_authorize`
    (`application.mjs:3214-3215`, which delegates to the deployment-policy `this.authorize(...)`
    — it does **not** check transport-session expiry). The transport principal lives only at the
    surface; no seam in the contract threads a session fence into the application wait loop.
  - **Fix:** either (a) the contract must scope D1.2/D3.2 honestly: per-cycle re-check covers the
    recursive lease + deployment policy (which the `status()` loop *does* deliver); transport-
    principal expiry is a post-wait surface check and burns the full wait clock — and then D1.3's
    "never the full clock" must be restated to exclude the transport-principal leg; or (b) the
    contract must specify an abortable surface-side wait that breaks on transport-principal
    invalidation (a session-fence threaded into the wait — a real design, not a naming change),
    and pin each surface's behavior. As written, D3.2's "when any of them flips mid-wait … it does
    not keep sleeping" is false for the transport principal, and A2/A3 cannot catch it (below).

---

## D2 — the per-verb seam map → **HOLE** (H-2, H-3, H-4)

- **H-2 (blocking) — `run.episode` and `run.workstreams` are wait-capable verbs omitted from the
  seam map AND from the MCP post-dispatch recheck list.** Both carry `waitMs` on every surface
  (`application.mjs:178-179`: `args` include `waitMs`, `web: true, mcp: true`; MCP tools
  `fleet_run_episode` at `mcp-northbound.mjs:394` and `fleet_run_workstreams` at `:395` both
  expose `waitMs`) and route through `run.inspect`'s continuation machinery (the change-aware
  wait path, `application.mjs:11275-11393`). The seam map lists run.wait, run.inspect
  continuation, run.follow, MCP fleet_run_wait/follow, web run_wait/run_follow, CLI, driver — but
  not episode/workstreams. And the MCP post-dispatch transport recheck
  (`mcp-northbound.mjs:1510`) covers only `['fleet_run_follow', 'fleet_run_wait']`, so a mid-wait
  MCP session expiry on `fleet_run_episode`/`fleet_run_workstreams` is not even caught
  *post-dispatch*. The scope sentence ("every wait/poll verb") promises them; the seam map and the
  transport recheck omit them. **Fix:** add the two verbs to the D2 map (they already execute the
  RA6 shape inside the inspect continuation — pin them) and to the MCP post-dispatch recheck list
  (or state explicitly why the transport-principal leg does not apply to them).
- **H-3 (non-blocking) — the web `run_watch` transport is not listed in the seam map.** It
  resolves to `run.follow` and inherits its seams, so behavior is covered, but the map claims to
  be exhaustive ("Each row names the verb"). Name it or note the resolution.
- **H-4 (non-blocking) — D2's run.wait row (b), "return-seam revalidation … re-run the
  recursive-lease + deployment-policy + (surface-side) principal checks that status() already
  runs," is redundant AND layer-confused.** The loop always ends with a fresh `status()` — every
  iteration, including the exit iteration, re-reads `view = await this.status(...)`
  (`application.mjs:7979-8022`), so the last wait's revocation is caught by the *following*
  `status()`, and the value returned is that fresh status product. A distinct return-seam
  revalidation re-runs exactly what `status()` just ran — there is no post-wait-before-projection
  gap in `run.wait` of the RA6/RA7 kind. And "(surface-side) principal checks" do not belong at
  the application layer: the application has no transport principal; the surface-side checks are
  precisely the MCP/web post-wait rechecks already specified in their own rows (G7/G8). **Fix:**
  delete (b), keep (a) the terminal-truth predicate (see D3.1/H-5) and (c) the change-aware wait
  (OQ1). The honest "seam" for transport-principal revalidation is the surface post-wait check,
  which the MCP/web rows already specify.
- **PIN rows verified SOUND:** run.inspect (G5/RA6), run.follow (G6/RA7), MCP keep-recheck, web
  keep-reauth, CLI delegation, driver-law row. The `invalid_run_wait`/web-ceiling pins verify
  exact. The MCP "no `until` field" statement verifies exact.

---

## D3 — the honesty edge cases → **HOLE** (H-5, H-1 applies; H-6)

- **H-5 (blocking) — G3's mechanism is mechanically WRONG, and A1 as written describes an
  impossible state.** G3 states: "The view phase for a run whose **stop receipt is durable** but
  not yet reaped reads **`stopping`**." The runStop lifecycle contradicts this:
  - admission: `coordination-store.mjs:8651` mints the runStop with `status: 'stopping'`, and
    **no receipt** (receipt is null);
  - completion: `coordination-store.mjs:8727` flips it to `status: 'stopped'`, **atomically
    attaching `receipt`**.
  - the phase logic (`application.mjs:7598-7600`): `if (runStop?.status === 'stopped') phase =
    'stopped'; else if (runStop) phase = 'stopping';`.
  Therefore a run whose **receipt is durable** reads `'stopped'` — which IS in
  `APPLICATION_RUN_TERMINAL_PHASES` (`application.mjs:160`) — and `run.wait` exits immediately. A
  run reads `'stopping'` only while the stop is **admitted but the completion/receipt ceremony has
  not minted** — i.e. the durable *admission* exists and the durable *receipt* does not. G3
  conflates the two ("stop receipt is durable" vs "not yet reaped"); the reap is irrelevant to the
  phase. **The real bug the contract is after is real, and its honest statement is:** a run whose
  stop was *admitted* (durable, irreversible — new effects refuse `run_stopping`,
  `coordination-store.mjs:2842`/`:4420`/`:4453`; its authority is closed; its `terminalCause` is
  projected via `projectTypedTerminalCause({…, runStop, …})`, `application.mjs:7648`) but whose
  completion ceremony has not finished reads `'stopping'`, which is in NEITHER literal set, so
  `run.wait(until:'terminal')` loops to the deadline. That is the actual gap.
  **Consequences:** G3's sentence, D3.1(b)'s "stop receipt is durable", and A1's parenthetical
  ("phase reads `stopping`" tied to "stop receipt is durable") all describe a state that cannot
  occur. A fixture written to the letter of A1 is unbuildable (you cannot have a durable receipt
  AND a `'stopping'` phase). The *observable state the pin intends* — phase `'stopping'`, stop
  admitted, completion never mints — IS testable, but the pin must be reworded to that state.
  **Fix:** rewrite G3/D3.1/A1 to the admission mechanism (runStop present with status `'stopping'`,
  no receipt; authority closed; cause projected), and make the wait-local terminal-truth predicate
  (OQ2) consult *that* state. The contract must also decide the predicate's breadth (see OQ2
  verdict): treating ANY admitted stop as terminal-truth returns immediately even while the
  completion ceremony is legitimately in progress — defensible, but it is a semantic change to
  what `until: 'terminal'` means and must be pinned explicitly.
- **H-6 (non-blocking) — `application_wait_invalid` is missing from the refusal vocabulary.** The
  application-layer wait-request refusal (`application.mjs:7989`, timeout past the 24 h
  application ceiling / bad `until`) is a sibling of `invalid_run_wait` and
  `application_wait_timeout_exceeds_web_ceiling`, both of which the table lists. A reader
  implementing the table would miss one of the three request-shape refusals the fail-loud rung
  can emit. Add it (the CLI surface surfaces it verbatim).
- **D3.1's direction and D3.3 verified SOUND** (D3.3's FP-05 ordering is exact at
  `application.mjs:4799-4803` — `_findRun` before `_authorize` — and `application_run_not_found`
  is thrown at `3486`; unknown ≠ dead-authority preserved).

---

## Refusal vocabulary → **HOLE** (H-6 above; H-7)

- **H-7 (blocking for the pins) — the MCP surface code mapping is not stated, so the refusal
  vocabulary and A5 are ambiguous at the MCP surface.** `stateFailureCode`
  (`mcp-northbound.mjs:201-204`) maps `application_unauthorized` → `'forbidden'` and
  `application_run_not_found` → `'not_found'` for MCP tool errors. The contract's table lists the
  *kernel* codes (`application_unauthorized`, `application_run_not_found`, `unauthenticated`,
  `forbidden`) but does not note which surface emits which. A5 (GREEN) asserts
  `application_run_not_found` "for every wait verb" — at the MCP surface the emitted code is
  `'not_found'`; at the application/CLI surface it is `application_run_not_found`. A pin that
  doesn't state the surface is greenable by either surface and asserted against the wrong string.
  **Fix:** add a surface-mapping row/note (kernel → MCP `stateFailureCode`), and state A5's
  surface (recommend: assert the kernel code at the application layer and `'not_found'` at the
  MCP surface, mirroring the phase16 `unauthenticated` pin's approach).
- The lease-code lines swap (nit 1) should be corrected for precision but is not a blocker.

---

## Red-first acceptance pins

| Pin | Verdict | Notes |
|---|---|---|
| **A1** (RED, run.wait on a durably-stopped run burns the clock) | **HOLE — as written unbuildable.** | H-5: "stop receipt durable" → phase `'stopped'` → terminal; the state the pin describes cannot occur. The *intended* state (admitted stop, status `'stopping'`, completion never mints) is testable and is the real RED. Reword to that state. Also: the pin is greenable by the wrong mechanism — adding `'stopping'` to `APPLICATION_RUN_TERMINAL_PHASES` (a one-line edit) flips it while violating A9. The pin must name the wait-local-predicate mechanism (OQ2(a)) so a shallow literal-set edit doesn't pass. |
| **A2** (RED, MCP code-only bodies) | **SOUND but incomplete — doesn't test promptness.** | The renewal-naming addition is real and the phase16 `unauthenticated` pin is preserved. But A2 asserts only the *shape* of the post-wait refusal. A mid-wait session expiry that burns the full `maxWaitMs` (25 s) and *then* refuses with a renewal path still passes A2. The D1.3 "never the full clock" claim for the transport principal (H-1) is therefore not pinned anywhere. |
| **A3** (RED, web 401 names no renewal) | **SOUND but incomplete — same promptness gap.** | The `/v1/auth/refresh` naming is a real RED. Same as A2: a 30 s burn then a named renewal still passes. |
| **A4** (RED, driver loop retries blind) | **SHALLOW-GREENABLE / scope mismatch.** | A4 restates the #148 driver law (already in the ledger, G1) as a #164 acceptance. It can be made green by a *faked client test* with zero server change — there is no #164 server obligation it gates. If it is a #164 pin, it needs a #164 server-side counterpart (e.g. the typed refusal *shape* that makes the stop actionable — which is A2/A3's job); otherwise it belongs to the #148 rung, not here. |
| **A5** (GREEN, unknown id byte-identical) | **SOUND at the application layer; ambiguous at the MCP surface.** | H-7: the MCP surface emits `'not_found'` (`stateFailureCode`), not `application_run_not_found`. State the surface. |
| **A6** (GREEN, RA6 inspect) | **SOUND — verified.** | `phase77:394-420`, refusal codes `run_orchestrator_lease_expired`/`_revoked` (coordination-store `1835`/`1834` — mind the swap in the table), `projectedAfterWait === false`. |
| **A7** (GREEN, RA7 follow) | **SOUND — verified.** | `phase77:436-467`, return-seam revalidation at `application.mjs:8362-8363`. |
| **A8** (GREEN, terminal view carries waitingOn:null + terminalCause) | **SOUND — verified.** | `projectWaitingOn` returns null on terminal; `terminalCause` projected (`application.mjs:7648`); canonical predicates own the vocabulary. |
| **A9** (GREEN, literal sets unchanged) | **SOUND — but in tension with A1's green mechanism.** | Additive-only is right; A1 must name the wait-local predicate so A1's green can't be achieved by editing the literal set (which A9 would then contradict). |
| **A10** (GREEN, ceilings stay) | **SOUND — verified.** | `mcp-northbound.mjs:954-955`, `web-northbound.mjs:417`. |

---

## Open questions — verdicts

- **OQ1 (waitAfter vs abortable sleep):** SOUND framing. Adopting `waitAfter` with the run cursor
  as `afterSeq` is the right mechanism — bounded, change-aware, and it makes the terminal-truth
  leg honest. Note `waitAfter` wakes on ANY event advance, not only terminalization/revocation, so
  each wake re-runs `status()` — correct, just not free; that is a cost, not a defect, and no new
  clock is introduced (the existing deadline stays the budget). H-1 is NOT fixed by OQ1: `waitAfter`
  wakes on store events, not on transport-principal expiry (the store doesn't know the surface
  session).
- **OQ2 (terminal-truth predicate):** the G3 correction (H-5) forces this resolution. Recommend
  (a) — treat an **admitted** stop (`runStop` present, status `'stopping'`) as terminal-truth for
  *wait* purposes, returning the honest phase `'stopping'` + `terminalCause` + `stop` state — and
  do NOT amend the closed vocabulary (reject (b), which needs #10/#74 sign-off for a worse
  outcome). Reject (c): a stopping run is not *waiting*; the waitingOn spine is the wrong surface.
  The contract must pin the predicate's breadth explicitly (any admitted stop, even mid-completion-
  ceremony, returns immediately) so the implementer can't pick a narrower/different reading.
- **OQ3 (renewal shape):** SOUND. A stable `renewal: { path | verb | seat }` that adapts to which
  authority died is the right shape. Must also carry the MCP surface codes (H-7) and the #148
  verb-if-present without breaking on its absence.
- **OQ4 (driver-law helper):** SOUND to leave per-driver. But then A4 does not belong as a #164
  acceptance pin (see A4).
- **OQ5 (fleet_run_wait until field):** SOUND to leave settle-block-only this rung; the fail-loud
  law applies to the settle-block regardless, and D1/D3.1's predicate fix lands whether or not a
  terminal selector exists.

---

## Cross-references — verified

The contract's cross-references all resolve and say what the contract claims (the scratchpad-write
form, the #10 waiting-on vocabulary, FP-05 at `facade-projection-contract.md:1227`,
`orchestrator-friction-ledger.md:118`, the phase77/phase16 pins, waitAfter/coordinator.wait/lease
codes). One precision note: the lease-code line mapping in the cross-reference (1834-1835) carries
the same swap as the refusal table (nit 1).

---

## Final verdict: **NOT FOLD-READY**

Numbered blockers (what + why + concrete fix):

1. **D3.2/D1.2 over-claim the per-cycle transport-principal recheck; the "never the full clock"
   law is not delivered for the transport-principal leg.** Every cited transport check is
   post-wait/post-dispatch (MCP `mcp-northbound.mjs:1510`, web `web-northbound.mjs:684-689` at
   seams `746/895/971`) or absent (CLI has no surface after dispatch). A mid-wait session expiry
   burns up to `maxWaitMs` 25 s (MCP), 30 s (web), or up to 24 h on a CLI `run wait` against the
   application ceiling (`application.mjs:7989`) — the exact #148 instance class
   (`orchestrator-friction-ledger.md:118`). The application layer cannot close it: `_authorize`
   (`application.mjs:3214-3215`) checks only the deployment policy, and the per-cycle `status()`
   loop re-checks lease + policy, not the surface session. **Fix:** scope D1.2/D3.2 to the
   recursive-lease + deployment-policy legs (which the loop does deliver) and state plainly that
   transport-principal expiry is a post-wait surface check that burns the clock — or add an
   abortable surface-side session-fence wait and pin each surface. Either way the current wording
   is false.
2. **G3's mechanism is wrong and A1 is unbuildable as written.** A durable stop *receipt* reads
   `'stopped'` (terminal) — `coordination-store.mjs:8651` (admission, no receipt) vs `:8727`
   (completion, receipt attached) drive `application.mjs:7598-7600`. The real gap is the
   *admitted-but-uncompleted* stop (status `'stopping'`, no receipt, authority closed, cause
   projected) missing from both literal sets. **Fix:** reword G3/D3.1/A1 to the admission
   mechanism and pin the wait-local predicate's breadth (OQ2(a)).
3. **`run.episode`/`run.workstreams` omitted from the seam map AND from the MCP post-dispatch
   recheck.** They are wait-capable on every surface (`application.mjs:178-179`; MCP
   `mcp-northbound.mjs:394-395`) and route through the inspect continuation. **Fix:** add them to
   D2 (pin the RA6 shape they already run) and to the MCP recheck list.
4. **Refusal vocabulary omits `application_wait_invalid` and does not state the MCP surface code
   mapping** (`stateFailureCode`: `application_unauthorized` → `'forbidden'`,
   `application_run_not_found` → `'not_found'`, `mcp-northbound.mjs:201-204`), which makes A5's
   asserted code ambiguous at the MCP surface. **Fix:** add the row and a surface-mapping note;
   state A5's surface.
5. **A4 is a #148 client-side acceptance with no #164 server mechanism** — greenable by a faked
   client test. **Fix:** either drop A4 from the #164 pin set (the driver law already lives in the
   ledger) or give it a #164 server-side counterpart it gates.

Non-blocking (fold in, don't block): D2 run.wait (b) return-seam revalidation is redundant and
layer-confused (H-4); web `run_watch` not named in the seam map (H-3); D3.1 predicate over-breadth
must be pinned (OQ2); refusal-table per-line nits (lease codes 1834/1835 swapped, MCP `_authority`
lines, web `_authorize` start, phase77 RA7 span); A2/A3 do not pin promptness.

**Process note (publish mechanism):** the shared-foundry-brief's publish rule ("post the full text
to the `shared` scratchpad partition; scope `shared`, kind `note`") is not satisfiable at the
current HEAD by a row member: the only worker-facing scratchpad write is the emulated up-channel
(`SCRATCHPAD_WRITE:` frame → `writeScratchpad`), and the store hardcodes the worker scope
(`const scope = 'worker:' + fields.workerId`, `coordination-store.mjs`), with no `run.scratchpad
.append`/`baton_run_scratchpad_append` verb landed (the #158 contract is not yet implemented).
Elevation to `shared` is orchestrator-side (`scratchpad.elevate`, kernel profile). I have
published this report to my worker partition via the up-channel as the best available worker-facing
write, and recorded the gap.
