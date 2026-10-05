// Dataset typed-contract boundary fixture (conductor dataset-pointer-17).
//
// SCOPE: this case exercises the suite's own reference implementations
// (lib/jsonref.mjs, lib/migrations-style token layer) as a contract oracle.
// It pins the RFC 6901 and exact-token semantics the production dataset
// implementation must reproduce; it is NOT qualification of a production
// dataset provider. The catalogs provider names datasetRead unsupported;
// production dataset assertions bind to its author's native entry when it
// exists.
//
// Pins at the foreign boundary: complete selected values keep exact numeric
// token spellings (signed, fractional, exponent, above-U32, beyond-double),
// nested nulls and empty containers stay distinct, RFC 6901 pointer grammar
// applies (~0/~1, invalid ~2, leading-zero/negative indices), and the
// request-canonical U32 profile never constrains dataset values.

import { DatabaseSync } from 'node:sqlite';

import { check } from '../lib/harness.mjs';
import { decodePointerTokens, joinPointers, parseDocument, resolvePointer, scalarTokenAt, structureAt } from '../lib/jsonref.mjs';

const DOCUMENT_TEXT = `{
  "signed": -17,
  "fraction": -1.5,
  "exponent": 1e3,
  "bigInteger": 4294967296,
  "beyondDouble": 9007199254740993,
  "hugeExponent": 1e400,
  "nested": { "nulls": [null, {"inner": null}], "emptyObject": {}, "emptyArray": [] },
  "a/b": "slash-key",
  "a~b": "tilde-key",
  "records": [
    { "id": 1, "ref": 100, "tag": "left-1" },
    { "id": 2, "ref": 100, "tag": "left-2" },
    { "id": 3, "ref": 300, "tag": "left-3" },
    { "id": 4, "tag": "left-4-missing-ref" }
  ],
  "joins": [
    { "ref": 100, "label": "right-a" },
    { "ref": 300, "label": "right-b" }
  ]
}`;

check({
  id: 'dataset/numeric-tokens-exact',
  requirement: 'conductor dataset correction: values keep -1.5, 1e3, 4294967296, 9007199254740993 and 1e400 as exact source tokens; no double rounding or U32 constraint',
  async run() {
    const document = parseDocument(DOCUMENT_TEXT);
    const cases = { signed: '-17', fraction: '-1.5', exponent: '1e3', bigInteger: '4294967296', beyondDouble: '9007199254740993', hugeExponent: '1e400' };
    for (const [pointer, expected] of Object.entries(cases)) {
      const observed = scalarTokenAt(document, `/${pointer}`);
      if (observed.token !== expected) throw new Error(`${pointer}: token ${JSON.stringify(observed.token)} expected ${JSON.stringify(expected)}`);
    }
    const viaJsParse = JSON.parse(DOCUMENT_TEXT);
    if (Object.is(viaJsParse.beyondDouble, 9007199254740992)) {
      return { tokensPreserved: Object.keys(cases).length, note: 'JSON.parse rounds beyondDouble to 9007199254740992; the token layer does not' };
    }
    return { tokensPreserved: Object.keys(cases).length };
  },
});

check({
  id: 'dataset/pointer-grammar-rfc6901',
  requirement: 'conductor dataset corrections: root pointer, /a, ~0~1 and ~1~0 decode, escaped slash/tilde keys resolve, invalid ~2 and trailing ~ refuse, leading-zero/negative/nondigit array tokens refuse',
  async run() {
    const document = parseDocument(DOCUMENT_TEXT);
    if (resolvePointer(document, '').container.kind !== 'object') throw new Error('root pointer did not select the document root');
    if (scalarTokenAt(document, '/signed').token !== '-17') throw new Error('/a-style plain token failed');
    const encoded = parseDocument('{"~/":"tilde-slash","~key":"tilde-key"}');
    if (scalarTokenAt(encoded, '/~0~1').value !== 'tilde-slash') throw new Error('~0~1 pointer did not reach the ~/ key');
    if (scalarTokenAt(encoded, '/~0key').value !== 'tilde-key') throw new Error('~0 pointer did not decode to a tilde key');
    if (scalarTokenAt(document, '/a~1b').value !== 'slash-key') throw new Error('escaped slash key failed');
    if (scalarTokenAt(document, '/a~0b').value !== 'tilde-key') throw new Error('escaped tilde key failed');
    const refusals = [];
    for (const bad of ['/~2x', '/trailing~', '/records/01', '/records/-1', '/records/x', '/records/-']) {
      try {
        resolvePointer(document, bad);
        refusals.push({ pointer: bad, refused: false });
      } catch {
        refusals.push({ pointer: bad, refused: true });
      }
    }
    if (!refusals.every(entry => entry.refused)) throw new Error(`invalid pointers resolved: ${JSON.stringify(refusals)}`);
    return { refusals: refusals.map(entry => entry.pointer) };
  },
});

