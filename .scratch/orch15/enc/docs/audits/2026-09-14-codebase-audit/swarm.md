<!-- Slice report of the 2026-09-14 deep codebase audit. Author: Claude Opus 5 reading agent (audit-swarm), dispatched read-only by the root orchestrator (Claude Fable 5.1) at master f2ea904c. The root's synthesis, verification status of each item and the fixes taken are in root.md; this file is the slice report as delivered, unedited. -->

# Baton swarm slice audit

**Scope:** `impl/src/swarm-runtime.mjs`, `swarm-state.mjs`, `swarm-contract.mjs`, `swarm-event-schemas.mjs`, `swarm-client.mjs`, `swarm-surface.mjs`, `swarm-native-access.mjs`, `swarm-native-bridge.mjs`, `impl/examples/develop-with-swarms.mjs`, `docs/39-swarm-runtime.md`, `docs/36-unified-control-grammar.md`, `docs/audits/2026-09-13-runtime-policy/*`, `docs/audits/2026-09-14-swarm-communication/*`, `README.md`, `impl/scripts/run-suite.mjs`, `suite-verdict.mjs`, `expected-red-tests.json`, `seam-inventory.mjs`.

**Method:** read-only. Nothing modified, no tests run. Working tree clean at `9d5440cf` on `agent/swarm-runtime-foundation`. Two subagents read the two audit directories; every claim they surfaced was re-verified against today's source before appearing below.

**Totals:** 44 items — 9 frictions, 12 gaps, 10 errors, 7 improvements, 6 novel insights — plus the five to fix first.

---

## FRICTIONS

**F1. `availableActions` promises `swarm.update` to a read-only participant.**
`swarm-runtime.mjs:373-374` pushes `swarm.participant_left` into `updates` for *any* caller, then `if (updates.length) availableActions.push('swarm.update')`. A `read`-only participant therefore sees `availableActions: [swarm.view, swarm.watch, swarm.update]`. The real whitelist is the separate `updates` array. This is the exact field `swarm-client.mjs:9-10` instructs agents to trust ("carries the authoritative `caller` authority and `availableActions`; read those"). Hit live by the 2026-09-14 audit (`suborchestrator.md:54-55`, `probe-see.md:42-49`); unchanged.

**F2. Every view is the whole swarm, and `updatePayloads` is a fixed tax on it.**
`swarm-runtime.mjs:448-450` embeds the complete payload schema *plus example* for every permitted event kind into every `inspect()` return — 10 schemas for an organizer, on every view, every watch wake, and every mutation echo. The content is static and never changes. It belongs in a discovery call, not in the response to `swarm.work_updated`. Measured at 30-60 KB per echo by the 09-14 audit (`root.md:74`, `suborchestrator.md:129`).

**F3. Each participant's full recruitment brief is world-readable.**
`swarm-runtime.mjs:688` stores `role: args.objective`; `swarm-runtime.mjs:260` returns `...clone(participant)` with no redaction. The 09-13 exercise measured one lead's `role` alone at 1,998 bytes (`native-swarm-exercise.md:153-161`). Task #20 ("brief exposure by relationship") tracks this; nothing in the slice narrows it yet.

**F4. The `--follow` feed projects on the wrong side of the wire.**
`application-cli.mjs:1342-1353` computes `swarmWakeSummary` in the CLI, after `followSwarm` (`application-cli.mjs:1365-1369`) has already pulled the entire view over the transport for every wake. `docs/39:270-279` sells this as "never polls" — true — but the per-wake byte cost is the full swarm, and the useful 8-field summary is discarded server-side knowledge.

**F5. Three spellings of "this participant is alive."**
`swarm-runtime.mjs:259` uses `['working','blocked','pending','idle','stopping']`; `swarm-runtime.mjs:293` uses the same set minus `stopping`; `application-cli.mjs:1338` declares its own `LIVE_RUNTIME_STATES`. The complement, `gone()` at `swarm-runtime.mjs:273`, is `['dead','exited','unbound']`. A participant in `stopping` is therefore neither gone nor live-for-attention-purposes, so a member that left while its session is stopping raises no `member_left_session_live` row.

**F6. `swarm.create` reuses a membership refusal for a non-membership fact.**
`swarm-runtime.mjs:585-587` refuses a worker principal with `swarm_membership_required`. The caller is not missing membership; creation is simply the root's act. Reported at `native-swarm-exercise.md:165-168`; unchanged.

