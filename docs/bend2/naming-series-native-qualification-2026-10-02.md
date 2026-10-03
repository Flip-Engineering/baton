# Native naming and series identity qualification

V7 completed a subscription Codex Principal Conductor, Kimi K3 Associate
Conductor and concurrent DeepSeek and Muse Players. It exercised native
steering, a Player question, shared Ensemble and Section controls, review of
saved contributions, both checked landing levels and friendly Git identities.
The controller's child wait returned 0. This record supplements the
[readiness evidence](readiness.md) with the source and runtime selection below.

## Source and native routes

| Selection | Value |
| --- | --- |
| Source commit | `2a3581cd2650acee824f833104a6efa140e925d0` |
| Source tree | `53dd856f13abc04c0bf266f16d0ad4d94263e062` |
| `bend2/src` tree | `4fabbd71628fd404ac19ccad02baa1c4c30ca189` |
| Coordinator SHA-256 | `5511abbfa76e1f849edd8ffc76a1ea8f6bd01b4129a897725621c0ec452c6c07` |
| Acceptance driver SHA-256 | `7d41ca5094f60fc66cde44e9bf04281ffb41718434a3f6fae015d95f142adbb5` |

The selected clone built the coordinator with Bend 2.0.25 through
[`build-native.sh`](../../bend2/scripts/build-native.sh), whose coordinator
entry imports the operative laws. The frozen source included the acceptance
recorder repair for #651 and the model-series SVG assets. The contribution
changed the two assigned test and documentation files; `bend2/src` remained
unchanged. Later source and packaged runtimes require their own qualification.

| Session | Parent and responsibility | Requested native route | Declared effort | Observed model |
| --- | --- | --- | --- | --- |
| `root` | none; Principal Conductor | Codex `gpt-6-astra` | low | unreported |
| `lead` | `root`; Associate Conductor | OMP `kimi-code/k3` | high | `kimi-code/k3` |
| `deepseek` | `lead`; Player | OMP `deepseek/deepseek-flash` | low | `deepseek/deepseek-flash` |
| `muse` | `lead`; Player | Muse `muse-spark-1.3-contributor` | low | `muse-spark-1.3-contributor` |

Codex login preflight returned 0 with ChatGPT authentication. Its wrapper
cleared API-key variables and selected subscription login. Codex events
supplied its conversation identity; the model remains the requested model.
The OMP and Muse native events supplied their observed models. The session
projections had empty `observedHarness` and `observedEffort` fields. Harness
and effort values above describe the assigned routes and launch arguments.
The pinned executables were Codex 0.154.0, OMP 17.4.0 and Muse
1.4.2-R4684.1, with Muse automatic update disabled.

## Concurrent work, steering and shared grouping

The live process snapshot recorded DeepSeek child PID 90924 and Muse child
PID 90927 together. Their native invocation lifetimes overlapped for
167.249615 seconds, calculated from the later start and earlier natural exit.
This measures native process lifetime overlap. Simultaneous model computation
and causal performance remain unmeasured.

| Retained input | Route | UTF-8 bytes | Body SHA-256 |
| --- | --- | --- | --- |
| `unexpected-success-guidance` | `lead` to `deepseek` | 389 | `8e2d0252e727b1b0d841648575ac1b3c595e01458c8d4682a1bff5d3e0ea070e` |
| `naming-group-request` | `muse` to `lead` | 1463 | `35be52dbb0804dff2fb28200ecb1bb1c13b6368689df50518f786f91792b7e23` |

The guidance followed DeepSeek's first native tool event while its child was
live. The stored native response records `command: steer` and `success: true`.
The question retained its exact body. Kimi's native tool invocation ran
`ack naming-group-request lead accepted`, with a successful tool result and
stored receipt `accepted`. The receipt schema has no actor field; the native
arguments bind the declared actor. Logical identities are local coordination
context, and the CLI does not authenticate an operating-system caller.

Kimi configured and inspected the shared database's loose Ensemble
`naming-validation`, owned by `lead`, with both Players as members. Section
`protocol` assigned `deepseek` to native protocol validation; Section
`documentation` assigned `muse` to operator documentation. Native tool results
and the final public projections retained this grouping. The strict grouping
validator exited 0 after checking the exact question, native acknowledgment
and actual shared controls.

## Saved contributions, review and checked landing

