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

type Pair is Data:
  Pair{left: String, right: String}

type Input is Data:
  Input{source: String, destination: String}

type Artifact is Data:
  Artifact{name: String, path: String}

type Config is Data:
  Config{text: String, command: List<String>}

type StateKey is Data:
  StateKey{state: String, key: String}

type CancelArgs is Data:
  CancelArgs{state: String, key: String, token: String}

def non_empty(s: String) -> Bool:
  match s:
    case SNil{}: False{}
    case SCon{c, rest}: True{}

def non_empty_list(xs: List<String>) -> Bool:
  match xs:
    case Nil{}: False{}
    case Con{head, rest}: True{}

def list_count(xs: List<String>) -> U32:
  match xs:
    case Nil{}: 0
    case Con{head, rest}: U32.add(1, list_count(rest))

def split_eq(s: String, acc: String) -> Maybe<Split>:
  match s:
    case SNil{}: None{}
    case SCon{c, rest}:
      +is_eq = U32.is_eq(Char.to_u32(c), 61)
      Bool.pick(Maybe<Split>, is_eq, Some{Split{acc, rest}},
        split_eq(rest, acc ++ SCon{c, SNil{}}))

def basename_go(s: String, acc: String) -> String:
  match s:
    case SNil{}: acc
    case SCon{c, rest}:
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
    case SCon{c, rest}: Bool.and(token_char(c), token_ok_go(rest))

def token_ok(s: String) -> Bool:
  Bool.and(non_empty(s), token_ok_go(s))

def last_field(lines: List<String>, name: String, current: String) -> String:
  match lines:
    case Nil{}: current
    case +line <> rest:
      match split_eq(line, ""):
        case Some{Split{left, right}}:
          Bool.pick(String, Tx.str_eq(left, name), last_field(rest, name, right), last_field(rest, name, current))
        case None{}: last_field(rest, name, current)

# Scalar options are last-wins so an explicit CLI flag overrides the default
# field written by default_config. Repeated input/option/artifact fields use
# fields_all and keep every occurrence.
def field_lines(lines: List<String>, name: String) -> String:
  last_field(lines, name, "")

def field(text: String, name: String) -> String:
  field_lines(Tx.split_lines(text), name)

def collect_line_value(parsed: Maybe<Split>, rest: List<String>, name: String, acc: List<String>) -> List<String>:
  match parsed:
    case Some{Split{left, right}}:
      +next = Bool.pick(List<String>, Tx.str_eq(left, name), Con{right, acc}, acc)
      collect_lines(rest, name, next)
    case None{}: collect_lines(rest, name, acc)

def collect_lines(lines: List<String>, name: String, acc: List<String>) -> List<String>:
  match lines:
    case Nil{}: List.reverse(&1, String, acc)
    case +line <> rest: collect_line_value(split_eq(line, ""), rest, name, acc)

def fields_all(text: String, name: String) -> List<String>:
  collect_lines(Tx.split_lines(text), name, Nil{})

def pair_from_fields(parts: List<String>) -> Maybe<Pair>:
  match parts:
    case left <> right <> Nil{}: Some{Pair{left, right}}
    case other: None{}

def pair_of_tabs(value: String) -> Maybe<Pair>:
  pair_from_fields(Tx.split_tabs(value))

def input_row_pair(parsed: Maybe<Pair>, rest: List<String>, acc: List<Input>) -> List<Input>:
  match parsed:
    case Some{Pair{left, right}}: input_rows_go(rest, Con{Input{left, right}, acc})
    case None{}: input_rows_go(rest, acc)

def input_rows_go(rows: List<String>, acc: List<Input>) -> List<Input>:
  match rows:
    case Nil{}: List.reverse(&1, Input, acc)
    case +row <> rest: input_row_pair(pair_of_tabs(row), rest, acc)

def input_rows(text: String) -> List<Input>:
  input_rows_go(fields_all(text, "input"), Nil{})

def artifact_row_pair(parsed: Maybe<Pair>, rest: List<String>, acc: List<Artifact>) -> List<Artifact>:
  match parsed:
    case Some{Pair{left, right}}: artifact_rows_go(rest, Con{Artifact{left, right}, acc})
    case None{}: artifact_rows_go(rest, acc)

def artifact_rows_go(rows: List<String>, acc: List<Artifact>) -> List<Artifact>:
  match rows:
    case Nil{}: List.reverse(&1, Artifact, acc)
    case +row <> rest: artifact_row_pair(pair_of_tabs(row), rest, acc)

def artifact_rows(text: String) -> List<Artifact>:
  artifact_rows_go(fields_all(text, "artifact"), Nil{})

def artifact_components_ok(parts: List<String>) -> Bool:
  match parts:
    case Nil{}: True{}
    case Con{part, rest}:
      +part_ok = Bool.and(token_ok(part),
        Bool.and(Bool.not(Tx.str_eq(part, ".")), Bool.not(Tx.str_eq(part, ".."))))
      Bool.and(part_ok, artifact_components_ok(rest))

def artifact_path_ok(name: String) -> Bool:
  Bool.and(non_empty(name),
    Bool.and(Bool.not(Tx.starts_with(name, "/")),
      artifact_components_ok(String.split(name, Char.from_u32(47)))))

def artifact_paths_ok(artifacts: List<Artifact>) -> Bool:
  match artifacts:
    case Nil{}: True{}
    case Con{Artifact{name, path}, rest}:
      Bool.and(artifact_path_ok(name), artifact_paths_ok(rest))

def artifact_names(artifacts: List<Artifact>) -> List<String>:
  match artifacts:
    case Nil{}: Nil{}
    case Con{Artifact{name, path}, rest}: Con{name, artifact_names(rest)}

def names_text(names: List<String>) -> String:
  match names:
    case Nil{}: ""
    case Con{name, rest}: "artifact_name=" ++ name ++ "\n" ++ names_text(rest)

def member_string(value: String, values: List<String>) -> Bool:
  match values:
    case Nil{}: False{}
    case Con{head, tail}: Bool.or(Tx.str_eq(value, head), member_string(value, tail))

def duplicate_go(inputs: List<Input>, seen: List<String>) -> Bool:
  match inputs:
    case Nil{}: False{}
    case Con{Input{source, destination}, rest}:
      Bool.pick(Bool, member_string(destination, seen), True{},
        duplicate_go(rest, Con{destination, seen}))

def duplicate_destinations(inputs: List<Input>) -> Bool:
  duplicate_go(inputs, Nil{})

def config_line(config: Config, name: String, value: String) -> Config:
  match config:
    case Config{text, command}: Config{text ++ name ++ "=" ++ value ++ "\n", command}

def config_command(config: Config, command: List<String>) -> Config:
  match config:
    case Config{text, other}: Config{text, command}

def config_input(config: Config, source: String) -> Config:
  +destination = "inputs/" ++ basename(source)
  config_line(config, "input", source ++ "\t" ++ destination)

def default_config(state_root: String, cwd: String) -> Config:
  Config{"kind=\nstate_root=" ++ state_root ++ "\ncwd=" ++ cwd
    ++ "\nroot=\nsource_root=\nentry=\ncompiler=\nreceipt=\ntoken=\n", Nil{}}

def env_value(name: String) -> IO(String):
  do IO<String>:
    result : Result<&1,&1,U32 & String,String> <- IO.get_env(name)
    match result:
      case Done{value}: IO.pure(String, value)
      case Fail{error}: IO.pure(String, "")

def valid_state_root(root: String) -> Bool:
  Bool.and(non_empty(root), Tx.starts_with(root, "/"))

def default_state_root() -> IO(String):
  env_value("BATON_COMPILE_QUEUE_ROOT")

def fresh_config() -> IO(Config):
  do IO<Config>:
    state <- default_state_root()
    cwd <- IO.try(String, L.cwd())
    IO.pure(Config, default_config(state, cwd))

