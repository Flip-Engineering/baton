# Independent evaluation for issue #956

Evaluator: `harness2-independent-evaluator`, Baton Player in the tight
Ensemble `harness2-research`, Section `independent-evaluation`.

Coordinator: `harness2-research-conductor-20261019`.

Source pins:

| Source | Revision |
| --- | --- |
| Baton | `74f933480e363e808bbeae2d63edfbe6eaa0e33a` |
| Harness2 | `1cfe254e8d25b15f37048c3730134686abe60335` |
| Paper | arXiv 2610.14224v1, "Harness2: Recursive Agent Harnessing for an Open World" |
| Fork-and-Flush paper | arXiv 2610.07447v1, "Fork-and-Flush: Escaping Idea Basins in Autoresearch Agents" |
| Baton branch feature | commit `0464b7c65d`, not an ancestor of the Baton pin |

Artifacts reviewed:

- `research/harness2-20261019/architecture-map.md` and `source-notes.md` in the
  source researcher's worktree, read at 2026-10-19.
- The conductor fixture at
  `/mnt/nvme4tb/ci-runners/baton2-native-homelab/home/.local/share/baton2/research/harness2-20261019/project/research/harness2-20261019/fixture/`.
- Stub runs `/tmp/h2study/runs/stub-all2/` and `/tmp/h2study/runs/stub-all3/`.
- OMP baseline runs `/tmp/h2study/runs/omp-task1-baseline/` and
  `/tmp/h2study/runs/omp-baseline-23/`.
- OMP Propose-Probe-Compose run `/tmp/h2study/runs/omp-all-ppc/`. This
  directory was not named in the assignment text. It was present in the shared
  runs directory and its `results.json` completed at
  `2026-10-19T18:12:20Z` during this review. I include it as supplementary
  evidence and label it wherever it is used.
- The installed Baton CLI
  `/mnt/nvme4tb/ci-runners/baton2-native-homelab/home/.local/share/baton2/releases/2.0.0-pr934-pr939-pr941-routed-20261019/bin/baton`,
  its `help` output, the pinned Baton docs, and `knowledge.bend`.

I ran no model-backed OMP call. I ran the deterministic stub fixture twice
against a temporary output directory to check repeatability. I did not modify
the conductor fixture, the source researcher's worktree, the Baton source, or
production defaults.

## 1. Summary

The source researcher's Harness2 architecture claims are substantially
correct. I confirmed the task-level recursion structure, the candidate and
composition counts, the `k=1` selection bypass, the library entry shape, the
validation and retry path, the leak guards, and the cited paper statements.
I found two citation errors in the map and one precision issue in the
Knowledge scope description. The Baton branch half of the map is accurate
against the feature commit and the installed CLI, and it correctly states that
the feature is not in the pinned Baton tree and is not qualified there.

The fixture is not a valid test of Harness2's mechanisms. It is a deterministic
control-flow skeleton. The OMP baseline already passes all three tasks. The OMP
Propose-Probe-Compose run uses 3.6x to 7.2x the baseline tokens and 4.0x to
7.2x the baseline wall time, with the same task outcomes. The fixture's
proposals and composition are deterministic in OMP mode, the composition gates
on test outcomes and the expected task3 total, and the candidate domain memory
contains task-specific solution text. The fixture does not enforce the six
model-call cap under the plain meaning of that cap, it does not enforce a
30-minute task deadline, the seed is recorded but unused, and the `retries`
field is a constant zero. The no-branching ablation shares one workspace and
collects both probe evidence records after the second probe, so the invariant
evidence is contaminated.

The no-oracle task3 reports are acceptable in the OMP baseline and in the stub
Propose-Probe-Compose arms. The stub baseline report is incomplete. The stored
fixture evidence for the OMP baseline task3 report says `coverage=0` and
`error_total=null`; the report itself parses to `coverage=2` and
`error_total=5` under the current fixture parser. That stored value is a stale
measurement from an earlier fixture revision.

Recommendation: reject adoption of the Harness2 mechanisms on this evidence.
Keep the source map as a design reference. A further prototype is justified
only under the acceptance criteria in section 4, with model-driven proposals
and composition, tasks that have headroom, equal oracle access in both arms,
and factual records of model usage and elapsed time. Those measurements are
reported as study outcomes. Runtime actions follow the assignment and actual
execution results.

## 2. Source-map critique

Status values are `confirmed`, `unverified`, and `contradicted`. A
`confirmed` row means the claim content matches the cited source. A
`contradicted` row means the cited location or the stated observable does not
match. Severity is the effect on the study conclusion.

