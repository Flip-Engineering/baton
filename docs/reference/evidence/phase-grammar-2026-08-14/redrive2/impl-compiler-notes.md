# impl-compiler-notes — phase directives in the DSL compiler

[attempt: 127e4261-4f97-48d7-aef0-d0e26fbfe69c row-impl-compiler]

Row: row-impl-compiler (the campaign-as-DSL rung, phase-grammar-2026-08-14 wave-a-rd2).
File partition honored: `impl/src/workflow-dsl.mjs` ONLY, plus this redrive2 notes file.
`impl/src/workflow-interpreter.mjs` untouched (row-impl-interpreter owns it); the compiled phase
shape below is the contract point the interpreter row consumes.

## 0. Input-gap (honest, recorded)

The await-inputs discipline required `phase-grammar-contract.md` AND `suite-notes.md` to be read IN
FULL before writing code. Both were polled at 30s cadence (rounds at 02:0x, 02:26, 02:35 local) and
were ABSENT — row-contract and row-suite had not landed deliverables in this worktree at
implementation time. `impl/test/workflow-phases-red.test.mjs` likewise does not exist (row-suite
owns it; outside my partition to write). I therefore implemented against the row brief's own
7-decision enumeration + the #170 contract's idioms, keeping the existing suites green and recording
every decision + judgment call below so the coordinator can spot-audit against the landed contract
and fold any divergence. Every acceptance-visible claim here is a decision, not a contract citation.

## 1. Decisions (the phase grammar as implemented)

**D1 — A wavefile is EITHER flat (#170, 16 directives) OR phase-structured.** The discriminator is
the presence of a `phase` directive: a flat wavefile lowers to the byte-identical #170 IR (no
`phases` key); a phased wavefile lowers to the phase-addressed shape (§D6). No heuristic, no mixing —
a `phase` after a top-level `member` refuses `workflow_spec_invalid` ("cannot mix phase blocks with
top-level members"), and a `member` outside any phase in phased mode refuses `workflow_member_invalid`
(`expected: 'phase <name>'`). Anchors: `workflow-dsl.mjs:377-396` (`phase`), `:354-368` (phase-mode
member).

**D2 — Phase blocks hold member directives; rosters are per-phase; roles re-cast across phases.**
`phase <name>` opens a block (anchor `:377`); `member <role>` inside it opens a phase member
(`:344-375`). Role uniqueness is PER-PHASE (`:361-364`): the same role may be re-cast in a later
phase as a fresh admission carrying that phase's coupling — never duplicated within one phase. The
member sub-fields `harness`/`model`/`effort`/`scope`/`objectiveRef`/`report` are reused verbatim
(`:485-501`, `:503-515`); `scope` keeps the #170 placement rule (wave-level default before the first
member, member override inside an open member, no per-phase default).

**D3 — Outcomes are first-class, declarative, never prose.** `outcome <name> from <file> line
"<pattern>"` (anchor `:435-464`) lowers to `{ name, from, line }`. `name` matches the closed
identifier pattern; `from` passes the harvest path-class + repoRoot symlink containment
(`workflow_harvest_invalid` on escape, via the existing `validateHarvestPath`); `line` is an opaque
non-empty string (the extraction match itself is interpreter-side — the compiler declares, never
reads). Outcome names are unique across the whole campaign (`:457-460`) so a `when` reference is
unambiguous.

