# Phase 72 native Kimi orchestrator live evidence

Date: 2026-07-17

This live dogfood used the installed, subscription-authenticated native Kimi Code harness as a
Baton orchestrator. Kimi connected to a disposable resident Baton application through Baton's
credential-free MCP bridge and an authenticated Web connection. The target repository, Baton
runtime, Web session store, bearer token, Kimi config projection, and coordination ledgers were
all private disposable paths. No Kimi credential or provider transcript is retained here.

## Exact route

- Orchestrator harness: `kimi-code`
- Model: `kimi-code/k3`
- Effort: `max`
- Kimi permission mode: `yolo`
- Baton worker route: `mock/model-a@max`
- Baton surface exposed to Kimi: `help`, `run.start`, `run.inspect`, `run.act`, `run.stop`

## Observed result

- ACP prompt stop reason: `end_turn`
- Baton Run: `run-kimi-live`
- Final Run phase: `work_completed`
- Kimi process: confirmed reaped
- Baton workers after application shutdown: `0`
- Coordinator authority: closed
- Coordination writer lease: released
- Global Kimi subscription source: byte-for-byte unchanged across the run
- Checkout adoption, export, integration, and publication: not performed

## Dogfood findings closed during the proof

1. `run.start` originally leaked the large internal Run record. The bridge now performs an
   internal `run.start` then `run.inspect(depth: outline)` cascade and returns only the outline.
2. The Web client advertised semantic help/inspect/act operations but rejected them locally.
   Its command allowlist now matches the semantic application card.
3. MCP read calls were sent with a null transport call identity, making help and inspect fail
   before reaching Web. Reads now receive deterministic request-bound observe identities.
4. Semantic action IDs were bound to the global coordination cursor, so Web audit traffic could
   invalidate an action between inspection and execution. Action freshness now excludes transport
   cursor noise while still changing with semantic Run state.
5. The inspect MCP cursor schema said string while the application requires a nonnegative integer;
   the schema now matches the executable contract.

## Supporting deterministic validation

The live run was preceded by a green 39-test MCP, progressive-AX, and packaged authenticated-Web
bridge suite. The packaged bridge test proves credential-free stdio configuration, authenticated
Web traversal, internal start-to-outline cascading, replay without redispatch, and transport close
without application shutdown.
