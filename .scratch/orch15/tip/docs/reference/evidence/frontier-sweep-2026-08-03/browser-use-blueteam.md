# Blue-team: browser-use red suite (#85) — adversarial verification

(Target: `impl/test/browser-use-red.test.mjs` — 32 rows: BU-0 ×5, BU-0-2 ×3, BU-2-1 ×6
(incl. 2 pins), BU-2-2 ×7, BU-2-3 ×5 (incl. 1 pin), BU-2-4 ×2 (incl. 1 pin), BU-1 ×3
(incl. 1 pin). Verified against the v1.0 post-fold contract
`docs/reference/evidence/frontier-sweep-2026-08-03/browser-use-contract.md` and `impl/src/`
ground truth at HEAD `5c2d729` (NUL-containing files — coordinator.mjs,
coordination-store.mjs, application.mjs — inspected via `grep -an`/`sed -n` only),
2026-08-03. Suite run from repo root: `node --test impl/test/browser-use-red.test.mjs`,
node v25.8.0.)

Verdict scale: **SOUND** = red for the named stage today, green only on a contract-correct
implementation, and a wrong implementation cannot pass it. **WEAK** = correctly staged and
discriminating in composition, but a named wrong implementation can pass it (false-green
hole). **VACUOUS** = passes without exercising the named behavior. **STAGED-WRONG** = the
row's red/green state does not track the named contract behavior.

## 0. Run record (exact counts)

```
ℹ tests 32
ℹ pass 5
ℹ fail 27
```

Passing (the 5 pins): BU-2-1-pin, BU-2-1-TG5-pin, BU-2-3-pin, BU-2-4-pin, BU-1-pin.
Failing (the 27 red rows): everything else. **The measured 27 red / 5 green split matches
the declared split in commit `5c2d729` exactly — no divergent test, reconciliation
trivial.** Every red row fails AT its named stage, none earlier (fixture bug) or later:

| Stage named by the row | Rows | Observed failure |
|---|---|---|
| `impl/src/browser-use.mjs` does not exist | BU-0-1, BU-0-2, BU-0-3, BU-0-2-1, BU-0-2-2, BU-0-2-3, BU-2-2-1, BU-2-2-3, BU-2-2-4, BU-2-2-5, BU-2-2-6, BU-2-2-7, BU-2-3-1, BU-2-3-2, BU-2-3-4, BU-2-4-1, BU-1-1, BU-1-2 (18 rows) | `ERR_MODULE_NOT_FOUND` on the dynamic import at the row's first line |
| `optionalDependencies` missing in impl/package.json | BU-0-4, BU-0-5 | `exactly one optionalDependencies entry` (0≠1) / `the engine optionalDependencies entry exists` |
| `analysis` pass-through missing at goal-plan.mjs:409-426 | BU-2-1a-1 | `brief.analysis` undefined ≠ true (verified absent from `buildAuthoritativeBrief` :409-427, `PLAN_BRIEF_FIELDS` :430-433, `semanticBriefCore` :435-446) |
| same hole, end-to-end | BU-2-1a-2 | `preview.brief.analysis` undefined ≠ true **after a fully healthy defineGoal→proposePlan→approvePlan→previewPlanDispatch chain (88 ms)** — fixture verified sound, failure is exactly the CONFIRMED-HOLE |
| contradiction mintable at messages.mjs:57-92 | BU-2-1b-1 | `validated.ok` true ≠ false (validateBrief verified to never mention `analysis`) |
| plan-node refusal missing at goal-plan.mjs:347-353 | BU-2-1b-2 | `Missing expected exception` (the one-way rule fires only when `repository_edit` is OMITTED, :352-353) |
| `deploymentGoalPlanAuthority` not exported | BU-2-1c | `typeof ... !== 'function'` (permit-all literal verified at application-deployment.mjs:1702) |
| `'capability_op'` not in `_steeringEvidenceQualifies` | BU-2-2-2 | first assert false≠true (shipped admits exactly `turn_started`/`scratchpad`/`interaction`, coordinator.mjs:2157-2177) |
| `readScratch` framing missing | BU-2-3-3 | result JSON contains no `UNTRUSTED_WEB_CONTENT` (readScratch :13290 returns raw fact bodies — failure diff shows the unframed payload) |

