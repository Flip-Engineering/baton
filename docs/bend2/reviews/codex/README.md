# Codex reviews of the Bend2 laws and architecture

An external Codex session (gpt-5.6-sol) reviewed the Bend2 laws and the rewrite architecture. The swarm sent it each revision, and it sent its findings back. This directory holds the review record as Codex wrote it. The files are unedited.

## Laws

| File | Reviewed revision | Result |
|---|---|---|
| `codex-context-and-review-r3.md` | r3 | Context review of the r3 candidate set |
| `codex-law-suitability-r3.md` | r3 | Which r3 candidates are proof-enforceable laws and which are tested behaviour |
| `codex-own-law-proposals.md` | r3 | Codex's own proposed laws |
| `codex-minimal-review-r5.md` | r5 | Findings on the minimal law set |
| `codex-minimal-review-r6.md` | r6 | Findings on r6 |
| `codex-minimal-review-r8.md` | r8 | Findings on r8 |
| `codex-final-law-review-r9.1.md` | r9.1 (1fab9a1d) | Final approval of the 16 laws in `docs/bend2/laws-proposed.md` |

`../operator-minimal-law-scope.md` records the operator's scope for the minimal law set.

## Architecture

`architecture/codex-architecture-review.md` reviews the target architecture, rewrite plan and go/no-go documents at 387ff439. Its SHA-256 is `39d3ce14317fcb07fc728d48f0c10c821461e0e19875e00a37d1af59363da55d`. The file gives a disposition for each finding F1 to F24 and maps the 16 approved laws to implementation boundaries. Its verdict: the eight logical owners are useful for prototyping, and transferring production authority is prototype-only until the named prerequisites are proven. The prerequisites are:

- provenance and authority checked at the effect itself;
- structured cancellation with acknowledgement, reap and custody release;
- native durable journaling with a durability barrier;
- publication bound to the canonical shared destination (#558);
- effect-specific reconciliation;
- dependency coverage before the test inventory is deleted.

`architecture/codex-review-manifest.json` lists the input files and their hashes, and `architecture/codex-native-surface-checks.json` records the checks against the installed Bend2 native surface. `architecture/probes/dropped-child.bend` is the native 2.0.25 probe. It shows that a parent can return without joining and that a child continues after its `IO.fork` result is dropped. `dropped-child-results.json` holds the recorded output. The compiled binary is not committed; build it from the `.bend` file.
