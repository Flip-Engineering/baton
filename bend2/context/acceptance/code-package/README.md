# Code-package installed-acceptance harnesses

Independent package/installed-acceptance qualification for the semantic
context implementation. These harnesses gate the staged package and the
installed artifacts; production sources are read-only inputs here. Owned by
the package/installed-acceptance critic (`semantic-impl-code-package-critic`).

Execution boundary: compilation, toolchain probes, extractor runs, query runs
and catalog reads are remote-runner operations. This directory ships the exact
commands; see `REMOTE-RUNBOOK.md`. A harness run without its candidate inputs
refuses with a structured missing-inputs report and never passes vacuously.

## Harnesses

- `ts-package-isolation/harness.py` — under the exact Node 22.15.0 floor and
  the qualification host's Node, on an isolated staging of the bundled
  TypeScript: pin identity (5.9.3), package-relative resolution with no
  ancestor `node_modules` and a scrubbed environment, license/manifest
  identity, the bundled public `d.ts` declaring every API the probe uses while
  the measured runtime-only surface stays absent, the probe source itself
  type-checking against the bundled declarations with `types: []` (mechanical
  public-API-only gate), zero ambient acquisition into the fixture program,
  and useful language-service results (barrel alias resolution, grouped
  references with the quoted-literal entry present and the any-receiver blind
  spots held, incoming call hierarchy, clean-fixture zero diagnostics,
  mutation-control TS2454, real emit).
- `clang-artifact-closure/harness.py` — inspects and executes the staged
  first-party extractor against the declared external LLVM/Clang 20.1.8
  closure: provider identities, architecture, full load-command resolution
  with each recorded dylib's existence, `clang-cpp` linkage, pinned
  `ClangConfig.cmake`, resource-dir headers, SDK access on the owned C
  fixture, and the mutation-sensitive extractor smoke when the extractor
  owner's invocation template is supplied. Absolute external load commands are
  recorded as observations; the accepted contract keeps LLVM external and
  imposes no bundling or rpath-only requirement.
- `fossil-five-family/harness.py` — hash-verifies the retained authentic
  Fossil inputs (`manifest.uuid` check-in identity, `src/report.c`,
  `bld/report_.c`, `bld/db_.c`, `runtime-connection/allowed.fossil`),
  recomputes catalog facts for the handler statement read-only, and then, on
  the candidate: the ordinary view_list same-handler query with useful
  evidence in all five families (empty formal list, typed global permission
  operands, nonempty resolved `db_prepare` parameter types, direct calls,
  guard/deny/effect relations, `reportfmt` catalog join), the separate
  selected `db_prepare` query (nonempty formal list, variadic), and the
  mutation controls on verified copies (guard change moves the derived
  relation; helper-body/callee-identity/SQL-format changes prevent unjustified
  joins). Joined-result predicates resolve through a caller-supplied
  codec-schema map; no result schema is invented here.

## Shared machinery

`common.py` — child execution with complete stdout/stderr/exit capture, sha256
identity recording, atomic evidence writes, ancestor `node_modules` detection,
scrubbed environment construction. Exit codes: 0 pass, 1 fail, 2 usage,
3 refused-missing-inputs. No internal work deadlines, retry ceilings or
deliberate waits.

## Evidence

Each run writes `evidence.json` plus raw child stdout/stderr files and parsed
probe state under the caller-provided private evidence directory. Evidence
identity requirements: real child exit statuses, complete output bytes, input
and artifact sha256s.
