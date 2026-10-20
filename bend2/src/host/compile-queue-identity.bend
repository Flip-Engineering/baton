import Base
import ./text.bend as T
import ./files.bend as F
import ./storage.bend as Storage

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
# cli_build coverage (bend2/compiler/upstream/main.ts:351-373):
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
# A cc command may name a ccache executable as `--ccache <path>` or
# `--ccache=<path>`; build-native appends the optional BATON2_CCACHE value in
# the first form. The command is normalized before identity reads it, so the
# path may arrive as `@root/...`, `@cwd/...` or `{compiler}`; identity restores
# the caller path, follows the wrapper exec chain, and records the entry and
# each exec target digest in the toolchain text. The absolute path stays out of
# the key. ccache configuration (CCACHE_* environment and ccache.conf) is not
# visible to the queue; a caller that needs it in the key supplies the captured
# text as an `--option`, which material sorts and hashes, or passes the config
# file as `--aux`, which the cc file closure hashes.
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
    case value <> rest:
      Bool.pick(List<&2,String>, String.is_empty(value), CompileQueueIdentity.nonempty(rest), value <> CompileQueueIdentity.nonempty(rest))

def CompileQueueIdentity.insert(value: String, sorted: List<&2,String>) -> List<&2,String>:
  match sorted:
    case Nil{}:
      [value]
    case head <> tail:
      Bool.pick(List<&2,String>, String.is_lt(value, head), value <> sorted, head <> CompileQueueIdentity.insert(value, tail))

def CompileQueueIdentity.sort(values: List<&2,String>) -> List<&2,String>:
  match values:
    case Nil{}:
      Nil{}
    case value <> rest:
      CompileQueueIdentity.insert(value, CompileQueueIdentity.sort(rest))

def CompileQueueIdentity.option_lines(values: List<&2,String>) -> String:
  match values:
    case Nil{}:
      ""
    case value <> rest:
      "option=" ++ value ++ "\n" ++ CompileQueueIdentity.option_lines(rest)

def CompileQueueIdentity.input_lines(rows: List<&2,String>) -> String:
  match rows:
    case Nil{}:
      ""
    case row <> rest:
      Bool.pick(String, String.is_empty(row), CompileQueueIdentity.input_lines(rest), "input=" ++ row ++ "\n" ++ CompileQueueIdentity.input_lines(rest))

def CompileQueueIdentity.artifact_lines(names: List<&2,String>) -> String:
  match names:
    case Nil{}:
      ""
    case name <> rest:
      Bool.pick(String, String.is_empty(name), CompileQueueIdentity.artifact_lines(rest), "artifact-name=" ++ name ++ "\n" ++ CompileQueueIdentity.artifact_lines(rest))

def CompileQueueIdentity.argv_terminated(tokens: List<&2,String>) -> String:
  match tokens:
    case Nil{}:
      ""
    case token <> Nil{}:
      ""
    case token <> rest:
      "argv=" ++ token ++ "\n" ++ CompileQueueIdentity.argv_terminated(rest)

def CompileQueueIdentity.argv_plain(tokens: List<&2,String>) -> String:
  match tokens:
    case Nil{}:
      ""
    case token <> rest:
      "argv=" ++ token ++ "\n" ++ CompileQueueIdentity.argv_plain(rest)

def CompileQueueIdentity.argv_lines(tokens: String) -> String:
  Bool.pick(String, String.is_empty(tokens), "",
    Bool.pick(String, String.ends_with(tokens, "\n"),
      CompileQueueIdentity.argv_terminated(String.lines(tokens)),
      CompileQueueIdentity.argv_plain(String.lines(tokens))))

def CompileQueueIdentity.digest_lines(kind: String, source_digest: String, file_closure_digest: String) -> String:
  Bool.pick(String, String.eq(kind, "cgen"), "source-digest=" ++ source_digest ++ "\n", "file-digest=" ++ file_closure_digest ++ "\n")

# -------------------------------------------------------------------------
# Source closure policy. The C binding supplies host primitives (realpath,
# file_digest, file_size, Text.read); this module owns import/include parsing,
# closure membership, root-relative validation and record order.

