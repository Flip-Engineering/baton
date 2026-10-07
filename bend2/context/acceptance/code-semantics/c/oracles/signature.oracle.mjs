/**
 * Signature oracles: authentic-shape handler and callee signature facts.
 * Expectations derive from the approved specification's qualification target
 * facts (empty handler formal list; nonempty variadic callee formal list) and
 * were cross-checked against actual clang 20.1.8 AST dumps recorded in this
 * session's private evidence before the remote-only execution boundary.
 */
import { Checker } from "../../lib/util.mjs";

export const suite = "c-signature";

export const cases = [
  {
    id: "handler-empty-formal-list",
    spec: "Qualification target: the selected handler's true signature has an empty formal list",
    classification: "checked",
    async run(probe, checker) {
      const result = probe.extractors.signature({ file: "src/signature.c", functionName: "report_view" });
      checker.checkTruthy("subject resolved", result.error === undefined, result);
      checker.check("handler qualType", result.qualType, "void (void)");
      checker.check("handler formal list", result.parameters, []);
      checker.check("handler is not variadic", result.variadic, false);
      return result;
    },
  },
  {
    id: "callee-definition-nonempty-variadic-formals",
    spec: "Separate selected-function gate: the callee definition query returns its own nonempty formal list and variadic status, independent of callee expansion",
    classification: "checked",
    async run(probe, checker) {
      const result = probe.extractors.signature({ file: "src/db.c", functionName: "db_prepare" });
      checker.checkTruthy("definition resolved", result.error === undefined, result);
      checker.check("callee qualType", result.qualType, "int (stmt **, const char *, ...)");
      checker.check(
        "callee formal parameter types",
        result.parameters?.map((p) => p.type),
        ["stmt **", "const char *"],
      );
      checker.check(
        "callee formal parameter names",
        result.parameters?.map((p) => p.name),
        ["pstmt", "sql"],
      );
      checker.check("callee is variadic", result.variadic, true);
      return result;
    },
  },
  {
    id: "auxiliary-callee-formals",
    spec: "Preparation/stepping callees resolve through canonical declarations with their own formal lists",
    classification: "checked",
    async run(probe, checker) {
      const step = probe.extractors.signature({ file: "src/db.c", functionName: "db_step" });
      checker.check("db_step qualType", step.qualType, "int (stmt *)");
      const finalize = probe.extractors.signature({ file: "src/db.c", functionName: "db_finalize" });
      checker.check("db_finalize qualType", finalize.qualType, "int (stmt *)");
      const note = probe.extractors.signature({ file: "src/signature.c", functionName: "record_view" });
      checker.check("record_view resolves to its declared prototype type", note.qualType, "int (void)");
      return { step: step.qualType, finalize: finalize.qualType, record: note.qualType };
    },
  },
  {
    id: "field-and-record-declarations",
    spec: "Guard operands resolve to FieldDecls with scalar types through the record declaration",
    classification: "checked",
    async run(probe, checker) {
      const field = probe.extractors.decl({
        file: "src/handler-guard.c",
        declKind: "FieldDecl",
        declName: "ok_read",
      });
      checker.checkTruthy("field resolved", field.error === undefined, field);
      checker.check("field type", field.declaration?.type, "int");
      const volatileField = probe.extractors.decl({
        file: "src/handler-volatile.c",
        declKind: "FieldDecl",
        declName: "volatile_flag",
      });
      checker.check(
        "volatile field type names volatile",
        volatileField.declaration?.type,
        "volatile int",
      );
      return { field: field.declaration, volatileField: volatileField.declaration };
    },
  },
];
