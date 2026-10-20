import Base
import ../git/text.bend as Tx
import ../host/files.bend as F
import ../host/process.bend as P
import ./compile-queue-lifecycle.bend as L
import ./compile-queue-identity.bend as Identity
import ./compile-queue-result.bend as Result

# The identity seat declares schema(), source_closure, source_digest,
# file_closure, compiler_closure, file_digest, text_digest, key(material) and
# request_key(kind, cwd, root, source_root, entry, compiler, linker, version,
# inputs, aux, artifacts, options, command). The request_key export is the
# adapter used below; change only this adapter if its final shape differs. The
# identity is schema v2 and its keys do not match the shell reference keys; a
# shell completed result is evidence only.
#
# Result owns result formatting, parsing, verification, artifact copy and the
# adoption record. Exports used here: write, write_adoption, verify_completed,
# verify_adoption, copy_artifacts, retain_artifacts, retain_external,
# receipt_write, latest_result, report_failure.

type Split is Data:
  Split{left: String, right: String}

type QueuePair is Data:
  QueuePair{left: String, right: String}

type Input is Data:
  Input{source: String, destination: String}

type Artifact is Data:
  Artifact{name: String, path: String}

type InputRowCandidate is Data:
  ValidInputRow{value: Input}
  InvalidInputRow{}

type ArtifactRowCandidate is Data:
  ValidArtifactRow{value: Artifact}
  InvalidArtifactRow{}

type Config is Data:
  Config{text: String, command: List<&2,String>}

type StateKey is Data:
  StateKey{state: String, key: String}

type CancelArgs is Data:
  CancelArgs{state: String, key: String, token: String}

def non_empty(s: String) -> Bool:
  match s:
    case SNil{}: False{}
    case SCon{+c, +rest}: True{}

def non_empty_list(xs: List<&2,String>) -> Bool:
  match xs:
    case Nil{}: False{}
    case Con{head, rest}: True{}

def list_count(xs: List<&2,String>) -> U32:
  match xs:
    case Nil{}: 0
    case Con{head, rest}: U32.add(1, list_count(rest))

def split_eq(s: String, +acc: String) -> Maybe<&1,Split>:
  match s:
    case SNil{}: None{}
    case SCon{+c, +rest}:
      +is_eq = U32.is_eq(Char.to_u32(c), 61)
      Bool.pick(Maybe<&1,Split>, is_eq, Some{Split{acc, rest}},
        split_eq(rest, acc ++ SCon{c, SNil{}}))

def basename_go(s: String, acc: String) -> String:
  match s:
    case SNil{}: acc
    case SCon{+c, +rest}:
      +is_slash = U32.is_eq(Char.to_u32(c), 47)
      Bool.pick(String, is_slash, basename_go(rest, ""),
        basename_go(rest, acc ++ SCon{c, SNil{}}))

def basename(s: String) -> String:
  basename_go(s, "")

def token_char(c: Char) -> Bool:
  +code = Char.to_u32(c)
  +digit = Bool.and(U32.is_lt(47, code), U32.is_lt(code, 58))
  +upper = Bool.and(U32.is_lt(64, code), U32.is_lt(code, 91))
  +lower = Bool.and(U32.is_lt(96, code), U32.is_lt(code, 123))
  +mark = Bool.or(U32.is_eq(code, 46), Bool.or(U32.is_eq(code, 95), U32.is_eq(code, 45)))
  Bool.or(digit, Bool.or(upper, Bool.or(lower, mark)))

def token_ok_go(s: String) -> Bool:
  match s:
    case SNil{}: True{}
    case SCon{+c, +rest}: Bool.and(token_char(c), token_ok_go(rest))

def token_ok(+s: String) -> Bool:
  Bool.and(non_empty(s), token_ok_go(s))

# default_config emits one empty line per singleton field and config_line
# appends supplied values, so the supplied value for a singleton is the last
# matching line. Repeated fields (input, option, artifact, aux) are read with
# fields_all and keep every line.
def field_line_value(parsed: Maybe<&1,Split>, name: String, +acc: String) -> String:
  match parsed:
    case Some{Split{left, right}}:
      Bool.pick(String, Tx.str_eq(left, name), right, acc)
    case None{}: acc

def field_lines_go(lines: List<&1, String>, +name: String, +acc: String) -> String:
  match lines:
    case Nil{}: acc
    case line <> rest:
      field_lines_go(rest, name, field_line_value(split_eq(line, ""), name, acc))

def field_lines(lines: List<&1, String>, name: String) -> String:
  field_lines_go(lines, name, "")

def field(text: String, name: String) -> String:
  field_lines(Tx.split_lines(text), name)

def collect_line_value(parsed: Maybe<&1,Split>, name: String, +acc: List<&2,String>) -> List<&2,String>:
  match parsed:
    case Some{Split{left, right}}:
      Bool.pick(List<&2,String>, Tx.str_eq(left, name), Con{right, acc}, acc)
    case None{}: acc

def collect_lines(lines: List<&1, String>, +name: String, acc: List<&2,String>) -> List<&2,String>:
  match lines:
    case Nil{}: List.reverse(&2, String, acc)
    case line <> rest:
      collect_lines(rest, name, collect_line_value(split_eq(line, ""), name, acc))

def fields_all(text: String, name: String) -> List<&2,String>:
  collect_lines(Tx.split_lines(text), name, Nil{})

def input_row_candidate(parts: List<&1, String>) -> InputRowCandidate:
  match parts:
    case source <> destination <> Nil{}: ValidInputRow{Input{source, destination}}
    case other: InvalidInputRow{}

def artifact_row_candidate(parts: List<&1, String>) -> ArtifactRowCandidate:
  match parts:
    case name <> path <> Nil{}: ValidArtifactRow{Artifact{name, path}}
    case other: InvalidArtifactRow{}

def input_row_add(candidate: InputRowCandidate, acc: List<&2,Input>) -> List<&2,Input>:
  match candidate:
    case ValidInputRow{value}: Con{value, acc}
    case InvalidInputRow{}: acc

def artifact_row_add(candidate: ArtifactRowCandidate, acc: List<&2,Artifact>) -> List<&2,Artifact>:
  match candidate:
    case ValidArtifactRow{value}: Con{value, acc}
    case InvalidArtifactRow{}: acc

def input_rows_go(rows: List<&2,String>, acc: List<&2,Input>) -> List<&2,Input>:
  match rows:
    case Nil{}: List.reverse(&2, Input, acc)
    case +row <> rest:
      input_rows_go(rest, input_row_add(input_row_candidate(Tx.split_tabs(row)), acc))

def input_rows(text: String) -> List<&2,Input>:
  input_rows_go(fields_all(text, "input"), Nil{})

def artifact_rows_go(rows: List<&2,String>, acc: List<&2,Artifact>) -> List<&2,Artifact>:
  match rows:
    case Nil{}: List.reverse(&2, Artifact, acc)
    case +row <> rest:
      artifact_rows_go(rest, artifact_row_add(artifact_row_candidate(Tx.split_tabs(row)), acc))

def artifact_rows(text: String) -> List<&2,Artifact>:
  artifact_rows_go(fields_all(text, "artifact"), Nil{})

def artifact_components_ok(parts: List<&2,String>) -> Bool:
  match parts:
    case Nil{}: True{}
    case Con{+part, +rest}:
      +part_ok = Bool.and(token_ok(part),
        Bool.and(Bool.not(Tx.str_eq(part, ".")), Bool.not(Tx.str_eq(part, ".."))))
      Bool.and(part_ok, artifact_components_ok(rest))

def artifact_path_ok(+name: String) -> Bool:
  Bool.and(non_empty(name),
    Bool.and(Bool.not(Tx.starts_with(name, "/")),
      artifact_components_ok(String.split(name, Char.from_u32(47)))))

def artifact_paths_ok(artifacts: List<&2,Artifact>) -> Bool:
  match artifacts:
    case Nil{}: True{}
    case Con{Artifact{name, path}, rest}:
      Bool.and(artifact_path_ok(name), artifact_paths_ok(rest))

def artifact_set_valid(artifacts: List<&2,Artifact>) -> Bool:
  match artifacts:
    case Nil{}: False{}
    case Con{Artifact{name, path}, rest}:
      Bool.and(artifact_path_ok(name), artifact_paths_ok(rest))

def artifact_names(artifacts: List<&2,Artifact>) -> List<&2,String>:
  match artifacts:
    case Nil{}: Nil{}
    case Con{Artifact{name, path}, rest}: Con{name, artifact_names(rest)}

def names_text(names: List<&2,String>) -> String:
  match names:
    case Nil{}: ""
    case Con{+name, rest}: "artifact_name=" ++ name ++ "\n" ++ names_text(rest)

def artifact_paths_text(names: List<&2,String>) -> String:
  match names:
    case Nil{}: ""
    case Con{+name, Nil{}}: name
    case Con{+name, +rest}: name ++ "\n" ++ artifact_paths_text(rest)

def member_string(+value: String, values: List<&2,String>) -> Bool:
  match values:
    case Nil{}: False{}
    case Con{head, tail}: Bool.or(Tx.str_eq(value, head), member_string(value, tail))

def duplicate_go(inputs: List<&2,Input>, +seen: List<&2,String>) -> Bool:
  match inputs:
    case Nil{}: False{}
    case Con{Input{source, +destination}, rest}:
      Bool.pick(Bool, member_string(destination, seen), True{},
        duplicate_go(rest, Con{destination, seen}))

def duplicate_destinations(inputs: List<&2,Input>) -> Bool:
  duplicate_go(inputs, Nil{})

def config_line(config: Config, name: String, value: String) -> Config:
  match config:
    case Config{text, command}: Config{text ++ name ++ "=" ++ value ++ "\n", command}

def config_command(config: Config, command: List<&2,String>) -> Config:
  match config:
    case Config{text, other}: Config{text, command}

def config_input(config: Config, +source: String) -> Config:
  +destination = "inputs/" ++ basename(source)
  config_line(config, "input", source ++ "\t" ++ destination)

def default_config(state_root: String, cwd: String) -> Config:
  Config{"kind=\nstate_root=" ++ state_root ++ "\ncwd=" ++ cwd
    ++ "\nroot=\nsource_root=\nentry=\ncompiler=\nreceipt=\ntoken=\n", Nil{}}

