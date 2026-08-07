// Issue #114 — the workflow-as-data interpreter (the driver-killer).
//
// Authority: docs/reference/evidence/workflow-as-data-2026-08-06/workflow-as-data-contract.md v1.2.
// ONE closed spec + ONE verb ends the bespoke-driver era: a JSON document (D1) validated closed at
// admission (recursive, every nesting level), run over the shipped wave machinery through the
// embedded Baton facade ALONE (D2 — no kernel reach), with the closed steering policies (D3), the
// authoritative-result-sha harvest (D4), objectives by reference (D5), and the structured receipt
// (D6). The interpreter is pure evaluation over a frozen spec: importing this module runs NOTHING
// (GT4's law made structural — no top-level await, no top-level wave start). It drives ONLY the
// `baton` facade (`baton.waves.start` → `wave.runs.get(role)` → `handle.status()/act()/answer()/
// _command()`), exactly as run-dynamic-workflow.mjs proved, generalized from a spec.
//
// The lane module (workflow-lane.mjs) re-exports runWorkflow so importing it is idempotent and
// side-effect-free; recipes.mjs exposes it as baton.recipes.runWorkflow; application.mjs registers
// the `waves.run` direct port for the CLI (`baton waves run`) and MCP (`baton_waves_run`) surfaces.

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

// ---------------------------------------------------------------------------
// Refusal vocabulary (D — field/role-named, recursive).
// ---------------------------------------------------------------------------

function workflowError(message, code) {
  return Object.assign(new TypeError(message), { code });
}
const specInvalid = (message) => workflowError(message, 'workflow_spec_invalid');
const memberInvalid = (message) => workflowError(message, 'workflow_member_invalid');
const steeringUnknown = (message) => workflowError(message, 'workflow_steering_unknown');
const harvestInvalid = (message) => workflowError(message, 'workflow_harvest_invalid');
const objectiveRefInvalid = (message) => workflowError(message, 'workflow_objective_ref_invalid');

// ---------------------------------------------------------------------------
// Closed-schema primitives (recipes-lane pattern, recipes.mjs:74-121).
// ---------------------------------------------------------------------------

const OBJECTIVE_REF_MAX_BYTES = 64 * 1024; // D5 — the byte bound pinned at its exact value (F8b).
const MAX_MEMBERS = 64;                     // the wave-machinery member ceiling (P4).
const MAX_SCOPE = 64;
const GLOB_MAGIC = /[*?[\]{}!+@]/u;
const RESULT_SHA = /^[a-f0-9]{40,64}$/u;
const MESSAGE_KINDS = new Set(['inform', 'query', 'steer']);          // coordinator.mjs:6795.
const SCRATCHPAD_KINDS = new Set(['doubt', 'link', 'note', 'plan']);  // coordination-store.mjs:507.
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

const SPEC_FIELDS = ['schemaVersion', 'idempotencyKey', 'members', 'steering', 'harvest'];
const MEMBER_FIELDS = ['role', 'exact', 'scope', 'objectiveRef', 'report'];
const EXACT_FIELDS = ['harness', 'model', 'effort'];
const STEERING_FIELDS = [
  'approveOnAdvertisedPlan', 'nudgeOnCheckpoint', 'claimOnStall', 'messageOnSpawn',
  'elevateWhenNotes', 'answerDecisions', 'signalOnMembersDone',
];

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) value.forEach(deepFreeze);
    else for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

// B6: a spec is DATA, not code. A function value anywhere refuses workflow_spec_invalid naming the
// slot (assertNoFunctions runs at every nesting level, before type validation).
function assertNoFunctions(value, path) {
  if (typeof value === 'function') {
    const slot = path.split('.').pop();
    throw specInvalid(`workflow spec carries a function at "${path}" (the "${slot}" slot) — a spec is data, never code (B6)`);
  }
  if (Array.isArray(value)) value.forEach((item, index) => assertNoFunctions(item, `${path}[${index}]`));
  else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) assertNoFunctions(child, `${path}.${key}`);
  }
}

function assertObject(value, refuse, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw refuse(`the "${name}" field must be an object`);
  return value;
}

// ---------------------------------------------------------------------------
// Containment (mcp-descriptor.mjs:46-72 precedent — lexical resolve + realpath symlink escape).
// ---------------------------------------------------------------------------

// Realpath a path that may not exist yet (a harvest target is admitted BEFORE it is written, so
// realpathSync throws on the missing path). realpath the deepest EXISTING ancestor and append the
// unresolved tail. Both the root and the candidate go through this SAME discipline — a one-sided
// realpath (realpath'd root vs lexical candidate, or vice versa) would read every in-root pending
// path as outside on macOS, where the tmpdir `/var/folders` realpaths to `/private/var/folders`.
function realpathMaybe(path) {
  const resolved = resolve(path);
  let current = resolved;
  const tail = [];
  for (;;) {
    try {
      const base = realpathSync(current);
      return tail.length === 0 ? base : `${base}${sep}${tail.reverse().join(sep)}`;
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolved; // walked to the root without a hit — keep lexical
      tail.push(basename(current));
      current = parent;
    }
  }
}

function escapesRepo(repoRoot, relPath) {
  const repoResolved = resolve(repoRoot);
  const target = resolve(repoRoot, relPath);
  const fromRepo = relative(repoResolved, target);
  if (fromRepo === '' || fromRepo === '..' || fromRepo.startsWith(`..${sep}`) || isAbsolute(fromRepo)) return true;
  const realTarget = realpathMaybe(target);
  const realRoot = realpathMaybe(repoResolved);
  const fromReal = relative(realRoot, realTarget);
  return fromReal === '..' || fromReal.startsWith(`..${sep}`) || isAbsolute(fromReal);
}

// ---------------------------------------------------------------------------
// D1 — the closed spec validator.
// ---------------------------------------------------------------------------

