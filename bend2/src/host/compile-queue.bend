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

def field_lines(lines: List<String>, name: String) -> String:
  match lines:
    case Nil{}: ""
    case +line <> rest:
      match split_eq(line, ""):
        case Some{Split{left, right}}:
          Bool.pick(String, Tx.str_eq(left, name), right, field_lines(rest, name))
        case None{}: field_lines(rest, name)

def field(text: String, name: String) -> String:
  field_lines(Tx.split_lines(text), name)

def collect_lines(lines: List<String>, name: String, acc: List<String>) -> List<String>:
  match lines:
    case Nil{}: List.reverse(&1, String, acc)
    case +line <> rest:
      match split_eq(line, ""):
        case Some{Split{left, right}}:
          +next = Bool.pick(List<String>, Tx.str_eq(left, name), Con{right, acc}, acc)
          collect_lines(rest, name, next)
        case None{}: collect_lines(rest, name, acc)

def fields_all(text: String, name: String) -> List<String>:
  collect_lines(Tx.split_lines(text), name, Nil{})

def pair_of_tabs(value: String) -> Maybe<Pair>:
  match Tx.split_tabs(value):
    case left <> right <> Nil{}: Some{Pair{left, right}}
    case other: None{}

def input_rows_go(rows: List<String>, acc: List<Input>) -> List<Input>:
  match rows:
    case Nil{}: List.reverse(&1, Input, acc)
    case +row <> rest:
      match pair_of_tabs(row):
        case Some{Pair{left, right}}: input_rows_go(rest, Con{Input{left, right}, acc})
        case None{}: input_rows_go(rest, acc)

def input_rows(text: String) -> List<Input>:
  input_rows_go(fields_all(text, "input"), Nil{})

def artifact_rows_go(rows: List<String>, acc: List<Artifact>) -> List<Artifact>:
  match rows:
    case Nil{}: List.reverse(&1, Artifact, acc)
    case +row <> rest:
      match pair_of_tabs(row):
        case Some{Pair{left, right}}: artifact_rows_go(rest, Con{Artifact{left, right}, acc})
        case None{}: artifact_rows_go(rest, acc)

def artifact_rows(text: String) -> List<Artifact>:
  artifact_rows_go(fields_all(text, "artifact"), Nil{})

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

def choose_root(root: String, xdg: String, home: String, uid: U32) -> String:
  match root:
    case SCon{c, rest}: root
    case SNil{}:
      match xdg:
        case SCon{c, rest}: xdg ++ "/baton/compile-queue"
        case SNil{}:
          match home:
            case SCon{c, rest}: home ++ "/.cache/baton/compile-queue"
            case SNil{}: "/tmp/baton-compile-queue-" ++ U32.show(uid)

def default_state_root() -> IO(String):
  do IO<String>:
    root <- env_value("BATON_COMPILE_QUEUE_ROOT")
    xdg <- env_value("XDG_CACHE_HOME")
    home <- env_value("HOME")
    uid <- IO.try(U32, L.uid())
    IO.pure(String, choose_root(root, xdg, home, uid))

