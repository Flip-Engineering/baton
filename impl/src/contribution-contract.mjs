// contribution-contract.mjs — the contribution contract (#310), part of the lane contract (#305).
//
// Before this module every lane invented its own swarm.contribution_recorded shape — a
// JSON object with an items array, a Markdown table, numbered prose, a bare "test" —
// so the root retyped each into landing comments by hand and nothing downstream could
// consume them. This module is the ONE closed shape a contribution report takes, in the
// same style as swarm-event-schemas.mjs: a declarative schema every surface renders,
// plus the validator the runtime enforces on the swarm.update path.
//
// The shape: {subject, base: {observedHead, rebasedOnto}, commit: {sha, branch} | null,
// items: [{id, status: delivered|partial|not_delivered, change, files, test, evidence}],
// verification: {targeted, gates, fullSuite, environmentRed}, carriedForward,
// needsFromOthers, notes} — notes stays free prose.
//
// Two shapes this module does NOT own, by design:
//   • a bare-string body with no contribution identity is not a contribution at all: the
//     runtime admits it as a `note` (CONTRIBUTION_NOTE_KIND), recorded and never waking
//     the contribution_recorded class;
//   • the pre-#310 minimal hand-off ({contract, carriedForward}) keeps folding as ordinary
//     evidence: isContributionContractBody only claims bodies carrying the new shape's own
//     keys, so legacy rows are never re-judged.
//
// Issue #502 adds the recruit-time half: contributionContractConflict reads the free text a
// recruiter writes (the recruit objective) for a JSON-ish object that presents itself as a
// contribution body and names a field the contract does not admit, so a brief whose own example
// contradicts the shape refuses before any seat is admitted on it.

import { CONTRIBUTION_NEED_SCHEMA, validateContributionNeed } from './contribution-needs.mjs';

/** The item lifecycle states — the closed set an item status names. */
export const CONTRIBUTION_ITEM_STATUSES = Object.freeze(['delivered', 'partial', 'not_delivered']);

/** The runtime's own durable row for a note: a plain-text publish that is recorded, is not
 * a contribution, and wakes the `note` wake class instead of `contribution_recorded`. */
export const CONTRIBUTION_NOTE_KIND = 'swarm.note_recorded';

/** The stamp the runtime writes onto a commit:null body published from a dirty worktree. */
export const CONTRIBUTION_UNCOMMITTED_STATUS = 'uncommitted_work';

const STRING = (description, extra = {}) => Object.freeze({
  type: 'string', description: Object.freeze(description), expectation: 'non-empty text', ...extra });
const STRINGS = (description, extra = {}) => Object.freeze({
  type: 'array', items: 'non-empty text', description: Object.freeze(description),
  expectation: 'an array of non-empty strings', ...extra });
const BOOLEAN = (description, extra = {}) => Object.freeze({
  type: 'boolean', description: Object.freeze(description), expectation: 'true or false', ...extra });

/** The declarative contribution shape: one closed vocabulary for the validator below,
 * the brief's expected-shape block, and every surface that teaches lanes what to send.
 * `required` names what a published contract carries; `notes` stays free prose. */