function admitSpec(raw, repoRoot) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw specInvalid('the workflow spec must be an object');
  // Data, not code — refuse a function smuggled into ANY known slot before type validation (B6).
  assertNoFunctions(raw, 'spec');
  // Closed top-level shape: an unknown field (including the REMOVED `verification`, B4) refuses.
  for (const key of Object.keys(raw)) {
    if (!SPEC_FIELDS.includes(key)) throw specInvalid(`the workflow spec field "${key}" is unknown (the closed schema is ${SPEC_FIELDS.join(', ')}; "verification" is REMOVED — B4)`);
  }
  if (raw.schemaVersion !== 1) throw specInvalid('the workflow spec "schemaVersion" must be exactly 1 (a closed enum)');
  if (typeof raw.idempotencyKey !== 'string' || !IDEMPOTENCY_PATTERN.test(raw.idempotencyKey)) {
    throw specInvalid('the workflow spec "idempotencyKey" must be a non-empty identifier string');
  }
  if (!Array.isArray(raw.members) || raw.members.length === 0) throw specInvalid('the workflow spec "members" must be a non-empty array');
  if (raw.members.length > MAX_MEMBERS) throw specInvalid(`the workflow spec "members" exceeds the ${MAX_MEMBERS}-member ceiling`);
  const steering = raw.steering === undefined ? {} : assertObject(raw.steering, specInvalid, 'steering');
  const harvest = raw.harvest === undefined ? { paths: [] } : assertObject(raw.harvest, specInvalid, 'harvest');

  const members = raw.members.map((member, index) => admitMember(member, index));
  const roles = members.map((member) => member.role);
  const duplicate = roles.find((role, index) => roles.indexOf(role) !== index);
  if (duplicate !== undefined) throw memberInvalid(`the workflow member role "${duplicate}" is duplicated (roles must be unique)`);

  const normalizedSteering = admitSteering(steering);
  const normalizedHarvest = admitHarvest(harvest, repoRoot);

  return deepFreeze({
    schemaVersion: 1,
    idempotencyKey: raw.idempotencyKey,
    members,
    steering: normalizedSteering,
    harvest: normalizedHarvest,
  });
}

function admitMember(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw memberInvalid(`workflow member[${index}] must be an object`);
  const role = raw.role;
  if (typeof role !== 'string' || role.trim().length === 0) throw memberInvalid(`workflow member[${index}] "role" must be a non-empty string`);
  const named = role.trim();
  // `work` is the reserved run-level recipient sentinel (wave.mjs:59).
  if (named === 'work') throw memberInvalid(`workflow member "${named}" role "work" is reserved`);
  // Closed member shape: an unknown field (e.g. an inline `objective` — D5 forbids inline text) refuses.
  for (const key of Object.keys(raw)) {
    if (!MEMBER_FIELDS.includes(key)) throw memberInvalid(`workflow member "${named}" carries the unknown field "${key}" (the closed member shape is ${MEMBER_FIELDS.join(', ')}; objective text is by reference only — D5)`);
  }
  // exact route — closed {harness, model, effort}.
  const exact = raw.exact;
  if (!exact || typeof exact !== 'object' || Array.isArray(exact)) throw memberInvalid(`workflow member "${named}" "exact" route must be an object`);
  for (const key of Object.keys(exact)) {
    if (!EXACT_FIELDS.includes(key)) throw memberInvalid(`workflow member "${named}" "exact" route field "${key}" is unknown`);
  }
  for (const field of EXACT_FIELDS) {
    if (typeof exact[field] !== 'string' || exact[field].length === 0) throw memberInvalid(`workflow member "${named}" "exact" route "${field}" must be a non-empty string`);
  }
  // scope — the UNION of wave.mjs's laws and the path-scope class (F12).
  const scope = raw.scope;
  if (!Array.isArray(scope) || scope.length === 0 || scope.length > MAX_SCOPE) throw memberInvalid(`workflow member "${named}" "scope" must be a non-empty bounded array`);
  if (new Set(scope).size !== scope.length) throw memberInvalid(`workflow member "${named}" "scope" entries must be unique`);
  for (const entry of scope) {
    if (typeof entry !== 'string' || entry.trim().length === 0) throw memberInvalid(`workflow member "${named}" "scope" entries must be non-empty strings`);
    // path-scope.mjs class (path-scope.mjs:6-7): NUL / absolute / backslash / `..` segment refuse
    // AT ADMISSION (never a late path_scope_invalid crash).
    if (entry.includes('\0') || entry.startsWith('/') || entry.includes('\\') || entry.split('/').includes('..')) {
      throw memberInvalid(`workflow member "${named}" "scope" entry "${entry}" escapes the member scope class (no NUL, absolute, backslash, or ".." segment)`);
    }
    // wave.mjs:68-88 — a bare directory matches only itself under glob scope semantics.
    if (!GLOB_MAGIC.test(entry)) {
      const trimmed = entry.replace(/\/+$/u, '');
      const basename = trimmed.split('/').pop() ?? '';
      if (!basename.includes('.')) {
        throw memberInvalid(`workflow member "${named}" "scope" entry "${entry}" names a bare directory; use "${trimmed}/**"`);
      }
    }
  }
  // objectiveRef — presence and shape here; existence/containment/byte-bound at render (D5).
  if (typeof raw.objectiveRef !== 'string' || raw.objectiveRef.trim().length === 0) {
    throw memberInvalid(`workflow member "${named}" "objectiveRef" is required (objective text is by reference only — D5)`);
  }
  // report — a declared, allowed member field (F2), never executed.
  if (raw.report !== undefined && (typeof raw.report !== 'string' || raw.report.trim().length === 0)) {
    throw memberInvalid(`workflow member "${named}" "report" must be a non-empty path`);
  }
  const member = { role: named, exact: { ...exact }, scope: [...scope], objectiveRef: raw.objectiveRef };
  if (raw.report !== undefined) member.report = raw.report;
  return member;
}

