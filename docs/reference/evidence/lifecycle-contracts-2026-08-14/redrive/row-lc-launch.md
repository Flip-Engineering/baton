# ROW BRIEF — row-lc-launch: the launch contract

Read `foundry-brief.md` first (the frame + laws bind you — Ring-2 form, citation discipline, attempt-echo in the first five lines). Your issue set + the campaign evidence behind each:

- #173: waves.run is synchronous for the wave's whole lifetime (application.mjs:11631-11646 awaits the full drive; workflow-interpreter.mjs:534-609) — two client timeouts on healthy waves today
- #202: deployment_doctor returned bare text 'Command executed successfully.' instead of the JSON result
- #207: the objectiveRef admission (64KiB, workflow-interpreter.mjs:39) exceeds run.start's 4096-byte objective cap (limits.mjs:56) — briefs 4-64KiB phantom-fail EVERY member, and createWave's captured startError (wave.mjs) never reaches the receipt. The spill-digest-citation graceful path exists unused

**Read also:** the named issues via the local evidence dirs (gh may be unauthenticated in your worktree — the campaign's incident record lives in `docs/PROGRESS.md` + the per-issue evidence dirs under `docs/reference/evidence/` + the issue comments are summarized in the foundry frames' commit history). Ground EVERY ground-truth in the real code before pinning it.

**Deliverable:** `docs/reference/evidence/lifecycle-contracts-2026-08-14/redrive/contract-launch.md` ONLY (plus the shared publish). The contract carries: ground truths (cited) → decisions (D-numbered) → the refusal vocabulary (closed, typed, surface-constant) → red-first acceptance pins (each RED at HEAD at a named stage; each green only for a correct impl) → open questions. This is the package-③ contract — it gates its suite + impl.