def env_value_result(result: Result<&1,&1,U32 & String,String>) -> IO(String):
  match result:
    case Done{value}: IO.pure(String, value)
    case Fail{error}: IO.pure(String, "")

def env_value(name: String) -> IO(String):
  do IO<String>:
    result : Result<&1,&1,U32 & String,String> <- IO.get_env(name)
    env_value_result(result)

def valid_state_root(+root: String) -> Bool:
  Bool.and(non_empty(root), Tx.starts_with(root, "/"))

def default_state_root() -> IO(String):
  env_value("BATON_COMPILE_QUEUE_ROOT")

def fresh_config() -> IO(Config):
  do IO<Config>:
    state : String <- default_state_root()
    cwd : String <- IO.try(String, L.CompileQueueLifecycle.cwd())
    IO.pure(Config, default_config(state, cwd))

# require_state_root rejects a request whose flag differs from the host
# configuration, then verifies the configured directory is present, readable,
# writable and able to hold the queue lock. The queue never invents a state
# root: a missing host directory is a configuration failure.
def state_root_lock_result(opened: Result<&1,&1,U32 & String,U32>, state: String) -> IO(Unit):
  match opened:
    case Done{value}:
      do IO<Unit>:
        released : Unit <- IO.try(Unit, L.CompileQueueLifecycle.lock_release(value))
        IO.pure(Unit, Unit{})
    case Fail{(code, message)}:
      IO.die(Unit, 2, "compile-queue: state root cannot hold the queue lock: " ++ state ++ ": " ++ message)

def state_root_writable_result(writable: Result<&1,&1,U32 & String,Unit>, +state: String) -> IO(Unit):
  match writable:
    case Fail{(code, message)}:
      IO.die(Unit, 2, "compile-queue: state root is not writable: " ++ state ++ ": " ++ message)
    case Done{value}:
      do IO<Unit>:
        opened : Result<&1,&1,U32 & String,U32> <- L.CompileQueueLifecycle.lock_open(state ++ "/heavy.lock")
        state_root_lock_result(opened, state)

def state_root_listed_result(listed: Result<&1,&1,U32 & String,String>, +state: String) -> IO(Unit):
  match listed:
    case Fail{(code, message)}:
      IO.die(Unit, 2, "compile-queue: state root is missing or unreadable: " ++ state ++ ": " ++ message)
    case Done{value}:
      do IO<Unit>:
        writable : Result<&1,&1,U32 & String,Unit> <- F.Files.writable(state)
        state_root_writable_result(writable, state)

def require_state_root_configured(+configured: String, +state: String) -> IO(Unit):
  mismatch : Bool = Bool.and(non_empty(configured), Bool.not(Tx.str_eq(configured, state)))
  Bool.pick(IO(Unit), mismatch,
    IO.die(Unit, 2, "compile-queue: --state-root differs from BATON_COMPILE_QUEUE_ROOT"),
    do IO<Unit>:
      listed : Result<&1,&1,U32 & String,String> <- L.CompileQueueLifecycle.list_dir(state)
      state_root_listed_result(listed, state))

def require_state_root(state: String) -> IO(Unit):
  do IO<Unit>:
    configured : String <- default_state_root()
    require_state_root_configured(configured, state)

def artifact_option_config(parsed: Maybe<&1,Split>, +value: String, config: Config) -> IO(Config):
  match parsed:
    case Some{Split{name, +path}}: IO.pure(Config, config_line(config, "artifact", name ++ "\t" ++ path))
    case None{}: IO.die(Config, 2, "compile-queue: artifact must be NAME=PATH: " ++ value)

def parse_common(args: List<&2,String>, config: Config) -> IO(Config):
  match args:
    case Nil{}: IO.pure(Config, config)
    case "--" <> rest: IO.pure(Config, config_command(config, rest))
    case "--kind" <> value <> rest: parse_common(rest, config_line(config, "kind", value))
    case "--state-root" <> value <> rest: parse_common(rest, config_line(config, "state_root", value))
    case "--cwd" <> value <> rest: parse_common(rest, config_line(config, "cwd", value))
    case "--root" <> value <> rest: parse_common(rest, config_line(config, "root", value))
    case "--source-root" <> value <> rest: parse_common(rest, config_line(config, "source_root", value))
    case "--entry" <> value <> rest: parse_common(rest, config_line(config, "entry", value))
    case "--compiler" <> value <> rest: parse_common(rest, config_line(config, "compiler", value))
    case "--receipt" <> value <> rest: parse_common(rest, config_line(config, "receipt", value))
    case "--token" <> value <> rest: parse_common(rest, config_line(config, "token", value))
    case "--input" <> value <> rest: parse_common(rest, config_input(config, value))
    case "--aux" <> value <> rest: parse_common(rest, config_line(config, "aux", value))
    case "--option" <> value <> rest: parse_common(rest, config_line(config, "option", value))
    case "--artifact" <> +value <> rest:
      do IO<Config>:
        updated : Config <- artifact_option_config(split_eq(value, ""), value, config)
        parse_common(rest, updated)
    case +option <> rest: IO.die(Config, 2, "compile-queue: unknown option " ++ option)

def validate_config(config: Config, need_command: Bool) -> String:
  match config:
    case Config{+text, command}:
      +kind = field(text, "kind")
      +state = field(text, "state_root")
      +cwd = field(text, "cwd")
      +source = field(text, "source_root")
      +entry = field(text, "entry")
      artifacts = artifact_rows(text)
      inputs = input_rows(text)
      +token = field(text, "token")
      +kind_ok = Bool.or(Tx.str_eq(kind, "cgen"), Tx.str_eq(kind, "cc"))
      +command_ok = Bool.pick(Bool, need_command, non_empty_list(command), True{})
      +artifact_ok = artifact_set_valid(artifacts)
      +source_ok = Bool.pick(Bool, Tx.str_eq(kind, "cgen"),
        Bool.and(non_empty(source), non_empty(entry)), True{})
      +token_okay = Bool.pick(Bool, non_empty(token), token_ok(token), True{})
      +state_ok = valid_state_root(state)
      +cwd_ok = non_empty(cwd)
      +duplicates = duplicate_destinations(inputs)
      Bool.pick(String, kind_ok,
        Bool.pick(String, state_ok,
          Bool.pick(String, cwd_ok,
            Bool.pick(String, command_ok,
              Bool.pick(String, artifact_ok,
                Bool.pick(String, source_ok,
                  Bool.pick(String, token_okay,
                    Bool.pick(String, duplicates,
                      "compile-queue: two inputs share a destination basename",
                      ""),
                    "compile-queue: token must contain only letters, digits, dot, underscore or hyphen"),
                  "compile-queue: cgen requires --source-root and --entry"),
                "compile-queue: artifact names must be safe relative paths"),
              "compile-queue: a command is required after --"),
            "compile-queue: cwd is unavailable"),
          "compile-queue: set BATON_COMPILE_QUEUE_ROOT or pass an absolute --state-root"),
        "compile-queue: kind must be cgen or cc")

def input_pairs_text(inputs: List<&2,Input>) -> String:
  match inputs:
    case Nil{}: ""
    case Con{Input{source, destination}, rest}:
      source ++ "\t" ++ destination ++ "\n" ++ input_pairs_text(rest)

def artifact_pairs_text(artifacts: List<&2,Artifact>) -> String:
  match artifacts:
    case Nil{}: ""
    case Con{Artifact{name, path}, rest}:
      name ++ "\t" ++ path ++ "\n" ++ artifact_pairs_text(rest)

def fields_join_go(+separator: String, rows: List<&2,String>, +acc: String) -> String:
  match rows:
    case Nil{}: acc
    case Con{head, tail}: fields_join_go(separator, tail, acc ++ separator ++ head)

def fields_join(+separator: String, rows: List<&2,String>) -> String:
  match rows:
    case Nil{}: ""
    case Con{head, tail}: fields_join_go(separator, tail, head)

def artifact_name_match(+token: String, artifacts: List<&2,Artifact>) -> Maybe<&2, String>:
  match artifacts:
    case Nil{}: None{}
    case Con{Artifact{name, path}, rest}:
      Bool.pick(Maybe<&2, String>, Tx.str_eq(token, path), Some{name},
        artifact_name_match(token, rest))

def input_destination_match(+token: String, inputs: List<&2,Input>) -> Maybe<&2, String>:
  match inputs:
    case Nil{}: None{}
    case Con{Input{source, destination}, rest}:
      Bool.pick(Maybe<&2, String>, Tx.str_eq(token, source), Some{destination},
        input_destination_match(token, rest))

def prefix_token(+token: String, +prefix: String, marker: String) -> Maybe<&2, String>:
  Bool.pick(Maybe<&2, String>, Bool.and(non_empty(prefix), Tx.starts_with(token, prefix ++ "/")),
    Some{marker ++ "/" ++ String.drop(token, Nat.add(String.length(prefix), 1n))}, None{})

def normalize_after_cwd(result: Maybe<&2, String>, +token: String) -> String:
  match result:
    case Some{value}: value
    case None{}: token

def normalize_after_root(result: Maybe<&2, String>, +token: String, cwd: String) -> String:
  match result:
    case Some{value}: value
    case None{}: normalize_after_cwd(prefix_token(token, cwd, "@cwd"), token)

def normalize_prefix_token(+token: String, cwd: String, root: String) -> String:
  normalize_after_root(prefix_token(token, root, "@root"), token, cwd)

def normalize_after_input(result: Maybe<&2, String>, +token: String, cwd: String, root: String, compiler: String) -> String:
  match result:
    case Some{destination}: "{in:" ++ destination ++ "}"
    case None{}: Bool.pick(String, Tx.str_eq(token, compiler), "{compiler}", normalize_prefix_token(token, cwd, root))

def normalize_after_artifact(result: Maybe<&2, String>, +token: String, cwd: String, root: String, compiler: String,
                             inputs: List<&2,Input>) -> String:
  match result:
    case Some{name}: "{out:" ++ name ++ "}"
    case None{}: normalize_after_input(input_destination_match(token, inputs), token, cwd, root, compiler)

