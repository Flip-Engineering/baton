# Issue #165 — launch-time harvest-contract validation: implementation contract v2

The implementation contract for issue #165: a wave launch declares deliverables (the brief) and
harvest targets (`--targets` on the generic driver, `harvest.paths` in a `waves.run` spec), and
NOTHING checks they agree. Two failure classes were witnessed live in the same session (the
friction ledger App-D row 1, `orchestrator-friction-ledger.md:117`): a directory `--targets` entry
(`impl/src`) silently poisoned an impl wave's harvest while the verdict still read `IMPL-67-OK`,
and contract files named as deliverables in the brief but absent from `--targets` were edited by
the worker and silently dropped by the harvest — recovered twice by pin-diff. This contract
specifies the launch-time refusals that close both classes: the **file-only law, everywhere**
(D1), the **deliverable-coverage check** (D2, on both the driver and the interpreter admission
seam), and the **spec-side admission pin** (D3).

This is a **Ring-2 contract** (ground truths → decisions → refusal vocabulary → red-first
acceptance pins → open questions): it **specifies behavior**; it does not amend implementation in
this artifact. It is folded to **v2**: the wave-b red-team report (`redteam-165.md`, four blockers)
and the wave-b blind QA (`review-foundry-2026-08-13-b/review-qa.md` §3, instruction set §3.4) were
both applied; the `## Fold record` maps every blocker, amendment, note, and QA instruction to its
resolution (FOLDED / STRUCK / ESCALATED). Every pin below is RED at the verification HEAD by
construction, and the drafting discipline of the shared frame (verified citations, no clocks, no
new numeric limits) holds throughout.

