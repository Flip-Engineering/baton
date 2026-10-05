/**
 * Diagnostic-family oracles. The provider must retain the diagnostic family:
 * TS2454 is a semantic diagnostic; TS7027 appears in the suggestion family under
 * default options and in the semantic family under allowUnreachableCode:false.
 * A missing family cannot establish absence of a diagnostic, so each case pins
 * the family that can report the code. Expected spans are located from the
 * fixture bytes, never hand-counted line numbers.
 */
import { Checker, locate } from "../../lib/util.mjs";

export const suite = "ts-diagnostics";

export const cases = [
  {
    id: "definite-assignment-2454-is-semantic",
    spec: "Code projections: definite-assignment diagnostic 2454 belongs to the semantic family",
    classification: "checked",
    async run(probe, checker) {
      const result = probe.extractors.diagnostics({ file: "src/diagnostics.ts" });
      const expected = lineOf(probe, "src/diagnostics.ts", "return x;");
      const found = (result.semantic ?? []).filter((d) => d.code === 2454);
      checker.check("2454 count in semantic family", found.length, 1);
      checker.check("2454 category", found[0]?.category, "Error");
      checker.check("2454 span line", found[0]?.start?.line, expected);
      return result;
    },
  },
  {
    id: "unreachable-7027-family-depends-on-options",
    spec: "Code projections: 7027 is a suggestion under default options and a semantic error under allowUnreachableCode:false",
    classification: "checked",
    async run(probe, checker) {
      const defaults = probe.extractors.diagnostics({ file: "src/unreachable.ts" });
      const strictOptions = probe.extractors.diagnostics(
        { file: "src/unreachable.ts" },
        undefined,
        { allowUnreachableCode: false },
      );

      const afterNeverLine = lineOf(probe, "src/unreachable.ts", "return 1;", 0);
      const deadReturnLine = lineOf(probe, "src/unreachable.ts", "return 2;");
      const deadNeverLine = lineOf(probe, "src/unreachable.ts", "return 3;");

      const defaultsAfterNever = (defaults.suggestion ?? []).filter(
        (d) => d.code === 7027 && d.start?.line === afterNeverLine,
      );
      checker.check(
        "7027 suggestion after never-call under defaults",
        defaultsAfterNever.length,
        1,
      );
      checker.check(
        "7027 absent from semantic family under defaults",
        (defaults.semantic ?? []).filter((d) => d.code === 7027).length,
        0,
      );
      checker.check(
        "dead-after-return has no 7027 under defaults (suggestion family)",
        (defaults.suggestion ?? []).filter((d) => d.code === 7027 && d.start?.line === deadReturnLine)
          .length,
        0,
      );

      const strict = [
        ...(strictOptions.semantic ?? []),
        ...(strictOptions.suggestion ?? []),
      ];
      const strictCodes = strict.filter((d) => d.code === 7027);
      const strictLines = strictCodes.map((d) => d.start?.line).sort((a, b) => a - b);
      checker.check(
        "7027 lines under allowUnreachableCode:false",
        strictLines,
        [afterNeverLine, deadReturnLine, deadNeverLine].sort((a, b) => a - b),
      );
      checker.check(
        "all strict-mode 7027 entries are semantic family",
        strictCodes.every((d) => d.family === "semantic"),
        true,
      );
      return { defaults: families(defaults), strict: families(strictOptions) };
    },
  },
  {
    id: "fixture-clean-under-defaults-elsewhere",
    spec: "Fixtures without intended diagnostics produce none in either family (no false-positive pollution)",
    classification: "checked",
    async run(probe, checker) {
      for (const file of ["src/consumer.ts", "src/property-access.ts", "src/model-consumer.ts"]) {
        const result = probe.extractors.diagnostics({ file });
        checker.check(file + " semantic clean", result.semantic ?? [], []);
        checker.check(file + " suggestion clean", result.suggestion ?? [], []);
      }
      return { checked: ["src/consumer.ts", "src/property-access.ts", "src/model-consumer.ts"] };
    },
  },
];

function lineOf(probe, file, pattern, occurrence = 0) {
  const located = locate(probe.readFixtureText(file), pattern, occurrence);
  if (located === null) {
    throw new Error(`oracle subject not found in ${file}: ${pattern}`);
  }
  return located.line;
}

function families(result) {
  return {
    semantic: (result.semantic ?? []).map((d) => ({
      code: d.code,
      line: d.start?.line,
      category: d.category,
    })),
    suggestion: (result.suggestion ?? []).map((d) => ({
      code: d.code,
      line: d.start?.line,
      category: d.category,
    })),
  };
}
