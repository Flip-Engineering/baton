# Control-surface contract — grammar completion + bidirectional surfacing (v1)

(Seed: operator directive 2026-07-31 — "prioritize unified and combined control surfaces and
all bidirectional features; collaboration, dynamic and steered orchestration, real-time
messaging, interaction, notification between the models." Parent issues: #43 (control-surface
audit), #48 (embedded facade shared-layer gaps), docs/36 v2.1 FINAL (the unified control
grammar, M0–M4b landed). Grounding: full mechanical inventory by explore subagent 2026-07-31,
file:line-cited; every claim below carries its citation.)

## Ground truth

The grammar epic retired the hand-list *concept* but the surfaces still drift in practice:

1. **Docs render grammar intent, not server truth.** CLI.md's generated table lists 44 verbs;
   the parser accepts ~10 (`application-semantics.mjs:700-745`). MCP.md claims "exactly eleven
   tools" on the default surface; the live `application` inventory is 15 `baton_*` with
   `fleet_run_*` combined-only (`mcp-northbound.mjs:824-854`). The renderer
   (`impl/scripts/render-surface-docs.mjs:33-47`) prints `deriveSurfaceNames` output for every
   grammar operation; the conformance check compares doc↔renderer, so **doc↔server drift is
   invisible by construction**.
2. **Dead and blocked paths ship.** `baton run resume` is a dead parser branch (`'resume'`
   missing from `lifecycleActions`, `application-cli.mjs:1332` vs parser :1612). Seven verbs
   parse then die at the `COMMANDS` whitelist (`application-cli.mjs:15-22` gate :1770):
   `run episode`, `run result`, `run workstreams`, `run notify`, `run stop-member`,
   `run debug`, `context eval`. No comment marks any of them deliberate except
   `context_eval`/`run.debug` (:23-28).
