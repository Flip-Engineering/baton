# Fold: orientation ladder red suite — blue-team report folded into the suite (2026-08-03)

(Authority: `orientation-blueteam.md` (same directory). Edit targets: `impl/test/orientation-red.test.mjs`
and — for the one contract-side drift it names (§5 item 5) — `orientation-contract.md`. NUL-containing
sources (`coordinator.mjs`, `coordination-store.mjs`, `application.mjs`) verified via `grep -an`/`sed -n`
only. Suite run from repo root: `node --test impl/test/orientation-red.test.mjs`.)

## Splits

- **Before (verbatim):** tests 30, pass 7, fail 23. Passing: OR-L5, OR-C3, OR-C4, OR-S2, OR-E1, OR-E2, OR-T1.
- **After (verbatim):** **tests 38, pass 6, fail 32** (duration ≈ 3.4 s, no skips/todos/cancels).
  Passing: **OR-C3, OR-C4, OR-S3, OR-E1, OR-E2, OR-T1.**
  Failing: OR-L1..OR-L10, OR-F1..OR-F4, OR-C1, OR-C2, OR-C5, OR-C6, OR-S1, OR-S2, OR-S4,
  OR-E3..OR-E10 (except E1/E2), OR-A1..OR-A3 — every red row fails at the NAMED stage in its
  stage tag; no row was weakened to pass.

Passer movement: **OR-L5** flipped green→red (sharpened, blocker 1). **OR-S2** flipped green→red
(real grant oracle, blocker 3). **OR-S3** flipped red→green (sound BD3-compatible pin, blocker 2).
OR-E1/OR-E2 stay green (legitimately landed BD3-A behavior — `recordContextRead` +
idempotent replay/conflict at coordination-store.mjs:12994-13006, `context.read` projected with the
zero-weight comment at :8596-8599; cited in the suite header). OR-C3/OR-C4/OR-T1 stay green (pins).

## Blockers → what changed

### Blocker 1 — OR-L5 false green → rebuilt with sharper teeth (now red at the named stage)

Refused reads are receipted (`context.read_result` appended unconditionally,
coordinator.mjs:11583-11591), so receipt-count assertions can never prove an answer. The row now:

- asserts `payload.ok === true` BEFORE any bound — a `context_read_invalid` refusal receipt can
  never satisfy it (reds today at exactly this assertion, the `code-lane-missing` stage);
- forces a genuinely >4KiB region: the fixture wires a REAL `AtlasCodeIndex` over a REAL git repo
  into the Coordinator's `capabilities` registry (the invented code-lane answer seam, documented in
  the header) via the new `orientedLane()` helper, with a 28-file × 3-exported-contracts module —
  >4KiB of honest region surface under any contract-correct rendering;
- asserts `status === 'needs_resume'` + `cursor` (opaque string) + `packDigest` + `freshnessDigest`
  + `scopeDigest` UNCONDITIONALLY (the conditional-and-skipped block is gone), keeping the ≤4KiB
  constructive page bound.

### Blocker 2 — OR-S3 staged-wrong pin → re-scoped, sound, and green today

The old pin grepped 4 files for `context_pack_expired`, which legitimately exists since BD3-B landed
(`materializeContextPack` at coordination-store.mjs:12977 under `DEFAULT_CONTEXT_PACK_VALIDITY` :445)
— no contract-correct stack could ever green it. The pin now asserts the campaign-law property
directly: **no CODE line (comments stripped) carrying an orientation-surface identifier may carry
clock/TTL vocabulary** (`validity:`, `ttl:`, `expiresAt`, `context_pack_expired`, `Date.now(`,
`Date.parse(`, `now()`, `setTimeout(`, `setInterval(`), grep-scoped to orientation-specific
identifiers (`code.orient`, the `orientation-map` pack family, the invented store APIs, event kinds,
refusal codes, `freshnessDigest`, `normalizedQueryDigest`, …) — never the shared `context_pack`
vocabulary. Verified: every one of those identifiers is absent from `impl/src/` today (grep: 0 files
each), so the pin greens vacuously-but-soundly: a clock-importing orientation implementation reds; a
contract-correct stack stays green. Known limitation (documented, accepted): single-line
co-occurrence cannot catch a TTL parameter split across lines away from any orientation identifier —
the multi-line window variant was rejected because it false-reds orientation code that legitimately
rides BD3-B's default non-expiring window, which the report explicitly allows.

