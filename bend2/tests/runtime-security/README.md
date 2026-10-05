# Runtime security and lifecycle fixtures

Portable fixture set for the CDP runtime lane. Source only: nothing here runs
during authoring, and execution belongs to an admitted remote runner.

## Environment contract

| Variable | Meaning |
| --- | --- |
| `BATON_PRODUCER_ROOT` | absolute producer worktree root under test |
| `BATON_FLOOR_NODE` | absolute exact-floor Node executable |
| `BATON_EVIDENCE_DIR` | absolute evidence directory (must exist) |
| `BATON_EXPECTED_PRODUCER_HASHES` | absolute root-admitted manifest (required) |
| `BATON_HISTORICAL_PIN` | optional pin NAME that selects one historical case |
| `BATON_HISTORICAL_CLOSURE_SHA256` | optional cross-check equal to that pin's closure digest |

The pin is selected by **name**; the closure digest is an assertion, never the
lookup key. A digest passed as a name refuses with `historicalPinUnknown`.

The expected manifest is admitted input. It must not be produced by hashing the
tree under test. Observed digests are written to `*.observed.sha256.json` and the
suite summary, and are never fed back as expectations.

## Closure admission

Admission resolves the relative-import dependency closure of the modules each
fixture actually executes — `exec-continuity` and `bootstrap-exec` start with
`bootstrap.mjs`, `endpoint-watch` and `endpoint-replacement` with
`cdp-endpoint.mjs`, `grants-admission` with `cdp-intents.mjs`, `cdp-state.mjs` and
`cdp-session.mjs` — and requires the admitted manifest to cover every module in
that closure with a matching digest. The suite runner admits over the union of
all fixtures' entries before spawning any child.

Admission refuses, with a recorded condition and exit 3, on a missing or
relative variable, an absent or malformed manifest, a duplicate basename, an
incomplete manifest for the resolved closure, a missing closure module, or a
digest mismatch. Fixtures that execute no producer module (`json-list-fields`,
`inspector-boundary`) still record the observed digests for evidence.

## Modes

**Candidate mode** (default) uses the current surface: `admitReadRequest`,
`admitControlRequest`, `admitIntent`, `startupStopRequests`. It asserts that the
read path refuses control and evaluation requests, that the control path refuses
an ungranted request and admits a granted one, that control and serialized
intents refuse while an evaluation is pending even with full grants, and that a
condition-carrying breakpoint is refused while the condition-free request with
the same grants is admitted, including the startup-stop equivalent. Export or
table metadata is never accepted as proof.

**Historical mode** requires `BATON_HISTORICAL_PIN=review-verified-2026-10-05`
with the admitted closure equal to that pin's digest, and runs only
`bootstrap-exec` and `grants-admission`. The grants case uses the pinned adapter
over the historical surface (`admitRequest`, a breakpoint intent); the adapter
refuses when that surface is absent, so a historical run cannot silently fall
through to the current API. The retained evidence covers seven files only, so
`scopeComplete` is false and the run reports the executed modules that are
unverified for that era (currently `cdp-counter.mjs`). Missing old hashes are not
fabricated.

## Platform expectations

The environment boundary fixture allows exactly the platform text-encoding
addition: `__CF_USER_TEXT_ENCODING` on darwin and the empty set on linux, so any
extra key fails there. Declared environment values are compared as well as keys.

## Exact remote invocation

```
NODE=<exact floor executable>
EVID=<absolute empty evidence directory>
MANIFEST=<root-admitted frozen producer digest manifest>
cd <checkout>/bend2/tests/runtime-security

"$NODE" --version                       > "$EVID/node.version.txt" 2>&1
shasum -a 256 "$NODE"                   > "$EVID/node.sha256.txt"  2>&1
shasum -a 256 <producer runtime dir>/*.mjs > "$EVID/observed.producer.sha256.txt" 2>&1

# Candidate run
BATON_PRODUCER_ROOT=<producer root> \
BATON_FLOOR_NODE="$NODE" \
BATON_EVIDENCE_DIR="$EVID" \
BATON_EXPECTED_PRODUCER_HASHES="$MANIFEST" \
"$NODE" run-all.mjs

# Pinned historical run, separate evidence directory and pinned manifest
BATON_PRODUCER_ROOT=<pinned root> \
BATON_FLOOR_NODE="$NODE" \
BATON_EVIDENCE_DIR=<pinned evidence> \
BATON_EXPECTED_PRODUCER_HASHES=<pinned manifest> \
BATON_HISTORICAL_PIN=review-verified-2026-10-05 \
"$NODE" run-all.mjs
```

Each fixture writes `<name>.result.json`, raw debuggee streams as
`<fixture>.<tag>.stdout.txt` and `.stderr.txt`, and exits 0 only when every
assertion passed; a refused environment exits 3. The runner persists each
child's full stdout and stderr plus status, signal, error, timeout, byte counts
and any refusal line, and writes `run-all.summary.json` separately.

## Status and coverage limits

Authored source; not run or parsed on the operator laptop. Unvalidated until an
admitted remote runner executes it. Not covered, and not to be read as covered:

- the S3 endpoint identity race (remedied upstream by descriptor identity, not
  exercised here);
- the S4 session-level close state, the S5 loopback boundary and the S6 delivered
  law import fragment;
- keeper custody, role admission, observer recovery and owner notification;
- the approved public breakpoint shape beyond the grant behavior asserted above.
