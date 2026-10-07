/**
 * Constant-SQL source-join oracles. These pin the TypeScript-side facts the
 * constant-SQL join consumes: checker-resolved receiver declaration identity,
 * literal/template SQL argument constancy, and the negative identities
 * (parameterized argument, dynamic concatenation, unknown receiver binding,
 * variable-keyed access) that must produce scoped limitations at their exact
 * call sites. Catalog/plan bindings belong to other owners and are out of
 * scope here.
 */
import { Checker, locate } from "../../lib/util.mjs";

export const suite = "ts-sql-join";

export const cases = [
  {
    id: "literal-sql-receiver-resolution-is-checker-based",
    spec: "The join consumes checker-resolved receiver declaration identity for options.client equality, not receiver expression spans",
    classification: "static-possible",
    async run(probe, checker) {
      const receiver = probe.extractors.symbolAt({
        file: "src/constant-sql.ts",
        locate: "store\\.prepare\\(\"SELECT id, email FROM users\"\\)",
      });
      checker.checkTruthy("literal call located", receiver.error === undefined, receiver);
      const subject = probe.extractors.symbolAt({
        file: "src/constant-sql.ts",
        locate: "store: DatabaseSync",
      });
      checker.check(
        "receiver parameter type is the declared client class",
        subject.canonical?.name,
        "DatabaseSync",
      );
      const prepare = probe.extractors.symbolAt({
        file: "ambient/sql-client.d.ts",
        locate: "prepare\\(sql: string\\)",
      });
      checker.check(
        "prepare resolves to the ambient client declaration",
        prepare.canonical?.declarations?.map((d) => d.file),
        ["ambient/sql-client.d.ts"],
      );
      checker.check(
        "prepare declaration kind is a method",
        prepare.canonical?.declarations?.map((d) => d.kind),
        ["MethodDeclaration"],
      );
      return { receiver: receiver.useSite, prepare: prepare.canonical };
    },
  },
  {
    id: "quoted-method-access-shares-declaration-identity",
    spec: "Quoted string-literal method access resolves to the same prepare declaration; the join must treat it as the resolved client call",
    classification: "static-possible",
    async run(probe, checker) {
      const quoted = probe.extractors.symbolAt({
        file: "src/constant-sql.ts",
        locate: '\\["prepare"\\]',
      });
      checker.checkTruthy("quoted access located", quoted.error === undefined, quoted);
      checker.check("quoted access resolves to prepare", quoted.canonical?.name, "prepare");
      checker.checkContains(
        "quoted access declaration is the ambient client surface",
        quoted.canonical?.declarations ?? [],
        (declaration) => declaration.file === "ambient/sql-client.d.ts",
        quoted.canonical?.declarations,
      );
      return quoted;
    },
  },
  {
    id: "template-literal-without-substitution-is-constant",
    spec: "A template literal with no substitutions is constant SQL text",
    classification: "static-possible",
    async run(probe, checker) {
      const text = probe.readFixtureText("src/constant-sql.ts");
      const call = locate(text, "store\\.prepare\\(`[^`]*`\\)");
      checker.checkTruthy("template call present", call !== null, text);
      checker.check("template has no substitution hole", call.text.includes("${"), false);
      return { call: call.text };
    },
  },
  {
    id: "parameterized-and-dynamic-arguments-are-not-constant",
    spec: "A parameter or concatenated SQL argument is not constant SQL; the join must emit a limitation at that exact call site",
    classification: "static-possible",
    async run(probe, checker) {
      const text = probe.readFixtureText("src/constant-sql.ts");
      const parameterized = locate(text, "store\\.prepare\\(sql\\)");
      const dynamic = locate(text, "store\\.prepare\\(\"SELECT id FROM \" \\+ table\\)");
      checker.checkTruthy("parameterized call present", parameterized !== null, text);
      checker.checkTruthy("dynamic call present", dynamic !== null, text);
      return {
        parameterized: { line: parameterized.line, column: parameterized.column },
        dynamic: { line: dynamic.line, column: dynamic.column },
      };
    },
  },
  {
    id: "unknown-receiver-and-variable-key-are-unresolved",
    spec: "Unknown receiver bindings and variable-keyed accesses resolve to no client declaration; they cannot produce a join",
    classification: "static-possible",
    async run(probe, checker) {
      const unknownReceiver = probe.extractors.symbolAt({
        file: "src/constant-sql.ts",
        locate: "maybe\\.prepare!",
      });
      checker.checkTruthy("unknown receiver located", unknownReceiver.error === undefined, unknownReceiver);
      checker.check(
        "unknown receiver resolves to no canonical declaration",
        unknownReceiver.canonical?.declarations,
        [],
      );

      const variableKey = probe.extractors.symbolAt({
        file: "src/constant-sql.ts",
        locate: "store\\[k\\]",
      });
      checker.checkTruthy("variable key located", variableKey.error === undefined, variableKey);
      checker.check(
        "variable-keyed access resolves to parameter symbol, not the client method",
        variableKey.canonical?.name,
        "k",
      );
      return { unknownReceiver, variableKey };
    },
  },
  {
    id: "shadowed-prepare-is-a-different-symbol",
    spec: "A local binding named prepare is a distinct symbol; identity equality with the client method declaration must fail",
    classification: "static-possible",
    async run(probe, checker) {
      const shadowed = probe.extractors.symbolAt({
        file: "src/constant-sql.ts",
        locate: "prepare\\(rows\\.join",
      });
      checker.checkTruthy("shadowed call located", shadowed.error === undefined, shadowed);
      checker.check("shadowed use-site name", shadowed.useSite?.name, "prepare");
      checker.check(
        "shadowed canonical declaration stays inside the fixture file",
        shadowed.canonical?.declarations?.every((d) => d.file === "src/constant-sql.ts"),
        true,
      );
      checker.check(
        "shadowed declaration kind is the local arrow variable, not the ambient method",
        shadowed.canonical?.declarations?.map((d) => d.kind),
        ["VariableDeclaration"],
      );
      return shadowed;
    },
  },
];
