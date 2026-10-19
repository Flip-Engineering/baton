# Focused storage-policy test. Builds fixtures under .scratch/bend2-storage-test,
# uses a throwaway SQLite database for ownership evidence, and exercises host
# identity, symlink, process-reference, apply and preservation behavior.

import Base
import ../src/storage/types.bend as T
import ../src/storage/policy.bend as P
import ../src/storage/apply.bend as A
import ../src/storage/observe.bend as O
import ../src/storage/lifecycle.bend as L
import ../src/storage/state.bend as S
import ../src/host/process.bend as Proc
import ../src/host/files.bend as F
import ../src/host/sqlite.bend as DB
import ../src/git/process.bend as Git
import ../src/git/types.bend as G
import ../src/git/text.bend as Tx

def check(+name: String, +ok: Bool, +detail: String) -> IO(Unit):
  match ok:
    case True{}: IO.print("PASS " ++ name)
    case False{}: IO.die(Unit, 1, "FAIL " ++ name ++ ": " ++ detail)

def run_result(+result: G.RunRes) -> IO(Unit):
  match result:
    case G.RRun{G.SExit{code}, out}: Bool.pick(IO(Unit), U32.is_eq(code, 0), IO.pure(Unit, Unit{}), IO.die(Unit, 1, Tx.cmd_failed("fixture command")))
    case other: IO.die(Unit, 1, "fixture command did not run")

def run_cmd(args: List<String>) -> IO(Unit):
  do IO<Unit>:
    result : G.RunRes <- Git.runFull(args, ".")
    unit : Unit <- run_result(result)
    IO.pure(Unit, unit)

def setup_root(+root: String) -> IO(Unit):
  do IO<Unit>:
    removed : Unit <- run_cmd(["/bin/rm", "-rf", root])
    made : Unit <- IO.try(Unit, F.Files.mkdir(root))
    IO.pure(Unit, made)

def write_file(+path: String, +text: String) -> IO(Unit):
  do IO<Unit>:
    unit : Unit <- IO.try(Unit, F.Files.write_private(path, text))
    IO.pure(Unit, unit)

def db_schema() -> String:
  "CREATE TABLE sessions(id TEXT PRIMARY KEY,parent TEXT,harness TEXT,model TEXT DEFAULT '',effort TEXT DEFAULT '',native TEXT DEFAULT '',observed_harness TEXT DEFAULT '',observed_model TEXT DEFAULT '',observed_effort TEXT DEFAULT '',endpoint TEXT DEFAULT '',workspace TEXT DEFAULT '',branch TEXT DEFAULT '',base TEXT DEFAULT '');CREATE TABLE executions(session TEXT,id TEXT,directory TEXT,phase TEXT,status TEXT);CREATE TABLE messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,sender TEXT,recipient TEXT,kind TEXT,body TEXT,receipt TEXT);CREATE TABLE log_files(session TEXT,log TEXT,PRIMARY KEY(session,log));"

def db_session_sql(+root: String) -> String:
  "INSERT INTO sessions(id,parent,harness,workspace,branch,base) VALUES('owner',NULL,'omp','" ++ root ++ "','','');"

def db_setup(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    removed : Unit <- run_cmd(["/bin/rm", "-f", db])
    created : String <- IO.try(String, DB.Sql.query(db, db_schema()))
    inserted : String <- IO.try(String, DB.Sql.query(db, db_session_sql(root)))
    IO.pure(Unit, Unit{})

def clear_facts() -> T.Facts:
  T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}

def maybe_nat(value: Maybe<Nat>) -> Nat:
  match value:
    case None{}: 0n
    case Some{found}: found

def candidate_for(+path: String, +cls: T.StorageClass, +facts: T.Facts) -> IO(T.Candidate):
  do IO<T.Candidate>:
    observed : O.Observation <- O.observe(path)
    measured : Maybe<Nat> <- O.measure(path)
    bytes : Nat = maybe_nat(measured)
    identity : String = O.observation_identity(observed)
    IO.pure(T.Candidate, T.Candidate{path, cls, "owner", "proof", bytes, identity, facts})

def preview_root(+root: String) -> IO(String):
  do IO<String>:
    observed : O.Observation <- O.observe(root)
    IO.pure(String, O.observation_identity(observed))

