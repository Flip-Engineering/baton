# Phase 71 — isolated Kimi K3 routing through the Claude Code harness

Status: acceptance-red until every contract below is implemented, adversarially tested without a
credential, independently reviewed, and then live-proved only after the user installs a private
Kimi key through the Baton-specific setup script.

The official Kimi integration forwards Claude Code requests to Moonshot's Anthropic-compatible
endpoint. Baton must support that model switch as a scoped worker route without rewriting the
user's Claude Code installation, `~/.claude/settings.json`, `.claude.json`, shell profiles, saved
Claude login, or ambient terminal environment. Harness, provider/model, and reasoning effort remain
separate routing dimensions: Claude Code executes the session; Kimi supplies `kimi-k3[1m]`; K3
currently supports only `max` effort.

Authoritative provider references, refreshed 2026-07-17:

- <https://platform.kimi.ai/docs/guide/claude-code-kimi>
- <https://platform.kimi.ai/docs/guide/kimi-k3-quickstart>
- <https://platform.kimi.ai/docs/guide/use-thinking-effort>

## KK1 — honest route identity

`KimiSessionCli` reuses the persistent `ClaudeSessionCli` lifecycle and wire implementation. Its
resolved harness identity is `claude-code` plus the observed CLI version; its model family/provider
identity is `kimi`/Moonshot; its exact model is `kimi-k3[1m]`; and its effort inventory is exactly
`['max']`. A Kimi-branded provider is never presented as a distinct executable harness.

The orchestrator selects the complete route together. Baton refuses a missing effort for a route
whose card declares effort required, and refuses `low`, `medium`, `high`, or `xhigh` for K3 while
the provider documents only `max`. It does not translate an unsupported local label into `max` and
does not use a global or harness-wide low default. Requested, resolved, launched, and natively
observed identities remain distinct; absence of a native effort echo stays `unavailable`.

## KK2 — per-dispatch provider environment

Provider-backed Claude sessions use one shared route-preparation hook at spawn. The hook receives
the orchestrator-resolved model and effort for that task, validates them against the provider card,
removes conflicting provider variables, and applies the exact provider environment after the
private runtime environment has been assembled. Constructor-only model pinning is insufficient
because one adapter may serve successive exact routes.

For K3 the child receives exactly:

```text
ANTHROPIC_BASE_URL=https://api.moonshot.ai/anthropic
ANTHROPIC_AUTH_TOKEN=<private Baton projection>
ANTHROPIC_MODEL=kimi-k3[1m]
ANTHROPIC_DEFAULT_OPUS_MODEL=kimi-k3[1m]
ANTHROPIC_DEFAULT_SONNET_MODEL=kimi-k3[1m]
ANTHROPIC_DEFAULT_HAIKU_MODEL=kimi-k3[1m]
ANTHROPIC_DEFAULT_FABLE_MODEL=kimi-k3[1m]
CLAUDE_CODE_SUBAGENT_MODEL=kimi-k3[1m]
ENABLE_TOOL_SEARCH=false
CLAUDE_CODE_AUTO_COMPACT_WINDOW=1048576
CLAUDE_CODE_EFFORT_LEVEL=max
```

The native argv also carries the exact `--model kimi-k3[1m]` and `--effort max`. Baton strips all
ambient `ANTHROPIC_*` values, the Claude tier/subagent/model-routing variables, cloud-provider
switches (including Bedrock, Vertex, and Foundry use/skip-auth selectors and their AWS, Google,
Cloud ML, Azure, and Foundry ambient state), tool-search/compaction/effort variables, and especially
`ANTHROPIC_API_KEY` before adding the closed Kimi set. Undocumented compatibility variables are not
invented merely because an old cleanup guide names them.

The Brief is retained inside Baton until the Claude stream emits an init frame whose session and
exact model identity pass the provider-ready check. A mismatched/fallback model is killed and reaped
without receiving objective, repository, or verification content.

## KK3 — private credential boundary

The provider credential is supplied only by explicit in-memory injection for tests/embedding or by
a Baton credential file. Kimi does not fall back to `MOONSHOT_API_KEY`, `ANTHROPIC_API_KEY`, shell
startup files, the Claude keychain/login, or global Claude settings.

The shared bounded credential loader accepts a raw one-line token or a JSON token selected by an
exact JSON pointer. It requires a regular non-symlink file, current-user ownership where the host
exposes a UID, no group/other mode bits, a nonempty size no larger than 16 KiB, bounded pointer
depth, prototype-safe segments, and a nonempty whitespace-free token. Errors contain only the
provider label and a fixed typed code—never the path, pointer contents, or secret.

The loader compares path metadata with the opened no-follow descriptor, reads only that descriptor,
and re-stats it after the read; replacement or mutation across the read window refuses closed. Both
the lexical and resolved credential path must be outside every deployment-supplied repository root,
including when a parent-directory symlink attempts to cross that boundary.

The recommended persistent location is:

```text
${XDG_CONFIG_HOME:-$HOME/.config}/baton/credentials/kimi.json
```

