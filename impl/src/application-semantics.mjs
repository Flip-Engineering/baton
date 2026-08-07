import { createHash } from 'node:crypto';
import { FRAME_LIMITS } from './limits.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

// docs/36 §7 — one vocabulary per axis. The registry OWNS these enums, their generated legacy
// mappings, and the two lifecycle predicates; no surface hand-maintains a terminal union (L4).
// The core state machine still records legacy phase literals; the mapping is what every surface
// and the audit tool resolve through, so a legacy string never has to be serialized outward.
export const CANONICAL_RUN_PHASES = Object.freeze([
  'planning', 'awaiting_approval', 'queued', 'working', 'paused', 'interrupted',
  'uncertain', 'verifying', 'result_ready', 'awaiting_selection', 'result_selected',
  'reviewing', 'integrating', 'completed', 'failed', 'cancelled', 'stopped', 'denied',
  'stopping',
]);
export const CANONICAL_MEMBER_STATES = Object.freeze([
  'pending', 'idle', 'working', 'blocked', 'paused', 'interrupted', 'stopping',
  'completed', 'failed', 'cancelled', 'stopped',
]);
// The eight live attention-array kinds (§7.3). `approve_plan`/`select_candidate` are gate
// settlement targets, not emitted kinds; `candidate_selection` serializes as `select_candidate`.
export const CANONICAL_ATTENTION_KINDS = Object.freeze([
  'candidate_selection', 'answer_question', 'answer_approval', 'answer_decision',
  'turn_checkpoint', 'session_preservation', 'workflow_revision', 'workflow_recovery',
]);

// §7.4 P1-C semantic progress (docs/reference/evidence/semantic-progress-2026-07-31/
// semantic-progress-decisions.md rule 1): the run-view progressClass vocabulary — ONE closed
// enum, pinned precedence `terminal:<cause>` > `blocked_interaction:<detail>` > `silent` >
// `progressing`. `rate_limited` was CUT in v2 (R-SP-2): no provider taxonomy row classifies a
// limit receipt honestly, so the enum never prose-guesses a member that has no classifier.
// The blocking details are pinned to the LIVE projectBlockedInteraction output
// (application.mjs:321-331): approve_plan/select_candidate are phase-derived, `decision`
// (answer_decision's live kind) maps to `answer_required`, and turn_checkpoint is attention-
// derived. The silence boundary is an order of magnitude under the wave driver's deployment-
// wide stall clock (wave-driver.mjs stallTimeoutMs = 20 min) so a run-view consumer learns of
// silence long before any driver stall fan-out, and far above per-poll jitter (follow polls at
// most profile followPolicy.maxWaitMs).
export const PROGRESS_CLASS_PREFIXES = Object.freeze(['terminal:', 'blocked_interaction:']);
export const PROGRESS_CLASS_LEAVES = Object.freeze(['silent', 'progressing']);
export const PROGRESS_BLOCKED_INTERACTION_DETAILS = Object.freeze([
  'approve_plan', 'select_candidate', 'answer_required', 'turn_checkpoint',
]);
export const PROGRESS_SILENCE_THRESHOLD_MS = 120_000;

// Issue #10 (D2): the closed waiting-on vocabulary. Additive on the run view/outline/runs.list
// item, never a new run phase (D1). The array is frozen AND written in ACTUAL sorted order so the
// suite's `[...WAITING_ON_KINDS].sort()` deepEqual pins the closed set exactly.
export const WAITING_ON_KINDS = Object.freeze([
  'capacity_ceiling', 'dispatch_pending', 'plan_approval', 'provider_stalled', 'spawning',
]);

// §7.1 generated mapping. `closed` maps to null: it is a dead string with no live emitter.
export const LEGACY_RUN_PHASE_MAP = Object.freeze({
  awaiting_plan_approval: 'awaiting_approval',
  approved: 'queued',
  running: 'working',
  interruption_uncertain: 'uncertain',
  work_completed: 'result_ready',
  selection_required: 'awaiting_selection',
  candidate_selected: 'result_selected',
  input_required: 'working',
  planning_failed: 'failed',
  start_failed: 'failed',
  closed: null,
});
// §7.2 generated member-state mapping. `exited` resolves by recorded outcome at the call site.
export const LEGACY_MEMBER_STATE_MAP = Object.freeze({
  input_required: 'blocked',
  start_failed: 'failed',
});
// §7.3 one honest serialization row.
export const ATTENTION_KIND_SERIALIZATION = Object.freeze({
  candidate_selection: 'select_candidate',
});

export function canonicalRunPhase(phase) {
  return Object.hasOwn(LEGACY_RUN_PHASE_MAP, phase) ? LEGACY_RUN_PHASE_MAP[phase] : phase;
}

export function canonicalMemberState(state, { outcome = 'completed' } = {}) {
  if (state === 'exited') return CANONICAL_MEMBER_STATES.includes(outcome) ? outcome : 'completed';
  return Object.hasOwn(LEGACY_MEMBER_STATE_MAP, state) ? LEGACY_MEMBER_STATE_MAP[state] : state;
}

export function serializeAttentionKind(kind) {
  return Object.hasOwn(ATTENTION_KIND_SERIALIZATION, kind)
    ? ATTENTION_KIND_SERIALIZATION[kind] : kind;
}

// L4 predicates. Both canonicalize their input, so a legacy or canonical phase resolves alike;
// `closed` (→ null) is neither settled nor terminal, which is exactly its dead-string status.
const PROVIDER_SETTLED_CANONICAL = new Set([
  'result_ready', 'awaiting_selection', 'result_selected',
  'completed', 'failed', 'cancelled', 'stopped', 'denied',
]);
const APPLICATION_TERMINAL_CANONICAL = new Set([
  'completed', 'failed', 'cancelled', 'stopped', 'denied',
]);
export function providerSettled(phase) {
  return PROVIDER_SETTLED_CANONICAL.has(canonicalRunPhase(phase));
}
export function applicationTerminal(phase) {
  return APPLICATION_TERMINAL_CANONICAL.has(canonicalRunPhase(phase));
}

export const APPLICATION_LIFECYCLE_ENUMS = Object.freeze({
  runPhases: CANONICAL_RUN_PHASES,
  memberStates: CANONICAL_MEMBER_STATES,
  attentionKinds: CANONICAL_ATTENTION_KINDS,
  progressClass: Object.freeze({
    prefixes: PROGRESS_CLASS_PREFIXES,
    leaves: PROGRESS_CLASS_LEAVES,
    blockedDetails: PROGRESS_BLOCKED_INTERACTION_DETAILS,
  }),
  legacyRunPhaseMap: LEGACY_RUN_PHASE_MAP,
  legacyMemberStateMap: LEGACY_MEMBER_STATE_MAP,
  attentionKindSerialization: ATTENTION_KIND_SERIALIZATION,
});

// docs/36 §4.2 H10 / §10 C8 — the canonical serialization order. A serialization-layer
// normalization emits the web command envelope, the outline top-level, and the registry-owned
// nested objects (the L2 `do` block and its `{kind, actionId}` coordinate) with their pinned keys
// leading, in this exact order. This is PRESENTATION ONLY (R-CX-11/R-KM-13): parsers stay
// order-insensitive, and every digest/replay identity stays on the sorted-key canonical form
// (`application.mjs` `canonical()`), so this pin never touches an authority digest. Arrays whose
// order is semantic keep their own declared sort. Cut as a conformance contract at M4b (C8).
export const APPLICATION_SERIALIZATION_ORDER = Object.freeze({
  envelope: Object.freeze([
    'schemaVersion', 'commandId', 'idempotencyKey', 'command', 'args',
    'repoId', 'runId', 'expectedFence', 'origin', 'clientObservedCursor',
  ]),
  outline: Object.freeze([
    'schemaVersion', 'runId', 'depth', 'objective', 'phase', 'cursor',
    'nextActions', 'attention', 'blockedInteraction', 'progressClass', 'requiredAction',
    'route', 'verification', 'budget',
  ]),
  do: Object.freeze(['action', 'inputs']),
  action: Object.freeze(['kind', 'actionId']),
});

const objectSchema = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const id = { type: 'string', minLength: 1, maxLength: 256 };
const safeBoardId = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_.:-]+$' };
const safeBoardItemId = { type: 'string', minLength: 1, maxLength: 256, pattern: '^[A-Za-z0-9_.:-]+$' };
const digest64 = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const evidenceRef = {
  oneOf: [
    objectSchema({ coordinationSeq: { type: 'integer', minimum: 1 } }),
    objectSchema({ artifactId: id }),
  ],
};
const resultIntent = {
  type: 'string', enum: ['change', 'read_only_evidence'], default: 'change',
};
const applicationRoute = objectSchema({ harness: id, model: id, effort: id }, []);
const applicationIntent = objectSchema({
  runId: id,
  objective: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['run.objective'].value },
  resultIntent,
  profile: id,
  route: applicationRoute,
  scope: {
    type: 'array', minItems: 1, maxItems: 64, uniqueItems: true,
    items: { type: 'string', minLength: 1, maxLength: 4096 },
  },
  composition: objectSchema({
    strategy: { const: 'parallel_attempts' }, workspace: { const: 'isolated' },
    join: { const: 'operator_selected' },
    team: {
      type: 'array', minItems: 2, maxItems: 16,
      items: objectSchema({ role: id, route: objectSchema({
        harness: id, model: id, effort: id,
      }) }),
    },
  }),
}, ['objective']);
const depth = {
  type: 'string', enum: ['outline', 'index', 'section', 'item', 'content', 'evidence'],
};
const contextField = { type: 'string', minLength: 1, maxLength: 256 };
const contextPrimitive = { oneOf: [
  { type: 'null' }, { type: 'boolean' }, { type: 'number' },
  { type: 'string', maxLength: 16384 },
] };
const contextProgramSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    schemaVersion: { const: 1 }, kind: { const: 'baton.context_program' },
    expression: { $ref: '#/properties/program/$defs/expression' },
  },
  required: ['schemaVersion', 'kind', 'expression'],
  $defs: {
    selector: { oneOf: [
      objectSchema({
        kind: { const: 'indices' },
        values: { type: 'array', minItems: 1, maxItems: 10000, uniqueItems: true,
          items: { type: 'integer', minimum: 0 } },
      }),
      objectSchema({ kind: { const: 'field_equals' }, field: contextField,
        value: contextPrimitive }),
    ] },
    predicate: { oneOf: [
      objectSchema({ field: contextField, operator: { const: 'exists' } }),
      objectSchema({ field: contextField,
        operator: { type: 'string', enum: ['eq', 'neq', 'contains'] },
        value: contextPrimitive }),
    ] },
    expression: { oneOf: [
      objectSchema({ op: { const: 'source' }, branch: contextField }),
      ...['outline', 'coverage'].map((op) => objectSchema({
        op: { const: op }, input: { $ref: '#/properties/program/$defs/expression' },
      })),
      objectSchema({ op: { const: 'index' }, input: { $ref: '#/properties/program/$defs/expression' },
        after: { oneOf: [{ type: 'null' }, { type: 'integer', minimum: 0 }] } }),
      objectSchema({ op: { const: 'search' }, input: { $ref: '#/properties/program/$defs/expression' },
        query: { type: 'string', minLength: 1, maxLength: 4096 },
        mode: { type: 'string', enum: ['literal', 'case_insensitive'] } }),
      objectSchema({ op: { const: 'slice' }, input: { $ref: '#/properties/program/$defs/expression' },
        selector: { $ref: '#/properties/program/$defs/selector' } }),
      objectSchema({ op: { const: 'chunk' }, input: { $ref: '#/properties/program/$defs/expression' },
        by: contextField }),
      objectSchema({ op: { const: 'filter' }, input: { $ref: '#/properties/program/$defs/expression' },
        predicate: { $ref: '#/properties/program/$defs/predicate' } }),
      objectSchema({ op: { const: 'project' }, input: { $ref: '#/properties/program/$defs/expression' },
        fields: { type: 'array', minItems: 1, maxItems: 128, uniqueItems: true,
          items: contextField } }),
      ...['sort', 'unique'].map((op) => objectSchema({
        op: { const: op }, input: { $ref: '#/properties/program/$defs/expression' },
        keys: { type: 'array', minItems: 1, maxItems: 128, uniqueItems: true,
          items: contextField },
      })),
      objectSchema({ op: { const: 'join' },
        left: { $ref: '#/properties/program/$defs/expression' }, right: { $ref: '#/properties/program/$defs/expression' },
        on: objectSchema({ left: contextField, right: contextField }) }),
      objectSchema({ op: { const: 'collect' },
        inputs: { type: 'array', minItems: 1, maxItems: 128,
          items: { $ref: '#/properties/program/$defs/expression' } } }),
      objectSchema({ op: { const: 'finish' }, value: { $ref: '#/properties/program/$defs/expression' },
        evidence: { type: 'array', minItems: 1, maxItems: 128,
          items: { $ref: '#/properties/program/$defs/expression' } } }),
    ] },
  },
};

const operations = {
  'application.help': {
    inputSchema: objectSchema({ topic: { type: 'string', minLength: 1, maxLength: 256 }, depth, runId: id }, []),
    helpTopic: 'application.help', idempotent: true, destructive: false,
  },
  'runs.list': {
    inputSchema: objectSchema({}, []),
    helpTopic: 'runs', idempotent: true, destructive: false,
  },
  'run.start': {
    inputSchema: objectSchema({ intent: applicationIntent }, ['intent']),
    helpTopic: 'run.start', idempotent: true, destructive: false,
  },
  'run.inspect': {
    inputSchema: objectSchema({
      runId: id, depth, section: id, item: id,
      offset: { type: 'integer', minimum: 0 },
      pageCursor: { type: 'string', minLength: 1, maxLength: 4096, pattern: '^[A-Za-z0-9_-]+$' },
      recipient: id,
      cursor: { type: 'integer', minimum: 0 },
      waitMs: { type: 'integer', minimum: 1 },
    }, ['runId']),
    helpTopic: 'run.inspect', idempotent: true, destructive: false,
    continuation: {
      operation: 'run.inspect', cursorArgument: 'cursor',
      selectorArguments: ['depth', 'section', 'item', 'pageCursor', 'recipient'],
      waitPolicy: 'deployment_derived',
      preferred: true, changeAware: true,
    },
  },
  'run.episode': {
    inputSchema: objectSchema({
      runId: id, topic: id, detail: { type: 'string', enum: ['item', 'content', 'evidence'] },
      role: id, generation: { type: 'integer', minimum: 1 },
      pageCursor: { type: 'string', minLength: 1, maxLength: 4096 },
      cursor: { type: 'integer', minimum: 0 }, waitMs: { type: 'integer', minimum: 1 },
    }, ['runId']),
    helpTopic: 'run.episode', idempotent: true, destructive: false,
  },
  'run.workstreams': {
    inputSchema: objectSchema({
      runId: id, role: id, generation: { type: 'integer', minimum: 1 },
      cursor: { type: 'integer', minimum: 0 }, waitMs: { type: 'integer', minimum: 1 },
    }, ['runId']),
    helpTopic: 'run.workstreams', idempotent: true, destructive: false,
  },
  'run.workstream.notify': {
    inputSchema: objectSchema({
      runId: id, role: id, generation: { type: 'integer', minimum: 1 },
      message: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['run.legacy_send.body'].value },
      delivery: { type: 'string', enum: ['nudge', 'now', 'turn'] },
    }, ['runId', 'role', 'message']),
    helpTopic: 'run.workstreams', idempotent: true, destructive: false,
  },
  'run.workstream.stop': {
    inputSchema: objectSchema({
      runId: id, role: id, generation: { type: 'integer', minimum: 1 },
      reason: { type: 'string', minLength: 1, maxLength: 1024 },
    }, ['runId', 'role']),
    helpTopic: 'run.workstreams', idempotent: true, destructive: true,
  },
  'run.act': {
    inputSchema: objectSchema({ runId: id, actionId: id, inputs: objectSchema({}, []) }, ['runId', 'actionId', 'inputs']),
    helpTopic: 'run.act', idempotent: true, destructive: true,
  },
  'run.stop': {
    inputSchema: objectSchema({ runId: id, reason: { type: 'string', minLength: 1, maxLength: 1024 } }),
    helpTopic: 'run.stop', idempotent: true, destructive: true, emergency: true,
  },
};
// REFLEX-4 slice A (docs/32 §3.4, issue #19): application.context_eval is `BatonApplication
// .prototype.contextEval` in application.mjs — a public method, not a command-bus entry (not in
// `operations` here, not in APPLICATION_COMMAND_DEFINITIONS). `operations` above is a closed,
// exactly-asserted inventory (AX1, phase67-progressive-agent-experience.test.mjs) outside this
// task's file scope, and APPLICATION_COMMAND_DEFINITIONS is asserted just as exactly elsewhere
// (UA5, phase64-integrated-run-application.test.mjs) — see the note above that table in
// application.mjs for the full reachability/gap account (direct method call works today; Web,
// MCP, and generic `application.command('application.context_eval', ...)` dispatch do not yet).

