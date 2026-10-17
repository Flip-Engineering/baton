# Phase 89 resident-application dogfood assessment

Date: 2026-07-18

## Outcome

Baton dispatched two independent reviews concurrently through the application it is building:

- GLM `glm-5.2` at `xhigh` produced `glm-resident-review.md` from Run
  `run-37b66085de32d80308cfc275044be5b7` and retained result commit
  `73fba0fba960c18645ef10e21d9741424f879745`.
- Codex `gpt-5.6-sol` at `medium` produced `codex-application-review.md` from Run
  `run-33f30deaedb24c336fef7c226bb2f13f` and retained result commit
  `8237d684440974cbda65eb4cd3e4ce5a1316b2d8`.

The first Kimi attempt failed closed before dispatch with
`authentication_refresh_required`; Baton did not rewrite or disturb the user's Kimi installation.
Both admitted Runs used separate owned worktrees, their reports were mechanically verified, and
deployment close reported zero workers. A post-run Git worktree inspection found only the main
checkout.

## Findings converted into implementation

The two reports found several real defects in the first resident slice. The implementation now:

1. authorizes Runs before enforcing the visible catalog ceiling, so hidden Runs cannot reduce a
   caller's visible page or trigger its continuation-required response;
2. applies the same exact-route readiness gate to `deployment.runs.start()` as `deployment.run()`;
3. derives the local repository identity from the Git common directory and requires agreement
   across selector, application card, and authenticated session;
4. refuses Web redirects and bounds response time and JSON bytes;
5. validates attached outline schema, Run identity, semantic registry identity, view digest, and
   bounded semantic fields before returning a handle;
6. centralizes stable Run timing while excluding volatile observation time from semantic digest
   identity;
7. exposes only an explicit advanced loopback HTTPS host seam and keeps ordinary hosting
   unavailable until its missing security authorities exist.

Focused Phase 89 application and host tests pass 27/27. The complete repository suite passes
2,183/2,183 after repairing all intentional application-card fixtures.

## Honest remaining boundary

This evidence does not complete Phase 89. `BatonDeployment.host({ advanced })` trusts an injected
authenticated HTTPS server and is useful only for integration/testing. Baton still needs to own the
private session credential, one-writer lease, deployment/incarnation fence, owner-local socket,
atomic publication, authenticated readiness challenge, restart/takeover recovery, and compare-and-
swap unpublication before ordinary `openBaton().host()` can be enabled.

The catalog still needs an opaque server-owned continuation above 64 visible Runs. The common
command port still has a compatibility shim that erases a legacy principal argument. Progress
anchors should be persisted/indexed rather than reconstructed by repeated event scans. Semantic
`run.send` and selective `run.interrupt`, uncertain-effect settlement, Run-scoped resumable streams,
and browser/CLI convergence remain acceptance-red. The compact stop projection's occasional null
`stop`/`ownership` fields also remain a known AX defect even though final deployment ownership was
zero.

Those gaps stay in the Phase 89 acceptance matrix and roadmap; no readiness or host-completion claim
is inferred from the green first vertical.

## Subsequent closure

The ordinary owner-local host gap described above was subsequently implemented and reviewed in
`../phase89-resident-host-closure-live-2026-07-18/`. This file remains the assessment of the first
catalog/attach slice; consult the later evidence for the UDS resident, process-start fencing,
schema-v2 publication, self-challenge, zero-assembly CLI serve, and remaining boundaries.
