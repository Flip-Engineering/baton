# Flip visual surfaces — local validation

Validation was run from a fresh checkout of `agent/flip-visual-surfaces` after the implementation commit.

```bash
cd impl
npm ci
node --test \
  test/visual-model.test.mjs \
  test/visual-renderer.test.mjs \
  test/baton-top.test.mjs \
  test/mcp-visualization.test.mjs
npm test
npm run test:contracts:validate
npm run test:surfaces
npm run test:unified-surfaces
npm run test:production-convergence
npm run test:contracts
npm run test:package
```

All commands exited successfully. The verification checkout remained clean after the gate.

The visual layer remains presentation-only: it reads the existing Run, story, readiness, telemetry, attention, convergence snapshot/watch, and MCP authorities. Interactive answers lower through the existing `run.answer` command. No session-takeover authority, event store, scheduler, story store, or notification bus is introduced.
