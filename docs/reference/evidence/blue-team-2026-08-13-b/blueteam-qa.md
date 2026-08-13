BLUETEAM-QA v1
[attempt: 2344e0b7-8929-4768-bbcf-695ec5dcb0c6 coordinator]

# Blue-team QA — wave-b coordinator cross-check (blue-team-2026-08-13-b)

Seat: coordinator (v4-pro). Campaign `blue-team-2026-08-13-wave-b`: five rows attack the five
wave-c suites. This file is the harvest artifact (`BLUETEAM-QA v1`).

## 1. Signal state

`signalOnMembersDone` has **not** fired. Only `messageOnSpawn` and a checkpoint nudge arrived this
session. Per the brief I wait for that signal before issuing row verdicts.

## 2. On-disk verification record (law #174)

Verify-first, before any verdict. Exact checks, this seat's run:

1. Main repo `docs/reference/evidence/blue-team-2026-08-13-b/` — pack only (briefs + workflow.json);
   **no `blueteam-*.md`.**
2. All sibling worktrees `../../wt/ws-*/` — none hold a wave-b report; the only `blueteam-*.md` on
   disk are wave-**a** reports (a different campaign).
3. No wave-b row worktree or `state/w-*.jsonl` exists — the five rows were never spawned/settled.

**Result: zero wave-b row reports on disk.** I am the only member with a session. Silence is not
death (§174) and a missing attempt marker is not a dead row — so I declare no row dead. I also do
not invent a row's content.

## 3. Verdict posture

