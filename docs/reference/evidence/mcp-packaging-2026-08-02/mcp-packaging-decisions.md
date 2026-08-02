# MCP-first + packaging epic contract (v1.0, post-red-team fold)

(Red-teamed by baton wave: `redteam-authority.md` (codex — 4 CONFIRMED-HOLEs, 2
NEEDS-AMENDMENTs) and `redteam-lifecycle.md` (glm — the acceptance-driver walk fails at 5 of
7 steps today, 2 CONFIRMED-HOLEs + amendments). v0.9's gaps were mostly real and precisely
named; the fold below is the corrected shape. v0.9 seed preserved at the end.)

## v1.0 decisions

### MCP-W1 — Wave ergonomics on the ordinary MCP surface (AMENDED)

New ordinary-surface tools, each riding an existing or new registry row (the reflex table
DERIVES from the rows — S-3's law):

- `waves.start` — detached semantics (`{waveId, members: [{role, runId}]}`, live handles
  never cross transport). **Admission enforces the deployment profile's routes AND scopes
  (application.mjs:2969-3008's exact path), and quota debits PER MEMBER, not per call
  (codex #1: one debit must not fan out to 64 starts) — a wave-quota class
  {wavesPerWindow, membersPerWindow} on the host's takeToolQuota.**
- `waves.progress` — **paginated and cursor-fresh (glm #1): never one oversized frame.
  `{cursor, members: [{role, phase, progressClass, attention, knowledge}]}` — members
  paginated ≤ 16 per page with `nextCursor`; the cursor rides the run.follow cursor chain
  so a repeated read is freshness-provable (never hallucinated-as-fresh). No
  application_run_view_oversize by construction (per-member bounded projections, the
  wave-driver's own digest-reduced shape).**
- `waves.send` / `waves.stop` — steer/stop one member by runId.
- `decision.answer` — `{runId, requestId, optionId|text}`, once-per-record, **with the
  repository coordinate enforced (codex #2): the interaction's run must belong to the
  caller principal's repo scope before any state read — a cross-repo requestId refuses
  `application_interaction_not_found` identically to an unknown one (no existence leak).
  The `already_resolved` outcome is returned as a distinct typed result
  (`{result: 'already_resolved', resolvedBy}` where the record carries it) and documented
  in the tool description — a late answerer must NOT re-spawn work (glm #3).**

**Resume-steer is explicit (glm #2):** `waves.attach` over MCP returns the members' runIds;
`waves.send`/`waves.stop`/`waves.progress` are LIVE on those runIds afterward — that IS
the resume path, and the tool descriptions say so. **The attach response carries
`harvestReplayed: true` when the wave's detached record already settled (glm #4); callers
key outcome accounting on `resultSha`, never `outcomes.length` (the store never
double-admits; the flag kills caller-side double-counting).**

Red-team residue accepted: host death mid-wave leaves runs live and steerable via
re-attach (93B's binding proof); an MCP host that never re-attaches leaves the wave to the
drivers' own stall machinery — documented in MCP.md.

### MCP-W2 — Settlement commands on MCP via the S-2 envelope (AMENDED)

The four settlement ops become MCP tools behind the S-2 sessionAuthority envelope, with
two hard amendments from codex:

- **The session gate precedes replay (codex #2b):** admission evaluates the session
  binding BEFORE any idempotent-replay path — a replayed admit with a foreign/expired
  session refuses with the typed session code, never a replay shortcut. (This amends
  `admitWorkflowFinding`'s check ORDER at the store: session binding first, then
  `_byKey` replay — replay-exactness of the prior event is still validated.)
- **MCP callers present the envelope; the host mints nothing for them
  (codex #2a):** `knowledge.promote` on MCP requires the `sessionAuthority` proof bound
  to the settlement lease, validated exactly as admitBoardCommand does — presenter
  authentication is the lease's session binding (XB), and the envelope is how an MCP
  caller PROVES possession of the same session coordinates the host used at mint.
- **`knowledge.settlement_lease` on MCP derives the session from the host's fixed
  principal (documented single-orchestrator posture, codex #3):** an MCP host IS one
  orchestrator authority — the tool is enabled ONLY when the descriptor's principal
  carries an explicit `settlement` capability class (never default); multi-principal MCP
  hosts must not enable it. MCP.md states this trust posture verbatim.
- **KS9's embedded-only pin is amended deliberately:** the four rows gain `mcp` in
  `surfaces` with the envelope/capability requirements above — one registry-row edit per
  row, reflex table re-derived, MCP inventory re-rendered.

### MCP-W3 — Readiness on MCP (AMENDED)

`deployment.doctor` — ordinary tool, per-call FRESH doctorReadiness (never open-time
cached), credential posture as metadata only (source kind, expiry class, NEVER token
material), workspace capacity. **Free of tool quota (glm #6: doctor is the route-picking
prerequisite; charging quota for it would blind callers exactly when they need it).**

### PKG-1 — Declarative deployment descriptor (AMENDED)

`baton-mcp <descriptor.json>` (+ `baton-mcp-web`): bounded closed JSON — `{repo,
deploymentRoot, routes: [{harness, model, effort, credential: {kind: 'env'|'keychain'
|'file', ref}}], surface, principal: {userId, capabilities[]}, quotas}`. Amendments:

- **Credential refs:** env refs name env vars; keychain refs name items; file refs are
  repo-relative AND containment-checked (must resolve inside the repo root, no symlinks
  out). **Env-sourced secret VALUES join the same redaction class as file-sourced ones
  (codex #4): runtime-isolation's file/tree/log projections redact both classes —
  extending runtime-isolation.mjs:104-155's redactor to every credential class the
  descriptor supports.**
- **Pinned at open (glm #5):** the descriptor is read once at startup and immutable for
  the server's life; edits require a restart (stated in the parse error text and MCP.md).
  Parse failures name the field and the constraint, never the value.
- **Distribution story is honest:** `private: true` stays; distribution is
  npx-from-git (documented) — no registry publication in v1.

### PKG-2 — npm-package hygiene (AMENDED)

- `package.json`: `files` allowlist (src, scripts, MCP.md/CLI.md — never evidence, never
  .baton, never credential files); `exports` map for `baton/impl` so descriptors import
  the package identity, not repo paths.
- **Lazy native imports (codex #6):** `@ast-grep/napi` and the Atlas stack load lazily
  (the stdio/bin paths never import them eagerly); a clean-host install without the
  native toolchain degrades to `atlas: unavailable` honestly (the registry's existing
  availability posture) rather than failing to install.
- **Gate test:** `npm pack` → install into tmpdir → descriptor-driven stdio smoke (the
  baton_mcp handshake + `deployment.doctor` through the packed install) — in the gate.
  The tarball is asserted credential-free and evidence-free (a file-list pin).

### PKG-3 — The external-consumption guide

MCP.md rewritten descriptor-first: connect (descriptor), read readiness
(`deployment.doctor`), orchestrate a wave (the acceptance walkthrough — start → progress
with cursors → decision.answer with already_resolved semantics → attach + resume-steer →
harvest keyed on resultSha), admit knowledge (the envelope + single-orchestrator
posture). README's external-session quickstart points there. CLI.md: the CLI stays the
human thin client.

## Non-goals (v1, unchanged from v0.9)

No npm registry publication. No MCP-over-network auth model. No wave-driver semantic
changes. #47's inference-readiness tier itself (MCP-W3 is its surface only). No
settlement-lease revocation tool.

## v1.0 acceptance (red-first)

- An external driver process, connected ONLY via stdio MCP with a declarative descriptor,
  reads readiness, starts a 2-member wave, pages progress with cursors, answers a
  decision (and observes already_resolved once), re-attaches after a simulated host
  restart, resume-steers, and harvests keyed on resultSha — no embedded API touched.
- Settlement ops work through MCP with the envelope; a foreign-session envelope fails
  with the session code EVEN ON REPLAY (the reordered gate); the KS9 amendment is exact.
- `deployment.doctor` is quota-free, fresh per call, and carries zero secret material.
- The npm pack → clean install → descriptor smoke test passes; the tarball's file list
  is pinned (no credentials, no evidence, no .baton); native-dep-less install degrades
  honestly.
- MCP.md's quickstart is executable truth (the acceptance driver follows it verbatim).

---

## v0.9 seed (preserved for traceability)

(Seed: operator steering 2026-08-02 — "as we proceed towards a more feature complete and
functional baton, we will also need to more directly emphasize the MCP and also packaging it
for use outside of this session." Settled framing from the AX campaign: MCP is the primary
agent-facing surface; CLI is the human/operator thin client; embedded is baton-eats-baton.
Every AX report ranked this: "if other harnesses are meant to orchestrate through baton, the
MCP surface needs the same wave-level ergonomics I needed as a driver, validated end-to-end.")

## Ground truth

1. **An external harness cannot drive a wave.** The ordinary MCP surface (17 tools,
   MCP.md generated inventory) has `baton_waves_attach` but no wave start, no wave progress,
   no wave steering, no decision answer lane. Waves — the campaign's core composition — are
   embedded/CLI-only. Every dynamic workflow this repo ships is unreachable from the surface
   we tell other harnesses to use.
2. **The settlement commands are embedded-only by design (v1)** and MCP enablement needs
   the session binding: `knowledge.promote` rides a lease that is now session-bound (#63's
   XB); an MCP caller must prove the acquiring session, exactly the problem S-2's
   `sessionAuthority` envelope solved for board commands (admitBoardCommand,
   coordination-store.mjs:13495+).
3. **External consumption means hand-writing code against repo internals.** The stdio MCP
   (impl/scripts/mcp-stdio.mjs) requires a config FACTORY MODULE that imports absolute paths
   into `impl/src/` — no declarative descriptor, no npm-distributed package (`private:
   true`, no `files` allowlist, no pack conformance). A harness author today must understand
   createDriver/BatonApplication/principals to connect.
4. **Readiness honesty doesn't cross the boundary.** An external orchestrator picks routes
   blind — doctor/readiness (including credential state) is not an MCP tool. #47 (bounded
   actual-inference readiness) is its own issue; the SURFACE for it is this epic's.

## The question

Can an external agent harness — given nothing but `baton-mcp` and a declarative descriptor —
orchestrate a full dynamic workflow (wave start → progress → decision answers → settle →
knowledge admission) through MCP alone, with every authority guarantee the embedded path
has? That is the bar for "baton outside this session."

## Decisions (draft, to be red-teamed)

### MCP-W1 — Wave ergonomics on the ordinary MCP surface

New ordinary-surface tools, each riding an existing registry row (grammar-conformant, the
reflex table DERIVES from the rows — S-3's law):

- `waves.start` → start a wave (members with exact routes restricted to the deployment
  profile, scopes validated, objectives bounded) — the detached semantics: returns
  `{waveId, members: [{role, runId}]}`; live handles never cross the transport (S-1's
  transportHidden law).
- `waves.progress` → the wave-driver progress projection (per-member phase, stall markers,
  attention, decisions pending, knowledge counts).
- `waves.send` → steer one member (nudge/message through the member's run).
- `waves.stop` → stop one member or the wave (close semantics).
- `decision.answer` → answer a pending decision (first-class lane; the run.do/act path
  stays but this is the ergonomic one): `{runId, requestId, optionId|text}`, validated
  against the live pending record, once-per-record.

End-to-end validation is part of the contract: an EXTERNAL driver process orchestrates a
wave exclusively through these tools (the acceptance wave — dogfooding the packaged
surface).

Red-team targets: authority of wave start over MCP (profile-restricted routes only — no
arbitrary harness/model; quota on fleet_run_start's siblings); the progress projection's
leak class (digest-vs-content honesty, same as run views); decision.answer's principal
binding (who may answer — the deployment principal, never caller-named).

### MCP-W2 — Settlement commands on MCP via the S-2 envelope

The four settlement ops (`scratchpad.elevate/settle`, `knowledge.promote`,
`knowledge.settlement_lease`) become MCP tools behind the SAME proof-of-principal envelope
shape as S-2's admitBoardCommand: the caller presents a `sessionAuthority` proof
{authorityDigest, expiresAt, orchestratorLeaseId, schemaVersion} bound to a settlement
lease minted through the surface; the store re-derives identity from the lease, never from
caller fields (the lease's session binding from #63's XB is the enforcement point).
`knowledge.settlement_lease` on MCP derives the session from the DEPLOYMENT principal (the
host's fixed identity), never from tool arguments.

Red-team targets: the envelope crossing stdio (digest-as-bearer vs session-bound — XB made
the lease session-bound; does the envelope add anything or is it ceremony?); replay/
idempotency across transport retries; the embedded-only v1 pin (KS9) must be amended
deliberately, not drifted.

### MCP-W3 — Readiness on MCP

`deployment.doctor` → an ordinary MCP tool returning the doctorReadiness projection
(routes with state/summary, credential posture WITHOUT secret material, workspace
capacity). This is the honest surface #47's inference tier will later extend; v1 reports
the existing readiness exactly (no new probing).

Red-team targets: leak review (credential metadata — expiry/source kinds, never tokens);
freshness (per-call fresh read, not open-time cached).

### PKG-1 — Declarative deployment descriptor

`baton-mcp <descriptor.json>` (also honored by `baton-mcp-web` and the CLI's MCP-hosting
paths): a bounded JSON descriptor — `{repo, deploymentRoot, routes: [{harness, model,
effort, credential: {kind: 'env'|'keychain'|'file', ref}}], surface: 'application'|'advanced'
|'combined', principal: {userId, capabilities[]}, quotas}`. Credential refs resolve
server-side (env var names, keychain item names, repo-relative file paths); secret
MATERIAL is never in the descriptor. The code-factory path stays for advanced deployments
(back-compat), but the documented default is the descriptor. Descriptor schema is closed,
validated, and rendered into MCP.md's quickstart.

Red-team targets: descriptor injection (path escape outside repo root; file credential refs
pointing outside the repo; schema smuggling); the `private: true` story (publish vs
npx-from-repo — pick one and document honestly).

### PKG-2 — npm-package hygiene for external installs

`package.json`: a `files` allowlist (src, scripts, docs essentials — never evidence,
never .baton, never credentials); bin entries verified runnable from a packed tarball
(`npm pack` + install-into-tmpdir + stdio smoke through a fixture descriptor) as a gate
test; engines/exports truth (`exports` map for `baton/impl` so descriptors import the
package, not repo paths); version stays 0.1.0 (no publication — npx-from-git is the
distribution story for now, documented).

Red-team targets: the tarball's leak surface (glm_key.json/deepseek_key.json at repo ROOT
are NOT in impl/ — assert the pack excludes them); node-version floor honesty
(engineStrict? documented only); whether `@ast-grep/napi` (a native dep) breaks the
install on a clean host (optionalDependencies vs required — decide).

### PKG-3 — The external-consumption guide

MCP.md rewritten descriptor-first: connect (descriptor), orchestrate a wave (the MCP-W1
walkthrough with the acceptance driver's transcript), answer decisions, admit knowledge,
readiness. README's external-session quickstart points there. CLI.md notes the CLI stays
the human thin client.

## Non-goals (v1)

No npm registry publication (npx-from-git only, documented). No MCP-over-network auth
model (local stdio + the existing web bridge's local posture only). No changes to the
wave driver's semantics (MCP is a surface over it). #47's inference-readiness tier itself
(surface only). No settlement-lease revocation tool (admission completes it; the sweep
owns residue).

## Acceptance (red-first)

- An external driver process, connected ONLY via stdio MCP with a declarative descriptor,
  starts a 2-member wave, watches progress, answers a decision through `decision.answer`,
  and settles with outcomes harvested — no embedded API touched (source-scanned).
- The four settlement ops work through MCP with the S-2 envelope; a forged/stale envelope
  fails with the typed codes; the KS9 embedded-only pin is amended exactly for these rows.
- `deployment.doctor` returns fresh readiness with zero secret material.
- `npm pack` → clean install → descriptor-driven stdio smoke passes in the gate; the
  tarball contains no credentials and no evidence dirs.
- MCP.md's quickstart is executable truth (the acceptance driver follows it verbatim).