def normalize_token(+token: String, cwd: String, root: String, compiler: String,
                    inputs: List<&2,Input>, artifacts: List<&2,Artifact>) -> String:
  normalize_after_artifact(artifact_name_match(token, artifacts), token, cwd, root, compiler, inputs)

def normalize_command(args: List<&2,String>, +cwd: String, +root: String, +compiler: String,
                      +inputs: List<&2,Input>, +artifacts: List<&2,Artifact>) -> String:
  match args:
    case Nil{}: ""
    case Con{token, rest}:
      normalize_token(token, cwd, root, compiler, inputs, artifacts)
      ++ "\n" ++ normalize_command(rest, cwd, root, compiler, inputs, artifacts)


def keydir_of(state_root: String, key: String) -> String:
  state_root ++ "/keys/" ++ key

def identity_key(config: Config) -> IO(String):
  match config:
    case Config{+text, command}:
      +inputs = input_rows(text)
      +artifacts = artifact_rows(text)
      +cwd = field(text, "cwd")
      +root = field(text, "root")
      +compiler = field(text, "compiler")
      +linker = Bool.pick(String, String.eq(field(text, "kind"), "cc"),
        Bool.pick(String, non_empty(field(text, "linker")), field(text, "linker"), "ld"), "")
      IO.try(String, Identity.CompileQueueIdentity.request_key(
        field(text, "kind"), cwd, root,
        field(text, "source_root"), field(text, "entry"), compiler,
        linker, "", input_pairs_text(inputs),
        fields_join("\n", fields_all(text, "aux")),
        artifact_pairs_text(artifacts),
        fields_join("\n", fields_all(text, "option")),
        normalize_command(command, cwd, root, compiler, inputs, artifacts)))

def config_state(config: Config) -> String:
  match config:
    case Config{text, command}: field(text, "state_root")

def regular_result(result: Result<&1,&1,U32 & String,String>) -> IO(Bool):
  match result:
    case Done{value}: IO.pure(Bool, True{})
    case Fail{error}: IO.pure(Bool, False{})

def regular(path: String) -> IO(Bool):
  do IO<Bool>:
    result : Result<&1,&1,U32 & String,String> <- F.Files.regular(path)
    regular_result(result)

def copy_inputs(+work: String, inputs: List<&2,Input>) -> IO(Unit):
  match inputs:
    case Nil{}: IO.pure(Unit, Unit{})
    case Con{Input{+source, destination}, rest}:
      do IO<Unit>:
        +target : String <- IO.pure(String, work ++ "/" ++ destination)
        copied : Unit <- IO.try(Unit, L.CompileQueueLifecycle.copy_file(source, target))
        source_digest : String <- IO.try(String, Identity.CompileQueueIdentity.file_digest(source))
        target_digest : String <- IO.try(String, Identity.CompileQueueIdentity.file_digest(target))
        Bool.pick(IO(Unit), Tx.str_eq(source_digest, target_digest),
          copy_inputs(work, rest),
          IO.die(Unit, 1, "compile-queue: input changed while staging"))

def artifact_match(+token: String, +work: String, artifacts: List<&2,Artifact>) -> Maybe<&2, String>:
  match artifacts:
    case Nil{}: None{}
    case Con{Artifact{name, path}, rest}:
      Bool.pick(Maybe<&2, String>, Tx.str_eq(token, path), Some{work ++ "/" ++ name},
        artifact_match(token, work, rest))

def input_match(+token: String, +work: String, inputs: List<&2,Input>) -> Maybe<&2, String>:
  match inputs:
    case Nil{}: None{}
    case Con{Input{source, destination}, rest}:
      Bool.pick(Maybe<&2, String>, Tx.str_eq(token, source), Some{work ++ "/" ++ destination},
        input_match(token, work, rest))

def replace_after_input(result: Maybe<&2, String>, token: String) -> String:
  match result:
    case Some{value}: value
    case None{}: token

def replace_after_artifact(result: Maybe<&2, String>, +token: String, +work: String, inputs: List<&2,Input>) -> String:
  match result:
    case Some{value}: value
    case None{}: replace_after_input(input_match(token, work, inputs), token)

def replace_token(+token: String, +work: String, inputs: List<&2,Input>, artifacts: List<&2,Artifact>) -> String:
  replace_after_artifact(artifact_match(token, work, artifacts), token, work, inputs)

def command_text(args: List<&2,String>, +work: String, +inputs: List<&2,Input>, +artifacts: List<&2,Artifact>) -> String:
  match args:
    case Nil{}: ""
    case Con{token, rest}:
      +value = replace_token(token, work, inputs, artifacts)
      +tail = command_text(rest, work, inputs, artifacts)
      value ++ "\n" ++ tail

def meta_text(config: Config, key: String, keydir: String, attempt: String, artifacts: List<&2,Artifact>) -> String:
  match config:
    case Config{+text, command}:
      "kind=" ++ field(text, "kind") ++ "\n"
      ++ "cwd=" ++ field(text, "cwd") ++ "\n"
      ++ "source_root=" ++ field(text, "source_root") ++ "\n"
      ++ "entry=" ++ field(text, "entry") ++ "\n"
      ++ "key=" ++ key ++ "\n"
      ++ "keydir=" ++ keydir ++ "\n"
      ++ "attempt=" ++ attempt ++ "\n"
      ++ names_text(artifact_names(artifacts))

def write_attempt_digest(attempt: String, +text: String) -> IO(Unit):
  do IO<Unit>:
    source_root : String <- IO.pure(String, field(text, "source_root"))
    entry : String <- IO.pure(String, field(text, "entry"))
    digest : String <- IO.try(String, Identity.CompileQueueIdentity.source_digest(source_root, entry))
    IO.try(Unit, L.CompileQueueLifecycle.write_text(attempt ++ "/source-digest", "digest=" ++ digest ++ "\n"))

def write_attempt_files(+config: Config, +key: String, keydir: String, +attempt: String) -> IO(Unit):
  match config:
    case Config{+text, command}:
      do IO<Unit>:
        +work : String <- IO.pure(String, attempt ++ "/work")
        +inputs : List<&2,Input> <- IO.pure(List<&2,Input>, input_rows(text))
        +artifacts : List<&2,Artifact> <- IO.pure(List<&2,Artifact>, artifact_rows(text))
        made : Unit <- IO.try(Unit, L.CompileQueueLifecycle.mkdir_p(work ++ "/inputs"))
        staged : Unit <- copy_inputs(work, inputs)
        rechecked : String <- identity_key(config)
        checked : Unit <- Bool.pick(IO(Unit), Tx.str_eq(rechecked, key), IO.pure(Unit, Unit{}),
          IO.die(Unit, 1, "compile-queue: inputs changed before execution"))
        wrote_command : Unit <- IO.try(Unit, L.CompileQueueLifecycle.write_text(attempt ++ "/command", command_text(command, work, inputs, artifacts)))
        wrote_meta : Unit <- IO.try(Unit, L.CompileQueueLifecycle.write_text(attempt ++ "/meta", meta_text(config, key, keydir, attempt, artifacts)))
        digest_written : Unit <- Bool.pick(IO(Unit), Tx.str_eq(field(text, "kind"), "cgen"),
          write_attempt_digest(attempt, text), IO.pure(Unit, Unit{}))
        IO.pure(Unit, Unit{})

def owner_lock(keydir: String) -> IO(U32):
  IO.try(U32, L.CompileQueueLifecycle.lock_acquire(keydir ++ "/owners.lock"))

def publish_token(+keydir: String, +requested: String) -> IO(String):
  do IO<String>:
    made_keydir : Unit <- IO.try(Unit, L.CompileQueueLifecycle.mkdir_p(keydir))
    lock : U32 <- owner_lock(keydir)
    +pid : U32 <- IO.try(U32, L.CompileQueueLifecycle.pid())
    +now : String <- IO.try(String, L.CompileQueueLifecycle.now_ns())
    start : String <- IO.try(String, L.CompileQueueLifecycle.starttime(pid))
    +token : String <- IO.pure(String, Bool.pick(String, non_empty(requested), requested,
      "owner-" ++ U32.show(pid) ++ "-" ++ now))
    made : Unit <- IO.try(Unit, L.CompileQueueLifecycle.mkdir_p(keydir ++ "/owners"))
    +owner_path : String <- IO.pure(String, keydir ++ "/owners/" ++ token)
    exists : Bool <- regular(owner_path)
    checked : Unit <- Bool.pick(IO(Unit), exists,
      IO.die(Unit, 2, "compile-queue: owner token is already in use"), IO.pure(Unit, Unit{}))
    wrote : Unit <- IO.try(Unit, L.CompileQueueLifecycle.write_text(owner_path,
      "pid=" ++ U32.show(pid) ++ "\nstarttime=" ++ start ++ "\nstarted_ns=" ++ now ++ "\n"))
    released : Unit <- IO.try(Unit, L.CompileQueueLifecycle.lock_release(lock))
    IO.pure(String, token)

def remove_token_unlocked(keydir: String, +token: String) -> IO(Unit):
  Bool.pick(IO(Unit), non_empty(token),
    IO.try(Unit, L.CompileQueueLifecycle.remove(keydir ++ "/owners/" ++ token)), IO.pure(Unit, Unit{}))

def remove_token(+keydir: String, token: String) -> IO(Unit):
  do IO<Unit>:
    lock : U32 <- owner_lock(keydir)
    removed : Unit <- remove_token_unlocked(keydir, token)
    released : Unit <- IO.try(Unit, L.CompileQueueLifecycle.lock_release(lock))
    IO.pure(Unit, Unit{})

def remove_stale_owner(keydir: String, name: String) -> IO(U32):
  do IO<U32>:
    removed : Unit <- IO.try(Unit, L.CompileQueueLifecycle.remove(keydir ++ "/owners/" ++ name))
    IO.pure(U32, 0)

