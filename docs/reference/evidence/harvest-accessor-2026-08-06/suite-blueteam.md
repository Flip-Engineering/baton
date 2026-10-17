# Blue-team report — harvest-accessor red-first suite (`harvest-accessor-red.test.mjs`)

- **Date:** 2026-08-06
- **Blue team role:** verify the red-first suite before its implementation wave.
- **Contract under test:** `harvest-accessor-contract.md` v1.1 + `contract-fold.md` (same directory).
- **Suite under test:** `impl/test/harvest-accessor-red.test.mjs` (1177 lines).
- **Verdict:** **NOT-READY** — 1 primary blocker (HA-08 facade-translation rows are not satisfied; a
  plausible wrong implementation greens 4 refusal codes), plus secondary recommendations.

---

## 1. Run record (exact)

Command (from repo root):

```
node --test impl/test/harvest-accessor-red.test.mjs
```

| Metric | Value |
| --- | --- |
| tests | 39 |
| pass | **5** |
| fail | **34** |
| skipped / cancelled / todo | 0 |
| duration | ~22.5 s (C2-truncation alone ≈ 12 s) |

Header declaration `39t (34r/5p)` — **matches exactly**.

**Passing pins (green today, must stay green):**
`I2-cli-negative` · `I5-cli-episode` · `I6-conformance` · `M1-static` · `M2-static`.

**Red rows — all 34 fail AT their named stage** (verified per-row below; every fixture
self-check preceding the red assert passed — no earlier fixture-bug failure, no later failure):

| Row | Named stage | Actual failure mode today |
| --- | --- | --- |
| A1 / A2 / A3 / A4 | ports absent | `application_command_unavailable` (assert: expected `application_unauthorized` / `application_*_invalid`) |
| B1 / C1 / C2 / K1 / K2 | projection absent | `run.resultpin` throws `application_command_unavailable` |
| D1…D6 | projection absent / ports absent | `application_command_unavailable` vs the pinned readiness code |
| E1 / E2 / F1 / F2 / G2 / J1 / J2 / L1 / L2 | harvest absent | `waves.harvest` throws `application_command_unavailable` |
| H1 | tools absent | `baton_run_resultpin` absent from `mcpApplicationToolNames()` (33, not 35) |
| H2 / H5 | tools absent | tool dispatch error / capability refusal never reached |
| H3 / H4 | wire vocabulary absent | `stateFailureCode` returns `command_outcome_unknown` for every new code |
| I1 | CLI verb absent | parser throws `unexpected argument run:1` (parseStart shorthand path) |
| I3 / I4 | CLI verb / rows absent | `CLI_WEB_COMMANDS` / registry row absent |

**Fixture integrity spot-checks (probe against the real machinery, this session):**
- The ceremony produces a **REAL git pin**: after `work_completed`, `git for-each-ref`
  lists `refs/baton/results/<sha>`, the ref resolves to `task.capturedSha`, and
  `view.result.sha === capturedSha === resolved pin`. The pin rows are NOT facsimiles.
- The self-committed-capture tooth holds: `git rev-parse ${resultSha}^` ≠ recorded base
  (two MockAdapter edits → two worker commits; `_applyEdit` commits each edit,
  `adapter.mjs:573-600`). B1's `assert.notEqual(pinParent, rec.baseSha)` (suite `:423`)
  passed before the red assert.
- C2's fixture clears 256 KiB (320 × ~935 B deep paths); G2's net-zero delta is genuinely
  empty (`changedPathsAtCommit(base, pin) === []`); L2's rewound main has
  `merge-base(R1, pin) = R1 ≠ recorded base`.

---

## 2. Coverage map — contract surface → enforcing test(s)

### 2a. Every contract refusal code → test(s)

Decision 1 / 4 / 6 vocabulary (`run.resultpin`):

| Code | Enforced by |
| --- | --- |
| `application_run_resultpin_invalid` | A3 (facade shape, incl. caller-supplied `baseSha` refused), N2 (pre-gate shape) |
| `application_unauthorized` | A1, D6, N1 |
| `result_not_ready` | D1 (mid-flight), D2 (terminal-failed; checkpoint pinned ≠ result) |
| `pin_not_found` | D3 (released ref), K2 (released coexists with a live pin) |
| `pin_unverifiable` | D5 (`resolveResult` lane absent → `inspectPreservedResult` state) |
| `pin_mismatch` | D4 (re-pointed ref) |
| `pin_base_mismatch` | B1 (corrupted attribution, orphan base) |
| `result_delta_oversize` | **H3/H4 wire-mapping only** — NO facade-level row (see blocker 1) |
| `result_ref_invalid` | **untested** (defense-in-depth; contract calls it unreachable through the closed shape — acceptable gap) |

