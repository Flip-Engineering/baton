# #69 RED-TEAM REPORT — adversarial attack on the REPL-realization contract v1.0

Red-team of `repl-realization-contract.md` (v1.0 DRAFT, same dir). Every citation below was
re-verified at the **current HEAD `b00f380dad19f182ef92e919f0c7e643ff3f3cf6`** (the contract's
stated Verification HEAD `da7bbdefc512e9957b498531b77ef8925a9a3b49` is an ancestor; the only
commits between them add docs — `impl/src/*` is byte-identical, so every code anchor re-verifies
at the current tree). The three shipped REPL red suites were re-run: **51/51 pass**
(`repl1-manifest-red.test.mjs`, `repl1-kind-inventory-red.test.mjs`, `repl23-bindings-red.test.mjs`).

Verdict summary: **NOT FOLD-READY** — 8 numbered blockers below. Three are automatic blockers
(citations verified wrong), two are structural holes in D3/D4, two are under-specified seams in
D2/D4, one is a cross-contract RED-dependency framing defect.

---

## 1. Citation re-verification — every anchor checked at HEAD

| # | Contract cite | Verified at HEAD | Verdict |
|---|---|---|---|
| C1 | application-semantics.mjs:1191-1192 `repl.manifest`/`repl.binding`/`repl.cite` in `SURFACING_MATRIX_KEYS` | :1191-1192 | ✓ |
| C2 | application-semantics.mjs:1208-1210 `SURFACING_MATRIX_AUTHORITY` | :1208-1210 | ✓ |
| C3 | application-semantics.mjs:1485-1517 canonical spec entries (kernel/ordinary, surfaces, liveMethods) | :1485-1517 | ✓ |
| C4 | docs/33:11-15 house law verbatim | :11-15 | ✓ |
| C5 | docs/33:16-21 "read-eval-print loop over closed, content-addressed objects" | :16-21 | ✓ |
| C6 | docs/33:138-143 non-goals | :138-143 | ✓ |
| C7 | docs/33:140-142 "No cross-run bindings…" | sentence spans **:139-140**, not :140-142 | off-by-one |
| C8 | spec/phase93-closed-program-ir.md:31-35 §93.1(1) | :31-35 | ✓ |
| C9 | docs/07-roadmap.md:87 "arbitrary-code REPL" | :87 | ✓ |
| C10 | docs/28:578 "general persistent REPL kernel… deferred" | :578 | ✓ |
| C11 | SYNTHESIS.md:15 "REPL / tools-as-code … no new issue" | :15 | ✓ |
| C12 | SYNTHESIS.md:154 "#131 TRACKING" | :154 | ✓ |
| C13 | coordination-store.mjs:469-473 SAFE_REPL_SCOPE/NAME/CELL_ID/DIGEST + REPL_CITATION | :469-473 | ✓ (regex matches verbatim) |
| C14 | coordination-store.mjs:475-477 MAX_REPL_BINDINGS=512 / identity key / fence key | :475-477 | ✓ |
| C15 | coordination-store.mjs:15512-15522 resolveReplCitation (exact version, never latest) | :15512-15522 | ✓ |
| C16 | coordination-store.mjs:15401 `repl_binding_cell_not_settled` | :15401 | ✓ |
| C17 | coordination-store.mjs:9936-10041 admitReplManifest | :9936-**10045** (function ends :10045) | range short |
| C18 | coordination-store.mjs:10029 `_assertRunAdmissionOpen` | :10029 | ✓ |
| C19 | run-lineage.mjs:12 / :32 `maxReplManifestsPerRun` / default = maxChildrenPerRun+1 | :12 / :32 | ✓ |
| C20 | coordination-store.mjs:15320-15418 admitReplBinding (manifest-authority, runId inherited, scope=replRole, principal equality) | :15320-15418 | ✓ |
| C21 | coordinator.mjs:11380-11393 principalId/repoId/runId from worker task, `{actor, key}` | :11380-11393 | ✓ |
| C22 | coordinator.mjs:11748-11768 binding wrapper NO scope-forcing | :11748-11768 | ✓ |
| C23 | coordinator.mjs:11781 repl.cite read | :11781 | ✓ |
| C24 | coordination-store.mjs:13178 mintContextPack / :13195-13200 contextPackHead / :13201-13209 materializeContextPack | :13178 / :13195-13199 / :13201-13208 | ✓ |
| C25 | coordination-store.mjs:492 MAX_CONTEXT_PACK_BODY_BYTES; limits.mjs:83 8KiB row | :492 / :83 | ✓ |
| C26 | coordinator.mjs:3774-3788 `_admitContextPackCitations` | :3774-3788 | ✓ |
| C27 | coordinator.mjs:3790-3839 `_providerBrief`; :3816 UNTRUSTED_CONTEXT_PACK | :3790-3839 / :3816 | ✓ |
| C28 | coordinator.mjs:3820-3825 orientation L0 grant injection | injection code is **:3826-3828** (cite covers the comment) | off-by-6 |
| C29 | coordinator.mjs:3827-3837 briefing block | augmentation code is **:3834-3838** | off-by-N |
| C30 | coordination-store.mjs:13273 context.read; :13272 zero promotion weight | :13273 / :13272 | ✓ |
| C31 | limits.mjs:56 run.objective 4096B graceful spill-digest-citation; application.mjs:4465-4485 spill admit; :306 capBytesToScalar | :56 / :4465-4485 / :306 | ✓ |
| C32 | run-task-wave.mjs:62 brief-by-reference objective | :62 | ✓ |
| C33 | coordinator.mjs:10771-10784 `CONTEXT_READ {kind:'spill'}` | spill block is **:10774-10788** | off-by-3 |
| C34 | messages.mjs:459-465 wrapFact/wrapProse provenance | :459-465 | ✓ |
| C35 | reply-chains-contract.md:98 MAX_MESSAGE_DEPTH_BUDGET=8; coordinator.mjs:12537 message_depth_exceeded; claude-session.mjs:161 sorted-key `body,inReplyTo` | :98 / :12537 / :161 | ✓ |
| C36 | run-dynamic-workflow.mjs:10, :85-93, :160-167, :265 (canary ×4, wire grammar, lead pointer) | all ✓ | ✓ |
| C37 | orchestrator-friction-ledger.md:41 "Shared objects don't exist" | row is **:42** (:41 is `|---|---|---|`) | **off-by-one** |
| C38 | orchestrator-friction-ledger.md:44 "Object-passing across the orchestration layer" | :44 | ✓ |
| C39 | control-surface-audit.md:156-163 "Cross-member knowledge is orchestrator-mediated today…" | quoted text is **:175-180**; :156 is unrelated ("…not just on the surface itself") | **WRONG — blocker** |
| C40 | coordinator.mjs:11657-11672 taskHorizon bindingFence; :11687-11710 workflowHorizon bindingFence | ✓ both | ✓ |
| C41 | application.mjs:681-712 projectReplBindingView; :67-68 MAX_REPL_VIEW_BYTES=262144 / MAX_REPL_BINDING_ITEMS=512 | ✓ all | ✓ |
| C42 | application.mjs:681 no production call site | confirmed — only tests + docs | ✓ |
| C43 | kg-settlement-decisions.md D1-D4 | D1-D4 verified | ✓ |
| C44 | messages.mjs:547-548 UNTRUSTED_WEB_CONTENT; coordinator.mjs:10796-10800 UNTRUSTED_READ_CONTENT | ✓ / ✓ | ✓ |
| C45 | coordination-store.mjs:15264-15293 `_resolveReplManifestBranch` five-coordinate outputRef | :15264-15293 | ✓ |
| C46 | context-program.mjs:1038 outputRef mint | :1038 | ✓ |
| C47 | context-program.mjs:1244 `context.cell:${sessionId}:${programDigest}` idempotency | key is built at **:1333**; :1244 is a doc-comment example | **WRONG — blocker** |
| C48 | coordination-store.mjs:8863 contextCell; :9310 contextCellArtifacts | :8863 / :9310 | ✓ |
| C49 | coordination-store.mjs:3003 recovery-refinement brief digest pin | :3003 | ✓ |
| C50 | adapter.mjs:96-163 renderBrief; :147-161 Ambient knowledge; :138 Verification position | all ✓ | ✓ |
| C51 | cli-adapters.mjs:78-109 renderPrompt; :104-105 verification contract | ✓ | ✓ |
| C52 | limits.mjs:101 view.knowledge_slice.items=8; limits.mjs:85 spill.body 1 MiB | :101 / :85 | ✓ |
| C53 | limits.mjs:40-42 composeFrameLimitRefusal | :40-42 | ✓ |
| C54 | coordination-store.mjs:15514, :15520 `repl_binding_citation_not_found` | second occurrence is **:15519** | **off-by-one** |
| C55 | `issue79-delivery-push-red.test.mjs` harness shape | no such file — actual is **`impl/test/worker-delivery-push-red.test.mjs`** | **wrong file** |
| C56 | repl23-decisions.md "docs/33 v2 rule 9 read semantics" | verified at :445-450 | ✓ |