# require_state_root rejects a request whose flag differs from the host
# configuration, then verifies the configured directory is present, readable,
# writable and able to hold the queue lock. The queue never invents a state
# root: a missing host directory is a configuration failure.
def require_state_root(state: String) -> IO(Unit):
  do IO<Unit>:
    configured <- default_state_root()
    +mismatch = Bool.and(non_empty(configured), Bool.not(Tx.str_eq(configured, state)))
    Bool.pick(IO(Unit), mismatch,
      IO.die(Unit, 2, "compile-queue: --state-root differs from BATON_COMPILE_QUEUE_ROOT"),
      do IO<Unit>:
        listed : Result<&1,&1,U32 & String,String> <- L.list_dir(state)
        match listed:
          case Fail{(code, message)}:
            IO.die(Unit, 2, "compile-queue: state root is missing or unreadable: " ++ state ++ ": " ++ message)
          case Done{value}:
            writable : Result<&1,&1,U32 & String,Unit> <- F.Files.writable(state)
            match writable:
              case Fail{(code, message)}:
                IO.die(Unit, 2, "compile-queue: state root is not writable: " ++ state ++ ": " ++ message)
              case Done{value}:
                opened : Result<&1,&1,U32 & String,U32> <- L.lock_open(state ++ "/heavy.lock")
                match opened:
                  case Done{value}:
                    released : Unit <- IO.try(Unit, L.lock_release(value))
                    IO.pure(Unit, Unit{})
                  case Fail{(code, message)}:
                    IO.die(Unit, 2, "compile-queue: state root cannot hold the queue lock: " ++ state ++ ": " ++ message))

def parse_artifact_option(parsed: Maybe<Split>, value: String, rest: List<String>, config: Config) -> IO(Config):
  match parsed:
    case Some{Split{name, path}}: parse_common(rest, config_line(config, "artifact", name ++ "\t" ++ path))
    case None{}: IO.die(Config, 2, "compile-queue: artifact must be NAME=PATH: " ++ value)

def parse_common(args: List<String>, config: Config) -> IO(Config):
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
    case "--linker" <> value <> rest: parse_common(rest, config_line(config, "linker", value))
    case "--version" <> value <> rest: parse_common(rest, config_line(config, "version", value))
    case "--receipt" <> value <> rest: parse_common(rest, config_line(config, "receipt", value))
    case "--token" <> value <> rest: parse_common(rest, config_line(config, "token", value))
    case "--input" <> value <> rest: parse_common(rest, config_input(config, value))
    case "--aux" <> value <> rest: parse_common(rest, config_line(config, "aux", value))
    case "--option" <> value <> rest: parse_common(rest, config_line(config, "option", value))
    case "--artifact" <> value <> rest: parse_artifact_option(split_eq(value, ""), value, rest, config)
    case +option <> rest: IO.die(Config, 2, "compile-queue: unknown option " ++ option)

def validate_config(config: Config, need_command: Bool) -> String:
  match config:
    case Config{text, command}:
      +kind = field(text, "kind")
      +state = field(text, "state_root")
      +cwd = field(text, "cwd")
      +source = field(text, "source_root")
      +entry = field(text, "entry")
      +artifacts = artifact_rows(text)
      +inputs = input_rows(text)
      +token = field(text, "token")
      +kind_ok = Bool.or(Tx.str_eq(kind, "cgen"), Tx.str_eq(kind, "cc"))
      +command_ok = Bool.pick(Bool, need_command, non_empty_list(command), True{})
      +artifact_ok = Bool.and(non_empty_list(artifacts), artifact_paths_ok(artifacts))
      +source_ok = Bool.pick(Bool, Tx.str_eq(kind, "cgen"),
        Bool.and(non_empty(source), non_empty(entry)), True{})
      +cc_source_ok = Bool.pick(Bool, Tx.str_eq(kind, "cc"), valid_state_root(source), True{})
      +linker = field(text, "linker")
      +version = field(text, "version")
      +toolchain_ok = Bool.pick(Bool, Tx.str_eq(kind, "cc"),
        Bool.and(non_empty(linker), non_empty(version)), True{})
      +state_ok = valid_state_root(state)
      +cwd_ok = non_empty(cwd)
      +duplicates = duplicate_destinations(inputs)
      Bool.pick(String, kind_ok,
        Bool.pick(String, state_ok,
          Bool.pick(String, cwd_ok,
            Bool.pick(String, command_ok,
              Bool.pick(String, artifact_ok,
                Bool.pick(String, source_ok,
                  Bool.pick(String, cc_source_ok,
                    Bool.pick(String, toolchain_ok,
                      Bool.pick(String, token_okay,
                        Bool.pick(String, duplicates,
                          "compile-queue: two inputs share a destination basename",
                          ""),
                        "compile-queue: token must contain only letters, digits, dot, underscore or hyphen"),
                      "compile-queue: cc requires --linker and --version"),
                    "compile-queue: cc requires an absolute --source-root"),
                  "compile-queue: cgen requires --source-root and --entry"),
                "compile-queue: artifact names must be safe relative paths"),
              "compile-queue: a command is required after --"),
            "compile-queue: cwd is unavailable"),
          "compile-queue: set BATON_COMPILE_QUEUE_ROOT or pass an absolute --state-root"),
        "compile-queue: kind must be cgen or cc")

def input_pairs_text(inputs: List<Input>) -> String:
  match inputs:
    case Nil{}: ""
    case Con{Input{source, destination}, rest}:
      source ++ "\t" ++ destination ++ "\n" ++ input_pairs_text(rest)

def artifact_pairs_text(artifacts: List<Artifact>) -> String:
  match artifacts:
    case Nil{}: ""
    case Con{Artifact{name, path}, rest}:
      name ++ "\t" ++ path ++ "\n" ++ artifact_pairs_text(rest)

def identity_key(config: Config) -> IO(String):
  match config:
    case Config{text, command}:
      +inputs = input_rows(text)
      +artifacts = artifact_rows(text)
      +cwd = field(text, "cwd")
      +root = field(text, "root")
      +compiler = field(text, "compiler")
      +linker = Bool.pick(String, String.eq(field(text, "kind"), "cc"), field(text, "linker"), "")
      +version = Bool.pick(String, String.eq(field(text, "kind"), "cc"), field(text, "version"), "")
      IO.try(String, Identity.request_key(
        field(text, "kind"), cwd, root,
        field(text, "source_root"), field(text, "entry"), compiler,
        linker, version, input_pairs_text(inputs),
        Tx.join("\n", fields_all(text, "aux")),
        artifact_pairs_text(artifacts),
        Tx.join("\n", fields_all(text, "option")),
        normalize_command(command, cwd, root, compiler, inputs, artifacts)))

def artifact_name_match(token: String, artifacts: List<Artifact>) -> Maybe<String>:
  match artifacts:
    case Nil{}: None{}
    case Con{Artifact{name, path}, rest}:
      Bool.pick(Maybe<String>, Tx.str_eq(token, path), Some{name},
        artifact_name_match(token, rest))

def input_destination_match(token: String, inputs: List<Input>) -> Maybe<String>:
  match inputs:
    case Nil{}: None{}
    case Con{Input{source, destination}, rest}:
      Bool.pick(Maybe<String>, Tx.str_eq(token, source), Some{destination},
        input_destination_match(token, rest))

def prefix_token(token: String, prefix: String, marker: String) -> Maybe<String>:
  Bool.pick(Maybe<String>, Bool.and(non_empty(prefix), Tx.starts_with(token, prefix ++ "/")),
    Some{marker ++ "/" ++ String.drop(token, Nat.add(String.length(prefix), 1))}, None{})

def normalize_after_input(result: Maybe<String>, token: String, cwd: String, root: String, compiler: String,
                          inputs: List<Input>, artifacts: List<Artifact>) -> String:
  match result:
    case Some{destination}: "{in:" ++ destination ++ "}"
    case None{}: Bool.pick(String, Tx.str_eq(token, compiler), "{compiler}", normalize_prefix_token(token, cwd, root))

def normalize_after_artifact(result: Maybe<String>, token: String, cwd: String, root: String, compiler: String,
                             inputs: List<Input>, artifacts: List<Artifact>) -> String:
  match result:
    case Some{name}: "{out:" ++ name ++ "}"
    case None{}: normalize_after_input(input_destination_match(token, inputs), token, cwd, root, compiler, inputs, artifacts)

def normalize_token(token: String, cwd: String, root: String, compiler: String,
                    inputs: List<Input>, artifacts: List<Artifact>) -> String:
  normalize_after_artifact(artifact_name_match(token, artifacts), token, cwd, root, compiler, inputs, artifacts)

def normalize_after_root(result: Maybe<String>, token: String, cwd: String) -> String:
  match result:
    case Some{value}: value
    case None{}: normalize_after_cwd(prefix_token(token, cwd, "@cwd"), token)

