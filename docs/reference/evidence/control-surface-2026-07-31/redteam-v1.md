UNSOUND

The completion goal survives, but v1 is not safe implementation authority. It leaves the board
lease boundary open to two incompatible implementations, contradicts the landed derivation and
the v2.1 treatment of waves, assigns already-registered board/package operations to no coherent
profile migration, and postpones the conformance contracts until after the operations they are
supposed to gate. The P0 is not theoretical: a facade implementation that follows rule 4's
instruction to use the existing coordinator wrappers can write a board without the MCP session's
lease posture or its fence check.

## R-CS-1 — P0 — The facade board path can become an authority bypass

Grounding:

- `mcp-northbound.mjs:1332-1361,1430-1448` performs the active session-bound orchestrator-lease
  lookup and board-fence comparison in the MCP adapter, before calling the coordinator.
- `coordination-store.mjs:1818-1842` shows that a lease lookup is bound to
  `{repoId, principalId, sessionId, expiresAt}` and then revalidates the lease's session authority,
  parent task, and Run admission.
- `coordinator.mjs:9703-9725` accepts only fields plus an optional actor/idempotency key, defaults
  the actor to `orchestrator`, and forwards directly to the store.
- `coordination-store.mjs:13391-13411,13465-13483` checks neither a run-orchestrator lease nor an
  `expectedBoardFence` for orchestrator board mutations.
- Contract rules 4-5 (`control-surface-decisions.md:74-89`) both say to use the same coordinator
  wrappers and to move the guard into the application/coordinator command path, but do not say
  which layer owns the session proof or how a facade caller obtains it.

Failure:

Two competent implementations can both claim compliance. One can expose
`facade.board.post()` through `Coordinator.postBoardItem`, thereby inheriting the current default
`actor: 'orchestrator'` and bypassing both checks. Another can make every coordinator/store caller
present an MCP-shaped session lease and break trusted in-process callers that do not have MCP's
`principal.userId/sessionId/expiresAt` tuple. Merely moving `_requireOrchestratorLease` is not a
specification: the facade's principal/session binding, lease acquisition, revocation race,
Run-to-board binding, check/write atomicity, and exact refusal precedence are all unstated. A fence
check moved across an asynchronous application authorization step could therefore introduce a
time-of-check/time-of-use split even though today's MCP check and synchronous coordinator call
occur in one turn.

Minimal repair:

Cut board/package/REPL mutation surfacing from this contract until an authority sub-contract pins
one shared admission primitive. That primitive must accept a closed session-authority envelope,
resolve and revalidate the active lease at mutation admission, compare a required board fence in
the same serialized command path, bind the idempotency key to the normalized request, prohibit
defaulting an untrusted caller to `orchestrator`, and define refusal order/codes. Specify how the
embedded facade obtains that session authority. Pin negative tests for no lease, wrong session,
revoked/expired lease, stale parent, closed Run, stale fence, replay-same, and replay-conflict before
adding any facade method.

## R-CS-2 — P1 — The wave requirements contradict derivation, v2.1, and their own schema test

Grounding:

- `application-semantics.mjs:1088-1105` derives `waves.start` as CLI `baton waves start`, MCP
  `baton_waves_start`, Web `waves_start`, and embedded `waves.start()`.
- Rule 3 and CS-2 (`control-surface-decisions.md:66-73,101-103`) require registry keys
  `waves.start`/`waves.attach` but singular CLI verbs `wave start`/`wave attach`.
- The CS-2 red contract (`control-surface-decisions.md:120-127`) requires MCP `waves.attach` while
  also requiring `waveId` to be rejected by MCP validation and omitted from its schema.
- The live attach API requires `waveId` (`application-client.mjs:1495-1505`), and the underlying
  side gate refuses a mismatched wave identity (`application.mjs:1434-1438,10147-10158`).
- docs/36 v2.1 treats `waves.start` as recorded preset sugar over `run.start`, not a canonical peer
  (`docs/36-unified-control-grammar.md:289-294,324-326`). CLI.md likewise says waves are
  embedding-only (`impl/CLI.md:24-28`).

