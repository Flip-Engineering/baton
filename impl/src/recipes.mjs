// Dynamic workflow composition — recipes, invocation manifests (v2).
//
// Authority: docs/reference/evidence/workflow-composition-2026-07-31/composition-decisions.md —
// the v2 section (and the v2.1 amendment). Rung RC-A ONLY: the normative recipe schema (rule 1),
// the renderer with salt as input (rule 2), the invocation manifest identity boundary, the
// `implementContract` preset, and same-key run/attach behavior over existing waves.
//
// The v2.1 acceptance law: no new orchestration wave may require a new script file. The fifteen
// bespoke `run-*-wave.mjs` driver scripts are `baton.recipes.run(recipe, {task, options})` with
// recipe as data + closed run options. This is an embedded-facade library over the shipped
// `createWaveDriver` (rule 3): no new application commands, no registry entries, MCP/CLI/web
// untouched.
//
// The invocation manifest is the ONE identity boundary (R-DC-1 dissolved). The wrapper is the SOLE
// salt owner: it mints `salt` per new manifest, the renderer receives it as an input, and the
// wrapper drives with `saltObjectives: false` — exactly one salt layer, never two. A retry with the
// same idempotencyKey LOADS the durable manifest and attaches with those EXACT rendered members;
// a different key mints a fresh manifest with a fresh salt.

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { createWaveDriver } from './wave-driver.mjs';
import { runWorkflow } from './workflow-interpreter.mjs';

// Rule 1 caps. The descriptor/task/constraint caps are derived so a fully-maxed card (2KiB task +
// 8×240B constraints) stays under the machinery's objective ceiling — the rendered objective can
// never exceed OBJECTIVE_MAX_BYTES by construction, so admission is the sole gate.
const DESCRIPTOR_MAX_BYTES = 8 * 1024;
const TASK_MAX_BYTES = 2 * 1024;
const CONSTRAINT_MAX_BYTES = 240;
const MAX_CONSTRAINTS = 8;
const MAX_MEMBERS = 8;
const MAX_SCOPE = 64;
// Mirrors wave-driver.mjs OBJECTIVE_MAX_BYTES (the machinery's own objective ceiling).
const RENDERED_OBJECTIVE_MAX_BYTES = 4096;
const ATTACH_SETTLE_TIMEOUT_MS = 5_000;

const RECIPE_TOP_FIELDS = Object.freeze(['name', 'version', 'members', 'policy']);
const ROLE_FIELDS = Object.freeze(['role', 'exact', 'scope', 'objectiveTemplate', 'report']);
const EXACT_FIELDS = Object.freeze(['harness', 'model', 'effort']);
const TEMPLATE_FIELDS = Object.freeze(['task', 'constraints']);
const POLICY_FIELDS = Object.freeze([
  'steering', 'finalization', 'pollIntervalMs', 'stallTimeoutMs', 'hardCapMs',
  'settleTimeoutMs', 'unproductiveNudgeBudget', 'preflight',
]);
const RUN_OPTION_FIELDS = Object.freeze([
  'task', 'idempotencyKey', 'manifestPath', 'evidencePath', 'callbacks', 'overrides',
]);
const OVERRIDE_FIELDS = Object.freeze(['constraints', 'effort', 'scope']);
const CALLBACK_FIELDS = Object.freeze(['onDecision']);
const STEERING_MODES = Object.freeze(new Set(['nudge-on-checkpoint', 'none']));
const FINALIZATIONS = Object.freeze(new Set(['none', 'claim-on-stall']));
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

// The recipe policy allowlist is the DATA-only subset of createWaveDriver's policy (R-DC-6): no
// functions, no signals. `saltObjectives` is forced false by the wrapper (the sole salt owner);
// `evidencePath` is a per-invocation run option; `onProgress`/`signal` are signals, excluded. The
// defaults mirror createWaveDriver's documented production cadence.
const DEFAULT_RECIPE_POLICY = Object.freeze({
  steering: 'nudge-on-checkpoint',
  finalization: 'none',
  pollIntervalMs: 20_000,
  stallTimeoutMs: 20 * 60_000,
  hardCapMs: 3 * 3_600_000,
  settleTimeoutMs: 5_000,
  unproductiveNudgeBudget: 1,
  preflight: true,
});

