UNSOUND

The product direction survives, but v1 cannot be implemented as written. Its retry law is
incompatible with its salt law and the shipped attach lookup; its task-set demo has no legal
embedded board-mutation path without crossing the explicitly deferred S-2 authority fence; and
the nesting, recipe, callback, and recovery shapes leave contract-critical choices to each
implementer. Those are contract faults, not implementation details.

## Findings

### R-DC-1 — P0 — The salt, retry, and attach laws cannot all hold

- **Grounding:** `composition-decisions.md:49-59,89-94`;
  `impl/src/wave-driver.mjs:195-218`; `impl/src/wave.mjs:172-205,234-294`.
- **Failure:** Rule 1 makes the renderer own `attemptSalt`, RC-2 requires two invocations never
  to share an objective, and the shipped driver independently mints another random salt on every
  `run()` before passing the members to `waves.start`. RC-3 nevertheless says a retry with the
  same `idempotencyKey` attaches and never double-starts. Live `createWave` derives the same
  `waveId` from the key but still calls `runs.start` for every supplied member; live attach finds
  prior members by exact objective equality. A retry with a fresh objective therefore cannot
  rediscover the old members and is free to start different runs under the same `waveId`. The
  contract also never says whether the renderer salt or driver salt is authoritative.
- **Minimal repair:** Make one durable invocation manifest the identity boundary:
  `{waveId, idempotencyKey, recipeDigest, salt, renderedMembers}`. Mint it once for a new key;
  a retry must load it and call attach with those exact members. Make the driver the sole salt
  owner (the renderer receives that salt and the driver does not salt again), or cut the attach-on-
  retry claim. Add a two-invocation row asserting identical run IDs and no additional starts for
  the same key, while a different key gets a different salt and run IDs.

### R-DC-2 — P0 — The restart/redrive helper signatures lack the state shipped attach requires

- **Grounding:** `composition-decisions.md:73-77,99-104`;
  `impl/src/wave.mjs:50-104,234-296,470-488`;
  `impl/src/application.mjs:10143-10161`;
  `impl/src/application-client.mjs:1512-1523`;
  `docs/reference/evidence/wave-durability-2026-07-30/wave-durability-decisions.md:30-49`.
- **Failure:** `attachAndHarvest(waveId, members)` is ambiguous about whether `members` means
  roles, RoleCards, unsalted rendered members, or the fully salted wave-member records required
  by live `waves.attach`. The live path validates complete members and discovers runs by their
  exact objective. `redriveMembers(waveId, roles, recipe)` is missing the original `task`,
  constraints/overrides, salt/manifest, and `repoRoot` needed to reconstruct members and recover
  pins. Neither the frozen handle nor `wave.evidence()` exposes `waveId`; `evidence()` preserves
  only role names, while `wave.runs` is an in-memory `Map` of handles. The application-side
  binding check proves a caller-supplied wave ID against a run, but does not reconstruct the
  roster or objectives. The live surface has also drifted from the cited 93B contract: that
  contract specifies `waves.attach(waveId)`, a wave ID over `{repoId,idempotencyKey}`, and
  `startedAt` from `wave.started`; live attach requires caller-supplied members, hashes only the
  idempotency key (`wave.mjs:176-179`), and seeds time from the earliest objective-matched run
  (`wave.mjs:246-259`). Thus “recipe + attach, receipted” cannot be performed after process loss
  from the stated inputs and receipt, nor can composition safely treat the sibling contract and
  live API as interchangeable.
- **Minimal repair:** Replace both helpers with APIs over the serializable invocation manifest
  from R-DC-1. `attachAndHarvest(manifest, {repoRoot})` must pass the manifest's exact rendered
  members and return the W93 refusal taxonomy. `redriveMembers(manifest, roles, {newKey})` must
  validate the role subset, render from the preserved task inputs with one new salt, and start a
  fresh wave. Include `waveId`, exact member descriptors, and schema version in the receipt. If
  that manifest is out of scope, defer both helpers. First reconcile 93B's public signature,
  repo-scoped identity derivation, and start-time source with live code and tests.

### R-DC-3 — P0 — Task-set composition has no legal facade path without crossing S-2

- **Grounding:** `composition-decisions.md:57-72,78-83,117-123`;
  `impl/src/application-client.mjs:1500-1524`;
  `impl/src/coordinator.mjs:9703-9760`;
  `impl/src/mcp-northbound.mjs:493-502,764-771,1340-1352`;
  `docs/reference/evidence/control-surface-2026-07-31/control-surface-decisions.md:51-61,109-111`.
