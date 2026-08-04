import { createHash, randomBytes } from 'node:crypto';

// RouteLiveness — the #47 bounded actual-inference readiness tier
// (docs/reference/evidence/frontier-sweep-2026-08-03/readiness-credentials-contract.md §4.1).
// An additive liveness attribute on the existing route state: per-route probe cache joined to
// credential identity, single-flight per route, never probe per call, credential-scoped
// invalid_grant fan-out (fold F-1), typed probe receipts on the shared evidence path (F-4).

const PROBE_WORKER_PREFIX = 'liveness-probe-';
// Vendor-derived window defaults (configurable deployment-side): grok OIDC-subscription routes are
// bounded by the observed 28-min credential TTL; claude routes by the observed 4.4h access TTL;
// static-key routes default long because the key is non-expiring.
const GROK_WINDOW_MS = 28 * 60 * 1000;
const CLAUDE_WINDOW_MS = Math.round(4.4 * 60 * 60 * 1000);
const STATIC_KEY_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PROBE_TIMEOUT_MS = 120_000;
const DEFAULT_FAILURE_WINDOW_MS = 10 * 60 * 1000;
const PROBE_PROMPT_MAX_BYTES = 1024;
const PROBE_CAPTURE_MAX_BYTES = 2048;
const TERMINAL_KINDS = new Set([
  'lifecycle.turn_completed', 'lifecycle.process_closed', 'lifecycle.crashed', 'lifecycle.exited',
]);
const GROK_REMEDY = 'Grok authentication has expired. Run the ordinary `grok login` flow to refresh authentication, then reopen Baton.';

function routeKey(route) {
  return JSON.stringify([route.harness, route.model, route.effort]);
}

/** Mirrors the deployment's exact-route matching (application-deployment.mjs routeCardMatches),
 * plus the #47 probe-capability gate: a route is probe-capable only when its adapter card is a
 * pausable real-provider session (`turnCompletion: 'pausable'` — the family every real adapter
 * and the readiness suite's scriptable fixture claims). Non-pausable test doubles (MockAdapter)
 * cannot execute a bounded content-verified probe, so the gate skips them — the tier measures
 * routes with a real provider turn lifecycle, never blocking a route it cannot probe. */
function routeMatches(card, route) {
  if (card?.harness !== route.harness) return false;
  if (card?.turnCompletion !== 'pausable') return false;
  const selection = card?.modelSelection;
  const modelAvailable = selection?.mode === 'exact'
    && (Array.isArray(selection.available)
      ? selection.available.includes(route.model)
      : selection.configuredDefault === route.model
        || selection.acceptedAliases?.includes(route.model) === true
        || selection.acceptedPrefixes?.some((prefix) => route.model.startsWith(prefix)) === true);
  return modelAvailable && Array.isArray(selection?.reasoningEffort)
    && selection.reasoningEffort.includes(route.effort);
}

/** The per-vendor credential identity the liveness tuple measures (contract §4.1.3, fold F-1). */
export function routeCredentialKey(vendor) {
  const name = String(vendor);
  if (name.includes('grok')) return 'grok:global';
  if (name.includes('codex')) return 'codex:global';
  if (name.includes('kimi')) return 'kimi:global';
  if (name.includes('claude')) return `claude:${createHash('sha256').update(name).digest('hex').slice(0, 24)}`;
  return `${name}:global`;
}

function blockedError(row) {
  return Object.assign(new Error(row?.summary ?? 'Route liveness is blocked'), {
    code: row?.code ?? 'provider_unreachable',
  });
}

export class RouteLiveness {
  constructor({ now, probeTimeoutMs, failureWindowMs, coordinator, coordination, adapters, log } = {}) {
    this.now = now ?? Date.now;
    this.probeTimeoutMs = probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.failureWindowMs = failureWindowMs ?? DEFAULT_FAILURE_WINDOW_MS;
    this._coordinator = coordinator;
    this._coordination = coordination;
    this._adapters = adapters ?? {};
    this._log = log ?? null;
    this._cache = new Map();
    this._flights = new Map();
    this._pendingProbes = new Map();
    this._wrapAdapters();
  }

