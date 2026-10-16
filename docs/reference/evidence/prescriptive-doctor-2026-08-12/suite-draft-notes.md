# #72 SUITE — red-first draft notes

**Suite:** `impl/test/prescriptive-doctor-red.test.mjs`
**Binding contract:** `prescriptive-doctor-contract.md` (**v1.2** — source of truth; folded against
`contract-redteam.md` via `contract-fold.md` and the blue-team report via `suite-fold-2.md`, this
directory).
**Verification command (§7):** `node --test impl/test/prescriptive-doctor-red.test.mjs`

## Verified split (run twice from the repo root)

| run | tests | pass | fail | note |
|-----|-------|------|------|------|
| 1 | 17 | **4** | **13** | 4 guard pins green (PT-2p, PT-4p, PT-8p, PT-L); 13 PT rows red at the stage guard |
| 2 | 17 | **4** | **13** | identical — **STABLE** |

The 13 red rows fail at the stage guard — `resolvePrescriptiveDoctorHome()` returns
`{ surface: null, source: null, home: null }` because the prescriptive-doctor surface is not yet
landed. They go green only on a contract-correct implementation. The 4 guard pins pass today on
surfaces the contract says #72 leaves **unchanged** (PT-2p/PT-4p/PT-8p) or that the fold-2 fixtures
plant (PT-L); they must stay green after landing.

## Inventory

### GREEN guard pins (pass today; guard unchanged behavior + fixture integrity)

| ID | Pins (contract §) | What it guards |
|----|-------------------|----------------|
| **PT-2p** | §4.2/§4.4 | the `warning_*` namespace is disjoint from the blocking refusal codes; the catalog is a closed, duplicate-free set; the local subset {W1,W2,W4,W5,W6} and the remote-only {W3,W7} partition the catalog (OQ1). |
| **PT-4p** | §4.3, B1, §5 | `parseBatonCli` accepts `doctor`/`serve` and the four doctor depths; **no new doctor depth** (a `warnings` depth is a v1 non-goal); the ghost verb `baton credentials refresh <provider>` is rejected (B1). |
| **PT-8p** | §1.1, §4.2 | the existing `worktree_capacity_exceeded` block still fires below the floor through a real `openBaton` doctor read — the blocking side is untouched by #72. |
| **PT-L** | §77, finding 9 | **fixture-lint** — the fold-2 fixture builders plant the conditions they claim: `buildDegradedReads()` returns a VALID schema-v2 resident selector (the closed 8-key set, registryDigest match, parseable `startedAt`); the W7 observations are order-discriminating (highest eventSeq NOT last); `writeStaleLease` writes the REAL writer-lease schema; the PT-10 resident fixture reaches the resident-mid-startup window (`inspectBatonConnection` → `stale`/`stale_authority`); `plantOwnerReceipt` writes a fully-valid 15-field owner receipt (digest closes). |

### RED rows (fail today — stage: prescriptive-doctor surface missing)

