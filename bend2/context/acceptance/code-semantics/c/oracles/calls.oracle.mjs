/**
 * Call oracles: direct callees resolve through canonical declarations; indirect
 * callees keep their call fact with unavailable callee identity; shadowed names
 * are distinct declarations; the constant-SQL profile lineage facts.
 */
import { Checker } from "../../lib/util.mjs";

export const suite = "c-calls";

export const cases = [
  {
    id: "direct-calls-resolve-canonical-declarations",
    spec: "The ordinary extractor traverses CallExpr nodes within the selected FunctionDecl and resolves direct callees through canonical declarations",
    classification: "static-possible",
    async run(probe, checker) {
      const result = probe.extractors.calls({ file: "src/handler-guard.c", functionName: "view_summary" });
      checker.checkTruthy("subject resolved", result.error === undefined, result);
      const names = (result.calls ?? []).map((call) => call.resolvedName);
      checker.check("call sites in source order", names, ["log_note", "record_view"]);
      checker.check(
        "every callee resolves to a FunctionDecl",
        (result.calls ?? []).every((call) => call.resolvedKind === "FunctionDecl" && call.direct),
        true,
      );
      checker.check(
        "effect call return type",
        (result.calls ?? []).find((call) => call.resolvedName === "record_view")?.callType,
        "int",
      );
      return result;
    },
  },
  {
    id: "indirect-callee-identity-unavailable",
    spec: "Indirect calls retain their unavailable callee identity; the call fact remains",
    classification: "static-possible",
    async run(probe, checker) {
      const result = probe.extractors.calls({ file: "src/indirect-call.c", functionName: "view_indirect" });
      checker.checkTruthy("subject resolved", result.error === undefined, result);
      checker.check("one call fact", (result.calls ?? []).length, 1);
      const call = (result.calls ?? [])[0];
      checker.check("no resolved callee name", call?.resolvedName, null);
      checker.check("callee is not a direct FunctionDecl", call?.direct, false);
      return result;
    },
  },
  {
    id: "shadowed-names-are-distinct-declarations",
    spec: "A local variable and a parameter named like the global function are distinct declarations; neither site is a call and neither binds to the FunctionDecl",
    classification: "static-possible",
    async run(probe, checker) {
      const local = probe.extractors.calls({ file: "src/handler-shadow.c", functionName: "view_shadow_local" });
      checker.check("no call sites through the shadowed name", local.calls ?? [], []);
      const refs = probe.extractors.refs({ file: "src/handler-shadow.c", functionName: "view_shadow_local" });
      const shadowUses = (refs.refs ?? []).filter((ref) => ref.name === "record_view");
      checker.check(
        "every record_view occurrence resolves to the local variable declaration",
        shadowUses.every((ref) => ref.kind === "VarDecl"),
        true,
      );
      const parameter = probe.extractors.refs({ file: "src/handler-shadow.c", functionName: "invoke_effect" });
      const parameterUses = (parameter.refs ?? []).filter((ref) => ref.name === "record_view");
      checker.check(
        "every parameter occurrence resolves to a ParmVarDecl, never the global function",
        parameterUses.length > 0 && parameterUses.every((ref) => ref.kind === "ParmVarDecl"),
        true,
      );
      return { localRefs: shadowUses, parameterUses };
    },
  },
  {
    id: "constant-sql-profile-lineage",
    spec: "The supported call passes one local stmt address and one constant literal with no percent and no NUL; preparation and first step resolve the same local declaration",
    classification: "static-possible",
    async run(probe, checker) {
      const result = probe.extractors.calls({ file: "src/prepare-profile.c", functionName: "profile_ok" });
      checker.checkTruthy("subject resolved", result.error === undefined, result);
      const prepare = (result.calls ?? []).find((call) => call.resolvedName === "db_prepare");
      const step = (result.calls ?? []).find((call) => call.resolvedName === "db_step");
      checker.checkTruthy("prepare call present", prepare !== undefined, result.calls);
      checker.checkTruthy("step call present", step !== undefined, result.calls);
      checker.check(
        "prepare receives the local statement address and the constant literal",
        prepare?.argumentRefs?.map((ref) => ref.kind),
        ["VarDecl", null],
      );
      checker.check(
        "prepare argument count matches the two-argument profile (no extra variadic arguments)",
        (prepare?.sourceText ?? "").split(",").length - 1,
        2,
      );
      checker.check(
        "step resolves the same local declaration as prepare",
        step?.argumentRefs?.map((ref) => ref.name),
        ["q"],
      );
      const literal = /"([^"]*)"/.exec(prepare?.sourceText ?? "");
      checker.checkTruthy("literal present", literal !== null, prepare?.sourceText);
      checker.check("literal has no percent", (literal?.[1] ?? "").includes("%"), false);
      checker.check("literal has no NUL", (literal?.[1] ?? "").includes("\0"), false);
      return { prepare: prepare?.sourceText, step: step?.argumentRefs };
    },
  },
  {
    id: "constant-sql-profile-violations",
    spec: "Profile violations are actual identity/profile breaches: percent literal, extra variadic argument, split statement variables, and reassignment between prepare and step",
    classification: "static-possible",
    async run(probe, checker) {
      const percent = probe.extractors.calls({ file: "src/prepare-profile.c", functionName: "profile_percent" });
      const percentLiteral = /"([^"]*)"/.exec((percent.calls ?? [])[0]?.sourceText ?? "");
      checker.check("percent literal contains %", (percentLiteral?.[1] ?? "").includes("%"), true);

      const extra = probe.extractors.calls({ file: "src/prepare-profile.c", functionName: "profile_extra_arg" });
      const extraPrepare = (extra.calls ?? []).find((call) => call.resolvedName === "db_prepare");
      checker.check(
        "extra variadic argument present at the call",
        (extraPrepare?.sourceText ?? "").includes(", 42"),
        true,
      );

      const split = probe.extractors.calls({ file: "src/prepare-profile.c", functionName: "profile_split_vars" });
      const splitStep = (split.calls ?? []).find((call) => call.resolvedName === "db_step");
      checker.check(
        "step resolves a different local declaration than prepare",
        splitStep?.argumentRefs?.map((ref) => ref.name),
        ["r"],
      );

      const reassigned = probe.extractors.refs({ file: "src/prepare-profile.c", functionName: "profile_reassigned" });
      checker.check(
        "the statement variable is reassigned between prepare and step",
        reassigned.assignments?.some((assignment) => assignment.target === "q" && assignment.opcode === "="),
        true,
      );
      return { percent: percentLiteral?.[1], reassigned: reassigned.assignments };
    },
  },
];