Failure:

The requested singular CLI name cannot be derived from the requested plural registry key without
adding the exact hand alias rule 3 forbids. A transported attach operation cannot identify the
wave if its required `waveId` is forbidden. Registering `waves.start` as a new canonical operation
also forks the landed L5 model: one implementer can treat it as `run.start` expansion sugar while
another can give it independent command/idempotency semantics.

Minimal repair:

Keep `waves.start` as registry-declared preset expansion of `run.start`. Decide separately whether
attach is embedding/host orchestration or a portable operation. If portable, choose one canonical
key and accept its mechanically derived names, make `waveId` a required public input to attach,
and hide only `mintWaveDetached` (plus the underlying `run.inspect` side-channel occurrence of
`waveId`). Pin expansion, idempotency, and authority semantics before enabling another surface.

## R-CS-3 — P1 — Rule 4 has no coherent registry/profile/schema delta

Grounding:

- Board and package operations are already in the 44-operation v2 registry
  (`application-semantics.mjs:1231-1289`); rule 4 nevertheless says they “enter” the canonical set.
- Those board rows default to profile `ordinary` and all four surfaces because unspecified profile
  and surface fields become `ordinary`/`ALL_SURFACES`
  (`application-semantics.mjs:1501-1526`).
- docs/36 names only `ordinary | kernel | authoring | worker | remote_bridge | host`, keeps profile
  boundaries intact, and calls board post/retitle/reorder/close/read orchestrator operations while
  leaving them unmarked (therefore ordinary):
  `docs/36-unified-control-grammar.md:267-301,316-360,483-489,592-593`.
- The registry board schema uses `runId/entryId/note/before`, makes `expectedBoardFence` optional,
  and advertises every surface (`application-semantics.mjs:1231-1270`). The live MCP schema uses
  `board/itemId/detail/ordinal` and requires `expectedBoardFence`
  (`mcp-northbound.mjs:485-527`).
- CS-2 requires a registry `mcpStateful:true` pin and a per-field “hidden-by-declaration” flag
  (`control-surface-decisions.md:120-127`), but canonical registry construction has neither field
  (`application-semantics.mjs:1501-1530`). The landed registry authority model instead exposes
  operation-level durability and one closed schema/flag-alias projection.
- Rule 4 names `decision_list` as “a canonical operation” (`control-surface-decisions.md:81-82`),
  but canonical keys are dot-separated lowercase alphanumeric components and reject underscores
  (`application-semantics.mjs:1088-1092`). No canonical noun/verb key is supplied.
- The cited kernel capabilities are not one obvious operation each: REPL exposes manifest admit,
  binding admit/drop/snapshot, and citation resolution (`coordinator.mjs:9762-9778,9919-9955`);
  scratchpad has task elevation and workflow settlement
  (`coordination-store.mjs:13090-13110,13233-13255`); knowledge has several add/promote/query and
  horizon paths, of which `promoteKnowledgeNode` is only one (`coordination-store.mjs:14308-14318`).

Failure:

“Orchestrator (kernel) profile” is not a landed profile name, and `orchestrator`, `kernel`, and
`ordinary-with-a-lease` are materially different authority choices. The current registry already
documents ghost board/package surfaces, but its canonical schemas do not match the executable MCP
schemas. Rule 4 supplies no exact keys, verbs, schemas, effects, profiles, enabled surfaces, or
adapter mapping for scratchpad, decisions, REPL, or knowledge. Implementers can therefore produce
different registries and incompatible C1/C2 outcomes while following the prose. For CS-2, one
implementer can add transport-specific fields to registry v2 while another can interpret
`mcpStateful` as the existing `idempotent/reconcilable` pair; both satisfy different parts of the
text. They can likewise choose different canonical keys for `decision_list`, with mechanically
different names on all four surfaces.

Minimal repair:

