# Blue Team — nested-orchestration red-first suite (suite-blueteam.md)

*Independent verification of `impl/test/nested-orchestration-red.test.mjs` (15 rows: 7 pins + 8
reds) against `nested-orchestration-contract.md` (v1.1) + `contract-fold.md` +
`contract-redteam.md` (this directory). Run from the repo root:
`node --test impl/test/nested-orchestration-red.test.mjs`. Compiled 2026-08-06 at HEAD
`310a4e3`. NUL discipline honored: `application.mjs` / `coordination-store.mjs` inspected via
`grep -an`/`sed -n` only; `coordinator.mjs` / `claude-session.mjs` are plain text (verified:
3 / 3 / 0 / 0 NUL bytes respectively).*

---

## 1. Run record

Executable contract: `node --test impl/test/nested-orchestration-red.test.mjs` (repo root).

| Run | tests | pass | fail | duration |
| --- | --- | --- | --- | --- |
| 1 | 15 | 7 | 8 | 4624 ms |
| 2 | 15 | 7 | 8 | 4588 ms |
| 3 | 15 | 7 | 8 | 4604 ms |
| 4 (final confirm) | 15 | 7 | 8 | 5020 ms |

**Split: 7 pins green, 8 reds failing — matches the header's claimed baseline.** No flake across
four consecutive runs.

Per-row red failure record (all fail at their NAMED stage, first assertion, no earlier fixture
crash and no later-stage masking):

| Row | Named stage | Failing assertion | Observed |
| --- | --- | --- | --- |
| R1 | connection-mint-missing | `test.mjs:690` `typeof connectionAuthority.mintChildAuthority === 'function'` | `undefined` |
| R2 | connection-projection-missing | `test.mjs:758` `assert.ok(created.posture.connectionProjection)` | `undefined` |
| R3 | xdg-delete-missing | `test.mjs:783` `created.env.XDG_CONFIG_HOME === undefined` | `'/home/orchestrator/.config'` |
| R4 | runstop-carveout-missing | `test.mjs:804` `response.status === 200` | `403` |
| R5 | legacy-refusal-missing | `test.mjs:821` `response.status === 403` (first family, `spawn`) | `200` |
| R6 | lane-scope-binding-missing | `test.mjs:867` `refusal?.code === 'application_unauthorized'` (first lane, `run.message.send`) | `undefined` (lane served) |
| R7 | terminal-revoke-missing | `test.mjs:873` `typeof connectionAuthority.revokeChildAuthority === 'function'` | `undefined` |
| R8 | orphan-sweep-missing | `test.mjs:909` `typeof connectionAuthority.sweepChildOrphans === 'function'` | `undefined` |

Stage attribution is honest for all 8 reds:
- R1/R7/R8 fail on the missing export (`../src/index.mjs` has no `connectionAuthority` namespace —
  grep-verified: no `connectionAuthority`/`mintChildAuthority`/`revokeChildAuthority`/
  `sweepChildOrphans` export), exactly the mint/revoke/sweep-missing stages.
- R2 fails on `posture.connectionProjection` — `RuntimeIsolation.create` (two-arg) returns a
  posture with no such field (`runtime-isolation.mjs:150-172`; the third options arg is ignored).
- R3 fails because `create`'s env scrub deletes `CLAUDE_CONFIG_DIR`/`CODEX_HOME`/`GROK_HOME`/
  `KIMI_CODE_HOME` but NOT `XDG_CONFIG_HOME` (`runtime-isolation.mjs:76-79` region) — the exact
  seam Decision 3 names.
- R4 fails because `run.stop` declares `capabilities: ['emergency_stop','observe']`
  (`application.mjs:173`) and the transport enforces the class unconditionally at `_authorize`
  (`web-northbound.mjs:625-629`) before the lease is consulted — the child
  (`['control','observe']`) draws 403. The store-side lease/scope machinery is NOT the blocker
  (the store would admit a subtree-scoped run.stop today).
- R5 fails because the legacy command table (`web-northbound.mjs:53-60`, dispatch `:1003-1052`)
  admits the full-capability `worker:r5` principal today — a genuine 200 per family, never a
  fixture crash (the `legacyCoordinator()` stub is a real 200 surface).
