# #72 BLUE-TEAM REPORT — the prescriptive-doctor red-first suite

Date: 2026-08-12 · Suite under attack: `impl/test/prescriptive-doctor-red.test.mjs` (16 tests: 3 green
PINs / 13 RED rows)
Target: NOT the contract — the SUITE's red-keeping power against `prescriptive-doctor-contract.md`
**v1.1** (folded) + `contract-fold.md` (the 9 blocker resolutions B1–B9 + the open-question verdicts).
Verification HEAD: `235fcbd` ("Baton private effective-tree snapshot").

## Verdict: **NEEDS-FOLD**

The stage-guard skeleton is sound — every RED row fails today at its NAMED stage, the three guard
pins pass on surfaces #72 leaves unchanged, and no RED row is a hard green-side blocker (every row
is greenable under a contract-correct v1.1 implementation). But the suite does not yet hold its
red-keeping power. Four of the brief's named attacks are open as written:

- **PT-10's #137 anti-misdirection half is vacuous** (Finding 1) — the target surface
  (`inspectBatonConnection`) never emitted the `create_profile` misdirection the row claims to pin,
  the fixture is malformed so it cannot even reach the resident-mid-startup window, and the
  assertion `directsToCreateProfile === false` is **true today against the unlanded tree**. An
  implementation that lands only the W6 detection and never fixes #137 greens PT-10.
- **The contract's PT-3 CLI/MCP/web parity clause is unpinned** (Finding 2) — no real surface is
  exercised; only a synthetic `{...readiness, warnings}` round-trip is tested.
- **PT-11 cannot discriminate a highest-eventSeq accessor from a last-element read** (Finding 3).
- **PT-4 accepts any `git <verb>` as a valid action link** (Finding 4) — the ghost-verb law is
  bypassable in the `git` namespace.

Plus two precision-law gaps (Findings 5–6), two partial-coverage gaps (Findings 7–8), a fixture
self-verification gap that the stage guard masks (Finding 9), and one suite-internal contradiction
(Finding 10).

## Verified split (two consecutive runs from the repo root)

