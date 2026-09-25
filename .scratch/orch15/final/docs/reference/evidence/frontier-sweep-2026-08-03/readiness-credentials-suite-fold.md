# Suite fold: readiness-credentials blue-team → red-first suite (2026-08-03)

Folded against **`readiness-credentials-blueteam.md`** (this directory, GATE-NOT-READY, 7
blocking items) on 2026-08-03, per the campaign methodology (contract → red-first suite →
blue-team → fold → implementation wave). Edit targets, exactly four: the suite
(`impl/test/readiness-credentials-red.test.mjs`), the fixture
(`impl/test/fixtures/fake-grok-credential-refresh.mjs`), the contract
(`readiness-credentials-contract.md`, this directory — the drift item only), and this summary.
No `impl/src` file was touched. NUL-containing sources verified with `grep -an`/`sed -n` only.

**Split: 17 red / 4 green (21 rows) → 21 red / 5 green (26 rows).** Suite run from the repo
root: `node --test impl/test/readiness-credentials-red.test.mjs`, Node v25.8.0, **two
consecutive runs, identical** (26 tests, 5 pass, 21 fail, exit 1). Every red row fails at its
named stage (line+message table below); the five pins (RT-4p, RT-5p, **RT-10p** (new), RT-13b,
RT-13c) are green for legitimate reasons only. No row was weakened to pass; the suite stays
red-first — every contract-mandated-but-missing capability still fails.

---

## 1. Blocker-by-blocker fold record

### Blocker 1 — fixture HOME confinement (safety, highest priority) — FOLDED

**Fixture** (`fake-grok-credential-refresh.mjs`): after the established argv gate
(`--baton-grok-refresh-fixture`, which keeps `node --test` discovery inert — exit 0, silent),
the fixture now **fails closed** (exit 1, named reason on stderr) unless BOTH:

- `BATON_FAKE_GROK_FIXTURE === '1'` (the explicit suite sentinel), AND
- `HOME` resolves under the `os.tmpdir()` realpath. realpath absorbs the macOS
  `/var`→`/private/var` symlink drift; the check walks to the nearest existing ancestor so a
  not-yet-created confined HOME still validates.

HOME unset, sentinel missing, or HOME outside the tmpdir each refuse **before any write**.
Verified live (sandbox, then removed): no-gate → exit 0 silent; gate without sentinel → exit 1
(`…refusing to run — the BATON_FAKE_GROK_FIXTURE=1 suite sentinel is not set`), pre-seeded
operator-shaped `auth.json` byte-identical afterwards; sentinel + tmpdir HOME → full run
(counter/writeback/fresher credential); sentinel + outside HOME → exit 1 (confinement message);
sentinel + HOME unset → exit 1.

**Suite**: new pin **RT-10p** with three legs — (A) no sentinel → non-zero exit, stderr names
the sentinel, the pre-seeded marker credential is byte-identical, no `fixture-spawns`/
`fixture-writeback.json`; (B) sentinel + HOME outside the tmpdir → non-zero exit, confinement
stderr, nothing written (the target path's parent chain does not exist, so even a broken check
could not write); (C) positive control: sentinel + sandbox HOME → exit 0, the independent
observation files and fresher credential land inside the sandbox. The RT-10a/RT-11 refresh
runs pass the sentinel through the new header-declared **`cmdEnv`** seam, **with `TMPDIR`
alongside** — the runtime's scoped child env (claude-credential-cache.mjs:129-134 pattern)
carries no `TMPDIR`, so without it the fixture child's `os.tmpdir()` resolves `/tmp` and the
confinement check would refuse the legitimate flow (caught on the first post-fold run; fixed
in the same fold).

### Blocker 2 — RT-12 vacuous projection-tree scan — FOLDED

The row wired `credentialFiles: {}` and scanned only the env channel while grok's real worker
projection copies `~/.grok/auth.json` wholesale (verified `defaultCredentialProjection`,
application-deployment.mjs:606-608 — refresh_token included, today). Restaged:

- New header-declared seam: the cache's file-projection surface **`projectionFiles()`**
  (sibling of `projectionEnv()`, claude-credential-cache.mjs:229-234) — the access-token-only
  credential file list the deployment wires into `RuntimeIsolation`.
- The row now requires `projectionFiles()` to exist (absence fails at the named stage), keeps
  the vendor-native `auth.json` basename (fold F-3), scans **every projected file** for the
  refresh-token bytes, and requires the access token to be present (a projection that drops
  both tokens is not a pass).
- That list is wired into the isolation fixture as `credentialFiles: { grok: files }`; the
  #11 CC-4 tree scan now has teeth on grok's native channel: no projected worker file may
  contain the refresh-token bytes **and at least one must carry the access token** (without
  this second leg the tree scan is vacuous against a projection that projects nothing). The
  env half is unchanged.