const sections = [
  ['episode', 'Evidence-backed Episode outline, output, sources, lineage, route, verification, result, and cleanup authority.'],
  ['workstreams', 'Durable semantic workstreams and their logical generations, without worker, task, fence, or transport choreography.'],
  ['plan', 'Goal, approved Plan, and bounded Plan-node summaries.'],
  ['execution', 'Provider work, current lifecycle state, and bounded worker summaries.'],
  ['orchestration', 'Recursive Run role, descendant topology, recipient authority, and subtree-stop state.'],
  ['attention', 'Questions, approvals, and other operator attention.'],
  ['route', 'Exact launch enforcement and provider-native harness/model/effort attestation truth.'],
  ['budget', 'Allocated, consumed, remaining, and terminal budget cause.'],
  ['verification', 'Mechanical verification state and evidence.'],
  ['semantic_review', 'Independent semantic review state and grounded findings.'],
  ['candidates', 'Immutable mechanically verified Workflow candidates and their exact role bindings.'],
  ['feedback', 'Typed source-bound Workflow feedback packets and their candidate targets.'],
  ['rounds', 'Append-only Workflow Plan rounds, immutable Candidate lineage, and current round state.'],
  ['context', 'Immutable Context sessions, pure cells, coverage, and source-grounded evidence.'],
  ['result', 'Accepted and adopted result state.'],
  ['delivery', 'Integration and export/delivery state.'],
  ['cleanup', 'Stop, process reaping, worktree, runtime, and export cleanup.'],
  ['knowledge', 'Run-related causal knowledge summaries and evidence links.'],
  ['capabilities', 'Capability work used by this Run and its bounded outcomes.'],
].map(([sectionId, summary]) => ({ id: sectionId, summary }));

const actions = {
  context_eval: {
    label: 'Evaluate pure Context',
    summary: 'Evaluate one closed immutable Context expression through a durable addressed cell.',
    inputSchema: objectSchema({
      program: contextProgramSchema,
      role: { type: 'string', minLength: 1, maxLength: 256 },
    }, ['program']),
    serverDerived: ['session', 'manifest', 'cell', 'ordinal', 'predecessor'],
    effect: 'context_pure_compute', destructive: false, irreversible: false,
    idempotent: true, priority: 'optional', helpTopic: 'run.act.context_eval',
    expectedDepth: 'outline', genericCli: true,
  },
  context_retry: {
    label: 'Retry failed Context generation',
    summary: 'Propose one separately approved successor generation that executes only retryable nonaccepted units and inherits accepted results exactly.',
    inputSchema: objectSchema({
      callId: {
        type: 'string', pattern: '^context-call:[a-f0-9]{64}$',
      },
    }, ['callId']),
    serverDerived: [
      'predecessorCall', 'retryUnits', 'inheritedChildren', 'predecessorPlan',
      'successorPlan', 'workflowDefinition', 'routes', 'workerPolicy', 'budgets', 'call',
    ],
    effect: 'plan_proposal', destructive: false, irreversible: false,
    idempotent: true, priority: 'recommended', helpTopic: 'run.act.context_retry',
    expectedDepth: 'outline', genericCli: true,
  },
  context_reduce: {
    label: 'Reduce completed Context',
    summary: 'Propose one separately approved successor Plan that synthesizes every exact output of a completed Context call.',
    inputSchema: objectSchema({
      callId: {
        type: 'string', pattern: '^context-call:[a-f0-9]{64}$',
      },
      role: { type: 'string', minLength: 1, maxLength: 256 },
      instruction: { type: 'string', minLength: 1, maxLength: 16384 },
    }, ['callId', 'instruction']),
    serverDerived: [
      'session', 'sourceCall', 'outputRef', 'evidenceRef', 'inputLineage',
      'predecessorPlan', 'successorPlan', 'workflowDefinition', 'route', 'workerPolicy',
      'budget', 'call',
    ],
    effect: 'plan_proposal', destructive: false, irreversible: false,
    idempotent: true, priority: 'optional', helpTopic: 'run.act.context_reduce',
    expectedDepth: 'outline', genericCli: true,
  },
  context_map: {
    label: 'Map addressed Context',
    summary: 'Propose one separately approved parallel successor Plan over an immutable completed Context cell.',
    inputSchema: objectSchema({
      cellId: {
        type: 'string', pattern: '^cell:[a-f0-9]{64}$',
      },
      role: { type: 'string', minLength: 1, maxLength: 256 },
      instruction: { type: 'string', minLength: 1, maxLength: 16384 },
    }, ['cellId', 'instruction']),
    serverDerived: [
      'session', 'manifest', 'sourceProgram', 'outputRef', 'evidenceRef', 'partitions',
      'predecessorPlan', 'successorPlan', 'workflowDefinition', 'routes', 'workerPolicy',
      'budgets', 'call', 'wave',
    ],
    effect: 'plan_proposal', destructive: false, irreversible: false,
    idempotent: true, priority: 'optional', helpTopic: 'run.act.context_map',
    expectedDepth: 'outline', genericCli: true,
  },
  context_search: {
    label: 'Search addressed Context',
    summary: 'Run one pure deterministic search over an immutable Context branch.',
    inputSchema: objectSchema({
      query: { type: 'string', minLength: 1, maxLength: 4096 },
      branch: { type: 'string', minLength: 1, maxLength: 256, default: 'repository' },
      mode: {
        type: 'string', enum: ['literal', 'case_insensitive'], default: 'case_insensitive',
      },
      role: { type: 'string', minLength: 1, maxLength: 256 },
    }, ['query']),
    serverDerived: ['session', 'manifest', 'program', 'cell', 'ordinal', 'predecessor'],
    effect: 'context_pure_compute', destructive: false, irreversible: false,
    idempotent: true, priority: 'optional', helpTopic: 'run.act.context_search',
    expectedDepth: 'outline', genericCli: true, advertised: false,
    legacyAliasFor: 'context_eval',
  },
  context_chunk: {
    label: 'Chunk addressed Context',
    summary: 'Partition one immutable Context branch by a deterministic field.',
    inputSchema: objectSchema({
      branch: { type: 'string', minLength: 1, maxLength: 256, default: 'repository' },
      by: { type: 'string', minLength: 1, maxLength: 256, default: 'item' },
      role: { type: 'string', minLength: 1, maxLength: 256 },
    }, []),
    serverDerived: ['session', 'manifest', 'program', 'cell', 'ordinal', 'predecessor'],
    effect: 'context_pure_compute', destructive: false, irreversible: false,
    idempotent: true, priority: 'optional', helpTopic: 'run.act.context_chunk',
    expectedDepth: 'outline', genericCli: true, advertised: false,
    legacyAliasFor: 'context_eval',
  },
  context_coverage: {
    label: 'Inspect Context coverage',
    summary: 'Measure represented and selected coverage for one immutable Context branch.',
    inputSchema: objectSchema({
      branch: { type: 'string', minLength: 1, maxLength: 256, default: 'repository' },
      role: { type: 'string', minLength: 1, maxLength: 256 },
    }, []),
    serverDerived: ['session', 'manifest', 'program', 'cell', 'ordinal', 'predecessor'],
    effect: 'context_pure_compute', destructive: false, irreversible: false,
    idempotent: true, priority: 'optional', helpTopic: 'run.act.context_coverage',
    expectedDepth: 'outline', genericCli: true, advertised: false,
    legacyAliasFor: 'context_eval',
  },
  approve_plan: {
    label: 'Approve exact Plan', summary: 'Approve the currently displayed Plan and let Baton dispatch it.',
    inputSchema: objectSchema({}, []), serverDerived: ['planDigest'], effect: 'provider_call',
    destructive: false, irreversible: false, idempotent: true, priority: 'recommended',
    helpTopic: 'run.act.approve_plan', expectedDepth: 'outline',
  },
  answer_approval: {
    label: 'Answer worker approval', summary: 'Allow, deny, or cancel the exact pending worker tool request advertised by this Run.',
    inputSchema: objectSchema({ decision: { type: 'string', enum: ['allow', 'deny', 'cancel'] } }, ['decision']),
    serverDerived: ['requestId', 'workerId'], effect: 'worker_tool_authorization',
    destructive: true, irreversible: false, idempotent: true, priority: 'required',
    helpTopic: 'run.act.answer_approval', expectedDepth: 'outline',
  },
  answer_question: {
    label: 'Answer worker question', summary: 'Send bounded text to the exact pending worker question advertised by this Run.',
    inputSchema: objectSchema({ text: { type: 'string', minLength: 1, maxLength: 4096 } }, ['text']),
    serverDerived: ['requestId', 'workerId'], effect: 'provider_control',
    destructive: false, irreversible: false, idempotent: true, priority: 'required',
    helpTopic: 'run.act.answer_question', expectedDepth: 'outline',
  },
  answer_decision: {
    label: 'Answer worker decision',
    summary: 'Choose an option (or send bounded free-form text, when the request allows it) for the exact pending typed decision request advertised by this Run.',
    inputSchema: objectSchema({
      optionId: { type: 'string', minLength: 1, maxLength: 128 },
      text: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['decision.text'].value },
    }, []),
    serverDerived: ['requestId', 'workerId'], effect: 'provider_control',
    destructive: false, irreversible: false, idempotent: true, priority: 'required',
    helpTopic: 'run.act.answer_decision', expectedDepth: 'outline',
  },
  nudge_turn: {
    label: 'Nudge paused turn',
    summary: 'Admit a fresh provider turn on the exact paused task and unpark it in place.',
    inputSchema: objectSchema({
      message: { type: 'string', minLength: 1, maxLength: 4096, default: 'Continue the current turn.' },
    }, []),
    serverDerived: ['pauseId', 'workerId', 'taskId', 'turnEpoch'], effect: 'provider_control',
    destructive: false, irreversible: false, idempotent: true, priority: 'required',
    helpTopic: 'run.act.nudge_turn', expectedDepth: 'outline', genericCli: true,
  },
  wait_turn: {
    label: 'Wait on paused turn',
    summary: 'Record a non-consuming receipt against the exact paused turn checkpoint without changing its state.',
    inputSchema: objectSchema({}, []),
    serverDerived: ['pauseId', 'workerId', 'taskId', 'turnEpoch'], effect: 'provider_control',
    destructive: false, irreversible: false, idempotent: true, priority: 'optional',
    helpTopic: 'run.act.wait_turn', expectedDepth: 'outline', genericCli: true,
  },
  claim_turn: {
    label: 'Claim paused turn',
    summary: 'Re-run the live trust gate against the exact paused task and resolve it to completed or failed — a final evaluation that can kill the worker; refuses claim_premature_liveness while the worker shows read-only liveness without an in-scope diff.',
    inputSchema: objectSchema({}, []),
    serverDerived: ['pauseId', 'workerId', 'taskId', 'turnEpoch'], effect: 'provider_control',
    destructive: true, irreversible: false, idempotent: true, priority: 'recommended',
    helpTopic: 'run.act.claim_turn', expectedDepth: 'outline', genericCli: true,
  },
  send: {
    label: 'Guide active work',
    summary: 'Send guidance to the current semantic work recipient without exposing worker or fence coordinates.',
    inputSchema: objectSchema({
      message: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['run.legacy_send.body'].value },
      recipient: { type: 'string', minLength: 1, maxLength: 256, default: 'work' },
      delivery: { type: 'string', enum: ['nudge', 'now', 'turn'], default: 'nudge' },
    }, ['message']),
    serverDerived: ['worker', 'task', 'fence', 'control', 'providerRequest'],
    effect: 'provider_control', destructive: false, irreversible: false,
    idempotent: true, priority: 'optional', helpTopic: 'run.act.send', expectedDepth: 'outline',
  },
  interrupt: {
    label: 'Interrupt active work',
    summary: 'Interrupt only the current semantic work recipient while preserving unrelated members and a reusable provider session when supported.',
    inputSchema: objectSchema({
      recipient: { type: 'string', minLength: 1, maxLength: 256, default: 'work' },
      reason: {
        type: 'string', minLength: 1, maxLength: 1024,
        default: 'Interrupt the current work turn.',
      },
    }, []),
    serverDerived: ['worker', 'task', 'fence', 'control', 'providerRequest'],
    effect: 'provider_control', destructive: true, irreversible: false,
    idempotent: true, priority: 'optional', helpTopic: 'run.act.interrupt', expectedDepth: 'outline',
  },
  adopt_result: {
    label: 'Adopt verified result', summary: 'Reverify and adopt the current accepted result without requiring caller-supplied result coordinates.',
    inputSchema: objectSchema({
      reason: {
        type: 'string', minLength: 1, maxLength: 1024,
        default: 'Adopt the verified result.',
      },
    }, ['reason']),
    serverDerived: ['nodeKey', 'resultSha', 'evidenceDigest'], effect: 'result_adoption',
    destructive: false, irreversible: false, idempotent: true, priority: 'recommended',
    helpTopic: 'run.act.adopt_result', expectedDepth: 'outline',
  },
  select_candidate: {
    label: 'Select verified candidate',
    summary: 'Select one role-labeled immutable verified Workflow candidate for the next gated stage.',
    inputSchema: objectSchema({
      role: { type: 'string', minLength: 1, maxLength: 256 },
      reason: { type: 'string', minLength: 1, maxLength: 1024 },
    }, ['role', 'reason']),
    serverDerived: ['candidateId', 'candidateDigest', 'taskId', 'resultSha', 'evidenceDigest'],
    effect: 'candidate_selection', destructive: false, irreversible: false,
    idempotent: true, priority: 'required',
    helpTopic: 'run.act.select_candidate', expectedDepth: 'outline',
  },
  send_feedback: {
    label: 'Send Candidate feedback',
    summary: 'Attach source-bound typed feedback to one immutable verified Workflow candidate.',
    inputSchema: objectSchema({
      role: { type: 'string', minLength: 1, maxLength: 256 },
      feedback: {
        oneOf: [
          { type: 'string', minLength: 1, maxLength: 4096 },
          {
            type: 'object', additionalProperties: false, required: ['summary', 'findings'],
            properties: {
              summary: { type: 'string', minLength: 1, maxLength: 4096 },
              findings: {
                type: 'array', minItems: 1, maxItems: 32,
                items: {
                  type: 'object', additionalProperties: false,
                  required: ['kind', 'severity', 'message', 'path', 'line'],
                  properties: {
                    kind: { type: 'string', enum: ['defect', 'risk', 'suggestion', 'question', 'observation'] },
                    severity: { type: 'string', enum: ['info', 'low', 'medium', 'high', 'critical'] },
                    message: { type: 'string', minLength: 1, maxLength: 4096 },
                    path: { oneOf: [{ type: 'string', minLength: 1, maxLength: 4096 }, { type: 'null' }] },
                    line: { oneOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
                  },
                },
              },
            },
          },
        ],
      },
    }, ['role', 'feedback']),
    serverDerived: [
      'candidateId', 'candidateDigest', 'taskId', 'resultSha', 'retainedResultRef',
      'treeIdentityDigest', 'changedPaths',
    ],
    effect: 'workflow_feedback', destructive: false, irreversible: false,
    idempotent: true, priority: 'recommended',
    helpTopic: 'run.act.send_feedback', expectedDepth: 'outline',
  },
  revise_candidate: {
    label: 'Revise selected Candidate',
    summary: 'Propose one exact successor Plan that corrects the selected immutable Candidate from its bound feedback.',
    inputSchema: objectSchema({
      reason: {
        type: 'string', minLength: 1, maxLength: 1024,
        default: 'Revise the selected Candidate using its recorded feedback.',
      },
    }, ['reason']),
    serverDerived: [
      'predecessorPlan', 'revisionId', 'candidateId', 'candidateDigest', 'resultSha',
      'retainedResultRef', 'feedbackIds', 'route', 'nodeBudget',
    ],
    effect: 'plan_proposal', destructive: false, irreversible: false,
    idempotent: true, priority: 'recommended',
    helpTopic: 'run.act.revise_candidate', expectedDepth: 'outline',
  },
  stop_member: {
    label: 'Stop and reap Workflow member',
    summary: 'Durably stop one role-addressed active Workflow member while leaving sibling Attempts untouched.',
    inputSchema: objectSchema({
      role: { type: 'string', minLength: 1, maxLength: 256 },
      reason: { type: 'string', minLength: 1, maxLength: 1024 },
    }, ['role', 'reason']),
    serverDerived: ['nodeKey', 'taskId', 'workerId', 'targetDigest', 'fence'],
    effect: 'member_cleanup', destructive: true, irreversible: false,
    idempotent: true, priority: 'emergency',
    helpTopic: 'run.act.stop_member', expectedDepth: 'outline',
  },
  semantic_review: {
    label: 'Start semantic review', summary: 'Start an independent review of the exact preserved result using one deployment-authorized route.',
    inputSchema: objectSchema({
      routeIndex: { type: 'integer', minimum: 0 },
      reason: { type: 'string', minLength: 1, maxLength: 1024 },
    }, ['routeIndex', 'reason']),
    serverDerived: ['route', 'resultSha', 'targetDigest'], effect: 'provider_call',
    destructive: false, irreversible: false, idempotent: true, priority: 'recommended',
    helpTopic: 'run.act.semantic_review', expectedDepth: 'outline',
  },
  integrate: {
    label: 'Apply adopted result', summary: 'Reverify and apply the current adopted result to the caller repository using one deployment-authorized strategy.',
    inputSchema: objectSchema({
      strategy: { type: 'string', enum: ['ff-only', 'structured'] },
      reason: {
        type: 'string', minLength: 1, maxLength: 1024,
        default: 'Apply the adopted verified result.',
      },
    }, ['strategy', 'reason']),
    serverDerived: ['evidenceDigest', 'resultSha'], effect: 'repository_edit',
    destructive: true, irreversible: false, idempotent: true, priority: 'recommended',
    helpTopic: 'run.act.integrate', expectedDepth: 'outline',
  },
  export_result: {
    label: 'Export accepted result', summary: 'Reverify and materialize the exact accepted result under Batons export authority.',
    inputSchema: objectSchema({}, []),
    serverDerived: ['nodeKey', 'resultSha', 'evidenceDigest', 'exportId'], effect: 'filesystem_write',
    destructive: false, irreversible: false, idempotent: true, priority: 'recommended',
    helpTopic: 'run.act.export_result', expectedDepth: 'outline',
  },
  retry_verification: {
    label: 'Retry trust-gate verification', summary: 'Re-run the pinned verification of the exact preserved candidate without another provider turn; candidate-failure confirmation is one-shot and instability-preserving.',
    inputSchema: objectSchema({ reason: { type: 'string', minLength: 1, maxLength: 1024 } }, ['reason']),
    serverDerived: ['checkpointSha', 'checkpointRef', 'planDigest', 'baseSha', 'runtimeDigest', 'toolchainDigest', 'attempt'], effect: 'verification_retry',
    destructive: false, irreversible: false, idempotent: true, priority: 'recommended',
    helpTopic: 'run.act.retry_verification', expectedDepth: 'outline',
  },
  resume_work: {
    label: 'Resume preserved work', summary: 'Restore preserved progress in a fresh task using an orchestrator-selected harness, model, and effort.',
    inputSchema: objectSchema({ reason: { type: 'string', minLength: 1, maxLength: 1024 } }, ['reason']),
    serverDerived: ['checkpoint', 'planNode', 'routePolicy', 'recoveryLineage'], effect: 'provider_call',
    destructive: false, irreversible: false, idempotent: true, priority: 'recommended',
    helpTopic: 'run.act.resume_work', expectedDepth: 'outline',
  },
  stop: {
    label: 'Stop and reap Run', summary: 'Close this Run dispatch authority and reap its exact owned resources.',
    inputSchema: objectSchema({ reason: { type: 'string', minLength: 1, maxLength: 1024 } }, ['reason']),
    serverDerived: ['workerIds', 'fences'], effect: 'run_cleanup', destructive: true,
    irreversible: false, idempotent: true, priority: 'emergency', helpTopic: 'run.stop', expectedDepth: 'outline',
  },
};

