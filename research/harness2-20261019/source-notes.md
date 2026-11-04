# Source notes: Harness2 study for issue #956

This is the reading log and command record for
`research/harness2-20261019/architecture-map.md`.

## Pins

| Source | Revision | Notes |
| --- | --- | --- |
| Baton worktree | `74f933480e363e808bbeae2d63edfbe6eaa0e33a` | Branch `research/h2-source`; clean at study start. |
| Harness2 upstream | `1cfe254e8d25b15f37048c3730134686abe60335` | 2026-10-13, `Fix arXiv link`; cloned at `.scratch/harness2-1cfe254e`. |
| Harness2 paper | arXiv 2610.14224v1 | Read the HTML rendering, 1,727 lines, including appendices A–H. |
| Fork-and-Flush paper | arXiv 2610.07447v1 | Read the HTML rendering, 771 lines. |
| Baton branch feature | `0464b7c65d` | `docs/bend2/branching-ensembles.md` and `bend2/src/coordinator/branching.bend`; not an ancestor of the pinned worktree. |

## Commands run

Worktree and clone:

```sh
pwd
git status --short
git log -1 --format='%H %s'
git branch --show-current
mkdir -p .scratch
git clone -q https://github.com/google-research/harness2 .scratch/harness2-1cfe254e
cd .scratch/harness2-1cfe254e
git checkout -q 1cfe254e8d25b15f37048c3730134686abe60335
git rev-parse HEAD
git log -1 --format='%H %ad %s' --date=iso
```

Harness2 source inspection:

```sh
wc -l harness2/core/*.py harness2/*.py harness2/cli/*.py harness2/benchmarks/*.py harness2/substrate/*.py
ls docs
cat pyproject.toml
sed -n '1,80p' README.md
grep -n 'SurfaceSpec(' -A 40 harness2/substrate/opencode.py harness2/substrate/codex.py
grep -n 'def surface\|def base_harness\|def task_prompt\|def execute\|def delivered\|allow_subagents\|reserved_scripts\|leak_globs\|proposer_deliverables\|obs_trunc' harness2/benchmarks/*.py harness2/substrate/*.py
```

Files read in full or in relevant ranges:

- `harness2/core/schedule.py`
- `harness2/core/recursion.py`
- `harness2/core/library.py`
- `harness2/core/context.py`
- `harness2/core/prompts.py`
- `harness2/core/tree.py`
- `harness2/core/spec.py`
- `harness2/core/selection.py`
- `harness2/core/proposer.py`
- `harness2/core/ledger.py`
- `harness2/config.py`
- `harness2/substrate/opencode.py`
- `harness2/substrate/codex.py`
- `harness2/cli/run_sweep.py`
- `harness2/benchmarks/jobbench.py` (adapter and base harness sections)
- `harness2/benchmarks/lab.py` (adapter and base harness sections)
- `harness2/benchmarks/workbuddy.py` (adapter and base harness sections)
- `harness2/install.py` (setup paths)

Paper sections read:

- Abstract, §1, §2.1, §2.2.1, §2.2.2, §2.3.
- §3.1, §3.2, §4.
- §5, §6.
- Appendix A (Table 4 comparison), Appendix B (benchmarks and container
  execution), Appendix C (baselines), Appendix D.1–D.3 (executors, library,
  Table 5), Appendix E.1–E.7 (component ablation, reuse, transfer, tool use,
  production harnesses, failure analysis, case studies), Appendix F
  (limitations), Appendix G (future work), Appendix H (prompts).

Baton documentation and source:

```sh
wc -l docs/bend2/agent-commands.md docs/bend2/architecture.md \
  docs/bend2/current-work-scope-2026-10-19.md \
  docs/bend2/knowledge-context-2026-09-29.md \
  docs/bend2/knowledge-context-2026-10-01.md \
  docs/bend2/examples/shared-finding-review.md
baton help branch
baton help knowledge
baton help knowledge-record
baton help knowledge-read
baton help knowledge-relate
baton help knowledge-promote
baton help knowledge-search
baton help knowledge-traverse
baton help knowledge-relations
baton help ensemble
baton help section
baton help role
baton help dispatch
baton help report
git cat-file -e HEAD:docs/bend2/branching-ensembles.md
git log --oneline --all -- docs/bend2/branching-ensembles.md
git show 0464b7c65d:docs/bend2/branching-ensembles.md | nl -ba
git show 0464b7c65d:bend2/src/coordinator/branching.bend | nl -ba
grep -n 'knowledge' docs/bend2/architecture.md
grep -n 'knowledge' docs/bend2/agent-commands.md
nl -ba AGENTS.md
```

`baton help dispatch` returned a project/database conflict object in this
worktree. Dispatch semantics below come from
`docs/bend2/agent-commands.md:173-202` and `docs/bend2/architecture.md:160-175`.

Baton files read:

- `docs/bend2/agent-commands.md` (complete).
- `docs/bend2/architecture.md` (complete).
- `docs/bend2/current-work-scope-2026-10-19.md` (complete).
- `docs/bend2/knowledge-context-2026-09-29.md` (complete).
- `docs/bend2/knowledge-context-2026-10-01.md` (complete).
- `docs/bend2/examples/shared-finding-review.md` (complete).
- `bend2/src/coordinator/knowledge.bend` (schema, scope SQL, notices,
  promotion, record and read entry points).
- `AGENTS.md` (validation execution, banned runtime patterns, writing rules).
- Feature commit `0464b7c65d`: `docs/bend2/branching-ensembles.md` and
  `bend2/src/coordinator/branching.bend`.

The branch feature is not present at the pinned worktree:

