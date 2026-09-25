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

The following rows are generated in the same field order as
`impl/scripts/shipped-holistic-contracts.json`; `npm run test:contracts:validate` requires exact
row equality and rejects missing, duplicate or undocumented contracts.

| ID | Owner | Status | Proof | Requirement |
|---|---|---|---|---|
| CP-001 | control-plane | shipped | impl/test/production-web-convergence.test.mjs | A permanently blocked reconcile cannot delay readiness, run status, or wave progress. |
| CP-002 | control-plane | shipped | impl/test/production-convergence.test.mjs | Emergency stop is durably admitted while bulk evidence is at capacity. |
| CP-003 | control-plane | shipped | impl/test/production-convergence.test.mjs | Disconnecting a long poll releases transport resources without losing command state. |
| CP-004 | control-plane | shipped | impl/test/production-convergence.test.mjs | Instrumented external-await authority is independent of ordered event append authority. |
| REG-001 | surface-registry | shipped | impl/test/production-convergence.test.mjs | Advertised and admitted commands on every surface resolve through one executable registry. |
| REG-002 | surface-registry | shipped | impl/test/production-convergence.test.mjs | Canonical and admitted legacy aliases share one authorization/schema/capability record; ambiguous aliases are refused. |
| ERR-001 | surface-errors | shipped | impl/test/production-convergence.test.mjs | Typed application errors preserve code, message, detail, field, retryability and action across surfaces. |
| LIF-001 | runtime-supervision | shipped | impl/test/production-convergence.test.mjs | Classified process death emits a DeathCertificate and automatically resumes/retries in the preserved worktree. |
| LIF-002 | runtime-supervision | shipped | impl/test/production-convergence.test.mjs | A phantom failure with a live exact session reattaches and never duplicates the attempt. |
| LIF-003 | runtime-supervision | shipped | impl/test/production-convergence.test.mjs | Retry exhaustion creates an attention-required outcome and no additional attempt. |
| LIF-004 | runtime-supervision | shipped | impl/test/production-convergence.test.mjs | Elapsed time alone cannot terminalize work. |
| ATT-001 | attention-plane | shipped | impl/test/production-convergence.test.mjs | Blocking input creates attention visible to an existing authorized subscription. |
| ATT-002 | attention-plane | shipped | impl/test/production-convergence.test.mjs | Unacknowledged attention is replayed after restart. |
| MSG-001 | collaboration-plane | shipped | impl/test/production-convergence.test.mjs | No sent message remains without a classified delivery fate. |
| STORE-001 | state-store | shipped | impl/test/production-convergence.test.mjs | Full replay and snapshot-plus-suffix replay have identical projection digests. |
| STORE-002 | state-store | shipped | impl/test/production-convergence.test.mjs | A crash before snapshot rename leaves the old authority; successful rename leaves the new authority. |
| STORE-003 | state-store | shipped | impl/test/production-convergence.test.mjs | Retention/reaping preserves live pins and reaps only terminal-pinned evidence. |
| READY-001 | readiness | shipped | impl/test/production-convergence.test.mjs | Route readiness and dispatch use the same resolver. |
| READY-002 | readiness | shipped | impl/test/production-convergence.test.mjs | Liveness and readiness predicates are separate. |
| ISO-002 | runtime-isolation | shipped | impl/test/production-convergence.test.mjs | A raw filesystem write outside the worker worktree/scope is refused before mutation. |
| ISO-004 | runtime-isolation | shipped | impl/test/production-convergence.test.mjs | A principal for run A cannot access run B. |
| DEP-001 | deployment-lifecycle | shipped | impl/test/production-convergence.test.mjs | Restart continuity preserves active identities, fences and subscription cursors. |
| MOD-001 | architecture | shipped | impl/test/production-convergence.test.mjs | Control transport names and decomposition boundaries are generated/behavioral rather than line-anchored. |
| REL-001 | release | shipped | impl/scripts/release-package-smoke.mjs | Clean checkout installs, tests, packs, installs the produced archive into a fresh prefix and smokes advertised bins. |
| E2E-001 | integration | shipped | impl/test/production-convergence.test.mjs | The shipped fault-injected workflow exercises command admission, notification, failure classification and retry without authority loss. |
| EVAL-001 | evaluation | shipped | impl/test/production-convergence.test.mjs | Comparative evaluation records verified success, interventions, wall time, tokens, cost, retries, stranded attention, integration defects and cleanup failures separately. |
| SURF-001 | unified-control-surface | shipped | impl/test/surface-capability-catalog.test.mjs | All existing operator-facing control capabilities are discoverable and invocable through both CLI and MCP without dropping native fleet/kernel controls or exposing worker-internal authority as an operator command. |
| SURF-002 | unified-control-surface | shipped | impl/test/unified-mcp-surface.test.mjs | Observation and monitoring capabilities have complete CLI/MCP catalogue, describe, invoke and bounded snapshot paths derived from existing transports. |
| SURF-003 | unified-control-surface | shipped | impl/test/unified-cli-surface.test.mjs | Readiness, workers, route capability cards, provider state and convergence scheduler telemetry are available from both surfaces through existing production authorities. |
| SURF-004 | unified-control-surface | shipped | impl/test/surface-capability-catalog.test.mjs | Message, answer, feedback, steer, interrupt and receipt communication capabilities retain one existing authority across CLI and MCP. |
| SURF-005 | unified-control-surface | shipped | impl/test/surface-capability-catalog.test.mjs | Operator-facing Run, wave, member, task, workflow, plan, board, package, selection and integration management capabilities are reachable through both surfaces. |
| SURF-006 | unified-control-surface | shipped | impl/test/unified-mcp-surface.test.mjs | Operator-facing knowledge, scratchpad, context, REPL, board and package capabilities are discoverable and invocable through CLI and MCP while embedded worker primitives remain explicitly inventoried and scoped. |
| SURF-007 | unified-control-surface | shipped | impl/test/surface-capability-catalog.test.mjs | Debug, evidence, verification, readiness, route, provider, orientation and environment-awareness capabilities are unified without weakening their existing evidence or authorization class. |
| SURF-008 | unified-control-surface | shipped | impl/test/unified-mcp-surface.test.mjs | Attention, decision, message, watch, follow and notification systems are visible on both surfaces and may not silently rewind or collapse refusal into emptiness. |

## Local merge gate

Run from `impl/` on a clean checkout:

```bash
npm ci
npm test
npm run test:contracts:validate
npm run test:surfaces
npm run test:unified-surfaces
npm run test:production-convergence
npm run test:contracts
npm run test:package
```

The real-substrate gate opens a temporary Git repository with Baton's actual `openBaton`
deployment, reads doctor through the wrapper, starts a direct Run and a resident-Web Run
concurrently, observes both at plan approval, and closes both through the existing lifecycle.
