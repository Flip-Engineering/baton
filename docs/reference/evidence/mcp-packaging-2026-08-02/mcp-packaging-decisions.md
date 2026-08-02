# MCP-first + packaging epic contract (v0.9, pre-red-team)

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
