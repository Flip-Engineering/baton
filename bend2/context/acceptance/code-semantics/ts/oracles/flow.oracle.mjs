/**
 * Flow oracles: narrowed types, never results, and the named static limits.
 * The narrowed type is a checker fact about the snapshot; it is not a runtime
 * value claim and the cross-function case pins exactly that limit. Subjects are
 * anchored on identifier occurrences so the probe resolves an expression node.
 */
import { Checker } from "../../lib/util.mjs";

export const suite = "ts-flow";

export const cases = [
  {
    id: "narrowed-discriminated-union",
    spec: "flow: narrowed types under the actual compiler options",
    classification: "checked",
    async run(probe, checker) {
      const circle = probe.extractors.flowType({
        file: "src/flow.ts",
        locate: "shape\\.radius",
      });
      checker.checkTruthy("circle branch located", circle.error === undefined, circle);
      checker.check("narrowed to Circle branch", circle.narrowedType, "Circle");

      const square = probe.extractors.flowType({
        file: "src/flow.ts",
        locate: "shape\\.side",
      });
      checker.check("fall-through narrowed to Square", square.narrowedType, "Square");

      const str = probe.extractors.flowType({
        file: "src/flow.ts",
        locate: "x\\.length",
      });
      checker.check("typeof string guard narrows", str.narrowedType, "string");

      const date = probe.extractors.flowType({
        file: "src/flow.ts",
        locate: "x\\.toISOString",
      });
      checker.check("instanceof guard narrows", date.narrowedType, "Date");
      return {
        circle: circle.narrowedType,
        square: square.narrowedType,
        str: str.narrowedType,
        date: date.narrowedType,
      };
    },
  },
  {
    id: "exhaustive-switch-default-is-never",
    spec: "flow: never results from exhaustive switch default",
    classification: "checked",
    async run(probe, checker) {
      const result = probe.extractors.flowType({
        file: "src/flow.ts",
        locate: "\\bneverValue\\b",
      });
      checker.check("default-branch value is never", result.narrowedType, "never");
      return result;
    },
  },
  {
    id: "cross-function-reassignment-limit",
    spec: "flow: a call that reassigns in another function does not change the narrowed type in the caller",
    classification: "checked",
    async run(probe, checker) {
      const result = probe.extractors.flowType({
        file: "src/flow.ts",
        locate: "shared\\.length",
      });
      checker.check(
        "narrowed type still string after cross-function call",
        result.narrowedType,
        "string",
      );
      return result;
    },
  },
  {
    id: "never-return-forms",
    spec: "flow: never return from annotation and always-throwing arrow at resolved call signatures",
    classification: "checked",
    async run(probe, checker) {
      const result = probe.extractors.throwStructure({ file: "src/flow.ts" });
      const byExpression = (expression) =>
        (result.calls ?? []).find((call) => call.expression === expression);
      const annotated = byExpression("annotatedNever()");
      const arrow = byExpression("arrowNever()");
      checker.check("annotated never call return type", annotated?.returnType, "never");
      checker.check("arrow never call return type", arrow?.returnType, "never");
      checker.check("annotated call flagged never", annotated?.isNever, true);
      return { calls: result.calls };
    },
  },
];
