# Git-Archaeology Finds — dropped features in the baton history

*Compiled 2026-08-06 by the `git-archaeology` lane of the dropped-features deep-dive wave.*
Method: `git log --diff-filter=D --name-only` across all refs (only **8** files have ever been
deleted — 5 are evidence/driver artifacts, 1 is a temp file, 1 is a superseded demo scaffold,
1 is a real deleted test suite); `git log -S`/`-G` over the operation/phase/state/progress-class
vocabulary; commit-message archaeology for "retired / removed / cut / deleted / dropped".
Every find is cross-checked against the current tree (`grep impl/src` for its distinctive
vocabulary). "Superseded-by-better" and "abandoned" are kept distinct; dropped-because-failed
finds are flagged WARNING.

Reading rule: the capability atlas (`docs/reference/capability-atlas-2026-08-03/`) already owns
the spec-history status table (LANDED/PARTIAL/UNLANDED/SUPERSEDED). This report is the *git
history* half: things that **landed and were then removed**, not merely specs that never shipped.

---

## 1. Finds table (ranked by value-per-cost)

| # | Find | Type | When removed | Replaced by | Value today | Cost to restore |
|---|---|---|---|---|---|---|
| F1 | `grammar-m4a-red.test.mjs` deleted — registry-v2 invariant coverage lost (digest-projection separation, closed field set) | landed-then-removed (superseded-by-better, lossy) | 2026-07-24 (`d65f59e`) | M4b transport flip, but M4A contracts NOT folded in | **High-ish** — protects the authority-digest machinery #88 claim-preflight now depends on | **Small** (re-add ~200-line test, adjust for registry drift) |
| F2 | `rate_limited` progress class + `rate_limit_event` handling cut (P1-C v2) | designed → shipped in contract v1 → cut in v2 | 2026-07-31 (`cfb6062`) | nothing — a rate-limited run now reads `silent` | **Medium** — distinguishes throttled from dead; the wave driver can kill a merely-throttled worker | **Small–medium** (stop dropping the wire event, re-add enum + precedence row) |
| F3 | `run.debug` board leg dropped (issue #53, R53R-2) | designed-then-cancelled (premise later satisfied) | 2026-07-30 (`c9e2b1d`) | none; premise "no board up-channel" reversed by #78 four days later | **Medium** — run.debug could show worker-attributed board receipts with zero new channel | **Small–medium** (extend the run.debug accessor over #78's BOARD_CLAIM/BOARD_REPORT records) |
| F4 | `run.steer` surface deleted (grammar M5 alias sunset) | landed-then-removed (superseded-by-better) | 2026-07-31 (`bb85e35`) | `run.send` (`--to`/`--nudge`/`--now`/`--turn`) | none — semantics fully covered | n/a (restoring = reopening a banned-synonym lint row) |
| F5 | `closed` run phase deleted (grammar M2) | landed-then-removed (cleanup) | 2026-07-23 (`3362991`) | none — was a dead input-only string, never emitted | none | n/a |
| F6 | Ten legacy run-phase strings surface-retired (grammar M2) | superseded-by-better | 2026-07-23 (`3362991`) | canonical enum + `LEGACY_RUN_PHASE_MAP` (still accepted) | none (back-compat retained) | n/a |
| F7 | `no_progress` progress class → `silent` (P1-C v2) | rename | 2026-07-31 (`cfb6062`) | `silent` + 120s threshold | none (rename was correct) | n/a |
| F8 | Bespoke wave drivers retired (`run-{atlas,diag,impl}-wave.mjs`) | superseded-by-better (consolidation) | 2026-07-31 (`7cae145`, `3733096`, `4d69d63`) | `baton.recipes` (spec-as-data) | none — the replacement is the generalized form | n/a |
| F9 | TG6 "coaching" retired (trust-gate steering contract) | **WARNING** — dropped because actively harmful | 2026-08-02 (`24ec44b`) | nothing (surviving red-first line in `recipes.mjs:529`) | do **not** restore — it farms the digest-keyed steering machinery | n/a |
| F10 | `serve.mjs` (phase92 dogfood "resident") + two evidence artifacts | superseded demo scaffold / artifacts | 2026-07-19 (`28ffa8df`), 2026-07-12 (`37485441`), 2026-07-20 (`6c105491`) | `application-host.mjs` / n/a | none | n/a |
| F11 | `impl/src/coordinator.mjs.tmp` | churn | 2026-07-10 (`51380f31`) | n/a | none | n/a |

**Headline number:** across 830 commits and every ref, the git history contains exactly **one**
deleted test suite, **zero** deleted production modules, and **zero** deleted provider harnesses.
Baton's dropped-feature surface lives almost entirely in *vocabulary* (surfaces, phases,
progress classes) and in *contract folds that cut scope* — not in deleted code. That makes the
git-archaeology lane's job mostly: "which designed vocabulary was cut, and did the cut outlive
its rationale?"

