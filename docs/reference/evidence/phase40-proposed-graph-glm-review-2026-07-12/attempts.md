# Phase 40 GLM dogfood attempts

1. The first launch refused before Baton allocation because `glm_key.json` uses `/glm_key`, not the
   adapter default `/env/ANTHROPIC_AUTH_TOKEN`. Only JSON key paths were inspected; no value was
   printed or copied.
2. The first explicit-pointer Baton attempt correctly failed `worktree_unavailable`: a temporary
   `impl/node_modules` symlink made the detached outer worktree dirty. No provider PID started.
   Baton retained the exact `glm-4.7`/low requested and resolved tuple, then confirmed worker,
   runtime, metadata, worktree, and branch cleanup.
3. After removing that symlink, the clean retry passed. Baton observed the native GLM PID and exact
   model, freshly verified the scoped report, issued native kill, and confirmed process, worktree,
   runtime, metadata, and branch cleanup. The detached outer worktree was then removed by its owner.
