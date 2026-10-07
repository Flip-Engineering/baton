# Phase 30 — credential-bound GLM live honesty

## GL1 — secure local credential boundary
`GlmSessionCli` may receive `authTokenFile` as an alternative to an in-memory token or environment
fallback. The file must be a regular non-symlink, owner-only (`0600` or stricter), non-empty, and
bounded. It may contain one raw token or the official JSON shape
`{ "env": { "ANTHROPIC_AUTH_TOKEN": "..." } }`. A deployment may explicitly select a different
bounded JSON Pointer; generic guessed key names are refused. Values never enter cards,
events, errors, summaries, evidence, or committed files.

## GL2 — current exact model identity
The adapter version identifies Claude Code plus the Z.ai transport, not a guessed GLM model.
Deployments select the model explicitly. The live gate uses exact `glm-4.7`, the current efficient
Coding Plan default, with native `low` effort, and requires requested/resolved/observed attribution
without silently claiming an unobserved model or effort.

## GL3 — isolated runtime
The child uses a private runtime home/config/tmp, stripped ambient provider credentials, explicit
Z.ai endpoint/token projection, and the existing Claude sandbox settings. No source credential file
is copied into the worktree or evidence tree.

## GL4 — real coordinator path
A real `GlmSessionCli` runs through `createDriver()` in a clean isolated repository clone and owned
worktree. The worker performs one bounded, harmless review artifact task with a pinned fresh-worktree
verification command. A self-report cannot satisfy completion.

## GL5 — control and reap
The live run proves at least one native process exists, then issues Coordinator kill after the
verified turn. The process, worktree, runtime scope, metadata, and task branch must all be gone.

## GL6 — evidence and refusal honesty
Missing/insecure/malformed credentials, authentication failure, provider refusal, model mismatch,
or unavailable quota are recorded as typed pending/failed evidence, never success. A live result is
claimed only when exact attribution, fresh verification, and complete reap all pass.

## GL7 — acceptance
Reds cover raw/JSON credential loading, permissions, symlinks, bounds, non-disclosure, adapter card
identity, exact model mapping, fake effect-level wiring, and cleanup. Canonical tests remain green;
the live script stores only bounded events and a sanitized summary.
