# Fold summary — harvest-accessor contract v1.0 → v1.1 (2026-08-06)

**Source:** `contract-redteam.md` (same directory) — verdict **NOT FOLD-READY, 8 blockers**.
**Target:** `harvest-accessor-contract.md` (same directory) — now v1.1.
**Method:** every flagged citation re-verified THIS session against this worktree before
amendment. NUL-bearing files (`application.mjs`, `coordination-store.mjs` — 3 NULs each by byte
count) were inspected with NUL-safe `grep -an` + `sed -n` only; `coordinator.mjs` (0 NULs — see
blocker 1) was held to the same discipline. Citations the report verified CORRECT were left
byte-identical.

**Disposition: 8/8 blockers folded. No blocker rejected.** Rejected/deferred ALTERNATIVES are
registered at the end.

---

## Blocker → change map

### Blocker 1 — citation law violated (systematic sub-line shifts + false NUL claim)

**Finding:** sub-line pins shifted (`index.mjs:842/845/846`, `:781/:783`;
`coordinator.mjs:6093-6097` inside a range that ended mid-function; `worktree.mjs:1235/:1236`),
and the preamble falsely listed `coordinator.mjs` as NUL-bearing.

**Fold (13 corrections):**

| v1.0 citation | v1.1 citation | Verified content (this session) |
| --- | --- | --- |
| `index.mjs:842` (ownership regex) | `index.mjs:843` | `if (typeof ref !== 'string' \|\| !/^refs\/baton\/results/[a-f0-9]{40,64}$/u.test(ref)) {` at :843 (`grep -n 'result ref is outside Baton ownership'` → throw at :844) |
| `index.mjs:845` (resolves `${ref}^{commit}`) | `index.mjs:846` | `try { return localGit(['rev-parse', '--verify', …]).trim(); }` at :846 |
| `index.mjs:846` (returns null) | `index.mjs:847` | `catch { return null; }` at :847 |
| `index.mjs:842-847` (resolveResult range) | `index.mjs:842-848` | function spans :842-:848 (closing `},` at :848) — fold-time find, beyond the report's table |
| `coordinator.mjs:6085-6098` (inspectPreservedResult) | `coordinator.mjs:6085-6102` | function spans :6085-:6102 (closing `}` at :6102) |
| `coordinator.mjs:6093-6097` (states) | `:6090` / `:6093` / `:6099` | `unavailable` at :6090, `unverifiable` at :6093, `pinned/missing/mismatch` ternary at :6099 |
| `index.mjs:781` (`git diff --name-only -z`) | `index.mjs:777` | the `localGit(['diff', '--name-only', '-z', …])` line |
| `index.mjs:783` (dedup + sort + ceiling) | `:779-780` + `:782` | ceiling/dedup `captured_change_oversize` refusal :779-780; `[...paths].sort()` at :782 |
| `worktree.mjs:1235` (commit on top of base) | `worktree.mjs:1225` | `sh('git', ['commit', '-q', '-m', message, …], dir);` |
| `worktree.mjs:1236` (`changedPathsFromBase(dir, meta.baseSha)`) | `worktree.mjs:1233` | also `:1203`, `:1215` |
| `coordinator.mjs:6053-6098` (non-goals lane range) | `coordinator.mjs:6053-6102` | same mid-function defect as #5 — fold-time find |
| Decision 1 resolution path `coordinator.mjs:6085-6098` | `coordinator.mjs:6085-6102` | second site of #5 |
| Preamble: "`application.mjs`, `coordinator.mjs`, and `coordination-store.mjs` contain NUL bytes" | `application.mjs` (3) and `coordination-store.mjs` (3) do; `coordinator.mjs` contains NONE | `tr -cd '\000' < f \| wc -c` → coordinator 0, application 3, coordination-store 3 (the report's `grep -cP` guidance is GNU-only; BSD grep has no `-P`, so byte count was used) |

Sections touched: preamble, ground truths 1/2/3, Decision 1, non-goals.

### Blocker 2 — delta-law base authority INVERTED

**Finding:** `git rev-parse ${resultSha}^` equals the recorded base only for snapshot captures.
`captureCommit` commits only when the worktree is dirty (`worktree.mjs:1206-1232`); a clean-tree
worker-self-committed capture (admissible — `validateOwnedWorktree` requires only that
`meta.baseSha` be an ANCESTOR of the worktree HEAD, `:1006-1007`) pins the worker's own HEAD,
whose parent is the worker's prior commit; a mid-task merge pins the merge commit. v1.0 made
`pin^` authoritative, the recorded base a "cross-check", and never pinned cross-check failure.

**Fold (ground truth 2, Decision 1 `baseSha` bullet, Decision 3 — all rewritten):**
- The base authority is the RECORDED base `task.sessionContext.baseSha`, set from the
  worktree-creation result (`coordinator.mjs:3589-3604`, `baseSha` at `:3592`), durable across
  event replay (`coordinator.mjs:13970-13977` — `task.sessionContext = sessionContext` at
  `:13973`), and the coordinate the kernel itself diffs against
  (`changedPathsFromBase(dir, meta.baseSha)`, `worktree.mjs:1233`; `inspectCapturedChanges`
  requires it, `coordinator.mjs:4820-4828`). The capture return also carries it
  (`baseSha: meta.baseSha`, `worktree.mjs:1239`).
- `pin^` demoted to a consistency CHECK with pinned failure semantics: `git merge-base
  --is-ancestor ${baseSha} ${resultSha}` must hold (construction-guaranteed by the ancestor-only
  admission, `worktree.mjs:1006-1007`); failure refuses the new typed code
  **`pin_base_mismatch`**; an unreachable recorded base refuses `result_not_ready`. Never a
  silent proceed on `pin^`. (Equality with `pin^` is NOT the check — divergence is legitimate
  for self-committed/merge captures; ancestry is the honest invariant.)

**Verification:** `sed -n '1191,1240p' impl/src/worktree.mjs` (dirty-only commit at :1206,
commit :1225, return carries `baseSha` :1239); `sed -n '1000,1010p'` (`merge-base
--is-ancestor meta.baseSha HEAD` at :1006); `sed -n '3589,3604p' impl/src/coordinator.mjs`
(`sessionContext.baseSha` from `res.baseSha`); `sed -n '4818,4828p'` (`inspectCapturedChanges`
reads `task?.sessionContext?.baseSha` at :4820); `sed -n '13970,14000p'` (replay restore).

### Blocker 3 — `conflicted` receipt unconstructible

**Finding:** with no resolver, the engine throws `structured_tool_unavailable`
(`worktree.mjs:1287`) carrying no conflict paths and the catch removes the stage (`:1331`) — so
`conflicts` and `stagePath` are both unreachable; and the engine's `classes` rows are
`{path, class}` objects (`:1284`), matching neither v1.0 receipt shape.

**Fold (Decision 2): descoped to refuse-with-conflict-list — never a silent apply.** Picked
over the engine-amendment alternative (rejected — see register). Rationale: v1 ships no
resolver on the harvest lane (OQ3), so a conflicted merge can neither apply nor resolve — the
only honest outcomes are apply-clean / skip / refuse; one typed refusal on every surface
preserves the #87 refusal-constancy idiom and kills HA-06's disjunctive oracle and the
facade-vs-MCP receipt/error asymmetry by construction; the engine non-goal stands untouched.
- The conflict list's source is pinned: the harvest lane's OWN non-destructive three-way probe
  (additive code, not an engine change) — throwaway detached worktree at `ontoHeadSha`, the
  engine's own merge invocation replayed (`:1280`), the conflicted set read as
  `git diff --name-only --diff-filter=U -z` (`:1282-1283`) with per-path unmerged classes from
  `git status --porcelain`, then the worktree removed. This is the orchestrator's own harvest
  discipline (the ledger's three-way surgery) mechanized read-only.
- `harvest_conflict` carries `{conflicts: [{class, path}]}` (sorted byte-wise by path),
  `ontoHeadSha`, `resultSha`. `stagePath` dropped from v1.
- Receipt core re-pinned: `['baseSha', 'changedPaths', 'ok', 'reason', 'result', 'resultSha']`;
  `result ∈ {'applied-clean', 'skipped'}`; `classes: ['clean_textual']` pinned as the
  class-name projection of the engine's `{path, class}` rows (`:1284`).
- HA-06 rewritten as a single-outcome refusal oracle (constructible: divergent edit in a
  pin-touched file → `harvest_conflict` naming EXACTLY those paths; onto untouched; no stage or
  probe worktree left behind).
- Honesty bound stated (Decision 2 + Decision 3): the receipt certifies the TEXTUAL merge of
  the recorded-base delta, nothing more — v1.0's "correct by construction" overclaim corrected.

**Verification:** `sed -n '1262,1290p' impl/src/worktree.mjs` (`:1265` clean-target, `:1269`
`beforeSha = rev-parse HEAD`, `:1270` ancestor check, `:1272` merge-base, `:1280` diff3 merge,
`:1282-1283` unmerged read, `:1284` classes object, `:1286` merge-failed, `:1287`
tool-unavailable); `sed -n '1291,1352p'` (`:1295/:1296/:1301/:1308/:1312/:1317/:1324/:1328`,
stage deletion `:1331`, finalize `:1337-1352` with `:1340/:1342`).

### Blocker 4 — merge-base ≠ pin-parent divergence (wrong-but-applying tree)

**Finding:** when the pin's recorded base isn't the merge-base of onto (stacked-on-unintegrated
results — `createFromBase` takes any base, `worktree.mjs:1074`), the engine merges from the
COMPUTED merge-base (`:1272`), applying `diff(merge-base, pin)` — a superset of the receipted
delta.

**Fold (Decision 2, preconditions — ordered and pinned):** (1) `harvest_onto_dirty`;
(2) already-contained → `skipped/already_integrated` (precedes divergence: a contained pin is
skipped, never "diverged"); (3) **`git merge-base <ontoHEAD> ${resultSha}` MUST equal the
recorded `baseSha`, else refuse `harvest_base_diverged`** naming `{baseSha, mergeBaseSha,
ontoHeadSha, resultSha}` — no merge attempted, onto untouched, the orchestrator's three-way
surgery stays manual-or-flagged, never a silent different-delta apply; (4) emptiness (blocker
6). Code named `harvest_base_diverged` (the report's suggestion) rather than
`harvest_base_not_ancestor`: the check is merge-base equality, which covers non-ancestry and
divergence alike. HA-13 added (constructible fixture: task created from an unintegrated result
pin as its base).

**Verification:** `sed -n '1070,1078p' impl/src/worktree.mjs` (`createFromBase(repoRoot, taskId,
baseSha, opts)` at :1074, any base); engine merge-base at `:1272` (above).

### Blocker 5 — CLI name collision (`deriveSurfaceNames('run.result').cli` is occupied)

**Finding:** `deriveSurfaceNames` is the ONE mechanical derivation
(`application-semantics.mjs:1123-1144`), invoked unconditionally (`names:
deriveSurfaceNames(key)`, `:1938` — no override; key parts `/^[a-z][a-z0-9_]*$/`, `:1128`);
`'run.result'` derives cli `baton run result` — occupied by the episode result-chapter read
(cliCommands ledger row `:860`; surface alias `['run.view', 'cli', 'baton run result']`,
`:1807`; parser `application-cli.mjs:1510-1520`). v1.0's `baton run result-pin` resolution was
unimplementable (hyphenated parts are underivable; the generated CLI.md would have documented
the derived occupied spelling).

**Fold (Decision 5 rewritten; Decision 1 surface renamed; ground truth 10 extended):** the
canonical key is **`run.resultpin`** → cli `baton run resultpin`, mcp `baton_run_resultpin`,
web `run_resultpin`, embedded `run.resultpin()` — all four derivations free. Facade command,
MCP tool, HA rows, and refusal codes renamed accordingly (`application_run_resultpin_invalid`,
`baton_run_resultpin`). cliCommands ledger row stated:
`['run.resultpin', 'run.resultpin', null, 'baton run resultpin RUN_ID']` (the `:864` row
pattern; `subcommand` derives from the id, `:886-891`); `waves.harvest` takes no ledger row
(the `:848-885` ledger carries no `waves.*` rows). The episode spelling is untouched. Full
count list folded in: `canonicalOperations` +2, `cliWebCommands` +2, `mcpApplicationTools` +2,
**`mcpCombinedTools` +2, `mcpDispatchToolNames` +2** (`mcp-northbound.mjs:2138-2140`,
`:32-47`), `parserLifecycleActions` observed post-regeneration; the authority projection covers
`canonicalOperations` (`application-semantics.mjs:1985-1995`).

**Freedom verification (this session):** `grep -n "run\.harvest\|run\.resultpin\|run\.result\.pin\|'run\.result'"`
over `application-semantics.mjs`/`application-cli.mjs`/`mcp-northbound.mjs`/`application.mjs`/`mcp-descriptor.mjs`
→ only the episode ledger row (`:860`) and a `commandIds` entry (`:1037`); `grep -n
"baton_run_resultpin\|baton_run_harvest\|baton_run_result\b\|baton_waves_harvest"` → zero hits.
Canonical-key inventory: no `run.resultpin`/`run.harvest`/`waves.harvest` key. Parser:
`resultpin` is not in the `lifecycleActions` set (`application-cli.mjs:1509-1511`) — a new
single-token branch with zero interaction with the episode branch, which consumes the token
after `result` as RUN_ID (`:1513-1519`).

### Blocker 6 — `empty_delta` no machinery path

**Finding:** the engine detects ancestry only (`:1270`); tree-identical merges commit clean;
clean-capture pins are ancestors ⇒ `already_integrated`.

**Fold (Decision 2, precondition 4):** an explicit PRE-STAGE emptiness check the machinery can
actually produce — `changedPathsAtCommit(baseSha, resultSha)` (computed for the receipt anyway)
empty ⇒ `skipped / reason: 'empty_delta'` (`ok: true`, no merge commit created). Ordering vs
`already_integrated` pinned: ancestry first (a `sha == base` clean-capture pin that onto
contains reports `already_integrated`); `empty_delta` fires for the constructible case — a
net-zero self-committed pin (non-ancestor of onto, onto descended from the recorded base).
HA-07 rewritten with both fixtures named constructibly (double-harvest for
`already_integrated`; revert-to-net-zero self-commit for `empty_delta`).

### Blocker 7 — acceptance gaps that green shallow implementations

**Fold (acceptance table):**
- (a) multi-pin fixture → **HA-11 (new)**: two runs/two live pins, queried run's pin the OLDER
  → own-pin oracle; released-pin run coexisting with a live pin → `pin_not_found`. Kills
  newest-pin and only-extant-pin readers.
- (b) unpinned-sha harvest refusal → **HA-12 (new)**: real-but-unpinned sha ⇒ `pin_not_found`
  (sha-source: `refs/baton/results/<sha>` must resolve back to the same sha); runId-source
  re-verification pinned identically (`missing` → `pin_not_found`, `mismatch` → `pin_mismatch`).
  Pin verification on BOTH sources is now Decision 2 law.
- (c) harvest receipt base-honesty → **HA-13 (new)**: main advanced past the recorded base ⇒
  receipt `baseSha`/`changedPaths` equal the RECORDED-base diff (never HEAD-, never
  merge-base-based); plus the `harvest_base_diverged` fixture (blocker 4).
- (d) disjunctive oracle + "strict policy" lever → **eliminated**: the conflict outcome is the
  typed `harvest_conflict` refusal on every surface (blocker 3); HA-06 pins ONE oracle.
- (e) onto codes at the wire → **HA-08 (rewritten)**: the COMPLETE vocabulary (all twelve new
  codes) pinned through `stateFailureCode`, plus translation-proof rows injecting kernel codes
  at the facade (`structured_main_dirty` → `harvest_onto_dirty`; `captured_change_oversize` →
  `result_delta_oversize`; `structured_already_integrated` → `skipped` receipt;
  `structured_tool_unavailable` → `harvest_conflict` with a re-probed list) — proving
  translation, not just mapping.
- (f) harvest authorization → **HA-14 (new)**: `application_unauthorized` on the control lane
  + the FP-18 pre-gate dispatch pin.

### Blocker 8 — refusal vocabulary not complete

**Fold (Decisions 1/2/4/6):** seven new codes, all mapped to machinery states and all carried
to the wire in Decision 4's `stateFailureCode` list:
- `pin_unverifiable` / `pin_mismatch` — the two unmapped `inspectPreservedResult` states
  (`coordinator.mjs:6093`, `:6099`).
- `pin_base_mismatch` — the ancestry cross-check failure (blocker 2).
- `result_delta_oversize` — the `captured_change_oversize` path (1_025+ changed paths at the
  default `maxPaths`): names cap + `gracefulPath` (re-issue with higher `maxPaths` ≤ 100_000);
  the kernel throw carries no actual count, so cap+gracefulPath only, translation pinned.
- `harvest_base_diverged` — blocker 4.
- `harvest_onto_advanced` — the finalize race (`worktree.mjs:1340`), retry-safe.
- `harvest_apply_failed` — residual engine failures (`structured_stage_failed`,
  `structured_merge_failed` `:1286`, `structured_diff_invalid`, `structured_parent_mismatch`,
  post-effect finalize failures) carrying the engine code verbatim as `cause` + a `postEffect`
  flag; never `command_outcome_unknown`. The resolver-loop codes are pinned UNREACHABLE on the
  resolver-free lane (the `:1287` throw precedes the per-file loop; `structured_invalid_result`
  unreachable after pin verification).
- Sha-width consistency: both lanes' shape gates pin sha1 `/^[a-f0-9]{40}$/` — the delta lane
  is 40-hex-only (`index.mjs:773-775`, `worktree.mjs:333`) while the ownership regex
  (`index.mjs:843`), `RESULT_SHA` (`wave.mjs:18`), and the inventory lane
  (`result-export.mjs:445`) admit 64; a 64-hex sha now refuses at the closed-shape gate
  (`application_*_invalid`) instead of degrading to an unmapped `captured_change_invalid`.
  sha256 deployments are a stated later rung.
- Decision 1's shape sentence now reads "plus outcome-conditioned extras" (HA-03's
  `truncated`/`changedFilesDigest`/`cursor`).

---

## Rejected alternatives register

- **Engine report-mode amendment** (red-team blocker 3 option 1: amend
  `stageStructuredIntegration` with a report-only conflict mode, moving it out of non-goals) —
  REJECTED. v1 keeps the engine byte-untouched; the conflict list comes from the harvest lane's
  own probe. The descope achieves the same eval-able artifact (the exact conflict list) without
  spending the engine non-goal, and one refusal shape restores wire constancy.
- **`git merge-tree --write-tree` conflict-discovery lane** (red-team blocker 3 option 2's
  example machinery) — REJECTED as the pinned mechanism: the probe reuses the engine's own
  merge invocation (`worktree.mjs:1280`), so the list is exactly what the apply path would have
  hit, with no additional git-version surface. (An implementation MAY use `merge-tree` if it
  reproduces the same set; the contract pins the probe shape, not the binary.)
- **Canonical key `run.result.pin`** (red-team blocker 5 example) — REJECTED: derives
  `baton run result pin`, whose four-token spelling the occupied episode branch mis-parses
  (the token after `result` is consumed as RUN_ID, `application-cli.mjs:1513-1519`) — a silent
  wrong-parse hazard, not a refusal.
- **Canonical key `run.harvest`** — REJECTED: a "harvest" READ verb beside the `waves.harvest`
  APPLY verb is a semantic collision; the read lane reads the result PIN (`run.resultpin`).
- **Registry name-override mechanism** (red-team blocker 5 option 2) — REJECTED: would break
  the ONE-derivation law (`application-semantics.mjs:1120-1144`, R-OP-10/M4A-2) the registry,
  audit, and renderers share.
- **`harvest_base_not_ancestor` code name** — the check is merge-base EQUALITY against the
  recorded base (non-ancestry is one case); named `harvest_base_diverged` instead.

## Deferred (unchanged deferrals, now with their fold dependencies satisfied)

- OQ1 inline bytes (`withBytes`) — later rung.
- OQ2 arbitrary owned-worktree `onto` — later rung, needs an engine amendment; v1 pins
  default-only (RESOLVED for v1).
- OQ3 resolver-carrying harvest — deferred; the conflict-list source is now pinned, so the
  variant is additive.
- OQ4 checkpoint exposure — #53/#77; checkpoint-only ⇒ `result_not_ready` now stated.
- OQ7 ordinary recursive-gate admission — open; the pre-gate dispatch and authorization are
  pinned (HA-14).
- sha256-format deployments — later rung (Decision 6).
- Registry naming consolidation (#9 / §9 M-naming) — OQ6 settled for this contract; the episode
  spelling's own future is the registry's.

## Citation accounting

- **13 corrections** (12 line-target + 1 preamble claim), each re-verified this session —
  table under blocker 1. Two of the twelve (the `index.mjs:842-848` range end and the
  `coordinator.mjs:6053-6102` non-goal range) are fold-time finds beyond the report's table.
- **27 new citation anchors** introduced by the amendments: `worktree.mjs:1206-1232`,
  `:1006-1007`, `:1203`, `:1215`, `:1239`, `:1269`, `:1074`, `:1282-1283`, `:1286`, `:1287`,
  `:1331`, `:333`; `coordinator.mjs:3589-3604`, `:3592`, `:13970-13977`; `index.mjs:773-775`;
  `result-export.mjs:445`; `application-semantics.mjs:1123-1144`, `:1128`, `:1938`, `:1807`,
  `:864`, `:886-891`, `:848-885`, `:1985-1995`; `mcp-northbound.mjs:2138-2140`, `:32-47`.
- **40 citation actions total**; every one verified against the current tree this session
  (`grep -n`/`grep -an` + `sed -n`; NUL audit by `tr -cd '\000' | wc -c`).
- All v1.0 citations the red team marked CORRECT are carried byte-identical.
