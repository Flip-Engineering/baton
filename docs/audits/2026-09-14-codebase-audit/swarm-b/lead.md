# swarm-b / lead.md — synthesis of a tightly coupled audit swarm

Audit date: 2026-09-14. Swarm `audit-b` (Baton), four participants, one physical checkout for the
three workers. This file is the lead's synthesis: the ten findings that matter most, what the
coupling records actually did, the refusals verbatim, timings, and the limits of what was verified.

Deliverables in this directory:

| file | author | bytes | md5 (12) | captured revision |
| --- | --- | ---: | --- | --- |
| `giants.md` | participant `giants` | 14682 | `5f21a1c9e86d` | `50065f1a0c9d` |
| `surfaces.md` | participant `surfaces` | 18983 | `26e2e32baf4d` | `e40985f97c00` |
| `swarm.md` | participant `swarm` | 21427 | `74cad5cb02e9` | `4df5a9670008` |
| `lead.md` | participant `lead` | (this file) | — | published twice — see §6.7 |

Each worker report was reviewed by the lead before its file was written; the file bytes are
byte-identical to the reviewed contribution body (md5 compared, all three match), and a
`swarm.capture` revision is attached to each contribution (`refs/baton/checkpoints/<sha>`), all
three observing the same head `f2ea904c1cb6` and the same 3 changed paths. The worker reports carry
the detail (40/38/40 items); this file does not repeat it.

## 1. The ten findings that matter most

### 1. The verification trust gate can execute a different command than the one it pinned
`impl/src/referee.mjs:113-119` closes a quoted span with `const lastQuote = command.lastIndexOf(ch);`
— the **last** quote in the whole command, not the matching one. Executed repro (giants E1):
`npm test -- --grep "one" "two"` tokenizes to `["npm","test","--","--grep","one\" \"two"]`; the
second quoted argument is destroyed and quotes are glued into the token. The gate then re-runs
Deployment verification with the wrong argv and reports the resulting `verification_exit_mismatch`
as the worker's failure. *Fix:* scan forward to the matching unescaped quote (or send any
quote-bearing command through `sh -c`), plus a two-quoted-argument test.

### 2. A stalled worker can never be killed, and the comment says otherwise
`impl/src/coordinator.mjs:9742-9743` `catch (err) { /* best-effort; the sweep still covers it */ }`
and `:9757` `cycle.answered = true; // idempotency guard (timer + sweep both reach here)`; `:9770-9772`
drops a rejected preserve/kill with `.catch(noop)`. `_sweepDeadlines` (`:3101-3133`) covers worktree
authority, approvals/questions and stop waiters — **nothing sweeps `stallSeamCycle`**, and
`_expireStallCycle` is timer-only. A stalled member stays `working` with the stall flag set and no
re-armed kill: a wait that never converges, with the only claim of redundancy living in a comment.
*Fix:* route expiry through `_sweepDeadlines`; on preserve/kill rejection clear `answered` and re-arm.

### 3. Route truth lies on the first surface an orchestrator reads
`impl/CLI.md:227-229` still lists `glm` = `glm-5.2` and `deepseek` = `deepseek-v4-flash` (primary),
while `impl/src/application-deployment.mjs:95-114` registers both on `harness: 'omp'` with
`zai/glm-5.3-flash` (`GLM_EFFORTS = ['low','high','max']`) and `deepseek/deepseek-flash`. Readiness
is derived twice and disagrees with itself: `:733-734` gates omp on repo `deepseek_key.json` /
`glm_key.json`, while the adapter's real gate is `~/.omp/agent/agent.db` (`:694-703`), and
`:746-758` hard-codes `omp: true` with the comment "its inventory is honest pre-credential".
`baton doctor` is licensed to tell an operator a dead route is ready. *Fix:* one derivation feeding
both admission and the generated table; delete the second ready-when story.

### 4. `holder_released` deadlocks behind any left member's group seat
A leave never evicts group seats (`impl/src/swarm-state.mjs:420-431`), but every group fold requires
every named member to be active (`:434-438`). `_holderRelease` rewrites each group as
`members.filter((member) => member !== holder.participantId)` (`impl/src/swarm-runtime.mjs:556-560`)
and trial-folds (`:562-565`). So once *any* member has left, releasing a **different** gone holder
refuses forever until someone hand-writes a regroup — the operation built for "release gone holders"
is bricked by the most common preceding event. *Fix:* retain only active members in the rewrite;
add the two-gone-holders regression.

