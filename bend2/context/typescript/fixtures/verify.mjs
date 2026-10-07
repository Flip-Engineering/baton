// Fixture verifier + manifest generator for the typescript semantic-context lane.
//
// Run from the repository worktree root:
//   node bend2/context/typescript/fixtures/verify.mjs
//
// It type-checks every fixture project with the pinned TypeScript, resolves every
// manifest position through the TypeScript AST/checker (never by hand), and writes
// manifest.json and verification.txt next to this file.

import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..", "..");
const FIXTURES_REL = toPosix(path.relative(REPO_ROOT, here));

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function relPath(absolute) {
  const rel = toPosix(path.relative(REPO_ROOT, absolute));
  return rel.startsWith("..") ? toPosix(absolute) : rel;
}

// Some SyntaxKind values have alias names; prefer the descriptive one (same numeric kind).
function kindNameFor(kind) {
  const name = ts.SyntaxKind[kind];
  if (!/^(First|Last)/.test(name)) return name;
  const alternates = Object.keys(ts.SyntaxKind).filter((key) => typeof ts.SyntaxKind[key] === "number" && ts.SyntaxKind[key] === kind);
  return alternates.find((key) => !/^(First|Last)/.test(key)) ?? name;
}

function findTypeScriptModule() {
  const candidates = [process.env.BATON2_CONTEXT_TYPESCRIPT, path.join(here, "node_modules/typescript/lib/typescript.js")];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  try {
    return createRequire(import.meta.url).resolve("typescript");
  } catch {
    /* fall through */
  }
  throw new Error("typescript not resolvable; set BATON2_CONTEXT_TYPESCRIPT to lib/typescript.js");
}

const TS_MODULE = findTypeScriptModule();
const ts = createRequire(import.meta.url)(TS_MODULE);

const PROJECTS = [
  { id: "ts-project", root: "ts-project", config: "tsconfig.json" },
  { id: "ts-project-unreachable", root: "ts-project", config: "tsconfig.unreachable.json" },
  { id: "js-project", root: "js-project", config: "jsconfig.json" },
  { id: "states-a", root: "states/a", config: "tsconfig.json" },
  { id: "states-b", root: "states/b", config: "tsconfig.json" },
];

const loaded = new Map();
const projectDiagLines = new Map();

function loadProject(project) {
  if (loaded.has(project.id)) return loaded.get(project.id);
  const dir = path.join(here, project.root);
  const configPath = path.join(dir, project.config);
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const configErrors = read.error ? [read.error] : [];
  const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, ts.sys, dir, {}, configPath);
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    configFileParsingDiagnostics: parsed.errors,
  });
  const entry = { project, dir, configPath, parsed, program, checker: program.getTypeChecker(), sourceFiles: new Map() };
  for (const sf of program.getSourceFiles()) {
    if (!sf.fileName.startsWith(dir + path.sep)) continue;
    entry.sourceFiles.set(toPosix(path.relative(dir, sf.fileName)), sf);
  }
  loaded.set(project.id, entry);
  return entry;
}

// ---------------------------------------------------------------- diagnostics

function sortDiagnostics(list) {
  return list.slice().sort((a, b) => (a.file === b.file ? a.line - b.line || a.column - b.column || a.code - b.code : a.file < b.file ? -1 : 1));
}

