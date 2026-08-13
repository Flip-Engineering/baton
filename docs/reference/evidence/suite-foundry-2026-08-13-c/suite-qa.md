SUITE-QA v1

# SUITE-FOUNDRY wave-c COORDINATOR QA — the five red-first suites (#170/#163/#165/#167/#146)

[attempt: ea57954b-95c1-4918-a494-41b0249738ee coordinator]

Coordinator: v4-pro seat, `suite-foundry-2026-08-13-wave-c`. Verification date: 2026-08-13.

## Authority-class finding — the coordinator brief names wave-b's rows (DECISION_REQUEST)

This QA opens with the one authority-class ambiguity the verification surfaced, because it changes
which suites are in scope.

My objectiveRef, `coordinator-brief.md`, says: "Five rows are writing red-first suites: #155
(cli-silent-start), #156 (mcp-profile-parity), #161 (orchestrator-plan-object), #164 (blind-waits)"
— four names for a claim of five. Those four are **wave-b's** row set. A `diff` against wave-b's
`coordinator-brief.md` shows the wave-c copy changed only two lines (`wave-b`→`wave-c`,
`four`→`five`) and left the row list untouched — a stale copy, not a new brief.

Four independent wave-c sources agree on the real row set — **#170 (workflow-dsl), #163
(quiescence-completion), #165 (launch-validation), #167 (readiness-honesty), #146 (seat-telemetry)**:

