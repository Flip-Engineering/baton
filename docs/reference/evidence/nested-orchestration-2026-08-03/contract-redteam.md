# Red Team — Issue #12 nested-orchestration contract v1.0 (adversarial review)

*Adversarial review of `nested-orchestration-contract.md` (this directory, v1.0, issue #12 — the
minted, lease-bound child connection profile). Compiled 2026-08-06 against HEAD `e790ef8` (the
contract's own commit; `impl/` verified byte-identical to the contract's verification frame
`cfa4f3b` — `git diff cfa4f3b..HEAD -- impl/` is empty). NUL-bearing files inspected via
`grep -an` / `sed -n` only, matching the contract's own discipline. Every citation below was
re-derived this session, not inherited.*

## 1. Verification-frame audit (attack vector 1) — the frame claim HOLDS

Re-verified 20 ground truths, the refusal table, and the decision anchors — well past the 12-anchor
bar. All load-bearing anchors hold at their cited lines, including: `WebSessionStore.issue`
(`web-auth.mjs:128`), digest-at-rest (`:137`), `session.issued` (`:142`), `revoke` (`:151`),
`isPrincipalActive` per-call re-validation (`:205-215`); `#residentSession`
(`application-deployment.mjs:1562`, field `:1238`, owner-session revoke precedent `:1617`/`:1641`,
owner issue `:1551-1561`, injected `now` `:1547-1550`); the lease family
(`coordination-store.mjs:1897` issue, `:1916-1918` derived key, `:1922` issued event, `:1926`
revoke, `:1948` revoked event, `:1956` session↔lease binding, `:2035`/`:2040`/`:2044`/`:2054`
scope enforcement, `:1681` derive, `:1692-1694` `baton_orchestrator` precondition, `:1713-1716`
the `min(session.expiresAt, issuedAt+leaseTtlMs)` clamp, `:354` `validRunId`); the gate
(`application.mjs:12225-12233` exact), the eight pre-gate lanes (`:12184-12191` exact, FP-18
comment `:12177-12183`), `_recursiveLease` (`:4304-4321`, mismatch `:4317`, not-found
`:4311`/`:4313`), `_admitRecursiveRun` (`:4346`, reached from `start()` `:4434`), the hub-minted
`authorityDigest` precedent (`:12370-12376`); transport derivation (`web-northbound.mjs:867-873`
replay, `:977-983`/`:996-1001` live, envelope `:884-889`, capability map `:53-60`, 401 `:624`,
403 `:625-629`, repoId `:623`); `acquireBoardLease` (`coordinator.mjs:11113-11131`),
`_isReviewAuthority` (`:7004-7018`), `_ensureRuntimeScope` (`:8498-8511`, `runtime.scope_created`
`:8506-8510`), `_removeRuntimeScope` (`:8513-8530` — the sole reap funnel), the spawn-failure
posture (`:3530-3543`), `lifecycle.spawned` (`:3667`), `replaceEnv` consumption (`:3709`);
`sweepSettlementLeases` (`coordination-store.mjs:12480`, settlement-relation filter `:12490`),
its driver (`coordinator.mjs:11404` region, sweep call `:11405`), the settlement-epoch pin
(`:11446-11450`), settlement brief capabilities (`coordination-store.mjs:12433`);
`sessionAuthoritySchema` (`application-semantics.mjs:1165-1171`); discovery
(`application-cli.mjs:213`, selector `:228`, configRoot `:251-252`, owner-only `:255`/`:271`,
`exactKeys` `:256-258`, token resolve `:270`, the three `cli_config_invalid` throws `:124`/`:268`/
`:272-274`, owner fields `:46`/`:62-67`); resident publication (`resident-authority.mjs:317`,
selector `:328-332`, profile `:333-340`, `writeNew` 0600 `:81`, `replaceAtomic` `:384-393`,
in-memory `_publication` `:394-396`, `tokenBytes` `:343`); credential-projection discipline
(`credential-projection.mjs:20-27`, `:146-148`, `:156-160`); `startWave` member delegation
(`application.mjs:11437`, `:11453-11463`); MCP capability registrations
(`mcp-northbound.mjs:91`, `:99`, `:108-113`, `:533`); `DECISION_REQUEST_GRAMMAR`
(`claude-session.mjs:27`, single-request pin `:1133`); kernel-only context packs
(`coordination-store.mjs:13157`/`:13180`/`:13252`); the goalPlanAuthority hand-off and
worker-denial (`application-deployment.mjs:1901-1907`, `:2002-2010`).

