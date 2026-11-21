import Base
import ./harness-installations.bend as Install
import ./harness-process.bend as P
import ./subscription-fallback.bend as Subs
import ../git/process.bend as Process
import ../git/text.bend as Tx
import ../git/types.bend as T
import ../host/choice.bend as Choice
import ../host/compile-queue-files.bend as Directory
import ../host/compile-queue-state.bend as State
import ../host/digest.bend as Digest
import ../host/files.bend as F
import ../host/posix.bend as Posix
import ../host/sqlite.bend as DB
import ../host/text.bend as Text
import ../json/canonical.bend as J
import ../coordinator/commands.bend as C

type Observation is Data:
  Observed{old: String, new: String, status: String, stdout: String, stderr: String, error: String}

def version_list(+harness: String, result: T.RunRes) -> String:
  match result:
    case T.RRun{T.SExit{0},out}:
      +lines = String.lines(Tx.trim_nl(out))
      Directory.first(Bool.pick(List<&2,String>,String.eq(harness,"muse"),List.reverse(&2,String,lines),lines))
    case other: ""

def version_answer(+command: String, +status: String, +stdout: String, +stderr: String, +version: String) -> Result<&1,&1,U32 & String,String>:
  Bool.pick(Result<&1,&1,U32 & String,String>,Bool.and(String.eq(status,"exit 0"),Bool.not(String.is_empty(version))),
    Done{version},Fail{(1,command ++ " --version " ++ status ++ ": " ++ stdout ++ stderr)})

def parse_version(+harness: String, +command: String, +home: String, +stage: String, capture: P.Capture) -> IO(Result<&1,&1,U32 & String,String>):
  match capture:
    case P.Captured{+status,+stdout,stderr}:
      +path = stage ++ "/version"
      P.bind_result(Unit,String,F.Files.write_group_read(path,stdout),written => do IO<Result<&1,&1,U32 & String,String>>:
        matches : T.RunRes <- Process.runFull(["/usr/bin/grep","-oE","[0-9]+\\.[0-9]+\\.[0-9]+([-+][[:alnum:]_.-]+)?","--",path],home)
        IO.pure(Result<&1,&1,U32 & String,String>,version_answer(command,status,stdout,stderr,version_list(harness,matches))))

def vendor_env(+path: String, claude_update: Bool) -> List<String>:
  List.append(&1,String,["/usr/bin/env","-u","CODEX_HOME","-u","CLAUDE_CONFIG_DIR"],
    Bool.pick(List<String>,claude_update,["-u","DISABLE_AUTOUPDATER","PATH=" ++ path,"MUSE_NO_AUTO_UPDATE=1"],
      ["PATH=" ++ path,"MUSE_NO_AUTO_UPDATE=1","DISABLE_AUTOUPDATER=1"]))

def version(+harness: String, +command: String, +home: String, +stage: String, path: String) -> IO(Result<&1,&1,U32 & String,String>):
  P.bind_result(P.Capture,String,P.capture(List.append(&1,String,vendor_env(path,False{}),[command,"--version"]),home,stage ++ "/version.stderr"),
    captured => parse_version(harness,command,home,stage,captured))

def codex_paths(+target: String, +current: String, +alias: String, link: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,List<String>>):
  match link:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,List<String>>,Done{[target]})
    case Done{link_target}:
      +standalone = Subs.directory_of(current)
      P.bind_result(String,List<String>,F.Files.realpath(current),release =>
        IO.pure(Result<&1,&1,U32 & String,List<String>>,Done{[release,current,alias,standalone ++ "/auto-update-version",standalone ++ "/selection-history"]}))

def backup_paths(+harness: String, +home: String, +alias: String, +target: String) -> IO(Result<&1,&1,U32 & String,List<String>>):
  match harness:
    case "codex": do IO<Result<&1,&1,U32 & String,List<String>>>:
      +current : String = home ++ "/.codex/packages/standalone/current"
      link : Result<&1,&1,U32 & String,String> <- F.Files.readlink(current)
      codex_paths(target,current,alias,link)
    case "claude-code":
      IO.pure(Result<&1,&1,U32 & String,List<String>>,Done{Bool.pick(List<String>,String.eq(target,alias),[target],[target,alias])})
    case "muse":
      +parent = Subs.directory_of(target)
      +state = parent ++ "/.muse-version"
      P.bind_result(String,List<String>,Text.Text.read(state),release =>
        IO.pure(Result<&1,&1,U32 & String,List<String>>,Done{[parent ++ "/muse-bin-" ++ String.trim(release),parent ++ "/.muse-release-info.json",state]}))
    case other: IO.pure(Result<&1,&1,U32 & String,List<String>>,Done{Nil{}})

