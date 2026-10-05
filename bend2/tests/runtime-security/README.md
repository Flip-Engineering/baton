# Runtime security and lifecycle fixtures

Portable fixture set for the CDP runtime lane. It supersedes the scratch set and
the first committed version. Source only: nothing here runs during authoring, and
execution belongs to an admitted remote runner.

## Environment contract

| Variable | Meaning |
| --- | --- |
| `BATON_PRODUCER_ROOT` | absolute root of the producer worktree under test |
| `BATON_FLOOR_NODE` | absolute exact-floor Node executable |
| `BATON_EVIDENCE_DIR` | absolute directory for result artifacts (must exist) |
| `BATON_EXPECTED_PRODUCER_HASHES` | absolute root-admitted frozen manifest (required) |
| `BATON_HISTORICAL_CLOSURE_SHA256` | optional pin that enables one historical reproduction |

The runtime directory resolves as `$BATON_PRODUCER_ROOT/bend2/context/runtime`,
and helpers resolve from the fixture module location, so the checkout can sit
anywhere.

The expected manifest is an admitted input. It must not be produced by hashing
the tree under test: that would accept any tree. The runner records freshly
observed digests under `*.observed.sha256.json` and the suite summary, and never
feeds them back as expectations.

## Central source admission

`openEnvironmentOrExit()` runs in every fixture and in the suite runner before
any producer module is imported or any child is spawned. It refuses, with a
recorded condition and exit 3, when:

- the manifest path is absent, unreadable, or not absolute;
- any non-comment line is malformed, or a basename appears twice;
- the manifest does not cover every file in the imported dependency closure
  (`bootstrap.mjs`, `bootstrap-admission.mjs`, `cdp-intents.mjs`, `cdp-state.mjs`,
  `cdp-session.mjs`, `cdp-transport.mjs`, `cdp-endpoint.mjs`);
- a closure file is missing from the tree, or its observed digest differs from
  the admitted value.

The suite runner also refuses before spawning any fixture child, so a mismatch
produces no partial run.

## Modes

**Candidate mode** is the default and asserts the current tree's behavior:

- `bootstrap-exec`: a directory or a mode-0644 file named as the target Node is
  refused with a structured bootstrap record and a numeric non-zero status, with
  no `process.execve` abort; the real Node control starts the target.
- `grants-admission`: the effectful methods reachable through the observation
  send path refuse without their grant, mutate requests respect the pending-intent
  serialization, and a condition-carrying breakpoint requires the evaluate grant.
- `endpoint-watch`: a missing stderr file is refused through the module failure
  channel without a throw; replacement and truncation refuse by name.
- `exec-continuity`, `json-list-fields`, `inspector-boundary`,
  `endpoint-replacement`: provider behavior as named in each file header.

**Historical mode** runs only when `BATON_HISTORICAL_CLOSURE_SHA256` names a
registered pin whose closure digest equals the admitted closure exactly. The one
registered pin is `review-verified-2026-10-05` (closure
`edffa694953b8ba9d99b0833fdabe1651a7b0d52275baf073c119775b5d55018`), covering
`bootstrap-exec` and `grants-admission`. Under that pin the invalid bootstrap
documents abort with `status null`, `signal SIGABRT`, and the observation-path
methods are admitted without grants. A pin set for any other fixture refuses, so
candidate and historical eras are never mixed in one run. No historical
expectation is registered for `endpoint-watch`: the pre-fix stderr throw belongs
to a revision whose digest this critic did not retain.

## Platform expectations

The environment boundary fixture allows exactly the platform text-encoding
addition: `__CF_USER_TEXT_ENCODING` on darwin, and the empty set on linux, so any
extra key fails there. Declared environment values are compared as well as keys.

## Exact remote invocation

```
NODE=<exact floor executable for the platform>
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

# Historical run against the pinned closure (separate evidence directory)
BATON_PRODUCER_ROOT=<pinned producer root> \
BATON_FLOOR_NODE="$NODE" \
BATON_EVIDENCE_DIR=<pinned evidence directory> \
BATON_EXPECTED_PRODUCER_HASHES=<pinned manifest> \
BATON_HISTORICAL_CLOSURE_SHA256=edffa694953b8ba9d99b0833fdabe1651a7b0d52275baf073c119775b5d55018 \
"$NODE" run-all.mjs
```

`observed.producer.sha256.txt` is evidence of what was present; it is not the
expected manifest. Each fixture writes `<name>.result.json` and exits 0 only when
every assertion passed; a refused environment exits 3. The runner persists every
child's full stdout and stderr to `<fixture>.child.{stdout,stderr}.txt`,
including failed fixtures, records status, signal, error and refusal line per
child, and writes `run-all.summary.json` separately.

## Coverage limits and unexecuted status

The suite is authored source and has not been run or syntax-checked on the
operator laptop; it is unvalidated until an admitted remote runner executes the
invocation above. It asserts provider behavior and pure admission functions
only, and does not cover:

- the S3 endpoint identity race (forcing a replacement between `openSync` and the
  identity capture needs a dedicated harness);
- the S4 session-level close state;
- the S5 loopback boundary and the S6 delivered law import fragment;
- keeper custody, role admission, observer recovery and owner notification.

The conditional-breakpoint check establishes grant behavior only; the approved
public breakpoint shape (intent versus request construction) remains an open
question for the CDP owner, and table metadata is never accepted as proof.
