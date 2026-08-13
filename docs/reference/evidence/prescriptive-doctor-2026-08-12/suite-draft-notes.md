# #72 SUITE — red-first draft notes

**Suite:** `impl/test/prescriptive-doctor-red.test.mjs`
**Binding contract:** `prescriptive-doctor-contract.md` (**v1.1** — source of truth; folded against
`contract-redteam.md` via `contract-fold.md`, this directory).
**Verification command (§7):** `node --test impl/test/prescriptive-doctor-red.test.mjs`

## Verified split (run twice from the repo root)

| run | tests | pass | fail | note |
|-----|-------|------|------|------|
| 1 | 16 | **3** | **13** | 3 guard pins green; 13 PT rows red at the stage guard |
| 2 | 16 | **3** | **13** | identical — **STABLE** |

The 13 red rows fail at the stage guard — `resolvePrescriptiveDoctorHome()` returns
`{ surface: null, source: null, home: null }` because the prescriptive-doctor surface is not yet
landed. They go green only on a contract-correct implementation. The 3 guard pins pass today on
surfaces the contract says #72 leaves **unchanged**; they must stay green after landing.

## Inventory

### GREEN guard pins (pass today; guard unchanged behavior)

| ID | Pins (contract §) | What it guards |
|----|-------------------|----------------|
| **PT-2p** | §4.2/§4.4 | the `warning_*` namespace is disjoint from the blocking refusal codes; the catalog is a closed, duplicate-free set; the local subset {W1,W2,W4,W5,W6} and the remote-only {W3,W7} partition the catalog (OQ1). |
| **PT-4p** | §4.3, B1, §5 | `parseBatonCli` accepts `doctor`/`serve` and the four doctor depths; **no new doctor depth** (a `warnings` depth is a v1 non-goal); the ghost verb `baton credentials refresh <provider>` is rejected (B1). |
| **PT-8p** | §1.1, §4.2 | the existing `worktree_capacity_exceeded` block still fires below the floor through a real `openBaton` doctor read — the blocking side is untouched by #72. |

### RED rows (fail today — stage: prescriptive-doctor surface missing)

| ID | Contract § | Stage / what lands |
|----|-----------|--------------------|
| **PT-1** | §4.1, §4.4, B8 | catalog closure (exactly the 7 codes) + closed row schema in ACTUAL code-unit order; `localeCompare` banned. |
| **PT-2** | §4.2 | warnings NEVER block — blocking codes never inside `warnings`; the wave-driver preflight does not read `warnings` in v1. |
| **PT-3** | §4.2, B4, #103 D6 | surface compose — ONE named `warnings` field; non-enumerable sibling (byte-stable serialize); sanitized at source (no token canary); `doctorReadiness()` attaches it by the D6(b) `defineProperty` pattern. |
| **PT-4** | §4.3, B1, B7, #136 | every `next` non-empty, a real verb/command/doc anchor, and reduces the cause; W5 → manual ref-deletion, never `adopt`/`integrate`. |
| **PT-5** | §4.1 W1 | ghost-worktree census fires on unregistered residue; quiet on a registered/clean tree (precision law). |
| **PT-6** | §4.1 W2, B6 | stale-writer-lease fires on a dead pid AND a pidStart mismatch; quiet on a live lease; cause names `coordination_writer_lost` (not `…_busy`). |
| **PT-7** | §4.1 W3, B5, §3 | credential TTL metadata-only — claude `stale` and the grok early-invalidation **window** fire (window sourced from the deployment classification, not the state-class); fresh is quiet; no token material emitted. |
| **PT-8** | §4.1 W4, B2 | disk-floor approach band fires above the floor; below the floor the block fires and W4 is **suppressed** (disjoint by construction); at/above the band neither. |
| **PT-9** | §4.1 W5, B7 | result-pin census fires above the bound; quiet below. |
| **PT-10** | §4.1 W6, §4.2, B.2 | resident-not-published fires while the authority outline is private (severity `notice`); the #137 `create_profile` misdirection is replaced in `inspectBatonConnection`. |
| **PT-11** | §4.1 W7 | route last-auth-failure fires on the highest-eventSeq failed auth result; `completed`/non-auth quiet; read is a per-route max accessor (not `routeObservations()` full clone-sort). |
| **PT-12** | §3, §4.1, B5 | no warning mints an elapsed-time wall-clock control (`now - activity > threshold`); honest reads stay in the pre-existing classes (expiry state-class/window, statfs, `/bin/ps` pidStart, event-seq). |
| **PT-13** | §4.1, §4.2, B3 | every detection is FAIL-OPEN — a throwing detection omits its warning and never throws; an all-throwing fixture composes `[]` (byte-identical to clean, so no `wave_driver_route_unready`). |

