# Red-team report — docs/35 unified control grammar (seat: opus)

**Target:** `docs/35-unified-control-grammar.md` (v1 pre-red-team, 429 lines, read in full).
**Method:** every finding is grounded in `impl/` at this commit. Line references are from the
worktree `.baton/wt/ws-3ebb1dd9131c901b629c716ce6dbb48a`. Goals and intent are not under attack;
mechanics are. `node --test impl/test/surface-audit-smoke.test.mjs` passes at this commit (3/3).

**Scope note on grounding:** `impl/src/application.mjs` is not valid UTF-8 to `grep(1)` (`file`
reports `data`); all greps below used `grep -a`. That is worth knowing for anyone building the M0
conformance harness, which will grep this file.

---

## R-OP-1 — P0 — §5 L2 / §10 C2: a `do` block is not portable, and cannot be made portable without changing authority semantics

**Attacked:** §5 L2 ("Any action a view advertises carries a `do` block (`{action, inputs}`) that
executes verbatim via `run.do` on every surface — same authority, same outcome, byte-identical
resulting view modulo cursor fields"), §10 C2, §4.1 meta row.

**Grounding.** The advertised `actionId` is a digest over the *live view* and the *calling
principal*:

- `impl/src/application.mjs:7310-7323` — `_semanticActionId` = `digest({schemaVersion,
  registryDigest, repoId, runId, principalScopeDigest: digest({principalId, sessionId}),
  profileDigest, planDigest, viewDigest: semanticViewDigest(view), kind, target})`.
- `impl/src/application.mjs:8908` — that id is what every advertised action carries.
- `impl/src/application.mjs:8927-8932` — each action additionally ships `freshness
  {registryDigest, viewDigest, profileDigest, planDigest}`.
- `impl/src/application.mjs:10416-10434` — `run.act` resolves the id against freshly recomputed
  actions and throws `application_action_scope_mismatch` when it does not match;
  `:10451` re-checks (`_recheckSemanticAction`) after authorization.
- `impl/src/mcp-web-bridge.mjs:76-83` — the MCP-over-Web surface derives its principal
  (`principalId`, `sessionId`) from the *remote authenticated session*, not from the caller.

**Failure.** Two independent ways C2 is unsatisfiable as written.

1. *Single-use.* Executing the advertised `do` on surface #1 changes the run, therefore changes
   `viewDigest`, therefore invalidates the same `actionId` for surfaces #2–#4. C2 asks for "every
   advertised `do` executes verbatim on all four surfaces with identical resulting outline" — the
   second execution refuses with `application_action_scope_mismatch`, and if it did not, the
   resulting outlines would necessarily differ (two sends are not one send).
2. *Principal-bound.* `principalScopeDigest` folds `{principalId, sessionId}` into the id. The
   four surfaces do not share a session — the Web-MCP bridge is explicitly remote-authenticated
   and forbids identity override (`impl/src/mcp-web-bridge.mjs:252-256`). A byte-identical
   `actionId` produced for the CLI principal *cannot* validate for the MCP principal.

Making L2 literally true requires removing `viewDigest` and `principalScopeDigest` from the id —
i.e. removing the freshness and principal-scoping guarantees. §2 forbids that ("no new authority
semantics ... capability model are untouched" — this would be a *removal* of one).

**Minimal repair to docs/35.** Restate L2 as *kind-portable, id-local*:

> **L2 — Advertised is executable.** Every action a view advertises carries a `do` block
> `{action: {kind, actionId}, inputs}`. `inputs` and `kind` are portable and byte-identical across
> surfaces; `actionId` is a **freshness token** bound to the view digest and the calling principal
> (`application.mjs:7310`) and MUST be re-derived by each surface from a fresh view of that run.
> A surface that re-derives the id for the same `kind` + `inputs` reaches the same authority and
> the same post-state phase and cause.

and rewrite C2 to match: *"for N randomized run states, for every advertised action kind K, each
surface can re-derive an executable id for K and executing it yields the same resulting phase,
cause, and attention set (excluding cursor and freshness fields)."* Add one sentence to §11 honest
edges: "`actionId` is never a durable literal; drivers that cache it will get
`application_action_scope_mismatch`."

---

## R-OP-2 — P0 — §6 / §1.1: the canonical 41 lose `application.shutdown` and the entire goal/plan command family, and D4's count hides ~14 web commands

**Attacked:** §6 canonical operation set, §3 ontology ("`plan` — the approval gate (value object;
verbs live on run)"), §1.1 D4 row, §5 L1, Appendix A.

**Grounding.**

- `impl/src/application.mjs:152` — `'application.shutdown'` is the 26th
  `APPLICATION_COMMAND_DEFINITIONS` entry (`capabilities: ['emergency_stop']`, `web:false`,
  `mcp:false`). It is guarded a second time at `impl/src/mcp-web-bridge.mjs:199`. §6 has no row
  for it, and §6 claims to "replace 284 names" — a driver following §6 loses the only way to shut
  a resident down.
- `impl/src/web-northbound.mjs:20` — `goal_define: 'goal:define'`, `plan_propose: 'plan:propose'`,
  `plan_approve: 'plan:approve'`, `goal_plan_status: 'goal:observe'`; `:24` puts the three
  mutations in `RECONCILABLE`; `:26` `GOAL_PLAN_MUTATIONS`; `:52-55` their arg sets. These are
  durable, capability-gated, reconcilable Web-bus commands with their own capability namespace
  (colon-separated, unlike every application capability). §3 declares `plan` a value object that
  never carries verbs — but `plan_propose` and `plan_approve` are verbs on `plan` today, on the
  same bus and the same admission path as `run.*`.
- `impl/src/web-northbound.mjs:17-31` — `COMMAND_CAPABILITY` / `RECONCILABLE` /
  `READ_ONLY_COMMANDS` mix ~19 kernel and goal-plan literals with the `WEB_APPLICATION_ENTRIES`
  spread. §1.1's D4 row ("Web bus commands ... 25 | `WEB_APPLICATION_ENTRIES`") counts only the
  spread half. The Web bus actually admits `spawn`, `scratch_oracle`, `send`, `interrupt`, `kill`,
  `drain`, `respond`, `list`, `result`, `wait`, `capabilities`, `provider_status`,
  `capability_invoke`, `reuse_decide`, `reuse_recheck`, `goal_define`, `plan_propose`,
  `plan_approve`, `goal_plan_status` **in addition** to the 25.

**Failure.** L1 says "no surface exposes a name the registry cannot derive". The Web bus exposes
~19 such names today, and the audit that seeds the M0 allowed-divergence ledger (§8.4) does not
see them, because Appendix A's D4 dimension is derived from `WEB_APPLICATION_ENTRIES` alone. The
ledger therefore starts *incomplete*, and §8.4's "must shrink to empty by M5" is measuring the
wrong set. Separately, an implementer cutting M1 from §6 has no canonical name for shutdown or for
plan proposal/approval and will either mint one outside the grammar (violating H2/L6) or drop the
capability.

**Minimal repair to docs/35.** Three edits:

1. §6 table: add `| `deployment.shutdown` | `application.shutdown` |`.
2. §6 table: add a `run.plan.propose` / `run.plan.approve` / `run.plan.view` block mapping
   `goal_define`/`plan_propose`/`plan_approve`/`goal_plan_status`, **or** add an explicit exclusion
   paragraph next to the kernel one: "the goal/plan authoring commands
   (`goal_define`/`plan_propose`/`plan_approve`/`goal_plan_status`, `web-northbound.mjs:20`) stay
   a separately-profiled surface (L8 profile: `authoring`), outside the ordinary grammar." Silence
   is the one option that breaks M1.
3. §1.1 D4 and Appendix A: D4 must count **every** command the Web bus admits, not the
   application-derived subset, and `impl/scripts/surface-audit.mjs` must extract
   `COMMAND_CAPABILITY`'s full key set. Fix §3 so `plan` is not described as verb-free while three
   plan verbs ship.

---

## R-OP-3 — P0 — §4.1‡ / §6: the episode fold splits a three-axis addressed read across two operations, neither of which can express it

This is the fold §11 asked to be attacked hardest. It does not survive.

**Attacked:** §4.1 banned-verb note ‡ ("episode chapters become sections of `run.view`
(`--section episode.output` etc.); the chapter taxonomy is unchanged, only its entry point folds
in"), §6 rows `run.view` and `run.member.view`, §9 M3.

**Grounding.** An episode read is addressed by **topic × role × generation × detail**, with
enforced cross-role and cross-generation evidence isolation:

- `impl/src/application-semantics.mjs:142-150` — `run.episode` input schema:
  `{runId, topic, detail: 'item'|'content'|'evidence', role, generation, pageCursor, cursor, waitMs}`.
- `impl/src/application.mjs:113-116` — `EPISODE_TOPICS` = outline, output, sources, derivations,
  contradictions, trace, route, verification, result, cleanup, help.
- `impl/test/phase92-episode-attribution-red.test.mjs:103-104` — the `work` trace must not contain
  `artifact-reviewer` and the `reviewer` trace must not contain `artifact-work`. Per-role evidence
  isolation is a pinned contract.
- `.../phase92-episode-attribution-red.test.mjs:105-106` —
  `_episodeItem(current, view, 'result', 'work', ctx).value.value.resultSha === '1'×40` but
  `_episodeItem(current, view, 'result', **null**, ctx).value.value.resultSha === '2'×40`.
  `role: null` is a *distinct addressable value* (the run-level aggregate), not "unset".
- `.../phase92-episode-attribution-red.test.mjs:133-144` — generations 1 and 2 project distinct
  streams; the predecessor generation contains `artifact-reviewer-old` and must **not** contain
  the current `artifact-reviewer`; `currentResult.resultSha !== oldResult.resultSha`.
- `impl/test/phase92-episode-workstream-red.test.mjs:92` — `pending.continuation.operation` is
  pinned to the literal `'run.episode'`; `:101` pins item ids of the form
  `episode:${topic}:reviewer`; `:135-145` pin the CLI parse
  `run episode RUN_ID trace --workstream reviewer --generation 2 --evidence`
  → `{runId, topic, role, generation, detail}`; `:167-175` pin the browser-desk element ids
  (`episode-workstream`, `episode-topic`, `episode-detail`, `load-episode`, `continue-episode`)
  and bus operations (`run_episode`, `run_workstreams`, …).

Now the two §6 rows the fold targets:

- `run.view` ← `run.inspect`, whose schema is
  `{runId, depth, section, item, offset, pageCursor, recipient, cursor, waitMs}`
  (`impl/src/application-semantics.mjs:125-141`). **No `role`. No `generation`. No `detail`.**
- `run.member.view` ← `run.workstreams`, whose schema is
  `{runId, role, generation, cursor, waitMs}` (`impl/src/application-semantics.mjs:151-157`).
  **No `topic`. No `section`. No `detail`.**

**Failure.** `run.episode {runId, topic:'result', role:'reviewer', generation:2,
detail:'evidence'}` — one call today, and the exact call the attribution and generation-isolation
contracts exercise — becomes **unexpressible** after M3. `run.view --section episode.result` has no
role/generation selector, so it can only return the `role: null` aggregate (`resultSha` `'2'×40`
in the fixture), silently substituting the run aggregate for the per-member evidence. That is not
"the chapter taxonomy is unchanged"; it is the loss of the attribution axis the whole chapter
taxonomy exists to guarantee. §6 also routes "episode-by-workstream reads" to `run.member.view`,
which cannot name a topic — so the two halves of one address end up on two operations.

The one thing that *does* survive: `detail` maps cleanly, because
`impl/src/application-semantics.mjs:44-45` already defines
`depth: ['outline','index','section','item','content','evidence']` — a superset of
`detail: ['item','content','evidence']`. The fold of `detail`→`depth` is sound; the fold of
`role`/`generation` is not.

**Minimal repair to docs/35.** Replace note ‡ with:

> ‡ episode chapters become sections of `run.view` (`--section episode.output` etc.). The fold is
> only sound if `run.view` gains the episode's two addressing axes: `--role ROLE` (with the
> explicit value `--role none` for the run-level aggregate, which is a distinct projection —
> `phase92-episode-attribution-red.test.mjs:105-106`) and `--generation N`, and if `detail` maps
> onto the existing `depth` tail (`item|content|evidence`,
> `application-semantics.mjs:44-45`). Cross-role and cross-generation evidence isolation
> (`phase92-episode-attribution-red.test.mjs:103-104,133-144`) is a contract of the fold, not a
> property of the old entry point.

And add to §9 M3: "the `continuation.operation` string flips from `run.episode` to `run.view` in
the same commit as the section rename (`phase92-episode-workstream-red.test.mjs:92`), and the
browser-desk element ids and bus operations pinned at `:167-175` move with it."

---

## R-OP-4 — P0 — §4.1 meta row / §5 L2: "every non-read verb is sugar for `do`" inverts the constraint order

**Attacked:** §4.1 meta row ("`do` — executes an advertised action verbatim; every non-read verb is
definitionally sugar for `do`"), §5 L2, §6 preamble ("Verb-level entries are sugar for `do` (L2)
but are real, named, schema'd operations").

**Grounding.** `do` (= `run.act`) is *strictly more constrained* than the named verbs it is said
to be the base of:

- `impl/src/application.mjs:10416` — `run.act` must resolve a live, view-bound `actionId`
  (see R-OP-1); `:10436-10437` `_authorizeSemanticAuthority`; `:10451`
  `_recheckSemanticAction` after authorization.
- `impl/src/mcp-web-bridge.mjs:137-168` — over the MCP-over-Web surface, `run.act` additionally
  requires an out-of-band `context.semanticAuthority` envelope
  `{schemaVersion:1, actionId, kind, effect, requiredCapabilities, authorityDigest}` obtained from
  a *separate* `actionAuthority` round-trip (`:111-135`), cross-validated against
  `APPLICATION_SEMANTIC_REGISTRY.actions[kind]` on `effect` and on an **order-sensitive**
  `requiredCapabilities.join('\0')` (`:156`), plus `hasNorthboundCapabilityAuthority('mcp',
  context.capabilityAuthority)` (`:152`), plus an exact capability-set equality against the bound
  principal (`:158-164`), plus `idempotencyKey === 'mcp.call:' + requestId` (`:38-43`).
- By contrast `run.approve`, `run.stop`, `run.adopt`, `run.integrate`, `run.export`,
  `run.recover`, `run.retry_verification`, `run.resume_work` are plain
  `APPLICATION_COMMAND_DEFINITIONS` rows (`impl/src/application.mjs:138-151`) carrying **none** of
  that machinery.

**Failure.** Sugar cannot be more constrained than what it desugars to. If M1 lands "every verb is
sugar for `do`" literally, one of two things happens: (a) the named verbs inherit `do`'s freshness
+ semantic-authority admission, which is a *new* admission precondition on `run.stop` and
`run.approve` — forbidden by §2's "no new authority semantics"; or (b) `do` is relaxed to match the
verbs, which removes the freshness and authority-digest checks that
`mcp-web-bridge.mjs:137-168` exists to enforce. Both are unacceptable, so an implementer reading
§4.1 has no correct move.

Note also the exact `do`-block shape question §11 implies: to survive the digest checks over
MCP-over-Web, the do-block is **not** `{action, inputs}`. It is
`{name: 'run.act', args: {runId, actionId, inputs}}` **plus** a transport context
`{transport: 'mcp', requestId, idempotencyKey: 'mcp.call:<requestId>', capabilityAuthority,
capabilities, semanticAuthority: {schemaVersion:1, actionId, kind, effect, requiredCapabilities,
authorityDigest}}`. This does round-trip today, but only because
`impl/src/application-semantics.mjs:581-584` normalizes `requiredCapabilities` with `[...].sort()`
before freezing — `actionAuthority` sorts (`mcp-web-bridge.mjs:132`) while `authorizeReplay`
compares raw order (`:156`). That is a latent invariant docs/35 never states.

**Minimal repair to docs/35.** Rewrite the §4.1 meta row and the §6 preamble:

> | meta | `do` | the generic executor for an action a view advertised; takes the advertised
> `{kind, actionId, inputs}` and nothing else. Named verbs are **peers**, not sugar: they carry
> their own schema and admission and do not require a freshness token. |

and add to §5 L2: "L2 constrains the *advertised* set, not the verb set: every advertised action
has a named verb accepting the same `inputs`, and `do` accepts every advertised action. Neither
direction implies the other's admission requirements." Add to §8.1 an explicit
`requiredCapabilities: sorted` invariant with a pointer to `application-semantics.mjs:581-584` and
`mcp-web-bridge.mjs:156`, so the M4 generator cannot emit an unsorted list and silently make an
action unreplayable over MCP-over-Web.

---

## R-OP-5 — P1 — §7.1: the "mechanical, exhaustive" phase mapping is not exhaustive

**Attacked:** §7.1 mapping block and its guarantee "a view emitting a left-column string after M2
is a red test".

**Grounding.** Real phase strings with no left-column entry in §7.1:

- `selection_required` — `impl/src/application.mjs:120` (`PROVIDER_EXECUTION_SETTLED_PHASES`),
  `:282` (`{kind: 'select_candidate'}`), `:6271`, `:6418`, `:6476` (selection attention), `:6512`,
  `:6632`; `impl/src/wave.mjs:85`.
- `candidate_selected` — `impl/src/application.mjs:120`, `:6269`, `:6416`, `:6451-6458`,
  `:6481`, `:6559`.
- `input_required` — branched on as an *outline phase* at `impl/src/wave.mjs:86`
  (`blocked_interaction:answer_required`); it is also a live worker status
  (`impl/src/application.mjs:1561`; `impl/src/story.mjs:440-441`).

Conversely §1.1's 16-string list omits `selection_required`, `candidate_selected`,
`planning_failed`, `pre_delivery`, `post_delivery` — all of which appear as `phase:` literals in
`application.mjs`. §7.1's mapping *does* handle `planning_failed`, which shows the 16-string list
in §1.1 is already known-incomplete but was never reconciled.

**Failure.** At M2, C3 ("no surface serializes a phase ... outside the §7 enums") goes red for
reasons the mapping cannot resolve, or an implementer folds `selection_required` into
`awaiting_approval` and `candidate_selected` into `verifying` by guess — erasing the distinction
that `run.select` (§6) and the `select_candidate` attention
(`application.mjs:6476,6546`) exist to serve. `wave.mjs:85-86` is a live driver reading these
strings; it breaks silently.

**Minimal repair to docs/35.** Add to the §7.1 mapping:
`selection_required→awaiting_approval (attention kind select_candidate)`,
`candidate_selected→verifying`, and either map `input_required→working (attention kind
answer_question)` or state that `wave.mjs:86`'s branch is dead and deleted at M2. Then replace
"Mapping (mechanical, exhaustive…)" with "Mapping (generated by
`impl/scripts/surface-audit.mjs`; a phase literal in `impl/src` with no left-column entry is a red
test)" — a hand-maintained list is exactly the D3/D4 failure mode this document exists to end.

---

## R-OP-6 — P1 — §7.2: the member-state enum drops `interrupted` and `idle`, both of which gate live behavior

**Attacked:** §7.2 (`pending | working | paused | blocked | stopping | stopped | completed |
failed`) and its claim that kernel worker states "map below the application boundary and never
surface raw".

**Grounding.**

- `impl/src/application.mjs:1930-1934` — `_semanticControlTargets` selects eligible control targets
  as `['working', 'blocked', 'interrupted'].includes(worker.status)`.
- `impl/src/application.mjs:1949-1952` — interrupt eligibility further requires
  `['working','blocked'].includes(status) && sessionPreservationCapable === true`.
- `impl/src/application.mjs:1988-1990` — `preservationReceiptDigest` is non-null **only** when
  `worker.status === 'interrupted'`.
- Live worker statuses: `idle`, `working`, `blocked`, `input_required`, `stopping`, `exited`
  (`impl/src/story.mjs:132, 228, 340, 364, 383, 428-441`), `paused`
  (`impl/src/coordination-store.mjs:123-130`), `interrupted` (`application.mjs:1933`).
- `impl/src/coordination-store.mjs:123` — `working → {input_required, paused, completed, failed,
  cancelled}`; `:130` — `paused → {working, failed, cancelled}`. `cancelled` is a reachable member
  terminal; §7.2 has no `cancelled`.

**Failure.** §7.1 keeps `interrupted` as a *run* phase but §7.2 has no *member* `interrupted`,
while §4.1 makes `interrupt` a member-directed verb. After M2/M3, `run.member.view` cannot tell an
agent whether a member is interruptible, already interrupted, or has a preservation receipt — the
exact precondition `application.mjs:1949-1952,1988-1990` enforces. `idle` (turn finished, worker
alive, not terminal) has no target at all and is not `completed`. And §7.2 provides **no mapping
table**, unlike §7.1 — so the discipline that makes §7.1 auditable is absent where it is needed
most.

**Minimal repair to docs/35.** Add `interrupted` and `cancelled` to the §7.2 enum; give `idle` an
explicit target (either a new `idle` state or `working` plus an `awaitingTurn` boolean, stated
either way); and add a §7.2 mapping block with the same generated-by-audit discipline demanded in
R-OP-5, covering `idle | working | blocked | input_required | paused | interrupted | stopping |
exited | cancelled`.

---

## R-OP-7 — P1 — §7.3: attention kinds are wrong in both directions, and "one verb answers all of them" is false

**Attacked:** §3 attention unification ("One verb answers all of them (`run.answer`)"), §7.3
(`question | approval | decision | checkpoint | preservation | capacity`, response
`{text} | {option} | allow | deny | cancel`).

**Grounding.** Live attention kinds in `impl/src/application.mjs`:
`approve_plan` (`:281, 6542, 6944, 8764`), `select_candidate` (`:282, 6546`),
`answer_question` / `answer_approval` / `answer_decision` (`:8772-8784`),
`turn_checkpoint` (`:8790`), `session_preservation` (`:5057, 6492-6493, 6833`),
`workflow_revision` (`:6481`), `workflow_recovery` (`:6499` via `recoveryAttention`).
That is nine. §7.3 lists six, renames `session_preservation` to `preservation`, and invents
`capacity` — which exists nowhere as an attention kind; the only `capacity` token in the file is
the error code `application_workflow_capacity` (`impl/src/application.mjs:1051`).

**Failure.** §7.3's response union cannot settle two of the nine:
`approve_plan` carries `planDigest` (`application.mjs:6542`) and its CLI form is
`baton run approve RUN_ID --plan DIGEST` (`impl/src/application-semantics.mjs:615`);
`select_candidate` carries a `roles` choice set (`application.mjs:6546`, enum minted at `:8887`)
and its CLI form is `baton run select RUN_ID ROLE --reason REASON` (`application-semantics.mjs:625`).
Neither is `{text} | {option} | allow | deny | cancel`. And §4.1 keeps `approve` and `select` as
separate verbs — so §3's "one verb answers all of them" contradicts §4.1 within the same document.
An M2 implementer building C5 ("for each ... attention-bearing state, outline alone answers
what/why/next") on §7.3's six kinds will not surface `workflow_revision` or `workflow_recovery` at
all.

**Minimal repair to docs/35.** Replace the §7.3 enum with the nine live kinds
(`approve_plan | select_candidate | answer_question | answer_approval | answer_decision |
turn_checkpoint | session_preservation | workflow_revision | workflow_recovery`), delete
`capacity`, and soften §3 to:

> Every attention item carries `kind`, `prompt`, `options?`, and a bound `do`. `run.answer` settles
> the answerable kinds (`answer_*`, `turn_checkpoint`); the gate kinds (`approve_plan`,
> `select_candidate`) are settled by their named verbs, whose invocation is exactly the item's
> bound `do`. One *shape*, not one verb.

---

## R-OP-8 — P1 — §4.1†: `steer` is not `member.send --now`, and the alias flips a durability class

**Attacked:** §4.1 note † ("`steer` survives one migration window as a deprecated alias of
`member.send --now`") and the §6 row folding `run.steer` into `run.member.send`.

**Grounding.**

- `impl/src/application.mjs:142` — `'run.steer': {args: ['runId','target','mode','message',
  'reason'], capabilities: ['control','observe'], web:true, mcp:true, mcpStateful:true,
  **reconcilable: false**}`. It is the **only** non-reconcilable entry in the whole table.
- `impl/src/application.mjs:133` — `'run.workstream.notify': {args: ['runId','role','generation',
  'message','delivery'], ..., **reconcilable: true**}`.
- `impl/src/application-semantics.mjs:622` — usage:
  `baton run steer RUN_ID TARGET (--nudge | --now | --turn) TEXT --reason REASON` — all three
  delivery modes, and `--reason` is **required**, not optional.
- `impl/src/web-northbound.mjs:24-25` — `RECONCILABLE` is derived directly from that flag, and
  drives the Web bus's replay/reconciliation behavior.

**Failure.** The alias as stated (a) pins `delivery` to `now`, losing `nudge` and `turn`;
(b) drops the mandatory `reason`, which is an admission field, not a decoration; (c) if the alias
resolves to `run.member.send`'s definition, the operation silently becomes **reconcilable** on the
Web bus. That is a durability/replay behavior change delivered under the banner of a rename, in
the middle of the "no big-bang, suite green at every commit" migration.

**Minimal repair to docs/35.** Rewrite †:

> † `steer` survives one migration window as a deprecated alias of `run.member.send`, preserving
> its `delivery` mode (`nudge|now|turn`) and its **required** `reason`. `run.steer` is the only
> non-reconcilable application command (`application.mjs:142`, consumed by
> `web-northbound.mjs:24`); the alias MUST NOT inherit the target's reconcilable class.

and add `reconcilable` to the §8.1 per-operation field list, so aliases cannot inherit it
implicitly. Add a ledger row: "`run.steer` reconcilable:false — retained through M5".

---

## R-OP-9 — P1 — §6 / §4.1: `run.watch` mis-absorbs `run.wait`, and `view` already streams

**Attacked:** §4.1 read row ("`watch` = the only streaming read"), §6 rows `run.watch` and
`run.evidence / run.result`.

**Grounding.**

- `impl/src/mcp-northbound.mjs:290` — `fleet_run_wait`: *"Wait a bounded deployment-approved
  interval and return a fresh authoritative RunView"*, `readOnlyHint: true`,
  `idempotentHint: true`. It returns a **view**, not a channel. `:826` rewrites
  `timeoutMs.maximum` per deployment; `:630-631` refuses over-budget waits with `invalid_run_wait`.
- `impl/src/application-semantics.mjs:135-140` — `run.inspect.continuation`:
  `{operation:'run.inspect', cursorArgument:'cursor', selectorArguments:[...],
  waitPolicy:'deployment_derived', preferred: true, changeAware: true}`. The bounded, change-aware
  long poll is already `run.inspect`'s, i.e. `run.view`'s. `run.inspect` takes `waitMs`
  (`application.mjs:130`).
- `impl/src/application-semantics.mjs:604-606` — `run.progress`, `run.events`, `run.output` CLI
  rows all declare `operation: 'run.inspect'`, **not** `run.follow`.
- `impl/src/application-cli.mjs:1316` — `baton run output RUN_ID [--to RECIPIENT]`; the recipient
  selector has no home in a channel-only `run.watch`.
- `impl/src/application-cli.mjs:1247-1249` and `application-semantics.mjs:608` — `baton run result`
  is `run.episode --topic result`, not `run.evidence`.

**Failure.** Three concrete breaks. (1) §4.1's "watch is the only streaming read" is false on the
day it is written — `run.view`'s own registry entry advertises a preferred change-aware
continuation. (2) Folding `run.wait` into `run.watch --channel …` has no channel to fold it into;
`wait` is "one view, later", which is `view`, not `watch`. (3) `run result` is double-mapped in §6
— once to the `run.evidence / run.result` row, once (transitively, as an episode chapter) into the
`run.view` fold — so §6 does not determine which spelling is canonical, and `run.evidence`
(`application.mjs:144`, its own command) is conflated with the episode `result` chapter, which is
a different projection with a different attribution axis (see R-OP-3).

**Minimal repair to docs/35.** In §4.1 read row: "`view` = one bounded view at a depth, optionally
awaiting change (`--cursor N --wait DURATION`, `application-semantics.mjs:135-140`); `watch` = the
only *event-channel* read." In §6: move `run.wait` from the `run.watch` row to the `run.view` row;
add `recipient` to `run.watch`'s parameters alongside `channel`; delete `run.result` from §6 and
map `run result` solely to `run.view --section episode.result`, leaving `run.evidence` as the one
noun-read.

---

## R-OP-10 — P1 — §9 M1 / §11: adding canonical names to the command table breaks the Web-envelope compatibility M1 promises to keep

**Attacked:** §9 M1 ("Every §6 name resolves everywhere (D1/D2/D3 merge behind one table)"), §11
("Two registries merging (D1/D3) touches the Web bus's command admission; the merge must keep the
byte-level envelope compatibility until M4 flips renderers").

**Grounding.**

- `impl/src/web-northbound.mjs:13-15` — `WEB_APPLICATION_ENTRIES` is derived from
  `Object.entries(APPLICATION_COMMAND_DEFINITIONS)`, dots→underscores.
- `:21` `COMMAND_CAPABILITY`, `:25` `RECONCILABLE`, `:29-30` `READ_ONLY_COMMANDS`,
  `:56` `ARG_FIELDS`, `:58-60` `APPLICATION_COMMAND` — all auto-derive from that set. Adding a
  table key adds an admitted Web command, transparently.
- `impl/src/application.mjs:10668` — `card().commands = Object.keys(APPLICATION_COMMAND_DEFINITIONS)`.
- `impl/src/application.mjs:154-165` — the table's own comment: *"`card().commands` is exactly
  `Object.keys(APPLICATION_COMMAND_DEFINITIONS)`, and several out-of-this-task's-scope fixtures
  assert that list verbatim (`impl/test/phase64-integrated-run-application.test.mjs` `UA5`; also,
  transitively through `.web`/`.mcp` auto-derivation,
  `impl/test/phase12-web-operator.test.mjs`, `impl/test/phase72-kimi-orchestrator-mcp.test.mjs`,
  `impl/test/phase16-mcp-northbound.test.mjs`) — so *any* new key here, under *any* flag
  combination, breaks a file this task cannot touch."*
- `impl/src/mcp-web-bridge.mjs:62` and `:171-175` — the bridge validates
  `card.commands.includes(name)` and refuses if `agentExperience.registryDigest` changed.

**Failure.** If M1 implements "every §6 name resolves everywhere" by adding the 41 canonical names
as table entries, the Web bus's admitted command set and `card().commands` change **at M1**, not
at M4 — directly contradicting §11 — and four named test files go red at once. §8.1 shows the safe
shape (`aliases: [...]` *inside* an operation entry), but §9 M1's prose does not say that aliases
resolve at dispatch and stay out of the admitted set.

A second, subtler break: `COMMAND_CAPABILITY` (`web-northbound.mjs:17-22`) spreads the derived
entries **after** the kernel literals `send`, `interrupt`, `kill`, `list`, `result`, `wait`,
`respond`, `drain`, `spawn`, … . §6.1 derives web names as `a_b_verb` — today every application
name has a dot so no collision exists, but nothing in H1/H6/§6.1 forbids a single-segment name.
A future or aliased `send`/`wait`/`result` would **silently override** the kernel capability
mapping rather than erroring.

**Minimal repair to docs/35.** Add two sentences to M1:

> Aliases resolve in a dispatch-layer map only. They do NOT become
> `APPLICATION_COMMAND_DEFINITIONS` keys, do NOT appear in `card().commands`
> (`application.mjs:10668`), and do NOT enter `WEB_APPLICATION_ENTRIES`
> (`web-northbound.mjs:13`) before M4 — otherwise M1, not M4, changes Web-bus admission and
> `phase64-integrated-run-application.test.mjs` `UA5`.

and add a conformance assertion to §8.4/§10: **C9** — the derived web transport-name set is
disjoint from the kernel command set (`web-northbound.mjs:18-19`), asserted by construction rather
than relied on.

---

## R-OP-11 — P1 — §8.1 / §9: registry-digest churn is unbudgeted and kills live sessions at every M-phase

**Attacked:** §8.1 (`digest` as a registry field), §9's "each phase is independently shippable and
revertible".

**Grounding.**

- `impl/src/application.mjs:7313` — `registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest` is
  folded into **every** `actionId`.
- `impl/src/application.mjs:8928` — and into every advertised action's `freshness`.
- `impl/src/mcp-web-bridge.mjs:73` — the bridge pins `applicationCard.agentExperience.registryDigest`
  at connect time; `:172-175` — every subsequent `authorizeReplay` throws
  *"Remote Baton application authority changed"* if it differs.

**Failure.** M1 adds aliases, examples, and per-operation metadata to that registry; M2 changes the
phase/member/attention enums; M3 changes sections. Each bumps `digest`, which (a) invalidates every
outstanding `actionId` held by any in-flight agent, and (b) hard-fails every live MCP-over-Web
session mid-flight. §9's rollback story ("aliases are additive until M5, so each phase is
independently shippable and revertible") is true of the code and false of the running fleet — and
this document's own migration is meant to be executed by waves of agents holding those very ids.

**Minimal repair to docs/35.** In §8.1, split the field: `authorityDigest` over
schemas/capabilities/effects/enums, and `presentationDigest` over aliases/help/examples; state that
`actionId` freshness (`application.mjs:7313`) and the bridge pin (`mcp-web-bridge.mjs:172-175`)
bind only to `authorityDigest`. In §9, add one line to the rollback story: "any phase that changes
`authorityDigest` is a deploy-restart event — in-flight MCP-over-Web sessions and cached
`actionId`s do not survive it; schedule such phases at a fleet quiesce point."

---

## R-OP-12 — P2 — §4.2 H4 is unimplementable as literally worded

**Attacked:** H4 ("everything else is a labeled flag whose name equals the JSON schema property
exactly").

**Grounding.** Every current flag violates it:
`--page-cursor`→`pageCursor`, `--wait`→`waitMs`, `--to`→`recipient`
(`impl/src/application-cli.mjs:1250-1254, 1316`); `--evidence` / `--content`→`detail`
(`:1255-1256, 1265-1266`); `--nudge | --now | --turn`→`delivery` (`:1301-1310`);
`--plan`→`planDigest` (`impl/src/application-semantics.mjs:615`);
`--exact`, `--strategy`, `--text`, `--option`, `--allow/--deny/--cancel`
(`application-semantics.mjs:616-632`). Value-selecting flags (`--nudge`) are not property names at
all — they are enum *values* of one property.

**Failure.** M4's generator has no rule to follow, so it either renames ~20 flags (a wide, unbudgeted
CLI break outside M3/M4's stated scope) or quietly ignores H4, which then lints nothing.

**Minimal repair to docs/35.** H4: "…a labeled flag whose name is the kebab-case of the JSON schema
property (`pageCursor` → `--page-cursor`). An enum-valued property MAY additionally expose one flag
per value (`delivery: now` → `--now`), declared as `flagAliases` in the registry entry; ad-hoc
value flags outside that declaration are a lint failure."

---

## R-OP-13 — P2 — §4.2 H5 adds an admission precondition to the emergency path, which §2 forbids

**Attacked:** H5 ("Destructive verbs take `--reason`, uniformly (schema-enforced: `stop`,
`member.stop`, `interrupt`, `revise`, `integrate`, `adopt`)").

**Grounding.** `reason` is optional today on exactly the verbs H5 would make mandatory:
`baton run stop RUN_ID [--reason REASON]` (`impl/src/application-semantics.mjs:612`);
`run.workstream.stop` requires only `['runId','role']`
(`impl/src/application-semantics.mjs:170`); `baton run interrupt RUN_ID [--to RECIPIENT]
[--reason REASON]` (`:621`). And `run.stop` is the `emergency: true` operation
(`application-semantics.mjs:179`).

**Failure.** Schema-enforcing `reason` turns previously-valid emergency stops into
`application_action_input_invalid` refusals (`impl/src/application.mjs:10445-10450`). §2's
non-goals say "No new authority semantics"; an added admission precondition on the emergency path
is one, and it adds friction to the exact path §1's mandate wants frictionless.

**Minimal repair to docs/35.** H5: "Destructive verbs uniformly **accept and durably record**
`--reason`, and views surface its absence. Schema-*required* is limited to the non-emergency gate
class (`revise`, `integrate`, `adopt`); `stop`, `member.stop`, and `interrupt` keep `reason`
optional (`application-semantics.mjs:170, 179, 612, 621`)."

---

## R-OP-14 — P2 — §4.2 H9 vs run-scoped enums, and the `work` recipient sentinel has no spelling

**Attacked:** H9 ("Enum values are lower_snake, closed, and registry-owned … No surface mints a
string the registry does not define"), §6 `run.member.send`, H4's one-addressing-convention claim.

**Grounding.**

- `impl/src/application.mjs:8880-8906` — `strategy.enum`, `role.enum`, and `recipient.enum` are
  *minted per view from live run state* and written into the advertised `inputSchema`.
- `impl/src/application.mjs:1941-1946` — the recipient set is built from live roles, and the token
  `'work'` is unshifted as a sentinel meaning "the single eligible seat"
  (`eligible.find(row => row.role === 'work') ?? (eligible.length === 1 ? eligible[0] : null)`).
- `impl/src/application.mjs:1966-1976` — `recipient === 'work'` takes a different resolution branch,
  and its failure is `application_control_recipient_ambiguous` rather than
  `application_control_recipient_unavailable`.
- `impl/src/application.mjs:8900-8905` — `work` is the schema `default` when present; otherwise
  `recipient` becomes required.
- `impl/src/application.mjs:2165-2178` — schema-v2 controls re-resolve the target at settle time
  and refuse with `application_control_target_drift` if the live target digest moved;
  `:2184-2189` distinguishes `recipient_replaced` from `recipient_not_attached`.

**Failure.** (1) H9 is false for `recipient`/`role`/`strategy`. (2) §6 merges `--to RECIPIENT` into
`run.member.send ROLE` (H4 positional), but `work` is a *sentinel*, not a role — and a workflow
role literally named `work` is indistinguishable from it under positional addressing. (3) §3's
member addressing is `role(+generation)`, yet `_resolveSemanticControlTarget` has **no generation
dimension at all** — it resolves among live workers by role. So `role[+generation]` does not cover
what `--to RECIPIENT` covers (the `work` sentinel and the ambiguity refusal), and generation is
meaningful for `run.workstream.notify`/`run.workstreams` but not for run-level send/interrupt.
§4.1's parenthetical ("run-level forms resolve the current recipient exactly as today") is
correct; §6's `run.member.send | … --to addressing` row is not.

**Minimal repair to docs/35.** Scope H9 to the closed registry enums (phases, member states,
attention kinds, channels, effect classes) and add: "instance-valued enums (`recipient`, `role`,
`strategy`) are registry-*shaped*, not registry-*valued*; they are minted per view
(`application.mjs:8880-8906`) and H9 does not bind them." In §3, reserve `work` explicitly:
"`work` is a reserved run-level recipient token meaning *the current single seat*
(`application.mjs:1943`); `run.send` accepts it, `run.member.send ROLE` rejects it, and a member
role named `work` is a registry-lint error." Remove `--to addressing` from the §6
`run.member.send` row and put it on the `run.send / run.interrupt` row where it belongs.

---

## R-OP-15 — P2 — §9 M0–M5 dependency inversions and §8.4 ledger holes

**Attacked:** §9 migration order, §8.4 allowed-divergence ledger, §10 C8.

**(a) M1 depends on M2 and M4.** §9 puts "L2 lands" in M1. But L2 requires a "byte-identical
resulting view" across surfaces, and before M2 the surfaces do not share a vocabulary — waves rest
at `work_completed` (`impl/src/wave.mjs:12` `SUCCESS_RESTING`, `:167`, `:267`, `:281`) while runs
report `completed`, and the CLI's own terminal set is a third union
(`impl/src/application-cli.mjs:29`: `{work_completed, completed, failed, cancelled, denied,
stopped, closed}`). And C2's "all four surfaces" cannot include MCP-over-Web before M4, because
that surface admits only five of the twenty-six commands
(`impl/src/mcp-web-bridge.mjs:14-16`: `application.help, run.start, run.inspect, run.act,
run.stop`) and `authorizeReplay` throws `application_unauthorized` for anything else (`:138`).
*Fix:* move L2/C2 to M2, and scope C2 to "every surface on which the operation is enabled".

**(b) §1.1 is missing a dialect.** `ORDINARY_COMMANDS` (`mcp-web-bridge.mjs:14-16`) is a sixth
application dialect — a remote-bridge subset that is neither D3 nor D6a/D6b — and it is a hand-list,
not a capability projection, so L8 ("a principal's surface inventory *is* the capability projection
of the registry") is contradicted by it as much as by the ordinary/advanced MCP split. *Fix:* add a
D8 row to §1.1 and name it in L8 as a profile (`remote_bridge`).

**(c) C8 is cut in the wrong phase.** §10 says contracts are "cut at M0, red until their phase
lands". C8 (field-order pin) is the inverse: it would be **green at M0** and go **red at M3**, when
the episode fold changes view sections, and again at M4 when renderers are generated. The model has
no slot for a contract that must be re-pinned. *Fix:* cut C8 at M4, and say so in §10.

**(d) The ledger has no monotonicity mechanism.** §8.4 says the ledger "starts as the full audit
and must shrink to empty by M5", and §9 says "no silent regressions" — but nothing stated makes
*adding* an entry fail. A commit that removes one entry and adds another nets zero and passes.
*Fix:* "the ledger is append-forbidden: the conformance suite fails on any entry absent from the
previous commit's ledger; removal is the only legal edit."

**(e) The ledger is keyed on names only, so behavioral divergence is unrepresentable.** Two live
examples the current framing cannot record: capability filtering of advertised actions happens
**only** when `context.capabilityAuthority` is present (`impl/src/application.mjs:8869-8875` —
without it, `candidates` is returned unfiltered), so §1.3's "views already omit actions outside
the principal's capabilities" is conditional, not universal; and MCP tool schemas are mutated at
server construction (`impl/src/mcp-northbound.mjs:826` rewrites `timeoutMs.maximum` per
deployment), so the "mechanically derived" surface is not byte-stable across deployments. Neither
is a name divergence. *Fix:* give each ledger entry a
`dimension: name | args | schema | behavior | enum` field, and seed `behavior` rows for these two.

---

## R-OP-16 — P2 — §6: `run.feedback` and `run.select` are role-addressed but are not member operations

**Attacked:** §6 trust-verb row, H1/H4's single addressing convention.

**Grounding.** `'run.feedback': {args: ['runId','role','feedback'], …}`
(`impl/src/application.mjs:141`); `baton run select RUN_ID ROLE --reason REASON` and
`baton run feedback RUN_ID ROLE --text TEXT` (`impl/src/application-semantics.mjs:625-626`); their
`role.enum` is minted from live candidates (`impl/src/application.mjs:8885-8888`).

**Failure.** Under H1 (`noun[.subnoun].verb`) and H4 ("member ops take `ROLE [--generation N]`"),
a role-addressed operation named `run.feedback` is a grammar violation the §6 table enshrines. The
underlying reason is real — the `role` here addresses a *candidate*, not a live member — but §3's
ontology has no `candidate` noun, so the exception is invisible.

**Minimal repair to docs/35.** Either rename to `run.member.feedback` / `run.member.select`, or add
`candidate(role)` to the §3 noun tree under `run` and mark these two rows as candidate-addressed,
with one sentence in H4: "`role` addresses a member on `run.member.*` and a candidate on
`run.select`/`run.feedback` (`application.mjs:8885-8888`); these are the only two exceptions and
they are registry-declared."

---

## R-OP-17 — P2 — §1.2 F8 / §6 / L5: the "waves auto-approve" receipt is factually wrong, which makes C7 vacuous

**Attacked:** §1.2 F8 ("runs park for approval; waves auto-approve"), §6 `run.approve` row
("(+ waves auto-approve, now recorded)"), §5 L5, §10 C7.

**Grounding.** `impl/src/wave.mjs:147-156`, comment and code:

> `// Start members individually and explicitly approve each — nothing parks on a silent`
> `// authority gate, and one member's start failure never aborts the others.`
> `entry.run = await baton.runs.start(member.objective, {…, driverKind: 'wave'});`
> `if (approve) await entry.run.approve();`

Waves already issue an explicit `run.approve` per member, and already stamp durable provenance
via `driverKind: 'wave'` (`wave.mjs:155`; the closed driver set is at
`impl/src/application.mjs:104`). `approve` is also *optional* (`wave.mjs:131`:
`options.approve !== false`), so `waves.start({approve: false})` produces runs that **do** park —
the opposite of the doc's claim.

**Failure.** L5's headline remedy ("auto-approval becomes an *explicit recorded* `approve` by the
preset") is already shipped, so C7 passes trivially for waves while the *actual* gap goes untested:
`explore` and `review` map to `run.start` only through a CLI-row annotation
(`impl/src/application-semantics.mjs:597-598`) with no durable equivalent of `driverKind`, so
nothing in a finished run's evidence says it came from a preset. Building C7 on the wrong premise
tests the one preset that already complies and skips the two that do not.

**Minimal repair to docs/35.** Rewrite F8's third clause to: "waves already start-then-approve
explicitly (`wave.mjs:147-156`) and stamp `driverKind: 'wave'` (`wave.mjs:155`); `explore` and
`review` record no expansion at all (`application-semantics.mjs:597-598`) — the divergence is in
*provenance*, not in approval." Change the §6 note to "(waves already approve explicitly; the
preset expansion itself becomes recorded)". Restate C7 as: "every preset run's durable event log
carries an expansion record naming the preset and the core operations it issued; `waves.start
({approve:false})` is a distinct recorded expansion."

---

## Sections that survived the attack

- **H10 / C8 digest neutrality.** `digest()` canonicalizes by sorting object keys
  (`impl/src/application.mjs:171-179`) and `semanticViewDigest` strips only `cursor` (`:184-187`),
  so pinning field order cannot change any view digest, `actionId`, `_mutationKey`, or replay
  identity. H10 is safe as a *serialization* pin; the only place array order is load-bearing is
  `requiredCapabilities` (see R-OP-4), and `application-semantics.mjs:581-584` already sorts it.
- **§8.3 capability projection.** `surfaceInventory = render(filter(registry, capabilities ∪
  profile))` matches what `application.mjs:8869-8875` already does for advertised actions and what
  `web-northbound.mjs:21` does for command capabilities. Sound, subject to R-OP-15(e).
- **§1.3 "one authority path".** Confirmed: CLI, Web, MCP-stdio and MCP-over-Web all terminate in
  `BatonApplication.command`/`run.act` with the same fencing and capability checks. The unification
  really is a naming-and-projection problem.
- **`detail` → `depth` fold.** `depth`'s enum already contains `item|content|evidence`
  (`application-semantics.mjs:44-45`), a superset of episode `detail`. That half of the episode
  fold is clean.

---

## Verdict

**SOUND-WITH-FOLDS.**

The spine — one registry as generator, mechanical per-surface derivation, one lifecycle
vocabulary, capability projection, the alias-window migration — holds up under attack and is worth
building. Four defects would break implementation if cut as authority today, and they are all
repairable by editing this document rather than rethinking it.

**Fold first, in order:**

1. **R-OP-1** (P0, §5 L2 / §10 C2) — `do` blocks are view- and principal-bound
   (`application.mjs:7310-7323`); L2/C2 must be restated as kind-portable/id-local, or C2 is an
   unsatisfiable contract cut at M1 and every downstream phase inherits a red it cannot clear.
2. **R-OP-3** (P0, §4.1‡) — the episode fold loses the `role` and `generation` axes and the
   `role: null` aggregate, which `phase92-episode-attribution-red.test.mjs:103-106,133-144` pins as
   evidence guarantees. `run.view` must gain both selectors in the same edit, or M3 silently
   substitutes run aggregates for per-member evidence.
3. **R-OP-4** (P0, §4.1 meta row) — "every non-read verb is sugar for `do`" inverts the constraint
   order; `do` carries freshness + semantic-authority admission
   (`application.mjs:10416-10451`, `mcp-web-bridge.mjs:137-168`) that the named verbs do not, so
   the claim forces either a new authority precondition (violating §2) or a weakened `do`.

R-OP-2 (missing `application.shutdown` and the goal/plan family) is P0 but purely additive — it is
the cheapest of the four to fold and should ride along with them.