def normalize_after_cwd(result: Maybe<String>, token: String) -> String:
  match result:
    case Some{value}: value
    case None{}: token

def normalize_prefix_token(token: String, cwd: String, root: String) -> String:
  normalize_after_root(prefix_token(token, root, "@root"), token, cwd)

def normalize_command(args: List<String>, cwd: String, root: String, compiler: String,
                      inputs: List<Input>, artifacts: List<Artifact>) -> String:
  match args:
    case Nil{}: ""
    case Con{token, rest}:
      normalize_token(token, cwd, root, compiler, inputs, artifacts)
      ++ "\n" ++ normalize_command(rest, cwd, root, compiler, inputs, artifacts)

def keydir_of(state_root: String, key: String) -> String:
  state_root ++ "/keys/" ++ key

def config_state(config: Config) -> String:
  match config:
    case Config{text, command}: field(text, "state_root")

def regular(path: String) -> IO(Bool):
  do IO<Bool>:
    result : Result<&1,&1,U32 & String,String> <- F.Files.regular(path)
    match result:
      case Done{value}: IO.pure(Bool, True{})
      case Fail{error}: IO.pure(Bool, False{})

def copy_inputs(work: String, inputs: List<Input>) -> IO(Unit):
  match inputs:
    case Nil{}: IO.pure(Unit, Unit{})
    case Con{Input{source, destination}, rest}:
      do IO<Unit>:
        +target = work ++ "/" ++ destination
        copied : Unit <- IO.try(Unit, L.copy_file(source, target))
        source_digest : String <- IO.try(String, Identity.file_digest(source))
        target_digest : String <- IO.try(String, Identity.file_digest(target))
        Bool.pick(IO(Unit), Tx.str_eq(source_digest, target_digest),
          copy_inputs(work, rest),
          IO.die(Unit, 1, "compile-queue: input changed while staging"))

def replace_after_input(result: Maybe<String>, token: String) -> String:
  match result:
    case Some{value}: value
    case None{}: token

def replace_after_artifact(result: Maybe<String>, token: String, work: String, inputs: List<Input>) -> String:
  match result:
    case Some{value}: value
    case None{}: replace_after_input(input_match(token, work, inputs), token)

def replace_token(token: String, work: String, inputs: List<Input>, artifacts: List<Artifact>) -> String:
  replace_after_artifact(artifact_match(token, work, artifacts), token, work, inputs)

def artifact_match(token: String, work: String, artifacts: List<Artifact>) -> Maybe<String>:
  match artifacts:
    case Nil{}: None{}
    case Con{Artifact{name, path}, rest}:
      Bool.pick(Maybe<String>, Tx.str_eq(token, path), Some{work ++ "/" ++ name},
        artifact_match(token, work, rest))

def input_match(token: String, work: String, inputs: List<Input>) -> Maybe<String>:
  match inputs:
    case Nil{}: None{}
    case Con{Input{source, destination}, rest}:
      Bool.pick(Maybe<String>, Tx.str_eq(token, source), Some{work ++ "/" ++ destination},
        input_match(token, work, rest))

def command_text(args: List<String>, work: String, inputs: List<Input>, artifacts: List<Artifact>) -> String:
  match args:
    case Nil{}: ""
    case Con{token, rest}:
      +value = replace_token(token, work, inputs, artifacts)
      +tail = command_text(rest, work, inputs, artifacts)
      value ++ "\n" ++ tail

def meta_text(config: Config, key: String, keydir: String, attempt: String, artifacts: List<Artifact>) -> String:
  match config:
    case Config{text, command}:
      "kind=" ++ field(text, "kind") ++ "\n"
      ++ "cwd=" ++ field(text, "cwd") ++ "\n"
      ++ "source_root=" ++ field(text, "source_root") ++ "\n"
      ++ "entry=" ++ field(text, "entry") ++ "\n"
      ++ "key=" ++ key ++ "\n"
      ++ "keydir=" ++ keydir ++ "\n"
      ++ "attempt=" ++ attempt ++ "\n"
      ++ names_text(artifact_names(artifacts))

def write_attempt_files(config: Config, key: String, keydir: String, attempt: String) -> IO(Unit):
  match config:
    case Config{text, command}:
      do IO<Unit>:
        +work = attempt ++ "/work"
        +inputs = input_rows(text)
        +artifacts = artifact_rows(text)
        made : Unit <- IO.try(Unit, L.mkdir_p(work ++ "/inputs"))
        staged : Unit <- copy_inputs(work, inputs)
        rechecked : String <- identity_key(config)
        checked : Unit <- Bool.pick(IO(Unit), Tx.str_eq(rechecked, key), IO.pure(Unit, Unit{}),
          IO.die(Unit, 1, "compile-queue: inputs changed before execution"))
        wrote_command : Unit <- IO.try(Unit, L.write_text(attempt ++ "/command", command_text(command, work, inputs, artifacts)))
        wrote_meta : Unit <- IO.try(Unit, L.write_text(attempt ++ "/meta", meta_text(config, key, keydir, attempt, artifacts)))
        digest_written : Unit <- Bool.pick(IO(Unit), Tx.str_eq(field(text, "kind"), "cgen"),
          do IO<Unit>:
            digest : String <- IO.try(String, Identity.source_digest(field(text, "source_root"), field(text, "entry")))
            IO.try(Unit, L.write_text(attempt ++ "/source-digest", "digest=" ++ digest ++ "\n")),
          IO.pure(Unit, Unit{}))
        IO.pure(Unit, Unit{})

def owner_lock(keydir: String) -> IO(U32):
  IO.try(U32, L.lock_acquire(keydir ++ "/owners.lock"))

def publish_token(keydir: String, requested: String) -> IO(String):
  do IO<String>:
    made_keydir : Unit <- IO.try(Unit, L.mkdir_p(keydir))
    lock <- owner_lock(keydir)
    pid <- IO.try(U32, L.pid())
    now <- IO.try(String, L.now_ns())
    start <- IO.try(String, L.starttime(pid))
    +token = Bool.pick(String, non_empty(requested), requested,
      "owner-" ++ U32.show(pid) ++ "-" ++ now)
    made : Unit <- IO.try(Unit, L.mkdir_p(keydir ++ "/owners"))
    +owner_path = keydir ++ "/owners/" ++ token
    exists <- regular(owner_path)
    checked : Unit <- Bool.pick(IO(Unit), exists,
      IO.die(Unit, 2, "compile-queue: owner token is already in use"), IO.pure(Unit, Unit{}))
    wrote : Unit <- IO.try(Unit, L.write_text(owner_path,
      "pid=" ++ U32.show(pid) ++ "\nstarttime=" ++ start ++ "\nstarted_ns=" ++ now ++ "\n"))
    released : Unit <- IO.try(Unit, L.lock_release(lock))
    IO.pure(String, token)

def remove_token_unlocked(keydir: String, token: String) -> IO(Unit):
  Bool.pick(IO(Unit), non_empty(token),
    IO.try(Unit, L.remove(keydir ++ "/owners/" ++ token)), IO.pure(Unit, Unit{}))

def remove_token(keydir: String, token: String) -> IO(Unit):
  do IO<Unit>:
    lock <- owner_lock(keydir)
    removed : Unit <- remove_token_unlocked(keydir, token)
    released : Unit <- IO.try(Unit, L.lock_release(lock))
    IO.pure(Unit, Unit{})

def count_live_owner_pid(parsed: Maybe<U32>, keydir: String, name: String, rest: List<String>, acc: U32, start: String) -> IO(U32):
  match parsed:
    case None{}:
      do IO<U32>:
        removed : Unit <- IO.try(Unit, L.remove(keydir ++ "/owners/" ++ name))
        count_live_owners(keydir, rest, acc)
    case Some{pid}:
      do IO<U32>:
        alive <- IO.try(U32, L.alive(pid, start))
        Bool.pick(IO(U32), U32.is_eq(alive, 1),
          count_live_owners(keydir, rest, U32.add(1, acc)),
          do IO<U32>:
            removed : Unit <- IO.try(Unit, L.remove(keydir ++ "/owners/" ++ name))
            count_live_owners(keydir, rest, acc))

