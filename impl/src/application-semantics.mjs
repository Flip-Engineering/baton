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
  ['orchestration', 'Recursive Run role, descendant topology, recipient authority, and subtree-stop state.'],
  ['attention', 'Questions, approvals, and other operator attention.'],
  ['route', 'Exact launch enforcement and provider-native harness/model/effort attestation truth.'],
  ['budget', 'Allocated, consumed, remaining, and terminal budget cause.'],
  ['verification', 'Mechanical verification state and evidence.'],
  ['semantic_review', 'Independent semantic review state and grounded findings.'],
  ['candidates', 'Immutable mechanically verified Workflow candidates and their exact role bindings.'],
  ['feedback', 'Typed source-bound Workflow feedback packets and their candidate targets.'],
  ['rounds', 'Append-only Workflow Plan rounds, immutable Candidate lineage, and current round state.'],
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
    label: 'Retry trust-gate verification', summary: 'Re-run the pinned verification of the exact preserved candidate under the current deployment verifier runtime, without another provider turn.',
    inputSchema: objectSchema({ reason: { type: 'string', minLength: 1, maxLength: 1024 } }, ['reason']),
    serverDerived: ['checkpointSha', 'planDigest', 'runtimeDigest', 'attempt'], effect: 'verification_retry',
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
  ['run.answer.approval', null, 'answer_approval', 'baton run answer RUN_ID REQUEST_ID (--allow | --deny | --cancel)'],
  ['run.answer.question', null, 'answer_question', 'baton run answer RUN_ID REQUEST_ID --text TEXT'],
  ['run.steer', null, null, 'baton run steer RUN_ID TARGET (--nudge | --now | --turn) TEXT --reason REASON'],
  ['run.evidence', null, null, 'baton run evidence RUN_ID'],
  ['run.adopt', null, 'adopt_result', 'baton run adopt RUN_ID --reason REASON'],
  ['run.select', null, 'select_candidate', 'baton run select RUN_ID ROLE --reason REASON'],
  ['run.feedback', null, 'send_feedback', 'baton run feedback RUN_ID ROLE --text TEXT'],
  ['run.revise', null, 'revise_candidate', 'baton run revise RUN_ID --reason REASON'],
  ['run.stop-member', null, 'stop_member', 'baton run stop-member RUN_ID ROLE --reason REASON'],
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
        'baton setup',
        'baton credentials install kimi',
        'baton doctor [--depth outline|connection|profile|evidence] [--check]',
        'baton help [run|routing|connection|TOPIC]',
      ],
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
    connection: {
      usage: [
        'baton setup [--profile PROFILE]',
        'baton doctor [--depth outline|connection|profile|evidence] [--check]',
      ],
      sections: [
        {
          title: 'profile files',
          lines: [
            '~/.config/baton/connections/PROFILE.json contains schemaVersion, url, origin, and tokenFile.',
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
    run: {
      commandIds: ['run.objective', 'run.show', 'run.do', 'run.stop', 'run.status', 'run.recover',
        'run.approve', 'run.answer', 'run.steer', 'run.evidence', 'run.adopt', 'run.select',
        'run.feedback', 'run.revise', 'run.stop-member', 'run.retry',
        'run.resume', 'run.review', 'run.integrate', 'run.export'],
      selectorRule: 'manualRoute',
      paragraphs: ['Use baton help routing for exact and deployment-profile routing.'],
    },
    'run.act.retry_verification': {
      commandIds: ['run.retry'],
      paragraphs: [
        'Retry is safe because Baton replays only the already-approved trust gate: it re-resolves the exact preserved candidate checkpoint, rebuilds fresh candidate and base sandboxes, and re-runs the pinned Plan command under the current deployment verifier runtime. It never launches or resumes an agent harness and consumes no provider turn.',
        'Baton did not blame the agent route because the verifier itself could not complete (its command could not start, timed out, exceeded its output boundary, or the baseline also failed), so no candidate defect was proven; inconclusive verification never updates route statistics.',
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

export function projectTypedTerminalCause({ terminalResult = null, runStop = null } = {}) {
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
  return runStop ? freeze({ kind: 'operator_stop', code: 'operator_stop' }) : null;
}

export function applicationSemanticRegistry() { return APPLICATION_SEMANTIC_REGISTRY; }
