# Phase 64 Integrated Run Application — GLM-4.7 Audit

**Deployment:** `review-glm@acb98d69bb74e0b013436617df2168e090fffabae4efefe3f808e284803bb5bf`  
**Commit:** `b014b76` (Snapshot integrated Baton application for recursive dogfood)  
**Auditor:** Independent GLM-4.7/low evaluation  
**Scope:** Baton Phase 64 integrated Run application, shared command semantics, exact GLM routing, durable stop/reap, restart friction, coherent application vs spaghettified suite

---

## FINDINGS

### F1 — One Coherent Application Facade Confirmed ✅

**Evidence:** `impl/src/application.mjs:366–1342`, `impl/test/phase64-integrated-run-application.test.mjs:305–329`

The `BatonApplication` class implements **one shared command bus** across all entry points:

**Commands:** `run.start`, `run.status`, `run.approve`, `run.wait`, `run.answer`, `run.steer`, `run.stop`, `run.evidence`, `run.adopt`, `application.shutdown`

**Unified Definition:** `APPLICATION_COMMAND_DEFINITIONS` (application.mjs:13–24) carries:
- Transport visibility (`web: true, mcp: true`) per command
- Capability requirements (`control`, `observe`, `approve`, `emergency_stop`, `adopt_result`)
- Stateful/reconcilable flags for exactly-once delivery

**Transport Projections:** Web (`impl/src/web-northbound.mjs:12–51`) and MCP (`impl/src/mcp-northbound.mjs:6–27`) expose the **exact same command definitions** via filtering from `APPLICATION_COMMAND_DEFINITIONS`. Both validate against the same schema using `validateApplicationCommandArgs()` (application.mjs:252–280).

**Test Confirmation:** phase64-integrated-run-application.test.mjs:305–329 proves `application.command('run.start')` returns identical flow to `application.start()` through the full `run.start → run.approve → run.wait → application.shutdown` sequence.

**Verdict:** This is one coherent application, not a spaghettified suite. The facade correctly projects a single unified workflow over Baton's durable kernel primitives.

---

### F2 — Shared Command Semantics Across Direct/CLI/Web/MCP Confirmed ✅

**Evidence:** `impl/src/application.mjs:1200–1234`, `spec/phase64/integrated-run-application.md:86–112`

The application provides **one command bus** that all transports use:

**Direct Method Calls:** `application.start()`, `application.approve()`, `application.stop()`, etc.

**Command Bus:** `application.command(name, args, principal)` (application.mjs:1200–1234) dispatches all commands through one switch, ensuring identical semantics whether called from:
- Direct embedding (BatonApplication instance methods)
- CLI (via command bus)
- Authenticated Web (via WEB_APPLICATION_ENTRIES)
- MCP (via MCP_APPLICATION_ENTRIES)

**No Separate Schemas:** All transports use `validateApplicationCommandArgs()` from application.mjs. No transport maintains its own schema or validation logic.

**Test Confirmation:** phase64-integrated-run-application.test.mjs:311 proves `card.commands` returns the same ten commands across all entry points.

**Verdict:** Shared command semantics are correctly implemented. An agent operates one application surface regardless of transport.

---

### F3 — Exact GLM/glm-4.7/low Routing Confirmed ✅

**Evidence:** `impl/src/cli-adapters.mjs:442–472`, `impl/test/cli-adapters.test.mjs:166–189`, `impl/src/router.mjs:1–100`

GLM routing is **exact and deterministic** with no fallback:

**ZCodeCli Adapter (one-shot GLM):**
- `harness: 'glm-via-claude'` with `family: 'glm'` (cli-adapters.mjs:443)
- `acceptedPrefixes: ['glm-']` (cli-adapters.mjs:443)
- Supports all reasoning efforts: `['low', 'medium', 'high', 'xhigh', 'max']`

**GlmSessionCli Adapter (session-mode GLM):**
- Builds on ClaudeSessionCli with `harness: 'glm-via-claude-session'` (glm-session.test.mjs:73–88)
- Card carries `family: 'glm'` with exact capability tags

**Exact Route Tuple Preservation:**
- `router.pick()` selects by `candidateKey = harness@version#model` (router.mjs:67–68)
- Adapter cards expose `mode: 'exact'` with `available: ['glm-4.7']` (cli-adapters.test.mjs:166)
- Fleet routing checks `modelSelection.resolved` and `modelSelection.resolvedEffort` (index.mjs:573–574)

