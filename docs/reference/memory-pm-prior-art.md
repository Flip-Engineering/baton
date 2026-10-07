# Baton Doc 08 Prior Art — Shared Memory & Task/Project Substrates for Multi-Agent Coding Fleets

*Evidence tiering: local disk/binary inspection (Claude Code 2.1.205, Codex CLI 0.144.0, openai-codex plugin 1.0.6) outranks web docs; disagreements are flagged inline. Verified 2026-07-09.*

## Summary

- **Anthropic agent teams already ship a working task ledger + mailbox** as plain JSON files under `~/.claude/tasks/` and `~/.claude/teams/`, with proper-lockfile claiming, bidirectional `blocks`/`blockedBy` edges, and 14 typed protocol message frames — fully reverse-engineered below from disk + binary; baton's claude-adapter can *reuse* it via `CLAUDE_CODE_TASK_LIST_ID`.
- **OpenAI's codex plugin job ledger** (`state.mjs`/`tracked-jobs.mjs`) is a clean poll-shaped job model (queued→running→completed/failed/cancelled, phase, sessionId scoping, per-job JSON + append-only log) but has **zero multi-writer safety** — unlocked read-modify-write of `state.json` with non-atomic `writeFileSync`.
- **claude-flow's verifiable core is a SQLite KV** (`.swarm/memory.db`, `memory_store` with namespace+TTL) behind one MCP tool; the swarm/neural/consensus vocabulary is mostly marketing, and its own issue tracker documents memory fragmenting into 14 databases on cwd changes.
- **MemGPT-style memory is already landing in coding harnesses natively**: Codex 0.144.0's experimental `memories` feature is a *git-versioned markdown store* (`~/.codex/memories/`, its own `.git`, rollout summaries keyed to `thread_id` + `rollout_path`) — the strongest evidence that "agent memory for ephemeral workers" converges on files+git, not vector DBs.
- **Beads (steveyegge) is the best-designed task-DAG prior art**: hash IDs, four dependency types, offline transitive `bd ready`, atomic `--claim` — but it bet its storage on Dolt (embedded = single-writer), a heavy dependency baton should steal ideas from, not adopt.

---

## 1. Anthropic agent teams: shared task list + mailbox (local evidence, authoritative)

Feature-gated by `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (env or `settings.json` `"env"` block) — confirmed both in docs (https://code.claude.com/docs/en/agent-teams) and in binary strings of `$HOME/.local/share/claude/versions/2.1.205`.

### 1.1 Task list on disk

Directory: `~/.claude/tasks/<list-id>/`. List-id resolution (decompiled from the binary): env `CLAUDE_CODE_TASK_LIST_ID` overrides → else current team name → else session id; the id is sanitized `replace(/[^a-zA-Z0-9_-]+/g,"-")`. Per-list contents (observed at `$HOME/.claude/tasks/2aa9e79e-f854-41c0-9170-a113c8aa7e99/`, 487 records):

- `<numeric-id>.json` — one file per task
- `.highwatermark` — plain integer, the ID allocator (observed value `859`); read/parsed with `parseInt`, reconciled upward under lock if a task id exceeds it
- `.lock` — zero-byte file created with `fs.writeFile(path, "", {flag:"wx"})`, then locked via a proper-lockfile-style `lock()` with options `{retries:{retries:30,minTimeout:5,maxTimeout:100},onCompromised:…}` (extracted verbatim from binary strings)

Task record schema (Zod schema extracted from the binary, field-exact):

```js
{ id: string, subject: string, description: string,
  activeForm?: string,            // spinner text ("Auditing flip-client (report + backlog)")
  owner?: string,                 // claiming agent name; absent = unassigned
  status: "pending"|"in_progress"|"completed",   // full enum, nothing else
  blocks: string[], blockedBy: string[],         // task-id edges, maintained bidirectionally
  metadata?: Record<string, unknown> }           // free-form; observed e.g. {"shipped":"client PR #294 …"}
