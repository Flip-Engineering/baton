# The phase-level campaign grammar — the campaign-as-DSL contract (phasefile), a phase-sequencing authoring surface over the #170 wavefile

[attempt: 7d31c695-e6b6-46c9-88c1-c373986067c9 row-contract]

Date: 2026-08-14. Status: contract for implementation, **v1** — ring-2 form (ground truths →
decisions → closed refusal vocabulary → red-first acceptance pins → open questions). Primary
input: the operator's north-star directive (the #170 closure comment's north-star section) and the
nine subtasks it names — an entire methodology pipeline (**ground → spec → red-team → suite →
blue-team → remediate → impl → validate → return-to-orchestrator**) as ONE dynamic workflow script.
Today the #170 DSL expresses exactly ONE wave per spec (the `wavefile`, `workflow-dsl.mjs`); this
contract specifies the PHASE level above it. Every citation below was re-verified this session
against the working tree with `grep -an`/`sed -n`/`Read`; NUL discipline applied to
`application.mjs` and `coordination-store.mjs` (both NUL-bearing — `grep -a` only; not whole-file
read this session, and not needed for this rung's anchors). No wall-clock claims; no redesign of the
interpreter's closed spec and no redesign of the wavefile grammar — the phasefile LOWERS TO the
wavefile, which lowers TO the interpreter's `admitSpec` input. Three tiers, each composing the one
below, none extending it.

**The contract in one sentence.** A new line-oriented authoring format — **phasefile** — whose
directive vocabulary sequences `phase <name>` blocks (each block holding the SAME 16 wavefile
directives as its per-phase roster), declares **phase outcomes as first-class values** (`outcome
<name> from <path> line <pattern>` — a mechanical line extraction from the phase's own harvest,
never a prose read), gates phases on a **closed predicate vocabulary** (`when <outcome> [not] |
==|!= "<literal>"` — no eval), expresses **orchestrator checkpoints** as a phase kind that parks the
campaign and delivers a decision packet upward (riding the existing `answer_decision` attention
shape), declares **context couplings** per phase per member (loose/shared/tight — with the #158 and
#102 preconditions named honestly), and is **mid-flight amendable** (settled phases are immutable
snapshots; pending phases are editable templates — the brittleness guard makes the checkpoint the
only place judgment enters).

---

## 1. GROUND TRUTHS (re-verified this session)

**G1 — The wavefile is the landing surface the phasefile must compose TOTALLY, and it is closed at
16 directives.** `WAVEFILE_DIRECTIVES` (`workflow-dsl.mjs:39-56`) enumerates the closed set: `wave`,
`member`, `harness`, `model`, `effort`, `scope`, `objectiveRef`, `report`, `approveOnAdvertisedPlan`,
`claimOnStall`, `nudgeOnCheckpoint`, `messageOnSpawn`, `elevateWhenNotes`, `answerDecisions`,
`signalOnMembersDone`, `harvest`. `compileWavefile(text, { repoRoot })` (`workflow-dsl.mjs:453`) is a
pure function of the text given `repoRoot` that lowers a wavefile to the precise object `admitSpec`
accepts. The phasefile's per-phase body is EXACTLY this grammar: a `phase` block holds the member /
steering / harvest directives, and the phase compiler delegates that body to `compileWavefile` — the
phase level composes the wavefile compiler, it does not re-specify its directives.

**G2 — The interpreter's closed spec is the wave-level floor, and it starts every member in
parallel.** `admitSpec` validates the closed five-field spec (`SPEC_FIELDS`/`MEMBER_FIELDS`/
`EXACT_FIELDS`/`STEERING_FIELDS`, `workflow-interpreter.mjs:48-54`) with `schemaVersion` exactly `1`
(`:139`), the `IDEMPOTENCY_PATTERN` (`:46`) on the key, and the `MAX_MEMBERS` 64 ceiling (`:40`).
`runWorkflow` renders every member's objective, then calls `baton.waves.start({ members, approve:
true })` (`workflow-interpreter.mjs:549-557`) — ALL members start at once and the drive loop polls
them in parallel to settle (`driveLane`, `:695-777`). **There is no ordering, no sequencing, no
gating between members today** — a wave is a flat parallel roster. The phase level is precisely the
missing sequencing layer: it runs phases in order, and within a phase it reuses the flat parallel
wave unchanged.

**G3 — The harvest is the only first-class "output" a wave produces today, and it is a byte
recovery, not a value.** The interpreter's harvest reads each path from a member's authoritative
result sha (`materializeSha` → `harvestOne`, `workflow-interpreter.mjs:636-675`) and returns
`{ path, waveId, ok, matched, code, resultSha, bytes, actual, … }` — recovered BYTES, with a
`mustContain` substring check as an integrity gate. Nothing in the closed spec extracts a NAMED VALUE
from those bytes. The phasefile's `outcome` directive is the declared extraction that turns harvested
bytes into a named first-class value a later phase can gate on.

**G4 — The decision/attention machinery the checkpoints must ride already exists, member-scoped.**
The drive loop reads two attention kinds: `answer_decision` (with `requestId`, `question`, `options`,
`allowFreeResponse`) and `turn_checkpoint` (with `requestId`, `claim`) (`workflow-interpreter.mjs:
728-729, 742-743`). `answerDecisions` auto-answers a member's `answer_decision` against a closed
policy map (`:821-870`); `nudgeOnCheckpoint`/`claimOnStall` steer a member's `turn_checkpoint`
(`:872-891`). These are MEMBER-scoped (they fire inside a member's run). A campaign checkpoint is the
SAME packet shape lifted to the campaign level — the drive loop itself mints the `{ question, options
}` packet and delivers it upward, and it is NEVER auto-answered (no `answerDecisions` policy is a
valid checkpoint; judgment is the point).

**G5 — The #158 and #102 preconditions are DRAFT contracts, RED at HEAD — the coupling layer must
name them honestly.** The `shared` scratchpad partition's READ law is landed (`restrictingReadAuthorize`,
`application-deployment.mjs:1728-1742`), but the WRITE verb `run.scratchpad.append` is absent on every
agent-facing surface (`scratchpad-write-contract.md` G1 — "no verb on any surface"; RED at HEAD). The
tight cell (`group` member binding, one run / N same-seat workers, shared run-scoped horizon) is
DRAFT v1.1+v1.2 and RED at HEAD (`tight-cell-contract.md` — no `group` field, no cell branch, no
quorum). A `shared` or `tight` coupling in the phasefile is a DECLARATION OF INTENT that the runner
must refuse (`workflow_coupling_unavailable`, naming the precondition) until the precondition lands —
never a silent degrade to `loose`.

**G6 — The `waves.*` verb family is the established seam the campaign surface must join.** The CLI
already admits `waves.attach/start/list/progress/run/compile` (`application-cli.mjs:27`); `waves.run`
and the #170 `waves.compile` seam have semantic-registry rows (`application-semantics.mjs:1637-1651`);
the facade exposes `baton.waves` with a `compile` method (`application-client.mjs:1553-1566`); the
embedded recipes wrapper exposes `baton.recipes.runWorkflow(spec, invocation)` (`recipes.mjs:584`).
No `campaign`/`phase` compiler or runner exists anywhere (`grep` for `compileCampaign`/`runCampaign`/
`phasefile`/`campaignKey` over `impl/src` returns nothing) — the phase level's seam is greenfield, and
its surface-home question is the authority-class item (OQ1).

---

## 2. DECISIONS

### D1 — The phasefile grammar, closed and total

**One phasefile = one campaign.** A campaign is an ORDERED sequence of `phase` blocks, each block
holding a per-phase roster (the wavefile directives) plus phase-level directives. The grammar is
keyword-first and block-by-transition, exactly as the wavefile's.

**Lexical rules (inherited verbatim from the wavefile, D1 of `workflow-dsl-contract.md`).** `\n`
separator with CRLF tolerated; full-line `#` comments only (a trailing `#` is a grammar refusal);
backslash continuation joins logical lines (a refusal reports the LOGICAL line and its 1-based
number); tokens are maximal non-whitespace runs or double-quoted strings with the escapes
`\" \\ \n \t \uXXXX`; an unterminated quote refuses. The phasefile's own compiler reuses the SAME
lexer — the phasefile compiler imports the wavefile's lexical layer (or a shared closed-constants
module) so the two grammars tokenize identically.