| ID | Contract § | Stage / what lands |
|----|-----------|--------------------|
| **PT-1** | §4.1, §4.4, B8 | catalog closure (exactly the 7 codes) + closed row schema in ACTUAL code-unit order; `localeCompare` banned. |
| **PT-2** | §4.2 | warnings NEVER block — blocking codes never inside `warnings`; the wave-driver preflight does not read `warnings` in v1. |
| **PT-3** | §4.2, B4, #103 D6, OQ1 | surface compose — ONE named `warnings` field; non-enumerable sibling on the REAL `doctorReadiness()` surface (byte-stable `JSON.stringify`/`Object.keys`, visible by property access); identical rows across the served web card; sanitized at source (no token canary); the CLI (`BatonWebClient.doctor`) and MCP surfaces carry the same named additive; the local `--depth` outline renders the LOCAL subset only (never W3/W7); `doctorReadiness()` attaches it by the D6(b) `defineProperty` pattern over the resolved home. |
| **PT-4** | §4.3, B1, B7, #136 | every `next` non-empty, a real verb/command/**named** doc anchor, and reduces the cause; W5 → manual ref-deletion (`git update-ref -d refs/baton/(results|checkpoints)/…`), never `adopt`/`integrate`; fabricated `git <verb>` and fabricated `#NNN` anchors rejected. |
| **PT-5** | §4.1 W1 | ghost-worktree census fires on unregistered residue; **live-owner discriminator** (an unregistered dir with a VALID live-owner receipt is NOT a ghost; the same dir with a dead owner IS); **reserved-fraction disjunct** (real reservation ledger ≥ 0.8 × maxReservedBytes fires W1 with ghostCount === 0); quiet on a registered/clean tree (precision law). |
| **PT-6** | §4.1 W2, B6 | stale-writer-lease fires on a dead pid AND a pidStart mismatch; quiet on a live lease; cause names `coordination_writer_lost` (not `…_busy`). |
| **PT-7** | §4.1 W3, B5, §3 | credential TTL metadata-only — claude `stale` and the grok early-invalidation **window** fire (window sourced from the deployment classification, not the state-class); fresh is quiet; no token material emitted. |
| **PT-8** | §4.1 W4, B2 | disk-floor approach band fires above the floor; below the floor the block fires and W4 is **suppressed** (disjoint by construction); at/above the band neither. |
| **PT-9** | §4.1 W5, B7 | result-pin census fires above the bound across **BOTH** namespaces — `refs/baton/results/` **and** `refs/baton/checkpoints/` (a checkpoints-only fixture crosses the ceiling); quiet below. |
| **PT-10** | §4.1 W6, §4.2, B.2 | resident-not-published fires on a **VALID** schema-v2 selector with a private outline (severity `notice`); the diagnosis on a full valid resident authority (selector + profile + ABSENT socket) reports the resident-starting state (`stale`/`stale_authority`/`baton serve`); the #137 `create_profile` misdirection is replaced **in `setupBatonConnection`** (v1.2 — the surface that actually misdirects, application-cli.mjs:458-466), which must report the resident-starting state. |
| **PT-11** | §4.1 W7 | route last-auth-failure fires on the **highest-eventSeq** failed auth result — order-discriminating fixtures (highest NOT last; highest in the MIDDLE of a three-observation array; quiet when the highest is completed even if a lower row failed auth) prove a per-route max accessor; `completed`/non-auth quiet; read is a per-route max accessor (not `routeObservations()` full clone-sort). |
| **PT-12** | §3, §4.1, B5 | no warning mints an elapsed-time wall-clock control (`now - activity > threshold`); honest reads stay in the pre-existing classes (expiry state-class/window, statfs, `/bin/ps` pidStart, event-seq). |
| **PT-13** | §4.1, §4.2, B3 | every detection is FAIL-OPEN — a throwing detection omits its warning and never throws; an all-throwing fixture composes `[]` (byte-identical to clean, so no `wave_driver_route_unready`). |

## Stages

The single stage today: **the prescriptive-doctor warning surface is not landed.**
`resolvePrescriptiveDoctorHome()` returns `{ surface: null, source: null, home: null }`. Every PT row
stage-guards on `surface.composePrescriptiveWarnings` and is RED. The implementation lands the
surface (exporting the invented signatures below) and the rows go green. The fold-2 red-keeping
assertions (live-owner discriminator, reserved-fraction ledger, order-discriminating W7 fixtures,
valid-selector W6, `setupBatonConnection` anti-misdirection, checkpoints-only W5) fire ONLY after the
stage guard clears — each is verified RED against the current tree so a wrong implementation cannot
green the row vacuously (PT-L lints the fixtures so they plant what they claim).

## Invented signatures (suite-chosen seams)

The contract pins **behavior**, not these JS spellings; each is the most sibling-consistent reading
of the named contract surface. `resolvePrescriptiveDoctorHome()` resolves a dedicated
`src/prescriptive-doctor.mjs` first, then the `application-deployment.mjs` namespace, else null — so
either home satisfies the row (source pins follow the home the surface was resolved from, the
`readiness-credentials-red` convention):

