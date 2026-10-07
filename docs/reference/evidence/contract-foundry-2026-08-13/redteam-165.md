# #165 RED-TEAM REPORT — adversarial attack on the launch-time harvest-contract validation contract v1

- **Target:** `docs/reference/evidence/contract-foundry-2026-08-13/contract-165.md` (v1,
  issue #165 — launch-time contract validation: the driver refuses when brief deliverables exceed
  harvest targets). Read in full, plus the coordinator cross-check
  (`contract-foundry-2026-08-13/foundry-qa.md`, section "## #165") and the issue
  (`gh issue view 165` — **not fetchable from this session**: `gh` is unauthenticated and the
  GitHub API returns 404 for the private repo; the issue's problem statement was recovered from
  `row-launchval.md` and the friction-ledger App-D row 1, the same authorities the contract cites).
- **Date:** 2026-08-13
- **Verification HEAD:** `e371f704727cbca5fdff86af31ec8b154620a71f` ("Baton private effective-tree
  snapshot") — identical to the HEAD the contract and the foundry-qa cite. Every `file:line` below
  was re-verified THIS session with `grep -an`/`sed -n`/`Read` at this HEAD.
- **NUL discipline honored:** `application.mjs` was probed with `grep -an`/`sed -n` only (3 NUL
  bytes). `workflow-interpreter.mjs`, `run-task-wave.mjs`, `application-cli.mjs`,
  `mcp-northbound.mjs`, `web-northbound.mjs`, `application-client.mjs`, `coordinator.mjs`,
  `index.mjs`, the test file, and the friction ledger were read directly (NUL-free).
- **Scope:** the single deliverable
  `docs/reference/evidence/review-foundry-2026-08-13-b/redteam-165.md`. No source file was
  modified. The publish-as-you-go `shared` post is absent for the same reason the four rows'
  posts were absent (the #158 `run.scratchpad.append` verb is unlanded at HEAD; verified — no
  `run.scratchpad.append`/`run_scratchpad_append`/`scratchpad.append` anywhere in `impl/`, no
  baton CLI on PATH, no resident socket). The durable file is the coordinator's declared fallback
  source, per `coordinator-brief.md` and `foundry-qa.md`.

---

## 1. Citation re-verification (all at current HEAD)

**One wrong citation — the exit-code map in the refusal vocabulary — which per the frame's
citation law is an automatic blocker.** Everything else verified accurate.

Verified anchors (excerpts):

- `run-task-wave.mjs:34` `const TARGETS = takeAll('--targets')`; `:44-47` presence-only usage
  validation with `process.exit(2)`; `:48` (brief-path oversize) and `:65` (objective oversize)
  both `process.exit(2)`; `:60-64` `--brief` is used ONLY to compute `briefRel` and embed it in
  the objective (no `readFileSync(BRIEF)` anywhere — G6 holds); `:63` the
  `Deliverables (edit ONLY these): ${TARGETS.join(' · ')}` objective line; `:82` `waves.start`;
  `:96` `process.exitCode = 1`; `:117` `handle.status()`, `:138` `view?.terminalOutcome?.status`
  (a **field read**, not a `.status()` call — the foundry-qa nit is confirmed); `:166-185` the
  harvest loop (`git show`/`writeFileSync`), `:184` `writeFileSync(resolve(repo, entry.path), …)`,
  `:185` the outer `catch { /* not in this pin */ }`.
- `workflow-interpreter.mjs:32` `harvestInvalid` → `workflow_harvest_invalid`; `:116-125`
  `escapesRepo`; `:154` `admitHarvest(harvest, repoRoot)` from `admitSpec`; `:196-203` the
  scope-class bare-directory refusal; `:291-316` `admitHarvest`/`admitHarvestEntry` (closed shape +
  containment only — no directory shape check); `:320-327` `assertHarvestContained` (lexical
  `:321`, realpath symlink-escape `:324-326`); `:358-361` the D4 v1.2 comment; `:632` the
  `gitObjectType(...) !== 'blob'` skip in `harvestOne`; `:639` the `harvest_miss` receipt.
- `orchestrator-friction-ledger.md:117` — the App-D row 1 LAW text verbatim (both incident classes;
  "`--targets` name FILES, never directories"; the post-harvest tree-content-equality candidate row).
- `application.mjs:11625-11630` the MCP-W1 comment ("the interpreter throws the field/role-named
  `workflow_*` refusals (the MCP stateFailureCode allowlist preserves them)"); `:11631` the
  `runWorkflow` port; `:11640` `const repoRoot = this.driver?.coordinator?._repoRoot ?? null`;
  `:11645` `return runWorkflow(baton, specOrPath, { repoRoot, driver: … })`.
- `application-cli.mjs:1327-1332` the `baton waves run <spec.json>` → `waves.run` parse branch;
  `mcp-northbound.mjs:1795-1796` the `baton_waves_run` dispatch; `web-northbound.mjs:46`
  `['waves_run', 'waves.run', Object.freeze(['control','observe'])]` (a member of
  `WAVE_WEB_ENTRIES`, hence of `WEB_DIRECT_PORT_COMMANDS` at `:62` — the `:414` gate skips
  `validateApplicationCommandArgs`, so the interpreter's own admission is the argument authority).
- `workflow-as-data-red.test.mjs:362` `mkdirSync(join(repo,'docs','reports'), …)` — the real
  directory A4 needs; `:663-690` the W1-05 `stage[harvest-invalid]` test (the contract cites
  `:663-686` — the loop body runs to `:689`, a trivial range-truncation nit); `:679-681` the three
  landed containment cases; `:744` the W3 `harvest.paths` of `docs/reports/${role}.md`.
- `index.mjs:1480` `repoRoot: opts.repoRoot` forwarded to the Coordinator; `coordinator.mjs:944`
  `this._repoRoot = opts.repoRoot ?? null`; `application-client.mjs:1667-1674` `bindBaton` surfaces
  `driver?.repoRoot ?? driver?.coordinator?._repoRoot ?? null` as `baton.repoRoot`; so in the test
  fixture and on the deployed `waves.run` surfaces, `repoRoot` is non-null and A4's GREEN is
  reachable.

**C1 — wrong citation (blocker).** The refusal-vocabulary prose states: "the harvest-verdict
failures use exit code 1 (`:96,192-198`)". Verified: `:96` is the **start-refused** branch (`no run
returned at admission — see issue #129 class`) and the ONLY place `process.exitCode = 1` is set;
`:192-198` set `receipts.verdict` to `…-DRAINED` / `…-FAILED` / `…-OK` / `…-INCOMPLETE` and set **no
exit code at all** (the process exits 0 for a `-FAILED`/`-DRAINED`/`-INCOMPLETE` harvest). The
accurate map is: exit 2 for launch/argument refusals (`:46,:48,:65`); exit 1 for start-refused
(`:96`, itself a launch-time refusal); harvest verdicts are receipt-carried with process exit 0.
The "two classes are distinct and stay distinct" rationale is built on a false premise — the
harvest-failure class has no nonzero exit today, and there are already TWO launch-refusal classes
(1 and 2).

Two nits (both already named by foundry-qa; re-confirmed): C2 — the prose says the driver
"introduces three closed tokens" while the table lists **four** (`target_directory_refused`,
`deliverables_malformed`, `deliverables_uncovered`, `brief_unreadable`); C3 — G2's "only matches
are unrelated `handle.status()` calls at `:117,:138`" — `:138` is a `.status` **field** read (the
load-bearing negative claim — no `stat`/`cat-file`/`isDirectory` in the file — holds).

---

## 2. D1 — the file-only law, at launch, on both surfaces: **HOLE**

The launch-time shape check itself is correctly specified (working-tree shape, absent path passes,
interpreter gated on `repoRoot`, driver unconditional). Two findings:

### D1-H1 — the driver surface has no harvest-time blob backstop; the "whole lifecycle" claim is interpreter-only (blocker)

D1 opens with: "The harvest-time blob check (`workflow-interpreter.mjs:632`, the #74 half) is the
landed backstop for paths the wave *creates*; the launch-time refusal is the new half…". D3's
lifecycle sentence says: "the admission law therefore holds the whole lifecycle: **launch-time
shape/containment (D1b/D3) → harvest-time blob (D4 v1.2)**."

Both sentences read as covering BOTH surfaces. They cover only the **interpreter** surface.
`workflow-interpreter.mjs:632` lives in `harvestOne`, which the generic driver (`run-task-wave.mjs`)
does not use. The driver's own harvest loop (`:166-185`) has no blob check (G2 itself admits the
driver "has neither the launch-time refusal NOR a harvest-time blob check"). Consequence: a target
path **absent at launch** that the wave creates as a **directory** still poisons the driver's pin
today, exactly the App-D "a directory target poisons the whole harvest" class:

- `git show <pin>:<dir>` returns a tree listing, not a throw (`run-task-wave.mjs:176`).
- If the listing is < 200 bytes, `contents.some((e) => e.content.length < 200)` is true →
  `continue` → **the whole pin is skipped**, so the legitimate file targets that follow never
  materialize (`:182`).
- If the listing is ≥ 200 bytes, `writeFileSync(resolve(repo, entry.path), …)` throws `EISDIR` →
  the outer `catch { /* not in this pin */ }` swallows the pin (`:184-185`).

The contract's D1a is explicitly "scoped to paths that exist at launch"; the created-directory
variant on the driver surface is **neither closed nor named**. The honest scope boundary is missing:
a reader of the D1 opening and the D3 lifecycle sentence would reasonably believe the driver is
covered by the `:632` backstop.

**Fix (pick one):** (a) add the same blob check to the driver's harvest loop (`git cat-file -t
<pin>:<path>` — skip non-`blob`, refuse `target_directory_refused` or a named harvest-time code),
or (b) explicitly scope the driver's created-directory case OUT in one line (a named follow-on,
adjacent to OQ2 but distinct: OQ2 is tree-content **equality**; this is the **file-shape** gap on
the driver's materialize path).

### D1-H2 — the interpreter check's `repoRoot` gating vs the categorical framing (minor)

D1b is gated on "when `repoRoot` is set"; D1a is unconditional. In practice the gate is moot on the
`waves.run` surface — `admitMember` requires `objectiveRef`, and `renderObjective`
(`workflow-interpreter.mjs:335`) throws `workflow_objective_ref_invalid` with no repo root, so a
spec with members cannot pass with `repoRoot` null anyway — but the categorical "the file-only law,
everywhere" framing (and the table row naming `workflow_harvest_invalid` "a directory harvest path
refuses at admission") overstates a conditional. One line in D1b stating the repoRoot precondition
closes it.

---

## 3. D2 — the deliverable-coverage check: **HOLE** (six findings)

The mechanism choice (a `## Deliverables` front-matter section over a driver flag) and the
`deliverables ⊆ targets` direction are sound. The grammar and the boundary are not.

### D2-H1 — the "bare path" form subsumes arbitrary prose; the `deliverables_malformed` promise is false (blocker)

The grammar defines a shape-valid `<path>` as "non-empty, no NUL, no leading `/`, no `\`, no `..`
segment — the same escape class `assertHarvestContained` enforces". That is a **negative** check: it
refuses only escape-class lines. Every whitespace-bearing prose sentence is therefore a valid "bare
path". The contract's own "any other line — a prose sentence, a table row, a fenced block — refuses
`deliverables_malformed`" is false as specified:

- `The report goes in docs/reports/.` → not a bullet → **bare path** → passes shape → becomes a
  bogus deliverable → `deliverables_uncovered` naming the prose.
- `- the contract file, plus its fold map` → bullet, path = `the contract file, plus its fold map`
  (spaces are legal) → same.
- `| x | y |` (table row) and `` ``` `` (fence marker) → bare paths, not malformed.

So an honest-but-sloppy brief whose `## Deliverables` section is written in prose (as the foundry's
own briefs are — OQ3) refuses with a confusing `deliverables_uncovered` prose "path" instead of a
clean `deliverables_malformed`; and **A3 is shallow-greenable** — its GREEN ("a prose line …
refuses `deliverables_malformed`") is only satisfiable with prose that happens to contain an escape
character, so an implementer can pass A3 with a grammar that still misparses ordinary prose.

**Fix:** give the bare-path form a positive shape — e.g., add "no whitespace" (and optionally
require a `/` or a dot-bearing basename, the interpreter's own bare-directory precedent at
`workflow-interpreter.mjs:196-203`) to the shape-valid predicate, so every non-path-shaped line
refuses `deliverables_malformed`. Update A3 to pin a whitespace-bearing prose line.

### D2-H2 — the coverage predicate is raw string set-difference; no path normalization (hole)

`deliverables − targets` is literal string membership. The driver's D1a resolves paths with
`resolve(repo, path)` (normalizing `./x`, `a//b`, `a/./b`), but D2 compares raw strings. A brief
listing `./docs/x.md`, `docs//x.md`, or `docs/x.md/` while `--targets` carries `docs/x.md` →
false `deliverables_uncovered` on a legitimate spec (each side is also individually shape-valid, so
the refusal is not caught earlier). **Fix:** normalize both sides (strip leading `./`, collapse
`//`, strip trailing `/`) before the set difference, and reuse the same normalization D1a's
resolution uses.

### D2-H3 — no markdown fence-state awareness; near-miss headings are silently vacuous (hole)

The section terminator is "the next line whose trimmed text starts with `#`", and a section opens at
an exact `## Deliverables`. Three failure modes:
- A brief that *documents* the convention (a fenced `## Deliverables` example, or a fenced list of
  example paths) has its fence contents parsed as a live section → false `deliverables_uncovered`
  (or a bogus coverage pass). The parser is line-based and never tracks fence state.
- A near-miss heading (`### Deliverables`, `## Deliverable Files`) is neither parsed nor named — the
  coverage guarantee silently goes vacuous. This is worse than OQ3's prose case (which is named and
  open): a typo'd heading disables the check with zero signal.
