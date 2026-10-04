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
  parent-scope read path. audit-kimi additionally promoted the finding from
  scope audit-evidence into scope audit-kimi during its receive turn, so the
  author read now lists destination `audit-kimi` with that promotion.
  Full post-record output is stored in `logs/evidence-knowledge-verify.txt`.

Limits of the first observation: one finding and one promotion said nothing
about filter behavior at scale or about multi-hop promotion-chain visibility.

Extended measurement with two findings in two scopes: the corpus now also
holds root's `audit-root-identity-refusal` (author audit-root, evidence
`message:audit-kimi-guidance-1`, promoted into audit-root scope as
`audit-root-promote-identity-1`). Native reads run after that promotion:

- `baton2 $DB knowledge audit-evidence` returned both findings, each with
  author, claim, limits, evidence reference, full evidence message, and
  promotion history.
- `baton2 $DB knowledge audit-kimi` and `baton2 $DB knowledge audit-root`
  returned the same two findings.

The scope rule explains each result: audit-evidence reads its own finding as
author; it reads the root finding as a member of the audit-root scope, which
counts every session in the owner's subtree, and audit-evidence sits in that
subtree. audit-kimi reads the evidence finding as the author's immediate
parent and through its promotion into audit-kimi scope. Full output is stored
in `logs/evidence-knowledge-two-scope.txt`.

Retrieval correctness for the dispatch-refusal repair: the read surfaces
`audit-root-identity-refusal` (GLM dispatch refused by the configured
identity helper before native startup) next to the unrelated measured-use
finding, with the cited guidance message (audit-root to audit-kimi) and
limits attached, which is enough to use the finding correctly and to avoid
confusing it with the unrelated one.

Conclusion: the successful small-corpus read justifies no query filter. The
complete read of two findings is short and each finding carries its own
evidence and limits. Limits: two findings, two promotion destinations, no
multi-hop chain, no scale observation.

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

Scope correction: the "no usage fields exist" claim above was scoped to the
DB schema and the Muse native log. It does not cover the persisted OMP
session sources, which do carry typed usage records.

Extended measurement of the three persisted OMP session files (field and
type records only, stored in `logs/evidence-omp-usage-fields.txt`; no
conversation prose extracted):

- Every assistant message record carries `message.usage` with integer
  `input`, `output`, `cacheRead`, `cacheWrite`, and `totalTokens`, plus a
  `cost` object with `input`, `output`, `cacheRead`, `cacheWrite`, `total`.
  `totalTokens` equals the four token parts in every record checked on all
  three routes, so it is derived, and a projection must not sum it with the
  parts. `cacheWrite` is 0 in every record observed.
- Provenance travels with each record: `message.model`, `message.provider`,
  `message.api`, `role` (`assistant` throughout), plus outer record `id` and
  `message.responseId`, all distinct per record, so no duplicate or replayed
  usage records were observed.
- Per-message values, not cumulative: `input` is not monotonic across any
  file (kimi first 23680, last 392; deepseek first 29910, last 200; glm
  first 28711, last 711). Per-message totals can be summed across a
  conversation; cumulative values would double-count, and none were found.
- `reasoningTokens` (integer) appears on most deepseek (160 of 195) and glm
  (33 of 40) records and on no kimi record; its relation to `output` is not
  established from the bytes, so a projection must carry it separately and
  must not add it into any total.
- Cost components: deepseek records carry nonzero float components with a
  nonzero `total` on all 195 records. Kimi (103 records) and glm (40 records)
  carry integer zero components. No record labels a currency unit; the only
  currency/price/USD strings in the files sit inside conversation prose, not
  usage metadata. A zero cost component cannot establish free or no charge,
  and the unit-less float cannot be labeled USD.

Per-route table (counts as of measurement; the files are live and append):

| Route | Records | Token fields | reasoningTokens | Cost components |
| --- | --- | --- | --- | --- |
| audit-kimi (kimi-code/k3, anthropic-messages) | 103 | int input/output/cacheRead/cacheWrite/totalTokens | absent | int zeros |
| audit-native (deepseek/deepseek-flash, openai-completions) | 195 | int input/output/cacheRead/cacheWrite/totalTokens | present on 160 | nonzero floats |
| audit-surface (zai/glm-5.3-flash, openai-completions) | 40 | int input/output/cacheRead/cacheWrite/totalTokens | present on 33 | int zeros |

Conclusion: the source structure supports an honest minimal native read
projection of the recorded conversation: per-message token parts summed
without the derived total, reasoning carried separately, cost components
passed through with their provenance, unknown and zero preserved as
recorded, no billed amounts claimed. This supersedes the initial limited
conclusion for OMP routes; the DB-schema and Muse-log observations stand.
Limits: live append-only files, three OMP routes, one run; no billing
reconciliation; currency unlabeled.

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
- Finding correction/supersession relation. The corpus holds 3 findings and 2
  promotions (audit-kimi-promote-1, audit-root-promote-identity-1); no reader
  used a superseded claim. The two-scope reads in section 1 ran when the
  corpus held 2 findings. A stored correction
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
That finding is immutable evidence and is left unchanged.

## 6. Corrected finding record

Finding `audit-evidence-measured-use-2-2026-10-04`, authored by
audit-evidence, cites this lane's extension report message
`audit-evidence-report-2` as evidence (`message:audit-evidence-report-2`).
Claim: two-scope knowledge reads return both findings with evidence and
promotion history to author, parent, and root scopes, so no query filter is
justified at this corpus size; persisted OMP session files carry typed
per-message usage (integer token parts with derived `totalTokens`,
`reasoningTokens` on deepseek/glm, nonzero float cost only on deepseek, no
currency label), which supports an honest unknown-preserving read
projection. Limits: two findings, two promotions, three OMP routes in one
run; live append-only session files; no billing reconciliation; no
multi-hop chain or scale observation; original finding left immutable.
Recording this finding brings the corpus to 3 findings.