- **Failure:** Rule 2 prohibits new application commands and leaves MCP untouched; rule 5 says
  the demo uses only the recipe library and shipped facades. The embedded `BatonClient` exposes
  `runs` and `waves`, not board reads or mutations. The direct board methods exist only on the
  Coordinator and default their actor to `orchestrator`; the shipped northbound mutation path is
  instead guarded by an orchestrator lease and `expectedBoardFence`. Its closed `baton_board_post`
  schema and dispatch do not carry `parentItemId`. Adding a recipe facade that calls the
  Coordinator would bypass those guards; extending MCP contradicts “MCP untouched”; adding an
  application command contradicts rule 2. This is exactly the authority move S-2 reserves for a
  security-reviewed successor contract.
- **Minimal repair:** Cut shared/nested task sets and their mid-flight mutation from composition
  v1. Land them only after S-2 defines one lease- and fence-checked admission primitive and the
  exact embedded/portable surface matrix. A recipe-only v1 may consume a caller-supplied read-only
  board identifier, but must not claim task-set creation or mutation ergonomics.

### R-DC-4 — P1 — `parentItemId` is not integrated into the durable item/version contract

- **Grounding:** `composition-decisions.md:66-72,95-96`;
  `impl/src/coordination-store.mjs:386-411,13391-13462`.
- **Failure:** The live item digest explicitly covers nine fields. Post constructs exactly that
  core, and every retitle/reorder/close/drop successor reconstructs it field by field. Merely
  accepting `parentItemId` at post can therefore produce either an undigested relation or one
  that silently disappears on the first successor version. The contract does not say whether a
  parent must be on the same board, whether closed/dropped parents admit children, whether the
  relation is immutable and digest-covered, or what parent drop/close does to open children.
  “Cycles refused at admission” exposes another fork: with hub-minted `itemId` and immutable
  post-only parenting, a new item cannot already be its ancestor, so cycle admission is
  unreachable; making that test meaningful implies an unstated reparent operation and authority
  seam.
- **Minimal repair:** Pin an immutable post-time relation: non-null `parentItemId` must resolve to
  an existing open item on the same board whose own `parentItemId` is null. Add it as the tenth
  digest-core field, persist it in posted events/history, preserve it in every successor, and
  project it on reads. Forbid reparenting in v1 and remove the unreachable cycle row; separately
  state whether closing a parent with open children refuses or is allowed. Any reparenting belongs
  to a later named mutation contract with fence and cycle-CAS rules.

### R-DC-5 — P1 — Worker hierarchy and roll-up semantics are not defined

- **Grounding:** `composition-decisions.md:66-72,95-98`;
  `impl/src/application.mjs:368-413`;
  `impl/src/mcp-northbound.mjs:1370-1373`;
  `impl/src/coordination-store.mjs:13492-13528,13553-13555`.
- **Failure:** The live worker projection first filters to items owned by the worker (or every
  item on a worker-named board), and its item projection has no nesting field. A child owned by
  one worker may therefore reference a parent that is absent from that worker's view. The proposed
  “existing” worker view is not actually exposed by the production board surface either: the only
  northbound `projectBoardView` call requests the full orchestrator projection. The proposed
  roll-up categories are also not a state machine: reports do not change `item.state`, a reported
  item may still have an active claim, closed items retain reports, and `dropped` is a shipped
  state omitted from `{open, claimed, reported, closed}`. “Closed parents roll up honestly” does
  not decide whether counts are board-wide or per subtree, nor the precedence between overlapping
  conditions. Two correct-looking implementations will return different counts and hierarchy
  views.
- **Minimal repair:** Define one disjoint algorithm and one visibility law. For example: board-
  wide counts with precedence `closed > reported > claimed > open`, plus an explicit `dropped`
  count (or an explicit exclusion); subtree counts are out of scope. Project `parentItemId` and
  include a visible child's ancestor as a bounded context-only stub, with truncation guaranteed
  not to leave an unexplained parent reference. Pin reports-on-closed, dropped-parent, ownership,
  sanitization, cache-fence, and byte-truncation rows.

### R-DC-6 — P1 — The recipe descriptor is not a closed implementable schema

- **Grounding:** `composition-decisions.md:49-65,87-94`;
  `impl/src/wave-driver.mjs:29-104`;
  `impl/src/wave.mjs:50-104`.