```
$ node --test impl/test/prescriptive-doctor-red.test.mjs   # run from the repo root
ℹ tests 16
ℹ pass 3
ℹ fail 13
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

- **run 1**: `tests 16 · pass 3 · fail 13 · cancelled 0 · skipped 0 · todo 0`
- **run 2**: `tests 16 · pass 3 · fail 13 · cancelled 0 · skipped 0 · todo 0`
- **STABLE.** The 3 passes are exactly the guard pins (PT-2p, PT-4p, PT-8p); the 13 failures are the
  PT rows, each failing at its named stage guard (`resolvePrescriptiveDoctorHome()` →
  `{surface: null}`). Matches the claimed split in `suite-draft-notes.md` and the contract §6.

## Stage honesty + hermeticity (verified, sound)

- **Named stages at HEAD.** Every RED row's first failing assertion is the named stage guard carrying
  the row's message (`PT-1: the warning catalog/composer is not landed (§4.1 D1)`, `PT-5: W1
  ghost-worktree census is not landed (§4.1 W1)`, …, `PT-13: the fail-open detection surface is not
  landed (§4.1, B3)`). Nothing fails on a vacuous shape assertion. Confirmed against the emitted
  failure messages across both runs.
- **Hermetic.** Every root is `mkdtempSync` under `os.tmpdir()` with `test.after` cleanup; the only
  child processes are local `git init`/`commit`/`worktree`/`update-ref`/`for-each-ref` in planted
  temp repos and the `/bin/ps -o lstart= -p <pid>` identity read for the suite's OWN live-pid
  precision case (PT-6, self-owned identity — deterministic on macOS/Linux, not a host census). W3
  plants metadata-shaped objects only, with a multibyte token canary (`baton-private-canary-do-not-emit-⟘`)
  that no row may emit. No network; no real credential reads. The dead-pid sentinel `4_194_305`
  exceeds the Linux `pid_max` ceiling (4,194,304) and macOS pid bounds, so it cannot be a live pid —
  a deterministic ESRCH.
- **No order dependence.** Each row builds fresh fixtures; module-level state is frozen constants and
  the cleanup array only. `resolvePrescriptiveDoctorHome()`'s dynamic import is cached identically
  across rows. The fixed injected epoch (`NOW = 1_797_840_000_000`) makes the W3 window arithmetic
  deterministic; a non-conforming impl that substitutes the real clock fails PT-7's grok-window case
  (the planted 2027 expiry would read as outside the real 2026 window) — a correctly discriminating
  pin.
- **NUL discipline (§8).** Neither the suite nor this report reads the NUL files
  (`impl/src/application.mjs`, `impl/src/coordination-store.mjs`); all citations below were verified
  against NUL-free sources (`application-cli.mjs`, `wave-driver.mjs`, `application-deployment.mjs`)
  and live repro runs.

## Findings

### Shallow-greenability / vacuous red-keeping (a wrong implementation greens the row)

**Finding 1 — PT-10's #137 anti-misdirection half is vacuous: wrong surface + malformed fixture.**
- **Row/gap:** PT-10 (impl/test/prescriptive-doctor-red.test.mjs:622-660) — the "…#137 create_profile
  misdirection is replaced in `inspectBatonConnection`" clause (§4.2, B.2, PT-10).
- **Attack:** "could the never-block/misdirection rows pass with the misdirection never fixed?" —
  yes, and it passes today, before any implementation.
- **Details:** Two independent defects.
  1. **The fixture cannot reach the window it names.** The fixture writes a schema-v2 `connection.json`
     with only `{schemaVersion: 2, profile, repoId}` (test:645) into `<repo>/.git/baton/`. A v2
     resident selector requires `deploymentId`, `incarnation`, `transport: 'local'`,
     `registryDigest === APPLICATION_SEMANTIC_REGISTRY.digest`, and a parseable `startedAt`
     (application-cli.mjs:544-548). With those absent, `inspectBatonConnection` throws
     `resident repository connection authority is invalid` and returns the **invalid branch** — I
     reproduced it live: `state: 'needs_setup'`, `connection: 'invalid'`, `next:
     [{action: 'repair_setup', command: 'baton setup'}]`. The row never exercises the
     resident-mid-startup state it asserts against.
  2. **The target surface never had the misdirection.** `inspectBatonConnection`
     (application-cli.mjs:489-638) never returns a `create_profile` step in any branch — the
     `profiles: 'missing' → create_profile` misdirection lives in `setupBatonConnection`
     (application-cli.mjs:458-466, the `create_profile` step at :464). The contract §4.1 W6 / §4.2
     and the fold's non-blocking map all attribute the replacement to `inspectBatonConnection` at
     "application-cli.mjs:461-464" — a mis-citation of the actual misdirection surface. Because
     `inspectBatonConnection` never emits `create_profile`, the assertion
     `directsToCreateProfile === false` (test:656-659) is **true today**; a minimal implementation
     that lands only `detectResidentNotPublished` (which fires on the row's pure-function fixture)
     and never touches the #137 misdirection passes PT-10 in full.
- **Concrete fix:** (a) plant a **valid** resident fixture — full schema-v2 `connection.json`
  (including `deploymentId`, `incarnation`, `transport: 'local'`, `registryDigest`, `startedAt`) plus
  a matching resident profile file and an **absent socket** — so `inspectBatonConnection` reaches the
  resident-mid-startup branch (today it returns `state: 'stale'`, `connection: 'stale_authority'`,
  `next: [recover/baton serve]`, verified live); (b) assert the diagnosis reports the resident-starting
  state (the W6 composition) rather than merely the absence of `create_profile`; AND (c) retarget the
  anti-misdirection assertion to the surface that actually misdirects today — `setupBatonConnection`
  with an empty config root and a resident selector returns `profiles: 'missing' → create_profile`
  (application-cli.mjs:463-464), which is the #137 defect a v1.1 implementation must close. Verify the
  retargeted row is RED against the current tree (the fixture must fail before the implementation
  lands), or correct the contract's surface attribution so the row and the contract name the same
  surface.

**Finding 2 — PT-3 does not pin the contract's CLI/MCP/web parity clause; the row is a shape test,
not a surface test.**
- **Row/gap:** PT-3 (test:428-461) — §6 PT-3: "the web `/v1/application-card` served card, the CLI
  doctor `--check` JSON, and the MCP `baton_deployment_doctor` result each carry the ONE named
  `warnings` field with **identical rows for the same deployment state**".
- **Attack:** "the CLI/MCP parity row" (brief) — an implementation that wires NONE of the three
  surfaces greens PT-3.
- **Details:** The row builds a synthetic `readiness = { ready: true, routes: [] }`, defines the
  `warnings` property on it, asserts `JSON.stringify` hides it, and asserts the spread
  `{ ...readiness, warnings: readiness.warnings ?? null }` survives a round-trip. It never calls
  `doctorReadiness()` on a real deployment, never serves `/v1/application-card`, never runs the CLI
  `--check` render (`BatonWebClient.doctor()`, application-cli.mjs:1961-1978, and
  impl/scripts/baton.mjs:79-98), and never invokes the MCP `baton_deployment_doctor`
  (mcp-northbound.mjs:564-567, 2118-2149). The only real-surface pin is a text regex over
  `application-deployment.mjs` (`Object.defineProperty(...'warnings'...)`, test:459-460). An
  implementation whose web/CLI/MCP surfaces never add the `warnings` additive — and whose local
  `--depth` outline renders W3/W7 (violating the pinned local subset {W1,W2,W4,W5,W6}, §4.2 OQ1) —
  passes the suite. The local-subset render is likewise unpinned (only the set partition is pinned,
  PT-2p).
- **Concrete fix:** add a parity row that opens a real `openBaton` deployment (the PT-8p harness
  shape), drives the degraded reads through it, and asserts (a) the served web card, the CLI
  `--check` JSON round-trip, and the MCP result each carry exactly ONE `warnings` field with
  identical rows; (b) the serialized `doctorReadiness()` output (non-reading consumer) is byte-identical
  with and without the sibling; and (c) the local `--depth` outline renders exactly the local subset
  and never `warning_credential_ttl`/`warning_route_last_auth_failure`.

**Finding 3 — PT-11's fixtures cannot discriminate a highest-eventSeq accessor from a last-element
read.**
- **Row/gap:** PT-11 (test:662-702) — §4.1 W7 / §6 PT-11: "the exact route's **highest-eventSeq**
  observation via a **per-route max accessor** (O(routes), not `routeObservations()`' full clone-sort)".
- **Attack:** "could the precision-law rows pass with a detection that fires on both the planted
  condition and the healthy state" — the deeper cousin: the row passes with a detection that reads the
  WRONG observation.
- **Details:** In every fixture the highest-eventSeq observation is also the LAST element of the
  array: fired cases `[completed e1, failed e7/e9]` (test:305-308, 667-670), quiet cases
  `[failed e1, completed e9]` (test:683-685) and `[failed provider_unreachable e9]`. A non-conforming
  implementation that returns `observations.at(-1)` — never comparing `eventSeq` — produces the
  identical pass set: fired for the fired cases, quiet for the completed/non-auth cases. The only
  accessor pin is the source ban on `routeObservations(` (test:700-701), which a last-element read
  does not trip. The contract's O(routes) max-accessor clause is therefore behaviorally unasserted.
- **Concrete fix:** reverse the eventSeq/array ordering in at least one case so the highest eventSeq
  is NOT last — e.g. fired case `[{failed auth e9}, {completed e1}]` — so a last-element read returns
  `completed` → `null` → the fired assertion fails (RED), while a correct max accessor still fires
  (GREEN). Keep the `routeObservations(` source ban; add an explicit `eventSeq`-max behavioral
  assertion over a three-observation fixture.

**Finding 4 — PT-4 accepts any `git <verb>` as a valid action link, bypassing the ghost-verb law.**
- **Row/gap:** PT-4 (test:463-489) + `invalidNextCommand` (test:259-270) — §4.3 D3 / B1: "an action
  link must reference an existing verb, an existing `baton` command, or a named doc anchor — never a
  fabricated verb".
- **Attack:** "could the action-link rows pass with a remediation that names a verb that doesn't
  exist?" — yes, in the `git` namespace.
- **Details:** `invalidNextCommand` returns `''` (valid) for any command that starts with `git `
  (test:267-268: `if (command.startsWith('git ')) return '';`). A non-conforming implementation can
  therefore name a fabricated verb — e.g. `git prune-ghost-pins`, `git refresh-credentials` — for
  W1/W2/W4/W6's `next` and pass PT-4 (the `baton ` prefix is parser-probed and `claude auth login` /
  `grok login` are allow-listed, but the `git ` blanket has no existence check). The contract's
  ghost-verb class (dynamic-workflow-2026-08-03/cli-surface-audit.md:83) is only enforced for
  `baton credentials refresh` (test:474-476) and the W5 ref-deletion path (test:484-488). The
  "reduces the cause" clause (§4.3, PT-4, B7) is likewise only asserted for W5; the other six rows'
  remedies are checked for verb-existence only, never for cause-reduction.
- **Concrete fix:** restrict the git-branch acceptance to the named manual steps the contract
  actually anchors — `git update-ref -d refs/baton/results/…` and `git update-ref -d
  refs/baton/checkpoints/…` (the W5 doc anchor, B7) — and otherwise treat an unknown `git <verb>` as
  a ghost verb (probe it, e.g. `git <verb> --help` exit code, or an explicit allowlist). Optionally
  extend the cause-reduction clause to W1/W2/W3/W4/W6/W7 (e.g. assert W6's poll does not race a
  mid-startup resident, per the #100 note at §4.1 W6).

### Precision-law gaps (the false-positive law is unpinned)

**Finding 5 — PT-5 does not pin the W1 live-owner discriminator; an implementation that fires on any
unregistered residue passes.**
- **Row/gap:** PT-5 (test:491-512) — §4.1 W1 precision law: a physical `.baton/wt/ws-*` dir is a
  ghost **only when it is not registered AND not owned by a live owner** (worktree.mjs:341-343, 698;
  never a grace window).
- **Attack:** "could the precision-law rows pass with a detection that fires on BOTH the planted
  condition and the healthy state" — the W1 half: the planted ghost has no owner metadata, so an
  implementation that omits the live-owner check entirely still fires on the ghost fixture and is
  quiet on the registered/clean fixture.
- **Details:** The ghost fixture is a bare `mkdir .baton/wt/ws-ghost-one` (test:497-498) with no
  controller pid/pidStart marker; the clean fixture is a registered worktree (test:508-509). A
  non-conforming `detectGhostWorktreeCensus` that classifies every unregistered `.baton/wt/ws-*` dir
  as a ghost passes both halves — it never faces an unregistered dir carrying a LIVE owner marker
  (which per the precision law must NOT fire). The contract's live-owner discriminator is the
  distinguishing feature of the folded W1 (the transient-residue false-positive resolution,
  contract-fold.md non-blocking map) and it is unasserted.
- **Concrete fix:** add two fixtures: (a) an unregistered `.baton/wt/ws-live-owner` dir carrying a
  live-owner controller pid/pidStart marker (process.pid + the real `/bin/ps` lstart, the PT-6
  technique) → assert it does **not** fire; (b) the same dir with a dead-owner marker → assert it
  fires. This makes the discriminator red-keeping.

**Finding 6 — PT-3's byte-stable/serialize half is self-referential; the real surface's
non-enumerability is only text-pinned.**
- **Row/gap:** PT-3 (test:444-460) — §4.2 / §6 PT-3: "serialized doctor for a non-reading consumer
  (`Object.keys`/`JSON.stringify` over `doctorReadiness()` output) is byte-identical with and without
  warnings (the non-enumerable sibling proves itself)".
- **Attack:** "could the metadata-only/compose rows pass with a fixture without adversarial content"
  (the sibling cousin): the row proves the suite's OWN `defineProperty`, not the implementation's.
- **Details:** The row constructs `readiness = { ready: true, routes: [] }`, attaches `warnings` with
  `enumerable: false` itself (test:444-445), and asserts its own property is JSON-invisible — a
  self-fulfilling check. The only pin over the real surface is the regex that the literal text
  `Object.defineProperty(...,'warnings',...)` appears somewhere in `application-deployment.mjs`
  (test:459-460); the regex does not check `enumerable: false`, does not check the sibling is attached
  to `doctorReadiness()`'s returned object, and matches comments (the raw source is scanned, not
  comment-stripped). A non-conforming implementation that defines `warnings` as an ENUMERABLE property
  on the readiness object — while keeping the defineProperty text somewhere in the file — passes the
  row and breaks byte-stability for non-reading consumers.
- **Concrete fix:** assert the behavior on the real surface: open a deployment, call `doctor()`,
  `JSON.stringify` the result, and assert no `"warnings"` key appears while `result.warnings` is
  readable by property access; and/or tighten the regex to the actual `doctorReadiness()` attach site
  (anchor the `defineProperty` to the same object literal that carries `briefing`,
  application-deployment.mjs:1355) with an `enumerable: false` requirement, comment-stripped.

### Missing-row / partial-coverage gaps (the implementation can be wrong and stay green)

**Finding 7 — the local `--depth` subset render is unpinned; an implementation that renders W3/W7
locally passes.**
- **Row/gap:** §4.2 CLI / OQ1 / PT-3 — "the local `--depth` outline renders the **local subset
  {W1, W2, W4, W5, W6}**" (W3/W7 appear only on the remote `--check` and MCP surfaces).
- **Attack:** "missing-row gaps — the CLI/MCP parity row" (brief): the partition is pinned as a
  constant (PT-2p), but the RENDER behavior is never asserted.
- **Details:** PT-2p proves `LOCAL_SUBSET ∪ REMOTE_ONLY` equals the catalog as a set, but no row
  exercises the local outline render path. An implementation that emits all seven warnings in the
  local `--depth` output (violating OQ1) passes the suite.
- **Concrete fix:** fold into Finding 2's parity row: drive the local `--depth` outline against a
  degraded deployment and assert exactly {W1,W2,W4,W5,W6} appear and neither
  `warning_credential_ttl` nor `warning_route_last_auth_failure` appears.

**Finding 8 — W1's reserved-fraction threshold branch and W5's checkpoints namespace are untested.**
- **Row/gap:** PT-5 (W1) / PT-9 (W5) — §4.1 W1 threshold is a disjunction (`ghostCount > 0` **OR**
  total reserved bytes ≥ `ghostReservedFraction × maxReservedBytes/Inodes`); §4.1 W5 read counts
  `refs/baton/results` **and** `refs/baton/checkpoints`.
- **Attack:** partial-coverage — an implementation that implements only one disjunct of W1, or counts
  only the results namespace for W5, passes.
- **Details:** PT-5 plants no reservation ledger, so the reserved-fraction branch of W1's threshold is
  never exercised (only `ghostCount > 0` fires). PT-9 plants only `refs/baton/results/pin-N`
  (test:181-185); a conforming W5 must count checkpoints too, but an implementation ignoring the
  checkpoints namespace passes both the over and under cases.
- **Concrete fix:** (a) W1: add a fixture that plants a reservation ledger whose per-reservation sums
  cross `ghostReservedFraction × maxReservedBytes` while `ghostCount === 0`, and assert W1 fires; (b)
  W5: add a checkpoints-only fixture (`refs/baton/checkpoints/…`) above the ceiling and assert W5
  fires.

**Finding 9 — the stage guard masks fixture correctness; PT-10's malformed fixture is invisible until
landing.**
- **Row/gap:** the suite as a whole — "Fixtures that can't plant the needed condition" (brief,
  green-side blockers FIRST).
- **Attack:** every fixture-heavy RED row fails at `stageGuard` before building its fixture, so no
  fixture has ever executed (the three PIN rows are the only fixture runners, and they use different
  harnesses). A fixture that cannot mint the state its row claims — PT-10's malformed resident
  selector (Finding 1) is the concrete instance — is RED today for the WRONG reason and only surfaces
  at landing time as a false-GREEN or a stuck-RED.
- **Details:** Confirmed by the run timing: the RED suite completes in ~1.2s because the 257-pin
  `buildDegradedReads` and the `git worktree add` fixtures never run. The suite-draft-notes' claim
  that fixtures are verified is unsubstantiated while every row stops at the stage guard.
- **Concrete fix:** add a stage-independent fixture-lint self-test (green today, stays green) that
  runs each fixture builder and asserts it plants the intended condition — e.g. `buildDegradedReads()`
  returns a VALID schema-v2 resident selector, the W7 observations are order-discriminating
  (highest-eventSeq not last), and the W2 lease file matches the real schema. This makes fixture
  regressions visible immediately rather than at implementation time.

**Finding 10 — PT-3's source pin hardcodes `application-deployment.mjs` while the resolver prefers a
dedicated `prescriptive-doctor.mjs`, contradicting the suite's own seam contract.**
- **Row/gap:** PT-3 (test:459-460) vs `resolvePrescriptiveDoctorHome` (test:205-221) + the
  suite-draft-notes' claim "source pins follow the home the surface was resolved from".
- **Attack:** green-side fragility — a contract-correct implementation that lands the detections AND
  the `defineProperty` sibling attach in the dedicated `src/prescriptive-doctor.mjs` (the resolver's
  FIRST choice) fails PT-3's regex, which is hardcoded over `deploymentSource`. Conversely the
  dedicated home's own source is never scanned by PT-3, so a comment-decoy in
  `application-deployment.mjs` could satisfy it (Finding 6's comment-scan note).
- **Details:** The contract §4.2 does place the sibling attach in `doctorReadiness()`
  (application-deployment.mjs), so a literal-text implementation complies — this is a fragility, not
  a hard blocker. But the suite's documented home-following convention and PT-3's hardcoded source
  disagree, which will surprise an implementation that abstracts the attach behind a helper in the
  dedicated file.
- **Concrete fix:** make PT-3 follow the resolved home like the other source pins (PT-1/PT-11/PT-12),
  or explicitly document that the `warnings` sibling attach is a mandatory `application-deployment.mjs`
  surface and scan that file comment-stripped for the `enumerable: false` attach.

## What held (verified sound, not folded)

- **The stage-guard skeleton.** Every RED row names its stage in the message and fails there; the 13
  failures are genuine stage guards, not vacuous shape assertions. The 3 PINs are the right
  wrong-implementation killers as designed: the `warning_*`/blocking namespace split (PT-2p), the
  parser's four depths + ghost-verb refusal (PT-4p), and the real `openBaton` blocking floor
  (PT-8p) — all stay green across both runs.
- **No hard green-side blocker.** Every RED row is greenable under a contract-correct v1.1
  implementation: the degraded compose can plant all seven conditions (ghost residue, stale lease,
  stale/windowed credentials, the approach band, over-ceiling pins, private outline, failed-auth
  highest-eventSeq), and each precision fixture (registered/clean worktree, live/empty lease, fresh
  credential, band/block/clear three-way, under-ceiling pins, published authority, completed/non-auth
  observations) is plantable.
- **The W2/W3/W4/W7 precision fixtures are correctly discriminating** as written: the live-lease
  pidStart case forces the pidStart comparison (a pid-liveness-only impl fails the mismatch case);
  the grok-window case forces the injected epoch over the real clock (a real-clock impl fails); the
  W4 three-way split is disjoint by construction; the canary tokens (`⟘`) probe both redaction and
  the §4.4 UTF-8 row bound.
- **The PT-13 fail-open core** (composer aggregates throws → `[]`) and the PT-12 no-elapsed-clock
  source pin are sound at the seams they cover.
- **The suite law is honored**: no clocks as controls (fixed injected epoch + `/bin/ps` identity
  only), no network, no real credential reads, sorted-key literals in ACTUAL code-unit order with
  `localeCompare` banned, and the OQ1 local/remote partition is pinned as a constant.
