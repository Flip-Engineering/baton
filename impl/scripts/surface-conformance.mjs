import { collectSurfaceInventory } from './surface-audit.mjs';
import {
  APPLICATION_SEMANTIC_REGISTRY,
  LEGACY_RUN_PHASE_MAP,
  canonicalRunPhase,
} from '../src/application-semantics.mjs';

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

export function deriveSurfaceNames(key) {
  const parts = key.split('.');
  if (parts.length < 2 || parts.some((part) => !/^[a-z][a-z0-9]*$/u.test(part))) {
    throw new TypeError(`invalid canonical operation key: ${key}`);
  }
  const verb = parts.at(-1);
  const nouns = parts.slice(0, -1);
  const embeddedNouns = nouns.map((noun, index) => {
    if (index === 0) return noun;
    if (noun === 'member') return 'member(role)';
    return noun;
  });
  return Object.freeze({
    cli: `baton ${parts.join(' ')}`,
    mcp: `baton_${parts.join('_')}`,
    web: parts.join('_'),
    embedded: `${embeddedNouns.join('.')}.${verb}()`,
  });
}

const OPERATION_ROWS = [
  ['deployment.view', 'ordinary', ['cli', 'embedded']],
  ['deployment.serve', 'host', ['cli']],
  ['deployment.shutdown', 'host', ['cli', 'embedded']],
  ['run.list'],
  ['run.start'],
  ['run.view'],
  ['run.watch'],
  ['run.do'],
  ['run.approve'],
  ['run.answer'],
  ['run.send'],
  ['run.interrupt'],
  ['run.stop'],
  ['run.evidence'],
  ['run.review'],
  ['run.adopt'],
  ['run.integrate'],
  ['run.export'],
  ['run.select'],
  ['run.feedback'],
  ['run.revise'],
  ['run.recover'],
  ['run.resume'],
  ['run.retry'],
  ['run.member.view'],
  ['run.member.send'],
  ['run.member.interrupt'],
  ['run.member.stop'],
  ['run.attention.list'],
  ['context.eval'],
  ['context.map'],
  ['context.reduce'],
  ['context.retry'],
  ['board.post'],
  ['board.retitle'],
  ['board.reorder'],
  ['board.close'],
  ['board.read'],
  ['board.claim', 'worker'],
  ['board.report', 'worker'],
  ['package.admit'],
  ['package.attach'],
  ['package.read'],
  ['application.help'],
];

export const CANONICAL_OPERATIONS = Object.freeze(OPERATION_ROWS.map((
  [key, profile = 'ordinary', surfaces = ['cli', 'mcp', 'web', 'embedded']],
) => Object.freeze({
  key,
  profile,
  surfaces: Object.freeze([...surfaces]),
  names: deriveSurfaceNames(key),
})));

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

export function checkLedgerMonotone(previous, current) {
  const prior = new Set(previous.entries.map(entryIdentity));
  const additions = current.entries.filter((entry) => !prior.has(entryIdentity(entry)));
  if (additions.length > 0) {
    const entry = additions.sort(compareRows)[0];
    throw new Error(`ledger append forbidden: ${entry.surface}:${entry.name}:${entry.dimension}`);
  }
  return [];
}