def fresh_config() -> IO(Config):
  do IO<Config>:
    state <- default_state_root()
    cwd <- IO.try(String, L.cwd())
    IO.pure(Config, default_config(state, cwd))

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
    case "--receipt" <> value <> rest: parse_common(rest, config_line(config, "receipt", value))
    case "--token" <> value <> rest: parse_common(rest, config_line(config, "token", value))
    case "--input" <> value <> rest: parse_common(rest, config_input(config, value))
    case "--aux" <> value <> rest: parse_common(rest, config_line(config, "aux", value))
    case "--option" <> value <> rest: parse_common(rest, config_line(config, "option", value))
    case "--artifact" <> value <> rest:
      match split_eq(value, ""):
        case Some{Split{name, path}}: parse_common(rest, config_line(config, "artifact", name ++ "\t" ++ path))
        case None{}: IO.die(Config, 2, "compile-queue: artifact must be NAME=PATH: " ++ value)
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
      +artifact_ok = non_empty_list(artifacts)
      +source_ok = Bool.pick(Bool, Tx.str_eq(kind, "cgen"),
        Bool.and(non_empty(source), non_empty(entry)), True{})
      +token_okay = Bool.pick(Bool, non_empty(token), token_ok(token), True{})
      +state_ok = Tx.starts_with(state, "/")
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
                "compile-queue: at least one --artifact NAME=PATH is required"),
              "compile-queue: a command is required after --"),
            "compile-queue: cwd is unavailable"),
          "compile-queue: state root must be absolute"),
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
      +linker = Bool.pick(String, String.eq(field(text, "kind"), "cc"),
        Bool.pick(String, non_empty(field(text, "linker")), field(text, "linker"), "ld"), "")
      IO.try(String, Identity.request_key(
        field(text, "kind"), cwd, root,
        field(text, "source_root"), field(text, "entry"), compiler,
        linker, "", input_pairs_text(inputs),
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

def normalize_token(token: String, cwd: String, root: String, compiler: String,
                    inputs: List<Input>, artifacts: List<Artifact>) -> String:
  match artifact_name_match(token, artifacts):
    case Some{name}: "{out:" ++ name ++ "}"
    case None{}:
      match input_destination_match(token, inputs):
        case Some{destination}: "{in:" ++ destination ++ "}"
        case None{}:
          Bool.pick(String, Tx.str_eq(token, compiler), "{compiler}",
            match prefix_token(token, root, "@root"):
              case Some{value}: value
              case None{}:
                match prefix_token(token, cwd, "@cwd"):
                  case Some{value}: value
                  case None{}: token)

def normalize_command(args: List<String>, cwd: String, root: String, compiler: String,
                      inputs: List<Input>, artifacts: List<Artifact>) -> String:
  match args:
    case Nil{}: ""
    case Con{token, rest}:
      normalize_token(token, cwd, root, compiler, inputs, artifacts)
      ++ "\n" ++ normalize_command(rest, cwd, root, compiler, inputs, artifacts)

def keydir_of(state_root: String, key: String) -> String:
  state_root ++ "/keys/" ++ key

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
        copied : Unit <- IO.try(Unit, L.copy_file(source, work ++ "/" ++ destination))
        copy_inputs(work, rest)

def replace_token(token: String, work: String, inputs: List<Input>, artifacts: List<Artifact>) -> String:
  match artifact_match(token, work, artifacts):
    case Some{value}: value
    case None{}:
      match input_match(token, work, inputs):
        case Some{value}: value
        case None{}: token

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
        wrote_command : Unit <- IO.try(Unit, L.write_text(attempt ++ "/command", command_text(command, work, inputs, artifacts)))
        wrote_meta : Unit <- IO.try(Unit, L.write_text(attempt ++ "/meta", meta_text(config, key, keydir, attempt, artifacts)))
        digest_written : Unit <- Bool.pick(IO(Unit), Tx.str_eq(field(text, "kind"), "cgen"),
          do IO<Unit>:
            digest : String <- IO.try(String, Identity.source_digest(field(text, "source_root"), field(text, "entry")))
            IO.try(Unit, L.write_text(attempt ++ "/source-digest", "digest=" ++ digest ++ "\n")),
          IO.pure(Unit, Unit{}))
        IO.pure(Unit, Unit{})

def publish_token(keydir: String, requested: String) -> IO(String):
  do IO<String>:
    pid <- IO.try(U32, L.pid())
    now <- IO.try(String, L.now_ns())
    start <- IO.try(String, L.starttime(pid))
    +token = Bool.pick(String, non_empty(requested), requested,
      "owner-" ++ U32.show(pid) ++ "-" ++ now)
    made : Unit <- IO.try(Unit, L.mkdir_p(keydir ++ "/owners"))
    wrote : Unit <- IO.try(Unit, L.write_text(keydir ++ "/owners/" ++ token,
      "pid=" ++ U32.show(pid) ++ "\nstarttime=" ++ start ++ "\nstarted_ns=" ++ now ++ "\n"))
    IO.pure(String, token)

def remove_token(keydir: String, token: String) -> IO(Unit):
  Bool.pick(IO(Unit), non_empty(token),
    IO.try(Unit, L.remove(keydir ++ "/owners/" ++ token)), IO.pure(Unit, Unit{}))

def count_live_owners(keydir: String, names: List<String>, acc: U32) -> IO(U32):
  match names:
    case Nil{}: IO.pure(U32, acc)
    case Con{name, rest}:
      do IO<U32>:
        text <- IO.try(String, L.read_text(keydir ++ "/owners/" ++ name))
        +pid_text = field(text, "pid")
        +start = field(text, "starttime")
        match U32.read(pid_text):
          case None{}:
            removed : Unit <- IO.try(Unit, L.remove(keydir ++ "/owners/" ++ name))
            count_live_owners(keydir, rest, acc)
          case Some{pid}:
            alive <- IO.try(U32, L.alive(pid, start))
            Bool.pick(IO(U32), U32.is_eq(alive, 1),
              count_live_owners(keydir, rest, U32.add(1, acc)),
              do IO<U32>:
                removed : Unit <- IO.try(Unit, L.remove(keydir ++ "/owners/" ++ name))
                count_live_owners(keydir, rest, acc))

def owner_count(keydir: String) -> IO(U32):
  do IO<U32>:
    names <- IO.try(String, L.list_dir(keydir ++ "/owners"))
    count_live_owners(keydir, Tx.split_lines(names), 0)

def clean_stale_active(keydir: String) -> IO(Unit):
  do IO<Unit>:
    +active = keydir ++ "/active"
    text <- IO.try(String, L.read_text(active))
    +pid_text = field(text, "pid")
    +start = field(text, "starttime")
    match U32.read(pid_text):
      case None{}:
        removed : Unit <- IO.try(Unit, L.remove(active))
        IO.pure(Unit, Unit{})
      case Some{pid}:
        alive <- IO.try(U32, L.alive(pid, start))
        removed : Unit <- Bool.pick(IO(Unit), U32.is_eq(alive, 1), IO.pure(Unit, Unit{}),
          IO.try(Unit, L.remove(active)))
        IO.pure(Unit, Unit{})

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
    owners : Unit <- IO.try(Unit, L.remove_tree(keydir ++ "/owners"))
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
    active : Unit <- IO.try(Unit, L.write_text(keydir ++ "/active", "pid=" ++ U32.show(pid)
      ++ "\nstarttime=" ++ start ++ "\nkind=" ++ kind ++ "\nsetsid=1\nstarted_ns=" ++ started ++ "\n"))
    Bool.pick(IO(Unit), Tx.str_eq(kind, "cgen"),
      do IO<Unit>:
        locked : Unit <- IO.try(Unit, L.lock_fd_acquire(8))
        before <- IO.try(String, L.read_text(attempt ++ "/source-digest"))
        +before_digest = field(before, "digest")
        after <- IO.try(String, Identity.source_digest(source_root, entry))
        Bool.pick(IO(Unit), Tx.str_eq(before_digest, after),
          run_supervised(attempt, keydir, kind, key, started, names, cwd),
          write_failure(attempt, keydir, "failed", 1, kind, key, started,
            "source changed before execution", names)),
      run_supervised(attempt, keydir, kind, key, started, names, cwd))

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
          cgen <- IO.try(U32, L.lock_open(state ++ "/cgen.lock"))
          locked : Unit <- Bool.pick(IO(Unit), Tx.str_eq(kind, "cgen"),
            IO.try(Unit, L.lock_fd_acquire(cgen)), IO.pure(Unit, Unit{}))
          +args = P.argv(Con{"__supervise", Con{attempt, Nil{}}})
          supervisor <- IO.try(U32, L.spawn_detached(args, lock, cgen))
          released_lock : Unit <- IO.try(Unit, L.close_fd(lock))
          released_cgen : Unit <- IO.try(Unit, L.close_fd(cgen))
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
                  removed : Unit <- remove_token(keydir, owner)
                  IO.die(Unit, 1, "compile-queue: execution ended without a result"))
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
                    latest <- IO.try(String, Result.latest_result(keydir, wait_start, Bool.pick(String, present, "1", "0")))
                    match latest:
                      case SNil{}: start_attempt(parsed, key, keydir, lock, owner)
                      case path:
                        do IO<Unit>:
                          removed : Unit <- remove_token(keydir, owner)
                          released : Unit <- IO.try(Unit, L.lock_release(lock))
                          Result.report_failure(path)
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
    case Nil{}: IO.pure(StateKey, StateKey{state, key})
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
                latest <- IO.try(String, Result.latest_result(keydir, "0", "0"))
                match latest:
                  case SNil{}: IO.die(Unit, 4, "compile-queue: no result for key " ++ key)
                  case path:
                    do IO<Unit>:
                      released : Unit <- IO.try(Unit, L.lock_release(lock))
                      Result.report_failure(path),
          IO.die(Unit, 2, "compile-queue: wait requires --key"))

