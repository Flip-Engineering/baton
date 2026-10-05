// Package-isolation language-service probe.
//
// The harness stages this file inside an isolated copy of the staged package,
// substitutes __TYPESCRIPT_ENTRY__ with the package-relative specifier of the
// bundled TypeScript, and runs it under the pinned Node. The same source text
// is first type-checked by the bundled TypeScript against the bundled public
// declarations with ambient types disabled: any use of a runtime-only or
// undeclared member fails the type-check gate before this file runs. Host
// inputs arrive through explicit ambient declarations, so the probe pulls in
// no ancestor node_modules and no development paths.
import ts from "__TYPESCRIPT_ENTRY__";

// Explicit host surface (the only ambient declarations in this program).
declare const process: { version: string; exitCode: number };
declare const console: { log: (message: string) => void };
declare const probeInputs: {
  dtsText: string;
  probeSource: string;
  probeFilePath: string;
  dtsFilePath: string;
  fixtureTexts: Record<string, string>;
  libTexts: Record<string, string>;
  libDirPath: string;
};

function hostText(path: string): string | undefined {
  if (path === probeInputs.probeFilePath) {
    return probeInputs.probeSource;
  }
  if (path === probeInputs.dtsFilePath) {
    return probeInputs.dtsText;
  }
  return probeInputs.fixtureTexts[path] ?? probeInputs.libTexts[path];
}

interface GateState {
  typescriptVersion: string;
  nodeVersion: string;
  gates: Record<string, boolean>;
  details: Record<string, unknown>;
  errors: string[];
}

const state: GateState = {
  typescriptVersion: ts.version,
  nodeVersion: process.version,
  gates: {},
  details: {},
  errors: [],
};

function fail(gate: string, detail: string): void {
  state.gates[gate] = false;
  state.errors.push(`${gate}: ${detail}`);
}

function pass(gate: string, detail?: unknown): void {
  if (state.gates[gate] !== false) {
    state.gates[gate] = true;
  }
  if (detail !== undefined) {
    state.details[gate] = detail;
  }
}

// --- Gate: bundled TypeScript reports the pinned version. ---
if (ts.version !== "5.9.3") {
  fail("pinnedVersion", `bundled ts.version is ${ts.version}, expected 5.9.3`);
} else {
  pass("pinnedVersion", ts.version);
}

// --- Publicity scan of the bundled declarations. ---
const requiredPublicMembers = [
  "createProgram",
  "createLanguageService",
  "transpileModule",
  "createSourceFile",
  "getSymbolAtLocation",
  "getAliasedSymbol",
  "getTypeAtLocation",
  "getApparentType",
  "getDeclaredTypeOfSymbol",
  "getTypeOfSymbolAtLocation",
  "typeToString",
  "findReferences",
  "getReferencesAtPosition",
  "prepareCallHierarchy",
  "provideCallHierarchyIncomingCalls",
  "provideCallHierarchyOutgoingCalls",
  "getDefinitionAtPosition",
  "getTypeDefinitionAtPosition",
  "getImplementationAtPosition",
  "getSemanticDiagnostics",
];

const runtimeOnlyNames = [
  "getTokenAtPosition",
  "FindAllReferences",
  "SymbolDisplay",
  "getLineStarts",
  "FlowNode",
  "FlowFlags",
  "getFlowTypeOfReference",
  "canHaveFlowNode",
  "createFlowNode",
];

const dtsFile: ts.SourceFile = ts.createSourceFile(
  probeInputs.dtsFilePath,
  probeInputs.dtsText,
  ts.ScriptTarget.ES2022,
  /*setParentNodes*/ true,
);

const topLevelNames = new Set<string>();
const containerMemberNames = new Map<string, Set<string>>();

function noteDeclarationName(name: string, container: string | undefined): void {
  topLevelNames.add(name);
  if (container !== undefined) {
    const existing = containerMemberNames.get(container);
    if (existing === undefined) {
      containerMemberNames.set(container, new Set<string>([name]));
    } else {
      existing.add(name);
    }
  }
}

function scanNode(node: ts.Node, container: string | undefined): void {
  if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node) || ts.isModuleDeclaration(node)) {
    if (node.name !== undefined) {
      const name = node.name.text;
      noteDeclarationName(name, container);
      const childContainer = ts.isModuleDeclaration(node) ? name : container;
      ts.forEachChild(node, (child) => scanNode(child, childContainer));
      return;
    }
  }
  if (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) || ts.isMethodDeclaration(node) || ts.isPropertySignature(node) || ts.isMethodSignature(node)) {
    if (node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) {
      noteDeclarationName(node.name.text, container);
    }
  }
  ts.forEachChild(node, (child) => scanNode(child, container));
}
ts.forEachChild(dtsFile, (child) => scanNode(child, undefined));

