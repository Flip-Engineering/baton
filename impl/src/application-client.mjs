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

  async stop(reason = 'Operator requested Run stop.') {
    if (!nonempty(reason)) throw clientError('Run stop reason is invalid');
    this.#last = await this.#application.command('run.stop', { runId: this.id, reason }, this.#principal);
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
