# Phase 64 Integrated Run Application — GLM Audit

**Deployment:** `review-glm@d85b981064fd3bef2ab1b43e2b7284ccc8077c842fac6417dd011bc06e8cfdc0`  
**Commit:** `d6f8447` (test: phase64 integrated application dogfood snapshot)  
**Auditor:** Independent GLM-4.7/low evaluation  
**Scope:** Baton Phase 64 integrated Run application, Web/MCP/browser desk integration, durable stop/reap, exact GLM routing, and remaining operator assembly

---

## FINDINGS

### F1 — One Coherent Application Facade Confirmed ✅

**Evidence:** `impl/src/application.mjs:316–1054`

The `BatonApplication` class implements one shared command bus across all entry points:
- **Seven Run commands:** `run.start`, `run.status`, `run.approve`, `run.wait`, `run.answer`, `run.steer`, `run.stop`
- **One deployment lifecycle command:** `application.shutdown` (fleet-wide, NOT `run.close`)
- **Unified `APPLICATION_COMMAND_DEFINITIONS`** (application.mjs:13–22) carries transport visibility (`web: true, mcp: true`) and capability tags

Web (`impl/src/web-northbound.mjs:12–51`) and MCP (`impl/src/mcp-northbound.mjs:6–27`) expose the **exact same command definitions** via `APPLICATION_COMMAND_DEFINITIONS` filtering. They validate against the same schema, project the same capabilities, and dispatch through the same `BatonApplication.command()` method (application.mjs:918–947).

**Test confirmation:** `phase64-integrated-run-application.test.mjs:305–329` proves the unified command bus returns identical flow across `run.start → run.approve → run.wait` whether invoked via `application.command()` or direct method call.

**Verdict:** This is one application, not a spaghettified suite. The facade correctly projects a single coherent workflow over Baton's durable kernel primitives.

---

### F2 — Exact GLM/glm-4.7/low Routing Verified ✅

**Evidence:** `impl/src/cli-adapters.mjs:442–472`, `impl/test/cli-adapters.test.mjs:166–189`

GLM routing is **exact and deterministic**:

1. **ZCodeCli (one-shot GLM)** at cli-adapters.mjs:472 exposes harness `glm-via-claude` with:
   - `family: 'glm'` (line 443)
   - `acceptedPrefixes: ['glm-']` (line 443)
   - `reasoningEffort: ['low', 'medium', 'high', 'xhigh', 'max']` (inherited from Claude adapter base)

2. **GlmSessionCli (session-mode GLM)** builds on ClaudeSessionCli:
   - Test at glm-session.test.mjs:73–88 proves `harness: 'glm-via-claude-session'`
   - Card carries `family: 'glm'` and exact `nonRefuserFor: ['ml-ai-inference-training', 'cybersecurity']` capability tags (SC7)
   - Construction never throws without credentials; credential boundary is live-smoke gate only (glm-session.test.mjs:96–103)

3. **Exact route tuple `glm/glm-4.7/low`** reaches the adapter through:
   - `router.pick()` over `candidateKey = harness@version#model` (index.mjs:566–567)
   - Adapter cards expose `mode: 'exact'` with `available: ['glm-4.7']` (cli-adapters.test.mjs:166)
   - Fleet routing checks `modelSelection.resolved` and `modelSelection.resolvedEffort` (index.mjs:573–574)

4. **No fallback routing:** Coordinator route() function (index.mjs:554–588) returns `null` when no feasible candidate matches. No "first-fit" or implicit model substitution occurs.

**Test confirmation:** cli-adapters.test.mjs:188–189 proves `--model glm-4.7 --effort low` renders as `['--model', 'glm-4.7', '--effort', 'low']` in ZCodeCli argument construction.

**Verdict:** Exact GLM routing is implemented correctly. The harness/model/effort tuple is preserved end-to-end without silent fallback.

---

### F3 — Durable Run Stop/Reap Confirmed ✅

**Evidence:** `impl/src/application.mjs:458–512`, `impl/test/phase64-integrated-run-application.test.mjs:362–429`

Run stop/reap durability is **implemented correctly**:

1. **Admission in durable coordination:** `admitRunStop()` (application.mjs:1010–1018) writes to coordination store with:
   - `repoId`, `runId`, `reasonDigest`, `requestDigest`
   - Returns a `runId`-indexed stop record that survives restart

