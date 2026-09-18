Deliver GitHub issue #407 in this Baton repository. The worker runtime has no gh credential, so the finding is transcribed here.

TITLE: the workflow Plan history ceiling must derive from workflowPolicy.maxRounds, and its refusal must distinguish a proven cycle from a deep chain (audit C34, principles P1/P3).
SITES: impl/src/application.mjs — `MAX_WORKFLOW_PLAN_HISTORY = 16` (~line 99), the history walk that applies it (~4288–4312), and the refusal site (~6968); line numbers have moved, the names have not (grep MAX_WORKFLOW_PLAN_HISTORY).

REQUIRED: (1) the ceiling derives from the workflow policy's own `maxRounds` (the axis the deployment already bounds — grep workflowPolicy / maxRounds), never a second literal; (2) the walk detects a real cycle by identity (a plan id seen twice) and refuses `workflow_plan_cycle {planId, chain}`; a chain that merely exceeds the derived bound refuses `workflow_plan_history_exceeds_policy {bound, observed, next}` — two codes registered where the application's refusal codes live; (3) red-before rows in a NEW file impl/test/issue407-plan-history-bound.test.mjs on the workflow fixtures (grep `workflowPolicy` / `Plan history` in impl/test): (a) a chain of maxRounds+1 legitimate revisions refuses the policy code naming bound and observed, not a cycle; (b) a true cycle refuses the cycle code naming the repeated planId; (c) a chain within the bound passes; (d) no `16` literal remains (grep row). Observe red at HEAD before editing.

Keep green: every impl/test/*workflow*.test.mjs, impl/test/goal-plan*.test.mjs, impl/test/issue391-*.test.mjs, impl/test/frame-economics-red.test.mjs.

OWNED FILES (yours alone): impl/src/application.mjs (the workflow plan history region ONLY — another lane owns run.wait in the same file; keep your hunks to the plan-history walk and its refusals), impl/test/issue407-*.test.mjs. Do NOT edit goal-plan.mjs, coordination-store.mjs or the docs. NEVER run git stash. Never print credential values.

VERIFY: node --test on your new file plus the keep-green files — NEVER run-suite --changed and NEVER the full suite. Then `node impl/scripts/seam-inventory.mjs --write`; include the regenerated artifact if it changed.

FINISH (muse is one-shot — there is no "later"; never wait on a background job): COMMIT on your lane branch (git add -A impl && git commit -m "<descriptive message>") and record ONE contribution with node "$BATON_SWARM_CLIENT" swarm.update — your brief's Swarm section renders the exact admitted payload example; follow it. Do not end your turn without the swarm.contribution_recorded receipt.
