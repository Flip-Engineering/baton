# Critique — AX report draft (dynamic-workflow-2026-07-24)

**Critic:** sonnet · **Method:** re-read every cited source in full (`reviews/dogfood/codex-capability-gap-review.md`,
`docs/handoff/evidence/capability-matrix.json`, `docs/reference/evidence/dynamic-workflow-2026-07-24/research-notes.md`,
`docs/reference/evidence/grammar-2026-07-24/m1-wave.log`, commits `7de3a36`/`29769c1`/`e790825`) and diffed the draft's
claims against them line by line. The AX-0 numbers (6609s, `phase=running sha=none`) and the AX-4/AX-5/AX-6 quotes
(`handle.budgetUsed` zero, `resource.budget_threshold` never emitted, `wallMin` ignored, `story.signals()` unconsumed,
cold-spawn/no-crash-recovery/no-fork-explore) all check out verbatim against source. The following five findings are
the concrete problems that survive that check.

## 1. AX-3's evidence bullet smuggles in AX-8 while the footer claims AX-8 was excluded (highest-confidence finding)

The AX-3 card's evidence line reads: *"`e790825` (… M3 GLM seat dropped because the GLM slot was occupied by the
concurrent #46 seat)."* But `research-notes.md` (lines 48–51, Group B) assigns that exact fact to **AX-8**
("model slots are silently lost to a concurrent seat" — an infra/scheduling arbitration failure), explicitly
distinct from **AX-3** ("credential & capability-gating brittleness," Group C, lines 59–74: credential expiry and
unprovable thinking-gates). The draft's own footer then states *"Held back as lower immediate cost: … AX-2 / AX-8."*
Both cannot be true: either AX-8 is held back, or its core evidence is presented (relabeled as AX-3) in the shipped
top 5. As written, the report understates its own scope — it silently ships AX-8 under AX-3's banner — and
misrepresents *why* the M3 GLM seat was lost, attributing a seat-arbitration failure to credential/capability
brittleness. The commit itself (`e790825`) also contains a clause that *is* on-topic for AX-3 and was passed over:
*"1.4h credential window accepted, checkpoint-pin recovery is the fallback."* The draft picked the wrong clause from
its own cited commit.

**Verdict: fix required.** Either drop the GLM-slot clause from AX-3's evidence (replace with the credential-window
clause, which is actually on-topic), or fold AX-8 into the top 5 honestly instead of claiming it was held back.

## 2. The draft's byline contradicts the source document's own header

Draft metadata: *"Drafter: glm."* But `research-notes.md` line 3 — the file the draft is built from — states the
workflow roles as *"researcher / kimi-drafter / sonnet-critic."* That makes **glm the researcher** and **kimi the
drafter**, not glm. The draft misattributes its own authorship against the very source it cites.

**Verdict: fix required.** Correct the byline (or confirm out-of-band who actually drafted this HTML and reconcile
the discrepancy — don't leave a factual conflict with a cited source sitting in the metadata line).

## 3. "Critical" vs "High" is an invented severity tier the sources don't support

`codex-capability-gap-review.md` (lines 9–18) and `capability-matrix.json` use a single `high/medium/low` priority
scale — there is no "Critical" tier anywhere in the source taxonomy. `research-notes.md` (lines 100–102) treats
AX-4, AX-5, and AX-6 as one undifferentiated cluster: *"all 'UNSHIPPED-DEBT, high priority' in the matrix,
collectively the blocker for unattended workers."* No source ranks AX-4/AX-5 above AX-6. The draft assigns
"Critical" to AX-4/AX-5 and "High" to AX-6, manufacturing a distinction the evidence never draws.

**Verdict: fix required, or justify explicitly.** If the drafter believes AX-4/AX-5 are genuinely worse than AX-6,
that's a defensible editorial call — but it needs its own stated rationale, not a badge that implies it came from
the matrix's own priority field.

## 4. AX-0 and AX-3's "High" badges carry no equivalent source-side priority label

AX-4/AX-5/AX-6's "high priority" comes from the matrix's own classification (verified: 7 high-priority
`UNSHIPPED-DEBT` rows, recounted and reconciled in `codex-capability-gap-review.md`). AX-0 (a driver log) and AX-3
(three commit messages) have no matrix entry and thus no comparable priority label — their "High" is the drafter's
own judgment call, styled identically to the matrix-sourced badges. A reader skimming the report has no way to tell
that three of the five severity badges are instrument-derived and two are editorial.

**Verdict: cosmetic/disclosure fix.** Either footnote which badges are matrix-sourced vs. editorial, or drop the
implied uniformity (e.g., a visually distinct marker for "drafter-assessed" severity).

## 5. Card #3 (AX-6) claims sole ownership of a claim that belongs to the AX-4/5/6 trio

`research-notes.md` line 100 attributes "collectively the blocker for unattended workers" to AX-4+AX-5+AX-6 as a
group. The draft's lede gets this right. But the AX-6 card, read on its own, states *"This is the explicitly-flagged
practical blocker for unattended runs"* with no "collectively" qualifier — implying, in isolation, that AX-6 alone
earns the flag that the source applies to all three.

**Verdict: minor wording fix.** Add "(with AX-4/AX-5)" or similar to the AX-6 card so it doesn't read as a
freestanding claim when skimmed out of lede context.

---

## Overall verdict

The draft's factual core is sound — every quoted number, field name, and log line I checked against source matches
verbatim, and the AX-0 log arithmetic (6609s → watchdog → `sha=none`) is exact. The failures are all in
**editorial framing laid on top of accurate facts**: one real evidence-attribution error that contradicts the
report's own "held back" claim (#1), one byline error (#2), and an invented severity gradient presented with the
same visual authority as the matrix-sourced labels (#3, #4, #5). None of these invalidate the report's central
thesis (governance is observe-only; AX-0/AX-3 are real, grounded, separate frictions) — but #1 must be fixed before
publication, since it makes a claim ("held back: AX-8") that the report's own body contradicts.
