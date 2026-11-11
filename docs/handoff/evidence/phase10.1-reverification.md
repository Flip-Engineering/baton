# Phase 10.1 re-verification evidence

Date: 2026-07-10

Baseline: `f966e66` (`master`, clean before the temporary harness)

Mode: zero quota; coordinator stubs plus repository fake Claude and a protocol-minimal fake Codex
app-server. No real vendor CLI was invoked.

The temporary executable harness asserted the broken behavior on current HEAD. Command:

```text
node --test baton-phase10.1-reverify.test.mjs
```

Final result: 9 tests, 9 passed, 0 failed. The tests pass only when the reported defect is
observable; they are diagnostic reproductions, not desired-behavior regression tests.

| Findings | Verdict | Executable observation |
|---|---|---|
| U-1, U-6 | reproduced | kill finalized while worktree readiness was pending; resolving readiness afterward still entered spawn |
| U-2, U-11 | reproduced | kill first produced `cancelled`; refused spawn then appended `lifecycle.crashed` and changed the task to `failed` |
| U-3 | reproduced | B queued behind A, interrupt finalized, then B reached the adapter and the cancelled task completed |
| U-4 | reproduced | rejecting `spawn()` was swallowed and the task remained `working` |
| U-5 | reproduced | two same-worker Claude spawns passed the pre-await guard and created two fake child processes |
| U-7 | reproduced | Codex `turn/start` failure returned `{ok:false}` while the fake app-server child remained alive and registered |
| U-8 | reproduced | a crashed worker counted as done; a clean exit with an unrelated warning did not |
| U-9 | reproduced | an accepted verdict survived the next turn, producing `1 active, 1 done` for one worker |
| U-10 | reproduced | Claude session remained live beyond a supplied `timeoutMs` |

The first U-3 attempt did not establish that A had acquired the delivery slot before interrupt and
therefore observed only B. The harness was corrected to wait for A's adapter call before queuing B;
the corrected deterministic run reproduced resurrection. The first U-8 attempt used an all-matching
`**` path scope and therefore created no warning; the corrected `src/**` scope reproduced the bad
done-count predicate. These harness corrections changed preconditions, not product code.

Conclusion: none of U-1 through U-11 is refuted. U-1/U-6, U-2/U-11, and the two reports collapsed
into U-3 are shared-root duplicates. The authoritative correction contracts are SC12–SC19 in
`spec/phase10.1/spawn-stop-reconciliation.md`.

## Permanent red/green record

The diagnostic harness was removed after the verdicts were preserved above. Permanent
desired-behavior regressions landed in `impl/test/phase10.1-reconciliation.test.mjs`, and the two
confirmed test-honesty gaps were closed in `impl/test/phase10-completion.test.mjs`.

Before implementation, the strengthened phase-10 locks passed and all 11 initial SC12–SC18 tests
failed for their stated reasons. After implementation plus review-driven additions, the phase-10.1
file contains 16 passing tests and the complete repository suite is **427/427 green**.
