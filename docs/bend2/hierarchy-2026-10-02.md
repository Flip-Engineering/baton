# Native Kimi hierarchy and shared finding acceptance

The run from published source `2264ebc2055a5fd756f3b505d7bd7be6b5e65e3e`
completed a Codex root, an OMP Kimi lead, concurrent DeepSeek and Muse workers,
mid-task guidance, reviewed worker landings, shared finding promotion and use,
and a reviewed root landing onto an isolated `bend2-trial` branch. The driver
exited 0. The run made two useful repository changes: three real-Git correction
landing tests and a [shared finding review example](examples/shared-finding-review.md).

The coordinator was built from the selected clone with Bend 2.0.25. Its binary
SHA-256 was `8aa2ac152783febdf6d3193b5caa432adc84f66a2f0131ef70dbd69e22e8c83a`.
The published dispatch source had passed the native build, negative controls
for 328 proofs and 77 implementation mutations, and the native test suite.
This contribution changes tests, documentation and command-failure diagnostics;
the operative coordinator functions and laws are unchanged.

## Native identities and concurrent work

| Session | Parent | Harness and model | Native conversation |
| --- | --- | --- | --- |
| root | none | Codex, requested `gpt-6-astra` | `01a0fa8e-4acb-7a00-ab6d-783c4f40050e` |
| lead | root | OMP, observed `kimi-code/k3` | `01a0fa8e-b68e-7000-97b1-fa3b83a32d10` |
| deepseek | lead | OMP, observed `deepseek/deepseek-flash` | `01a0fa90-d0eb-7000-8603-6e8f261c592f` |
| muse | lead | Muse, observed `muse-spark-1.3-contributor` | `01a0fa90-d052-74e0-bce0-667d5da49404` |

Codex login preflight reported ChatGPT authentication. Its launch wrapper
cleared API-key variables and selected subscription login. Codex events supplied
the conversation identity and usage counters; its model is the invocation's
requested model. Harness and effort values in the session bindings are declared
values. The retained OMP and Muse events supplied the observed models above.
The native executables were Codex 0.154.0, OMP 17.4.0 and Muse 1.4.2-R4684.1.
Muse automatic update was disabled for the pinned run.

`concurrent-native-processes.json` records live native OMP child 11374 and Muse
child 11375 together. Their initial invocation lifetimes overlapped for
173.245 seconds. This establishes overlapping native work; it does not measure
simultaneous provider computation. The lead sent `unexpected-success-guidance`
after DeepSeek's first native tool event and before its terminal event. The
stored native receipt names `command: steer` and `success: true`.

There were 27 completed zero-exit invocations: root 13, lead 9, DeepSeek 2 and
Muse 3. Each session resumed its original conversation. The retained run
timeline lasted 61 minutes 22 seconds after the build. It includes review and
correction work; build duration was not retained. External reviewers sent
three retained operator questions covering document semantics, the divergent
history fixture, and final document wording. The trial root acknowledged and
forwarded each through the lead. These interventions are part of this run.

## Repository changes, review and landings

DeepSeek added behavior coverage to `bend2/test/accept-kimi-hierarchy.py`:

- A successfully landed deletion stores absence at the worker, selected receipt and final
  target, with the peer file preserved at the target.
- A deletion after the last successful landing is refused as an unlanded correction.
- Two otherwise valid successful receipts with divergent histories are refused.

Independent review found that the initial history fixture also differed in
assigned file content. The corrected source `af59ad7d` restores that content
before selecting both receipts. Both receipts are lead ancestors and neither is
an ancestor of the other. An in-process control replacing only the history guard
accepted the same fixture. The source and control therefore isolate that refusal
for the private fixture.

The first correction landing returned a Git conflict and left the lead target
unchanged. The lead merged its reviewed branch into the worker branch and
landed the preserved test bytes. The first conflict response is retained in a
review checkpoint with its original native frame offset and hash.

