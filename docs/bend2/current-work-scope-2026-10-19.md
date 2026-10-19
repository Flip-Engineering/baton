# Current work scope, 2026-10-19

This contributor handoff records the operator's active scope and the evidence
available on 2026-10-19 UTC. Baton database dispatches contain the assignments.
GitHub issues track unresolved failures. Runtime state and deployment state must
be read from their current sources before continuing an operation.

## Memory recovery and deployment

[Issue #811](https://github.com/Flip-Engineering/baton/issues/811) tracks the
recovery memory failure. The kernel killed the retained film observer PID 184410
at 03:32:47 UTC after it reached approximately 97 GiB RSS. The native process had
already disappeared; its output, checkpoint and custody evidence remain
available. The account monitor observer PID 1688249 subsequently completed with
status 0. The span observer PID 1593609 still had a live native process at the
last check. Preserve that native process and its shared keeper.

[PR #894](https://github.com/Flip-Engineering/baton/pull/894) merged the
checkpoint-write correction. Its fixture reduced 258,051 output-only checkpoint
writes to zero. The correction still requires the full retained-output recovery
test and installation into the deployed helper.

The current-main recovery test candidate is `f65d3dd785fb7d56a40bb64271a7f65f52c6de30`,
based on `8283b5e6ffb5f53c6b96b38e494aefc72fcd75d5`. Its focused C generation
completed on the homelab in 2m29s with 12.3 GiB peak RSS and zero swap. This
measures C generation only. The standalone helper also needs the lifecycle
routes from [PR #890](https://github.com/Flip-Engineering/baton/pull/890).
The recovery implementation helper is integrating those routes, compiling the
candidate and running the normal-EOF spool recovery test with test-owned custody.
Root reviews and merges qualified changes, installs the resulting helper, and
verifies the retained production recovery through its recorded owner.

Related failures remain in [#891](https://github.com/Flip-Engineering/baton/issues/891),
[#883](https://github.com/Flip-Engineering/baton/issues/883),
[#812](https://github.com/Flip-Engineering/baton/issues/812), and
[#893](https://github.com/Flip-Engineering/baton/issues/893).
Keep exact source, compiler, process identity and terminal build receipts.
Build and test execution uses self-hosted homelab runners.

## Compiler throughput and branching

[Issue #776](https://github.com/Flip-Engineering/baton/issues/776) tracks build
time and peak memory. The active experiment compares Clang's basic register
allocator against the retained O1 shard from the same source. The candidate
uses an 8 GiB, zero-swap scope and preserves the baseline object and receipts.
A successful compile must be linked and exercised before it supports a
throughput conclusion. The current-main focused C-generation measurement above
has a different source and output size from the earlier 14-minute generation;
those measurements do not establish a same-source compiler speedup.

[PR #860](https://github.com/Flip-Engineering/baton/pull/860) requires current-main
integration and runtime qualification. Fork-and-flush clears inherited
conversation while preserving the branch workspace. Its PR description needs
to state those semantics accurately. The earlier compiler workers' Git branches
and patch packets provide implementation evidence; actual Baton branch actions
and completed branch results are still required to qualify the branching mechanism.

## Video production, rendering and publication

The production coordinator is `acp-production-wonder-20261019` in
`/home/atari2036/render-fframes-port-20261016/baton/orchestra.db`.
The coordinator uses regular Muse Wonder. Its current turn has read the runtime
environment and video revision guidance. The old `fframes-lead` request exceeded
the provider's context capacity; [ACP #97](https://github.com/flip-engineer/automated-content-pipeline/issues/97)
tracks a bounded continuation that preserves its retained history and workspace.

[ACP #88](https://github.com/flip-engineer/automated-content-pipeline/issues/88)
indexes the operator's notes in issues #89 through #95. They cover DEAD LABOUR,
NOT A FOOTNOTE, ONE_SHOT_CURE, PRODUCTIVE FORCES, REJUVENATION, THE GRAVEDIGGERS
and AT_REST. AT_REST must preserve the intact body hammer strike, show dynamic
force propagation through the tail rupture and complete dissolution, and improve
the simulated optical glass and stylized visuals. Study outputs and completed
named releases retain their appropriate archive locations and version scheme.

The video delivery helper is consolidating the Second Pass worker changes with
the reviewed fixes in [ACP PR #83](https://github.com/flip-engineer/automated-content-pipeline/pull/83).
The partial CPU previews remain retained. The consolidated source needs normal
farm rendering and review before publication.

The Chasm transparency correction in
[acp-fframes PR #10](https://github.com/flip-engineer/acp-fframes/pull/10)
has CPU, exporter and production-build evidence. GPU image qualification remains
open. The occupied elevator cage at frame 144 is the comparison target. Preserve
the prior capture and activate the matching renderer descriptor before submitting
the versioned comparison through the farm.

The publication adoption service exited after processing 47 existing pairs.
The video helper is retrying only its two remaining recorded jobs, BREAD_BREAD_v2
and REJUVENATION_v9. Further unmatched farm outputs require classification as
studies, superseded attempts or completed releases. Finished content publishes to
[`automated-content-pipeline-video-studies-archive/videos/out`](https://github.com/flip-engineer/automated-content-pipeline-video-studies-archive/tree/main/videos/out).

## Human and clothing simulation

[ACP #87](https://github.com/flip-engineer/automated-content-pipeline/issues/87)
tracks photorealistic and stylized humans driven by material simulation. The
requested homelab tight ensemble uses regular Muse Wonder as conductor and six
direct DeepSeek workers covering anatomy, clothing, optical materials, stylized
humans, motion/contact and render integration. The delivery helper is dispatching
the ensemble. Verify actual session and native execution records before reporting
it active. Existing body and clothing systems and ONE_SHOT_CURE's defects supply
the starting implementation and render comparisons.

## Durable storage

[Issue #912](https://github.com/Flip-Engineering/baton/issues/912) defines the
durable storage classes and ownership-safe cleanup for project work. The homelab
root ext4 volume held 43 GB free on 2026-10-19 while the NVMe volume held 1.1 TB
free. Storage-class roots are Bend2 product state. The platform slice owns the
OS service and timer wiring only. The templates under `deploy/storage` target
the eventual `logs-clean-all` command and stay uninstalled until its exact
contract is published and root approves deployment. Active paths and the
deployed NVMe scratch configuration stay in place.
`docs/bend2/storage-deployment.md` records the observed layout, store owners
and the macOS project-local layout.
Cleanup coordinates with
[issue #644](https://github.com/Flip-Engineering/baton/issues/644) for retained
worktrees and [issue #686](https://github.com/Flip-Engineering/baton/issues/686)
for log volume. Heavy execution placement remains
[issue #677](https://github.com/Flip-Engineering/baton/issues/677).

## Providers, knowledge and remaining integration

- [#844](https://github.com/Flip-Engineering/baton/issues/844) and
  [#896](https://github.com/Flip-Engineering/baton/issues/896): install and qualify
  the official DSH route with minimal tools and maximum model effort. The
  installed front still uses OMP for direct DeepSeek workers. Inspect the
  effective tool roster before claiming DSH minimal-mode support.
- [#802](https://github.com/Flip-Engineering/baton/issues/802): query the direct
  DeepSeek models API for the dated Flash model and continue availability checks.
- [#793](https://github.com/Flip-Engineering/baton/issues/793) and
  [#881](https://github.com/Flip-Engineering/baton/issues/881): complete account
  credit metering in the request path. Each Claude account may use only its
  existing $200 monthly API credit balance. Billing changes and top-ups remain
  outside the authorized work.
- [#779](https://github.com/Flip-Engineering/baton/issues/779),
  [#841](https://github.com/Flip-Engineering/baton/issues/841), and
  [PR #863](https://github.com/Flip-Engineering/baton/pull/863): repair the actual
  knowledge fixture's owner startup, integrate current-main changes and run its
  provenance, scope and relation-identity acceptance.
- [#539](https://github.com/Flip-Engineering/baton/issues/539): continue the pure
  Bend2 rewrite ensemble through its own recorded database. Baton features and
  the Bend2 REPL are integrated product functionality.
- [#774](https://github.com/Flip-Engineering/baton/issues/774): review remaining
  branches and PRs, integrate completed validated work, and deploy merged runtime
  changes. PRs #869, #866, #863, #862, #860, #788 and #772 still require the
  qualification or integration recorded in their current review evidence.

Root remains responsible for integration and delivery. Completed source work
continues through commit, push, review, merge, deployment and live verification.
After this scope is handled, continue through repository issues and remaining
branches using Baton ensembles.
