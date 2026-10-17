import { readFileSync } from 'node:fs';
import { delimiter, resolve, join } from 'node:path';
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { eventFrame, sourceRequest, compilation, runAdapter, parsedOutput, failure } from './shared.mjs';

function executableOnPath(name) {
  const configured = process.env.BATON2_CLANGD || name;
  if (configured.includes('/') || configured.includes('\\')) {
    const candidate = resolve(configured);
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return realpathSync(candidate);
    } catch {
      return candidate;
    }
    return candidate;
  }
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = resolve(entry || '.', configured);
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return realpathSync(candidate);
    } catch {
      continue;
    }
  }
  return configured;
}

function methodRequests(request, uri) {
  const subject = request.subject;
  const position = Number.isInteger(subject.line) && Number.isInteger(subject.column)
    ? { line: subject.line, character: subject.column } : null;
  const textDocument = { uri };
  const selected = Array.isArray(request.select) ? request.select : [];
  const methods = [];
  if (position && selected.includes('definition')) {
    methods.push({ method: 'textDocument/definition', params: { textDocument, position } });
  }
  if (position && selected.includes('references')) {
    methods.push({ method: 'textDocument/references', params: { textDocument, position,
      context: { includeDeclaration: true } } });
  }
  if (position && selected.includes('type')) {
    methods.push({ method: 'textDocument/hover', params: { textDocument, position } });
  }
  const followups = [];
  if (selected.includes('calls')) followups.push('outgoingCalls');
  if (selected.includes('callers')) followups.push('incomingCalls');
  if (position && followups.length > 0) {
    methods.push({ method: 'textDocument/prepareCallHierarchy', params: { textDocument, position }, followups });
  }
  return methods;
}

export async function executeInvocation(invocation, { packageRoot }) {
  try {
    const { request, subject, cwd, file } = sourceRequest(invocation);
    const compile = compilation(request, cwd, file);
    const text = readFileSync(file, 'utf8');
    const uri = pathToFileURL(file).href;
    const selected = Array.isArray(request.select) ? request.select : [];
    const document = {
      version: 1,
      command: 'diagnose',
      executable: executableOnPath('clangd'),
      root: compile.databaseDirectory,
      file,
      uriFile: file,
      docVersion: 1,
      languageId: /\.[ch]$/.test(file) ? 'c' : 'cpp',
      text,
      compileArguments: compile.arguments,
      methods: methodRequests(request, uri),
      requireDiagnosticPublication: selected.includes('diagnostics'),
    };
    const adapter = join(packageRoot, 'adapter/clangd.mjs');
    const result = await runAdapter(adapter, document);
    const output = parsedOutput(result);
    if (result.code !== 0 || output === null) {
      return eventFrame(invocation, { status: 'unavailable', engine: 'clangd',
        error: failure(result, output), source: { path: file } });
    }
    return eventFrame(invocation, { status: output.failure ? 'unavailable' : 'complete',
      engine: 'clangd', source: { path: file }, result: output });
  } catch (error) {
    return eventFrame(invocation, { status: 'unavailable', engine: 'clangd',
      error: { message: error.message } });
  }
}