- R6 fails because the six lanes serve foreign runs today: the facade `_authorize`
  (`application.mjs:3088`) delegates to the injected `authorize` (`:2368`), which the fixture
  sets to `async () => true` (`test.mjs:225`); the pre-gate dispatch (`:12184-12191`) hands each
  lane `(args, principal)` with the sessionAuthority dropped. Lanes 2-6 would also serve today
  (no run-existence requirement — e.g. `_normalizeBoardPost` only demands `validId(value.runId)`,
  `application.mjs:12486-12538`).

---

## 2. Coverage map

### 2a. Contract decisions → tests

| Contract decision | Tests enforcing | Requirements with NO test |
| --- | --- | --- |
| **D1 — minted session + lease** (`userId: 'worker:<id>'`, caps exactly `['observe','control']`) | R1 (mint exists, fresh token ≠ parent, mode-0600 path, authenticate-as-child, live lease), P1 (WebSessionStore machinery) | The `worker:`-prefixed `userId`; capabilities EXACTLY `['observe','control']`; `ttlMs` = policy `leaseTtlMs`; the child never presents `sessionAuthority` |
| **D2 — TTL = lease epoch** | P2 (lease `expiresAt === issuedAt + leaseTtlMs`; `run_orchestrator_lease_expired` past epoch; injected clock) | Session `expiresAt` === lease `expiresAt` equality (NP-09); zero-time-read static assertion; downward-clamp row |
| **D3 — two FRESH files via projection mechanics + XDG delete** | R3 (env deletes `XDG_CONFIG_HOME`), R2 (posture projection exists — shape CONTRADICTS contract, see Blocker 2) | Exactly two files; `O_CREAT\|O_EXCL\|O_NOFOLLOW` 0600 fsync writes; profile bytes built from the in-memory publication outline (zero owner-store read); `<paths.home>/.config` mode 0700; token file CONTENT === child token (Blocker 4); profile file content shape |
| **D4 — bounded connection-authority hand-off** (exactly two ops, `mintChildAuthority({workerId,parentTask})`, `revokeChildAuthority({sessionId,leaseId,leaseDigest,reason})`) | R1, R7 (invented surfaces — signatures DRIFT, see §5) | Closure over `#residentSession`; the `{sessionId↔leaseId}` ledger; the mint/lease/projection failure posture (`runtime_scope_unavailable`) |
| **D5 — generation binding: terminal-path revoke + orphan sweep + TTL bound + in-flight window** | R7 (revoke lands in BOTH stores), R8 (sweep revokes lease + counts), P2 (epoch bound) | Revocation-before-reap ordering; the per-call `parent_inactive` self-defense; sweep cadence (wave close / resident stop / resident START via `_trackStartupCleanup`); `reconcile` root removal; the in-flight window (dispatched mutation completes, long-poll 401 at wait end, the racing `run.start` two arms) — all unpinned |
| **D6 — v1 drivable surface: gate + eight lanes + run.stop carve-out + legacy refusal + lane binding** | P3 (gate constancy), P4 (run.stop owner 200 / non-lease 403), R4 (carve-out admit arm), P5 (legacy owner 200), R5 (legacy worker 403), P6 (lane reach — VACUOUS, Blocker 3), R6 (lane binding foreign — UNGREENABLE, Blocker 1), P7 (resolve-then-authorize constancy) | The seven recursive reads; `run.start` bounded children (depth 5 / 9th child / out-of-subtree `run_orchestrator_scope_forbidden`); **run.stop of a FOREIGN / UNKNOWN run from a lease holder → byte-identical 403** (Blocker 5); the gate allowlist set unchanged (`application.mjs:12225-12227`); `kill`/`drain` untouched; lane binding ADMIT arm (sibling-in-subtree for a `worker:` principal) |
| **D7 — honest posture: minted-not-copied** | R1 (digest inequality), R2 (no token in posture) | `tokenDigest` ≠ every digest in the owner store; independence reversals (NP-08c); zero-read construction proof (NP-08b) |
| **D8 — non-goals** | — (not directly testable; no violation observed) | — |

### 2b. Refusal codes → tests