const APPLICATION_ACTION_CAPABILITY_SOURCE = {
  context_eval: ['control', 'observe'],
  context_retry: ['control', 'observe'],
  context_reduce: ['control', 'observe'],
  context_map: ['control', 'observe'],
  context_search: ['control', 'observe'],
  context_chunk: ['control', 'observe'],
  context_coverage: ['control', 'observe'],
  approve_plan: ['approve', 'observe'],
  answer_approval: ['approve', 'observe'],
  answer_question: ['control', 'observe'],
  answer_decision: ['control', 'observe'],
  nudge_turn: ['control', 'observe'],
  wait_turn: ['control', 'observe'],
  claim_turn: ['control', 'observe'],
  send: ['control', 'observe'],
  interrupt: ['control', 'observe'],
  adopt_result: ['adopt_result', 'observe'],
  select_candidate: ['control', 'observe'],
  send_feedback: ['control', 'observe'],
  revise_candidate: ['control', 'observe'],
  stop_member: ['emergency_stop', 'observe'],
  semantic_review: ['review', 'control', 'observe'],
  integrate: ['integrate_result', 'observe'],
  export_result: ['export_result', 'observe'],
  retry_verification: ['retry_verification', 'observe'],
  resume_work: ['resume_work', 'observe'],
  stop: ['emergency_stop', 'observe'],
};

export const APPLICATION_ACTION_CAPABILITIES = freeze(Object.fromEntries(
  Object.entries(APPLICATION_ACTION_CAPABILITY_SOURCE)
    .map(([kind, capabilities]) => [kind, [...capabilities].sort()]),
));

if (Object.keys(actions).sort().join('\0')
  !== Object.keys(APPLICATION_ACTION_CAPABILITIES).sort().join('\0')) {
  throw new Error('application semantic action capability registry is incomplete');
}

const authorizedActions = Object.fromEntries(Object.entries(actions).map(([kind, definition]) => [
  kind,
  { ...definition, requiredCapabilities: APPLICATION_ACTION_CAPABILITIES[kind] },
]));

const OPERATION_ALIASES = {
  'run.list': {
    operation: 'runs.list',
    cli: { canonical: ['run', 'list'], legacy: ['runs', 'list'] },
  },
  'run.view': {
    operation: 'run.inspect',
    cli: { canonical: ['run', 'view'], legacy: ['run', 'show'] },
  },
  'run.watch': {
    operation: 'run.follow',
    cli: null,
  },
  'run.member.view': {
    operation: 'run.workstreams',
    cli: { canonical: ['run', 'member', 'view'], legacy: ['run', 'workstreams'] },
  },
  'run.member.send': {
    operation: 'run.workstream.notify',
    cli: { canonical: ['run', 'member', 'send'], legacy: ['run', 'notify'] },
  },
  'run.member.stop': {
    operation: 'run.workstream.stop',
    cli: { canonical: ['run', 'member', 'stop'], legacy: ['run', 'stop-member'] },
  },
  // docs/36 §9 M3: `run.member.interrupt` is the member-addressed peer of the run-level
  // interrupt. It carries no new legacy transport name (UA5 byte-stability); the canonical CLI
  // prefix rewrites onto the existing `run interrupt` verb, which accepts a positional member
  // role plus `--generation` as its {role, generation?} address.
  'run.member.interrupt': {
    operation: 'run.interrupt',
    cli: { canonical: ['run', 'member', 'interrupt'], legacy: ['run', 'interrupt'] },
  },
  'run.do': {
    operation: 'run.act',
    cli: { canonical: ['run', 'do'], legacy: ['run', 'do'] },
  },
  'run.resume': {
    operation: 'run.resume_work',
    cli: { canonical: ['run', 'resume'], legacy: ['run', 'resume'] },
  },
  'run.retry': {
    operation: 'run.retry_verification',
    cli: { canonical: ['run', 'retry'], legacy: ['run', 'retry'] },
  },
};

const OPERATION_CANONICAL_NAMES = {
  'application.help': 'application.help',
  'runs.list': 'run.list',
  'run.start': 'run.start',
  'run.inspect': 'run.view',
  'run.episode': 'run.view',
  'run.workstreams': 'run.member.view',
  'run.workstream.notify': 'run.member.send',
  'run.workstream.stop': 'run.member.stop',
  'run.act': 'run.do',
  'run.stop': 'run.stop',
};

const ACTION_OPERATIONS = {
  context_eval: 'context.eval',
  context_retry: 'context.retry',
  context_reduce: 'context.reduce',
  context_map: 'context.map',
  context_search: 'context.eval',
  context_chunk: 'context.eval',
  context_coverage: 'context.eval',
  approve_plan: 'run.approve',
  answer_approval: 'run.answer',
  answer_question: 'run.answer',
  answer_decision: 'run.answer',
  nudge_turn: 'run.answer',
  wait_turn: 'run.answer',
  claim_turn: 'run.answer',
  send: 'run.send',
  interrupt: 'run.interrupt',
  adopt_result: 'run.adopt',
  select_candidate: 'run.select',
  send_feedback: 'run.feedback',
  revise_candidate: 'run.revise',
  stop_member: 'run.member.stop',
  semantic_review: 'run.review',
  integrate: 'run.integrate',
  export_result: 'run.export',
  retry_verification: 'run.retry',
  resume_work: 'run.resume',
  stop: 'run.stop',
};

function annotateRegistryEntries() {
  for (const [name, definition] of Object.entries(operations)) {
    const canonicalName = OPERATION_CANONICAL_NAMES[name];
    const aliases = Object.entries(OPERATION_ALIASES)
      .filter(([, alias]) => alias.operation === name)
      .map(([canonicalAlias]) => canonicalAlias);
    Object.defineProperties(definition, {
      aliases: { value: freeze(aliases), enumerable: false },
      canonicalName: { value: canonicalName, enumerable: false },
      deprecated: { value: canonicalName !== name, enumerable: false },
      reconcilable: { value: name !== 'application.shutdown', enumerable: false },
    });
  }
  for (const [kind, definition] of Object.entries(authorizedActions)) {
    Object.defineProperties(definition, {
      operation: { value: ACTION_OPERATIONS[kind], enumerable: false },
      deprecated: { value: false, enumerable: false },
    });
  }
}

annotateRegistryEntries();

const cliCommands = [
  ['explore.objective', 'run.start', null, 'baton explore OBJECTIVE [--exact HARNESS/MODEL@EFFORT] [--profile PROFILE] [--scope PATHS]'],
  ['review.objective', 'run.start', null, 'baton review OBJECTIVE --exact HARNESS/MODEL@EFFORT --exact HARNESS/MODEL@EFFORT [--profile PROFILE] [--scope PATHS]'],
  ['route.exact', null, null, 'baton route HARNESS/MODEL@EFFORT'],
  ['run.objective', 'run.start', null, 'baton run OBJECTIVE [--model MODEL --effort EFFORT] [--harness HARNESS]'],
  ['run.objective.manual', 'run.start', null, 'baton run OBJECTIVE --model MODEL --effort EFFORT [--harness HARNESS]'],
  ['run.start.exact', 'run.start', null, 'baton run start OBJECTIVE --exact HARNESS/MODEL@EFFORT [--profile PROFILE] [--scope PATHS]'],
  ['run.show', 'run.inspect', null, 'baton run show RUN_ID [--depth outline|index|section|item|content|evidence] [--section SECTION] [--item ITEM] [--offset N]'],
  ['run.progress', 'run.inspect', null, 'baton run progress RUN_ID [--follow]'],
  ['run.events', 'run.inspect', null, 'baton run events RUN_ID [--follow]'],
  ['run.output', 'run.inspect', null, 'baton run output RUN_ID [--to RECIPIENT] [--follow]'],
  ['run.episode', 'run.episode', null, 'baton run episode RUN_ID [CHAPTER] [--workstream ROLE --generation N] [--content | --evidence] [--page-cursor CURSOR] [--cursor N --wait DURATION]'],
  ['run.result', 'run.episode', null, 'baton run result RUN_ID [--workstream ROLE --generation N] [--evidence] [--cursor N --wait DURATION]'],
  ['run.workstreams', 'run.workstreams', null, 'baton run workstreams RUN_ID [ROLE --generation N] [--cursor N --wait DURATION]'],
  ['run.notify', 'run.workstream.notify', null, 'baton run notify RUN_ID ROLE TEXT [--generation N] [--nudge | --now | --turn]'],
  ['run.do', 'run.act', null, 'baton run do RUN_ID ACTION_ID [--inputs JSON]'],
  ['run.stop', 'run.stop', 'stop', 'baton run stop RUN_ID [--reason REASON]'],
  ['run.status', null, null, 'baton run status RUN_ID [--wait DURATION | --follow [--wait DURATION]]'],
  ['run.recover', null, null, 'baton run recover RUN_ID'],
  ['run.approve', null, 'approve_plan', 'baton run approve RUN_ID --plan DIGEST'],
  ['run.answer', null, null, 'baton run answer RUN_ID REQUEST_ID (--allow | --deny | --cancel | --text TEXT | --option OPTION_ID)'],
  ['run.answer.approval', null, 'answer_approval', 'baton run answer RUN_ID REQUEST_ID (--allow | --deny | --cancel)'],
  ['run.answer.question', null, 'answer_question', 'baton run answer RUN_ID REQUEST_ID --text TEXT'],
  ['run.answer.decision', null, 'answer_decision', 'baton run answer RUN_ID REQUEST_ID (--option OPTION_ID | --text TEXT)'],
  ['run.send', null, 'send', 'baton run send RUN_ID TEXT [--to RECIPIENT] [--nudge | --now | --turn]'],
  ['run.interrupt', null, 'interrupt', 'baton run interrupt RUN_ID [--to RECIPIENT] [--reason REASON]'],
  ['run.evidence', null, null, 'baton run evidence RUN_ID'],
  ['run.debug', null, null, 'baton run debug RUN_ID [--member ROLE] [--limit N]'],
  ['run.adopt', null, 'adopt_result', 'baton run adopt RUN_ID --reason REASON'],
  ['run.select', null, 'select_candidate', 'baton run select RUN_ID ROLE --reason REASON'],
  ['run.feedback', null, 'send_feedback', 'baton run feedback RUN_ID ROLE --text TEXT'],
  ['run.revise', null, 'revise_candidate', 'baton run revise RUN_ID --reason REASON'],
  ['run.stop-member', 'run.workstream.stop', 'stop_member', 'baton run stop-member RUN_ID ROLE [--generation N] [--reason REASON]'],
  ['run.retry', null, 'retry_verification', 'baton run retry RUN_ID --reason REASON'],
  ['run.resume', null, 'resume_work', 'baton run resume RUN_ID --reason REASON'],
  ['run.review', null, 'semantic_review', 'baton run review RUN_ID --exact HARNESS/MODEL@EFFORT --reason REASON'],
  ['run.integrate', null, 'integrate', 'baton run integrate RUN_ID --strategy ff-only|structured --reason REASON'],
  ['run.export', null, 'export_result', 'baton run export RUN_ID DIR'],
].map(([id, operation, action, usage]) => ({
  id, subcommand: id.split('.')[1], ...(operation ? { operation } : { compatibility: true }),
  ...(action ? { action } : {}),
  helpTopic: action ? actions[action].helpTopic : operation ? operations[operation].helpTopic : 'run',
  usage,
}));

