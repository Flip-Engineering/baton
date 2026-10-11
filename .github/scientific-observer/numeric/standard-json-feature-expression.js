(() => {
  const input = '{"integer":9007199254740993,"decimal":0.123456789012345678901234567890,"exponent":1e3,"negativeZero":-0,"array":[9007199254740993,0.123456789012345678901234567890]}';
  const numericProperties = [];
  const parsed = JSON.parse(input, function (key, value, context) {
    if (typeof value === "number") numericProperties.push({
      key, arrayHolder: Array.isArray(this), source: context?.source ?? null,
      parsedType: typeof value, parsedText: String(value), negativeZero: Object.is(value, -0),
      contextKeys: context ? Object.keys(context) : null,
    });
    return value;
  });
  const rawTokens = ["9007199254740993", "0.123456789012345678901234567890", "1e3", "-0"];
  const rawSerialization = rawTokens.map((token) => {
    if (typeof JSON.rawJSON !== "function") return { token, available: false };
    try {
      const raw = JSON.rawJSON(token);
      return { token, available: true, rawJSON: raw.rawJSON,
        recognized: typeof JSON.isRawJSON === "function" ? JSON.isRawJSON(raw) : null,
        frozen: Object.isFrozen(raw), nullPrototype: Object.getPrototypeOf(raw) === null,
        serialized: JSON.stringify({ value: raw }),
      };
    } catch (error) { return { token, available: true, error: { name: error.name, message: error.message } }; }
  });
  return {
    environment: typeof process === "object" && process?.versions ? { versions: process.versions }
      : { userAgent: typeof navigator === "object" ? navigator.userAgent : null },
    input, numericProperties, rawJSONType: typeof JSON.rawJSON,
    isRawJSONType: typeof JSON.isRawJSON, rawSerialization,
    ordinaryParsedSerialization: JSON.stringify(parsed),
  };
})()
