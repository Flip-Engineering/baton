// seam-member-source.mjs — issue #259, slice 4: a source scan follows a member to the file the
// split moved it to.
//
// Several pins read a runtime member's own SOURCE TEXT — the coordination fold's event-kind arms,
// the replay binding terms, a member's literals. Until the split, that source was always in
// `coordination-store.mjs` (or the other monolith), so a pin could read the file, or take
// `SomeClass.prototype.member.toString()`, and be right forever. A moved member breaks that
// assumption in a way that says nothing about the behaviour being pinned.
//
// This resolver reads the LIVE seam inventory (`impl/scripts/seam-inventory.mjs`), which already
// knows every member by (file, name, ordinal) and derives its position, so a pin names a MEMBER and
// gets its source wherever the member now lives:
//
//   memberSource('_apply')      the whole member: the class delegate and, for a moved member, the
//                               body in the module that holds it
//   memberSpans('_apply')       the same, as { file, first, last } windows over the live files
//
// A module target's members read their state through an explicit first parameter (`store.`); the
// scan's own spelling is the class's (`this.`), so each window of a module target is normalized
// back. That normalization is the classifier's (`seam-inventory.mjs`: `receiver`), which is what
// keeps a member's evidence, and a pin over its text, reading the same after the move as before.
//
// A name that is not a member — a module-scope function such as `assertTargetSetAdmissible` — has no
// window and is reported as an empty result, so a caller that also wants plain file text can fall
// back to it rather than silently scanning nothing.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { REPO_ROOT_URL, TARGETS, collectSeamInventory } from '../scripts/seam-inventory.mjs';

/** The receiver each target's members read their state through, keyed by target file. */
const RECEIVERS = new Map(TARGETS.map((target) => [target.file, target.receiver ?? 'this']));

let liveInventory = null;
/** The live map, read once per process: re-parsing three monoliths for every call would make a
 * scan that names four members pay for four parses. */
function inventory() {
  if (liveInventory === null) liveInventory = collectSeamInventory();
  return liveInventory;
}

/** Every window one member occupies, in the live files: `{ file, first, last }` with `file`
 * relative to `impl/src/`, one entry per definition of that name (a class may declare a name twice,
 * and a moved member has both its delegate and its body). */
export function memberSpans(name) {
  const spans = [];
  for (const file of inventory().files) {
    const relative = file.file.replace(/^impl\/src\//u, '');
    for (const member of file.members) {
      if (member.name !== name) continue;
      spans.push({ file: relative, first: member.line, last: member.line + member.size - 1, ordinal: member.ordinal });
    }
  }
  return spans;
}

/** The member's own source, verbatim, across every window it occupies, with a module target's
 * explicit receiver normalized back to `this.`. Empty when the name is not a member. */
export function memberSource(name, { separator = '\n' } = {}) {
  const sources = new Map();
  const read = (relative) => {
    if (!sources.has(relative)) sources.set(relative, readFileSync(fileURLToPath(new URL(`impl/src/${relative}`, REPO_ROOT_URL)), 'utf8').split('\n'));
    return sources.get(relative);
  };
  return memberSpans(name).map((span) => {
    const lines = read(span.file).slice(span.first - 1, span.last);
    const receiver = RECEIVERS.get(`impl/src/${span.file}`) ?? 'this';
    const text = lines.join('\n');
    return receiver === 'this' ? text : text.replaceAll(`${receiver}.`, 'this.');
  }).join(separator);
}