| Contribution | Reviewed source | Final selected checked landing |
| --- | --- | --- |
| DeepSeek tests | `af59ad7d5375cc8700d74fda6fdfadda9db7254b`, preserved at worker merge `f1ada80e5dd349af55a8977c9b1372693180991b` | `bae27a2474a028b294dae6a075d78037ed149965` on `hierarchy-lead` |
| Muse document | `d29ff2e1d959b795c4a81760c1e1fba4fe0e056e`, preserved at worker merge `d5fb860c2232cf8b64d2938cb7362a726e23bae0` | `e6a96e5d6f0e82eef17ea006fc88564871b046a6` on `hierarchy-lead` |
| Composed lead | `e6a96e5d6f0e82eef17ea006fc88564871b046a6` | `4d61cf573ac502aa4697ee55d7f65f2038eb6da1` on `bend2-trial` |

The trial root inspected actual source diffs, stored Git entries, native review
operations, session bindings, receipts and evidence preservation before landing.
It ran the selected hierarchy and check-adapter suites on the composed lead and
landed target; 14 hierarchy tests and 13 adapter tests passed. Lead and target
trees equal `e9a74d925b8ca23b9b23cec75bcc77d10d59a1d5`. The final diff contains
only the assigned test and document. Original sources, findings and successful
landing receipts remain available.

## Shared finding promotion and consumption

DeepSeek recorded `hierarchy-check-finding-2` with retained message evidence
`message:hierarchy-check-evidence-2` and explicit private-fixture limits. Kimi
read the evidence and promoted that exact finding through
`hierarchy-check-review-2` from `deepseek` to `lead`, preserving original
authorship and recording the promoting actor. Kimi read and acknowledged the
distinct destination-owner notice `hierarchy-check-review-2:promotion-notice`.

Kimi separately sent Muse a request naming the finding, source scope and required
use. It supplied no copied claim, result, commit hash or evidence hash. Document
review instructions traveled in separate retained questions. Muse resumed its
original conversation, used `knowledge muse`, saved the complete visible list,
selected the exact finding, and opened its four fresh evidence paths.

The full 11,420-byte retrieval array has SHA-256
`0674e0202400b75392f166897391358f28a030f1813dc9668c8a7c295eb635bc`.
The 5,999-byte selected item has SHA-256
`1ff42149cc1da0c9ee22d472fd7a1432b8f34c1835938534d74e9a36b8602176`.
Independent review compared every parsed finding field and the complete cited
message body with coordinator storage. These are distinct file hashes. Muse's
native evidence reads and final document establish actual use of the stored
absence, unlanded deletion and isolated history-control observations.

The final document states the trusted declared-identity boundary, separates
promotion provenance from evidence review, and bounds peer preservation to the
tested final target. Its SHA-256
`d9017dde8af49a708caa31e8d4f2b1bd72cbfa4642f23e4ff61790ccf87780de`
matches the reviewed source, worker, lead and root target.

## Verification, artifacts and limits

The invocation was:

```sh
python3 bend2/scripts/accept-kimi-hierarchy.py \
  --config .scratch/cutover-hierarchy-preparation-20261002/routes.json \
  --tasks .scratch/cutover-hierarchy-preparation-20261002/tasks.json \
  --source "$PWD" \
  --revision 2264ebc2055a5fd756f3b505d7bd7be6b5e65e3e \
  --output .scratch/cutover-hierarchy-run-20261002
```

The retained run directory contains `evidence.json`, `state.db`, the private
repository and worktrees, `root-report.md`, selected-check logs, native streams,
process metadata, all landing receipts and independent review checkpoints.
`evidence.json` has SHA-256
`4245e5d2abd11a893ff37cda5705265a319ce4d8b7efb1f1a6c918ef7056bec2`.
The raw root report records the pre-landing target in its first commits table;
the final target is the subsequent explicit root receipt shown above.

The lead wrote `/tmp/lead-knowledge.json` outside the requested run directory.
The root retained and reported that operation. This run establishes the listed
workflow and source changes; it does not establish filesystem confinement or
adversarial authentication. It exercises three hierarchy levels and two workers.
It made no remote push and performed no resident cutover or host reboot.

The external root also repaired a measured command-diagnostic cutoff: the
acceptance command helper retains complete captured stdout and stderr in the error.
Three real child-process tests cover long Unicode output, stdout-only failure
and successful output handling. This repair changes the acceptance helper.

Publication of the composed source requires `build-native.sh`, `laws-check.mjs`
and `check-native.sh` on the same committed clean tree. Exact gate summaries and
publication receipts are retained under `.scratch/root-handoff-20260928/`.