---

## 2. Per-find details

### F1 — `grammar-m4a-red.test.mjs` deleted: registry-v2 invariant coverage silently lost

**WHAT.** `impl/test/grammar-m4a-red.test.mjs` (217 lines; contracts **M4A-1..M4A-7**) was the
acceptance gate for grammar slice M4a — *"registry v2 data + CLI/embedded renderers + C9"*
(issue #43): every §6 canonical operation has a complete registry-v2 entry with a **closed field
set** (M4A-1); `deriveSurfaceNames` is the **single shared derivation** (M4A-2);
**`authorityDigest` is stable under alias/help/example edits while `presentationDigest` moves**
(M4A-3); the CLI renders from registry-v2 entries and legacy spellings stay byte-identical
(M4A-4); the embedded facade exposes exactly the registry-enabled methods (M4A-5); web names are
disjoint from kernel/authoring literals (M4A-6); the cli/embedded/application.commands name rows
retire while mcp/web rows stay (M4A-7). Landed **2026-07-23** (`7328dc5`, worker
claude-opus-4-8 via baton.waves).

**WHY DROPPED.** Deleted **2026-07-24** (`d65f59e`) — the same day the M4b slice ("the transport
flip") landed (`2bcd72a`). The M4b suite (`grammar-m4b-red.test.mjs`, contracts **M4B-1..7**)
covers the Web/MCP transport flip, the C8 serialization pin, generated doc blocks, and the final
ledger burn — but **none** of the M4A contracts were re-asserted there. The deletion commit
itself is a *docs* commit (a demo AX report draft was "salvaged"); the test file was removed
without its coverage migrating anywhere. Best evidence this was an oversight, not intent: the
machinery the M4a suite guarded (`APPLICATION_DIGEST_PROJECTIONS`, `hashRegistryProjection`,
`embeddedCanonicalFacade`) is still shipped and still load-bearing.

**CROSS-CHECK (which M4a coverage is genuinely gone).** `grep -rn hashRegistryProjection impl/test/`
→ **zero hits**. `ENTRY_FIELDS`-style closed-field-set assertion → **zero hits**. The other M4a
contracts are covered elsewhere: CLI legacy-spelling golden pairs in `grammar-m1-red.test.mjs`
and `phase64-application-cli.test.mjs`; `checkLedgerMonotone`/`checkWebNameDisjoint` in
`grammar-m3-red.test.mjs`, `grammar-m4b-red.test.mjs`, `control-surface-truth-red.test.mjs`.
So the loss is exactly two invariants: **the closed field set of registry-v2 entries**, and
**the authority/presentation digest separation**.

**WHAT IT WOULD STILL GIVE US.** The digest separation is not cosmetic: `APPLICATION_DIGEST_PROJECTIONS.authority` is consumed by the #88 claim-preflight machinery
(`claim-preflight-red.test.mjs:984` reads `authority.actions.claim_turn`), whose whole point is
that an *authority* digest that ignores aliases/help/examples cannot be moved by presentation
edits. The property "a presentation edit cannot move `authorityDigest`" is currently asserted by
**no** test. The closed-field-set property is what stops a registry-v2 entry from silently
gaining/losing a field when a worker edits `CANONICAL_OPERATION_SPECS`.

**SIZE.** **Small.** Restore the deleted file (`git show d65f59e^:impl/test/grammar-m4a-red.test.mjs`),
then fix what drifted since: `REGISTRY.surfaceAliases.length === 154` is stale (M5 sunset the
`run.send`↔`run.steer` aliases), and the "mcp/web rows remain" assertion (M4A-7) is stale post-M5
(the ledger is now empty). The digest/field-set/dedup assertions should pass as-is. Composes:
`application-semantics.mjs`, `application-cli.mjs`, `application-client.mjs`,
`scripts/surface-conformance.mjs` — all present today.

---

### F2 — `rate_limited` progress class cut (P1-C v2); `rate_limit_event` still dropped on the wire

**WHAT.** The P1-C semantic-progress contract v1 (`ab12fbf`, **2026-07-31**) designed
`progressClass` with precedence
`terminal:cause > blocked_interaction > rate_limited > no_progress > progressing`, and was
explicitly honest about sourcing: *"rate_limited (the run's latest provider result classified
provider_rate_limited / authentication_refresh_required-adjacent limit receipts — the
classification rides the EXISTING provider-result taxonomy; if no such taxonomy row exists for a
limit-shaped message, the class stays honest and never guesses from prose)."* The same day, the
deepseek red-team ruled the contract UNSOUND (`cfb6062`, P1-C v2) and the class was **CUT**:
*"rate_limited CUT (no such taxonomy row; `rate_limit_event` dropped at claude-session.mjs:980)"*,
and `no_progress` was renamed `silent` + thresholded.

**WHY DROPPED.** The red-team's P0 was that *no provider-result taxonomy row existed* to classify
a limit receipt honestly. Verified: at that time (and still today) the Claude stream-json
`rate_limit_event` is received and then deliberately ignored — `claude-session.mjs:1176`:
`default: return; // user (tool results), rate_limit_event, deltas — not surfaced`. The v2 fix
cut the class instead of wiring the event.

**CROSS-CHECK (is any of it landed under another name?).** `rate_limited` survives only as an
**HTTP transport error code** in `web-northbound.mjs`/`web-stream.mjs` (429 + `retry-after`),
which is a different axis. There is **no** progress class: `PROGRESS_CLASS_LEAVES =
['silent', 'progressing']` (`application-semantics.mjs:50`), `PROGRESS_SILENCE_THRESHOLD_MS =
120_000` (`:54`); the `rate_limited`-cut rationale is annotated at `:40`. The wave driver's deployment-wide stall clock is 20 min
(`wave-driver.mjs` `stallTimeoutMs`).

**WHAT IT WOULD STILL GIVE US.** A genuinely rate-limited Claude/Codex run today reads as
`silent` after 120s — **identical to a dead worker**. The wave driver's stall fan-out (20 min) or
an operator reading `run view` would kill/restart a merely-throttled worker. The one throttling
cause the providers emit first-class on the wire is exactly this event, and it is still being
dropped. Restoring it is the cheapest honest liveness classification available. The v2
rationale ("no taxonomy row") is arguably stale in two ways: (a) the raw event is the taxonomy
row — it was always present and still is; (b) the codebase has since built real quota/ceiling
machinery (`rate_limited` 429s, wave ceilings), so a limit class has living neighbors.

**SIZE.** **Small–medium.** (1) `claude-session.mjs` — stop swallowing `rate_limit_event`; emit
it as a typed provider-result receipt (e.g., `provider_rate_limited`); (2) `application-semantics.mjs`
— re-add `rate_limited` to the progress-class precedence *above* `silent`, with a basis field;
(3) one P1-C suite row. Composes: `claude-session.mjs` + `application-semantics.mjs` + the P1-C
consumers. No store or wire changes.

---

### F3 — `run.debug` "board leg" dropped (issue #53, R53R-2); premise later satisfied by #78

**WHAT.** Issue #53 spec'd `run.debug` (`docs/reference/evidence/issue53-run-debug-2026-07-24/`)
to include a worker-attributed **board receipt stream** in its shape — `writeReceipts` was
originally to include a BOARD leg. The R53R red-team fold (`c9e2b1d`, **2026-07-30**) **dropped
the board leg**: *"the BOARD leg is dropped: workers have no board-write up-channel, so no
worker-attributed board receipt stream exists, coordinator.mjs:9704-9731."*

**WHY DROPPED.** The mechanism it depended on did not exist: at that time, workers had no
board-write channel and the store kept no per-worker board receipts.

**CROSS-CHECK (premise since reversed).** Four days later, **2026-08-03**, #78
(`9ec8e97`) landed the board **worker-half**: grant mint/revoke with generation records, the
`{read,claim,report}` permission law, and the **`BOARD_CLAIM`/`BOARD_REPORT` wire scanner
siblings** ("namespace-safe, closed shape, identity stream-bound, shape-only per #89 law") plus
`worker.generation_*` durable records. A worker-attributed board claim/report record now exists
in the store. The dropped leg's premise — "no worker-attributed board receipt stream exists" —
is no longer true.

**WHAT IT WOULD STILL GIVE US.** `run.debug` is the operator's "why is my run weird" accessor. It
currently shows member phase + last messages + scratchpad/decision receipts. Adding the board
receipt rows (which worker claimed/reported what, with generation) would complete the picture
without inventing any channel — the records already exist. This is a scope-restoration, not a
new feature.

**SIZE.** **Small–medium.** Extend the run.debug accessor to read the #78 board receipt records
scoped by the run snapshot; add a debug-surface row + a red-first assertion. Caveat: verify the
#78 record shape is *per-worker attributed* and reachable from the run's snapshot (the scanner
identity is stream-bound; the grant records are keyed by worker.generation).

