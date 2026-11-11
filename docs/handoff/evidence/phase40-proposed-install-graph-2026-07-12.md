# Phase 40 — proposed install graph and actual delta

Phase 40 ships Quartermaster's non-installing `provenance.plan` rung for npm. One exact package and
SemVer request is resolved from the checked-out `package-lock.json` v3 plus sibling `package.json`
inside a disposable supervisor root. The result is a proposed-not-installed CycloneDX graph and a
deterministic actual-to-proposed delta. It has no install, decision, verification, merge, or policy-
override authority.

## Boundary that shipped

- The Coordinator-owned ACI registry is the only public handle. Direct, authenticated web, and MCP
  invocation share actor, repo, budget, cancellation, audit, and result validation.
- Callers supply only a confined lockfile path and exact npm coordinate. Proposed bytes, registry,
  command, resolver, policy, and source paths are not caller fields.
- Quartermaster opens and digests the actual lockfile and manifest, passes immutable byte copies,
  and rechecks bytes plus canonical identities after resolution. Manifest or lockfile drift discards
  the proposed result.
- Existing root manifest/lock requests and every proposed dependency map accept only registry
  SemVer versions/ranges. File/workspace/link, Git/SSH, URL, hosted shorthand, and npm aliases are
  rejected before npm or the proxy starts.
- The deployment npm supervisor measures the exact Node runtime, npm, `/usr/bin/sandbox-exec`, and
  generated profile bytes. macOS
  Seatbelt denies writes outside the invocation root and denies direct network. A supervisor-owned
  loopback CONNECT proxy admits only `registry.npmjs.org:443` in the live deployment.
- The fixed npm argv uses `--package-lock-only --ignore-scripts --save-exact --no-audit --no-fund`,
  an owned cache/home/tmp and distinct empty user/global config files, bounded output, a deadline,
  and cancellation.
- Every child inherits a random invocation marker while a 5ms OS ancestry monitor persists newly
  observed descendants with process identity. Cleanup and restart reconciliation therefore retain
  a detached `setsid` child even if it clears the marker; a numeric PID is not trusted alone. The
  fully initialized supervisor lease is fsynced privately and atomically hard-linked into its
  exclusive public name; a separately published recoverable takeover claim serializes stale
  replacement, binds PID plus operating-system process start/command identity, distinguishes
  unknown liveness, and has an explicit release path.
- The receipt binds exact executable/sandbox paths and digests, argv, both source digests,
  coordinate, proposed digest, registry policy, proxy result, isolated handles, exit, and cleanup.
  Quartermaster calls the injected supervisor verifier instead of trusting receipt booleans.
- Proposed lockfile, SBOM, receipt, delta, and complete plan are separate content-addressed
  artifacts. Offline reverify binds their order/kind/media/digest, receipt, actual source, root,
  exact coordinate, proposed SBOM, and recomputed delta without repeating registry resolution.

## Validation

- Focused Phase 40: **11/11**.
- Canonical owner-managed `npm test`: **882/882**; its fixture root was reaped.
- Live official npm proof: **11/11** using npm 11 and exact `is-number@7.0.0`. It observed an exact
  proxy request, Seatbelt/direct-network denial posture, no source edit or `node_modules`, offline
  reverify, invocation cleanup, and lease release. The durable claim and five addressed artifacts
  are in `docs/reference/evidence/phase40-proposed-install-graph-live-2026-07-12/`.
- The focused supervisor test covers fixed argv, actual dev-dependency preservation, write escape,
  direct egress denial plus authenticated rejection of an alternate CONNECT authority, output
  overflow, nonzero exit, timeout, same-tick cancellation, an active detached marker-clearing child,
  restart orphan reconciliation, idempotent root cleanup, simultaneous stale-lease takeover,
  exclusive lease, and constructor-failure recovery.
- Authenticated real WebNorthbound and MCP tool calls both reach `provenance.plan` through the
  Coordinator-owned capability instance.

## Recursive Baton evidence

The Phase 40 contract was first reviewed through Baton by exact `glm-4.7` at native `low` effort.
The successful clean-worktree attempt observed model/PID, fresh verification, normal kill, and full
process/worktree/runtime/branch reap. Its report, adjudication, and failed-attempt ledger are under
`docs/reference/evidence/phase40-proposed-graph-glm-review-2026-07-12/`.

A current two-worker retry requested exact `grok-4.5` and `grok-composer-2.5-fast` concurrently.
The dirty-checkout attempt correctly refused both before provider spawn and reaped all owned state.
A clean detached retry reached Grok startup, but the installed CLI reported `Authentication
required` (a direct `grok models` check also reported unauthenticated). No provider PID or model
identity was invented; all worktrees, runtime homes, metadata, and branches were reaped. The two
honest failure ledgers are in `phase40-concurrent-grok-dirty-refusal-2026-07-12/` and
`phase40-concurrent-grok-auth-refusal-2026-07-12/`. The earlier successful exact concurrent Grok
interrupt/resume/kill/reap proof remains Phase 21 evidence; this retry does not replace it.

## Honest boundary and next dependency

This phase does not install or mutate a package, scan every transitive advisory, prove vulnerable-
function reachability, independently verify Sigstore/SLSA, run Socket, support another ecosystem,
approve a reuse decision, merge, publish, export to project-manager, or integrate with homelab.
The next supply-chain dependency is transitive advisory projection and reachability prioritization;
known advisories must remain fences regardless of reachability. Additional ecosystems and
independent provenance remain separate later contracts.
