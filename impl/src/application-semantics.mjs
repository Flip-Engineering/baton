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
const depth = { type: 'string', enum: ['outline', 'index', 'section', 'item', 'evidence'] };

const operations = {
  'application.help': {
    inputSchema: objectSchema({ topic: { type: 'string', minLength: 1, maxLength: 256 }, depth, runId: id }, []),
    helpTopic: 'application.help', idempotent: true, destructive: false,
  },
  'run.start': {
    inputSchema: objectSchema({ intent: { type: 'object', additionalProperties: false } }, ['intent']),
    helpTopic: 'run.start', idempotent: true, destructive: false,
  },
  'run.inspect': {
    inputSchema: objectSchema({
      runId: id, depth, section: id, item: id,
      cursor: { type: 'integer', minimum: 0 },
      waitMs: { type: 'integer', minimum: 1 },
    }, ['runId']),
    helpTopic: 'run.inspect', idempotent: true, destructive: false,
    continuation: {
      operation: 'run.inspect', cursorArgument: 'cursor', waitArgument: 'waitMs',
      selectorArguments: ['depth', 'section', 'item'], waitBound: 'followPolicy.maxWaitMs',
      preferred: true, changeAware: true,
    },
  },
  'run.act': {
    inputSchema: objectSchema({ runId: id, actionId: id, inputs: objectSchema({}, []) }, ['runId', 'actionId', 'inputs']),
    helpTopic: 'run.act', idempotent: true, destructive: false,
  },
  'run.stop': {
    inputSchema: objectSchema({ runId: id, reason: { type: 'string', minLength: 1, maxLength: 1024 } }),
    helpTopic: 'run.stop', idempotent: true, destructive: true, emergency: true,
  },
};

const sections = [
  ['plan', 'Goal, approved Plan, and bounded Plan-node summaries.'],
  ['execution', 'Provider work, current lifecycle state, and bounded worker summaries.'],
  ['attention', 'Questions, approvals, and other operator attention.'],
  ['route', 'Exact launch enforcement and provider-native harness/model/effort attestation truth.'],
  ['budget', 'Allocated, consumed, remaining, and terminal budget cause.'],
  ['verification', 'Mechanical verification state and evidence.'],
  ['semantic_review', 'Independent semantic review state and grounded findings.'],
  ['result', 'Accepted and adopted result state.'],
  ['delivery', 'Integration and export/delivery state.'],
  ['cleanup', 'Stop, process reaping, worktree, runtime, and export cleanup.'],
  ['knowledge', 'Run-related causal knowledge summaries and evidence links.'],
  ['capabilities', 'Capability work used by this Run and its bounded outcomes.'],
].map(([sectionId, summary]) => ({ id: sectionId, summary }));