---

### F4 — `run.steer` deleted (grammar M5 alias sunset)

**WHAT.** `baton run steer RUN_ID TARGET (--nudge | --now | --turn) TEXT --reason REASON` — a
worker-ID-targeted steering CLI verb, registered as an alias of `run.send` in
`application.commands` and the CLI (`SURFACE_ALIAS_ROWS: ['run.send','application.commands',
'run.steer']` and `['run.send','cli','baton run steer']`). Deleted **2026-07-31** at the M5
alias sunset (`bb85e35`): removed from `cliCommands`, the `run` command-ids set, the alias rows,
and the MCP/web registries. Today `parseBatonCli` throws `cli_command_unavailable` with the
corrective naming (`application-cli.mjs:1710-1713`).

**WHY DROPPED.** Deliberate — the unified-control-grammar epic (M0–M5) retired legacy synonyms;
`run.steer` was a pure alias of `run.send`, which already carries `[--to RECIPIENT]` and
`[--nudge | --now | --turn]` modes (`application-cli.mjs:1665-1673`). The M5 commit message:
*"run.steer DELETED as a surface alias ... baton run steer refuses with the corrective naming
run send."*

**CROSS-CHECK.** `grep -rn "run.steer" impl/src/` → only the refusal and the GLOSSARY post-sunset
note. The semantics live in `run.send`.