def count_live_owners(keydir: String, names: List<String>, acc: U32) -> IO(U32):
  match names:
    case Nil{}: IO.pure(U32, acc)
    case Con{name, rest}:
      do IO<U32>:
        text <- IO.try(String, L.read_text(keydir ++ "/owners/" ++ name))
        +pid_text = field(text, "pid")
        +start = field(text, "starttime")
        count_live_owner_pid(U32.read(pid_text), keydir, name, rest, acc, start)

def owner_count(keydir: String) -> IO(U32):
  do IO<U32>:
    names <- IO.try(String, L.list_dir(keydir ++ "/owners"))
    count_live_owners(keydir, Tx.split_lines(names), 0)

def clean_stale_active_pid(parsed: Maybe<U32>, active: String, start: String) -> IO(Unit):
  match parsed:
    case None{}:
      do IO<Unit>:
        removed : Unit <- IO.try(Unit, L.remove(active))
        IO.pure(Unit, Unit{})
    case Some{pid}:
      do IO<Unit>:
        alive <- IO.try(U32, L.alive(pid, start))
        removed : Unit <- Bool.pick(IO(Unit), U32.is_eq(alive, 1), IO.pure(Unit, Unit{}),
          IO.try(Unit, L.remove(active)))
        IO.pure(Unit, Unit{})

def clean_stale_active(keydir: String) -> IO(Unit):
  do IO<Unit>:
    +active = keydir ++ "/active"
    text <- IO.try(String, L.read_text(active))
    +pid_text = field(text, "pid")
    +start = field(text, "starttime")
    clean_stale_active_pid(U32.read(pid_text), active, start)

# 0 means no active record or a dead owner; 1 is live; 2 is an active record
# with no parseable identity. A fresh admission refuses 1 and 2.
def active_state(keydir: String) -> IO<U32>:
  do IO<U32>:
    text <- IO.try(String, L.read_text(keydir ++ "/active"))
    Bool.pick(IO<U32>, String.is_empty(text), IO.pure(U32, 0),
      do IO<U32>:
        +pid_text = field(text, "pid")
        +start = field(text, "starttime")
        match U32.read(pid_text):
          case None{}: IO.pure(U32, 2)
          case Some{pid}:
            Bool.pick(IO<U32>, String.is_empty(start), IO.pure(U32, 2),
              do IO<U32>:
                alive <- IO.try(U32, L.alive(pid, start))
                IO.pure(U32, Bool.pick(U32, U32.is_eq(alive, 1), 1, 0))))

def write_failure(attempt: String, keydir: String, status: String, code: U32,
                  kind: String, key: String, started: String, detail: String,
                  names: List<String>) -> IO(Unit):
  do IO<Unit>:
    finished <- IO.try(String, L.now_ns())
    wrote : Unit <- IO.try(Unit, Result.write(attempt ++ "/result", status, U32.show(code), kind, key, started,
      finished, attempt, attempt ++ "/work", attempt ++ "/stdout", attempt ++ "/stderr",
      detail, Tx.join("\n", names)))
    removed : Unit <- IO.try(Unit, L.remove(keydir ++ "/active"))
    IO.pure(Unit, Unit{})

def finish_success(attempt: String, keydir: String, kind: String, key: String,
                   started: String, names: List<String>) -> IO<Unit>:
  do IO<Unit>:
    pid <- IO.try(U32, L.pid())
    +work = attempt ++ "/work"
    +cache = keydir ++ "/completed.tmp." ++ U32.show(pid)
    made : Unit <- IO.try(Unit, L.mkdir_p(cache ++ "/artifacts"))
    retained : Unit <- IO.try(Unit, Result.retain_artifacts(work, cache ++ "/artifacts", Tx.join("\n", names)))
    finished <- IO.try(String, L.now_ns())
    wrote : Unit <- IO.try(Unit, Result.write(cache ++ "/result", "completed", "0", kind, key, started,
      finished, attempt, work, attempt ++ "/stdout", attempt ++ "/stderr", "", Tx.join("\n", names)))
    copied_out : Unit <- IO.try(Unit, L.copy_file(attempt ++ "/stdout", cache ++ "/stdout"))
    copied_err : Unit <- IO.try(Unit, L.copy_file(attempt ++ "/stderr", cache ++ "/stderr"))
    renamed : Unit <- IO.try(Unit, F.Files.rename(cache, keydir ++ "/completed"))
    copied_result : Unit <- IO.try(Unit, L.copy_file(keydir ++ "/completed/result", attempt ++ "/result"))
    removed : Unit <- IO.try(Unit, L.remove(keydir ++ "/active"))
    IO.pure(Unit, Unit{})

def verify_artifacts(work: String, names: List<String>) -> IO(Unit):
  match names:
    case Nil{}: IO.pure(Unit, Unit{})
    case Con{name, rest}:
      do IO<Unit>:
        mode : Result<&1,&1,U32 & String,U32> <- F.Files.mode_of(work ++ "/" ++ name)
        match mode:
          case Done{value}: verify_artifacts(work, rest)
          case Fail{error}: IO.die(Unit, 1, "compile-queue: artifact " ++ name ++ " was not written")

def run_supervised(attempt: String, keydir: String, kind: String, key: String,
                   started: String, names: List<String>, cwd: String) -> IO(Unit):
  do IO<Unit>:
    text <- IO.try(String, L.read_text(attempt ++ "/command"))
    +argv = P.argv(Tx.split_lines(text))
    outcome : Result<&1,&1,U32 & String,U32 & String> <- L.run_command(
      argv, cwd, attempt ++ "/stdout", attempt ++ "/stderr")
    match outcome:
      case Fail{error}:
        write_failure(attempt, keydir, "failed", 1, kind, key, started,
          "command could not start", names)
      case Done{(code, disposition)}:
        +canceled = Tx.str_eq(disposition, "canceled")
        +failed = Bool.and(Bool.not(canceled), Bool.not(U32.is_eq(code, 0)))
        Bool.pick(IO(Unit), canceled,
          write_failure(attempt, keydir, "canceled", 130, kind, key, started,
            "execution canceled", names),
          Bool.pick(IO(Unit), failed,
            write_failure(attempt, keydir, "failed", code, kind, key, started,
              "command " ++ disposition ++ " " ++ U32.show(code), names),
            do IO<Unit>:
              checked : Unit <- verify_artifacts(attempt ++ "/work", names)
              finish_success(attempt, keydir, kind, key, started, names)))

def watch_heavy(attempt: String, pid: U32, start: String) -> IO(Unit):
  do IO<Unit>:
    alive <- IO.try(U32, L.alive(pid, start))
    compiled <- regular(attempt ++ "/compiled")
    result <- regular(attempt ++ "/result")
    Bool.pick(IO(Unit), U32.is_eq(alive, 0), IO.pure(Unit, Unit{}),
      Bool.pick(IO(Unit), compiled,
        do IO<Unit>:
          released : Unit <- IO.try(Unit, L.lock_release(8))
          IO.pure(Unit, Unit{}),
        Bool.pick(IO(Unit), result, IO.pure(Unit, Unit{}),
          do IO<Unit>:
            slept : Unit <- IO.try(Unit, L.sleep_millis(100))
            watch_heavy(attempt, pid, start))))

def watch_heavy_pid(parsed: Maybe<U32>, attempt: String, start: String) -> IO(Unit):
  match parsed:
    case None{}: IO.die(Unit, 2, "compile-queue: watch pid is malformed")
    case Some{pid}: watch_heavy(attempt, pid, start)

