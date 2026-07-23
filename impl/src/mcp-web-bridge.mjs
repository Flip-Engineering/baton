import { createHash } from 'node:crypto';

import { BatonWebClient, discoverBatonConnection } from './application-cli.mjs';
import { createLocalSocketFetch } from './local-web-transport.mjs';
import { McpFleetServer } from './mcp-northbound.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from './application-semantics.mjs';
import { hasNorthboundCapabilityAuthority } from './northbound-capability-authority.mjs';

// REFLEX-4 slice A (docs/32 §3.4, issue #19): application.context_eval is absent from
// ORDINARY_COMMANDS because it is not an APPLICATION_COMMAND_DEFINITIONS entry at all (see the
// note above that table in application.mjs) — there is no `application.command(...)` string
// dispatch for this Web bridge to forward. It is reachable only as a direct method call,
// `application.contextEval(...)`, today.
const ORDINARY_COMMANDS = Object.freeze([
  'application.help', 'run.start', 'run.inspect', 'run.act', 'run.stop',
]);
const MUTATIONS = new Set(['run.start', 'run.act', 'run.stop']);
const SAFE_RUN_ID = /^[A-Za-z0-9._:-]{1,256}$/u;

function bridgeError(message, code = 'application_unavailable') {
  return Object.assign(new Error(message), { code });
}

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function digest(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function contextRequestId(value) {
  if (!value || typeof value !== 'object') return null;
  const hasRequestId = Object.hasOwn(value, 'requestId');
  const hasLegacyCallId = Object.hasOwn(value, 'callId');
  if (hasRequestId === hasLegacyCallId) return null;
  return hasRequestId ? value.requestId : value.callId;
}
function validContext(value) {
  const requestId = contextRequestId(value);
  return value && value.transport === 'mcp' && typeof requestId === 'string'
    && requestId.length > 0 && typeof value.idempotencyKey === 'string'
    && value.idempotencyKey === `mcp.call:${requestId}`;
}
function validPrincipal(value, bound) {
  return value && SAFE_RUN_ID.test(value.principalId ?? '') && SAFE_RUN_ID.test(value.sessionId ?? '')
    && value.principalId === bound.userId && value.sessionId === bound.sessionId;
}
function validOutline(value, runId) {
  return value && value.schemaVersion === 1 && value.runId === runId && value.depth === 'outline'
    && value.outline && typeof value.outline === 'object' && !Array.isArray(value.outline)
    && typeof value.outline.phase === 'string' && Array.isArray(value.outline.actions);
}

/** Remote application facade: MCP transport lifetime never owns the resident Baton application. */
export class BatonWebApplicationFacade {
  constructor(client, applicationCard, session) {
    if (!client || typeof client.command !== 'function' || typeof client.doctor !== 'function'
      || typeof client.session !== 'function'
      || !applicationCard || typeof applicationCard !== 'object' || Array.isArray(applicationCard)
      || typeof applicationCard.repoId !== 'string' || applicationCard.repoId !== client.repoId
      || !Array.isArray(applicationCard.commands)
      || ORDINARY_COMMANDS.some((command) => !applicationCard.commands.includes(command))
      || !session?.identity || !SAFE_RUN_ID.test(session.identity.userId ?? '')
      || !SAFE_RUN_ID.test(session.identity.sessionId ?? '')
      || !Array.isArray(session.identity.capabilities) || !session.identity.capabilities.includes('observe')
      || !Array.isArray(session.identity.repoIds) || !session.identity.repoIds.includes(client.repoId)
      || !Number.isFinite(Date.parse(session.expiresAt))) {
      throw new TypeError('Baton Web application facade is invalid');
    }
    this.client = client;
    this.repoId = client.repoId;
    this._card = Object.freeze(clone(applicationCard));
    this._registryDigest = applicationCard.agentExperience?.registryDigest ?? null;
    this._session = Object.freeze(clone(session));
    this._sessionDigest = digest(this._session);
    this._principal = Object.freeze({
      userId: session.identity.userId,
      sessionId: session.identity.sessionId,
      capabilities: Object.freeze([...session.identity.capabilities]),
      repoIds: Object.freeze([client.repoId]),
      expiresAt: session.expiresAt,
      revoked: false,
    });
  }

  card() { return this._card; }

  principal() { return Object.freeze(clone(this._principal)); }

  async _attestSession(principal) {
    if (!validPrincipal(principal, this._principal)) {
      throw bridgeError('Remote Baton MCP principal is invalid', 'application_unauthorized');
    }
    const current = await this.client.session();
    if (digest(current) !== this._sessionDigest) {
      throw bridgeError('Remote Baton authenticated session authority changed', 'application_unauthorized');
    }
    return current;
  }

  _mutationKey(name, args, principal) {
    return `mcp-web-${digest({
      repoId: this.repoId,
      principalId: principal.principalId,
      sessionId: principal.sessionId,
      command: name,
      args,
    })}`;
  }

  async actionAuthority(args, principal) {
    await this._attestSession(principal);
    const idempotencyKey = this._mutationKey('run.act', args, principal);
    if (typeof this.client.actionAuthority === 'function') {
      return this.client.actionAuthority(args, idempotencyKey);
    }
    const outline = await this.client.command(
      'run.inspect', { runId: args.runId, depth: 'outline' },
      `mcp-web-${digest({ repoId: this.repoId, idempotencyKey, stage: 'authority-outline' })}`,
    );
    if (!validOutline(outline, args.runId)) {
      throw bridgeError('Remote Baton returned an invalid Run outline');
    }
    const action = outline.outline.actions.find((candidate) => candidate.actionId === args.actionId);
    if (!action || typeof action.kind !== 'string' || typeof action.effect !== 'string'
      || !Array.isArray(action.requiredCapabilities)) {
      throw bridgeError('Remote Baton action authority is unavailable',
        'application_action_scope_mismatch');
    }
    const payload = {
      schemaVersion: 1, actionId: action.actionId, kind: action.kind,
      effect: action.effect, requiredCapabilities: [...action.requiredCapabilities].sort(),
    };
    return Object.freeze({ ...payload, authorityDigest: digest(payload) });
  }

  async authorizeReplay(name, args, principal, context) {
    if (!ORDINARY_COMMANDS.includes(name) || !validContext(context)) {
      throw bridgeError('Remote Baton MCP replay authority is invalid', 'application_unauthorized');
    }
    await this._attestSession(principal);
    if (name === 'run.act') {
      const semantic = context.semanticAuthority;
      const definition = APPLICATION_SEMANTIC_REGISTRY.actions[semantic?.kind];
      const payload = semantic && {
        schemaVersion: semantic.schemaVersion,
        actionId: semantic.actionId,
        kind: semantic.kind,
        effect: semantic.effect,
        requiredCapabilities: semantic.requiredCapabilities,
      };
      if (!hasNorthboundCapabilityAuthority('mcp', context.capabilityAuthority)
        || semantic?.schemaVersion !== 1 || semantic.actionId !== args?.actionId
        || !definition || semantic.effect !== definition.effect
        || !Array.isArray(semantic.requiredCapabilities)
        || semantic.requiredCapabilities.join('\0') !== definition.requiredCapabilities.join('\0')
        || semantic.authorityDigest !== digest(payload)
        || !Array.isArray(context.capabilities)
        || new Set(context.capabilities).size !== context.capabilities.length
        || [...context.capabilities].sort().join('\0')
          !== [...this._principal.capabilities].sort().join('\0')
        || !semantic.requiredCapabilities.every(
          (capability) => context.capabilities.includes(capability),
        )) {
        throw bridgeError('Remote Baton MCP replay authority is invalid',
          'application_unauthorized');
      }
    }
    const doctor = await this.client.doctor();
    const card = doctor?.application;
    if (doctor?.ready !== true || card?.repoId !== this.repoId
      || !Array.isArray(card.commands) || !card.commands.includes(name)
      || (this._registryDigest !== null
        && card.agentExperience?.registryDigest !== this._registryDigest)) {
      throw bridgeError('Remote Baton application authority changed');
    }
    return true;
  }

  async _inspectOutline(runId, mutationKey, context) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const outlineKey = `mcp-web-${digest({
        repoId: this.repoId, mutationKey, requestId: contextRequestId(context),
        stage: 'result-outline', attempt,
      })}`;
      try {
        const outline = await this.client.command('run.inspect', { runId, depth: 'outline' }, outlineKey);
        if (!validOutline(outline, runId)) {
          throw bridgeError('Remote Baton returned an invalid Run outline');
        }
        return outline;
      } catch (cause) { lastError = cause; }
    }
    throw lastError;
  }

  async command(name, args, principal, context) {
    if (!ORDINARY_COMMANDS.includes(name) || name === 'application.shutdown' || !validContext(context)) {
      throw bridgeError('Remote Baton MCP command authority is invalid', 'application_unauthorized');
    }
    await this._attestSession(principal);
    const idempotencyKey = MUTATIONS.has(name)
      ? this._mutationKey(name, args, principal)
      : `mcp-web-${digest({ repoId: this.repoId, key: context.idempotencyKey })}`;
    const result = await this.client.command(name, args, idempotencyKey);
    if (!['run.start', 'run.stop'].includes(name)) return result;

    const requestedRunId = name === 'run.start' ? args.intent.runId ?? null : args.runId;
    const runId = result?.runId ?? requestedRunId;
    if (!SAFE_RUN_ID.test(runId ?? '') || (requestedRunId !== null && runId !== requestedRunId)) {
      throw bridgeError(`Remote Baton ${name} returned a mismatched Run identity`);
    }
    return this._inspectOutline(runId, idempotencyKey, context);
  }
}

