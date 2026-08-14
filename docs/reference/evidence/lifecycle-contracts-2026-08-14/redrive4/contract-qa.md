CONTRACT-QA v1

[attempt: 8440b49b-982b-4c07-9b3c-bbd5c1bbca21 coordinator]

Coordinator QA — the lifecycle-contracts four-row foundry, redrive 4 (package ③, wave
`lifecycle-contracts-2026-08-14-wave-a-rd4`). Every claim below is cited on-disk evidence
(`sed -n` / `grep -an` / `git show` / `ls` sweeps of the sibling worktrees at `../../wt/ws-*/`)
or an explicitly named absence. No clocks, no fabrication. HEAD for this seat is `5ae2c7e5`.

## 0. Dispatch-frame judgment calls (recorded before any verdict)

1. **Scope path mismatch.** This seat's deployment constraint reads "work only within
   `docs/reference/evidence/collab-contracts-2026-08-14/redrive4/**`". That directory does not
   exist at this base; the wave that names this coordinator — same brief, same `signalOnMembersDone`
   row set, same report — is `docs/reference/evidence/lifecycle-contracts-2026-08-14/redrive4/**`
   (`lifecycle-contracts.wavefile` member `coordinator`, scope + report lines). The wavefile
   governs; the deliverable is written there. The `collab-contracts` wave is a different package
   (⑤, rows `member-lanes`/`knowledge-activation`/`context-lanes`/`federation-doubt`), and its
   own `coordinator-brief.md` is a verbatim copy of THIS lifecycle brief — a seed-contamination
   finding I record here rather than decide (see §7 escalation).
2. **The redrive-4 rows are mid-seat at signal time.** The `signalOnMembersDone` message fired
   ("All four rows settled"), but the on-disk truth at this base was partial (below). Per the #174
   law I swept siblings, not assumptions; one row (fs) has since materialized, three have not.

## 1. Signal + on-disk verification (the #174 law — silence is not death)

| Lane | Expected (wavefile) | State |
|---|---|---|
| messageOnSpawn `brief` | read objectiveRef + foundry-brief in full | RECEIVED — both read in full before any work |
| signalOnMembersDone `result` | fires when `row-lc-fs,row-lc-launch,row-lc-members,row-lc-ledger` settle | RECEIVED |

On-disk sweep (re-run immediately before each verdict below, across all 15 sibling worktrees
`../../wt/ws-*/` plus this worktree):

- `redrive4/contract-filesystem.md` — **LANDED** (sibling `ws-2a24f9dc…`, attempt
  `d2371308…`, 24,494 bytes, written against HEAD `5ae2c7e5` — the same HEAD this seat holds).
  Carried in the orchestrator's v20 pack commit `093da603` ("v20 re-drive packs — 14
  GLM-casualty waves bumped + reseated to deepseek"). Cross-checked in full below.
- `redrive4/contract-launch.md` — **ABSENT** everywhere.
- `redrive4/contract-members.md` — **ABSENT** everywhere.
- `redrive4/contract-ledger.md` — **ABSENT** everywhere, and absent in `redrive`/`redrive2`/
  `redrive3` too: the ledger row has not delivered in any drive of this wave.

Standing prior drive (the reference the three missing rows must beat): `redrive3/` carries
`contract-filesystem.md`, `contract-launch.md` (v1.1, two tranches), `contract-members.md`, and a
`contract-qa.md` — all at the redrive-3 base `09200e9`. `contract-ledger.md` is absent there as
well. I cross-check the three missing rows against their redrive-3 standing text (clearly labeled
as such), because "silence is not death" but it is also not a contract: the fold must re-land them
against THIS base.

## 2. Verdict table

| Row | redrive4 report | Verdict | Blocker(s) |
|---|---|---|---|
| row-lc-fs | `contract-filesystem.md` (landed, `d2371308`) | **sound** | — (one non-blocking drafting nit, §3) |
| row-lc-launch | absent; standing `redrive3/contract-launch.md` v1.1 | **needs-fold** | not re-landed at `5ae2c7e5`; redrive-3 anchors stale post-`85519556` |
| row-lc-members | absent; standing `redrive3/contract-members.md` | **needs-fold** | not re-landed at `5ae2c7e5`; `application.mjs` anchors stale post-`85519556` |
| row-lc-ledger | absent in every drive | **needs-fold** | row never delivered in any redrive; the package's missing quarter |

