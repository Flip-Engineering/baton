import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { collectSurfaceInventory } from './surface-audit.mjs';
import {
  checkSurfaceDocs,
  renderCliVerbInventory,
  renderMcpToolInventory,
  servedCliOrdinaryKeys,
} from './render-surface-docs.mjs';
import { pathToFileURL } from 'node:url';
import {
  APPLICATION_SEMANTIC_REGISTRY,
  LEGACY_RUN_PHASE_MAP,
  canonicalRunPhase,
  deriveSurfaceNames,
} from '../src/application-semantics.mjs';
import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import { CLI_WEB_COMMANDS, parseBatonCli } from '../src/application-cli.mjs';
import {
  mcpApplicationToolNames,
  mcpAdvancedToolNames,
  mcpCombinedToolNames,
  mcpDispatchToolNames,
} from '../src/mcp-northbound.mjs';

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

// docs/36 §4.1 / §10 C4 (R-CX-13) — the banned surface verbs. The lint is generated from the §4.1
// banned set with token normalization: `stop_member` and `stop-member` are ONE token (separators
// collapse), so no canonical operation may carry a legacy synonym verb in any surface name it
// derives. C4 is promoted to red at M5 — the canonical suite fails on any banned token.
export const BANNED_SURFACE_VERBS = Object.freeze([
  'show', 'status', 'inspect', 'act', 'notify', 'follow', 'wait', 'progress',
  'events', 'output', 'episode', 'stop-member', 'steer',
]);
const BANNED_TOKEN_SEQUENCES = Object.freeze(
  BANNED_SURFACE_VERBS.map((verb) => Object.freeze(
    verb.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean),
  )),
);
function surfaceNameTokens(name) {
  return name.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
}