function recipeError(message, code = 'recipe_invalid') {
  return Object.assign(new TypeError(message), { code });
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) {
      value.forEach(deepFreeze);
    } else {
      for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

function assertClosed(obj, allowed, context) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw recipeError(`${context} field "${key}" is unknown`, 'recipe_schema_invalid');
    }
  }
}

function assertPositiveInt(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw recipeError(`${label} must be a positive integer`, 'recipe_schema_invalid');
  }
}

// R-DC-6: recipes are DATA, not code. A function value anywhere refuses — the closed shape catches
// unknown fields, this catches a function smuggled into a known slot.
function assertNoFunctions(value, path) {
  if (typeof value === 'function') {
    throw recipeError(
      `recipe contains a function value at "${path}" (recipes are data — R-DC-6)`,
      'recipe_schema_invalid',
    );
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoFunctions(item, `${path}[${index}]`));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) assertNoFunctions(child, `${path}.${key}`);
  }
}

function admitPolicy(raw) {
  const source = raw === undefined ? {} : raw;
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    throw recipeError('recipe "policy" must be an object', 'recipe_schema_invalid');
  }
  assertClosed(source, POLICY_FIELDS, 'recipe policy');
  const merged = { ...DEFAULT_RECIPE_POLICY, ...source };
  if (!STEERING_MODES.has(merged.steering)) {
    throw recipeError(`recipe policy "steering" is invalid: ${String(merged.steering)}`, 'recipe_schema_invalid');
  }
  if (!FINALIZATIONS.has(merged.finalization)) {
    throw recipeError(`recipe policy "finalization" is invalid: ${String(merged.finalization)}`, 'recipe_schema_invalid');
  }
  assertPositiveInt(merged.pollIntervalMs, 'recipe policy "pollIntervalMs"');
  assertPositiveInt(merged.stallTimeoutMs, 'recipe policy "stallTimeoutMs"');
  assertPositiveInt(merged.hardCapMs, 'recipe policy "hardCapMs"');
  assertPositiveInt(merged.settleTimeoutMs, 'recipe policy "settleTimeoutMs"');
  if (!Number.isSafeInteger(merged.unproductiveNudgeBudget) || merged.unproductiveNudgeBudget < 0) {
    throw recipeError('recipe policy "unproductiveNudgeBudget" must be a non-negative integer', 'recipe_schema_invalid');
  }
  if (typeof merged.preflight !== 'boolean') {
    throw recipeError('recipe policy "preflight" must be a boolean', 'recipe_schema_invalid');
  }
  return deepFreeze(merged);
}

function admitExact(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw recipeError(`recipe member[${index}] "exact" route must be an object`, 'recipe_schema_invalid');
  }
  assertClosed(raw, EXACT_FIELDS, `recipe member[${index}] exact`);
  for (const field of EXACT_FIELDS) {
    if (typeof raw[field] !== 'string' || raw[field].length === 0) {
      throw recipeError(`recipe member[${index}] exact "${field}" must be a non-empty string`, 'recipe_schema_invalid');
    }
  }
  return Object.freeze({ harness: raw.harness, model: raw.model, effort: raw.effort });
}

function admitScope(raw, index) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SCOPE) {
    throw recipeError(`recipe member[${index}] "scope" must be a non-empty array of glob strings`, 'recipe_schema_invalid');
  }
  if (raw.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) {
    throw recipeError(`recipe member[${index}] "scope" entries must be non-empty strings`, 'recipe_schema_invalid');
  }
  if (new Set(raw).size !== raw.length) {
    throw recipeError(`recipe member[${index}] "scope" entries must be unique`, 'recipe_schema_invalid');
  }
  return Object.freeze([...raw]);
}

