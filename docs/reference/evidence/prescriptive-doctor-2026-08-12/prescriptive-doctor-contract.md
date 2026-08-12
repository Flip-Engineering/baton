# The prescriptive doctor — warn on the footguns before they bite — implementation contract (#72)

**v1.0 DRAFT** — authored against the brief (`contract-72-brief.md`, this directory) on **2026-08-12**.
**Verification HEAD:** `dc569eaa0e2c400029eea88996ec086ecd59356b` (the swept effective-tree snapshot).
**Spec-authoring only; the sole write target is this file.** Every file:line citation was verified with
`grep -an` / `sed -n` on the swept tree at the verification HEAD — including the two NUL files
(`application.mjs`, `coordination-store.mjs`), which carry NUL bytes and are cited with `grep -an`
throughout. Sorted-key literals appear in ACTUAL code-unit order. `localeCompare` is banned.

Cross-referenced (not re-specced): #41 (cause beside the code), #47-family (readiness honesty; never
probe per call), #103 D6(b)/B5 (named additive field — compose, don't duplicate), #129 (silent oversize
refusal), #134 (stale-pin harvest), #135 (staged serve startup), #136 (a refusal/warning without a next
action is a dead end), #137 (setup misdirection), #138 (stateless MCP endpoint), #139 (name the field,
never the value), #141 (boundary-commit law; the ghost-worktree exhaustion is #141-adjacent), #100
(idempotency-key poisoning + startup capacity-lock race, as lived evidence).

---

## 0. The seed (why this epic exists)

The frontier-sweep friction ledger's diagnostic-level table records the exact gap this epic closes
(orchestrator-friction-ledger.md:53): **"Disk-full refusal was coached but nothing WARNED before it
(capacity floors invisible until dispatch refuses) — the 416MiB incident — #72 (prescriptive doctor,
existing)."** Every one of the campaign's lived footguns shares one shape: the machinery knew, and no
surface said it *before* the bite. The ledger's Appendices A–C name the lived incidents this catalog
traces to:

