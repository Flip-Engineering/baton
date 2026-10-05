/**
 * Guard-discovery oracles: operand identities and types, denial returns, and
 * the fixture properties that decide guarded_call availability. The relation
 * itself is assembled by the extractor's solveGuard; these oracles pin the
 * mapped facts every derivation consumes, including the unavailability inputs
 * (volatile, dereference, macro boundary, cycle).
 */
import { Checker } from "../../lib/util.mjs";

export const suite = "c-guard";

export const cases = [
  {
    id: "conjunction-guard-operands-and-denial-return",
    spec: "Guard operands are typed record-field reads; the true branch holds the denial return; source order selects no preferred guard",
    classification: "static-possible",
    async run(probe, checker) {
      const result = probe.extractors.guards({ file: "src/handler-guard.c", functionName: "view_summary" });
      checker.checkTruthy("subject resolved", result.error === undefined, result);
      checker.check("one qualifying guard", (result.guards ?? []).length, 1);
      const guard = (result.guards ?? [])[0];
      checker.check("condition text", guard?.conditionText, "!g_state.ok_read && !g_state.ok_edit");
      const members = (guard?.operands ?? []).filter((operand) => operand.kind === "MemberExpr");
      checker.check(
        "leaf member operands",
        members.map((operand) => operand.memberName),
        ["ok_read", "ok_edit"],
      );
      checker.check(
        "leaf operand types are scalar int reads",
        members.every((operand) => operand.type === "int" && operand.memberKind === "FieldDecl"),
        true,
      );
      checker.check(
        "denial return is the then-branch statement",
        guard?.thenReturns?.map((entry) => entry.sourceText),
        ["return;"],
      );
      return result;
    },
  },
  {
    id: "every-qualifying-guard-considered",
    spec: "Every qualifying call and condition is considered; two sequential guards both select the same effect call",
    classification: "static-possible",
    async run(probe, checker) {
      const result = probe.extractors.guards({ file: "src/handler-multi.c", functionName: "view_multi" });
      checker.check("two qualifying guards", (result.guards ?? []).length, 2);
      checker.check(
        "first guard operand",
        (result.guards?.[0]?.operands ?? []).filter((o) => o.kind === "MemberExpr").map((o) => o.memberName),
        ["ok_read"],
      );
      checker.check(
        "second guard operand",
        (result.guards?.[1]?.operands ?? []).filter((o) => o.kind === "MemberExpr").map((o) => o.memberName),
        ["ok_edit"],
      );
      checker.check(
        "both guards deny through an explicit return",
        (result.guards ?? []).every((guard) => guard.thenReturns?.length === 1),
        true,
      );
      return result;
    },
  },
  {
    id: "no-guard-is-a-discovery-result",
    spec: "Absence of a matching guard is a scoped discovery result and grants no permission; no guard relation is fabricated",
    classification: "static-possible",
    async run(probe, checker) {
      const result = probe.extractors.guards({ file: "src/handler-noguard.c", functionName: "view_unguarded" });
      checker.check("no IfStmt in the handler", result.guards ?? [], []);
      const calls = probe.extractors.calls({ file: "src/handler-noguard.c", functionName: "view_unguarded" });
      checker.check(
        "effect call remains ordinary discovery",
        (calls.calls ?? []).map((call) => call.resolvedName).includes("record_view"),
        true,
      );
      return { guards: result.guards, calls: (calls.calls ?? []).map((call) => call.resolvedName) };
    },
  },
  {
    id: "negation-leaf-operand",
    spec: "Unary negation keeps one leaf whose operand is the record-field read; operand outcomes must record the operand's own value",
    classification: "static-possible",
    async run(probe, checker) {
      const result = probe.extractors.guards({ file: "src/handler-not.c", functionName: "view_not" });
      checker.check("one guard", (result.guards ?? []).length, 1);
      const guard = (result.guards ?? [])[0];
      checker.check("condition text", guard?.conditionText, "!g_state.ok_read");
      const members = (guard?.operands ?? []).filter((operand) => operand.kind === "MemberExpr");
      checker.check("leaf member operand", members.map((operand) => operand.memberName), ["ok_read"]);
      return result;
    },
  },
  {
    id: "disjunction-guard-operands",
    spec: "Disjunction of two scalar field reads; the internal first-operand false edge is part of the decision region, and both operand-true edges are denial exits",
    classification: "static-possible",
    async run(probe, checker) {
      const result = probe.extractors.guards({ file: "src/handler-or.c", functionName: "view_or" });
      checker.check("one guard", (result.guards ?? []).length, 1);
      const guard = (result.guards ?? [])[0];
      checker.check(
        "condition text",
        guard?.conditionText,
        "!(g_state.ok_read || g_state.ok_edit)",
      );
      const members = (guard?.operands ?? []).filter((operand) => operand.kind === "MemberExpr");
      checker.check(
        "both leaf operands present",
        members.map((operand) => operand.memberName).sort(),
        ["ok_edit", "ok_read"],
      );
      checker.check("denial return mapped", guard?.thenReturns?.length, 1);
      return result;
    },
  },
  {
    id: "volatile-operand-unavailability-input",
    spec: "A volatile operand makes the guard relation unavailable; the mapped input is the volatile-typed field read",
    classification: "static-possible",
    async run(probe, checker) {
      const result = probe.extractors.guards({ file: "src/handler-volatile.c", functionName: "view_volatile" });
      const guard = (result.guards ?? [])[0];
      const members = (guard?.operands ?? []).filter((operand) => operand.kind === "MemberExpr");
      checker.check(
        "operand type carries volatile",
        members.map((operand) => operand.type),
        ["volatile int"],
      );
      return result;
    },
  },
  {
    id: "deref-operand-unavailability-input",
    spec: "A pointer dereference in the condition makes the guard relation unavailable; no member operand resolves",
    classification: "static-possible",
    async run(probe, checker) {
      const result = probe.extractors.guards({ file: "src/handler-deref.c", functionName: "view_deref" });
      const guard = (result.guards ?? [])[0];
      checker.check("condition dereferences a pointer", guard?.conditionText, "*p == 0");
      const members = (guard?.operands ?? []).filter((operand) => operand.kind === "MemberExpr");
      checker.check("no record-field member operands", members, []);
      return result;
    },
  },
  {
    id: "macro-condition-mapping-unavailable",
    spec: "A condition that exists only through macro expansion collapses to the use-site token; no exact condition mapping is available",
    classification: "static-possible",
    async run(probe, checker) {
      const result = probe.extractors.guards({ file: "src/handler-macro.c", functionName: "view_macro" });
      const guard = (result.guards ?? [])[0];
      checker.check("condition spells the macro use", guard?.conditionText, "DENIED_READ");
      return result;
    },
  },
];
