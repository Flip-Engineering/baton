# Red-team: docs/35-unified-control-grammar.md — seat kimi (R-KM)

**Target:** `docs/35-unified-control-grammar.md` v1 draft (pre-red-team), attacked adversarially
against the executable contracts in `impl/` at this commit. Findings are numbered R-KM-N,
hardest first. Severity: **P0** blocks implementation, **P1** must fold before M1, **P2**
improvement. Read-only audit; no impl files were touched. Verification:
`node --test impl/test/surface-audit-smoke.test.mjs` (exit 0).

Grounding convention: `application.mjs` line numbers are from `grep -n` on the raw file (it
contains one NUL byte around offset 22412; line numbering is unaffected).

---

## Findings

### R-KM-1 — §6 canonical table silently drops `application.shutdown` (P1)

**Attacks:** §6 "Forty-one operations replace 284 names" (completeness claim).
**Grounding:** `impl/src/application.mjs:152` — `'application.shutdown'` is a first-class
`APPLICATION_COMMAND_DEFINITIONS` entry (`capabilities: ['emergency_stop']`, `web: false,
mcp: false`), dispatched at `impl/src/application.mjs:10797`. It is the only D3 command with
no §6 destination: the table's deployment rows are `deployment.view` and `deployment.serve`;
kernel tools are explicitly scoped out, but shutdown is an *application* command, not a
`fleet_*` kernel tool.
**Failure:** the 41-op set is not closed over D3. An implementer cutting the registry-v2
merge (M1) from §6 either loses the host-only shutdown path or re-adds it ad hoc — the first
concrete violation of L1/H2, in the first phase.
**Minimal fix:** add `deployment.shutdown` to §6 (host-only, `emergency_stop`, no web/MCP
projection — mirroring how `deployment.serve` is annotated "host-only, unchanged"), or add a
one-line explicit exclusion next to the kernel-tools paragraph.

### R-KM-2 — `run.watch` cannot express `run.wait`'s settle-blocking read (P1)

