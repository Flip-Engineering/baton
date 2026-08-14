[attempt: b59fa92f-986a-4555-b3ce-eb1cb2b09ebf row-impl-compiler]
# impl-compiler-notes — the phase directives in the DSL compiler

Date: 2026-08-14 · Attempt: `b59fa92f-986a-4555-b3ce-eb1cb2b09ebf` · Role: `row-impl-compiler`.
Authority: `redrive3/row-impl-compiler-brief.md` + `row-contract-brief.md` + the #170 contract
(`docs/reference/evidence/workflow-dsl-2026-08-13/workflow-dsl-contract.md` v2 FOLDED) — the grammar
idiom the phase layer must match.

## 0. Await-inputs status (a judgment call, recorded honestly)

The await-inputs discipline polls for `phase-grammar-contract.md` AND `suite-notes.md` in this
directory before code. Both were **absent at compile time** across every poll (30s cadence, and the
whole worktree was re-scanned: `redrive3/`, the parent `phase-grammar-2026-08-14/`, and every sibling
`ws-*` worktree under `.baton/wt/`). `gh` is unauthenticated in this worktree, so the #170 north-star
issue could not be fetched either. The other rows (contract/suite/interpreter) are separate
dispatches in separate worktrees; their outputs do not land in this worktree.

I did NOT idle. The `row-impl-compiler-brief.md` + `row-contract-brief.md` name the feature set with
enough precision to implement, and the #170 contract pins the idiom (line grammar, `{line, field,
expected}` triple, closed `workflow_*` family, `WAVEFILE_DIRECTIVES` registry). I grounded the
grammar in those and recorded every spelling decision below as a judgment call, so the coordinator
and the interpreter row can spot-audit against this file. If the contract lands with different
token spellings, the diff is mechanical and local to `workflow-dsl.mjs` (this row's partition).

## 1. What landed (the compiler half only)

`impl/src/workflow-dsl.mjs` now lowers BOTH the #170 16-directive wave grammar AND the phase-level
campaign grammar from the SAME line-oriented seam (`compileWavefile`). Semantics (sequencing,
outcome extraction at settle, checkpoint park/resume, amendment) are interpreter-side and are NOT
implemented here.

- A wavefile with NO `phase` directive compiles **byte-identical** to the #170 output. The wave
  registry `WAVEFILE_DIRECTIVES` is untouched (still 16 entries — the P4/S3 totality pins hold), so
  every existing DSL/workflow suite stays green.
- A wavefile WITH `phase` blocks lowers to the campaign spec the interpreter consumes:
  `kind: "campaign"` + `phases[]`, phase-addressed by `name`.

## 2. The phase grammar (decisions — the spelling I chose, anchored)

### 2.1 Directive vocabulary (a SEPARATE closed registry, `PHASE_DIRECTIVES`)

| Directive | Arity | Tokens | Lowers to |
|---|---|---|---|
| `phase <name> [checkpoint]` | 1–2 | `<name>` one identifier; optional literal `checkpoint` | open a phase; `kind` = `member` (default) or `checkpoint` |
| `when <predicate>` | 1–3 | the CLOSED predicate vocabulary (§2.2) | `phases[].when` |
| `outcome <name> from <file> line <pattern>` | 5 | `name` `from` `file` `line` `pattern` | `phases[].outcomes[]` = `{name, from, line}` |
| `coupling <value>` | 1 | `loose`/`shared`/`tight` | `phases[].members[].coupling` |

`phase`, `when`, `outcome` are phase-block sub-directives (they close the open member; `phase` also
closes the open phase). `coupling` is a member sub-field (requires an open member AND an open phase).
Member sub-fields inside a phase are the existing `harness`/`model`/`effort`/`objectiveRef`/`report`/
`scope` — reused verbatim, no new spelling. `PHASE_DIRECTIVES` is disjoint from `WAVEFILE_DIRECTIVES`
(never folded into the 16) so the #170 totality/closure pins are untouched.

### 2.2 The CLOSED `when:` predicate vocabulary (parse-time refusal, no eval)

Accepted shapes (the ONLY shapes — anything else refuses `workflow_spec_invalid` with
`field: 'when'`, `expected: '<outcome> | !<outcome> | <outcome> == "<value>" | <outcome> != "<value>"'`):

| Shape | Emitted `when` object |
|---|---|
| `<outcome>` | `{ outcome, op: 'exists' }` |
| `!<outcome>` | `{ outcome, op: 'not' }` |
| `<outcome> == "<value>"` | `{ outcome, op: 'eq', value }` |
| `<outcome> != "<value>"` | `{ outcome, op: 'neq', value }` |

Outcome names are validated against `IDEMPOTENCY_PATTERN`. No `>`/`<`/`&&`/`||`/`in`/function call —
the vocabulary is equality/negation over named outcomes, per contract-brief #3. The compiler refuses
ONLY on the vocabulary (syntax), not on whether the named outcome is declared — mirroring the #170
§3 residual (`answerDecisions` keys), a `when` naming an undeclared outcome is a named residual, not
a refusal (interpreter-side cross-validation).

### 2.3 Coupling (loose / shared / tight — never silently dropped)

`coupling` values are the closed `loose|shared|tight` (`COUPLING_VALUES`). A phase member emits
`coupling` ALWAYS (default `loose` when the directive is absent) — the declaration is never dropped,
and `shared`/`tight` carry through verbatim so the interpreter can attach the #158 (shared partition)
and #102 (tight cell) precondition notes. A `coupling` outside the closed set refuses
`workflow_member_invalid {field: 'coupling', expected: 'loose|shared|tight'}`; `coupling` with no
open member refuses `{field: 'coupling', expected: 'member <role>'}`; `coupling` with no open phase
refuses `{field: 'coupling', expected: 'phase <name>'}`.

### 2.4 Structure rules (the honest refusals)

- A campaign is EITHER wave-structured (top-level `member`) OR phase-structured — never both. `phase`
  after a top-level member refuses; a top-level `member` after phases began refuses.
- Phase names are unique (phase-addressed identity). Duplicate phase name refuses.
- Outcome names are unique ACROSS the campaign (a `when` gate references them by bare name).
- A phase must hold ≥ 1 member (a checkpoint phase still names its worker). An empty phase refuses.
- Role uniqueness is PER-PHASE: a role re-cast across phases is a fresh admission (the contract's
  roster re-cast), so the SAME role may appear in multiple phases; it may not repeat within one phase.
- Per-phase member ceiling `MAX_MEMBERS` (64).
- The wave-level `scope` default (top-level `scope` before any member/phase) applies to every phase
  member lacking its own override; a `scope` after phases began must name an open member.
- `signalOnMembersDone` roles are cross-validated against the campaign's declared roles — the UNION
  of every phase roster (a role re-cast across phases still names a member).

## 3. The compiled-spec shape (the interpreter's input)

Wave lowering (no phases) is byte-identical to #170 (`schemaVersion`, `idempotencyKey`, `members`,
`steering`, `harvest`). Campaign lowering adds `kind` and replaces `members` with `phases`:

```json
{
  "schemaVersion": 1,
  "idempotencyKey": "<campaign key>",
  "kind": "campaign",
  "phases": [
    {
      "name": "<phase name>",
      "kind": "member" | "checkpoint",
      "when": { "outcome": "<name>", "op": "exists|not|eq|neq", "value": "<literal>"? },
      "outcomes": [ { "name": "<n>", "from": "<file>", "line": "<pattern>" } ],
      "members": [
        { "role": "<role>", "exact": { "harness", "model", "effort" }, "scope": ["..."],
          "objectiveRef": "<path>", "report": "<path>"?, "coupling": "loose|shared|tight" }
      ]
    }
  ],
  "steering": { ... },
  "harvest": { "paths": [ ... ] }
}
```

- `when` is omitted when absent; `value` is omitted for `exists`/`not`.
- Phase key order is deterministic: `name` → `kind` → `when` → `outcomes` → `members` (diff-stable).
- `phases` is an ordered array; `name` is the phase address (mid-flight-amendment diff identity).
- `steering` and `harvest` stay top-level (shared across the campaign).

## 4. Anchors (file → line, the working tree)

- `PHASE_DIRECTIVES` registry: `impl/src/workflow-dsl.mjs:76-81`.
- `COUPLING_VALUES` + `WHEN_PREDICATE_SHAPE`: `:84-88`.
- `parseWhenPredicate` (closed vocabulary): `:282-301`.
- `validateOutcomeFile` (lexical path class): `:306-312`.
- `closeCurrentMember` (per-phase roster target + coupling): `:343-349`.
- `closeCurrentPhase` (≥1 member, ceiling, phase-addressed emit): `:354-372`.
- `phase` / `when` / `outcome` / `coupling` dispatch: `:417-442` / `:444-456` / `:458-482` / `:484-501`.
- `scope` placement (wave default gated on `!phaseStarted`): `:527`.
- campaign-vs-wave return: `:718-734`.

## 5. Judgment calls (each recorded)

1. **Absent contract/suite-notes → grounded in the briefs + #170 contract.** (§0.) The spellings
   below are my calls, not the contract's; a later contract diff is mechanical.
2. **`PHASE_DIRECTIVES` is a SEPARATE registry, never folded into `WAVEFILE_DIRECTIVES`.** The #170
   P4/S3 pins `WAVEFILE_DIRECTIVES` at exactly 16 — folding `phase`/`when`/`outcome`/`coupling` into
   it would break existing suites, and the brief's own back-compat bar ("ALL existing DSL/workflow
   suites stay green") forbids that.
3. **`compileWavefile` stays the ONE seam**; it auto-detects the phase grammar (a `phase` directive
   present) and branches to the campaign lowering. No second entry point.
4. **Predicate ops** named `exists`/`not`/`eq`/`neq` (data, not code); the `when` value is a literal
   string. No eval, no expression DSL.
5. **`coupling` is emitted ALWAYS** for phase members (default `loose`) — explicit and diffable,
   never silently dropped. The #158/#102 precondition notes attach at the interpreter; the compiler
   carries the declaration through verbatim.
6. **Per-phase role uniqueness** (re-cast across phases allowed) — not global uniqueness.
7. **A phase must hold ≥ 1 member** (a checkpoint still names its worker); an empty phase refuses.
8. **`when` is vocabulary-only at compile time** — no outcome-reference cross-validation (the #170
   §3 residual mirror).
9. **Steering/harvest directives do not close the open phase** (they close the open member only; the
   phase closes at the next `phase` or EOF). Minimal-change, and the phase object persists correctly
   either way.
10. **`outcome` `from` path is lexical-only** (no realpath/read) — it names a to-be-harvested file
    that may not exist at compile time.
11. **`PHASE_DIRECTIVES` is exported but NOT yet wired into the generated-docs/conformance scripts**
    (`render-surface-docs.mjs` / `surface-conformance.mjs` import only `WAVEFILE_DIRECTIVES`). Wiring
    the phase table into those is out of this row's partition (they are `impl/scripts/**`); named as a
    follow-on, not silently dropped.

## 6. Verification (suite counts, pasted)

- `node --test impl/test/workflow-dsl-red.test.mjs` → **35/35** (the compiler's own suite, unchanged).
- `node --test impl/test/workflow-dsl-package-red.test.mjs impl/test/workflow-policy.test.mjs` → **14/14**.
- `node impl/scripts/surface-conformance.mjs` → **surface-conformance: ok** (exit 0).
- Grammar suites: `grammar-m1-red` 6/6 · `grammar-m2-red` 10/10 · `grammar-m3-red` 8/8 ·
  `grammar-m4b-red` 7/7 · `grammar-m5-red` **4/5 (one PRE-EXISTING red, `M5-1 — the divergence
  ledger is empty and the M4 retirement is pinned`; unrelated to this row — it predates and is not
  touched by the compiler)**.
- Phase smoke (this row, direct `compileWavefile` calls): checkpoint kind ✓ · member re-cast across
  phases ✓ · `when` exists/not/eq/neq ✓ · bad `when` refuses the closed vocabulary ✓ · bad
  `coupling` refuses `loose|shared|tight` ✓ · duplicate outcome/phase name refuse ✓ · member+phase
  mix refuses ✓ · empty phase refuses ✓ · wave lowering stays byte-identical (no `kind`/`phases`/
  `coupling` keys) ✓.
- `node --test impl/test/workflow-as-data-red.test.mjs impl/test/workflow-dsl-package-red.test.mjs
  impl/test/workflow-policy.test.mjs` → **40/44** (the 4 reds all in `workflow-as-data-red`).
- `node --test impl/test/workflow-as-data-red.test.mjs` alone → **24/30** — six reds, all the SLOW
  end-to-end interpreter/application tests (each 2.5–18 min then fail): `W2-01` (a 4-member
  suite-drafting wave runs from a spec), `W3-checkpoint` (nudge+claim), `W3-elevate`,
  `W3-elevate-bounds` (elevate dedup), `W3-signal` (signal-on-members-done), `W4-02` (mixed harvest
  / named harvest_miss). These are PRE-EXISTING at HEAD and flaky under load: the same suite showed
  4 reds in one run and 6 in another (the 6-red run ran concurrently with three other full-`node
  --test` processes importing the 712 KB `application.mjs`, so the timing-sensitive drive-to-settle
  tests timed out harder). They import the interpreter (`workflow-interpreter.mjs` /
  `application.mjs` / `recipes.mjs`), drive waves via JSON specs, and never reach `compileWavefile`
  — they are the interpreter row's domain, not this partition, and the compiler change cannot reach
  them (the no-phase lowering is byte-identical, and `workflow-dsl-package-red` 12/12 drives the
  compile seam end-to-end green).
- `workflow-surface-red` was not completed in-session (imports the 712 KB `application.mjs`). It does
  not import the compiler directly; its only reach is the byte-identical no-phase lowering, covered
  by `workflow-dsl-red` (35/35) and `workflow-dsl-package-red` (12/12, drives `waves.compile`/
  `waves.run` end-to-end).

## 7. Anything not green / residual

- `when` naming an undeclared outcome compiles clean (interpreter-side cross-validation — the #170
  §3 residual pattern). Not a refusal.
- `PHASE_DIRECTIVES` not yet rendered into the generated surface docs / conformance leg (out of
  partition; follow-on).
- The `workflow-phases-red.test.mjs` suite is the suite row's deliverable; its compiler stages are
  expected to green against the shape in §3. I could not run it (absent at compile time).