def one_preview(+root: String, +candidate: T.Candidate) -> IO(T.Preview):
  do IO<T.Preview>:
    identity : String <- preview_root(root)
    IO.pure(T.Preview, P.preview(root, "", identity, True{}, Con{candidate, Nil{}}))

def apply_preview(+db: String, preview: T.Preview) -> IO(T.Receipt):
  match preview:
    case T.Preview{+root, +mount, +root_identity, +valid, +plan, entries}:
      A.apply(preview, A.Refresh{db, "", root, root_identity})

def one_apply(+db: String, +root: String, +candidate: T.Candidate) -> IO(T.Receipt):
  do IO<T.Receipt>:
    preview : T.Preview <- one_preview(root, candidate)
    receipt : T.Receipt <- apply_preview(db, preview)
    IO.pure(T.Receipt, receipt)

def walk_outcomes(entries: List<T.Removal>, +path: String) -> String:
  match entries:
    case Nil{}: "missing"
    case Con{head, tail}:
      match head:
        case T.Removal{entry_path, class, owner_proof, reason, bytes, +outcome}:
          Bool.pick(String, String.eq(entry_path, path), P.outcome_name(outcome) ++ "|" ++ P.outcome_detail(outcome), walk_outcomes(tail, path))

def receipt_outcome(receipt: T.Receipt, +path: String) -> String:
  match receipt:
    case T.Receipt{plan, root, mount, entries, reclaimed, complete}:
      walk_outcomes(entries, path)

def decision_text(+decision: T.Decision) -> String:
  match decision:
    case T.Keep{reason}: reason
    case T.Remove{reason}: "remove:" ++ reason

def decision_reason_of(+candidate: T.Candidate) -> String:
  match candidate:
    case T.Candidate{path, cls, owner, owner_proof, bytes, identity, facts}:
      decision_text(P.decide(cls, owner, facts))

def check_receipt(+name: String, receipt: T.Receipt, +path: String, +expected: String) -> IO(Unit):
  +report = receipt_outcome(receipt, path)
  check(name, String.starts_with(report, expected), report)

def check_decision(+name: String, candidate: T.Candidate, +expected: String) -> IO(Unit):
  +reason : String = decision_reason_of(candidate)
  check(name, String.eq(reason, expected), reason)

def presence_unknown(presence: T.Presence) -> Bool:
  match presence:
    case T.Unknown{}: True{}
    case other: False{}

