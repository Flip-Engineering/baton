import { createHash, randomBytes } from 'node:crypto';

const ROUTE_FIELDS = Object.freeze(['effort', 'harness', 'model']);
const BINDING_FIELDS = Object.freeze([
  'card', 'effect', 'effort', 'harness', 'model', 'serviceTier', 'taskType', 'version', 'workerPolicy',
]);
const CARD_FIELDS = Object.freeze(['adapterCardDigest', 'family', 'harness', 'modelSelection', 'version']);
const MODEL_SELECTION_FIELDS = Object.freeze([
  'acceptedAliases', 'acceptedPrefixes', 'available', 'configuredDefault', 'mode',
  'reasoningEffort', 'serviceTier',
]);
const EFFECT_FIELDS = Object.freeze([
  'nodeKey', 'phase', 'processGeneration', 'runId', 'taskId', 'workerId',
]);
const WORKER_POLICY_FIELDS = Object.freeze([
  'adapterCardDigest', 'requestDigest', 'resolutionDigest', 'schemaVersion',
]);
const RUNTIME_FIELDS = Object.freeze(['authentication', 'containment', 'permissions', 'version']);
const AUTHENTICATION_CODES = new Set([
  'authentication_required', 'authentication_refresh_required',
  'authentication_metadata_invalid', 'authentication_probe_failed',
]);
const SECRET_SHAPED = Object.freeze([
  /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/u,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|credential|password|secret)\s*[:=]/iu,
  /\b(?:sk|sk-proj)-[A-Za-z0-9_-]{12,}\b/u,
]);

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};
const routeKey = (route) => `${route.harness}\0${route.model}\0${route.effort}`;
const bindingRoute = (binding) => ({
  harness: binding.harness, model: binding.model, effort: binding.effort,
});
const keysEqual = (value, fields) => Object.keys(value).sort().join(',') === [...fields].sort().join(',');
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const safeIdentifier = (value, max = 256) => typeof value === 'string' && value.length > 0
  && Buffer.byteLength(value) <= max && !/[\0\r\n]/u.test(value);
const safeDigest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const safeList = (value, { nullable = false, max = 64 } = {}) => (nullable && value === null)
  || (Array.isArray(value) && value.length <= max && value.every((item) => safeIdentifier(item)));

function routeError(message, code, route = null, receipt = null) {
  return Object.assign(new Error(message), {
    code,
    ...(route ? { route: freeze(clone(route)) } : {}),
    ...(receipt ? { receipt } : {}),
  });
}

function exactRoute(value, code = 'route_invalid') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !keysEqual(value, ROUTE_FIELDS)
    || ROUTE_FIELDS.some((field) => typeof value[field] !== 'string' || value[field].length === 0
      || Buffer.byteLength(value[field]) > 256 || /[\0\r\n]/u.test(value[field]))) {
    throw routeError('exact route must contain only bounded harness, model, and effort', code);
  }
  return freeze({ harness: value.harness, model: value.model, effort: value.effort });
}

function boundedPublicText(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const text = value.normalize('NFKC').trim();
  if (text.length === 0 || Buffer.byteLength(text) > 1024
    || SECRET_SHAPED.some((item) => item.test(text))) return fallback;
  return text;
}

function publicAtom(value, fallback = null) {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 64
    && /^[A-Za-z0-9][A-Za-z0-9._+:/-]*$/u.test(value)
    && !SECRET_SHAPED.some((item) => item.test(value)) ? value : fallback;
}

function publicRuntime(value) {
  if (!record(value) || !keysEqual(value, RUNTIME_FIELDS)
    || !record(value.version) || !keysEqual(value.version, ['state', 'value'])
    || !record(value.authentication) || !keysEqual(value.authentication, ['posture', 'state'])
    || !record(value.permissions) || !keysEqual(value.permissions, ['access', 'autonomy', 'mode', 'sandbox'])
    || !record(value.containment) || !keysEqual(value.containment, [
      'filesystem', 'guarantees', 'hostProcess', 'network', 'observation', 'osSandbox',
    ]) || !Array.isArray(value.containment.guarantees) || value.containment.guarantees.length > 16) return null;
  const versionState = publicAtom(value.version.state);
  const versionValue = safeIdentifier(value.version.value)
    && !SECRET_SHAPED.some((item) => item.test(value.version.value)) ? value.version.value : null;
  const atoms = [
    value.authentication.posture, value.authentication.state,
    value.permissions.access, value.permissions.autonomy, value.permissions.mode,
    value.permissions.sandbox, value.containment.filesystem, value.containment.hostProcess,
    value.containment.network, value.containment.observation, value.containment.osSandbox,
    ...value.containment.guarantees,
  ];
  if (!versionState || !versionValue || atoms.some((item) => !publicAtom(item))) return null;
  return freeze(clone(value));
}

