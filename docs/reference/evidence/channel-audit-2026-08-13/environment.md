[attempt: e4fb268d-8a0e-41b9-99db-c60ba66b6dce row-env]

# ROW-ENV — member environment fidelity: what a member can actually reach

- **Row:** `row-env` (this worktree, worker `w-228`). Frame: `channel-audit-2026-08-13/foundry-brief.md`
  (shared laws) + `channel-audit-2026-08-13/row-env.md` (this row's brief).
- **Target:** the member-side environment as experienced in this campaign's waves — the gap between
  what briefs assume members can do and what the sandbox actually permits.
- **Verification HEAD:** this worktree's git HEAD is `e371f704727cbca5fdff86af31ec8b154620a71f`
  ("Baton private effective-tree snapshot"). All code anchors were re-read this session against the
  working tree at that HEAD (`grep -an`/`sed -n`/`Read`; NUL discipline on `application.mjs` and
  `coordination-store.mjs` — no whole-file read of either). All store claims cite the resident's
  coordination event log at `.git/baton/application-v3/state/coordination/events.jsonl` (the store
  path itself is a finding — see §2).
- **Frame laws honored:** no clocks; no new numeric limits; cited evidence only; read-only outside
  this deliverable (the one exception: the simulated env-filter in §1 is a pure in-memory
  computation, no writes).

---

## 0. The resident coordination store — found and cited

The foundry brief's anchor list names the store as "UNDOCUMENTED" and row-chan's job. I resolved it
while tracing the member env, because the member's scratchpad surface binds to it:

- `openBatonDeployment` (`application-deployment.mjs:1796-1801`): `deploymentRoot =
  privateDirectory(advanced.deploymentRoot ?? join(repository.common, 'baton', 'application-v3'))`;
  `stateRoot = deploymentRoot/state`; `runtimeRoot = deploymentRoot/runtime`.
- `repository.common` = `git rev-parse --git-common-dir` = this repo's `.git`
  (`application-deployment.mjs:185-187`).
- `createDriver` receives `logDir: stateRoot` (`application-deployment.mjs:1948`); the coordination
  store is `new CoordinationStore(join(opts.logDir, 'coordination'), …)` (`index.mjs:1253`).
- **Therefore:** the resident's coordination store is
  **`.git/baton/application-v3/state/coordination/`** (live: `events.jsonl`, 35.5 MB at read time,
  `projection.checkpoint`, `writer.lease`). The per-member runtime homes live at
  `.git/baton/application-v3/runtime/<workerId>/` (`runtimeRoot`, e.g. `w-224`…`w-229`).

This matters for every verdict below: the member's scratchpad surface and its private runtime HOME
are both **resident-side live artifacts**, physically outside every git worktree snapshot.

---

## 1. `gh` unauthenticated in worktrees — PROVEN

The claim (`redteam-155.md:6` publish note: "`gh` is unauthenticated in this worktree") reproduces
exactly, and the code shows all three proposed causes are real.

**Reproduction (this session).** In this worktree (a member worktree, spawned the same way as
redteam-155's):

```
gh auth status   → "You are not logged into any GitHub hosts. To log in, run: gh auth login"
gh issue view 155 → "To get started with GitHub CLI, please run:  gh auth login
                     Alternatively, populate the GH_TOKEN environment variable …"  (exit 0)
```

The repo's remote is `https://github.com/user/baton.git`, so the failure is **auth**, not repo
identity. `gh auth status` reports the same "not logged in" state the host operator's shell has —
but even a host-side `gh` auth (hosts.yml) would be unreachable to a member, because:

**Why (member-spawn env construction).** The member process is a provider CLI spawned with the
runtime-isolated environment built by `RuntimeIsolation.create` (`runtime-isolation.mjs:59-173`):

1. **Env scrubbed** — `runtime-isolation.mjs:68-73` copies the base env but drops every key matching
   `SECRET_NAME` (`/(TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION)/i`,
   `:8`) or `PROVIDER_OR_INJECTION`
   (`/^(ANTHROPIC_|OPENAI_|…|GITHUB_|…|GIT_CONFIG|GIT_DIR$|GIT_WORK_TREE$|DYLD_|LD_|.*_PROXY$)/i`,
   `:9`) unless the key is in `ALWAYS_KEEP` (`:10`: `PATH, SHELL, LANG, LC_ALL, LC_CTYPE, TERM, USER,
   LOGNAME, TZ`). So `GH_TOKEN` (matches `TOKEN`), `GITHUB_TOKEN` (matches `GITHUB_` **and** `TOKEN`),
   `SSH_AUTH_SOCK` (matches `AUTH`), `GIT_CONFIG_GLOBAL`/`GIT_DIR`/`GIT_WORK_TREE` (matches
   `GIT_CONFIG`/`GIT_DIR$`/`GIT_WORK_TREE$`), and every `*_PROXY` are dropped. A deterministic
   simulation of this filter over a representative base env (run this session, in-memory) leaves only
   `HOME, PATH, SHELL, USER, LANG, TERM, LC_ALL` — **no `GH_TOKEN`, no `GITHUB_TOKEN`, no
   `SSH_AUTH_SOCK`**.
2. **HOME rewritten** — `runtime-isolation.mjs:74` `env.HOME = home` where `home =
   privateDir(join(root, 'home'))` (`:62`). gh's credential file lives at
   `$XDG_CONFIG_HOME/gh/hosts.yml` or `$HOME/.config/gh/hosts.yml` — neither exists under the
   private home. Observed on disk: `.git/baton/application-v3/runtime/w-228/home/` contains only
   `Library/Caches/claude-cli-nodejs`; **no `.config/gh`, no `.gitconfig`**.
3. **Config homes deleted/replaced** — `runtime-isolation.mjs:76-83` deletes `CLAUDE_CONFIG_DIR`,
   `CODEX_HOME`, `GROK_HOME`, `KIMI_CODE_HOME` and sets only the provider surface's config dir
   (`:80-83`; here `config/deepseek/`). Provider credentials are projected in
   (`:104-140`, `projectCredentialTree`); **gh credentials are not a provider** and are never
   projected.

The env reaches the child through the coordinator's spawn seam: `_ensureRuntimeScope`
(`coordinator.mjs:8933-8946`) calls `this._runtimeScopes.create(handle.id, {card})` =
`RuntimeIsolation.create`; the coordinator then passes `env: runtime?.env, replaceEnv:
runtime?.replaceEnv === true` to the adapter (`coordinator.mjs:3765-3768`; same at `:5713-5714`,
`:6127-6128`), and the session adapter spawns the child with exactly that env
(`claude-session.mjs:764` `spawn(cmd, argv, { cwd, env: route.env, detached: true, … })`).

**Impact (the briefs' silent degradation).** Every foundry brief this campaign that instructed a
member to "read the issue" (`gh issue view 146/155/156/157/158/159/160/161/163/164/165/167/170/74/12`
— grep count across the six foundry packs: 20+ occurrences) silently degrades to "read the local
evidence only". Every row's access note says so: `redteam-155.md:6`; `contract-146.md:17` (`gh issue
view 146` could not be fetched); `contract-167.md:20`; `review-qa.md` §0. No member this campaign
succeeded at `gh issue view` (no cited instance exists in any report).

**Fix class.** (a) briefs inline the issue content (the contracts/evidence dirs already carry most of
it) so a disconnected worktree is sufficient; and/or (b) give members read-scoped gh by projecting a
read-only `GH_TOKEN` through the credential projection (`runtime-isolation.mjs:104-140`), which the
env filter currently forbids (it scrubs any `TOKEN`); and/or (c) at minimum, change the frame's
"read the issue" instruction to "read the issue **or the local contract/evidence**" so a member is
not set up to fail.

---

## 2. The `shared` scratchpad: writes land worker-scoped; reads are live-resident-only — PROVEN (both claims, reconciled)

The two on-record claims are **both true and not contradictory**; they describe two different ports
and two different seat states.

**What a member's scratchpad surface binds to.** The resident's coordination store, via the
coordinator's authenticated per-worker stream — **not** a worktree-local store. A member's write is
`SCRATCHPAD_WRITE: {…}` printed as model text → `scanForScratchpadWrite` (`claude-session.mjs:103`,
grammar `:29`) → emitted `scratchpad.write` (`claude-session.mjs:1146`) → coordinator
`writeScratchpad` (`coordinator.mjs:11103-11153`) → store `writeScratchpad`
(`coordination-store.mjs:14064`), which writes to the **worker-scoped** partition:
`const scope = \`worker:${fields.workerId}\`` (`coordination-store.mjs:14103`). The `shared`
partition is written **only** by the orchestrator's settlement lane (`settleWorkflowScratchpad`
writes `scope='shared'`, `coordination-store.mjs:14333`; elevation is orchestrator-only —
`auth?.actor !== 'orchestrator'` refuses, `:14173`).

**Store evidence (all 12 worker writes are worker-scoped; none hit `shared` directly):**

| seq | ts | worker | scope | note |
|---|---|---|---|---|
| 47850/47859/47864/47877/47888/47907/47912/47917 | 04:53-04:54 | w-196/w-198 | `worker:w-196` / `worker:w-198` | surface-audit wave |
| 50790 | 08:49 | w-205 | `worker:w-205` | "#155 redteam — NOT FOLD-READY" (redteam-155's publish) |
| 52296 | 09:36 | w-208 | `worker:w-208` | "#164 RED-TEAM" |
| 53762 | 10:14 | w-210 | `worker:w-210` | "#157 suite-draft" |
| 58092 | 12:02 | w-225 | `worker:w-225` | row-chan — channel-audit publish |
| 59240 | 12:12 | w-227 | `worker:w-227` | row-know — channel-audit publish |

**"Landed in `worker:<row>`" — CONFIRMED** (`redteam-155.md:7`): seq 50790 is `scope
worker:w-205`, exactly as documented.

**"Elevates at settlement" — CONFIRMED** as the interpreter's `elevateWhenNotes` steering
(`workflow-interpreter.mjs:877-908` `tryElevate` reads `worker:<workerId>` via
`run.scratchpad.read` and elevates via `run.scratchpad.elevate`), gated on the task being terminal.
The surface-audit wave's four notes were elevated by the orchestrator at 04:59:58
(`scratchpad.entry_elevated`, seq 48063-48066, scope `shared`), preceded by the worker partition
reap (seq 48067). The channel-audit wave's notes (w-225/w-227) are not yet elevated (wave still
live at read time) — consistent with elevation happening at settlement.

**"`shared` not reachable from this snapshot" — CONFIRMED, as a snapshot-seat read gap.**
`review-qa.md` §0 and `contract-foundry-2026-08-13/foundry-qa.md` §0 both say the `shared` partition
is unreachable "from this snapshot (no `.baton/` store, no live scratchpad file)". Verified exact:
a member worktree root has **no `.baton/` directory** (this worktree: `ls .baton` → "No such file
or directory"), and the store physically lives at `.git/baton/application-v3/state/coordination/`
— inside the git common dir, outside the worktree. So a seat working from a worktree snapshot
(post-session revision, harvest, QA) has **no read path** to `shared`.

**Reconciliation — the bug's shape.** The two claims are different ports + different seat states:
- redteam-155's claim is the **write** port from a **live** session → works, lands worker-scoped,
  elevates at settlement.
- review-qa's claim is the **read** port from a **snapshot** seat → no store attached → unreachable.

The underlying gap has two halves:
1. **A member can never write `shared` directly.** The frame's "publish to the `shared` partition"
   instruction is served by a write that lands `worker:<row>` and depends on an orchestrator
   elevation it cannot trigger. The on-record client verb the frame implies (`run.scratchpad.append`,
   #158) is unlanded at HEAD (grep across `impl/` finds no `run.scratchpad.append`/`run_scratchpad_append`;
   `contract-163.md:366-371`, `contract-165.md:299-301`, `contract-146.md:40-48`, `contract-167.md:23-30`
   all confirm independently). Note entries also carry no `title` field — the `note` shape is
   `{kind, text}` only (`coordination-store.mjs:607-620`), so the frame's "title = your row role"
   is served by leading the text, exactly as "#155 redteam …" leads seq 50790.
2. **A snapshot seat has no read port.** The `run.scratchpad.read` CLI/MCP verb exists
   (`application-cli.mjs:1476-1511`; `mcp-northbound.mjs:652-668`) but needs a live resident
   connection, and a member cannot establish one: `discoverBatonConnection`
   (`application-cli.mjs:215-300`) reads the user connection profile from
   `$HOME/.config/baton/connections/<profile>.json` (`:284-291`) — the operator's profile is at
   `$HOME/.config/baton/connections/resident-4421cf292504-672ef8abad50.json` (verified on
   disk) — but the member's HOME is the rewritten private home (§1), so the profile (and its token
   file) is absent → `cli_config_invalid`. Additionally the spawn brief forbids launching a Baton
   CLI/MCP server at all (`cli-adapters.mjs:94-96`).

**The live member read port that exists but was never instructed.** A live member CAN read `shared`
via the `CONTEXT_READ` up-channel: `CONTEXT_READ: {"expectedFence":"current","idempotencyKey":…,
"query":{"kind":"scratchpad"}}` → `scanForContextRead` (`claude-session.mjs:126`, grammar `:31`) →
`coordinator.contextRead` (`coordinator.mjs:11191`) → `scratchpadSnapshot(runId, 'shared')`
(`coordinator.mjs:11327-11332`) → delivered back as `[CONTEXT_READ_RESULT …]`
(`coordinator.mjs:13032`, `11711-11719`). **No foundry brief in this campaign ever instructed
`CONTEXT_READ`** (grep across all six foundry packs: zero hits) — the read port is the AX gap.

---

## 3. File-scope enforcement — GAPPED (enforcement exists but is post-hoc, event-stream-dependent, and has a recorded false-positive)

**Declared scopes are real and validated at admission.** Each channel-audit member's
`workflow.json` declares `scope: ["docs/reference/evidence/channel-audit-2026-08-13/**"]` (this
row's deliverable is inside that scope). The interpreter validates scope shape at admission —
`workflow-interpreter.mjs:185-213` (non-empty bounded array, unique, no NUL/absolute/backslash/`..`
segment, bare-directory correction via `wave.mjs:60-95`). Declared scopes live in the **workflow
specs**, not in the worktree meta: all five current `.baton/wt/*.meta.json` carry only
`sparsePaths: []` + `sparseCheckoutIdentity.mode: "full"`, **no `scope` field**
(`ws-c73d21ac…/…meta.json:9-15`).

**Enforcement exists — but it is not a filesystem refusal.** `path-scope.mjs` is a pure matcher
(regex compile/test, `path-scope.mjs:5-42`; rejects absolute/backslash/`..`/NUL, `*` within
segment / `**` across). Its callers, verified this session:
1. **Live watchdog** — fires on every `content.file_edit` (`coordinator.mjs:9660-9688`): relativizes
   the path via `_relativeActionPath` (`:9620-9626`); if `pathInScope(task.brief.pathScope, path)` is
   false it mints `health.scope_violation` (`:9674,:9683`) and applies the watchdog action —
   **default `kill`** (`:1062`; actions `:9140-9147`). Post-hoc kill/orient, not refusal.
2. **Completion trust gate** — at run completion (`coordinator.mjs:13515-13530`) splits captured
   changed paths into in/out-of-scope; any out-of-scope → `worker_path_scope_violation` with
   `pathScopeEvidence`; `_gateVerdictItemForWorker` maps it to `gate:'scope'` (`:3933`).
3. **Story signals** — `out_of_scope` rendered as "OUT OF SCOPE: <path>" (`story.mjs:471-480,564-566,
   674-675`); cross-worker `path_scope_collision` (`story.mjs:589-619`).
4. **Read-side projection** — repository Context CAS excludes out-of-scope entries
   (`context-runtime.mjs:412-415`) and refuses a retained commit result that escapes
   `request.pathScope` (`:605-608`).
5. **Store admission** — context-source attestation items must satisfy `pathInScopes(item.path,
   node.contextScope ?? node.pathScope)` else `fail(...)` (`coordination-store.mjs:5251-5252`).
6. **Sparse-checkout write-time block** — `assertSparseIndexState`/`assertChangedPathsCovered`
   throw `worker_sparse_scope_violation` (`worktree.mjs:949-968`) — but current waves have
   `sparsePaths: []` (full checkout), so this is **inactive** for them.

**Three reasons the "verified" story is weaker than it looks.**
- **The member's own sandbox is disabled.** `runtime-isolation.mjs:92-101` writes settings.json with
  `sandbox.enabled: false, allowUnsandboxedCommands: true` — verified on disk at
  `.git/baton/application-v3/runtime/w-228/config/deepseek/settings.json`. The member's native
  Write/Edit tools are ungated at the filesystem; the live check depends on file edits surfacing as
  `content.file_edit` events and the watchdog/trust-gate reacting **after** the write.
- **The watchdog has a recorded false-positive kill.** phase29 dogfood run 2026-07-12
  (`phase29-aci-contract-closure-grok-review-2026-07-12`): worker `w-2` edited exactly its declared
  deliverable `reviews/dogfood/grok-capability-implementation-composer.md` (pathScope
  `["reviews/dogfood/grok-capability-implementation-composer.md"]`), but the handle's `worktree` was
  unset at observation time so `_relativeActionPath` returned the **absolute** path and the watchdog
  killed the worker (`events.jsonl:557`, `action:"kill"`; result `status:"cancelled"`,
  `summary.json:295-333`). **This is the single recorded instance of scope enforcement blocking a
  legitimate in-scope write** — a false positive, caused by relativization failing when the handle
  is mid-teardown, not by an actual scope escape.
- **Admission does not bind `report`/harvest paths to scope.** The interpreter validates `report`
  only as a non-empty string (`workflow-interpreter.mjs:209-214`) and harvest paths only as
  repo-contained (`:320-327`); neither is checked to lie **inside** the declared `scope`, so a
  misdeclared report outside scope is caught only post-hoc (trust gate/watchdog), never at
  admission.

**Store: no scope-violation events this campaign.** Scans of the resident `events.jsonl` and the
taskwave coordination logs for `health.scope_violation`/`worker_path_scope_violation`/`out_of_scope`
found **none** for the 2026-08 campaign (`scope`-kind hits are all `context.cell_settled`,
`run.control_settled`, `turn.settled`, `plan.node_budget_settled` — unrelated). So: this campaign's
members wrote only inside their declared scopes **by instruction** (every brief says "Work only
within: …"), and no watchdog fired — consistent with in-scope writing, not with a detection failure.
The only two `health.scope_violation` records in the whole evidence base are the 2026-07-12 dogfood
runs: phase29 (false-positive kill, above) and phase34 (`scope-orientation-local-2026-07-12`, a
deliberate out-of-scope mock edit that was **oriented**, not killed — `run.mjs:33-48`,
`summary.json:6-34`).

**Did scope ever block a legitimate write? — Yes, once, and it is the false positive above.**
redteam-155's "need to publish outside its dir" is **not** a path-scope case: it is the scratchpad
`shared` partition (a store partition, never a filesystem dir), and it was blocked not by path-scope
but by the absent `run.scratchpad.append` verb (#158) — the §2 gap; its durable report file was
written inside its declared scope (`review-foundry-2026-08-13/workflow.json:15-17`). The honest
reading: scope enforcement is **post-hoc, event-stream-dependent, and sandbox-independent**; it can
kill a worker for a legitimate in-scope write (phase29), it cannot refuse a write before it happens,
and the store has no scope-violation vocabulary of its own (`health.scope_violation` is minted by
the coordinator, not a `coordination-store.mjs` event kind).

---

## 4. Tool inventory inside a member — the AX gap is the unused majority

**The full member-callable surface** (from the worker facade; all six are printed-model-text
grammars scanned only from assistant text, `claude-session.mjs:27-37`, scanners at `:77/:103/:126/
:152/:178/:206`):

| # | Grammar | Scanner | Coordinator handler | Store/side effect |
|---|---|---|---|---|
| 1 | `DECISION_REQUEST:` | `claude-session.mjs:77` | `decision.requested` → `coordinator.mjs:13311` | pending interaction, orchestrator answers |
| 2 | `SCRATCHPAD_WRITE:` | `claude-session.mjs:103` | `writeScratchpad` `coordinator.mjs:11103` | `worker:<id>` partition (`coordination-store.mjs:14103`) |
| 3 | `CONTEXT_READ:` | `claude-session.mjs:126` | `contextRead` `coordinator.mjs:11191` | code/knowledge/finding/board/**scratchpad(shared)**/spill |
| 4 | `MESSAGE_SEND:` | `claude-session.mjs:152` | `message.send` `coordinator.mjs:13069` | reply lane, caller-named target refused |
| 5 | `BOARD_CLAIM:` | `claude-session.mjs:178` | `board.claim` `coordinator.mjs:13047` | board claim |
| 6 | `BOARD_REPORT:` | `claude-session.mjs:206` | `board.report` `coordinator.mjs:13059` | board report |

Plus the member's native agent tools (Bash/Read/Write/Edit/Grep/WebFetch…) — but the spawn brief's
dispatch guidance limits members to "only tools explicitly advertised in the Brief"
(`cli-adapters.mjs:94-96`), and the member is told **not** to launch a Baton CLI/MCP server
(`cli-adapters.mjs:95`).

**What the foundry briefs actually instructed members to use** (grep across the six foundry packs:
contract/review-a/review-b/suite/fold/channel-audit):

| Instructed surface | Count | Member-reachable? |
|---|---|---|
| `gh issue view <n>` (read the issue) | 20+ | ✗ unauthenticated (§1) |
| `waves.run` (nested composition, #74) | 42 | orchestrator-side verb; row-suborch's brief traces the member block |
| `run.scratchpad.append` (write to `shared`) | 11 | ✗ unlanded verb (#158); real path = `SCRATCHPAD_WRITE` → worker-scoped |
| `DECISION_REQUEST` (escalate) | 21 | ✓ live up-channel — **but UNEXERCISED this campaign** (see below) |
| `run.scratchpad.read` / `run.scratchpad.elevate` | 11 | ✗ need resident connection; member env cannot connect (§2) |
| `signalOnMembersDone` / `messageOnSpawn` / `nudge` | 21 | orchestrator-side steering (not member-callable) |
| `CONTEXT_READ` | 0 | exists (§2) — **never instructed** |

**The unused majority is the AX gap.** Of the six member-callable up-channel surfaces, the foundry
briefs instructed **one** implicitly (`SCRATCHPAD_WRITE` as "publish to shared"), one
(`DECISION_REQUEST`) repeatedly but with **zero** exercised instances by any member, ever: all **6**
`decision.requested` events in store history have actor `policy` (last pair seq 38360-38361,
2026-07-23), **zero** have actor `worker`. The foundry-wave escalations happened **via durable
files** (`review-qa.md` §5 —
"the top orchestrator reads these from the harvest artifact"; its own "the `shared` publish is
unreachable from this snapshot" is the §2 read-gap). `CONTEXT_READ` (the only member read port for
`shared`), `MESSAGE_SEND`, `BOARD_CLAIM`, and `BOARD_REPORT` were never instructed anywhere in the
foundry packs. The composition layer therefore exercises ~2 of the 6 member surfaces, and the two it
does exercise (`SCRATCHPAD_WRITE`, `DECISION_REQUEST`) both degrade in the foundry context —
worker-scoped-write + orchestrator-gated elevation, and file-based escalation for snapshot seats.
Store history confirms the never-used status quantitatively: all **702** `message.sent` events have
actor `orchestrator`, **zero** from a worker (so the `MESSAGE_SEND` up-channel has never been
exercised by any member, ever); and the only member-actor scratchpad write in the current wave's
window is this row's own `worker:w-228` publish (seq 59841).

---

## 5. Verdicts (per the shared frame's scale)

| Channel / surface | Verdict | Evidence |
|---|---|---|
| `gh` auth inside member worktrees | **GAPPED** | runtime-isolation.mjs:8-10,68-83; spawn seam coordinator.mjs:3765-3768; live repro (`gh auth status`, `gh issue view 155`); w-228 home has no gh config |
| Member write to `shared` (as briefs phrase it) | **GAPPED** | all 12 store writes are `worker:*`; elevation orchestrator-only (coordination-store.mjs:14103,14173,14333); `run.scratchpad.append` unlanded (#158) |
| Worker publish to the up-channel (positive control) | **PROVEN** | this row's `SCRATCHPAD_WRITE` → store `scratchpad.entry_written` seq 59841, scope `worker:w-228`, no refusal event (§7) — confirms the write path end-to-end, and that it lands worker-scoped |
| Elevation of worker notes at settlement | **PROVEN** | 4 `scratchpad.entry_elevated`→`shared` (seq 48063-48066); `elevateWhenNotes` (workflow-interpreter.mjs:877-908) |
| Snapshot-seat read of `shared` | **GAPPED** | worktree has no `.baton/`; store at `.git/baton/application-v3/state/coordination/`; `discoverBatonConnection` needs `$HOME/.config/baton/connections` (application-cli.mjs:284-291) |
| Live-member read of `shared` (`CONTEXT_READ`) | **UNEXERCISED** | port exists (coordinator.mjs:11327-11332) but no foundry brief instructs it |
| File-scope enforcement | **GAPPED** | enforcement exists (watchdog kill + trust gate + sparse block, coordinator.mjs:9660-9688/13515-13530, worktree.mjs:949-968) but post-hoc & event-dependent; sandbox disabled (runtime-isolation.mjs:92-101); recorded false-positive kill (phase29 2026-07-12); zero violations this campaign |
| `DECISION_REQUEST` up-channel | **UNEXERCISED** | all **6** `decision.requested` events in store history are actor `policy`, zero actor `worker` (last seq 38360-38361, 2026-07-23); foundry escalations via durable files (review-qa.md §5) |
| `MESSAGE_SEND` (member→orchestrator) | **UNEXERCISED** | grammar exists (claude-session.mjs:152); **all 702 `message.sent` events in store history are actor `orchestrator`, zero actor `worker`** — the up-channel lane has never once been used by a member |
| `BOARD_CLAIM` / `BOARD_REPORT` | **UNEXERCISED** | grammars exist (claude-session.mjs:178/206); no foundry brief instructs them; **zero `board.*` events across all store history** |

---

## 6. Prioritized fix list (mapped to existing issues where they exist)

1. **Read-scoped gh for members** (fixes §1): project a read-only `GH_TOKEN` through the credential
   projection, or make the credential projection gh-aware, so briefs' "read the issue" works. Until
   then, briefs should inline the issue content. (Related: the frame's repeated `gh issue view`
   instructions set members up to fail — amend the frame.)
2. **Land the `run.scratchpad.append` client verb (#158)** or re-word the frame's "publish to the
   `shared` partition" to say "publish a `SCRATCHPAD_WRITE` note (lands `worker:<row>`, elevates at
   settlement)" — the current phrasing asserts a capability that does not exist (§2).
3. **Advertise `CONTEXT_READ` as the member read port for `shared`** (§2, §4): the port exists and
   is the only live read path; the composition layer never tells members it exists. Alternatively,
   give snapshot seats a store-attached read (a CLI read that does not require the rewritten-HOME
   profile — see `discoverBatonConnection`).
4. **Close the `shared`-read gap for snapshot seats** (review-qa's actual failure): either attach
   the store to the worktree meta (`.baton/wt/*.meta.json` currently has no store coordinate), or
   accept durable-files-as-the-channel and stop instructing "publish to `shared`" for post-session
   work.
5. **Make scope enforcement refuse-then-record, and fix the false-positive** (§3): (a) fix
   `_relativeActionPath` (`coordinator.mjs:9620-9626`) to never return an absolute path for an
   in-worktree file — phase29 shows a legit in-scope write was killed when the handle's `worktree`
   was unset at observation time; (b) move enforcement to the write path where feasible (the
   runtime currently disables the member sandbox, `runtime-isolation.mjs:92-101`, so the live check
   depends on `content.file_edit` events and is post-hoc kill); (c) make admission bind `report` and
   harvest paths to lie inside the declared `scope` (`workflow-interpreter.mjs:209-214,320-327`
   check only non-empty / repo-contained); (d) define a store-native scope-violation event kind —
   `health.scope_violation` is minted by the coordinator, not store vocabulary, so the store cannot
   be the source of truth for compliance. Note the two on-record dogfood records (phase29
   false-positive kill, phase34 orient-not-kill) are the entire compliance evidence base.
6. **Name the escalation-lane drift** (§4): foundry waves escalated via files, not `DECISION_REQUEST`
   — the up-channel is live-only. If the top orchestrator wants real escalations, snapshot seats
   need a working up-channel read/write, not just live members.

---

## 7. Shared-scratchpad publication note — VERIFIED LANDED (store seq 59841)

- The full mechanism (§2) is served by the authenticated in-run worker up-channel: `SCRATCHPAD_WRITE`
  → `worker:<row-env>` → elevates to `shared` at settlement. A `note` entry titled `row-env`
  (subject leads the text — the `note` kind has no title field, `coordination-store.mjs:607-620`)
  was emitted via the up-channel under idempotency key `row-env.report.final` at
  `expectedFence:"current"` (note body capped at 8192 bytes, `limits.mjs:71`).
- **Post-emission store verification (positive control):** the resident store records
  `scratchpad.entry_written`, `seq 59841`, `ts 2026-08-13T12:19:51.663Z`, `actor worker`,
  `idempotencyKey "row-env.report.final"`, `scope "worker:w-228"`, `ordinal 1`,
  `entryId "scratchpad-entry:be960af3235ebd422c6f91c6057809fc50fd5a56e83c4027e8539b39634d3502"`,
  `entryDigest "bb0818269c59f0b45bf7ccc72d614057b019a2e141559cff5c34908064a6b8f1"`,
  `contentDigest "4fd220df0966268a16154dbd6d5d3de291f865d6dd8952c17561415e281e72c1"`. **No
  refusal/admission-rejection event exists** for this write (grep for `refus|reject|invalid|coach`
  adjacent to `w-228` returns only the word "refusal" inside the brief/message text, not an event).
  This is the §2 prediction confirmed live: a member's "publish to shared" lands **worker-scoped**,
  exactly as the code path `coordination-store.mjs:14103` mandates.
- **This file remains the durable harvest artifact** (`docs/reference/evidence/channel-audit-2026-08-13/environment.md`),
  inside the declared scope. The publish did not fail, so there is no refusal to record; the file is
  still the record per the coordinator brief's fallback, and the coordinator should read it to
  cross-check the note (the note is a condensation; the file carries the full citation record).

## 8. Citation record

All `file:line` anchors re-read this session at HEAD `e371f70` via `grep -an`/`sed -n`/`Read`.
No NUL-bearing file is cited (NUL discipline on `application.mjs` and `coordination-store.mjs`).
Store claims cite `events.jsonl` seq/ts as recorded above. The env-filter simulation in §1 was a
pure in-memory node computation of the literal regexes at `runtime-isolation.mjs:8-10`.
§3 additionally draws on the scope-enforcement sub-audit, whose on-record evidence: phase29
dogfood `events.jsonl:557` + `summary.json:295-333,450-451`; phase34 `run.mjs:33-48` +
`summary.json:6-34`; current worktree meta `ws-c73d21ac…/…meta.json:9-15` (no scope field,
`sparsePaths: []`).
§7 cites the live store: this row's publish = `scratchpad.entry_written` seq 59841 (ts
2026-08-13T12:19:51.663Z, scope `worker:w-228`, entryId `scratchpad-entry:be960af3…`). §4/§5 cite
store-history actor distributions: `message.sent` 702 × `orchestrator`, 0 × `worker`;
`decision.requested` 6 × `policy`, 0 × `worker`; `board.*` 0 across all history.
