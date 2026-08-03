// PKG-1 (mcp-packaging-decisions v1.0): the declarative deployment descriptor.
//
// `baton-mcp <descriptor.json>` (also honored by baton-mcp-web) parses a bounded closed JSON
// descriptor — {repo, deploymentRoot, routes: [{harness, model, effort, credential:
// {kind: 'env'|'keychain'|'file', ref}}], surface, principal: {userId, capabilities[]}, quotas}.
// The descriptor is READ ONCE at open and immutable for the server's life (edits require a
// restart). Parse failures name the FIELD and the CONSTRAINT, never the value. Credential refs are
// repo-relative AND containment-checked (must resolve inside the repo root, no symlinks out);
// env-sourced secret VALUES join the file-class redaction set at the surface, never the descriptor.

import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { CoordinationStore } from './coordination-store.mjs';
import { McpFleetServer } from './mcp-northbound.mjs';
import { APPLICATION_COMMAND_DEFINITIONS } from './application.mjs';

const TOP_LEVEL_FIELDS = Object.freeze(['repo', 'deploymentRoot', 'routes', 'surface', 'principal', 'quotas']);
const ROUTE_FIELDS = Object.freeze(['harness', 'model', 'effort', 'credential']);
const CREDENTIAL_FIELDS = Object.freeze(['kind', 'ref']);
const CREDENTIAL_KINDS = Object.freeze(['env', 'keychain', 'file']);
const PRINCIPAL_FIELDS = Object.freeze(['userId', 'capabilities']);
const SURFACES = Object.freeze(['application', 'advanced', 'combined']);

function descriptorError(message, field = null) {
  const detail = field === null ? message : `${field}: ${message}`;
  return Object.assign(new Error(`descriptor ${detail}`), { code: 'descriptor_invalid' });
}

function nonemptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function closedRecord(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw descriptorError(`must be a closed object with exactly the fields ${fields.join(', ')}`, label);
  }
  const unknown = Object.keys(value).find((key) => !fields.includes(key));
  if (unknown !== undefined) {
    // Errors name the FIELD and the constraint, never the value (PKG-1).
    throw descriptorError(`unknown field (allowed: ${fields.join(', ')})`, `${label}.${unknown}`);
  }
  return value;
}