  // The adapter listener is single-slot (the coordinator owns it). Wrap it once so liveness
  // observes BOTH probe turns (isolated probe workers) and real worker turns (refresh-token death
  // propagation, §4.3.3) without disturbing the coordinator's own handling.
  _wrapAdapters() {
    for (const [vendor, adapter] of Object.entries(this._adapters)) {
      if (typeof adapter?.onEvent !== 'function') continue;
      // The adapter listener is single-slot; the coordinator already registered its callback.
      // Capture it across every adapter's private storage spelling (GrokAcpCli/ClaudeSessionCli
      // use `_cb`, the readiness suite's ScriptableAdapter uses `_onEvent`, MockAdapter uses
      // `_userCb`) so the wrapper forwards to the coordinator instead of orphaning it.
      const prior = adapter._userCb ?? adapter._cb ?? adapter._onEvent ?? null;
      adapter.onEvent((event) => {
        if (prior) prior(event);
        this._onAdapterEvent(event, vendor);
      });
    }
  }

  _onAdapterEvent(event, vendor) {
    const worker = event?.worker;
    if (typeof worker === 'string' && worker.startsWith(PROBE_WORKER_PREFIX)) {
      const pending = this._pendingProbes.get(worker);
      if (pending && !pending.settled) {
        if (event?.kind === 'lifecycle.spawned') pending.sawSpawned = true;
        if (TERMINAL_KINDS.has(event?.kind)) {
          pending.settled = true;
          pending.terminalResolve(event);
        }
      }
      return;
    }
    // §4.3.3: a worker turn surfacing refresh-token death is a finding — it propagates to every
    // liveness row sharing the credentialKey (fold F-1), exactly as a probe verdict would.
    if (event?.kind === 'lifecycle.turn_completed' && event?.payload?.status === 'failed') {
      const output = String(event.payload.output ?? event.payload.result ?? '');
      if (/invalid_grant|revok/iu.test(output)) {
        this.invalidateCredential(routeCredentialKey(vendor), 'authentication_refresh_required');
      }
    }
  }

  adapterFor(route) {
    const cards = Object.entries(this._adapters).map(([name, adapter]) => ({ name, card: adapter.card() }));
    const preferredName = route.provider ? `${route.harness}:${route.provider}` : null;
    const preferred = preferredName
      ? cards.filter(({ name, card }) => name === preferredName && routeMatches(card, route)) : [];
    const matches = preferred.length > 0 ? preferred : cards.filter(({ card }) => routeMatches(card, route));
    if (matches.length !== 1) return null;
    return { adapter: this._adapters[matches[0].name], vendor: matches[0].name };
  }

  /** The spawn/preflight gate: consult the cache, probe only on stale or absent, never per call. */
  async ensure(route) {
    const key = routeKey(route);
    const row = this._cache.get(key);
    const now = this.now();
    if (row?.state === 'verified' && row.expiresAt > now) return row;
    if (row?.state === 'failed' && now - row.failedAt < this.failureWindowMs) {
      throw blockedError(row);
    }
    // A route whose adapter cannot execute a probe (no provider ever started) is honest-unsupported:
    // the tier is additive, so it must never block a route it cannot measure.
    if (row?.state === 'unsupported') return row;
    const fresh = await this._probeFlight(route);
    if (fresh.state === 'failed') throw blockedError(fresh);
    return fresh;
  }

  async _probeFlight(route) {
    const key = routeKey(route);
    if (this._flights.has(key)) {
      return this._flights.get(key);
    }
    const flight = this._runProbe(route).finally(() => {
      if (this._flights.get(key) === flight) this._flights.delete(key);
    });
    this._flights.set(key, flight);
    return flight;
  }

  _windowFor(route) {
    if (route.harness === 'grok') return GROK_WINDOW_MS;
    if (route.harness === 'claude-code') return CLAUDE_WINDOW_MS;
    return STATIC_KEY_WINDOW_MS;
  }

  _summaryFor(route, code) {
    return code === 'authentication_refresh_required' && route.harness === 'grok' ? GROK_REMEDY : null;
  }

  _summaryForCredential(credentialKey) {
    return credentialKey === 'grok:global' ? GROK_REMEDY : null;
  }

