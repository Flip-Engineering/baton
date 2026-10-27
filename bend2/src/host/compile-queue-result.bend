import Base
import ../host/text.bend as T
import ../host/files.bend as F
import ./compile-queue-identity.bend as Identity
import ./compile-queue-artifact.bend as Artifact
import ../host/storage.bend as Storage
import ./compile-queue-lifecycle.bend as L

# Compile queue result schema version 2.
#
# Every result begins with `CompileQueueResult.header(kind, key, verified,
# external)`, which writes:
#   schema=baton-compile-queue-result-v2
#   identity_schema=baton-compile-queue-identity-v2
#   kind=KIND
#   key=KEY
#   verified=0|1
#   external=0|1
#
# `verified=1` means the supervisor verified the recorded artifacts (or, for
# an adopted external execution, the lifecycle matched every adoption field).
# A result without identity_schema, with a different schema or identity
# schema, without the requested key, or with verified=0 is never reused. The
# bootstrap shell cache uses baton-compile-queue-v1 keys and the v1 result
# schema, so those entries fail every check here.
#
# Adopted external results also carry the fields emitted by
# `external_fields`; `reusable` requires all six values to match the live
# command, process start identity, inputs, output and artifact tree hashes.
# An unverified external result remains evidence only.
#
# Artifact rows use the shell-compatible shape:
#   artifact=NAME<TAB>file<TAB><sha256>
#   artifact=NAME<TAB>directory<TAB><tree sha256>
#
# The directory value is the artifact binding's tree hash, not an existence
# test.

def CompileQueueResult.schema() -> String:
  "baton-compile-queue-result-v2"

def CompileQueueResult.identity_schema() -> String:
  Identity.CompileQueueIdentity.schema()

def CompileQueueResult.field_lines(lines: List<&2,String>, +name: String) -> String:
  match lines:
    case Nil{}:
      ""
    case +line <> +rest:
      +prefix = name ++ "="
      Bool.pick(String, String.starts_with(line, prefix), String.drop(line, String.length(prefix)), CompileQueueResult.field_lines(rest, name))

def CompileQueueResult.field(+result: String, +name: String) -> String:
  CompileQueueResult.field_lines(String.lines(result), name)

def CompileQueueResult.read_field_result(read: Result<&1,&1,U32 & String,String>, +name: String) -> IO(Result<&1,&1,U32 & String,String>):
  match read:
    case Fail{error}:
      IO.pure(Result<&1,&1,U32 & String,String>, Fail{error})
    case Done{result}:
      IO.pure(Result<&1,&1,U32 & String,String>, Done{CompileQueueResult.field(result, name)})