def supervise(attempt: String) -> IO(Unit):
  do IO<Unit>:
    meta <- IO.try(String, L.read_text(attempt ++ "/meta"))
    +kind = field(meta, "kind")
    +cwd = field(meta, "cwd")
    +source_root = field(meta, "source_root")
    +entry = field(meta, "entry")
    +key = field(meta, "key")
    +keydir = field(meta, "keydir")
    +names = fields_all(meta, "artifact_name")
    started <- IO.try(String, L.now_ns())
    pid <- IO.try(U32, L.pid())
    start <- IO.try(String, L.starttime(pid))
    gate <- owner_lock(keydir)
    owners <- owner_count(keydir)
    Bool.pick(IO(Unit), U32.is_eq(owners, 0),
      do IO<Unit>:
        released : Unit <- IO.try(Unit, L.lock_release(gate))
        write_failure(attempt, keydir, "canceled", 130, kind, key, started,
          "all requesters canceled before execution", names),
      do IO<Unit>:
        active : Unit <- IO.try(Unit, L.write_text(keydir ++ "/active", "pid=" ++ U32.show(pid)
          ++ "\nstarttime=" ++ start ++ "\nkind=" ++ kind ++ "\nsetsid=1\nstarted_ns=" ++ started ++ "\n"))
        released : Unit <- IO.try(Unit, L.lock_release(gate))
        # Descriptor 8 is the one host-wide heavy lock for cgen and cc.
        locked : Unit <- IO.try(Unit, L.lock_fd_acquire(8))
        +marker = attempt ++ "/compiled"
        signaled : Result<&1,&1,U32 & String,Unit> <- L.set_env("BATON_COMPILE_QUEUE_COMPILED", marker)
        +watch_args = P.argv(Con{"__watch-heavy", Con{attempt, Con{U32.show(pid), Con{start, Nil{}}}}})
        watcher : Result<&1,&1,U32 & String,U32> <- L.spawn_detached(watch_args, 9, 8)
        Bool.pick(IO(Unit), Tx.str_eq(kind, "cgen"),
          do IO<Unit>:
            before <- IO.try(String, L.read_text(attempt ++ "/source-digest"))
            +before_digest = field(before, "digest")
            after <- IO.try(String, Identity.source_digest(source_root, entry))
            Bool.pick(IO(Unit), Tx.str_eq(before_digest, after),
              run_supervised(attempt, keydir, kind, key, started, names, cwd),
              write_failure(attempt, keydir, "failed", 1, kind, key, started,
                "source changed before execution", names)),
          run_supervised(attempt, keydir, kind, key, started, names, cwd)))

def start_attempt(config: Config, key: String, keydir: String, lock: U32, owner: String) -> IO<Unit>:
  do IO<Unit>:
    match config:
      case Config{text, command}:
        do IO<Unit>:
          now <- IO.try(String, L.now_ns())
          pid <- IO.try(U32, L.pid())
          +attempt = keydir ++ "/runs/" ++ now ++ "-" ++ U32.show(pid)
          +state = field(text, "state_root")
          +kind = field(text, "kind")
          made : Unit <- IO.try(Unit, L.mkdir_p(attempt ++ "/work"))
          prepared : Unit <- write_attempt_files(config, key, keydir, attempt)
          # The supervisor takes this lock for every kind before it runs.
          heavy <- IO.try(U32, L.lock_open(state ++ "/heavy.lock"))
          +args = P.argv(Con{"__supervise", Con{attempt, Nil{}}})
          supervisor <- IO.try(U32, L.spawn_detached(args, lock, heavy))
          released_lock : Unit <- IO.try(Unit, L.close_fd(lock))
          released_heavy : Unit <- IO.try(Unit, L.close_fd(heavy))
          waited <- IO.try(U32, L.wait_pid(supervisor))
          completed <- IO.try(Bool, Result.verify_completed(keydir))
          match completed:
            case True{}:
              do IO<Unit>:
                copied : Unit <- IO.try(Unit, Result.copy_artifacts(keydir, artifact_rows(text)))
                receipt : Unit <- IO.try(Unit, Result.receipt_write(field(text, "receipt"), "completed", key, "0", owner, artifact_rows(text)))
                removed : Unit <- remove_token(keydir, owner)
                IO.pure(Unit, Unit{})
            case False{}:
              exists <- regular(attempt ++ "/result")
              Bool.pick(IO(Unit), exists,
                do IO<Unit>:
                  removed : Unit <- remove_token(keydir, owner)
                  Result.report_failure(attempt ++ "/result"),
                do IO<Unit>:
                  left <- owner_count(keydir)
                  +was_canceled = U32.is_eq(left, 0)
                  wrote : Unit <- write_failure(attempt, keydir,
                    Bool.pick(String, was_canceled, "canceled", "failed"),
                    Bool.pick(U32, was_canceled, 130, 1), field(text, "kind"), key, now,
                    Bool.pick(String, was_canceled,
                      "all requesters canceled before a terminal result",
                      "supervisor exited before publishing a terminal result"),
                    artifact_names(artifact_rows(text)))
                  removed : Unit <- remove_token(keydir, owner)
                  Result.report_failure(attempt ++ "/result"))
      case other:
        IO.die(Unit, 2, "compile-queue: malformed configuration")

def run_command(args: List<String>) -> IO(Unit):
  do IO<Unit>:
    config <- fresh_config()
    parsed <- parse_common(args, config)
    invalid <- IO.pure(String, validate_config(parsed, True{}))
    match invalid:
      case SNil{}:
        do IO<Unit>:
          ready <- require_state_root(config_state(parsed))
          key <- identity_key(parsed)
          match parsed:
            case Config{text, command}:
              do IO<Unit>:
                +state = field(text, "state_root")
                +keydir = keydir_of(state, key)
                owner <- publish_token(keydir, field(text, "token"))
                owner_line : Unit <- IO.try(Unit, L.write_stderr("owner=" ++ owner ++ "\n"))
                wait_start <- IO.try(String, L.now_ns())
                present <- regular(keydir ++ "/active")
                made : Unit <- IO.try(Unit, L.mkdir_p(keydir ++ "/runs"))
                lock <- IO.try(U32, L.lock_acquire(keydir ++ "/lock"))
                cleaned : Unit <- clean_stale_active(keydir)
                completed <- IO.try(Bool, Result.verify_completed(keydir))
                match completed:
                  case True{}:
                    do IO<Unit>:
                      copied : Unit <- IO.try(Unit, Result.copy_artifacts(keydir, artifact_rows(text)))
                      receipt : Unit <- IO.try(Unit, Result.receipt_write(field(text, "receipt"), "completed", key, "1", owner, artifact_rows(text)))
                      removed : Unit <- remove_token(keydir, owner)
                      released : Unit <- IO.try(Unit, L.lock_release(lock))
                      IO.pure(Unit, Unit{})
                  case False{}:
                    state <- IO.try(U32, active_state(keydir))
                    Bool.pick(IO(Unit), U32.is_eq(state, 0),
                      do IO<Unit>:
                        +completed_path = keydir ++ "/completed/result"
                        existing <- regular(completed_path)
                        Bool.pick(IO(Unit), existing,
                          do IO<Unit>:
                            removed : Unit <- remove_token(keydir, owner)
                            released : Unit <- IO.try(Unit, L.lock_release(lock))
                            IO.die(Unit, 1, "compile-queue: completed result exists but is not reusable; only adopt may reuse an external result"),
                          do IO<Unit>:
                            latest <- IO.try(String, Result.latest_result(keydir, wait_start, Bool.pick(String, present, "1", "0")))
                            match latest:
                              case SNil{}: start_attempt(parsed, key, keydir, lock, owner)
                              case path:
                                do IO<Unit>:
                                  removed : Unit <- remove_token(keydir, owner)
                                  released : Unit <- IO.try(Unit, L.lock_release(lock))
                                  Result.report_failure(path)),
                      do IO<Unit>:
                        removed : Unit <- remove_token(keydir, owner)
                        released : Unit <- IO.try(Unit, L.lock_release(lock))
                        IO.die(Unit, 1, "compile-queue: active execution is live or has uncertain ownership; refusing a fresh admission"))
            case other: IO.die(Unit, 2, "compile-queue: malformed configuration")
      case error: IO.die(Unit, 2, error)

def key_command(args: List<String>) -> IO(Unit):
  do IO<Unit>:
    config <- fresh_config()
    parsed <- parse_common(args, config)
    invalid <- IO.pure(String, validate_config(parsed, False{}))
    match invalid:
      case SNil{}:
        do IO<Unit>:
          key <- identity_key(parsed)
          IO.write(key ++ "\n")
      case error: IO.die(Unit, 2, error)

def parse_state_key(args: List<String>, state: String, key: String) -> IO(StateKey):
  match args:
    case Nil{}:
      Bool.pick(IO(StateKey), valid_state_root(state),
        IO.pure(StateKey, StateKey{state, key}),
        IO.die(StateKey, 2, "compile-queue: set BATON_COMPILE_QUEUE_ROOT or pass an absolute --state-root"))
    case "--state-root" <> value <> rest: parse_state_key(rest, value, key)
    case "--key" <> value <> rest: parse_state_key(rest, state, value)
    case +option <> rest: IO.die(StateKey, 2, "compile-queue: unknown option " ++ option)