```sh
git cat-file -e HEAD:docs/bend2/branching-ensembles.md   # exit 128
git merge-base --is-ancestor f102ffafbd HEAD             # exit 1
baton help branch                                        # prints the action usage
```

`docs/bend2/current-work-scope-2026-10-19.md:51-56` records that PR #860 needs
current-main integration and runtime qualification, and that actual Baton
branch actions and completed branch results are still required.

## Important source observations

- Harness2's task-level flow is an executable edited-tree search. The
  proposer edits files in `context/harness/`; the returned directory is
  harvested and validated; each candidate is rolled once; a composer merges
  supported edits; the final harness is rolled and selected.
- The reference execution count is `k`, not one. `run_task` rolls `base1` to
  `basek` before every mode (`schedule.py:619-626`).
- Parallel recursion uses `2k` proposal stages and `k` aggregator stages; the
  ledger enforces `R = 4k` rollouts and `P = 3k` sessions
  (`ledger.py:15-33, 89-113`).
- Sequential recursion uses two candidates per round and one composition per
  round; the final round's prompt asks for the final harness from the whole
  history (`recursion.py:478-562`; `prompts.py:964-1008`).
- Final selection uses exactly the `k` finals in the `finals` pool
  (`selection.py:93-111`; `schedule.py:513-528, 579-599`). The `mixed` prompt
  constant remains, but the driver rejects every other pool policy.
- The library entry is the full adopted tree plus `EXPERIENCE.md`
  (`library.py:106-150`). The entry is written only when the experience has
  `cue`, `lesson` and `evidence` (`library.py:43-47, 120-121`). Losing
  candidates and trajectories remain in the run directory, not in the library.
- The library is per mode and per domain; `run_domain` retains only entries
  before the current task (`schedule.py:686-702`). Domains can run in parallel
  (`schedule.py:780-850`).
- Harness2 validation includes automatic trigger-line repair, always-on caps
  (24,000 characters for OpenCode, 8,000 for Codex), skill and subagent
  frontmatter, Python compilation, hook schema and script references
  (`tree.py:192-213, 267-390`; `opencode.py:42-88`;
  `codex.py:39-90`).
- Harness2 has explicit contamination guards: `assert_no_leak_paths` and
  `assert_no_grader_verdicts` on context trees and harness trees
  (`context.py:399-518`), and the adapters declare leak globs
  (`jobbench.py:518`, `lab.py:490`, `workbuddy.py:91, 99, 108`).
- Baton Knowledge has durable finding, promotion and relation tables
  (`knowledge.bend:16-19`), scope SQL (`knowledge.bend:112-135`), recording
  notices to the author's parent (`knowledge.bend:297-330`) and promotion
  notices to the destination owner (`knowledge.bend:377-430`).
- Baton branch selection without `--player` requires a unique accepted best
  score from every branch, no explicit stop, and successful settlement
  (`branching.bend:284-306`). A tie, failure or partial round requires an
  explicit player and reason.
- Baton branch continue dispatches to the selected Player's existing
  conversation and workspace (`branching.bend:308-319`). This differs from
  Harness2 sequential recursion, which composes a harness and starts a new
  execution.

## Unresolved questions

1. What is the qualified status of Baton branch actions on a later main? The
   pinned scope says PR #860 is not qualified. The installed CLI advertises
   the actions, and feature commit `0464b7c65d` contains a doc and source, but
   this study did not run them or read a merged-main acceptance record.
2. Which exact commit contains the final intended branch implementation? The
   feature history has multiple commits (`6dea727adf`, `0464b7c65d`,
   `af07ff726f`, `f102ffafbd`); the study used `0464b7c65d` for the doc and
   the source anchors. A later commit may change the commands or fields.
3. Does the Baton branch evaluator have a supported path for Harness2-style
   label-free comparison? The documented evaluator returns
   `{"accepted": bool, "score": number}`. The study did not find a
   no-score mode.
4. Can a Baton finding carry a full executable harness tree? The finding
   schema has claim, evidence and limits only. The study assumes a
   `file:` reference to a committed tree; it did not find a content-addressed
   artifact store.
5. Does `knowledge promote` accept a `file:` or commit reference as a
   finding's evidence without a retained message? The docs allow `file:` and
   `external:` references, but the acceptance case used a retained message.
6. Does Baton have an automated context builder for an evidence directory
   equivalent to `harness2/core/context.py`? The study found none in the
   pinned docs and command help.
7. Harness2 has two prompt packs ("adapt" and "tts"). The study read both
   builders but did not determine which benchmarks use which pack in the
   released experiment configuration. `BenchPrompts.prompt_pack` defaults to
   `adapt` (`spec.py:103`).
8. The paper says the selector compares anonymized deliverables, while the
   code's only release pool is the `k` finals. The study did not find a
   published `mixed` pool run.
9. The paper's Table 5 calls the eighth component a "middleware plugin"; the
   Codex surface exposes a hooks JSON file and no plugin directory
   (`codex.py:39-90`). The study treats both as the middleware component and
   notes the path difference.
10. The paper says each benchmark domain has its own library directory. The
    code creates one library per mode and domain
    (`schedule.py:686-689`), so two modes on the same task stream do not share
    entries. The paper does not state whether mode libraries are intended to
    be separate.

## Verification limits

- No model-backed Harness2 call was made.
- No Baton branch action was executed.
- No benchmark dataset, rubric, hidden test or answer key was downloaded or
  read.
- The paper's performance numbers and provenance percentages were not
  reproduced.
- `issue://956` could not be read because the GitHub CLI is not authenticated;
  the assignment text supplied the scope.
- The Baton source anchors for the branch feature are from a feature commit,
  not the pinned worktree. The architecture map marks this on every branch
  row.
