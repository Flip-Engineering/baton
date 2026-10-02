# Recruitment conflict diagnostics

## Observed refusal

The [matched native workflow](native-workflow-comparison-2026-10-02/README.md) at
`ec0e144d` recruited Muse with the OMP harness. Correcting that same logical ID
to Muse returned `NOT NULL constraint failed: sessions.id`, exit status 19.
The assignment remained immutable; the error did not identify the conflict.
The lead's subsequent raw SQLite change and failed launch remain recorded.
Issue #650 owns the diagnostic repair.

## Existing flow and repair

Recruitment keeps its existing lookup, worktree creation and registration flow.
`Commands.worker_matches` compares the seven assignment fields: parent,
harness, model, effort, workspace, branch and base. Its parent comparison handles
an existing root's NULL parent. `Commands.worker_sql` inserts a new assignment,
retains an existing row on conflict, and returns its session only after the
complete assignment matches.

A mismatch returns `worker-assignment-conflict`, the stored and requested
assignments, and an instruction to inspect the session and worktree, retry the
recorded assignment, or recruit a new ID with a new branch and unused path.
`Store.committed` classifies this refusal before endpoint delivery and returns
exit status 2. Existing native identity, endpoint, observations, pending input
and worker work remain unchanged.

The imported operative laws bind the actual Worker command, complete comparison,
SQL transaction construction and refusal result. Concrete saved-output witnesses
evaluate the classifier and committed exit path. Five controls remove harness
or model comparison, overwrite the assigned harness, return a session on conflict,
and remove refusal classification.

## Measured evidence

The isolated final source is `fc466667644336bef8dc82a71a924b55edc1dd83`.
Its executable was built from `50b0a9eb`; the final change adjusts a control's
expected law name. Runtime and native-test source remain byte-identical. The
native binary has SHA256
`e9374848831ccdb233839215c84ab6d1f1ee84a39a8fd2a601d2758f55987da8`.

The build and six native recruitment tests passed. Tests exercise exact retries
after native binding and committed, dirty and untracked work exist; each of the
seven conflicting fields; and a logical ID already assigned to a root. Refusals
retain complete database snapshots, Git refs, registered worktrees and file bytes.

The actual before/after CLI probe used the retained `e13cfb65` executable for
the original refusal. It reproduced raw exit 19 for harness and model conflicts,
then measured structured exit 2 with the repair. Exact matching retries succeeded
and retained the same database, native binding, pending input and Git work.
All probe subprocesses were waited. The targeted baseline compiled and all five
mutations rejected at their named operative laws. The first control run's
incorrect expected-law name remains retained with its correction.

The validation receipt has SHA256
`b6f7878b076684f85f10be20cb99e2602fa576bbb3d113dbeda8fb83229cc581`
at `baton-bend2-recruit-conflict-650-20261002/.scratch/issue650/validation.json`.
It binds source, executable, complete check streams and process closure.
Canonical publication requires all gates on the final composed tree.

## Boundary

Harness assignment remains immutable. `bind` records native observations and
keeps the assigned harness. The [hierarchy observer](hierarchy-observer-2026-10-02.md)
checks recorded harnesses before launching its fixed worker wrappers. Correct
initial recruitment and background process custody require native workflow
qualification. The existing failed comparison remains unchanged.
