# Harness2 architecture map and Baton mapping

Issue #956 source study. This document maps Harness2 task-level recursion, its
editable harness surface, its improvement library and the corresponding Baton
mechanisms. It records source locations for every claim and separates exact
correspondence, partial correspondence and mechanisms with no Baton counterpart.

## 1. Pins and scope

- Baton worktree: `74f933480e363e808bbeae2d63edfbe6eaa0e33a`, branch
  `research/h2-source`.
- Harness2 upstream: `1cfe254e8d25b15f37048c3730134686abe60335` (2026-10-13,
  `Fix arXiv link`), cloned at `.scratch/harness2-1cfe254e`.
- Paper: arXiv 2610.14224v1, "Harness2: Recursive Agent Harnessing for an Open
  World". References below use section, figure and table identifiers.
- Fork-and-Flush paper: arXiv 2610.07447v1, "Fork-and-Flush: Escaping Idea
  Basins in Autoresearch Agents", cited as F&F.
- This study read source and documentation. It ran no model-backed benchmark
  call and downloaded no benchmark dataset.

## 2. Task-level recursion: Propose, Probe, Compose

### 2.1 Entry point and reference executions

`run_task` is the task-level entry point (`harness2/core/schedule.py:566-666`).
It reads the base harness tree from the adapter's `base_harness()`
(`schedule.py:616-617`) and rolls `k` reference executions labelled
`base1..basek` (`schedule.py:619-626`). The paper calls the reference execution
`e0` and defines it as a sample from the agent under the current harness, not a
correctness label (paper §2.2.1; Appendix D.1).

Each mode then runs over the same reference executions
(`schedule.py:635-662`). The mode is selected by `run_mode`
(`harness2/core/recursion.py:569-578`): `agg` is parallel recursion and `seq`
is sequential recursion.

### 2.2 Propose: invariant and domain candidates

The candidate labels are built from `("INV", "DOM")` crossed with
`1..k` (`recursion.py:368`). Each candidate is an editable harness tree. The
proposer session receives `context/harness/` and edits files in place; the
harness directory is harvested from the session workspace
(`recursion.py:182-193`; `harness2/core/proposer.py:126-208, 313-325`). The
paper describes the invariant candidate as targeting recurring agentic
deficiencies and the domain candidate as targeting domain knowledge and
constraints (paper §2.2.1).

The proposal prompts are `INV` and `DOM` variants of one editor prompt
(`harness2/core/prompts.py:824-890`). They instruct the editor to trace every
edit to a trajectory moment, prefer divergence evidence, and change only the
component that matches the failure (paper Appendix H, Harness Editor prompts).
The `tts` prompt pack has a parallel implementation
(`prompts.py:675-708`), selected by `BenchPrompts.prompt_pack`
(`harness2/core/spec.py:89-109`).

### 2.3 Probe: execution and behavioral contrast

Each candidate tree is materialised and rolled once
(`recursion.py:260-341, 392-402`). The adapter owns execution; its protocol
requires `execute` to run one rollout and return its run directory
(`spec.py:219-225`). The paper states that probes use matched model and
environment configurations and that comparison yields a behavioral contrast
that guides composition; it does not establish task correctness (paper §2.2.1).

The evidence tree is built by `context.build` (`harness2/core/context.py:105-188`).
It writes the task, source material, full trajectories, deliverable renderings,
the current harness, the candidate pool and an optional library
(`context.py:131-165, 219-334`). Trajectories are written whole; individual
observations may carry a renderer truncation marker
(`context.py:521-546`). The proposer receives a short mission that points at
`context/` (`context.py:521-546`; `recursion.py:154-165`).

The contrast records whether an edit mitigated the targeted deficiency, left
the relevant behavior unchanged, or introduced a regression (paper §2.2.1).
The paper states that stochasticity and shared model biases limit this evidence
(paper §2.2.1, Appendix F).

### 2.4 Compose: parallel and sequential

Parallel recursion (`recursion.py:343-449`) runs `2k` proposal stages, rolls all
candidate trees, then runs `k` independent aggregator stages (`agg1..aggk`)
over the full candidate pool and the recorded decision notes
(`recursion.py:408-445`). Each aggregator composes one successor harness, which
is rolled. The aggregator prompt tells each session that it is one of `k`
aggregators and will not see the others (`prompts.py:711-771, 938-944`). The
paper calls this width scaling: `k` candidates per scope and `k` compositions
(paper §2.2.2, Figure 4a).

Sequential recursion (`recursion.py:452-566`) runs `k` rounds. Each round
proposes one `INV` and one `DOM` candidate against the current checkpoint,
rolls both, then composes one checkpoint `c1..ck`
(`recursion.py:478-562`). The round's compose prompt receives the current
harness, the round's candidates, every earlier round's candidates and
checkpoints, and the prior checkpoint's rollout as on-policy evidence
(`prompts.py:964-1008`). The final round's prompt asks for the final harness
from the whole history (`prompts.py:967, 986-999`). The paper calls this depth
scaling: `k` chained steps (paper §2.2.2, Figure 4b).

The ledger asserts the execution identity `R = 4k` rollouts and `P = 3k`
improvement sessions (`harness2/core/ledger.py:15-33, 89-113`). In parallel
mode the `4k` are `k` reference, `2k` candidate and `k` composed executions;
the `3k` are `2k` proposal and `k` composition sessions. Sequential mode has
the same counts with checkpoint compositions in place of aggregator
compositions.

Composition is selective. The composer may merge supported changes, revise
conflicting edits, adopt one candidate, or keep the base harness; each decision
names a trajectory moment or a base-set pattern
(paper §2.2.1; `prompts.py:932-958`). The star on the selected harness marks
adoption; it does not assert verified optimality (paper §2.2.2).

