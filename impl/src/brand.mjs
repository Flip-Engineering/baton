// Flip — the baton mascot (docs/assets/brand/mascot-smile.svg) — as BRAND IDENTITY only
// (docs/38-flip-experience.md, operator decision 2026-09-14). One static mark, the smile:
// big round eyes, the wide smile, gold cheek sparkles. No pose vocabulary, no pose
// derivation, no pose field anywhere. The mark and the stderr status channel go to the
// human channel only — stdout stays machine-clean JSON. ANSI color only when the stream
// is a TTY; the status channel is silent when stderr is piped.
//
// The ANSI table stays literally empty (the shipped foundation's stance): the color hook
// exists so a renderer MAY light the mark, and today no escape byte is ever emitted.

const ANSI = Object.freeze({
  pink: '',
  gold: '',
  teal: '',
  reset: '',
});

const SMILE = Object.freeze({
  plain: '✦(◕‿◕)✦',
  ansi: `${ANSI.gold}✦${ANSI.pink}(◕‿◕)${ANSI.gold}✦${ANSI.reset}`,
});

/**
 * The one brand mark. `pose` is kept as a single-value argument so existing callers
 * (the MCP server instructions line) keep working; anything but the smile refuses
 * typed — the pose vocabulary was retired with the operator decision of 2026-09-14
 * (docs/38-flip-experience.md §3).
 * @param {'smile'} [pose]
 * @param {{color?: boolean}} [opts] — color defaults off; callers pass stream.isTTY === true.
 */
export function flipFace(pose = 'smile', { color = false } = {}) {
  if (pose !== 'smile') {
    throw Object.assign(new Error(`unknown Flip pose: ${pose} — Flip is brand identity only; the smile is the one mark`), {
      code: 'brand_pose_invalid',
    });
  }
  return color ? SMILE.ansi : SMILE.plain;
}

/** One-line brand mark for interactive moments (startup, serve lifecycle, doctor). */
export function flipLine(text, { color = false } = {}) {
  return `${flipFace('smile', { color })} ${text}`;
}

// ── the stderr status channel ──────────────────────────────────────────────────────────────────
//
// A closed set of plain status glyphs and words (operator decision, docs/38 §3): an operator
// running many lanes needs rows, not a face. The set is derived from the projection classes the
// machine surfaces already expose — never a second source of truth — by ONE function,
// `flipStatus`. The honesty law (docs/38-flip-experience.md §3): if a status cannot be derived
// from the projections it does not exist — `flipStatus` answers null for a class outside the
// derivation instead of inventing state, and the line renders without a status prefix.

export const FLIP_STATUS_SET = Object.freeze([
  'ready', 'working', 'needs you', 'refused', 'stalled', 'idle', 'draining', 'done',
]);

const STATUS_ROWS = Object.freeze({
  ready: Object.freeze({ status: 'ready', glyph: '●', word: 'ready' }),
  working: Object.freeze({ status: 'working', glyph: '◐', word: 'working' }),
  'needs you': Object.freeze({ status: 'needs you', glyph: '▲', word: 'needs you' }),
  refused: Object.freeze({ status: 'refused', glyph: '✗', word: 'refused' }),
  stalled: Object.freeze({ status: 'stalled', glyph: '‖', word: 'stalled' }),
  idle: Object.freeze({ status: 'idle', glyph: '○', word: 'idle' }),
  draining: Object.freeze({ status: 'draining', glyph: '⇣', word: 'draining' }),
  done: Object.freeze({ status: 'done', glyph: '✓', word: 'done' }),
});