function normalizeCard(value, route, version) {
  if (!record(value) || !keysEqual(value, CARD_FIELDS)
    || value.harness !== route.harness || value.version !== version
    || !safeDigest(value.adapterCardDigest)
    || !safeIdentifier(value.family, 128) || !record(value.modelSelection)
    || !keysEqual(value.modelSelection, MODEL_SELECTION_FIELDS)) return null;
  const selection = value.modelSelection;
  if (selection.mode !== 'exact'
    || (selection.configuredDefault !== null && !safeIdentifier(selection.configuredDefault))
    || !safeList(selection.available, { nullable: true })
    || !safeList(selection.acceptedAliases) || !safeList(selection.acceptedPrefixes)
    || !safeList(selection.reasoningEffort) || !safeList(selection.serviceTier, { nullable: true })) return null;
  const modelAccepted = Array.isArray(selection.available)
    ? selection.available.includes(route.model)
    : selection.configuredDefault === route.model || selection.acceptedAliases.includes(route.model)
      || selection.acceptedPrefixes.some((prefix) => route.model.startsWith(prefix));
  if (!modelAccepted || !selection.reasoningEffort.includes(route.effort)) return null;
  return freeze(clone(value));
}

function normalizeWorkerPolicy(value) {
  if (value === null) return null;
  if (!record(value) || !keysEqual(value, WORKER_POLICY_FIELDS) || value.schemaVersion !== 1
    || !safeDigest(value.requestDigest) || !safeDigest(value.adapterCardDigest)
    || !safeDigest(value.resolutionDigest)) return undefined;
  return freeze(clone(value));
}

function normalizeEffect(value) {
  if (!record(value) || !keysEqual(value, EFFECT_FIELDS)
    || (value.runId !== null && !safeIdentifier(value.runId))
    || (value.nodeKey !== null && !safeIdentifier(value.nodeKey))
    || !safeIdentifier(value.taskId) || !safeIdentifier(value.workerId)
    || !safeIdentifier(value.phase, 64)
    || !Number.isSafeInteger(value.processGeneration) || value.processGeneration < 1) return null;
  return freeze(clone(value));
}

function remediationFor(code) {
  if (code === 'authentication_refresh_required') return 'Refresh provider authentication, then inspect this exact route again.';
  if (['authentication_required', 'authentication_metadata_invalid'].includes(code)) return 'Configure provider authentication, then inspect this exact route again.';
  if (code === 'harness_unavailable') return 'Install or repair the configured harness, then inspect this exact route again.';
  if (code === 'route_unconfigured') return 'Configure this exact route in the deployment profile.';
  return 'Inspect this exact route with doctor after the blocker is resolved.';
}

export function projectRouteReadinessError(cause) {
  const receipt = normalizeRouteAdmissionReceipt(cause?.receipt);
  if (!receipt || receipt.state !== 'waiting_for_route') return null;
  const route = receipt.route;
  const projected = freeze({
    code: 'route_waiting', message: receipt.blocker.summary,
    route, blocker: freeze({
      code: receipt.blocker.code, summary: receipt.blocker.summary,
    }),
    remediation: receipt.remediation,
    receipt: freeze(clone(receipt)),
  });
  return projected;
}