export const CONTRIBUTION_CONTRACT_SCHEMA = Object.freeze({
  summary: Object.freeze('one lane report: what changed, on what commit, item by item, with its verification and hand-off'),
  fields: Object.freeze({
    subject: STRING('what this contribution reports, in one line',
      { required: true, example: 'Lane scope guard holds on shared checkouts' }),
    base: Object.freeze({ type: 'object', required: true,
      description: 'the checkout the lane observed: its HEAD and the target it rebased onto',
      expectation: 'an object with observedHead and rebasedOnto',
      fields: Object.freeze({
        observedHead: STRING('the checkout HEAD the lane worked from', { required: true, example: 'a'.repeat(40) }),
        rebasedOnto: STRING('the target the lane rebased onto',
          { required: true, example: 'b'.repeat(40), expectation: 'a sha string (or the observedHead)' }),
      }),
    }),
    commit: Object.freeze({ type: 'object|null', required: true,
      description: 'the published commit, or null when nothing is committed',
      expectation: 'an object with sha and branch, or null',
      fields: Object.freeze({
        sha: STRING('the published commit', { required: true, example: 'd'.repeat(40) }),
        branch: STRING('the lane branch the commit resolves on', { required: true, example: 'baton/lane-1' }),
      }),
    }),
    items: Object.freeze({ type: 'array', required: true,
      description: 'the delivered units, one row each',
      expectation: 'a non-empty array of item rows',
      items: Object.freeze({
        type: 'object',
        fields: Object.freeze({
          id: STRING('the item identity', { required: true, example: 'scope-guard' }),
          status: Object.freeze({ type: 'string', required: true, enum: [...CONTRIBUTION_ITEM_STATUSES],
            description: 'how far this item got', expectation: `one of ${CONTRIBUTION_ITEM_STATUSES.join(', ')}`,
            example: 'delivered' }),
          change: STRING('what changed for this item', { required: true, example: 'Hold the scope guard' }),
          files: STRINGS('the files this item touched', { required: true, example: ['impl/src/scope.mjs'] }),
          test: STRING('the targeted test that covers this item',
            { required: true, example: 'node --test test/scope.test.mjs' }),
          evidence: STRING('what the lane observed when it ran that test',
            { required: true, example: 'suite green' }),
        }),
      }),
    }),
    verification: Object.freeze({ type: 'object', required: true,
      description: 'how the lane verified the whole contribution',
      expectation: 'an object with targeted, gates, fullSuite and environmentRed',
      fields: Object.freeze({
        targeted: BOOLEAN('the targeted tests ran',
          { required: true, example: true, expectation: 'boolean' }),
        gates: Object.freeze({ type: 'array', required: true,
          description: 'the gate verdicts the lane collected',
          expectation: 'array of strings', example: Object.freeze([]) }),
        fullSuite: BOOLEAN('the full suite ran',
          { required: true, example: false, expectation: 'boolean' }),
        environmentRed: STRINGS('the environment rows that were red and why they are not this lane',
          { required: true, example: Object.freeze([]) }),
      }),
    }),
    carriedForward: Object.freeze({ type: 'array', required: true,
      description: 'the items this contribution hands to the next lane, cited verbatim by successors',
      expectation: 'an array', example: Object.freeze([]) }),
    needsFromOthers: Object.freeze({ type: 'array', required: true,
      description: 'addressed questions or requests for the root or a named participant',
      items: CONTRIBUTION_NEED_SCHEMA,
      expectation: 'an array of {to: root, ask} or {to: participant, participantId, ask}', example: Object.freeze([]) }),
    notes: Object.freeze({ type: 'string', required: false,
      description: 'free prose — anything that fits nowhere else',
      expectation: 'any text', example: 'the iface freeze holds through the next lane' }),
  }),
});

export const CONTRIBUTION_CONTRACT_FIELDS = Object.freeze(Object.keys(CONTRIBUTION_CONTRACT_SCHEMA.fields));

/** The new shape's own keys. `carriedForward` is deliberately absent: the pre-#310
 * minimal hand-off ({contract, carriedForward}) carries it too, and legacy rows are
 * ordinary evidence, never contract claimants. */
const CONTRACT_KEYS = Object.freeze(['subject', 'base', 'commit', 'items', 'verification', 'needsFromOthers']);

/** True when an object body claims the contribution contract — the set the strict
 * validator judges. Anything else (a string finding, the legacy hand-off, an absent
 * body) is not a claim and is admitted exactly as before. */
export function isContributionContractBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false;
  return CONTRACT_KEYS.some((key) => Object.hasOwn(body, key));
}

/** One contract refusal, taught (#371): every contribution_contract_invalid carries the
 * field, the RULE that failed (type | enum | sha-resolves | required | unknown-field) and
 * the expectation (the admitted type/values), and its message reads
 * "<field>: <rule>; expected <expectation>" — the same triple the durable
 * swarm.operation_refused row and the bridge answer carry. */
function contractRefusal(field, rule, expectation) {
  throw Object.assign(
    new Error(`Contribution contract is invalid: ${field}: ${rule}; expected ${expectation}`),
    { code: 'contribution_contract_invalid', detail: { field, rule, expectation } });
}

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;