### Blocker 3 — RT-6×RT-9 mutually ungreenable — FOLDED (contract-literal reading)

The contract is not silent: §4.2.2 assigns the provenance to the fleet_roster **operation** ("a
new precedent in that plane", the `route.advice` envelope precedent, cairn-run-scorecard.mjs:162).
Reconciled on that reading — no contract shape amendment, RT-6's closed sets untouched:

- **Contract** (the fold's drift-item edit): §4.2.2 now states the fields are "claimed on the
  operation's own result/registration envelope (the `route.advice` envelope precedent) —
  **never as fields of the §4.2.1 document**, whose shape stays closed"; §6 RT-9 carries the
  same one-clause precision.
- **Suite** RT-9: the two `assert.match(serialized, …)` document assertions are replaced by a
  registration-envelope source pin over `impl/src` files carrying the `fleet_roster`
  registration: at least one must claim `routingMutationAuthority: false` AND
  `workerAuthority: false` (literal-pair regexes). The advanced-family registration regex and
  the doctor/roster drift deepEquals are unchanged; the row still reds today at the
  registration stage. A contract-literal implementation (document per §4.2.1, provenance on
  the operation) now greens both rows; stuffing provenance into the document false-reds RT-6 —
  the conflict is closed. Pin-breadth note (mirrors RT-8's WEAK caveat): an implementation
  that factors the envelope into a shared helper in a file that never names `fleet_roster`
  would false-red the pin; the assertion message names the expectation.

### Blocker 4 — RT-10a/RT-11 false-red on the re-export home — FOLDED

- New helper `resolveGrokCredentialCacheHome()` returns `{klass, source}`: the dedicated
  `src/grok-credential-cache.mjs` module when it exports the class (which is also where an
  application-deployment.mjs **re-export** points — the ClaudeCredentialCache
  :1761 pattern), else `application-deployment.mjs` when the class is defined inline there,
  else `{null, null}`. The source pins now read the home the class was **actually resolved
  from** — the unconditional `readFileSync(src/grok-credential-cache.mjs)` throws are gone
  from both rows.
- The `.credentials.json` absence scan (and the `.grok` presence / `O_EXCL` pins) runs over
  `stripComments(source)` — block and tail comments are stripped, string literals stay (a path
  literal is code; a comment explaining the F-3 distinction by naming the claude convention is
  documentation). Both rows also pass the fixture sentinel via `cmdEnv` (blocker 1).

### Blocker 5 — RT-14a/b negative control — FOLDED

Both rows gain a third route on a **second credential identity**: `ROUTE_CODEX`
(`codex/gpt-5.6-sol/high`, the codex vendor's single global credential — empirically verified
static-`ready` under the suite's fixture gates before staging). Each row now:

- warms the control route to `verified` alongside the two grok routes;
- asserts the control's `credentialKey` differs from the grok routes' key (a single global key
  for every route fails here — that is the unscoped-identity bug class itself);
- after the grok `invalid_grant` fan-out (probe-sourced in RT-14a, worker-turn in RT-14b),
  asserts the control row **stays `verified`** with its key untouched — an
  invalidate-everything implementation now fails the epic's keystone fold (F-1). The `ProbeAdapter`
  gained a `family` option so the codex card is coherent; all pre-existing assertions
  (shared-key equality, row-B fan-out, no-re-probe-storm) are unchanged.

### Blocker 6 — contract adoption of suite surface — FOLDED (facade spelling)

Contract §4.2.2's surfaces bullet now reads "**A `fleet_roster` command + capability +
facade**": CLI `baton fleet roster`, the **`deployment.fleet.roster()` facade** (sibling of
`waves.start`, application-deployment.mjs:1219, adopted on this fold per the bidirectional-v3
C3 `messageReceipt` suite-surface precedent), and the `fleet_roster` operation in the ordinary
plane's advanced `fleet_*` family — one projection function, three read surfaces. The suite
header's seam note is updated to record the adoption. `deployment.fleet` is undefined today
(verified), so RT-6/6b/7/8/9 keep their honest red stage.

**Deferred sub-items of blocker 6** (out of this fold's contract-edit scope — the tasking
scoped contract edits to the `fleet.roster()` drift item; recorded for the next contract
revision, all verified against the swept tree): record the `candidate` field in the §4.3.2
envelope enumeration (landed claude honors it, claude-credential-cache.mjs:329); make the
`<route>-probe ok` instruction phrasing normative in §4.1.1; correct the stale citations
(`PROVIDER_TERMINAL_GUIDANCE` application-semantics.mjs:1946 — the suite's RT-13c message is
fixed in this fold; `_inFlightCount` coordinator.mjs:2816-2823 — the suite's RT-7 message is
fixed; the §1.2 wave-driver "doctor() per member" premise — wave-driver.mjs:274-292 calls
`doctor()` once per `run()`).

### Blocker 7 — coverage rows — ALL FOUR ADDED

- **RT-2b (stale-window re-probe)** — RT-2's own acceptance leg finally has an oracle. The
  tier's consult compares `expiresAt` against `now`, so the suite injects the deployment clock
  via the new header-declared seam **`advanced.liveness.now`** and advances it past the minted
  window (bounded ≤28 min, checked): the next consult must probe **exactly once** more and
  re-mint the window, and the post-re-probe fresh window must probe zero. Cache-forever fails;
  probe-per-call fails upstream in RT-2. Reds today at the honest wiring stage
  (`advanced contains unsupported field liveness`, the RT-13a pattern).
- **RT-3b (timeout enforcement)** — new `hang` adapter mode (spawned + provider_call started,
  the turn never completes). With `advanced.liveness.probeTimeoutMs: 250` the gate must refuse
  `provider_unreachable` (§4.1.1's network/timeout class) with exactly one provider call and a
  `readiness.probe_failed` record within the ≤120s bound; the row races the gate against a 5s
  unref'd deadline so a watchdog-less implementation fails with a named message instead of
  hanging (the deadline is a resource bound on the row, recorded in the header control-law
  note). Reds today at the same wiring stage as RT-2b.
- **RT-6b (populated learning bucket)** — real evidence through the sibling-exact write seam
  the coordinator itself uses (`router.record`, index.mjs:1428), keyed
  `routeTupleKey(adapter.card(), model, effort, 'general')` (route-tuple.mjs:1-5, the
  coordinator's own derivation): 3 verified wins + 1 loss, co-timed so decay scales weight and
  count identically (router.mjs:45-49) and `winRate` is exactly **0.75** at any projection
  time — a fabricated default prior fails exactly, not approximately. Asserts `mode` from
  `router.snapshot().mode`, `samples`/`weight` within decay-negligible bounds, `seededFrom`
  vocabulary when present, and that the bucket-absent sibling route still projects
  `learning: null` (no prior leak across routes). Reds today at `no fleet.roster()`.
- **RT-7b (doctor-row occupancy)** — §4.2.2 extends **doctor** rows with liveness AND
  occupancy; only liveness had rows. Three genuinely in-flight seats
  (`coordinator._inFlightCount('grok') === 3`, :2816-2823) then the doctor row must carry
  `occupancy.inFlight === 3`, `concurrencyCeiling === 64` from the card, and keep `liveness`.
  Reds today at the named "doctor rows carry no occupancy projection" stage.

**Remaining report-tail coverage items — DEFERRED with reasons:** (e) harvest schema-gate +
staler-candidate negatives — needs new fixture modes (an invalid-schema/staler write-back);
the tasking scoped fixture changes to the safety fix, so these are queued for the first
implementation-wave fixture revision; (f) probe/worker verdict → controller LATCH at the
deployment level — partially composed (RT-14a/b pin liveness-row fan-out, RT-13a pins the
explicit-refresh latch + doctor block), but the probe→latch wire needs the deployment-level
latch seam named in the contract first; (g) §4.3.2 shared runtime envelope + typed
`authentication_refresh_timeout` — needs the formalized runtime class named as a suite seam;
deferred rather than invented unilaterally; (h) probe read-only side-effect (§4.1.1 red-team
target) — stageable cheaply (router snapshot + `routeObservations()` equality across a probe)
but outside the tasking's four named items; noted for the next suite revision.

### Report §4 item — RT-13b WEAK pin — STRENGTHENED (item 8 of the fold tasking)

The pin now slices the whole `const revokedTombstone = …;` statement and asserts the
**conjoined literals** (`value.access_token === '' && value.refresh_token === ''`,
application-deployment.mjs:364; `value.expires_at === 0 && value.expires_in === 0`, :365) AND
**zero `||` in the statement** — the `&&`→`||` flip (tombstone misdiagnosis: a partial record
promoted to revoked) now fails two independent assertions. Pin stays green today (verified
against the live source). **Behavioral oracle: documented, not staged** —
`kimiAuthenticationState` is module-private and reads the real `~/.kimi-code` root
(application-deployment.mjs:338-398); executing it against a partial record would require an
`impl/src` export change, which a red-first pin cannot demand.

### Item 9 — re-run and split — RECORDED

See the header of this document and §2 below.

---

## 2. Post-fold verification record

- Suite: `node --test impl/test/readiness-credentials-red.test.mjs` from the repo root, Node
  v25.8.0 — **two consecutive runs, identical**: 26 tests, **5 pass / 21 fail**, exit 1.
- Pins (green for legitimate reasons): RT-4p, RT-5p, RT-10p (new), RT-13b (strengthened),
  RT-13c.
- Every red row fails at its named stage (first failure message):

  | Row | Stage message (first assertion) |
  |-----|----------------------------------|
  | RT-1a | stage #47: the spawn gate never probed the route |
  | RT-1b | stage #47: a die probe did not refuse the spawn |
  | RT-2 | stage #47: the first (cache-absent) consult performs exactly one probe |
  | RT-2b | stage #47: liveness tier wiring missing — `advanced.liveness` unsupported |
  | RT-3 | stage #47: one consult is exactly one provider call (0 probes) |
  | RT-3b | stage #47: liveness tier wiring missing — `advanced.liveness` unsupported |
  | RT-4 | stage #47: `liveness.state` null ≠ `unverified` (separate field) |
  | RT-5 | stage #47: the warm-up consult probes exactly once (0) |
  | RT-14a | stage #47: route B must be live-verified first (tier missing) |
  | RT-14b | stage #47: route A must be live-verified first (tier missing) |
  | RT-6 / RT-6b / RT-7 / RT-8 | stage #83: no `fleet.roster()` facade surface |
  | RT-7b | stage #83: doctor route rows carry no occupancy projection |
  | RT-9 | stage #83: `fleet_roster` not registered in the advanced `fleet_*` family |
  | RT-10a / RT-10b / RT-11 / RT-12 | stage #84: `GrokCredentialCache` is not landed |
  | RT-13a | stage #84: `advanced.grokCredentials` unsupported |

- Fixture live-run (sandboxed HOME, since removed): all five invocation modes behave per
  blocker 1 above; the positive leg reproduces the pre-fold observation set
  (`fixture-spawns` = 1, `fixture-writeback.json` with `projectedGrokTree: true`,
  `flatClaudeSibling: false`, target `…/home/.grok/auth.json`, fresher `auth.json`).
- #11 regression check: `node --test impl/test/claude-credential-projection-red.test.mjs` —
  **10/10 pass** (the fold touched nothing it reads).
- Absence greps unchanged: zero `GrokCredentialCache`/`fleet_roster`/`fleetRoster`/
  `grokCredentials` hits in `impl/src/` — the "machinery missing" stage remains honest.

## 3. Rows added / changed (suite)

- **Added (5):** RT-10p (fixture fail-closed pin), RT-2b (stale-window re-probe), RT-3b
  (timeout enforcement), RT-6b (populated learning bucket), RT-7b (doctor-row occupancy).
- **Changed (8):** RT-14a/RT-14b (second-credential negative control), RT-9 (provenance moved
  to the operation-envelope source pin), RT-10a/RT-11 (home-resolved + comment-tolerant source
  pins, `cmdEnv` sentinel), RT-12 (file-channel restage via `projectionFiles()`), RT-13b
  (conjunction pin), RT-13c (cosmetic cite :1888→:1946), RT-7 (cosmetic cite
  :2800-2806→:2816-2823).
- **New suite-chosen seams (all declared in the suite header):** `advanced.liveness`
  (`{now, probeTimeoutMs}`), `GrokCredentialCache.projectionFiles()`, the refresh runtime's
  `cmdEnv` merge (carries `BATON_FAKE_GROK_FIXTURE` + `TMPDIR` to the fixture child), and the
  `routeTupleKey(card, model, effort, 'general')` learning-key derivation used by RT-6b.

## 4. Rejected / deferred items (with reasons)

- **Contract amendments beyond the drift item** (blocker 6 sub-items: `candidate` in §4.3.2,
  normative probe phrasing, stale citations) — deferred; the tasking scoped contract edits to
  the `fleet.roster()` drift item. The two suite-side citation fixes (RT-7, RT-13c messages)
  landed because the suite is a fold target.
- **RT-1a F-4 digest-for-digest binding, RT-8 source-pin breadth, RT-7 per-route-vs-per-vendor
  attribution note** — blue-team WEAK verdicts outside the tasking's fold list; left as
  recorded WEAK (none is a blocker). RT-1a's chain-shape pin and RT-8's canary scan keep their
  teeth; the sharpening is queued for the next suite revision.
- **Coverage items (e)-(h) of blocker 7** — deferred per the reasons in §1/blocker-7 above.
- **RT-13b behavioral oracle** — not stageable from the suite (module-private function, real
  HOME); the conjunction pin is the sharpened form. Documented per the tasking.
