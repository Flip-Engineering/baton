/**
 * clangd LSP oracles: provider capability floor (LLVM 20 outgoing calls),
 * cross-file definition through the admitted compile command, and versioned
 * diagnostics publication shape.
 */
import { Checker } from "../../lib/util.mjs";

export const suite = "c-clangd";

export const cases = [
  {
    id: "capabilities-advertise-call-hierarchy",
    spec: "clangd advertises call hierarchy on the LLVM 20 floor; outgoingCalls answers rather than returning method-not-found",
    classification: "checked",
    async run(probe, checker) {
      const result = await probe.extractors.clangd({
        file: "src/signature.c",
        locate: "report_view\\(void\\)",
        request: "outgoingCalls",
      });
      checker.checkTruthy("session established", result.error === undefined, result);
      checker.check("callHierarchyProvider advertised", result.capabilities?.callHierarchyProvider !== null, true);
      checker.check("one hierarchy item prepared", result.callHierarchyItems, 1);
      checker.check("no outgoingCalls error", result.outgoingError, undefined);
      checker.check(
        "outgoing edge names the callee",
        (result.outgoing ?? []).some((entry) => entry.name === "record_view"),
        result.outgoing,
      );
      return result;
    },
  },
  {
    id: "definition-resolves-through-compile-command",
    spec: "definition on the callee use resolves through the admitted compile command to the canonical declaration",
    classification: "static-possible",
    async run(probe, checker) {
      const result = await probe.extractors.clangd({
        file: "src/signature.c",
        locate: "record_view\\(\\)",
        request: "definition",
      });
      checker.checkTruthy("session established", result.error === undefined, result);
      checker.check(
        "definition lands in the fixture header",
        result.definition?.map((loc) => loc.file),
        ["include/handler.h"],
      );
      return result;
    },
  },
  {
    id: "versioned-diagnostics-publication-shape",
    spec: "Diagnostics publication carries the document version; an explicit empty array completes the projection with no diagnostics for the captured bytes",
    classification: "checked",
    async run(probe, checker) {
      const result = await probe.extractors.clangd({
        file: "src/signature.c",
        locate: "report_view\\(void\\)",
        request: "diagnostics",
      });
      checker.checkTruthy("session established", result.error === undefined, result);
      checker.check("publication version is the opened version", result.diagnosticsVersion, 1);
      checker.check("no diagnostics for the clean fixture", result.diagnostics ?? [], []);
      return result;
    },
  },
];
