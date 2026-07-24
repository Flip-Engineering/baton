import { collectSurfaceInventory } from './surface-audit.mjs';
import {
  APPLICATION_SEMANTIC_REGISTRY,
  LEGACY_RUN_PHASE_MAP,
  canonicalRunPhase,
  deriveSurfaceNames,
} from '../src/application-semantics.mjs';

// docs/36 §6.1 / M4A-2 — `deriveSurfaceNames` is imported, not redefined: the registry, the audit,
// and this harness compute every surface name through the ONE function, so they cannot drift.
export { deriveSurfaceNames };

const DIMENSIONS = new Set(['name', 'args', 'schema', 'behavior', 'enum']);
const RETIREMENT_PHASES = new Set(['M1', 'M2', 'M3', 'M4', 'M5']);
const SURFACES = new Set([
  'registry.operations',
  'registry.actions',
  'application.commands',
  'web',
  'cli',
  'mcp.fleet',
  'mcp.baton',
  'embedded',
  'mcp.web-bridge',
  'enum.runPhase',
  'application',
  'mcp',
]);

// docs/36 §6 explicit exclusions / §8.3 profiles (R-OP-2, R-OP-10) — the kernel and authoring
// command literals are NOT canonical grammar operations: they are profile-scoped surfaces the
// grammar covers but does not unify (fleet_* kernel tools, goal/plan authoring). They stay literal
// through M4b ("kernel/goal-plan literal halves unchanged"). The harness recognizes them as
// legitimate profile literals — conformant under their profile, never a novel divergence — on both
// the Web bus (bare literal) and the MCP kernel dialect (`fleet_`-prefixed). C9 asserts the derived
// grammar names stay disjoint from these.
export const KERNEL_PROFILE_LITERALS = Object.freeze([
  'spawn', 'scratch_oracle', 'send', 'interrupt', 'kill', 'drain', 'respond',
  'list', 'result', 'wait', 'capabilities', 'provider_status',
  'capability_invoke', 'reuse_decide', 'reuse_recheck',
]);
export const AUTHORING_PROFILE_LITERALS = Object.freeze([
  'goal_define', 'plan_propose', 'plan_approve', 'goal_plan_status',
]);

export const CANONICAL_ENUMS = Object.freeze({
  runPhases: Object.freeze([
    'planning', 'awaiting_approval', 'queued', 'working', 'paused', 'interrupted',
    'uncertain', 'verifying', 'result_ready', 'awaiting_selection', 'result_selected',
    'reviewing', 'integrating', 'completed', 'failed', 'cancelled', 'stopped', 'denied',
    'stopping',
  ]),
  memberStates: Object.freeze([
    'pending', 'idle', 'working', 'blocked', 'paused', 'interrupted', 'stopping',
    'completed', 'failed', 'cancelled', 'stopped',
  ]),
  attentionKinds: Object.freeze([
    'approve_plan', 'select_candidate', 'answer_question', 'answer_approval',
    'answer_decision', 'turn_checkpoint', 'session_preservation', 'workflow_revision',
    'workflow_recovery',
  ]),
});

// docs/36 §6/§8.1 — the canonical operation set is the registry v2's `canonicalOperations`, not a
// second hand table: this harness projects the same entries the CLI, embedded, and MCP renderers
// consume, so a §6 addition or a name derivation lands in exactly one place (M4A-1/M4A-2).
export const CANONICAL_OPERATIONS = Object.freeze(
  APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.map((operation) => Object.freeze({
    key: operation.key,
    profile: operation.profile,
    surfaces: Object.freeze([...operation.surfaces]),
    names: deriveSurfaceNames(operation.key),
  })),
);

function observation(surface, name, dimension = 'name') {
  return Object.freeze({ surface, name, dimension });
}

function inventoryObservations(inventory) {
  return [
    ...inventory.registryOperations.map((name) => observation('registry.operations', name)),
    ...inventory.registryActions.map((name) => observation('registry.actions', name)),
    ...inventory.commandDefinitions.map((name) => observation('application.commands', name)),
    ...inventory.webCommands.map((name) => observation('web', name)),
    ...inventory.cliCommands.map(({ id }) => observation('cli', `baton ${id.replaceAll('.', ' ')}`)),
    ...inventory.mcpFleetTools.map((name) => observation('mcp.fleet', name)),
    ...inventory.mcpBatonTools.map((name) => observation('mcp.baton', name)),
    ...inventory.embeddedMethods.map((name) => observation('embedded', name)),
    ...inventory.mcpWebBridgeCommands.map((name) => observation('mcp.web-bridge', name)),
    ...inventory.behaviorDivergences.map(({ surface, name }) => observation(surface, name, 'behavior')),
  ].sort(compareRows);
}

