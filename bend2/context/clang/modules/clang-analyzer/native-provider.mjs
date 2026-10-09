import { eventFrame, sourceRequest, compilation, runAdapter, parsedOutput, failure } from './shared.mjs';
import { join, resolve } from 'node:path';
import { databaseAccesses } from './clang-join.mjs';

export async function executeInvocation(invocation, { packageRoot }) {
  try {
    const { request, subject, cwd, file } = sourceRequest(invocation);
    const compile = compilation(request, cwd, file);
    const translationUnit = resolve(compile.directory, compile.file);
    const argumentsWithTranslationUnitLast = [
      compile.arguments[0],
      ...compile.arguments.slice(1).filter((argument) =>
        resolve(compile.directory, argument) !== translationUnit),
      compile.file,
    ];
    const kind = subject.kind;
    const joinsDatabase = request.select.includes('databaseAccesses');
    const extractorSubject = kind === 'position'
      ? { kind: 'position', path: subject.path, line: subject.line, column: subject.column }
      : kind === 'symbol'
        ? { kind: 'symbol', path: subject.path, name: subject.name }
        : null;
    if (!extractorSubject) throw new Error(`clang-analyzer does not support subject kind ${String(kind)}`);
    const document = {
      version: 1,
      command: 'analyze',
      request: {
        version: 1,
        operation: kind === 'symbol' && !joinsDatabase ? 'functionSignature' : 'handlerAnalysis',
        directory: compile.directory,
        file: compile.file,
        arguments: argumentsWithTranslationUnitLast,
        subject: extractorSubject,
        helpers: request.options?.client ? [request.options.client] : [],
      },
    };
    const adapter = join(packageRoot, 'adapter/clang-analyzer.mjs');
    const result = await runAdapter(adapter, document);
    const output = parsedOutput(result);
    if (result.code !== 0 || output === null) {
      return eventFrame(invocation, { status: 'unavailable', engine: 'clang-analyzer',
        error: failure(result, output), source: { path: file } });
    }
    if (!output.error && joinsDatabase) {
      output.databaseAccesses = await databaseAccesses(output, {
        cwd, database: request.options?.database,
      });
    }
    return eventFrame(invocation, { status: output.error ? 'unavailable' : 'complete',
      engine: 'clang-analyzer', source: { path: file }, result: output });
  } catch (error) {
    return eventFrame(invocation, { status: 'unavailable', engine: 'clang-analyzer',
      error: { message: error.message } });
  }
}
