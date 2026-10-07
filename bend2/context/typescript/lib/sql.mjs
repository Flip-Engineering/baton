// Constant-SQL call facts and model/module use edges.
//
// Every identity here is the checker's: the callee's resolved signature declaration, the
// receiver's resolved declaration, the imported name's aliased declaration, and the alias chain
// that links them. Spellings never decide anything:
//   - only a resolved call whose signature declaration is identical (path, range and file digest)
//     to the declaration selected by options.client is a client match;
//   - a same-name local function, an indirect callee and an `any`-typed or dynamic receiver each
//     keep their own resolution status and a limit at the exact call site;
//   - a variable-keyed element access is dynamic; a quoted string-literal key resolves through the
//     checker like any other property access;
//   - an unresolved import produces no record and keeps a scoped limit instead.
//
// The join itself belongs to the catalogs provider: this module produces the ConstantSqlRecord and
// the ResolverUseRecord (the shapes Models consumes) and never parses, matches or plans SQL. The
// statement kind is `unknown` here, because only the catalog parser's plan decides read from write.

import { resolve } from 'node:path';
import { fact, limit, probeEvidence, sourceEvidence, sourceRef } from './refs.mjs';
import {
  constantSqlRecord,
  declaration,
  unresolvedResolution,
  resolvedResolution,
  modelUseRecord,
} from './records.mjs';
import { nodeAtPosition, point, spanRange, symbolOf } from './bindings.mjs';

function evidenceFor(capture, node, role) {
  const sourceFile = node.getSourceFile();
  const path = resolve(sourceFile.fileName);
  return sourceEvidence({
    real: path,
    sha256: capture.digest(path) ?? '',
    start: point(sourceFile, node.getStart(sourceFile)),
    end: point(sourceFile, node.getEnd()),
    role,
  });
}

function declarationRef(capture, declarationNode) {
  const sourceFile = declarationNode.getSourceFile();
  const path = resolve(sourceFile.fileName);
  return declaration(path, capture.digest(path) ?? '', spanRange(sourceFile, {
    start: declarationNode.getStart(sourceFile),
    length: declarationNode.getWidth(sourceFile),
  }));
}

function identityOfDeclaration(capture, declarationNode) {
  if (declarationNode === undefined) return null;
  const ref = declarationRef(capture, declarationNode);
  return { path: ref.path, sha256: ref.sha256, range: ref.range };
}

function sameIdentity(left, right) {
  if (left === null || right === null) return false;
  return (
    left.path === right.path &&
    left.sha256 === right.sha256 &&
    left.range.start.line === right.range.start.line &&
    left.range.start.column === right.range.start.column
  );
}

function declarationAt(ts, sourceFile, offset) {
  const node = nodeAtPosition(ts, sourceFile, offset);
  if (node === undefined) return undefined;
  let current = node;
  while (current !== undefined) {
    if (
      ts.isMethodSignature(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isPropertySignature(current) ||
      ts.isPropertyDeclaration(current) ||
      ts.isVariableDeclaration(current)
    ) {
      return current;
    }
    if (current === sourceFile) return undefined;
    current = current.parent;
  }
  return undefined;
}

// The enclosing function-like declaration of the subject, so a handler query reports the
// handler's own calls rather than every call in the file.
function scopeOf(ts, sourceFile, offset) {
  const node = nodeAtPosition(ts, sourceFile, Math.max(offset, 0));
  if (node === undefined) return { scope: sourceFile, kind: 'file' };
  let current = node;
  while (current !== undefined && current !== sourceFile) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return { scope: current, kind: 'function' };
    }
    current = current.parent;
  }
  return { scope: sourceFile, kind: 'file' };
}

function sqlArgument(ts, call) {
  const argument = call.arguments[0];
  if (argument === undefined) return { status: 'dynamic', reason: 'noSqlArgument' };
  if (ts.isStringLiteral(argument)) {
    return { status: 'constant', text: argument.text, literalKind: 'stringLiteral' };
  }
  if (ts.isNoSubstitutionTemplateLiteral(argument)) {
    return { status: 'constant', text: argument.text, literalKind: 'template' };
  }
  if (ts.isTemplateExpression(argument)) {
    return { status: 'dynamic', reason: 'templateSubstitution', substitutions: argument.templateSpans.length };
  }
  if (ts.isBinaryExpression(argument) && argument.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return { status: 'dynamic', reason: 'concatenation' };
  }
  return { status: 'dynamic', reason: 'notALiteral' };
}

