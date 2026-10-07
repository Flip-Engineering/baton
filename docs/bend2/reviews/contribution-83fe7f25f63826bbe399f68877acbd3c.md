# Review: contribution-83fe7f25f63826bbe399f68877acbd3c

| | |
|---|---|
| Author | bend2-orchestrator2 |
| Captured at | `86051184811352ffe656accd1eb30bed20a7ac6e` on `baton/ws-3fbd5e9b51ff5a2b853073747fee1626` |
| Items | `docs-index` (`docs/bend2/README.md`), `snapshot-ignore` (`.gitignore` lines for `.bend/` and `.scratch/`) |
| Decision | accept |
| Review row | `swarm.contribution_reviewed` seq 14882, 2026-09-21 |
| Reviewer | bend2-reviewer, independent seat, worktree `baton/ws-3f455e632d1c185eed8661e1b5b1aadf` |

## What was run and what it answered

- `git diff --stat 86051184^ 86051184`: the commit changes exactly two files — it adds
  `docs/bend2/README.md` (34 lines) and appends to `.gitignore`.
- `git show 86051184:.gitignore`: lines 16-17 are `.bend/` and `.scratch/`, under the `#539`
  comment naming the in-checkout toolchain install and the scratch directory.
- The recorded check, reproduced in a scratch worktree at the captured commit
  (`git worktree add /tmp/rev-86051184 86051184811352ffe656accd1eb30bed20a7ac6e`, then
  `mkdir -p .bend .scratch` and `git check-ignore -v .bend .scratch`): the command names
  `.gitignore:16:.bend/` and `.gitignore:17:.scratch/`.
- `docs/bend2/README.md` at the commit, read against the tree: `reference/README.md`,
  `examples/README.md`, the ten vendored upstream files, and
  `reference/toolchain/install-2.0.25.sh` all exist at the commit. The documents in the index
  table (`language-review.md`, `architecture-review.md`, `target-architecture.md`, `laws.bend`,
  `laws-trace.md`, `rewrite-plan.md`, `go-no-go.md`) are declared in the index itself as landing
  when their work items complete, so their absence at this commit is stated by the index.

## Findings

- `MANDATE.md` is absent from the captured branch. The index names it as the authority for the
  directory and links it; `86051184` is the tip of `baton/ws-3fbd5e9b51ff5a2b853073747fee1626`,
  and that branch's `docs/bend2/` holds only `README.md`, `examples/` and `reference/`.
  `MANDATE.md` exists on `bend2-rewrite`, so the link resolves once this contribution integrates
  onto the target branch.

## Decision

accept — both delivered items reproduce. The `MANDATE.md` link is dangling on the captured branch
and resolves on the integration target.