3. **New operations land outside the grammar.** `waves.start`/`waves.attach` (93B) exist only
   on `BatonClient.waves` (`application-client.mjs:1495-1507`); the deployment facade has
   `start` only (`application-deployment.mjs:1188-1195`); CLI/MCP/web have zero `waves`
   presence; neither operation is in the registry. `run.debug` (#53) is a direct port
   (`application.mjs:10503`) absent from the registry, the CLI dispatch, and every doc.
   `baton_runs` dispatches but is advertised nowhere (`mcp-northbound.mjs:47`).
4. **The bidirectional layer is surface-fragmented (issue #48, all four claims verified).**
   Board writes are MCP-only among transported surfaces (`mcp-northbound.mjs:1338-1361`);
   `baton_decision_list` is MCP-combined-only; scratchpad elevation is kernel-only
   (`coordination-store.mjs:13090/:13233`); REPL orchestration is kernel-only
   (`coordinator.mjs:9766-9955`); knowledge promotion is kernel-only
   (`coordination-store.mjs:14308`). The embedded facade — the orchestrator's primary surface —
   has none of them, and `run.scratchpad` is documented-but-missing (CLI.md:26-28).

## The question

Does the grammar get *completed* — surfaces generated from registry v2 with server-truth
conformance, dead paths resolved, new ops registered — and does the bidirectional layer enter
the canonical operation set so every surface derives it uniformly? Or do new capabilities keep
landing wherever their author happened to touch, re-accreting the dialects docs/36 retired?

This contract picks completion, on evidence that the drift is already re-accreting (items 3-4
above are all post-grammar landings).

## Rules

1. **Server truth is the only doc source.** CLI.md and MCP.md generated tables render from
   registry v2 *intersected with the live server inventory* (the MCP tool tables actually
   advertised per profile; the CLI verbs that actually parse AND dispatch). The conformance
   harness gains a doc↔server dimension: any operation in the doc but not served (or served
   but not documented) fails the suite. Hand tables are deleted in the same commit.
2. **No dead paths.** Every parsed CLI verb either dispatches or is refused at parse time with
   a corrective naming the live spelling. `run resume` is wired (it has a live command,
   `run.resume_work`) — the `lifecycleActions` omission is a bug, not a design. The seven
   whitelist-blocked verbs are wired to their live commands (`run.episode`, `run.workstreams`,
   `run.workstream.notify`, `run.workstream.stop` are all `web:true`; `run.debug` and
   `application.context_eval` get explicit web entries or stay host-only with a parse-time
   refusal that says so). `baton_runs` is advertised on the MCP application surface or deleted
   from dispatch — no shadow operations.
3. **Every operation enters through the registry — including the ones already shipped.**
   `waves.start` and `waves.attach` register as canonical operations with derived names on the
   enabled profiles: deployment facade gains `waves.attach` (parity with `BatonClient.waves`),
   CLI gains `wave start`/`wave attach` verbs, MCP application surface gains the pair
   (stateful, reconcilable), web admits them on the bus. `run.debug` registers as a canonical
   read operation: facade accessor, CLI dispatch, doc rows. The 93B side-channel args
   (`mintWaveDetached`, `waveId`) stay unadvertised on web/MCP schemas *by registry flag*,
   with the flag itself pinned by conformance (hidden-by-declaration, never hidden-by-hand).
4. **The bidirectional layer enters the canonical operation set (issue #48 fold).** One
   canonical operation per existing kernel capability, derived per profile — never new
   machinery: `run.scratchpad` read on the embedded facade (closing the CLI.md:26-28
   documented-but-missing gap; the view projection already exists at
   `application.mjs:5269-5271`), scratchpad elevate/settle on the orchestrator (kernel)
   profile, board read+write operations on the profiles where the authority already exists
   (MCP combined keeps its lease/fence enforcement; facade gains board ops through the same
   coordinator wrappers), `decision_list` as a canonical operation, REPL manifest/binding and
   knowledge promote/recall on the orchestrator profile. Each lands as registry entries +
   surface derivations, NOT bespoke per-surface plumbing — that is the difference between this
   and the accretion it retires.
5. **Idempotency and authority parity per surface.** Board/package/REPL mutations through the
   facade carry the same lease + fence CAS enforcement the MCP layer performs
   (`mcp-northbound.mjs:1338-1361`); the enforcement moves INTO the application/coordinator
   command path so every surface inherits it, and the MCP layer's bespoke guards retire to
   thin adapters. Exactly-once admission (coordination ledgers) applies uniformly.
6. **M5 stays honest.** The alias-sunset rung is out of THIS contract's scope except that
   every name introduced above must be canonical-day-one (zero new aliases, zero new ledger
   entries). M5 proper (banned-token lint red, legacy grep-clean, `run.steer` deletion,
   GLOSSARY) is the follow-on contract.

## Rungs

- **CS-1 — Server-truth conformance + dead-path resolution** (rules 1-2). Doc↔server
  conformance dimension red-first; CLI.md/MCP.md regenerated from live inventory; hand tables
  deleted; `run resume` wired; seven blocked verbs wired-or-refused; `baton_runs`
  advertised-or-removed.
- **CS-2 — Grammar registration of the landed orphans** (rule 3). `waves.start`,
  `waves.attach`, `run.debug` as canonical operations with derived surfaces (facade parity,
  CLI verbs, MCP tools, web admission); side-channel args hidden-by-declaration.
- **CS-3 — Bidirectional surfacing** (rules 4-5). `run.scratchpad` facade read; scratchpad
  elevate/settle, board read/write, `decision_list`, REPL manifest/binding, knowledge
  promote/recall as canonical operations on their authority-correct profiles; enforcement
  folded into the command path; MCP bespoke guards retire to adapters.
- **CS-4 — Conformance hardening.** C1/C2 extended to every new operation; the divergence
  ledger gains the pre-CS-1 entries as retired rows; suite green at every rung.

## Red-first tests

- **CS-1 (impl/test/control-surface-truth-red.test.mjs):** (a) doc↔server — parse CLI.md's
  generated verb table, assert every row parses AND dispatches (mock server), assert every
  dispatchable verb is in the doc; same for MCP.md's tool table per profile against
  `McpFleetServer` instantiation. (b) `parseBatonCli('run resume …')` reaches
  `run.resume_work` dispatch. (c) each of the seven blocked verbs either dispatches or refuses
  at parse with a typed corrective naming the live spelling. (d) `baton_runs` advertised in
  the application-surface inventory (or absent from dispatch — pinned either way).
- **CS-2 (impl/test/grammar-orphans-red.test.mjs):** registry contains `waves.start`,
  `waves.attach`, `run.debug` with derived names per profile; `deployment.waves.attach`
  exists and binds (W93-4's mismatch refusal through the deployment facade);
  `baton wave start|attach` parse and dispatch; MCP application surface advertises both with
  `mcpStateful:true`; web bus admits both; `mintWaveDetached`/`waveId` rejected by MCP
  argument validation and omitted from advertised schemas while accepted by the in-process
  validator (hidden-by-declaration pin); facade `run.debug()` accessor + `baton run debug`
  dispatch.
- **CS-3 (impl/test/bidirectional-surface-red.test.mjs):** facade `run.scratchpad({workerId})`
  returns the projected scratchpad (the CLI.md:26-28 contract); facade board post/read round
  trip with the same lease+fence refusal taxonomy as MCP (`stale_fence`, writer-lease
  required); `decision_list` via the canonical operation on facade and MCP with identical
  payloads; REPL manifest admit + binding via the facade (kernel-profile authority);
  knowledge promote via the facade (orchestrator gate); MCP bespoke guard deletion pinned by
  source-scan (the enforcement lives once, in the command path).
- **CS-4:** conformance harness rows for every operation added in CS-2/CS-3 (C1 name
  resolution + C2 outcome identity across enabled surfaces); ledger diff shows only
  retirements.

Deterministic: MockAdapter fixtures, in-process surfaces, no live providers.

## Verification

```text
node --test impl/test/control-surface-truth-red.test.mjs impl/test/grammar-orphans-red.test.mjs impl/test/bidirectional-surface-red.test.mjs
node impl/scripts/surface-conformance.mjs
node impl/scripts/run-suite.mjs
```

## Explicit non-goals (v1)

- M5 alias sunset (rule 6).
- New bidirectional *machinery* (no new board/REPL/knowledge features — surfacing only;
  feature work is the REFLEX/REPL/KG epics, #17-#27).
- Web operator-console changes, MCP profile restructuring, the `combined`-profile split.
- `run.steer` retirement (M3/M5 scope per docs/36).