export function checkBannedTokens(names) {
  const violations = [];
  for (const name of names) {
    const tokens = surfaceNameTokens(name);
    for (const sequence of BANNED_TOKEN_SEQUENCES) {
      let hit = false;
      if (sequence.length === 1) {
        hit = tokens.includes(sequence[0]);
      } else {
        for (let index = 0; index + sequence.length <= tokens.length; index += 1) {
          if (sequence.every((token, offset) => tokens[index + offset] === token)) { hit = true; break; }
        }
      }
      if (hit) {
        violations.push(Object.freeze({ name, verb: sequence.join('-') }));
        break;
      }
    }
  }
  return violations;
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


// ── CS-1: normative reference-profile matrix + executable inventories ────────

export const REFERENCE_PROFILES = Object.freeze([
  Object.freeze({ id: 'cli.ordinary', surface: 'cli', label: 'ordinary CLI principal' }),
  Object.freeze({ id: 'cli.host_local', surface: 'cli', label: 'host-local CLI' }),
  Object.freeze({ id: 'mcp.application', surface: 'mcp', label: 'MCP application profile' }),
  Object.freeze({ id: 'mcp.advanced', surface: 'mcp', label: 'MCP advanced profile' }),
  Object.freeze({ id: 'mcp.combined', surface: 'mcp', label: 'MCP combined profile' }),
  Object.freeze({ id: 'web.bus', surface: 'web', label: 'web bus principal' }),
]);

// Host-local CLI verbs: parse succeeds, no web-client whitelist entry (CS-2/CS-3).
const HOST_LOCAL_CLI_KEYS = Object.freeze(['run.debug']);

function cliOrdinaryKeys() {
  return servedCliOrdinaryKeys();
}

function webBusNames() {
  return Object.entries(APPLICATION_COMMAND_DEFINITIONS)
    .filter(([, definition]) => definition.web)
    .map(([name]) => name.replaceAll('.', '_'))
    .sort();
}

export function instantiateProfileInventory(profile) {
  const id = typeof profile === 'string' ? profile : profile.id;
  switch (id) {
    case 'cli.ordinary':
      return Object.freeze({
        profile: id,
        kind: 'operation-keys',
        names: Object.freeze(cliOrdinaryKeys()),
      });
    case 'cli.host_local':
      return Object.freeze({
        profile: id,
        kind: 'operation-keys',
        names: Object.freeze([...HOST_LOCAL_CLI_KEYS].sort()),
      });
    case 'mcp.application':
      return Object.freeze({
        profile: id,
        kind: 'tool-names',
        names: Object.freeze(mcpApplicationToolNames()),
      });
    case 'mcp.advanced':
      return Object.freeze({
        profile: id,
        kind: 'tool-names',
        names: Object.freeze(mcpAdvancedToolNames()),
      });
    case 'mcp.combined':
      return Object.freeze({
        profile: id,
        kind: 'tool-names',
        names: Object.freeze(mcpCombinedToolNames()),
      });
    case 'web.bus':
      return Object.freeze({
        profile: id,
        kind: 'web-names',
        names: Object.freeze(webBusNames()),
      });
    default:
      throw new Error(`unknown reference profile: ${id}`);
  }
}

function extractGeneratedBlock(text, marker) {
  const begin = `<!-- BEGIN GENERATED: ${marker} (impl/scripts/render-surface-docs.mjs) -->`;
  const end = `<!-- END GENERATED: ${marker} -->`;
  const start = text.indexOf(begin);
  const stop = text.indexOf(end);
  if (start < 0 || stop < 0 || stop < start) return '';
  return text.slice(start + begin.length, stop).trim();
}

function namesFromCliInventoryBlock(block) {
  const names = [];
  for (const line of block.split('\n')) {
    const match = /^\| `([^`]+)` \|/u.exec(line.trim());
    if (match && match[1] !== 'Operation') names.push(match[1]);
  }
  return names;
}

function namesFromMcpInventoryBlock(block) {
  // Prefer the MCP tool column (3rd) for tool-name inventories; fall back to operation key.
  const names = [];
  for (const line of block.split('\n')) {
    const match = /^\| `([^`]+)` \| `([^`]+)` \| `([^`]+)` \|/u.exec(line.trim());
    if (match && match[1] !== 'Operation') names.push(match[3]);
  }
  return names;
}

export function profileDocSection(profile, docs = {}) {
  const id = typeof profile === 'string' ? profile : profile.id;
  const cliPath = docs.cliPath ?? new URL('../CLI.md', import.meta.url);
  const mcpPath = docs.mcpPath ?? new URL('../MCP.md', import.meta.url);
  if (id === 'cli.ordinary' || id === 'cli.host_local') {
    // Live section is the renderer output (committed file checked separately).
    const block = id === 'cli.ordinary'
      ? renderCliVerbInventory()
      : renderCliVerbInventory(); // host-local rows are a subset of the CLI inventory
    if (id === 'cli.host_local') {
      // Section for host-local is the CLI rows whose keys are host-local.
      const lines = ['| Operation | Profile | CLI verb | Example |', '|---|---|---|---|'];
      for (const key of HOST_LOCAL_CLI_KEYS) {
        const operation = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
          .find((entry) => entry.key === key);
        if (!operation) continue;
        lines.push(`| \`${operation.key}\` | \`${operation.profile}\` | \`${operation.names.cli}\` | \`${operation.example}\` |`);
      }
      return lines.join('\n');
    }
    return block;
  }
  if (id === 'mcp.application') {
    return renderMcpToolInventory();
  }
  if (id === 'mcp.advanced' || id === 'mcp.combined') {
    // These profiles are not rendered into CLI.md/MCP.md generated regions; their
    // "doc section" is the executable inventory itself (introspection-only surfaces).
    const inventory = instantiateProfileInventory(id);
    return inventory.names.map((name) => `- \`${name}\``).join('\n');
  }
  if (id === 'web.bus') {
    const inventory = instantiateProfileInventory(id);
    return inventory.names.map((name) => `- \`${name}\``).join('\n');
  }
  throw new Error(`unknown reference profile: ${id}`);
}

export function checkProfileDocParity(profile, inventory, section) {
  const id = typeof profile === 'string' ? profile : profile.id;
  let documented;
  if (id === 'cli.ordinary') {
    documented = namesFromCliInventoryBlock(section);
  } else if (id === 'cli.host_local') {
    documented = namesFromCliInventoryBlock(section);
  } else if (id === 'mcp.application') {
    // MCP application generated block lists operation keys mapped to tools; compare tool names
    // extracted from the tool column when present, else the full served tool list vs section.
    documented = namesFromMcpInventoryBlock(section);
    // Renderer may list operation-derived tools; served inventory is the real tool table.
    // Parity: every served tool is either in the doc tool column OR the doc is the tool list.
    if (documented.length === 0) {
      documented = section.split('\n')
        .map((line) => {
          const match = /`((?:fleet|baton)_[a-z0-9_]+)`/u.exec(line);
          return match?.[1];
        })
        .filter(Boolean);
    }
  } else {
    documented = section.split('\n')
      .map((line) => {
        const match = /`([^`]+)`/u.exec(line);
        return match?.[1];
      })
      .filter(Boolean);
  }
  const served = new Set(inventory.names);
  const docSet = new Set(documented);
  // For mcp.application the generated table is operation→derived tool; the served inventory
  // is the real ORDINARY tool table. Compare carefully:
  if (id === 'mcp.application') {
    // Positive/negative over the RENDERED tool names vs served tools that the renderer claims.
    // The renderer lists deriveSurfaceNames tools for mcp-surface ops; real surface may differ.
    // CS-1 requires they match — renderMcpToolInventory must emit the real application tools.
    const missingFromDoc = inventory.names.filter((name) => !docSet.has(name)).sort();
    const missingFromServe = documented.filter((name) => !served.has(name)).sort();
    return { missingFromDoc, missingFromServe };
  }
  if (id === 'cli.ordinary' || id === 'cli.host_local') {
    const missingFromDoc = inventory.names.filter((name) => !docSet.has(name)).sort();
    const missingFromServe = documented.filter((name) => !served.has(name)).sort();
    return { missingFromDoc, missingFromServe };
  }
  // Introspection-only profiles: section is rendered from the inventory itself.
  const missingFromDoc = inventory.names.filter((name) => !docSet.has(name)).sort();
  const missingFromServe = documented.filter((name) => !served.has(name)).sort();
  return { missingFromDoc, missingFromServe };
}

// ── CS-1: prose-inventory lint ──────────────────────────────────────────────

const PROSE_INVENTORY_PATTERNS = [
  /\b(?:exactly|precisely)\s+\d+\s+tools?\b/iu,
  /\b(?:eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|twenty-one)\s+(?:tools?|`(?:fleet_|baton_))/iu,
  /\bthe\s+(?:default\s+)?application-backed inventory\b/iu,
  // Comma-separated tool name lists (lowercase baton_*/fleet_* tools), not env vars.
  /(?:^|\n)[^\n]*`baton_[a-z][a-z0-9_]*`\s*,\s*`baton_[a-z][a-z0-9_]*`/u,
  /(?:^|\n)[^\n]*`fleet_[a-z][a-z0-9_]*`\s*,\s*`fleet_[a-z][a-z0-9_]*`/u,
  /(?:^|\n)-\s+\*\*[^*]+\*\*:\s*`baton [a-z]/u,
];

function stripGeneratedRegions(text) {
  return text.replace(
    /<!-- BEGIN GENERATED:[\s\S]*?<!-- END GENERATED:[^>]*-->/gu,
    '\n',
  );
}

export function lintProseInventories(options = {}) {
  const files = options.files ?? [
    { path: new URL('../CLI.md', import.meta.url), label: 'CLI.md' },
    { path: new URL('../MCP.md', import.meta.url), label: 'MCP.md' },
  ];
  const findings = [];
  for (const file of files) {
    const raw = typeof file.path === 'string'
      ? readFileSync(file.path, 'utf8')
      : readFileSync(file.path, 'utf8');
    const prose = stripGeneratedRegions(raw);
    for (const pattern of PROSE_INVENTORY_PATTERNS) {
      if (pattern.test(prose)) {
        findings.push(
          `${file.label}: inventory-like prose (name-list/tool count) outside generated regions`,
        );
        break;
      }
    }
  }
  return findings;
}

// Re-export doc check under the conformance module (CS-1 harness reuse).
export { checkSurfaceDocs };

// ── CS-4: checked inventory artifact ────────────────────────────────────────

const INVENTORY_ARTIFACT_URL = new URL('./surface-inventory-artifact.json', import.meta.url);

export function buildSurfaceInventoryArtifact() {
  // Deterministic: parser lifecycle, web whitelist, MCP profiles, registry counts.
  // Never regex extraction alone — parser probe + instantiated MCP tool tables + registry.
  const lifecycleProbe = [
    'show', 'do', 'recover', 'status', 'approve', 'answer', 'send', 'interrupt',
    'progress', 'events', 'output', 'episode', 'workstreams', 'notify', 'result', 'stop',
    'evidence', 'adopt', 'select', 'feedback', 'revise', 'stop-member', 'retry', 'resume',
    'review', 'integrate', 'export', 'debug',
  ];
  let parsedResume = null;
  try {
    parsedResume = parseBatonCli([
      'run', 'resume', 'run-artifact', '--reason', 'probe', '--idempotency-key', 'artifact-resume',
    ]);
  } catch {
    parsedResume = { error: true };
  }
  let contextEval = null;
  try {
    parseBatonCli(['context', 'eval', '--run', 'run-a', '--json', '{}']);
    contextEval = { refused: false };
  } catch (error) {
    contextEval = { refused: true, code: error?.code ?? null };
  }
  const artifact = {
    schemaVersion: 1,
    generatedBy: 'impl/scripts/surface-conformance.mjs#buildSurfaceInventoryArtifact',
    counts: {
      canonicalOperations: APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.length,
      cliWebCommands: CLI_WEB_COMMANDS.size,
      parserLifecycleActions: lifecycleProbe.length,
      mcpApplicationTools: mcpApplicationToolNames().length,
      mcpAdvancedTools: mcpAdvancedToolNames().length,
      mcpCombinedTools: mcpCombinedToolNames().length,
      mcpDispatchTools: mcpDispatchToolNames().length,
      webBusCommands: webBusNames().length,
      applicationCommandDefinitions: Object.keys(APPLICATION_COMMAND_DEFINITIONS).length,
    },
    profiles: Object.fromEntries(
      REFERENCE_PROFILES.map((profile) => [
        profile.id,
        instantiateProfileInventory(profile).names,
      ]),
    ),
    pins: {
      runResumeDispatch: parsedResume?.name ?? null,
      contextEvalParseRefusal: contextEval,
      runDebugRegistered: APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
        .some((entry) => entry.key === 'run.debug'),
      batonRunsAdvertised: mcpApplicationToolNames().includes('baton_runs'),
    },
  };
  return artifact;
}

export function checkSurfaceInventoryArtifact() {
  const built = buildSurfaceInventoryArtifact();
  let committed;
  try {
    committed = JSON.parse(readFileSync(INVENTORY_ARTIFACT_URL, 'utf8'));
  } catch (error) {
    return [`inventory artifact missing or unreadable: ${error.message}`];
  }
  const left = `${JSON.stringify(built, null, 2)}\n`;
  const right = `${JSON.stringify(committed, null, 2)}\n`;
  if (left !== right && JSON.stringify(built) !== JSON.stringify(committed)) {
    // Accept either pretty-printed form as long as values match.
    if (JSON.stringify(built) !== JSON.stringify(committed)) {
      return ['inventory artifact is stale; regenerate via node impl/scripts/surface-conformance.mjs --write-inventory'];
    }
  }
  // Byte-stable across two builds
  if (JSON.stringify(buildSurfaceInventoryArtifact()) !== JSON.stringify(built)) {
    return ['inventory artifact builder is non-deterministic'];
  }
  return [];
}

export function writeSurfaceInventoryArtifact() {
  const artifact = buildSurfaceInventoryArtifact();
  writeFileSync(INVENTORY_ARTIFACT_URL, `${JSON.stringify(artifact, null, 2)}\n`);
  return artifact;
}

// ── Executable main (CS-1 / R-CS-6) ─────────────────────────────────────────

export function runSurfaceConformanceMain({ writeInventory = false } = {}) {
  const findings = [];
  const ledgerUrl = new URL('./surface-divergence-ledger.json', import.meta.url);
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(ledgerUrl, 'utf8'));
  } catch (error) {
    findings.push(`invalid ledger: could not read: ${error.message}`);
    return findings;
  }
  const ledgerFindings = validateLedger(ledger);
  for (const finding of ledgerFindings) findings.push(`invalid ledger: ${finding}`);

  const inventory = collectSurfaceInventory();
  const classified = classifySurfaces(inventory, ledger);
  for (const item of classified.novel) {
    findings.push(`novel name divergence: ${item.surface}:${item.name}:${item.dimension}`);
  }
  const enums = checkEnumStrings(inventory.phaseLiterals, ledger);
  for (const item of enums.novel) {
    findings.push(`enum divergence: ${item.name}`);
  }
  // docs/36 §10 C4 (R-CX-13) — the banned-token lint promoted to red at M5. The canonical tree's
  // own names are scanned: a canonical operation that derives a surface name carrying a banned
  // synonym verb is a red finding. MCP-W1 (mcp-packaging-decisions v1.0) DELIBERATELY names the
  // wave progress row `waves.progress` (the ordinary MCP tool is baton_waves_progress); that
  // single verb is a documented exception to the C4 ban (the run-surface 'progress' synonym
  // stays banned).
  for (const violation of checkBannedTokens(
    CANONICAL_OPERATIONS.flatMap((operation) => [
      operation.key,
      operation.names.cli,
      operation.names.web,
      operation.names.mcp,
      operation.names.embedded,
    ]).filter((name) => !/^(waves\.progress|baton waves progress|waves_progress|baton_waves_progress|waves\.progress\(\))$/u.test(name)),
  )) {
    findings.push(`banned surface verb: ${violation.name} (${violation.verb})`);
  }
  for (const collision of checkWebNameDisjoint()) {
    findings.push(`web-name collision: ${collision.key} → ${collision.web}`);
  }
  for (const finding of checkSurfaceDocs()) {
    findings.push(`stale generated docs: ${finding}`);
  }
  for (const finding of lintProseInventories()) {
    findings.push(`prose-inventory: ${finding}`);
  }
  if (writeInventory) writeSurfaceInventoryArtifact();
  for (const finding of checkSurfaceInventoryArtifact()) {
    findings.push(`inventory artifact: ${finding}`);
  }
  // Profile parity (CS-1a)
  for (const profile of REFERENCE_PROFILES) {
    const profileInventory = instantiateProfileInventory(profile);
    const section = profileDocSection(profile);
    const parity = checkProfileDocParity(profile, profileInventory, section);
    for (const name of parity.missingFromDoc) {
      findings.push(`profile ${profile.id}: served but undocumented: ${name}`);
    }
    for (const name of parity.missingFromServe) {
      findings.push(`profile ${profile.id}: documented but unserved: ${name}`);
    }
  }
  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const writeInventory = process.argv.includes('--write-inventory');
  const findings = runSurfaceConformanceMain({ writeInventory });
  for (const finding of findings) process.stderr.write(`surface-conformance: ${finding}\n`);
  if (findings.length > 0) process.exit(1);
  process.stdout.write('surface-conformance: ok\n');
}
