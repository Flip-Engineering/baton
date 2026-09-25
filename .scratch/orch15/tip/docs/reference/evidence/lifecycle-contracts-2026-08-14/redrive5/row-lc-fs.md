# ROW BRIEF — row-lc-fs: the filesystem contract

Read `foundry-brief.md` first (the frame + laws bind you — Ring-2 form, citation discipline, attempt-echo in the first five lines). Your issue set + the campaign evidence behind each:

- #168: workflow base commits land on master and capture the operator's dirty state (FOUR captures today — evidence: git history 055c6cc/cd555ca/a176f39/04bd28f + the base-commit line at workflow-interpreter.mjs:525)
- #172: the snapshot machinery abandons .git/index.lock in the operator's repo (two reaps today, holderless+fixed-mtime)
- #185: member raw-fs writes escaped the worktree into the main checkout TWICE (blueteam-161.md, suite-notes-163.md — captured by base commits; the write-scope machinery covers baton-surface ops, not raw fs)

**Read also:** the named issues via the local evidence dirs (gh may be unauthenticated in your worktree — the campaign's incident record lives in `docs/PROGRESS.md` + the per-issue evidence dirs under `docs/reference/evidence/` + the issue comments are summarized in the foundry frames' commit history). Ground EVERY ground-truth in the real code before pinning it.

**Deliverable:** `docs/reference/evidence/lifecycle-contracts-2026-08-14/redrive3/contract-filesystem.md` ONLY (plus the shared publish). The contract carries: ground truths (cited) → decisions (D-numbered) → the refusal vocabulary (closed, typed, surface-constant) → red-first acceptance pins (each RED at HEAD at a named stage; each green only for a correct impl) → open questions. This is the package-③ contract — it gates its suite + impl.
