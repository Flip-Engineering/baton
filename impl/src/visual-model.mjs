/**
 * visual-model.mjs — the bounded, deterministic `baton.visual_model` projection.
 *
 * Contract: docs/38-flip-visual-surfaces.md. The model is a pure projection over the
 * existing Run, story, event, attention, readiness, route, worker and convergence
 * authorities (P1: structure first, presentation second). It is not an authority: it
 * never invents worker state, moves cursors, or derives fate from wall time.
 *
 * Provenance law P2: hub facts and worker/provider prose never look identical. Events
 * whose actor is a worker carry provenance 'worker_prose' with the ANSI-stripped
 * message; every other event carries provenance 'fact'. Control bytes are stripped
 * before projection so the JSON is control-byte-free.
 *
 * Bounding: fleet.members and timeline are both capped at 64 (the timeline keeps the
 * latest events). Identical inputs project to an identical sha256 fingerprint of the
 * canonical (key-sorted) model.
 */

import { createHash } from 'node:crypto';

export const VISUAL_MODEL_KIND = 'baton.visual_model';
export const VISUAL_MODEL_VERSION = 1;
export const MAX_FLEET_MEMBERS = 64;
export const MAX_TIMELINE_ITEMS = 64;

// ANSI CSI sequences: ESC '[' params? final-byte (0x40-0x7E). Also strip any stray ESC
// and every remaining C0 control except tab/newline/CR (those survive as JSON escapes).
const ANSI_CSI_RE = /\u001b\[[0-9;:<=>?]*[ -/]*[@-~]/g;
const STRAY_ESC_RE = /\u001b/g;
const C0_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function stripControlBytes(value) {
  return String(value)
    .replace(ANSI_CSI_RE, '')
    .replace(STRAY_ESC_RE, '')
    .replace(C0_CONTROL_RE, '');
}

function projectRun(runValue) {
  return {
    runId: runValue?.runId ?? null,
    phase: runValue?.phase ?? null,
    objective: runValue?.objective ?? null,
    narrative: runValue?.narrative ?? null,
    progress: runValue?.progress ?? null,
  };
}

function projectStory(snapshotStory, runValue) {
  return {
    source: 'story_compiler',
    narrative: snapshotStory?.narrative ?? runValue?.narrative ?? null,
    signals: Array.isArray(snapshotStory?.signals) ? snapshotStory.signals : [],
  };
}

function projectFleet(workstreams) {
  const members = (Array.isArray(workstreams) ? workstreams : [])
    .slice(0, MAX_FLEET_MEMBERS)
    .map((ws) => ({
      workerId: ws.workerId ?? null,
      role: ws.role ?? null,
      state: ws.state ?? null,
      task: ws.task ?? null,
      route: ws.route ?? null,
      warnings: ws.warnings ?? null,
      budgetUsed: ws.budgetUsed ?? null,
      budget: ws.budget ?? null,
      pathScope: ws.pathScope ?? null,
    }));
  return { members, counts: { active: members.filter((m) => m.state === 'working').length } };
}

function projectAttention(runAttention, watchAttention) {
  const items = Array.isArray(runAttention) && runAttention.length > 0
    ? runAttention
    : (watchAttention?.reasons ?? []);
  return items.map((item) => ({
    id: item.id ?? null,
    requestId: item.requestId ?? null,
    kind: item.kind ?? null,
    requiredAction: item.requiredAction ?? null,
    prompt: item.prompt ?? null,
    // P5: only items with an explicit answerable request identity can be answered.
    respondable: Boolean(item.requestId),
  }));
}

function projectControls(attention, runId) {
  const approvals = attention
    .filter((item) => item.respondable)
    .map((item) => ({
      requestId: item.requestId,
      runId,
      kind: item.kind,
      prompt: item.prompt,
      allow: { command: 'run.answer' },
    }));
  return {
    approvals,
    // Takeover stays unavailable: no current application/MCP contract safely grants a
    // session-TUI handoff authority (docs/38 §P5).
    takeover: { available: false },
  };
}

function projectTopology(doctor, runId, fleet) {
  const edges = [];
  const deployment = doctor?.deployment;
  if (deployment?.deploymentId && runId) {
    edges.push({ from: deployment.deploymentId, to: runId, relation: 'owns' });
  }
  for (const member of fleet.members) {
    if (runId && member.workerId) {
      edges.push({ from: runId, to: member.workerId, relation: 'member' });
    }
    if (member.workerId && member.route) {
      const to = [member.route.harness, member.route.model].filter(Boolean).join(':')
        || member.route.harness
        || 'route';
      edges.push({ from: member.workerId, to, relation: 'uses' });
    }
  }
  return { edges };
}

function projectTelemetry(doctor, convergence) {
  const routes = Array.isArray(doctor?.routes)
    ? doctor.routes.map((r) => ({
        harness: r.harness ?? null,
        model: r.model ?? null,
        effort: r.effort ?? null,
        state: r.state ?? null,
        summary: r.summary ?? null,
      }))
    : [];
  return {
    routes,
    lanes: {
      active: Array.isArray(convergence?.scheduler?.active)
        ? convergence.scheduler.active.map((lane) => lane.lane ?? null)
        : [],
      queued: convergence?.scheduler?.queued ?? {},
    },
  };
}

function projectTimeline(events) {
  const source = Array.isArray(events) ? events : [];
  // Latest events only: the tail is bounded at MAX_TIMELINE_ITEMS.
  return source.slice(-MAX_TIMELINE_ITEMS).map((event) => {
    const prose = event.actor === 'worker';
    const raw = prose ? (event.message ?? '') : (event.summary ?? event.message ?? '');
    return {
      seq: event.seq ?? null,
      kind: event.kind ?? null,
      actor: event.actor ?? null,
      provenance: prose ? 'worker_prose' : 'fact',
      summary: stripControlBytes(raw),
    };
  });
}

function projectProvenance(timeline) {
  return { workerProse: timeline.filter((item) => item.provenance === 'worker_prose').length };
}

function projectCursors(watch) {
  return {
    after: watch?.nextAfterCursor ?? 0,
    attention: watch?.nextAttentionCursor ?? 0,
  };
}

// Recursively strip control bytes from every string so the projected JSON is
// control-byte-free regardless of the seam that produced the value.
function sanitize(value) {
  if (typeof value === 'string') return stripControlBytes(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = sanitize(value[key]);
    return out;
  }
  return value;
}

// Canonical serialization: key-sorted, undefined folded to null, so the fingerprint is
// stable across identical inputs.
function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
}

