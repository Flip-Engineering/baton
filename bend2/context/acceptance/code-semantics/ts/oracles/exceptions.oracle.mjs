/**
 * Exception-structure oracles. `exceptions` exposes resolved throw expressions
 * and enclosing try/catch/finally structure; these syntax relationships do not
 * establish cross-call propagation. Async, callback and emitter boundaries are
 * pinned as boundaries, never as propagation edges.
 */
import { Checker } from "../../lib/util.mjs";

export const suite = "ts-exceptions";

export const cases = [
  {
    id: "throw-sites-and-lexical-try-structure",
    spec: "exceptions: resolved throw expressions and enclosing try/catch/finally structure",
    classification: "static-possible",
    async run(probe, checker) {
      const result = probe.extractors.throwStructure({ file: "src/exceptions.ts" });
      const throws = result.throws ?? [];
      checker.check("throw-site count", throws.length, 6);

      const suppressed = throws.find((site) => site.enclosing.length > 0);
      checker.checkTruthy("finallySuppresses throw is inside try", suppressed !== undefined, throws);
      checker.check("enclosing try has no catch clause", suppressed?.enclosing?.[0]?.hasCatch, false);
      checker.check("enclosing try has finally", suppressed?.enclosing?.[0]?.hasFinally, true);

      const boundaryThrows = throws.filter((site) => site.enclosing.length === 0);
      checker.check(
        "callback, async and handler throws report no enclosing try inside their own function boundary",
        boundaryThrows.length,
        5,
      );
      return { throws };
    },
  },
  {
    id: "thrown-expression-types",
    spec: "exceptions: thrown expression types are checker facts (class instance vs unknown catch parameter)",
    classification: "checked",
    async run(probe, checker) {
      const result = probe.extractors.throwStructure({ file: "src/exceptions.ts" });
      const boomTypes = (result.throws ?? []).filter((site) => site.expressionType === "Boom");
      checker.check("all fixture throws are Boom-typed", boomTypes.length, 6);
      return { types: (result.throws ?? []).map((site) => site.expressionType) };
    },
  },
  {
    id: "declared-throws-jsdoc",
    spec: "exceptions: @throws JSDoc is declared author text, present only when written",
    classification: "declared",
    async run(probe, checker) {
      const documented = probe.extractors.jsDocThrows({
        file: "src/exceptions.ts",
        locate: "documentedThrow\\(n\\)",
      });
      const undocumented = probe.extractors.jsDocThrows({
        file: "src/exceptions.ts",
        locate: "undocumentedThrow\\(n\\)",
      });
      checker.checkTruthy("documented subject found", documented.error === undefined, documented);
      checker.check("documented tag present", documented.tags?.length >= 1, documented.tags);
      checker.check("documented tag name", documented.tags?.[0]?.name, "throws");
      checker.check("documented tag mentions Boom", documented.tags?.[0]?.text.includes("Boom"), true);
      checker.check("undocumented has zero tags", undocumented.tags, []);
      return { documented: documented.tags, undocumented: undocumented.tags };
    },
  },
  {
    id: "no-lexical-throw-does-not-mean-no-failure",
    spec: "exceptions: returnRejectingPromise contains no ThrowStatement while its failure path is real; absence of a throw site must not be published as absence of failure",
    classification: "static-possible",
    async run(probe, checker) {
      const result = probe.extractors.throwStructure({ file: "src/exceptions.ts" });
      const inFunction = (result.throws ?? []).filter(
        (site) => site.start.line >= lineOf(probe, "returnRejectingPromise") &&
          site.start.line <= lineOf(probe, "finallySuppresses"),
      );
      checker.check(
        "no ThrowStatement inside returnRejectingPromise",
        inFunction.length,
        0,
      );
      return { throws: result.throws };
    },
  },
];

function lineOf(probe, marker) {
  const text = probe.readFixtureText("src/exceptions.ts");
  const index = text.indexOf(marker);
  if (index < 0) {
    throw new Error(`marker not found: ${marker}`);
  }
  return text.slice(0, index).split("\n").length - 1;
}
