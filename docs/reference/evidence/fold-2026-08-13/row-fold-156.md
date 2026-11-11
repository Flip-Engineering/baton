# ROW BRIEF — row-fold156: fold the #156 contract per its red-team + QA

Read `docs/reference/evidence/fold-2026-08-13/foundry-brief.md` first — it binds you. Your material:

- Contract: `docs/reference/evidence/mcp-profile-parity-2026-08-13/mcp-profile-parity-contract.md` (FULL read)
- Red-team: `docs/reference/evidence/mcp-profile-parity-2026-08-13/redteam-156.md` (1 blocker + 2 amendments)
- QA: `docs/reference/evidence/review-foundry-2026-08-13/review-qa.md` §2 (esp. §2.5 — note the QA UPHELD the verdict but STRUCK two of the red-team's claims as non-reproducing)

The QA's §2.5 fold instruction set (apply all):
1. Fix the D4 HOLE (blocker #1): adopt the red-team's fix 1 (renderer fallback to
   `alias.canonical` when `canonicalOperations.find` returns undefined) OR fix 3 (drop the 5
   alias rows and rewrite RG-10 to accept `key = tool`). Update G11's "alias rows resolve" claim
   and RG-10 either way. Your choice between fix 1 / fix 3 is a judgment call — record it in the
   fold notes with one line of reasoning.
2. Strike the two false alarms from the record: C-1 (11 is correct — do NOT "correct" it to 16)
   and C-5 (MCP.md:87 is correct — do NOT move it to 88).
3. Apply the real citation fixes: C-2 (`scripts/` → `impl/scripts/`), C-3 (`:685-689`),
   C-4 ("35 to 86 today, 102 after D1+D2"), C-6 (rephrase D3's red-state sentence).
4. State Gap 1 (construction order: gap snapshot before the sibling spread; hand-inlining the
   14 rows is forbidden).
5. Adopt M1 (mark the D1 table as illustrative; authority = the registry).
6. Optional: close the D3 dispatch-binding gap with a third pin row over an exported dispatch map
   (red-team's recommendation) — if you decline, say why in one line.

Deliverables per the shared frame: the folded contract in place +
`docs/reference/evidence/mcp-profile-parity-2026-08-13/fold-156.md` (the blocker→resolution map,
attempt line verbatim in its header).