### 2.5 Final selection and k=1

For `k > 1`, `selection.selection_pool` returns exactly the `k` finals of the
mode (`harness2/core/selection.py:93-111`). `schedule._run_one_mode` calls
`selection.run_selection` for those finals (`schedule.py:513-528`). The selector
sees anonymised deliverables and the source material, not the harnesses or
scores (`selection.py:268-357`; `prompts.py:1040-1102`). It returns one
existing candidate; it does not synthesise content (`prompts.py:1095-1099`).
A selector failure falls back to a delivered base or the first final
(`selection.py:237-252`).

At `k = 1`, `trivial_selection` delivers the single final without a selector
session (`selection.py:360-399`; `schedule.py:514-517`). The paper states that
both recursion forms reduce to the basic contrastive step at `k=1` and bypass
selection (paper §2.2.2).

The release builds only the `finals` pool (`schedule.py:579-599`). The prompt
module still carries a `mixed` anonymity block (`prompts.py:66-83`), but the
driver rejects every pool policy except `finals` (`schedule.py:595-599`).


## 3. The eight editable components

The component set is the `SurfaceSpec` of the substrate. The OpenCode surface
has four always-on files and four on-demand component groups
(`harness2/substrate/opencode.py:42-88`):

| Component | Path | Activation | Validation and notes |
| --- | --- | --- | --- |
| System prompt | `systemprompt.md` | Every call | Part of the always-on cap. |
| Guardrails | `guardrails.md` | Every call | Also receives autotrigger lines. |
| Memory | `LongTermMEMORY.md` | Every call | Durable domain facts. |
| Tool guidance | `tool_descriptions/tool_guidance.md` | Every call | Moved to `tool_guidance.md` in the Jinja install mode. |
| Skills | `skills/<name>/SKILL.md` and `skills/<name>/scripts/*` | On demand through the skill tool | Needs frontmatter `name` and `description`; must be named in always-on text; helper scripts must ship with the skill. |
| Subagents | `sub_agents/<name>/AGENT.md` | On demand through the task tool | Needs `mode: subagent` and `description`; runs in its own context. |
| Scripts | `scripts/<name>.py` | On demand through bash | Python source must compile; every referenced script must exist. |
| Plugin | `plugin/<name>.ts` | Registered and active inside the tool loop | TypeScript file on the editable surface. |

The Codex surface collapses the always-on text into `AGENTS.md`, uses
`.agents/skills` for skills, requires no `mode: subagent` line, and exposes a
hooks file `.codex/hooks.json` in place of the plugin directory
(`harness2/substrate/codex.py:39-90`). The paper's Table 5 lists the same eight
components and groups them as context construction, tool interface,
orchestration and middleware control (paper Table 5, Appendix D.3). Appendix
D.1 places the Codex always-on text in `AGENTS.md`; Appendix H states that the
Codex variant differs only in the component paths it lists.

The paper says each component is mounted as a file in the runtime and the
stock harness contains only placeholder files naming each lever (paper
Appendix D.1). The code writes those placeholders as `README.md` stubs
(`opencode.py:64-87`). The OpenCode materialiser composes always-on files,
advertises skills and subagents by name and description, and lists helper
scripts (`opencode.py:140-170, 184-224`).

Validation runs before any rollout. `_accept_tree` first calls
`harness_tree.autotrigger`, which adds a missing trigger line for each skill
within the always-on cap (`harness2/core/tree.py:192-213`). It then calls
`harness_tree.validate` (`tree.py:336-390`), the adapter's `validate_tree`
(`spec.py:242-245`) and the grader-verdict scanner (`recursion.py:108-132`).
`validate` enforces the always-on cap, skill frontmatter and trigger lines,
subagent frontmatter, Python compilation, hook schema and script references
(`tree.py:267-334`). An invalid proposal is retried once with the validator
message; a second failure returns the starting tree and records `fell_back`
(`recursion.py:36, 180-251`). The paper's Appendix D.2 describes the same
retry and fallback rule.

The prompts also state the three validation rules that discard a proposal:
every skill needs a trigger line in always-on text, always-on text must avoid
Jinja template braces, and every named script must ship in the same proposal
(paper Appendix H; `prompts.py:113-193`).

## 4. Improvement harness and library

The improvement harness is the library plus fixed stage prompts and decision
rules. The paper states that model weights, stage instructions and the decision
rule remain fixed; the library evolves after each task (paper §2.3). The
library update is `R(t+1) = Update(R(t), H*(t), D(t))` (paper §2.3, Equation 4).

`library.Library` is one `(run, domain)` library (`harness2/core/library.py:57-181`).
The directory layout is:

- `INDEX.md` at the domain root (`library.py:69-71, 154-181`).
- `harnesses/<task-id>/harness/` for the full adopted component tree
  (`library.py:73-74, 106-129`).
- `harnesses/<task-id>/EXPERIENCE.md` for the adoption reason, the per-edit
  rows and the transferable lesson (`library.py:130-150`).

`add` refuses an entry without a `cue`, `lesson` and `evidence`
(`library.py:43-47, 120-121`), scans the tree and the experience text for
grader verdicts (`library.py:122-123`), and rebuilds `INDEX.md` from disk
(`library.py:151, 154-181`). `rebuild_index` inventories the components and
carries the experience cue (`library.py:154-181`).