def parse_cancel(args: List<String>, state: String, key: String, token: String) -> IO(CancelArgs):
  match args:
    case Nil{}: IO.pure(CancelArgs, CancelArgs{state, key, token})
    case "--state-root" <> value <> rest: parse_cancel(rest, value, key, token)
    case "--key" <> value <> rest: parse_cancel(rest, state, value, token)
    case "--token" <> value <> rest: parse_cancel(rest, state, key, value)
    case +option <> rest: IO.die(CancelArgs, 2, "compile-queue: unknown option " ++ option)

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
            +owner = keydir ++ "/owners/" ++ token
            present <- regular(owner)
            Bool.pick(IO(Unit), present,
              do IO<Unit>:
                removed : Unit <- IO.try(Unit, L.remove(owner))
                left <- owner_count(keydir)
                Bool.pick(IO(Unit), U32.is_eq(left, 0),
                  do IO<Unit>:
                    text <- IO.try(String, L.read_text(keydir ++ "/active"))
                    +pid_text = field(text, "pid")
                    +start = field(text, "starttime")
                    match U32.read(pid_text):
                      case None{}: IO.write("canceled=none\nkey=" ++ key ++ "\ntoken=" ++ token ++ "\n")
                      case Some{pid}:
                        alive <- IO.try(U32, L.alive(pid, start))
                        Bool.pick(IO(Unit), U32.is_eq(alive, 1),
                          do IO<Unit>:
                            +mode = field(text, "setsid")
                            +external = Bool.or(Tx.str_eq(mode, "external"), Tx.str_eq(mode, "starting"))
                            Bool.pick(IO(Unit), external,
                              IO.write("canceled=refused\nkey=" ++ key ++ "\nreason=external-or-starting\n"),
                              do IO<Unit>:
                                signaled : Unit <- Bool.pick(IO(Unit), Tx.str_eq(mode, "1"),
                                  IO.try(Unit, L.signal_group(pid, 15)),
                                  IO.try(Unit, L.signal_pid(pid, 15)))
                                slept : Unit <- IO.try(Unit, L.sleep_millis(3000))
                                alive2 <- IO.try(U32, L.alive(pid, start))
                                escalated : Unit <- Bool.pick(IO(Unit), U32.is_eq(alive2, 0),
                                  IO.pure(Unit, Unit{}),
                                  Bool.pick(IO(Unit), Tx.str_eq(mode, "1"),
                                    IO.try(Unit, L.signal_group(pid, 9)),
                                    IO.try(Unit, L.signal_pid(pid, 9))))
                                IO.write("canceled=requested\nkey=" ++ key ++ "\npid=" ++ U32.show(pid) ++ "\ntoken=" ++ token ++ "\n")),
                          IO.write("canceled=stale\nkey=" ++ key ++ "\ntoken=" ++ token ++ "\n")),
                  IO.write("canceled=withdrawn\nkey=" ++ key ++ "\ntoken=" ++ token ++ "\nowners=" ++ U32.show(left) ++ "\n")),
              IO.write("canceled=unknown-token\nkey=" ++ key ++ "\ntoken=" ++ token ++ "\n")),
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
              IO.write("completed key=" ++ key ++ "\n"), IO.pure(Unit, Unit{}))
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
    owners : Unit <- IO.try(Unit, L.remove_tree(keydir ++ "/owners"))
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
            published : Unit <- finish_adoption(keydir, adoption, name, path)
            verified <- IO.try(Bool, Result.verify_adoption(keydir, adoption))
            Bool.pick(IO(Unit), verified,
              IO.pure(Unit, Unit{}),
              do IO<Unit>:
                removed : Unit <- IO.try(Unit, L.remove_tree(keydir ++ "/completed"))
                write_adoption_failure(keydir, started, "adoption identity differs from the live process")),
          write_adoption_failure(keydir, started, "external compiler exited without a complete artifact")))