def pure_checks() -> IO(Unit):
  do IO<Unit>:
    base : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", clear_facts()}
    owner_bad : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerDiffers{"other"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    lease_live : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Present{"lease"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    process_live : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Present{"pid"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    runtime_live : T.Candidate = T.Candidate{"/x", T.BuildOutput{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Present{"pid"}, T.Absent{}, T.Absent{}}}
    dirty : T.Candidate = T.Candidate{"/x", T.Checkout{}, "owner", "proof", 1n, "dir:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Present{"worktree"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    unpublished : T.Candidate = T.Candidate{"/x", T.Checkout{}, "owner", "proof", 1n, "dir:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Present{"1"}, T.Absent{}, T.Absent{}, T.Absent{}}}
    ref_live : T.Candidate = T.Candidate{"/x", T.GitObject{}, "owner", "proof", 1n, "dir:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Present{"aa"}, T.Absent{}}}
    pending : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Present{"1"}}}
    git_clear : T.Candidate = T.Candidate{"/x", T.GitObject{}, "owner", "proof", 1n, "dir:1:1", clear_facts()}
    a : Unit <- check_decision("owner-mismatch", owner_bad, "owner-mismatch")
    b : Unit <- check_decision("lease-live", lease_live, "lease-live")
    c : Unit <- check_decision("process-live", process_live, "process-live")
    d : Unit <- check_decision("runtime-input-live", runtime_live, "runtime-input-live")
    e : Unit <- check_decision("worktree-dirty", dirty, "worktree-dirty")
    f : Unit <- check_decision("unpublished-commits", unpublished, "unpublished-commits")
    g : Unit <- check_decision("ref-live", ref_live, "ref-live")
    h : Unit <- check_decision("pending-attempt", pending, "pending-attempt")
    i : Unit <- check_decision("git-object-report-only", git_clear, "git-object-report-only")
    j : Unit <- check_decision("scratch-clear", base, "remove:scratch-settled")
    malformed : T.Presence = O.presence_result(Done{"garbage"})
    k : Unit <- check("malformed-presence", presence_unknown(malformed), "malformed host result accepted")
    IO.pure(Unit, Unit{})

def presence_detail(presence: T.Presence) -> String:
  match presence:
    case T.Present{detail}: detail
    case T.Absent{}: ""
    case T.Unknown{}: "unknown"

def held_file_script(+file: String) -> String:
  "exec 3<" ++ file ++ "; sleep 30"

def spawned_holder(result: Result<&1,&1,U32 & String,U32>, +dir: String) -> IO(Unit):
  match result:
    case Fail{error}: IO.die(Unit, 1, "holder spawn failed")
    case Done{+handle}:
      do IO<Unit>:
        presence : T.Presence <- O.runtime_presence(dir)
        +seen : String = presence_detail(presence)
        ok : Unit <- check("fd-descendant", Bool.not(String.is_empty(seen)), seen)
        signaled : Unit <- IO.try(Unit, Proc.ProcessChild.signal(handle, 15))
        waited : String <- IO.try(String, Proc.ProcessChild.wait(handle))
        IO.pure(Unit, Unit{})

def spawned_process(result: Result<&1,&1,U32 & String,U32>, +dir: String) -> IO(Unit):
  match result:
    case Fail{error}: IO.die(Unit, 1, "process spawn failed")
    case Done{+handle}:
      do IO<Unit>:
        presence : T.Presence <- O.process_presence(dir)
        +seen : String = presence_detail(presence)
        ok : Unit <- check("process-descendant-cwd", Bool.not(String.is_empty(seen)), seen)
        signaled : Unit <- IO.try(Unit, Proc.ProcessChild.signal(handle, 15))
        waited : String <- IO.try(String, Proc.ProcessChild.wait(handle))
        IO.pure(Unit, Unit{})

def process_checks(+root: String) -> IO(Unit):
  do IO<Unit>:
    +dir : String = root ++ "/proc-parent"
    made : Unit <- IO.try(Unit, F.Files.mkdir(dir))
    spawned : Result<&1,&1,U32 & String,U32> <- Proc.ProcessChild.spawn(Proc.argv(["/bin/sleep", "30"]), dir, dir ++ "/stderr")
    unit : Unit <- spawned_process(spawned, dir)
    +held : String = dir ++ "/held"
    wrote : Unit <- write_file(held, "x")
    holder : Result<&1,&1,U32 & String,U32> <- Proc.ProcessChild.spawn(Proc.argv(["/bin/sh", "-c", held_file_script(held)]), dir, dir ++ "/holder.stderr")
    unit2 : Unit <- spawned_holder(holder, dir)
    IO.pure(Unit, unit2)

def apply_checks(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    +file : String = root ++ "/file.txt"
    wrote : Unit <- write_file(file, "payload")
    +candidate : T.Candidate <- candidate_for(file, T.Scratch{}, clear_facts())
    receipt : T.Receipt <- one_apply(db, root, candidate)
    a : Unit <- check_receipt("apply-removed", receipt, file, "removed")
    receipt2 : T.Receipt <- one_apply(db, root, candidate)
    b : Unit <- check_receipt("apply-idempotent", receipt2, file, "already-absent")
    +victim : String = root ++ "/victim.txt"
    wrote_victim : Unit <- write_file(victim, "keep")
    +link : String = root ++ "/link"
    linked : Unit <- run_cmd(["/bin/ln", "-s", victim, link])
    +link_candidate : T.Candidate <- candidate_for(link, T.Scratch{}, clear_facts())
    link_receipt : T.Receipt <- one_apply(db, root, link_candidate)
    c : Unit <- check_receipt("symlink-removed", link_receipt, link, "removed")
    victim_state : O.Observation <- O.observe(victim)
    d : Unit <- check("symlink-target-kept", O.observation_is_found(victim_state), "victim missing")
    +race : String = root ++ "/race.txt"
    wrote_race : Unit <- write_file(race, "payload")
    +race_candidate : T.Candidate <- candidate_for(race, T.Scratch{}, clear_facts())
    race_preview : T.Preview <- one_preview(root, race_candidate)
    replaced : Unit <- run_cmd(["/bin/rm", "-f", race])
    made_link : Unit <- run_cmd(["/bin/ln", "-s", victim, race])
    race_receipt : T.Receipt <- apply_preview(db, race_preview)
    e : Unit <- check_receipt("child-replacement-changed", race_receipt, race, "changed")
    IO.pure(Unit, Unit{})

def root_replacement_check(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    +file : String = root ++ "/root-race.txt"
    wrote : Unit <- write_file(file, "payload")
    +candidate : T.Candidate <- candidate_for(file, T.Scratch{}, clear_facts())
    preview : T.Preview <- one_preview(root, candidate)
    moved : Unit <- run_cmd(["/bin/mv", root, root ++ ".old"])
    made : Unit <- IO.try(Unit, F.Files.mkdir(root))
    receipt : T.Receipt <- apply_preview(db, preview)
    a : Unit <- check_receipt("root-replacement-refused", receipt, root, "refused")
    removed : Unit <- run_cmd(["/bin/rm", "-rf", root])
    restored : Unit <- run_cmd(["/bin/mv", root ++ ".old", root])
    IO.pure(Unit, Unit{})

def observation_unreadable(observed: O.Observation) -> Bool:
  match observed:
    case O.Unreadable{path, detail}: True{}
    case other: False{}

def unreadable_check(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    +locked : String = root ++ "/locked"
    made : Unit <- IO.try(Unit, F.Files.mkdir(locked))
    +file : String = locked ++ "/file"
    wrote : Unit <- write_file(file, "payload")
    chmod : Unit <- run_cmd(["/usr/bin/chmod", "000", locked])
    observed : O.Observation <- O.observe(file)
    a : Unit <- check("unreadable-observe", observation_unreadable(observed), "observed readable")
    chmod2 : Unit <- run_cmd(["/usr/bin/chmod", "700", locked])
    IO.pure(Unit, Unit{})

def scan_ok(scan: O.Scan) -> Bool:
  match scan:
    case O.Scan{ok, items}: ok

def malformed_entries_check(+root: String) -> IO(Unit):
  do IO<Unit>:
    +dir : String = root ++ "/entries"
    made : Unit <- IO.try(Unit, F.Files.mkdir(dir))
    +file : String = dir ++ "/bad\tname"
    wrote : Unit <- write_file(file, "x")
    scan : O.Scan <- O.children(dir)
    a : Unit <- check("malformed-entry-scan", Bool.not(scan_ok(scan)), "scan accepted tab name")
    IO.pure(Unit, Unit{})

def facts_owner_unknown(facts: T.Facts) -> Bool:
  match facts:
    case T.Facts{owner, lease, process, dirty, unpublished, runtime_input, ref, pending_attempt}:
      match owner:
        case T.OwnerUnknown{}: True{}
        case other: False{}

def parent_rename_check(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    +parent : String = root ++ "/parent-race"
    made : Unit <- IO.try(Unit, F.Files.mkdir(parent))
    +file : String = parent ++ "/file"
    wrote : Unit <- write_file(file, "payload")
    candidate : T.Candidate <- candidate_for(file, T.Scratch{}, clear_facts())
    preview : T.Preview <- one_preview(root, candidate)
    moved : Unit <- run_cmd(["/bin/mv", parent, parent ++ ".old"])
    made_new : Unit <- IO.try(Unit, F.Files.mkdir(parent))
    +replacement : String = parent ++ "/file"
    wrote_new : Unit <- write_file(replacement, "replacement")
    receipt : T.Receipt <- apply_preview(db, preview)
    a : Unit <- check_receipt("parent-rename-changed", receipt, file, "changed")
    kept : O.Observation <- O.observe(replacement)
    b : Unit <- check("parent-rename-replacement-kept", O.observation_is_found(kept), "replacement missing")
    IO.pure(Unit, Unit{})

def interrupted_check(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    +dir : String = root ++ "/interrupted"
    made : Unit <- IO.try(Unit, F.Files.mkdir(dir))
    +file : String = dir ++ "/first"
    wrote : Unit <- write_file(file, "payload")
    +locked : String = dir ++ "/locked"
    made_locked : Unit <- IO.try(Unit, F.Files.mkdir(locked))
    +held : String = locked ++ "/held"
    wrote_held : Unit <- write_file(held, "payload")
    chmod : Unit <- run_cmd(["/usr/bin/chmod", "000", locked])
    +candidate : T.Candidate <- candidate_for(dir, T.Scratch{}, clear_facts())
    preview1 : T.Preview <- one_preview(root, candidate)
    first : T.Receipt <- apply_preview(db, preview1)
    a : Unit <- check_receipt("interrupted-refused", first, dir, "refused")
    chmod2 : Unit <- run_cmd(["/usr/bin/chmod", "700", locked])
    preview2 : T.Preview <- one_preview(root, candidate)
    second : T.Receipt <- apply_preview(db, preview2)
    b : Unit <- check_receipt("interrupted-replay", second, dir, "removed")
    IO.pure(Unit, Unit{})

def malformed_db_check(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    bad : String <- IO.try(String, DB.Sql.query(db, "INSERT INTO messages(id,sender,recipient,kind,body) VALUES('bad','owner','','task','x');"))
    +state : S.State <- S.load(db)
    a : Unit <- check("malformed-db-invalid", Bool.not(S.valid_of(state)), "malformed DB accepted")
    facts : T.Facts <- S.facts_for(T.Scratch{}, "", root ++ "/unknown", state)
    b : Unit <- check("malformed-db-preserves", facts_owner_unknown(facts), "malformed DB produced a known owner")
    IO.pure(Unit, Unit{})

def db_ancestor_check(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    state : S.State <- S.load(db)
    +ancestor : String = root ++ "/state"
    facts : T.Facts <- S.facts_for(T.Scratch{}, "", ancestor, state)
    +reason : String = decision_reason_of(T.Candidate{ancestor, T.Scratch{}, "owner", "proof", 0n, "dir:0:0", facts})
    a : Unit <- check("db-ancestor-preserved", String.eq(reason, "lease-live"), reason)
    b : Unit <- check("db-path-ancestor-unknown-db", S.coordinator_related(root ++ "/state/missing.db", ancestor), "missing db ancestor not protected")
    IO.pure(Unit, Unit{})

def overlap_check(+root: String) -> IO(Unit):
  do IO<Unit>:
    specs : List<&2,L.RootSpec> <- IO.pure(List<&2,L.RootSpec>, Con{L.RootSpec{T.Scratch{}, root, ""}, Con{L.RootSpec{T.BuildOutput{}, root ++ "/nested", ""}, Nil{}}})
    a : Unit <- check("overlapping-roots", L.roots_overlap(specs), "overlap accepted")
    IO.pure(Unit, Unit{})

def busy_check(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    specs : List<&2,L.RootSpec> <- IO.pure(List<&2,L.RootSpec>, Con{L.RootSpec{T.Scratch{}, root, ""}, Nil{}})
    result : Result<&1,&1,U32 & String,List<T.Receipt>> <- L.apply_locked(db, specs, None{})
    a : Unit <- check("lock-busy-refused", Result.is_fail(&1,&1,U32 & String,List<T.Receipt>,result), "busy returned success")
    IO.pure(Unit, Unit{})

def main() -> IO(Unit):
  do IO<Unit>:
    +root : String = ".scratch/bend2-storage-test"
    setup : Unit <- setup_root(root)
    state_dir : Unit <- IO.try(Unit, F.Files.mkdir(root ++ "/state"))
    +db : String = root ++ "/state/coord.db"
    database : Unit <- db_setup(db, root)
    pure : Unit <- pure_checks()
    process : Unit <- process_checks(root)
    applied : Unit <- apply_checks(db, root)
    rootrace_dir : Unit <- IO.try(Unit, F.Files.mkdir(root ++ "/rootrace"))
    rootrace : Unit <- root_replacement_check(db, root ++ "/rootrace")
    unreadable : Unit <- unreadable_check(db, root)
    malformed : Unit <- malformed_entries_check(root)
    overlap : Unit <- overlap_check(root)
    busy : Unit <- busy_check(db, root)
    db_ancestor : Unit <- db_ancestor_check(db, root)
    interrupted : Unit <- interrupted_check(db, root)
    parent_rename : Unit <- parent_rename_check(db, root)
    malformed_db : Unit <- malformed_db_check(db, root)
    IO.print("storage checks: all green")
