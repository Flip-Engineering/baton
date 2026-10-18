# Native api-key-exec boundary specification

Status: implementation specification and landed boundary, 2026-10-17, seat accounts-glm;
native implementation landed 2026-10-18. The native helper
`bend2/harness/api-key-exec.bend`, built as `api-key-exec`, is the executed driver.
Product policy lives in Bend2 and the host boundary shrinks to two mechanical
primitives. No policy lives in C.

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

The retained launch for an `api_key` claude-code account calls this module before admission:
resolution failure is the existing launch refusal with its typed condition, and the attempt
row keeps its unstarted attribution. The seam switch is one commit in `turn.bend`
(`retained_prepare` composes the plain harness argv plus the spec path) and is coordinated
with the runtime seat, which owns `turn.bend` during the memory repair. Acceptance: the C8
probe (`bend2/test/api-key-exec.test.mjs`) re-pointed at the native entry (same five cases),
plus one fixture binding an `api_key` account through a stub provider command that prints its
environment and argv.