**No Silent Fallback:** Coordinator `route()` returns `null` when no feasible candidate matches. No "first-fit" or implicit model substitution occurs.

**Test Confirmation:** cli-adapters.test.mjs:188–189 proves `--model glm-4.7 --effort low` renders as `['--model', 'glm-4.7', '--effort', 'low']` in argument construction.

**Verdict:** Exact GLM routing is implemented correctly. The harness/model/effort tuple is preserved end-to-end without silent fallback or model substitution.

---

### F4 — Durable Run Stop/Reap Confirmed ✅

**Evidence:** `impl/src/application.mjs:606–643`, `impl/test/phase64-integrated-run-application.test.mjs:362–429`

Run stop/reap durability is **implemented correctly**:

**Admission in Durable Coordination:**
- `admitRunStop()` (application.mjs:1299–1306) writes to coordination store with `repoId`, `runId`, `reasonDigest`, `requestDigest`
- Returns a `runId`-indexed stop record that survives restart

**Reconciliation on Startup:**
- `_reconcileRunStops()` (application.mjs:518–533) reads all pending stops via `coordination.pendingRunStops(MAX_RUN_RECORDS)`
- Performs `stopRunTargets()` for each outstanding stop
- Called during `BatonApplication.ready` (application.mjs:409–410)

**Exact Target Isolation:**
- `stopRunTargets()` receives `current.targetWorkerIds` from the durable stop record (application.mjs:613)
- Kills **only that set** and verifies:
  - `outcome.targetCount === current.targetWorkerIds.length` (application.mjs:614)
  - `outcome.counts.pendingCancelled + outcome.counts.killConfirmed + outcome.counts.alreadyTerminal === outcome.targetCount` (application.mjs:615)
  - `outcome.checks.interactionsResolved === true` (application.mjs:616)

**Stop is Run-Scoped, Not Fleet-Wide:**
- Stop receipt shows `scope: 'run'` and `effects: { coordinatorClosed: false, writerReleased: false, transportsClosed: false }` (application.mjs:629–630)
- `application.shutdown()` is the ONLY fleet-close operation (application.mjs:1326–1341)

**Restart Safety:**
- Test at phase64-integrated-run-application.test.mjs:432–469 proves detached application reconstructs from `awaiting_plan_approval` after restart
- Test at lines 471–519 proves approved-but-not-yet-dispatched nodes dispatch correctly after approval-response crash boundary

**Test Confirmation:** phase64-integrated-run-application.test.mjs:402–429 proves one Run can stop while another Run remains steerable, confirming exact Run-scoped isolation.

**Verdict:** Durable stop/reap is correctly implemented. Run stops survive restart, kill only exact targets, and never close fleet authority.

---

### F5 — Run Restart Safety Confirmed ✅

**Evidence:** `impl/src/application.mjs:518–550`, `impl/test/phase64-integrated-run-application.test.mjs:432–519`

Application startup correctly **reconciles durable state**:

**Three Reconciliation Methods:**
1. `_reconcileRunStops()` — completes pending Run stops (application.mjs:518–533)
2. `_reconcileResultAdoptions()` — completes pending result adoptions (application.mjs:535–550)
3. `_reconcileApprovedRuns()` — dispatches approved-but-not-yet-dispatched nodes (referenced in spec, coordinator handles)

**Startup Sequence:**
```javascript
this.ready = Promise.resolve()
  .then(() => this._reconcileResultAdoptions())
  .then(() => this._reconcileRunStops())
  .then(() => this._reconcileApprovedRuns());
```
(application.mjs:409–410)

**Crash-Boundary Safety:**
- Test at lines 471–519 proves: if approval is written to coordination but the response crashes, the next startup dispatches the node exactly once
- No duplicate task occurs because dispatch uses idempotency keys

**Test Confirmation:** phase64-integrated-run-application.test.mjs:432–469 proves a Run in `awaiting_plan_approval` reconstructs with identical plan digest after detach/attach cycle.

**Verdict:** Restart safety is correctly implemented. The application reconciles stops, adoptions, and approved nodes on startup without duplicating work.

---

### F6 — Application Distinguished from Kernel Primitives Confirmed ✅

**Evidence:** `spec/driver.md:14–35`, `impl/src/application.mjs:366–1342`, `impl/src/coordinator.mjs:1–150`

