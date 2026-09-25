import { createHash } from 'node:crypto';

export const CONTRIBUTION_NEED_SCHEMA = Object.freeze({
  type: 'object',
  fields: Object.freeze({
    to: { type: 'string', required: true, enum: ['root', 'participant'], expectation: 'root or participant' },
    participantId: { type: 'string', required: false, expectation: 'a participant identity when to is participant' },
    ask: { type: 'string', required: true, expectation: 'non-empty text' },
  }),
});
const nonempty = (value) => typeof value === 'string' && value.length > 0;

export function validateContributionNeed(need, field, refuse) {
  if (!need || typeof need !== 'object' || Array.isArray(need)) {
    refuse(field, 'type', 'an addressed need object {to, ask}, with participantId when to is participant');
  }
  for (const key of Object.keys(need)) {
    if (!Object.hasOwn(CONTRIBUTION_NEED_SCHEMA.fields, key)) refuse(`${field}.${key}`, 'unknown-field', 'to, participantId, ask');
  }
  if (!CONTRIBUTION_NEED_SCHEMA.fields.to.enum.includes(need.to)) refuse(`${field}.to`, 'enum', 'root or participant');
  if (!nonempty(need.ask)) refuse(`${field}.ask`, 'type', 'non-empty text');
  if (need.to === 'participant' && !nonempty(need.participantId)) refuse(`${field}.participantId`, 'required', 'a participant identity');
  if (need.to === 'root' && Object.hasOwn(need, 'participantId')) refuse(`${field}.participantId`, 'unknown-field', 'no participant identity on a root need');
}

/** String needs occur in historical contributions admitted before typed addressing. */
export function contributionNeeds(contribution) {
  const rows = [];
  const needs = contribution.body?.needsFromOthers;
  for (const value of Array.isArray(needs) ? needs : []) {
    let need = value;
    if (typeof need === 'string') {
      if (!/^(?:the\s+)?root\s*:/i.test(need)) continue;
      need = { to: 'root', ask: need };
    }
    try { validateContributionNeed(need, 'need', () => { throw new Error('invalid historical need'); }); }
    catch { continue; }
    const needId = `need:${createHash('sha256').update(JSON.stringify([
      need.to, need.participantId ?? null, need.ask,
    ])).digest('hex')}`;
    if (!rows.some((row) => row.needId === needId)) rows.push({ ...need, needId });
  }
  return rows;
}
