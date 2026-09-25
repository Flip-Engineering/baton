# 42 — Deployment topology beyond one host (design, issue #298)

Status: proposal, 2026-09-14. Written by the root after a day of operating two clone-hosted residents
through fourteen landings. Decisions are marked **D**; open questions **Q**. Related: #297 (host
capacity), #294 (native wake delivery), #306 (resident reincarnation), #296 (swarm.integrate).

## 1. What a deployment is today (observed, not designed)

- A deployment is one `baton serve <config>` process. It serves the code of the commit its clone
  is at, over a local transport (`"transport":"local"`, a Unix socket), and publishes a selector
  record under the clone's `.git/baton/` that CLI/MCP clients on the same host read to find it.
- Repository identity is derived from the clone path (`repoId: repo-<hash>`), so two clones of the
  same repository on one host are two repositories to Baton. A resident cannot serve a repository
  it did not clone.
- Everything the deployment owns lives under one filesystem: the coordination ledger and its
  projections (`state/`), participants' checkouts (`.baton/wt/ws-*` worktrees of the clone),
  process groups, the capacity files, evidence, and the pinned progress checkpoints
  (`refs/baton/checkpoints/<sha>` in the clone's git).
- A root on another machine has no path in: no discovery record it can read, no transport it can
  reach, and no way to receive a checkpoint except by fetching the clone over ssh by hand.

## 2. Invariants worth keeping

1. **One ledger per deployment, one writer.** The durable coordination ledger is the deployment's
   truth; its writer authority is a lease (`coordination_writer_busy` / `coordination_writer_lost`
   are already the refusals). Nothing in this design adds a second writer to a ledger.
2. **Checkpoints are git objects, captured by sha, retained by ref.** A capture names a commit; the
   ref is the retention. This already moves between clones with `git fetch` — by hand today.
3. **Worktrees, process groups and capacity are host-local facts.** They belong to the host that
   holds the files and the pids; they never travel.
4. **The principal model does not change with distance.** A remote caller is the same principal
   the local CLI is (the session digest and the bridge attestation that #287 landed), over a
   transport that can carry it safely.

## 3. The model

**D1 — Repository identity is the remote, not the path.** `repoId` derives from the canonical
remote URL and the default branch (with the path as a fallback for a repository that has no
remote), so every clone of one repository on any host is the same repository to Baton. A
deployment records which clone it serves; the doctor shows it.

**D2 — A resident is host-bound; a deployment may span hosts as a set of residents.** One resident
is the deployment's *home* (it owns the ledger); other residents on other hosts are *members* that
own worktrees, process groups and capacity there. A member holds no ledger of its own: it appends
through the home over the transport under the same writer lease, exactly as a participant bridge
appends today. (Alternative rejected: one ledger per host with reconciliation — a second writer.)

**D3 — Transport.** The existing web transport gains a second binding beside the Unix socket: TCP
with mutual TLS or an ssh-forwarded socket, chosen by the operator in the serve config. The
publication record gains `transport: {kind, endpoint, fingerprint}` and is also written to a
discovery location a remote root can read: the repository's remote itself
(`refs/baton/deployments/<deploymentId>` carrying the publication as a blob), so discovery needs
nothing but git access. **Q1**: is a ref the right discovery channel for a resident that
reincarnates often (#306), or should the remote publish to a small registry the operator names?

**D4 — Checkpoints move by ref, never by path.** A capture on a member host pushes the checkpoint
ref to the repository's remote namespace (`refs/baton/checkpoints/<sha>`); the home records the
capture with `{sha, ref, host}`; `swarm.integrate` (#296) fetches by ref from wherever it runs.
Retention (which refs may be pruned) stays the home's decision, recorded in the ledger.

**D5 — Recruit names the host.** `swarm.recruit` gains `host` (a member resident id, default: the
home); route readiness (the doctor) is per host, since credentials and harness binaries are
host-local; capacity admission (#297) is per host. The participant row carries `host`, and the
wake summary for `participant_recruited` names it.

**D6 — Attention, wakes and guidance are home-owned.** They are ledger rows and projections, so a
member's worker events flow to the home's ledger and every consumer (view, watch, MCP
notifications from #294) reads one place. A member that loses the home is a typed condition
(`deployment_home_unreachable`) on its own doctor; its workers keep running, its appends queue
under a bounded local buffer and replay in order when the home returns — **Q2**: bounded by what
physical resource, and what does the worker see while queued?

**D7 — Time.** Ledger `ts` is stamped by the home's clock at append; member hosts contribute
observation times as payload fields, never as ledger time. Ordering is `seq`, as today.

## 4. What this does not do

- No cross-host worktree: a participant's checkout is on the host that runs it. Shared-checkout
  custody (#263) is therefore host-local by construction.
- No federation of ledgers, no leader election. One home per deployment; reincarnation (#306)
  hands the home over in place on its own host.
- No new principal kinds. A remote root is a session principal like a local one.

## 5. Increments

1. **Discovery and transport** (a lane): D1, D3 without members — a single home reachable
   remotely; the CLI and MCP bridge take a remote publication; the doctor names the host and the
   transport. Test: a root on host A drives `swarm.create/recruit/view` against a resident on host
   B through an ssh-forwarded socket, then through TLS.
2. **Checkpoints by ref** (a lane): D4 — capture pushes the ref, integrate fetches it, the capture
   row carries `host`. Test: capture on B, integrate on A, byte-identical tree.
3. **Member residents** (a lane after #297 and #306): D2, D5, D6, D7 — recruit with `host`, member
   appends through the home, the queued-append condition typed. Test: a swarm with one participant
   on A and one on B under a declared synchronization point.

## 6. Why now

The operator's GPU host is the natural place for provider-heavy lanes, the root already runs the
two residents it has by hand from a laptop, and every gap above was hit today by one person with
two clones on one machine. The design keeps the parts of Baton that are right (one ledger, typed
refusals, git custody) and adds distance without adding a second source of truth.
