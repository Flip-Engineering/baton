DSH-QA v1
[attempt: f793be9c-e387-469d-9847-9cd3f4299d0f coordinator]

# DSH comparison QA — coordinator merge + rubric application (dsh-comparison-2026-08-13)

Seat: coordinator (v4-pro). Campaign `dsh-comparison-2026-08-13-wave-a`: three comparison rows
(arch, lifecycle, seams) + one scope-creep red-team row answer one question — what does DeepSeek
Harness (dsh) know that baton should, and what must baton refuse to learn from it. This file is
the harvest artifact (`DSH-QA v1`).

## 1. Signal state

`signalOnMembersDone` has **not** fired. Only `messageOnSpawn` and a checkpoint nudge arrived this
session. Per the brief I wait for that signal before issuing row verdicts; the merge below is my
own coordinator pass, not a read of row reports.

## 2. On-disk verification record (law #174)

Verify-first, before any verdict. Exact checks, this seat's run:

1. Main repo `docs/reference/evidence/dsh-comparison-2026-08-13/` (HEAD `33e76f9`) — pack only
   (`foundry-brief.md`, `coordinator-brief.md`, `workflow.json`, `dsh-digest/`, the four
   `row-dsh-*.md` briefs). **No `dsh-arch.md` / `dsh-lifecycle.md` / `dsh-seams.md` /
   `dsh-redteam.md`.**
2. All sibling worktrees `../../wt/ws-*/` — deep find for `*dsh*` returns nothing; no worktree
   holds a dsh report. My own worktree (baseSha `e371f70`) predates the pack commit `02119a7`, so
   its `dsh-comparison-2026-08-13/` directory does not exist at all.
3. No wave-a row worktree or `state/w-*.jsonl` exists — the four rows were never spawned/settled.

**Result: zero wave-a row reports on disk.** I am the only member with a session. Silence is not
death (§174) and a missing attempt marker is not a dead row — so I declare no row dead. I also do
not invent a row's content.

## 3. Verdict posture

