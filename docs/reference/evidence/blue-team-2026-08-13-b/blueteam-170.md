[attempt: 2344e0b7-8929-4768-bbcf-695ec5dcb0c6 row-bt170]
# #170 BLUE-TEAM REPORT — attack on the workflow-dsl-red suite (the impl gate)

- **Row:** `row-bt170` (v4-pro seat — the campaign's deepest pass). Frame: `blue-team-2026-08-13-b/foundry-brief.md` (wave-b blue-team law — cheapest-wrong-impl per capability row, pin-bite per pin, split-twice, law re-check, attempt-echo).
- **Target:** `impl/test/workflow-dsl-red.test.mjs` (31 rows: 5 PIN green + 26 capability red; the #170 red-first acceptance suite for the v2 FOLDED contract, header `[attempt: ea57954b-95c1-4918-a494-41b0249738ee row-suite-170]`).
- **Authority contract:** `docs/reference/evidence/workflow-dsl-2026-08-13/workflow-dsl-contract.md` (v2 FOLDED). Companions read: `fold-170.md` (blocker→resolution map), `redteam-170.md` (4 blockers + amendments), `suite-draft-notes.md` (row↔stage table + plausible-wrong-impl audit). The attack is against the SUITE's ability to enforce that intent — the contract is the map, not the target.
- **Verification HEAD:** this worktree is pinned to `e371f70` (the suite's own declared HEAD). The suite file is not present in this worktree (it landed after `e371f70`); it was read from master and temporarily copied in to run the split, then removed. `git status` clean at close.

---

## 0. Split record (split-twice, run from the repo root, worktree at HEAD `e371f70`)

```
node --test impl/test/workflow-dsl-red.test.mjs
```

| Run | tests | pass | fail | Result |
|---|---|---|---|---|
| Run 1 | 31 | 5 | 26 | 5 PIN rows green; 26 capability rows red |
| Run 2 | 31 | 5 | 26 | identical split (stable) |

Both runs match the suite's declared split record and the suite-draft-notes measured splits exactly
("31 tests, 5 pass / 26 fail"; the 5 PIN rows green; the 26 capability rows red). **Split-twice law:
satisfied.** The 5 green rows are PIN-A…PIN-E at their named stages; the 26 red rows split into
**20** failing at `workflow_dsl_compile_missing` (P1–P5, P7, R1–R9, S1–S5 — the compiler module
`impl/src/workflow-dsl.mjs` is absent) and **6** failing at their own named source-scan/registry
stages (P6 `surfaces-parity-cli`, P8 `generated-docs-render`, P9 `mcp-triple-specDsl`, P10
`web-triple-specDsl`, OQ6 `registry-seam-compile-row`, R10 `head-seam-compile`). The
`workflow_dsl_admission_seam_missing` stage named in the suite header for P1/P2/S2 is a **latent**
stage — `compiler()` throws before `admission()` is reached, so it never fires at HEAD (honest
sequencing, recorded in §2).

---

## 1. Per-row verdicts

### Capability rows (RED at HEAD) — cheapest wrong impl per row

| Row | Verdict | Cheapest wrong impl that turns it green (or none found) |
|---|---|---|
| P1 `[roundtrip]` | **SHALLOW** | Hardcode the two known inputs — `if (text.includes('contract-foundry-2026-08-13-wave-a')) return <Appendix-A IR>; if (text.includes('minimal-wave')) return <minimal IR>`. Both are `admitSpec`-accepted and canonical-equal, so the round-trip passes. Backstopped by P2/P3/P5/R-rows (different inputs). |
| P2 `[scope-default]` | **SHALLOW** | Hardcode Appendix A + the single `override` wavefile (alpha `['only-alpha/**']`, beta `['shared/**']`) + commit the fixture file. The fixture leg (B2) is a genuine durable-artifact pin — that half is SOUND — but the IR-equality legs are hardcodable. |
| P3 `[no-deeper-inheritance]` | **SHALLOW** | Hardcode the one `no-deeper` input → `{members:[{scope:['a/**','b/**'],…}], steering:{}, harvest:{paths:[]}}`. One branch. |
| P4 `[total-coverage]` | **SOUND** | None found. The cheapest green is a 16-name `WAVEFILE_DIRECTIVES` table — which IS the correct registry data. It bites a registry that omits/renames a directive or exposes `schemaVersion`. (It does NOT prove the parser *behaves* — see finding 1, the `answerDecisions` hole.) |
| P5 `[sniffing]` | **SHALLOW** | Two hardcodable refusals (`[not-json]` → line-1 `wave <key>`; `member`-first → line-1 `wave <key>`). The JSON-half of the discriminator is PIN-A (green) and the seam flip is R10, so this row adds only the compiler-side totalness. |
| P6 `[surfaces-parity]` | **SHALLOW** | Registration-level: parse a `waves.compile` verb (never proves dispatch), drop `waves_compile`/`specDsl` tokens into `web-northbound.mjs`, add `baton_waves_compile` to the MCP tool names, and add any `compile:` anywhere in `application-client.mjs`. The facade leg `/\bcompile\s*:/` is over-broad (matches an unrelated `compile:`) AND under-broad (misses method-shorthand `compile(text) {}`) — finding 4. |
| P7 `[compile-seam]` | **SHALLOW** | Idempotence on the fixed Appendix A input is satisfied by any deterministic function, incl. a hardcode. The export leg (`no runWorkflow/run/start`) is SOUND — it bites a compiler that re-exports a wave-starting surface. |
| P8 `[generated-docs]` | **SHALLOW** | Add a dead `renderWavefileGrammar` stub + a `wavefile` token to `surface-conformance.mjs`. No regenerator-vs-committed byte compare (contrast blueteam-155's PT-10), so a hand-written table passes. |
| P9 `[mcp-triple]` | **SHALLOW** | Add `specDsl` to the inputSchema (within 600 chars of `baton_waves_run`) and the token `compileWavefile` anywhere in `mcp-northbound.mjs`; never wire the compile, never drive a real MCP wire call. The B4 `detail` leg is pinned only as `assertRefusal` on R1/R3–R9, not on the MCP wire. |
| P10 `[web-triple]` | **SHALLOW** | Add dead `specDsl` + `startsWith('workflow_')` strings to `web-northbound.mjs`. Gated on #160 R3 (contract N1), which has not landed — so this row cannot go green until an out-of-rung dependency ships. |
| OQ6 `[registry-seam]` | **SOUND** | None found. Pins the registry row itself — `waves.compile` on exactly `['cli','embedded','mcp','web']` with `effect:'observe'`, and `waves.run` gaining `web`. Bites a ghost-row surface set or a non-observe effect (DR-2). |
| R1 `[unknown-directive]` | **SHALLOW** | `if (text.includes('memberr')) throw <exact triple>`. One branch. Only ONE unknown-directive name is ever fed, so a single-token special case passes — finding 5. |
| R2 `[member-missing-fields]` | **SHALLOW** | Hardcode the missing-fields input. The *order* pin (field = `exact.harness`, never `objectiveRef`) is real teeth against a wrong-order impl, but the specific input is hardcodable. |
| R3 `[member-no-scope]` | **SHALLOW** | Hardcode the no-scope input → `{field:/member…/, expected:'non-empty scope'}`. One branch. |
| R4 `[duplicate-role]` | **SHALLOW** | Hardcode the dup-role input → line-8 refusal. One branch. |
| R5 `[messageOnSpawn-bad-kind]` | **SHALLOW** | Hardcode `messageOnSpawn async` → the kind-enum refusal. One branch. |
| R6 `[elevate-bad-kind]` | **SHALLOW** | Hardcode `elevateWhenNotes doubt,secret` → the kinds-enum refusal. One branch. |
| R7 `[bare-directory-scope]` | **SHALLOW** | Hardcode the bare-directory scope → `'"<dir>/**"'`. One branch. |
| R8 `[absolute-harvest-path]` | **SHALLOW** | Hardcode `harvest /abs/path` → the path-class refusal. One branch. |
| R9 `[bad-idempotency-key]` | **SHALLOW** | Hardcode `wave "bad key!"` → the pattern refusal. One branch. |
| R10 `[head-seam]` | **SHALLOW** | Add dead `compileWavefile` + `specDsl` tokens to `application.mjs`. Never drives `waves run <dsl>` end-to-end, so a seam that reads+sniffs but compiles wrongly passes. |
| S1 `[no-eval-no-fs]` | **SOUND** | Bites `eval(`/`new Function`/`import(` and the read surface. But the realpath gate is **unpinned**: the disjunction `includes('realpathSync') || !includes("from 'node:fs'")` passes for a compiler with NO fs import (and hence no containment), and a top-level ungated `import { realpathSync } from 'node:fs'` also passes — finding 2. |
| S2 `[no-driver-schemaVersion]` | **SHALLOW** | Same two-fixture hardcode as P1, without the `driver` field. Backstopped only by the same inputs. |
| S3 `[three-way-invariant]` | **SHALLOW** | A 16-name registry ⊆ the hardcoded `CLOSED_DIRECTIVES` + a stub `renderWavefileGrammar` token. The documented⇄parsed⇄admitted proof is a source-scan, never a conformance-main run. |
| S4 `[closure]` | **SOUND** | None found. Bites a directive named `attempt`/`salt`/`runId`/`waveId`/`lane`/`driver`/`cadence`/`projection`. The cheapest green is "don't name machinery", which is the correct closure. |
| S5 `[constants]` | **SOUND** | Bites an inline-constant desync (byte-identical `IDEMPOTENCY_PATTERN`/`MAX_MEMBERS`/`MESSAGE_KINDS`/`SCRATCHPAD_KINDS`). BUT the contract's "shared closed-constants module" alternative is **unsatisfiable by this row** — finding 3. |

### PIN rows (GREEN at HEAD) — the plausible wrong impl each bites

| Row | Verdict | Plausible wrong impl it kills (or decorative) |
|---|---|---|
| PIN-A `[interpreter-json-only]` | **SOUND** | Kills moving the DSL compile INTO the interpreter's string load — the most obvious lazy impl (where `JSON.parse` already sits, D4 forbids it). A compile-in-interpreter impl makes `runWorkflow(stub, dslFile)` compile the text instead of refusing `workflow_spec_invalid` "not valid JSON", flipping PIN-A red. |
| PIN-B `[closed-refusal-vocabulary]` | **SOUND (narrow)** | Pins the interpreter's 5-code admission family (a true G5 ground truth — bites an interpreter edit). Its negative leg `!includes("'workflow_compile_invalid'")` is **decorative**: it scans the INTERPRETER for a code only the COMPILER could mint. A compiler minting a 6th code (`workflow_dsl_invalid`) passes PIN-B; only R1–R9's exact-code assertions give partial cover, and no row scans the compiler's own `workflow_*` literals — finding 6. |
| PIN-C `[closed-field-sets]` | **SOUND** | Kills an interpreter field-set edit (the DSL totality target drifting — a plausible impl "extending" the interpreter to express a DSL-only field). Byte-string extract + exact-list compare. |
| PIN-D `[schemaVersion-fixed]` | **SOUND** | Kills the interpreter emitting a schemaVersion other than 1 or a non-empty harvest default (`{ paths: [] }`). |
| PIN-E `[mcp-lane-crafted-detail]` | **SOUND** | Kills dropping the `cause?.detail` forward in `mcp-northbound.mjs` — the wire leg the compiler triple rides (P9's seam). Token-level (not LANE_CRAFTED-scoped), but a real seam pin. |

**No PIN row is fully decorative; no capability row is trivially green by accident.** The suite's teeth
are collective: the 20 compiler rows probe ~15 distinct input texts (each a different grammar rule),
so no single wrong impl short of the real parser passes the union — EXCEPT where a directive or a
behavior is left unprobed (findings 1–2).

### Pin bite-tests (empirical — reproduced this session)

Green-for-the-right-reason, then the flip. The string-scan pins (PIN-B/C/D/E) were bite-tested by
mutating the exact source byte each reads and re-running the pin's assertion shape; PIN-A is behavioral
and was bite-tested against the live interpreter.

| Pin | Green reason at HEAD `e371f70` (real source, not a fixture) | Wrong impl simulated | Flip |
|---|---|---|---|
| PIN-A | the interpreter JSON-only string path refuses `workflow_spec_invalid` "not valid JSON" at `workflow-interpreter.mjs:499` (live `runWorkflow(stub, dslFile, {repoRoot})` — the split's green row) | move the compile INTO the interpreter's string load (D4-forbidden) | the `wave …` text then compiles instead of `JSON.parse`-refusing — its refusal is a member-shape code, not `workflow_spec_invalid`/`not valid JSON` → PIN-A's predicate `code === 'workflow_spec_invalid' && /not valid JSON/` is **false** |
| PIN-B | the 5 admission codes are the interpreter's only `workflow_*` constructors (`workflow-interpreter.mjs:29-33`) | mint a 6th admission code | `!includes("'workflow_compile_invalid'")` → **false** (probe: HEAD true → mutated false) |
| PIN-C | `SPEC_FIELDS`/`MEMBER_FIELDS`/`EXACT_FIELDS`/`STEERING_FIELDS` declared exactly as pinned (`workflow-interpreter.mjs:48-51`) | drop a field from a closed set | `extract` + `deepEqual` → **false** (probe: dropped `'harvest'` from `SPEC_FIELDS` → false) |
| PIN-D | `raw.schemaVersion !== 1` (`:139`), `schemaVersion: 1` (`:157`), `{ paths: [] }` (`:146`) all present | widen the guard to `!== 2` | `includes('raw.schemaVersion !== 1')` → **false** (probe: mutated false) |
| PIN-E | `cause?.detail ?? null` forward in the LANE_CRAFTED arm (`mcp-northbound.mjs:1654`) | drop the `cause?.detail` forward | `/cause\?\.detail/u` → **false** (probe: HEAD true → mutated false) |

Every pin is green for the right reason and flips red under its named wrong impl — none is a
staged fixture or a vacuous true. The one carve-out is PIN-B's *negative* leg: it bites an
interpreter-side 6th code, but a **compiler**-side 6th code is invisible to it (finding 6).

---

## 2. Law re-check (frame checklist against the suite)

- **Named stages on every capability row** — yes: every capability test name carries its canonical
  stage (`[roundtrip]`, `[scope-default]`, …, `[constants]`) and every assertion message carries the
  granular `stage[<…>]`. The 20 compiler rows fail at `workflow_dsl_compile_missing`; the 6
  surface/registry/source-scan rows fail at their own named stages (verified in §0). The
  `workflow_dsl_admission_seam_missing` stage is latent at HEAD (compiler throws first) — honest
  sequencing, no wrong-reason red.
- **Hermetic (mkdtemp + after-cleanup, no network/provider)** — yes: `mkdtempSync` + `t.after`/
  `finally` cleanup; `runWorkflow` in PIN-A is driven against an in-process stub `{waves:{start(){}}}`,
  no network, no provider, no host state.
- **No clocks as controls** — yes; no `Date`/timers anywhere in the suite.
- **Namespace imports for invented surfaces** — yes; imports only real exports (`runWorkflow`,
  `APPLICATION_SEMANTIC_REGISTRY`, `parseBatonCli`, `mcpApplicationToolNames`); the compiler is loaded
  by dynamic `import('../src/workflow-dsl.mjs')` and `admitSpec` via a named-stage `admission()` loader.
- **Sorted-key literals ACTUAL order** — yes; object literals use sorted-key form or are compared via
  the local `canonicalJson` (key-order-free); no `localeCompare`.
- **watchdog.stallMs 60_000 + comment** — N/A: the suite is fully synchronous (no timers, no awaited
  I/O beyond the dynamic import); a stall watchdog would be dead weight.
- **No absolute line-window anchors (#166)** — yes; ORDER/EXISTENCE/byte-string assertions only. The
  P9 `[\s\S]{0,600}` window is a proximity bound, not a line anchor.
- **Verbatim `[attempt: …]` line in the suite header** — yes (line 2).

---

## 3. Findings (blue-team, against the contract's intent)

1. **[missing-row / HIGH] `answerDecisions` has zero behavioral coverage — a compiler that omits or
   mangles it passes the whole suite.** The 16-directive totality claim (P4, S3) is pinned only at the
   registry level: P4 checks `WAVEFILE_DIRECTIVES` *lists* `answerDecisions`; no test ever feeds an
   `answerDecisions "<pattern>" "<value>"` line through `compileWavefile` and asserts
   `steering.answerDecisions.policy[pattern] === value`. `answerDecisions` is the ONLY directive with
   no behavioral row (all 15 others are driven by Appendix A, P2/P3, or R1–R9). A compiler that
   registers `answerDecisions` but never implements it (or drops the repeatable-policy accumulation)
   turns every row green. The contract's D1 (arity 2, repeatable, `policy[pattern]=value`) is
   unenforced. **Fix:** add a row — compile `answerDecisions "q1" "opt1"` (and a second repeat to
   prove accumulation) → assert `ir.steering.answerDecisions.policy.q1 === 'opt1'` and both entries
   present.

2. **[oracle-weakness / HIGH] B3's realpath containment — the compiler's ONLY filesystem syscall and
   its security purpose — is unpinned, and suite-draft-notes JC6's claim that it is exercised is
   false.** S1's gate is the disjunction `src.includes('realpathSync') || !src.includes("from
   'node:fs'")`: a compiler with NO fs import (hence no containment at all) passes, and a top-level
   ungated `import { realpathSync } from 'node:fs'` passes too. No row creates a symlink and feeds it
   as a `harvest`/`scope` path, so a compiler that skips the symlink-escape check entirely (violating
   B3 / S1 "gated behind repoRoot") passes the whole suite. suite-draft-notes judgment call 6 states
   the gating is "a behavioral leg exercised by the round-trip rows" — the round-trip rows (P1/P2)
   feed only benign relative paths in a fresh `mkdtemp`; they exercise nothing. **Fix:** add a
   symlink-escape row — `harvest` a path that is a symlink resolving outside `repoRoot`, assert
   `workflow_harvest_invalid` when `repoRoot` is provided (and that the same text compiles when
   `repoRoot` is omitted — pinning the gating itself).

3. **[drift / MEDIUM] S5's shared-constants-module alternative is unsatisfiable by the suite.** The
   contract S5 sanctions "OR both modules import one shared closed-constants module". S5's assertions
   require the COMPILER source to declare inline `IDEMPOTENCY_PATTERN = /…/` (`:744`), `MAX_MEMBERS =
   N` (`:750-752`), and `MESSAGE_KINDS = new Set([…])` / `SCRATCHPAD_KINDS = new Set([…])`
   (`:753-759`) — a correct shared-module impl (an `import { … } from './workflow-closed.mjs'`) makes
   `compilerPattern`/`compilerCeiling`/`compilerEnum` `undefined` and fails. A contract-faithful
   implementer choosing the shared module is rejected by the suite. **Fix:** accept either form — e.g.
   allow the shared-module case by also admitting a compiler source that contains the constant NAMES
   without the inline `= …` literal (or drop the "shared module" alternative from S5/OQ2 so contract
   and suite agree). **Probe (this session):** S5's exact regexes run against a representative
   shared-module compiler source (`import { IDEMPOTENCY_PATTERN, MAX_MEMBERS, MESSAGE_KINDS,
   SCRATCHPAD_KINDS } from "./workflow-closed.mjs"`) yield `compilerPattern = undefined`,
   `compilerCeiling = undefined`, and `MESSAGE_KINDS`/`SCRATCHPAD_KINDS` `compilerEnum = undefined` —
   all three `assert.ok` legs FAIL; only the final `includes('MESSAGE_KINDS') && includes('SCRATCHPAD_KINDS')`
   leg passes. The shared-module alternative is demonstrably unsatisfiable by S5 as written.

4. **[fragility / MEDIUM] P6's facade leg `/\bcompile\s*:/` is both over- and under-broad.** It
   matches any `compile:` property anywhere in `application-client.mjs` (an unrelated object or a
   comment passes) and it misses a method-shorthand `compile(text) {}` on the `waves` accessor (a
   correct impl would fail this leg). The CLI leg (`parseBatonCli(['waves','compile',…])`) is the real
   check but stops at the parse — it never proves the verb dispatches to the compile seam. **Fix:**
   scope the facade check to the `waves` accessor (e.g. `/waves[\s\S]{0,400}compile/`) and accept both
   property and shorthand spellings.

5. **[oracle-weakness / LOW] R1 tests a single unknown-directive name.** A one-token special case
   (`if (token === 'memberr') throw …`) turns R1 green. The contract's unknown-directive refusal
   (`expected: '<closed directive list>'`) should hold for ANY token. **Fix:** drive 2–3 distinct
   unknown names (`memberr`, `harnes`, `signalOnMembersDonee`) and assert each is named in `field`
   with the same closed-list `expected` — kills a hardcoded single-name impl.

6. **[decorative-leg / LOW] PIN-B's "no 6th admission code" guard scans the wrong module.** The
   `!src.includes("'workflow_compile_invalid'")` check runs against `workflow-interpreter.mjs`, but a
   compiler-minted 6th code lives in `workflow-dsl.mjs` — PIN-B can never see it. R1–R9's exact-code
   assertions provide partial cover for the probed inputs only. **Fix:** a source-scan row over the
   COMPILER source asserting every `workflow_*` code literal it throws is within the closed 5-code
   family (the compiler-facing twin of PIN-B).

7. **[coverage-gap / LOW] Bare `harvest <path>` and the explicit `true`/`false` steering forms are
   unprobed.** R8 tests the absolute-path refusal and Appendix A exercises the `mustContain` form, but
   no row compiles a bare `harvest <path>` → `{path}` (no `mustContain`), and no row compiles
   `approveOnAdvertisedPlan false` / `claimOnStall false` (only the bare = `true` form). A compiler
   that mishandles these variants passes. **Fix:** fold a bare-harvest and a `false`-form case into the
   round-trip or a dedicated row.

---

## 4. Fold instruction set (concrete)

1. **Add the `answerDecisions` behavioral row** (finding 1) — including the repeatable accumulation
   leg — so the totality claim is behavioral, not registry-only.
2. **Add the symlink-escape row** (finding 2) — `harvest` a symlink resolving outside `repoRoot` →
   `workflow_harvest_invalid` with `repoRoot`, compiles clean without it. This is the ONLY way to pin
   B3's containment; S1's static disjunction cannot.
3. **Resolve the S5 shared-module drift** (finding 3) — either accept the shared-constants-module form
   in S5 or strike the "shared module" alternative from the contract.
4. **Repair P6's facade leg** (finding 4) — scope it to the `waves` accessor and accept both property
   and shorthand spellings.
5. **Widen R1's unknown-directive set** (finding 5) to 2–3 names.
6. **Add a compiler-source code-family scan** (finding 6) — the compiler-facing twin of PIN-B.
7. **Probe the bare-harvest and `false`-steering variants** (finding 7) along the way.

---

## 5. Final verdict — **NEEDS-FOLD**

The split is deterministic (31 · 5/26, twice, matching the declared notes) and stage honesty is clean
— no row is red for the wrong reason at HEAD, no fixture bug, no later-stage failure. The suite's
enforcement core is genuine: ~15 distinct grammar probes mean no single cheap wrong impl passes the
union, the SOUND pins (P4 registry completeness, OQ6 registry seam, S1 eval/read denylist, S4 closure,
S5 constant drift) each bite a real mutation, and all five PIN rows bite.

But the suite is not implementation-safe for the #170 gate it claims to be: **`answerDecisions` has no
behavioral row** (finding 1 — a directive from the closed 16 can be dropped and the suite stays green),
**B3's realpath containment is unpinned** (finding 2 — the security-relevant fs syscall, with
suite-draft-notes JC6 asserting a coverage that does not exist), and **S5 rejects the contract's own
shared-constants-module alternative** (finding 3 — a correct impl can fail). Items 1–3 are blocking;
4–7 are fold-along-the-way fragility/coverage notes. The per-row SHALLOW verdicts on P1–P3/P5–P10/R1–
R10/S2/S3 are expected of a red-first suite and are accepted as backstopped by the collective, not
fixed individually.

**Named rows for the fold:** add a behavioral row for `answerDecisions`; add a symlink-escape row for
B3; repair S5's shared-module alternative; repair P6's facade leg; widen R1; add the compiler code-
family scan; probe bare-harvest + `false`-steering.

---

## 6. Shared-scratchpad publish — failed; exact refusal recorded

Per the frame, the report's full text was to be published to the `shared` scratchpad partition
(title `#170`). Attempted from this worktree at HEAD `e371f70`:

```
node impl/scripts/baton.mjs run scratchpad write shared "#170 blue-team report"
   →  cli_invalid: unexpected argument write    (exit 0 — the refusal is the CLI's, not the shell's)
```

**Exact refusal:** the scratchpad facade at HEAD exposes only `read` and `elevate` sub-verbs
(`application-cli.mjs:1476-1506`); there is **no client-addressable scratchpad write verb**, so a
`kind=note` publish to the `shared` partition cannot be addressed from the client surface. This is the
same #158-family evidence `redteam-170.md` §6 / `suite-draft-notes.md` §Shared-scratchpad-publish
already recorded (write-only refusal; the kernel hardcodes `worker:<id>` for writes). This file remains
the durable harvest artifact.

## 7. Deployment verification

Executable `"true"`, args `[]`, cwd `"."` — expected exit 0:

```
true   →   exit 0   (verified)
```
