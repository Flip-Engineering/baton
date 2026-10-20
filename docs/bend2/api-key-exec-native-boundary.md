# Native api-key-exec boundary specification

Status: secret-resolution boundary landed 2026-10-18; Anthropic API-key launches
are held until request-level promotional-credit admission is available. The
packaged helper `bend2/harness/api-key-exec.bend`, built as `api-key-exec`,
returns `creditAdmissionUnavailable` before resolving a secret or spawning a
child. The details below describe the retained secret boundary used when the
launch gate is enabled.

## Host boundary (C additions to `process-spawn.c`, exposed in `process.bend`)

1. `ProcessChild.spawn_env_spec(spec_path, argv, cwd, stderr)`
   C: `br_spawn_env_file`. Reads a 0600 file of `NAME=VALUE` lines, builds `envp` from the
   inherited `environ` plus those entries (build an array; do not `setenv` the coordinator
   process), `posix_spawnp`s the child with that `envp`, then unlinks the spec file before
   the first child byte is read. Returns the child handle exactly like the existing spawn.
   Typed failures through the ordinary result channel: `specUnreadable` (filesystem code),
   `specLineMalformed` (a line without `=`).
2. `Files.mode_of(path)`
   C: `br_file_mode`. Returns `st_mode & 0o7777` for an existing path, or the errno as a
   failure. Pure stat; no read.

The keychain read needs no new C: the Bend2 module composes
`Process.Process.run(["security","find-generic-password","-s",service,"-a",account,"-w"],".")`
and captures stdout; a missing executable maps to `secretStorageUnavailable`.

## Bend2 policy module (`bend2/src/harness/api-key-exec.bend`)

All policy, in Bend2, mirroring the wrapper's typed conditions exactly:

- Reference parsing: `file:PATH` and `keychain:SERVICE/ACCOUNT`; other schemes refuse
  `unsupportedSecretReference`. Refusal output is one JSON line on stderr with the schema,
  condition, the reference's kind prefix only, and the cause; exit 2.
- File secrets: `Files.mode_of` must report owner-only or the refusal is
  `secretFilePermissions` with the mode, unread. Read with `Text.read`, strip one trailing
  newline.
- Keychain: `Process.run`; failures map to `secretStorageUnavailable` (ENOENT) or
  `secretUnavailable` with the exit code, the value never on stderr.
- Spawn: write the env spec (`ANTHROPIC_API_KEY=<value>`) to a 0600 file beside the attempt,
  call `spawn_env_file(spec, [command, ...args], cwd, stderr)`, map the child exit and signal
  exactly as the wrapper does (signal re-raise so the parent observes one signal).

## Integration and acceptance

The retained coordinator refuses an Anthropic `api_key` account before spawn,
and the packaged helper also refuses direct invocation. The focused fixture
checks both refusal paths, confirms that a secret is not read and confirms that
the child does not start. A later admission implementation must preserve this
secret boundary and add request-level spend reservation before forwarding each
provider request.