- `foundry-brief.md` (this dir) — its `## Row assignments` names exactly those five + their test files;
- `workflow.json` (this dir) — `members[]` has `row-suite-170/163/165/167/146`; the `harvest.paths`
  list those five test files + notes; `signalOnMembersDone` watches exactly those five roles (the
  #175 correction: roles = the watched rows, coordinator is the remaining member);
- the five `row-suite-*.md` briefs (this dir) — one per `#170/#163/#165/#167/#146`;
- the pack commit `cddeb73` ("5 red-first suite rows for the fold-b contracts (#170 DSL on v4-pro +
  #163/#165/#167/#146) + v4-pro QA").

On-disk content agrees with the four, not with my brief: every suite that landed for this wave
carries the wave-c attempt salt `ea57954b-95c1-4918-a494-41b0249738ee` (matching this coordinator's
own attempt line); wave-b's `#155/#156/#161/#164` suites carry a *different* salt `08d0dac7-…`
(rows `row-suite-155/156/161`). They are a **different wave** and are not this wave's deliverables.

**DECISION_REQUEST (deferred to the top orchestrator).** The wave-c `coordinator-brief.md`'s row
list is stale (wave-b's). Options:
1. Accept this QA's reading — wave-c rows are `#170/#163/#165/#167/#146` per `foundry-brief.md` +
   `workflow.json` + `row-suite-*.md` + commit `cddeb73` (this QA proceeded on this reading);
2. The intended wave-c was a re-run of `#155/#156/#161/#164` + a fifth, and the four wave-c-specific
   files are the stale ones (not supported by any on-disk attempt marker);
3. Free response. The stale `coordinator-brief.md` should be corrected either way; it currently
   claims "five" while naming four wave-b rows.

This QA proceeds on option 1 (the four agreeing sources) and records the ambiguity for the fold stage.

## Signal state + on-disk verification (#174 law)

`signalOnMembersDone` fired at 08:21 (`result` message: "All rows settled…") — after this QA had
already verified all five suites on disk per the #174 law (check sibling worktrees before any
dead-row verdict; on-disk content is ground truth; silence is not death). The final signal-triggered
re-sweep caught three suites revised AFTER the first pass (#163 and #167 test + notes; #146 test
file) — those were re-run and the corrected splits are recorded below. No row is dead. All five
wave-c suites + their notes exist on disk:

| Row | Test file (lines) | Notes file | Location |
|---|---|---|---|
| #170 | `impl/test/workflow-dsl-red.test.mjs` (763) | `workflow-dsl-2026-08-13/suite-draft-notes.md` | `ws-2e047d51…` |
| #163 | `impl/test/quiescence-completion-red.test.mjs` (579) | `contract-foundry-2026-08-13/suite-notes-163.md` | test in `ws-ddea5a82…`; note harvested to `master` |
| #165 | `impl/test/launch-validation-red.test.mjs` (638) | `contract-foundry-2026-08-13/suite-notes-165.md` | `ws-8659a3fc…` |
| #167 | `impl/test/readiness-honesty-red.test.mjs` (913) | `contract-foundry-2026-08-13/suite-notes-167.md` | `ws-06464fdd…` |
| #146 | `impl/test/seat-telemetry-red.test.mjs` (668) | `contract-foundry-2026-08-13/suite-notes-146.md` | `ws-bdff9ea5…` |

No row is dead. Every test file and every notes file carries the `[attempt: ea57954b-… <role>]`
line in its **first five lines** (the #171 attempt-echo law holds for all ten deliverables).

## Verification evidence (run twice from the repo root, cited, no fabrication)

Each suite was run with `node --test impl/test/<file>` from its row-worktree root (HEAD `e371f70`,
the contract's pinned RED head), twice. Both runs agree, and both match the row's declared split:

| Suite | Declared split | Run 1 | Run 2 | Match | Verdict |
|---|---|---|---|---|---|
| #170 workflow-dsl | 31 · 5 pass / 26 fail | 5 / 26 | 5 / 26 | stable ✓ | **SOUND** |
| #163 quiescence-completion | 15 · 3 pass / 12 fail | 3 / 12 | 3 / 12 | stable ✓ | **SOUND** |
| #165 launch-validation | 12 · 3 pass / 9 fail | 3 / 9 | 3 / 9 | stable ✓ | **SOUND** |
| #167 readiness-honesty | 17 · 8 pass / 9 fail | 8 / 9 | 8 / 9 | stable ✓ | **SOUND** |
| #146 seat-telemetry | 14 · 1 pass / 13 fail | 1 / 13 | 1 / 13 | stable ✓ | **SOUND** |

No instability: every red/green row is identical across the two runs. No fixture-artifact failure,
no timeout, no `provider_failure` race.

## Per-suite QA

### #170 — workflow-dsl (`row-suite-170`) — VERDICT: SOUND

- **Split:** 31 tests — 5 pass / 26 fail, both runs (declared identical).
- **Stage discipline:** 5 PIN rows green at named stages (`interpreter-json-only`,
  `closed-refusal-vocabulary`, `closed-field-sets`, `schemaVersion-fixed`,
  `mcp-lane-crafted-detail`); 26 capability rows red at named stages — the compiler-dependent rows
  at `workflow_dsl_compile_missing` / `workflow_dsl_admission_seam_missing`, the source-scan rows at
  `stage[surfaces-parity-*]` / `stage[mcp-triple-*]` / `stage[web-triple-*]` / `stage[registry-seam-*]`
  / `stage[head-seam-*]` / `stage[generated-docs-*]`. Every contract pin (P1–P10, R1–R10, S1–S5, OQ6)
  is a row; nothing deferred (P10's `stage[web-triple-gated-on-160r3]` records the #160 R3 sequencing,
  not an omission).
- **Shallow-green spot-checks (2):** **R1** (unknown directive) — cheapest wrong impl: hardcode a
  rejection of the single fixture directive `memberr`; closed by S3 (three-way invariant) + P4 (total
  coverage) + R2–R9 (the other refusal legs). **P1** (round-trip) — cheapest wrong impl: return a
  fixed valid IR; closed by P2's byte-exact `EXPECTED_APPENDIX_IR` fixture + the R refusal rows.
  Neither needs a sharpening note.
- **Law check:** no clocks (0 `Date.now`/`new Date`/`setTimeout`); `localeCompare` appears once, in a
  ban-comment; no absolute line-window anchors (the one `:58-63` is a citation in a comment); hermetic
  (`mkdtemp` ×17, `rmSync`/`finally` + `t.after`); the invented surface `workflow-dsl.mjs` is imported
  via a dynamic namespace import that throws the named stage while absent; sorted-key literals only.

### #163 — quiescence-completion (`row-suite-163`) — VERDICT: SOUND

- **Split:** 15 tests — 3 pass / 12 fail, both runs (declared identical). *(Revised after the first
  QA pass — the row added the N1 null-gating guard and the N2/N3 rows; re-run at the settle signal.)*
- **Stage discipline:** 3 green rows (2 PIN — `lane-driver-preserved`, `stuck-decision-preserved` —
  plus 1 GUARD — `null-gating-missing`, green at HEAD by design); 12 capability rows red (R1, R2,
  R3, R5, R6, N2, N3 and the R4 sub-rows) at named stages (`quiescence-verdict-missing`,
  `totality-evidence-missing`, `hard-break-evidence-missing`, `production-driver-uncapped-missing`,
  `cadence-derived-window-missing`, `post-declaration-rewake-missing`, and the static source pins).
- **Shallow-green spot-checks (2):** **R1** — cheapest wrong impl: relabel `WAVE-INCOMPLETE` as
  `WAVE-QUIESCED`; closed because R1 asserts the `basis: 'quiesced'` AND the per-outcome additive
  fields AND the `steering[]` evidence line (a bare relabel fails). **R2** — cheapest wrong impl: use
  the literal `ACTIVE_TURN_PHASES` member `'working'` instead of the outline's actual mid-turn
  `'running'`; closed because R2's `notEqual` discriminates the vocabulary mismatch (a literal-set
  landing would quiesce a mid-turn member). The notes' stage table records both attacks explicitly.
- **Law check:** the two `Date`/`clock` hits are the notes' "decoupled-clocks double" — a fake timer
  test double (`clock: () => new Date(Date.now()+130_000)`), never a workflow control; `localeCompare`
  once, in a ban-comment; `stallMs: 60_000` with the one-line comment; `mkdtemp` + cleanup; zero
  line-window anchors.

### #165 — launch-validation (`row-suite-165`) — VERDICT: SOUND

- **Split:** 12 tests — 3 pass / 9 fail, both runs (declared identical; the row also recorded runs 3–4
  at the same split).
- **Stage discipline:** 3 green guards (`d2-normalization-non-refusal`, `d1b-containment-guard`,
  `exit-code-map`); 9 capability rows red (A1, A2, A3, A3-nm, A4, A4-obj, A5, A7, S1) at named stages
  (`d1a-directory-refused`, `d2a-coverage-refused`, `d2-grammar-prose`, `d1b-admission-directory`,
  `d3-transport-code-survival`, `d2b-objective-render-coverage`, `static-launch-refusal-tokens`).
- **Shallow-green spot-checks (2):** **A1** — cheapest wrong impl: hardcode rejection of the single
  fixture directory `docs/reports`; closed by A6 (the GREEN normalization non-refusal guard forces a
  real normalize + directory predicate, not a hardcode) + A2/A4-obj/A7 (other inputs). **A3** —
  cheapest wrong impl: hardcode rejection of the one prose line; closed by A3-nm (the near-miss
  heading) + A6 (a hardcode that rejects prose would also false-refuse the normalized pair). The
  notes' judgment calls document the A7 object-form discriminator. No sharpening needed.
- **Law check:** `Date`/`setTimeout` hit is a comment ("fixed far-future clock (no real Date.now)" —
  the fixture parses `FAR_FUTURE` once, no clock control); `stallMs: 5 * 60_000` (valid positive,
  derived, commented — the driver rows' production 20 s poll is subprocess-scoped, not a suite clock);
  the eight `:N-N` hits are citations in comments/stage messages (e.g. `run-task-wave.mjs:44-47`);
  hermetic (`mkdtemp` git repos + `t.after`, empty `XDG_CONFIG_HOME`, no network).

### #167 — readiness-honesty (`row-suite-167`) — VERDICT: SOUND

- **Split:** 17 tests — 8 pass / 9 fail, both runs (declared identical). *(Revised after the first
  QA pass — the row added the A-Lcap bounded-capture PIN and one more capability row; re-run at the
  settle signal.)*
- **Stage discipline:** 8 PIN rows green (A1p, A3p, A4p, A5p, A6p, P-stale, A-L, A-Lcap); 9
  capability rows red (A1a, A1b, A1c, A2, A3, A4, A5, A6, V-stale) at named stages
  (`enumerable honest projection`, `roster honest projection`, `northbound re-add`, `on-demand
  forced probe`, `typed refusal vocabulary`, `quota/capacity death class`, `honest-projection
  refusal`, `spawn-gate coverage`, `lapsed-window verdict`).
- **Shallow-green spot-checks (2):** **A1a** — dual-path (static-only `unverified`/null AND a fresh
  content-verified `probe-verified` with `probedAt = verifiedAt`); cheapest wrong impl (always emit
  `{verdict:'unverified', probedAt:null}`) fails the probe-verified half — not shallow-greenable.
  **A3** — source-scan for the four typed guidance rows; cheapest wrong impl (add a bare
  `provider_unreachable:` literal) fails the `{category, summary, remediation, retryable}` structure +
  no-generic-collapse assertions. Both sharp.
- **Law check:** `localeCompare` once, in a ban-comment; the seven `Date`/`setTimeout` hits are test
  infrastructure (a `waitFor` poll helper, fixture `setTimeout` doubles, and two
  `new Date(...).toISOString()` *assertions* on the projection's content-derived timestamp) — no
  workflow clock control; `stallMs: 60_000` explicit; the `:N-N` hits are citations in stage messages
  (`web-northbound.mjs:1504-1513` etc.).

### #146 — seat-telemetry (`row-suite-146`) — VERDICT: SOUND

- **Split:** 14 tests — 1 pass / 13 fail, both runs (declared identical).
- **Stage discipline:** 1 PIN row green (`A-L` lint); 13 capability rows red (A1, A2, A3, A4, A5, A6,
  A7, A8, A9-1, A9-2, A9-3, A10, A11) at named stages (`doctor-seats-missing`,
  `capacity-deferred-missing`, `waves-capacity-missing`, `seats-freshness-label-missing`,
  `surface-teaching-missing`, `capacity-inflight-missing`, `inFlightRevision-missing`). The
  load-bearing allocator-agreement pin A9 is split into three (A9-1 explicit route, A9-2 auto->1,
  A9-3 auto=1), each pinned.
- **Shallow-green spot-checks (2):** **A1** — cheapest wrong impl: fabricate a static `seats` array;
  closed by A10 (`routes[i].occupancy.inFlight === seats[i].inFlight` — the single-occupancy-source
  law) + A4/A9 (allocator-bound null honesty). **A9** — cheapest wrong impl: bind seats to
  `adapterFor(route).vendor` (the contract's named anti-pattern); closed because A9-1 pins
  `_resolveExplicitRoute(X, …)` and never `adapterFor`/a different vendor. Both sharp.
- **Law check:** no `localeCompare`; the four `Date`/`setTimeout` hits are a `waitFor` poll helper
  (test infra) + one stage message asserting the wall-time stamp is NOT copied; no watchdog fixtures
  (a projection suite — the stallMs law is vacuously satisfied); the seven `:N-N` hits are citations
  in comments/stage messages; hermetic (`mkdtemp` ×7, `t.after` ×4).

## Suite law (coordinator frame) — confirmed per suite

1. **Red-first:** every capability row red at a NAMED stage in the assertion message; every PIN row
   green at HEAD. Confirmed for all five (see per-suite).
2. **Hermetic:** `mkdtemp` fixtures + `t.after`/`finally` cleanup, no network, no real provider
   spawns, no host state. Confirmed (grep counts above).
3. **No clocks as controls:** fake timers/`clock` doubles and `waitFor` poll helpers only, never a
   workflow control; the two projection `new Date(...)` usages are assertions on content-derived
   timestamps. Confirmed.
4. **Namespace imports for invented surfaces:** `#170` dynamically imports the absent
   `../src/workflow-dsl.mjs` namespace and throws the named stage; the other four import landed
   surfaces directly. Confirmed.
5. **Sorted-key literals in actual order; `localeCompare` banned:** `localeCompare` appears only in
   ban-comments. Confirmed.
6. **`watchdog.stallMs` a valid positive integer in every fixture:** `#163` `60_000`, `#167` `60_000`,
   `#165` `5 * 60_000` — all valid positives with the one-line comment; `#170`/`#146` have no
   watchdog fixtures (vacuous). Confirmed.
7. **Static source anchors (ORDER/EXISTENCE/byte-string only, never line-window #166):** every
   `:N-N` hit is a citation in a comment or stage message; assertions are `.includes`/`indexOf`/
   `typeof`/behavioral (subprocess exit codes, `assert.equal` on projected values). Confirmed.
8. **Split-twice:** all five recorded and matched. Confirmed.
9. **Attempt-echo (#171):** all ten deliverables carry the wave-c attempt line in the first five
   lines. Confirmed.

## Escalations

- **DECISION_REQUEST (authority-class)** — the stale `coordinator-brief.md` row list, recorded at the
  top of this QA with three options. This is the only authority-class question; every other judgment
  (which rows to treat as capability vs PIN, the shallow-green readings) is a coordinator judgment and
  is recorded in the per-suite sections rather than escalated.

## Shared-scratchpad publish — failed; refusal recorded (campaign evidence #158)

Attempted from the coordinator worktree at HEAD `e371f70`:

```
node impl/scripts/baton.mjs run scratchpad write shared "suite-qa-2026-08-13"
  →  cli_invalid: unexpected argument write   (exit 0 — the refusal is the CLI's, not the shell's)
```

The agent-facing scratchpad surface at HEAD exposes only `read` and `elevate`; there is no
client-addressable `write`/`append` verb (the same #158-family refusal `contract-163` OQ1 and
`#170`'s notes already recorded independently). The durable file above is the authoritative QA.

## Deployment verification

Executable `"true"`, args `[]`, cwd `"."` — expected exit 0:

```
true   →   exit 0   (verified)
```
