/**
 * Symbol-identity oracles: canonical name resolution, multi-declaration symbols,
 * reference-coverage boundaries. Expectations come from the approved
 * specification (Code projections) and retained bindings research; the probe
 * verifies them against the pinned TypeScript provider itself.
 */
import { Checker } from "../../lib/util.mjs";

export const suite = "ts-symbols";

export const cases = [
  {
    id: "alias-use-resolves-to-canonical-declaration",
    spec: "TypeChecker symbol/alias resolution; use-site spelling is local, canonical name is the declaration name",
    classification: "static-possible",
    async run(probe, checker) {
      const result = probe.extractors.symbolAt({
        file: "src/consumer.ts",
        locate: "\\bmm\\(",
      });
      checker.checkTruthy("subject found", result.error === undefined, result);
      checker.check("use-site local name", result.useSite?.name, "mm");
      checker.check("canonical name after alias hop", result.canonical?.name, "makeMessage");
      checker.check(
        "canonical declaration file",
        result.canonical?.declarations?.map((d) => d.file),
        ["src/alias-chain.ts"],
      );
      checker.check(
        "canonical declaration kind",
        result.canonical?.declarations?.map((d) => d.kind),
        ["FunctionDeclaration"],
      );
      return result;
    },
  },
  {
    id: "merged-symbol-carries-two-declarations",
    spec: "Declaration merging yields one symbol with multiple declarations",
    classification: "static-possible",
    async run(probe, checker) {
      const result = probe.extractors.symbolAt({
        file: "src/merged-symbols.ts",
        locate: "Config\\.version",
      });
      checker.checkTruthy("subject found", result.error === undefined, result);
      checker.check("canonical name", result.canonical?.name, "Config");
      const kinds = (result.canonical?.declarations ?? []).map((d) => d.kind).sort();
      checker.check("declaration kinds", kinds, ["InterfaceDeclaration", "ModuleDeclaration"]);
      return result;
    },
  },
  {
    id: "quoted-literal-member-access-is-indexed",
    spec: "Quoted string-literal member access resolves to the member symbol and carries its declaration identity",
    classification: "static-possible",
    async run(probe, checker) {
      const quoted = probe.extractors.symbolAt({
        file: "src/property-access.ts",
        locate: '\\["load"\\]',
      });
      checker.checkTruthy("quoted subject found", quoted.error === undefined, quoted);
      checker.check("quoted access resolves to member name", quoted.canonical?.name, "load");
      checker.checkContains(
        "quoted access declaration is in fixture file",
        quoted.canonical?.declarations ?? [],
        (declaration) => declaration.file === "src/property-access.ts",
        quoted.canonical?.declarations,
      );
      return quoted;
    },
  },
  {
    id: "computed-and-any-access-produce-no-edge",
    spec: "Variable-keyed and any-typed member accesses produce no reference edge to the member declaration",
    classification: "static-possible",
    async run(probe, checker) {
      const references = probe.extractors.references({
        file: "src/property-access.ts",
        locate: "load\\(id: string\\): string",
      });
      checker.checkTruthy("subject found", references.error === undefined, references);
      const sourceText = probe.buildService(probe.initialOverlay()).files.get("src/property-access.ts") ?? "";
      const computedSpan = references.flat === undefined ? null : locateSpan(sourceText, "d\\[k\\]");
      const anyCastSpan = references.flat === undefined ? null : locateSpan(sourceText, "\\.save\\(");
      checker.checkTruthy("computed use located in fixture", computedSpan !== null, sourceText.length);
      checker.checkTruthy("any-cast use located in fixture", anyCastSpan !== null, sourceText.length);
      for (const [label, span] of [["computed", computedSpan], ["anyCast", anyCastSpan]]) {
        checker.checkAbsent(
          `${label} access has no reference entry`,
          references.flat ?? [],
          (entry) =>
            entry.file === "src/property-access.ts" &&
            entry.start.line === span.line &&
            Math.abs(entry.start.column - span.column) <= 3,
          `span ${JSON.stringify(span)} vs entries`,
        );
      }
      return { flat: references.flat, computedSpan, anyCastSpan };
    },
  },
  {
    id: "dynamic-import-not-covered",
    spec: "await import() module accesses are absent from findReferences; provider must name the gap explicitly",
    classification: "static-possible",
    async run(probe, checker) {
      const result = probe.extractors.references({
        file: "src/alias-chain.ts",
        locate: "export function makeMessage",
      });
      checker.checkTruthy("subject found", result.error === undefined, result);
      checker.checkAbsent(
        "no dyn-import.ts reference entry",
        result.flat ?? [],
        (entry) => entry.file === "src/dyn-import.ts",
        "dynamic import edge must not be fabricated",
      );
      return { files: [...new Set((result.flat ?? []).map((entry) => entry.file))].sort() };
    },
  },
  {
    id: "untyped-js-outside-program",
    spec: "With allowJs off, loose.js is not a program file and its import site reports TS7016",
    classification: "checked",
    async run(probe, checker) {
      const files = probe.extractors.programFiles({});
      checker.checkAbsent(
        "loose.js not a root file",
        files.rootFiles ?? [],
        (name) => name.endsWith("loose.js"),
        "allowJs is off",
      );
      const diagnostics = probe.extractors.diagnostics({ file: "src/js-edge.ts" });
      checker.checkContains(
        "TS7016 present in semantic family",
        diagnostics.semantic ?? [],
        (d) => d.code === 7016,
        diagnostics.semantic?.map((d) => d.code),
      );
      return { roots: files.rootFiles, semanticCodes: (diagnostics.semantic ?? []).map((d) => d.code) };
    },
  },
  {
    id: "module-use-resolves-export-declaration",
    spec: "Handler module-use edges resolve the import alias to the selected export declaration (model consumer)",
    classification: "static-possible",
    async run(probe, checker) {
      const result = probe.extractors.moduleUse({
        file: "src/model-consumer.ts",
      });
      const parseImport = (result.imports ?? []).find((entry) => entry.localName === "parseProfile");
      checker.checkTruthy("parseProfile import present", parseImport !== undefined, result.imports);
      checker.check("resolved module file", parseImport?.resolvedFile, "src/model-schema.ts");
      checker.check(
        "canonical declaration file",
        parseImport?.canonicalDeclarations?.map((d) => d.file),
        ["src/model-schema.ts"],
      );
      checker.check(
        "canonical declaration kind",
        parseImport?.canonicalDeclarations?.map((d) => d.kind),
        ["FunctionDeclaration"],
      );
      return result;
    },
  },
  {
    id: "unresolved-import-recorded-not-crashed",
    spec: "An unresolvable import retains a scoped unresolved fact instead of throwing inside provider resolution",
    classification: "static-possible",
    async run(probe, checker) {
      const result = probe.extractors.moduleUse({
        file: "src/unresolved-import.ts",
      });
      const missing = (result.imports ?? []).find((entry) => entry.localName === "missingValue");
      checker.checkTruthy("missing import present in use list", missing !== undefined, result.imports);
      checker.check("resolved file is null for missing module", missing?.resolvedFile, null);
      return result;
    },
  },
];

function locateSpan(text, pattern) {
  const match = new RegExp(pattern).exec(text);
  if (match === null) {
    return null;
  }
  const before = text.slice(0, match.index);
  const line = before.split("\n").length - 1;
  const lastNewline = before.lastIndexOf("\n");
  return { line, column: match.index - (lastNewline + 1) };
}
