# Contract seed — #152 workflow-surface docs disclosure + evidenceRef schema

[attempt: 1faf10bb-21ed-41d5-8bc7-540abddb4af6 row-seeds]

Origin: `gh issue view 152` is not reachable (`gh` unauthenticated; number absent from this repo's
history). Grounded in the row brief's stated scope — "what the workflow surface discloses to whom, and
the evidenceRef schema as data" — and in the landed workflow surface (`waves.*`, the #132 roster
projection), the per-principal visibility doctrine (`docs/32-reflexive-orchestration.md`), the run
view's evidence disclosure (`web-operator.mjs`), and the evidenceRef artifact schema
(`context-call.mjs` / `context-authority.mjs`).

- **Date:** 2026-08-14 · **Status:** SEED (Ring-2 draft; red-first; specifies behavior, lands no code)
- **Verification HEAD:** `5ae2c7e5c93d99404d3a292e777dd30f7d2ead27`. Every `file:line` below was
  re-verified this session at this HEAD (grep/sed/Read; NUL discipline on `application.mjs` /
  `coordination-store.mjs`).
- **Scope of the seed, in one sentence:** the workflow surface (`waves.list` / `waves.progress` /
  `waves.run` / `waves.compile` / the run view) discloses bounded workflow state — roster, phase,
  progress class, member status — to the querying principal, and discloses the evidenceRef SCHEMA as
  data (the closed artifact-ref shape), never the materialized evidence bodies; each surface teaches
  the schema per the #159 surface doctrine.

---

## Ground truths (verified this session)

- **G1 — the workflow surface is the `waves.*` canonical lane, disclose-by-verb.** `waves.list` is an
  observe verb answering "the in-flight wave set for THIS deployment, sourced from the wave registry
  projection in the coordination store (never live run inspection)"
  (`application-semantics.mjs:1622-1624`), on embedded+cli+mcp+web (`:1626`). The lane is
  `waves.start/progress/list/run/send/stop/attach/compile` (`application-semantics.mjs:1622-1661`;
  MCP.md:95-158).