| Refusal | Tests | Requirement with NO test |
| --- | --- | --- |
| `worker_legacy_command_forbidden` (the rung's ONE new code) | R5 (all 10 commands per family) | — |
| `run_orchestrator_command_forbidden` (gate) | P3 | — |
| `run_orchestrator_scope_forbidden` | — | out-of-subtree `run.start`/`run.stop`; foreign `run.stop` |
| `run_orchestrator_lease_expired` | P2 | — |
| `run_orchestrator_lease_not_found` / `_revoked` / `_session_mismatch` / `_parent_inactive` / `_parent_stale` / `_capability_required` / `_lease_invalid` / `_conflict` | — | none exercised |
| `application_unauthorized` (resolve-then-authorize + v1.1 lane binding) | P7, R6 | — |
| `attention_scope_forbidden` | P7 | — |
| 403 `forbidden` (transport capability / repoId) | P4, R5 | `run.answer` approve-class refusal; goal/plan classes |
| 401 `unauthenticated` (revoked/expired session) | — | not exercised (P1 covers `isPrincipalActive` false, not the transport 401) |
| `cli_config_invalid` (all three discovery codes) | — | non-lease worker discovery absence-refusal is entirely unpinned |
| `runtime_scope_unavailable` / `runtime_cleanup_failed` | — | mint/lease/projection failure posture unpinned |

### 2c. Acceptance pins NP-01…NP-10 → tests

| Pin | Covered by | Uncovered requirements |
| --- | --- | --- |
| NP-01 (spawn carries minted profile, receipts cross-consistent) | R1/R2/R3 partially (shape level only) | No spawn-level test: `session.issued`/`run.orchestrator_lease_issued`/`runtime.scope_created`/`lifecycle.spawned` cross-consistency; the two-files-exactly receipt |
| NP-02 (discovery + bounded child runs over the REAL socket) | R4 (carve-out admit only) | Discovery; the seven recursive reads; depth/children bounds; foreign/unknown `run.stop`; non-lease `run.stop` constancy (P4 covers the non-lease row); no socket-transport derivation pin |
| NP-03 (lanes + v1.1 foreign rows) | P6 (own-subtree reach — VACUOUS), R6 (foreign refusal — UNGREENABLE), P7 (attention) | Sibling-IN-subtree admitted (per lane family); unknown runId ≡ foreign |
| NP-04 (terminal-path revocation, ordered; in-flight) | R7 (both stores revoked) | Revocation-before-reap ordering; post-stop `isPrincipalActive` false (R7 covers); in-flight completion; long-poll 401; the racing `run.start` two arms |
| NP-05 (orphan sweep behavior + cadence + TTL bound) | R8 (sweep counts + revokes lease), P2 (epoch) | Sweep cadence pins (wave close / stop / START); `reconcile`; zero-residue (no live session, no files); the ≤30-min TTL bound pin with injected clocks |
| NP-06 (replay/idempotency) | — | entire pin absent |
| NP-07 (refusal constancy) | P3 (gate), P4 (run.stop), P5 (legacy owner), R5 (legacy worker) | (a) worker discovery `cli_config_invalid` byte-identical; (c) approve-class 403; (d) gate allowlist set; (e) owner legacy byte-stream unchanged is only implied by P5, never diffed pre/post |
| NP-08 (never copies the owner store) | R1 (token ≠ parent, digest inequality), R3 (XDG env) | (a) `tokenDigest` vs owner-store digests; (b) zero-read construction; (c) independence reversals (revoke child leaves owner; revoke/rotate owner leaves child); (d) two-files-exactly; (e) discovery resolves `<home>/.config` |
| NP-09 (TTL is lease-epoch-bound) | P2 (lease side only) | session `expiresAt` === lease `expiresAt` equality; projection-path zero-clock static assertion |
| NP-10 (red suite) | the suite itself | — |

**Net:** the suite is a genuine red-first nucleus but leaves the majority of the contract's
acceptance surface untested — including several load-bearing refusals (scope, not-found,
parent-inactive, 401, `cli_config_invalid`) and three full pins (NP-06, NP-07 subsets, NP-08
independence proofs). That is acceptable for a red wave only if the wave understands these are
uncovered; it is NOT acceptable that the suite's own green pins give false confidence on the
child posture (P6, §3) and that one red is un-greenable (R6, Blocker 1).

---

## 3. False-green hunt — per-pin verdicts

### P1 — WebSessionStore mint/authenticate/revoke/rotate — **SOUND**
`test.mjs:486-520` drives the real store (`web-auth.mjs`): `issue` (bearer mint, `expiresAt` from
the injected clock), `authenticate` (bearer → principal), `isPrincipalActive` per-call
re-validation (self-elevation is caught — `isPrincipalActive` checks `principal.capabilities`
against the session's, `web-auth.mjs:211-214`), `rotate` (fresh sessionId + fresh token), `revoke`
(durable; `authenticate` null; `isPrincipalActive` false). All assertions exercise real state
transitions — no vacuous shape. Minor notes (not false-green): the title says "durable" but the
store is never reloaded from disk (`sessions.jsonl`); the pre-rotation token's death is not
asserted.

### P2 — lease-epoch TTL — **SOUND**
`test.mjs:522-545`: `lease.expiresAt === issuedAt + leaseTtlMs` (the session TTL is one hour, so
the min-clamp lands on the 60 s epoch exactly — `coordination-store.mjs:1713-1716`), session
expiry unchanged, the lease live at issue, and advancing the INJECTED clock one millisecond past
the epoch throws the typed `run_orchestrator_lease_expired` (`coordination-store.mjs:1801`). No
wall-clock read; the assertion would fail against any implementation that uses wall time or the
session expiry instead of the epoch. **SOUND.**

### P3 — recursive-session gate constancy — **SOUND**
`test.mjs:547-563`: a `sessionAuthority` context drives `runs.list` and `run.workstream.stop`
through the gate → `run_orchestrator_command_forbidden` (`application.mjs:12225-12233`), and
`application.help` (a gate allowlist read lane) serves. These are the real landed behaviors, and
the contract explicitly forbids widening the gate (Decision 6 / NP-07d), so the pin constrains the
rung correctly. **SOUND.**

### P4 — transport run_stop constancy — **SOUND**
`test.mjs:565-581`: owner (`emergency_stop`+`observe`) → 200 through the real transport admission
+ recorder dispatch; non-lease child (`['control','observe']`) → 403 `forbidden` at `_authorize`
(`web-northbound.mjs:625-629`) before any application dispatch. This is exactly the constancy the
rung's carve-out must preserve for non-lease callers, and it pins the 403 `forbidden` body shape.
**SOUND.**

### P5 — legacy operator set stays 200 for the owner — **SOUND**
`test.mjs:592-604`: all ten legacy commands (`legacyFamilies`, `test.mjs:945-975`) return 200 for
the non-`worker:` owner against a real 200 stub (`legacyCoordinator`, `test.mjs:428-442`). The
owner principal carries the full operator capability set, so the admission is a genuine
capability+dispatch path — not a fixture crash. This is the byte-stability base R5's refusal pins
against. **SOUND.**

### P6 — "v1 lane reach on the child's OWN subtree" — **VACUOUS as a child pin**
`test.mjs:608-650` drives the six lanes with `authorityOn(..., principalId: 'child', ...)`
(`test.mjs:610`) — **NOT the contract's `worker:<workerId>` child** (Decision 1; the security
predicate `principalId.startsWith('worker:')` at `application-deployment.mjs:2007`). Because the
fixture's `authorize` is `async () => true` and the principal is not `worker:`-prefixed:
- it passes today for the WRONG reason — the lanes serve ANY principal with the capability class
  (the vacuous authorizer), not because a child's lane reach exists;
- it passes after a correct rung (the prefix-keyed binding never fires for `child`);
- it would ALSO pass after a WRONG rung that blocks every `worker:`-prefixed lane call — the
  actual child's reach could be entirely broken and P6 stays green.

So P6 constrains nothing about the lane-scope implementation and leaves the NP-03 admit arm
(sibling-in-subtree for a `worker:` principal) with **zero green coverage** (R6 has only
foreign-refusal rows, and is itself un-greenable — Blocker 1). Fix: re-key the fixture to
`principalId: 'worker:child'`; P6 then becomes the admit arm that catches an over-restrictive
binding. Verdict: **VACUOUS (as labeled)/WEAK (as a constancy pin).**

### P7 — resolve-then-authorize constancy — **SOUND**
`test.mjs:652-679`: unknown `message.receipt` → `application_unauthorized` (resolve-to-null ≡
unknown, `application.mjs:12623-12632`); unknown task and cross-run task in `scratchpad.elevate`
both refuse `application_unauthorized` with IDENTICAL messages (no existence leak); foreign
`attention.watch` → `attention_scope_forbidden` via `_attentionScopeAuthorized` →
`_isReviewAuthority` (`coordinator.mjs:6955-6999`, `:7004-7018`). The `crossRun?.message ===
unknownTask?.message` equality is a genuine no-leak proof. Real landed laws, correctly pinned.
**SOUND.**

---

## 4. Teeth check — would a plausible WRONG implementation fail each red?

| Row | Would a wrong impl fail it? | Verdict |
| --- | --- | --- |
| **R1** | A no-op → fails (missing function). A mint that copies the parent token → fails (`minted.session.token !== parentConnection.token`, digest inequality). A mint that lands the profile/token outside the runtimeRoot → fails. A token file with wrong mode → fails (0600). A mint that never registers the session in the durable store → fails (`sessions.authenticate(...).userId === 'child-r1'`). A lease that doesn't bind the child session → fails (`activeRunOrchestratorLeaseForSession`). **GAP:** the token FILE content is never read — a wrong mint can register a fresh session in the store while writing the PARENT's token (or garbage) to the projected file and R1 goes green (the file is the child's actual authentication surface). Also unasserted: capabilities exactly `['observe','control']`; independence reversals. | **GOOD core teeth / BLOCKER-4 gap on the file content** |
| **R2** | A no-op → fails (no `posture.connectionProjection`). Embedding the raw token in the posture → fails (`token === undefined`). **BUT** the asserted shape (`profile`/`tokenFile`/`url`/`origin` on the posture, `test.mjs:760-765`) contradicts contract Decision 3's digest-only shape; a faithful contract implementation cannot green it. | **CONTRADICTS contract — Blocker 2** |
| **R3** | A no-op (keep `XDG_CONFIG_HOME`) → fails. Deleting it → green. Clean seam; the anti-goal (discovery must not route at the owner's store) is exactly the deleted env var. | **SOUND** |
| **R4** | A no-op (no carve-out) → fails (403). A carve-out keyed on live-lease + store scope → green. **GAP:** nothing pins a lease-bound child stopping a FOREIGN or UNKNOWN run → byte-identical 403 — an over-broad carve-out that admits any `run.stop` from any lease holder passes R4 AND P4. The store's second layer (`_authorizeRecursiveCommand('run.stop', …)`, `application.mjs:12877`) is never exercised. | **GOOD admit teeth / BLOCKER-5 scope gap** |
| **R5** | A no-op → fails (200). A partial refusal (one family) → fails on the missing family. A capability-based (not identity-based) refusal → fails: the worker carries the FULL operator set including `emergency_stop`, proving the refusal must key on the `worker:` prefix, not on missing capabilities. Owner byte-stability pinned by P5. | **SOUND — the strongest teeth in the suite** |
| **R6** | A no-op → fails (lanes serve foreign runs). **BUT the test cannot distinguish a correct binding from an over-restrictive one, and more importantly a correct binding CANNOT green it:** the fixture principal is `child`, not `worker:`-prefixed, so the contract's prefix-keyed binding never fires, and the injected `authorize = async () => true` never refuses. | **UNGREENABLE — Blocker 1** |
| **R7** | A no-op → fails both store checks. Lease-only revocation → fails the session check. Session-only revocation → fails the lease status check (`runOrchestratorLease(...)?.status === 'revoked'`, `coordination-store.mjs:7831-7834`). Revoking a WRONG session → fails (the child stays active). The session-side check is indirect — `isPrincipalActive(authenticate(...))` — and would return false on a `null` principal (`web-auth.mjs:205-207`), but with a static clock and a fresh token the only way to get there is revocation, so it is sound, not vacuous. | **GOOD teeth** (minor: assert `authenticate === null` directly for a stronger proof) |
| **R8** | A no-op → fails (`swept >= 1` + lease not revoked). A sweep that counts but never revokes → fails the lease status. A sweep that revokes leases but not sessions → PASSES, because the child session was issued with a 1 s TTL and the clock was advanced past expiry before the sweep, so `sessions.authenticate(...) === null` is trivially true — the session-revocation half of the sweep is unpinned. `deadlineMs`/`runtime` args are never asserted against. | **GOOD lease teeth / session half unpinned** |

---

## 5. Drift findings — suite header/impl vs contract surface names

1. **Principal identity drift (load-bearing).** The suite's "child" fixtures use
   `principalId: 'child'` / `'child-p3'` / `'child-r1'` / `'child-r4'` / `'child-r7'` /
   `'child-r8'` — none `worker:`-prefixed. The contract mints `userId: 'worker:<workerId>'
   (Decision 1) and keys BOTH the lane binding and the legacy refusal on the prefix
   (`application-deployment.mjs:2007`). Only R5 uses a `worker:`-prefixed principal. This breaks
   R6's greenability (Blocker 1) and empties P6 (Blocker 3). The suite header claims "the v1 lane
   reach on the child's OWN subtree" but the fixture is not the child.

2. **Posture shape drift (contradiction).** R2 asserts `posture.connectionProjection` carries
   `profile`/`tokenFile`/`url`/`origin` — credential inventory NAMES on the public posture.
   Contract Decision 3 pins it as `{state: 'materialized', profileDigest, tokenDigest, sessionId,
   orchestratorLeaseId, expiresAt}` — "digests and ids only — the posture's no-paths/no-inventory
   law". A faithful implementation cannot green R2 (no `profile`/`tokenFile` fields); adding them
   violates the contract's own law. The suite and contract must be reconciled (Blocker 2).

3. **`mintChildAuthority` signature drift.** Suite (`test.mjs:29-38`):
   `{schemaVersion, repoId, coordination, sessions, parentTask, parentConnection, runtimeRoot}`.
   Contract Decision 4a: `mintChildAuthority({workerId, parentTask})`. The suite omits `workerId`
   and adds `parentConnection`/`runtimeRoot`. Consequence: the mint must derive the child's
   `userId` (`'child-r1'`, asserted at `test.mjs:733`) from the PRE-EXISTING lease on the parent
   task — fragile coupling to the fixture's `workingParent` principalId, and a departure from the
   contract's named surface.

4. **`revokeChildAuthority` signature drift.** Suite (`test.mjs:40-44`):
   `{schemaVersion, coordination, sessions, sessionId, leaseId, reason}`. Contract Decision 4a:
   `revokeChildAuthority({sessionId, leaseId, leaseDigest, reason})`. The suite drops `leaseDigest`
   (the store's `revokeRunOrchestratorLease` requires it — `coordination-store.mjs:1928-1932`) and
   adds `coordination`/`sessions` handles; the implementer must bridge.

5. **`sweepChildOrphans` invented.** Decision 4a names "exactly TWO operations";
   `sweepChildOrphans` is a third, with `{schemaVersion, coordination, sessions, deadlineMs,
   runtime}` — `deadlineMs` and `runtime` are unused in any assertion. The sweep is only described
   in Decision 5 / NP-05; the suite invents the surface.

6. **Lane-binding enforcement seam drift.** The contract's main text says the binding lives in
   "the deployment `authorize`" (`application-deployment.mjs:1969` today `async () => true`); the
   fold's BLOCKER 3 names "the facade `_authorize` seam — the enforcement point". The suite's
   fixture ALWAYS injects `authorize = async () => true` (`test.mjs:225,246`), so R6 can only go
   green if the law is placed INSIDE `_authorize` (`application.mjs:3088`) / the lanes — the
   deployment-authorize wording is unsatisfiable under the suite. The suite silently forces the
   fold's interpretation.

7. **Gate/refusal-constancy pins use non-`worker:` principals throughout** (P3, P4, P6, P7), so
   none of the constancy pins actually exercise the rung's new predicates against a real child
   session — the constancy is pinned only for owner-like principals.

---

## 6. Final verdict: **NOT-READY**

The suite runs exactly as claimed (7 green / 8 red, all at named stages) and the run is stable,
but it is not a sound basis for the implementation wave: one red is un-greenable by any
contract-faithful implementation, one red contradicts the contract's pinned posture shape, one
pin gives false confidence on the child posture, and two reds carry teeth holes that admit
plausible wrong implementations.

### Numbered blockers

1. **R6 is un-greenable as written.** *What:* `test.mjs:831` drives the lane-scope-binding red
   with `principalId: 'child'`; the contract's binding fires ONLY for `worker:`-prefixed
   principals (Decision 6 — "Scoping ONLY `worker:`-prefixed principals keeps the owner's
   omnipotent posture byte-identical"), and the fixture injects `authorize = async () => true`
   (`test.mjs:225,246`). *Why:* a contract-faithful implementation never refuses this principal's
   foreign-run lane calls, so `application_unauthorized` is never emitted and R6 stays red forever;
   the only greenable paths are a test change (worker-prefixed principal) or a contract change
   (key the binding on live-lease-holders, rejecting owner byte-stability). *Fix:* change R6's
   fixture (and the lease it binds) to `principalId: 'worker:child'` so the actual predicate
   fires; keep the injected-`authorize` question by moving the law into `_authorize` per the fold's
   seam.

2. **R2 contradicts the contract's posture law.** *What:* `test.mjs:760-765` asserts
   `posture.connectionProjection` carries `profile`/`tokenFile`/`url`/`origin`; contract Decision
   3 pins it as digests+ids only (the no-paths/no-inventory law). *Why:* a faithful
   implementation cannot green R2, and satisfying R2 violates the contract's own acceptance shape
   (NP-01). *Fix:* reconcile the shape — either R2 asserts the digest/ids envelope
   (`state`/`profileDigest`/`tokenDigest`/`sessionId`/`orchestratorLeaseId`/`expiresAt`) and the
   contract carries those, or the contract amends the no-inventory law and NP-01 to admit the
   material (profile/tokenFile/url/origin) on the posture.

3. **P6 is a false-green child-lane pin; the admit arm is unpinned.** *What:* `test.mjs:610`
   uses a non-`worker:` principal, so P6 passes regardless of whether the rung breaks the actual
   child's lane reach; R6 (the only foreign-refusal row) is itself un-greenable (Blocker 1).
   *Why:* the suite provides zero green coverage that a `worker:`-prefixed child CAN drive the
   lanes on its own subtree (NP-03's sibling-in-subtree admit row), so an over-restrictive
   binding that refuses all worker lane calls passes every green row. *Fix:* re-key P6's fixture
   to `worker:`-prefixed and drive the six lanes against an admitted child run in the lease
   subtree; add a sibling-in-subtree admit row.

4. **R1 never verifies the token file's content.** *What:* `test.mjs:726-733` checks the returned
   `session.token`, its digest inequality, the file's mode/path, and
   `sessions.authenticate(Bearer minted.session.token)` — but never reads the projected token file
   back. *Why:* a wrong mint can register a fresh session in the store (all of R1's checks pass)
   while writing the PARENT's token — or garbage — into the file the child will actually use;
   minted-not-copied on the FILE, the security boundary, is unproven. *Fix:* read the token file
   and assert its content equals `minted.session.token + '\n'` (the `tokenBytes` shape), or assert
   `digest(fileBytes) === minted.projection.tokenDigest`; assert the profile file is a valid
   closed-shape profile carrying the parent's coordinates.

5. **R4's carve-out scope is unpinned (over-broad carve-out passes).** *What:* R4 asserts only
   the ADMIT arm (lease-bound child, own subtree → 200) and P4 the non-lease 403; nothing asserts
   a lease-bound child stopping a FOREIGN or UNKNOWN run → byte-identical 403 `forbidden` (NP-02's
   foreign/unknown rows are absent). *Why:* a wrong carve-out that admits `run.stop` from any
   lease holder regardless of target passes R4+P4 and defeats the no-existence-leak law. *Fix:*
   add the foreign and unknown `run.stop` rows (same 403 bytes), exercising the store's
   `_authorizeRecursiveCommand('run.stop', …)` second layer.

Non-blocking (fix alongside the blockers): R8's session-revocation half is unpinned (the child
session is already expired when asserted — revoke the session's absence with an
`isPrincipalActive`/lease-status check on a non-expired orphan, or assert the `session.revoked`
event); R7's session proof would be stronger asserting `authenticate(...) === null`; the invented
`mintChildAuthority`/`revokeChildAuthority`/`sweepChildOrphans` signatures (drift findings 3-5)
must be locked before the wave so the implementer doesn't build to the contract's `workerId`/
`leaseDigest` surfaces and miss the suite's.
