# 35 — One grammar: the unified agent control surface

**Status: v1 draft, pre-red-team** (issue #43; per methodology this document goes through an
adversarial red-team wave before any implementation contract is cut from it).
**Seed:** operator directive, 2026-07-23 — *"baton has enormous friction and cumbersome
interaction methods for agents in all operations and control schemes"* — extended into an explicit
mandate to design the unified ontology, a functional-descriptive naming grammar in a Jane-Street
house style, and the engineering framework that makes every surface a projection of one source.
**Mechanical evidence:** `node impl/scripts/surface-audit.mjs` regenerates Appendix A from source;
every count below is from that extraction at this commit, not from memory.

---

## 1. The audit

### 1.1 What an agent must learn today

Baton has one authority path and (at least) six surface dialects over it:

| # | Surface | Names | Source of truth |
|---|---|---|---|
| D1 | Semantic registry operations | 10 | `APPLICATION_SEMANTIC_REGISTRY.operations` |
| D2 | Semantic registry actions (`run.act` targets) | 27 | `APPLICATION_SEMANTIC_REGISTRY.actions` |
| D3 | Application command definitions (older table) | 26 | `APPLICATION_COMMAND_DEFINITIONS` |
| D4 | Web bus commands (D3 with `web` flag, dots→underscores) | 25 | `WEB_APPLICATION_ENTRIES` |
| D5 | CLI verb rows | 37 | `registry.cli.commands` + `parseBatonCli` |
| D6a | MCP `fleet_*` dialect (kernel + run tools) | 38 | `mcp-northbound.mjs` |
| D6b | MCP `baton_*` dialect (ordinary + reflex tools) | 21 | `mcp-northbound.mjs` |
| D7 | Embedded client methods | 120 | `application-client.mjs` classes |

**284 distinct operation names.** On top of that, **16 run-phase strings** circulate
(`approved, awaiting_plan_approval, cancelled, closed, completed, denied, failed, interrupted,
interruption_uncertain, paused, reviewing, running, start_failed, stopped, stopping,
work_completed`), and the delegated-seat concept answers to **four live names** — application-layer
density: `worker` ×427, `member` ×219, `workstream` ×121, `assignee` ×26 (`seat` survives in docs).

None of this is one bug; it is accretion. D3 predates the semantic registry; D1/D2 were added for
the AX program; D6a predates D6b; the waves/workflow facades grew their own lifecycle words. Each
layer is internally principled. The composition is the friction.

### 1.2 Friction ledger (receipts)

- **F1 — Synonym storm for one concept.** worker / member / workstream(+role,generation) / seat /
  assignee all name the delegated seat. An agent reading a view meets `workstreams`; steering uses
  `--to RECIPIENT`; stopping uses `stop-member ROLE`; kernel receipts say `worker`.
- **F2 — Read-model triplication.** `run.inspect` (depth cascade), `run.status` (+`--wait/--follow`),
  `run.episode` (chapter reads) are three read models over one Run, with `run show` as the CLI
  spelling of the first. Embedded adds `outline()`, `changes()`, `follow()`, `progress()`,
  `events()`, `output()`.
- **F3 — Two execution models.** Dedicated verbs (`run.approve`, `run.adopt`, …) coexist with the
  action executor (`run.act {actionId}` / CLI `run do`). Live receipt (this session, w-Claude):
  the outline advertised `nextActions[].kind = approve_plan` + `planDigest`, but `run do RUN_ID
  approve_plan --inputs {...}` refused `application_action_scope_mismatch` — the advertised thing
  and the executable thing differ at the default depth. Recovery required knowing that a parallel
  verb `run approve --plan` existed.
- **F4 — Two MCP dialects, inconsistent even with themselves.** `fleet_run_*` (17 run tools +
  kernel tools) vs `baton_*` (10 ordinary + 11 reflex). Path collapsing disagrees:
  `fleet_run_workstream_notify` keeps the `run_` segment, `baton_workstream_notify` drops it;
  `runs.list` renders as `baton_runs`. The two dialects even disagree on read model: fleet uses
  `status`+`wait`, baton uses `inspect`+`act`.
- **F5 — Sixteen phase strings for one lifecycle.** Runs park at `awaiting_plan_approval`; waves
  report `work_completed | start_failed | stopped`; the CLI's terminal set adds `closed`; issue-31
  work just added `paused`. `completed` and `work_completed` are both terminal-success. An agent
  polling any surface must pattern-match a union nobody documents.
