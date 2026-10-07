// Control-flow facts and lexical exception structure.
//
// flow reports what the checker actually computes: the narrowed type at a position, the
// reachability and definite-assignment diagnostics under the effective options, and a `never`
// return from a resolved signature. It never claims a control-flow graph: the public TypeScript
// 5.9.3 declarations contain no CFG API, and the internal flow graph is not a supported producer,
// so no fact here depends on it.
//
// exceptions reports resolved throw expressions and the lexical try/catch/finally structure that
// encloses them, up to the function boundary. Those are syntax and type facts; cross-call
// propagation, async rejection routing and callback scheduling are stated as limits.

import { resolve } from 'node:path';
import { fact, limit, probeEvidence, sourceEvidence, sourceRef } from './refs.mjs';
import { nodeAtPosition, point, spanRange, symbolOffset, symbolOf } from './bindings.mjs';
import { UNREACHABLE_CODE, DEFINITE_ASSIGNMENT } from './diagnostics.mjs';

function evidenceAt(capture, sourceFile, startPosition, endPosition, role) {
  const path = resolve(sourceFile.fileName);
  const start = sourceFile.getLineAndCharacterOfPosition(startPosition);
  const end = sourceFile.getLineAndCharacterOfPosition(endPosition);
  return sourceEvidence({
    real: path,
    sha256: capture.digest(path) ?? '',
    start: { line: start.line, column: start.character },
    end: { line: end.line, column: end.character },
    role,
  });
}

