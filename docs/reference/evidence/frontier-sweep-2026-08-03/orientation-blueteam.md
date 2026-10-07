# Blue-team: orientation ladder red suite — adversarial verification

(Target: `impl/test/orientation-red.test.mjs` — 30 rows: OR-L1..L7, OR-F1..F3, OR-C1..C6,
OR-S1..S3, OR-E1..E7, OR-A1..A3, OR-T1. Verified against the v1.0 post-fold contract
`orientation-contract.md` (same directory) and `impl/src/` ground truth, 2026-08-03.
NUL-containing files (`coordinator.mjs`, `coordination-store.mjs`, `application.mjs`)
inspected via `grep -an`/`sed -n` only. Suite run from repo root:
`node --test impl/test/orientation-red.test.mjs`.)

Verdict scale: **SOUND** = green for the right reason today (pin) / red at the named stage,
and a wrong implementation cannot pass it. **WEAK** = correctly staged and discriminating in
composition, but a named wrong implementation can pass it. **VACUOUS** = passes without
exercising the named behavior. **STAGED-WRONG** = the row's red/green state does not track
the named contract behavior.

## Run record (verbatim)

`node --test impl/test/orientation-red.test.mjs` → **tests 30, pass 7, fail 23**
(duration ≈ 1.2 s, no skips/todos/cancels).

Passing: **OR-L5, OR-C3, OR-C4, OR-S2, OR-E1, OR-E2, OR-T1.**
Failing: OR-L1, OR-L2, OR-L3, OR-L4, OR-L6, OR-L7, OR-F1, OR-F2, OR-F3, OR-C1, OR-C2,
OR-C5, OR-C6, OR-S1, OR-S3, OR-E3, OR-E4, OR-E5, OR-E6, OR-E7, OR-A1, OR-A2, OR-A3.

### Every red row's failure point (at named stage?)

| Row | Fails at | Observed | At named stage? |
|-----|----------|----------|-----------------|
| OR-L1 | :289 | `ok` false on the `context.read_result` receipt (query refused `context_read_invalid`) | YES — the `code` query kind is not admitted (coordinator.mjs:10345 throws for unknown kinds) |
| OR-L2 | :327 | zero provider prompts containing `UNTRUSTED` | YES — no framed answer exists to render |
| OR-L3 | :347 | foreign + nonexistent refuse identically (`context_read_invalid` = `context_read_invalid` ✓) but the code ≠ `/scope\|forbidden/` | YES — kind missing, so the invalid-kind refusal precedes any scope logic |
| OR-L4 | :365 | citation-less path/range refused ✓ (:360), then the live map does not answer (`ok` false) | YES |
| OR-L6 | :407 | 0 `context.read` events | YES — the refusal path returns before the mint block (coordinator.mjs:10262-10279) |
| OR-L7 | :424 | worker never receives a pack (`ok` false) | YES |
| OR-F1 | :463 | `provenance.baseTreeSha` undefined ≠ `HEAD^{tree}` | YES — no git-base attestation |
| OR-F2 | :483 | serve returns (null) after the base tree moved, ≠ `orientation_base_stale` | YES — stale base served as fresh today |
| OR-F3 | :505 | resume serves after the tree move ("observed: served") | YES — resume does no freshness work |
| OR-C1 | :530 | copied cursor `'served'` ≠ `/scope\|forbidden/` | YES — resume is bearer-only |
| OR-C2 | :550 | refs carry a sixth key `path` (+ absolute path substring) | YES — path disclosure live today |
| OR-C5 | :602 | `unknown_cursor` ≠ `orientation_artifact_retired` | YES — no retention contract |
| OR-C6 | :621 | 12 probe writes, no refusal (null) | YES — `maxOrientationStorageBytes` knob absent (grep: 0 hits) |
| OR-S1 | :636 | spawned brief JSON has no pack citation | YES — no L0 injection |
| OR-S3 | :677 | `context_pack_expired` IS present in coordination-store.mjs | **NO — STAGED-WRONG pin** (blocker 2; see §2) |
| OR-E3 | :758 | 3rd receipt appended, no refusal | YES — `orientationReceiptCeilings` absent (grep: 0 hits) |
| OR-E4 | :781 | `workflow_admit_ineligible` ≠ null; both live controls held (board candidate admits ✓ :767, worker actor refuses `workflow_admit_invalid` ✓ :775) | YES — trigger vocabulary unamended (grep `orientation` in coordination-store.mjs: 0 hits) |
| OR-E5 | :790 | `TypeError: store.mintOrientationSource is not a function` | YES — overlay machinery absent |
| OR-E6 | :823 | `TypeError: store.recordOrientationRating is not a function` | YES — rating API absent |
| OR-E7 | :843 | `TypeError: store.recordOrientationRating is not a function` | YES |
| OR-A1 | :870 | status `'ok'` ≠ `orientation_unavailable`; empty-payload control ✓ (:869) | YES — no coverage/status ladder |
| OR-A2 | :890 | summary `'no JavaScript/TypeScript-family sources; honest empty Atlas result'` over NON-EMPTY results; overlay control ✓ (:888) | YES — deployment-time flag frozen |
| OR-A3 | :906 | status `'ok'` ≠ `partial`; supported-file control ✓ (:905) | YES — no partial labeling |

