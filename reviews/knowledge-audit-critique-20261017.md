# Knowledge audit critique and scoping — 2026-10-17

Author: knowledge-glm (independent critic, OMP zai/glm-5.3-flash), Ensemble
knowledge-semantics-product, conductor knowledge-wonder. Branch
`knowledge-glm-779-critic` at base dd62ce8. This document is the #779
audit synthesis and the scoping critique for #710, #711, #724, #730, #746,
#777, #707, #782 and #784. It critiques the recorded audit state; the #783/#785
source fix belongs to knowledge-deepseek and is critiqued separately when its
candidate lands.

Method. Every "source fact" below was read in a named file at this worktree
(dd62ce8) or fetched directly (GitHub issue bodies, sqlite.org FTS5
documentation, the HippoRAG arXiv abstract). Every "measured" item is an
executed observation recorded elsewhere and relayed with its recorded owner; I
re-ran none of it. "Research" names only primary material I read in this
session. "Untested" names hypotheses with no source, measurement, or read
research behind them. This critique makes no compilation and no runtime
claims. Where the #779 parent issue already published the ensemble's accepted
matrix, this document independently restates what its sources support and
records the residual disagreement.

## Evidence classes

- **Source fact**: read here, with file and line.
- **Measured**: executed elsewhere, relayed with owner and identity; adopted as
  recorded, not reproduced.
- **Research**: read here in primary material; anything else is listed as
  unresolved in the final section.
- **Untested**: no supporting source, measurement, or read research; a
  hypothesis that requires its own workload before it justifies a change.

## Comparison matrix

### Storage model

| | Baton knowledge (dd62ce8) | project-manager (deployed, digested) |
|---|---|---|
| Source fact | Three tables: `knowledge` (id, author, claim, evidence, limits, kind), `knowledge_promotions` (source_kind, destination_kind), `knowledge_relations` (id, author, source, relation, target) — `knowledge.bend:16-19`; schema installed inside each transaction, `knowledge.bend:21-22`. Kinds and relations are authored free-form strings — `knowledge.bend:380`. | SQLite with FTS5 virtual tables over findings, decisions, hypotheses, principles, constraints, literature, experiments — `pm-digest/v6-cognitive-augmentation-scope.md:52-53`. Polymorphic edge table `(source_type, source_id) -> (target_type, target_id, relation)` with 13 closed edge types — v6:55. |
| Measured | Baton store scaling without secondary indexes: a worker-run candidate adding five indexes measured complete read 153.9s → 1.6s at 10k findings/30k relations (knowledge-record:ffa59881, relayed). | pm scale ~1.7K findings — v6:84. |
| Research | Typed scientific node/edge schemas exist in #710: JSON Schema 2020-12 with ten closed node types and sixteen closed relation types (issue-recorded). HippoRAG builds its graph from LLM-extracted triples (arXiv abstract, read). | Same research column applies. |
| Untested | Which typing granularity Baton's authored-string store needs; no workload judges it. | — |

### Lexical matching

