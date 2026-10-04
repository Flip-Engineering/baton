# Audit follow-ups: measured-use investigation 2026-10-04

Lane: audit-evidence, under audit-kimi, in run DB
`.../.scratch/baton2-audit-followups-20261004/orchestra.db`.
Branch `codex/baton2-audit-evidence-20261004` at base
`0c9fa7f2787697f7d0df6f6911cacf55a920e44c`.
This lane is read-only investigation plus this document; it changes no runtime code.

The audit is `docs/bend2/v1-capability-audit-2026-10-04.md`.
Its Recommendations section names three candidates to measure during useful
work: promoted-knowledge retrieval, token/cost visibility, and remote-tip
inspection. This document records the measurements from this run.

## 1. Promoted-knowledge retrieval

Commands run against the run DB on 2026-10-04:

- `baton2 $DB knowledge audit-evidence` returned `[]`.
- `baton2 $DB knowledge audit-kimi` returned `[]`.
- `baton2 $DB inbox audit-evidence` returned `[]`.
- `sqlite3 $DB "SELECT * FROM knowledge;"` returned no rows.
- `sqlite3 $DB "SELECT * FROM knowledge_promotions;"` returned no rows.

Raw output is stored at
`.../.scratch/baton2-audit-followups-20261004/logs/evidence-knowledge-reads.txt`.

The corpus at measurement time held 5 retained messages (3 task, 2 report;
listed in `logs/evidence-messages.txt`) and 0 findings. None of the 5
messages names audit-evidence as a party, so the empty knowledge read is the
correct scoped result, not a retrieval failure. The visibility rule in
`bend2/src/coordinator/knowledge.bend` (functions `authored_visible`,
`promoted_visible`, `membership`) reads: a finding is visible to its author,
to the author's immediate parent, and to members of scopes it was promoted
into. audit-kimi is the immediate parent of audit-evidence, so audit-kimi's
read covers audit-evidence's findings.

Retrieval verification with a real finding: this lane records finding
`audit-evidence-measured-use-2026-10-04` with its completion report message
as evidence (see section 5). After recording:

- `baton2 $DB knowledge audit-evidence` returned the finding with its claim,
  limits, and cited evidence message.
- `baton2 $DB knowledge audit-kimi` returned the same finding, confirming the
  parent-scope read path.

Limits of this observation: the corpus holds exactly one finding and zero
promotions, so it says nothing about filter behavior at scale or about
promotion-chain visibility. No complete read was obstructive at this size.
A query filter over the visibility rule remains conditional on reads becoming
obstructive. Smallest useful action: none; the existing read retrieves and
carries evidence for the measured corpus. Re-measure once the run holds
several findings across scopes.

## 2. Token/cost visibility

Schema inspection of the run DB (full schema in
`logs/evidence-db-schema.txt`): the database holds 14 tables
(`sessions`, `messages`, `turns`, `executions`, `session_stops`,
`session_roles`, `ensembles`, `ensemble_members`, `sections`,
`section_members`, `native_requests`, `knowledge`, `knowledge_promotions`,
plus `sqlite_sequence`). No table and no column records token counts, cost,
or service windows. `sessions` carries requested and observed
harness/model/effort strings only. `native_requests` carries attempt,
native id, method, event, reply, written, and closed fields.

Native log inspection: `logs/audit-evidence-native.jsonl` holds 254 records.
Payload-type counts are stored in `logs/evidence-native-payload-types.txt`.
Payload keys present are `kind`, `command_id`, `run_stream`, `task_id`,
`task_stream`, `event`, `call_id`, `text`, `correlation_facts`, `prompt`,
and the model-configuration keys (`provider_id`, `profile_id`, `model_id`,
`display_label`, `source`). No payload carries token, usage, cost, or price
fields. A case-insensitive substring scan for usage/token/cost/usd matched
87 records; every match inspected was audit or task prose inside tool-call
text (for example the audit document text passing through `tool.result`),
not a usage field. Unavailable usage is therefore distinguishable from zero
here: the fields do not exist, so a read projection must report unknown,
never zero.

