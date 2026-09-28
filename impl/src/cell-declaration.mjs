// The cell declaration law (#102 Decision 1, TC-17): `{editing?, quorum?, seat, size, strict?}` —
// the closed run-shape declaration a composition run's member nodes are keyed by. ONE law for every
// seam that reads it: the run intent's own cell, and a caller that declares its cell directly.
// `subject` names the caller in the refusal text, so the same fault reads in the vocabulary of the
// seam that caught it while the CODE stays one.

function declarationError(message, code = 'wave_group_invalid') {
  return Object.assign(new TypeError(message), { code });
}

/** The tight cell's size bound: the count the cell's circuit breaker throttles the per-run worker
 * projection with. */
export const MAX_CELL_SIZE = 64;

// The closed field set of a member's `group` — one declaration shared by every seam that reads it.
export const CELL_GROUP_FIELDS = Object.freeze(['editing', 'quorum', 'seat', 'size', 'strict']);

export function normalizeCellDeclaration(value, subject = 'wave member group') {
  const refuse = (message, code) => { throw declarationError(message, code); };
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !CELL_GROUP_FIELDS.includes(key))) {
    refuse(`${subject} is invalid`, 'wave_group_invalid');
  }
  const seat = value.seat;
  if (seat === undefined) refuse(`${subject} names no seat`, 'wave_group_seat_missing');
  if (!seat || typeof seat !== 'object' || Array.isArray(seat)
    || Object.keys(seat).some((axis) => !['harness', 'model', 'effort'].includes(axis))
    || ['harness', 'model', 'effort'].some((axis) => typeof seat[axis] !== 'string' || seat[axis].length === 0)) {
    refuse(`${subject} seat is invalid`, 'wave_group_invalid');
  }
  const size = value.size;
  if (!Number.isSafeInteger(size) || size < 2 || size > MAX_CELL_SIZE) {
    refuse(`${subject} size must be an integer between 2 and ${MAX_CELL_SIZE}`, 'wave_group_invalid');
  }
  const quorum = value.quorum === undefined ? size : value.quorum;
  if (!Number.isSafeInteger(quorum) || quorum < 1 || quorum > size) {
    refuse(`${subject} quorum must be an integer between 1 and its size`, 'wave_group_invalid');
  }
  const strict = value.strict === undefined ? false : value.strict;
  if (typeof strict !== 'boolean') refuse(`${subject} strict must be a boolean`, 'wave_group_invalid');
  if (strict === true && quorum < size) {
    refuse(`${subject} declares strict with a quorum below its size`, 'wave_group_invalid');
  }
  let editing = null;
  // `null` is the NORMALIZED "no restricted set", so the law accepts its own output: a declaration
  // that has already been through here carries editing: null rather than omitting the key.
  if (value.editing !== undefined && value.editing !== null) {
    const indexes = value.editing;
    if (!Array.isArray(indexes) || indexes.length === 0
      || indexes.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= size)
      || new Set(indexes).size !== indexes.length
      || indexes.some((index, at) => at > 0 && index <= indexes[at - 1])) {
      refuse(`${subject} editing must be a sorted list of distinct in-range member indexes`, 'wave_group_invalid');
    }
    editing = Object.freeze([...indexes]);
  }
  return Object.freeze({
    seat: Object.freeze({ harness: seat.harness, model: seat.model, effort: seat.effort }),
    size, quorum, strict, editing,
  });
}