Automatic blockers per the red-team law ("a wrong citation is an automatic blocker"): **C39, C47**
(and C55 is a wrong filename). C7/C37/C54 are off-by-one — not content-wrong, but they still fail
the "every citation re-verified" bar and must be corrected before fold.

---

## 2. Attack results by decision

### D1 — Object schema (citation = binding row + settled cell outputRef) — **SOUND** (one blocker citation)

- Closed shape verified: `REPL_CITATION` grammar (C13), binding identity/fence keys (C14),
  `resolveReplCitation` exact-version-only (C15), `_resolveReplManifestBranch` five-coordinate
  `{digest, ref, itemCount, mediaType, summary}` (C45), outputRef mint (C46), `contextCell`/
  `contextCellArtifacts` projections (C48). A REPL object is DATA; no evaluator path is added.
- **Blocking citation error:** the idempotency-key anchor `context.cell:${sessionId}:${programDigest}`
  is at **context-program.mjs:1333**, not :1244 (C47). Fix the line.
- Full-content reachability overstates the worker surface: `contextCell`/`contextCellArtifacts`
  are store-internal; the worker-facing `context.read` kinds are only `code | knowledge | finding |
  board | scratchpad | spill` (coordinator.mjs:10698-10788) — there is **no `cell` kind**. The
  bounded answer (spill lane for truncated items) does hold; the "reachable by the cell
  projections" clause should name the seam (OQ1's full-content projection) rather than implying a
  worker can call them.

