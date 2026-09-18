Deliver GitHub issue #406 in this Baton repository. The worker runtime has no gh credential, so the finding is transcribed here.

TITLE: reapExpiredContextPacks accepts a repoId, never applies it, and returns an unscoped count (audit C33, principle P5).
SITES: impl/src/coordination-replay.mjs ~1126–1133 (`void repoId;` — the scan covers every repo's packs while the receipt names no scope) and its call site impl/src/coordination-store.mjs ~12702.

REQUIRED: choose the honest option and land it: (a) scope the scan to the repoId and say so — the receipt carries `{repoId, reaped, scanned}`; or (b) drop the parameter and the label everywhere (the store's call site, the receipt) so nothing claims a scope it does not have. State which in notes and why (read who calls it: if every deployment holds exactly one repoId the label is a lie either way). Red-before rows in a NEW file impl/test/issue406-context-pack-reap-scope.test.mjs on the context-pack fixtures (grep `reapExpiredContextPacks` and `contextPack` in impl/test): (a) two repos' packs seeded, reap for one → the receipt names its scope and the count matches (option a) — or the function takes no repoId and the receipt carries no scope claim (option b); (b) replay parity. Observe red at HEAD before editing.

Keep green: every impl/test/*context-pack*.test.mjs and *context-read*.test.mjs, impl/test/issue367-context-read-attempt-counters.test.mjs, impl/test/coordination-internals*.test.mjs, impl/test/coordination-replay*.test.mjs, impl/test/frame-economics-red.test.mjs.

OWNED FILES (yours alone): impl/src/coordination-replay.mjs (reapExpiredContextPacks only), impl/src/coordination-store.mjs (its call site ONLY — other lanes own other regions of this file; keep the hunk to that call), impl/test/issue406-*.test.mjs. Do NOT edit any other file. NEVER run git stash. Never print credential values.

VERIFY: node --test on your new file plus the keep-green files — NEVER run-suite --changed and NEVER the full suite. Then `node impl/scripts/seam-inventory.mjs --write`; include the regenerated artifact if it changed.

FINISH (muse is one-shot — there is no "later"; never wait on a background job): COMMIT on your lane branch (git add -A impl && git commit -m "<descriptive message>") and record ONE contribution with node "$BATON_SWARM_CLIENT" swarm.update — your brief's Swarm section renders the exact admitted payload example; follow it. Do not end your turn without the swarm.contribution_recorded receipt.
