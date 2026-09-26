// attention-message.mjs — the message a person reads when Baton owes them attention (issue #585).
//
// This is a pure composer over one owed item. It does not know how the message reaches a session:
// the attention dispatcher calls it; the message is human text composed through the one
// mark rule (brand.mjs flipHumanLine) and carries no JSON. Every value the item carries is shown
// whole: the ask, the subject and the identities are the facts the reader needs to act, and none
// is shortened.
import { flipHumanLine } from './brand.mjs';

const text = (value) => (typeof value === 'string' && value.length > 0 ? value : null);

/** The owed kinds in words, keyed by the `owed` value a swarm.root_attention_owed row carries. */
const OWED_WORDS = Object.freeze({
  review_owed: 'review owed',
  needs_root: 'answer owed',
  turn_reported: 'turn report to read',
});

/** The command that answers an owed item, in the CLI spelling seats are taught. A check needs a
 * check id the reader chooses, so the command names the placeholder. Null when an identity the
 * command needs is missing. */
function nextCommand(item) {
  const next = item.next !== null && typeof item.next === 'object' ? item.next : {};
  const pick = (name) => text(next[name]) ?? text(item[name]);
  if (next.command === 'swarm.check') {
    const ids = [pick('swarmId'), pick('participantId'), pick('contributionId')];
    return ids.every(Boolean) ? `baton swarm check ${ids.join(' ')} CHECK_ID` : null;
  }
  if (next.command === 'swarm.view') {
    const swarmId = pick('swarmId');
    return swarmId === null ? null : `baton swarm view ${swarmId}`;
  }
  return null;
}

/**
 * The message for one item owed to a principal (the root today).
 *
 * @param {object} item `{owed, swarmId, participantId, contributionId, subject, ask, next}`; only
 *   `owed` and `swarmId` are required, and a field that is absent is left out of the message.
 * @param {{statusClass?: string|null}} [options] the wake class the mark rule derives a status from.
 * @returns {string} the message, one fact per line.
 */
export function composeOwedMessage(item, { statusClass = 'root_owed' } = {}) {
  const owed = text(item?.owed) ?? 'attention owed';
  const lines = [flipHumanLine(`${OWED_WORDS[owed] ?? owed} in ${text(item?.swarmId) ?? 'an unnamed swarm'}`,
    { statusClass })];
  const seat = [text(item?.participantId), text(item?.contributionId)].filter(Boolean).join(' · ');
  if (seat.length > 0) lines.push(`  from: ${seat}`);
  if (text(item?.subject) !== null) lines.push(`  subject: ${item.subject}`);
  if (text(item?.ask) !== null) lines.push(`  ask: ${item.ask}`);
  const command = nextCommand(item ?? {});
  if (command !== null) lines.push(`  next: ${command}`);
  return lines.join('\n');
}

/**
 * The message for one worker turn report owed to its orchestrator.
 *
 * @param {object} report `{worker, resultStatus, report, runId}`; `resultStatus` falls back to
 *   `report.status`.
 * @param {{statusClass?: string|null}} [options]
 * @returns {string}
 */
export function composeTurnReportMessage(report, { statusClass = 'root_turn_reported' } = {}) {
  const status = text(report?.resultStatus) ?? text(report?.report?.status);
  const subject = [status, text(report?.worker)].filter(Boolean).join(' · ');
  const lines = [flipHumanLine(`turn reported${subject.length > 0 ? `: ${subject}` : ''}`, { statusClass })];
  if (text(report?.runId) !== null) {
    lines.push(`  run: ${report.runId}`);
    lines.push(`  next: baton run view ${report.runId}`);
  }
  return lines.join('\n');
}