```
export const PRESCRIPTIVE_WARNING_CODES          // frozen array — the closed 7-code catalog
export const PRESCRIPTIVE_DOCTOR_DEFAULTS        // approachMargin, ghostReservedFraction,
                                                 // resultPinCeiling, maxWarningRowBytes,
                                                 // grokEarlyInvalidationMs, minFreeBytes,
                                                 // minFreeInodes, maxReservedBytes, maxReservedInodes
export function detectGhostWorktreeCensus({ root, policy })            → Warning | null
export function detectStaleWriterLease({ storeRoot })                  → Warning | null
export function detectCredentialTtl({ claudeMetadata, grokMetadata,
                                      now, grokEarlyInvalidationMs })  → Warning | null
export function detectDiskFloorApproaching({ workspace, approachMargin }) → Warning | null
export function detectResultPinCensus({ repoRoot, ceiling })           → Warning | null
export function detectResidentNotPublished({ authorityRoot,
                                             publicOutlineState })      → Warning | null
export function detectRouteLastAuthFailure({ routeKey, observations,
                                             liveness })               → Warning | null
export function composePrescriptiveWarnings(reads)                     → Warning[]
```

A `Warning` row is the CLOSED shape, keys in ACTUAL code-unit order:
`{ cause, code, next: [{ action, command }], severity, summary }`
(`cause` < `code` < `next` < `severity` < `summary`); `next` is non-empty and ≤1 entry in v1;
`severity` ∈ { `notice`, `warning` }; W6 is `notice`, the rest `warning`.

## Suite law (how the red-first + campaign constraints are honored)

- **Red-first / namespace imports.** The invented surface is reached through a dynamic
  `import('../src/prescriptive-doctor.mjs').catch(() => null)` resolver with an
  `application-deployment.mjs` namespace fallback (`import * as deploymentModule`), so the file
  loads today and the guard pins run. Each PT row `stageGuard`s on the resolved surface and fails
  red until it lands.