Its parent directories are mode `0700` and the file is atomically installed mode `0600`. It is not
inside the repository and is never copied into evidence, exports, prompts, Git, or public status.
The final user-facing setup script uses a hidden prompt, `umask 077`, a same-directory temporary
file, atomic rename, and prints only the installed path and a credential-presence result.

## KK4 — installation and configuration non-interference

Baton discovers and executes the existing `claude` binary; it never installs, upgrades, patches,
logs into, logs out of, or replaces Claude Code. Every Kimi worker gets a Baton-owned private
`HOME`, `TMPDIR`, and `CLAUDE_CONFIG_DIR`. The private settings file contains Baton's sandbox
policy, not the API key. Tests snapshot the absence or exact bytes/metadata of representative
global Claude configuration before and after spawn, normal completion, kill, crash, and replay.

Runtime identity is derived from the selected adapter card, never its deployment registry key:
the card selects the Claude Code configuration surface, Kimi provider family, API-key posture, and
adapter-managed credential presence. Arbitrary internal registry aliases therefore cannot select a
different credential family or config home.

The Kimi credential overrides a saved Claude login only inside the worker process, as specified by
the provider. Closing the worker removes its private runtime scope after exact process close and
preserved-progress handling; it does not alter the saved login.

## KK5 — lifecycle inheritance and failure honesty

Kimi inherits Claude session spawn, multi-turn prompt/steer, interrupt, approval, exact process
generation, kill, close, and group-reap behavior. Missing/insecure credentials, unsupported model
or effort, authentication refusal, model mismatch, wire failure, provider crash, and timeout are
typed failures. They cannot fall back to Anthropic, another Kimi model, GLM, Codex, Grok, or an
ambient key.

Pre-ready refusal creates no provider work. A started process remains owned until a correlated
close. Dirty progress follows Phase 70 preservation on forced stop, host shutdown, timeout, or
crash; failure to preserve retains the runtime/worktree and keeps shutdown red.

All protected credential values known to the adapter are also stdout/wire and stderr output
canaries. If any complete or partial provider frame contains one, Baton emits no content/result
payload from that frame, kills and reaps the process, and records only the fixed
`provider_output_secret` failure code.

## KK6 — unified Baton surface

The ordinary local entry remains objective-first. With a deployment profile that has one approved
Kimi route, the intended invocation is:

```text
baton "OBJECTIVE" --model 'kimi-k3[1m]' --effort max
```

The harness may be inferred only when model inventory and deployment policy identify one exact
Claude Code adapter; otherwise the orchestrator supplies `--harness claude-code`. No user-facing
argument accepts endpoint URLs, tokens, config paths, environment maps, context ceilings, export
sizes, provider-turn ceilings, or raw runtime directories. Contextual help explains the selected
harness, model, effort, credential presence, and isolation posture at outline depth, with private
coordinates only at authorized evidence depth.

The recursive dogfood runner gains Kimi model inference and the same concise route arguments. Its
deployment assembly resolves the private Baton credential path internally and registers the Kimi
adapter under the actual Claude Code harness identity. It never requires an environment-variable
wall to launch ordinary work.

## KK7 — capability metadata and coexistence

The adapter card exposes provider compatibility and current limitations as data: Anthropic-compatible
transport, required credential kind, exact models, max context, effort-required inventory, native
session verbs, unsupported Claude Tool Search, and unavailable native effort echo. Routing uses
that metadata rather than model-name folklore.

A deployment may contain native Claude, GLM-through-Claude, and Kimi-through-Claude candidates
without treating them as the same route. Candidate identity includes harness/version,
provider/model family, exact model, exact effort, and task type. Registry keys remain internal
adapter identities and never replace the resolved harness identity in receipts.

## KK8 — zero-credential acceptance gate

Before requesting a real key, deterministic tests prove:

1. exact K3 environment and argv reach only a fake Claude child;
2. every conflicting ambient provider variable is absent;
3. missing, symlinked, foreign-owned, permissive, oversized, malformed, and wrong-pointer
   credentials fail with fixed secret-free codes;
4. K3 accepts only explicit `max` and routing refuses missing/other efforts before spawn;
5. model, effort, tier, subagent, context, and tool-search values switch together per dispatch;
6. global Claude files and the installed binary are byte-for-byte untouched;
7. model mismatch and auth refusal cannot fall back;
8. process close, kill/reap, runtime removal, and Phase 70 preservation retain exact ordering;
9. index exports and application/runner assembly select the actual Claude Code harness plus Kimi
   model/effort without exposing credentials; and
10. Claude, GLM, and all existing lifecycle/model-selection tests remain green.

Only after KK8, independent review, and the full affected suite are green may the user run the
hidden-input setup script. The first live proof then uses a tiny read-only task, verifies `/status`
equivalents through native initialization evidence (base endpoint family and exact model without
secret output), performs one bounded edit task, and proves confirmed kill/reap and no global Claude
configuration change. No homelab integration is part of this phase.

Native Kimi Code is a separate harness, not another name for this provider-switched Claude Code
route. Its ACP worker transport and its capability-scoped Baton orchestrator role are specified in
`spec/phase72/native-kimi-code-bidirectional.md`; neither route may impersonate the other in model,
harness, session, credential, or lifecycle receipts.