| # | Claim reviewed | Exact source location | Independent check or command | Expected observable | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | Harness2 runs `k` reference executions, proposes INV and DOM candidates, rolls each candidate once, composes a successor, and rolls the final. | `harness2/core/schedule.py:619-626,635-662`; `harness2/core/recursion.py:343-449,452-566`; paper §2.2.1-§2.2.2 | `read harness2/core/schedule.py:619-626`; `read harness2/core/recursion.py:368,392-445` | `labels = [f"base{i}" ...]`; `_roll_bases`; `specs` built from INV and DOM; `_roll_many`; `agg_specs`; `c1..ck`. | High | Confirmed. |
| S2 | At `k=1`, Harness2 delivers the single final without a selector session. | `harness2/core/selection.py:360-399`; `harness2/core/schedule.py:513-528`; paper §2.2.2 | `grep -n "trivial_selection" harness2/core/*.py`; `read harness2/core/schedule.py:513-528` | `trivial_selection` call on the `k == 1` path; `Selection.trivial=True`; `selection.json` written. | High | Confirmed. |
| S3 | A library entry is the full adopted tree plus `EXPERIENCE.md`; `cue`, `lesson` and `evidence` are required. | `harness2/core/library.py:43-47,106-150`; `harness2/core/selection.py:454-505`; paper §2.3, Appendix D.2 | `read harness2/core/library.py:106-150`; `read harness2/core/selection.py:493-504` | `has_experience` requires the three fields; `harness_tree.write_tree`; `EXPERIENCE.md` rows for cue, lesson, evidence, confidence. | High | Confirmed. |
| S4 | An invalid proposal gets one retry with the validator message; a second failure falls back to the starting tree and records `fell_back`. | `harness2/core/recursion.py:36,180-251`; `harness2/core/tree.py:192-213,336-390`; paper Appendix D.2 | `read harness2/core/recursion.py:180-251`; `grep -n "STAGE_ATTEMPTS" harness2/core/recursion.py` | `STAGE_ATTEMPTS = 2`; `for attempt in range(1, STAGE_ATTEMPTS + 1)`; `fell_back=True` on the second failure. | High | Confirmed. |
| S5 | Harness2 scans context and harness trees for grader verdicts and answer-key paths before a model sees them. | `harness2/core/context.py:399-518`; `harness2/core/recursion.py:108-132`; paper Appendix B | `grep -n "assert_no_leak_paths\|assert_no_grader_verdicts\|GRADER_VERDICT_MARKERS" harness2/core/context.py harness2/core/recursion.py` | Functions and marker tuple present; `_accept_tree` calls `assert_tree_has_no_grader_verdicts`; `context.build` calls both assertions. | High | Confirmed. |
| S6 | Appendix E.2 reports 22% library provenance on LAB and WB-office, 47% on JobBench, and 2-10% of modified files retaining at least half their lines; the leave-one-out re-run is offline. | Paper Appendix E.2, Figures 10-11 | `read https://arxiv.org/html/2610.14224v1` and read Appendix E.2 | Exact percentages; the appendix describes the re-run as an offline reuse analysis and states that it does not estimate online gains. | High | Confirmed. |
| S7 | The map cites `prompts.py:126-193` for the instructions to browse `INDEX.md`, copy a component, and re-check earlier facts. | Map §4; actual `harness2/core/prompts.py:311-325,579-581` | `grep -n "context/library\|INDEX.md" harness2/core/prompts.py` | Hits at lines 320, 325 and 579-581. Lines 126-193 contain the component-surface rules. | Low | Contradicted citation. The claim content is confirmed. |
| S8 | The map cites `tree.py:267-334` for `validate`. | Map §3; actual `harness2/core/tree.py:336-390`; helpers at 267-334 | `grep -n "def validate" harness2/core/tree.py` | `336:def validate`. | Low | Contradicted citation. |
| S9 | The Baton branch feature is at `0464b7c65d`, is not an ancestor of the pinned worktree, is absent from the pinned docs, and is unqualified at the pin. | `docs/bend2/branching-ensembles.md` at `0464b7c65d`; `docs/bend2/current-work-scope-2026-10-19.md:51-56` | `git merge-base --is-ancestor 0464b7c65d HEAD; echo $?`; `git cat-file -e HEAD:docs/bend2/branching-ensembles.md`; `grep -n -i "branch" docs/bend2/agent-commands.md docs/bend2/architecture.md` | Exit 1; exit 128 for the doc; only session-branch and landing mentions; scope paragraph says integration and runtime qualification are pending. | High | Confirmed. |
| S10 | Baton `branch start`, `evaluate`, `select`, `continue` and `stop` have the semantics the map describes. | Feature doc lines 46-96; `bend2/src/coordinator/branching.bend:195-329`; `baton help branch` | `git show 0464b7c65d:docs/bend2/branching-ensembles.md`; `baton help branch` | Private index snapshot; one worktree per child; fresh native conversation; JSON argv evaluator in a snapshot checkout; unique best score; explicit selection with reason; selected conversation continued; stop retained. | High | Confirmed. |
| S11 | Baton Knowledge scopes are `worker`, `group`, `universal` and `all`; promotion requires destination ownership and a source holding; recording and promotion write notices. | `bend2/src/coordinator/knowledge.bend:112-135,296-330,377-430`; `docs/bend2/knowledge-context-2026-09-29.md:43-64` | `baton help knowledge-read`; `baton help knowledge-promote`; `read bend2/src/coordinator/knowledge.bend` | Scope names and subject rules; `promotion_admitted` and `source_carries`; `notice_target` to the immediate parent; promotion notice to the destination session or Ensemble owner. | High | Confirmed. |
| S12 | Universal scope contains "the Principal Conductor's authored findings and findings promoted to it". | `bend2/src/coordinator/knowledge.bend:116`; `docs/bend2/knowledge-context-2026-09-29.md:51` | `read bend2/src/coordinator/knowledge.bend:112-118` | The SQL selects every root session with role `principal-conductor` or `conductor`; an empty subject selects all root Conductors. | Low | Confirmed with a precision caveat. The map follows the docs' singular shorthand. |
| S13 | `baton help dispatch` returns a project/database conflict in this worktree. | `source-notes.md:107-109`; the installed CLI | `baton help dispatch` | Exit 2 with `taskProjectDatabaseConflict` and the registered-project message. | Low | Confirmed environment limitation. |

### 2.1 Confirmed claims

The Harness2 control flow is source-accurate. The map's `run_task` range,
reference labels, mode dispatch, candidate labels, probe loop, parallel
aggregator loop, sequential round loop, ledger identity, selection pool,
`k=1` bypass, library entry, validation, retry, and leak guards all match the
pinned source. The paper quotes in the map match arXiv 2610.14224v1 for
§2.2.1, §2.2.2, §2.3 and Appendices B, D.1, D.2, D.3, E.2, F, G and H.

The Baton branch and Knowledge claims match the feature commit, the pinned
docs, `knowledge.bend`, and the installed `baton help` output. The map's
caveats about the unmerged branch feature and the unqualified runtime state are
correct.

### 2.2 Unverified claims

- The Harness2 implementation was not executed. The map's behavior claims come
  from source reading and the paper. I confirmed the code paths; I did not run
  a rollout, a proposer session, a selector, a reflector, or a library update.