- **G2 — `waves.progress` discloses bounded per-member projections.** Each member is
  `{role, phase, progressClass, attention, knowledge}`, ≤16 per page with an explicit
  `{cursor, nextCursor}`, rebuilt from live state (MCP.md:115-118). `waves.list` surfaces the roster
  + phase + progress class (README.md:85, the #132 projection).
- **G3 — disclosure is per-principal and sanitized.** "the orchestrator sees everything. Sanitized
  projections on RunView/CLI/MCP" (`docs/32-reflexive-orchestration.md:197-199`); the run view and the
  wave verbs are the same sanitized projections, never raw inspection (G1).
- **G4 — the run view discloses evidence as a manifest SUMMARY, never bodies.** The web run view
  renders `state.evidence` as `Manifest <manifestDigest> · Phase <phase> · <n> durable artifact(s)`
  (`web-operator.mjs:163`). Only a digest and a count cross the surface; the bodies stay in the
  evidence store.
- **G5 — the evidenceRef schema is closed and kernel-only.** The artifact ref is the exact field set
  `{kind, mediaType, handle, digest, bytes}` with `handle === 'art:sha256:<digest>'`
  (`context-call.mjs:121-132`); `normalizeContextArtifactRef` enforces the closed set, the
  `ARTIFACT_MEDIA` media type, and `bytes ≤ maxArtifactBytes`, refusing `context_artifact_integrity`
  (`context-authority.mjs:146-159`). The evidence media types are
  `application/vnd.baton.context-cell-evidence+json` and `application/vnd.baton.context-call-evidence+json`
  (`context-call.mjs:61-62`).
- **G6 — no workflow surface discloses the evidenceRef schema as data today.** The `waves.*`
  projections (G2) carry no evidenceRef field; the run view carries a manifest digest + count (G4);
  the schema's field set and handle derivation exist only inside the kernel validators (G5).

## Decisions

- **D1 — the workflow surface discloses roster / phase / progress class / member status as bounded
  projections.** That is already the disclosed shape (G2/G3) and the seed pins it as the ceiling: the
  projection is the registry projection, never live run inspection (G1).
- **D2 — evidenceRef is disclosed AS DATA, never as materialized evidence.** The surface discloses the
  artifact ref `{kind, mediaType, handle, digest, bytes}` for the evidence a run produced; the
  materialized body is reachable only through the evidence read lane (the `context.read` port of
  seed-151), gated by the same authority.
- **D3 — the evidenceRef schema is taught per the #159 surface doctrine.** Every surface that
  discloses evidence (the run view today, the wave surface after this seed) must teach the closed
  field set, the `art:sha256:<digest>` handle derivation, and the two evidence media types — so a
  consumer can construct and verify a ref without reading kernel source.
- **D4 — a ref is a lookup key, never a body; a digest is never authority.** D2's ref discloses the
  schema and the identity, not the content; materialization rides the read lane's run-horizon
  authorization (cross-ref seed-151 D1/D2).

## Closed refusal vocabulary

| code | condition | anchor |
|---|---|---|
| `context_artifact_integrity` | a disclosed/constructed evidenceRef violates the closed field set, media type, handle derivation, or byte ceiling | `context-authority.mjs:156` |
| `context_artifact_unavailable` → `artifact_unavailable` | a disclosed ref's artifact is missing when a consumer asks for the body | `mcp-northbound.mjs:318` |
| `application_run_view_oversize` → `temporarily_unavailable` | a run/wave view would disclose an oversized projection | `web-northbound.mjs:219`, `mcp-northbound.mjs:256` |

## Red-first acceptance pins

Every pin is RED at the verification HEAD.

- **A1 (RED) — the evidenceRef schema is not disclosed as data on any workflow surface.** At HEAD,
  `waves.list`/`waves.progress` carry no evidenceRef field (G2, G6), and the run view shows only a
  manifest digest + artifact count (G4). Pinned: the schema `{kind, mediaType, handle, digest, bytes}`
  + the `art:sha256:<digest>` derivation + the two media types are disclosed/teachable from the
  surface (D2/D3).
- **A2 (RED) — a disclosed evidenceRef is a REF, never a body.** The pinned run-view/wave-surface
  disclosure carries the ref fields, not the materialized evidence (D2/D4). RED at HEAD only in the
  weak sense: nothing discloses the ref today (A1), so nothing guarantees the ref/body boundary.
  Pinned: the boundary is the disclose shape.
- **A3 (RED) — every disclosed evidenceRef satisfies the closed validator.** Any surface-disclosed
  ref must pass `normalizeContextArtifactRef`'s exact-set/media/handle/bytes checks
  (`context-authority.mjs:146-159`) — asserted RED because no surface currently produces a ref to test.
- **A4 (RED) — disclosure is per-principal.** A viewer outside a wave cannot read its members'
  projections, and the roster is disclosed only as the querying principal's authority allows (G3). At
  HEAD `waves.list` is deployment-scoped (any authenticated deployment principal lists the in-flight
  set — G1); per-wave viewer scoping is not pinned. Pinned: the disclosed set is authority-scoped.

## Open questions

- **OQ1 — where does evidenceRef disclosure live?** The seed reads the run view (`web-operator.mjs`)
  as the natural home for per-run refs and the wave surface for counts/roster. A fold must pick one
  carrier (run view, waves.progress, or both) and pin the exact projection.
- **OQ2 — is the REF public while the BODY is gated?** The seed's reading: the ref is data (public to
  the deployment's principals), the body is gated by the read lane. The fold should confirm against
  the issue body.
- **OQ3 — teachability mechanics.** Is the #159 doctrine served by generated docs (CLI.md/MCP.md), a
  runtime capabilities/teach endpoint, or the web operator's surface? Left open — the seed only pins
  that the schema is taught from the surface, not the mechanism.
- **OQ4 — the issue body for #152 was unreachable.** If the issue names a specific disclosable field
  set or a specific viewer class, this seed re-scopes in the fold.

## Cross-references

- #159 surface doctrine (every surface must teach it) — the control-surface parity frame
  (`control-surface-audit-2026-08-13`); cross-ref `docs/36` §9.
- `wave-observability-2026-08-06/contract.md` §D2/D5 — the `waves.list`/`waves.progress` disclosure
  shape this seed ceilings.
- `docs/32-reflexive-orchestration.md:197-199` — per-principal sanitized projections.
- `context-call.mjs:121-132` + `context-authority.mjs:146-159` — the evidenceRef schema as data.
- seed-151 (this wave) — the read lane that materializes evidence under run-horizon authority.
- seed-150 (this wave) — coaching refusals ride the same read lane.

## Judgment calls

- "docs disclosure" is read as the surface's disclosed view of workflow state plus the evidenceRef
  schema TAUGHT as data — not a documentation-file deliverable. Recorded; the alternative (a docs
  artifact) would make this seed a writing task, which the brief's "what the workflow surface discloses
  to whom" does not support.
- The evidenceRef schema is pinned as the artifact() closed set (G5) because it is the only landed
  evidenceRef shape in the codebase.
- No DECISION_REQUEST issued: "what is disclosed to whom" is answerable from the repo (G1-G3); the
  issue-body gap is OQ4.