function canonicalNameIndex() {
  const index = new Map();
  for (const operation of CANONICAL_OPERATIONS) {
    index.set(`registry.operations\0${operation.key}`, operation.key);
    index.set(`application.commands\0${operation.key}`, operation.key);
    index.set(`mcp.web-bridge\0${operation.key}`, operation.key);
    for (const surface of operation.surfaces) {
      index.set(`${surface}\0${operation.names[surface]}`, operation.key);
      if (surface === 'mcp') index.set(`mcp.baton\0${operation.names.mcp}`, operation.key);
    }
  }
  for (const [name, definition] of Object.entries(APPLICATION_SEMANTIC_REGISTRY.operations)) {
    if (definition.canonicalName) {
      index.set(`registry.operations\0${name}`, definition.canonicalName);
    }
  }
  // docs/36 §8.1 / M4a §5 — the registry now OWNS the cli / embedded / application.commands legacy
  // spellings as first-class aliases. Resolving them here is what retires their M0 ledger rows:
  // the divergence is no longer an unledgered fact, it is derivable registry data.
  for (const alias of APPLICATION_SEMANTIC_REGISTRY.surfaceAliases) {
    index.set(`${alias.surface}\0${alias.name}`, alias.canonical);
  }
  // docs/36 §6/§8.3 — the profile literals resolve to their profile, not to a canonical grammar
  // key: they are legitimate kernel/authoring surface names, admitted on the Web bus bare and on
  // the MCP kernel dialect `fleet_`-prefixed. Recognizing them here is what lets their M0 ledger
  // rows retire at M4b without inventing a canonical operation the §6 set does not have.
  for (const [literals, profile] of [[KERNEL_PROFILE_LITERALS, 'kernel'], [AUTHORING_PROFILE_LITERALS, 'authoring']]) {
    for (const literal of literals) {
      index.set(`web\0${literal}`, profile);
      index.set(`mcp.fleet\0fleet_${literal}`, profile);
    }
  }
  for (const [name, definition] of Object.entries(APPLICATION_SEMANTIC_REGISTRY.actions)) {
    if (definition.operation) {
      index.set(`registry.actions\0${name}`, definition.operation);
    }
  }
  return index;
}

function entryIdentity({ surface, name, dimension, canonical, retiresIn }) {
  return `${surface}\0${name}\0${dimension}\0${canonical ?? ''}\0${retiresIn}`;
}

function ledgerIndex(ledger) {
  return new Map(ledger.entries.map((entry) => (
    [`${entry.surface}\0${entry.name}\0${entry.dimension}`, entry]
  )));
}

export function classifySurfaces(
  inventory,
  ledger,
  { refuseNovel = false } = {},
) {
  const canonical = canonicalNameIndex();
  const allowed = ledgerIndex(ledger);
  const result = { conformant: [], ledgered: [], novel: [] };
  for (const item of inventoryObservations(inventory)) {
    const canonicalKey = canonical.get(`${item.surface}\0${item.name}`);
    if (item.dimension === 'name' && canonicalKey) {
      result.conformant.push({ ...item, canonical: canonicalKey });
      continue;
    }
    const entry = allowed.get(`${item.surface}\0${item.name}\0${item.dimension}`);
    if (entry) result.ledgered.push({ ...item, canonical: entry.canonical });
    else result.novel.push(item);
  }
  if (refuseNovel && result.novel.length > 0) {
    const first = result.novel[0];
    throw new Error(`novel surface divergence: ${first.surface}:${first.name}:${first.dimension}`);
  }
  return Object.freeze({
    conformant: Object.freeze(result.conformant),
    ledgered: Object.freeze(result.ledgered),
    novel: Object.freeze(result.novel),
  });
}

export function checkEnumStrings(strings, ledger, { refuseNovel = false } = {}) {
  const canonical = new Set(CANONICAL_ENUMS.runPhases);
  const allowed = ledgerIndex(ledger);
  const result = { conformant: [], ledgered: [], novel: [] };
  for (const name of [...new Set(strings)].sort()) {
    // docs/36 §7.1/L4: resolve each extracted literal through the registry's generated legacy
    // mapping, then enforce canonical over the resolved string. A dead string (`closed` → null)
    // is dropped — it names no live axis value. A known legacy string resolves to its canonical
    // phase (conformant). Anything else is measured against the ledger, then flagged novel.
    const resolved = Object.hasOwn(LEGACY_RUN_PHASE_MAP, name) ? canonicalRunPhase(name) : name;
    if (resolved === null || resolved === undefined) continue;
    if (canonical.has(resolved)) {
      result.conformant.push({ surface: 'enum.runPhase', name, dimension: 'enum', canonical: resolved });
      continue;
    }
    const entry = allowed.get(`enum.runPhase\0${name}\0enum`);
    if (entry) result.ledgered.push(entry);
    else result.novel.push({ surface: 'enum.runPhase', name, dimension: 'enum' });
  }
  if (refuseNovel && result.novel.length > 0) {
    throw new Error(`novel enum divergence: ${result.novel[0].name}`);
  }
  return result;
}

