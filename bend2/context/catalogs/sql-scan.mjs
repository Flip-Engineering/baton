// Statement boundary scan.
//
// The Node SQLite binding prepares the first statement of a text and exposes no
// tail pointer, so a text carrying a second statement would silently drop it.
// This scan finds top-level separators and frames the text; relation identity
// always comes from the engine parse of the admitted single statement.
//
// Coordinate domain: every position this module reports (segment start and end,
// separators, unterminated openings) is a zero-based UTF-16 code-unit index
// into the JavaScript string it was given, which is also the index used for
// slice. It is not a UTF-8 byte offset: for `SELECT 'é'; SELECT 2` the first
// separator is code unit 10 and byte 11. A caller that needs byte offsets must
// map through the strict original bytes it read; this module performs no such
// mapping and reports the domain it used.
//
// String admission here applies to the decoded string. Rejecting an unpaired
// surrogate over a JavaScript string cannot establish that the original bytes
// were valid UTF-8 before a replacement decoder touched them; that check
// belongs to the raw reader, and its diagnostics carry string coordinates.
//
// The admitted dialect matches the engine that will parse the text. SQLite
// admits single-quoted strings, double-quoted and bracket-quoted identifiers,
// backtick identifiers, `--` line comments and `/* */` block comments.
// PostgreSQL additionally admits `$tag$` dollar quoting. A SQLite text carrying
// `$tag$` is read as a parameter rather than as a quoted region, so a separator
// inside it stays a separator and the text refuses.

export const SCAN_DIALECTS = Object.freeze(['sqlite', 'postgres']);

// The domain of every position in this module's results.
export const SCAN_COORDINATE_DOMAIN = 'utf16-code-unit';

function skipQuoted(sql, index, quote) {
  let cursor = index + 1;
  while (cursor < sql.length) {
    if (sql[cursor] === quote) {
      if (sql[cursor + 1] === quote) {
        cursor += 2;
        continue;
      }
      return { end: cursor + 1, closed: true };
    }
    cursor += 1;
  }
  return { end: sql.length, closed: false };
}

function readDollarTag(sql, index) {
  const match = /^\$[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*\$|^\$\$/.exec(sql.slice(index));
  return match ? match[0] : null;
}

function hasContent(text) {
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === '-' && text[index + 1] === '-') {
      const newline = text.indexOf('\n', index + 2);
      index = newline === -1 ? text.length : newline + 1;
      continue;
    }
    if (character === '/' && text[index + 1] === '*') {
      const close = text.indexOf('*/', index + 2);
      index = close === -1 ? text.length : close + 2;
      continue;
    }
    return true;
  }
  return false;
}

// Text admission before the engine sees the text. The checks below apply to the
// decoded string: NUL and unpaired surrogates are reported with their UTF-16
// code-unit positions, because an original byte position is not available here.
// Reason codes are unchanged for existing callers; only the diagnostic wording
// names the coordinate domain.
export function validateSqlText(sql) {
  if (typeof sql !== 'string') return { status: 'refused', reason: 'notText', detail: 'the statement must be a string' };
  const nul = sql.indexOf('\u0000');
  if (nul !== -1) return { status: 'refused', reason: 'nulByte', detail: `the text carries a NUL character at code-unit offset ${nul}` };
  for (let index = 0; index < sql.length; index += 1) {
    const code = sql.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = sql.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return { status: 'refused', reason: 'invalidUtf8', detail: `unpaired high surrogate at code-unit offset ${index}` };
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return { status: 'refused', reason: 'invalidUtf8', detail: `unpaired low surrogate at code-unit offset ${index}` };
  }
  return { status: 'admitted' };
}

export function scanSqlStatements(sql, { dialect = 'sqlite' } = {}) {
  if (typeof sql !== 'string') throw new TypeError('sql text must be a string');
  if (!SCAN_DIALECTS.includes(dialect)) throw new RangeError(`unsupported scan dialect ${JSON.stringify(dialect)}`);
  const segments = [];
  const separators = [];
  let unterminated = null;
  let start = 0;
  let index = 0;

  while (index < sql.length) {
    const character = sql[index];
    const next = sql[index + 1];
    if (character === "'" || character === '"' || character === '`') {
      const quoted = skipQuoted(sql, index, character);
      if (!quoted.closed) unterminated = { offset: index, quote: character };
      index = quoted.end;
      continue;
    }
    if (character === '[') {
      const close = sql.indexOf(']', index + 1);
      if (close === -1) unterminated = { offset: index, quote: '[' };
      index = close === -1 ? sql.length : close + 1;
      continue;
    }
    if (character === '$' && dialect === 'postgres') {
      const tag = readDollarTag(sql, index);
      if (tag !== null) {
        const close = sql.indexOf(tag, index + tag.length);
        if (close === -1) unterminated = { offset: index, quote: tag };
        index = close === -1 ? sql.length : close + tag.length;
        continue;
      }
    }
    if (character === '-' && next === '-') {
      const newline = sql.indexOf('\n', index + 2);
      index = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (character === '/' && next === '*') {
      const close = sql.indexOf('*/', index + 2);
      if (close === -1) unterminated = { offset: index, quote: '/*' };
      index = close === -1 ? sql.length : close + 2;
      continue;
    }
    if (character === ';') {
      separators.push(index);
      segments.push({ start, end: index, text: sql.slice(start, index) });
      start = index + 1;
      index += 1;
      continue;
    }
    index += 1;
  }
  segments.push({ start, end: sql.length, text: sql.slice(start) });

  const finalSegment = segments[segments.length - 1];
  const statements = segments
    .map((segment, position) => ({ ...segment, position, hasContent: hasContent(segment.text) }))
    .filter(segment => segment.hasContent);
  return {
    dialect,
    coordinateDomain: SCAN_COORDINATE_DOMAIN,
    statements: statements.map(({ start: segmentStart, end, text, hasContent: content, position }) => ({ position, start: segmentStart, end, text, hasContent: content })),
    separators,
    statementCount: statements.length,
    trailingHasContent: separators.length > 0 && hasContent(finalSegment.text),
    unterminated,
  };
}