const missingPublic: string[] = [];
for (const name of requiredPublicMembers) {
  if (!topLevelNames.has(name)) {
    missingPublic.push(name);
  }
}
const checkerServiceMembers = containerMemberNames.get("TypeChecker");
const languageServiceMembers = containerMemberNames.get("LanguageService");
if (checkerServiceMembers === undefined || languageServiceMembers === undefined) {
  fail("publicDtsApi", "TypeChecker or LanguageService container not found in bundled declarations");
} else {
  for (const name of ["getSymbolAtLocation", "getTypeAtLocation", "getTypeOfSymbolAtLocation", "typeToString"]) {
    if (!checkerServiceMembers.has(name)) {
      missingPublic.push(`TypeChecker.${name}`);
    }
  }
  for (const name of ["findReferences", "prepareCallHierarchy", "provideCallHierarchyIncomingCalls", "getDefinitionAtPosition", "getSemanticDiagnostics"]) {
    if (!languageServiceMembers.has(name)) {
      missingPublic.push(`LanguageService.${name}`);
    }
  }
}
if (missingPublic.length > 0) {
  fail("publicDtsApi", `required public names absent from bundled d.ts: ${missingPublic.join(", ")}`);
} else {
  pass("publicDtsApi", `${requiredPublicMembers.length} required public names declared`);
}

const leakedRuntimeOnly: string[] = [];
for (const name of runtimeOnlyNames) {
  if (topLevelNames.has(name) || (checkerServiceMembers !== undefined && checkerServiceMembers.has(name)) || (languageServiceMembers !== undefined && languageServiceMembers.has(name))) {
    leakedRuntimeOnly.push(name);
  }
}
if (leakedRuntimeOnly.length > 0) {
  fail("runtimeOnlyAbsent", `runtime-only names present in bundled d.ts: ${leakedRuntimeOnly.join(", ")}`);
} else {
  pass("runtimeOnlyAbsent", `${runtimeOnlyNames.length} runtime-only names absent from bundled d.ts`);
}

// --- Type-check gate: this probe source against the bundled declarations only. ---
const typeCheckOptions: ts.CompilerOptions = {
  noEmit: true,
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.Node16,
  moduleResolution: ts.ModuleResolutionKind.Node16,
  esModuleInterop: true,
  types: [],
  lib: ["es2022"],
};

function serveText(path: string): string | undefined {
  return hostText(path);
}

const typeCheckHost: ts.CompilerHost = {
  getSourceFile: (fileName, languageVersionOrOptions) => {
    const text = serveText(fileName);
    if (text === undefined) {
      return undefined;
    }
    return ts.createSourceFile(fileName, text, languageVersionOrOptions, true);
  },
  getDefaultLibFileName: () => `${probeInputs.libDirPath}/lib.es2022.d.ts`,
  writeFile: () => undefined,
  getCurrentDirectory: () => "/",
  getDirectories: () => [],
  fileExists: (fileName) => serveText(fileName) !== undefined,
  readFile: (fileName) => serveText(fileName),
  getCanonicalFileName: (fileName) => fileName,
  useCaseSensitiveFileNames: () => true,
  getNewLine: () => "\n",
};
const typeCheckProgram = ts.createProgram(
  [probeInputs.probeFilePath, probeInputs.dtsFilePath],
  typeCheckOptions,
  typeCheckHost,
);
try {
  const typeCheckDiagnostics = ts.getPreEmitDiagnostics(typeCheckProgram);
  if (typeCheckDiagnostics.length > 0) {
    const rendered = typeCheckDiagnostics.map((diagnostic) => {
      const flattened = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      const where = diagnostic.file === undefined ? "" : ` at ${diagnostic.file.fileName}:${diagnostic.start ?? -1}`;
      return `TS${diagnostic.code}${where}: ${flattened}`;
    });
    fail("publicApiTypeCheck", `${typeCheckDiagnostics.length} diagnostics in probe source: ${rendered.slice(0, 8).join(" | ")}`);
  } else {
    pass("publicApiTypeCheck", "probe source clean against bundled declarations with types:[]");
  }
} catch (error) {
  fail("publicApiTypeCheck", `bundled checker raised internally: ${String(error)}`);
}

