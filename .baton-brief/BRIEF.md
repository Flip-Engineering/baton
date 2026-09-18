Deliver GitHub issue #436 in this Baton repository. The worker runtime has no gh credential, so the issue is transcribed here.

TITLE: workflow-surface-red FP-17 reads application_unauthorized where the knowledge-seed body cap+1 refusal is pinned: the -red row is unlisted in the manifest and fails as an unexpected failure on every master.

EVIDENCE: `node --test --test-name-pattern="FP-17" impl/test/workflow-surface-red.test.mjs` →
  FP-17 (stage: validators absent): at-cap admitted, cap+1 refused naming cap AND actual
  knowledge seed body ≤4,096 bytes (the disclosed SURFACE cap, OQ-7): cap+1 refuses the pinned code BEFORE state
  expected: 'application_knowledge_seed_invalid'   actual: 'application_unauthorized'
impl/scripts/expected-red-tests.json lists only FP-14-tools for that file, so the runner counts FP-17 as an UNEXPECTED failure (docs/44: a -red file's live red rows are listed with a reason).

DECIDE AND LAND ONE of: (a) the pin is stale — the knowledge-seed cap moved off the 4,096 literal with the frame-limits work (#358/#362; read impl/src/limits.mjs for the seed body row) and/or the fixture's principal no longer carries the authority the seed verb requires so the authorization gate answers first; rewrite the row against the registry cap with a principal that IS authorized (so the size refusal is what is judged) and keep it green, or retire it with a one-line reason in the file header; (b) the pin is right — a size refusal is a shape check judged BEFORE authorization (the surface's disclosed cap); then list the row in the manifest under #436 and land the gate order in the application knowledge-seed admission (impl/src/application.mjs — the knowledge seed handler; find the ONE admission order the other body-capped verbs use and converge on it). State the decision and the evidence for it in notes. Either way the file's live red rows and the manifest agree afterwards.

Keep green: impl/test/workflow-surface-red.test.mjs (every other row), impl/test/suite-manifest-reasons.test.mjs, impl/test/issue290-suite-manifest-guard.test.mjs, impl/test/frame-economics-red.test.mjs, and if you touch application.mjs: every impl/test/application*.test.mjs and impl/test/issue370-*.test.mjs if present.

OWNED FILES (yours alone): impl/test/workflow-surface-red.test.mjs, impl/scripts/expected-red-tests.json (this file's rows only), and ONLY under decision (b) the knowledge-seed admission in impl/src/application.mjs (another lane owns run.wait in the same file; keep your hunk to the seed handler). Do NOT edit limits.mjs, the swarm files or the docs. NEVER run git stash. Never print credential values.

VERIFY: node --test on the files above — NEVER run-suite --changed and NEVER the full suite.

FINISH (muse is one-shot — there is no "later"; never wait on a background job): COMMIT on your lane branch (git add -A impl && git commit -m "<descriptive message>") and record ONE contribution with node "$BATON_SWARM_CLIENT" swarm.update — your brief's Swarm section renders the exact admitted payload example; follow it. Do not end your turn without the swarm.contribution_recorded receipt.
