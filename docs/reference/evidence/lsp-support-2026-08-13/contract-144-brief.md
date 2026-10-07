# #144 CONTRACT BRIEF — LSP support for diagnostic scoping + environmental understanding

You are drafting the implementation contract for issue #144 (LSP support). Read fully, in order:
(1) the issue — `gh issue view 144`; (2) the research survey (glm, landed):
`docs/reference/evidence/harness-inspiration-2026-08-12/cross-harness-survey.md` — its
LSP-for-agents section and top borrowings; (3) the landed machinery: the atlas index substrate
(`impl/src/atlas-index.mjs` — epochs + per-worker overlays), the #123 atlas discovery verbs
finding (`docs/reference/evidence/dropped-features-2026-08-06/SYNTHESIS.md` tier-1 #8), the
verifier-diagnostics digests-only law, DG-1 (run.debug), the #118 postmortem-digest issue, the
#81 orientation lane (landed); (4) the process machinery the LSP pool rides (the adapter/session
supervision — PL-suite-proven lifecycle discipline).

## The contract must decide

- **D: the managed LSP server pool.** One server per language per repo (typescript-language-server
  first; others as demanded), lazily started, resource-bounded, supervised under the existing
  process lifecycle machinery (never per-worker). Servers READ the repo (never worker scope).
  Capability cards per server; honest-empty availability (a language with no server answers
  typed-empty, never fabricated).
- **D: LSP-backed diagnostic scoping.** A verification failure's evidence resolves
  symbol-accurately (the failing test's diagnostics link to definitions/references); the
  referee's changed-lines machinery gains type-aware scoping (what does this diff break by
  references, not text proximity). The digests-only law holds for worker-facing surfaces —
  compiler-class evidence, digests+counts shape.
- **D: LSP-backed environmental understanding.** The #123 discovery verbs gain the LSP tier:
  symbol lookup / references / hover served from the pool, delivered through `context.read`
  with the staleness-honesty frame (the epoch+overlay discipline). The absence cache composes.
- **D: the honesty + containment laws.** LSP-derived evidence is compiler-class (stronger than
  text) but NEVER a verdict input by itself (it feeds evidence, not gates); the pool's lifecycle
  is supervised and bounded; no LSP content crosses worker surfaces unsanitized; the servers
  never execute project code (LSP servers RUN the language toolchain — typescript-language-server
  loads config; pin the trust posture honestly: the pool is dev-machine tooling, the deployment
  opts in per language).
- **Refusal vocabulary + acceptance pins (red-first)** per decision.

## Laws + deliverable

Ring-2 form. No clocks; every citation verified (`grep -an`/`sed -n` on the two NUL files);
sorted-key literals ACTUAL order; `localeCompare` banned. Cross-reference (do not re-spec): #81,
#118, #123, DG-1, the atlas substrate, the survey. Deliverable: ONLY
`docs/reference/evidence/lsp-support-2026-08-13/lsp-support-contract.md` (v1.0 DRAFT with the
verification HEAD).