export function normalizeRouteAdmissionReceipt(value) {
  const fields = [
    'batch', 'bindingDigest', 'blocker', 'cardDigest', 'consumedAt',
    'credentialEpochCommitment', 'effect', 'effectDigest', 'expiresAt', 'generation',
    'issuedAt', 'reaped', 'receiptDigest', 'remediation', 'route', 'schemaVersion', 'state',
  ];
  if (!record(value) || !keysEqual(value, fields) || value.schemaVersion !== 1
    || !['admitted', 'waiting_for_route'].includes(value.state)
    || !safeDigest(value.bindingDigest) || !safeDigest(value.cardDigest)
    || !safeDigest(value.credentialEpochCommitment) || !safeDigest(value.effectDigest)
    || !safeDigest(value.receiptDigest) || !Number.isSafeInteger(value.generation)
    || value.generation < 1 || typeof value.reaped !== 'boolean'
    || !Number.isFinite(Date.parse(value.issuedAt))
    || (value.consumedAt !== null && !Number.isFinite(Date.parse(value.consumedAt)))
    || (value.expiresAt !== null && !Number.isFinite(Date.parse(value.expiresAt)))) return null;
  let route; let effect;
  try { route = exactRoute(value.route); effect = normalizeEffect(value.effect); }
  catch { return null; }
  if (!effect || digest(effect) !== value.effectDigest) return null;
  if (value.batch !== null && (!record(value.batch)
    || !keysEqual(value.batch, ['count', 'digest', 'ordinal']) || !safeDigest(value.batch.digest)
    || !Number.isSafeInteger(value.batch.ordinal) || !Number.isSafeInteger(value.batch.count)
    || value.batch.count < 1 || value.batch.ordinal < 0 || value.batch.ordinal >= value.batch.count)) return null;
  if (value.state === 'admitted') {
    if (value.blocker !== null || value.remediation !== null || value.consumedAt === null) return null;
  } else if (!record(value.blocker) || !keysEqual(value.blocker, ['code', 'summary'])
    || !safeIdentifier(value.blocker.code, 64)
    || boundedPublicText(value.blocker.summary, null) === null
    || boundedPublicText(value.remediation, null) === null) return null;
  const { receiptDigest, ...core } = value;
  if (digest(core) !== receiptDigest) return null;
  return freeze({ ...clone(value), route, effect });
}

export class RouteReadinessBlockedError extends Error {
  constructor(receipt) {
    super(receipt.blocker.summary);
    this.name = 'RouteReadinessBlockedError';
    this.code = 'route_waiting';
    this.routeCode = receipt.blocker.code;
    this.route = receipt.route;
    this.receipt = receipt;
  }
}

/**
 * Deployment-owned live route authority. Evaluators and credential epochs remain private.
 * Leases are unforgeable object capabilities, exact-binding, short-lived, and single-use.
 */
export class RouteReadinessAuthority {
  #configured;
  #evaluate;
  #credentialEpoch;
  #now;
  #leaseTtlMs;
  #probe;
  #probeTimeoutMs;
  #leases = new WeakMap();
  #batches = new WeakMap();
  #generations = new Map();
  #probes = new Map();
  #invalidations = new Map();
  #observations = new Map();
  #additional;
  #closed = false;
  #drainPromise = null;
  #operations = new Set();