Phase 64 correctly **places a Run facade over kernel primitives**:

**Kernel Primitives (coordinator, low-level):**
- `spawn`, `send`, `wait`, `respond`, `interrupt`, `result`, `list`, `kill`
- These are worker lifecycle commands for emergency control and compatibility

**Application Commands (high-level, user-facing):**
- `run.start`, `run.status`, `run.approve`, `run.wait`, `run.answer`, `run.steer`, `run.stop`, `run.evidence`, `run.adopt`
- These express outcome, approval, attention, and lifecycle at the Run level

**Application Wraps Kernel:**
- `run.start` compiles intent into Goal/Plan, then calls `coordinator.defineGoal()` and `coordinator.proposePlan()` (application.mjs:781–794)
- `run.approve` calls `coordinator.approvePlan()` and then dispatches via `_dispatchCurrent()` (application.mjs:797–821)
- `run.stop` calls `coordinator.stopRunTargets()` after durable admission (application.mjs:1289–1312)

**Advanced Surface:** MCP.md:78–80 explicitly documents that original 19 `fleet_*` kernel tools remain available through `surface: 'advanced'` for diagnosis and migration, but the default Run surface is the 9-tool application bus.

**Verdict:** The application correctly distinguishes coherent Run workflow from low-level kernel primitives. An agent operates the Run facade; kernel primitives remain available for advanced use cases only.

---

### F7 — Deployment Shutdown Separated from Run Stop Confirmed ✅

**Evidence:** `impl/src/application.mjs:1326–1341`, `impl/test/phase64-integrated-run-application.test.mjs:181–191`, `spec/phase64/integrated-run-application.md:105–107`

Deployment shutdown is **correctly separated** as fleet lifecycle, not a Run command:

**Separate Command:** `application.shutdown` is NOT exposed as `run.close`:
- Command definition: `application.shutdown` with `web: false, mcp: false` (application.mjs:23)
- Test at phase64-integrated-run-application.test.mjs:186 proves `card.commands.includes('run.close') === false`

**Separate Authorization:**
- Requires `'emergency_stop'` capability (application.mjs:23)
- Test at lines 182–189 proves shutdown fails when unauthorized

**Fleet-Wide Scope:**
- Calls `driver.drainAndClose(principal.actor)` (application.mjs:1332)
- Receipt shows `ownership.workers: 0` and `receipt.authority.coordinatorClosed: true` (application.mjs:1336–1337)
- Returns idempotently: `if (this._closed) return this._closed` (application.mjs:1329)

**Not Transport-Exposed:**
- Web: `application.shutdown` NOT in `WEB_APPLICATION_ENTRIES` (web-northbound.mjs:12–14)
- MCP: `application.shutdown` NOT in `MCP_APPLICATION_ENTRIES` (mcp-northbound.mjs:6–8)
- Spec:103–107 explicitly states "Web and MCP do not expose it"

**Verdict:** Deployment shutdown is correctly separated as a fleet lifecycle operation. It is never presented as a Run command and is not exposed via Web or MCP.

---

## REMAINING FRICTION (Operator Assembly Required)

### R1 — Run Recovery Acceptance-Red ❌

**Evidence:** `spec/phase64/integrated-run-application.md:138–147`, `impl/test/phase64-integrated-run-application.test.mjs:432–519`

**What's Missing:** `run.recover` command is not yet exposed

**Kernel Exists, Application Incomplete:**
- Coordination store supports attach-only exact-session policy (spec:138–140)
- `_reconcileApprovedRuns()` dispatches approved nodes on startup (application.mjs:409–410)
- Tests prove restart-safe approved-node dispatch (phase64 test.mjs:471–519)

**But No Consumer-Facing Method:**
- No `recover(runId, principal)` method exists on BatonApplication
- Spec says "`run.recover` uses Phase 60 identity/reap order" (spec:143) but implementation is acceptance-red
- "A Run without that authority returns an actionable amendment requirement" (spec:146) — this logic is not wired

**Operator Assembly Required:** Today, operators must manually coordinate attach-only session recovery through kernel primitives, not through the Run application.

**Impact:** Medium. Restart-safe dispatch works for approved nodes, but explicit recovery workflows require manual kernel coordination.

---

### R2 — Evidence Export Acceptance-Red ❌

**Evidence:** `spec/phase64/integrated-run-application.md:166–178`, `impl/src/application.mjs:840–848`

