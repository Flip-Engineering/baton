# #71 FOLD BRIEF — fold the red-team report into the orchestrator-wake contract (v1.0 → v1.1)

You are folding an adversarial red-team report into the orchestrator-wake contract. Read fully,
in order: (1) `contract-redteam.md` (NOT FOLD-READY — 5 numbered blockers in §4, each with its
concrete fix); (2) `orchestrator-wake-contract.md` (v1.0 — your edit target).

## The blockers, headlined (fold ALL 5 + apply the open-question verdicts)

1. **B1 — the composed cursor mixes store seq and attention-cursor into one token.** Fold the
   split: a `storeCursor` (the waitAfter operand + store-item paging) and a `reasonsCursor` (the
   `_attentionCursor` space, paged by the existing `_attentionPage` filter) — never folded into
   one token; the return-trip invisibility (member_terminal/candidacy_review never waking) dies.
2. **B2 — `candidacy_review` re-minted per page with fresh seqs.** Fold the stable-identity fix
   (mint once into `_attentionReasons`, refresh on count change only, the existing seq filter
   pages it) or anchor its seq to the candidate Finding's store event — the contract picks one.
3-5. **B3-B5** per the report's §4 + the H8 refusal drift fix + the acceptance-pin amendments
   (§3).

## Laws + deliverables

No clocks; every citation verified (`grep -an`/`sed -n` on the two NUL files); sorted-key
literals ACTUAL order; `localeCompare` banned. Header to **v1.1** with the fold note. Edit ONLY:
`orchestrator-wake-contract.md` (v1.1) + `contract-fold.md` (blocker → change map, all 5 +
drift/amendment items + open questions) — this directory.
