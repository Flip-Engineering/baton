# Grounding Memo — Issue #12: nested orchestration (workers cannot orchestrate)

*Read-only grounding for issue #12 ("Workers cannot perform nested orchestration: resident
connection profile is not projected into the private worker runtime"), the blocker for issue #74
(the worker-orchestrated swarm). Compiled 2026-08-03 from `impl/src/` (master @ aaf3ca3); every
claim is cited `file:line`. NUL-bearing files (`coordinator.mjs`, `application.mjs`,
`coordination-store.mjs`) were inspected via `grep -an` / `sed -n` only. Issue #12's live proof:
`docs/reference/evidence/phase93a2-control-grammar-review-live-2026-07-20/wave5-nested.md`.*

## 1. THE RESIDENT CONNECTION — what exists, what the worker is denied

**Resident session + socket authority (the owner profile).** The embedded deployment's ordinary
host mints a `ResidentAuthority` (`impl/src/application-deployment.mjs:1390-1399`), opens a
`WebSessionStore` over the authority's session root (`:1401-1404`), and issues the owner session
at `:1405-1416`: `userId: 'local-owner'`, `authMethod: 'bearer'`, capabilities
`['observe','control','approve','emergency_stop','export_result','retry_verification',
'goal:define','goal:observe','plan:propose','plan:approve']`, `repoIds: [repoId]`. Session tokens
are random bearers, digest-at-rest (`impl/src/web-auth.mjs:128-147`). The resident publishes three
files (`impl/src/resident-authority.mjs:268-281,385-391`): the **selector**
`<git-common-dir>/baton/connection.json` (schemaVersion 2, profile id, deploymentId, incarnation,
registryDigest, startedAt — `:329-332`), the **profile**
`~/.config/baton/connections/resident-<repoDigest12>-<deployDigest12>.json` (transport `local`,
socketPath, tokenFile, ownerPid/ownerPidStart — `:333-340`), and the **token** (mode-0600 sibling
`.token`). Clients reach the resident over the owner-only local socket
(`impl/src/application-deployment.mjs:1427-1445`).