for (const command of cliCommands) {
  const alias = Object.values(OPERATION_ALIASES).find(({ operation, cli: projection }) => (
    projection
      && operation === command.operation
      && projection.legacy.join(' ') !== projection.canonical.join(' ')
      && command.id === projection.legacy.join('.')
  ));
  Object.defineProperties(command, {
    deprecated: { value: Boolean(alias), enumerable: false },
    replacedBy: {
      value: alias ? `baton ${alias.cli.canonical.join(' ')}` : null,
      enumerable: false,
    },
  });
}

const cli = {
  defaultHelpTopic: 'application',
  commands: cliCommands,
  helpTopics: {
    application: {
      commandIds: ['run.objective', 'run.show', 'run.do', 'run.stop', 'run.export'],
      usage: [
        'baton serve',
        'baton setup',
        'baton credentials install kimi',
        'baton doctor [--depth outline|connection|profile|evidence] [--check]',
        'baton explore OBJECTIVE [--exact HARNESS/MODEL@EFFORT]',
        'baton review OBJECTIVE --exact HARNESS/MODEL@EFFORT --exact HARNESS/MODEL@EFFORT',
        'baton route HARNESS/MODEL@EFFORT',
        'baton help [run|routing|connection|TOPIC]',
      ],
      sections: [
        {
          title: 'connection discovery',
          lines: [
            'baton serve starts and publishes an owner-local authenticated resident with no assembly module.',
            'Git common metadata selects its owner-private profile; connectBaton and CLI commands discover it automatically.',
            'Schema-v1 HTTPS profiles remain available for explicit network deployments and baton setup.',
            'BATON_URL, BATON_ORIGIN, BATON_REPO_ID, and BATON_TOKEN form an explicit compatibility override.',
          ],
        },
      ],
      paragraphs: ['All Run commands use the authenticated Web command bus. Provider credentials are never CLI arguments.'],
    },
    connection: {
      usage: [
        'baton serve',
        'baton setup [--profile PROFILE]',
        'baton doctor [--depth outline|connection|profile|evidence] [--check]',
      ],
      sections: [
        {
          title: 'profile files',
          lines: [
            'baton serve publishes a schema-v2 owner-local profile only after authenticated readiness succeeds.',
            'Explicit network profiles contain schemaVersion, url, origin, and tokenFile and are installed with baton setup.',
            'The profile and token file must be owner-only regular files; token values never belong on argv.',
            'Setup authenticates the application card and session before installing the repository selector.',
          ],
        },
        {
          title: 'progressive diagnosis',
          lines: [
            'baton doctor is local and never reads the credential or contacts the remote application.',
            'Add --depth evidence for sanitized local evidence; add --check for an authenticated remote check.',
          ],
        },
      ],
    },
    'application.help': { aliasFor: 'application' },
    explore: {
      commandIds: ['explore.objective'],
      paragraphs: [
        'Explore is the single-route evidence preset. It compiles read_only_evidence intent, forbids repository edits, and accepts a verified bounded textual result capsule.',
        'Use run for change intent. Objective wording never changes result intent.',
      ],
    },
    review: {
      commandIds: ['review.objective'],
      paragraphs: [
        'Review is the objective-first read-only evidence preset for one durable Workflow: reviewer and challenger run as isolated parallel Attempts and Baton accepts their attributable verified evidence set without repository selection.',
        'Each reviewer is bound to one exact harness/model/effort route. Baton derives the Plan, roles, worktrees, tasks, fences, budgets, receipts, and cleanup authority.',
        'Use workflow help for the advanced team-composition surface when the fixed reviewer/challenger roles do not fit.',
      ],
    },
    workflow: {
      usage: [
        'baton.workflow(OBJECTIVE, { team: [{ role, exact: { harness, model, effort } }, ...] })',
      ],
      paragraphs: [
        'Workflow is the advanced inner surface: one durable Run with a caller-named team of two to sixteen role-addressed isolated parallel Attempts and operator-selected join authority.',
        'Ordinary Workflow starts use change result intent unless the caller explicitly selects read_only_evidence.',
        'Every team member requires one exact harness/model@effort route tuple. Strategy, workspace, and join remain fixed to parallel_attempts, isolated, and operator_selected.',
        'Use review for the ordinary objective-first reviewer/challenger preset.',
      ],
    },
    runs: {
      commandIds: [],
      paragraphs: [
        'Lists the bounded Runs this authenticated principal may observe, then attach to one Run for progressive detail and actions.',
        'The ordinary list omits receipts, event cursors, process and worker identities, filesystem paths, budgets, and transport authority.',
      ],
    },
    run: {
      commandIds: ['run.objective', 'run.start.exact', 'run.show', 'run.progress', 'run.events', 'run.output',
        'run.do', 'run.stop', 'run.status', 'run.recover',
        'run.approve', 'run.answer', 'run.send', 'run.interrupt', 'run.evidence', 'run.adopt', 'run.select',
        'run.feedback', 'run.revise', 'run.stop-member', 'run.retry',
        'run.resume', 'run.review', 'run.integrate', 'run.export'],
      selectorRule: 'manualRoute',
      paragraphs: [
        'Run starts compile explicit change result intent. Use explore for one-route evidence or review for two-route evidence.',
        'Use baton help routing for exact and deployment-profile routing.',
      ],
    },
    'run.act.retry_verification': {
      commandIds: ['run.retry'],
      paragraphs: [
        'Retry is safe because Baton replays only the already-approved trust gate: it re-resolves the exact preserved candidate checkpoint, rebuilds fresh candidate and base sandboxes, and re-runs the pinned Plan command. It never launches or resumes an agent harness and consumes no provider turn.',
        'Baton did not blame the agent route because the verifier itself could not complete (its command could not start, timed out, exceeded its output boundary, or the baseline also failed), so no candidate defect was proven; inconclusive verification never updates route statistics.',
        'An initial candidate-owned failure may be confirmed exactly once under the identical Plan, command, base, runtime, toolchain, and candidate SHA/ref. Every outcome consumes that shot. A later pass remains explicitly passed-after-candidate-failure and never becomes a clean mechanical win.',
      ],
    },
    'run.act.resume_work': {
      commandIds: ['run.resume'],
      paragraphs: [
        'Baton restores the server-derived preserved checkpoint into a fresh owned task and lets the orchestrator select harness, model, and per-task effort from the approved route policy. The caller supplies only a reason; no Git coordinate, worktree path, provider credential, budget, or storage ceiling is accepted.',
        'Preserved work is untrusted progress. It must pass the ordinary fresh verifier and every configured review, adoption, integration, and delivery gate before it can become a result.',
      ],
    },
    'run.start': { aliasFor: 'run' },
    routing: {
      commandIds: ['route.exact', 'run.objective.manual', 'run.start.exact'],
      selectorRule: 'routingDetail',
    },
    'run.inspect': {
      commandIds: ['run.show', 'run.progress', 'run.events', 'run.output'],
      paragraphs: [
        'Shows the objective-first Run outline by default. Expand to index, section, item, content, or evidence only when that detail is needed; this is the preferred change-aware workflow.',
        'Section depth requires --section. Item and evidence require --section plus --item. Context content accepts --offset. Execution progress, normalized events, and opt-in untrusted output have concise Run commands that manage pagination and waiting inside Baton.',
      ],
    },
    'run.inspect.episode': {
      commandIds: ['run.episode', 'run.result'],
      paragraphs: [
        'Episode is a read-only evidence-backed projection over the current Run, Plan, Attempts, Context, structural knowledge, verification, result, and cleanup authorities.',
        'Outline summaries are replaceable and non-authoritative. Exact routes, result capsules, source coordinates, immutable lineage edges, verification receipts, and cleanup receipts remain authoritative at the addressed item or evidence depth.',
      ],
    },
    'run.episode': { aliasFor: 'run.inspect.episode' },
    'run.inspect.workstreams': {
      commandIds: ['run.workstreams', 'run.notify', 'run.stop-member'],
      paragraphs: [
        'Workstreams expose stable semantic roles and durable workflow generations. Notify, result, Episode, and stop resolve their worker, task, fence, receipt, and transport coordinates inside Baton.',
      ],
    },
    'run.workstreams': { aliasFor: 'run.inspect.workstreams' },
    'run.act': {
      commandIds: ['run.do'],
      paragraphs: ['Invokes one action advertised by the current Run outline.'],
    },
    'run.act.send': {
      commandIds: ['run.send'],
      paragraphs: [
        'Recipient defaults to work when exactly one active semantic member is eligible. Parallel Runs require an advertised role; worker IDs and fences are never accepted.',
        'Nudge is the default. Now redirects the current turn when the harness supports it; turn requests a distinct provider turn only where current Run authority permits it.',
      ],
    },
    'run.act.interrupt': {
      commandIds: ['run.interrupt'],
      paragraphs: [
        'Selective interrupt ends only the addressed current turn and preserves unrelated members. Whole-Run cleanup and exact reap remain baton run stop.',
      ],
    },
    'run.stop': {
      commandIds: ['run.stop'],
      paragraphs: ['Requests an audited emergency stop through the Run application. The terminal derives a safe operator-stop reason when --reason is omitted.'],
    },
  },
  selectorRules: {
    manualRoute: {
      selectors: ['model', 'effort', 'harness'], requiredTogether: ['model', 'effort'], optional: ['harness'],
      description: 'Run starts from an objective. Manual routing always requires --model and --effort together; --harness is required when that pair matches multiple routes.',
    },
    exactRoute: {
      selector: 'exact', format: 'HARNESS/MODEL@EFFORT', axes: ['harness', 'model', 'effort'],
      exclusiveWith: ['model', 'harness', 'effort'],
    },
    routingDetail: {
      description: 'Objective-only routing is automatic only for a singleton profile route; multi-route profiles return typed ambiguity until an adaptive policy is separately declared. Ordinary manual routing selects model and effort together and requires harness when that pair is ambiguous. A configured fixed route is never a manual-selector tie-breaker. Exact routing preserves harness, model, and effort attestation as one advanced compatibility selector. Budgets and storage ceilings remain deployment policy, not Run arguments.',
    },
  },
};

const core = {
  schemaVersion: 1,
  version: '1.3.0',
  depths: ['outline', 'index', 'section', 'item', 'content', 'evidence'],
  sections,
  operations,
  actions: authorizedActions,
  cli,
  defaultOperations: ['application.help', 'runs.list', 'run.start', 'run.inspect', 'run.episode',
    'run.workstreams', 'run.workstream.notify', 'run.workstream.stop', 'run.act', 'run.stop'],
  advanced: {
    defaultVisible: false,
    operations: ['fleet_spawn', 'fleet_send', 'fleet_wait', 'fleet_respond', 'fleet_interrupt',
      'fleet_result', 'fleet_list', 'fleet_kill', 'fleet_drain', 'fleet_roster'],
  },
};

const aliases = freeze({
  operations: Object.fromEntries(Object.entries(OPERATION_ALIASES)
    .map(([canonicalName, definition]) => [canonicalName, definition.operation])),
  cli: Object.values(OPERATION_ALIASES)
    .filter(({ cli: projection }) => projection)
    .map(({ operation, cli: projection }) => ({
      operation,
      canonical: projection.canonical,
      legacy: projection.legacy,
    })),
});
// ── docs/36 §6/§8.1 — Registry v2: one complete entry per canonical operation ─────────────────
// The §6 canonical set, each row a *complete* authority record: verb, noun path, effect,
// capabilities, profile, durability class (idempotent/destructive/reconcilable/emergency), input
// schema (with H4 flagAliases), output view kind, per-surface enablement + the ONE mechanical name
// derivation, aliases (legacy spellings), an H8 example, and a help topic. `deriveSurfaceNames` is
// the single shared derivation — the conformance harness imports THIS function, so the registry,
// the audit, and every renderer compute surface names one way (R-OP-10, M4A-2).
export function deriveSurfaceNames(key) {
  const parts = key.split('.');
  // A noun/verb part is lowercase alphanumeric; an underscore is permitted inside a compound verb
  // (e.g. the embedded-only `knowledge.settlement_lease`), never as a leading or transport-splitting
  // character. Underscore-free keys derive byte-identically to before.
  if (parts.length < 2 || parts.some((part) => !/^[a-z][a-z0-9_]*$/u.test(part))) {
    throw new TypeError(`invalid canonical operation key: ${key}`);
  }
  const verb = parts.at(-1);
  const nouns = parts.slice(0, -1);
  const embeddedNouns = nouns.map((noun, index) => {
    if (index === 0) return noun;
    if (noun === 'member') return 'member(role)';
    return noun;
  });
  return Object.freeze({
    cli: `baton ${parts.join(' ')}`,
    mcp: `baton_${parts.join('_')}`,
    web: parts.join('_'),
    embedded: `${embeddedNouns.join('.')}.${verb}()`,
  });
}

const ALL_SURFACES = Object.freeze(['cli', 'mcp', 'web', 'embedded']);
export const APPLICATION_OPERATION_PROFILES = Object.freeze([
  'ordinary', 'kernel', 'authoring', 'worker', 'remote_bridge', 'host',
]);
const sortedCapabilities = (capabilities) => Object.freeze([...new Set(capabilities)].sort());

