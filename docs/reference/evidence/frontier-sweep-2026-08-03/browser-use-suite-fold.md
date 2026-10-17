# Fold: browser-use blue-team findings → red suite (#85) — 2026-08-03

(Authority: `./browser-use-blueteam.md`. Edit targets: `impl/test/browser-use-red.test.mjs`
and the two drift items in `./browser-use-contract.md`. Verified against `impl/src/` at the
same HEAD the blue team used; NUL-containing files (coordinator.mjs, coordination-store.mjs,
application.mjs) inspected via `grep -an`/`sed -n` only. Run from repo root:
`node --test impl/test/browser-use-red.test.mjs`, node v25.8.0.)

## Split

| | tests | red (fail) | pins (pass) |
|---|---|---|---|
| Before (blue-team measurement, commit `5c2d729`) | 32 | 27 | 5 |
| After this fold | **37** | **32** | **5** |

Passing pins (all green for legitimate, already-shipped reasons): BU-2-1-pin,
BU-2-1-TG5-pin, BU-2-3-pin, BU-2-4-pin (restaged — see blocker 4), BU-1-pin. Every red row
was observed failing AT its named stage after the fold (run output checked row by row);
no row was weakened to pass.

Red-stage map after the fold:

| Stage | Rows |
|---|---|
| `impl/src/browser-use.mjs` missing (`ERR_MODULE_NOT_FOUND`) | 19 — BU-0-1, BU-0-2, BU-0-3, BU-0-2-1..3, BU-2-2-1, BU-2-2-3..7, BU-2-3-1, BU-2-3-2, BU-2-3-4, **BU-2-3-8**, BU-2-4-1, BU-1-1, BU-1-2 |
| `optionalDependencies` missing in impl/package.json | 3 — BU-0-4, BU-0-5, **BU-0-6** |
| `analysis` pass-through / contradiction-refusal holes (goal-plan.mjs, messages.mjs) | 4 — BU-2-1a-1, BU-2-1a-2, BU-2-1b-1, BU-2-1b-2 |
| `deploymentGoalPlanAuthority` not exported | 1 — BU-2-1c |
| `'capability_op'` evidence kind missing | 1 — BU-2-2-2 |
| `readScratch` framing missing (coordination-store.mjs:13290) | 1 — BU-2-3-3 |
| message delivery-seam framing missing (coordinator.mjs:6618) | 1 — **BU-2-3-5** |
| `boardSnapshot` web framing missing (coordination-store.mjs:14110-14117) | 1 — **BU-2-3-6** |
| Finding-body framing missing at `queryKnowledge` | 1 — **BU-2-3-7** |

## Blocker 1 — BU-2-2-6 dead-export normalization (T5)

**Changed:** BU-2-2-6 restaged. The pure-function pins (`?t=1`/`?t=2` → one invocation;
empty params stripped) are kept, but the row no longer hand-normalizes and hands
pre-normalized args to `registry.invoke`. It now drives the RAW pair under one idempotency
key through the suite-pinned production seam `coordinator.invokeCapability` and asserts:
no `capability_idempotency_conflict`, a `capability.op.replayed` receipt, exactly one
engine call. This has teeth precisely because the shipped registry binds
`{repoId, actor, idempotencyKey}` BEFORE `capability.invoke` runs
(capability-registry.mjs:156-168) and treats same-key/different-args as a conflict refusal
(:217-233) — so only normalization wired ahead of the binding turns the pair into a
replay; an exported-but-unwired `normalizeBrowserUseUrl` now fails the row. The suite
header gained a NAMED WIRING SITES block stating this and the remaining T4 gap (the
`onFetchReceipt → _observeSteeringCycle` production subscription is still
fixture-injected; the deployment-assembly site is the epic's one piece of new wiring to
ship — no suite oracle is possible until the epic pins that surface).
Red stage unchanged: `ERR_MODULE_NOT_FOUND` (module missing precedes the wiring asserts).

## Blocker 2 — BU-0 Amendment B pack smoke