Six ±1-line drifts, none semantic: `run-lineage.mjs` `leaseTtlMs` is `:29` (cited `:28`),
`maxChildrenPerRun`/`maxDescendantsPerRoot` are `:27-28` (cited `:26-27`); the `session.revoked`
append is `web-auth.mjs:154` (cited `:153`); `coordinator_run_stop_incomplete` throws at
`coordinator.mjs:1765` (cited `:1764`); the runtime-isolation vendor deletes are `:76-79` (cited
`:76-80` — `:80` is the codex branch); the `create` return is `:150-172` (cited `:149-172`).
Fix by inspection when the contract is next revised. **Verdict on the frame: SOUND.**

## 2. HOLE-1 (fold-blocking): the minted capability set cannot issue `run.stop` — NP-02 is ungreenable

Three layers of the contract's own stack contradict each other on the child's headline power:

- The lease carries `RUN_ORCHESTRATOR_CAPABILITIES` including `run.stop`
  (`run-lineage.mjs:15-17`), and the store admits it (`authorizeRunOrchestratorCommand`,
  `coordination-store.mjs:2035-2056`).
- The recursive gate allowlists `run.stop` (`application.mjs:12227`).
- **The transport refuses it first.** `COMMAND_CAPABILITY` (`web-northbound.mjs:53-60`) derives
  from the command definitions; `run.stop` declares `capabilities:
  ['emergency_stop','observe']` (`application.mjs:173`). `_authorize` enforces the class
  unconditionally (`web-northbound.mjs:625-629`) before dispatch, before the gate, before the
  lease is ever consulted. Decision 1 mints the child `['observe','control']` and *deliberately
  excludes* `emergency_stop` — correctly, since `kill`/`drain` ride the same class
  (`web-northbound.mjs:54`).

So the child can start bounded child runs but can **never stop one** — NP-02's "run.stop of a
lease child succeeds" fails 403 at the transport even in a perfect implementation. The settlement
plane never hits this because its commands are embedded direct ports driven in-process; the child
rides the socket and hits the map. This is not a citation nit; it is the rung's core loop
(start **and stop** bounded children) broken at the first seam.