### D2 — Cite-into-brief seam — **SOUND with two under-specified seams** (fix required)

- Seam shape verified: `_providerBrief` (C27) materializes cited packs + L0 + briefing; the new
  section composes the same way; the digest pin (C49) is untouched because the block never enters
  `task.brief`. Empty-citation → `undefined` → no section is a correct absence-on-empty pin.
- Dangling citation → **typed refusal, no crash**: admission refuses `repl_object_unresolved`
  (unknown binding/version; `resolveReplCitation` already refuses `repl_binding_citation_not_found`,
  C15) or `context_artifact_unavailable` (settled cell lost / §93.5 revalidation, C56). Sound.
- **HOLE (under-specified): the frame is not byte-checked.** The bounded head is rendered inline
  as `- [repl/untrusted] repl:<scope>:<name>@<version>: <bounded head>`. The contract does not pin
  newline/control-char sanitization of the head. `boundedAttentionText` (messages.mjs:526) keeps
  newlines; `sanitizeWebContent` / `stripControlCharacters` (messages.mjs:560-571) strips them. A
  crafted cell whose content contains `\n## Pending attention` or `\n## Verification …` would
  render as additional prompt lines after the frame. The frame is the only defense between an
  attacker-controlled cell and the worker's instructions — pin the head through
  `sanitizeWebContent` (or an explicit single-line collapse) in the renderer, so the frame cannot
  be structurally escaped. (The existing `UNTRUSTED_CONTEXT_PACK` seam has the same exposure; this
  contract should close it for the new lane rather than inherit it.)
