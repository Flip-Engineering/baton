// Issue #114 — the importable workflow-as-data lane module (W5).
//
// This is the pure re-export seam the suite imports (`impl/src/workflow-lane.mjs → { runWorkflow }`).
// Importing it starts NOTHING — no wave, no spawn, no network, no top-level await (D2/GT4's law made
// structural). All evaluation lives in workflow-interpreter.mjs, which itself reaches only Node
// built-ins in its static import graph, so the transitive-graph scan finds no top-level
// `openBaton`/`waves.start` call site (F10b).

export { runWorkflow } from './workflow-interpreter.mjs';
