# Review: contribution-7ee11e562dbf8ed3c3dad1ab670592d4

| | |
|---|---|
| Author | bend2-arch-lead |
| Captured at | `c22cda5b` on `baton/ws-34158f3ac9fbb1ffecf2af728fd753ff`; revises `docs/bend2/target-architecture.md` only (124+/51−), applying the operator decisions for F2, F4, F16, and F17 |
| Decision | accept |
| Review row | `swarm.contribution_reviewed` by bend2-reviewer2, 2026-09-22 |
| Reviewer | bend2-reviewer2, independent seat |

## What was run and what it answered

- **The delta still applies to the current target.** `git show c22cda5b` against
  `docs/bend2/target-architecture.md` at bend2-rewrite `cc1a1876` produces the same hunks; the
  file carries no later change that this contribution would conflict with.
- **Finding coverage is complete.** `architecture-review.md` defines findings F1 through F24.
  The contribution's decision paragraph accounts for all 24: F1, F3, F5–F15, and F18–F24
  approved as proposed, F2 rejected, F4 conditional, F16 and F17 applied as a checked
  declaration.
- **The F2 rejection is applied consistently.** Subsystem 2 becomes "Event Stores and
  Projectors" owning two named stores — an Operational Log and a Coordination Journal — and
  forbids a shared writer, sequence, segment, compaction frontier, quarantine state, or
  recovery transaction across them. The only store deletion the document claims is the unused
  `holistic-runtime.EventJournal` prototype and its compatibility paths. The disposition-table
  rows for `CoordinationStore` and the per-worker `Log` match this split.
- **The F4 conditions are enforced as contract text.** The Scheduler owns typed parent-child
  agent relations, per-agent information scopes, and explicit knowledge-promotion edges, and
  its forbidden list gains automatic knowledge promotion, reading across deliberately
  separated agent scopes, and flattening parent-child authority.
- **The F16/F17 mechanism is a checked declaration.** Verification and Landing owns the typed
  affected-effect and path declaration, a background structural scanner over the source
  snapshot, a comparison that records a typed mismatch, and `CheckedChangeImpact` as the only
  input to gate selection; gate selection from an unchecked declaration is forbidden. The
  committed seam inventory, hard-coded member counts, and delegate-bijection tests are deleted
  in the "no longer owns" list, which matches F17.
- **The subsystem count is now self-consistent.** The parent revision said "The seven runtime
  subsystems below form the only deployment" while the document has eight `###` subsystem
  sections and states "There are eight subsystems, yielding 28 unordered pairs". The
  contribution corrects the sentence to eight.
- **Anchors verified on the bend2-rewrite tree** (`git show bend2-rewrite:<path>` at each
  cited line): `log.test.mjs#L43` (gap-free per-worker sequence), `wave-driver-red.test.mjs#L135`
  (W1 individual start and approval), `swarm-runtime.mjs#L3279` (reader-relative `subtree`
  exposure comment), `swarm-delegated-completion.test.mjs#L174` (opens the subtree-view
  comparison test), `kg-settlement-red.test.mjs#L368` (inside the settlement test; the
  explicit-promotion assertion sits at L370–372), `coordinator-plan-effects-red.test.mjs#L166`
  (opens the row-seat test; the `requiredEffects`/`effects` assertions sit at L171–173),
  `seam-inventory.test.mjs#L145` (SI3 check-mode row), `issue463-integrate-gate-paths.test.mjs#L249`
  (changed-paths derivation comment), `coordination-ledger.test.mjs#L383` (CL5 exact behavior
  across the move), `coordination-admission.test.mjs#L362` (CA5 exact decisions across the
  move). Two anchors sit 3–5 lines above the named assertion, inside the correct test.

## Omissions handed to bend2-arch-lead2

The porting seat is applying this text to the shared checkout and should add:

- No mention of `LANG-F-26` or `LANG-F-28` where the document claims affine capabilities and
  automatic cleanup; `docs/bend2/authorization.md` on the root branch `d1b2b405` requires
  those findings to be accounted for.
- No closure gates for `LANG-CAP-01/08/09/10` (filesystem durability, HTTP/TLS, cancellation
  and supervision, cryptography), which the language review and the authorization name as
  prerequisites.
- No M-18 designated-shared-destination semantics: Verification and Landing owns integration
  and landing receipts, and no subsystem owns publication to the declared shared remote.
- The sentence naming the operator's approved finding set cites no recorded artifact; the
  per-finding decision record lives in the recovery briefs, and
  `docs/bend2/authorization.md` is the first committed text to reference the open
  architecture review and its required corrections.

## Decision

accept — the operator decisions for F2, F4, F16, and F17 are applied faithfully and
internally consistently, the delta lands cleanly on the current target, and the listed
omissions are additive work for the porting seat, not defects in what this contribution
claims.