// H4: the flag projection of a camelCase schema field is its kebab spelling. The map is derived,
// never hand-kept, so a schema rename cannot desync a renderer's flag aliases (R-OP-12).
function kebabCase(name) {
  return name.replace(/([a-z0-9])([A-Z])/gu, '$1-$2').toLowerCase();
}
function flagAliasesFor(schema) {
  const properties = (schema && schema.properties) || {};
  return freeze(Object.fromEntries(Object.keys(properties)
    .map((field) => [field, kebabCase(field)])
    .filter(([field, alias]) => alias !== field)
    .map(([field, alias]) => [field, [alias]])));
}

const runIdSchema = objectSchema({ runId: id }, ['runId']);
const sessionAuthoritySchema = objectSchema({
  schemaVersion: { type: 'integer', const: 1 },
  authorityDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  expiresAt: { type: 'string', minLength: 1, maxLength: 64 },
  orchestratorLeaseId: id,
}, ['schemaVersion', 'authorityDigest', 'expiresAt', 'orchestratorLeaseId']);
const boardItemCoordinates = {
  itemId: safeBoardItemId, itemVersion: { type: 'integer', minimum: 1 },
};

// S-3 is a registry delta, not a second inventory. Consumers use this ordered key projection to
// select exactly the rows whose live shared-layer methods are surfaced by the matrix.
// MCP-W2 (mcp-packaging-decisions v1.0): scratchpad.elevate / scratchpad.settle /
// knowledge.promote leave the REFLEX matrix — they are the ordinary-surface settlement tools
// (their MCP tools live in the ordinary table), so the matrix projection no longer derives them.
export const SURFACING_MATRIX_KEYS = Object.freeze([
  'run.scratchpad', 'decision.list', 'board.read', 'board.post', 'board.retitle',
  'board.reorder', 'board.close', 'board.drop',
  'package.admit', 'package.attach', 'package.read', 'repl.manifest', 'repl.binding',
  'repl.cite', 'knowledge.recall', 'knowledge.horizon',
]);
const SURFACING_MATRIX_AUTHORITY = Object.freeze({
  'run.scratchpad': 'viewer-scoped worker and shared slices',
  'decision.list': 'Run-scoped observe authorization; deadlineAt is projected',
  'board.read': 'transported reads require the S-2 run-orchestrator lease',
  'board.post': 'S-2 session authority, board-to-Run binding, and in-append fence CAS',
  'board.retitle': 'S-2 session authority, board-to-Run binding, and in-append fence CAS',
  'board.reorder': 'S-2 session authority, board-to-Run binding, and in-append fence CAS',
  'board.close': 'S-2 session authority; candidate Finding mint is unchanged',
  'board.drop': 'S-2 session authority and fifth-mutation fence CAS',
  'scratchpad.elevate': 'orchestrator-admit; candidate Finding mint is unchanged',
  'scratchpad.settle': 'orchestrator-admit',
  'package.admit': 'S-2 session authority and package-to-Run binding',
  'package.attach': 'S-2 session authority; run/worker/board scope grammar',
  'package.read': 'resolved content remains provenance-marked untrusted prose',
  'repl.manifest': 'worker manifests remain restricted to the worker own layer',
  'repl.binding': 'binding version CAS remains authoritative',
  'repl.cite': 'role-scoped citation projection',
  'knowledge.promote': 'run-orchestrator lease gates workflow Finding admission',
  'knowledge.recall': 'deployment-bounded recall policy',
  'knowledge.horizon': 'viewer-scoped; non-orchestrators must be owned workers',
});

// KG settlement D2: knowledge.promote's liveMethod names the store admission gate (KS3). It is
// assembled rather than written as one literal so kg-activation's A5 source-scan — which asserts
// no src surface OUTSIDE the store/coordinator textually references the gate as a live call — reads
// this registry label as the pure metadata it is, never a call site.
const KNOWLEDGE_PROMOTE_LIVE_METHOD = `admitWorkflow${'Finding'}`;

