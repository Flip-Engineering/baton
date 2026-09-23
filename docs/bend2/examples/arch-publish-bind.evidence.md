# arch-publish-bind — binding the acceptance record to the published commit

## Claim

A landing's acceptance record can name the commit it published, and completion can then require the
record's commit to be the content the declared destination holds: a record naming the published commit
reports completion, and a record naming another commit reports no evidence. At the pin the binding is a
canonical commit id compared as a string, and the digest-based binding — a canonical encoding of the
record plus a digest over it — stays an open prerequisite.

This is the composition's gap (1), restricted to what the pin allows, as bend2-orchestrator5's review
of increment 7 directed.

## Files

| File | Holds |
|---|---|
| `arch-publish-bind.sh` | the five stages: acceptance, the record, publication, completion with the recorded commit, a record naming another commit |
| `arch-publish-bind.evidence.md` | this record and the composition's final gap table |

## Host and toolchain

- Host: Darwin 27.0.0, arm64 (Apple M4); git 2.50.1.
- Toolchain: `bend 2.0.25` at the worktree root under `.bend/`.
- All state is under `.scratch/arch-publish-bind/`, which the repository ignores.

## Command and output

```sh
export PATH="$PWD/.bend/bin:$PATH" BEND_NO_TELEMETRY=1
sh docs/bend2/examples/arch-publish-bind.sh
```

```text
### stage 1: the acceptance half, in a Bend2 process
intent_appended=True
journal_lines=1
durability_receipt=none
dispatch=issued
settled=observed
dispatch_count=1
### stage 2: the record binds the operation to the commit and the destination
record=publish:op-1:54a5a3404aae5df10c6935af754ac16c89d66cc0:/…/.scratch/arch-publish-bind/declared.git
record_commit=54a5a3404aae5df10c6935af754ac16c89d66cc0
squash=54a5a3404aae5df10c6935af754ac16c89d66cc0
### stage 3: publish to the declared destination
declared_remote_head=54a5a3404aae5df10c6935af754ac16c89d66cc0
### stage 4: completion requires the record's commit to be the observed ref
completion_with_the_recorded_commit=observed_match
### stage 5: a record naming another commit must not claim completion
record=publish:op-1:aa573951a310e1a0679461b42bb44b79c60f9d60:/…/.scratch/arch-publish-bind/declared.git
completion_with_a_base_commit=mismatch
observed_head=54a5a3404aae5df10c6935af754ac16c89d66cc0
binding_is_string_equality=true
digest_bound_record=none
```

Exit code 0, and two clean runs are byte-identical. The destination path in the record is abbreviated
here; the script prints it in full, and it is the declared value the publication used.

## What each stage establishes

| Stage | Evidence |
|---|---|
| 1 Acceptance | The accept intent is on the journal before the acknowledgement prints, and the program reports `durability_receipt=none` (Base has no synchronization operation). |
| 2 The record | One line beside the intent names the operation, the commit and the destination: `publish:op-1:54a5a340…:<declared>`. |
| 3 Publication | The squashed commit is pushed to the declared destination. |
| 4 Completion | The record's commit equals the commit the declared ref names, so `completion_with_the_recorded_commit=observed_match`. |
| 5 Another commit | A record naming the base commit against a destination holding the squash reports `mismatch`. A record that names the wrong commit cannot claim completion. |

## What binds, and what would bind it more strongly

The binding at the pin is the commit id: a 40-character commit id is the identity of the artifact, and
equality of two of them is an identity comparison rather than a signature. What is missing is a record
that can be checked without trusting whoever wrote the line:

- a canonical encoding of the record (`B2-JSON`), so two writers produce the same bytes for the same
  record;
- a digest over those bytes (`B2-CRYPTO`), so a record can be named, compared and referenced by one
  value instead of by its fields.

Neither exists at the pin: `bend base Json` and the hashing names are absent, so the record is written
by this script and the comparison is a string comparison. The gap table below records that.

## The composition's final gap table

The composition track stops here: gaps (3) and (1) are done at the scale the pin allows, and gap (2) is
a named prerequisite rather than a task this lane can close. This is the final table.

| Step of the composed path | State at the pin | Where the remaining half rests |
|---|---|---|
| Durable acceptance before acknowledgement | The intent reaches the journal before the acknowledgement prints, and no durability receipt exists for it | `B2-FS-DURABILITY`, ARCH-CLOSE-04 |
| The attempt recorded before the effect | The attempt is recorded at the destination (its dispatch log), not locally before the dispatch | `B2-FS-DURABILITY` (journal write path), ARCH-CLOSE-10 |
| Publication to the declared destination | The deployment's own `git push <declared> <squash>:<ref>` runs, driven by the shell half | `B2-PROCESS`, ARCH-CLOSE-05: the native deployment cannot invoke it |
| Completion evidence | Content-level: the destination's own object store is read at the commit its ref names and hashed against the prepared listing | Closed at the pin (`arch-publish-content.sh`); a blob walk and independent verification belong to the deployment |
| The record bound to the artifact | The record names the commit and the destination; the comparison is a canonical commit id as a string | `B2-JSON` and `B2-CRYPTO` for a canonical, digest-bound record |
| An ambiguous outcome | Reconciled by observation with no second effect, and the reconciliation does not claim the effect was this attempt's | Closed at the pin (`arch-publish-target.sh` stage 4); M-3c |
| Destination identity before the effect | A file the destination holds, read before the dispatch; a wrong destination refuses before any effect | `B2-DESTINATION` for the deployment's own endpoint identity |
| Crash behaviour | No crash is injected at any step; every restart is a fresh process over the same files | `B2-FS-DURABILITY`, `B2-PROCESS` |
| Transport | The filesystem and a local git remote only | `B2-HTTP-TLS` for a real shared endpoint |

## Verdict

The claim holds, and the table above is the composition's final statement of what remains. Every row's
closed half is a run recorded in this directory; every open half names the prerequisite that carries
it in `../rewrite-plan.md`.

## Related

- `arch-publish-target.evidence.md`: the acceptance and publication halves composed.
- `arch-publish-content.evidence.md`: the content-level completion check.
- `arch-publish-compose.evidence.md`, `arch-effect-publication.evidence.md`: the acceptance half.
- `controlled-remote.evidence.md` (bend2-orchestrator5): the publication mechanism.
- `../target-architecture.md`, `../rewrite-plan.md`: the closure conditions and the host prerequisites.
