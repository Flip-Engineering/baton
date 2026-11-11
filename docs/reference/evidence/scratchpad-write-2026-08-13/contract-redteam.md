# #158 RED-TEAM REPORT — adversarial attack on the scratchpad-write contract v1

- **Target:** `scratchpad-write-contract.md` (v1, same dir — issue #158, the shared scratchpad
  WRITE/append verb on CLI/MCP/web).
- **Date:** 2026-08-13
- **Verification HEAD:** `722bd36` ("Baton private effective-tree snapshot", the worktree HEAD
  this report was written at). The contract claims verification at `72a0c0f`; the diff
  `72a0c0f..722bd36` touches **docs only** (contract-157/159, error-actionability,
  kernel-honesty, receipts) — zero `impl/` changes — so every `file:line` anchor holds at both.
- **NUL discipline honored:** `application.mjs` and `coordination-store.mjs` were probed with
  `grep -an`/`sed -n` only (3 NUL bytes each); no whole-file reads. `application-deployment.mjs`,
  `web-northbound.mjs`, `mcp-northbound.mjs`, `application-cli.mjs`,
  `application-semantics.mjs`, `coordinator.mjs`, `workflow-interpreter.mjs`, and `limits.mjs`
  were read directly (NUL-free). All audit/contract docs read directly.
- **Scope:** the single deliverable
  `docs/reference/evidence/scratchpad-write-2026-08-13/contract-redteam.md`; no source file was
  modified.

---

## 1. Citation re-verification (all at current HEAD)

Every `file:line` the contract cites was re-verified this session. **No wrong citation found —
no automatic blocker.** Verified anchors (excerpts):

- Kernel write lane: `coordination-store.mjs:14064-14155` `writeScratchpad` (envelope closed to
  `['runId','taskId','workerId','entry']` `:14065`; `auth.actor === 'worker'` +
  `principalId === fields.workerId` `:14066`; steering `noteMaxBytes` override `:14073-14077`;
  `_byKey` replay `:14086-14102` (`scratchpad_write_conflict` `:14091`); hardcoded
  `scope = \`worker:${fields.workerId}\`` `:14103`; `scratchpad_partition_exhausted` `:14106-14107`;
  `scratchpad.entry_written` `:14148`; `elevateTaskScratchpad` `:14173+`).
- Store constants/grammar: `:492` `MAX_SCRATCHPAD_WRITE_REQUEST_BYTES = 16_384`, `:493`
  `MAX_SCRATCHPAD_ENTRY_BYTES`, `:524` `MAX_SCRATCHPAD_WORKER_ENTRIES = 128`, `:525`
  `MAX_SCRATCHPAD_SHARED_ENTRIES = 512`, `:533-535` `SCRATCHPAD_SCOPE` / `SCRATCHPAD_IDEMPOTENCY_KEY`
  / `SCRATCHPAD_KINDS`; `:607-696` `normalizeScratchpadEntry` (per-kind closed shapes; `:615`
  `scratchpad_entry_invalid`; `:623-626` note cap 2048 / override).
- Coordinator: `coordinator.mjs:10790-10840` `writeScratchpad` wrapper (the #48 erratum comment
  `:10807`, prose-fence comment `:10799-10803`, allowed set incl. `run_stopping` `:10837`);
  `coordinator.mjs:12690-12707` `scratchpad.write` → `scratchpad.write_result` up-channel.
- Read law + seam: `contract-fold.md:139-168` D1.2; `application-deployment.mjs:1728-1742`
  `restrictingReadAuthorize()` (permissive for every command except `run.scratchpad.read`
  `:1731`; review authority `local-owner`/`service-*` read any worker scope `:1738-1739`);
  installed as the default `:2041`; `application.mjs:3222` the `_authorize` throw.
- Facade: `application.mjs:13097` read passes `{scope}`; `:12870-12882` `_normalizeScratchpadRead`;
  `:13133-13151` `scratchpadElevate` (resolved-run check, then permissive `_authorize`);
  `:168-207` `APPLICATION_COMMAND_DEFINITIONS` (no scratchpad rows); `:12522-12523` pre-gate
  direct ports; `:1846-1847` `validateApplicationCommandArgs` throws
  `application_command_unavailable` for a command not in `APPLICATION_COMMAND_DEFINITIONS`.