def wait_command(args: List<String>) -> IO(Unit):
  do IO<Unit>:
    state <- default_state_root()
    parsed <- parse_state_key(args, state, "")
    match parsed:
      case StateKey{state, key}:
        Bool.pick(IO(Unit), non_empty(key),
          do IO<Unit>:
            +keydir = keydir_of(state, key)
            lock <- IO.try(U32, L.lock_acquire(keydir ++ "/lock"))
            cleaned : Unit <- clean_stale_active(keydir)
            completed <- IO.try(Bool, Result.verify_completed(keydir))
            match completed:
              case True{}:
                do IO<Unit>:
                  released : Unit <- IO.try(Unit, L.lock_release(lock))
                  IO.write("status=completed\nkey=" ++ key ++ "\n")
              case False{}:
                +completed_path = keydir ++ "/completed/result"
                existing <- regular(completed_path)
                Bool.pick(IO(Unit), existing,
                  do IO<Unit>:
                    text <- IO.try(String, L.read_text(completed_path))
                    +label = Bool.pick(String, Tx.str_eq(field(text, "external"), "1"), "completed-external", "completed-unusable")
                    released : Unit <- IO.try(Unit, L.lock_release(lock))
                    IO.write("status=" ++ label ++ "\nkey=" ++ key ++ "\n"),
                  do IO<Unit>:
                    latest <- IO.try(String, Result.latest_result(keydir, "0", "0"))
                    match latest:
                      case SNil{}: IO.die(Unit, 4, "compile-queue: no result for key " ++ key)
                      case path:
                        do IO<Unit>:
                          released : Unit <- IO.try(Unit, L.lock_release(lock))
                          Result.report_failure(path)),
          IO.die(Unit, 2, "compile-queue: wait requires --key"))

def parse_cancel(args: List<String>, state: String, key: String, token: String) -> IO(CancelArgs):
  match args:
    case Nil{}:
      Bool.pick(IO(CancelArgs), valid_state_root(state),
        IO.pure(CancelArgs, CancelArgs{state, key, token}),
        IO.die(CancelArgs, 2, "compile-queue: set BATON_COMPILE_QUEUE_ROOT or pass an absolute --state-root"))
    case "--state-root" <> value <> rest: parse_cancel(rest, value, key, token)
    case "--key" <> value <> rest: parse_cancel(rest, state, value, token)
    case "--token" <> value <> rest: parse_cancel(rest, state, key, value)
    case +option <> rest: IO.die(CancelArgs, 2, "compile-queue: unknown option " ++ option)

def cancel_active_pid(parsed: Maybe<U32>, key: String, token: String, text: String) -> IO(String):
  match parsed:
    case None{}: IO.pure(String, "canceled=none\nkey=" ++ key ++ "\ntoken=" ++ token ++ "\n")
    case Some{pid}:
      do IO<String>:
        +start = field(text, "starttime")
        alive <- IO.try(U32, L.alive(pid, start))
        Bool.pick(IO(String), U32.is_eq(alive, 1),
          do IO<String>:
            +mode = field(text, "setsid")
            +external = Bool.or(Tx.str_eq(mode, "external"), Tx.str_eq(mode, "starting"))
            Bool.pick(IO(String), external,
              IO.pure(String, "canceled=refused\nkey=" ++ key ++ "\nreason=external-or-starting\n"),
              do IO<String>:
                signaled : Unit <- Bool.pick(IO(Unit), Tx.str_eq(mode, "1"),
                  IO.try(Unit, L.signal_group(pid, 15)), IO.try(Unit, L.signal_pid(pid, 15)))
                slept : Unit <- IO.try(Unit, L.sleep_millis(3000))
                alive2 <- IO.try(U32, L.alive(pid, start))
                escalated : Unit <- Bool.pick(IO(Unit), U32.is_eq(alive2, 0), IO.pure(Unit, Unit{}),
                  Bool.pick(IO(Unit), Tx.str_eq(mode, "1"),
                    IO.try(Unit, L.signal_group(pid, 9)), IO.try(Unit, L.signal_pid(pid, 9))))
                IO.pure(String, "canceled=requested\nkey=" ++ key ++ "\npid=" ++ U32.show(pid) ++ "\ntoken=" ++ token ++ "\n")),
          IO.pure(String, "canceled=stale\nkey=" ++ key ++ "\ntoken=" ++ token ++ "\n"))

def cancel_locked(keydir: String, key: String, token: String) -> IO(String):
  do IO<String>:
    +owner = keydir ++ "/owners/" ++ token
    present <- regular(owner)
    Bool.pick(IO(String), present,
      do IO<String>:
        removed : Unit <- remove_token_unlocked(keydir, token)
        left <- owner_count(keydir)
        Bool.pick(IO(String), U32.is_eq(left, 0),
          do IO<String>:
            text <- IO.try(String, L.read_text(keydir ++ "/active"))
            +pid_text = field(text, "pid")
            cancel_active_pid(U32.read(pid_text), key, token, text),
          IO.pure(String, "canceled=withdrawn\nkey=" ++ key ++ "\ntoken=" ++ token ++ "\nowners=" ++ U32.show(left) ++ "\n")),
      IO.pure(String, "canceled=unknown-token\nkey=" ++ key ++ "\ntoken=" ++ token ++ "\n"))

def cancel_command(args: List<String>) -> IO(Unit):
  do IO<Unit>:
    state <- default_state_root()
    parsed <- parse_cancel(args, state, "", "")
    match parsed:
      case CancelArgs{state, key, token}:
        +ok = Bool.and(non_empty(key), token_ok(token))
        Bool.pick(IO(Unit), ok,
          do IO<Unit>:
            +keydir = keydir_of(state, key)
            lock <- owner_lock(keydir)
            result <- cancel_locked(keydir, key, token)
            released : Unit <- IO.try(Unit, L.lock_release(lock))
            IO.write(result),
          IO.die(Unit, 2, "compile-queue: cancel requires --key and --token"))

def status_rows(state_root: String, filter: String, names: List<String>) -> IO(Unit):
  match names:
    case Nil{}: IO.pure(Unit, Unit{})
    case Con{key, rest}:
      do IO<Unit>:
        +selected = Bool.or(Tx.str_eq(filter, ""), Tx.str_eq(filter, key))
        row : Unit <- Bool.pick(IO(Unit), selected,
          do IO<Unit>:
            +keydir = keydir_of(state_root, key)
            text <- IO.try(String, L.read_text(keydir ++ "/active"))
            active : Unit <- Bool.pick(IO(Unit), non_empty(text),
              IO.write("active key=" ++ key ++ " pid=" ++ field(text, "pid")
                ++ " kind=" ++ field(text, "kind") ++ " setsid=" ++ field(text, "setsid")
                ++ " started_ns=" ++ field(text, "started_ns") ++ "\n"),
              IO.pure(Unit, Unit{}))
            completed <- IO.try(Bool, Result.verify_completed(keydir))
            done : Unit <- Bool.pick(IO(Unit), completed,
              IO.write("completed key=" ++ key ++ "\n"),
              do IO<Unit>:
                +completed_path = keydir ++ "/completed/result"
                existing <- regular(completed_path)
                Bool.pick(IO(Unit), existing,
                  do IO<Unit>:
                    result <- IO.try(String, L.read_text(completed_path))
                    +label = Bool.pick(String, Tx.str_eq(field(result, "external"), "1"), "completed-external", "completed-unusable")
                    IO.write(label ++ " key=" ++ key ++ "\n"),
                  IO.pure(Unit, Unit{})))
            IO.pure(Unit, Unit{}),
          IO.pure(Unit, Unit{}))
        status_rows(state_root, filter, rest)

def status_command(args: List<String>) -> IO(Unit):
  do IO<Unit>:
    state <- default_state_root()
    parsed <- parse_state_key(args, state, "")
    match parsed:
      case StateKey{state, filter}:
        do IO<Unit>:
          IO.write("state_root=" ++ state ++ "\n")
          names <- IO.try(String, L.list_dir(state ++ "/keys"))
          status_rows(state, filter, Tx.split_lines(names))

def output_of_argv(argv: List<String>) -> String:
  match argv:
    case Nil{}: ""
    case "-o" <> value <> rest: value
    case other <> rest: output_of_argv(rest)