  async _runProbe(route) {
    const match = this.adapterFor(route);
    const credentialKey = match ? routeCredentialKey(match.vendor) : routeCredentialKey(route.harness);
    const started = this.now();
    if (!match) {
      // No probe-capable adapter matches the route (non-pausable card, e.g. a test double):
      // honest-unsupported, never a block — the tier measures routes with a real provider
      // turn lifecycle, and must not refuse spawns for routes it cannot probe.
      return this._fail(route, credentialKey, 'route_unavailable', started, null, { blocking: false });
    }
    const { adapter } = match;
    const probeId = `${PROBE_WORKER_PREFIX}${randomBytes(10).toString('hex')}`;
    const expectedLine = `${route.model}-probe ok`;
    const prompt = `Reply with exactly one line: '${expectedLine}'. Nothing else.`;
    if (Buffer.byteLength(prompt, 'utf8') > PROBE_PROMPT_MAX_BYTES) {
      return this._fail(route, credentialKey, 'probe_oversize', started, probeId);
    }

    const pending = { settled: false, sawSpawned: false, terminalResolve: null, timer: null };
    const terminal = new Promise((resolve) => { pending.terminalResolve = resolve; });
    this._pendingProbes.set(probeId, pending);

    let spawnAck;
    try {
      spawnAck = await adapter.spawn(probeId, { goal: prompt });
    } catch (error) {
      this._pendingProbes.delete(probeId);
      pending.settled = true;
      // A spawn throw with no typed adapter code means the probe could not run — non-blocking.
      const blocking = typeof error?.code === 'string' && error.code.length > 0;
      return this._fail(route, credentialKey, error?.code ?? 'provider_unreachable', started, probeId, { blocking });
    }
    if (!spawnAck?.ok) {
      this._pendingProbes.delete(probeId);
      pending.settled = true;
      // A TYPED adapter refusal blocks (§4.1.1 adapter-refusal class); an untyped refusal means
      // the adapter cannot execute a probe — honest-unsupported, never a block.
      const typed = typeof spawnAck?.code === 'string' && spawnAck.code.length > 0;
      const code = typed ? spawnAck.code : 'provider_unreachable';
      return this._fail(route, credentialKey, code, started, probeId, { blocking: typed });
    }

    const terminalEvent = await Promise.race([
      terminal,
      new Promise((resolve) => {
        pending.timer = setTimeout(() => resolve(null), this.probeTimeoutMs);
        pending.timer.unref?.();
      }),
    ]);
    if (pending.timer) clearTimeout(pending.timer);
    pending.settled = true;
    this._pendingProbes.delete(probeId);

    if (!terminalEvent) {
      // A probe that never started the provider (worktree/runtime unavailable) is honest-
      // unsupported, never a block; a probe that DID spawn and then hung is a genuine
      // network/timeout provider_unreachable (§4.1.1).
      return this._fail(route, credentialKey, 'provider_unreachable', started, probeId, { blocking: pending.sawSpawned });
    }
    const payload = terminalEvent.payload ?? {};
    const output = String(payload.output ?? payload.result ?? '');
    if (terminalEvent.kind === 'lifecycle.turn_completed' && payload.status === 'completed') {
      // Content-verified: the exact expected output within the bounded capture (≤2KiB).
      const captured = output.slice(0, PROBE_CAPTURE_MAX_BYTES).trim();
      if (captured === expectedLine) {
        return this._verify(route, credentialKey, started, probeId);
      }
      return this._fail(route, credentialKey, 'probe_content_mismatch', started, probeId, { blocking: pending.sawSpawned });
    }
    if (/invalid_grant|revok/iu.test(output)) {
      return this._fail(route, credentialKey, 'authentication_refresh_required', started, probeId, { blocking: true });
    }
    return this._fail(route, credentialKey, 'provider_unreachable', started, probeId, { blocking: pending.sawSpawned });
  }