Publish a docs/36 v2.2 registry-delta table before implementation. For every operation, pin the
canonical key, allowed profile from a closed profile enum, enabled surfaces, effect/durability,
closed input/output schema, authority inputs versus server-derived fields, and mapping to one live
method. First reconcile or remove the already-landed board/package ghost rows. If an
`orchestrator` profile is intended, define its principal and containment semantics explicitly;
do not use it as a synonym for `kernel`.

## R-CS-4 — P1 — “Server truth” is ambiguous for capability- and profile-filtered surfaces

Grounding:

- The current renderer filters only `operation.surfaces` and renders every matching registry row
  (`render-surface-docs.mjs:25-52`); it does not inspect a server.
- docs/36 defines a principal-dependent inventory as
  `render(filter(registry, principal.capabilities union profile))`
  (`docs/36-unified-control-grammar.md:298-301,483-489`).
- MCP chooses three materially different inventories at instance construction and can further
  mutate schemas for a bound application context (`mcp-northbound.mjs:824-864`).
- The CLI inventory includes local host operations and worker-profile operations alongside
  ordinary commands (`impl/CLI.md:36-83`); not all of those dispatch to a resident mock server.
- MCP.md retains hand-written claims of “exactly eleven” default tools and 21 reflexive `baton_*`
  tools outside the generated markers (`impl/MCP.md:71-100`), while the generated block starts at
  `impl/MCP.md:102`. The renderer can neither update nor reject those prose inventories
  (`render-surface-docs.mjs:55-87`).
- CS-1 proposes one generated table and a test that every CLI row parses and dispatches through a
  mock server (`control-surface-decisions.md:53-57,113-119`).

Failure:

There is no single “live server inventory”: it varies by MCP surface, principal capabilities,
bound context, and host-local versus transported execution. “Registry intersected with live
inventory” could mean a build-time maximal reference deployment, the invoking principal's
runtime inventory, or a union across profiles. Each produces different docs. The proposed CLI
test also conflates local execution with Web dispatch and does not state which principal may see
worker/kernel operations. Thus rule 1 does not uniquely define either the rendered rows or the
served-but-undocumented inverse check. Restricting CS-1 to parsing generated tables leaves the
stale hand-written MCP inventory claims green, despite “server truth is the only doc source.”

Minimal repair:

Define a normative profile matrix and reference principals. Render the maximum supported contract
as separate profile sections, with each row tied to one executable inventory adapter. Conformance
must instantiate each reference profile, compare its exact positive and negative inventory with
the matching doc section, and exercise host-local CLI commands through their local executor rather
than the Web mock. Keep runtime introspection principal-filtered; do not make a static manual depend
on whichever live principal happened to render it. Delete or generate every prose inventory too,
and lint inventory-like counts/name lists outside generated regions so the old hand lists cannot
survive beside a correct table.

## R-CS-5 — P1 — CS-1..CS-4 cannot satisfy the landed green-at-every-commit discipline

Grounding:

- docs/36 requires append-forbidden/removal-only ledger evolution, spec-version/red-team approval
  for post-M0 additions, and green conformance at every commit
  (`docs/36-unified-control-grammar.md:491-501,512-514`).
- `checkLedgerMonotone` rejects every new row; the ledger schema has no retired-row state
  (`surface-conformance.mjs:205-246,292-299`).
- The live ledger contains one behavior row, already marked `retiresIn: M4`
  (`surface-divergence-ledger.json:1-12`).
- CS-4 says the ledger “gains the pre-CS-1 entries as retired rows” and only then extends C1/C2 to
  operations landed in CS-2/CS-3 (`control-surface-decisions.md:108-109,135-137`).
- docs/36 requires C1 execution and negative inventory per profile and C2 outcome identity across
  enabled surfaces (`docs/36-unified-control-grammar.md:551-560`), and authority-digest changes land
  at a fleet quiesce point (`docs/36-unified-control-grammar.md:512-514,590-591`).

Failure:

CS-4 cannot append “retired” rows without failing the monotonic ledger rule, and there are no
identified pre-CS-1 rows to remove. More importantly, CS-2 and CS-3 add registry operations and
surfaces before their C1/C2 coverage exists, so a nominally green commit can ship non-executable or
outcome-divergent entries. Every registry authority change also moves the authority digest, but no
rung names its required quiesce point. This is not a green-at-every-commit decomposition.