// The receiver's resolved declaration. A quoted string-literal element access is an ordinary
// property access; a variable key is dynamic and keeps that limit.
function receiverResolution(ts, checker, capture, expression) {
  let target = expression;
  let dynamicReason = null;
  if (ts.isPropertyAccessExpression(expression)) {
    target = expression.expression;
  } else if (ts.isElementAccessExpression(expression)) {
    target = expression.expression;
    const argument = expression.argumentExpression;
    if (argument === undefined || !ts.isStringLiteral(argument)) {
      dynamicReason = 'dynamicPropertyAccess';
    }
  } else if (ts.isCallExpression(expression)) {
    target = expression.expression;
  }
  const symbol = symbolOf(ts, checker, target);
  const declarationNode = symbol?.declarations?.[0];
  if (declarationNode !== undefined) {
    return {
      status: 'resolved',
      declaration: declarationRef(capture, declarationNode),
      dynamicReason,
    };
  }
  const type = checker.getTypeAtLocation(target);
  if ((type.flags & ts.TypeFlags.Any) !== 0) {
    return { status: 'unresolved', reason: 'anyReceiver', dynamicReason };
  }
  if (dynamicReason !== null) {
    return { status: 'unresolved', reason: dynamicReason, dynamicReason };
  }
  return { status: 'unresolved', reason: 'unresolvedReceiver', dynamicReason };
}

function callSiteRefOf({ capture, sourceFile, path, sha256, node, snapshotId }) {
  const range = spanRange(sourceFile, { start: node.getStart(sourceFile), length: node.getWidth(sourceFile) });
  return {
    range,
    ref: sourceRef({ real: path, sha256, line: range.start.line, column: range.start.column, projection: 'databaseAccesses', snapshotId }),
  };
}

export function produceDatabaseAccesses(context) {
  const { ts, service, capture, resolved, request, snapshotId } = context;
  const sourceFile = service.sourceFile;
  const path = service.subjectPath;
  const sha256 = capture.digest(path) ?? '';
  const offset = request.subject.kind === 'symbol'
    ? 0
    : sourceFile.getPositionOfLineAndCharacter(request.subject.line ?? 0, request.subject.column ?? 0);
  const { scope, kind: scopeKind } = scopeOf(ts, sourceFile, offset);

  const facts = [];
  const refs = [];
  const limits = [];
  if (scopeKind === 'file') {
    limits.push(limit('databaseAccesses', 'fileScope', 'no enclosing function was resolved for the subject, so the whole file was examined'));
  }

  let clientIdentity = null;
  if (request.options.client !== null) {
    const clientPath = resolve(request.cwd, request.options.client.path);
    const clientFile = service.program.getSourceFile(clientPath);
    if (clientFile === undefined) {
      limits.push(limit('databaseAccesses', 'clientNotInProgram', 'the client selector file is not part of the analyzed program'));
    } else {
      const clientOffset = clientFile.getPositionOfLineAndCharacter(request.options.client.line, request.options.client.column);
      const clientDeclaration = declarationAt(ts, clientFile, clientOffset);
      if (clientDeclaration === undefined) {
        limits.push(limit('databaseAccesses', 'clientDeclarationUnresolved', 'no declaration starts at the client selector position'));
      } else {
        clientIdentity = identityOfDeclaration(capture, clientDeclaration);
      }
    }
  }

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const { range, ref } = callSiteRefOf({ capture, sourceFile, path, sha256, node, snapshotId });
      const calleeSymbol = symbolOf(ts, service.checker, node.expression);
      const signature = service.checker.getResolvedSignature(node);
      const signatureDeclaration = signature?.declaration;
      const resolvedCallee = identityOfDeclaration(capture, signatureDeclaration);
      const receiver = receiverResolution(ts, service.checker, capture, node.expression);
      const form = sqlArgument(ts, node);

      let calleeResolution;
      if (resolvedCallee === null) {
        calleeResolution = unresolvedResolution('calleeUnresolved');
      } else if (clientIdentity === null) {
        calleeResolution = unresolvedResolution('clientNotAdmitted');
      } else if (sameIdentity(resolvedCallee, clientIdentity)) {
        calleeResolution = resolvedResolution(declaration(resolvedCallee.path, resolvedCallee.sha256, resolvedCallee.range));
      } else {
        calleeResolution = unresolvedResolution('clientDeclarationMismatch');
      }

      const sql = form.status === 'constant'
        ? { status: 'constant', text: form.text, literalKind: form.literalKind }
        : { status: 'dynamic', reason: form.reason };

      const recordLimits = [];
      if (form.status === 'dynamic') {
        recordLimits.push('dynamicSql');
        limits.push(limit('databaseAccesses', 'dynamicSql', `a database call at line ${range.start.line} carries no constant statement`));
      }
      if (calleeResolution.status === 'unresolved' && calleeResolution.reason === 'clientDeclarationMismatch') {
        recordLimits.push('shadowedClient');
        limits.push(limit('databaseAccesses', 'shadowedClient', `a call at line ${range.start.line} resolves to a declaration that is not the admitted client declaration`));
      }
      if (receiver.status === 'unresolved') {
        recordLimits.push(receiver.reason);
        limits.push(limit('databaseAccesses', receiver.reason, `a receiver at line ${range.start.line} has no resolved declaration`));
      }
      if (receiver.dynamicReason !== null) {
        recordLimits.push(receiver.dynamicReason);
        limits.push(limit('databaseAccesses', receiver.dynamicReason, `a computed property key at line ${range.start.line} is not a resolvable property access`));
      }

      const record = constantSqlRecord({
        resolved,
        snapshotId,
        callSite: { path, sha256, range },
        callee: calleeResolution,
        receiver: receiver.status === 'resolved'
          ? resolvedResolution(receiver.declaration)
          : unresolvedResolution(receiver.reason),
        sql,
        // Only the catalog parser's plan decides read from write; this producer does not infer it.
        statementKind: 'unknown',
        limits: recordLimits,
      });

      facts.push(
        fact({
          id: ref.id,
          kind: 'sqlCall',
          classification: 'static-possible',
          value: {
            record,
            callSiteRef: ref.id,
            clientMatch: clientIdentity === null
              ? 'notRequested'
              : sameIdentity(resolvedCallee, clientIdentity)
                ? 'matched'
                : 'shadowed',
            sourceBinding: ref.id,
            snapshotId,
          },
          evidence: [
            evidenceFor(capture, node, 'callSite'),
            probeEvidence({ operation: 'checker.getResolvedSignature', node: resolved.node }),
            ...(resolvedCallee === null
              ? []
              : [
                  {
                    kind: 'source',
                    path: resolvedCallee.path,
                    sha256: resolvedCallee.sha256,
                    range: resolvedCallee.range,
                    role: 'calleeDeclaration',
                  },
                ]),
            ...(clientIdentity === null
              ? []
              : [
                  {
                    kind: 'source',
                    path: clientIdentity.path,
                    sha256: clientIdentity.sha256,
                    range: clientIdentity.range,
                    role: 'clientDeclaration',
                  },
                ]),
          ],
          limits: recordLimits.map((code) => limit('databaseAccesses', code, 'the join is not produced for this call')),
        }),
      );
      refs.push(ref);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(scope, visit);

  return { facts, refs, limits };
}