export function produceFlow(context) {
  const { ts, service, capture, resolved, request, snapshotId } = context;
  const sourceFile = service.sourceFile;
  const path = service.subjectPath;
  const sha256 = capture.digest(path) ?? '';
  const offset = request.subject.kind === 'symbol'
    ? symbolOffset(request, sourceFile)
    : sourceFile.getPositionOfLineAndCharacter(request.subject.line ?? 0, request.subject.column ?? 0);
  const facts = [];
  const refs = [];
  const limits = [
    limit('flow', 'noPublicCfg', 'TypeScript 5.9.3 publishes no control-flow graph; the reported facts are checker results at this position'),
  ];

  if (offset >= 0) {
    const node = nodeAtPosition(ts, sourceFile, offset);
    if (node !== undefined) {
      const type = service.checker.getTypeAtLocation(node);
      const at = point(sourceFile, node.getStart(sourceFile));
      const symbol = symbolOf(ts, service.checker, node);
      facts.push(
        fact({
          id: JSON.stringify(['source', path, sha256, at.line, at.column, 'flow:narrowed']),
          kind: 'narrowedType',
          classification: 'checked',
          value: {
            typeText: service.checker.typeToString(type),
            declaredTypeText:
              symbol?.declarations?.[0] === undefined
                ? null
                : service.checker.typeToString(service.checker.getTypeOfSymbolAtLocation(symbol, symbol.declarations[0])),
            never: (type.flags & ts.TypeFlags.Never) !== 0,
            point: at,
            provider: { name: 'typescript', version: resolved.version, librarySha: resolved.librarySha },
          },
          evidence: [
            evidenceAt(capture, sourceFile, node.getStart(sourceFile), node.getEnd(), 'narrowedType'),
            probeEvidence({ operation: 'checker.getTypeAtLocation', node: resolved.node }),
          ],
          limits: [
            limit('flow', 'flowNotRuntime', 'a narrowed type is a checker fact about this snapshot; a reassignment in another function does not change it'),
          ],
        }),
      );
      refs.push(sourceRef({ real: path, sha256, line: at.line, column: at.column, projection: 'flow', snapshotId }));
    }
  } else {
    limits.push(limit('flow', 'symbolNotResolved', 'no matching declaration name in the subject file'));
  }

  // Reachability: both families, with the option state that decides the family.
  const semantic = service.languageService.getSemanticDiagnostics(path) ?? [];
  const suggestion = service.languageService.getSuggestionDiagnostics(path) ?? [];
  const unreachable = [];
  for (const [family, list] of [['semantic', semantic], ['suggestion', suggestion]]) {
    for (const diagnostic of list) {
      if (diagnostic.code !== UNREACHABLE_CODE || diagnostic.file === undefined) continue;
      const range = spanRange(sourceFile, { start: diagnostic.start ?? 0, length: diagnostic.length ?? 0 });
      unreachable.push({ family, range });
      refs.push(sourceRef({ real: path, sha256, line: range.start.line, column: range.start.column, projection: 'flow', snapshotId }));
    }
  }
  facts.push(
    fact({
      id: JSON.stringify(['source', path, sha256, 0, 0, 'flow:unreachable']),
      kind: 'unreachableCode',
      classification: 'checked',
      value: {
        diagnostics: unreachable,
        allowUnreachableCode:
          service.options.allowUnreachableCode === undefined ? null : service.options.allowUnreachableCode === true,
        familiesExamined: ['semantic', 'suggestion'],
      },
      evidence: [probeEvidence({ operation: 'languageService.getSemanticDiagnostics+getSuggestionDiagnostics', node: resolved.node })],
      limits: [
        limit('flow', 'optionDependent', 'TS7027 is a suggestion under the default options and a semantic diagnostic under allowUnreachableCode:false'),
      ],
    }),
  );

  const definite = semantic.filter((diagnostic) => diagnostic.code === DEFINITE_ASSIGNMENT && diagnostic.file !== undefined);
  facts.push(
    fact({
      id: JSON.stringify(['source', path, sha256, 0, 0, 'flow:definiteAssignment']),
      kind: 'definiteAssignment',
      classification: 'checked',
      value: {
        diagnostics: definite.map((diagnostic) => spanRange(sourceFile, { start: diagnostic.start ?? 0, length: diagnostic.length ?? 0 })),
        family: 'semantic',
      },
      evidence: [probeEvidence({ operation: 'languageService.getSemanticDiagnostics', node: resolved.node })],
      limits: [],
    }),
  );

  const neverReturns = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const signature = service.checker.getResolvedSignature(node);
      const returnType = signature?.getReturnType?.();
      if (returnType !== undefined && (returnType.flags & ts.TypeFlags.Never) !== 0) {
        neverReturns.push(spanRange(sourceFile, { start: node.getStart(sourceFile), length: node.getWidth(sourceFile) }));
      }
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  facts.push(
    fact({
      id: JSON.stringify(['source', path, sha256, 0, 1, 'flow:neverReturn']),
      kind: 'neverReturn',
      classification: 'checked',
      value: { calls: neverReturns },
      evidence: [probeEvidence({ operation: 'checker.getResolvedSignature.getReturnType', node: resolved.node })],
      limits: [
        limit('flow', 'neverFromAnnotationOrArrow', 'a function declaration whose body always throws reports void unless it is annotated never; an always-throwing arrow reports never'),
      ],
    }),
  );

  return { facts, refs, limits };
}