### Blocker 3 — OR-S2 vacuous grant/retry half → real oracle (now red at the named stage)

Staged real grant semantics instead of narrowing (the CAS half keeps its live teeth):

- invented grant event kind **`context.pack_granted`** (documented in the header's invented-surface
  list) with attempt-scoped payload `{packId, runId, taskId, taskVersion, workerId}`;
- grants are counted for the attempt AFTER the retry (the pre-retry snapshot bug is gone);
- the retry is a same-attempt replay — `spawn(mock, sameBrief, { taskId: handle.taskId })` — with an
  EXACT outcome assertion (`=== 'spawned'`; today: `DuplicateTaskIdError`, coordinator.mjs:3998);
- asserts exactly one grant for the attempt after the retry, and that the refused non-head spawn
  minted NO grant.

Today: 0 grant events exist (grep `context.pack_granted` in impl/src: 0 hits) → red at "a cited
spawn mints exactly ONE attempt-scoped pack grant" (stage tag updated to `pack-grant-kind-missing`).

### Blocker 4 — acceptance-pinned behaviors with zero oracle → 8 new rows (staged) + documented deferrals

Staged (all red at named stages):

- **OR-L8** `[closed-union-renderer-missing]` — O-1 renderer-REJECTION leg: the ONE renderer
  (`coordinator._renderContextRead`, the only path per coordinator.mjs:10347-10351) must reject
  unknown leaf fields and prose without `untrusted:true`; today it renders anything under a default
  frame (:10352-10384). Positive control: well-formed closed-union leaves render framed.
- **OR-L9** `[range-containment-missing]` — O-1 containment leg: detail with a range OUTSIDE the
  live citation's admitted scope refuses (scope family) BEFORE serving; contained-range positive
  control answers.
- **OR-L10** `[modulekey-derivation-missing]` — O-1 moduleKey rule: `packages/alpha/package.json`
  anchors `packages/alpha` (deepest package root, never `packages`), `src/util/b.js` → `src`
  (first segment), `root.js` → `.` (wired-registry harness).
- **OR-F4** `[reverify-freshness-missing]` — O-3 reverify gate: clean reverify confirms the claim
  (control), then reverify after the base tree moved must refuse `orientation_base_stale` /
  `effective_tree_changed`; today rerun-and-compare returns a bare `ok:false` payload
  (atlas-index.mjs:395-406), never a typed refusal.
- **OR-E8** `[receipt-ceiling-missing]` — O-2 per-attempt BYTE ceiling (count ceiling placed out of
  reach so only bytes can fire; below-ceiling receipts admit, the crossing receipt refuses
  `orientation_receipt_ceiling` BEFORE append) and PROPOSAL ceiling (`maxProposalsPerAttempt`).
- **OR-E9** `[propose-verification-missing]` — O-2 prior-receipt verification (proposing a pack the
  attempt never received refuses `orientation_propose_refused` and materializes no node) and
  duplicate coalescing by `{leafDigest, freshnessDigest}` under a different idempotency key (no
  second append, returns the prior candidate).
- **OR-E10** `[overlay-merge-missing]` — O-4 positive application (exact moduleDigest/freshness
  match APPLIES), `overlay_conflict` (two live curated leaves, no `Supersedes` winner → BOTH omit
  with structured trace — never by event time/insertion order), and the live-`Supersedes`-winner
  leg (winner applies, no conflict reported).
