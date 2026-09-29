// The host half of the wake-delivery witness (laws-wake-delivery.bend).
//
// Each adapter fixture replays one real coordination row, and this file derives that row's ROUTING
// metadata with the deployment's own wake derivation: impl/src/wake-stream.mjs, required from the
// checkout the program runs in (process.cwd()), the mechanism laws-transition.js uses for
// swarm-state.mjs and host-capacity.mjs.
//
// Routing is metadata, not delivery. A row that derives no participantId is task-addressed here;
// that says where the frame is routed, never that a seat's orchestrator was or was not reached.
//
// The effect contract: the function name is the def name lowercased with dots as underscores, a
// Nat arrives as a BigInt, and the answer is a U32 read as a number:
//   0 seat-addressed  the derived frame carries the seat's participantId
//   1 task-addressed  the derived frame carries no participantId
//   2 no-frame        the runtime derives no wake frame for the row at all
//
// The three rows are the ones the runtime itself writes: `turn.paused` is the turn-end park's own
// row (impl/src/runtime-admission.mjs, payload {taskId, turnEpoch, changedPathsDigest, origin}),
// `swarm.resume_decision_requested` is the recovery row that asks the seat's orchestrator to
// decide, and `task.paused` is the park's coordination transition row. Payload values are
// placeholders: this file measures the derivation's SHAPE, not a live resident's row.
function real_adapter_routing(index) {
  const { wakeClassFor, deriveWakeFrame } = require(process.cwd() + "/impl/src/wake-stream.mjs");
  const rows = [
    { kind: "turn.paused", payload: { taskId: "task-1", turnEpoch: 1, changedPathsDigest: "d",
        origin: { kind: "turn_completed", resultStatus: "completed", summary: null } } },
    { kind: "swarm.resume_decision_requested", payload: { swarmId: "sw1", participantId: "p1" } },
    { kind: "task.paused", payload: { taskId: "task-1", pauseId: "pause:task-1:7" } },
  ];
  const row = rows[Number(index)];
  if (row === undefined) return 2;
  if (wakeClassFor(row) === null) return 2;
  const frame = deriveWakeFrame(row, new Map(), null);
  if (frame === null) return 2;
  const addressed = typeof frame.participantId === "string" && frame.participantId.length > 0;
  return addressed ? 0 : 1;
}
