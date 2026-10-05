/**
 * Provider-direct probe for the TypeScript engine: loads the pinned TypeScript
 * compiler and drives its public LanguageService/checker surface over the
 * fixture tree with an in-memory overlay host. This probe is acceptance
 * tooling; it contains no provider production code.
 *
 * Every node/position conversion uses only names declared in the pinned public
 * typescript.d.ts (acceptance gate A10 of the retained bindings-critic work).
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sha256, locate } from "../lib/util.mjs";

const DEFAULT_TYPESCRIPT = "/Users/wahargis/node_modules/typescript/lib/typescript.js";

async function loadTypescript(explicitPath) {
  const resolved = path.resolve(explicitPath ?? DEFAULT_TYPESCRIPT);
  const module = await import(pathToFileURL(resolved).href);
  return { ts: module.default ?? module, resolved };
}

/** Public-API position->node walk: deepest node whose span contains position. */
function nodeAtPosition(sourceFile, position, ts) {
  let found = sourceFile;
  const walk = (node) => {
    if (position < node.getStart(sourceFile) || position >= node.getEnd()) {
      return;
    }
    found = node;
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
  return found;
}

function positionOf(sourceFile, located) {
  const lines = sourceFile.text.split("\n");
  let offset = 0;
  for (let i = 0; i < located.line; i += 1) {
    offset += lines[i].length + 1;
  }
  return offset + located.column;
}

function diagnosticShape(ts, file, diagnostic) {
  const start = typeof diagnostic.start === "number" ? diagnostic.start : null;
  const startLoc =
    start !== null
      ? sourceLineCol(file.text, start)
      : null;
  return {
    code: diagnostic.code,
    category: ts.DiagnosticCategory[diagnostic.category],
    family: null,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    start: startLoc,
    length: typeof diagnostic.length === "number" ? diagnostic.length : null,
    source: diagnostic.source ?? null,
  };
}

function sourceLineCol(text, offset) {
  const before = text.slice(0, offset);
  const line = before.split("\n").length - 1;
  const lastNewline = before.lastIndexOf("\n");
  return { line, column: offset - (lastNewline + 1) };
}

/** Overlay LanguageServiceHost over a map of relativePath -> string content. */
function createOverlayHost(ts, fixtureRoot, files, compilerOptions, currentDirectory) {
  const versions = new Map();
  return {
    getScriptFileNames() {
      return [...files.keys()];
    },
    getScriptVersion(fileName) {
      return versions.get(fileName) ?? "0";
    },
    getScriptSnapshot(fileName) {
      const content = files.get(fileName);
      if (content !== undefined) {
        return ts.ScriptSnapshot.fromString(content);
      }
      const absolute = path.resolve(currentDirectory ?? fixtureRoot, fileName);
      if (fs.existsSync(absolute)) {
        return ts.ScriptSnapshot.fromString(fs.readFileSync(absolute, "utf8"));
      }
      return undefined;
    },
    fileExists(fileName) {
      if (files.has(fileName)) {
        return true;
      }
      return fs.existsSync(path.resolve(currentDirectory ?? fixtureRoot, fileName));
    },
    readFile(fileName) {
      const content = files.get(fileName);
      if (content !== undefined) {
        return content;
      }
      return fs.readFileSync(path.resolve(currentDirectory ?? fixtureRoot, fileName), "utf8");
    },
    readDirectory(dirPath, extensions, excludes, includes, depth) {
      return ts.sys.readDirectory(
        path.resolve(currentDirectory ?? fixtureRoot, dirPath),
        extensions,
        excludes,
        includes,
        depth,
      );
    },
    directoryExists(dirPath) {
      if (dirPath === undefined) {
        return false;
      }
      return fs.existsSync(path.resolve(currentDirectory ?? fixtureRoot, dirPath));
    },
    getDirectories(dirPath) {
      return fs.existsSync(path.resolve(currentDirectory ?? fixtureRoot, dirPath))
        ? fs.readdirSync(path.resolve(currentDirectory ?? fixtureRoot, dirPath), { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
        : [];
    },
    getCompilationSettings() {
      return compilerOptions;
    },
    getCurrentDirectory() {
      return currentDirectory ?? fixtureRoot;
    },
    getDefaultLibFileName(options) {
      return ts.getDefaultLibFilePath(options);
    },
    getNewLine() {
      return "\n";
    },
    useCaseSensitiveFileNames() {
      return ts.sys.useCaseSensitiveFileNames;
    },
  };
}

function snapshotId(entries) {
  const canonical = [...entries.entries()]
    .map(([name, digest]) => `${name}:${digest}`)
    .sort()
    .join("\n");
  return sha256(canonical);
}

function digestOverlay(files) {
  const entries = new Map();
  for (const [name, content] of files) {
    entries.set(name, sha256(Buffer.from(content, "utf8")));
  }
  return entries;
}

export async function createTsProbe(options = {}) {
  const { ts, resolved: typescriptPath } = await loadTypescript(options.typescriptPath);
  const fixtureRoot = path.resolve(options.fixtureRoot);
  const configPath = path.join(fixtureRoot, "tsconfig.json");
  const configText = fs.readFileSync(configPath, "utf8");
  const parsedConfig = ts.parseJsonConfigFileContent(
    JSON.parse(configText),
    ts.sys,
    fixtureRoot,
    undefined,
    configPath,
  );

  function buildService(overlayEntries, compilerOptionsOverride) {
    const files = new Map(overlayEntries);
    const compilerOptions = {
      ...parsedConfig.options,
      ...(compilerOptionsOverride ?? {}),
    };
    const host = createOverlayHost(ts, fixtureRoot, files, compilerOptions);
    const languageService = ts.createLanguageService(host, ts.createDocumentRegistry());
    return { files, languageService, program: () => languageService.getProgram() };
  }

  function initialOverlay() {
    const entries = new Map();
    for (const root of parsedConfig.fileNames) {
      const relative = path.relative(fixtureRoot, root).split(path.sep).join("/");
      entries.set(relative, fs.readFileSync(root, "utf8"));
    }
    for (const extra of options.extraFiles ?? []) {
      entries.set(extra.relative, extra.content);
    }
    return entries;
  }

  function sourceAt(service, relativePath) {
    const program = service.program();
    const sourceFile = program.getSourceFile(path.resolve(fixtureRoot, relativePath));
    if (sourceFile === undefined) {
      throw new Error(`fixture not in program: ${relativePath}`);
    }
    return sourceFile;
  }

  /** Locate a subject by regex and resolve its symbol through the checker. */
  function symbolAtCase(caseSpec, overlayOverride, optionsOverride) {
    const service = buildService(overlayOverride ?? initialOverlay(), optionsOverride);
    const sourceFile = sourceAt(service, caseSpec.file);
    const located = locate(sourceFile.text, caseSpec.locate, caseSpec.occurrence ?? 0);
    if (located === null) {
      return { error: `subject not found: ${caseSpec.locate}` };
    }
    const program = service.program();
    const checker = program.getTypeChecker();
    const position = positionOf(sourceFile, located);
    const node = nodeAtPosition(sourceFile, position, ts);
    const symbol = checker.getSymbolAtLocation(ts.isIdentifier(node) ? node : node);
    const aliased = symbol !== undefined ? checker.getAliasedSymbol(symbol) : undefined;
    const canonical = aliased !== undefined && aliased !== symbol ? aliased : symbol;
    const declarationInfo = (sym) =>
      sym === undefined || sym === null
        ? null
        : (sym.declarations ?? []).map((decl) => ({
            file: path.relative(fixtureRoot, decl.getSourceFile().fileName).split(path.sep).join("/"),
            start: sourceLineCol(decl.getSourceFile().text, decl.getStart(decl.getSourceFile())),
            kind: ts.SyntaxKind[decl.kind],
          }));
    return {
      provider: { typescriptVersion: ts.version, typescriptPath },
      fixture: caseSpec.file,
      located: { line: located.line, column: located.column, text: located.text },
      useSite: {
        name: symbol?.name ?? null,
        flags: symbol ? ts.SymbolFlags[symbol.flags] : null,
        declarations: declarationInfo(symbol),
      },
      canonical: {
        name: canonical?.name ?? null,
        flags: canonical ? ts.SymbolFlags[canonical.flags] : null,
        declarations: declarationInfo(canonical),
      },
    };
  }

  function referencesCase(caseSpec, overlayOverride, optionsOverride) {
    const service = buildService(overlayOverride ?? initialOverlay(), optionsOverride);
    const sourceFile = sourceAt(service, caseSpec.file);
    const located = locate(sourceFile.text, caseSpec.locate, caseSpec.occurrence ?? 0);
    if (located === null) {
      return { error: `subject not found: ${caseSpec.locate}` };
    }
    const position = positionOf(sourceFile, located);
    const program = service.program();
    const checker = program.getTypeChecker();
    const node = nodeAtPosition(sourceFile, position, ts);
    const symbol = checker.getSymbolAtLocation(node);
    const referenced = service.languageService.findReferences(caseSpec.file, position);
    const groups = (referenced ?? []).map((group) => ({
      canonicalName: checker.getAliasedSymbol(group.definition.symbol)?.name ?? group.definition.symbol?.name ?? null,
      definition: {
        file: path
          .relative(fixtureRoot, group.definition.node.getSourceFile().fileName)
          .split(path.sep)
          .join("/"),
        start: sourceLineCol(
          group.definition.node.getSourceFile().text,
          group.definition.node.getStart(group.definition.node.getSourceFile()),
        ),
      },
      references: group.references.map((entry) => ({
        file: path.relative(fixtureRoot, entry.fileName).split(path.sep).join("/"),
        start: sourceLineCol(sourceAt(service, path.relative(fixtureRoot, entry.fileName).split(path.sep).join("/")).text, entry.textSpan.start),
        end: sourceLineCol(
          sourceAt(service, path.relative(fixtureRoot, entry.fileName).split(path.sep).join("/")).text,
          entry.textSpan.start + entry.textSpan.length,
        ),
        isWriteAccess: entry.isWriteAccess,
        isDefinition: entry.isDefinition,
      })),
    }));
    return {
      provider: { typescriptVersion: ts.version },
      fixture: caseSpec.file,
      located: { line: located.line, column: located.column, text: located.text },
      flat: groups.flatMap((group) => group.references),
      groups,
    };
  }

  function diagnosticsCase(caseSpec, overlayOverride, optionsOverride) {
    const service = buildService(overlayOverride ?? initialOverlay(), optionsOverride);
    const program = service.program();
    const sourceFile = sourceAt(service, caseSpec.file);
    const semantic = (program.getSemanticDiagnostics(sourceFile) ?? []).map((d) => ({
      ...diagnosticShape(ts, sourceFile, d),
      family: "semantic",
    }));
    const suggestion = (program.getSuggestionDiagnostics(sourceFile) ?? []).map((d) => ({
      ...diagnosticShape(ts, sourceFile, d),
      family: "suggestion",
    }));
    return {
      provider: { typescriptVersion: ts.version },
      fixture: caseSpec.file,
      options: program.getCompilerOptions(),
      semantic,
      suggestion,
    };
  }

  function flowTypeCase(caseSpec, overlayOverride, optionsOverride) {
    const service = buildService(overlayOverride ?? initialOverlay(), optionsOverride);
    const sourceFile = sourceAt(service, caseSpec.file);
    const located = locate(sourceFile.text, caseSpec.locate, caseSpec.occurrence ?? 0);
    if (located === null) {
      return { error: `subject not found: ${caseSpec.locate}` };
    }
    const program = service.program();
    const checker = program.getTypeChecker();
    const position = positionOf(sourceFile, located);
    const node = nodeAtPosition(sourceFile, position, ts);
    const narrowed = checker.getTypeAtLocation(node);
    return {
      provider: { typescriptVersion: ts.version },
      fixture: caseSpec.file,
      located: { line: located.line, column: located.column, text: located.text },
      narrowedType: checker.typeToString(narrowed, undefined, ts.TypeFormatFlags.NoTruncation),
      typeFlags: narrowed.flags,
    };
  }

  function throwStructureCase(caseSpec, overlayOverride, optionsOverride) {
    const service = buildService(overlayOverride ?? initialOverlay(), optionsOverride);
    const sourceFile = sourceAt(service, caseSpec.file);
    const program = service.program();
    const checker = program.getTypeChecker();
    const throws = [];
    const visit = (node) => {
      if (ts.isThrowStatement(node)) {
        const expressionType = node.expression !== undefined
          ? checker.typeToString(checker.getTypeAtLocation(node.expression))
          : null;
        throws.push({
          start: sourceLineCol(sourceFile.text, node.getStart(sourceFile)),
          expressionKind: node.expression ? ts.SyntaxKind[node.expression.kind] : null,
          expressionType,
          enclosing: enclosingTryInfo(node),
        });
      }
      ts.forEachChild(node, visit);
    };
    const enclosingTryInfo = (node) => {
      const chain = [];
      let current = node.parent;
      while (current !== undefined && !ts.isFunctionLike(current)) {
        if (ts.isTryStatement(current)) {
          chain.push({
            tryStart: sourceLineCol(sourceFile.text, current.getStart(sourceFile)),
            hasCatch: current.catchClause !== undefined,
            hasFinally: current.finallyBlock !== undefined,
            directlyInsideTryBlock: current.tryBlock === node.parent?.parent && chain.length === 0,
          });
        }
        current = current.parent;
      }
      return chain;
    };
    visit(sourceFile);
    const neverCalls = [];
    const visitCalls = (node) => {
      if (ts.isCallExpression(node)) {
        const signature = checker.getResolvedSignature(node);
        if (signature !== undefined) {
          const returnType = signature.getReturnType();
          neverCalls.push({
            start: sourceLineCol(sourceFile.text, node.getStart(sourceFile)),
            expression: node.getText(sourceFile),
            returnType: checker.typeToString(returnType),
            isNever: returnType.flags & ts.TypeFlags.Never ? true : false,
          });
        }
      }
      ts.forEachChild(node, visitCalls);
    };
    visitCalls(sourceFile);
    return {
      provider: { typescriptVersion: ts.version },
      fixture: caseSpec.file,
      throws,
      calls: neverCalls,
    };
  }

  function jsDocThrowsCase(caseSpec, overlayOverride, optionsOverride) {
    const service = buildService(overlayOverride ?? initialOverlay(), optionsOverride);
    const sourceFile = sourceAt(service, caseSpec.file);
    const located = locate(sourceFile.text, caseSpec.locate, caseSpec.occurrence ?? 0);
    if (located === null) {
      return { error: `subject not found: ${caseSpec.locate}` };
    }
    const program = service.program();
    const checker = program.getTypeChecker();
    const node = nodeAtPosition(sourceFile, positionOf(sourceFile, located), ts);
    const call = node.parent !== undefined && ts.isCallExpression(node.parent) ? node.parent : node;
    const signature = checker.getResolvedSignature(call);
    const tags = signature !== undefined ? signature.getJsDocTags() : [];
    return {
      provider: { typescriptVersion: ts.version },
      fixture: caseSpec.file,
      tags: tags.map((tag) => ({
        name: tag.name,
        text: (tag.text ?? []).map((part) => part.text).join(""),
      })),
    };
  }

  function moduleUseCase(caseSpec, overlayOverride, optionsOverride) {
    const service = buildService(overlayOverride ?? initialOverlay(), optionsOverride);
    const sourceFile = sourceAt(service, caseSpec.file);
    const program = service.program();
    const checker = program.getTypeChecker();
    const imports = [];
    const visit = (node) => {
      if (ts.isImportDeclaration(node) && node.importClause !== undefined) {
        const resolved = program.getResolvedModuleFromModuleSpecifier?.(node.moduleSpecifier)
          ?? undefined;
        const resolution = program.getModuleResolutionCache?.()?.getResolvedModuleFromModuleSpecifier?.(node.moduleSpecifier);
        const resolvedFile =
          resolved?.resolvedModule?.resolvedFileName ?? resolution?.resolvedModule?.resolvedFileName ?? null;
        const bindings = checker.getSymbolAtLocation(node.moduleSpecifier);
        const namedBindings = node.importClause.namedBindings;
        const elements = namedBindings !== undefined && ts.isNamedImports(namedBindings)
          ? namedBindings.elements
          : [];
        for (const element of elements) {
          const localSymbol = checker.getSymbolAtLocation(element.name);
          const aliasTarget = localSymbol !== undefined ? checker.getAliasedSymbol(localSymbol) : undefined;
          imports.push({
            specifier: node.moduleSpecifier.getText(sourceFile),
            importStart: sourceLineCol(sourceFile.text, node.getStart(sourceFile)),
            exportedName: element.propertyName?.text ?? element.name.text,
            localName: element.name.text,
            resolvedFile:
              resolvedFile !== null
                ? path.relative(fixtureRoot, resolvedFile).split(path.sep).join("/")
                : null,
            moduleSymbolResolved: bindings !== undefined,
            canonicalDeclarations: (aliasTarget?.declarations ?? []).map((decl) => ({
              file: path.relative(fixtureRoot, decl.getSourceFile().fileName).split(path.sep).join("/"),
              start: sourceLineCol(decl.getSourceFile().text, decl.getStart(decl.getSourceFile())),
              kind: ts.SyntaxKind[decl.kind],
            })),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return {
      provider: { typescriptVersion: ts.version },
      fixture: caseSpec.file,
      imports,
    };
  }

  function programFilesCase(caseSpec, overlayOverride, optionsOverride) {
    const service = buildService(overlayOverride ?? initialOverlay(), optionsOverride);
    const program = service.program();
    const roots = program.getRootFileNames().map((name) =>
      path.relative(fixtureRoot, name).split(path.sep).join("/"),
    );
    return {
      provider: { typescriptVersion: ts.version },
      fixture: caseSpec.file ?? "tsconfig.json",
      rootFiles: roots.sort(),
    };
  }

  function captureIdentityCase(caseSpec, overlayOverride, optionsOverride) {
    const entries = overlayOverride ?? initialOverlay();
    const service = buildService(entries, optionsOverride);
    const program = service.program();
    const identity = new Map();
    for (const fileName of program.getSourceFiles().map((f) => f.fileName)) {
      const relative = path.relative(fixtureRoot, fileName);
      if (relative.startsWith("..")) {
        continue;
      }
      const key = relative.split(path.sep).join("/");
      const text = service.files.get(key) ?? fs.readFileSync(fileName, "utf8");
      identity.set(key, sha256(Buffer.from(text, "utf8")));
    }
    const resolvedMissing = [];
    for (const relative of caseSpec.probeImports ?? []) {
      const sourceFile = program.getSourceFile(path.resolve(fixtureRoot, relative));
      const text = sourceFile?.text ?? service.files.get(relative) ?? "";
      const missing = /import\s[^"']*["'](\.\/[^"']+)["']/.exec(text);
      if (missing !== null) {
        const target = path.resolve(fixtureRoot, relative, "..", missing[1]);
        const candidates = [`${target}.ts`, `${target}.js`, `${target}.d.ts`, path.join(target, "index.ts")];
        const found = candidates.some((candidate) =>
          program.getSourceFile(candidate) !== undefined || service.files.has(path.relative(fixtureRoot, candidate).split(path.sep).join("/")),
        );
        if (!found) {
          resolvedMissing.push({
            importingFile: relative,
            specifier: missing[1],
          });
        }
      }
    }
    return {
      provider: { typescriptVersion: ts.version },
      snapshotId: snapshotId(digestOverlay(service.files)),
      identityFiles: Object.fromEntries(identity),
      unresolvedImports: resolvedMissing,
    };
  }

  function readFixtureText(relativePath) {
    const entry = initialOverlay().get(relativePath);
    if (entry !== undefined) {
      return entry;
    }
    return fs.readFileSync(path.resolve(fixtureRoot, relativePath), "utf8");
  }

  return {
    ts,
    typescriptPath,
    typescriptVersion: ts.version,
    fixtureRoot,
    parsedConfig,
    initialOverlay,
    buildService,
    readFixtureText,
    extractors: {
      symbolAt: symbolAtCase,
      references: referencesCase,
      diagnostics: diagnosticsCase,
      flowType: flowTypeCase,
      throwStructure: throwStructureCase,
      jsDocThrows: jsDocThrowsCase,
      moduleUse: moduleUseCase,
      programFiles: programFilesCase,
      captureIdentity: captureIdentityCase,
    },
  };
}
