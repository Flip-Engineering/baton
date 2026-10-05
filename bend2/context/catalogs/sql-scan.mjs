// Statement boundary scan.
//
// The Node SQLite binding prepares the first statement of a text and exposes no
// tail pointer, so a text carrying a second statement would silently drop it.
// This scan finds top-level separators and reports their byte offsets. It
// frames the text; relation identity always comes from the engine parse of the
// admitted single statement.
//
// The admitted dialect matches the engine that will parse the text. SQLite
// admits single-quoted strings, double-quoted and bracket-quoted identifiers,
// backtick identifiers, `--` line comments and `/* */` block comments.
// PostgreSQL additionally admits `$tag$` dollar quoting. A SQLite text carrying
// `$tag$` is read as a parameter rather than as a quoted region, so a separator
// inside it stays a separator and the text refuses.

export const SCAN_DIALECTS = Object.freeze(['sqlite', 'postgres']);

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

// Text admission before the engine sees the text: NUL and unpaired surrogates
// make the byte scan and the engine's own reading describe different texts.
export function validateSqlText(sql) {
  if (typeof sql !== 'string') return { status: 'refused', reason: 'notText', detail: 'the statement must be a string' };
  const nul = sql.indexOf('\u0000');
  if (nul !== -1) return { status: 'refused', reason: 'nulByte', detail: `the text carries a NUL byte at offset ${nul}` };
  for (let index = 0; index < sql.length; index += 1) {
    const code = sql.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = sql.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return { status: 'refused', reason: 'invalidUtf8', detail: `unpaired high surrogate at offset ${index}` };
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return { status: 'refused', reason: 'invalidUtf8', detail: `unpaired low surrogate at offset ${index}` };
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
    statements: statements.map(({ start: segmentStart, end, text, hasContent: content, position }) => ({ position, start: segmentStart, end, text, hasContent: content })),
    separators,
    statementCount: statements.length,
    trailingHasContent: separators.length > 0 && hasContent(finalSegment.text),
    unterminated,
  };
}