Decision 2 / 4 / 6 vocabulary (`waves.harvest`):

| Code | Enforced by |
| --- | --- |
| `application_waves_harvest_invalid` | A4 (8 shape cases incl. 64-hex sha1 gate, ambiguous/absent source), N2 |
| `application_unauthorized` | A2 (both XOR sources), N1 (runId + resultSha sources) |
| `result_not_ready` | **H3 wire only** — no facade row for harvest's empty-section / unattributed-fallback refusal |
| `pin_not_found` | J1 (real-but-unpinned sha), J2 (runId source re-verifies released ref) |
| `pin_unverifiable` | **H3 wire only** — facade harvest path shares the D5 lane but has no own row |
| `pin_mismatch` | **H3 wire only** — no harvest-lane retarget row |
| `pin_base_mismatch` | **H3 wire only** — no harvest-lane corrupted-base row |
| `harvest_onto_invalid` | E1 (`/some/other/checkout`) |
| `harvest_onto_dirty` | **H3/H4 wire-mapping only** — NO facade row (see blocker 1) |
| `harvest_base_diverged` | L2 (rewound main, four shas named in message, onto untouched) |
| `harvest_conflict` | F2 (real three-way probe: exact path `reports/a.md`, class string, onto clean) |
| `harvest_onto_advanced` | **H3/H4 wire-mapping only** — no facade race row (see blocker 1) |
| `harvest_apply_failed` | **H3/H4 wire-mapping only** — no facade residual-failure row (see blocker 1) |

Receipt shapes:

| Receipt | Enforced by |
| --- | --- |
| `applied-clean` + `afterSha` + `classes: ['clean_textual']` + `baseSha` = recorded base + `changedPaths` = recorded diff + `reason: null` | E1, E2 (runId source), F1 (three-way survival), L1 (post-advance honesty) |
| `skipped / already_integrated` (no merge commit) | E1 retry |
| `skipped / empty_delta` (no merge commit) | G2 |
| `ok: true`, `reason: null` on applied-clean | E1 |

### 2b. Every acceptance pin HA-01…HA-14 → test(s)

| Pin | Tests | Satisfied? |
| --- | --- | --- |
| HA-01 dispatch + closed shapes | A1-A4 (+ M1/N2 for direct-port pre-gate) | ✅ |
| HA-02 stale-base law | B1 (recorded base, `pin^`≠base tooth, HEAD-advance, corrupted→`pin_base_mismatch`); C1 base≠result | ✅ (static shape-only assertion not literal — see drift 2) |
| HA-03 projection shape + truncation | C1 (exact rows, byte-wise sort, exact-cover), C2 (256 KiB page truncates, digest, cursor) | ✅ (at-cap boundary implicit — drift 3) |
| HA-04 readiness trichotomy | D1-D6 | ✅ |
| HA-05 applied-clean receipt | E1, E2 | ✅ |
| HA-06 three-way survival + conflict | F1, F2 | ✅ (probe-worktree assertion gap — teeth flag 3) |
| HA-07 already_integrated + empty_delta | E1 retry + G2 | ✅ |
| HA-08 MCP wire constancy | H1-H5 | ⚠️ **blocker 1** (facade-injection rows absent) |
| HA-09 CLI verbs + conformance | I1-I6 | ✅ |
| HA-10 static laws | M1, M2 | ✅ |
| HA-11 multi-pin independence | K1, K2 | ✅ |
| HA-12 unpinned sha | J1, J2 | ✅ |
| HA-13 receipt honesty + divergence | L1, L2 | ✅ |
| HA-14 control lane | N1, N2 | ✅ |

### 2c. Contract decisions with NO satisfying test

1. **Decision 2 precondition 1 (`harvest_onto_dirty`) at the facade** — untested.
2. **Decision 2 `harvest_onto_advanced` / `harvest_apply_failed` at the facade** — untested.
3. **Decision 6 `result_delta_oversize` at the facade** (>1_024 changed paths) — untested.
4. **Contract HA-08 "Translation-proof rows inject the kernel codes at the facade"** — no row
   injects a kernel code at the facade; H4 injects at a mock MCP command stub instead.
5. **Decision 2 conflict-probe cleanliness ("no probe worktree … left behind")** — partial.

---