def guard(keydir: String, pid_text: String, start: String, name: String, path: String) -> IO(Unit):
  do IO<Unit>:
    match U32.read(pid_text):
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
              started <- IO.try(String, L.now_ns())
              active : Unit <- IO.try(Unit, L.write_text(keydir ++ "/active", "pid=" ++ pid_text
                ++ "\nstarttime=" ++ start ++ "\nkind=cgen\nsetsid=external\nstarted_ns=" ++ started ++ "\n"))
              guard_loop(keydir, pid, start, name, path, started)

def parse_adopt(args: List<String>, config: Config) -> IO(Config):
  match args:
    case Nil{}: IO.pure(Config, config)
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
          started <- IO.try(String, L.now_ns())
          adoption <- adoption_text(pid_text, start, cwd, output, compiler, entry, argv, inputs, key, started)
          wrote : Unit <- IO.try(Unit, L.write_text(keydir ++ "/adoption", adoption))
          cgen <- IO.try(U32, L.lock_open(state ++ "/cgen.lock"))
          locked : Unit <- IO.try(Unit, L.lock_fd_acquire(cgen))
          +guard_args = P.argv(Con{"__guard", Con{keydir, Con{pid_text, Con{start,
            Con{name, Con{path, Nil{}}}}}}}})
          guard_pid <- IO.try(U32, L.spawn_detached(guard_args, lock, cgen))
          released_lock : Unit <- IO.try(Unit, L.close_fd(lock))
          released_cgen : Unit <- IO.try(Unit, L.close_fd(cgen))
          IO.write("adopted=1\nkey=" ++ key ++ "\npid=" ++ pid_text
            ++ "\nguard=" ++ U32.show(guard_pid) ++ "\nartifact=" ++ path ++ "\n")