// --- Fixture program: ambient isolation and clean diagnostics. ---
const consumerPath = Object.keys(probeInputs.fixtureTexts).find((key) => key.endsWith("consumer.ts")) ?? "";
const modelsPath = Object.keys(probeInputs.fixtureTexts).find((key) => key.endsWith("models.ts")) ?? "";
const brokenPath = Object.keys(probeInputs.fixtureTexts).find((key) => key.endsWith("broken.ts")) ?? "";
if (consumerPath === "" || modelsPath === "" || brokenPath === "") {
  fail("fixtureStaged", "fixture files missing from staged inputs");
}

const fixtureOptions: ts.CompilerOptions = {
  noEmit: true,
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  types: [],
  lib: ["es2022"],
};

function fixtureSnapshot(fileName: string): ts.IScriptSnapshot {
  const text = hostText(fileName);
  if (text === undefined) {
    return ts.ScriptSnapshot.fromString("");
  }
  return ts.ScriptSnapshot.fromString(text);
}

const fixtureHost: ts.LanguageServiceHost = {
  getScriptFileNames: () => Object.keys(probeInputs.fixtureTexts),
  getScriptVersion: () => "0",
  getScriptSnapshot: (fileName) => fixtureSnapshot(fileName),
  getCurrentDirectory: () => "/",
  getCompilationSettings: () => fixtureOptions,
  getDefaultLibFileName: (options) => `${probeInputs.libDirPath}/${ts.getDefaultLibFileName(options)}`,
  readFile: (fileName) => hostText(fileName),
  fileExists: (fileName) => hostText(fileName) !== undefined,
};

let ambientIsolationClean = true;
let ambientLeakSample = "";
if (consumerPath !== "") {
  try {
    const fixtureProgram = ts.createProgram(Object.keys(probeInputs.fixtureTexts), fixtureOptions, {
      getSourceFile: (fileName, languageVersionOrOptions) => {
        const text = hostText(fileName);
        if (text === undefined) {
          return undefined;
        }
        return ts.createSourceFile(fileName, text, languageVersionOrOptions, true);
      },
      getDefaultLibFileName: (options) => `${probeInputs.libDirPath}/${ts.getDefaultLibFileName(options)}`,
      writeFile: () => undefined,
      getCurrentDirectory: () => "/",
      getDirectories: () => [],
      fileExists: (fileName) => hostText(fileName) !== undefined,
      readFile: (fileName) => hostText(fileName),
      getCanonicalFileName: (fileName) => fileName,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => "\n",
    });
    for (const source of fixtureProgram.getSourceFiles()) {
      if (source.fileName.includes("node_modules")) {
        ambientIsolationClean = false;
        ambientLeakSample = source.fileName;
      }
    }
    if (ambientIsolationClean) {
      pass("ambientIsolation", `${fixtureProgram.getSourceFiles().length} program files, none from node_modules`);
    } else {
      fail("ambientIsolation", `program pulled ambient input from ${ambientLeakSample}`);
    }

    const cleanSemantic: string[] = [];
    for (const fileName of Object.keys(probeInputs.fixtureTexts)) {
      if (fileName === brokenPath) {
        continue;
      }
      const programFile = fixtureProgram.getSourceFile(fileName);
      if (programFile === undefined) {
        cleanSemantic.push(`program omitted ${fileName}`);
        continue;
      }
      for (const diagnostic of fixtureProgram.getSemanticDiagnostics(programFile)) {
        cleanSemantic.push(`TS${diagnostic.code} in ${fileName}`);
      }
    }
    if (cleanSemantic.length > 0) {
      fail("cleanFixtureDiagnostics", `clean fixture reported: ${cleanSemantic.join(", ")}`);
    } else {
      pass("cleanFixtureDiagnostics", "clean fixture zero semantic diagnostics");
    }
  } catch (error) {
    fail("ambientIsolation", `fixture program raised internally: ${String(error)}`);
  }
}

// --- Language service useful results on the staged fixture. ---
try {
  runLanguageServiceGates();
} catch (error) {
  fail("languageServiceGates", `language service raised internally: ${String(error)}`);
}

