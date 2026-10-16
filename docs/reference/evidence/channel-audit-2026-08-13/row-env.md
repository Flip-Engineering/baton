# ROW BRIEF — row-env: member environment fidelity — what a member can actually reach

Read `foundry-brief.md` first — it binds you (verdict scale, evidence law, publish rule,
attempt-echo law). Your target: **the member-side environment as experienced in this
campaign's waves** — the gap between what briefs assume members can do and what the sandbox
actually permits.

Evidence instances already on record (verify each, then generalize):
1. **`gh` unauthenticated in worktrees** (redteam-155.md's publish note: "`gh` is
   unauthenticated in this worktree"). Reproduce: can a member run `gh issue view`? Why not —
   HOME rewritten, env scrubbed, keyring unreachable? Cite the member-spawn env construction
   code. Impact: every brief that says "read the issue" silently degrades to "read the local
   evidence only". The fix class: briefs inline what rows need, or members get read-scoped gh.
2. **`shared` scratchpad unreachable "from this snapshot"** (review-qa §6). What does a
   member's scratchpad surface actually bind to — the resident's store, a worktree-local
   store, nothing? The unreachable claim vs redteam-155's "landed in worker:<row>" claim —
   reconcile them; one of them is the bug's shape.
3. **File-scope enforcement:** members wrote ONLY inside their declared scopes this campaign
   (verify — any scope violation events in the store?). Did scope ever block a legitimate
   write (cite redteam-155's need to publish outside its dir, if evidenced)?
4. **Tool inventory inside a member:** which baton surfaces can a member call (its worker
   facade)? List them from the code, and mark which the foundry briefs actually instructed
   members to use — the unused majority is the AX gap between the surface and the
   compositions.

Deliverable: `docs/reference/evidence/channel-audit-2026-08-13/environment.md` ONLY, plus the
`shared` publish (title "row-env") — or the exact refusal if the publish fails.