Minimal repair:

Move each operation's C1 positive/negative inventory and applicable C2 identity contracts into the
same red-first rung as that operation. Remove a real ledger row in the exact commit that resolves
it; never add historical/retired rows. Add an explicit docs/36 version bump and approval gate for
the new operation set, plus a quiesce precondition for each authority-digest-changing commit. Leave
CS-4 only cross-cutting strengthening that does not retroactively make earlier rungs conformant.

## R-CS-6 — P1 — The named conformance verification is currently vacuous

Grounding:

- `surface-conformance.mjs:1-299` exports inventory/classification, ledger, enum, collision, and
  serialization helpers but has no executable main block.
- Consequently the contract's command `node impl/scripts/surface-conformance.mjs`
  (`control-surface-decisions.md:141-147`) imports definitions and exits zero without running a
  check.
- The current audit is also largely textual: MCP names are regex-extracted and CLI rows come from
  `registry.cli.commands`, not parser/dispatcher execution (`surface-audit.mjs:62-128`).
- `classifySurfaces` establishes name resolution only (`surface-conformance.mjs:80-171`); it is not
  docs-to-server execution or C2 outcome identity.

Failure:

An implementation can pass the advertised standalone conformance command with novel divergence,
a stale/dead ledger, ghost docs, or an unserved canonical operation. CS-1's proposed tests help,
but the verification block still presents a no-op command as an independent acceptance gate.

Minimal repair:

Either add an executable main that loads the ledger and fails on ledger validation, novel name or
enum divergence, Web-name collision, and stale generated docs, or replace the command with the
specific `node --test` files that perform those checks. Add instantiated per-profile server
inventory and execution checks; retain textual extraction only as a supplemental drift detector.

## R-CS-7 — P2 — The evidence is not fully citation-clean

Grounding and citation verification:

| Contract citation | Status against live code |
|---|---|
| `application-semantics.mjs:700-745` | **Incorrect use.** This is `OPERATION_ALIASES`, not the CLI parser, so it does not establish “the parser accepts ~10.” Parser control begins in `application-cli.mjs:1194`; the legacy CLI inventory itself is at `application-semantics.mjs:813-856`. |
| `mcp-northbound.mjs:824-854` | **Partial.** It proves profile selection. Instantiating the application surface yields the claimed 15 advertised `baton_*` tools, but the cited range does not enumerate or count them; definitions are at `mcp-northbound.mjs:325-401`. |
| `render-surface-docs.mjs:33-47` | **Verified.** Both tables derive rows solely from registry operations/surface flags. |
| `application-cli.mjs:1332` versus `:1612` | **Verified.** `resume` is absent from `lifecycleActions`, making the later branch unreachable. |
| `application-cli.mjs:15-22,1770` | **Verified.** Parsed names outside `COMMANDS` are refused by `BatonWebClient.command`. |
| `application-cli.mjs:23-28` | **Partial.** It documents only `application.context_eval`; it says nothing about `run.debug`. The debug direct-port rationale is at `application.mjs:655-668`. |
| `application-client.mjs:1495-1507` | **Verified.** The client exposes wave start and attach. |
| `application-deployment.mjs:1188-1195` | **Verified.** The deployment facade exposes wave start only. |
| `application.mjs:10503` | **Verified.** `run.debug` is a direct public application method, absent from the command table by `application.mjs:655-658`. |
| `mcp-northbound.mjs:47` | **Claim verified, line imprecise.** `baton_runs` is mapped at `:48` (also `:29`) but has no tool definition in `:325-401`, so it dispatches but is not advertised. |
| `mcp-northbound.mjs:1338-1361` | **Verified.** All four board writes are explicit MCP-only dispatch branches with adapter-local lease/fence checks. |
| `coordination-store.mjs:13090,13233` | **Verified.** These are task elevation and workflow settlement entry points. |
| `coordinator.mjs:9766-9955` | **Verified with broad wording.** The range contains worker manifest admission, REPL binding admit/drop/read helpers, and knowledge horizons; it does not define one singular “REPL orchestration” operation. |
| `coordination-store.mjs:14308` | **Verified.** This is `promoteKnowledgeNode`. |
| `impl/CLI.md:26-28` | **Verified.** The prose promises `run.scratchpad({workerId})` through embedding projections and explicitly excludes CLI writes. |
| `application.mjs:5269-5271` | **Verified.** A scratchpad projection is already computed inside the historical profile view. |