The reflector runs after adoption. `reflect_adoption` rebuilds an evidence tree
from the adopted harness, the candidate finals, their rollouts and the base
harness, and writes `adoption.json` (`selection.py:402-451`). `_distil` runs the
Experience Reflector prompt and extracts `<edits>` and `<experience>` blocks
(`selection.py:454-505`). The experience fields are `cue`, `lesson`, `evidence`
and `confidence` (`selection.py:493-504`; paper Appendix H). The edit rows are
stored in `edits.md` (`selection.py:487-489`). The library entry is written only
when `cue`, `lesson` and `evidence` are present
(`schedule.py:529-563`; `library.py:43-47, 120-121`).

The reflection prompt tells the reflector that selection compared deliverable
artifacts with harnesses hidden, that every candidate is evidence, and that a
lesson resting only on confounded edits is a guess (paper Appendix H;
`prompts.py:1105-1163`). The prompt verdict vocabulary is `helped`, `hurt`,
`no observed effect` and `confounded` (`prompts.py:1126-1132`).

Library scoping and reuse:

- The library root is per benchmark and `k`, optionally with a shared tag
  (`library.py:215-222`).
- `run_domain` creates one library per mode and domain, and calls
  `retain(task_ids[:i - 1])` before each task so only earlier stream entries
  remain (`schedule.py:669-733`).
- `context_dir` returns the domain directory only when the index exists and at
  least one `EXPERIENCE.md` exists (`library.py:79-81`).
- `context.build` copies the library into `context/library/` for the proposer
  (`context.py:160-165`); the recursion drivers pass the library directory into
  every stage (`recursion.py:146-164, 382-384, 423-424, 505-506, 551-552`). The
  prompts tell the editor to browse `INDEX.md`, copy a component into the
  current harness when reusing it, and re-verify any earlier workspace fact
  (paper Appendix H; `prompts.py:126-193`).

What is persisted after a task: the adopted harness tree, `EXPERIENCE.md` and
the regenerated index. What is not persisted in the library: losing candidate
trees, trajectories, deliverables and the selection record. Those remain in
the run directory and audit trail (`selection.py:268-357`; `proposer.py:362-387`),
and `selection.json` records the adopted label and reason. The paper's
Appendix G lists consolidation of overlapping components and retrieval
adaptation as future work, so the current library keeps every entry.

The paper's Appendix E.2 reports that 22% of modified files on LAB and
WorkBuddy-Office and 47% on JobBench contain lines from a library entry, and
that only 2–10% of modified files retain at least half their lines from an
entry (paper Appendix E.2, Figure 10). This measures adaptation, not wholesale
inheritance. The leave-one-out re-run in the same appendix is an offline reuse
analysis, not an online gain (paper Appendix E.2, Figure 11).

## 5. Baton mapping

The correspondence labels in this section and in the mapping table are this
study's analysis. The cited source locations establish the mechanisms; neither
source states the correspondence itself. Design options such as placing
evidence files in a branch worktree are proposals for an experiment.

### 5.1 Fork-and-flush branch actions

The branch feature is documented in `docs/bend2/branching-ensembles.md` at
feature commit `0464b7c65d`, and the installed CLI prints the same usage
(`baton help branch`, observed 2026-10-19). The feature commit is not an
ancestor of the pinned worktree `74f933480e363e808bbeae2d63edfbe6eaa0e33a`.
The pinned scope record says PR #860 still requires current-main integration
and runtime qualification, and that actual Baton branch actions and completed
branch results are required to qualify the mechanism
(`docs/bend2/current-work-scope-2026-10-19.md:51-56`). The capability remains
unqualified; the mapping below describes the documented design.

The pinned `docs/bend2/agent-commands.md` and `docs/bend2/architecture.md` do
not document the branch actions. The installed CLI prints the usage, and the
feature document at `0464b7c65d` supplies the semantics used here.

`branch start` records a round, takes a private Git index snapshot of tracked
and nonignored untracked files from a settled source workspace, creates one
separate worktree per child at that snapshot, and launches a fresh native
conversation for each child (`docs/bend2/branching-ensembles.md` at
`0464b7c65d:46-58`; `bend2/src/coordinator/branching.bend` at
`0464b7c65d:195-220`). This is the F&F fork plus flush operation: the workspace
is retained and the chat context is new (F&F §4, "Forking and Flushing").

`branch evaluate` runs the stored JSON argv evaluator in a separate snapshot
checkout of a settled branch and retains stdout, stderr and wait status. A
successful evaluator returns one JSON object with boolean `accepted` and
numeric `score` (`branching-ensembles.md:60-70`;
`branching.bend:250-285`).

`branch select` without `--player` requires every branch to have successful
native settlement, no explicit stop and an accepted current evaluation with
one unique best score. `--direction max|min` selects the best score. Failed,
partial or tied rounds require `select --player PLAYER --reason TEXT`
(`branching-ensembles.md:70-80`; `branching.bend:284-306`).

`branch continue` dispatches guidance to the selected Player's existing
conversation and workspace, with the stored complete task as the default
guidance. A stopped selected Player needs `resume --lift-stop`
(`branching-ensembles.md:82-96`; `branching.bend:308-319`).

`branch stop --reason TEXT [--player PLAYER]` records a supported session stop;
all branch artifacts, reports, pending input and evaluator evidence remain
retained (`branching-ensembles.md:89-96`; `branching.bend:321-329`).

Mapping to Harness2:

- `branch start` corresponds to the probe stage in the sense that it launches
  independent fresh-context executions from one shared state. Harness2 probes
  execute edited harness trees on the same task; Baton branch start snapshots a
  workspace and task input and launches native sessions. Correspondence:
  partial. The shared state is a workspace snapshot in Baton and a harness tree
  plus task evidence in Harness2.
- `branch evaluate` corresponds to the probe's evidence collection and, when
  the evaluator returns a score, to the score-based part of final selection.
  Harness2 deliberately has no evaluator and uses behavioral contrast and an
  agentic selector (paper §2.2.1, §2.2.2). Correspondence: partial. A Baton
  score is external and deterministic; a Harness2 contrast is trajectory-based
  and label-free.