**F7. A watch interrupted by deployment close returns a foreign error code.**
`swarm-runtime.mjs:493-495` passes `watchController.signal` into `store.waitAfter`, which rejects with `coordination_wait_aborted` (`coordination-store.mjs:8527`). The runtime's own vocabulary for this is `swarm_runtime_closed` (`swarm-runtime.mjs:576`), which only guards command entry. A participant blocked in `swarm.watch` when the deployment closes gets the store's word, not the swarm's.

**F8. `swarm.list` filters silently.**
`swarm-runtime.mjs:580-582` swallows every `_permit` refusal in a bare `catch { return false; }` and returns the surviving rows. A caller with no read authority anywhere gets `[]`, indistinguishable from an empty deployment. Reported at `native-swarm-exercise.md:169-171`; unchanged.

**F9. `actionTargets` is emitted even when the actions are not available.**
`swarm-runtime.mjs:443-446` always returns keys for `swarm.capture` and `swarm.check`. For a read-only caller both carry `participantIds: []` while neither command appears in `availableActions`.

---

## GAPS

**G1. `docs/36-unified-control-grammar.md` does not contain the word "swarm" — zero occurrences.**
Verified by grep across the whole 635-line file. It is the canonical control-grammar document (its headings include `## 4. The grammar`, `### 4.1 Verb set (closed)`, `## 6. The canonical operation set`, `### 7.3 Attention kinds and responses`). The 10-verb swarm family, its 10 update event kinds, its 7 permissions (`swarm-runtime.mjs:19`), and its 8 attention kinds (`participant_runtime_dead`, `member_left_session_live`, `delegation_orphaned`, `assignment_holder_gone`, `group_member_gone`, `coupling_writer_gone`, `closed_with_live_participants`, `operation_unconfirmed` — `swarm-runtime.mjs:289-357`) appear nowhere in it. The newest and most agent-facing control surface is absent from the document that defines what a control surface is.

