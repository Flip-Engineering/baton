// wake-render.mjs — the human rendering of one wake frame (issue #585, docs/55 S9).
//
// The audit's S9 finding: the wake stream is the most honest surface Baton has, and its gap is
// presentational — on the CLI a frame is JSON per line, and the human-readable form lived only
// inside `baton top`'s timeline view. This module is that form for the live follow legs.
//
// The rendering obeys the channel law (docs/38 §2.3/§8, docs/56): it is written to stderr, on a
// TTY only, and stdout keeps its one machine-clean JSON frame per row. It uses the ONE mark rule
// (`flipHumanLine`, brand.mjs) and the ONE wake-row prefix (`flipStatusPrefix`), so a class reads
// the same word here as in the seat brief's wake lines, the root wake message and the timeline.
//
// What it renders is what the frame carries and nothing else: the sequence, the class, the
// subject, and the next action the frame itself spells as a runnable command. A class that
// derives no status renders without a status word (the honesty law: an event is not a state).

import { flipHumanLine } from './brand.mjs';

/** The frame's subject as ` <kind> <id>`, or '' when the row carries none. */
function subjectLabel(frame) {
  const kind = typeof frame?.subject?.kind === 'string' && frame.subject.kind.length > 0
    ? frame.subject.kind : null;
  const id = typeof frame?.subject?.id === 'string' && frame.subject.id.length > 0
    ? frame.subject.id : null;
  if (kind === null && id === null) return '';
  return ` ${[kind, id].filter((part) => part !== null).join(' ')}`;
}

/**
 * One human line for one wake frame, or null.
 *
 * @param {object} frame a `baton.wake` frame (the shape `deriveWakeFrame` serves).
 * @param {{tty?: boolean}} [options] — `tty` defaults false: the human channel is a TTY channel,
 *   and a piped stderr receives nothing (the S1 law).
 * @returns {string|null} the line, or null when this is not a wake frame or the channel is piped.
 */
export function renderWakeLine(frame, { tty = false } = {}) {
  if (tty !== true) return null;
  if (frame === null || typeof frame !== 'object' || Array.isArray(frame)) return null;
  if (frame.kind !== 'baton.wake' || typeof frame.wakeClass !== 'string' || frame.wakeClass.length === 0) return null;
  const seq = Number.isSafeInteger(frame.seq) ? `#${frame.seq} ` : '';
  const next = typeof frame.next === 'string' && frame.next.length > 0 ? ` · next: ${frame.next}` : '';
  return flipHumanLine(
    `${seq}${frame.wakeClass}${subjectLabel(frame)}${next}`,
    { statusClass: frame.wakeClass },
  );
}

/**
 * Write one follow page on both channels: the caller's machine projection as one JSON row on
 * stdout, and the human line on stderr when stderr is a TTY. This is the ONE place the follow legs
 * decide their channels, so the machine channel stays clean wherever the leg runs.
 *
 * @param {object} input
 * @param {object} input.page    the row the stream delivered.
 * @param {(page: object) => unknown} input.project  the caller's machine projection.
 * @param {{write: (text: string) => unknown}} input.stdout
 * @param {{write: (text: string) => unknown}} input.stderr
 * @param {boolean} input.tty    whether stderr is a terminal (`process.stderr.isTTY === true`).
 * @returns {boolean} whether a human line was written.
 */
export function writeFollowPage({ page, project, stdout, stderr, tty }) {
  stdout.write(`${JSON.stringify(project(page))}\n`);
  const humanLine = renderWakeLine(page, { tty });
  if (humanLine === null) return false;
  stderr.write(`${humanLine}\n`);
  return true;
}