- `branch select --player --reason` corresponds to Harness2 final selection
  when the selector returns one existing deliverable with a reason. Baton's
  automatic score-based selection has no Harness2 equivalent because Harness2
  has no score. Correspondence: partial for explicit selection; none for
  automatic score selection.
- `branch continue` corresponds to the exploitation phase after F&F selection,
  and loosely to Harness2 sequential recursion's carry-forward. It differs in
  one important way: Baton continues the selected conversation; Harness2
  sequential recursion starts a new execution under the composed harness and
  carries the harness and evidence, not the conversation. Correspondence:
  partial.
- `branch stop` has no Harness2 counterpart. Harness2 bounds a rollout with a
  turn limit and a wall-clock timeout (paper Appendix D.1) and has no explicit
  stop action for a candidate.
- Harness2 mechanisms with no Baton branch equivalent: editing and validating a
  harness component tree, executing that tree as a probe, composing a successor
  harness from candidate evidence, the per-domain harness library, and the
  blind artifact selector.

### 5.2 Baton Knowledge

Baton stores findings in the shared SQLite database. A finding has an author,
a claim, evidence text, a limits statement and a kind
(`bend2/src/coordinator/knowledge.bend:16-19`). Recording a finding writes the
finding and a notice to the author's immediate parent in one transaction
(`knowledge.bend:297-330`). Promotion records the finding, original author,
source, destination, promoting actor and endpoint kinds
(`knowledge.bend:377-430`). The promoter must own the destination; the source
must be the finding's author or a destination already recorded for that
finding (`knowledge.bend:386-397`). Promotion writes a destination-owner
notice (`knowledge.bend:411-418`).

Scoped reads use `worker WORKER`, `group ENSEMBLE`, `universal PRINCIPAL` and
`all` (`knowledge.bend:112-135`; `docs/bend2/knowledge-context-2026-09-29.md:45-54`).
Worker scope includes authored findings and findings promoted to that worker;
group scope includes findings promoted to the Ensemble; universal scope
includes the Principal Conductor's authored findings and findings promoted to
it (`knowledge-context-2026-09-29.md:47-54`). Every registered session can read
all findings for discovery, while scoped reads select holdings
(`knowledge-context-2026-09-29.md:43, 47-54`).

Relations are authored rows with a source, relation name and target
(`knowledge.bend:349-351`). Search matches query terms across findings and
retained evidence messages and returns typed neighbours
(`knowledge.bend:231-250`). Traversal follows authored and cited edges under
the reader's scope (`knowledge.bend:266-284`;
`docs/bend2/knowledge-context-2026-09-29.md:22-34`).

Mapping Harness2 library entries:

- `EXPERIENCE.md` `cue` and `lesson` map to a Baton finding's claim and kind;
  `evidence` maps to the evidence reference; `confidence` maps to the limits
  text. Correspondence: partial. Baton has no dedicated confidence field, and
  its finding schema has no per-edit table. The per-edit rows would need to be
  carried in the evidence or limits text, or in a separate finding.
- The full adopted harness tree has no Baton finding payload. Baton evidence
  references accept `file:`, `message:`, `finding:`, `http(s):` and `external:`
  prefixes (`knowledge-context-2026-09-29.md:22-30`). A committed harness tree
  can be cited by commit and path, but the database does not store the tree.
  Correspondence: partial with an explicit file reference.
- Per-domain library scope maps to Baton `group` scope when the domain is an
  Ensemble, or `worker` scope for one owner. Harness2 has automatic domain
  visibility for every later task in the same domain; Baton requires an
  explicit promotion to the destination scope (`knowledge.bend:120-127`;
  `knowledge-context-2026-09-29.md:43-54`). Correspondence: partial with a
  changed visibility rule.
- The library index maps to `knowledge read` metadata, `knowledge search` and
  `knowledge traverse` (`docs/bend2/agent-commands.md:223-257`). Harness2 has
  no search or graph; it browses `INDEX.md`. Correspondence: partial.
- Reflection after a task maps to a Knowledge record operation after the
  deliverable is accepted. Baton has no automatic reflector; a Player or
  Conductor must author the finding (`docs/bend2/agent-commands.md:223-257`).
  Correspondence: partial.
- Promotion is exact in Baton and absent in Harness2. Harness2's library is
  automatically readable by later tasks in the domain; Baton's promotion is an
  explicit owner decision with provenance and a notice
  (`knowledge-context-2026-09-29.md:43, 58-64`;
  `docs/bend2/examples/shared-finding-review.md:29-105`).
- Relations and traversal are exact in Baton and absent in Harness2. Harness2
  `EXPERIENCE.md` is prose; it has no relation graph.
  Correspondence: exact for Baton, none for Harness2.
- Durable coordination records, message receipts, parentage and stop state are
  exact in Baton and absent in Harness2. Harness2 keeps a local run directory
  and audit files, with no inter-session durable coordination. Correspondence:
  exact for Baton, none for Harness2.

Baton stores durably that Harness2 does not: findings, promotion provenance,
relations, notices and receipts, session parentage, stop records, branch
rounds, evaluations and selection records (the last three on the branch
feature). Harness2 stores that Baton does not: full executable harness trees,
per-domain `INDEX.md` entries, `EXPERIENCE.md` files, `selection.json` and
per-session mission/response audit files.

### 5.3 Sessions, Ensembles, Sections and dispatch