## Stages

The single stage today: **the prescriptive-doctor warning surface is not landed.**
`resolvePrescriptiveDoctorHome()` returns `{ surface: null, source: null, home: null }`. Every PT row
stage-guards on `surface.composePrescriptiveWarnings` and is RED. The implementation lands the
surface (exporting the invented signatures below) and the rows go green.

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
- **Hermetic.** Every root is `mkdtempSync` under `os.tmpdir()` and removed in `test.after`; no
  network; no real credential reads (W3 plants metadata-shaped objects only). The W2 fixture writes
  the REAL writer-lease schema `{schemaVersion:2,pid,pidStart,token,acquiredAt}`
  (coordination-store.mjs:1294-1296); the live-lease precision case computes the real
  `/bin/ps -o lstart= -p <pid>` identity the lease already uses.
- **No clocks.** The only wall-clock dependency is the W2 `/bin/ps` process-identity read (a physical
  identity, not a control) and a fixed injected epoch (`NOW`) for the W3 fixtures — never the real
  clock. PT-12 source-pins that no detection mints an elapsed-time `now - activity > threshold`
  comparison.
- **Precision law.** Every detection has a quiet/healthy counterpart assertion (the false-positive
  fails the row): W1 clean tree, W2 live/empty lease, W3 fresh credential, W4 at/above band + the
  block-suppressed band, W5 under-bound, W6 published, W7 completed/non-auth.
- **NUL discipline (§8).** `application.mjs` and `coordination-store.mjs` carry NUL bytes; the suite
  cites their anchors in comments only (verified by the contract at HEAD `dc569eaa…`/`4758d8fa…`).
  Source scans target the NUL-free inventories (`application-deployment.mjs`, `wave-driver.mjs`, the
  resolved detection home).
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
  (`{ ...readiness, warnings: readiness.warnings ?? null }`).
- **B5 (W3 sourcing):** PT-7 — the grok early-invalidation **window** fires despite `state:'fresh'`
  (the window is the deployment's classification at application-deployment.mjs:459, not the
  state-class); PT-12 anchors the no-new-clock claim to that classification.
- **B6 (W2 honest code):** PT-6 — the cause names `coordination_writer_lost`, not `…_busy`.
- **B7 (W5 dead-end):** PT-4 — W5 names the manual `git update-ref -d refs/baton/…` path, not
  `adopt`/`integrate`.
- **B8 (schema order):** PT-1 — `Object.keys(row)` deep-equals
  `['cause','code','next','severity','summary']`.

## Non-arbitrary numeric defaults (the campaign law)

The configurable thresholds are deployment authority, not control mechanisms on work, and each is
documented at its derivation:
`approachMargin = 0.25`, `ghostReservedFraction = 0.8`, `resultPinCeiling = 256` (the refs-growth
cost class — ref walks scale with census), `maxWarningRowBytes = 280` (W6's resident-window cause in
UTF-8 incl. its multibyte `→`), `grokEarlyInvalidationMs = 5 min` (application-deployment.mjs:71),
`minFreeBytes = 512MiB` / `minFreeInodes = 100_000` (the existing floor, §1.1). None is a page-cap /
retry-count / turn-limit on work.
