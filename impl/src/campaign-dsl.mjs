// campaign-dsl.mjs — the phase-level campaign compiler (phasefile).
//
// Authority: docs/reference/evidence/phase-grammar-2026-08-14/phase-grammar-contract.md v1.
// A phasefile sequences `phase <name>` blocks (each holding the SAME 16 wavefile directives as its
// per-phase roster) and adds 8 campaign-level directives. The phase compiler COMPOSES the wavefile
// compiler: each phase's member/steering/harvest body is lowered by compileWavefile to the precise
// `admitSpec`-shaped spec, and the phase-level directives (`when`, `outcome`, `coupling`,
// `question`, `option`) lower to campaign metadata. The compiler is a pure function of the text
// given `repoRoot` (passed through to compileWavefile for the per-phase harvest containment): no
// eval, no Function, no dynamic import, no file READS. Every refusal carries the #160
// {line, field, expected} triple on the error AND the wire `detail` leg. Importing this module runs
// NOTHING (no top-level await, no campaign start, no side effects).
//
// The lexical layer mirrors workflow-dsl.mjs byte-for-byte (the two grammars tokenize identically —
// JC-6); each module owns its refusal family, so the lexer is inlined with the campaign's codes and
// a "phasefile line" message prefix rather than imported (the wavefile's tokenize hardcodes its own
// code set and prefix).

import { compileWavefile } from './workflow-dsl.mjs';

// ---------------------------------------------------------------------------
// Closed constants (the campaign-level extensions of the #170 closed vocabulary).
// ---------------------------------------------------------------------------

export const PHASE_KINDS = Object.freeze(['wave', 'fold', 'checkpoint']);
export const COUPLING_KINDS = Object.freeze(['loose', 'shared', 'tight']);
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

// The closed campaign-level refusal family (phase-grammar-contract §3) — all `workflow_*`-prefixed
// so the existing MCP `workflow_*` prefix arm and LANE_CRAFTED detail preserve them with no
// allowlist churn. The wavefile's four admission-time codes are reused verbatim for per-phase body
// errors (delegated to compileWavefile); the runner owns the two runtime codes.
const CODE_CAMPAIGN = 'workflow_campaign_invalid';
const CODE_GATE = 'workflow_gate_invalid';
const CODE_OUTCOME = 'workflow_outcome_invalid';
const CODE_CHECKPOINT = 'workflow_checkpoint_invalid';

// ---------------------------------------------------------------------------
// The 8-directive campaign registry (D1 / generated-docs source).
// ---------------------------------------------------------------------------

export const CAMPAIGN_DIRECTIVES = Object.freeze({
  campaign: { arity: 1, tokens: ['<key>'], field: 'campaignKey' },
  phase: { arity: '1–2', tokens: ['<name>', 'wave|fold|checkpoint'], field: 'phases[]' },
  when: { arity: '1–3', tokens: ['<outcome>', '[not]', '==|!= "<lit>"'], field: 'phases[].when', enum: 'CLOSED_PREDICATE' },
  outcome: { arity: '2–4', tokens: ['<name>', 'from', '<path>', 'line "<pattern>"'], field: 'phases[].outcomes' },
  coupling: { arity: '1–2', tokens: ['<kind>', '|<role>', '<kind>'], field: 'phases[].couplings', enum: 'COUPLING_KINDS' },
  question: { arity: 1, tokens: ['"<text>"'], field: 'phases[].checkpoint.question' },
  option: { arity: 2, tokens: ['"<id>"', '"<label>"'], field: 'phases[].checkpoint.options' },
  // `checkpoint` is a phase KIND, not a directive — listed here for the generated-docs totality.
  checkpoint: { arity: 0, tokens: [], field: 'phases[].kind', kind: true },
});

const DIRECTIVE_NAMES = new Set(Object.keys(CAMPAIGN_DIRECTIVES));
const CLOSED_LIST = '<closed campaign directive list>';
const WAVEFILE_DIRECTIVE_HINT = 'phase <name>';

// ---------------------------------------------------------------------------
// Refusal construction (the #160 triple on the error AND the wire detail leg).
// ---------------------------------------------------------------------------

function refuse(code, line, field, expected, message) {
  return Object.assign(new TypeError(message), {
    code, line, field, expected, detail: { line, field, expected },
  });
}

// ---------------------------------------------------------------------------
// Lexical layer (mirrors workflow-dsl.mjs:80-172 — same continuation/quote/escape rules).
// ---------------------------------------------------------------------------

