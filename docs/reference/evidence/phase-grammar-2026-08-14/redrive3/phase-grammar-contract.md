[attempt: 9c4144b5-1c4e-42a1-a742-47d2cd1930b0 row-contract]
# Phase-grammar implementation contract — the campaign-level (phase) grammar over the #170 wavefile DSL

Date: 2026-08-14. Status: contract for implementation (v1). Ring-2 form: ground truths → decisions →
closed refusal vocabulary → red-first acceptance pins → open questions.

**Primary inputs.** The operator's north-star directive (carried by the #170 brief and re-stated in
the row-contract brief): *"a scripted-dynamic workflow through the baton surface — a DSL or literally
anything better than this one-off ad-hoc."* Today the #170 wavefile expresses **ONE wave per spec**;
this rung expresses the **phase level** — an entire methodology pipeline (`ground → spec → red-team →
suite → blue-team → remediate → impl → validate → return-to-orchestrator`) as **ONE dynamic workflow
script**, authored in the same line-oriented grammar. The current grammar + interpreter are
`impl/src/workflow-dsl.mjs` (the compiler) and `impl/src/workflow-interpreter.mjs` (the drive loop),
both read in full this session. NUL discipline applies to `application.mjs` and
`coordination-store.mjs` (`grep -an`/`sed -n` only); they are cited below from prior verified anchors,
not re-opened whole.

**The contract in one sentence.** A **phase file** extends the wavefile grammar with a `phase <name>`
block and five phase-level directives (`when`, `outcome`, `coupling`, `ask`, `option`); it compiles to
a **new schemaVersion-2 phase spec** whose every phase lowers to a schemaVersion-1 wave that the
existing `admitSpec`/`runWorkflow` path drives **unchanged**; a **new phase driver** (the campaign
branch of `runWorkflow`) sequences those waves, extracts declared outcomes from each phase's
authoritative harvest, gates the next phase on a **closed** `when:` predicate, parks at **checkpoint**
phases on the existing decision machinery, and re-drives from the first unsettled phase on
**mid-flight amendment** — never re-driving a settled phase.

---

## 1. GROUND TRUTHS (re-verified this session)

**G1 — Today the DSL is ONE wave per spec; the compiler is a pure 16-directive grammar.** The wavefile
compiler (`impl/src/workflow-dsl.mjs`) is a pure function of the text given `repoRoot`: 16 closed
directives (`WAVEFILE_DIRECTIVES`, `workflow-dsl.mjs:39-56`) lowering to the interpreter's closed
field set (`SPEC_FIELDS`/`MEMBER_FIELDS`/`EXACT_FIELDS`/`STEERING_FIELDS`,
`workflow-interpreter.mjs:48-54`). Every refusal carries the #160 `{line, field, expected}` triple on
the error AND the wire `detail` leg. The emitted IR is `schemaVersion: 1` with the five keys
`{schemaVersion, idempotencyKey, members, steering, harvest}` (`workflow-dsl.mjs:517-523`). The
compiler is self-contained (node builtins only) and importing it runs nothing. There is **no phase
concept** anywhere in either module today (verified: zero `phase`/`outcome`/`coupling`/`when` matches
in `workflow-dsl.mjs` and `workflow-interpreter.mjs`).

**G2 — The interpreter is the single-wave drive loop, and it is the composition substrate.** `runWorkflow`
(`workflow-interpreter.mjs:497-665`) validates (`admitSpec`, `:131-163`), renders objectives with a
minted salt (`renderObjective`, `:333-348`; `const salt = randomUUID()` `:521`), commits a clean base
(`:537-541`), starts the wave (`baton.waves.start`, `:549`), drives it to settle (`driveLane`,
`:726-808`), harvests (`harvestOne`, `:667-706`), and returns the seven-key receipt
`{basis, harvest, manifestDigest, outcomes, steering, verdict, waveId}` (`:633-641`). **This is the
substrate the phase driver composes per phase — it does not reimplement the drive loop.**

**G3 — The decision/attention machinery the checkpoint rides already exists, in two closed lanes.**
(a) *Decision lane*: a member's `answer_decision` attention (`workflow-interpreter.mjs:759`) is matched
against the `answerDecisions` steering policy (`matchDecision` `:482-491`) and answered via
`handle.answer(requestId, {optionId|text})` (`answerDecision` `:852-901`). (b) *Checkpoint lane*: a
member's `turn_checkpoint` attention (`:773`) is nudged via `handle.act('nudge_turn', …)` and claimed
via `handle.act('claim_turn', …)` (`handleCheckpoint` `:903-922`). Both are per-member, read from the
run view (`readView` `:442-476`). The checkpoint phase parks the CAMPAIGN and delivers its packet
through this machinery — the packet is a decision (`answer_decision` shape) on the phase's own wave, and
the orchestrator's existing `run.answer` seam is the resume trigger.