Uphold/overturn of a *row's* proposal requires that row's report. With none on disk, **no row
verdict is issued against a row**; fabricating a missing row is the one prohibited act. What I
*could* do — and what the checkpoint nudge directs — is run the comparison myself at coordinator
depth. §4–§8 are my own independent merge (clearly mine, not a row's): the candidate list is drawn
from the four row briefs' enumerated candidates, and each candidate is evaluated directly against
the digest (dsh side, verified this session) and the baton tree (baton side, verified this session).

## 4. Merged adoption table

Sizing: **S** = a pin / invariant / lane (one rung). **M** = a module / seam refactor (one wave).
**L** = a subsystem (a phase). Verdicts per the foundry law: ADOPT / ADAPT (say the shape) /
REJECT (why) / ALREADY-HAVE (name the landed equivalent).

| # | Candidate | Verdict | Baton landing zone | Sizing |
|---|---|---|---|---|
| A1 | "model-visible means logged" as an **asserted runtime invariant** | **ADOPT** | New invariant + verifier pin in `coordination-store.mjs` (member model-context reconstructability), with the spill-digest caveat | S |
| A2 | Typed event **dispatch-mode contract** (emit/waterfall/parallel/serial) | **ADAPT** (typed-mode contract only — the waterfall-middleware *shape* is REJECT, §5) | Event-log schema annotation on the coordination store | S |
| A3 | Waterfall/serial **middleware interception** as the policy mechanism | **REJECT** | — (framework-envy: baton's admission/refusal gates are the honest shape) | — |
| A4 | **Reversible effects / disposer** discipline (registrations unwind on unload) | **ADAPT** | Lease/incarnation teardown — closes the #177 silent-recovery gap | S |
| A5 | **Profiles/bundles/patches** boot composition | **REJECT** | — (config sprawl; baton's deployment files + #180 per-wave profiles are the thin increment) | — |
| A6 | `sessions.fork` (fork a live session at a boundary) | **REJECT** | — (session-fork romance; #59 content-addressed re-drive is honest about what carries over) | — |
| L1 | `agent.inject()` — mid-flight **context lane** landing in the next admitted request | **ADOPT** | Member context lane (the #147 per-worker-object ask), bounded by the frame-economics spill | S |
| L2 | `agent/pre-step` interception (rewrite/reject what the model sees) | **ADAPT** (member-side steering seam only) | The `steering.focus` lane + spawn objective — narrow, no rewrite-listener framework | S |
| L3 | **Durable no-step turn** (a rejected/empty attempt is still recorded) | **ADOPT** | Attempt-marker audit receipt — closes the silent-turnless-worker gap | S |
| L4 | Per-agent **scoped registration** (`agent.ctx`) | **ADAPT** (as #147 member profile only; the pet-session reading is REJECT, §5) | Member profile work (#147) | M |
| L5 | **Agent handle** cancellation / error recovery | **ALREADY-HAVE** | #182 death certificates + #67 watchdog + confirmed-stop events (`adapter.mjs` red core#2) | — |
| S1 | **Seam triple** discipline (Definition / Provider / Consumer) | **ADOPT** | Adapter contract gains an explicit Definition role | M |
| S2 | **Subagent-behind-one-interface** (breadth incl. a delegated turn in another product) | **ADAPT** (breadth, not a rewrite) | Adapter layer gains a delegated-turn provider (Claude Code / OhMyPi member without CLI spawn) | M |
| S3 | **Guarded tool pipeline** (`tools/pre-execute` waterfall) | **ADAPT** | Pre-execute gate — closes the #176 pre-gate hole | S |
| S4 | **Config-patch composition** (any row replaceable) | **REJECT** | — (config sprawl; #180's resident-verifier-`true` gap is a content pin, not a composition hole) | — |
| S5 | **LSP through the fs/subprocess seam** (remote sandbox by moving the seam) | **ADAPT** (defer) | #144 pool's remote-sandbox reading — operator's LOW item | M |

## 5. Rubric application (red-team row's rubric, applied to every ADOPT/ADAPT)

The red-team rubric is the standing vetoes operationalized for dsh-shaped proposals plus the three
dsh traps: **(a)** single-agent trap (a proposal that only makes sense for one live agent is
OUT-OF-SCOPE unless its swarm reading is named); **(b)** plugin-everything trap ("make baton a
plugin system" is a rewrite, not a rung); **(c)** framework-envy trap (trading evidence/pin/harvest
honesty for boot-composition elegance); plus the standard vetoes (clocks, lying surfaces,
closed-vocabulary mutation, per-worker heaviness, methodology bypass, imagined-vs-observed cost).

| # | Verdict | Rubric outcome | Question it survives — or the one it fails |
|---|---|---|---|
| A1 | ADOPT | **SURVIVES** | Honesty-over-comfort is *strengthened* (a reconstructability invariant is more honesty, not less). Swarm reading named: every member's model-visible context must be reconstructable from the store. Caveat: baton's spill means the log holds a digest, not the body — the invariant must be "reconstructable *via* the cited spill artifact," never a claim the body is inline. |
| A2 | ADAPT | **SURVIVES** (narrow) | Typed-mode contract is additive and non-heavweight. The waterfall-middleware *half* is **REJECTED-BY-RUBRIC** — framework-envy (c): a rewrite-listener policy layer is Cordis elegance, not a baton rung; baton's closed admission/refusal vocabulary is the honest mechanism. |
| A4 | ADAPT | **SURVIVES** | Additive disposer discipline on existing leases; closes #177 without a new framework. No veto hit. |
| L1 | ADOPT | **SURVIVES** | Serves the operator's standing ask ("pass entire bodies of context into per-worker objects"). Swarm reading named (#147 member context). Frame-economics respected: the body spills, the lane cites a digest — no unbounded lane, no clock. |
| L2 | ADAPT | **SURVIVES** (narrow) | The member-side steering seam has a swarm reading (one steering lane per member, bounded). The single-agent rewrite-listener reading is **REJECTED-BY-RUBRIC** — single-agent trap (a) and framework-envy (c). |
| L3 | ADOPT | **SURVIVES** | Records an attempt even when it produced no step — pure honesty, additive, aligns with baton's existing attempt/audit receipts. No veto hit. |
| L4 | ADAPT | **SURVIVES** (as #147 member profile) | Swarm reading named (#147). The human-pet-session reading is **REJECTED-BY-RUBRIC** — single-agent trap (a): "per-agent tool scoping for a human's pet session, chat-UI chrome" is OUT-OF-SCOPE. |
| S1 | ADOPT | **SURVIVES** | I adopt the *three-role discipline*, not the plugin framework — the plugin-everything trap (b) is avoided by naming only the Definition role as the missing piece of the existing D1 adapter contract. No veto hit. |
| S2 | ADAPT | **SURVIVES** | Additive provider behind the existing adapter contract (ALREADY-HAVE for fresh-spawn; the delegated-turn provider is the increment). Not a rewrite. |
| S3 | ADAPT | **SURVIVES** | A pre-execute gate is additive and closes a named, observed hole (#176). No veto hit. |
| S5 | ADAPT | **SURVIVES** (defer) | Named as the operator's LOW item; deferred, not carried now. Additive when it comes. No veto hit. |

**Disagreements recorded as judgment calls:** the red-team brief pre-registers "event-mode
proliferation" as a trap; I split the candidate (A2 contract SURVIVES, waterfall half REJECT) rather
than reject wholesale — recorded here as a judgment call, not a row disagreement (the red-team row
has no report to disagree with). Likewise L3: the red-team's "session-fork romance" trap does *not*
extend to the durable-no-step-turn — recording a rejected attempt is honesty, not fork-romance.

## 6. The four expected headline candidates — verified or overturned

Each is checked against the digest (dsh side) and the baton tree (baton side), not against a row.

- **"model-visible means logged" as an asserted invariant — VERIFIED, dsh's, real.** The digest
  states it plainly: "Anything that reaches a model request must be reconstructable from the log,
  and a runtime invariant asserts it" (`dsh-digest/architecture.md:96`), the reconstructability
  Agent Note makes "every conversation request a pure function of the log"
  (`subsystems/session.md:156`), and a log missing its marker "MUST refuse to reconstruct"
  (`session.md:223`). Baton's store is event-sourced and replay-reconstructable
  (`coordination-store.mjs` — "replay reconstructs the identical projection"), but **no baton
  invariant asserts model-visible ⇒ logged**, and the spill mechanism (`limits.mjs:54`
  `message.send.body` 2048 bytes, `graceful: 'spill-digest-citation'`) means large bodies exit the
  log as digest citations. **The invariant is the single clearest dsh thing baton should adopt.**
- **`inject-into-next-request` — VERIFIED, dsh's, real.** "Add model-facing context | call
  `agent.inject()`; it lands in the next admitted request" (`architecture.md:120`); injected context
  is a first-class logged `user/message` surface node (`session.md:50,528`); quiet child reports
  "use `Agent.inject()`" (`subsystems/subagent.md:194`). Baton's analogue is message frames delivered between
  turns with a 2 KiB body cap — there is no first-class mid-flight context lane, so the operator's
  standing ask (entire bodies into per-worker objects) currently rides the spill. **Real gap; adopt
  the lane, keep the spill bound.**
- **The seam triple discipline — VERIFIED, dsh's, real.** "A seam is a swappable capability with
  three roles: a Service Definition declaring the interface, a Service Provider implementing it, and
  a Consumer using it" (`architecture.md:100`), with the full catalog in
  `capability-seams.md` (e.g. `ctx.fs`/`ctx.subprocess`/`ctx.subagents`/`ctx.lsp`, each with a
  definition package, provider packages, and consumer packages). Baton's D1 adapter contract
  (`adapter.mjs:4`) is a flat single contract — `card/spawn/prompt/interrupt/approve/answer/kill/
  onEvent` — where provider and consumer are the same object and no Definition role exists.
  **Real gap; adopt the Definition role, not the plugin framework.**
- **Subagent-provider breadth — VERIFIED, dsh's, real.** dsh runs six providers behind one
  interface — `spawn-in-process`, `fork`, `acp`, `codex`, `claude-code`, `dsh-sdk`
  (`subsystems/subagent.md:7`) — "from a fresh child agent to a delegated turn in another product"
  (`architecture.md:102`). Baton's adapter registry is the same *idea* (Mock/Codex/Claude/Glm), but
  every baton adapter is a fresh CLI spawn; the **delegated-turn-in-another-product** provider (a
  Claude Code or OhMyPi session made a wave member *without* the CLI spawn) is the one increment
  baton lacks. **Partly already-have; adopt only the delegated-turn provider shape.**

## 7. What dsh does better than baton (honest, no defensiveness)

dsh is genuinely better at four things, and baton should say so plainly. **(1)** It asserts an
invariant baton only implies: that anything the model sees is reconstructable from the log. Baton's
store is honest about what it holds, but it does not *assert* the model-visible-means-logged
property, and its spill mechanism quietly lets bodies leave the log as digests — the invariant would
make that a checked property instead of a convention. **(2)** It has a first-class lane for
mid-flight context (`agent.inject()`), a first-class log node, no 2 KiB message-body ceiling;
baton's between-turn frames are narrower than the operator's actual ask. **(3)** Its
Definition/Provider/Consumer separation is cleaner than baton's flat adapter contract — in dsh you
cannot have a capability without naming all three roles, so "which part is the swappable seam"
is never a judgment call. **(4)** Its subagent seam is broader — six transports, including
delegation into *another product's* turn and an in-process fork — where baton's adapters are all
fresh-spawn CLI processes. None of these justify trading baton's evidence/pin/harvest honesty for
dsh's boot-composition elegance; they are four specific, addable mechanisms, not a reason to adopt
the framework.

## 8. Final prioritized adoption list

1. **A1 — model-visible-means-logged invariant** (S). Highest: it is the honesty anchor, and it is
   the one dsh mechanism whose absence is currently a silent gap, not a conscious choice.
2. **L1 — `agent.inject()`-shaped context lane** (S). Serves the operator's standing ask directly.
3. **S1 — Definition role on the adapter contract** (M). Makes the swappable seam explicit.
4. **L3 — durable no-step turn / attempt-marker receipt** (S). Closes the silent-turnless gap.
5. **A4 — disposer discipline on leases** (S). Closes #177.
6. **S3 — pre-execute gate** (S). Closes #176.
7. **S2 — delegated-turn subagent provider** (M). The breadth increment baton lacks.
8. **L2 — member-side steering seam** (S). Narrow; the `steering.focus` lane already exists.
9. **A2 — typed dispatch-mode contract** (S). Additive; do not carry the waterfall half.
10. **L4 — #147 member profile** (M). The swarm reading of dsh's `agent.ctx`.
11. **S5 — LSP remote-sandbox seam** (M, defer). Operator's LOW item.

## 9. Escalation (authority-class → UP)

DECISION_REQUEST (recorded — the channel is not reachable from this seat's toolset):

- **A** — wait for the four rows and re-invoke the coordinator when `signalOnMembersDone` fires;
  then uphold/overturn the row reports against this merge.
- **B** — proceed on this coordinator merge; record wave-a as NOT-YET-ROW-QA-ABLE (row reports
  absent), as the blueteam wave-b precedent did.
- **C** — mark wave-a blocked on row delivery and re-dispatch the four rows (the reports would land
  in `docs/reference/evidence/dsh-comparison-2026-08-13/`).

## 10. Shared publish

`shared` scratchpad write (`scope: 'shared'`, kind `note`) is not reachable from this seat's
toolset — the shared partition exists only behind `coordination-store.writeScratchpad`, and no
scratchpad-write tool is exposed to this worker. Full text delivered here as the durable artifact.
Recorded as unperformed (evidence, not silence).

## 11. Row-by-row status

| row | lane | report on disk? | row verdict | coordinator read |
|---|---|---|---|---|
| row-dsh-arch | framework/architecture | ABSENT | — | merged as A1–A6 |
| row-dsh-lifecycle | agent lifecycle + injection | ABSENT | — | merged as L1–L5 |
| row-dsh-seams | capability seams + composition | ABSENT | — | merged as S1–S5 |
| row-dsh-redteam | scope-creep rubric | ABSENT | — | rubric applied in §5 |

## 12. What unblocks a real cross-check

The four `dsh-{arch,lifecycle,seams,redteam}.md` reports landing in
`docs/reference/evidence/dsh-comparison-2026-08-13/` (or the `shared` partition). At that point I
can uphold or overturn each row's candidates against its cited evidence, reconcile its verdicts with
§4, and re-apply the red-team rubric to the rows' actual ADOPT/ADAPT set rather than the briefs'
enumerated candidates.