def backup_options(file: String) -> List<String>:
  match file:
    case "auto-update-version": ["-a"]
    case "selection-history": ["-a"]
    case ".muse-release-info.json": ["-a"]
    case ".muse-version": ["-a"]
    case other: ["-al"]

def save_path(+path: String, copy: String, cwd: String, stat: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match stat:
    case Fail{(2,detail)}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{record}:
      P.run("/usr/bin/cp" <> List.append(&1,String,backup_options(Install.name(path)),["--",path,copy]),cwd)

@unsafe
def save(paths: List<String>, +stage: String, +index: U32, +home: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match paths:
    case Nil{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case +path <> rest: do IO<Result<&1,&1,U32 & String,Unit>>:
      stat : Result<&1,&1,U32 & String,String> <- F.Files.lstat(path)
      P.bind_result(Unit,Unit,save_path(path,stage ++ "/backup-" ++ U32.show(index),home,stat),
        saved => save(rest,stage,U32.add(index,1),home))

def restore_directory(+path: String, copy: String, stat: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match stat:
    case Fail{(2,detail)}: F.Files.move(copy,path)
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{record}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})

def restore_path(+path: String, +copy: String, stat: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match stat:
    case Fail{(2,detail)}: F.Files.remove(path)
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{record}:
      Choice.choose(IO(Result<&1,&1,U32 & String,Unit>),String.eq(Directory.observation_kind(record),"dir"), _update_unit => do IO<Result<&1,&1,U32 & String,Unit>>:
        present : Result<&1,&1,U32 & String,String> <- F.Files.lstat(path)
        restore_directory(path,copy,present), _update_unit => F.Files.move(copy,path))

def restore_error(+path: String, result: Result<&1,&1,U32 & String,Unit>) -> String:
  match result:
    case Done{unit}: ""
    case Fail{(code,detail)}: " Rollback of " ++ path ++ " failed: " ++ detail ++ "."

@unsafe
def restore(paths: List<String>, +stage: String, +index: U32) -> IO(String):
  match paths:
    case Nil{}: IO.pure(String,"")
    case +path <> rest: do IO<String>:
      +copy : String = stage ++ "/backup-" ++ U32.show(index)
      stat : Result<&1,&1,U32 & String,String> <- F.Files.lstat(copy)
      result : Result<&1,&1,U32 & String,Unit> <- restore_path(path,copy,stat)
      errors : String <- restore(rest,stage,U32.add(index,1))
      IO.pure(String,restore_error(path,result) ++ errors)

def update_args(+harness: String, command: String, path: String) -> List<String>:
  +prefix = vendor_env(path,String.eq(harness,"claude-code"))
  match harness:
    case "muse": List.append(&1,String,prefix,["MUSE_LAUNCHER_INSTALL=1",command])
    case other: List.append(&1,String,prefix,[command,"update"])

def verify_update(+harness: String, +alias: String, +command: String, +home: String, +stage: String, path: String, +old: String, +status: String) -> IO(Result<&1,&1,U32 & String,String>):
  match status:
    case "exit 0":
      P.bind_result(String,String,version(harness,command,home,stage,path),+new =>
        P.bind_result(Unit,String,Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),
        Bool.and(String.eq(harness,"omp"),Bool.not(String.eq(new,old))),F.Files.move(command,alias),
        IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})),
          published => IO.pure(Result<&1,&1,U32 & String,String>,Done{new})))
    case other:
      IO.pure(Result<&1,&1,U32 & String,String>,Fail{(1,"vendor updater exited " ++ Bool.pick(String,String.starts_with(status,"exit "),String.drop(status,5n),status))})

def after_verify(+paths: List<String>, +stage: String, +old: String, +status: String, +out: String, +err: String, result: Result<&1,&1,U32 & String,String>) -> IO(Observation):
  match result:
    case Done{new}: IO.pure(Observation,Observed{old,new,status,out,err,""})
    case Fail{(code,detail)}: do IO<Observation>:
      errors : String <- restore(paths,stage,0)
      IO.pure(Observation,Observed{old,old,status,out,err,detail ++ errors})

def after_vendor(+harness: String, +alias: String, +command: String, +home: String, +stage: String, path: String, +old: String, +paths: List<String>, result: Result<&1,&1,U32 & String,P.Capture>) -> IO(Observation):
  match result:
    case Fail{error}: after_verify(paths,stage,old,"","","",Fail{error})
    case Done{P.Captured{+status,out,err}}: do IO<Observation>:
      verified : Result<&1,&1,U32 & String,String> <- verify_update(harness,alias,command,home,stage,path,old,status)
      after_verify(paths,stage,old,status,out,err,verified)

