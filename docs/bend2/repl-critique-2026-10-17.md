# Bend2 REPL adversarial critique, 2026-10-17

Independent review of the Bend2 REPL implementation for
[#778](https://github.com/Flip-Engineering/baton/issues/778), ensemble
`required-repl-release-product`. Reviewed at base `20fe9e9e7114` on branch
`release-repl-glm-778`. The implementer branch `release-repl-deepseek-778`
still names the base commit, so this critique covers the integrated sources:
`bend2/src/coordinator/repl.bend`, `repl-runtime.bend`, `repl-model.bend`,
`repl-source.bend`, `bend2/src/host/repl.bend`, `bend2/src/host/repl.c` and
`bend2/compiler/repl.ts`, against the pinned upstream in
`bend2/compiler/upstream` and the staging extensions in
`bend2/scripts/stage-repl-compiler.py`. A re-review follows when the
implementer branch is named with its own commits.

Findings F1 through F3 are acceptance-relevant. F4 through F7 are correctness
or contract defects. F8 records a liveness property. The held-attack summary
at the end lists the surfaces this review could not break.

## F1 — Redefinition is refused at parse time; the documented redefinition contract is unimplemented

[`repl.md`](repl.md) states: "Definitions compose in source order ... A
redefinition must preserve the type and affine validity of that complete book."
The shipped compiler refuses every redefinition, regardless of type or affine
validity. `parse_fresh` throws on any second top-level declaration of a name
(`upstream/bend.ts:2526-2530`), and the REPL loader reaches it on every cell:
`definitions()` replays all prior successful define sources before the cell's
own source (`repl.ts:64-68`, `repl-model.bend:71-72`).

Focused probe of the pinned upstream (hash-verified against
`repl-upstream.lock.json`, `bend.ts` sha256 `93c2a43d…fcaeb85`):

```text
node --experimental-strip-types probe.mjs
cell A (first def) accepted
REDEFINITION REFUSED: Error: | - expected : a fresh name (duplicate declaration: replaced) | - observed : '('
```

The staging loader extension (`stage-repl-compiler.py:26-37`) adds virtual
sources and shared aliases; it does not touch `parse_fresh`. Consequences:

- `repl bind X` after any successful `define` or `bind` of `X` always fails.
  The documented re-binding workflow cannot run a second time for one name.
- `repl import` of a declaration snapshot that names any definition already
  present in the importing notebook fails wholesale, so cross-actor
  composition requires disjoint name spaces. That constraint is documented
  nowhere.
- The law-filling path (`upstream/bend.ts:2537,2552-2560`) is the only
  redefinition mechanism, and a REPL snapshot can never retain a bodyless law
  because `complete()` refuses open books (`repl.ts:22-27`).

Cell-level citation immutability holds: each cell pins its snapshot at
creation (`repl-model.bend:74-79`), refusals enter no later snapshot
(`definitions()` requires compiler exit 0 with empty cause), and history stays
unchanged. The defect is the missing contract, not corruption.

## F2 — Interactive mode terminates on recoverable refusals

The interactive loop binds each command as `IO(Unit)` with no Result handling
(`repl.bend:211-224`). Any `IO.die` inside a colon command ends the session:

- `:submit` while another evaluation holds the notebook guard reaches
  `submit_acquired` → `IO.die(2)` (`repl.bend:86-89`) and exits the process.
  The draft survives because `submit_draft` clears it only after submit
  returns (`repl.bend:157-163`), but the user must restart interactive and
  re-enter `:submit`.
- `:bind` without a name dies with `IO.die(2)` (`repl.bend:177`), while
  `:bind BADNAME` records a refused cell and continues
  (`repl.bend:172-176` with `print_cell … False{}`).

[`repl.md`](repl.md) promises that interactive input "continues after its
recorded outcome" for compiler refusals; guard refusals and argument refusals
end the session instead. One-shot CLI behavior (exit code 2) is correct; the
interactive surface needs the same continuation there.

## F3 — Recovery can retroactively flip a recorded successful cell to failed

`outcome()` writes results only while `wait_status IS NULL`
(`repl-runtime.bend:17-20`). `cleanup()` appends release and retire causes with
no such guard (`repl-runtime.bend:22-25`). `successful()` requires `cause=''`
on every attempt (`repl.bend:67-70`), and `print_cell` derives the process exit
status from it.

`Runtime.execute` runs `recover_stage` for both stages before any completion
check (`repl-runtime.bend:233-237`), and `observer_recovery_argv` "also reads
released custody awaiting acknowledgement" (`process.bend:50-52`). An observer
that dies between `release` and `acknowledge` leaves exactly that state. The
recovered observer then re-enters `completed_observation`: `outcome` is a
no-op, `preserve_output` re-copies, and the second `release`/`acknowledge`/
`retire` fails against the recorded released/acknowledged markers
(`instance.bend:69-72`). `cleanup` appends that failure cause to the
already-successful attempt. The cell then reports "The retained REPL cell
failed" while `wait_status` still records `exit 0`, and `bind` refuses the
cell as a bind source because `binding_source` also requires an empty cause
(`repl.bend:109-113`).

The live-observer case is guarded: `BR_ATTACH` returns `EBUSY` while an
observer holds the attempt (`process-spawn.c:1225-1235`), and the fallback
refuses on the held notebook lock (`repl-runtime.bend:203-205`). The exposure
is the released-but-unacknowledged window and any second observation after a
partial cleanup.

## F4 — `repl share` publishes host-local paths in the message body

`share` sends `body = M.read(db,notebook,cell)` (`repl.bend:102-104`). The
read JSON embeds the notebook's `workspace` and `compiler` absolute host paths
(`repl-model.bend:85-90`). Ordinary routing authorizes delivery
(`store.bend:154-158`, `commands.bend:442-446`), but the retained message body
discloses the sharer's filesystem layout to the recipient and to every reader
of the messages table. `import` uses only `cells[0].declarations` and
`cells[0].source` (`repl.bend:123-129`); the cell payload can omit host paths.

## F5 — MCP `baton2_repl` forwards unlisted operations, including `interactive`

`mcp-conductor.mjs:1126-1143` forwards `args.operation` into the repl verb
without an allowlist. `execute_canonical` admits `interactive`
(`repl.bend:263-270`), so an MCP `interactive` call reaches
`ReplHost.line()` — `getline(stdin)` in the coordinator's native runtime
(`host/repl.bend:4-5`, `raw.c` `CID_REPLHOST_LINE`). The tool description
(`mcp-conductor.mjs:425`) lists define, eval, bind, read, recover, share and
import. Interactive input over the agent-contextual channel consumes the host
process's stdin and must be refused at the MCP boundary.

## F6 — `bind` names and `--type` values reach generated source unvalidated

`binding_source` concatenates the name into `def NAME() -> TYPE:`
(`repl.bend:111`), and the eval wrapper interpolates `expectedType` into the
temporary definition (`repl.ts:83-85`). Only `main` and
`__baton_repl_expression` are refused afterwards (`repl.ts:29-33`). A name or
type containing newlines or punctuation injects additional top-level
declarations or produces syntax refusals whose positions point outside the
authored source. This grants no privilege beyond `repl define` (same author,
same compiler), but the recorded citation comment `# Retained pure result
<cell>` can separate from the definition it names, and refusals become hard to
attribute. Validate the bind name as a Bend2 identifier and `--type` as a
complete type term before the cell is created.

## F7 — Import is not row-complete on a mid-import refusal

`import_rows` prints each declaration's cell and dies on the first failed one
(`repl.bend:131-137`); the remaining declarations are never submitted and no
resume point is recorded. The owned-read receipt is recorded before any row
lands (`repl.bend:127-129`). [`repl.md`](repl.md) promises "each checked
declaration's cell result"; a mid-import refusal truncates that output while
the read counts as handled.

## F8 — Pure evaluation normalizes at compile time without a bound

A pure eval's value is produced by full normalization in the compiler frontend
(`repl.ts:97-101`). A divergent pure term keeps the compiler attempt running
until the actor's stop signals it through the existing custody path. Under the
no-budget-control rule this is a recorded property, not a defect to absorb
with a limit; operators stop the actor's session to unwind it.

## Attacks that held

- **Notebook guard races.** The physical guard is an exclusive `flock` on a
  database- and notebook-derived lock file; `try_acquire` maps
  `EWOULDBLOCK`/`EAGAIN` to `None` (`session-lock.bend:6-11`,
  `process-spawn.c:5107-5127`). Submit holds the guard across the
  unfinished-cell check, cell insert, compiler stage and native stage, and
  releases it once (`repl.bend:91-95`, `repl-runtime.bend:184-191`). The
  guard check and insert run under the held guard. Concurrent notebook
  creation resolves to one row through `INSERT OR IGNORE` plus a unique
  `(owner,name)` constraint (`repl-model.bend:10,56-62`). Process death
  releases the flock; no durable lock store exists.
- **Unfinished-cell recovery, common path.** The guard admits new source only
  when every cell is finished; a failed stage finishes its cell
  (`finished_sql`, `repl-model.bend:92-94`), so refusals never wedge the
  notebook. The default `recover` selects the latest cell, which is the
  unfinished one in every reachable state because inserts happen only after
  the guard check. `stage()` skips completed stages (`repl-runtime.bend:
  151-154`).
- **Stdin and inline completeness.** `--stdin` sources read the complete
  stream through the strict raw reader with pinned BOM, RFC 3629 and NUL
  decision order (`agent-native.bend:25-40`, `raw.c:1-10`); failures retain
  the diagnostic and the saved bytes. The compiler's definition snapshot
  travels as recorded stdin bytes on the attempt row
  (`repl-runtime.bend:130-139`).
- **Stop handling.** The drain loop consults `stopped_session_sql` on every
  owner-change notice and signals the retained child (`repl-runtime.bend:
  38-56`); `ESRCH` after natural exit is treated as success
  (`stop_result`, code 3). Complete stdout bytes are copied and fsynced
  before custody acknowledges the spool (`repl.c:8-67`,
  `completed_observation` order at `repl-runtime.bend:92-103`).
- **Affine and type checking.** The integrated sources pass the recorded full
  coordinator check (tree `0d518d60…`, exit 0; qualification record
  [`repl-qualification-20261016.md`](repl-qualification-20261016.md)). The
  frontend checks the complete book after every load, refuses open books and
  reserved names, and chains the native stage only on a checked `native`
  result (`after_compiler`, `repl-runtime.bend:179-182`).

The probe ran locally against the pinned upstream TypeScript as a focused
investigation; it is not a validation-gate run and establishes no acceptance.
Remote gates for [#778](https://github.com/Flip-Engineering/baton/issues/778)
remain open per the qualification record.