DeepSeek reviewed and cherry-picked saved commit `7fe96f0e` as `de124f84`.
Its `bend2/test/naming.py` bytes match the saved contribution. The regression
registers an empty-string Principal Conductor with NULL parentage, recruits a
child whose parent is that exact empty string, checks six public role
projections and verifies native identity, role refusal, retained messages and
acknowledgments through the actual CLI.

Muse reviewed and adopted saved commit `5a643f17` as `9acda5e9`. It corrected
only the guide's introduction: displayed examples use an isolated fixture,
and the Associate Conductor configures and inspects the live shared grouping
in response to the separate question. The remaining example bytes match the
saved contribution. The guide remains the sole assigned documentation file,
`docs/bend2/examples/section-orchestra-inspection.md`.

| Reviewed contribution | Source commit | Checked target | Landed commit |
| --- | --- | --- | --- |
| DeepSeek regression | `de124f84ce85409e19cd175d35033590d81cae7a` | `hierarchy-lead` | `38a83d038acc5946148914ce56aedc4e245f6f8c` |
| Muse guide | `9acda5e95a0357568e6e089a5d9b165a8fb76419` | `hierarchy-lead` | `d45f6a7834cabe34285a3c35073bfd9926e34ab7` |
| Composed Kimi branch | `d45f6a7834cabe34285a3c35073bfd9926e34ab7` | `bend2-trial` | `adf829b517dabae7c1fd04a6e98e38aab88715c4` |

Kimi reviewed each actual Player diff and ran `land-checked` with the selected
`bend2/test/naming.py` and `bend2/test/messaging.py` suites. Codex independently
reviewed both Player diffs and the composed lead, then checked and landed the
lead branch. Final `bend2-trial` and lead trees were both
`9ade355cde3b9bf4dec7b764787737fe7757dae8`. The target changed only the two
assigned files: 59 regression lines and 85 guide lines.

Both author and committer fields used these identities:

| Commits | Name | Email |
| --- | --- | --- |
| DeepSeek source | `Flip Baton - DeepSeek` | `337142705+flip-baton-deepseek[bot]@users.noreply.github.com` |
| Muse source | `Flip Baton - Muse` | `337142891+flip-baton-muse[bot]@users.noreply.github.com` |
| Kimi checked landings | `Flip Baton - Kimi` | `337142553+flip-baton-kimi[bot]@users.noreply.github.com` |
| Codex checked landing | `Flip Baton - GPT` | `337142399+flip-baton-gpt[bot]@users.noreply.github.com` |

Checked landing creates a squash commit under the reviewing Conductor's
environment. Retained Player commits preserve their own attribution. The
[series identity guide](git-series-identities.md) defines that boundary;
authenticated remote publication remains a separate qualification.

## Completion and evidence boundaries

All nine native invocations recorded wrapper and child exit 0 with
`recording_complete: true`: four Codex turns, three Kimi turns and one turn
per Player. Each Conductor resumed its original native conversation. Both
Player reports were accepted, the final lead report was marked `review-started`,
and `hierarchy-complete` was stored from `root` to `operator`. The controller
wait returned 0. Final target naming and messaging checks each returned 0.
Validation covers these selected suites, the retained hierarchy receipts and
the strict shared-grouping inspection.

The earlier run at `839e3bd2` remains failed. Its closure inspection recorded
no remaining associated processes and no uncertain process discoveries, while
the DeepSeek, Muse and second Kimi wrapper/native exit statuses remain unknown.
The ENOSPC recording failure is tracked in #651. Controlled recorder fixtures
supply recording-failure evidence; V7 supplies successful native lifecycle
evidence on the repaired source. The two runs keep separate evidence and
outcomes.

Local evidence is retained under `.scratch/naming-series-native-run-v7-20261002`
and `.scratch/naming-series-native-v7-strict-validation-20261002`. The frozen
preparation manifest SHA-256 is
`90fa7196e14dbe2f75d52ad73b9f5cfbce8812ecdff2be9611f53614b8d93842`;
the strict validator summary SHA-256 is
`57d15a1befc25016c11c43048d6bc7e0a9f3ad6b4a6d1e9d47693592917e947e`.
Raw provider streams, session databases and private App configuration remain
local. Compiler proof-removal controls, complete native checks, release
artifacts and other recovery boundaries use their own exact-source gates.