type Plan is Data:
  Planned{command: String, path: String}

def prepare(+harness: String, +alias: String, +target: String, +stage: String, +path: String) -> IO(Result<&1,&1,U32 & String,Plan>):
  match harness:
    case "omp":
      +command = stage ++ "/" ++ Install.name(alias)
      P.bind_result(Unit,Plan,F.Files.copy_file(target,command),copied =>
        IO.pure(Result<&1,&1,U32 & String,Plan>,Done{Planned{command,stage ++ ":" ++ path}}))
    case other: IO.pure(Result<&1,&1,U32 & String,Plan>,Done{Planned{alias,path}})

def update_prepared(+harness: String, +alias: String, +home: String, +stage: String, +old: String, +paths: List<String>, result: Result<&1,&1,U32 & String,Plan>) -> IO(Observation):
  match result:
    case Fail{(code,detail)}: IO.pure(Observation,Observed{old,old,"","","",detail})
    case Done{Planned{+command,+path}}: do IO<Observation>:
      ran : Result<&1,&1,U32 & String,P.Capture> <- P.capture(update_args(harness,command,path),home,stage ++ "/vendor.stderr")
      after_vendor(harness,alias,command,home,stage,path,old,paths,ran)

def update_paths(+harness: String, +alias: String, +home: String, +stage: String, +old: String, +path: String, +target: String, paths: Result<&1,&1,U32 & String,List<String>>) -> IO(Observation):
  match paths:
    case Fail{(code,detail)}: IO.pure(Observation,Observed{old,old,"","","",detail})
    case Done{+files}: do IO<Observation>:
      planned : Result<&1,&1,U32 & String,Plan> <- P.bind_result(Unit,Plan,save(files,stage,0,home),saved =>
        prepare(harness,alias,target,stage,path))
      update_prepared(harness,alias,home,stage,old,files,planned)

def update_started(+harness: String, +alias: String, +home: String, +stage: String, +path: String, old: Result<&1,&1,U32 & String,String>) -> IO(Observation):
  match old:
    case Fail{(code,detail)}: IO.pure(Observation,Observed{"","","","","",detail})
    case Done{version}: do IO<Observation>:
      target : Result<&1,&1,U32 & String,String> <- F.Files.realpath(alias)
      +resolved : String = P.value_or(target,alias)
      paths : Result<&1,&1,U32 & String,List<String>> <- backup_paths(harness,home,alias,resolved)
      update_paths(harness,alias,home,stage,version,path,resolved,paths)

def update(+harness: String, +alias: String, +home: String, +stage: String) -> IO(Observation):
  do IO<Observation>:
    env : Result<&1,&1,U32 & String,String> <- IO.get_env("PATH")
    +path : String = Subs.directory_of(alias) ++ ":/bin:/usr/bin:" ++ P.value_or(env,"")
    old : Result<&1,&1,U32 & String,String> <- version(harness,alias,home,stage,path)
    update_started(harness,alias,home,stage,path,old)

def staged(+home: String, +harness: String, +alias: String, directory: Result<&1,&1,U32 & String,String>) -> IO(Observation):
  match directory:
    case Fail{(code,detail)}: IO.pure(Observation,Observed{"","","","","",detail})
    case Done{+stage}: do IO<Observation>:
      +result : Observation <- update(harness,alias,home,stage)
      removed : Result<&1,&1,U32 & String,Unit> <- P.run(["/usr/bin/rm","-rf","--",stage],home)
      IO.pure(Observation,result)

def nullable(+value: String) -> String:
  Bool.pick(String,String.is_empty(value),"null",J.string_literal(value))

def outcome(+old: String, +new: String, error: String) -> String:
  match error:
    case "": Bool.pick(String,String.eq(old,new),"current","updated")
    case other: "failed"

def exit_number(+status: String) -> String:
  Bool.pick(String,String.starts_with(status,"signal "),"-" ++ String.drop(status,7n),String.drop(status,5n))

def record(+id: String, +time: String, +harness: String, +alias: String, result: Observation) -> String:
  match result:
    case Observed{+old,+new,+status,stdout,stderr,+error}:
      "{\"id\":" ++ J.string_literal(id) ++ ",\"time\":" ++ time ++ ",\"harness\":" ++ J.string_literal(harness) ++
      ",\"installation\":" ++ J.string_literal(alias) ++ ",\"oldVersion\":" ++ nullable(old) ++ ",\"newVersion\":" ++ nullable(new) ++
      ",\"result\":" ++ J.string_literal(outcome(old,new,error)) ++
      Bool.pick(String,String.is_empty(status),"",",\"exitCode\":" ++ exit_number(status) ++ ",\"stdout\":" ++ J.string_literal(stdout) ++ ",\"stderr\":" ++ J.string_literal(stderr)) ++
      Bool.pick(String,String.is_empty(error),"",",\"error\":" ++ J.string_literal(error)) ++ "}\n"