```

Real record: `$HOME/.claude/tasks/2aa9e79e-…/448.json` — note `description` is used as a multi-KB findings dump in practice; the schema tolerates it, context budgets don't.

**Claiming**: take the dir-level lock → re-read task → reject with typed reasons — the full set in the binary is `"task_not_found"`, `"already_claimed"` (owner set ≠ claimer), `"already_resolved"` (status completed), `"blocked"` (non-completed tasks remain in `blockedBy`), `"agent_busy"`, `"delisted"` → else set `owner` + `in_progress`. Dependency add is a bidirectional write: adding an edge appends to `blocks` on the blocker *and* `blockedBy` on the blocked task. Docs confirm the model: "a pending task with unresolved dependencies cannot be claimed until those dependencies are completed" and "Task claiming uses file locking to prevent race conditions".

> **Web-vs-local disagreement**: third-party blogs (e.g. mindstudio.ai) describe per-task `.pending`/`.lock` marker files. Local disk shows a *single* dir-level `.lock` and status inside each JSON record. Local evidence wins.

### 1.2 Team config

`~/.claude/teams/<team-name>/config.json` (observed at `$HOME/.claude/teams/arch-refactor/config.json`): `name`, `description`, `createdAt` (epoch ms), `leadAgentId` (`"team-lead@arch-refactor"` — agent ids are `name@team`), `leadSessionId`, and `members[]` with `agentId`, `name`, `agentType`, `model`, `prompt` (full spawn prompt persisted!), `color`, `planModeRequired`, `joinedAt`, `tmuxPaneId` (`""` or `"in-process"` or a pane id), `cwd`, `subscriptions`, `backendType: "in-process"`. Docs: team dir is deleted at session end; the tasks dir persists (retention via `cleanupPeriodDays`). Default team name is `session-` + first 8 chars of session id (matches observed `session-83eb1687` etc.).

### 1.3 Mailbox

Path (function `getInboxPath` decompiled): `~/.claude/teams/<team>/inboxes/<agent>.json` — a JSON **array**, one file per recipient. Write path (function `writeToMailbox`, verbatim mechanics):

1. `mkdir` the inboxes dir; 2. create-if-absent with `writeExclusive(path, "[]")` (EEXIST tolerated); 3. lock with `lockfilePath = inbox + ".lock"` (same retry options); 4. read array, push envelope, `atomicWrite` (temp+rename), unlock.

Envelope: `{from, text, timestamp, type: "message", read: false}` plus (current builds) `msg_id: randomUUID(), msgV: 1`. Observed June-2026 messages lack `msg_id`/`msgV` — the envelope grew fields; treat as unversioned-in-practice.

**Protocol frames ride *inside* `text` as JSON-encoded strings** (JSON-in-string-in-JSON). Type literals confirmed in the binary: `task_assignment`, `task_completed`, `idle_notification`, `shutdown_request`, `shutdown_approved`, `shutdown_rejected`, `teammate_terminated`, `plan_approval_request`, `plan_approval_response`, `mode_set_request`, `permission_request`, `permission_response`, `sandbox_permission_request`, `team_permission_update`. Observed example (`inboxes/agent-811.json`):

```json
{ "from": "team-lead",
  "text": "{\"type\":\"task_assignment\",\"taskId\":\"811\",\"subject\":\"…\",\"description\":\"…\",\"assignedBy\":\"team-lead\",\"timestamp\":\"2026-06-18T03:10:31.900Z\"}",
  "timestamp": "2026-06-18T03:10:31.900Z", "type": "message", "read": false }