**G4 — Idempotency identity is per-wave and the key pattern admits derived keys (#168).** Each wave's
idempotency key is the `idempotencyKey` admitted at `admitSpec` (`:140-142`, `IDEMPOTENCY_PATTERN`
`/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u` `:46`), and the base commit is
`baton workflow base ${spec.idempotencyKey}` (`:539-540` — the "base-commit machinery" of #168; note
the `:525` anchor in the impl brief is the salt line, not the base commit, off by ~15 lines). The
pattern admits `.`/`:`/`-`, so **per-phase keys derived as `<campaignKey>.<phaseName>` are valid
identifiers** and give each phase its own wave-commit + dedupe identity (the #183
`wave_already_terminal` re-key law). A phase driver must therefore NEVER re-`waves.start` a settled
phase under the same derived key — it reads the settled receipt instead (Decision 8).

**G5 — The #158 shared-partition precondition.** The shared scratchpad tier has no write/append verb on
any agent-facing surface today — proven live by the #147 dogfood (the cli row could not publish its
report to `shared`). The READ law landed (D1.2: a worker reads `worker:<ownId>` + `shared` + review
authority + wave grants); the WRITE law is #158, not landed. A `shared` coupling is therefore a
DECLARED coupling whose cross-member shared-tier WRITES are the #158 dependency (Decision 7).

**G6 — The #102 tight-cell precondition.** A "tight" coupling is the cell: N same-seat agents bound as
ONE wave member, one `runId`, one run-scoped horizon (`tight-cell-contract.md` v1.2). It is named as
**kernel work** (the run-status builder must aggregate over all plan nodes before quorum/terminal
semantics exist — `tight-cell-contract.md` Decision 6) and is **not landed**. A `tight` coupling is a
DECLARED coupling whose realization is the #102 dependency (Decision 7).

**G7 — The closed refusal family + the #160 triple + the wire arm.** The closed `workflow_*` family is
exactly five codes (`workflow-interpreter.mjs:29-33`). MCP preserves the family typed via the
pre-TypeError `workflow_*` prefix arm (`mcp-northbound.mjs:209-213`) and attaches the triple via
`LANE_CRAFTED` (`:1651-1654`, forwards `cause?.detail`). The `workflow_*` prefix is a PREFIX match, so
new `workflow_phase_*` codes ride the same arm with **no allowlist change** (the same G5 argument as
#170). The web side still destroys bare `workflow_*` TypeErrors (the #160 R3 dependency, same as #170's
P10).

**G8 — The #163 evidence-gates law.** The drive-to-settle loop is quiescence-derived; the only wall
clock is the DRIVER OPTION `hardCapMs` (`normalizeDriver` `:414-422`), which is an invocation option,
never spec vocabulary. The phase driver therefore introduces **no new wall-clock cap**: phase
sequencing is gated on settle + outcome + answer evidence, never elapsed time.

---

## 2. DECISIONS

### D1 — Architecture: phases are a new schemaVersion-2 spec composed of waves

**The phase layer composes the wave layer; it does not extend the closed wave spec.** `admitSpec`
(schemaVersion 1) is **byte-unchanged**. A phase file compiles to a **phase spec** with
`schemaVersion: 2` (a new closed-enum value), validated by a **new `admitPhaseSpec`**, and driven by a
**new campaign branch** of `runWorkflow`. The discriminator is `schemaVersion`, the existing closed
enum: `1` → the single-wave path (unchanged); `2` → the campaign path (new). The surface sniffing rule
(#170 D2) is unchanged — first non-whitespace character `{` → JSON, else compile; the schemaVersion in
the emitted IR is the wave-vs-campaign discriminator, never a content heuristic.

**Each phase lowers to a schemaVersion-1 wave the existing path drives verbatim.** When the campaign
driver reaches phase N, it builds a wave IR from phase N's template (`{schemaVersion: 1, idempotencyKey:
<derived>, members: […], steering: […], harvest: […]}`) and invokes the EXISTING single-wave
`runWorkflow` (or, equivalently, the existing start→driveLane→harvest→receipt path) with a derived
idempotency key. The phase driver owns ONLY: (a) the phase sequence, (b) outcome extraction from the
phase receipt, (c) `when:` evaluation, (d) checkpoint park/resume, (e) the settled-phase ledger for
amendment. It reuses `driveLane`, `harvestOne`, `materializeSha`, and `renderObjective` untouched.

**File partition.** The compiler row (`workflow-dsl.mjs`) owns the phase grammar + `compileWavefile`'s
phase branch + the `admitPhaseSpec`-mirroring compile-side validation. The interpreter row
(`workflow-interpreter.mjs`) owns `admitPhaseSpec` + the campaign branch of `runWorkflow`. The shared
interface between them — the phase-spec shape (D3), the derived-key rule (D3), and the three new
refusal codes (§3) — is pinned here so neither impl can drift; the #170 S5 lesson applies: the new
codes and phase-spec field names are shared constants or source-scanned.

### D2 — The phase line grammar (directives, placement, block-by-transition)

The phase file **extends** the wavefile grammar. The wavefile grammar stays byte-identical for
single-wave files; a file containing any `phase` directive is a **campaign file**. The lexical layer
(logical lines, continuation, comments, string tokens, the `#` trailing-comment refusal) is **unchanged**
from #170 D1.

