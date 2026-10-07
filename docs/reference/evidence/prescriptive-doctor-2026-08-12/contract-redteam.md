# #72 RED-TEAM REPORT — adversarial attack on the prescriptive-doctor contract v1.0

**Attacker's HEAD:** `4758d8fa37fdcd5e534862cf52b0cdd2ab7e4fcc` (the Baton private effective-tree snapshot).
**Verification basis:** every citation below re-verified at this HEAD with `grep -an` / `sed -n`; the
`impl/src` tree is byte-identical to the contract's claimed verification HEAD
(`dc569eaa0e2c400029eea88996ec086ecd59356b`, verified `git diff` empty over `impl/src`), so the two
NUL files were cited with `grep -an` only, exactly as §8 demands.

**Summary verdict: NOT FOLD-READY.** Nine numbered blockers (§D). The catalog's shape is right — closed
set, non-enumerable sibling, severity split, #135 compose — but the detection substrates carry four
mis-citations, the W4 threshold cannot satisfy its own acceptance pin, W3's read path does not expose
the metadata its threshold needs, the web northbound is missing from the surface model, and W3/W7's
action link is a ghost verb the CLI parser cannot invoke.

---

## A. Citation verification (brief item 1)

All §8-listed NUL anchors resolve: `application.mjs:12373-12400` (`doctorReadiness()`, workspace
`{state:'ready'}` at 12394) ✓; `coordination-store.mjs:63-90` (`writerProcessStartIdentity` at 63,
`writerOwnerState` at 72-90, `/bin/ps -o lstart=` at 65) ✓; `coordination-store.mjs:1289-1339`
(`claimWriterLease`) ✓; `coordination-store.mjs:3517-3529` (route-observation fields incl.
`terminalStatus`, line 3521) ✓; `coordination-store.mjs:8066` (`route.outcome_observed` write) ✓;
`coordination-store.mjs:11412` (`routeObservations()`, eventSeq-sorted) ✓.

All §1.1 core citations resolve: `application-deployment.mjs:1317-1357` / `1336-1337` / `1346-1355` /
`1359-1360` / `535-565` / `538-540` / `532-533` / `53-54` / `555-563` / `71` / `459` / `909` ✓;
`application-semantics.mjs:2064-2076`, `2101-2104` ✓; `web-northbound.mjs:266` ✓;
`application-cli.mjs:1261-1267`, `489-638`, `1961-1978`, `450`, `483`, `461-464`, `1266`, `2316-2325`,
`2338-2345` ✓; `impl/scripts/baton.mjs:79-98` ✓; `mcp-northbound.mjs:564-567`, `1806-1808`,
`2118-2130`, `2135-2149` ✓; `wave-driver.mjs:302-337` ✓. All §1.2/§3/§4/§5/§6/§7 evidence-doc anchors
resolve (ledger 12-14, 53, 104-108; readiness-credentials 21-24, 236-257, 242-244, 382-387, 422-425,
477-481, 760-766; briefing-pack 23-24, 309-317, 319-326; bidirectional-v3 134-143;
setup-token 112-116, 205-209; cli-surface-audit 83) ✓.

Seven discrepancies — four of them substantive:

1. **§1.2 W2 substrate misreads the code.** "a stale `writer.lease` blocks new writers until the next
   acquire retries (coordination-store.mjs:1318-1325)". Lines 1318-1325 do the opposite: a stale lease
   is **unlinked and the same acquire proceeds** (`unlinkSync(path)` at 1324, `claim()` at 1326).
   `coordination_writer_busy` at 1321-1323 fires only for `active`/`unknown` priors, never `stale`.
   The genuine stale-lease failure mode is `_assertWriterLease`'s `coordination_writer_lost`
   (coordination-store.mjs:1349-1350) for a store instance without an in-memory lease.
2. **§1.2/§3 W3 misattributes the early-invalidation arithmetic.** "the same early-invalidation
   arithmetic the spawn-TTL gate already rides (grok-credential-cache.mjs:312)". Line 312 is
   `if (this.credential.expiresAt <= this.now()) return this.refresh({ reason: 'spawn_ttl_gate' });` —
   **plain expiry, no window**. The `GROK_AUTH_EARLY_INVALIDATION_MS` comparison lives only at
   `application-deployment.mjs:459` inside `grokAuthenticationState`, a different read not surfaced by
   the doctor's grok probe (see B5).