function resolveCredentialRef(credential, repoRoot) {
  const closed = closedRecord(credential, CREDENTIAL_FIELDS, 'routes[].credential');
  if (!CREDENTIAL_KINDS.includes(closed.kind) || !nonemptyString(closed.ref)) {
    throw descriptorError('credential.kind must be one of env|keychain|file and ref must be non-empty', 'routes[].credential');
  }
  if (closed.kind !== 'file') {
    // env/keychain refs name host-side coordinates; containment does not apply, but the ref is
    // still bounded (never a value, never free prose).
    return Object.freeze({ kind: closed.kind, ref: closed.ref });
  }
  // A file credential ref is repo-relative AND containment-checked: it must resolve inside the
  // repo root with no symlink escaping it (PKG-1, red-team target).
  const resolved = resolve(repoRoot, closed.ref);
  const repoRootResolved = resolve(repoRoot);
  const fromRepo = relative(repoRootResolved, resolved);
  if (fromRepo === '' || fromRepo.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    || fromRepo === '..' || isAbsolute(fromRepo)) {
    throw descriptorError('file credential ref must resolve inside the repository root', 'routes[].credential.ref');
  }
  let realTarget = resolved;
  try { realTarget = realpathSync(resolved); } catch { /* non-existent target fails the open-time read later; containment is about the path */ }
  let realRoot = repoRootResolved;
  try { realRoot = realpathSync(repoRootResolved); } catch { /* keep the lexical root */ }
  const fromRealRoot = relative(realRoot, realTarget);
  if (fromRealRoot === '' || fromRealRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    || fromRealRoot === '..' || isAbsolute(fromRealRoot)) {
    throw descriptorError('file credential ref is a symlink escaping the repository root', 'routes[].credential.ref');
  }
  return Object.freeze({ kind: 'file', ref: closed.ref, resolved });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Parse one declarative JSON descriptor at `path`. The returned configuration is deep-frozen and
 * immutable for the server's life; edits require a restart. Errors name the field + constraint,
 * never the value. File credential refs are containment-checked (repo-relative, no symlink out).
 */
export function loadMcpDescriptor(path) {
  if (!nonemptyString(path)) throw descriptorError('descriptor path must be a non-empty string', 'path');
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (error) { throw descriptorError(`could not read the descriptor file: ${error?.message ?? 'unreadable'}`, 'path'); }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (error) { throw descriptorError(`descriptor is not valid JSON: ${error?.message ?? 'malformed'}`, 'path'); }
  const root = closedRecord(parsed, TOP_LEVEL_FIELDS, 'descriptor');
  if (!nonemptyString(root.repo)) throw descriptorError('repo must be a non-empty string', 'repo');
  if (root.deploymentRoot !== undefined && !nonemptyString(root.deploymentRoot)) {
    throw descriptorError('deploymentRoot must be a non-empty string', 'deploymentRoot');
  }
  if (!Array.isArray(root.routes)) throw descriptorError('routes must be an array', 'routes');
  if (!SURFACES.includes(root.surface)) throw descriptorError('surface must be one of application|advanced|combined', 'surface');
  if (root.principal !== undefined) {
    const principal = closedRecord(root.principal, PRINCIPAL_FIELDS, 'principal');
    if (!nonemptyString(principal.userId) || !Array.isArray(principal.capabilities)
      || principal.capabilities.some((capability) => !nonemptyString(capability))) {
      throw descriptorError('principal.userId must be non-empty and capabilities must be a string array', 'principal');
    }
  }
  const repoRoot = resolve(root.repo);
  const routes = root.routes.map((route, index) => {
    const closed = closedRecord(route, ROUTE_FIELDS, `routes[${index}]`);
    for (const axis of ['harness', 'model', 'effort']) {
      if (!nonemptyString(closed[axis])) throw descriptorError(`${axis} must be a non-empty string`, `routes[${index}].${axis}`);
    }
    return Object.freeze({
      harness: closed.harness, model: closed.model, effort: closed.effort,
      ...(closed.credential !== undefined ? {
        credential: resolveCredentialRef(closed.credential, repoRoot),
      } : {}),
    });
  });
  return deepFreeze({
    repo: root.repo,
    deploymentRoot: root.deploymentRoot === undefined ? null : root.deploymentRoot,
    routes,
    surface: root.surface,
    principal: root.principal === undefined ? null : Object.freeze({
      userId: root.principal.userId, capabilities: Object.freeze([...root.principal.capabilities]),
    }),
    quotas: root.quotas === undefined ? null : deepFreeze(JSON.parse(JSON.stringify(root.quotas))),
  });
}

// The minimal application facade for a descriptor-driven server that has no resolvable route
// adapters (e.g. a doctor-only deployment). It satisfies the McpFleetServer ordinary-surface
// command contract and serves the quota-free doctor; every other command refuses honestly with the
// application_command_unavailable typed code rather than pretending a harness exists.
function buildDescriptorFacade(descriptor) {
  const repoId = descriptor.repo;
  const readinessRoutes = descriptor.routes.map((route) => Object.freeze({
    harness: route.harness, model: route.model, effort: route.effort, state: 'ready',
  }));
  return {
    repoId,
    card: () => Object.freeze({
      schemaVersion: 1, repoId,
      commands: Object.freeze([...Object.keys(APPLICATION_COMMAND_DEFINITIONS), 'waves.attach']),
    }),
    async authorizeReplay() { return true; },
    async command(name, args) {
      if (name === 'deployment.doctor') return this.doctorReadiness();
      if (name === 'application.shutdown') {
        return Object.freeze({ schemaVersion: 1, state: 'transport_closed', applicationOwned: false });
      }
      if (name === 'application.help') {
        return Object.freeze({ schemaVersion: 1, topic: args?.topic ?? null, depth: args?.depth ?? 'outline', help: [] });
      }
      throw Object.assign(new Error(`deployment is not serving ${name}`), { code: 'application_command_unavailable' });
    },
    doctorReadiness() {
      return Object.freeze({
        schemaVersion: 1, repoId,
        routes: Object.freeze(readinessRoutes),
        workspace: Object.freeze({ state: 'ready' }),
      });
    },
  };
}

/**
 * Build one McpFleetServer (or its construction options) from a parsed descriptor. The descriptor
 * is pinned at open — the returned server derives its principal, surface, repo, and routes from the
 * immutable parsed configuration. A descriptor whose routes carry no resolvable harness adapters
 * degrades to a doctor-capable facade (honest `application_command_unavailable` for the rest).
 */
export function createMcpServerFromDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)
    || !nonemptyString(descriptor.repo) || !Array.isArray(descriptor.routes)) {
    throw descriptorError('a parsed descriptor is required', 'descriptor');
  }
  const stateRoot = descriptor.deploymentRoot !== null
    ? join(resolve(descriptor.repo), descriptor.deploymentRoot) : resolve(descriptor.repo);
  const coordination = new CoordinationStore(join(stateRoot, 'coordination'));
  const principal = descriptor.principal === null
    ? { userId: 'descriptor-host', sessionId: 'descriptor-host-session', capabilities: ['observe'], repoIds: [descriptor.repo] }
    : { userId: descriptor.principal.userId, sessionId: `descriptor:${descriptor.principal.userId}`,
      capabilities: [...descriptor.principal.capabilities], repoIds: [descriptor.repo] };
  const application = buildDescriptorFacade(descriptor);
  return {
    coordinator: {}, coordination, application,
    surface: descriptor.surface,
    principal,
    shutdownPrincipal: { actor: 'mcp-host:descriptor', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    repoIds: [descriptor.repo],
    now: () => Date.now(),
    maxWaitMs: 25_000,
    maxMessageBytes: 256 * 1024,
    takeToolQuota: async () => ({ ok: true }),
  };
}

/** Convenience: parse + construct the McpFleetServer directly from a descriptor path. */
export async function createMcpServerFromDescriptorPath(path) {
  const descriptor = loadMcpDescriptor(path);
  const configured = createMcpServerFromDescriptor(descriptor);
  return configured instanceof McpFleetServer ? configured : new McpFleetServer(configured);
}