No fixture bugs observed in the red half. The three coordinator-level red rows whose
fixtures could not be exercised past the import failure (BU-2-2-3/4/5) use seams verified
to exist: `Coordinator` accepts `opts.capabilities` (:821), `pausedTurns({taskId})` (:2265),
`_workers`-keyed `_observeSteeringCycle` (:2179), `turn.settled` with
`payload.basis:'steering_answered'` (:2204-2205), and the `lifecycle.turn_completed` arming
pattern is the same one bidirectional-v3-red.test.mjs:303-312 exercises green today (A8).

## 0.1 Hermeticity

**Fully hermetic.** No test requires a real browser, network, or playwright install to
express its red: the engine is ALWAYS an injected fake recording its calls
(`fakeEngine`, :170-181), the DNS `lookup` is injected (:434), the only subprocess is
`git` run against `mkdtempSync` repos (:301-306, local), all artifacts/idempotency roots
live under `os.tmpdir()` with `test.after` cleanup (:76). The only row invoking the real
probe (`BU-0-3`, `mod.probeBrowserUseAvailability()`) accepts BOTH availability shapes
(:373) and the contract forbids the probe from touching a URL — so it is green with or
without the engine installed, by design. `package.json` is only read, never mutated.

## 1. Coverage map (contract clause → enforcing test)

### BU-0 — adapter posture
- Ordinary CapabilityRegistry entry, card names `browser.fetch`/`browser.followLink` → **BU-0-1**
- Honest-empty invoke (schema-valid ok, exact phrasing `browser engine not installed; honest empty browser-use result`, `provenance.engine:'honest_empty'`, never throws, never fakes) → **BU-0-2**
- Amendment A probe-once, constructor-injected availability authoritative, no per-invoke re-probe → **BU-0-3** (empty-wins-over-working-engine differential + positive control + probe shape)
- First `optionalDependencies` entry, never a hard dep, fetch+readability-class (not playwright/puppeteer) → **BU-0-4**
- No eager engine import outside the capability module → **BU-0-5** (see flag T2: non-recursive)
- **Amendment B (`npm pack` → clean-install smoke asserting the engine is absent from the packed `files`/dependency closure) → NO TEST anywhere** (BLOCKER 2). `impl/test/mcp-packaging-red.test.mjs` has PKG-2's smoke but it is keyed to `@ast-grep/napi`, not the browser engine.
- "Suite passes identically with and without the optional dependency" — inherent to the hermetic fake-engine design + BU-0-3's either-shape probe assertion; no explicit dual-environment run (acceptable by construction, noted).

### BU-0-2 — engine choice + SSRF fold
- Construction-time rejection: loopback (`127.0.0.1`), private (`10.x`, `192.168.x`, `172.16.x`), link-local (`169.254.x`), `[::1]`, ULA (`fd12::1`), `localhost`, `.local` → **BU-0-2-1** (all named classes + positive control)
- Pre-connect resolution check fails closed on rebinding, no connection, typed `capability.op.refused` receipt → **BU-0-2-2** (teeth flag T3)
- Off-allowlist `fetch` AND `followLink` refuse pre-network (discovered links not exempt) → **BU-0-2-3** (teeth flag T3)
- Fetch+readability not playwright-class → BU-0-4 `doesNotMatch` + BU-1-pin (dependency-level only; the positive engine shape is suite-pinned in the header, not behaviorally tested — acceptable)
- **SPA honest-degrade** (near-empty extract is an honest result, worker says so) → **NO TEST** (note)
- **Redirect chains** (`followLink` recursively follows server-side redirects only; meta-refresh/JS out of scope) → **NO TEST** — `browser.followLink` is never invoked successfully anywhere; only its refusal (BU-0-2-3) and card advertisement (BU-0-1) are exercised (note)