- **Failure:** “createWaveDriver policy subset” never enumerates the subset. The live closed policy
  includes function/object values (`onProgress`, `signal`), which conflict with “recipes are data,”
  and the bidirectional prerequisite adds another function callback. `route (exact|selector)` does
  not map a concrete schema to the live wave shapes (`exact:{harness,model,effort}` versus flattened
  selector fields with model/effort coupling). `verification` has no type or execution/rendering
  semantics. `{task, overrides}` has no override allowlist, merge precedence, or post-merge bounds.
  “Frozen” does not say deep versus shallow; no descriptor/member/string byte constants or canonical
  byte representation are named. RC-3 refers to “the recipe's evidencePath,” although the declared
  top-level recipe shape has no such field (it exists only in the live driver policy).
- **Minimal repair:** Add a normative schema table: exact keys, recursive caps, canonical byte
  measurement, deep-freeze law, the two closed route variants and their translation, and typed
  refusal codes. Enumerate a data-only policy allowlist. Move callbacks, abort signals, evidence
  destination, and other per-invocation capabilities to closed run options. Remove `verification`
  until its consumer is specified, or define its exact descriptor and objective-rendering role.
  Define a closed override allowlist and validate the fully merged result before any side effect.

### R-DC-7 — P1 — The callback dogfood depends on machinery absent from live code and absent from the recipe API

- **Grounding:** `composition-decisions.md:78-83,102-104,117-123`;
  `impl/src/wave-driver.mjs:31-47,95-104,140-144`;
  `docs/reference/evidence/bidirectional-2026-07-31/bidirectional-decisions.md:41-52,82-94`.
- **Failure:** Live `createWaveDriver` has no `onDecision` policy field or callback reducer; its
  closed policy currently accepts only `onProgress` among callbacks. The sibling bidirectional v2
  contract defines `onDecision` as an embedded, async function with a detailed lifecycle, but that
  is a prerequisite contract, not shipped code in this worktree. Composition neither declares a
  landing gate on that implementation nor defines how a function reaches
  `baton.recipes.run(recipe, {task, overrides})` without putting executable behavior inside its
  data-only recipe or abusing unspecified `overrides`. The acceptance demo can therefore be
  skipped, mocked at the wrong layer, or implemented by widening the recipe schema.
- **Minimal repair:** Make the landed bidirectional suite and live `onDecision` policy field an
  explicit prerequisite. Define an invocation-only `callbacks: {onDecision}` option excluded from
  recipe serialization/digests, and require the recipe wrapper to pass it through unchanged while
  preserving the sibling callback lifecycle. Otherwise remove decision gating from v1 dogfood.

### R-DC-8 — P1 — The red rows allow green implementations with broken replay, authority, and hierarchy

- **Grounding:** `composition-decisions.md:85-115`;
  `impl/src/wave-driver.mjs:415-434`;
  `impl/src/wave.mjs:246-296,470-480`;
  `impl/src/mcp-northbound.mjs:1340-1373`;
  `impl/src/coordination-store.mjs:13414-13462`.
- **Failure:** The named rows do not pin: a same-key retry across two wrapper/host instances with
  unchanged run IDs and event count; JSON round-trip of all state needed for exact attach; `waveId`
  in the receipt; parent inclusion in digest/replay/history and every successor; same-board/state
  parent rules; parent visibility under worker filtering and truncation; dropped/report/claim
  roll-up precedence; or the negative lease/fence cases required if any new board surface is added.
  TS-4 is simulated while the hard seam is process restart plus application-side wave binding.
  The separate “live dogfood receipted” sentence names no verifier for its route, result, callback,
  attach identity, or cleanup truth. All unit files and the canonical suite can be green while the
  advertised restart or child-post workflow is impossible.
- **Minimal repair:** Add the missing rows above, including one fresh-host manifest round-trip and
  one authority-negative matrix. Give live dogfood a deterministic verifier that checks member
  routes/run IDs, unique wave binding, callback disposition, parent digest/history, harvested
  result SHAs, and zero/explicit cleanup residue. Do not count a receipt file's existence as proof
  of those invariants.

### R-DC-9 — P2 — The proposal needs dependency rungs and a smaller first shipment

- **Grounding:** `composition-decisions.md:47-83,108-123`;
  `docs/reference/evidence/control-surface-2026-07-31/control-surface-decisions.md:43-70`;
  `docs/reference/evidence/wave-durability-2026-07-30/wave-durability-decisions.md:30-49,69-74`.
