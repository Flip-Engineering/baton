# #74 COMM-TOPOLOGY AUDIT BRIEF — verify the swarm communication channels (post-contract audit, distinct from the red-team)

You are the COMMUNICATION-TOPOLOGY AUDITOR for the worker-orchestrated swarm contract. This is
NOT the adversarial red-team (that attacks design soundness); your job is narrower and later:
verify the contract establishes every communication channel the sub-orchestrator needs to run
tightly-coupled AND loosely-coupled swarms, and that each channel is real in the shipped/lane
machinery (not aspirational). Read fully, in order: (1) `worker-orchestrated-swarm-contract.md`
(v1.0 or folded); (2) the coupling vocabulary: the operator's tight/loose coupling direction and
the #102 tight-cell contract (`docs/reference/evidence/frontier-sweep-2026-08-03/` — the
tight-cell contract artifacts; tight cells behave as a single unit with deeper/overlapping
shared context; loose members keep fully distinct contexts); (3) the communication machinery as
it ACTUALLY SHIPS: the message lane (#86/#92, MESSAGE_SEND scanner), reply chains (#105 — in the
impl queue; mark as target-state where used), the decision lane (DECISION_REQUEST escalation,
proven in the #94 demo), the attention inbox + waitingOn (#10 landed), the board (#78), the
scratchpad + elevation (#33), context packages (mintContextPack), the REPL objects (#69 — in
chain), the #71 orchestrator wake (in chain), the #132 wave observability (landed).

## The audit matrix (answer every cell with VERIFIED / GAP / TARGET-STATE, citing file:line or the contract section)

1. **Top orchestrator → sub-orchestrator** (unidirectional down): the mission brief, scope, and
   steering nudges — through what channel, with what receipts?
2. **Sub-orchestrator → top orchestrator** (bidirectional up): DECISION_REQUEST escalation
   (live gate), status/progress visibility, and the honest "I'm stuck" — what surfaces them and
   does the top orchestrator get WOKEN (the #71 lane's posture for a sub-orchestrator)?
3. **Sub-orchestrator → swarm members** (unidirectional down): row assignments/briefs to many
   members — boards? messages? context packages? Is the fan-out receipted per member?
4. **Swarm members → sub-orchestrator** (bidirectional up): results, doubts (#66's lane),
   blockers, and follow-up questions — do workers get reply chains (#105) or only one-shot
   sends? Can a member ask the sub-orchestrator a clarifying question and get an answer WITHOUT
   escalating to the top?
5. **Within a tightly-coupled cell**: the deeper shared context — what carries it (shared
   scratchpad partition? shared context package? REPL shared object #69)? Is the cell's
   single-unit presentation to the sub-orchestrator (one collector, per #102) compatible with
   the channels above?
6. **Loosely-coupled members**: fully distinct contexts — prove no bleed (a loose member never
   reads another's scratchpad/context).
7. **Steering mid-flight**: can the top orchestrator redirect the sub-orchestrator AND a swarm
   member mid-work (message/send + the wave-driver steering vocabulary) with receipts?
8. **The authority boundary**: every channel the sub-orchestrator may NOT use (wave start/stop,
   direct worker control) — is the refusal typed and receipted?

## Output

`docs/reference/evidence/worker-orchestrated-swarm-2026-08-13/comm-topology-audit.md`: the
matrix, every cell VERIFIED (file:line) / GAP (what's missing + the concrete seam that would
close it) / TARGET-STATE (named, with the owning issue). Close with the topology verdict:
SWARM-READY / NOT-YET (with the minimal gap list). Edit ONLY that file. Laws: no clocks; every
citation verified (`grep -an`/`sed -n` on the two NUL files).
