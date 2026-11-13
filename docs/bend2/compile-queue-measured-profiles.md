# Measured compilation profiles

Issues #1026, #1176 and #1310 cover measured admission and compilation throughput.

A CC profile identifies a command family by its compiler and linker closure,
version, normalized command, entry, options, artifact names, and normalized path
and content digest of every helper or control input. Changes to C-family source
contents create a distinct artifact key and retain the compatible profile. A
successful observed execution raises the profile's peak. Admission takes the
largest measured value from its exact key and compatible profile. Each profile
records the source request key and attempt that supplied its largest observation.

`--per-run NAME=VALUE` declares a commit, evidence directory or other per-run
value. It can be repeated. The exact request key includes the complete command,
options and input contents. In history-group material, each occurrence of a
named value becomes `{run:NAME}` in options, command tokens and control paths.
Absolute paths also match their normalized `@root/` or `@cwd/` spelling. Matching
uses the longest value at each position, so an evidence path can contain a named
commit. Declaration order does not affect matching. A control file under a
named evidence path contributes its masked path; stable controls retain their
path and content digest. Requests without declarations retain their existing
history group. Flip production builds use this declaration for their source
commit and evidence directory (#1481).

An unmeasured workload enters when no other queue claim is live. A measured CC request can
run beside that owner when current available memory covers its expected peak,
remaining measured growth of running claims, and the existing observed outside
growth reserve. Both owners retain their normal execution and cancellation
custody. The unmeasured owner's future growth remains uncertain. This policy uses
observations of current memory and prior compatible work; a later execution can
exceed its previous measured peak.

The existing capacity-aware priority scan still checks whether a higher-priority
live waiter fits before admitting the current request. Existing shared-key
ownership, artifact verification, legacy exclusive holders, and unavailable-memory
fallback keep their established behavior.

## Retained evidence

`compile-queue-runner -- history-rebuild --state-root DIR [--key KEY]` derives
profiles from completed queue evidence. The command skips a key whose execution
lock is held. It verifies the completed cache and recomputes the original exact
request from its retained configuration and command. The current source,
compiler, linker, options, inputs, and control files must reproduce that key.
Changed or unavailable files leave that profile unavailable.

New runs retain each attempt's own measured peak. A legacy key peak can supply an
observation when that key has exactly one retained attempt and that attempt
completed successfully. A successful attempt's own peak remains usable when
another attempt exists. A failed execution's observation stays with its exact
key. History reconstruction preserves request results, artifacts, owners, and
running executions.

The Stop qualification's earlier core command measured 198464 KiB and 5.45 seconds;
its link measured 104276 KiB and 0.32 seconds. Its later Python driver has different
control contents and command identity. Those subcommand observations explain the
small operation's delay but do not establish a compatible profile for that driver.

## Deployment and existing waiters

Atomic replacement updates newly started queue clients. An existing f2239359
supervisor retains its loaded executable and admission policy. Its queued request
continues under that version. Replacing the installed pathname cannot change its
running code.

For a legacy waiter requiring migration, its current conductor first retains the
complete request, exact key, owner token, attempt and process birth identities.
Migration requires a verified unstarted supervisor, no command descendants,
terminal result or compiled marker, and one live owner controlled by that
conductor. The conductor uses the queue's supported owner cancellation, verifies
that the old supervisor and request are terminal, and rejoins the retained command
through the replacement binary. A key assertion must prove the same exact request
identity before the rejoin. The original attempt and receipts stay available.
The conductor follows the new result and restores its original continuation.

A running compilation and a shared or uncertain owner remain on their current
execution. This delivery requires source review and focused synchronization,
identity, priority and cancellation results before a live migration. A cooperative
same-process upgrade can be reviewed separately under the existing queue custody
and upgrade work.
