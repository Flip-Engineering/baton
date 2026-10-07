# Live contribution snapshots

2026-09-13. Implemented by a GLM 5.3 Flash participant through Baton, then reviewed and integrated by the root orchestrator.

The previous contribution API required a paused turn because its capture path staged and committed through the real index. An implementer calling capture from a native tool could never satisfy that requirement: its turn could not end until the tool returned. A paused turn also does not prove that no other agent is editing the checkout.

## Implemented behavior

`workspace-snapshot.mjs::snapshotWorkspace` copies the current Git index into a private temporary directory, stages visible file versions there, and uses `write-tree` / `commit-tree` to create an immutable revision. It leaves the real index, HEAD, branch refs, and working files unchanged. The snapshot parent identifies the observed HEAD. Changed paths come from the immutable revision relative to the admitted base.

The temporary index preserves sparse-checkout entries; assume-unchanged flags are cleared only in that temporary index so visible edits are captured. Split indexes are exercised. Literal pathspec exclusions preserve the repository's own ignore configuration without treating dependency names as ignore patterns. Force-tracked projection targets are refused. Missing/corrupt index state is refused, not interpreted as an empty repository. Temporary files are cleaned before the operation returns.

The owned worktree manager validates the physical owner receipt, branch, base, path and sparse identity before and after capture. Captures serialize per physical workspace. The coordinator registers pending captures before yielding so a concurrent stop waits for every admitted capture to settle. Capture failure does not poison that wait. Retention and verification use the existing checkpoint refs and contribution records; no second journal is introduced.

`swarm.capture` now works during an author's native turn. `swarm.check` verifies the retained revision in separate sandboxes while its author keeps working. Custom legacy worktree ports that provide only mutating `capture` still require a pause. Checks and contribution reviews do not end a participant session or accept a task automatically.

## Limits of the proof

A live snapshot records file versions observed while Git reads them. It is not an atomic transaction across concurrent editors, and it does not attribute each edited line to a particular agent. Git-ignored paths remain omitted from a contribution; ignoring a file is not permission to delete it during workspace cleanup. Shared physical workspace membership still needs explicit custody support.

No arbitrary path-count or path-length ceilings were added. The primitive requires a full commit SHA and safe relative literal exclusions. It does not update refs itself; the caller retains and postchecks the returned revision.

## Validation

Real Git tests cover staged plus unstaged content, untracked content, ignored paths, literal exclusions, filenames with whitespace, sparse and split indexes, assume-unchanged files, unchanged branch/index bytes, invalid inputs and failure cleanup. A real application test runs the scoped native CLI in a child process: a working implementer captures and checks its own code while its original index and HEAD remain unchanged. Coordinator tests cover concurrent capture ordering and stopping with captures in flight.

The initial GLM contribution was independently checked by Baton at `370901b65b5133bd315e11bb4a6317bab4a77320`. Root integration then removed invented input caps, fixed exclusion and index edge cases, and exercised the native application path. These focused checks are separate from whole-repository CI and merge acceptance.
