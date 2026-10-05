// CDP runtime lane: the runtime counter (pause epoch and mutation generation).
//
// Contract decision (runtime-counter-boundary-69): epoch and mutationGeneration are
// canonical unsigned decimal STRING text: "0" or [1-9][0-9]*, no sign, whitespace,
// leading zero, fraction or exponent. Each starts at "0" and increments exactly, with
// no finite U32 or JS Number conversion and no wrap. Two admitted counters compare by
// exact text equality.
//
// The canonical reference serialization itself belongs to the codec/core owner; this
// module supplies the counter text those references carry and the transition and
// reference admission that consume it.
//
// No operation here converts a counter to a Number: a counter longer than the exact
// integer range still increments by one, and no admitted counter is ever re-admitted
// because a numeric representation wrapped or lost precision.

export const INITIAL_COUNTER = '0';

// Complete-token ASCII digit admission. A regular expression is deliberately not used:
// JavaScript's `$` also matches before a final line terminator, so a pattern like
// /^[0-9]+$/ would admit "1\n" and counterNext would then increment the terminator. This
// scan admits the whole string as ASCII digits and nothing else.
function allDecimalDigits(text) {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

export function counterValid(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  if (!allDecimalDigits(text)) return false;
  if (text.length > 1 && text[0] === '0') return false;
  return true;
}

// The exact successor of an admitted counter, as canonical text. An unadmitted
// counter refuses rather than being normalized.
export function counterNext(text) {
  if (!counterValid(text)) {
    return { ok: false, condition: 'counterMalformed', detail: typeof text === 'string' ? text : typeof text };
  }
  const digits = text.split('');
  let index = digits.length - 1;
  while (index >= 0) {
    if (digits[index] === '9') {
      digits[index] = '0';
      index -= 1;
      continue;
    }
    digits[index] = String.fromCharCode(digits[index].charCodeAt(0) + 1);
    return { ok: true, value: digits.join('') };
  }
  return { ok: true, value: `1${digits.join('')}` };
}

// Both identity members of one record, admitted together.
export function counterPair(epoch, mutationGeneration) {
  if (!counterValid(epoch)) return { ok: false, condition: 'counterMalformed', detail: `epoch ${typeof epoch}` };
  if (!counterValid(mutationGeneration)) {
    return { ok: false, condition: 'counterMalformed', detail: `mutationGeneration ${typeof mutationGeneration}` };
  }
  return { ok: true, epoch, mutationGeneration };
}

// The transport's own request ids are not runtime counters and keep their numeric
// schema; this check exists so a caller never publishes an id as a runtime identity.
export function counterFromTransportId(id) {
  return Number.isSafeInteger(id) && id >= 0 ? null : 'counterMalformed';
}