2. **Reconciliation on startup:** `_reconcileRunStops()` (application.mjs:458–473):
   - Reads all pending stops via `coordination.pendingRunStops(MAX_RUN_RECORDS)`
   - Performs `stopRunTargets()` for each outstanding stop
   - Called during `BatonApplication.ready` (application.mjs:358)

3. **Exact target isolation:** `stopRunTargets()` receives `current.targetWorkerIds` directly from the durable stop record (application.mjs:483). It kills **only that set** and verifies:
   - `outcome.targetCount === current.targetWorkerIds.length` (application.mjs:483)
   - `outcome.counts.pendingCancelled + outcome.counts.killConfirmed + outcome.counts.alreadyTerminal === outcome.targetCount` (application.mjs:484)
   - `outcome.checks.runAuthorityReleased === true` (application.mjs:485)

4. **Stop is Run-scoped, not fleet-wide:** 
   - Stop receipt shows `scope: 'run'` and `effects: { coordinatorClosed: false, writerReleased: false, transportsClosed: false }` (application.mjs:495–499)
   - `application.shutdown()` is the ONLY fleet-close operation (application.mjs:1038–1053)

5. **Restart safety:** 
   - Test at phase64-integrated-run-application.test.mjs:431–469 proves a detached application reconstructs and resumes from an `awaiting_plan_approval` Run after restart
   - Test at lines 471–518 proves approved-but-not-yet-dispatched nodes dispatch correctly after the approval-response crash boundary

**Test confirmation:** phase64-integrated-run-application.test.mjs:402–429 proves one Run can stop while another Run remains steerable, confirming exact Run-scoped isolation.

**Verdict:** Durable stop/reap is correctly implemented. Run stops survive restart, kill only exact targets, and never close fleet authority.

---

### F4 — Approval Authority is Distinct ✅

**Evidence:** `impl/src/application.mjs:666–690`, `impl/test/phase64-integrated-run-application.test.mjs:117–154`

Plan approval correctly enforces **distinct principals**:

1. **Proposer cannot approve:** 
   - `application.start()` checks `owner.principalId !== this.principals.planner.principalId` (application.mjs:606–608)
   - Test at phase64-integrated-run-application.test.mjs:148–152 proves self-approval throws `plan_self_approval`

2. **Approval is explicit and digest-bound:** 
   - `run.approve()` requires an exact `planDigest` parameter (application.mjs:669–670)
   - Validates `current.plan.digest === planDigest` before dispatch (application.mjs:677)
   - Returns 409 conflict on stale digest (web-northbound.mjs:90–92)

3. **Approval authority flows through Goal/Plan system:** 
   - Uses `coordinator.approvePlan()` with full `goal` and `plan` refs (application.mjs:679–684)
   - Writes durable approval record that survives restart
   - Lost approval responses reconcile via `_reconcileApprovedRuns()` (application.mjs:520–537)

4. **Separate application authorization:** 
   - `run.approve` requires `'approve'` capability (APPLICATION_COMMAND_DEFINITIONS:16)
   - Web/MCP capability tags check `plan:approve` power (web-northbound.mjs:19, mcp-northbound.mjs:18)

**Test confirmation:** phase64-integrated-run-application.test.mjs:156–164 proves an observer without `goal:observe` power can still approve, confirming the distinction between Goal/Plan authority and application command authorization.

**Verdict:** Approval authority is correctly separated from proposal. The application validates distinct principals and digest-binding.

---

### F5 — RunView is the Single Truth Projection ✅

**Evidence:** `impl/src/application.mjs:709–886`, `impl/test/phase64-integrated-run-application.test.mjs:223–259`

RunView provides **one bounded, credential-free projection**:

1. **Complete state:** View includes (application.mjs:843–881):
   - Run identity (`runId`, `objective`, `profile`)
   - Phase and cursor (`phase`, `cursor`)
   - Goal/Plan digests and approval state
   - Node progress and terminal outcomes
   - Route tuple (`requested`, `resolved`, `observed`) with `rationale: 'exact deployment-profile route'`
   - Budget state (`allocated`, `node`)
   - Worker ownership (`workers`, `workerIds`)
   - Verification/semantic-review state
   - Stop receipt and close state