- The paper's reported scores, the Appendix E.2 provenance measurements, and
  the leave-one-out results were not reproduced.
- The exact model configuration of every Harness2 adapter was not traced. The
  paper names Claude Opus 4.8 for the editor and selector; the code exposes
  separate executor and improver channels. I did not verify each benchmark
  cell's final channel assignment.
- The `mixed` selection pool is not built by the release. The map says this;
  no mixed-pool run was available to inspect.
- The Baton branch actions were not executed. The feature commit and the
  installed CLI help were inspected; the pinned scope record says runtime
  qualification is pending.
- The issue #956 body was not read. The assignment text supplied the scope, as
  the source notes state.

### 2.3 Contradicted claims

- S7 and S8 are citation errors. The claims are true; the line ranges point to
  adjacent material. A reader following the map's citations lands in the
  component-surface rules and the validation helpers, not in the library
  browsing instructions or the `validate` function.
- S12 is a precision issue. The docs use the singular "Principal Conductor";
  the SQL includes every root conductor and conductor-role session. The map
  copies the docs' shorthand. This does not change the mapping conclusion.

## 3. Fixture and protocol critique

The fixture is a bounded control-flow skeleton. It does not test Harness2's
model-driven harness improvement. The table below records the concrete checks.

| # | Claim reviewed | Exact source location | Independent check or command | Expected observable | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | The stub fixture is deterministic in content. | `run_fixture.py:350-482`; `stub_model.py:123-321`; `stub-all2/results.json`; `stub-all3/results.json` | Compare the two result files with wall time, peak RSS, absolute paths and stderr paths removed. | Same per-task diff SHA-256, same test outcomes, same composition decisions. Wall time and peak RSS differ. | Medium | Confirmed for semantic content. |
| F2 | The fixture records the fixture version used by each run. | `run_fixture.py:529-548`; `results.json` | `sha256sum run_fixture.py stub_model.py omp_model.py task_manifest.json`; `stat` the result files and fixture | No fixture hash in `results.json`. `run_fixture.py` mtime is 11:08:29; the baseline results are 11:07:23 and 11:07:57. The current parser returns task3 coverage 2; the stored baseline evidence says 0. | High | Contradicted. |
| F3 | The fixture enforces six model calls per task. | `run_fixture.py:160-167,513-520` | `grep -n "max_calls" run_fixture.py`; `jq '.results[].turns' omp-all-ppc/results.json` | No stop or refusal path; `budget_violation` is set after the run. OMP PPC turns are 22, 39 and 30. Baseline turns are 6, 6 and 7. | High | Contradicted. |
| F4 | The fixture enforces 30 minutes per task. | `run_fixture.py:491-492,517-518` | `grep -n "max_seconds" run_fixture.py` | `max_seconds` is passed to each OMP process invocation. No task-level deadline or task wall time is recorded. Observed PPC task wall times are 47.2 s, 97.5 s and 78.9 s. | High | Contradicted for enforcement. Observed runs are under 30 minutes. |
| F5 | The study seed controls execution. | `run_fixture.py:498,515-516`; `omp_model.py:71-94` | `grep -n "seed" run_fixture.py omp_model.py` | The seed is read and recorded; `task_seed` is computed and stored. No seed is passed to OMP. | High | Contradicted. |
| F6 | Retries are captured. | `run_fixture.py:344` | `grep -n "retries" run_fixture.py` | `"retries": 0` is a literal in `summarise_calls`. No retry count is read from OMP. | Medium | Contradicted. |
| F7 | Persistent lessons are disabled. | `run_fixture.py:350-482`; `stub_model.py:237-321` | Inspect the arm setup and the proposal and composition inputs. | Every arm copies `base_harness`; proposals read the base and reference trace; composition reads candidates and probe evidence. No library directory is read or written. | High | Confirmed. |
| F8 | The branching arm isolates the reference, probe and final workspaces. | `run_fixture.py:417-427,452-456` | `jq '.results[].probe_inherited_changes' stub-all2/results.json`; inspect workspace paths | `probe_inherited_changes` is `[]`; reference, invariant, domain and final workspaces are distinct directories. | High | Confirmed at the filesystem level. |
| F9 | The no-branching arm measures the effect of workspace sharing. | `run_fixture.py:424-427,433-440,456` | `jq '.results[2].probe_evidence, .results[5].probe_evidence, .results[8].probe_evidence' stub-all2/results.json`; compare probe evidence hashes | Both probes use one workspace; both evidence records are collected after the second probe; the final uses the same workspace. Task3 invariant and domain report SHA-256 are both `df6d94...`. | High | Contradicted. |
| F10 | Task3 is treated as a no-oracle task. | `task_manifest.json:29-36`; `stub_model.py:296-298` | `read stub_model.py:292-300`; `jq '.tasks[2]' task_manifest.json` | The manifest says `oracle: independent-review`; the composer gates on `trace.get("error_total") == 5`. The expected total is an oracle. | High | Contradicted. |
| F11 | The Propose-Probe-Compose arm receives no expected answers. | `stub_model.py:209-213`; `omp_model.py:27-47` | `grep -n "DOMAIN_MEMORY\|Addition is implemented\|Strip" stub_model.py`; `cat omp-all-ppc/task*/ppc-branching/call-*/system_prompt.txt` | The domain memory contains "Addition is implemented with the + operator", "Strip `$` and `,`", and "Count ERROR lines in every `.log` file". The PPC system prompts contain this text. | High | Contradicted. |
| F12 | Harness scripts are mounted for the OMP arm. | `omp_model.py:27-47,71-94`; Harness2 `opencode.py:162-168` | `grep -n "scripts\|harness_scripts" omp_model.py` | The OMP system prompt lists `scripts/*.py` paths. The files stay in the harness directory outside the workspace. OMP is started with `--no-skills`, `--no-extensions`, `--no-rules`; no script is copied to a runnable path. | High | Contradicted. |
| F13 | The OMP model pin comes from the `--model` argument. | `run_fixture.py:493`; `omp_model.py:71-94` | `grep -n "deepseek" omp_model.py` | `--model deepseek/deepseek-flash` is hardcoded in `omp_model.py`. The `Runner.model` value is recorded in the result and is not passed to OMP. | Medium | Contradicted. |
| F14 | Tokens, wall time, peak memory, retries, test outcomes, source diffs and reviewer findings are all captured. | `run_fixture.py:243-258,325-347`; `omp_model.py:117-153` | `jq '.results[0]' omp-all-ppc/results.json`; `jq '.results[0]' stub-all2/results.json` | Tokens, wall time, peak RSS, test outcomes and source diffs are present. `retries` is constant zero. No reviewer field exists. Test stdout and stderr are truncated to 3000 and 2000 characters. | Medium | Partially confirmed. |
| F15 | The OMP baseline leaves headroom for Propose-Probe-Compose. | `omp-task1-baseline/results.json`; `omp-baseline-23/results.json`; task reports | `jq '.results[]'`; read the task3 report | Task1 and task2 tests pass. The task3 report meets the independent rubric. The baseline solves all three tasks. | High | Contradicted. |
| F16 | The OMP Propose-Probe-Compose arm improves task outcomes. | `omp-all-ppc/results.json`; `omp-all-ppc/SUMMARY.md` | `jq '.results[]'`; compare with the baseline results | The PPC arm passes task1 and task2 and its task3 report meets the rubric. The baseline also passes all three. PPC uses 273,988-562,378 tokens and 47.2-97.5 s; baseline uses 75,132-90,676 tokens and 11.6-14.5 s. | High | Contradicted. |
| F17 | The OMP Propose-Probe-Compose arm stays within six model calls. | `omp-all-ppc/results.json`; `omp_model.py:1-6` | `jq '.results[].turns' omp-all-ppc/results.json` | The fixture reports four process invocations. The recorded model turns are 22, 39 and 30. | High | Contradicted under the task's cap definition. |
| F18 | The OMP baseline task3 evidence says coverage 0 and no error total. | `omp-baseline-23/results.json`; `omp-baseline-23/task3/baseline/workspace/report.md` | Run the current `parse_report` on the report; `jq '.results[1].evidence' omp-baseline-23/results.json` | Stored evidence: `files=[]`, `coverage=0`, `error_total=null`. Current parse: `files=["app.log","db.log"]`, `counts={"app.log":2,"db.log":3}`, `coverage=2`, `error_total=5`. The report SHA-256 matches. | High | Contradicted stale measurement. |
| F19 | The fixture captures reviewer findings. | `run_fixture.py:529-548`; `results.json` | `jq 'keys' results.json`; inspect the result objects | No reviewer field. The independent assessment is this file and `task3-rubric.md`. | Medium | Contradicted. |
| F20 | The OMP Propose-Probe-Compose arm is a Harness2 Propose-Probe-Compose test. | `run_fixture.py:403,413`; `run_fixture.py:298-322`; `stub_model.py:237-321` | `jq '.results[].calls[].model_call' omp-all-ppc/results.json`; read the proposal and composition code | Proposal records have `model_call=false` in OMP mode; composition has `model_call=false` and `model="deterministic-composer"`. The OMP model does not edit the harness. | High | Contradicted. |
| F21 | The test command is reproducible. | `run_fixture.py:98-116`; `task_manifest.json:15,24` | `jq '.results[].evidence.tests.command'`; run `python3 tests/run_tests.py` in a prepared workspace | Command is `["/usr/bin/python3","tests/run_tests.py"]`; task1 and task2 pass or fail deterministically. Python version and full stdout are not recorded. | Medium | Confirmed with recording limits. |
| F22 | Workspace isolation is a process boundary. | `run_fixture.py:69-80`; `omp_model.py:71-94` | Inspect `prepare_workspace` and the OMP command | Each workspace is a copied directory with its own `git init` commit. OMP runs as the local user on the host; there is no container, network boundary or resource boundary. | Medium | Confirmed filesystem isolation; no process isolation. |
| F23 | Source diffs are captured. | `run_fixture.py:88-95` | `jq '.results[].source_diff'`; read `diff.patch` | Patch SHA-256, byte count, file list and patch file are present. | High | Confirmed. |
| F24 | Test outcomes are captured. | `run_fixture.py:98-116,148-151` | `jq '.results[].evidence'` | Command, exit code, pass flag, stdout tail and stderr tail are present. Task3 has no test oracle. | High | Confirmed with truncation. |