- **Hermetic.** Every root is `mkdtempSync` under `os.tmpdir()` (or a top-level `/tmp` root for the
  resident fixtures — the resident protocol bounds `socketPath` to 103 bytes, application-cli.mjs:265,
  and the taskwave runtime `TMPDIR` is deeper than that) and removed in `test.after`; no network; no
  real credential reads (W3 plants metadata-shaped objects only). The W2 fixture writes the REAL
  writer-lease schema `{schemaVersion:2,pid,pidStart,token,acquiredAt}`
  (coordination-store.mjs:1294-1296); the live-lease precision case computes the real
  `/bin/ps -o lstart= -p <pid>` identity the lease already uses. The fold-2 fixtures plant REAL
  resident selectors/profiles (application-cli.mjs's exact schema-v2 validation), REAL owner receipts
  (worktree.mjs's 15-field receipt, digest closes), and REAL capacity reservations
  (worktree-capacity.mjs's authority) — PT-L lints each.
- **No clocks.** The only wall-clock dependency is the W2 `/bin/ps` process-identity read (a physical
  identity, not a control) and a fixed injected epoch (`NOW`) for the W3 fixtures — never the real
  clock. PT-12 source-pins that no detection mints an elapsed-time `now - activity > threshold`
  comparison.
- **Precision law.** Every detection has a quiet/healthy counterpart assertion (the false-positive
  fails the row): W1 clean tree + live-owner + reserved-fraction, W2 live/empty lease, W3 fresh
  credential, W4 at/above band + the block-suppressed band, W5 under-bound, W6 published, W7
  completed/non-auth/max-elsewhere.
- **NUL discipline (§8).** `application.mjs` and `coordination-store.mjs` carry NUL bytes; the suite
  cites their anchors in comments only (verified by the contract at HEAD `dc569eaa…`/`4758d8fa…`).
  Source scans target the NUL-free inventories (`application-deployment.mjs`, `application-cli.mjs`,
  `mcp-northbound.mjs`, `wave-driver.mjs`, the resolved detection home).
- **Ordering law.** Sorted-key literals appear in ACTUAL code-unit order; `localeCompare` is banned
  (PT-1 source-pins both over the resolved home).

## Fold/precision notes carried into the rows

- **B1 (ghost verb):** W3/W7 name the harness-native login verbs (`claude auth login` / `grok login`)
  and `baton doctor --check`, never `baton credentials refresh` — `invalidNextCommand` rejects it,
  PT-4p pins the parser refusal.
- **B2 (W4 no double-report):** PT-8's three-way split (band → warning; below floor → block only;
  at/above band → neither) on the SAME quantized read.
- **B3 (fail-open):** PT-13 — a throwing detection omits its warning and never throws; an
  all-throwing compose is `[]`.
- **B4 (web northbound):** PT-3 — the ONE named additive field survives the JSON round-trip
  (`{ ...readiness, warnings: readiness.warnings ?? null }`), now on the REAL served web card
  (`deployment.card()`), not a synthetic object.
- **B5 (W3 sourcing):** PT-7 — the grok early-invalidation **window** fires despite `state:'fresh'`
  (the window is the deployment's classification at application-deployment.mjs:459, not the
  state-class); PT-12 anchors the no-new-clock claim to that classification.
- **B6 (W2 honest code):** PT-6 — the cause names `coordination_writer_lost`, not `…_busy`.
- **B7 (W5 dead-end):** PT-4 — W5 names the manual `git update-ref -d refs/baton/(results|checkpoints)/…`
  path, not `adopt`/`integrate`; the command validator allows only that one named git step.
- **B8 (schema order):** PT-1 — `Object.keys(row)` deep-equals
  `['cause','code','next','severity','summary']`.

## Fold-2 blue-team resolutions (see suite-fold-2.md for the finding→resolution map)

- **F1 (PT-10 vacuous #137):** the W6 fixture is a VALID schema-v2 selector + matching profile +
  ABSENT socket; the anti-misdirection retargets `setupBatonConnection` (v1.2), verified RED today;
  the resident-starting diagnosis is asserted.
- **F2/F6/F7/F10 (PT-3 parity):** real-surface `doctorReadiness()` sibling (non-enumerable,
  byte-stable), identical rows on the served web card, sanitize-at-source canary, CLI/MCP source
  pins, local-depth subset (never W3/W7), defineProperty source pin over the resolved home AND
  `application-deployment.mjs`.
- **F3 (PT-11 max accessor):** order-discriminating fixtures — highest eventSeq NOT last, highest in
  the MIDDLE of three, quiet when a lower row failed auth; `buildDegradedReads`' W7 observations are
  reordered so the highest is not last.
- **F4 (PT-4 ghost git verb):** `invalidNextCommand` rejects unknown `git <verb>` (only the W5
  ref-deletion anchor is allowed) and fabricated `#NNN` (only the evidence-tree anchors).
- **F5 (PT-5 live-owner discriminator):** `plantOwnerReceipt` writes a VALID 15-field receipt;
  live-owner (real pid + `/bin/ps` pidStart) → quiet, dead-owner → fires.
- **F8a (PT-5 reserved-fraction):** a REAL reservation ledger (worktree-capacity authority, 7GiB ≥
  0.8×8GiB) fires W1 with ghostCount === 0; the policy passed to the detection carries the sealed
  runtime-reserve values so an authority-based read's policy digest matches.
- **F8b (PT-9 checkpoints):** a checkpoints-only fixture (`refs/baton/checkpoints/pin-N` × 257)
  crosses the ceiling.
- **F9 (PT-L fixture-lint):** stage-independent green pin that proves each fold-2 fixture is the
  condition it claims.

## Non-arbitrary numeric defaults (the campaign law)

The configurable thresholds are deployment authority, not control mechanisms on work, and each is
documented at its derivation:
`approachMargin = 0.25`, `ghostReservedFraction = 0.8`, `resultPinCeiling = 256` (the refs-growth
cost class — ref walks scale with census), `maxWarningRowBytes = 280` (W6's resident-window cause in
UTF-8 incl. its multibyte `→`), `grokEarlyInvalidationMs = 5 min` (application-deployment.mjs:71),
`minFreeBytes = 512MiB` / `minFreeInodes = 100_000` (the existing floor, §1.1). None is a page-cap /
retry-count / turn-limit on work. The reserved-fraction fixture's `runtimeReserveBytes = 64MiB` /
`runtimeReserveInodes = 10_000` are the capacity-policy's runtime-reserve defaults (worktree-capacity
policy fields), passed through the W1 `policy` so the fixture's ledger digest matches an
authority-based read.