function admitSteering(steering) {
  for (const key of Object.keys(steering)) {
    if (!STEERING_FIELDS.includes(key)) throw steeringUnknown(`the steering policy "${key}" is unknown (the closed policy set is ${STEERING_FIELDS.join(', ')})`);
  }
  const out = {};
  if (steering.approveOnAdvertisedPlan !== undefined) {
    if (typeof steering.approveOnAdvertisedPlan !== 'boolean') throw steeringUnknown('the steering policy "approveOnAdvertisedPlan" must be a boolean');
    out.approveOnAdvertisedPlan = steering.approveOnAdvertisedPlan;
  }
  if (steering.claimOnStall !== undefined) {
    if (typeof steering.claimOnStall !== 'boolean') throw steeringUnknown('the steering policy "claimOnStall" must be a boolean');
    out.claimOnStall = steering.claimOnStall;
  }
  if (steering.nudgeOnCheckpoint !== undefined) {
    const nudge = assertObject(steering.nudgeOnCheckpoint, steeringUnknown, 'nudgeOnCheckpoint');
    for (const key of Object.keys(nudge)) {
      if (key !== 'message') throw steeringUnknown(`the steering policy "nudgeOnCheckpoint" carries the unknown field "${key}"`);
    }
    if (typeof nudge.message !== 'string' || nudge.message.length === 0) throw steeringUnknown('the steering policy "nudgeOnCheckpoint" requires a "message" string');
    out.nudgeOnCheckpoint = { message: nudge.message };
  }
  if (steering.messageOnSpawn !== undefined) {
    const message = assertObject(steering.messageOnSpawn, steeringUnknown, 'messageOnSpawn');
    for (const key of Object.keys(message)) {
      if (key !== 'kind' && key !== 'body') throw steeringUnknown(`the steering policy "messageOnSpawn" carries the unknown field "${key}"`);
    }
    if (!MESSAGE_KINDS.has(message.kind)) throw steeringUnknown(`the steering policy "messageOnSpawn" "kind" must be one of ${[...MESSAGE_KINDS].join('|')}`);
    if (typeof message.body !== 'string' || message.body.length === 0) throw steeringUnknown('the steering policy "messageOnSpawn" requires a "body" string');
    out.messageOnSpawn = { kind: message.kind, body: message.body };
  }
  if (steering.elevateWhenNotes !== undefined) {
    const elevate = assertObject(steering.elevateWhenNotes, steeringUnknown, 'elevateWhenNotes');
    for (const key of Object.keys(elevate)) {
      if (key !== 'kinds' && key !== 'maxEntries') throw steeringUnknown(`the steering policy "elevateWhenNotes" carries the unknown field "${key}"`);
    }
    if (!Array.isArray(elevate.kinds) || elevate.kinds.length === 0) throw steeringUnknown('the steering policy "elevateWhenNotes" requires a non-empty "kinds" array');
    for (const kind of elevate.kinds) {
      if (!SCRATCHPAD_KINDS.has(kind)) throw steeringUnknown(`the steering policy "elevateWhenNotes" "kinds" value "${kind}" is not a scratchpad kind (${[...SCRATCHPAD_KINDS].join('|')})`);
    }
    if (!Number.isSafeInteger(elevate.maxEntries) || elevate.maxEntries <= 0) throw steeringUnknown('the steering policy "elevateWhenNotes" "maxEntries" must be a positive integer');
    out.elevateWhenNotes = { kinds: [...elevate.kinds], maxEntries: elevate.maxEntries };
  }
  if (steering.answerDecisions !== undefined) {
    const answer = assertObject(steering.answerDecisions, steeringUnknown, 'answerDecisions');
    for (const key of Object.keys(answer)) {
      if (key !== 'policy') throw steeringUnknown(`the steering policy "answerDecisions" carries the unknown field "${key}"`);
    }
    const policy = answer.policy;
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw steeringUnknown('the steering policy "answerDecisions" requires a "policy" map (question → optionId | text | "defer")');
    for (const [pattern, value] of Object.entries(policy)) {
      if (typeof value !== 'string' || value.length === 0) throw steeringUnknown(`the steering policy "answerDecisions" policy "${pattern}" must map to a non-empty string`);
    }
    out.answerDecisions = { policy: { ...policy } };
  }
  if (steering.signalOnMembersDone !== undefined) {
    const signal = assertObject(steering.signalOnMembersDone, steeringUnknown, 'signalOnMembersDone');
    for (const key of Object.keys(signal)) {
      if (key !== 'roles' && key !== 'message') throw steeringUnknown(`the steering policy "signalOnMembersDone" carries the unknown field "${key}"`);
    }
    if (!Array.isArray(signal.roles) || signal.roles.length === 0 || signal.roles.some((role) => typeof role !== 'string' || role.length === 0)) {
      throw steeringUnknown('the steering policy "signalOnMembersDone" requires a non-empty "roles" array');
    }
    const message = assertObject(signal.message, steeringUnknown, 'signalOnMembersDone.message');
    for (const key of Object.keys(message)) {
      if (key !== 'kind' && key !== 'body') throw steeringUnknown(`the steering policy "signalOnMembersDone" message carries the unknown field "${key}"`);
    }
    if (!MESSAGE_KINDS.has(message.kind)) throw steeringUnknown(`the steering policy "signalOnMembersDone" message "kind" must be one of ${[...MESSAGE_KINDS].join('|')}`);
    if (typeof message.body !== 'string' || message.body.length === 0) throw steeringUnknown('the steering policy "signalOnMembersDone" message requires a "body" string');
    out.signalOnMembersDone = { roles: [...signal.roles], message: { kind: message.kind, body: message.body } };
  }
  return out;
}

function admitHarvest(harvest, repoRoot) {
  for (const key of Object.keys(harvest)) {
    if (key !== 'paths') throw harvestInvalid(`the harvest field "${key}" is unknown (the closed harvest shape is "paths")`);
  }
  const paths = harvest.paths === undefined ? [] : harvest.paths;
  if (!Array.isArray(paths)) throw harvestInvalid('the harvest "paths" must be an array');
  return { paths: paths.map((entry) => admitHarvestEntry(entry, repoRoot)) };
}