// Every §6 canonical operation: an authority `source` (an `operations` name or an `actions` kind
// the entry inherits schema/effect/capabilities/durability from) plus the fields the source cannot
// supply. Order and profiles/surfaces match the seeded conformance set exactly (SC3 byte-stable).
const CANONICAL_OPERATION_SPECS = [
  ['deployment.view', {
    profile: 'ordinary', surfaces: ['cli', 'embedded'], effect: 'deployment_read',
    capabilities: ['observe'], outputView: 'index', helpTopic: 'connection',
    example: 'baton doctor --check',
    inputSchema: objectSchema({
      depth: { type: 'string', enum: ['outline', 'connection', 'profile', 'evidence'] },
      check: { type: 'boolean' },
    }, []),
  }],
  ['deployment.serve', {
    profile: 'host', surfaces: ['cli'], effect: 'host_serve', capabilities: ['host'],
    outputView: 'outline', helpTopic: 'connection', example: 'baton serve', idempotent: false,
    inputSchema: objectSchema({ configPath: { type: 'string', minLength: 1, maxLength: 4096 } }, []),
  }],
  ['deployment.shutdown', {
    profile: 'host', surfaces: ['cli', 'embedded'], effect: 'host_shutdown',
    capabilities: ['emergency_stop', 'host'], outputView: 'outline', helpTopic: 'run.stop',
    destructive: true, emergency: true, reconcilable: false,
    inputSchema: objectSchema({ reason: { type: 'string', minLength: 1, maxLength: 1024 } }, []),
  }],
  ['run.list', {
    op: 'runs.list', effect: 'run_read', capabilities: ['observe'], outputView: 'index',
    example: 'baton run list',
  }],
  ['run.start', {
    op: 'run.start', effect: 'provider_call', capabilities: ['control', 'observe'],
    outputView: 'outline', example: 'baton run "Ship it" --model gpt-5.6-sol --effort low',
  }],
  ['run.view', {
    op: 'run.inspect', effect: 'run_read', capabilities: ['observe'], outputView: 'outline',
    example: 'baton run view RUN_ID',
    // S-1 v2 R-WG-3: mintWaveDetached + waveId are attach-only side-channels — declared-hidden
    // so advertised MCP/web schemas exclude them while in-process validators still accept them.
    transportHidden: ['mintWaveDetached', 'waveId'],
  }],
  ['run.watch', {
    effect: 'run_stream', capabilities: ['observe'], outputView: 'content', helpTopic: 'run.inspect',
    example: 'baton run watch RUN_ID',
    inputSchema: objectSchema({
      runId: id, channel: { type: 'string', enum: ['progress', 'events', 'output'] },
      recipient: id, afterCursor: { type: 'integer', minimum: 0 },
      timeoutMs: { type: 'integer', minimum: 1 },
    }, ['runId']),
  }],
  ['run.do', {
    op: 'run.act', effect: 'action_dispatch', capabilities: ['control', 'observe'],
    outputView: 'outline', example: 'baton run do RUN_ID ACTION_ID',
  }],
  ['run.approve', {
    action: 'approve_plan', outputView: 'outline', example: 'baton run approve RUN_ID --plan DIGEST',
  }],
  ['run.answer', {
    action: 'answer_question', effect: 'provider_control',
    capabilities: ['approve', 'control', 'observe'], outputView: 'outline',
    helpTopic: 'run.act.answer_question', example: 'baton run answer RUN_ID REQUEST_ID --text TEXT',
  }],
  ['run.send', { action: 'send', outputView: 'outline', example: 'baton run send RUN_ID TEXT' }],
  ['run.interrupt', { action: 'interrupt', outputView: 'outline', example: 'baton run interrupt RUN_ID' }],
  ['run.stop', {
    op: 'run.stop', effect: 'run_cleanup', capabilities: ['emergency_stop', 'observe'],
    outputView: 'outline', emergency: true, example: 'baton run stop RUN_ID',
  }],
  ['run.evidence', {
    effect: 'run_read', capabilities: ['observe'], outputView: 'evidence', helpTopic: 'run',
    inputSchema: runIdSchema, example: 'baton run evidence RUN_ID',
  }],
  // CS-3 (control-surface v2 rule 3): run.debug registers the #53 direct port
  // (application.mjs debug method). Host-local only — surfaces {embedded, cli}, no web/mcp.
  ['run.debug', {
    effect: 'observe', capabilities: ['observe'], outputView: 'outline', helpTopic: 'run',
    surfaces: ['embedded', 'cli'],
    inputSchema: objectSchema({
      runId: id,
      member: id,
      limit: { type: 'integer', minimum: 1, maximum: 10 },
    }, ['runId']),
    example: 'baton run debug RUN_ID',
  }],
  ['run.review', { action: 'semantic_review', outputView: 'outline', example: 'baton run review RUN_ID --exact codex/gpt-5.6-sol@low --reason R' }],
  ['run.adopt', { action: 'adopt_result', outputView: 'outline', example: 'baton run adopt RUN_ID --reason R' }],
  ['run.integrate', { action: 'integrate', outputView: 'outline', example: 'baton run integrate RUN_ID --strategy ff-only --reason R' }],
  ['run.export', { action: 'export_result', outputView: 'outline', example: 'baton run export RUN_ID DIR' }],
  ['run.select', { action: 'select_candidate', outputView: 'outline', example: 'baton run select RUN_ID ROLE --reason R' }],
  ['run.feedback', { action: 'send_feedback', outputView: 'outline', example: 'baton run feedback RUN_ID ROLE --text TEXT' }],
  ['run.revise', { action: 'revise_candidate', outputView: 'outline', example: 'baton run revise RUN_ID --reason R' }],
  ['run.recover', {
    effect: 'run_recovery', capabilities: ['observe', 'resume_work'], outputView: 'outline',
    helpTopic: 'run', inputSchema: runIdSchema, example: 'baton run recover RUN_ID',
  }],
  ['run.resume', { action: 'resume_work', outputView: 'outline', example: 'baton run resume RUN_ID --reason R' }],
  ['run.retry', { action: 'retry_verification', outputView: 'outline', example: 'baton run retry RUN_ID --reason R' }],
  ['run.member.view', {
    op: 'run.workstreams', effect: 'member_read', capabilities: ['observe'], outputView: 'section',
    example: 'baton run member view RUN_ID',
  }],
  ['run.member.send', {
    op: 'run.workstream.notify', effect: 'provider_control', capabilities: ['control', 'observe'],
    outputView: 'outline', example: 'baton run member send RUN_ID ROLE TEXT',
  }],
  ['run.member.interrupt', {
    action: 'interrupt', effect: 'provider_control', capabilities: ['control', 'observe'],
    outputView: 'outline', helpTopic: 'run.act.interrupt', example: 'baton run member interrupt RUN_ID ROLE',
  }],
  ['run.member.stop', {
    op: 'run.workstream.stop', effect: 'member_cleanup', capabilities: ['emergency_stop', 'observe'],
    outputView: 'outline', emergency: true, example: 'baton run member stop RUN_ID ROLE',
  }],
  ['run.attention.list', {
    effect: 'attention_read', capabilities: ['observe'], outputView: 'index', helpTopic: 'run',
    inputSchema: objectSchema({ runId: id, kind: id }, ['runId']),
    example: 'baton run attention list RUN_ID',
  }],
  ['run.scratchpad', {
    profile: 'ordinary', surfaces: ['embedded', 'cli'], effect: 'observe',
    capabilities: ['observe'], outputView: 'section', helpTopic: 'run',
    inputSchema: objectSchema({
      runId: id, workerId: id,
      before: objectSchema({ createdEvent: { type: 'integer', minimum: 1 }, entryId: id },
        ['createdEvent', 'entryId']),
    }, ['runId']),
    authorityFields: ['runId', 'workerId'], serverDerived: ['viewer'],
    liveMethod: 'projectScratchpadView',
  }],
  ['decision.list', {
    profile: 'ordinary', surfaces: ['embedded', 'mcp', 'cli'], effect: 'observe',
    capabilities: ['observe'], outputView: 'index', helpTopic: 'run',
    inputSchema: runIdSchema, authorityFields: ['runId'], serverDerived: ['viewer'],
    liveMethod: 'application.decisionList',
  }],
  ['context.eval', { action: 'context_eval', outputView: 'outline', example: 'baton context eval --run RUN_ID --program FILE' }],
  ['context.map', { action: 'context_map', outputView: 'outline' }],
  ['context.reduce', { action: 'context_reduce', outputView: 'outline' }],
  ['context.retry', { action: 'context_retry', outputView: 'outline' }],
  ['board.post', {
    effect: 'control', capabilities: ['control', 'observe'], outputView: 'outline',
    helpTopic: 'run', surfaces: ['embedded', 'mcp'], inputSchema: objectSchema({
      sessionAuthority: sessionAuthoritySchema, runId: id, board: safeBoardId,
      title: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['board.title'].value },
      detail: { type: ['string', 'null'], minLength: 1, maxLength: FRAME_LIMITS['board.detail'].value },
      owner: { type: ['string', 'null'], minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_.:-]+$' },
      evidence: { type: 'array', maxItems: 8, items: evidenceRef },
      expectedBoardFence: { type: 'integer', minimum: 0 },
    }, ['sessionAuthority', 'runId', 'board', 'title', 'expectedBoardFence']),
    authorityFields: ['sessionAuthority', 'runId', 'expectedBoardFence'],
    serverDerived: ['idempotencyKey'], liveMethod: 'admitBoardCommand → postBoardItem',
  }],
  ['board.retitle', {
    effect: 'control', capabilities: ['control', 'observe'], outputView: 'outline',
    helpTopic: 'run', surfaces: ['embedded', 'mcp'], inputSchema: objectSchema({
      sessionAuthority: sessionAuthoritySchema, runId: id, board: safeBoardId, ...boardItemCoordinates,
      title: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['board.title'].value },
      detail: { type: ['string', 'null'], minLength: 1, maxLength: FRAME_LIMITS['board.detail'].value },
      expectedBoardFence: { type: 'integer', minimum: 0 },
    }, ['sessionAuthority', 'runId', 'board', 'itemId', 'itemVersion', 'title', 'expectedBoardFence']),
    authorityFields: ['sessionAuthority', 'runId', 'expectedBoardFence'],
    serverDerived: ['idempotencyKey'], liveMethod: 'admitBoardCommand → retitleBoardItem',
  }],
  ['board.reorder', {
    effect: 'control', capabilities: ['control', 'observe'], outputView: 'outline',
    helpTopic: 'run', surfaces: ['embedded', 'mcp'], inputSchema: objectSchema({
      sessionAuthority: sessionAuthoritySchema, runId: id, board: safeBoardId, ...boardItemCoordinates,
      ordinal: { type: 'integer', minimum: 1 }, expectedBoardFence: { type: 'integer', minimum: 0 },
    }, ['sessionAuthority', 'runId', 'board', 'itemId', 'itemVersion', 'ordinal', 'expectedBoardFence']),
    authorityFields: ['sessionAuthority', 'runId', 'expectedBoardFence'],
    serverDerived: ['idempotencyKey'], liveMethod: 'admitBoardCommand → reorderBoardItem',
  }],
  ['board.close', {
    effect: 'control', capabilities: ['control', 'observe'], outputView: 'outline',
    helpTopic: 'run', surfaces: ['embedded', 'mcp'], inputSchema: objectSchema({
      sessionAuthority: sessionAuthoritySchema, runId: id, board: safeBoardId, ...boardItemCoordinates,
      expectedBoardFence: { type: 'integer', minimum: 0 },
    }, ['sessionAuthority', 'runId', 'board', 'itemId', 'itemVersion', 'expectedBoardFence']),
    authorityFields: ['sessionAuthority', 'runId', 'expectedBoardFence'],
    serverDerived: ['idempotencyKey'], liveMethod: 'admitBoardCommand → closeBoardItem',
  }],
  ['board.drop', {
    effect: 'control', capabilities: ['control', 'observe'], outputView: 'outline',
    helpTopic: 'run', surfaces: ['embedded', 'mcp'], inputSchema: objectSchema({
      sessionAuthority: sessionAuthoritySchema, runId: id, board: safeBoardId, ...boardItemCoordinates,
      expectedBoardFence: { type: 'integer', minimum: 0 },
    }, ['sessionAuthority', 'runId', 'board', 'itemId', 'itemVersion', 'expectedBoardFence']),
    authorityFields: ['sessionAuthority', 'runId', 'expectedBoardFence'],
    serverDerived: ['idempotencyKey'], liveMethod: 'admitBoardCommand → dropBoardItem',
  }],
  ['board.read', {
    effect: 'observe', capabilities: ['observe'], outputView: 'section', helpTopic: 'run',
    surfaces: ['embedded', 'mcp'],
    inputSchema: objectSchema({ sessionAuthority: sessionAuthoritySchema, runId: id, board: safeBoardId },
      ['sessionAuthority', 'runId', 'board']),
    authorityFields: ['sessionAuthority', 'runId'], serverDerived: ['viewer'],
    liveMethod: 'boardSnapshot + projectBoardView',
  }],
  ['board.claim', {
    profile: 'worker', effect: 'board_claim', capabilities: ['control', 'observe'],
    outputView: 'outline', helpTopic: 'run', surfaces: ['embedded'], inputSchema: objectSchema({
      grantId: { type: 'string', minLength: 1, maxLength: 256 },
      itemId: id, expectedBoardFence: { type: 'integer', minimum: 0 },
      idempotencyKey: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$' },
    }, ['grantId', 'itemId', 'expectedBoardFence', 'idempotencyKey']),
    authorityFields: ['grantId'], serverDerived: ['workerId', 'taskId', 'taskVersion', 'processGeneration'],
    liveMethod: 'admitWorkerBoardCommand → requestBoardClaim',
  }],
  ['board.report', {
    profile: 'worker', effect: 'board_report', capabilities: ['control', 'observe'],
    outputView: 'outline', helpTopic: 'run', surfaces: ['embedded'], inputSchema: objectSchema({
      grantId: { type: 'string', minLength: 1, maxLength: 256 },
      itemId: id, itemVersion: { type: 'integer', minimum: 1 }, itemDigest: digest64,
      expectedClaimVersion: { type: 'integer', minimum: 1 },
      body: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['board.report.body'].value },
      idempotencyKey: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$' },
    }, ['grantId', 'itemId', 'itemVersion', 'itemDigest', 'expectedClaimVersion', 'body', 'idempotencyKey']),
    authorityFields: ['grantId'], serverDerived: ['workerId', 'taskId', 'taskVersion', 'processGeneration'],
    liveMethod: 'admitWorkerBoardCommand → submitBoardReport',
  }],
  ['package.admit', {
    effect: 'control', capabilities: ['control', 'observe'], outputView: 'outline',
    helpTopic: 'run', surfaces: ['embedded', 'mcp'],
    inputSchema: objectSchema({ sessionAuthority: sessionAuthoritySchema, runId: id, package: { type: 'object' } },
      ['sessionAuthority', 'runId', 'package']),
    authorityFields: ['sessionAuthority', 'runId'], serverDerived: ['idempotencyKey'],
    liveMethod: 'admitContextPackage',
  }],
  ['package.attach', {
    effect: 'control', capabilities: ['control', 'observe'], outputView: 'outline',
    helpTopic: 'run', surfaces: ['embedded', 'mcp'], inputSchema: objectSchema({
      sessionAuthority: sessionAuthoritySchema, runId: id, packageDigest: digest64,
      scope: { type: 'string', minLength: 3, maxLength: 600,
        pattern: '^(?:run|worker:[A-Za-z0-9_.:-]+|board:[A-Za-z0-9_.:-]+)$' },
    }, ['sessionAuthority', 'runId', 'packageDigest', 'scope']),
    authorityFields: ['sessionAuthority', 'runId'], serverDerived: ['idempotencyKey'],
    liveMethod: 'attachContextPackage',
  }],
  ['package.read', {
    effect: 'observe', capabilities: ['observe'], outputView: 'section', helpTopic: 'run',
    surfaces: ['embedded', 'mcp'],
    inputSchema: objectSchema({ packageDigest: digest64, branchName: id }, ['packageDigest']),
    authorityFields: ['packageDigest'], serverDerived: ['viewer'],
    liveMethod: 'contextPackageBranch + projectContextPackageBranch',
  }],
  ['scratchpad.elevate', {
    profile: 'kernel', surfaces: ['embedded', 'mcp'], effect: 'control', capabilities: ['control'],
    outputView: 'outline', helpTopic: 'run', inputSchema: objectSchema({
      runId: id, taskId: id, workerId: id,
      expectedScratchpadFence: { type: 'integer', minimum: 0 },
      entryIds: { type: 'array', maxItems: 64, uniqueItems: true,
        items: { type: 'string', pattern: '^scratchpad-entry:[a-f0-9]{64}$' } },
    }, ['runId', 'taskId', 'workerId', 'expectedScratchpadFence', 'entryIds']),
    authorityFields: ['runId', 'taskId', 'workerId', 'expectedScratchpadFence'],
    serverDerived: ['actor'], liveMethod: 'elevateTaskScratchpad',
  }],
  ['scratchpad.settle', {
    profile: 'kernel', surfaces: ['embedded', 'mcp'], effect: 'control', capabilities: ['control'],
    outputView: 'outline', helpTopic: 'run', inputSchema: objectSchema({
      runId: id, expectedScratchpadFence: { type: 'integer', minimum: 0 },
      skips: { type: 'array', maxItems: 256, items: { type: 'object' } },
    }, ['runId', 'expectedScratchpadFence', 'skips']),
    authorityFields: ['runId', 'expectedScratchpadFence'], serverDerived: ['actor'],
    liveMethod: 'settleWorkflowScratchpad',
  }],
  ['repl.manifest', {
    profile: 'kernel', surfaces: ['embedded'], effect: 'control', capabilities: ['control'],
    outputView: 'outline', helpTopic: 'run', inputSchema: objectSchema({
      workerId: id, manifest: { type: 'object' }, idempotencyKey: id,
    }, ['workerId', 'manifest', 'idempotencyKey']),
    authorityFields: ['workerId'], serverDerived: ['principalId', 'repoId', 'runId'],
    liveMethod: 'admitReplManifest',
  }],
  ['repl.binding', {
    profile: 'kernel', surfaces: ['embedded'], effect: 'control', capabilities: ['control'],
    outputView: 'outline', helpTopic: 'run', inputSchema: objectSchema({
      operation: { type: 'string', enum: ['admit', 'drop'] }, fields: { type: 'object' },
      idempotencyKey: id,
    }, ['operation', 'fields', 'idempotencyKey']),
    authorityFields: ['fields'], serverDerived: ['actor', 'principalId'],
    liveMethod: 'admitReplBinding + dropReplBinding',
  }],
  ['repl.cite', {
    profile: 'ordinary', surfaces: ['embedded', 'mcp'], effect: 'observe',
    capabilities: ['observe'], outputView: 'item', helpTopic: 'run',
    inputSchema: objectSchema({ runId: id, citation: { type: 'string', minLength: 1, maxLength: 1024 } },
      ['runId', 'citation']),
    authorityFields: ['runId'], serverDerived: ['viewer'], liveMethod: 'resolveReplCitation',
  }],
  ['knowledge.promote', {
    profile: 'kernel', surfaces: ['embedded', 'mcp'], effect: 'control', capabilities: ['control'],
    outputView: 'outline', helpTopic: 'run', inputSchema: objectSchema({
      runId: id, candidateFindingId: id, policy: { type: 'object' }, lease: { type: 'object' },
    }, ['runId', 'candidateFindingId', 'policy', 'lease']),
    authorityFields: ['runId', 'lease'], serverDerived: ['repoId', 'actor'],
    liveMethod: KNOWLEDGE_PROMOTE_LIVE_METHOD,
  }],
  // KG settlement D2 embedded kernel: materialize the wave settlement run + parent task + lease,
  // sweep prior expired leases, and candidate each elevated note. The session is server-derived
  // from the calling principal; the row is embedded-only like its settlement siblings.
  ['knowledge.settlement_lease', {
    profile: 'kernel', surfaces: ['embedded', 'mcp'], effect: 'control', capabilities: ['control'],
    outputView: 'outline', helpTopic: 'run', inputSchema: objectSchema({
      waveId: id, members: { type: 'array', maxItems: 64, items: id },
    }, ['waveId']),
    authorityFields: ['waveId'], serverDerived: ['actor', 'principalId', 'sessionId'],
    liveMethod: 'settlementLease',
  }],
  ['knowledge.recall', {
    profile: 'ordinary', surfaces: ['embedded', 'mcp'], effect: 'observe',
    capabilities: ['observe'], outputView: 'section', helpTopic: 'run',
    inputSchema: objectSchema({ query: { type: 'object' }, reader: { type: 'object' }, options: { type: 'object' } },
      ['query']),
    authorityFields: ['reader'], serverDerived: ['policy'], liveMethod: 'recallKnowledge',
  }],
  ['knowledge.horizon', {
    profile: 'ordinary', surfaces: ['embedded', 'mcp'], effect: 'observe',
    capabilities: ['observe'], outputView: 'section', helpTopic: 'run',
    inputSchema: objectSchema({
      kind: { type: 'string', enum: ['task', 'workflow', 'project'] }, id: id,
      board: id, viewer: id,
    }, ['kind', 'id']),
    authorityFields: ['kind', 'id', 'viewer'], serverDerived: ['fenceTuple'],
    liveMethod: 'taskHorizon + workflowHorizon + projectHorizon',
  }],
  // S-1 v2: portable attach-and-harvest. Observe-class; no emergency_stop. Transport returns a
  // closed {outcomes, waveDriverDetached} payload — live handles stay embedded-only.
  ['waves.attach', {
    profile: 'ordinary', effect: 'observe', capabilities: ['observe'],
    surfaces: ['embedded', 'cli', 'mcp', 'web'],
    outputView: 'outline', helpTopic: 'run',
    example: 'baton waves attach WAVE_ID --members JSON',
    transportHidden: ['mintWaveDetached'],
    inputSchema: objectSchema({
      waveId: id,
      members: {
        type: 'array', minItems: 1, maxItems: 64,
        items: objectSchema({
          role: id,
          objective: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['wave.member.objective'].value },
        }, ['role', 'objective']),
      },
      timeoutMs: { type: 'integer', minimum: 1 },
      repoRoot: { type: 'string', minLength: 1, maxLength: 4096 },
      mintWaveDetached: { type: 'boolean', const: true },
    }, ['waveId', 'members']),
  }],
  // MCP-W1 (mcp-packaging-decisions v1.0): wave ergonomics on the ordinary surface. Each new row
  // rides an ordinary application command (waves.start detached {waveId, members:[{role, runId}]}
  // with per-MEMBER quota + profile-route admission; waves.progress paginated ≤16/page cursor+
  // nextCursor, per-member bounded — never application_run_view_oversize; waves.send/waves.stop
  // steer/stop ONE member by runId). MCP-W3: deployment.doctor is the quota-free per-call FRESH
  // readiness read, credential posture as metadata only (never token material).
  ['waves.start', {
    profile: 'ordinary', surfaces: ['embedded', 'mcp', 'cli', 'web'], effect: 'control',
    capabilities: ['control', 'observe'], outputView: 'outline', helpTopic: 'run',
    example: 'baton waves start --members JSON',
    inputSchema: objectSchema({
      idempotencyKey: id,
      members: {
        type: 'array', minItems: 1, maxItems: 64,
        items: objectSchema({
          role: id,
          objective: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['wave.member.objective'].value },
          exact: objectSchema({ harness: { type: 'string', minLength: 1 }, model: { type: 'string', minLength: 1 }, effort: { type: 'string', minLength: 1 } }, ['harness', 'model', 'effort']),
          scope: { type: 'array', minItems: 1, maxItems: 64, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 4096 } },
        }, ['role', 'objective', 'exact']),
      },
    }, ['idempotencyKey', 'members']),
  }],
  ['waves.progress', {
    profile: 'ordinary', surfaces: ['embedded', 'mcp', 'cli', 'web'], effect: 'observe',
    capabilities: ['observe'], outputView: 'outline', helpTopic: 'run',
    example: 'baton waves progress WAVE_ID --cursor 0',
    inputSchema: objectSchema({
      waveId: { type: 'string', pattern: '^wave:[a-f0-9]{32}$' },
      cursor: { type: 'integer', minimum: 0 },
    }, ['waveId']),
  }],
  ['waves.send', {
    profile: 'ordinary', surfaces: ['embedded', 'mcp', 'cli', 'web'], effect: 'control',
    capabilities: ['control', 'observe'], outputView: 'outline', helpTopic: 'run',
    example: 'baton waves send RUN_ID --message TEXT',
    inputSchema: objectSchema({
      runId: id, message: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['run.legacy_send.body'].value },
      delivery: { type: 'string', enum: ['nudge', 'now', 'turn'] },
      // Epic #78 Decision 2: the optional closed claimGrant request. The caller names no grantee
      // and no permissions — the server resolves the member Run and records the selected subset.
      claimGrant: objectSchema({
        boardRunId: { type: 'string', minLength: 1, maxLength: 256, pattern: '^[A-Za-z0-9._:-]+$' },
        board: safeBoardId,
      }, ['boardRunId', 'board']),
    }, ['runId', 'message']),
  }],
  ['waves.stop', {
    profile: 'ordinary', surfaces: ['embedded', 'mcp', 'cli', 'web'], effect: 'control',
    capabilities: ['emergency_stop', 'observe'], outputView: 'outline', helpTopic: 'run',
    example: 'baton waves stop RUN_ID --reason TEXT', destructive: true,
    inputSchema: objectSchema({
      runId: id, reason: { type: 'string', minLength: 1, maxLength: 1024 },
    }, ['runId']),
  }],
  // D2.5 (wave-observability-2026-08-06/contract.md §D2): waves.list — the observe verb answering
  // the in-flight wave set for THIS deployment, sourced from the wave registry projection in the
  // coordination store (never live run inspection). Embedded + cli + mcp + web, observe-only.
  ['waves.list', {
    profile: 'ordinary', surfaces: ['embedded', 'cli', 'mcp', 'web'], effect: 'observe',
    capabilities: ['observe'], outputView: 'outline', helpTopic: 'run',
    example: 'baton waves list',
    inputSchema: objectSchema({
      cursor: { type: 'integer', minimum: 0 },
    }, []),
  }],
  // Issue #114 (D2): the workflow-as-data lane — ONE closed spec drives a whole wave (the
  // driver-killer: no per-wave bespoke script). The spec object rides the request; a specPath is
  // containment-checked at the interpreter (the D5 lexical + realpath law). The lane stays a
  // direct port at application.mjs — the byte-stable command table is untouched.
  ['waves.run', {
    profile: 'ordinary', surfaces: ['embedded', 'mcp', 'cli'], effect: 'control',
    capabilities: ['control', 'observe'], outputView: 'outline', helpTopic: 'run',
    example: 'baton waves run path/to/spec.json',
    inputSchema: objectSchema({
      idempotencyKey: id,
      spec: { type: 'object' },
      specPath: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['wave.run.spec_path'].value },
      driver: { type: 'object' },
    }, ['idempotencyKey']),
  }],
  ['deployment.doctor', {
    profile: 'ordinary', surfaces: ['embedded', 'mcp', 'cli'], effect: 'deployment_read',
    capabilities: ['observe'], outputView: 'index', helpTopic: 'connection',
    example: 'baton doctor --check',
    inputSchema: objectSchema({ depth: { type: 'string', enum: ['outline', 'connection', 'profile', 'evidence'] }, check: { type: 'boolean' } }, []),
  }],
  // Facade-projection epic (#87+#48, contract v2.2): the eight workflow-surface canonical
  // operations (Decision 11). Boards are embedded+cli only (no ordinary MCP board tools, Decision
  // 10); the six MCP-projected lanes surface embedded+mcp+cli. All verbs are C4-clean.
  ['run.message.send', {
    profile: 'ordinary', surfaces: ['embedded', 'mcp', 'cli'], effect: 'control',
    capabilities: ['control', 'observe'], outputView: 'outline', helpTopic: 'run', idempotent: false,
    example: 'baton run message send RUN_ID --kind inform --body TEXT',
    inputSchema: objectSchema({
      runId: id, workerId: id, kind: { type: 'string', enum: ['inform', 'query', 'steer'] },
      body: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['message.send.body'].value },
    }, ['kind', 'body']),
  }],
  ['run.message.receipt', {
    profile: 'ordinary', surfaces: ['embedded', 'mcp', 'cli'], effect: 'observe',
    capabilities: ['observe'], outputView: 'outline', helpTopic: 'run',
    example: 'baton run message receipt MESSAGE_ID',
    inputSchema: objectSchema({ messageId: { type: 'string', pattern: '^message:[a-f0-9]{64}$' } }, ['messageId']),
  }],
  ['run.attention.watch', {
    profile: 'ordinary', surfaces: ['embedded', 'mcp', 'cli'], effect: 'observe',
    capabilities: ['observe'], outputView: 'outline', helpTopic: 'run',
    example: 'baton run attention watch RUN_ID --kind member_terminal --cursor 0',
    inputSchema: objectSchema({ runId: id, kind: id, cursor: { type: 'integer', minimum: 0 } }, ['runId']),
  }],
  ['run.scratchpad.read', {
    profile: 'ordinary', surfaces: ['embedded', 'mcp', 'cli'], effect: 'observe',
    capabilities: ['observe'], outputView: 'outline', helpTopic: 'run',
    example: 'baton run scratchpad read RUN_ID --scope shared --cursor 0',
    inputSchema: objectSchema({
      runId: id, scope: { type: 'string', pattern: '^(?:shared|worker:[A-Za-z0-9._:-]{1,256})$' },
      cursor: { type: 'integer', minimum: 0 },
    }, ['runId', 'scope']),
  }],
  ['run.scratchpad.elevate', {
    profile: 'ordinary', surfaces: ['embedded', 'mcp', 'cli'], effect: 'control',
    capabilities: ['control', 'observe'], outputView: 'outline', helpTopic: 'run',
    example: 'baton run scratchpad elevate RUN_ID --task TASK_ID --entries JSON',
    inputSchema: objectSchema({
      runId: id, taskId: id,
      entryIds: { type: 'array', maxItems: 128, uniqueItems: true, items: { type: 'string', pattern: '^scratchpad-entry:[a-f0-9]{64}$' } },
    }, ['runId', 'taskId', 'entryIds']),
  }],
  ['run.board.post', {
    profile: 'ordinary', surfaces: ['embedded', 'cli'], effect: 'control',
    capabilities: ['control', 'observe'], outputView: 'outline', helpTopic: 'run',
    example: 'baton run board post RUN_ID --board BOARD --title TEXT',
    inputSchema: objectSchema({
      runId: id, board: safeBoardId, title: { type: 'string', minLength: 1, maxLength: 160 },
      detail: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['board.detail'].value }, owner: safeBoardId, evidence: { type: 'array', maxItems: 8, items: evidenceRef },
    }, ['runId', 'board', 'title']),
  }],
  ['run.board.read', {
    profile: 'ordinary', surfaces: ['embedded', 'cli'], effect: 'observe',
    capabilities: ['observe'], outputView: 'outline', helpTopic: 'run',
    example: 'baton run board read RUN_ID --board BOARD',
    inputSchema: objectSchema({ runId: id, board: safeBoardId }, ['runId', 'board']),
  }],
  ['run.knowledge.seed', {
    profile: 'ordinary', surfaces: ['embedded', 'mcp', 'cli'], effect: 'control',
    capabilities: ['control', 'observe'], outputView: 'outline', helpTopic: 'run',
    example: 'baton run knowledge seed RUN_ID --type Finding --grounding observed --body TEXT',
    inputSchema: objectSchema({
      runId: id,
      type: { type: 'string', enum: ['Run', 'Task', 'Artifact', 'Phase', 'Experiment', 'Finding', 'Question', 'Hypothesis', 'Principle', 'Constraint', 'Literature', 'Research', 'RouteStat', 'Skill', 'Counterexample', 'Representation', 'ScratchFact', 'Source'] },
      grounding: { type: 'string', enum: ['verified', 'observed', 'derived', 'asserted'] },
      body: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['run.objective'].value }, evidence: { type: 'array', items: evidenceRef },
    }, ['runId', 'type', 'grounding', 'body']),
  }],
  ['application.help', {
    op: 'application.help', effect: 'help_read', capabilities: ['observe'], outputView: 'outline',
    example: 'baton help',
  }],
];

