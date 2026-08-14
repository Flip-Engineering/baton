SEEDS-VERIFY v1

[attempt: 1faf10bb-21ed-41d5-8bc7-540abddb4af6 coordinator]

Verification HEAD: `5ae2c7e5c93d99404d3a292e777dd30f7d2ead27`. Deployment profile `default@fd281d64809b9862529f8957fcab6505c3bbe28bd354422223ef81fe26fb3f87`. Objective/result policy `explicit change_v1`.

## VERDICT: needs-fold with blockers

The row delivered all four Ring-2 seeds under `redrive1/` and its notes at the evidence-dir top level. All four carry the `[attempt: 1faf10bb-21ed-41d5-8bc7-540abddb4af6 row-seeds]` line verbatim in their first five lines, follow the Ring-2 form, and every substantive claim cites `file:line` evidence that was re-verified this session. **seed-150 and seed-151 are SOUND** (minor line-anchor drift only, one documented pattern). **seed-152 and seed-184 each carry one fold-blocking error in a ground-truth claim**; both must be corrected before the fold, hence not sound.

- **B1 (seed-152): the evidenceRef schema is misidentified.** G5/D2/D3/A1/A3 pin the evidenceRef schema as the context-cell artifact ref `{kind, mediaType, handle, digest, bytes}` (`context-call.mjs:121-132`). The WORKFLOW SURFACE's actual `evidenceRef` field — the subject of #152 ("the evidenceRef schema as data") — is the closed `oneOf {coordinationSeq:int≥1} | {artifactId}` at `application-semantics.mjs:159-164`, applied at `:1366` (knowledge seed), `:1728` (board), `:1745` (run). The seed's G5 claim ("the only landed evidenceRef shape in the codebase") is factually wrong: the `{coordinationSeq} | {artifactId}` oneOf is landed and IS the `evidenceRef` field schema. The pinned `{kind, mediaType, handle, digest, bytes}` ref is real but belongs to the context-cell/context.read domain (seed-151's territory), not the workflow surface's evidenceRef.
- **B2 (seed-184): G2/A1 mischaracterize the kernel's oversize behavior.** G2 claims "the kernel's oversize throw is the generic `application_intent_invalid` family … the byte count … exists only where a driver author remembered to add it." Reality at HEAD: `run.objective` oversize at `run.start` admission composes the COUNTED coaching refusal `spill_body_exceeded` with `{cap, actual, unit}` (`application.mjs:4524-4527`; the code comment explicitly says "never the numberless `application_intent_invalid` of the worker-AX error-quality receipt"). The 4096→1 MiB band is gracefully spilled (`mintSpill`, `application.mjs:4531`) — the byte count is NOT surfaced to the author, so the seed's core point (the 4096−60B budget is agent-discipline for that band) survives, but via the spill path, not a generic error. `wave.member.objective` admission is shape-checked only (`application.mjs:2016-2017`, `:12082-12083`) — no byte enforcement at the admission point at all, which is worse than a generic error. The seed correctly verified the driver doc's `application.mjs:1094-1096` / `validText` `:225-226` citations are ABSENT at HEAD, then adopted that stale doc's behavior description ("generic intent error") as the kernel's actual behavior. A1's mechanism statement ("gets the generic intent error (G2), not a counted refusal") is factually wrong; A1's RED pin (a counted wave-member admission refusal) is still RED for the wave-member leg.

Both blockers are diagnosis errors, not fabrications: every `file:line` cited is real and re-verifiable, and the seeds explicitly record their honesty gaps (the stale-citation absence in seed-184 G2; the OQ4 issue-body gap in every seed). The seeds are otherwise well-formed and the row's self-verification notes are accurate about what it did NOT verify.

## What was verified (per seed)

Row deliverables read in the row worktree `ws-f5311d9518037a0390a2ccf55f141f16`:
`redrive1/seed-150.md`, `redrive1/seed-151.md`, `redrive1/seed-152.md`, `redrive1/seed-184.md`, and top-level `notes-row-seeds.md`.

### seed-150 — coaching-payload passthrough (SOUND)
- G1: `coachingApplicationError` composes `{code, cap, actual, unit, gracefulPath}` (`application.mjs:243-252`, throw at `:252-255`; seed cites `247-252` — anchor starts 4 lines late). `coachingValidationError` (`messages.mjs:228-235`), `composeFrameLimitRefusal` (`limits.mjs:40-42`), `frameLimitRefusalPath` (`limits.mjs:45-47`). Confirmed.
- G2: `COACHING_REFUSAL_CODES` (`mcp-northbound.mjs:208-212`), `laneCraftedToolError` (`:220-250`), `stateFailureCode` preserves coaching codes (`:329-333`, check at `:333`). Confirmed.
- G3: web coaching arm emits 413 `{code, message, field, cap, actual, unit, gracefulPath}` (`web-northbound.mjs:256-272`); `coachingWireField` (`:407-410`), `COACHING_LANE_FIELD` (`:372+`), `COACHING_CODE_FIELD` (`:391+`). Confirmed.
- G4 (the divergence claim — MCP bare triple vs web triple+`field`+`message`) confirmed by direct comparison of both arms.
- G5: feedback packet `exactObject {summary, findings}` (`application.mjs:1656`), `SECRET_SHAPED_TEXT` (`:327`). Confirmed.
- Spot-audit passed; the web `field` synthesis being the mutation D3 refuses is accurate.

### seed-151 — spill query kind run-horizon authorization (SOUND)
- G1: `context.read` on the worker's authenticated up-channel (`coordinator.mjs:13007-13021`); closed wire payload refuses caller-named runId/scope (`:11186-11196`); `runId` derived from `task.runId` (`:11197`). Confirmed.
- G2: closed payload shape, `context_read_invalid` (`:11188-11195`). Confirmed.
- G3: spill grammar + `context_not_found` + `_renderContextRead` spill branch (`:11318-11331`; grammar regex at `:11322-11324`, seed cites `:11318-11321` — 3-line drift). Confirmed.
- G4: `materializeSpill` returns `{spillId, digest, bytes, body}` only (`coordination-store.mjs:13568-13572`). Confirmed — no origin-run field.
- G5: sibling horizons — `knowledge` via `_runHorizonNodeIds` (`:11246-11249`), `finding` resolve-then-authorize with `context_scope_forbidden` (`:11258-11272`), `board` binding (`:11302-11304`); spill branch checks only grammar+existence. Confirmed — the asymmetry is real.
- G6: `_runHorizonNodeIds` (`:11668-11692`; seed cites `:11673-11692` — 5-line drift). Confirmed.

### seed-152 — workflow-surface disclosure + evidenceRef schema (BLOCKER B1)
- G1: `waves.list` observe verb, registry-projection sourcing, embedded+cli+mcp+web (`application-semantics.mjs:1622-1624`, `:1626`); lane `waves.start/progress/list/run/send/stop/attach/compile` (`:1622-1661`; `impl/MCP.md:95-158`). Confirmed.
- G2: `waves.progress` ≤16/page, `{cursor, nextCursor}`, bounded `{role, phase, progressClass, attention, knowledge}` (`impl/MCP.md:115-118`); README.md:85 #132 roster projection. Confirmed.
- G3: per-principal sanitized projections (`docs/32-reflexive-orchestration.md:197-199`). Confirmed.
- G4: run view discloses manifest digest + count only (`web-operator.mjs:163`). Confirmed.
- G5: **incorrect schema identification** (see B1). The individual anchors it cites are all real (`context-call.mjs:121-132`, `context-authority.mjs:146-159`, media types at `context-call.mjs:61-62`), but they describe the context artifact ref, not the workflow surface's `evidenceRef`.
- Closed-refusal anchors it cites are real: `context_artifact_integrity` (`context-authority.mjs:156`), `artifact_unavailable` (`mcp-northbound.mjs:318`), `application_run_view_oversize` (`web-northbound.mjs:219`, `mcp-northbound.mjs:256`). These are accurate but in the wrong domain.

### seed-184 — law-list bug farm (BLOCKER B2)
- G1: `run.objective`/`wave.member.objective` = 4096 (`limits.mjs:56-57`); `composeFrameLimitRefusal` (`:40-42`), `frameLimitRefusalPath` (`:45-47`); driver precheck at 3800B (`run-task-wave.mjs:65`); post-salt >4096 rejection with byte count (`docs/37-wave-driver.md:77` saltObjectives, `:89-94` and `:119`). Confirmed.
- G2: stale-citation absence claim CONFIRMED (`validText` is at `application.mjs:322`, not `:225-226`; `application_intent_invalid` shape throw at `:1557`, not `:1094-1096`; the driver doc's citations are stale). But the derived claim about the kernel's oversize behavior is wrong (B2).
- G3: `v19-flood-2026-08-14.sh:4` "11 bumped (v18/v17-era keys burned) + 4 free" confirmed; `redrive<N>/` path bumps (`:32-58`); persistent launcher already-started guard (`persistent-launch-2026-08-14.sh:10-15`) and retry-until-admitted (`:16-29`); commit `5939e6bd` #209 origin confirmed verbatim.
- G4: admission poll, retries 3× with `web.command_admitted` (`v19-flood-2026-08-14.sh:21-26`; outer retry loop at `:14`). Confirmed.
- G5: partition law (`row-seeds-brief.md:18`); `debugGateRefusal` (`application.mjs:1005`), in/out-of-scope digests (`:978-981`, `:1619`); GT6 shape in `worker-delivery-push-2026-08-07/contract-fold.md` (digests at `:955-961`). Confirmed.

## Spot-audit (the two claims audited against the repo — both caught real errors)

1. **seed-152 G5 "only landed evidenceRef shape"** — audited against the actual workflow-surface `evidenceRef` field and CONTRADICTED (`application-semantics.mjs:159-164` is landed and IS the evidenceRef schema). → B1.
2. **seed-184 G2 "kernel's oversize throw is the generic application_intent_invalid family"** — audited against the run/wave admission path and CONTRADICTED (`application.mjs:4524-4527` composes the counted coaching refusal; `:2016-2017`/`:12082-12083` shape-check wave member objectives only). → B2.

Beyond the required two, every other ground-truth claim in all four seeds was checked against source; the only deviations found are the line-anchor drift pattern noted above (function starts a few lines before/after the cited anchor; the anchored claim itself holds).

## What was NOT verified and why

- **The four issue bodies (#150/#151/#152/#184).** `gh` unauthenticated in this worktree; numbers absent from repo history. Each seed records this as OQ4 with the re-scope risk. Not a fabrication gap — the row brief sanctions repo grounding.
- **The `signalOnMembersDone` signal.** It has NOT arrived as of this write. The row's wave receipt (`w-558.jsonl`) shows its last activity is still tool calls (evidence re-verification for watcher/partition anchors); the row's deliverables are UNTRACKED in its worktree (not committed). Verified on disk per the #174 law (silence is not death; read the row's notes). Risk: the row may still amend the seeds.
- **A live wave.** No wave was launched or executed for this row; every claim is a static repo citation. The row's notes say the same.
- **The `{coordinationSeq} | {artifactId}` evidenceRef's per-violation semantics** (temporal_incoherence / missing_evidence / application_knowledge_seed_invalid) — present in the repo and in the Explore agent's evidence map, but not asserted by seed-152 (which pinned the wrong schema), so not part of the row's claims.

## DECISION_REQUEST — authority-class ambiguity

1. **Deliverable placement (top-level vs `redrive1/`).** The dispatch pathScope for this run is `docs/reference/evidence/contract-seeds-2026-08-14/redrive1/**`; the coordinator brief says "Write verify-notes.md (this dir)" where "this dir" is the brief's own directory (top-level evidence dir); the wavefile declares the coordinator report `verify-notes.md` (relative → top-level); every prior redrive1 coordinator (impl-plan-object, impl-gate-digest, eval-r0) placed verify-notes.md at the evidence-dir top level. The row resolved the identical tension by splitting (seeds in `redrive1/` per scope, notes at top-level per the wavefile report path). **This verify-notes.md follows that same resolution** (top-level, alongside the row's notes). Options: (a) accept top-level as the coordinator report home and treat `redrive1/**` as the work scope only — the reading I acted on; (b) require the coordinator deliverable also in `redrive1/`. The harvest's report path is `verify-notes.md`; (a) satisfies it.
2. **Seed-152's re-scope.** Because G5 pinned the wrong schema, the fold must decide whether #152's "evidenceRef schema as data" means (a) the workflow surface's `{coordinationSeq} | {artifactId}` evidenceRef — my reading — or (b) the context artifact ref `{kind, mediaType, handle, digest, bytes}` the seed pinned, which would make the seed a context.read-lane disclosure rather than a workflow-surface one. This is the single highest-impact authority question for the fold.
3. **Seed-184's re-scope.** G2 must be rewritten to the actual kernel behavior (counted coaching refusal for `run.objective`; spill for the 4096→1 MiB band; shape-check-only for `wave.member.objective` at admission). The fold decides whether D1's machinery is "extend the counted refusal to wave-member admission" (narrower than the seed's framing).
4. **Row deliverables uncommitted.** Whether "settled" for harvest purposes is written-to-disk (per #174) or committed. Flagged for the dispatcher; no action taken.

## Deployment verification command

Executable: `true` · argv: `[]` · cwd: `.` · expected exit: 0. Ran in this worktree; exit code 0.

## Judgment calls recorded

- VERDICT is "needs-fold with blockers," not "sound," because both errors are in ground-truth claims the fold would rely on (schema identity; kernel admission behavior). Neither is a fabrication, and neither invalidates the seed's core proposal (seed-152's disclosure-of-closed-shape goal; seed-184's wave-member counted-refusal goal) — they misidentify the current-state facts the fold starts from.
- Minor line-anchor drift (function/block starts a few lines from the cited anchor; the anchored claim holds) is recorded as a pattern, not a blocker.
- The row's honest gaps (stale-citation absence verified; OQ4 issue-body gap) are accurate and were independently re-confirmed.
