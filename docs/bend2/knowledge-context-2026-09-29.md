# Findings and shared context

## Decision and implementation status

Following the operator question about shared knowledge, the root assigned three
coordinator operations on 2026-09-29 under #642: record a finding, read visible
context, and explicitly promote an exact finding. Agents generate findings and
review their evidence. The coordinator stores the records and applies visibility
and promotion rules.
These operations are planned; published `4676778a` implements sessions,
messages and turns, without this knowledge workflow.

This decision amends the knowledge-store omission in
[the current architecture](architecture.md) and
[target architecture](target-architecture.md). The accepted design at
`671d6f058daa72cf7ed5f9551c7c2934f9502631` replaced the earlier migration plan
with the native-root workflow in [the mandate](MANDATE.md). Its initial
omissions were explained further at `6ad0920e`. The present addition serves a
newly requested workflow within that simpler design.

The earlier [F4 condition](architecture-review.md#f4-merge-plan-workflow-wave-and-swarm-scheduling)
records explicit promotion, attribution and reader-relative views.
[ARCH-CLOSE-08](arch-close-status.md) retains its historical open evidence
statement. This addition does not restore the old graph design or migration
phase gates. Its acceptance is the concrete workflow below.

## Records and visibility

The root froze the first-slice command contract as v3 on 2026-09-29.
The API contract is stable; feature publication and acceptance remain pending.
The command forms are:

```text
baton2 DATABASE record FINDING_ID AUTHOR CLAIM EVIDENCE LIMITS
baton2 DATABASE knowledge READER
baton2 DATABASE promote PROMOTION_ID PROMOTER SOURCE DESTINATION FINDING
```

`AUTHOR`, `READER`, `PROMOTER`, `SOURCE` and `DESTINATION` name coordinator
sessions. `FINDING` names an existing finding. Promotion explicitly names its
source and destination scopes and retains the finding's stored provenance.
These argument names describe declared actors under the trusted-local boundary
below.

A finding preserves its immutable claim, original declared author, source scope,
evidence references and stated limitations. A correction creates a new finding
that identifies the earlier one. Promotion names the exact finding, source and
destination scopes, and declared promoting actor. It preserves the finding's
evidence and original attribution. A retry with the same operation identity and
meaning returns the recorded result; conflicting reuse states the conflict.

Scopes use the existing coordinator session parentage:

| Record | Visible to |
| --- | --- |
| Candidate finding | Its author and the author's immediate reviewing parent. |
| Finding promoted to a shared scope | The owning session, its immediate parent, and its subtree. |

The destination owner promotes a source it can read. Promotion checks membership
in the named source scope. For an unpublished candidate, the promoter must be
the author or the author's immediate parent. Wider sharing requires another
explicit promotion. Recording, reading, reporting, acknowledging a
message and completing a turn do not promote a finding. `knowledge READER`
returns the complete visible list, including each finding's evidence message body
and full promotion provenance. A fresh or restarted worker can retrieve records
independently of its native conversation memory and whether review messages were
acknowledged.

Read rows carry `id`, `author`, `claim`, `evidence`, `evidenceMessage`, `limits`,
`destinations` and `promotions`. `evidenceMessage` exposes the referenced message's
`id`, `sender`, `recipient` and `body`. Each promotion names `finding`, `author`,
`source`, `destination` and `promotedBy`. The
parent review notice uses the existing `question` message kind and contains only
`{finding, author}`; the parent retrieves the finding through `knowledge`.

## Trusted-local boundary

The CLI and database remain trusted local interfaces. Commands check declared
actors and scopes against recorded sessions and parentage. Those checks identify
inconsistent requests; they do not authenticate the process making the declaration.
An agent with direct access to the shared database can bypass a scoped command.
Reader-relative views provide context selection for trusted agents and make no
claim of adversarial confidentiality or forged-identity protection.

This slice adds no credentials, tokens, daemon or per-worker access-control layer.
Existing broad reads and evidence paths must be described honestly. Review
notifications should identify a finding for retrieval without copying its local
body into a broadly visible message.

## Evidence and existing primitives

Use the existing SQLite store and coordinator messages. `EVIDENCE` accepts only
`message:<ID>`. Recording checks in the same transaction that the message exists
and that the declared finding author is its sender or recipient. The immutable
message body carries the report, Git commit and path identities, check evidence,
and relevant observation context. Agents resolve and review that evidence.
An agent's assertion does not establish an executed check or verified result;
review reports missing or unreadable underlying evidence accurately.

Promotion preserves the evidence reference and shares its message body with
the finding's destination scope. Every reader who can read the finding receives
that body through `knowledge`, including readers who were not parties to the
original message. Evidence retention uses existing stores; this slice adds no
generic artifact registry or capture subsystem.

The parent receives review requests through ordinary committed messages and
native delivery. A message receipt establishes acceptance of that message.
The separate promotion record establishes the explicit sharing decision.
Knowledge generation, interpretation and the decision to request promotion
remain agent work. There is no automatic promotion.

## Acceptance

A real worker investigates repository behavior and records a finding referencing
an actual message whose body carries the report and immutable Git evidence.
Its parent reviews and explicitly promotes that exact finding. A sibling retrieves
the promoted record with original author, promoting actor, evidence message body
and both scopes; a local-only candidate remains absent from that sibling's
supported scoped reads.

A newly recruited worker retrieves and uses the finding without receiving a
copied claim in its task. A restarted worker retrieves the same record after
review messages have been acknowledged. Retained command results, native output
and database records establish what each worker received and used.

Executable checks cover declared actor/scope mismatches, missing evidence messages,
authors who are not evidence-message parties, complete visible reads, exact retries,
conflicting identities, and fresh-process reads. Agent acceptance checks resolution
of the underlying Git and check evidence. Laws bind the actual storage, query,
promotion dispatch and notification functions.
Tests preserve the trusted-local limitation; they do not claim authenticated
caller isolation. Host reboot and power-loss durability require separate evidence.