type CompileQueueWalk is Data:
  CompileQueueWalk{queue: List<String>, visited: List<String>, records: List<String>}

def CompileQueueIdentity.path_drop_last(parts: List<&2,String>) -> List<&2,String>:
  match parts:
    case Nil{}:
      Nil{}
    case part <> Nil{}:
      Nil{}
    case part <> rest:
      part <> CompileQueueIdentity.path_drop_last(rest)

def CompileQueueIdentity.path_last(parts: List<&2,String>, current: String) -> String:
  match parts:
    case Nil{}:
      current
    case part <> rest:
      Bool.pick(String, String.is_empty(part), CompileQueueIdentity.path_last(rest, current), CompileQueueIdentity.path_last(rest, part))

def CompileQueueIdentity.path_basename(path: String) -> String:
  CompileQueueIdentity.path_last(String.split(path, Char.from_u32(47)), "")

def CompileQueueIdentity.path_dirname(path: String) -> String:
  parts = CompileQueueIdentity.path_drop_last(String.split(path, Char.from_u32(47)))
  joined = String.join(parts, "/")
  Bool.pick(String, String.is_empty(joined), Bool.pick(String, String.starts_with(path, "/"), "/", "."), joined)

def CompileQueueIdentity.path_join(directory: String, name: String) -> String:
  Bool.pick(String, String.eq(directory, "."), name, directory ++ "/" ++ name)

def CompileQueueIdentity.path_inside(root: String, path: String) -> Bool:
  Bool.or(String.eq(root, path), String.starts_with(path, root ++ "/"))

def CompileQueueIdentity.path_relative(root: String, path: String) -> String:
  String.drop(path, Nat.add(String.length(root), 1n))

def CompileQueueIdentity.path_absolute(path: String) -> Bool:
  String.starts_with(path, "/")

def CompileQueueIdentity.list_contains(values: List<&2,String>, value: String) -> Bool:
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

def CompileQueueIdentity.first_token(value: String) -> String:
  match String.split(value, Char.from_u32(32)):
    case first <> rest:
      match String.split(first, Char.from_u32(9)):
        case token <> tail:
          token
        case other:
          ""
    case other:
      ""

def CompileQueueIdentity.bend_import_value(trimmed: String, original: String) -> String:
  rest = String.drop(trimmed, 7)
  Bool.pick(String, String.starts_with(rest, "\""),
    CompileQueueIdentity.second(String.split(rest, Char.from_u32(34))),
    Bool.pick(String, String.eq(trimmed, original), CompileQueueIdentity.first_token(rest), ""))

def CompileQueueIdentity.bend_import_target(line: String) -> String:
  trimmed = String.trim_start(line)
  Bool.pick(String, String.starts_with(trimmed, "import "),
    CompileQueueIdentity.bend_import_value(trimmed, line),
    "")

def CompileQueueIdentity.bend_targets(lines: List<&2,String>) -> List<&2,String>:
  match lines:
    case Nil{}:
      Nil{}
    case line <> rest:
      target = CompileQueueIdentity.bend_import_target(line)
      Bool.pick(List<&2,String>, String.is_empty(target), CompileQueueIdentity.bend_targets(rest),
        Bool.pick(List<&2,String>, String.eq(target, "Base"), CompileQueueIdentity.bend_targets(rest),
          target <> CompileQueueIdentity.bend_targets(rest)))

def CompileQueueIdentity.c_include_target(line: String) -> String:
  trimmed = String.trim_start(line)
  Bool.pick(String, String.starts_with(trimmed, "#include \""),
    CompileQueueIdentity.second(String.split(trimmed, Char.from_u32(34))),
    "")

def CompileQueueIdentity.c_targets(lines: List<&2,String>) -> List<&2,String>:
  match lines:
    case Nil{}:
      Nil{}
    case line <> rest:
      target = CompileQueueIdentity.c_include_target(line)
      Bool.pick(List<&2,String>, String.is_empty(target), CompileQueueIdentity.c_targets(rest),
        target <> CompileQueueIdentity.c_targets(rest))

