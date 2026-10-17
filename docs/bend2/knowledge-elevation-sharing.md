# Knowledge elevation and sharing semantics

Date: 2026-10-17.

Source pin: `knowledge-deepseek-782-785` at `4055f61` (code identical to
`69558f7`), base `dd62ce8`.

Measured binary: retained Main9 binary
`/run/baton2-native-homelab/retained/baton-knowledge-730-746-main9-20261016/knowledge-context/bin/baton2`,
SHA-256 `d91c9e40efa00ec812f67eec304f0269bd3e45f8c25e89cae421888322ef476d`.
Its `bend2/src/coordinator/knowledge.bend` SHA-256 is
`1a7d4a0d652f4bd6f9797fbfd7498467cefed6d13331e0a7b1e72fc192802b5d`, equal to
`dd62ce8`. The promotion block at `dd62ce8` and `4055f61` is byte-identical
(SHA-256 `a1017a9309bcaacfce4ed90a6745568c261f220df1d2dc0835bb2596e6f4496f`),
so the measured promotion behavior describes the current pin. Scope-token
validation differs between the binary and the current pin; the probe below uses
valid scope tokens only.

Evidence: `docs/bend2/measurements/2026-10-17-knowledge-elevation-sharing.json`,
produced by `bend2/scripts/probe-knowledge-elevation-sharing.py`.

Status: design and evidence accepted as design-only by the coordinator on
2026-10-17. Decisions are recorded in section 6. No production CLI or MCP
operation is added here. #789-791 remain in delivery qualification and are not
claimed accepted.

## 1. Current source contract

### Tables

`knowledge_schema()` (`knowledge.bend:16-19`) creates three tables:

| Table | Columns |
| --- | --- |
| `knowledge` | `id UNIQUE, author, claim, evidence, limits, kind` |
| `knowledge_promotions` | `id UNIQUE, finding, author, source, destination, promoted_by, source_kind, destination_kind` |
| `knowledge_relations` | `id UNIQUE, author, source, relation, target` |

Every knowledge write runs `BEGIN IMMEDIATE`, installs the application schema
and the knowledge schema, writes its statements, and commits
(`commit_sql`, `knowledge.bend:21-22`).

### Recording

`record` and `record-typed` insert a finding, optionally set its authored kind,
read back only the coordinates of this invocation, and write a notice to the
author's immediate parent (`finding_statement_when`, `knowledge.bend:308-314`;
`typed_record_statements_when`, `knowledge.bend:319-326`). A missing registered
author makes the insert a no-op and the command refuses. An identical repeat
returns the stored row; a changed repeat refuses with `finding-id-conflict`
(`knowledge.bend:310-311`).

`record-linked` commits a typed record and its authored relations in one
transaction (`knowledge.bend:355-361`). It preflights stored identities and
duplicate identities inside the input, withholds the complete record on a
collision, and writes the notice after the record and links commit.

### Promotion

A promotion records one explicit share. The write path is
`promotion_statement` (`knowledge.bend:381-384`), the destination notice
(`promotion_notice_statement`, `knowledge.bend:398-403`), and the stored answer
(`promotion_answer`, `knowledge.bend:386-387`), composed by
`promote_statements` (`knowledge.bend:405-406`) and called by
`promote_scoped` (`knowledge.bend:485-490`).

Admission requires the finding to exist and two endpoint conditions:

- the promoter is the destination owner: the session itself, or the `owner` of
  the destination Ensemble (`promotion_owner`, `knowledge.bend:364-368`;
  `promotion_admitted`, `knowledge.bend:370-371`);
- the source carries the finding: a session source is the original author, or
  the source is a recorded promotion destination for that exact finding
  (`source_carries`, `knowledge.bend:375-376`).

The row stores the finding, original author, source endpoint kind and ID,
destination endpoint kind and ID, and the promoter. The row is durable; the
destination notice is a separate `messages` row `<promotion-id>:promotion-notice`
addressed to the destination owner.

### Read scopes