**New directive vocabulary (5 new directives; the 16 existing directives are reused unchanged inside a
phase).**

| Directive | Arity | Token shapes | Lowers to |
|---|---|---|---|
| `phase <name>` | 1 | `<name>` one token (may be quoted) | open a phase block (kind `member`) |
| `phase <name> checkpoint` | 2 | `<name>` + literal `checkpoint` | open a phase block (kind `checkpoint`) |
| `when <name>` | 1 | `<name>` one token | phase gate: presence (D5) |
| `when <name> = "<literal>"` | 3 | `<name>`, `=`, one string | phase gate: equality (D5) |
| `when <name> != "<literal>"` | 3 | `<name>`, `!=`, one string | phase gate: negation (D5) |
| `when not <name>` | 2 | `not`, `<name>` | phase gate: absence (D5) |
| `outcome <name> from <path> line "<pattern>"` | 5 | `<name>`, `from`, `<path>`, `line`, one string | phase outcome declaration (D4) |
| `coupling <role> loose\|shared\|tight` | 2 | `<role>` one token; one of `loose\|shared\|tight` | per-phase-per-member coupling (D7) |
| `ask "<question>"` | 1 | one string | checkpoint packet question (D6) |
| `option <id> "<label>"` | 2 | `<id>` one token; one string | checkpoint packet option (D6) |

**Placement rules (keyword-first, block-by-transition, the existing idiom generalized).**

- `wave <key>` is the first directive in BOTH forms (the campaign idempotency key; in the single-wave
  form it is also the wave key). The first directive must still be `wave <key>` (unchanged).
- `phase <name>` opens a phase block; it closes any open phase and its open member. `member <role>`
  inside a phase opens a member block (closing any open member); `member` OUTSIDE any phase is the
  single-wave (wavefile) path — a campaign file with both top-level `member` blocks AND `phase` blocks
  refuses (`workflow_phase_invalid`, `expected: 'phase|member'`): a file is either single-wave or
  multi-phase, never both.
- `when`/`outcome`/`coupling`/`ask`/`option` are **phase-level** directives: they close any open member
  and apply to the open phase. Any of them with NO open phase refuses (`workflow_phase_invalid`,
  `expected: 'phase <name>'`). `ask`/`option` additionally require the open phase's kind to be
  `checkpoint` (else `workflow_phase_invalid`, `expected: 'checkpoint'`).
- The existing steering directives (`approveOnAdvertisedPlan` … `signalOnMembersDone`) and `harvest`
  are **positional**: before the first `phase` they are **campaign-level defaults**; inside a phase they
  are **per-phase**. `harvest` inside a phase declares that phase's harvest; `harvest` before the first
  `phase` (single-wave form) is the wave's harvest. The member sub-fields (`harness`/`model`/`effort`/
  `objectiveRef`/`report`/member-`scope`) are unchanged and valid only inside an open member.
- **Roles are unique WITHIN a phase** (matching `admitSpec`'s per-wave uniqueness); the SAME role string
  may re-appear in a LATER phase (a re-cast — Decision 2 below). The campaign identity of a member is
  `<phase>.<role>`; the per-phase wave keeps the bare `<role>`.
- **Outcome names are campaign-unique** (D4): a duplicate `outcome <name>` in any later phase refuses.
- **`when` may only name a PRIOR phase's declared outcome** (D5): a `when` in the first phase, or naming
  an undeclared outcome, refuses `workflow_phase_gate_invalid`.

**Block transition (generalized).** A directive line whose first token is `phase`, `member`, `harvest`,
any steering directive, `when`, `outcome`, `coupling`, `ask`, or `option` closes the currently open
member. A new `phase` closes the open phase. End of file closes the open member and phase.

**Compile-side validation** mirrors `admitSpec`'s rules per phase (the #170 D1 law: a compile-clean
campaign never triggers a late interpreter refusal) PLUS the phase-level cross-checks above: duplicate
phase name refuses; duplicate outcome name refuses; `outcome from <path>` naming a path not declared by
a `harvest` in the SAME phase refuses (D4); `coupling <role>` naming a role not declared by a `member`
in the SAME phase refuses (D7); `when` naming an undeclared/future outcome refuses (D5); `ask`/`option`
outside a checkpoint phase refuses; `option` ids outside the closed `continue|amend|abort` enum refuse
(D6).

### D3 — The compiled phase spec (the shape the interpreter consumes)

`compileWavefile(text, options)` returns, for a campaign file, exactly:

```json
{
  "schemaVersion": 2,
  "idempotencyKey": "<campaign key>",
  "phases": [
    {
      "name": "<phase name>",
      "kind": "member" | "checkpoint",
      "when": null | { "outcome": "<name>", "op": "present" | "eq" | "ne" | "absent", "literal": "<lit or null>" },
      "outcomes": [ { "name": "<name>", "from": "<path>", "line": "<pattern>" } ],
      "coupling": { "<role>": "loose" | "shared" | "tight" },
      "checkpoint": null | { "question": "<text>", "options": [ { "id": "continue|amend|abort", "label": "<label>" } ] },
      "members": [ { "role": "<role>", "exact": {...}, "scope": [...], "objectiveRef": "<path>", "report": "<path or absent>" } ],
      "steering": { /* per-phase steering keys; absent keys absent */ },
      "harvest": { "paths": [ { "path": "<path>", "mustContain": "<text or absent>" } ] }
    }
  ],
  "steering": { /* campaign-level steering defaults; absent keys absent */ },
  "scope": [ "<campaign scope default entries, in order>" ]
}
```

- `schemaVersion: 2` is fixed, never authored (authored shape is the wavefile text).
- `phases` is a non-empty array (a campaign with no `phase` directive is NOT a phase spec — it is the
  schemaVersion-1 wave IR, unchanged).
- **Per-phase wave identity is DERIVED, never authored:** the campaign driver derives each phase's wave
  idempotency key as `<idempotencyKey>.<phaseName>` (both meet `IDEMPOTENCY_PATTERN`, G4). No phase
  carries an authored `idempotencyKey`; a phase's wave is a template, its key minted at drive time.
- Member objects are byte-identical to the wave member shape (`admitSpec` `MEMBER_FIELDS`): `role`,
  `exact{harness,model,effort}`, `scope` (array), `objectiveRef`, optional `report`. The wave-level
  `scope` default resolution (member scope → phase scope → campaign scope) is applied by the COMPILER at
  emit time (each member's `scope` is fully expanded, exactly as #170 D3 expands the wave default — no
  unexpanded inheritance survives into the IR).
- `when` is `null` on the first phase and on ungated phases; the `op` field is the closed
  `present|eq|ne|absent` (D5).
- `coupling` carries ONLY the roles the author declared; undeclared roles are `loose` (D7) — the driver
  reads `coupling[role] ?? 'loose'`.
- `checkpoint` is `null` on `member` phases; on `checkpoint` phases it is `{question, options}` with
  `options` the closed `continue|amend|abort` set (D6).