- A subsection heading *inside* the deliverables area (`### Contract files` after `## Deliverables`)
  **terminates** the section (the terminator is any `#`-prefixed line), so bullets beneath it are
  silently excluded — a third vacuity path with no error.

**Fix:** skip fenced regions (track `` ``` `` / `~~~` fence state) and refuse or name a
near-miss heading (`#+ Deliverables` at any depth ≠ 2 → `deliverables_malformed` or a named
warning); require a `## Deliverables` section to end only at a same-or-higher-depth heading or EOF.
Fold this into OQ3.

### D2-H4 — the coverage check is driver-only; the `waves.run` surface has no deliverable-coverage law (blocker)

The validation boundary the brief asks about — "a deliverable path not in harvest paths?" — is
closed only on the driver. On the spec surface, the interpreter's admission validates `harvest.paths`
shape/containment (D1b/D3) but **never checks the objectiveRef brief's declared deliverables against
`harvest.paths`**. The App-D incident class this contract exists to close (a brief-named deliverable
absent from the harvest targets, edited by the worker, silently dropped) is still reachable via
`baton waves run`: an objectiveRef brief naming `docs/x.md` with `harvest.paths` omitting it drops
the edit with no launch refusal and a `WAVE-OK`/`WAVE-INCOMPLETE` receipt that never names the
missing path. `renderObjective` (`workflow-interpreter.mjs:333-348`) already reads the brief at
admission-adjacent time, so the parse is feasible there.