  _verify(route, credentialKey, started, probeId) {
    const latencyMs = this.now() - started;
    const verifiedAt = this.now();
    const expiresAt = verifiedAt + this._windowFor(route);
    const liveness = Object.freeze({
      state: 'verified', verifiedAt, expiresAt, probeId, latencyMs, credentialKey,
    });
    this._cache.set(routeKey(route), liveness);
    this._mintProbeReceipts(probeId, route, 'readiness.probe_verified', {
      route: Object.freeze({ harness: route.harness, model: route.model, effort: route.effort }),
      probeId, latencyMs,
      observedAt: new Date(verifiedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      credentialKey,
      // Fold F-4: the probe's content check rides the shared verify.reverified-sourced evidence
      // path — never a bespoke probe-only verifier.
      verificationEvidence: this._mintVerificationEvidence(probeId, route),
    });
    return liveness;
  }

  _fail(route, credentialKey, code, started, probeId, { blocking = true } = {}) {
    const latencyMs = this.now() - started;
    const failedAt = this.now();
    if (!blocking) {
      // The probe could not run (no provider ever started — e.g. worktree/runtime unavailable or
      // an adapter without a probe contract). The tier is additive: record honest-unsupported so
      // the route is never blocked by a probe it cannot execute, and never re-probed per spawn.
      const liveness = Object.freeze({ state: 'unsupported', credentialKey });
      this._cache.set(routeKey(route), liveness);
      if (probeId) {
        this._mintProbeReceipts(probeId, route, 'readiness.probe_failed', {
          route: Object.freeze({ harness: route.harness, model: route.model, effort: route.effort }),
          probeId, latencyMs,
          observedAt: new Date(failedAt).toISOString(),
          code, credentialKey,
        });
      }
      return liveness;
    }
    const summary = this._summaryFor(route, code);
    const liveness = Object.freeze({
      state: 'failed', code, failedAt, latencyMs, credentialKey,
      ...(summary ? { summary } : {}),
    });
    this._cache.set(routeKey(route), liveness);
    if (code === 'authentication_refresh_required') {
      // §4.1.3 / fold F-1: an invalid_grant verdict invalidates EVERY liveness row sharing the
      // credentialKey in the same write — sibling routes never read stale verified.
      this.invalidateCredential(credentialKey, code);
    }
    if (probeId) {
      this._mintProbeReceipts(probeId, route, 'readiness.probe_failed', {
        route: Object.freeze({ harness: route.harness, model: route.model, effort: route.effort }),
        probeId, latencyMs,
        observedAt: new Date(failedAt).toISOString(),
        code, credentialKey,
      });
    }
    return liveness;
  }

  invalidateCredential(credentialKey, code) {
    const failedAt = this.now();
    const summary = this._summaryForCredential(credentialKey);
    for (const [key, row] of this._cache) {
      if (row.credentialKey !== credentialKey) continue;
      this._cache.set(key, Object.freeze({
        state: 'failed', code, failedAt, credentialKey,
        ...(summary ? { summary } : {}),
      }));
    }
  }

  _mintVerificationEvidence(probeId, route) {
    if (!this._log || !this._coordination) return null;
    try {
      const verifyEvent = this._log.append({
        worker: probeId,
        harness: `${route.harness}@1.0.0`,
        turnEpoch: 1,
        kind: 'verify.reverified',
        actor: 'policy',
        payload: { accept: true, probe: true },
      });
      const mapped = this._coordination.mapOperationalEvent(verifyEvent, {
        actor: 'policy',
        key: `evidence:${verifyEvent.worker}:${verifyEvent.seq}`,
      });
      return mapped?.evidence ? { coordinationSeq: mapped.evidence.coordinationSeq } : null;
    } catch { return null; }
  }

  _mintProbeReceipts(probeId, route, kind, payload) {
    if (!this._log) return;
    const harness = `${route.harness}@1.0.0`;
    try {
      this._log.append({
        worker: probeId, harness, turnEpoch: 1,
        kind: 'resource.provider_call', actor: 'policy',
        payload: { callId: probeId, phase: 'completed', provider: route.harness },
      });
    } catch { /* evidence is best-effort */ }
    try {
      this._log.append({ worker: probeId, harness, turnEpoch: 1, kind, actor: 'policy', payload });
    } catch { /* evidence is best-effort */ }
  }

  /** The public liveness tuple. The optional non-enumerable `probe` handle serves the wave-driver
   * preflight consumer; it never appears in the roster document or the JSON wire. */
  project(route, { withProbe = true } = {}) {
    const key = routeKey(route);
    const row = this._cache.get(key);
    const now = this.now();
    let projected;
    if (!row) {
      projected = { state: 'unverified', credentialKey: routeCredentialKey(route.harness) };
    } else if (row.state === 'verified' && row.expiresAt > now) {
      projected = { ...row };
    } else if (row.state === 'verified') {
      // The window lapsed: advisory shows the honest not-live state, never stale-verified.
      projected = { ...row, state: 'unverified' };
    } else if (row.state === 'unsupported') {
      // A route whose adapter cannot execute a probe is honest-unsupported: advisory shows the
      // not-verified window, never a fabricated failure (the tier is additive, never a block).
      projected = { state: 'unverified', credentialKey: row.credentialKey };
    } else {
      projected = { ...row };
    }
    const liveness = { ...projected };
    if (withProbe) {
      Object.defineProperty(liveness, 'probe', {
        value: async () => {
          try { await this.ensure(route); } catch { /* a failed gate projects the failed row */ }
          return this.project(route);
        },
        enumerable: false,
      });
    }
    return Object.freeze(liveness);
  }
}