Baton records a session parent, a requested and observed route, a workspace, a
branch and a base commit (`docs/bend2/architecture.md:52-65`). Roles are
Player, Principal Conductor, Associate Conductor and operator
(`docs/bend2/agent-commands.md:259-279`; `baton help role`). An Ensemble
records an owner and loose or tight coupling. Tight coupling permits messages
between non-operator peers in the same Ensemble
(`docs/bend2/agent-commands.md:259-279`; `baton help ensemble`). A Section
records a capability label and a subset of Ensemble members
(`baton help section`; `architecture.md:112-115`).

Dispatch delivers complete task input and wakes the recipient through the
message path (`docs/bend2/agent-commands.md:173-202`;
`architecture.md:160-175`). `report` and `ask` address the current actor's
recorded coordinator (`agent-commands.md:192-202`). A successful native turn
records handling of its complete owned reads and derives recipient receipts
(`agent-commands.md:7-18`; `architecture.md:76-83`).

Mapping to Harness2:

- The Harness2 `INV` and `DOM` editor sessions are two role-scoped sessions
  with disjoint evidence lenses. Baton Sections label capability membership;
  they do not supply editor prompts or disjoint evidence. Correspondence:
  partial. A Conductor can create two Sections or two Players and dispatch
  different instructions, but Baton does not enforce the lens split.
- Harness2's `k` parallel composers are independent and are told they will not
  see each other (`prompts.py:938-944`). Baton tight coupling permits peer
  messages; loose coupling follows parent-child and Conductor-descendant
  routes (`baton help ensemble`). Correspondence: partial. A tight Ensemble
  changes the information flow that Harness2 relies on.
- Harness2 passes evidence as files in a session working directory
  (`context.py:105-188`; `proposer.py:157-160`). Baton dispatch carries complete
  task text and stored messages, and records a workspace; it does not build an
  evidence tree or a grader-verdict-free context for the recipient.
  Correspondence: partial. A Conductor can place evidence files in a branch
  worktree before dispatch, but Baton has no built-in builder or scanner.
- Harness2's editor, composer, selector and reflector are separate agentic
  sessions. Baton's Conductor/Player hierarchy separates review and work, and
  branch selection records a Conductor decision
  (`architecture.md:117-175`; `branching-ensembles.md:70-87`). Correspondence:
  partial. The purposes differ: Harness2 separates proposal from composition
  and artifact selection; Baton separates work from coordination and landing
  review.

## 6. Gaps and risks

### 6.1 What Harness2 assumes that Baton does not provide

- Editable harness surface. Harness2 exposes eight component files and edits
  them as a tree (`opencode.py:42-88`; paper Table 5). Baton configures a
  native session by harness, model, effort and command
  (`architecture.md:117-136`; `configure` in
  `agent-commands.md:139-153`). It does not expose system prompt, guardrails,
  memory, tool guidance, skills, subagents, scripts or plugins as a per-task
  editable tree.
- Filesystem-mounted components. Harness2 materialises a tree into the runtime
  and mounts it into the benchmark container (`opencode.py:184-224`; paper
  Appendix D.1). Baton records a workspace and branch and launches a native
  session there (`architecture.md:117-136`). It has no component mount step.
- Benchmark adapter. Harness2's `BenchmarkAdapter` supplies tasks, task prompt,
  source files, execution, deliverables, trajectory and scoring
  (`spec.py:200-250`). Baton dispatch supplies task input to an agent and has
  no benchmark rollout interface (`agent-commands.md:173-202`).
- Selector. Harness2 has a blind artifact selector (`selection.py:268-357`).
  Baton has score-based or explicit branch selection
  (`branching-ensembles.md:70-80`). Baton has no blind artifact comparison
  command.
- Judge and verifier. Harness2 keeps benchmark judging outside the pipeline
  and never exposes rubric or score to the editor, composer or selector (paper
  Appendix B; `spec.py:247-250`). Baton branch evaluation is an external argv
  evaluator (`branching-ensembles.md:60-70`). Baton has no built-in LLM judge
  or artifact verifier.
- Retry semantics. Harness2 retries an invalid tree once with the validator
  message, retries transport sessions, and falls back to the starting tree
  (`recursion.py:36, 180-251`; `proposer.py:149-208`). Baton retries messages
  by identity, retries recorded branch setup with `branch recover`, and
  retries native turns (`architecture.md:76-83, 360-374`;
  `branching-ensembles.md:89-96`). It has no component validation retry.
- Cost accounting. Harness2 records rollout and session counts and USD per
  mode (`ledger.py:15-33, 115-132`; `proposer.py:362-387`). Baton reports
  observed usage and logs (`agent-commands.md:290-301`). Baton project rules
  prohibit budget control flow (`AGENTS.md:51-58`), so a Harness2-style ledger
  can be evidence but cannot gate admission, continuation or completion.
- Container isolation. Harness2 runs rollouts in benchmark containers and
  states that every rollout is a fresh container (paper Appendix B). Baton
  processes run with the local user's access (`architecture.md:93-95`) in
  Git worktrees. Baton has no container boundary around candidate execution.
- Model and editor configuration. Harness2 has separate executor and improver
  models, and a selector channel (`config.py:99-102`; `spec.py:160-162`).
  Baton records harness, model and effort per session and can override them for
  branches (`architecture.md:117-136`; `branching-ensembles.md:40-44`).
  Correspondence: partial.

### 6.2 What Baton provides that Harness2 does not

- Durable SQLite coordination: sessions, messages, receipts, turns, roles,
  Ensembles, Sections and stops (`architecture.md:52-68, 97-115`).
- Explicit knowledge promotion with provenance and destination-owner notices
  (`knowledge.bend:377-430`; `knowledge-context-2026-09-29.md:43, 58-64`).
