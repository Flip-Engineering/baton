# swarm-b/swarm — audit of the swarm surface (participant "swarm", work-swarm)

Scope: impl/src/swarm-{state,runtime,contract,surface,client,native-access,native-bridge,event-schemas}.mjs, native-subagent-view.mjs, native-subagent-observations.mjs, messages.mjs, docs/39 + docs/36, prior audit dirs 2026-09-13-runtime-policy and 2026-09-14-swarm-communication, impl/scripts/{run-suite,suite-verdict}.mjs + expected-red-tests.json. Method: full reads with line anchors, cross-checks into coordinator.mjs/coordination-store.mjs/claude-session.mjs where my files make claims about them, and a live exercise of the surface from inside this swarm (the audited harness auditing itself). Prior audits were treated as claims and re-verified; where a prior doc flagged an item open, that is labeled.

Live receipts used below (all commands run as participant "swarm" via node "$BATON_SWARM_CLIENT"):
- swarm.view (unscoped): caller.permissions ["read","communicate","contribute"], availableActions includes "swarm.capture"; couplings writer-shared-checkout shows "writer": "giants", "workspaceId": null; sync-reports-in shows awaiting all four members.
- swarm.view {"participantId":"swarm"} returns "couplings": {} — my own barrier is invisible in my scoped view.
- swarm.watch {"timeoutMs":1000} → "watch": {"reason": "timeout", "afterSeq": 19998, "matchedSeq": null, "event": null}.
- Refusal probes (verbatim): swarm.view {"swarmId":"audit-a"} → 403 "This swarm bridge token is bound to another swarm" (swarm_bridge_swarm_mismatch, detail {"requested":"audit-a","authorized":"audit-b"}); swarm.nope → 404 "unsupported swarm command swarm.nope" (swarm_command_unavailable); swarm.view {"participantId":"ghost"} → 422 "Participant is unavailable in this swarm" (swarm_participant_not_found); swarm.update work_updated without payload → "needs a payload object naming workId" + minted commandReceipt.idempotencyKey; payload typo "dependson" → "payload.dependson is not a field of swarm.work_updated (fields: swarmId, workId, objective, status, expectedVersion, basis, dependsOn)"; swarm.capture of lead → "This swarm has not granted review authority to this participant" (swarm_permission_required, detail {"permission":"review","participantId":"swarm"}).
- swarm.guide to lead → {"ok": true, "result": "ok", "emulated": false} + minted receipt.

## FRICTIONS

F1. Scoped view hides the couplings you must act on. swarm-runtime.mjs:438-440 keeps a sync coupling only if "a group the subtree does not fully own is omitted": (swarm.groups?.[record.groupId]?.members ?? []).every((member) => scopeSubtree.includes(member)). Live: my scoped view (the self-view a participant actually reads) returns "couplings": {} while sync-reports-in lists me in "awaiting". docs/39-swarm-runtime.md:242-244 promises "a scoped (participantId) view shows exactly the couplings the subtree can act on" — I can and must act (arrive) on the omitted one.

F2. Retry guidance leads guide/stop into a permanent refusal. swarm-native-bridge.mjs:385-386: "the minted key is printed back as commandReceipt.idempotencyKey so a retry can pass that key explicitly"; per-field help :403 repeats it. But swarm-runtime.mjs:140-144 refuses any non-replaySafe retry whose first attempt failed: refuse('The prior operation needs reconciliation before its effects can be repeated', 'swarm_operation_unconfirmed') — only swarm.recruit and swarm.holder_released pass replaySafe (:572, :701). For guide/stop the printed key is a wedge, and the message names a reconciliation step that exists nowhere.

F3. Refusals are invisible to the swarm. Contract and permission refusals throw before any durable record (swarm-runtime.mjs:602-618), and _holderRelease's eligibility check refuses before _once too (:537-539), so swarm.watch never wakes on them — yet the bridge still mints and returns a commandReceipt on the error path (swarm-native-bridge.mjs:456-458). A participant can be refused repeatedly and no follower can observe it. (Corroborates the 2026-09-14-swarm-communication "refusal observability" priority.)