function admitHarvestEntry(entry, repoRoot) {
  if (typeof entry === 'string') {
    if (entry.length === 0) throw harvestInvalid('a harvest "paths" entry must be a non-empty string');
    assertHarvestContained(entry, repoRoot);
    return { path: entry };
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw harvestInvalid('a harvest "paths" entry must be a string or an object');
  for (const key of Object.keys(entry)) {
    if (key !== 'path' && key !== 'mustContain') throw harvestInvalid(`a harvest "paths" entry carries the unknown field "${key}"`);
  }
  if (typeof entry.path !== 'string' || entry.path.length === 0) throw harvestInvalid('a harvest "paths" entry "path" must be a non-empty string');
  if (entry.mustContain !== undefined && typeof entry.mustContain !== 'string') throw harvestInvalid('a harvest "paths" entry "mustContain" must be a string');
  assertHarvestContained(entry.path, repoRoot);
  const out = { path: entry.path };
  if (entry.mustContain !== undefined) out.mustContain = entry.mustContain;
  return out;
}

// D4: every harvest path is containment-checked at admission (lexical `..`/absolute/backslash/NUL
// PLUS the realpath symlink-escape check) — a path escaping the repo refuses workflow_harvest_invalid.
function assertHarvestContained(path, repoRoot) {
  if (path.includes('\0') || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
    throw harvestInvalid(`the harvest path "${path}" escapes the repository root`);
  }
  if (repoRoot && escapesRepo(repoRoot, path)) {
    throw harvestInvalid(`the harvest path "${path}" resolves outside the repository root (symlink escape)`);
  }
}

// ---------------------------------------------------------------------------
// D5 — render each member's objective from its objectiveRef (containment + byte bound).
// ---------------------------------------------------------------------------

function renderObjective(repoRoot, member, salt) {
  const ref = member.objectiveRef;
  if (!repoRoot) throw objectiveRefInvalid(`the member "${member.role}" objectiveRef "${ref}" cannot be resolved (no repository root)`);
  if (escapesRepo(repoRoot, ref)) throw objectiveRefInvalid(`the member "${member.role}" objectiveRef "${ref}" escapes the repository root`);
  const target = resolve(repoRoot, ref);
  if (!existsSync(target)) throw objectiveRefInvalid(`the member "${member.role}" objectiveRef "${ref}" does not exist`);
  const text = readFileSync(target, 'utf8');
  if (Buffer.byteLength(text) > OBJECTIVE_REF_MAX_BYTES) {
    throw objectiveRefInvalid(`the member "${member.role}" objectiveRef "${ref}" is oversize (limit ${OBJECTIVE_REF_MAX_BYTES} bytes — D5)`);
  }
  // The salt line (`[attempt: <salt> <role>] `) mirrors createWaveDriver's own prefix
  // (wave-driver.mjs:334) so the wave's attempt marker rides the member's committed report and the
  // D4 harvest can attribute it (B2). The interpreter is the sole salt owner here (createWave does
  // not salt), so the wave starts with saltObjectives off implicitly (raw objective already salted).
  return `[attempt: ${salt} ${member.role}] ${text}`;
}

// ---------------------------------------------------------------------------
// D4 — harvest a path from the run's authoritative result sha (git object at the sha).
// ---------------------------------------------------------------------------

function gitShow(repoRoot, sha, path) {
  return execFileSync('git', ['show', `${sha}:${path}`], { cwd: repoRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

// resolveResultPin, inlined from wave.mjs:134-155 so the lane's transitive import graph stays
// node-builtins-only (W5 — no reachable module runs a top-level wave start).
function resolveResultPin(repoRoot, report, startedAtMs, excludeShas) {
  if (!repoRoot || typeof report !== 'string' || report.length === 0) return null;
  let pins;
  try {
    pins = execFileSync('git', ['for-each-ref', 'refs/baton/results/', '--format=%(objectname) %(committerdate:unix)'], { cwd: repoRoot, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)
      .map((row) => ({ sha: row.split(' ')[0], at: Number(row.split(' ')[1]) }))
      .filter((pin) => pin.at * 1000 >= startedAtMs - 60_000)
      .sort((left, right) => right.at - left.at);
  } catch { return null; }
  const excluded = new Set(excludeShas);
  for (const pin of pins) {
    if (excluded.has(pin.sha)) continue;
    try {
      execFileSync('git', ['cat-file', '-e', `${pin.sha}:${report}`], { cwd: repoRoot, stdio: 'ignore' });
      return pin.sha;
    } catch { /* pin does not carry this report path */ }
  }
  return null;
}

async function materializeSha(handle, member, repoRoot, startedAtMs, excludeShas) {
  // The authoritative result sha: the result section first (#99 accessor seam), then the preserved
  // result pin (docs/31 #6). Both yield a git-object sha the harvest reads with `git show`.
  try {
    const results = await handle.inspect({ depth: 'section', section: 'result' });
    const sha = results?.section?.items?.[0]?.value?.sha;
    if (RESULT_SHA.test(sha ?? '') && repoRoot) {
      try { execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: repoRoot, stdio: 'ignore' }); return sha; }
      catch { /* not a readable commit here — fall through to the pin resolver */ }
    }
  } catch { /* the result section can be empty post-stop */ }
  if (member?.report) return resolveResultPin(repoRoot, member.report, startedAtMs, excludeShas);
  return null;
}

// ---------------------------------------------------------------------------
// The lane's driver policy — configurable, pinned fast by the caller (F11).
// ---------------------------------------------------------------------------

const DEFAULT_DRIVER = Object.freeze({ pollIntervalMs: 15, stallTimeoutMs: 400, hardCapMs: 3000 });

function normalizeDriver(driver) {
  const base = driver && typeof driver === 'object' ? driver : {};
  const pollIntervalMs = Number.isSafeInteger(base.pollIntervalMs) && base.pollIntervalMs > 0 ? base.pollIntervalMs : DEFAULT_DRIVER.pollIntervalMs;
  const stallTimeoutMs = Number.isSafeInteger(base.stallTimeoutMs) && base.stallTimeoutMs > 0 ? base.stallTimeoutMs : DEFAULT_DRIVER.stallTimeoutMs;
  const hardCapMs = Number.isSafeInteger(base.hardCapMs) && base.hardCapMs > 0 ? base.hardCapMs : DEFAULT_DRIVER.hardCapMs;
  return { pollIntervalMs, stallTimeoutMs, hardCapMs };
}

const sleep = (ms) => new Promise((resolveSleep) => { setTimeout(resolveSleep, ms); });

// The run view the loop steers on: actions/approval live in inspect().outline; attention/nodes/
// scratchpad live in status().view. Read both and merge into one closed shape.
async function readView(handle, needStatus = false) {
  let insp = null;
  let stat = null;
  // inspect() carries phase/actions/attention/terminal — enough for approve/checkpoint/message/
  // signal/terminal. status() (taskId/workerId, decision options) is read ONLY when a policy needs
  // it (answerDecisions/elevateWhenNotes), so the common poll is one command, not two — the W3/W4
  // timing budgets stay inside the fast driver's hardCap even with a full member roster.
  if (needStatus) { try { stat = await handle.status(); } catch { /* the run may be mid-stop */ } }
  try { insp = await handle.inspect(); } catch { /* the run may be mid-stop */ }
  const io = insp?.outline ?? {};
  const so = stat?.view ?? stat ?? {};
  const phase = io.phase ?? so.phase ?? null;
  const actions = Array.isArray(io.actions) ? io.actions : (Array.isArray(so.nextActions) ? so.nextActions : []);
  const attention = Array.isArray(so.attention) ? so.attention : (Array.isArray(io.attention) ? io.attention : []);
  const workerId = so.scratchpad?.workerId
    ?? (Array.isArray(so.nextActions) ? so.nextActions.find((a) => typeof a?.workerId === 'string')?.workerId : null)
    ?? (Array.isArray(attention) ? attention.find((a) => typeof a?.workerId === 'string')?.workerId : null)
    ?? null;
  const taskId = (Array.isArray(so.nodes) ? so.nodes.find((n) => typeof n?.taskId === 'string')?.taskId : null) ?? null;
  const approveAction = Array.isArray(actions) ? actions.find((a) => a?.kind === 'approve_plan') : null;
  const planDigest = approveAction?.target?.planDigest ?? approveAction?.freshness?.planDigest
    ?? so.goal?.planDigest ?? so.plan?.planDigest ?? so.plan?.digest ?? so.planPreview?.planDigest
    ?? io.route?.planDigest ?? null;
  return {
    phase,
    actions,
    attention,
    taskId,
    workerId,
    planDigest,
    task: so.task ?? null,
    terminal: insp?.terminal === true || io.terminal === true || so.terminal === true || TERMINAL_PHASES.has(phase ?? ''),
    terminalStatus: so.terminalOutcome?.status ?? io.terminalOutcome?.status ?? null,
  };
}

const TERMINAL_PHASES = new Set(['work_completed', 'completed', 'result_ready', 'cancelled', 'failed', 'stopped', 'denied', 'closed']);
const isTerminal = (v) => v.terminal === true || TERMINAL_PHASES.has(v.phase ?? '') || v.terminalStatus === 'completed';

// answerDecisions match — exact literal first, then anchored regex; first-match-wins (F7b).
function matchDecision(policy, question) {
  for (const [pattern, value] of Object.entries(policy)) {
    if (pattern === question) return { pattern, value };
  }
  for (const [pattern, value] of Object.entries(policy)) {
    try { if (new RegExp(`^${pattern}$`, 'u').test(question ?? '')) return { pattern, value }; }
    catch { /* a non-regex pattern only ever matches literally, handled above */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The interpreter — validate, run the wave, drive the steering policies, harvest, receipt.
// ---------------------------------------------------------------------------

export async function runWorkflow(baton, specOrPath, options = {}) {
  if (!baton || typeof baton !== 'object' || !baton.waves || typeof baton.waves.start !== 'function') {
    throw workflowError('runWorkflow requires a Baton client facade with waves.start', 'workflow_facade_invalid');
  }
  const repoRoot = typeof options.repoRoot === 'string' && options.repoRoot.length > 0
    ? options.repoRoot
    : (typeof baton.repoRoot === 'string' && baton.repoRoot.length > 0 ? baton.repoRoot : null);
  const driver = normalizeDriver(options.driver);

  // JSON.parse-only loading (D2 — no eval, no Function, no import() of the spec path).
  let raw = specOrPath;
  if (typeof specOrPath === 'string') {
    let text;
    try { text = readFileSync(specOrPath, 'utf8'); }
    catch { throw specInvalid(`the workflow spec path "${specOrPath}" cannot be read`); }
    try { raw = JSON.parse(text); }
    catch { throw specInvalid(`the workflow spec at "${specOrPath}" is not valid JSON`); }
  }

  const spec = admitSpec(raw, repoRoot);
  const manifestDigest = createHash('sha256').update(canonicalJson(spec)).digest('hex');

  // Render every member's objective (D5 — objectiveRef → salt line). Salt owner is the interpreter.
  const salt = randomUUID();
  const rendered = spec.members.map((member) => {
    const renderedMember = {
      role: member.role,
      objective: renderObjective(repoRoot, member, salt),
      exact: { ...member.exact },
      scope: [...member.scope],
    };
    if (member.report !== undefined) renderedMember.report = member.report;
    return renderedMember;
  });

  // The wave provisions each member's worktree from a clean base commit; the worktree manager
  // refuses a dirty working tree (pinBaseSha's DirtyRepoError). The lane's objective/spec files are
  // written into the tree as inputs — commit the current working-tree state so the base is clean.
  // Local only (never pushed); result pins the D4 harvest reads are separate refs, unaffected.
  if (repoRoot) {
    try {
      execFileSync('git', ['add', '-A'], { cwd: repoRoot, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=Baton', '-c', 'user.email=baton@local', 'commit', '-q', '-m', `baton workflow base ${spec.idempotencyKey}`], { cwd: repoRoot, stdio: 'ignore' });
    } catch { /* nothing to commit, or commits unavailable — the wave will surface any real base issue */ }
  }

  // The pin-recovery lower bound is stamped BEFORE the wave starts (result pins commit after this),
  // with resolveResultPin's own 60 s grace covering the clock. The driver's hardCap budget, by
  // contrast, is stamped AFTER waves.start — starting + approving + provisioning a full member
  // roster's worktrees is itself wall-clock work that must not eat the members' drive-to-settle budget.
  const pinFloorMs = Date.now();
  const wave = await baton.waves.start({
    members: rendered,
    idempotencyKey: spec.idempotencyKey,
    // createWave approves + provisions each member's worktree synchronously at start (the shipped
    // wave/demo path); late per-member approval leaves the worktree unprovisioned. The
    // approveOnAdvertisedPlan policy receipts the advertised plan digest read from the run view.
    approve: true,
    repoRoot,
  });
  const waveId = wave.waveId;
  const memberByRole = new Map(spec.members.map((member) => [member.role, member]));
  const reportByRole = new Map(rendered.map((member) => [member.role, member.report ?? null]));

  const steering = [];
  const steeringState = {
    approved: new Set(), messaged: new Map(), msgAttempts: new Map(), msgDone: new Set(),
    elevated: new Set(), nudgedReqs: new Set(), nudgedRoles: new Set(), claimedRoles: new Set(),
    answeredKeys: new Set(), handledDecisionKeys: new Set(), signaled: false,
  };

  const startedAt = Date.now(); // the drive-to-settle budget starts once the roster is live.
  try {
    await driveLane(wave, spec, driver, startedAt, steering, steeringState, reportByRole);
  } finally {
    // guaranteed nothing: the loop is self-bounded; harvest happens below over the settled runs.
  }

  // Build outcomes: capture resultSha pre-close (reliable), terminal state post-close.
  const handles = wave.runs;
  const preOutcome = new Map();
  const excludeShas = [];
  for (const member of spec.members) {
    const handle = handles.get(member.role) ?? null;
    if (!handle) { preOutcome.set(member.role, { phase: 'failed', terminal: true, resultSha: null }); continue; }
    let view = null;
    try { view = await readView(handle); } catch { /* unreadable — settle at close */ }
    const resultSha = await materializeSha(handle, member, repoRoot, pinFloorMs, excludeShas);
    if (resultSha) excludeShas.push(resultSha);
    preOutcome.set(member.role, {
      phase: view?.phase ?? null,
      terminal: view ? isTerminal(view) : false,
      resultSha,
    });
  }

  let stopReceipt = null;
  try { stopReceipt = await wave.close({ reason: 'Workflow interpreter settled.' }); } catch { /* best effort */ }

  const outcomes = [];
  for (const member of spec.members) {
    const pre = preOutcome.get(member.role) ?? { phase: null, terminal: false, resultSha: null };
    let phase = pre.phase;
    let terminal = pre.terminal;
    if (!terminal) {
      const handle = handles.get(member.role) ?? null;
      if (handle) {
        try { const v = await readView(handle); phase = v.phase ?? phase; terminal = isTerminal(v); }
        catch { /* the stop made it terminal even if the post-read is unavailable */ terminal = true; phase = phase ?? 'stopped'; }
      }
    }
    const outcome = { role: member.role, phase, terminal, resultSha: pre.resultSha };
    if (member.report !== undefined) outcome.report = member.report;
    outcomes.push(outcome);
  }

  // D4 — harvest per path from the run's authoritative result sha, waveId-bound, marker-verified.
  const harvest = spec.harvest.paths.map((entry) => harvestOne(entry, repoRoot, salt, waveId, outcomes));

  const everySettled = outcomes.every((outcome) => outcome.terminal === true || outcome.phase === 'result_ready');
  const everyHarvested = harvest.every((entry) => entry.ok === true);
  const verdict = everySettled && everyHarvested ? 'WAVE-OK' : `WAVE-INCOMPLETE`;
  const basis = verdict === 'WAVE-OK' ? 'completed' : manifestDigest;

  void stopReceipt;
  // D6 — the receipt: EXACTLY the seven contract keys, in sorted order (F14).
  return {
    basis,
    harvest,
    manifestDigest,
    outcomes,
    steering,
    verdict,
    waveId,
  };
}

function harvestOne(entry, repoRoot, salt, waveId, outcomes) {
  const path = entry.path;
  // Containment: every harvest path is lexically + realpath contained (D4). Escape refuses the
  // whole run — but admission-time containment is validated at admitHarvest for structural escapes;
  // path/absolute escapes are re-guarded here defensively (the miss path never fabricates bytes).
  let recovered = null;
  if (repoRoot && !pathEscapes(repoRoot, path)) {
    for (const outcome of outcomes) {
      if (!outcome.resultSha) continue;
      try { const bytes = gitShow(repoRoot, outcome.resultSha, path); recovered = { resultSha: outcome.resultSha, bytes }; break; }
      catch { /* this sha does not carry the path */ }
    }
  }
  const base = { path, waveId };
  if (!recovered) {
    return { ...base, ok: false, missed: true, matched: false, code: 'harvest_miss', resultSha: null, bytes: null };
  }
  const { resultSha, bytes } = recovered;
  // A `mustContain` entry is the integrity-checked lane: the recovered content must carry THIS
  // wave's attempt marker (B2 — a parallel/killed wave's byte-similar pin cannot be attributed, F4)
  // AND satisfy the post-materialization substring check (B1 — never the selection mechanism). A
  // plain harvest path trusts the waveId-bound authoritative result sha and recovers on presence.
  if (entry.mustContain !== undefined) {
    const carriesMarker = bytes.includes(`[attempt: ${salt}`);
    if (!carriesMarker) {
      return { ...base, ok: false, missed: true, matched: false, code: 'harvest_miss', resultSha, bytes, actual: bytes };
    }
    if (!bytes.includes(entry.mustContain)) {
      return { ...base, ok: false, missed: true, matched: false, code: 'harvest_miss', resultSha, bytes, expected: entry.mustContain, actual: bytes };
    }
    materializeToDisk(repoRoot, path, bytes);
    return { ...base, ok: true, missed: false, matched: true, resultSha, bytes, expected: entry.mustContain, actual: bytes };
  }
  materializeToDisk(repoRoot, path, bytes);
  return { ...base, ok: true, missed: false, matched: true, resultSha, bytes, actual: bytes };
}

// The recovered authoritative content is materialized into the repo working tree (the bespoke
// drivers wrote their harvested deliverables to disk — run-dynamic-workflow.mjs:295). Best-effort.
function materializeToDisk(repoRoot, path, bytes) {
  if (!repoRoot || typeof bytes !== 'string') return;
  try {
    const target = resolve(repoRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  } catch { /* the receipt already carries the recovered bytes; disk materialization is additive */ }
}

function pathEscapes(repoRoot, path) {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0') || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) return true;
  return escapesRepo(repoRoot, path);
}

// The one control loop — poll each member, fire the steering policies, drive to settle. It is the
// GENERALIZED form of run-dynamic-workflow.mjs's steps 4-7, parameterized by the spec's policies.
async function driveLane(wave, spec, driver, startedAt, steering, s, reportByRole) {
  const st = spec.steering;
  const handles = wave.runs;
  const pending = new Set([...handles.keys()]);
  const doneRoles = new Set();
  const signalRoles = new Set(st.signalOnMembersDone?.roles ?? []);
  // status() carries the goal planDigest (approveOnAdvertisedPlan), decision options (answerDecisions),
  // the checkpoint attention (nudge/claim), and taskId/workerId (elevate). Pure messageOnSpawn /
  // signalOnMembersDone / no-steering waves poll inspect-only. Members poll in parallel, so even the
  // two-command read stays inside the fast driver's hardCap.
  const needStatus = Boolean(st.answerDecisions || st.elevateWhenNotes || st.approveOnAdvertisedPlan
    || st.nudgeOnCheckpoint || st.claimOnStall);

  async function processMember(role) {
    const handle = handles.get(role);
    if (!handle?.id) { pending.delete(role); return; }
    let v;
    try { v = await readView(handle, needStatus); } catch { return; }

    // 1. plan approval — createWave already approved + provisioned the worktree (approve:true). The
    // interpreter never re-approves (a second run.approve wedges the worktree). approveOnAdvertisedPlan
    // RECEIPTS the advertised plan digest (the digest the member was dispatched with), once per member.
    if (st.approveOnAdvertisedPlan && !s.approved.has(role) && v.planDigest) {
      s.approved.add(role);
      steering.push({ trigger: 'approveOnAdvertisedPlan', role, planDigest: v.planDigest });
    }

    // 2. messageOnSpawn — send on first-live; bounded ≤3 to a DELIVERED messageId (D3/F1).
    if (st.messageOnSpawn && !s.msgDone.has(role) && (v.phase === 'running' || v.task?.status === 'working' || s.approved.has(role))) {
      await pumpMessageOnSpawn(handle, role, st.messageOnSpawn, steering, s);
    }

    // 3. answerDecisions — match/validate/answer, defer on non-match, refuse on invalid optionId.
    const decision = Array.isArray(v.attention) ? v.attention.find((a) => a?.kind === 'answer_decision' && typeof a?.requestId === 'string') : null;
    if (st.answerDecisions && decision) {
      const key = `${handle.id}:${decision.requestId}`;
      if (!s.answeredKeys.has(key)) {
        s.answeredKeys.add(key);
        await answerDecision(handle, role, decision, st.answerDecisions.policy, steering, s, key);
      }
    }

    // 4. checkpoint — nudge (nudgeOnCheckpoint) then claim (claimOnStall), each once.
    const checkpoint = Array.isArray(v.attention) ? v.attention.find((a) => a?.kind === 'turn_checkpoint' && typeof a?.requestId === 'string') : null;
    if (checkpoint) await handleCheckpoint(handle, role, checkpoint, st, steering, s);

    // 5. elevateWhenNotes — read the worker tier, elevate once per (runId, role).
    if (st.elevateWhenNotes && !s.elevated.has(role)) await tryElevate(handle, role, v, st.elevateWhenNotes, steering, s);

    // 6. terminal detection.
    if (isTerminal(v)) { pending.delete(role); doneRoles.add(role); }
  }

  while (pending.size > 0 && Date.now() - startedAt < driver.hardCapMs) {
    await Promise.all([...pending].map((role) => processMember(role)));

    // 7. signalOnMembersDone — when the named roles are terminal, signal the remaining members.
    if (st.signalOnMembersDone && !s.signaled && signalRoles.size > 0
      && [...signalRoles].every((role) => doneRoles.has(role) || !handles.has(role))) {
      s.signaled = true;
      const message = st.signalOnMembersDone.message;
      const recipients = [...handles.keys()].filter((role) => !signalRoles.has(role));
      for (const role of recipients) {
        const handle = handles.get(role);
        try { await handle._command('run.message.send', { runId: handle.id, kind: message.kind, body: message.body }); }
        catch { /* the recipient may already be terminal — the signal is best-effort */ }
      }
      steering.push({ trigger: 'signalOnMembersDone', role: [...signalRoles][0], doneRoles: [...signalRoles], recipients });
    }

    // Early break: every remaining member is stuck on a decision the policy already handled
    // (deferred / refused). Waiting out the hard cap would only slow the suite.
    if (pending.size > 0 && [...pending].every((role) => s.handledDecisionKeys.size > 0 && roleStuckOnHandled(handles.get(role), role, s))) {
      break;
    }

    await sleep(driver.pollIntervalMs);
  }
}

function roleStuckOnHandled(handle, role, s) {
  // Cheap heuristic: the role has at least one decision key we handled with no answer (defer/refuse).
  for (const key of s.handledDecisionKeys) {
    if (key.startsWith(`${handle?.id}:`)) return true;
  }
  return false;
}

async function pumpMessageOnSpawn(handle, role, policy, steering, s) {
  // Burst the attempts while the member is live: a DELIVERED send (delivered > 0 with a hex
  // messageId, F1) stops immediately; a real-but-undelivered send (result 'sent', delivered 0 —
  // the deaf adapter's throw the coordinator counts {ok:false}) consumes one of ≤3 attempts; a
  // worker_spawning / not-ready reply defers WITHOUT consuming budget (retried next poll).
  for (;;) {
    if (s.msgDone.has(role)) return;
    const attempts = s.msgAttempts.get(role) ?? 0;
    if (attempts >= 3) return;
    let sent;
    try { sent = await handle._command('run.message.send', { runId: handle.id, kind: policy.kind, body: policy.body }); }
    catch { return; } // command rejection (worker not active) — defer, no budget consumed.
    const realAttempt = sent?.result === 'sent' || (sent?.ok !== false && typeof sent?.messageId === 'string');
    if (!realAttempt) return; // worker_spawning / deferred — retry on a later poll.
    if (typeof sent?.messageId === 'string' && Number.isFinite(sent?.delivered) && sent.delivered > 0) {
      s.msgDone.add(role);
      s.messaged.set(role, sent.messageId);
      steering.push({ trigger: 'messageOnSpawn', role, messageId: sent.messageId, delivered: sent.delivered });
      return;
    }
    const next = attempts + 1;
    s.msgAttempts.set(role, next);
    steering.push({ trigger: 'messageOnSpawn', role, messageId: typeof sent?.messageId === 'string' ? sent.messageId : null, delivered: 0 });
    if (next >= 3) {
      s.msgDone.add(role);
      // The named evidence line is NOT a messageOnSpawn attempt (no `trigger`) — it records that the
      // ≤3-attempt budget was exhausted without a delivery (D3/F1), keyed by `evidence` only.
      steering.push({ role, evidence: 'steering_message_undelivered' });
      return;
    }
    // else: still live and undelivered — burst the next attempt now.
  }
}

async function answerDecision(handle, role, decision, policy, steering, s, key) {
  const question = decision.question ?? decision.request?.question ?? null;
  const options = Array.isArray(decision.options) ? decision.options
    : (Array.isArray(decision.request?.options) ? decision.request.options : []);
  const allowFreeResponse = decision.allowFreeResponse === true || decision.request?.allowFreeResponse === true;
  const match = matchDecision(policy, question);
  if (!match || match.value === 'defer') {
    s.handledDecisionKeys.add(key);
    steering.push({ trigger: 'answerDecisions', role, requestId: decision.requestId, deferred: true, outcome: 'deferred' });
    return;
  }
  if (allowFreeResponse) {
    try { await handle.answer(decision.requestId, { text: match.value }); }
    catch { /* recorded below only on success */ }
    steering.push({ trigger: 'answerDecisions', role, requestId: decision.requestId, text: match.value, outcome: 'answered' });
    return;
  }
  const valid = options.some((option) => option?.id === match.value);
  if (!valid) {
    s.handledDecisionKeys.add(key);
    steering.push({ trigger: 'answerDecisions', role, requestId: decision.requestId, optionId: match.value, refused: true, outcome: 'refused' });
    return;
  }
  try { await handle.answer(decision.requestId, { optionId: match.value }); }
  catch { /* delivery raced a terminal member */ }
  steering.push({ trigger: 'answerDecisions', role, requestId: decision.requestId, optionId: match.value, outcome: 'answered' });
}

async function handleCheckpoint(handle, role, checkpoint, st, steering, s) {
  const rid = checkpoint.requestId;
  // A pausable member mints a fresh checkpoint requestId per re-park, so nudge dedup is keyed by
  // ROLE (nudge once), not requestId — then the next re-park is claimed (claimOnStall). A pure
  // claim policy (no nudgeOnCheckpoint) claims on the first claim-carrying checkpoint.
  const nudgeReady = st.nudgeOnCheckpoint && !s.nudgedRoles.has(role) && !s.claimedRoles.has(role);
  const claimReady = st.claimOnStall && !s.claimedRoles.has(role) && (s.nudgedRoles.has(role) || checkpoint.claim != null);
  if (nudgeReady && !(claimReady && !st.nudgeOnCheckpoint)) {
    s.nudgedReqs.add(rid);
    s.nudgedRoles.add(role);
    try { await handle.act('nudge_turn', { message: st.nudgeOnCheckpoint.message }); } catch { /* delivery best-effort */ }
    steering.push({ trigger: 'nudgeOnCheckpoint', role, requestId: rid });
    return;
  }
  if (claimReady) {
    s.claimedRoles.add(role);
    try { await handle.act('claim_turn', {}); } catch { /* claim is terminal on a stale checkpoint */ }
    steering.push({ trigger: 'claimOnStall', role, requestId: rid });
  }
}

async function tryElevate(handle, role, v, policy, steering, s) {
  const taskId = v.taskId;
  const workerId = v.workerId;
  if (!taskId || !workerId) return;
  let slice = null;
  try { slice = await handle._command('run.scratchpad.read', { runId: handle.id, scope: `worker:${workerId}`, cursor: 0 }); }
  catch { return; }
  const kinds = new Set(policy.kinds);
  const entries = (slice?.entries ?? []).filter((entry) => kinds.has(entry?.kind));
  if (entries.length === 0) return;
  const entryIds = entries.slice(0, policy.maxEntries).map((entry) => entry.entryId).filter(Boolean);
  if (entryIds.length === 0) return;
  let res;
  try { res = await handle._command('run.scratchpad.elevate', { runId: handle.id, taskId, entryIds }); }
  catch (error) { res = { ok: false, result: error?.code ?? 'scratchpad_elevate_error' }; }
  if (res?.ok === true) {
    // Success: dedup by (runId, role) — exactly once per member per wave, keyed durably.
    s.elevated.add(role);
    steering.push({ trigger: 'elevateWhenNotes', role, entryIds });
    return;
  }
  // Mid-flight elevation is refused until the member's task settles (scratchpad_settlement_not_ready)
  // — leave the dedup marker UNSET so the next poll (once terminal) retries. Other typed refusals
  // (write conflict / partition exhausted) consume a bounded ≤2 retry, then a named evidence line.
  if (res?.result === 'scratchpad_settlement_not_ready') return;
  const attempts = (s.msgAttempts.get(`elev:${role}`) ?? 0) + 1;
  s.msgAttempts.set(`elev:${role}`, attempts);
  if (attempts >= 2) {
    s.elevated.add(role);
    steering.push({ trigger: 'elevateWhenNotes', role, evidence: 'scratchpad_elevation_refused', code: res?.result ?? null });
  }
}

export default runWorkflow;