function unescapedQuoteCount(value) {
  let count = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '\\') { i += 1; continue; }
    if (value[i] === '"') count += 1;
  }
  return count;
}

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
      throw refuse(CODE_CAMPAIGN, line, fieldOf(), 'end of line',
        `phasefile line ${line}: a trailing "#" is not a comment — expected end of line`);
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
              throw refuse(CODE_CAMPAIGN, line, fieldOf(), 'valid escape',
                `phasefile line ${line}: invalid unicode escape — expected \\uXXXX`);
            }
            value += String.fromCharCode(parseInt(hex, 16));
            i += 6;
          } else {
            throw refuse(CODE_CAMPAIGN, line, fieldOf(), 'valid escape',
              `phasefile line ${line}: invalid escape — expected \\" \\\\ \\n \\t or \\uXXXX`);
          }
        } else { value += c; i += 1; }
      }
      if (!closed) {
        throw refuse(CODE_CAMPAIGN, line, fieldOf(), '"closing quote"',
          `phasefile line ${line}: unterminated string — expected a closing quote`);
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

function requireArg(tokens, index, line, field) {
  if (tokens[index] === undefined) {
    throw refuse(CODE_CAMPAIGN, line, field, `<${field}> arguments`,
      `phasefile line ${line}: ${field} is missing its argument`);
  }
  return tokens[index];
}

// ---------------------------------------------------------------------------
// Per-phase body lowering — delegate the member/steering/harvest directives to the wavefile
// compiler, remapping refusal line numbers back to the phasefile (the synthesized wavefile's
// line 1 is the machine-derived `wave <key>`; body line k sits at synthesized line k+1).
// ---------------------------------------------------------------------------

function compilePhaseSpec(phase) {
  const derivedKey = `${phase.campaignKey}:${phase.name}`;
  if (!IDEMPOTENCY_PATTERN.test(derivedKey)) {
    throw refuse(CODE_CAMPAIGN, phase.line, `phase ${phase.name}`, 'identifier pattern',
      `phasefile line ${phase.line}: the derived wave key "${derivedKey}" must match the identifier pattern`);
  }
  const synth = [`wave ${derivedKey}`, ...phase.body.map((b) => b.text)].join('\n');
  try {
    return compileWavefile(synth, { repoRoot: phase.repoRoot });
  } catch (error) {
    if (error && typeof error === 'object' && Number.isInteger(error.line)) {
      const phasefileLine = error.line <= 1 ? phase.line : (phase.body[error.line - 2]?.line ?? phase.line);
      const detail = { line: phasefileLine, field: error.field, expected: error.expected };
      const remapped = Object.assign(new TypeError(error.message), {
        code: error.code, line: phasefileLine, field: error.field, expected: error.expected, detail,
      });
      throw remapped;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Compile state + directive dispatch (D1 placement rules).
// ---------------------------------------------------------------------------

function newPhase(state, name, kind, line) {
  return {
    name, kind, line,
    campaignKey: state.key,
    repoRoot: state.repoRoot,
    when: [],
    outcomes: [],
    couplings: {},
    question: null,
    options: [],
    body: [],
    spec: null,
    checkpoint: null,
  };
}

function finalizePhase(state) {
  const ph = state.current;
  if (!ph) return;
  state.current = null;

  if (ph.kind === 'checkpoint') {
    if (ph.body.length > 0) {
      throw refuse(CODE_CAMPAIGN, ph.line, `phase ${ph.name}`, 'question "<text>"',
        `phasefile line ${ph.line}: a checkpoint phase has no roster (no member/steering/harvest directives)`);
    }
    if (ph.question === null) {
      throw refuse(CODE_CHECKPOINT, ph.line, 'checkpoint', 'question "<text>"',
        `phasefile line ${ph.line}: a checkpoint phase requires a question`);
    }
    if (ph.options.length < 2) {
      throw refuse(CODE_CHECKPOINT, ph.line, 'checkpoint', 'option "<id>" "<label>"',
        `phasefile line ${ph.line}: a checkpoint phase requires at least two options`);
    }
    const ids = ph.options.map((option) => option.id);
    if (new Set(ids).size !== ids.length) {
      throw refuse(CODE_CHECKPOINT, ph.line, 'option', 'unique option id',
        `phasefile line ${ph.line}: checkpoint option ids must be unique`);
    }
    ph.spec = null;
    ph.checkpoint = { question: ph.question, options: ph.options.map((option) => ({ id: option.id, label: option.label })) };
  } else {
    if (ph.question !== null || ph.options.length > 0) {
      throw refuse(CODE_CAMPAIGN, ph.line, 'question', 'checkpoint phase',
        `phasefile line ${ph.line}: question/option are valid only in a checkpoint phase`);
    }
    if (ph.kind === 'fold' && ph.when.length === 0) {
      throw refuse(CODE_CAMPAIGN, ph.line, `phase ${ph.name}`, 'when <outcome> …',
        `phasefile line ${ph.line}: a fold phase requires at least one when predicate`);
    }
    if (ph.kind !== 'fold' && ph.when.length > 0) {
      throw refuse(CODE_CAMPAIGN, ph.line, 'when', 'fold phase',
        `phasefile line ${ph.line}: when is valid only in a fold phase`);
    }
    ph.spec = compilePhaseSpec(ph);
    // coupling-role closure: a per-member coupling must name a declared member role.
    for (const role of Object.keys(ph.couplings)) {
      if (role !== '*' && !ph.spec.members.some((member) => member.role === role)) {
        throw refuse(CODE_CAMPAIGN, ph.line, 'coupling', 'declared member role',
          `phasefile line ${ph.line}: coupling role "${role}" names no member of this phase`);
      }
    }
    // outcome-path closure: an outcome's `from` path must be a declared harvest path of this phase.
    const harvestPaths = new Set(ph.spec.harvest.paths.map((entry) => entry.path));
    for (const decl of ph.outcomes) {
      if (!harvestPaths.has(decl.from)) {
        throw refuse(CODE_OUTCOME, decl.lineNo, `outcome ${decl.name}`, 'declared harvest path',
          `phasefile line ${decl.lineNo}: outcome "${decl.name}" reads a path this phase does not harvest`);
      }
    }
  }

  state.phases.push({
    name: ph.name,
    kind: ph.kind,
    when: ph.when,
    outcomes: ph.outcomes,
    couplings: ph.couplings,
    spec: ph.spec,
    checkpoint: ph.checkpoint,
  });
}

function dispatchCampaign(directive, tokens, line, state) {
  const args = tokens.slice(1);
  if (directive === 'campaign') {
    if (state.key !== null) {
      throw refuse(CODE_CAMPAIGN, line, 'campaign', 'end of line',
        'the campaign directive may appear once, at the top');
    }
    if (state.phases.length > 0 || state.current !== null) {
      throw refuse(CODE_CAMPAIGN, line, 'campaign', 'end of line',
        'the campaign directive must precede every phase');
    }
    const key = requireArg(tokens, 1, line, 'campaign');
    if (tokens.length !== 2) throw refuse(CODE_CAMPAIGN, line, 'campaign', 'campaign <key>', 'the campaign directive takes one key');
    if (!IDEMPOTENCY_PATTERN.test(key)) {
      throw refuse(CODE_CAMPAIGN, line, 'campaignKey', '<IDEMPOTENCY_PATTERN>',
        'the campaign key must match the closed identifier pattern');
    }
    state.key = key;
    return;
  }

  if (directive === 'phase') {
    finalizePhase(state);
    const name = requireArg(tokens, 1, line, 'phase');
    let kind = 'wave';
    if (tokens.length === 3) {
      kind = tokens[2];
    } else if (tokens.length !== 2) {
      throw refuse(CODE_CAMPAIGN, line, 'phase', 'phase <name> [wave|fold|checkpoint]', 'the phase directive takes a name and an optional kind');
    }
    if (name.length === 0) {
      throw refuse(CODE_CAMPAIGN, line, 'phase', 'non-empty name', `phasefile line ${line}: phase name is empty`);
    }
    if (!IDEMPOTENCY_PATTERN.test(name)) {
      throw refuse(CODE_CAMPAIGN, line, `phase ${name}`, '<IDEMPOTENCY_PATTERN>',
        `phasefile line ${line}: the phase name must match the closed identifier pattern`);
    }
    if (!PHASE_KINDS.includes(kind)) {
      throw refuse(CODE_CAMPAIGN, line, `phase ${name}`, 'wave|fold|checkpoint',
        `phasefile line ${line}: the phase kind must be one of wave|fold|checkpoint`);
    }
    if (state.phases.some((ph) => ph.name === name)) {
      throw refuse(CODE_CAMPAIGN, line, `phase ${name}`, 'unique phase name',
        `phasefile line ${line}: the phase name is duplicated`);
    }
    state.current = newPhase(state, name, kind, line);
    return;
  }

  // The remaining campaign-level directives require an open phase.
  if (!state.current) {
    throw refuse(CODE_CAMPAIGN, line, directive, 'phase <name>',
      `phasefile line ${line}: ${directive} must appear inside a phase block`);
  }

  if (directive === 'when') {
    if (args.length === 1) {
      state.current.when.push({ outcome: args[0], op: 'truthy', literal: null, line });
      return;
    }
    if (args.length === 2 && args[0] === 'not') {
      state.current.when.push({ outcome: args[1], op: 'falsy', literal: null, line });
      return;
    }
    if (args.length === 3 && (args[1] === '==' || args[1] === '!=')) {
      if (args[2].length === 0) {
        throw refuse(CODE_GATE, line, 'when', 'when <outcome> ==|!= "<literal>"',
          `phasefile line ${line}: the comparison literal must be non-empty`);
      }
      state.current.when.push({ outcome: args[0], op: args[1] === '==' ? 'eq' : 'ne', literal: args[2], line });
      return;
    }
    throw refuse(CODE_GATE, line, 'when', 'when <outcome> [not] | when <outcome> ==|!= "<literal>"',
      `phasefile line ${line}: the when predicate is outside the closed vocabulary`);
  }

  if (directive === 'outcome') {
    if (args.length !== 3 && args.length !== 5) {
      throw refuse(CODE_OUTCOME, line, 'outcome', 'outcome <name> from <path> [line "<pattern>"]',
        `phasefile line ${line}: the outcome directive takes a name, a path, and an optional line pattern`);
    }
    const name = args[0];
    if (name.length === 0 || !IDEMPOTENCY_PATTERN.test(name)) {
      throw refuse(CODE_OUTCOME, line, 'outcome', '<IDEMPOTENCY_PATTERN>',
        `phasefile line ${line}: the outcome name must match the closed identifier pattern`);
    }
    if (args[1] !== 'from') {
      throw refuse(CODE_OUTCOME, line, 'outcome', 'outcome <name> from <path>',
        `phasefile line ${line}: the outcome directive requires the "from" keyword`);
    }
    const from = args[2];
    let linePattern = null;
    if (args.length === 5) {
      if (args[3] !== 'line') {
        throw refuse(CODE_OUTCOME, line, 'outcome', 'outcome <name> from <path> [line "<pattern>"]',
          `phasefile line ${line}: the optional extraction keyword is "line"`);
      }
      if (args[4].length === 0) {
        throw refuse(CODE_OUTCOME, line, 'outcome', 'line "<pattern>"',
          `phasefile line ${line}: the line pattern must be non-empty`);
      }
      linePattern = args[4];
    }
    state.current.outcomes.push({ name, from, line: linePattern, lineNo: line });
    return;
  }

  if (directive === 'coupling') {
    if (args.length === 1) {
      if (!COUPLING_KINDS.includes(args[0])) {
        throw refuse(CODE_CAMPAIGN, line, 'coupling', 'loose|shared|tight',
          `phasefile line ${line}: the coupling kind must be one of loose|shared|tight`);
      }
      state.current.couplings['*'] = args[0];
      return;
    }
    if (args.length === 2) {
      if (!COUPLING_KINDS.includes(args[1])) {
        throw refuse(CODE_CAMPAIGN, line, 'coupling', 'loose|shared|tight',
          `phasefile line ${line}: the coupling kind must be one of loose|shared|tight`);
      }
      state.current.couplings[args[0]] = args[1];
      return;
    }
    throw refuse(CODE_CAMPAIGN, line, 'coupling', 'coupling <kind> | coupling <role> <kind>',
      `phasefile line ${line}: the coupling directive takes a kind or a role and a kind`);
  }

  if (directive === 'question') {
    const text = requireArg(tokens, 1, line, 'question');
    if (tokens.length !== 2) throw refuse(CODE_CHECKPOINT, line, 'question', 'question "<text>"', 'the question directive takes one text');
    if (text.length === 0) throw refuse(CODE_CHECKPOINT, line, 'question', 'non-empty question', 'the checkpoint question must be non-empty');
    if (state.current.question !== null) throw refuse(CODE_CHECKPOINT, line, 'question', 'one question', 'a checkpoint phase carries exactly one question');
    state.current.question = text;
    return;
  }

  if (directive === 'option') {
    const id = requireArg(tokens, 1, line, 'option');
    const label = requireArg(tokens, 2, line, 'option');
    if (tokens.length !== 3) throw refuse(CODE_CHECKPOINT, line, 'option', 'option "<id>" "<label>"', 'the option directive takes an id and a label');
    if (id.length === 0) throw refuse(CODE_CHECKPOINT, line, 'option', 'non-empty option id', 'the option id must be non-empty');
    state.current.options.push({ id, label });
    return;
  }

  throw refuse(CODE_CAMPAIGN, line, directive, CLOSED_LIST,
    `phasefile line ${line}: unknown directive — expected one of ${[...DIRECTIVE_NAMES].join(', ')}`);
}

// ---------------------------------------------------------------------------
// The compile seam (D1 lowering) + campaign-level cross-validation.
// ---------------------------------------------------------------------------

export function compileCampaign(text, options = {}) {
  if (typeof text !== 'string') {
    throw refuse(CODE_CAMPAIGN, 1, '<first token>', 'campaign <key>', 'a phasefile must be text');
  }
  const repoRoot = (options && typeof options === 'object'
    && typeof options.repoRoot === 'string' && options.repoRoot.length > 0) ? options.repoRoot : null;

  const state = {
    key: null,
    repoRoot,
    phases: [],
    current: null,
    seenDirective: false,
  };

  for (const { line, text: lineText } of logicalLines(text)) {
    const trimmed = lineText.trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('#')) continue;
    const tokens = tokenize(lineText, line);
    const directive = tokens[0];
    if (!state.seenDirective) {
      state.seenDirective = true;
      if (directive !== 'campaign') {
        throw refuse(CODE_CAMPAIGN, line, directive, 'campaign <key>',
          `phasefile line ${line}: the first directive must be campaign <key>`);
      }
    }
    if (CAMPAIGN_DIRECTIVES[directive]) {
      dispatchCampaign(directive, tokens, line, state);
    } else {
      // A wavefile directive — belongs to the current phase's roster body.
      if (!state.current) {
        throw refuse(CODE_CAMPAIGN, line, directive, WAVEFILE_DIRECTIVE_HINT,
          `phasefile line ${line}: ${directive} must appear inside a phase block`);
      }
      state.current.body.push({ text: lineText, line });
    }
  }

  if (!state.seenDirective || state.key === null) {
    throw refuse(CODE_CAMPAIGN, 1, '<first token>', 'campaign <key>', 'a phasefile must start with campaign <key>');
  }
  finalizePhase(state);
  if (state.phases.length === 0) {
    throw refuse(CODE_CAMPAIGN, 1, 'phase', 'phase <name>', 'a phasefile must declare at least one phase');
  }

  // Outcome-name closure: every `when <outcome>` must reference a name DECLARED by an `outcome`
  // directive in a STRICTLY EARLIER phase; outcome names are unique across the campaign.
  const declaredAt = new Map();
  for (const [index, ph] of state.phases.entries()) {
    for (const decl of ph.outcomes) {
      if (declaredAt.has(decl.name)) {
        throw refuse(CODE_OUTCOME, decl.lineNo, `outcome ${decl.name}`, 'unique outcome name',
          `phasefile line ${decl.lineNo}: outcome name "${decl.name}" is duplicated`);
      }
      declaredAt.set(decl.name, index);
    }
  }
  for (const [index, ph] of state.phases.entries()) {
    for (const predicate of ph.when) {
      if (!declaredAt.has(predicate.outcome)) {
        throw refuse(CODE_GATE, predicate.line, 'when', 'declared prior outcome',
          `phasefile line ${predicate.line}: when references an undeclared outcome "${predicate.outcome}"`);
      }
      if (declaredAt.get(predicate.outcome) >= index) {
        throw refuse(CODE_GATE, predicate.line, 'when', 'declared prior outcome',
          `phasefile line ${predicate.line}: when references an outcome declared in the same or a later phase`);
      }
    }
  }

  return {
    schemaVersion: 1,
    campaignKey: state.key,
    phases: state.phases.map((ph) => ({
      name: ph.name,
      kind: ph.kind,
      when: ph.when.map(({ outcome, op, literal }) => ({ outcome, op, literal })),
      outcomes: ph.outcomes.map(({ name, from, line }) => ({ name, from, line })),
      couplings: ph.couplings,
      spec: ph.spec,
      checkpoint: ph.checkpoint,
    })),
  };
}

export default compileCampaign;