F4. swarm.check results have no decision vocabulary. runtime.mjs:736-737 always records decision: 'comment' with the verdict only inside prose: reason: 'Check ${args.checkId}: ${checked.passed ? 'passed' : 'failed'} for ${checked.sha}...'. Acceptance aggregation (_acceptedContribution, :174-179) reads decisions only, so a failed check is indistinguishable from a comment. A repeated check computes a fresh result but skips the review write when the key exists (:734 if (!this.store.priorCoordinationEvent(key))) without marking the response as "prior record stands". Self-check remains permitted (:604-607), matching root.md #269/#268 "open".

F5. role carries the whole objective prose, and every view ships it. swarm-runtime.mjs:687-689 writes role: args.objective on join; inspect clones participants whole (:260 ...clone(participant)). Live unscoped view returns multi-KB role strings per participant. (native-swarm-exercise.md G6 "still TRUE" per re-verification.)

F6. Two stale "inspect" spellings point at a command that does not exist. docs/39-swarm-runtime.md:148: "expose create, list, inspect, watch, update..." (the command is swarm.view, contract.mjs:50); SWARM_NATIVE_GUIDANCE, swarm-native-access.mjs:56: "use the permitted event kinds shown by inspect". An agent that follows its own onboarding text greps for a verb the registry refuses.

F7. swarm.list silently filters unreadable swarms to nothing. swarm-runtime.mjs:580-583: try { this._permit(swarm, principal, context, 'read'); return true; } catch { return false; } — "no swarms" and "swarm exists but you cannot read it" are indistinguishable. (native-swarm-exercise G7 residual, re-verified TRUE.)

F8. Oversize decision-question refusal quotes the wrong size in its message. messages.mjs:275 composes the golden boundary text: errors.push(composeFrameLimitRefusal(FRAME_LIMITS['decision.question'], MAX_DECISION_QUESTION_BYTES + 1, MAX_DECISION_QUESTION_BYTES)) — the text names cap+1 while the caller's real byte count rides only error.actual (:270). The comment documents the tradeoff; the visible message still misstates the caller's payload.

## GAPS

G1. holder_released deadlocks on any left member's stale group seat — NEW, not in prior docs. A leave never evicts group seats (swarm-state.mjs:420-431 only rewrites the participant row), but every group fold requires all members active (:434-438: if (member.status !== 'active') integrity('group member ${memberId} is not active...', 'participant_not_active')). _holderRelease rewrites each group minus only the holder (swarm-runtime.mjs:556-560 members: group.members.filter((member) => member !== holder.participantId)) and trial-folds (:562-565). So once any member has left, releasing a DIFFERENT gone holder's seats refuses forever until someone hand-writes a regroup. The operation built for "release gone holders" is bricked by the most common preceding event.

G2. The exclusive-writer guarantee is inert without a recorded workspace. swarm-state.mjs:550-556 checks conflicts only "if (workspaceId !== null)". Live: coupling writer-shared-checkout in this swarm has "writer": "giants", "workspaceId": null, so the only guard that makes "one writer per checkout" true can never fire here. docs/39:229-231 promises the refusal unconditionally; coupling.md listed it open — it is now live-proven in a production swarm.

G3. A failed effectful operation wedges its idempotency key with no recovery path. _once records swarm.operation_unavailable (:153-158) and every later same-key call refuses swarm_operation_unconfirmed (:140-144); the attention row shows it (inspect :350-356) but no verb clears or reconciles it. The only escape is inventing a new key — which the error message never says.

G4. Swarm bodies have no size policy anywhere. swarm-event-schemas.mjs:19: "No size or count limits are declared here — the runtime's frame-limit catalog owns size policy" — but limits.mjs ADMISSION contains no swarm.* row; the only bound is wire.frame 1,048,768... (limits.mjs:89, 1,048,576 bytes) at the bridge. validateBody (swarm-state.mjs:91-113) is shape-only, and inspect deep-clones the entire swarm on every read (:426 ...clone(swarm)), so a maximal body lands durably and ships in every view, for every participant, forever.

