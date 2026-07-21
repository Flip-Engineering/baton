# Wave 5 — Nested Child Run Probe

## Outcome

The CLI could not reach the resident to start the bounded child run. `baton doctor --depth profile`
reported `connection: ready` (repository discovery succeeded) but `profile: missing`, `credential: not_read`,
overall `state: needs_setup`. The subsequent `baton run start` invocation failed with a
`cli_config_invalid` error indicating the user connection profile is unavailable. No child run was
created, so there is no run id, phase, or `run status` transcript to record.

## Child run

- Attempted command (first form, per help correction — see below): not applicable; the CLI rejected
  the `--exact` value before any run could start (see Errors).
- Corrected command actually executed:
  ```
  node impl/scripts/baton.mjs run start "nested child: list the program-ir module names into the scoped file" --exact "kimi-code/kimi-code/k3@high" --scope nested-child.md
  ```
- Result: command exited 2 with no run id emitted. Because no run was created, `run status` was never
  invoked and `nested-child.md` was never produced (there is no run to write it).
- Child run id: none (run never started).
- Child run phase: none (run never started).

## Errors

The originally suggested form does not match this CLI's actual grammar. `node impl/scripts/baton.mjs help`
and `node impl/scripts/baton.mjs help run` show there is no `run status` verb at top level parity with the
task text's phrasing beyond `baton run status RUN_ID`, and `--exact` must be `HARNESS/MODEL@EFFORT`
(one slash, one `@`), not the four-segment slash form given in the task
(`kimi-code/kimi-code/k3/high`). Running the literal task-supplied form first produced:

```
$ node impl/scripts/baton.mjs run start "nested child: list the program-ir module names into the scoped file" --exact kimi-code/kimi-code/k3/high --scope nested-child.md
baton: cli_invalid: --exact must be HARNESS/MODEL@EFFORT
```

Exit code: 2.

Correcting the `--exact` value to `kimi-code/kimi-code/k3@high` (harness `kimi-code`, model
`kimi-code/k3`, effort `high`, per the harness/model pairing documented in
`impl/src/application-deployment.mjs`) then hit a discovery/profile/auth failure — the CLI cannot reach
the resident. Exact stderr text, verbatim:

```
baton: cli_config_invalid: user connection profile is unavailable
```

Exit code: 2. Stdout was empty for both attempts.

For corroboration, `baton doctor --depth profile` (read-only, no argv mutation) returned:

```json
{
  "schemaVersion": 1,
  "state": "needs_setup",
  "depth": "profile",
  "outline": {
    "repository": "ready",
    "connection": "ready",
    "profile": "missing",
    "credential": "not_read",
    "remote": "not_checked"
  },
  "next": [
    {
      "action": "setup",
      "command": "baton setup"
    }
  ],
  "connection": {
    "profile": "resident-4421cf292504-672ef8abad50",
    "repoId": "repo-76d484205f22eed0163d8f21b8287740"
  }
}
```

No credentials, harness installations, global configuration, or the main checkout were mutated during
this probe; no scratch files were retained.