const refuseUnlessRecord = (value, field, rule, expectation) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    contractRefusal(field, rule, expectation);
  }
};

const refuseUnknown = (value, allowed, field) => {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) {
    contractRefusal(`${field}.${unknown}`, 'unknown-field', `one of ${allowed.join(', ')}`);
  }
};

/** The strict validator the runtime runs on a contract-claiming body: closed shape,
 * typed refusals naming the field, the rule that failed and the admitted values (#371) —
 * every expectation read from the SAME schema object the brief renders, never a second
 * copy. Returns the body unchanged when it holds. */
export function validateContributionContract(body) {
  const fields = CONTRIBUTION_CONTRACT_SCHEMA.fields;
  refuseUnlessRecord(body, 'body', 'type', 'the contribution contract object');
  refuseUnknown(body, CONTRIBUTION_CONTRACT_FIELDS, 'body');
  for (const name of Object.keys(fields)) {
    if (body[name] === undefined && fields[name].required) {
      contractRefusal(`body.${name}`, 'required', fields[name].expectation);
    }
  }
  if (!isNonEmptyString(body.subject)) {
    contractRefusal('body.subject', 'type', fields.subject.expectation);
  }
  refuseUnlessRecord(body.base, 'body.base', 'type', fields.base.expectation);
  refuseUnknown(body.base, ['observedHead', 'rebasedOnto'], 'body.base');
  for (const name of ['observedHead', 'rebasedOnto']) {
    if (!isNonEmptyString(body.base[name])) {
      contractRefusal(`body.base.${name}`, 'type', fields.base.fields[name].expectation);
    }
  }
  if (body.commit !== null) {
    refuseUnlessRecord(body.commit, 'body.commit', 'type', fields.commit.expectation);
    refuseUnknown(body.commit, ['sha', 'branch'], 'body.commit');
    for (const name of ['sha', 'branch']) {
      if (!isNonEmptyString(body.commit[name])) {
        contractRefusal(`body.commit.${name}`, 'type', fields.commit.fields[name].expectation);
      }
    }
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    contractRefusal('body.items', 'type', fields.items.expectation);
  }
  body.items.forEach((item, index) => {
    const at = `body.items[${index}]`;
    refuseUnlessRecord(item, at, 'type', 'an item row');
    refuseUnknown(item, ['id', 'status', 'change', 'files', 'test', 'evidence'], at);
    if (!isNonEmptyString(item.id)) {
      contractRefusal(`${at}.id`, 'type', fields.items.items.fields.id.expectation);
    }
    if (!CONTRIBUTION_ITEM_STATUSES.includes(item.status)) {
      contractRefusal(`${at}.status`, 'enum', fields.items.items.fields.status.expectation);
    }
    for (const name of ['change', 'test', 'evidence']) {
      if (!isNonEmptyString(item[name])) {
        contractRefusal(`${at}.${name}`, 'type', fields.items.items.fields[name].expectation);
      }
    }
    if (!Array.isArray(item.files) || !item.files.every(isNonEmptyString)) {
      contractRefusal(`${at}.files`, 'type', fields.items.items.fields.files.expectation);
    }
  });
  refuseUnlessRecord(body.verification, 'body.verification', 'type', fields.verification.expectation);
  refuseUnknown(body.verification, ['targeted', 'gates', 'fullSuite', 'environmentRed'], 'body.verification');
  for (const name of ['targeted', 'fullSuite']) {
    if (typeof body.verification[name] !== 'boolean') {
      contractRefusal(`body.verification.${name}`, 'type', fields.verification.fields[name].expectation);
    }
  }
  if (!Array.isArray(body.verification.gates)
    || !body.verification.gates.every(isNonEmptyString)) {
    contractRefusal('body.verification.gates', 'type', fields.verification.fields.gates.expectation);
  }
  if (!Array.isArray(body.verification.environmentRed)
    || !body.verification.environmentRed.every(isNonEmptyString)) {
    contractRefusal('body.verification.environmentRed', 'type',
      fields.verification.fields.environmentRed.expectation);
  }
  for (const name of ['carriedForward', 'needsFromOthers']) {
    if (!Array.isArray(body[name])) {
      contractRefusal(`body.${name}`, 'type', fields[name].expectation);
    }
    if (name === 'needsFromOthers') {
      body[name].forEach((need, index) => validateContributionNeed(need, `body.${name}[${index}]`, contractRefusal));
      continue;
    }
    const badIndex = body[name].findIndex((entry) => !isNonEmptyString(entry));
    if (badIndex !== -1) {
      contractRefusal(`body.${name}[${badIndex}]`, 'type', fields[name].expectation);
    }
  }
  if (body.notes !== undefined && typeof body.notes !== 'string') {
    contractRefusal('body.notes', 'type', fields.notes.expectation);
  }
  return body;
}