### 3.1 Determinism and repeatability

The stored `stub-all2` and `stub-all3` result files have identical per-task
patch SHA-256 values, test outcomes and composition decisions. They differ in
wall time, peak RSS, absolute workspace paths and stderr paths. Runs of the
current fixture in `/tmp/eval-stub-a` and `/tmp/eval-stub-b` reproduce the same
semantic outputs. The fixture is deterministic in content and not in timing or
memory.

Repeatability across fixture revisions is not established. `run_fixture.py`
changed at `2026-10-19T11:08:29-07:00`, after the baseline result files were
written at `11:07:23` and `11:07:57`. The results record the Baton and Harness2
pins but no fixture source hash. The task3 parser difference is the observable
consequence.

### 3.2 Workspace isolation and the no-branching ablation

The branching arm creates separate reference, invariant, domain and final
workspaces. The probe inheritance list is empty. The filesystem isolation is
real at the directory level. The process boundary is absent: all runs use the
local user, the host filesystem and the host network. Harness2 runs each
rollout in a fresh benchmark container (paper Appendix B); the fixture's
isolation is narrower.

The no-branching arm uses one workspace for both probes and the final. The code
collects both probe evidence records after the second probe
(`run_fixture.py:429-440`). The invariant evidence is therefore the workspace
state after the domain probe. In the task3 stub run, the invariant and domain
report SHA-256 values are identical (`df6d94...`). The final execution inherits
both probe outputs. The ablation changes probe isolation and final state
together; it does not isolate the branching variable. The stub outcomes are
identical between the branching and no-branching arms for all three tasks,
which is expected from the deterministic, idempotent edits and the test and
expected-total gates. The ablation has no discriminating power in this
fixture. The OMP run used the branching arm only.

