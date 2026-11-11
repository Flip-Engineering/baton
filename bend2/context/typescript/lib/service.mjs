// The language service the provider queries, built over the captured host.
//
// The Program consumes the capture only: every file the compiler reads, every lookup that fails
// and every directory listing comes from the immutable capture, so the analyzed bytes are the
// recorded bytes. Two consequences are deliberate:
//
//   - the effective options re-derive the config chain through the captured reader, and
//   - when the project does not pin `types`/`typeRoots`, the provider pins them to empty and
//     records `ambientTypesPinned`, so an ambient ancestor package cannot silently supply types.

import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { Refusal } from './protocol.mjs';

const SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.json'];

const DEFAULT_EXCLUDES = ['node_modules', 'bower_components', 'jspm_packages'];

function normalize(path) {
  return path.split('\\').join('/');
}

// A documented subset of the tsconfig include/exclude glob language: `**`, `*`, `?`, and a
// directory pattern with no wildcard and no extension. Patterns are matched against the path
// relative to the configuration directory, which is the semantics the compiler documents.
export function globMatches(relativePath, pattern) {
  let source = normalize(pattern);
  if (source.endsWith('/')) source = `${source}**/*`;
  const lastSegment = source.slice(source.lastIndexOf('/') + 1);
  if (!lastSegment.includes('*') && !lastSegment.includes('?') && !lastSegment.includes('.')) {
    source = `${source}/**/*`;
  }
  let expression = '';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '*') {
      if (source[index + 1] === '*') {
        if (source[index + 2] === '/') {
          expression += '(?:.*/)?';
          index += 2;
        } else {
          expression += '.*';
          index += 1;
        }
      } else {
        expression += '[^/]*';
      }
    } else if (character === '?') {
      expression += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(character)) {
      expression += `\\${character}`;
    } else {
      expression += character;
    }
  }
  return new RegExp(`^${expression}$`).test(normalize(relativePath));
}

function extensionAdmitted(name, extensions) {
  return extensions.includes(extname(name)) || name.endsWith('.d.ts');
}

function excludedByDefault(relativePath, outDir) {
  const segments = normalize(relativePath).split('/');
  if (segments.some((segment) => DEFAULT_EXCLUDES.includes(segment))) return true;
  if (outDir !== undefined && outDir !== '' && normalize(relativePath).startsWith(normalize(outDir))) return true;
  return false;
}

// A recursive listing over the capture. Every directory it visits is recorded, so membership is
// part of the snapshot identity, and the include/exclude/depth arguments the compiler passes are
// honored here rather than ignored, so a config that excludes a directory does not silently
// contribute its files as roots.
export function readDirectoryRecursive(capture, rootDir, extensions = SCRIPT_EXTENSIONS, excludes = [], includes = [], depth, outDir = '') {
  const found = [];
  const visited = new Set();
  const includeAll = includes === undefined || includes.length === 0;
  const walk = (current, level) => {
    if (visited.has(current)) return;
    visited.add(current);
    for (const name of capture.readDirectory(current)) {
      if (name.startsWith('.')) continue;
      const child = join(current, name);
      const relativePath = child.slice(rootDir.length + 1);
      if (capture.directoryExists(child)) {
        if (excludedByDefault(relativePath, outDir)) continue;
        if (excludes.some((pattern) => globMatches(relativePath, pattern))) continue;
        if (depth !== undefined && level + 1 > depth) continue;
        walk(child, level + 1);
        continue;
      }
      if (!extensionAdmitted(name, extensions)) continue;
      if (excludedByDefault(relativePath, outDir)) continue;
      if (excludes.some((pattern) => globMatches(relativePath, pattern))) continue;
      if (!includeAll && !includes.some((pattern) => globMatches(relativePath, pattern))) continue;
      found.push(child);
    }
  };
  walk(rootDir, 0);
  return found;
}

function parseHostFor(capture, readConfigs, selection = {}) {
  return {
    useCaseSensitiveFileNames: true,
    fileExists: (path) => capture.fileExists(path),
    readFile: (path) => {
      const text = capture.readText(path);
      if (text !== undefined && (path.endsWith('.json') || path.endsWith('tsconfig'))) readConfigs.add(path);
      return text;
    },
    // The compiler passes the parsed include/exclude/depth and outDir here; honoring them is what
    // makes config selection real rather than an unfiltered walk.
    readDirectory: (rootDir, extensions, excludes, includes, depth) =>
      readDirectoryRecursive(capture, rootDir, extensions, excludes, includes, depth, selection.outDir),
    trace: () => {},
  };
}