**Fix (pick one, and pin it):** (a) preferred — a transport carve-out: when the server-derived
`sessionAuthority` resolves a *live* lease (`web-northbound.mjs:977-983` already computes it),
admit `run.stop` under `control` for that principal; the lease's own scope check
(`coordination-store.mjs:2052-2056`) still bounds the target to the subtree. This is a transport
*rule* change the contract must own explicitly (it currently claims zero new surfaces) plus a pin
that a non-lease `control` principal still gets 403. (b) Drop `run.stop` from the v1 surface and
say so — but then a coordinator-lead can only reap children by dying, and nothing else stops them
(see HOLE-3's orphan-run gap), so (b) is not honest for #74. (c) Grant `emergency_stop` —
rejected: it admits `kill`/`drain` on every worker in the deployment.

## 3. HOLE-2 (fold-blocking): `control` is wider than the lease story — the legacy transport operator commands are uncontained

Decision 6's "v1 drivable surface" enumerates the gate allowlist + eight lanes. It omits the
**non-application transport command set** (`web-northbound.mjs:53-60`, dispatch `:1003-1052`),
which a `control`-holding child token can drive raw over the local socket (the child need not use
the CLI; it shares the owner's uid and can speak HTTP to the socket directly):

- **`spawn` = `control`** — `coordinator.spawn` (`web-northbound.mjs:1005`,
  `coordinator.mjs:4178`) has NO run-membership, lease, or principal-scope guard (its guards are
  plan-gating/task-id/route checks, `:4183-4220`). The child can spawn arbitrary workers with
  arbitrary briefs — **unbounded fan-out that bypasses every lineage bound** (`maxDepth 4`,
  `maxChildrenPerRun 8`, `maxDescendantsPerRoot 32` bind only `admitRunLineage`-admitted runs),
  including briefs carrying `capabilities: ['baton_orchestrator']`, which under Decision 4(b)
  would mint *further* child authorities outside any lease subtree the contract contemplates.
- **`send`/`interrupt` = `control`** (`web-northbound.mjs:1032`,`:1034`). The fence is not a
  barrier: `FENCE_REQUIRED` (`:60`) demands the *current* fence, and `list` = `observe` (`:1041`)
  returns `coordinator.list()` verbatim — the same projection `steer()` reads `target.fence` from
  (`application.mjs:12849-12851`). List-then-send gives the child **cross-run message injection
  into any worker and cross-run interrupts** — a prompt-injection pivot onto every worker in the
  deployment, foreign runs included.
- `capability_invoke`, `reuse_decide`, `reuse_recheck`, `scratch_oracle` — all `control`.

What the child correctly *cannot* do (verified): `kill`/`drain` (`emergency_stop`), `respond`
(`approve`), goal/plan classes (`goal:*`/`plan:*`, plus the `worker:` denial
`application-deployment.mjs:2007`), `run.act` beyond `context_*` actions
(`application.mjs:11848-11853`), `runs.list` replay (`:3187-3189`), out-of-subtree or
sibling-subtree run commands (the first-hop lineage must carry *this* lease's id,
`coordination-store.mjs:2046-2056` — sibling coordinator-leads on one parent run are isolated),
and commands against its own parent run (the parent is not in its own `ancestors`).

Why this is *introduced by the rung*: today no worker holds any token (discovery fails closed);
the legacy command set has never had to distinguish worker principals. The rung mints the first
worker-held credential and inherits an operator command set calibrated for the omnipotent owner.

**Fix:** refuse the legacy operator command set (`spawn`, `send`, `interrupt`, `kill`, `drain`,
`respond`, `capability_invoke`, `reuse_decide`, `reuse_recheck`, `scratch_oracle`) for
`worker:`-prefixed principals at the transport (one rule beside `_authorize`, reusing the
deployment's stated `principalId.startsWith('worker:')` posture, `application-deployment.mjs:2007`)
— fail-closed, byte-stable for the owner, with a red pin per command family. If #74 later needs a
worker-reachable spawn, it must ride `run.start` through the lease, not the legacy lane.

## 4. HOLE-3 (fold-blocking): the eight workflow lanes do not bind principal↔run — cross-run reach with a no-op authorizer

Ground truth 12 states, and this review confirms, that the facade `_authorize`
(`application.mjs:3088`) delegates to the deployment-injected `authorize`, which is
`async () => true` (`application-deployment.mjs:1969`). The pre-gate dispatch
(`application.mjs:12184-12191`) hands each lane `(args, principal)` — the derived
`sessionAuthority` context is **dropped**, so the lanes cannot see the lease. Effective
authorization for the child is therefore the transport capability class plus each lane's internal
checks, and those checks are existence-oracle constancy and payload law — **not** caller scope:

- `run.board.post`/`run.board.read` (`:12718`,`:12788`): the "binding law" binds *board↔run*,
  never *principal↔run*. The child names any `runId` (`_normalizeBoardPost :12486-12538` takes it
  caller-supplied): it can post to any run-bound board by naming that run, and can **adopt an
  unbound board into a foreign run** (`boardAdmission.runId = request.runId`, `:12746`).
- `run.knowledge.seed` (`:12811`): any caller-supplied `runId`; `grounding: 'verified'` is
  lane-legal for every type except evidenceless `Finding` (`:12585-12587`; store mirror
  `coordination-store.mjs:15547`), and evidence refs are shape-checked `{coordinationSeq: n}`
  integers — temporal, not semantic. The child can mint `verified` `Source`/`Principle`/etc. nodes
  with zero evidence **into any run's horizon**, poisoning what future runs harvest.
- `run.message.send` (`:12597`): resolve-then-authorize (`:12603-12611`) ends at the no-op
  authorizer — the child messages any run or worker by id (unknown ≡ foreign holds only for
  *nonexistent* ids). `run.message.receipt` (`:12623`) same for any existing messageId.
- `run.scratchpad.read`/`.elevate` (`:12656`,`:12696`): any runId / any task-in-that-runId
  (task↔run consistency `:12704-12709` is the only check). "Elevate its own doubts" — it can
  elevate *anyone's*, cross-run (fence-bound spam of the settlement plane).
- `run.attention.watch` (`:12641`) is the **only** genuinely scoped lane — the coordinator's
  `_isReviewAuthority` matches the lease run-scoped (`coordinator.mjs:7004-7018`) and foreign
  scopes page empty. NP-03 pins exactly this lane's foreign refusal and no other's.

The issue's law is "requested/resolved/observed authority, nothing more"; Decision 6 claims "each
under its own landed authorization." For a `worker:` principal the landed authorization is vacuous
on seven of eight lanes. NP-03 as written greens with the hole wide open.

**Fix:** pin principal↔run binding for lease-holding principals on all eight lanes: when the
caller is `worker:`-prefixed (or holds a live lease), the lane's target run must lie inside the
lease subtree — the lanes can re-derive the lease exactly as `_isReviewAuthority` does
(`activeRunOrchestratorLeaseForSession`, two postures, `coordination-store.mjs:1956-1990`), or
the pre-gate dispatch can pass the transport-derived `sessionAuthority` through. Add NP-03
foreign-run refusal rows for board/knowledge/message/scratchpad identical in shape to the
attention.watch row. (Design note: scoping *only* `worker:` principals keeps the owner's
omnipotent posture byte-identical — refusal constancy, NP-07, is preserved.)

## 5. Generation binding (attack vector 3) — mechanics SOUND, cadence dishonest; two unpinned windows

What holds, verified:

- The lease is **self-defending on parent death**: `_activeRunOrchestratorLease` re-checks the
  parent task per call (`coordination-store.mjs:1807-1811`) — a terminal parent fails every
  subsequent lease-bound command `run_orchestrator_parent_inactive` even if revocation never
  runs. Revocation ordering before reap (Decision 5) rides the real single funnel
  (`coordinator.mjs:8513-8530`) and the real failure posture (`:1763-1765`). SOUND.
- **Parent killed mid-child-turn:** an already-dispatched mutating command completes (liveness is
  checked at dispatch, `web-northbound.mjs:624`). A racing `run.start` admits a grandchild
  *after* the parent's death. Nothing cascades: no stop path walks `runDescendants`
  (grep-verified — the store exposes them, `coordinator.mjs:843`, but no stop consumes them), so
  the grandchild run and its workers live on as ordinary orphans. The *authority* dies at next
  use; the *effects* are never swept. The contract pins neither the in-flight window nor the
  orphan-run residue. **Fix:** disclose the window in Decision 5 and add an NP-04 row (either the
  racing admission is refused post-revocation, or its product is enumerated and stopped/swept).
- **Orphan sweep cadence is "DRIVER-TRIGGERED, NO TIMERS"** (`coordination-store.mjs:12474-12479`)
  — it fires at wave close (`coordinator.mjs:11405`) and, per Decision 5, on resident stop. In a
  wave-free deployment the sweep *never fires*. The orphan lease is unusable immediately
  (parent-inactive), but the orphan **session** — the lane credential, see HOLE-3 — lives until
  its TTL. Worse, sessions are durable (`sessions.jsonl`, reload `_load` `web-auth.mjs:48-63`):
  an un-revoked child session **survives a resident crash/restart** inside its TTL window, and an
  exfiltrated token copy survives the home reap. Decision 5's "on resident stop" misses crashes;
  no sweep-on-start is pinned. The honest bound is the **TTL (≤30 min,
  `run-lineage.mjs:29`)**, not the sweep — say so, and pin sweep-on-start (or state the TTL as
  the accepted bound). NP-05 as written greens a sweep wired to a cadence that never fires.
- **Stale token replay after respawn:** NP-06's fresh-mint law is consistent with the store
  (sessions are never replayable — `issue` mints a fresh random bearer unconditionally); the old
  session dies at TTL. SOUND given the TTL disclosure above. No self-renewal: `rotate`
  (`web-auth.mjs:158`) has no transport command route (dispatch enumeration `:1003-1052`).

## 6. Minted-not-copied posture (attack vector 4) — SOUND, with one pre-existing discovery weakness to scope

- **The `XDG_CONFIG_HOME` claim is verified and the pin is load-bearing.** The delete list
  (`runtime-isolation.mjs:76-79`) does not contain it; neither scrub regex matches it
  (`SECRET_NAME`/`PROVIDER_OR_INJECTION`, `:8-9`); discovery prefers it over `$HOME/.config`
  (`application-cli.mjs:248-252`). Without Decision 3's delete, a leaked owner `XDG_CONFIG_HOME`
  routes the worker's discovery at the **owner's** store — and the owner-only checks pass because
  worker and resident share a uid. The contract correctly names this the exact anti-goal and pins
  both the delete and NP-08(e). SOUND.
- **`BATON_*` env:** `BATON_TOKEN` is stripped (`/TOKEN/`, `:8`); a partial
  `BATON_URL`/`BATON_ORIGIN`/`BATON_REPO_ID` leak fails *closed* — discovery refuses an
  incomplete override (`application-cli.mjs:218-221`). The full override is unreachable because
  the token never survives the scrub. SOUND.
- **Path traversal:** the projected profile name rides the selector's `profile` field, validated
  separator-free (`id()`, `application-cli.mjs:237`); the projection writes are basename-pinned
  beside the profile. SOUND *for the projection mechanism*.
- **Pre-existing (scope it, don't claim it):** discovery accepts an **absolute `tokenFile`**
  (`application-cli.mjs:270`). A hostile worker can fabricate a profile in its own private home
  (it owns the tree) naming the owner's token file by absolute path; every check passes — same
  uid, 0600, owner fields optional (`:56-67`), selector values readable from the shared common
  dir. This is *not introduced by the rung* (the same-uid worker can also read the token file
  directly; runtime-isolation disclaims kernel sandboxing, `runtime-isolation.mjs:1-2`), but the
  issue's acceptance (c) "the owner profile store is never read by the worker" is a **mechanism
  honesty** pin (NP-08(b)'s zero-read proof — correctly framed), not an OS boundary. The contract
  should say so once, explicitly; a one-line discovery hardening (`tokenFile` must be a basename)
  is cheap and worth filing.
- The worktree `.baton/` tree (runtime root `runtime-isolation.mjs:45-46`, session store under
  the authority root) is same-uid readable but holds digests only (`web-auth.mjs:137`) — no
  authentication value. SOUND.

## 7. TTL-as-lease-epoch and the long-poll window (attack vector 5) — SOUND

- The clamp `min(session.expiresAt, issuedAt + leaseTtlMs)` (`coordination-store.mjs:1713-1716`)
  bounds the lease by the session epoch under clock skew; both stores take injected clocks
  (`web-auth.mjs:33`, `coordination-store.mjs:1913`); the projection path reads zero clocks.
  Decision 2 SOUND.
- **Holding a command open does not outlive revocation.** `_postWaitAuthorization`
  (`web-northbound.mjs:633-638`) re-authenticates *and* re-authorizes when a `run.follow`/
  `run.wait` resolves, on both the replay and live paths (`:844-851`, `:920-927`). A revoked
  child's open long-poll dies 401 at wait end — maximum overstay one wait window, read-only.
  Non-wait in-flight mutations complete (the §5 window). The contract doesn't cite this
  re-authorization; it should — it is the load-bearing answer to the long-poll attack.

## 8. Acceptance-pin shallowness audit (attack vector 6)

- **NP-02 is ungreenable as written** (HOLE-1) — the "run.stop succeeds" row fails 403 in a
  correct implementation. Fold-blocking by itself.
- **NP-03 greens with the cross-run hole open** (HOLE-3) — one mock-session row per lane family
  asserts the lane *works* for the child, never that a foreign run refuses (except
  attention.watch). Add the foreign rows.
- **NP-05 greens a never-firing sweep** (§5) — pin cadence (sweep-on-start) or the TTL bound.
- **NP-04 covers the revoke-mints-but-doesn't-invalidate sham** (`isPrincipalActive` false + 401
  retry) — SOUND. Extend with the in-flight/orphan-run row (§5).
- **NP-01's "profile exists but never authority-checked" sham is covered only if** NP-02 rides
  the real transport derivation (server-side `sessionAuthority`, `web-northbound.mjs:977-983`)
  rather than a caller-supplied context — pin that the test's child drives the socket transport,
  not `application.command` with a hand-built context.
- NP-06/NP-07/NP-08/NP-09 are shaped honestly (replay under derived keys, refusal byte-constancy,
  digest-inequality + zero-read, injected-clock static assertion). SOUND.

## 9. Open questions (attack vector 7) — verdicts

1. **waves.* deferral — SOUND, contingent on HOLE-1.** A v1 coordinator-lead composes executor
   cells through `run.start`/`run.stop` + the eight lanes; waves.* adds roster ergonomics, and
   `waves.stop` is `emergency_stop`-class (`mcp-northbound.mjs:99`) — a class the child must
   never hold — so wave *stopping* belongs with the human in any case. The deferral is #74's own
   rung and v1-without-waves.* is *not* too weak — **provided** the child can stop its own
   child runs (HOLE-1 fixed); a lead that can start but never stop is not a coordinator.
2. **Sweep shape — SOUND.** Behavior pinned (NP-05), fold-vs-sibling is the implementer's call.
   Add the cadence disclosure (§5).
3. **Context-pack reach — SOUND.** Kernel-only mints routed through the human orchestrator are
   not v1-load-bearing (a lead briefs executors via run intents); #74 owns the lane.
4. **Fan-out policy sufficiency — SOUND.** 8/32/4 are policy-digested deployment knobs
   (`run-lineage.mjs:24-30`), tunable without code change.
5. **The `worker:<id>` principal convention — SOUND, and it becomes load-bearing:** the HOLE-2 /
   HOLE-3 fixes both key on the `worker:` prefix, which today only the goal/plan denial consumes
   (`application-deployment.mjs:2007`). The convention should be stated as a security predicate,
   not just a naming posture.

## 10. Decision-by-decision verdicts

| Decision | Verdict | Note |
| --- | --- | --- |
| 1. Minted session + lease | **HOLE** | The shape is right (every authority landed); the capability calibration is wrong in both directions — too narrow for `run.stop` (HOLE-1), too broad for the legacy transport set (HOLE-2). |
| 2. TTL = lease epoch | **SOUND** | Clamp verified; injected clocks; zero time reads in projection. |
| 3. Two FRESH files via projection mechanics | **SOUND** | XDG delete verified necessary; write discipline matches `credential-projection.mjs:146-148`; closed discovery shape honored. |
| 4. Bounded connection-authority hand-off | **SOUND** | Closure over `#residentSession` (`:1562`), two operations, own ledger; follows the goalPlanAuthority precedent exactly. |
| 5. Generation binding | **HOLE (cadence honesty)** | Mechanics all landed and per-call fail-closed; the sweep's driver-triggered cadence + durable sessions make the *TTL* the real orphan bound — disclose, pin sweep-on-start, pin the in-flight/orphan-run window. |
| 6. The v1 drivable surface | **HOLE** | Omits the legacy transport command set (HOLE-2); seven of eight lanes lack principal↔run scope (HOLE-3); `run.stop` unreachable (HOLE-1). The gate-constancy half of the decision is SOUND. |
| 7. Honest-posture story | **SOUND** | Digest-inequality + zero-read + content-independence are the right proof shape; add the same-uid boundary sentence (§6). |
| 8. Non-goals | **SOUND** | Appropriately narrow; waves.* correctly assigned to #74. |

## 11. Final verdict: **NOT FOLD-READY** — 5 blockers

1. **HOLE-1 (§2):** `run.stop` requires `emergency_stop` at the transport; the minted
   `['observe','control']` child gets 403. NP-02 cannot pass; the start-and-stop core loop is
   broken. Fix: the lease-scoped transport carve-out (or restate the surface), with pins.
2. **HOLE-2 (§3):** the legacy transport operator commands (`spawn`/`send`/`interrupt`/
   `capability_invoke`/`reuse_*`/`scratch_oracle`) admit the child with no lease, no subtree, no
   lineage bounds — unbounded fan-out and cross-run worker injection. Fix: `worker:`-prefix
   refusal at the transport, red-pinned per family.
3. **HOLE-3 (§4):** seven of eight workflow lanes bind board↔run or task↔run but never
   principal↔run (facade `authorize` is `async () => true`); the child reaches foreign runs'
   boards, knowledge (including `grounding:'verified'`), messages, and scratchpads. Fix:
   lease-subtree scope binding for `worker:` principals on every lane + NP-03 foreign rows.
4. **Decision 5 / NP-5 cadence (§5):** the orphan sweep is wave-close-driven (effectively never
   in wave-free deployments) and sessions are durable across restart; the TTL is the true bound.
   Fix: disclose the bound, pin sweep-on-start, pin the in-flight-completion and orphan-run
   windows in NP-04/NP-05.
5. **NP suite gaps (§8):** NP-02 ungreenable (blocker 1's mirror), NP-03 missing foreign-run
   refusals, NP-05 missing cadence, NP-02 must ride the real socket transport derivation.

*Non-blocking, file-or-scope: the six ±1-line citation drifts (§1); the absolute-`tokenFile`
fabricated-profile bypass (§6 — pre-existing, same-uid class; scope it explicitly, harden
discovery with a basename pin when convenient); Decision 5 should cite the per-call
`parent_inactive` check (`coordination-store.mjs:1807-1811`) — it is the strongest sentence the
generation binding has and the contract never says it; §7's `_postWaitAuthorization` is the
long-poll answer and deserves a citation.*