**WHAT IT WOULD STILL GIVE US.** Nothing — worker-targeted steering with a mode is reachable via
`run send --to RECIPIENT`. Restoring would reopen a banned-synonym lint row that the conformance
harness enforces. Correctly dropped.

---

### F5 — `closed` run phase deleted (grammar M2)

**WHAT.** `closed` was accepted as a run phase at four sites (registry, CLI parse, application,
story) with **no live emitter** — a "dead string" that only external callers could send. Deleted
at the M2 vocabulary flip (`3362991`, **2026-07-23**); the current
`LEGACY_RUN_PHASE_MAP` (`application-semantics.mjs:71-88`) records `closed: null` with the note
*"a dead string with no live emitter."*

**WHY DROPPED.** Removal-only cleanup step of the grammar epic; nothing emitted it, so nothing
depended on it.

**CROSS-CHECK.** `grep -rn "'closed'"` in the phase-enum consumers shows no emitter; a stored run
whose phase is the literal `closed` canonicalizes to `null` at read time with no consumer
regression.

**WHAT IT WOULD STILL GIVE US.** Nothing. Correctly removed.

---

### F6 — Ten legacy run-phase strings surface-retired (grammar M2)

`approved→queued`, `awaiting_plan_approval→awaiting_approval`, `candidate_selected→result_selected`,
`input_required→working`, `interruption_uncertain→uncertain`, `planning_failed→failed`,
`running→working`, `selection_required→awaiting_selection`, `start_failed→failed`,
`work_completed→result_ready` were removed from surface *emission* at the M2 flip
(`3362991`). They are **not** actually dropped: the legacy strings are still accepted everywhere
through the single sanctioned `LEGACY_RUN_PHASE_MAP` site, and the M5 banned-token lint keeps
them grep-clean outside that site. This is the correct shape of a vocabulary migration — remove
from surfaces, keep the back-compat mapping. **What it would give us: nothing.** Correctly
superseded.

---

### F7 — `no_progress` progress class renamed `silent` (P1-C v2)

The v1 class `no_progress` was renamed `silent` and thresholded (120 s) at `cfb6062`
(**2026-07-31**). The rename is loaded in the current code
(`PROGRESS_CLASS_LEAVES = ['silent','progressing']`, `PROGRESS_SILENCE_THRESHOLD_MS = 120_000`)
and is the right call (the v1 name implied a *judgment*; `silent` is a *measurement*). No
resurrection value.

---

### F8 — Bespoke wave drivers retired → `baton.recipes` (spec-as-data)

