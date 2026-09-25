// contribution-contract.mjs — the contribution report shape (#310), tolerant since #598.
//
// A contribution report carries a subject, an optional commit and an items array; the
// documented shape adds base, verification, carriedForward and needsFromOthers, and every
// surface renders those fields when a body carries them. Nothing here validates a publish:
// the runtime records what a seat reports, the orchestrator reads it, and a malformed
// report costs only its own readability.
//
// Two shapes this module does NOT own, by design:
//   • a bare-string body with no contribution identity is not a contribution at all: the
//     runtime admits it as a `note` (CONTRIBUTION_NOTE_KIND), recorded and never waking
//     the contribution_recorded class;
//   • the pre-#310 minimal hand-off ({contract, carriedForward}) keeps folding as ordinary
//     evidence: isContributionContractBody only claims bodies carrying the shape's own
//     keys, so legacy rows are never re-judged.

/** The item lifecycle states — the vocabulary an item status names. */
export const CONTRIBUTION_ITEM_STATUSES = Object.freeze(['delivered', 'partial', 'not_delivered']);

/** The runtime's own durable row for a note: a plain-text publish that is recorded, is not
 * a contribution, and wakes the `note` wake class instead of `contribution_recorded`. */
export const CONTRIBUTION_NOTE_KIND = 'swarm.note_recorded';

/** The stamp the runtime writes onto a commit:null body published from a dirty worktree. */
export const CONTRIBUTION_UNCOMMITTED_STATUS = 'uncommitted_work';

/** The report shape's own keys. `carriedForward` is deliberately absent: the pre-#310
 * minimal hand-off ({contract, carriedForward}) carries it too, and legacy rows are
 * ordinary evidence, never contract claimants. */
const CONTRACT_KEYS = Object.freeze(['subject', 'base', 'commit', 'items', 'verification', 'needsFromOthers']);

/** True when an object body claims the contribution report shape. Anything else (a
 * string finding, the legacy hand-off, an absent body) is not a claim and is admitted
 * exactly as before. */
export function isContributionContractBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false;
  return CONTRACT_KEYS.some((key) => Object.hasOwn(body, key));
}

/** One contract summary row per contribution for swarm.view: the subject, the commit, the
 * item statuses, the verification summary and the hand-off counts. Defensive over stored
 * rows — a view never refuses what the ledger already holds. Null when the body carries
 * no contract. */
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

/** The example payload a brief may print verbatim: the documented tolerant shape with an
 * optional commit. `readOnly` swaps commit for null, the form a read-only seat publishes
 * by design. */
const exampleShape = (readOnly) => Object.freeze({
  subject: 'One-line subject naming the delivered work',
  base: Object.freeze({
    observedHead: '1111111111111111111111111111111111111111',
    rebasedOnto: '2222222222222222222222222222222222222222',
  }),
  commit: readOnly ? null : Object.freeze({
    sha: '3333333333333333333333333333333333333333',
    branch: 'baton/lane-1',
  }),
  items: [Object.freeze({
    id: 'one-item',
    status: 'delivered',
    change: 'What changed',
    files: ['impl/src/one.mjs'],
    test: 'node --test test/one.test.mjs',
    evidence: 'suite green',
  })],
  verification: Object.freeze({
    targeted: true,
    gates: [],
    fullSuite: false,
    environmentRed: [],
  }),
  carriedForward: Object.freeze([]),
  needsFromOthers: Object.freeze([]),
});

/** The example payload in the contributing form. */
export const CONTRIBUTION_CONTRACT_EXAMPLE = exampleShape(false);

/** The example for a seat's mode: `readOnly` (a grant without contribute) swaps commit
 * for null, the form that seat publishes by design. */
export function contributionContractExample({ readOnly = false } = {}) {
  return readOnly ? exampleShape(true) : CONTRIBUTION_CONTRACT_EXAMPLE;
}
