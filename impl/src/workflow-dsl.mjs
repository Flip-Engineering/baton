// workflow-dsl.mjs — the #170 wavefile compiler (the line-oriented authoring surface over the
// closed #114 workflow spec).
//
// Authority: docs/reference/evidence/workflow-dsl-2026-08-13/workflow-dsl-contract.md v2 FOLDED.
// The 16-directive line grammar lowers to the interpreter's closed field set (`admitSpec` input) —
// it does NOT extend it. The compiler is a pure function of the text given `repoRoot`: no eval, no
// Function, no dynamic import, no file READS; the only filesystem syscall is the repoRoot-gated
// harvest realpath containment (realpathSync, used exclusively to detect a symlink escape). Every
// refusal carries the #160 {line, field, expected} triple on the error AND the wire `detail` leg.
// Importing this module runs NOTHING (no top-level await, no wave start, no side effects).
//
// This module is self-contained: it imports only node builtins, never the interpreter or another
// lane module, so it cannot drag a top-level side effect into the surface import graph.

import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

// ---------------------------------------------------------------------------
// Closed constants (byte-identical to workflow-interpreter.mjs:40-46 — the S5 source-scan pin).
// ---------------------------------------------------------------------------

const MAX_MEMBERS = 64;
const MAX_SCOPE = 64;
const GLOB_MAGIC = /[*?[\]{}!+@]/u;
const MESSAGE_KINDS = new Set(['inform', 'query', 'steer', 'brief', 'result']);
const SCRATCHPAD_KINDS = new Set(['doubt', 'link', 'note', 'plan']);
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

// The closed refusal family (G5) — the interpreter's own admission-time codes, never a 6th.
const CODE_SPEC = 'workflow_spec_invalid';
const CODE_MEMBER = 'workflow_member_invalid';
const CODE_STEERING = 'workflow_steering_unknown';
const CODE_HARVEST = 'workflow_harvest_invalid';

// ---------------------------------------------------------------------------
// The 16-directive closed registry (D1 / D4 generated-docs source).
// ---------------------------------------------------------------------------

export const WAVEFILE_DIRECTIVES = Object.freeze({
  wave: { arity: 1, tokens: ['<key>'], field: 'idempotencyKey' },
  member: { arity: 1, tokens: ['<role>'], field: 'members[].role' },
  harness: { arity: 1, tokens: ['<value>'], field: 'members[].exact.harness' },
  model: { arity: 1, tokens: ['<value>'], field: 'members[].exact.model' },
  effort: { arity: 1, tokens: ['<value>'], field: 'members[].exact.effort' },
  scope: { arity: 1, tokens: ['<path>'], field: 'members[].scope' },
  objectiveRef: { arity: 1, tokens: ['<path>'], field: 'members[].objectiveRef' },
  report: { arity: 1, tokens: ['<path>'], field: 'members[].report' },
  approveOnAdvertisedPlan: { arity: '0–1', tokens: ['true|false'], field: 'steering.approveOnAdvertisedPlan' },
  claimOnStall: { arity: '0–1', tokens: ['true|false'], field: 'steering.claimOnStall' },
  nudgeOnCheckpoint: { arity: 1, tokens: ['"<message>"'], field: 'steering.nudgeOnCheckpoint.message' },
  messageOnSpawn: { arity: 2, tokens: ['<kind>', '"<body>"'], field: 'steering.messageOnSpawn', enum: 'MESSAGE_KINDS' },
  elevateWhenNotes: { arity: 2, tokens: ['<kinds>', '<maxEntries>'], field: 'steering.elevateWhenNotes', enum: 'SCRATCHPAD_KINDS' },
  answerDecisions: { arity: 2, tokens: ['"<pattern>"', '"<value>"'], field: 'steering.answerDecisions.policy' },
  signalOnMembersDone: { arity: 3, tokens: ['<roles>', '<kind>', '"<message>"'], field: 'steering.signalOnMembersDone', enum: 'MESSAGE_KINDS' },
  harvest: { arity: '1–2', tokens: ['<path>', 'mustContain "<text>"'], field: 'harvest.paths[]' },
});