def entry_of_argv(argv: List<String>) -> String:
  match argv:
    case Nil{}: ""
    case token <> value <> rest:
      Bool.pick(String, Tx.starts_with(token, "/bend2/main.ts"), value,
        entry_of_argv(Con{value, rest}))
    case other: ""

def argv_head(argv: List<String>) -> String:
  match argv:
    case Nil{}: ""
    case head <> rest: head
def absolute_path(cwd: String, path: String) -> String:
  Bool.pick(String, Tx.starts_with(path, "/"), path, cwd ++ "/" ++ path)

def input_material_text(inputs: List<Input>) -> String:
  match inputs:
    case Nil{}: ""
    case Con{Input{source, destination}, rest}:
      "input=" ++ source ++ "\t" ++ destination ++ "\n" ++ input_material_text(rest)

def artifact_material_text(name: String, path: String) -> String:
  "artifact=" ++ name ++ "\t" ++ path ++ "\n"


def live_inputs_go(cwd: String, argv: List<String>, output: String, compiler: String,
                   acc: List<Input>) -> IO(List<Input>):
  match argv:
    case Nil{}: IO.pure(List<Input>, List.reverse(&1, Input, acc))
    case +token <> rest:
      do IO<List<Input>>:
        +candidate = Bool.pick(String, Tx.starts_with(token, "/"), token, cwd ++ "/" ++ token)
        +skip = Bool.or(Tx.str_eq(candidate, output), Tx.str_eq(token, compiler))
        result : Result<&1,&1,U32 & String,String> <- F.Files.regular(candidate)
        match result:
          case Done{value}: Bool.pick(IO(List<Input>), skip,
            live_inputs_go(cwd, rest, output, compiler, acc),
            live_inputs_go(cwd, rest, output, compiler, Con{Input{candidate, candidate}, acc}))
          case Fail{error}: live_inputs_go(cwd, rest, output, compiler, acc)

def live_inputs(cwd: String, argv: List<String>, output: String, compiler: String) -> IO(List<Input>):
  live_inputs_go(cwd, argv, output, compiler, Nil{})

def input_adoption_text(inputs: List<Input>) -> IO(String):
  match inputs:
    case Nil{}: IO.pure(String, "")
    case Con{Input{source, destination}, rest}:
      do IO<String>:
        digest <- IO.try(String, Identity.file_digest(source))
        tail <- input_adoption_text(rest)
        IO.pure(String, "input=" ++ source ++ "\t" ++ destination ++ "\t" ++ digest ++ "\n" ++ tail)

def adoption_text(pid: String, start: String, cwd: String, output: String,
                  compiler: String, entry: String, argv: List<String>,
                  inputs: List<Input>, key: String, started: String) -> IO(String):
  do IO<String>:
    inputs_text <- input_adoption_text(inputs)
    IO.pure(String, "schema=" ++ Identity.schema() ++ "\npid=" ++ pid
      ++ "\nstarttime=" ++ start ++ "\ncwd=" ++ cwd ++ "\noutput=" ++ output
      ++ "\ncompiler=" ++ compiler ++ "\nentry=" ++ entry ++ "\nidentity=" ++ key
      ++ "\nstarted_ns=" ++ started ++ "\nargv=" ++ Tx.join("\t", argv) ++ "\n"
      ++ inputs_text)

def write_adoption_failure(keydir: String, started: String, detail: String) -> IO(Unit):
  do IO<Unit>:
    +run = keydir ++ "/runs/external-" ++ started
    made : Unit <- IO.try(Unit, L.mkdir_p(run))
    wrote : Unit <- IO.try(Unit, Result.write(run ++ "/result", "failed", "1", "cgen", "", started, started,
      "external", run, run ++ "/stdout", run ++ "/stderr", detail, Tx.join("\n", Nil{})))
    removed : Unit <- IO.try(Unit, L.remove(keydir ++ "/active"))
    IO.pure(Unit, Unit{})

def finish_adoption(keydir: String, adoption: String, name: String, path: String) -> IO(Unit):
  do IO<Unit>:
    pid <- IO.try(U32, L.pid())
    +key = field(adoption, "identity")
    +started = field(adoption, "started_ns")
    +cache = keydir ++ "/completed.tmp." ++ U32.show(pid)
    made : Unit <- IO.try(Unit, L.mkdir_p(cache ++ "/artifacts"))
    retained : Unit <- IO.try(Unit, Result.retain_external(path, cache ++ "/artifacts", name))
    finished <- IO.try(String, L.now_ns())
    wrote : Unit <- IO.try(Unit, Result.write_adoption(cache ++ "/result", key, started, finished,
      adoption, name, path, cache ++ "/artifacts"))
    renamed : Unit <- IO.try(Unit, F.Files.rename(cache, keydir ++ "/completed"))
    removed : Unit <- IO.try(Unit, L.remove(keydir ++ "/active"))
    IO.pure(Unit, Unit{})

def guard_loop(keydir: String, pid: U32, start: String, name: String, path: String, started: String) -> IO(Unit):
  do IO<Unit>:
    alive <- IO.try(U32, L.alive(pid, start))
    Bool.pick(IO(Unit), U32.is_eq(alive, 1),
      do IO<Unit>:
        slept : Unit <- IO.try(Unit, L.sleep_millis(5000))
        guard_loop(keydir, pid, start, name, path, started),
      do IO<Unit>:
        adoption <- IO.try(String, L.read_text(keydir ++ "/adoption"))
        size <- IO.try(U32, F.Files.size(path))
        Bool.pick(IO(Unit), U32.is_lt(0, size),
          do IO<Unit>:
            digest <- IO.try(String, Identity.file_digest(path))
            +record = adoption ++ "artifact-name=" ++ name ++ "\nartifact-digest=" ++ digest ++ "\n"
            recorded : Unit <- IO.try(Unit, L.write_text(keydir ++ "/adoption", record))
            published : Unit <- finish_adoption(keydir, record, name, path)
            verified <- IO.try(Bool, Result.verify_adoption(keydir, record))
            Bool.pick(IO(Unit), verified,
              IO.pure(Unit, Unit{}),
              do IO<Unit>:
                removed : Unit <- IO.try(Unit, L.remove_tree(keydir ++ "/completed"))
                write_adoption_failure(keydir, started, "adoption identity differs from the live process")),
          write_adoption_failure(keydir, started, "external compiler exited without a complete artifact")))

def guard_pid_result(parsed: Maybe<U32>, keydir: String, pid_text: String, start: String,
                     name: String, path: String) -> IO(Unit):
  match parsed:
    case None{}: IO.die(Unit, 2, "compile-queue: adoption pid is malformed")
    case Some{pid}:
      do IO<Unit>:
        locked_key : Unit <- IO.try(Unit, L.lock_fd_acquire(9))
        locked_cgen : Unit <- IO.try(Unit, L.lock_fd_acquire(8))
        present <- regular(keydir ++ "/completed/result")
        match present:
          case True{}:
            do IO<Unit>:
              adoption <- IO.try(String, L.read_text(keydir ++ "/adoption"))
              verified <- IO.try(Bool, Result.verify_adoption(keydir, adoption))
              Bool.pick(IO(Unit), verified, IO.pure(Unit, Unit{}),
                IO.die(Unit, 1, "compile-queue: completed result is not a verified adoption record"))
          case False{}:
            do IO<Unit>:
              started <- IO.try(String, L.now_ns())
              active : Unit <- IO.try(Unit, L.write_text(keydir ++ "/active", "pid=" ++ pid_text
                ++ "\nstarttime=" ++ start ++ "\nkind=cgen\nsetsid=external\nstarted_ns=" ++ started ++ "\n"))
              guard_loop(keydir, pid, start, name, path, started)

def guard(keydir: String, pid_text: String, start: String, name: String, path: String) -> IO(Unit):
  guard_pid_result(U32.read(pid_text), keydir, pid_text, start, name, path)