// The alias chain of one imported name: the importing specifier in this file and every export
// specifier the checker followed to the original declaration.
function aliasChainOf(ts, capture, symbol) {
  const chain = [];
  const declarations = symbol?.declarations ?? [];
  for (const declarationNode of declarations) {
    if (ts.isImportSpecifier(declarationNode) || ts.isImportClause(declarationNode) || ts.isNamespaceImport(declarationNode)) {
      chain.push({ role: 'importSpecifier', ...evidenceRef(capture, declarationNode) });
    } else if (ts.isExportSpecifier(declarationNode)) {
      chain.push({ role: 'exportSpecifier', ...evidenceRef(capture, declarationNode) });
    }
  }
  return chain;
}

function evidenceRef(capture, node) {
  const sourceFile = node.getSourceFile();
  const path = resolve(sourceFile.fileName);
  return {
    path,
    sha256: capture.digest(path) ?? '',
    range: spanRange(sourceFile, { start: node.getStart(sourceFile), length: node.getWidth(sourceFile) }),
  };
}

function useSitesOf(ts, checker, sourceFile, localName, aliasSymbol, aliasedSymbol) {
  const sites = [];
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === localName) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol === aliasSymbol || symbol === aliasedSymbol) {
        sites.push(spanRange(sourceFile, { start: node.getStart(sourceFile), length: node.getWidth(sourceFile) }));
      }
    }
    ts.forEachChild(node, visit);
  };
  sourceFile.forEachChild(visit);
  return sites;
}

