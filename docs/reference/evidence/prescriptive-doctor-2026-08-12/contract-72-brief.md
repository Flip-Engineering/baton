# #72 CONTRACT BRIEF — the prescriptive doctor: warn on the footguns before they bite

You are drafting the implementation contract for issue #72 (the prescriptive doctor — warn on
the footguns before they bite: stale manifests, writer leases, credential TTLs, disk floors).
Read fully, in order: (1) the issue — `gh issue view 72`; (2) the lived footgun evidence THIS
CAMPAIGN (the richest source — `docs/reference/evidence/frontier-sweep-2026-08-03/orchestrator-friction-ledger.md`
Appendices A-C: the ghost-worktree capacity exhaustion (#141-adjacent), the stale-pin harvest
footguns (#134), the silent oversize refusal (#129), the resident-startup silence (#135), the
setup misdirection (#137), the credential rotation deaths (the Opus/Grok 402/401 incidents), the
idempotency-key poisoning, the startup capacity-lock race); (3) the current doctor machinery:
`baton doctor` (the readiness outline; `--check` the authenticated remote check; the #47-family
readiness honesty work landed Ring 1) — `application-deployment.mjs` doctorReadiness +
`application-cli.mjs`'s render; (4) the #135 staged-startup issue (the sibling — the doctor
WARNINGS should compose with the serve startup stages).

## The contract must decide

- **The warning catalog (v1).** The closed set of prescriptive warnings, each: the detection
  read (cheap, local, never network), the threshold, the human-cause message (the #41 law: the
  cause beside the code, never a bare signal). Candidates from the lived evidence: ghost
  worktree census vs the capacity cap; stale writer leases (pid liveness); credential TTLs
  approaching expiry (metadata only — NEVER token material); disk floor under the deployment
  root; stale result/checkpoint pin census (the refs growth); a resident running but no profile
  published (the #135/#137 window); a route whose last provider result was an auth failure.
- **The severity + surface model.** Warning vs blocking (a prescriptive warning NEVER blocks a
  command — it advises); where they render (doctor outline? a named additive field per the #103
  D6(b) briefing precedent — compose, don't duplicate); the CLI/MCP parity.
- **The action link.** Each warning names its remediation verb or doc anchor (a warning without
  a next action is a dead end — the #136 lesson).
- **Refusal/observability vocabulary + acceptance pins (red-first)** per decision.

## Laws + deliverable

Ring-2 form. No clocks as controls (TTL staleness reads compare event seqs/issued-at metadata,
not wall-guesses — say how each detection reads honestly); every citation verified (`grep -an`/
`sed -n` on the two NUL files); sorted-key literals ACTUAL order; `localeCompare` banned.
Cross-reference (do not re-spec): #41, #47-family, #103, #129, #134-139, #141. Deliverable: ONLY
`docs/reference/evidence/prescriptive-doctor-2026-08-12/prescriptive-doctor-contract.md` (v1.0
DRAFT with the verification HEAD).