const DIRECTIVE_NAMES = new Set(Object.keys(WAVEFILE_DIRECTIVES));
const CLOSED_LIST = '<closed directive list>';
const STEERING_DIRECTIVES = new Set([
  'approveOnAdvertisedPlan', 'claimOnStall', 'nudgeOnCheckpoint', 'messageOnSpawn',
  'elevateWhenNotes', 'answerDecisions', 'signalOnMembersDone',
]);
const MEMBER_SUB_FIELDS = new Set(['harness', 'model', 'effort', 'objectiveRef', 'report']);

// ---------------------------------------------------------------------------
// Refusal construction (D2 — the #160 triple on the error AND the wire detail leg).
// ---------------------------------------------------------------------------

function refuse(code, line, field, expected, message) {
  return Object.assign(new TypeError(message), {
    code, line, field, expected, detail: { line, field, expected },
  });
}

// ---------------------------------------------------------------------------
// Lexical layer (D1): logical lines + tokens.
// ---------------------------------------------------------------------------

function unescapedQuoteCount(value) {
  let count = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '\\') { i += 1; continue; }
    if (value[i] === '"') count += 1;
  }
  return count;
}

// Split into logical lines (continuation-joined). A trailing `\` outside a double-quoted string
// joins with the next line (the `\` + newline become a single space); the line leg of a refusal is
// the FIRST physical line of its logical group.
function logicalLines(text) {
  const physical = text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  const lines = [];
  let buf = '';
  let startLine = 1;
  for (let i = 0; i < physical.length; i += 1) {
    const raw = physical[i];
    const no = i + 1;
    if (buf === '') startLine = no;
    let cut = raw.length;
    let end = raw.length;
    while (end > 0 && /\s/u.test(raw[end - 1])) end -= 1;
    let continues = false;
    if (end > 0 && raw[end - 1] === '\\') {
      const open = (unescapedQuoteCount(buf) + unescapedQuoteCount(raw.slice(0, end - 1))) % 2 === 1;
      if (!open) { continues = true; cut = end - 1; }
    }
    buf += (buf === '' ? '' : ' ') + raw.slice(0, cut);
    if (!continues) { lines.push({ line: startLine, text: buf }); buf = ''; }
  }
  if (buf !== '') lines.push({ line: startLine, text: buf });
  return lines;
}

