import { contextProgramIsPure } from './context-authority.mjs';
import { normalizeContextProgram } from './context-program.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from './application-semantics.mjs';
import { createWave } from './wave.mjs';

function clientError(message, code = 'application_client_invalid') {
  return Object.assign(new Error(message), { code });
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value) <= 4_096;
}

function exactOptions(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.has(key))) {
    throw clientError(`${label} options are invalid`);
  }
}

function frozenClone(value) {
  const cloned = structuredClone(value);
  const freeze = (candidate) => {
    if (!candidate || typeof candidate !== 'object' || Object.isFrozen(candidate)) return candidate;
    for (const child of Object.values(candidate)) freeze(child);
    return Object.freeze(candidate);
  };
  return freeze(cloned);
}

function pureContextProgram(value) {
  const candidate = value instanceof BatonContextExpression ? value.toJSON() : value;
  let normalized;
  try { normalized = normalizeContextProgram(candidate); }
  catch (error) {
    throw clientError(error.message, error.code ?? 'context_program_invalid');
  }
  if (!contextProgramIsPure(normalized)) {
    throw clientError('Context evaluation accepts only pure expressions',
      'context_program_effect_forbidden');
  }
  return frozenClone({
    schemaVersion: 1, kind: 'baton.context_program', expression: normalized.expression,
  });
}

function outlineActions(view) {
  return Array.isArray(view?.outline?.actions) ? view.outline.actions : [];
}

function automaticActionInputs(action) {
  if (!action || action.priority !== 'recommended' || action.destructive === true
    || action.irreversible === true || action.kind?.startsWith('answer_')) return null;
  const schema = action.inputSchema;
  if (!schema || schema.type !== 'object' || !schema.properties
    || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) return null;
  const required = Array.isArray(schema.required) ? schema.required : [];
  const inputs = {};
  for (const field of required) {
    const property = schema.properties[field];
    if (!property || !Object.hasOwn(property, 'default')) return null;
    inputs[field] = property.default;
  }
  return inputs;
}

function advertisedActionInputs(action, supplied) {
  const inputs = { ...supplied };
  const properties = action?.inputSchema?.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return inputs;
  for (const [field, property] of Object.entries(properties)) {
    if (!Object.hasOwn(inputs, field) && property && Object.hasOwn(property, 'default')) {
      inputs[field] = structuredClone(property.default);
    }
  }
  return inputs;
}

function abortSignal(value) {
  return value !== undefined && !(value instanceof AbortSignal);
}

function outlineIdentity(view) {
  if (!/^[a-f0-9]{64}$/u.test(view?.viewDigest ?? '')) {
    throw clientError('Run change view identity is invalid');
  }
  return view.viewDigest;
}

function conciseProgress(view) {
  const outline = view?.outline;
  if (!outline || typeof outline !== 'object') {
    throw clientError('Run progress projection is invalid');
  }
  return frozenClone({
    schemaVersion: 1, kind: 'baton.run_progress', runId: view.runId,
    phase: outline.phase, stage: outline.stage ?? outline.progress?.current ?? null,
    summary: outline.progress?.summary ?? outline.narrative,
    attention: outline.attention,
    terminal: view.terminal === true,
    terminalCause: outline.terminalCause ?? null,
    resources: outline.resources,
    timing: {
      startedAt: outline.startedAt, observedAt: outline.observedAt,
      elapsedMs: outline.elapsedMs, lastProgress: outline.lastProgress,
      silenceMs: outline.silenceMs, completedAt: outline.completedAt,
    },
  });
}

function prepareRunStart(objective, options) {
  if (!nonempty(objective)) throw clientError('Run objective is required');
  exactOptions(options, new Set([
    'runId', 'resultIntent', 'profile', 'scope', 'model', 'harness', 'effort', 'exact', 'driverKind',
  ]), 'start');
  for (const field of ['runId', 'profile', 'model', 'harness', 'effort', 'driverKind']) {
    if (options[field] !== undefined && !nonempty(options[field])) {
      throw clientError(`Run ${field} is invalid`);
    }
  }
  if (options.scope !== undefined && (!Array.isArray(options.scope) || options.scope.length === 0
    || options.scope.length > 64 || options.scope.some((value) => !nonempty(value))
    || new Set(options.scope).size !== options.scope.length)) {
    throw clientError('Run scope is invalid');
  }
  const resultIntent = options.resultIntent ?? 'change';
  if (!['change', 'read_only_evidence'].includes(resultIntent)) {
    throw clientError('Run resultIntent is invalid');
  }
  if (options.exact !== undefined) {
    exactOptions(options.exact, new Set(['harness', 'model', 'effort']), 'exact route');
    if (['harness', 'model', 'effort'].some((field) => !nonempty(options.exact[field]))) {
      throw clientError('exact route is invalid');
    }
  }
  if (options.exact !== undefined
    && [options.model, options.harness, options.effort].some((value) => value !== undefined)) {
    throw clientError('exact routing cannot be combined with route selectors');
  }
  const hasManualRoute = [options.model, options.harness, options.effort]
    .some((value) => value !== undefined);
  if (options.exact === undefined && hasManualRoute
    && (options.model === undefined || options.effort === undefined)) {
    throw clientError('manual routing requires model and effort together');
  }
  const intent = { objective: objective.normalize('NFKC').trim(), resultIntent };
  for (const key of ['runId', 'profile', 'scope', 'driverKind']) {
    if (options[key] !== undefined) intent[key] = options[key];
  }
  if (options.exact !== undefined) intent.route = options.exact;
  else {
    const selector = {};
    for (const key of ['model', 'harness', 'effort']) {
      if (options[key] !== undefined) selector[key] = options[key];
    }
    if (Object.keys(selector).length > 0) intent.route = selector;
  }
  return Object.freeze(intent);
}

function prepareWorkflowStart(objective, options) {
  if (!nonempty(objective)) throw clientError('Workflow objective is required');
  exactOptions(options, new Set([
    'runId', 'resultIntent', 'profile', 'scope', 'strategy', 'workspace', 'join', 'team',
  ]), 'workflow');
  const strategy = options.strategy ?? 'parallel_attempts';
  const workspace = options.workspace ?? 'isolated';
  const join = options.join ?? 'operator_selected';
  if (strategy !== 'parallel_attempts' || workspace !== 'isolated'
    || join !== 'operator_selected' || !Array.isArray(options.team)
    || options.team.length < 2 || options.team.length > 16) {
    throw clientError('Workflow composition is outside the supported authority');
  }
  const team = options.team.map((member) => {
    exactOptions(member, new Set(['role', 'exact']), 'workflow team member');
    if (!nonempty(member.role)) throw clientError('Workflow role is invalid');
    exactOptions(member.exact, new Set(['harness', 'model', 'effort']), 'workflow exact route');
    if (['harness', 'model', 'effort'].some((field) => !nonempty(member.exact[field]))) {
      throw clientError('Workflow exact route is invalid');
    }
    return { role: member.role, route: member.exact };
  });
  if (new Set(team.map(({ role }) => role)).size !== team.length) {
    throw clientError('Workflow roles contain duplicates');
  }
  if (options.runId !== undefined && !nonempty(options.runId)) {
    throw clientError('Workflow Run identity is invalid');
  }
  if (options.profile !== undefined && !nonempty(options.profile)) {
    throw clientError('Workflow profile is invalid');
  }
  if (options.scope !== undefined && (!Array.isArray(options.scope) || options.scope.length === 0
    || options.scope.length > 64 || options.scope.some((value) => !nonempty(value))
    || new Set(options.scope).size !== options.scope.length)) {
    throw clientError('Workflow scope is invalid');
  }
  const resultIntent = options.resultIntent ?? 'change';
  if (!['change', 'read_only_evidence'].includes(resultIntent)) {
    throw clientError('Workflow resultIntent is invalid');
  }
  return Object.freeze({
    objective: objective.normalize('NFKC').trim(),
    resultIntent,
    ...(options.runId === undefined ? {} : { runId: options.runId }),
    ...(options.profile === undefined ? {} : { profile: options.profile }),
    ...(options.scope === undefined ? {} : { scope: options.scope }),
    composition: { strategy, workspace, join, team },
  });
}