G5. Closed swarms keep mutating. Only recruit checks status (swarm-runtime.mjs:666 if (swarm.status !== 'open' && command === 'swarm.recruit')); the generic swarm.update path (:619-664) accepts contributions, reviews, couplings, assignments and context writes after swarm.closed. inspect raises closed_with_live_participants (:345-347) but nothing marks a closed swarm that is still accumulating records.

G6. availableActions advertises actions whose second gate refuses. runtime.mjs:367-376 derives actions from permission names only; swarm.capture of another participant additionally needs review (:704-707) and any capture needs a live worker binding (_worker :83-91). Live: my view advertised "swarm.capture", and capture of lead refused "This swarm has not granted review authority to this participant". The advertised set is not the executable set, with no qualifier in the view.

G7. An unidentified contributor is auto-enrolled with full grants. swarm-runtime.mjs:626-630: when no caller and no participantId, the runtime mints external-<hash> with role: 'External orchestrator', permissions: [...SWARM_PERMISSIONS] — organize, recruit, stop, review included — as a durable participant row. Least-privilege is the default everywhere else (recruit grants default to read/communicate/contribute, :20); here the default is maximal.

G8. Refusal detail dies at the state layer, and attention leaks request bodies. State-layer refusals carry detail: null (swarm-state.mjs:41-48) and integrity() has no detail channel at all (:62-64) — e.g. version_conflict and participant_not_active surface without naming the row. swarm_replay_conflict (:134-135 and coordination-store.mjs:12826) names no prior key/seq. Meanwhile operation_unconfirmed attention rows embed the full request: clone(event.payload.request) (swarm-runtime.mjs:352) and pass through scoping untouched (:360 if (row.kind === 'operation_unconfirmed') return [row]). Also in this family: delegation.complete is vacuously true for a participant with no work (work.every(...) on [], :233).

## ERRORS

E1. HIGH — docs/39:229-231 vs code+live: "One writer per checkout: a second claim over the same checkout refuses naming the current writer" — the conflict check runs only when workspaceId is recorded (swarm-state.mjs:550-551 if (workspaceId !== null)), and in this very swarm the writer record carries "workspaceId": null. Observation: live swarm.view receipt above; coupling.md:open-item already suspected it.

E2. HIGH — holder_released cannot release through a group containing a left member: swarm-state.mjs:434-438 refuses any group fold naming an inactive member, and a leave never cleans seats (:420-431), so runtime.mjs:556-560's rewritten roster fails the trial fold (:562-565). Observation: code-path composition; no test covers two gone holders in one group.

E3. HIGH — scoped-view claim contradiction: docs/39:242-244 ("shows exactly the couplings the subtree can act on") vs swarm-runtime.mjs:438-440 whole-group ownership rule. Observation: live scoped view returned "couplings": {} to a group member named in "awaiting".