// Tokenize one logical line into bare / double-quoted tokens (escapes: \" \\ \n \t \uXXXX).
// A `#` outside a quote is a trailing-comment refusal (D1 — no trailing comments), never silent.
function tokenize(text, line) {
  const tokens = [];
  let directive = null;
  let i = 0;
  const n = text.length;
  const fieldOf = () => directive ?? '<directive>';
  while (i < n) {
    const ch = text[i];
    if (/\s/u.test(ch)) { i += 1; continue; }
    if (ch === '#') {
      throw refuse(CODE_SPEC, line, fieldOf(), 'end of line',
        `wavefile line ${line}: a trailing "#" is not a comment — expected end of line`);
    }
    if (ch === '"') {
      let value = '';
      i += 1;
      let closed = false;
      while (i < n) {
        const c = text[i];
        if (c === '"') { closed = true; i += 1; break; }
        if (c === '\\') {
          const esc = text[i + 1];
          if (esc === '"') { value += '"'; i += 2; }
          else if (esc === '\\') { value += '\\'; i += 2; }
          else if (esc === 'n') { value += '\n'; i += 2; }
          else if (esc === 't') { value += '\t'; i += 2; }
          else if (esc === 'u') {
            const hex = text.slice(i + 2, i + 6);
            if (!/^[0-9a-fA-F]{4}$/u.test(hex)) {
              throw refuse(CODE_SPEC, line, fieldOf(), 'valid escape',
                `wavefile line ${line}: invalid unicode escape — expected \\uXXXX`);
            }
            value += String.fromCharCode(parseInt(hex, 16));
            i += 6;
          } else {
            throw refuse(CODE_SPEC, line, fieldOf(), 'valid escape',
              `wavefile line ${line}: invalid escape — expected \\" \\\\ \\n \\t or \\uXXXX`);
          }
        } else { value += c; i += 1; }
      }
      if (!closed) {
        throw refuse(CODE_SPEC, line, fieldOf(), '"closing quote"',
          `wavefile line ${line}: unterminated string — expected a closing quote`);
      }
      tokens.push(value);
      if (directive === null) directive = value;
      continue;
    }
    const start = i;
    while (i < n && !/\s/u.test(text[i]) && text[i] !== '"' && text[i] !== '#') i += 1;
    const raw = text.slice(start, i);
    if (raw.length > 0) { tokens.push(raw); if (directive === null) directive = raw; }
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Path validation (mirrors workflow-interpreter.mjs:99-125 / 186-203 / 320-327).
// ---------------------------------------------------------------------------

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
      if (parent === current) return resolved;
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

function validateScopeEntry(entry, line) {
  if (typeof entry !== 'string' || entry.length === 0 || entry.includes('\0')
    || entry.startsWith('/') || entry.includes('\\') || entry.split('/').includes('..')) {
    throw refuse(CODE_MEMBER, line, 'scope', 'non-empty scope',
      `wavefile line ${line}: scope entry escapes the member scope class`);
  }
  if (!GLOB_MAGIC.test(entry)) {
    const trimmed = entry.replace(/\/+$/u, '');
    const base = trimmed.split('/').pop() ?? '';
    if (!base.includes('.')) {
      throw refuse(CODE_MEMBER, line, 'scope', '"<dir>/**"',
        `wavefile line ${line}: scope entry names a bare directory — use "${trimmed}/**"`);
    }
  }
}

function validateHarvestPath(path, line, field, repoRoot) {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0')
    || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
    throw refuse(CODE_HARVEST, line, field, 'non-empty path in the repo path class',
      `wavefile line ${line}: harvest path escapes the repository root`);
  }
  if (repoRoot && escapesRepo(repoRoot, path)) {
    throw refuse(CODE_HARVEST, line, field, 'non-empty path in the repo path class',
      `wavefile line ${line}: harvest path resolves outside the repository root (symlink escape)`);
  }
}

// ---------------------------------------------------------------------------
// Parse state + the directive dispatch (D1 placement rules).
// ---------------------------------------------------------------------------

function requireArg(tokens, index, line, field) {
  if (tokens[index] === undefined) {
    throw refuse(CODE_SPEC, line, field, `<${field}> arguments`,
      `wavefile line ${line}: ${field} is missing its argument`);
  }
  return tokens[index];
}

function closeCurrentMember(state) {
  const member = state.current;
  if (!member) return;
  state.current = null;
  // R2 (fold): missing-field refusal names the FIRST missing field in fixed order.
  if (!member.harness) throw refuse(CODE_MEMBER, member.line, 'exact.harness', 'harness|model|effort',
    `wavefile line ${member.line}: member ${member.role} is missing its harness route field`);
  if (!member.model) throw refuse(CODE_MEMBER, member.line, 'exact.model', 'harness|model|effort',
    `wavefile line ${member.line}: member ${member.role} is missing its model route field`);
  if (!member.effort) throw refuse(CODE_MEMBER, member.line, 'exact.effort', 'harness|model|effort',
    `wavefile line ${member.line}: member ${member.role} is missing its effort route field`);
  if (!member.objectiveRef) throw refuse(CODE_MEMBER, member.line, 'objectiveRef', 'non-empty objectiveRef',
    `wavefile line ${member.line}: member ${member.role} is missing its objectiveRef`);
  const scope = member.scope.length > 0 ? [...member.scope]
    : (state.waveScope.length > 0 ? [...state.waveScope] : null);
  if (!scope) {
    throw refuse(CODE_MEMBER, member.line, `member ${member.role}`, 'non-empty scope',
      `wavefile line ${member.line}: member ${member.role} has no scope and no wave default`);
  }
  if (scope.length > MAX_SCOPE || new Set(scope).size !== scope.length) {
    throw refuse(CODE_MEMBER, member.line, 'scope', 'non-empty scope',
      `wavefile line ${member.line}: member ${member.role} scope must be a unique bounded array`);
  }
  const normalized = {
    role: member.role,
    exact: { harness: member.harness, model: member.model, effort: member.effort },
    scope,
    objectiveRef: member.objectiveRef,
  };
  if (member.report !== null) normalized.report = member.report;
  state.members.push(normalized);
}

function dispatch(directive, tokens, line, state, repoRoot) {
  const args = tokens.slice(1);
  if (directive === 'wave') {
    if (state.key !== null) {
      throw refuse(CODE_SPEC, line, 'wave', 'end of line', 'the wave directive may appear once, at the top');
    }
    const key = requireArg(tokens, 1, line, 'wave');
    if (tokens.length !== 2) throw refuse(CODE_SPEC, line, 'wave', 'wave <key>', 'the wave directive takes one key');
    if (!IDEMPOTENCY_PATTERN.test(key)) {
      throw refuse(CODE_SPEC, line, 'idempotencyKey', '<IDEMPOTENCY_PATTERN>',
        'the wave idempotency key must match the closed identifier pattern');
    }
    state.key = key;
    return;
  }

  if (directive === 'member') {
    closeCurrentMember(state);
    const role = requireArg(tokens, 1, line, 'member');
    if (tokens.length !== 2) throw refuse(CODE_SPEC, line, 'member', 'member <role>', 'the member directive takes one role');
    if (role.length === 0) {
      throw refuse(CODE_MEMBER, line, 'member ', 'non-empty role', `wavefile line ${line}: member role is empty`);
    }
    if (role === 'work') {
      throw refuse(CODE_MEMBER, line, `member ${role}`, 'non-empty role', `wavefile line ${line}: member role "work" is reserved`);
    }
    if (state.members.some((m) => m.role === role)) {
      throw refuse(CODE_MEMBER, line, `member ${role}`, 'unique role', `wavefile line ${line}: member role is duplicated`);
    }
    state.memberStarted = true;
    state.current = { role, line, harness: null, model: null, effort: null, objectiveRef: null, report: null, scope: [] };
    return;
  }

  if (MEMBER_SUB_FIELDS.has(directive)) {
    if (!state.current) {
      throw refuse(CODE_MEMBER, line, directive, 'member <role>',
        `wavefile line ${line}: ${directive} must follow an open member`);
    }
    const value = requireArg(tokens, 1, line, directive);
    if (tokens.length !== 2) throw refuse(CODE_SPEC, line, directive, `${directive} <value>`, `wavefile line ${line}: ${directive} takes one value`);
    if (directive === 'report') {
      if (value.length === 0) throw refuse(CODE_MEMBER, line, 'report', 'non-empty path', `wavefile line ${line}: report must be a non-empty path`);
      state.current.report = value;
    } else if (directive === 'objectiveRef') {
      state.current.objectiveRef = value;
    } else {
      state.current[directive] = value;
    }
    return;
  }

  if (directive === 'scope') {
    const path = requireArg(tokens, 1, line, 'scope');
    if (tokens.length !== 2) throw refuse(CODE_SPEC, line, 'scope', 'scope <path>', `wavefile line ${line}: scope takes one path`);
    validateScopeEntry(path, line);
    if (state.current) {
      state.current.scope.push(path);
    } else if (!state.memberStarted) {
      state.waveScope.push(path);
    } else {
      throw refuse(CODE_MEMBER, line, 'scope', 'member', `wavefile line ${line}: scope after the last member must name an open member`);
    }
    return;
  }

  if (directive === 'approveOnAdvertisedPlan' || directive === 'claimOnStall') {
    closeCurrentMember(state);
    let value = true;
    if (args.length === 1) {
      if (args[0] === 'true') value = true;
      else if (args[0] === 'false') value = false;
      else throw refuse(CODE_STEERING, line, directive, 'true|false', `wavefile line ${line}: ${directive} takes true|false`);
    } else if (args.length !== 0) {
      throw refuse(CODE_STEERING, line, directive, 'true|false', `wavefile line ${line}: ${directive} takes at most one boolean`);
    }
    state.steering[directive] = value;
    return;
  }

  if (directive === 'nudgeOnCheckpoint') {
    closeCurrentMember(state);
    const message = requireArg(tokens, 1, line, directive);
    if (tokens.length !== 2) throw refuse(CODE_SPEC, line, directive, 'nudgeOnCheckpoint "<message>"', `wavefile line ${line}: ${directive} takes one message`);
    state.steering.nudgeOnCheckpoint = { message };
    return;
  }

  if (directive === 'messageOnSpawn') {
    closeCurrentMember(state);
    const kind = requireArg(tokens, 1, line, directive);
    const body = requireArg(tokens, 2, line, directive);
    if (tokens.length !== 3) throw refuse(CODE_SPEC, line, directive, 'messageOnSpawn <kind> "<body>"', `wavefile line ${line}: ${directive} takes a kind and a body`);
    if (!MESSAGE_KINDS.has(kind)) {
      throw refuse(CODE_STEERING, line, 'messageOnSpawn.kind', 'inform|query|steer|brief|result',
        `wavefile line ${line}: messageOnSpawn kind must be one of inform|query|steer|brief|result`);
    }
    state.steering.messageOnSpawn = { kind, body };
    return;
  }

  if (directive === 'elevateWhenNotes') {
    closeCurrentMember(state);
    const kindsTok = requireArg(tokens, 1, line, directive);
    const maxTok = requireArg(tokens, 2, line, directive);
    if (tokens.length !== 3) throw refuse(CODE_SPEC, line, directive, 'elevateWhenNotes <kinds> <maxEntries>', `wavefile line ${line}: ${directive} takes kinds and maxEntries`);
    const kinds = kindsTok.split(',');
    for (const kind of kinds) {
      if (!SCRATCHPAD_KINDS.has(kind)) {
        throw refuse(CODE_STEERING, line, 'elevateWhenNotes.kinds', 'doubt|link|note|plan',
          `wavefile line ${line}: elevateWhenNotes kind must be one of doubt|link|note|plan`);
      }
    }
    const maxEntries = Number(maxTok);
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      throw refuse(CODE_STEERING, line, 'elevateWhenNotes.maxEntries', 'positive integer',
        `wavefile line ${line}: elevateWhenNotes maxEntries must be a positive integer`);
    }
    state.steering.elevateWhenNotes = { kinds, maxEntries };
    return;
  }

  if (directive === 'answerDecisions') {
    closeCurrentMember(state);
    const pattern = requireArg(tokens, 1, line, directive);
    const value = requireArg(tokens, 2, line, directive);
    if (tokens.length !== 3) throw refuse(CODE_SPEC, line, directive, 'answerDecisions "<pattern>" "<value>"', `wavefile line ${line}: ${directive} takes a pattern and a value`);
    if (value.length === 0) {
      throw refuse(CODE_STEERING, line, 'answerDecisions.policy', 'non-empty value', `wavefile line ${line}: answerDecisions value must be non-empty`);
    }
    state.answerPolicy[pattern] = value;
    return;
  }

  if (directive === 'signalOnMembersDone') {
    closeCurrentMember(state);
    const rolesTok = requireArg(tokens, 1, line, directive);
    const kind = requireArg(tokens, 2, line, directive);
    const message = requireArg(tokens, 3, line, directive);
    if (tokens.length !== 4) throw refuse(CODE_SPEC, line, directive, 'signalOnMembersDone <roles> <kind> "<message>"', `wavefile line ${line}: ${directive} takes roles, a kind, and a message`);
    if (!MESSAGE_KINDS.has(kind)) {
      throw refuse(CODE_STEERING, line, 'signalOnMembersDone.message.kind', 'inform|query|steer|brief|result',
        `wavefile line ${line}: signalOnMembersDone kind must be one of inform|query|steer|brief|result`);
    }
    state.steering.signalOnMembersDone = { roles: rolesTok.split(','), message: { kind, body: message } };
    state.signalOnMembersDoneLine = line;
    return;
  }

  if (directive === 'harvest') {
    closeCurrentMember(state);
    const path = requireArg(tokens, 1, line, directive);
    let mustContain = null;
    if (args.length === 1) {
      mustContain = null;
    } else if (args.length === 3 && args[1] === 'mustContain') {
      mustContain = args[2];
    } else {
      throw refuse(CODE_SPEC, line, directive, 'harvest <path> [mustContain "<text>"]', `wavefile line ${line}: ${directive} takes a path and an optional mustContain text`);
    }
    const field = `harvest.paths[${state.harvest.length}]`;
    validateHarvestPath(path, line, field, repoRoot);
    state.harvest.push(mustContain === null ? { path } : { path, mustContain });
    return;
  }

  throw refuse(CODE_SPEC, line, directive, CLOSED_LIST,
    `wavefile line ${line}: unknown directive — expected one of ${[...DIRECTIVE_NAMES].join(', ')}`);
}