- Scoped knowledge reads and traversal (`knowledge.bend:112-135, 266-284`).
- Branch ancestry: rounds record source, ancestor, snapshot and evaluator;
  selections record the chosen session, evaluation and reason
  (`branching.bend:195-220, 284-306`). Harness2 records a per-task adoption
  reason; it records no branch lineage.
- Review and landing separation: the Conductor reviews reports, branches and
  worktrees, then lands or checks a landing
  (`architecture.md:308-356`; `agent-commands.md:204-221`). Harness2's selector
  chooses an artifact and does not review or land code.
- Native session continuation, stop, resume and recovery
  (`architecture.md:360-374`; `agent-commands.md:117-153`).
- Explicit session stop with retained state (`baton help branch`;
  `branching-ensembles.md:89-96`).

### 6.3 Mechanisms unsafe or inappropriate to adopt directly

- Automatic editing of the Baton runtime or of Player instructions. Harness2
  edits prompts, guardrails, memory and plugins, then executes them. Baton
  project rules require a named observed failure before adding a mechanism
  (`AGENTS.md:39-49`) and prohibit pausing, idling and truncating agents
  (`AGENTS.md:60-68`). An automatic editor could introduce exactly those
  behaviors without review.
- Automatic per-domain library inheritance. Harness2 makes an adopted harness
  readable by every later task in the domain. Baton's knowledge visibility is
  explicit: worker, group, universal or all, with promotion required for a
  destination scope (`knowledge-context-2026-09-29.md:43-54`). Automatic
  inheritance would bypass the owner decision and notice.
- Budget-driven admission, continuation or completion. Harness2's `k` is an
  exploration budget and its ledger records the counts. Baton prohibits
  budgets from controlling admission, continuation, completion, input
  acceptance or validation (`AGENTS.md:51-58`). A bounded experiment may fix a
  small candidate count as an experimental design; it must not become runtime
  control flow.
- LLM judge or selector as a correctness gate. Harness2 states that behavioral
  contrasts do not establish correctness and can reflect shared model biases
  (paper §2.2.1, Appendix F). Baton landing checks and Conductor review are the
  authority for code changes (`architecture.md:308-356`). An agentic selector
  can supply review evidence; it cannot authorize landing.
- Executing candidate plugins, hooks or scripts outside isolation. Harness2
  runs probes in containers and tells the editor never to execute a candidate
  script (paper Appendix B; `prompts.py:56-63`). Baton processes run with the
  local user's access (`architecture.md:93-95`) and worktrees share the host.
- Tight Ensemble coupling between composers. Harness2 keeps parallel
  composers independent (`prompts.py:938-944`). Tight coupling permits peer
  messages (`baton help ensemble`), which changes the comparison.
- Storing task text or generated harness entries as Markdown in the
  repository. Baton bans generated Markdown and task-source files and requires
  task text and setup outcomes in the database (`AGENTS.md:22-28`). A harness
  experiment can commit harness source as reviewed code; it must not recreate
  task storage as files.

## 7. Verdict: bounded experiments and exclusions

Worth a bounded experiment:

1. Contrastive branch comparison on one real task. Use `branch start --count 2`
   from a settled workspace, with one branch instructed to improve process and
   one to add domain knowledge, then `branch evaluate` with an existing
   deterministic check, `branch select --player --reason`, and `branch
   continue`. Record the comparison evidence as Baton findings. This tests F&F
   and the Harness2 probe/selection shape without editing a harness tree. The
   branch feature must first complete the qualification named in
   `current-work-scope-2026-10-19.md:51-56`.
2. Lesson recording in Baton Knowledge. Record one `cue`/`lesson`/`evidence`
   entry as a finding, cite the branch round and commits, state the confidence
   in the limits text, and promote it explicitly to a sibling's scope. This
   tests the `EXPERIENCE.md` content model against Baton findings and
   promotion. It uses existing Knowledge operations
   (`agent-commands.md:223-257`).
3. Blind artifact comparison as review evidence. Have a separate agent compare
   anonymised deliverables with harness provenance hidden, and let the
   Conductor decide. This tests the Harness2 selector's review value without
   making it an authority. Baton has no command for this; it would be an
   ordinary dispatched review task.

Do not adopt:

- An editable harness tree in the Baton runtime, with automatic validation and
  rollout, as a production mechanism.
- Automatic domain library inheritance or implicit reuse of earlier harness
  components.
- Score or budget control of admission, continuation, completion or
  validation.
- An LLM selector or judge as the authority for correctness or landing.
- Candidate plugin, hook or script execution outside a container boundary.
- Markdown task storage or generated task-source files.

## 8. Mapping table