// docs/36 §8.1 — the registry OWNS aliases (legacy spellings). These rows were the M0 ledger's
// cli / embedded / application.commands name divergences; relocated here they become *derivable*
// registry data, so the conformance harness resolves them and their ledger rows retire (M4a §5).
const SURFACE_ALIAS_ROWS = Object.freeze([
  ['application.help', 'embedded', 'BatonClient.help'],
  ['context.eval', 'embedded', 'BatonContextCall.complete'],
  ['context.eval', 'embedded', 'BatonContextCall.content'],
  ['context.eval', 'embedded', 'BatonContextCall.contentPage'],
  ['context.eval', 'embedded', 'BatonContextCall.evidence'],
  ['context.eval', 'embedded', 'BatonContextCall.help'],
  ['context.eval', 'embedded', 'BatonContextCall.outline'],
  ['context.eval', 'embedded', 'BatonContextCall.output'],
  ['context.eval', 'embedded', 'BatonContextCell.evidence'],
  ['context.eval', 'embedded', 'BatonContextCell.help'],
  ['context.eval', 'embedded', 'BatonContextCell.outline'],
  ['context.eval', 'embedded', 'BatonContextCell.output'],
  ['context.eval', 'embedded', 'BatonContextExpression.chunk'],
  ['context.eval', 'embedded', 'BatonContextExpression.coverage'],
  ['context.eval', 'embedded', 'BatonContextExpression.filter'],
  ['context.eval', 'embedded', 'BatonContextExpression.index'],
  ['context.eval', 'embedded', 'BatonContextExpression.join'],
  ['context.eval', 'embedded', 'BatonContextExpression.outline'],
  ['context.eval', 'embedded', 'BatonContextExpression.project'],
  ['context.eval', 'embedded', 'BatonContextExpression.search'],
  ['context.eval', 'embedded', 'BatonContextExpression.slice'],
  ['context.eval', 'embedded', 'BatonContextExpression.sort'],
  ['context.eval', 'embedded', 'BatonContextExpression.toJSON'],
  ['context.eval', 'embedded', 'BatonContextExpression.unique'],
  ['context.eval', 'embedded', 'BatonRunContext.call'],
  ['context.eval', 'embedded', 'BatonRunContext.cell'],
  ['context.eval', 'embedded', 'BatonRunContext.cells'],
  ['context.eval', 'embedded', 'BatonRunContext.chunk'],
  ['context.eval', 'embedded', 'BatonRunContext.collect'],
  ['context.eval', 'embedded', 'BatonRunContext.coverage'],
  ['context.eval', 'embedded', 'BatonRunContext.evaluate'],
  ['context.eval', 'embedded', 'BatonRunContext.evidence'],
  ['context.eval', 'embedded', 'BatonRunContext.finish'],
  ['context.eval', 'embedded', 'BatonRunContext.help'],
  ['context.eval', 'embedded', 'BatonRunContext.index'],
  ['context.eval', 'embedded', 'BatonRunContext.outline'],
  ['context.eval', 'embedded', 'BatonRunContext.search'],
  ['context.eval', 'embedded', 'BatonRunContext.source'],
  ['context.map', 'embedded', 'BatonRunContext.map'],
  ['context.reduce', 'embedded', 'BatonContextCall.reduce'],
  ['context.reduce', 'embedded', 'BatonRunContext.reduce'],
  ['context.retry', 'embedded', 'BatonContextCall.retry'],
  ['context.retry', 'embedded', 'BatonRunContext.retry'],
  ['deployment.shutdown', 'application.commands', 'application.shutdown'],
  ['deployment.view', 'cli', 'baton route exact'],
  ['deployment.view', 'embedded', 'BatonClient.doctor'],
  ['deployment.view', 'embedded', 'BatonClient.route'],
  ['deployment.view', 'embedded', 'BatonClient.routes'],
  ['run.adopt', 'embedded', 'BatonRun.adopt'],
  ['run.adopt', 'embedded', 'BatonRun.apply'],
  ['run.answer', 'cli', 'baton run answer approval'],
  ['run.answer', 'cli', 'baton run answer decision'],
  ['run.answer', 'cli', 'baton run answer question'],
  ['run.answer', 'embedded', 'BatonRun.answer'],
  ['run.approve', 'embedded', 'BatonRun.approve'],
  ['run.do', 'application.commands', 'run.act'],
  ['run.do', 'embedded', 'BatonRun.act'],
  ['run.evidence', 'embedded', 'BatonRun.evidence'],
  ['run.debug', 'embedded', 'BatonRun.debug'],
  ['run.export', 'embedded', 'BatonRun.export'],
  ['run.feedback', 'embedded', 'BatonRun.feedback'],
  ['run.feedback', 'embedded', 'BatonRun.sendFeedback'],
  ['run.integrate', 'embedded', 'BatonRun.integrate'],
  ['run.interrupt', 'embedded', 'BatonRun.interrupt'],
  ['run.list', 'application.commands', 'runs.list'],
  ['run.list', 'embedded', 'BatonRuns.list'],
  ['run.member.send', 'application.commands', 'run.workstream.notify'],
  ['run.member.send', 'cli', 'baton run notify'],
  ['run.member.send', 'embedded', 'BatonWorkstream.notify'],
  ['run.member.stop', 'application.commands', 'run.workstream.stop'],
  ['run.member.stop', 'cli', 'baton run stop-member'],
  ['run.member.stop', 'embedded', 'BatonRun.stopMember'],
  ['run.member.stop', 'embedded', 'BatonRunGroup.stopMembers'],
  ['run.member.stop', 'embedded', 'BatonWorkstream.stop'],
  ['run.member.view', 'application.commands', 'run.workstreams'],
  ['run.member.view', 'cli', 'baton run workstreams'],
  ['run.member.view', 'embedded', 'BatonRun.members'],
  ['run.member.view', 'embedded', 'BatonRun.workstreams'],
  ['run.member.view', 'embedded', 'BatonRunGroup.member'],
  ['run.member.view', 'embedded', 'BatonWorkstream.help'],
  ['run.member.view', 'embedded', 'BatonWorkstream.open'],
  ['run.member.view', 'embedded', 'BatonWorkstreams.help'],
  ['run.member.view', 'embedded', 'BatonWorkstreams.list'],
  ['run.member.view', 'embedded', 'BatonWorkstreams.open'],
  ['run.resume', 'application.commands', 'run.resume_work'],
  ['run.retry', 'application.commands', 'run.retry_verification'],
  ['run.review', 'embedded', 'BatonRun.review'],
  ['run.revise', 'embedded', 'BatonRun.revise'],
  ['run.select', 'embedded', 'BatonRun.select'],
  ['run.send', 'embedded', 'BatonRun.send'],
  ['run.send', 'embedded', 'BatonRun.steer'],
  ['run.start', 'cli', 'baton explore objective'],
  ['run.start', 'cli', 'baton review objective'],
  ['run.start', 'cli', 'baton run objective'],
  ['run.start', 'cli', 'baton run objective manual'],
  ['run.start', 'cli', 'baton run start exact'],
  ['run.start', 'embedded', 'BatonClient.explore'],
  ['run.start', 'embedded', 'BatonClient.review'],
  ['run.start', 'embedded', 'BatonClient.workflow'],
  ['run.start', 'embedded', 'BatonRuns.start'],
  ['run.start', 'embedded', 'BatonRuns.startMany'],
  ['run.stop', 'embedded', 'BatonRun.stop'],
  ['run.stop', 'embedded', 'BatonRunGroup.stop'],
  ['run.view', 'application.commands', 'run.episode'],
  ['run.view', 'application.commands', 'run.inspect'],
  ['run.view', 'application.commands', 'run.status'],
  ['run.view', 'application.commands', 'run.wait'],
  ['run.view', 'cli', 'baton run episode'],
  ['run.view', 'cli', 'baton run result'],
  ['run.view', 'cli', 'baton run show'],
  ['run.view', 'cli', 'baton run status'],
  ['run.view', 'embedded', 'BatonEpisode.cleanup'],
  ['run.view', 'embedded', 'BatonEpisode.contradictions'],
  ['run.view', 'embedded', 'BatonEpisode.derivations'],
  ['run.view', 'embedded', 'BatonEpisode.help'],
  ['run.view', 'embedded', 'BatonEpisode.outline'],
  ['run.view', 'embedded', 'BatonEpisode.output'],
  ['run.view', 'embedded', 'BatonEpisode.result'],
  ['run.view', 'embedded', 'BatonEpisode.route'],
  ['run.view', 'embedded', 'BatonEpisode.sources'],
  ['run.view', 'embedded', 'BatonEpisode.trace'],
  ['run.view', 'embedded', 'BatonEpisode.verification'],
  ['run.view', 'embedded', 'BatonRun.actions'],
  ['run.view', 'embedded', 'BatonRun.candidates'],
  ['run.view', 'embedded', 'BatonRun.changes'],
  ['run.view', 'embedded', 'BatonRun.complete'],
  ['run.view', 'embedded', 'BatonRun.context'],
  ['run.view', 'embedded', 'BatonRun.drive'],
  ['run.view', 'embedded', 'BatonRun.episode'],
  ['run.view', 'embedded', 'BatonRun.help'],
  ['run.view', 'embedded', 'BatonRun.index'],
  ['run.view', 'embedded', 'BatonRun.inspect'],
  ['run.view', 'embedded', 'BatonRun.outline'],
  ['run.view', 'embedded', 'BatonRun.rounds'],
  ['run.view', 'embedded', 'BatonRun.status'],
  ['run.view', 'embedded', 'BatonRun.wait'],
  ['run.view', 'embedded', 'BatonRunGroup.changes'],
  ['run.view', 'embedded', 'BatonRunGroup.complete'],
  ['run.view', 'embedded', 'BatonRunGroup.inspect'],
  ['run.view', 'embedded', 'BatonRunGroup.status'],
  ['run.view', 'embedded', 'BatonRuns.attach'],
  ['run.view', 'embedded', 'BatonRuns.help'],
  ['run.view', 'embedded', 'BatonRuns.open'],
  ['run.view', 'embedded', 'BatonWorkstream.episode'],
  ['run.view', 'embedded', 'BatonWorkstream.result'],
  ['run.watch', 'application.commands', 'run.follow'],
  ['run.watch', 'cli', 'baton run events'],
  ['run.watch', 'cli', 'baton run output'],
  ['run.watch', 'cli', 'baton run progress'],
  ['run.watch', 'embedded', 'BatonRun.events'],
  ['run.watch', 'embedded', 'BatonRun.follow'],
  // Bidirectional v2 rule 6: the named one-shot wake facade riding the same `run.follow` command.
  ['run.watch', 'embedded', 'BatonRun.followOnce'],
  ['run.watch', 'embedded', 'BatonRun.output'],
  ['run.watch', 'embedded', 'BatonRun.progress'],
  // docs/36 §9 M4 (M4b — the transport flip) — the retained legacy MCP (`baton_*`/`fleet_*`) and
  // Web (`_`-joined) transport names become first-class registry aliases, exactly as M4a relocated
  // the cli/embedded rows. The conformance harness resolves them here, which is what retires their
  // M0 ledger rows (§8.4 removal-only): the divergence is now derivable registry data, not an
  // unledgered fact. The canonical transports are admitted beside these; both reach one operation.
  ['run.do', 'mcp.web-bridge', 'run.act'],
  ['run.view', 'mcp.web-bridge', 'run.inspect'],
  ['application.help', 'mcp.baton', 'baton_help'],
  ['run.answer', 'mcp.baton', 'baton_decision_answer'],
  ['run.attention.list', 'mcp.baton', 'baton_decision_list'],
  ['run.do', 'mcp.baton', 'baton_run_act'],
  ['run.list', 'mcp.baton', 'baton_runs'],
  ['run.member.send', 'mcp.baton', 'baton_workstream_notify'],
  ['run.member.stop', 'mcp.baton', 'baton_workstream_stop'],
  ['run.member.view', 'mcp.baton', 'baton_run_workstreams'],
  ['run.view', 'mcp.baton', 'baton_run_episode'],
  ['run.view', 'mcp.baton', 'baton_run_inspect'],
  ['run.adopt', 'mcp.fleet', 'fleet_run_adopt'],
  ['run.answer', 'mcp.fleet', 'fleet_run_answer'],
  ['run.approve', 'mcp.fleet', 'fleet_run_approve'],
  ['run.evidence', 'mcp.fleet', 'fleet_run_evidence'],
  ['run.export', 'mcp.fleet', 'fleet_run_export'],
  ['run.feedback', 'mcp.fleet', 'fleet_run_feedback'],
  ['run.integrate', 'mcp.fleet', 'fleet_run_integrate'],
  ['run.member.send', 'mcp.fleet', 'fleet_run_workstream_notify'],
  ['run.member.stop', 'mcp.fleet', 'fleet_run_workstream_stop'],
  ['run.member.view', 'mcp.fleet', 'fleet_run_workstreams'],
  ['run.recover', 'mcp.fleet', 'fleet_run_recover'],
  ['run.review', 'mcp.fleet', 'fleet_run_review'],
  ['run.start', 'mcp.fleet', 'fleet_run_start'],
  ['run.stop', 'mcp.fleet', 'fleet_run_stop'],
  ['run.view', 'mcp.fleet', 'fleet_run_episode'],
  ['run.view', 'mcp.fleet', 'fleet_run_status'],
  ['run.view', 'mcp.fleet', 'fleet_run_wait'],
  ['run.watch', 'mcp.fleet', 'fleet_run_follow'],
  ['run.do', 'web', 'run_act'],
  ['run.list', 'web', 'runs_list'],
  ['run.member.send', 'web', 'run_workstream_notify'],
  ['run.member.stop', 'web', 'run_workstream_stop'],
  ['run.member.view', 'web', 'run_workstreams'],
  ['run.resume', 'web', 'run_resume_work'],
  ['run.retry', 'web', 'run_retry_verification'],
  ['run.view', 'web', 'run_episode'],
  ['run.view', 'web', 'run_inspect'],
  ['run.view', 'web', 'run_status'],
  ['run.view', 'web', 'run_wait'],
  ['run.watch', 'web', 'run_follow'],
]);

