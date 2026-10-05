# Context models package critic checks

Owned by session `semantic-impl-models-package-critic`. This directory holds
independent executable discriminators for package and installed acceptance of
the models-domain context providers (catalogs, SQLite, schemas/models,
environment). All execution happens on admitted remote runners; nothing here
runs on the operator laptop.

## What the checks require

- `node-floor.mjs`: the exact Node 22.15.0 runtime opens SQLite databases
  read-only, refuses writes, and lacks `StatementSync.columns`,
  `DatabaseSync.setAuthorizer` and function registration. Records the bundled
  SQLite engine identity and compile options. A host-Node run records the
  differential facts without assertions.
- `dependency-pins.mjs`: `bend2/context/package.json` and its lockfile pin
  exactly `ajv@8.17.1`, `zod@4.3.6`, `typescript@5.9.3`, with the manifest
  named `baton2-context`, private, ESM, Node floor `>=22.15.0`, lockfile
  version 3, one flat entry per package, registry resolve URLs, sha512
  integrity, and closure completeness. Staged `node_modules` manifests must
  agree with the pins.
- `ancestor-isolation.mjs`: the staged models adapter serves a
  `schemaValidation` request using only the staged closure
  (`libexec/baton2/context/node_modules/ajv`). A poison Ajv planted in the
  exercised ancestor must never load. The negative control removes the bundled
  Ajv: the adapter must then refuse and must not fall back to the planted
  ancestor copy.
- `target-zod.mjs`: the staged `zod-child.mjs` refuses a target project whose
  resolved Zod is not exactly 4.3.6 before importing anything (poison marker
  stays empty), reports the observed version in the refusal, and returns the
  actual engine verdict, output value and serialization text for an admitted
  4.3.6 target.
- `useful-results.mjs`: the staged models module, with Ajv injected from the
  staged closure, returns actual `validate`/`admit`/`validateSchema`
  verdicts: valid and invalid samples with real error keyword and instance
  path, `unknownFormat` refusal, `referenceOutsideResources` refusal, and the
  metaschema checked verdict. An unexpected throw fails the check.
- `psql-prereq.mjs`: `psql --version` is exactly 14.18, with the executable
  path and digest recorded.

## Exit codes

A check prints one JSON line with `status` of `pass`, `fail`, or `gate-open`,
then exits 0, 1, or 6. A gate-open status means an owned artifact is not yet
available; missing artifacts remain a gate and never count as acceptance.
`run.mjs` aggregates the lines, writes a report file, and exits 0 (all
closed and passing), 1 (a failure), or 3 (a gate open).

## Invocation

```
node run.mjs --node22 <exact node 22.15.0 path> [--node22-sha256 <hex>]
             [--context-dir bend2/context] [--staged-dir <payload root>]
             [--real-zod <dir>] [--work <dir>] [--out <file>]
```

`--staged-dir` points at a packaged payload root whose
`libexec/baton2/context/` holds the staged sources and the extracted
dependency closure. Without it, the payload checks stay gate-open.
`--floor-host-only` runs only the host-Node differential probe.

## Remote qualification

`REMOTE-QUALIFICATION.md` holds the immutable source pins and the exact
remote commands for the Linux runner and the distinct Darwin qualification.