- **OR-S4** `[grant-ordering-missing]` — O-6 ordering/dedup: the adapter probes the store from
  inside `spawn()` — at provider dispatch the grant must already be durable (artifact-write →
  atomic grant+spawn append → dispatch); two attempts citing the same head hold TWO attempt-scoped
  grants over the SAME packId (byte-deduped, authority never collapses).

Deferred (explicit, with reasons):

- **O-3 production-time worktree fence interposition** — the capture-before-scan / compare-before-
  publish property requires interposing inside one production call; no deterministic seam exists
  today and inventing one would dictate implementation internals the contract does not name. The
  shared freshnessDigest comparison is pinned at all three sibling gates (OR-F2 serve, OR-F3 resume,
  OR-F4 reverify); "publishes no pack on divergence" follows from those refusals.
- **O-6 crash-window semantics** — crash-before/crash-after recovery needs fault injection;
  OR-S4's ordering leg covers the durable-before-dispatch property that the crash windows build on.
- **O-5 reachability roots + deterministic reclamation** — needs the retention machinery's API
  surface (roots enumeration) that does not exist even to invent against cleanly; OR-C5 simulates
  reclamation with `rmSync` as before.
- **O-7 precompute-budget advisory bound** — no aggregate/precompute seam exists; out of the fold's
  O-1..O-6 scope.
- **O-8 curated-leaf-on-unsupported-module and coverage-in-pack** — out of the fold's O-1..O-6
  scope; both need the landed pack producer to stage against.
- **`orientation.leaf_proposed` MINT trigger split** — the contract names both
  `orientation.leaf_proposed` and `orientation.overlay_proposed` under the one
  `orientation.candidate.propose` action without saying how the mint distinguishes them; the
  ADMISSION seam for `orientation.leaf_proposed` is pinned by OR-E4 and the propose-path semantics
  (verification, coalescing) by OR-E9; the overlay mint trigger is pinned by OR-E5. Left for the
  implementation wave to disambiguate rather than over-invent here.

### Blocker 5 — `refs[0].path` pin/fixture collision → digest-derived artifact path

New helper `atlasArtifactPath(root, ref)` resolves artifact bytes from the fixture's OWN artifact
root + the ref `digest` (a field that survives OR-C2's transport stripping): the driver's atlas
config + index.mjs's `index` subroot + the shipped CAS layout (`resultRoot = <artifactRoot>/results`,
`<digest>.json` — atlas-index.mjs:237, :278). OR-C4 tampers and OR-C5 reclaims through it. OR-C4
verified still green (the tamper lands at the right path and `result_integrity` still fires);
OR-C5 still reds only for its named reason (`orientation_artifact_retired` missing).

## Teeth-flag dispositions (§4, T-1..T-16)

- **T-1 (OR-L1 shape pin) — ACCEPTED as designed.** The report itself calls it an acceptable
  first-rung shape pin; derivation teeth live in OR-F1/OR-F2. No change.
- **T-2 (OR-L2 vacuous leaf loop) — FIXED:** every module MUST carry a `leaves` array (asserted), so
  the closed-union loop can never be vacuous; plus a new `ok:true` tooth on the map answer.
- **T-3 (OR-L2 bare UNTRUSTED substring) — FIXED:** the delivered prompt must contain BOTH the
  UNTRUSTED frame AND the answer's own packDigest — stamping the token into unrelated content fails.
- **T-8 (OR-E2 caller-keyed replay) — REJECTED (reason recorded).** Adding the hub-derived-tuple leg
  (same tuple under a second caller key must not double-mint) would false-red the legitimately landed
  BD3-A spine (`recordContextRead` keyed on `auth.key`, coordination-store.mjs:12996-13003) and
  violate the fold requirement that OR-E2 stay green. Kept as a documented shallowness; the
  contract-tuple shape half IS pinned (OR-L6, T-15).
- **T-9 (OR-F1 rev-parse stub) — FIXED:** dirty-worktree leg (uncommitted bytes never move the
  attested `baseTreeSha`) + persisted-record leg (a later serve at the epoch carries the same
  attested tuple). Residual: distinguishing a persisted record from a deterministic recompute is only
  fully pinned in composition with OR-F2's post-move refusal — noted, accepted.
