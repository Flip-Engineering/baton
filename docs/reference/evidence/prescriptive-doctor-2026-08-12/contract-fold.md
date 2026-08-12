# Prescriptive-doctor contract — fold of contract-redteam.md (issue #72)

Date: 2026-08-12. Source: `contract-redteam.md` (RT-72, deepseek wave — NOT FOLD-READY, 9
blockers + 7 non-blocking). Target folded: `prescriptive-doctor-contract.md` (v1.0 → **v1.1**).
Result: **FOLD-READY** — every blocker (B1-B9), every open-question verdict, and every non-blocking
finding resolved. The red-team report was NOT edited; this map records what the contract now says.

---

## Blocker → change map

### B1 — Ghost-verb action links (W3/W7 name `baton credentials refresh <provider>`)
**Chosen fix: name an existing surface — the harness-native login verbs + a PT that probes the verb.**
- **W3 action link** (§4.1) now names the provider-taxonomy login verbs — `claude auth login`
  (application-deployment.mjs:334-339) / `grok login` (application-deployment.mjs:406-411) — then
  `baton doctor --check`, and records why the internal verb is a dead end: the internal
  `deployment.credentials.refresh()` (application-deployment.mjs:1290-1304) has no surface caller, and
  `baton credentials refresh <provider>` is not parser-accepted (application-cli.mjs:1214-1228 — the
  parser accepts only `baton credentials install kimi`).
- **W7 action link** (§4.1) names the same login verbs + `baton doctor --check`, or selecting another
  exact route; the no-`refresh`-verb note is repeated.
- **PT-4** (§6) now probes every named verb through `parseBatonCli` so a
  `baton credentials refresh`-style ghost verb fails; **D3** (§4.3) states the ghost-verb class
  (dynamic-workflow-2026-08-03/cli-surface-audit.md:83) as a red-first failure.

### B2 — W4 "no double-reporting" is unsatisfiable
**Chosen fix: bound W4 to the approach band on the SAME quantized read.**
- **W4 threshold** (§4.1) is now the approach band — `minFreeBytes ≤ freeBytes < minFreeBytes ×
  (1 + approachMargin)` (and the inode analogue); at/below the floor the existing
  `worktree_capacity_exceeded` refusal fires and W4 is suppressed. The band and the block are
  **disjoint by construction** on the same quantized `statfsSync` observation
  (application-deployment.mjs:538-547) — no second probe, no double-report, and at exactly the floor
  only the block fires (the strict-`<` block threshold at application-deployment.mjs:549 is unchanged).
- **PT-8** (§6) re-pinned to the three-way split: band → warning; below floor → block only; at/above
  `floor × (1 + approachMargin)` → neither.

### B3 — Never-blocks has no fail-open pin
**Chosen fix: add the fail-open law to §4.1 + a detection-throw PT.**
- **§4.1** now carries the fail-open law verbatim: every detection is fail-open — a detection error (a
  throwing `git worktree list` on a non-git/freshly-initialized root, an ENOENT `readdir` on a fresh
  deployment root, a missing `git` binary, an absent socket file) **omits its warning and never
  throws**; to every consumer (the wave-driver preflight, dispatch, the CLI, the MCP) a detection
  failure is indistinguishable from "no warning". The blocking taxonomy (§4.2) is the only throw path.
- **§4.2** restates it in the never-blocks paragraph (a transient detection failure cannot convert a
  would-succeed dispatch into the preflight's `wave_driver_route_unready`, wave-driver.mjs:306-308).
- **PT-13** (§6) pins it: a fixture whose detection throws produces byte-identical dispatch to the
  warning-free fixture.

### B4 — Web northbound omitted from the surface model
**Chosen fix: spec the `warnings` additive at the web northbound + in the client `doctor()`.**
- **§4.2 Web northbound** now specifies the additive step: the `/v1/application-card` route reads the
  non-enumerable sibling and adds the ONE named enumerable `warnings` field to the served shape
  (`{ ...card.readiness, warnings: card.readiness.warnings ?? null }`, mirroring the `briefing`
  additive at web-northbound.mjs:1506-1508).
- **§4.2 CLI** now names `BatonWebClient.doctor()` (application-cli.mjs:1961-1978) reading the additive
  field (`warnings: deployment?.warnings ?? null`).
- **PT-3** (§6) now pins the web additive + client-doctor field in the identical-rows chain (the CLI
  `--check` reads the web additive at web-northbound.mjs:1506-1508 + `BatonWebClient.doctor()`).

### B5 — W3 detection read is mis-sourced and the grok probe collapses the metadata
**Chosen fix: source W3 from `grokAuthenticationState`'s existing classification + surface grok metadata
through the probe.**
- **W3 detection read** (§4.1) now states the grok probe MUST expose the full metadata state-class
  (mirror the claude probe at application-deployment.mjs:2004 — today the grok probe collapses
  everything but `expired_needs_login` to null, application-deployment.mjs:1950-1959), so the doctor's
  W3 read can classify against the deployment's own window.
- **W3 threshold** (§4.1) now sources the early-invalidation classification from
  `grokAuthenticationState`'s window comparison (application-deployment.mjs:459; const
  `GROK_AUTH_EARLY_INVALIDATION_MS` at :71) — the spawn-TTL gate at grok-credential-cache.mjs:312
  rides **plain expiry, not this window**.