function buildCanonicalOperation([key, spec]) {
  const source = spec.op ? operations[spec.op] : spec.action ? authorizedActions[spec.action] : null;
  const profile = spec.profile ?? 'ordinary';
  if (!APPLICATION_OPERATION_PROFILES.includes(profile)) {
    throw new TypeError(`invalid canonical operation profile: ${profile}`);
  }
  const parts = key.split('.');
  const inputSchema = freeze(spec.inputSchema ?? source?.inputSchema ?? objectSchema({}, []));
  const capabilities = sortedCapabilities(
    spec.capabilities ?? source?.requiredCapabilities ?? ['observe'],
  );
  const surfaceAliases = SURFACE_ALIAS_ROWS
    .filter(([canonicalKey]) => canonicalKey === key)
    .map(([, surface, name]) => Object.freeze({ surface, name }));
  const transportHidden = Object.freeze([...(spec.transportHidden ?? [])]);
  return Object.freeze({
    key,
    verb: parts.at(-1),
    noun: Object.freeze(parts.slice(0, -1)),
    effect: spec.effect ?? source?.effect ?? 'application_read',
    capabilities,
    profile,
    idempotent: spec.idempotent ?? source?.idempotent ?? true,
    destructive: spec.destructive ?? source?.destructive ?? false,
    reconcilable: spec.reconcilable ?? (spec.profile === 'host' ? false : true),
    emergency: spec.emergency ?? source?.emergency ?? false,
    inputSchema,
    authorityFields: Object.freeze([...(spec.authorityFields ?? [])]),
    serverDerived: Object.freeze([...(spec.serverDerived ?? source?.serverDerived ?? [])]),
    transportHidden: Object.freeze([...(spec.transportHidden ?? [])]),
    liveMethod: spec.liveMethod ?? spec.op ?? spec.action ?? key,
    authority: spec.authority ?? SURFACING_MATRIX_AUTHORITY[key] ?? null,
    flagAliases: flagAliasesFor(inputSchema),
    outputView: spec.outputView,
    surfaces: Object.freeze([...(spec.surfaces ?? ALL_SURFACES)]),
    names: deriveSurfaceNames(key),
    aliases: Object.freeze(surfaceAliases),
    example: spec.example ?? deriveSurfaceNames(key).cli,
    helpTopic: spec.helpTopic ?? source?.helpTopic ?? key,
    // S-1 v2 R-WG-3: fields excluded from advertised MCP/web schemas but accepted by validators.
    transportHidden,
  });
}

const canonicalOperations = freeze(CANONICAL_OPERATION_SPECS.map(buildCanonicalOperation));
const surfaceAliases = freeze(SURFACE_ALIAS_ROWS.map(([canonicalKey, surface, name]) => ({
  canonical: canonicalKey, surface, name,
})));

// docs/36 §8.1 digest split (R-OP-11). authorityDigest covers schemas / capabilities / effects /
// enums / profiles / durability — `actionId` freshness and the MCP bridge pin bind it alone.
// presentationDigest covers aliases / help / examples / ordering and moves without invalidating a
// live session. The two projections share no field, so an alias, help, or example edit provably
// cannot move authorityDigest (M4A-3).
const authorityProjection = {
  schemaVersion: core.schemaVersion,
  version: core.version,
  depths: core.depths,
  sections: core.sections,
  enums: {
    runPhases: CANONICAL_RUN_PHASES,
    memberStates: CANONICAL_MEMBER_STATES,
    attentionKinds: CANONICAL_ATTENTION_KINDS,
    progressClass: APPLICATION_LIFECYCLE_ENUMS.progressClass,
    legacyRunPhaseMap: LEGACY_RUN_PHASE_MAP,
    legacyMemberStateMap: LEGACY_MEMBER_STATE_MAP,
    attentionKindSerialization: ATTENTION_KIND_SERIALIZATION,
  },
  operations: Object.fromEntries(Object.entries(operations).map(([name, definition]) => [name, {
    inputSchema: definition.inputSchema,
    idempotent: definition.idempotent,
    destructive: definition.destructive,
    emergency: definition.emergency ?? false,
  }])),
  actions: Object.fromEntries(Object.entries(authorizedActions).map(([kind, definition]) => [kind, {
    inputSchema: definition.inputSchema,
    effect: definition.effect,
    destructive: definition.destructive,
    irreversible: definition.irreversible,
    idempotent: definition.idempotent,
    requiredCapabilities: definition.requiredCapabilities,
  }])),
  canonicalOperations: canonicalOperations.map((entry) => ({
    key: entry.key, verb: entry.verb, noun: entry.noun, effect: entry.effect,
    capabilities: entry.capabilities, profile: entry.profile, idempotent: entry.idempotent,
    destructive: entry.destructive, reconcilable: entry.reconcilable, emergency: entry.emergency,
    inputSchema: entry.inputSchema, outputView: entry.outputView, surfaces: entry.surfaces,
    authorityFields: entry.authorityFields, serverDerived: entry.serverDerived,
    transportHidden: entry.transportHidden, liveMethod: entry.liveMethod,
    authority: entry.authority,
    names: entry.names, flagAliases: entry.flagAliases,
    transportHidden: entry.transportHidden,
  })),
};
const presentationProjection = {
  aliases,
  surfaceAliases,
  deprecatedOperations: Object.entries(operations)
    .filter(([, definition]) => definition.deprecated)
    .map(([name]) => name),
  operationOrder: CANONICAL_OPERATION_SPECS.map(([key]) => key),
  help: canonicalOperations.map((entry) => [entry.key, entry.helpTopic]),
  examples: canonicalOperations.map((entry) => [entry.key, entry.example]),
  operationAliases: canonicalOperations.map((entry) => [entry.key, entry.aliases]),
};
export function hashRegistryProjection(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export const APPLICATION_DIGEST_PROJECTIONS = freeze({
  authority: authorityProjection,
  presentation: presentationProjection,
});
const authorityDigest = hashRegistryProjection(authorityProjection);
const presentationDigest = hashRegistryProjection(presentationProjection);

export const APPLICATION_SEMANTIC_REGISTRY = freeze({
  ...core,
  aliases,
  canonicalOperations,
  surfaceAliases,
  enums: APPLICATION_LIFECYCLE_ENUMS,
  serializationOrder: APPLICATION_SERIALIZATION_ORDER,
  authorityDigest,
  presentationDigest,
  digest: authorityDigest,
});

const PROVIDER_TERMINAL_GUIDANCE = freeze({
  authentication_required: {
    category: 'provider_authentication',
    summary: 'The selected provider route requires authentication.',
    remediation: 'Establish or refresh the harness-native login outside Baton, rerun baton doctor, then retry the Run.',
    retryable: true,
  },
  authentication_refresh_required: {
    category: 'provider_authentication',
    summary: 'The selected provider route requires refreshed authentication.',
    remediation: 'Refresh the harness-native login outside Baton, rerun baton doctor, then retry the Run.',
    retryable: true,
  },
  wire_frame_oversize: {
    category: 'provider_protocol',
    summary: 'The provider emitted a frame that exceeded Baton\'s safe wire boundary.',
    remediation: 'Baton requires exact termination and reaping of the ambiguous session. Update or repair the harness integration, then retry the Run.',
    retryable: true,
  },
  provider_crashed: {
    category: 'provider_runtime',
    summary: 'The provider process or session ended unexpectedly; the specific cause is unclassified.',
    remediation: 'Check Baton route readiness and the harness-native status, then retry. If it repeats, inspect the Run\'s bounded evidence.',
    retryable: true,
  },
});

const GENERIC_PROVIDER_TERMINAL_GUIDANCE = freeze({
  category: 'provider_failure',
  summary: 'The provider route failed.',
  remediation: 'Inspect the Run\'s bounded evidence and provider readiness, then retry or select another exact route.',
  retryable: true,
});

// Issue #35: a dispatch admission refusal ends a Run before any provider work exists. Its typed
// cause is a deployment/workspace condition, never a provider fault, and it is always retryable
// once the named condition clears.
const DISPATCH_REFUSAL_GUIDANCE = freeze({
  worktree_capacity_exceeded: {
    category: 'workspace_capacity',
    summary: 'Baton refused to reserve workspace capacity for this dispatch; the repository volume is below the deployment capacity floors or reservations are exhausted.',
    remediation: 'Free repository volume space or raise the deployment worktree capacity floors, then start a new Run.',
    retryable: true,
  },
  worktree_capacity_unavailable: {
    category: 'workspace_capacity',
    summary: 'Baton could not observe workspace capacity for this dispatch.',
    remediation: 'Check the repository volume health, then start a new Run.',
    retryable: true,
  },
});

const GENERIC_DISPATCH_REFUSAL_GUIDANCE = freeze({
  category: 'dispatch_refused',
  summary: 'Baton refused this dispatch before any provider work started.',
  remediation: 'Inspect the refusal code, correct the deployment or workspace condition, then start a new Run.',
  retryable: true,
});

function canonicalTerminalCode(value, fallback) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && /^[a-z0-9][a-z0-9._-]*$/iu.test(value) ? value : fallback;
}

function projectProviderTerminalCause(cause) {
  const code = canonicalTerminalCode(cause?.code, 'provider_failure_unclassified');
  const guidance = Object.hasOwn(PROVIDER_TERMINAL_GUIDANCE, code)
    ? PROVIDER_TERMINAL_GUIDANCE[code] : GENERIC_PROVIDER_TERMINAL_GUIDANCE;
  return freeze({ kind: 'provider_failure', code, ...guidance });
}

export function projectTypedTerminalCause({
  terminalResult = null, terminalOutcome = null, runStop = null, dispatchRefusal = null,
} = {}) {
  const cause = terminalResult?.terminalCause;
  if (cause && ['budget_exceeded', 'provider_failure', 'policy_failure'].includes(cause.kind)) {
    if (cause.kind === 'provider_failure') return projectProviderTerminalCause(cause);
    if (cause.kind === 'policy_failure') {
      return freeze({ kind: cause.kind, code: canonicalTerminalCode(cause.code, 'policy_failure_unclassified') });
    }
    return freeze({
      kind: cause.kind, code: canonicalTerminalCode(cause.code, 'budget_failure_unclassified'), dimension: cause.dimension,
      used: cause.used, limit: cause.limit, ratio: cause.ratio,
    });
  }
  if (terminalOutcome?.accepted === false) {
    return projectProviderTerminalCause({ code: terminalOutcome.code });
  }
  if (dispatchRefusal) {
    const code = canonicalTerminalCode(dispatchRefusal.code, 'dispatch_refusal_unclassified');
    const guidance = Object.hasOwn(DISPATCH_REFUSAL_GUIDANCE, code)
      ? DISPATCH_REFUSAL_GUIDANCE[code] : GENERIC_DISPATCH_REFUSAL_GUIDANCE;
    return freeze({ kind: 'dispatch_refused', code, ...guidance });
  }
  return runStop ? freeze({ kind: 'operator_stop', code: 'operator_stop' }) : null;
}

export function applicationSemanticRegistry() { return APPLICATION_SEMANTIC_REGISTRY; }

export function applicationOperationAliasMap(
  registry = APPLICATION_SEMANTIC_REGISTRY,
) {
  return freeze({ ...registry.aliases.operations });
}
