import Base

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
#   normalized_argv     newline-terminated tokens, already normalized to
#                       {in:<destination>}, {out:<name>} and {compiler};
#                       an empty string means no tokens, and the final empty
#                       line is the terminator (so an empty token is a blank
#                       line before it)
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

def CompileQueueIdentity.source_closure(source_root: String, entry: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-digest.c"

def CompileQueueIdentity.source_digest(source_root: String, entry: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-digest.c"

# `files` is one path per line. The caller passes the generated C,
# native-entry.c, helper scripts and other explicit cc inputs. Relative names
# resolve under source_root; absolute names must still be inside it.
def CompileQueueIdentity.file_closure(source_root: String, files: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-digest.c"

def CompileQueueIdentity.file_closure_digest(source_root: String, files: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-digest.c"

# `version` is the captured compiler --version text, or empty when the caller
# could not collect it. The closure records its SHA-256 and therefore changes
# whenever the visible compiler version text changes.
def CompileQueueIdentity.compiler_closure(compiler: String, linker: String, version: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-digest.c"

def CompileQueueIdentity.compiler_closure_digest(compiler: String, linker: String, version: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-digest.c"

def CompileQueueIdentity.file_digest(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-digest.c"

def CompileQueueIdentity.file_size(path: String) -> IO(Result<&1,&1,U32 & String,String>):
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

def CompileQueueIdentity.argv_tokens(tokens: List<&2,String>) -> String:
  match tokens:
    case Nil{}:
      ""
    case token <> Nil{}:
      ""
    case token <> rest:
      "argv=" ++ token ++ "\n" ++ CompileQueueIdentity.argv_tokens(rest)

def CompileQueueIdentity.argv_lines(tokens: String) -> String:
  Bool.pick(String, String.is_empty(tokens), "", CompileQueueIdentity.argv_tokens(String.lines(tokens)))

def CompileQueueIdentity.digest_lines(kind: String, source_digest: String, file_closure_digest: String) -> String:
  Bool.pick(String, String.eq(kind, "cgen"), "source-digest=" ++ source_digest ++ "\n", "file-digest=" ++ file_closure_digest ++ "\n")

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
    toolchain : String <- IO.try(String, CompileQueueIdentity.compiler_closure_digest(compiler, linker, version))
    rows : String <- IO.try(String, CompileQueueIdentity.input_rows(String.lines(inputs)))
    CompileQueueIdentity.material_key(kind, entry, options,
      Bool.pick(String, String.eq(kind, "cgen"), closure, ""),
      Bool.pick(String, String.eq(kind, "cgen"), "", closure),
      toolchain, rows,
      CompileQueueIdentity.artifact_names(String.lines(artifacts)), command)
