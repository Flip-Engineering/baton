# Reviewing and promoting a worker finding into the lead scope

A worker records an evidence-backed finding as a candidate. The lead
reviews the cited evidence, explicitly promotes the exact finding into
the lead scope, accepts the destination-owner promotion notice, and
chooses which worker retrieves it. Each stage leaves its own stored
evidence: a finding row, a promotion row, a message receipt, a read
answer, or a landed change. A receipt binds to one retained message;
the `knowledge` read answers with a JSON array and the `promote`
command answers with the stored promotion row, and neither answer is a
message, so neither carries a receipt.

`AUTHOR`, `READER`, `PROMOTER`, `SOURCE`, and `DESTINATION` are declared
identifiers. The commands check them against recorded sessions and
parentage inside the trusted local database. Those checks identify
inconsistent requests. They do not authenticate the process making the
declaration.

The canonical contract for the three operations, visibility rules, read
fields, and the destination-owner notice is
[Findings and shared context](../knowledge-context-2026-09-29.md). The
behavior is implemented in
[knowledge.bend](../../../bend2/src/coordinator/knowledge.bend), with the
session instruction text in
[receive.bend](../../../bend2/src/coordinator/receive.bend) and command
dispatch in
[commands.bend](../../../bend2/src/coordinator/commands.bend).

## 1. Worker records a candidate finding

The worker cites a retained message it sent or received. `EVIDENCE`
accepts only `message:<ID>`, and recording checks in the same
transaction that the message exists and that the declared author is its
sender or recipient.

```sh
baton2 state.db record hierarchy-check-finding deepseek "CHECK passes for the selected file" message:deepseek-turn "Selected checks only; see cited message for paths and output"
baton2 state.db inbox lead
baton2 state.db ack hierarchy-check-finding:notice lead lead-reviewed
```

Recording writes the finding and a `question` notice to the author's
immediate parent in one transaction, then delivers the notice and
answers with the stored finding row. The notice body holds only
`{finding, author}`. The parent retrieves the full record through
`knowledge`. The `ack` receipt on `FINDING:notice` records that the lead
accepted that particular retained message. The receipt and the promotion
are separate records: the receipt covers the notice message, and the
stored promotion below records the declared sharing decision with its
actor and scope provenance.

## 2. Lead reviews the evidence and promotes the exact finding

The lead reads the finding through `knowledge` and resolves the cited
message body, the Git commit and path identities it carries, and the
stated limits before promoting.

```sh
baton2 state.db knowledge lead
```

Each read row carries `id`, `author`, `claim`, `evidence`,
`evidenceMessage`, `limits`, `destinations`, and `promotions`.
`evidenceMessage` exposes the cited message's `id`, `sender`,
`recipient`, and `body`. Each promotion names `finding`, `author`,
`source`, `destination`, and `promotedBy`. The lead resolves the source
scope that currently carries the finding (the worker scope for a
candidate) and the evidence paths named in the message body.

Promotion names the exact finding, the source scope, the destination
scope, and the promoting actor. The promoter must be the destination
scope's owner, and the source must carry the finding. Original
authorship is preserved: the stored promotion keeps the finding's
`author` alongside `promotedBy`.

```sh
baton2 state.db promote hierarchy-check-promotion lead deepseek lead hierarchy-check-finding
```

The command writes the promotion and its destination notice in one
transaction, delivers the notice, and answers with the stored promotion
row naming `finding`, `author`, `source`, `destination`, and
`promotedBy`. That stored row is the evidence of the sharing decision.

## 3. Destination owner accepts the promotion notice

The promotion writes a `question` notice to the destination scope's
owner in the same transaction. Its identity is
`PROMOTION_ID:promotion-notice`, and its body names `promotion`,
`finding`, `author`, `source`, `destination`, and `promotedBy`.

```sh
baton2 state.db inbox lead
baton2 state.db ack hierarchy-check-promotion:promotion-notice lead lead-accepted-promotion
baton2 state.db knowledge lead
```

