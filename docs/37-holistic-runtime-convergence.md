# Baton holistic runtime convergence

## Scope and preservation law

This change is an additive convergence layer over Baton's existing application, coordinator,
coordination store, provider/session, worktree, authenticated Web, CLI and MCP authorities. It
does not replace those systems or reduce the pre-existing capability inventory.

The package root and `baton/core` continue to expose the raw substrate. `baton/converged` is an
explicit opt-in factory; importing either module is inert. The convergence factory installs the
application/Web decorators deliberately, then wraps the public deployment facade.

CI is verification-only. It has `contents: read`, writes temporary outputs under
`$RUNNER_TEMP`, and never commits, pushes, decodes a production payload, or rewrites the branch.
The default `npm test` command remains the repository's full `run-suite.mjs` contract, including
the existing red-first pins. Additional convergence gates have separate script names.

## Runtime shape

```text
existing CLI / MCP / Web / embedded surface
  -> existing semantic or native authority
  -> durable admission and typed receipt
  -> reserved control lane
  -> existing application / coordinator / provider effect
  -> durable outcome and projection
  -> attention, recovery, replay and diagnostics
```

The reviewed tree contains the exact executable source. There are no CI-applied tarballs, patch
scripts, source dumps, generated package archives, or self-landing workflows.

## Acceptance matrix

Retired with the #580 bookkeeping-ledger ban: the hand-maintained contract matrix and its
shipped-holistic-contracts.json snapshot are gone. The convergence facts live in the tests
that prove them (production-convergence, unified-surface and release-smoke suites), which the
CI workflow runs directly.

## Local merge gate

Run from `impl/` on a clean checkout:

```bash
npm ci
npm test
npm run test:surfaces
npm run test:unified-surfaces
npm run test:production-convergence
npm run test:package
```

The real-substrate gate opens a temporary Git repository with Baton's actual `openBaton`
deployment, reads doctor through the wrapper, starts a direct Run and a resident-Web Run
concurrently, observes both at plan approval, and closes both through the existing lifecycle.