def count_live_owner_pid(parsed: Maybe<&2,U32>, keydir: String, name: String, start: String) -> IO(U32):
  match parsed:
    case None{}:
      do IO<U32>:
        removed : Unit <- IO.try(Unit, L.CompileQueueLifecycle.remove(keydir ++ "/owners/" ++ name))
        IO.pure(U32, 0)
    case Some{+pid}:
      do IO<U32>:
        alive : U32 <- IO.try(U32, L.CompileQueueLifecycle.alive(pid, start))
        Bool.pick(IO(U32), U32.is_eq(alive, 1), IO.pure(U32, 1),
          remove_stale_owner(keydir, name))

def count_live_owner(+keydir: String, +name: String) -> IO(U32):
  do IO<U32>:
    path : String <- IO.pure(String, keydir ++ "/owners/" ++ name)
    +text : String <- IO.try(String, L.CompileQueueLifecycle.read_text(path))
    pid_text : String <- IO.pure(String, field(text, "pid"))
    start : String <- IO.pure(String, field(text, "starttime"))
    count_live_owner_pid(U32.read(pid_text), keydir, name, start)

def count_live_owners(+keydir: String, names: List<&1,String>, acc: U32) -> IO(U32):
  match names:
    case Nil{}: IO.pure(U32, acc)
    case Con{+name, rest}:
      do IO<U32>:
        count : U32 <- count_live_owner(keydir, name)
        count_live_owners(keydir, rest, U32.add(count, acc))

def owner_count(+keydir: String) -> IO(U32):
  do IO<U32>:
    names : String <- IO.try(String, L.CompileQueueLifecycle.list_dir(keydir ++ "/owners"))
    count_live_owners(keydir, Tx.split_lines(names), 0)

def clean_stale_active_alive(pid: U32, active: String, start: String) -> IO(Unit):
  do IO<Unit>:
    alive : U32 <- IO.try(U32, L.CompileQueueLifecycle.alive(pid, start))
    removed : Unit <- Bool.pick(IO(Unit), U32.is_eq(alive, 1), IO.pure(Unit, Unit{}),
      IO.try(Unit, L.CompileQueueLifecycle.remove(active)))
    IO.pure(Unit, Unit{})

def clean_stale_active_pid(parsed: Maybe<&2,U32>, active: String, start: String) -> IO(Unit):
  match parsed:
    case None{}:
      do IO<Unit>:
        removed : Unit <- IO.try(Unit, L.CompileQueueLifecycle.remove(active))
        IO.pure(Unit, Unit{})
    case Some{+pid}: clean_stale_active_alive(pid, active, start)

def clean_stale_active(keydir: String) -> IO(Unit):
  do IO<Unit>:
    +active : String <- IO.pure(String, keydir ++ "/active")
    +text : String <- IO.try(String, L.CompileQueueLifecycle.read_text(active))
    pid_text : String <- IO.pure(String, field(text, "pid"))
    start : String <- IO.pure(String, field(text, "starttime"))
    clean_stale_active_pid(U32.read(pid_text), active, start)

def write_failure(+attempt: String, +keydir: String, status: String, code: U32,
                  kind: String, key: String, started: String, detail: String,
                  +names: List<&2,String>) -> IO(Unit):
  do IO<Unit>:
    finished : String <- IO.try(String, L.CompileQueueLifecycle.now_ns())
    wrote : Unit <- IO.try(Unit, Result.CompileQueueResult.write(attempt ++ "/result", status, U32.show(code), kind, key, started,
      finished, attempt, attempt ++ "/work", attempt ++ "/stdout", attempt ++ "/stderr",
      detail, artifact_paths_text(names)))
    removed : Unit <- IO.try(Unit, L.CompileQueueLifecycle.remove(keydir ++ "/active"))
    IO.pure(Unit, Unit{})

def finish_success(+attempt: String, +keydir: String, +kind: String, +key: String,
                    +started: String, +names: List<&2,String>) -> IO(Unit):
  do IO<Unit>:
    +pid : U32 <- IO.try(U32, L.CompileQueueLifecycle.pid())
    +work : String <- IO.pure(String, attempt ++ "/work")
    +cache : String <- IO.pure(String, keydir ++ "/completed.tmp." ++ U32.show(pid))
    made : Unit <- IO.try(Unit, L.CompileQueueLifecycle.mkdir_p(cache ++ "/artifacts"))
    retained : Unit <- IO.try(Unit, Result.CompileQueueResult.retain_artifacts(work, cache ++ "/artifacts", artifact_paths_text(names)))
    finished : String <- IO.try(String, L.CompileQueueLifecycle.now_ns())
    wrote : Unit <- IO.try(Unit, Result.CompileQueueResult.write(cache ++ "/result", "completed", "0", kind, key, started,
      finished, attempt, work, attempt ++ "/stdout", attempt ++ "/stderr", "", artifact_paths_text(names)))
    copied_out : Unit <- IO.try(Unit, L.CompileQueueLifecycle.copy_file(attempt ++ "/stdout", cache ++ "/stdout"))
    copied_err : Unit <- IO.try(Unit, L.CompileQueueLifecycle.copy_file(attempt ++ "/stderr", cache ++ "/stderr"))
    renamed : Unit <- IO.try(Unit, F.Files.rename(cache, keydir ++ "/completed"))
    copied_result : Unit <- IO.try(Unit, L.CompileQueueLifecycle.copy_file(keydir ++ "/completed/result", attempt ++ "/result"))
    removed : Unit <- IO.try(Unit, L.CompileQueueLifecycle.remove(keydir ++ "/active"))
    IO.pure(Unit, Unit{})

def artifact_mode_check(mode: Result<&1,&1,U32 & String,U32>, name: String) -> IO(Unit):
  match mode:
    case Done{value}: IO.pure(Unit, Unit{})
    case Fail{error}: IO.die(Unit, 1, "compile-queue: artifact " ++ name ++ " was not written")

def verify_artifacts(+work: String, names: List<&2,String>) -> IO(Unit):
  match names:
    case Nil{}: IO.pure(Unit, Unit{})
    case Con{+name, rest}:
      do IO<Unit>:
        mode : Result<&1,&1,U32 & String,U32> <- F.Files.mode_of(work ++ "/" ++ name)
        checked : Unit <- artifact_mode_check(mode, name)
        verify_artifacts(work, rest)

def verify_and_finish(+attempt: String, +keydir: String, +kind: String, +key: String,
                       +started: String, +names: List<&2,String>) -> IO(Unit):
  do IO<Unit>:
    checked : Unit <- verify_artifacts(attempt ++ "/work", names)
    finish_success(attempt, keydir, kind, key, started, names)

def supervised_completion(canceled: Bool, failed: Bool, +code: U32, disposition: String,
                          +attempt: String, +keydir: String, +kind: String, +key: String,
                           +started: String, +names: List<&2,String>) -> IO(Unit):
  Bool.pick(IO(Unit), canceled,
    write_failure(attempt, keydir, "canceled", 130, kind, key, started,
      "execution canceled", names),
    Bool.pick(IO(Unit), failed,
      write_failure(attempt, keydir, "failed", code, kind, key, started,
        "command " ++ disposition ++ " " ++ U32.show(code), names),
      verify_and_finish(attempt, keydir, kind, key, started, names)))

def supervised_result(outcome: Result<&1,&1,U32 & String,U32 & String>, attempt: String,
                      keydir: String, kind: String, key: String, started: String,
                      names: List<&2,String>, cwd: String) -> IO(Unit):
  match outcome:
    case Fail{error}:
      write_failure(attempt, keydir, "failed", 1, kind, key, started,
        "command could not start", names)
    case Done{(+code, +disposition)}:
      +canceled = Tx.str_eq(disposition, "canceled")
      +failed = Bool.and(Bool.not(canceled), Bool.not(U32.is_eq(code, 0)))
      supervised_completion(canceled, failed, code, disposition, attempt, keydir, kind, key, started, names)

def run_supervised(+attempt: String, +keydir: String, +kind: String, +key: String,
                   started: String, names: List<&2,String>, +cwd: String) -> IO(Unit):
  do IO<Unit>:
    text : String <- IO.try(String, L.CompileQueueLifecycle.read_text(attempt ++ "/command"))
    argv : String <- IO.pure(String, P.argv(Tx.split_lines(text)))
    outcome : Result<&1,&1,U32 & String,U32 & String> <- L.CompileQueueLifecycle.run_command(
      argv, cwd, attempt ++ "/stdout", attempt ++ "/stderr")
    supervised_result(outcome, attempt, keydir, kind, key, started, names, cwd)

def supervise_kind(+kind: String, source_root: String, entry: String, +attempt: String,
                    +keydir: String, +key: String, +started: String, +names: List<&2,String>, +cwd: String) -> IO(Unit):
  Bool.pick(IO(Unit), Tx.str_eq(kind, "cgen"),
    do IO<Unit>:
      before : String <- IO.try(String, L.CompileQueueLifecycle.read_text(attempt ++ "/source-digest"))
      before_digest : String <- IO.pure(String, field(before, "digest"))
      after : String <- IO.try(String, Identity.CompileQueueIdentity.source_digest(source_root, entry))
      Bool.pick(IO(Unit), Tx.str_eq(before_digest, after),
        run_supervised(attempt, keydir, kind, key, started, names, cwd),
        write_failure(attempt, keydir, "failed", 1, kind, key, started,
          "source changed before execution", names)),
    run_supervised(attempt, keydir, kind, key, started, names, cwd))

def supervise_owned(+attempt: String, +keydir: String, +kind: String, source_root: String,
                    entry: String, key: String, +started: String, names: List<&2,String>,
                    cwd: String, pid: U32, start: String, +gate: U32) -> IO(Unit):
  do IO<Unit>:
    active_text : String <- IO.pure(String, "pid=" ++ U32.show(pid)
      ++ "\nstarttime=" ++ start ++ "\nkind=" ++ kind ++ "\nsetsid=1\nstarted_ns=" ++ started ++ "\n")
    active : Unit <- IO.try(Unit, L.CompileQueueLifecycle.write_text(keydir ++ "/active", active_text))
    released : Unit <- IO.try(Unit, L.CompileQueueLifecycle.lock_release(gate))
    locked : Unit <- IO.try(Unit, L.CompileQueueLifecycle.lock_fd_acquire(8))
    supervise_kind(kind, source_root, entry, attempt, keydir, key, started, names, cwd)