- **Dependency not pinned:** D2 says the head is wrapped `wrapHubDerived(worker, text)` — but
  `wrapHubDerived` **does not exist at HEAD** (verified: no definition in `impl/src`; it is #79's
  R8′ RED pin, asserted absent by `worker-delivery-push-red.test.mjs:338`). D7 also references
  `view.attention_push.bytes` (RED, #79). The contract states these as landed in GT7/GT12. The
  realization rung must either define `wrapHubDerived` here or gate D2 on #79 shipping it with the
  exact signature.
- Availability note (not a security hole): one stale citation refuses the **entire spawn** rather
  than serving the resolvable remainder. Defensible, but the contract should say the refusal is
  per-brief at composition (so the orchestrator sees it at spawn time, not mid-run) — it does.

### D3 — Admission authority — **HOLE** (cross-run read on the shipped `repl.cite`)

- Scope escalation is **closed** (SOUND): `admitReplBinding` enforces `record.replRole === scope`
  and principal equality (C20); a `shared` manifest requires the run-orchestrator lease (C17); the
  wrapper deliberately does not force scope but the store refuses the mismatch (C22). A worker
  cannot mint an orchestrator-scoped object.
- **HOLE: the "run is the authority boundary" is not enforced on the worker-facing read.** The
  `repl.cite` MCP tool calls `coordinator.resolveReplCitation(args.runId, args.citation)` with a
  **caller-supplied runId and no membership check** (mcp-northbound.mjs:1999 → coordinator.mjs:
  11781 → store). The coordinator wrapper only `_assertReadable()`. A caller who reaches the tool
  can resolve binding rows (`{scope, name, bindingVersion, state, cellId, bindingDigest}`) in **any
  run**, including other runs/waves. The contract's D3 assertion ("the runId in resolveReplCitation
  is the composition's own runId") is true only for the brief-composition seam — the shipped read
  port contradicts it. Fix: pin the realization rung to server-derive `runId` from the caller's
  task (like `contextRead` does at coordinator.mjs:10653) or refuse a citation that does not
  resolve in the caller's own run with a typed code (reuse `repl_object_not_addressed` or a new
  `repl_citation_out_of_run`).

### D4 — The three tiers — **HOLE** (workflow tier unrealizable across multi-run waves + false reap claim)

