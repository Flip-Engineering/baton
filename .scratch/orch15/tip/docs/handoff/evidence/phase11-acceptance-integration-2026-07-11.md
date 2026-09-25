# Phase 11.3 acceptance and integration evidence — 2026-07-11

## Verdict

PASS for the zero-quota safety gate. The public `createDriver()` path now implements AC1–AC6 from
`spec/phase11/acceptance-integration.md`. Sixteen focused tests exercise real temporary Git
repositories, and the complete implementation suite passes 502/502.

No provider quota and no network remote were used for this subphase. Publication tests inject a
recording publisher; the production default is present but was not invoked against a real remote.

## Shipped contracts

- **AC1 red→green:** distinct fresh worktrees at the pinned base and captured result run the exact
  same verification command; both sandboxes are reaped on success or failure.
- **AC2 changed-line coverage:** Baton computes the Git delta itself and rejects a passing result
  when any changed line is absent from the coverage report.
- **AC3 mutation strength:** an optional pinned command reports `{killed,total,survived[]}`;
  required acceptance demands a nonzero population with every mutant killed.
- **AC4 independent oracle/review:** a child task receives the frozen original brief and exact
  base/result/diff references, never the implementer's prose result. Vendor and model family are
  recorded. A same-family fallback is visible but cannot unlock a required oracle gate.
- **AC5 integration:** only an accepted captured SHA can enter `ff-only` integration. Baton stops
  and reaps the worker and task worktree/branch, refuses dirty or diverged main without rewriting
  it, records exact before/result/after SHAs, and retains `refs/baton/results/<sha>` if integration
  refuses so evidence is not left dangling.
- **AC6 publication:** request creation performs no side effect. Allow requires the exact current
  fence and targets the integrated SHA, a credential-free remote name, and a full `refs/heads/*`
  ref. Single-consumer resolution calls the publisher once. Deny, timeout, stale fence, invalid
  target, missing approval, or restart calls it zero times.

## Adversarial cases pinned

The focused suite proves:

1. genuinely red base plus green result accepts;
2. covered changed lines accept and uncovered changed lines reject;
3. all-killed mutation population accepts and a named survivor rejects;
4. integration is blocked before a required oracle completes;
5. a different-family oracle unlocks integration;
6. a completed same-family oracle remains insufficient;
7. fast-forward integration reaps worker/worktree/branch and advances main exactly;
8. diverged main and dirty main remain unchanged on refusal;
9. unaccepted results cannot integrate;
10. publication has no effect before approval and concurrent allows produce one call;
11. deny and deadline timeout are fail-closed;
12. a newer authority fence invalidates an older request;
13. replay does not resurrect pending publication authority; and
14. credential-bearing remotes and mismatched SHAs are rejected before an event is logged.

## Commands and results

```text
$ node --test impl/test/phase11-acceptance-integration.test.mjs
tests 16; pass 16; fail 0

$ cd impl && node --test
tests 502; pass 502; fail 0

$ git diff --check
(no output)
```

## Honest remaining boundary

This is the first safe integration vertical, not semantic integration completion. Conflict
classification, AST/IR-aware merge, stacked changes, rollback, deploy adapters, and a live remote
push remain future work. Required review currently gates on distinct declared model family and its
own trust-gated command; decorrelation quality evaluation remains separate research.