The seven blocked CLI spellings also reproduce as distinct parser/whitelist facts: `run episode`
and `run result` emit `run.episode`; `run workstreams` emits `run.workstreams`; `run notify` emits
`run.workstream.notify`; `run stop-member` emits `run.workstream.stop`; and `run debug` emits
`run.debug` (`application-cli.mjs:1338-1379,1546-1559,1592-1606`). `context eval` emits
`application.context_eval` after its local program-file validation
(`application-cli.mjs:1285-1314`). None of those command names appears in the Web-client whitelist
at `application-cli.mjs:15-22`.

Failure:

The decision is based on real drift, but two of its headline measurements cite metadata rather
than the claimed live surface, and one comment citation is assigned to the wrong operation. This
makes the baseline hard to reproduce and masks the more important fact that the registry already
contains seven board and three package rows the rules speak of as new.

Minimal repair:

Replace counts with a checked inventory artifact produced from parser/dispatcher execution and
instantiated MCP profiles. Correct the parser and debug citations, cite the MCP definition range
for the 15-tool count, and state explicitly which registry rows are ghost surfaces versus genuinely
absent operations.

## R-CS-8 — P2 — The scope combines completion, feature promotion, and a security-boundary move

Grounding:

- CS-1 changes docs, parser/dispatch, MCP advertising, and the conformance model.
- CS-2 turns embedding-only wave orchestration and a direct debug port into CLI, MCP, Web, and
  facade operations (`control-surface-decisions.md:101-103`).
- CS-3 simultaneously promotes scratchpad, boards, decisions, REPL, and knowledge while relocating
  their mutation authority (`control-surface-decisions.md:104-107`).
- The non-goal says “no new bidirectional machinery” (`control-surface-decisions.md:149-154`), but
  session-authority propagation, profile projection, canonical schemas, remote validation, and
  command-path CAS are new cross-layer machinery even if the underlying store methods already
  exist.

Failure:

The scope prevents a small auditable completion rung and makes rollback non-local. A board
authority fix touches security and idempotency; wave transport changes preset semantics; REPL and
knowledge need their own operation/profile design. Calling all of that “surfacing only” hides the
work and encourages shallow adapters over methods with different authority models.

Minimal repair:

Keep v1 to server-truth conformance, dead CLI paths, `baton_runs`, and at most the already-bounded
`run.debug` registration. Give wave attach/preset semantics a separate grammar amendment. Give
board/package authority migration its own security-reviewed contract. Defer scratchpad mutation,
REPL, and knowledge promotion until the profile/schema matrix from R-CS-3 is approved.

## Surviving sections

- The choice to stop surface drift and complete executable conformance survives.
- Ground-truth item 1's renderer/conformance blind-spot diagnosis survives, with corrected parser
  and MCP citations.
- Ground-truth item 2 survives: the unreachable `run resume` branch and whitelist-blocked parsed
  commands are real, and rule 2's parse-or-dispatch invariant is sound.
- The `baton_runs` shadow-dispatch diagnosis survives.
- The client/deployment wave parity mismatch and direct-only `run.debug` gap survive as inventory
  facts, but not v1's prescribed cross-surface solution.
- The board, scratchpad, decision, REPL, and knowledge fragmentation inventory survives as a
  problem statement; its authority and profile solution does not.
- Rule 6's exclusion of M5 alias sunset survives.
- Deterministic in-process/MockAdapter testing and the explicit exclusions for operator-console
  work, MCP profile restructuring, combined-profile splitting, and `run.steer` retirement survive.