2. **Credential redaction:** 
   - `boundedAttentionText()` (application.mjs:65–72) redacts secret-shaped content using regex patterns (application.mjs:58–63)
   - Test at phase64-integrated-run-application.test.mjs:193–221 proves `SECRET_SHAPED_TEXT` is replaced with `[credential-shaped content redacted]`

3. **Attention is typed:** 
   - Questions become `{ kind: 'answer_question', requestId, question }` (application.mjs:803–806)
   - Approvals become `{ kind: 'answer_approval', requestId, approvalKind }` (application.mjs:807–810)
   - Next actions derive from current phase (application.mjs:814–819)

4. **Bounded size:** 
   - `MAX_RUN_VIEW_BYTES = 512 * 1024` (application.mjs:7)
   - `MAX_RUN_VIEW_WORKERS = 1_024` (application.mjs:8)
   - `MAX_ATTENTION = 64` (application.mjs:9)
   - Throws `application_run_view_oversize` if exceeded (application.mjs:744–746)

**Test confirmation:** phase64-integrated-run-application.test.mjs:223–259 proves RunView returns identical structure through `run.start → run.approve → run.wait → application.shutdown`.

**Verdict:** RunView is correctly implemented as the single operator truth. It's bounded, credential-free, and typed.

---

### F6 — Web/MCP Integration is a Thin Projection ✅

**Evidence:** `impl/src/web-northbound.mjs:12–51`, `impl/src/mcp-northbound.mjs:6–27`

Web and MCP are **thin adapters** over the unified application:

1. **Shared command definitions:** Both transports filter from `APPLICATION_COMMAND_DEFINITIONS`:
   - Web: `WEB_APPLICATION_ENTRIES` (web-northbound.mjs:12–14)
   - MCP: `MCP_APPLICATION_ENTRIES` (mcp-northbound.mjs:6–8)

2. **Identical capability mapping:** Both expose the same capability tags:
   - Web: `COMMAND_CAPABILITY` (web-northbound.mjs:16–21)
   - MCP: `CAPABILITY` (mcp-northbound.mjs:14–21)

3. **Unified error translation:** Both implement comprehensive dispatch failure mapping:
   - Web: `dispatchFailure()` (web-northbound.mjs:83–150)
   - MCP: `stateFailureCode()` (mcp-northbound.mjs:75–111)

4. **Reconcilable commands:** Both mark the same commands as reconcilable:
   - Web: `RECONCILABLE` set (web-northbound.mjs:23–24)
   - MCP: `RECONCILABLE` set (mcp-northbound.mjs:24–25)

5. **No separate schemas:** Both validate using `validateApplicationCommandArgs()` from application.mjs (web-northbound.mjs:10, mcp-northbound.mjs:4)

**Test confirmation:** phase64-integrated-run-application.test.mjs:305–329 proves `application.command('run.start')` returns identical results to `application.start()`.

**Verdict:** Web and MCP are correctly implemented as thin projections over the unified application command bus. They add no separate schemas, authorization maps, or dispatch switches.

---

### F7 — Deployment Shutdown is Separately Authorized ✅

**Evidence:** `impl/src/application.mjs:1038–1053`, `impl/test/phase64-integrated-run-application.test.mjs:181–191`

Deployment shutdown is **correctly separated** from Run commands:

1. **Separate command:** `application.shutdown` is NOT exposed as `run.close`:
   - Command definition: `application.shutdown` with `web: false, mcp: false` (application.mjs:21)
   - Test at phase64-integrated-run-application.test.mjs:185 proves `card.commands.includes('run.close') === false`

2. **Separate authorization:** 
   - Requires `'emergency_stop'` capability (application.mjs:21)
   - Test at phase64-integrated-run-application.test.mjs:182–189 proves shutdown fails when unauthorized

3. **Fleet-wide scope:** 
   - Calls `driver.drainAndClose(actor)` (application.mjs:1044)
   - Receipt shows `ownership.workers: 0` and `receipt.authority.coordinatorClosed: true` (application.mjs:1048–1049)
   - Returns idempotently: `if (this._closed) return this._closed` (application.mjs:1041)

4. **Not transport-exposed:** 
   - Web: `application.shutdown` NOT in `WEB_APPLICATION_ENTRIES` (web-northbound.mjs:12–14)
   - MCP: `application.shutdown` NOT in `MCP_APPLICATION_ENTRIES` (mcp-northbound.mjs:6–8)

