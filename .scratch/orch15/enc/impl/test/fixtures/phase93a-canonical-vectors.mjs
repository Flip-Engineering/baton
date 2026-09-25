const vectors = {
  schemaVersion: 1,
  kind: 'baton.phase93a_canonical_vectors',
  values: [
    {
      name: 'numeric-looking-keys-use-utf16-order',
      value: { 2: 'two', 10: 'ten', 1: 'one' },
      canonical: '{"1":"one","10":"ten","2":"two"}',
    },
    {
      name: 'utf16-supplementary-before-bmp',
      value: { '\uE000': 'bmp', '😀': 'supplementary', a: 'ascii' },
      canonical: '{"a":"ascii","😀":"supplementary","":"bmp"}',
    },
    {
      name: 'jcs-number-boundaries',
      value: [5e-324, 1.7976931348623157e+308, 9007199254740991, 9007199254740992, 1e-6, 1e21, -0],
      canonical: '[5e-324,1.7976931348623157e+308,9007199254740991,9007199254740992,0.000001,1e+21,0]',
    },
    {
      name: 'escaped-controls-and-nesting',
      value: { nested: [{ line: 'one\ntwo', control: '\b\t\f\r' }], empty: null },
      canonical: '{"empty":null,"nested":[{"control":"\\b\\t\\f\\r","line":"one\\ntwo"}]}',
    },
  ],
};

function immutable(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

export default immutable(vectors);