- Web bus: `web-northbound.mjs:37-47` `WAVE_WEB_ENTRIES`; `:62` `WEB_DIRECT_PORT_COMMANDS`
  (derived from `WAVE_WEB_ENTRIES` only); `:87-94` `COMMAND_CAPABILITY` (no scratchpad entry);
  `:112-148` `ARG_FIELDS`; `:149-151` `APPLICATION_COMMAND`; `:405` `unsupported command`;
  `:414` the `APPLICATION_COMMAND[x] && !WEB_DIRECT_PORT_COMMANDS.has(x)` gate; `:1026,1035`
  `_dispatch`.
- MCP: `mcp-northbound.mjs:114-115` capabilities; `:652-668` read/elevate tool defs; `:822-829`
  `ORDINARY_EXPLICIT_TOOLS` (typed-failure lane `:1530`, **not** an admission set — a tool is
  admitted by `TOOL_DEFINITIONS` `:830`); `:1178-1193` validateArguments branches; `:1900-1909`
  the `_dispatch` branches for `baton_run_scratchpad_read`/`elevate`.
- CLI: `application-cli.mjs:16-32` `CLI_WEB_COMMANDS` (read/elevate present, no append);
  `:1476-1511` scratchpad parse branch (`:1511` the `unexpected argument ${sub}` throw, default
  `cli_invalid` per `:50`); `:1483` `--scope` take (grammar check `:1485`); `:2012-2026` web-client
  `command()` dispatch gated on `CLI_WEB_COMMANDS` (`:2013`).
- Semantics: `application-semantics.mjs:1338-1348` `run.scratchpad` parent row (surfaces
  `['embedded','cli']`); `:1678-1686` read row; `:1687-1695` elevate row.
- Limits / interpreter: `limits.mjs:71` `scratchpad.entry.body` (8192 B, `admission`,
  `enforcedAt: 'coordination-store.writeScratchpad'`, `refusalCode: 'scratchpad_entry_exceeded'`);
  `workflow-interpreter.mjs:248-258` `elevateWhenNotes` validation; `:877-908` `tryElevate`
  (reads `worker:<id>` then elevates, dedup per (runId, role)).