def supervise_owner_count(owners: U32, +attempt: String, +keydir: String, +kind: String,
                          source_root: String, entry: String, +key: String, +started: String,
                          +names: List<&2,String>, cwd: String, pid: U32, start: String,
                          +gate: U32) -> IO(Unit):
  Bool.pick(IO(Unit), U32.is_eq(owners, 0),
    do IO<Unit>:
      released : Unit <- IO.try(Unit, L.CompileQueueLifecycle.lock_release(gate))
      write_failure(attempt, keydir, "canceled", 130, kind, key, started,
        "all requesters canceled before execution", names),
    supervise_owned(attempt, keydir, kind, source_root, entry, key, started, names, cwd, pid, start, gate))

def supervise(+attempt: String) -> IO(Unit):
  do IO<Unit>:
    +meta : String <- IO.try(String, L.CompileQueueLifecycle.read_text(attempt ++ "/meta"))
    kind : String <- IO.pure(String, field(meta, "kind"))
    cwd : String <- IO.pure(String, field(meta, "cwd"))
    source_root : String <- IO.pure(String, field(meta, "source_root"))
    entry : String <- IO.pure(String, field(meta, "entry"))
    key : String <- IO.pure(String, field(meta, "key"))
    +keydir : String <- IO.pure(String, field(meta, "keydir"))
    names : List<&2,String> <- IO.pure(List<&2,String>, fields_all(meta, "artifact_name"))
    started : String <- IO.try(String, L.CompileQueueLifecycle.now_ns())
    +pid : U32 <- IO.try(U32, L.CompileQueueLifecycle.pid())
    start : String <- IO.try(String, L.CompileQueueLifecycle.starttime(pid))
    gate : U32 <- owner_lock(keydir)
    owners : U32 <- owner_count(keydir)
    supervise_owner_count(owners, attempt, keydir, kind, source_root, entry, key,
      started, names, cwd, pid, start, gate)

def start_attempt_result_exists(exists: Bool, +text: String, +key: String, +keydir: String,
                                +attempt: String, +owner: String, now: String) -> IO(Unit):
  Bool.pick(IO(Unit), exists,
    do IO<Unit>:
      removed : Unit <- remove_token(keydir, owner)
      Result.CompileQueueResult.report_failure(attempt ++ "/result"),
    do IO<Unit>:
      left : U32 <- owner_count(keydir)
      +was_canceled : Bool <- IO.pure(Bool, U32.is_eq(left, 0))
      wrote : Unit <- write_failure(attempt, keydir,
        Bool.pick(String, was_canceled, "canceled", "failed"),
        Bool.pick(U32, was_canceled, 130, 1), field(text, "kind"), key, now,
        Bool.pick(String, was_canceled,
          "all requesters canceled before a terminal result",
          "supervisor exited before publishing a terminal result"),
        artifact_names(artifact_rows(text)))
      removed : Unit <- remove_token(keydir, owner)
      Result.CompileQueueResult.report_failure(attempt ++ "/result"))

def start_attempt_missing_result(text: String, key: String, keydir: String,
                                +attempt: String, +owner: String, now: String) -> IO(Unit):
  do IO<Unit>:
    exists : Bool <- regular(attempt ++ "/result")
    start_attempt_result_exists(exists, text, key, keydir, attempt, owner, now)

def start_attempt_completed(completed: Bool, +text: String, +key: String,
                            +keydir: String, +attempt: String, +owner: String, now: String) -> IO(Unit):
  match completed:
    case True{}:
      do IO<Unit>:
        copied : Unit <- IO.try(Unit, Result.CompileQueueResult.copy_artifacts(keydir, Result.CompileQueueResult.artifact_rows(text)))
        receipt : Unit <- IO.try(Unit, Result.CompileQueueResult.receipt_write(field(text, "receipt"), "completed", key, "0", owner, Result.CompileQueueResult.artifact_rows(text)))
        removed : Unit <- remove_token(keydir, owner)
        IO.pure(Unit, Unit{})
    case False{}: start_attempt_missing_result(text, key, keydir, attempt, owner, now)

def start_attempt_config(config: Config, +text: String, +key: String, +keydir: String,
                         +lock: U32, owner: String) -> IO(Unit):
  do IO<Unit>:
    +now : String <- IO.try(String, L.CompileQueueLifecycle.now_ns())
    +pid : U32 <- IO.try(U32, L.CompileQueueLifecycle.pid())
    +attempt : String <- IO.pure(String, keydir ++ "/runs/" ++ now ++ "-" ++ U32.show(pid))
    state : String <- IO.pure(String, field(text, "state_root"))
    made : Unit <- IO.try(Unit, L.CompileQueueLifecycle.mkdir_p(attempt ++ "/work"))
    prepared : Unit <- write_attempt_files(config, key, keydir, attempt)
    +heavy : U32 <- IO.try(U32, L.CompileQueueLifecycle.lock_open(state ++ "/heavy.lock"))
    args : String <- IO.pure(String, P.argv(Con{"__supervise", Con{attempt, Nil{}}}))
    supervisor : U32 <- IO.try(U32, L.CompileQueueLifecycle.spawn_detached(args, lock, heavy))
    released_lock : Unit <- IO.try(Unit, L.CompileQueueLifecycle.close_fd(lock))
    released_heavy : Unit <- IO.try(Unit, L.CompileQueueLifecycle.close_fd(heavy))
    waited : U32 <- IO.try(U32, L.CompileQueueLifecycle.wait_pid(supervisor))
    completed : Bool <- IO.try(Bool, Result.CompileQueueResult.verify_completed(keydir))
    start_attempt_completed(completed, text, key, keydir, attempt, owner, now)

def start_attempt(+config: Config, key: String, keydir: String, lock: U32, owner: String) -> IO(Unit):
  match config:
    case Config{text, command}: start_attempt_config(config, text, key, keydir, lock, owner)
    case other: IO.die(Unit, 2, "compile-queue: malformed configuration")

def run_latest_result(latest: String, parsed: Config, key: String, keydir: String,
                      lock: U32, owner: String) -> IO(Unit):
  match latest:
    case SNil{}: start_attempt(parsed, key, keydir, lock, owner)
    case path:
      do IO<Unit>:
        removed : Unit <- remove_token(keydir, owner)
        released : Unit <- IO.try(Unit, L.CompileQueueLifecycle.lock_release(lock))
        Result.CompileQueueResult.report_failure(path)

def run_completed_result(completed: Bool, +text: String, +parsed: Config, +key: String,
                         +keydir: String, +owner: String, wait_start: String,
                         present: Bool, lock: U32) -> IO(Unit):
  match completed:
    case True{}:
      do IO<Unit>:
        copied : Unit <- IO.try(Unit, Result.CompileQueueResult.copy_artifacts(keydir, Result.CompileQueueResult.artifact_rows(text)))
        receipt : Unit <- IO.try(Unit, Result.CompileQueueResult.receipt_write(field(text, "receipt"), "completed", key, "1", owner, Result.CompileQueueResult.artifact_rows(text)))
        removed : Unit <- remove_token(keydir, owner)
        released : Unit <- IO.try(Unit, L.CompileQueueLifecycle.lock_release(lock))
        IO.pure(Unit, Unit{})
    case False{}:
      do IO<Unit>:
        latest : String <- IO.try(String, Result.CompileQueueResult.latest_result(keydir, wait_start, Bool.pick(String, present, "1", "0")))
        run_latest_result(latest, parsed, key, keydir, lock, owner)

def run_config_locked(parsed: Config, +text: String, +key: String) -> IO(Unit):
  do IO<Unit>:
    state : String <- IO.pure(String, field(text, "state_root"))
    +keydir : String <- IO.pure(String, keydir_of(state, key))
    +owner : String <- publish_token(keydir, field(text, "token"))
    owner_line : Unit <- IO.try(Unit, L.CompileQueueLifecycle.write_stderr("owner=" ++ owner ++ "\n"))
    wait_start : String <- IO.try(String, L.CompileQueueLifecycle.now_ns())
    present : Bool <- regular(keydir ++ "/active")
    made : Unit <- IO.try(Unit, L.CompileQueueLifecycle.mkdir_p(keydir ++ "/runs"))
    lock : U32 <- IO.try(U32, L.CompileQueueLifecycle.lock_acquire(keydir ++ "/lock"))
    cleaned : Unit <- clean_stale_active(keydir)
    completed : Bool <- IO.try(Bool, Result.CompileQueueResult.verify_completed(keydir))
    run_completed_result(completed, text, parsed, key, keydir, owner, wait_start, present, lock)

def run_parsed_config(+parsed: Config, key: String) -> IO(Unit):
  match parsed:
    case Config{text, command}: run_config_locked(parsed, text, key)
    case other: IO.die(Unit, 2, "compile-queue: malformed configuration")

def run_config_validation(+parsed: Config, invalid: String) -> IO(Unit):
  match invalid:
    case SNil{}:
      do IO<Unit>:
        ready : Unit <- require_state_root(config_state(parsed))
        key : String <- identity_key(parsed)
        run_parsed_config(parsed, key)
    case error: IO.die(Unit, 2, error)

def run_command(args: List<&2,String>) -> IO(Unit):
  do IO<Unit>:
    config : Config <- fresh_config()
    +parsed : Config <- parse_common(args, config)
    invalid : String <- IO.pure(String, validate_config(parsed, True{}))
    run_config_validation(parsed, invalid)

def key_validation(parsed: Config, invalid: String) -> IO(Unit):
  match invalid:
    case SNil{}:
      do IO<Unit>:
        key : String <- identity_key(parsed)
        IO.write(key ++ "\n")
    case error: IO.die(Unit, 2, error)

def key_command(args: List<&2,String>) -> IO(Unit):
  do IO<Unit>:
    config : Config <- fresh_config()
    +parsed : Config <- parse_common(args, config)
    invalid : String <- IO.pure(String, validate_config(parsed, False{}))
    key_validation(parsed, invalid)