**22 of 23 red rows fail exactly at their named stage — no fixture bugs in the red half.**
The exception is OR-S3 (a named pin), which fails because the BD3-B spine legitimately
landed with its wall-clock expiry — see §2.

## §1 — Discrepancy reconciliation (REQUIRED): drafter's 26 red / 4 pins → observed 23 red / 7 pass

**Root cause: the BD3 collaboration spine landed between drafting and verification.**
Git history: `726e34a` (2026-08-02, "BD3 collaboration spine LANDED — BD3-A CONTEXT_READ
wire lane … BD3-B context packs … BD3-C messaging") is the **parent** of `5c2d729`
(2026-08-02, the suite commit). Against a pre-`726e34a` tree the split is exactly the
drafter's 26 red / 4 pins: `mintContextPack` and `recordContextRead` absent (OR-S2, OR-E1,
OR-E2 red by TypeError), the `context.read` wire lane absent (OR-L5 red at :383, zero
results), and `context_pack_expired` absent (OR-S3 green). The suite commit message itself
already records the post-spine split — "**#81 orientation 30 rows (23 red / 7 pins)**" —
so the drafter's 26/4 was a stale pre-land report; the orchestrator-verified count at
commit time matches this run exactly.

**FIVE rows deviate from the drafter's report — four flipped red→green, one flipped
green→red (net +3 green = the "3 extra passers"):**

| Row | Flip | Verdict | Basis |
|-----|------|---------|-------|
| **OR-E1** | red→green | **Legitimate — behavior exists (SOUND)** | `recordContextRead` landed at coordination-store.mjs:12994; `context.read` is its own event class appended at :13003 and projected at :8596-8599 with the zero-weight comment; `_contextReads` has exactly two references in the file (init :1112, projection :8599) — no promotion path consumes it, so zero weight holds **by construction**; the positive control (`scratch.cited_observed` derives, :14532-14535) proves the promotion path is live in the fixture |
| **OR-E2** | red→green | **Legitimate — behavior exists (SOUND, one shallowness note)** | Idempotent replay + `context_read_conflict` landed at coordination-store.mjs:12996-13003. Shallowness: replay identity is keyed on the caller-supplied `auth.key`, not the hub-derived identity tuple the contract names — a caller-keyed implementation that double-mints one tuple under two keys passes (teeth flag T-8) |
| **OR-S2** | red→green | **Legitimate for the CAS half, VACUOUS for the grant/retry half (WEAK → blocker 3)** | Live-head CAS landed: `mintContextPack` :12950, `contextPackHead` :12967, `_admitContextPackCitations` throws `context_pack_stale` at coordinator.mjs:3568 and runs at spawn admission :4139; `DEFAULT_CONTEXT_PACK_VALIDITY = '2999-12-31…'` (:445) keeps expiry out of the way. But: (a) the `grants` array is snapshotted at :665 BEFORE the retry spawn at :666, so the retry's grant behavior is never observed; (b) the retry assertion `retry === 'spawned' \|\| typeof retry === 'string'` (:670) is a tautology — every outcome of the `.then(()=>'spawned', e=>code)` chain is a string; (c) **no pack-grant event kind exists anywhere in `impl/src/`** (grep: `pack.grant`/`grantContextPack`/etc. 0 hits; the only pack event is `context.pack_minted`, :8588), so `grants.length <= 1` is vacuously true forever |
| **OR-L5** | red→green | **FALSE GREEN — STAGED-WRONG (blocker 1)** | The landed wire lane appends a `context.read_result` receipt for REFUSED queries too (coordinator.mjs:11578-11591: `contextRead()` → `appendAttributed(... 'context.read_result' ...)` unconditionally), so `results.length === 1` (:383) passes on the `context_read_invalid` refusal. The row then has NO `ok === true` assertion: `region = payload.region ?? payload.result ?? {}` is the refusal string `{}`/`'context_read_invalid'` (≤ 4KiB trivially, :386), and `payload.status ?? 'ok'` is never `'needs_resume'`, so the entire cursor/freshnessDigest/scopeDigest block (:387-391) is skipped. The row passes with the region tier unimplemented, unbounded, and cursorless |
| **OR-S3** (pin) | green→red | **STAGED-WRONG pin (blocker 2)** | BD3-B landed its own contract-mandated expiry: `materializeContextPack` throws `context_pack_expired` at coordination-store.mjs:12977 (plus comments :444, :12917). The v1.0 fold forbids importing the clock **into this epic's orientation packs**; it does not forbid BD3-B's own window (bidirectional-v3-decisions.md:48-49, already landed and contract-adopted). The 4-file string grep tests "BD3-B does not exist", not "orientation never invalidates by clock" — a contract-correct orientation implementation on top of the landed spine keeps this pin red FOREVER |

