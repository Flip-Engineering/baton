// Context package gate: proves the staged dependency bytes execute useful
// projections package-relatively, with no ambient module resolution.
// Runs inside the payload at libexec/baton2/context; stdout is one JSON
// document on success; failures exit 2 with {error:{stage,detail}} on stderr.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import ts from 'typescript';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');
const require = createRequire(import.meta.url);

function sortedFiles(directory) {
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        files.push({ relative: path.relative(directory, absolute).split(path.sep).join('/'), absolute });
      }
    }
  };
  visit(directory);
  files.sort((left, right) => (left.relative < right.relative ? -1 : left.relative > right.relative ? 1 : 0));
  return files;
}

function treeDigest(directory) {
  const hash = crypto.createHash('sha256');
  for (const file of sortedFiles(directory)) {
    hash.update(file.relative);
    hash.update(Buffer.from([0]));
    hash.update(crypto.createHash('sha256').update(fs.readFileSync(file.absolute)).digest('hex'));
    hash.update(Buffer.from('\n'));
  }
  return hash.digest('hex');
}

function verifyClosure() {
  const closure = JSON.parse(fs.readFileSync(path.join(here, 'dependency-closure.json'), 'utf8'));
  if (closure.schema !== 'baton2-context-dependency-closure-v1') {
    throw new Error('unexpected dependency closure schema: ' + closure.schema);
  }
  const modules = path.join(here, 'node_modules');
  const names = Object.keys(closure.packages).sort();
  for (const name of names) {
    const row = closure.packages[name];
    const manifest = JSON.parse(fs.readFileSync(path.join(modules, name, 'package.json'), 'utf8'));
    if (manifest.name !== name || manifest.version !== row.version) {
      throw new Error('staged dependency identity mismatch: ' + name);
    }
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (!(dependency in closure.packages)) {
        throw new Error('staged dependency closure is missing transitive ' + dependency);
      }
    }
    const digest = treeDigest(path.join(modules, name));
    if (digest !== row.treeSha256) {
      throw new Error('staged dependency bytes differ from the packaged closure: ' + name);
    }
  }
  return { packages: names.length, digestsVerified: true };
}

function stagedModuleDir(specifier) {
  const resolved = import.meta.resolve(specifier);
  if (!resolved.startsWith('file://')) {
    throw new Error('resolved module is not a file URL: ' + specifier);
  }
  const filePath = fileURLToPath(resolved);
  const stageRoot = path.join(here, 'node_modules') + path.sep;
  const moduleDir = path.dirname(filePath);
  if (!moduleDir.startsWith(stageRoot)) {
    throw new Error('module resolved outside the staged node_modules: '
      + specifier + ' -> ' + moduleDir);
  }
  return moduleDir;
}

function packageVersion(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (typeof manifest.version !== 'string') {
    throw new Error('package manifest has no version: ' + dir);
  }
  return manifest.version;
}

function ajvProbe() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: true });
  const schema = JSON.parse(fs.readFileSync(path.join(fixtures, 'schema.json'), 'utf8'));
  const valid = JSON.parse(fs.readFileSync(path.join(fixtures, 'sample-valid.json'), 'utf8'));
  const invalid = JSON.parse(fs.readFileSync(path.join(fixtures, 'sample-invalid.json'), 'utf8'));
  const validate = ajv.compile(schema);
  const validVerdict = validate(valid);
  const invalidVerdict = validate(invalid);
  if (validVerdict !== true || invalidVerdict !== false) {
    throw new Error('ajv verdicts disagree with the fixtures');
  }
  if (validate.errors.length < 2) {
    throw new Error('allErrors collection produced fewer than the fixture errors');
  }
  let strictRefusal;
  try {
    ajv.compile({ type: 'object', unknownKeyword: true });
    throw new Error('strict mode admitted an unknown keyword');
  } catch (error) {
    strictRefusal = { message: String(error.message) };
  }
  return {
    module: 'ajv/dist/2020.js',
    version: packageVersion(stagedModuleDir('ajv/package.json')),
    validVerdict,
    invalidErrors: validate.errors.map((row) => ({
      instancePath: row.instancePath, keyword: row.keyword, params: row.params,
    })),
    strictRefusal,
  };
}

function zodProbe() {
  const schema = z.object({
    id: z.number().int().min(1),
    name: z.string().min(1),
  });
  const valid = schema.safeParse({ id: 7, name: 'report' });
  const invalid = schema.safeParse({ id: 0, name: '' });
  if (!valid.success || invalid.success) {
    throw new Error('zod verdicts disagree with the probes');
  }
  let jsonSchema;
  let jsonSchemaSupport;
  try {
    jsonSchema = z.toJSONSchema(schema);
    jsonSchemaSupport = true;
  } catch {
    jsonSchemaSupport = false;
  }
  return {
    module: 'zod',
    version: packageVersion(stagedModuleDir('zod/package.json')),
    validValue: valid.data,
    invalidIssues: invalid.error.issues.map((issue) => ({
      path: issue.path, code: issue.code,
    })),
    jsonSchemaSupport,
    jsonSchemaType: jsonSchemaSupport ? jsonSchema.type : null,
  };
}

function typescriptProbe() {
  if (ts.version !== '5.9.3') {
    throw new Error('bundled typescript is not 5.9.3: ' + ts.version);
  }
  const configPath = path.join(fixtures, 'tsconfig.json');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error !== undefined) {
    throw new Error('tsconfig fixture failed to read: ' + JSON.stringify(read.error));
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, fixtures);
  if (parsed.errors.length > 0 || parsed.fileNames.length !== 2) {
    throw new Error('tsconfig fixture did not parse into the two fixture files');
  }
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length > 0) {
    throw new Error('fixture program has diagnostics: '
      + ts.flattenDiagnosticMessageText(diagnostics[0].messageText, ' '));
  }
  const checker = program.getTypeChecker();
  const main = program.getSourceFile(path.join(fixtures, 'ts', 'main.ts'));
  let signatureType = null;
  let messageType = null;
  ts.forEachChild(main, (statement) => {
    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations[0];
      messageType = checker.typeToString(checker.getTypeAtLocation(declaration.name));
    }
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        const imported = clause.namedBindings.elements[0];
        const symbol = checker.getSymbolAtLocation(imported.name);
        const declared = symbol?.getDeclarations()?.[0];
        if (declared !== undefined) {
          signatureType = checker.typeToString(checker.getTypeAtLocation(declared));
        }
      }
    }
  });
  if (signatureType !== '(name: string) => string' || messageType !== 'string') {
    throw new Error('typescript type queries returned unexpected strings: '
      + signatureType + ', ' + messageType);
  }
  return {
    module: 'typescript',
    version: ts.version,
    resolvedDeclarationType: signatureType,
    messageType,
  };
}

try {
  const report = {
    gate: 'baton2-context-package-gate',
    closure: verifyClosure(),
    stages: [ajvProbe(), zodProbe(), typescriptProbe()],
  };
  process.stdout.write(JSON.stringify(report) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({
    error: { stage: 'contextPackageGate', detail: String(error && error.message) },
  }) + '\n');
  process.exit(2);
}