**Round-trip pin (the #170 P1 law generalized).** `admitPhaseSpec(compileWavefile(campaignText, {repoRoot}),
repoRoot)` does not throw, AND every phase's emitted member/steering/harvest block, lowered to a
schemaVersion-1 wave, is `admitSpec`-accepted: for each phase,
`admitSpec(lowerPhaseToWave(phase, derivedKey), repoRoot)` does not throw. `admitSpec` (schemaVersion 1)
is byte-unchanged; `admitPhaseSpec` (schemaVersion 2) is the new validator.

### D4 — Phase outcomes as first-class values (declared extraction, never prose)

`outcome <name> from <path> line "<pattern>"` declares that, at the phase's settle, the campaign driver
extracts an outcome **from the phase's authoritative harvest** — the recovered content of the harvested
file `<path>` — by selecting the **first line whose text contains `<pattern>`** (a substring match,
UTF-8 verbatim, never a regex, never an eval). The outcome's **value** is that line's text, trimmed of
leading/trailing whitespace. If `<path>` was not harvested (no matching `harvest <path>` entry in the
SAME phase) or no line matches, the value is the distinguished **`absent`** (a reserved value; an author
may not extract it as a literal — a `line "<pattern>"` can match any line, so `absent` is only produced
by a no-match, and a literal comparison against it is refused at compile time).

**Structural laws.**

- **Provenance:** the extraction reads the phase receipt's harvest entry `bytes` for `<path>` (the
  waveId-bound authoritative resultSha content, marker-verified when the phase's `harvest` carried
  `mustContain`) — **never a fresh disk read, never a working-tree read**. This is the "declared
  extraction from a phase's harvest, never a prose read" law made structural.
- **Declared only:** `outcome from <path>` requires a matching `harvest <path>` in the SAME phase; the
  compiler refuses otherwise (`workflow_phase_outcome_invalid`, see §3). The author cannot extract from a
  file the phase did not harvest.
- **Uniqueness:** outcome names are campaign-unique (D2); a duplicate refuses.
- **Scope:** the outcome belongs to its declaring phase. A SKIPPED (folded) phase produces all of its
  outcomes as `absent` (D5); a phase that failed to settle produces `absent` (never a fabricated value).

### D5 — Conditional gating (the closed `when:` vocabulary + fold semantics)

A phase's `when:` clause is a **run-gate**: the phase's members admit only when the predicate evaluates
true over PRIOR phases' outcomes. The predicate vocabulary is **CLOSED** — exactly four forms, no eval,
no arbitrary expression:

| Form | Meaning | `op` (D3) |
|---|---|---|
| `when <name>` | the outcome's value is not `absent` (presence) | `present` |
| `when <name> = "<literal>"` | the outcome's value equals `<literal>` (exact string equality) | `eq` |
| `when <name> != "<literal>"` | the outcome's value does not equal `<literal>` (negation) | `ne` |
| `when not <name>` | the outcome's value is `absent` (absence) | `absent` |

**Semantics.**

- The outcome referenced must be a PRIOR phase's declared outcome (compile-time cross-check, D2). A
  reference to the current phase's own outcome, a later phase's, or an undeclared name refuses
  `workflow_phase_gate_invalid`.
- **Fold:** a false predicate FOLDS the phase — its members never start, it produces no wave, all of its
  declared outcomes evaluate `absent`, and the campaign records the fold (phase name + the false
  predicate) in the receipt and proceeds to the next phase. A fold is a recorded outcome, never a hard
  failure.
- The FIRST phase may not carry a `when:` (no prior outcomes); the first phase always runs.
- **No further boolean algebra** — no `and`/`or`/parentheses, no numeric comparison, no regex. A
  multi-condition gate is authored as a checkpoint (D6): the brittleness guard lives there, not in the
  predicate (D8).

### D6 — Orchestrator checkpoints (a phase kind riding the decision machinery)

`phase <name> checkpoint` marks a checkpoint phase. Semantics:

1. **Run the phase's members** (if any) exactly like a member phase (the checkpoint may carry its own
   members whose reports become the decision context). A checkpoint with NO members is a pure decision
   point (still valid — the packet is delivered on the campaign's own behalf).
2. **At the checkpoint's settle, PARK the campaign and deliver the decision packet upward.** The packet
   is `{phase: <name>, question, options, outcomes: <the prior phases' extracted outcomes>}`. It is
   surfaced through the **existing decision machinery**: the phase's own wave carries an
   `answer_decision`-shaped attention (G3a) whose `question` and `options` are the checkpoint's declared
   `ask`/`option` set, and whose resolution is the orchestrator's existing `run.answer` seam. The
   campaign does **not** advance to the next phase until the answer lands (the driver parks on the
   answer evidence, quiescence-derived — no clock, #163).
3. **Closed routing on the answer** (the `option` ids, a closed enum):

| option id | routing |
|---|---|
| `continue` | resume: drive the next phase |
| `amend` | resume: drive the next phase, recording the amendment (the answer's text, when the answer carries one) in the campaign receipt's `checkpoints[]` |
| `abort` | stop the campaign: verdict `CAMPAIGN-ABORTED`, no further phases drive |

- `ask "<question>"` declares the one packet question (one, closed; at most one per checkpoint). Omitted
  → the default question `"Phase <name> settled — continue, amend, or abort?"`.
- `option <id> "<label>"` declares the closed options; `<id>` ∈ `{continue, amend, abort}` (any other id
  refuses at compile time). Omitted → the default two-option packet `continue`/`abort`. Declaring an
  `option` with a non-`continue|amend|abort` id refuses (§3).
- The campaign driver does **not** auto-answer a checkpoint (no `answerDecisions` policy auto-applied to
  the checkpoint packet) — a checkpoint is the point where JUDGMENT enters, the `answerDecisions`
  auto-answer lane is for a member's in-phase decisions, never for the campaign's own checkpoint (D8).

### D7 — Context couplings per phase per member (loose / shared / tight)

`coupling <role> loose|shared|tight` declares the context-coupling depth of a member within its phase.
Default (no directive) is **loose**. The `<role>` must name a member declared in the SAME phase
(compile-time cross-check).

| kind | meaning | precondition (honest) | runtime posture |
|---|---|---|---|
| **loose** | the #170 status quo: the member has its own run, its own horizon, its own worktree; sharing is orchestrator-mediated file refs (`objectiveRef`/`report`/harvest paths) only. | none | byte-identical to a #170 member (the no-coupling path is unchanged) |
| **shared** | the member participates in the shared scratchpad `shared` tier for cross-member handoff. | **#158** — the shared-layer WRITE verb is absent from agent surfaces (G5). | compiles and runs; cross-member shared-tier WRITES are the #158 dependency — the driver records the note and never fabricates a write verb; shared-tier READS already work (D1.2 read law) |
| **tight** | the member is a CELL member (N same-seat agents, one runId, shared horizon). | **#102** — the cell is kernel work, not landed (G6). | compiles; the driver REFUSES at the phase's admission (`workflow_phase_coupling_unavailable`, naming `#102`) rather than silently degrading to loose |

**Never silently dropped.** Both `shared` and `tight` compile into the spec's `coupling` map (D3) with
their precondition carried in the contract (above) and in the receipt's coupling note. `tight` is a
loud refusal until #102 lands; `shared` is a loud-degraded run (reads work, writes are the named #158
gap) until #158 lands. The compiler emits them verbatim; the interpreter never drops a declared
coupling to `loose`.

### D8 — Mid-flight amendment + the brittleness guard

**Phases are templates; checkpoints carry judgment.** A phase's members, gate, and coupling are a
DECLARATIVE template — re-runnable, deterministic, no live code. The brittleness guard is two-fold:
(a) the `when:` vocabulary is closed (D5), so a template cannot encode arbitrary cascading logic; and
(b) the only point where a surprising outcome can change the campaign's course is a **checkpoint** (D6)
— a human/orchestrator answer (`continue`/`amend`/`abort`), never an automatic cascade.

**Mid-flight amendment.** A running campaign's later phases are editable without re-driving settled
ones. The mechanism is the **settled-phase ledger**, keyed by the phase-addressable identity
`<campaignKey>.<phaseName>` (D3's derived-key rule):

- The campaign driver records, per phase, its settle in the ledger — `{phaseName, waveId, key:
  <derivedKey>, verdict, outcomes: {name → value}, folded: bool, receipt}` — in the same store the wave
  machinery already writes (`wave.started`/`wave.settled` events).
- On an amended spec (same `idempotencyKey`, changed later phases), the driver RE-COMPILES and
  RE-ADMITS, then **re-drives from the first phase that is (i) not in the ledger, or (ii) whose template
  changed relative to the ledger's recorded template digest, or (iii) whose `when:` now evaluates
  differently given the settled outcomes.** Settled phases are **read from the ledger** — their outcomes
  are never recomputed, their waves never re-`waves.start`-ed (G4: the derived key dedupes/refuses a
  re-start).
- The compiler makes the spec **diffable** (the #170 D4 seam generalized): the phase spec is a stable,
  phase-addressed structure (D3); the driver stores each settled phase's canonical template digest
  (`canonicalJson` of the phase block, the interpreter's `canonicalJson` `:56-61`) so "changed" is a
  byte-stable comparison, never a heuristic.
- **No new wall-clock cap** governs amendment (G8): re-driving is gated on the ledger and the template
  digests — evidence, not clocks.

### D9 — The campaign receipt (the phase-level truth)

The campaign driver returns a receipt extending the wave receipt's discipline (sorted keys, closed
shape):

```json
{
  "basis": "completed" | "<manifestDigest>",
  "checkpoints": [ { "phase": "<name>", "question": "<text>", "answer": { "optionId": "continue|amend|abort", "text": "<or null>" } } ],
  "folded": [ { "phase": "<name>", "predicate": "<the false predicate>", "outcomes": { "<name>": "absent" } } ],
  "manifestDigest": "<sha256 of the canonical phase spec>",
  "outcomes": { "<name>": "<value | absent>" },
  "phases": [ { "phase": "<name>", "verdict": "<wave verdict>", "waveId": "<or null>", "receipt": "<the phase's wave receipt>" } ],
  "verdict": "CAMPAIGN-OK" | "CAMPAIGN-INCOMPLETE" | "CAMPAIGN-ABORTED",
  "idempotencyKey": "<campaign key>"
}
```

Every leg is derivable from the per-phase wave receipts + the extracted outcomes + the ledger — no new
source of truth.

---

## 3. REFUSAL VOCABULARY (closed)

The compiler emits the interpreter's existing five codes (unchanged) for everything the wave layer
validates (a bad member scope inside a phase still refuses `workflow_member_invalid`; a bad steering
kind still refuses `workflow_steering_unknown`; a bad harvest path still refuses
`workflow_harvest_invalid`), **plus exactly three new phase-level codes** — a closed extension of the
`workflow_*` family, inside the existing prefix arm (G7, no allowlist change):

| Code | Fires on | `field` leg (examples) | `expected` leg (examples) |
|---|---|---|---|
| `workflow_phase_invalid` | phase structure/placement/shape: `phase` without a name, unknown phase-level directive, a `when`/`outcome`/`coupling`/`ask`/`option` with no open phase, `ask`/`option` outside a checkpoint phase, duplicate phase name, mixed single-wave+multi-phase file, `coupling` with an unknown kind or an undeclared role, an `option` id outside the closed enum, `checkpoint` as a kind token on a non-`phase` line | the offending directive (`phas`, `coupling`, `option`), `phase <name>` | `'phase <name>'`, `'loose|shared|tight'`, `'declared member role'`, `'checkpoint'`, `'continue|amend|abort'` |
| `workflow_phase_outcome_invalid` | outcome declaration shape: `outcome from <path>` naming a path not declared by a `harvest` in the same phase, duplicate outcome name, empty `<name>`, missing `line`/pattern | `outcome <name>` | `'harvested path in this phase'`, `'unique outcome name'`, `'outcome <name> from <path> line "<pattern>"'` |
| `workflow_phase_gate_invalid` | `when` outside the closed vocabulary: unknown operator, `when` in the first phase, `when` naming an undeclared/future outcome, a literal comparison against the reserved value `absent` | `when`, `when <name>` | `'present|eq|ne|absent'`, `'a prior phase outcome'`, `'when <name> [=|!=] "<literal>"'` |
| `workflow_phase_coupling_unavailable` | **runtime only** (not emitted by the compiler): a `tight` coupling is driven before #102 lands, or a `shared` coupling's write is attempted before #158 lands | `coupling` | `'#102 landed'` / `'#158 landed'` |

The `{line, field, expected}` triple and the wire `detail` leg are attached exactly as #170 D2 specifies
(the compiler's `refuse` constructor `workflow-dsl.mjs:70-74`). Sanitization unchanged (the #41 law:
never the value, never a secret). The compiler does NOT emit `workflow_objective_ref_invalid` (objective
existence/containment/byte-bound stay at the interpreter's render, #170 D1).

---

## 4. RED-FIRST ACCEPTANCE PINS

Suite home: **`impl/test/workflow-phases-red.test.mjs`** (new, this rung — per the wavefile). Suite law
inherited from the DSL lane: red-first at HEAD with a **named stage** in every capability assertion;
hermetic (no network/provider/clock/host state); no absolute line-window anchors; sorted-key literals
in ACTUAL order (`localeCompare` banned); `watchdog: { stallMs: 60_000 }` with its comment; namespace
imports for the invented surfaces. The RED stages at HEAD are `workflow_phase_compile_missing` (the
phase directives do not exist) and `workflow_phase_driver_missing` (the campaign branch of `runWorkflow`
does not exist).

**Green pins (behavioral).**

| Row | Assertion |
|---|---|
| P1 phase-syntax compiles | a campaign file with two phases, per-phase rosters, and a role re-cast across phases (`coordinator` in phase A and phase B) compiles to a schemaVersion-2 spec with per-phase `members` and `coupling` maps; a single-wave file still compiles to the schemaVersion-1 IR (byte-identical to #170) |
| P2 round-trip | `admitPhaseSpec(compileWavefile(campaignText, {repoRoot}), repoRoot)` does not throw, and for every phase `admitSpec(lowerPhaseToWave(phase, derivedKey), repoRoot)` does not throw |
| P3 outcome is declarative | `outcome <name> from <path> line "<pattern>"` where `<path>` is a harvested file of the same phase compiles; `outcome from` a NON-harvested path refuses `workflow_phase_outcome_invalid` (extraction is declared, never prose) |
| P4 when-vocabulary closed | `when a`, `when a = "x"`, `when a != "x"`, `when not a` compile; any other form (`when a and b`, `when a > "x"`, `when a ~ "x"`) refuses `workflow_phase_gate_invalid` with the closed `expected` |
| P5 two-phase end-to-end (THE pin) | drive the interpreter with marker members: phase A's flash member writes `demo-a-outcome.md` carrying an `outcome:` line (harvested); phase B is `when`-gated on that outcome; B's flash member writes `demo-b-ran.md`. Assert: B's member STARTS ONLY after A's outcome satisfies the `when:` — with a TRUE gate, B's marker exists and the receipt orders A's waveId before B's; with a FALSE gate, B's member NEVER starts (marker absent, phase folded, A's outcome `absent`) |
| P6 checkpoint parks + surfaces packet | a `phase qa checkpoint` (with `ask`/`option continue/abort`) settles, PARKS (no later phase drives), and surfaces the `answer_decision`-shaped packet `{question, options, outcomes}`; an `abort` answer stops the campaign (verdict `CAMPAIGN-ABORTED`); a `continue` answer resumes the next phase |
| P7 coupling compiles + precondition honored | `coupling r shared` and `coupling t tight` compile into the spec's `coupling` map (never dropped); a `tight`-coupled member's phase refuses `workflow_phase_coupling_unavailable` at drive time (naming #102); a `coupling` naming an undeclared role refuses `workflow_phase_invalid` |
| P8 mid-flight amendment | drive a 2-phase campaign to settle; amend phase B's template; re-drive — phase A is NOT re-driven (no second wave for A; its outcome read from the ledger, byte-identical), phase B re-drives with the new template |

**Red pins (refusal-shape — each asserts the `{line, field, expected}` triple).**

| Row | Refusal |
|---|---|
| R1 | `phase` with no name → `workflow_phase_invalid {line, field: 'phase', expected: 'phase <name>'}` |
| R2 | `outcome x from y line "z"` where `y` is not harvested in the phase → `workflow_phase_outcome_invalid {field: 'outcome x', expected: 'harvested path in this phase'}` |
| R3 | `when a and b` (outside the closed vocabulary) → `workflow_phase_gate_invalid {field: 'when', expected: 'present|eq|ne|absent'}` |
| R4 | `when a` in the FIRST phase → `workflow_phase_gate_invalid {field: 'when', expected: 'a prior phase outcome'}` |
| R5 | `when z = "x"` where `z` is undeclared → `workflow_phase_gate_invalid {field: 'when z', expected: 'a prior phase outcome'}` |
| R6 | `coupling r shared` where `r` is not a member of the phase → `workflow_phase_invalid {field: 'coupling', expected: 'declared member role'}` |
| R7 | `coupling r cell` (unknown kind) → `workflow_phase_invalid {field: 'coupling', expected: 'loose|shared|tight'}` |
| R8 | `option proceed "Go"` (id outside the closed enum) → `workflow_phase_invalid {field: 'option', expected: 'continue|amend|abort'}` |
| R9 | `when`/`outcome`/`coupling` with no open phase → `workflow_phase_invalid {field: <directive>, expected: 'phase <name>'}` |
| R10 | HEAD red: a campaign file handed to the current `runWorkflow` refuses (no phase branch) at `workflow_phase_driver_missing`; the single-wave path is untouched (green at HEAD) |

**Static pins.**

- **S1** — `compileWavefile`'s phase branch performs no `eval`/`Function`/`import()` and no file READS
  beyond the existing repoRoot-gated harvest realpath containment (the #170 S1 law extends to the new
  directives); the `when` predicate is compiled to the closed `op` enum, never evaluated as code.
- **S2** — `admitSpec` (schemaVersion 1) is byte-unchanged: the single-wave path, the closed 5-code
  family, and the wave receipt are source-pinned unchanged (the campaign branch is additive).
- **S3** — the derived-key rule is total: every phase's wave key is `<idempotencyKey>.<phaseName>`, both
  segments `IDEMPOTENCY_PATTERN`-valid, and no phase spec carries an authored wave key (a source-scan
  pin).
- **S4 (closure)** — the phase directive set is disjoint from the machine-minted surface (no directive
  names `attempt`, `salt`, `runId`, `waveId`, `lane`, `driver`, `cadence`, `verification`): the salt is
  the interpreter's (`workflow-interpreter.mjs:521`), run/wave ids are dispatch-minted, the driver is an
  invocation option, per-phase keys are DERIVED — the same closure argument as #170 D1/S4.

---

## 5. OPEN QUESTIONS

**OQ1 — The campaign opener spelling.** This contract keeps `wave <key>` as the single opener for both
the single-wave and campaign forms (the key is the campaign idempotency key in both; per-phase keys are
derived). A distinct `campaign <key>` opener is more explicit but breaks the #170 first-token sniffing
invariant and the one-opener law. **Recommend keep `wave <key>`** for v1; `campaign` is a named future
extension.

**OQ2 — `shared`-coupling runtime posture.** This contract runs `shared`-coupled members (reads work)
and records the #158 write gap rather than refusing. The alternative — refuse `shared` coupling at
drive time exactly like `tight` — is stricter but would make the coupling un-authorable until #158
lands. **Recommend the chosen loud-degraded posture** (run + record), matching the brief's "compile with
the precondition note, never silently dropped."

**OQ3 — Checkpoint packet surface.** The packet rides the phase's own wave as an `answer_decision`
attention (G3a). The alternative — a campaign-level attention on the orchestrator's own surface — would
be NEW machinery outside the wave lane. **Recommend the wave-carried packet** (no new surface); the
orchestrator's `run.answer` seam is the resume trigger. This is a DECISION for the top orchestrator if
the packet must be visible outside the wave's own run view.

**OQ4 — Outcome value shape.** This contract makes an outcome a single extracted LINE (trimmed text).
A structured outcome (e.g. `key: value` projection) is a named future extension; v1 keeps the value a
string so the closed `eq`/`ne` comparison is exact-string, never a parser.

---

## Fold / notes record (judgment calls)

- **The brief's `phase fold { when: … }` is prose, not concrete grammar.** This contract reads `fold` as
  an EXAMPLE phase name (the methodology's fold/remediate stage) and the `{ }`/`:` as sketch; the
  concrete grammar is the line-oriented keyword-first form (`phase <name>` … `when <name> = "<lit>"`),
  matching the rest of the DSL. Recorded as a judgment call.
- **`when:` is a positive RUN-gate; a false predicate FOLDS (skips) the phase** — read from the
  row-suite brief's pin "phase B's member starts ONLY after phase A's outcome satisfies its `when:`"
  (satisfies = predicate true → B runs; false → B folded).
- **Outcome names are campaign-unique** (single-token `when` references); phase-scoped dotted references
  (`when spec.verdict`) are OQ territory, not v1.
- **Per-phase idempotency keys are DERIVED, never authored** (`<campaignKey>.<phaseName>`) — the #168
  base-commit machinery and the #183 re-key law require it; an authored per-phase key would collide the
  wave dedupe.
- **The `:525` anchor in the impl brief is the salt line, not the base commit** — the base commit is
  `workflow-interpreter.mjs:539-540` (verified this session); this contract cites `:539-540`.
- **`tight` refuses at drive time; `shared` runs loud-degraded** (OQ2) — the honest posture given #102
  is kernel work and #158 is the missing write verb.
- **Shared publish.** The row-contract brief's "shared publish" (the scratchpad `shared` partition
  append) is **not performable from this worker surface** — the write/append verb is absent per #158
  (the #147 dogfood failure mode; fold-170 N4). Recorded here as the honest refusal rather than
  performed.
