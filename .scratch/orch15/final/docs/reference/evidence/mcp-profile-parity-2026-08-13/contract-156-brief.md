# #156 CONTRACT BRIEF — the MCP default profile as a bus superset

You are drafting the implementation contract for issue #156: the MCP default (`application`)
profile is not a superset of the bus — 12+ run-lifecycle ops (`run.approve`, `run.answer`,
`run.adopt`, `run.integrate`, `run.export`, `run.feedback`, `run.recover`, `run.review`,
`run.evidence`, `run.status`, `run.follow`, `run.wait`) are `combined`-profile-only, and
`run.resume_work` / `run.retry_verification` are absent from EVERY profile — while the web
bus and CLI serve them all.

## Read first (in order)

1. The issue: `gh issue view 156`. The audit evidence: `docs/reference/evidence/
   control-surface-audit-2026-08-13/surface-audit-mcp.md` (§1.1–1.2 — the per-op profile
   table) and the synthesis §1.1 + §2 #4.
2. The profile machinery: `impl/src/mcp-northbound.mjs` — how `application` vs `combined`
   profiles are derived (the profile table, the `baton_*` vs `fleet_run_*` split, the M4b
   alias pattern that already covers 10 ops). Verify the audit's table against the code —
   every row re-checked, cited file:line.
3. `impl/MCP.md` (the documented default) + how it's generated.
4. The bus-side authority these tools must map to (the web admissions for the same ops).
5. Idioms: `impl/test/phase16-mcp-northbound.test.mjs`, `impl/test/mcp-reflex-surface-red.test.mjs`.

## The contract must answer

- **D1 — the parity law + the mechanism.** Should the default profile be a superset of the
  bus (the audit's recommendation: `baton_*` siblings for the lifecycle tail), or should the
  documented default become `combined`? Choose, and say why (the operator's posture: MCP is
  the primary agent surface — the default should not be the crippled one).
- **D2 — the two missing tools.** `fleet_run_resume_work` and `fleet_run_retry_verification` —
  their closed schemas, capability classes, and admission, mirroring the bus verbs exactly.
- **D3 — the parity pin.** The red-first suite row(s) proving "MCP default ⊇ bus" per op —
  mechanically derived from the admission maps, never a hand list (the #159 doctrine).
- **D4 — the doc half.** `MCP.md`'s default-profile section must teach the final shape
  (generated, not hand-written — the #142 law).
- **Refusal vocabulary + red-first acceptance pins + open questions**, per campaign form.

## Laws

Ring-2 contract form; every citation verified this session; no clocks; no redesign of what
the audit found SOUND. Deliverable:
`docs/reference/evidence/mcp-profile-parity-2026-08-13/mcp-profile-parity-contract.md` ONLY.