function admitTemplate(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw recipeError(`recipe member[${index}] "objectiveTemplate" must be an object`, 'recipe_schema_invalid');
  }
  assertClosed(raw, TEMPLATE_FIELDS, `recipe member[${index}] objectiveTemplate`);
  if (typeof raw.task !== 'string' || raw.task.trim().length === 0) {
    throw recipeError(`recipe member[${index}] objectiveTemplate "task" must be a non-empty string`, 'recipe_schema_invalid');
  }
  const taskBytes = Buffer.byteLength(raw.task);
  if (taskBytes > TASK_MAX_BYTES) {
    throw recipeError(
      `recipe member[${index}] objectiveTemplate "task" is ${taskBytes} bytes (limit ${TASK_MAX_BYTES})`,
      'recipe_oversize',
    );
  }
  if (!Array.isArray(raw.constraints) || raw.constraints.length > MAX_CONSTRAINTS) {
    throw recipeError(
      `recipe member[${index}] objectiveTemplate "constraints" must be an array of at most ${MAX_CONSTRAINTS} strings`,
      'recipe_schema_invalid',
    );
  }
  const constraints = raw.constraints.map((constraint, ci) => {
    if (typeof constraint !== 'string' || constraint.trim().length === 0) {
      throw recipeError(`recipe member[${index}] objectiveTemplate constraint[${ci}] must be a non-empty string`, 'recipe_schema_invalid');
    }
    const bytes = Buffer.byteLength(constraint);
    if (bytes > CONSTRAINT_MAX_BYTES) {
      throw recipeError(
        `recipe member[${index}] objectiveTemplate constraint[${ci}] is ${bytes} bytes (limit ${CONSTRAINT_MAX_BYTES})`,
        'recipe_oversize',
      );
    }
    return constraint;
  });
  return Object.freeze({ task: raw.task, constraints: Object.freeze(constraints) });
}

function admitMember(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw recipeError(`recipe member[${index}] must be an object`, 'recipe_schema_invalid');
  }
  // EXACT routes only in v2 (selectors deferred). Guide a manual-route author to the corrective
  // field BEFORE the closed-shape check names their harness/model/effort as unknown.
  if (raw.exact === undefined) {
    const manual = ['harness', 'model', 'effort'].some((field) => raw[field] !== undefined);
    throw recipeError(
      `recipe member[${index}] requires an "exact" route object {harness, model, effort}`
        + `${manual ? ' (manual harness/model/effort routing is not shipped in v2 — selectors deferred)' : ''}`,
      'recipe_schema_invalid',
    );
  }
  assertClosed(raw, ROLE_FIELDS, `recipe member[${index}]`);
  if (typeof raw.role !== 'string' || raw.role.trim().length === 0) {
    throw recipeError(`recipe member[${index}] "role" must be a non-empty string`, 'recipe_schema_invalid');
  }
  const role = raw.role.trim();
  // `work` is the reserved run-level recipient sentinel (wave.mjs:59) — refuse it as a role.
  if (role === 'work') {
    throw recipeError(`recipe member[${index}] role "work" is reserved`, 'recipe_schema_invalid');
  }
  const exact = admitExact(raw.exact, index);
  const scope = admitScope(raw.scope, index);
  const objectiveTemplate = admitTemplate(raw.objectiveTemplate, index);
  const member = { role, exact, scope, objectiveTemplate };
  if (raw.report !== undefined) {
    if (typeof raw.report !== 'string' || raw.report.trim().length === 0) {
      throw recipeError(`recipe member[${index}] "report" must be a non-empty string`, 'recipe_schema_invalid');
    }
    member.report = raw.report.trim();
  }
  return deepFreeze(member);
}

