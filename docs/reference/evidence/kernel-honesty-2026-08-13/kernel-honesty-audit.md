# KERNEL-HONESTY AUDIT — issue #169, systematic pass (attempt z2 / audit-169c)

Marker: `KERNEL-HONESTY-AUDIT v1`

Defect classes hunted, exactly two (audit-169-brief.md:4-7):
- **(a)** silent or approximate authority/recovery behavior — the mechanism acts, but the
  record doesn't say what/who/why, or a recovery that could be automatic is manual.
- **(b)** refusals that don't name their holder/cause/next action.

Method: the #147 axes (parity, discoverability, error actionability, grammar, steering fitness —
control-surface-audit/audit-brief.md:7-22) applied one layer down to the kernel; every claim
below was re-read THIS session (`grep -an`/`sed -n` for the two NUL files). No clocks, no
redesign. The deliverable is the findings table + ranked fix list.

## Access note (issue #169 itself)

`gh issue view 169` is unreachable in this environment (`gh` unauthenticated; repo private;
API 404). Instance **5** is explicitly named by the brief ("waves.* pre-gate finding — verify
the line anchors fresh", audit-169-brief.md:33). Instances 1–4 are reconstructed from the
brief's layer grid (audit-169-brief.md:20-25): writer-lease busy refusal payload; stale-lease
recovery; fencing refusal naming the fence event; resident credential ~24h death (#148). The
mapping below marks each row `#169:1..5` (inferred) or `NEW`; if a numbered instance maps
differently than inferred, only the instance label changes, not the evidence.

## Findings table

| # | Layer | Finding | Evidence (fresh read) | Sev | Concrete fix | #169 |
|---|-------|---------|----------------------|-----|--------------|------|
| F1 | coordination-store / writer lease | Busy refusal `coordination_writer_busy` never names the current holder. `claimWriterLease` throws "coordination writer is already active" / "claim is already active" in every collision path (1290, 1317, 1321-1324); the code has the live claim/lease `{pid, pidStart, acquiredAt, token}` in hand but emits none of it. `releaseWriterLease({requireOwned:true})`'s `coordination_writer_lost` ("lease was replaced", 1356) likewise withholds the replacing holder. | coordination-store.mjs:1290, 1317, 1321-1324, 1356 (NUL, read via `sed -n`) | M | Include `{holder:{pid, pidStart, acquiredAt}}` (identity + age, never the secret token) in every `coordination_writer_busy`/`coordination_writer_lost` refusal payload; add a `gracefulPath` (reclaim-after-probe or wait) so a second writer has a next action. | #169:1 (inferred) |
| F2 | coordination-store / writer lease | Stale-lease recovery is automatic but **unrecorded** — defect class (a). `claimWriterLease` silently `unlink`s stale claims (1310) and a stale prior lease (1324) with no event, no counter, no operator-visible record. Contrast resident-authority: `publish()` sets `recoveredStaleAuthority` and `publicOutline()` surfaces it. | coordination-store.mjs:1310, 1324; resident-authority.mjs:347, 384, 398, 402-414 | M | Record a `writer.lease_recovered {recovered: 'claim'\|'lease', pid, acquiredAt}` event (or a `recoveredStaleLeases` counter on the store's startup report, which already carries `state/source/checkpointEvents/replayedEvents` at 1424-1445) so the operator can see the recovery happened. | #169:2 (inferred) |
| F3 | fencing / incarnation | `stale_fence` refusals at the transport surfaces drop the current fence and turnEpoch the kernel already computed. `FenceTable.check()` returns `{current, currentTurnEpoch}` (fence.mjs:35); every coordinator fence site returns `{ok:false, result:'stale_fence', current}` (coordinator.mjs:7276, 7387, 7433) and logs the full `{op, attempted, current, phase}` to the driver log (7269-7276). Both web and MCP collapse it: `error(409,'stale_fence')` (web-northbound.mjs:1118) and `mcpCode:'stale_fence'` (mcp-northbound.mjs:202, 2072) — neither carries `current`/`currentTurnEpoch`. A fenced principal gets a dead-end refusal with the repair value withheld. | fence.mjs:35; coordinator.mjs:7269-7276, 7387, 7433; web-northbound.mjs:1118; mcp-northbound.mjs:202, 2072 | H | Carry `{current, currentTurnEpoch}` (the fence event) in the 409 body and the MCP error `detail`; the driver log already has it — surface it. | #169:3 (inferred) |
| F4 | fencing / resident credential | The resident session's ~24h lifetime is written in two config defaults but nowhere an operator can read, and expiry surfaces as a bare `401 unauthenticated`. `sessionTtlMs ?? 24*60*60*1000` at application-deployment.mjs:1758; `maxTtlMs ?? 24*60*60*1000` at web-auth.mjs:34. The resident token is issued with `ttlMs: options.sessionTtlMs` (application-deployment.mjs:1579-1592). Expiry reads `expiresAt <= now()` → `error(401,'unauthenticated')` (web-northbound.mjs:631-633). Neither `deployment.doctor` implementation surfaces session: the facade's `doctorReadiness` (application.mjs:12429-12459) returns routes/workspace/limits, and the deployment's (application-deployment.mjs:1329-1369) adds briefing/liveness/occupancy — no session TTL, issuedAt, or expiresAt on either. A `refresh` lane exists (`advisory_refresh`/`ttl_expired`, web-northbound.mjs:486) but the 401 never names it. This is ledger #148 exactly (25 blind pump-loop iterations). | application-deployment.mjs:1758, 1579-1592, 1329-1369; web-auth.mjs:34; web-northbound.mjs:631-633, 486; application.mjs:12429-12459 | H | (1) `doctorReadiness` adds `resident:{session:{ttlMs, issuedAt, expiresAt}}` when a resident session exists; (2) the 401 distinguishes `cause:'session_expired', expiresAt, nextAction:'refresh'` from `cause:'no_credential'`. | #169:4 (inferred) = #148 |
| F5 | capacity authority | `worktree_capacity_exceeded` refusal names no free/floor/reservations. `reserveMany` throws "worktree capacity is unavailable for this reservation wave" (402) while holding `observation.freeBytes/freeInodes`, `policy.minFreeBytes/minFreeInodes`, `totals`, `wave`, `MAX_RESERVATIONS` — none included. Same class as #72's invisible capacity floors / #100's boot capacity race. | worktree-capacity.mjs:402 | M–H | Refusal payload: `{freeBytes, freeInodes, minFreeBytes, minFreeInodes, reservedBytes, reservedInodes, requestedBytes, requestedInodes, maxReservations, reservationCount}` — the numbers are all local. | NEW |
| F6 | capacity authority | Lock-busy refusal `worktree_capacity_unavailable` ("lock is busy") doesn't name the current holder; the stale reaper is automatic but silent. `_lock` reads the lock owner (320-321) then refuses without emitting it (312, 314, 318); the reaper tombstone dance (316-351) reaps a stale lock with no record. | worktree-capacity.mjs:312-321, 316-351 | L–M | Refusal includes `{holder:{pid, ownerId, generation}}` when observed; emit a `capacity.lock_recovered` event when the reaper path fires (the reaper already knows `reaperGeneration`/`observed`). | NEW |
| F7 | capacity authority | `reconcile()` dead-owner reaps and verify-row removals return `{removed, adopted, active}` (worktree-capacity.mjs:572-574) but callers surface only `adopted`; the `removed` set is never recorded anywhere an operator can audit. `index.mjs` consumes only `capacityReconcile.adopted` (index.mjs:1044-1046); `coordinator.mjs:1372` uses the report for owner-binding, not for an audit record. A boot reconcile that reaps a dead owner's reservation is invisible. | worktree-capacity.mjs:535-574; index.mjs:1044-1046; coordinator.mjs:1372 | L | At boot reconciliation, log the `removed` set as an event (same event stream that already records `removedZombieDirs` / `removedPhysicalOwners` around index.mjs:1035-1041) — the reaps become auditable. | NEW |
| F8 | worktree / snapshot-commit | Stale `.git/index.lock` from OUTSIDE baton is unhandled: `captureCommit`'s `git add -A` (worktree.mjs:1209) and `git commit` (1225) surface git's raw fatal error ("Unable to create '.git/index.lock': File exists.") with no typed refusal, no lock path, no next action. Baton's own ops are proven atomic (no lock survives a same-tick abort — worktree.test.mjs:473-476, adapter.test.mjs:789-793, 805-809), so this is an external-crash/foreign-tool class, but the brief names it and it is real: the refusal is raw, untyped. | worktree.mjs:1209, 1225; worktree.test.mjs:473-476; adapter.test.mjs:789-793, 805-809 | L | Wrap git lockfile failures in `captureCommit`/`createFromBase` with a typed `worktree_git_locked {lockPath, nextAction:'remove-stale-lock-or-wait'}` (grace-guarded: only remove a lock older than a policy-derived stale age — configurable, per the no-arbitrary-limits law). | NEW |
| F9 | dispatch/authority seams | The waves.* pre-gate dispatch draws its only authority check (`_refuseCoordinatorAuthority`, "the only authority check they draw", application.mjs:12551-12561) on start/run/stop (12560) but NOT on `waves.send` (12565) or `waves.stop` (12566). `waves.send` → `sendWaveMember` (application.mjs:11840-11893) performs **no `_authorize` at all** on the plain-message path (only the optional `claimGrant` branch requires `context.sessionAuthority`, 11859-11860); `waves.stop` → `stopWaveMember` (11895-11903) → `stop` → `_stop` DOES authorize (`_authorizeRecursiveCommand('run.stop',…)` at 13313 + `_authorize('run.stop',…)` at 13314) but a worker seat reaching it gets the collapsed `application_unauthorized` instead of the coaching `coordinator_authority_forbidden {attempted, gracefulPath}`. The seam's stated design — "this coaching refusal is the only authority check they draw" — is not drawn for send/stop. | application.mjs:12560-12566 (waves dispatch), 11840-11893 (sendWaveMember), 11895-11903 (stopWaveMember), 13313-13314 (_stop), 3225-3236 (_refuseCoordinatorAuthority), limits.mjs:141-142 | M | Add `waves.send`/`waves.stop` to the `_refuseCoordinatorAuthority` guard list at application.mjs:12560, and/or have `sendWaveMember` require `context.sessionAuthority` (or a per-run `_authorize('waves.send', …)`) on every path — matching the claimGrant branch's existing session gate. | #169:5 (brief-named) |
| F10 | dispatch/authority seams | `_authorize` collapses every denial to one undifferentiated `application_unauthorized` (application.mjs:3214-3222). The default restrictor knows the reason — `restrictingReadAuthorize` distinguishes the member's own partition, the review authority, and a foreign sibling (`worker:<scope>` vs principalId) yet returns only `false` (application-deployment.mjs:1732-1745). `_authorizeRecursiveCommand` similarly knows the command class. None of that reaches the caller. The `_refuseCoordinatorAuthority` wrapper is the only seam that emits a reason (3225-3236), and it is applied to a handful of verbs. | application.mjs:3214-3222; application-deployment.mjs:1728-1746 | M | Extend `_authorize` to accept a reason-bearing deny: the authorize function returns `{allowed, reason}` (or the restrictor throws a typed refusal), and `_authorize` maps it to `application_unauthorized` + `{cause, gracefulPath}` — the reason is already computed, only the plumbing drops it. | NEW |
| F11 | kernel API contracts | `run.result()` (episode `result` topic) materializes `state:'unavailable'` when no accepted-commit-derived result exists even when preservation pins exist, and names neither the pin nor the cause. `_episodeItem` builds `result` only from `view.result`/`binding.candidate` (application.mjs:10330), which is null when `resultSha` (acceptedCommit refs) is null (publicResult null at 7765-7774). The item `state` is `result===null ? (resultSettled ? 'unavailable' : 'pending')` (10417) and `run.episode` returns `state:'unavailable', settled:true` (11296). Meanwhile `view.preservation` can say `{state:'pinned', checkpointSha,…}` (resumeProjection, 7959) and `view.evidence` lists the commit artifact — the caller must join three sections to learn the cause. This is the fleet AX-wave shape: pin exists, result section reads empty, verdict 'harvested: none' (ledger Appendix B). | application.mjs:10330, 10417, 11296, 7765-7774, 7959; application-client.mjs:758 (`result()` → episode read) | M | When `result===null` and settled, the `result` episode item should name the gap: `{state:'unavailable', cause:'no_accepted_commit', preservation:{state, checkpointSha}, acceptedArtifacts:[…]}` instead of a bare `unavailable`. | NEW |

## Verified exact — no finding (say so, per the brief)

- **Replay is byte-exact, not approximate.** `_load()` verifies the tail is exact UTF-8
  (coordination-store.mjs:1423-1426), enforces `seq === index+1` and unique idempotency keys
  (1437-1441), re-applies every event under current policies, and treats the checkpoint as a
  parsed-event cache only — its prefix is digest-verified (1142-1173) and the tail is replayed
  from `prefixBytes` (1427-1462). `_validateRecoveryReplayTransactions` (2134) and
  `_validateGoalPlanReplayTransactions` (2196) enforce exact batch pairing (`seq`, `ts`,
  `batch.id/index/count`, digest reconstruction) and refuse a torn batch with
  `recovery_batch_integrity`/`goal_plan_batch_integrity`. No skipped record class, no loose
  recomputation.
- **Base-commit pinning is on-branch, not sideband (issue #168).** `validateOwnedWorktree`
  refuses when `meta.baseSha` disagrees with the admitted base (worktree.mjs:1005) and requires
  `merge-base --is-ancestor meta.baseSha HEAD` (1006), so the worker's HEAD must descend from the
  pinned base; `createFromBase` pins baseSha + branch + sparse identity at creation (1074-1155)
  and `captureCommit` re-validates every step (1195-1237). The snapshot commit is made in the
  worktree on `baton/<taskId>` (descending from baseSha), so a result commit cannot escape the
  pinned lineage. No finding.
- **Baton's own index.lock crash-safety is atomic and tested.** Same-tick abort/crash never
  leaves `.git/index.lock` (worktree.test.mjs:473-476, adapter.test.mjs:789-793, 805-809); the
  only unhandled lock class is foreign/external (see F8).

## Ranked fix list (orchestrator cost first)

1. **F4 (resident session lifetime + expiry naming)** — the #148 incident cost 25 blind pump
   iterations and a forced-restart re-drive. Cheap, high leverage: surface `ttlMs/issuedAt/
   expiresAt` in `doctorReadiness` and split the 401's cause. Every resident-driving agent
   reads `deployment.doctor`.
2. **F3 (stale_fence drops the fence event)** — a fenced principal's refusal is a dead end on
   both transports; the kernel already has `current/currentTurnEpoch`. Carry them in the 409
   body and MCP error detail.
3. **F5 (capacity refusal names nothing)** — an orchestrator whose wave is refused at launch
   (#100's boot race, #72's invisible floors) cannot see room to recover. All numbers are local;
   include them.
4. **F1 + F2 (writer-lease busy names no holder; stale recovery unrecorded)** — one refusal
   payload + one recorded event turns a two-writer collision from a guessing game into an
   auditable, recoverable fact.
5. **F9 (waves.send/stop missing the seam's only check)** — closes the OQ1 design gap cheaply
   (extend the guard list) and makes the seam's stated contract true.
6. **F10 (_authorize collapse)** — the reason is computed and discarded; thread it through as
   `{cause, gracefulPath}` without changing the facade's `application_unauthorized` constant.
7. **F11 (run.result() pin-exists-but-section-empty)** — name the gap in the result episode
   item so a "harvested: none" verdict is explainable from one read.
8. **F6 + F7 (capacity lock holder + silent reaps)** — low cost; refusal holder and an audit
   event for the removed set.
9. **F8 (foreign stale index.lock)** — typed refusal + configurable grace-guarded removal;
   lowest urgency because baton's own ops are proven atomic.

The four appendices' meta-lesson (ledger:122) holds here too: every finding except F8 is the
kernel acting correctly while the record withholds what/who/why — the machine knows, the surface
doesn't say.