The three deleted files under `docs/reference/evidence/`:
- `atlas-2026-07-31/run-atlas-impl-wave.mjs` (deleted `7cae145`: "bespoke driver retired")
- `diagnostics-2026-07-31/run-diag-impl-wave.mjs` (deleted `3733096`)
- `control-surface-2026-07-31/run-impl-wave.mjs` (deleted `4d69d63`: "stale bespoke S-1 driver
  removed (recipes replaced it)")

were the ~100-line bespoke `run-*-impl-wave.mjs` drivers. They were retired in favor of
`baton.recipes` (the RC-A composition-v2 library, `e1378ff`, plus the #114 workflow-as-data
contract) — *"the bespoke run-*-wave.mjs drivers are now retireable: baton.recipes.run(
implementContractRecipe({task, route, scope}))"*. **Not a dropped feature** — the deleted files
are the retirement evidence for a consolidation. The generalized recipe interpreter is strictly
better (spec-as-data, one interpreter lane, CLI + MCP entry points).

---

### F9 — TG6 "coaching" retired (WARNING — do not restore)

**WHAT.** The trust-gate steering contract v0.9 (`docs/reference/evidence/trust-gate-steering-2026-08-02/`)
included a "coaching" idea — nudging workers with the "skeleton-first" pattern (force an early
diff so the every-turn gate sees progress). The authority red-team ruled it **"Actively
harmful"**: the coaching trains digest churn, and the steering machinery is **digest-keyed** —
the red-team cited `wave-driver.mjs:613-614` (nudge budget resets to 1 on any changed digest;
today at `wave-driver.mjs:682` `state.nudges = 1`) and `:505` (the stall marker resets on any
member digest change; today the marker is derived at `wave-driver.mjs:168`/`:536`). A worker coached to "skeleton turn 1, flesh out turn 2"
produces exactly the churn that perpetually re-arms the steering cycle and nudge budget — the
coaching would have become a micro-progress-farming manual. It was **retired at acceptance**
(`24ec44b`, **2026-08-02**).

**CROSS-CHECK.** `IMPLEMENT_CONSTRAINTS` (`recipes.mjs:528-537`) still ships the respectable
cousins — red-first, minimal-diff, no-commit, wire-frame oversize, and the verbatim
SCRATCHPAD_WRITE shape coaching — but **not** the skeleton-first churn coaching.

**WHAT IT WOULD STILL GIVE US.** Nothing — restoring it would reintroduce a documented
anti-pattern that actively farms the new steering bounds. **This is a dropped-because-failed
find: record it as a warning, not a recommendation.**

---

### F10 — `serve.mjs` (phase92 dogfood "resident") + evidence artifacts

- `docs/reference/evidence/phase92-episode-workstream-dogfood-2026-07-19/serve.mjs` — a demo
  "resident" that opened a baton deployment and hosted it until SIGTERM
  (`openBaton` + `SignalLifecycleOwner` + `deployment.host()`). Deleted in the baton snapshot
  `28ffa8df` (**2026-07-19**); the hosted-deployment pattern it demonstrated now lives in
  `impl/src/application-host.mjs`. Superseded demo scaffold, not a feature.
- `docs/reference/evidence/phase41-transitive-advisory-live-2026-07-12/artifacts/oracle/*.session.json`
  — a live-evidence artifact (deleted `37485441`). Not a feature.
- `docs/reference/evidence/phase93a2-control-grammar-review-live-2026-07-20/impl-review.md` — a
  review artifact (deleted `6c105491`). Not a feature.

---

### F11 — `impl/src/coordinator.mjs.tmp` (churn)

A temp file deleted at `51380f31` (**2026-07-10**) during a live re-eval build ("fix 3
live-breaking adapter defects"). No feature content.

---

## 3. Top-3 recommendations

**1. Restore the `grammar-m4a` registry-v2 invariant tests (F1).** Smallest cost, real gap:
`hashRegistryProjection`'s authority/presentation separation and the registry-v2 closed field
set are currently asserted by **zero** tests, while the authority projection is consumed by the
#88 claim-preflight machinery. `git show d65f59e^:impl/test/grammar-m4a-red.test.mjs` + a
small drift fix (the `surfaceAliases.length === 154` and "mcp/web rows remain" assertions are
stale post-M5) restores a load-bearing regression net. Compose the current
`application-semantics.mjs`/`application-cli.mjs`/`application-client.mjs` +
`scripts/surface-conformance.mjs`.

**2. Reintroduce `rate_limited` as a progress class, sourced from the Claude wire's
`rate_limit_event` (F2).** A throttled worker currently reads `silent` — identical to a dead
worker — and the 20-min driver stall clock can kill it. The one throttling cause the providers
emit first-class is still being dropped at `claude-session.mjs:1176`. Stop dropping it, classify
it into the provider-result taxonomy, re-add the class above `silent`. Small–medium, no store or
wire changes, and it removes a genuine false-death mode.

**3. Re-open the `run.debug` board leg (F3).** The R53R-2 drop was premised on "no worker
board-write up-channel"; #78 (2026-08-03) landed exactly that (BOARD_CLAIM/BOARD_REPORT wire
scanners + `worker.generation_*` records). Extend `run.debug` to include worker-attributed
board receipts from those records — completes the operator's "why is my run weird" view with
zero new channel. Verify the #78 record shape is per-worker and run-snapshot-scoped first.