3. **§3 cites the wrong passage for the statfs carve-out.** "`statfsSync` free space is a
   physical-resource read (readiness-credentials-contract.md:242-243)". Lines 242-243 are the **28-min
   TTL** passage ("vendor-observed physical bound ... a cache-freshness derivation and a cost bound"),
   not statfs. The parallel is defensible; the citation is not.
4. **§0 misattributes the oversize-refusal incident.** "Silent oversize refusal (#129) — the wave
   refused at render (4116>4096) (orchestrator-friction-ledger.md:14)". Ledger line 14 tags the
   4116>4096 render wall as **#101** ("Recipe-render 4096 objective wall ... **#101**"); in the same
   ledger #129 is the "wave had zero runs" incident (line 104). The contract's cross-reference list
   (§0 line 11) repeats "#129 (silent oversize refusal)". The evidence tree does not support that
   attribution.

Three minor:
5. **§4.1 schema order contradicts the ordering law.** `{code, cause, next, severity, summary}` is
   claimed to be "the field set in ACTUAL code-unit order". Actual code-unit order is
   **`cause, code, next, severity, summary`** ('cause' < 'code' at the third code unit, verified by
   sort). The same §4.1 bans `localeCompare`; a fixture enforcing the law cannot also produce the
   example order.
6. **§1.2 grok range truncation.** "Grok's `GrokCredentialCache.metadata()` exposes `{expiresAt,
   state}` (grok-credential-cache.mjs:290-299)" — the object's `state` field is at **line 300**; the
   cited range ends at 299.
7. **§1.2 listWorktrees anchor.** "listWorktrees ... (worktree.mjs:6, 483-523, 1412-1421)" — the
   enumeration function is **worktree.mjs:2010**; the cited lines are the module-header comment (6) and
   two usage sites.

---

## B. Attack results

### B.1 The warning catalog (D1)

**W4 — threshold wrong in both directions; PT-8 is unsatisfiable as written.**
The warning threshold is `freeBytes < minFreeBytes × (1 + approachMargin)` (512MiB × 1.25 = 640MiB)
and the block threshold is `freeBytes < minFreeBytes` (512MiB), both on the **same quantized**
`statfsSync` read (application-deployment.mjs:538-555). Because 640 > 512, the warning condition is a
strict superset of the block condition: **whenever the block fires, the warning fires too**. Concretely,
raw free 500MiB quantizes to 448MiB (`500 − 500%64`) → `448 < 512` (blocked) **and** `448 < 640`
(warning) → the doctor emits `workspace.state:'blocked'` **and** `warning_disk_floor_approaching`
simultaneously — the exact double-report §4.1 ("the existing ... refusal fires instead") and PT-8 ("the
warning does NOT") forbid. And at *exactly* the floor (raw = 512MiB, quantized 512MiB), the strict `<`
block does not fire at all, while the warning does — the opposite of PT-8's "at the floor, the blocking
refusal fires". The pin fails both directions. **Fix:** either (a) suppress W4 when the workspace
projection is `blocked` (a precedence rule on the same read — no second probe), or (b) bound the warning
to the approach band explicitly: `freeBytes < 640 && freeBytes >= 512` on the quantized value. Both are
spec changes, not implementation details.

**W3 — the detection read cannot produce the threshold (see B.4 / B5).** Most gameable warning: the
read path claimed (§1.2, W3) is "the doctor's existing fresh credential probes
(application-deployment.mjs:1318-1320)", but the grok probe (application-deployment.mjs:1950-1959)
returns **null for every state except `expired_needs_login`** — it collapses exactly the `stale` /
`expiresAt` / early-invalidation metadata W3's threshold needs. The claude probe (2004) returns full
metadata; the grok probe does not. An implementer who follows the detection-read literal cannot emit
the grok half of W3.

**W1 — false-positive noise (precision law).** `ghostCount = physicalResidue − registeredCount > 0`
fires on **transient residue**: during an in-flight `git worktree add`, the physical `.baton/wt/ws-*`
dir exists before git registers it; `.baton/verify/<label>-<suffix>` sandboxes likewise exist in a
pre-registration window. A concurrent doctor read during a wave's worktree creation therefore reports a
"ghost" that is not a ghost. The contract names no discriminator (a pid/lease owner check would do) and
— under the no-clock law — no grace window. Also, the threshold's second clause ("total reserved bytes
across registered worktrees ≥ 0.8 × maxReservedBytes") needs a **reservation-sum read** that the
detection read does not list (counting registrations does not read reservation records), so the
detection read and threshold are mismatched.

**W2 — detection is sound, cause message is dishonest.** A dead-pid lease/claim is a real condition,
but the cause message "until then the store refuses `coordination_writer_busy`" names the wrong code:
stale priors never produce `coordination_writer_busy` (1321-1323); the stale-lease refusal that exists
is `coordination_writer_lost` (1349-1350). The #41 law (cause beside the code, honestly) is violated,
and the substrate sentence (§1.2) misreads the very lines it cites (A1).

**W5 / W7 — the census-cost law.** Both reads are unbounded scans on **every** doctor call, and the
MCP doctor is quota-free and per-call fresh (mcp-northbound.mjs:2118-2130). W5 spawns
`git for-each-ref refs/baton/results refs/baton/checkpoints` whose output grows with the pin count —
the very quantity it warns about. W7's `routeObservations()` (coordination-store.mjs:11412) **clones
and sorts the entire route-observation history** per read to find one highest-eventSeq row; a per-route
max accessor would be O(routes). Neither is "expensive" in absolute terms, but both scale with the
problem and both spawn subprocesses/full-clone on a quota-free surface. Worth a bound in the spec.

### B.2 The severity/surface model (D2)

**Never-blocks has no fail-open pin — the strongest block vector in the contract.** PT-2 tests
byte-identity *with warnings present*, but not *with a detection throwing*. `baton.doctor()` →
`doctorReadiness()` → the seven detections run inside the same call the wave-driver preflight wraps
(wave-driver.mjs:306-308: any throw → `wave_driver_route_unready`). W1's `git worktree list` (via
`sh`, worktree.mjs:2010-2011, unguarded) throws on a non-git or freshly-initialized root; W1's
`readdirSync('.baton/wt')` throws ENOENT on a fresh deployment root; W5's `for-each-ref` throws if git
is absent; W6's socket lstat must handle ENOENT as a *condition*. The contract never pins
"every detection is fail-open: a detection error omits its warning, never throws". Without that pin, a
transient detection failure converts a would-succeed dispatch into a preflight refusal — the exact
"a warning must never turn a would-succeed command into a refusal" the contract promises. **Fix:** add a
fail-open law to §4.1 and a PT (detection-throw fixture → byte-identical dispatch).

**The web northbound is missing from the surface model — PT-3 cannot pass.** The CLI `--check` path is
`clientFor(discoverBatonConnection()).doctor()` (impl/scripts/baton.mjs:85), a **JSON round-trip** over
`/v1/application-card`. The non-enumerable `warnings` sibling is invisible to `JSON.stringify`, so it
does not survive the round-trip. For `briefing`, the web northbound explicitly adds the enumerable field
(`{ ...card.readiness, briefing: card.readiness.briefing ?? null }`, web-northbound.mjs:1506-1508), and
the client `doctor()` re-adds it (application-cli.mjs:1974-1976). The contract's D2 lists the CLI render
and the MCP sanitizer as the reading consumers but **omits the web-northbound additive step and the
client `doctor()` field**, so a faithful implementer produces a CLI `--check` with no `warnings`
(`remote.warnings ?? null` → `null`). PT-3 fails. **Fix:** spec the additive `warnings` step at
web-northbound.mjs:1506-1508 and in `BatonWebClient.doctor()` (application-cli.mjs:1961-1978).

**Sanitizer asymmetry — CLI reads the raw sibling.** The MCP path sanitizes
(mcp-northbound.mjs:2135-2149); the CLI reads the un-sanitized sibling verbatim. W3 is metadata-only by
construction, so this is a discipline risk rather than a leak, but the contract's "never token material"
guarantee is only pinned at the MCP surface; the CLI surface has no redaction pin. Parity (PT-3,
"identical rows") plus the redaction guarantee require the sibling to be sanitized **at the source** (in
`doctorReadiness`) or the CLI render to apply the same redactor.

**Local-depth subset unspecified.** "to the local `--depth` results where the reads are meaningful" is
undefined: W3/W7 need server-side probes/observations, W1/W2/W4/W5/W6 are local. A local outline depth
can only emit the local subset, so "identical rows for the same deployment state" (PT-3) cannot hold
across depths unless the subset is pinned. Also, PT-10's anti-misdirection lives in
`inspectBatonConnection` (application-cli.mjs:461-464), a function the D2 surface model does not list as
modified.

### B.3 The action link (D3)

**Ghost verb — W3 and W7 both direct the operator to `baton credentials refresh <provider>`.** The CLI
parser accepts only `baton credentials install kimi` (application-cli.mjs:1214-1228); `refresh` appears
**nowhere** in `application-cli.mjs` or `impl/scripts/baton.mjs`. The cited target
(application-deployment.mjs:1290-1304) is the internal `deployment.credentials.refresh()` method with
**no surface caller** (the only references to an "explicit `baton credentials refresh` command" are
aspirational comments, application-deployment.mjs:1813, claude-credential-cache.mjs:349,
grok-credential-cache.mjs:401). This is the exact ghost-verb class the contract's own D3 law bans
(cli-surface-audit.md:83) — and PT-4 ("a fixture that produces ... a fabricated verb fails") fails for
W3 and W7. The §5 "no new CLI verb" rule forbids adding the verb in v1, so the fix must name an
**existing** surface: the harness-native login verbs the provider taxonomy already documents
(`claude auth login` / `grok login`, application-deployment.mjs:334-336 / 420-422), or a doc anchor.

**Dead-end remediation — W5's `next` does not fix its cause.** W5's cause is "N result/checkpoint pins
... each keeps an object reachable and grows ref walks"; its `next` is `baton run adopt` /
`baton run integrate`. Neither releases a pin: `adopt` **requires** the pin
(`manifest.result.preservation.state === 'pinned'`, application.mjs:5207) and records adoption in the
store; `integrate` **creates** pins (`retainResult`, coordinator.mjs:5946-5947). The only releaser,
`releaseResult` (index.mjs:864-866), has **zero callers** in the codebase and no operator surface. An
operator who adopts every result never reduces the ref census — the warning never clears. That is the
#136 class ("a named verb that doesn't fix its cause"). **Fix:** name the real remediation — a doc
anchor for the manual `git update-ref -d refs/baton/results/<sha>` path, or re-scope W5 to name
adoption as a pre-pin-accumulation hygiene step — or add the release surface (a v1.1 verb, per §5).

**W6 action-link tension.** Cause says "Wait for the staged startup lines to reach 'publish'"; the
`next` verb is `baton serve`. Re-invoking `baton serve` while a resident is mid-startup risks racing the
resident's own publication — the #100 startup capacity-lock race (§0). The honest `next` is the poll
(`baton doctor --check`) or a doc anchor, not the serve verb.

### B.4 Credential TTL detection (brief item 5)

**No-token-material law: SOUND.** Both `metadata()` reads expose only expiry metadata (`expiresAt`,
`refreshTokenExpiresAt`, `state`, `label`, `operatorFile` mtime/exists; claude-credential-cache.mjs:236-252,
grok-credential-cache.mjs:290-305) and the file probe is "cheap per-read stat; never calls Keychain"
(claude-credential-cache.mjs:237). No warning path can reach token material from these reads. The MCP
sanitizer additionally strips secret-shaped values (mcp-northbound.mjs:2135-2149). The residual risk is
the B.2 sanitizer asymmetry (CLI reads the raw sibling) — an implementation-discipline risk, not a
spec-level leak.

**Honest TTL read: HOLE.** "Issued-at metadata, not wall-guesses" holds for the `fresh|stale`
state-class (both caches compare `expiresAt` against `this.now()`), but W3's **grok early-invalidation
threshold** is a window comparison (`expiresAt ≤ now + GROK_AUTH_EARLY_INVALIDATION_MS`) that the
metadata state-class does **not** make — a credential inside the window is classified `fresh` by
`GrokCredentialCache.metadata()` (grok-credential-cache.mjs:296), and the window classification exists
only at `application-deployment.mjs:459`, which the doctor's grok probe does not surface (B.1/W3). So
either W3 mints a new wall-clock comparison (contradicting §3's "mints no new wall-clock comparison"
and exposing PT-12), or it cannot fire the grok early-invalidation case through any read the contract
names. The fix is to source W3 from `grokAuthenticationState`'s existing classification
(application-deployment.mjs:459) and surface it through the doctor — the honest read the contract claims
but mis-cites (A2).

### B.5 Refusal/observability vocabulary + acceptance pins (D4)

Vocabulary split is clean: `warning_*` vs the blocking codes are disjoint by construction, and the
`warning_*` codes are a closed set — that half is SOUND. The acceptance pins are not all satisfiable:

- **PT-1 — schema-order contradiction** (A5): the pinned "closed field set in ACTUAL code-unit order"
  cannot hold against the §4.1 example order.
- **PT-4 — fails for W3/W7** (ghost verb, B.3) and **PT-9's remediation quality is unverifiable** for
  W5 (the verb exists but does not fix the cause; PT-4 only checks non-empty + existing verb, so it
  passes while the warning is a dead end — the pin needs a "fixes the cause" clause, the #136 lesson).
- **PT-8 — fails as written** (W4 double-report, B.1).
- **PT-12 — at risk**: the W3 early-invalidation window is a wall-clock comparison not present in the
  pre-existing metadata state-class; the source-scan exemption must be anchored to
  application-deployment.mjs:459, which the current detection-read text does not do.
- **PT-2 — under-specified**: no fixture for a *throwing* detection (B.2).
- **PT-3 — under-specified**: no web-northbound / client-doctor additive step (B.2); no local-depth
  subset definition.

**Open questions the contract leaves unanswered:**
1. Which detections run at each local CLI depth ("where the reads are meaningful" is not a spec).
2. What the `{ action, command }` command string is for W5 when multiple verbs are named, given D4's
   "`next` array ≤ 1 entry in v1" — W5's action link lists three remediation channels.
3. Whether the 240-byte "summary/cause total" bound fits the contract's own W6 example (~200+ byte
   cause with three multibyte `→` plus a ~60-byte summary ≈ 265+ bytes) — the bound and the examples
   disagree.
4. Whether the W3 default windows (28-min grok, 4.4h claude) are genuinely deployment-configurable
   given the caches hardcode `MAX_MS_EPOCH`/expiry parsing and the 5-minute constant is a module-level
   `const` (application-deployment.mjs:71).

---

## C. Verdict per decision

| Decision | Verdict | One-line rationale |
|---|---|---|
| §3 control-law preamble | **HOLE** | The "no new clock" claim for W3 rests on a mis-cited source (A2); the early-invalidation window is not in the metadata state-class the preamble names. |
| D1 warning catalog | **HOLE** | W4 threshold cannot satisfy PT-8 (B.1); W3's read path cannot produce its threshold (B.4); W1 lacks a precision discriminator; W2's cause is dishonest (A1). |
| D2 severity/surface | **HOLE** | No fail-open law (never-blocks is not exception-safe); web northbound + client doctor omitted (PT-3 broken); CLI sanitizer asymmetry; local-depth subset undefined. |
| D3 action link | **HOLE** | W3/W7 ghost verb `baton credentials refresh` (PT-4 fails); W5 dead-end remediation; W6 verb contradicts its cause. |
| D4 vocabulary + pins | **HOLE** | Vocabulary split SOUND; PT-1/PT-4/PT-8/PT-12 not satisfiable as written. |
| W3 metadata-only law | **SOUND** on no-token-material; **HOLE** on honest-read sourcing | Reads are metadata-only; the claimed read path does not expose what the threshold needs. |

---

## D. Final: NOT FOLD-READY — numbered blockers

1. **B1 — Ghost-verb action links.** W3 and W7 both name `baton credentials refresh <provider>`, which
   the CLI parser cannot invoke (application-cli.mjs:1214-1228) and no surface exposes
   (application-deployment.mjs:1291-1303 is internal). **Why:** violates the contract's own D3 ghost-verb
   law and fails PT-4; the operator reaches a dead end exactly when a credential is about to die.
   **Fix:** name an existing surface — the harness-native login verbs in the provider taxonomy
   (`claude auth login` / `grok login`, application-deployment.mjs:334-336/420-422) or a doc anchor —
   and add a PT that probes the named verb through `parseBatonCli`.

2. **B2 — W4 "no double-reporting" is unsatisfiable.** With the same quantized read, the warning
   condition (`< 640MiB`) is a strict superset of the block condition (`< 512MiB`), so every block is
   accompanied by the warning (raw 500MiB → quantized 448MiB → both fire), and at exactly the floor the
   warning fires with no block — PT-8 fails in both directions. **Fix:** add a precedence rule
   (suppress W4 when the workspace projection is `blocked`) or bound W4 to the approach band
   (`freeBytes < floor×(1+m) && freeBytes >= floor`).

3. **B3 — Never-blocks has no fail-open pin.** A throwing detection (W1's `git worktree list` on a
   non-git/fresh root, W1's `readdir` ENOENT, W5's `for-each-ref`, W6's socket lstat) propagates through
   `baton.doctor()` into the wave-driver preflight's catch (wave-driver.mjs:306-308) and refuses
   `wave_driver_route_unready` — a warning turning a would-succeed dispatch into a refusal. **Fix:** pin
   "every detection is fail-open (a detection error omits its warning, never throws)" in §4.1 and add a
   detection-throw PT.

4. **B4 — Web northbound omitted from the surface model.** The CLI `--check` reads the card over JSON;
   the non-enumerable sibling cannot survive the round-trip without the additive step the contract never
   specs (compare web-northbound.mjs:1506-1508 for `briefing`). PT-3 fails. **Fix:** spec the
   `warnings` additive step at web-northbound.mjs:1506-1508 and in `BatonWebClient.doctor()`
   (application-cli.mjs:1961-1978).

5. **B5 — W3 detection read is mis-sourced and the probe path collapses the metadata.** The spawn-TTL
   gate (grok-credential-cache.mjs:312) rides plain expiry, not the early-invalidation window (A2); the
   grok doctor probe (application-deployment.mjs:1950-1959) returns null except `expired_needs_login`;
   the metadata state-class classifies an in-window credential `fresh`. The contract's "no new clock"
   and "surfaced through the existing probes" claims cannot both hold. **Fix:** source W3 from the
   deployment's existing classification (application-deployment.mjs:459) and surface grok metadata
   through the probe (mirror the claude probe at 2004), then re-pin PT-12 to that exact anchor.

6. **B6 — W2 substrate misread + wrong refusal code.** §1.2 claims a stale lease "blocks new writers
   until the next acquire retries (1318-1325)", but those lines unlink the stale lease and proceed; the
   real stale-lease refusal is `coordination_writer_lost` (1349-1350), not the `coordination_writer_busy`
   the W2 cause message names. **Fix:** correct the §1.2 sentence and the W2 cause message to the honest
   code and mechanism.

7. **B7 — W5 action link is a dead end.** `baton run adopt` / `baton run integrate` do not release
   pins (adopt requires the pin at application.mjs:5207; integrate creates pins at coordinator.mjs:5946-5947),
   and `releaseResult` (index.mjs:864) has no callers or operator surface. The warning can never clear
   via its own `next`. **Fix:** name a real remediation (a doc anchor for the manual ref deletion, or a
   v1.1 release verb), and extend PT-4 to check that the named verb actually reduces the warning's cause.

8. **B8 — Schema field order contradicts the ordering law.** The §4.1 example `{code, cause, ...}` is
   claimed "ACTUAL code-unit order"; actual order is `cause, code, next, severity, summary`. PT-1's
   order pin is ambiguous. **Fix:** canonicalize to the true code-unit order and state it once.

9. **B9 — Citation errors violate §8 discipline.** The #129/#101 oversize-refusal attribution (§0), the
   statfs vs TTL citation (§3), and the spawn-TTL-gate early-invalidation misattribution (§1.2/§3) do
   not say what the cited lines say. **Fix:** re-point each to the verified line (ledger:14/#101,
   readiness-credentials-contract.md:242-244 for TTL only, application-deployment.mjs:459 for the window).

Non-blocking but worth folding before landing: W1 transient-residue false positives (B.1); W5/W7
unbounded census cost on the quota-free MCP doctor (B.1); CLI-side redaction asymmetry (B.2); the
`inspectBatonConnection` anti-misdirection surface not listed in D2 (B.2); W6 verb/cause tension (B.3);
the 240-byte bound vs W6's own example and W5's multi-channel `next` (B.5, open questions 2-3); the
configurability of the W3 windows (open question 4).
