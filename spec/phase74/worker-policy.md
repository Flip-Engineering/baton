# Phase 74 — durable worker autonomy and containment policy

Status: in progress.

Phase 74 replaces scattered `yolo`, bypass, approval, and sandbox defaults with one versioned
worker-policy authority. It preserves the user's preferred default—unattended harness autonomy—while
refusing to treat a worktree, cwd, or private HOME as proof of OS containment.

## WP1 — request

The v1 request is closed and content-addressed:

```json
{
  "schemaVersion": 1,
  "autonomy": { "mode": "unattended" },
  "access": { "mode": "full" },
  "containment": {
    "mode": "workspace_preferred",
    "minimum": "private_runtime"
  }
}
```

`unattended` means the harness does not stop for routine permission choreography. It maps to native
Kimi ACP `yolo`, Claude `bypassPermissions`, Grok `--always-approve`, and Codex approval policy
`never`. Access is a separate axis: `full` is Baton's default, while `workspace` is an explicit
narrower request. Codex therefore defaults to `danger-full-access`, Grok to sandbox `off`, Claude's
private settings disable its command sandbox, and native Kimi remains `yolo`. None of those settings
prove containment.

Containment modes are `workspace_preferred`, `workspace_required`, and `external_required`.
Evidence minima are `private_runtime`, `tool_workspace`, and `external`. A preferred guarantee may
report a visible gap; a required guarantee refuses before provider work.

## WP2 — capability card and resolution

Every adapter declares supported autonomy and access modes, their actual defaults, whether either is selectable
per task, the provider/launch observation strength, their mechanism names, the host-process boundary,
verified containment guarantees, configured-but-unverified preferences, and observation source.

Resolution is deterministic over the normalized request plus normalized card and emits distinct
request, adapter-card, and resolution digests. Private paths, credentials, raw settings, and provider
tokens are forbidden from this projection.

Configured preference is not a guarantee. A harness sandbox flag may be disclosed without becoming
`tool_workspace` until an escape/network/process test or stronger primary attestation proves it.

## WP3 — authority propagation

The implemented authority slice:

1. adds profile schema v2 with a required worker-policy request while preserving schema-v1 digests;
2. binds policy into Plan nodes and the authoritative Brief before approval;
3. resolves it before allocation/dispatch and passes only the resolution to adapters;
4. refuses unsupported autonomy, access, or required containment with typed policy errors;
5. records the request and exact normalized resolution in the orchestrator lifecycle event; and
6. adds the resolution digest to a backward-compatible seven-field route-learning tuple.

The next authority slice must add provider-observed mismatch/kill evidence where the harness can
attest it, preserve the exact resolution across every native recovery path, re-resolve preserved-work
continuations, and expose concise policy attestation through Run outline, evidence, result, and help.

Legacy events and six-field route keys remain readable. They are `legacy_unattested`; Baton never
retroactively infers their worker policy from a newly installed adapter.

## WP4 — current verified slice

The pure request/card/resolution module, adapter cards, Plan/Brief binding, coordinator admission, and
route identity are implemented. The default request is unattended plus full access plus
workspace-preferred/private-runtime-minimum. Cards claim the private runtime they actually consume,
but no filesystem/network/process containment; Claude, Grok, Codex, and native Kimi explicitly report
same-UID host execution and unverified containment. Native Kimi's `yolo` selection is provider-observed;
other present mappings are launch-attested or unavailable.

The one-shot tier consumes Baton's replacement environment, Codex global flags are ordered for the
installed CLI, and no card uses a worktree/private-runtime phrase as proof of host confinement.

## WP5 — external-containment gate

True external containment requires a deployment-owned OS/container/VM boundary with independently
verified filesystem, network, process, and credential guarantees. Only then may a harness run
host-unrestricted *inside that external boundary* while Baton reports containment as `external`.
Same-UID approval bypass remains useful unattended autonomy, but never masquerades as confinement.