| Harness2 mechanism | Exact Harness2 location | Baton counterpart or gap | Exact Baton location | Confidence and caveats |
| --- | --- | --- | --- | --- |
| Reference executions (`k` base rollouts) | `harness2/core/schedule.py:619-626`; paper §2.2.1 | Partial. Baton can run a base task and then snapshot its workspace for branches; it has no shared reference set with one label per sample. | `docs/bend2/branching-ensembles.md` at `0464b7c65d:35-58`; `bend2/src/coordinator/branching.bend` at `0464b7c65d:195-220` | High for Harness2; branch capability not in pinned tree; `current-work-scope-2026-10-19.md:51-56` says it is unqualified. |
| Invariant and domain candidate proposals | `harness2/core/recursion.py:368`; `harness2/core/prompts.py:824-890`; paper §2.2.1, Appendix H | None. Baton has no editable component tree or INV/DOM editor prompts. | `docs/bend2/architecture.md:117-136` (session configuration only) | High. A Baton Section is a capability label, not an editor lens. |
| Candidate probe (execute edited harness once) | `harness2/core/recursion.py:260-341, 392-402`; `harness2/core/context.py:105-188`; paper §2.2.1 | Partial. Baton `branch start` and `branch continue` launch fresh or continued native sessions, but the changed artifact is a workspace, not a harness tree. | `docs/bend2/branching-ensembles.md:46-58, 82-87`; `branching.bend:195-220, 308-319` | High for the branch shape; no component-tree probe exists. |
| Behavioral contrast from trajectories and deliverables | `harness2/core/context.py:219-334`; `harness2/core/prompts.py:916-937`; paper §2.2.1 | Partial. Baton retains trajectories and reports; branch evaluation records evaluator output. It has no standard contrast artifact and no blind artifact comparison. | `docs/bend2/architecture.md:146-175`; `docs/bend2/branching-ensembles.md:60-80` | Medium. The evidence exists; the comparison procedure is manual. |
| Compose successor harness | `harness2/core/recursion.py:408-445, 478-562`; `harness2/core/prompts.py:893-1008`; paper §2.2.1-2.2.2 | None. Baton has no harness composer; `branch continue` continues one selected branch. | `docs/bend2/branching-ensembles.md:82-87` | High. A merge of branch workspaces would be an ordinary Git merge, not a harness composition. |
| Final selection at `k>1` | `harness2/core/selection.py:93-111, 268-357`; `harness2/core/schedule.py:513-528`; paper §2.2.2 | Partial. Baton `branch select` chooses a branch; score-based selection needs an evaluator, and explicit selection needs a reason. Harness2's selector is blind to harness and score. | `docs/bend2/branching-ensembles.md:70-80`; `branching.bend:284-306` | High for both code paths; selection pools differ: Harness2 selects the `k` finals; Baton selects across all branches in a round. |
| Parallel recursion at `k>1` | `harness2/core/recursion.py:343-449`; paper §2.2.2, Figure 4a | Partial. `branch start --count N` fans out worktrees with fresh conversations; it does not produce `k` invariant and `k` domain harnesses or `k` compositions. | `docs/bend2/branching-ensembles.md:20-27, 46-58`; `branching.bend:195-220` | High. The branch feature is unqualified in the pinned scope. |
| Sequential recursion at `k>1` | `harness2/core/recursion.py:452-566`; paper §2.2.2, Figure 4b | Partial. Successive `branch start` rounds from the selected Player approximate the chained rounds; Baton continues the selected conversation, while Harness2 carries a composed harness and accumulated evidence. | `docs/bend2/branching-ensembles.md:82-87`; `branching.bend:308-319` | Medium. The state carried differs: conversation and workspace versus harness tree and evidence. |
| `k=1` basic contrastive step | `harness2/core/recursion.py:343-449, 452-566`; `harness2/core/selection.py:360-399`; paper §2.2.2 | Partial. One branch round with one selected Player is closest; Baton still uses `branch select` or an explicit decision. | `docs/bend2/branching-ensembles.md:70-87` | High for Harness2; the Baton shape is a design inference. |
| Eight editable components and file layout | `harness2/substrate/opencode.py:42-88`; `harness2/substrate/codex.py:39-90`; paper Table 5, Appendix D.3 | None. Baton records harness, model, effort, command and workspace; it does not expose prompt, guardrail, memory, tool-guidance, skill, subagent, script or plugin files as a per-task editable surface. | `docs/bend2/architecture.md:117-136`; `docs/bend2/agent-commands.md:117-153` | High. Codex exposes a hooks file where OpenCode exposes a plugin directory; the paper calls both eight components. |
| Component validation and one retry | `harness2/core/recursion.py:108-132, 180-251`; `harness2/core/tree.py:192-213, 267-390`; paper Appendix D.2 | Partial. Baton has `branch recover`, message retry and native turn recovery; it has no component validator or validation retry. | `docs/bend2/architecture.md:76-83, 360-374`; `docs/bend2/branching-ensembles.md:89-96` | High. Harness2 retries an invalid tree once, then falls back to the starting tree. |
| Library entry: full adopted tree plus `EXPERIENCE.md` | `harness2/core/library.py:106-150`; paper §2.3, Appendix D.2 | Partial. Baton can store a finding and cite a committed tree with a `file:` reference; the database has no executable tree payload. | `bend2/src/coordinator/knowledge.bend:16-19`; `docs/bend2/knowledge-context-2026-09-29.md:22-30` | High. The full tree remains a file artifact; the finding carries the lesson and evidence. |
| `EXPERIENCE.md` fields: cue, lesson, evidence, confidence | `harness2/core/selection.py:493-504`; `harness2/core/prompts.py:1105-1163`; paper §2.3, Appendix H | Partial. Baton finding fields are claim, evidence and limits, with an authored kind. Confidence has no dedicated field. | `bend2/src/coordinator/knowledge.bend:16-19`; `docs/bend2/agent-commands.md:223-257` | High. Confidence can be placed in limits; the per-edit table has no schema. |
| Library index and browsing | `harness2/core/library.py:154-181`; `harness2/core/prompts.py:126-193` | Partial. Baton has `knowledge read`, `search`, `traverse` and `relations`; no harness inventory index. | `docs/bend2/agent-commands.md:223-257`; `knowledge.bend:231-284` | High. The index is a generated file; Baton queries the database. |
| Per-domain library scope | `harness2/core/library.py:50-81, 215-222`; `harness2/core/schedule.py:686-702`; paper Appendix D.2 | Partial. Baton scopes are worker, group, universal and all; a domain can be an Ensemble or a worker subject, and promotion is explicit. | `knowledge.bend:112-135`; `docs/bend2/knowledge-context-2026-09-29.md:45-54` | High. Harness2 domain visibility is automatic; Baton requires promotion. |
| Reflection and library update after a task | `harness2/core/selection.py:402-505`; `harness2/core/schedule.py:529-563`; paper §2.3, Equation 4 | Partial. Baton Knowledge records a finding after work; no automatic reflector or library update runs. | `docs/bend2/agent-commands.md:223-257`; `docs/bend2/knowledge-context-2026-10-01.md:29-44` | High. A finding records the lesson; the adopted harness tree is not updated by Knowledge. |
| Reuse and adaptation from earlier entries | `harness2/core/context.py:160-165`; `harness2/core/prompts.py:126-193`; paper §2.3, Appendix E.2 | Partial. Baton reads scoped findings and can copy a committed component after review; no automatic library copy or re-verification step exists. | `docs/bend2/knowledge-context-2026-09-29.md:45-54`; `docs/bend2/examples/shared-finding-review.md:107-122` | Medium. Harness2 measures adaptation; Baton would rely on the Player and Conductor. |
| Explicit promotion with provenance and notice | No Harness2 counterpart; the library is automatically readable within the domain. | Exact. Baton `knowledge promote` stores source, destination, promoting actor and endpoint kinds, and writes the destination-owner notice. | `bend2/src/coordinator/knowledge.bend:377-430`; `docs/bend2/knowledge-context-2026-09-29.md:43, 58-64`; `docs/bend2/examples/shared-finding-review.md:52-105` | High. The owner decision is the visibility boundary. |
| Authored relations and traversal | None. `EXPERIENCE.md` is prose. | Exact in Baton. | `knowledge.bend:349-351, 266-284`; `docs/bend2/knowledge-context-2026-09-29.md:22-34`; `docs/bend2/agent-commands.md:230-236` | High. Baton derives `Cited` edges from evidence references. |
| Session, Ensemble, Section and role structure | Harness2 editor/composer/selector/reflector sessions; INV/DOM lenses | Partial. Baton has roles, Ensembles, Sections and coupling; Section is a capability label, not an editor lens. | `docs/bend2/agent-commands.md:259-279`; `docs/bend2/architecture.md:97-115`; `baton help ensemble`; `baton help section`; `baton help role` | High. Tight coupling permits peer messages; Harness2 parallel composers are isolated. |
| Dispatch, report and ask | `harness2/core/context.py:105-188`; `harness2/core/proposer.py:126-208`; paper Appendix D.2 | Partial. Baton `dispatch` stores complete task input and wakes the recipient; `report` and `ask` address the recorded coordinator. Baton does not build a per-session evidence tree. | `docs/bend2/agent-commands.md:173-202`; `docs/bend2/architecture.md:160-175` | High. Evidence construction would be a separate workspace step. |
| Durable coordination and receipts | None. Harness2 uses local run directories and audit files. | Exact in Baton. | `docs/bend2/architecture.md:52-83`; `docs/bend2/agent-commands.md:7-18` | High. |
| Branch ancestry and landing review | None. Harness2 records adoption reason, not branch lineage. | Exact in Baton (branch feature); landing is the existing review path. | `branching.bend:195-220, 284-306`; `docs/bend2/architecture.md:308-356`; `docs/bend2/agent-commands.md:204-221` | High for landing; branch feature unqualified in the pinned scope. |
| Explicit stop | None. Harness2 bounds a rollout with a turn limit and wall-clock timeout. | Exact in Baton. | `docs/bend2/branching-ensembles.md:89-96`; `branching.bend:321-329`; `docs/bend2/agent-commands.md:117-153` | High. Baton stop retains session state. |
| Container isolation for probes | `harness2/benchmarks/workbuddy.py:805-824`; paper Appendix B | None. Baton runs native processes as the local user in Git worktrees. | `docs/bend2/architecture.md:93-95` | High. Candidate code execution would need an external isolation boundary. |
| Benchmark adapter, judge and score | `harness2/core/spec.py:200-250`; `harness2/core/selection.py:268-357`; paper Appendix B | Partial. `branch evaluate` accepts an external argv evaluator and a score; Baton has no benchmark task protocol or built-in judge. | `docs/bend2/branching-ensembles.md:60-80` | High. The evaluator is external; Harness2's adapter and judge are part of its method. |
| Cost accounting | `harness2/core/ledger.py:15-33, 115-132`; `harness2/core/proposer.py:362-387` | Partial. Baton reports observed usage and logs; project rules prohibit budget control flow. | `docs/bend2/agent-commands.md:290-301`; `AGENTS.md:51-58` | High. Use usage as evidence; do not gate work on it. |

## 9. What this study did not verify

- No Baton branch action was executed. The branch capability is described by
  `baton help branch` and by the feature commit `0464b7c65d`, which is not an
  ancestor of the pinned worktree. The pinned scope record says it is not yet
  qualified (`docs/bend2/current-work-scope-2026-10-19.md:51-56`).
- No Harness2 benchmark rollout, editor session, selector session or judge run
  was executed. All Harness2 claims come from source reading and the paper.
- No benchmark dataset, rubric, hidden test or answer key was accessed.
- The paper's reported scores and the Appendix E.2 provenance measurements were
  not reproduced.
- The exact runtime model configuration used by each Harness2 adapter was not
  traced beyond the adapter and config definitions (`config.py:99-102`;
  `spec.py:132-175`). The study did not verify that every adapter uses the same
  model for reference and candidate probes.
- The Baton side of the mapping uses the pinned worktree and the installed CLI
  help. It does not establish that a later Baton main contains the branch
  feature or that the feature's acceptance tests passed.
- The `issue://956` read failed because the GitHub CLI is not authenticated.
  The assignment text supplied the issue scope; the issue body was not read.
