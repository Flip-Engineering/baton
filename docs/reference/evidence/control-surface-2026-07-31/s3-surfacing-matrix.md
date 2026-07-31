# S-3 bidirectional surfacing matrix — the registry-delta for the shared layer (v1)

(Successor contract named by the control-surface v2 (R-CS-3 fold): one registry-delta row
per shared-layer operation, so every surface DERIVES it uniformly — never bespoke plumbing.
Prerequisites: S-2 v2 (the admission primitive: proof-of-principal envelope, board→run
binding, CAS inside the store append) — every mutation row below RIDES that primitive; S-1
v2 (the registration mechanics + `transportHidden` pattern); CS v2 (conformance harness,
live). Grounding: the control-surface inventory (agent-27, coverage matrix) and the
bidirectional seam map (agent-28), both file:line-cited. NOT in scope: new shared-layer
FEATURES (this is surfacing only); the membership-binding/task-set machinery (P1-D
successor); worker-initiated posting.)

## The registry-delta (normative table)

Columns: canonical key · profile (closed enum `ordinary|kernel|authoring|worker|
remote_bridge|host`) · surfaces · effect · live-method mapping · authority notes.

| # | Key | Profile | Surfaces | Effect | Maps to | Authority |
|---|---|---|---|---|---|---|
| 1 | `run.scratchpad` | ordinary | embedded, cli | observe | `projectScratchpadView` (`application.mjs:512+`, folded :6970-6973) | viewer-scoped slices as today (worker: own+shared; orchestrator: all); closes the CLI.md:26-28 documented-but-missing gap |
| 2 | `decision.list` | ordinary | embedded, mcp, cli | observe | `application.decisionList` (:8985-8999) | reconciles MCP `baton_decision_list` (combined-only) to the canonical op; adds `deadlineAt` per bidirectional v2 rule 4 |
| 3 | `board.read` | ordinary | embedded, mcp | observe | `boardSnapshot` + `projectBoardView` (:368-412) | S-2 v2 rule 5 posture: transported reads require the lease |
| 4 | `board.post` | ordinary | embedded, mcp | control | S-2 primitive → `postBoardItem` (`coordinator.mjs:9704`) | S-2 v2 envelope: sessionAuthority + board→run binding + fence CAS inside append |
| 5 | `board.retitle` | ordinary | embedded, mcp | control | → `retitleBoardItem` (:9710) | same envelope |
| 6 | `board.reorder` | ordinary | embedded, mcp | control | → `reorderBoardItem` (:9716) | same envelope |
| 7 | `board.close` | ordinary | embedded, mcp | control | → `closeBoardItem` (:9722) | same envelope; candidate Finding mint unchanged |
| 8 | `board.drop` | ordinary | embedded, mcp | control | → `dropBoardItem` (:9728) | same envelope (R-BA-5's fifth mutation) |
| 9 | `scratchpad.elevate` | kernel | embedded, mcp(combined) | control | `elevateTaskScratchpad` (`coordination-store.mjs:13090`) | orchestrator-admit posture; mints the candidate Finding as today |
| 10 | `scratchpad.settle` | kernel | embedded, mcp(combined) | control | `settleWorkflowScratchpad` (:13233) | same posture |
| 11 | `package.admit` | ordinary | embedded, mcp | control | `admitContextPackage` (:9342) | S-2 v2 rule 2's binding law (R-BA-8) |
| 12 | `package.attach` | ordinary | embedded, mcp | control | `attachContextPackage` (:9422) | same; scope grammar `run|worker:<id>|board:<name>` unchanged |
| 13 | `package.read` | ordinary | embedded, mcp | observe | `contextPackageBranch` (:9325) + `projectContextPackageBranch` (`application.mjs:289-302`) | provenance-marked untrusted as today |
| 14 | `repl.manifest` | kernel | embedded | control | `admitReplManifest` (`coordinator.mjs:9766`) | worker manifests stay worker-scoped (own layer only) |
| 15 | `repl.binding` | kernel | embedded | control | `admitReplBinding`/`dropReplBinding` (:9924-9940) | version CAS `stale_binding_version` unchanged |
| 16 | `repl.cite` | ordinary | embedded, mcp | observe | `resolveReplCitation` (store :13824) | role-scoped projection (`application.mjs:426+`) |
| 17 | `knowledge.promote` | kernel | embedded | control | `promoteKnowledgeNode` (store :14308) | the orchestrator-admit gate (`admitWorkflowFinding` :14253, run-orchestrator lease binding) |
| 18 | `knowledge.recall` | ordinary | embedded, mcp | observe | `recallKnowledge` (`coordinator.mjs:9555`) | bounded recall (`recallKnowledgeBounded` :14865) |
| 19 | `knowledge.horizon` | ordinary | embedded, mcp | observe | `taskHorizon`/`workflowHorizon`/`projectHorizon` (:9837-9907) | viewer-scoped; non-orchestrator viewers must be owned workers (:9876-9880) |

(Rows 4-8 reconcile the ghost rows `application-semantics.mjs:1231-1289` to the live
executable schema `board/itemId/detail/ordinal` + required `expectedBoardFence` — the S-2
landing trims their surfaces to exactly this matrix; rows 1-3 and 9-19 are NEW canonical
rows. MCP `combined` keeps its existing reflex table as the derived projection of these
rows — no bespoke tool shapes survive.)

## Rules

1. **Every row rides the R-CS-3 delta shape** (exact key, closed profile, surfaces,
   effect/durability, closed input/output schema, authority-vs-server-derived fields,
   one-live-method mapping) and the S-1 v2 registration mechanics (derived names verbatim;
   `transportHidden` where a side-channel exists).
2. **Sequencing is law:** rows 4-8 and 11-12 land ONLY with/after the S-2 v2 primitive
   (their authority IS that primitive); read rows (1-3, 13, 16, 18-19) may land first;
   kernel rows (9-10, 14-15, 17) land with the embedded surface only (MCP-combined parity
   is a named follow-on, not this contract's scope).
3. **The ghost-surface ban is enforced here:** a row may not advertise a surface until its
   operation exists behind it (conformance negative rows per surface × operation).
4. **No new features:** schemas map one-to-one to the live methods' actual shapes; any
   mismatch between a registry row and its live method is resolved IN FAVOR of the live
   method (the row documents reality; reality is not bent to the row).
5. **Conformance:** C1 name-resolution + negative inventory per row per surface; the
   divergence ledger shrinks only by removal; authority-digest changes land one-row-group
   per commit, suite green.

## Red-first tests — `impl/test/surfacing-matrix-red.test.mjs`

1. **SM-1 (schema truth):** each row's registry schema validates exactly the inputs its live
   method accepts (fixture-valid accepted; fixture-invalid refused with the method's own
   code); ghost-shape divergence fails (a row advertising a field the method rejects, or
   missing one it requires).
2. **SM-2 (surface honesty):** negative inventory per row × surface (a row not enabled on
   web refuses `baton_board_post` over the web bus with the corrective naming the enabled
   surfaces; a kernel row on MCP ordinary refuses).
3. **SM-3 (S-2 riding):** a board mutation through the canonical row requires the S-2
   envelope (no sessionAuthority → `board_lease_required`; foreign run →
   `board_session_mismatch`) — the primitive is the ONLY path (source-scan: no residual
   adapter-side guards).
4. **SM-4 (read rows):** `run.scratchpad` facade accessor returns the projected slice
   (CLI.md:26-28 contract honored verbatim); `decision.list` carries `deadlineAt`;
   `knowledge.horizon` viewer-scoping holds.
5. **SM-5 (conformance):** C1 rows for every matrix row; ledger diff shows only removals;
   the MCP combined reflex table derives from the rows (source-scan: the bespoke
   definitions at `mcp-northbound.mjs:461-555` are generated, not hand-maintained).

Deterministic: CoordinationStore/Coordinator fixtures (reflex harness patterns), in-process
surfaces, no live providers.

## Verification

```text
node --test impl/test/surfacing-matrix-red.test.mjs impl/test/board-authority-red.test.mjs impl/test/reflex2-boards-red.test.mjs impl/test/reflex3-packages-red.test.mjs
node impl/scripts/surface-conformance.mjs
node impl/scripts/run-suite.mjs
```

## Explicit non-goals (v1)

New shared-layer features; membership bindings/task sets (P1-D successor); worker-initiated
posting; MCP-combined parity for kernel rows (named follow-on); REPL cell-as-source
composition (REPL-3 epic #23); KG ambient activation (P2-B); web/CLI surfaces for control
rows (the profile matrix keeps control rows embedded+MCP; widening is a separate reviewed
decision).
