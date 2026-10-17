# Phase 79 parallel Atlas and shared-knowledge audit

On 2026-07-17, the concise `openBaton({ repo })` surface admitted two real Codex Runs concurrently
from one private effective-tree snapshot:

- `run-f8d1ac1c274b3b8f19bc164a21fbc420` — exact
  `codex` / `gpt-5.6-sol` / `high`, Atlas representation-plane audit;
- `run-1b0dab580a2e43ab018132be49b3d7bc` — exact
  `codex` / `gpt-5.6-sol` / `medium`, shared causal knowledge and AX audit.

Both Runs completed provider work, passed the pinned fresh verification, adopted and pinned one
scoped report result, and paused before explicit repository apply. Their retained result commits
are:

- `b9711f7eb2deb1895d31c1e8eef7e4b26f8af7a7` for
  `reviews/dogfood/phase79-atlas-representation-audit.md`;
- `cb7db24e1bd79b4610bc37b6b64214f6ae268bdb` for
  `reviews/dogfood/phase79-shared-knowledge-ax-audit.md`.

Requested and resolved harness/model/effort matched for both Runs. The provider natively observed
`gpt-5.6-sol`; harness and effort remain honestly unavailable as provider-native observations while
launch enforcement is matched. Deployment close reported:

```json
{"workers":0,"workerIds":[],"closed":true}
```

No result was applied to the dirty caller checkout. The run exposed a product friction: while the
medium worker was already verified and the high worker remained actively making tool calls and file
edits, `BatonRunGroup` had no compact status/progress method. The operator had to inspect bounded
durable event kinds to distinguish active work from a stall. Phase 79A tracks that AX closure.

Run the retained proof with:

```sh
node docs/reference/evidence/phase79-parallel-atlas-graph-audit-live-2026-07-17/run.mjs
```
