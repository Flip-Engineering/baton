# Phase 92 — Episode/workstream agent-experience facade and resident closure

Phase 92 makes one objective-first Run the ordinary outer API. A caller supplies an objective and,
only when desired, an exact harness/model/effort tuple. Baton retains Plan, Attempt, task, fence,
receipt, cursor, byte, socket, credential, verification, and cleanup authority behind that facade.
The default worker policy remains unattended full access with containment reported honestly; this
phase does not add an ambient shared mutable checkout or homelab integration.

## 1. Public logical surface

Every transport projects the same semantic operations:

- `run.episode` reads an aggregate or role/generation Episode topic;
- `run.workstreams` lists or opens durable logical workstreams;
- `run.workstream.notify` addresses one current or exact generation;
- `run.workstream.stop` stops and reaps one current or exact generation;
- `run.stop` derives a safe reason when the caller omits one; and
- `application.help` resolves every advertised topic.

The direct client provides `run.episode()` and `run.workstreams()`. An Episode progressively
exposes `outline`, `output`, `sources`, `derivations`, `contradictions`, `trace`, `route`,
`verification`, `result`, `cleanup`, and `help`. A workstream provides `open`, `notify`, `result`,
`episode`, `stop`, and `help`. Topic reads accept item/content/evidence detail plus output/evidence
page cursors and change-aware cursor/wait continuation. A pending result is explicitly pending and
advertises continuation; it is never represented as a completed null value.

CLI, authenticated Web, MCP, and the browser operator use the same operation names, generation
selection, progressive detail, and continuation fields. The CLI has selector-free `episode`,
`result`, `workstreams`, `notify`, and `stop-member` verbs. The browser renders Episode chapters
and workstreams directly. Generic `run.inspect` remains a compatibility cascade, not the only way
to find the facade.

Episode outline entries are addressable chapter descriptors with topic, summary, and command,
not bare display strings. Every emitted help link must recursively resolve. Stable topics are
advertised instead of internal depth/section/item archaeology.

## 2. Projection and authority

Episode is a bounded read-only projection over existing Goal/Plan, Workflow, Attempt, Context,
Atlas, Cairn, verification, result, export, stop, and cleanup authority. It creates no competing
mutable truth. Summaries are replaceable and non-authoritative. Exact result capsules, source
coordinates, route tuples, lineage, verdicts, and cleanup receipts remain authoritative.

Aggregate Episode may expose the selected Workflow result. A role/generation Episode must use only
that Attempt's task, Candidate, artifact, requested/resolved/observed route, verification receipt,
terminal cause, stop receipt, and cleanup evidence. It cannot inherit aggregate selection or a
sibling's facts. Workstream generation comes from Workflow round/Attempt authority rather than an
unrelated Plan version. Predecessor generations remain addressable, while notify and stop recheck
exact current-generation authority before effects.

A declared read-only review or research objective may settle with a mechanically verified,
evidence-backed textual result capsule and no repository edit. Change objectives still require
their explicit required effects. No false verifier verdict can produce an accepted artifact or
result: pass-only and red-green-required policy are explicit, and `accepted:false` is terminal for
acceptance projection.

A failed verifier is not reduced to an opaque digest. Its verification Episode item and evidence
retain one closed, 8 KiB maximum sanitized tail capsule bound to the exact full-output byte count and
digest. Successful verification retains no output tail. Ordinary authenticated observe authority can
read the capsule without a new coordination write; secret-shaped content and runtime paths remain
outside every public or durable surface.

## 3. Temporal and structural evidence join

One Episode request computes one narrow context and at most one broad coordination snapshot. Its
immutable graph joins temporal Run/Plan/Attempt/Context evidence to Atlas AST/CPG representations
and Cairn claims. It retains these edge kinds:

- `produced` and `modified` from exact producer/action evidence;
- `derived_from` and `grounded_in` with source coordinates and evidence refs;
- `contradicted_by` directed from the contradicted claim to its contradiction;
- `verified_by` from result/artifact to exact verification authority;
- `covers` for exact representation/source coverage; and
- `releases` from the selected aggregate or member generation to its cleanup receipt.

Edges retain event sequence/time, source coordinate, evidence, route, lineage, and originating
authority where available. The projection does not relabel a source manifest as complete AST/CPG
lineage and does not drop Cairn temporal semantics.

## 4. Replay and resident liveness

