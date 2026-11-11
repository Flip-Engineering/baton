[attempt: e354aeda-f975-4520-83a6-7533eb6ff998 row-contract]
# Phase-level campaign grammar — implementation contract (the WF-1 rung)

Date: 2026-08-14. Status: contract for implementation, **v1** — ring-2 form (ground truths →
decisions → refusal vocabulary → red-first acceptance → open questions). Authority: the
row-contract brief in this directory (`row-contract-brief.md`) plus the operator's north-star ask
carried by #170 — *"a scripted-dynamic workflow through the baton surface — a DSL or literally
anything better than this one-off ad-hoc"* — escalated one rung: today the #170 DSL expresses ONE
wave per spec; this contract specifies the PHASE level, an entire methodology pipeline
(ground → spec → red-team → suite → blue-team → remediate → impl → validate →
return-to-orchestrator) as ONE dynamic workflow script. Every citation below was re-verified this
session against the working tree (worktree HEAD `5ae2c7e5`) with `grep -an`/`sed -n`. NUL
discipline applied to `application.mjs` and `coordination-store.mjs` (`grep -a`/`sed -n` only —
both carry NUL bytes). No wall-clock claims; no arbitrary numeric limits.

**Deliverable-path judgment call (recorded):** the row brief's deliverable line says
`redrive4/phase-grammar-contract.md`, but this is the FIFTH redrive of this rung — the constraint
binding this task is `Work only within: docs/reference/evidence/phase-grammar-2026-08-14/redrive5/**`
and the redrive wavefile keys (rd2/rd3/rd4) show each redrive writes into its own subdirectory.
The `redrive4/` path in the brief is a stale copy artifact. **This contract is written to
`redrive5/phase-grammar-contract.md`** per the authoritative constraint. The redrive2/3/4 dirs hold
only brief copies, no prior deliverable to supersede.

