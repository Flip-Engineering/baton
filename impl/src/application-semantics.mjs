import { createHash } from 'node:crypto';

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

const objectSchema = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const id = { type: 'string', minLength: 1, maxLength: 256 };
const resultIntent = {
  type: 'string', enum: ['change', 'read_only_evidence'], default: 'change',
};
const applicationRoute = objectSchema({ harness: id, model: id, effort: id }, []);
const applicationIntent = objectSchema({
  runId: id,
  objective: { type: 'string', minLength: 1, maxLength: 4096 },
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
      message: { type: 'string', minLength: 1, maxLength: 16384 },
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
      text: { type: 'string', minLength: 1, maxLength: 4096 },
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
    summary: 'Re-run the live trust gate against the exact paused task and resolve it to completed or failed.',
    inputSchema: objectSchema({}, []),
    serverDerived: ['pauseId', 'workerId', 'taskId', 'turnEpoch'], effect: 'provider_control',
    destructive: false, irreversible: false, idempotent: true, priority: 'recommended',
    helpTopic: 'run.act.claim_turn', expectedDepth: 'outline', genericCli: true,
  },
  send: {
    label: 'Guide active work',
    summary: 'Send guidance to the current semantic work recipient without exposing worker or fence coordinates.',
    inputSchema: objectSchema({
      message: { type: 'string', minLength: 1, maxLength: 16384 },
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
  ['run.steer', null, null, 'baton run steer RUN_ID TARGET (--nudge | --now | --turn) TEXT --reason REASON'],
  ['run.evidence', null, null, 'baton run evidence RUN_ID'],
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
        'run.approve', 'run.answer', 'run.send', 'run.interrupt', 'run.steer', 'run.evidence', 'run.adopt', 'run.select',
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
      'fleet_result', 'fleet_list', 'fleet_kill', 'fleet_drain'],
  },
};

export const APPLICATION_SEMANTIC_REGISTRY = freeze({
  ...core,
  digest: createHash('sha256').update(JSON.stringify(canonical(core))).digest('hex'),
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
