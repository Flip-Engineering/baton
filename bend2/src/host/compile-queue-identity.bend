import Base
import ../host/text.bend as T
import ../host/files.bend as F
import ../host/storage.bend as Storage

type CompileQueueWalk is Data:
  CompileQueueWalk{queue: List<&2,String>, +visited: List<&2,String>, records: List<&2,String>}

# Shared compile queue identity, schema version 2.
#
# The shell reference key is not a compatibility contract: it omitted source
# inputs and imported C files. Identity material is built from the kind,
# normalized argv and options, the full source closure, and the compiler and
# linker closure. Paths in the source closure are relative to the caller's
# source root; absolute imports and imports outside that root fail.
#
# Source closure:
#   - A .bend file contributes its own bytes and the targets of top-level
#     `import <target>` lines and quoted `import "./x"` bindings at any
#     indentation.
#   - A .c or .h file contributes its own bytes and the targets of local
#     `#include "..."` lines. System `#include <...>` headers belong to the
#     toolchain evidence the caller supplies.
#   - Cycles and repeated imports are visited once. `.js` and helper scripts
#     contribute bytes without further parsing.
#
# The cgen closure starts at the Bend entry. The cc closure starts from the
# generated C, native-entry.c, helper scripts and any other caller-supplied
# files. Compiler closure hashes the compiler and linker executables, their
# wrapper exec chains, the captured --version text, and the Bend release tree
# when the compiler resolves into one.
#
# cli_build coverage (bend2/compiler/upstream/main.ts:349-417):
#   kind=cc, input=the generated C file, artifact binary=<path.resolve(bin)>,
#   compiler=cc_find(bangs). The argv carries -std=c11 -O3, the macOS
#   -x objective-c -fobjc-arc -fmodules flags, -DBEND_METAL=1, the X11/ALSA
#   link flags and the CUDA -I/-L flags. The lifecycle must encode the
#   platform/backend selection and a normalized CUDA root as options; raw
#   absolute CUDA paths must not enter the key. The optional
#   [bin, --gpu-build] step runs the produced artifact; it is post-build
#   evidence, not compiler identity.
#
# The caller supplies the linker path and captured version text. The closure
# follows quoted local includes; system includes and a compiler-managed
# sysroot remain runtime qualification evidence supplied with the toolchain
# record.
#
# Material encoding for `material` and `material_key`:
#   kind                "cgen" or "cc"
#   entry               worktree-relative Bend entry, empty for cc
#   options             one KEY=VALUE per line; sorted bytewise here
#   source_digest       64-hex digest of the cgen source closure, empty for cc
#   file_closure_digest 64-hex digest of the cc file closure, empty for cgen
#   compiler_digest     64-hex digest of the compiler/linker/version closure
#   input_rows          one `destination<TAB>sha256<TAB>bytes` per line; the
#                       destination is the work-relative staged name
#   artifact_names      one artifact name per line
#   normalized_argv     tokens already normalized to {in:<destination>},
#                       {out:<name>} and {compiler}, one per line; a trailing
#                       newline is optional, an empty string means no tokens,
#                       and an empty token is a blank line
#
# Material record:
#   schema=baton-compile-queue-identity-v2
#   kind=KIND
#   entry=ENTRY
#   option=VALUE            (sorted, one per line)
#   source-digest=HEX       (cgen) or file-digest=HEX (cc)
#   toolchain-digest=HEX
#   input=DEST<TAB>SHA<TAB>BYTES
#   artifact-name=NAME
#   argv=TOKEN
#
# key = SHA-256 of the complete material text, including final newlines.

def CompileQueueIdentity.schema() -> String:
  "baton-compile-queue-identity-v2"

