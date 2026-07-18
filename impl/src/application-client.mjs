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

function abortSignal(value) {
  return value !== undefined && !(value instanceof AbortSignal);
}

function outlineIdentity(view) {
  if (!/^[a-f0-9]{64}$/u.test(view?.viewDigest ?? '')) {
    throw clientError('Run change view identity is invalid');
  }
  return view.viewDigest;
}

function prepareRunStart(objective, options) {
  if (!nonempty(objective)) throw clientError('Run objective is required');
  exactOptions(options, new Set(['runId', 'profile', 'scope', 'model', 'harness', 'effort', 'exact']), 'start');
  for (const field of ['runId', 'profile', 'model', 'harness', 'effort']) {
    if (options[field] !== undefined && !nonempty(options[field])) {
      throw clientError(`Run ${field} is invalid`);
    }
  }
  if (options.scope !== undefined && (!Array.isArray(options.scope) || options.scope.length === 0
    || options.scope.length > 64 || options.scope.some((value) => !nonempty(value))
    || new Set(options.scope).size !== options.scope.length)) {
    throw clientError('Run scope is invalid');
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
  const intent = { objective: objective.normalize('NFKC').trim() };
  for (const key of ['runId', 'profile', 'scope']) {
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
    'runId', 'profile', 'scope', 'strategy', 'workspace', 'join', 'team',
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
  return Object.freeze({
    objective: objective.normalize('NFKC').trim(),
    ...(options.runId === undefined ? {} : { runId: options.runId }),
    ...(options.profile === undefined ? {} : { profile: options.profile }),
    ...(options.scope === undefined ? {} : { scope: options.scope }),
    composition: { strategy, workspace, join, team },
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

  help(depth = 'item') { return this.#run.help('run.inspect.context', depth); }

  complete(options = {}) { return this.#run.complete(options); }
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

  search(query, options = {}) {
    if (!nonempty(query)) throw clientError('Context search query is invalid');
    exactOptions(options, new Set(['branch', 'mode', 'role']), 'Context search');
    return this.#execute('context_search', { query, ...options });
  }

  chunk(options = {}) {
    exactOptions(options, new Set(['branch', 'by', 'role']), 'Context chunk');
    return this.#execute('context_chunk', options);
  }

  coverage(options = {}) {
    exactOptions(options, new Set(['branch', 'role']), 'Context coverage');
    return this.#execute('context_coverage', options);
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
}

export class BatonRun {
  #application;
  #principal;
  #last;

  constructor(application, principal, runId, last = null, metadata = {}) {
    if (!application || typeof application.command !== 'function' || !nonempty(runId)) {
      throw clientError('Run handle authority is invalid');
    }
    exactOptions(metadata, new Set(['objective']), 'Run metadata');
    if (metadata.objective !== undefined && !nonempty(metadata.objective)) {
      throw clientError('Run metadata objective is invalid');
    }
    this.#application = application;
    this.#principal = principal;
    this.#last = last;
    this.id = runId;
    this.objective = metadata.objective ?? null;
    Object.freeze(this);
  }

  get last() { return this.#last; }

  async status() {
    this.#last = await this.#application.command('run.status', { runId: this.id }, this.#principal);
    return this.#last;
  }

  async inspect(options = {}) {
    exactOptions(options, new Set(['depth', 'section', 'item', 'cursor', 'waitMs']), 'inspect');
    this.#last = await this.#application.command('run.inspect', {
      runId: this.id, ...options,
    }, this.#principal);
    return this.#last;
  }

  outline() { return this.inspect({ depth: 'outline' }); }

  index() { return this.inspect({ depth: 'index' }); }

  members() { return this.inspect({ depth: 'section', section: 'execution' }); }

  context() { return new BatonRunContext(this); }

  async help(topic = 'workflow', depth = 'outline') {
    if (!nonempty(topic) || !['outline', 'index', 'section', 'item', 'evidence'].includes(depth)) {
      throw clientError('Run help request is invalid');
    }
    return this.#application.command('application.help', {
      topic, depth, runId: this.id,
    }, this.#principal);
  }

  async wait() {
    if (!this.#last?.continuation) await this.inspect();
    const continuation = this.#last?.continuation;
    if (!continuation) return this.#last;
    this.#last = await this.#application.command(
      continuation.operation,
      continuation.arguments,
      this.#principal,
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
        .then(() => this.#application.command(operation, args, this.#principal))
        .then((next) => {
          this.#last = next;
          return { aborted: false, next };
        });
      const outcome = await observeUntilAbort(observation, signal);
      if (outcome.aborted) return;
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
    const observed = await observeUntilAbort(
      Promise.resolve().then(() => this.wait()).then((next) => ({ aborted: false, next })),
      options.signal,
    );
    return observed.aborted ? current : observed.next;
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
      runId: this.id, actionId: descriptor.actionId, inputs,
    }, this.#principal);
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
  adopt(reason = 'Adopt the verified result.') { return this.act('adopt_result', { reason }); }
  revise(reason = 'Revise the selected Candidate using its recorded feedback.') {
    if (!nonempty(reason)) throw clientError('Workflow revision reason is invalid');
    return this.act('revise_candidate', { reason });
  }
  export() { return this.act('export_result'); }
  review(inputs) { return this.act('semantic_review', inputs); }
  integrate(inputs) { return this.act('integrate', inputs); }

  candidates() { return this.inspect({ depth: 'section', section: 'candidates' }); }

  feedback() { return this.inspect({ depth: 'section', section: 'feedback' }); }

  rounds() { return this.inspect({ depth: 'section', section: 'rounds' }); }

  async evidence() {
    this.#last = await this.#application.command('run.evidence', { runId: this.id }, this.#principal);
    return this.#last;
  }

  async sendFeedback(role, feedback) {
    if (!nonempty(role) || (typeof feedback !== 'string'
      && (!feedback || typeof feedback !== 'object' || Array.isArray(feedback)))) {
      throw clientError('Workflow feedback is invalid');
    }
    this.#last = await this.#application.command('run.feedback', {
      runId: this.id, role, feedback,
    }, this.#principal);
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
    }, this.#principal);
    return this.#last;
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
    }, this.#principal);
    return this.#last;
  }

  async stop(reason = 'Operator requested Run stop.') {
    if (!nonempty(reason)) throw clientError('Run stop reason is invalid');
    this.#last = await this.#application.command('run.stop', { runId: this.id, reason }, this.#principal);
    if (!this.#last?.outline && this.#last?.terminal !== true) await this.inspect();
    return this.#last;
  }
}

export class BatonRuns {
  #application;
  #principal;

  constructor(application, principal) {
    this.#application = application;
    this.#principal = principal;
    Object.freeze(this);
  }

  open(runId) { return new BatonRun(this.#application, this.#principal, runId); }

  async #startPrepared(intent) {
    const initial = await this.#application.command('run.start', { intent }, this.#principal);
    const runId = initial?.runId ?? initial?.outline?.runId ?? intent.runId;
    return new BatonRun(this.#application, this.#principal, runId, initial, {
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
      'objective', 'runId', 'profile', 'scope', 'model', 'harness', 'effort', 'exact',
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
  #principal;

  constructor(application, principal) {
    if (!application || typeof application.command !== 'function'
      || !principal || typeof principal !== 'object' || Array.isArray(principal)) {
      throw clientError('Baton client authority is invalid');
    }
    this.runs = new BatonRuns(application, principal);
    this.#application = application;
    this.#principal = principal;
    Object.freeze(this);
  }

  async workflow(objective, options = {}) {
    const intent = prepareWorkflowStart(objective, options);
    const initial = await this.#application.command('run.start', { intent }, this.#principal);
    const runId = initial?.runId ?? initial?.outline?.runId ?? intent.runId;
    return new BatonRun(this.#application, this.#principal, runId, initial, {
      objective: intent.objective,
    });
  }
}

export function bindBaton(application, principal) {
  return new BatonClient(application, principal);
}