Operational worker JSONL is indexed per worker. Each byte is parsed once; exact and range lookups
use the index, and a long-lived reader incrementally parses bytes appended by another Log instance
after checking file identity, size, and indexed-prefix stability. Evidence mapping and timeline
lookups do not reparse a complete worker log per row.

The coordination checkpoint is a parsed-event cache, never projection authority. Its prefix must
match the exact ledger bytes. Every cached event still crosses `_apply` and all current replay
validators, cards, CAS reads, receipt/poll reverifiers, and policy checks. The loaded ledger
identity advances after each append; checkpoint persistence refuses drift and cannot bless a
tampered prefix. Corrupt caches fall back to the ledger with truthful startup status. Corrupt
authoritative ledgers fail startup. Cache persistence is best-effort and cannot replace ownership,
error precedence, or exact writer-lease release.

Coordinator startup folds coordination once, uses indexed Run reads for approved-Run
reconciliation, and does not clone a full coordination snapshot per Run, worker, or Episode item.
Ordinary authenticated observations remain non-ledger-mutating and bounded in memory. Security and
liveness observations `readiness_probe`, `readiness_transition`, and
`command_status_authorized` remain durable and fail closed. Web status/progress/stop uses
independent request execution so a long verification projection cannot block stop or a second
bounded observation.

Resident authority is deployment-scoped and PID-start fenced. A stale different-deployment
selector may be replaced only after exact stale proof; a live authority is never replaced.
Ordinary `baton serve` and `CONFIG_MODULE` accept the same public deployment factory, eliminating
the temporary bootstrap. Startup progress and failure remain truthful before publication.

Fresh verifier sandboxes use collision-resistant paths and joined idempotent cleanup. Cleanup is
scoped to one exact common-Git registration, preserves live siblings, captures expected Git
diagnostics, and fails typed unless both the directory and administrative record are absent. The
ordinary authenticated local owner has the minimum additional `retry_verification` capability so a
currently advertised reason-only retry and its contextual help are usable without adoption,
review, integration, resume, or shutdown authority.

## 5. Route truth

Readiness lists ready and blocked configured routes with actionable, non-secret reasons. It
distinguishes native Kimi credential blocking, refresh-capable Grok authentication, Claude login
discovery, and truthfully unconfigured Kimi-through-Claude. Readiness never substitutes a route or
claims provider success.

The built-in GLM card exposes only model `glm-5.2` and every actually supported exact effort:
`low`, `medium`, `high`, `xhigh`, and `max`. The orchestrator chooses effort with the same
specificity as harness and model; `xhigh` remains the explicit dogfood choice and no blanket
`low` default is introduced.

Requested, resolved, and observed route identities are distinct. In particular, Codex app-server
leaves observed model null when the native provider omits it. Claude and Grok likewise derive
observed identity only from native output; Kimi reports only provider-confirmed selection.

## 6. Acceptance matrix

- P92-EW/EA: direct, CLI, authenticated Web, MCP, and browser round-trip one progressive semantic
  Episode/workstream surface, exact generation controls, help closure, and pending settlement.
- P92-LR/RP: one-load append-aware worker indexes, one coordination fold, narrow Run
  reconciliation, parsed-event checkpoint revalidation, corruption fallback, authoritative-ledger
  failure, drift refusal, and lease-release precedence.
- P92-WB/RA/RD: non-amplifying reads, responsive Web control, race-safe stale resident recovery,
  unified serve construction, and truthful blocked route discovery.
- P92-VF/OR: false-verdict rejection and honest no-write review completion.
- Cross-phase falsifiers retain CK8/CK9; RC2/RC3; EP3/EP5/EP6/EP7; PI3/PI10;
  AF2/AF3/AF6/AF7/AF10; PF5; DP3/DP5; SP7/SP9; CO2; and writer-lease release semantics.

## 7. Evidence boundary and Phase 93 handoff

Deterministic fixtures establish code-path behavior, replay validation, transport parity, bounded
projection, and simulated cleanup receipts. They are not live-provider evidence and do not prove
real provider/child PID liveness or reap. A separately observed stop reported `ownedWorkers:0`,
`reaped:true`, provider and child PIDs gone, and worktree removal; fixture suites do not recreate or
upgrade that observation.

Phase 93 remains next: closed canonical Program IR; event-driven recursive/parallel composition;
immutable base plus private overlays; one fenced integrator; and live multi-harness gates. Dynamic
arbitrary recursion, ambient shared mutable checkout writes, and agent-authored program execution
remain closed until those authorities are implemented and independently verified.