## 3. Per-pin verdicts (FALSE-GREEN hunt on the 5 passing pins)

| Pin | Verdict | Evidence |
| --- | --- | --- |
| **I2-cli-negative** | **SOUND** | Guards the four malformed spellings (neither/both XOR, extra positional, dangling `--onto`). Today throws `cli_command_unavailable`/`cli_invalid`; the guard asserts the refusal, not the pre-existing code, so it stays meaningful after the grammar lands. A wrong implementation that parses `['waves','harvest']` into a command and defers XOR to the facade, or that silently picks one source for `['waves','harvest',run,sha]`, turns I2 red. Real teeth. |
| **I5-cli-episode** | **SOUND** | Pins `baton run result RUN_ID` → `run.episode` topic `result`. If the implementation adds the `resultpin` branch by prefix-matching `result*`, I1 turns red and I5 still guards the episode spelling; if it breaks the episode branch, I5 turns red. Non-vacuous. |
| **I6-conformance** | **SOUND** | `checkSurfaceDocs()` is a real render-vs-committed comparison (`render-surface-docs.mjs:145-160`); `surface-conformance` execs the CS-4 main. Passes only while docs/artifacts match the served surface. Forces the mandatory regeneration step. |
| **M1-static** | **SOUND** | `Object.hasOwn(APPLICATION_COMMAND_DEFINITIONS, key) === false`. Combined with A1/A3 (which a table-entry implementation would also pass), M1 is what actually pins the direct-port law: adding the keys to the byte-stable table turns M1 red. |
| **M2-static** | **WEAK** | Asserts the suite's OWN literal arrays are sorted-key — a self-referential discipline lint. It does not observe the implementation (unlike C1's `Object.keys(row)` deep-equal and A3/A4's closure rows, which do). Can pass any implementation, so it is not a FALSE-GREEN in the harmful sense, but it carries no implementation oracle. Acceptable as a discipline pin; do not rely on it for anything else. |

No pin is **VACUOUS** or **STAGED-WRONG**: I2/I5/I6/M1 all observe real parser/doc/table state, and
the pins are staged against the real modules (`parseBatonCli`, `checkSurfaceDocs`,
`APPLICATION_COMMAND_DEFINITIONS`), not fixtures.

---

## 4. Teeth check — red rows vs plausible WRONG implementations

### Rows with strong teeth (verified)

- **B1 (stale-base)** — THE row. Kills (a) HEAD-diff readers (`baseSha === rec.baseSha` asserted
  after main advances; `changedPaths` deep-equal the recorded diff — the `main-advance.md` commit
  would leak into a HEAD diff), (b) `pin^`-readers (`baseSha` asserted equal to the recorded base
  while the fixture proves `pin^ ≠ base` — verified live), (c) silent-on-corruption readers
  (orphan base → `pin_base_mismatch`), and (d) wrong-base-source readers (both the task record and
  the worker handle are mutated, so a worktree-`meta.baseSha` reader fails the corruption sub-assert).
- **L2 (ancestry precondition)** — a merge-anything implementation that skips the merge-base
  equality check would apply `diff(R1, pin)` and return `applied-clean` → L2 fails. A refusal
  without the four shas in the message → fails. Onto-untouched + clean-status asserts kill
  half-applies.
- **F2 (conflict list)** — a silent-apply (overwrite) implementation returns a receipt → fails the
  `harvest_conflict` assert. A refusal without a re-probed list (e.g., forwarding the engine's
  path-less `structured_tool_unavailable`) → fails `Array.isArray(conflicts)` / exact path. A
  wrong list (adds `reports/b.md`) → fails `length === 1`.
- **G2 (empty delta)** — a no-op-skip or engine-forwarding implementation returns
  `applied-clean` with a pointless `--no-ff` merge commit → fails `skipped/empty_delta` + HEAD
  unchanged. Precondition-order (ancestor-before-emptiness) is pinned by E1's retry (contained
  pin reports `already_integrated`, not `empty_delta`).
- **D3/D4/D5 (pin states)** — conflating the preservation states (e.g., everything →
  `result_not_ready`) fails the exact-code asserts. D5's white-box `resolveResult = null`
  injection is the genuine `unverifiable` lane (`coordinator.mjs:6093`).
- **K1/K2 (multi-pin)** — a newest-pin reader returns B's pin for run A → fails; an
  only-extant-pin reader returns the wrong pin for the released run → fails.
- **J1/J2 (pin verification)** — a harvest that trusts a caller-supplied sha or the recorded ref
  without re-resolution applies the released/foreign commit → fails `pin_not_found`.