export async function connectBatonWebApplication(options = {}) {
  const connection = options.connection ?? discoverBatonConnection({
    cwd: options.cwd, env: options.env, home: options.home, ownerUid: options.ownerUid,
  });
  // The ordinary `baton serve` resident publishes `transport: 'local'` over an owner-only Unix
  // socket; reach it exactly the way the CLI does instead of assuming a TCP-reachable URL.
  const fetchImpl = options.fetchImpl ?? (connection.transport === 'local'
    ? createLocalSocketFetch({
      socketPath: connection.socketPath,
      baseUrl: connection.baseUrl,
      ownerUid: options.ownerUid
        ?? (typeof process.getuid === 'function' ? process.getuid() : null),
    })
    : globalThis.fetch);
  if (typeof fetchImpl !== 'function') throw new TypeError('Baton Web MCP requires fetch');
  const client = new BatonWebClient({
    baseUrl: connection.baseUrl,
    origin: connection.origin,
    repoId: connection.repoId,
    token: connection.token,
    commandTimeoutMs: options.commandTimeoutMs ?? 120_000,
    pollMs: options.pollMs ?? 250,
    fetchImpl,
    clock: options.clock ?? options.now ?? Date.now,
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  });
  const doctor = await client.doctor();
  if (doctor?.ready !== true || doctor.application?.repoId !== connection.repoId) {
    throw bridgeError('Remote Baton application is not ready');
  }
  const session = await client.session();
  return new BatonWebApplicationFacade(client, doctor.application, session);
}

