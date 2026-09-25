import { createHash } from 'node:crypto';

/** Read addressed objects and the plain-string form used by existing contributions. */
export function contributionNeeds(contribution) {
  const rows = [];
  const needs = contribution.body?.needsFromOthers;
  for (const value of Array.isArray(needs) ? needs : []) {
    let need = value;
    if (typeof need === 'string') {
      if (!/^(?:the\s+)?root\s*:/i.test(need)) continue;
      need = { to: 'root', ask: need };
    }
    if (typeof need?.ask !== 'string') continue;
    if (need.to !== 'root' && !(need.to === 'participant' && typeof need.participantId === 'string')) continue;
    const needId = `need:${createHash('sha256').update(JSON.stringify([
      need.to, need.participantId ?? null, need.ask,
    ])).digest('hex')}`;
    if (!rows.some((row) => row.needId === needId)) rows.push({ ...need, needId });
  }
  return rows;
}