**CLI discovery contract (what a worker's `baton run start` executes).**
`discoverBatonConnection` (`impl/src/application-cli.mjs:208`) walks `.git` to the common dir,
reads the selector at `join(commonDir,'baton','connection.json')` (`:223`), resolves
`configRoot = XDG_CONFIG_HOME | $HOME/.config` (`:244-248`), then reads
`baton/connections/<selector.profile>.json` owner-only (`:249-250`; owner-only enforced by
`readBoundedFile` at `:115-141`; resident profiles additionally require valid
`ownerPid`/`ownerPidStart` at `:57-62`). A missing/unreadable profile throws
`cli_config_invalid: user connection profile is unavailable` (`:119`) — byte-for-byte issue #12's
observed failure.

**Worker isolation (why the profile is absent).** `RuntimeIsolation.create`
(`impl/src/runtime-isolation.mjs:59`) builds a private `root/home/tmp/config` tree mode-0700
(`:61-66`), strips every secret/provider-shaped env var (`:8-9,:68-73` — `BATON_TOKEN` matches the
`SECRET_NAME` `/TOKEN/` filter), points `env.HOME` at the private home (`:74`), and deletes the
vendor config-home overrides (`:76-79`). The lease (`env`, `replaceEnv: true`, `paths`, `posture`)
is returned at `:150-172`, created per-spawn by `coordinator._ensureRuntimeScope`
(`impl/src/coordinator.mjs:8226-8239`) and consumed by the adapter spawn call at
`coordinator.mjs:3543-3545` (also `:5162-5163`, `:5576-5577`). Driver wiring:
`application-deployment.mjs:1696-1701` (`runtimeIsolation: {root, credentialEnv, credentialFiles,
credentialTrees}`). **Net:** the worker CAN read the selector (shared git common dir — hence
`baton doctor`: `connection: ready` in #12) but its private HOME contains no
`baton/connections/` tree, so discovery fails at the profile read. The blocker is exactly profile
projection, not flags or reachability.

## 2. THE PROJECTION SEAM — the credential machinery as the model, the minimal authority

**The model that already exists.** `projectCredentialTree` (`impl/src/credential-projection.mjs:89`)
copies a fixed relative allow-list from an owned source tree into a fresh private tree: owned-source
checks (`:20-27`), `O_EXCL` mode-0600 writes with fsync (`:146-149`), and a secret redactor for
provider frames (`:156-160`). `RuntimeIsolation.create` consumes it via
`credentialEnv`/`credentialFiles`/`credentialTrees` (`impl/src/runtime-isolation.mjs:104-140`) and
reports the materialization in `posture` (`:159-171`), logged durably as `runtime.scope_created`
(`impl/src/coordinator.mjs:8234-8237`).

**What #12 projects is NOT a copy.** Issue #12 is explicit: never the owner's full profile. The
resident MINTS a fresh child session (`WebSessionStore.issue`, `impl/src/web-auth.mjs:128`) with
attenuated capabilities and writes a FRESH bounded profile+token (the `:333-340` shape — same
socketPath/deploymentId/incarnation/registryDigest/startedAt and the resident's
ownerPid/ownerPidStart, since worker and resident share uid and the live socket) into the worker's
private `home/.config/baton/connections/<selector-profile>.json` + `.token` (mode 0600). The
credential-projection mechanics (0600, fsync, digest-into-posture) are reused; the copy semantics
are not — content is minted, never read from the owner's store.

**Minimal capability set for a coordinator-lead (per #74).**
`['observe','control']` on the session — `observe` covers watch/receipt/read lanes, `control`
covers waves.start/message.send/elevate/seed/board.post (capability table:
`impl/src/mcp-northbound.mjs:96`; contract table
`docs/reference/evidence/facade-projection-2026-08-03/facade-projection-contract.md:660-666`) —
PLUS a run-orchestrator lease carrying `RUN_ORCHESTRATOR_CAPABILITIES`
(`run.context/run.start/run.status/run.stop`, `impl/src/run-lineage.mjs:14-16`; `maxDepth: 4`,
bounded children, `:25`). The session↔lease binding envelope already exists:
`coordinator.acquireBoardLease` returns `{…receipt, sessionAuthority: {schemaVersion: 1,
authorityDigest, expiresAt, orchestratorLeaseId}}` (`impl/src/coordinator.mjs:10510-10528`), and
`application._recursiveLease` validates exactly those four fields against the lease
(`impl/src/application.mjs:4238-4255`). Deliberately excluded: `approve`, `emergency_stop`,
`export_result`, `retry_verification`, `goal:*`, `plan:*` — the human orchestrator keeps those;
the coordinator-lead escalates via DECISION_REQUEST (§4).

**Insertion points.** (a) Driver wiring: `application-deployment.mjs:1696-1701` — add a
connection-projection authority beside `credentialEnv/Files/Trees`. (b) Materialization:
`RuntimeIsolation.create` after the credential block (`runtime-isolation.mjs:140-150`) — write the
two files and digest the projection into `posture`. (c) Issuance reachability: the
`WebSessionStore` is today local to `#startOrdinaryHost` (`application-deployment.mjs:1401`); the
deployment must hand a bounded issuing capability down to the driver — the `goalPlanAuthority`
hand-off at `:1702` is the precedent shape.

## 3. THE SECURITY SHAPE — fail-closed child authority (the model is the run-orchestrator lease)

The parent-child authority machinery #12 needs already landed with phase 77:

- **Issuance** — `issueRunOrchestratorLease` (`impl/src/coordination-store.mjs:1857`) mints a
  digested lease: `parent: {runId, taskId, taskVersion, workerId}`, bound `session`,
  `capabilities: [...RUN_ORCHESTRATOR_CAPABILITIES]`, `expiresAt`, `policyDigest`,
  `requestDigest`, `leaseDigest` (`:1680-1695`). Idempotent replay, derived identity key.
- **Scope enforcement** — `authorizeRunOrchestratorCommand` (`:1987`) refuses any command outside
  the fixed capability list (`:1995`) and any target outside the lease subtree
  (`run_orchestrator_scope_forbidden`, `:2002-2006`). `activeRunOrchestratorLeaseForSession`
  (`:1926`) binds lease↔session identity and refuses ambiguity.
- **Revocation** — `revokeRunOrchestratorLease` (`:1886`), closed reason set; used by the
  settlement flow (`impl/src/coordinator.mjs:10770`) and by `sweepSettlementLeases`
  (`coordination-store.mjs:12397-12420`), which is precisely the **parent-death sweep**: active
  leases whose parent run was never admitted get revoked with `review_window_expired` (`:12415`).
- **Session kill** — `WebSessionStore.revoke` (`impl/src/web-auth.mjs:149-154`);
  `isPrincipalActive` (`:205-215`) re-validates capabilities/repoIds/expiry per call, so one
  revocation kills every in-flight command.
- **Residue zero** — the projected token file dies with the private home:
  `RuntimeIsolation.remove` (`runtime-isolation.mjs:175-184`) via `coordinator._removeRuntimeScope`
  (`coordinator.mjs:8242-8251`) on stop/reap, with `reconcile` sweeping orphaned runtime roots
  (`runtime-isolation.mjs:186-192`).

**Generation binding (parent dies → child authority dies)** is therefore three existing hooks
awaiting one wire: lease TTL/revocation + session revocation on the worker-terminal path + private
home reaping. The new work is calling `sessions.revoke` (and `revokeRunOrchestratorLease`) from the
worker terminal/reap path and adding a sweep for orphaned worker sessions on the
`sweepSettlementLeases` pattern — not inventing a revocation authority.

## 4. THE #74 COMPOSITION MAP — which landed authorities a coordinator-lead exercises, and through which surface

Spec-history F4 (`docs/reference/capability-atlas-2026-08-03/spec-history.md:175-186`): "A swarm
spec is a composition of 75/77/79/88, not a new authority." Design corpus
(`docs/reference/capability-atlas-2026-08-03/design-corpus.md:573-574`): workers orchestrating
swarms (#74) rides BD3 and is blocked on #12 (`:471`). Issue #74: "the MCP epic's wave tools are
the surface a worker-orchestrator should consume." Reachability keyed (a) kernel-only /
(b) facade / (c) MCP:

- **Nested run.start/stop/status (phase 77/85)** — `admitRunLineage`
  (`coordination-store.mjs:1943`) + `authorizeRunOrchestratorCommand` (`:1987`); facade
  `_admitRecursiveRun` (`application.mjs:4278`) with the recursive-session gate explicitly
  allowing `run.start`/`run.stop` plus seven read commands for lease-holders
  (`application.mjs:12101-12110`). LANDED. (a) yes (b) yes, lease-bound (c) no — MCP ordinary
  tools deliberately carry no `sessionAuthority` (contract ground truth 15,
  `facade-projection-contract.md:683-684`). This is exactly #12's acceptance surface.
- **waves.start/progress/send/stop (S-1 wave grammar)** — facade direct ports dispatched BEFORE
  the recursive gate (`application.mjs:12095-12099`; position rationale
  `facade-projection-contract.md:382-386`); MCP `baton_waves_start` (`impl/src/mcp-northbound.mjs:456`),
  capabilities `['control','observe']` (`:96`), STATEFUL + idempotent replay (`:125,:133`).
  LANDED as surfaces; whether `startWave`'s `_authorize` (`application.mjs:3048`) admits a
  lease-holding principal is the unverified #74 question — #12 v1 does not exercise it.
- **Board post/read (S-2 orchestrator half)** — facade `run.board.post`/`run.board.read`
  CONTRACTED in #87 v2.0 (`facade-projection-contract.md:553-600`) and verified ABSENT from
  `application.mjs` today; MCP `baton_board_*` exists on the combined surface, lease-bearing via
  `admitBoardCommand` (`coordinator.mjs:10530`) + `acquireBoardLease` (`:10510`).
- **Board claim/report (worker half, #78)** — `requestBoardClaim`/`submitBoardReport`
  (`coordinator.mjs:10533-10558`) landed kernel-side with board-scoped fences; facade/MCP
  projection still registry ghosts (`facade-projection-contract.md:207-210`;
  `spec-history.md:163-173`).
- **Context packs (BD3-B)** — `mintContextPack` (`coordination-store.mjs:13066`),
  `materializeContextPack` (`:13089`), read-audit `recordContextRead` (`:13104`):
  KERNEL-ONLY (grep-verified: no facade/MCP projection). A coordinator-lead minting context packs
  for executors needs a new facade lane (#74 gap) or must route mints through the human
  orchestrator.
- **Scratchpad read/elevate (BD3-A spine)** — kernel `elevateTaskScratchpad`
  (`coordinator.mjs:10752`); facade `run.scratchpad.read/elevate` CONTRACTED #87
  (`facade-projection-contract.md:491`).
- **Knowledge seed (KG)** — `run.knowledge.seed` CONTRACTED #87 (contract swarm sequence step 1,
  `:784-787`).
- **Message send/receipt (#86 worker wire)** — `coordinator.sendMessage`/`messageReceipt`;
  facade + MCP CONTRACTED #87 (`facade-projection-contract.md:398-446,660-661`).
- **Attention watch** — `coordinator.attentionFollow` (`coordinator.mjs:6738` region);
  `_isReviewAuthority` ALREADY admits a live run-orchestrator lease holder as review authority
  (`coordinator.mjs:6752-6756`); facade `run.attention.watch` contracted #87.
- **DECISION_REQUEST escalation to the human orchestrator** — the worker wire grammar is LANDED
  (`impl/src/claude-session.mjs:27` `DECISION_REQUEST_GRAMMAR`; single-request pin `:1122`):
  usable from inside the worker TODAY, no new authority; the human answers via `run.answer` /
  `baton_decision_answer` (`mcp-northbound.mjs:507-518`, per contract `:801`).
- **Recipes (RC-A)** — `impl/src/recipes.mjs` invocation manifests: packaging, not authority; the
  coordinator-member recipe is #74's own deliverable.

**Summary:** post-#12, the only #74 lanes fully landed for a worker are DECISION_REQUEST
escalation and lease-bound nested run.start/stop (+ recursive reads). waves.* surfaces are landed
but lease-holder authorization is unverified; the eight #87 workflow lanes are contracted, not
landed; board worker-half and BD3-B context packs are kernel-only.

## 5. VERDICT — the minimal #12 rung that unblocks #74

**The minimal rung is a minted, lease-bound child connection profile, projected at spawn — three
insertion points, zero new authorities.** (1) At spawn the resident issues a CHILD session via the
existing `WebSessionStore.issue` (`web-auth.mjs:128`) with capabilities `['observe','control']`,
ttl pinned to the run-orchestrator lease, and binds it to a lease minted through the existing
`issueRunOrchestratorLease` (`coordination-store.mjs:1857`) — the `acquireBoardLease`
sessionAuthority envelope (`coordinator.mjs:10519-10526`) is the exact binding shape, consumed by
`_recursiveLease` (`application.mjs:4238`). (2) `RuntimeIsolation.create` gains a projection step
(`runtime-isolation.mjs:140-150`, wired from `application-deployment.mjs:1696-1701`) that WRITES
the fresh profile+token into the worker's private `home/.config/baton/connections/` mode-0600
(minted content, credential-projection mechanics at `credential-projection.mjs:146`) and digests
the projection into `posture` → the `runtime.scope_created`/`lifecycle.spawned` receipts
(`coordinator.mjs:8234`,`:3508`). (3) Worker terminal/reap calls `sessions.revoke`
(`web-auth.mjs:149`) + `revokeRunOrchestratorLease` (`coordination-store.mjs:1886`) before
`_removeRuntimeScope` destroys the home (`coordinator.mjs:8242`), with a
`sweepSettlementLeases`-pattern orphan sweep (`coordination-store.mjs:12397`). That satisfies all
four #12 acceptance bullets — bounded child runs via the LANDED recursive gate
(`application.mjs:12101-12110`), revocable digested projection in spawn/stop evidence, owner
profile store never read, and red tests riding the existing lease/replay/cleanup harnesses.
**Deliberately NOT in v1:** widening the recursive-session gate so lease-holders reach
waves.*/message/board lanes (that is #74's own rung atop the contracted #87 surface); any
`sessionAuthority` on MCP ordinary tools; capabilities beyond `observe`+`control`; reading or
copying the owner's profile store; BD3-B context-pack facade projection (kernel-only today —
flagged as #74's second gap); homelab integration (excluded by the issue).

*Caveat noted for the record: issue #74 cites demo evidence at
`docs/reference/evidence/nested-orchestrator-2026-08-02/`, which does not exist in the tree
(glob-verified 2026-08-03) — a stale or aspirational reference.*