Reads validate the scope token and require a nonempty subject for `worker` and
`group` (`scope_error`, `knowledge.bend:81-88`). Invalid tokens and empty
subjects exit 2 with `knowledge-scope-invalid` or `knowledge-subject-required`.
Traversal directions validate with `knowledge-direction-invalid`
(`knowledge.bend:89-97`).

`scope_holders_sql` (`knowledge.bend:99-105`) maps:

| Scope | Holders | Finding visibility |
| --- | --- | --- |
| `worker` | the named session | author is a holder, or a session promotion names a holder |
| `group` | the named Ensemble owner | a group promotion names the Ensemble |
| `universal` | parentless sessions with role `principal-conductor` or `conductor` | author is a holder, or a session promotion names a holder |
| `all` | every session | every row |

The finding predicate is `scope_findings_sql` (`knowledge.bend:107-114`), and the
relation predicate is `scope_relations_sql` (`knowledge.bend:116-122`). A
relation is visible when its author is a holder or when either endpoint is a
visible finding. The graph response includes visible nodes; an endpoint outside
the scope appears as a reference with a detail read and no node content
(`graph_answer`, `knowledge.bend:231-232`).

### Provenance in reads

Every complete finding read carries `destinations`, `promotions`, and incident
`relations` (`knowledge_item_with_types`, `knowledge.bend:71-75`;
`knowledge_destinations`, `knowledge.bend:35-36`; `knowledge_promotions`,
`knowledge.bend:48-49`). A promotion item carries `finding`, `author`, `source`,
`destination`, and `promotedBy`. The source and destination kinds appear when an
endpoint kind is not `session` (`endpoint_fields`, `knowledge.bend:40-43`).
Evidence that names a retained message returns the whole message as
`evidenceMessage` (`evidence_message`, `knowledge.bend:53-54`).

## 2. Measured behavior

The probe runs each command as its own product process against a throwaway
database. The fixture has sessions `root`, `worker`, and `sibling`, and a tight
Ensemble `review-group` owned by `root` with `worker` as a member. `sibling` is
not a member.

| Case | Result |
| --- | --- |
| Promotion write | `shared` before and after has the same author and claim; `destinations` changes from `[]` to `["worker"]`; one promotion row. |
| Ten scope and search reads | DB bytes stay 204,800; counts stay 1 finding, 1 promotion, 0 relations, 3 messages. Reads materialize no rows. |
| Duplicate logical share under a second identity | `share-to-worker` and `share-to-worker-2` both store `(finding=shared, source_kind=session, source=worker, destination_kind=session, destination=worker, promoted_by=worker)`; `destinations` is `["worker","worker"]`; two `promotion-notice` messages exist. |
| Group share | `sibling` names `group review-group` and reads the complete `shared` finding (claim `the retry doubles the work`). The promotion item carries `sourceKind: session` and `destinationKind: group`. |
| Cross-author relation | Relation `cross` (author `root`) stays visible through the group holding. Search nodes are `["shared"]`; edges are `["cross","citation:shared"]`; `finding:root-only` appears as a reference with `detailRead ["knowledge-scope","sibling","all","","--id","root-only"]`; its content is absent. |
| Dangling evidence | Finding `dangling` stores evidence `message:absent-0000`; `evidenceMessage` is null; traversal returns edge `citation:dangling` and reference `message:absent-0000`. |
| Elevation with existing records | Note `note-1` (sender `root`, recipient `worker`, body `draft observation`) stays readable. Finding `elevated` (author `worker`) cites `message:note-1`, returns the whole note as `evidenceMessage`, and carries relation `derived` (`finding:elevated DerivedFrom message:note-1`). |
| Kind reclassification | `record-typed kind-probe worker observation ...` stores `observation`; the same coordinates with `correction` exit 0 and the stored kind becomes `correction`. |
| Notice recovery | First promotion exits 1 with `The row is committed and its notice is undelivered...`; row `repair-share` exists and its notice has no receipt. After the endpoint is repaired, the retry returns the stored promotion; one row, one notice, one delivered line. |
| Final state | 204,800 bytes; 5 findings, 4 promotions, 2 relations, 10 messages. |
| Process memory | On the 204,800-byte fixture, `knowledge-scope` used 11,016 KiB maximum resident set size in 0.03 s and `knowledge-search` used 20,724 KiB in 0.15 s. Both figures include process startup and SQLite open. |
Two independent runs in fresh fixture directories produced the same JSON after
removing the fixture path and Git base commit.