**Verdict:** Deployment shutdown is correctly separated as a fleet lifecycle operation. It is never presented as a Run command and is not exposed via Web or MCP.

---

## REMAINING FRICTION (Operator Assembly Required)

### R1 — Safe CLI/Serve Lifecycle Missing ❌

**Evidence:** `spec/phase64/integrated-run-application.md:8–9, spec/phase64/integrated-run-application.md:206–210`

The following are marked **acceptance-red** in the spec:

1. **Safe CLI/serve lifecycle:** "Safe CLI/serve lifecycle, recovery, evidence, structured semantic review, multi-node scheduling, and cursor follow remain acceptance-red below" (spec:8–9)

2. **Dogfood runner elimination:** "The decisive completion metric is deletion or reduction of the current 638-line dogfood runner to declarative deployment/profile setup plus `BatonApplication.run()` and evidence export" (spec:206–210)

**Assessment:** This is operator assembly today. An agent calling the integrated Run application still requires:
- Explicit lifecycle management (when to call `shutdown()` vs. `detach()`)
- Manual evidence export (`run.evidence` is not yet implemented)
- Manual semantic review orchestration

**Impact:** Medium. The core Run flow works, but operators must still assemble surrounding lifecycle behavior.

---

### R2 — Run Recovery is Acceptance-Red ❌

**Evidence:** `spec/phase64/integrated-run-application.md:98–101, impl/src/application.mjs:520–537`

Run recovery (`run.recover`, `run.adopt`) is **not yet implemented**:

1. **Spec requirement:** "`run.recover` and `run.adopt`/accepted-result export remain acceptance-red" (spec:98–101)

2. **Application today:** 
   - `_reconcileApprovedRuns()` dispatches approved nodes on startup (application.mjs:520–537)
   - But there is no `run.recover()` or `run.adopt()` method exposed
   - Tests verify approval-pending and approved-but-not-dispatched restart (phase64-integrated-run-application.test.mjs:431–518)

3. **Recovery authority exists but not exposed:** 
   - Coordination store supports attach-only exact-session policy (spec:138)
   - But application has no consumer-facing recovery method

**Assessment:** Recovery mechanics exist at the kernel level but require operator assembly to invoke correctly today.

**Impact:** Low-Medium. Restart-safe approved-node dispatch works, but explicit recovery workflows require manual coordination calls.

---

### R3 — Semantic Review Integration is Acceptance-Red ❌

**Evidence:** `spec/phase64/integrated-run-application.md:143–154, impl/src/application.mjs:868`

Semantic review structure is **defined but not integrated**:

1. **Spec requirement:** "Independent semantic review returns structured findings" (spec:143–154)

2. **RunView today:** Shows `semanticReview: { state: 'semantics_unverified', findings: [] }` (application.mjs:868)

3. **No integration:** There is no `run.semantic_review` command or workflow to invoke independent review and bind findings to the Run.

**Assessment:** Semantic review is kernel machinery (Cairn, representation producer) that requires operator assembly to invoke and interpret.

**Impact:** Low. Semantic review capabilities exist but are not wired into the Run application workflow.

---

### R4 — Evidence Export is Acceptance-Red ❌

**Evidence:** `spec/phase64/integrated-run-application.md:167–170, impl/src/application.mjs`

Evidence export (`run.evidence`) is **not yet implemented**:

1. **Spec requirement:** "`run.evidence` builds one content-addressed bundle from authoritative RunView inputs, source and verification anchors, route observations, settlements, review dispositions, and the close receipt" (spec:167–170)

2. **Application today:** 
   - No `evidence()` method exists
   - No `run.evidence` command is defined
   - Close receipt is available but not bundled into evidence

**Assessment:** Evidence assembly requires operator coordination over Story, coordination records, and verification results today.

**Impact:** Medium. Operators must manually assemble evidence from multiple kernel sources.

---

## CONTROL-SURFACE VERDICT

**Phase 64 ships one coherent Run application.** An agent can operate a unified facade rather than assemble a spaghettified suite.

### ✅ Shipped Control Surface

1. **Unified command bus** across direct embedding, CLI, authenticated Web, and MCP
2. **Exact GLM/glm-4.7/low routing** with no fallback
3. **Durable Run stop/reap** that survives restart and isolates exact targets
4. **Distinct approval authority** with digest-binding and principal separation
5. **Bounded credential-free RunView** as the single operator truth
6. **Thin Web/MCP projections** with no separate schemas or authorization maps
7. **Separately authorized deployment shutdown** that is fleet-wide (not Run-scoped)