**D4 — `when:` gating with a CLOSED predicate vocabulary (parse-time refusal of anything outside
it).** `when <outcome>` (equality — phase admits only when the outcome is satisfied) and
`when !<outcome>` (negation) are the ONLY two forms (anchor `:409-433`). They lower to
`{ outcome: <name> }` and `{ outcome: <name>, negate: true }`. Anything else — a second token,
`!`-with-empty-name, a non-identifier name, a second `when` on the same phase — refuses
`workflow_spec_invalid` at parse time. No `and`/`or`/`=`/parens, no eval. (The `when` directive is
spelled without a colon — the DSL has no colons; the brief's "when:" is prose.)

**D5 — Checkpoint is a phase KIND.** A bare `checkpoint` directive inside a phase (anchor
`:398-407`) marks `kind: 'checkpoint'`; default is `kind: 'work'`. `checkpoint` closes the open
member and applies to the phase (idempotent marker, not data).

**D6 — Per-phase-per-member coupling: loose/shared/tight, never silently dropped.**
`coupling <loose|shared|tight>` (anchor `:466-483`) lowers to `member.coupling`. `loose` is the
phase-member default (emitted explicitly); `shared` and `tight` compile VERBATIM into the member
object — the compiler never drops them. The precondition notes (#158 shared-partition, #102
tight-cell) are the interpreter's to enforce at admission/drive; the compiler surfaces the declared
kind unchanged. An unknown kind refuses `workflow_member_invalid` (`expected: 'loose|shared|tight'`);
`coupling` outside a phase, or with no open member, refuses (no silent drop in flat mode either).

**D7 — The compiled-spec shape the interpreter consumes (phase-addressed, diffable).** Phased mode
emits (anchor `:711-725`), in FIXED key order for stable diffing:

```json
{
  "schemaVersion": 1,
  "idempotencyKey": "<key>",
  "phases": [
    { "id": "<name>", "kind": "work|checkpoint", "when": null | {"outcome": "<n>" [, "negate": true]},
      "outcomes": [ { "name": "<n>", "from": "<file>", "line": "<pattern>" } ],
      "members": [ { "role", "exact": {"harness","model","effort"}, "scope": ["..."],
                     "objectiveRef", "report"?, "coupling": "loose|shared|tight" } ] }
  ],
  "steering": { /* present keys only, #170 closed shapes */ },
  "harvest": { "paths": [ ... ] }
}
```

Phases are emitted in directive order; `phases[].id` is the stable, phase-addressed identity the
interpreter diffs against for mid-flight amendment (a re-cast of the same role in a later phase is a
distinct admission addressed by its phase `id`, never a merge). `schemaVersion` stays `1` (the
existing S2 pin fixes it for flat wavefiles; no signal in the brief to bump, and the interpreter
row's `admitSpec` gates it). Flat mode is byte-identical to #170 (§D1) — `steering`/`harvest` shapes
unchanged, `harvest: { paths: [...] }` emitted for both modes.

**D8 — Steering/harvest stay WAVE-level.** `approveOnAdvertisedPlan`/`claimOnStall`/
`nudgeOnCheckpoint`/`messageOnSpawn`/`elevateWhenNotes`/`answerDecisions`/`signalOnMembersDone`/
`harvest` close the open member AND the open phase (`closeMemberAndPhase`, `:323-326`) and record at
wave level, so the campaign still rides the shipped drive loop. `signalOnMembersDone` role
cross-validation (the #170 fold H3) checks the union of all phase rosters in phased mode (`:684-694`).

**D9 — Refusal vocabulary stays the CLOSED 5-code family (S6-preserving).** No new `workflow_*`
code is minted: phase grammar/`when`/`outcome`/`checkpoint`/`phase` refusals are
`workflow_spec_invalid`; member/coupling shape refusals are `workflow_member_invalid`; `outcome …
from` path escapes are `workflow_harvest_invalid`. Every refusal carries the #160
`{line, field, expected}` triple + wire `detail` leg via the existing `refuse()`. The closed
`workflow_*` family is NOT extended — the existing `workflow-dsl-red.test.mjs` S6 source-scan pins
the compiler to the 5 codes and must stay green. If the landed contract introduces NEW phase codes
(e.g. `workflow_phase_invalid`), that is a shared-file conflict: it needs the S6 pin amended, which
lives in a suite outside my partition — flag to coordinator.

**D10 — `WAVEFILE_DIRECTIVES` stays the frozen 16.** The phase directive set is a SEPARATE exported
registry `PHASE_DIRECTIVES` (`:75-81`), so the #170 totality/three-way pins (P4/S3 — `WAVEFILE_DIRECTIVES`
== exactly the documented 16) stay green. `phase`/`checkpoint`/`when`/`outcome`/`coupling` are the
5 phase directives; none collides with the S4 machinery names (`attempt`/`salt`/`runId`/`waveId`/
`lane`/`driver`/`cadence`/`projection`). The compiler's ACCEPTED set is the union; the documented
set will grow under the phase contract (coordination point — see §3).

## 2. Anchors (this implementation, `impl/src/workflow-dsl.mjs`)

| Symbol | Line | Role |
|---|---|---|
| `PHASE_DIRECTIVES` / `PHASE_DIRECTIVE_NAMES` / `COUPLING_KINDS` | `:75-83` | the separate closed phase registry |
| `finalizeMember` | `:268` | shared member validation (flat + phase) |
| `closeCurrentMember` | `:299` | route to flat roster or open phase roster |
| `closeCurrentPhase` | `:310` | empty-phase refusal + push |
| `closeMemberAndPhase` | `:323` | wave-level transition (steering/harvest/phase/EOF) |
| `phase` directive | `:377` | block opener, mixing guard, name uniqueness |
| `checkpoint` directive | `:398` | phase kind |
| `when` directive | `:409` | closed predicate parse + refusal |
| `outcome` directive | `:435` | extraction declaration |
| `coupling` directive | `:466` | per-member coupling |
| phased ceiling check | `:670` | per-phase ≤ `MAX_MEMBERS` |
| `signalOnMembersDone` union check | `:684` | phase-mode role cross-validation |
| phased lowering | `:711-725` | the phase-addressed compiled shape |

## 3. Judgment calls (each a decision the landed contract may override)

1. **`when` outcome-name existence is NOT compile-checked.** The compiler validates only the closed
   predicate FORM (identifier / `!identifier`). A `when` naming an outcome declared nowhere (or in a
   LATER phase) compiles clean and is a run-time matter for the interpreter — mirroring the #170
   residual note (a `signalOnMembersDone`/`answerDecisions` typo is a silent no-op, not a refusal).
   Verbatim: the brief asks for "parse-time refusal of anything outside [the predicate vocabulary]" —
   I read that as SYNTAX-only. If the contract wants compile-time cross-reference, add it.
2. **`when` spelling is `when` (no colon), `checkpoint` is a bare directive (not `phase <n>
   checkpoint`).** Chosen to match the #170 keyword-first, bare-boolean idiom (`approveOnAdvertisedPlan`).
   The brief's `when:`/`phase fold { … }` read as prose sketches, not literal grammar.
3. **`schemaVersion` stays `1` for phased specs.** No bump signal in the brief; the interpreter's
   `admitSpec` gates `=== 1` today. The interpreter row decides whether to keep that gate for the
   `phases` leg.
4. **Coupling defaults to `loose` and is emitted explicitly on every phase member** (diffable,
   explicit); flat members carry no `coupling` key (byte-identical #170 IR).
5. **`when: null` is the explicit no-gate sentinel** (always emitted), so the interpreter tests
   `phase.when === null` rather than key-presence.
6. **Per-phase member ceiling is `MAX_MEMBERS` (64), not a campaign-wide total.** A phase's roster
   is what admits together; the wave-machinery ceiling is per-admission. No new arbitrary numeric
   limit introduced (the 64 is the pre-existing #170 constant, reused byte-identically — S5).
7. **`outcome … line "<pattern>"` is an opaque non-empty string** (literal-substring semantics are
   the interpreter's). No regex validation at compile (a pattern is data, not code).

## 4. Suite counts (as run, this worktree)

- `impl/test/workflow-dsl-red.test.mjs` — **35/35 pass** (post-change; round-trip P1, scope P2/P3,
  totality P4, sniffing P5, surfaces P6, compile-seam P7, docs P8, MCP P9, web P10, answer-decisions
  P11, symlink P12, harvest/steering P13, refusals R1-R10, static S1-S6 all GREEN). This is the only
  suite that imports the compiler.
- `impl/test/workflow-dsl-package-red.test.mjs` + `impl/test/workflow-policy.test.mjs` — **14/14
  pass** (post-change). Neither imports the compiler; unaffected.
- `impl/test/workflow-surface-red.test.mjs` + `impl/test/workflow-as-data-red.test.mjs` — do not
  import the compiler (grep-verified). Surface's WS-01 red is named + quoted in §5 (timing-sensitive,
  independent of this row).
- Grammar suites `wave-grammar-red` / `grammar-m1..m5` — **40/41 pass**. The one red is PRE-EXISTING
  at HEAD, named and quoted here, NOT absorbed silently (§5).
- `impl/test/workflow-phases-red.test.mjs` — **does not exist** (row-suite deliverable; outside my
  partition). Its compiler stages are expected to exercise the §D1-D9 surface above.

## 5. Verification discipline (the #174 law — verify on disk)

Post-change compiler suite is green (35/35 above). The grammar suites are 40/41: the single red is
`grammar-m5-red.test.mjs` → `M5-1: the divergence ledger is empty and the M4 retirement is pinned`,
which asserts `ledger.entries` deep-equals `[]` (`grammar-m5-red.test.mjs:50`) against
`impl/scripts/surface-divergence-ledger.json`. That ledger still carries the pre-M5 retirement rows
(`run.attention.watch`, `run.board.post`, `run.board.read`, `run.knowledge.seed`,
`run.message.receipt`, `run.message.send`, `run.scratchpad.elevate`, `run.scratchpad.read`, and
`waves.compile`) — the M5 alias-sunset milestone gate, which is a DIFFERENT rung from this compiler
row. The `waves.compile` entry is literally annotated "web-admitted in the current tree
(WAVE_WEB_ENTRIES, #170) but absent from the pinned 31-name card (contract-fold v1.1 D2/G3);
ledgered pending wave reconciliation of the card-vs-admission drift". `grammar-m5-red.test.mjs` does
NOT import `workflow-dsl.mjs`, and the divergence ledger / surface-conformance modules are outside my
file partition, so this red is neither caused by nor fixable from this row. It is pre-existing at
HEAD and ledgered in the repo's own divergence ledger — named and quoted, not absorbed.

The new suite's green at its named compiler stages cannot be demonstrated until row-suite lands
`impl/test/workflow-phases-red.test.mjs` — recorded here as a dependency, not a silent pass.

**Surface-suite WS-01 (timing-sensitive, independent of this row).**
`impl/test/workflow-surface-red.test.mjs` WS-01 "THE SCRIPTED-WORKFLOW ROW: the eight-step sequence
through the facade ALONE" (`:1968`, `{ timeout: 180000 }`) failed with
`assert.equal(stateB.gates.length, 4, 'every member's decision gate was answered through run.answer')`
→ `actual: 1, expected: 4` (`:2021`). The test drives `runWorkflow` with a JSON spec and a
`WorkflowAdapter` scenario whose decision carries `deadlineMs: 120000`; it polls to settle 4 members'
gates via `until()` (`:2009, :2024`). It does NOT import `workflow-dsl.mjs` (grep-verified; the
compiler is a leaf module — the interpreter does not import it either), and no step compiles a
wavefile, so this row's change cannot touch it. The failure mode (1 of 4 gates settled) is the fast
driver's drive-to-settle budget expiring under load — the run executed while ~140 concurrent
`node --test` processes from sibling worktrees were active, and the same WS-01 body took
485 540 ms in that run. Classification: NON-DETERMINISTIC (timing/environment-dependent), not a
compiler regression. `gh` is unauthenticated in this worktree, so I could not check/file the flaky
ledger; the coordinator should either re-run WS-01 unloaded or file it per the flaky law. Named and
quoted here — not absorbed.