**Directive vocabulary (closed).** The phasefile adds EIGHT campaign-level directives to the
wavefile's 16 (which remain valid ONLY inside a `phase` block):

| Directive | Arity | Token shapes | Lowers to (campaign IR) |
|---|---|---|---|
| `campaign <key>` | 1 | `<key>` — one token (may be quoted) | `campaignKey` (`IDEMPOTENCY_PATTERN`) |
| `phase <name> [kind]` | 1–2 | `<name>` one token; optional `kind` ∈ `wave\|fold\|checkpoint` | open a phase block; `name` unique, non-empty; `kind` default `wave` |
| `when <outcome>` | 1 | `<outcome>` one token | gate predicate `{outcome, op: 'truthy'}` |
| `when not <outcome>` | 2 | `not` + `<outcome>` | gate predicate `{outcome, op: 'falsy'}` |
| `when <outcome> == "<lit>"` | 3 | `<outcome>` `==` one string | gate predicate `{outcome, op: 'eq', literal}` |
| `when <outcome> != "<lit>"` | 3 | `<outcome>` `!=` one string | gate predicate `{outcome, op: 'ne', literal}` |
| `outcome <name> from <path> [line <pattern>]` | 2–4 | `<name>` `<path>`; optional `line` + one string | `outcomes[]` entry `{name, from, line}` |
| `coupling <kind>` | 1 | `loose\|shared\|tight` | phase-level coupling default |
| `coupling <role> <kind>` | 2 | `<role>` + `loose\|shared\|tight` | per-member coupling override |
| `question "<text>"` | 1 | one string | checkpoint `{question}` (checkpoint phase only) |
| `option "<id>" "<label>"` | 2 | two strings | checkpoint `options[]` entry (checkpoint phase only, repeatable) |

