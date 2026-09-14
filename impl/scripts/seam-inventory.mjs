#!/usr/bin/env node
// seam-inventory.mjs — issue #259, slice 0: the machine-checked seam map of the three runtime
// monoliths (impl/src/coordinator.mjs, impl/src/application.mjs, impl/src/coordination-store.mjs).
//
// Each file entangles four runtime concerns — admission (what may start), effect (what the
// runtime does to processes, worktrees, providers), observation (what is recorded and projected),
// and recovery (what restart reconciles) — behind one class, plus the surface that transports
// call into. Slice 0 changes no behavior: it only makes the entanglement *countable*, so the
// split slices can be reviewed against a committed map instead of prose.
//
//   node impl/scripts/seam-inventory.mjs           # check; findings on stderr, exit 1 when stale
//   node impl/scripts/seam-inventory.mjs --write   # regenerate impl/scripts/seam-inventory.json
//   node impl/scripts/seam-inventory.mjs --report  # per-seam counts + the entangled members
//
// Classification is by EVIDENCE, never by hand. Every class member (a top-level method_definition
// of the named class, extracted with @ast-grep/napi) is classified by, in order:
//
//   1. transport reachability — a member the file's own dispatcher calls, or the dispatcher
//      itself, is `surface`: it exists to carry a CLI/MCP/Web command into the runtime. This is
//      read off the source (the dispatcher's `this.<verb>(` call sites), not asserted by name.
//   2. authority + vocabulary rules — a call into an authority that *is* a seam: `_log.append` /
//      `_coordination` writes / ledger appends are observation; adapter verbs, process spawns,
//      filesystem mutation and worktree-manager calls are effect; guard, refusal and
//      authority-gate calls are admission; reconcile/replay/ledger-load paths are recovery. A
//      closed name-family dictionary backs this up for members whose shape is the evidence
//      (validate*/refusal* = admission, *Receipt/*Projection/read* = observation, ...).
//   3. delegation — a member that itself touches no authority but calls members already resolved
//      by 1–2 inherits their seam by majority. A helper that only forwards to recorders is part
//      of observation; this keeps the map from collapsing into "unclassified" helpers.
//
// A member none of the three layers can place lands in `surface` with the
// `surface:no_authority_touched` evidence — a named finding for split-time review, not a claim
// about its role.
//
// The member's seam is its STRONGEST evidence across layers 2-3, not the widest pile of it: a
// member that dispatches a worker and also logs it touches two authorities, and summing would let
// the ubiquitous recorder outvote the one act the member exists to perform. Ties fall through to
// SEAM_PRIORITY (the concern that must own the member: an effect that also logs is an effect
// member; a named reconcile/replay path outranks the effects it performs, which is why its name
// rule carries the highest weight). Evidence from *every* seam is retained, which is what makes an
// "entangled member" mechanical: a member whose evidence spans three or more seams.
//
// The catalogue is deliberately closed and textual. It answers "which authority does this member
// touch", not "is this member well factored" — the split's review is the second question, and
// docs/audits/2026-09-13-runtime-policy/seam-map.md carries the proposals.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Lang, parse } from '@ast-grep/napi';

/** Repo root, so the inventory's `file` fields stay root-relative and portable. */
export const REPO_ROOT_URL = new URL('../../', import.meta.url);
export const INVENTORY_PATH = fileURLToPath(new URL('./seam-inventory.json', import.meta.url));
export const SCHEMA_VERSION = 1;

export const SEAMS = Object.freeze(['admission', 'effect', 'observation', 'recovery', 'surface']);

// The concern that owns a member when two seams carry equally strong evidence. Effect first: a
// member whose strongest evidence is a real act (dispatch, spawn, kill, worktree or provider
// action) belongs to the seam a split must centralize — the recording and the checks ride along
// with the act. Recovery second for the same reason in the restart direction, which is why the
// restart_name rule carries the highest weight: a named reconcile/replay path is never overruled
// by the effects it performs. Admission then observation: a validator that only reads is still a
// decider, and a recorder that a transport happens to call is still a recorder.
export const SEAM_PRIORITY = Object.freeze(['effect', 'recovery', 'admission', 'observation', 'surface']);