**Shared-publish refusal (recorded):** the brief's deliverable clause allows "the shared publish —
or the recorded refusal." The #158 shared-partition append verb IS landed
(`run.scratchpad.append`, `application-semantics.mjs:1710`; the D1 write law,
`scratchpad-write-2026-08-13/contract-fold.md`), so a shared publish is technically reachable
today — but it is **refused here**: (a) this worker has no run-facing `baton` facade surfaced in
its tool set (the wavefile's own shared publish is the coordinator's act, delivered as
`phase-qa.md`, not the contract row's); (b) the scope constraint confines this row to
`redrive5/**`; (c) the contract row's deliverable is the document ONLY per the brief. The
campaign-level shared publish is the coordinator's responsibility (coordinator-brief, `phase-qa.md`).

---

## 1. GROUND TRUTHS (re-verified this session)

**G1 — The #170 DSL is closed, total, and one-wave-per-spec; the phase rung extends it ADDITIVELY,
never by weakening.** The compiler `impl/src/workflow-dsl.mjs` owns a 16-directive closed registry
(`WAVEFILE_DIRECTIVES`, `:39-56`) that lowers to the interpreter's closed spec
(`workflow-interpreter.mjs` `admitSpec`, `:134-166`) — `SPEC_FIELDS` `:51`, `MEMBER_FIELDS` `:52`,
`EXACT_FIELDS` `:53`, `STEERING_FIELDS` `:54-57`. The compiler is a pure function of the text given
`repoRoot` (no eval, no Function, no dynamic import, no file reads; the only syscall is the
repoRoot-gated harvest realpath containment, `workflow-dsl.mjs:15,178-204,453-524`). Every refusal
carries the #160 `{line, field, expected}` triple on the error AND the wire `detail` leg
(`workflow-dsl.mjs:70-74`). The emitted JSON is byte-for-byte what `admitSpec` accepts
(`workflow-dsl.mjs:517-523`; the round-trip pin in the #170 suite). **The phase grammar must
preserve all of this for every existing wavefile** — a wavefile with no `phase` directive compiles
EXACTLY as today (v1 spec), and every existing DSL/workflow suite stays green.

**G2 — The interpreter's closed spec is schemaVersion-1-only today; the phase rung extends the
interpreter (both impl rows own their files).** `admitSpec` refuses any `schemaVersion` other than
`1` (`workflow-interpreter.mjs:142`), any unknown top-level field (`:139-141`), and requires
`members` non-empty (`:146-147`). The row-impl-interpreter brief binds the interpreter row to
implement phase sequencing, outcome extraction, checkpoint phases, and mid-flight amendment IN
`impl/src/workflow-interpreter.mjs`. **Therefore the phase rung is a deliberate, named EXTENSION of
the interpreter's closed spec — the DSL no longer lowers only to v1; it gains a v2 phase-bearing
spec shape.** This is the one place the "lowers TO, does not extend" law from #170 is amended, by
the row brief's own authority: the interpreter's `admitSpec` grows a v2 branch while the v1 branch
stays byte-identical.

**G3 — The decision/attention machinery the checkpoint phase must ride is real and anchored.** The
interpreter already reads `answer_decision` attention items (`workflow-interpreter.mjs:846`),
matches them against the `answerDecisions` policy (`matchDecision`, `:535-544`), answers via
`handle.answer(requestId, {text})` / `{optionId}` (`:1038,1058`), reads `turn_checkpoint` attention
(`:860`), nudges/claims via `handle.act('nudge_turn', …)` / `('claim_turn', …)` (`:1080-1087`), and
sends via `run.message.send` (`:925,995`). The lane-proof foundry proved the DECISION_REQUEST
policy-answer and defer-park lanes live (`lane-proof-2026-08-13/lane-decision.md`,
`landing-note.md`). **A checkpoint phase parks the drive and mints its packet through THIS
machinery — no new transport, no new kernel seam.**

**G4 — #158 (shared partition write) is LANDED; #102 (tight cell) is NOT LANDED — the coupling
preconditions are asymmetric and must be stated honestly.** The shared scratchpad APPEND verb is
deployed (`feat(#158)`, `run.scratchpad.append` registry row `application-semantics.mjs:1710`; the
append restrictor + `scratchpad_write_invalid` in `coordination-store.mjs:14230-14238`). The #158
write law: a member principal may append to `worker:<ownId>` + `shared` of its OWN run;
cross-partition/cross-run writes refuse `application_unauthorized`; the review authority appends
`shared` only (`scratchpad-write-2026-08-13/contract-fold.md:160-230`). So **`shared` coupling is
expressible and drivable NOW** via the landed append verb. The tight cell (#102) is a CONTRACT with
a red-first suite (`impl/test/tight-cell-red.test.mjs`) that is **9 pass / 30 fail at HEAD
(re-verified this session)** — the cell substrate (quorum aggregate, cell spawn branch, shared-tree
capture) is NOT landed. The #158 fold itself notes its shared-tier write shape (D-depth-2) is
gated on the unlanded tight-cell kernel (`contract-fold.md:133-139`, fold item 12). **Therefore
`tight` coupling must COMPILE and the drive must REFUSE it with a typed precondition, never
silently drop to loose.**

**G5 — #163's no-clock law governs every phase transition.** The drive settles on terminality,
handled-decision stuck, or observed quiescence — never elapsed time. A numeric `hardCapMs` refuses
at admission (`workflow-interpreter.mjs:426-428`); the quiescence predicate derives the window from
the roster's own cadence (`:948-970`). Phase sequencing, checkpoint parking, and amendment resume
inherit this: a phase waits on its `when:` outcome and its members' settle via quiescence, never a
clock.

**G6 — The wave's identity is its idempotency key, and the wave base-commit machinery is the
amendment's substrate.** The interpreter writes the base commit for the spec's key
(`workflow-interpreter.mjs:595-603`; the base-commit line, `lifecycle-contracts-2026-08-14/row-lc-fs.md:5`
cites `:525`). #183's recorded law: the spec `idempotencyKey` IS the wave identity — a same-key
re-drive replays the failed wave. **Mid-flight amendment must therefore be a NEW admission under a
phase-revisioned identity that RESUMES from the settled ledger, not a same-key replay.**

**G7 — The suite home and named-stage conventions are established.** The phase rung's suite is
`impl/test/workflow-phases-red.test.mjs` (new; named in the row-suite brief), RED at HEAD at named
stages (the stage-name convention of the DSL suites, `workflow-dsl-red.test.mjs:112,270-…`). At
HEAD a wavefile carrying a `phase` directive refuses `workflow_spec_invalid` unknown-directive
(no `phase` in `WAVEFILE_DIRECTIVES`), and the interpreter's `admitSpec` refuses a `phases` field
as unknown — those are the reds the impl turns green. Adjacent green at HEAD re-verified:
`workflow-dsl-red.test.mjs` 35/35, `workflow-as-data-red.test.mjs` 30/30, `workflow-dsl-package-red.test.mjs`
12/12 (the #170 package), `tight-cell-red.test.mjs` 9/30 (red by design).

---

## 2. DECISIONS

### D1 — Phase syntax: the `phase <name>` block in the line grammar

**The grammar grows FOUR new directives — `phase`, `when`, `outcome`, `couple` — plus the
`checkpoint` phase-kind modifier. Closed, additive, position-resolved like the #170 placement
rules.** A wavefile is now: `wave <key>`, optional wave-level `scope` defaults (unchanged, before
the first `phase`), then a sequence of `phase <name>` blocks. A block holds member directives
(exactly today's `member`/`harness`/`model`/`effort`/`scope`/`objectiveRef`/`report`), the phase
`when`, per-member or phase `couple`, and the phase's `outcome` declarations.

**Directive table (additions to `WAVEFILE_DIRECTIVES`):**

| Directive | Arity | Token shapes | Lowers to (closed semantics) |
|---|---|---|---|
| `phase <name>` | 1 | `<name>` one token — identifier `[A-Za-z0-9][A-Za-z0-9._-]{0,63}` | opens a phase block; phase `name` (unique across the file) |
| `when <phase>.<name> == "<value>"` | 3 | `<phase>.<name>` one token; `==` or `!=` one token; `"<value>"` one string | phase predicate over a PRIOR phase's outcome (D3) |
| `outcome <name> from <path> line "<pattern>"` | 5 | `<name>` identifier; `from`; `<path>` one token; `line`; `"<pattern>"` one string | phase outcome extraction (D2) |
| `couple <kind>` | 1 | `<kind>` ∈ `{loose, shared, tight}` | phase default (before a member) or per-member coupling override (inside a member) |
| `phase <name> checkpoint` | 2 | `checkpoint` after the name | marks the phase kind as orchestrator-checkpoint (D4) |

**Placement rules (the two new context-sensitive cases, resolved positionally and honestly):**

- `phase <name>` **closes the current member AND the current phase**, then opens the named phase.
  The first `phase` MUST follow `wave <key>` (the first-directive-must-be-`wave` law is unchanged).
  A `phase` before the first member-bearing phase that names no prior phase is the file's first
  phase — it is also where wave-level `scope` defaults stop accumulating (a `scope` after the first
  `phase` while no member is open refuses, exactly like today's post-last-member `scope`).
- `couple <kind>` resolves by position: **inside an open member** it is that member's coupling
  override; **inside a phase with no open member** it is the phase default. `couple` with no open
  phase refuses. A member with no `couple` inherits the phase default; a phase with no `couple`
  defaults to `loose` (D5).
- `when` appears ONCE per phase, after the `phase` line and before that phase's first `member`
  (a `when` after the first `member` refuses — the gate is a phase property, not a member one; it
  closes any open member the way steering directives do). A phase with no `when` is unconditional.
- `outcome <name>` appears inside a phase (any position; closes the open member). The referenced
  `<path>` must be in the repo path class (the same validator as member scope / harvest,
  `workflow-dsl.mjs:206-232`) and must name a path this phase's members can harvest — a member
  `report` path or a phase `harvest` path (cross-phase path references refuse at compile: a phase
  can only extract from ITS OWN harvest — this is the "never a prose read" honesty boundary).
  Outcome names are unique within the phase.

**Block transition (additive to the #170 rule):** a line whose first token is `phase`, `when`,
`outcome`, `couple`-at-phase-level, `harvest`, or any steering directive closes the open member; a
`phase` line additionally closes the open phase. End of file closes the open member and the open
phase. The member sub-field set is unchanged.

**Compile-time validation mirrors the interpreter's v2 admit (D6/D7), the round-trip law holds:**
`admitSpec(compilePhaseFile(text, { repoRoot }), repoRoot)` does not throw and canonicalizes
identically. The existing `compileWavefile` entry stays byte-compatible for phase-less files; the
phase compile is the same function reaching the v2 branch when a `phase` directive is present
(the sniffing/compile seam, `waves compile`, is unchanged — a phase wavefile is still a wavefile).

### D2 — Phase outcomes as first-class values (declared extraction, never a prose read)

**`outcome <name> from <path> line "<pattern>"` declares a phase-level outcome.** At phase settle,
the interpreter reads the harvested `<path>` (a regular file recovered from the phase's
authoritative result sha — the D4 harvest mechanism, `workflow-interpreter.mjs:741-790`), applies
`"<pattern>"` line-by-line, and binds `name` to the FIRST line's capture group 1.

- The pattern is a **JS regex literal with EXACTLY ONE capture group** — `new RegExp(pattern)` at
  compile (closed escape set: the tokenizer's `\" \\ \n \t \uXXXX`; the pattern is a
  double-quoted string token). A pattern with zero or 2+ groups refuses `workflow_outcome_invalid`
  (`expected: 'pattern with exactly one capture group'`). The value bound is capture group 1's
  content, trimmed of leading/trailing whitespace.
- The extraction applies the regex to each physical line of the harvested file, in order; the FIRST
  match binds. A line is the file's `\n`-split physical line (no continuation magic in harvest
  content — it is DATA, not grammar).
- **No match at settle** is not a silent null: the phase settles with the outcome MISSING and the
  drive emits `workflow_outcome_miss` naming the phase and outcome (a harvest-miss sibling — the
  phase did not produce what it declared). A `when:` referencing a missed outcome therefore never
  evaluates — the gate is unsatisfiable, which is a typed condition (D3).
- **The outcome value is a string.** Equality/negation compare the trimmed group against the
  `when:` literal verbatim. There is no numeric coercion, no eval, no glob — the value is data.
- **Cross-phase reference is phase-qualified:** a later phase's `when:` names `<phase>.<name>` (e.g.
  `ground.verdict`). An unqualified name, or a name referencing a LATER phase or the current phase,
  refuses at compile (`workflow_gate_invalid`).

### D3 — Conditional gating: `when`, closed predicate vocabulary, no eval

**The predicate vocabulary is CLOSED and total over exactly two operators:**

```
when <phase>.<name> == "<value>"
when <phase>.<name> != "<value>"
```

- `<phase>.<name>` is a prior phase's declared outcome (D2). `<value>` is a double-quoted string.
- `==` binds true iff the outcome exists AND its value equals `<value>`. `!=` binds true iff the
  outcome exists AND its value differs. **An outcome that missed (D2) makes BOTH operators
  false** — a missed outcome is a typed condition, never coerced.
- **Anything else refuses `workflow_gate_invalid`** at parse time: a third operator, a bare
  reference, `and`/`or`/`not` composition, a parenthesized expression, an unquoted value, a
  reference to the current or a later phase. The refusal names `field: 'when'` and the `expected`
  leg is `'<phase>.<name> == "<value>" | <phase>.<name> != "<value>"'`. There is NO evaluator —
  the compiler lowers the predicate to a `{op, phase, outcome, value}` triple and the interpreter
  compares strings.
- **Drive-time semantics (the gate is a sequencing precondition, not a skip):** when a phase's
  `when:` is present and evaluates FALSE (or references a missed outcome), the phase is NOT
  admitted and the drive emits `workflow_gate_unsatisfied` naming the phase and the comparison —
  the campaign PARKS at that phase boundary for the operator. The machine never decides "this phase
  does not matter" — that is a judgment call, and judgment belongs to checkpoints (D4, D6b).
  **The two-phase end-to-end pin is exactly this positive path:** phase A produces the outcome,
  phase B's `when:` evaluates true, phase B's member is admitted and starts.
- **No arbitrary numeric limits** are introduced by gating: a `when:` references one prior outcome;
  a phase has at most one `when`. There is no predicate-count cap beyond the closed grammar.

### D4 — Orchestrator checkpoints as a phase kind

**`phase <name> checkpoint` marks a checkpoint phase.** It carries NO members — only the decision
packet. It parks the campaign, delivers the packet upward through the EXISTING decision/attention
machinery (G3), and resumes on the orchestrator's answer. The packet is declared inline:

```
phase hold checkpoint
  question "Approve the ground-truth ledger before spec? "
  option approve "approve the ledger as-is"
  option amend "amend then re-ground"
```

**Compiled shape:** the phase carries `{ kind: 'checkpoint', question, options: [{id, label}], allowFreeResponse }`.
The interpreter, on reaching an unconditional (or `when:`-satisfied) checkpoint phase:

1. **Parks the drive** — the drive loop enters a checkpoint-park state; no member is spawned, the
   quiescence clock does not run against the phase (there is no roster to quiesce). The park is
   recorded in the steering trail (`{ trigger: 'phase_checkpoint', phase, park: true }`).
2. **Mints the packet through the landed decision machinery**: the question/options are surfaced
   as an `answer_decision` attention item on the run view (the same kind the interpreter already
   reads at `workflow-interpreter.mjs:846`) — the top orchestrator sees it, exactly as the
   lane-proof foundry's DECISION_REQUEST policy-answer lanes did. **The interpreter must NOT
   auto-answer a checkpoint** (the `answerDecisions` policy is explicitly bypassed for checkpoint
   phases — auto-answering would defeat the park). The packet carries `requestId`, `question`,
   `options`, `allowFreeResponse`.
3. **Resumes on answer**: the orchestrator's answer via `handle.answer(requestId, …)` (the landed
   path, `workflow-interpreter.mjs:1038,1058`) resolves the park. The answered value — the chosen
   `optionId` or the free text — is bound as the phase's implicit outcome **`<name>.answer`**, so a
   LATER phase can gate on it (`when hold.answer == "approve"`). The resume emits
   `{ trigger: 'phase_checkpoint', phase, answered: <value> }` and the drive proceeds.
4. **No clock anywhere**: a checkpoint parks indefinitely until answered or the wave is stopped —
   the #163 law. A checkpoint with `when:` evaluates the gate FIRST; an unsatisfied gate parks the
   drive at the boundary (D3) without minting the packet.

**Honest boundary:** the `answer_decision` attention item is how the coordinator surfaces a
member's decision today; a checkpoint phase reuses that surface with the INTERPRETER as the packet
minter (no synthetic member). If the impl row finds the wave view cannot mint an attention item
without a backing run, it must STOP and DECISION_REQUEST (the checkpoint phase is the one new
interpreter mechanism that touches the run-view seam — the interpreter's own partition).

### D5 — Context couplings per phase per member (loose / shared / tight), preconditions stated

**Every phase and every member declares its context coupling: `loose` (default), `shared`, or
`tight`.** The phase default applies to every member without an override; a member `couple` wins.
The coupling is compiled into the member's admission as `member.coupling`.

| Coupling | Meaning | Precondition (stated honestly) |
|---|---|---|
| `loose` | members work in their own per-member worktrees; communication is by file refs in their scopes — the CURRENT wave model, byte-identical | **none** — always available |
| `shared` | the phase's members share the `shared` scratchpad partition of their run: each may append to `shared` (and read it) via the landed `run.scratchpad.append`/`.read` verbs | **#158 LANDED** — the append verb + restrictor exist (`application-semantics.mjs:1710`, `coordination-store.mjs:14230`). The D-depth-2 DIRECT shared-tier write shape (the tight-cell contract's, `tight-cell-contract.md:815-822`) is the UNLANDED #102 kernel — this rung's `shared` coupling means the LANDED append verb to `shared`, NOT that kernel. The #158 law's own-run predicate and `application_unauthorized` refusal for cross-partition writes apply unchanged. |
| `tight` | the phase's members are one tightly-coupled cell (one runId, one collective result, quorum — #102 semantics) | **#102 NOT LANDED** — the cell substrate is absent (tight-cell suite 9/30 at HEAD). **`tight` COMPILES but the drive REFUSES** with `workflow_coupling_unavailable` naming #102 as the precondition — it is never silently degraded to `loose`, and the compiler never drops it. |

**Compile-side:** `couple` is in the closed `{loose, shared, tight}` set; anything else refuses
`workflow_coupling_invalid` (`field: 'couple'`, `expected: 'loose|shared|tight'`). `shared` and
`tight` compile with the precondition notes above embedded in the compiled phase object
(`precondition: { id: 158, landed: true }` / `{ id: 102, landed: false }`) so the interpreter's
drive-time check is honest and auditable. **The suite pins both**: `shared` compiles AND drives
against a fake append surface; `tight` compiles and the DRIVE refuses with the typed code naming
#102.

### D6 — Mid-flight amendment + the brittleness guard

**D6a — Phase-addressed identity and the amendment resume.** Each phase is addressed by its
`name` (`phase:<name>`) in the compiled spec — the spec is diffable per phase. The interpreter
maintains a **settled-phase ledger** under the campaign key: for every settled phase it records the
phase name, its compiled content digest, and its outcome values. **Amendment** is a NEW admission
with a phase-revisioned identity (the campaign key + a revision suffix — never a same-key replay,
the #183 law): the interpreter compares each compiled phase against the ledger, and the first phase
whose content differs from the ledger is the RESUME point. **Every phase before it is NOT
re-driven — its outcomes are read from the ledger, never recomputed.** The base-commit machinery
(G6) provides the clean-tree substrate for the resumed phases.

- **Compiler duty:** the compiler must make the phase spec diffable — emit each phase's content as a
  stable object (name, kind, when, coupling, members, outcomes, harvest) so a later-phase edit
  changes ONLY that phase's digest. This is what the row-impl-compiler brief calls "phase-addressed
  identity."
- **Interpreter duty:** on admission with a ledger present, seed prior-phase outcomes from the
  ledger and resume from the first divergent phase (or from the first not-yet-settled phase if no
  content diverges — the pure continuation case).
- **The amendment boundary is enforced:** an edit to a phase EARLIER than the first settled phase —
  i.e., re-opening settled ground — refuses `workflow_amendment_invalid` (`field: 'phase <name>'`,
  `expected: 'a phase at or after the first unsettled phase'`). Amendment is forward-only.

**D6b — The brittleness guard: phases are templates; checkpoints carry judgment.** The
automation — outcome extraction, `when:` evaluation, coupling, sequencing — is deterministic,
closed, and eval-free. **Judgment (should we proceed, what is the answer) lives ONLY in checkpoint
phases and the orchestrator's answers.** Concretely:

- An unsatisfied `when:` never causes the drive to silently skip a phase — it parks with
  `workflow_gate_unsatisfied` (D3). Skipping work is a judgment call.
- An outcome that misses never invents a default — it is a typed `workflow_outcome_miss` (D2).
- A `tight` coupling never degrades to `loose` — it refuses with the named precondition (D5).
- A checkpoint's packet is never auto-answered by policy — the orchestrator's answer is the only
  resume (D4).
- The interpreter emits an evidence line for every gate/coupling/outcome/checkpoint judgment
  (`{ trigger: 'phase_*', … }`) so the campaign trail is reconstructable.

### D7 — The compiled v2 spec shape (the interpreter's admission target)

`compilePhaseFile(text, { repoRoot })` emits, for a file with at least one `phase` directive, a
**schemaVersion-2** spec:

```json
{
  "schemaVersion": 2,
  "idempotencyKey": "<wave key>",
  "phases": [
    {
      "name": "<phase>",
      "kind": "work" | "checkpoint",
      "when": null | { "op": "==" | "!=", "phase": "<prior>", "outcome": "<name>", "value": "<string>" },
      "coupling": "loose" | "shared" | "tight",
      "members": [
        {
          "role": "<role>",
          "exact": { "harness": "", "model": "", "effort": "" },
          "scope": ["<path>"],
          "objectiveRef": "<path>",
          "coupling": "loose" | "shared" | "tight",
          "precondition": null | { "id": 158, "landed": true } | { "id": 102, "landed": false }
        }
      ],
      "outcomes": [ { "name": "<name>", "path": "<path>", "pattern": "<regex>" } ],
      "harvest": { "paths": [] }
    }
  ],
  "steering": { /* v1 closed steering, unchanged */ }
}
```

- `schemaVersion: 2` marks a phase-bearing spec. `admitSpec` (interpreter) accepts BOTH: v1 (the
  existing flat shape, byte-unchanged — all existing suites) and v2 (this shape). A v2 spec has
  NO top-level `members` — the roster is per-phase. Top-level `steering` and `harvest` are unchanged
  (steering stays wave-level; harvest stays wave-level — the wave-level harvest reads the campaign's
  final deliverables across all phases).
- `checkpoint` phases carry `kind: 'checkpoint'` and `checkpoint: { question, options, allowFreeResponse }`
  instead of `members`/`outcomes`.
- The v1/v2 split is the ONE extension of the interpreter's closed spec (G2). Every other closed
  law — idempotency pattern, scope class, member shape, steering enums, harvest containment — is
  inherited unchanged.

---

## 3. REFUSAL VOCABULARY (closed, extended)

The phase rung EXTENDS the interpreter's `workflow_*` family (G5's allowlist preservation: every
new code is `workflow_*` prefixed, so the MCP prefix arm, `mcp-northbound.mjs:209-213`, preserves
it with no allowlist churn). The compiler emits exactly these interpreter-owned codes with the
`{line, field, expected}` triple (the #160 law); it never invents a compiler-specific code. **No
`workflow_compile_invalid` exists** (the DSL suite's PIN-B law holds).

| Code | Fires on | `field` leg | `expected` leg |
|---|---|---|---|
| `workflow_phase_invalid` | phase structure: duplicate phase name, phase before `wave`, member with no open phase, empty phase (no members and not checkpoint), `when`/`outcome`/`couple` with no open phase, `when` after a phase's first member, `outcome` path outside the repo class or not this phase's harvest | `phase <name>`; `phase`; `members` | `'member <role>'`, `'outcome <name> from <path> line <pattern>'`, `'checkpoint'`, `'non-empty phase'` |
| `workflow_gate_invalid` | `when:` outside the closed predicate vocabulary (third operator, bare reference, composition, unquoted value, unqualified or forward/current-phase outcome reference) | `when` | `'<phase>.<name> == "<value>" | <phase>.<name> != "<value>"'` |
| `workflow_gate_unsatisfied` | DRIVE-time: a phase's `when:` evaluates false (or references a missed outcome) — the phase is not admitted, the campaign parks | `phase <name>` | `'<phase>.<name> <op> "<value>" satisfied'` |
| `workflow_outcome_invalid` | outcome declaration: duplicate outcome name in the phase, pattern with zero/2+ capture groups, path not a member report or phase harvest path, bad pattern regex | `outcome <name>`; `outcome.pattern`; `outcome.path` | `'pattern with exactly one capture group'`, `'a report or harvest path of this phase'` |
| `workflow_outcome_miss` | DRIVE-time: a declared outcome's pattern matched no line in the harvested file at phase settle | `phase <name> outcome <name>` | `'a line matching the declared pattern'` |
| `workflow_coupling_invalid` | `couple <kind>` with `kind` ∉ `{loose, shared, tight}` | `couple` | `'loose|shared|tight'` |
| `workflow_coupling_unavailable` | DRIVE-time: a `tight` coupling (or any coupling whose precondition is not landed) is reached | `couple tight` | `'#102 landed'` (or the named precondition) |
| `workflow_checkpoint_invalid` | checkpoint phase shape: missing `question`, empty `options` with no `allowFreeResponse`, malformed `option <id> <label>` | `checkpoint`; `checkpoint.question`; `checkpoint.options` | `'question "<text>"'`, `'option <id> <label>'` |
| `workflow_amendment_invalid` | DRIVE-time: an amended admission edits a phase at or before the settled ledger's front | `phase <name>` | `'a phase at or after the first unsettled phase'` |

Sanitization follows the #41 law: a refusal message never quotes a refused argument value — it
names the field, the line, and the expected shape. The `workflow_*` family remains closed: these
nine are the rung's extension and the compiler/interpreter mint nothing else.

---

## 4. RED-FIRST ACCEPTANCE PINS

Suite home: **`impl/test/workflow-phases-red.test.mjs`** (new, this rung). Every row is RED at HEAD
at a NAMED stage — at HEAD a `phase` wavefile refuses `workflow_spec_invalid` unknown-directive
(the compiler has no `phase`) and the interpreter's `admitSpec` refuses a `phases` field — and
flips green on the implementation. The suite is hermetic: in-process fake harness, marker members,
no clocks, no absolute line-window anchors, `localeCompare` banned, namespace imports for invented
surfaces, `watchdog.stallMs: 60_000` with its comment.

**Green pins (behavioral):**

| Row | Assertion |
|---|---|
| P1 phase syntax | a two-phase wavefile compiles to a v2 spec: per-phase rosters, a role re-cast across phases is TWO distinct member admissions (phase-scoped uniqueness — the same role in phase A and phase B is legal), phase names unique, `couple` defaults apply |
| P2 outcome extraction | `outcome verdict from "x.md" line "^verdict: (.+)$"` extracts group-1's trimmed content from the harvested file at settle — declarative, never a prose read; a zero-group pattern refuses `workflow_outcome_invalid` |
| P3 when-gate closed vocabulary | `when ground.verdict == "pass"` compiles to the `{op, phase, outcome, value}` triple; `when ground.verdict` (bare), `when ground.verdict > "pass"`, `when ground.verdict == "a" and other.verdict == "b"` ALL refuse `workflow_gate_invalid`; no eval surface exists (source pin) |
| P4 TWO-PHASE END-TO-END | phase A: one marker member writes `demo-a-outcome.md` carrying a `verdict: pass` line; phase B `when demo-a.verdict == "pass"`: one marker member writes `demo-b-ran.md`. **Drive with marker members: the store/event order proves phase B's member STARTED only after phase A's outcome satisfied its `when:`** (the pin the coordinator brief's live demo mirrors) |
| P5 gate-unsatisfied parks | the same two-phase shape with A writing `verdict: fail` → B is NOT admitted, the drive emits `workflow_gate_unsatisfied` naming `phase B` and the comparison, the campaign parks (no clock — a typed park, asserted by state not time) |
| P6 checkpoint phase | `phase hold checkpoint` parks the drive, surfaces the `answer_decision` packet (question/options/allowFreeResponse) through the fake run view, and resumes on `handle.answer` — the answer binds `hold.answer` and a later `when hold.answer == "approve"` admits the next phase; a checkpoint with no question refuses `workflow_checkpoint_invalid` |
| P7 mid-flight amendment | an amended LATER phase (phase C edited, phase B untouched) resumes from phase C WITHOUT re-driving phase A/B — settled outcomes are read from the ledger, never recomputed (assert: the ledger read count is exact, no re-execution of A/B markers); editing a SETTLED phase refuses `workflow_amendment_invalid` |
| P8 couplings | `couple loose` is the default and drives byte-identical to today; `couple shared` compiles and drives against a fake `run.scratchpad.append`/`.read` (own-run + `shared`; cross-partition refuses `application_unauthorized` — the #158 law); `couple tight` compiles and the DRIVE refuses `workflow_coupling_unavailable` naming #102 (never silently loose) |
| P9 v1 backward-compat | every existing green wavefile (the DSL suite's Appendix A + the foundry fixture) compiles through the phase entry to a v1 spec, byte-identical to today; `admitSpec` v1 branch is byte-unchanged |

**Red pins (refusal-shape):**

| Row | Refusal |
|---|---|
| R1 | `phase 0x` (duplicate name) → `workflow_phase_invalid {line, field: 'phase <name>', expected: 'unique phase name'}` |
| R2 | `when current.own == "x"` (current-phase reference) → `workflow_gate_invalid {line, field: 'when', expected: '<phase>.<name> == "<value>" | … != "<value>"'}` |
| R3 | `outcome o from "a.md" line "plain"` (zero capture groups) → `workflow_outcome_invalid {line, field: 'outcome.pattern', expected: 'pattern with exactly one capture group'}` |
| R4 | `couple telepathic` → `workflow_coupling_invalid {line, field: 'couple', expected: 'loose|shared|tight'}` |
| R5 | `phase hold checkpoint` with no `question` → `workflow_checkpoint_invalid {line, field: 'checkpoint.question', expected: 'question "<text>"'}` |
| R6 | HEAD red: a wavefile with a `phase` directive refuses `workflow_spec_invalid` unknown-directive today; the interpreter refuses a `phases` field — both flip green on the impl |

**Static pins:**

- **S1 (no eval)** — a source scan asserts the compiler's `when`-lowering contains no
  `eval(`/`new Function`/`Function(` and no dynamic regex-from-user-pattern beyond the compiled
  `outcome.pattern` literal; the drive's gate compare is a string equality, never a predicate
  evaluator.
- **S2 (closed family)** — the interpreter mints EXACTLY the five v1 codes plus the nine v2 codes in
  §3, and nothing else; a negative scan asserts no `workflow_compile_invalid` exists anywhere.
- **S3 (v1/v2 split)** — `admitSpec`'s v1 branch is byte-identical to HEAD's (a source-scan or
  round-trip over the committed Appendix A fixture); the v2 branch is additive.
- **S4 (round-trip)** — for every green-pin wavefile: `admitSpec(compilePhaseFile(text, { repoRoot }), repoRoot)`
  does not throw and canonicalizes identically; a v2 spec never carries a top-level `members` field
  and always carries a non-empty `phases` array.

**Adjacents that must stay green (paste counts in the impl notes):** `workflow-dsl-red` 35/35,
`workflow-as-data-red` 30/30, `workflow-dsl-package-red` 12/12, plus `node impl/scripts/surface-conformance.mjs`
→ `surface-conformance: ok`.

---

## 5. OPEN QUESTIONS

**OQ1 — The checkpoint packet surface (authority-class, named).** The contract routes the
checkpoint packet through the existing `answer_decision` attention item with the interpreter as
minter. If the wave view (G3) cannot mint an attention item without a backing run, the interpreter
row must STOP and DECISION_REQUEST with options (a: mint via the run view with a synthetic
packet-id; b: mint via `run.message.send` to the coordinator; c: park on the store's
decision-ledger event). **Recommendation: (a)** — it is the only option that reuses the landed
`answer`/`answer_decision` path verbatim.

**OQ2 — Steering scope.** Top-level `steering` stays wave-level (applies to every phase's drive),
matching #170's no-deeper-inheritance doctrine. Per-phase steering is a NAMED future extension, not
this rung. Confirm the wave-level inheritance is acceptable for the pipeline (a phase that needs a
different nudge/elevate policy is a separate campaign wave).

**OQ3 — Harvest scope.** The wave-level `harvest` reads the campaign's final deliverables across all
phases; per-phase `outcome` extraction uses the phase's OWN harvest (D2). A phase harvest that is
not also wave-level is a judgment call: the phase's outcomes must be readable at settle (they are —
from the phase's recovered sha). Confirm the phase-harvest paths do not also need to be wave-level
paths in v1.

**OQ4 — The `checkpoint` answer as an implicit outcome.** The checkpoint binds `<name>.answer`
(D4). An explicit `outcome <name> from …` inside a checkpoint phase is refused (checkpoints have no
members/harvest). Confirm the implicit `.answer` outcome is sufficient for gating on checkpoints; a
named alternative is a future extension.

**OQ5 — Coupling precondition data.** The compiled member carries
`precondition: {id, landed}` (D7) — a mirror of the deployment truth. The deployment truth's source
of record (which coupling preconditions are actually landed) should be a single shared constants
module (the S5 idiom from #170), not duplicated literals. Confirm the impl may create that module;
otherwise the source-scan pin (S4) asserts the mirror.

**OQ6 — Amendment identity spelling.** The amendment identity is the campaign key + a revision
suffix (D6a). The exact suffix grammar (e.g. `-rd2`, `-rev2`) is the interpreter row's choice within
the `IDEMPOTENCY_PATTERN`; confirm a suffix form is acceptable rather than a fresh key per phase.

---

## 6. JUDGMENT CALLS (recorded)

1. **Deliverable path redrive4 → redrive5** (this is the 5th redrive; the constraint overrides the
   stale brief copy).
2. **v1/v2 spec split** (G2, D7): the phase rung extends the interpreter's closed spec by a
   schemaVersion-2 branch, because the row-impl-interpreter brief explicitly owns
   `impl/src/workflow-interpreter.mjs`. The v1 branch is byte-unchanged — the "lowers TO, does not
   extend" law is amended only where the row brief's authority requires it.
3. **Gate-unsatisfied = park, not skip** (D3/D6b): skipping is a judgment call; the brittleness
   guard keeps judgment in checkpoints.
4. **`tight` compiles but refuses at drive** (D5): the honest handling of the unlanded #102 — never
   silently degrade.
5. **`shared` rides the LANDED #158 append verb** (D5): the D-depth-2 direct shared-write kernel
   (#102) is NOT required for this rung's `shared` coupling, and the contract says so explicitly.
6. **Shared-publish refusal recorded** (header): out of scope for the contract row; the
   coordinator's `phase-qa.md` is the campaign's shared deliverable.

No authority-class ambiguity arose that was not resolved by a row brief or a recorded judgment;
OQ1 carries the one named escalation path if the interpreter row's seam check fails.