function compareRows(left, right) {
  return left.surface.localeCompare(right.surface)
    || left.name.localeCompare(right.name)
    || left.dimension.localeCompare(right.dimension);
}

export function canonicalizeLedger(ledger) {
  return {
    schemaVersion: 1,
    entries: [...ledger.entries].map((entry) => ({
      surface: entry.surface,
      name: entry.name,
      canonical: entry.canonical,
      dimension: entry.dimension,
      retiresIn: entry.retiresIn,
    })).sort(compareRows),
  };
}

export function validateLedger(ledger, inventory = collectSurfaceInventory()) {
  const findings = [];
  if (ledger?.schemaVersion !== 1 || !Array.isArray(ledger?.entries)) {
    return ['ledger must have schemaVersion 1 and an entries array'];
  }
  const observed = new Set([
    ...inventoryObservations(inventory).map(({ surface, name, dimension }) => (
      `${surface}\0${name}\0${dimension}`
    )),
    ...inventory.phaseLiterals.map((name) => `enum.runPhase\0${name}\0enum`),
  ]);
  const enumTargets = new Set(Object.values(CANONICAL_ENUMS).flat());
  const operationKeys = new Set(CANONICAL_OPERATIONS.map(({ key }) => key));
  const seen = new Set();
  for (const entry of ledger.entries) {
    const key = `${entry.surface}\0${entry.name}\0${entry.dimension}`;
    if (!SURFACES.has(entry.surface)) findings.push(`unknown surface: ${entry.surface}`);
    if (typeof entry.name !== 'string' || entry.name.length === 0) findings.push(`invalid name on ${key}`);
    if (!DIMENSIONS.has(entry.dimension)) findings.push(`invalid dimension on ${key}`);
    if (!RETIREMENT_PHASES.has(entry.retiresIn)) findings.push(`invalid retirement phase on ${key}`);
    if (entry.canonical !== null) {
      const targets = entry.dimension === 'enum' ? enumTargets : operationKeys;
      if (!targets.has(entry.canonical)) findings.push(`invalid canonical target on ${key}`);
    }
    if (seen.has(key)) findings.push(`duplicate ledger row: ${key}`);
    seen.add(key);
    if (!observed.has(key)) findings.push(`dead ledger row: ${key}`);
  }
  return findings.sort();
}

// docs/36 §6.1 / §10 C9 (R-OP-10) — the kernel (fleet/reflex) and authoring (goal/plan) command
// literals hand-written in web-northbound.mjs:18-21. The derived grammar web-transport names must
// be disjoint from these; the disjointness is *asserted* from registry data here, never assumed,
// and this contract does not touch web-northbound (its transport flip is M4b).
export const KERNEL_AUTHORING_WEB_LITERALS = Object.freeze([
  ...KERNEL_PROFILE_LITERALS, ...AUTHORING_PROFILE_LITERALS,
]);

export function checkWebNameDisjoint(registry = APPLICATION_SEMANTIC_REGISTRY) {
  const literals = new Set(KERNEL_AUTHORING_WEB_LITERALS);
  const collisions = [];
  for (const operation of registry.canonicalOperations) {
    if (!operation.surfaces.includes('web')) continue;
    const { web } = deriveSurfaceNames(operation.key);
    if (literals.has(web)) collisions.push({ key: operation.key, web });
  }
  return collisions.sort((left, right) => left.web.localeCompare(right.web));
}

// docs/36 §4.2 H10 / §10 C8 — the canonical serialization pin (cut at M4b). `canonicalizeSerialization`
// is the serialization-layer normalization: it re-emits an object with the registry-pinned keys
// leading in their pinned order, every other key following in its original relative order. Parsers
// stay order-insensitive and digest/replay identities are untouched — this is presentation only.
// `serializationOrderViolations` is the conformance checker: it returns the mismatch when an
// emitter presents the pinned keys out of their canonical sequence (a scrambled emitter is caught).
export function canonicalizeSerialization(order, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const keys = Object.keys(value);
  const leading = order.filter((key) => Object.hasOwn(value, key));
  const trailing = keys.filter((key) => !order.includes(key));
  return Object.fromEntries([...leading, ...trailing].map((key) => [key, value[key]]));
}

export function serializationOrderViolations(order, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const present = Object.keys(value).filter((key) => order.includes(key));
  const expected = order.filter((key) => Object.hasOwn(value, key));
  if (present.length === expected.length && present.every((key, index) => key === expected[index])) {
    return [];
  }
  return [Object.freeze({ expected: Object.freeze(expected), actual: Object.freeze(present) })];
}

export function checkLedgerMonotone(previous, current) {
  const prior = new Set(previous.entries.map(entryIdentity));
  const additions = current.entries.filter((entry) => !prior.has(entryIdentity(entry)));
  if (additions.length > 0) {
    const entry = additions.sort(compareRows)[0];
    throw new Error(`ledger append forbidden: ${entry.surface}:${entry.name}:${entry.dimension}`);
  }
  return [];
}