## 3. contract-filesystem.md (row-lc-fs) — VERDICT: SOUND

Attempt-echo at line 3 ✓. Harvest token `#168` present ✓. The redrive-4 seat correctly supersedes
redrive-3's text and re-anchors everything to HEAD `5ae2c7e5`.

**Spot-check record — 10 anchors read fresh in THIS seat's tree (`5ae2c7e5`) against the
contract's cited lines:**

| Contract anchor | Verified at `5ae2c7e5` | Result |
|---|---|---|
| `workflow-interpreter.mjs:597` status probe / `:599` `add -A` / `:600` base commit / `:602` silent catch | `git status --porcelain` → `add -A` → `commit … "baton workflow base"` → `catch { /* nothing to commit… */ }` | ✓ exact |
| `workflow-interpreter.mjs:707–715` seven receipt keys | `return { basis, harvest, manifestDigest, outcomes, steering, verdict, waveId }` | ✓ exact (7 keys, sorted) |
| `worktree.mjs:30–32` `DirtyRepoError` / `:1047–1055` `pinBaseSha` throw `:1053` | verbatim | ✓ exact |
| `worktree.mjs:1209`/`:1225` bare `add -A` / `commit` | `sh('git',['add','-A'],dir)` / `sh('git',['commit',…],dir)` | ✓ exact |
| `application-deployment.mjs:201` untracked flag / `:216` `GIT_INDEX_FILE` / `:233` `commit-tree -p head` | verbatim | ✓ exact |
| `coordinator.mjs:13504–13515` `worker_path_scope_violation` + `pathScopeEvidence` | verbatim | ✓ exact |
| `adapter.mjs:761` `danger-full-access` / `:773` `bypassPermissions` boundary | verbatim | ✓ exact |
| `index.mjs:567` `pinBaseSha(repoRoot, {})` (no autoStash) | verbatim | ✓ exact |
| `workflow-interpreter.mjs:587–589` base-comment intent | "commit the current working-tree state so the base is clean" | ✓ exact |
| `kernel-honesty-audit.md:47` (#169 stale-lock row) | cited text matches the redrive-3 record | ✓ (not re-opened; NUL-free, but load-bearing text identical to redrive-3's verified read) |

The contract's own recorded judgment call — re-anchoring the base block from the brief's stale
`:525` (now a QUIESCENCE constant) to `:587–603` after `cda6355c` — is **exactly the right
discipline**, and it names the mechanism-vs-trigger distinction correctly: `cda6355c` made the
base commit async + skip-if-clean, but the #168 capture (on-branch commit of the operator's dirty
tree) survives unchanged; only the trigger narrowed. I confirm this independently: the block at
`:594–602` still runs `git add -A` + `git commit` in `repoRoot` when the tree is dirty, and the
catch at `:602` still swallows silently.

**Acceptance pins (shallow-greenability):** FS-P1…FS-P6 are RED at HEAD and not shallow-greenable.
FS-P1's clause (c) (dirt survives untouched) blocks a stash/reset cheat; clause (d) (base step
SUCCEEDS on a dirty tree and yields a snapshot sha carrying the dirty content) blocks the
"refuse-dirty-trees" dodge. FS-P3 carries a same-pin control (no lock → success, no lock left)
against an always-refuse impl. FS-P4/FS-P5 jointly pin presence-on-escape AND absence-on-clean.
FS-P2/P6 are RED against the `:602` silent catch and the `:1005–1006` JSON-only anchor. No clocks
(mtimes observed, never asserted). **One drafting nit, non-blocking:** FS-P5's phrase "the escape
record set is EMPTY" should read "present and empty" (its own RED rationale already says so).

**Refusal vocabulary:** four new codes (`workflow_base_unavailable`, `worker_index_lock_stale`,
`member_fs_escape`, `worker_base_ref_invalid`) — typed, payload-keyed, coached, declared COMPLETE
and surface-constant; four frozen existing surfaces named with anchors. Closed ✓.