**Fix:** extend the coverage predicate to the interpreter admission seam — parse the brief's
`## Deliverables` at `admitSpec` (repoRoot is already supplied at `:154`) and refuse
`workflow_harvest_invalid` (or a named `deliverables_uncovered`-family code) when a declared
deliverable ∉ `harvest.paths` — or explicitly scope the spec surface OUT and name the exclusion in
OQ. The contract currently does neither, so the "validation boundary" is narrower than the issue's
incident class.

### D2-H5 — the coverage predicate never checks targets ⊆ scope (hole)

`deliverables − targets` is checked; **targets ⊆ scope is not.** The driver passes `--scope` and
`--targets` independently (`run-task-wave.mjs:33,34` → `scope: SCOPES` at `:86`, targets embedded in
the objective at `:63`); nothing verifies that every target matches some scope glob. A launch whose
`--targets` lists a file outside the worker's `--scope` proceeds, the worker is refused on the edit
(scope law), and the harvest silently reports `-INCOMPLETE` with no launch-time cause — the "scope
path the harvest can't see" boundary inverted (a target the worker can't touch). Both SCOPES and
TARGETS are in argv, so the subset check is a launch-time set/membership predicate (a target matches
a scope glob via the same glob semantics the wave machinery uses). **Fix:** add a targets ⊆ scope
launch refusal (a new typed code or the D1a class), or name the exclusion.