function collectDiagnostics(project) {
  const { program, parsed, dir, sourceFiles } = loadProject(project);
  const entries = [];
  const seen = new Set();

  const push = (diagnostic, family, fallbackFile) => {
    const file = diagnostic.file ? toPosix(path.relative(REPO_ROOT, diagnostic.file.fileName)) : fallbackFile;
    let line = 0;
    let column = 0;
    if (diagnostic.file && typeof diagnostic.start === "number") {
      const pos = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      line = pos.line;
      column = pos.character;
    }
    const key = `${file}:${line}:${column}:${diagnostic.code}:${family}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({
      file,
      line,
      column,
      code: diagnostic.code,
      family,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    });
  };

  const configRel = toPosix(path.relative(REPO_ROOT, path.join(dir, project.config)));
  for (const diagnostic of parsed.errors) push(diagnostic, "semantic", configRel);
  for (const diagnostic of program.getOptionsDiagnostics()) push(diagnostic, "semantic", configRel);
  for (const diagnostic of program.getGlobalDiagnostics()) push(diagnostic, "semantic", configRel);
  for (const [rel, sf] of sourceFiles) {
    for (const diagnostic of program.getSyntacticDiagnostics(sf)) push(diagnostic, "semantic");
    for (const diagnostic of program.getSemanticDiagnostics(sf)) push(diagnostic, "semantic");
    for (const diagnostic of program.getSuggestionDiagnostics(sf)) push(diagnostic, "suggestion");
  }
  return sortDiagnostics(entries);
}

// ----------------------------------------------------------------- selectors

const KIND = (name) => {
  const value = ts.SyntaxKind[name];
  if (typeof value !== "number") throw new Error(`unknown SyntaxKind: ${name}`);
  return value;
};

function contains(node, predicate, out) {
  if (predicate(node)) out.push(node);
  ts.forEachChild(node, (child) => contains(child, predicate, out));
}

function matches(sf, node, spec) {
  if (node.kind !== KIND(spec.kind)) return false;
  if (spec.calleeText !== undefined) {
    return ts.isCallExpression(node) && node.expression.getText(sf) === spec.calleeText;
  }
  if (spec.text !== undefined) {
    if (ts.isCallExpression(node)) return node.expression.getText(sf) === spec.text;
    if (ts.isStringLiteralLike(node)) return node.text === spec.text;
    return node.getText(sf) === spec.text;
  }
  if (spec.name !== undefined) {
    const nameNode = node.name;
    return Boolean(nameNode) && nameNode.getText(sf) === spec.name;
  }
  return true;
}

function resolveNode(sf, spec, containerNode) {
  if (spec.kind === "__jsdocTag") {
    if (!containerNode) throw new Error("__jsdocTag requires a container");
    const tags = ts.getJSDocTags(containerNode).filter((tag) => tag.tagName.getText(sf) === spec.tagName);
    const tag = tags[spec.occ ?? 0];
    if (!tag) throw new Error(`no @${spec.tagName} jsdoc tag [${spec.occ ?? 0}] in ${sf.fileName}`);
    return tag;
  }
  const found = [];
  contains(containerNode ?? sf, (node) => matches(sf, node, spec), found);
  const node = found[spec.occ ?? 0];
  if (!node) throw new Error(`selector ${JSON.stringify(spec)} matched ${found.length} node(s) in ${sf.fileName}`);
  return node;
}

function resolveSpec(sf, spec) {
  const containerNode = spec.container ? resolveSpec(sf, spec.container) : undefined;
  let node = resolveNode(sf, spec, containerNode);
  if (spec.prop) {
    for (const key of spec.prop.split(".")) {
      node = node[key];
      if (!node) throw new Error(`selector prop ${spec.prop} missing on ${sf.fileName}`);
    }
  }
  return node;
}

function positionOf(sf, node) {
  const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return { line: pos.line, column: pos.character };
}

function nameOf(sf, node) {
  if (node.tagName && node.tagName.getText) return `@${node.tagName.getText(sf)}`;
  if (node.kind === KIND("Identifier") || ts.isStringLiteralLike(node)) return node.text;
  if (ts.isCallExpression(node)) return node.expression.getText(sf);
  if (node.name && node.name.getText) return node.name.getText(sf);
  const token = node.getFirstToken(sf);
  if (token) return token.getText(sf);
  return ts.SyntaxKind[node.kind];
}

function describeDeclaration(checker, node) {
  const decl = node.getSourceFile();
  const { line, column } = positionOf(decl, node);
  const rel = relPath(decl.fileName);
  const owner = node.name && node.name.getText ? node.name.getText(decl) : ts.SyntaxKind[node.kind];
  return `${owner} @ ${rel}:${line}:${column}`;
}

function symbolAt(checker, node) {
  return checker.getSymbolAtLocation(node.name ?? node);
}

function countNodes(root, kindName) {
  const found = [];
  contains(root, (node) => node.kind === KIND(kindName), found);
  return found.length;
}

function callTargetNote(checker, call) {
  const signature = checker.getResolvedSignature(call);
  const declaration = signature?.declaration;
  if (!declaration) return "checker.getResolvedSignature -> no declaration (unresolved/any callee)";
  return `checker.getResolvedSignature -> ${describeDeclaration(checker, declaration)}`;
}

// ------------------------------------------------------------------- symbols

const TS_PROJECT = "ts-project";
const JS_PROJECT = "js-project";

const SYMBOLS = [
  // ts-project / src/models.ts
  { id: "ts-project.models.Greeter", project: TS_PROJECT, file: "src/models.ts", spec: { kind: "Identifier", text: "Greeter", occ: 0 }, note: "interface Greeter declaration name" },
  { id: "ts-project.models.Greeter.greet", project: TS_PROJECT, file: "src/models.ts", spec: { kind: "MethodSignature", name: "greet", occ: 0 }, note: "greet method signature in interface Greeter" },
  {
    id: "ts-project.models.Greeter.greet.param.name",
    project: TS_PROJECT,
    file: "src/models.ts",
    spec: { kind: "Parameter", name: "name", occ: 0, container: { kind: "MethodSignature", name: "greet", occ: 0 } },
    note: "name parameter of the declared greet method",
  },
  { id: "ts-project.models.FormalGreeter", project: TS_PROJECT, file: "src/models.ts", spec: { kind: "ClassDeclaration", name: "FormalGreeter" }, note: "class FormalGreeter declaration name" },
  {
    id: "ts-project.models.FormalGreeter.greet",
    project: TS_PROJECT,
    file: "src/models.ts",
    spec: { kind: "MethodDeclaration", name: "greet", occ: 0 },
    note: "greet implementation in class FormalGreeter",
    inspect: ({ node }) => `call expressions in body: ${countNodes(node, "CallExpression")}`,
  },
  { id: "ts-project.models.Kind", project: TS_PROJECT, file: "src/models.ts", spec: { kind: "TypeAliasDeclaration", name: "Kind" }, note: "type alias Kind declaration name" },
  { id: "ts-project.models.Kind.circle", project: TS_PROJECT, file: "src/models.ts", spec: { kind: "StringLiteral", text: "circle", occ: 0 }, note: "string literal type member \"circle\" of Kind" },
  {
    id: "ts-project.models.DEFAULT_NAME",
    project: TS_PROJECT,
    file: "src/models.ts",
    spec: { kind: "VariableDeclaration", name: "DEFAULT_NAME" },
    note: "const DEFAULT_NAME declaration name",
    inspect: ({ checker, node }) => `type ${checker.typeToString(checker.getTypeAtLocation(node))}`,
  },

  // ts-project / src/util.ts
  { id: "ts-project.util.specifier.models", project: TS_PROJECT, file: "src/util.ts", spec: { kind: "StringLiteral", text: "./models", occ: 0 }, note: "import module specifier \"./models\"" },
  { id: "ts-project.util.import.Greeter", project: TS_PROJECT, file: "src/util.ts", spec: { kind: "Identifier", text: "Greeter", occ: 0 }, note: "import binding Greeter specifier" },
  { id: "ts-project.util.makeMessage", project: TS_PROJECT, file: "src/util.ts", spec: { kind: "FunctionDeclaration", name: "makeMessage" }, note: "exported function makeMessage declaration name" },
  {
    id: "ts-project.util.makeMessage.param.g",
    project: TS_PROJECT,
    file: "src/util.ts",
    spec: { kind: "Parameter", name: "g", occ: 0 },
    note: "g parameter of makeMessage (typed by imported interface Greeter)",
    inspect: ({ checker, node }) => `type ${checker.typeToString(checker.getTypeAtLocation(node))}`,
  },
  {
    id: "ts-project.util.makeMessage.call.greet",
    project: TS_PROJECT,
    file: "src/util.ts",
    spec: { kind: "CallExpression", calleeText: "g.greet", occ: 0 },
    note: "call token g.greet inside makeMessage body",
    inspect: ({ checker, node }) => callTargetNote(checker, node),
  },
  { id: "ts-project.util.makeMessage.call.greet.receiver", project: TS_PROJECT, file: "src/util.ts", spec: { kind: "Identifier", text: "g", occ: 1 }, note: "receiver g of the greet call (parameter binding)" },

  // ts-project / src/impl.ts
  { id: "ts-project.impl.import.DEFAULT_NAME", project: TS_PROJECT, file: "src/impl.ts", spec: { kind: "Identifier", text: "DEFAULT_NAME", occ: 0 }, note: "import binding DEFAULT_NAME specifier" },
  { id: "ts-project.impl.import.Greeter", project: TS_PROJECT, file: "src/impl.ts", spec: { kind: "Identifier", text: "Greeter", occ: 0 }, note: "import binding Greeter specifier" },
  { id: "ts-project.impl.GreeterImpl", project: TS_PROJECT, file: "src/impl.ts", spec: { kind: "ClassDeclaration", name: "GreeterImpl" }, note: "class GreeterImpl declaration name" },
  { id: "ts-project.impl.GreeterImpl.greet", project: TS_PROJECT, file: "src/impl.ts", spec: { kind: "MethodDeclaration", name: "greet", occ: 0 }, note: "greet implementation in class GreeterImpl (body has no outgoing call)" },
  {
    id: "ts-project.impl.GreeterImpl.greet.read.DEFAULT_NAME",
    project: TS_PROJECT,
    file: "src/impl.ts",
    spec: { kind: "Identifier", text: "DEFAULT_NAME", occ: 1 },
    note: "read of imported DEFAULT_NAME inside greet",
    inspect: ({ checker, node }) => `resolved symbol ${checker.getSymbolAtLocation(node)?.name ?? "?"}`,
  },

  // ts-project / src/index.ts
  { id: "ts-project.index.reexport.FormalGreeter", project: TS_PROJECT, file: "src/index.ts", spec: { kind: "Identifier", text: "FormalGreeter", occ: 0 }, note: "barrel re-export specifier FormalGreeter" },
  { id: "ts-project.index.reexport.Greeter", project: TS_PROJECT, file: "src/index.ts", spec: { kind: "Identifier", text: "Greeter", occ: 0 }, note: "barrel type-only re-export specifier Greeter" },
  { id: "ts-project.index.reexport.GreeterImpl", project: TS_PROJECT, file: "src/index.ts", spec: { kind: "Identifier", text: "GreeterImpl", occ: 0 }, note: "barrel re-export specifier GreeterImpl" },
  { id: "ts-project.index.reexport.makeMessage", project: TS_PROJECT, file: "src/index.ts", spec: { kind: "Identifier", text: "makeMessage", occ: 0 }, note: "barrel re-export specifier makeMessage" },
  { id: "ts-project.index.specifier.models.1", project: TS_PROJECT, file: "src/index.ts", spec: { kind: "StringLiteral", text: "./models", occ: 0 }, note: "barrel module specifier \"./models\" (value re-export)" },
  { id: "ts-project.index.specifier.models.2", project: TS_PROJECT, file: "src/index.ts", spec: { kind: "StringLiteral", text: "./models", occ: 1 }, note: "barrel module specifier \"./models\" (type re-export)" },
  { id: "ts-project.index.specifier.impl", project: TS_PROJECT, file: "src/index.ts", spec: { kind: "StringLiteral", text: "./impl", occ: 0 }, note: "barrel module specifier \"./impl\"" },
  { id: "ts-project.index.specifier.util", project: TS_PROJECT, file: "src/index.ts", spec: { kind: "StringLiteral", text: "./util", occ: 0 }, note: "barrel module specifier \"./util\"" },

  // ts-project / src/consumer.ts
  { id: "ts-project.consumer.import.FormalGreeter", project: TS_PROJECT, file: "src/consumer.ts", spec: { kind: "Identifier", text: "FormalGreeter", occ: 0 }, note: "import specifier FormalGreeter from the barrel" },
  { id: "ts-project.consumer.import.makeMessage", project: TS_PROJECT, file: "src/consumer.ts", spec: { kind: "Identifier", text: "makeMessage", occ: 0 }, note: "import specifier makeMessage from the barrel" },
  { id: "ts-project.consumer.import.alias.Impl", project: TS_PROJECT, file: "src/consumer.ts", spec: { kind: "Identifier", text: "Impl", occ: 0 }, note: "aliased import binding (GreeterImpl as Impl)" },
  { id: "ts-project.consumer.specifier.index", project: TS_PROJECT, file: "src/consumer.ts", spec: { kind: "StringLiteral", text: "./index", occ: 0 }, note: "import module specifier \"./index\" (barrel)" },
  { id: "ts-project.consumer.run", project: TS_PROJECT, file: "src/consumer.ts", spec: { kind: "FunctionDeclaration", name: "run" }, note: "exported function run declaration name" },
  { id: "ts-project.consumer.run.call.makeMessage.1", project: TS_PROJECT, file: "src/consumer.ts", spec: { kind: "CallExpression", calleeText: "makeMessage", occ: 0 }, note: "first makeMessage call site in run", inspect: ({ checker, node }) => callTargetNote(checker, node) },
  { id: "ts-project.consumer.run.call.makeMessage.2", project: TS_PROJECT, file: "src/consumer.ts", spec: { kind: "CallExpression", calleeText: "makeMessage", occ: 1 }, note: "second makeMessage call site in run", inspect: ({ checker, node }) => callTargetNote(checker, node) },
  { id: "ts-project.consumer.run.call.makeMessage.3", project: TS_PROJECT, file: "src/consumer.ts", spec: { kind: "CallExpression", calleeText: "makeMessage", occ: 2 }, note: "third makeMessage call site in run", inspect: ({ checker, node }) => callTargetNote(checker, node) },
  { id: "ts-project.consumer.config", project: TS_PROJECT, file: "src/consumer.ts", spec: { kind: "VariableDeclaration", name: "config" }, note: "config declaration (explicitly any-typed object)", inspect: ({ checker, node }) => `type ${checker.typeToString(checker.getTypeAtLocation(node))}` },
  { id: "ts-project.consumer.dynamicKey", project: TS_PROJECT, file: "src/consumer.ts", spec: { kind: "VariableDeclaration", name: "dynamicKey" }, note: "dynamicKey declaration (const string literal)", inspect: ({ checker, node }) => `type ${checker.typeToString(checker.getTypeAtLocation(node))}` },
  {
    id: "ts-project.consumer.retries.dynamic-access",
    project: TS_PROJECT,
    file: "src/consumer.ts",
    spec: { kind: "ElementAccessExpression", occ: 0, container: { kind: "VariableDeclaration", name: "retries" } },
    note: "element access config[dynamicKey] (dynamic property access on an any receiver)",
    inspect: ({ checker, node }) => `receiver type ${checker.typeToString(checker.getTypeAtLocation(node.expression))}`,
  },
  { id: "ts-project.consumer.handlers", project: TS_PROJECT, file: "src/consumer.ts", spec: { kind: "VariableDeclaration", name: "handlers" }, note: "exported const handlers holding an object literal" },
  { id: "ts-project.consumer.handlers.greet", project: TS_PROJECT, file: "src/consumer.ts", spec: { kind: "PropertyAssignment", name: "greet" }, note: "function-valued property greet of the object literal", inspect: ({ checker, node }) => `type ${checker.typeToString(checker.getTypeAtLocation(node))}` },

  // ts-project / src/dispatch.ts
  { id: "ts-project.dispatch.Fn", project: TS_PROJECT, file: "src/dispatch.ts", spec: { kind: "TypeAliasDeclaration", name: "Fn" }, note: "type alias Fn = (name: string) => string" },
  { id: "ts-project.dispatch.invoke", project: TS_PROJECT, file: "src/dispatch.ts", spec: { kind: "FunctionDeclaration", name: "invoke" }, note: "exported function invoke declaration name" },
  { id: "ts-project.dispatch.invoke.param.fn", project: TS_PROJECT, file: "src/dispatch.ts", spec: { kind: "Parameter", name: "fn", occ: 0 }, note: "function-typed parameter fn", inspect: ({ checker, node }) => `type ${checker.typeToString(checker.getTypeAtLocation(node))}` },
  { id: "ts-project.dispatch.invoke.call.fn", project: TS_PROJECT, file: "src/dispatch.ts", spec: { kind: "CallExpression", calleeText: "fn", occ: 0 }, note: "call token fn(name) through a function-typed parameter", inspect: ({ checker, node }) => callTargetNote(checker, node) },
  { id: "ts-project.dispatch.functionVariable", project: TS_PROJECT, file: "src/dispatch.ts", spec: { kind: "VariableDeclaration", name: "functionVariable" }, note: "const functionVariable holding a function value", inspect: ({ checker, node }) => `type ${checker.typeToString(checker.getTypeAtLocation(node))}` },
  { id: "ts-project.dispatch.viaVariable", project: TS_PROJECT, file: "src/dispatch.ts", spec: { kind: "FunctionDeclaration", name: "viaVariable" }, note: "exported function viaVariable declaration name" },
  { id: "ts-project.dispatch.viaVariable.call.functionVariable", project: TS_PROJECT, file: "src/dispatch.ts", spec: { kind: "CallExpression", calleeText: "functionVariable", occ: 0 }, note: "call token functionVariable(name)", inspect: ({ checker, node }) => callTargetNote(checker, node) },
  { id: "ts-project.dispatch.objectHoldingFunction", project: TS_PROJECT, file: "src/dispatch.ts", spec: { kind: "VariableDeclaration", name: "objectHoldingFunction" }, note: "const objectHoldingFunction (inferred object type)", inspect: ({ checker, node }) => `type ${checker.typeToString(checker.getTypeAtLocation(node))}` },
  { id: "ts-project.dispatch.viaObjectProperty", project: TS_PROJECT, file: "src/dispatch.ts", spec: { kind: "FunctionDeclaration", name: "viaObjectProperty" }, note: "exported function viaObjectProperty declaration name" },
  { id: "ts-project.dispatch.viaObjectProperty.call.send", project: TS_PROJECT, file: "src/dispatch.ts", spec: { kind: "CallExpression", calleeText: "objectHoldingFunction.send", occ: 0 }, note: "call token objectHoldingFunction.send(name) through an object-literal property", inspect: ({ checker, node }) => callTargetNote(checker, node) },
  { id: "ts-project.dispatch.handlers", project: TS_PROJECT, file: "src/dispatch.ts", spec: { kind: "VariableDeclaration", name: "handlers" }, note: "const handlers: Record<string, Fn>", inspect: ({ checker, node }) => `type ${checker.typeToString(checker.getTypeAtLocation(node))}` },
  { id: "ts-project.dispatch.viaIndexedAccess", project: TS_PROJECT, file: "src/dispatch.ts", spec: { kind: "FunctionDeclaration", name: "viaIndexedAccess" }, note: "exported function viaIndexedAccess declaration name" },
  { id: "ts-project.dispatch.viaIndexedAccess.call.indexed", project: TS_PROJECT, file: "src/dispatch.ts", spec: { kind: "CallExpression", calleeText: "handlers[kind]", occ: 0 }, note: "call token handlers[kind](name) through an indexed access", inspect: ({ checker, node }) => callTargetNote(checker, node) },
  { id: "ts-project.dispatch.Dispatcher", project: TS_PROJECT, file: "src/dispatch.ts", spec: { kind: "InterfaceDeclaration", name: "Dispatcher" }, note: "interface Dispatcher declaration name" },
  { id: "ts-project.dispatch.dispatcher", project: TS_PROJECT, file: "src/dispatch.ts", spec: { kind: "VariableDeclaration", name: "dispatcher" }, note: "const dispatcher: Dispatcher (implementation assigned to send)", inspect: ({ checker, node }) => `type ${checker.typeToString(checker.getTypeAtLocation(node))}` },
  { id: "ts-project.dispatch.viaInterfaceReceiver", project: TS_PROJECT, file: "src/dispatch.ts", spec: { kind: "FunctionDeclaration", name: "viaInterfaceReceiver" }, note: "exported function viaInterfaceReceiver declaration name" },
  { id: "ts-project.dispatch.viaInterfaceReceiver.call.send", project: TS_PROJECT, file: "src/dispatch.ts", spec: { kind: "CallExpression", calleeText: "dispatcher.send", occ: 0 }, note: "call token dispatcher.send(name) through an interface-typed receiver", inspect: ({ checker, node }) => callTargetNote(checker, node) },

  // ts-project / src/merged.ts
  { id: "ts-project.merged.Box.decl1", project: TS_PROJECT, file: "src/merged.ts", spec: { kind: "InterfaceDeclaration", name: "Box", occ: 0 }, note: "first interface Box declaration", inspect: ({ checker, node }) => `merged symbol declarations ${symbolAt(checker, node)?.declarations?.length ?? "?"}` },
  { id: "ts-project.merged.Box.decl2", project: TS_PROJECT, file: "src/merged.ts", spec: { kind: "InterfaceDeclaration", name: "Box", occ: 1 }, note: "second interface Box declaration merged with the first", inspect: ({ checker, node }) => `merged symbol declarations ${symbolAt(checker, node)?.declarations?.length ?? "?"}` },
  { id: "ts-project.merged.measure.overload1", project: TS_PROJECT, file: "src/merged.ts", spec: { kind: "FunctionDeclaration", name: "measure", occ: 0 }, note: "measure overload signature 1 (no body)" },
  { id: "ts-project.merged.measure.overload2", project: TS_PROJECT, file: "src/merged.ts", spec: { kind: "FunctionDeclaration", name: "measure", occ: 1 }, note: "measure overload signature 2 (no body)" },
  { id: "ts-project.merged.measure.impl", project: TS_PROJECT, file: "src/merged.ts", spec: { kind: "FunctionDeclaration", name: "measure", occ: 2 }, note: "measure implementation with body", inspect: ({ checker, node }) => `merged symbol declarations ${symbolAt(checker, node)?.declarations?.length ?? "?"}` },
  { id: "ts-project.merged.Counter.class", project: TS_PROJECT, file: "src/merged.ts", spec: { kind: "ClassDeclaration", name: "Counter" }, note: "class Counter declaration merged with namespace Counter" },
  { id: "ts-project.merged.Counter.namespace", project: TS_PROJECT, file: "src/merged.ts", spec: { kind: "ModuleDeclaration", name: "Counter" }, note: "namespace Counter merged with class Counter", inspect: ({ checker, node }) => `merged symbol declarations ${symbolAt(checker, node)?.declarations?.length ?? "?"}` },
  { id: "ts-project.merged.Counter.origin", project: TS_PROJECT, file: "src/merged.ts", spec: { kind: "VariableDeclaration", name: "origin" }, note: "const origin inside namespace Counter" },
  { id: "ts-project.merged.Counter.reset", project: TS_PROJECT, file: "src/merged.ts", spec: { kind: "FunctionDeclaration", name: "reset" }, note: "function reset inside namespace Counter" },

  // ts-project / src/flow.ts
  { id: "ts-project.flow.Shape", project: TS_PROJECT, file: "src/flow.ts", spec: { kind: "TypeAliasDeclaration", name: "Shape" }, note: "discriminated union Shape declaration name" },
  { id: "ts-project.flow.Shape.member.circle", project: TS_PROJECT, file: "src/flow.ts", spec: { kind: "StringLiteral", text: "circle", occ: 0 }, note: "discriminant member kind \"circle\" of Shape" },
  { id: "ts-project.flow.area", project: TS_PROJECT, file: "src/flow.ts", spec: { kind: "FunctionDeclaration", name: "area" }, note: "exported function area declaration name" },
  { id: "ts-project.flow.area.param.shape", project: TS_PROJECT, file: "src/flow.ts", spec: { kind: "Parameter", name: "shape", occ: 0 }, note: "shape parameter of area", inspect: ({ checker, node }) => `type ${checker.typeToString(checker.getTypeAtLocation(node))}` },
  { id: "ts-project.flow.area.discriminant", project: TS_PROJECT, file: "src/flow.ts", spec: { kind: "PropertyAccessExpression", text: "shape.kind", occ: 0 }, note: "narrowing discriminant shape.kind of the switch", inspect: ({ checker, node }) => `type ${checker.typeToString(checker.getTypeAtLocation(node))}` },
  { id: "ts-project.flow.area.exhaustive", project: TS_PROJECT, file: "src/flow.ts", spec: { kind: "VariableDeclaration", name: "exhaustive", occ: 0 }, note: "never-typed default-branch value of the exhaustive switch", inspect: ({ checker, node }) => `type ${checker.typeToString(checker.getTypeAtLocation(node))}` },
  { id: "ts-project.flow.describe", project: TS_PROJECT, file: "src/flow.ts", spec: { kind: "FunctionDeclaration", name: "describe" }, note: "exported function describe declaration name" },
  { id: "ts-project.flow.describe.typeof-guard", project: TS_PROJECT, file: "src/flow.ts", spec: { kind: "IfStatement", occ: 0 }, note: "typeof value === \"string\" guard statement" },
  { id: "ts-project.flow.describe.call.toUpperCase", project: TS_PROJECT, file: "src/flow.ts", spec: { kind: "CallExpression", calleeText: "value.toUpperCase", occ: 0 }, note: "call in the typeof-narrowed branch", inspect: ({ checker, node }) => callTargetNote(checker, node) },
  { id: "ts-project.flow.formatDate", project: TS_PROJECT, file: "src/flow.ts", spec: { kind: "FunctionDeclaration", name: "formatDate" }, note: "exported function formatDate declaration name" },
  { id: "ts-project.flow.formatDate.instanceof-guard", project: TS_PROJECT, file: "src/flow.ts", spec: { kind: "IfStatement", occ: 0, container: { kind: "FunctionDeclaration", name: "formatDate" } }, note: "value instanceof Date guard statement" },
  { id: "ts-project.flow.formatDate.call.toISOString", project: TS_PROJECT, file: "src/flow.ts", spec: { kind: "CallExpression", calleeText: "value.toISOString", occ: 0 }, note: "call in the instanceof-narrowed branch", inspect: ({ checker, node }) => callTargetNote(checker, node) },
  { id: "ts-project.flow.afterReturn", project: TS_PROJECT, file: "src/flow.ts", spec: { kind: "FunctionDeclaration", name: "afterReturn" }, note: "exported function afterReturn declaration name" },
  { id: "ts-project.flow.afterReturn.unreachable-statement", project: TS_PROJECT, file: "src/flow.ts", spec: { kind: "ExpressionStatement", occ: 0, container: { kind: "FunctionDeclaration", name: "afterReturn" } }, note: "statement after return 1 (TS7027 only when allowUnreachableCode:false)" },
  { id: "ts-project.flow.alwaysThrows", project: TS_PROJECT, file: "src/flow.ts", spec: { kind: "FunctionDeclaration", name: "alwaysThrows" }, note: "exported function alwaysThrows declaration name" },
  { id: "ts-project.flow.alwaysThrows.return-type", project: TS_PROJECT, file: "src/flow.ts", spec: { kind: "NeverKeyword", occ: 0, container: { kind: "FunctionDeclaration", name: "alwaysThrows" } }, note: "explicit never return type annotation", inspect: ({ checker, node }) => `type ${checker.typeToString(checker.getTypeAtLocation(node))}` },
  { id: "ts-project.flow.afterNeverCall", project: TS_PROJECT, file: "src/flow.ts", spec: { kind: "FunctionDeclaration", name: "afterNeverCall" }, note: "exported function afterNeverCall declaration name" },
  { id: "ts-project.flow.afterNeverCall.never-call", project: TS_PROJECT, file: "src/flow.ts", spec: { kind: "CallExpression", calleeText: "alwaysThrows", occ: 0 }, note: "call to the never-annotated function", inspect: ({ checker, node }) => callTargetNote(checker, node) },
  { id: "ts-project.flow.afterNeverCall.unreachable-return", project: TS_PROJECT, file: "src/flow.ts", spec: { kind: "ReturnStatement", occ: 0, container: { kind: "FunctionDeclaration", name: "afterNeverCall" } }, note: "statement after the never call (TS7027 suggestion at default options)" },
  { id: "ts-project.flow.definiteAssignment", project: TS_PROJECT, file: "src/flow.ts", spec: { kind: "FunctionDeclaration", name: "definiteAssignment" }, note: "exported function definiteAssignment declaration name" },
  { id: "ts-project.flow.definiteAssignment.x.decl", project: TS_PROJECT, file: "src/flow.ts", spec: { kind: "VariableDeclaration", name: "x", occ: 0, container: { kind: "FunctionDeclaration", name: "definiteAssignment" } }, note: "let x: number declaration (no initializer)" },
  { id: "ts-project.flow.definiteAssignment.x.read", project: TS_PROJECT, file: "src/flow.ts", spec: { kind: "Identifier", text: "x", occ: 2, container: { kind: "FunctionDeclaration", name: "definiteAssignment" } }, note: "read of x after conditional assignment (TS2454 site)" },

  // ts-project / src/exceptions.ts
  { id: "ts-project.exceptions.Boom", project: TS_PROJECT, file: "src/exceptions.ts", spec: { kind: "ClassDeclaration", name: "Boom" }, note: "error class Boom declaration name" },
  { id: "ts-project.exceptions.tryThrow", project: TS_PROJECT, file: "src/exceptions.ts", spec: { kind: "FunctionDeclaration", name: "tryThrow" }, note: "exported function tryThrow declaration name" },
  { id: "ts-project.exceptions.tryThrow.try", project: TS_PROJECT, file: "src/exceptions.ts", spec: { kind: "TryStatement", occ: 0, container: { kind: "FunctionDeclaration", name: "tryThrow" } }, note: "try statement with catch and finally clauses" },
  { id: "ts-project.exceptions.tryThrow.throw", project: TS_PROJECT, file: "src/exceptions.ts", spec: { kind: "ThrowStatement", occ: 0, container: { kind: "FunctionDeclaration", name: "tryThrow" } }, note: "throw inside the try block" },
  { id: "ts-project.exceptions.tryThrow.catch", project: TS_PROJECT, file: "src/exceptions.ts", spec: { kind: "CatchClause", occ: 0, container: { kind: "FunctionDeclaration", name: "tryThrow" } }, note: "catch clause of the try" },
  { id: "ts-project.exceptions.tryThrow.finally", project: TS_PROJECT, file: "src/exceptions.ts", spec: { kind: "TryStatement", occ: 0, container: { kind: "FunctionDeclaration", name: "tryThrow" }, prop: "finallyBlock" }, note: "finally block of the try" },
  { id: "ts-project.exceptions.throwInCallback", project: TS_PROJECT, file: "src/exceptions.ts", spec: { kind: "FunctionDeclaration", name: "throwInCallback" }, note: "exported function throwInCallback declaration name" },
  { id: "ts-project.exceptions.throwInCallback.arrow", project: TS_PROJECT, file: "src/exceptions.ts", spec: { kind: "ArrowFunction", occ: 0, container: { kind: "FunctionDeclaration", name: "throwInCallback" } }, note: "arrow callback passed to values.forEach" },
  { id: "ts-project.exceptions.throwInCallback.throw", project: TS_PROJECT, file: "src/exceptions.ts", spec: { kind: "ThrowStatement", occ: 0, container: { kind: "FunctionDeclaration", name: "throwInCallback" } }, note: "throw inside the arrow callback" },
  { id: "ts-project.exceptions.throwAsync", project: TS_PROJECT, file: "src/exceptions.ts", spec: { kind: "VariableDeclaration", name: "throwAsync" }, note: "exported const throwAsync (async arrow)", inspect: ({ checker, node }) => `type ${checker.typeToString(checker.getTypeAtLocation(node))}` },
  { id: "ts-project.exceptions.throwAsync.arrow", project: TS_PROJECT, file: "src/exceptions.ts", spec: { kind: "VariableDeclaration", name: "throwAsync", prop: "initializer" }, note: "async arrow function initializer of throwAsync" },
  { id: "ts-project.exceptions.throwAsync.throw", project: TS_PROJECT, file: "src/exceptions.ts", spec: { kind: "ThrowStatement", occ: 0, container: { kind: "VariableDeclaration", name: "throwAsync" } }, note: "throw inside the async arrow" },
  { id: "ts-project.exceptions.checked", project: TS_PROJECT, file: "src/exceptions.ts", spec: { kind: "FunctionDeclaration", name: "checked" }, note: "declare function checked (ambient, no body)" },
  { id: "ts-project.exceptions.checked.jsdoc.throws", project: TS_PROJECT, file: "src/exceptions.ts", spec: { kind: "__jsdocTag", tagName: "throws", occ: 0, container: { kind: "FunctionDeclaration", name: "checked" } }, note: "JSDoc @throws {Boom} when n is negative tag" },
  { id: "ts-project.exceptions.unchecked", project: TS_PROJECT, file: "src/exceptions.ts", spec: { kind: "FunctionDeclaration", name: "unchecked" }, note: "exported function that can throw without a @throws tag", inspect: ({ node }) => `measured @throws tags ${ts.getJSDocTags(node).filter((tag) => tag.tagName.getText() === "throws").length}` },
  { id: "ts-project.exceptions.neverReturns", project: TS_PROJECT, file: "src/exceptions.ts", spec: { kind: "FunctionDeclaration", name: "neverReturns" }, note: "exported never-annotated function declaration name" },
  { id: "ts-project.exceptions.neverReturns.throw", project: TS_PROJECT, file: "src/exceptions.ts", spec: { kind: "ThrowStatement", occ: 0, container: { kind: "FunctionDeclaration", name: "neverReturns" } }, note: "throw that makes neverReturns return never" },

  // ts-project / src/sql-client.d.ts + src/db.ts
  { id: "ts-project.sql-client.SqlClient", project: TS_PROJECT, file: "src/sql-client.d.ts", spec: { kind: "ClassDeclaration", name: "SqlClient" }, note: "ambient declared class SqlClient" },
  { id: "ts-project.sql-client.SqlClient.prepare", project: TS_PROJECT, file: "src/sql-client.d.ts", spec: { kind: "MethodDeclaration", name: "prepare", occ: 0 }, note: "SqlClient.prepare method declaration" },
  { id: "ts-project.sql-client.Statement", project: TS_PROJECT, file: "src/sql-client.d.ts", spec: { kind: "InterfaceDeclaration", name: "Statement" }, note: "Statement interface declaration" },
  { id: "ts-project.sql-client.Statement.all", project: TS_PROJECT, file: "src/sql-client.d.ts", spec: { kind: "MethodSignature", name: "all", occ: 0 }, note: "Statement.all method signature declaration" },
  { id: "ts-project.db.import.SqlClient", project: TS_PROJECT, file: "src/db.ts", spec: { kind: "Identifier", text: "SqlClient", occ: 0 }, note: "import binding SqlClient specifier", inspect: ({ checker, node }) => {
      const symbol = symbolAt(checker, node);
      if (!symbol) return "unresolved";
      const aliased = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      const declaration = aliased.declarations?.[0];
      return `aliased target ${declaration ? describeDeclaration(checker, declaration) : "?"}`;
    } },
  { id: "ts-project.db.specifier.sql-client", project: TS_PROJECT, file: "src/db.ts", spec: { kind: "StringLiteral", text: "./sql-client", occ: 0 }, note: "import module specifier \"./sql-client\" (resolves to the ambient .d.ts)" },
  { id: "ts-project.db.selectUsers", project: TS_PROJECT, file: "src/db.ts", spec: { kind: "FunctionDeclaration", name: "selectUsers" }, note: "exported function selectUsers declaration name" },
  { id: "ts-project.db.selectUsers.sql-literal", project: TS_PROJECT, file: "src/db.ts", spec: { kind: "StringLiteral", occ: 0, container: { kind: "FunctionDeclaration", name: "selectUsers" } }, note: "single string-literal SQL argument with decoy + real FROM clause" },
  { id: "ts-project.db.countUsers", project: TS_PROJECT, file: "src/db.ts", spec: { kind: "FunctionDeclaration", name: "countUsers" }, note: "exported function countUsers declaration name" },
  { id: "ts-project.db.countUsers.template", project: TS_PROJECT, file: "src/db.ts", spec: { kind: "NoSubstitutionTemplateLiteral", occ: 0, container: { kind: "FunctionDeclaration", name: "countUsers" } }, note: "template literal SQL argument with no substitutions", inspect: ({ node }) => `ts.SyntaxKind.${kindNameFor(node.kind)} (numeric ${node.kind}, alias ${ts.SyntaxKind[node.kind]})` },
  { id: "ts-project.db.selectByKind", project: TS_PROJECT, file: "src/db.ts", spec: { kind: "FunctionDeclaration", name: "selectByKind" }, note: "exported function selectByKind declaration name" },
  { id: "ts-project.db.selectByKind.template", project: TS_PROJECT, file: "src/db.ts", spec: { kind: "TemplateExpression", occ: 0, container: { kind: "FunctionDeclaration", name: "selectByKind" } }, note: "template literal SQL argument with one substitution (dynamic)" },
  { id: "ts-project.db.prepare", project: TS_PROJECT, file: "src/db.ts", spec: { kind: "FunctionDeclaration", name: "prepare", occ: 0 }, note: "locally declared function prepare that shadows the client method" },
  { id: "ts-project.db.shadowedPrepare", project: TS_PROJECT, file: "src/db.ts", spec: { kind: "FunctionDeclaration", name: "shadowedPrepare" }, note: "exported function shadowedPrepare declaration name" },
  { id: "ts-project.db.shadowedPrepare.call", project: TS_PROJECT, file: "src/db.ts", spec: { kind: "CallExpression", calleeText: "prepare", occ: 0, container: { kind: "FunctionDeclaration", name: "shadowedPrepare" } }, note: "call token prepare(sql) bound to the local shadowing function", inspect: ({ checker, node }) => callTargetNote(checker, node) },
  { id: "ts-project.db.dynamicReceiver", project: TS_PROJECT, file: "src/db.ts", spec: { kind: "FunctionDeclaration", name: "dynamicReceiver" }, note: "exported function dynamicReceiver declaration name" },
  { id: "ts-project.db.dynamicReceiver.call", project: TS_PROJECT, file: "src/db.ts", spec: { kind: "CallExpression", calleeText: "client.prepare", occ: 0, container: { kind: "FunctionDeclaration", name: "dynamicReceiver" } }, note: "call token client.prepare(sql) on an any-typed receiver", inspect: ({ checker, node }) => callTargetNote(checker, node) },

  // js-project
  { id: "js-project.messages.label", project: JS_PROJECT, file: "src/messages.js", spec: { kind: "FunctionDeclaration", name: "label" }, note: "exported JS function label (JSDoc-typed item parameter)" },
  { id: "js-project.messages.label.item-name", project: JS_PROJECT, file: "src/messages.js", spec: { kind: "PropertyAccessExpression", text: "item.name", occ: 0, container: { kind: "FunctionDeclaration", name: "label" } }, note: "property access item.name on the JSDoc-typed object", inspect: ({ checker, node }) => `type ${checker.typeToString(checker.getTypeAtLocation(node))}` },
  { id: "js-project.messages.describe", project: JS_PROJECT, file: "src/messages.js", spec: { kind: "FunctionDeclaration", name: "describe" }, note: "exported JS function describe declaration name" },
  { id: "js-project.broken.stringify", project: JS_PROJECT, file: "src/broken.js", spec: { kind: "FunctionDeclaration", name: "stringify" }, note: "exported JS function stringify declaration name" },
  { id: "js-project.broken.stringify.error-return", project: JS_PROJECT, file: "src/broken.js", spec: { kind: "ReturnStatement", occ: 0, container: { kind: "FunctionDeclaration", name: "stringify" } }, note: "deliberate TS2322 site (number returned where JSDoc declares string)" },

  // states-a
  { id: "states-a.app.describe", project: "states-a", file: "src/app.ts", spec: { kind: "FunctionDeclaration", name: "describe" }, note: "exported function describe declaration name" },
  { id: "states-a.app.specifier.dep", project: "states-a", file: "src/app.ts", spec: { kind: "StringLiteral", text: "./dep", occ: 0 }, note: "import module specifier \"./dep\"" },
  { id: "states-a.app.value.read", project: "states-a", file: "src/app.ts", spec: { kind: "Identifier", text: "value", occ: 1 }, note: "template read of imported value", inspect: ({ checker, node }) => `type ${checker.typeToString(checker.getTypeAtLocation(node))}` },
  { id: "states-a.dep.value", project: "states-a", file: "src/dep.ts", spec: { kind: "VariableDeclaration", name: "value" }, note: "exported const value declaration name", inspect: ({ checker, node }) => `type ${checker.typeToString(checker.getTypeAtLocation(node))}` },

  // states-b
  { id: "states-b.app.describe", project: "states-b", file: "src/app.ts", spec: { kind: "FunctionDeclaration", name: "describe" }, note: "exported function describe declaration name" },
  { id: "states-b.app.specifier.dep", project: "states-b", file: "src/app.ts", spec: { kind: "StringLiteral", text: "./dep", occ: 0 }, note: "import module specifier \"./dep\"" },
  { id: "states-b.app.specifier.added", project: "states-b", file: "src/app.ts", spec: { kind: "StringLiteral", text: "./added", occ: 0 }, note: "import module specifier \"./added\" (module absent in states/a)" },
  { id: "states-b.app.value.read", project: "states-b", file: "src/app.ts", spec: { kind: "Identifier", text: "value", occ: 1 }, note: "template read of imported value (string in state b)", inspect: ({ checker, node }) => `type ${checker.typeToString(checker.getTypeAtLocation(node))}` },
  { id: "states-b.app.extra.read", project: "states-b", file: "src/app.ts", spec: { kind: "Identifier", text: "extra", occ: 1 }, note: "template read of imported extra", inspect: ({ checker, node }) => `type ${checker.typeToString(checker.getTypeAtLocation(node))}` },
  { id: "states-b.dep.value", project: "states-b", file: "src/dep.ts", spec: { kind: "VariableDeclaration", name: "value" }, note: "exported const value declaration name (string in state b)", inspect: ({ checker, node }) => `type ${checker.typeToString(checker.getTypeAtLocation(node))}` },
  { id: "states-b.added.extra", project: "states-b", file: "src/added.ts", spec: { kind: "VariableDeclaration", name: "extra" }, note: "exported const extra declaration name (only in states/b)", inspect: ({ checker, node }) => `type ${checker.typeToString(checker.getTypeAtLocation(node))}` },
];

// ------------------------------------------------------------------ sql calls

const SQL_CALLS = [
  { id: "sql-call.db.selectUsers.prepare", container: { kind: "FunctionDeclaration", name: "selectUsers" }, callee: "client.prepare", label: "resolved client with single string-literal SQL argument" },
  { id: "sql-call.db.countUsers.prepare", container: { kind: "FunctionDeclaration", name: "countUsers" }, callee: "client.prepare", label: "resolved client with no-substitution template SQL" },
  { id: "sql-call.db.selectByKind.prepare", container: { kind: "FunctionDeclaration", name: "selectByKind" }, callee: "client.prepare", label: "resolved client with substituted template SQL (dynamic)" },
  { id: "sql-call.db.shadowedPrepare.prepare", container: { kind: "FunctionDeclaration", name: "shadowedPrepare" }, callee: "prepare", label: "same-name local function shadowing the client method" },
  { id: "sql-call.db.dynamicReceiver.prepare", container: { kind: "FunctionDeclaration", name: "dynamicReceiver" }, callee: "client.prepare", label: "any-typed receiver" },
];

function analyzeSqlCall(projectEntry, spec) {
  const sf = projectEntry.sourceFiles.get("src/db.ts");
  const call = resolveSpec(sf, { kind: "CallExpression", calleeText: spec.callee, occ: 0, container: spec.container });
  const checker = projectEntry.checker;
  const { line, column } = positionOf(sf, call);

  const arg = call.arguments[0];
  let form = "dynamic";
  let substitutions = 0;
  let sqlText = null;
  let literalNode = null;
  if (arg && ts.isStringLiteral(arg)) {
    form = "stringLiteral";
    sqlText = arg.text;
    literalNode = arg;
  } else if (arg && ts.isNoSubstitutionTemplateLiteral(arg)) {
    form = "template";
    sqlText = arg.text;
    literalNode = arg;
  } else if (arg && ts.isTemplateExpression(arg)) {
    form = "dynamic";
    substitutions = arg.templateSpans.length;
    literalNode = arg;
  }

  const signature = checker.getResolvedSignature(call);
  const resolvedDecl = signature?.declaration ?? null;
  const sqlClientPrepare = resolveSpec(projectEntry.sourceFiles.get("src/sql-client.d.ts"), { kind: "MethodDeclaration", name: "prepare", occ: 0 });
  const localPrepare = resolveSpec(sf, { kind: "FunctionDeclaration", name: "prepare", occ: 0 });

  const receiver = ts.isPropertyAccessExpression(call.expression) ? call.expression.expression : call.expression;
  const receiverType = checker.getTypeAtLocation(receiver);
  const receiverBinding = receiverType.flags & ts.TypeFlags.Any ? "any" : checker.getSymbolAtLocation(receiver) ? "resolved" : "unknown";

  let clientMatch;
  if (receiverBinding === "any") clientMatch = "dynamic";
  else if (!resolvedDecl) clientMatch = "indirect";
  else if (resolvedDecl === localPrepare) clientMatch = "shadowed";
  else if (resolvedDecl === sqlClientPrepare) clientMatch = "matched";
  else clientMatch = "indirect";

  const sqlClient = resolveSpec(projectEntry.sourceFiles.get("src/sql-client.d.ts"), { kind: "ClassDeclaration", name: "SqlClient" });
  const clientPos = positionOf(projectEntry.sourceFiles.get("src/sql-client.d.ts"), sqlClient);

  return {
    id: spec.id,
    project: TS_PROJECT,
    file: `${FIXTURES_REL}/ts-project/src/db.ts`,
    line,
    column,
    name: call.expression.getText(sf),
    label: spec.label,
    form,
    substitutions,
    sqlText,
    sqlLiteralPosition: literalNode ? positionOf(sf, literalNode) : null,
    receiver: receiver.getText(sf),
    receiverBinding,
    receiverType: checker.typeToString(receiverType),
    clientMatch,
    resolvedDeclaration: resolvedDecl
      ? {
          file: relPath(resolvedDecl.getSourceFile().fileName),
          line: positionOf(resolvedDecl.getSourceFile(), resolvedDecl).line,
          column: positionOf(resolvedDecl.getSourceFile(), resolvedDecl).column,
          name: resolvedDecl.name ? resolvedDecl.name.getText(resolvedDecl.getSourceFile()) : ts.SyntaxKind[resolvedDecl.kind],
        }
      : null,
    clientDeclaration: {
      file: `${FIXTURES_REL}/ts-project/src/sql-client.d.ts`,
      line: clientPos.line,
      column: clientPos.column,
      name: "SqlClient",
    },
    note: `CallExpression start (first token of callee ${call.expression.getText(sf)} in ${spec.container.name}); ${spec.label}; clientMatch=${clientMatch} from checker.getResolvedSignature`,
  };
}

// ----------------------------------------------------------------------- gaps

const GAPS = [
  { id: "gap.models.FormalGreeter.greet.no-outgoing-call-edge", project: TS_PROJECT, file: "src/models.ts", spec: { kind: "MethodDeclaration", name: "greet", occ: 0 }, expected: "no-outgoing-call-edge" },
  { id: "gap.impl.GreeterImpl.greet.no-outgoing-call-edge", project: TS_PROJECT, file: "src/impl.ts", spec: { kind: "MethodDeclaration", name: "greet", occ: 0 }, expected: "no-outgoing-call-edge" },
  { id: "gap.util.makeMessage.greet.indirect-call", project: TS_PROJECT, file: "src/util.ts", spec: { kind: "CallExpression", calleeText: "g.greet", occ: 0 }, expected: "indirect-call" },
  { id: "gap.dispatch.invoke.fn.indirect-call", project: TS_PROJECT, file: "src/dispatch.ts", spec: { kind: "CallExpression", calleeText: "fn", occ: 0 }, expected: "indirect-call" },
  { id: "gap.dispatch.viaVariable.functionVariable.indirect-call", project: TS_PROJECT, file: "src/dispatch.ts", spec: { kind: "CallExpression", calleeText: "functionVariable", occ: 0 }, expected: "indirect-call" },
  { id: "gap.dispatch.viaObjectProperty.send.indirect-call", project: TS_PROJECT, file: "src/dispatch.ts", spec: { kind: "CallExpression", calleeText: "objectHoldingFunction.send", occ: 0 }, expected: "indirect-call" },
  { id: "gap.dispatch.viaIndexedAccess.dynamic-property-access", project: TS_PROJECT, file: "src/dispatch.ts", spec: { kind: "CallExpression", calleeText: "handlers[kind]", occ: 0 }, expected: "dynamic-property-access" },
  { id: "gap.dispatch.viaInterfaceReceiver.send.indirect-call", project: TS_PROJECT, file: "src/dispatch.ts", spec: { kind: "CallExpression", calleeText: "dispatcher.send", occ: 0 }, expected: "indirect-call" },
  { id: "gap.db.shadowedPrepare.prepare.shadowed-client", project: TS_PROJECT, file: "src/db.ts", spec: { kind: "CallExpression", calleeText: "prepare", occ: 0, container: { kind: "FunctionDeclaration", name: "shadowedPrepare" } }, expected: "shadowed-client" },
  { id: "gap.db.dynamicReceiver.prepare.indirect-call", project: TS_PROJECT, file: "src/db.ts", spec: { kind: "CallExpression", calleeText: "client.prepare", occ: 0, container: { kind: "FunctionDeclaration", name: "dynamicReceiver" } }, expected: "indirect-call" },
];

// -------------------------------------------------------------------- helpers

function sourceFileFor(projectId, relFile) {
  const entry = loaded.get(projectId);
  const sf = entry.sourceFiles.get(relFile);
  if (!sf) throw new Error(`no source file ${relFile} in project ${projectId}`);
  return sf;
}

function buildSymbols() {
  const out = [];
  const ids = new Set();
  for (const query of SYMBOLS) {
    const entry = loaded.get(query.project);
    const sf = sourceFileFor(query.project, query.file);
    const node = resolveSpec(sf, query.spec);
    const pos = positionOf(sf, node);
    const noteParts = [query.note];
    if (query.inspect) noteParts.push(query.inspect({ sf, node, checker: entry.checker, program: entry.program }));
    if (ids.has(query.id)) throw new Error(`duplicate symbol id ${query.id}`);
    ids.add(query.id);
    out.push({
      id: query.id,
      project: query.project,
      file: `${FIXTURES_REL}/${entry.project.root}/${query.file}`,
      name: nameOf(sf, node),
      kind: kindNameFor(node.kind),
      line: pos.line,
      column: pos.column,
      note: noteParts.join(" | "),
    });
  }
  return out;
}

function buildGaps() {
  return GAPS.map((query) => {
    const sf = sourceFileFor(query.project, query.file);
    const node = resolveSpec(sf, query.spec);
    const pos = positionOf(sf, node);
    return {
      id: query.id,
      file: `${FIXTURES_REL}/${loaded.get(query.project).project.root}/${query.file}`,
      line: pos.line,
      column: pos.column,
      expected: query.expected,
    };
  });
}

function assertPinnedOptions() {
  const lines = [];
  const required = { target: "ES2022", module: "CommonJS", noEmit: true };
  for (const project of PROJECTS) {
    const { parsed } = loadProject(project);
    const options = parsed.options;
    if (!Array.isArray(options.types) || options.types.length !== 0) throw new Error(`${project.id}: types must be pinned to []`);
    if (!Array.isArray(options.typeRoots) || options.typeRoots.length !== 0) throw new Error(`${project.id}: typeRoots must be pinned to []`);
    for (const [key, value] of Object.entries(required)) {
      const actual = options[key];
      const expected = key === "target" || key === "module" ? ts[key === "target" ? "ScriptTarget" : "ModuleKind"][value] : value;
      if (actual !== expected) throw new Error(`${project.id}: ${key} is ${actual}, expected ${expected}`);
    }
    lines.push(
      [
        `- ${project.id}: strict=${options.strict} allowUnreachableCode=${options.allowUnreachableCode ?? "undefined(default)"} allowJs=${options.allowJs ?? false} checkJs=${options.checkJs ?? false} target=${ts.ScriptTarget[options.target]} module=${ts.ModuleKind[options.module]} moduleResolution=${ts.ModuleResolutionKind[options.moduleResolution]} types=${JSON.stringify(options.types)} typeRoots=${JSON.stringify(options.typeRoots)}`,
      ].join(""),
    );
  }
  return lines;
}

function checkEncodings(dir, collected) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      checkEncodings(full, collected);
      continue;
    }
    if (entry.name === "verify.mjs" || entry.name === "manifest.json" || entry.name === "verification.txt") continue;
    const bytes = readFileSync(full);
    if (bytes.includes(0)) throw new Error(`NUL byte in ${full}`);
    const text = bytes.toString("utf8");
    if (Buffer.from(text, "utf8").compare(bytes) !== 0) throw new Error(`invalid UTF-8 in ${full}`);
    collected.push(`${toPosix(path.relative(REPO_ROOT, full))} (${bytes.length} bytes)`);
  }
}

// ------------------------------------------------------------------------ main

const projectEntries = [];
const verification = [];
verification.push("# TypeScript semantic-context fixture verification");
verification.push("");
verification.push(`generated: ${new Date().toISOString()}`);
verification.push(`pinned typescript version: ${ts.version}`);
verification.push(`typescript module: ${TS_MODULE}`);
verification.push(`repository root: ${REPO_ROOT}`);
verification.push(`all manifest paths (root/config/file) are relative to the repository worktree root`);
verification.push("");
verification.push("## commands");
verification.push("");
verification.push("raw CLI check, one config per project:");
verification.push("  node /Users/wahargis/node_modules/typescript/bin/tsc -p <config> --pretty false");
for (const project of PROJECTS) {
  verification.push(`  node /Users/wahargis/node_modules/typescript/bin/tsc -p ${FIXTURES_REL}/${project.root}/${project.config} --pretty false`);
}
verification.push("");
verification.push("manifest generator + full AST/checker resolution (re-runs both, writes manifest.json and this file):");
verification.push(`  node ${FIXTURES_REL}/verify.mjs`);
verification.push("");
verification.push("note: the tsc CLI prints Error-category diagnostics only; TS7027 unreachable code is a Suggestion at default options");
verification.push("      and therefore appears here (family=suggestion) but not in tsc CLI output.");
verification.push("");
verification.push("## effective compiler options (measured from parseJsonConfigFileContent)");
verification.push("");
verification.push(...assertPinnedOptions());
verification.push("");
verification.push("states/b differs from states/a by exactly one compiler option: compilerOptions.strict false -> true");
verification.push("(same target/module/moduleResolution/noEmit/types/typeRoots/include; states/b additionally adds src/added.ts and changes src/dep.ts value to string)");
verification.push("");

for (const project of PROJECTS) {
  const diagnostics = collectDiagnostics(project);
  const entry = loadProject(project);
  const relConfig = `${FIXTURES_REL}/${project.root}/${project.config}`;
  projectEntries.push({
    id: project.id,
    root: `${FIXTURES_REL}/${project.root}`,
    config: relConfig,
    compile: diagnostics.length === 0 ? "clean" : "diagnostics",
    diagnostics,
  });
  verification.push(`## project ${project.id}`);
  verification.push(`root: ${FIXTURES_REL}/${project.root}`);
  verification.push(`config: ${relConfig}`);
  verification.push(`source files parsed: ${[...entry.sourceFiles.keys()].sort().join(", ")}`);
  verification.push(`tsc-equivalent (Error category only):`);
  const errorDiagnostics = diagnostics.filter((d) => d.family === "semantic");
  if (errorDiagnostics.length === 0) {
    verification.push("  clean");
  } else {
    for (const d of errorDiagnostics) {
      const rel = path.relative(REPO_ROOT, path.join(REPO_ROOT, d.file));
      verification.push(`  ${rel}(${d.line + 1},${d.column + 1}): error TS${d.code}: ${d.message}`);
    }
  }
  verification.push(`API diagnostics (family retained):`);
  if (diagnostics.length === 0) {
    verification.push("  clean");
  } else {
    for (const d of diagnostics) {
      verification.push(`  ${d.file}:${d.line}:${d.column} TS${d.code} family=${d.family} ${d.message}`);
    }
  }
  verification.push("");
}

const projectById = new Map(projectEntries.map((entry) => [entry.id, entry]));
const defaultDiagnostics = projectById.get("ts-project").diagnostics;
const unreachableDiagnostics = projectById.get("ts-project-unreachable").diagnostics;
const flowDiag = (list, line, column) => list.find((d) => d.file.endsWith("src/flow.ts") && d.line === line && d.column === column);
const afterReturnDefault = flowDiag(defaultDiagnostics, 33, 2);
const afterNeverDefault = flowDiag(defaultDiagnostics, 42, 2);
const afterReturnUnreachable = flowDiag(unreachableDiagnostics, 33, 2);
const afterNeverUnreachable = flowDiag(unreachableDiagnostics, 42, 2);
const definiteAssignmentDefault = flowDiag(defaultDiagnostics, 50, 9);
const definiteAssignmentUnreachable = flowDiag(unreachableDiagnostics, 50, 9);
const shapeMatchesContract =
  !afterReturnDefault &&
  afterNeverDefault?.code === 7027 &&
  afterNeverDefault.family === "suggestion" &&
  afterReturnUnreachable?.code === 7027 &&
  afterReturnUnreachable.family === "semantic" &&
  afterNeverUnreachable?.code === 7027 &&
  afterNeverUnreachable.family === "semantic" &&
  definiteAssignmentDefault?.code === 2454 &&
  definiteAssignmentDefault.family === "semantic" &&
  definiteAssignmentUnreachable?.code === 2454 &&
  definiteAssignmentUnreachable.family === "semantic";
if (!shapeMatchesContract) throw new Error("unreachable / definite-assignment diagnostic shape differs from the fixture contract");

verification.push("## measured behaviour the fixtures exist to pin (typescript 5.9.3)");
verification.push("");
verification.push("ts-project default (tsconfig.json):");
verification.push(`  statement after return 1            src/flow.ts:33:2 -> ${afterReturnDefault ? `TS${afterReturnDefault.code} family=${afterReturnDefault.family}` : "no diagnostic"}`);
verification.push(`  statement after a never-annotated call src/flow.ts:42:2 -> ${afterNeverDefault ? `TS${afterNeverDefault.code} family=${afterNeverDefault.family}` : "no diagnostic"}`);
verification.push(`  definite-assignment read of x        src/flow.ts:50:9 -> ${definiteAssignmentDefault ? `TS${definiteAssignmentDefault.code} family=${definiteAssignmentDefault.family}` : "no diagnostic"}`);
verification.push("ts-project with allowUnreachableCode:false (tsconfig.unreachable.json):");
verification.push(`  statement after return 1            src/flow.ts:33:2 -> ${afterReturnUnreachable ? `TS${afterReturnUnreachable.code} family=${afterReturnUnreachable.family}` : "no diagnostic"}`);
verification.push(`  statement after a never-annotated call src/flow.ts:42:2 -> ${afterNeverUnreachable ? `TS${afterNeverUnreachable.code} family=${afterNeverUnreachable.family}` : "no diagnostic"}`);
verification.push(`  definite-assignment read of x        src/flow.ts:50:9 -> ${definiteAssignmentUnreachable ? `TS${definiteAssignmentUnreachable.code} family=${definiteAssignmentUnreachable.family}` : "no diagnostic"}`);
verification.push("");
verification.push("statement: the default tsconfig.json is NOT clean: it carries the semantic TS2454 required by the");
verification.push("definite-assignment case in src/flow.ts plus exactly one unreachable diagnostic, which is suggestion-family");
verification.push("only (TS7027 at src/flow.ts:42:2). The statement after `return 1` produces no diagnostic at default options.");
verification.push("The only difference on tsconfig.unreachable.json is that both unreachable statements become semantic");
verification.push("(Error-category) TS7027 errors; the suggestion list is empty there. No other diagnostic is produced by");
verification.push("either config. Note strings that point at files outside this repository (the default lib .d.ts files)");
verification.push("carry absolute paths; every manifest path field is repository-relative.");
verification.push("");

const symbols = buildSymbols();
const sqlCalls = SQL_CALLS.map((spec) => analyzeSqlCall(loadProject(PROJECTS[0]), spec));
const gaps = buildGaps();

verification.push("## resolved manifest positions (all from ts AST/checker queries, zero-based line:column)");
verification.push("");
for (const symbol of symbols) {
  const entry = loaded.get(symbol.project);
  const relFile = toPosix(path.relative(`${FIXTURES_REL}/${entry.project.root}`, symbol.file));
  const sf = entry.sourceFiles.get(relFile);
  const text = sf ? sf.text.split("\n")[symbol.line].trim() : "";
  verification.push(`${symbol.id} ${symbol.file}:${symbol.line}:${symbol.column} kind=${symbol.kind} name=${symbol.name} :: ${text}`);
}
verification.push("");
verification.push("## sql call analysis (checker.getResolvedSignature)");
verification.push("");
for (const call of sqlCalls) {
  verification.push(`${call.id} ${call.file}:${call.line}:${call.column} form=${call.form} substitutions=${call.substitutions} clientMatch=${call.clientMatch} receiverBinding=${call.receiverBinding} receiverType=${call.receiverType}`);
  verification.push(`  resolvedDeclaration=${call.resolvedDeclaration ? `${call.resolvedDeclaration.name}@${call.resolvedDeclaration.file}:${call.resolvedDeclaration.line}:${call.resolvedDeclaration.column}` : "none"}`);
  verification.push(`  sqlText=${call.sqlText === null ? "(non-literal)" : JSON.stringify(call.sqlText)}`);
}
verification.push("");

const encodings = [];
checkEncodings(here, encodings);
verification.push("## encoding check");
verification.push("");
verification.push(`files checked (no NUL byte, valid UTF-8): ${encodings.length}`);
verification.push("");

const manifest = {
  projects: projectEntries,
  symbols,
  sqlCalls,
  gaps,
};

writeFileSync(path.join(here, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(path.join(here, "verification.txt"), `${verification.join("\n")}\n`);

console.log(`typescript ${ts.version} via ${TS_MODULE}`);
for (const project of projectEntries) {
  console.log(`${project.id}: ${project.compile}${project.diagnostics.length ? ` (${project.diagnostics.map((d) => `TS${d.code}/${d.family}`).join(", ")})` : ""}`);
}
console.log(`symbols=${symbols.length} sqlCalls=${sqlCalls.length} gaps=${gaps.length}`);
console.log(`wrote ${path.join(here, "manifest.json")}`);
console.log(`wrote ${path.join(here, "verification.txt")}`);
