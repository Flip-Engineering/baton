Deliver GitHub issue #411 in this Baton repository. The worker runtime has no gh credential, so the finding is transcribed here.

TITLE: the contribution contract validator admits non-string carriedForward and needsFromOthers entries that no successor can consume (audit C38, principle P13).
SITE: impl/src/contribution-contract.mjs ~232–237 — only Array.isArray is checked for carriedForward / needsFromOthers, while environmentRed enforces isNonEmptyString per entry; a hand-off of [42] passes strict validation.

REQUIRED: (1) every entry of carriedForward and needsFromOthers must be a non-empty string, judged by the SAME per-entry predicate environmentRed uses (one helper, not a second copy), refusing with the contract's existing typed shape naming the field, the index and the rule; (2) the rendered contract example in the brief (#371, contributionContractExample) stays byte-identical; (3) red-before rows in a NEW file impl/test/issue411-contract-entry-strings.test.mjs on impl/test/issue310-contribution-contract.test.mjs's fixtures: (a) [42] and [''] and [null] in each field refuse naming field, index, rule; (b) valid strings pass unchanged; (c) the predicate is the one environmentRed uses (a grep row or identity check). Observe red at HEAD before editing.

Keep green: impl/test/issue310-contribution-contract.test.mjs, impl/test/issue371-contract-example.test.mjs, impl/test/issue373-read-only-recruit.test.mjs, impl/test/swarm-brief-surface.test.mjs, impl/test/frame-economics-red.test.mjs.

OWNED FILES (yours alone): impl/src/contribution-contract.mjs, impl/test/issue411-*.test.mjs. Do NOT edit any other file. NEVER run git stash. Never print credential values.

VERIFY: node --test on your new file plus the keep-green files — NEVER run-suite --changed and NEVER the full suite. Then `node impl/scripts/seam-inventory.mjs --write`; include the regenerated artifact if it changed.

FINISH (muse is one-shot — there is no "later"; never wait on a background job): COMMIT on your lane branch (git add -A impl && git commit -m "<descriptive message>") and record ONE contribution with node "$BATON_SWARM_CLIENT" swarm.update — your brief's Swarm section renders the exact admitted payload example; follow it. Do not end your turn without the swarm.contribution_recorded receipt.