def parse_state_key(args: List<&2,String>, +state: String, +key: String) -> IO(StateKey):
  match args:
    case Nil{}:
      Bool.pick(IO(StateKey), valid_state_root(state),
        IO.pure(StateKey, StateKey{state, key}),
        IO.die(StateKey, 2, "compile-queue: set BATON_COMPILE_QUEUE_ROOT or pass an absolute --state-root"))
    case "--state-root" <> value <> rest: parse_state_key(rest, value, key)
    case "--key" <> value <> rest: parse_state_key(rest, state, value)
    case +option <> rest: IO.die(StateKey, 2, "compile-queue: unknown option " ++ option)

def wait_result_path(latest: String, key: String, lock: U32) -> IO(Unit):
  match latest:
    case SNil{}: IO.die(Unit, 4, "compile-queue: no result for key " ++ key)
    case path:
      do IO<Unit>:
        released : Unit <- IO.try(Unit, L.CompileQueueLifecycle.lock_release(lock))
        Result.CompileQueueResult.report_failure(path)

def wait_completed(completed: Bool, key: String, keydir: String, lock: U32) -> IO(Unit):
  match completed:
    case True{}:
      do IO<Unit>:
        released : Unit <- IO.try(Unit, L.CompileQueueLifecycle.lock_release(lock))
        IO.write("status=completed\nkey=" ++ key ++ "\n")
    case False{}:
      do IO<Unit>:
        latest : String <- IO.try(String, Result.CompileQueueResult.latest_result(keydir, "0", "0"))
        wait_result_path(latest, key, lock)

def wait_state_key(state: String, +key: String) -> IO(Unit):
  Bool.pick(IO(Unit), non_empty(key),
    do IO<Unit>:
      +keydir : String <- IO.pure(String, keydir_of(state, key))
      lock : U32 <- IO.try(U32, L.CompileQueueLifecycle.lock_acquire(keydir ++ "/lock"))
      cleaned : Unit <- clean_stale_active(keydir)
      completed : Bool <- IO.try(Bool, Result.CompileQueueResult.verify_completed(keydir))
      wait_completed(completed, key, keydir, lock),
    IO.die(Unit, 2, "compile-queue: wait requires --key"))

def wait_parsed(parsed: StateKey) -> IO(Unit):
  match parsed:
    case StateKey{state, key}: wait_state_key(state, key)

def wait_command(args: List<&2,String>) -> IO(Unit):
  do IO<Unit>:
    state : String <- default_state_root()
    parsed : StateKey <- parse_state_key(args, state, "")
    wait_parsed(parsed)

def parse_cancel(args: List<&2,String>, +state: String, +key: String, +token: String) -> IO(CancelArgs):
  match args:
    case Nil{}:
      Bool.pick(IO(CancelArgs), valid_state_root(state),
        IO.pure(CancelArgs, CancelArgs{state, key, token}),
        IO.die(CancelArgs, 2, "compile-queue: set BATON_COMPILE_QUEUE_ROOT or pass an absolute --state-root"))
    case "--state-root" <> value <> rest: parse_cancel(rest, value, key, token)
    case "--key" <> value <> rest: parse_cancel(rest, state, value, token)
    case "--token" <> value <> rest: parse_cancel(rest, state, key, value)
    case +option <> rest: IO.die(CancelArgs, 2, "compile-queue: unknown option " ++ option)

def cancel_active_signal(+pid: U32, +start: String, +key: String, +token: String, +mode: String) -> IO(String):
  do IO<String>:
    external : Bool <- IO.pure(Bool, Bool.or(Tx.str_eq(mode, "external"), Tx.str_eq(mode, "starting")))
    Bool.pick(IO(String), external,
      IO.pure(String, "canceled=refused\nkey=" ++ key ++ "\nreason=external-or-starting\n"),
      do IO<String>:
        signaled : Unit <- Bool.pick(IO(Unit), Tx.str_eq(mode, "1"),
          IO.try(Unit, L.CompileQueueLifecycle.signal_group(pid, 15)), IO.try(Unit, L.CompileQueueLifecycle.signal_pid(pid, 15)))
        slept : Unit <- IO.try(Unit, L.CompileQueueLifecycle.sleep_millis(3000))
        alive2 : U32 <- IO.try(U32, L.CompileQueueLifecycle.alive(pid, start))
        escalated : Unit <- Bool.pick(IO(Unit), U32.is_eq(alive2, 0), IO.pure(Unit, Unit{}),
          Bool.pick(IO(Unit), Tx.str_eq(mode, "1"),
            IO.try(Unit, L.CompileQueueLifecycle.signal_group(pid, 9)), IO.try(Unit, L.CompileQueueLifecycle.signal_pid(pid, 9))))
        IO.pure(String, "canceled=requested\nkey=" ++ key ++ "\npid=" ++ U32.show(pid) ++ "\ntoken=" ++ token ++ "\n"))

def cancel_active_alive(alive: U32, +pid: U32, +start: String, +key: String,
                        +token: String, +text: String) -> IO(String):
  Bool.pick(IO(String), U32.is_eq(alive, 1),
    do IO<String>:
      mode : String <- IO.pure(String, field(text, "setsid"))
      cancel_active_signal(pid, start, key, token, mode),
    IO.pure(String, "canceled=stale\nkey=" ++ key ++ "\ntoken=" ++ token ++ "\n"))

def cancel_active_pid(parsed: Maybe<&2,U32>, +key: String, +token: String, +text: String) -> IO(String):
  match parsed:
    case None{}: IO.pure(String, "canceled=none\nkey=" ++ key ++ "\ntoken=" ++ token ++ "\n")
    case Some{+pid}:
      do IO<String>:
        +start : String <- IO.pure(String, field(text, "starttime"))
        alive : U32 <- IO.try(U32, L.CompileQueueLifecycle.alive(pid, start))
        cancel_active_alive(alive, pid, start, key, token, text)

def cancel_empty_owners(+left: U32, +keydir: String, +key: String, +token: String) -> IO(String):
  Bool.pick(IO(String), U32.is_eq(left, 0),
    do IO<String>:
      +text : String <- IO.try(String, L.CompileQueueLifecycle.read_text(keydir ++ "/active"))
      pid_text : String <- IO.pure(String, field(text, "pid"))
      cancel_active_pid(U32.read(pid_text), key, token, text),
    IO.pure(String, "canceled=withdrawn\nkey=" ++ key ++ "\ntoken=" ++ token ++ "\nowners=" ++ U32.show(left) ++ "\n"))

def cancel_owner_present(present: Bool, +keydir: String, +key: String, +token: String) -> IO(String):
  Bool.pick(IO(String), present,
    do IO<String>:
      removed : Unit <- remove_token_unlocked(keydir, token)
      left : U32 <- owner_count(keydir)
      cancel_empty_owners(left, keydir, key, token),
    IO.pure(String, "canceled=unknown-token\nkey=" ++ key ++ "\ntoken=" ++ token ++ "\n"))

def cancel_locked(+keydir: String, key: String, +token: String) -> IO(String):
  do IO<String>:
    owner : String <- IO.pure(String, keydir ++ "/owners/" ++ token)
    present : Bool <- regular(owner)
    cancel_owner_present(present, keydir, key, token)

def cancel_valid_args(ok: Bool, state: String, +key: String, token: String) -> IO(Unit):
  Bool.pick(IO(Unit), ok,
    do IO<Unit>:
      +keydir : String <- IO.pure(String, keydir_of(state, key))
      lock : U32 <- owner_lock(keydir)
      result : String <- cancel_locked(keydir, key, token)
      released : Unit <- IO.try(Unit, L.CompileQueueLifecycle.lock_release(lock))
      IO.write(result),
    IO.die(Unit, 2, "compile-queue: cancel requires --key and --token"))

def cancel_parsed(parsed: CancelArgs) -> IO(Unit):
  match parsed:
    case CancelArgs{state, +key, +token}:
      +ok = Bool.and(non_empty(key), token_ok(token))
      cancel_valid_args(ok, state, key, token)

def cancel_command(args: List<&2,String>) -> IO(Unit):
  do IO<Unit>:
    state : String <- default_state_root()
    parsed : CancelArgs <- parse_cancel(args, state, "", "")
    cancel_parsed(parsed)

def status_row_selected(selected: Bool, state_root: String, +key: String) -> IO(Unit):
  Bool.pick(IO(Unit), selected,
    do IO<Unit>:
      +keydir : String <- IO.pure(String, keydir_of(state_root, key))
      +text : String <- IO.try(String, L.CompileQueueLifecycle.read_text(keydir ++ "/active"))
      active : Unit <- Bool.pick(IO(Unit), non_empty(text),
        IO.write("active key=" ++ key ++ " pid=" ++ field(text, "pid")
          ++ " kind=" ++ field(text, "kind") ++ " setsid=" ++ field(text, "setsid")
          ++ " started_ns=" ++ field(text, "started_ns") ++ "\n"),
        IO.pure(Unit, Unit{}))
      completed : Bool <- IO.try(Bool, Result.CompileQueueResult.verify_completed(keydir))
      done : Unit <- Bool.pick(IO(Unit), completed,
        IO.write("completed key=" ++ key ++ "\n"), IO.pure(Unit, Unit{}))
      IO.pure(Unit, Unit{}),
    IO.pure(Unit, Unit{}))

def status_rows(+state_root: String, +filter: String, names: List<&1,String>) -> IO(Unit):
  match names:
    case Nil{}: IO.pure(Unit, Unit{})
    case Con{+key, rest}:
      do IO<Unit>:
        selected : Bool <- IO.pure(Bool, Bool.or(Tx.str_eq(filter, ""), Tx.str_eq(filter, key)))
        row : Unit <- status_row_selected(selected, state_root, key)
        status_rows(state_root, filter, rest)

def status_state_key(parsed: StateKey) -> IO(Unit):
  match parsed:
    case StateKey{+state, filter}:
      do IO<Unit>:
        IO.write("state_root=" ++ state ++ "\n")
        names : String <- IO.try(String, L.CompileQueueLifecycle.list_dir(state ++ "/keys"))
        status_rows(state, filter, Tx.split_lines(names))

def status_command(args: List<&2,String>) -> IO(Unit):
  do IO<Unit>:
    state : String <- default_state_root()
    parsed : StateKey <- parse_state_key(args, state, "")
    status_state_key(parsed)

