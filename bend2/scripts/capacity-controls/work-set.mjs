// Discovery of the exhaustive-control work set through the checker's own
// executed definitions. laws() reads every `law <name>:` under bend2/src and
// mutations() returns the checker's mutation array, initial literal and later
// pushes in source order. This module only names controls, hashes the bytes
// that decide each one, and binds the set; it parses nothing of its own.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { MUTATIONS } from '../laws-mutations.mjs';
import { laws, proofBlockRange, ROOT } from '../laws-check.mjs';

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function posixPath(path) {
  return path.split(sep).join('/');
}

// The bytes that decide one proof control: the law statement line plus the
// def block the control removes.
export function proofDefinition(text, law) {
  const lines = text.split('\n');
  const index = lines.findIndex((line) => line.startsWith(`law ${law}:`));
  if (index === -1) throw new Error(`proofDefinition: no law line for ${law}`);
  const block = proofBlockRange(text, law);
  if (!block) throw new Error(`proofDefinition: no def proof for ${law}`);
  return lines[index] + '\n' + block.lines.slice(block.start, block.end).join('\n');
}

// The bytes that decide one mutation control: the target file, the find and
// replace texts, the intended law and the definition owner's expected/observed
// constructor metadata when it is bound. External expectation sources do not
// exist; this digest is the only binding.
export function mutationDefinition(mutation) {
  const definition = { file: mutation.file, find: mutation.find, replace: mutation.replace, law: mutation.law };
  if (mutation.expected !== undefined) definition.expected = mutation.expected;
  if (mutation.observed !== undefined) definition.observed = mutation.observed;
  return JSON.stringify(definition);
}

// The definition owner's expected/observed metadata, or undefined.
export function definitionExpectation(mutation) {
  if (mutation.expected === undefined && mutation.observed === undefined) return undefined;
  return { expected: mutation.expected, observed: mutation.observed };
}

// One record per control. Ids are unique across the set; a collision is a
// discovery failure, never a silent merge. `bend2Dir` binds discovery to one
// copied tree: laws are read from its src and mutation target bytes from its
// modules, so records and compiles share one snapshot. The default is the
// live bend2 tree.
export function discoveryRecords({ bend2Dir = join(ROOT, 'bend2') } = {}) {
  const records = [];
  const seen = new Set();
  const push = (record) => {
    if (seen.has(record.id)) throw new Error(`discoveryRecords: duplicate control id ${record.id}`);
    seen.add(record.id);
    records.push(record);
  };
  for (const { law, file } of laws(join(bend2Dir, 'src'))) {
    push({
      id: `proof:${law}`,
      kind: 'proof-removal',
      law,
      module: posixPath(relative(ROOT, file).startsWith('bend2/') ? relative(ROOT, file) : join('bend2', relative(bend2Dir, file)).split(sep).join('/')),
      definition_sha256: sha256Hex(proofDefinition(readFileSync(file, 'utf8'), law)),
    });
  }
  for (const mutation of MUTATIONS) {
    const expectation = definitionExpectation(mutation);
    push({
      id: `mutation:${mutation.name}`,
      kind: 'mutation',
      law: mutation.law,
      module: posixPath(mutation.file),
      definition_sha256: sha256Hex(mutationDefinition(mutation)),
      ...(expectation !== undefined ? { expectation } : {}),
    });
  }
  return records;
}

// sha256 over the tab-joined field rows of the sorted records, field order
// id, kind, law, module, definition_sha256. Serialization pinned for
// cross-language consumers: rows are raw UTF-8 text (no JSON escaping), fields
// are joined by one TAB (0x09), rows by one LF (0x0A), no trailing newline,
// and rows sort by unsigned UTF-8 byte order. This digest is the binding every
// group manifest and aggregate summary carries.
export function bindingRows(records) {
  return records
    .map((record) => [record.id, record.kind, record.law, record.module, record.definition_sha256].join('\t'))
    .sort((left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')));
}

export function bindingOf(records) {
  return sha256Hex(bindingRows(records).join('\n'));
}

export function recordsForModule(records, module) {
  return records.filter((record) => record.module === module);
}

export function groupModules(records) {
  return [...new Set(records.map((record) => record.module))].sort();
}

// `laws-check.mjs --discover`: one JSON discovery record per line.
export function discoverCli(argv) {
  if (argv.length) {
    console.error(`discover takes no arguments, got: ${argv.join(' ')}`);
    process.exit(2);
  }
  for (const record of discoveryRecords()) console.log(JSON.stringify(record));
}
