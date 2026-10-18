# Knowledge storage and traversal measurements, 2026-10-17

Evidence for `docs/bend2/knowledge-storage-traversal-20261017.md`.

## Files

- `measurement.json`: fixture definition, layer 0 and layer A end-to-end
  measurements, write cost, index build and database bytes, layer B SQL-level
  measurements and limitations.
- `captured-sql.json`: the exact read, index, detail, relations, search and
  traverse statements the retained binary executes. Statements were captured
  with an `LD_PRELOAD` shim around `sqlite3_exec`.
- `plans-unindexed.json`: `EXPLAIN QUERY PLAN` rows for the captured statements
  on the unindexed fixture.
- `plans-indexed.json`: the same rows on the copied fixture with the five
  indexes named as in the candidate.
- `plan-summary.json`: the distinct scan and search lookups from both plan sets.
- `equivalence.json`: current and candidate SQL comparison on the modern,
  empty, missing-relation, legacy and no-group fixtures.

## Reproduction

The end-to-end measurements come from the probe:

```sh
python3 bend2/scripts/probe-knowledge-storage-traversal.py \
  --binary /run/baton2-native-homelab/retained/baton-knowledge-730-746-main9-20261016/knowledge-context/bin/baton2 \
  --findings 10000 --relations 30000 \
  --search-findings 2000 --search-relations 6000 \
  --out probe.json
```

The probe builds both fixtures with the binary, inserts the rows, measures the
commands before and after creating the five indexes, and reports the index
build, database bytes, write cost and the planner lookups for the five index
shapes.

The plan files were produced by capturing the statements and running
`EXPLAIN QUERY PLAN` through `sqlite3`. The comparison in `equivalence.json`
runs the captured statements and the candidate statements against the same
databases and compares complete JSON after normalizing only explicit array
order. The candidate statements are generated from the source text; no
coordinator was compiled on this host.

`probe.json` is the probe output from the run recorded in `measurement.json`.
