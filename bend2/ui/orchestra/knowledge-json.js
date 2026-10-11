/* Complete Knowledge responses retain the source text of numeric values. */
(function (root) {
  "use strict";
  const sources = new WeakMap();

  function numberSource(owner, key, value) {
    const source = owner && sources.get(owner)?.get(String(key));
    return source && Object.is(source.value, value) ? source.text : null;
  }

  function parse(text) {
    return JSON.parse(text, function (key, value, context) {
      if (typeof value === "number") {
        if (typeof context?.source !== "string") {
          throw new TypeError("This runtime cannot preserve Knowledge numeric source text.");
        }
        let fields = sources.get(this);
        if (!fields) { fields = new Map(); sources.set(this, fields); }
        fields.set(key, { value, text: context.source });
      }
      return value;
    });
  }

  function stringify(value) {
    return JSON.stringify(value, function (key, item) {
      const text = typeof item === "number" ? numberSource(this, key, item) : null;
      return text === null ? item : JSON.rawJSON(text);
    });
  }

  root.KnowledgeJSON = Object.freeze({ parse, stringify, numberSource });
})(globalThis);