**Added row BU-0-6** (`npm pack → clean-install smoke`, 180s timeout, mirrors PKG-2's
MP14/MP15 pattern keyed to the new dep): packs with `npm pack --json --pack-destination
<tmpdir>` (never pollutes the repo tree), asserts no packed file path carries the engine
name and no `node_modules/` entries exist (bundling would smuggle it), extracts
`package/package.json` from the tarball and asserts the engine is absent from
`dependencies` and `bundledDependencies`, then clean-installs the tarball into a tmpdir
(`--omit=dev --omit=optional` — the engine itself is never fetched; no network beyond the
pack and the registry's ordinary hard-dep fetch, exactly as MP15) and asserts the engine
materializes nowhere under the install's `node_modules` (a leak into the hard closure
would install it → red). Fails today at the named stage `exactly one optionalDependencies
entry — the engine (stage: optionalDep missing)` (0≠1) before any npm subprocess runs —
hermetic pre-implementation. The "reports empty honestly, nothing else degrades" half of
Amendment B stays pinned by BU-0-2/BU-0-3 by construction (noted in the row).

## Blocker 3 — no-second-door scan, surfaces 4-6 + coordinator seam

Four rows added, completing the acceptance's six-surface scan (payload BU-2-3-2 ✓, scratch
read BU-2-3-3 ✓, artifact read BU-2-3-4 ✓ already existed):

- **BU-2-3-5 (a message).** Walks quoted extract (attack marker + `SECRET_SHAPED_TEXT` +
  control char + `art:sha256:` handle) into a worker-bound message via the shipped
  `coordinator.sendMessage` lane and asserts on the delivered prompt content: framed
  (never filtered), wrapped in `UNTRUSTED_WEB_CONTENT` at the delivery seam, credential
  shape redacted, control char stripped. Fails today at the named stage: only
  `[MESSAGE inform — UNTRUSTED]` applies at coordinator.mjs:6618.
- **BU-2-3-6 (a board item).** `postBoardItem` detail quoting the same material →
  `boardSnapshot` read must carry the web frame + redaction + control-char strip. Fails
  today: boardSnapshot frames `UNTRUSTED_WORKER_TITLE` only
  (coordination-store.mjs:14110-14117).
- **BU-2-3-7 (the Finding body).** `promoteKnowledgeNode` Finding whose body quotes the
  extract (6 KB) → `queryKnowledge` read must frame, redact, and apply the 4_096
  per-finding-quote cap (TAIL-MARKER cut). Fails today: bodies return raw.
- **BU-2-3-8 (the coordinator-side wrap seam).** Fetch through
  `coordinator.invokeCapability` → relay the result's framed excerpt to a spawned worker
  via `sendMessage` → the delivered content carries the marker, no secret, and **exactly
  one** `UNTRUSTED_WEB_CONTENT` occurrence — the contract's single-seam amendment (never
  stripped, never doubled by a parallel route). Fails today at `ERR_MODULE_NOT_FOUND`
  (the capability's framed field is the seam's input — the honest stage).

All three store/coordinator-level rows use the readScratch fold's trigger convention (the
body references a `web_fetch` artifact handle) and keep the family's framed-not-filtered
posture (attack marker must still be present). Fixture hygiene: the control-char fixture
bytes are written as `\u0007` escapes (a raw BEL byte was normalized out of the new rows).

## Blocker 4 — contract drift (D1/D2)

**(a) D1 replay keying — contract corrected to the shipped binding.** The BU-2-2 boundary
clause now reads: identity keyed on `{repoId, actor, idempotencyKey}`
(capability-registry.mjs:156-168); an identical re-invoke under the same identity replays
pre-network (`capability.op.replayed`, :244); same identity with different args is a
`capability_idempotency_conflict` refusal (:217-233) — explicitly noting a same-URL
re-fetch MUST use a fresh key (which is what BU-2-4-1 relies on, killing the
implementer trap). Aligned the two-layer dedup paragraph and the acceptance bullet
("identical re-invoke under the same idempotency identity"). Suite-side, BU-2-2-4's
assertion message now names the identity keying (its behavior already reused one key —
no logic change).

**(b) D2 stale self-read dependency — recorded LANDED, row restaged.** Contract BU-2-4's
"hard dependency … is RED in this tree" paragraph is rewritten: BD3-A landed in `726e34a`,
the exclusion ships at coordination-store.mjs:14521-14526 (author task never satisfies
`minScratchReaders` alone), A6b (`bidirectional-v3-red.test.mjs:253-290`) is green; the
acceptance bullet and the self-citation red-team target say the same. BU-2-4-pin was
restaged to ASSERT the landed behavior in composition: the author task (`research`, a
completed verified-outcome reader in every respect except authorship) reads its own fact →
promote → no `scratch.cited_observed` candidate; then the independent qualifying reader
reads → promote → the Finding mints with `grounding:'observed'`. The pin stays green for
the legitimate landed reason and would fail if the exclusion regressed.

## Blocker 5 — BU-0-5 non-recursive eager-import scan (T2)