**Blocker rule applied:** OR-L5 is a discrepancy passer that is green for the wrong reason
→ automatic blocker (blocker 1). OR-S2's vacuous grant/retry half means its title behavior
("a retried spawn never mints a second grant") has no oracle → blocker 3. OR-E1/OR-E2 are
legitimately green; no blocker.

## §2 — Coverage map: contract clause / amendment / refusal code / surface → test

### O-1 — the ladder
- Map tier exists, ≤2KiB, freshnessDigest, coverage, module rollup w/ moduleDigest + curated fields → **OR-L1** (red ✓)
- Closed leaf union (`generated` typed-only / prose `{text, provenance, untrusted:true, sourceRef}`), one framed renderer → **OR-L2** (red ✓; teeth flags T-2/T-3: leaf loop vacuous until modules carry `leaves`; renderer-REJECTION of unknown fields/unframed prose **UNTESTED**)
- Hub-derived scope, constant refusal before existence check → **OR-L3** (red ✓, sound composition: identical-code differential + in-scope positive control)
- Detail descends from live citation; `mergeAuthority:false, verificationAuthority:false` → **OR-L4** (red ✓; **range-containment proof UNTESTED** — no leg requests a range outside the citation's admitted scope)
- Region ≤4KiB, `needs_resume` + cursor over `{packDigest, pageOffset, freshnessDigest, scopeDigest}` → **OR-L5** (FALSE GREEN — blocker 1)
- **`moduleKey` derivation rule (deepest supported package root / first segment / `.`) → NO TEST**
- Map entry points / hot paths / suite-test-pairing ownership → OR-L1 weakly (any ONE of `purpose`/`entryPoints`/`ownership` satisfies :302)

### O-2 — investigation receipts
- `context.read` class, ZERO weight, never `minScratchReaders` → **OR-E1** (green, legitimate) + lane half **OR-L6** (red ✓)
- Exactly one receipt per identity tuple; replay mints nothing → **OR-L6** (red ✓) / replay+conflict store mechanics → **OR-E2** (green, legitimate)
- `context_read_conflict` → **OR-E2** ✓
- Per-attempt receipt COUNT ceiling, refuse BEFORE append → **OR-E3** (red ✓; **per-attempt BYTE ceiling and PROPOSAL ceiling UNTESTED** — E3 exercises only `maxReceiptsPerAttempt`, never `maxReceiptBytesPerAttempt`/`maxProposalsPerAttempt`; refusal code unpinned — any typed string passes :758)
- `orientation.candidate.propose({packDigest, leafDigest})` → partially: mint path tested only via the overlay trigger (OR-E5, invented API `proposeOrientationCandidate`); **the `orientation.leaf_proposed` MINT path, the prior-receipt verification ("proposing attempt previously received it"), and duplicate coalescing by `{leafDigest, freshnessDigest}` → NO TEST**
- `orientation.leaf_proposed` admission through orchestrator/operator gate ONLY → **OR-E4** (red ✓, two live controls)

### O-3 — freshness
- Base read from immutable git object tree + `{repoId, baseTreeSha, indexEpoch, baseInputsDigest}` as ONE attested record → **OR-F1** (red ✓; teeth flag T-9: checks result provenance fields only — persistence-as-one-record and read-from-git-tree (vs mutable dir) unverified)
- Serve gate `orientation_base_stale` → **OR-F2** (red ✓, sound: positive control + post-move refusal)
- Resume gate (`effective_tree_changed` / `orientation_base_stale`) → **OR-F3** (red ✓, sound: pinned-tree control + post-move refusal)
- **Production-time worktree fence (capture fence before scan, compare before publish, refuse `effective_tree_changed`, publish NO pack) → NO TEST**
- **Reverify gate freshness re-check ("Serve, reverify, and resume ALL") → NO TEST**
- No timestamp/TTL/cadence → OR-S3 intends it; pin is staged-wrong (blocker 2)

### O-4 — generated-with-curation-overlay
- KG `Source` per `{repoId, moduleKey, moduleDigest, freshnessDigest}`; overlay candidate observed + `orientation.overlay_proposed` + `Cites` edge → **OR-E5** (red ✓)
- Stale leaf omitted with `overlayOmissions:[{reason:'overlay_dangling'}]`, answer serves `partial`, generated structure still serves → **OR-E5** (red ✓; teeth flag T-10: the "generated still serves" assertion `JSON.stringify(...).length > 2` is near-vacuous — an empty-object error result passes)
- **Positive application leg (a curated leaf whose moduleDigest/freshness EXACTLY match MUST apply) → NO TEST**
- **`overlay_conflict`: multiple live curated leaves without a live `Supersedes` winner omit ALL conflicting values; never by event time/insertion order → NO TEST**

### O-5 — citation vs continuation vs grant
- Copied cursor fails authorization with constant scope refusal BEFORE existence lookup → **OR-C1** (red ✓; teeth flag T-11: no same-row positive control, and the "other attempt" is proxied by a different overlay — a freshness-refusal mislabeled as a scope refusal passes)
- Transport strips host paths (`{kind, handle, digest, bytes, mediaType}` only) → **OR-C2** (red ✓, sound exact-key-set pin)
- `needs_resume` honesty, deterministic lossless pages → **OR-C3** (pin, green, SOUND)
- Digest-verified loads (`invalid_cursor` / `result_integrity`) → **OR-C4** (pin, green, SOUND — but blocker 5 brittleness)
- `orientation_artifact_retired` (never unknown_cursor/empty/regenerated) → **OR-C5** (red ✓; same refs[0].path brittleness)
- `orientation_storage_exhausted` BEFORE write → **OR-C6** (red ✓; teeth flag T-12: no positive control — a hair-trigger implementation that refuses the FIRST write passes)
- **Reachability roots (live pack heads, brief citations, event evidence, KG citations) and deterministic reclamation → NO TEST** (C5 simulates reclamation with `rmSync`)

### O-6 — spawn-time L0 + mid-turn pull
- L0 cited into EVERY brief, framed, never spliced into objective, pathScope-scoped → **OR-S1** (red ✓; teeth flag T-13: scope tooth is only `'lane-c'` absence; splice check covers `brief.goal` only)
- Spawn head-CAS `context_pack_stale`, live head spawns → **OR-S2** (green, legitimate CAS half)
- Retried spawn never double-grants; grants attempt-scoped → OR-S2 VACUOUS legs (blocker 3); **ordering artifact-write → atomic grant+spawn append → dispatch, crash-window semantics, pack-byte dedup across workers with attempt-scoped grants, same-key/different-scope refusal → NO TEST**
- `context_pack_expired` not imported → OR-S3 (staged-wrong pin, blocker 2)

### O-7 — closed rating event
- `orientation.rating_recorded` minted, hub-derived closed payload incl. `grantOrReadEventSeq` → **OR-L7** (lane, red ✓) + **OR-E6** (store, red ✓; teeth flag T-14: the fixture INJECTS the attempt via `auth.attempt` — hub-derivation is unenforced at store level; only the unknown-digest leg of the constant refusal is exercised)
- Constant `orientation_rating_refused` (invisible/unknown/stale-task/out-of-scope) → **OR-L7**, **OR-E6** (red ✓)
- Identity `{taskId, taskVersion, packDigest}`: exact replay returns prior; opposite second rating refuses `orientation_rating_conflict`; at most one rating → **OR-E7** (red ✓, sound shape)
- Ratings never gate serving → **OR-L7** (red ✓, reread leg)
- **Aggregates advisory inside a fixed deployment precompute count/byte budget; never touch scope/freshness/verification/promotion → NO TEST**
- **Closed-payload rejection of caller-supplied extra fields → NO TEST**

### O-8 — answer-time availability
- `orientation_unavailable` when `supportedFiles===0`, citable, coverage-carrying → **OR-A1** (red ✓)
- Per-answer availability (no frozen deployment-time label over non-empty results) → **OR-A2** (red ✓)
- `partial` labeling + coverage counts (`unsupportedFiles`, `parseErrorFiles`, `parseErrorCount`) → **OR-A3** (red ✓, exact-count teeth)
- **Curated leaf on an unsupported-only module does not upgrade availability → NO TEST**
- **Coverage preserved in the PACK (L1/A-rows check the answer payload only) → NO TEST**

### Campaign law / farm guard
- Reads never TG2/TG3 progress → **OR-T1** (pin, green, SOUND)
- No clock/TTL anywhere in orientation → OR-S3 (staged-wrong, blocker 2); **no turn-count limits → NO TEST**

### Refusal-code ledger
Covered: `context_read_conflict` (E2 ✓green), `orientation_base_stale` (F2/F3),
`effective_tree_changed` (F3 alt), `context_pack_stale` (S2 ✓green),
`orientation_artifact_retired` (C5), `orientation_storage_exhausted` (C6),
`orientation_rating_refused` (L7/E6), `orientation_rating_conflict` (E7),
`orientation_unavailable` (A1), `overlay_dangling` (E5), constant scope refusal (L3/C1),
`invalid_cursor`/`result_integrity` (C4 ✓green), `needs_resume` honesty (C3 ✓green).
**NOT covered: `overlay_conflict`; the E3 ceiling refusal code is unpinned (any typed
string passes); `context_pack_expired` absence pinned by a staged-wrong grep.**

## §3 — False-green hunt: verdict per passer

- **OR-L5 — STAGED-WRONG (blocker 1).** Passes on the `context_read_invalid` refusal
  receipt: exactly one result (refused reads are receipted, coordinator.mjs:11583-11587),
  no `ok` assertion anywhere in the row, boundedness satisfied by the refusal payload, and
  the `needs_resume` block is conditional and skipped. A row that greens while the region
  tier does not exist is a false green by definition.
- **OR-C3 (pin) — SOUND.** Real truncation (budget 60 → `needs_resume` asserted :565),
  cursor shape regex :566, resume completes :568, and `deepEqual([...page.payload,
  ...resumed.payload], full.payload)` :569 is a genuine lossless/deterministic pin: a
  tail-dropping, non-deterministic, or non-resuming implementation fails. Contract-kept
  behavior (atlas-index.mjs:406-427) exercised end-to-end.
- **OR-C4 (pin) — SOUND today, brittle at C2-time (blocker 5).** Forged handle/digest →
  `invalid_cursor` (:584) and tampered bytes → `result_integrity` (:588) are real
  integrity teeth. Brittleness: the tamper channel is `writeFileSync(page.refs[0].path)`
  (:585) — the very `path` field OR-C2's contract-correct implementation removes. When C2
  goes green, this pin false-reds on `undefined` path. (OR-C5 :599 has the same
  dependency, but it is red anyway.)
- **OR-S2 — WEAK (blocker 3).** CAS half sound and legitimately green (stale citation →
  `context_pack_stale` coordinator.mjs:3568; live-head positive control :660-664 would
  catch a refuse-everything implementation). Grant/retry half vacuous: grants snapshotted
  before the retry (:665 vs :666), the retry assertion is a tautology (:670), and no
  grant event kind exists in `impl/src/` to count.
- **OR-E1 — SOUND.** Green because the class legitimately exists (§1). Discriminates: if
  `context.read` fed the scratch-reader derivation, the `fact:orientation-only` fact
  (owner task a, read by w-b, `minScratchReaders:1`) would derive a `scratch.cited_observed`
  row and fail :720; the live positive control (:699-701) proves the fixture's promotion
  path works. Note (not a hole): only the `scratch.cited_observed` channel is watched — a
  hypothetical wrong implementation inventing a NEW derivation trigger for context.read
  would pass, but that violates "zero weight" in a way no plausible shortcut produces.
- **OR-E2 — SOUND (shallowness noted).** Replay-returns-prior + no-append +
  `context_read_conflict` all exercised against the real implementation. Shallowness:
  keys are caller-chosen, so the contract's hub-derived-tuple identity ("at most one per
  tuple" regardless of key) is untested — same tuple under a second key would double-mint
  undetected (T-8).
- **OR-T1 (pin) — SOUND.** Both controls live: the TG3 cycle arms on turn_completed with
  unmet effects (:927) and settles on a genuine turn_started (:933-936). The middle leg has
  real teeth against the actual machinery: `_steeringEvidenceQualifies`
  (coordinator.mjs:2157-2175) admits ONLY `turn_started` / new-digest `scratchpad` /
  resolved `interaction`, and the `context.read` wire case deliberately mints no steering
  observation (comment + code, coordinator.mjs:11578-11583). An implementation that
  admitted read receipts as progress would clear the pause and fail.

## §4 — Teeth check on red rows (would a plausible WRONG implementation fail?)

Flags (rows not listed have adequate teeth):

- **T-1 (OR-L1):** pins shape, not derivation. A stub answering `ok:true` with a fabricated
  tiny module (`{moduleDigest:'a'×64, purpose:'x'}`), any 64-hex `freshnessDigest`, zeroed
  coverage, and a `packDigest` key greens every assertion with no ATLAS derivation, no real
  digest computation, and no real coverage counts. Acceptable as a first-rung shape pin;
  the derivation teeth live in F1/F2 — but be aware the lane row alone is shallow-greenable.
- **T-2 (OR-L2):** the closed-union loop iterates `module.leaves ?? []` — vacuous for any
  answer whose modules lack a `leaves` array; only the final UNTRUSTED-in-prompt assertion
  bites. The renderer-REJECTION half (unknown fields, unframed prose rejected at the
  provider seam) has no oracle at all.
- **T-3 (OR-L2):** `delivered` matches ANY prompt containing the substring `UNTRUSTED`
  (:326) — stamping the token into unrelated content satisfies the "only-path proof"
  without framing the answer (same hole class as bidirectional-v3 A1).
- **T-8 (OR-E2):** caller-keyed replay ≠ hub-derived tuple identity (see §3).
- **T-9 (OR-F1):** checks the build RESULT's provenance fields, not that the record
  PERSISTS as one attested unit, nor that the base bytes were read from the git object tree
  rather than a mutable directory. An on-the-fly `rev-parse` stub passes.
- **T-10 (OR-E5):** `generatedStillServes` asserts JSON length > 2 — near-vacuous; an
  implementation returning `{status:'partial', overlayOmissions:[...]}` with NO generated
  structure passes. No positive-application leg, no `overlay_conflict` leg (§2 gaps).
- **T-11 (OR-C1):** no in-row positive control (a same-scope resume succeeding); an
  always-refuse implementation passes both legs. Composition with OR-C3 covers the positive
  path today, but after O-5 re-authorization lands C3's resume leg could change shape —
  keep an explicit positive control. Also the foreign "attempt" is proxied by overlay
  content, so a freshness refusal mislabeled as a scope refusal passes.
- **T-12 (OR-C6):** the loop accepts the FIRST refusal — a hair-trigger implementation that
  refuses every write (never admitting anything) greens the row. Needs a positive control
  that writes below the ceiling succeed, and an assertion that the refusal fires only once
  the ceiling is actually crossed.
- **T-13 (OR-S1):** scope tooth is `!JSON.stringify(grant).includes('lane-c')` — a
  repo-global or wrong-region map that never mentions `lane-c` passes; splice check covers
  `brief.goal` only (constraints/other fields unguarded); the `grant` field-name probe
  (`orientation ?? contextPacks ?? packs`) constrains the implementer to three names the
  contract never chose (see §5 drift).
- **T-14 (OR-E6/E7):** the fixture injects the "hub-derived" attempt through
  `auth.attempt` — a store implementation trusting caller-supplied attempt identity passes;
  hub-derivation is only genuinely tested by the (red) lane row OR-L7. Only the
  unknown-digest leg of the constant refusal is exercised (invisible / stale-task /
  out-of-scope modes are folded into one code but never differentiated).
- **T-15 (OR-L6):** counts events only. The landed coordinator mints
  `{runId, taskId, workerId, kind, queryDigest, resultDigest}` (coordinator.mjs:10267-10273)
  — the contract tuple `{repoId, runId, taskId, taskVersion, workerId, op,
  normalizedQueryDigest, packDigest, freshnessDigest}` is a DIFFERENT shape. Once the code
  lane answers, L6 greens on the landed shape with the contract's pack/freshness coordinates
  never asserted.
- **T-16 (OR-E3):** refusal code unpinned (`typeof refusal === 'string' && !==
  'unknown_error'` :758) — a `TypeError` name passes; byte/proposal ceilings unexercised.

## §5 — Drift findings (suite header / invented surfaces vs contract-adopted names)

1. **The header documents NO invented surfaces.** The suite commit (`5c2d729`) claims
   "invented surfaces documented in suite headers for implementers"; grep finds zero
   occurrences of "invented" (or any surface note) in this file's header. The invented
   names implementers must guess at: `store.recordContextRead` (landed, matches BD3-A),
   `store.recordOrientationRating` + `auth.attempt` transport, `store.mintOrientationSource`,
   `store.proposeOrientationCandidate`, `store.mergeOrientationMap`,
   `orientationReceiptCeilings {maxReceiptsPerAttempt, maxReceiptBytesPerAttempt,
   maxProposalsPerAttempt}`, `maxOrientationStorageBytes`, the `orientation.rate` wire kind,
   and OR-S1's brief-field probe (`orientation`/`contextPacks`/`packs`). **None of these
   names comes from the contract** — the contract adopts event kinds, triggers, and refusal
   codes, not store APIs. Fix: add the invented-surface list to the header (as the sibling
   suites did).
2. **Field-name drift:** the suite's receipt tuple uses `queryDigest`; the contract's O-2
   tuple says **`normalizedQueryDigest`**. Implementers will trip (T-15 compounds it: the
   landed BD3-A mint shape differs from both).
3. **Stale stage note:** the O-1 section header (suite :275-278) says a wire `context.read`
   "falls through to the default branch today and is appended verbatim with no answer" —
   false since `726e34a`: the lane exists, admits a closed wire shape, and refuses unknown
   kinds with `context_read_invalid` (coordinator.mjs:10236-10257, :10345, receipts at
   :11583-11587). The rows still red for the right ultimate reason (`code` kind missing),
   but the stated mechanism is a tree-state lie that will mislead failure-triage.
4. **Header row count wrong:** "Twenty-eight rows" (suite :4) — the suite has **30**.
5. **Contract line-cite drift (minor, informational):** `KNOWLEDGE_CANDIDATE_TRIGGERS` is
   at coordination-store.mjs:15628 (contract says :15477-15482); the workflow-admission
   trigger check is at :14669 (contract :14630). Behavior matches; line numbers moved.
6. **OR-S2 uses adopted names correctly** (`mintContextPack`/`contextPackHead` match the
   landed BD3-B API and the bidirectional-v3 contract's adopted surface) — no drift there;
   `spawn(vendor, brief, opts)` (coordinator.mjs:3978) accepts the `opts.taskId` the retry
   leg passes.

## §6 — Closing verdict

**NOT-READY.** The red half is honest (22/23 at named stages), three of seven passers are
sound, and two discrepancy greens are legitimate post-spine behavior. But the suite carries
one automatic-blocker false green, one pin that a contract-correct implementation can never
turn green, one passer whose title behavior has no oracle, a forward pin/fixture collision,
and a set of acceptance-pinned contract behaviors with no test at all.

### Blockers

1. **OR-L5 false green (automatic).** *What:* the row passes on a `context_read_invalid`
   refusal receipt — no `ok:true` assertion, refusal payload trivially satisfies the 4KiB
   bound, `needs_resume` block conditional-and-skipped. *Why:* a discrepancy passer green
   for the wrong reason; the region bound + cursor shape have zero oracle. *Fix:* assert
   `payload.ok === true` and a region object before the bound; force a >4KiB region in the
   fixture (multi-module repo with enough structure) and assert `status === 'needs_resume'`
   + `cursor`/`freshnessDigest`/`scopeDigest` UNCONDITIONALLY on that fixture.
2. **OR-S3 staged-wrong pin.** *What:* greps 4 source files for `context_pack_expired`,
   which legitimately exists since BD3-B landed (coordination-store.mjs:12977).
   *Why:* the fold forbids the clock in THIS epic's packs, not in BD3-B's own machinery;
   the pin cannot green under any contract-correct stack → permanent false red at gate
   time. *Fix:* re-scope to orientation's non-use of the clock — e.g., assert the
   orientation-map pack family is minted without a finite `validity` window and that no
   orientation serve/resume path calls `materializeContextPack`'s expiry branch (grep the
   orientation producer module once it exists, keeping the row red until then).
3. **OR-S2 vacuous grant/retry half.** *What:* grants snapshotted before the retry (:665
   vs :666); retry assertion tautological (:670); no grant event kind exists to count.
   *Why:* the row's title ("a retried spawn never mints a second grant") and O-6's
   retry-identity amendment have no oracle; a double-granting implementation greens.
   *Fix:* define the grant event kind in the suite's invented-surface contract, count
   grant events for the attempt AFTER the retry, assert exactly one, and make the retry
   outcome exact (`=== 'spawned'` for same-attempt replay or one named typed refusal).
4. **Acceptance-pinned behaviors with no test.** *What:* O-3 production fence
   (capture/compare/publish + `effective_tree_changed` with NO pack published); O-3
   reverify gate; O-4 `overlay_conflict` + `Supersedes`-winner + positive overlay
   application; O-2 per-attempt BYTE and PROPOSAL ceilings, prior-receipt verification,
   duplicate-proposal coalescing, `orientation.leaf_proposed` MINT; O-1 renderer-rejection
   and detail range-containment legs; O-6 spawn ordering/crash windows/byte-dedup/
   same-key-different-scope; O-7 precompute-budget advisory bound; O-8
   curated-leaf-on-unsupported-module and coverage-in-pack. *Why:* the contract's
   red-first acceptance section names each of these; the implementation wave could land
   "contract-complete" code that violates any of them with the suite fully green.
   *Fix:* add rows (or explicit legs in existing rows) for each; at minimum the
   acceptance-section items: production fence, reverify gate, `overlay_conflict`, byte
   ceiling, containment leg, renderer-rejection leg, spawn ordering/dedup.
5. **Pin/fixture collision on `refs[0].path`.** *What:* OR-C4 (:585) and OR-C5 (:599)
   tamper/reclaim through the worker-visible `path` field that OR-C2's correct
   implementation deletes. *Why:* the moment C2 lands, two more rows false-red — the suite
   cannot be green end-to-end through the implementation wave. *Fix:* reach the artifact
   bytes via the fixture's own `artifactRoot` + the ref digest (the `art:sha256:<digest>`
   handle and artifact layout are fixture-deterministic), not via the ref's `path` key.

### Non-blocking notes

Teeth flags T-1..T-16 (§4), coverage gaps beyond the acceptance-pinned set (§2: moduleKey
derivation, reachability roots, closed-payload rejection, turn-count law), and the header
drift items (§5: invented-surface list missing, `queryDigest` vs `normalizedQueryDigest`,
stale stage note, "Twenty-eight rows") should be folded when the blockers are fixed.