- **Date:** 2026-08-13
- **Status:** v2 — folded implementation contract (red-first; no code landed for this rung)
- **Attempt:** `[attempt: e83aec24-cee5-479a-a6fb-165fecd52a03 row-launchval]` (v1 drafting
  attempt, retained); this fold's attempt is `[attempt: 31545279-5f3c-49ad-809b-2492a09b0efc
  row-fold165]`, echoed verbatim in `fold-165.md` (first five lines, per the attempt-echo law #171).
- **Verification HEAD:** `e371f70` ("Baton private effective-tree snapshot"). Every `file:line`
  citation below was re-verified THIS fold session with `grep -an`/`sed -n`/`Read` at this HEAD, not
  inherited. The NUL-bearing files (`application.mjs`, `coordination-store.mjs` — 3 NUL bytes
  each) were cited by `grep -an`/`sed -n` only; `workflow-interpreter.mjs`, `run-task-wave.mjs`,
  the friction ledger, and `workflow-as-data-red.test.mjs` were read directly (NUL-free).
- **Briefs:** `foundry-brief.md` + `row-launchval.md` (drafting, same dir) read fully; this fold
  additionally read `fold-2026-08-13-b/foundry-brief.md` + `fold-2026-08-13-b/row-fold-165.md`
  (the fold frame, read from the main tree — the worktree snapshot predates the fold-pack commit),
  `redteam-165.md` (the row report), and `review-foundry-2026-08-13-b/review-qa.md` §3 (the blind
  QA). The shared frame binds: ring-2 form, verified citations, no clocks as controls, no
  `localeCompare`, byte literals only in `limits.mjs`, publish-as-you-go to the `shared` scratchpad
  partition, and escalation via DECISION_REQUEST on authority-class ambiguity. The blind-QA law
  applies: where the QA (written without the row report) and the row report conflict, the row
  report governs.
- **Read-order executed.** (1) `foundry-brief.md` (the shared frame); (2) `row-launchval.md` (the
  row brief — the problem, D1/D2/D3, the read-order); (3) `run-task-wave.mjs` (the generic
  driver's target/harvest machinery, in full); (4) `workflow-interpreter.mjs`
  (`admitHarvest`/`admitHarvestEntry`/`assertHarvestContained`/`harvestOne`/`renderObjective` — the
  file-not-directory law's current home and the objective-brief read, in full); (5)
  `orchestrator-friction-ledger.md` Appendix D row 1 (the live incidents this contract answers);
  (6) the model contract `contract-fold.md` v1.1 (the form); (7) `workflow-as-data-red.test.mjs`
  (the W1-05 suite, the natural home of the interpreter admission pins); (8) the `waves.run`
  surface anchors in `application.mjs`, `application-cli.mjs`, `mcp-northbound.mjs`,
  `web-northbound.mjs`; (9) this fold's raw material: `redteam-165.md` and
  `review-foundry-2026-08-13-b/review-qa.md` §3.
- **Scope of the rung, in one sentence:** a directory harvest target refuses **at launch** with a
  typed refusal on BOTH surfaces (the driver refuses a directory `--targets` entry before the wave
  starts; the interpreter refuses a directory `harvest.paths` entry at spec admission), a brief
  that declares deliverables via a strict `## Deliverables` front-matter is coverage-checked
  against the harvest targets at launch on both surfaces (the driver against `--targets`; the
  interpreter against `harvest.paths` at the objective-brief admission read), and the `waves.run`
  spec-side admission law is pinned (file-shaped + contained + no escapes + covered, all
  `workflow_harvest_invalid`) — while the landed harvest-time blob check
  (`workflow-interpreter.mjs:632`, the #74 half) stays as the interpreter's backstop for paths
  created during the wave (the driver's created-directory case is a named follow-on, OQ6).

---

## Ground truths (verified this session)

- **G1 — the file-not-directory law lives ONLY at harvest time in the interpreter; admission
  checks containment only.** `harvestOne` refuses a directory structurally at the result sha: a
  harvest path whose object type is not `blob` is skipped so `recovered` stays null and the miss
  path refuses `harvest_miss` (`workflow-interpreter.mjs:632`; the D4 v1.2 comment at `:358-361`
  documents that `git show <sha>:<dir>` returns a tree listing, so the blob check is the law's
  structural home). But admission — `admitHarvest`/`admitHarvestEntry`
  (`workflow-interpreter.mjs:291-316`) — validates only the closed shape (string or
  `{path, mustContain}`, non-empty, unknown fields refused) and containment
  (`assertHarvestContained`, `:320-327`, lexical `..`/absolute/backslash/NUL plus the realpath
  symlink-escape check). A harvest path naming a directory passes admission today and refuses
  only AFTER the wave has run, as a `harvest_miss` receipt — the worker's effort is spent, and the
  refusal is a receipt, not a launch refusal.
- **G2 — the driver has neither the launch-time refusal NOR a harvest-time blob check.** The
  generic driver collects `--targets` (`run-task-wave.mjs:34`) and validates only presence
  (`:44-47`); there is no `stat`/`cat-file`/`isDirectory` anywhere in the file (verified by grep —
  the only `.status()` call is `handle.status()` at `:117`; `:138` reads
  `view?.terminalOutcome?.status` — a **field read**, not a `.status()` call). The harvest loop
  (`:171-185`) reads `git show <pin>:<path>` and `writeFileSync(resolve(repo, entry.path), …)`:
  a directory target either (a) drops silently (its tree listing matches the launch listing and is
  filtered, or its listing is under the 200-byte floor), or (b) throws `EISDIR` on materialize and
  **poisons the whole pin** — the file targets that follow never materialize. That nondeterminism
  is exactly the App-D incident class (`orchestrator-friction-ledger.md:117`: "a directory target
  poisons the whole harvest").
- **G3 — the launch tree is checkable at admission on both surfaces.** The interpreter's
  `admitSpec` passes `repoRoot` into `admitHarvest` (`workflow-interpreter.mjs:154`); the
  `waves.run` port supplies the coordinator's repo root (`application.mjs:11640,11645`). The
  driver runs with `cwd = repo` and already resolves targets against it (`run-task-wave.mjs:29,184`).
  A working-tree shape check (`existsSync` + `statSync().isDirectory()`) distinguishes a directory
  from a file — or an absent new path — at launch, before any wave resources are provisioned.
- **G4 — the scope class already refuses a bare directory at admission; the harvest class joins
  it.** `admitMember` refuses a non-glob scope entry whose basename has no `.` with
  `workflow_member_invalid` naming the entry and coaching `use "${trimmed}/**"`
  (`workflow-interpreter.mjs:196-203`). The launch-time directory refusal for harvest paths is the
  same posture, applied to the harvest field with its own typed code (`workflow_harvest_invalid`).
- **G5 — App-D row 1 is the authority for both D1 and D2.** The folded LAW at
  `orchestrator-friction-ledger.md:117`: "any brief that names a deliverable must have that path in
  `--targets`; … **`--targets` name FILES, never directories**; the driver must refuse a directory
  target at launch (it knows the shape) and must verify post-harvest that every target's tree
  content equals the pin content — candidate rows for the driver's next rung." This contract ships
  the two launch-time halves (directory refusal, coverage) and names the post-harvest tree-content
  check as a follow-on (OQ2).
- **G6 — the driver never reads the brief today.** `--brief` is used only to compute `briefRel`
  and embed the path in the objective (`run-task-wave.mjs:60-64`); no file read, so no coverage
  check can exist. The objective line itself — `Deliverables (edit ONLY these): ${TARGETS.join(' · ')}`
  (`:63`) — is by construction a subset of the targets, so the objective adds no uncovered set; the
  brief is the only second source of deliverable declarations.
- **G7 — the `waves.run` surface is the three transports plus the direct port, and the
  `workflow_*` refusals already survive them.** `application.mjs:11631` (`runWorkflow`, the
  `waves.run` command port) calls the interpreter at `:11645`; the CLI parses `baton waves run
  <spec.json>` at `application-cli.mjs:1327-1332`; MCP dispatches `baton_waves_run` at
  `mcp-northbound.mjs:1795-1796`; the web bus admits `waves_run` as a direct port at
  `web-northbound.mjs:46`. The interpreter's field/role-named `workflow_*` refusals are documented
  to survive the MCP transport (`application.mjs:11625-11630`, "the MCP stateFailureCode allowlist
  preserves them"). D3's refusals reuse that family — no new transport-side vocabulary.
- **G8 — the interpreter suite's W1-05 is the natural home of the admission pins.** The
  harvest-invalid stage (`workflow-as-data-red.test.mjs:663-690`) drives malformed harvest specs
  through the interpreter and asserts `workflow_harvest_invalid` with the offending token named;
  the fixture repo creates a real `docs/reports` directory (`:362`) — a ready directory-shaped
  harvest path for a new admission case (`harvest: { paths: ['docs/reports'] }`). The landed
  containment cases (`:679-681`) prove the admission seam already throws the typed code; the new
  file-shape case joins the same table. The W3 fixture's `docs/reports/${role}.md` harvest paths
  (`:744`) are files inside that directory — the file-shape check does not disturb them.
- **G9 — the interpreter's objective render already reads the brief at admission-adjacent time.**
  `runWorkflow` renders every member's objective via `renderObjective` (`workflow-interpreter.mjs:510`
  calling `:333-348`), which resolves the `objectiveRef` and `readFileSync`s it (`:339`). The
  deliverable-coverage parse (D2b) rides that existing read — the interpreter never reads the
  brief twice, and no new I/O authority is added.
- **G10 — no clock and no new numeric limit is needed for any of D1-D3.** The file-only law is a
  shape check; the coverage check is set membership over normalized paths; the spec-side admission
  is three shape/scope predicates plus the coverage predicate. Nothing is time-based (no clock as a
  control) and nothing introduces a cap (no #89 `limits.mjs` row; the campaign control law is
  untouched).

---

## D1 — the file-only law, at launch, on both surfaces

A directory harvest target refuses **at launch** with the typed code, on both the driver and the
interpreter. The harvest-time blob check (`workflow-interpreter.mjs:632`, the #74 half) is the
landed backstop **on the interpreter surface** for paths the wave *creates*; the launch-time
refusal is the new half that stops a directory *declared at launch* before any work is spent. The
law is categorical, per App-D: **`--targets` / `harvest.paths` name FILES, never directories** — a
path that exists in the launch tree as a directory is a launch error, not a wave to run.

- **D1a — the driver refuses a directory `--targets` entry before the wave starts.** After the
  existing argument validation (`run-task-wave.mjs:44-47`) and before `waves.start` (`:82`), the
  driver checks each `--targets` path against the launch working tree: for `path` in `TARGETS`,
  resolve against the repo (`resolve(repo, path)`); if the resolved path **exists and is a
  directory**, refuse with the typed driver code `target_directory_refused` (exit code 2, the
  driver's launch-refusal class), message naming the path and the law:
  `--targets "<path>" names a directory — targets name FILES (the file-only law); a directory
  target poisons the whole harvest (friction-ledger App-D row 1)`. An **absent** path passes — the
  wave may create it (the contract file pattern: every `contract-<issue>.md` in this foundry wave
  is absent at launch HEAD). This is the App-D "the driver knows the shape" half made mechanical.
  A path absent at launch that the wave *creates* as a directory is a **harvest-time** case, not a
  launch shape — the driver's created-directory file-shape gap is scoped out as a named follow-on
  (OQ6), distinct from OQ2's tree-content equality.
- **D1b — the interpreter refuses a directory `harvest.paths` entry at spec admission.** In the
  `waves.run` path, `admitHarvestEntry` (`workflow-interpreter.mjs:300-316`) gains the launch-tree
  shape check for BOTH entry forms (string and `{path, mustContain}`): when `repoRoot` is set — the
  `waves.run` surface always supplies it (G3), and `renderObjective` refuses
  `workflow_objective_ref_invalid` without one (`:335`) — and the resolved path **exists and is a
  directory** in the launch working tree, throw `workflow_harvest_invalid` naming the path and the
  law: `the harvest path "<path>" names a directory — harvest paths name FILES (the file-only
  law)`. An absent path passes (the harvest-time blob check `:632` remains the backstop). The check
  lives on the admission seam (`admitSpec` → `admitHarvest` → `admitHarvestEntry`, `:154,:291-316`)
  — the same seam that already refuses containment escapes — so it fires before `waves.start`,
  exactly as the scope class fires at admission today (G4).
- **Why launch-time, why both surfaces.** The D4 v1.2 check (`:632`) refuses a directory only
  after the whole wave has run, and only on the interpreter; the driver has no blob check at all
  (G2), so its directory target silently drops or EISDIR-poisons the pin. Refusing at launch on
  both surfaces removes the entire incident class before any worker turn, and the two surfaces
  share one predicate (working-tree shape) so a launch that passes D1a passes D1b with the same
  semantics.

The D1b check is **scoped to paths that exist at launch**: it never refuses a path the wave is
meant to create. The directory-in-the-launch-tree case is distinct from the created-file case, and
only the former is a launch refusal. (The gitignored-directory corner — a directory in the working
tree that `git add -A` would not capture into the base commit — is named in OQ1.)

---

## D2 — the deliverable-coverage check (both surfaces)

When the brief names deliverable paths and the harvest targets do not cover them, the launch
refuses naming the uncovered set. The deliverable declaration must be **parseable, not prose**: this
contract chooses the **`## Deliverables` front-matter convention** in the brief. The coverage law
holds on BOTH surfaces: the driver (D2a) checks the brief's declarations against `--targets`, and
the interpreter (D2b) checks each member's objectiveRef-brief declarations against `harvest.paths`
at the admission-adjacent objective render.

- **Mechanism chosen — a `## Deliverables` front-matter section in the brief; why not a driver
  flag.** A `--deliverables <path>…` flag would be trivially parseable but is the wrong source of
  truth: it duplicates `--targets` on the launch line and can drift from the brief — the drift is
  exactly the failure D2 prevents (the brief named the contract as a deliverable; `--targets`
  omitted it; the edit was dropped). The front-matter convention declares deliverables **in the
  artifact the worker reads**, next to the prose that names them, so there is ONE source of truth.
  It rides the existing `--brief` argument — zero new launch-line flags — and it mechanizes the
  App-D folded law verbatim (`orchestrator-friction-ledger.md:117`: "any brief that names a
  deliverable must have that path in `--targets`"). On the spec surface the same section is parsed
  from each member's objectiveRef brief at the objective render (D2b), so the source of truth is
  the same artifact on both surfaces. The honest limit is stated plainly: only
  front-matter-declared deliverables are checkable; prose is never parsed loosely (a loose parse
  would guess which prose tokens are paths — the refused path).
- **Strict grammar (closed, no prose).** The reader opens the brief file at launch. A section
  opens at a line whose trimmed text is exactly `## Deliverables`. It runs to the next line whose
  trimmed text starts with `#` **at depth ≤ 2** (`#` or `##` — a `###` subsection does NOT
  terminate the section, so bullets beneath a subsection stay in scope) or to EOF. Fenced regions
  are skipped: a line whose trimmed text is exactly ``` or `~~~` opens a fence, and content inside
  a fence is documentation, not a live section (a fenced `## Deliverables` example or a fenced
  path list is not parsed). Within the section, blank lines are skipped; every other line must be
  either a bullet (`- <path>` or `* <path>` — the marker plus exactly one space) or a bare path
  (`<path>`). Each `<path>` must be repo-relative and **positive-shape-valid**: non-empty, no NUL,
  no leading `/`, no `\`, no `..` segment — the same escape class `assertHarvestContained` enforces
  (`workflow-interpreter.mjs:321`) — AND **no whitespace**, and its basename carries a `.` or the
  path contains a `/` (the interpreter's own bare-directory precedent at `:196-203`: a bare
  basename without a `.` is a directory shape, not a file path). Any other line — a
  whitespace-bearing prose sentence, a table row, a fence marker, a near-miss heading — refuses
  `deliverables_malformed` (exit 2 on the driver) naming the offending line. A **near-miss
  heading** — `#+ Deliverables` at any depth ≠ 2, or a `## Deliverable` prefix that is not exactly
  `## Deliverables` (e.g. `## Deliverable Files`) — refuses `deliverables_malformed` naming the
  heading, so a typo'd heading can never silently disable the coverage guarantee. A brief that
  cannot be read refuses `brief_unreadable` (exit 2) naming the path — a launch whose worker could
  not read its brief is a broken launch, not a wave to run. (Note: this widens every `--brief`
  launch to require a readable brief even when no `## Deliverables` section exists — a stated
  behavior change, not a bug.) The front-matter declares **paths, not content**: a
  `{path, mustContain}` content requirement has no front-matter home — a brief author moves it to a
  `waves.run` spec's `{path, mustContain}` harvest entry (`workflow-interpreter.mjs:308,311,314`).
- **Normalization before the set difference (one pass).** Every parsed deliverable and every
  harvest target is normalized ONCE before the coverage comparison: strip a leading `./`, collapse
  a duplicate slash (`//` → `/`), and strip a trailing `/` — the same normalization the driver's
  `resolve(repo, path)` applies at D1a (`run-task-wave.mjs:29`). A brief listing `./docs/x.md` with
  a `--targets` of `docs/x.md` is COVERED, not a false `deliverables_uncovered` — pinned by A6.
- **D2a — the driver coverage predicate.** After parsing, compute the uncovered set
  `deliverables − targets` (set difference over the normalized sets). If it is non-empty, refuse
  `deliverables_uncovered` (exit 2) naming the uncovered set, e.g. `--targets does not cover the
  brief's deliverable(s): <path> · <path> — every brief-named deliverable must be in --targets
  (the file-only harvest law)`. Coverage is `deliverables ⊆ targets`: targets may name MORE than
  the deliverables (the App-D suite-fold rule — the contract file is BOTH a deliverable and a
  target — is the canonical example).
- **D2b — the spec-surface coverage predicate (`waves.run`).** At the interpreter's
  admission-adjacent objective render (`runWorkflow` → `renderObjective`,
  `workflow-interpreter.mjs:510,:333-348`), for each member whose `objectiveRef` brief declares a
  `## Deliverables` section, parse it with the same strict grammar and normalize both sides
  (same one-pass normalization as D2a). Compute `deliverables − harvest.paths` over the
  normalized sets. If non-empty, refuse `workflow_harvest_invalid` naming the uncovered set:
  `the member "<role>" objectiveRef brief declares deliverable(s) absent from harvest.paths:
  <path> · <path> — every brief-named deliverable must be in harvest.paths (the file-only harvest
  law)`. Coverage is `deliverables ⊆ harvest.paths`; paths may name MORE than the deliverables.
  The check rides the existing brief read (`renderObjective`, `:339`) — no new I/O — and fires
  before `waves.start`, alongside the D3 admission axes. A member brief without a `## Deliverables`
  section contributes no declared deliverables (the same optional-section rule as D2a).
- **Absent section ⇒ no coverage check.** The `## Deliverables` section is optional on both
  surfaces. A brief without it declares no mechanically-parseable deliverables, so the coverage
  predicate is vacuous and the launch proceeds unchecked on this axis. The contract states this
  tradeoff openly: the foundry's own briefs (this wave included) declare deliverables in prose and
  therefore get no coverage guarantee until they adopt the front-matter (OQ3) — the mechanical half
  of the App-D law is exactly as strict as the declaration it parses.
- **Order at launch.** D1a (target shape) first, then D2a (brief coverage), then `waves.start`
  (`run-task-wave.mjs:82`). A directory target and an uncovered deliverable both refuse before any
  wave resource is consumed. On the spec surface, D1b and D3's axes run inside `admitSpec`
  (`:154`); D2b runs at the objective render (`:510`), still before `waves.start`.
- **Boundary: targets ⊆ scope is NOT checked this rung.** The driver passes `--scope` and
  `--targets` independently (`run-task-wave.mjs:33,34`); nothing verifies that every target matches
  some scope glob, so a target the worker's scope cannot touch surfaces as a harvest
  `-INCOMPLETE`, not a launch refusal. Named as an explicit exclusion (the launch operator is the
  trust boundary for target-scope agreement today), recorded in OQ5 — a later rung could add the
  subset check with both inputs already in argv.

---

## D3 — the spec-side admission pin (`waves.run`)

For `waves.run` specs, a harvest path is validated at **admission** on three axes, all refused
`workflow_harvest_invalid` (the existing typed code, `workflow-interpreter.mjs:32`):

1. **File-shaped (NEW, D1b):** the path must not resolve to a directory in the launch tree.
2. **Contained (EXISTING):** the lexical check — no NUL, no absolute path, no backslash, no `..`
   segment (`assertHarvestContained`, `:321`).
3. **No escapes (EXISTING):** the realpath symlink-escape check — a path lexically inside that
   resolves through a symlink to an outside directory refuses (`:324-326`, via `escapesRepo`,
   `:116-125`).

The deliverable-coverage predicate (D2b) joins the same admission seam: a member objectiveRef
brief's declared deliverables are checked against `harvest.paths` at the objective render, with
the same `workflow_harvest_invalid` code. D3's three shape axes are unchanged; D2b is the coverage
axis of the same admission law.

The harvest-time blob check (`:632`) is unchanged and stays the backstop for paths absent at
launch **on the interpreter surface**: a created file recovers; a created directory refuses
`harvest_miss` in the receipt. The admission law therefore holds the whole lifecycle **on the
interpreter surface**: **launch-time shape/containment/coverage (D1b/D3/D2b) → harvest-time blob
(D4 v1.2)**. The driver surface's created-directory case is not closed by this rung — it is the
named follow-on OQ6.

The refusal reaches every `waves.run` transport with the same code and message: the CLI
(`baton waves run <spec.json>`, `application-cli.mjs:1327-1332`), MCP (`baton_waves_run`,
`mcp-northbound.mjs:1795-1796`), and web (`waves_run`, `web-northbound.mjs:46`) all route to the
same interpreter admission (G7); the `workflow_*` codes are documented to survive the transports
(`application.mjs:11625-11630`). No new code is introduced for the spec side — the typed family is
closed and reused.

---

## Refusal vocabulary

Closed and typed. The interpreter reuses the landed `workflow_*` family; the driver (a CLI script,
whose typed refusal is an exit code plus a stable message token) introduces four closed tokens.
All messages name the offending path/line — never a bare value.

| Code / token | Surface | Source | Context |
|---|---|---|---|
| `workflow_harvest_invalid` | interpreter (spec admission + objective render → `waves.run` on CLI/MCP/web) | `workflow-interpreter.mjs:32,291-327` | **extended:** a directory harvest path refuses at admission (D1b/D3); an uncovered objectiveRef-brief deliverable refuses at the objective render (D2b); the containment/escape refusals (`:320-327`) are unchanged and reuse the same code |
| `target_directory_refused` | driver (CLI) | new | a `--targets` path resolves to a directory in the launch tree; exit 2; message names the path + the file-only law (D1a) |
| `deliverables_malformed` | driver (CLI) | new | a `## Deliverables` line is not a strict bullet/bare path (including whitespace-bearing prose, a table row, a fence marker, or a near-miss heading); exit 2; message names the line (D2 grammar) |
| `deliverables_uncovered` | driver (CLI) | new | a front-matter deliverable ∉ `--targets`; exit 2; message names the uncovered set (D2a coverage) |
| `brief_unreadable` | driver (CLI) | new | the brief file cannot be read at launch; exit 2; message names the brief path (D2 precondition) |
| `harvest_miss` | interpreter (receipt) | `workflow-interpreter.mjs:639` | backstop (unchanged): a path absent at launch that ends as a directory at the result sha refuses in the receipt |

The driver's exit-code map (verified this fold): exit **2** for launch/argument refusals
(`run-task-wave.mjs:46,48,65`); exit **1** ONLY for start-refused (`:96` — the
no-run-returned-at-admission branch, itself a launch-time refusal; the only `process.exitCode = 1`
in the file); the harvest verdicts (`:192-198`) set `receipts.verdict` to
`-DRAINED`/`-FAILED`/`-OK`/`-INCOMPLETE` with **no exit-code assignment — the process exits 0**
even for a `-FAILED`/`-DRAINED`/`-INCOMPLETE` harvest. So there are two launch-refusal classes
(exit 2 for argument refusals, exit 1 for start-refused) and one receipt-carried harvest class
(exit 0); the launch refusals are distinct from the receipt-carried harvest verdicts and from each
other.

---

## Red-first acceptance pins

RED = fails at HEAD (`e371f70`); GREEN = passes after this rung lands. Each pin asserts behavior,
not implementation. Every pin is RED at HEAD by construction — each asserts a refusal that no
launch produces today (A6 is the one GREEN-path guard the fold adds, binding the normalized
coverage shape so a raw-string implementation cannot pass A2/A7 while false-refusing).

| Pin | Assertion | At HEAD |
|---|---|---|
| A1 | **Driver directory refusal (D1a):** `node run-task-wave.mjs … --targets impl/src --verdict V …` refuses BEFORE `waves.start` with exit code 2 and a message naming `impl/src` and the file-only law (`target_directory_refused`). | **RED** — the driver validates `--targets` presence only (`run-task-wave.mjs:44-47`); no `stat`/`cat-file`/`isDirectory` exists anywhere in the file (G2); a directory target reaches the harvest, where it silently drops or EISDIR-poisons the pin (App-D row 1). |
| A2 | **Driver deliverable-coverage refusal (D2a):** a brief with `## Deliverables` naming a path absent from `--targets` refuses exit 2 naming the uncovered set (`deliverables_uncovered`). | **RED** — the driver never reads the brief (`run-task-wave.mjs:60` embeds the path, reads nothing; G6); no coverage predicate can fire. |
| A3 | **Driver strict grammar (D2):** a brief whose `## Deliverables` section carries a whitespace-bearing prose line (e.g. `- the contract file, plus its fold map`, or `The report goes in docs/reports/.`) refuses exit 2 naming the line (`deliverables_malformed`). | **RED** — no brief read at all (G6); prose is neither parsed nor refused. |
| A4 | **Interpreter admission directory refusal (D1b/D3):** a `waves.run` spec with `harvest: { paths: ['docs/reports'] }` (the fixture's real directory, `workflow-as-data-red.test.mjs:362`) refuses `workflow_harvest_invalid` naming `docs/reports` AT ADMISSION — the W1-05 table gains the case (`:663-690`). | **RED** — `admitHarvestEntry` checks containment only (`workflow-interpreter.mjs:300-327`); a directory harvest path passes admission and refuses only at harvest time as `harvest_miss` (`:632`). |
| A5 | **Typed code survives the `waves.run` surface (D3 + D2b):** the same directory harvest spec refused via `baton waves run <spec.json>` (CLI), `baton_waves_run` (MCP), AND the web `waves_run` direct port (`web-northbound.mjs:46`) carries code `workflow_harvest_invalid` and a message naming the path — no transport-side re-spelling, no ghost, on all three transports. | **RED** — the admission check is absent (A4); there is no refusal to survive the transports. |
| A6 | **Coverage normalization non-refusal (D2):** a brief whose `## Deliverables` lists `./docs/x.md` (or `docs//x.md`, or a trailing slash) with `--targets` of `docs/x.md` does NOT refuse — the normalized set difference is empty and the launch proceeds. | **RED-by-implementation** — no coverage predicate exists at HEAD to misfire, so the pin binds the GREEN implementation (and the D2b interpreter side) to the one-pass normalization; a raw-string set-difference would false-refuse a normalized-equal pair (D2-H2). |
| A7 | **Spec-surface deliverable-coverage refusal (D2b):** a `waves.run` spec whose member objectiveRef brief declares `## Deliverables` naming a path absent from `harvest.paths` refuses `workflow_harvest_invalid` AT THE OBJECTIVE RENDER naming the uncovered set. | **RED** — `renderObjective` reads the brief only to build the objective text (`workflow-interpreter.mjs:339`); no `## Deliverables` parse and no coverage predicate exists (D2-H4). |

The pins deliberately do NOT include "a path absent at launch passes admission" or "a contained
file-shaped harvest recovers" — those are GREEN at HEAD today (the launch-time check is additive),
and a pin that passes at HEAD is no pin. They are asserted as behavior in D1b/D3, not as pins.

---

## Open questions

- **OQ1 — the gitignored-directory corner (D1b).** A harvest path that resolves to a directory in
  the working tree but is gitignored would refuse under the simple working-tree check, yet
  `git add -A` would not capture it into the wave's base commit, so the worker could still create a
  file there and harvest a blob. This is a rare corner (a gitignored directory at the exact harvest
  path) and the simple law is the honest default — but it is a **named refinement**, not a
  promise: the implementer may narrow the predicate with `git check-ignore` (a directory excluded
  from the base commit is not "a directory in the launch tree" in the harvest's sense). The pin A4
  uses a committed working-tree directory, so the simple law is pinned regardless of the
  refinement.
- **OQ2 — the App-D second candidate row (post-harvest tree-content equality).** App-D row 1 also
  names "the driver must verify post-harvest that every target's tree content equals the pin
  content" (`orchestrator-friction-ledger.md:117`). This contract ships the launch-time halves only
  (D1a/D2a); the post-harvest equality check guards a different failure (pin content diverged from
  the tree) that is the structural territory of #99's authoritative-sha accessor. Named as a
  follow-on, not shipped — and **distinct from OQ6**, which is the driver's created-directory
  *file-shape* gap, not a content-equality check.
- **OQ3 — briefs without `## Deliverables` (and the fence/near-miss discipline).** The foundry's
  own briefs (this wave's `foundry-brief.md`, `row-*.md`) declare deliverables in prose. Under D2's
  optional-section rule they get no coverage guarantee — the honest limit of a strict parser. The
  doc-discipline half of the App-D law (briefs adopt the front-matter) is a follow-on; this
  contract only makes the mechanical half possible. The strict-grammar closures this fold ships —
  fenced regions skipped, near-miss headings refused, `###` subsections non-terminating (D2) —
  mean a typo'd or fenced `## Deliverables` can never *silently* disable the check; the remaining
  vacuity is the prose-only brief, which is named, not silent.
- **OQ4 — the `shared` scratchpad publish is unlanded at HEAD.** The shared frame's
  publish-as-you-go requires the `run.scratchpad.append` verb (#158) — grep across `impl/` finds no
  `run.scratchpad.append`/`run_scratchpad_append`/`scratchpad.append` at this HEAD, so the verb is
  RED (unlanded), and this row has no tool path to the `shared` partition. The durable file
  `contract-165.md` is the deliverable; the coordinator brief's explicit fallback (read the durable
  files where the shared post is absent — "note which") covers this row: the shared post is absent,
  and the durable file is the source.
- **OQ5 — driver target containment AND targets ⊆ scope.** The driver's `--targets` are not
  containment-checked (only the interpreter's spec harvest paths are, D3). A `..` or absolute
  target would resolve outside the repo. The interpreter's `assertHarvestContained` (`:320-327`) is
  the exact predicate the driver could reuse; named, not shipped — the row brief scopes D1 to the
  file-only law, and the launch operator is the trust boundary for targets today. The related
  targets-⊆-scope boundary (a target the worker's scope cannot touch) is the same operator-trust
  exclusion (D2 boundary note); both are launch-time membership predicates the driver already has
  the inputs for, and both are named for a later rung, not shipped.
- **OQ6 — the driver's created-directory file-shape gap (D1-H1, distinct from OQ2).** The driver
  surface has no harvest-time blob backstop: a target **absent at launch** that the wave creates as
  a **directory** still poisons the driver's pin today — `git show <pin>:<dir>` returns a tree
  listing (`run-task-wave.mjs:176`), and a listing under the 200-byte floor makes
  `contents.some((e) => e.content.length < 200)` true → the whole pin is skipped (`:182`), while a
  ≥200-byte listing throws `EISDIR` on `writeFileSync` and the outer catch swallows the pin
  (`:184-185`). The interpreter surface has the `:632` blob backstop for exactly this class; the
  driver does not. This rung ships the launch-time halves (D1a/D2a) and explicitly scopes the
  driver's created-directory case OUT; the fix (a `git cat-file -t <pin>:<path>` blob check in the
  driver's harvest loop, skipping non-`blob` with a named harvest-time code) is a **named
  follow-on**, adjacent to but distinct from OQ2's tree-content equality.

---

## Cross-references

- **`orchestrator-friction-ledger.md:117`** (Appendix D row 1) — the two live incident classes
  (dropped contract edits; the `impl/src` directory poisoning the #67 harvest) and the folded LAW
  this contract mechanizes (deliverables ⊆ `--targets`; `--targets` name FILES).
- **`workflow-interpreter.mjs`** — `admitHarvest`/`admitHarvestEntry` (`:291-316`), the admission
  seam D1b/D3 extends; `assertHarvestContained` (`:320-327`), the containment law cited not
  re-specified; `harvestOne`'s blob check (`:632`) and the D4 v1.2 comment (`:358-361`), the landed
  interpreter backstop; the scope-class bare-directory refusal (`:196-203`), the admission-time
  precedent; the `workflow_harvest_invalid` typed code (`:32`); `renderObjective` (`:333-348`, read
  at `:339`) and its call at `:510`, the objective-brief read D2b's coverage parse rides.
- **`run-task-wave.mjs`** (the generic dogfood driver — lives at
  `docs/reference/evidence/run-task-wave.mjs`, not `impl/`; QA §3.2 positional note folded) —
  `--targets` (`:34`), usage validation (`:44-47`), the objective's deliverable line (`:63`),
  `waves.start` (`:82`), the harvest loop (`:171-185`) and its sub-200-byte / EISDIR poisoning paths
  (`:182,:184-185`), the `process.exitCode = 1` start-refused branch (`:96`) and the exit-0 verdict
  assignments (`:192-198`).
- **`application.mjs:11625-11645`** — the `waves.run` command port (`runWorkflow`), the
  `workflow_*` refusal survival claim, the coordinator repo-root supply.
- **`application-cli.mjs:1327-1332`, `mcp-northbound.mjs:1795-1796`, `web-northbound.mjs:46`** —
  the three `waves.run` transports D3's/D2b's typed refusals ride.
- **`workflow-as-data-red.test.mjs:663-690`** — the W1-05 harvest-invalid suite, the natural home
  of the A4 admission case; the fixture's `docs/reports` directory (`:362`).

## Campaign-law constraints

- **No clocks.** No wall-clock control is introduced; every D1-D3 check is a filesystem/set
  predicate at launch or at the objective render. The driver's existing deadline polling is
  untouched.
- **No arbitrary numeric limits.** The file-only law is a shape check; the coverage check is set
  membership; the spec-side admission is shape/scope predicates. No #89 `limits.mjs` row is added —
  there is no new bound to register, so there is no derivation to document.
- **No redesign of landed SOUND law.** The D4 v1.2 blob check (`:632`) stays verbatim as the
  interpreter's harvest-time backstop; `assertHarvestContained` is cited, not amended; the
  scope-class refusal (`:196-203`) is the precedent, not modified. The launch-time check is purely
  additive.
- **Ring-2 form.** This contract specifies behavior; it does not amend implementation. Every
  `file:line` citation was re-verified at HEAD (`e371f70`) this fold session — the NUL-bearing
  `application.mjs` by `grep -an`/`sed -n` only. No `localeCompare`; no sorted-key literal is
  reordered.
- **Escalation posture.** No authority-class ambiguity arose in this fold: the launch-time checks
  live on the driver/interpreter surfaces the row brief names, the D2 mechanism choice
  (front-matter over flag) is a judgment call recorded here (D2, "why not a driver flag"), and the
  two red-team "pick one" fixes were resolved as judgment calls recorded in the fold record
  (D1-H1 → scope-out OQ6; D2-H4 → extend to the interpreter seam) — not escalations.

---

## Fold record

- **Date:** 2026-08-13
- **Red-team:** `docs/reference/evidence/contract-foundry-2026-08-13/redteam-165.md` — four
  blockers, all binding (C1, D2-H1, D1-H1, D2-H4) + non-blocking D1-H2/D2-H2/D2-H3/D2-H5/D2-H6 +
  the A5 web omission + the C2/C3 nits + the `brief_unreadable` note.
- **QA:** `docs/reference/evidence/review-foundry-2026-08-13-b/review-qa.md` §3 — SOUND with one
  amendment (H1 path normalization), two nits, §3.4 instruction set. **Blind-QA law applied:** the
  QA's §3 verdict was written WITHOUT the row report; the row's four blockers stand and were
  folded ahead of the QA's "SOUND".
- **Top-orchestrator decision:** none applied — no authority-class ambiguity arose (the two
  "pick one" fixes were resolved as row judgment calls, below).
- **Every item below gets exactly one of FOLDED / STRUCK / ESCALATED.** No silent drops.

| Item | Verdict | Resolution |
|---|---|---|
| C1 — exit-code miscite | **FOLDED** | Exit-code map restated (2 = launch/argument refusal, 1 = start-refused, receipt-carried harvest verdicts exit 0); the `:96,192-198` anchor fixed to `:96` (start-refused) vs `:192-198` (verdicts, exit 0). Refusal vocabulary. |
| D2-H1 — bare-path grammar not closed | **FOLDED** | Positive path shape added (no whitespace; basename carries `.` or path contains `/`); whitespace-bearing prose/table rows/fence markers/near-miss headings refuse `deliverables_malformed`; A3 pins a whitespace-bearing prose line. D2 grammar; A3. |
| D1-H1 — no harvest-time blob backstop on the DRIVER surface | **FOLDED (scope-out)** | Chose the red-team's option (b): the driver's created-directory case explicitly scoped out as OQ6 (distinct from OQ2's tree-content equality); D1 opening and D3 lifecycle sentence made surface-explicit (the `:632` backstop is interpreter-only). D1a note; D3; OQ6. |
| D2-H4 — no deliverable-coverage check on the `waves.run` surface | **FOLDED (extend)** | Chose the red-team's first option: coverage predicate extended to the interpreter admission-adjacent seam (D2b, riding `renderObjective`'s brief read); refuses `workflow_harvest_invalid`; A7 pins it. D2b; D3; A7. |
| D1-H2 — interpreter `repoRoot` gating vs categorical framing | **FOLDED** | One line in D1b stating the precondition (the `waves.run` surface always supplies repoRoot; `renderObjective` refuses without one). D1b. |
| D2-H2 — raw string set-difference, no normalization | **FOLDED** | One-pass path normalization before the coverage set difference (strip `./`, collapse `//`, strip trailing `/`); A6 pins the non-refusal. D2 normalization; A6. |
| D2-H3 — fence-state awareness + near-miss/subsection vacuity | **FOLDED** | Fenced regions skipped; near-miss headings refuse `deliverables_malformed`; `###` subsections do not terminate the section; folded into OQ3. D2 grammar; OQ3. |
| D2-H5 — no targets ⊆ scope check | **FOLDED (named exclusion)** | Named as an explicit boundary (operator trust; a target the scope can't touch surfaces as harvest `-INCOMPLETE`); recorded in OQ5. D2 boundary note; OQ5. |
| D2-H6 — `{path, mustContain}` inexpressible in front-matter | **FOLDED (named exclusion)** | One-line "the front-matter declares paths, not content" in the grammar; content moves to a `waves.run` `{path, mustContain}` entry. D2 grammar. |
| A5 — web transport omitted | **FOLDED** | A5 now asserts the typed code on CLI + MCP + the web `waves_run` direct port. A5. |
| C2 — "three closed tokens" vs the four in the table | **FOLDED** | Re-counted to four in the refusal-vocabulary intro. |
| C3 — G2's `:138` "`.status()` call" | **FOLDED** | G2 now says `:138` is a `.terminalOutcome?.status` **field read**. G2. |
| `brief_unreadable` behavior-change note | **FOLDED** | Stated explicitly in the D2 grammar (every `--brief` launch now requires a readable brief). D2 grammar. |
| QA §3.4 H1 — one path-normalization pass + a `./`/duplicate-slash non-refusal pin | **FOLDED** | Same fix as red-team D2-H2; A6 pins the non-refusal case. D2 normalization; A6. |
| QA §3.4 nits — four tokens; `:138` field read | **FOLDED** | Same fixes as C2/C3. |
| QA §3.4 ship D1a/D1b + strict grammar + D3 three-axis | **FOLDED (shipped as written)** | D1a/D1b and the strict grammar shipped with the blocker closures above; D3's three axes unchanged (D2b is the added coverage axis of the same admission law). D1; D2; D3. |
| QA §3.4 name OQ2/OQ3 as follow-ons | **FOLDED** | OQ2 and OQ3 named explicitly as follow-ons; OQ6 added (distinct from OQ2). OQ2; OQ3; OQ6. |
| G8 test-range nit (`:663-686` truncated) | **FOLDED** | Corrected to `:663-690` (the stage's loop body runs to `:689`). G8; A4. |
| QA §3.2 positional note — `run-task-wave.mjs` lives at `docs/reference/evidence/run-task-wave.mjs` (the generic dogfood driver), not `impl/` | **FOLDED** | One-line location clarification in Cross-references; the QA itself marks it "not an error" (anchors resolve). | Cross-references |

**Incremental fold notes (completeness pass, per the frame's no-silent-drops law):**

- **D2-H4 seam placement (judgment call).** The red-team fix (a) says "parse the brief at
  `admitSpec` (`:154`)". This fold places D2b at the objective render instead — `runWorkflow` →
  `renderObjective` (`:510,:333-348`), where the brief is ALREADY read (`:339`) — so the coverage
  check costs zero new I/O, still fires before `waves.start`, still refuses
  `workflow_harvest_invalid`. The red-team's own D2-H4 text names `renderObjective` as the feasible
  seam ("already reads the brief at admission-adjacent time, so the parse is feasible there"), so
  this is option (a)'s "interpreter admission seam", implemented at the existing brief read.
- **QA "pin A2/A3" → dedicated A6 (judgment call).** The QA's §3.3 H1 says "pin A2/A3 with a
  normalization case". This fold adds a dedicated A6 instead: the normalization non-refusal is a
  GREEN-path guard (at HEAD no predicate exists to misfire), a different pin kind from A2/A3's RED
  refusals — folding it into A2/A3 would blur the refusal pins' "RED at HEAD" contract. The
  substance (a pinned `./`-prefix / duplicate-slash non-refusal) is delivered by A6.
- **QA §6 "#165 ... `--check` wire path" (informational, mapped not dropped).** The QA's §6 line
  groups "#165 front-matter adoption and `--check` wire path" as "judgment calls the contracts
  already record". The `--check` half has no home in this contract — the v1 OQ set is OQ1–OQ5, none
  a `--check` wire path, and no `--check` appears in `row-launchval.md` or the v1 contract. It is a
  cross-row artifact of the QA's bundle: `--check` is the #167 liveness flag (`application-cli.mjs:1264`
  parsed, `:2213` dropped — #167's G5). The #165 half (OQ3 front-matter adoption; OQ4 the unlanded
  #158 append verb, the actual wire-path question) is already recorded in this contract's OQ3/OQ4.

## Deliverable boundary

The sole deliverables of this fold are the folded contract IN PLACE
(`docs/reference/evidence/contract-foundry-2026-08-13/contract-165.md`, version bumped to v2, fold
record appended) and the fold map
(`docs/reference/evidence/contract-foundry-2026-08-13/fold-165.md`); work was confined to
`docs/reference/evidence/contract-foundry-2026-08-13/**`. No source files were modified. The
publish-as-you-go `shared` post is absent because the #158 append verb is unlanded at HEAD (OQ4) —
the durable files are the coordinator's declared fallback source.