function prepareReviewStart(objective, options) {
  if (!nonempty(objective)) throw clientError('Review objective is required');
  exactOptions(options, new Set(['runId', 'profile', 'scope', 'routes']), 'review');
  if (!Array.isArray(options.routes) || options.routes.length !== 2) {
    throw clientError('Review requires exactly two exact routes');
  }
  const roles = ['reviewer', 'challenger'];
  const team = options.routes.map((exact, index) => ({ role: roles[index], exact }));
  return prepareWorkflowStart(objective, {
    ...(options.runId === undefined ? {} : { runId: options.runId }),
    ...(options.profile === undefined ? {} : { profile: options.profile }),
    ...(options.scope === undefined ? {} : { scope: options.scope }),
    resultIntent: 'read_only_evidence',
    team,
  });
}

function runGroupSummary(runs, views) {
  if (!Array.isArray(views) || views.length !== runs.length) {
    throw clientError('Run-group status views are invalid');
  }
  const members = views.map((view, index) => {
    if (view?.runId !== runs[index].id) {
      throw clientError('Run-group member view identity does not match its bound Run',
        'application_group_view_mismatch');
    }
    outlineIdentity(view);
    const actions = outlineActions(view).map((action) => action.kind).filter(nonempty);
    const verification = view?.outline?.progress?.stages
      ?.find((stage) => stage.key === 'verification')?.state ?? 'unknown';
    const cleanup = view?.outline?.resources?.cleanupState ?? 'unknown';
    const attention = view?.outline?.attention?.state ?? 'unknown';
    const cleanupIncomplete = ['active', 'blocked'].includes(cleanup)
      && (view?.terminal === true || ['stopped', 'stopping'].includes(view?.outline?.phase));
    const phase = view?.outline?.phase ?? 'unknown';
    const state = cleanupIncomplete ? 'cleanup_incomplete'
      : attention === 'required' ? 'attention'
        : ['failed', 'denied', 'cancelled'].includes(phase) ? 'failed'
          : phase === 'stopped' ? 'stopped'
            : phase === 'work_completed' ? 'ready'
              : ['completed', 'closed'].includes(phase) ? 'completed'
                : ['planning', 'awaiting_plan_approval'].includes(phase) ? 'waiting'
                  : 'active';
    return Object.freeze({
      runId: runs[index].id,
      objective: runs[index].objective,
      state,
      phase,
      terminal: view?.terminal === true,
      attention,
      stage: view?.outline?.progress?.current ?? null,
      route: view?.outline?.route ?? null,
      verification,
      cleanup,
      terminalCause: view?.outline?.terminalCause ?? null,
      actions: Object.freeze(actions),
      viewDigest: view?.viewDigest ?? null,
    });
  });
  const byPhase = {};
  for (const member of members) byPhase[member.phase] = (byPhase[member.phase] ?? 0) + 1;
  const attention = members.filter((member) => member.attention === 'required').length;
  const terminal = members.filter((member) => member.terminal).length;
  const count = (state) => members.filter((member) => member.state === state).length;
  const active = count('active');
  const waiting = count('waiting');
  const ready = count('ready');
  const failed = count('failed');
  const stopped = count('stopped');
  const completed = count('completed');
  const cleanupIncomplete = count('cleanup_incomplete');
  const state = cleanupIncomplete > 0 ? 'cleanup_incomplete'
    : attention > 0 ? 'attention'
      : failed > 0 ? 'failed'
        : active > 0 ? 'active'
          : waiting > 0 ? 'waiting'
            : ready > 0 ? 'ready'
              : stopped === members.length ? 'stopped'
                : 'completed';
  return Object.freeze({
    schemaVersion: 1,
    state,
    counts: Object.freeze({
      total: members.length, active, waiting, ready, completed, failed, stopped,
      terminal, attention, cleanupIncomplete,
      byPhase: Object.freeze(Object.fromEntries(Object.entries(byPhase).sort())),
    }),
    members: Object.freeze(members),
  });
}

