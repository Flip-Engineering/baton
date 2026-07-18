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

export class BatonRun {
  #application;
  #principal;
  #last;

  constructor(application, principal, runId, last = null) {
    if (!application || typeof application.command !== 'function' || !nonempty(runId)) {
      throw clientError('Run handle authority is invalid');
    }
    this.#application = application;
    this.#principal = principal;
    this.#last = last;
    this.id = runId;
    Object.freeze(this);
  }

  get last() { return this.#last; }

  async inspect(options = {}) {
    exactOptions(options, new Set(['depth', 'section', 'item', 'cursor', 'waitMs']), 'inspect');
    this.#last = await this.#application.command('run.inspect', {
      runId: this.id, ...options,
    }, this.#principal);
    return this.#last;
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
    if (actions.some((action) => action.priority !== 'emergency')) return current;
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
  adopt(reason = 'Adopt the verified result.') { return this.act('adopt_result', { reason }); }
  export() { return this.act('export_result'); }
  review(inputs) { return this.act('semantic_review', inputs); }
  integrate(inputs) { return this.act('integrate', inputs); }

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

  async start(objective, options = {}) {
    if (!nonempty(objective)) throw clientError('Run objective is required');
    exactOptions(options, new Set(['runId', 'profile', 'scope', 'model', 'harness', 'effort', 'exact']), 'start');
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
    const initial = await this.#application.command('run.start', { intent }, this.#principal);
    const runId = initial?.runId ?? initial?.outline?.runId ?? intent.runId;
    return new BatonRun(this.#application, this.#principal, runId, initial);
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
      return { objective, options };
    });
    const settled = await Promise.allSettled(normalized.map(({ objective, options }) => (
      this.start(objective, options)
    )));
    const admitted = settled.filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
    const failed = settled.find((result) => result.status === 'rejected');
    if (failed) {
      const cleanup = await Promise.allSettled(admitted.map((run) => (
        run.stop('Parallel Run admission failed; stop and reap the admitted sibling.')
      )));
      const cleanupFailures = cleanup.filter((result) => result.status === 'rejected');
      if (cleanupFailures.length > 0 && failed.reason && typeof failed.reason === 'object') {
        Object.defineProperty(failed.reason, 'cleanupFailures', {
          configurable: true, enumerable: false, value: cleanupFailures.length,
        });
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

  async inspect(options = {}) {
    return Promise.all(this.runs.map(async (run) => ({
      runId: run.id, view: await run.inspect(options),
    })));
  }

  async *changes(options = {}) {
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
    const views = await Promise.all(this.runs.map((run) => run.stop(reason)));
    return views.map((view, index) => ({ runId: this.runs[index].id, view }));
  }
}

export class BatonClient {
  constructor(application, principal) {
    if (!application || typeof application.command !== 'function'
      || !principal || typeof principal !== 'object' || Array.isArray(principal)) {
      throw clientError('Baton client authority is invalid');
    }
    this.runs = new BatonRuns(application, principal);
    Object.freeze(this);
  }
}

export function bindBaton(application, principal) {
  return new BatonClient(application, principal);
}