function isDescendantOf(node, ancestor) {
  let current = node;
  while (current !== undefined) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function enclosingFunction(ts, node) {
  let current = node;
  while (current !== undefined) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isConstructorDeclaration(current) ||
      ts.isGetAccessorDeclaration(current) ||
      ts.isSetAccessorDeclaration(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

export function produceExceptions(context) {
  const { ts, service, capture, resolved, request, snapshotId } = context;
  const sourceFile = service.sourceFile;
  const path = service.subjectPath;
  const sha256 = capture.digest(path) ?? '';
  const facts = [];
  const refs = [];
  const limits = [
    limit('exceptions', 'noCrossCallPropagation', 'throw sites and lexical try/catch/finally structure do not establish propagation across calls'),
  ];

  const offset = request.subject.kind === 'symbol'
    ? symbolOffset(request, sourceFile)
    : sourceFile.getPositionOfLineAndCharacter(request.subject.line ?? 0, request.subject.column ?? 0);
  const anchor = nodeAtPosition(ts, sourceFile, Math.max(offset, 0));
  const fn = anchor === undefined ? undefined : enclosingFunction(ts, anchor);
  const scope = fn ?? sourceFile;

  const throws = [];
  const visit = (node) => {
    if (ts.isThrowStatement(node) && enclosingFunction(ts, node) === fn) {
      const expression = node.expression;
      const expressionType = expression === undefined ? null : service.checker.typeToString(service.checker.getTypeAtLocation(expression));
      const range = spanRange(sourceFile, { start: node.getStart(sourceFile), length: node.getWidth(sourceFile) });
      const chain = [];
      let current = node.parent;
      while (current !== undefined && current !== sourceFile) {
        if (ts.isTryStatement(current)) {
          const inFinally = current.finallyBlock !== undefined && isDescendantOf(node, current.finallyBlock);
          chain.push({
            kind: inFinally ? 'finally' : 'try',
            range: spanRange(sourceFile, { start: current.getStart(sourceFile), length: current.getWidth(sourceFile) }),
          });
        } else if (ts.isCatchClause(current)) {
          chain.push({
            kind: 'catch',
            range: spanRange(sourceFile, { start: current.getStart(sourceFile), length: current.getWidth(sourceFile) }),
            catchParameter: current.variableDeclaration?.name?.getText(sourceFile) ?? null,
          });
        }
        current = current.parent;
      }
      throws.push({
        range,
        expressionText: expression === undefined ? null : expression.getText(sourceFile),
        expressionTypeText: expressionType,
        enclosing: chain,
      });
      refs.push(sourceRef({ real: path, sha256, line: range.start.line, column: range.start.column, projection: 'exceptions', snapshotId }));
      if (fn !== undefined && (ts.isArrowFunction(fn) || fn.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true)) {
        limits.push(limit('exceptions', 'asyncBoundary', 'a throw inside an async function or arrow becomes a rejected promise; no lexical catch at the call site handles it'));
      }
    }
    node.forEachChild(visit);
  };
  scope.forEachChild(visit);

  facts.push(
    fact({
      id: JSON.stringify(['source', path, sha256, 0, 0, 'exceptions:throws']),
      kind: 'throwSites',
      classification: 'static-possible',
      value: {
        scope: fn === undefined ? 'file' : 'function',
        throws,
      },
      evidence: [
        probeEvidence({ operation: 'parser:ThrowStatement', node: resolved.node }),
        ...(throws.length > 0
          ? [evidenceAt(capture, sourceFile, scope.getStart(sourceFile), scope.getEnd(), 'exceptionScope')]
          : [evidenceAt(capture, sourceFile, 0, 0, 'exceptionScope')]),
      ],
      limits,
    }),
  );

  if (fn !== undefined) {
    const signature = service.checker.getSignatureFromDeclaration(fn);
    const tags = signature?.getJsDocTags?.() ?? [];
    const throwsTags = tags.filter((tag) => tag.name === 'throws');
    if (throwsTags.length > 0) {
      facts.push(
        fact({
          id: JSON.stringify(['source', path, sha256, 0, 1, 'exceptions:declaredThrows']),
          kind: 'declaredThrows',
          classification: 'declared',
          value: { tags: throwsTags.map((tag) => ({ name: tag.name, text: tag.text?.map((part) => part.text).join('') ?? '' })) },
          evidence: [evidenceAt(capture, sourceFile, fn.getStart(sourceFile), fn.getEnd(), 'jsDocTag')],
          limits: [limit('exceptions', 'declaredTag', 'a JSDoc @throws tag is author-written text; the compiler does not validate it')],
        }),
      );
    }
  }

  refs.push(sourceRef({ real: path, sha256, line: 0, column: 0, projection: 'exceptions', snapshotId }));
  return { facts, refs, limits };
}