// Rule 1: one normative closed schema, byte-bounded, deep-frozen at admission, unknown fields
// refused with the corrective naming the field. `verification` is REMOVED (no consumer — R-DC-6).
export function admitRecipe(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw recipeError('recipe must be an object', 'recipe_schema_invalid');
  }
  assertClosed(raw, RECIPE_TOP_FIELDS, 'recipe');
  // Data, not code — refuse a function value anywhere before type validation.
  assertNoFunctions(raw, 'recipe');
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
    throw recipeError('recipe "name" must be a non-empty string', 'recipe_schema_invalid');
  }
  if (typeof raw.version !== 'string' || raw.version.trim().length === 0) {
    throw recipeError('recipe "version" must be a non-empty string', 'recipe_schema_invalid');
  }
  const policy = admitPolicy(raw.policy);
  if (!Array.isArray(raw.members) || raw.members.length === 0) {
    throw recipeError('recipe "members" must be a non-empty array', 'recipe_schema_invalid');
  }
  if (raw.members.length > MAX_MEMBERS) {
    throw recipeError(`recipe "members" exceeds ${MAX_MEMBERS} member cards`, 'recipe_schema_invalid');
  }
  const members = raw.members.map((member, index) => admitMember(member, index));
  const roles = members.map((member) => member.role);
  if (new Set(roles).size !== roles.length) {
    throw recipeError(`recipe "members" contains duplicate roles: ${roles.find((role, i) => roles.indexOf(role) !== i)}`, 'recipe_schema_invalid');
  }
  const recipe = { name: raw.name.trim(), version: raw.version.trim(), members, policy };
  const descriptorBytes = Buffer.byteLength(canonicalJson(recipe));
  if (descriptorBytes > DESCRIPTOR_MAX_BYTES) {
    throw recipeError(
      `recipe descriptor is ${descriptorBytes} bytes (limit ${DESCRIPTOR_MAX_BYTES})`,
      'recipe_oversize',
    );
  }
  return deepFreeze(recipe);
}

// The recipe digest is over the ADMITTED recipe only — never over run options (R-DC-6/7). Overrides,
// callbacks, evidencePath, and the per-invocation task never enter it.
export function recipeDigest(recipe) {
  return createHash('sha256').update(canonicalJson(recipe)).digest('hex');
}

// Rule 2: one renderer, salt as an input. Composes the pinned shape (task, then constraint lines,
// then [attempt: <salt> <role>]) — the same salt-line form createWaveDriver would prepend, appended
// here because the wrapper is the sole salt owner. The renderer never mints its own salt.
export function renderObjective({ task, constraints, salt, role } = {}) {
  if (typeof task !== 'string' || task.length === 0) {
    throw recipeError('renderObjective "task" must be a non-empty string', 'recipe_renderer_invalid');
  }
  if (!Array.isArray(constraints) || constraints.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw recipeError('renderObjective "constraints" must be an array of non-empty strings', 'recipe_renderer_invalid');
  }
  if (typeof salt !== 'string' || salt.length === 0) {
    throw recipeError('renderObjective "salt" is required (the renderer never mints its own salt)', 'recipe_renderer_invalid');
  }
  if (typeof role !== 'string' || role.length === 0) {
    throw recipeError('renderObjective "role" must be a non-empty string', 'recipe_renderer_invalid');
  }
  const objective = [task, ...constraints, `[attempt: ${salt} ${role}]`].join('\n');
  const bytes = Buffer.byteLength(objective);
  if (bytes > RENDERED_OBJECTIVE_MAX_BYTES) {
    throw recipeError(`rendered objective is ${bytes} bytes (limit ${RENDERED_OBJECTIVE_MAX_BYTES})`, 'recipe_oversize');
  }
  return objective;
}

// The recipe's objectiveTemplate.task is a template; the per-invocation `task` fills `{task}` (or
// appends when no placeholder is present). An empty/absent runtime task leaves the template intact.
function resolveTask(templateTask, runtimeTask) {
  if (typeof runtimeTask !== 'string' || runtimeTask.length === 0) return templateTask;
  if (templateTask.includes('{task}')) return templateTask.replace('{task}', runtimeTask);
  return `${templateTask}\n${runtimeTask}`;
}

// Render one member into the durable, serializable shape the manifest and waves.attach carry. The
// objective is fully rendered (task resolved + constraints + the salt line).
export function renderMember(member, task, salt) {
  const objective = renderObjective({
    task: resolveTask(member.objectiveTemplate.task, task),
    constraints: member.objectiveTemplate.constraints,
    salt,
    role: member.role,
  });
  const rendered = {
    role: member.role,
    objective,
    exact: member.exact,
    scope: [...member.scope],
  };
  if (member.report !== undefined) rendered.report = member.report;
  return Object.freeze(rendered);
}