- **Failure:** v1 groups four independently risky migrations—descriptor/rendering, facade/run
  identity, durable board schema/projection, and restart/redrive—plus three presets and a live
  heterogeneous demo, but supplies no landing order or compatibility gates. One implementer can
  build recipes around current driver receipts while another adds nesting, and both will later
  discover they chose incompatible invocation identity and authority surfaces. The composition
  contract also treats S-2, bidirectional v2, and 93B behavior as constituents while simultaneously
  declaring their sensitive seams non-goals. That is the principal fork risk in the decomposition.
- **Minimal repair:** Ship a recipe-only rung first: exact data schema, renderer, one preset,
  invocation manifest, and same-key run/attach behavior over existing waves. Land callback
  forwarding only after bidirectional v2 is live. Land attach/redrive helpers only after the
  manifest round-trip rows pass. Defer task sets/nesting and the nested-board dogfood to S-2.
  Add the remaining presets only after the first preset proves the generic API.

### R-DC-10 — P1 — “Workflow-scoped” has no binding or namespace law

- **Grounding:** `composition-decisions.md:66-77`;
  `impl/src/coordination-store.mjs:13391-13410,13555-13560`;
  `impl/src/coordinator.mjs:9833-9854,9860-9892`;
  `impl/src/wave.mjs:470-488`.
- **Failure:** A shipped board item carries only the caller-chosen `board` string, and snapshots
  index on that string; neither records a workflow/run/wave owner. The Coordinator explicitly
  says a task has no fixed board and accepts its board from the caller. Its one existing workflow
  association discovers `board:<name>` context-package attachments for one application `runId`.
  A recipe wave, however, consists of several independent member runs, while its evidence exposes
  neither `waveId` nor a board binding. The contract never chooses whether a task set is attached
  to every member run, to some separate application-workflow run, or namespaced by the wave ID.
  Concurrent recipe invocations can consequently collide on a “named board,” or produce task
  views and workflow horizons that disagree about which items belong to the workflow.
- **Minimal repair:** Define one invocation identity first (R-DC-1), then pin a single binding
  law. For example, derive a bounded canonical board ID from `{repoId,waveId,setName}` and record
  the exact member-run bindings through one already-authorized attachment mechanism; reads must
  reject a board not bound to that invocation. Specify creation, attach/restart reconstruction,
  teardown/retention, and concurrent-name behavior. If this cannot be expressed without a new
  authority or store seam, defer “workflow-scoped task sets” with the rest of S-2.

### R-DC-11 — P0 — Recipe roles are not board-worker identities

- **Grounding:** `composition-decisions.md:49-65,66-83`;
  `impl/src/wave.mjs:483-488`;
  `impl/src/application-client.mjs:835-855`;
  `impl/src/application.mjs:371-396`;
  `impl/src/coordinator.mjs:9734-9760`.
- **Failure:** A recipe names logical roles and the wave handle maps each role to a public
  `BatonRun`, whose stable exposed identity is a run ID. Board visibility instead compares item
  ownership with a Coordinator `workerId`; claim/report entry points resolve that worker's active
  task and forcibly write `owner: workerId`. The contract defines no role→run→worker binding, no
  point at which an orchestrator learns the relevant worker ID, and no path that injects
  `projectBoardView(..., {workerId})` into a wave member's next run view. Posting a task owned by a
  role will not make it visible under the shipped worker filter, while posting it for an internal
  worker requires precisely the unpublished machinery the demo forbids. Consequently TS-4's
  “child-item post visible in the worker's next view” is not an outcome of any composed live seam.
- **Minimal repair:** Do not equate recipe roles, application run IDs, and Coordinator worker IDs.
  Either defer board-backed task sets, or introduce a separately reviewed membership binding that
  durably maps each recipe role/run to the authorized worker identity, projects the bound board
  into that member's view, and revokes/rebinds it across redrive. Pin missing/stale/foreign binding,
  role replacement, restart, and visibility tests. That is new machinery and should not be hidden
  under rule 4's “composition, not new machinery” claim.

## Surviving sections

- The ground-truth diagnosis that repeated driver assembly should be productized.
- The embedded-only `baton.recipes` direction, with no canonical grammar, CLI, MCP, or web recipe
  surface in the recipe-only rung.
- Closed unknown-field rejection, bounded inputs, deterministic rendering, and admission before
  side effects—after exact schemas, caps, and salt ownership are supplied.
- Reusable role-card intent and a small finite preset library; one preset should prove the surface
  before all three ship.
- Reuse of `createWaveDriver` for execution rather than a second control loop.
- Deterministic adapter tests, the canonical suite, and a real receipted dogfood with an executable
  truth verifier.
- The non-goals for canonical registration, portable surfaces, worker-authored task creation, and
  multi-level nesting.