- Docs: `control-surface-audit.md:85` (parity row "write/append absent" on all three), `:191-197`
  (finding #10); `surface-audit-cli.md:351-360` (F-9), `:167` (E-11), `:170` (E-14);
  `surface-audit-web.md:41`, `:304-309` (F7); `facade-projection-contract.md:217` (scope grammar),
  `:636` ("unknown ≡ foreign"); `tight-cell-contract.md:815-822` (D-depth-2 direct shared write —
  **contracted, not landed**: line 808 says "today: orchestrator elevation only").

Two trivial nits (not blockers): the contract says the CLI read branch's scope "check" is at
`:1483` (the `take` is at `:1483`, the grammar test at `:1485`); and `contract-fold.md:419` cites
`application.mjs:3215` for the `application_unauthorized` throw while the #158 contract cites
`:3222` — both are in the same `_authorize` function (the throw is at `:3222`).

---

## 2. D1 — the write law: **HOLE** (four sub-findings)

The authority shape is largely right (a member may append to `worker:<ownId>` + `shared`; a
sibling `worker:<other>` scope refuses at the seam; the review authority is shared-only; a shared
append is workflow-ephemeral). The holes are in the enforcement seam's *coverage*, not its
direction.

### H1.1 — the "own run" predicate is unenforced at the seam (blocker)

D1 law 2 claims a write "to a partition **outside its own run**" refuses `application_unauthorized`
at the authorization seam, and the D1.2 mirror predicates both scopes "within its own run"
(`contract-fold.md:139-168`). But the specified append restrictor — mirroring the landed
`restrictingReadAuthorize()` (`application-deployment.mjs:1728-1742`) — destructures only
`{ command, principal, subject }` and keys on `subject.scope` / `principal.principalId`; it never
consults `request.runId`. The kernel `writeScratchpad` (`coordination-store.mjs:14064+`) binds
`auth.principalId === fields.workerId` but performs **no run-membership check** (no
`validRunId` is enough; a worker of run A is not verified to be a participant of run B). The web
path compounds it: for a direct-port command the whole `application_run_id_mismatch` block
(`web-northbound.mjs:414-423`) is skipped, so even the envelope-level runId coherence check is
not run.

Consequence: a member with `principalId = worker:alice` can append to `shared` of **any** run, or
to `worker:alice` of any run that carries that partition, by naming a foreign `runId` in the arg
closure (the contract makes `runId` a required **caller-supplied** arg, D2.1). That is exactly
"outside its own run" — the law states the refusal, the specified enforcement does not deliver it.

Fix (pick one, and pin it): (a) derive `runId` server-side from the principal's active
task/seat — the coordinator's `_getWorker` binding (`coordinator.mjs:10791-10794`) — instead of
accepting a caller-supplied `runId`; (b) have the append restrictor resolve the principal's
active run and refuse when `request.runId` differs; or (c) add a run-membership check to the
kernel shared/worker write path. The contract must name one. This is the write-law sibling of a
pre-existing gap in the D1.2 restrictor (reads have the same runId blindness), but the #158
contract is drafting the restrictor fresh and cannot inherit the gap while asserting law 2.

### H1.2 — write→elevate self-escalation is open: law-4's "never a candidacy shortcut" is unenforced (blocker)

The brief asks directly: can a write escalate itself without the orchestrator gate? **At HEAD it
can.** The deployment authorize (`application-deployment.mjs:1731`) returns `true` for every
command except `run.scratchpad.read`. `run.scratchpad.elevate` is a pre-gate direct port
(`application.mjs:12523`); the facade `scratchpadElevate` (`application.mjs:13133-13151`)
authorizes with that permissive restrictor and routes to the coordinator wrapper, which hardcodes
`actor: 'orchestrator'` at the kernel (`coordinator.mjs:10857`) — so **any principal who reaches
the port can elevate their own task's entries**, minting a `scratch-fact` KG candidate
(`coordination-store.mjs:14259-14278`, the `note` → `scratchFactId` mint; the id is wired into
the elevation payload at `:14283`). The only obstacles are
knowing your own `taskId` and your own `entryId`s — which a member trivially has.

So "write then elevate without the orchestrator gate" is reachable *today* via the #33 up-channel
write + the open elevate port. The append verb does not create it, but the contract's D1 law-4
("the orchestrator's elevation remains the law for PROMOTION"; "elevation remains the promotion
law") and A6 ("a direct `shared` append never mints a scratch-fact") overstate the guarantee: the
append verb gives the member a single-surface flow (append to `worker:<ownId>` → elevate), and the
"elevation is the promotion law" claim is only as strong as the elevation gate, which the D1.2-era
code left permissive.

Fix: pin that the append restrictor (or a named follow-on seam) also restricts
`run.scratchpad.elevate` — orchestrator/own-task only — or explicitly state that the elevation-gate
gap is pre-existing and out of scope, and weaken law-4/A6 to "the append verb itself never mints a
candidacy" (true) rather than "elevation remains the orchestrator's law" (unenforced).

### H1.3 — shared-append provenance (author identity) is never pinned

The arg closure `{ runId, scope, kind?, body, idempotencyKey? }` (D2.1) excludes `workerId`, so a
caller cannot supply a forged author at the surface — SOUND. But the contract never pins that the
**kernel's** shared-write path binds the entry's `workerId` to `auth.principalId` the way the
worker path does (`coordination-store.mjs:14100-14116`). The D1 law-3 justification (separation
of author and record — "falsifying the member's audit trail") depends entirely on that server-side
binding. The mechanism this contract defers to is the tight-cell D-depth-2 direct shared write
(`tight-cell-contract.md:808-822`), which is **RED at HEAD** ("today: orchestrator elevation
only") and is described only by its nonce/fence/idempotency shape — not by its provenance binding.

Fix: add an acceptance pin that a `shared` append's entry carries `workerId === auth.principalId`
(server-bound, never a caller field), and state it as a GREEN condition of the tight-cell
mechanism this contract rides.

### H1.4 — the review authority's shared-only posture is exhaustible

A member may fill the shared partition to its 512-entry cap (512 notes × up to 8192 B ≈ 4 MB per
run), after which the review authority's **mandatory** shared advisory notes (D1 law-3, A5)
refuse `scratchpad_partition_exhausted` (`coordination-store.mjs:14238-14240`). D3's spam
discipline ("bounded by partition caps + per-member idempotency + the D1 scope law") ranks no
writer above another, so a hostile member can starve the review authority's advisory lane. The
"cross-member spam is structurally impossible" claim is true only for **worker** partitions; the
shared tier is a shared drain.

Fix: either rank the review authority's shared writes ahead of member writes (a separate
priority admission) or accept the shared cap as the bound and say so plainly; A5's "appends to
shared resolve" must not be able to fail because a member pre-filled the tier.

### D1 verdict

HOLE — three enforcement-seam gaps (H1.1 run binding, H1.2 elevation gate, H1.4 shared
exhaustion) and one un-pinned binding (H1.3). The scope-law direction (sibling partition refused,
review authority shared-only) is correct and matches the D1.2 sibling shape.

---

## 3. D2 — the verb + its three-surface admission: **HOLE** (two ghost traps)

The verb shape (D2.1) is coherent and the arg closure is closed (no caller authority fields; the
`_normalizeScratchpadRead` sibling pattern at `application.mjs:12870-12882` is the right template).
The CLI admission (D2.2) covers parser + `CLI_WEB_COMMANDS` + registry/docs. The holes are the
two surfaces where the contract's own table lists are **incomplete**, which would produce exactly
the #157 anti-pattern the contract names as its reason to exist.

### H2.1 — web admission omits `WEB_DIRECT_PORT_COMMANDS`: the #157 ghost on the web bus (blocker)

`validateEnvelope` admits a command to the web bus via
`COMMAND_CAPABILITY` (`web-northbound.mjs:405`), then gates argument validation at
`web-northbound.mjs:414`:

```js
if (APPLICATION_COMMAND[envelope.command] && !WEB_DIRECT_PORT_COMMANDS.has(envelope.command)) {
    try { validateApplicationCommandArgs(...); } catch { return 'application_command_arguments_invalid'; }
```

`validateApplicationCommandArgs` throws `application_command_unavailable` for any name not in
`APPLICATION_COMMAND_DEFINITIONS` (`application.mjs:1846-1847`), and `run.scratchpad.append` is
deliberately absent from that table (G10; its byte-stability is grammar-m3-red). Therefore, if an
implementer follows D2.4's **literal** table list — `COMMAND_CAPABILITY` (`:87-94`) +
`ARG_FIELDS`/`ACCEPTED_ARG_FIELDS` (`:112-148`) + `APPLICATION_COMMAND` (`:149-151`) — but not
`WEB_DIRECT_PORT_COMMANDS` (`:62`, derived from `WAVE_WEB_ENTRIES` **only**), every append envelope
is refused `application_command_arguments_invalid`. The verb is advertised (capability + command
map) and dead (validator refusal): a #157 ghost, the exact failure mode the contract's header
swears to refuse. **A3's own assertion lists the same three tables and omits
`WEB_DIRECT_PORT_COMMANDS`**, so the pin would certify a ghost state.

Fix: D2.4 and A3 must explicitly require `run_scratchpad_append ∈ WEB_DIRECT_PORT_COMMANDS`
(extend the `:62` derivation, or add the transport to the set), and A3 should assert a dispatched
envelope (not merely "not refused `unsupported command`").

### H2.2 — MCP admission omits the `_dispatch` branch: the #157 ghost on MCP (blocker)

MCP tools that are **not** `APPLICATION_COMMAND_DEFINITIONS`-backed (not in `APPLICATION_TOOL`,
`mcp-northbound.mjs:33-47`) must have an explicit branch in the `_callTool` dispatch chain. The
read/elevate tools do (`mcp-northbound.mjs:1900-1909`, routing to
`this.application.command('run.scratchpad.read'|'run.scratchpad.elevate', ...)`). D2.3 lists four
admission points — tool definition (`:652-668`), capabilities (`:114-115`), validateArguments
(`:1178-1193`), `ORDINARY_EXPLICIT_TOOLS` (`:822-829`) — but **not** the `_dispatch` branch. A
`baton_run_scratchpad_append` with the four listed points but no dispatch branch falls through the
chain with `value` unset → toolError/undefined: advertised (defined + capability), dead (cannot
dispatch). A second ghost.

Fix: add `else if (name === 'baton_run_scratchpad_append')` to the `_dispatch` chain next to the
read/elevate branches, calling `this.application.command('run.scratchpad.append', { runId, scope,
kind?, body, idempotencyKey? }, connection-principal, applicationDispatchContext)`.

### H2.3 — CLI parser underspecifies non-note bodies

D2.2 says `--body TEXT` required. For `plan`/`doubt`/`link` the body is a JSON value per the
kernel's closed per-kind shapes (D2.1, `coordination-store.mjs:607-696`). The CLI needs a JSON
parse + shape-validation step and a named refusal for a malformed body; the contract names neither
(only A1 exercises `--kind note`). Minor HOLE.

Fix: specify the CLI body handling for non-note kinds (JSON parse → `cli_invalid` naming the
expected shape), or restrict the CLI surface to `note` and let MCP/web carry structured bodies.

### H2.4 — `ORDINARY_EXPLICIT_TOOLS` framing nit

D2.3 says add the tool "so it is admitted (not just defined)". Verified: `ORDINARY_EXPLICIT_TOOLS`
(`mcp-northbound.mjs:822-829`) is the **typed-failure-mapping** lane (`:1530`), not the admission
set — a tool is admitted by being in `TOOL_DEFINITIONS` (`:830`). The contract's *intent* (append
refusals reach the typed `stateFailureCode` lane, never generic `command_failed`) is correct and
important; the word "admitted" is loose. Not a blocker.

### D2 verdict

HOLE — two #157 ghost traps (H2.1 web `WEB_DIRECT_PORT_COMMANDS`, H2.2 MCP `_dispatch`) that the
contract's own #153/#157 discipline exists to prevent, plus one underspecified CLI body path
(H2.3). CLI admission (parser + `CLI_WEB_COMMANDS` + registry row + direct-port branch) is
complete as specified.

---

## 4. D3 — bounds, rate/replay, elevate interaction: **HOLE** (one replay gap, one starvation)

The byte bound (limits.mjs:71, 8192/2048 steering split `:14073-14077`/`:623-626`), partition
caps (128/512, `:524-525`), the `scratchpad.entry_written` event (`:14148`), and the elevate
interaction (elevatable per `:14173+`; `elevateWhenNotes` at `workflow-interpreter.mjs:248-258,
877-908`) are all verified and correctly cross-referenced. Two holes:

### H3.1 — the replay binding omits `scope` for the multi-scope verb (blocker)

The kernel `_byKey` replay (`coordination-store.mjs:14086-14102`) binds
`{kind, actor, runId, taskId, workerId, contentDigest}` — **not `scope`**, which is derivable from
`workerId` today because the kernel hardcodes `worker:${fields.workerId}` (`:14103`). The contract
gives the verb two target scopes (worker vs shared) and states "the surface replay IS the kernel
replay — no second layer" (D3). A caller-supplied idempotency key first used for a `shared` append
and then for a `worker:<ownId>` append (or vice-versa, same content) would replay as `idempotent`
against the prior binding and return the prior receipt **with the wrong scope** — the shared write
silently dropped, or the worker write reported as shared. The OQ2 derived-key shape
(`run.scratchpad.append:<runId>:<scope>:<contentDigest>`) namespaces by scope but only covers the
**absent**-key case; the caller-supplied-key case carries the key verbatim to `auth.key` and is
unprotected.

Fix: the shared-write kernel path must add `scope` to the `_byKey` binding, or the surface must
namespace the caller-supplied key by scope (e.g. `auth.key = \`${callerKey}:${scope}\``) before
the kernel auth — and the contract should pin which.

### H3.2 — shared-tier starvation (see H1.4)

A member can fill the shared tier to its cap, refusing the review authority's mandated shared
writes (`scratchpad_partition_exhausted`, `coordination-store.mjs:14238-14240`). The spam
discipline names no ranking. Fix as in H1.4.

### D3 verdict

HOLE — the replay claim is over-broad for a two-scope verb (H3.1), and the shared cap's
exhaustion by one member starves the review authority (H3.2). The byte/partition bounds and the
"no clocks / no new caps" discipline are respected.

---

## 5. D4 — the bare-`run scratchpad` trap: **SOUND**

Verified the trap is real and live: `sub === undefined` (and any unknown subverb) falls to
`throw cliError(\`unexpected argument ${sub}\`)` (`application-cli.mjs:1511`), producing
`unexpected argument undefined` (E-11/F-9, `surface-audit-cli.md:167,351-360`; unknown subverb
E-14, `:170`). `cliError` defaults to `cli_invalid` (`application-cli.mjs:50`), so the contract's
"exit class `cli_invalid`" for the teaching refusal is exactly right. The closed-set teaching
(`read|elevate|append`) is the correct coaching form and never leaks `undefined`.

One ordering dependency (not a hole): the D4 message names `append` — the message and the parser's
`append` branch must land in the same rung, or the refusal would advertise a subverb the parser
cannot serve (a miniature ghost). The contract is red-first and this is implied, but a reader
should not ship the message first.

---

## 6. Refusal vocabulary: **SOUND**

Every reused code was verified at its cited source: `application_unauthorized`
(`application.mjs:3222`), `scratchpad_write_invalid` (`coordination-store.mjs:14068`),
`scratchpad_entry_invalid` (`:615`), `scratchpad_entry_exceeded` (`limits.mjs:71`),
`scratchpad_partition_exhausted` (`:14106-14107` worker / `:14238-14240` shared),
`scratchpad_write_conflict` (`:14091`), `stale_scratchpad_fence` (`tight-cell-contract.md:817` +
the store's fence CAS in the elevate path), `run_stopping` (`coordinator.mjs:10837` allowed set;
thrown by the store, e.g. `coordination-store.mjs:2842`). The two new codes
(`application_scratchpad_append_invalid` normalizer, `invalid_scratchpad_append` MCP validator) are
the correct siblings of `application_scratchpad_read_invalid` (`application.mjs:12876`) and
`invalid_scratchpad_read`/`invalid_scratchpad_elevate` (`mcp-northbound.mjs:1184,1195`). Using
`application_unauthorized` as the D1 typed code (no new code for the law) matches the D1.2
sibling-refusal leg (`contract-fold.md:419`).

One caveat: the refusal vocabulary's `stale_scratchpad_fence` and `scratchpad_partition_exhausted`
(shared) rows only exist on kernel paths that are **orchestrator/worker-only today**; a member
shared-append reaching those codes requires the unlanded shared-write kernel path. That is
consistent with a Ring-2 spec but worth a one-line note.

---

## 7. Acceptance pins — verdicts

| Pin | Verdict | Note |
|---|---|---|
| A1 | RED ✓ / GREEN ⚠ | RED is honest (no append branch). GREEN's receipt `scope:'shared'` depends on the **unlanded** tight-cell shared-write kernel path (RED at HEAD, `tight-cell-contract.md:808`); the pin does not state that kernel dependency. |
| A2 | RED ✓ / GREEN ✘ | GREEN omits the `_dispatch` branch (H2.2) — as specified, the tool is advertised-but-dead. |
| A3 | RED ✓ / GREEN ✘ | GREEN's table list omits `WEB_DIRECT_PORT_COMMANDS` (H2.1) — as specified, a ghost. |
| A4 | RED ✓ / GREEN ⚠ | Cross-partition refusal is right, but the pin never tests the cross-*run* case (H1.1) — a sibling-run `shared` write is not covered by "no entry is minted." |
| A5 | RED ✓ / GREEN ⚠ | Correct posture, but "appends to shared resolve" is false once a member fills the shared cap (H1.4). |
| A6 | RED ✓ / GREEN ⚠ | "Never mints a KG candidate" is true for the append; the pin does not test the write→elevate path (H1.2), so the *overall* candidacy guarantee is unasserted. |
| A7 | RED ✓ / GREEN ⚠ | The 129th-worker / 513th-shared assertions require the shared-write kernel path; fine for a spec, but the pin reads as a surface assertion and bundles an unstated kernel change. |
| A8 | RED ✓ / GREEN ✘ | Does not test same-key-different-scope replay (H3.1). |
| A9 | RED ✓ / GREEN ✓ | D4 refusal is fully specified and implementable at the parser (`application-cli.mjs:1511`). |
| A10 | RED ✓ / GREEN ✘ | The coherence the pin asserts is exactly what H2.1/H2.2 break: the web and MCP admission lists are incomplete, so the "no surface where the verb is advertised-but-dead" claim would be false as specified. |

---

## 8. Open questions — verdicts

- **OQ1** (web read/elevate admission): SOUND as an out-of-scope decision; the WRITE-half-only
  posture is defensible (the #147 failure was the write half).
- **OQ2** (idempotency-key derivation when absent): the candidate shape includes `scope`, good —
  but the OQ as written covers only the absent-key case; the caller-supplied-key cross-scope
  collision (H3.1) is not addressed. Should be folded into the D3 fix.
- **OQ3** (bare parent row's `cli` surface claim): SOUND; retaining the row as the grouping node
  is coherent once D4 teaches the closed set.
- **OQ4** (2048/8192 steering split): SOUND; the kernel's single refusal + a doc note is the right
  resolution and matches the verified kernel behavior (`coordination-store.mjs:623-626,14073-14077`).

---

## 9. Final verdict: **NOT FOLD-READY** — numbered blockers

1. **Web admission omits `WEB_DIRECT_PORT_COMMANDS` (H2.1 / A3).** *What:* D2.4 and A3 list
   `COMMAND_CAPABILITY` + `ARG_FIELDS`/`ACCEPTED_ARG_FIELDS` + `APPLICATION_COMMAND` but not
   `WEB_DIRECT_PORT_COMMANDS` (`web-northbound.mjs:62`); the `:414` gate then runs
   `validateApplicationCommandArgs`, which throws `application_command_unavailable` for any
   non-`APPLICATION_COMMAND_DEFINITIONS` command (`application.mjs:1846-1847`). *Why:* every
   append envelope is refused `application_command_arguments_invalid` — a #157 ghost, the exact
   anti-pattern the contract refuses to create. *Fix:* require `run_scratchpad_append ∈
   WEB_DIRECT_PORT_COMMANDS` (extend the `:62` derivation) and update A3 to assert a dispatched
   envelope.
2. **MCP admission omits the `_dispatch` branch (H2.2 / A2).** *What:* D2.3 names tool def,
   capabilities, validateArguments, `ORDINARY_EXPLICIT_TOOLS` — but not the
   `else if (name === 'baton_run_scratchpad_append')` branch the read/elevate tools have at
   `mcp-northbound.mjs:1900-1909`. *Why:* an advertised tool with no dispatch branch is dead on
   MCP — a second ghost. *Fix:* specify the dispatch branch routing to
   `application.command('run.scratchpad.append', ...)`.
3. **The "own run" predicate is unenforced (H1.1).** *What:* the append restrictor (as specified)
   ignores `request.runId`, and the kernel `writeScratchpad` does no run-membership check; `runId`
   is a required caller-supplied arg (D2.1). *Why:* a member can append to `shared` or
   `worker:<ownId>` of a foreign run — the D1 law-2 "outside its own run is refused" is stated but
   not delivered. *Fix:* derive `runId` server-side from the principal's active task, or bind the
   run in the restrictor/kernel, and pin it.
4. **Write→elevate self-escalation is open (H1.2).** *What:* `application-deployment.mjs:1731`
   authorizes every command except `run.scratchpad.read`; `run.scratchpad.elevate` is a pre-gate
   direct port (`application.mjs:12523`) with a permissive authorize, so a member can elevate its
   own task's entries and mint a KG candidate. *Why:* law-4's "elevation remains the promotion
   law" / "never a candidacy shortcut" is unenforced at the seam — the append verb turns it into a
   single-surface write→elevate flow. *Fix:* restrict the elevate authorize (orchestrator/own-task)
   in the same rung, or explicitly scope the gap out and weaken the claim.
5. **Replay binding omits `scope` (H3.1 / A8).** *What:* the kernel `_byKey` binding
   (`coordination-store.mjs:14086-14102`) has no `scope` term; the surface passes the caller's key
   verbatim to `auth.key`. *Why:* a same-key cross-scope retry replays against the wrong binding
   and returns a receipt with the wrong scope — the "surface replay IS the kernel replay" claim is
   false for a two-scope verb. *Fix:* add `scope` to the kernel binding or namespace the surface
   key by scope; pin which.

Non-blocking (fix or explicitly scope out): H1.3 (shared-append provenance un-pinned), H1.4/H3.2
(member fills the shared cap → review-authority shared writes starve; A5), H2.3 (CLI non-note JSON
bodies underspecified), and a note that A1/A3/A6/A7 GREEN all depend on the **unlanded** tight-cell
shared-write kernel mechanism (`tight-cell-contract.md:808` "today: orchestrator elevation only"),
which this contract names but does not specify — acceptable for a Ring-2 spec only if the pins'
GREEN conditions state the kernel dependency.