| | Baton | pm |
|---|---|---|
| Source fact | AND over space-split terms; case-folded `instr` substring across id, kind, claim, evidence, limits and the retained evidence message body — `knowledge.bend:191-198`. Empty query matches all — `knowledge.bend:196`. | `text_search` (FTS5 MATCH) is the retrieval primitive returning excerpt, modified_at, confidence, belief_status — v6:54. `pm_search` searches all KG node types by text content and returns ranked results — `pm-digest/src_mcp_tools.rs` digest:145-147. |
| Measured | Ten-finding, six-query fixture: AND-`instr` precision@1 1.000, recall@3 1.000, MRR 1.000; OR BM25 baseline over the same fields 0.833/1.000/0.917 (knowledge-record:2d7d81aa, relayed; fixture is tiny). | pm candidate SQL matched the first query word; a copied-database control found a record through a later word the original missed (pm F2, #779-reproduced). |
| Research (read) | FTS5 provides an inverted index with MATCH, phrase, prefix, NEAR and boolean queries (§1, §3), and `bm25()` with k1=1.2, b=0.75, per-column weights, IDF and term frequency, normalized so better matches score lower (§5.1.1, sqlite.org/fts5.html). `instr` substring matching has no term-frequency, length-normalization, or IDF behavior. | pm's FTS5 gives it the §5.1.1 machinery directly. |
| Untested | Baton recall/precision on a judged multi-term corpus; non-ASCII behavior of `lower()` in the Bend/SQLite stack. | — |

### Ranking

| | Baton | pm |
|---|---|---|
| Source fact | Exact id +100, claim substring +30, kind +10, plus the count of incident visible edges; results ordered by score descending then id — `knowledge.bend:201-210`. The edge term is unbounded, so a well-connected finding outranks a lexically stronger one. | Composite score: text 1.0 + evidence 0.2 + recency 0.3 over FTS5 (v6 §7 per `pm-kg.md:159-160`; v6:216). Decision scoring uses the displayed excerpt and can miss its matching stored field (#779 F4). |
| Measured | No observed Baton ranking failure on the audited workloads (#779). | pm F1 corrected distribution: 50 zero-edge results and 13 results with nonzero evidence (10 positive, 3 negative); the edge-count term returned zero on the copied fixture despite existing edges (#779, reproduced on deployed binary b682cf48). |
| Research (read) | HippoRAG ranks by Personalized PageRank over a knowledge graph rather than a lexical composite (arXiv abstract, read); its evaluation target is multi-hop QA, not ranked listings. | — |
| Untested | Whether the degree boost helps or harms Baton ranking; no judged workload exists. | — |

### Candidate selection, pagination, indexes

| | Baton | pm |
|---|---|---|
| Source fact | Complete matching set, no pagination — `knowledge.bend:207-210`. The schema at dd62ce8 declares UNIQUE id constraints only; secondary indexes on author, relation endpoints and promotion coordinates are absent — `knowledge.bend:16-19`. | Per-table collection with final truncation returning 50 findings, omitting the matching constraint fixture (pm F3, #779-reproduced). Candidate ordering depends on scans. |
| Measured | Worker-run candidate measurements above (knowledge-record:ffa59881, relayed): recursive traversal 465s → 4.1s; search at 2k findings 161.4s → 2.6s. Separate candidate; not merged; awaits rebase, write-path measurement and a scoped remote run. | — |
| Research (read) | FTS5 is a measured-sensible primitive at pm's stated scale (v6:84, v6:257-258 claims FTS5 plus graph connectivity out-performs naive embedding cosine at 1.7K nodes; pm-side claim, relayed). | — |
| Untested | Baton latency/memory at target store sizes on the merged source. | — |

### Traversal

| | Baton | pm |
|---|---|---|
| Source fact | Seed reference normalizes bare stored IDs to `finding:ID` — `knowledge.bend:56-57`. Direction in/out/both — `knowledge.bend:212-216`. Relation filter normalizes case and strips `_`/`-` — `knowledge.bend:218-219`. Recursive walk is a `UNION` recursive CTE; `UNION` deduplication terminates cycles — `knowledge.bend:228`. No depth bound; no path enumeration — `knowledge.bend:225-229`. At dd62ce8 an unknown direction string is accepted as bidirectional (#783 owns the refusal; fix on knowledge-deepseek's branch). | `pm_kg_traverse` traverses from one node and shows connected edges and nodes with direction — digest:42-45. The engine holds depth-controlled bidirectional traversal, and a separately named deep traversal using a stack (#779 row). `pm_query` returns top-3 ranked plus 1-hop expansion — v6:28; `pm_context` groups by node type with 1-hop neighbors and cross-refs — v6:30. |
| Measured | None in this session; #779 records that path-retrieval quality and multi-hop answer grounding have no comparative measurement. | — |
| Research (read) | HippoRAG: single-step PPR retrieval performed comparably or better than iterative retrieval (IRCoT) at 10-30x lower cost and 6-13x faster (arXiv abstract claims, 2024). Applicability to Baton's authored graph is unestablished. | — |
| Untested | Depth bounds, path reporting, PPR, community retrieval, and multi-hop answer quality on Baton data. | — |

### Derived citation edges and evidence lineage

| | Baton | pm |
|---|---|---|
| Source fact | `graph_edges_sql` derives a `Cited` edge, provenance `recorded-evidence`, for evidence with prefixes `message:`, `finding:`, `file:`, `http://`, `https://`, `external:`; authored relation rows carry provenance `authored` — `knowledge.bend:182-186`. Evidence with any other prefix produces no citation edge. `evidence_message` resolves whole `message:` bodies — `knowledge.bend:53-54`. `finding_statement` stores evidence verbatim — `knowledge.bend:271-274`. | Evidence is opaque text; `pm_log_finding` auto-links via composite scoring on write — v6:34 and `pm-qa.md` K6 row. |
| Measured | #784 homelab reproduction on Main9 d91c9e40 at b1f006a: a dangling `message:absent-0000` stored verbatim, produced citation edge `citation:dang` and a `references` entry of kind `message` for a message that does not exist; evidence `run:probe-w1` produced no edges and no references (issue-recorded, retained artifacts). | — |
| Research | Unresolved here: PROV and SOSA are named in #710 as informing patterns; I read neither. | — |
| Untested | Consumer behavior when following dangling edges at scale; prefix governance over time. | — |

### Graph audit, delta, orphans

| | Baton | pm |
|---|---|---|
| Source fact | No audit, delta-since or orphan surface in the knowledge tool set at dd62ce8 — `knowledge.bend:379-380` lists record, search, traverse, read, promote, relate (knowledge-record:addbe4d3 concurs). Law coverage of the coordinator suite is gated through `check-native.sh:14` (see #782 below). | `pm_kg_audit` validates causal backbone compliance, hypothesis coverage, literature utilization, edge density, temporal coherence, cross-project references; returns health score 0-100 — digest:227-231. `pm_since` and `pm_orphan_repair` exist — digest via `pm-kg.md:55`. |
| Measured | Two law entries failed at their first stale assertion at the audited source; the coordinator law suite was absent from the reviewed gate (#779, #782; retained compiler stderr). | pm F5: the copied graph audit missed inserted findings without experiments and failed to report the intended orphan case (#779, reproduced). Live `pm_kg_audit(volta-renaissance)` returned 70/100 across six axes on 2026-07-09 — `causal-research-bok.md:219-225` (relayed). |
| Research | Unresolved here. | — |
| Untested | Any Baton audit axis definition; whether a composite 0-100 score is desirable given the recorded pm critique that a single number hides its reasons (`pm-redteam.md` Q3/Q8, relayed). | — |

### Scope and authorization

| | Baton | pm |
|---|---|---|
| Source fact | Scopes worker/group/universal/all — `knowledge.bend:84-99`; universal selects root sessions holding conductor roles — `knowledge.bend:81`; an unregistered reader receives the empty array — `knowledge.bend:125`. Promotion authority is the destination owner alone — `knowledge.bend:306-312`; the named source must carry the finding — `knowledge.bend:311-312`. Detail-read argv embedded in results selects `all` — `knowledge.bend:139-145`. Scope is a holdings lens on a trusted local database. | No comparable holdings scope; search includes cross-project data by default (#779 row). |
| Research | Unresolved here (information-flow analysis unread). | — |
| Untested | Confidentiality properties; the #779 matrix explicitly leaves them unestablished. | — |

### MCP surface validation

| | Baton | pm |
|---|---|---|
| Source fact | `baton2_knowledge` scope is a free-form string — `mcp-conductor.mjs:504`; same for `baton2_knowledge_relations` — :515. `baton2_knowledge_search` scope carries the enum `['worker','group','universal','all']` — :525; `baton2_knowledge_traverse` carries scope and direction enums — :535,537. Two of the four knowledge read tools accept arbitrary scope strings at the schema layer; the coordinator refusal (knowledge-record:854a5eb, e5fcabf) covers behavior after the schema admits the call. | `pm_kg_traverse` requires `node_type` and integer `node_id` — digest:43-45. #779: pm edge enums carry explicit validation while some missing arguments receive defaults. |
| Untested | Whether schema-level enums for scope/direction should be uniform across all four tools (knowledge-record:5e01ea8 flags the mismatch; the #783 candidate arms carry the coordinator-side refusals). | — |

### Writes, notices, identities

| | Baton | pm |
|---|---|---|
| Source fact | Record, typed record, linked record and promotion each commit finding plus notice in one transaction and answer the stored row — `knowledge.bend:358-377, 421-429`. Identity conflicts preserve the stored record and return a named condition with a retry path — `knowledge.bend:260-261`. Baton generates finding and relation identities; authors supply semantic content. Record notices go to the author's parent; promotion notices to the destination owner — `knowledge.bend:252-256, 334-339`. `--evidence report` selects the unique authored report to the canonical coordinator after the current assignment; missing or ambiguous refuse — `mcp-conductor.mjs:549`, issue #730 (112333a5). | `pm_log_finding` auto-links on write — v6:34. `pm_experiment_create`'s "check pm_search first" rule lives in the tool description and is unenforced — digest:69-70, v6:140-142. |
| Measured | pm F2/F3/F4 above; relation retry behavior in pm was not established (#779). Baton: a sibling can replace a relation row and its author by reusing the explicit relation id (#785, issue-recorded; fix owned by knowledge-deepseek). | — |
| Untested | Assignment-sequence ordering for `--evidence report` under re-parenting (see #730 below). | — |

## Per-issue critique and verdicts

### #782 — law gate (verdict: mechanism landed at dd62ce8; acceptance is candidate-lineage)

First-hand source facts at dd62ce8: `laws.bend:6` imports `knowledge-laws.bend`;
`check-native.sh:14` runs `bend2/src/coordinator/laws.bend --check-only` before
the native builds; `.github/workflows/bend2-native.yml:336` invokes
`check-native.sh` as the `complete-native` record with fail-fast on exit code.
The knowledge law pins at dd62ce8 match the current source: the m1 schema pin
includes `kind`, the endpoint kind columns and `knowledge_relations`
(`knowledge-laws.bend:11` vs `knowledge.bend:17-19`); `promotion_admitted` is
pinned at its three-argument arity (`knowledge-laws.bend:85` vs
`knowledge.bend:306`); typed records, linked records, scoped promotions,
search, traversal, relations and the historical-schema fallbacks carry their
own laws (`knowledge-laws.bend:317-445`).

Relayed acceptance state: the hosted aggregate check passed once at source
a16fbc5e3 with driver 045d83dc, run 38989564886 (86.928s, 11,583,000 KiB max
RSS, all terms check, 25 definitions relying on unsafe or foreign code); two
earlier hosted failures (38988419899 `connect_refusal…`, 38988810476
`m2_tx_empty_answer_stays_unresolved`) and five homelab failures remain
preserved (#782 comments). Neither a16fbc5e3 nor 426ed4298 exists as a git
object in this checkout (`git cat-file` fails for both; first-hand), so the
candidate lineage is recorded in the issue and knowledge records only.

Critique. The gate addition serves the recorded failure named in #782 (the
suite compiled in no gate and pinned stale arities), which satisfies the
observed-failure requirement. The remaining defect is evidence lineage, not
mechanism: the single hosted PASS binds to a source absent from this checkout,
and the release head has no hosted aggregate result. The permanent-gate
question reduces to a property the wiring already has — every `complete-native`
CI run executes the check — plus one acceptance: a hosted aggregate run at the
release head, recorded with its own receipt. The issue's remaining items (full
coordinator compilation, public command tests, native execution, package
installation, release acceptance) are separately owned and open.

Scoping: keep #782 out of the #783/#785 candidate; the law update and the
command-surface fix share no file state that requires a joint arm (the
knowledge laws at dd62ce8 already pin the post-fix refusal shapes; if the
#783/#785 candidate changes refusal strings, its law pins must move with it —
knowledge-record:ffa59881 records exactly this coupling for the index
candidate's m1 pin).

### #784 — evidence contract (verdict: adopted design is correct; centralize the prefix definition; adopt the frozen packet)

The two options in #784 are: validate `message:` references at record time, or
keep free-form evidence and define which prefixes participate in citation
lineage. The implemented candidate (6deeb70aa on
`codex/knowledge-evidence-784-20261016`) took the second option and added
resolution reporting: `evidenceReference` with `retained`/`missing`/`external`
on full, index, search and traversal reads, `targetResolution` on derived
citation edges, and external kind retained under literal-ID collisions (issue
comment; relayed).

Critique. The adopted option is the right one for this codebase. Record-time
validation would add a cross-table existence dependency to every record write
and would need a named refusal for a state (`message:` target pruned later)
that the write itself cannot prevent; free-form evidence plus read-time
resolution keeps `finding_statement` verbatim (`knowledge.bend:271-274`) and
gives consumers the distinction the issue demands. Two open items:

1. The citation-prefix list exists as a SQL string in `graph_edges_sql`
   (`knowledge.bend:186`) and separately in tool descriptions. The #784
   contract should name the prefix set once and derive both the edge
   derivation and the documented behavior from that definition; otherwise the
   next prefix lands in one place and not the other. Resolution of the
   implemented candidate's own structure is unresolved here (the candidate
   source is not in this checkout).
2. The prefix set is closed (`message:`, `finding:`, `file:`, `http://`,
   `https://`, `external:`). Evidence with an unlisted prefix is silently
   outside citation lineage; the resolution-reporting field is what makes that
   state visible. Any new prefix needs a recorded reason, per the
   observed-failure rule.

Acceptance: the frozen 101-call paired qualification packet (current and
historical schemas, missing targets, late-inserted targets, scoped discovery,
opaque evidence, prefix collisions) should be adopted via release_adoption and
run once on the remote arm. Do not rebuild or duplicate its run; the retained
packet is the evidence unit (repo rule on owned executions).

### #710 — structured causal nodes and edges (verdict: design questions correctly framed; four need explicit decisions)

Source facts: relations carry five columns and authored strings
(`knowledge.bend:19`, `:380`); provenance is derived per edge (`authored` vs
`recorded-evidence`, `knowledge.bend:184-186`); kinds are free-form. The
scientific-schema candidate (root-owned) has a closed ten-node/sixteen-relation
schema, a remote 85-case SQL-helper passage, a 197/197 reading run, and
recorded citation-projection defects: an unprefixed source reference, every
referenced record labeled evidence, one citation ID reused across references
(issue comments, relayed).

Design questions this critique adds:

1. Provenance placement. Keep assertion-level provenance (claim, evidence,
   limits) on nodes, where Baton already stores it, and limit relation-level
   provenance to the assertion the edge itself makes (basis, scope). Duplicating
   node provenance onto edges is the failure mode the recorded citation
   projection already shows.
2. Identity spaces. The scientific projection introduces `v1:` node references
   alongside the existing normalization of bare IDs to `finding:ID` and
   `message:` prefixes (`knowledge.bend:56-63`). One reference grammar should
   govern routing and resolution; the recorded projection defects are all
   grammar violations (unprefixed source, reused citation identity). A citation
   identity should be unique per (citing record, reference) pair.
3. Revision semantics. Authored `supersedes` relations permit several
   predecessors while a revision projection selects one (issue comment,
   2026-10-11T14:32Z). Either define revisions as all-predecessor with an
   explicit primary flag, or forbid multi-predecessor supersede at admission;
   the current state lets a reader's revision view depend on an
   under-specified selection.
4. Scoped support and contradiction. Promotions record endpoint kinds
   (`knowledge.bend:18`), so a support assertion can name the scope in which it
   holds. The schema should make that endpoint explicit; a support edge without
   a scope endpoint reads as support in all holdings, which the holdings model
   does not warrant.

One interaction with retrieval: `search_score` adds the incident-edge count to
the lexical score (`knowledge.bend:202`). That is a recall-ordering term. Keep
it out of any causal-admission semantics: #710 bars inferring cause from
co-occurrence, and a degree-driven rank is co-occurrence weighting inside the
read path.

Verdict: root owns design and integration; the four decisions above belong in
the schema review before further integration; the existing measured candidate
arms stand on their own and are accepted as recorded.

### #711 — numeric precision boundary (verdict: transport invariant, and the schema is where a durable guarantee can live)

Recorded chain (all relayed from #711 and #710): at source 38eb7757 the public
overview returned `9007199254740992` for authored `9007199254740993` and
truncated a 30-digit decimal to 17 significant digits; rendering the original
response directly in the browser produced the same rounding — so both server
serialization and browser number parsing rounded. Correction 966e593c preserves
authored numeric token text through scientific MCP authoring, HTTP reads,
rendering and search; the later native run (ee973, 114 checks with 50 numeric)
retained exact tokens in the SQLite payload and details, native CLI, overview
HTTP, actor HTTP and six browser observations. The #710 identity projection
preserves raw numeric spelling and precision at admission.

Boundary analysis. With the JSON number wire type retained, fidelity is a
property of every parser in the chain: any consumer that parses a plain JSON
number into a 64-bit float rounds it, and no server or renderer fix removes
that. A durable guarantee can only come from the data model: a typed quantity
carrying the authored lexeme (string) plus unit, with the double-precision
value as a derived convenience. The scientific schema's quantity/unit fields
already move in that direction (#710). The acceptance for plain JSON numbers
remains what the measured runs already exercise: token preservation at the
server and the renderer, verified by exact-string comparison.

Recommendation: #711's closing acceptance should name the boundary explicitly —
schema-level guarantee for typed quantity fields; transport token preservation
as the acceptance test for plain numbers; browser render treated as display
evidence only. Anything that promises schema-level fidelity for plain JSON
numbers overstates what the format supports.

### #724 — scratchpad (verdict: compose from knowledge rows; close two design gaps before implementation)

Source fact: Bend2 at dd62ce8 has no scratchpad operation. The only occurrences
of the word in `bend2/src` and `bend2/scripts` are prose: the inherited-input
label in `branching.bend:74` and an onboarding print in
`trial-start.sh:117` (first-hand absence check, matching #724's recorded
surface evidence).

Recorded design (elevation-and-sharing lane, relayed): notes are knowledge rows
with authored kinds `note`, `plan`, `doubt`; append writes a new row plus a
`DerivedFrom` or `Continues` relation; elevation composes `record-linked` with
a `DerivedFrom` edge to the note version; one store, existing scopes, private
note scope deferred; the duplicate-promotion guard is a separate candidate
(knowledge-records dcee67d, 2ecd4f3, 9f03437).

Critique. Composition from existing rows reuses record-linked, scopes,
promotions, notices and conflict handling, and stores notes in the database,
which the task-storage rule requires. Two gaps need decisions before
implementation:

1. Append order. Knowledge reads order rows by `k.rowid`
   (`knowledge.bend:125,148,151`), and relation rows carry no authoring
   sequence. A pad read that must reproduce append order needs an explicit
   ordinal (an entry-sequence attribute inside the payload convention, or a
   numbered relation); `rowid` is a storage detail that index and migration
   work may reorder, and the approved index candidate already changes relation
   read ordering assumptions (`ORDER BY r.id`, knowledge-record:ffa59881).
2. Versioned typed payloads. The knowledge row has claim, evidence and limits;
   "versioned note, plan and doubt payloads" can live inside those fields only
   by convention. #724 itself orders the payload/elevation schema review with
   #710 before implementation; that ordering is correct and should hold — the
   typed-payload decision and the #710 schema land together or the scratchpad
   grows a private format.

Elevation satisfying the recorded requirement (preserve the original note,
record the resulting knowledge reference and provenance) is already provided by
append-only relations and promotion rows (`knowledge.bend:19,18`).

Acceptance: unchanged from the issue — remote qualification of complete bodies,
typed plans/doubts, ordered append, authority refusal, elevation evidence and
scoped retrieval, then ordinary installed use.

### #730 — evidence inference (verdict: unambiguous-only is the correct contract)

The implemented selection (`112333a5`, corrections `3dc341cd`) accepts
`--evidence report` and requires exactly one report authored by the current
actor to its canonical coordinator after the current retained assignment;
missing assignment, no report, and ambiguous reports produce precise refusals;
explicit references keep their full values (issue-recorded). The MCP schema
documents the same rule (`mcp-conductor.mjs:549`, first-hand). The task
scoping — unambiguous only — matches the recorded contract and should stay:
any "latest report" fallback would select content the author did not choose,
which the issue names unacceptable.

Open items: remote and installed acceptance under #717/#727; the driver
prerequisites corrected at `3dc341cd` need their own qualification run; the
contract depends on an ordering of retained assignments (selection is scoped to
"after the current assignment") and on the canonical-coordinator resolution —
under a mid-session re-parent, the refusal conditions should name which
coordinate moved. Naming that total order in the help/schema text is a small
contract completion, not a mechanism change.

### #746 — promoted-root consumer (verdict: correct surface; hold for the final installed candidate)

First-hand scope semantics: `universal` selects root sessions holding
conductor roles (`knowledge.bend:81`), and holdings under that scope are
findings authored by those holders or promoted into them
(`knowledge.bend:90-91`). The integrated correction (`60a3741cc`, relayed)
scopes the consumer and fresh-consumer task instructions and the consumer
verifier to `knowledge read --scope universal --subject root`, preserving the
producer and root audit reads, the producer-to-root promotion, full evidence
bodies, the producer-local absence assertion and the landing requirements.

Critique. The correction turns the verifier's absence assertion into a
holdings assertion derived from recorded scope semantics — the producer-local
finding is absent from root holdings because nothing promoted it there, which
is the property the consumer acceptance should test. The hold is correct: the
acceptance run belongs to the final installed candidate, on the frozen packet,
with no duplicate runs of earlier arms. No production API change is involved;
nothing to qualify beyond the pending native run.

### #777 / #707 — REPL commit-and-cite (verdict: design-only on Bend2; substrate unbuilt; sequence after #778; route cross-team questions to runtime-wonder)

First-hand facts. `docs/33-shared-objects-repl-layer.md` (v2) defines the
commit-and-cite substrate: content-addressed immutable JSON cells up to 64 MB,
named bindings mapping `(scope, name) → cell:<sha256>` with immutable versions
and per-scope fences, citation grammar `repl:<scope>:<name>@<version>` binding
versions, settled-only cell resolution with named revalidation semantics, and
the non-goals list (no mutable objects, no cross-run bindings, no
worker-authority shared writes) — docs/33 §1-§3, §6. Its substrate citations
are `context-program.mjs`, `application.mjs`, `coordination-admission.mjs` —
the pre-Bend2 implementation surface. Baton2 at dd62ce8 exposes
`baton2_context_query` and `baton2_context_result` only (`mcp-conductor.mjs:487-499`);
no REPL and no named shared-object evaluation exists in the Bend2 entry (#707
body). #778 requires actual Bend2 expressions and a REPL implemented in Bend2;
#777's recorded comment accepts persisted definitions and evaluation records
as the citable immutable context and states the earlier JSON context-program
surface does not establish the Bend2 REPL requirement.

Critique.

1. The "what exists" section of #777 describes the older implementation's
   substrate. On Bend2, cells, bindings, fences, the citation grammar, grants
   and the wake stream are all unbuilt. The issue's four-item build list
   (commit path, snapshot convention, receiver projection, cross-seat
   authorization) therefore understates the work by the entire substrate;
   commit-and-cite on Bend2 is a design proposal whose first deliverable is
   the #778 REPL with persisted definitions and evaluation records.
2. Cross-seat read authorization on Bend2 needs its own authority record. The
   grant pattern #777 cites (`claimGrant`, one closed grant per delivery) is
   old-implementation; Bend2 authorization is recorded sessions and roles
   (the knowledge scope checks resolve holders through `sessions` and
   `session_roles`, `knowledge.bend:79-81`). A Bend2 design needs a recorded
   grant row or a deployment-scoped binding namespace in the coordinator
   store, and docs/33 §6's cross-run-binding non-goal must be resolved
   explicitly: passing between seats is the case that non-goal was written
   around, and #777 resolves it with run-scoped grants or a deployment-scoped
   namespace — Bend2 must pick one before any implementation.
3. Sequencing: keep #777 scoped Bend2-only, sequenced after #778 so citations
   resolve against persisted definitions and evaluation records; route the
   cross-team runtime and REPL questions to runtime-wonder (per this
   assignment's routing). The recorded minimal experiment (token cost against
   an inline-transcript baseline; receiving-seat prefix-cache behavior) is the
   right acceptance measurement and stays as designed.

## Sources read in this session

- `bend2/src/coordinator/knowledge.bend` (full, 429 lines)
- `bend2/src/coordinator/knowledge-laws.bend` (full, 445 lines)
- `bend2/src/coordinator/laws.bend:1-23`
- `bend2/scripts/mcp-conductor.mjs:487-567`
- `bend2/scripts/check-native.sh` (full)
- `.github/workflows/bend2-native.yml:324-348`
- `docs/33-shared-objects-repl-layer.md` (full)
- `docs/reference/evidence/pm-comparison-2026-08-13/pm-digest/src_mcp_tools.rs`
  (digest lines 42-46, 69-73, 144-148, 227-231)
- `.../pm-digest/v6-cognitive-augmentation-scope.md` (lines 28-56, 82-100,
  215-219, 251-259)
- `.../pm-kg.md`, `pm-agent.md`, `pm-qa.md`, `pm-redteam.md` (cited rows with
  line numbers)
- `docs/capabilities/causal-research-bok.md:219-226`
- `docs/bend2/todo.md` (issue-context rows)
- GitHub issue bodies and comments, fetched 2026-10-17: #779, #782, #784,
  #710, #711, #724, #730, #746, #777, #707
- Baton knowledge findings: 54 visible records via `baton knowledge read`
  (quoted as knowledge-record:<id>)
- https://www.sqlite.org/fts5.html (§1, §3 structure, §5.1.1)
- https://arxiv.org/abs/2405.14831 (HippoRAG abstract)

## Unresolved (relayed, not independently verified here)

- Hosted run outputs 38988419899, 38988810476, 38989564886; the Main9 homelab
  reproductions; the pm live reproductions F1-F5; the volta-renaissance
  `pm_kg_audit` 70/100; the fixture metrics in knowledge-records 2d7d81aa and
  ffa59881; the e5fcabf candidate evidence; `docs/bend2/knowledge-graph-audit-779-20261017.md`
  at 6321725 (absent from this worktree at dd62ce8; state quoted from
  knowledge-record:c2131797).
- The pm deployed binary's exact source commit (#779 records it as unproved);
  the pm `src_mcp_tools.rs` original (only the in-repo digest read).
- Research primaries not read here: HippoRAG2, GraphRAG (local-search docs),
  RAPTOR, LightRAG, IRCoT, the original PageRank papers, PROV and SOSA. The
  #779 research lane's readings of HippoRAG, HippoRAG2, GraphRAG and FTS5 are
  recorded on the issue; this document's research column rests only on the two
  sources listed above.
- Caution: `docs/reference/upstream/WONTFIX.txt:22` references "#784" in the
  Bend compiler's own tracker (template-argument evaluation). It is a number
  collision and has no relation to Baton issue #784.

No compilation, build, test or runtime claim is made in this document; every
executed observation is relayed from its recorded owner above.