def CompileQueueIdentity.closure_targets(path: String, text: String) -> List<&2,String>:
  name = String.to_lower(CompileQueueIdentity.path_basename(path))
  Bool.pick(List<&2,String>, String.ends_with(name, ".bend"),
    CompileQueueIdentity.bend_targets(String.lines(text)),
    Bool.pick(List<&2,String>, Bool.or(String.ends_with(name, ".c"), String.ends_with(name, ".h")),
      CompileQueueIdentity.c_targets(String.lines(text)),
      Nil{}))

def CompileQueueIdentity.enqueue_targets(importer: String, targets: List<&2,String>, queue: List<&2,String>) -> List<&2,String>:
  match targets:
    case Nil{}:
      queue
    case target <> rest:
      next = Bool.pick(String, CompileQueueIdentity.path_absolute(target),
        "!absolute:" ++ target,
        CompileQueueIdentity.path_join(CompileQueueIdentity.path_dirname(importer), target))
      CompileQueueIdentity.enqueue_targets(importer, rest, next <> queue)

def CompileQueueIdentity.walk(state: CompileQueueWalk, root: String) -> IO(Result<&1,&1,U32 & String,CompileQueueWalk>):
  match state:
    case CompileQueueWalk{queue, visited, records}:
      match queue:
        case Nil{}:
          IO.pure(Result<&1,&1,U32 & String,CompileQueueWalk>, Done{state})
        case head <> rest:
          Bool.pick(IO<Result<&1,&1,U32 & String,CompileQueueWalk>>, String.starts_with(head, "!absolute:"),
            IO.pure(Result<&1,&1,U32 & String,CompileQueueWalk>, Fail{(1u32, "absolute import")}),
            do IO<Result<&1,&1,U32 & String,CompileQueueWalk>>:
              resolved : String <- IO.try(String, CompileQueueIdentity.realpath(head))
              Bool.pick(IO<Result<&1,&1,U32 & String,CompileQueueWalk>>, CompileQueueIdentity.path_inside(root, resolved),
                Bool.pick(IO<Result<&1,&1,U32 & String,CompileQueueWalk>>, CompileQueueIdentity.list_contains(visited, resolved),
                  CompileQueueIdentity.walk(CompileQueueWalk{rest, visited, records}, root),
                  do IO<Result<&1,&1,U32 & String,CompileQueueWalk>>:
                    text : String <- IO.try(String, T.Text.read(resolved))
                    digest : String <- IO.try(String, CompileQueueIdentity.file_digest(resolved))
                    size : String <- IO.try(String, CompileQueueIdentity.file_size(resolved))
                    record = CompileQueueIdentity.path_relative(root, resolved) ++ "\t" ++ digest ++ "\t" ++ size
                    targets = CompileQueueIdentity.closure_targets(resolved, text)
                    next_queue = CompileQueueIdentity.enqueue_targets(resolved, targets, rest)
                    CompileQueueIdentity.walk(CompileQueueWalk{next_queue, resolved <> visited, record <> records}, root)),
                IO.pure(Result<&1,&1,U32 & String,CompileQueueWalk>, Fail{(1u32, "source path outside root")})))

def CompileQueueIdentity.source_lines(records: List<&2,String>) -> String:
  match records:
    case Nil{}:
      ""
    case record <> rest:
      "source-file=" ++ record ++ "\n" ++ CompileQueueIdentity.source_lines(rest)

