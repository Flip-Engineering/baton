# Phase 30 GLM live-gate attempts

All attempts used the ignored owner-only local credential without printing or committing its value.
Only the final run is the acceptance evidence in `summary.json` and `events.jsonl`.

1. A source-only clean clone could not import the public entrypoint because the optional Atlas
   native dependency was absent. No provider process started.
2. The credential loader correctly refused the local file's nonstandard JSON schema. Baton added
   an explicit deployment-selected JSON Pointer while retaining the documented Z.ai schema as the
   default; it did not guess generic key names.
3. A dependency symlink made the disposable clone dirty because Git's `node_modules/` directory
   ignore does not match a symlink. Baton refused worktree allocation and reaped all partial state.
   Copying the 7.1 MiB installed dependency directory kept the clone clean.
4. Exact `glm-4.7` initialized and was observed, but a $0.10 cap was below the first reported
   request cost (about $0.126), so the task failed and Baton fully reaped it. The accepted run used
   native `low` effort and a $0.40 ceiling; actual reported usage was 37,000 tokens and about
   $0.254.

These are product findings: clean-clone dependency projection must be directory materialization,
credential schemas must be deployment-explicit, pre-init orchestrator failures must remain
distinguishable from child crashes, and provider minimum-turn cost must inform the gate ceiling.