export async function createBatonWebMcpServer(options) {
  if (!options?.coordination) throw new TypeError('Baton Web MCP requires local call coordination');
  if (['principalId', 'sessionId', 'sessionTtlMs'].some((field) => Object.hasOwn(options, field))) {
    throw new TypeError('Baton Web MCP identity is remote-authenticated and cannot be overridden');
  }
  const application = await connectBatonWebApplication(options);
  const now = options.now ?? Date.now;
  const principal = application.principal();
  const windowMs = options.quotaWindowMs ?? 60_000;
  const maxCalls = options.maxCallsPerWindow ?? 512;
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0
    || !Number.isSafeInteger(maxCalls) || maxCalls <= 0) {
    throw new TypeError('Baton Web MCP quota is invalid');
  }
  let windowStartedAt = now();
  let calls = 0;
  const takeToolQuota = async () => {
    const current = now();
    if (current - windowStartedAt >= windowMs) {
      windowStartedAt = current;
      calls = 0;
    }
    calls += 1;
    return { ok: calls <= maxCalls };
  };
  return new McpFleetServer({
    coordinator: { list() { return []; } },
    coordination: options.coordination,
    application,
    applicationOwned: false,
    surface: 'application',
    bindApplicationContext: true,
    principal,
    repoIds: [application.repoId],
    now,
    maxWaitMs: options.maxWaitMs ?? 30_000,
    maxMessageBytes: options.maxMessageBytes ?? 256 * 1024,
    takeToolQuota,
  });
}

export function kimiBatonMcpEntry({ projectRoot, nodePath, bridgePath }) {
  if (![projectRoot, nodePath, bridgePath].every((value) => typeof value === 'string' && value.length > 0)) {
    throw new TypeError('Kimi Baton MCP entry paths are invalid');
  }
  return Object.freeze({
    command: nodePath,
    args: [bridgePath],
    cwd: projectRoot,
    enabled: true,
    startupTimeoutMs: 30_000,
    toolTimeoutMs: 180_000,
    enabledTools: ['baton_help', 'baton_run_start', 'baton_run_inspect', 'baton_run_episode',
      'baton_run_workstreams', 'baton_workstream_notify', 'baton_workstream_stop',
      'baton_run_act', 'baton_run_stop'],
  });
}

/**
 * ACP session/new uses the protocol's stdio descriptor, which is intentionally distinct from
 * Kimi Code's project mcp.json shape above. The bridge discovers its private Baton connection
 * after launch; no bearer token or connection environment is serialized into the ACP request.
 */
export function kimiBatonAcpMcpServer({ projectRoot, nodePath, bridgePath }) {
  if (![projectRoot, nodePath, bridgePath].every((value) => typeof value === 'string' && value.length > 0)) {
    throw new TypeError('Kimi Baton ACP MCP server paths are invalid');
  }
  return Object.freeze({
    name: 'baton',
    command: nodePath,
    args: Object.freeze([bridgePath]),
    env: Object.freeze([]),
  });
}
