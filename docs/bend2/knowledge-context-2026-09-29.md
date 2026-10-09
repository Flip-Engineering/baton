# Shared knowledge

The coordinator stores findings and promotion records in the shared SQLite database. Registered sessions can read the same findings and promotion provenance.

## Commands

```text
baton2 DATABASE record FINDING_ID AUTHOR CLAIM EVIDENCE LIMITS
baton2 DATABASE knowledge READER
baton2 DATABASE promote PROMOTION_ID PROMOTER SOURCE DESTINATION FINDING
```

`AUTHOR`, `READER`, `PROMOTER`, `SOURCE`, and `DESTINATION` are session IDs. `FINDING` names a stored finding. The finding ID identifies its author, claim, evidence reference, and limits. Repeating the same ID with those same values returns the stored finding; reusing it with different values fails.

`EVIDENCE` is stored as supplied reference text. If it has the form `message:ID` and that message exists, a read includes the message ID, sender, recipient, and body in `evidenceMessage`. Otherwise `evidenceMessage` is null. The finding row also contains `id`, `author`, `claim`, `evidence`, `limits`, `destinations`, and `promotions`.

Any registered session can read all findings and their promotions. An unregistered reader receives an empty array. A promotion records the finding, its original author, source, destination, and promoting session. The promoter must own a registered destination session. The source must be the original author or a destination already recorded for that finding. Repeating a promotion ID with identical values returns its stored record; conflicting reuse fails.

## Notices and delivery

Recording a finding writes a `question` notice to the author's immediate parent when one exists. The notice identifies the finding and author. A root author has no parent and produces no notice.

Promoting a finding writes a `question` notice to the destination owner. Its body identifies the promotion, finding, author, source, destination, and promoting session. The owner can retrieve the finding and decide whether to notify other sessions.

Each notice is committed with its finding or promotion, then delivered through the coordinator's normal message path. If delivery fails, the database write remains committed and the notice remains available as pending input for inspection and retry. Stopped recipients follow the coordinator's existing stopped-input handoff behavior.