**G2. The expected-red manifest holds 449 rows across 47 files and not one swarm row.**
`impl/scripts/expected-red-tests.json` (75,047 bytes, `schemaVersion: 1`). Counted programmatically: 449 rows, 47 distinct files, 0 rows matching `swarm` case-insensitively. Meanwhile six swarm issues are open (#265, #268, #269, #271, #272) alongside the ten consolidated gaps of `docs/audits/2026-09-14-swarm-communication/root.md:156-171`. The red-first-spec mechanism — this repo's way of making a known gap *legitimately visible* in the gate — is not applied to the swarm slice at all. A fully GREEN suite verdict says nothing about any of them.

**G3. `worker-orchestrated-swarm-red.test.mjs` is 63.8 KB, named `-red`, and has zero manifest rows.**
It is therefore entirely passing. The filename still advertises a red-first spec that no longer exists — the inverse of the `stale expectation` the verdict does catch (`suite-verdict.mjs:77`, `:103`).

**G4. The seam inventory does not see the swarm runtime.**
`seam-inventory.mjs:72-82` declares exactly three `TARGETS`: `Coordinator` (`impl/src/coordinator.mjs`), `BatonApplication` (`impl/src/application.mjs`), `CoordinationStore` (`impl/src/coordination-store.mjs`). `SwarmRuntime` is a 755-line class touching all four seams the tool exists to count — admission (`_permit`, `_requireCompletionEvidence`), effect (`startRun`, `stopRun`, `captureContribution`), observation (`inspect`), recovery (`_once` and its replay keys). It is growing outside the machine-checked map.

**G5. Scoped `swarm.view` does not scope `context`.**
`swarm-runtime.mjs:426` spreads `...clone(swarm)`; the `keep()` calls at `swarm-runtime.mjs:427-440` cover participants, work, assignments, contributions, reviews, groups and couplings. `context` is not among them. Confirms `suborchestrator.md:67-72` and `probe-see.md:89-93` ("a lens, not an authority boundary").

**G6. Guidance has no domain existence.**
`swarm.guide` (`swarm-runtime.mjs:741-746`) writes no swarm event. It cannot be seen in a view, cannot wake a watcher, cannot be threaded, and carries no sender identity to the recipient. `probe-see.md:172-177` searched its own view for the guide text and found nothing; `probe-see.md:204-209` notes any `communicate`-holder could mint an identical frame, and the recipient cannot distinguish it from a human operator interjection. Task #19 tracks it; nothing has landed.

**G7. Refusals leave no trace anywhere.**
A `_permit` refusal (`swarm-runtime.mjs:67-75`) and the pre-`_once` `swarm_holder_live` refusal (`swarm-runtime.mjs:537-540`) both throw before any durable record is written. No event, no wake, no attention row. The only party who learns is the failing caller. Confirmed independently from inside and outside the swarm (`probe-say.md:225`, `root.md:116`); the suborchestrator learned of its probe's refusals only because the probe told it out of band.

**G8. `_worker` and `_workerFor` disagree about an unbound participant.**
`swarm-runtime.mjs:165-166` claims `_workerFor` is "the ONE lookup inspect and the holder-release eligibility check share, so 'gone' means the same thing everywhere." It is not the lookup `_worker` (`swarm-runtime.mjs:83-91`) uses. With empty `bindings`, `_workerFor` (`:167-170`) matches any worker on the runId; `_worker` matches none and refuses `swarm_participant_unbound`. `inspect` can therefore report `runtime.state: 'working'` for a participant that `swarm.guide` refuses as unbound.

**G9. `swarm_completion_unproven` has no counterpart for un-completion.**
`swarm-runtime.mjs:646-648` gates `status: 'completed'` on evidence via `_requireCompletionEvidence` (`:503-525`). `status: 'cancelled'` and a revert to `'open'` are ungated. `_acceptedContribution` (`:174-179`) reads only the last accept versus the last reject, so a later `reject` silently un-completes work whose stored status still says `completed`. The view then shows `status: 'completed'` beside `evidence.derivedComplete: false` with no attention row.

**G10. Only one failure policy exists.**
`swarm-state.mjs:35`: `SWARM_FAILURE_POLICIES = Object.freeze(['independent'])`. `docs/39:45-46` names "a group barrier, atomic admission, shared failure policy, exclusive writer, or selected quorum" as the explicit coordination choices. Atomic admission and selected quorum are not declared kinds; `coupling.md:121-123` said so when coupling landed and it is still true.

**G11. Contributions are strings; the artifacts they name are not bound.**
`swarm-state.mjs:656-661` stores `body`/`refs` with no digest tie to any file. `probe-see.md:70-76, 286-290` recorded that its own file was edited after the contribution was accepted and "nothing in the accepted review can tell". `swarm.capture` does bind a revision (`swarm-runtime.mjs:721-726`, with `sha`, `ref`, `workspaceId`, `observedHead`), but the plain-text contribution path bypasses it entirely.

**G12. The plain-text contribution shortcut cannot carry `workId`.**
`swarm-runtime.mjs:623` turns a string payload into `{ body }` only. The result lands with `workId: null, refs: null` and can never count toward completion evidence (`_workEvidence`, `swarm-runtime.mjs:183-195`, keys on `contribution.workId`), with no warning to the author. `SWARM_NATIVE_GUIDANCE` (`swarm-native-access.mjs:56`) teaches exactly this shortcut as *the* way to publish a finding. Observed live at `probe-say.md:170-185, 200, 285`.

---

## ERRORS

**E1. `swarm.recruit` on a participant that already exists returns success without re-joining it. — confidence: HIGH**
`swarm-runtime.mjs:687-691` writes `swarm.participant_joined` under the content-derived key `swarm-participant:${hash([args.swarmId, args.participantId])}`. `coordination-store.mjs:12822-12829` sees the prior event, finds kind/actor/payload identical, and **returns the prior clone without appending and without folding**. The duplicate therefore never reaches `foldSwarmEvent`, so the `participant_duplicate` guard at `swarm-state.mjs:384-386` is unreachable through the only path that writes this event.

Concretely: re-recruit a participant whose `status` is `'left'`, with the same objective and permissions, from the same actor. Membership is not restored. `startRun` proceeds. `swarm.participant_bound` (`swarm-runtime.mjs:697-699`, keyed on the new worker id, so a new key) appends a fresh binding onto a departed participant. `swarm.recruit` returns `{ participantId, runId, swarmId }` — a success receipt. The view then shows a departed member with a live runtime and raises `member_left_session_live` (`swarm-runtime.mjs:293-297`). No test covers this: I found no occurrence of `participant_duplicate` anywhere in `impl/test/`.

**E2. The same collision surfaces as a replay error when the objective differs. — confidence: HIGH**
Same path, different payload: `recordSwarm` throws `CoordinationRefusal('Swarm mutation identity already names another request', 'swarm_replay_conflict')` at `coordination-store.mjs:12826`. The caller's actual mistake is "that participant name is taken." The refusal names replay, sending the agent to look for an idempotency-key problem that does not exist.

**E3. `swarm.watch` and `inspect` copy the entire coordination ledger on every call. — confidence: HIGH**
`swarm-runtime.mjs:472` calls `this.store.eventsView().slice(cursor)` — a full-array copy followed immediately by a second copy — once per watch-loop iteration. `swarm-runtime.mjs:348` calls `this.store.eventsView().filter(...)` on every `inspect()`, which runs on every view, every watch return, and after every update. The store's own comment at `coordination-store.mjs:8500-8502` names this exact pattern: "eventsView() with no arguments copies the world (the #210 class)". `eventsView(fromSeq)` already exists and takes exactly the cursor the watch loop is holding (`coordination-store.mjs:8510-8514`); seq is 1-based (`coordination-store.mjs:12832` mints `seq = this._events.length + 1`), so `eventsView(cursor + 1)` is the same semantics with none of the copying.

**E4. The bridge's frame ceiling makes a large swarm unreadable, with no way to ask for less. — confidence: HIGH**
`limits.mjs:89` sets `wire.frame` to 1,048,576 bytes. `swarm-native-bridge.mjs:216` refuses any response exceeding it with `swarm_bridge_frame_exceeded`. `inspect()` has no projection, no pagination, and no `since` parameter. Once a swarm's view crosses 1 MiB — the 09-14 audit measured 30-60 KB for four participants (`root.md:74`) — *every* command fails for every native participant, because every mutation also returns the full view (`swarm-runtime.mjs:651`, `:664`). There is no degraded read to fall back to. Reported as "no projection" at `native-swarm-exercise.md:153-161`; the frame interaction is new here.

**E5. `maxFrameBytes` is unbounded above, and raising it breaks the bridge's own client. — confidence: HIGH**
`swarm-native-bridge.mjs:137` validates only `Number.isSafeInteger(maxFrameBytes) && maxFrameBytes > 0`. `frameRow()` (`:81-86`) happily mints a row carrying a value larger than the registry's. A deployment that raises the bound to escape E4 then gets a server emitting frames its own client hard-rejects at `swarm-native-bridge.mjs:348`, which reads `DEFAULT_FRAME_ROW.value` unconditionally rather than the negotiated bound. Flagged as a source-only observation at `native-swarm-exercise.md:179-182`; still true.

**E6. In-flight attention rows carry the full request body and bypass scope filtering. — confidence: HIGH (confirmed by live capture)**
`swarm-runtime.mjs:352` sets `request: clone(event.payload.request)` on every `operation_unconfirmed` row. `swarm-runtime.mjs:360` then returns those rows unfiltered from a scoped view: `if (row.kind === 'operation_unconfirmed') return [row];`. `probe-see.md:112-118` captured a third-party `read`-only participant reading the complete text, target and idempotency key (`90b21c94-9361-4d5f-a065-4177233d0b56`) of another participant's private guide; `suborchestrator.md:206` records the same key independently. Task #17 (#272) names the fix; not landed.

**E7. `swarm.check` mints a review row without review authority. — confidence: MEDIUM-HIGH**
`swarm-runtime.mjs:604-607` downgrades the required permission to `contribute` when a participant checks its own contribution; `swarm-runtime.mjs:734-738` then writes `swarm.contribution_reviewed`. `UPDATE_PERMISSIONS` (`swarm-runtime.mjs:26`) declares that event requires `review`. Blast radius is bounded — `decision` is hardcoded `'comment'` at `:736`, and `_acceptedContribution` (`:174-179`) ignores comments — but a contribute-only participant writes into `swarm.reviews` through a side door. This collides with #269's "refuse self-check": `swarm-runtime.mjs:369` currently *advertises* `swarm.check` to every contribute-holder, and no self-check refusal exists in `coordinator.checkContribution` (`coordinator.mjs:2448-2454`).

**E8. `docs/39:156` claims checks survive the author's session; the runtime gates them on a live worker binding. — confidence: MEDIUM**
The doc: "independent verification can run while the author continues or after its session closes." `swarm.check` first calls `_worker(participant)` (`swarm-runtime.mjs:708`), which refuses `swarm_participant_unbound` when no current worker row matches both `binding.workerId` and `participant.runId`. It happens to work today only because worker handles are never removed — I found no `_workers.delete` anywhere in `coordinator.mjs`, and `coordinator.mjs:12921-12924` returns all of `_workers.values()`. The documented guarantee rests on an unstated retention property of a different module and would not survive a resident restart that rebuilds `_workers` from replay.

**E9. Empty groups leak into every scoped view. — confidence: MEDIUM (low impact)**
`swarm-runtime.mjs:434` keeps a group when `group.members.every((member) => scopeSubtree.includes(member))`. `[].every(...)` is vacuously `true`, so a group emptied by `swarm.holder_released` (`swarm-runtime.mjs:555-560`) appears in every participant's scoped view.

**E10. `UPDATE_PERMISSIONS` has no build-time parity check against the contract. — confidence: HIGH (latent)**
`swarm-contract.mjs:28-30` asserts at load that `SWARM_EVENT_PAYLOAD_SCHEMAS` and `SWARM_EVENT_KINDS` agree, and `swarm-contract.mjs:226-233` asserts the argument tables agree with the registry rows. `UPDATE_PERMISSIONS` (`swarm-runtime.mjs:21-28`) is a third parallel table over the same closed vocabulary with no such assertion. A new event kind added to the contract would be admitted by validation and then refused at `swarm-runtime.mjs:603` with `swarm_command_unavailable` — "Swarm operation is unavailable" for an operation the surface had just advertised.

---

## IMPROVEMENTS

*(narrow; no hardcoded numeric limits as control mechanisms)*

**I1. Split `availableActions` into commands and updates, or make the entry conditional.**
The one change that fixes F1: stop pushing `swarm.update` when the only permitted update is the caller's own leave, or name it `swarm.update:participant_left`. `swarm-runtime.mjs:371-374`.

**I2. Pass the cursor to the store instead of slicing a copy.**
`eventsView(cursor + 1)` at `swarm-runtime.mjs:472` is identical semantics with none of the copying. For `inspect`'s operation scan at `swarm-runtime.mjs:348`, keep a running index of `swarm.operation_requested` keys rather than re-scanning the ledger per call.

**I3. Give `inspect` a projection argument, derived from what the caller asked for.**
Not a size cap — a shape selector (`participants` / `work` / `attention` / `all`). It resolves E4 without introducing a number, removes F2 and F4, and is the missing half of the `--follow` feed: `swarmWakeSummary` (`application-cli.mjs:1342-1353`) already proves the projection is definable.

**I4. Refuse a recruit whose participantId already exists, before `prepareRun`.**
One `Object.hasOwn(swarm.participants, args.participantId)` check at `swarm-runtime.mjs:667` turns E1 and E2 into a typed `swarm_participant_exists` naming the existing row's status. The departed-and-returning case then becomes an explicit decision rather than a silent no-op.

**I5. Add the load-time parity assertion for `UPDATE_PERMISSIONS`.**
Mirror `swarm-contract.mjs:28-30` exactly: compare the key set against `SWARM_EVENT_KINDS` and throw on disagreement. Closes E10 permanently; three lines.

**I6. Give the expected-red manifest a reason per row.**
Rows today are bare `file :: name` strings (`suite-verdict.mjs:26-29`). A row carrying its issue number would let `computeVerdict` distinguish a red-first spec from a dangling-await cancellation from an abandoned test, and would give the swarm slice's open gaps (G2) somewhere to be represented at all.

**I7. Make `_worker` call `_workerFor`.**
`swarm-runtime.mjs:83-91` and `:167-170` are two predicates for one question. Having `_worker` delegate and refuse on null makes the comment at `:165-166` true and closes G8.

---

## NOVEL INSIGHTS

**N1. The swarm's legitimacy mechanism and the swarm's gaps live in different systems, and neither knows about the other.**
449 expected-red rows encode "we know this is broken" for 47 files. The swarm slice has zero. Its equivalent knowledge lives in GitHub issues and 28 audit markdown files. The suite verdict — what `README.md:169` calls "the canonical gate: green means green" — is structurally incapable of going red for any known swarm defect. Green here means "no swarm test regressed," not "the swarm works." The 09-13 exercise found the inverse failure mode too (`native-swarm-exercise.md:186-200`): both swarm test fixtures structurally bypassed the two defects being reported (the runtime fixture forced `paused: true`; the bridge fixture's fake runtime always allowed capture), so green proved nothing about them either.

**N2. Content-addressed idempotency keys turn the durable fold's integrity guards into dead code.**
`recordSwarm` short-circuits on key match *before* folding (`coordination-store.mjs:12822-12829`); the fold only runs in the no-prior branch at `:12834`. Every runtime write that derives its key from the payload's own identity — `swarm-participant:hash([swarmId, participantId])` (`swarm-runtime.mjs:691`), `swarm-capture:hash([...])` (`:717`), `swarm-capture-revision:hash([...])` (`:726`), `swarm-external:hash([...])` (`:629`) — therefore makes the corresponding fold-level uniqueness check (`participant_duplicate` at `swarm-state.mjs:384-386`, `contribution_duplicate` at `:653-655`) permanently unreachable. The guards read as defence in depth; they are neither reached nor tested. This is a general property of the pattern, not one bug.

**N3. An external orchestrator becomes a maximum-authority participant by leaving a note.**
`swarm-runtime.mjs:626-630`: a non-member principal that records a contribution is silently auto-joined as `external-<hash>` with `[...SWARM_PERMISSIONS]` — all seven, including `stop` and `organize` — and no `parentId`. The root, otherwise invisible to participants (`probe-see.md:210-216`: "a participant without that brief text would have zero evidence of the root's existence"), materialises as an unrecruited full-authority member the moment it comments. The visibility model of task #20 wants the root visible; this is the accidental version of that, granted at the wrong moment with the wrong permissions.

**N4. Authority defaults open for any principal the transport cannot place.**
`_caller` returns `null` when the principal is not `worker:*` and no `context.runId` is supplied (`swarm-runtime.mjs:57`). `inspect` then grants `SWARM_PERMISSIONS` (`:250`) and `_permit` skips every check (`:69`). The bridge always supplies context (`swarm-native-bridge.mjs:213`), so this is safe in the path that exists. But the swarm's permission model has no deny-by-default floor of its own; it delegates entirely to the injected `authorize` hook (`swarm-runtime.mjs:578`, wired at `application.mjs:3251-3253`). That is a defensible design and it is stated nowhere in `docs/39`.

**N5. Coupling is honest about arrivals and dishonest about nothing — which is why it is the strongest part of the slice.**
`swarm-state.mjs:572-586` records arrivals and refuses to synthesise them. `swarm-runtime.mjs:399-419` *derives* `awaiting`, `departed` and `arrived` rather than asserting them, and counts only live current members so a dead seat can never hold a barrier open. The `members` snapshot taken at declare time (`swarm-state.mjs:540`) means a seat that later leaves the group is *named* rather than *vanished*. This is the pattern the rest of the slice needs: the guide lane (G6), the refusal lane (G7) and the attention lane (E6) all fail in precisely the same way — by not having a durable record with a derived projection over it.

**N6. The slice's one hard-coded control number is a watch timeout, and it is the defensible kind.**
`swarm-runtime.mjs:463`: `args.timeoutMs ?? 30000`. Under the project's no-arbitrary-limits rule this is a network-class wait, not a control ceiling, and it is caller-overridable. Worth recording because I looked for violations: this is the only one in ~2,400 lines. The frame bound derives from the `limits.mjs` registry rather than being re-declared (`swarm-native-bridge.mjs:57`), and `swarm-event-schemas.mjs:229` actively throws at load if any schema declares a size or count cap.

---

## The five I would fix first

**1. E6 — attention rows leak request bodies across the scope boundary.** `swarm-runtime.mjs:352, 360`. The only finding here with a confirmed live third-party disclosure. It needs no design work: drop `request` from the row (keep `command`), and apply the same scope filter every other attention row already gets. #272 already specifies it.

**2. F1 — `availableActions` lies to a read-only participant.** `swarm-runtime.mjs:371-374`. A two-line fix to the single field the SDK tells every agent to trust. Today it costs every honest participant a round trip and a refusal. Highest agentic-experience return per line changed anywhere in the slice.

**3. E1 and E2 — duplicate recruit.** `swarm-runtime.mjs:667`; `coordination-store.mjs:12822`. A success receipt for an operation that did not happen is the worst failure class an orchestrator can face. The fold's own guard against it is unreachable (N2) and no test covers it. One `Object.hasOwn` check plus a typed refusal closes both.

**4. E4 and E3 — the view has no projection and the watch copies the world.** `swarm-runtime.mjs:348, 472`; `limits.mjs:89`. E3 is a mechanical fix the store already supports (I2). E4 is the harder half, but together they are why a swarm gets slower and then unusable *as it succeeds* — the failure arrives exactly when the swarm is most valuable, and there is no degraded read to fall back to.

**5. G2 and G1 — the swarm slice is invisible to both the gate and the grammar.** Every item on this list would have been caught, or would at least have been legible, if the known gaps carried red-first rows and if `docs/36` described the family. Fixing this is what stops the next audit from rediscovering the same ten gaps: put the open swarm issues into the manifest as expected-red rows with reasons (I6), and give the swarm family its section in the unified control grammar.

