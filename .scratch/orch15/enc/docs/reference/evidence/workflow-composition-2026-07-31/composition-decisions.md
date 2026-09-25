# Dynamic workflow composition contract — recipes, invocation manifests, task sets (v2)

(v2 folds the codex red-team (`redteam-v1.md`, verdict **UNSOUND**, R-DC-1..11, four P0s).
The decisive corrections: (1) the salt/retry/attach laws could not all hold — the renderer
salted, the driver re-salted, and attach rediscovers by EXACT objective, so a retry with a
fresh objective could double-start under one waveId; v2 makes ONE durable invocation
manifest the identity boundary and the driver the sole salt owner. (2) The helpers lacked
the state attach requires; they now ride the manifest. (3) Task-set composition has NO legal
facade path without crossing S-2's authority fence — and recipe roles are NOT board-worker
identities (R-DC-11: board visibility binds Coordinator workerIds, a membership binding that
does not exist) — so shared/nested task sets are CUT from this contract entirely, named as
the S-2-track successor below. (4) The recipe descriptor gets a normative closed schema
(R-DC-6); `verification` is removed until a consumer exists; callbacks/evidence move to
closed run options. (5) The demo's decision row is gated on the bidirectional v2
implementation landing (R-DC-7). (6) Rungs: recipe-only first, helpers second, presets
third, demo last (R-DC-9). v1 retained below as the fold trail.)

(v2.1 amendment, operator directive 2026-07-31: the per-arc `run-*-wave.mjs` driver scripts
are the bespoke-driver disease in the orchestrator's own hands — fifteen near-identical
scripts in one week. Acceptance law for the recipes library: **no new orchestration wave
may require a new script file.** If a wave can't be expressed as
`baton.recipes.run(recipe, {task, options})` with recipe as data + closed run options, the
library is INCOMPLETE and the gap is a contract bug, not a new script. The S-1 v2
registration path (derived names per surface, MCP/web/CLI) is the named successor for
surfacing recipes past the embedded facade — the MCP question rides the grammar, never a
parallel hand-list.)

## The invocation manifest (the identity boundary)

One durable, serializable record per logical invocation:
`{schemaVersion: 1, waveId, idempotencyKey, recipeDigest, salt, renderedMembers:
[{role, objective, exact, scope, report?}]}` — minted ONCE on first run of an
`idempotencyKey`; persisted in the deployment's evidence path (or caller-supplied manifest
path); a retry with the same key LOADS it and attaches with those EXACT rendered members
(the live `waves.attach` rediscovery contract); a different key mints a fresh manifest with a
fresh salt. The driver is the SOLE salt owner: the recipe wrapper mints `salt` per new
manifest, the renderer receives it as an input, and the wrapper invokes the recipe with
`saltObjectives: false` — there is exactly one salt layer, never two (R-DC-1 dissolved).

## Rules (v2 — recipe-only shipment)

1. **Recipes are data — one normative closed schema.** `{name, version, members: RoleCard[],
   policy}`. RoleCard: `{role, exact: {harness, model, effort}, scope: string[],
   objectiveTemplate: {task, constraints[]}, report?}` — EXACT routes only in v2 (selectors
   deferred). `policy` is a closed DATA-only allowlist `{steering, finalization,
   pollIntervalMs, stallTimeoutMs, hardCapMs, settleTimeoutMs, unproductiveNudgeBudget,
   preflight}` — no functions, no signals (R-DC-6). Caps: descriptor ≤ 8KiB canonical JSON,
   objectiveTemplate.task ≤ 2KiB, each constraint ≤ 240B, ≤ 8 constraints per card, ≤ 8
   cards; deep-frozen at admission; unknown fields refused with the corrective naming the
   field. `verification` is REMOVED (no consumer specified — R-DC-6).
2. **One renderer, salt as input.** `renderObjective({task, constraints, salt})` composes
   the pinned shape (task, then constraint lines, then `[attempt: <salt> <role>]`), byte-
   capped at the admission check; the renderer never mints its own salt.