def parse_adopt(args: List<String>, config: Config) -> IO(Config):
  match args:
    case Nil{}:
      Bool.pick(IO(Config), valid_state_root(field(config.text, "state_root")),
        IO.pure(Config, config),
        IO.die(Config, 2, "compile-queue: set BATON_COMPILE_QUEUE_ROOT or pass an absolute --state-root"))
    case "--pid" <> value <> rest: parse_adopt(rest, config_line(config, "pid", value))
    case "--state-root" <> value <> rest: parse_adopt(rest, config_line(config, "state_root", value))
    case "--source-root" <> value <> rest: parse_adopt(rest, config_line(config, "source_root", value))
    case "--entry" <> value <> rest: parse_adopt(rest, config_line(config, "entry", value))
    case "--compiler" <> value <> rest: parse_adopt(rest, config_line(config, "compiler", value))
    case "--artifact" <> value <> rest: parse_adopt(rest, config_line(config, "artifact", value))
    case "--option" <> value <> rest: parse_adopt(rest, config_line(config, "option", value))
    case +option <> rest: IO.die(Config, 2, "compile-queue: unknown option " ++ option)

def adopt_live(pid: U32, pid_text: String, start: String, cwd: String,
               argv: List<String>, output: String, name: String, path: String,
               text: String) -> IO(Unit):
  do IO<Unit>:
    +compiler_override = field(text, "compiler")
    +head = argv_head(argv)
    compiler <- Bool.pick(IO(String), non_empty(compiler_override), IO.pure(String, compiler_override),
      Bool.pick(IO(String), non_empty(head), IO.pure(String, head),
        IO.try(String, L.environ(pid, "BEND"))))
    +entry_override = field(text, "entry")
    +entry = Bool.pick(String, non_empty(entry_override), entry_override, entry_of_argv(argv))
    inputs <- live_inputs(cwd, argv, output, compiler)
    +state = field(text, "state_root")
    +logical_argv = Con{compiler, Con{entry, Con{"-o", Con{output, Nil{}}}}}
    +material_text = "kind=cgen\nstate_root=" ++ state ++ "\ncwd=" ++ cwd
      ++ "\nroot=" ++ cwd ++ "\nsource_root=" ++ cwd ++ "\nentry=" ++ entry
      ++ "\ncompiler=" ++ compiler ++ "\nreceipt=\ntoken=\n"
      ++ Tx.join("\n", fields_all(text, "option")) ++ "\n"
      ++ artifact_material_text(name, output)
    +material_config = Config{material_text, logical_argv}
    key <- identity_key(material_config)
    +keydir = keydir_of(state, key)
    made : Unit <- IO.try(Unit, L.mkdir_p(keydir ++ "/runs"))
    lock <- IO.try(U32, L.lock_acquire(keydir ++ "/lock"))
    present <- regular(keydir ++ "/completed/result")
    match present:
      case True{}:
        do IO<Unit>:
          adoption <- IO.try(String, L.read_text(keydir ++ "/adoption"))
          verified <- IO.try(Bool, Result.verify_adoption(keydir, adoption))
          Bool.pick(IO(Unit), verified,
            do IO<Unit>:
              released : Unit <- IO.try(Unit, L.lock_release(lock))
              IO.write("adopted=0\nkey=" ++ key ++ "\nreason=completed-result-exists\n"),
            do IO<Unit>:
              released : Unit <- IO.try(Unit, L.lock_release(lock))
              IO.die(Unit, 2, "compile-queue: completed result is not a verified adoption record"))
      case False{}:
        do IO<Unit>:
          heavy <- IO.try(Maybe<U32>, L.lock_try(state ++ "/heavy.lock"))
          match heavy:
            case None{}:
              do IO<Unit>:
                released_lock : Unit <- IO.try(Unit, L.lock_release(lock))
                IO.write("adopted=0\nkey=" ++ key ++ "\nreason=compiler-queue-busy\n")
            case Some{heavy}:
              do IO<Unit>:
                started <- IO.try(String, L.now_ns())
                adoption <- adoption_text(pid_text, start, cwd, output, compiler, entry, argv, inputs, key, started)
                wrote : Unit <- IO.try(Unit, L.write_text(keydir ++ "/adoption", adoption))
                +guard_args = P.argv(Con{"__guard", Con{keydir, Con{pid_text, Con{start,
                  Con{name, Con{path, Nil{}}}}}}}})
                guard_pid <- IO.try(U32, L.spawn_detached(guard_args, lock, heavy))
                released_lock : Unit <- IO.try(Unit, L.close_fd(lock))
                released_heavy : Unit <- IO.try(Unit, L.close_fd(heavy))
                IO.write("adopted=1\nkey=" ++ key ++ "\npid=" ++ pid_text
                  ++ "\nguard=" ++ U32.show(guard_pid) ++ "\nartifact=" ++ path ++ "\n")

def adopt_artifact_value(parsed: Maybe<Split>, pid: U32, pid_text: String, start: String, cwd: String,
                         argv: List<String>, output_abs: String, text: String) -> IO(Unit):
  match parsed:
    case None{}: IO.die(Unit, 2, "compile-queue: adopt requires --artifact NAME=PATH")
    case Some{Split{name, path}}:
      do IO<Unit>:
        +path_ok = Tx.str_eq(output_abs, path)
        +absolute_ok = Tx.starts_with(path, "/")
        Bool.pick(IO(Unit), path_ok,
          Bool.pick(IO(Unit), absolute_ok,
            adopt_live(pid, pid_text, start, cwd, argv, output_abs, name, path, text),
            IO.die(Unit, 2, "compile-queue: adopted artifact path must be absolute")),
          IO.die(Unit, 2, "compile-queue: artifact path differs from the live -o output"))

def adopt_output_value(parsed: String, pid: U32, pid_text: String, start: String,
                       cwd: String, argv: List<String>, artifact: String, text: String) -> IO(Unit):
  match parsed:
    case SNil{}: IO.die(Unit, 2, "compile-queue: the live command has no -o output")
    case output_path:
      +output_abs = absolute_path(cwd, output_path)
      adopt_artifact_value(split_eq(artifact, ""), pid, pid_text, start, cwd, argv, output_abs, text)

def adopt_pid_value(parsed: Maybe<U32>, pid_text: String, artifact: String, text: String) -> IO(Unit):
  match parsed:
    case None{}: IO.die(Unit, 2, "compile-queue: adopt requires --pid")
    case Some{pid}:
      do IO<Unit>:
        start <- IO.try(String, L.starttime(pid))
        cwd <- IO.try(String, L.cwd_of_pid(pid))
        cmdline <- IO.try(String, L.cmdline(pid))
        +argv = Tx.split_nul(cmdline)
        adopt_output_value(output_of_argv(argv), pid, pid_text, start, cwd, argv, artifact, text)

def adopt_command(args: List<String>) -> IO(Unit):
  do IO<Unit>:
    state <- default_state_root()
    config <- fresh_config()
    parsed <- parse_adopt(args, config_line(config, "state_root", state))
    match parsed:
      case Config{text, command}:
        do IO<Unit>:
          ready <- require_state_root(field(text, "state_root"))
          +pid_text = field(text, "pid")
          +artifact = field(text, "artifact")
          adopt_pid_value(U32.read(pid_text), pid_text, artifact, text)

def usage() -> String:
  "usage: compile-queue.sh run --kind cgen|cc --state-root DIR --cwd DIR [options] -- COMMAND...\n"
  ++ "       compile-queue.sh key --kind cgen|cc [options]\n"
  ++ "       cc requests require --compiler, --linker, --version and an absolute --source-root\n"
  ++ "       compile-queue.sh cancel --state-root DIR --key KEY --token TOKEN\n"
  ++ "       compile-queue.sh wait --state-root DIR --key KEY\n"
  ++ "       compile-queue.sh status --state-root DIR [--key KEY]\n"
  ++ "       compile-queue.sh adopt --pid PID --state-root DIR --artifact NAME=PATH\n"

def main() -> IO(Unit):
  do IO<Unit>:
    args <- IO.args()
    match args:
      case "run" <> rest: run_command(rest)
      case "key" <> rest: key_command(rest)
      case "wait" <> rest: wait_command(rest)
      case "cancel" <> rest: cancel_command(rest)
      case "status" <> rest: status_command(rest)
      case "adopt" <> rest: adopt_command(rest)
      case "__supervise" <> attempt <> Nil{}: supervise(attempt)
      case "__watch-heavy" <> attempt <> pid_text <> start <> Nil{}:
        watch_heavy_pid(U32.read(pid_text), attempt, start)
      case "__guard" <> keydir <> pid <> start <> name <> path <> Nil{}:
        guard(keydir, pid, start, name, path)
      case other: IO.die(Unit, 2, usage())
