# #637 pins, read from the root delivery clone (bend2-git11)

Reply sent to bend2-architect20 at swarm guide seq 425094.
Read-only. No gate run, no verdict.

Root delivery clone: `/Users/wahargis/Development/Experiments/baton-bend2-root-delivery-20260928`
(worktree of `/Users/wahargis/Development/Experiments/baton/.git`).

## Pins confirmed by ref

- Driver repair: `codex/bend2-hierarchy-637-20260928` = `061411c9` "Verify final hierarchy scope and correction landings".
  One commit over `08ee671b`; touches only `bend2/scripts/accept-kimi-hierarchy.py` and a new
  `bend2/test/accept-kimi-hierarchy.py`.
  - Driver content sha256 at `061411c9`: `ddeabaa7cd7deb39dffe2280f5d69a77377f69fabe0dde2df77d83259e535122`.
  - Driver content sha256 at `08ee671b`: `aa0858434963409bbd84e08a6d237da3724dbb180cf337dd68cf3b4536a16196`,
    which matches the "unchanged driver SHA-256" in #637.
- Retained OMP child correction: `codex/bend2-retained-child-workflow` = `ed388949` "Use retained receivers for OMP child tasks".
  Delivery HEAD `codex/bend2-root-delivery-20260928` = `7b7f16a4` carries the same change over `72329b47`.
- Hierarchy final target named in #637: `cbef941389397c4631c8c86dad9446aa53fdeabf`.
- Unchanged from the earlier read: `codex/bend2-root-delivery-20260928` also holds `72329b47` (push-answer doc)
  and `e913f4b7` (law-bearing comparison measurement) over `08ee671b`.

## What `061411c9` changes (read only, no verdict)

`verify` loses the whole-worker-tree diff against initial source `08ee671b`. A new `verify_landings`:

- diffs each worker from its own recorded session base, requires the change set to stay within the
  union of the run's assigned files, and requires a non-empty intersection with that worker's own
  assigned files;
- selects each worker's latest landed receipt, accepting correction-suffixed
  `landing-WORKER-CORRECTION.json` beside `landing-WORKER.json`, and requires every candidate
  landing to target `hierarchy-lead` with consistent ancestry;
- asserts, per assigned path, that the worker tip entry equals the latest landing entry and the
  final target entry, comparing mode and object;
- asserts the root receipt is `landed` on `bend2-trial`, that `tips['target'] == landings['root']['commit']`,
  and that target tree equals lead tree.

That is the correction-turn and inherited-lead-change shape #637 asked for, and the whole-run bound
keeps the scope refusal.

## Limits

- No driver was run and no verdict exists here. The requirement pair sits on different tips:
  `061411c9` is cut from `08ee671b` and does not contain the retained-child change, and `7b7f16a4`
  does not contain the driver repair. A tip establishing both must compose them.
- #637 is the root comparison lane, not this seat's. This seat's review is contribution seq 424741.
