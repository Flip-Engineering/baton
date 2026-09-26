# Contributing to baton

This document covers how changes to this repository are made, verified, and landed, including the
workflow used to develop baton with baton itself. It assumes you have already read the
[README](README.md) and, ideally, [SYSTEM.md](SYSTEM.md).

There is currently no LICENSE file in this repository. Check with the maintainers before assuming
you can redistribute or reuse the code, even if you are contributing to it.

## Development environment

```bash
cd impl && npm ci
node scripts/run-suite.mjs --all   # the whole suite; the verdict lists every failure
node scripts/surface-gate.mjs      # grammar lint, generated artifacts, MCP dispatch (--write regenerates)
```

Requires Node ≥ 20 (Node 22 is what the project's own residents run). The only runtime dependency
is `@ast-grep/napi`. Install the pre-commit hook once per clone:

```bash
git config core.hooksPath .githooks
```

`baton --help` lists every top-level verb; `baton help swarm`, `baton help run`, `baton help
routing` and `baton help connection` render the topics in depth. The generated command inventories
are [impl/CLI.md](impl/CLI.md) and [impl/MCP.md](impl/MCP.md); regenerate them with
`node impl/scripts/surface-gate.mjs --write` after any surface change.

## The test suite and its verdict

`run-suite.mjs` runs the parallel lane, then the process-heavy files listed in
`impl/scripts/suite-lanes.json` serially. A run is GREEN when no test failed and nothing hung
(`BATON_SUITE_IDLE_MS`, default 10 minutes); the verdict names every failure with its file and
test name.

A landing (`baton swarm integrate`) runs the tests the change affects. When any of them fail, it
re-runs the failing files on the target branch in the same checkout and blocks only on a test that
passes on the target and fails with the change. A test that fails on both sides is reported and
does not block. Known breakage is tracked in the issue tracker. No file lists expected failures.

A partial run (a subset of test files) prints a `SUBSET verdict (n of m files)` line and is not a
substitute for a full run. On a host that is also running development lanes, the suite takes a
verify lease so two suite runs never compete for the same CPU cores (see
[#333](https://github.com/Flip-Engineering/baton/issues/333)); `BATON_HOST_CAPACITY_DISABLED=1`
bypasses that lease for a maintainer-run gate.

A run names the files it verifies (`node scripts/run-suite.mjs test/<file> …`). With no file list
it refuses and names the fix: `test/<file>` paths, or `--all` for the whole canonical suite
(`npm test` passes `--all`). A named path the checkout does not carry is refused, and the name is
printed.

## Operating a resident

`baton serve` hosts a standing, owner-local process for one repository. To restart it after a code
change:

1. Stop every active swarm participant with `baton swarm stop <swarm> <participant>`.
2. Find the resident's process id by its working directory (never by matching a substring of the
   command line) and send it `SIGTERM`.
3. Wait for the `host.stopped` row to appear in the coordination ledger.
4. Relaunch from a dedicated shell: `(nohup node scripts/baton.mjs serve > /tmp/baton-serve.log
   2>&1 < /dev/null &)`.
5. Before trusting the new process, run one `baton swarm recruit` on a low-cost route. A successful
   `baton run` does not prove that recruiting a worker still works; check recruiting directly.

[Issue #306](https://github.com/Flip-Engineering/baton/issues/306) and
[docs/48](docs/48-reincarnation-in-place.md) describe reincarnation: replacing a running resident's
process in place, without the manual stop-and-relaunch sequence above, while workers stay attached.
Where it applies, prefer `baton deployment reincarnate <commit-ish>` over the manual restart.

## The self-hosted development loop

Since 2026-09-13, every change to this repository has been made by a worker recruited on a running
baton resident and landed by a reviewer, using baton's own swarm runtime. This section describes
that loop for anyone who wants to reproduce it, either on this repository or their own.

1. **Serve a resident** on the commit you want to develop against, from a dedicated shell that does
   nothing else:
   ```bash
   cd impl && (nohup node scripts/baton.mjs serve > /tmp/baton-serve.log 2>&1 < /dev/null &)
   node scripts/baton.mjs doctor --check      # connection, served commit, route readiness, model profiles
   ```
   The log's last lines say `replayed (...)` then `answering (... checkpoint <state>; reconstructed
   <ms>)`. A resident opening a large ledger publishes from its checkpoint in tens of seconds.

2. **Create a swarm and recruit workers**, one issue per worker, with an exact route, a path scope,
   and only the permissions the worker needs:
   ```bash
   node scripts/baton.mjs swarm create "Wave description" --swarm-id swarm-wave-N
   node scripts/baton.mjs swarm recruit swarm-wave-N worker-1 "$(cat brief.txt)" \
     --options '{"exact":{"harness":"omp","model":"deepseek/deepseek-flash","effort":"max"},"scope":["impl/src/example.mjs","impl/test/issue-example.test.mjs"]}'
   # a sub-orchestrator that recruits its own workers:
   node scripts/baton.mjs swarm recruit swarm-wave-N sub-orch-1 "$(cat brief-sub.txt)" \
     --permissions '["read","communicate","contribute","review","organize","recruit","stop"]' \
     --options '{"exact":{"harness":"omp","model":"kimi-code/k3","effort":"max"},"scope":["docs/example.md"]}'
   ```
   The recruit receipt names the worker's run, its worker process, and its workspace
   (`.baton/wt/<workspaceId>`, on a lane branch `baton/<workspaceId>`). The brief a worker receives
   is composed by the runtime: the objective, the swarm's current state, the routes it may recruit
   on, the bridge verbs it holds, and a validated example of the contribution it should report.
   Workers hold no GitHub credential; use `--issue N` to admit the cited issue and its referenced
   docs as a context package, or pass the issue text directly in the objective.

3. **Wait for a wake:**
   ```bash
   node scripts/baton.mjs swarm watch swarm-wave-N --after-seq <cursor> \
     --wake-class contribution_recorded,dead --timeout-ms 1740000 --projection outline
   ```
   The response carries the wake row and the current outline. Re-arm the watch from the returned
   sequence number.

4. **Land the contribution.** The reported row's `commit.sha` names the real commit and
   `commit.branch` the lane branch:
   ```bash
   git log --reverse master..baton/<workspaceId>            # the full range in order, never the tip alone
   git cherry-pick <sha...>
   node scripts/surface-gate.mjs --write && node scripts/render-surface-docs.mjs --write
   BATON_SUITE_VERDICT_FILE=/tmp/verdict.json node scripts/run-suite.mjs test/<gate files>
   ```
   Pick the whole commit range in order, regenerate the shared artifacts, and run the gate files
   implied by what changed before pushing.

5. **Review and release the worker:**
   ```bash
   node scripts/baton.mjs swarm update swarm-wave-N swarm.contribution_reviewed \
     --payload '{"contributionId":"<id>","decision":"accept","reason":"landed as <sha>"}'
   node scripts/baton.mjs swarm stop swarm-wave-N worker-1 "landed"
   ```
   Smoke-test the changed surface on the landed commit before closing the tracking issue: a green
   test file is not proof that the corresponding CLI or MCP command works end to end.

**What a worker records.** One `swarm.contribution_recorded` event per landed change, with
`body.subject`, `body.base {observedHead, rebasedOnto}`, `body.commit {sha, branch}`,
`body.items[] {id, status: delivered | not_delivered, change, files, test, evidence}`,
`body.needsFromOthers[]`, and `body.carriedForward[]`. A worker that needs a file outside its scope
names it in `needsFromOthers`.

**What a reviewer reads from the ledger.** Every worker's evidence is under
`.git/baton/application-v3/state/w-<n>.jsonl`; the coordination ledger is
`.../state/coordination/events.jsonl`. A failed turn is a typed event (for example,
`lifecycle.turn_completed status=failed failure.code=provider_quota_exhausted`).

## Filing issues

Use the `bug` label for anything that breaks in real use. Add `priority:high` when the break stops
the development loop itself (an unusable resident, a broken landing path, a broken suite). File
issues before or alongside fixing them, so the fix is traceable to a stated problem.