- **T-10 (OR-E5 near-vacuous generated-still-serves) — FIXED:** requires a REAL module rollup
  (`merged.map.modules` non-empty) answering for the requested module coordinate.
- **T-11 (OR-C1 no positive control / freshness mask) — FIXED:** same-scope resume positive control
  (always-refuse fails), and overlayB is now byte-identical (a refusal can only be authorization,
  never a freshness refusal mislabeled as scope).
- **T-12 (OR-C6 hair-trigger) — FIXED:** first-write positive control + the refusal may only fire
  after real admissions (ceiling actually crossed).
- **T-13 (OR-S1 scope tooth / splice guard / field probe) — FIXED:** positive `lane-b` tooth (a
  repo-global or wrong-region map fails), splice guard extended to `constraints`; the
  `orientation ?? contextPacks ?? packs` probe is documented in the header's invented-surface list.
- **T-14 (OR-E6/E7 caller-injected attempt) — FIXED at the store level:** OR-E6 adds a
  caller-forged attempt tuple (wrong taskVersion/workerId vs the hub's own task record) → constant
  `orientation_rating_refused`. Genuine hub-derivation end-to-end remains the (red) lane row OR-L7's
  job, as the report notes.
- **T-15 (OR-L6 landed mint shape) — FIXED:** OR-L6 now asserts the full contract identity tuple
  (`repoId, runId, taskId, taskVersion, workerId, op, normalizedQueryDigest, packDigest,
  freshnessDigest`) on the minted event — it can never green on the landed interim shape
  `{kind, queryDigest, resultDigest}` (coordinator.mjs:10267-10273).
- **T-16 (OR-E3 unpinned refusal code) — FIXED:** pinned to the invented
  `orientation_receipt_ceiling` (header-documented), same code in OR-E8; byte/proposal ceilings
  exercised by OR-E8.

## Header / drift fixes (§5)

1. **Invented-surface list added** to the suite header (store APIs, knobs, wire kinds, the
   `context.pack_granted` event, the capabilities-registry code-lane seam, and the two invented
   refusal codes) — the suite commit claimed this list existed; it did not.
2. **`queryDigest` → `normalizedQueryDigest`** in the OR-E1/OR-E2/OR-E3 fixtures, aligning the suite
   to the contract's O-2 tuple; the header records that the landed BD3-A mint shape differs from
   BOTH and that OR-L6 pins the contract tuple on the wire mint.
3. **Stale O-1 stage note rewritten** to post-726e34a reality (the wire lane exists, refuses unknown
   kinds with `context_read_invalid`, receipts refusals); the O-2/O-4, O-2/O-7, and O-6 section notes
   updated likewise (class/pack machinery landed; trigger vocabulary + grant kind absent).
4. **"Twenty-eight rows" → "Thirty-eight rows"** with the corrected family map.
5. **Contract line-cite drift (contract-side, the only contract edit):** workflow-admission trigger
   check `:14630` → **`:14781`** (4 occurrences) and `KNOWLEDGE_CANDIDATE_TRIGGERS` `:15477-15482` →
   **`:15628-15635`** (2 occurrences), verified by grep/sed against the live tree. Note: the report's
   own `:14669` was also stale — the check sits inside `_deriveWorkflowAdmission`
   (coordination-store.mjs:14768, the throw at :14781). Behavior unchanged; line numbers only.
6. **OR-S2 adopted names** (`mintContextPack`/`contextPackHead`, `spawn(vendor, brief, opts)`)
   verified correct against the landed BD3-B API — no drift, no change.

## Refusal-code ledger additions (invented, header-documented)

`orientation_receipt_ceiling` (O-2 per-attempt count/byte/proposal ceilings — the contract names no
code for these) and `orientation_propose_refused` (O-2 prior-receipt verification). The E3 ceiling
code was previously unpinned (any typed string passed); both are now exact.
