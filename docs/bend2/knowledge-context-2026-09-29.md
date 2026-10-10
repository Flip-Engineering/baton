# Shared knowledge

The coordinator stores knowledge items, authored relationships and promotion records in the shared SQLite database. Records retain their author, claim, evidence reference and limits. Agents can describe an item's kind and connect findings, retained messages and external sources.

## Commands

```text
baton2 DATABASE record FINDING_ID AUTHOR CLAIM EVIDENCE LIMITS
baton2 DATABASE record-typed FINDING_ID AUTHOR KIND CLAIM EVIDENCE LIMITS
baton2 DATABASE relate RELATION_ID AUTHOR SOURCE RELATION TARGET
baton2 DATABASE knowledge READER
baton2 DATABASE knowledge-scope READER universal|worker|group|all SUBJECT
baton2 DATABASE promote PROMOTION_ID PROMOTER SOURCE DESTINATION FINDING
```

`AUTHOR`, `READER`, `PROMOTER`, `SOURCE`, and `DESTINATION` are session IDs. `FINDING` names a stored finding. The finding ID identifies its author, claim, evidence reference, and limits. Repeating the same ID with those same values returns the stored finding; reusing it with different values fails.

`EVIDENCE` is stored as supplied reference text. If it has the form `message:ID` and that message exists, a read includes the message ID, sender, recipient, and body in `evidenceMessage`. Otherwise `evidenceMessage` is null. The finding row also contains `id`, `author`, `kind`, `claim`, `evidence`, `limits`, `destinations`, `promotions`, and `relations`. Existing records have kind `finding`.

`KIND` and `RELATION` are descriptive strings chosen by the author. Examples include `observation`, `hypothesis`, `decision`, `correction`, `Supports`, `Causes`, `DerivedFrom`, and `Supersedes`. A relationship retains its ID, author, source, relationship name and target. References can name `finding:ID`, `message:ID`, a source file, a run or another external source. A correction can be recorded separately and linked to its earlier finding.

Any registered session can read all findings and their promotions. An unregistered reader receives an empty array. A promotion records the finding, its original author, source, destination, and promoting session. The promoter must own a registered destination session. The source must be the original author or a destination already recorded for that finding. Repeating a promotion ID with identical values returns its stored record; conflicting reuse fails.

## Scoped graphs

`knowledge READER` returns all stored findings for discovery. `knowledge-scope` selects holdings by the requested scope:

- `worker WORKER` includes that worker's authored findings and findings explicitly promoted to it.
- `group ENSEMBLE` includes the recorded Ensemble owner's authored findings and findings explicitly promoted to that owner.
- `universal PRINCIPAL` includes the Principal Conductor's authored findings and findings explicitly promoted to it. An empty subject selects the database's root Conductors.
- `all ''` returns all findings.

The Orchestra UI's knowledge overview defaults to universal holdings. `/orchestra/knowledge/overview?actor=WORKER` selects worker holdings; `?group=ENSEMBLE` selects group holdings; `?scope=all` selects all-data discovery. Responses contain `scope`, `findings`, `promotions`, `relations`, and `actors`. A relation may reference a finding outside the selected holdings; its reference remains available while that finding's content appears in its own scope or all-data discovery. Cited retained message content is available in each finding's `evidenceMessage`.

MCP exposes the same operations through `baton2_knowledge_record` with optional `kind`, `baton2_knowledge_relate`, `baton2_knowledge` with optional `scope` and `subject`, and `baton2_knowledge_promote`. Omitted MCP scope retains all-data discovery.

## Notices and delivery

Recording a finding writes a `question` notice to the author's immediate parent when one exists. The notice identifies the finding and author. A root author has no parent and produces no notice.

Promoting a finding writes a `question` notice to the destination owner. Its body identifies the promotion, finding, author, source, destination, and promoting session. The owner can retrieve the finding and decide whether to notify other sessions.

Each notice is committed with its finding or promotion, then delivered through the coordinator's normal message path. If delivery fails, the database write remains committed and the notice remains available as pending input for inspection and retry. Stopped recipients follow the coordinator's existing stopped-input handoff behavior.