**Attacks:** §6 `run.watch` row ("`run.follow`, `run.wait`, … channel:
`progress|events|output|changes`") and §4.1's "watch = the only streaming read".
**Grounding:** `impl/src/application.mjs:7060-7075` — `run.wait` polls `status()` until
`view.phase ∈ PROVIDER_EXECUTION_SETTLED_PHASES` (`impl/src/application.mjs:118-121`,
includes `work_completed`, `selection_required`, `candidate_selected`, all terminals) with a
timeout up to 24 h. It is a *condition wait*, not a channel tail. `run.follow`
(`impl/src/application.mjs:7239-7262`) is a cursor-based event tail gated by deployment
`followPolicy` (`mode`, `maxWaitMs`) and cancellable (`application_follow_cancelled`).
`run.episode` and `run.workstreams` also carry blocking `cursor`+`waitMs` reads with
`waitMs ⇒ cursor required` validation (`impl/src/application.mjs:1241-1244`).
**Failure:** none of the four advertised channels is "block until settled/terminal". The
primary agent polling pattern — start, then wait for `work_completed` — has no grammar home;
agents fall back to poll loops, re-creating F6 cost-per-question. Folding also drops the
`followPolicy` gate and the 24 h vs `maxWaitMs` timeout distinction unless restated.
**Minimal fix:** give `run.watch` a wait condition alongside channels — e.g.
`run.watch RUN_ID --until settled|terminal [--timeout D]` — state that event channels inherit
`followPolicy` gating and per-channel cursors, and state that section-scoped blocking reads
(`episode`, `workstreams`) keep `cursor`/`waitMs` under `run.view`.

### R-KM-3 — episode fold loses role×generation addressing and the validation matrix (P1)

**Attacks:** §4.1 note ‡ and §6 `run.view` / `run.member.view` rows.
**Grounding:** the episode projection is role- and generation-addressed:
`_episodeItem(current, view, topic, role, context, generation)`. `impl/test/phase92-episode-attribution-red.test.mjs`
pins, as executable contracts: P92-EA2 (a role can never claim a sibling's artifacts, result,
route, verification, or cleanup — attribution isolation), P92-EA3 (contradiction edge
direction + temporal/evidence coordinates survive projection), P92-EA4 (predecessor
generations exactly addressable; *generation is the durable workflow round, never an inferred
Plan version*), P92-EA5 (a failed-verifier capsule survives verbatim at evidence depth).
`impl/test/phase92-episode-workstream-red.test.mjs:135-146` pins the CLI spellings
(`--workstream ROLE --generation N`, `--evidence`, `pageCursor`). Episode's admission matrix
is cross-argument: `pageCursor` only for `topic=output ∧ detail=content`, `content` detail
only for `output|help`, `generation ⇒ role`, `waitMs ⇒ cursor`
(`impl/src/application.mjs:1226-1247`).
**Failure:** §6 splits episode between `run.view --section episode.CHAPTER` (chapters) and
`run.member.view` ("episode-by-workstream reads") without defining (a) the item-addressing
convention that carries role×generation into a section read, (b) where the cross-argument
validation matrix lives when the entry point is a generic `view`, (c) which of view/watch
carries episode's blocking `cursor+waitMs` form (see R-KM-2). As written, an implementer can
fold the taxonomy and quietly drop generation-exact attribution — precisely the evidence
guarantee §11 says to attack hardest. The fold also contradicts H7 (depth ≤
noun.subnoun.verb) if the escape hatch is deeper section paths like `episode.output`.
**Minimal fix:** pin the addressing explicitly: `run.view --section episode.CHAPTER` for
run-scope chapters; per-member chapters as `run.member.view RUN ROLE [--generation N]
--section CHAPTER`, with "generation defaults to the current workflow round, never a Plan
version" (P92-EA4 wording); port the four validation rules verbatim into the `run.view`
schema note; state that `--section` values are registry-owned and do not count against H7's
name depth.

### R-KM-4 — the attention unification is false for checkpoints (P1)

**Attacks:** §3 "One verb answers all of them (`run.answer`); the checkpoint's
`continue|settle` is just its option set" and §7.3's response union
`{text} | {option} | allow | deny | cancel`.
**Grounding:** the live checkpoint attention kind is `turn_checkpoint`
(`impl/src/application.mjs:6822`; `impl/src/wave.mjs:90`), and its only entry points are
three advertised actions — `nudge_turn` (admit a fresh provider turn, optional message),
`wait_turn` (record a non-consuming receipt, changes nothing), `claim_turn` (re-run the live
trust gate, resolving the paused task to completed/failed) — advertised together at
`impl/src/application.mjs:8785-8798`, with schemas at
`impl/src/application-semantics.mjs:355-380`.
**Failure:** three acts, two options. `wait_turn` has no `continue|settle` counterpart, and
`claim_turn` executes a *verification re-run* — encoding it as an answer option overloads
`run.answer` with a trust-gate side effect no other answer has. Either the ontology is wrong
(checkpoint is not answer-shaped) or the verb set is short one act. Note the actions remain
`run.do` targets regardless, so nothing is unreachable — the false claim is "one verb answers
all".
**Minimal fix:** choose one, and say it: (a) extend §7.3 checkpoint responses to
`continue | wait | settle` with `settle` defined as "re-run the preserved trust gate"
(claim_turn semantics) and `continue` accepting optional text (nudge_turn); or (b) scope
`run.answer` to `question|approval|decision` and declare checkpoint acts advertised
do-targets only. Also add the kind mapping `turn_checkpoint→checkpoint`,
`session_preservation→preservation`, `answer_*→question|approval|decision` — §7.3 currently
has no mapping table while §7.1 does.

### R-KM-5 — the `steer` alias is not semantics-preserving (P1)

**Attacks:** §4.1† "`steer` survives one migration window as a deprecated alias of
`member.send --now`."
**Grounding:** `impl/src/application.mjs:10825-10853` — `run.steer` resolves its `target`
against `coordinator.list()` by **worker id** (`worker.id === request.target`, line 10838),
requires the target's fence, supports all three modes (`now`→`steer`, `nudge`/`turn`
pass-through, line 10843), and requires `--reason`. Its D3 entry is deliberately
`reconcilable: false` (`impl/src/application.mjs:142`) — it is excluded from replay
reconciliation.
**Failure:** four mismatches in one alias. (1) Target class: steer takes a raw kernel worker
id; `member.send` is role[+generation]-addressed and deliberately never accepts worker
coordinates — the alias cannot express existing calls. (2) Mode: the alias pins `--now`;
steer's `nudge`/`turn` modes vanish. (3) Reason: steer requires one; H5's reason list
excludes `send`. (4) Durability: aliasing a `reconcilable: false` command onto a reconcilable
one changes replay behavior for parked envelopes.
**Minimal fix:** drop the alias claim. Mark `run.steer` deprecated with *no* alias, state
that worker-id steering retires to the kernel profile (L8) at M3, and have §6's
`run.member.send` row cite only `run.workstream.notify` / `run notify` / `--to` addressing.