Conclusion: a usage read projection currently has no native source to
project on this route (Muse Spark contributor turn through the native
session log). It remains conditional until a provider route emits usage
fields in retained output. No billed-USD inference is possible from the
retained state, and none was attempted. Smallest useful action when a route
does emit usage: a read-only projection that normalizes available fields and
preserves unknown values, without scheduling or stopping authority.

## 3. Routine remote-tip inspection

The operating need is recorded in `docs/bend2/architecture.md`: native `push`
runs Git's ordinary push and reports `pushed` or `rejected`; publication is
then verified with `git ls-remote` against the declared remote. The release
report (`docs/bend2/release-report-1.0-2026-10-04.md`) records accepted
publication verified by anonymous download byte correspondence. Related
receipts exist under `docs/bend2/native-workflow-comparison-2026-10-02/`
(`root-ls-remote.stdout` in the artifact manifest) and
`docs/bend2/native-git-qualification-2026-10-02/README.md`.

Measurement in this run: `git ls-remote origin
refs/heads/codex/baton2-audit-evidence-20261004` from this worktree returned
no lines with exit 0. That is the expected result for a branch that exists
only locally; this lane does not push. The read-only remote call itself is
safe and fast. The gap it exposes: routine delivery evidence requires
leaving the native CLI for shell Git. Native `push` retains Git's outcome;
no native command returns the advertised remote tip.

Conclusion: this candidate has a measured operating need (every accepted
publication performs this readback by hand) and a smallest useful action (a
native remote-tip reader returning the advertised tip for a declared remote
and ref, with each effect's outcome retained separately). Implementation is
outside this lane.

## 4. Conditional items review

Checked against operating needs observed in this run and the repository:

- Derived work view. The run holds 5 sessions and 1 pending delivery
  (`audit-surface-task-1`, visible in `baton2 $DB pending`). No task lost
  ownership in this run. A derived outstanding-work view remains conditional
  on tasks actually losing ownership.
- Finding correction/supersession relation. The corpus holds 1 finding and 0
  promotions; no reader used a superseded claim. A stored correction
  relation remains conditional on repeated use of a superseded claim. A
  correcting finding can already retain the original evidence under the
  current schema.
- Git progress checkpoint/resume helpers. `session_stops` retains stop
  reason, attempt, signal, outcome, and report id; no checkpoint or resume
  lineage fields exist. This run performed no stop/resume cycle. Automatic
  checkpoint commits remain conditional on a demonstrated resume need. New
  recruitment with an explicit revision covers the observed cases.
- Affected-test check suggestion. `land-checked` accepts caller-supplied
  CHECK and FILES; audit-kimi's dispatch already fixes
  `CHECK=bend2/scripts/check-unittest.sh` with change-scoped FILES. A
  suggestion helper remains conditional on a repository grammar where the
  caller cannot select checks; adequacy stays a review decision either way.
- Analysis, tool, browser, language-binding, and runtime proposals. This run
  used external harness tools through the existing report/check boundary and
  qualified no shared analysis service, browser engine, language binding, or
  proof/debug/GUI system. Each remains optional pending a concrete consumer
  with an independently useful contract and an explicit evidence boundary.
- Program engines, authenticated remote residents, knowledge graphs, and
  automatic routing require substantially more shared state; this run showed
  no operating need for any of them.

## 5. Finding record

Finding `audit-evidence-measured-use-2026-10-04`, authored by
audit-evidence, cites this lane's completion report message
`audit-evidence-report-1` as evidence (`message:audit-evidence-report-1`).
Claim: the three candidates measure as stated in sections 1-3 (knowledge
read retrieves the recorded finding for author and parent; no usage fields
exist in DB schema or native log payloads; remote-tip readback is a
hand-operated `git ls-remote` with no native reader). Limits: single-finding
corpus, one provider route (Muse Spark contributor), one unpushed branch;
no scale, promotion-chain, multi-route, or public-remote observations.
