# Review: contribution-d2f1daf5691aabca1ff0182342521387

| | |
|---|---|
| Author | bend2-orchestrator2 |
| Captured at | `f8435bd9e0236c8ef91f2a3f2af85054f16bb8b2` on `baton/ws-3fbd5e9b51ff5a2b853073747fee1626` |
| Items | `docs-index`, `ledger`, `snapshot-ignore`, `environment-pin` |
| Decision | comment (superseded; substance verified) |
| Review row | `swarm.contribution_reviewed` seq 24555, 2026-09-21 |
| Reviewer | bend2-reviewer, independent seat |

## Why comment

Superseded by contribution-da0172b495c07496c9135d196aa39c3c, which landed the same
`docs/bend2/ledger.md` and the same expected-red row on `bend2-rewrite` as `34d6b4b3` under a
narrow 10-file gate set (verdict green, 88 passed). The two artifacts this contribution carried
that the narrow landing dropped — `docs/bend2/README.md` and the `.gitignore` lines — remain
pending the root's landing, because a changed `README.md` or `.gitignore` selects a wide
fixture-needle gate set (the refused 16a51c6d integration record shows 68 files selected, 3
unexpected red) that times out on this host (issue #546).

## What was run and what it answered

- `command -v kimi` and `command -v kimi-code`: both exit 1 — the Kimi Code executable this
  contribution's row names as missing is in fact missing.
- `node --test --test-name-pattern=P92-DF10b test/phase78-concise-deployment-factory.test.mjs`
  from `impl/`: 0 pass, 1 fail. The failing assertion at `:562` is the kimi-code route-presence
  check inside a fixture that isolates `HOME` and stages Kimi Code credential files, so the
  failure is machine-local exactly as the bare `environment` class records. The row's honesty
  holds: it attributes the red to this host's missing prerequisite and to nothing else.
- `git diff f8435bd9~1..f8435bd9 -- impl/scripts/expected-red-tests.json`: exactly the
  four-line row, in its sorted place between the phase77-adjacent credential row and the phase79
  row — the canonical rendering. The landed manifest at `34d6b4b3` carries the identical row
  (lines 1028-1031).
- `docs/bend2/ledger.md`, read in full against observable state: the pin digest
  (`9e4643…`), the `50dbbe15` landing of the foundation, and the AO5 finding (stale at
  `0263e104`, which added exactly one member `lastCoordinationEvent`; the same correction on
  master as `d943c960`) all cross-check against what this seat verified independently. The
  claims this seat did not re-run, recorded as such: the 61 MB `git add` exit-137 kill under
  memory pressure, and the two route refusals (`opencode-go` authentication_required,
  `deepseek-v4-pro[1m]` model_unavailable_in_harness).

## Decision

comment — the superseded carrier of work that is landed or pending the root; every checkable
claim in it reproduces.