async function observeUntilAbort(observation, signal) {
  if (!signal) return observation;
  if (signal.aborted) return { aborted: true };
  let onAbort;
  const aborted = new Promise((resolve) => {
    onAbort = () => resolve({ aborted: true });
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([observation, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

export class BatonContextExpression {
  #program;

  constructor(expression) {
    this.#program = pureContextProgram({
      schemaVersion: 1, kind: 'baton.context_program', expression,
    });
    Object.freeze(this);
  }

  #with(expression) { return new BatonContextExpression(expression); }

  #input() { return this.#program.expression; }

  toJSON() { return frozenClone(this.#program); }

  outline() { return this.#with({ op: 'outline', input: this.#input() }); }

  index(options = {}) {
    exactOptions(options, new Set(['after']), 'Context index');
    return this.#with({ op: 'index', input: this.#input(), after: options.after ?? null });
  }

  search(query, options = {}) {
    if (!nonempty(query)) throw clientError('Context search query is invalid');
    exactOptions(options, new Set(['mode']), 'Context expression search');
    return this.#with({
      op: 'search', input: this.#input(), query,
      mode: options.mode ?? 'case_insensitive',
    });
  }

  slice(selector) { return this.#with({ op: 'slice', input: this.#input(), selector }); }

  chunk(by = 'item') { return this.#with({ op: 'chunk', input: this.#input(), by }); }

  filter(predicate) { return this.#with({ op: 'filter', input: this.#input(), predicate }); }

  project(fields) { return this.#with({ op: 'project', input: this.#input(), fields }); }

  sort(keys) { return this.#with({ op: 'sort', input: this.#input(), keys }); }

  unique(keys) { return this.#with({ op: 'unique', input: this.#input(), keys }); }

  join(right, on) {
    if (!(right instanceof BatonContextExpression)) {
      throw clientError('Context join requires another Context expression');
    }
    return this.#with({
      op: 'join', left: this.#input(), right: right.#input(), on,
    });
  }

  coverage() { return this.#with({ op: 'coverage', input: this.#input() }); }
}

export class BatonContextCell {
  #run;
  #last;

  constructor(run, cellId, last = null) {
    if (!(run instanceof BatonRun) || !/^cell:[a-f0-9]{64}$/u.test(cellId ?? '')) {
      throw clientError('Context cell handle is invalid');
    }
    this.#run = run;
    this.#last = last;
    this.id = cellId;
    Object.freeze(this);
  }

  get last() { return this.#last; }

  async outline() {
    if (this.#last?.item?.id === this.id && this.#last?.depth === 'item'
      && ['completed', 'failed', 'stopped', 'denied'].includes(this.#last.item.state)) {
      return this.#last;
    }
    this.#last = await this.#run.inspect({ depth: 'item', section: 'context', item: this.id });
    return this.#last;
  }

  async output() {
    const view = await this.outline();
    return view?.item?.value?.output ?? view?.item?.value ?? null;
  }

  async evidence() {
    this.#last = await this.#run.inspect({
      depth: 'evidence', section: 'context', item: this.id,
    });
    return this.#last;
  }

  help(depth = 'item') { return this.#run.help('run.inspect.context', depth); }
}

export class BatonContextCall {
  #run;
  #last;

  constructor(run, callId, last = null) {
    if (!(run instanceof BatonRun) || !/^context-call:[a-f0-9]{64}$/u.test(callId ?? '')) {
      throw clientError('Context call handle is invalid');
    }
    this.#run = run;
    this.#last = last;
    this.id = callId;
    Object.freeze(this);
  }

  get last() { return this.#last; }

  async outline() {
    if (this.#last?.item?.id === this.id && this.#last?.depth === 'item'
      && ['completed', 'failed', 'stopped', 'denied'].includes(this.#last.item.state)) {
      return this.#last;
    }
    this.#last = await this.#run.inspect({ depth: 'item', section: 'context', item: this.id });
    return this.#last;
  }

  async evidence() {
    this.#last = await this.#run.inspect({
      depth: 'evidence', section: 'context', item: this.id,
    });
    return this.#last;
  }

  async output() {
    const view = await this.outline();
    return view?.item?.value?.output ?? view?.item?.value ?? null;
  }

  async contentPage(offset = 0) {
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw clientError('Context call content offset is invalid');
    }
    return this.#run.inspect({
      depth: 'content', section: 'context', item: this.id, offset,
    });
  }

  async content() {
    let offset = 0;
    let summary = null;
    const items = [];
    for (;;) {
      const page = await this.contentPage(offset);
      const content = page?.content;
      if (!content || content.offset !== offset || !Array.isArray(content.items)) {
        throw clientError('Context call content page is invalid',
          'application_context_content_invalid');
      }
      summary ??= content;
      items.push(...content.items);
      if (content.nextOffset === null) {
        return Object.freeze({
          ...summary, offset: 0, items: Object.freeze(items),
          nextOffset: null, truncated: false,
        });
      }
      if (!Number.isSafeInteger(content.nextOffset) || content.nextOffset <= offset) {
        throw clientError('Context call content continuation is invalid',
          'application_context_content_invalid');
      }
      offset = content.nextOffset;
    }
  }

  help(depth = 'item') { return this.#run.help('run.inspect.context', depth); }

  async complete(options = {}) {
    exactOptions(options, new Set(['signal']), 'Context call complete');
    if (abortSignal(options.signal)) throw clientError('Context call complete signal is invalid');
    for (;;) {
      const before = await this.outline();
      if (options.signal?.aborted
        || ['completed', 'failed', 'stopped', 'denied'].includes(before?.item?.state)) {
        return before;
      }
      const beforeRunDigest = this.#run.last?.viewDigest ?? null;
      const advanced = await this.#run.drive(options);
      if (options.signal?.aborted) return before;
      this.#last = null;
      const after = await this.outline();
      if (options.signal?.aborted
        || ['completed', 'failed', 'stopped', 'denied'].includes(after?.item?.state)
        || advanced?.outline?.attention?.state === 'required') {
        return after;
      }
      // The addressed item refresh intentionally carries no outline. The outline returned by
      // drive is the authority for newly advertised actions and attention while this call waits.
      const actions = outlineActions(advanced);
      if (actions.some((action) => action.kind?.startsWith('answer_'))) return after;
      const hasAutomaticAction = actions
        .some((action) => automaticActionInputs(action) !== null);
      const hasIntentionalPause = actions.some((action) => automaticActionInputs(action) === null
        && !['emergency', 'optional'].includes(action.priority));
      if (hasIntentionalPause) return after;
      if (advanced?.viewDigest === beforeRunDigest
        && advanced?.timedOut !== true && !hasAutomaticAction) return after;
      if (!after?.continuation && !hasAutomaticAction) return after;
    }
  }

  reduce(options = {}) { return this.#run.context().reduce(this, options); }

  retry() { return this.#run.context().retry(this); }
}

export class BatonRunContext {
  #run;

  constructor(run) {
    if (!(run instanceof BatonRun)) throw clientError('Run Context handle is invalid');
    this.#run = run;
    Object.freeze(this);
  }

  async outline() {
    const view = await this.#run.inspect({ depth: 'outline' });
    return view?.outline?.context ?? {
      state: 'unavailable', summary: 'This Run has no current Context session.',
    };
  }

  index() { return this.#run.inspect({ depth: 'section', section: 'context' }); }

  cells() { return this.index(); }

  cell(cellId) { return new BatonContextCell(this.#run, cellId); }

  call(callId) { return new BatonContextCall(this.#run, callId); }

  evidence(cellId) { return this.cell(cellId).evidence(); }

  help(depth = 'outline') { return this.#run.help('run.inspect.context', depth); }

  source(branch = 'repository') { return new BatonContextExpression({ op: 'source', branch }); }

  collect(expressions) {
    if (!Array.isArray(expressions) || expressions.length === 0
      || expressions.some((expression) => !(expression instanceof BatonContextExpression))) {
      throw clientError('Context collect requires Context expressions');
    }
    return new BatonContextExpression({
      op: 'collect', inputs: expressions.map((expression) => expression.toJSON().expression),
    });
  }

  finish(value, evidence) {
    if (!(value instanceof BatonContextExpression) || !Array.isArray(evidence)
      || evidence.length === 0
      || evidence.some((expression) => !(expression instanceof BatonContextExpression))) {
      throw clientError('Context finish requires one value and Context evidence expressions');
    }
    return new BatonContextExpression({
      op: 'finish', value: value.toJSON().expression,
      evidence: evidence.map((expression) => expression.toJSON().expression),
    });
  }

  async #execute(kind, inputs) {
    const view = await this.#run.act(kind, inputs);
    const cellId = view?.item?.section === 'context' ? view.item.id
      : view?.outline?.context?.lastCell?.id;
    if (!/^cell:[a-f0-9]{64}$/u.test(cellId ?? '')) {
      throw clientError('Context action did not return one addressed cell',
        'application_context_result_invalid');
    }
    const cell = new BatonContextCell(this.#run, cellId,
      view?.item?.id === cellId ? view : null);
    if (!cell.last) await cell.outline();
    return cell;
  }

  evaluate(expression, options = {}) {
    exactOptions(options, new Set(['role']), 'Context evaluate');
    if (options.role !== undefined && !nonempty(options.role)) {
      throw clientError('Context evaluate role is invalid');
    }
    return this.#execute('context_eval', {
      program: pureContextProgram(expression), ...options,
    });
  }

  search(query, options = {}) {
    if (!nonempty(query)) throw clientError('Context search query is invalid');
    exactOptions(options, new Set(['branch', 'mode', 'role']), 'Context search');
    const { branch = 'repository', mode = 'case_insensitive', role } = options;
    return this.evaluate(this.source(branch).search(query, { mode }), {
      ...(role === undefined ? {} : { role }),
    });
  }

  chunk(options = {}) {
    exactOptions(options, new Set(['branch', 'by', 'role']), 'Context chunk');
    const { branch = 'repository', by = 'item', role } = options;
    return this.evaluate(this.source(branch).chunk(by), {
      ...(role === undefined ? {} : { role }),
    });
  }

  coverage(options = {}) {
    exactOptions(options, new Set(['branch', 'role']), 'Context coverage');
    const { branch = 'repository', role } = options;
    return this.evaluate(this.source(branch).coverage(), {
      ...(role === undefined ? {} : { role }),
    });
  }

  async map(input, options = {}) {
    exactOptions(options, new Set(['role', 'instruction']), 'Context map');
    const cellId = input instanceof BatonContextCell ? input.id : input;
    if (!/^cell:[a-f0-9]{64}$/u.test(cellId ?? '')
      || (options.role !== undefined && !nonempty(options.role))
      || !nonempty(options.instruction)) {
      throw clientError('Context map request is invalid');
    }
    const view = await this.#run.act('context_map', {
      cellId, ...(options.role === undefined ? {} : { role: options.role }),
      instruction: options.instruction,
    });
    const callId = view?.item?.section === 'context' ? view.item.id
      : view?.outline?.context?.lastCall?.id;
    if (!/^context-call:[a-f0-9]{64}$/u.test(callId ?? '')) {
      throw clientError('Context map action did not return one addressed call',
        'application_context_result_invalid');
    }
    return new BatonContextCall(this.#run, callId,
      view?.item?.id === callId ? view : null);
  }

  async reduce(input, options = {}) {
    exactOptions(options, new Set(['role', 'instruction']), 'Context reduce');
    const callId = input instanceof BatonContextCall ? input.id : input;
    if (!/^context-call:[a-f0-9]{64}$/u.test(callId ?? '')
      || (options.role !== undefined && !nonempty(options.role))
      || !nonempty(options.instruction)) {
      throw clientError('Context reduce request is invalid');
    }
    const view = await this.#run.act('context_reduce', {
      callId, ...(options.role === undefined ? {} : { role: options.role }),
      instruction: options.instruction,
    });
    const reducedCallId = view?.item?.section === 'context' ? view.item.id
      : view?.outline?.context?.lastCall?.id;
    if (!/^context-call:[a-f0-9]{64}$/u.test(reducedCallId ?? '')) {
      throw clientError('Context reduce action did not return one addressed call',
        'application_context_result_invalid');
    }
    return new BatonContextCall(this.#run, reducedCallId,
      view?.item?.id === reducedCallId ? view : null);
  }

  async retry(input) {
    const callId = input instanceof BatonContextCall ? input.id : input;
    if (!/^context-call:[a-f0-9]{64}$/u.test(callId ?? '')) {
      throw clientError('Context retry request is invalid');
    }
    const view = await this.#run.act('context_retry', { callId });
    const retryCallId = view?.item?.section === 'context' ? view.item.id
      : view?.outline?.context?.lastCall?.id;
    if (!/^context-call:[a-f0-9]{64}$/u.test(retryCallId ?? '')
      || retryCallId === callId) {
      throw clientError('Context retry action did not return one successor generation',
        'application_context_result_invalid');
    }
    return new BatonContextCall(this.#run, retryCallId,
      view?.item?.id === retryCallId ? view : null);
  }
}

const EPISODE_TOPICS = Object.freeze([
  'outline', 'output', 'sources', 'derivations', 'contradictions', 'trace', 'route',
  'verification', 'result', 'cleanup', 'help',
]);

export class BatonEpisode {
  #run;
  #role;
  #generation;

  constructor(run, role = null, generation = null) {
    if (!(run instanceof BatonRun) || (role !== null && !nonempty(role))
      || (generation !== null && (!Number.isSafeInteger(generation) || generation < 1))
      || (generation !== null && role === null)) {
      throw clientError('Episode handle is invalid');
    }
    this.#run = run;
    this.#role = role;
    this.#generation = generation;
    Object.freeze(this);
  }

  #item(topic) {
    if (!EPISODE_TOPICS.includes(topic)) throw clientError('Episode topic is invalid');
    return `episode:${topic}${this.#role === null ? '' : `:${this.#role}`}`
      + `${this.#generation === null ? '' : `:g${this.#generation}`}`;
  }

  #read(topic, options = {}, defaultDetail = 'item') {
    exactOptions(options, new Set(['detail', 'pageCursor', 'cursor', 'waitMs']), 'Episode read');
    const detail = options.detail ?? defaultDetail;
    if (!['item', 'content', 'evidence'].includes(detail)
      || (options.pageCursor !== undefined && !nonempty(options.pageCursor))
      || (options.cursor !== undefined && (!Number.isSafeInteger(options.cursor) || options.cursor < 0))
      || (options.waitMs !== undefined && (!Number.isSafeInteger(options.waitMs) || options.waitMs <= 0))) {
      throw clientError('Episode progressive read is invalid');
    }
    return this.#run._command('run.episode', {
      runId: this.#run.id, topic, detail,
      ...(this.#role === null ? {} : { role: this.#role }),
      ...(this.#generation === null ? {} : { generation: this.#generation }),
      ...(options.pageCursor === undefined ? {} : { pageCursor: options.pageCursor }),
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      ...(options.waitMs === undefined ? {} : { waitMs: options.waitMs }),
    });
  }

  outline(options) { return this.#read('outline', options); }
  output(options) { return this.#read('output', options, 'content'); }
  sources(options) { return this.#read('sources', options); }
  derivations(options) { return this.#read('derivations', options); }
  contradictions(options) { return this.#read('contradictions', options); }
  trace(options) { return this.#read('trace', options); }
  route(options) { return this.#read('route', options); }
  verification(options) { return this.#read('verification', options); }
  result(options) { return this.#read('result', options); }
  cleanup(options) { return this.#read('cleanup', options); }
  help(options) { return this.#read('help', options); }
}

export class BatonWorkstream {
  #run;

  constructor(run, role, generation = null) {
    if (!(run instanceof BatonRun) || !nonempty(role)
      || (generation !== null && (!Number.isSafeInteger(generation) || generation < 1))) {
      throw clientError('Workstream handle is invalid');
    }
    this.#run = run;
    this.role = role;
    this.generation = generation;
    this.id = `workstream:${role}${generation === null ? '' : `:g${generation}`}`;
    Object.freeze(this);
  }

  open(options = {}) {
    exactOptions(options, new Set(['cursor', 'waitMs']), 'workstream open');
    return this.#run._command('run.workstreams', {
      runId: this.#run.id, role: this.role,
      ...(this.generation === null ? {} : { generation: this.generation }),
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      ...(options.waitMs === undefined ? {} : { waitMs: options.waitMs }),
    });
  }

  notify(message, options = {}) {
    exactOptions(options, new Set(['delivery']), 'workstream notify');
    return this.#run._command('run.workstream.notify', {
      runId: this.#run.id, role: this.role, message,
      ...(this.generation === null ? {} : { generation: this.generation }),
      ...(options.delivery === undefined ? {} : { delivery: options.delivery }),
    });
  }

  result() { return this.episode().result(); }

  episode() { return new BatonEpisode(this.#run, this.role, this.generation); }

  stop(reason = this.role === 'work'
    ? 'Operator requested Run stop.'
    : `Stop and reap the ${this.role} workstream.`) {
    if (!nonempty(reason)) throw clientError('Workstream stop reason is invalid');
    return this.#run._command('run.workstream.stop', {
      runId: this.#run.id, role: this.role, reason,
      ...(this.generation === null ? {} : { generation: this.generation }),
    });
  }

  help(depth = 'outline') { return this.#run.help('run.workstreams', depth); }
}

export class BatonWorkstreams {
  #run;

  constructor(run) {
    if (!(run instanceof BatonRun)) throw clientError('Workstream collection is invalid');
    this.#run = run;
    Object.freeze(this);
  }

  list(options = {}) {
    exactOptions(options, new Set(['cursor', 'waitMs']), 'workstream list');
    return this.#run._command('run.workstreams', {
      runId: this.#run.id,
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      ...(options.waitMs === undefined ? {} : { waitMs: options.waitMs }),
    });
  }

  open(role, generation = null) { return new BatonWorkstream(this.#run, role, generation); }

  help(depth = 'outline') { return this.#run.help('run.workstreams', depth); }
}

export class BatonRun {
  #application;
  #last;

  constructor(application, runId, last = null, metadata = {}) {
    if (!application || typeof application.command !== 'function' || !nonempty(runId)) {
      throw clientError('Run handle authority is invalid');
    }
    exactOptions(metadata, new Set(['objective', 'helpTopic']), 'Run metadata');
    if (metadata.objective !== undefined && !nonempty(metadata.objective)) {
      throw clientError('Run metadata objective is invalid');
    }
    if (metadata.helpTopic !== undefined && !nonempty(metadata.helpTopic)) {
      throw clientError('Run metadata help topic is invalid');
    }
    this.#application = application;
    this.#last = last;
    this.id = runId;
    this.objective = metadata.objective ?? null;
    this.helpTopic = metadata.helpTopic ?? 'run';
    Object.freeze(this);
  }

  get last() { return this.#last; }

  async status() {
    this.#last = await this.#application.command('run.status', { runId: this.id });
    return this.#last;
  }

  async inspect(options = {}) {
    exactOptions(options, new Set([
      'depth', 'section', 'item', 'offset', 'pageCursor', 'recipient', 'cursor', 'waitMs',
    ]), 'inspect');
    this.#last = await this.#application.command('run.inspect', {
      runId: this.id, ...options,
    });
    return this.#last;
  }

  async _command(name, args) {
    this.#last = await this.#application.command(name, args);
    return this.#last;
  }

  outline() { return this.inspect({ depth: 'outline' }); }

  index() { return this.inspect({ depth: 'index' }); }

  members() { return this.inspect({ depth: 'section', section: 'execution' }); }

  context() { return new BatonRunContext(this); }

  workstreams() { return new BatonWorkstreams(this); }

  episode() { return new BatonEpisode(this); }

  async help(topic = this.helpTopic, depth = 'outline') {
    if (!nonempty(topic)
      || !['outline', 'index', 'section', 'item', 'content', 'evidence'].includes(depth)) {
      throw clientError('Run help request is invalid');
    }
    return this.#application.command('application.help', {
      topic, depth, runId: this.id,
    });
  }

  async wait() {
    if (!this.#last?.continuation) await this.inspect();
    const continuation = this.#last?.continuation;
    if (!continuation) return this.#last;
    this.#last = await this.#application.command(
      continuation.operation,
      continuation.arguments,
    );
    return this.#last;
  }

  async *changes(options = {}) {
    exactOptions(options, new Set(['signal']), 'changes');
    if (abortSignal(options.signal)) throw clientError('changes signal is invalid');
    const { signal } = options;
    if (signal?.aborted) return;

    if (!this.#last?.outline) {
      const initial = Promise.resolve().then(() => this.inspect())
        .then((next) => ({ aborted: false, next }));
      if ((await observeUntilAbort(initial, signal)).aborted) return;
    }
    if (signal?.aborted) return;
    let current = this.#last;
    let emitted = outlineIdentity(current);
    yield current;

    while (current?.continuation && !signal?.aborted) {
      const { operation, arguments: args } = current.continuation;
      const observation = Promise.resolve()
        .then(() => this.#application.command(operation, args))
        .then((next) => ({ aborted: false, next }));
      const outcome = await observeUntilAbort(observation, signal);
      if (outcome.aborted) return;
      this.#last = outcome.next;
      current = outcome.next;
      const identity = outlineIdentity(current);
      if (typeof current?.changed !== 'boolean') {
        throw clientError('Run change indicator is invalid');
      }
      if (current.changed && identity !== emitted) {
        emitted = identity;
        yield current;
      }
    }
  }

  follow(options = {}) { return this.changes(options); }

  async *_timeline(channel, options = {}) {
    exactOptions(options, new Set(['signal', 'recipient']), channel);
    if (abortSignal(options.signal)
      || (options.recipient !== undefined && !nonempty(options.recipient))) {
      throw clientError(`Run ${channel} options are invalid`);
    }
    const signal = options.signal;
    if (signal?.aborted) return;
    const item = channel === 'output' ? 'execution:output' : 'execution:events';
    let pageCursor;
    let waitCursor;
    for (;;) {
      const observation = Promise.resolve().then(() => this.#application.command('run.inspect', {
        runId: this.id, depth: 'content', section: 'execution', item,
        ...(pageCursor === undefined ? {} : { pageCursor }),
        ...(waitCursor === undefined ? {} : { cursor: waitCursor }),
        ...(options.recipient === undefined ? {} : { recipient: options.recipient }),
      })).then((next) => ({ aborted: false, next }));
      const outcome = await observeUntilAbort(observation, signal);
      if (outcome.aborted) return;
      this.#last = outcome.next;
      const content = outcome.next?.content;
      if (content?.kind !== 'baton.run_timeline.page'
        || content.runId !== this.id || outcome.next?.runId !== this.id
        || content.channel !== channel || !Array.isArray(content.items)
        || content.items.some((entry) => entry?.runId !== this.id)
        || typeof content.cursor !== 'string' || typeof content.hasMore !== 'boolean'
        || (content.hasMore && content.items.length === 0)) {
        throw clientError(`Run ${channel} page is invalid`, 'application_client_protocol_invalid');
      }
      for (const entry of content.items) {
        if (signal?.aborted) return;
        yield entry;
      }
      pageCursor = content.cursor;
      if (content.hasMore) {
        waitCursor = undefined;
        continue;
      }
      if (outcome.next.terminal === true) return;
      if (!Number.isSafeInteger(outcome.next.cursor) || outcome.next.cursor < 0) {
        throw clientError(`Run ${channel} continuation is invalid`,
          'application_client_protocol_invalid');
      }
      waitCursor = outcome.next.cursor;
    }
  }

  events(options = {}) { return this._timeline('events', options); }

  output(options = {}) { return this._timeline('output', options); }

  async *progress(options = {}) {
    exactOptions(options, new Set(['signal']), 'progress');
    if (abortSignal(options.signal)) throw clientError('Run progress signal is invalid');
    let prior = null;
    for await (const view of this.changes(options)) {
      const projected = conciseProgress(view);
      const identity = JSON.stringify(projected);
      if (identity === prior) continue;
      prior = identity;
      yield projected;
    }
  }

  async actions() {
    if (outlineActions(this.#last).length === 0) await this.inspect();
    return outlineActions(this.#last);
  }

  async drive(options = {}) {
    exactOptions(options, new Set(['signal']), 'drive');
    if (abortSignal(options.signal)) throw clientError('drive signal is invalid');
    if (!this.#last?.outline) await this.inspect();
    const current = this.#last;
    if (options.signal?.aborted || current?.terminal) return current;

    const actions = outlineActions(current);
    if (current?.outline?.attention?.state === 'required'
      || actions.some((action) => action.kind?.startsWith('answer_'))) return current;
    for (const action of actions) {
      const inputs = automaticActionInputs(action);
      if (inputs !== null) return this.act(action.actionId, inputs);
    }
    // An advertised action that is not safe to invoke automatically is an intentional pause,
    // even when the Run also offers a change-aware continuation. Do not long-poll past an
    // explicit repository edit, operator choice, or emergency-only action.
    if (actions.some((action) => !['emergency', 'optional'].includes(action.priority))) {
      return current;
    }
    if (!current?.continuation) return current;
    if (!options.signal) return this.wait();
    const { operation, arguments: args } = current.continuation;
    const observed = await observeUntilAbort(
      Promise.resolve()
        .then(() => this.#application.command(operation, args))
        .then((next) => ({ aborted: false, next })),
      options.signal,
    );
    if (observed.aborted) return current;
    this.#last = observed.next;
    return observed.next;
  }

  async complete(options = {}) {
    exactOptions(options, new Set(['signal']), 'complete');
    if (abortSignal(options.signal)) throw clientError('complete signal is invalid');
    for (;;) {
      if (!this.#last?.outline) await this.inspect();
      const before = this.#last;
      if (options.signal?.aborted || before?.terminal
        || before?.outline?.attention?.state === 'required'
        || outlineActions(before).some((action) => action.kind?.startsWith('answer_'))) return before;
      const hadAction = outlineActions(before)
        .some((action) => automaticActionInputs(action) !== null);
      const next = await this.drive(options);
      if (options.signal?.aborted || next?.terminal
        || next?.outline?.attention?.state === 'required'
        || outlineActions(next).some((action) => action.kind?.startsWith('answer_'))) return next;
      if (next?.viewDigest === before?.viewDigest
        && !(before?.continuation && next?.timedOut === true && !hadAction)) return next;
      if (!next?.continuation && !outlineActions(next)
        .some((action) => automaticActionInputs(action) !== null)) return next;
    }
  }

  async act(action, inputs = {}) {
    if (!nonempty(action) || !inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
      throw clientError('Run action is invalid');
    }
    let descriptor = outlineActions(this.#last)
      .find((candidate) => candidate.actionId === action || candidate.kind === action);
    if (!descriptor) {
      await this.inspect();
      descriptor = outlineActions(this.#last)
        .find((candidate) => candidate.actionId === action || candidate.kind === action);
    }
    if (!descriptor) throw clientError(`Run action ${action} is unavailable`, 'application_action_unavailable');
    this.#last = await this.#application.command('run.act', {
      runId: this.id, actionId: descriptor.actionId,
      inputs: advertisedActionInputs(descriptor, inputs),
    });
    return this.#last;
  }

  approve() { return this.act('approve_plan'); }
  select(role, reason = 'Select this verified Candidate for the next gated stage.') {
    if (!nonempty(role) || !nonempty(reason)) throw clientError('Workflow Candidate selection is invalid');
    return this.act('select_candidate', { role, reason });
  }
  stopMember(role, reason = 'Stop and reap this active Workflow member.') {
    if (!nonempty(role) || !nonempty(reason)) throw clientError('Workflow member stop is invalid');
    return this.act('stop_member', { role, reason });
  }
  adopt(reason) {
    if (reason !== undefined && !nonempty(reason)) throw clientError('Run adoption reason is invalid');
    return this.act('adopt_result', reason === undefined ? {} : { reason });
  }
  revise(reason) {
    if (reason !== undefined && !nonempty(reason)) throw clientError('Workflow revision reason is invalid');
    return this.act('revise_candidate', reason === undefined ? {} : { reason });
  }
  export() { return this.act('export_result'); }
  review(inputs) { return this.act('semantic_review', inputs); }
  integrate(options = {}) { return this.apply(options); }

  candidates() { return this.inspect({ depth: 'section', section: 'candidates' }); }

  feedback() { return this.inspect({ depth: 'section', section: 'feedback' }); }

  rounds() { return this.inspect({ depth: 'section', section: 'rounds' }); }

  async evidence() {
    this.#last = await this.#application.command('run.evidence', { runId: this.id });
    return this.#last;
  }

  async sendFeedback(role, feedback) {
    if (!nonempty(role) || (typeof feedback !== 'string'
      && (!feedback || typeof feedback !== 'object' || Array.isArray(feedback)))) {
      throw clientError('Workflow feedback is invalid');
    }
    this.#last = await this.#application.command('run.feedback', {
      runId: this.id, role, feedback,
    });
    return this.#last;
  }

  async apply(options = {}) {
    exactOptions(options, new Set(['strategy', 'reason']), 'apply');
    let descriptor = outlineActions(this.#last).find((action) => action.kind === 'integrate');
    if (!descriptor) {
      await this.inspect();
      descriptor = outlineActions(this.#last).find((action) => action.kind === 'integrate');
    }
    if (!descriptor) {
      throw clientError('Run has no adopted result available to apply', 'application_action_unavailable');
    }
    const advertised = Array.isArray(descriptor.choices) ? descriptor.choices : [];
    const strategy = options.strategy
      ?? descriptor.inputSchema?.properties?.strategy?.default
      ?? (advertised.includes('ff-only') ? 'ff-only' : advertised[0]);
    const reason = options.reason
      ?? descriptor.inputSchema?.properties?.reason?.default
      ?? 'Apply the adopted verified result.';
    if (!advertised.includes(strategy) || !nonempty(reason)) {
      throw clientError('Run apply options are outside the advertised integration authority',
        'application_action_input_invalid');
    }
    return this.act(descriptor.actionId, { strategy, reason });
  }

  async answer(requestId, answer) {
    if (!nonempty(requestId) || !answer || typeof answer !== 'object' || Array.isArray(answer)) {
      throw clientError('Run answer is invalid');
    }
    this.#last = await this.#application.command('run.answer', {
      runId: this.id, requestId, answer,
    });
    return this.#last;
  }

  async send(message, options = {}) {
    if (!nonempty(message)) throw clientError('Run guidance is invalid');
    exactOptions(options, new Set(['recipient', 'delivery']), 'send');
    if (options.recipient !== undefined && !nonempty(options.recipient)) {
      throw clientError('Run guidance recipient is invalid');
    }
    if (options.delivery !== undefined
      && !['nudge', 'now', 'turn'].includes(options.delivery)) {
      throw clientError('Run guidance delivery is invalid');
    }
    const actions = await this.actions();
    const descriptor = actions.find((action) => action.kind === 'send');
    if (!descriptor) {
      throw clientError('Run has no active semantic recipient for guidance',
        'application_action_unavailable');
    }
    const recipient = options.recipient
      ?? descriptor.inputSchema?.properties?.recipient?.default;
    if (!nonempty(recipient)) {
      throw clientError('Run guidance recipient is ambiguous; select an advertised role',
        'application_control_recipient_ambiguous');
    }
    return this.act(descriptor.actionId, {
      message, recipient,
      delivery: options.delivery
        ?? descriptor.inputSchema?.properties?.delivery?.default
        ?? 'nudge',
    });
  }

  async interrupt(options = {}) {
    exactOptions(options, new Set(['recipient', 'reason']), 'interrupt');
    if ((options.recipient !== undefined && !nonempty(options.recipient))
      || (options.reason !== undefined && !nonempty(options.reason))) {
      throw clientError('Run interrupt is invalid');
    }
    const actions = await this.actions();
    const descriptor = actions.find((action) => action.kind === 'interrupt');
    if (!descriptor) {
      throw clientError('Run has no active semantic recipient to interrupt',
        'application_action_unavailable');
    }
    const recipient = options.recipient
      ?? descriptor.inputSchema?.properties?.recipient?.default;
    if (!nonempty(recipient)) {
      throw clientError('Run interrupt recipient is ambiguous; select an advertised role',
        'application_control_recipient_ambiguous');
    }
    return this.act(descriptor.actionId, {
      recipient,
      reason: options.reason
        ?? descriptor.inputSchema?.properties?.reason?.default
        ?? 'Interrupt the current work turn.',
    });
  }

  async steer(target, message, options = {}) {
    if (!nonempty(target) || !nonempty(message)) throw clientError('Run steer is invalid');
    exactOptions(options, new Set(['mode', 'reason']), 'steer');
    const mode = options.mode ?? 'nudge';
    const reason = options.reason ?? 'Orchestrator steered the active worker.';
    if (!['nudge', 'now', 'turn'].includes(mode) || !nonempty(reason)) {
      throw clientError('Run steer is invalid');
    }
    this.#last = await this.#application.command('run.steer', {
      runId: this.id, target, mode, message, reason,
    });
    return this.#last;
  }

  async stop(reason = 'Operator requested Run stop.') {
    if (!nonempty(reason)) throw clientError('Run stop reason is invalid');
    this.#last = await this.#application.command('run.stop', { runId: this.id, reason });
    if (!this.#last?.outline && this.#last?.terminal !== true) await this.inspect();
    return this.#last;
  }
}

export class BatonRuns {
  #application;

  constructor(application) {
    this.#application = application;
    Object.freeze(this);
  }

  open(runId) { return new BatonRun(this.#application, runId); }

  async list() {
    return this.#application.command('runs.list', {});
  }

  help(depth = 'outline') {
    if (!['outline', 'index', 'section', 'item', 'content', 'evidence'].includes(depth)) {
      throw clientError('Run collection help request is invalid');
    }
    return this.#application.command('application.help', {
      topic: 'runs', depth,
    });
  }

  async attach(runId) {
    if (!nonempty(runId)) throw clientError('Run attachment identity is invalid');
    const view = await this.#application.command('run.inspect', {
      runId, depth: 'outline',
    });
    if (view?.schemaVersion !== 1 || view?.runId !== runId || view?.depth !== 'outline'
      || (view?.registryDigest !== undefined
        && view.registryDigest !== APPLICATION_SEMANTIC_REGISTRY.digest)
      || !/^[a-f0-9]{64}$/u.test(view?.viewDigest ?? '')
      || typeof view?.terminal !== 'boolean'
      || !view?.outline || typeof view.outline !== 'object' || Array.isArray(view.outline)
      || !nonempty(view.outline.objective) || !nonempty(view.outline.phase)) {
      throw clientError('Run attachment response is invalid', 'application_attach_invalid');
    }
    return new BatonRun(this.#application, runId, view,
      {
        ...(nonempty(view.outline.objective) ? { objective: view.outline.objective } : {}),
        helpTopic: view.outline.workflow ? 'workflow' : 'run',
      });
  }

  async #startPrepared(intent) {
    const initial = await this.#application.command('run.start', { intent });
    const runId = initial?.runId ?? initial?.outline?.runId ?? intent.runId;
    return new BatonRun(this.#application, runId, initial, {
      objective: intent.objective,
    });
  }

  async start(objective, options = {}) {
    return this.#startPrepared(prepareRunStart(objective, options));
  }

  async startMany(requests) {
    if (!Array.isArray(requests) || requests.length === 0 || requests.length > 64) {
      throw clientError('startMany requires one bounded non-empty request array');
    }
    const allowed = new Set([
      'objective', 'runId', 'resultIntent', 'profile', 'scope', 'model', 'harness', 'effort', 'exact',
    ]);
    const normalized = requests.map((request) => {
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw clientError('startMany request is invalid');
      }
      const unsupported = Object.keys(request).find((field) => !allowed.has(field));
      if (unsupported) throw clientError(`startMany request contains unsupported field ${unsupported}`);
      const { objective, ...options } = request;
      return prepareRunStart(objective, options);
    });
    const settled = await Promise.allSettled(normalized.map((intent) => this.#startPrepared(intent)));
    const admitted = settled.filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
    const failed = settled.find((result) => result.status === 'rejected');
    if (failed) {
      const cleanup = await Promise.allSettled(admitted.map((run) => (
        run.stop('Parallel Run admission failed; stop and reap the admitted sibling.')
      )));
      const cleanupFailures = cleanup.flatMap((result, index) => result.status === 'rejected'
        ? [{ runId: admitted[index].id, code: result.reason?.code ?? 'stop_failed' }] : []);
      if (cleanupFailures.length > 0) {
        const error = clientError('Parallel admission failed and admitted Run cleanup is incomplete',
          'application_group_cleanup_incomplete');
        error.cause = failed.reason;
        error.outcome = Object.freeze({
          admitted: Object.freeze(admitted.map((run) => run.id)),
          cleaned: Object.freeze(cleanup.flatMap((result, index) => result.status === 'fulfilled'
            ? [admitted[index].id] : [])),
          failed: Object.freeze(cleanupFailures.map(Object.freeze)),
        });
        throw error;
      }
      throw failed.reason;
    }
    return new BatonRunGroup(admitted);
  }
}

export class BatonRunGroup {
  constructor(runs) {
    if (!Array.isArray(runs) || runs.length === 0
      || runs.some((run) => !(run instanceof BatonRun))
      || new Set(runs.map((run) => run.id)).size !== runs.length) {
      throw clientError('Run group authority is invalid');
    }
    this.runs = Object.freeze([...runs]);
    this.ids = Object.freeze(runs.map((run) => run.id));
    Object.freeze(this);
  }

  member(runId) {
    if (!nonempty(runId)) throw clientError('Run-group member identity is invalid');
    const run = this.runs.find((candidate) => candidate.id === runId);
    if (!run) {
      throw clientError(`Run ${runId} is not a member of this group`,
        'application_group_member_unavailable');
    }
    return run;
  }

  async status() {
    const views = await Promise.all(this.runs.map((run) => run.inspect()));
    return runGroupSummary(this.runs, views);
  }

  async complete(options = {}) {
    exactOptions(options, new Set(['signal']), 'Run-group complete');
    if (abortSignal(options.signal)) throw clientError('Run-group complete signal is invalid');
    const views = await Promise.all(this.runs.map((run) => run.complete(options)));
    return runGroupSummary(this.runs, views);
  }

  async *changes(options = {}) {
    exactOptions(options, new Set(['signal', 'depth']), 'Run-group changes');
    if (abortSignal(options.signal)
      || (options.depth !== undefined && !['summary', 'members'].includes(options.depth))) {
      throw clientError('Run-group changes options are invalid');
    }
    if (options.depth === 'members') {
      yield* this.#memberChanges({ signal: options.signal });
      return;
    }
    let views = await Promise.all(this.runs.map((run) => run.inspect()));
    let identity = views.map((view) => view.viewDigest).join('\0');
    yield runGroupSummary(this.runs, views);
    for await (const changed of this.#memberChanges({ signal: options.signal })) {
      const index = this.runs.findIndex((run) => run.id === changed.runId);
      if (index < 0) throw clientError('Run-group change refers to an unknown member');
      views = [...views];
      views[index] = changed.view;
      const nextIdentity = views.map((view) => view.viewDigest).join('\0');
      if (nextIdentity === identity) continue;
      identity = nextIdentity;
      yield runGroupSummary(this.runs, views);
    }
  }

  async inspect(options = {}) {
    return Promise.all(this.runs.map(async (run) => ({
      runId: run.id, view: await run.inspect(options),
    })));
  }

  async *#memberChanges(options = {}) {
    const iterators = this.runs.map((run) => run.changes(options)[Symbol.asyncIterator]());
    const pending = new Map();
    const schedule = (index) => {
      pending.set(index, iterators[index].next().then(
        (result) => ({ index, result }),
        (error) => Promise.reject(Object.assign(error, { runId: this.runs[index].id })),
      ));
    };
    for (let index = 0; index < iterators.length; index += 1) schedule(index);
    try {
      while (pending.size > 0) {
        const { index, result } = await Promise.race(pending.values());
        if (result.done) pending.delete(index);
        else {
          yield { runId: this.runs[index].id, view: result.value };
          schedule(index);
        }
      }
    } finally {
      await Promise.allSettled(iterators.map((iterator) => iterator.return?.()));
    }
  }

  async stop(reason = 'Operator requested Run-group stop.') {
    if (!nonempty(reason)) throw clientError('Run-group stop reason is invalid');
    return this.#stopSelected(this.runs, reason);
  }

  async #stopSelected(selected, reason) {
    const settled = await Promise.allSettled(selected.map((run) => run.stop(reason)));
    const completed = settled.flatMap((result, index) => result.status === 'fulfilled'
      ? [{ runId: selected[index].id, view: result.value }] : []);
    const failed = settled.flatMap((result, index) => result.status === 'rejected'
      ? [{ runId: selected[index].id, code: result.reason?.code ?? 'stop_failed' }] : []);
    if (failed.length > 0) {
      const error = clientError('Run-group stop joined every selected member but cleanup is incomplete',
        'application_group_stop_incomplete');
      error.outcome = Object.freeze({
        state: 'cleanup_incomplete',
        targets: Object.freeze(selected.map((run) => run.id)),
        completed: Object.freeze(completed.map(({ runId }) => runId)),
        failed: Object.freeze(failed.map(Object.freeze)),
      });
      throw error;
    }
    const summary = runGroupSummary(selected, completed.map(({ view }) => view));
    return Object.freeze({
      schemaVersion: 1,
      state: summary.state,
      targets: Object.freeze(selected.map((run) => run.id)),
      counts: summary.counts,
      members: summary.members,
    });
  }

  async stopMembers(runIds, reason = 'Operator requested selected Run-group member stop.') {
    if (!Array.isArray(runIds) || runIds.length === 0 || runIds.length > this.runs.length
      || new Set(runIds).size !== runIds.length || runIds.some((runId) => !nonempty(runId))
      || !nonempty(reason)) {
      throw clientError('Run-group stop selection is invalid');
    }
    const selected = runIds.map((runId) => this.member(runId));
    return this.#stopSelected(selected, reason);
  }
}

export class BatonClient {
  #application;

  constructor(application) {
    if (!application || typeof application.command !== 'function') {
      throw clientError('Baton client authority is invalid');
    }
    this.runs = new BatonRuns(application);
    this.#application = application;
    Object.freeze(this);
  }

  get waves() {
    return Object.freeze({ start: (options = {}) => createWave(this, options) });
  }

  help(topic = 'application', depth = 'outline') {
    if (!nonempty(topic)
      || !['outline', 'index', 'section', 'item', 'content', 'evidence'].includes(depth)) {
      throw clientError('Baton help request is invalid');
    }
    return this.#application.command('application.help', { topic, depth });
  }

  async doctor() {
    if (typeof this.#application.doctor !== 'function') {
      throw clientError('Deployment doctor is unavailable', 'application_doctor_unavailable');
    }
    return this.#application.doctor();
  }

  async routes() {
    const doctor = await this.doctor();
    if (!Array.isArray(doctor?.routes)) {
      throw clientError('Deployment route readiness is invalid',
        'application_client_protocol_invalid');
    }
    return doctor.routes;
  }

  async route(exact) {
    exactOptions(exact, new Set(['harness', 'model', 'effort']), 'route readiness');
    if (['harness', 'model', 'effort'].some((field) => !nonempty(exact[field]))) {
      throw clientError('Exact route readiness selector is invalid');
    }
    const matches = (await this.routes()).filter((candidate) => (
      candidate?.harness === exact.harness && candidate?.model === exact.model
      && candidate?.effort === exact.effort
    ));
    if (matches.length !== 1) {
      throw clientError('Exact route readiness is unavailable',
        'application_route_readiness_unavailable');
    }
    return matches[0];
  }

  async review(objective, options = {}) {
    const intent = prepareReviewStart(objective, options);
    const initial = await this.#application.command('run.start', { intent });
    const runId = initial?.runId ?? initial?.outline?.runId ?? intent.runId;
    return new BatonRun(this.#application, runId, initial, {
      objective: intent.objective, helpTopic: 'review',
    });
  }

  async explore(objective, options = {}) {
    exactOptions(options, new Set([
      'runId', 'profile', 'scope', 'model', 'harness', 'effort', 'exact',
    ]), 'explore');
    const intent = prepareRunStart(objective, { ...options, resultIntent: 'read_only_evidence' });
    const initial = await this.#application.command('run.start', { intent });
    const runId = initial?.runId ?? initial?.outline?.runId ?? intent.runId;
    return new BatonRun(this.#application, runId, initial, {
      objective: intent.objective, helpTopic: 'explore',
    });
  }

  async workflow(objective, options = {}) {
    const intent = prepareWorkflowStart(objective, options);
    const initial = await this.#application.command('run.start', { intent });
    const runId = initial?.runId ?? initial?.outline?.runId ?? intent.runId;
    return new BatonRun(this.#application, runId, initial, {
      objective: intent.objective, helpTopic: 'workflow',
    });
  }
}

export function bindBaton(application, principal) {
  if (!application || typeof application.command !== 'function'
    || !principal || typeof principal !== 'object' || Array.isArray(principal)) {
    throw clientError('Baton direct command authority is invalid');
  }
  return new BatonClient(Object.freeze({
    command: (name, args) => application.command(name, args, principal),
  }));
}

export function bindBatonPort(commandPort) {
  if (!commandPort || typeof commandPort.command !== 'function') {
    throw clientError('Baton command port is invalid');
  }
  const port = Object.freeze({
    command: (name, args) => commandPort.command(name, args),
    ...(typeof commandPort.doctor === 'function'
      ? { doctor: () => commandPort.doctor() } : {}),
  });
  return new BatonClient(port);
}