**Boundary conduct:** exemplary — D6 explicitly cedes receipt-shape authority to the launch row
(#202) and escalates via DECISION_REQUEST with options + recommendation; §5.5 names the
capacity-row lock-tombstone seam for the QA pass. The D4 `member_fs_escape` store event touches
the ledger row's lane — ledger must ACKNOWLEDGE it (fold check F-B1 below).

## 4. contract-launch.md (row-lc-launch) — VERDICT: needs-fold

No redrive-4 deliverable on disk. Cross-checked the standing `redrive3/contract-launch.md` v1.1
(attempt `9a07d8eb`, verified at `09200e9`) against THIS base `5ae2c7e5`.

**Spot-check record (fresh reads at `5ae2c7e5`):**

| Anchor (redrive-3 text) | Verified at `5ae2c7e5` | Result |
|---|---|---|
| `application.mjs:11654` `const detach = request.detach !== false` (GT-L1/GT-L16) | now at `application.mjs:11695` — `request.detach !== false` verbatim | ✗ line drift (~41); substance intact (default-true, untyped coercion) |
| `limits.mjs:56` `run.objective` 4096 + spill-graceful / `:57` `wave.member.objective` | verbatim at `:56`/`:57` | ✓ exact |
| `limits.mjs:86` `spill.body` 1 MiB | verbatim at `:86` | ✓ exact |
| `wave.mjs:250` `entry.startError = { code, message }` | verbatim at `:250` | ✓ exact |
| `mcp-northbound.mjs:196–199` `toolResult` `{result: <x>}` envelope | verbatim at `:196–200` | ✓ exact (the #202 degrade seam) |
| `mcp-northbound.mjs:2272` `_sanitizeDoctorReadiness` non-record pass-through | now `:2274–2275` (`if (!record(value)) return value;`) | ~2-line drift; substance intact |
| `'Command executed successfully.'` absent from `impl/src` | `grep -rn` over `impl/src/` → zero matches | ✓ (GT-L9 holds) |

The launch contract's substance is the strongest of the three standing texts (the two-lane split
GT-L12–L16, PIN-L1…L12 with anti-shallow traps, D9 closing the `workflow_*` family at six). But at
`5ae2c7e5` the `application.mjs` anchors have drifted under `85519556` (single-pass steering
index) — `detach` moved to `:11695`, and the `_runIdForWaveMember`/`startWave` sites it shares
with the members row moved similarly. **Fold instruction:** re-anchor `application.mjs` citations
to `5ae2c7e5` and re-confirm PIN-L1 (total start failure), PIN-L4 (`detach` reachable), PIN-L8
(unknown waveId refuses) against the current `waves.progress`/`waves.run` read paths. One
substantive coherence note for the fold: PIN-L6's `limits.mjs:57` `enforcedAt` claim
("startWave/attachWave member admission") is still the registry's literal text at `:57`, so the
pin remains RED — but the `#163` change (commit `8ec52a6c`) made the settle verdict three-valued
(`WAVE-OK`/`WAVE-QUIESCED`/`WAVE-INCOMPLETE`); no launch pin asserts a binary settle verdict, so
nothing breaks, but the acceptance/verdict language should be re-read against the new enum.

## 5. contract-members.md (row-lc-members) — VERDICT: needs-fold

No redrive-4 deliverable on disk. Cross-checked the standing `redrive3/contract-members.md`
(attempt `9a07d8eb`, verified at `09200e9`, and already carrying the #218/#221 fold) against
`5ae2c7e5`.

**Spot-check record (fresh reads at `5ae2c7e5`):**

| Anchor (redrive-3 text) | Verified at `5ae2c7e5` | Result |
|---|---|---|
| `wave.mjs:353`/`:472` `phase:'failed'` renders with `error: entry.startError` | verbatim at `:353`/`:472` | ✓ exact |
| `application.mjs:3343–3351` runId digest (no `waveId` in the digest) | digest block verbatim, `waveId` absent | ✓ exact |
| `application.mjs:1560–1563` deliberate-exclusion comment | comment at `:1563` | ~3-line drift; substance intact |
| `application.mjs:11937–11948` `_runIdForWaveMember` stale-first | definition now `:11985`; first-match `return event.payload.runId` confirmed | ✗ line drift (~40); substance intact (still stale-first on the full-log fallback) |
| `application.mjs:11769–11785` `startWave` `wave_member_invalid` throw | now `:11811–11824` | ✗ line drift (~45); substance intact |
| `coordination-store.mjs:13246–13266` `task.dispatch_deferred` | `:13250`/`:13261` | ~4-line drift; substance intact |
| `router.mjs:202–203` `eligible = candidates.filter(c => c.inFlight < c.concurrencyCeiling)` | verbatim | ✓ exact |
| `application-semantics.mjs:59–61` `WAITING_ON_KINDS` (closed set) | verbatim | ✓ exact |
| `index.mjs:1554–1558` `driver_capacity_active` | throw at `:1558` | ~4-line drift; substance intact |

The members text is the most structurally complete of the standing three (A1–A7 pins with
anti-shallow traps, D-composition state machine, two DECISION_REQUESTs DR1/DR2, six open
questions). Its `application.mjs` anchors drift the same way the launch row's do (both ride the
waves.list/progress read paths that `85519556` rewrote). **Fold instruction:** re-anchor
`application.mjs` citations; reconcile DR2 (D6's acceptance `serialization` key) with the launch
row's receipt-shape ownership once that row re-lands; carry the #221 ruling note (the auto-route
ceiling skip at `router.mjs:202–203` is the residual silent vector, GT19) — it is still verbatim
at this base and still silent.

## 6. contract-ledger.md (row-lc-ledger) — VERDICT: needs-fold (row never delivered)

No `contract-ledger.md` in `redrive4`, `redrive3`, `redrive2`, or `redrive` — in any worktree or
in the repo. The #194/#205 seams (model-visible-means-logged + the durable no-step turn; decision
ledgering) are the package's **uncontracted quarter**. The two named gaps that depend on ledger
ownership — the wave-side `evidence()` trace vs the store-side log, and the members row's OQ4
(does #194's doctrine cover the new `wave.member_start_failed`/`task.seat_queued` records?) —
cannot be reconciled until this row lands. **Fold instruction:** dispatch this row alone if the
other three can be folded from their standing text; it has never once materialized.

## 7. Cross-contract boundary map (coherence)

The three landed/standing contracts agree on the seams, and each cross-cites the others:

- **fs** owns base-commit capture (#168) · own-index discipline (#172) · member confinement +
  settle sweep (#185).
- **launch** owns receipt shapes, detach/acceptance honesty, response shapes, objective-admission
  alignment (#173/#202/#207).
- **members** owns durable store records, task-id namespacing, drain-restart, seat_queued, spawn
  hops (#199/#200/#204/#218).
- **ledger** owns model-visible-means-logged + decision ledgering (#194/#205) — **uncontracted**.

**Overlaps (named by the contracts themselves, each ceding to one owner):**
1. `spill-digest-citation` — launch (#207 receipt carries the spill) × ledger (#194 reconstruct-
   ability). Same `limits.mjs` rows. Launch cites, ledger would own reconstruct.
2. objectiveRef path seam — fs (#168/#185 capture/confine) × members (#200 task-id derivation).
3. response shape — launch (#202 closed receipt) × ledger (#194 reconstructable from store).
4. members D1/D4/D5 records vs ledger's visibility doctrine (members OQ4) — unresolved, ledger absent.

**Gaps:** the ledger row itself; `attachWave`/re-drive (`wave.mjs`) and the wave-side
`evidence()` trace — named by the redrive-3 QA, still unassigned; and the `workflow_*` prefix
open-endedness the launch row's D9 proposes to close at six (the MCP allowlist admits any
`workflow_*`, `mcp-northbound.mjs` prefix arm) — a refusal-vocabulary closure gap that is
aspirational until D9 lands.

**Boundary verdict:** coherent where the three texts exist — the two receipt-shape seams
(fs D6, members D6/DR2) both correctly defer to the launch row, and the launch row's §7
reciprocates. The coherence failure is an ABSENCE (ledger), not a contradiction.

## 8. Fold instruction set (concrete)

1. **Re-dispatch the three missing rows** (launch, members, ledger) against `5ae2c7e5` — the
   launch and members rows have standing redrive-3 text to fold from; the ledger row has nothing
   and must be produced from the brief.
2. **Re-anchor every `application.mjs` / `workflow-interpreter.mjs` citation** to `5ae2c7e5`:
   `detach` is at `:11695`, `_runIdForWaveMember` at `:11985`, `startWave`'s throw at
   `:11811–11824`, the base block at `:594–602` (async + skip-if-clean), the receipt keys at
   `:707–715`. The fs row has already done this correctly — use `contract-filesystem.md`'s
   appendix as the template.
3. **Fix the seed briefs' staleness** (they were copied forward without updating): every
   `row-lc-*.md` deliverable line still says `redrive3/contract-*.md`; the fs brief still pins
   "the base-commit line at `workflow-interpreter.mjs:525`" (now a QUIESCENCE constant); the
   launch brief still says `application.mjs:11631–11646` awaits the full drive (stale pre-`ac0f5bc`).
4. **Reconcile the members DR2 / launch D6 receipt-shape question** once both re-land: the
   acceptance `serialization` key (members D6) vs the launch row's receipt-shape ownership.
5. **Land the ledger row** and resolve the two named gaps (`attachWave`/re-drive; wave-side
   `evidence()` trace) plus members OQ4.
6. **Close the `workflow_*` refusal family at six** (launch D9) — declared at the mint site, not
   just in prose.
7. **Re-read the settle verdict against the #163 three-valued enum** (`WAVE-OK`/`WAVE-QUIESCED`/
   `WAVE-INCOMPLETE`) in every pin that touches `verdict`.

## 9. Publish-to-`shared` — the refusal, recorded (#158 law)

Instructed to publish to `shared` on completion. The `#158` root cause is still live at this base,
re-verified this session: `coordination-store.mjs:14169` hardcodes `const scope =
\`worker:${fields.workerId}\`` inside `writeScratchpad` (`:14130`), and the `shared`-scope
settlement is orchestrator-actor-only — a coordinator publish-to-`shared` is silently admitted
into the worker partition, never refused with a typed code. The refusal IS the admission, so
there is no refusal string to quote. This QA is published ON DISK at the wavefile's harvest path
(`lifecycle-contracts-2026-08-14/redrive4/contract-qa.md`); fabricating a shared-scope publish was
not an option. (The redrive-3 fs row records the same shape — `redrive3/contract-filesystem.md`
§6.)

## 10. Escalation (authority-class — via DECISION_REQUEST)

1. **Disposition of the three silent redrive-4 rows.** The fs row has landed and is sound; launch,
   members, and ledger have no redrive-4 deliverable at this base (ledger none in any drive). The
   orchestrator's v20 pack (`093da603`) is already re-seating GLM-casualty waves to deepseek and
   has seeded a `redrive5`, so a redrive is in motion. Options: **(a) release-gapped** — conclude
   redrive-4 with the verdicts above (fs sound, three needs-fold) and fold in redrive-5; **(b)
   fold-standing** — treat the redrive-3 launch/members texts as the fold input (re-anchor only),
   dispatch only the ledger row; **(c) hold-recheck** — hold this seat open for a late
   materialization. Recommendation: **(a)** — redrive-5 is already seeded, and the standing texts
   are substantive enough to fold from without a second full re-write.
2. **Seed-contamination across waves.** This wave's `collab-contracts-2026-08-14/coordinator-brief.md`
   is a verbatim copy of the LIFECYCLE coordinator brief (it cross-checks `row-lc-*` rows that do
   not exist in the collab wavefile, whose real rows are `member-lanes`/`knowledge-activation`/
   `context-lanes`/`federation-doubt`). Whoever owns the pack seeding should confirm the collab
   coordinator is not about to cross-check the wrong rows. Options: **(a)** correct the collab
   coordinator brief to name its four real rows; **(b)** confirm the copy is intentional (shared
   QA template) and re-seed; **(c)** leave as-is and let the collab coordinator record the
   mismatch. Recommendation: **(a)**.
3. **Ledger row never delivers across four drives.** This is a dispatch-capacity fact, not a
   contract defect (the row brief + #194/#205 seeds exist and are sound). Options: **(a)**
   single-row re-dispatch with an explicit materialization check; **(b)** fold the ledger
   requirement into the launch row (receipt reconstructability) and the members row (record
   durability) if a fourth seat cannot be sustained. Recommendation: **(a)**.

## Residual register

1. Signal received; one of four rows landed at signal time (fs), three silent at this base. Recorded,
   not fabricated.
2. The v20 pack (`093da603`) and a redrive-5 seat (a coordinator QA, attempt `8850892d`, since
   committed as snapshot `36929f0b` of sibling `ws-398f8a11`) are live while this seat writes —
   the foundry is mid-redrive; this QA records the redrive-4 truth as of this base. Re-swept after
   that landing: redrive-4 still holds only `contract-filesystem.md` + this QA; launch/members/
   ledger remain absent.
3. Anchor drift between `09200e9` (redrive-3 base) and `5ae2c7e5` (this base) is real and
   concentrated in `workflow-interpreter.mjs` (`cda6355c`) and `application.mjs` (`85519556`,
   `8ec52a6c`) — the two files the missing rows must re-anchor against.
