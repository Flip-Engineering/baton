# Provider683/694 final verification, gate on e5be38c0 (2026-10-08)

Reviewer seat `provider683-muse-review-20261006`, ensemble
`provider683-completion-20261006`. Verdict: QUALIFIED. This note
records the independent pass before the landing request. No candidate
source was modified.

## Tip and tree

Origin tip `codex/provider683-deepseek-impl-20261006` is `e5be38c0`,
resolving to tree `8b829573a52d02553f62c96cbcd5830f09d7cb24`. No
commit exists past it. The review worktree is clean. Two commits
landed since the last verification: `c944b771` (availability derived
from provider windows) and `e5be38c0` (echo named as a restated
request). Both are reviewed below.

## Gate evidence, recomputed on the runner

File `evidence/laws-check-merged-20261008T070120Z.jsonl`, read
directly:

- 814 rows, 0 `passed:false`, SHA256
  `9256dc99ef8c69522415f6fa55e76bafdd4c8646a64d625f3aacd89e0f8eb25e`.
- Expected `{"laws":616,"mutations":197}` present; receipt present
  with `law_rows=616 mutation_rows=197 baseline_ok=1` and
  `run_clean_done=2026-10-08T07:00:46Z shards=32`.
- All 32 `shards/rows-N.exit` read `exit=0`.
- `shards/run-clean.start` and `run-clean.done` present.
- Superseded rounds preserved under `shards/superseded-*/` and
  outside the merge; the merge holds 814 distinct law/mutation keys
  (616 proof-removal rows, 197 mutation rows, 1 baseline row).
- All 19 discovery and usage mutation rows read `applied:true`,
  `gate:refuses`, `passed:true` from the merged file, including the
  F5 corrected control, the echo-existence control, and the
  availability control.

## Re-verification at e5be38c0

- F1: the echo repair states `provider-echoed-request` with
  `existenceProof` false and `model-existence` in `absent`; basis
  `echoed-request-identifier` replaces the listing claim for echoes,
  and `listed-exact-selector` is reserved for catalog listings. The
  law pins the text, the control turns the echo into a claimed
  proof, and the invented-identifier test asserts the weak basis.
  The residual from the prior turn is closed in the surface itself.
  `existenceProof` is stored as the JSON string `"false"`, so
  readers compare against that string.
- F2: refusal falls back to the seat harness; no null entry.
- F5: the corrected find string matches once; the full gate applies
  it with a pass.
- Usage and 694: availability derives per provider from the
  provider's own window status (`available`, `exhausted` with basis
  `provider-reported-window`, `unknown` where no limit was stated).
  Law counts reconcile: 13 discovery laws, 1 entry law, 5 harness
  laws, 19 mutation controls.
- Capacity discipline: the usability rule consults only the latest
  probe outcome plus registry or listed admission; capacity never
  enters it. A generic nonzero failure leaves capacity unknown, and
  unknown balance proposes no availability.

## Acceptance table

Items 1, 2, 3, 5, and 6 remain proved; item 4 remains
fixture-proved with live quota-exhaustion failover UNOBSERVED. The
694 account surface is proved at mechanism level with live shapes
matching; live end-to-end and credit-spending exercises remain
UNOBSERVED for the stated platform and authorization reasons.

## Own receipts (atari-homelab, pinned toolchain)

Fresh archive of `e5be38c0` in a separate reviewer directory:
`build-native.sh` exit 0; `bend2/test/models.py` 24 tests, OK.
No other build was duplicated; the full gate was read, not rerun.
