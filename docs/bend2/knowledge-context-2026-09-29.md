# Findings and shared context

## Decision and implementation status

Following the operator question about shared knowledge, the root assigned three
coordinator operations on 2026-09-29 under #642: record a finding, read visible
context, and explicitly promote an exact finding. Agents generate findings and
review their evidence.
The coordinator stores the records and applies visibility and promotion rules.
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

The implementation lead's planned command forms are:

```text
baton2 DATABASE record FINDING_ID AUTHOR CLAIM EVIDENCE LIMITS
baton2 DATABASE knowledge READER
baton2 DATABASE promote PROMOTION_ID PROMOTER DESTINATION FINDING
```

`AUTHOR`, `READER`, `PROMOTER` and `DESTINATION` name coordinator sessions.
`FINDING` names an existing finding. The coordinator obtains its source scope
and provenance from the stored record. These argument names describe declared
actors under the trusted-local boundary below.

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

The destination owner promotes a source it can read. Wider sharing requires
another explicit promotion. Recording, reading, reporting, acknowledging a
message and completing a turn do not promote a finding. `knowledge READER`
applies the scope rule to every returned finding, including its evidence reference
and metadata. A fresh or restarted worker can retrieve visible records independently
of its native conversation memory and whether review messages were acknowledged.

Read rows carry `id`, `author`, `claim`, `evidence`, `limits`, `destinations` and
`promotions`. Each promotion names `finding`, `source`, `destination` and
`promotedBy`. The parent review notice is an ordinary message containing only
the finding ID and author; the parent retrieves the finding through `knowledge`.

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

Use the existing SQLite store and coordinator messages. Initial evidence kinds
are retained report/message records and immutable Git evidence needed by the
acceptance task. Planned reference forms are `message:<id>` and `git:<40 hex>`.
A message reference must identify an existing row whose sender or recipient is
the declared finding author. A Git reference names an immutable object identity
that a reader resolves in the repository. The claim and limitations supply any
repository, path and observation context needed to interpret that evidence.
Promotion preserves the reference. Admitting a Git reference does not establish
that its object has been resolved or its contents verified. A reader reports a
missing or unreadable object accurately; an agent's assertion does not establish
an executed check or verified result.

Promotion must account for the evidence's visibility in the destination. It
cannot silently expose other source-scope material or promise evidence the
reader cannot obtain. Evidence retention uses existing stores; this slice adds
no generic artifact registry or capture subsystem.

The parent receives review requests through ordinary committed messages and
native delivery. A message receipt establishes acceptance of that message.
The separate promotion record establishes the explicit sharing decision.
Knowledge generation, interpretation and the decision to request promotion
remain agent work. There is no automatic promotion.

## Acceptance

A real worker investigates repository behavior and records findings referencing
its actual report/message and immutable Git evidence. Its parent reviews and
explicitly promotes an exact finding. A sibling retrieves the promoted record
with original author, promoting actor, evidence and both scopes; a local-only
candidate remains absent from that sibling's supported scoped reads.

A newly recruited worker retrieves and uses the finding without receiving a
copied claim in its task. A restarted worker retrieves the same record after
review messages have been acknowledged. Retained command results, native output
and database records establish what each worker received and used.

Executable checks cover declared actor/scope mismatches, inaccessible or missing
evidence, exact retries, conflicting identities, and fresh-process reads. Laws
bind the actual storage, query, promotion dispatch and notification functions.
Tests preserve the trusted-local limitation; they do not claim authenticated
caller isolation. Host reboot and power-loss durability require separate evidence.