### 3.3 Six-call and 30-minute caps

The fixture's `Runner` stores `max_calls` and never checks it before a call.
`main` sets `budget_violation` after `run_arm` when `model_calls` exceeds the
limit. Under the fixture's OMP definition, one process invocation is one model
call (`omp_model.py:1-6`). The OMP PPC result reports four calls, so the
fixture records no violation. The recorded model turns are 22, 39 and 30.
Under the task's plain "model calls per task" wording, the PPC arm and the
baseline task3 (7 turns) exceed six. The fixture documents a different
definition and does not enforce either version.

The 30-minute limit is implemented as `max_seconds` per OMP process
invocation. The fixture records no task start, task end or task wall time. A
task with four calls can consume four times the per-call limit. The observed
PPC task wall times are under 30 minutes. The enforcement path is absent.

### 3.4 Persistent lessons

The library is disabled. Every arm copies `base_harness` afresh. The proposals
read the base tree and the reference trace. The composer reads the candidate
trees and probe evidence. No previous task's harness, `EXPERIENCE.md`,
`INDEX.md` or finding is read. The `library` result field says
`{"enabled": false, "note": "no cross-task reads or writes"}`. The static
`DOMAIN_MEMORY` and `COUNT_ERRORS_SCRIPT` constants are task-specific fixture
content; they are not lessons from an earlier task. The persistent-lessons
ablation is real.

### 3.5 Task inputs and expected answers

The task prompts and repositories are supplied to the model, as intended. The
task1 and task2 repositories contain their tests, and the prompts tell the
model to run the tests. Those tests contain the expected values. These tasks
therefore have visible oracles; the study should label them as such.

The task3 model sees the task prompt and the logs. The deterministic domain
proposal adds task3 memory that names the counting rule and the earliest
timestamp; the PPC probes and final receive that text in the system prompt. The
deterministic composer gates on `error_total == 5`, which is the expected
answer from `task_manifest.json`. The baseline arm does not receive the memory
text and does not pass through the composer. The task3 comparison has unequal
answer access. The OMP baseline still produced a correct report, so the hint
did not create that outcome; the comparison remains confounded.

The fixture does not access a public benchmark dataset, rubric or answer key.
The expected-answer content is authored in the fixture. The narrow
"no public benchmark answers" requirement is met. The "no expected answers to
models" condition is not met for the PPC arm.

### 3.6 Test commands and measurement capture

The test command is `python3 tests/run_tests.py` with the workspace as the
working directory. The fixture uses `sys.executable`. The command, exit code
and pass flag are recorded. The output is truncated to the last 3000 characters
of stdout and 2000 characters of stderr. The Python version, the agent's own
test command and the full output are not recorded.

Tokens and cost are captured from OMP `turn_end` frames. Wall time is captured
per call and summed. Peak RSS is parsed from `/usr/bin/time -v` for OMP and
from `resource.getrusage(RUSAGE_SELF)` for the stub process. Retries are a
constant zero. Test outcomes and source diffs are captured. Reviewer findings
are not captured by the fixture; this review and `task3-rubric.md` supply the
independent assessment.

### 3.7 Propose-Probe-Compose fidelity

The stage sequence matches Harness2 at `k=1`: one reference, one INV proposal,
one DOM proposal, one rollout per proposal, one composition, one final
rollout. The fixture also bypasses selection at `k=1`, as Harness2 does.

The mechanism does not match. In OMP mode the proposals are deterministic
functions of the task id and scope (`run_fixture.py:403,413`; `stub_model.py:237-276`).
The composer is deterministic and gates on test pass or the expected task3
total (`run_fixture.py:298-322`; `stub_model.py:285-321`). The OMP model never
edits the harness and never composes a successor. Harness2's editor and
composer are agentic sessions that read trajectories, diffs and evidence and
write the candidate tree. The fixture omits harness validation, trigger-line
repair, the candidate retry and the per-domain library. It exercises the k=1
path; Harness2 also delivers the single final without a selector session at
k=1. The OMP candidate tree's scripts are listed in the system prompt and are
not runnable. Four of the eight Harness2 components have no runtime effect in
OMP mode: skills, subagents, scripts and the plugin. The fixture reproduces the
k=1 control-flow sequence with fixed edits; Harness2's model-driven improvement
mechanism is outside the fixture.

### 3.8 Observed results

Stub arms (`stub-all2`, one run; `stub-all3` is the repeat):

| Task | Arm | Model calls | Harness operations | Test outcome | Task3 coverage | Task3 total | Diff SHA-256 prefix |
| --- | --- | --- | --- | --- | --- | --- | --- |
| task1 | baseline | 1 | 0 | fail | n/a | n/a | `2a316b9059de1198` |
| task1 | ppc-branching | 6 | 3 | pass | n/a | n/a | `f9d0b57ab81e3190` |
| task1 | ppc-nobranch | 6 | 3 | pass | n/a | n/a | `f9d0b57ab81e3190` |
| task2 | baseline | 1 | 0 | fail | n/a | n/a | `e3b0c44298fc1c14` (empty diff) |
| task2 | ppc-branching | 6 | 3 | pass | n/a | n/a | `f8320e63f78c77b2` |
| task2 | ppc-nobranch | 6 | 3 | pass | n/a | n/a | `f8320e63f78c77b2` |
| task3 | baseline | 1 | 0 | n/a | 1 | 2 | `2ae3f3270d9fc7ee` |
| task3 | ppc-branching | 6 | 3 | n/a | 2 | 5 | `76667b0994f9b991` |
| task3 | ppc-nobranch | 6 | 3 | n/a | 2 | 5 | `76667b0994f9b991` |

OMP baseline (`omp-task1-baseline`, `omp-baseline-23`):