/** Every field name the contract admits anywhere — the top-level fields, the sub-schema keys and
 * the item row's keys — walked from the ONE schema object the validator reads, so the lint below
 * and validateContributionContract judge the same vocabulary. */
const CONTRACT_FIELD_NAMES = (() => {
  const names = new Set();
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return;
    for (const [name, child] of Object.entries(node.fields ?? {})) {
      names.add(name);
      walk(child);
    }
    walk(node.items);
  };
  walk(CONTRIBUTION_CONTRACT_SCHEMA);
  return Object.freeze([...names]);
})();

/** The number of the contract's own top-level field names an object names at one level before it
 * is read as an example OF the contribution body. One shared name (`subject`, `notes`) is an
 * ordinary word an unrelated payload example may carry; two is the point where the object is
 * describing this contract's shape, and every field name in it is judged. */
const CONTRACT_BODY_CLAIM_KEYS = 2;

const BRIEF_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/** The end index of the double-quoted region starting at `start`, backslash escapes honored, or
 * -1 when the quote never closes. Reading a region whole is what keeps a field name inside a
 * value (an example embedded in `evidence`, say) from reading as a key of the object around it. */
function briefQuotedEnd(text, start) {
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === '\\') { index += 1; continue; }
    if (text[index] === '"') return index;
  }
  return -1;
}

/** Whether the position starts a bare key token: the nearest non-space character before it is the
 * `{` that opens an object or the `,` that separates its entries. */
function briefBareKeyPosition(text, start) {
  for (let index = start - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') continue;
    return char === '{' || char === ',';
  }
  return false;
}

/** Whether the position holds optional whitespace followed by the `:` a key's value follows. */
function briefColonFollows(text, start) {
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') continue;
    return char === ':';
  }
  return false;
}

/** The JSON-ish objects a free text carries: one frame per `{…}` span, each holding the key
 * tokens read at its own level. Both spellings are read — `"findings":` and, directly after `{`
 * or `,`, `findings:` — because a brief's example is written by hand and carries placeholders
 * (`<BODY>`, `<one-line summary>`), so it is not JSON. Strings are skipped: a key name inside a
 * value is a value. */
function briefObjectFrames(text) {
  const frames = [];
  const open = [];
  const bareKey = /([A-Za-z_][A-Za-z0-9_]*)\s*:/uy;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      const end = briefQuotedEnd(text, index);
      if (end === -1) break;
      const token = text.slice(index + 1, end);
      if (open.length > 0 && BRIEF_IDENTIFIER.test(token)
        && briefColonFollows(text, end + 1)) {
        frames[open[open.length - 1]].keys.push({ name: token, at: index });
      }
      index = end + 1;
      continue;
    }
    if (char === '{') {
      frames.push({ keys: [], parent: open.length > 0 ? open[open.length - 1] : null });
      open.push(frames.length - 1);
      index += 1;
      continue;
    }
    if (char === '}') {
      open.pop();
      index += 1;
      continue;
    }
    if (open.length > 0 && (char === '_' || (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z'))) {
      bareKey.lastIndex = index;
      const bare = bareKey.exec(text);
      if (bare !== null && briefBareKeyPosition(text, index)) {
        frames[open[open.length - 1]].keys.push({ name: bare[1], at: index });
        index += bare[0].length;
        continue;
      }
    }
    index += 1;
  }
  return frames;
}

