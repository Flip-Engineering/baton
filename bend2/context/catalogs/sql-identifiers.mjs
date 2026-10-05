// Dialect identifier folding for the catalog join.
//
// The join compares stored catalog names with names recovered from an engine
// parse of the statement. Folding rules come from the engine, not from a
// case-insensitive string search:
// - SQLite compares identifiers with ASCII case folding, quoted or not
//   (sqlite3_stricmp over the stored name).
// - PostgreSQL folds unquoted identifiers to lower case with the locale of the
//   database encoding; a quoted identifier keeps its exact bytes.

export const DIALECTS = Object.freeze(['sqlite', 'postgres']);

export function assertDialect(dialect) {
  if (!DIALECTS.includes(dialect)) {
    throw new RangeError(`unsupported dialect ${JSON.stringify(dialect)}; admitted dialects are ${DIALECTS.join(', ')}`);
  }
}

function asciiLower(text) {
  return text.replace(/[A-Z]/g, character => String.fromCharCode(character.charCodeAt(0) + 32));
}

// `quoted` states whether the source spelling used a quoted identifier. The
// ASCII-fold rule PostgreSQL applies to unquoted names is the database
// encoding's folding for the admitted profile: the qualified platform runs the
// UTF-8 database encoding, where upper-case ASCII folds to lower-case ASCII.
export function foldIdentifier({ dialect, text, quoted = false }) {
  assertDialect(dialect);
  if (typeof text !== 'string') throw new TypeError('identifier text must be a string');
  if (dialect === 'sqlite') return asciiLower(text);
  return quoted ? text : asciiLower(text);
}

export function identifiersMatch({ dialect, queryText, queryQuoted = false, storedName }) {
  return foldIdentifier({ dialect, text: queryText, quoted: queryQuoted })
    === foldIdentifier({ dialect, text: storedName, quoted: true });
}