3. **`baton.recipes` is an embedded-facade library over the shipped driver.** No new
   application commands, no registry entries, MCP/CLI/web untouched. Run options are closed
   and per-invocation: `{idempotencyKey, manifestPath?, evidencePath?, callbacks?:
   {onDecision?}, overrides?}` — callbacks/signals/evidence are NEVER serialized into the
   recipe or its digest (R-DC-6/7); overrides allowlist `{constraints (append), effort,
   scope (replace)}` with the fully merged result re-validated before any side effect.
4. **Composition helpers ride the manifest.** `attachAndHarvest(manifest, {repoRoot})` →
   `waves.attach(manifest.waveId, manifest.renderedMembers)` returning the W93 refusal
   taxonomy. `redriveMembers(manifest, roles, {newIdempotencyKey})` → validates the role
   subset, renders from the manifest's preserved task inputs with ONE new salt, starts a
   fresh wave (new manifest). Receipts carry `waveId`, exact member descriptors,
   `schemaVersion` (R-DC-2).
5. **Sequencing is law.** RC-A: schema + renderer + manifest + the `implementContract`
   preset + same-key run/attach behavior over existing waves. RC-B: attach/redrive helpers —
   only after the manifest round-trip rows pass. RC-C: `redTeamContract` + `reviewChange`
   presets — only after RC-A's generic API proves. RC-D: the live demo — only after the
   bidirectional v2 implementation lands (its `onDecision` policy field exists in live code),
   using ONLY the library + shipped facades (R-DC-7/9).
6. **Task sets stay cut.** Shared/nested task sets, mid-flight board mutation, and any
   role→worker membership binding are the named successor (below) — a recipe-only v2 may
   consume a caller-supplied READ-ONLY board identifier as task context, never mutate.

## Named successors (out of scope)

- **Membership binding + workflow-scoped task sets** (S-2 track): the durable
  role→run→worker binding, board namespace law (`{repoId, waveId, setName}` canonical board
  id + binding records + foreign-board read refusal), one-level nesting with cycle
  prevention, and orchestrator/ worker task views — needs S-2's admission primitive first
  (R-DC-3/4/5/10/11).
- **93B contract erratum** (honesty, folded here): the LIVE attach takes caller-supplied
  members, derives `waveId` from the idempotencyKey ONLY (not `{repoId, key}`), and seeds
  `startedAt` from the earliest objective-matched run — the 93B v2 contract's
  `waves.attach(waveId)` shorthand and repo-scoped derivation describe intent, not the
  shipped signature; the W93 suite pins the live behavior (see
  `impl/test/wave-attach-red.test.mjs` header). The 93B doc is amended to say so.

## Red-first tests — `impl/test/recipes-red.test.mjs` (v2 battery)

1. **RC-1 (schema):** the closed-shape battery — unknown fields, oversize descriptor/task/
   constraint, duplicate roles, non-exact route, function value anywhere in the recipe
   (source-scan + runtime check), all refused with corrective field names; a valid recipe
   deep-freezes.
2. **RC-2 (renderer):** pinned composition shape; salt is an input (two renders with the
   same salt are identical; different salts differ); byte cap enforced.
3. **RC-3 (manifest identity):** first run mints the manifest (exact rendered members);
   retry with the same key LOADS it and ATTACHES — identical member runIds, zero additional
   `runs.start` calls; a different key mints a fresh manifest/salt/runIds; manifest
   round-trip (serialize → load → attach) preserves the exact members.
4. **RC-4 (helpers):** `attachAndHarvest` returns the W93 taxonomy (unknown waveId,
   mismatched member); `redriveMembers` validates the role subset, starts a fresh wave with
   new salt, prior runIds untouched.
5. **RC-5 (run options):** callbacks/evidencePath/overrides never enter the recipe digest;
   the override allowlist merges and re-validates (a post-merge oversize objective refuses
   before any side effect); `onDecision` passes through unchanged (present only when the
   bidirectional field exists in live code — skipped with an honest note until then).
6. **RC-6 (preset):** `implementContract` over a MockAdapter seat returns the
   createWaveDriver receipt shape with recipe routes/scopes; idempotencyKey retry attaches.

Deterministic: MockAdapter/PausableAdapter fixtures, fixed clocks, no live providers.

## Verification

```text
node --test impl/test/recipes-red.test.mjs
node impl/scripts/run-suite.mjs
```

## Explicit non-goals (v2)

