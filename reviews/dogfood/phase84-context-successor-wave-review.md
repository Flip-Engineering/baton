# Phase 84 context successor wave review — partition 5/6

Source reviewed: immutable `impl/src/coordination-store.mjs` chunk 49, bytes 602112–614400, content digest `95eb86fe25cca7e22ca8e0e9fb468f4fb29adff4328054613c8cc8f52d6ac3ff`.

## Finding: terminal web/MCP settlements accept cross-route, unauthenticated replay

Severity: **High**

`completeWebCommand` and `failWebCommand` both return `{ ok: true, result: 'replay' }` whenever the command is no longer `admitted`. Neither branch checks whether the stored terminal route was the route being requested, nor does it bind the replay to the original outcome, actor, or idempotency key. `completeMcpCall` and `failMcpCall` repeat the same logic for MCP calls. This is materially weaker than the run-stop and fleet-drain completion paths in the same partition, which locate the prior keyed event and compare its kind, actor, and canonical payload before recognizing a replay.

Concrete failure: after `failWebCommand(commandId, originalFailure, originalAuth)` settles a command as failed, `completeWebCommand(commandId, arbitraryOutcome, arbitraryAuth)` returns an affirmative replay instead of a conflict. The reverse route substitution also succeeds, and the same substitutions are accepted for MCP calls. The returned object still contains the previously settled state, so the response's `ok: true`/`replay` result does not truthfully attest that the requested completion or failure route was replayed. Because `auth` is not consulted on these terminal branches, possession of a known command/call ID is sufficient to receive that affirmative response.

Fix by retaining or resolving the terminal event and accepting replay only when its event kind matches the requested route and its actor, idempotency key, and canonical outcome match the current request. Reject every other terminal invocation with a route-specific settlement conflict, as the run-stop and fleet-drain completion handlers already do.

No tests were run, per the review brief.