- **PT-7 / PT-12** (§6) re-pinned to those anchors (:459/:71; the metadata state-classes at
  claude-credential-cache.mjs:236-252, grok-credential-cache.mjs:290-305).

### B6 — W2 substrate misread + wrong refusal code
**Chosen fix: correct the §1.2 substrate sentence and the W2 cause message to the honest code.**
- **§1.2** now states the stale lease is **unlinked and the same acquire proceeds**
  (coordination-store.mjs:1319-1325); `coordination_writer_busy` never fires for a `stale` prior
  (:1321-1323); the honest stale-lease refusal is `coordination_writer_lost` from `_assertWriterLease`
  for a store instance without an in-memory lease (:1349-1350).
- **W2 cause message** (§4.1) now names `coordination_writer_lost` (coordination-store.mjs:1349-1350),
  not `coordination_writer_busy`.

### B7 — W5 action link is a dead end
**Chosen fix: name the real remediation (a doc anchor for the manual ref-deletion path) + extend PT-4
with a "fixes the cause" clause.**
- **W5 action link** (§4.1) is now a single doc anchor for the manual ref-deletion path (`git
  update-ref -d refs/baton/results/<sha>` / `git update-ref -d refs/baton/checkpoints/<sha>` — the only
  real releaser in v1), and records why the other verbs do not reduce the census: `adopt` REQUIRES the
  pin (application.mjs:5207), `integrate` CREATES pins (coordinator.mjs:5946-5947), `releaseResult`
  (index.mjs:864-866) has no operator surface. A release verb is a v1.1 candidate per §5.
- **§4.3** and **PT-4** (§6) now add the #136 "fixes the cause" clause: the named remediation must
  actually reduce the warning's cause (W5's manual ref-deletion path, not `adopt`/`integrate`).

### B8 — Schema field order contradicts the ordering law
**Chosen fix: canonicalize to the true code-unit order and state it once.**
- **§4.1 schema** is now `{ cause, code, next: [{ action, command }], severity, summary }` — the field
  set in ACTUAL code-unit order ('cause' < 'code' < 'next' < 'severity' < 'summary'), stated once, with
  the `localeCompare` ban intact. **PT-1** (§6) re-pinned to the closed shape.

### B9 — Citation errors violate §8 discipline
**Chosen fix: re-point each mis-citation to the verified line.**
- **§0** now tags the 4116>4096 render wall as **#101** (orchestrator-friction-ledger.md:14) and #129
  as the zero-runs wave (:104); the cross-reference list updated accordingly.
- **§3** statfs carve-out re-pointed to bidirectional-v3-decisions.md:142-143 (resource observation);
  readiness-credentials-contract.md:242-244 is cited for the TTL carve-out only.
- **§1.2/§3** W3 window re-pointed to application-deployment.mjs:459 (+ the :71 const); the spawn-TTL
  gate at grok-credential-cache.mjs:312 described as plain expiry, not the window.
- **§1.2** grok metadata range corrected to grok-credential-cache.mjs:290-305 (`state` at :300);
  `listWorktrees` re-pointed to worktree.mjs:2010-2011.

---

## Open-question → verdict map

- **OQ1 — which detections run at each local CLI depth.** Pinned: the local `--depth` outline renders
  the **local subset {W1, W2, W4, W5, W6}** — the detections whose reads are local; W3/W7 need
  server-side credential probes / route observations and appear only on the remote `--check` and MCP
  surfaces (the subset is pinned once; "identical rows" (PT-3) is pinned between the remote surfaces)
  (§4.2 CLI, PT-3).