- Task-ephemeral / project-persistent tiers are coherent: `worker:<id>` is per-worker, the
  project tier is the KG (#63) and never a binding.
- **HOLE (structural): the workflow-ephemeral (`shared`) tier cannot be a single binding in the
  #94 dynamic-workflow shape.** Bindings are keyed `(runId, scope, name)` (C14); `resolveReplCitation`
  is per-runId (C15). The #94 demo's `waves.start` members have **distinct runIds**
  (`wave.runs.get(role).id`, used as `runId` for board/knowledge/scratchpad calls — C36), and the
  contract itself names the #94 ask as the tier's target ("lives for the run's duration (the wave's
  members — the #94 dynamic-workflow ask)"). D3 says "a shared binding renders into EVERY member's
  brief", but a single `shared` binding exists in ONE runId, and D3's own "run is the authority
  boundary" forbids cross-run resolution. As written, `repl:shared:<name>@<version>` renders only
  into members whose runId contains that binding — i.e. a single-run wave (the plan-wave path,
  coordinator.mjs:3999, requires one runId) but **not** the multi-run dynamic workflow the tier is
  named for. Fix: pin the per-member fan-out (the orchestrator admits a shared manifest + binding
  in EACH member runId at spawn admission, same name, so the citation grammar is uniform and each
  member's D2 seam resolves it in its own run) — or define a wave-scoped resolution the D2 seam
  uses to resolve a wave-level object across member runs. Either must be specified; today the tier
  is unspecified at the cross-run boundary. (OQ4's "per-member citation sets" is about which
  citations, not where the bindings live — it does not close this.)
- **HOLE (false claim): "reaped at run close" is not implemented.** No store or coordinator path
  drops `_replBindings`/`_replBindingHistory`/`_replBindingFences` at run close — `dropReplBinding`
  is the only removal (a manual act), and nothing iterates a closing run's bindings. The history
  MUST persist for `resolveReplCitation`'s Part-A rule-2 replay-exact resolution (C15). Either
  specify a run-close reap of the active-binding map (keeping the append-only history) or reword
  the tier as "unreachable after run close (run-scoped), history retained for replay" — the
  contract's current wording is false and would be cited as a GC guarantee that does not exist.

### D5 — Promotion composes #63 — **SOUND** with a provenance gap (fix)

- No REPL→KG auto-promotion (verified: the #63 ritual is the only path, C43); the promotion act is
  an explicit `admitReplBinding` on `shared` scope — the store enforces lease + manifest authority
  (C17/C20), so a non-orchestrator cannot rebind shared. Idempotent and replay-safe (Part B rule 6).
- **Provenance gap:** a promoted shared binding records `cellId` + the orchestrator's shared
  `manifestDigest`; it does **not** record `promotedFrom: {scope, name, bindingVersion}` or any wave
  marker. The originating worker author is recoverable only transitively via the cell's
  `authority.principalId` (cell payload, coordination-store.mjs:10202-10209). "Which worker
  authored, which wave" is therefore not a first-class property of the promoted object. Fix: pin a
  provenance chain on the promotion (e.g., the shared binding's record carries `promotedFrom`
  coordinates) or explicitly state that provenance is cell-authority-derived and wave linkage rides
  the settle-window receipt.

### D6 — Worker manifests reviewed by projection — **SOUND**

- Shadow-field attack is closed: the manifest admission payload is validated to an **exact closed
  key set** `['branches','manifestDigest','principal','replRole','requestDigest','runId',
  'schemaVersion']` and each branch to exactly `digest,itemCount,mediaType,name,ref,summary`
  (coordination-store.mjs:9897-9931). A manifest cannot carry a field the review projection does
  not show, and a worker manifest (replRole `worker:<id>`) can only authorize bindings in its own
  scope (C20). Cross-worker manifests are refused at admission (C17). Approval replay-safety holds:
  the promotion acts are idempotent `admitReplBinding` calls (Part B rule 6, C20). No hole.

### D7 — #105/#79 composition — **SOUND** (order and independent bounds) with #79 dependency

- Order is pinned in both renderers (C50/C51) and cannot be reordered by content; the Verification
  contract keeps its position. Per-section independent bounds (no combined cap) match the house
  shed pattern (`view.knowledge_slice.*` at C52; #79's `view.attention_push.*` at C33). Overflow
  rides the digest-cited spill, resolvable by the worker (`context.read {kind:'spill'}` → `mintSpill`/
  `materializeSpill` at coordination-store.mjs:13217/:13246; 1 MiB `spill.body` ceiling C52).
- Sections cannot push each other out of budget: each sheds within its own row. The one caveat is
  the same cross-contract dependency — `view.attention_push.items/bytes` must land with #79, and
  the contract should say the REPL rows are defined independently so a #79 fold-order change cannot
  renumber this contract's rows.
- The #105 interaction is correct: a citation in reply text is body text, does not consume depth
  (the depth check is `parent.depth >= 1 || parent.reply`, coordinator.mjs:12536-12537), and the
  frame stays closed `{inReplyTo, body}` (C35).

### The no-arbitrary-code law — **SOUND**

- No path evaluates REPL object content. Cell content is context-value JSON, rendered as text; the
  context-program bench is the closed whitelist (14 pure ops + 4 predicates) at cell **settlement**,
  not at brief render. `cell:` refs resolve at manifest admission, never in the brief (C45).
- **The specPath-loader escape is closed:** `waves.run`'s spec path is `JSON.parse`-only — "no
  eval, no Function, no import() of the spec path" (workflow-interpreter.mjs:478-485) — and
  `assertNoFunctions` walks every nesting level, refusing a function value anywhere (B6,
  workflow-interpreter.mjs:72-83). The only dynamic `import(targetUrl)` in `impl/src`
  (atlas-behavior-fingerprint.mjs:40) is a gated, sandboxed, explicitly-labeled execution op
  (`side_effects: 'executes_target_in_throwaway_permission_sandbox'`, :166) of the ATLAS subsystem —
  unreachable from a `repl:` citation and not part of the realization rung. The law holds.

### Refusal vocabulary / acceptance pins / open questions

- Vocabulary: the new codes fit the snake_case family and reuse existing codes verbatim. One
  citation error: `repl_binding_citation_not_found` is at **:15514 and :15519**, not :15520 (C54).
- Acceptance pins R1-R8/R8′ are RED as claimed (verified: no `## Cited REPL objects` section in
  either renderer, `inner.replObjects` absent, no `view.repl_object.*` rows, no promotion path,
  `projectReplBindingView` production-uncalled). The harness reference is a wrong filename (C55).
- Open questions: OQ1 correctly flags the full-content `repl.cite` projection gap (and this report
  adds that the cross-run `repl.cite` read must also be scoped, D3). OQ4's per-member citation sets
  are adjacent to, but do not close, the D4 per-run binding fan-out hole.

---

## 3. Numbered blockers — NOT FOLD-READY

1. **Wrong citation (automatic blocker) — control-surface-audit.md:156-163.** GT9's quoted text
   "Cross-member knowledge is orchestrator-mediated today … (issue #96)" is at **:175-180**; the
   cited range points to unrelated content. Fix: re-anchor to :175-180 (or the exact row).
2. **Wrong citation (automatic blocker) — context-program.mjs:1244.** D1's idempotency-key anchor
   `context.cell:${sessionId}:${programDigest}` is built at **:1333**; :1244 is a doc-comment
   example. Fix: cite :1333 (the `admissionKey` construction).
3. **Structural hole — D4 workflow tier is not realizable across the #94 multi-run wave.** A
   `shared` binding is per-`runId`; #94 wave members have distinct runIds; D3's own run boundary
   forbids cross-run resolution. A single "shared binding renders into EVERY member's brief" is
   false for the dynamic-workflow shape the tier is named for. Fix: pin the per-member fan-out
   (shared manifest + binding admitted into each member's runId at spawn) or a wave-scoped
   resolution in the D2 seam — and add an R-pin proving a multi-run wave member's brief resolves
   `repl:shared:<name>@<version>` in its own runId.
4. **Structural hole — D3 "run is the authority boundary" is not enforced on the shipped
   `repl.cite` read.** `baton_repl_cite` passes a caller-supplied runId with no membership check
   (mcp-northbound.mjs:1999). Fix: server-derive the runId from the caller's task (the `contextRead`
   pattern, coordinator.mjs:10653) or refuse a citation that does not resolve in the caller's run
   with a typed code; add an R-pin for a cross-run `repl.cite` refusal.
5. **Under-specified seam — D2 head is not byte-checked against frame escape.** A cell whose content
   embeds `\n## <fake section>` renders as raw prompt lines after the section frame; the contract
   does not pin newline/control-char sanitization of the bounded head. Fix: pin the head through
   `sanitizeWebContent`/`stripControlCharacters` (single-line leaf) in the renderer and add an
   R-pin: a cell containing `## Pending attention` renders inside the bullet, not as a new section.
6. **False claim — D4 "reaped at run close" has no implementing path.** No reap of
   `_replBindings`/`_replBindingFences` exists at run close. Fix: specify a run-close reap of the
   active-binding map (history retained for replay-exact resolution) or reword the tier to
   "run-scoped, unreachable after close, history retained."
7. **Citation errors (minor but must fix):** `repl_binding_citation_not_found` at :15519 not :15520
   (C54); orchestrator-friction-ledger.md:42 not :41 (C37); docs/33:139-140 not :140-142 (C7);
   `_providerBrief` L0/briefing code at :3826-3828 / :3834-3838 not :3820-3825/:3827-3837 (C28/C29);
   spill block at :10774-10788 not :10771-10784 (C33); `admitReplManifest` ends :10045 (C17); the
   #79 harness is `impl/test/worker-delivery-push-red.test.mjs`, not `issue79-delivery-push-red.test.mjs` (C55).
8. **Cross-contract dependency not pinned — #79 RED surface stated as landed.** GT7/GT12 and D2/D7
   treat `wrapHubDerived`, `view.attention_push.*`, and `UNTRUSTED_ATTENTION` as existing; all are
   RED at HEAD (they are #79's pins; `wrapHubDerived` is asserted absent by
   worker-delivery-push-red.test.mjs:338). Fix: state the #79 dependency explicitly (D2's head
   wrapper is defined here or gated on #79 shipping the exact signature; D7's rows are independent
   additions), so a #79 fold-order change cannot silently break this contract.

---

**Bottom line.** The design is architecturally coherent: the closed grammar, typed refusals,
lease-enforced admission, closed-shape manifests, independent section budgets, and the
no-arbitrary-code law all hold. But the contract ships three verified-wrong citations (two
automatic blockers), a structural hole in the workflow tier's cross-run realization, an unenforced
run boundary on the worker-facing read, an un-byte-checked render seam, and a false reap claim.
**NOT FOLD-READY** until blockers 1-6 are resolved and 7-8 are corrected.
