import Base
import ./text.bend as T
import ./files.bend as F
import ./compile-queue-identity.bend as Identity
import ./compile-queue-artifact.bend as Artifact

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

def CompileQueueResult.field_lines(lines: List<&2,String>, +prefix: String) -> String:
  match lines:
    case Nil{}:
      ""
    case line <> rest:
      Bool.pick(String, String.starts_with(line, prefix), String.drop(line, String.length(prefix)), CompileQueueResult.field_lines(rest, prefix))

def CompileQueueResult.field(result: String, name: String) -> String:
  CompileQueueResult.field_lines(String.lines(result), name ++ "=")

def CompileQueueResult.artifact_lines(lines: List<&2,String>, +acc: String) -> String:
  match lines:
    case Nil{}:
      acc
    case line <> rest:
      Bool.pick(String, String.starts_with(line, "artifact="), CompileQueueResult.artifact_lines(rest, acc ++ line ++ "\n"), CompileQueueResult.artifact_lines(rest, acc))

def CompileQueueResult.artifact_rows(result: String) -> String:
  CompileQueueResult.artifact_lines(String.lines(result), "")

def CompileQueueResult.completed(result: String) -> Bool:
  Bool.and(String.eq(CompileQueueResult.field(result, "status"), "completed"), Bool.not(String.is_empty(CompileQueueResult.artifact_rows(result))))

def CompileQueueResult.base_verified(result: String, key: String) -> Bool:
  Bool.and(String.eq(CompileQueueResult.field(result, "schema"), CompileQueueResult.schema()),
    Bool.and(String.eq(CompileQueueResult.field(result, "identity_schema"), CompileQueueResult.identity_schema()),
      Bool.and(String.eq(CompileQueueResult.field(result, "key"), key),
        String.eq(CompileQueueResult.field(result, "verified"), "1"))))

def CompileQueueResult.external_verified(result: String, command: String, process: String, inputs: String, output: String, artifacts: String) -> Bool:
  Bool.and(String.eq(CompileQueueResult.field(result, "external"), "1"),
    Bool.and(String.eq(CompileQueueResult.field(result, "external-verified"), "1"),
      Bool.and(String.eq(CompileQueueResult.field(result, "external-command"), command),
        Bool.and(String.eq(CompileQueueResult.field(result, "external-process"), process),
          Bool.and(String.eq(CompileQueueResult.field(result, "external-inputs"), inputs),
            Bool.and(String.eq(CompileQueueResult.field(result, "external-output"), output),
              String.eq(CompileQueueResult.field(result, "external-artifacts"), artifacts)))))))

# A normal result is reusable after base_verified; an external result also
# needs every adoption field to match. Callers verify the cached artifact
# bytes separately with `verify`.
def CompileQueueResult.reusable(result: String, key: String, command: String, process: String, inputs: String, output: String, artifacts: String) -> Bool:
  Bool.and(CompileQueueResult.base_verified(result, key),
    Bool.pick(Bool, String.eq(CompileQueueResult.field(result, "external"), "1"), CompileQueueResult.external_verified(result, command, process, inputs, output, artifacts), True{}))

def CompileQueueResult.header(kind: String, key: String, verified: String, external: String) -> String:
  "schema=" ++ CompileQueueResult.schema() ++ "\n"
  ++ "identity_schema=" ++ CompileQueueResult.identity_schema() ++ "\n"
  ++ "kind=" ++ kind ++ "\n"
  ++ "key=" ++ key ++ "\n"
  ++ "verified=" ++ verified ++ "\n"
  ++ "external=" ++ external ++ "\n"

def CompileQueueResult.external_fields(verified: String, command: String, process: String, inputs: String, output: String, artifacts: String) -> String:
  "external-verified=" ++ verified ++ "\n"
  ++ "external-command=" ++ command ++ "\n"
  ++ "external-process=" ++ process ++ "\n"
  ++ "external-inputs=" ++ inputs ++ "\n"
  ++ "external-output=" ++ output ++ "\n"
  ++ "external-artifacts=" ++ artifacts ++ "\n"

def CompileQueueResult.verify_row(row: String, keydir: String) -> IO(Bool):
  fields = String.split(row, Char.from_u32(9))
  match fields:
    case name_field <> kind <> expected <> tail:
      Bool.pick(IO(Bool), String.is_empty(String.concat(tail)),
        do IO<Bool>:
          name = String.drop(name_field, String.length("artifact="))
          source = keydir ++ "/completed/artifacts/" ++ name
          seen : Result<&1,&1,U32 & String,String> <- Artifact.CompileQueueArtifact.kind(source)
          match seen:
            case Fail{error}:
              IO.pure(Bool, False{})
            case Done{kind_seen}:
              Bool.pick(IO(Bool), String.eq(kind, kind_seen),
                do IO<Bool>:
                  actual : Result<&1,&1,U32 & String,String> <- Artifact.CompileQueueArtifact.digest(source)
                  match actual:
                    case Fail{error}:
                      IO.pure(Bool, False{})
                    case Done{digest}:
                      IO.pure(Bool, String.eq(digest, expected)),
                IO.pure(Bool, False{})),
        IO.pure(Bool, False{}))
    case other:
      IO.pure(Bool, False{})

def CompileQueueResult.verify_rows(rows: List<&2,String>, keydir: String) -> IO(Bool):
  match rows:
    case Nil{}:
      IO.pure(Bool, True{})
    case row <> rest:
      Bool.pick(IO(Bool), String.is_empty(row),
        CompileQueueResult.verify_rows(rest, keydir),
        do IO<Bool>:
          ok : Bool <- CompileQueueResult.verify_row(row, keydir)
          Bool.pick(IO(Bool), ok, CompileQueueResult.verify_rows(rest, keydir), IO.pure(Bool, False{})))

def CompileQueueResult.acceptable(result: String, key: String, rows: String) -> Bool:
  Bool.and(CompileQueueResult.base_verified(result, key),
    Bool.and(CompileQueueResult.completed(result),
      Bool.and(Bool.not(String.is_empty(rows)),
        Bool.pick(Bool, String.eq(CompileQueueResult.field(result, "external"), "1"),
          String.eq(CompileQueueResult.field(result, "external-verified"), "1"), True{}))))

def CompileQueueResult.verify(keydir: String, key: String) -> IO(Bool):
  do IO<Bool>:
    read : Result<&1,&1,U32 & String,String> <- T.Text.read(keydir ++ "/completed/result")
    match read:
      case Fail{error}:
        IO.pure(Bool, False{})
      case Done{result}:
        rows = CompileQueueResult.artifact_rows(result)
        Bool.pick(IO(Bool), CompileQueueResult.acceptable(result, key, rows),
          CompileQueueResult.verify_rows(String.lines(rows), keydir),
          IO.pure(Bool, False{}))

def CompileQueueResult.write(path: String, text: String, temporary: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    written : Result<&1,&1,U32 & String,Unit> <- F.Files.write_private(temporary, text)
    match written:
      case Fail{error}:
        IO.pure(Result<&1,&1,U32 & String,Unit>, Fail{error})
      case Done{unit}:
        F.Files.rename(temporary, path)

def CompileQueueResult.install(source: String, destination: String, staging: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  Artifact.CompileQueueArtifact.install(source, destination, staging)
