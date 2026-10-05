// Definitions, types, references, calls, callers and dependencies.
//
// Every producer returns facts whose evidence names the captured file and the exact range the
// compiler reported, and every limit it cannot honestly close is stated at the site it applies
// to. The providers are the public TypeScript 5.9.3 language service and checker only.

import { isAbsolute, resolve } from 'node:path';
import { fact, limit, probeEvidence, sourceEvidence, sourceRef } from './refs.mjs';

export function point(sourceFile, position) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(position);
  return { line, column: character };
}

export function spanRange(sourceFile, span) {
  return { start: point(sourceFile, span.start), end: point(sourceFile, span.start + span.length) };
}

function textOf(sourceFile, span) {
  return sourceFile.text.slice(span.start, span.start + span.length);
}

// The innermost node containing the offset. The public parser API is used; no runtime-only
// helper such as getTokenAtPosition enters the provider.
export function nodeAtPosition(ts, sourceFile, offset) {
  let found;
  const visit = (node) => {
    if (offset < node.getStart(sourceFile) || offset > node.getEnd()) return;
    found = node;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

export function symbolOf(ts, checker, node) {
  if (node === undefined) return undefined;
  const symbol = checker.getSymbolAtLocation(node);
  if (symbol === undefined) return undefined;
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    try {
      return checker.getAliasedSymbol(symbol);
    } catch {
      return symbol;
    }
  }
  return symbol;
}

export function declarationOf(ts, checker, symbol, fallback) {
  const declaration = symbol?.declarations?.[0] ?? fallback;
  if (declaration === undefined) return null;
  const path = resolve(declaration.getSourceFile().fileName);
  return {
    path,
    range: spanRange(declaration.getSourceFile(), {
      start: declaration.getStart(),
      length: declaration.getEnd() - declaration.getStart(),
    }),
  };
}

function declarationValue(ts, checker, capture, declaration) {
  const sourceFile = declaration.getSourceFile();
  const path = resolve(sourceFile.fileName);
  return {
    path,
    sha256: capture.digest(path) ?? null,
    symbolId: checker.getFullyQualifiedName(checker.getSymbolAtLocation(declaration) ?? undefined) || null,
    range: spanRange(sourceFile, { start: declaration.getStart(), length: declaration.getEnd() - declaration.getStart() }),
  };
}

function subjectPosition(request, sourceFile) {
  if (request.subject.kind === 'position' || request.subject.kind === 'diagnostic') {
    return sourceFile.getPositionOfLineAndCharacter(request.subject.line, request.subject.column);
  }
  return symbolOffset(request, sourceFile);
}

export function symbolOffset(request, sourceFile) {
  const wanted = request.subject.name;
  const candidates = [];
  const visit = (node) => {
    if (
      node.getSourceFile() === sourceFile &&
      (node.kind === 80 /* Identifier */ || node.kind === 79 /* PrivateIdentifier */ || node.kind === 81 /* QualifiedName */)
    ) {
      const text = node.getText(sourceFile);
      if (text === wanted) {
        candidates.push(node);
        return;
      }
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  if (candidates.length === 0) return -1;
  return candidates[0].getStart(sourceFile);
}

function subjectEvidence(capture, sourceFile, position) {
  const path = resolve(sourceFile.fileName);
  const pointAt = point(sourceFile, position);
  return sourceEvidence({
    real: path,
    sha256: capture.digest(path) ?? '',
    start: pointAt,
    end: { line: pointAt.line, column: pointAt.column + 1 },
    role: 'subjectLocation',
  });
}

export function produceDefinition(context) {
  const { ts, service, capture, resolved, request, snapshotId } = context;
  const offset = subjectPosition(request, service.sourceFile);
  if (offset < 0) {
    return {
      facts: [fact({ id: 'definition:unresolved', kind: 'definition', classification: 'static-possible', value: { definitions: [] }, evidence: [subjectEvidence(capture, service.sourceFile, 0)], limits: [limit('definition', 'symbolNotResolved', 'no matching declaration name in the subject file')] })],
      refs: [],
    };
  }
  const definitions = service.languageService.getDefinitionAtPosition(service.subjectPath, offset) ?? [];
  const path = resolve(service.sourceFile.fileName);
  const sha256 = capture.digest(path) ?? '';
  const evidence = [subjectEvidence(capture, service.sourceFile, offset), probeEvidence({ operation: 'languageService.getDefinitionAtPosition', node: resolved.node })];
  const refs = [sourceRef({ real: path, sha256, line: point(service.sourceFile, offset).line, column: point(service.sourceFile, offset).column, projection: 'definition', snapshotId })];
  const value = { definitions: [] };
  const limits = [];
  for (const definition of definitions) {
    const file = definition.fileName;
    const digest = capture.digest(file) ?? '';
    const sourceFile = service.program.getSourceFile(file);
    const range = sourceFile === undefined ? null : spanRange(sourceFile, definition.textSpan);
    value.definitions.push({
      name: definition.name,
      kind: definition.kind,
      containerName: definition.containerName ?? null,
      isLocal: definition.isLocal ?? false,
      declaration: { path: file, sha256: digest, range },
    });
    if (sourceFile !== undefined) {
      evidence.push(sourceEvidence({ real: file, sha256: digest, start: range.start, end: range.end, role: 'definition' }));
      refs.push(sourceRef({ real: file, sha256: digest, line: range.start.line, column: range.start.column, projection: 'definition', snapshotId }));
    }
  }
  if (definitions.length === 0) {
    limits.push(limit('definition', 'noDefinition', 'the language service reported no definition at this position in this program'));
  }
  return {
    facts: [fact({ id: sourceRefIdOf(capture, service.sourceFile, offset), kind: 'definition', classification: 'static-possible', value, evidence, limits })],
    refs,
  };
}

function sourceRefIdOf(capture, sourceFile, offset) {
  const path = resolve(sourceFile.fileName);
  const at = point(sourceFile, offset);
  return JSON.stringify(['source', path, capture.digest(path) ?? '', at.line, at.column, 'definition']);
}

export function produceType(context) {
  const { ts, service, capture, resolved, request } = context;
  const offset = subjectPosition(request, service.sourceFile);
  if (offset < 0) {
    return { facts: [], refs: [], limits: [limit('type', 'symbolNotResolved', 'no matching declaration name in the subject file')] };
  }
  const node = nodeAtPosition(ts, service.sourceFile, offset);
  if (node === undefined) {
    return { facts: [], refs: [], limits: [limit('type', 'noNodeAtPosition', 'no syntax node contains this position')] };
  }
  const type = service.checker.getTypeAtLocation(node);
  const typeText = service.checker.typeToString(type);
  const symbol = symbolOf(ts, service.checker, node);
  let declaredText = null;
  if (symbol !== undefined && symbol.declarations !== undefined && symbol.declarations.length > 0) {
    declaredText = service.checker.typeToString(
      service.checker.getTypeOfSymbolAtLocation(symbol, symbol.declarations[0]),
    );
  }
  const path = resolve(service.sourceFile.fileName);
  const sha256 = capture.digest(path) ?? '';
  const at = point(service.sourceFile, node.getStart(service.sourceFile));
  const value = {
    typeText,
    declaredTypeText: declaredText,
    typeFlags: type.flags,
    never: (type.flags & ts.TypeFlags.Never) !== 0,
    any: (type.flags & ts.TypeFlags.Any) !== 0,
    point: at,
    proposition: 'TypeScript 5.9.3 reports this type at this position in this snapshot',
    provider: { name: 'typescript', version: resolved.version, librarySha: resolved.librarySha },
  };
  const limits = [];
  if (value.any) limits.push(limit('type', 'anyTypedSubject', 'the subject type is any, so type relationships are unavailable'));
  return {
    facts: [
      fact({
        id: JSON.stringify(['source', path, sha256, at.line, at.column, 'type']),
        kind: 'type',
        classification: 'checked',
        value,
        evidence: [subjectEvidence(capture, service.sourceFile, offset), probeEvidence({ operation: 'checker.getTypeAtLocation', node: resolved.node })],
        limits,
      }),
    ],
    refs: [sourceRef({ real: path, sha256, line: at.line, column: at.column, projection: 'type', snapshotId: context.snapshotId })],
  };
}

export function produceReferences(context) {
  const { service, capture, resolved, request, snapshotId } = context;
  const offset = subjectPosition(request, service.sourceFile);
  if (offset < 0) {
    return { facts: [], refs: [], limits: [limit('references', 'symbolNotResolved', 'no matching declaration name in the subject file')] };
  }
  const groups = service.languageService.findReferences(service.subjectPath, offset) ?? [];
  const facts = [];
  const refs = [];
  const path = resolve(service.sourceFile.fileName);
  const sha256 = capture.digest(path) ?? '';
  for (const group of groups) {
    const definitionPath = resolve(group.definition.fileName);
    const entries = [];
    const evidence = [
      probeEvidence({ operation: 'languageService.findReferences', node: resolved.node }),
      sourceEvidence({
        real: definitionPath,
        sha256: capture.digest(definitionPath) ?? '',
        start: point(service.sourceFile, group.definition.textSpan.start),
        end: point(service.sourceFile, group.definition.textSpan.start + group.definition.textSpan.length),
        role: 'definition',
      }),
    ];
    for (const reference of group.references) {
      const file = resolve(reference.fileName);
      const digest = capture.digest(file) ?? '';
      const sourceFile = service.program.getSourceFile(reference.fileName);
      const range = sourceFile === undefined
        ? null
        : spanRange(sourceFile, { start: reference.textSpan.start, length: reference.textSpan.length });
      entries.push({
        path: file,
        sha256: digest,
        range,
        isDefinition: reference.isDefinition === true,
        isWriteAccess: reference.isWriteAccess === true,
      });
      if (sourceFile !== undefined) {
        evidence.push(sourceEvidence({ real: file, sha256: digest, start: range.start, end: range.end, role: reference.isDefinition ? 'definition' : 'reference' }));
        refs.push(sourceRef({ real: file, sha256: digest, line: range.start.line, column: range.start.column, projection: 'references', snapshotId }));
      }
    }
    const limits = [
      limit('references', 'sameSymbolOccurrences', 'references are same-symbol occurrences resolved in this snapshot, not a def-use chain'),
    ];
    facts.push(
      fact({
        id: JSON.stringify(['source', definitionPath, capture.digest(definitionPath) ?? '', group.definition.textSpan.start, 0, 'references']),
        kind: 'references',
        classification: 'static-possible',
        value: { definition: { path: definitionPath, range: entries.find((entry) => entry.isDefinition)?.range ?? null }, references: entries },
        evidence,
        limits,
      }),
    );
  }
  if (groups.length === 0) {
    facts.push(
      fact({
        id: JSON.stringify(['source', path, sha256, 0, 0, 'references']),
        kind: 'references',
        classification: 'static-possible',
        value: { definition: null, references: [] },
        evidence: [subjectEvidence(capture, service.sourceFile, offset), probeEvidence({ operation: 'languageService.findReferences', node: resolved.node })],
        limits: [limit('references', 'dynamicPropertyAccess', 'the compiler resolved no reference group at this position')],
      }),
    );
  }
  return { facts, refs };
}

export function produceCalls(context) {
  const { service, capture, resolved, request, snapshotId, ts } = context;
  const offset = subjectPosition(request, service.sourceFile);
  if (offset < 0) {
    return { facts: [], refs: [], limits: [limit('calls', 'symbolNotResolved', 'no matching declaration name in the subject file')] };
  }
  const items = service.languageService.prepareCallHierarchy(service.subjectPath, offset) ?? [];
  const facts = [];
  const refs = [];
  for (const item of items) {
    const calls = service.languageService.provideCallHierarchyOutgoingCalls(item.fileName, item.selectionSpan.start) ?? [];
    const evidence = [probeEvidence({ operation: 'languageService.provideCallHierarchyOutgoingCalls', node: resolved.node })];
    const outgoing = [];
    for (const call of calls) {
      const target = call.to;
      const targetPath = resolve(target.fileName);
      const digest = capture.digest(targetPath) ?? '';
      const sourceFile = service.program.getSourceFile(target.fileName);
      const calleeRange = sourceFile === undefined ? null : spanRange(sourceFile, target.selectionSpan);
      const sites = [];
      for (const range of call.fromRanges) {
        const callerFile = service.program.getSourceFile(service.subjectPath);
        const site = callerFile === undefined ? null : spanRange(callerFile, range);
        sites.push(site);
        if (callerFile !== undefined && site !== null) {
          evidence.push(sourceEvidence({ real: service.subjectPath, sha256: capture.digest(service.subjectPath) ?? '', start: site.start, end: site.end, role: 'callSite' }));
          refs.push(sourceRef({ real: service.subjectPath, sha256: capture.digest(service.subjectPath) ?? '', line: site.start.line, column: site.start.column, projection: 'calls', snapshotId }));
        }
      }
      outgoing.push({
        callee: { name: target.name, kind: target.kind, path: targetPath, sha256: digest, range: calleeRange },
        callSites: sites,
      });
      if (calleeRange !== null) {
        evidence.push(sourceEvidence({ real: targetPath, sha256: digest, start: calleeRange.start, end: calleeRange.end, role: 'callee' }));
        refs.push(sourceRef({ real: targetPath, sha256: digest, line: calleeRange.start.line, column: calleeRange.start.column, projection: 'calls', snapshotId }));
      }
    }
    facts.push(
      fact({
        id: JSON.stringify(['source', resolve(item.fileName), capture.digest(resolve(item.fileName)) ?? '', item.selectionSpan.start, 0, 'calls']),
        kind: 'calls',
        classification: 'static-possible',
        value: { subject: { name: item.name, kind: item.kind, path: resolve(item.fileName) }, outgoing },
        evidence,
        limits: [limit('calls', 'valueIndirectCall', 'outgoing call edges name direct calls only; a callee held in a variable, a property of inferred type or a function-typed parameter produces no edge')],
      }),
    );
  }
  return { facts, refs, limits: [] };
}

export function produceCallers(context) {
  const { service, capture, resolved, request, snapshotId } = context;
  const offset = subjectPosition(request, service.sourceFile);
  if (offset < 0) {
    return { facts: [], refs: [], limits: [limit('callers', 'symbolNotResolved', 'no matching declaration name in the subject file')] };
  }
  const items = service.languageService.prepareCallHierarchy(service.subjectPath, offset) ?? [];
  const facts = [];
  const refs = [];
  for (const item of items) {
    const incoming = service.languageService.provideCallHierarchyIncomingCalls(item.fileName, item.selectionSpan.start) ?? [];
    const evidence = [probeEvidence({ operation: 'languageService.provideCallHierarchyIncomingCalls', node: resolved.node })];
    const callers = [];
    for (const call of incoming) {
      const from = call.from;
      const fromPath = resolve(from.fileName);
      const digest = capture.digest(fromPath) ?? '';
      const sourceFile = service.program.getSourceFile(from.fileName);
      const range = sourceFile === undefined ? null : spanRange(sourceFile, from.selectionSpan);
      callers.push({ name: from.name, kind: from.kind, path: fromPath, sha256: digest, range });
      if (range !== null) {
        evidence.push(sourceEvidence({ real: fromPath, sha256: digest, start: range.start, end: range.end, role: 'caller' }));
        refs.push(sourceRef({ real: fromPath, sha256: digest, line: range.start.line, column: range.start.column, projection: 'callers', snapshotId }));
      }

    }
    facts.push(
      fact({
        id: JSON.stringify(['source', resolve(item.fileName), capture.digest(resolve(item.fileName)) ?? '', item.selectionSpan.start, 1, 'callers']),
        kind: 'callers',
        classification: 'static-possible',
        value: { subject: { name: item.name, kind: item.kind, path: resolve(item.fileName) }, callers },
        evidence,
        limits: [],
      }),
    );
  }
  return { facts, refs, limits: [] };
}

export function produceDependencies(context) {
  const { ts, service, capture, resolved, request, snapshotId } = context;
  const sourceFile = service.sourceFile;
  const path = resolve(sourceFile.fileName);
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
  const record = (specifier, specifierNode, resolution) => {
    const range = spanRange(sourceFile, { start: specifierNode.getStart(sourceFile), length: specifierNode.getWidth(sourceFile) });
    const evidence = [
      sourceEvidence({ real: path, sha256, start: range.start, end: range.end, role: 'moduleSpecifier' }),
      probeEvidence({ operation: 'ts.resolveModuleName', node: resolved.node }),
    ];
    const value = {
      specifier: specifier.text,
      isTypeOnly: specifierNode.parent?.isTypeOnly === true,
      resolved: null,
    };
    if (resolution?.resolvedModule) {
      const resolvedPath = resolve(request.cwd, resolution.resolvedModule.resolvedFileName);
      const digest = capture.digest(resolvedPath) ?? '';
      value.resolved = { path: resolvedPath, sha256: digest, extension: resolution.resolvedModule.extension };
      evidence.push(
        sourceEvidence({ real: resolvedPath, sha256: digest, start: { line: 0, column: 0 }, end: { line: 0, column: 0 }, role: 'dependencyRoot' }),
      );
      refs.push(sourceRef({ real: resolvedPath, sha256: digest, line: 0, column: 0, projection: 'dependencies', snapshotId }));
    } else {
      limits.push(limit('dependencies', 'unresolvedModule', `the compiler resolved no module for a specifier at line ${range.start.line}`));
    }
    facts.push(
      fact({
        id: JSON.stringify(['source', path, sha256, range.start.line, range.start.column, 'dependencies']),
        kind: 'dependency',
        classification: 'static-possible',
        value,
        evidence,
        limits: [],
      }),
    );
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const resolution = ts.resolveModuleName(node.moduleSpecifier.text, path, service.options, moduleHost);
      record(node.moduleSpecifier, node.moduleSpecifier, resolution);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      const resolution = ts.resolveModuleName(node.moduleSpecifier.text, path, service.options, moduleHost);
      record(node.moduleSpecifier, node.moduleSpecifier, resolution);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      limits.push(limit('dependencies', 'dynamicImport', 'a dynamic import is recorded as a limit and produces no resolved edge'));
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return { facts, refs, limits };
}

export function isTypeOnlyNode(ts, node) {
  return node !== undefined && node.isTypeOnly === true;
}