- **OQ2 — W5's multi-channel `next` vs the ≤1-entry rule.** W5's `next` is a single doc anchor for the
  manual ref-deletion path (§4.1 W5; §4.4 keeps `next` ≤ 1 entry in v1).
- **OQ3 — the 240-byte bound vs W6's own example.** The bound is now a deployment-configurable
  `maxWarningRowBytes`, derived from the longest honest message in the v1 catalog — W6's resident-window
  cause, ~280 bytes in UTF-8 including its multibyte `→` — so the bound and the catalog examples agree
  by construction (§4.4).
- **OQ4 — W3 window configurability.** The window is a **named deployment policy field**
  (deployment-configurable), defaulted to the vendor-observed physical bounds (28-min grok TTL, 4.4h
  claude access TTL); the current deployment default is `GROK_AUTH_EARLY_INVALIDATION_MS = 5 min`
  (application-deployment.mjs:71) — the module-level `const` is the default, not a hardcoded control
  limit (§4.1 W3).

---

## Non-blocking → change map

- **W1 transient-residue false positives.** W1's ghost discriminator is now a live-owner check: a
  physical `.baton/wt/ws-*` dir is a ghost only when it is not registered AND not owned by a live owner
  (the dir's controller pid/pidStart liveness, worktree.mjs:341-343, 698 — the same identity class as
  `writerOwnerState`, coordination-store.mjs:63-90); never a grace window, never a clock (§4.1 W1).
- **W5/W7 unbounded census cost.** W5's census read is **bounded as a count** (a configured count
  ceiling or a bounded ref traversal — the output grows with the pin count, the warning's own subject);
  W7's read is a **per-route max accessor** (O(routes), never `routeObservations()`' full-history
  clone-and-sort at coordination-store.mjs:11412 on the quota-free MCP surface) (§1.2, §4.1 W5/W7).
- **CLI-side redaction asymmetry.** The `warnings` sibling is now **sanitized at the source** (secret-
  shaped values stripped before the sibling is attached in `doctorReadiness`), so the CLI's raw-sibling
  read and the web additive carry the same redaction as the MCP surface; the MCP sanitizer stays as a
  surface-level belt-and-suspenders (§4.2).
- **`inspectBatonConnection` not listed in D2.** §4.2 now lists the #137 anti-misdirection replacement
  as living in `inspectBatonConnection` (application-cli.mjs:461-464), a modified surface (PT-10).
- **W6 verb/cause tension.** W6's action link is now the poll — `baton doctor --check` — with the
  reason stated (re-invoking `baton serve` mid-startup races the resident's own publication, the #100
  startup capacity-lock race), plus the #135 staged-startup doc anchor (§4.1 W6).
- **PT-4 "fixes the cause" clause.** Added (§4.3, PT-4) per the #136 lesson.

---

## New surface introduced

- 1 new acceptance pin (PT-13 — fail-open detections).
- The fail-open law (§4.1) — binding on every detection.
- The W1 ghost discriminator (live-owner pid/pidStart check) — precision law.
- The W3 grok-probe metadata mirror requirement (application-deployment.mjs:2004) + the W3/W7 honest
  read at `grokAuthenticationState` (application-deployment.mjs:459).
- The local-depth subset {W1, W2, W4, W5, W6} — pinned once (§4.2, PT-3).
- The configurable `maxWarningRowBytes` ceiling (§4.4).
- The W7 per-route max accessor (O(routes)).

## Campaign law

- **No clocks**: every warning's honest read stays in the pre-existing classes — the credential
  metadata state-class, the `statfsSync` observation, the `/bin/ps` process-identity read, the
  event-seq reads, and the deployment's own early-invalidation classification
  (application-deployment.mjs:459). W3 mints no new wall-clock comparison; the W1 ghost discriminator
  is a liveness read, never a grace window.
- **Citations verified against the current tree** (HEAD `dc569eaa…`; the red-team re-verified at
  `4758d8fa…`; `impl/src` byte-identical across both) via `grep -an`/`sed -n`; the NUL files
  (`application.mjs`, `coordination-store.mjs`) read via `grep`/`sed` only. Sorted-key literals appear
  in ACTUAL code-unit order (`cause, code, next, severity, summary`); `localeCompare` is banned.