const actions = {
  approve_plan: {
    label: 'Approve exact Plan', summary: 'Approve the currently displayed Plan and let Baton dispatch it.',
    inputSchema: objectSchema({}, []), serverDerived: ['planDigest'], effect: 'provider_call',
    destructive: false, irreversible: false, idempotent: true, priority: 'recommended',
    helpTopic: 'run.act.approve_plan', expectedDepth: 'outline',
  },
  adopt_result: {
    label: 'Adopt verified result', summary: 'Reverify and adopt the current accepted result without requiring caller-supplied result coordinates.',
    inputSchema: objectSchema({ reason: { type: 'string', minLength: 1, maxLength: 1024 } }, ['reason']),
    serverDerived: ['nodeKey', 'resultSha', 'evidenceDigest'], effect: 'result_adoption',
    destructive: false, irreversible: false, idempotent: true, priority: 'recommended',
    helpTopic: 'run.act.adopt_result', expectedDepth: 'outline',
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
    label: 'Integrate accepted result', summary: 'Reverify and integrate the current accepted result using one deployment-authorized strategy.',
    inputSchema: objectSchema({
      strategy: { type: 'string', enum: ['ff-only', 'structured'] },
      reason: { type: 'string', minLength: 1, maxLength: 1024 },
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
  stop: {
    label: 'Stop and reap Run', summary: 'Close this Run dispatch authority and reap its exact owned resources.',
    inputSchema: objectSchema({ reason: { type: 'string', minLength: 1, maxLength: 1024 } }, ['reason']),
    serverDerived: ['workerIds', 'fences'], effect: 'run_cleanup', destructive: true,
    irreversible: false, idempotent: true, priority: 'emergency', helpTopic: 'run.stop', expectedDepth: 'outline',
  },
};

const cliCommands = [
  ['run.objective', 'run.start', null, 'baton run OBJECTIVE [--model MODEL --effort EFFORT] [--harness HARNESS]'],
  ['run.objective.manual', 'run.start', null, 'baton run OBJECTIVE --model MODEL --effort EFFORT [--harness HARNESS]'],
  ['run.start.exact', 'run.start', null, 'baton run start OBJECTIVE --exact HARNESS/MODEL@EFFORT [--profile PROFILE] [--scope PATHS]'],
  ['run.show', 'run.inspect', null, 'baton run show RUN_ID'],
  ['run.do', 'run.act', null, 'baton run do RUN_ID ACTION_ID [--inputs JSON]'],
  ['run.stop', 'run.stop', 'stop', 'baton run stop RUN_ID --reason REASON'],
  ['run.status', null, null, 'baton run status RUN_ID [--wait DURATION | --follow [--wait DURATION]]'],
  ['run.recover', null, null, 'baton run recover RUN_ID'],
  ['run.approve', null, 'approve_plan', 'baton run approve RUN_ID --plan DIGEST'],
  ['run.answer', null, null, 'baton run answer RUN_ID REQUEST_ID (--allow | --deny | --cancel | --text TEXT)'],
  ['run.steer', null, null, 'baton run steer RUN_ID TARGET (--nudge | --now | --turn) TEXT --reason REASON'],
  ['run.evidence', null, null, 'baton run evidence RUN_ID'],
  ['run.adopt', null, 'adopt_result', 'baton run adopt RUN_ID --reason REASON'],
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
      usage: ['baton help [run|routing|TOPIC]', 'baton doctor'],
      sections: [
        {
          title: 'connection discovery',
          lines: [
            'Git common metadata at baton/connection.json selects a user profile and repository ID.',
            '~/.config/baton/connections/PROFILE.json selects the URL, origin, and private token file.',
            'BATON_URL, BATON_ORIGIN, BATON_REPO_ID, and BATON_TOKEN form an explicit compatibility override.',
          ],
        },
      ],
      paragraphs: ['All Run commands use the authenticated Web command bus. Provider credentials are never CLI arguments.'],
    },
    'application.help': { aliasFor: 'application' },
    run: {
      commandIds: ['run.objective', 'run.show', 'run.do', 'run.stop', 'run.status', 'run.recover',
        'run.approve', 'run.answer', 'run.steer', 'run.evidence', 'run.adopt', 'run.review',
        'run.integrate', 'run.export'],
      selectorRule: 'manualRoute',
      paragraphs: ['Use baton help routing for exact and deployment-profile routing.'],
    },
    'run.start': { aliasFor: 'run' },
    routing: {
      commandIds: ['run.objective.manual', 'run.start.exact'],
      selectorRule: 'routingDetail',
    },
    'run.inspect': {
      commandIds: ['run.show'],
      paragraphs: ['Shows the objective-first Run outline and its available semantic actions.'],
    },
    'run.act': {
      commandIds: ['run.do'],
      paragraphs: ['Invokes one action advertised by the current Run outline.'],
    },
    'run.stop': {
      commandIds: ['run.stop'],
      paragraphs: ['Requests an audited emergency stop through the Run application.'],
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
  version: '1.0.0',
  depths: ['outline', 'index', 'section', 'item', 'evidence'],
  sections,
  operations,
  actions,
  cli,
  defaultOperations: ['application.help', 'run.start', 'run.inspect', 'run.act', 'run.stop'],
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

export function projectTypedTerminalCause({ terminalResult = null, runStop = null } = {}) {
  const cause = terminalResult?.terminalCause;
  if (cause && ['budget_exceeded', 'provider_failure'].includes(cause.kind)) {
    if (cause.kind === 'provider_failure') return freeze({ kind: cause.kind, code: cause.code });
    return freeze({
      kind: cause.kind, code: cause.code, dimension: cause.dimension,
      used: cause.used, limit: cause.limit, ratio: cause.ratio,
    });
  }
  return runStop ? freeze({ kind: 'operator_stop', code: 'operator_stop' }) : null;
}

export function applicationSemanticRegistry() { return APPLICATION_SEMANTIC_REGISTRY; }
