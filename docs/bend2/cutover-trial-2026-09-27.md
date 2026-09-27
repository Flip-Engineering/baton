# Cutover trial kit proof, 2026-09-27

The operator requested a trial kit after the root-day acceptance. This run used
`trial-start.sh`, a real Codex `gpt-6-astra` root on its ChatGPT subscription login,
and one real OMP `deepseek/deepseek-flash` worker. The repository was a scratch
clone of this repository at master `42545b1efc2e5724cec7e8822a42ebf01cd5bbb2`.
Its `origin` was an explicitly created local bare repository. The Bend2 tools
came from a separate checkout, with the kit at `09555f2e` and the executable-mode
correction described below.

## Task and outcome

The rehearsal task improved two vague descriptions in the existing
`impl/test/usd.test.mjs`. It preserved every assertion and the production code.
The operator's explicit rehearsal task took the place of an open tracker issue;
this run neither consulted nor closed an issue.

1. The launcher built `baton2`, created `bend2-trial`, attached the root adapter
   and printed the `message-file` seed command.
2. That command started native Codex session
   `01a0e179-d5a1-79d3-8d06-3449e0f4422c`. The root recruited `cutover-rehearsal`,
   wrote its task, launched its turn using a detached supervisor, acknowledged
   the seed and ended its first turn with exit 0.
3. OMP native session `01a0e17a-ce6b-7000-8b22-0e9c978bd78a` changed the two
   descriptions and committed `cfeb6a9eb0c25ba6ee353d4ea59b5b9fc5793e21`.
   Its selected check passed all three USD tests.
4. The committed worker report started the second turn of the same Codex root.
   It inspected the actual worktree and committed diff, acknowledged the report,
   and invoked `land-checked` with the absolute check-adapter path and only
   `impl/test/usd.test.mjs` selected. The result was `landed`, with target commit
   `048509ccf5c82bc22800544cb3e378e3f7347174`.
5. The root invoked coordinator `push`, which returned `pushed`. Its
   `git ls-remote origin refs/heads/bend2-trial` read back
   `048509ccf5c82bc22800544cb3e378e3f7347174`.
6. The root wrote operator message
   `cutover-rehearsal-landed-048509ccf5c82bc22800544cb3e378e3f7347174`, naming
   the worker commit, landed commit, selected check and advertised ref, then
   ended its turn. The message remains available through `inbox operator`.

The launcher was then run again with the same three paths. It exited 0, kept
that native root session, retained the task file byte-for-byte and preserved all
three coordinator messages. The root had no pending messages to deliver.

## Check adapter and corrections

`check-node-test.sh` runs the checked tree's `impl/scripts/run-suite.mjs` for one
absolute test path. It reads the fresh `BATON_SUITE_VERDICT_FILE` document and
uses that tree's `suite-comparison.mjs` failure-kind and file-level classification.
It writes the repository-relative file, test, kind and semantic failure type as
four hex-encoded fields. Runner output goes to stderr.

Before seeding the root, the real selected-file run exposed a path problem:
passing `impl/test/usd.test.mjs` to the current runner resolved it beneath its
`impl` root a second time. The adapter now passes the selected file's absolute
path. The corrected run exited 0 with no identity output and three passing tests.
The initial failure produced an unjudged result and could not authorize a landing.

A temporary incorrect expected value in the scratch clone's USD test produced
exit 1 and this decoded identity:

```text
impl/test/usd.test.mjs
USD helpers add and subtract exact units without floating authority drift
assertion
testCodeFailure
```

The original test was restored before recruitment. A missing selected file
produced exit 2 and an unjudged reason. The adapter requires the current typed
verdict with `failures` and `reportedFiles`; the historical JS runner carried on
`bend2-rewrite` predates that document and is not the trial repository runner.
A selection absent from a checked tree remains unjudged under this adapter.

The OMP worker initially tried executing the check script directly and received
permission denied. It used `bash` successfully; the landing itself invokes
checks through `/bin/sh`. The kit now marks both entry scripts executable.
Direct execution of the corrected check script passed the three selected tests.

## Evidence and limits

The assigned checkout retains the proof under
`.scratch/bend2/architect14/trial-proof/`: the cloned repository, scratch bare
remote, `trial.db`, `trial.db.root.log`, launcher and check outputs, and
`reattach-evidence.json`. `trial.db.trial/` holds the executable, environment,
seed task, worker task and worktree, and supervisor and native logs. Native Codex
conversation records remain in the proof's existing local harness storage.

For this seat's containment, native launch wrappers placed harness state inside
the assigned worktree. Selected JS runs used a contained `BATON_TEST_TMP_PARENT`
and `BATON_HOST_CAPACITY_DISABLED=1` to avoid shared host-lease writes. Git
identity came from environment variables. These proof settings are not imposed
by the launcher on the operator's terminal.

Only the selected USD test file ran. The whole JS suite and generic deployment
verification command were not run. No GitHub branch was pushed. The operator
launches the actual issue lane from its terminal with its own native logins and
push credentials.
