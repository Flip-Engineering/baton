Deliver GitHub issue #432 in this Baton repository. The worker runtime has no gh credential, so the issue is transcribed here.

TITLE: Flaky under suite load: issue351-startup-answer SA3 'stderr never named baton serve: answering (open' — the served child's flip line is not observed within the row's bound when the runner is at parallelism 2.

EVIDENCE: observed once 2026-09-18 under `BATON_SUITE_PARALLELISM=2 node scripts/run-suite.mjs` over ~200 rows (host load ~2.6): `test/issue351-startup-answer.test.mjs :: SA3: the flip names the startup truth, and the doctor renders the same coordination row — stderr never named "baton serve: answering (open ":`. The same row passed alone immediately afterwards and in the next run-suite invocation. The row spawns `baton serve` and waits for the flip line on stderr within a bound; under two parallel lanes the child's startup (replay + reconstruction + self-check) can exceed it. Since #351 lane 4 the flip line also carries `reconstructed Nms` and the replay line precedes it.

REQUIRED:
1. The row's wait bound derives from the same registry row the startup self-check / open-liveness rows use (docs/43 §5, FRAME_LIMITS — read impl/src/limits.mjs and impl/test/issue351-open-liveness.test.mjs for the bound they derive), or the row waits on the child's PUBLISHED state (connection.json / `swarm list` answering, the way OL-b waits) rather than racing stderr; never a magic number.
2. If the row must still read stderr, it reads the whole stream until the child publishes (bounded by the derived wait), so a slow child under load is a slow pass, not a red.
3. Keep every SA row's assertion meaning intact (the flip names open ms, rows, replayed, checkpoint state and reconstructed ms; the doctor renders the same coordination row); make the change a deliberate edit that states why in a comment.
4. Prove: run the file 3 times in a row under `BATON_SUITE_PARALLELISM=2 node scripts/run-suite.mjs test/issue351-startup-answer.test.mjs test/issue351-open-liveness.test.mjs test/issue351-reconstruction-liveness.test.mjs` (this narrow set is allowed) and report the three verdicts in notes.

Keep green: impl/test/issue351-*.test.mjs (all), impl/test/frame-economics-red.test.mjs.

OWNED FILES (yours alone): impl/test/issue351-startup-answer.test.mjs. Do NOT edit any src file (if the bound needs a registry row that does not exist, say exactly which in needsFromOthers). NEVER run git stash. Never print credential values.

FINISH (muse is one-shot — there is no "later"; never wait on a background job): COMMIT on your lane branch (git add -A impl && git commit -m "<descriptive message>") and record ONE contribution with node "$BATON_SWARM_CLIENT" swarm.update — your brief's Swarm section renders the exact admitted payload example; follow it. Do not end your turn without the swarm.contribution_recorded receipt.
