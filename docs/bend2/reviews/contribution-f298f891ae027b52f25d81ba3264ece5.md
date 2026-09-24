# Review: contribution-f298f891ae027b52f25d81ba3264ece5

| | |
|---|---|
| Author | bend2-arch-coordination-lane |
| Base | `bc2e4fcd` (read-only adversarial review; no commit captured) |
| Items | eleven deletion-or-merge findings across coordination, ledger, swarm, run, custody, admission, recovery, contribution, verification and wake |
| Decision | accept |
| Review row | `swarm.contribution_reviewed` seq 24563, 2026-09-21 |
| Reviewer | bend2-reviewer, independent seat |

## What was run and what it answered

- The one recorded gate reproduces: `node impl/scripts/seam-inventory.mjs` answers
  `seam-inventory: ok`, exit 0, at `bc2e4fcd` (run in scratch worktrees at that revision).
- The headline aggregates re-derived from `impl/scripts/seam-inventory.json` with `jq`:
  **2670 members**, **981 classified through `*_port` delegate evidence**, and
  **coordination-store.mjs 604 members — admission 175, observation 243, effect 26, recovery
  52, surface 108** — all three matching the carriedForward numbers exactly.
- Citation sample, all resolved at the cited lines:
  - `host-capacity.mjs:20-23` credits the published-owner protocol to
    `worktree-capacity.mjs`, and the twin `atomicWrite`/`publishExclusive` bodies sit at
    `host-capacity.mjs:78-97` and `worktree-capacity.mjs:254-278`.
  - `host-capacity.mjs:347` — `if (capacity.saturated) return 1;` — with `suiteLanes` absent
    from the derivation's return, as the history item claims.
  - `host-capacity.mjs:60` — `DEFAULT_POLL_MS = 250`.
  - `swarm-client.mjs:51-53` — `options.idempotencyKey ?? randomUUID()`;
    `coordination-ledger.mjs:1192-1193` — the `_byKey` dedupe returning the prior event.
  - `runtime-admission.mjs:84` — `pollMs: 10`; `:1149` — the verbatim inline ceiling check
    beside the shared predicate at `concurrency-policy.mjs:25-29`.
  - `wake-stream.mjs:10-14` — the #294 history note; `impl/scripts/expected-red.json` exists
    as the vestigial twin.

## Scope note

The remaining items cite lines this review did not individually open. The decision rests on
the reproduced gate, the re-derived aggregates, and that sample.

## Decision

accept — the two claims the contribution itself asks to be re-derived before anyone leans on
them (the inventory aggregates and the host/worktree duplication) both re-derive, and the
sampled citations resolve.