// Rule 3 override allowlist: {constraints (append), effort (replace), scope (replace)}. Returns a
// raw (mutable) recipe for re-admission — the merge itself validates nothing; admitRecipe does, so a
// post-merge oversize/count breach refuses at re-validation before any side effect.
export function mergeOverrides(recipe, overrides) {
  if (!overrides) return recipe;
  const members = recipe.members.map((member) => {
    const next = {
      role: member.role,
      exact: { ...member.exact },
      scope: [...member.scope],
      objectiveTemplate: {
        task: member.objectiveTemplate.task,
        constraints: [...member.objectiveTemplate.constraints],
      },
    };
    if (member.report !== undefined) next.report = member.report;
    if (overrides.effort !== undefined) next.exact.effort = overrides.effort;
    if (overrides.scope !== undefined) next.scope = [...overrides.scope];
    if (overrides.constraints !== undefined) {
      next.objectiveTemplate.constraints = [...next.objectiveTemplate.constraints, ...overrides.constraints];
    }
    return next;
  });
  return { name: recipe.name, version: recipe.version, members, policy: { ...recipe.policy } };
}

function waveIdFor(idempotencyKey) {
  // Mirrors wave.mjs:179 — the driver derives waveId from the idempotencyKey ALONE.
  return `wave:${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32)}`;
}

function writeManifest(path, manifest) {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

function loadManifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Rule 3: run options are closed and per-invocation. callbacks/signals/evidence NEVER serialize
// into the recipe or its digest; overrides are the closed allowlist above.
function validateRunOptions(invocation) {
  if (!invocation || typeof invocation !== 'object' || Array.isArray(invocation)) {
    throw recipeError('recipes run options must be an object', 'recipe_options_invalid');
  }
  for (const key of Object.keys(invocation)) {
    if (!RUN_OPTION_FIELDS.includes(key)) {
      throw recipeError(`recipes run option "${key}" is unknown`, 'recipe_options_invalid');
    }
  }
  const { task, idempotencyKey, manifestPath, evidencePath, callbacks, overrides } = invocation;
  if (task !== undefined && typeof task !== 'string') {
    throw recipeError('recipes run option "task" must be a string', 'recipe_options_invalid');
  }
  if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
    throw recipeError('recipes run option "idempotencyKey" is invalid', 'recipe_idempotency_invalid');
  }
  for (const field of [manifestPath, evidencePath]) {
    if (invocation[field] !== undefined && (typeof invocation[field] !== 'string' || invocation[field].length === 0)) {
      throw recipeError(`recipes run option "${field}" must be a non-empty path`, 'recipe_options_invalid');
    }
  }
  if (callbacks !== undefined) {
    if (typeof callbacks !== 'object' || callbacks === null || Array.isArray(callbacks)) {
      throw recipeError('recipes run option "callbacks" must be an object', 'recipe_options_invalid');
    }
    for (const key of Object.keys(callbacks)) {
      if (!CALLBACK_FIELDS.includes(key)) {
        throw recipeError(`recipes callback "${key}" is unknown`, 'recipe_options_invalid');
      }
    }
    if (callbacks.onDecision !== undefined && typeof callbacks.onDecision !== 'function') {
      throw recipeError('recipes callback "onDecision" must be a function', 'recipe_options_invalid');
    }
  }
  const normalizedOverrides = validateOverrides(overrides);
  return { task, idempotencyKey, manifestPath, evidencePath, callbacks, overrides: normalizedOverrides };
}