// `dispatchers` are the members that carry a transport command into the class (found by reading
// the class: a command/act handler that maps a name to one of its own verbs). `surface` names the
// rest of the class's declared transport shape — the advertised card, the help text, and the
// caller-facing handle projection.
export const TARGETS = Object.freeze([
  Object.freeze({
    file: 'impl/src/coordinator.mjs', className: 'Coordinator',
    dispatchers: Object.freeze([]), surface: Object.freeze(['card', 'help', '_publicHandle']),
  }),
  Object.freeze({
    file: 'impl/src/application.mjs', className: 'BatonApplication',
    dispatchers: Object.freeze(['command', '_commandDispatch', 'act']), surface: Object.freeze(['card', 'help']),
  }),
  Object.freeze({
    file: 'impl/src/coordination-store.mjs', className: 'CoordinationStore',
    dispatchers: Object.freeze([]), surface: Object.freeze([]),
  }),
]);

// Layer 2a — authority rules. `name` matches the member's own identifier, `call` matches its body
// text. Weight is the rule's contribution to its seam's score: a strong, unambiguous authority
// call outranks a passing mention.
const AUTHORITY_RULES = Object.freeze([
  // ── recovery: restart reconciles what a prior process left behind ────────────
  { seam: 'recovery', id: 'restart_name', weight: 4, name: /(?:^|_|[a-z])(?:reconcile|recover|replay|startup|bootstrap|hydrate|reap|orphan|restore)|(?:preserved(?:session|continuation|resume|work|recovery|physical))|durable(?:recovery|replay|load|attempt)/iu, note: 'the member is a restart-time path by name' },
  { seam: 'recovery', id: 'reconcile_call', weight: 3, call: /(?:\b|_)(?:reconcile|replay|recover|restore|hydrate|resumeOrphans)[A-Za-z]*\(/u, note: 'calls another reconcile/replay path' },
  { seam: 'recovery', id: 'durable_load', weight: 3, call: /this\._load\(|this\._restoreProjectionCheckpoint\(|this\._readCanonicalLedger\(|_reloadProjection\(|beginStartupRecovery\(|_readSegmentState\(|_loadSegmentState\(|this\._openCanonicalOrderLedger\(/u, note: 'loads durable state back into a fresh process' },

  // ── effect: the runtime acts on the world ───────────────────────────────────
  { seam: 'effect', id: 'adapter_verb', weight: 3, call: /\.(?:spawn|prompt|steer|interrupt|kill|approve|answer)\(/u, note: 'drives a worker adapter verb' },
  { seam: 'effect', id: 'process_exec', weight: 3, call: /\b(?:execFileSync|execSync|spawnSync|execFile|fork)\(/u, note: 'executes a real process' },
  { seam: 'effect', id: 'filesystem_mutation', weight: 3, call: /\b(?:writeFileSync|appendFileSync|mkdirSync|rmSync|rmdirSync|unlinkSync|renameSync|chmodSync|symlinkSync|copyFileSync|cpSync|truncateSync|createWriteStream)\(/u, note: 'mutates the filesystem' },
  { seam: 'effect', id: 'worktree_authority', weight: 3, call: /this\._worktrees\.[A-Za-z]+\(|worktreeMod\.[A-Za-z]+\(|this\._worktrees\?\./u, note: 'drives the worktree manager' },
  { seam: 'effect', id: 'action_verb', weight: 3, name: /^_?(?:spawn|kill|interrupt|dispatch|deliver|respond|resume|publish|integrate|adopt|attach|detach|export|grant|revoke|orient|start|stop)/u, note: 'names a physical or provider action' },
  { seam: 'effect', id: 'action_name', weight: 2, name: /^_?(?:spawn|kill|interrupt|dispatch|deliver|materialize|preserve|publish|integrate|adopt|reattach|attach|detach|export|grant|revoke|orient|respond)[A-Z_]/u, note: 'performs or reverses a physical/provider action by name' },
  { seam: 'effect', id: 'capability_invoke', weight: 2, call: /(?:this\._capabilities|capabilities)\.(?:invoke|resume|reverify)\(/u, note: 'invokes a capability that owns its own effects' },
  { seam: 'effect', id: 'external_transport', weight: 2, call: /\bfetch\(|\bpublisher\(|\bgit\(\[|localGit\(/u, note: 'talks to a process, network, or git authority outside the runtime' },
  { seam: 'effect', id: 'worktree_capacity', weight: 2, call: /worktreeCapacity\.(?:reserve|release|commit|settle)/u, note: 'reserves or settles physical worktree capacity' },
  { seam: 'effect', id: 'timer_arm', weight: 1, call: /\bsetTimeout\(|\bsetInterval\(/u, note: 'arms a real timer' },

  // ── admission: what may start ───────────────────────────────────────────────
  { seam: 'admission', id: 'guard_name', weight: 3, name: /^_?(?:assert|validate|admit|refuse|preflight|preview)[A-Z_]|^_?(?:assert|validate|admit|refuse|preflight|preview)$|^_?(?:ensure|require|guard)[A-Z_]/u, note: 'the member exists to decide, by name' },
  { seam: 'admission', id: 'authority_check', weight: 3, call: /this\._withAuthorityOp\(|this\._acquireAuthorityOp\(|this\._authorityOps|\bauthorizeReplay\(|\bauthorize\(|capabilities\.includes\(|_attentionScopeAuthorized\(/u, note: 'consults an authority or capability gate' },
  { seam: 'admission', id: 'policy_gate', weight: 2, call: /withinConcurrencyCeiling|this\._fences|this\._drainState|_assertOperational\(|_assertReadable\(/u, note: 'checks a deployment policy or liveness fence before acting' },
  { seam: 'admission', id: 'refusal_name', weight: 2, name: /(?:Failure|Refusal)$/u, note: 'constructs a typed refusal' },
  { seam: 'admission', id: 'typed_refusal', weight: 2, call: /code: '(?:[a-z_]*_(?:refused|required|unauthorized|conflict|exhausted|invalid)|goal_plan_required|coordinator_draining)'/u, note: 'throws a typed refusal' },
  { seam: 'admission', id: 'normalize_name', weight: 2, name: /^_?(?:normaliz|deriv|resolv|select|configur|effectiv|evaluat|decid|determin|eligib|admissib)[a-z]*/iu, note: 'computes or normalizes an admission/dispatch decision' },
  { seam: 'admission', id: 'validation_vocabulary', weight: 1, name: /^_?(?:valid|check|verify)[A-Z_]|(?:admission|admissibility|eligibility)$/iu, note: 'validates or admits by name' },
  { seam: 'admission', id: 'predicate_name', weight: 1, name: /^_?(?:is|can|owns|has)[A-Z_]/u, note: 'a predicate admission consults' },

  // ── observation: what is recorded and projected ─────────────────────────────
  { seam: 'observation', id: 'log_append', weight: 3, call: /(?:_log|log)\.append\(/u, note: 'appends to the event log' },
  { seam: 'observation', id: 'coordination_authority', weight: 3, call: /_coordination\.[A-Za-z]+\(/u, note: 'reads or writes the durable coordination authority' },
  { seam: 'observation', id: 'store_append', weight: 3, call: /this\._appendBatch\(|this\._append\(|this\._appendFile\(|this\._writeSegment|this\._writeCanonicalReceipt\(|this\._notifyAppend\(/u, note: 'appends to the durable ledger' },
  { seam: 'observation', id: 'projection_name', weight: 2, name: /(?:Receipt|Projection|Snapshot|Status|View|Summary|History|Timeline|Evidence|Digest|Bytes|Rows|Cursor|Manifest|Settlement|Policy|Budget)$/u, note: 'projects durable state into a readable shape' },
  { seam: 'observation', id: 'record_name', weight: 2, name: /^_?(?:record|observe|emit|note|mint|project|render|report|bump|apply|expire|clear|notify|register|supersede|post|write|append|settle)/u, note: 'the member records or projects state by name' },
  { seam: 'observation', id: 'read_name', weight: 2, name: /^_?(?:read|load|list|inspect|describe|view|enumerate|collect|snapshot|seen|known|pending|active|current|historical)[A-Z_]|^_?(?:read|load|list|snapshot|status|health|summary)$/u, note: 'reads recorded state for a projection' },
  { seam: 'observation', id: 'ledger_name', weight: 2, name: /(?:ledger|canonicalorder|segment|checkpoint|projection|receipt)/iu, note: 'names the durable ledger or one of its projections' },
  { seam: 'observation', id: 'key_name', weight: 1, name: /(?:key|keys|targets|identity|at|for|rows|state)$/iu, note: 'derives a key, row, or target over recorded state' },
  { seam: 'observation', id: 'route_observation', weight: 2, call: /routeObservations\(|routeObservation\b|_route\.record\(|_recordUsage\(/u, note: 'records a route/usage observation' },
  { seam: 'observation', id: 'story_ingest', weight: 2, call: /story\.(?:record|ingest)\(|this\._project[A-Z]|_projection[A-Z]/u, note: 'feeds the story/projection authority' },
  { seam: 'observation', id: 'durable_read', weight: 1, call: /this\._coordination\.|coordination\.[A-Za-z]+\(/u, note: 'reads durable state for a projection' },
]);

// Layer 3 — delegation. A member that calls an already-resolved member of its own class inherits
// that seam, one vote per resolved callee. Rounds let a two-hop helper land; the bound keeps a
// call cycle from resolving forever.
const DELEGATION_WEIGHT = 1;
const DELEGATION_ROUNDS = 8;

function compileMatcher(rule) {
  return (member) => {
    if (rule.name) return rule.name.test(member.name);
    return rule.call.test(member.text);
  };
}

const COMPILED_RULES = Object.freeze(AUTHORITY_RULES.map((rule) => Object.freeze({ ...rule, matches: compileMatcher(rule) })));

// Two rules sharing an id would silently double-count one piece of evidence and make the committed
// artifact's rule names ambiguous. Refuse at load, never in a review.
if (new Set(AUTHORITY_RULES.map((rule) => rule.id)).size !== AUTHORITY_RULES.length) {
  throw new Error('seam-inventory: duplicate rule id in the authority catalogue');
}

/** Every top-level method of `className` in `source`, in source order. */
export function collectMembers(source, className) {
  const root = parse(Lang.JavaScript, source).root();
  const declaration = root
    .findAll({ rule: { kind: 'class_declaration' } })
    .find((node) => node.field('name')?.text() === className);
  if (!declaration) throw new Error(`seam-inventory: ${className} is not declared in this file`);
  const body = declaration.field('body');
  const members = [];
  for (const node of body.children()) {
    if (node.kind() !== 'method_definition') continue;
    const name = node.field('name')?.text();
    if (typeof name !== 'string' || name.length === 0) throw new Error(`seam-inventory: unnamed member in ${className}`);
    members.push({ name, line: node.range().start.line + 1, endLine: node.range().end.line + 1, text: node.text() });
  }
  if (members.length === 0) throw new Error(`seam-inventory: ${className} declares no members`);
  return members;
}

/** A member none of the three layers can place still lands in exactly one seam: `surface`, with
 * this evidence. That is a finding to re-evaluate at split time, never a claim about its role. */
export const FALLBACK_EVIDENCE = 'surface:no_authority_touched';

const SELF_CALL = /this\.([A-Za-z_$][A-Za-z0-9_$]*)\(/gu;

/** The same-class members this member calls. */
export function selfCalls(member) {
  const targets = new Set();
  for (const match of member.text.matchAll(SELF_CALL)) targets.add(match[1]);
  return targets;
}

function rankSeam(scores) {
  const ranked = [...SEAMS].sort((left, right) => (
    scores.get(right) - scores.get(left) || SEAM_PRIORITY.indexOf(left) - SEAM_PRIORITY.indexOf(right)
  ));
  return ranked[0];
}

/** Score `member` against the authority catalogue.
 *
 * The seam score is the STRONGEST signal, not the sum: a member that dispatches a worker and also
 * logs it touches two authorities, and summing would silently let the ubiquitous recorder
 * outvote the one act the member exists to perform. Breadth is what `evidence` records — it is
 * how entangled members are found later — while the score answers "which seam owns this member".
 * Ties fall through to SEAM_PRIORITY. */
export function scoreMember(member) {
  const scores = new Map(SEAMS.map((seam) => [seam, 0]));
  const evidence = [];
  for (const rule of COMPILED_RULES) {
    if (!rule.matches(member)) continue;
    scores.set(rule.seam, Math.max(scores.get(rule.seam), rule.weight));
    evidence.push(`${rule.seam}:${rule.id}`);
  }
  return { scores, evidence };
}

/** Members the class's own dispatcher calls: the transport shape, read off the source. */
export function dispatchedMembers(members, dispatchers) {
  const known = new Set(members.map((member) => member.name));
  const reached = new Set();
  for (const member of members) {
    if (!dispatchers.includes(member.name)) continue;
    for (const target of selfCalls(member)) if (known.has(target)) reached.add(target);
  }
  return reached;
}

/**
 * Classify every member of one class: transport reachability first, then the authority catalogue,
 * then delegation among the members those two layers left unresolved.
 */
export function classifyMembers(members, { dispatchers = [], surface = [] } = {}) {
  const scored = members.map((member) => ({ member, ...scoreMember(member) }));
  const byName = new Map(scored.map((row) => [row.member.name, row]));
  const dispatched = dispatchedMembers(members, dispatchers);
  const resolved = new Map();
  for (const row of scored) {
    if (row.evidence.length > 0) resolved.set(row.member.name, rankSeam(row.scores));
  }
  for (const row of scored) {
    const name = row.member.name;
    const transport = dispatchers.includes(name) || surface.includes(name) || dispatched.has(name);
    if (!transport) continue;
    row.transport = true;
    row.evidence.push('surface:transport_dispatch');
    row.scores.set('surface', row.scores.get('surface') + 5);
    resolved.set(name, 'surface');
  }
  // Delegation runs in rounds so a two-hop helper still lands: every round, an unresolved member
  // votes with the seams its already-resolved callees carry. The set of resolved members only
  // grows, so the loop terminates; DELEGATION_ROUNDS bounds it even if a call cycle never does.
  for (let round = 0; round < DELEGATION_ROUNDS; round += 1) {
    const resolving = [];
    for (const row of scored) {
      if (row.transport || row.evidence.length > 0) continue;
      const votes = new Map();
      for (const target of selfCalls(row.member)) {
        const seam = resolved.get(target);
        if (seam === undefined) continue;
        votes.set(seam, (votes.get(seam) ?? 0) + 1);
      }
      if (votes.size > 0) resolving.push({ row, votes });
    }
    if (resolving.length === 0) break;
    for (const { row, votes } of resolving) {
      for (const [seam, count] of votes) {
        row.scores.set(seam, row.scores.get(seam) + count * DELEGATION_WEIGHT);
        row.evidence.push(`delegates:${seam}`);
      }
      resolved.set(row.member.name, rankSeam(row.scores));
    }
  }
  return scored.map((row) => {
    const { name, line, endLine } = row.member;
    // `endLine` rides along so "the largest member" in a review is read off the artifact rather
    // than re-parsed from the source.
    if (row.evidence.length === 0) return { name, line, endLine, seam: 'surface', evidence: [FALLBACK_EVIDENCE] };
    return { name, line, endLine, seam: rankSeam(row.scores), evidence: [...row.evidence] };
  });
}

/** The committed artifact: one entry per class member, in source order. */
export function collectSeamInventory() {
  const files = [];
  for (const target of TARGETS) {
    const source = readFileSync(fileURLToPath(new URL(target.file, REPO_ROOT_URL)), 'utf8');
    const members = collectMembers(source, target.className);
    files.push({
      file: target.file,
      class: target.className,
      members: classifyMembers(members, { dispatchers: target.dispatchers, surface: target.surface }),
    });
  }
  return { schemaVersion: SCHEMA_VERSION, generatedBy: 'impl/scripts/seam-inventory.mjs', seams: [...SEAMS], files };
}

export function renderSeamInventory(inventory) {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

export function writeSeamInventory() {
  const inventory = collectSeamInventory();
  writeFileSync(INVENTORY_PATH, renderSeamInventory(inventory));
  return inventory;
}

/** Parse the committed artifact; `{ error }` keeps a corrupt file a finding, not a crash. */
function parseCommitted(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return { error: error.message };
  }
}

/** Compare the committed artifact with a fresh regeneration. Findings are human-readable. */
export function checkSeamInventory({ path = INVENTORY_PATH } = {}) {
  const findings = [];
  let committed;
  try {
    committed = parseCommitted(readFileSync(path, 'utf8'));
  } catch (error) {
    return [`committed inventory is unreadable: ${error.message} (run --write)`];
  }
  if (committed.error) return [`committed inventory is not JSON: ${committed.error} (run --write)`];
  const fresh = collectSeamInventory();
  // A member is a DEFINITION, so the key carries its line: Coordinator genuinely declares two
  // `_removeTaskWorktree` methods (8999 and 9116) and a name-keyed index would report the second
  // as the first having moved.
  const identity = (file, member) => `${file}#${member.line}#${member.name}`;
  const committedIndex = new Map((committed.files ?? []).flatMap((file) => (file.members ?? []).map((member) => [identity(file.file, member), member])));
  const freshIndex = new Map(fresh.files.flatMap((file) => file.members.map((member) => [identity(file.file, member), member])));
  for (const [key, member] of committedIndex) {
    if (!freshIndex.has(key)) findings.push(`${key.split('#')[0]}:${member.line}: ${member.name} is committed but no longer exists (run --write)`);
  }
  for (const file of fresh.files) {
    for (const member of file.members) {
      const prior = committedIndex.get(identity(file.file, member));
      if (!prior) { findings.push(`${file.file}:${member.line}: ${member.name} is uncommitted (run --write)`); continue; }
      if (prior.seam !== member.seam) findings.push(`${file.file}:${member.line}: ${member.name} is committed as ${prior.seam} but classifies as ${member.seam} (run --write)`);
      else if (JSON.stringify(prior.evidence) !== JSON.stringify(member.evidence)) findings.push(`${file.file}:${member.line}: ${member.name} evidence drifted (run --write)`);
      else if (prior.endLine !== member.endLine) findings.push(`${file.file}:${member.line}: ${member.name} ends at line ${member.endLine}, not the committed ${prior.endLine} (run --write)`);
    }
  }
  // A member that moved keeps its identity only when its line moved with it — the pass above
  // reports every definition whose line moved as uncommitted + vanished, which is the honest pair.
  if (findings.length === 0 && renderSeamInventory(committed) !== renderSeamInventory(fresh)) {
    findings.push('committed inventory does not match a fresh regeneration (run --write)');
  }
  return findings;
}

/** Per-seam tallies plus the members whose evidence crosses three or more seams. */
export function summarizeSeamInventory(inventory) {
  const counts = Object.fromEntries(SEAMS.map((seam) => [seam, 0]));
  const perFile = [];
  const entangled = [];
  for (const file of inventory.files) {
    const fileCounts = Object.fromEntries(SEAMS.map((seam) => [seam, 0]));
    for (const member of file.members) {
      counts[member.seam] += 1;
      fileCounts[member.seam] += 1;
      const seams = [...new Set(member.evidence.map((entry) => entry.slice(0, entry.indexOf(':'))))];
      if (seams.length >= 3) entangled.push({ file: file.file, name: member.name, line: member.line, seam: member.seam, seams });
    }
    perFile.push({ file: file.file, class: file.class, counts: fileCounts, total: file.members.length });
  }
  entangled.sort((left, right) => right.seams.length - left.seams.length || left.file.localeCompare(right.file) || left.line - right.line);
  return { counts, perFile, entangled };
}

export function runSeamInventoryMain(argv) {
  if (argv.includes('--write')) {
    const inventory = writeSeamInventory();
    process.stdout.write(`seam-inventory: wrote ${INVENTORY_PATH} (${inventory.files.reduce((sum, file) => sum + file.members.length, 0)} members)\n`);
    return 0;
  }
  if (argv.includes('--report')) {
    const { counts, perFile, entangled } = summarizeSeamInventory(collectSeamInventory());
    process.stdout.write(`${JSON.stringify({ counts, perFile, entangled: entangled.length }, null, 2)}\n`);
    for (const row of entangled) process.stdout.write(`entangled(${row.seams.length}) ${row.file}:${row.line} ${row.name} -> ${row.seam} [${row.seams.join(', ')}]\n`);
    return 0;
  }
  const findings = checkSeamInventory();
  for (const finding of findings) process.stderr.write(`seam-inventory: ${finding}\n`);
  if (findings.length > 0) return 1;
  process.stdout.write('seam-inventory: ok\n');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runSeamInventoryMain(process.argv.slice(2)));
}
