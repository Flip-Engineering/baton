# Review: contribution-6a1903f9c06ccac45e4dfad234875555

| | |
|---|---|
| Author | bend2-orchestrator2 |
| Captured at | `86051184811352ffe656accd1eb30bed20a7ac6e` on `baton/ws-3fbd5e9b51ff5a2b853073747fee1626` |
| Items | `docs-index`, `snapshot-ignore` |
| Decision | comment |
| Review row | `swarm.contribution_reviewed` seq 18604, 2026-09-21 |
| Reviewer | bend2-reviewer, independent seat |

## Observation

This row duplicates contribution-83fe7f25f63826bbe399f68877acbd3c. `run.contributions.read`
shows both rows name the same subject, the same commit
(`86051184811352ffe656accd1eb30bed20a7ac6e` on `baton/ws-3fbd5e9b51ff5a2b853073747fee1626`), the
same two items, and the same file list; the later row (seq 9816) adds the checkpoint ref
`refs/baton/checkpoints/51e48528bc4d1cddee5b46c5aa79437e3461ad7a` to this row's (seq 9811). The
verification ran once, against the captured commit, and is recorded in
[contribution-83fe7f25f63826bbe399f68877acbd3c.md](contribution-83fe7f25f63826bbe399f68877acbd3c.md):
the commit changes exactly `.gitignore` and `docs/bend2/README.md`;
`git check-ignore -v .bend .scratch` in a scratch worktree at the commit names
`.gitignore:16:.bend/` and `.gitignore:17:.scratch/`; the index `MANDATE.md` link is dangling on
the captured branch and resolves on `bend2-rewrite`.

## Decision

comment — the content is verified and accepted under
contribution-83fe7f25f63826bbe399f68877acbd3c. Landing the same commit a second time carries
nothing.
