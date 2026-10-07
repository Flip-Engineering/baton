# ROW BRIEF — row-dsh-seams: dsh's capability seams + composition vs baton's adapters/routes

Read `foundry-brief.md` first (the shared laws bind you). Your lane: **capability packaging —
seams, providers, swappability, and what it means for harness/models/tools**.

Ground in the digest: `capability-seams.md` (the full seam catalog — Definition/Provider/
Consumer triples; the "one provider swap moves the whole product" claim: fs+subprocess+LSP to
a remote sandbox), `subsystems/tools.md` (the scoped tool registry + guarded pipeline),
`subsystems/subagent.md` (subagent providers behind one interface — from a fresh child to a
delegated turn in another product), `subsystems/llm-streaming.md` (the adapter seam),
`architecture.md`'s profiles/bundles section.

Baton's side: the harness adapter registry (`impl/src/adapter.mjs`, `cli-adapters.mjs` —
deepseek/glm/claude routes), the route admission (#167 readiness honesty), the resident's
explicit routes (`impl/scripts/resident.deployment.mjs`), #144 (the LSP pool — compare dsh's
LSP-via-fs/subprocess-seam remote move), the OhMyPi-harness ideation (operator's LOW item),
#74 (the sub-orchestrator seat), the MCP northbound surface (baton EXPOSES itself as MCP —
dsh is a host; compare the two postures).

Candidates to evaluate (find your own too): the seam triple as a discipline (Definition/
Provider/Consumer — does baton's adapter/route machinery have the three roles cleanly or is
the consumer tangled with the provider? Cite the code); subagent-behind-one-interface (dsh's
providers range from child-agent to delegated-turn-in-ANOTHER-product — the baton reading:
harness adapters ARE this, but a "delegated turn in another product" provider would make a
Claude Code / OhMyPi session a wave member without the CLI spawn — evaluate against the
adapter layer); the guarded tool pipeline (`tools/pre-execute` waterfalls as policy — vs
baton's `_authorize` + scope enforcement, and #176's pre-gate hole as the counterexample);
the config-patch composition (any row replaceable — vs baton's deployment-file constants;
would a patch layer have prevented the resident-verifier-`true` gap, #180?); LSP through the
fs/subprocess seam (dsh moves LSP to a sandbox by moving the SEAM — baton's #144 pool is
hub-managed local; the remote-sandbox reading of the pool). For each: ADOPT/ADAPT/REJECT/
ALREADY-HAVE with the landing zone.

Deliverable: `docs/reference/evidence/dsh-comparison-2026-08-13/dsh-seams.md`.
