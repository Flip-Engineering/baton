// Compiler diagnostics, both families, with the effective options that produced them.
//
// The semantic and suggestion lists are collected separately and each family is reported as
// examined, so a missing family never reads as the absence of a diagnostic. The effective option
// state that decides the family of a reachability diagnostic (allowUnreachableCode) travels with
// every diagnostic, because the same source reports TS7027 as a suggestion under the default and
// as a semantic error under allowUnreachableCode:false.

import { resolve } from 'node:path';
import { fact, limit, probeEvidence, sourceEvidence, sourceRef } from './refs.mjs';

export const SUGGESTION_FAMILY = 'suggestion';
export const SEMANTIC_FAMILY = 'semantic';

export const UNREACHABLE_CODE = 7027;
export const DEFINITE_ASSIGNMENT = 2454;

function categoryName(ts, category) {
  return ts.DiagnosticCategory[category] ?? String(category);
}

export function collectDiagnostics(context) {
  const { ts, service, resolved } = context;
  const target = service.subjectPath;
  const semantic = service.languageService.getSemanticDiagnostics(target) ?? [];
  const suggestion = service.languageService.getSuggestionDiagnostics(target) ?? [];
  return { ts, semantic, suggestion, target, resolved };
}

function diagnosticFacts(context, collected, family, list, operation) {
  const { service, capture } = context;
  const facts = [];
  const refs = [];
  const options = service.options;
  const optionState = {
    allowUnreachableCode: options.allowUnreachableCode === undefined ? null : options.allowUnreachableCode === true,
    strict: options.strict === true,
    strictNullChecks: options.strictNullChecks === true || options.strict === true,
  };
  const file = service.subjectPath;
  const sha256 = capture.digest(file) ?? '';
  const sourceFile = service.program.getSourceFile(file);
  for (const diagnostic of list) {
    if (diagnostic.file === undefined || sourceFile === undefined) continue;
    const start = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    const end = sourceFile.getLineAndCharacterOfPosition((diagnostic.start ?? 0) + (diagnostic.length ?? 0));
    const range = { start: { line: start.line, column: start.character }, end: { line: end.line, column: end.character } };
    const value = {
      family,
      code: diagnostic.code,
      category: categoryName(context.ts, diagnostic.category),
      message: context.ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      range,
      optionState,
    };
    facts.push(
      fact({
        id: JSON.stringify(['source', file, sha256, range.start.line, range.start.column, `diagnostic:${family}:${diagnostic.code}`]),
        kind: 'diagnostic',
        classification: 'checked',
        value,
        evidence: [
          sourceEvidence({ real: file, sha256, start: range.start, end: range.end, role: 'diagnostic' }),
          probeEvidence({ operation, node: collected.resolved.node }),
        ],
        limits: [limit('diagnostics', 'compileDiagnostic', 'a compiler diagnostic is a referenced-closure verdict, not a whole-program proof')],
      }),
    );
    refs.push(sourceRef({ real: file, sha256, line: range.start.line, column: range.start.column, projection: 'diagnostics', snapshotId: context.snapshotId }));
  }
  facts.push(
    fact({
      id: JSON.stringify(['source', file, sha256, 0, 0, `diagnosticFamily:${family}`]),
      kind: 'diagnosticFamily',
      classification: 'checked',
      value: { family, examined: true, count: list.length, optionState },
      evidence: [probeEvidence({ operation, node: collected.resolved.node })],
      limits: [],
    }),
  );
  return { facts, refs };
}

export function produceDiagnostics(context) {
  const collected = collectDiagnostics(context);
  const semantic = diagnosticFacts(context, collected, SEMANTIC_FAMILY, collected.semantic, 'languageService.getSemanticDiagnostics');
  const suggestion = diagnosticFacts(context, collected, SUGGESTION_FAMILY, collected.suggestion, 'languageService.getSuggestionDiagnostics');
  return {
    facts: [...semantic.facts, ...suggestion.facts],
    refs: [...semantic.refs, ...suggestion.refs],
    limits: [],
  };
}
