/**
 * Shared helpers for the code-semantics acceptance harness. Zero runtime
 * dependencies beyond Node built-ins; runs on the Node 22.15 floor binary and
 * newer.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/** SHA-256 of raw bytes, hex. */
export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

export function sha256File(filePath) {
  return sha256(readFileSync(filePath));
}

/** Read fixture bytes once; every position/identity check uses these bytes. */
export function readFixture(root, relativePath) {
  const absolute = path.resolve(root, relativePath);
  const bytes = readFileSync(absolute);
  return { absolute, bytes, text: bytes.toString("utf8"), sha256: sha256(bytes) };
}

/**
 * Locate a regex match in fixture text and convert to a zero-based {line,column}
 * pair in UTF-16 code units (the spec's source-coordinate convention and the
 * TypeScript/LSP convention).
 */
export function locate(text, pattern, occurrence = 0) {
  const regex = new RegExp(pattern, "gd");
  let match = null;
  for (let index = 0; index <= occurrence; index += 1) {
    match = regex.exec(text);
    if (match === null) {
      return null;
    }
  }
  if (match === null) {
    return null;
  }
  const index = match.index;
  const before = text.slice(0, index);
  const line = before.split("\n").length - 1;
  const lastNewline = before.lastIndexOf("\n");
  const column = index - (lastNewline + 1);
  return { line, column, length: match[0].length, text: match[0] };
}

/**
 * End position of a construct starting at start, measured in UTF-16 code units
 * against the same snapshot bytes.
 */
export function locateEnd(text, start) {
  const after = text.slice(0, start.column);
  return {
    line: start.line,
    column: after.length + (start.length ?? 0),
  };
}

export function deepEqual(actual, expected) {
  if (actual === expected) {
    return true;
  }
  if (typeof actual !== typeof expected) {
    return false;
  }
  if (actual === null || expected === null || typeof actual !== "object") {
    return false;
  }
  if (Array.isArray(actual) !== Array.isArray(expected)) {
    return false;
  }
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (actualKeys.length !== expectedKeys.length) {
    return false;
  }
  for (let i = 0; i < actualKeys.length; i += 1) {
    if (actualKeys[i] !== expectedKeys[i]) {
      return false;
    }
    if (!deepEqual(actual[actualKeys[i]], expected[expectedKeys[i]])) {
      return false;
    }
  }
  return true;
}

/** Assert helper recording structured failures instead of throwing early. */
export class Checker {
  constructor(caseId) {
    this.caseId = caseId;
    this.failures = [];
    this.checks = 0;
  }

  check(label, actual, expected) {
    this.checks += 1;
    if (!deepEqual(actual, expected)) {
      this.failures.push({
        check: label,
        expected,
        actual,
      });
    }
    return actual;
  }

  checkTruthy(label, value, detail) {
    this.checks += 1;
    if (value !== true) {
      this.failures.push({ check: label, detail: detail ?? value });
    }
    return value === true;
  }

  checkContains(label, list, predicate, detail) {
    this.checks += 1;
    const found = Array.isArray(list) && list.some(predicate);
    if (!found) {
      this.failures.push({ check: label, detail: detail ?? "no matching element" });
    }
    return found;
  }

  checkAbsent(label, list, predicate, detail) {
    this.checks += 1;
    const found = Array.isArray(list) && list.some(predicate);
    if (found) {
      this.failures.push({ check: label, detail: detail ?? "unexpected matching element present" });
    }
    return !found;
  }

  get ok() {
    return this.failures.length === 0;
  }
}