**What's Missing:** `run.evidence` exists but is incomplete

**Current Implementation:**
- `evidence()` method exists (application.mjs:840–848)
- Calls `_buildEvidence()` which constructs a view

**But Spec Requires More:**
- Spec:167–170 says evidence must be "one content-addressed bundle from authoritative RunView inputs, source and verification anchors, route observations, settlements, review dispositions, adoption, and any Run-scoped stop receipt"
- Current implementation does NOT bundle all these sources
- No content-addressed tar.gz or manifest bundle is produced

**Test Coverage Gap:** Phase 64 tests do NOT verify evidence bundle completeness or content-addressing

**Operator Assembly Required:** Today, operators must manually assemble evidence from Story, coordination records, verification results, and receipts.

**Impact:** Medium. Evidence reads exist, but the complete bundled manifest required by spec is not implemented.

---

### R3 — Safe CLI/Serve Lifecycle Acceptance-Red ❌

**Evidence:** `spec/phase64/integrated-run-application.md:8–10, 205–210`

**What's Missing:** Declarative lifecycle modes and auto-shutdown

**Spec Requirements:**
- "Safe CLI/serve lifecycle... remain acceptance-red" (spec:8–10)
- "The decisive completion metric is deletion or reduction of the current 638-line dogfood runner to declarative deployment/profile setup plus `BatonApplication.run()` and evidence export" (spec:205–210)

**Current State:**
- Application exposes `shutdown()` and `detach()` methods (application.mjs:1314–1341)
- But no declarative lifecycle modes (foreground, daemon, one-shot)
- No automatic shutdown in signal handlers or finally paths
- No clear guidance on when to call `detach()` vs `shutdown()`

**Operator Assembly Required:** Today, operators must manually manage when to call `shutdown()` (fleet-wide drain) vs `detach()` (detach without draining workers).

**Impact:** High. The core Run application works, but deployment lifecycle requires manual assembly.

---

### R4 — Semantic Review Integration Acceptance-Red ❌

**Evidence:** `spec/phase64/integrated-run-application.md:148–154`, `impl/src/application.mjs:868`

**What's Missing:** `run.semantic_review` command and workflow

**Kernel Exists:**
- Cairn semantic review machinery exists (atlas-index, representation producer)
- Structured findings format is defined (severity, claim, source SHA, path, range, digest)

**But Not Wired to Run Application:**
- RunView shows `semanticReview: { state: 'semantics_unverified', findings: [] }` (application.mjs:868)
- No command to invoke independent review and bind findings to Run
- No workflow to hold Run at `revision_required` when required findings exist

**Operator Assembly Required:** Today, operators must manually invoke Cairn and interpret findings outside the Run workflow.

**Impact:** Low. Semantic review capabilities exist but are not integrated into the Run application.

---

### R5 — Multi-Node Scheduling Acceptance-Red ❌

**Evidence:** `spec/phase64/integrated-run-application.md:42–54`

**What's Missing:** Multi-node Plan dispatch

**Current Implementation:**
- `run.start` compiles a **deterministic one-node Plan by default** (spec:44–45)
- A separately registered planner MAY propose multi-node Plans (spec:46)
- But application always compiles to one node unless external planner is registered

**No Multi-Node Scheduling:**
- `_dispatchCurrent()` dispatches **one node** (application.mjs:691–717)
- No dependency-aware scheduler for multi-node Plans
- No topological sort or dependency tracking

**Operator Assembly Required:** Today, multi-node workflows require manual orchestration of multiple Runs.

**Impact:** Low. Single-node Runs work correctly. Multi-node scheduling is explicitly acceptance-red.

---

## CONTROL-SURFACE VERDICT

**Phase 64 ships one coherent Run application.** An agent can operate a unified facade rather than assemble a spaghettified suite.

### ✅ Shipped Control Surface

1. **Unified command bus** across direct embedding, CLI, authenticated Web, and MCP
2. **Shared command semantics** with one switch, one schema, one authorization path
3. **Exact GLM/glm-4.7/low routing** with no fallback or model substitution
4. **Durable Run stop/reap** that survives restart and isolates exact targets
5. **Distinct approval authority** with digest-binding and principal separation
6. **Restart-safe reconciliation** for stops, adoptions, and approved nodes
7. **Bounded credential-free RunView** as the single operator truth
8. **Thin Web/MCP projections** with no separate schemas or authorization maps
9. **Correct distinction** between coherent Run workflow and low-level kernel primitives
10. **Separately authorized deployment shutdown** that is fleet-wide (not Run-scoped)