/** Issue #502: the first field name a free text names in a JSON-ish object that presents itself
 * as a contribution body and that the contract does not admit — the refusal a worker would have
 * met at publish, read at recruit time. Null when the text holds no such name. The #492 audit
 * swarm's brief carried a `findings` array beside the contract's own keys; every seat recruited
 * on it was refused `body.findings: unknown-field`, and one seat hit that refusal thirteen
 * times. */
export function contributionContractConflict(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const frames = briefObjectFrames(text);
  const claims = frames.map((frame) => {
    const named = new Set(frame.keys.map((key) => key.name));
    return CONTRIBUTION_CONTRACT_FIELDS.filter((name) => named.has(name)).length
      >= CONTRACT_BODY_CLAIM_KEYS;
  });
  const judged = frames.map((_frame, index) => {
    for (let node = index; node !== null; node = frames[node].parent) {
      if (claims[node]) return true;
    }
    return false;
  });
  let conflict = null;
  for (const [index, frame] of frames.entries()) {
    if (!judged[index]) continue;
    for (const key of frame.keys) {
      if (CONTRACT_FIELD_NAMES.includes(key.name)) continue;
      if (conflict === null || key.at < conflict.at) conflict = key;
    }
  }
  return conflict === null ? null
    : Object.freeze({ field: conflict.name, admitted: CONTRIBUTION_CONTRACT_FIELDS });
}

/** The seat's recruit mode gates the contract's commit field (#373): a seat recruited
 * `read_only` runs the read-only result intent — its run accepts no repository mutation, so
 * there is no lane commit to report and `commit: null` is the by-design publish. A
 * contract-claiming body carrying a commit object from such a seat is refused by name, with
 * the same field/expectation detail every contract refusal carries. Any other mode admits the
 * body unchanged; call AFTER validateContributionContract, on a body that holds. */
export function validateContributionContractMode(body, mode = 'change') {
  if (mode !== 'read_only' || body.commit === null) return true;
  throw Object.assign(
    new Error('body.commit: contribution_mode_mismatch; expected null — a read_only seat publishes no commit'),
    { code: 'contribution_mode_mismatch', detail: { mode, field: 'commit', expectation: null } });
}

/** One contract summary row per contribution for swarm.view: the subject, the commit, the
 * item statuses, the verification summary and the hand-off counts. Defensive over stored
 * rows — a view never refuses what the ledger already holds; strictness lives at publish.
 * Null when the body carries no contract. */
export function projectContributionContract(body) {
  if (!isContributionContractBody(body)) return null;
  const items = Array.isArray(body.items) ? body.items : [];
  const verification = body.verification !== null && typeof body.verification === 'object'
    && !Array.isArray(body.verification) ? body.verification : {};
  return Object.freeze({
    subject: typeof body.subject === 'string' ? body.subject : null,
    commit: body.commit === null || body.commit === undefined ? null
      : Object.freeze({ sha: body.commit?.sha ?? null, branch: body.commit?.branch ?? null }),
    status: typeof body.status === 'string' ? body.status : null,
    items: Object.freeze(items.map((item) => Object.freeze({
      id: item?.id ?? null, status: item?.status ?? null,
    }))),
    verification: Object.freeze({
      targeted: verification.targeted ?? null,
      gates: Array.isArray(verification.gates) ? verification.gates.length : null,
      fullSuite: verification.fullSuite ?? null,
      environmentRed: Array.isArray(verification.environmentRed) ? verification.environmentRed.length : null,
    }),
    carriedForward: Array.isArray(body.carriedForward) ? body.carriedForward.length : null,
    needsFromOthers: Array.isArray(body.needsFromOthers) ? body.needsFromOthers.length : null,
  });
}

/** The worked example the brief renders (#371): the schema's own example column
 * materialized into one payload the validator admits — assembled from the SAME schema
 * object the validator reads, never a hand-typed second copy. The contributing example
 * shows the commit object form; a read-only seat (a grant without `contribute`) publishes
 * commit null by design and gets that variant. */