### BU-2-1 — research worker class
- Amendment (a): `buildAuthoritativeBrief` pass-through + `semanticBriefCore`/`planBriefMatches` binding → **BU-2-1a-1** (pass-through + digest-inequality + match positive/negative controls) and e2e **BU-2-1a-2**
- Amendment (b): `validateBrief` refusal (names both fields, `createBrief` throws `ValidationError`, positive control) → **BU-2-1b-1**; plan-node symmetric refusal with code `plan_required_effect_invalid` (matches the existing one-way rule's code, goal-plan.mjs:345,353 — verified) → **BU-2-1b-2**
- Amendment (c): deployment goal-plan authority denies worker principals `plan:propose`/`plan:approve`, owner keeps it → **BU-2-1c** (request vocabulary `plan_propose`/`plan_approve` matches the coordinator's own call sites, coordinator.mjs:3686,3690 — verified)
- TG5 unchanged + every other gate phase at full strength → **BU-2-1-pin** (direct-path free-ride + frozen) and **BU-2-1-TG5-pin** (no-diff completes; out-of-scope write fails `worker_path_scope_violation`). Only `path_scope` is exercised of the "every other phase" set — `forbidden_effect`/`environment`/`coverage` are existing-phase73 territory (note). See pin verdict P2.

### BU-2-2 — hub-admitted receipt + TG2 progress
- Registry receipt pair (`capability.op.started`/`completed`), digest-bound, `cost.underlying`, `web_fetch` ref → **BU-2-2-1**
- `'capability_op'` evidence kind with extract-digest dedup (fresh/dup/distinct/digest-less cases) → **BU-2-2-2** (fixture record shape `{steering:{digestSet,resolvedRequestIds}}` verified to match the real record's fields)
- Invoke-path wiring settles an armed cycle (`turn.settled`, `steering_answered`) → **BU-2-2-3** (teeth flag T4: fixture-injected callback)
- Layer-1 dedup: identical re-invoke replays pre-network (`capability.op.replayed`, `engine.calls===1`) and NEVER counts as progress → **BU-2-2-4**
- Honest-empty invoke NEVER counts as progress → **BU-2-2-5**
- Constructive URL normalization (`?t=1`/`?t=2` → one invocation; empty params stripped) → **BU-2-2-6** (teeth flag T5 / BLOCKER 1: wiring unobserved)
- **Eval-able per-digest-to-subgoal citation** (a receipt with no subgoal is drift evidence, legible to steering) → **NO TEST** (note)
- **No count-based fetch ceiling** (forbidden control) → no oracle (acceptable negative; nothing to pin)
- Failure receipts (404/network-error → schema-valid `error|partial`, summary, NO citable `web_fetch` ref, both mint receipts) → **BU-2-2-7**

### BU-2-3 — receipt shape
- Content-addressed `web_fetch` artifact ref (`art:sha256:<digest>` handle verbatim, write-once, `0o600`, on-disk sha256 verified before receipt, bytes match) → **BU-2-3-1** (teeth flag T6: no-raw-HTML assert vacuous on the default page)
- Excerpt ONLY inside `UNTRUSTED_WEB_CONTENT`, instruction-text framed not filtered, `SECRET_SHAPED_TEXT` redacted (`[redacted]` marker — matches messages.mjs:437), control chars stripped, 4_096 cap (`MAX_ATTENTION_TEXT_BYTES`, messages.mjs:408), no second unframed field across ALL string leaves → **BU-2-3-2**
- Scratch second lane framed at read (read-side projection; durable fact untouched) → **BU-2-3-3** + negative half **BU-2-3-pin**
- Artifact-read path framed → **BU-2-3-4**
- **Acceptance-named scan surfaces with NO row: a message, a board item, the Finding body** (acceptance :659-665 names all six; the suite covers payload/scratch/artifact) + **the coordinator-side single framing seam** (capability framed field → context assembler wrap, coordinator.mjs:328 discipline) has no oracle (BLOCKER 3)
- **`needs_resume`/cursor pressure valve for long pages** (paginate rather than silently truncate) → **NO TEST** — BU-2-3-2's 6 KB page asserts silent truncation to 4_096 with no cursor requirement; an always-truncating implementation greens (flag)
- Per-finding-quote 4_096 cap → NO TEST (folded into BLOCKER 3's Finding-body leg)
- NFKC validity, orphaned-artifact inertness → no explicit rows (minor notes)

### BU-2-4 — candidacy gate
- Web-cited fact promotes via EXISTING `scratch.cited_observed` with `grounding:'observed'` (never verified), lands in `knowledgeCandidateQueue`, exactly four triggers → **BU-2-4-pin** (verified against coordination-store.mjs:14515-14535, :15628-15635)
- Verified-reader precondition (completed + `verified_task_outcome`) — positive half in BU-2-4-pin's fixture; **negative half not in this suite** but covered by phase49 SP3/SP4 (invalidated-outcome reader quarantined) — cross-suite, acceptable (note)
- Self-read exclusion → declared a hard dependency on BD3-A's row (bidirectional-v3-red.test.mjs:253-290, A6b). **STALE: BD3 landed in `726e34a`; A6b is GREEN (verified by re-run); the exclusion ships at coordination-store.mjs:14521-14526.** The dependency is satisfied — contract text needs amending (BLOCKER 4)
- Supersession freshness: re-fetch mints new artifact+receipt naming the superseded digest → **BU-2-4-1** (receipt-level only; **the KG-side `Supersedes` edge wiring is never exercised** — flag)

### BU-1 — QA lane
- Skeleton registers, `availability` hardcoded `'empty'` even when constructed with `'available'`, EVERY op honest-empty → **BU-1-1**
- Lane E ledger-entry format exists, exercised, review-never-gate → **BU-1-2** (teeth flag T7: receipt reference unasserted)
- No playwright/puppeteer anywhere in package.json → **BU-1-pin**
- Non-goals with no oracle (acceptable as policy/by-construction): no authenticated pages/credential material; no form submission (the suite-pinned engine interface exposes only `fetch(url)` — by construction); no heuristic injection filtering (positively pinned by BU-2-3-2's framed-not-filtered attack text); no worker side-channel (partially expressed by the refusal rows).

## 2. Per-pin verdicts (false-green hunt)

- **P1 · BU-2-1-pin — SOUND.** Green for the right reason: `cloneBriefData` copies every own
  field (messages.mjs:46) so `analysis` free-rides, and `deepFreeze` applies at :114. An
  implementation that dropped unknown Brief fields or stopped freezing fails this row.
- **P2 · BU-2-1-TG5-pin — WEAK.** Both legs behave as named (TG5 skip verified at
  coordinator.mjs:11953-11956; the dirty leg's `worker_path_scope_violation` is a real
  full-strength oracle). But the `analysis` flag is NOT load-bearing in the clean leg:
  `makeBrief` has `requiredEffects: []`, and the gate evaluates `required_effect` only when
  `requiredEffects` includes `repository_edit` — so the leg passes identically with
  `analysis` omitted entirely. Worse, post-BU-2-1b the load-bearing combination
  (`analysis:true` + `repository_edit`) is unmintable, so no direct-path row can ever make
  the flag load-bearing for the skip. The flag's arrival is properly pinned by BU-2-1-pin /
  BU-2-1a-1 / BU-2-1a-2 instead; this row's real content is "no-diff completes + path_scope
  unchanged," which it does pin. Not vacuous, but it cannot catch a TG5 regression targeted
  at the analysis condition.
- **P3 · BU-2-3-pin — SOUND (in composition).** Green today because `readScratch`
  (:13290) applies no frames at all — the correct current behavior for plain facts. Paired
  with red BU-2-3-3 it forms a real differential: frame-everything fails the pin,
  frame-nothing fails BU-2-3-3, frame-by-`grounding` fails the pin (the plain fact is also
  `observed`). An implementation keying the frame on the `art:sha256:` handle — exactly the
  contract — is the unique green.
- **P4 · BU-2-4-pin — SOUND.** Exercises the real store promotion end-to-end: two
  completed tasks with `verified_task_outcome` Findings, an independent reader
  (`w-reader`/task `reader` ≠ author `w-research`/task `research` — composes with the
  now-landed self-read exclusion), promotion mints `grounding:'observed'` via
  `scratch.cited_observed`, queue membership, four-trigger closure. The web-specific
  content (the `art:sha256:` citation) is not load-bearing for promotion — any observed
  cited fact would do — but the row's named behavior is "existing rails unchanged," which
  is exactly what a pin should prove. Note: "Finding carries evidence pointing at the
  receipt digest" holds only transitively (fact body → finding evidence seqs); no direct
  digest-in-finding assertion.
- **P5 · BU-1-pin — SOUND.** Trivially true today (package.json: one hard dep
  `@ast-grep/napi`, zero `optionalDependencies` — verified); remains a real guard across
  all three dependency fields post-implementation. Brittle only to field renaming.

No VACUOUS or STAGED-WRONG pins. All five greens are legitimate already-implemented
behavior, cited above — none is a false green. (P2's caveat is about discrimination, not
about today's green being wrong.)

## 3. Teeth check (red rows vs plausible wrong implementations)

The four named wrong implementations from the verification brief:
- **URL passthrough without normalization** → caught: BU-0-2-3 (off-allowlist reaches the
  network = `engine.calls>0` = red) and BU-2-2-6's pure-function asserts (`?t=1`≠`?t=2` =
  red) — BUT see T5: the passthrough-with-dead-export composition greens.
- **Unbounded capture** → caught: BU-2-3-2's 6 KB fixture (TAIL-MARKER must be cut at
  4_096) and BU-2-3-1's byte/digest checks.
- **Analysis spliced into objective instead of authoritative-brief propagation** → caught:
  BU-2-1a-1 requires `brief.analysis === true` AND `semanticBriefCore` digest-binding AND
  the `planBriefMatches` negative control (a spliced objective changes `goal`, breaking the
  plan/Brief match; and `brief.analysis` stays undefined). BU-2-1a-2 confirms end-to-end.
- **Missing `capability_op` evidence kind** → caught: BU-2-2-2 (kind admission + dedup)
  and BU-2-2-3 (cycle never settles).

Row-level flags (rows a compliant-but-shallow implementation could green):

- **T1 · BU-0-1** — registration-only; empty op shells pass it. Composition rows give the
  ops their behavior, so this is fine as the registry-shape row. Not flagged.
- **T2 · BU-0-5 — WEAK (BLOCKER 5).** The eager-import scan is `readdirSync` NON-recursive
  over `impl/src` — `impl/src/program-ir/` (verified to exist) escapes it. An eager engine
  import there forces the optional dep onto every deployment with no row catching it — the
  exact supply-chain regression the fold forbids. (The `browser-use.mjs`/`browser-qa.mjs`
  exclusion is fine: the engine is never installed in the test env, so an eager import
  inside the capability module would `ERR_MODULE_NOT_FOUND` all 18 module rows.)
- **T3 · BU-0-2-2 / BU-0-2-3 — WEAK (minor).** The refusal is observed as
  `error.code ?? 'thrown'` and asserted only as "a string" — a codeless crash satisfies it,
  and the registry mints `capability.op.refused` with code `capability_failed` for ANY
  thrown error (capability-registry.mjs:325-330). So an always-throwing bug greens the
  refusal half. The constructive half (`engine.calls===0` — no network) is the real oracle
  and holds. The header's "asserts the refusal CLASS (a typed string code …)" overstates:
  no specific code, nor the presence of a code, is asserted. Strengthen: assert
  `refusal !== 'thrown'`.
- **T4 · BU-2-2-3 — WEAK.** The `onFetchReceipt → _observeSteeringCycle` wiring is
  injected BY THE FIXTURE (:624-628). Pinned: the capability fires the callback once per
  completed, available fetch with `{actor, digest, …}`. NOT pinned: the production
  subscription (whatever deployment code constructs the capability with a coordinator-bound
  callback) — an implementation exporting the seam but never wiring it in deployment
  assembly greens the row while the contract's "one piece of new wiring" is absent in
  production. Same blind spot family as T5; see BLOCKER 1.
- **T5 · BU-2-2-6 — WEAK (BLOCKER 1).** The test normalizes URLs ITSELF and hands
  pre-normalized args to `registry.invoke` ("mirrored here", :732-733). An implementation
  that exports `normalizeBrowserUseUrl` but never calls it on any invoke path greens the
  row — the contract's control-law-mandated constructive control ("normalizes … at the
  capability boundary BEFORE the idempotency binding and the network call") has no oracle
  on the real path. Note the registry makes this observable: same-key + different-args is a
  `capability_idempotency_conflict` refusal, not a replay (:233), so only real pre-binding
  normalization turns the `?t=1`/`?t=2` pair into a replay.
- **T6 · BU-2-3-1 — WEAK (minor).** The "never raw HTML" assert checks the default fake
  page (`<p>plain page</p>`) for `<script>` — absent from the input, so an implementation
  storing raw HTML verbatim passes every artifact assertion in this row. Covered in
  composition by BU-2-3-2's script-laden page; strengthen by giving BU-2-3-1's page a
  script tag.
- **T7 · BU-2-4-1 — WEAK.** Pins receipt-level freshness (new digest, old digest named,
  `/supersed/i`) but a shallow implementation can decorate the receipt with
  `superseded:<digest>` and never wire the KG `Supersedes` edge the contract names ("the KG
  links old to new with the existing Supersedes edge type"). The KG half has no row.
- **T8 · BU-1-2 — WEAK.** The row's own title claims the ledger entry "references the
  receipt," but nothing asserts it: the oracle is `/review/i` substring + absence of
  `"gate":true`. A content-free `{note:'review'}` greens it. (The contract's v1 bar —
  "format exists and is exercised by a test" — IS met; this is the row underselling its own
  title.) Strengthen: assert the entry carries a receipt identifier (invocationId /
  resultDigest / digests) and the capability name.

All other red rows (BU-0-2, BU-0-3, BU-0-4, BU-0-2-1, BU-2-1a-1, BU-2-1a-2, BU-2-1b-1,
BU-2-1b-2, BU-2-1c, BU-2-2-1, BU-2-2-2, BU-2-2-4, BU-2-2-5, BU-2-2-7, BU-2-3-2, BU-2-3-3,
BU-2-3-4, BU-1-1) are SOUND: each fails a named wrong implementation (verified against the
shipped seams cited in §0) and each red stage was confirmed against the source.

## 4. Drift findings (suite header / contract vs shipped code)

Suite-side (all verified accurate — implementers can trust the header):
- The suite-pinned surface (`createBrowserUseCapability`, `createBrowserQaCapability`,
  `probeBrowserUseAvailability`, `normalizeBrowserUseUrl`, `createLaneELedgerEntry`,
  `deploymentGoalPlanAuthority`) is honestly marked as invented; every contract-ADOPTED
  name it uses checks out: op names `browser.fetch`/`browser.followLink`; the two
  availability shapes verbatim; the honest-empty summary string verbatim (contract :158-159);
  `provenance.engine:'honest_empty'`; `UNTRUSTED_WEB_CONTENT`; `'capability_op'`;
  `art:sha256:`/`web_fetch`; `MAX_ATTENTION_TEXT_BYTES=4_096`; the registry vocabulary
  (`capability.op.started/completed/replayed/refused` — all shipped, capability-registry.mjs
  :313/:317/:244/:329); `plan_required_effect_invalid` (shipped at goal-plan.mjs:345,353);
  the authorize request vocabulary `plan_propose`/`plan_approve` (coordinator.mjs:3686,3690);
  and the header's `application-deployment.mjs:1702` permit-all citation is exact.
- Suite-comment line citations have drifted with the BD3 landing (`726e34a`):
  coordinator.mjs:9881 → :10191 (digest-dedup comment), :2141-2157 → :2157-2177,
  :11356-11377 → :11953, :9589-9592 → :9899; coordination-store.mjs:13149-13158 → :13290,
  :14374 → :14519, :14381 → :14532. Cosmetic; the named functions all verified present.

Contract-side (implementers WILL trip — see BLOCKER 4):
- **D1 · BU-2-2 boundary case 1 misdescribes the shipped idempotency keying.** The contract
  says the binding is "keyed on action+capability+op+args+actor" and the acceptance says
  "an identical (op, args, actor) re-invoke replays the durable result pre-network."
  Shipped truth (capability-registry.mjs:156-168): identity is
  `{repoId, actor, idempotencyKey}`; args discriminate replay-vs-CONFLICT only within one
  key. Same-args-DIFFERENT-key does NOT replay — it re-fetches. The suite implements the
  correct reading (BU-2-2-4 reuses the key), but an implementer following the contract text
  literally would either expect impossible behavior or attempt a forbidden registry change —
  which would then BREAK BU-2-4-1 (its second, fresh-key fetch of the same URL must
  execute to mint a new digest). Reconcile the contract text ("under the same idempotency
  identity") before the wave.
- **D2 · BU-2-4's hard dependency is stale.** "The pinning test … is RED in this tree" —
  no longer: `726e34a` landed BD3-A with "self-read hole closed," A6b re-runs GREEN, and the
  exclusion ships at coordination-store.mjs:14521-14526. The contract should be amended to
  record the dependency as LANDED (this unblocks the candidacy acceptance as written).
- **D3 · Contract line citations drifted** (same BD3 commit; the fold verified `93e5133`):
  e.g. coordinator TG5 11356-11377→11953, steering 2141-2157→2157, invokeCapability
  9589-9592→9899, authority 3612-3635→3668; store readScratch 13149-13158→13290, promotion
  14370-14384→14515-14535, triggers 15477-15484→15628-15635. Cosmetic.

Header split reconciliation: declared 27 red / 5 pins (commit `5c2d729`) = measured
27 fail / 5 pass. No divergence; nothing to adjudicate.

## 5. Closing verdict

**NOT-READY** — the suite is honest (27/27 red at named stages, zero fixture bugs, zero
false greens among the pins, fully hermetic), but four acceptance-named behaviors have no
effective oracle and one contract misdescription will send implementers at the registry.

Blockers:

1. **The constructive URL-normalization control greens unwired (BU-2-2-6, T5/T4).**
   What: the test pre-normalizes URLs itself; nothing observes normalization (or the
   `onFetchReceipt` subscription) happening on the real invoke path. Why: both are folded
   red-team controls (soft-farm closure; the epic's one piece of new wiring) and a
   compliant-looking implementation can ship both as dead exports. Fix: drive the
   `?t=1`/`?t=2` pair (same idempotency key) and the cycle-settling fetch through the
   suite-pinned production seam — `coordinator.invokeCapability` for the fetch, and
   whatever deployment-assembly surface the epic pins for constructing the capability —
   asserting one engine call + `capability.op.replayed` for the pair, and name the wiring
   site in the suite header.
2. **BU-0 Amendment B has no oracle anywhere.** What: the `npm pack` → clean-install smoke
   asserting the engine is absent from the packed `files`/dependency closure (a named
   acceptance criterion) exists only as PKG-2's smoke for a different dependency. Why: the
   optionalDep could leak into the packed closure with every row here green. Fix: add a
   pack-smoke row (or a `scripts/` smoke invoked by the suite) mirroring
   `impl/test/mcp-packaging-red.test.mjs`'s PKG-2 test, asserting the engine name appears
   in no packed manifest/dependency closure.
3. **The no-second-door scan covers 3 of 6 acceptance-named surfaces, and the
   coordinator-side framing seam is unobserved.** What: acceptance (:659-665) names
   capability-result payload (BU-2-3-2 ✓), scratch read (BU-2-3-3 ✓), artifact read
   (BU-2-3-4 ✓) — and also a message, a board item, and the Finding body (✗✗✗); the
   named single seam (capability framed field → coordinator context assembler,
   coordinator.mjs:328 discipline) has no row. Why: an implementation framing only the
   capability payload while a quoted extract travels raw into a message/board item/Finding
   greens the suite while violating the epic's core injection-boundary property. Fix: add
   rows walking quoted extract material into a worker-bound message, a board item, and a
   Finding body asserting the `UNTRUSTED_WEB_CONTENT` frame (and the 4_096 per-finding-quote
   cap), and pin the coordinator assembly site that wraps capability results.
4. **Contract reconciliation: replay keying + stale self-read dependency (D1/D2).**
   What: BU-2-2's "keyed on action+capability+op+args+actor" contradicts the shipped
   `{repoId, actor, idempotencyKey}` binding and implicitly contradicts the suite's own
   BU-2-4-1; BU-2-4's "self-read exclusion is RED in this tree" is stale (landed in
   `726e34a`). Why: implementers read the contract first; D1 invites a forbidden
   core-registry change that would then fail BU-2-4-1, and D2 misstates a satisfied
   dependency. Fix: amend the contract — "under the same idempotency identity" on the
   replay clause, and mark the BD3-A dependency LANDED (optionally refresh the §-level
   line citations per D3).
5. **BU-0-5's eager-import scan is non-recursive (T2).** What: `impl/src/program-ir/`
   escapes the `readdirSync` scan. Why: a stray eager engine import there reintroduces the
   supply-chain surface with no row catching it. Fix: walk `impl/src` recursively (one-line
   change to `readdirSync(..., { recursive: true })` or an explicit subdir list).

Non-blocking strengthenings (fold into the wave if convenient): T3 (assert a typed code,
not `'thrown'`), T6 (script tag in BU-2-3-1's page), T7 (KG-side Supersedes row), T8
(assert the ledger entry's receipt reference), plus rows for the followLink success path /
server-redirect semantics, the `needs_resume` cursor pressure valve, SPA honest-degrade,
and the subgoal-citation eval-able control.
