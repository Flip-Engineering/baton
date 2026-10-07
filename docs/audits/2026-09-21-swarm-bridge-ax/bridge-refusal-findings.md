# Swarm-bridge refusal AX — findings from a recruited seat's first minutes (issue #43)

Audit date: 2026-09-21. Scope: the swarm bridge's argument-refusal behavior as experienced by a
recruited seat (mcp-lead2, swarm-mcp-20260921) on its first three commands. Recorded at the root
orchestrator's direction under issue #43's AX audit. Files under change:
`impl/src/swarm-contract.mjs`, `impl/src/swarm-runtime.mjs`, `impl/src/swarm-native-bridge.mjs`,
`impl/test/swarm-surface.test.mjs`, `impl/test/issue441b-seat-read-verbs.test.mjs`.

Method: the seat's own live refusals, quoted verbatim with the ledger seq that recorded them, then
the source seam each crossed (`validateSwarmCommand`, `impl/src/swarm-contract.mjs:876-881`;
`validateSwarmKnowledgeCommand` / `validateSwarmSeatReadCommand`,
`impl/src/swarm-runtime.mjs:1196-1202` and `:1330-1336`; the remedy derivation `refusalChange`,
`impl/src/swarm-native-bridge.mjs:139-160`).

## R1, R2 — a required-field refusal names one field per attempt (surface fault, fixed)

The seat called `swarm.guide` with no arguments, then with `{"participantId":"mcp-lead2"}`. Two
refusals, two ledger rows:

- seq 7135 — `swarm.guide` `{}` → `swarm_command_invalid`, `detail: {field: "participantId",
  rule: "required-field", expectation: "a participant identity"}`, rendered remedy
  `add participantId (a participant identity)`.
- seq 7165 — `swarm.guide` `{"participantId":"mcp-lead2"}` → `swarm_command_invalid`,
  `detail: {field: "message", rule: "required-field", expectation: "non-empty text"}`, rendered
  remedy `add message (non-empty text)`.

The validator's required-field loop threw on the first missing field; `shape.required` was fully
known at validation time. Learning N required fields cost N round trips — each one a durable
refusal row on the swarm record and a `lastRefusal` on the caller's participant row. The
payload-level refusal one function away (`payload-required`,
`impl/src/swarm-contract.mjs:916-921`) already names the whole missing set in one refusal; the
top-level loop did not.

Fix: all three shape validators (`validateSwarmCommand`, `validateSwarmKnowledgeCommand`,
`validateSwarmSeatReadCommand`) collect every missing required field before refusing. The refusal
message names the whole set; `detail.required` carries it; the first missing field stays
`detail.field` so the singular message and detail keep their recorded shape. The bridge's
`refusalChange` renders the plural remedy from `detail.required`. One refusal now reads:

```
swarm.guide request is invalid: participantId, message are required
```

Regression pins: `impl/test/swarm-surface.test.mjs` (contract validator, plural and singular
shapes) and `impl/test/issue441b-seat-read-verbs.test.mjs` (seat-read validator).

## R3 — an unknown-field refusal carries its own fix (no change)

The seat called `run.contributions.read` with `{"sinceSeq":0}` — a guessed field name. Refusal at
seq 7203: `swarm_command_invalid`, `rule: "unknown-field"`, `field: "sinceSeq"`,
`admitted: ["since", "swarmId"]`, `correction: "remove sinceSeq — run.contributions.read accepts
since, swarmId"`, rendered remedy `remove sinceSeq`. The next call named `since` and succeeded.
The refusal named the rule, the admitted set, and the exact correction in one round trip. This is
the designed teaching refusal (#430); no change. It is recorded here as the in-tolerance control
beside R1/R2: the same caller, the same surface, one round trip from mistake to fix.

## R4, R5, R6 — the root orchestrator's reported refusals (2026-09-21, same batch)

**R4 — `swarm integrate` demanded a target the CLI called optional.** `baton swarm integrate
<SWARM> <CONTRIBUTION>` refused `swarm_command_invalid: target is required` while the CLI usage
rendered `[--onto]`, and the refusal named the internal field, never the flag. The landing now
derives an omitted target from the deployment's own branch — the ONE derivation the #438 target
facts read (`targetRefOf`, `impl/src/swarm-runtime.mjs:896-899`) — which is what every landing
receipt already names; the contract moves `target` to optional
(`impl/src/swarm-contract.mjs`, SWARM_COMMAND_ARGUMENTS) and the CLI usage tells the truth.
Regression pin: `impl/test/issue459-integrate-off-loop.test.mjs` (459h).

**R5 — a request-bound-cut landing answer hinted a held wait.** The pending observation for
`swarm.integrate` printed `--follow` — a held wait, the pattern the swarm's own guidance bans —
when the receipt is readable from the view with no wait at all. The observation hint now teaches
the bounded read: `baton swarm view <SWARM>`
(`impl/src/application-cli.mjs`, `commandObservation`). Regression pin: `impl/test/issue353-stop-of-dead-seat-settles.test.mjs` (353d3).

**R6 — a resume-from recruit refused without naming its precondition.** `swarm recruit
--resume-from X` after `swarm stop X` crossed `invalid_command: command precondition failed` —
no field, no rule, no statement of which precondition failed. Two layers:
the web layer's name-based collapse arm
(`impl/src/web-northbound.mjs`, dispatchFailure) now lets a cause that carries its own code cross
with that code and message (the #335 composed-teaching rule), so a coded precondition refusal
keeps its identity; and the recruit help now states which predecessor states resume-from accepts —
active, provider-killed (`provider_fault`), or root-settled (`stopped`/`completed`) with a
carriable workspace (a retained checkout or a lane-branch snapshot) — the same closed set
`SWARM_RESUMABLE_PREDECESSOR_STATES` (`impl/src/swarm-runtime.mjs:850-855`) teaches at the
refusal. Removing the stray duplicate `'swarm.recruit'` key in SWARM_CLI_SUMMARIES also fixes the
pre-existing shadowing that had replaced the recruit help's description paragraph with its
positional list. Regression pin: `impl/test/swarm-surface.test.mjs` (the recruit summary pin).

## Verification

`node --test impl/test/swarm-surface.test.mjs impl/test/issue441b-seat-read-verbs.test.mjs
impl/test/swarm-native-bridge.test.mjs impl/test/issue430-swarm-refusal-set.test.mjs
impl/test/issue537-capture-refusals-typed.test.mjs impl/test/issue473-stop-incomplete-typed.test.mjs
impl/test/issue459-integrate-off-loop.test.mjs impl/test/issue353-stop-of-dead-seat-settles.test.mjs
impl/test/doc-truth-conformance-red.test.mjs` — green after the fixes, including the pre-existing
pin that the bridge reports `required-field` among its refusal rules
(`impl/test/swarm-native-bridge.test.mjs:391-392`) and the #430 (b) crossing harness that drives
every owner row through the served transport.