// ONE derivation: projection class → closed status. Keys are the class literals the
// projections already carry (run phases, worker/seat runtime states, attention classes,
// the serve lifecycle states). Nothing here invents a state the machine surfaces do not
// expose; a new projection class joins by editing this one table.
const STATUS_DERIVATION = Object.freeze({
  // ready — published, bound, ready routes; an OPEN swarm (its closed sibling is already `done`)
  // and the resident lifecycle classes (a resident that started or was replaced is serving)
  ready: 'ready', hosted: 'ready', published: 'ready', listening: 'ready',
  open: 'ready', resident_lifecycle: 'ready', incarnation_changed: 'ready',
  // working — an active run, seat, or wave
  working: 'working', running: 'working', progressing: 'working', executing: 'working',
  // needs you — a human must act (docs/38: the attention class, a parked decision, a paused
  // turn waiting for a claim/nudge, a provider selection waiting on the caller). The wake classes
  // that name a lifecycle state of their subject join here (docs/56 D1): a parked resume decision,
  // a proposed reroute, capacity the operator must free, and an owed contribution the root alone
  // can check all wait on a person.
  attention: 'needs you', blocked: 'needs you', blocked_interaction: 'needs you',
  parked: 'needs you', awaiting: 'needs you', question: 'needs you',
  selection_required: 'needs you', paused: 'needs you',
  resume_decision_required: 'needs you', reroute_proposed: 'needs you',
  capacity_pressure: 'needs you', root_owed: 'needs you',
  // The canonical run phases that wait on a person, together with the legacy spelling the run's
  // own projection still carries: `awaiting_approval` holds a Plan for the operator and
  // `awaiting_selection` an accepted result for one; the generic `awaiting` row above anticipated
  // them by name only.
  awaiting_approval: 'needs you', awaiting_selection: 'needs you',
  awaiting_plan_approval: 'needs you',
  // refused — the typed-refusal family and terminal-crash worker states
  refused: 'refused', failed: 'refused', denied: 'refused', error: 'refused',
  invalid: 'refused', dead: 'refused', exited: 'refused',
  // stalled — a member stalled or the watchdog escalated
  stalled: 'stalled', watchdog: 'stalled',
  // idle — nothing running, nothing asked; a queued member waits its turn
  idle: 'idle', unbound: 'idle', sleeping: 'idle', queued: 'idle',
  // draining — a signal arrived and the fleet is draining
  draining: 'draining', stopping: 'draining', closing: 'draining', signal: 'draining',
  // done — terminal, nothing left running (including a lifecycle that ended by
  // cancellation/stop/leave: finished, not softened into success prose)
  done: 'done', completed: 'done', work_completed: 'done', result_ready: 'done',
  closed: 'done', integrated: 'done', cancelled: 'done', stopped: 'done', left: 'done',
  contribution_integrated: 'done',
});

/**
 * The ONE status derivation: a projection class → the closed `{status, glyph, word, text}`
 * row, or null when the class carries no derivable status (docs/38 honesty law: an
 * undervivable status does not exist — it is never invented).
 * @param {string|null|undefined} statusClass a projection class literal (run phase, worker
 *   runtime state, attention class, serve lifecycle state).
 * @param {{color?: boolean}} [opts] — color defaults off; callers pass stream.isTTY === true.
 * @returns {{status: string, glyph: string, word: string, text: string}|null}
 */
export function flipStatus(statusClass, { color = false } = {}) {
  const status = STATUS_DERIVATION[statusClass];
  if (status === undefined) return null;
  const row = STATUS_ROWS[status];
  const text = color ? `${ANSI.gold}${row.glyph}${ANSI.reset} ${row.word}` : `${row.glyph} ${row.word}`;
  return { ...row, text };
}

/** The ONE derivation as plain data: `{derivation, rows}` with no color and no ANSI. A renderer that
 * runs where this module cannot (the browser Run desk, whose page is served as text) carries this
 * projection and applies it at render time, so it names a class with the same words as every other
 * surface while the table itself stays in this one module. */
export function flipStatusTable() {
  return Object.freeze({
    derivation: STATUS_DERIVATION,
    rows: Object.freeze(Object.fromEntries(Object.entries(STATUS_ROWS)
      .map(([status, row]) => [status, Object.freeze({ status, glyph: row.glyph, word: row.word })]))),
  });
}

/** The statused prefix a human-facing wake row carries for one projection class: `<glyph> <word> —
 * `, or the empty string when the class derives no status. The ONE spelling every wake-row
 * rendering shares — the seat brief's wake lines, the root wake message and the `baton top`
 * timeline all read it, so one class reads the same wherever Baton names it, and an event-shaped
 * class (a contribution landing, a work update) is never given a status it does not have. */
export function flipStatusPrefix(statusClass, { color = false } = {}) {
  const status = flipStatus(statusClass, { color });
  return status === null ? '' : `${status.text} — `;
}

// ── the mark rule ──────────────────────────────────────────────────────────────────────────────
//
// ONE rule for the mark wherever Baton speaks to a person: the mark rides a line Baton writes FOR A
// PERSON TO READ — the stderr channel on a TTY, the `baton top` frame, the MCP instructions field,
// a message delivered into a person's session — and never a machine channel (stdout JSON, an MCP
// tool result, a wake frame, a bridge envelope). `flipHumanLine` is the one function that composes
// such a line; the human-facing renderers read it, and nothing else spells the mark.

/** Compose one human-facing line: the mark, the derived status when the class carries one, the text. */
export function flipHumanLine(text, { statusClass = null, color = false } = {}) {
  return `${flipFace('smile', { color })} ${flipStatusPrefix(statusClass, { color })}${text}`;
}

/** The status channel is a TTY channel: silent when stderr is piped (docs/38 §2.3/§8).
 * Compose one statused stderr line through the ONE mark rule: mark + status + text on a TTY, the
 * bare text otherwise. */
export function flipAnnounce(statusClass, text, { tty = false, color = false } = {}) {
  if (!tty) return text;
  return flipHumanLine(text, { statusClass, color });
}