function validateOverrides(overrides) {
  if (overrides === undefined) return undefined;
  if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) {
    throw recipeError('recipes run option "overrides" must be an object', 'recipe_options_invalid');
  }
  for (const key of Object.keys(overrides)) {
    if (!OVERRIDE_FIELDS.includes(key)) {
      throw recipeError(`recipes override "${key}" is unknown (allowlist: constraints, effort, scope)`, 'recipe_override_unknown');
    }
  }
  const normalized = {};
  if (overrides.constraints !== undefined) {
    if (!Array.isArray(overrides.constraints) || overrides.constraints.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
      throw recipeError('recipes override "constraints" must be an array of non-empty strings', 'recipe_override_invalid');
    }
    normalized.constraints = [...overrides.constraints];
  }
  if (overrides.effort !== undefined) {
    if (typeof overrides.effort !== 'string' || overrides.effort.length === 0) {
      throw recipeError('recipes override "effort" must be a non-empty string', 'recipe_override_invalid');
    }
    normalized.effort = overrides.effort;
  }
  if (overrides.scope !== undefined) {
    if (!Array.isArray(overrides.scope) || overrides.scope.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
      throw recipeError('recipes override "scope" must be an array of non-empty strings', 'recipe_override_invalid');
    }
    normalized.scope = [...overrides.scope];
  }
  return normalized;
}

// Fresh manifest → start path: the wrapper renders with ONE salt and drives with saltObjectives
// false (the sole salt owner). The manifest is persisted before the run so a crash + same-key retry
// attaches rather than double-starts.
async function startRun(baton, manifest, opts, merged) {
  const driverPolicy = {
    ...merged.policy,
    saltObjectives: false, // R-DC-1: exactly one salt layer — the wrapper's, never the driver's.
    evidencePath: opts.evidencePath ?? null,
    // RC-5: callbacks.onDecision is a closed run option and is ACCEPTED here, but NOT yet wired —
    // the shipped createWaveDriver has no onDecision policy field (bidirectional v2 DRIVER half is
    // the successor). When that field lands, pass it through unchanged here. Until then it is
    // carried (never serialized into the recipe/digest) and honestly deferred.
  };
  const driver = createWaveDriver(baton, driverPolicy);
  const receipt = await driver.run({
    members: manifest.renderedMembers,
    idempotencyKey: manifest.idempotencyKey,
  });
  return { ...receipt, manifest };
}

// Loaded manifest → attach path: bind the prior wave's EXACT rendered members (the live
// waves.attach rediscovery contract) and harvest. Zero runs.start — attach binds existing runs.
async function attachRun(baton, manifest) {
  const wave = await baton.waves.attach(manifest.waveId, manifest.renderedMembers);
  const outcomes = await wave.settle({ timeoutMs: ATTACH_SETTLE_TIMEOUT_MS });
  const stop = await wave.close({ reason: 'Recipes invocation manifest attached.' });
  const evidence = wave.evidence();
  return {
    ...evidence,
    remainingCount: stop?.remainingCount ?? evidence.stops.length,
    residueUnknown: stop?.residueUnknown ?? false,
    basis: 'attached',
    nudges: [],
    claims: [],
    salt: manifest.salt,
    pumpDrained: evidence.pumpDrained === true,
    manifest,
  };
}

// baton.recipes.run(recipe, {task, options}) — the generic runner. The recipe is data admitted once;
// the manifest is the identity boundary; the driver is the shipped createWaveDriver.
async function runRecipe(baton, rawRecipe, invocation) {
  const baseRecipe = admitRecipe(rawRecipe);
  const opts = validateRunOptions(invocation);
  const digest = recipeDigest(baseRecipe);

  // Same-key retry: load the durable manifest and attach — never re-start.
  const existing = opts.manifestPath && existsSync(opts.manifestPath) ? loadManifest(opts.manifestPath) : null;
  if (existing && existing.idempotencyKey === opts.idempotencyKey) {
    return attachRun(baton, existing);
  }

  // Fresh mint: merge overrides + re-validate (a post-merge breach refuses before any side effect),
  // then render with ONE salt. The digest is the BASE recipe's — overrides never enter it.
  const merged = admitRecipe(mergeOverrides(baseRecipe, opts.overrides));
  const salt = randomUUID();
  const renderedMembers = merged.members.map((member) => renderMember(member, opts.task, salt));
  const manifest = {
    schemaVersion: 1,
    waveId: waveIdFor(opts.idempotencyKey),
    idempotencyKey: opts.idempotencyKey,
    recipeDigest: digest,
    salt,
    renderedMembers,
  };
  if (opts.manifestPath) writeManifest(opts.manifestPath, manifest);
  return startRun(baton, manifest, opts, merged);
}

