# Storage policy review, 2026-10-19

Review of the uncommitted storage policy output in the wonder worktree at base
`06f233e2`, requested by `storage-policy-wonder-20261019`. The review is
read-only; no file under review was edited.

Targets: `bend2/src/coordinator/storage-policy.bend`,
`bend2/src/coordinator/logs.bend` (`storage_policy`, `storage_preview`,
`storage_apply`), `bend2/src/host/files.bend` (`Files.link`),
`bend2/src/host/files.c`, `bend2/test/storage-policy.py`, and
`docs/bend2/storage-policy.md`.

Test run in the wonder worktree:

```
python3 bend2/test/storage-policy.py -v
Ran 4 tests in 0.207s
OK
```

The four tests cover policy class names, preview/apply/idempotency, pending
input, and a symlinked attempt directory. The findings below are outside that
coverage or contradict the documented contract.

## F1. Two storage implementations conflict

The wonder worktree adds `bend2/src/coordinator/storage-policy.bend` with
classes `scratch-build`, `checkout-worktree`, `shared-immutable`, `git-objects`,
`logs-evidence`, `durable-state`, `unknown`, and commands `storage-policy`,
`storage-preview SESSION`, `storage-apply SESSION`.

The core worktree adds `bend2/src/storage/{types,policy,observe,state,apply,lifecycle}.bend`
with classes `scratch`, `build-output`, `checkout`, `shared-immutable`,
`git-object`, `log-evidence`, `unclassified`, and command
`storage-policy preview|apply` reading `BATON_STORAGE_ROOTS`.

The two class vocabularies, command shapes and configuration surfaces are
incompatible. One implementation must be selected before integration. Root
selected OS service and timer wiring only for the platform slice, so the
platform no longer ships a storage config adapter or schedules a storage
apply command. The review remains against the wonder patch.

## F2. The policy JSON does not use the recorded project root

`Logs.storage_policy()` at `bend2/src/coordinator/logs.bend:1329-1330` calls
`Policy.policy_json("current", ".")`. The current output is:

```
{"host":"current","project":".","ageOnlyDeletion":false,"classes":[
 {"class":"scratch-build","root":"./.scratch",...},
 {"class":"checkout-worktree","root":"./worktrees",...},
 {"class":"git-objects","root":"./.git/objects",...}]}
```

`docs/bend2/storage-policy.md:19-26` records the project argument as the
configured canonical root recorded for the project, with the homelab root on
NVMe and a project-local macOS root. The command emits relative `./` roots and
the literal host `current`, so the canonical root and mount are not observable
from the command. `Policy.root_for` does not read `host` either
(`storage-policy.bend:74-80`).

## F3. Root mapping has two unreachable or wrong entries

`Policy.root_for` maps both `durable-state` and `unknown` to
`<project>/.scratch/bend2`. An unclassified path has no owning class root and
should not share the durable-state root.

`git-objects` maps to `<project>/.git/objects`. In a linked worktree `.git` is
a file, and Git objects live in the common directory. The class root fails for
every worker checkout created under `worktrees/`. Use the Git common directory,
or record the object store separately.

## F4. Preview and apply cover attempt directories only

`Logs.storage_preview` (`logs.bend:1371-1379`) reads `attempt_rows_sql` and
`preview_fields` labels every row `Policy.logs_evidence()`
(`logs.bend:1354`). `Policy.class_of_path` is not called by preview or apply.
Scratch build output, build output, checkouts, shared immutable assets and Git
objects have no preview item and no apply path. `docs/bend2/storage-policy.md:9-17`
names cleanup owners for all of those classes, and the class table implies
coverage the commands do not provide.

## F5. A failed symlink check is treated as a normal path

`preview_fields` at `logs.bend:1346` calls
`link : String <- IO.try(String,F.Files.link(directory))`. `Files.link`
(`files.bend:50`) returns a `Result`; `IO.try` turns any failure, including
`EACCES`, into `""`. Only the value `"1"` selects the `symlink-path` decision.
A path whose `lstat` failed is therefore previewed as a normal candidate. The
apply helper rejects symlinked directories, but the preview does not report the
unknown fact. Preserve the item with an explicit `symlink-unknown` reason when
the link result fails.

## F6. The retention bound is not used

`Policy.retention_bytes` returns 268435456 for `logs-evidence`
(`storage-policy.bend:85-91`), and `policy_json` prints it. `storage_preview`
does not read it. `docs/bend2/storage-policy.md:32-36` states that the bound
orders preview output and names where settled items become candidates. Neither
behavior is implemented.

## F7. Preview and apply report different removal sets

Preview uses `Policy.receipt_json("preview",session,items,"")`
(`logs.bend:1378`), with one item per attempt directory. Apply returns
`{"mode":"apply","session":...,"ageOnlyDeletion":false,"result":clean_json(...)}`
(`logs.bend:1393-1396`), where `result` carries `attemptFiles` and also the
registered log generations and stderr runs removed by `clean_attempt_logs`.
Preview does not list those registered logs and its byte count covers only the
seven attempt-directory files. The apply receipt can remove more bytes and
paths than the preview named. `docs/bend2/storage-policy.md:44-46` describes
the same receipt shape.

## F8. Preservation coverage is narrower than the acceptance list

`attempt_decision` (`logs.bend:831-841`) checks stderr health, pending input,
diagnostic policy, verified path, phase, release, acknowledgement, status,
report and bytes. It does not read dirty worktrees, unpublished commits, live
refs, active readers or shared content, although `docs/bend2/storage-policy.md:48-57`
lists them. Those facts exist in `Policy.decide` but are not reached by the
preview/apply attempt rows.

The four tests cover pending input, symlink preservation, idempotency and class
names. They do not cover live leases or processes, dirty worktrees, unpublished
commits, active readers of shared assets or Git objects, concurrent cleanup,
interruption, or path replacement. Issue #912 lists those cases.

## F9. Path markers are substring matches

`Policy.class_of_path` (`storage-policy.bend:44-58`) matches substrings.
`/objects/` is checked before `/assets/`, so `assets/objects/...` classifies as
`git-objects`. `.db`, `.log` and `.jsonl` match inside longer names. The
function is not called by preview or apply today, so the current receipt path
is unaffected. Any future wiring should match path components.

## Passed checks

- Preview performs reads only for the attempt rows; the apply path acquires the
  session lock and re-reads pending input under it (`clean_owned`,
  `logs.bend:1317-1327`).
- A repeated apply records no new removals (test
  `test_preview_apply_and_idempotency`).
- A symlinked attempt directory is preserved with `symlink-path` (test
  `test_symlink_attempt_directory_is_preserved`).
- Pending input is preserved and apply returns `skipped: pending-input`
  (test `test_pending_input_is_preserved`).
- `Files.link` uses `lstat` and reports `S_ISLNK` without following the path
  (`files.c:358-370`).
- The scheduled unit examples in `docs/bend2/storage-policy.md:75-123` invoke
  the apply command, not preview.