### 5. The writer coupling's single-writer guarantee was inert in this very swarm
The conflict check runs only `if (workspaceId !== null)` (`impl/src/swarm-state.mjs:550-551`), and a
participant row records a `workspaceId` only when recruited with `shareWorkspaceWith`
(`impl/src/swarm-runtime.mjs:682-690`). Live records from this run: the first
`writer-shared-checkout` declare produced `{"writer":"giants","workspaceId":null}` — the checkout
owner, recruited fresh, has no recorded workspace, so the only guard that makes "one writer per
checkout" true could never fire for it. After the handoff the same coupling carried
`ws-0adf39059be73049deae7e2cd09d4d97` and the guard became live. `docs/39-swarm-runtime.md:228-231`
promises the refusal unconditionally; participant `swarm` reproduced the same record independently
(its E1/G2) and called it the run's headline: the harness's own production swarm could not arm its
guarantee, and nothing in the record said so. *Fix:* refuse (or record an explicit caveat) when a
writer declare names a holder with no recorded workspaceId; record the workspace for the first
recruit.

### 6. The pinned-revision lane can never complete work; prose can
`swarm.capture` takes exactly `swarmId`/`participantId`/`contributionId`
(`impl/src/swarm-contract.mjs:91-95`) so a captured revision can never carry a `workId`;
`contribution_recorded` carries `workId`/`refs` but no code (`impl/src/swarm-event-schemas.mjs:117-125`);
reusing the id to bridge them refuses `contribution_duplicate` (`impl/src/swarm-state.mjs:653-655`);
and work evidence counts only contributions carrying `workId`
(`impl/src/swarm-runtime.mjs:183-195`). The strongest artifact in the system — a pinned sha — cannot
complete work, while unverifiable prose can. *Fix:* let capture carry `workId`/`refs`, or let a
recorded contribution attach to an already-captured id.