The duplicate share contradicts the one-row-per-share statement. The lifecycle
audit describes one promotion row per
`(finding, source, destination)`
(`/run/baton2-native-homelab/retained/baton-compiler-forkflush-20261016T195048Z/worktrees/knowledge-generation-lifecycle-1017/reports/knowledge-generation-lifecycle-1017/report.md`,
section 2.7; retained outside this checkout). The
second identity produces a second row for the same destination, a repeated
`destinations` entry, an inflated promotion count, and a second notice.

## 3. Fork-and-flush evidence

The Fork-and-Flush paper defines agent state as the workspace and the
conversation context, `(W, C)`; forking copies the workspace and starts a fresh
conversation; flushing clears the conversation and retains the workspace;
selection continues from the highest-scoring branch
(https://arxiv.org/html/2610.07447v1, sections 2 and 4). Baton records these
operations at Conductor boundaries (`docs/bend2/branching-ensembles.md:99-103`).

Retained evidence outside this checkout: the Cgen reports and the lifecycle
audit cited in this document are under
`/run/baton2-native-homelab/retained/baton-compiler-forkflush-20261016T195048Z/worktrees/`.

The Cgen round records this evidence:

- Eight lanes forked from base `07989efe`, each with a separate branch, commit,
  worktree, and candidate artifact. All eight evaluators returned
  `{"accepted": true, "score": 0}` with `performance_measured: false` and
  `tests_executed: []`. No generated C was produced or compared in that round.
  All lane branches remained unmerged and retained
  (`reports/cgen-emergency-wonder/report.md`, sections "Results by lane" and
  "Output-equivalence and measurement evidence").
- Two early OMP receives returned `database schema has changed` under
  concurrency; the conductor recovered with sequential re-receive and recovery,
  and no lane was left roster-only (same report, "Workers verified").
- The knowledge branch round compared two candidates in round
  `branch-296cd6de0cf87074bed83445807905aa`. Branch 0 (relation immutability
  trigger) scored 1119.37; branch 1 (trigger, five lookup indexes, insertion-order
  aggregates) scored 1173.21 and was selected in the recorded round. Branch 1
  reduced read, scope, and search medians from 1.5981, 1.6275, and 0.9981
  seconds to 0.1580, 0.1605, and 0.2584 seconds (7.321x) at 1.368x database
  bytes (`reports/knowledge-graph-wonder-1017/report.md`, section 1).
- The branches were stopped to settle evaluation; score-based selection then
  refused, and the conductor recorded an explicit selection with a reason and
  resumed the selected branch with `resume --lift-stop`. Every branch's
  artifacts, reports, and evaluation worktrees remained
  (same report, sections 1 and 4).
- The Cgen emergency result records evaluator acceptance with score 0,
  `performance_measured: false`, and `tests_executed: []`
  (`knowledge-record:cgen-emergency-conductor-result`,
  baton-compiler-forkflush database). Addendum 2 records that all measured-run
  authorizations were denied and that the lane 8 SQLite schema cause was
  per-install trigger churn (`knowledge-record:cgen-emergency-addendum2`).

### Mapping to knowledge elevation and sharing

| Fork-and-flush element | Knowledge requirement |
| --- | --- |
| Workspace snapshot copied to each branch | A note or finding is a durable row. An elevation cites an exact existing row, so a branch with a flushed conversation can still elevate and read the source. |
| Conversation flushed | A consumer reads the finding, note, evidence, and relations from the database. A promotion notice carries identities, and the finding body remains in the store. |
| Parallel branches retained | Sharing creates a destination holding and leaves the original author's holding intact. Losing or unselected branches remain readable. |
| Evaluation records a score | Promotion records visibility and provenance. Review acceptance remains a separate authored record. |
| Selection by score, explicit selection for ties or stops | Only the destination owner promotes. The promoter is stored. An ambiguous or refused promotion remains visible and retryable. |
| Branch recovery retries setup and owed input | A promotion row commits before its notice. Delivery retries the exact pending notice and does not duplicate the row (measured). |
| Linear growth in branches and retained artifacts | Storage grows with explicit shares and authored relations. Reads and scope queries add no rows (measured). Repeated shares for one destination are the growth defect (measured). |
| Retained counts do not attribute bytes; unresolved internals are marked | Evidence that does not resolve is refused or recorded as unresolved. Citation lineage does not invent a message body (#784). |

## 4. Elevation semantics

### Note representation

A note is a `knowledge` row with an authored kind such as `note`, `plan`, or
`doubt`. The row keeps the author, complete text, evidence reference, limits,
and kind under the existing identity, conflict, notice, and visibility rules.
This uses the existing store and adds no table.

Decision (2026-10-17): accepted. A private note scope is deferred; it needs a
recorded failure and a new authority rule.

An append is a new note row with a `DerivedFrom` or `Continues` relation to the
previous note version. The previous version remains unchanged. A note has one
body per row; edits are new rows, so a consumer can read the exact version that
was elevated.

### Elevation write

Elevation writes one finding that cites the note version:

- the finding author is the elevating actor;
- the finding evidence names the note, for example `finding:<note-id>` or
  `message:<note-id>`;
- the finding kind is the authored claim kind (`observation`, `finding`,
  `hypothesis`, `decision`, and so on);
- a `DerivedFrom` relation points from the finding to the note version;
- the note row is not updated.

`record-linked` already performs this composite write in one transaction: it
inserts the finding, sets its kind, inserts the link, and delivers the notice
after commit (`knowledge.bend:355-361`, `436-439`). An identical retry returns
the stored finding and relation. A changed retry refuses with
`finding-id-conflict` or `relation-id-conflict`, and a conflicting link batch
withholds the record and links.

The note author and the elevating actor are separate when they differ. The note
row preserves the note author; the finding row preserves the elevating actor;
the evidence reference and `DerivedFrom` relation identify the note version.
A consumer reads both rows to reconstruct the chain.

Elevation does not write the note row. A later exact-coordinate repeat can
change the note's kind under G6; the finding's `DerivedFrom` relation and
evidence reference continue to name the note row.

### Visibility

Notes and findings use the existing scope rules. A note authored by a worker is
visible in `worker` scope for that worker, in `all` scope for every registered
session, and in a destination scope after promotion. Elevation does not change
the note's visibility; the finding has its own visibility.

The current model has no private note scope and no confidentiality boundary.
Any registered session can name any `worker` or `group` scope and read its
holdings. The measured group read by a non-member session confirms this for
`group`. Decision (2026-10-17): keep the existing declared-actor scopes; no
private note scope and no confidentiality claim. The measured non-member group
read and the authority gap remain recorded. A private holding needs a recorded
failure and a new authority rule.

### Authority

The current record path requires a registered author and does not restrict
elevation to the note author. A coordinator can elevate a worker's note and the
finding records the coordinator as author and the note as the source. If
elevation should require the note author or the note author's coordinator, that
is a new admission rule. No measured failure requires it.

### Candidate operation for #724

A narrow `knowledge elevate` operation can compose the existing write:

```text
knowledge elevate --note NOTE_ID --kind KIND --claim TEXT --limits TEXT [--evidence TEXT]
```

Baton would resolve the actor and generate the finding and relation identities
(#723), require the note to exist and be a note/plan/doubt kind, write the
finding and `DerivedFrom` relation through `record-linked`, and answer the stored
finding. The operation adds no table and no second store. This document does not
add the operation; #724 owns its implementation and qualification.

## 5. Sharing invariants

The current implementation satisfies these invariants, with the measured
exception in G1.

| ID | Invariant |
| --- | --- |
| S1 | A share is an explicit promotion row. Reads, searches, traversals, and notices do not create promotions. |
| S2 | Sharing copies no finding content and changes no finding column. The destination reads the original row. |
| S3 | A promotion stores the finding, original author, source endpoint kind and ID, destination endpoint kind and ID, and promoter. |
| S4 | An identical promotion retry with the same identity returns the stored row. A changed repeat with the same identity refuses with `promotion-id-conflict`; a notice identity collision refuses with `promotion-notice-conflict`. |
| S5 | Destination visibility follows the scope predicates. `worker` and `group` require a subject; invalid tokens and directions refuse. |
| S6 | A destination read returns the complete finding, the whole cited evidence message, incident relations, and the promotion provenance. An out-of-scope endpoint appears as a reference without node content. |
| S7 | The promotion row and its notice commit together. A failed notice leaves the row committed and exits 1 with a retry path; a retry after delivery does not duplicate the notice. A stopped destination hands the notice to its parent. |
| S8 | Storage grows with explicit shares and authored relations. Reads and scope queries do not add rows. A promotion is one hop from finding to destination; reads do not build a transitive closure. |
| S9 | Scope names select holdings. They are not a confidentiality boundary; group membership is not checked on reads. |
| S10 | A finding's ID, author, claim, evidence, and limits are immutable under a changed-content repeat. `kind` is the current classification and can change on an exact-coordinate repeat (G6). |

## 6. Decisions, gaps and proposals

### Coordinator decisions (2026-10-17)

1. G1 duplicate share: finding f84a260a is accepted. The
   one-row-per-`(finding, source_kind, source, destination_kind, destination)`
   invariant is authoritative. Implementation is assigned to
   knowledge-storage-traversal-ds-20261017 as a separate
   promotion-coordinate-conflict candidate on its branch; it is not part of the
   knowledge-deepseek-782-785 candidate and is not implemented here.
2. #724 note representation: accepted. Notes are knowledge rows with kind
   `note`, `plan` or `doubt`; append is a new row with `DerivedFrom` or
   `Continues`; elevation composes `record-linked` with `DerivedFrom` to the note
   version. Keep one store and the existing scopes. A private note scope is
   deferred; it needs a recorded failure and a new authority rule.
3. G3 reference detail read: keep the current all-scope detail read for
   resolvability at this pin. Record it as a navigation inconsistency to revisit
   only if a consumer requires strict scope. No source change.
4. G6 kind mutability: keep `kind` as the current classification. Do not add
   `kind` to the conflict coordinates. The existing test stands; an immutability
   change needs a recorded consumer failure and a test update.
5. Note visibility: keep the existing declared-actor scopes. No private note
   scope and no confidentiality claim. The measured non-member group read and
   the authority gap remain recorded.

### G1: duplicate logical share under a new identity

Measured: two promotion rows for the same
`(finding, source_kind, source, destination_kind, destination)` tuple produce a
repeated `destinations` entry, a promotion count of 2, and two notices.

Impact: `destinations` is a per-finding destination list, and the duplicate entry
repeats one destination. Repeated shares grow `knowledge_promotions` and
`messages` linearly with no new provenance. The duplicate notice repeats an
event the destination already received.

Status: assigned, not applied. Finding f84a260a is accepted and the
one-row-per-`(finding, source_kind, source, destination_kind, destination)`
invariant is authoritative. Implementation is assigned to
knowledge-storage-traversal-ds-20261017 as a separate
promotion-coordinate-conflict candidate on its branch. It is not part of the
current knowledge-deepseek-782-785 candidate and is not implemented here.
The candidate extends `promotion_statement` with a coordinate guard before the
insert. If another stored row has the same finding, source endpoint, and
destination endpoint, it refuses with a typed `promotion-coordinate-conflict`
that names the stored promotion ID and keeps the stored row. The guard adds no
column or index and stops new duplicates on databases that already contain
legacy duplicates.

Behavior case for the assigned candidate (`bend2/test/knowledge.py` owner):

1. Record `shared`; promote `p-1` from `worker` to `worker`; promote `p-2` with
   the same coordinates.
2. `p-2` exits 2, names `promotion-coordinate-conflict` and the stored `p-1`.
3. `knowledge_promotions` has one row; `destinations` is `["worker"]`; one
   notice exists.
4. An identical retry of `p-1` returns the stored row.
5. A promotion to a different destination succeeds and adds one destination.
6. A changed repeat of `p-1` still refuses with `promotion-id-conflict`.

This case is independently specified and uses existing commands. It belongs
with the assigned candidate; it is not added in this branch.

### G2: destination identity has no kind in `destinations`

`destinations` is a bare ID list. A session and an Ensemble can share a string;
the test fixture creates Ensemble `worker` while session `worker` exists.
`promotions` carries the endpoint kinds when a kind is not `session`. Decision:
treat `promotions` as the authoritative provenance record and `destinations` as
a convenience list. A response change that adds kind-bearing destination objects
requires a consumer audit; no measured consumer failure exists.

### G3: reference detail reads use `all`

A scoped graph read returns an out-of-scope finding reference with
`detailRead ["knowledge-scope", READER, "all", "", "--id", ID]` (measured for
`group`). The node content is absent while the literal read command is
unscoped. The unqualified `knowledge` command reads `all` for every registered
session, so this is a navigation inconsistency with the declared scope.
Decision (2026-10-17): keep the current all-scope detail read for
resolvability at this pin. Scope names are holdings selectors, not a
confidentiality boundary (S9), and the graph includes the reference without
node content. Revisit only if a consumer requires strict scope. No source
change.

### G4: unresolved evidence references

Measured: evidence `message:absent-0000` stores verbatim, returns
`evidenceMessage: null`, and produces citation edge `citation:dangling` to a
message that does not exist. For elevation, a finding can cite a note ID that
never existed, and the citation lineage then names nothing retrievable. #784
owns the general evidence contract. The elevation operation should require the
note row to exist and be visible to the elevating actor, and refuse with a
precise condition when it does not. This constrains the #724 operation;
free-form evidence remains under #784.

### G5: notes are visible in finding reads and search

Notes stored as `knowledge` rows appear in full reads, index reads, and search
results. The `kind` field distinguishes them and search matches kind text.
Consumers that need findings only filter on `kind`. The cost of one store is
that notes participate in the same read and search surfaces as findings.

### G6: finding kind can change on an exact-coordinate repeat

Measured: `record-typed kind-probe worker observation ...` stores
`observation`; the same author, claim, evidence, and limits with `correction`
exit 0 and the stored kind becomes `correction`. The existing test pins this
behavior (`bend2/test/knowledge.py:600-611`). The conflict comparison covers
author, claim, evidence, and limits; the kind update is separate
(`typed_record_statements_when`, `knowledge.bend:319-326`). `native_changes`
records an update event, and knowledge reads expose the current kind only.

Impact: A shared finding's classification can change after promotion without a
new promotion row or a new finding identity. A destination reads the current
kind. For elevation, a note row's kind can be reclassified; the finding's
`DerivedFrom` relation and evidence reference still name the note row.

Decision (2026-10-17): keep `kind` as the current classification and do not add
`kind` to the conflict coordinates. The existing test stands. An immutability
change needs a recorded consumer failure and a test update.

## 7. Limits

- No `4055f61` build or execution exists. The measurements use the retained
  Main9 binary whose knowledge source is `dd62ce8`. The promotion block is
  byte-identical at both pins; scope-token validation differs between the pins,
  and the probe uses valid tokens only.
- One host, one small fixture, SQLite 3.45.1, sequential processes. No
  concurrent writers, crash injection, or large-scale latency measurement. The
  two process memory maxima in section 2 include startup and SQLite open. The
  Cgen and knowledge branch-round figures are retained evidence, not reruns.
- No full Main-v13 compile and no broad run. The probe starts a throwaway
  database and a throwaway Git repository only.
- #789-791 delivery qualification remains in backlog. This document claims no
  acceptance, merge, publication, or installation.
