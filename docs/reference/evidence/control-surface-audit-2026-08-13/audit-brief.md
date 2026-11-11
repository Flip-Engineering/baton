# CONTROL-SURFACE AUDIT — shared frame (issue #147, #74-pattern dogfood wave)

Every member reads this first. Baton has three agent-facing control surfaces. Your job is a
ruthless, evidence-cited audit of ONE of them (your row brief says which), written for the
orchestrator who drives baton all day.

## The audit axes (every row, same axes)

1. **Parity** — what can be done on YOUR surface, in a table; mark each capability's parity on
   the other two surfaces only where your reading of the code makes it obvious (the coordinator
   owns the full cross-surface matrix).
2. **Discoverability** — could a fresh agent learn this surface from the surface itself
   (help verbs, advertised actions, typed refusals that teach)? Note every place an agent must
   ALREADY KNOW an incantation (digest-keyed actionIds, cursor rules, envelope field names,
   connection-profile dance) that the surface never states.
3. **Error actionability** — sweep the refusal/error vocabulary your surface emits: does each
   name the field/class and the next action (#41-pattern, #139)? Cite `file:line` for each
   refusal site you judge.
4. **Grammar consistency** — command/tool naming, argument shapes, idempotency rules,
   pagination/cursor conventions. Note every inconsistency WITHIN the surface.
5. **Steering fitness** — can an orchestrator OBSERVE (status, waitingOn, progressClass) and
   STEER (nudge, message, answer, stop) entirely through your surface? What is missing?

## Laws

- Every claim cites `file:line` read THIS session. NUL files (`application.mjs`,
  `coordination-store.mjs`): `grep -an`/`sed -n` only. No clocks. Read-only outside your own
  deliverable file.
- Frictions are ranked by orchestrator cost (hours lost, mistakes induced), each with a concrete
  surface-level fix and a cross-reference to an existing issue where one exists (#10, #91,
  #135, #136, #137, #138, #139, #140, #146) or marked NEW.
- **Escalation posture:** authority-class ambiguity (anything the brief does not cover that
  would change the audit's meaning) → DECISION_REQUEST with 2–4 options plus free response.
  Style-class judgment calls → decide, record the decision in your report.
- **Shared-layer law:** your final report ALSO goes to the `shared` scratchpad partition in
  full (the coordinator reads it there). Use your worker-facing scratchpad write; the
  coordinator reads via the shared lane. Your report FILE is the durable artifact.

## Deliverable shape (rows)

`surface-audit-<surface>.md`: parity table → discoverability findings → error-quality sweep →
grammar findings → steering-fitness gaps → ranked friction list (each: evidence, cost, fix,
issue cross-ref). Start the file with the marker line `SURFACE-AUDIT-ROW v1` on line 1.