// The `implementContract` preset — one red-first implementation seat. This is the shape the bespoke
// run-impl-wave.mjs scripts hand-copied; as data it is `baton.recipes.implementContract(...)`.
const IMPLEMENT_TASK_TEMPLATE = 'Implement the assigned contract rung. The task that follows is your sole work authority.\n\n{task}';
const IMPLEMENT_CONSTRAINTS = Object.freeze([
  'Work red-first: write the failing test first, then implement until green.',
  'HARD CONSTRAINT (wire_frame_oversize, issue #28): never read a whole file over ~1500 lines; grep -an to locate, then read targeted ranges.',
  'Do NOT git commit — the orchestrator harvests your worktree.',
  'Match existing code style; minimal diffs; no new application commands, registry entries, or MCP/CLI/web surfaces.',
  // Issue #62: the scratchpad's four closed entry kinds, verbatim — an entry outside these
  // refuses scratchpad_entry_invalid (a demo surveyor lost three writes to a hand-rolled shape).
  'SCRATCHPAD_WRITE is printed TEXT, never a tool; entries are EXACTLY note{text} | plan{objective,steps[{text,state}],supersedes} | doubt{question,context} | link{label,relation,target} (+ expectedFence:"current", unique idempotencyKey).',
]);
const IMPLEMENT_DEFAULT_POLICY = Object.freeze({
  steering: 'nudge-on-checkpoint',
  finalization: 'claim-on-stall',
  pollIntervalMs: 20_000,
  stallTimeoutMs: 20 * 60_000,
  hardCapMs: 3 * 3_600_000,
  settleTimeoutMs: 15_000,
  unproductiveNudgeBudget: 1,
  preflight: true,
});

export function implementContractRecipe({ task, route, scope, role = 'implementer', name = 'implementContract', policy = {} } = {}) {
  return {
    name,
    version: '1',
    members: [{
      role,
      exact: route,
      scope,
      objectiveTemplate: { task: IMPLEMENT_TASK_TEMPLATE, constraints: [...IMPLEMENT_CONSTRAINTS] },
    }],
    policy: { ...IMPLEMENT_DEFAULT_POLICY, ...policy },
  };
}

async function implementContract(baton, invocation) {
  if (!invocation || typeof invocation !== 'object' || Array.isArray(invocation)) {
    throw recipeError('implementContract invocation must be an object', 'recipe_options_invalid');
  }
  const { task, route, scope, role, name, policy, ...runOptions } = invocation;
  const recipe = implementContractRecipe({ task, route, scope, role, name, policy });
  return runRecipe(baton, recipe, { task, ...runOptions });
}

// Rule 3: baton.recipes is an embedded-facade library over the shipped driver. The facade is
// derived from the BatonClient (the bindBaton surface), not a new command family.
export function createRecipes(baton, repoRoot = null) {
  if (!baton || typeof baton !== 'object' || typeof baton?.waves?.start !== 'function') {
    throw recipeError('createRecipes requires a Baton client facade with waves.start', 'recipe_facade_invalid');
  }
  const boundRepoRoot = repoRoot ?? (typeof baton.repoRoot === 'string' && baton.repoRoot.length > 0 ? baton.repoRoot : null);
  return Object.freeze({
    run: (recipe, invocation) => runRecipe(baton, recipe, invocation),
    implementContract: (invocation) => implementContract(baton, invocation),
    // Issue #114 — the workflow-as-data interpreter lane (D2). The spec is data + closed run options
    // over the same wave machinery; repoRoot rides in so the D4 harvest can read the authoritative sha.
    runWorkflow: (spec, invocation = {}) => runWorkflow(baton, spec, { repoRoot: boundRepoRoot, ...invocation }),
  });
}

export default createRecipes;
