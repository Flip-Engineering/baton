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