Uphold/overturn requires a row report. With none on disk, **no row verdict and no suite
ACCEPT/NEEDS-FOLD is issued against a row.** Fabricating a missing row is the one prohibited act;
I name the gap instead. What I *can* do — and what the checkpoint nudge directs — is run the attack
myself. §5 is my own independent blue-team pass (clearly mine, not a row's), at coordinator depth.

## 4. Split-twice record (all five suites, `node --test` from repo root, HEAD e371f70)

| suite | run 1 | run 2 | stable? |
|---|---|---|---|
| workflow-dsl-red (#170) | 31 · 5/26 | 31 · 5/26 | ✓ |
| quiescence-completion-red (#163) | 15 · 3/12 | 15 · 3/12 | ✓ |
| launch-validation-red (#165) | 12 · 3/9 | 12 · 3/9 | ✓ |
| readiness-honesty-red (#167) | 17 · 8/9 | 17 · 8/9 | ✓ |
| seat-telemetry-red (#146) | 14 · 1/13 | 14 · 1/13 | ✓ |

No split instability. #170 and #165 reproduce their declared split records **exactly**; the other
three are red-first at their named stages with no green-for-the-wrong-reason failure.

Row-count vs test-count flags (rows must reconcile): #163 header says "fourteen rows" but yields
**15** `it()` blocks; #146 header lists 12 rows (A-L + A1–A11) but yields **14** tests.

## 5. Coordinator attack pass (my own; the rows are absent)

### 5.1 #170 workflow-dsl-red — **SHALLOW on parser generality**

Behavioral rows (P1/P2/P3/P5/R1–R9) are all **fixture-keyed**: every compiled input and every
refusal input is a committed literal in the suite (Appendix A, `MINIMAL_WAVEFILE`, the
`scope-override` wavefile, `no-deeper`, and nine R* refusal strings). A compiler that is a switch
on those ~15 input strings returning the expected IR/refusal turns every behavioral row green —
no 16-directive grammar exists in that impl. Nothing exercises a **novel** wavefile (all 16
directives in an unseen combination, a 17th member, an unseen directive order, a second scope
directive after a member block). P4/S3 are satisfiable by a hardcoded 16-name `WAVEFILE_DIRECTIVES`
(name presence + count only). P6/P8/P9/P10/R10/OQ6 and PIN-B/C/D/E are string-presence source
scans: they force the *surface strings* to exist (CLI verb, MCP tool, web arm, facade method,
registry row, render docs) but do not prove the surface *compiles correctly* — a wrong impl wires
the `compileWavefile` references and keeps the fixture-switch as the parser.

PIN bite tests: PIN-A is the one genuinely **behavioral** pin (runs the real interpreter and
asserts the DSL text still refuses "not valid JSON") — it bites the cheapest structural wrong impl
(moving the compile seam inside the interpreter). PIN-B scans only the *interpreter* for a 6th
admission code; a compiler that mints its own new code is invisible to it. PIN-C/D/E are
string-presence — they bite their specific regression (field-set change, schemaVersion check
removal, detail-leg removal) but nothing semantic.

**Cheapest wrong impl:** fixture-sniffing compiler + the surface strings. **Missed attack:** no
novel-input row in any refusal class. **Coordinator verdict:** sound on surface integration, but
the parser-generalization axis is only as strong as the fixture list — needs a fold adding
novel-input legs before #170 gates the serialized impl.

### 5.2 #163 quiescence-completion-red — **mostly SOUND; R4 cluster thin**

The strongest piece is **N1**: the same quiet-roster fixture driven under the suite lane
(`hardCapMs: 3000`) must **never** quiesce — it kills the cheapest wrong impl (running the
quiescence predicate in the suite lane, i.e. a false 120 ms-floor WAVE-QUIESCED). P1/P2 guard the
unchanged fast-driver policy and the stuck-decision early-break. Behavioral rows R1/R2/R3/R5/N2/N3
carry the real discriminators (totality terminalization, readView projection, hard-break, no
re-wake after declaration).

The **R4 cluster (R4a/R4b/R4c/R4e) is declaration-existence**: source scans that the named constant
`QUIESCENCE_MIN_SILENT_POLLS`, the set `ACTIVE_TURN_PHASES`, the reset-set kinds, and the closed
exit enum *exist*. A wrong impl that declares those names and never wires them into the predicate
passes the R4 cluster — the wiring is only caught if R1/R2/N2/N3 happen to exercise it. R4d
(`normalizeDriver` accepts the null sentinel) is the most behavioral of the group.

**Cheapest wrong impl (R4 cluster):** declare the named symbols, leave them unused. **Missed
attack:** a predicate keyed only on silence (ignoring phase/liveness re-arm) — the re-arm *set* is
declaration-tested (R4c), with the reset *behavior* carried only by N2. **Coordinator verdict:**
ACCEPT-leaning; the R4 declaration rows are thin but pin the fold's boundary spellings.

### 5.3 #165 launch-validation-red — **SOUND, one decorative token**

The driver rows (A1/A2/A3/A3-nearmiss/A4/A4-object/A5/A7) are **behavioral and real** — they spawn
the actual `run-task-wave.mjs` (A1/A2/A3/A3-nearmiss) and drive the real embedded interpreter lane
(A4/A4-object/A7). A3-nearmiss (a `### Deliverables` heading with no `##` section still refuses)
is a strong anti-typo closure. A5 forces the `workflow_harvest_invalid` code through CLI, MCP, and
web (three transports, no re-spelling). A6 (normalization non-refusal) binds against a raw-string
set-difference; E1 pins the exit-code map.

**The gap is `brief_unreadable`**: of the four driver refusal tokens, three are behaviorally
exercised (`target_directory_refused` A1, `deliverables_malformed` A3, `deliverables_uncovered`
A2) — the fourth, `brief_unreadable`, is asserted **only** by the S1 static-token scan (the literal
exists in the driver source). A driver that never opens the brief — or silently treats an unreadable
brief as empty — passes A1–A7 (all use a readable brief) and S1 (string present). The token is
**DECORATIVE** until a behavioral unreadable-brief row lands.

**Cheapest wrong impl:** satisfy S1 by dropping `brief_unreadable` into a comment. **Missed attack:**
no unreadable/missing-brief behavioral leg. **Coordinator verdict:** ACCEPT with a fold note —
add one `--brief <missing>` behavioral row, or strike `brief_unreadable` from the vocabulary.

### 5.4 #167 readiness-honesty-red — **SOUND**

The verdict axis (unverified vs probe-verified vs failed) is genuinely discriminated: A1a requires
a static-only row to read `unverified` (never self-relabeled probe-verified) while a fresh
content-verified probe reads `probe-verified`; P-stale/V-stale force the lapsed-window → unverified
law. A wrong impl that hardcodes either pole fails the other. A4 (quota/capacity wire → typed
`provider_quota`, distinct from `provider_unreachable`, excluded from auto-re-probe) and A-Lcap
(the 2 KiB capture-bound cost-honesty discriminator) are strong and behavioral. The source-scan
rows (A1c northbound re-add, A3 guidance rows, A6 spawn-gate coverage) check surface presence, but
the value-wiring is carried by the behavioral rows.

**Missed attack:** none found that survives A1a + P-stale together (the self-relabel and the
stale-verify are the two hardcoded-projection cheats, and both are covered). **Coordinator verdict:**
ACCEPT-leaning; the source-scan rows should not be counted as independent of their behavioral twins.

### 5.5 #146 seat-telemetry-red — **SOUND (deepest of the five)**

The DISCRIMINATOR LAW is the strongest in the wave: the allocator's `_resolveExplicitRoute`
(coordinator.mjs) does **not** gate on `turnCompletion: 'pausable'` while `adapterFor`
(route-liveness.mjs) **does**. A wrong impl that reads `adapterFor` can never reproduce the
allocator's counts — A9 (3 legs, LOAD-BEARING) and A10 (occupancy === seats everywhere) force the
impl onto the allocator path. A4 (0 or >1 eligible → null) is the honest-null law; A-L lints the
planted fixtures so the discriminator is not fixture-inert.

**Residual risk:** nothing is landed, so every capability row fails at `stage:*missing` — the suite
only discriminates at full-landing, not incrementally (inherent to red-first, worth the row naming).
The header cites absolute line ranges in *prose* (coordinator.mjs:2994-3034, route-liveness.mjs
121-129) — documentation, not an assertion anchor, but it will go stale on the next refactor.
**Coordinator verdict:** ACCEPT-leaning; note the full-landing-only discrimination.

## 6. Escalation (authority-class → UP)

DECISION_REQUEST (recorded — the channel is not reachable from this seat's toolset):

- **A** — wait for the five rows and re-invoke the coordinator when `signalOnMembersDone` fires.
- **B** — proceed on this coordinator attack pass; record wave-b as NOT-YET-ROW-QA-ABLE.
- **C** — mark wave-b blocked on row delivery and re-dispatch the five rows.

## 7. Shared publish

`shared` scratchpad write not reachable from this seat's toolset; full text delivered here as the
durable artifact. Recorded as unperformed (evidence, not silence).

## 8. Row-by-row status

| row | suite | report on disk? | row verdict | coordinator suite read |
|---|---|---|---|---|
| row-bt170 | workflow-dsl-red | ABSENT | — | SHALLOW on parser generality |
| row-bt163 | quiescence-completion-red | ABSENT | — | mostly SOUND; R4 cluster thin |
| row-bt165 | launch-validation-red | ABSENT | — | SOUND; `brief_unreadable` decorative |
| row-bt167 | readiness-honesty-red | ABSENT | — | SOUND |
| row-bt146 | seat-telemetry-red | ABSENT | — | SOUND (deepest) |

## 9. What unblocks a real cross-check

The five `blueteam-<issue>.md` reports landing in `docs/reference/evidence/blue-team-2026-08-13-b/`
(or the `shared` partition). At that point I can uphold/overturn each row against its report,
reproduce its one spot-checked claim, critique its missed-attack list, and issue suite
ACCEPT/NEEDS-FOLD with the concrete fold instruction set (the candidate folds are already named in
§5).
