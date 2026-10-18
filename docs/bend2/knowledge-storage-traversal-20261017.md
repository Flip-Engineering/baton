# Knowledge storage and traversal scalability

Audit for [#779](https://github.com/Flip-Engineering/baton/issues/779), worker
position in Ensemble `knowledge-branching-ds-20261017`. Branch
`knowledge-storage-traversal-20261017`, rebased on `2d03892`. The index and
ordering candidate is commit `824c3f0`; the query rewrite is a second commit on
the same branch. Neither commit is merged into `knowledge-deepseek-782-785`.

## Scope

The work covers the storage and read paths in
`bend2/src/coordinator/knowledge.bend`: `knowledge_schema`, `knowledge_relations`,
`scoped_read_sql`, `scoped_index_sql`, `scoped_detail_sql`,
`relations_read_sql`, `graph_nodes_sql`, `graph_edges_sql`, `graph_answer`,
`search_text`, `search_score`, `search_sql` and `traverse_sql`. The matching
schema law pin in `bend2/src/coordinator/knowledge-laws.bend` is updated because
it pins the exact `knowledge_schema()` text. Promotion and elevation semantics
are unchanged.

## Measurement method

Fixture: 10,001 findings and 30,000 relations. A second fixture of 2,001
findings and 6,000 relations measures search because unindexed search grows with
both tables. Both are built by the retained production coordinator (Main9,
SHA-256 `d91c9e40efa00ec812f67eec304f0269bd3e45f8c25e89cae421888322ef476d`)
and then filled with direct SQLite inserts. The read SQL in that binary is
byte-identical to the current source: the commits after `dd62ce8` change
validation, refusal names and write-conflict checks, not the read SQL.

Three measurement sources are retained:

- The retained binary end to end, with process peak RSS from `wait4`.
- The exact SQL statements the binary executes, captured with an `LD_PRELOAD`
  shim around `sqlite3_exec`. The captured statements run through `sqlite3` so
  `EXPLAIN QUERY PLAN` and direct timings describe the same text.
- `bend2/scripts/probe-knowledge-storage-traversal.py` reproduces the end-to-end
  binary measurements, the index build, the write cost and the plan lookups.

The SQL files and plan dumps are in
`docs/bend2/measurements/2026-10-17-knowledge-storage-traversal/`.

## Current storage and read shape

`knowledge` has a unique id index. `knowledge_relations` and
`knowledge_promotions` have no index except their unique id. Every read
statement wraps the complete result in one `json_group_array`. Each finding
item includes three correlated subqueries: `knowledge_destinations`,
`knowledge_promotions` and `knowledge_relations`. The last one tests
`r.source IN(k.id,'finding:'||k.id) OR r.target IN(...)` for every finding.

Measured on the current source:

| Command | Layer 0, 10k/30k | Output | Peak RSS |
|---|---:|---:|---:|
| complete read, unindexed | 153.9 s | 18,282,458 B | 473 MB |
| complete read, indexed | 1.6 s | 18,282,458 B | 476 MB |
| index read, unindexed | 144.0 s direct SQL | 2,765,714 B | |
| relations read, unindexed | 0.6 s direct SQL | 8,034,985 B | |
| recursive traversal, unindexed | 465 s | 28,857,312 B | 732 MB |
| recursive traversal, indexed | 4.1 s | 28,857,312 B | 740 MB |
| single-hop traversal, indexed | 0.58 s | 4,999 B | 17 MB |
| search, 2k unindexed | 161.4 s | 204,401 B | 22 MB |
| search, 2k indexed | 2.6 s | 204,401 B | 23 MB |
| search, 10k indexed | 14.5 s | 1,002,625 B | 39 MB |

The complete read and recursive traversal materialize the whole result. RSS is
about 26 times the result text, because SQLite builds the JSON text, the host
copies it into a Bend String, and the coordinator writes it once. Indexes reduce
time; the two indexed rows above have the same output size and RSS as the
unindexed rows.

Query plans show the cost source. Without indexes, each finding runs `SCAN p`,
`SCAN p` and `SCAN r` in its correlated subqueries. Search repeats that scan per
node and adds a correlated edge count per node. With the five indexes, the same
statements use `SEARCH p USING INDEX knowledge_promotions_finding`,
`MULTI-INDEX OR` with `knowledge_relations_source` and
`knowledge_relations_target`, and `SEARCH r USING INDEX
knowledge_relations_author` for scoped relation reads. `relations_read_sql`
already scans the relation table by its unique identity index; it is unchanged.

## Layer A: storage indexes and relation order

Candidate `824c3f0` adds five indexes in `knowledge_schema()`:

| Index | Query that uses it |
|---|---|
| `knowledge_author` | scoped read `k.author IN (scope holders)`; a literal or single-row author membership uses the index |
| `knowledge_promotions_finding` | `knowledge_destinations`, `knowledge_promotions`, `promotionCount`, and the scoped promotion `EXISTS` |
| `knowledge_relations_source` | per-finding relation lookup and traversal joins on `source_ref` |
| `knowledge_relations_target` | per-finding relation lookup and traversal joins on `target_ref` |
| `knowledge_relations_author` | scoped relation reads `r.author IN (scope holders)` |

Measured effect on the same 10k/30k database: complete read 153.9 s to 1.6 s
(473 MB to 476 MB), recursive traversal 465 s to 4.1 s (732 MB to 740 MB),
index read 144.0 s to 0.1 s, search at 2k 161.4 s to 2.6 s. The probe records
the exact numbers for each command.

A second probe run on a loaded host measured the same direction and scale:
complete read 160.5 s to 1.9 s, index read 150.2 s to 0.34 s, recursive
traversal 912 s to 4.2 s, single-hop traversal 0.69 s to 0.68 s, relation read
1.00 s to 0.79 s and search at 2k 168.4 s to 3.2 s. Index build took 0.25 s and
database bytes grew by the same 2.4 MB.

Migration: indexes are `CREATE INDEX IF NOT EXISTS` statements in
`knowledge_schema()`, which every knowledge write already runs inside its
`BEGIN IMMEDIATE` transaction. A database written by an older coordinator gains
them on its first knowledge write after the upgrade. A read-only process sees
them only after that write. The first write pays the index build: 0.40 s for
10,000 findings and 30,000 relations, inside the existing write transaction and
under the same database write lock. There is no separate migration process,
owner interaction or lock ordering. Database bytes grow from 8,552,448 to
10,948,608 (+28%) on the fixture.

Write cost measured on the indexed copy: 2,000 finding inserts 0.22 s plain
and 0.20 s indexed; 6,000 relation inserts 0.35 s plain and 0.76 s indexed. The
probe run on a loaded host measured 0.10 s and 0.06 s for the finding inserts
and 0.13 s and 0.43 s for the relation inserts. Both runs show the relation
index maintenance cost; finding inserts stay within noise. The relation cost
comes from maintaining the source, target and author indexes.

The candidate also orders a finding's relations by relation identity:

```sql
SELECT json_group_array(json(item)) FROM (
  SELECT <relation item> AS item FROM knowledge_relations r
  WHERE r.source IN(k.id,'finding:'||k.id)
     OR r.target IN(k.id,'finding:'||k.id)
  ORDER BY r.id)
```

The derived table is required. An `ORDER BY` on the aggregate query orders the
single aggregate output row, not the rows the aggregate consumes. Before the
change, the same scope returned the same relation set in different orders when
the planner changed from `SCAN r` to `MULTI-INDEX OR`; the layer 0 and layer A
complete reads differ only in that order. Repeated reads now return identical
bytes for the relation arrays.

The law pin
`m1_the_knowledge_schema_retains_findings_and_promotions` now contains the five
`CREATE INDEX` literals in schema order. No other law is changed. The law suite
is still not wired into a gate and still fails in `messaging-laws`; this pin
update keeps it accurate for the work that owns #782.

A focused test is added in `bend2/test/knowledge_scalability.py`. It asserts
that a write installs the five indexes, that dropping them and writing again
restores them, that the five lookup shapes use the matching index, and that
repeated complete reads return every relation in identity order.

## Layer B: query rewrite

Candidate layer B is the second commit. It changes four things:

1. `graph_nodes_sql` carries node keys and search columns only: id, reference,
   kind, claim, evidence, limits and author. It no longer builds the full node
   item for every scoped finding.
2. `graph_answer` rebuilds a node item only for references in view, from
   `knowledge` by primary key, with the same scope filter. It orders roots,
   nodes and edges by identity.
3. `search_text` reads columns and the retained message body directly instead of
   extracting the body from the node item. `matches` carries reference, id and
   score; the match answer joins the node item back for matched references only.
4. `search_score` counts incident edges once in an `incident` CTE. A self-loop
   contributes once per matching endpoint reference, which matches the previous
   `source_ref=reference OR target_ref=reference` count. `search_sql` no longer
   rescans every edge for every node.

Measured on the same 10k/30k indexed fixture:

| Command | Layer A | Layer B |
|---|---:|---:|
| complete read | 1.10 s | 1.01 s |
| search, 10k, group42 | 14.5 s binary | 0.98 s |
| search, 10k, unindexed | not run | 21.0 s |
| recursive traversal | 4.14 s | 2.39 s |
| single-hop traversal | 0.58 s | 0.43 s |

Layer B changes array order where layer A did not define one: roots, nodes, edges
and relation arrays are now ordered by identity. Content is unchanged.

### Equivalence evidence for layer B

The compiled candidate could not run on this host. Equivalence is established at
the SQL level: the exact current statements captured from the retained binary
and the candidate statements generated from the source text run against the same
database, and the complete JSON is compared after normalizing only explicit
array order. `matchScore`, ids, `detailRead`, `evidenceMessage`, citation edges
and every item field are compared.

| Fixture | Cases | Mismatches | Shared errors |
|---|---:|---:|---:|
| modern: typed records, group promotion, evidence message, cycle, 5 scopes | 50 | 0 | 0 |
| empty knowledge, relation and promotion tables | 50 | 0 | 0 |
| no `knowledge_relations` table, legacy no-kind knowledge | 40 | 0 | 0 |
| legacy `knowledge` without `kind` | 40 | 0 | 0 |
| promotion table without `source_kind`/`destination_kind` | 50 | 0 | 40 |

The no-groups fixture returns the same error for the worker, group and universal
scopes in both forms (`no such column: p.destination_kind`, 40 cases); the all
scope succeeds in both (10 cases). That error is existing behaviour in
`scope_findings_sql`, which names the column in its group branch. A database
with `kind` but no `knowledge_relations` table fails in both forms because the
node item includes the relation subquery; the supported legacy path has no
`kind`, and it returns empty relation arrays in both forms.

The remaining risk is lexical: the candidate has not been compiled or executed
as a coordinator. The remote gate below is the first compiled result. The
existing `bend2/test/knowledge.py` must also pass there unchanged.

## Whole-graph materialization and bounded fork/flush

The Cgen fork-and-flush work split compiler emission into bounded work units and
flushed each unit before starting the next. The measured pair showed no speed or
peak-RSS gain. The transferable part is the shape: a unit of work has a stable
identity, its output leaves the process before the next unit starts, and a
failed unit records its failure.

The knowledge read path has the opposite shape today. `DB.Sql.read` returns the
rows of the last SELECT as one string. For a knowledge read that string is one
JSON object built by `json_group_array`, and the host `baton_sql_row` reallocates
and copies it once more before `io_str` stores it as a Bend String. Peak RSS is
about 26 times the result text, and the result text grows with the scoped graph.
A recursive traversal of a connected component returns every reachable node and
edge by definition. Bounds require a change to the output contract.

Three designs preserve the current contract or make a bounded contract explicit:

1. **Paged identity cursor.** Add an explicit read page form: a page is a keyset
   range over `knowledge.id` (and `knowledge_relations.id` for relation arrays),
   the response carries `next` or `complete`, and the default read stays
   complete. Each page is a separate SQL statement in one read transaction. The
   coordinator writes the page before requesting the next, so memory is one page
   plus the transaction's page cache. Ordering is the identity order added in
   layer A and B. A page boundary never splits an item; each node item carries
   its complete relation array. A caller that needs completeness iterates until
   `complete`, which preserves the complete-result semantics as an explicit
   sequence rather than one response.
2. **Host stream.** Add a host effect that writes each SQLite row to stdout (or
   to a caller-supplied file) inside the row callback, with a caller-written
   prefix and suffix. The result is still one JSON document and no full result
   text exists in memory. A failure after the prefix leaves a partial document
   on stdout and a nonzero exit status; consumers must check the exit status
   before parsing. That is a change to the current complete-or-error output
   contract and needs an explicit decision.
3. **Reference-first traversal.** Return references for nodes outside the
   traversal view and their complete items only through the existing detail
   read. This keeps traversal output bounded by the edge set and preserves
   complete results through a second read per node. It changes the traversal
   response shape and is a larger product decision.

Design 1 is the smallest change that keeps complete results available and adds
pagination semantics without a cap: the caller chooses the page size, ordering is
identity-based, and errors are named refusals for an unknown cursor. It still
needs a coordinator loop and a response field, so it is not implemented here.

## Acceptance packet

Index and ordering layer (`824c3f0`):

- Remote compile of `bend2/src/coordinator/knowledge.bend` with the repository
  toolchain pinned by commit.
- `bend2/test/knowledge.py` and `bend2/test/knowledge_scalability.py` on the
  same runner, complete output retained.
- Fixture check that the first write on a pre-index database creates the five
  indexes; the focused test covers it.

Query rewrite layer:

- The same remote compile and both test files.
- The equivalence table above repeated with the compiled candidate and the
  retained binary on the same fixture.
- Output comparison for the existing `knowledge.py` cases and the new graph
  case, normalizing only explicit array order.

Streaming design (not implemented):

- A two-seat fixture with a graph large enough to exceed the host memory bound of
  the runner, a page sequence that reaches `complete`, an interrupted page
  sequence that reports a named failure, and byte comparison of the concatenated
  pages against the complete read after page boundary removal.
- A decision on the partial-output contract for the host stream form.

## Limitations

- No local compilation or candidate execution. The remote gate is the first
  compiled result; the SQL-level equivalence is supplementary.
- Measurements use a synthetic uniform graph. Relation fan-out and evidence
  message bodies change the constant factors.
- RSS is process high-water from `wait4`, including SQLite page cache and
  allocator retention. It does not attribute bytes to a specific structure.
- The retained binary's read SQL matches the current source, but the binary's
  write paths and refusal names are older.
- Unindexed search at 10k findings was not run. The 2k measurement and the
  plan-level `SCAN r`/`SCAN p` per node are the evidence; the 10k layer B
  unindexed search (21.0 s) is measured with the candidate rewrite only.
- The probe run shared the host with other Baton processes. Absolute times in
  that run are higher than the quiet run; the index effect direction and scale
  agree.
- The law suite is not wired into a gate (#782). The pin update keeps the literal
  accurate but does not create a gate.
