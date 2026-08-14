# README_SPLIT-VERIFY v1

[attempt: 81778a60-c4e6-40a2-9809-32a46e054b3e coordinator]

# VERDICT: SOUND

The row-readme deliverables satisfy the README-split brief (docs acceptance). The product
README, the progress ledger, and the row's notes are present, in-scope, and citation-true.
The canonical gate and the doc-adjacent suites are unchanged by this wave (impl/ is
byte-identical to HEAD), and the two stage spot-audits (LANDED #170 + fencing; IN-FLIGHT
#159) hold against the code. No blockers.

---

## 1. Row settlement (per #174 law — verified on disk, not on a clock)

- Row worktree: `../../wt/ws-0250f6238fa55903a6d54d9446d99b97` (glm attempt `w-404`, same
  attempt salt `81778a60-…`). The `signalOnMembersDone` content matches this brief; I
  verified the deliverables directly in the sibling worktree.
- Deliverables present: `README.md` (rewritten, 19,525 B), `docs/reference/progress-ledger-2026-08-14.md`
  (12,559 B), `docs/reference/evidence/readme-split-2026-08-14/notes-row-readme.md`
  (6,935 B). The row's `[attempt: 81778a60-c4e6-40a2-9809-32a46e054b3e row-readme]` line is
  in the first five lines of the notes (harvest `mustContain "attempt:"` satisfied).
- Scope discipline: `git status --short` in the row worktree shows ONLY those three paths
  (`M README.md`, `?? notes-row-readme.md`, `?? progress-ledger-2026-08-14.md`). `impl/` has
  zero changes; `diff -r impl/test` between the row worktree and the clean HEAD worktree is
  empty — suites are immutable, so any green is earned by the (unchanged) impl.

## 2. Acceptance (run from the row worktree's repo root)

### 2.1 The row's named suite(s) at every named stage

- **Canonical gate `node impl/scripts/run-suite.mjs`** (the LANDED pin the README/ledger
  name): RUNNING at time of writing — last poll 614 tests / 98 fail (partial snapshot after
  ~1h45m of a >4,000-test run; the heavyweight adapter/atlas/driver suites each take 100–200s,
  so the full run is many hours, not minutes). See §3 for the failure classification. Every
  observed failure is a pre-existing in-flight red-by-design pin or the documented #7
  load-flake cluster; the aggregate cannot differ from clean HEAD because the test code is
  byte-identical and no suite reads any changed file (verified: every suite creates its own
  fixture README; none read the root `README.md`, the progress ledger, or the notes).
- **LANDED stage — spot-audited against the code:**
  - #170 workflow DSL (`workflow-dsl-red.test.mjs` + `workflow-dsl-package-red.test.mjs`):
    **47 tests / 47 pass / 0 fail** — the LANDED claim holds.
  - Fencing (`fence.test.mjs`): **12 tests / 12 pass / 0 fail** — the LANDED claim holds.
- **IN-FLIGHT stage — spot-audited against the code:**
  - #159 doc-truth conformance (`doc-truth-conformance-red.test.mjs`): **13 tests / 6 pass /
    7 fail** (R1, R3, R4, R5, R8, R9, R11 red). The 7 red pins are exactly the contract's
    un-implemented rows, matching the ledger's "red-first suites landed; impl queued" stage
    claim — the honest in-flight state, not a regression.

### 2.2 The row's named adjacents green-unchanged

- Doc-adjacent suite set (`control-surface-truth-red`, `cli-truthfulness-red`,
  `surface-conformance-red`, `cli-wave-fidelity-red`, `cli-silent-start-red`,
  `cli-dead-paths-red`): **59 tests / 53 pass / 6 fail — IDENTICAL in clean HEAD and the row
  worktree** (both runs measured).
- `doc-truth-conformance-red`: **13 / 6 / 7 — IDENTICAL in clean HEAD and the row worktree**.
- Conclusion: the docs change altered no suite outcome.

### 2.3 Citation integrity (the "no aspirational prose as fact" law)

- **40/40 LANDED suite paths** cited in `README.md` resolve on disk (glob patterns included:
  `phase61-representation-*`, `phase89-resident-*`, `turn-checkpoints-31*`).
- All cited `spec/` and `docs/` references resolve (`spec/phase36/…60/61`, `spec/adapter-contract.md`,
  `docs/33-`, `docs/36-`, `docs/38-`). The row's report of one corrected link
  (`docs/33-agent-repl-layer.md` → `docs/33-shared-objects-repl-layer.md`) is confirmed.
- **19/19 commits cited** in the README/ledger exist (incl. `68163cf` #170, `d8282d0` #79,
  `bf93263` glm ceiling, `30108cc` KG read-path, the 2026-08-14 wave bases).
- Capability-tier judgment calls the row made (#79 in-flight→LANDED; #170 as LANDED; KG write
  path split from read arc; #155–#160 cluster IN-FLIGHT) are each backed by a cited commit or
  PROGRESS.md checkpoint and are flagged as judgment calls in the ledger — not silent edits.

## 3. Anything not green, and why

- **Canonical gate exits nonzero overall** — by construction, per the README/ledger's own
  tier legend ("the red set is exactly the declared in-flight roster"). The observed red set
  (R1–R11, S-R*, PT-*, XA*, BD-3, P-MCP/P-APP/P-PUBLISH, the #158 scratchpad-write pins, and
  the `adapter.test.mjs` SESSION-interrupt/ACP load-flake cluster) is accounted in the
  declared in-flight roster or the documented #7 load-flake cluster; none is attributable to
  this wave (impl/ byte-identical, no suite reads the changed docs).
- **The row did not itself run the suites** (docs-only; it inherited the PROGRESS.md
  checkpoint). My acceptance runs them: the targeted LANDED/IN-FLIGHT/adjacent suites are
  measured (above); the canonical gate is still running and will be appended if it settles
  before close.
- **`gh` was unavailable in the row worktree**: issue open/closed state is cited from repo
  docs/git-log, not re-verified against the live tracker. The row flagged this. It does not
  block this docs wave (the README's tier claims are git/suite/dir-cited, not
  issue-state-dependent), but the in-flight/planned boundary should be re-audited against the
  live issue list before any external publication.

## 4. DECISION_REQUEST — authority-class ambiguity

No authority-class ambiguity rose to a blocking decision request. Two items are recorded for
the record rather than escalated:

1. **Live-issue-tracker re-audit before external publication** (the in-flight/planned tier
   boundary rests on repo-doc citations, not a live `gh issue list`). This is a deferred
   authority decision, not a blocker: the wave's claims are all git/suite/dir-cited.
2. **`impl/CLI.md`'s hand-written fleet table still lists only glm-5.2** while
   `impl/scripts/resident.deployment.mjs` declares glm-5.3 (`bf93263`). The row cited both
   sources rather than silently reconciling; the table lives in `impl/` and is out of the
   docs row's scope. Reconciliation (if any) belongs to an impl-side change, not this wave.

## 5. Deployment verification

The row's and the coordinator's deployment verification binding — executable `true`, argv
`[]`, cwd `.` — exits 0 (measured). Route, result, and cleanup truth for this docs-only wave
are preserved exactly.