function runLanguageServiceGates(): void {
    const languageService = ts.createLanguageService(fixtureHost, ts.createDocumentRegistry());

  const consumerText = probeInputs.fixtureTexts[consumerPath] ?? "";
  const modelsText = probeInputs.fixtureTexts[modelsPath] ?? "";

  function markerIndex(text: string, marker: string): number {
    const found = text.indexOf(marker);
    if (found < 0) {
      fail("fixtureMarkers", `marker not found: ${marker}`);
      return -1;
    }
    return found;
  }

  const newGreeterUse = consumerText.indexOf("new G()");
  const loadDeclarationMarker = "    load(query: string) {";
  const loadDeclarationPos = markerIndex(consumerText, loadDeclarationMarker) + loadDeclarationMarker.indexOf("load");
  const quotedAccessMarker = 'disk["load"]';
  const quotedAccessPos = markerIndex(consumerText, quotedAccessMarker);
  const anySavePos = markerIndex(consumerText, 'untypedDisk.save("jsonAny")');
  const anyComputedMarker = "untypedDisk[computedKey](";
  const anyComputedPos = markerIndex(consumerText, anyComputedMarker);
  const greetInterfaceMarker = "greet(name: string): string;";
  const greetInterfacePos = markerIndex(modelsText, greetInterfaceMarker) + greetInterfaceMarker.indexOf("greet");

  if (newGreeterUse >= 0) {
    const definitions = languageService.getDefinitionAtPosition(consumerPath, newGreeterUse + "new ".length) ?? [];
    const original = definitions.find((definition) => definition.fileName.endsWith("models.ts"));
    if (original === undefined) {
      fail("definitionThroughBarrel", `alias use resolved ${definitions.length} definitions, none in models.ts`);
    } else {
      pass("definitionThroughBarrel", `alias use resolved to ${original.fileName}`);
    }
  }

  if (loadDeclarationPos > 0 && quotedAccessPos >= 0) {
    const referenced = languageService.findReferences(consumerPath, loadDeclarationPos) ?? [];
    const spans: { fileName: string; text: string; start: number }[] = [];
    for (const group of referenced) {
      for (const entry of group.entries) {
        const entryText = (probeInputs.fixtureTexts[entry.fileName] ?? "").slice(entry.textSpan.start, entry.textSpan.start + entry.textSpan.length);
        spans.push({ fileName: entry.fileName, text: entryText, start: entry.textSpan.start });
      }
    }
    const quotedContentStart = quotedAccessPos + 'disk["'.length;
    const quotedPresent = spans.some((span) => span.fileName === consumerPath && span.text === "load" && span.start === quotedContentStart);
    if (!quotedPresent) {
      fail("quotedAccessPresent", "quoted string-literal access span missing from Disk.load reference groups");
    } else {
      pass("quotedAccessPresent", "quoted access indexed as an ordinary reference entry");
    }
    const anySaveEnd = anySavePos + "untypedDisk".length;
    const anyComputedEnd = anyComputedPos + "untypedDisk[computedKey]".length;
    const blindSpotsHeld = spans.every((span) => {
      if (span.fileName !== consumerPath) {
        return true;
      }
      const overlapsAnySave = span.start < anySaveEnd && span.start + span.text.length > anySavePos;
      const overlapsAnyComputed = span.start < anyComputedEnd && span.start + span.text.length > anyComputedPos;
      return !overlapsAnySave && !overlapsAnyComputed;
    });
    if (!blindSpotsHeld) {
      fail("anyReceiverBlindSpots", "any-typed receiver produced a reference edge (measured blind spot violated)");
    } else {
      pass("anyReceiverBlindSpots", "no reference edges from any-typed receiver sites");
    }
  }

  if (greetInterfacePos > 0) {
    const prepared = languageService.prepareCallHierarchy(modelsPath, greetInterfacePos);
    if (prepared.length === 0) {
      fail("callHierarchyIncoming", "prepareCallHierarchy returned no items for Greeter.greet");
    } else {
      const incoming = languageService.provideCallHierarchyIncomingCalls(modelsPath, greetInterfacePos) ?? [];
      if (incoming.length === 0) {
        fail("callHierarchyIncoming", "incoming calls empty for Greeter.greet");
      } else {
        pass("callHierarchyIncoming", `${incoming.length} incoming call group(s) through Greeter receiver`);
      }
    }
  }

    if (brokenPath !== "") {
      const brokenDiagnostics = languageService.getSemanticDiagnostics(brokenPath);
      const definiteAssignment = brokenDiagnostics.filter((diagnostic) => diagnostic.code === 2454);
      if (definiteAssignment.length === 0) {
        fail("brokenVariantDiagnostic", "mutation-control variant produced no TS2454 definite-assignment diagnostic");
      } else {
        pass("brokenVariantDiagnostic", "mutation-control variant reports TS2454");
      }
    }
}

const emitted = ts.transpileModule("const pinned: number = 593;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
if (!emitted.outputText.includes("593")) {
  fail("transpileEmit", "bundled compiler produced no emit output");
} else {
  pass("transpileEmit", "bundled compiler emitted real output");
}

console.log(JSON.stringify(state));
if (Object.values(state.gates).some((passed) => passed === false)) {
  process.exitCode = 1;
}