---

## 4. Removed-vocabulary catalog (`git log -S` evidence)

| Vocabulary | Kind | First seen / added | Removed | Commit | Replaced by | Current status |
|---|---|---|---|---|---|---|
| `run.steer` | surface alias | pre-M5 | 2026-07-31 | `bb85e35` (M5) | `run.send` (`--to`/`--nudge`/`--now`/`--turn`) | refuses with `cli_command_unavailable` |
| `closed` | run phase | early MVP | 2026-07-23 | `3362991` (M2) | none (never emitted) | `LEGACY_RUN_PHASE_MAP` → `null` |
| `approved`, `awaiting_plan_approval`, `candidate_selected`, `input_required`, `interruption_uncertain`, `planning_failed`, `running`, `selection_required`, `start_failed`, `work_completed` | run phase | early MVP | 2026-07-23 | `3362991` (M2) | canonical enum | accepted via `LEGACY_RUN_PHASE_MAP`, banned-token linted |
| `rate_limited` | progress class | 2026-07-31 (`ab12fbf`, v1) | 2026-07-31 | `cfb6062` (v2) | none | only as an HTTP 429 code |
| `rate_limit_event` | wire event | Claude stream-json | — | never surfaced | — | still dropped at `claude-session.mjs:1176` |
| `no_progress` | progress class | 2026-07-31 (v1) | 2026-07-31 | `cfb6062` (v2) | `silent` (+120s threshold) | live |
| BOARD leg of `run.debug` writeReceipts | designed sub-feature | issue #53 v1 | 2026-07-30 | `c9e2b1d` (R53R-2) | none (premise reversed by #78) | absent from `run.debug`; #78 records exist |
| "skeleton-first" coaching | steering nudge pattern | trust-gate v0.9 | 2026-08-02 | `24ec44b` (TG6) | red-first line only | deliberately not restored |

Cross-check method note: existence was cheap-grepped against `impl/src/` for each row's
distinctive token; rows marked "live" resolved to current source lines.

---

## 5. Skeptic's ledger (what this lane did NOT find)

- **No provider harness was ever removed.** Every session/adapter module present at the
  `pre-dogfood-baseline` tag (2026-07-10) — `adapter.mjs`, `claude-session.mjs`,
  `cli-adapters.mjs`, `codex-appserver.mjs`, `grok-acp.mjs`, `coordinator.mjs`, `fence.mjs`,
  `referee.mjs`, `router.mjs`, `story.mjs`, `worktree.mjs` — is still in `impl/src/` today.
  `git log --diff-filter=D -- 'impl/src/*'` returns exactly one path: `coordinator.mjs.tmp`.
- **No event kind was removed from the store.** The `kind:` inventory in
  `coordination-store.mjs` is additive-only across history; `git log -S` for the scanner
  siblings (`CONTEXT_READ`, `BOARD_CLAIM`, `BOARD_REPORT`, `MESSAGE_SEND`, `SCRATCHPAD_WRITE`)
  shows only additions and re-stages, never a removal with no replacement.
- **The `glm` seat was not dropped.** `glm-session.test.mjs` survives (and passes —
  `GlmSessionCli` exists in `claude-session.mjs`); the Z.ai route (`glm-via-claude`) is the
  canonical driver. The SC6 session tier was designed and built, not abandoned.
- **`run.act`'s 27 action targets are all present** (the M0 audit's D2 count still holds).
- **The `web`/`mcp`/`board`/`package`/`repl`/`knowledge` S-3 surfaces are all live** — they
  dispatch from the registry / MCP reflex table, not just registry rows.