```

Read side: messages are marked `read:true` (or filtered out by predicate under the same lock); delivery to a live teammate is push-injected into its loop, the file is the durable queue. Quality gates: hooks `TeammateIdle`, `TaskCreated`, `TaskCompleted` (exit code 2 = block + feedback).

**Good**: minimal schema that agents actually maintain; crash-tolerant (one file per task, lock only around mutations); dependency unblocking is automatic; `CLAUDE_CODE_TASK_LIST_ID` decouples the ledger from teams — two unrelated sessions pointed at the same list-id share tasks. **Limiting**: 3 statuses (no `blocked`/`cancelled`/`review`); no owner *lease* — a dead teammate's `owner` wedges a task until someone manually reassigns (docs admit "Task status can lag… update the task status manually"); no per-task event history/audit trail; no artifact field (people abuse `metadata` and `description`); mailbox is per-recipient with no broadcast ("send one message per recipient" — docs); everything is machine-local under `~/.claude` (no cross-host story); JSON-in-string encoding is hostile to tooling.

## 2. OpenAI codex plugin job ledger (local evidence, authoritative)

Source read at `$HOME/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/lib/state.mjs`, `tracked-jobs.mjs`, `job-control.mjs`, and `scripts/codex-companion.mjs`; live state at `$HOME/.claude/plugins/data/codex-openai-codex/state/`.

**State dir** (`state.mjs:29-52`): `${CLAUDE_PLUGIN_DATA}/state/{basename(workspaceRoot)}-{sha256(realpath(workspaceRoot)).hex.slice(0,16)}/`, fallback `os.tmpdir()/codex-companion`. Observed: `…/state/Development-6469b41f0e6f6312/` containing `state.json`, `broker.json` (app-server broker endpoint: `{"endpoint":"unix:/var/folders/…/cxc-…/broker.sock","pidFile":…,"pid":71004}`), and `jobs/`.

**`state.json`**: `{version: 1, config: {stopReviewGate: false}, jobs: [...]}`. Jobs array is pruned to `MAX_JOBS = 50` by `updatedAt` desc (`state.mjs:13,80-84`); evicted jobs get their `jobs/<id>.json` and `<id>.log` unlinked (`state.mjs:105-112`).

**Job record** (summary row in `state.json`; full record in `jobs/<jobId>.json`, verbatim observed):

```json
{ "id": "task-mr413zaw-jo06sm",          // `${prefix}-${Date.now().toString(36)}-${rand6}` (state.mjs:124-127)
  "kind": "task", "kindLabel": "rescue", // kinds: task | review | adversarial-review
  "title": "Codex Task", "jobClass": "task", "summary": "## 1. CRITIQUE",
  "workspaceRoot": "$HOME/Development", "write": false,
  "sessionId": "c99705d9-…",             // from env CODEX_COMPANION_SESSION_ID (tracked-jobs.mjs:6,60-68)
  "status": "completed",                 // queued | running | completed | failed | cancelled
  "phase": "done",                       // queued|starting|…|done|failed|cancelled; live phases pushed from progress events
  "pid": null, "threadId": "019f24c7-…", "turnId": "019f24c7-…",
  "createdAt": "…", "startedAt": "…", "updatedAt": "…", "completedAt": "…",
  "logFile": "…/jobs/task-mr413zaw-jo06sm.log" }