- **C1/C2 (projection shape)** — re-shaping, unsorted, extra-row, un-truncated, or
  non-byte-exact implementations fail the exact-row oracles and the truncation asserts.
- **E1 (onto rules)** — accepting any `onto` fails `harvest_onto_invalid`; rejecting the explicit
  main-checkout `onto` fails the apply; both `onto`-absent and `onto: <repo>` variants are pinned.
- **N2 (pre-gate dispatch)** — verified against `application.mjs:12224-12232`: a behind-gate
  implementation hits the recursive-session gate (not in the read/effect allowlists) and throws
  `run_orchestrator_command_forbidden` **even for the live lease holder** (the authorize call is
  followed by an unconditional throw), so the shape-failure code is never reached → N2 fails.
- **H1/H3/H5** — exact counts (33→35, 84→86) kill stowaway tools; the 12-code wire pass-through
  kills `command_outcome_unknown` collapse; the capability gate kills an observe-only principal
  reaching the effectful lane.

### Teeth flags (red rows a plausible WRONG implementation could survive)

1. **H4 (translations) — facade-level false-green for 4 codes.** H4 drives a mock MCP command
   stub (`mockAppServer` throwing `{code: body}` from `run.message.send`) and asserts
   `stateFailureCode` maps kernel → harvest codes. It does NOT inject at the facade, so the
   contract's HA-08 requirement ("Translation-proof rows inject the kernel codes at the facade …
   proving translation, not just mapping") is unsatisfied. Concrete false-green: an implementation
   that throws the raw kernel code `structured_main_dirty` (or any other code) from the facade on
   a dirty onto, and adds the kernel→harvest mapping to `stateFailureCode`, passes H4 and H3 and
   has **no facade row to trip on** for `harvest_onto_dirty`. The same holds for
   `harvest_onto_advanced`, `harvest_apply_failed`, and `result_delta_oversize`. (E1 and F2 DO
   pin the facade translation for `harvest_onto_invalid` and `harvest_conflict`, so the gap is
   confined to those four codes.)
2. **C2 `changedFilesDigest` is format-only.** `assert.match(digest, /^[a-f0-9]{64}$/u)` does not
   verify the digest is computed over the FULL entry set (contract HA-03). A wrong implementation
   that digests the truncated page passes this assert. The row remains sound overall (it still
   requires `truncated: true`, `length < N`, `> 0`), so this is a WEAK sub-assertion, not a
   false-green.
3. **F2 leaves the "no probe worktree" half of HA-06 unpinned.** F2 asserts `git status`
   clean and onto HEAD unchanged, but never runs `git worktree list`. A wrong implementation that
   leaks the probe worktree (or a stale stage dir) passes F2. The engine's
   `removeStructuredIntegration` cleans the stage on error, but the ADDITIVE probe worktree is the
   accessor's own code and is not verified.
4. **E1's onto-equals-main does not discriminate realpath semantics.** In this environment
   `os.tmpdir()` returns the same string the driver uses as `repoRoot`, so a naive
   string-equality implementation and a realpath-aware implementation both admit `onto: fx.repo`.
   The contract's realpath-equality law is only half-pinned (the refuse case is pinned by
   `harvest_onto_invalid`; the admit case is not proven to be realpath-based).
5. **A2's dispatch cannot stand alone** — a table-entry implementation also passes A2; it is M1
   that pins the direct-port law. This is a deliberate two-row composition, not a defect, but the
   pairing should survive review intact.

---

## 5. Drift findings (suite header vs contract surface names)

1. **H4's title overclaims.** "the kernel codes map to the harvest vocabulary" reads as a facade
   translation pin; it is a `stateFailureCode` wire-mapping unit test. The contract HA-08
   language ("inject the kernel codes at the facade") is not met. This is the blocker (see §6).
2. **HA-02's "static, shape-only assertion" is not literal.** The contract asks for a static
   assertion that the accessor derives the base from the record (no caller base, no HEAD, no
   `pin^`). The suite covers all of it behaviorally (A3 for the caller-supplied-base closure, B1
   for HEAD/`pin^`), but there is no static shape-only row. Behavioral coverage is equivalent in
   effect; the header's claim is just not byte-faithful to the contract's wording.
3. **HA-03's "at-cap serialized page admitted" is implicit, not explicit.** C1 exercises a tiny
   page (admitted in full) and C2 an over-cap page (truncated). The exact 256 KiB boundary is not
   tested; an implementation that truncates at a lower cap would be caught by C1, so the doctrine
   is covered, but the boundary is not pinned.
