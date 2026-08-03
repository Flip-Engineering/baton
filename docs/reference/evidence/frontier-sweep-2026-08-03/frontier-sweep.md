# THE FRONTIER SWEEP — one interrelated campaign across the planned frontier (2026-08-03)

(Operator direction: scope and spec a large body of interrelated, transformative work,
deployable as a parallel, subtask-decomposable wide-sweep; then proceed logically through
it — driving real swarms recursively/reflexively through baton, testing and developing
baton, and QA-feeding back. Primary implementation seat: deepseek-v4-flash@high — the
converged verdict of the operator and the orchestrator: it is the best implementer in the
fleet right now (three one-shot epics, all gate-green, at a fraction of every other
seat's cost).)

## The frontier as ONE system

The open frontier is not a list — it is a stack. Every item below either carries the
collaboration spine or is carried by it. The sweep executes the stack bottom-up with
maximum parallelism inside each layer.

```
LAYER 3  THE PATTERN      #74 worker-orchestrated swarms (the demo that proves the stack)
                            └─ consumes: L1 spine + #78 substrate + #81 orientation
LAYER 2  THE CONSUMERS    #78 board worker-half · #81 orientation · #47 readiness · #67 watchdog
                            └─ all ride: L1 (BD3) — parallelizable with each other
LAYER 1  THE SPINE        BD3: read port · context objects · message lane · attention inbox
                            └─ rides: L0 surfaces (MCP/reflex table conventions)
LAYER 0  THE SURFACE      MCP+packaging (wave tools, settlement tools, descriptor, npm)
                            └─ IN FLIGHT (deepseek implementation, bash-ft1n2ies)
```

Plus the CONTINUOUS lane (QA/feedback): every landing gets a downstream worker review +
issue fold — the QA loop that produced #56-61, #78-80 and the BD3 scope itself.

## The lanes (parallel inside each layer, serialized between layers)

### Lane S — the spine (BD3, #75) — CRITICAL PATH
- red-team wave: RUNNING (codex authority + glm lifecycle, `bd3-redteam-2026-08-03`).
- Then: fold → red-first suite (orchestrator-written) → blue-team → implementation wave
  (deepseek seat) → acceptance: a coordinator-worker reading/steering/messaging through
  the spine live.
- Absorbs: #68 (BD3-A), #69 (BD3-B), #79 (BD3-C delivery push), #71 (BD3-D inbox).

### Lane A — board worker-half (#78)
Small epic: board.claim/report surfaces + worker-scoped board reads + the waves.send
claim grant. Contract light (S-2's envelope conventions), suite, implement (deepseek).
Depends on: L1 (the read/message conventions it joins). Feeds: #74's triage loop.

### Lane B — orientation (#81, O-1+O-2)
Medium epic: code.orient ladder (map/region/detail) + investigation receipts as
knowledge. Seat: glm (its cartographer-adjacent reasoning has been strongest).
Depends on: L1 (BD3-B packs, BD3-A lane). Feeds: #74's decomposition quality.

### Lane C — readiness + credentials (#47 + #83 + #84)
Small-medium epic: bounded actual-inference readiness tier per route (seat: deepseek),
the fleet.roster seat inventory it feeds (#83), and the programmatic credential
controllers (#84 — grok OIDC refresh grant on the #11 pattern, Claude v3.1 runtime
shape, doctor findings on refresh-token rotation). One lane because they are one
feature seen three ways: the controller keeps seats alive, the tier measures their
liveness, the roster projects both. Depends on: L0 (the doctor tool). Feeds: every
wave launch forever.

### Lane D — event-based liveness (#67 + #80)
Small epic: watchdog redesign per the control law — event-vocabulary liveness
(provider activity, receipt classes, process lifecycle), count-based unanswered-cycle
bounds, clock as last-resort only. Seat: deepseek. Depends on: nothing new (TG3/TG2
machinery exists); pairs with L1's wake semantics.

### Lane F — browser-use (#85: BU-2 research workers + BU-1 web QA)
Medium epic, two rungs: BU-2 the research worker class (browser-use workers with
analysis:true producing provenance-receipted findings — every fetch/click a
hub-admitted receipt event, becoming TG2 progress evidence, audit trail, and KG
grounding with content-addressed sources; findings flow the candidacy gate: external
research becoming project knowledge); BU-1 the web-surface QA lane (a browser-use
reviewer capability driving baton's own web surfaces into Lane E). Capability-adapter
posture with honest-empty (the ATLAS pattern; opensource engine as optionalDep,
greenfield-minimal adapter contract on top). Depends on: L1 (the receipt/lane
conventions), TG5 (analysis legitimacy). Feeds: the KG's provenance depth and Lane E's
QA coverage. Seat: codex (authority discipline for the injection-boundary rung) for
BU-2's contract, deepseek for implementation.

### Lane E — QA/feedback (continuous)
Per landing: downstream review wave (rotating seats), issue fold, ledger entry,
tracker/issue hygiene. Also: the #74 demo itself when L1+L2 land.

## The recursive/reflexive execution shape (how the sweep eats itself)

1. **Every epic lands through the campaign methodology** (contract → adversarial
   red-team by wave → fold → orchestrator-written red-first suite → blue-team →
   implementation by wave worker → acceptance → canonical gate → baton-commit → push).
   Orchestrator edits only tight machinery follow-ups + test suites.
2. **The #74 pattern is first exercised ON the sweep itself**: when L1 lands, a GLM
   coordinator member decomposes Lane B's orientation contract into granular
   sub-spec/test rows as context-packs (BD3-B); a deepseek+grok swarm executes the rows;
   the coordinator triages through board.claim/report (#78) and escalates big questions
   to the orchestrator through DECISION_REQUEST. The pattern is proven on real work,
   not a toy.
3. **QA feeds back continuously**: downstream reviews per landing; every friction
   becomes an issue; every issue joins the sweep's lanes or the backlog with a stated
   dependency, never a pile.
4. **Fleet seats by current truth**: deepseek = primary implementer; glm = review/
   lifecycle/orientation; codex = authority red-team + S-2-class authority work;
   sonnet/opus = epic-scale reserves (opus when a seat must reason across the whole
   trust boundary); grok = opportunistic (verify per launch — its 28-min TTL pattern
   makes it unreliable for long implementation turns until #47 lands).

## Definition of done for the sweep

- L1 spine landed and live-demonstrated (a worker reads the KG/board/shared layer
  through BD3-A; an orchestrator passes a context-pack (BD3-B); receipts on both
  streams of a typed message (BD3-C); the driver runs wake-only on the inbox (BD3-D)).
- L2 lanes each landed with their suites green and one live demonstration each.
- #74 demonstrated end-to-end: GLM coordinator decomposes a real epic into packs, a
  deepseek+grok swarm executes against board claim/report, escalation reaches the
  orchestrator through the live decision gate, and the outcome is a landed epic rung
  (not a demo artifact).
- The QA loop closed per landing; the canonical gate green throughout.