export function produceModuleUses(context) {
  const { ts, service, capture, resolved, request, snapshotId } = context;
  const sourceFile = service.sourceFile;
  const path = service.subjectPath;
  const sha256 = capture.digest(path) ?? '';
  const facts = [];
  const refs = [];
  const limits = [];
  const moduleHost = {
    fileExists: (file) => capture.fileExists(file),
    readFile: (file) => capture.readText(file),
    directoryExists: (directory) => capture.directoryExists(directory),
    getDirectories: (directory) => capture.readDirectory(directory),
    realpath: (file) => capture.realpath(file),
    getCurrentDirectory: () => request.cwd,
    getCanonicalFileName: (file) => file,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };

  const emit = (node, specifierText, name, modulePath, resolution, aliasChain, useSites, failureLimit) => {
    const ref = sourceRef({
      real: path,
      sha256,
      line: point(sourceFile, node.getStart(sourceFile)).line,
      column: point(sourceFile, node.getStart(sourceFile)).column,
      projection: 'dependencies',
      snapshotId,
    });
    const record = modulePath === null
      ? null
      : modelUseRecord({
          resolved,
          snapshotId,
          useSite: {
            path,
            sha256,
            range: spanRange(sourceFile, { start: node.getStart(sourceFile), length: node.getWidth(sourceFile) }),
            role: name === null ? 'moduleSpecifier' : 'importSpecifier',
          },
          module: { path: modulePath, sha256: capture.digest(modulePath) ?? '' },
          exportName: name,
          resolution,
          limits: failureLimit === null ? [] : [failureLimit],
        });
    facts.push(
      fact({
        id: JSON.stringify(['source', path, sha256, ref.subject.line, ref.subject.column, `moduleUse:${specifierText}:${name ?? ''}`]),
        kind: 'moduleUse',
        classification: 'static-possible',
        value: {
          record,
          useSiteRef: ref.id,
          snapshotId,
          moduleSpecifier: specifierText,
          resolution: record === null ? resolution : record.resolution,
          aliasChain,
          useSites,
        },
        evidence: [
          evidenceFor(capture, node, 'moduleSpecifier'),
          probeEvidence({ operation: 'ts.resolveModuleName+checker.getAliasedSymbol', node: resolved.node }),
          ...aliasChain.map((entry) => ({
            kind: 'source',
            path: entry.path,
            sha256: entry.sha256,
            range: entry.range,
            role: entry.role,
          })),
        ],
        limits: failureLimit === null
          ? [limit('dependencies', 'resolvedDeclarationIdentity', 'the edge names the checker-resolved declaration and snapshot')]
          : [limit('dependencies', failureLimit, 'this import produced no resolved use edge')],
      }),
    );
    refs.push(ref);
    if (modulePath !== null) {
      const digest = capture.digest(modulePath) ?? '';
      refs.push(sourceRef({ real: modulePath, sha256: digest, line: 0, column: 0, projection: 'dependencies', snapshotId }));
    }
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier;
      const resolution = ts.resolveModuleName(specifier.text, path, service.options, moduleHost);
      const modulePath = resolution.resolvedModule
        ? resolve(request.cwd, resolution.resolvedModule.resolvedFileName)
        : null;
      const moduleFile = modulePath === null ? undefined : service.program.getSourceFile(modulePath);
      if (modulePath === null || moduleFile === undefined) {
        limits.push(limit('dependencies', 'moduleUnresolved', 'the compiler resolved no module file for a specifier in this handler'));
        emit(specifier, specifier.text, null, null, unresolvedResolution('moduleUnresolved'), [], [], 'moduleUnresolved');
        return;
      }
      const clause = node.importClause;
      if (clause === undefined) {
        emit(specifier, specifier.text, null, modulePath, resolvedResolution(declaration(modulePath, capture.digest(modulePath) ?? '', spanRange(moduleFile, { start: 0, length: 0 }))), [], [], null);
        return;
      }
      if (clause.namedBindings !== undefined && ts.isNamespaceImport(clause.namedBindings)) {
        limits.push(limit('dependencies', 'namespaceBinding', 'a namespace import names no single export declaration'));
        emit(clause.namedBindings, specifier.text, null, modulePath, unresolvedResolution('namespaceBinding'), [], [], 'namespaceBinding');
        return;
      }
      const names = [];
      if (clause.name !== undefined) names.push(clause.name);
      if (clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) names.push(element.name);
      }
      for (const nameNode of names) {
        const aliasSymbol = service.checker.getSymbolAtLocation(nameNode);
        let aliasedSymbol = aliasSymbol;
        if (aliasSymbol !== undefined && (aliasSymbol.flags & ts.SymbolFlags.Alias) !== 0) {
          aliasedSymbol = service.checker.getAliasedSymbol(aliasSymbol);
        }
        const declarationNode = aliasedSymbol?.declarations?.[0];
        const chain = aliasChainOf(ts, capture, aliasSymbol);
        const useSites = useSitesOf(ts, service.checker, sourceFile, nameNode.text, aliasSymbol, aliasedSymbol);
        if (declarationNode === undefined) {
          limits.push(limit('dependencies', 'exportDeclarationUnresolved', 'the imported name has no resolved declaration in this program'));
          emit(nameNode, specifier.text, nameNode.text, modulePath, unresolvedResolution('exportDeclarationUnresolved'), chain, useSites, 'exportDeclarationUnresolved');
          continue;
        }
        const target = identityOfDeclaration(capture, declarationNode);
        emit(nameNode, specifier.text, nameNode.text, modulePath, resolvedResolution(declaration(target.path, target.sha256, target.range)), chain, useSites, null);
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  sourceFile.forEachChild(visit);
  return { facts, refs, limits };
}
