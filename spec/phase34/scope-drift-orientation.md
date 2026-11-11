# Phase 34 — scope-drift orientation automation

## OD1 — reuse the authoritative mechanical signal

Automation consumes the existing worker-originated `content.file_edit` normalization and immutable
Brief `pathScope`. It does not add semantic scope judgment, source polling, or a second watcher.
Canonical worktree-relative path handling remains the source of scope truth.

## OD2 — explicit deployment policy

The default `scopeAction: kill` is unchanged. Automatic refresh exists only when deployment selects
`scopeAction: orient` and supplies an exact Atlas epoch, bounded focus/shape/token budget, nonnegative
cooldown, positive per-turn ceiling, and optional bounded note prefix. Invalid or incomplete policy
fails construction.

## OD3 — bounded effect admission

Each normalized outside-scope path is considered once per turn. Only one refresh may compute at a
time; distinct paths during computation are suppressed. Successful scheduling starts a worker-wide
cooldown. `maxRefreshesPerTurn` bounds total Atlas/delivery effects even after cooldown. New native
turn start resets this ephemeral admission state; replay never re-executes old edit events.

## OD4 — exact-fence delivery and interruption

The scheduler snapshots the current fence and calls the shipped `orientWorker` primitive as policy.
The existing precompute and serialized postcompute fence/status checks remain authoritative. A
concurrent interrupt/kill voids delivery and emits a bounded refusal rather than `map_served`.

## OD5 — observable, non-semantic outcomes

The original edit emits `health.scope_violation` with `action: orient` and scheduled/suppressed
status. Dedup/cooldown/turn-limit suppression emits bounded `health.scope_refresh_suppressed` facts.
Capability/delivery refusal emits `health.scope_refresh_refused`. Only an acknowledged nudge emits
`knowledge.map_served`. These signals claim mechanical drift and delivery, never that the worker
understood or obeyed the map.

## OD6 — boundaries

This rung does not infer a focus, choose a new Atlas epoch, expand Brief authority, edit the task,
or override stop policy. Deployment pins the intended boundary. Quartermaster external vetting and
all later capability/knowledge rungs remain separate. No homelab integration is introduced.
