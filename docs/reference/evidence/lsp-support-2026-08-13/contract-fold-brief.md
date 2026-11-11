# #144 CONTRACT-FOLD BRIEF — fold the red-team into the LSP-support contract

You are folding an adversarial red-team report into the #144 contract. Read fully, in order:
(1) `contract-redteam.md` (NOT FOLD-READY — 5 blockers, §6, each with its concrete fix; the
architecture is SOUND and every citation verified — do not redesign); (2)
`lsp-support-contract.md` (v1.0 — your edit source, same dir).

## Deliverable

Write `contract-fold.md` (this dir) — the folded contract **v1.1**, self-contained, opening
with a fold-map table (finding → resolution → where in v1.1). v1.1 must pin all five blockers
exactly as the red-team's fixes state (§6.1–6.5):

1. **B1 — honest trust posture (D4).** Replace "the servers never execute project code" with
   the accurate clause: the server process runs the language toolchain under deployment
   authority, MAY load/execute project-referenced toolchain plugin code and project config,
   never runs project application entrypoints, runs outside worker sandboxes with egress
   bounded per the deployment card.
2. **B2 — clock-free wedged-server trigger (D1/D4).** Pin a per-server outstanding-request
   ceiling (name the #89 row it derives from; derivation on the deployment card); on exceed →
   refuse `lsp_server_unavailable` and reap+restart as a NEW GENERATION; pin that the start
   single-flight slot clears BEFORE `lsp_startup_failed` so retry is reachable.
3. **B3 — dirty-base-root staleness (D3).** Pin base hygiene: either clean-checkout
   requirement for the pool (content-derived dirty-drift check at server-open) OR answers
   carry the base root's own dirty overlay digest with
   `staleness: 'base_plus_worktree_overlay'`. The fold must CHOOSE one and say why.
4. **B4 — absence-cache key (D3).** Key on the effective-view frame `{base_epoch,
   overlayDigest, normalized_query}` — content-derived, never TTL; a worker A overlay must
   never serve worker B.
5. **B5 — worker-facing symbol projection + advisory blast radius (D2).** Pin (a) the exact
   worker-facing projection (sanitized path-qualified symbol leaves, OR symbol names + file
   digests with raw paths confined to a non-worker surface — the fold chooses and scopes the
   "never path strings" clause explicitly); (b) the blast-radius projection annotates the
   verdict ONLY and never feeds `coverageOfChange` (stays textual, `referee.mjs:313`
   unchanged — verify the citation).

Every citation re-verified at current HEAD (`grep -an`/`sed -n` on the NUL files
`application.mjs`/`coordination-store.mjs`; plain grep elsewhere). No clocks. Sorted-key
literals ACTUAL order; `localeCompare` banned. Write ONLY `contract-fold.md`.