That is eleven phase-level forms across eight semantic directives (`when` has four closed spellings;
`coupling` has two arities). The full closed vocabulary of a phasefile is therefore the wavefile's
16 (inside a phase block) plus these 8 — **24 directive names**, all closed.

**Placement rules.**

- `campaign <key>` MUST be the first directive (before any `phase`); exactly once.
- `phase` opens a block; the next `phase` (or EOF) closes it. Phase names are unique across the
  campaign.
- Inside a `phase` block, the wavefile's member/steering/harvest directives lower to the phase's
  wave spec, following the wavefile's own placement rules (`workflow-dsl-contract.md` D1). The
  phase-level directives (`when`, `outcome`, `coupling`, `question`, `option`) may appear anywhere
  inside the block; they lower to phase metadata, not to the spec.
- `when` is valid ONLY in a `fold` phase, and a `fold` phase MUST carry ≥1 `when`. A `when` in a
  `wave` or `checkpoint` phase refuses; a `fold` phase with zero `when` refuses.
- `question`/`option` are valid ONLY in a `checkpoint` phase; a checkpoint phase MUST carry exactly
  one `question` and ≥2 `option` directives; a non-checkpoint phase carrying either refuses.
- `coupling <kind>` (arity 1) is the phase default; `coupling <role> <kind>` (arity 2) overrides for
  one member. A coupling role that names no member of that phase refuses. Default when absent:
  `loose` for every member.

**The lowering (exact).** `compileCampaign(text, { repoRoot })` emits, for a valid file, exactly:

```json
{
  "schemaVersion": 1,
  "campaignKey": "<key>",
  "phases": [
    {
      "name": "<name>",
      "kind": "wave",
      "when": [],
      "outcomes": [ { "name": "<n>", "from": "<path>", "line": null } ],
      "couplings": { "*": "loose" },
      "spec": { "schemaVersion": 1, "idempotencyKey": "<derived>", "members": [ … ], "steering": { … }, "harvest": { "paths": [ … ] } },
      "checkpoint": null
    }
  ]
}
```

- `schemaVersion` is always `1` — fixed, never authored.
- Each phase's `spec` is the EXACT output of the wavefile compiler applied to that phase's
  member/steering/harvest directives — the precise object `admitSpec` accepts. The phase's wave
  `idempotencyKey` is DERIVED (machine-minted, never authored): `"<campaignKey>:<phaseName>"` — a
  key that is per-phase-stable so a settled phase's wave is terminal-once (the #183 law) while the
  campaign itself is re-drivable (D6).
- `when` is the empty array for a `wave`/`checkpoint` phase; `checkpoint` is `null` unless
  `kind === 'checkpoint'`, in which case it is `{ question, options: [{id, label}] }`.
