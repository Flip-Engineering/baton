# Baton2 todo

The [open GitHub issues](https://github.com/Flip-Engineering/baton/issues?q=is%3Aissue%20is%3Aopen)
retain findings, ownership and acceptance requirements. This page links current
Baton2 follow-up work for contributors.

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
  Root coordinates the work; `semantic-controls-next` owns the installed CLI/MCP
  surface, and Root owns UI changes.