const exampleFromSchema = (readOnly) => Object.freeze({
  subject: CONTRIBUTION_CONTRACT_SCHEMA.fields.subject.example,
  base: Object.freeze({
    observedHead: CONTRIBUTION_CONTRACT_SCHEMA.fields.base.fields.observedHead.example,
    rebasedOnto: CONTRIBUTION_CONTRACT_SCHEMA.fields.base.fields.rebasedOnto.example,
  }),
  commit: readOnly ? null : Object.freeze({
    sha: CONTRIBUTION_CONTRACT_SCHEMA.fields.commit.fields.sha.example,
    branch: CONTRIBUTION_CONTRACT_SCHEMA.fields.commit.fields.branch.example,
  }),
  items: [Object.freeze({
    id: CONTRIBUTION_CONTRACT_SCHEMA.fields.items.items.fields.id.example,
    status: CONTRIBUTION_CONTRACT_SCHEMA.fields.items.items.fields.status.example,
    change: CONTRIBUTION_CONTRACT_SCHEMA.fields.items.items.fields.change.example,
    files: Object.freeze([...CONTRIBUTION_CONTRACT_SCHEMA.fields.items.items.fields.files.example]),
    test: CONTRIBUTION_CONTRACT_SCHEMA.fields.items.items.fields.test.example,
    evidence: CONTRIBUTION_CONTRACT_SCHEMA.fields.items.items.fields.evidence.example,
  })],
  verification: Object.freeze({
    targeted: CONTRIBUTION_CONTRACT_SCHEMA.fields.verification.fields.targeted.example,
    gates: Object.freeze([...CONTRIBUTION_CONTRACT_SCHEMA.fields.verification.fields.gates.example]),
    fullSuite: CONTRIBUTION_CONTRACT_SCHEMA.fields.verification.fields.fullSuite.example,
    environmentRed: Object.freeze(
      [...CONTRIBUTION_CONTRACT_SCHEMA.fields.verification.fields.environmentRed.example]),
  }),
  carriedForward: Object.freeze([]),
  needsFromOthers: Object.freeze([]),
});

/** The example payload the brief prints verbatim — the contributing form. */
export const CONTRIBUTION_CONTRACT_EXAMPLE = exampleFromSchema(false);

/** The example for a seat's mode: `readOnly` (a grant without contribute) swaps commit
 * for null, the form that seat publishes by design. */
export function contributionContractExample({ readOnly = false } = {}) {
  return readOnly ? exampleFromSchema(true) : CONTRIBUTION_CONTRACT_EXAMPLE;
}

/** The expected-shape block the recruit brief renders: the contract a lane publishes, so
 * the next lane never has to guess it (#310) — now a worked example the validator admits,
 * printed verbatim, with the closed value sets inline and derived from the same schema
 * object the validator reads (#371), never a hand-typed second copy. */
export function contributionContractBriefSection({ readOnly = false } = {}) {
  const fields = CONTRIBUTION_CONTRACT_SCHEMA.fields;
  const closedSets = [
    `items[].status ∈ ${fields.items.items.fields.status.enum.join('|')}`,
    `verification.targeted: ${fields.verification.fields.targeted.expectation}`,
    `verification.gates: ${fields.verification.fields.gates.expectation}`,
    `base.rebasedOnto: ${fields.base.fields.rebasedOnto.expectation}`,
    `commit: {${Object.keys(fields.commit.fields).join(', ')}} or null`,
    `needsFromOthers: ${fields.needsFromOthers.expectation}`,
  ];
  return ['## Contribution contract',
    'Publish your report with swarm.update event swarm.contribution_recorded as one JSON object shaped exactly like this worked example, which the validator admits as printed'
    + ' — nothing downstream can consume any other shape:',
    JSON.stringify(contributionContractExample({ readOnly }), null, 2),
    `Closed value sets: ${closedSets.join('; ')}.`,
    'A publish naming only a bare-string body (no contributionId) is recorded as a note, not a contribution,'
    + ' and wakes nobody: it never substitutes for the contract above.',
  ].join('\n');
}