  constructor({
    routes, evaluate, credentialEpoch = () => null, now = Date.now, leaseTtlMs = 5_000,
    probe = null, probeTimeoutMs = 10_000, additionalRoutes = [],
  } = {}) {
    if (!Array.isArray(routes) || routes.length === 0 || routes.length > 64
      || typeof evaluate !== 'function' || typeof credentialEpoch !== 'function'
      || typeof now !== 'function' || !Number.isSafeInteger(leaseTtlMs) || leaseTtlMs <= 0
      || leaseTtlMs > 60_000 || (probe !== null && typeof probe !== 'function')
      || !Number.isSafeInteger(probeTimeoutMs) || probeTimeoutMs <= 0 || probeTimeoutMs > 60_000
      || !Array.isArray(additionalRoutes) || additionalRoutes.length > 64) {
      throw new TypeError('RouteReadinessAuthority configuration is invalid');
    }
    this.#configured = new Map();
    for (const raw of routes) {
      const route = exactRoute(raw);
      const key = routeKey(route);
      if (this.#configured.has(key)) throw new TypeError('RouteReadinessAuthority routes contain a duplicate');
      this.#configured.set(key, route);
      this.#generations.set(key, { generation: 1, epochDigest: null, stateDigest: null });
    }
    this.#evaluate = evaluate;
    this.#credentialEpoch = credentialEpoch;
    this.#now = now;
    this.#leaseTtlMs = leaseTtlMs;
    this.#probe = probe;
    this.#probeTimeoutMs = probeTimeoutMs;
    this.#additional = freeze(additionalRoutes.map((raw) => {
      const route = exactRoute({ harness: raw?.harness, model: raw?.model, effort: raw?.effort });
      return this.#sanitize(route, raw);
    }));
  }

  validate(route) {
    this.#assertOpen();
    const normalized = exactRoute(route);
    if (!this.#configured.has(routeKey(normalized))) {
      throw routeError('exact route is not configured by this deployment', 'route_unconfigured', normalized);
    }
    return normalized;
  }

  #assertOpen() {
    if (this.#closed) throw routeError('route readiness authority is closed', 'route_authority_closed');
  }

  #withOperation(operation) {
    this.#assertOpen();
    const pending = Promise.resolve().then(operation);
    this.#operations.add(pending);
    pending.then(
      () => this.#operations.delete(pending),
      () => this.#operations.delete(pending),
    );
    return pending;
  }

  #settleWithin(promises) {
    if (promises.length === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; resolve(false); }
      }, this.#probeTimeoutMs);
      Promise.allSettled(promises).then(() => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(true); }
      });
    });
  }

  #epoch(route) {
    const exact = exactRoute({ harness: route.harness, model: route.model, effort: route.effort });
    try { return digest(this.#credentialEpoch(exact)); }
    catch {
      throw routeError('credential generation authority is unavailable',
        'credential_epoch_unavailable', exact);
    }
  }

  #sanitize(route, raw) {
    const state = raw?.state === 'ready' ? 'ready' : 'blocked';
    const code = state === 'ready' ? null
      : typeof raw?.code === 'string' && /^[a-z][a-z0-9_]{1,63}$/u.test(raw.code)
        ? raw.code : 'route_not_ready';
    const summary = boundedPublicText(raw?.summary,
      state === 'ready' ? 'The exact route is ready.' : 'The exact route is temporarily blocked.');
    const runtime = publicRuntime(raw?.runtime);
    return freeze({ ...route, state, ...(code ? { code } : {}), summary, ...(runtime ? { runtime } : {}) });
  }

  #observeGeneration(route, publicState, epochDigest = this.#epoch(route)) {
    const key = routeKey(route);
    const prior = this.#generations.get(key);
    const stateDigest = digest(publicState);
    const changed = prior.epochDigest !== null
      && (prior.epochDigest !== epochDigest || prior.stateDigest !== stateDigest);
    const next = { generation: prior.generation + (changed ? 1 : 0), epochDigest, stateDigest };
    this.#generations.set(key, next);
    return next;
  }

  async #boundedProbe(route, state) {
    if (!this.#probe || state.state !== 'blocked' || state.code !== 'diagnostic_probe_required') return state;
    this.#assertOpen();
    const key = routeKey(route);
    const existing = this.#probes.get(key);
    if (existing) return existing.publicResult;
    const controller = new AbortController();
    const rawProbe = Promise.resolve().then(() => this.#probe({ route, signal: controller.signal }));
    const entry = { controller, publicResult: null, settlement: null, settled: false, reaped: false };
    const exactReap = (result) => record(result) && keysEqual(result, [
      'authenticated', 'initialized', 'promptSent', 'reaped', 'sessionCreated', 'state',
    ]) && result.sessionCreated === false && result.promptSent === false && result.reaped === true;
    entry.settlement = rawProbe.then((result) => {
      entry.settled = true;
      entry.reaped = exactReap(result);
      if (entry.reaped && this.#probes.get(key) === entry) this.#probes.delete(key);
      return entry.reaped;
    }, () => { entry.settled = true; return false; });
    entry.publicResult = new Promise((resolve) => {
      const timer = setTimeout(() => {
        controller.abort('route_probe_timeout');
        resolve(freeze({ ...state, state: 'blocked', code: 'diagnostic_probe_unsettled',
          summary: 'The bounded route diagnostic timed out and has not proved exact reap.' }));
      }, this.#probeTimeoutMs);
      timer.unref?.();
      rawProbe.then((result) => {
        clearTimeout(timer);
        const exactReady = exactReap(result) && result.state === 'ready'
          && result.initialized === true && result.authenticated === true;
        const { code: _blockedCode, ...readyState } = state;
        resolve(exactReady ? freeze({ ...readyState, state: 'ready',
          summary: 'The exact route passed a bounded authentication diagnostic and was reaped.' })
          : freeze({ ...state, state: 'blocked', code: exactReap(result)
            ? 'diagnostic_probe_failed' : 'diagnostic_probe_unsettled',
          summary: exactReap(result)
            ? 'The bounded route diagnostic did not prove authentication.'
            : 'The bounded route diagnostic did not prove exact reap.' }));
      }, () => {
        clearTimeout(timer);
        resolve(freeze({ ...state, state: 'blocked', code: 'diagnostic_probe_unsettled',
          summary: 'The bounded route diagnostic failed without proving exact reap.' }));
      });
    });
    this.#probes.set(key, entry);
    return entry.publicResult;
  }

  inspect(route, options = {}) {
    return this.#withOperation(() => this.#inspect(route, options));
  }

  async #inspect(route, { probe = true } = {}) {
    const normalized = this.validate(route);
    let epochDigest;
    try { epochDigest = this.#epoch(normalized); }
    catch {
      const state = this.#sanitize(normalized, {
        state: 'blocked', code: 'credential_epoch_unavailable',
        summary: 'Credential generation authority is temporarily unavailable.',
      });
      const fallbackEpoch = digest({ state: 'credential_epoch_unavailable' });
      return freeze({ ...state,
        generation: this.#observeGeneration(normalized, state, fallbackEpoch).generation });
    }
    const invalidated = this.#invalidations.get(routeKey(normalized));
    let raw;
    if (invalidated && invalidated.epochDigest === epochDigest) raw = invalidated.state;
    else {
      if (invalidated) this.#invalidations.delete(routeKey(normalized));
      try { raw = await this.#evaluate(normalized); }
      catch { raw = { state: 'blocked', code: 'route_authority_unavailable', summary: 'Live route readiness could not be evaluated.' }; }
    }
    this.#assertOpen();
    let state = this.#sanitize(normalized, raw);
    if (probe) state = await this.#boundedProbe(normalized, state);
    this.#assertOpen();
    let finalEpochDigest;
    try { finalEpochDigest = this.#epoch(normalized); }
    catch {
      state = this.#sanitize(normalized, {
        state: 'blocked', code: 'credential_epoch_unavailable',
        summary: 'Credential generation authority is temporarily unavailable.',
      });
      finalEpochDigest = digest({ state: 'credential_epoch_unavailable' });
    }
    if (finalEpochDigest !== epochDigest) {
      state = this.#sanitize(normalized, {
        state: 'blocked', code: 'credential_generation_changed',
        summary: 'Credential generation changed during live route inspection.',
      });
    }
    const observed = freeze({ ...state,
      generation: this.#observeGeneration(normalized, state, finalEpochDigest).generation });
    this.#observations.set(routeKey(normalized), { epochDigest: finalEpochDigest, state: observed });
    return observed;
  }

  inspectSync(route) {
    const normalized = this.validate(route);
    let epochDigest;
    try { epochDigest = this.#epoch(normalized); }
    catch {
      const state = this.#sanitize(normalized, {
        state: 'blocked', code: 'credential_epoch_unavailable',
        summary: 'Credential generation authority is temporarily unavailable.',
      });
      const fallbackEpoch = digest({ state: 'credential_epoch_unavailable' });
      return freeze({ ...state,
        generation: this.#observeGeneration(normalized, state, fallbackEpoch).generation });
    }
    const invalidated = this.#invalidations.get(routeKey(normalized));
    let raw;
    if (invalidated && invalidated.epochDigest === epochDigest) raw = invalidated.state;
    else {
      if (invalidated) this.#invalidations.delete(routeKey(normalized));
      try { raw = this.#evaluate(normalized); }
      catch { raw = { state: 'blocked', code: 'route_authority_unavailable', summary: 'Live route readiness could not be evaluated.' }; }
      if (raw && typeof raw.then === 'function') raw = { state: 'blocked', code: 'route_authority_unavailable', summary: 'Live route readiness requires an asynchronous inspection.' };
    }
    let state = this.#sanitize(normalized, raw);
    const priorObservation = this.#observations.get(routeKey(normalized));
    if (state.state === 'blocked' && state.code === 'diagnostic_probe_required'
      && priorObservation?.epochDigest === epochDigest) state = priorObservation.state;
    return freeze({ ...state, generation: this.#observeGeneration(normalized, state, epochDigest).generation });
  }

  async snapshot() {
    const routes = await Promise.all([...this.#configured.values()].map((route) => this.inspect(route)));
    return freeze({ schemaVersion: 2, ready: routes.some((route) => route.state === 'ready'),
      routes: [...routes, ...clone(this.#additional)] });
  }

  snapshotSync() {
    const routes = [...this.#configured.values()].map((route) => this.inspectSync(route));
    return freeze({ schemaVersion: 2, ready: routes.some((route) => route.state === 'ready'),
      routes: [...routes, ...clone(this.#additional)] });
  }

  invalidate(routeValue, code = 'authentication_required') {
    const route = this.validate(routeValue);
    const epochDigest = this.#epoch(route);
    const safeCode = AUTHENTICATION_CODES.has(code) ? code : 'authentication_required';
    const state = freeze({ state: 'blocked', code: safeCode,
      summary: safeCode === 'authentication_refresh_required'
        ? 'Provider authentication was refused and must be refreshed.'
        : 'Provider authentication was refused for this exact route.' });
    this.#invalidations.set(routeKey(route), { epochDigest, state });
    const publicState = this.#sanitize(route, state);
    const key = routeKey(route);
    const prior = this.#generations.get(key);
    this.#generations.set(key, {
      generation: prior.generation + 1, epochDigest, stateDigest: digest(publicState),
    });
    return freeze({ ...publicState, generation: this.#generations.get(routeKey(route)).generation });
  }

  #normalizeBinding(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !keysEqual(value, BINDING_FIELDS)) {
      throw routeError('route admission binding is invalid', 'route_admission_invalid');
    }
    const route = this.validate(exactRoute({ harness: value.harness, model: value.model, effort: value.effort }));
    const card = normalizeCard(value.card, route, value.version);
    const effect = normalizeEffect(value.effect);
    const workerPolicy = normalizeWorkerPolicy(value.workerPolicy);
    if (typeof value.version !== 'string' || value.version.length === 0 || Buffer.byteLength(value.version) > 256
      || /[\0\r\n]/u.test(value.version) || typeof value.taskType !== 'string'
      || value.taskType.length === 0 || Buffer.byteLength(value.taskType) > 256
      || (value.serviceTier !== null && (typeof value.serviceTier !== 'string'
        || value.serviceTier.length === 0 || Buffer.byteLength(value.serviceTier) > 128))
      || !card || !effect || workerPolicy === undefined
      || (workerPolicy !== null && workerPolicy.adapterCardDigest !== card.adapterCardDigest)
      || (value.serviceTier !== null && !card.modelSelection.serviceTier?.includes(value.serviceTier))) {
      throw routeError('route admission binding is invalid', 'route_admission_invalid', route);
    }
    return freeze({ ...clone(value), card, effect, workerPolicy });
  }

  #receipt(binding, state, bindingDigest = digest(binding), epochDigest = null, timing = {}, batch = null) {
    const boundEpochDigest = epochDigest ?? (() => {
      try { return this.#epoch(bindingRoute(binding)); }
      catch { return digest({ state: 'credential_epoch_unavailable' }); }
    })();
    const core = {
      schemaVersion: 1,
      route: { harness: binding.harness, model: binding.model, effort: binding.effort },
      state: state.state === 'ready' ? 'admitted' : 'waiting_for_route',
      generation: state.generation,
      issuedAt: new Date(timing.issuedAt ?? this.#now()).toISOString(),
      consumedAt: timing.consumedAt == null ? null : new Date(timing.consumedAt).toISOString(),
      expiresAt: timing.expiresAt == null ? null : new Date(timing.expiresAt).toISOString(),
      bindingDigest,
      cardDigest: binding.card.adapterCardDigest,
      credentialEpochCommitment: digest({ schemaVersion: 1, epochDigest: boundEpochDigest }),
      effect: clone(binding.effect),
      effectDigest: digest(binding.effect),
      batch: batch ? freeze(clone(batch)) : null,
      blocker: state.state === 'ready' ? null : { code: state.code, summary: state.summary },
      remediation: state.state === 'ready' ? null : remediationFor(state.code),
      reaped: state.code !== 'diagnostic_probe_unsettled',
    };
    return freeze({ ...core, receiptDigest: digest(core) });
  }

  #generationChanged(state) {
    return freeze({
      ...state,
      state: 'blocked',
      code: 'route_generation_changed',
      summary: 'Exact route readiness changed after admission was prepared.',
    });
  }

  waiting(bindingValue, code = 'adapter_card_changed') {
    this.#assertOpen();
    const binding = this.#normalizeBinding(bindingValue);
    const route = bindingRoute(binding);
    const allowed = new Map([
      ['adapter_card_changed', 'The live adapter card changed before the provider effect boundary.'],
      ['credential_generation_changed', 'The credential generation changed before the provider effect boundary.'],
      ['route_binding_changed', 'The exact route binding changed before the provider effect boundary.'],
    ]);
    const safeCode = allowed.has(code) ? code : 'route_binding_changed';
    const prior = this.#generations.get(routeKey(route));
    const state = freeze({
      ...route, state: 'blocked', code: safeCode, summary: allowed.get(safeCode),
      generation: prior?.generation ?? 1,
    });
    return this.#receipt(binding, state);
  }

  issue(bindingValue) {
    return this.#withOperation(() => this.#issue(bindingValue));
  }

  async #issue(bindingValue) {
    const binding = this.#normalizeBinding(bindingValue);
    const route = { harness: binding.harness, model: binding.model, effort: binding.effort };
    const bindingDigest = digest(binding);
    const state = await this.inspect(route);
    this.#assertOpen();
    let epochDigest;
    try { epochDigest = this.#epoch(route); }
    catch {
      const unavailable = freeze({
        ...state, state: 'blocked', code: 'credential_epoch_unavailable',
        summary: 'Credential generation authority is temporarily unavailable.',
      });
      throw new RouteReadinessBlockedError(this.#receipt(
        binding, unavailable, bindingDigest, digest({ state: 'credential_epoch_unavailable' }),
      ));
    }
    const issuedAt = this.#now();
    const expiresAt = issuedAt + this.#leaseTtlMs;
    const receipt = this.#receipt(binding, state, bindingDigest, epochDigest, { issuedAt, expiresAt });
    if (state.state !== 'ready') throw new RouteReadinessBlockedError(receipt);
    const lease = Object.freeze({ capability: randomBytes(16).toString('hex') });
    this.#leases.set(lease, {
      bindingDigest, generation: state.generation, epochDigest,
      expiresAt, issuedAt, used: false, receipt, binding,
    });
    return lease;
  }

  prepareMany(bindingValues) {
    return this.#withOperation(() => this.#prepareMany(bindingValues));
  }

  async #prepareMany(bindingValues) {
    if (!Array.isArray(bindingValues) || bindingValues.length === 0 || bindingValues.length > 64) {
      throw routeError('route admission batch is invalid', 'route_admission_invalid');
    }
    const bindings = bindingValues.map((value) => this.#normalizeBinding(value));
    const bindingDigests = bindings.map((value) => digest(value));
    const effectDigests = bindings.map((value) => digest(value.effect));
    if (new Set(effectDigests).size !== effectDigests.length) {
      throw routeError('route admission batch contains a duplicate effect', 'route_admission_invalid');
    }
    const states = await Promise.all(bindings.map((value) => this.inspect({
      harness: value.harness, model: value.model, effort: value.effort,
    })));
    this.#assertOpen();
    const blocked = states.findIndex((state) => state.state !== 'ready');
    if (blocked >= 0) throw new RouteReadinessBlockedError(
      this.#receipt(bindings[blocked], states[blocked], bindingDigests[blocked]),
    );
    const epochDigests = [];
    for (let index = 0; index < bindings.length; index += 1) {
      try { epochDigests.push(this.#epoch(bindingRoute(bindings[index]))); }
      catch {
        const unavailable = freeze({
          ...states[index], state: 'blocked', code: 'credential_epoch_unavailable',
          summary: 'Credential generation authority is temporarily unavailable.',
        });
        throw new RouteReadinessBlockedError(this.#receipt(
          bindings[index], unavailable, bindingDigests[index],
          digest({ state: 'credential_epoch_unavailable' }),
        ));
      }
    }
    this.#assertOpen();
    const batch = Object.freeze({ capability: randomBytes(16).toString('hex') });
    const issuedAt = this.#now();
    const expiresAt = issuedAt + this.#leaseTtlMs;
    const batchDigest = digest({ schemaVersion: 1, bindingDigests, effectDigests,
      generations: states.map((state) => state.generation) });
    this.#batches.set(batch, {
      bindings: bindings.map((value, index) => ({
        bindingDigest: bindingDigests[index], generation: states[index].generation,
        binding: value, epochDigest: epochDigests[index], receipt: this.#receipt(
          value, states[index], bindingDigests[index], epochDigests[index],
          { issuedAt, expiresAt }, { digest: batchDigest, ordinal: index, count: bindings.length },
        ),
      })),
      batchDigest, issuedAt, expiresAt,
      used: false,
    });
    return batch;
  }

  consumeMany(batch, bindingValues) {
    return this.#withOperation(() => this.#consumeMany(batch, bindingValues));
  }

  async #consumeMany(batch, bindingValues) {
    if (!Array.isArray(bindingValues) || bindingValues.length === 0 || bindingValues.length > 64) {
      throw routeError('route admission batch is invalid', 'route_admission_invalid');
    }
    const bindings = bindingValues.map((value) => this.#normalizeBinding(value));
    const held = this.#batches.get(batch);
    if (!held) throw routeError('route admission batch is absent or mismatched', 'route_lease_invalid');
    if (held.used) {
      throw Object.assign(routeError('route admission batch was already consumed', 'route_lease_replayed'), {
        receipts: freeze(held.bindings.map((entry) => entry.receipt)),
      });
    }
    held.used = true;
    const exact = held.bindings.length === bindings.length && bindings.every((value, index) => (
      held.bindings[index].bindingDigest === digest(value)
      && (() => {
        try { return held.bindings[index].epochDigest === this.#epoch(bindingRoute(value)); }
        catch { return false; }
      })()
    ));
    if (!exact || held.expiresAt <= this.#now()) {
      throw Object.assign(routeError('route admission batch is expired or mismatched', 'route_lease_invalid'), {
        receipts: freeze(held.bindings.map((entry) => entry.receipt)),
      });
    }
    const states = await Promise.all(bindings.map((value) => this.inspect({
      harness: value.harness, model: value.model, effort: value.effort,
    })));
    this.#assertOpen();
    const blocked = states.findIndex((state, index) => (
      state.state !== 'ready' || state.generation !== held.bindings[index].generation
    ));
    const consumedAt = this.#now();
    const receiptStates = states.map((state, index) => (
      state.state === 'ready' && state.generation !== held.bindings[index].generation
        ? this.#generationChanged(state) : state
    ));
    const receipts = held.bindings.map((entry, index) => this.#receipt(
      entry.binding, receiptStates[index], entry.bindingDigest, entry.epochDigest,
      { issuedAt: held.issuedAt, consumedAt, expiresAt: held.expiresAt },
      { digest: held.batchDigest, ordinal: index, count: held.bindings.length },
    ));
    held.bindings.forEach((entry, index) => { entry.receipt = receipts[index]; });
    if (blocked >= 0) {
      const failure = new RouteReadinessBlockedError(receipts[blocked]);
      failure.receipts = freeze(receipts);
      throw failure;
    }
    return freeze(receipts);
  }

  consume(lease, bindingValue) {
    return this.#withOperation(() => this.#consume(lease, bindingValue));
  }

  async #consume(lease, bindingValue) {
    const binding = this.#normalizeBinding(bindingValue);
    const route = { harness: binding.harness, model: binding.model, effort: binding.effort };
    const held = this.#leases.get(lease);
    if (!held) throw routeError('route admission lease is absent or mismatched', 'route_lease_invalid', route);
    if (held.used) throw routeError('route admission lease was already consumed', 'route_lease_replayed', route, held.receipt);
    held.used = true;
    if (held.expiresAt <= this.#now() || held.bindingDigest !== digest(binding)
      || (() => { try { return held.epochDigest !== this.#epoch(route); } catch { return true; } })()) {
      throw routeError('route admission lease is expired or mismatched', 'route_lease_invalid', route, held.receipt);
    }
    const state = await this.inspect(route);
    this.#assertOpen();
    if (state.state !== 'ready' || state.generation !== held.generation) {
      const blockedState = state.state === 'ready' ? this.#generationChanged(state) : state;
      throw new RouteReadinessBlockedError(this.#receipt(
        binding, blockedState, held.bindingDigest, held.epochDigest,
        { issuedAt: held.issuedAt, consumedAt: this.#now(), expiresAt: held.expiresAt },
      ));
    }
    held.receipt = this.#receipt(binding, state, held.bindingDigest, held.epochDigest, {
      issuedAt: held.issuedAt, consumedAt: this.#now(), expiresAt: held.expiresAt,
    });
    return held.receipt;
  }

  async admit(binding) {
    const lease = await this.issue(binding);
    return this.consume(lease, binding);
  }

  async close() {
    if (this.#drainPromise) return this.#drainPromise;
    this.#closed = true;
    for (const entry of this.#probes.values()) entry.controller.abort('route_authority_closed');
    this.#drainPromise = (async () => {
      const operationsSettled = await this.#settleWithin([...this.#operations]);
      for (const entry of this.#probes.values()) entry.controller.abort('route_authority_closed');
      const probesSettled = await this.#settleWithin(
        [...this.#probes.values()].map((entry) => entry.settlement),
      );
      const drained = [...this.#probes.values()].every((entry) => entry.settled && entry.reaped);
      if (!operationsSettled || !probesSettled || !drained) throw routeError(
        'route readiness authority could not prove diagnostic process reap',
        'route_probe_unreaped',
      );
      return freeze({ state: 'closed', reaped: true });
    })();
    return this.#drainPromise;
  }
}

export { exactRoute as normalizeExactRoute };
