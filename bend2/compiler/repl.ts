import * as fs from 'node:fs';
import * as path from 'node:path';
import { file_digest as digest } from './store.ts';
import * as Bend from './bend.ts';
import * as Comp from './comp.ts';
import { book_err as errorText, cli_build, cli_report } from './main.ts';

// Notebook state and process admission belong to the Bend coordinator. This
// frontend exposes the pinned compiler's source, inference and build operations.
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
  const notebook: Set<string> = new Set();
  let ordinal = 0;
  async function load(source: string): Promise<number> {
    const filename = path.join(workspace, `.baton-repl-cell-${ordinal++}.bend`);
    return Bend.book_load(book, filename, '', seen, undefined, source, aliases);
  }
  // The pinned parser refuses a second declaration of an existing name. A
  // notebook cell may replace a definition that an earlier cell declared, so
  // read the names the cell declares, forget the earlier notebook definition,
  // then load the cell into the complete book. Base and imported names stay
  // reserved because they are not in `notebook`.
  function declared(source: string): Set<string> {
    const lines = source.split('\n');
    const cell_aliases: Record<string, string> = { ...aliases };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const m = line.match(/^import(\s.*|)$/);
      if (m !== null) {
        const h = m[1].match(/^\s+(\S+)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?\s*(?:#.*)?$/);
        if (h !== null && h[2] !== undefined) {
          cell_aliases[h[2]] = h[1].replace(/\.bend$/, '');
        }
        lines[i] = '';
        continue;
      }
      if (line !== '' && !line.startsWith('#')) break;
    }
    const scratch = Bend.book_nil();
    const names = new Set<string>();
    try {
      Bend.parse_book(scratch, workspace + path.sep, lines.join('\n'), '', cell_aliases);
      for (const name of scratch.order) names.add(name);
    } catch {
      // The load below reports the canonical refusal for this source.
    }
    return names;
  }
  function forget(name: string): void {
    const old = book.tlds[name];
    if (old?.$ === 'ADT') {
      for (const ctr of old.c) delete book.ctrs[ctr.k];
    }
    delete book.tlds[name];
    delete book.tmps[name];
    book.order = book.order.filter((existing) => existing !== name);
  }
  type Cell = { added: string[] };
  async function load_cell(source: string): Promise<Cell> {
    const names = [...declared(source)];
    const replaced = names
      .filter((name) => notebook.has(name) && book.tlds[name] !== undefined)
      .map((name): [string, number] => [name, book.order.lastIndexOf(name)]);
    for (const [name] of replaced) forget(name);
    const done = await load(source);
    const added = book.order.slice(done);
    for (const name of added) notebook.add(name);
    // The checker builds its definition table in book order. Put a replaced
    // definition back at its old position so earlier dependents stay valid;
    // moving it to the end would make those dependents fail to resolve it.
    for (const [name, at] of replaced.sort((a, b) => a[1] - b[1])) {
      if (at < 0) continue;
      const from = book.order.lastIndexOf(name);
      if (from < 0) continue;
      book.order.splice(from, 1);
      book.order.splice(Math.min(at, book.order.length), 0, name);
    }
    return { added };
  }
  function report_index(cell: Cell): number {
    for (const name of cell.added) {
      const from = book.order.lastIndexOf(name);
      if (from >= 0) book.order.splice(from, 1);
    }
    book.order.push(...cell.added);
    return book.order.length - cell.added.length;
  }
  for (const declaration of definitions) {
    await load_cell(declaration);
    reserved(book);
    complete(book);
  }
  const provenance = {
    compiler: JSON.parse(fs.readFileSync(path.join(import.meta.dir, 'compiler.json'), 'utf8')),
    sourceSha256: digest(sourceFile),
    workspace,
  };
  if (operation === 'define') {
    const cell = await load_cell(source);
    reserved(book);
    complete(book);
    const done = report_index(cell);
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
  const cDirectory = fs.mkdtempSync(path.join(path.dirname(output), '.bend-repl-c-'));
  const partial = path.join(cDirectory, 'output.c'), cDescriptor = fs.openSync(partial, 'wx');
  try { Comp.compile_book_to(book, chunk => fs.writeFileSync(cDescriptor, chunk), path.dirname(output)); }
  catch (error) {
    process.stderr.write('Compiler output evidence: ' + cDirectory + '\n');
    throw error;
  } finally { fs.closeSync(cDescriptor); }
  fs.renameSync(partial, c);
  fs.rmdirSync(cDirectory);
  await cli_build(output, c, undefined, ['-lsqlite3'], true);
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
