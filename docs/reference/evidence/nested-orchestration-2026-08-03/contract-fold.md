# Fold Summary — nested-orchestration contract v1.0 → v1.1 (2026-08-06)

Fold of the adversarial red-team review `contract-redteam.md` (this directory; verdict **NOT
FOLD-READY**, five blockers) into `nested-orchestration-contract.md` (this directory). Fold
performed at HEAD `a421062`; `git diff cfa4f3b..HEAD -- impl/` is empty, so the contract's
verification frame holds byte-identical and every new citation below was re-derived against the
live tree this session (NUL-bearing files via `grep -an` / `sed -n` only).

## Blocker → change map

### BLOCKER 1 (report HOLE-1): `run.stop` unreachable for the `['observe','control']` child

The transport enforces the registry-derived class unconditionally at `_authorize`
(`web-northbound.mjs:625-629`) before the gate; `run.stop` declares
`['emergency_stop','observe']` (`application.mjs:173`). NP-02 was ungreenable.

**Amendment (Decision 6, "The v1.1 transport carve-out"):** a lease-scoped transport carve-out —
`run.stop` from a principal lacking `emergency_stop` is admitted under `control` IFF (i) the
server-derived `sessionAuthority` resolves a live lease (the derivation the live path already
performs, `web-northbound.mjs:977-983`) and (ii) the store's own scope law accepts the target
(`authorizeRunOrchestratorCommand`, `coordination-store.mjs:2035-2058`; first-hop lineage carries
THIS lease's id, `:2046-2054`). Any failure falls through to the standard enforcement — the
byte-identical 403 `forbidden` (shape at `web-northbound.mjs:148`). The admitted command is
re-checked by the store on the command path (`application.mjs:12877`): the carve-out admits, the
lease remains the authority. Also touched: Decision 1's capability bullet now names the
carve-out; the refusal-table 403 row carries the carve-out disposition.

- Refusal codes: NO new code. Non-lease `control` principal → 403 `forbidden` byte-identical;
  foreign target → the same bytes; unknown target → the same bytes (unknown ≡ foreign, no
  existence leak); the store's `run_orchestrator_scope_forbidden` remains the second layer.
- Acceptance rows (NP-02 rewritten; NP-07(f) added): child stops its own lease child → allowed;
  child stops a foreign run → byte-identical 403; child stops an unknown runId → same bytes;
  non-lease `['observe','control']` principal → same 403 as pre-rung. NP-02 now also pins that
  the child drives the REAL socket transport (server-derived `sessionAuthority`,
  `web-northbound.mjs:977-983`), never `application.command` with a hand-built context (the
  report's §8 NP-01 caveat).
- Report options disposition: (a) the carve-out — ADOPTED; (b) dropping `run.stop` — rejected
  (the report itself rules it dishonest for #74: a lead that can only reap children by dying is
  not a coordinator); (c) granting `emergency_stop` — rejected (admits `kill`/`drain` on every
  worker, `web-northbound.mjs:54`).

### BLOCKER 2 (report HOLE-2): the legacy transport operator set over-admits the child

The `control` class admits `spawn`/`send`/`interrupt`/`capability_invoke`/`reuse_*`/
`scratch_oracle` raw over the socket with no lease/lineage bounds — unbounded fan-out
(`coordinator.spawn` `coordinator.mjs:4178`, guards `:4183-4220` carry no run/lease/principal
check) and cross-run injection (`FENCE_REQUIRED` `:60` is no barrier; the fence is readable via
`list` = observe `:55`/`:1041-1042`, the same projection `steer()` reads `target.fence` from,
`application.mjs:12849-12851`).

**Amendment (Decision 6, "The v1.1 legacy-command refusal"):** a `worker:`-prefixed principal is
REFUSED the legacy operator set with the typed 403 **`worker_legacy_command_forbidden`** — the
rung's ONE new refusal code — by one rule at the `_authorize` seam, keying on the deployment's
stated posture (`principalId.startsWith('worker:')`, `application-deployment.mjs:2007`).
Fail-closed; never emitted for the owner (byte-stable, NP-07(e)).

- Refused set, per family (classes from `COMMAND_CAPABILITY`, `web-northbound.mjs:53-60`;
  dispatch `:1003-1052`): SPAWN — `spawn` (`:54`, dispatch `:1003-1015`), `scratch_oracle`
  (`:54`, `:1024-1030`); MESSAGE — `send` (`:54`, `:1031-1032`), `interrupt` (`:54`,
  `:1033-1034`); EMERGENCY — `kill`, `drain` (`:54`); RESPOND — `respond` (`:54`); CAPABILITY —
  `capability_invoke`, `reuse_decide`, `reuse_recheck` (`:55`).
- Remains admitted: the observe-class legacy reads (`list`, `result`, `wait`, `capabilities`,
  `provider_status`, `:55`) — `observe` is a class the child legitimately holds. The projected
  workflow lanes (the v1 set) are application commands and are untouched by the rule.
- Refusal vocabulary: intro line corrected ("adds NONE" → exactly one), new row added; Decision
  4's rationale corrected ("no new refusal planes" → one code, two rules at the existing seam).

### BLOCKER 3 (report HOLE-3): no principal↔run binding on the workflow lanes

Seven of eight lanes bind board↔run or task↔run but never principal↔run; the facade `_authorize`
(`application.mjs:3088`) delegates to the deployment-injected `authorize` (`:2368`), today
`async () => true` (`application-deployment.mjs:1969`), and the pre-gate dispatch
(`:12184-12191`) drops the lease context.

**Amendment (Decision 6, "The v1.1 lane scope binding"):** the lease-subtree scope binding at the
facade `_authorize` seam — the enforcement point, verified: each of the seven lanes calls
`_authorize` with its target runId (`:12608`, `:12634`, `:12661`, `:12710`, `:12723`, `:12793`,
`:12816`). For a `worker:`-prefixed principal the deployment `authorize` admits only targets
inside the caller's lease subtree (the store's first-hop law, `coordination-store.mjs:2046-2054`;
lease re-derived via `activeRunOrchestratorLeaseForSession`, two postures, `:1956-1989`, exactly
as `_isReviewAuthority` does, `coordinator.mjs:7010-7013` — or the pre-gate dispatch passes the
transport-derived `sessionAuthority` through; the LAW is pinned, the plumbing is the
implementer's call).

- Refusal: the constant `application_unauthorized` (the lanes' own unknown ≡ foreign code,
  `application.mjs:12630-12632`) — foreign ≡ unknown, no existence leak. Refusal-table lane row
  extended.
- Row shapes (NP-03 extended, identical in shape to the attention.watch row): child reads a
  sibling run INSIDE its subtree (first-hop carries THIS lease's id) → allowed; child reads a
  FOREIGN run (including a sibling coordinator-lead's subtree — a DIFFERENT lease id) → refused
  constant; unknown runId → same bytes.
- Deliberately exempt: `run.start` (its `_authorize` names the not-yet-existing `intent.runId`,
  `application.mjs:4420`; lease enforcement is the store's own, `_admitRecursiveRun`) and
  `run.attention.watch` (its own seam is already lease-scoped, ground truth 13). Owner posture
  byte-identical (the rule keys only on the `worker:` prefix).

### BLOCKER 4 (report §5 / Decision 5): orphan-sweep cadence honesty

The sweep is driver-triggered with no timers (`coordination-store.mjs:12472-12479`); sessions are
durable across restart (`web-auth.mjs:48-63`); the 30-minute TTL (`run-lineage.mjs:28`) is the
true orphan bound.

**Amendment (Decision 5, four bullets):** (i) cadence disclosed and pinned at every honest seam —
wave close (`coordinator.mjs:11404`), resident stop, AND sweep-on-startup riding the startup
recovery pass that already reconciles runtime scopes (`_trackStartupCleanup`,
`coordinator.mjs:1367-1370`, defined `:1516`), re-deriving orphans from the durable lease records
(`:1717-1732`), not the volatile ledger; (ii) the TTL disclosed as the bound and classified — a
RESOURCE LEASE (bounds how long minted authority can linger as residue), never a control clock
(it schedules nothing; revocation stays event-driven) — no self-renewal (`rotate`
`web-auth.mjs:158` has no transport route); (iii) the self-defending lease disclosed — the
per-call parent re-check (`coordination-store.mjs:1806-1811`, `run_orchestrator_parent_inactive`
`:1807`) is the safety path, revocation the evidence path (the report's non-blocking note,
adopted); (iv) the in-flight window disclosed — dispatched mutations complete (liveness at
dispatch, `web-northbound.mjs:624`), open long-polls are re-authorized at resolution
(`_postWaitAuthorization`, `:633-638`; replay `:844-851`, live `:920-927` — the report's §7
citation, adopted), and a racing `run.start` has exactly two arms (inside the stop admission's
descendant target set — `_runStopTargets`, `coordination-store.mjs:4234-4237`, consumed at
`:12158` — or an ordinary orphan whose authority the sweep collects). NP-04 gains the in-flight
rows; NP-05 gains the cadence pins and the TTL-bound pin (injected clocks).

### BLOCKER 5 (report §8): NP-suite alignment

- NP-02: rewritten — real socket transport derivation pinned; carve-out rows (own child stop
  succeeds; foreign/unknown/non-lease → byte-identical 403).
- NP-03: extended — foreign-run refusal rows per lane family (board/knowledge/message/scratchpad),
  identical in shape to the attention.watch row; sibling-in-subtree admitted rows.
- NP-04: extended — in-flight completion, post-wait re-authorization (401), the racing
  `run.start` two-arm row (refused post-revocation, or enumerated + authority-swept).
- NP-05: extended — cadence pins (wave close / resident stop / startup recovery) and the
  TTL-bound pin (≤30 min, injected clocks).
- NP-07: extended — (e) the legacy-operator refusal per family
  (`worker_legacy_command_forbidden`), owner byte-stable; (f) non-lease `run.stop` 403 constancy.

## Also folded (the report's non-blocking notes)

- **Decision 7 same-uid boundary sentence** (report §6): the zero-read proof is mechanism
  honesty, not an OS boundary — discovery accepts an absolute `tokenFile`
  (`application-cli.mjs:270`) and runtime-isolation disclaims kernel sandboxing
  (`runtime-isolation.mjs:1-2`); pre-existing, same-uid class, scoped explicitly. The one-line
  basename hardening is noted as worth filing separately — NOT this rung.
- **Open question 5** (report §9.5): the `worker:` prefix is now stated as a load-bearing
  security predicate consumed by three seams (goal/plan denial, legacy-command refusal, lane
  scope binding); any future migration moves all three together.
- **Decision 5 citations adopted:** the per-call `parent_inactive` check and the
  `_postWaitAuthorization` long-poll answer (see BLOCKER 4).

## Drift disposition — six claimed, three fixed, three rejected with evidence

Verified at HEAD `a421062` (impl byte-identical to the review's frame):

| Claimed drift | Verdict | Evidence |
| --- | --- | --- |
| `session.revoked` append is `web-auth.mjs:154` (cited `:153`) | **FIXED** (ground truth 5, Decision 5 receipts) | `sed -n '128,160p'`: `revoke` `:151`, the append is line `:154` |
| Vendor deletes are `runtime-isolation.mjs:76-79` (cited `:76-80`) | **FIXED** (ground truth 3, Decision 3) | deletes at `:76-79`; `:80` is the codex restore branch |
| `create` return is `runtime-isolation.mjs:150-172` (cited `:149-172`) | **FIXED** (ground truth 3; Decision 3's "BEFORE the return" now `:150`) | `:149` blank; `return {` at `:150`, closes `:172` |
| `run-lineage.mjs` `leaseTtlMs` is `:29` (cited `:28`) | **REJECTED** — the citation stands | `grep -n`: `leaseTtlMs: 30 * 60 * 1_000` is line `:28`; the contract's `:28` is exact |
| `maxChildrenPerRun`/`maxDescendantsPerRoot` are `:27-28` (cited `:26-27`) | **REJECTED** — the citation stands | `grep -n`: `:26` and `:27` respectively; the contract's `:26-27` is exact |
| `coordinator_run_stop_incomplete` throws at `coordinator.mjs:1765` (cited `:1764`) | **REJECTED** — the citation stands | `grep -an`: the `throw … 'coordinator_run_stop_incomplete'` is line `:1764`; `:1765` is the `localAuthority` line |

## Corrections to the report surfaced by re-verification

- The three false drift claims above (the review miscounted; impl is byte-identical between the
  frames, so this is not frame drift).
- Report §5's "no stop path walks `runDescendants`" is imprecise: `_runStopTargets`
  (`coordination-store.mjs:4234-4237`) consumes `runDescendants` and the run-stop admission
  (`:12158`) enumerates the descendant subtree into its target set when the lineage policy is
  active. The fold carries the corrected two-arm window (a grandchild admitted BEFORE the stop's
  target computation is cascaded; only a post-computation admission escapes) — the report's
  residual-window conclusion stands, its premise is narrowed.
- Report §4's store mirror citation `coordination-store.mjs:15547` is `:15549` at this frame (the
  Finding-scoped verified-evidence rule); the contract amendment does not depend on it.

## Deferred / rejected

- Report fix (b) (drop `run.stop` from v1) and (c) (grant `emergency_stop`): rejected, per the
  report's own analysis (BLOCKER 1 above).
- The absolute-`tokenFile` basename hardening: filed-or-deferred, explicitly out of this rung
  (pre-existing, same-uid class — Decision 7's new sentence).
- waves.* under a worker-held lease: remains #74's rung (open question 1), contingent note now
  satisfiable — the child CAN stop its own child runs post-carve-out.
- The lane-binding plumbing choice (re-derivation vs `sessionAuthority` pass-through): pinned as
  law, deferred to the implementer (same posture as open question 2's sweep fold).

## New citation count

**40 new file:line anchors** introduced by v1.1, each verified this session at HEAD `a421062`
(three NUL-bearing files via `grep -an`/`sed -n` only): `application.mjs:173`, `:148`
(web-northbound), `:1003-1052`/`:1003-1015`/`:1024-1030`/`:1031-1032`/`:1033-1034`/`:1041-1042`/
`:54`/`:55`/`:60` (web-northbound), `:844-851`/`:920-927`/`:633-638` (web-northbound),
`:2035-2058`/`:2046-2054`/`:1956-1989`/`:12472-12479`/`:1806-1811`/`:1807`/`:4234-4237`/`:12158`
(coordination-store), `:12877`/`:12608`/`:12634`/`:12661`/`:12710`/`:12723`/`:12793`/`:12816`/
`:12849-12851`/`:4420` (application), `:4178`/`:4183-4220`/`:1367-1370`/`:1516`/`:7010-7013`
(coordinator), `:48-63`/`:158` (web-auth), `:1-2` (runtime-isolation). Zero citations were taken
from the review without re-derivation.