### ❌ Remaining Operator Assembly

1. **Run recovery** (`run.recover`) — kernel exists but not exposed as Run command
2. **Evidence export** (`run.evidence`) — incomplete bundle, not content-addressed
3. **Safe CLI/serve lifecycle** — no declarative modes, requires manual shutdown/detach
4. **Semantic review integration** — structured findings defined but not wired
5. **Multi-node scheduling** — single-node only, no dependency-aware dispatch

**Overall Assessment:** Phase 64 succeeds at its primary goal — placing one durable Run facade over Baton's kernel. The remaining friction is **lifecycle, evidence, and advanced workflow assembly**, not core Run operation. An agent can successfully operate the Run application for single-node, one-shot workflows. Multi-node, recovery, and evidence export require additional operator assembly today.

---

## NEXT INTEGRATION SLICE

Based on the audit findings, the following integration steps would complete the Run application:

### Priority 1 — Evidence Export Completion (High Value, Clear Scope)

**Objective:** Complete `run.evidence` to build one content-addressed bundle.

**Required Sources:**
1. Terminal RunView (`run.status` at completion)
2. Goal/Plan digests and approval records
3. Verification verdicts and test results
4. Route observations (requested/resolved/observed)
5. Settlement receipts
6. Semantic review dispositions (when integrated)
7. Run stop receipt (if stopped)
8. Result adoption receipt (if adopted)

**Implementation:** Extend `_buildEvidence()` to bundle all sources into a content-addressed manifest.

**Test:** Verify bundle completeness and content-addressing (same inputs → same digest).

---

### Priority 2 — Run Recovery Exposure (Medium Value, Medium Scope)

**Objective:** Expose `run.recover()` as Run command.

**Implementation:**
- Add `recover(runId, principal)` method to BatonApplication
- Validate Plan-authorized attach-only exact-session policy
- Use Phase 60 identity/reap order
- Return actionable amendment requirement when unauthorized

**Test:** Authorized recovery succeeds once; absent/ambiguous recovery stays operator-bound.

---

### Priority 3 — Safe CLI/Serve Lifecycle (High Value, Larger Scope)

**Objective:** Declarative lifecycle modes and auto-shutdown.

**Implementation:**
- Define modes: `foreground`, `daemon`, `one-shot`
- Auto-detect mode from environment and signals
- Call `shutdown()` automatically in bounded `finally` paths
- Provide clear guidance on `detach()` vs `shutdown()`

**Test:** Verify clean shutdown in all modes and signal scenarios.

---

### Priority 4 — Semantic Review Integration (Medium Value, Medium Scope)

**Objective:** Wire independent semantic review into Run workflow.

**Implementation:**
- Add `semanticReview(runId, findings, principal)` command
- Validate structured findings (severity, claim, source SHA, path, range, digest)
- Bind findings to Run and update `semanticReview.state`
- Hold Run at `revision_required` when required findings exist

**Test:** Fabricated/stale/substituted anchors fail; required findings hold Run.

---

### Priority 5 — Multi-Node Scheduling (Low Value, Large Scope)

**Objective:** Dependency-aware multi-node Plan dispatch.

**Implementation:**
- Topological sort of Plan nodes
- Dependency tracking per node
- Dispatch when all dependencies satisfied
- Fold multi-node progress into RunView

**Test:** Multi-node Plans dispatch correctly; dependencies block appropriately.

---

## CONCLUSION

Phase 64 successfully transforms Baton from a kernel with scattered primitives into one coherent Run application. The **unified command bus**, **exact routing**, **durable stop/reap**, and **restart safety** are all implemented correctly. An agent can operate the application without understanding low-level coordinator details.

The remaining friction areas — recovery, evidence, lifecycle, semantic review, and multi-node scheduling — are **acceptance-red** in the spec and correctly identified as operator assembly today. These are natural next steps for completing the Run application, but they do not diminish the coherence of what Phase 64 has already shipped.

**The decisive completion metric** — reducing the 638-line dogfood runner to declarative `BatonApplication.run()` plus evidence export — remains partially achieved. The Run application facade ships; evidence export and lifecycle automation are the remaining integration work.