check({
  id: 'dataset/null-empty-distinct',
  requirement: 'nested nulls, empty objects and empty arrays stay distinct in structure; array index 0 and index 10 behavior is explicit',
  async run() {
    const document = parseDocument(DOCUMENT_TEXT);
    const structure = structureAt(document, '/nested');
    const kinds = Object.fromEntries(structure.children.map(child => [child.pointer, child.kind]));
    if (kinds['/nested/emptyObject'] !== 'object' || kinds['/nested/emptyArray'] !== 'array') throw new Error(`empty containers observed ${JSON.stringify(kinds)}`);
    if (kinds['/nested/nulls'] !== 'array') throw new Error('nulls container lost');
    const innerNull = resolvePointer(document, '/nested/nulls/0').container;
    if (innerNull.kind !== 'null') throw new Error(`first element observed ${JSON.stringify(innerNull)}`);
    const innerObject = resolvePointer(document, '/nested/nulls/1').container;
    if (innerObject.members[0].value.kind !== 'null') throw new Error('nested null member lost');
    let overflow = null;
    try {
      resolvePointer(document, '/nested/emptyArray/10');
    } catch (error) {
      overflow = String(error.message);
    }
    if (overflow === null) throw new Error('index 10 into an empty array resolved');
    return { kinds, firstElement: innerNull.kind, overflowRefusal: overflow.slice(0, 80) };
  },
});

check({
  id: 'dataset/joins-duplicates-missing',
  requirement: 'exact-equality join returns both record pointers, duplicate-key and missing-key facts; no implicit foreign-key inference',
  async run() {
    const document = parseDocument(DOCUMENT_TEXT);
    const result = joinPointers(document, document, { left: '/records', right: '/joins', leftKey: '/ref', rightKey: '/ref' });
    if (result.pairs.length !== 3) throw new Error(`pairs observed ${JSON.stringify(result.pairs)}`);
    if (result.pairs.filter(pair => pair.rightPointer === '/joins/0').length !== 2) throw new Error('duplicate right key not reported as two pairs');
    if (result.missing.length !== 1 || result.missing[0].pointer !== '/records/3') throw new Error(`missing keys observed ${JSON.stringify(result.missing)}`);
    return { pairs: result.pairs, missing: result.missing };
  },
});

check({
  id: 'dataset/sqlite-json1-parameterized-traversal',
  requirement: 'SQLite json1 traversal is parameterized and fullkey-addressed over the same document: escaped keys and exact rows come back without caller SQL',
  async run() {
    const db = new DatabaseSync(':memory:');
    // CAST(atom AS TEXT) keeps every SQLite value exact at the row boundary:
    // node:sqlite otherwise refuses integers beyond double precision when it
    // materializes the atom column, which is itself the boundary defect the
    // token layer exists to avoid.
    const rows = db.prepare("SELECT fullkey, type, CAST(atom AS TEXT) AS atom FROM json_tree(?, '$')").all(DOCUMENT_TEXT);
    const escaped = rows.find(row => row.fullkey === '$."a~1b"' || row.fullkey === '$."a/b"');
    if (escaped === undefined) throw new Error(`escaped key row absent: ${JSON.stringify(rows.slice(0, 6))}`);
    const beyondDouble = rows.find(row => row.fullkey === '$.beyondDouble');
    if (beyondDouble === undefined) throw new Error('beyondDouble row absent from json_tree');
    if (beyondDouble.atom !== '9007199254740993') throw new Error(`beyondDouble atom lost precision: ${JSON.stringify(beyondDouble)}`);
    const parameterizedAgain = db.prepare("SELECT fullkey FROM json_tree(?, ?) WHERE fullkey = ?").all(DOCUMENT_TEXT, '$', '$.exponent');
    if (parameterizedAgain.length !== 1) throw new Error('parameterized traversal did not address $.exponent');
    db.close();
    return { rowCount: rows.length, escapedKeyRow: escaped.fullkey, exponentRow: parameterizedAgain[0].fullkey };
  },
});

check({
  id: 'dataset/request-canonical-profile-separate',
  requirement: 'cross-module boundary: the closed request-numeric profile refuses signed/fraction/exponent/above-U32 tokens while the dataset layer carries them losslessly; no dataset value silently acquires request coordinates',
  async run() {
    const requestRefused = [];
    for (const token of ['-1', '0.5', '1e3', '4294967296', '9007199254740993']) {
      const refused = !/^(?:0|[1-9][0-9]{0,9})$/.test(token) || Number(token) > 0xFFFFFFFF;
      requestRefused.push({ token, refused });
    }
    if (!requestRefused.every(entry => entry.refused)) throw new Error(`request profile admitted ${JSON.stringify(requestRefused)}`);
    const document = parseDocument(DOCUMENT_TEXT);
    const datasetCarried = scalarTokenAt(document, '/beyondDouble').token;
    if (datasetCarried !== '9007199254740993') throw new Error('dataset layer lost the token the request profile refuses');
    return { requestRefusals: requestRefused.map(entry => entry.token), datasetToken: datasetCarried };
  },
});