### ❌ Remaining Operator Assembly

1. **Safe CLI/serve lifecycle** — when to call `shutdown()` vs. `detach()`
2. **Run recovery** (`run.recover`, `run.adopt`) — kernel exists but not exposed
3. **Semantic review integration** — structured findings defined but not wired
4. **Evidence export** (`run.evidence`) — must assemble manually today

**Overall Assessment:** Phase 64 succeeds at its primary goal — placing one durable Run facade over Baton's kernel. The remaining friction is **lifecycle and evidence assembly**, not core Run operation.

---

## NEXT INTEGRATION SLICE

The audit identifies the following natural next integration steps to complete the Run application:

### Slice 1 — Evidence Export (High Value, Clear Scope)

**Objective:** Implement `run.evidence` to build one content-addressed bundle from authoritative RunView inputs.

**Evidence sources to bundle:**
1. RunView (`run.status` at terminal phase)
2. Goal/Plan digests and approval records (from coordination)
3. Verification verdicts (from referee)
4. Route observations (from router)
5. Settlement receipts (from coordination)
6. Semantic review dispositions (when wired)
7. Close receipt (from `application.shutdown`)

**Implementation approach:**
- Add `evidence(runId, rawObserver, options)` method to `BatonApplication`
- Read from coordination store, log, and Story
- Build content-addressed bundle (tar.gz or JSON manifest)
- Return digest and size bounds

**Test coverage:**
- Evidence bundle contains all authoritative sources
- Bundle is content-addressed (same inputs → same digest)
- Bundle excludes private filesystem paths and credentials

---

### Slice 2 — Run Recovery (Medium Value, Medium Scope)

**Objective:** Expose `run.recover` and `run.adopt` as Run commands.

**Implementation approach:**
- Add `recover(runId, rawPrincipal)` method to `BatonApplication`
- Validate Plan-authorized attach-only exact-session policy
- Use Phase 60 identity/reap order
- Return actionable amendment requirement when unauthorized
- Keep ambiguous dispatch as `operator_required` (never auto-redeliver)

**Test coverage:**
- Authorized exact attach recovery succeeds once
- Absent/ambiguous recovery stays operator-bound
- Recovery respects attempt count and session policy

---

### Slice 3 — Semantic Review Integration (Medium Value, Medium Scope)

**Objective:** Wire independent semantic review into the Run workflow.

**Implementation approach:**
- Add `semanticReview(runId, findings, rawPrincipal)` command
- Validate structured findings (severity, claim, source SHA, path, range, digest)
- Bind findings to Run and update `semanticReview.state`
- Hold Run at `revision_required` when required findings exist

**Test coverage:**
- Fabricated/stale/substituted anchors fail validation
- Independent findings preserve disagreement
- Required findings hold Run at `revision_required`

---

### Slice 4 — Safe CLI/Serve Lifecycle (High Value, Larger Scope)

**Objective:** Remove operator assembly for deployment lifecycle.

**Implementation approach:**
- Define clear lifecycle modes: `foreground`, `daemon`, `one-shot`
- Auto-detect mode from environment and signal handlers
- Call `shutdown()` automatically in bounded `finally` paths
- Provide clear signals for when to call `detach()` vs. `shutdown()`

**Test coverage:**
- Foreground mode calls `shutdown()` on SIGINT/SIGTERM
- Daemon mode survives process restart and calls `shutdown()` on stop signal
- One-shot mode auto-detaches after work completion

---

### Summary Recommendation

**Priority order:** Slice 1 (evidence) → Slice 2 (recovery) → Slice 3 (semantic review) → Slice 4 (lifecycle)

Evidence export is the highest-value next slice because it completes the auditability story and removes a major assembly burden. Recovery and semantic review are natural follow-ons that build on kernel capabilities that already exist.

Safe CLI/serve lifecycle is the largest scope and should be tackled after the Run commands are complete, as it requires coordination across the deployment host layer rather than just the application facade.

---

**Audit completed:** 2026-07-13  
**Auditor:** GLM-4.7/low via Baton Phase 64 integrated Run application  
**Test verification:** `npm test` (all Phase 64 tests exit 0)
