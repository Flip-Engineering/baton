import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as Bend from './bend.ts';
import * as Comp from './comp.ts';
import { cli_build, cli_report } from './main.ts';

// Notebook state and process admission belong to the Bend coordinator. This
// frontend exposes the pinned compiler's source, inference and build operations.
function digest(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function errorText(error: unknown): string {
  const value = error as Bend.Err;
  if (error instanceof RangeError) {
    return 'Error: the machine stack overflowed (a deep recursion, or a literal too large to expand)';
  }
  return value?.$ === 'Err' ? Bend.err_show(value) : String(error);
}

function complete(book: Bend.Book): void {
  Bend.book_valid(book, 0);
  Comp.book_owned(book, Comp.SYNTH);
  const holes = book.hols + book.open;
  if (holes) throw `Error: ${holes} TODO${holes === 1 ? '' : 's'} found.\nThe code is incomplete, and not a valid proof yet.`;
}

function reserved(book: Bend.Book): void {
  if (book.tlds.main || book.tlds.__baton_repl_expression) {
    throw 'The notebook reserves main and __baton_repl_expression for evaluated expressions.';
  }
}

function declarations(book: Bend.Book): object[] {
  return [...new Set(book.order)].flatMap(name => {
    const value = book.tlds[name];
    if (value.b || name === '__baton_repl_expression' || name === 'main') return [];
    return [{ name, kind: value.$, type: Bend.term_show(Bend.term_lower(value.T)) }];
  });
}

async function frontend(): Promise<void> {
  const [operation, sourceFile, workspaceArg, outputArg, expectedType = ''] = process.argv.slice(2);
  if (!['define', 'eval'].includes(operation) || !sourceFile || !workspaceArg || !outputArg) {
    throw 'Expected define|eval SOURCE_FILE WORKSPACE OUTPUT [EXPECTED_TYPE].';
  }
  const workspace = fs.realpathSync(workspaceArg);
  const source = fs.readFileSync(sourceFile, 'utf8');
  const definitions = JSON.parse(await Bun.stdin.text());
  if (!Array.isArray(definitions) || definitions.some(value => typeof value !== 'string')) {
    throw 'The definition snapshot must contain complete Bend2 source strings.';
  }
  const book = Bend.book_nil();
  const seen = new Map<string, string | null>();
  const aliases: Record<string, string> = Object.create(null);
  await Bend.book_load(book, Bend.BASE_BEND, '', seen);
  complete(book);
  let ordinal = 0;
  async function load(source: string): Promise<number> {
    const filename = path.join(workspace, `.baton-repl-cell-${ordinal++}.bend`);
    return Bend.book_load(book, filename, '', seen, undefined, source, aliases);
  }
  for (const declaration of definitions) {
    await load(declaration);
    reserved(book);
    complete(book);
  }
  const provenance = {
    compiler: JSON.parse(fs.readFileSync(path.join(import.meta.dir, 'compiler.json'), 'utf8')),
    sourceSha256: digest(sourceFile),
    workspace,
  };
  if (operation === 'define') {
    const done = await load(source);
    reserved(book);
    complete(book);
    cli_report(book, done, 2);
    process.stdout.write(JSON.stringify({ protocol: 1, kind: 'definitions', ...provenance,
      declarations: declarations(book) }) + '\n');
    return;
  }
  const temporary = '__baton_repl_expression';
  const wrapped = `def ${temporary}() -> ${expectedType || 'Type'}:\n`
    + source.split('\n').map(line => '  ' + line).join('\n') + '\n';
  const done = await load(wrapped);
  const expression = book.tlds[temporary] as Bend.Def;
  if (!expectedType) {
    const inferred = Bend.term_infer(book,
      { t: Bend.Ref(temporary), n: 0, def: temporary, qs: [] },
      expression.v as Bend.HTerm, Bend.Lone(), Bend.ctx_nil(), 0);
    expression.T = inferred.ty;
  }
  complete(book);
  const type = Bend.term_show(Bend.term_lower(expression.T));
  cli_report(book, done, 2);
  if (Comp.io_base(book, expression.T) === null) {
    const value = Bend.term_show(Bend.term_lower(Bend.term_snf(book, expression.v as Bend.HTerm)));
    process.stdout.write(JSON.stringify({ protocol: 1, kind: 'pure', ...provenance,
      type, value, declarations: declarations(book) }) + '\n');
    return;
  }
  book.tlds.main = { $: 'Def', n: 0, x: 0, T: expression.T, v: Bend.Ref(temporary) };
  book.order.push('main');
  complete(book);
  const output = path.resolve(outputArg);
  const c = output + '.c';
  fs.writeFileSync(c, Comp.compile_book(book));
  cli_build(output, c, ['-lsqlite3'], true);
  process.stdout.write(JSON.stringify({ protocol: 1, kind: 'native', ...provenance,
    type, generatedC: { path: c, sha256: digest(c) },
    executable: { path: output, sha256: digest(output) },
    declarations: declarations(book) }) + '\n');
}

try {
  await frontend();
} catch (error) {
  process.stderr.write(errorText(error) + '\n');
  process.exitCode = 1;
}