def CompileQueueIdentity.text_digest(text: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-digest.c"

def CompileQueueIdentity.key(material: String) -> IO(Result<&1,&1,U32 & String,String>):
  CompileQueueIdentity.text_digest(material)


def CompileQueueIdentity.file_digest(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-digest.c"

def CompileQueueIdentity.file_size(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-digest.c"

def CompileQueueIdentity.list_dir(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-digest.c"

def CompileQueueIdentity.realpath(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-digest.c"

def CompileQueueIdentity.readlink(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-digest.c"

def CompileQueueIdentity.is_script(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-digest.c"

def CompileQueueIdentity.resolve_command(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-digest.c"

def CompileQueueIdentity.nonempty(values: List<&2,String>) -> List<&2,String>:
  match values:
    case Nil{}:
      Nil{}
    case SNil{} <> rest:
      CompileQueueIdentity.nonempty(rest)
    case SCon{c, chars} <> rest:
      Con{SCon{c, chars}, CompileQueueIdentity.nonempty(rest)}

def CompileQueueIdentity.insert(+value: String, sorted: List<&2,String>) -> List<&2,String>:
  match sorted:
    case Nil{}:
      [value]
    case +head <> +tail:
      Bool.pick(List<&2,String>, String.is_lt(value, head), value <> head <> tail, head <> CompileQueueIdentity.insert(value, tail))

def CompileQueueIdentity.sort(values: List<&2,String>) -> List<&2,String>:
  match values:
    case Nil{}:
      Nil{}
    case value <> rest:
      CompileQueueIdentity.insert(value, CompileQueueIdentity.sort(rest))

def CompileQueueIdentity.option_lines(values: List<&2,String>) -> String:
  match values:
    case Nil{}: ""
    case value <> rest: "option=" ++ value ++ "\n" ++ CompileQueueIdentity.option_lines(rest)

def CompileQueueIdentity.input_lines(rows: List<&2,String>) -> String:
  match rows:
    case Nil{}: ""
    case +row <> +rest:
      +tail = CompileQueueIdentity.input_lines(rest)
      Bool.pick(String, String.is_empty(row), tail, "input=" ++ row ++ "\n" ++ tail)

def CompileQueueIdentity.artifact_lines(names: List<&2,String>) -> String:
  match names:
    case Nil{}: ""
    case +name <> +rest:
      +tail = CompileQueueIdentity.artifact_lines(rest)
      Bool.pick(String, String.is_empty(name), tail, "artifact-name=" ++ name ++ "\n" ++ tail)

def CompileQueueIdentity.argv_terminated(tokens: List<&2,String>) -> String:
  match tokens:
    case Nil{}: ""
    case +token <> Nil{}: ""
    case +token <> +rest: "argv=" ++ token ++ "\n" ++ CompileQueueIdentity.argv_terminated(rest)

def CompileQueueIdentity.argv_plain(tokens: List<&2,String>) -> String:
  match tokens:
    case Nil{}: ""
    case +token <> +rest: "argv=" ++ token ++ "\n" ++ CompileQueueIdentity.argv_plain(rest)

def CompileQueueIdentity.argv_lines(+tokens: String) -> String:
  Bool.pick(String, String.is_empty(tokens), "",
    Bool.pick(String, String.ends_with(tokens, "\n"),
      CompileQueueIdentity.argv_terminated(String.lines(tokens)),
      CompileQueueIdentity.argv_plain(String.lines(tokens))))

def CompileQueueIdentity.digest_lines(kind: String, source_digest: String, file_closure_digest: String) -> String:
  Bool.pick(String, String.eq(kind, "cgen"), "source-digest=" ++ source_digest ++ "\n", "file-digest=" ++ file_closure_digest ++ "\n")

def CompileQueueIdentity.path_absolute(+path: String) -> Bool:
  String.starts_with(path, "/")

def CompileQueueIdentity.path_basename_parts(parts: List<&2,String>) -> String:
  match parts:
    case Nil{}: ""
    case part <> Nil{}: part
    case part <> rest: CompileQueueIdentity.path_basename_parts(rest)

def CompileQueueIdentity.path_basename(path: String) -> String:
  CompileQueueIdentity.path_basename_parts(String.split(path, Char.from_u32(47)))

def CompileQueueIdentity.path_dirname_parts(parts: List<&2,String>, +acc: String, first: Bool) -> String:
  match parts:
    case Nil{}: acc
    case part <> Nil{}: acc
    case +part <> next <> rest:
      next_acc = Bool.pick(String, first, part, acc ++ "/" ++ part)
      CompileQueueIdentity.path_dirname_parts(next <> rest, next_acc, False{})

def CompileQueueIdentity.path_dirname(+path: String) -> String:
  +directory = CompileQueueIdentity.path_dirname_parts(String.split(path, Char.from_u32(47)), "", True{})
  Bool.pick(String, Bool.and(String.is_empty(directory), CompileQueueIdentity.path_absolute(path)), "/", directory)

def CompileQueueIdentity.path_join(+directory: String, +target: String) -> String:
  Bool.pick(String, CompileQueueIdentity.path_absolute(target), target,
    Bool.pick(String, String.is_empty(directory), target, directory ++ "/" ++ target))

def CompileQueueIdentity.path_inside(+root: String, +path: String) -> Bool:
  Bool.or(String.eq(root, path), Bool.or(String.eq(root, "/"), String.starts_with(path, root ++ "/")))

def CompileQueueIdentity.path_relative(+root: String, +path: String) -> String:
  Bool.pick(String, String.eq(root, "/"), String.drop(path, 1n),
    String.drop(path, Nat.add(String.length(root), 1n)))

def CompileQueueIdentity.list_contains(values: List<&2,String>, +value: String) -> Bool:
  match values:
    case Nil{}:
      False{}
    case head <> rest:
      Bool.pick(Bool, String.eq(head, value), True{}, CompileQueueIdentity.list_contains(rest, value))

def CompileQueueIdentity.second(values: List<&2,String>) -> String:
  match values:
    case first <> value <> rest:
      value
    case other:
      ""

def CompileQueueIdentity.first_token_tab(parts: List<&2,String>) -> String:
  match parts:
    case token <> tail: token
    case other: ""

def CompileQueueIdentity.first_token_space(parts: List<&2,String>) -> String:
  match parts:
    case first <> rest:
      CompileQueueIdentity.first_token_tab(String.split(first, Char.from_u32(9)))
    case other: ""

def CompileQueueIdentity.first_token(value: String) -> String:
  CompileQueueIdentity.first_token_space(String.split(value, Char.from_u32(32)))

def CompileQueueIdentity.bend_import_value(+trimmed: String, +original: String) -> String:
  +rest = String.drop(trimmed, 7n)
  Bool.pick(String, String.starts_with(rest, "\""),
    CompileQueueIdentity.second(String.split(rest, Char.from_u32(34))),
    Bool.pick(String, String.eq(trimmed, original), CompileQueueIdentity.first_token(rest), ""))

def CompileQueueIdentity.bend_import_target(+line: String) -> String:
  +trimmed = String.trim_start(line)
  Bool.pick(String, String.starts_with(trimmed, "import "),
    CompileQueueIdentity.bend_import_value(trimmed, line),
    "")

def CompileQueueIdentity.bend_targets(lines: List<&2,String>) -> List<&2,String>:
  match lines:
    case Nil{}:
      Nil{}
    case line <> +rest:
      +target = CompileQueueIdentity.bend_import_target(line)
      +tail = CompileQueueIdentity.bend_targets(rest)
      Bool.pick(List<&2,String>, String.is_empty(target), tail,
        Bool.pick(List<&2,String>, String.eq(target, "Base"), tail, target <> tail))

def CompileQueueIdentity.c_include_target(line: String) -> String:
  +trimmed = String.trim_start(line)
  Bool.pick(String, String.starts_with(trimmed, "#include \""),
    CompileQueueIdentity.second(String.split(trimmed, Char.from_u32(34))),
    "")

def CompileQueueIdentity.c_targets(lines: List<&2,String>) -> List<&2,String>:
  match lines:
    case Nil{}:
      Nil{}
    case line <> +rest:
      +target = CompileQueueIdentity.c_include_target(line)
      +tail = CompileQueueIdentity.c_targets(rest)
      Bool.pick(List<&2,String>, String.is_empty(target), tail, target <> tail)

def CompileQueueIdentity.closure_targets(path: String, +text: String) -> List<&2,String>:
  +name = String.to_lower(CompileQueueIdentity.path_basename(path))
  Bool.pick(List<&2,String>, String.ends_with(name, ".bend"),
    CompileQueueIdentity.bend_targets(String.lines(text)),
    Bool.pick(List<&2,String>, Bool.or(String.ends_with(name, ".c"), String.ends_with(name, ".h")),
      CompileQueueIdentity.c_targets(String.lines(text)),
      Nil{}))

def CompileQueueIdentity.enqueue_targets(+importer: String, targets: List<&2,String>, queue: List<&2,String>) -> List<&2,String>:
  match targets:
    case Nil{}:
      queue
    case +target <> rest:
      next = Bool.pick(String, CompileQueueIdentity.path_absolute(target),
        "!absolute:" ++ target,
        CompileQueueIdentity.path_join(CompileQueueIdentity.path_dirname(importer), target))
      CompileQueueIdentity.enqueue_targets(importer, rest, next <> queue)

# Import traversal expands a dynamic work queue; visited realpaths bound it to the finite source closure.
@unsafe
def CompileQueueIdentity.walk_queue(queue: List<&2,String>, +visited: List<&2,String>,
                                   +records: List<&2,String>, +root: String) -> IO(Result<&1,&1,U32 & String,CompileQueueWalk>):
  match queue:
    case Nil{}:
      IO.pure(Result<&1,&1,U32 & String,CompileQueueWalk>, Done{CompileQueueWalk{queue, visited, records}})
    case +head <> +rest:
      Bool.pick(IO(Result<&1,&1,U32 & String,CompileQueueWalk>), String.starts_with(head, "!absolute:"),
        IO.pure(Result<&1,&1,U32 & String,CompileQueueWalk>, Fail{(1, "absolute import")}),
        do IO<Result<&1,&1,U32 & String,CompileQueueWalk>>:
          +resolved : String <- IO.try(String, CompileQueueIdentity.realpath(head))
          Bool.pick(IO(Result<&1,&1,U32 & String,CompileQueueWalk>), CompileQueueIdentity.path_inside(root, resolved),
            do IO<Result<&1,&1,U32 & String,CompileQueueWalk>>:
              +seen : Bool <- IO.pure(Bool, CompileQueueIdentity.list_contains(visited, resolved))
              +next : CompileQueueWalk <- Bool.pick(IO(CompileQueueWalk), seen,
                IO.pure(CompileQueueWalk, CompileQueueWalk{rest, visited, records}),
                do IO<CompileQueueWalk>:
                  +text : String <- IO.try(String, T.Text.read(resolved))
                  digest : String <- IO.try(String, CompileQueueIdentity.file_digest(resolved))
                  size : String <- IO.try(String, CompileQueueIdentity.file_size(resolved))
                  record : String <- IO.pure(String, CompileQueueIdentity.path_relative(root, resolved) ++ "\t" ++ digest ++ "\t" ++ size)
                  targets : List<&2,String> <- IO.pure(List<&2,String>, CompileQueueIdentity.closure_targets(resolved, text))
                  next_queue : List<&2,String> <- IO.pure(List<&2,String>, CompileQueueIdentity.enqueue_targets(resolved, targets, rest))
                  IO.pure(CompileQueueWalk, CompileQueueWalk{next_queue, resolved <> visited, record <> records}))
              match next:
                case CompileQueueWalk{q, v, r}:
                  CompileQueueIdentity.walk_queue(q, v, r, root),
            IO.pure(Result<&1,&1,U32 & String,CompileQueueWalk>, Fail{(1, "source path outside root")})))

def CompileQueueIdentity.walk(state: CompileQueueWalk, root: String) -> IO(Result<&1,&1,U32 & String,CompileQueueWalk>):
  match state:
    case CompileQueueWalk{queue, visited, records}:
      CompileQueueIdentity.walk_queue(queue, visited, records, root)

def CompileQueueIdentity.source_lines(records: List<&2,String>) -> String:
  match records:
    case Nil{}:
      ""
    case record <> rest:
      "source-file=" ++ record ++ "\n" ++ CompileQueueIdentity.source_lines(rest)

def CompileQueueIdentity.source_closure_record(root: String, resolved: String, final: CompileQueueWalk) -> IO(Result<&1,&1,U32 & String,String>):
  match final:
    case CompileQueueWalk{queue, visited, records}:
      text = "schema=baton-compile-queue-source-v2\nsource-entry=" ++ CompileQueueIdentity.path_relative(root, resolved) ++ "\n" ++ CompileQueueIdentity.source_lines(CompileQueueIdentity.sort(records))
      IO.pure(Result<&1,&1,U32 & String,String>, Done{text})

def CompileQueueIdentity.source_closure_walk(+root: String, +resolved: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    final : CompileQueueWalk <- IO.try(CompileQueueWalk, CompileQueueIdentity.walk_queue([resolved], Nil{}, Nil{}, root))
    CompileQueueIdentity.source_closure_record(root, resolved, final)

def CompileQueueIdentity.source_closure(+source_root: String, +entry: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +root : String <- IO.try(String, CompileQueueIdentity.realpath(source_root))
    entry_path : String <- IO.pure(String, Bool.pick(String, CompileQueueIdentity.path_absolute(entry), entry, root ++ "/" ++ entry))
    +resolved : String <- IO.try(String, CompileQueueIdentity.realpath(entry_path))
    Bool.pick(IO(Result<&1,&1,U32 & String,String>), CompileQueueIdentity.path_inside(root, resolved),
      CompileQueueIdentity.source_closure_walk(root, resolved),
      IO.pure(Result<&1,&1,U32 & String,String>, Fail{(1, "entry outside root")}))

def CompileQueueIdentity.source_digest(source_root: String, entry: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    text : String <- IO.try(String, CompileQueueIdentity.source_closure(source_root, entry))
    CompileQueueIdentity.text_digest(text)

def CompileQueueIdentity.file_queue(names: List<&2,String>, +root: String) -> List<&2,String>:
  match names:
    case Nil{}:
      Nil{}
    case +name <> +rest:
      +tail = CompileQueueIdentity.file_queue(rest, root)
      Bool.pick(List<&2,String>, String.is_empty(name), tail,
        Bool.pick(String, CompileQueueIdentity.path_absolute(name), name, root ++ "/" ++ name) <> tail)

def CompileQueueIdentity.file_closure_record(final: CompileQueueWalk) -> IO(Result<&1,&1,U32 & String,String>):
  match final:
    case CompileQueueWalk{queue, visited, records}:
      text = "schema=baton-compile-queue-source-v2\n" ++ CompileQueueIdentity.source_lines(CompileQueueIdentity.sort(records))
      IO.pure(Result<&1,&1,U32 & String,String>, Done{text})

def CompileQueueIdentity.file_closure_walk(+root: String, files: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    final : CompileQueueWalk <- IO.try(CompileQueueWalk, CompileQueueIdentity.walk(CompileQueueWalk{CompileQueueIdentity.file_queue(String.lines(files), root), Nil{}, Nil{}}, root))
    CompileQueueIdentity.file_closure_record(final)

def CompileQueueIdentity.file_closure(source_root: String, files: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +root : String <- IO.try(String, CompileQueueIdentity.realpath(source_root))
    CompileQueueIdentity.file_closure_walk(root, files)

def CompileQueueIdentity.file_closure_digest(source_root: String, files: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    text : String <- IO.try(String, CompileQueueIdentity.file_closure(source_root, files))
    CompileQueueIdentity.text_digest(text)

# -------------------------------------------------------------------------
# Compiler and linker closure policy. Host primitives supply resolution,
# digests, script checks and directory listing; this module owns the wrapper
# chain, release layout and toolchain record composition.

type CompileQueueChain is Data:
  CompileQueueChain{lines: String, final: String}

def CompileQueueIdentity.absolute_target(+value: String) -> String:
  Bool.pick(String, String.starts_with(value, "/"), value, "")

def CompileQueueIdentity.exec_target_lines(lines: List<&2,String>) -> String:
  match lines:
    case Nil{}:
      ""
    case +line <> +rest:
      Bool.pick(String, String.starts_with(line, "exec \""),
        CompileQueueIdentity.absolute_target(CompileQueueIdentity.second(String.split(line, Char.from_u32(34)))),
        CompileQueueIdentity.exec_target_lines(rest))

def CompileQueueIdentity.exec_target(text: String) -> String:
  CompileQueueIdentity.exec_target_lines(String.lines(text))

def CompileQueueIdentity.chain_done(final: String, lines: String) -> IO(Result<&1,&1,U32 & String,CompileQueueChain>):
  IO.pure(Result<&1,&1,U32 & String,CompileQueueChain>, Done{CompileQueueChain{lines, final}})

# The wrapper walk is bounded to five executable hops.
@unsafe
def CompileQueueIdentity.chain_step(+resolved: String, +label: String, +steps: U32, +lines: String) -> IO(Result<&1,&1,U32 & String,CompileQueueChain>):
  do IO<Result<&1,&1,U32 & String,CompileQueueChain>>:
    script : String <- IO.try(String, CompileQueueIdentity.is_script(resolved))
    Bool.pick(IO(Result<&1,&1,U32 & String,CompileQueueChain>),
      Bool.and(String.eq(script, "1"), U32.is_lt(steps, 5)),
      do IO<Result<&1,&1,U32 & String,CompileQueueChain>>:
        text : String <- IO.try(String, T.Text.read(resolved))
        +target : String <- IO.pure(String, CompileQueueIdentity.exec_target(text))
        Bool.pick(IO(Result<&1,&1,U32 & String,CompileQueueChain>), String.is_empty(target),
          CompileQueueIdentity.chain_done(resolved, lines),
          do IO<Result<&1,&1,U32 & String,CompileQueueChain>>:
            +next : String <- IO.try(String, CompileQueueIdentity.realpath(target))
            regular : String <- IO.try(String, F.Files.regular(next))
            Bool.pick(IO(Result<&1,&1,U32 & String,CompileQueueChain>), String.eq(regular, "1"),
              do IO<Result<&1,&1,U32 & String,CompileQueueChain>>:
                next_digest : String <- IO.try(String, CompileQueueIdentity.file_digest(next))
                CompileQueueIdentity.chain_step(next, label, U32.inc(steps), lines ++ label ++ "-wrapper=" ++ next_digest ++ "\n"),
              CompileQueueIdentity.chain_done(resolved, lines))),
      CompileQueueIdentity.chain_done(resolved, lines))

def CompileQueueIdentity.chain(path: String, +label: String) -> IO(Result<&1,&1,U32 & String,CompileQueueChain>):
  do IO<Result<&1,&1,U32 & String,CompileQueueChain>>:
    +resolved : String <- IO.try(String, CompileQueueIdentity.resolve_command(path))
    digest : String <- IO.try(String, CompileQueueIdentity.file_digest(resolved))
    CompileQueueIdentity.chain_step(resolved, label, 0, label ++ "-entry=" ++ digest ++ "\n")

def CompileQueueIdentity.kind_from_fields(fields: List<&2,String>) -> String:
  match fields:
    case kind <> rest: kind
    case other: ""

def CompileQueueIdentity.observe_kind_result(observed: Result<&1,&1,U32 & String,String>) -> IO(String):
  match observed:
    case Fail{error}: IO.pure(String, "")
    case Done{record}: IO.pure(String, CompileQueueIdentity.kind_from_fields(String.split(record, Char.from_u32(9))))

def CompileQueueIdentity.observe_kind(path: String) -> IO(String):
  do IO<String>:
    observed : Result<&1,&1,U32 & String,String> <- Storage.StorageHost.observe(path)
    CompileQueueIdentity.observe_kind_result(observed)

type CompileQueueReleaseItem is Data:
  CompileQueueReleaseItem{path: String, entry: String}

type CompileQueueReleaseStep is Data:
  CompileQueueReleaseStep{items: List<&2,CompileQueueReleaseItem>, acc: List<&2,String>}

def CompileQueueIdentity.release_items(names: List<&2,String>, +directory: String, +prefix: String) -> List<&2,CompileQueueReleaseItem>:
  match names:
    case Nil{}: Nil{}
    case +name <> +rest:
      CompileQueueReleaseItem{directory ++ "/" ++ name, prefix ++ "/" ++ name} <> CompileQueueIdentity.release_items(rest, directory, prefix)

# This queue expands child directories dynamically. The host walk is finite because
# the Bend release tree contains a finite number of directory entries.
@unsafe
def CompileQueueIdentity.release_walk(+items: List<&2,CompileQueueReleaseItem>, +acc: List<&2,String>) -> IO(List<&2,String>):
  match items:
    case Nil{}: IO.pure(List<&2,String>, acc)
    case +item <> +rest:
      match item:
        case CompileQueueReleaseItem{path, entry}:
          do IO<List<&2,String>>:
            +kind : String <- CompileQueueIdentity.observe_kind(path)
            +step : CompileQueueReleaseStep <- Bool.pick(IO(CompileQueueReleaseStep), String.eq(kind, "file"),
              IO.pure(CompileQueueReleaseStep, CompileQueueReleaseStep{rest, entry <> acc}),
              Bool.pick(IO(CompileQueueReleaseStep), String.eq(kind, "dir"),
                do IO<CompileQueueReleaseStep>:
                  names : String <- IO.try(String, CompileQueueIdentity.list_dir(path))
                  children : List<&2,CompileQueueReleaseItem> <- IO.pure(List<&2,CompileQueueReleaseItem>, CompileQueueIdentity.release_items(String.lines(names), path, entry))
                  IO.pure(CompileQueueReleaseStep, CompileQueueReleaseStep{List.append(&2,CompileQueueReleaseItem,children,rest), acc}),
                IO.pure(CompileQueueReleaseStep, CompileQueueReleaseStep{rest, acc})))
            match step:
              case CompileQueueReleaseStep{next_items, next_acc}:
                CompileQueueIdentity.release_walk(next_items, next_acc))

def CompileQueueIdentity.release_entries(+root: String) -> IO(Result<&1,&1,U32 & String,List<&2,String>>):
  do IO<Result<&1,&1,U32 & String,List<&2,String>>>:
    bent : String <- IO.try(String, CompileQueueIdentity.list_dir(root ++ "/bend2"))
    items : List<&2,CompileQueueReleaseItem> <- IO.pure(List<&2,CompileQueueReleaseItem>, CompileQueueIdentity.release_items(String.lines(bent), root ++ "/bend2", "bend2"))
    +walked : List<&2,String> <- CompileQueueIdentity.release_walk(items, Nil{})
    kind : String <- CompileQueueIdentity.observe_kind(root ++ "/bin/bun")
    with_bun : List<&2,String> <- IO.pure(List<&2,String>, Bool.pick(List<&2,String>, String.eq(kind, "file"), "bin/bun" <> walked, walked))
    IO.pure(Result<&1,&1,U32 & String,List<&2,String>>, Done{CompileQueueIdentity.sort(with_bun)})

def CompileQueueIdentity.toolchain_files(+root: String, entries: List<&2,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match entries:
    case Nil{}:
      IO.pure(Result<&1,&1,U32 & String,String>, Done{""})
    case +entry <> +rest:
      do IO<Result<&1,&1,U32 & String,String>>:
        digest : String <- IO.try(String, CompileQueueIdentity.file_digest(root ++ "/" ++ entry))
        size : String <- IO.try(String, CompileQueueIdentity.file_size(root ++ "/" ++ entry))
        more : String <- IO.try(String, CompileQueueIdentity.toolchain_files(root, rest))
        IO.pure(Result<&1,&1,U32 & String,String>, Done{"toolchain-file=" ++ entry ++ " " ++ digest ++ " " ++ size ++ "\n" ++ more})

def CompileQueueIdentity.linker_lines_result(chain: CompileQueueChain) -> IO(Result<&1,&1,U32 & String,String>):
  match chain:
    case CompileQueueChain{+lines, +final}:
      IO.pure(Result<&1,&1,U32 & String,String>, Done{lines})

def CompileQueueIdentity.linker_lines(+linker: String) -> IO(Result<&1,&1,U32 & String,String>):
  Bool.pick(IO(Result<&1,&1,U32 & String,String>), String.is_empty(linker),
    IO.pure(Result<&1,&1,U32 & String,String>, Done{"linker=none\n"}),
    do IO<Result<&1,&1,U32 & String,String>>:
      chain : CompileQueueChain <- IO.try(CompileQueueChain, CompileQueueIdentity.chain(linker, "linker"))
      CompileQueueIdentity.linker_lines_result(chain))

def CompileQueueIdentity.ccache_value(tokens: List<&2,String>) -> String:
  match tokens:
    case +value <> tail: value
    case Nil{}: ""

def CompileQueueIdentity.ccache_path(tokens: List<&2,String>) -> String:
  match tokens:
    case +token <> +rest:
      Bool.pick(String, String.starts_with(token, "--ccache="),
        String.drop(token, String.length("--ccache=")),
        Bool.pick(String, String.eq(token, "--ccache"),
          CompileQueueIdentity.ccache_value(rest), CompileQueueIdentity.ccache_path(rest)))
    case Nil{}: ""

def CompileQueueIdentity.ccache_expand(+value: String, +cwd: String, +root: String, +compiler: String) -> String:
  Bool.pick(String, String.eq(value, "{compiler}"), compiler,
    Bool.pick(String, String.starts_with(value, "@root/"),
      root ++ "/" ++ String.drop(value, String.length("@root/")),
      Bool.pick(String, String.starts_with(value, "@cwd/"),
        cwd ++ "/" ++ String.drop(value, String.length("@cwd/")), value)))

def CompileQueueIdentity.ccache_lines_result(chain: CompileQueueChain) -> IO(Result<&1,&1,U32 & String,String>):
  match chain:
    case CompileQueueChain{+lines, final}:
      IO.pure(Result<&1,&1,U32 & String,String>, Done{lines})

def CompileQueueIdentity.ccache_lines(+ccache: String) -> IO(Result<&1,&1,U32 & String,String>):
  Bool.pick(IO(Result<&1,&1,U32 & String,String>), String.is_empty(ccache),
    IO.pure(Result<&1,&1,U32 & String,String>, Done{"ccache=none\n"}),
    do IO<Result<&1,&1,U32 & String,String>>:
      chain : CompileQueueChain <- IO.try(CompileQueueChain, CompileQueueIdentity.chain(ccache, "ccache"))
      CompileQueueIdentity.ccache_lines_result(chain))

def CompileQueueIdentity.toolchain_text_chain(chain: CompileQueueChain, +linker: String, +version_sha: String, +ccache_text: String) -> IO(Result<&1,&1,U32 & String,String>):
  match chain:
    case CompileQueueChain{+lines, +final}:
      parent = CompileQueueIdentity.path_dirname(final)
      +root = CompileQueueIdentity.path_dirname(parent)
      do IO<Result<&1,&1,U32 & String,String>>:
        main_kind : String <- CompileQueueIdentity.observe_kind(root ++ "/bend2/main.ts")
        bun_kind : String <- CompileQueueIdentity.observe_kind(root ++ "/bin/bun")
        Bool.pick(IO(Result<&1,&1,U32 & String,String>), Bool.and(String.eq(main_kind, "file"), String.eq(bun_kind, "file")),
          do IO<Result<&1,&1,U32 & String,String>>:
            entries : List<&2,String> <- IO.try(List<&2,String>, CompileQueueIdentity.release_entries(root))
            files : String <- IO.try(String, CompileQueueIdentity.toolchain_files(root, entries))
            linker_text : String <- IO.try(String, CompileQueueIdentity.linker_lines(linker))
            text : String <- IO.pure(String, "schema=baton-compile-queue-toolchain-v2\n" ++ lines ++ "toolchain-release=release\n" ++ files ++ linker_text ++ ccache_text ++ "compiler-version-sha=" ++ version_sha ++ "\n")
            IO.pure(Result<&1,&1,U32 & String,String>, Done{text}),
          do IO<Result<&1,&1,U32 & String,String>>:
            linker_text : String <- IO.try(String, CompileQueueIdentity.linker_lines(linker))
            text : String <- IO.pure(String, "schema=baton-compile-queue-toolchain-v2\n" ++ lines ++ "toolchain-release=executable\n" ++ linker_text ++ ccache_text ++ "compiler-version-sha=" ++ version_sha ++ "\n")
            IO.pure(Result<&1,&1,U32 & String,String>, Done{text}))

def CompileQueueIdentity.toolchain_text(+compiler: String, +linker: String, version: String, ccache: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +version_sha : String <- IO.try(String, CompileQueueIdentity.text_digest(version))
    +ccache_text : String <- IO.try(String, CompileQueueIdentity.ccache_lines(ccache))
    Bool.pick(IO(Result<&1,&1,U32 & String,String>), String.is_empty(compiler),
      do IO<Result<&1,&1,U32 & String,String>>:
        linker_text : String <- IO.try(String, CompileQueueIdentity.linker_lines(linker))
        text : String <- IO.pure(String, "schema=baton-compile-queue-toolchain-v2\ncompiler=none\n" ++ linker_text ++ ccache_text ++ "compiler-version-sha=" ++ version_sha ++ "\n")
        IO.pure(Result<&1,&1,U32 & String,String>, Done{text}),
      do IO<Result<&1,&1,U32 & String,String>>:
        chain : CompileQueueChain <- IO.try(CompileQueueChain, CompileQueueIdentity.chain(compiler, "compiler"))
        CompileQueueIdentity.toolchain_text_chain(chain, linker, version_sha, ccache_text))

def CompileQueueIdentity.compiler_closure(compiler: String, linker: String, version: String, ccache: String) -> IO(Result<&1,&1,U32 & String,String>):
  CompileQueueIdentity.toolchain_text(compiler, linker, version, ccache)

def CompileQueueIdentity.compiler_closure_digest(compiler: String, linker: String, version: String, ccache: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    text : String <- IO.try(String, CompileQueueIdentity.compiler_closure(compiler, linker, version, ccache))
    CompileQueueIdentity.text_digest(text)

def CompileQueueIdentity.material(+kind: String, +entry: String, +options: String, +source_digest: String, +file_closure_digest: String, +compiler_digest: String, +input_rows: String, +artifact_names: String, +normalized_argv: String) -> String:
  "schema=" ++ CompileQueueIdentity.schema() ++ "\n"
  ++ "kind=" ++ kind ++ "\n"
  ++ "entry=" ++ entry ++ "\n"
  ++ CompileQueueIdentity.option_lines(CompileQueueIdentity.sort(CompileQueueIdentity.nonempty(String.lines(options))))
  ++ CompileQueueIdentity.digest_lines(kind, source_digest, file_closure_digest)
  ++ "toolchain-digest=" ++ compiler_digest ++ "\n"
  ++ CompileQueueIdentity.input_lines(String.lines(input_rows))
  ++ CompileQueueIdentity.artifact_lines(String.lines(artifact_names))
  ++ CompileQueueIdentity.argv_lines(normalized_argv)

def CompileQueueIdentity.material_key(kind: String, entry: String, options: String, source_digest: String, file_closure_digest: String, compiler_digest: String, input_rows: String, artifact_names: String, normalized_argv: String) -> IO(Result<&1,&1,U32 & String,String>):
  CompileQueueIdentity.key(CompileQueueIdentity.material(kind, entry, options, source_digest, file_closure_digest, compiler_digest, input_rows, artifact_names, normalized_argv))

def CompileQueueIdentity.input_source_fields(fields: List<&2,String>) -> String:
  match fields:
    case +source <> destination <> tail: source
    case other: ""

def CompileQueueIdentity.input_source(line: String) -> String:
  CompileQueueIdentity.input_source_fields(String.split(line, Char.from_u32(9)))

def CompileQueueIdentity.input_sources_go(lines: List<&2,String>, +acc: String, first: Bool) -> String:
  match lines:
    case Nil{}: acc
    case +line <> +rest:
      +source = CompileQueueIdentity.input_source(line)
      +empty = String.is_empty(source)
      +separator = Bool.pick(String, Bool.or(empty, first), "", "\n")
      +next_acc = acc ++ separator ++ source
      +next_first = Bool.and(first, empty)
      CompileQueueIdentity.input_sources_go(rest, next_acc, next_first)

def CompileQueueIdentity.input_sources(lines: List<&2,String>) -> String:
  CompileQueueIdentity.input_sources_go(lines, "", True{})

def CompileQueueIdentity.artifact_name_fields(fields: List<&2,String>) -> String:
  match fields:
    case name <> path <> tail: name
    case other: ""

def CompileQueueIdentity.artifact_name(line: String) -> String:
  CompileQueueIdentity.artifact_name_fields(String.split(line, Char.from_u32(9)))

def CompileQueueIdentity.artifact_names(lines: List<&2,String>) -> String:
  match lines:
    case Nil{}:
      ""
    case +line <> +rest:
      +name = CompileQueueIdentity.artifact_name(line)
      +tail = CompileQueueIdentity.artifact_names(rest)
      Bool.pick(String, String.is_empty(name), tail, name ++ "\n" ++ tail)

def CompileQueueIdentity.input_row_fields(fields: List<&2,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match fields:
    case +source <> destination <> tail:
      do IO<Result<&1,&1,U32 & String,String>>:
        digest : String <- IO.try(String, CompileQueueIdentity.file_digest(source))
        size : String <- IO.try(String, CompileQueueIdentity.file_size(source))
        IO.pure(Result<&1,&1,U32 & String,String>, Done{destination ++ "\t" ++ digest ++ "\t" ++ size})
    case other: IO.pure(Result<&1,&1,U32 & String,String>, Done{""})

def CompileQueueIdentity.input_row(line: String) -> IO(Result<&1,&1,U32 & String,String>):
  CompileQueueIdentity.input_row_fields(String.split(line, Char.from_u32(9)))

def CompileQueueIdentity.input_rows(lines: List<&2,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match lines:
    case Nil{}:
      IO.pure(Result<&1,&1,U32 & String,String>, Done{""})
    case +line <> +rest:
      +more : String <- IO.try(String, CompileQueueIdentity.input_rows(rest))
      Bool.pick(IO(Result<&1,&1,U32 & String,String>), String.is_empty(line),
        IO.pure(Result<&1,&1,U32 & String,String>, Done{more}),
        do IO<Result<&1,&1,U32 & String,String>>:
          +row : String <- IO.try(String, CompileQueueIdentity.input_row(line))
          IO.pure(Result<&1,&1,U32 & String,String>, Done{Bool.pick(String, String.is_empty(row), "", row ++ "\n") ++ more}))

# Inputs and aux are separate newline-separated lists. Join them with one
# newline only when both sides carry entries, so a path is never concatenated
# with the first aux entry.
def CompileQueueIdentity.closure_files(sources: String, aux: String) -> String:
  Bool.pick(String, String.is_empty(sources), aux,
    Bool.pick(String, String.is_empty(aux), sources, sources ++ "\n" ++ aux))

# Encodings are the ones documented above. Inputs and aux are read as given;
# cwd and root are accepted for policy compatibility. The command tokens are
# already normalized to @root/@cwd, {in:...}, {out:...} and {compiler}.
def CompileQueueIdentity.request_key(+kind: String, +cwd: String, +root: String, +source_root: String, +entry: String, +compiler: String, +linker: String, +version: String, +inputs: String, +aux: String, +artifacts: String, +options: String, +command: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +closure : String <- Bool.pick(IO(String), String.eq(kind, "cgen"),
      IO.try(String, CompileQueueIdentity.source_digest(source_root, entry)),
      IO.try(String, CompileQueueIdentity.file_closure_digest(source_root, CompileQueueIdentity.closure_files(CompileQueueIdentity.input_sources(String.lines(inputs)), aux))))
    +ccache : String <- IO.pure(String, CompileQueueIdentity.ccache_expand(CompileQueueIdentity.ccache_path(String.lines(command)), cwd, root, compiler))
    toolchain : String <- IO.try(String, CompileQueueIdentity.compiler_closure_digest(compiler, linker, version, ccache))
    rows : String <- IO.try(String, CompileQueueIdentity.input_rows(String.lines(inputs)))
    CompileQueueIdentity.material_key(kind, entry, options,
      Bool.pick(String, String.eq(kind, "cgen"), closure, ""),
      Bool.pick(String, String.eq(kind, "cgen"), "", closure),
      toolchain, rows,
      CompileQueueIdentity.artifact_names(String.lines(artifacts)), command)