```

The full `jobs/<id>.json` additionally stores `result` (structured payload incl. Codex `threadId`, `touchedFiles`, `reasoningSummary`), `rendered` (final text), `errorMessage`, and — for queued background jobs — the entire `request` so a detached worker can replay it (`codex-companion.mjs:684-710`: `spawn(process.execPath, [script, "task-worker", "--cwd", cwd, "--job-id", id], {detached:true, stdio:"ignore"})`). Log file is append-only `[ISO-timestamp] message` lines; `status` phases for legacy jobs are *inferred by regexing the log tail* (`job-control.mjs:109-159` — e.g. `running command:` + test-looking词 → `"verifying"`).

**Session scoping**: `status`/`result`/`cancel`/`task-resume-candidate` filter jobs to `job.sessionId === env[CODEX_COMPANION_SESSION_ID]` when set (`job-control.mjs:15-25`), so concurrent Claude sessions in one workspace see only their own jobs — but the underlying store is shared. **Query surface**: `codex-companion.mjs status [job-id] [--all] [--json] [--wait --timeout-ms --poll-interval-ms]` (defaults 240 000 ms / 2 000 ms, `codex-companion.mjs:69-70`), `result [job-id] [--json]`, `cancel`, with job-id **prefix matching** (`job-control.mjs:191-211`, ambiguous prefix → error).

**Concurrency story: none.** `updateState()` is `loadState → mutate → saveState` with no lock, and `saveState` uses bare `fs.writeFileSync` — not temp+rename (`state.mjs:92-122`). A background worker finishing (`upsertJob`) racing a foreground `cancel` (also `upsertJob`) can lose one write or, worst-case, expose a torn `state.json` (mitigated only by the `try{JSON.parse}catch{return defaultState()}` on load, which silently *resets the whole ledger*). This is safe-enough for ≤1 concurrent job per human, and disqualifying as a fleet substrate. Notable contrast: the same company's plugin carefully single-flights its app-server broker, while the Claude teams mailbox (Anthropic) does lock + atomic-rename. **Steal**: job-id scheme, status/phase split, `--wait` long-poll ergonomics, per-job append-only log, session scoping, storing the replayable `request` in the job record. **Reject**: unlocked RMW, prune-by-count that deletes evidence (`MAX_JOBS=50` violates "no arbitrary numeric limits" instincts), phase-by-log-regex.

## 3. claude-flow / ruflo: marketing vs mechanism (web)

**Verifiable mechanism**: a SQLite database at `.swarm/memory.db` with a `memory_store` table `(id INTEGER PK, key TEXT, value TEXT, namespace TEXT DEFAULT 'default', metadata TEXT, created_at, updated_at, expires_at)` plus ~11 sibling tables (`sessions`, `agents`, `tasks`, `agent_memory`, `shared_state`, `events`, `patterns`, `performance_metrics`, `workflow_state`, `swarm_topology`, `consensus_state`) — per the project wiki (https://github.com/ruvnet/ruflo/wiki/Memory-System) and ruvnet's own playbook gist (https://gist.github.com/ruvnet/9b066e77dd2980bfdcc5adf3bc082281). Access is via CLI (`npx claude-flow@alpha memory stats|list|query "auth*"`) and one MCP tool: `mcp__claude-flow__memory_usage({action:"store"|"search"|"query", namespace, key, value, ttl})`, with conventional namespaces (`artifacts` ttl=0, `shared` ttl=1800, `patterns` ttl=604800, `events` ttl=2592000, `workflow_state` ttl=0, `consensus`). Hive-mind mode adds a `.hive-mind/` dir and `hive-mind spawn|status|resume` session persistence.

**Marketing to discount**: "314 MCP tools", "HNSW 150x-12,500x faster", queen-led consensus, neural training. The mechanically real part is: shared SQLite KV + TTL + namespaces, used as a blackboard by concurrently running Claude Code subagents. **Concurrency story**: whatever SQLite gives you (WAL, busy-timeout) — acceptable single-host; but the project's own issue #695 (https://github.com/ruvnet/ruflo/issues/695) documents the failure mode that matters: the DB path is resolved *relative to cwd*, so directory-changing agents spawned "14 separate `.swarm` directories", each with its own `memory.db`, and config "doesn't support variable expansion" — memory silently fragments. **Steal**: namespace+TTL as first-class ledger columns; the blackboard (`shared_state`) pattern. **Reject**: cwd-relative store resolution (baton's hub must own one canonical path per fleet), KV-as-everything (tasks and events deserve typed tables), unverifiable feature surface.

## 4. MemGPT/Letta-style memory — and its native arrival in coding harnesses

**Letta mechanism** (https://docs.letta.com/guides/core-concepts/memory/shared-memory, /guides/agents/architectures/sleeptime/): the unit is a **memory block** — `client.blocks.create(label=…, description=…, value=…, limit=…, read_only=True?)` — a labeled, char-limited region compiled into every attached agent's context. Sharing = attaching one `block_id` to many agents (`block_ids=[…]` at `agents.create`, or `client.agents.blocks.attach(agent_id, block_id)`); an update is visible to all attachees next turn. Concurrency is documented per *tool*: `memory_insert` append-only (safe), `memory_replace` compare-and-fail ("fails if target changed"), `memory_rethink` last-writer-wins; the docs' own mitigation is sociological — "Designate one agent (or sleep-time memory) as the 'owner' for heavy edits. Other agents append via `memory_insert`." Sleep-time agents are background agents sharing the primary's blocks and rewriting them asynchronously.

**Does it apply to ephemeral coding workers?** Letta assumes durable server-hosted agent objects; baton workers are throwaway processes. But the *block* abstraction transfers cleanly: a hub-owned, size-capped, labeled text region (brief / findings-board / decisions) injected into every worker spawn prompt and editable through hub tools with Letta's exact write discipline (append free-for-all, replace CAS, rewrite owner-only).

**Local evidence that this is already happening**: Codex 0.144.0 ships experimental `memories` (`codex features list` → `memories  experimental  true`; enabled via `[features] memories = true` in `$HOME/.codex/config.toml`). On disk at `$HOME/.codex/memories/`: **its own `.git` repo** ("Initialize Codex git baseline"), `MEMORY.md` (consolidated index organized as `# Task Group:` sections with `scope:`, `applies_to: cwd=…; reuse_rule=…`, `### keywords`), `raw_memories.md`, `memory_summary.md`, `rollout_summaries/<ts>-<slug>.md` each with front-matter `thread_id`, `updated_at`, `rollout_path` (pointing into `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`), `cwd`, `git_branch`, and an `extensions/ad_hoc/notes/` inbox whose `instructions.md` mandates consolidation ("Never delete a note file"). This is MemGPT's core-memory/archival split re-materialized as *markdown + git + session-ledger pointers* — sleep-time consolidation included (summaries are written post-turn). For baton: the memory substrate for coding fleets is converging on versioned files keyed to session ledgers, not embeddings.