def output_of_argv(argv: List<&2,String>) -> String:
  match argv:
    case Nil{}: ""
    case "-o" <> value <> rest: value
    case other <> rest: output_of_argv(rest)

def entry_of_argv(argv: List<&2,String>) -> String:
  match argv:
    case Nil{}: ""
    case token <> +value <> rest:
      Bool.pick(String, Tx.starts_with(token, "/bend2/main.ts"), value,
        entry_of_argv(Con{value, rest}))
    case other: ""

def argv_head(argv: List<&2,String>) -> String:
  match argv:
    case Nil{}: ""
    case head <> rest: head
def absolute_path(cwd: String, +path: String) -> String:
  Bool.pick(String, Tx.starts_with(path, "/"), path, cwd ++ "/" ++ path)

def input_material_text(inputs: List<&2,Input>) -> String:
  match inputs:
    case Nil{}: ""
    case Con{Input{source, destination}, rest}:
      "input=" ++ source ++ "\t" ++ destination ++ "\n" ++ input_material_text(rest)

def artifact_material_text(name: String, path: String) -> String:
  "artifact=" ++ name ++ "\t" ++ path ++ "\n"


def live_inputs_next(result: Result<&1,&1,U32 & String,String>, skip: Bool,
                     +candidate: String, +acc: List<&2,Input>) -> List<&2,Input>:
  match result:
    case Done{value}:
      Bool.pick(List<&2,Input>, skip, acc, Con{Input{candidate, candidate}, acc})
    case Fail{error}: acc

def live_inputs_go(+cwd: String, argv: List<&2,String>, +output: String, +compiler: String,
                   acc: List<&2,Input>) -> IO(List<&2,Input>):
  match argv:
    case Nil{}: IO.pure(List<&2,Input>, List.reverse(&2, Input, acc))
    case +token <> rest:
      do IO<List<&2,Input>>:
        +candidate : String <- IO.pure(String, Bool.pick(String, Tx.starts_with(token, "/"), token, cwd ++ "/" ++ token))
        skip : Bool <- IO.pure(Bool, Bool.or(Tx.str_eq(candidate, output), Tx.str_eq(token, compiler)))
        result : Result<&1,&1,U32 & String,String> <- F.Files.regular(candidate)
        next : List<&2,Input> <- IO.pure(List<&2,Input>, live_inputs_next(result, skip, candidate, acc))
        live_inputs_go(cwd, rest, output, compiler, next)

def live_inputs(cwd: String, argv: List<&2,String>, output: String, compiler: String) -> IO(List<&2,Input>):
  live_inputs_go(cwd, argv, output, compiler, Nil{})

def input_adoption_text(inputs: List<&2,Input>) -> IO(String):
  match inputs:
    case Nil{}: IO.pure(String, "")
    case Con{Input{+source, destination}, rest}:
      do IO<String>:
        digest : String <- IO.try(String, Identity.CompileQueueIdentity.file_digest(source))
        tail : String <- input_adoption_text(rest)
        IO.pure(String, "input=" ++ source ++ "\t" ++ destination ++ "\t" ++ digest ++ "\n" ++ tail)

def adoption_text(pid: String, start: String, cwd: String, output: String,
                  compiler: String, entry: String, argv: List<&2,String>,
                  inputs: List<&2,Input>, key: String, started: String) -> IO(String):
  do IO<String>:
    inputs_text : String <- input_adoption_text(inputs)
    IO.pure(String, "schema=" ++ Identity.CompileQueueIdentity.schema() ++ "\npid=" ++ pid
      ++ "\nstarttime=" ++ start ++ "\ncwd=" ++ cwd ++ "\noutput=" ++ output
      ++ "\ncompiler=" ++ compiler ++ "\nentry=" ++ entry ++ "\nidentity=" ++ key
      ++ "\nstarted_ns=" ++ started ++ "\nargv=" ++ fields_join("\t", argv) ++ "\n"
      ++ inputs_text)

def write_adoption_failure(+keydir: String, +started: String, detail: String) -> IO(Unit):
  do IO<Unit>:
    +run : String <- IO.pure(String, keydir ++ "/runs/external-" ++ started)
    made : Unit <- IO.try(Unit, L.CompileQueueLifecycle.mkdir_p(run))
    wrote : Unit <- IO.try(Unit, Result.CompileQueueResult.write(run ++ "/result", "failed", "1", "cgen", "", started, started,
      "external", run, run ++ "/stdout", run ++ "/stderr", detail, Tx.join("\n", Nil{})))
    removed : Unit <- IO.try(Unit, L.CompileQueueLifecycle.remove(keydir ++ "/active"))
    IO.pure(Unit, Unit{})

def finish_adoption(+keydir: String, +adoption: String, +name: String, +path: String) -> IO(Unit):
  do IO<Unit>:
    pid : U32 <- IO.try(U32, L.CompileQueueLifecycle.pid())
    key : String <- IO.pure(String, field(adoption, "identity"))
    started : String <- IO.pure(String, field(adoption, "started_ns"))
    +cache : String <- IO.pure(String, keydir ++ "/completed.tmp." ++ U32.show(pid))
    made : Unit <- IO.try(Unit, L.CompileQueueLifecycle.mkdir_p(cache ++ "/artifacts"))
    retained : Unit <- IO.try(Unit, Result.CompileQueueResult.retain_external(path, cache ++ "/artifacts", name))
    finished : String <- IO.try(String, L.CompileQueueLifecycle.now_ns())
    wrote : Unit <- IO.try(Unit, Result.CompileQueueResult.write_adoption(cache ++ "/result", key, started, finished,
      adoption, name, path, cache ++ "/artifacts"))
    renamed : Unit <- IO.try(Unit, F.Files.rename(cache, keydir ++ "/completed"))
    removed : Unit <- IO.try(Unit, L.CompileQueueLifecycle.remove(keydir ++ "/active"))
    IO.pure(Unit, Unit{})

def guard_after_exit(+keydir: String, name: String, +path: String, +started: String) -> IO(Unit):
  do IO<Unit>:
    +adoption : String <- IO.try(String, L.CompileQueueLifecycle.read_text(keydir ++ "/adoption"))
    size : U32 <- IO.try(U32, F.Files.size(path))
    Bool.pick(IO(Unit), U32.is_lt(0, size),
      do IO<Unit>:
        published : Unit <- finish_adoption(keydir, adoption, name, path)
        verified : Bool <- IO.try(Bool, Result.CompileQueueResult.verify_adoption(keydir, adoption))
        Bool.pick(IO(Unit), verified,
          IO.pure(Unit, Unit{}),
          do IO<Unit>:
            removed : Unit <- IO.try(Unit, L.CompileQueueLifecycle.remove_tree(keydir ++ "/completed"))
            write_adoption_failure(keydir, started, "adoption identity differs from the live process")),
      write_adoption_failure(keydir, started, "external compiler exited without a complete artifact"))

def guard_loop(+keydir: String, pid: U32, start: String, name: String, +path: String, +started: String) -> IO(Unit):
  do IO<Unit>:
    waited : Unit <- IO.try(Unit, L.CompileQueueLifecycle.wait_external(pid, start))
    guard_after_exit(keydir, name, path, started)

def guard_existing_result(present: Bool, +keydir: String, pid: U32, pid_text: String,
                          +start: String, name: String, path: String) -> IO(Unit):
  match present:
    case True{}:
      do IO<Unit>:
        +adoption : String <- IO.try(String, L.CompileQueueLifecycle.read_text(keydir ++ "/adoption"))
        verified : Bool <- IO.try(Bool, Result.CompileQueueResult.verify_adoption(keydir, adoption))
        Bool.pick(IO(Unit), verified, IO.pure(Unit, Unit{}),
          IO.die(Unit, 1, "compile-queue: completed result is not a verified adoption record"))
    case False{}:
      do IO<Unit>:
        +started : String <- IO.try(String, L.CompileQueueLifecycle.now_ns())
        active : Unit <- IO.try(Unit, L.CompileQueueLifecycle.write_text(keydir ++ "/active", "pid=" ++ pid_text
          ++ "\nstarttime=" ++ start ++ "\nkind=cgen\nsetsid=external\nstarted_ns=" ++ started ++ "\n"))
        guard_loop(keydir, pid, start, name, path, started)

def guard_pid_result(parsed: Maybe<&2,U32>, +keydir: String, pid_text: String, start: String,
                     name: String, path: String) -> IO(Unit):
  match parsed:
    case None{}: IO.die(Unit, 2, "compile-queue: adoption pid is malformed")
    case Some{+pid}:
      do IO<Unit>:
        locked_key : Unit <- IO.try(Unit, L.CompileQueueLifecycle.lock_fd_acquire(9))
        locked_cgen : Unit <- IO.try(Unit, L.CompileQueueLifecycle.lock_fd_acquire(8))
        present : Bool <- regular(keydir ++ "/completed/result")
        guard_existing_result(present, keydir, pid, pid_text, start, name, path)

def guard(keydir: String, +pid_text: String, start: String, name: String, path: String) -> IO(Unit):
  guard_pid_result(U32.read(pid_text), keydir, pid_text, start, name, path)


def config_text(config: Config) -> String:
  match config:
    case Config{text, command}: text

def parse_adopt(args: List<&2,String>, +config: Config) -> IO(Config):
  match args:
    case Nil{}:
      Bool.pick(IO(Config), valid_state_root(field(config_text(config), "state_root")),
        IO.pure(Config, config),
        IO.die(Config, 2, "compile-queue: set BATON_COMPILE_QUEUE_ROOT or pass an absolute --state-root"))
    case "--pid" <> value <> rest: parse_adopt(rest, config_line(config, "pid", value))
    case "--state-root" <> value <> rest: parse_adopt(rest, config_line(config, "state_root", value))
    case "--source-root" <> value <> rest: parse_adopt(rest, config_line(config, "source_root", value))
    case "--entry" <> value <> rest: parse_adopt(rest, config_line(config, "entry", value))
    case "--compiler" <> value <> rest: parse_adopt(rest, config_line(config, "compiler", value))
    case "--artifact" <> +value <> rest: parse_adopt(rest, config_line(config, "artifact", value))
    case "--option" <> value <> rest: parse_adopt(rest, config_line(config, "option", value))
    case +option <> rest: IO.die(Config, 2, "compile-queue: unknown option " ++ option)