### D2-H6 — `{path, mustContain}` content constraints are inexpressible in the `## Deliverables` grammar (boundary note, non-blocking)

The interpreter's harvest-entry grammar already carries content constraints: `admitHarvestEntry`
accepts the `{path, mustContain}` entry form (`workflow-interpreter.mjs:308,311,314`) and `harvestOne`
enforces it (`:646-655` — the recovered bytes must include the substring, else `harvest_miss`), and
D1b's shape check explicitly covers "BOTH entry forms (string and `{path, mustContain}`)". The D2
`## Deliverables` grammar, by contrast, is strictly `<path>`-only (bullet or bare path) with no
`{path, mustContain}` form and no way to express a content requirement. Two consequences:
- A brief author who declares a content-constrained deliverable in prose ("`docs/x.md` must contain
  the marker VERDICT") has the whole sentence misparsed as a bare path (D2-H1) →
  `deliverables_uncovered` naming the sentence.
- The content constraint itself has no front-matter home, so a brief-named deliverable's *content*
  requirement is either silently reduced to path-presence coverage or dropped — the front-matter
  cannot produce a `mustContain`-carrying harvest entry the way a `waves.run` spec can.

**Fix:** either add a third front-matter form (e.g. `<path> must contain <literal>` parsed into a
`{path, mustContain}` deliverable), or explicitly name content constraints as out of scope for the
front-matter (a one-line "the front-matter declares paths, not content" in the grammar), so a brief
author knows to move content checks to a `waves.run` spec or a harvest-side entry. Non-blocking —
the contract never claims content coverage; the gap is only that the exclusion is unnamed.

---

## 4. D3 — the spec-side admission pin: **SOUND** (one pin-completeness nit)

The three axes (file-shaped NEW, contained EXISTING, no-escapes EXISTING), all refused
`workflow_harvest_invalid`, are correctly specified; the containment/escape citations
(`:321`, `:324-326`, `:116-125`) verify; the typed code survives the three transports (verified:
`waves_run` is a `WEB_DIRECT_PORT_COMMANDS` direct port at `web-northbound.mjs:46,62`, so
`validateApplicationCommandArgs` is skipped and the interpreter's throw is the authority; the CLI
and MCP branches route to the same `waves.run` port at `application-cli.mjs:1328-1332` and
`mcp-northbound.mjs:1795-1796`). No new code, closed reuse — sound.

Nit: **A5 omits the web transport.** D3's prose claims the refusal reaches CLI, MCP, **and** web,
but A5 pins only CLI and MCP. An implementer could wire CLI+MCP and leave the web bus re-spelling
(or dropping) the code and A5 would still pass. **Fix:** add a `waves_run` web-envelope assertion to
A5.

---

## 5. Refusal vocabulary: **HOLE** (C1)

The vocabulary is closed and typed, and the interpreter's reuse of the landed `workflow_harvest_invalid`
is right. The HOLE is the exit-code map misstatement (C1): the claim that harvest-verdict failures
use exit 1 (`:96,192-198`) is factually wrong — `:96` is start-refused (a launch refusal), and the
`-DRAINED`/`-FAILED`/`-INCOMPLETE` verdicts set no exit code (the process exits 0). The new
launch-time refusals (exit 2) remain distinct from the receipt-carried harvest failures, so the
design survives, but the description of current behavior and the "two classes are distinct" rationale
are wrong. Fix the prose and the anchor; the foundry-qa "three vs four" count (C2) should be fixed in
the same pass.

---

## 6. Acceptance pins — verdicts

| Pin | RED at HEAD | GREEN verdict | Note |
|---|---|---|---|
| A1 | ✓ honest | ✓ | No `stat`/`cat-file`/`isDirectory` in the driver (verified). GREEN reachable: the check window (`:44-47` → `:82`) is real. |
| A2 | ✓ honest | ✓ | The driver never reads the brief (`:60` embeds, reads nothing — G6 verified). |
| A3 | ✓ honest | ✘ **shallow** | GREEN is satisfiable with escape-bearing prose only (D2-H1). The pin does not pin the prose-as-path case. |
| A4 | ✓ honest | ✓ | `admitHarvestEntry` (`:300-316`) checks containment only; `docs/reports` is a real committed fixture directory (`test:362`); `repoRoot` is non-null in the fixture (verified via `index.mjs:1480` → `coordinator.mjs:944` → `bindBaton` → `runWorkflow` fallback). GREEN is reachable AND the assertion (thrown `workflow_harvest_invalid`, not receipt `harvest_miss`) distinguishes admission-time from harvest-time — correctly anchored. |
| A5 | ✓ honest | ✘ **incomplete** | The refusal cannot survive a transport that has no admission check (A4 RED). GREEN omits web (D3 nit). |

Pin discipline is otherwise correct: the contract declines to pin already-green "absent path passes"
behaviors.

---

## 7. Open questions — verdicts

- **OQ1** (gitignored-directory corner): SOUND as a named refinement; the simple law is pinned by A4 regardless.
- **OQ2** (post-harvest tree-content equality): SOUND as a named follow-on — but it does **not** cover
  D1-H1 (the driver's missing blob check for wave-created directories). OQ2 should be broadened or
  paired with a driver file-shape line.
- **OQ3** (briefs without `## Deliverables`): SOUND in substance — but should fold in D2-H3's
  near-miss-heading silent vacuity (`### Deliverables`, `## Deliverable Files`), which is a sharper
  version of the same limit.
- **OQ4** (shared publish unlanded): SOUND; verified verbatim at HEAD.
- **OQ5** (driver target containment): SOUND as an explicit out-of-scope; consistent with the launch
  operator being the trust boundary.

---

## 8. Final verdict: **NOT FOLD-READY** — numbered blockers

1. **Wrong citation in the refusal vocabulary (C1).** *What:* the contract claims "the harvest-verdict
   failures use exit code 1 (`:96,192-198`)" — `:96` is the start-refused launch branch (the only
   `process.exitCode = 1` in the file), and `:192-198` set receipt verdicts with no exit code
   (`-FAILED`/`-DRAINED`/`-INCOMPLETE` exit 0). *Why:* the frame's citation law makes a wrong anchor an
   automatic blocker, and the "two classes are distinct" rationale misdescribes the wire behavior an
   operator actually sees. *Fix:* restate the exit-code map (2 = launch/argument refusal, 1 =
   start-refused, receipt-carried harvest verdicts exit 0) and fix the anchor.

2. **The D2 "bare path" grammar is not closed — prose parses as a path (D2-H1).** *What:* the
   shape-valid predicate (non-empty, no NUL/leading-`/`/backslash/`..`) accepts any whitespace-bearing
   sentence as a deliverable, so prose, table rows, and fence markers are misparsed as deliverables
   and refuse `deliverables_uncovered` (or pass) rather than `deliverables_malformed`. *Why:* the
   contract's central promise — a strict, closed, no-prose grammar — is false as specified, and A3 is
   shallow-greenable. *Fix:* add a positive path shape (no whitespace, `/` or dot-bearing basename),
   refuse everything else `deliverables_malformed`, and pin A3 with a whitespace-bearing prose line.

3. **The driver surface has no harvest-time blob backstop for wave-created directories (D1-H1).**
   *What:* the contract's "backstop for paths the wave creates" and "holds the whole lifecycle"
   claims cite `workflow-interpreter.mjs:632`, which is the interpreter's `harvestOne` — the generic
   driver's harvest loop (`run-task-wave.mjs:166-185`) does not use it. A target absent at launch that
   the wave creates as a directory still EISDIR-poisons (≥200 B listing) or sub-200-B-rejects the
   whole driver pin. *Why:* the App-D incident class D1a is meant to close has an unbackstopped
   variant on the driver surface that the contract neither closes nor names. *Fix:* add the blob
   check to the driver's harvest loop, or explicitly scope the driver's created-directory case out as
   a named follow-on (distinct from OQ2).

4. **The `waves.run` surface has no deliverable-coverage check (D2-H4).** *What:* D2 lives only on the
   driver; the interpreter's admission validates harvest-path shape/containment but never
   coverage-checks the objectiveRef brief's declared deliverables against `harvest.paths`. *Why:* a
   brief-named deliverable absent from `harvest.paths` is still edited by the worker and silently
   dropped — the exact incident class the issue names, reachable via `baton waves run`. *Fix:* extend
   the coverage predicate to the interpreter admission seam (parse the brief at `admitSpec`; `repoRoot`
   is already supplied at `:154`) or explicitly name the spec surface as out of scope.

Non-blocking (fix or explicitly scope out): D2-H2 (path normalization in the coverage predicate),
D2-H3 (fence-state awareness + near-miss-heading/subsection vacuity — fold into OQ3), D2-H5
(targets ⊆ scope — a launch-time set/membership predicate the driver already has both inputs for),
D2-H6 (`{path, mustContain}` inexpressibility in the front-matter grammar — name the exclusion or add
a third form), A5 web omission, D1-H2 (`repoRoot` precondition one-liner), C2 (three-vs-four token
count), C3 (`:138` field-read nit), and a note that D2's `brief_unreadable` widens every `--brief`
launch to require a readable brief even when no `## Deliverables` section exists (a behavior change
worth stating).