- **F6 — Cost-per-question.** Before the issue-35 fix, "why is my Run cancelled" cost four
  progressive-disclosure round-trips (outline→index→section→item) and the answer lived at none of
  them. The cascade prices ordinary questions in round-trips; for an agent, in tokens and turns.
- **F7 — Idempotency has four disciplines.** CLI auto-generates a key; embedded handles it
  internally; MCP requires `idempotencyKey === mcp.call:<requestId>`; the Web bus wants an explicit
  envelope key. Same guarantee, four incantations.
- **F8 — Start-verb fan-out.** `run` / `run start` / `explore` / `review` / `workflow(objective,
  {team})` / `waves.start` — six entries with overlapping semantics and *different* lifecycle
  behavior (runs park for approval; waves auto-approve; workflow roles differ again). Presets are
  good; presets with divergent lifecycles are a trap.
- **F9 — Error opacity family** (issue #41; first slice landed): bare codes with no stage/subject,
  the generic `temporarily_unavailable` fallback, `not_found` collapsing.
- **F10 — Intent invisibility** (issue #38): `run` compiles change-intent silently; evidence-shaped
  objectives die at the trust gate instead of being advised at start.
- **F11 — JSON walls.** Routine mutations return full views tuned for neither human nor agent; no
  compact single-line projection; field ordering is stable in practice but pinned nowhere.
- **F12 — Two registries.** D1/D2 (semantic, schema'd, help-topic'd) and D3 (older, `web`-flagged)
  both route commands. The CLI posts D3 names; MCP baton-dialect wraps D1/D2; nothing forces them
  to agree.
- **F13 — Discovery split-brain** (issues #34/#36/#37; fixed): serve/setup/doctor/bridge each had
  their own view of "connected". Symptomatic of surface accretion, kept here as a class receipt.
- **F14 — Reason/argument conventions drift.** `--reason` required on some destructive verbs, not
  others; `--to RECIPIENT` vs positional `ROLE` vs `--workstream ROLE --generation N` for the same
  addressing.

### 1.3 What is already right (and must not be lost)

- **One authority path.** Every surface ends in the same application/coordinator authority with
  the same fencing, durability, and capability checks. This is why unification is cheap-ish: it is
  a *naming and projection* problem, not a semantics rebuild.
- **The semantic registry exists** (D1/D2) with input schemas, idempotent/destructive flags,
  capability requirements, help topics, and a content digest. It is the seed of the generator this
  spec builds.
- **Capability-filtered projections** (views already omit actions outside the principal's
  capabilities), sanitization discipline, typed refusals, durable admission — all keep working
  unchanged underneath.
- **Progressive disclosure is the right idea**; it needs a completeness law (L10), not removal.

---

## 2. Goals and non-goals

**Goals.** One ontology; one closed verb grammar; mechanical name derivation per surface; one
lifecycle vocabulary; advertised-is-executable; errors that name stage/subject/remedy; constrain by
construction (#32); steer don't gate (#31); the registry as the single generator.

**Non-goals.** No new authority semantics (fencing, durability, verification, capability model are
untouched); no removal of progressive disclosure; no browser-desk redesign (it re-skins the same
registry); no external-compatibility burden (baton is self-contained — the blast radius of renames
is its own tests, drivers, and docs, which is exactly why the alias window can be short).

---

## 3. The ontology

A closed noun tree. Nouns are **singular**; collections are `list` reads, never plural nouns.

```
deployment                       readiness, routes, workspace, resident lifecycle
run                              the unit of delegated objective work
  ├─ plan                        the approval gate (value object; verbs live on run)
  ├─ member(role, generation?)   the delegated seat            ← worker/workstream/seat/assignee
  ├─ attention(id)               anything awaiting the caller  ← question/approval/decision/checkpoint
  ├─ evidence / result / review / export     trust-chain reads and gates
  └─ context                     cells, calls, expression algebra (already clean; unchanged)
board(name)                      shared task lists (run/workflow scoped)
package(digest)                  typed knowledge/context hand-offs
knowledge                        horizons (task/workflow/project reads)
route / profile / intent         value objects — never carry verbs
```

**The member unification (naming decision).** Surface name: **`member`**, addressed by `role`
(+ optional `generation`, defaulting to current). Rationale: `worker` stays correct as the *kernel*
term (a process with a worktree — kernel receipts keep it); `workstream` describes the durable
semantic lane, but agents address the seat, not the lane, and `member` is what the waves surface
already taught drivers (`stopMember`). One term at every surface; `workstream`/`seat` retired from
surface names; `worker` confined below the application boundary.

**The attention unification.** Questions, approvals, decisions (REFLEX-1), and checkpoints (#31)
are one surfaced kind: `attention` items with `kind`, `prompt`, `options?`, and a bound `do`. One
verb answers all of them (`run.answer`); the checkpoint's `continue|settle` is just its option set.

---

## 4. The grammar

### 4.1 Verb set (closed)

| Class | Verbs | Semantics |
|---|---|---|
| read | `view`, `watch`, `list`, `help` | `view` = one bounded view at a depth; `watch` = the only streaming read (channel-parameterized); `list` = bounded collections; `help` = self-description |
| lifecycle | `start`, `approve`, `stop`, `recover`, `resume`, `retry` | exactly today's authority semantics |
| interaction | `answer`, `send`, `interrupt` | `answer` settles attention; `send`/`interrupt` are member-directed (run-level forms resolve the current recipient exactly as today) |
| trust | `review`, `adopt`, `select`, `feedback`, `revise`, `integrate`, `export` | the evidence→integration chain, unchanged semantics |
| object | board: `post`, `claim`, `report`, `retitle`, `reorder`, `close`, `read`; package: `admit`, `attach`, `read`; context: `eval` | the reflex/REPL family, names already verb-clean |
| meta | `do` | executes an advertised action verbatim; every non-read verb is definitionally sugar for `do` |

Banned as surface verbs (synonyms of the above): `show`, `status`, `inspect`, `act`, `notify`,
`steer`†, `follow`, `wait`, `progress`, `events`, `output`, `episode`‡, `stop-member`.
† `steer` survives one migration window as a deprecated alias of `member.send --now`.
‡ episode chapters become sections of `run.view` (`--section episode.output` etc.); the chapter
taxonomy is unchanged, only its entry point folds in.

### 4.2 House rules (the Jane-Street-alike style, adapted)

- **H1 — Shape.** Every operation is `noun[.subnoun].verb`, verb last, one verb, imperative.
  Registry key `run.member.stop`; CLI `baton run member stop`; MCP `baton_run_member_stop`; web
  `run_member_stop`; embedded `run.member(role).stop()`. Derivation is mechanical (§6.1) — the
  `baton_workstream_notify` vs `fleet_run_workstream_notify` class of drift becomes impossible.
- **H2 — One name per concept.** No synonyms, ever. A concept renamed is renamed everywhere in the
  same phase, with aliases only inside the migration window and marked deprecated in help/tool
  annotations.
- **H3 — Reads are nouns or the four read verbs.** No `get_`/`fetch_`/`show_`. `run.evidence` is a
  noun-read; state queries are `view` at a depth.
- **H4 — Ids positional, options labeled.** CLI: required ids are positional (`RUN_ID`, `ROLE`);
  everything else is a labeled flag whose name equals the JSON schema property exactly. One
  addressing convention: `member` ops take `ROLE [--generation N]` — `--to`, `--workstream` retire.
- **H5 — Destructive verbs take `--reason`, uniformly** (schema-enforced: `stop`, `member.stop`,
  `interrupt`, `revise`, `integrate`, `adopt` — exactly the registry's `destructive`/gate class).
- **H6 — No abbreviations, no vendor words, no plural nouns** in operation names.
- **H7 — Depth ≤ noun.subnoun.verb.** If a name needs a third noun segment, the ontology is wrong,
  not the name.
- **H8 — Every operation ships an example invocation** in its schema description; MCP renders it in
  the tool listing, CLI in help, docs are generated from the same strings.
- **H9 — Enum values are lower_snake, closed, and registry-owned** (phases, attention kinds,
  channels, effect classes). No surface mints a string the registry does not define.
- **H10 — Canonical field order.** View fields serialize in registry-pinned order; parsers may rely
  on it; the order is part of the conformance contract, not an accident.

---

## 5. The laws

Executable invariants — each becomes a conformance contract in M-phases:

- **L1 — One grammar.** Every registry operation is reachable on every enabled surface under its
  mechanically derived name, and no surface exposes a name the registry cannot derive.
- **L2 — Advertised is executable.** Any action a view advertises carries a `do` block
  (`{action, inputs}`) that executes verbatim via `run.do` on every surface — same authority, same
  outcome, byte-identical resulting view modulo cursor fields. (Kills F3.)
- **L3 — Terminal implies cause.** No terminal view without a typed cause (landed for
  `dispatch_refused`; the law generalizes it: every terminal phase, every surface).
- **L4 — One vocabulary.** Exactly one run-phase enum and one member-state enum (§7) across runs,
  waves, workflows, CLI, MCP, web, embedded. A legacy string appearing anywhere is a red test.
- **L5 — Same authority, same result.** Presets (`explore`, `review`, waves) are pure sugar:
  expansion to core operations is registry-recorded, and their runs speak the same lifecycle.
  (Kills F8's divergence — auto-approval becomes an *explicit recorded* `approve` by the preset.)
- **L6 — One name per concept** (H2 as a law, lintable: banned-synonym list in the suite).
- **L7 — Errors name stage, subject, remedy.** `{code, stage: discovery|transport|auth|admission|
  dispatch|provider|verification|policy, subject, remedy: {summary, do?}}` — sanitized exactly as
  today (no paths, no coordinates), machine-actionable where a remedy exists (#41 generalized).
- **L8 — Constrain by construction.** A principal's surface inventory *is* the capability
  projection of the registry (#32): tools absent, not forbidden. The ordinary/advanced MCP split
  becomes a profile, not two hand-lists.
- **L9 — Steer, don't gate.** Checkpoints surface as attention with `continue|settle` options
  (#31's landed semantics, spelled in the one grammar).
- **L10 — Outline is complete in kind.** Every question of the form *what happened / why / what
  now* is answerable from `view --depth outline` in one call: phase, typed cause, attention items
  with `do`, next actions with `do`, route, compact progress. Deeper depths add *bytes* (content,
  evidence), never new *kinds* of truth. (Kills F6 permanently.)

---

## 6. The canonical operation set

Forty-one operations replace 284 names. Verb-level entries are sugar for `do` (L2) but are real,
named, schema'd operations — agents should not be forced through a meta-verb for ordinary work.

| Canonical | Replaces (today) |
|---|---|
| `deployment.view` | `doctor`, `doctor --check`, `routes()`, `route()`, `baton route` |
| `deployment.serve` | `baton serve` (host-only, unchanged) |
| `run.list` | `runs.list`, `baton_runs`, `runs.list` web row |
| `run.start` | `run.start`, `baton run`, `run start`, `explore`*, `review`*, `workflow()`*, `waves.start`* (*presets — retained as sugar, L5) |
| `run.view` | `run.inspect`, `run.status`, `run show`, `run.episode` + chapters, embedded `outline/index/…` |
| `run.watch` | `run.follow`, `run.wait`, `run progress/events/output --follow`, embedded `changes/progress/events/output` (channel: `progress\|events\|output\|changes`) |
| `run.do` | `run.act`, `baton run do` |
| `run.approve` | `run.approve` (+ waves auto-approve, now recorded) |
| `run.answer` | `run.answer` (+ `--allow/--deny/--cancel/--text/--option` unified payload), `baton_decision_answer` |
| `run.send` / `run.interrupt` | run-level send/interrupt (recipient-resolving, as today) |
| `run.stop` | `run.stop`, `fleet_run_stop`, `baton_run_stop` |
| `run.evidence` / `run.result` | `run.evidence`, `run result` |
| `run.review` / `run.adopt` / `run.select` / `run.feedback` / `run.revise` / `run.integrate` / `run.export` | same verbs, one spelling each |
| `run.recover` / `run.resume` / `run.retry` | same |
| `run.member.view` | `run.workstreams`, `run workstreams ROLE`, episode-by-workstream reads |
| `run.member.send` | `run.workstream.notify`, `run notify`, `run.steer` (deprecated alias), `--to` addressing |
| `run.member.interrupt` | member-targeted interrupt |
| `run.member.stop` | `run.workstream.stop`, `run stop-member`, `stopMember` |
| `board.post/claim/report/retitle/reorder/close/read` | `baton_board_*` (names already clean; they gain CLI/embedded/web projections per L1) |
| `package.admit/attach/read` | `baton_package_*` (same) |
| `context.eval` | `application.context_eval`, `baton context eval`, `baton_context_eval` |
| `run.attention.list` | folded into `run.view` outline (L10); exists as a filtered read for polling |
| `application.help` | `help` (unchanged; topics regenerate from the registry) |

Kernel tools (`fleet_spawn/kill/respond/…`) stay an explicitly advanced, separately-profiled
surface (L8 profile: `kernel`), outside the ordinary grammar, unchanged.

### 6.1 Derivation rules (mechanical)

For registry key `a.b.verb` with CLI ids `A B`:
embedded `client.a(A?).b(B?).verb(opts)` (nouns with identity become parameterized accessors);
CLI `baton a b verb A? B? [--flags]`; MCP `baton_a_b_verb`; web `a_b_verb`. One function computes
all four; the conformance suite asserts the computation, so a hand-added divergent name cannot
compile green.

---

## 7. One lifecycle

### 7.1 Run phases (the only enum)

```
planning → awaiting_approval → working ⇄ paused ⇄ interrupted → verifying → reviewing
        ↘ denied                        ↘ uncertain                     ↘ integrating
terminal: completed | failed | cancelled | stopped   (transitional: stopping)
```

Mapping (mechanical, exhaustive — a view emitting a left-column string after M2 is a red test):
`awaiting_plan_approval→awaiting_approval`, `approved→working` (approval is an event, not a
phase), `running→working`, `interruption_uncertain→uncertain`, `work_completed→completed`,
`start_failed→failed` (cause `start`), `planning_failed→failed` (cause `planning`),
`closed→stopped`, `denied` terminal with cause. Every terminal carries `cause` (L3). `paused`
(issue-31) is first-class non-terminal.

### 7.2 Member states

`pending | working | paused | blocked | stopping | stopped | completed | failed` — one enum for
waves members, workflow roles, and workstream generations; kernel worker states map below the
application boundary and never surface raw.

### 7.3 Attention kinds

`question | approval | decision | checkpoint | preservation | capacity` — all answered via
`run.answer {attention, response}` where response is exactly one of
`{text} | {option} | allow | deny | cancel`.

---

## 8. The framework

### 8.1 Registry v2 — the single generator

Extend `APPLICATION_SEMANTIC_REGISTRY` (which already owns schemas, capability requirements,
idempotent/destructive flags, help topics, CLI usage, and a content digest) to own:

```
registry = {
  nouns, verbs,                          // §3, §4.1 — closed sets with classes
  operations: {                          // one entry per §6 canonical op
    'run.member.stop': {
      verb: 'stop', noun: ['run','member'], effect: 'member_cleanup',
      capabilities: [...], idempotent: false, destructive: true,
      input: schema, output: 'run.view',          // every mutation returns the outline view
      surfaces: { cli: {...derived, overrides?}, mcp: {}, web: {}, embedded: {} },
      aliases: ['run.workstream.stop', 'stop-member'],     // M-window only, help-marked
      example: 'baton run member stop run-1a2b reviewer --reason "…"',
      help: topicRef,
    }, …
  },
  phases, memberStates, attentionKinds, channels,   // §7 enums + legacy mappings
  errors: { codes, stages, remedies },              // L7 taxonomy
  digest,
}
```

Renderers consume it: `parseBatonCli` table, MCP tool tables (both profiles), web entries, the
embedded facade method map, and the help/docs text — replacing today's five hand-maintained
parallels (D3/D4/D5/D6a+b/D7). `impl/CLI.md` §usage and `impl/MCP.md` inventories become generated
blocks (the #36 drift class ends structurally).

### 8.2 Envelope

Every mutation returns the outline view; every read returns the requested depth; every error is L7.
`{ok: true, view}` / `{ok: false, error: {code, stage, subject, remedy}}` uniformly; idempotency
handled inside each client (one discipline, F7 ends); cursors opaque and resumable (unchanged);
canonical field order (H10).

### 8.3 Capability projection (#32)

`surfaceInventory(principal) = render(filter(registry, principal.capabilities ∪ profile))`.
Ordinary MCP = the default profile; kernel/advanced = an explicit profile; a wave member's
registered tool set (#32) is the same computation with the member's capability profile — one
mechanism from operator surface to worker containment.

### 8.4 Conformance harness

`impl/scripts/surface-audit.mjs` (landed with this doc) extracts current truth. M0 turns it into
contracts: derivation identity per op (L1), advertised-executable round-trip property (L2),
enum-escape scan (L4), synonym lint (L6), envelope/error shape checks (L7), field-order pin (H10)
— plus an **allowed-divergence ledger** that starts as the full audit and must shrink to empty by
M5 (no silent regressions, no permanent exceptions).

---

## 9. Migration

Each phase: spec slice → adversarial red-team → red contracts → wave implementation (baton building
baton) → ledger shrinks. No big-bang rename; the suite stays green at every commit.

- **M0 — Harness.** Conformance contracts + allowed-divergence ledger seeded from Appendix A.
  No behavior change.
- **M1 — Registry v2 + canonical names as aliases.** Every §6 name resolves everywhere (D1/D2/D3
  merge behind one table); legacy names keep working; tool annotations/help mark them deprecated.
  L2 lands (`do` blocks in advertised actions, executable verbatim).
- **M2 — One vocabulary.** Phase/member/attention enums unified with the §7 mapping; waves/workflow
  facades re-report; L3 generalized; L10 outline-completeness contract.
- **M3 — Member unification + watch/view consolidation.** `run.member.*` canonical;
  `workstream`/`notify`/`steer`/`stop-member` become mapped aliases; `view`/`watch` land; episode
  folds to sections.
- **M4 — Generated surfaces.** CLI table, both MCP profiles, web entries, embedded facade, CLI.md/
  MCP.md inventories all render from registry v2; hand tables deleted; L8 profile projection.
- **M5 — Alias sunset.** Ledger to empty; banned-synonym lint promoted from warning to red; the
  16-string phase union is grep-clean; GLOSSARY.md updated (`member` entry; `worker` marked
  kernel-internal).

Rollback story per phase: aliases are additive until M5, so each phase is independently
shippable and revertible; M5 is the only compatibility-breaking commit and it breaks only
already-deprecated spellings inside this repository.

---

## 10. Acceptance contracts (cut at M0, red until their phase lands)

- C1 (L1): for every registry op × enabled surface, the derived name resolves and executes.
- C2 (L2): property test — for N randomized run states, every advertised `do` executes verbatim on
  all four surfaces with identical resulting outline.
- C3 (L4): no surface serializes a phase/member/attention string outside the §7 enums.
- C4 (L6): banned-synonym lint over surface-name space (`workstream|seat|show|status|inspect|act|
  notify|steer|stop-member` as operation tokens).
- C5 (L10): for each terminal and each attention-bearing state, outline alone answers
  what/why/next (cause non-null, `do` present, no deeper read required).
- C6 (L7): error-shape law over every refusal path the suite can provoke; leak test that stage/
  subject never carry paths, tokens, or fence coordinates.
- C7 (L5): preset-expansion identity — `explore`/`review`/waves record their expansion and their
  runs emit only §7 vocabulary.
- C8 (H10): canonical field-order pin over view serializations.

---

## 11. Honest edges

- **Rename cost is real**: ~2,700 tests and the driver docs reference legacy spellings; the alias
  window plus ledger makes the cost incremental, but M3/M4 are wide diffs and belong to waves, not
  a solo pass.
- **`run.view` folding episode chapters** must not regress the chapter taxonomy's evidence
  guarantees — the red-team should attack this fold hardest.
- **Two registries merging (D1/D3)** touches the Web bus's command admission; the merge must keep
  the byte-level envelope compatibility until M4 flips renderers.
- **Kernel surface stays un-unified by design** — advanced/emergency control keeps its own names
  and profile; pretending otherwise would violate the ordinary/advanced boundary this repo already
  enforces.
- This document is **v1 pre-red-team**; per methodology it is not implementable authority until
  the adversarial wave has run and findings are folded (the docs 32/33/34 lifecycle).

---

## Appendix A — mechanical inventory

Regenerate with `node impl/scripts/surface-audit.mjs`. Snapshot at this commit: 10 registry
operations; 27 actions; 26 command definitions (25 web-exposed); 37 CLI verb rows; 38 `fleet_*` +
21 `baton_*` MCP tools; 120 embedded client methods; 16 run-phase strings; seat-concept synonym
density worker×427 / member×219 / workstream×121 / assignee×26 / seat×1 across the application
layer. The generator's full output is the audit's table of record and deliberately lives in the
tool, not in this file, so it can never go stale.
