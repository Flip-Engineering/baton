import { createHash, randomBytes } from 'node:crypto';

const ROUTE_FIELDS = Object.freeze(['effort', 'harness', 'model']);
const BINDING_FIELDS = Object.freeze([
  'card', 'effort', 'harness', 'model', 'serviceTier', 'taskType', 'version', 'workerPolicy',
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

function routeError(message, code, route = null) {
  return Object.assign(new Error(message), { code, ...(route ? { route: freeze(clone(route)) } : {}) });
}

function exactRoute(value, code = 'route_invalid') {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...ROUTE_FIELDS].sort().join(',')
    || ROUTE_FIELDS.some((field) => typeof value[field] !== 'string' || value[field].length === 0
      || value[field].length > 256 || /[\0\r\n]/u.test(value[field]))) {
    throw routeError('exact route must contain only bounded harness, model, and effort', code);
  }
  return freeze({ harness: value.harness, model: value.model, effort: value.effort });
}

function boundedPublicText(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const text = value.normalize('NFKC').trim();
  if (text.length === 0 || Buffer.byteLength(text) > 1024 || SECRET_SHAPED.some((item) => item.test(text))) {
    return fallback;
  }
  return text;
}

function remediationFor(code) {
  if (code === 'authentication_refresh_required') return 'Refresh provider authentication, then inspect this exact route again.';
  if (code === 'authentication_required') return 'Configure provider authentication, then inspect this exact route again.';
  if (code === 'harness_unavailable') return 'Install or repair the configured harness, then inspect this exact route again.';
  if (code === 'route_unconfigured') return 'Configure this exact route in the deployment profile.';
  return 'Inspect this exact route with doctor after the blocker is resolved.';
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
 * Deployment-owned live route authority. The evaluator and credential epoch remain private;
 * callers receive only bounded route state and sanitized receipts. Leases are unforgeable object
 * capabilities held in a WeakMap, short-lived, exact-binding, and consumed at most once.
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
  #generations = new Map();
  #probes = new Map();
  #additional;

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
    this.#additional = freeze(clone(additionalRoutes));
  }

  validate(route) {
    const normalized = exactRoute(route);
    if (!this.#configured.has(routeKey(normalized))) {
      throw routeError('exact route is not configured by this deployment', 'route_unconfigured', normalized);
    }
    return normalized;
  }

  #sanitize(route, raw) {
    const state = raw?.state === 'ready' ? 'ready' : 'blocked';
    const code = state === 'ready' ? null
      : typeof raw?.code === 'string' && /^[a-z][a-z0-9_]{1,63}$/u.test(raw.code)
        ? raw.code : 'route_not_ready';
    const summary = boundedPublicText(raw?.summary,
      state === 'ready' ? 'The exact route is ready.' : 'The exact route is temporarily blocked.');
    const runtime = raw?.runtime && typeof raw.runtime === 'object' && !Array.isArray(raw.runtime)
      ? clone(raw.runtime) : undefined;
    return freeze({
      ...route, state, ...(code ? { code } : {}), summary,
      ...(runtime ? { runtime } : {}),
    });
  }

  #observeGeneration(route, publicState) {
    const key = routeKey(route);
    const prior = this.#generations.get(key);
    let epoch;
    try { epoch = this.#credentialEpoch(route); } catch { epoch = { state: 'unavailable' }; }
    const epochDigest = digest(epoch);
    const stateDigest = digest(publicState);
    const changed = prior.epochDigest !== null
      && (prior.epochDigest !== epochDigest || prior.stateDigest !== stateDigest);
    const generation = prior.generation + (changed ? 1 : 0);
    const next = { generation, epochDigest, stateDigest };
    this.#generations.set(key, next);
    return next;
  }

  async #boundedProbe(route, state) {
    if (!this.#probe || state.state !== 'blocked' || state.code !== 'diagnostic_probe_required') return state;
    const key = routeKey(route);
    if (this.#probes.has(key)) return this.#probes.get(key);
    const attempt = (async () => {
      const controller = new AbortController();
      let timer;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => {
          controller.abort('route_probe_timeout');
          resolve(null);
        }, this.#probeTimeoutMs);
        timer.unref?.();
      });
      let result;
      try { result = await Promise.race([Promise.resolve(this.#probe({ route, signal: controller.signal })), timeout]); }
      catch { result = null; }
      finally { clearTimeout(timer); }
      const exact = result && result.state === 'ready' && result.initialized === true
        && result.authenticated === true && result.sessionCreated === false
        && result.promptSent === false && result.reaped === true
        && Object.keys(result).sort().join(',') === [
          'authenticated', 'initialized', 'promptSent', 'reaped', 'sessionCreated', 'state',
        ].sort().join(',');
      return exact ? freeze({ ...state, state: 'ready', code: undefined,
        summary: 'The exact route passed a bounded authentication diagnostic and was reaped.' })
        : freeze({ ...state, state: 'blocked', code: 'diagnostic_probe_failed',
          summary: 'The bounded route diagnostic did not prove authentication and exact reap.' });
    })().finally(() => this.#probes.delete(key));
    this.#probes.set(key, attempt);
    return attempt;
  }

  async inspect(route, { probe = true } = {}) {
    const normalized = this.validate(route);
    let raw;
    try { raw = await this.#evaluate(normalized); }
    catch { raw = { state: 'blocked', code: 'route_authority_unavailable', summary: 'Live route readiness could not be evaluated.' }; }
    let state = this.#sanitize(normalized, raw);
    if (probe) state = await this.#boundedProbe(normalized, state);
    const generation = this.#observeGeneration(normalized, state).generation;
    return freeze({ ...state, generation });
  }

  inspectSync(route) {
    const normalized = this.validate(route);
    let raw;
    try { raw = this.#evaluate(normalized); }
    catch { raw = { state: 'blocked', code: 'route_authority_unavailable', summary: 'Live route readiness could not be evaluated.' }; }
    if (raw && typeof raw.then === 'function') {
      raw = { state: 'blocked', code: 'route_authority_unavailable', summary: 'Live route readiness requires an asynchronous inspection.' };
    }
    const state = this.#sanitize(normalized, raw);
    const generation = this.#observeGeneration(normalized, state).generation;
    return freeze({ ...state, generation });
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

  #normalizeBinding(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== [...BINDING_FIELDS].sort().join(',')) {
      throw routeError('route admission binding is invalid', 'route_admission_invalid');
    }
    const route = exactRoute(value);
    this.validate(route);
    if (typeof value.version !== 'string' || value.version.length === 0 || value.version.length > 256
      || /[\0\r\n]/u.test(value.version) || typeof value.taskType !== 'string'
      || value.taskType.length === 0 || value.taskType.length > 256
      || (value.serviceTier !== null && (typeof value.serviceTier !== 'string'
        || value.serviceTier.length === 0 || value.serviceTier.length > 128))
      || !value.card || typeof value.card !== 'object' || Array.isArray(value.card)) {
      throw routeError('route admission binding is invalid', 'route_admission_invalid', route);
    }
    return freeze(clone(value));
  }

  #receipt(binding, state) {
    const core = {
      schemaVersion: 1,
      route: { harness: binding.harness, model: binding.model, effort: binding.effort },
      state: state.state === 'ready' ? 'admitted' : 'waiting_for_route',
      generation: state.generation,
      observedAt: new Date(this.#now()).toISOString(),
      bindingDigest: digest(binding),
      blocker: state.state === 'ready' ? null : { code: state.code, summary: state.summary },
      remediation: state.state === 'ready' ? null : remediationFor(state.code),
      reaped: true,
    };
    return freeze({ ...core, receiptDigest: digest(core) });
  }

  async issue(bindingValue) {
    const binding = this.#normalizeBinding(bindingValue);
    const state = await this.inspect(binding);
    const receipt = this.#receipt(binding, state);
    if (state.state !== 'ready') throw new RouteReadinessBlockedError(receipt);
    const lease = Object.freeze({ capability: randomBytes(16).toString('hex') });
    this.#leases.set(lease, {
      bindingDigest: digest(binding), generation: state.generation,
      expiresAt: this.#now() + this.#leaseTtlMs, used: false, receipt,
    });
    return lease;
  }

  async consume(lease, bindingValue) {
    const binding = this.#normalizeBinding(bindingValue);
    const held = this.#leases.get(lease);
    if (!held || held.used || held.expiresAt <= this.#now()
      || held.bindingDigest !== digest(binding)) {
      throw routeError('route admission lease is absent, expired, used, or mismatched', 'route_lease_invalid', binding);
    }
    held.used = true;
    const state = await this.inspect(binding);
    if (state.state !== 'ready' || state.generation !== held.generation) {
      throw new RouteReadinessBlockedError(this.#receipt(binding, state));
    }
    return held.receipt;
  }

  async admit(binding) {
    const lease = await this.issue(binding);
    return this.consume(lease, binding);
  }
}

export { exactRoute as normalizeExactRoute };