E4. HIGH — projectOmpParallelTasks is dead code duplicating a live merge engine. Grep over impl/src finds zero importers of native-subagent-observations.mjs:491 export function projectOmpParallelTasks(observations); native-subagent-view.mjs:5-100 implements the same frame-merging with different rules (last-frame-wins vs projectOmp's duplicate_start/orphan_end/duplicate_end bookkeeping nobody consumes). Two derivations of one projection, one of them unreachable.

E5. HIGH — comment contradicts its code across files: native-subagent-observations.mjs:60 "claude-session.mjs currently drops tool_progress (falls to default in _handleWireObject)" — claude-session.mjs:1099-1101 calls normalizeClaudeToolProgressFrame(obj, ...) before the switch and emits native.subagent_observed. The "currently" claim is false.

E6. MEDIUM — knowledge slice cap is not "whichever binds first" for the first item: messages.mjs:779 if (items.length > 0 && bytes + itemBytes > maxBytes) break; lets item one exceed maxBytes unconditionally, against the header claim "bounds by BOTH a finding-count cap and a byte cap (whichever binds first)" (:727-728).

E7. MEDIUM — createResult's guard under-checks its message: messages.mjs:200-201 throws "a completed result must carry a verification claim (command + claimedExit)" but tests only verification.command; claimedExit can be undefined and still ships (:212 payload.verification = { command, claimedExit }).

E8. MEDIUM — the view asserts observation where nothing was observed. swarm-runtime.mjs:261-263 fabricates { coverage: 'observed_only', agents: [], invocations: [], unidentified: [] } when the worker is unbound or the coordinator lacks the method; nativeSubagentView's coverage is itself a constant label (native-subagent-view.mjs:102 coverage: 'observed_only'). Same family: delegation.complete is true for empty work (swarm-runtime.mjs:233). A view that says "observed, nothing there" / "complete" for "nothing happened" is the harness lying to itself politely.

E9. HIGH — two hand-maintained alive lists disagree inside one function: swarm-runtime.mjs:259 includes 'stopping' (['working','blocked','pending','idle','stopping']) but :293 omits it (['working','blocked','pending','idle']), so a member who left while its worker is stopping produces no member_left_session_live row — contradicting the comment at :276-277 that the row "always says who must act". docs/39:292-294 already states the cure for exactly this class: "The holds are one derivation shared with the predicate itself".

## IMPROVEMENTS

I1. Give swarm.capture optional workId/refs passthrough (contract args swarm-contract.mjs:91-95 + the two writes at swarm-runtime.mjs:715-726), or let contribution_recorded attach to an already-captured contributionId (today the fold refuses contribution_duplicate, swarm-state.mjs:653-655). Either closes the capture/completion gap in N1.

I2. Make _holderRelease's group rewrite retain only ACTIVE members (the operation's own premise is that gone holders' seats must clear), or refuse naming the exact blocking member and the remedy. One-line change at swarm-runtime.mjs:558 plus a sharper refusal.

I3. Make writer declare honest: refuse (or record an explicit caveat field) when the holder has no recorded workspaceId, so docs/39:228-231's guarantee is either true or visibly absent. Site: swarm-state.mjs:542-558.

I4. Mint one durable refusal marker (even a minimal driver event, or annotate the :unavailable record) for contract/permission refusals of stateful verbs, so swarm.watch followers can see repeated refusals; keep it under the existing attention budget.

I5. Fix the retry sentence at swarm-native-bridge.mjs:385-386 and SWARM_NATIVE_GUIDANCE (swarm-native-access.mjs:58): "a minted key replays the same attempt for recruit and holder release; for guide/stop a new attempt needs a new key." One sentence, prevents the F2 wedge.

I6. Scoped view: keep sync/failure couplings whose group roster intersects the subtree (the member can act by arriving), and omit only what it truly cannot act on. Narrow edit to the predicate at swarm-runtime.mjs:438-440.

I7. Derive both alive checks in inspect from one named set (swarm-runtime.mjs:259 and :293) — the file's own doc standard (docs/39:292-294) already prescribes single-derivation predicates.

I8. run-suite.mjs:402 prints "wrote N expected-red rows to scripts/expected-red-tests.json" but the manifest lives at impl/scripts/expected-red-tests.json (:137). Print the real path. Also: swarm.check's response should carry reviewRecorded (prior-stands vs new) and the review record should carry a checkVerdict field instead of prose-only pass/fail (swarm-runtime.mjs:734-738).

I9. Declare an admission-class row for swarm contribution/context bodies in the FRAME_LIMITS registry with the existing spill-digest-citation graceful class (the harness's own convention, limits.mjs:54), replacing the current silent path where a frame-maximal body lands durably and ships in every view (G4). No new number invented — the row follows the catalog's own lane/class discipline.

## NOVEL INSIGHTS

N1. The two contribution lanes cannot compose, and completion evidence lives only in the weaker one. swarm.capture mints the immutable revision but can never carry workId (args are exactly swarmId/participantId/contributionId, swarm-contract.mjs:91-95); contribution_recorded carries workId/refs but a body only (swarm-event-schemas.mjs:117-125); bridging them by reusing the id refuses contribution_duplicate (swarm-state.mjs:653-655); and _workEvidence counts only contributions carrying workId (swarm-runtime.mjs:183-195). Net: derivedComplete is satisfiable by prose alone; the strongest artifact in the system — a pinned sha — can never complete work, and the incentive is to write proxy prose contributions that cite the capture.

N2. Three modules keep partially-overlapping event vocabularies under one export name. SWARM_EVENT_KINDS in swarm-state.mjs:11-25 (13 durable kinds, incl. participant_joined/bound and contribution_revision_attached); SWARM_EVENT_KINDS in swarm-contract.mjs:7-18 (10 public update kinds, incl. the operation-only swarm.holder_released, excluding joins/binds/revision); SWARM_STORE_EVENT_KINDS (contract :24) that state never imports. UPDATE_PERMISSIONS (swarm-runtime.mjs:21-28) keys across both. The load-time pins (contract :28-30, :226-233) tie contract to schemas only — nothing pins state's fold set to the contract's durable subset, so drift here would be silent.

N3. One barrier, two rosters. Arrival is checked against the LIVE group roster (swarm-state.mjs:579-581 if (!members.includes(p.participantId))), the record preserves the DECLARED roster snapshot (:537-541 members = [...(ownGet(swarm.groups, p.groupId)?.members ?? [])]), and inspect's departed derives from declared vs live (swarm-runtime.mjs:409-415). On top, the schema documents declare as replace ("declare creates or replaces the record", swarm-event-schemas.mjs:96) and the fold rebuilds arrivals: [] (swarm-state.mjs:559-564) with no expectedVersion required — an innocent re-declare silently wipes every arrival.

N4. Authority by absence of identity. _caller returns null for any principal with neither a worker: prefix nor a runId context (swarm-runtime.mjs:55-57); _permit then checks nothing for a null member (:67-75); the same principal auto-mints a full-permission shadow participant when it contributes (:626-630). In this model the strongest identity is no identity, and the view renders it as caller.permissions listing all seven grants — the trust inversion is invisible in the artifact agents are told to read.

N5. Adjacent layers run opposite recovery contracts under one help text. recordSwarm trial-folds before append so "rejected edits must never poison replay" (coordination-store.mjs:12816-12835) and recordSwarm replays identical payloads by key (:12822-12829); _once instead wedges failed keys (:140-158). The bridge help teaches only the replay-safe story (F2). docs/36 §1.2 F7 ledgered four idempotency disciplines; the swarm operation-key family (key + requestDigest + :completed/:unavailable suffixes) is a fifth, undocumented there.

N6. This audit ran on the guarantees it audits — and the strongest one held by prose, not by record. The lead serialized checkout writes through writer-shared-checkout, whose record shows "workspaceId": null (E1), so the single-writer property that every participant's brief asserted ("the lead serializes writes through a declared exclusive-writer coupling") was enforced by discipline, not by the mechanism the docs describe. A coordination harness whose own production swarm cannot arm its headline guarantee has its first reproduction case right here.

## TOP 5 TO FIX FIRST

1. E2/G1 — holder_released deadlock: release cannot pass a group holding any left member's seat. Fix the group rewrite (:558) to retain active members; add the two-gone-holders regression.
2. E1/G2/I3 — writer coupling without workspaceId: make declare refuse-or-caveat so the documented single-writer refusal becomes real; this swarm is the live counterexample.
3. N1/I1 — capture/composition: let captures carry workId (or let recorded contributions attach to captured ids) so completion evidence can cite pinned revisions.
4. F2/G3/I5 — idempotency wedges: fix the retry guidance and give failed operations a stated recovery (new key), or implement the reconciliation the message promises.
5. F1/E3/I6 — scoped view: show the couplings a participant must act on (group-roster intersection), matching docs/39's own words.

Verification note: all file:line anchors were read in this worktree; executed client verified byte-identical to the audited worktree copies (md5 over the 11 assigned .mjs files). Refusals quoted verbatim from live probes; no durable state was mutated by any probe (all probes refuse before effect).