**Changed:** the scan is now `readdirSync(srcRoot, { recursive: true })` over the whole
`impl/src` import graph (the `browser-use.mjs`/`browser-qa.mjs` exclusion is by basename,
so it holds at any depth); `impl/src/program-ir/` no longer escapes. Red stage unchanged
(optionalDep-missing assert precedes the scan).

## BU-2-1-TG5-pin (P2) — documented, not strengthened (with reason)

The blue team proved the weakness is structural, not accidental: the gate evaluates
`required_effect` only when `requiredEffects` includes `repository_edit`
(coordinator.mjs:11955), so the flag is load-bearing only for the combination
`analysis:true` + `repository_edit` — which amendment (b) makes unmintable at BOTH
construction sites (BU-2-1b-1/BU-2-1b-2). Any row built on that combination turns
fixture-red the day the implementation lands. The row therefore keeps its real content
(no-diff completes + `path_scope` at full strength) and now carries an in-row note stating
exactly this, and naming where the flag's arrival IS load-bearing and pinned: BU-2-1-pin,
BU-2-1a-1, BU-2-1a-2. Stays green (verified: 2.2s, both legs exercised).

## Rejected / deferred items (with reasons)

- **T3** (BU-0-2-2/3: assert a typed refusal code, not `'thrown'`) — deferred to the wave
  (report: non-blocking). The constructive half (`engine.calls === 0`, pre-network) is the
  real oracle and holds; the registry mints `capability.op.refused` for any throw, so the
  code half is weak but not a false-green on the named behavior.
- **T4** (`onFetchReceipt` production subscription unobserved) — partially addressed:
  named in the suite header as the remaining wiring site. No new oracle is possible until
  the epic pins the deployment-assembly surface that constructs the capability; adding a
  row against an invented assembly API would be suite-pinned speculation, deferred.
- **T6** (script tag in BU-2-3-1's page) — deferred (non-blocking): the no-raw-HTML
  property is covered in composition by BU-2-3-2's script-laden page; BU-2-3-1's byte/
  digest/mode checks are unaffected.
- **T7** (KG-side `Supersedes` edge row for BU-2-4-1) — deferred (non-blocking): receipt-
  level freshness is pinned; the KG edge wiring has no shipped seam to drive red-first
  beyond receipt decoration today.
- **T8** (BU-1-2 receipt-reference assertion) — deferred (non-blocking): the contract's v1
  bar ("format exists and is exercised by a test") is met; the row undersells its title.
- **Report notes without rows** (SPA honest-degrade, followLink success/redirect-chain
  semantics, `needs_resume` cursor pressure valve, subgoal-citation eval-able control,
  NFKC/orphaned-artifact minors) — not blockers; deferred to the implementation wave or
  later rungs as the report itself classifies them.
- **D3 line-citation refresh** — done only where this fold already touches the text
  (BU-2-3 section header :13290, BU-2-4-pin :14519/:14532, TG5-pin :11955, the contract's
  replay clause and header note). The remaining cosmetic drift is left as-is (report:
  cosmetic; the named functions all verified present).

## Verification

- `node --check impl/test/browser-use-red.test.mjs` — clean.
- `node --test impl/test/browser-use-red.test.mjs` (repo root) — `tests 37 / pass 5 /
  fail 32`; every new and restaged red row's failure message inspected: BU-0-6 at the
  optionalDep-missing stage (0≠1, no npm subprocess runs), BU-2-3-5 at the delivery-seam
  stage, BU-2-3-6 at the boardSnapshot stage, BU-2-3-7 at the queryKnowledge stage,
  BU-2-2-6 and BU-2-3-8 at `ERR_MODULE_NOT_FOUND`; BU-2-4-pin (restaged self-read leg) and
  BU-2-1-TG5-pin green.
- Shipped seams re-verified before resting rows on them: registry identity/conflict
  (capability-registry.mjs:156-168, :217-233, :244), `invokeCapability` (:9899) and
  `_assertOperational` (:1545, no spawn prerequisite), `sendMessage` framed delivery
  (coordinator.mjs:6577-6618, body ≤ 2048), `postBoardItem`/`boardSnapshot`
  (coordination-store.mjs:13943, :14110-14117, detail ≤ 4_096), `promoteKnowledgeNode`/
  `queryKnowledge` (:14919; no body byte cap; `observed` Finding needs no evidence),
  BD3-A self-read exclusion (:14521-14526), TG5 gate condition (coordinator.mjs:11955).