### 7. The printed retry key wedges `guide`/`stop` — and the lane boundary is not documented
`impl/src/swarm-native-bridge.mjs:385-386` teaches "a retry can pass that key explicitly";
`impl/src/swarm-runtime.mjs:140-144` refuses any non-`replaySafe` retry whose first attempt failed
(`swarm_operation_unconfirmed`), and only `recruit`/`holder_released` pass `replaySafe` (`:572`,
`:701`) while `guide`/`stop` ride `_once` (`:741-752`). Refined by the lead's own probe: the
`swarm.update` lane never enters `_once` (`:619-664`), so my `swarm.work_updated` completion refusal
recurred under the **same** idempotency key instead of wedging — the wedge is real but confined to
the `_once` verbs, and the one help sentence covers both worlds. *Fix:* correct the sentence ("a
minted key replays recruit/holder-release; a new attempt needs a new key") and name that remedy in
the refusal.

### 8. The authoritative ledger is the only unsynced write, and replay refuses the tail that enables
`impl/src/coordination-store.mjs:684` `this._appendFile = opts.appendFile ?? appendFileSync;` is the
append used at `:1498`/`:1590`; every housekeeping artifact is fsynced and atomic-renamed
(receipt `:929`, checkpoint `:1009`, segment `:1337`, index `:1363`, rewrite `:1452`), and replay
refuses a torn tail at startup (`impl/src/coordination-replay.mjs:241-243`,
`truncated_tail`). Durability is inverted relative to authority: the housekeeping is crash-safer
than the truth it accelerates. *Fix:* fsync or group-commit the append, or document the accepted
loss window next to the refusal so the durability story is one story.

### 9. The view fabricates observation and hides the barrier it asks members to act on
`impl/src/swarm-runtime.mjs:261-263` fabricates `{coverage:'observed_only', agents:[], invocations:[],
unidentified:[]}` when the worker is unbound or the coordinator lacks the method;
`native-subagent-view.mjs:102`'s coverage is a constant label; `delegation.complete` is `true` for a
participant with no work (`:233`). A member's scoped view keeps a synchronization record only when
the subtree owns the **whole** group (`:438-440`), so participant `swarm`'s live self-view returned
`"couplings": {}` while `sync-reports-in` listed it in `awaiting` — against
`docs/39-swarm-runtime.md:242-244`'s own words ("shows exactly the couplings the subtree can act
on"). First-person addition from the lead: `swarm.watch` woke **10 times in 5 seconds**
(06:46:01-06) on routine run-scoped telemetry, although the filter (`:42-52`) excludes only two
kinds; a watcher burns turns without progress. *Fix:* label absence as absence
(`coverage: 'unobserved'`), derive completeness only when work exists, and show a synchronization
record to a member whose roster intersects it (arrival needs no more than `read`).

### 10. Terminality is a tier lottery: the fate clock is dead in three adapters, alive in one
`_onWallTimeout` is defined and never invoked in three adapters
(`impl/src/claude-session.mjs:1642-1650`, `impl/src/codex-appserver.mjs:1124-1132`,
`impl/src/grok-acp.mjs:979-987`); `wallTimer` is cleared but never assigned, so the `timeoutFailure`
close-branches are unreachable — while the one-shot tier still SIGKILLs on the wall clock
(`impl/src/cli-adapters.mjs:348-354`). The TERMINALITY law is thus enforced by which adapter a route
happened to pick. *Fix:* delete the vestiges or re-wire them behind one contract; assert terminality
per adapter in the contract suite.

## 2. What two or more independent workers found (higher confidence)

- **The harness lies about its own state.** giants E2/E4 (dead refusal data misreported as a spawn
  failure; a "reap" that reaps nothing), surfaces E1-E4 (route table + two readiness derivations),
  swarm E8 (fabricated coverage, vacuous `delegation.complete`) — three workers, three subsystems,
  one property.
- **Silent failure where a typed refusal exists elsewhere.** giants E6 (coverage failure recorded as
  a parse failure), surfaces F1 (vendor stderr discarded on every CLI/app-server tier), E2 (omp
  reports an unobserved sessionId), E5/E6 (grok re-sends possibly-succeeded RPCs with fresh ids;
  kimi reports an undelivered interrupt as `ok`), swarm F4 (`swarm.check` always records the decision
  `comment`, so a failed check is indistinguishable from a remark).
- **Non-converging waits.** giants E3 (unkillable stalled worker), surfaces F7 (a prompt-write
  failure leaves a turn that by TERMINALITY can never settle), swarm G3 (a failed `_once` key has no
  stated recovery), plus my own watch-wake storm in finding 9.
- **Duplicated derivations that drift.** giants N1 (three "accepted" predicates: `referee.mjs:480-487`,
  `coordinator.mjs:817-819`, `:11171-11176`), surfaces E3/N1 (two route derivations; the dead fate
  clock), swarm N2 (three event vocabularies under one export name, pinned to each other only for the
  contract's subset). This is a codebase-wide trait, not a local bug: the same fact is derived in
  several places and nothing pins the copies together.
- **Authority by accident of identity shape.** swarm N4 (`_caller` returns null without a worker
  prefix or runId, and a null member passes every `_permit`) and G7 (an unidentified contributor is
  auto-enrolled with **all seven** permissions, `swarm-runtime.mjs:626-630`). My own instance:
  a lead recruited with `recruit` but not `stop` cannot clean up the delegation it created
  (refusal quoted in §4).

## 3. What the coupling records did, and what they did not

Declared: `sync-reports-in` (synchronization, group `audit-crew`), `writer-shared-checkout`
(writer), `fail-independent` (failure policy `independent`, group `audit-crew`). Work graph:
`work-giants`/`work-surfaces`/`work-swarm` + `work-synthesis` with `dependsOn` all three.

**Did.**
1. **The barrier was a checkable fact, not an inference.** `sync-reports-in` snapshotted the declared
   roster (`members: [lead, giants, surfaces, swarm]`) and each of the three workers **arrived on its
   own** — arrival is a member's own honest report and the runtime lowers it to `read` authority
   (`swarm-runtime.mjs:612-617`), so the arrivals are worker-authored, not lead-asserted. "All
   reports in" was then a view read, not my memory.
2. **The writer record forced a real handoff discipline.** Three file writes were serialized by
   release+declare pairs on one coupling (versions 1→7), with the reason recorded at each release.
   No two writers ever held the checkout; the one rework round (§5 below) reused the same mechanism.
3. **The record outlived the sessions.** All three worker turns ended (paused) while their
   contributions and arrivals stayed in the fold; my coordination state never depended on a live
   session.
4. **The failure policy was declared honestly.** `independent` was never exercised (no worker died),
   and it is recorded as intent, not as behavior — see "did not" 5.

**Did not.**
1. **The writer's headline guard was inert for the first writer** (finding 5): `workspaceId: null`
   for a freshly recruited holder, so exclusivity was enforced by guides and discipline, not by the
   mechanism. The record does not say which of the two it was.
2. **The barrier never blocked anything.** By design — coupling is informative ("waiting never stops
   a worker", the `dependsOn` description; `docs/39` keeps gating out of scope) — so my serialization
   came from guide messages; the coupling documented it rather than causing it.
3. **The barrier was invisible to the members who had to act on it** (finding 9): the scoped view
   hid `sync-reports-in` from participant `swarm`, so discovery came from the lead's guides.
4. **Arrivals carry no timestamp** in the view (only participant ids), so "when did each report
   arrive" is not answerable from the swarm artifact; I had to read my own watch log (06:46:06 /
   06:50:49 / 07:00:59 from contribution records instead).
5. **Nothing acts on a member death.** Release is organizer-invoked, `holder_released` deadlocks
   behind a left member's seat (finding 4), and my grant had no `stop`, so a dead worker's session
   could not have been reclaimed by me at all — the root must do it.
6. **Re-declaring a synchronization point silently wipes arrivals** (`swarm-state.mjs:559-564`).
   I never re-declared, which is the only reason the three arrivals survived; an innocent re-declare
   would have erased them with no refusal and no version guard.

## 4. Refusals, verbatim

Lead (this session; JSON on **stderr**, exit 1 — a caller reading stdout sees nothing):

- `{"ok":false,"error":{"message":"swarm.update request is invalid: unknown field key","code":"swarm_command_invalid","detail":{"field":"key"}}}` — accompanied by `"commandReceipt":{"idempotencyKey":"6568f2c0-c187-4fbd-bc8f-0ab6275311e8"}`: the bridge mints and returns a receipt **on the error path**.
- `This swarm has not granted stop authority to this participant` (`swarm_permission_required`, detail `{"permission":"stop","participantId":"lead"}`) — the lead that recruited the workers cannot stop them.
- `Work completion is unproven: no accepted contribution references this work. Record an accept review on a contribution that names it, or cite accepted contributions with basis.contributionIds.` (`swarm_completion_unproven`) — returned twice under one idempotency key (see finding 7: the `update` lane is not wedged).
- `swarm.capture request is invalid: unknown field idempotencyKey` (`swarm_command_invalid`) — capture refuses the explicit replay key the bridge's own help tells callers to pass; the auto-minted key works.

Participant `swarm`'s live probes (quoted from its report, run as a three-permission participant):

- `{"swarmId":"audit-a"}` → 403 `This swarm bridge token is bound to another swarm` (`swarm_bridge_swarm_mismatch`).
- `swarm.nope` → 404 `unsupported swarm command swarm.nope` (`swarm_command_unavailable`).
- `{"participantId":"ghost"}` → 422 `Participant is unavailable in this swarm` (`swarm_participant_not_found`).
- payload typo `dependson` → `payload.dependson is not a field of swarm.work_updated (fields: swarmId, workId, objective, status, expectedVersion, basis, dependsOn)`.
- `swarm.capture` of another participant → `This swarm has not granted review authority to this participant`.

## 5. Timings (UTC, from durable records)

| time | event |
| --- | --- |
| 06:27:18 | swarm `audit-b` created; 06:27:21 lead bound as `w-2` |
| 06:29:35 | objectives drafted; 06:29:46-47 plan + per-worker objectives written to shared context |
| 06:29:54.590 / :55.131 / :57.086 | workers bound: `giants` (w-3, recruit 3.87 s), `surfaces` (w-4, 0.55 s), `swarm` (w-5, 0.95 s) |
| 06:30:12.7 | group `audit-crew`; work units 06:30:12.9-13.8; assignments; couplings 06:30:15.07 |
| 06:32:54-06:42:56 | lead's watch loops: five consecutive timeouts, no event (the filter is real, then it isn't — §1 finding 9) |
| 06:46:06.216 | `giants` contribution (seq 29813) — **16.1 min** after binding |
| 06:46:21 / :26 | `giants` arrival + hand-raise; accept review |
| 06:47:20 | `giants.md` written (14682 B) |
| 06:50:49.844 | `surfaces` contribution (seq 33083) — 20.9 min |
| 06:51:20 | accept + writer handoff (coupling v3, first record with a real `workspaceId`) |
| 06:53:39 / :47 | `surfaces.md` written (19019 B) / WROTE |
| 07:00:58.827 | `swarm` contribution (seq 33563) — 31.0 min |
| 07:01:37 / 07:02:07 / 07:02:32 | accept / `swarm.md` written (21427 B) / WROTE |
| 07:03:15 / :17 | writer handed back to `surfaces`; **comment** review (artifact fidelity defect) |
| 07:16:15 | byte-identical fix verified (18983 B, md5 `26e2e32baf4d`) — **13.0 min** of rework for a transcription error |
| 07:16:38-42 | three `swarm.capture` revisions attached (`50065f1a0c9d` / `e40985f97c00` / `4df5a9670008`), all observing head `f2ea904c1cb6`, 3 changed paths each |
| 07:17:23 / :25 / :34 / :35 | `lead.md` contribution (md5 `9cb2c0312382`, 20624 B) / self-review accept / writer coupling released / `sync-reports-in` released with all four arrivals |
| 07:18:26 | lead revision 2 contribution (numbers patch, md5 `d65ce23a369a`) |
| 07:19:41 | participant `swarm` ran the deployment verification in the shared checkout (see §6.1) |

Total: swarm creation → final synthesis **50 min** (06:27:18 → 07:17:35); worker analysis 16.2 / 20.9 / 31.0 min; review latency
(contribution → accept) ≤ 40 s each. The single most expensive event was not analysis but the
artifact-fidelity rework; the review loop caught it only because the lead byte-compared the written
file against the reviewed contribution — nothing in the surface does that for a text deliverable.

## 6. Limits and deviations (recorded, not hidden)

1. **The deployment verification ran — by a worker, after the lead declined to run it.** The swarm
   brief says "do not run the full suite"; the dispatch carries `node impl/scripts/run-suite.mjs` as
   the verification contract. I obeyed the task-level constraint (the deliverable is documents, and
   the dispatch gives no precedence rule between an objective constraint and a verification
   contract — an agent must choose, and the choice is invisible unless the agent says so), and
   participant `swarm` then ran it anyway in the shared checkout. **Reported result (07:19:41,
   verbatim numbers from that participant): exit 1 — RED, 4701 passed, 449 expected red (0 stale, 0
   hung, 0 stalled), 33 unexpected failures; classification: 21 environmental (no provider
   credential projected into the worker runtime for this route — phase78/79/80/83 + feedback-forge),
   ~8 spawn-child adapter failures consistent with the same missing projection, 4 convergence-deadline
   timeouts consistent with load; zero failures reference `swarm-*`, `native-subagent-*`,
   `messages.mjs` or `docs`; `surface-gate` passed before the tests (one informational line: 3
   host-local tools not advertised over the resident bridge); full log artifact 19.** The
   classification is that participant's; the exit code and counts are the deployment's. The audit
   files themselves are not implicated, and the verification contract is **not** satisfied on this
   base for reasons outside this swarm's scope.
2. **Read-only audit.** No source file was modified. The only writes are the four files in this
   directory. The three worker reports were *mirrored* byte-identically into the lead's checkout
   (md5 equality checked) so the root's capture of the lead's run is complete; the shared checkout
   carries the originals.
3. **Evidence strength varies.** `giants` E1 is an executed repro; every coordination finding in
   this file is a live observation; most others are code-read with file:line anchors and verbatim
   quotes. Confidence labels are per item in the worker reports. I did not re-verify the workers'
   code claims line by line — the review checked claims against quoted code, not the whole base.
4. **The lead's own synthesis contribution is self-reviewed.** The runtime has no rule against
   self-review (`swarm-runtime.mjs:656-659` only pins the reviewer to the caller), and this swarm has
   no second reviewer; the acceptance is not independent review and is labelled as such.
5. **`swarm` used native subagents** for part of its prior-audit re-verification. By the dispatch's
   own words they are observed but not governed by Baton: their investigation is not reproducible
   from the swarm record.
6. **One checkout for three workers** was workable for a read-heavy audit; it means any file a worker
   leaves is visible to the others, and the writer coupling is the only protection against
   interleaved writes.
7. **`lead.md` is published in numbered revisions on `work-synthesis`.** Revision 1
   (`contribution-b243166508535b2a4051b91d22175b3a`) recorded the reviewed synthesis as it stood at
   07:17:23 (its `md5` refers to that revision); revision 2 is the `§5` numbers patch; revision 3
   records the verification result in `§6.1`. The three worker artifacts each have exactly one
   revision and remain byte-identical to their reviewed contributions, so the "file == reviewed
   text" check holds for them. The highest-numbered lead revision is authoritative.
