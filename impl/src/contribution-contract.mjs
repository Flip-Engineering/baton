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
        rebasedOnto: STRING('the target the lane rebased onto', { required: true, example: 'main' }),
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
        targeted: BOOLEAN('the targeted tests ran', { required: true, example: true }),
        gates: Object.freeze({ type: 'array', required: true,
          description: 'the gate verdicts the lane collected',
          expectation: 'an array', example: Object.freeze([]) }),
        fullSuite: BOOLEAN('the full suite ran', { required: true, example: false }),
        environmentRed: STRINGS('the environment rows that were red and why they are not this lane',
          { required: true, example: Object.freeze([]) }),
      }),
    }),
    carriedForward: Object.freeze({ type: 'array', required: true,
      description: 'the items this contribution hands to the next lane, cited verbatim by successors',
      expectation: 'an array', example: Object.freeze([]) }),
    needsFromOthers: Object.freeze({ type: 'array', required: true,
      description: 'what this lane still needs from other seats, cited verbatim by successors',
      expectation: 'an array', example: Object.freeze([]) }),
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

function contractRefusal(message, field, expectation) {
  throw Object.assign(new Error(message), {
    code: 'contribution_contract_invalid',
    detail: { field, expectation },
  });
}

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;

const refuseUnlessRecord = (value, field, expectation) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    contractRefusal(`Contribution contract is invalid: ${field} must be ${expectation}`,
      field, expectation);
  }
};

const refuseUnknown = (value, allowed, field) => {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) {
    contractRefusal(`Contribution contract is invalid: ${field}.${unknown} is not a field of the contribution contract`
      + ` (fields: ${allowed.join(', ')})`,
    `${field}.${unknown}`, `one of ${allowed.join(', ')}`);
  }
};

/** The strict validator the runtime runs on a contract-claiming body: closed shape,
 * typed refusals naming the field. Returns the body unchanged when it holds. */
export function validateContributionContract(body) {
  refuseUnlessRecord(body, 'body', 'the contribution contract object');
  refuseUnknown(body, CONTRIBUTION_CONTRACT_FIELDS, 'body');
  for (const name of Object.keys(CONTRIBUTION_CONTRACT_SCHEMA.fields)) {
    const field = CONTRIBUTION_CONTRACT_SCHEMA.fields[name];
    if (body[name] === undefined) {
      if (field.required) {
        contractRefusal(`Contribution contract is invalid: body.${name} is required (${field.expectation})`,
          `body.${name}`, field.expectation);
      }
      continue;
    }
  }
  if (!isNonEmptyString(body.subject)) {
    contractRefusal('Contribution contract is invalid: body.subject must be non-empty text',
      'body.subject', 'non-empty text');
  }
  refuseUnlessRecord(body.base, 'body.base', 'an object with observedHead and rebasedOnto');
  refuseUnknown(body.base, ['observedHead', 'rebasedOnto'], 'body.base');
  for (const name of ['observedHead', 'rebasedOnto']) {
    if (!isNonEmptyString(body.base[name])) {
      contractRefusal(`Contribution contract is invalid: body.base.${name} must be non-empty text`,
        `body.base.${name}`, 'non-empty text');
    }
  }
  if (body.commit !== null) {
    refuseUnlessRecord(body.commit, 'body.commit', 'an object with sha and branch, or null');
    refuseUnknown(body.commit, ['sha', 'branch'], 'body.commit');
    for (const name of ['sha', 'branch']) {
      if (!isNonEmptyString(body.commit[name])) {
        contractRefusal(`Contribution contract is invalid: body.commit.${name} must be non-empty text`,
          `body.commit.${name}`, 'non-empty text');
      }
    }
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    contractRefusal('Contribution contract is invalid: body.items must be a non-empty array of item rows',
      'body.items', 'a non-empty array of item rows');
  }
  body.items.forEach((item, index) => {
    const at = `body.items[${index}]`;
    refuseUnlessRecord(item, at, 'an item row');
    refuseUnknown(item, ['id', 'status', 'change', 'files', 'test', 'evidence'], at);
    if (!isNonEmptyString(item.id)) {
      contractRefusal(`Contribution contract is invalid: ${at}.id must be non-empty text`,
        `${at}.id`, 'non-empty text');
    }
    if (!CONTRIBUTION_ITEM_STATUSES.includes(item.status)) {
      contractRefusal(`Contribution contract is invalid: ${at}.status must be`
        + ` one of ${CONTRIBUTION_ITEM_STATUSES.join(', ')}`,
      `${at}.status`, `one of ${CONTRIBUTION_ITEM_STATUSES.join(', ')}`);
    }
    for (const name of ['change', 'test', 'evidence']) {
      if (!isNonEmptyString(item[name])) {
        contractRefusal(`Contribution contract is invalid: ${at}.${name} must be non-empty text`,
          `${at}.${name}`, 'non-empty text');
      }
    }
    if (!Array.isArray(item.files) || !item.files.every(isNonEmptyString)) {
      contractRefusal(`Contribution contract is invalid: ${at}.files must be an array of non-empty strings`,
        `${at}.files`, 'an array of non-empty strings');
    }
  });
  refuseUnlessRecord(body.verification, 'body.verification',
    'an object with targeted, gates, fullSuite and environmentRed');
  refuseUnknown(body.verification, ['targeted', 'gates', 'fullSuite', 'environmentRed'], 'body.verification');
  for (const name of ['targeted', 'fullSuite']) {
    if (typeof body.verification[name] !== 'boolean') {
      contractRefusal(`Contribution contract is invalid: body.verification.${name} must be true or false`,
        `body.verification.${name}`, 'true or false');
    }
  }
  if (!Array.isArray(body.verification.gates)) {
    contractRefusal('Contribution contract is invalid: body.verification.gates must be an array',
      'body.verification.gates', 'an array');
  }
  if (!Array.isArray(body.verification.environmentRed)
    || !body.verification.environmentRed.every(isNonEmptyString)) {
    contractRefusal('Contribution contract is invalid: body.verification.environmentRed must be an array of non-empty strings',
      'body.verification.environmentRed', 'an array of non-empty strings');
  }
  for (const name of ['carriedForward', 'needsFromOthers']) {
    if (!Array.isArray(body[name])) {
      contractRefusal(`Contribution contract is invalid: body.${name} must be an array`,
        `body.${name}`, 'an array');
    }
  }
  if (body.notes !== undefined && typeof body.notes !== 'string') {
    contractRefusal('Contribution contract is invalid: body.notes must be text when present',
      'body.notes', 'any text');
  }
  return body;
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

/** The expected-shape block the recruit brief renders: the contract a lane publishes, so
 * the next lane never has to guess it. One derivation — the brief renders this, never a
 * re-spelled copy. */
export function contributionContractBriefSection() {
  return ['## Contribution contract',
    'Publish your report with swarm.update event swarm.contribution_recorded as one JSON object shaped exactly like this'
    + ' — nothing downstream can consume any other shape:',
    '{subject, base: {observedHead, rebasedOnto}, commit: {sha, branch} | null,'
    + ' items: [{id, status: delivered|partial|not_delivered, change, files, test, evidence}],'
    + ' verification: {targeted, gates, fullSuite, environmentRed}, carriedForward, needsFromOthers, notes}',
    'A publish naming only a bare-string body (no contributionId) is recorded as a note, not a contribution,'
    + ' and wakes nobody: it never substitutes for the contract above.',
  ].join('\n');
}