| Task | Arm | Process calls | Turns | Wall ms | Tokens | Peak RSS KB | Test outcome | Task3 coverage and total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| task1 | baseline | 1 | 6 | 11,642.671 | 75,132 | 301,264 | pass | n/a |
| task2 | baseline | 1 | 6 | 13,589.451 | 78,116 | 335,960 | pass | n/a |
| task3 | baseline | 1 | 7 | 14,536.567 | 90,676 | 325,148 | n/a | stored 0 and null; current parse 2 and 5 |

OMP Propose-Probe-Compose (`omp-all-ppc`, supplementary; `results.json`
completed during this review):

| Task | Arm | Process calls | Turns | Wall ms | Tokens | Peak RSS KB | Test outcome | Task3 coverage and total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| task1 | ppc-branching | 4 | 22 | 47,198.153 | 273,988 | 353,060 | pass | n/a |
| task2 | ppc-branching | 4 | 39 | 97,535.455 | 562,378 | 353,060 | pass | n/a |
| task3 | ppc-branching | 4 | 30 | 78,924.499 | 411,963 | 353,060 | n/a | 2 and 5 |

The OMP baseline and PPC arms have the same pass outcomes on every task. The
PPC arm uses 3.6x to 7.2x the baseline tokens and 4.0x to 7.2x the baseline
wall time. The task1 reference already passes the task; the PPC final produces
the same diff. The task2 reference already passes; the PPC final passes. The
task3 baseline report meets the independent rubric; the PPC final report also
meets it. The study has no task with headroom for the PPC arm to improve.

## 4. Acceptance criteria for a valid comparative study

A future run is valid only when every row below is observable in the committed
artifacts. The "Current fixture" column records the state of this study.

| # | Criterion | Observable check | Required result | Current fixture |
| --- | --- | --- | --- | --- |
| A1 | Fixed execution identity | `jq '{model,model_version,harness,harness_version,effort,seed,manifest_sha256,baton_commit,harness2_commit}' results.json`; `sha256sum` of the fixture and manifest | Every field is present and non-empty. The model and harness values match the observed executable (`omp/17.4.0`). The manifest and fixture hashes match the committed files. | Partial: `omp/17.4.0` matches the executable; the values are recorded as literals; no executable or fixture hash; the seed is unused. |
| A2 | Fixed task inputs and repository commits | `jq '.tasks' manifest.json`; each task has `prompt_sha256`, `repo_commit` and `oracle` or `test_command` | Three tasks. Each prompt and repository tree has a content hash. Each task names its oracle type and evaluation command. | Partial: three tasks; generated initial commits; no prompt hashes; the manifest pins Baton and Harness2 only. |
| A3 | One recursion step | The call labels are exactly `reference`, `propose-invariant`, `propose-domain`, `probe-invariant`, `probe-domain`, `compose`, `final`. The results contain no library read or write. | One reference, two proposals, two probes, one composition, one final. No second round, no library. | Pass for the stage sequence; persistent lessons are disabled. |
| A4 | Observed model usage | Define whether each recorded unit is a provider request or a harness turn. Record per-task counts and inspect `jq '.results[].turns' results.json`. | Report the observed counts as study data. Runtime handling follows the assignment and execution results. | The OMP PPC runs recorded 22, 39 and 30 model turns. The fixture counts process invocations and records overage after each run; it does not enforce a cap. |
| A5 | Observed task elapsed time | Record `task_started_at`, `task_finished_at` and `task_wall_s` when available. Inspect `jq '.results[].task_wall_s'`. | Report elapsed time alongside each task outcome. Runtime handling follows the assignment and execution state. | The fixture has no task-level wall-time field; observed PPC task durations are under 30 minutes. Its `max_seconds` timeout applies to each OMP process invocation. |
| A6 | No expected answers or rubrics in model context | Scan every system prompt and user prompt for the answer strings, the test expected values and the task3 expected total. Inspect the composer input. | No expected value, rubric or test verdict enters the model context. The composer does not read a test outcome or an expected total. | Fail: domain memory contains solution text; the composer gates on `error_total == 5`. |
| A7 | Equal oracle access in both arms | Read the baseline and PPC code. Count the selection opportunities and the oracle inputs. | The baseline and PPC arms have the same access to tests, evaluators and selection. The PPC composition uses behavioral evidence. | Fail: PPC composition uses test outcomes and the expected task3 total; the baseline has one execution. |
| A8 | Test records for tasks with oracles | `jq '.results[].tests'`; each record has command, cwd, exit code, full stdout, full stderr, start and end. | Full command and output are retained. The target and candidate run the same command in the same environment. | Partial: command, exit code and pass flag are present; output is truncated. |
| A9 | Independent assessment for the no-oracle task | A committed rubric with a hash; the reviewer identity; the scores; a statement that the rubric was not given to the model or the coordinator before scoring. | The rubric is independent and committed with the scores. The model does not see it. | Pass: `task3-rubric.md`; this review. |
| A10 | Measurement fields | `jq` checks for tokens, wall time, peak RSS, retries, test outcomes, source diffs and reviewer findings. | All fields are present. `retries` is read from the harness. `peak_rss` is per rollout. Reviewer findings are an artifact with a hash. | Fail: retries are constant zero; reviewer findings are external; peak RSS is a process maximum. |
| A11 | Workspace isolation | `probe_inherited_changes` is empty for every probe. Each probe and final has a distinct path and initial commit. | No probe or final inherits another probe's workspace. The final is a clean execution of the composed harness. | Pass for the branching arm; fail for the no-branching arm. |
| A12 | Determinism and repeatability | Two runs of the deterministic fixture. Compare patch SHA-256, test outcomes and composition decisions. Record the fixture hash. | Semantic outputs match. Timing and memory may differ. The fixture hash is recorded. | Partial: semantic outputs match; no fixture hash; the baseline and PPC used different fixture revisions. |
| A13 | Fixture version identity | `sha256sum` of `run_fixture.py`, `stub_model.py`, `omp_model.py`, `task_manifest.json` and `seed.txt` in `results.json`. | Every arm records the same fixture hash. | Fail: no fixture hash; `run_fixture.py` changed after the baseline runs. |
| A14 | Reviewer independence | The reviewer did not author the proposal, the fixture or the source map. The rubric is committed with the scores and was not given to the model or the coordinator before scoring. | The reviewer is independent. The rubric is committed and its distribution is recorded. | Pass: this evaluator did not author the fixture or map; the rubric is in `task3-rubric.md`. |
| A15 | Task difficulty and headroom | Run the baseline first. Record a task outcome for every task. | At least one task has a measurable baseline failure or partial score. The PPC arm has room to improve. | Fail: the OMP baseline passes all three tasks. |
| A16 | Reported resource measurements | `jq` the token, wall, peak and retry fields for every arm. Compute the ratios. | Report available observations and label missing fields. Runtime actions follow assignment state and actual execution outcomes. | Token, wall and peak measurements are present; retries are missing; usage fields do not affect runtime actions. |