// The structural option fields that enter the snapshot identity. Free-form option text stays out;
// only recognized enums, booleans, numbers and explicit path fields are recorded.
export function optionIdentity(options, extra = {}) {
  const structural = {};
  const names = [
    'strict',
    'noImplicitAny',
    'strictNullChecks',
    'allowUnreachableCode',
    'allowUnusedLabels',
    'exactOptionalPropertyTypes',
    'noUncheckedIndexedAccess',
    'noImplicitReturns',
    'noFallthroughCasesInSwitch',
    'noUnusedLocals',
    'noUnusedParameters',
    'allowJs',
    'checkJs',
    'resolveJsonModule',
    'esModuleInterop',
    'skipLibCheck',
    'isolatedModules',
    'target',
    'module',
    'moduleResolution',
    'jsx',
    'noEmit',
  ];
  for (const name of names) {
    const value = options[name];
    if (value === undefined) continue;
    structural[name] = typeof value === 'string' ? value : value;
  }
  structural.types = [...(options.types ?? [])].map(String).sort();
  structural.typeRoots = [...(options.typeRoots ?? [])].map(String).sort();
  structural.lib = [...(options.lib ?? [])].map(String).sort();
  return { ...structural, ...extra };
}

export function createService({ resolved, capture, request }) {
  const ts = resolved.module;
  const cwd = request.cwd;
  const readConfigs = new Set();
  const host = parseHostFor(capture, readConfigs);
  let outDir = '';
  const limits = [];

  let options;
  let rootNames;
  let configPath = '';
  let ambientTypesPinned = false;

  if (request.options.project) {
    configPath = isAbsolute(request.options.project)
      ? request.options.project
      : resolve(cwd, request.options.project);
    const configText = capture.readText(configPath);
    if (configText === undefined) throw new Refusal('context-project-config-missing');
    const raw = ts.parseConfigFileTextToJson(configPath, configText);
    if (raw.error) throw new Refusal('context-project-config-invalid');
    const parsed = ts.parseJsonConfigFileContent(
      raw.config ?? {},
      host,
      dirname(configPath),
      undefined,
      configPath,
    );
    if (parsed.errors.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
      throw new Refusal('context-project-config-invalid');
    }
    options = { ...parsed.options, noEmit: true };
    rootNames = parsed.fileNames;
  } else {
    // A project-less query uses a fixed baseline and says so; checkJs keeps JavaScript analysis a
    // real checker answer rather than a silent parse-only result.
    options = {
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      allowJs: true,
      checkJs: true,
      resolveJsonModule: true,
      esModuleInterop: true,
      noEmit: true,
      types: [],
      typeRoots: [],
    };
    rootNames = [resolve(cwd, request.subject.path)];
    limits.push({
      projection: 'snapshot',
      code: 'baselineOptions',
      detail: 'no project option; the provider baseline options were used',
    });
  }

  if (options.types === undefined) {
    options.types = [];
    ambientTypesPinned = true;
  }
  if (options.typeRoots === undefined) {
    options.typeRoots = [];
    ambientTypesPinned = true;
  }
  if (ambientTypesPinned) {
    limits.push({
      projection: 'snapshot',
      code: 'ambientTypesPinned',
      detail: 'the project did not pin types/typeRoots; the provider pinned both to empty',
    });
  }

  outDir = options.outDir ?? '';
  if (outDir === '' && options.out !== undefined) outDir = options.out;
  const fileVersions = new Map();
  const languageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => rootNames,
    getScriptVersion: (fileName) => {
      const digest = capture.digest(fileName);
      const version = digest ?? 'absent';
      fileVersions.set(fileName, version);
      return version;
    },
    getScriptSnapshot: (fileName) => {
      const text = capture.readText(fileName);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => cwd,
    getDefaultLibFileName: (compilerOptions) => ts.getDefaultLibFilePath(compilerOptions),
    fileExists: (path) => capture.fileExists(path),
    readFile: (path) => capture.readText(path),
    readDirectory: (rootDir, extensions) => readDirectoryRecursive(capture, rootDir, extensions),
    directoryExists: (path) => capture.directoryExists(path),
    getDirectories: (path) =>
      capture.readDirectory(path).filter((name) => capture.directoryExists(join(path, name))),
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    log: () => {},
    trace: () => {},
  };

  const languageService = ts.createLanguageService(languageServiceHost, ts.createDocumentRegistry(true, cwd));
  const program = languageService.getProgram();
  if (program === undefined) throw new Refusal('context-program-unavailable');
  const checker = program.getTypeChecker();
  const subjectPath = resolve(cwd, request.subject.path);
  const sourceFile = program.getSourceFile(subjectPath);
  if (sourceFile === undefined) throw new Refusal('context-subject-not-in-program');

  return {
    ts,
    program,
    checker,
    languageService,
    sourceFile,
    subjectPath,
    options,
    effective: optionIdentity(options, {
      configPath,
      configFiles: [...readConfigs].sort(),
      ambientTypesPinned,
      project: request.options.project !== '' ? 'declared' : 'none',
    }),
    configChain: [...readConfigs].sort(),
    limits,
  };
}
