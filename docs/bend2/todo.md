# Baton todo

The [open GitHub issues](https://github.com/Flip-Engineering/baton/issues?q=is%3Aissue%20is%3Aopen)
retain findings, ownership and acceptance requirements. This page links current
Baton2 follow-up work for contributors.

- [#718: Coalesce pending-input notices during failed Codex turns](https://github.com/Flip-Engineering/baton/issues/718).
  Repeated provider failures appended the same pending-input notice to the
  recorded conversation. Deliver committed input once for the current admission,
  retain failed-turn causes, and wake the coordinator for its next-work decision.
  Qualify recovery, new input, operator stops and recipient acknowledgements on
  the affected target and candidate. Verify the packaged and active helper.

- [#720: Stop unchanged completion-request continuations](https://github.com/Flip-Engineering/baton/issues/720).
  Workers awaiting a coordinator's completion confirmation repeatedly generated
  self-addressed continuations and reports. Derive continuation from the current
  assignment and completion request. Preserve terminal evidence, new guidance,
  recipient receipts and the coordinator's exact completion confirmation.

- [#717: Publish and activate the current Baton release](https://github.com/Flip-Engineering/baton/issues/717).
  Qualify the composed source on remote runners, publish its exact tag and
  platform artifacts, and install the complete package through the ordinary
  command path. Retain active conversations, managed work, prior installation
  prefixes and explicit stops during receiver migration. Unfinished feature
  acceptance remains recorded in its original issues.

- [#716: Start ordinary work from task text](https://github.com/Flip-Engineering/baton/issues/716).
  The integrated source in [ordinary task input](task-start-716.md) accepts
  complete text, stdin and UTF-8 files through CLI and MCP. It consumes the
  strict named-route reader from corrected #703 source `25f29f0d` and preserves
  the original #703 ownership. Remote target/candidate, full package and
  installed task-entry qualification remain part of the current #717 release.

- [#715: Simplify agent commands with a contextual action grammar](https://github.com/Flip-Engineering/baton/issues/715).
  Extend the implicit project and session context introduced in
  [#714](https://github.com/Flip-Engineering/baton/issues/714) to inspection,
  assignments, decisions, managed work and project operations. Support batches
  with an individual outcome for each item.
  - [ ] Record delivered and read status through the recipient harness.
  - [ ] Record routine handling from the recipient turn without a separate
    acknowledgement command for every message.
  - [ ] Preserve incomplete handling after failed or interrupted turns,
    original receipt history, explicit stops and replay behavior.
  - [ ] Keep replies, decisions and matched task completion independently
    recorded. Coordinate recipient settlement changes with
    [#713](https://github.com/Flip-Engineering/baton/issues/713).
  - [ ] Update inbox selection and pending notes for native message status;
    validate batch outcomes and installed commands on the remote runner.

- [#713: Route unchanged native-turn reports through the coordinator](https://github.com/Flip-Engineering/baton/issues/713).
  Successful turn settlement created a self-addressed task continuation
  while the assignment was open and the worker inbox was empty. Wonder Full and
  Synthesis repeated unchanged held-work reports; later Muse turns returned
  quota errors. Deliver the turn report to the recorded coordinator for its
  next-work decision. Keep the worker assignment, original input, provider
  errors and owned validation process intact. New guidance reaches the same
  native conversation through ordinary delivery.

- [#712: Report gone native attempts without stale running state](https://github.com/Flip-Engineering/baton/issues/712).
  Normal CLI and Orchestra UI observations must show a gone or unknown native
  attempt accurately when its process and keeper are absent and terminal status
  is unavailable. Preserve the original input, receipt, conversation, streams,
  assignment and explicit stops. Ordinary recovery and provider configuration
  must preserve that identity. The existing `native-instance-conductor` owns
  assignment of the repair. Related recovery and shared-custody work remains
  in [#696](https://github.com/Flip-Engineering/baton/issues/696),
  [#705](https://github.com/Flip-Engineering/baton/issues/705) and
  [#676](https://github.com/Flip-Engineering/baton/issues/676).

- [#671: Deliver pending guidance into live headless Muse conversations](https://github.com/Flip-Engineering/baton/issues/671).
  The retained `semantic-impl-code` attempt has six pending guidance inputs and
  owns managed build session 29. Muse receives an initial prompt file with stdin
  closed; the current live guidance bridge is enabled for OMP. Provide a supported
  headless input path that preserves the conversation, managed work, parent,
  explicit stops and complete bodies. Distinguish admission, recipient receipt
  and model handling. The existing managed-command runtime wake can continue the
  same conversation. [#705](https://github.com/Flip-Engineering/baton/issues/705)
  covers reconciliation after terminal custody; the continuation requirement is
  recorded in [#572](https://github.com/Flip-Engineering/baton/issues/572).
  [Retained source and custody evidence](https://github.com/Flip-Engineering/baton/issues/671#issuecomment-6133386222)
  records the current input gap and build qualification limits.

- [#703: Manage persistent project settings through installed Baton](https://github.com/Flip-Engineering/baton/issues/703).
  This work remains unfinished. Provide public commands to read and save
  project-local settings that survive reopened and new sessions, worktrees and
  package upgrades. Show effective defaults and explicit session overrides.
  Include model choices for roles and Contributor preference as project defaults.
  Isolate projects and preserve active native routes, conversations and explicit
  stops. Credentials remain in the native providers' external account stores.
  A linked-worktree `--project ... project-sessions` read exited 2 when its
  pointer resolved under the shared Git common directory; see the
  [observed #703 pointer failure](https://github.com/Flip-Engineering/baton/issues/703#issuecomment-6135011161).
  Root coordinates the work; `semantic-controls-next` owns the installed CLI/MCP
  surface, and Root owns UI changes.