// ---------------------------------------------------------------------------
// The compile seam (D1 lowering).
// ---------------------------------------------------------------------------

export function compileWavefile(text, options = {}) {
  if (typeof text !== 'string') {
    throw refuse(CODE_SPEC, 1, '<first token>', 'wave <key>', 'a wavefile must be text');
  }
  const repoRoot = (options && typeof options === 'object'
    && typeof options.repoRoot === 'string' && options.repoRoot.length > 0) ? options.repoRoot : null;

  const state = {
    key: null,
    members: [],
    current: null,
    waveScope: [],
    steering: {},
    answerPolicy: {},
    harvest: [],
    seenDirective: false,
    memberStarted: false,
    signalOnMembersDoneLine: null,
  };

  for (const { line, text: lineText } of logicalLines(text)) {
    const trimmed = lineText.trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('#')) continue;
    const tokens = tokenize(lineText, line);
    const directive = tokens[0];
    if (!state.seenDirective) {
      state.seenDirective = true;
      if (directive !== 'wave') {
        throw refuse(CODE_SPEC, line, directive, 'wave <key>',
          `wavefile line ${line}: the first directive must be wave <key>`);
      }
    }
    dispatch(directive, tokens, line, state, repoRoot);
  }

  if (!state.seenDirective || state.key === null) {
    throw refuse(CODE_SPEC, 1, '<first token>', 'wave <key>', 'a wavefile must start with wave <key>');
  }
  closeCurrentMember(state);
  if (state.members.length > MAX_MEMBERS) {
    throw refuse(CODE_SPEC, 1, 'members', `<= ${MAX_MEMBERS}`, 'the wavefile exceeds the member ceiling');
  }

  // Steering cross-validation at admission (the fold H3): a signalOnMembersDone role that names no
  // declared member refuses rather than silently no-op'ing at run time.
  if (state.steering.signalOnMembersDone) {
    for (const role of state.steering.signalOnMembersDone.roles) {
      if (!state.members.some((member) => member.role === role)) {
        throw refuse(CODE_STEERING, state.signalOnMembersDoneLine ?? 1, 'signalOnMembersDone.roles',
          'declared member role', 'the signalOnMembersDone roles must name declared members');
      }
    }
  }

  const steering = {};
  if (state.steering.approveOnAdvertisedPlan !== undefined) steering.approveOnAdvertisedPlan = state.steering.approveOnAdvertisedPlan;
  if (state.steering.claimOnStall !== undefined) steering.claimOnStall = state.steering.claimOnStall;
  if (state.steering.nudgeOnCheckpoint !== undefined) steering.nudgeOnCheckpoint = state.steering.nudgeOnCheckpoint;
  if (state.steering.messageOnSpawn !== undefined) steering.messageOnSpawn = state.steering.messageOnSpawn;
  if (state.steering.elevateWhenNotes !== undefined) steering.elevateWhenNotes = state.steering.elevateWhenNotes;
  if (Object.keys(state.answerPolicy).length > 0) steering.answerDecisions = { policy: state.answerPolicy };
  if (state.steering.signalOnMembersDone !== undefined) steering.signalOnMembersDone = state.steering.signalOnMembersDone;

  return {
    schemaVersion: 1,
    idempotencyKey: state.key,
    members: state.members,
    steering,
    harvest: { paths: state.harvest },
  };
}

export default compileWavefile;