4. **`harvest_onto_dirty` / `harvest_onto_advanced` / `harvest_apply_failed` / `result_delta_oversize`
   surface only in H3/H4's wire lists** — the only rows that name them are wire-mapping rows, so a
   reader of the suite sees "covered" when the facade is not.
5. **HA-07's already_integrated half lives in E1's retry** (G has only G2). The header documents
   this, so it is deliberate, not drift.
6. **`result_ref_invalid` has no row** — the contract itself declares it unreachable through the
   closed shape (`index.mjs:843`), so the absence is acceptable and worth recording as such.
7. Surface-name spellings (canonical keys `run.resultpin` / `waves.harvest`, MCP
   `baton_run_resultpin` / `baton_waves_harvest`, CLI `baton run resultpin` / `baton waves harvest`,
   all twelve refusal codes) match the contract **exactly** — no drift on names.

---

## 6. Final verdict — **NOT-READY**

The suite is a strong, honestly-staged red-first gate: all 39 rows behave as declared (34r/5p at
their named stages), the pin rows stage real git refs, and the stale-base (B1), base-divergence
(L2), and conflict-list (F2) rows all have real teeth against the exact wrong implementations they
are meant to kill. But it does not yet satisfy the contract's own HA-08 acceptance language, and
that creates a concrete false-green lane.

### Blockers

**B1 (primary). HA-08's facade-injection translation rows are absent — 4 refusal codes have no
facade-level teeth.**

- **What:** The contract (HA-08) requires "Translation-proof rows inject the kernel codes at the
  facade … proving translation, not just mapping," specifically naming
  `structured_main_dirty → harvest_onto_dirty`, `captured_change_oversize →
  result_delta_oversize`, `structured_already_integrated → skipped`, and `structured_tool_unavailable
  → harvest_conflict (re-probed list)`. The suite tests the wire mapping (`stateFailureCode`) via a
  mock MCP command stub (H4), and tests the real conflict path at the facade (F2), but **no row
  exercises the facade for `harvest_onto_dirty`, `harvest_onto_advanced`, `harvest_apply_failed`,
  or `result_delta_oversize`**.
- **Why it matters:** an implementation that throws the raw kernel code (or a made-up code) from
  the facade for a dirty onto / oversize delta / finalize race / merge failure, and maps
  kernel→harvest in `stateFailureCode`, passes H3+H4 with **no facade row to turn red**. The
  suite would then green a facade that does not produce the pinned harvest codes on those four
  paths — precisely the translation-by-mapping short-circuit HA-08 was added to kill (fold
  blocker 7e).
- **Concrete fix:** add facade-level rows. The two cheaply constructible ones:
  - *`harvest_onto_dirty`:* make the main checkout dirty (uncommitted edit to a tracked file)
    before `waves.harvest`; assert `application.command` throws `harvest_onto_dirty`. This is a
    two-line fixture on the E1 shape.
  - *`result_delta_oversize`:* reuse the C2 fixture with N = 1_025 changed paths (over the 1_024
    default `maxPaths`); assert `application.command('run.resultpin', …)` throws
    `result_delta_oversize` naming the cap. (Heavier, but the C2 ceremony already proves 320 is
    tractable; 1_025 is the same order.)
  - For the two harder ones (`harvest_onto_advanced` race, `harvest_apply_failed` residual), keep
    the wire-mapping row but retitle H4 to "stateFailureCode mapping" and add a comment noting the
    facade rows for the constructible codes carry the translation burden; alternatively stub the
    engine seam at the facade to force those two kernel throws, matching the contract's
    "inject at the facade" language.

### Recommendations (non-blocking)

1. **C2:** assert `changedFilesDigest` content against the full-set digest (the suite already has
   the oracle — construct all N rows and sha256 the canonical JSON), not just the 64-hex format.
2. **F2:** add `git worktree list` (or an equivalent) asserting only the main worktree remains,
   closing HA-06's "no probe worktree … left behind".
3. **E1:** add a symlink-alias `onto` (e.g., a symlink whose target is the main checkout) to pin
   the realpath-equality admit case, or accept the current half-pin and note it.
4. **M2** is a self-referential lint; consider folding it into a comment rather than treating it as
   an implementation guard.

Once the primary blocker is addressed (facade rows for `harvest_onto_dirty` and
`result_delta_oversize`, plus retitled H4), the suite is **GATE-READY**.
