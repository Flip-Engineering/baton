# Phase 43 authenticated bounded provider reads — 2026-07-12

## Shipped checkpoint

PF7 now exposes a deployment-bounded provider-health and processing-summary projection through the
Coordinator, authenticated web command `provider_status`, and read-only MCP tool
`fleet_provider_status`. `createDriver.providerRead` pins provider-count, processing-count,
derivation-row, and serialized-byte ceilings, all with hard implementation maxima.

The response is fixed to the one deployment repository and contains only provider ID, source epoch,
health status, high/final sequence, first gap, cursor digest, last receipt/reconciliation events,
pending count, coordination high-water, and current/historical processing IDs/status/versions/counts/
event numbers. It cannot expose raw bytes or digests, cursor values, endpoint inventory, signatures,
auth receipts, key fingerprints, private paths, cards, or machine-ingress/poll authority.

Pagination orders one unified immutable processing-ID set before splitting rows into current and
historical display arrays. A transition between page one and page two is explicitly covered. If
provider rows alone or one processing row cannot fit, the read refuses rather than truncating.
Unknown providers, foreign repositories, malformed cursors, unknown fields, and limit max+1 refuse.
Web and MCP both require `observe` and authenticated repository membership.

## Verification

- Phase 42 plus all Phase 43 tests pass **67/67**.
- The combined web/MCP/Phase 42/Phase 43 gate passes **194/194**.
- The canonical suite passes **962/962**.
- The MCP inventory is closed at thirteen tools and its packaged stdio handshake remains pure.
- The user's unrelated `.gitignore` modification remains untouched.

## Recursive Baton/GLM review

`docs/reference/evidence/phase43-provider-read-review-2026-07-12/summary.json` records an exact
credentialed `glm` / `glm-4.7` / `low` Baton task on native PID `52084`. It consumed 91,681 tokens
and $0.958381, fresh-verified its scoped report, received a confirmed kill, and left no process,
worktree, runtime, branch, or writer authority.

The report's three findings were checked against the reviewed commit and rejected:

- its P0 quoted a different Coordinator implementation. The actual method requires
  `ctx.repoId === providerRead.repoId`; the existing direct `repo-b` test expects
  `reuse_repo_mismatch`, while web/MCP separately enforce principal membership and `observe`;
- its pagination concern described the correct behavior: a page-one row that later completes is
  already observed and remains excluded by its immutable ID on page two. A new regression now
  transitions exactly that row and proves the two pages still equal the full final ID set;
- its unknown-provider claim inspected only the store seam. The public Coordinator first checks the
  requested provider against deployment advisory cards and the test expects `provider_read_invalid`.

The raw report is preserved as provider output; fresh verification proves report shape and scope,
not semantic correctness. Independent disposition remains the acceptance gate.

## Honest remaining Phase 43 scope

PF8 still needs the local authenticated, no-redirect paged HTTPS fixture and live recovery/replay/
re-degradation cleanup evidence. Production HTTPS poll transport assembly and durable deferred
official-processing attempts also remain. No homelab or project-manager runtime integration is
involved or desired.