## 5. Task3 assessment

The independent rubric and scores are in
`research/harness2-20261019/task3-rubric.md`. The rubric covers file coverage,
per-file ERROR counts, the total, timestamp citation, report completeness and
integrity. I authored it for this review and did not send it to the model or
the coordinator before assigning the scores.

Scores:

| Report | Source | Score | Acceptable |
| --- | --- | --- | --- |
| Stub baseline | `/tmp/h2study/runs/stub-all2/task3/baseline/workspace/report.md` | 56/100 | No. |
| Stub Propose-Probe-Compose, branching | `/tmp/h2study/runs/stub-all2/task3/ppc-branching/final/report.md` | 92/100 | Yes. |
| Stub Propose-Probe-Compose, no-branching | `/tmp/h2study/runs/stub-all2/task3/ppc-nobranch/probes/shared/report.md` | 92/100 | Yes. |
| OMP baseline | `/tmp/h2study/runs/omp-baseline-23/task3/baseline/workspace/report.md` | 100/100 | Yes. |
| OMP Propose-Probe-Compose final (supplementary) | `/tmp/h2study/runs/omp-all-ppc/task3/ppc-branching/final/report.md` | 99/100 | Yes. |

The OMP baseline report is acceptable. It names both supplied logs, reports
`app.log` 2 and `db.log` 3 with total 5, cites several exact timestamps from
both logs, and adds a consistent timeline and analysis. The logs are unchanged;
the source diff contains only `report.md`.

The stub Propose-Probe-Compose report is acceptable. It names both logs,
reports 2, 3 and 5, and cites the first error timestamp. It is minimal: it
cites one timestamp and gives no timeline or analysis. The stub baseline report
is not acceptable: it reads only `app.log`, reports total 2, and omits
`db.log`.

The stored OMP baseline fixture evidence says `coverage=0` and
`error_total=null`. I parsed the stored report with the current fixture parser:
`files=["app.log","db.log"]`, `counts={"app.log":2,"db.log":3}`,
`coverage=2`, `error_total=5`. The report SHA-256 in the stored result matches
the report on disk. The stored coverage value is a stale measurement from the
earlier parser. The report's assessment uses the report text, not the stale
field.

## 6. Baton source-claim verification

### 6.1 Fork-and-flush branch actions

The Fork-and-Flush paper describes forking parallel trajectories, each
inheriting the accumulated workspace and starting a fresh chat context, then
continuing from the highest-scoring trajectory. The source researcher's
mapping of Baton `branch start` to the fork-and-flush operation is accurate:
the feature doc says a private Git index snapshots tracked and nonignored
untracked files, each child gets a separate worktree at that snapshot, and each
child gets a fresh native conversation. `branch continue` dispatches to the
selected Player's existing conversation and workspace. The command names and
semantics match `baton help branch` and `branching.bend`.

Verified command names: `branch start`, `branch evaluate`, `branch status`,
`branch recover`, `branch select`, `branch continue`, `branch stop`. Verified
selection rules: automatic selection requires every branch to have successful
native settlement, no explicit stop and an accepted current evaluation with one
unique best score; ties, failures and partial rounds require
`--player PLAYER --reason TEXT`. Verified continuation rule: a stopped selected
Player requires `resume --lift-stop`. Verified retention rule: stop keeps all
branch artifacts, reports, pending input and evaluator evidence.

The source researcher correctly marks the branch feature as a design mapping at
the Baton pin. The feature commit `0464b7c65d` is not an ancestor of
`74f933480e363e808bbeae2d63edfbe6eaa0e33a`; the pinned docs do not document
the branch actions; the pinned scope record says current-main integration and
runtime qualification are pending. I did not execute a branch action.

### 6.2 Knowledge storage, elevation and traversal

Verified command names: `knowledge read`, `knowledge record`,
`knowledge relate`, `knowledge promote`, `knowledge search`,
`knowledge traverse`, `knowledge relations`. Verified scopes: `worker`,
`group`, `universal` and `all`, with an optional `--subject`. Verified
promotion flags: `--to DESTINATION --finding ID`, optional `--from SOURCE`,
`--source-kind session|group`, `--destination-kind session|group`.

The schema in `knowledge.bend:16-19` matches the map: finding, promotion and
relation tables. The scope SQL at `knowledge.bend:112-135` supports the map's
statements. Recording writes a `question` notice to the author's immediate
parent in the same transaction; a root author has no parent and produces no
notice. Promotion requires the promoter to own the destination and the source
to hold the finding through authorship or an earlier promotion to the same
endpoint kind and ID. Promotion writes a `question` notice to the destination
session or Ensemble owner. A delivery failure leaves the stored row and the
pending notice. These match `knowledge-context-2026-09-29.md` and the source
map.

The map's Knowledge mapping is accurate. The one precision issue is the
singular "Principal Conductor" phrase for universal scope. The code includes
every root conductor and conductor-role session; an empty subject selects all
root Conductors. The map's conclusion does not change.