Everything under "Named successors"; selector routes; `verification`; task sets/nesting;
membership bindings; CLI/MCP/web recipe surfaces; worker-initiated task creation;
`createWaveDriver` internals beyond what bidirectional v2 already lands; multi-preset first
shipment (one preset proves the API first).

---

# Dynamic workflow composition contract — recipes, role cards, shared task sets (v1)

(Seed: operator directives 2026-07-22..31 — "long-running multi-task dynamic workflows
consisting of dynamic and responsive heterogeneous and homogeneous swarms of agents";
"productize the wave-driver pattern… a shipped baton.wave()/recipe, not living in my evidence
dirs"; "dynamic (and responsive) workflows composing those swarms through shared and nested
task sets and scripted agent patterns/instructions/roles." Parent receipts: every campaign
wave since 2026-07-20 has cost a bespoke driver script (the AX report's #1 friction: "Each
baton wave cost me a bespoke driver and hours of my own driver bugs"); the demo campaign
v1-v12 closed a full inter-agent loop on bespoke scripting; the shipped `createWaveDriver`
(#46) + 93B attach + bidirectional v2 gating are the machinery this composes. Sibling
contracts: control-surface v2 (registration), bidirectional v2 (driver callbacks), S-2/S-3
(board authority + surfacing — this contract uses only EXISTING board authority).)

## Ground truth

1. **The driver pattern is proven and unproductized.** The same wave-driver script shape has
   been hand-copied into 15+ evidence dirs (deepseek routes, 93B, #11, control-surface,
   bidirectional, red-teams): openBaton + createWaveDriver + members + evidencePath + receipt
   logging. The only variance: route table, member objectives/scopes, verification command,
   policy tuning. The pattern's laws (salting, idempotency, evidence, steering) are already
   enforced by `createWaveDriver`; the bespoke remainder is assembly.
2. **Roles are already first-class but unscripted.** Wave members carry
   `{role, objective, harness/model/effort, scope, report}`; workstreams carry role +
   generation; the demo used role-addressed relays. No reusable role-card abstraction exists —
   objectives are re-authored per wave with the same boilerplate (OVERSIZE constraint, NUL
   warning, no-commit, attempt salt).
3. **Boards are a task-set substrate with orchestrator-only ergonomics.** Orchestrator posts,
   retitles, reorders, closes items; workers claim/report with board-fence CAS
   (`coordinator.mjs:9704-9760`; store `coordination-store.mjs:13374-13555`). What boards
   lack for composition: nesting (parent/child item links), workflow-scoped task SETS as a
   named object, and per-worker task views — all derivable from existing board records
   without new authority (S-2 owns authority moves; this contract adds none).
4. **Dynamic membership is half-built.** 93B attach lets a fresh driver take over a wave;
   `waves.start` can add a parallel wave; `wave.stopMember` removes one. There is no
   sanctioned "add a member to a running workflow" or "re-drive these members" recipe, though
   every piece exists (re-drive rule 5 per the 93B contract).

## The question

Does baton ship the composition layer the orchestrator actually writes — parameterized wave
recipes with scripted role cards, over the shipped driver, with workflow-scoped shared/nested
task sets as the steering object — or does every campaign keep re-assembling the same driver
by hand? This contract picks the productized layer, on evidence that the bespoke assembly is
the #1 receipted friction and every constituent mechanism is already shipped and green.

## Rules

1. **Recipes are data, not scripts.** A recipe is a closed, frozen, byte-bounded descriptor:
   `{name, version, members: RoleCard[], policy (createWaveDriver policy subset),
   verification, idempotencyKey?}`. A RoleCard is `{role, route (exact|selector), scope,
   objectiveTemplate, report?}` where objectiveTemplate composes
   `{task, constraints[], attemptSalt}` through ONE pinned renderer (the renderer owns the
   boilerplate: OVERSIZE constraint, NUL warning, no-commit, salt — never per-author prose
   drift). Recipe + card shapes are closed (unknown fields refused), byte-capped, and
   validated ONCE at admission with the corrective naming the field.
2. **`baton.recipes` is an embedded-facade library, not a new command family.** Shipped as
   `impl/src/recipes.mjs` + facade accessor (`baton.recipes.run(recipe, {task, overrides})`
   → the createWaveDriver receipt), riding the EXISTING waves/driver machinery. No new
   application commands, no registry entries (the S-1 grammar amendment decides whether
   recipes ever get canonical names); MCP/CLI/web untouched. The three campaign-proven
   recipes ship as the initial library: `redTeamContract` (one adversarial seat, verdict+
   findings to a report path), `implementContract` (one red-first implementation seat),
   `reviewChange` (reviewer+challenger, the `baton.review` preset shape) — each parameterized
   by contract path, seat route, scope.
3. **Shared task sets are workflow-scoped board projections with nesting.** A task set is a
   named board whose items carry an optional `parentItemId` (one level of nesting; cycles
   refused at admission). New ergonomics ride EXISTING board authority: per-worker task view
   = the existing `projectBoardView` worker slice; orchestrator view = the full snapshot;
   set-level roll-up `{open, claimed, reported, closed}` derived, never stored. No new
   authority, no new store kinds — nesting is a field on the existing item record with
   validation at the existing mutation seams.
4. **Dynamic membership is recipe-level composition, not new machinery.** The library ships
   two composition helpers over shipped machinery: `redriveMembers(waveId, roles, recipe)`
   (93B rule 5: fresh wave for the named roles with salted objectives; checkpoint pins carry
   prior work) and `attachAndHarvest(waveId, members)` (93B attach). A workflow LONG-RUNNING
   across driver restarts is recipe + attach, receipted — never bespoke resurrection logic.
5. **The acceptance dogfood is a real composition.** One dynamic workflow demo: a recipe
   driving ≥2 heterogeneous members over a shared nested task set, with a mid-flight task
   addition (orchestrator posts a child item), a member decision gated through the
   bidirectional callback, and a driver restart with attach-and-harvest — every step
   receipted in the evidence dir. The demo script ships as `demo/compose.mjs` (or evidence
   driver) using ONLY the recipes library + shipped facades — no bespoke driver internals.

## Red-first tests — `impl/test/recipes-red.test.mjs` + `impl/test/task-sets-red.test.mjs`

1. **RC-1 (closed shapes):** recipe/card validation refuses unknown fields, oversize,
   duplicate roles, bad routes, with corrective field names; a valid recipe freezes.
2. **RC-2 (renderer):** the objective renderer composes task+constraints+salt into the
   pinned shape (byte-capped, all boilerplate present, salt unique per run); two invocations
   never share an objective.
3. **RC-3 (recipe run):** `redTeamContract` over a MockAdapter seat returns the
   createWaveDriver receipt shape; members start with recipe routes/scopes; the evidence
   lands at the recipe's evidencePath; idempotencyKey retry attaches, never double-starts.
4. **TS-1 (nesting):** a child item admits with a valid parent; a cycle/missing parent/
   second-level child refuses with typed codes; roll-ups derive correctly per set.
5. **TS-2 (views):** the per-worker view shows exactly the worker's slice (existing
   projection); the orchestrator roll-up shows the set; closed parents roll up honestly.
6. **TS-3 (dynamic membership):** `redriveMembers` starts a fresh wave for exactly the named
   roles with NEW salted objectives (prior runIds untouched); `attachAndHarvest` binds the
   W93 taxonomy (unknown wave refuses; mismatched members refuse).
7. **TS-4 (composition dogfood, simulated):** the demo flow over MockAdapter members:
   mid-flight child-item post visible in the worker's next view; a decision gated by the
   driver's onDecision; a simulated restart + attach harvests outcomes — all receipted.

Deterministic: MockAdapter/PausableAdapter fixtures, fixed clocks, no live providers.

## Verification

```text
node --test impl/test/recipes-red.test.mjs impl/test/task-sets-red.test.mjs
node impl/scripts/run-suite.mjs
```

plus the live acceptance dogfood (rule 5) receipted in this evidence dir.

## Explicit non-goals (v1)

Board authority moves (S-2); canonical recipe registration (S-1 decides); CLI/MCP/web recipe
surfaces; multi-level nesting (one level only); workflow templates beyond the three named
recipes; worker-initiated task creation (workers claim/report; posting stays orchestrator);
the P1-C AX spine; any change to `createWaveDriver` internals beyond what bidirectional v2
already lands.