def CompileQueueIdentity.source_closure(source_root: String, entry: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    root : String <- IO.try(String, CompileQueueIdentity.realpath(source_root))
    entry_path = Bool.pick(String, CompileQueueIdentity.path_absolute(entry), entry, root ++ "/" ++ entry)
    resolved : String <- IO.try(String, CompileQueueIdentity.realpath(entry_path))
    Bool.pick(IO<Result<&1,&1,U32 & String,String>>, CompileQueueIdentity.path_inside(root, resolved),
      do IO<Result<&1,&1,U32 & String,String>>:
        final : CompileQueueWalk <- IO.try(CompileQueueWalk, CompileQueueIdentity.walk(CompileQueueWalk{[resolved], Nil{}, Nil{}}, root))
        match final:
          case CompileQueueWalk{queue, visited, records}:
            text = "schema=baton-compile-queue-source-v2\nsource-entry=" ++ CompileQueueIdentity.path_relative(root, resolved) ++ "\n" ++ CompileQueueIdentity.source_lines(CompileQueueIdentity.sort(records))
            IO.pure(Result<&1,&1,U32 & String,String>, Done{text}),
      IO.pure(Result<&1,&1,U32 & String,String>, Fail{(1u32, "entry outside root")}))

def CompileQueueIdentity.source_digest(source_root: String, entry: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    text : String <- IO.try(String, CompileQueueIdentity.source_closure(source_root, entry))
    CompileQueueIdentity.text_digest(text)

def CompileQueueIdentity.file_queue(names: List<&2,String>, root: String) -> List<&2,String>:
  match names:
    case Nil{}:
      Nil{}
    case name <> rest:
      Bool.pick(List<&2,String>, String.is_empty(name), CompileQueueIdentity.file_queue(rest, root),
        Bool.pick(String, CompileQueueIdentity.path_absolute(name), name, root ++ "/" ++ name) <> CompileQueueIdentity.file_queue(rest, root))

def CompileQueueIdentity.file_closure(source_root: String, files: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    root : String <- IO.try(String, CompileQueueIdentity.realpath(source_root))
    final : CompileQueueWalk <- IO.try(CompileQueueWalk, CompileQueueIdentity.walk(CompileQueueWalk{CompileQueueIdentity.file_queue(String.lines(files), root), Nil{}, Nil{}}, root))
    match final:
      case CompileQueueWalk{queue, visited, records}:
        text = "schema=baton-compile-queue-source-v2\n" ++ CompileQueueIdentity.source_lines(CompileQueueIdentity.sort(records))
        IO.pure(Result<&1,&1,U32 & String,String>, Done{text})

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

def CompileQueueIdentity.absolute_target(value: String) -> String:
  Bool.pick(String, String.starts_with(value, "/"), value, "")

def CompileQueueIdentity.exec_target_lines(lines: List<&2,String>) -> String:
  match lines:
    case Nil{}:
      ""
    case line <> rest:
      Bool.pick(String, String.starts_with(line, "exec \""),
        CompileQueueIdentity.absolute_target(CompileQueueIdentity.second(String.split(line, Char.from_u32(34)))),
        CompileQueueIdentity.exec_target_lines(rest))

def CompileQueueIdentity.exec_target(text: String) -> String:
  CompileQueueIdentity.exec_target_lines(String.lines(text))

def CompileQueueIdentity.chain_done(final: String, lines: String) -> IO(Result<&1,&1,U32 & String,CompileQueueChain>):
  IO.pure(Result<&1,&1,U32 & String,CompileQueueChain>, Done{CompileQueueChain{lines, final}})

def CompileQueueIdentity.chain_step(resolved: String, label: String, steps: U32, lines: String) -> IO(Result<&1,&1,U32 & String,CompileQueueChain>):
  do IO<Result<&1,&1,U32 & String,CompileQueueChain>>:
    script : String <- IO.try(String, CompileQueueIdentity.is_script(resolved))
    Bool.pick(IO<Result<&1,&1,U32 & String,CompileQueueChain>>,
      Bool.and(String.eq(script, "1"), U32.is_lt(steps, 5)),
      do IO<Result<&1,&1,U32 & String,CompileQueueChain>>:
        text : String <- IO.try(String, T.Text.read(resolved))
        target = CompileQueueIdentity.exec_target(text)
        Bool.pick(IO<Result<&1,&1,U32 & String,CompileQueueChain>>, String.is_empty(target),
          CompileQueueIdentity.chain_done(resolved, lines),
          do IO<Result<&1,&1,U32 & String,CompileQueueChain>>:
            next : String <- IO.try(String, CompileQueueIdentity.realpath(target))
            regular : String <- IO.try(String, F.Files.regular(next))
            Bool.pick(IO<Result<&1,&1,U32 & String,CompileQueueChain>>, String.eq(regular, "1"),
              do IO<Result<&1,&1,U32 & String,CompileQueueChain>>:
                next_digest : String <- IO.try(String, CompileQueueIdentity.file_digest(next))
                CompileQueueIdentity.chain_step(next, label, U32.inc(steps), lines ++ label ++ "-wrapper=" ++ next_digest ++ "\n"),
              CompileQueueIdentity.chain_done(resolved, lines))),
      CompileQueueIdentity.chain_done(resolved, lines))

def CompileQueueIdentity.chain(path: String, label: String) -> IO(Result<&1,&1,U32 & String,CompileQueueChain>):
  do IO<Result<&1,&1,U32 & String,CompileQueueChain>>:
    resolved : String <- IO.try(String, CompileQueueIdentity.resolve_command(path))
    digest : String <- IO.try(String, CompileQueueIdentity.file_digest(resolved))
    CompileQueueIdentity.chain_step(resolved, label, 0, label ++ "-entry=" ++ digest ++ "\n")

def CompileQueueIdentity.observe_kind(path: String) -> IO(String):
  do IO<String>:
    observed : Result<&1,&1,U32 & String,String> <- Storage.StorageHost.observe(path)
    match observed:
      case Fail{error}:
        IO.pure(String, "")
      case Done{record}:
        match String.split(record, Char.from_u32(9)):
          case kind <> rest:
            IO.pure(String, kind)
          case other:
            IO.pure(String, "")

def CompileQueueIdentity.release_walk(names: List<&2,String>, directory: String, prefix: String, acc: List<&2,String>) -> IO(List<&2,String>):
  match names:
    case Nil{}:
      IO.pure(List<&2,String>, acc)
    case name <> rest:
      Bool.pick(IO(List<&2,String>), String.is_empty(name), CompileQueueIdentity.release_walk(rest, directory, prefix, acc),
        do IO(List<&2,String>):
          child = directory ++ "/" ++ name
          entry = prefix ++ "/" ++ name
          kind : String <- CompileQueueIdentity.observe_kind(child)
          Bool.pick(IO(List<&2,String>), String.eq(kind, "file"),
            CompileQueueIdentity.release_walk(rest, directory, prefix, entry <> acc),
            Bool.pick(IO(List<&2,String>), String.eq(kind, "dir"),
              do IO(List<&2,String>):
                listed : Result<&1,&1,U32 & String,String> <- CompileQueueIdentity.list_dir(child)
                match listed:
                  case Fail{error}:
                    CompileQueueIdentity.release_walk(rest, directory, prefix, acc)
                  case Done{names}:
                    deeper <- CompileQueueIdentity.release_walk(String.lines(names), child, entry, acc)
                    CompileQueueIdentity.release_walk(rest, directory, prefix, deeper),
              CompileQueueIdentity.release_walk(rest, directory, prefix, acc))))

def CompileQueueIdentity.release_entries(root: String) -> IO(Result<&1,&1,U32 & String,List<&2,String>>):
  do IO<Result<&1,&1,U32 & String,List<&2,String>>>:
    bent : String <- IO.try(String, CompileQueueIdentity.list_dir(root ++ "/bend2"))
    walked : List<&2,String> <- CompileQueueIdentity.release_walk(String.lines(bent), root ++ "/bend2", "bend2", Nil{})
    kind : String <- CompileQueueIdentity.observe_kind(root ++ "/bin/bun")
    with_bun = Bool.pick(List<&2,String>, String.eq(kind, "file"), "bin/bun" <> walked, walked)
    IO.pure(Result<&1,&1,U32 & String,List<&2,String>>, Done{CompileQueueIdentity.sort(with_bun)})

def CompileQueueIdentity.toolchain_files(root: String, entries: List<&2,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match entries:
    case Nil{}:
      IO.pure(Result<&1,&1,U32 & String,String>, Done{""})
    case entry <> rest:
      do IO<Result<&1,&1,U32 & String,String>>:
        digest : String <- IO.try(String, CompileQueueIdentity.file_digest(root ++ "/" ++ entry))
        size : String <- IO.try(String, CompileQueueIdentity.file_size(root ++ "/" ++ entry))
        more : String <- IO.try(String, CompileQueueIdentity.toolchain_files(root, rest))
        IO.pure(Result<&1,&1,U32 & String,String>, Done{"toolchain-file=" ++ entry ++ " " ++ digest ++ " " ++ size ++ "\n" ++ more})

def CompileQueueIdentity.linker_lines(linker: String) -> IO(Result<&1,&1,U32 & String,String>):
  Bool.pick(IO(Result<&1,&1,U32 & String,String>), String.is_empty(linker),
    IO.pure(Result<&1,&1,U32 & String,String>, Done{"linker=none\n"}),
    do IO<Result<&1,&1,U32 & String,String>>:
      chain : CompileQueueChain <- IO.try(CompileQueueChain, CompileQueueIdentity.chain(linker, "linker"))
      match chain:
        case CompileQueueChain{lines, final}:
          IO.pure(Result<&1,&1,U32 & String,String>, Done{lines}))

# A cc command may name a ccache executable as `--ccache <path>` or
# `--ccache=<path>`. The command is already normalized, so a path under the
# root or cwd arrives as `@root/...` or `@cwd/...`; `{compiler}` names the
# compiler. Identity restores the caller's path for resolution, follows the
# wrapper exec chain, and records the entry and each exec target digest. The
# absolute path is transient input and never enters the key.
def CompileQueueIdentity.ccache_value(tokens: List<&2,String>) -> String:
  match tokens:
    case value <> tail:
      value
    case Nil{}:
      ""

def CompileQueueIdentity.ccache_path(tokens: List<&2,String>) -> String:
  match tokens:
    case token <> rest:
      Bool.pick(String, String.starts_with(token, "--ccache="),
        String.drop(token, String.length("--ccache=")),
        Bool.pick(String, String.eq(token, "--ccache"),
          CompileQueueIdentity.ccache_value(rest),
          CompileQueueIdentity.ccache_path(rest)))
    case Nil{}:
      ""

def CompileQueueIdentity.ccache_expand(value: String, cwd: String, root: String, compiler: String) -> String:
  Bool.pick(String, String.eq(value, "{compiler}"), compiler,
    Bool.pick(String, String.starts_with(value, "@root/"),
      root ++ "/" ++ String.drop(value, String.length("@root/")),
      Bool.pick(String, String.starts_with(value, "@cwd/"),
        cwd ++ "/" ++ String.drop(value, String.length("@cwd/")),
        value)))

def CompileQueueIdentity.ccache_lines(ccache: String) -> IO(Result<&1,&1,U32 & String,String>):
  Bool.pick(IO(Result<&1,&1,U32 & String,String>), String.is_empty(ccache),
    IO.pure(Result<&1,&1,U32 & String,String>, Done{"ccache=none\n"}),
    do IO<Result<&1,&1,U32 & String,String>>:
      chain : CompileQueueChain <- IO.try(CompileQueueChain, CompileQueueIdentity.chain(ccache, "ccache"))
      match chain:
        case CompileQueueChain{lines, final}:
          IO.pure(Result<&1,&1,U32 & String,String>, Done{lines}))

def CompileQueueIdentity.toolchain_text(compiler: String, linker: String, version: String, ccache: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    version_sha : String <- IO.try(String, CompileQueueIdentity.text_digest(version))
    ccache_text : String <- IO.try(String, CompileQueueIdentity.ccache_lines(ccache))
    Bool.pick(IO<Result<&1,&1,U32 & String,String>>, String.is_empty(compiler),
      do IO<Result<&1,&1,U32 & String,String>>:
        linker_text : String <- IO.try(String, CompileQueueIdentity.linker_lines(linker))
        text = "schema=baton-compile-queue-toolchain-v2\ncompiler=none\n" ++ linker_text ++ ccache_text ++ "compiler-version-sha=" ++ version_sha ++ "\n"
        IO.pure(Result<&1,&1,U32 & String,String>, Done{text}),
      do IO<Result<&1,&1,U32 & String,String>>:
        chain : CompileQueueChain <- IO.try(CompileQueueChain, CompileQueueIdentity.chain(compiler, "compiler"))
        match chain:
          case CompileQueueChain{lines, final}:
            parent = CompileQueueIdentity.path_dirname(final)
            root = CompileQueueIdentity.path_dirname(parent)
            main_kind : String <- CompileQueueIdentity.observe_kind(root ++ "/bend2/main.ts")
            bun_kind : String <- CompileQueueIdentity.observe_kind(root ++ "/bin/bun")
            Bool.pick(IO<Result<&1,&1,U32 & String,String>>,
              Bool.and(String.eq(main_kind, "file"), String.eq(bun_kind, "file")),
              do IO<Result<&1,&1,U32 & String,String>>:
                entries : List<&2,String> <- IO.try(List<&2,String>, CompileQueueIdentity.release_entries(root))
                files : String <- IO.try(String, CompileQueueIdentity.toolchain_files(root, entries))
                linker_text : String <- IO.try(String, CompileQueueIdentity.linker_lines(linker))
                text = "schema=baton-compile-queue-toolchain-v2\n" ++ lines ++ "toolchain-release=release\n" ++ files ++ linker_text ++ ccache_text ++ "compiler-version-sha=" ++ version_sha ++ "\n"
                IO.pure(Result<&1,&1,U32 & String,String>, Done{text}),
              do IO<Result<&1,&1,U32 & String,String>>:
                linker_text : String <- IO.try(String, CompileQueueIdentity.linker_lines(linker))
                text = "schema=baton-compile-queue-toolchain-v2\n" ++ lines ++ "toolchain-release=executable\n" ++ linker_text ++ ccache_text ++ "compiler-version-sha=" ++ version_sha ++ "\n"
                IO.pure(Result<&1,&1,U32 & String,String>, Done{text}))))

# `version` is the captured compiler --version text, or empty when the caller
# could not collect it. The closure records its SHA-256 and therefore changes
# whenever the visible compiler version text changes.
def CompileQueueIdentity.compiler_closure(compiler: String, linker: String, version: String, ccache: String) -> IO(Result<&1,&1,U32 & String,String>):
  CompileQueueIdentity.toolchain_text(compiler, linker, version, ccache)

def CompileQueueIdentity.compiler_closure_digest(compiler: String, linker: String, version: String, ccache: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    text : String <- IO.try(String, CompileQueueIdentity.compiler_closure(compiler, linker, version, ccache))
    CompileQueueIdentity.text_digest(text)

def CompileQueueIdentity.material(kind: String, entry: String, options: String, source_digest: String, file_closure_digest: String, compiler_digest: String, input_rows: String, artifact_names: String, normalized_argv: String) -> String:
  "schema=" ++ CompileQueueIdentity.schema() ++ "\n"
  ++ "kind=" ++ kind ++ "\n"
  ++ "entry=" ++ entry ++ "\n"
  ++ CompileQueueIdentity.option_lines(CompileQueueIdentity.sort(CompileQueueIdentity.nonempty(String.lines(options))))
  ++ CompileQueueIdentity.digest_lines(kind, source_digest, file_closure_digest)
  ++ "toolchain-digest=" ++ compiler_digest ++ "\n"
  ++ CompileQueueIdentity.input_lines(String.lines(input_rows))
  ++ CompileQueueIdentity.artifact_lines(String.lines(artifact_names))
  ++ CompileQueueIdentity.argv_lines(String.lines(normalized_argv))

def CompileQueueIdentity.material_key(kind: String, entry: String, options: String, source_digest: String, file_closure_digest: String, compiler_digest: String, input_rows: String, artifact_names: String, normalized_argv: String) -> IO(Result<&1,&1,U32 & String,String>):
  CompileQueueIdentity.key(CompileQueueIdentity.material(kind, entry, options, source_digest, file_closure_digest, compiler_digest, input_rows, artifact_names, normalized_argv))

def CompileQueueIdentity.input_source(line: String) -> String:
  match String.split(line, Char.from_u32(9)):
    case source <> destination <> tail:
      source
    case other:
      ""

def CompileQueueIdentity.input_sources(lines: List<&2,String>) -> String:
  match lines:
    case Nil{}:
      ""
    case line <> rest:
      source = CompileQueueIdentity.input_source(line)
      Bool.pick(String, String.is_empty(source), CompileQueueIdentity.input_sources(rest), source ++ "\n" ++ CompileQueueIdentity.input_sources(rest))

def CompileQueueIdentity.artifact_name(line: String) -> String:
  match String.split(line, Char.from_u32(9)):
    case name <> path <> tail:
      name
    case other:
      ""

def CompileQueueIdentity.artifact_names(lines: List<&2,String>) -> String:
  match lines:
    case Nil{}:
      ""
    case line <> rest:
      name = CompileQueueIdentity.artifact_name(line)
      Bool.pick(String, String.is_empty(name), CompileQueueIdentity.artifact_names(rest), name ++ "\n" ++ CompileQueueIdentity.artifact_names(rest))

def CompileQueueIdentity.input_row(line: String) -> IO(Result<&1,&1,U32 & String,String>):
  match String.split(line, Char.from_u32(9)):
    case source <> destination <> tail:
      do IO<Result<&1,&1,U32 & String,String>>:
        digest : String <- IO.try(String, CompileQueueIdentity.file_digest(source))
        size : String <- IO.try(String, CompileQueueIdentity.file_size(source))
        IO.pure(Result<&1,&1,U32 & String,String>, Done{destination ++ "\t" ++ digest ++ "\t" ++ size})
    case other:
      IO.pure(Result<&1,&1,U32 & String,String>, Done{""})

def CompileQueueIdentity.input_rows(lines: List<&2,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match lines:
    case Nil{}:
      IO.pure(Result<&1,&1,U32 & String,String>, Done{""})
    case line <> rest:
      Bool.pick(IO(Result<&1,&1,U32 & String,String>), String.is_empty(line), CompileQueueIdentity.input_rows(rest),
        do IO<Result<&1,&1,U32 & String,String>>:
          row : String <- IO.try(String, CompileQueueIdentity.input_row(line))
          more : String <- IO.try(String, CompileQueueIdentity.input_rows(rest))
          IO.pure(Result<&1,&1,U32 & String,String>, Done{Bool.pick(String, String.is_empty(row), "", row ++ "\n") ++ more}))

# Encodings are the ones documented above. Inputs and aux are read as given;
# cwd and root are accepted for policy compatibility. The command tokens are
# already normalized to @root/@cwd, {in:...}, {out:...} and {compiler}.
def CompileQueueIdentity.request_key(kind: String, cwd: String, root: String, source_root: String, entry: String, compiler: String, linker: String, version: String, inputs: String, aux: String, artifacts: String, options: String, command: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    closure : String <- Bool.pick(IO(String), String.eq(kind, "cgen"),
      IO.try(String, CompileQueueIdentity.source_digest(source_root, entry)),
      IO.try(String, CompileQueueIdentity.file_closure_digest(source_root, CompileQueueIdentity.input_sources(String.lines(inputs)) ++ aux)))
    +ccache = CompileQueueIdentity.ccache_expand(CompileQueueIdentity.ccache_path(String.lines(command)), cwd, root, compiler)
    toolchain : String <- IO.try(String, CompileQueueIdentity.compiler_closure_digest(compiler, linker, version, ccache))
    rows : String <- IO.try(String, CompileQueueIdentity.input_rows(String.lines(inputs)))
    CompileQueueIdentity.material_key(kind, entry, options,
      Bool.pick(String, String.eq(kind, "cgen"), closure, ""),
      Bool.pick(String, String.eq(kind, "cgen"), "", closure),
      toolchain, rows,
      CompileQueueIdentity.artifact_names(String.lines(artifacts)), command)