## 5. Beads (steveyegge) — task-DAG built for agents (web)

Real and active: https://github.com/steveyegge/beads (Go; also surfaced via Yegge's Gas Town orchestrator). **Mechanism**: issues in a **Dolt** version-controlled SQL DB — embedded mode in `.beads/embeddeddolt/` ("Single-writer only (file locking enforced)") or server mode in `.beads/dolt/` via `bd dolt set mode server` ("Supports multiple concurrent writers"; per-project servers by default, opt-in shared server `BEADS_DOLT_SHARED_SERVER=1`). `.beads/issues.jsonl` is explicitly "an export for viewers and interchange, not the source of truth". Sync rides Dolt remotes (`bd dolt push/pull` against `refs/dolt/data`), with "cell-level merge" and `bd vc conflicts` for the remainder. **IDs**: hash-based `bd-a1b2` ("prevent merge collisions in multi-agent/multi-branch workflows"), hierarchical `bd-a3f8.1.1`. **Dependency types**: `blocks`, `related`, `parent-child`, `discovered-from` — only `blocks` gates readiness; `discovered-from` records work-provenance (`bd create "Found issue" --deps discovered-from:<parent-id>`), the standout idea. **Ready-work detection**: `bd ready [--json] [--assignee agent-name]` — "computes transitive blocking offline in ~10ms". **Claiming**: `bd update <id> --claim` — "Atomically claim a task (sets assignee + in_progress)". Extras aimed at agents: `bd prime` (print workflow context + memories), `bd remember "insight"`, `bd prune`/`bd purge` (ephemeral "wisps"). **Admitted limits** (FAQ): per-project DB isolation ("Issues cannot reference issues in other projects"), "CLI/API changes still happen", 1.x churn — and note the architecture already churned once (earlier SQLite+JSONL-in-git design → Dolt). **Steal**: `ready` as a first-class hub verb; `discovered-from` lineage; atomic claim verb with typed failures; hash IDs (Claude teams' `.highwatermark` integers can't merge across machines). **Reject**: taking a Dolt dependency; embedded single-writer as default posture for a fleet.

## 6. Git-as-memory (worktrees, commit protocols, PR-as-result-contract)

Mechanisms in current use, locally evidenced where possible:

- **Worktree-per-worker**: Claude Code documents parallel sessions via git worktrees (https://code.claude.com/docs/en/worktrees) and exposes `EnterWorktree`/`ExitWorktree` tools plus `WorktreeCreate`/`WorktreeRemove` hook events (present in this installation's tool inventory; baton doc 04 already commits to per-task worktrees in the Sidecar posture — `$HOME/Development/Experiments/baton/docs/04-architecture-options.md:73`). Isolation = concurrency safety by construction: no two workers share a checkout.
- **Commit-message protocol**: session-attribution trailers are already standard practice — `Co-Authored-By: …` and `Claude-Session: https://claude.ai/code/session_…` (mandated in this environment's own harness config), giving `git log --grep` a worker/session join key for free. Codex briefly had `codex_git_commit` as a feature (now `removed` per `codex features list`).
- **PR-as-result-contract**: `claude --from-pr` (sessions linked to PRs, doc 02 §Claude Code, `$HOME/Development/Experiments/baton/docs/02-harness-control-surfaces.md:59`), `gh pr` as the acceptance surface, and Codex review targets expressed in git terms (`{type:"baseBranch", branch}` / `{type:"uncommittedChanges"}`, `codex-companion.mjs:259-269`). The reviewable diff *is* the result; everything else is commentary.
- **Memory-in-git**: Codex `~/.codex/memories/` is literally a git repo (§4).

**Concurrency story**: git is the only substrate here with a real multi-writer merge engine, but merge semantics are line-based — fine for artifacts, wrong for ledgers (two agents editing one JSONL/markdown task file conflict constantly; beads left exactly this design for Dolt). **Query surface**: `git log/grep/blame` — strong for provenance, useless for "what's ready to work on". **Steal**: worktree-per-worker as law; commit/PR as the artifact registry's primary keys; session-trailer join keys. **Reject**: task state in git (write-only memory — Yegge's founding critique of markdown plans holds for commit messages too).

## 7. OTel / event-ledger as memory (replayable JSONL)

- **Claude Code OTel** (env vars verified in the 2.1.205 binary): `CLAUDE_CODE_ENABLE_TELEMETRY`, `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`, `OTEL_EXPORTER_OTLP_ENDPOINT|HEADERS|PROTOCOL|…` (full OTLP var family present); metric names verified: `claude_code.token.usage`, `claude_code.cost.usage`, `claude_code.session`, `claude_code.commit.count`, `claude_code.pull_request.count`, `claude_code.lines_of_code.count`; event stream via the logs exporter (`claude_code.user_prompt`, `claude_code.tool_result`, `claude_code.api_request` etc. per https://code.claude.com/docs/en/monitoring-usage). OTel is **egress, not memory**: fire-and-forget, queryable only if you operate a collector, no replay contract.
- **Session transcripts as the real event ledger**: Claude Code writes replayable JSONL per session at `~/.claude/projects/<cwd-slug>/<session-id>.jsonl` (consumed by `--resume`); Codex writes rollouts at `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl` (observed; line 1 is session meta `{"id":"…","timestamp":"…"}`, then typed items). These are proven cross-harness interchange objects: the codex plugin's `transfer` command imports a Claude session JSONL into a Codex thread (`codex-companion.mjs:625-641`, `claude-session-transfer.mjs`), and Codex app-server has `externalAgentConfig/import` + `readHistories` (doc 02:44). Codex `memories` builds its summaries *on top of* rollout paths (§4) — ledger-as-substrate, memory-as-derived-view.
- **Concurrency**: single writer per file by construction (one session, one file) — the only safe file-based pattern observed anywhere in this dossier. Query surface is grep-grade until indexed; baton doc 04 already specifies "append-only JSONL event log per worker + SQLite index" (`04-architecture-options.md:42`), which matches what the evidence supports.

---

## Limitations

- **Agent teams are experimental and say so**: gated by `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`; documented limitations include no `/resume`/`/rewind` of in-process teammates, task-status lag ("teammates sometimes fail to mark tasks as completed, which blocks dependent tasks"), one team per session, no nested teams, fixed lead (https://code.claude.com/docs/en/agent-teams#limitations). On-disk formats are **unversioned and undocumented** — everything in §1 is reverse-engineered from a stripped Bun binary and may break silently on any release (the mailbox envelope already grew `msg_id`/`msgV` between June builds and 2.1.205). Docs snapshot themselves "as of v2.1.178" and note `TeamCreate`/`TeamDelete` tools already removed.
- **Codex-companion ledger**: not a public API (plugin-internal, `codex/1.0.6`); unlocked non-atomic writes (§2); `MAX_JOBS=50` silently deletes history including logs; a corrupt `state.json` resets to empty without warning (`state.mjs:75-77`).
- **Codex `memories`**: feature-flagged `experimental` (`codex features list`); format (MEMORY.md conventions, ad-hoc notes contract) is implementation detail with no compatibility promise.
- **claude-flow**: alpha-versioned (`claude-flow@alpha`); wiki pages partially 404; core reliability bugs open in its own tracker (issue #695 fragmentation; no config variable expansion). Treat every performance/intelligence claim as unverified.
- **beads**: 1.x, "CLI/API changes still happen"; already rewrote its storage layer once (SQLite/JSONL→Dolt); embedded mode is explicitly single-writer; cross-project references unsupported by design.
- **Letta**: requires a running Letta server; concurrency guarantees are per-memory-tool and partly sociological ("designate one owner"); nothing in it addresses process-ephemeral workers natively.
- **OTel in Claude Code**: metrics/logs only — no trace-level replay; `CLAUDE_CODE_ENABLE_TELEMETRY` semantics and metric set can change per release (verify against the installed binary as done here).
- **`CLAUDE_CODE_TASK_LIST_ID`** is present in the binary and resolves the task-list directory, but is undocumented; behavior when pointed across unrelated concurrent sessions is untested here (see Open unknowns).

## Open unknowns

1. Whether Claude Code's task tools (`TaskCreate`/`TaskUpdate`/`TaskList`/`TaskGet`) function with `CLAUDE_CODE_TASK_LIST_ID` set but *without* `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` — the binary has a separate gate (`CLAUDE_CODE_ENABLE_TASKS`, polarity unclear from decompilation) and this session had the tools available; needs a controlled two-session experiment (cheap, no quota).
2. The exact lock library semantics in the Claude binary (`onCompromised` handler suggests proper-lockfile's staleness detection — stale-lock timeout value unverified), i.e. what happens when a teammate dies holding the task-list lock.
3. Whether inbox files are compacted/cleared (a `clearMailbox` export exists in the binary) or grow unboundedly across a long session; several observed inboxes retain read messages.
4. Codex `memories` write triggers (per-turn? per-session-end?) and whether the `~/.codex/memories/.git` repo is ever pushed/merged — single observed commit suggests baseline-only so far.
5. claude-flow's actual SQLite DDL for the 11 non-`memory_store` tables (wiki-asserted, not source-verified here).
6. Whether beads' Dolt server mode is compatible with worktree-per-worker checkouts of `.beads/` (per-project server discovery across worktrees).

## Synthesis for baton

What belongs in the hub, judged against the evidence:

1. **Task ledger — yes, hub-owned, SQLite, single-writer through the hub.** The two file-based ledgers examined both concede the point: Anthropic needed dir-level locks + retries and still documents stuck tasks; OpenAI's plugin skipped locking and is unsafe. Since doc 04 already commits to a hub daemon, the daemon *is* the mutex — steal the **schemas**, not the files. Concretely: Claude teams' minimal record (`subject/description/owner/status/blocks/blockedBy/metadata`) + beads' additions (`ready` verb computing transitive blocking; `discovered-from` provenance edges; hash IDs so ledgers merge across hosts; atomic `claim` returning typed failures — adopt Claude's exact reason vocabulary `already_claimed|already_resolved|blocked|…`). Add what both lack: **owner leases with heartbeat expiry** (fixes the dead-teammate wedge), a per-task **event history**, and first-class **artifact refs** (commit SHA / PR URL / worktree path) instead of metadata blobs. Tradeoff: hub-as-mutex makes the hub a SPOF for coordination; mitigate with the ledger being plain SQLite+JSONL on disk so a crashed hub restarts from durable state — the property the file substrates get for free and baton must not lose.
2. **Mailbox — yes, but as ledger events, not per-recipient files.** Steal Anthropic's *frame vocabulary* wholesale — `task_assignment`, `task_completed`, `idle_notification`, `shutdown_request/approved/rejected`, `plan_approval_request/response`, `permission_request/response` are exactly the control-plane messages a fleet needs and they're field-proven. Reject the encoding (JSON-in-string-in-JSON) and the N-files-N-locks topology: in baton these are typed rows in the event ledger delivered via `fleet_wait`, giving broadcast, replay, and audit for free.
3. **Knowledge graph — no (defer).** Nothing surveyed shows ephemeral coding workers profiting from a KG; claude-flow's usage collapses to namespaced KV, and Codex/Letta converge on *bounded text blocks + derived summaries*. Instead adopt **Letta-shaped memory blocks** hosted by the hub: `brief` (owner: orchestrator, read-only to workers), `findings-board` (append-only, Letta's `memory_insert` discipline), `decisions` (CAS replace). Cheap, context-budgeted by `limit`, and injectable at spawn on every harness. A KG can be derived later from the event ledger if ever justified.
4. **Artifact registry — yes, thin and git-native.** The repo carries bytes; the hub carries pointers (`{commit, branch, worktree, pr_url, result_json}`) plus the result-contract JSON (Codex-side natively enforceable via `codex exec --output-schema`, doc 02:46). Worktree-per-worker is law; PR/diff is the acceptance surface. Reject any design that copies file contents into the ledger.
5. **Event ledger — yes, and it doubles as memory.** JSONL-per-worker + SQLite index (doc 04/05 as planned) is validated by the strongest pattern found in the wild: both harnesses' session files are single-writer replayable JSONL, and Codex's experimental memory system is *built as a derived view over its rollout ledger* (summaries with `rollout_path` front-matter). Baton should plan the same layering: ledger is ground truth; memory blocks, task history, and consolidation summaries are derived, regenerable views. OTel remains optional egress, never the store.
6. **Integration opportunity worth a spike**: the claude-adapter can spawn workers with `CLAUDE_CODE_TASK_LIST_ID=<baton-fleet-id>` so workers' *native* task tools read/write a directory baton mirrors into its ledger (watcher on `~/.claude/tasks/<id>/`) — zero prompt-engineering for task discipline on the Claude leg. Gated on Open unknown #1; treat the on-disk format as a compatibility risk (unversioned), so mirror, don't depend.

## Sources

**Local (authoritative for installed versions)**
- `$HOME/.claude/tasks/2aa9e79e-f854-41c0-9170-a113c8aa7e99/` — 487 task records, `.highwatermark`, `.lock` (task schema, statuses, real examples; e.g. `448.json`, `729.json` metadata)
- `$HOME/.claude/teams/arch-refactor/config.json`, `$HOME/.claude/teams/2aa9e79e-…/inboxes/*.json` (team config schema; 120 mailbox messages, all `task_assignment`)
- `$HOME/.local/share/claude/versions/2.1.205` (binary strings: task Zod schema, claim reasons, lock options `{retries:30,minTimeout:5,maxTimeout:100}`, `writeToMailbox` mechanics, protocol frame literals, `CLAUDE_CODE_TASK_LIST_ID`/`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, OTel vars and `claude_code.*` metrics)
- `$HOME/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/lib/state.mjs` (:8-13, :29-52, :80-127), `lib/tracked-jobs.mjs` (:6, :60-68, :142-204), `lib/job-control.mjs` (:8-25, :109-211), `scripts/codex-companion.mjs` (:69-73, :290-316, :671-710, :963-1022)
- `$HOME/.claude/plugins/data/codex-openai-codex/state/Development-6469b41f0e6f6312/{state.json,broker.json,jobs/}` (live job record)
- `$HOME/.codex/config.toml` (`memories = true`), `codex features list` output, `$HOME/.codex/memories/{MEMORY.md,raw_memories.md,rollout_summaries/,extensions/ad_hoc/}` (+ its `.git`), `$HOME/.codex/sessions/rollout-*.jsonl`
- `$HOME/Development/Experiments/baton/docs/02-harness-control-surfaces.md`, `docs/04-architecture-options.md`

**Web**
- Anthropic agent teams docs: https://code.claude.com/docs/en/agent-teams · worktrees: https://code.claude.com/docs/en/worktrees · monitoring: https://code.claude.com/docs/en/monitoring-usage
- Beads: https://github.com/steveyegge/beads (README) · https://github.com/steveyegge/beads/blob/main/docs/FAQ.md · https://steve-yegge.medium.com/introducing-beads-a-coding-agent-memory-system-637d7d92514a
- claude-flow/ruflo: https://github.com/ruvnet/ruflo · wiki https://github.com/ruvnet/ruflo/wiki/Memory-System · issue https://github.com/ruvnet/ruflo/issues/695 · playbook gist https://gist.github.com/ruvnet/9b066e77dd2980bfdcc5adf3bc082281
- Letta: https://docs.letta.com/guides/core-concepts/memory/shared-memory · https://docs.letta.com/guides/core-concepts/memory/memory-blocks · https://docs.letta.com/guides/agents/architectures/sleeptime/
- Secondary (used only where flagged, local evidence preferred): https://www.mindstudio.ai/blog/claude-code-agent-teams-shared-task-list · https://paddo.dev/blog/agent-teams-the-switch-got-flipped/