The `ack` receipt on `PROMOTION_ID:promotion-notice` records that the
destination owner accepted that particular retained message. The
follow-up `knowledge` read confirms the finding is now readable in the
destination scope with its evidence message body and full promotion
provenance. Readers obtain the claim, the cited retained message, the
limits, and the promotion history through `knowledge`; review notices
identify a finding for retrieval and carry no copied claim body.

## 4. Destination owner chooses the retrieving worker

Promotion makes the finding readable within the destination scope. The
destination owner decides which workers receive a message about it. Each
worker notification is a separate orchestrator action.

```sh
baton2 state.db message muse-retrieval lead muse guidance "Retrieve hierarchy-check-finding with knowledge muse and apply it to your assigned files"
baton2 state.db knowledge muse
```

The worker retrieves the finding with its own `knowledge` read, which
returns the complete visible list including the evidence message body
and promotion provenance. The worker's subsequent report and its
task-specific file changes establish what it retrieved and how it used
the finding.

## 5. Concrete case: stored absence after a reviewed correction landing

Finding `hierarchy-check-finding-2` (author `deepseek`, retrieved through
`knowledge muse` from the `lead` scope, promoted `deepseek` to `lead` by
`lead`) carries this observation: the `verify_landings` correction
contract in `bend2/scripts/accept-kimi-hierarchy.py` treats a landed
deletion differently from an unlanded one. The cited evidence message is
`message:hierarchy-check-evidence-2` (sender `deepseek`, recipient
`lead`). Its stated limits cover the private two-worker Git fixture and
the check-unittest adapter, not production landing paths or live
recruitment.

A worker that deletes its assigned file and lands the deletion through a
reviewed correction retains the stored absence at three places: the
worker branch tip, the selected successful receipt commit, and the final
target. The peer file keeps its landed content and mode at the final
target. Absence here is a stored fact (`git ls-tree` returns no entry),
confirmed at the landed commits, not a claim from the worker report.

A worker deletion made after the last successful landing fails the same
check. The worker tip stores no entry while the selected receipt and the
target still store the assigned blob, and verification refuses with
`Worker correction was not landed`. The judgment compares stored entries
at the worker tip, the selected receipt commit, and the target tip: the
worker tip stores absence while the selected successful receipt and the
final target store the file entry.

Two successful receipts also fail when their commits are both ancestors
of the final lead but neither is an ancestor of the other, even when
every receipt commit, the worker tip, and the target tip store the same
assigned content. The retrieved finding documents the isolation control
as an in-process control that replaced only the driver's
divergent-history guard: with that replacement, the same fixture
verified successfully, so that guard is the recorded cause of the
refusal.

The finding ties the judgment to executed selected checks run at the
cited commits: `python3 bend2/test/accept-kimi-hierarchy.py` (14 tests,
OK) and `python3 bend2/test/check-unittest.py` (13 tests, OK), with
`git diff --check` exiting 0. A reusable check therefore asserts three
things together: the stored entries at the landed commits, the refusal
text for the unlanded case, and the executed selected checks at the
cited source.

## What each record establishes

| Stage | Record | Establishes |
|---|---|---|
| Candidate recording | Stored finding with original author, evidence reference, and limits | The worker stated a claim with cited evidence and limits |
| Reviewed promotion | Stored promotion with finding, author, source, destination, and promoting actor | The lead declared the sharing of that exact finding into the lead scope; the actual evidence review is established separately by retained native reads and tool results |
| Owner-notice acceptance | Receipt on `PROMOTION_ID:promotion-notice` | The destination owner accepted that particular notice message |
| Retrieval | Worker's `knowledge` read output | The worker obtained the claim, cited message, limits, and promotion history |
| Task-specific use | Worker's report message and landed file changes | The worker applied the finding to its assigned work |

Recording, reading, reporting, acknowledging a message, and completing a
turn do not promote a finding. Consumption is established by the
worker's retrieved read together with its report and landed changes.