- The emitted IR carries NO `driver` field anywhere (driver/cadence are invocation options, not spec
  or campaign fields — the #170 closure law lifted one level).

**Compile-side validation (the round-trip law, lifted).** `compileCampaign` performs admission-time
validation mirroring everything the wavefile compiler already checks PER PHASE (delegated to it), plus
the campaign-level checks: campaign key pattern; phase name non-empty/unique; kind closed; the
`when`/`outcome`/`coupling`/`question`/`option` placement rules above; **outcome-name closure** — every
`when <outcome>` references a name DECLARED by an `outcome <name> …` in a STRICTLY EARLIER phase
(same-phase or later-phase references refuse; undeclared names refuse); **outcome-path closure** —
every `outcome … from <path>` names a path that phase's `spec.harvest.paths[]` declares (the
extraction can only read the phase's own harvest); **coupling-role closure** — a per-member coupling
names a declared member role. The ONLY checks left to runtime are the render-time ones the wavefile
already defers (objectiveRef existence/containment/byte-bound) plus the coupling-precondition
refusal (D5).

### D2 — Phase outcomes are first-class values, mechanically extracted, never prose

**`outcome <name> from <path> [line <pattern>]`** declares a named value extracted from the phase's
own harvest. The extraction is PURE and MECHANICAL over the harvested bytes the wave runner already
recovered (the receipt's `harvest[].bytes` for `<path>`, or the materialized file):

- `outcome <name> from <path>` → the outcome's value is the ENTIRE recovered content of `<path>`.
- `outcome <name> from <path> line <pattern>` → the value is the FIRST line of `<path>`'s content
  that CONTAINS the `<pattern>` substring (verbatim, case-sensitive, NO regex — closed). The
  extracted value is that matched LINE (the full line), not the substring and not a summary.
- If `<path>` was not harvested (the phase's wave never produced it — harvest `missed`), or no line
  matches the pattern, the outcome is **absent** (falsy), not an error. An absent outcome is a
  first-class value the gate can negate.

**No prose, no LLM, no judgment.** The extraction is a deterministic function of bytes. A phasefile
author cannot write `outcome <name> from <path>` and get a model's summary of the file — they get the
bytes, or the first line matching a literal pattern. Anything richer is a later rung's concern; this
rung's outcome is the smallest first-class value that can carry a gate.

### D3 — Conditional gating: a closed predicate vocabulary, no eval

**A `fold` phase carries ≥1 `when` predicate; all predicates are ANDed.** The predicate vocabulary is
CLOSED to the four spellings in D1's table:

- `when <outcome>` — TRUE iff the outcome exists and its value is non-empty.
- `when not <outcome>` — TRUE iff the outcome is absent or empty.
- `when <outcome> == "<literal>"` — TRUE iff the value equals the literal (byte-for-byte).
- `when <outcome> != "<literal>"` — TRUE iff the value does not equal the literal.

That is the WHOLE vocabulary: equality, inequality, and a single leading negation on the truthy/falsy
form. **There is no `eval`, no `Function`, no arithmetic, no boolean composition beyond ANDing
multiple `when` lines, no regex in the predicate, and no operator other than `==`/`!=`/`not`.** The
compiler refuses anything else (`workflow_gate_invalid`) — a `not` combined with `==`/`!=`, a bare
`||`, a paren, a `&&`, a comparison to another outcome, all refuse. Static pin S4 proves the
predicate parser accepts nothing beyond this closed set.

**Evaluation order.** Outcomes accumulate in the campaign state as phases run; a `fold` phase's
`when` is evaluated against the state at the moment the campaign reaches it. A `fold` phase whose
conjunction is FALSE is recorded **`folded`** (skipped — no wave started, no member spawned) and the
campaign continues to the next phase. The fold is an honest outcome, never a fabricated run and never
a hard stop (D7 records it).

### D4 — Orchestrator checkpoints: a phase kind that parks and delivers judgment upward

**`phase <name> checkpoint`** is a phase whose drive is a PARK, not a wave: no member is spawned, the
phase's `spec` is `null` (a checkpoint phase has no roster), and the drive loop (1) delivers the
decision packet `{ phase: <name>, question, options: [{id, label}…] }` upward in the campaign receipt,
and (2) STOPS the campaign at that phase.

**The packet rides the existing decision shape.** The checkpoint packet is the SAME `{ question,
options }` shape the interpreter's `answer_decision` attention already carries
(`workflow-interpreter.mjs:728-729`), lifted to the campaign level — so the operator answers it
through the SAME answer surface a member decision uses, and the campaign's resume consumes the SAME
`optionId` shape. **The checkpoint is NEVER auto-answered.** No `answerDecisions` policy, no
`claimOnStall`, no `nudgeOnCheckpoint` applies to a checkpoint — a checkpoint is the one place the
campaign REQUIRES a human/judgment answer. (Static pin S5 asserts the runner has no auto-answer path
for checkpoints.)

**Resume.** Re-driving the campaign with `resume: { phase: <name>, optionId: "<id>" }` (the optionId
must be a declared option) records the decision at the checkpoint, marks the checkpoint settled, and
proceeds to the next phase. A checkpoint phase that is the LAST phase ends the campaign parked —
that is the canonical **return-to-orchestrator**: the terminal phase is a checkpoint that delivers the
final decision packet upward (Appendix A).

**Idempotency vs. #183.** A checkpoint park is a FIRST-CLASS, resumable state, not a terminal refusal.
The #183 `wave_already_terminal` refusal (same key on a terminal wave) applies to each phase's WAVE
(derived key, D1), never to the campaign: the campaign key identifies a session that resumes/amends
(D6). This is the documented divergence — judgment call JC-2.

### D5 — Context couplings: loose / shared / tight, with the preconditions named honestly

A phase's `coupling` declares how its members share context. The coupling is PHASE METADATA consumed
by the campaign runner — it is NOT a field smuggled into the closed wave spec (the phase's `spec`
stays byte-for-byte `admitSpec`-admissible; the #170 closure law holds one level up).

- **`loose` (default) — file references.** Each member has its own run/worktree/horizon; members
  share ONLY through orchestrator-mediated artifacts (the harvested `report`/`objectiveRef` files and
  the `harvest` recovery). This is today's wave semantics, byte-identical. No new machinery.
- **`shared` — the scratchpad partition.** Members additionally share the `shared` scratchpad
  partition. **Honest precondition:** the READ half is landed (D1.2 read law,
  `restrictingReadAuthorize`); the WRITE half (`run.scratchpad.append`) is ABSENT at HEAD — the #158
  contract is DRAFT and RED (`scratchpad-write-contract.md` G1). A `shared` coupling therefore
  COMPILES, but its phase RUN refuses `workflow_coupling_unavailable` naming #158 — never a silent
  degrade to loose.
- **`tight` — the cell.** Members are bound as ONE tight cell (one run, N same-seat workers, shared
  run-scoped horizon, board division, collective result). **Honest precondition:** the cell is DRAFT
  and RED at HEAD — no `group` field, no cell spawn branch, no quorum (`tight-cell-contract.md`). A
  `tight` coupling COMPILES, but its phase RUN refuses `workflow_coupling_unavailable` naming #102.

**The refusal is the honest default.** A coupling the machinery cannot yet honor is a typed refusal at
the phase boundary — the campaign does NOT run the phase as loose and pretend. When #158/#102 land,
the refusal flips (the corresponding acceptance pin is the flip point).

### D6 — Mid-flight amendment and the brittleness guard

**Settled phases are immutable snapshots; pending phases are editable templates.** The campaign
runner persists per-phase state keyed by the campaign key. A phase that has RUN (wave) or FOLDED or
been CHECKPOINTED is SETTLED — its compiled spec + outcomes + receipt reference are snapshotted. A
phase not yet reached (a prior checkpoint parked, or a prior phase's gate folded/failed) is PENDING —
it remains a template.

**Amendment.** Re-driving a campaign (same key) with an amended phasefile: (1) settled phases are
REPLAYED from their snapshots — never re-driven; (2) a settled phase whose incoming spec DIFFERS from
its snapshot refuses `workflow_campaign_amendment_refused` naming the phase ("settled phase `<name>`
is immutable; re-key to re-drive it"); (3) pending phases are re-compiled from the (possibly amended)
template and run. The amendment is therefore SAFE BY CONSTRUCTION: editing a LATER phase re-drives
only that phase; editing an EARLIER (settled) phase is a typed refusal, never a silent re-drive and
never a silent skip.

**The brittleness guard — phases are templates; checkpoints carry judgment.** The contract REFUSES to
promise a deterministic, autonomous pipeline. Three honest, negative promises, pinned in §4: (a) a
checkpoint parks and NEVER auto-answers (D4/S5); (b) a false `fold` gate is recorded `folded`, never
fabricated green (D3); (c) a phase whose wave fails is recorded in the receipt with its verdict —
the campaign does NOT paper over a `WAVE-INCOMPLETE`. A campaign with no checkpoint phase is a legal
"template run" whose judgment points are absent; the contract names that absence rather than
pretending the template is the judgment.

### D7 — The campaign drive loop (behavior, not implementation)

**`runCampaign(baton, campaign, options)`** validates the campaign IR (mirror of compile-time
validation), then drives phases IN ORDER:

1. **wave** — run the phase's `spec` through the existing `runWorkflow` (or the equivalent
   `baton.waves.start` + drive), collect the receipt, extract the phase's declared `outcomes` from the
   receipt's harvest (D2), record the phase `verdict: 'run'` with its wave receipt.
2. **fold** — evaluate the `when` conjunction against the outcome state. All true → run as wave;
   any false → record `verdict: 'folded'` (no wave), continue.
3. **checkpoint** — park: deliver the packet, record `verdict: 'parked'`, STOP. Resume on a later
   drive with `resume: { phase, optionId }` records the decision and continues.

The receipt (the `return-to-orchestrator` packet when the last phase is a checkpoint) carries every
phase: `{ name, kind, verdict, outcomes, waveReceipt?, checkpoint? }`, plus the campaign's
`verdict` ∈ `{ CAMPAIGN-OK, CAMPAIGN-PARKED, CAMPAIGN-INCOMPLETE }`. The drive loop runs ONE phase's
wave AT A TIME — sequencing is the phase level's whole job, and within a phase the flat parallel wave
is unchanged (G2).

---

## 3. REFUSAL VOCABULARY (closed)

The campaign compiler emits the wavefile's four admission-time `workflow_*` codes VERBATIM for any
per-phase body error (delegated to the wavefile compiler — the `{line, field, expected}` triple rides
unchanged), and EXTENDS the family with SIX closed `workflow_*` codes. All are `workflow_*`-prefixed,
so the existing MCP `workflow_*` prefix arm (`mcp-northbound.mjs:209-213`) and `LANE_CRAFTED` detail
leg preserve them with no allowlist churn, and the web side's #160 R3 pre-TypeError arm is the single
web dependency (exactly as the wavefile's own G5).

| Code | Fires on | `field` leg (examples) | `expected` leg (examples) |
|---|---|---|---|
| `workflow_spec_invalid` | (reused) per-phase wavefile body errors | the offending directive | the wavefile's closed shapes |
| `workflow_member_invalid` | (reused) per-phase member errors | `member <role>` | the wavefile's closed shapes |
| `workflow_steering_unknown` | (reused) per-phase steering errors | the steering field | the wavefile's closed shapes |
| `workflow_harvest_invalid` | (reused) per-phase harvest errors | `harvest.paths[<n>]` | the wavefile's closed shapes |
| `workflow_campaign_invalid` | campaign structure: `campaign` not first/missing/duplicated, duplicate/empty phase name, unknown phase kind, unknown campaign directive, `when` in a non-fold phase, fold without `when`, `question`/`option` in a non-checkpoint phase, `coupling` malformed | `phase <name>`; `coupling`; `<unknown directive>` | `'campaign <key>'`, `'wave\|fold\|checkpoint'`, `'loose\|shared\|tight'`, `'when <outcome> …'`, `'option "<id>" "<label>"'` |
| `workflow_gate_invalid` | gate predicate: `when` referencing an undeclared outcome, a same-phase or later-phase outcome, a disallowed operator (`not` with `==`/`!=`, a bare `\|\|`/`&&`, a paren, an arithmetic token) | `when` | `'declared prior outcome'`, `'when <outcome> [not] \| when <outcome> ==\|!= "<literal>"'` |
| `workflow_outcome_invalid` | outcome declaration: duplicate outcome name, `from` path not a declared harvest path of that phase, malformed `line` pattern (empty) | `outcome <name>` | `'declared harvest path'`, `'unique outcome name'` |
| `workflow_coupling_unavailable` | a `shared` or `tight` coupling declared but its precondition (#158 / #102) is not landed | `coupling` | `'#158 shared-scratchpad write (not landed)'` / `'#102 tight cell (not landed)'` |
| `workflow_campaign_amendment_refused` | mid-flight amendment edits a settled phase (immutable) | `phase <name>` | `'re-key to re-drive'` |
| `workflow_checkpoint_invalid` | checkpoint packet malformed: <2 options, duplicate option id, empty question, `resume.optionId` not a declared option | `checkpoint` | `'option "<id>" "<label>"'`, `'declared option id'` |

Every code carries the #160 triple on the error AND the wire `detail: { line, field, expected }` leg
(the wavefile's D2 shape, reused verbatim). Sanitization: the message never quotes a refused argument
value (the #41 law) — it names the field, the line, and the expected shape.

**Residual (named, out of the phasefile's authority).** The `line <pattern>` extraction is a
substring match, not a semantic check — a phase whose harvest carries the right BYTES but the wrong
MEANING compiles clean and is a runtime `folded`/`WAVE-INCOMPLETE`, not a refusal. The phasefile does
not (and this rung refuses to) make the outcome a prose/LLM read — that is the whole point of D2, and
the residual is the honest cost of "never a prose read."

---

## 4. RED-FIRST ACCEPTANCE PINS

The suite home is **`impl/test/campaign-grammar-red.test.mjs`** (NEW — the campaign-level sibling of
`workflow-dsl-red.test.mjs`), borrowing the same idiom: hermetic (mkdtemp, no live providers), no
clocks as controls, sorted-key literals in ACTUAL order, `localeCompare` banned. Every capability row
fails at a NAMED stage at HEAD and flips green on the implementation. The HEAD-red stage for every
row is **`campaign_compile_missing`** — no campaign compiler or runner exists; a phasefile handed to
any surface refuses (today a `phase` token is an unknown directive to the wavefile compiler, which
refuses `workflow_spec_invalid` `expected: '<closed directive list>'`).

**Green pins (behavioral).**

| Row | Assertion |
|---|---|
| P1 round-trip | for every green-pin phasefile, each phase's `spec` satisfies `admitSpec(spec, repoRoot)` without throwing AND `canonicalJson(admitSpec(spec, repoRoot)) === canonicalJson(spec)` — the wavefile P1 lifted per phase |
| P2 **two-phase end-to-end** | a campaign `phase ground` (wave) + `phase spec fold` (`when ground_ok`) where `ground`'s member writes a file and `outcome ground_ok from <file> line <pattern>` declares it: **the `spec` phase's member STARTS only after `ground`'s wave settles AND `ground_ok` extracts to a satisfying value** (ordering asserted on durable events/digests, never a clock). A false gate (pattern absent) records `folded` with NO member started. This is THE pin — phase B's member is not dispatched until phase A's outcome satisfies its `when:`. |
| P3 outcome extraction | `outcome <name> from <path> line <pattern>` yields exactly the FIRST matching LINE as a string (not the substring, not a summary); no matching line yields an absent outcome (falsy) |
| P4 fold gating | a fold phase with all `when` true records `run`; with any false records `folded` (no wave, no member) |
| P5 checkpoint parks | a checkpoint phase delivers `{phase, question, options}` and does NOT spawn a member; `verdict === 'parked'`; resume with a declared `optionId` records the decision and proceeds to the next phase; a resume with an undeclared `optionId` refuses `workflow_checkpoint_invalid` |
| P6 couplings | a `shared`/`tight` coupling COMPILES (the IR carries it) but its RUN refuses `workflow_coupling_unavailable` naming #158/#102 at HEAD; a `loose` (or absent) coupling runs byte-identically to today's wave |
| P7 mid-flight amendment | re-drive with an amended LATER (pending) phase → settled phases replay (no re-drive) and the amended phase runs; re-drive with an edited SETTLED phase → `workflow_campaign_amendment_refused` naming the phase |
| P8 totality | a generated totality row iterates the 8 campaign directives × the wavefile's 16 and asserts every field is expressible per phase (documented ⇄ parsed ⇄ admitted, the #159 three-way invariant lifted one level) |
| P9 #160 triple | a malformed phasefile driven through the compile seam surfaces the typed `workflow_*` code + `error.detail = {line, field, expected}` (the LANE_CRAFTED arm, `mcp-northbound.mjs:1651-1654`) |

**Red pins (refusal shapes — each asserts the triple).**

| Row | Refusal |
|---|---|
| R1 | `phase` before `campaign` → `workflow_campaign_invalid {line, field: '<first token>', expected: 'campaign <key>'}` |
| R2 | a fold phase with no `when` → `workflow_campaign_invalid {line, field: 'phase <name>', expected: 'when <outcome> …'}` |
| R3 | `when undeclared` (no matching prior `outcome`) → `workflow_gate_invalid {line, field: 'when', expected: 'declared prior outcome'}` |
| R4 | `when x` where `x` is declared in the SAME or a LATER phase → `workflow_gate_invalid {… 'declared prior outcome'}` |
| R5 | `when a not b == "c"` (disallowed operator composition) → `workflow_gate_invalid {… 'when <outcome> [not] \| when <outcome> ==\|!= "<literal>"'}` |
| R6 | `outcome <name> from <path>` where `<path>` is not a harvest path of that phase → `workflow_outcome_invalid {… 'declared harvest path'}` |
| R7 | duplicate outcome name → `workflow_outcome_invalid {… 'unique outcome name'}` |
| R8 | `coupling wobbly` (unknown kind) → `workflow_campaign_invalid {… 'loose\|shared\|tight'}` |
| R9 | a checkpoint phase with one `option` → `workflow_checkpoint_invalid {… 'option "<id>" "<label>"'}` |
| R10 | HEAD red: any phasefile refuses at `campaign_compile_missing` (the seam absent) |

**Static pins.**

- **S1** — `compileCampaign` performs no `eval`/`Function`/`import()` and no file READS beyond the
  gated harvest containment (`realpathSync` only inside the `repoRoot`-gated check — the wavefile
  S1 lifted).
- **S2** — the emitted campaign IR carries no `driver` field; `schemaVersion === 1`; each phase's
  `spec` carries no `driver`.
- **S3** — the 8 campaign directives are DISJOINT from the baton-attached dispatch surface: no
  directive names `attempt`, `salt`, `runId`, `waveId`, `lane`, `driver`, `cadence` (the closure,
  one level up — a negative pin).
- **S4** — the gate predicate parser accepts ONLY the closed `not`/`==`/`!=` forms over named
  outcomes: a source pin asserts the predicate grammar contains none of `eval`, `Function`, `&&`,
  `||`, `+`, `-`, `*`, `/`, `(` (the no-eval law made a pin).
- **S5** — the checkpoint runner has NO auto-answer path: a source pin asserts no `answerDecisions`
  policy or `claimOnStall`/`nudgeOnCheckpoint` trigger is reachable from a checkpoint phase (the
  judgment-carrier law made a pin).

---

## 5. OPEN QUESTIONS

**OQ1 — the campaign surface home — DECISION_REQUEST (authority-class).** Where do `campaigns.compile`
and `campaigns.run` land? Options: **(a)** a new `campaign.*` command family beside `waves.*` (new
direct-port commands at the `application.mjs:12560-12573` seam family, new read-only MCP tools
`baton_campaigns_compile`/`baton_campaigns_run`, new CLI verbs `baton campaigns compile/run`) — one
seam, one authorization story, mirroring the #170 DR-2 resolution exactly; **(b)** fold into the
`waves.*` family (`waves run --campaign <phasefile>`), reusing the existing seam. Recommend **(a)**:
a campaign is a different drive-loop object than a wave, and the #170 precedent (DR-2: `waves.compile`
as a NEW command port, not a field bolted onto `waves.run`) counsels the same shape here. This mirrors
the OQ1/DR-2 escalation the #170 contract resolved at the top orchestrator; it is the one
authority-class ambiguity this rung defers.

**OQ2 — the outcome extraction's value shape.** This rung pins `line <pattern>` → first matching LINE
(string). A later rung might want `key <pattern>` → the substring, or a structured extraction. Is
line-string the right v1 floor, or does the north-star pipeline need the substring value now? Recommend
line-string (it is the smallest honest value; the gate's `==`/`!=` compares against a whole literal
line).

**OQ3 — the derived per-phase wave key.** D1 derives `<campaignKey>:<phaseName>`. Confirm this is the
canonical derivation (it makes a settled phase's wave terminal-once under #183 while the campaign
resumes), or name an alternative that preserves the same two properties.

**OQ4 — gate conjunction vs. a richer predicate.** This rung ANDs multiple `when` lines. A future rung
might want `when … or …` (disjunction) or an `all`/`any` wrapper. Recommend deferring — AND-only keeps
the vocabulary closed and the no-eval law airtight; disjunction can be expressed by multiple fold
phases.

**OQ5 — the `shared`/`tight` coupling's flip.** P6 pins the refusal at HEAD. The flip points are the
#158 and #102 landings; the phasefile contract does not re-specify either (both are their own DRAFT
contracts). Confirm the campaign runner consumes them as precondition flags, not as re-specifications.

---

## Appendix A — the canonical nine-stage pipeline template (operator-facing)

The operator's north-star directive, expressed in the phasefile grammar. This is the EXAMPLE the
generated docs render and the P2 fixture's shape — a template, not a promise of autonomy (D6). The
`remediate` fold and the `return-to-orchestrator` checkpoint are where judgment enters.

```phasefile
# The campaign-as-DSL north-star: one methodology pipeline as one dynamic script.
campaign methodology-2026-08-14

phase ground
  member grounder
    harness deepseek
    model deepseek-v4-pro[1m]
    effort high
    objectiveRef docs/reference/evidence/phase-grammar-2026-08-14/ground-brief.md
    report docs/reference/evidence/phase-grammar-2026-08-14/ground.md
  harvest docs/reference/evidence/phase-grammar-2026-08-14/ground.md mustContain "GROUND"
  outcome ground_ok from docs/reference/evidence/phase-grammar-2026-08-14/ground.md line "GROUND-OK"

phase spec fold
  when ground_ok
  member specwriter
    harness deepseek
    model deepseek-v4-pro[1m]
    effort high
    objectiveRef docs/reference/evidence/phase-grammar-2026-08-14/spec-brief.md
    report docs/reference/evidence/phase-grammar-2026-08-14/spec.md

# … red-team (wave) → suite (wave) → blue-team (wave) → remediate (fold, gated on
# red/blue findings) → impl (wave) → validate (wave) — each a phase block with its own
# roster, its own outcomes, and `coupling shared` where the cross-row handoff rides the
# #158 write lane (refused until it lands) …

phase return-to-orchestrator checkpoint
  question "Admit the campaign result?"
  option admit "Admit — the pipeline's outcomes satisfy the gates."
  option remediate "Remediate — re-open an earlier phase."
```

The `return-to-orchestrator` checkpoint is the terminal phase: it parks, delivers the packet, and the
campaign ends parked — the operator's answer is the terminal record.

---

## Fold record

- **Date:** 2026-08-14.
- **Red-team / blue-team / QA:** none yet — this is the contract's first pass; the fold record is
  seeded for the subsequent rows (red-team → suite → blue-team) that this campaign's own grammar
  would sequence.
- **Judgment calls recorded:**
  - **JC-1** — the phase level composes the wavefile compiler per phase (a `phase` block's body is the
    wavefile grammar verbatim); no directive is re-specified. Chosen over a fresh 24-directive grammar:
    composition preserves the #170 totality and the `{line, field, expected}` triple for free.
  - **JC-2** — the campaign key is a resumable session handle, diverging from the #183 one-shot
    `wave_already_terminal` refusal; per-phase wave keys are DERIVED (`<campaignKey>:<phaseName>`) so
    each phase's wave is still terminal-once. The #183 law is preserved at the wave tier, not lifted
    to the campaign tier (OQ3 names the derivation).
  - **JC-3** — the `coupling` declaration COMPILES but its RUN refuses when the precondition is not
    landed, rather than silently degrading to `loose`. Chosen for honesty: a silent degrade would
    record a `loose` outcome the author never asked for.
  - **JC-4** — the outcome value floor is "first matching line" (not the whole-file byte string and
    not a substring): the smallest value that can carry an `==`/`!=` gate against a literal line.
  - **JC-5** — `when` predicates AND across multiple `when` lines and forbid `not` combined with
    `==`/`!=`; the closed vocabulary is exactly the four D1 spellings.
- **Shared-publish refusal (audit evidence).** The shared-scratchpad publish is NOT performable from a
  worker surface: the write/append verb is absent on every agent-facing surface per #158
  (`scratchpad-write-contract.md` G1 — "no verb on any surface"), and the kernel hardcodes
  `worker:<id>` scope on write. This is the same recorded refusal the #170 red-team logged
  (`redteam-170.md` §6). The full contract text is delivered here; no `shared` entry was written.
- **Authority-class item:** OQ1 (the campaign surface home) is a DECISION_REQUEST with options,
  recommend **(a)** — the `campaign.*` family beside `waves.*`, mirroring the #170 DR-2 resolution.