function fingerprint(model) {
  const { fingerprint: _drop, ...canonical } = model;
  return createHash('sha256').update(canonicalStringify(canonical), 'utf8').digest('hex');
}

/**
 * Project one bounded, deterministic `baton.visual_model`.
 *
 * @param {object} input
 * @param {object} input.snapshot   the existing snapshot authority (doctor/run/
 *                                  convergence/story seams)
 * @param {object} [input.watch]    the existing watch authority (follow events,
 *                                  attention reasons, next cursors)
 * @returns {object} the canonical visual model
 */
export function projectBatonVisualModel({ snapshot = {}, watch } = {}) {
  const runValue = snapshot.run?.value ?? {};
  const run = projectRun(runValue);
  const story = projectStory(snapshot.story, runValue);
  const fleet = projectFleet(runValue.workstreams);
  const attention = projectAttention(runValue.attention, watch?.attention?.value);
  const controls = projectControls(attention, run.runId);
  const topology = projectTopology(snapshot.doctor?.value, run.runId, fleet);
  const telemetry = projectTelemetry(snapshot.doctor?.value, snapshot.convergence);
  const timeline = projectTimeline(watch?.follow?.events);
  const provenance = projectProvenance(timeline);
  const cursors = projectCursors(watch);

  const model = sanitize({
    kind: VISUAL_MODEL_KIND,
    version: VISUAL_MODEL_VERSION,
    run,
    story,
    fleet,
    attention,
    controls,
    topology,
    telemetry,
    timeline,
    provenance,
    cursors,
  });
  return { ...model, fingerprint: fingerprint(model) };
}
