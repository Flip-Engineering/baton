# Runtime security and lifecycle fixtures

Portable fixture set for the CDP runtime lane. It replaces the earlier private
scratch fixtures, which hardcoded a host worktree path and a Homebrew Node
binary. The scratch originals and their results stay unchanged under
`.scratch/evidence-security-critic/`; this directory is the successor set for
admitted remote execution.

## Environment contract

Nothing here hardcodes a host path. The runner injects:

| Variable | Meaning |
| --- | --- |
| `BATON_PRODUCER_ROOT` | absolute root of the admitted producer worktree |
| `BATON_FLOOR_NODE` | absolute exact-floor Node executable |
| `BATON_EVIDENCE_DIR` | absolute directory for result artifacts (must exist) |
| `BATON_EXPECT` | `historical` or `corrected` (default `corrected`) |
| `BATON_EXPECTED_PRODUCER_HASHES` | optional file of `sha256  <path>` lines to validate |

The producer runtime directory is resolved as
`$BATON_PRODUCER_ROOT/bend2/context/runtime`. Helper scripts are resolved
relative to the fixture file itself, so the checkout can sit anywhere.
`BATON_EXPECTED_PRODUCER_HASHES` is matched by basename; a mismatch or a missing
listed file fails the run before any observation, because the review then does
not apply to that tree. Every fixture records `platform`, `arch`, `os.release()`,
the Node version, the floor executable path and its SHA-256, and the producer
digests it read.

## Modes

`BATON_EXPECT=historical` reproduces the defects that were found:

- `bootstrap-exec`: a directory or a mode-0644 file named as the target Node
  emits `launchAdopted` and the process aborts with `status null`, `signal
  SIGABRT`.
- `grants-admission`: `Runtime.runIfWaitingForDebugger` and the `NodeWorker`
  state changes are admitted with no grants and outside the pending-intent
  serialization, and a breakpoint condition is forwarded with an empty effect set.
- `endpoint-watch`: a missing stderr file throws `ENOENT` out of the module.

`BATON_EXPECT=corrected` accepts the fixed candidate and asserts the opposite
outcomes for those same points: a structured bootstrap refusal with a numeric
exit status and no `process.execve` abort, refusal of the ungranted methods and
of mutate requests while an evaluation is pending, an evaluate grant requirement
for a condition-carrying breakpoint, and a missing file refused through the
module's failure channel without a throw. A corrected run does not fail because
the historical expectations name `SIGABRT` or ungranted admission, and a
historical run does not fail because the candidate refuses.

Both modes assert the positive controls: launch requires `controlRuntime`,
evaluate and pause-family requests refuse on the send path, the observe intent
requires no grants, and worker inner evaluate and resume refuse.

## Platform expectations

The environment boundary check allows exactly the platform text-encoding
addition. On darwin that is `__CF_USER_TEXT_ENCODING`; on linux the allowed
addition set is empty, so any extra key fails the fixture.

## Exact remote invocation

```
NODE=<exact floor executable for the platform>
EVID=<absolute empty evidence directory>
cd <this directory>

"$NODE" --version                          > "$EVID/node.version.txt" 2>&1
shasum -a 256 "$NODE"                      > "$EVID/node.sha256.txt"  2>&1
shasum -a 256 <producer runtime dir>/*.mjs > "$EVID/producer.sha256.txt" 2>&1

BATON_PRODUCER_ROOT=<admitted producer root> \
BATON_FLOOR_NODE="$NODE" \
BATON_EVIDENCE_DIR="$EVID" \
BATON_EXPECT=corrected \
BATON_EXPECTED_PRODUCER_HASHES="$EVID/producer.sha256.txt" \
"$NODE" run-all.mjs
```

`run-all.mjs` executes each fixture as a child and exits non-zero when any
failed. Each fixture writes its own `<name>.result.json` and exits 0 only when
every assertion passed; an environment refusal exits 3 with the condition on
stdout. Re-run the same command with `BATON_EXPECT=historical` against the
pre-fix tree to reproduce the original defects.

## Coverage limits

These fixtures assert provider behavior and pure admission functions only. They
do not cover, and must not be read as covering:

- S3 endpoint identity from the path rather than the descriptor: forcing a
  replacement between `openSync` and the identity capture needs a dedicated
  race harness that this set does not provide.
- S4 transport close semantics against session state: the resume-on-close
  behavior is measured by `inspector-boundary`, but the session record's stale
  `paused` claim needs a session-level fixture.
- S5 loopback validation on the launch endpoint and S6 the delivered law import
  fragment: both are code and integration obligations with no provider-visible
  behavior here.
- Keeper custody, role admission, observer recovery and owner notification: no
  Baton keeper is involved.