def publish(+db: String, +home: String, +harness: String, +alias: String, +dir: String, +now: String) -> IO(Result<&1,&1,U32 & String,String>):
  P.bind_result(String,String,DB.Sql.read(db,"SELECT lower(hex(randomblob(16)));"),random => do IO<Result<&1,&1,U32 & String,String>>:
    +id : String = String.take("00000000000000000000",Nat.sub(20n,String.length(now))) ++ now ++ "-" ++ Tx.trim_nl(random)
    directory : Result<&1,&1,U32 & String,String> <- P.directory(Subs.directory_of(alias) ++ "/.baton-update-XXXXXXXXXX",home)
    result : Observation <- staged(home,harness,alias,directory)
    +path : String = dir ++ "/" ++ id ++ ".json"
    P.bind_result(Unit,String,F.Files.write_group_read(path,record(id,Nat.show(Nat.div(State.nat(now),1000000n)),harness,alias,result)),
      written => IO.pure(Result<&1,&1,U32 & String,String>,Done{path})))

def latest_file(entries: List<&2,String>, +latest: String) -> String:
  match entries:
    case Nil{}: latest
    case +file <> rest: latest_file(rest,Bool.pick(String,Bool.and(String.ends_with(file,".json"),String.is_lt(latest,file)),file,latest))

def fresh(+now: String, stat: Result<&1,&1,U32 & String,String>) -> Bool:
  match stat:
    case Fail{error}: False{}
    case Done{+record}:
      modified = State.nat(Directory.at(String.split(record,Char.from_u32(9)),5))
      Bool.and(String.eq(Directory.observation_kind(record),"file"),Nat.is_lt(Nat.div(State.nat(now),1000000000n),Nat.add(modified,3600n)))

def receipt(+db: String, +path: String) -> IO(Result<&1,&1,U32 & String,String>):
  P.bind_result(String,String,Text.Text.read(path),text =>
    P.bind_result(String,String,DB.Sql.read(db,"WITH r(j) AS (VALUES(" ++ C.q(text) ++ ")) SELECT json_object('id',j->>'id','harness',j->>'harness','installation',j->>'installation','time',j->>'time','oldVersion',j->>'oldVersion','newVersion',j->>'newVersion','result',j->>'result','log'," ++ C.q(path) ++ ",'error',j->>'error') FROM r;"),
      result => IO.pure(Result<&1,&1,U32 & String,String>,Done{Tx.trim_nl(result)})))

def refresh_locked(+db: String, +home: String, +harness: String, +alias: String, +dir: String) -> IO(Result<&1,&1,U32 & String,String>):
  P.bind_result(String,String,Directory.list_dir(dir),names => do IO<Result<&1,&1,U32 & String,String>>:
    +latest : String = dir ++ "/" ++ latest_file(String.split(names,Char.from_u32(0)),"")
    stat : Result<&1,&1,U32 & String,String> <- F.Files.stat(latest)
    P.bind_result(String,String,Posix.HostPosix.now_ns(),+now =>
      P.bind_result(String,String,Bool.pick(IO(Result<&1,&1,U32 & String,String>),fresh(now,stat),
        IO.pure(Result<&1,&1,U32 & String,String>,Done{latest}),publish(db,home,harness,alias,dir,now)),
        path => receipt(db,path))))

def locked(+db: String, +home: String, +harness: String, +alias: String, dir: String, +lock: U32) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    result : Result<&1,&1,U32 & String,String> <- refresh_locked(db,home,harness,alias,dir)
    released : Result<&1,&1,U32 & String,Unit> <- Posix.HostPosix.lock_release(lock)
    IO.pure(Result<&1,&1,U32 & String,String>,result)

def refresh_directory(+db: String, +home: String, +harness: String, +alias: String, digest: String) -> IO(Result<&1,&1,U32 & String,String>):
  +dir = home ++ "/.local/state/baton2/harness-updates/" ++ harness ++ "/" ++ digest
  P.bind_result(Unit,String,P.run(["/usr/bin/mkdir","-p","-m","700","--",dir],home),made =>
    P.bind_result(U32,String,Posix.HostPosix.lock_acquire(dir ++ "/lock"),lock => locked(db,home,harness,alias,dir,lock)))

def refresh(+db: String, +home: String, +harness: String, +alias: String) -> IO(Result<&1,&1,U32 & String,String>):
  P.bind_result(String,String,Digest.HostDigest.text(alias),digest => refresh_directory(db,home,harness,alias,digest))