def adopt_command(args: List<String>) -> IO(Unit):
  do IO<Unit>:
    state <- default_state_root()
    config <- fresh_config()
    parsed <- parse_adopt(args, config_line(config, "state_root", state))
    match parsed:
      case Config{text, command}:
        do IO<Unit>:
          +pid_text = field(text, "pid")
          +artifact = field(text, "artifact")
          match U32.read(pid_text):
            case None{}: IO.die(Unit, 2, "compile-queue: adopt requires --pid")
            case Some{pid}:
              do IO<Unit>:
                start <- IO.try(String, L.starttime(pid))
                cwd <- IO.try(String, L.cwd_of_pid(pid))
                cmdline <- IO.try(String, L.cmdline(pid))
                +argv = Tx.split_nul(cmdline)
                +output = output_of_argv(argv)
                match output:
                  case SNil{}: IO.die(Unit, 2, "compile-queue: the live command has no -o output")
                  case output_path:
                    +output_abs = absolute_path(cwd, output_path)
                    match split_eq(artifact, ""):
                      case None{}: IO.die(Unit, 2, "compile-queue: adopt requires --artifact NAME=PATH")
                      case Some{Split{name, path}}:
                        +path_ok = Tx.str_eq(output_abs, path)
                        +absolute_ok = Tx.starts_with(path, "/")
                        Bool.pick(IO(Unit), path_ok,
                          Bool.pick(IO(Unit), absolute_ok,
                            adopt_live(pid, pid_text, start, cwd, argv, output_abs, name, path, text),
                            IO.die(Unit, 2, "compile-queue: adopted artifact path must be absolute")),
                          IO.die(Unit, 2, "compile-queue: artifact path differs from the live -o output"))

def usage() -> String:
  "usage: compile-queue.sh run --kind cgen|cc --state-root DIR --cwd DIR [options] -- COMMAND...\n"
  ++ "       compile-queue.sh key --kind cgen|cc [options]\n"
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
      case "__guard" <> keydir <> pid <> start <> name <> path <> Nil{}:
        guard(keydir, pid, start, name, path)
      case other: IO.die(Unit, 2, usage())