- **Ghost-worktree capacity exhaustion (#141-adjacent)** — residue under `.baton/wt` accumulated until
  dispatch failed closed on capacity (the 416MiB incident, orchestrator-friction-ledger.md:53).
- **Stale-pin harvest footguns (#134)** — "fold-114 v1 harvester declared FOLD-114-OK from a STALE pin
  (the wave had zero runs — #129 — and the harvester attributed the earlier WAD wave's pin by
  path-presence)" (orchestrator-friction-ledger.md:104). Pins outlive the runs they should trace to.
- **Silent oversize refusal (#129)** — the wave refused at render (4116>4096) with no warning that the
  objective was approaching the wall (orchestrator-friction-ledger.md:14).
- **Resident-startup silence (#135)** — "`baton serve` produced ZERO output for ~4 min on first start
  while burning CPU — no binding/listening/self-check/publish staging" (orchestrator-friction-ledger.md:105).
- **Setup misdirection (#137)** — "`baton setup` during resident startup reported `profiles: missing` +
  directed to `create_profile` — which would have raced the resident's own self-publication seconds
  later" (orchestrator-friction-ledger.md:107).
- **Credential rotation deaths** — "claude OAuth TTL rotation ×3 and a 401 revocation mid-wave; grok's
  token dying 28 minutes after an interactive login" (readiness-credentials-contract.md:21-24); the
  Opus/Grok 402/401 incidents this campaign.
- **Idempotency-key poisoning + startup capacity-lock race (#100)** — "Poisoned idempotency key →
  attach into the memberless dead wave (`wave_attach_unknown_wave`, no coaching)"; "Startup
  capacity-lock race: simultaneous openBaton deployments fail closed at boot reconciliation"
  (orchestrator-friction-ledger.md:12-13).

The current doctor is a **readiness outline**, not a **prescriptive surface**: `doctorReadiness()`
(application-deployment.mjs:1317-1357) projects route states, a fresh workspace-capacity observation,
fresh credential probes, and the non-enumerable `liveness`/`occupancy`/`briefing` siblings. It answers
"ready or not", and its workspace section says the exact failure mode *when already blocked*
(application-deployment.mjs:555-563), but nothing says "approaching" before the bite. #72 adds the
warning layer: **cheap, local, never-network detections that advise before a command refuses.**

The #47-family honesty work (Ring 1) already established the substrate this rides: doctor observations
are sanitized, quantized, and computed fresh per read (application-deployment.mjs:525-565); the CLI is a
reading consumer of non-enumerable doctor siblings (application-cli.mjs:1972-1975, impl/scripts/baton.mjs:91-93);
the MCP `baton_deployment_doctor` is quota-free and per-call fresh with secret-shaped values stripped at
the surface (mcp-northbound.mjs:559-567, 1806-1808, 2135-2149).

---

## 1. Ground truth (all verified this campaign)

### 1.1 The doctor machinery this epic extends

- **`doctorReadiness()`** (application-deployment.mjs:1317-1357) is the single projection function.
  It re-probes **workspace capacity + claude/grok credential metadata fresh per read** and reuses the
  frozen open-time route states for everything else. It attaches `liveness`/`occupancy` (1336-1337) and
  the #103 `briefing` sibling (1346-1355) as **non-enumerable** properties — visible to reading
  consumers, invisible to `Object.keys`/`JSON.stringify`. `card()` and `doctor()` both call it
  (application-deployment.mjs:1359-1360).
- **Workspace capacity is the blocking floor.** `workspaceCapacityReadiness()` (application-deployment.mjs:535-565)
  observes `statfsSync` fresh (538-540), quantizes down to the deployment reserve granularity
  (64MiB / 10k inodes, 532-533), and returns `state: 'blocked'` with code `worktree_capacity_exceeded`
  when free space drops below `minFreeBytes: 512MiB` / `minFreeInodes: 100_000`
  (application-deployment.mjs:53-54, 555-563). The refusal side is wired end-to-end: dispatch refuses
  `worktree_capacity_exceeded` (application-semantics.mjs:2103-2104) and the web northbound maps it to
  HTTP 503 (web-northbound.mjs:266). **This is the "already blocked" end; #72 adds the "approaching"
  warning before it.**
- **The CLI doctor is a JSON render of the local outline plus the remote `--check`.** `parseBatonCli`
  accepts `baton doctor [--depth outline|connection|profile|evidence] [--check]`
  (application-cli.mjs:1261-1267). `inspectBatonConnection` (application-cli.mjs:489-638) builds the
  local outline; the remote branch adds the fresh `deployment`/`routes`/`briefing`/`application` and the
  named additive `briefing` field (impl/scripts/baton.mjs:79-98). The client `doctor()` reads `/readyz`
  and `/v1/application-card` and adds the ONE named additive `briefing` field
  (application-cli.mjs:1961-1978).
- **The MCP doctor is quota-free and per-call fresh.** `baton_deployment_doctor`
  (mcp-northbound.mjs:564-567) → `_freshDoctorReadiness()` (2118-2130) → `_sanitizeDoctorReadiness()`
  (2135-2149), which strips credential-shaped VALUES while keeping metadata fields.
- **The wave-driver preflight is a doctor consumer.** `policy.preflight` calls `baton.doctor()` and
  refuses members whose route is not `ready` or whose liveness probe returns `failed`
  (wave-driver.mjs:302-337). Warnings must be invisible to this consumer's blocking logic — a warning
  never turns a preflight into a refusal.
- **The raw application's `doctorReadiness()`** (application.mjs:12373-12400, NUL file) derives route
  readiness from the live profile registry with `workspace: { state: 'ready' }` — the ordinary surface
  always has an honest answer even before a deployment override attaches the probes.

### 1.2 The lived detection substrates (each warning's honest read)

- **Ghost worktree census.** Worktrees live at `.baton/wt/ws-*` (physical owner dirs,
  worktree.mjs:704 `pathResolve(repoRoot, '.baton', 'wt', physicalOwnerId)`) and
  `.baton/verify/<label>-<suffix>` sandboxes; `listWorktrees` enumerates git registrations and
  `reap`/`reconcile` clean residue (worktree.mjs:6, 483-523, 1412-1421). Capacity reservations are
  deployment-owned and repo-scoped (worktree-capacity.mjs:1, 19 `maxReservedBytes`/`maxReservedInodes`).
  The count mismatch (registered vs physical residue) is a pure census read — no clock, no network.
- **Stale writer lease.** The coordination store's writer lease is `writer.lease` + `writer.claim.*`
  in the store root; `claimWriterLease` (coordination-store.mjs:1289-1339, NUL file) validates each
  claim with `writerOwnerState` (coordination-store.mjs:72-90, NUL file), which classifies
  `active`/`stale`/`unknown` by **pid + pidStart liveness** (`/bin/ps -o lstart=`, coordination-store.mjs:63-70).
  A stale claim is auto-unlinked on the next acquire (coordination-store.mjs:1310), but a stale
  `writer.lease` blocks new writers until the next acquire retries (1318-1325). The honest read is the
  existing process-identity classification — never a clock.
- **Credential TTL metadata.** Claude's `ClaudeCredentialCache.metadata()` exposes
  `{expiresAt, refreshTokenExpiresAt, state: fresh|stale|expired_needs_login}` and labels `stale` as
  "refresh-unverified until attempted (#47 tier)" (claude-credential-cache.mjs:236-252). Grok's
  `GrokCredentialCache.metadata()` exposes `{expiresAt, state}` (grok-credential-cache.mjs:290-299)
  with the same early-invalidation arithmetic the spawn-TTL gate already rides
  (grok-credential-cache.mjs:312; `GROK_AUTH_EARLY_INVALIDATION_MS = 5 * 60 * 1000`,
  application-deployment.mjs:71, applied at 459). **Token material never enters these reads** — the
  doctor and MCP surfaces already strip secret-shaped values (mcp-northbound.mjs:2135-2149). The honest
  TTL read is the metadata state-class plus the existing early-invalidation classification, not a new
  wall-guess (see §3).
- **Disk floor under the deployment root.** Same `statfsSync` observation as §1.1
  (application-deployment.mjs:538-547). The warning read is the SAME quantized observation, compared
  against a configurable approach margin above the floor — never a second disk probe.
- **Stale result/checkpoint pin census.** Accepted results and checkpoints are pinned under
  `refs/baton/results/${sha}` and `refs/baton/checkpoints/${sha}` (index.mjs:837-866); pins are
  released via `releaseResult(ref)` (index.mjs:864-866). The census is `git for-each-ref refs/baton/`
  — a cheap local count, no clock.
- **Resident-running-but-unpublished.** The ordinary resident host sequences
  `webHost.start()` (listen) → `confirmSocket()` → the doctor+session **self-check**
  (application-deployment.mjs:1619-1628) → `authority.publish()` (1629-1632). Until publish, the
  authority's `publicOutline().state` is `'private'` (resident-authority.mjs:403-413) and the selector
  may be absent. Today `inspectBatonConnection` reports `profiles: missing` and directs to
  `create_profile` in exactly that window (application-cli.mjs:461-464) — the #137 misdirection.
  The detection reads selector/profile/socket files + the authority's publicOutline state, and
  composes with the #135 staged-startup stages (§4.2).
- **Route whose last provider result was an auth failure.** Route observations are task-keyed rows with
  `terminalStatus` in `{completed, failed}` (coordination-store.mjs:3517-3529, NUL file), written on
  `route.outcome_observed` (coordination-store.mjs:8066, NUL file), readable as a sorted tail via
  `routeObservations()` (coordination-store.mjs:11412, NUL file). The provider terminal guidance
  taxonomy already names the auth-failure class (`authentication_required` /
  `authentication_refresh_required`, application-semantics.mjs:2064-2076) and the deployment's
  authentication summaries classify it exactly (`authentication_refresh_required` /
  `authentication_metadata_invalid`, application-deployment.mjs:323-483). The honest read is the
  **highest-eventSeq** observation for the exact route — an event-seq read, never a clock.

### 1.3 The precedent this composes with (#103 D6(b)/D6(c))

The briefing-pack epic established the exact additive-field discipline this contract reuses:

- **D6(b):** `doctorReadiness()` attaches a **non-enumerable** sibling (`briefing`) by
  `Object.defineProperty`, so `card()`/`doctor()`/every existing consumer see it while serialized
  doctor stays byte-stable for consumers that do not read the sibling (briefing-pack-contract.md:309-317).
- **D6(c):** the CLI is a READING consumer — it reads the sibling by property access and adds **ONE
  named enumerable field** (`briefing`) at every depth in the render path
  (briefing-pack-contract.md:319-326; impl/scripts/baton.mjs:79-93).
- **B5:** the CLI gains a named additive JSON field, never a separate text render
  (briefing-pack-contract.md:23-24).

#72's `warnings` field composes identically: compose, don't duplicate.

---

## 2. The question

An operator and an orchestrator read `baton doctor` today and see `workspace: { state: 'ready' }` on a
volume 500MiB above the floor — while the live evidence shows dispatch will refuse a wave hours later,
a dead writer's lease will block the next writer, a grok credential dies 28 minutes after login, a
ghost worktree silently eats the last reservation, stale pins grow the refs namespace, and a resident
publishes no profile for minutes after `baton serve` prints nothing. Can Baton produce a **closed,
cheap, local, never-network warning layer** — attached to the existing doctor as a named additive field,
composing with the #135 startup stages, never blocking a command, and naming the next action for every
warning — so the surfaces say what the machinery knows *before* the footgun bites?

---

## 3. Control-law preamble (binding)

The campaign control law (bidirectional-v3-decisions.md:134-143) is binding on this epic, exactly as it
bound the #47-family epic (readiness-credentials-contract.md:236-257): controls on agent work must be
**eval-able, constructive, or conversational** — never clocks/turn-limits. The #47 epic already
classified the relevant carve-outs:

- **Credential TTL is a vendor-observed physical bound, not a control on work.** "The 28-min TTL is a
  vendor-observed physical bound on the credential, not a control on work: it is a cache-freshness
  derivation and a cost bound, and it is deployment-configurable" (readiness-credentials-contract.md:242-244).
  W3's honest read is therefore the **metadata state-class + the existing early-invalidation
  arithmetic** (`GROK_AUTH_EARLY_INVALIDATION_MS` at application-deployment.mjs:71; the
  fresh|stale|expired_needs_login classification at claude-credential-cache.mjs:236-252 and
  grok-credential-cache.mjs:290-299) — the exact arithmetic the spawn-TTL gate already rides
  (grok-credential-cache.mjs:312). The warning mints **no new wall-clock comparison**; it reads the
  state the credential controller already classifies.
- **Disk/worktree capacity is a resource observation, not a work clock.** `statfsSync` free space is a
  physical-resource read (readiness-credentials-contract.md:242-243); the warning uses the SAME
  quantized observation as the blocking floor (§1.1), against a configurable approach margin. Ghost
  worktree / pin census are pure counts.
- **Process liveness is process identity, not a stopwatch.** `writerOwnerState` reads pid + pidStart
  via `/bin/ps` (coordination-store.mjs:63-90), the same identity the writer lease already uses.
- **The #135/#137 resident window is event-driven, not clock-driven.** The startup stages are
  `start → listen → self-check → publish`; a warning fires while the authority's `publicOutline().state`
  is `'private'` and the self-check has not yet published — an event/file-state read, never "N minutes
  since start".

No decision below may introduce a per-turn limit or a "warn if the last activity was more than N minutes
ago" clock on real work. Every detection names its honest read in §4.1 and is classified above.

---

## 4. Decisions

### 4.1 D1 — The warning catalog (v1): the closed set of prescriptive warnings

The v1 catalog is **closed at seven warnings**, each defined by four mandatory attributes: the
**detection read** (cheap, local, never network), the **threshold** (deployment-configurable, derived
numbers, never hardcoded control limits), the **human-cause message** (the #41 law: the cause beside
the code, never a bare signal), and the **action link** (a remediation verb or doc anchor — the #136
lesson). Every warning's rendered row carries exactly these fields, in a closed schema:

```text
{ code, cause, next: [{ action, command }], severity, summary }
```

(`code`, `cause`, `next`, `severity`, `summary` — the field set in ACTUAL code-unit order.)
`code` is the typed warning identity; `severity` ∈ {`notice`, `warning`} (§4.2); `summary` is the
one-line signal; `cause` is the #41 human-cause clause; `next` reuses the existing outline `next`
shape (application-cli.mjs:450, 483) — a warning with an empty `next` is a red-first failure (§6, PT-4).

The seven warnings:

**W1 — `warning_ghost_worktree_census`** (evidence: #141-adjacent ghost-worktree capacity exhaustion,
orchestrator-friction-ledger.md:53).
- **Detection read:** one local `git worktree list` (via `listWorktrees`, worktree.mjs:6) + one
  `readdir` of `.baton/wt` and `.baton/verify` under the deployment root; count registrations vs
  physical residue. Never network.
- **Threshold:** `ghostCount = physicalResidue − registeredCount > 0` **or** total reserved bytes across
  registered worktrees ≥ a configurable fraction (default 0.8) of the policy's `maxReservedBytes` /
  `maxReservedInodes` (worktree-capacity.mjs:19). The fraction is a deployment config, not a hardcode.
- **Cause message:** "N unregistered worktree directories remain under .baton/wt (git registers M
  worktrees); each still counts against capacity reservations, and dispatch fails closed when they
  exhaust the floor."
- **Action link:** `baton serve` (the startup-cleanup reconcile reaps/reconciles residue,
  coordinator.mjs:1359-1360, 1369; the drain reconcile at coordinator.mjs:2824) + the #141
  boundary-commit-law doc anchor.

**W2 — `warning_stale_writer_lease`** (evidence: the startup capacity-lock race's dead-writer window,
orchestrator-friction-ledger.md:13; #100).
- **Detection read:** read `writer.lease` + `writer.claim.*` in the store root
  (coordination-store.mjs:1290-1320); classify each owner with `writerOwnerState`
  (coordination-store.mjs:72-90) — pid + pidStart liveness via `/bin/ps`. Never network.
- **Threshold:** the incumbent `writer.lease` (or any `writer.claim.*`) classifies `stale` (dead pid or
  pidStart mismatch) and is still present on disk.
- **Cause message:** "A coordination writer lease points at a dead process (pid N, started P); the next
  writer acquire will clear it, but until then the store refuses `coordination_writer_busy`."
- **Action link:** `baton serve` (the next acquire clears stale claims, coordination-store.mjs:1310,
  1324) or the store-root cleanup doc anchor.

**W3 — `warning_credential_ttl`** (evidence: the Opus/Grok 402/401 credential-rotation deaths,
readiness-credentials-contract.md:21-24; setup-token-decisions.md:112-116).
- **Detection read:** credential **metadata only** — `ClaudeCredentialCache.metadata()`
  (claude-credential-cache.mjs:236-252) and `GrokCredentialCache.metadata()`
  (grok-credential-cache.mjs:290-299) — surfaced through the doctor's existing fresh credential probes
  (application-deployment.mjs:1318-1320). **Never token material; never network; never a new clock** —
  the read is the metadata state-class plus the existing early-invalidation arithmetic
  (application-deployment.mjs:71, 459; §3).
- **Threshold:** the metadata state is `stale` (claude's "refresh-unverified until attempted (#47 tier)",
  claude-credential-cache.mjs:250) **or** grok's `expiresAt` falls inside the early-invalidation window
  (the exact classification the spawn-TTL gate uses, grok-credential-cache.mjs:312). Deployment-configurable
  window, defaulted to the vendor-observed physical bounds (28-min grok TTL, 4.4h claude access TTL).
- **Cause message:** "The <provider> credential metadata is inside its refresh window (expires at
  <expiry-class>, not verified for a live turn since <last-verified-state>); a turn can die at dispatch
  time. Refresh outside the bite."
- **Action link:** `baton credentials refresh <provider>` (application-deployment.mjs:1290-1304) then
  `baton doctor --check`.

**W4 — `warning_disk_floor_approaching`** (evidence: the 416MiB incident — nothing warned before dispatch
refused, orchestrator-friction-ledger.md:53).
- **Detection read:** the SAME quantized `statfsSync` observation as the blocking floor
  (application-deployment.mjs:538-547); no second probe.
- **Threshold:** `freeBytes < minFreeBytes × (1 + approachMargin)` or `freeInodes < minFreeInodes × (1 + approachMargin)`
  while still ≥ the floor (at/below the floor, the existing `worktree_capacity_exceeded` blocking
  refusal fires instead — application-deployment.mjs:555-563). `approachMargin` is a deployment config,
  defaulted to 0.25.
- **Cause message:** "The repository volume has <free> free (floor <min>); dispatch still runs today but
  refuses when the floor is crossed. Free space now or raise the deployment capacity floors."
- **Action link:** free repository volume space or raise the deployment worktree capacity floors
  (application-semantics.mjs:2103-2104).

**W5 — `warning_result_pin_census`** (evidence: the stale-pin harvest footguns, orchestrator-friction-ledger.md:104 — #129/#134).
- **Detection read:** `git for-each-ref refs/baton/results refs/baton/checkpoints` — a cheap local ref
  census (the namespaces at index.mjs:838, 850). Never network.
- **Threshold:** total pins exceed a deployment-configurable bound (default derived from the refs-growth
  cost class) — a count, never a clock.
- **Cause message:** "N result/checkpoint pins are retained under refs/baton/; each keeps an object
  reachable and grows ref walks. Adopt or release pins you no longer need — a stale pin can make the
  next harvest attribute the wrong run by path-presence."
- **Action link:** `baton run adopt` (application-cli.mjs:2316-2325) / `baton run integrate`
  (2338-2345) to consume results, the internal `releaseResult` path (index.mjs:864-866), and the result
  retention doc anchor (application-deployment.mjs:909 `resultPolicy`).

**W6 — `warning_resident_not_published`** (evidence: #135 resident-startup silence +
#137 setup misdirection, orchestrator-friction-ledger.md:105-107).
- **Detection read:** local selector/profile/socket files under the resident authority
  (resident-authority.mjs:282-283, 320-401) + the authority's `publicOutline().state`
  (resident-authority.mjs:403-413). Composes with the #135 staged startup stages
  (`start → listen → self-check → publish`, application-deployment.mjs:1601-1632). Never network.
- **Threshold:** a schema-v2 selector (or a live resident authority lease) exists but
  `publicOutline().state === 'private'` — i.e., the resident is mid-startup, OR the published profile's
  socket lstat fails while the authority's owner pid is live. In this window the warning REPLACES the
  #137 misdirection: `inspectBatonConnection` today reports `profiles: missing` → `create_profile`
  (application-cli.mjs:461-464).
- **Cause message:** "A resident authority is starting (stage <stage> of start→listen→self-check→publish);
  no profile is published yet, so `create_profile` would race its self-publication. Wait for the staged
  startup lines to reach 'publish'."
- **Action link:** `baton serve` (let the resident publish; the self-check + publish complete the
  startup, application-deployment.mjs:1619-1632) then `baton doctor --check`.

**W7 — `warning_route_last_auth_failure`** (evidence: the credential-rotation deaths landing as 401/402
at turn time, readiness-credentials-contract.md:21-24).
- **Detection read:** the exact route's **highest-eventSeq** observation from `routeObservations()`
  (coordination-store.mjs:11412) — an event-seq read; plus the #47 liveness cache's `failed` state for
  that route when it carries an auth code (application-deployment.mjs:1315-1320, 1334-1337). Never
  network, never a clock.
- **Threshold:** the route's most-recent observation has `terminalStatus: 'failed'` with an
  auth-failure classification (`authentication_refresh_required` / `authentication_metadata_invalid`,
  application-deployment.mjs:323-483), or the liveness row is `failed` with that code.
- **Cause message:** "Route <exact route> last real provider result was an auth failure (<code>); a
  fresh turn on it can fail identically at dispatch. Refresh the credential before routing to it."
- **Action link:** `baton credentials refresh <provider>` (application-deployment.mjs:1290-1304) then
  `baton doctor --check`, or select another exact route.

**Closure rule:** a warning fires only from the reads above. An implementation that adds a new warning
code outside this closed set, a detection that touches the network, or a detection that mints a new
wall-clock elapsed-time comparison is a red-first failure (§6, PT-1/PT-12).

### 4.2 D2 — The severity + surface model

**Warning vs blocking (the two axes stay separate).** A prescriptive warning **NEVER blocks a command** —
it advises. Blocking stays the existing refusal taxonomy: `worktree_capacity_exceeded`
(application-deployment.mjs:555-563), `coordination_writer_busy` (coordination-store.mjs:1321-1323),
`wave_driver_route_unready` (wave-driver.mjs:308-333), the static/live route `blocked` states. The
wave-driver preflight and every dispatch path must be **byte-identical** with warnings present or
absent — a warning must never turn a would-succeed command into a refusal, and the preflight consumer
(wave-driver.mjs:302-337) must not read the `warnings` sibling at all in v1.

**Surface — compose, don't duplicate (#103 D6(b)/B5).** `doctorReadiness()` gains a **non-enumerable**
`warnings` sibling (the same `Object.defineProperty` pattern as `liveness`/`occupancy`/`briefing`,
application-deployment.mjs:1336-1337, 1355), computed fresh per read from the seven detections in §4.1.
Non-reading consumers (`Object.keys`/`JSON.stringify`/the wave preflight) see no change — serialized
doctor output stays byte-stable. Reading consumers add **ONE named enumerable `warnings` field**:

- **CLI** — the doctor render path adds `warnings` to the remote `--check` result and to the local
  `--depth` results where the reads are meaningful, at every depth (impl/scripts/baton.mjs:79-98;
  application-cli.mjs:1961-1978), exactly as D6(c) added `briefing`.
- **MCP** — `baton_deployment_doctor` (mcp-northbound.mjs:564-567, 1806-1808) returns the same named
  `warnings` field through `_freshDoctorReadiness` + `_sanitizeDoctorReadiness`
  (mcp-northbound.mjs:2118-2149), so the orchestration surface sees identical warning rows. The
  sanitizer already strips secret-shaped values; W3's metadata-only read never emits token material.

**Severity semantics.** `severity: 'warning'` = advise-before-the-bite (W1-W5, W7). `severity: 'notice'`
= an event-driven status the operator should read but no imminent refusal is implied (W6's resident
startup stage, composing with the #135 staged stderr lines). Both are advisory; neither gates a command.

**The #135 composition.** The serve startup stages (`start → listen → self-check → publish`,
application-deployment.mjs:1601-1632; the staged stderr readiness lines are #135's own surface) and the
doctor `warnings` compose by **referencing the same stage names** — W6's `cause` names the current stage
from the #135 vocabulary, and the staged startup lines may, when a stage blocks, point at `baton doctor`
for the W6 warning rather than duplicating a second render. One stage vocabulary, two surfaces; the
doctor owns the warning, the startup lines own the progress.

### 4.3 D3 — The action link (the #136 lesson)

Every warning's `next` array is mandatory and non-empty, reusing the existing
`{ action, command }` shape (application-cli.mjs:450, 483). The action is the remediation verb where
one exists, or a doc anchor where the remediation is a manual/administrative step. A warning with an
empty `next` is a dead end — the exact #136 defect ("the refusal names no next action",
orchestrator-friction-ledger.md:106) — and is a red-first failure (§6, PT-4). §4.1's seven warnings
already carry their action links; the v1 rule: **an action link must reference an existing verb, an
existing `baton` command, or a named doc anchor in this evidence tree** — never a fabricated verb that
the CLI parser cannot invoke (the ghost-verb class, dynamic-workflow-2026-08-03/cli-surface-audit.md:83).

### 4.4 D4 — Refusal/observability vocabulary + acceptance pins

**Vocabulary.** The seven warning codes are the closed refusal/observability vocabulary:
`warning_ghost_worktree_census`, `warning_stale_writer_lease`, `warning_credential_ttl`,
`warning_disk_floor_approaching`, `warning_result_pin_census`, `warning_resident_not_published`,
`warning_route_last_auth_failure`. They are separate from the blocking codes (§4.2) by construction — a
code namespace split that a consumer can rely on: `warning_*` never appears on a refusal, blocking codes
never appear in the `warnings` array. Each row is bounded (the summary/cause ≤ 240 bytes total, the
`next` array ≤ 1 entry in v1) — a bounded advisory document, the same discipline as the roster
projection (readiness-credentials-contract.md:477-481).

**Acceptance pins (red-first).** The suite ships BEFORE implementation (§6); every pin is deterministic
(fixture adapters/shim executables, fixed clocks, no live providers).

---

## 5. Non-goals (out of v1)

- **No auto-heal, no auto-cleanup.** A warning names the remediation; it never runs `git worktree prune`,
  unlinks a lease, refreshes a credential, frees space, or deletes a pin itself. The operator's explicit
  surfaces stay the only unlock (the #47 no-auto-heal posture,
  readiness-credentials-contract.md:422-425).
- **No new doctor depth, no new CLI verb.** `baton doctor` depths stay
  `outline|connection|profile|evidence` (application-cli.mjs:1266); warnings ride the existing surfaces
  as the named additive field. A `baton doctor warnings` verb or a `baton gc`/`baton prune` verb is a
  v1.1 candidate — v1 names the existing verb or a doc anchor in `next`.
- **No network detection.** Every detection is local (§4.1); a detection that contacts the remote
  application, a provider, or the vendor CLI is out of scope by construction (it would violate the
  "cheap, local, never network" law and the quota-free MCP posture).
- **No new store.** The warnings are computed from existing authorities (§1.2) on each fresh doctor
  read; no durable warning ledger in v1 (a durable warning history is a v1.1 candidate, mirroring the
  #47 liveness cache's in-memory posture, readiness-credentials-contract.md:382-387).
- **No #138 dependency.** The stateless HTTP MCP endpoint (orchestrator-friction-ledger.md:108) belongs
  to the packaging epic; `baton_deployment_doctor` already serves the warnings on the stdio MCP surface
  in v1.
- **No change to blocking behavior.** The existing refusals, their codes, and their remediation text are
  untouched; this epic only adds the advisory layer and the W6 anti-misdirection replacement in the
  resident window.

---

## 6. Acceptance (red-first)

The red-first suite ships BEFORE implementation; every row is deterministic (fixture adapters/shim
executables, fixed clocks, no live providers):

- **PT-1 (catalog closure + schema):** the `warnings` array carries exactly the seven codes from §4.1
  and no others; every row is the closed `{code, cause, next, severity, summary}` shape (the field set
  in ACTUAL code-unit order); a fixture that mints an unknown code or a non-closed field set fails.
- **PT-2 (never blocks):** every command that succeeds without warnings present succeeds byte-identically
  with any subset of warnings present; the wave-driver preflight (wave-driver.mjs:302-337) is
  byte-identical with warnings present or absent (a fixture wave with warnings fires no refusal the
  warning-free wave does not). The blocking codes (§4.2) never appear inside `warnings`.
- **PT-3 (surface compose, no duplicate):** the CLI doctor `--check` JSON and the MCP
  `baton_deployment_doctor` result each carry the ONE named `warnings` field with identical rows for the
  same deployment state; serialized doctor for a non-reading consumer (`Object.keys`/`JSON.stringify`
  over `doctorReadiness()` output) is byte-identical with and without warnings (the non-enumerable
  sibling proves itself).
- **PT-4 (action link):** every warning row's `next` is non-empty and references an existing verb or a
  named doc anchor; a fixture that produces a warning with an empty `next` or a fabricated verb fails
  (#136, ghost-verb class).
- **PT-5 (W1 ghost worktree census):** a fixture with N physical `.baton/wt/ws-*` dirs unregistered by
  `git worktree list` fires `warning_ghost_worktree_census` naming the count; a clean fixture fires
  nothing.
- **PT-6 (W2 stale writer lease):** a fixture store with a `writer.lease` whose pid is dead (or whose
  pidStart mismatches `/bin/ps`) fires `warning_stale_writer_lease`; a live lease fires nothing.
- **PT-7 (W3 credential TTL, metadata only):** a fixture credential whose metadata state is `stale` or
  inside the early-invalidation window fires `warning_credential_ttl`; a content scan of the warning
  output proves no token material appears (the #11 CC-4 scan precedent, setup-token-decisions.md:205-209);
  a fresh credential fires nothing.
- **PT-8 (W4 disk floor approaching):** a fixture `statfs` at `floor × (1 + approachMargin) − ε` fires
  `warning_disk_floor_approaching`; at the floor, the existing `worktree_capacity_exceeded` blocking
  refusal fires and the warning does NOT (no double-reporting).
- **PT-9 (W5 pin census):** a fixture refs namespace above the configured bound fires
  `warning_result_pin_census`; below it fires nothing.
- **PT-10 (W6 resident-not-published + #137 anti-misdirection):** a fixture resident authority with a
  schema-v2 selector and `publicOutline().state === 'private'` fires `warning_resident_not_published`
  AND the `inspectBatonConnection` outline no longer reports `profiles: missing` → `create_profile`
  (application-cli.mjs:461-464) — it reports the resident-starting state; a published fixture fires
  nothing.
- **PT-11 (W7 route last auth failure):** a fixture route observation whose highest-eventSeq terminal
  status is `failed` with an auth code fires `warning_route_last_auth_failure`; a `completed` or
  non-auth `failed` observation fires nothing.
- **PT-12 (no clocks as controls):** a source-scan over the warning detections proves no warning mints
  an elapsed-time wall-clock comparison beyond the pre-existing metadata state-class, the `statfsSync`
  observation, the `/bin/ps` process-identity read, and the event-seq reads (§3, §4.1).

---

## 7. Verification

```text
node --test impl/test/prescriptive-doctor-red.test.mjs   # the red-first suite (PT-1..PT-12)
```

then the canonical suite fully green. Post-landing live receipts (operator-gated, in this evidence
directory): the first real W3 firing records the metadata-vs-window observation; the first real W6
firing records the staged-startup compose with the #135 lines; each per the dogfood-receipt discipline
of readiness-credentials-contract.md:760-766.

---

## 8. Citation verification (NUL discipline)

All citations in this contract were verified with `grep -an` / `sed -n` on the swept tree at the
verification HEAD (`dc569eaa0e2c400029eea88996ec086ecd59356b`). The two NUL files —
`impl/src/application.mjs` and `impl/src/coordination-store.mjs` — were cited with `grep -an` only:

- `application.mjs:12373-12400` — raw application `doctorReadiness()` (verified `grep -an "doctorReadiness"`).
- `coordination-store.mjs:63-90` — `writerProcessStartIdentity` / `writerOwnerState`
  (verified `grep -an "writerProcessStartIdentity|writerOwnerState"`).
- `coordination-store.mjs:1289-1339` — `claimWriterLease` (verified `grep -an "writer.claim"`).
- `coordination-store.mjs:3517-3529` — route observation row schema + `terminalStatus`
  (verified `grep -an "terminalStatus"`).
- `coordination-store.mjs:8066` — `route.outcome_observed` write (verified `grep -an "route.outcome_observed"`).
- `coordination-store.mjs:11412` — `routeObservations()` tail (verified `grep -an "routeObservations()"`).

Every other citation was verified on its file at drafting time; line numbers were re-checked once at
drafting and once before this write. Sorted-key literals appear in ACTUAL code-unit order throughout;
`localeCompare` appears nowhere in this contract.