### R-KM-6 — L2's "byte-identical do block on every surface" is unachievable as stated (P1)

**Attacks:** §5 L2 and §10 C2.
**Grounding:** an advertised action's `actionId` is a digest over `{registryDigest, repoId,
runId, principalScopeDigest{principalId, sessionId}, profileDigest, planDigest, viewDigest,
kind, target}` (`impl/src/application.mjs:7310-7323`) — principal- *and session-* bound, and
view-freshness-bound (`semanticViewDigest` strips only the transport cursor,
`impl/src/application.mjs:183-187`). MCP replay additionally demands a transport-minted
context: `transport: 'mcp'`, `idempotencyKey === 'mcp.call:' + requestId`
(`impl/src/mcp-web-bridge.mjs:38-43`), and a `semanticAuthority` payload `{schemaVersion:1,
actionId, kind, effect, requiredCapabilities}` whose `authorityDigest` must recompute exactly
(`impl/src/mcp-web-bridge.mjs:142-167`) — minted per-session by `actionAuthority`
(`impl/src/mcp-web-bridge.mjs:111-135`), not carried by the view.
**Failure:** a do block lifted byte-identically from a view on surface A cannot execute on
surface B: the actionId fails the session/freshness binding, and the MCP surface has no
authority envelope at all. C2's property test as worded ("every advertised do executes
verbatim on all four surfaces") is red on arrival. The portable unit is `{kind, inputs}`;
`actionId` and the authority envelope are per-surface, per-session tokens.
**Minimal fix:** redefine the do block as `{action: <registry action kind>, inputs}` with
`actionId` documented as a per-surface freshness token each surface mints from its own view;
L2/C2 then assert same `{action, inputs}` ⇒ same authority outcome and same resulting outline
modulo cursor. Also state the exact MCP shape: the bridge derives `semanticAuthority` from
the registry entry and the session, so the *caller-visible* block stays `{action, inputs}` on
all four surfaces.

### R-KM-7 — `closed→stopped` contradicts a live consumer; `approved→working` erases a real state (P1)

**Attacks:** §7.1 mapping ("`closed→stopped`", "`approved→working`").
**Grounding:** the embedded client maps `closed` to its **completed** bucket
(`impl/src/application-client.mjs:251`: `['completed', 'closed'].includes(phase) ?
'completed'`), while the application suppresses actions for `closed` exactly as for `stopped`
(`impl/src/application.mjs:7452,7470,8865`) — the codebase already disagrees with itself
about what `closed` means. (No current view-assembly path emits `phase = 'closed'`; it
survives in both terminal sets, `impl/src/application.mjs:122-124` and
`impl/src/application-cli.mjs:29`, whose membership also differs from wave.mjs's
`TERMINAL_PHASES` at `impl/src/wave.mjs:11` — wave omits `denied` and `closed`.) `approved`
is a genuinely emitted phase: plan approved, nothing dispatched yet
(`impl/src/application.mjs:6424` and `6722`).
**Failure:** folding `closed` into `stopped` flips every embedded group view that today
renders such runs as completed — a silent semantic inversion in a shipped consumer. Folding
`approved` into `working` erases the approved-awaiting-dispatch window (lower risk:
`wave.mjs:83-90` `blockedFor` does not special-case `approved`, but drivers polling for
dispatch start lose the signal).
**Minimal fix:** §7.1 must rule on `closed` rather than map it: either declare it dead (no
emitter; delete from both terminal sets and from the client's completed bucket — name
`impl/src/application-client.mjs:251` as the file that changes) or keep it as
`stopped` with `cause: 'closed'` *and* fix the client's bucket in the same phase. Add one
line: `approved→working` carries `cause`/substate `awaiting_dispatch` if any driver is found
to depend on it; otherwise state the erasure is accepted.

### R-KM-8 — M1's registry merge must not touch D3 keys/flags before M4 (P1)

**Attacks:** §9 M1 ("D1/D2/D3 merge behind one table") — §11 names the risk but the phase
text doesn't bind it.
**Grounding:** `WEB_APPLICATION_ENTRIES` derives transport names (dots→underscores), the
capability map, the reconcilable set, the stateless set, and the arg sets directly from
`APPLICATION_COMMAND_DEFINITIONS` (`impl/src/web-northbound.mjs:13-29`), re-exports them as
`card.commands` (`impl/src/web-northbound.mjs:1383`), and admission cross-checks the card
(`impl/src/web-northbound.mjs:426`). Durable reconciliation replays by stored scope key
(`impl/src/web-northbound.mjs:653,1275`). The MCP bridge pins card contents at construction
(`impl/src/mcp-web-bridge.mjs:62`) and revalidates on every replay
(`impl/src/mcp-web-bridge.mjs:169-176`).
**Failure:** if the M1 merge renames keys (e.g. `run.workstream.stop` → `run.member.stop`) or
alters flags in the merged table before renderers flip at M4, every derived transport name
changes at once: parked reconcilable envelopes no longer match their stored scope keys
(replay breaks), and a mixed-version bridge rejects the resident's card (hard
`application_unauthorized`). An implementer following §9 M1 literally produces exactly this.
**Minimal fix:** add to M1: "the merged table keeps each legacy D3 key and flag set as the
transport projection; canonical names resolve as aliases *into* it. Transport-name derivation
changes only at M4, and parked-envelope reconciliation across the M4 boundary is a named
conformance case."

### R-KM-9 — context plan-proposal actions have no canonical home (P2)

**Attacks:** §3 ("context … already clean; unchanged") and §6 (only `context.eval`).
**Grounding:** `context_retry`, `context_reduce`, `context_map` are first-class advertised
actions with `genericCli: true` and `effect: 'plan_proposal'`
(`impl/src/application-semantics.mjs:226-279`); `context_search|chunk|coverage` already exist
as `advertised: false, legacyAliasFor: 'context_eval'`
(`impl/src/application-semantics.mjs:280-323`).
**Failure:** nothing is unreachable (all remain `run.do` targets), but §6's "already clean"
gloss hides that the context noun carries three plan-proposing verbs — the exact
forced-through-a-meta-verb friction §6 says agents should not suffer for ordinary work.
**Minimal fix:** one sentence in §6: context mutation actions beyond `eval` remain
do-targets by design (plan proposals, not ordinary verbs), or add `context.retry/reduce/map`
to the table.

### R-KM-10 — `member.send` generation default vs live-recipient resolution (P2)

**Attacks:** §3 member addressing ("role + optional generation, defaulting to current") and
§6 `run.send` ("recipient-resolving, as today").
**Grounding:** live send/interrupt resolution scans `coordinator.list()` — *currently live*
workers in `working|blocked|interrupted` — and matches the **first** row with
`role === recipient` (`impl/src/application.mjs:1960-1974`); `work` is a synthetic alias with
an explicit ambiguity error (`application_control_recipient_ambiguous`,
`impl/src/application.mjs:1966-1976`). Generation, by contrast, is the durable workflow round
(phase92-EA4). During a generation transition a predecessor worker can still be live while
its successor dispatches.
**Failure:** "generation defaults to current" mixes two clocks: the live-worker set (what
send resolves over) and the durable round (what generation names). First-match role
resolution can steer the *predecessor* worker.
**Minimal fix:** define `run.member.send`'s default as "the run's current workflow round",
and state the transition rule: when a predecessor-generation worker is still live, send to a
bare role fails with the existing ambiguity error and requires `--generation N`.

### R-KM-11 — §7.1's `paused ⇄ interrupted` edge contradicts the derivation order (P2)

**Attacks:** §7.1 diagram (`working ⇄ paused ⇄ interrupted`).
**Grounding:** phase derivation checks `paused` *before* the interrupt branches, and the
interrupt branches only fire from `phase === 'running'`
(`impl/src/application.mjs:6423-6432`, same shape at 6712-6785): a paused-then-interrupted
run renders `paused`, never `interrupted`. At the task layer, `paused` transitions are
`working ⇄ paused` plus `paused → failed|cancelled`
(`impl/src/coordination-store.mjs:123-130`); `interrupted` is a *turn* state
(`impl/src/coordination-store.mjs:4008-4012`), a different axis.
**Failure:** the diagram implies a paused→interrupted path the projection cannot produce;
a conformance test written from the diagram is red against today's (intended) behavior.
**Minimal fix:** draw the axes separately: run phase `working ⇄ paused`; `interrupted` as a
working-subordinate state entered only from `working`, with "paused masks interrupted" stated
as the precedence rule.

### R-KM-12 — §7.3 invents `capacity` and skips the kind mapping (P2)

**Attacks:** §7.3 attention-kind enum.
**Grounding:** live attention kinds are `answer_question`, `answer_approval`,
`answer_decision`, `turn_checkpoint`, `session_preservation`
(`impl/src/application.mjs:6466-6493, 6803-6833`). `capacity` appears only as error codes
(`application_workflow_capacity` `impl/src/application.mjs:1051`,
`application_context_map_capacity` `:7977`, etc.) — no attention emitter exists.
**Failure:** minor, but the enum is presented as covering today's kinds while (a) adding a
kind with no producer and (b) renaming every live kind with no mapping table (§7.1 sets the
precedent of an exhaustive mapping; §7.3 needs one for L4's "legacy string = red test" to be
checkable).
**Minimal fix:** add the §7.3 mapping table (per R-KM-4's fix) and mark `capacity` as
reserved-for-issue-31-followup with no emitter yet, or drop it.

### R-KM-13 — H10 pin is safe for digests but underspecified as a contract (P2)

**Attacks:** §4.2 H10 ("parsers may rely on it … part of the conformance contract").
**Grounding:** every digest in the system canonicalizes with sorted keys before hashing
(`canonical()` at `impl/src/application.mjs:171-177`; the MCP bridge duplicates it at
`impl/src/mcp-web-bridge.mjs:25-30`), and view digests strip only `cursor`
(`impl/src/application.mjs:183-187`). So field order today is *not* digest-relevant, and no
replay path depends on it. View objects are assembled by fixed-shape builders (deterministic
insertion order per code path) but also by spreading/cloning stored durable records, whose
key order is writer-dependent.
**Failure:** no current breaker — the pin cannot break digests or replay. The risk is
contractual vagueness: without a stated scope, "the order" is untestable (C8) wherever a view
embeds a cloned record or a data-ordered collection (e.g. role-sorted recipient lists,
map-iteration sections).
**Minimal fix:** scope H10: the pin covers the envelope and outline top-level fields plus
registry-owned nested objects, enforced as a *serialization-layer* normalization (not a
builder discipline); arrays whose order is semantic (recipients, actions by priority) are
pinned by their existing sort rule and called out as such.

### R-KM-14 — the allowed-divergence ledger checks only one direction (P2)

**Attacks:** §8.4 ("ledger … starts as the full audit and must shrink to empty by M5 — no
silent regressions") and §10 C4.
**Grounding:** `impl/scripts/surface-audit.mjs` regenerates current truth; the ledger seeds
from it. C4's synonym lint is a fixed denylist (`workstream|seat|show|status|inspect|act|
notify|steer|stop-member`).
**Failure:** "every seeded divergence resolved by M5" does not catch a *new* divergence
introduced after M0 that was never seeded — it sits outside the ledger and outside the fixed
denylist (e.g. a fresh synonym like `agent`, or a hand-added MCP tool with no registry entry
during the M1–M3 window when surfaces are still hand-maintained). Silent by construction.
**Minimal fix:** state the ledger invariant as bidirectional and removal-only: at every
commit, `observed divergences ⊆ ledger` (anything unledgered is red) *and* the ledger only
shrinks; supplement C4's denylist with L1's derive-from-registry check as the novel-synonym
guard.

### R-KM-15 — M2's rename invalidates in-flight advertised actions; C2 needs re-baselining (P2)

**Attacks:** §9 phase ordering M1→M2, §10 C2.
**Grounding:** advertised `actionId`s embed `viewDigest` over the view *content*, which
includes phase strings (`impl/src/application.mjs:7310-7323`); M2 renames those strings
(`approved→working`, etc.). Wave drivers and parked attention items hold pre-M2 actionIds.
**Failure:** at the M2 boundary every outstanding advertised action fails stale (fail-closed,
so safe — but a wave mid-flight hits `application_action_scope_mismatch`-class refusals until
it re-reads). C2's property test written at M0 asserts against the pre-M2 view shape.
**Minimal fix:** one line in M2: "the vocabulary flip invalidates outstanding advertised
actions by design; drivers re-read the outline (this is the intended recovery, and the
failure mode is fail-closed). C2 is re-baselined against §7 vocabulary at M2."

### R-KM-16 — `deployment.view` must not inherit `doctor`'s reachability (P2)

**Attacks:** §6 `deployment.view` row ("replaces `doctor`, `doctor --check`, `routes()`…").
**Grounding:** `doctor` is explicitly local: "baton doctor is local and never reads the
credential or contacts the remote application" (`impl/src/application-semantics.mjs:689`);
`--check` is the opt-in remote probe (`:690`). A registry-rendered `deployment.view` per L1
projects to web/MCP — i.e. remotely.
**Failure:** folding a local-only diagnostic into a remotely projected op changes its trust
footprint (sanitized or not) without the doc noticing.
**Minimal fix:** annotate the row: `deployment.view` is the *remote* readiness/route read;
the CLI's local, credential-free doctor stays a host-side rendering detail and is not
projected to web/MCP.

### R-KM-17 — waves auto-approve already satisfies L5's mechanics; the gap is attribution (P2)

**Attacks:** §5 L5 ("auto-approval becomes an *explicit recorded* `approve` by the preset").
**Grounding:** `waves.start` already approves each member explicitly (`impl/src/wave.mjs:131`
`approve = options.approve !== false`, `:156` `await entry.run.approve()`), which routes
through `run.act approve_plan` into the durable `coordinator.approvePlan` event with actor
and idempotency key `application:{runId}:approval:{planDigest}`
(`impl/src/application.mjs:3953-3963`). Durability semantics need no change.
**Failure:** none to durability. The residual gap: the recorded approval is
indistinguishable from an operator's — nothing records *that the preset expanded to this
approve*, which is what L5's "expansion is registry-recorded" and C7 actually require.
**Minimal fix:** reword L5/C7 to require an additive provenance field on the recorded
approval/expansion events (preset id + expansion digest), explicitly "no durability-semantics
change".

---

## Sections that survived attack (one line each)

- **§6.1 derivation rules / L1 mechanics** — the four renderings are pure functions of the
  registry key; the existing `dots→underscores` web derivation
  (`impl/src/web-northbound.mjs:15`) proves the pattern; sound once R-KM-8's projection
  constraint holds.
- **§7.1 `work_completed→completed`, `start_failed→failed`, `awaiting_plan_approval→awaiting_approval`**
  — no consumer keys behavior off the distinction beyond what wave.mjs re-reports
  (`impl/src/wave.mjs:267` checks `SUCCESS_RESTING` separately and is a named M2 re-report
  target); clean.
- **H5 uniform `--reason`** — matches the registry's existing `destructive` flags
  (`impl/src/application-semantics.mjs:324-548`); enforceable by schema.
- **L8 capability projection** — views already capability-filter advertised actions
  (`impl/src/application.mjs:8869-8874`); projecting the same filter to surface inventory is
  a faithful generalization.
- **L9 steer-don't-gate** — checkpoint semantics are landed and advertised
  (`impl/src/application.mjs:8785-8798`); the law describes reality (its *ontology* is what
  R-KM-4 attacks, not the behavior).
- **Rollback story (§9)** — aliases additive until M5 matches the existing alias mechanics
  (`legacyAliasFor`, `aliasFor` in `impl/src/application-semantics.mjs`); credible.

## Verdict

**SOUND-WITH-FOLDS.** The audit (§1), the registry-as-generator design (§8), and most of the
lifecycle mapping are grounded in the real tables and survive contact with the code. Nothing
found is a P0 — every break has a small, local repair — but eight P1s must fold before M1,
led by three that would otherwise be cut into contracts verbatim:

1. **R-KM-6** — L2/C2 as worded is a red test on arrival; the portable do block is
   `{action, inputs}`, not the session-bound `actionId`. Gates M1's headline law.
2. **R-KM-4** — the attention unification (§3 ontology itself) is false for checkpoints:
   three acts, two options, and a trust-gate re-run that is not an answer.
3. **R-KM-3** — the episode fold, which the doc itself flags as the hardest target, currently
   loses role×generation addressing and the admission matrix that phase92 pins as executable
   evidence guarantees.