### 6.3 Mismatches

No command-name, scope, promotion, notice or branch-semantics mismatch was
found. The confirmed mismatches are the two line-reference errors in the
Harness2 map (S7 and S8) and the universal-scope precision issue (S12). The
`baton help dispatch` conflict is an environment limitation; the source map's
dispatch claims come from the pinned docs. I reproduced the conflict.

## 7. Recommendation

Reject adoption of the Harness2 mechanisms in Baton on this evidence.

The OMP baseline passes every task. The OMP Propose-Probe-Compose arm repeats
the same pass outcomes with 3.6x to 7.2x the tokens and 4.0x to 7.2x the wall
time. The fixture's proposals and composition are deterministic; the OMP model
does not edit or compose the harness. The composition gates on test outcomes
and the expected task3 total, and the domain proposals contain task-specific
solution text. The fixture does not enforce the six-call cap or the 30-minute
task deadline, the seed is unused, and retries are not measured. The
no-branching ablation is confounded. The measured quantity is the control-flow
sequence and a repeated execution. Harness2's improvement mechanism was not
exercised.

The source map is a useful design reference. Its Harness2 claims and its Baton
Knowledge and branch semantics are accurate, with the citation errors noted
above. The map's own caveats about the unmerged branch feature, the container
boundary, the label-free contrast and the lack of a Baton editable harness tree
are the right limits.

A further prototype is justified only under the acceptance criteria in section
4. It must use model-driven proposals and composition, tasks with baseline
headroom, equal oracle access in both arms, and no expected-answer text in model
context. It should report observed model usage and elapsed time as study
outcomes. Runtime admission, continuation, completion, and validation follow
the assignment and actual execution results. The Baton-native experiments that
use existing mechanisms are a branch comparison with a deterministic evaluator
and an explicit Knowledge promotion of the resulting lesson. Those experiments can
run after the branch feature is qualified. They do not require an editable
harness tree.

## 8. What I could not verify

- Harness2 runtime behavior: no model-backed Harness2 rollout, proposer,
  selector, reflector or library update was run. The source claims come from
  code reading and the paper.
- The paper's reported scores, provenance percentages and leave-one-out gains
  were not reproduced.
- The exact model configuration of every Harness2 adapter was not traced
  beyond the paper and the channel definitions.
- The `mixed` selection pool is not built by the release; no run was available.
- The Baton branch actions were not executed. The feature is unmerged; the
  pinned scope says runtime qualification is pending.
- `baton help dispatch` returns a project/database conflict in this worktree.
  The dispatch claims in the map come from the pinned docs.
- The old fixture parser that produced the stale task3 coverage value is not
  available. The file changed after the baseline runs; I recovered the
  observable difference by parsing the stored report with the current parser.
- The OMP Propose-Probe-Compose run is a single run per task. It completed
  during this review and was not part of the assignment's named artifacts. It
  has no seed and no repeat, so it does not estimate model variance.
- The task3 assessment has one reviewer. A second independent assessor was not
  available.
- No public benchmark dataset, rubric or answer key was accessed.
- The fixture's full test output was not retained; only the recorded tails are
  available.
- The source researcher's map was complete for the Harness2 core paths. It did
  not cover the fixture or the run artifacts; those were reviewed directly.
  The branch half of the map cannot be verified at the Baton pin because the
  feature is absent there.

## 9. Reproduction commands

Source checks:

```sh
cd /tmp/h2study/upstream/harness2
git rev-parse HEAD
sed -n '619,626p' harness2/core/schedule.py
sed -n '368p;392,445p' harness2/core/recursion.py
sed -n '93,111p;360,399p' harness2/core/selection.py
sed -n '43,47p;106,150p' harness2/core/library.py
sed -n '36p;180,251p' harness2/core/recursion.py
sed -n '336,390p' harness2/core/tree.py
grep -n "context/library\|INDEX.md" harness2/core/prompts.py
```

Baton checks:

```sh
cd /mnt/nvme4tb/ci-runners/baton2-native-homelab/home/.local/share/baton2/research/harness2-20261019/worktrees/independent-evaluator
git merge-base --is-ancestor 0464b7c65d HEAD; echo $?
baton help branch
baton help knowledge-read
baton help knowledge-promote
sed -n '112,135p;296,330p;377,430p' bend2/src/coordinator/knowledge.bend
```

Fixture checks:

```sh
cd /mnt/nvme4tb/ci-runners/baton2-native-homelab/home/.local/share/baton2/research/harness2-20261019/project/research/harness2-20261019/fixture
grep -n "max_calls\|max_seconds\|retries\|task_seed" run_fixture.py
grep -n "error_total == 5\|DOMAIN_MEMORY" stub_model.py
grep -n "deepseek\|no-skills" omp_model.py
jq '.results[].turns' /tmp/h2study/runs/omp-all-ppc/results.json
jq '.results[].probe_inherited_changes' /tmp/h2study/runs/stub-all2/results.json
jq '.results[1].evidence' /tmp/h2study/runs/omp-baseline-23/results.json
```

Task3 parse check:

```sh
cd /mnt/nvme4tb/ci-runners/baton2-native-homelab/home/.local/share/baton2/research/harness2-20261019/project/research/harness2-20261019/fixture
python3 - <<'PY'
import sys
sys.path.insert(0, ".")
from run_fixture import parse_report
from pathlib import Path
for name, path in {
    "stub-baseline": "/tmp/h2study/runs/stub-all2/task3/baseline/workspace",
    "stub-ppc": "/tmp/h2study/runs/stub-all2/task3/ppc-branching/final",
    "omp-baseline": "/tmp/h2study/runs/omp-baseline-23/task3/baseline/workspace",
    "omp-ppc-final": "/tmp/h2study/runs/omp-all-ppc/task3/ppc-branching/final",
}.items():
    r = parse_report(Path(path))
    print(name, r["files"], r["counts"], r["coverage"], r["error_total"], r["has_timestamp"])
PY
```
