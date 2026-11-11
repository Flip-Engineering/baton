# Hierarchy checker repair

## Observed failure and repair

Issue #645 was reproduced at `46f1b86eb8f50ea2fe087b67f72b43c081eadc4a`.
The hierarchy driver generated a CHECK that created `.scratch/bend2` and ran
`python3 "$1"`. DeepSeek invoked that exact checker on `bend2/test/receive.py`
in a fresh private tree with no coordinator. It exited 0, with empty stdout and
140 bytes of stderr reporting 28 skipped tests. Every selected test skipped
before its body ran.

The [repaired driver](../../bend2/scripts/accept-kimi-hierarchy.py) generates a
checker that resolves `bend2/scripts/check-unittest.sh` inside the checked tree
and supplies the compiler recorded by the coordinator build. That existing
adapter builds the selected tree's coordinator and refuses skipped or empty
selections as unjudged. Its build retains the coordinator entry's law imports.

The worker committed `ec76a88d642cd88e6d4c7a494fd38bb910012c67`, changing only
the driver and its test file. Eleven hierarchy tests passed, including actual
selected-body execution, skipped and empty selection refusals, and a fresh
native tree that built its coordinator and executed the receive selection.
Thirteen adapter tests passed after creating their existing scratch-directory
prerequisite. The initial missing-directory test failure remains retained.

Kimi reviewed the evidence and code, then ran `land-checked` for the worker onto
`hierarchy-lead` at `d75d09d5b106ecf9fb1b85d82350b495b94c2988`. The landing
checked both selected suites on the candidate and baseline; its assigned file
contents match the worker commit. Independent review passed the two-file repair.
Root consolidated it as `47f5f82119fe56497d99a19bb2ce977e5c33b3f7`.

## Native orchestration and knowledge review

The run requested subscription Codex `gpt-6-astra` low, OMP `kimi-code/k3` high,
OMP `deepseek/deepseek-flash` low and Muse `muse-spark-1.3-contributor` low.
The coordinator recorded the observed OMP models and retained native identities.
Its observed-effort fields remained empty. Codex launch arguments forced the
ChatGPT login and removed API-key environment variables.

DeepSeek received successful native guidance after its first tool call and
before completion. It retained `hierarchy-check-evidence`, then recorded
`hierarchy-check-finding` with its own authorship, evidence reference and limits.
The candidate's `hierarchy-check-finding:notice` requested parent review.

Kimi resolved the source identities and complete evidence files, explicitly
promoted `hierarchy-check-review` from `deepseek` into `lead`, inspected
`hierarchy-check-review:promotion-notice` and acknowledged it. That destination
owner notice retained the original author and source/destination coordinates.
These actions occurred in Kimi's existing native conversation. The raw lead
report's name for the candidate notice is corrected here; both immutable rows
remain retained.

## Failed hierarchy acceptance

Muse exited 1 after 0.448 seconds with `missing meta credentials`, producing
zero native frames and no native identity. It produced no draft, retrieved no
finding and supplied no landing. A working Muse login is required for a fresh
two-worker acceptance run.

Kimi reported the partial results and credential blocker. Codex resumed its
original native conversation, independently resolved the Muse error and
reported `hierarchy-failed`. The private target remained at the initial source;
no root landing or successful hierarchy evidence was produced. Root reviewed
and acknowledged that terminal failure. All thirteen messages have receipts.

Five captured native invocations completed: two root turns, one Kimi turn, one
DeepSeek turn and the failed Muse launch. Every captured wrapper and child PID
was absent after completion. Metadata start to final native exit was 862.950
seconds. Retained native frames total 4,924,419 bytes and event indexes 100,360
bytes. The [machine evidence](measurements/2026-10-01-hierarchy-checker.json)
pins the source, compiler, executable, findings, notices, receipts, landing and
retained artifact hashes.

The running driver kept its original checker. Fresh fixtures and regression
tests exercised the repaired generated checker. This attempt supplies a checked
worker landing and native knowledge review; successful worker concurrency,
Muse consumption and root checked landing remain unproved by this attempt.

The existing capture forwards OMP `message_update` frames to the coordinator
and omits them from the retained native frame file. OMP tool previews shortened
long JSON lines; Kimi separately resolved the evidence files before promotion.
The Muse launcher's underlying auto-updating payload was not pinned at failure.
Codex events establish its conversation identity without an observed model.