def adopt_heavy_result(heavy: Maybe<U32>, +key: String, +keydir: String, +lock: U32,
                       +pid_text: String, +start: String, +cwd: String, +output: String,
                       +compiler: String, +entry: String, +argv: List<&2,String>, +inputs: List<&2,Input>,
                       +name: String, +path: String) -> IO(Unit):
  match heavy:
    case None{}:
      do IO<Unit>:
        released_lock : Unit <- IO.try(Unit, L.CompileQueueLifecycle.lock_release(lock))
        IO.write("adopted=0\nkey=" ++ key ++ "\nreason=compiler-queue-busy\n")
    case Some{+heavy}:
      do IO<Unit>:
        +started : String <- IO.try(String, L.CompileQueueLifecycle.now_ns())
        adoption : String <- adoption_text(pid_text, start, cwd, output, compiler, entry, argv, inputs, key, started)
        wrote : Unit <- IO.try(Unit, L.CompileQueueLifecycle.write_text(keydir ++ "/adoption", adoption))
        guard_args : String <- IO.pure(String, P.argv(Con{"__guard", Con{keydir, Con{pid_text, Con{start, Con{name, Con{path, Nil{}}}}}}}))
        guard_pid : U32 <- IO.try(U32, L.CompileQueueLifecycle.spawn_detached(guard_args, lock, heavy))
        released_lock : Unit <- IO.try(Unit, L.CompileQueueLifecycle.close_fd(lock))
        released_heavy : Unit <- IO.try(Unit, L.CompileQueueLifecycle.close_fd(heavy))
        IO.write("adopted=1\nkey=" ++ key ++ "\npid=" ++ pid_text
          ++ "\nguard=" ++ U32.show(guard_pid) ++ "\nartifact=" ++ path ++ "\n")

def adopt_completed_result(present: Bool, state: String, +key: String, +keydir: String, +lock: U32,
                           pid_text: String, start: String, cwd: String, output: String,
                           compiler: String, entry: String, argv: List<&2,String>, inputs: List<&2,Input>,
                           name: String, path: String) -> IO(Unit):
  match present:
    case True{}:
      do IO<Unit>:
        +adoption : String <- IO.try(String, L.CompileQueueLifecycle.read_text(keydir ++ "/adoption"))
        verified : Bool <- IO.try(Bool, Result.CompileQueueResult.verify_adoption(keydir, adoption))
        Bool.pick(IO(Unit), verified,
          do IO<Unit>:
            released : Unit <- IO.try(Unit, L.CompileQueueLifecycle.lock_release(lock))
            IO.write("adopted=0\nkey=" ++ key ++ "\nreason=completed-result-exists\n"),
          do IO<Unit>:
            released : Unit <- IO.try(Unit, L.CompileQueueLifecycle.lock_release(lock))
            IO.die(Unit, 2, "compile-queue: completed result is not a verified adoption record"))
    case False{}:
      do IO<Unit>:
        heavy : Maybe<U32> <- IO.try(Maybe<U32>, L.CompileQueueLifecycle.lock_try(state ++ "/heavy.lock"))
        adopt_heavy_result(heavy, key, keydir, lock, pid_text, start, cwd, output,
          compiler, entry, argv, inputs, name, path)

def adopt_live(pid: U32, +pid_text: String, +start: String, +cwd: String,
               +argv: List<&2,String>, +output: String, +name: String, path: String,
               +text: String) -> IO(Unit):
  do IO<Unit>:
    +compiler_override : String <- IO.pure(String, field(text, "compiler"))
    +head : String <- IO.pure(String, argv_head(argv))
    +compiler : String <- Bool.pick(IO(String), non_empty(compiler_override), IO.pure(String, compiler_override),
      Bool.pick(IO(String), non_empty(head), IO.pure(String, head),
        IO.try(String, L.CompileQueueLifecycle.environ(pid, "BEND"))))
    +entry_override : String <- IO.pure(String, field(text, "entry"))
    +entry : String <- IO.pure(String, Bool.pick(String, non_empty(entry_override), entry_override, entry_of_argv(argv)))
    +inputs : List<&2,Input> <- live_inputs(cwd, argv, output, compiler)
    +state : String <- IO.pure(String, field(text, "state_root"))
    +logical_argv : List<&2,String> <- IO.pure(List<&2,String>, Con{compiler, Con{entry, Con{"-o", Con{output, Nil{}}}}})
    +material_text : String <- IO.pure(String,
      "kind=cgen\nstate_root=" ++ state ++ "\ncwd=" ++ cwd
      ++ "\nroot=" ++ cwd ++ "\nsource_root=" ++ cwd ++ "\nentry=" ++ entry
      ++ "\ncompiler=" ++ compiler ++ "\nreceipt=\ntoken=\n"
      ++ fields_join("\n", fields_all(text, "option")) ++ "\n"
      ++ artifact_material_text(name, output))
    material_config : Config <- IO.pure(Config, Config{material_text, logical_argv})
    +key : String <- identity_key(material_config)
    +keydir : String <- IO.pure(String, keydir_of(state, key))
    made : Unit <- IO.try(Unit, L.CompileQueueLifecycle.mkdir_p(keydir ++ "/runs"))
    lock : U32 <- IO.try(U32, L.CompileQueueLifecycle.lock_acquire(keydir ++ "/lock"))
    present : Bool <- regular(keydir ++ "/completed/result")
    adopt_completed_result(present, state, key, keydir, lock, pid_text, start, cwd, output,
      compiler, entry, argv, inputs, name, path)

def adopt_artifact_value(parsed: Maybe<&1,Split>, pid: U32, pid_text: String, start: String, cwd: String,
                         argv: List<&2,String>, +output_abs: String, text: String) -> IO(Unit):
  match parsed:
    case None{}: IO.die(Unit, 2, "compile-queue: adopt requires --artifact NAME=PATH")
    case Some{Split{name, +path}}:
      do IO<Unit>:
        path_ok : Bool <- IO.pure(Bool, Tx.str_eq(output_abs, path))
        absolute_ok : Bool <- IO.pure(Bool, Tx.starts_with(path, "/"))
        Bool.pick(IO(Unit), path_ok,
          Bool.pick(IO(Unit), absolute_ok,
            adopt_live(pid, pid_text, start, cwd, argv, output_abs, name, path, text),
            IO.die(Unit, 2, "compile-queue: adopted artifact path must be absolute")),
          IO.die(Unit, 2, "compile-queue: artifact path differs from the live -o output"))

def adopt_output_value(parsed: String, pid: U32, pid_text: String, start: String,
                       +cwd: String, argv: List<&2,String>, artifact: String, text: String) -> IO(Unit):
  match parsed:
    case SNil{}: IO.die(Unit, 2, "compile-queue: the live command has no -o output")
    case output_path:
      +output_abs = absolute_path(cwd, output_path)
      adopt_artifact_value(split_eq(artifact, ""), pid, pid_text, start, cwd, argv, output_abs, text)

def argv_copy(args: List<&1,String>, +acc: List<&2,String>) -> List<&2,String>:
  match args:
    case Nil{}: List.reverse(&2, String, acc)
    case Con{+arg, rest}: argv_copy(rest, Con{arg, acc})

def adopt_pid_value(parsed: Maybe<&2,U32>, +pid_text: String, artifact: String, text: String) -> IO(Unit):
  match parsed:
    case None{}: IO.die(Unit, 2, "compile-queue: adopt requires --pid")
    case Some{+pid}:
      do IO<Unit>:
        start : String <- IO.try(String, L.CompileQueueLifecycle.starttime(pid))
        +cwd : String <- IO.try(String, L.CompileQueueLifecycle.cwd_of_pid(pid))
        cmdline : String <- IO.try(String, L.CompileQueueLifecycle.cmdline(pid))
        +argv : List<&2,String> <- IO.pure(List<&2,String>, argv_copy(Tx.split_nul(cmdline), Nil{}))
        adopt_output_value(output_of_argv(argv), pid, pid_text, start, cwd, argv, artifact, text)

def adopt_parsed_config(parsed: Config) -> IO(Unit):
  match parsed:
    case Config{+text, command}:
      do IO<Unit>:
        ready : Unit <- require_state_root(field(text, "state_root"))
        +pid_text : String <- IO.pure(String, field(text, "pid"))
        +artifact : String <- IO.pure(String, field(text, "artifact"))
        adopt_pid_value(U32.read(pid_text), pid_text, artifact, text)

def adopt_command(args: List<&2,String>) -> IO(Unit):
  do IO<Unit>:
    state : String <- default_state_root()
    config : Config <- fresh_config()
    parsed : Config <- parse_adopt(args, config_line(config, "state_root", state))
    adopt_parsed_config(parsed)

def usage() -> String:
  "usage: compile-queue.sh run --kind cgen|cc --state-root DIR --cwd DIR [options] -- COMMAND...\n"
  ++ "       compile-queue.sh key --kind cgen|cc [options]\n"
  ++ "       compile-queue.sh cancel --state-root DIR --key KEY --token TOKEN\n"
  ++ "       compile-queue.sh wait --state-root DIR --key KEY\n"
  ++ "       compile-queue.sh status --state-root DIR [--key KEY]\n"
  ++ "       compile-queue.sh adopt --pid PID --state-root DIR --artifact NAME=PATH\n"

def main_args(args: List<&2,String>) -> IO(Unit):
  match args:
    case "run" <> rest: run_command(rest)
    case "key" <> rest: key_command(rest)
    case "wait" <> rest: wait_command(rest)
    case "cancel" <> rest: cancel_command(rest)
    case "status" <> rest: status_command(rest)
    case "adopt" <> rest: adopt_command(rest)
    case "__supervise" <> attempt <> Nil{}: supervise(attempt)
    case "__guard" <> keydir <> pid <> start <> name <> path <> Nil{}:
      guard(keydir, pid, start, name, path)
    case other: IO.die(Unit, 2, usage())

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<&1,String> <- IO.args()
    owned_args : List<&2,String> <- IO.pure(List<&2,String>, argv_copy(args, Nil{}))
    main_args(owned_args)