def CompileQueueResult.read_field(+path: String, +name: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    read : Result<&1,&1,U32 & String,String> <- T.Text.read(path)
    CompileQueueResult.read_field_result(read, name)

def CompileQueueResult.artifact_lines(lines: List<&2,String>, +acc: String) -> String:
  match lines:
    case Nil{}:
      acc
    case +line <> +rest:
      next_acc = Bool.pick(String, String.starts_with(line, "artifact="), acc ++ line ++ "\n", acc)
      CompileQueueResult.artifact_lines(rest, next_acc)

def CompileQueueResult.artifact_rows(+result: String) -> String:
  CompileQueueResult.artifact_lines(String.lines(result), "")

def CompileQueueResult.read_rows_result(read: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match read:
    case Fail{error}:
      IO.pure(Result<&1,&1,U32 & String,String>, Fail{error})
    case Done{result}:
      IO.pure(Result<&1,&1,U32 & String,String>, Done{CompileQueueResult.artifact_rows(result)})

def CompileQueueResult.read_rows(+path: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    read : Result<&1,&1,U32 & String,String> <- T.Text.read(path)
    CompileQueueResult.read_rows_result(read)

def CompileQueueResult.completed(+result: String) -> Bool:
  Bool.and(String.eq(CompileQueueResult.field(result, "status"), "completed"),
    Bool.or(String.eq(CompileQueueResult.field(result, "kind"), "check"),
      Bool.not(String.is_empty(CompileQueueResult.artifact_rows(result)))))

def CompileQueueResult.base_verified(+result: String, +key: String) -> Bool:
  Bool.and(String.eq(CompileQueueResult.field(result, "schema"), CompileQueueResult.schema()),
    Bool.and(String.eq(CompileQueueResult.field(result, "identity_schema"), CompileQueueResult.identity_schema()),
      Bool.and(String.eq(CompileQueueResult.field(result, "key"), key),
        String.eq(CompileQueueResult.field(result, "verified"), "1"))))

def CompileQueueResult.external_verified(+result: String, +command: String, +process: String, +inputs_sha256: String, +output: String, +artifacts: String) -> Bool:
  Bool.and(String.eq(CompileQueueResult.field(result, "external"), "1"),
    Bool.and(String.eq(CompileQueueResult.field(result, "external-verified"), "1"),
      Bool.and(String.eq(CompileQueueResult.field(result, "external-command"), command),
        Bool.and(String.eq(CompileQueueResult.field(result, "external-process"), process),
          Bool.and(String.eq(CompileQueueResult.field(result, "external-inputs-sha256"), inputs_sha256),
            Bool.and(String.eq(CompileQueueResult.field(result, "external-output"), output),
              String.eq(CompileQueueResult.field(result, "external-artifacts"), artifacts)))))))

# A normal result is reusable after base_verified; an external result also
# needs every adoption field to match. Callers verify the cached artifact
# bytes separately with `verify`.
def CompileQueueResult.reusable(+result: String, +key: String, +command: String, +process: String, +inputs_sha256: String, +output: String, +artifacts: String) -> Bool:
  Bool.and(CompileQueueResult.base_verified(result, key),
    Bool.pick(Bool, String.eq(CompileQueueResult.field(result, "external"), "1"), CompileQueueResult.external_verified(result, command, process, inputs_sha256, output, artifacts), True{}))

def CompileQueueResult.header(+kind: String, +key: String, +verified: String, +external: String) -> String:
  "schema=" ++ CompileQueueResult.schema() ++ "\n"
  ++ "identity_schema=" ++ CompileQueueResult.identity_schema() ++ "\n"
  ++ "kind=" ++ kind ++ "\n"
  ++ "key=" ++ key ++ "\n"
  ++ "verified=" ++ verified ++ "\n"
  ++ "external=" ++ external ++ "\n"

def CompileQueueResult.external_fields(+verified: String, +command: String, +process: String, +inputs_sha256: String, +output: String, +artifacts: String) -> String:
  "external-verified=" ++ verified ++ "\n"
  ++ "external-command=" ++ command ++ "\n"
  ++ "external-process=" ++ process ++ "\n"
  ++ "external-inputs-sha256=" ++ inputs_sha256 ++ "\n"
  ++ "external-output=" ++ output ++ "\n"
  ++ "external-artifacts=" ++ artifacts ++ "\n"

def CompileQueueResult.verify_row_digest(actual: Result<&1,&1,U32 & String,String>, +expected: String) -> IO(Bool):
  match actual:
    case Fail{error}:
      IO.pure(Bool, False{})
    case Done{digest}:
      IO.pure(Bool, String.eq(digest, expected))

def CompileQueueResult.verify_row_kind(seen: Result<&1,&1,U32 & String,String>, +source: String, +kind: String, +expected: String) -> IO(Bool):
  match seen:
    case Fail{error}:
      IO.pure(Bool, False{})
    case Done{kind_seen}:
      Bool.pick(IO(Bool), String.eq(kind, kind_seen),
        do IO<Bool>:
          actual : Result<&1,&1,U32 & String,String> <- Artifact.CompileQueueArtifact.digest(source)
          CompileQueueResult.verify_row_digest(actual, expected),
        IO.pure(Bool, False{}))

def CompileQueueResult.verify_row_fields(+fields: List<&2,String>, +keydir: String) -> IO(Bool):
  match fields:
    case name_field <> kind <> expected <> tail:
      Bool.pick(IO(Bool), String.is_empty(String.concat(tail)),
        do IO<Bool>:
          name : String <- IO.pure(String, String.drop(name_field, String.length("artifact=")))
          +source : String <- IO.pure(String, keydir ++ "/completed/artifacts/" ++ name)
          seen : Result<&1,&1,U32 & String,String> <- Artifact.CompileQueueArtifact.kind(source)
          CompileQueueResult.verify_row_kind(seen, source, kind, expected),
        IO.pure(Bool, False{}))
    case other:
      IO.pure(Bool, False{})

def CompileQueueResult.verify_row(+row: String, +keydir: String) -> IO(Bool):
  CompileQueueResult.verify_row_fields(String.split(row, Char.from_u32(9)), keydir)

def CompileQueueResult.verify_rows(+rows: List<&2,String>, +keydir: String) -> IO(Bool):
  match rows:
    case Nil{}:
      IO.pure(Bool, True{})
    case +row <> +rest:
      Bool.pick(IO(Bool), String.is_empty(row),
        CompileQueueResult.verify_rows(rest, keydir),
        do IO<Bool>:
          ok : Bool <- CompileQueueResult.verify_row(row, keydir)
          Bool.pick(IO(Bool), ok, CompileQueueResult.verify_rows(rest, keydir), IO.pure(Bool, False{})))

def CompileQueueResult.acceptable(+result: String, +key: String, +rows: String) -> Bool:
  Bool.and(String.eq(CompileQueueResult.field(result, "external"), "0"),
    Bool.and(CompileQueueResult.base_verified(result, key),
      Bool.and(CompileQueueResult.completed(result),
        Bool.pick(Bool, String.eq(CompileQueueResult.field(result, "kind"), "check"),
          String.is_empty(rows), Bool.not(String.is_empty(rows))))))

def CompileQueueResult.verify_result_read(read: Result<&1,&1,U32 & String,String>, +keydir: String, +key: String) -> IO(Bool):
  match read:
    case Fail{error}:
      IO.pure(Bool, False{})
    case Done{+result}:
      +rows = CompileQueueResult.artifact_rows(result)
      Bool.pick(IO(Bool), CompileQueueResult.acceptable(result, key, rows),
        CompileQueueResult.verify_rows(String.lines(rows), keydir),
        IO.pure(Bool, False{}))

def CompileQueueResult.verify(+keydir: String, +key: String) -> IO(Bool):
  do IO<Bool>:
    read : Result<&1,&1,U32 & String,String> <- T.Text.read(keydir ++ "/completed/result")
    CompileQueueResult.verify_result_read(read, keydir, key)

def CompileQueueResult.verify_state_completed(+state_root: String, +key: String) -> IO(Result<&1,&1,U32 & String,Bool>):
  do IO<Result<&1,&1,U32 & String,Bool>>:
    ok : Bool <- CompileQueueResult.verify(state_root ++ "/keys/" ++ key, key)
    IO.pure(Result<&1,&1,U32 & String,Bool>, Done{ok})

def CompileQueueResult.write_text_result(written: Result<&1,&1,U32 & String,Unit>, +path: String, +temporary: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match written:
    case Fail{error}:
      IO.pure(Result<&1,&1,U32 & String,Unit>, Fail{error})
    case Done{unit}:
      F.Files.rename(temporary, path)

def CompileQueueResult.write_text(+path: String, +text: String, +temporary: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    written : Result<&1,&1,U32 & String,Unit> <- F.Files.write_private(temporary, text)
    CompileQueueResult.write_text_result(written, path, temporary)

def CompileQueueResult.install(+source: String, +destination: String, +staging: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  Artifact.CompileQueueArtifact.install(source, destination, staging)

# -------------------------------------------------------------------------
# Policy adapters
#
# names: one artifact name per line.
# rows:  one `name<TAB>destination` per line for copy/receipt calls.
# adoption: newline-separated external-command, external-process,
#           external-inputs-sha256, external-output and external-artifacts values.
#
# I/O failures propagate through the IO channel; result misses and altered
# results answer Done{False} or Done{""}. write marks verified=1 only for a
# completed result whose named artifacts all hash. write_adoption must be
# called only after the adoption record matched, so it writes external=1,
# external-verified=1 and verified=1.

type CompileQueueRow is Data:
  CompileQueueRow{rows: String, ok: String}

type CompileQueueLatest is Data:
  CompileQueueLatest{path: String, status: String, finished: String}

def CompileQueueResult.drop_last(+parts: List<&2,String>) -> List<&2,String>:
  match parts:
    case Nil{}:
      Nil{}
    case part <> Nil{}:
      Nil{}
    case part <> rest:
      part <> CompileQueueResult.drop_last(rest)

def CompileQueueResult.last_part(+parts: List<&2,String>, +current: String) -> String:
  match parts:
    case Nil{}:
      current
    case +part <> +rest:
      next = Bool.pick(String, String.is_empty(part), current, part)
      CompileQueueResult.last_part(rest, next)

def CompileQueueResult.basename(+path: String) -> String:
  CompileQueueResult.last_part(String.split(path, Char.from_u32(47)), "")

def CompileQueueResult.dirname(+path: String) -> String:
  parts = CompileQueueResult.drop_last(String.split(path, Char.from_u32(47)))
  +joined = String.join(parts, "/")
  Bool.pick(String, String.is_empty(joined), Bool.pick(String, String.starts_with(path, "/"), "/", "."), joined)

def CompileQueueResult.decimal_lt(+a: String, +b: String) -> Bool:
  Bool.pick(Bool, Nat.is_lt(String.length(a), String.length(b)), True{},
    Bool.pick(Bool, Nat.is_gt(String.length(a), String.length(b)), False{}, String.is_lt(a, b)))

def CompileQueueResult.decimal_ge(+a: String, +b: String) -> Bool:
  Bool.not(CompileQueueResult.decimal_lt(a, b))

def CompileQueueResult.log_rows(+label: String, +path: String,
                                 present: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match present:
    case Done{value}:
      Bool.pick(IO(Result<&1,&1,U32 & String,String>), String.eq(value, "1"),
        do IO<Result<&1,&1,U32 & String,String>>:
          sha : String <- IO.try(String, Identity.CompileQueueIdentity.file_digest(path))
          size : String <- IO.try(String, Identity.CompileQueueIdentity.file_size(path))
          IO.pure(Result<&1,&1,U32 & String,String>, Done{"log-" ++ label ++ "-sha=" ++ sha ++ "\nlog-" ++ label ++ "-bytes=" ++ size ++ "\n"}),
        IO.pure(Result<&1,&1,U32 & String,String>, Done{""}))
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>, Fail{error})

def CompileQueueResult.log_text(+label: String, +path: String) -> IO(Result<&1,&1,U32 & String,String>):
  Bool.pick(IO(Result<&1,&1,U32 & String,String>), String.is_empty(path),
    IO.pure(Result<&1,&1,U32 & String,String>, Done{""}),
    do IO<Result<&1,&1,U32 & String,String>>:
      present : Result<&1,&1,U32 & String,String> <- F.Files.regular(path)
      CompileQueueResult.log_rows(label, path, present))

def CompileQueueResult.work_row(+work: String, +name: String) -> IO(Result<&1,&1,U32 & String,CompileQueueRow>):
  do IO<Result<&1,&1,U32 & String,CompileQueueRow>>:
    +kind : String <- IO.try(String, Artifact.CompileQueueArtifact.kind(work ++ "/" ++ name))
    Bool.pick(IO(Result<&1,&1,U32 & String,CompileQueueRow>), String.eq(kind, "missing"),
      IO.pure(Result<&1,&1,U32 & String,CompileQueueRow>, Done{CompileQueueRow{"", "0"}}),
      do IO<Result<&1,&1,U32 & String,CompileQueueRow>>:
        digest : String <- IO.try(String, Artifact.CompileQueueArtifact.digest(work ++ "/" ++ name))
        IO.pure(Result<&1,&1,U32 & String,CompileQueueRow>, Done{CompileQueueRow{"artifact=" ++ name ++ "\t" ++ kind ++ "\t" ++ digest ++ "\n", "1"}}))

def CompileQueueResult.combine_rows(+left: CompileQueueRow, +right: CompileQueueRow) -> CompileQueueRow:
  match left:
    case CompileQueueRow{left_rows, left_ok}:
      match right:
        case CompileQueueRow{right_rows, right_ok}:
          CompileQueueRow{left_rows ++ right_rows, Bool.pick(String, Bool.and(String.eq(left_ok, "1"), String.eq(right_ok, "1")), "1", "0")}

def CompileQueueResult.work_rows(+work: String, +names: List<&2,String>, +acc: CompileQueueRow) -> IO(Result<&1,&1,U32 & String,CompileQueueRow>):
  match names:
    case Nil{}:
      IO.pure(Result<&1,&1,U32 & String,CompileQueueRow>, Done{acc})
    case +name <> +rest:
      Bool.pick(IO(Result<&1,&1,U32 & String,CompileQueueRow>), String.is_empty(name),
        CompileQueueResult.work_rows(work, rest, acc),
        do IO<Result<&1,&1,U32 & String,CompileQueueRow>>:
          one : CompileQueueRow <- IO.try(CompileQueueRow, CompileQueueResult.work_row(work, name))
          CompileQueueResult.work_rows(work, rest, CompileQueueResult.combine_rows(acc, one)))

def CompileQueueResult.write_rows(+path: String, +status: String, +code: String, +kind: String, +key: String, +started: String, +finished: String, +attempt: String, +work: String, +stdout_row: String, +stderr_row: String, +row_result: CompileQueueRow, +detail: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match row_result:
    case CompileQueueRow{artifact_text, artifact_ok}:
      verified = Bool.pick(String, Bool.and(String.eq(status, "completed"), String.eq(artifact_ok, "1")), "1", "0")
      text = CompileQueueResult.header(kind, key, verified, "0")
        ++ "status=" ++ status ++ "\n"
        ++ "exit=" ++ code ++ "\n"
        ++ "started_ns=" ++ started ++ "\n"
        ++ "finished_ns=" ++ finished ++ "\n"
        ++ "attempt=" ++ attempt ++ "\n"
        ++ "work=" ++ work ++ "\n"
        ++ "detail=" ++ detail ++ "\n"
        ++ stdout_row ++ stderr_row ++ artifact_text
      CompileQueueResult.write_text(path, text, path ++ ".tmp")

def CompileQueueResult.write(+path: String, +status: String, +code: String, +kind: String, +key: String, +started: String, +finished: String, +attempt: String, +work: String, +stdout: String, +stderr: String, +detail: String, +names: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    stdout_row : String <- IO.try(String, CompileQueueResult.log_text("stdout", stdout))
    stderr_row : String <- IO.try(String, CompileQueueResult.log_text("stderr", stderr))
    row_result : CompileQueueRow <- IO.try(CompileQueueRow, CompileQueueResult.work_rows(work, String.lines(names), CompileQueueRow{"", "1"}))
    CompileQueueResult.write_rows(path, status, code, kind, key, started, finished, attempt, work, stdout_row, stderr_row, row_result, detail)

def CompileQueueResult.retain_rows(+work: String, +destination: String, +names: List<&2,String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match names:
    case Nil{}:
      IO.pure(Result<&1,&1,U32 & String,Unit>, Done{Unit{}})
    case name <> rest:
      Bool.pick(IO(Result<&1,&1,U32 & String,Unit>), String.is_empty(name),
        CompileQueueResult.retain_rows(work, destination, rest),
        do IO<Result<&1,&1,U32 & String,Unit>>:
          +target : String <- IO.pure(String, destination ++ "/" ++ name)
          +staging : String <- IO.pure(String, target ++ ".queue-tmp")
          made : Unit <- IO.try(Unit, L.CompileQueueLifecycle.mkdir_p(CompileQueueResult.dirname(target)))
          removed : Unit <- IO.try(Unit, Artifact.CompileQueueArtifact.remove(staging))
          installed : Unit <- IO.try(Unit, Artifact.CompileQueueArtifact.install(work ++ "/" ++ name, target, staging))
          CompileQueueResult.retain_rows(work, destination, rest))

def CompileQueueResult.retain_artifacts(+work: String, +destination: String, +names: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  CompileQueueResult.retain_rows(work, destination, String.lines(names))

def CompileQueueResult.retain_external(+path: String, +destination: String, +name: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +target : String <- IO.pure(String, destination ++ "/" ++ name)
    +staging : String <- IO.pure(String, target ++ ".queue-tmp")
    removed : Unit <- IO.try(Unit, Artifact.CompileQueueArtifact.remove(staging))
    installed : Unit <- IO.try(Unit, Artifact.CompileQueueArtifact.install(path, target, staging))
    IO.pure(Result<&1,&1,U32 & String,Unit>, Done{installed})

def CompileQueueResult.adoption_append(+acc: String, +value: String) -> String:
  Bool.pick(String, String.is_empty(acc), value, acc ++ "\n" ++ value)

def CompileQueueResult.adoption_values(+lines: List<&2,String>, +prefix: String, +acc: String) -> String:
  match lines:
    case Nil{}:
      acc
    case +line <> +rest:
      next = Bool.pick(String, String.starts_with(line, prefix),
        CompileQueueResult.adoption_append(acc, String.drop(line, String.length(prefix))), acc)
      CompileQueueResult.adoption_values(rest, prefix, next)

def CompileQueueResult.adoption_field(+text: String, +name: String) -> String:
  CompileQueueResult.adoption_values(String.lines(text), name ++ "=", "")

def CompileQueueResult.external_process(+adoption: String) -> String:
  CompileQueueResult.field(adoption, "pid") ++ ":" ++ CompileQueueResult.field(adoption, "starttime")

def CompileQueueResult.external_artifacts(+name: String, +digest: String) -> String:
  name ++ ":" ++ digest

def CompileQueueResult.adoption_rows_match(+recorded_name: String, +recorded_digest: String,
                                           +result_name: String, +result_digest: String) -> Bool:
  Bool.and(String.eq(recorded_name, result_name), String.eq(recorded_digest, result_digest))

def CompileQueueResult.adoption_ready(+kind: String, +digest: String, +command: String, +process: String,
                                      +output: String, +name: String, +adoption: String) -> Bool:
  Bool.and(Bool.not(String.is_empty(command)),
    Bool.and(Bool.not(String.is_empty(process)),
      Bool.and(Bool.not(String.is_empty(output)),
        Bool.and(Bool.not(String.is_empty(name)),
          Bool.and(Bool.not(String.is_empty(digest)),
            Bool.and(Bool.not(String.eq(kind, "missing")),
              Bool.and(Bool.not(String.is_empty(CompileQueueResult.adoption_field(adoption, "pid"))),
                Bool.not(String.is_empty(CompileQueueResult.adoption_field(adoption, "starttime"))))))))))


def CompileQueueResult.write_adoption(+path: String, +key: String, +started: String, +finished: String, +adoption: String, +name: String, +artifact_path: String, +artifacts_dir: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +kind : String <- IO.try(String, Artifact.CompileQueueArtifact.kind(artifact_path))
    +digest : String <- IO.try(String, Artifact.CompileQueueArtifact.digest(artifact_path))
    +command : String <- IO.pure(String, CompileQueueResult.adoption_field(adoption, "argv"))
    +process : String <- IO.pure(String, CompileQueueResult.external_process(adoption))
    inputs : String <- IO.pure(String, CompileQueueResult.adoption_field(adoption, "input"))
    +inputs_sha256 : String <- IO.try(String, Identity.CompileQueueIdentity.text_digest(inputs))
    +output : String <- IO.pure(String, CompileQueueResult.field(adoption, "output"))
    artifacts_value : String <- IO.pure(String, CompileQueueResult.external_artifacts(name, digest))
    ready : Bool <- IO.pure(Bool, CompileQueueResult.adoption_ready(kind, digest, command, process, output, name, adoption))
    +verified : String <- IO.pure(String, Bool.pick(String, ready, "1", "0"))
    text : String <- IO.pure(String, CompileQueueResult.header("cgen", key, verified, "1")
      ++ "status=completed\nexit=0\n"
      ++ "started_ns=" ++ started ++ "\n"
      ++ "finished_ns=" ++ finished ++ "\n"
      ++ "attempt=external\nwork=" ++ artifacts_dir ++ "\n"
      ++ "detail=external execution observed\n"
      ++ "external-verified=" ++ verified ++ "\n"
      ++ "external-command=" ++ command ++ "\n"
      ++ "external-process=" ++ process ++ "\n"
      ++ "external-inputs-sha256=" ++ inputs_sha256 ++ "\n"
      ++ "external-output=" ++ output ++ "\n"
      ++ "external-artifacts=" ++ artifacts_value ++ "\n"
      ++ "artifact-name=" ++ name ++ "\n"
      ++ "artifact-digest=" ++ digest ++ "\n"
      ++ adoption
      ++ "external-name=" ++ name ++ "\n"
      ++ "artifact=" ++ name ++ "\t" ++ kind ++ "\t" ++ digest ++ "\n")
    CompileQueueResult.write_text(path, text, path ++ ".tmp")

def CompileQueueResult.verify_adoption_read(read: Result<&1,&1,U32 & String,String>, +keydir: String, +adoption: String) -> IO(Result<&1,&1,U32 & String,Bool>):
  match read:
    case Fail{error}:
      IO.pure(Result<&1,&1,U32 & String,Bool>, Done{False{}})
    case Done{+result}:
      do IO<Result<&1,&1,U32 & String,Bool>>:
        +key : String <- IO.pure(String, CompileQueueResult.basename(keydir))
        +rows : String <- IO.pure(String, CompileQueueResult.artifact_rows(result))
        +artifact_name : String <- IO.pure(String, CompileQueueResult.field(result, "artifact-name"))
        +artifact_digest : String <- IO.pure(String, CompileQueueResult.field(result, "artifact-digest"))
        +recorded_name : String <- IO.pure(String, CompileQueueResult.adoption_field(adoption, "artifact-name"))
        +recorded_digest : String <- IO.pure(String, CompileQueueResult.adoption_field(adoption, "artifact-digest"))
        +consistent : Bool <- IO.pure(Bool, CompileQueueResult.adoption_rows_match(recorded_name, recorded_digest, artifact_name, artifact_digest))
        +inputs : String <- IO.pure(String, CompileQueueResult.adoption_field(adoption, "input"))
        +inputs_sha256 : String <- IO.try(String, Identity.CompileQueueIdentity.text_digest(inputs))
        +expected_artifacts : String <- IO.pure(String, CompileQueueResult.external_artifacts(recorded_name, recorded_digest))
        adopted : Bool <- IO.pure(Bool, Bool.and(Bool.and(Bool.not(String.is_empty(recorded_name)),
          Bool.and(Bool.not(String.is_empty(recorded_digest)),
            Bool.and(consistent, CompileQueueResult.base_verified(result, key)))),
          Bool.and(String.eq(CompileQueueResult.field(result, "external"), "1"),
            Bool.and(String.eq(CompileQueueResult.field(result, "external-verified"), "1"),
              Bool.and(CompileQueueResult.completed(result),
                Bool.and(Bool.not(String.is_empty(rows)),
                  Bool.and(Bool.not(String.is_empty(artifact_name)),
                    Bool.and(Bool.not(String.is_empty(artifact_digest)),
                      CompileQueueResult.external_verified(result,
                        CompileQueueResult.adoption_field(adoption, "argv"),
                        CompileQueueResult.external_process(adoption),
                        inputs_sha256,
                        CompileQueueResult.field(adoption, "output"),
                        expected_artifacts)))))))))
        artifacts_ok : Bool <- CompileQueueResult.verify_rows(String.lines(rows), keydir)
        IO.pure(Result<&1,&1,U32 & String,Bool>, Done{Bool.and(adopted, artifacts_ok)})

def CompileQueueResult.verify_adoption(+keydir: String, +adoption: String) -> IO(Result<&1,&1,U32 & String,Bool>):
  do IO<Result<&1,&1,U32 & String,Bool>>:
    read : Result<&1,&1,U32 & String,String> <- T.Text.read(keydir ++ "/completed/result")
    CompileQueueResult.verify_adoption_read(read, keydir, adoption)

def CompileQueueResult.verify_completed(+keydir: String) -> IO(Result<&1,&1,U32 & String,Bool>):
  do IO<Result<&1,&1,U32 & String,Bool>>:
    ok : Bool <- CompileQueueResult.verify(keydir, CompileQueueResult.basename(keydir))
    IO.pure(Result<&1,&1,U32 & String,Bool>, Done{ok})

def CompileQueueResult.copy_row_fields(fields: List<&2,String>, +keydir: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match fields:
    case name <> +destination <> tail:
      do IO<Result<&1,&1,U32 & String,Unit>>:
        +staging : String <- IO.pure(String, destination ++ ".queue-tmp")
        removed : Unit <- IO.try(Unit, Artifact.CompileQueueArtifact.remove(staging))
        installed : Unit <- IO.try(Unit, Artifact.CompileQueueArtifact.install(keydir ++ "/completed/artifacts/" ++ name, destination, staging))
        IO.pure(Result<&1,&1,U32 & String,Unit>, Done{installed})
    case other:
      IO.pure(Result<&1,&1,U32 & String,Unit>, Done{Unit{}})

def CompileQueueResult.copy_rows(+keydir: String, +rows: List<&2,String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match rows:
    case Nil{}: IO.pure(Result<&1,&1,U32 & String,Unit>, Done{Unit{}})
    case +row <> +rest:
      Bool.pick(IO(Result<&1,&1,U32 & String,Unit>), String.is_empty(row),
        CompileQueueResult.copy_rows(keydir, rest),
        do IO<Result<&1,&1,U32 & String,Unit>>:
          copied : Unit <- IO.try(Unit, CompileQueueResult.copy_row_fields(String.split(row, Char.from_u32(9)), keydir))
          CompileQueueResult.copy_rows(keydir, rest))

def CompileQueueResult.copy_artifacts(+keydir: String, +rows: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  CompileQueueResult.copy_rows(keydir, String.lines(rows))

def CompileQueueResult.receipt_row_parts(parts: List<&2,String>) -> String:
  match parts:
    case name <> destination <> tail:
      "artifact-" ++ name ++ "=" ++ destination ++ "\n"
    case other: ""

def CompileQueueResult.receipt_rows(rows: List<&2,String>) -> String:
  match rows:
    case Nil{}: ""
    case +row <> +rest:
      current = Bool.pick(String, String.is_empty(row), "",
        CompileQueueResult.receipt_row_parts(String.split(row, Char.from_u32(9))))
      current ++ CompileQueueResult.receipt_rows(rest)

def CompileQueueResult.receipt_write_missing(missing: Bool, +receipt: String, +status: String, +key: String, +reused: String, +owner: String, +rows: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match missing:
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>, Done{Unit{}})
    case False{}:
      text = "status=" ++ status ++ "\n"
        ++ "key=" ++ key ++ "\n"
        ++ "reused=" ++ reused ++ "\n"
        ++ "owner=" ++ owner ++ "\n"
        ++ CompileQueueResult.receipt_rows(String.lines(rows))
      CompileQueueResult.write_text(receipt, text, receipt ++ ".tmp")

def CompileQueueResult.receipt_write(+receipt: String, +status: String, +key: String, +reused: String, +owner: String, +rows: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  +missing = String.is_empty(receipt)
  CompileQueueResult.receipt_write_missing(missing, receipt, status, key, reused, owner, rows)

def CompileQueueResult.receipt_failure_text(status: String, key: String, owner: String,
                                            exit: String, detail: String) -> String:
  "status=" ++ status ++ "\n"
    ++ "key=" ++ key ++ "\n"
    ++ "reused=0\n"
    ++ "owner=" ++ owner ++ "\n"
    ++ "exit=" ++ exit ++ "\n"
    ++ "detail=" ++ detail ++ "\n"

def CompileQueueResult.receipt_failure_missing(missing: Bool, +receipt: String,
                                               status: String, key: String,
                                               owner: String, exit: String,
                                               detail: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match missing:
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>, Done{Unit{}})
    case False{}:
      CompileQueueResult.write_text(receipt,
        CompileQueueResult.receipt_failure_text(status, key, owner, exit, detail),
        receipt ++ ".tmp")

def CompileQueueResult.receipt_failure_result(read: Result<&1,&1,U32 & String,String>,
                                              +receipt: String, owner: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match read:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>, Fail{error})
    case Done{+result}:
      CompileQueueResult.receipt_failure_missing(String.is_empty(receipt), receipt,
        CompileQueueResult.field(result, "status"),
        CompileQueueResult.field(result, "key"), owner,
        CompileQueueResult.field(result, "exit"),
        CompileQueueResult.field(result, "detail"))

def CompileQueueResult.receipt_write_failure(+receipt: String, +result_path: String,
                                             owner: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    read : Result<&1,&1,U32 & String,String> <- T.Text.read(result_path)
    CompileQueueResult.receipt_failure_result(read, receipt, owner)

def CompileQueueResult.run_name_parts(parts: List<&2,String>) -> String:
  match parts:
    case kind <> name <> tail:
      Bool.pick(String, String.eq(kind, "dir"), name, "")
    case other: ""

def CompileQueueResult.run_names(records: List<&2,String>) -> List<&2,String>:
  match records:
    case Nil{}: Nil{}
    case +record <> +rest:
      +name = CompileQueueResult.run_name_parts(String.split(record, Char.from_u32(9)))
      prefix = Bool.pick(List<&2,String>, String.is_empty(name), Nil{}, name <> Nil{})
      suffix = CompileQueueResult.run_names(rest)
      List.append(&2,String,prefix,suffix)

def CompileQueueResult.latest_scan_choose(+best_path: String, +best_status: String, +best_finished: String, +keydir: String, +name: String, +status: String, +finished: String) -> CompileQueueLatest:
  Bool.pick(CompileQueueLatest, String.is_empty(best_path),
    CompileQueueLatest{keydir ++ "/runs/" ++ name ++ "/result", status, finished},
    Bool.pick(CompileQueueLatest, CompileQueueResult.decimal_lt(best_finished, finished),
      CompileQueueLatest{keydir ++ "/runs/" ++ name ++ "/result", status, finished},
      CompileQueueLatest{best_path, best_status, best_finished}))

def CompileQueueResult.latest_scan_candidate(best: CompileQueueLatest, keydir: String, name: String, status: String, finished: String) -> CompileQueueLatest:
  match best:
    case CompileQueueLatest{best_path, best_status, best_finished}:
      CompileQueueResult.latest_scan_choose(best_path, best_status, best_finished, keydir, name, status, finished)

def CompileQueueResult.latest_scan_read_result(read: Result<&1,&1,U32 & String,String>, +keydir: String, +name: String, best: CompileQueueLatest) -> CompileQueueLatest:
  match read:
    case Fail{error}: best
    case Done{+result}:
      +status = CompileQueueResult.field(result, "status")
      +finished_text = CompileQueueResult.field(result, "finished_ns")
      +finished = Bool.pick(String, String.is_empty(finished_text), "0", finished_text)
      CompileQueueResult.latest_scan_candidate(best, keydir, name, status, finished)

def CompileQueueResult.latest_scan(+names: List<&2,String>, +keydir: String, +best: CompileQueueLatest) -> IO(CompileQueueLatest):
  match names:
    case Nil{}: IO.pure(CompileQueueLatest, best)
    case +name <> +rest:
      Bool.pick(IO(CompileQueueLatest), String.is_empty(name), CompileQueueResult.latest_scan(rest, keydir, best),
        do IO<CompileQueueLatest>:
          read : Result<&1,&1,U32 & String,String> <- T.Text.read(keydir ++ "/runs/" ++ name ++ "/result")
          next : CompileQueueLatest <- IO.pure(CompileQueueLatest, CompileQueueResult.latest_scan_read_result(read, keydir, name, best))
          CompileQueueResult.latest_scan(rest, keydir, next))

def CompileQueueResult.latest_result_best(+best: CompileQueueLatest, +wait_start: String, +present: String) -> IO(Result<&1,&1,U32 & String,String>):
  match best:
    case CompileQueueLatest{best_path, best_status, best_finished}:
      wait = Bool.pick(String, String.is_empty(wait_start), "0", wait_start)
      selected = Bool.and(Bool.not(String.is_empty(best_path)),
        Bool.and(Bool.not(String.eq(best_status, "completed")),
          Bool.or(String.eq(present, "1"), CompileQueueResult.decimal_ge(best_finished, wait))))
      IO.pure(Result<&1,&1,U32 & String,String>, Done{Bool.pick(String, selected, best_path, "")})

def CompileQueueResult.latest_result_entries(entries: Result<&1,&1,U32 & String,String>, +keydir: String, +wait_start: String, +present: String) -> IO(Result<&1,&1,U32 & String,String>):
  match entries:
    case Fail{error}:
      IO.pure(Result<&1,&1,U32 & String,String>, Done{""})
    case Done{records}:
      names = CompileQueueResult.run_names(String.split(records, Char.from_u32(0)))
      do IO<Result<&1,&1,U32 & String,String>>:
        best : CompileQueueLatest <- CompileQueueResult.latest_scan(names, keydir, CompileQueueLatest{"", "", "0"})
        CompileQueueResult.latest_result_best(best, wait_start, present)

def CompileQueueResult.latest_result(+keydir: String, +wait_start: String, +present: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    entries : Result<&1,&1,U32 & String,String> <- Storage.StorageHost.entries(keydir ++ "/runs")
    CompileQueueResult.latest_result_entries(entries, keydir, wait_start, present)

def CompileQueueResult.read_or_empty_result(read: Result<&1,&1,U32 & String,String>) -> IO(String):
  match read:
    case Fail{error}:
      IO.pure(String, "")
    case Done{text}:
      IO.pure(String, text)

def CompileQueueResult.read_or_empty(+path: String) -> IO(String):
  do IO<String>:
    read : Result<&1,&1,U32 & String,String> <- T.Text.read(path)
    CompileQueueResult.read_or_empty_result(read)

def CompileQueueResult.failure_exit(parsed: Maybe<&2,U32>) -> U32:
  match parsed:
    case None{}: 1
    case Some{+code}:
      Bool.pick(U32, Bool.and(U32.is_ne(code, 0), U32.is_le(code, 255)), code, 1)

def CompileQueueResult.report_failure_result(read: Result<&1,&1,U32 & String,String>, +path: String) -> IO(Unit):
  match read:
    case Fail{error}:
      IO.die(Unit, 1, "compile-queue: unreadable result " ++ path ++ "\n")
    case Done{+result}:
      do IO<Unit>:
        tail : String <- CompileQueueResult.read_or_empty(CompileQueueResult.dirname(path) ++ "/stderr")
        code : U32 <- IO.pure(U32, CompileQueueResult.failure_exit(U32.read(CompileQueueResult.field(result, "exit"))))
        IO.die(Unit, code, "compile-queue: " ++ CompileQueueResult.field(result, "kind") ++ " execution " ++ CompileQueueResult.field(result, "status") ++ " key=" ++ CompileQueueResult.field(result, "key") ++ " exit=" ++ CompileQueueResult.field(result, "exit") ++ "\ncompile-queue: " ++ CompileQueueResult.field(result, "detail") ++ "\n" ++ tail)

def CompileQueueResult.report_failure(+path: String) -> IO(Unit):
  do IO<Unit>:
    read : Result<&1,&1,U32 & String,String> <- T.Text.read(path)
    CompileQueueResult.report_failure_result(read, path)
