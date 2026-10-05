// Reference JSON document representation and RFC 6901 pointers for the
// dataset boundary fixture.
//
// The dataset domain must carry complete selected values without acquiring
// the closed request-numeric profile (request canonical Json admits U32
// only). This reference keeps every scalar's exact source token, so signed,
// fractional, exponent and beyond-double integers survive traversal
// unchanged. It is independent code: no producer module is imported.

// Minimal JSON tokenizer that records scalar token spellings.
export function parseDocument(text) {
  const tokens = [];
  let index = 0;

  const fail = message => { throw new SyntaxError(`${message} at byte ${index}`); };
  const skipWhitespace = () => { while (index < text.length && ' \t\n\r'.includes(text[index])) index += 1; };
  const startsWith = literal => { if (!text.startsWith(literal, index)) return false; index += literal.length; return true; };

  function readString() {
    const start = index;
    index += 1;
    let value = '';
    for (;;) {
      if (index >= text.length) fail('unterminated string');
      const character = text[index];
      if (character === '"') { index += 1; return { text: text.slice(start, index), value }; }
      if (character === '\\') {
        const escape = text[index + 1];
        if (escape === 'u') {
          const hex = text.slice(index + 2, index + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('invalid unicode escape');
          value += String.fromCharCode(parseInt(hex, 16));
          index += 6;
          continue;
        }
        const pairs = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (!(escape in pairs)) fail('invalid escape');
        value += pairs[escape];
        index += 2;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) fail('control character in string');
      value += character;
      index += 1;
    }
  }

  function readNumber() {
    const start = index;
    if (text[index] === '-') index += 1;
    if (text[index] === '0') index += 1;
    else if (/[1-9]/.test(text[index] ?? '')) { while (index < text.length && /[0-9]/.test(text[index])) index += 1; }
    else fail('invalid number');
    if (text[index] === '.') { index += 1; if (!/[0-9]/.test(text[index] ?? '')) fail('invalid fraction'); while (index < text.length && /[0-9]/.test(text[index])) index += 1; }
    if (text[index] === 'e' || text[index] === 'E') {
      index += 1;
      if (text[index] === '+' || text[index] === '-') index += 1;
      if (!/[0-9]/.test(text[index] ?? '')) fail('invalid exponent');
      while (index < text.length && /[0-9]/.test(text[index])) index += 1;
    }
    return { token: text.slice(start, index) };
  }

  function readValue() {
    skipWhitespace();
    if (index >= text.length) fail('unexpected end');
    const character = text[index];
    if (character === '{') {
      index += 1;
      const members = [];
      skipWhitespace();
      if (startsWith('}')) return { kind: 'object', members };
      for (;;) {
        skipWhitespace();
        if (text[index] !== '"') fail('object key must be a string');
        const key = readString();
        skipWhitespace();
        if (text[index] !== ':') fail('expected colon');
        index += 1;
        const value = readValue();
        members.push({ key: key.value, keyToken: key.text, value });
        skipWhitespace();
        if (startsWith(',')) continue;
        if (startsWith('}')) return { kind: 'object', members };
        fail('expected , or }');
      }
    }
    if (character === '[') {
      index += 1;
      const items = [];
      skipWhitespace();
      if (startsWith(']')) return { kind: 'array', items };
      for (;;) {
        items.push(readValue());
        skipWhitespace();
        if (startsWith(',')) continue;
        if (startsWith(']')) return { kind: 'array', items };
        fail('expected , or ]');
      }
    }
    if (character === '"') { const string = readString(); return { kind: 'string', token: string.text, value: string.value }; }
    if (startsWith('true')) return { kind: 'true' };
    if (startsWith('false')) return { kind: 'false' };
    if (startsWith('null')) return { kind: 'null' };
    const number = readNumber();
    return { kind: 'number', token: number.token };
  }

  const value = readValue();
  skipWhitespace();
  if (index !== text.length) fail('trailing content');
  return { root: value, tokens };
}

// RFC 6901: empty pointer selects the root; "~1" decodes to "/" and "~0" to
// "~" inside one token; any other ~ escape is invalid; array selectors are
// ASCII digits without a leading zero, plus the exact "-" error form.
export function decodePointerTokens(pointer) {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new RangeError(`non-root pointer must start with /: ${JSON.stringify(pointer)}`);
  return pointer.slice(1).split('/').map(raw => {
    if (/~[^01]/.test(raw) || raw.endsWith('~')) throw new RangeError(`invalid ~ escape in token ${JSON.stringify(raw)}`);
    return raw.replaceAll('~1', '/').replaceAll('~0', '~');
  });
}

function arrayIndexToken(token) {
  if (token === '-') return { kind: 'end-marker' };
  if (!/^(0|[1-9][0-9]*)$/.test(token)) throw new RangeError(`invalid array index token ${JSON.stringify(token)}`);
  return { kind: 'index', token };
}

export function resolvePointer(document, pointer) {
  const tokens = decodePointerTokens(pointer);
  let node = { container: document.root, key: null };
  for (const token of tokens) {
    const container = node.container;
    if (container.kind === 'object') {
      const member = container.members.find(entry => entry.key === token);
      if (member === undefined) throw new RangeError(`no member ${JSON.stringify(token)}`);
      node = { container: member.value, key: token, member };
      continue;
    }
    if (container.kind === 'array') {
      const indexToken = arrayIndexToken(token);
      if (indexToken.kind !== 'index') throw new RangeError('end-marker selects no existing element');
      const numeric = BigInt(indexToken.token);
      if (numeric >= BigInt(container.items.length)) throw new RangeError(`index ${indexToken.token} outside ${container.items.length} elements`);
      node = { container: container.items[Number(numeric)], key: token, index: Number(numeric) };
      continue;
    }
    throw new RangeError('scalar selected before the pointer was consumed');
  }
  return node;
}

// Structural projection: types plus child pointers, in document order.
export function structureAt(document, pointer) {
  const node = resolvePointer(document, pointer);
  const container = node.container;
  if (container.kind === 'object') {
    return { kind: 'object', children: container.members.map(member => ({ pointer: `${pointer}/${member.key.replaceAll('~', '~0').replaceAll('/', '~1')}`, kind: member.value.kind })) };
  }
  if (container.kind === 'array') {
    return { kind: 'array', children: container.items.map((item, index) => ({ pointer: `${pointer}/${index}`, kind: item.kind })) };
  }
  return { kind: container.kind === 'number' ? 'number' : container.kind, children: [] };
}

// Exact token text of the selected scalar; containers refuse.
export function scalarTokenAt(document, pointer) {
  const node = resolvePointer(document, pointer);
  const container = node.container;
  if (container.kind === 'object' || container.kind === 'array') throw new RangeError('selected value is a container');
  if (container.kind === 'number') return { kind: 'number', token: container.token };
  if (container.kind === 'string') return { kind: 'string', token: container.token, value: container.value };
  return { kind: container.kind };
}

// Exact-equality join over two arrays of objects. Numbers compare by exact
// decimal token value (arbitrary size, exact fractions by decimal expansion
// where the test data is exact); duplicates and missing keys are facts, not
// errors.
function numericKey(token) {
  const match = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(token);
  if (match === null) throw new RangeError(`unsupported join number token ${token}`);
  const [, sign, digits, fraction, exponent] = match;
  let expanded = digits + (fraction ?? '');
  let point = digits.length + Number(exponent ?? 0);
  if (point <= 0) expanded = '0'.repeat(1 - point) + expanded;
  point = Math.max(point, 0);
  while (expanded.length <= point) expanded += '0';
  const whole = expanded.slice(0, point) || '0';
  const decimal = expanded.slice(point).replace(/0+$/, '');
  const normalized = `${whole}${decimal.length > 0 ? `.${decimal}` : ''}`;
  return `${sign === '-' ? '-' : ''}${normalized}`;
}

export function joinPointers(leftDocument, rightDocument, { left, right, leftKey, rightKey }) {
  const pairs = [];
  const duplicates = [];
  const missing = [];
  const leftSeen = new Map();
  const rightIndex = new Map();
  const leftRecords = resolvePointer(leftDocument, left).container;
  const rightRecords = resolvePointer(rightDocument, right).container;
  if (leftRecords.kind !== 'array' || rightRecords.kind !== 'array') throw new RangeError('left and right select arrays');
  rightRecords.items.forEach((record, index) => {
    const member = record.members?.find(entry => entry.key === decodePointerTokens(rightKey)[0]);
    if (member === undefined) { missing.push({ side: 'right', pointer: `${right}/${index}` }); return; }
    const key = member.value.kind === 'number' ? numericKey(member.value.token) : JSON.stringify(member.value.value ?? member.value.kind);
    if (!rightIndex.has(key)) rightIndex.set(key, []);
    rightIndex.get(key).push(index);
  });
  leftRecords.items.forEach((record, index) => {
    const member = record.members?.find(entry => entry.key === decodePointerTokens(leftKey)[0]);
    if (member === undefined) { missing.push({ side: 'left', pointer: `${left}/${index}` }); return; }
    const key = member.value.kind === 'number' ? numericKey(member.value.token) : JSON.stringify(member.value.value ?? member.value.kind);
    if (leftSeen.has(key)) duplicates.push({ side: 'left', pointer: `${left}/${index}`, key });
    leftSeen.set(key, index);
    for (const match of rightIndex.get(key) ?? []) {
      pairs.push({ leftPointer: `${left}/${index}`, rightPointer: `${right}/${match}` });
    }
  });
  return { pairs, duplicates, missing };
}
