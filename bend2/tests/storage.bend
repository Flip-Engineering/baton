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

def command_output_decided(result: G.RunRes) -> String:
  match result:
    case G.RRun{G.SExit{code}, out}: Bool.pick(String, U32.is_eq(code, 0), Tx.trim_nl(out), "")
    case other: ""

def command_output(args: List<String>) -> IO(String):
  do IO<String>:
    result : G.RunRes <- Git.runFull(args, ".")
    IO.pure(String, command_output_decided(result))

def run_ignore(args: List<String>) -> IO(Unit):
  do IO<Unit>:
    result : G.RunRes <- Git.runFull(args, ".")
    IO.pure(Unit, Unit{})

def write_file(+path: String, +text: String) -> IO(Unit):
  do IO<Unit>:
    unit : Unit <- IO.try(Unit, F.Files.write_private(path, text))
    IO.pure(Unit, unit)

def db_schema() -> String:
  "CREATE TABLE sessions(id TEXT PRIMARY KEY,parent TEXT,harness TEXT,model TEXT DEFAULT '',effort TEXT DEFAULT '',native TEXT DEFAULT '',observed_harness TEXT DEFAULT '',observed_model TEXT DEFAULT '',observed_effort TEXT DEFAULT '',endpoint TEXT DEFAULT '',workspace TEXT DEFAULT '',branch TEXT DEFAULT '',base TEXT DEFAULT '');CREATE TABLE executions(session TEXT,id TEXT,directory TEXT,phase TEXT,status TEXT);CREATE TABLE messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,sender TEXT,recipient TEXT,kind TEXT,body TEXT,receipt TEXT);CREATE TABLE log_files(session TEXT,log TEXT,PRIMARY KEY(session,log));CREATE TABLE log_generations(session TEXT NOT NULL,attempt TEXT NOT NULL,log TEXT NOT NULL,base TEXT NOT NULL,PRIMARY KEY(session,attempt));"

def db_session_sql(+root: String) -> String:
  "INSERT INTO sessions(id,parent,harness,workspace,branch,base) VALUES('owner',NULL,'omp','" ++ root ++ "','','');"

def db_endpoint_sql(+root: String, +database: String) -> String:
  "INSERT INTO sessions(id,parent,harness,workspace,branch,base,endpoint) VALUES('db-owner',NULL,'omp','" ++ root ++ "/db-workspace','','','[\"/bin/baton\",\"" ++ database ++ "\",\"receive\",\"db-owner\"]');"

def db_endpoint_setup(+db: String, +root: String, +database: String) -> IO(Unit):
  do IO<Unit>:
    removed : String <- IO.try(String, DB.Sql.query(db, "DELETE FROM sessions WHERE id='db-owner';"))
    inserted : String <- IO.try(String, DB.Sql.query(db, db_endpoint_sql(root, database)))
    IO.pure(Unit, Unit{})

def db_setup(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    removed : Unit <- run_cmd(["/bin/rm", "-f", db])
    created : String <- IO.try(String, DB.Sql.query(db, db_schema()))
    inserted : String <- IO.try(String, DB.Sql.query(db, db_session_sql(root)))
    IO.pure(Unit, Unit{})

def clear_facts() -> T.Facts:
  T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}

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

def u32_of(value: Maybe<U32>) -> U32:
  match value:
    case Some{found}: found
    case None{}: 0

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

def check_first_receipt(+name: String, receipts: List<T.Receipt>, +path: String, +expected: String) -> IO(Unit):
  match receipts:
    case Nil{}: check(name, False{}, "missing receipt")
    case Con{head, tail}: check_receipt(name, head, path, expected)

def apply_outcome_check(+name: String, result: Result<&1,&1,U32 & String,List<T.Receipt>>, +path: String, +expected: String) -> IO(Unit):
  match result:
    case Fail{error}: check(name, False{}, "apply refused")
    case Done{receipts}: check_first_receipt(name, receipts, path, expected)

def check_decision(+name: String, candidate: T.Candidate, +expected: String) -> IO(Unit):
  +reason : String = decision_reason_of(candidate)
  check(name, String.eq(reason, expected), reason)

def presence_unknown(presence: T.Presence) -> Bool:
  match presence:
    case T.Unknown{}: True{}
    case other: False{}

def check_present_presence(label: String, presence: T.Presence) -> IO(Unit):
  match presence:
    case T.Present{detail}: check(label, True{}, detail)
    case other: check(label, False{}, "not-present")

def pure_owner_database_checks() -> IO(Unit):
  do IO<Unit>:
    owner_bad : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerDiffers{"other"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    database_live : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Present{"database-path"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    database_unknown : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Unknown{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    a : Unit <- check_decision("owner-mismatch", owner_bad, "owner-mismatch")
    b : Unit <- check_decision("database-path", database_live, "database-path")
    c : Unit <- check_decision("database-path-unknown", database_unknown, "database-path-unknown")
    IO.pure(Unit, Unit{})

def pure_runtime_checks() -> IO(Unit):
  do IO<Unit>:
    lease_live : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Present{"lease"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    process_live : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Present{"pid"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    runtime_live : T.Candidate = T.Candidate{"/x", T.BuildOutput{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Present{"pid"}, T.Absent{}, T.Absent{}}}
    a : Unit <- check_decision("lease-live", lease_live, "lease-live")
    b : Unit <- check_decision("process-live", process_live, "process-live")
    c : Unit <- check_decision("runtime-input-live", runtime_live, "runtime-input-live")
    IO.pure(Unit, Unit{})

def pure_checkout_checks() -> IO(Unit):
  do IO<Unit>:
    dirty : T.Candidate = T.Candidate{"/x", T.Checkout{}, "owner", "proof", 1n, "dir:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Present{"worktree"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    unpublished : T.Candidate = T.Candidate{"/x", T.Checkout{}, "owner", "proof", 1n, "dir:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Present{"1"}, T.Absent{}, T.Absent{}, T.Absent{}}}
    ref_live : T.Candidate = T.Candidate{"/x", T.GitObject{}, "owner", "proof", 1n, "dir:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Present{"aa"}, T.Absent{}}}
    a : Unit <- check_decision("worktree-dirty", dirty, "worktree-dirty")
    b : Unit <- check_decision("unpublished-commits", unpublished, "unpublished-commits")
    c : Unit <- check_decision("ref-live", ref_live, "ref-live")
    IO.pure(Unit, Unit{})

def pure_pending_checks() -> IO(Unit):
  do IO<Unit>:
    pending : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Present{"1"}}}
    git_clear : T.Candidate = T.Candidate{"/x", T.GitObject{}, "owner", "proof", 1n, "dir:1:1", clear_facts()}
    base : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", clear_facts()}
    a : Unit <- check_decision("pending-attempt", pending, "pending-attempt")
    b : Unit <- check_decision("git-object-report-only", git_clear, "git-object-report-only")
    c : Unit <- check_decision("scratch-clear", base, "remove:scratch-settled")
    IO.pure(Unit, Unit{})

def pure_presence_checks() -> IO(Unit):
  do IO<Unit>:
    malformed : T.Presence = O.presence_result(Done{"garbage"})
    a : Unit <- check("malformed-presence", presence_unknown(malformed), "malformed host result accepted")
    non_linux : T.Presence = O.presence_result(Done{"unknown:non-linux"})
    b : Unit <- check("non-linux-presence", presence_unknown(non_linux), "non-Linux scan accepted")
    IO.pure(Unit, Unit{})

def pure_identity_checks() -> IO(Unit):
  do IO<Unit>:
    owner_database : Unit <- pure_owner_database_checks()
    runtime : Unit <- pure_runtime_checks()
    checkout : Unit <- pure_checkout_checks()
    pending : Unit <- pure_pending_checks()
    presence : Unit <- pure_presence_checks()
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
        ok : Unit <- check_present_presence("fd-descendant", presence)
        removed : Unit <- run_cmd(["/bin/rm", "-f", dir ++ "/orchestra.db"])
        unlinked : T.Presence <- O.runtime_presence(dir)
        +unlinked_seen : String = presence_detail(unlinked)
        unlinked_ok : Unit <- check("unlinked-fd-owner", Bool.and(Bool.not(String.is_empty(unlinked_seen)), Bool.not(String.eq(unlinked_seen, "unknown"))), unlinked_seen)
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
    +held_path : String <- command_output(["/bin/realpath", "-m", held])
    holder : Result<&1,&1,U32 & String,U32> <- Proc.ProcessChild.spawn(Proc.argv(["/bin/sh", "-c", held_file_script(held_path)]), dir, dir ++ "/holder.stderr")
    unit2 : Unit <- spawned_holder(holder, dir)
    IO.pure(Unit, unit2)

def facts_database_or_unknown(+facts: T.Facts) -> T.Presence:
  match facts:
    case T.Facts{owner, database, lease, process, dirty, unpublished, runtime_input, ref, pending_attempt}: database

def lease_detail_refused(+detail: String, +root: String) -> Bool:
  Bool.and(String.starts_with(detail, "storage apply refused: cooperative root writer lease"), String.contains(detail, root))

type LeaseVerdict is Data:
  LeaseVerdict{ok: Bool, detail: String}

def verdict_ok(+verdict: LeaseVerdict) -> Bool:
  match verdict:
    case LeaseVerdict{ok, detail}: ok

def verdict_detail(+verdict: LeaseVerdict) -> String:
  match verdict:
    case LeaseVerdict{ok, detail}: detail

def lease_verdict(result: Result<&1,&1,U32 & String,List<T.Receipt>>, +root: String) -> LeaseVerdict:
  match result:
    case Fail{error}:
      (code, +detail) = error
      +ok : Bool = Bool.and(U32.is_eq(code, 3), lease_detail_refused(detail, root))
      LeaseVerdict{ok, detail}
    case Done{receipts}: LeaseVerdict{False{}, "done"}

def apply_done(result: Result<&1,&1,U32 & String,List<T.Receipt>>) -> Bool:
  match result:
    case Done{receipts}: True{}
    case Fail{error}: False{}

def check_acquired(+name: String, handle: Maybe<U32>) -> IO(Unit):
  match handle:
    case None{}: check(name, False{}, "lease unavailable")
    case Some{value}:
      do IO<Unit>:
        ok : Unit <- check(name, True{}, "lease unavailable")
        released : Unit <- L.release_lease(value)
        IO.pure(Unit, released)

def check_blocked(+name: String, handle: Maybe<U32>) -> IO(Unit):
  match handle:
    case None{}: check(name, True{}, "blocked")
    case Some{value}:
      do IO<Unit>:
        released : Unit <- L.release_lease(value)
        check(name, False{}, "cleanup lease acquired beside a writer")

def with_writer(+name: String, handle: Maybe<U32>, next: U32 -> IO(Unit)) -> IO(Unit):
  match handle:
    case None{}: check(name, False{}, "lease unavailable")
    case Some{+value}:
      do IO<Unit>:
        ok : Unit <- check(name, True{}, "lease unavailable")
        rest : Unit <- next(value)
        released : Unit <- L.release_lease(value)
        IO.pure(Unit, rest)

def lease_root_specs(+dir: String) -> List<&2,L.RootSpec>:
  Con{L.RootSpec{T.LogEvidence{}, dir, ""}, Nil{}}

def wait_ready(+path: String, remaining: Nat) -> IO(Bool):
  match remaining:
    case 0n: IO.pure(Bool, False{})
    case 1n+rest:
      do IO<Bool>:
        observed : O.Observation <- O.observe(path)
        Bool.pick(IO(Bool), O.observation_is_found(observed),
          IO.pure(Bool, True{}),
          do IO<Bool>:
            slept : Unit <- IO.sleep(20)
            ready : Bool <- wait_ready(path, rest)
            IO.pure(Bool, ready))

def writer_hold_script(+lease: String, +ready: String) -> String:
  "exec 9<>" ++ lease ++ "; /usr/bin/flock -s 9; : > " ++ ready ++ "; exec /bin/sleep 30"

def external_writer_apply(result: Result<&1,&1,U32 & String,U32>, +db: String, +dir: String, +file: String, +ready: String) -> IO(Unit):
  match result:
    case Fail{error}: IO.die(Unit, 1, "writer lease fixture spawn failed")
    case Done{+handle}:
      do IO<Unit>:
        +specs : List<&2,L.RootSpec> = lease_root_specs(dir)
        held : Bool <- wait_ready(ready, 250n)
        started : Unit <- check("writer-lease-held", held, "writer lease fixture did not acquire the lease")
        probe : Maybe<U32> <- L.acquire_cleanup_lease(dir)
        blocked : Unit <- check_blocked("writer-lease-blocks-cleanup", probe)
        refused_apply : Result<&1,&1,U32 & String,List<T.Receipt>> <- L.apply_session_roots(db, "owner", specs)
        +verdict : LeaseVerdict = lease_verdict(refused_apply, dir)
        refused : Unit <- check("writer-lease-refused", verdict_ok(verdict), verdict_detail(verdict))
        observed : O.Observation <- O.observe(file)
        kept : Unit <- check("writer-target-preserved", O.observation_is_found(observed), "writer target was removed")
        signaled : Unit <- IO.try(Unit, Proc.ProcessChild.signal(handle, 15))
        waited : String <- IO.try(String, Proc.ProcessChild.wait(handle))
        applied : Result<&1,&1,U32 & String,List<T.Receipt>> <- L.apply_session_roots(db, "owner", specs)
        succeeded : Unit <- check("writer-lease-released-apply", apply_done(applied), "apply still refused after the writer released")
        +lease_path : String = dir ++ "/.baton-writer-lease"
        lease_seen : O.Observation <- O.observe(lease_path)
        skipped : Unit <- check("writer-lease-file-kept", O.observation_is_found(lease_seen), "lease file was treated as a candidate")
        IO.pure(Unit, Unit{})

def held_writer_checks(+fd: U32, +dir: String) -> IO(Unit):
  do IO<Unit>:
    cleanup : Maybe<U32> <- L.acquire_cleanup_lease(dir)
    blocked : Unit <- check_blocked("cleanup-lease-blocked", cleanup)
    second : Maybe<U32> <- L.acquire_writer_lease(dir)
    shared : Unit <- check_acquired("writer-lease-second-shared", second)
    IO.pure(Unit, Unit{})

def in_process_lease_check(+dir: String) -> IO(Unit):
  do IO<Unit>:
    writer : Maybe<U32> <- L.acquire_writer_lease(dir)
    held : Unit <- with_writer("writer-lease-shared-acquire", writer, fd => held_writer_checks(fd, dir))
    cleanup : Maybe<U32> <- L.acquire_cleanup_lease(dir)
    acquired : Unit <- check_acquired("cleanup-lease-after-release", cleanup)
    IO.pure(Unit, Unit{})

def writer_lease_check(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    +dir : String = root ++ "/storage-lease"
    made : Unit <- IO.try(Unit, F.Files.mkdir(dir))
    +file : String = dir ++ "/writer-owned.txt"
    wrote : Unit <- write_file(file, "keep")
    registered : String <- IO.try(String, DB.Sql.query(db, "INSERT OR REPLACE INTO log_files(session,log) VALUES('owner','" ++ dir ++ "/writer.log');"))
    +lease_path : String = dir ++ "/.baton-writer-lease"
    +ready : String = dir ++ "/writer.ready"
    +script : String = writer_hold_script(lease_path, ready)
    spawned : Result<&1,&1,U32 & String,U32> <- Proc.ProcessChild.spawn(Proc.argv(["/bin/sh", "-c", script]), ".", dir ++ "/writer.stderr")
    external : Unit <- external_writer_apply(spawned, db, dir, file, ready)
    inprocess : Unit <- in_process_lease_check(dir)
    cleaned : String <- IO.try(String, DB.Sql.query(db, "DELETE FROM log_files WHERE session='owner' AND log='" ++ dir ++ "/writer.log';"))
    IO.pure(Unit, Unit{})

def database_checks(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    +dir : String = root ++ "/database-protected"
    made : Unit <- IO.try(Unit, F.Files.mkdir(dir))
    +database : String = dir ++ "/orchestra.db"
    wrote : Unit <- write_file(database, "payload")
    seeded : Unit <- db_endpoint_setup(db, root, database)
    +link : String = root ++ "/database-link"
    linked : Unit <- run_cmd(["/bin/ln", "-s", "database-protected", link])
    alias_seeded : Unit <- db_endpoint_setup(db, root, link ++ "/orchestra.db")
    alias_state : S.State <- S.load(db)
    alias_facts : T.Facts <- S.facts_for(T.Scratch{}, "", dir, alias_state)
    +alias_reason : String = decision_text(P.decide(T.Scratch{}, "owner", alias_facts))
    alias_check : Unit <- check("database-symlink-alias-preserved", String.eq(alias_reason, "database-path"), alias_reason)
    nested : Unit <- run_cmd(["/bin/mkdir", dir ++ "/nested"])
    dotted_seeded : Unit <- db_endpoint_setup(db, root, dir ++ "/nested/../orchestra.db")
    dotted_state : S.State <- S.load(db)
    dotted_facts : T.Facts <- S.facts_for(T.Scratch{}, "", dir, dotted_state)
    +dotted_reason : String = decision_text(P.decide(T.Scratch{}, "owner", dotted_facts))
    dotted_check : Unit <- check("database-dot-segment-alias-preserved", String.eq(dotted_reason, "database-path"), dotted_reason)
    unresolved_seeded : Unit <- db_endpoint_setup(db, root, root ++ "/missing-db-dir/orchestra.db")
    unresolved_state : S.State <- S.load(db)
    unresolved_facts : T.Facts <- S.facts_for(T.Scratch{}, "", dir, unresolved_state)
    +unresolved_presence : T.Presence = facts_database_or_unknown(unresolved_facts)
    unresolved_check : Unit <- check("database-unresolved-alias-unknown", presence_unknown(unresolved_presence), presence_detail(unresolved_presence))
    reset_seeded : Unit <- db_endpoint_setup(db, root, database)
    +state_dir : S.State <- S.load(db)
    +facts_dir : T.Facts <- S.facts_for(T.Scratch{}, "", dir, state_dir)
    +dir_reason : String = decision_text(P.decide(T.Scratch{}, "owner", facts_dir))
    a : Unit <- check("database-ancestor-preserved", String.eq(dir_reason, "database-path"), dir_reason)
    +dir_candidate : T.Candidate <- candidate_for(dir, T.Scratch{}, facts_dir)
    receipt : T.Receipt <- one_apply(db, root, dir_candidate)
    b : Unit <- check_receipt("database-ancestor-kept", receipt, dir, "kept")
    kept : O.Observation <- O.observe(database)
    c : Unit <- check("database-file-kept", O.observation_is_found(kept), "database file missing")
    +state_file : S.State <- S.load(db)
    facts_file : T.Facts <- S.facts_for(T.Scratch{}, "", database, state_file)
    +file_reason : String = decision_text(P.decide(T.Scratch{}, "owner", facts_file))
    d : Unit <- check("database-exact-preserved", String.eq(file_reason, "database-path"), file_reason)
    removed : Unit <- run_cmd(["/bin/rm", "-f", database])
    state2 : S.State <- S.load(db)
    facts_unlinked : T.Facts <- S.facts_for(T.Scratch{}, "", dir, state2)
    +unlinked_reason : String = decision_text(P.decide(T.Scratch{}, "owner", facts_unlinked))
    e : Unit <- check("database-unlinked-ancestor-preserved", String.eq(unlinked_reason, "database-path"), unlinked_reason)
    restored : String <- IO.try(String, DB.Sql.query(db, "DELETE FROM sessions WHERE id=char(100,98,45,111,119,110,101,114);"))
    IO.pure(Unit, Unit{})

def database_malformed_check(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    inserted : String <- IO.try(String, DB.Sql.query(db, "INSERT INTO sessions(id,parent,harness,workspace,branch,base,endpoint) VALUES('bad-endpoint',NULL,'omp','','','','{bad');"))
    +state : S.State <- S.load(db)
    a : Unit <- check("malformed-endpoint-invalid", Bool.not(S.valid_of(state)), "malformed endpoint accepted")
    facts : T.Facts <- S.facts_for(T.Scratch{}, "", root, state)
    b : Unit <- check("malformed-endpoint-unknown", presence_unknown(facts_database_or_unknown(facts)), "malformed endpoint produced known database evidence")
    IO.pure(Unit, Unit{})

def unknown_peer_script() -> String:
  "import ctypes,time; getattr(ctypes.CDLL(None),'prctl',lambda *args: 0)(4,0,0,0,0); time.sleep(30)"

def check_unknown_presence(presence: T.Presence) -> IO(Unit):
  match presence:
    case T.Unknown{}: check("unknown-without-match", True{}, "unknown")
    case other: check("unknown-without-match", False{}, presence_detail(other))

def spawned_unknown_holder(result: Result<&1,&1,U32 & String,U32>, +dir: String, +database: String) -> IO(Unit):
  match result:
    case Fail{error}: IO.die(Unit, 1, "unknown peer spawn failed")
    case Done{+handle}:
      do IO<Unit>:
        slept : Unit <- IO.sleep(100)
        absent : T.Presence <- O.runtime_presence(dir)
        unknown_ok : Unit <- check_unknown_presence(absent)
        signaled : Unit <- IO.try(Unit, Proc.ProcessChild.signal(handle, 15))
        waited : String <- IO.try(String, Proc.ProcessChild.wait(handle))
        holder : Result<&1,&1,U32 & String,U32> <- Proc.ProcessChild.spawn(Proc.argv(["/bin/sh", "-c", held_file_script(database), "sh", database]), ".", dir ++ ".holder.stderr")
        held : Unit <- spawned_holder(holder, dir)
        IO.pure(Unit, held)

def spawned_positive_holder(holder: Result<&1,&1,U32 & String,U32>, +unknown_handle: U32, +dir: String) -> IO(Unit):
  match holder:
    case Fail{error}: IO.die(Unit, 1, "positive holder spawn failed")
    case Done{+holder_handle}:
      do IO<Unit>:
        presence : T.Presence <- O.runtime_presence(dir)
        positive : Unit <- check_present_presence("positive-match-with-unknown-peer", presence)
        signaled_holder : Unit <- IO.try(Unit, Proc.ProcessChild.signal(holder_handle, 15))
        waited_holder : String <- IO.try(String, Proc.ProcessChild.wait(holder_handle))
        signaled_unknown : Unit <- IO.try(Unit, Proc.ProcessChild.signal(unknown_handle, 15))
        waited_unknown : String <- IO.try(String, Proc.ProcessChild.wait(unknown_handle))
        IO.pure(Unit, positive)

def spawned_presence_precedence(result: Result<&1,&1,U32 & String,U32>, +dir: String) -> IO(Unit):
  match result:
    case Fail{error}: IO.die(Unit, 1, "unknown peer spawn failed")
    case Done{+unknown_handle}:
      do IO<Unit>:
        slept : Unit <- IO.sleep(100)
        holder : Result<&1,&1,U32 & String,U32> <- Proc.ProcessChild.spawn(Proc.argv(["/bin/sleep", "30"]), dir, dir ++ ".cwd-holder.stderr")
        spawned_positive_holder(holder, unknown_handle, dir)

def positive_precedence_check(+root: String) -> IO(Unit):
  do IO<Unit>:
    +dir : String = root ++ "/positive-precedence"
    made : Unit <- IO.try(Unit, F.Files.mkdir(dir))
    unknown : Result<&1,&1,U32 & String,U32> <- Proc.ProcessChild.spawn(Proc.argv(["/usr/bin/env", "python3", "-c", unknown_peer_script()]), ".", dir ++ ".unknown.stderr")
    spawned_presence_precedence(unknown, dir)

def unlinked_holder_check(+root: String) -> IO(Unit):
  do IO<Unit>:
    absolute : String <- command_output(["/bin/realpath", "-m", root])
    +dir : String = absolute ++ "/unlinked-owner"
    made : Unit <- IO.try(Unit, F.Files.mkdir(dir))
    +database : String = dir ++ "/orchestra.db"
    wrote : Unit <- write_file(database, "payload")
    spawned : Result<&1,&1,U32 & String,U32> <- Proc.ProcessChild.spawn(Proc.argv(["/usr/bin/env", "python3", "-c", unknown_peer_script()]), ".", dir ++ ".unknown.stderr")
    spawned_unknown_holder(spawned, dir, database)

def exclusive_check(+db: String) -> IO(Unit):
  do IO<Unit>:
    +rows : List<&2,String> = L.parse_exclusive("# comment\nexclusive-a\n\nexclusive-b/\n")
    a : Unit <- check("exclusive-member", L.exclusive_member("exclusive-a", rows), "exclusive root missing")
    b : Unit <- check("exclusive-normalized", L.exclusive_member("exclusive-b", rows), "trailing slash not normalized")
    +specs : List<&2,L.RootSpec> = Con{L.RootSpec{T.Scratch{}, "exclusive-a", ""}, Con{L.RootSpec{T.BuildOutput{}, "exclusive-c", ""}, Nil{}}}
    +missing : String = L.unproven_roots(specs, rows, "")
    c : Unit <- check("exclusive-missing", String.eq(missing, "exclusive-c"), missing)
    +all : List<&2,String> = Con{"exclusive-a", Con{"exclusive-c", Nil{}}}
    d : Unit <- check("exclusive-all", String.is_empty(L.unproven_roots(specs, all, "")), "unproven root remained")
    +state : S.State <- S.load(db)
    +policy : String = L.policy_json(specs, rows, state)
    e : Unit <- check("policy-refused-uncovered", Bool.and(String.starts_with(policy, "{\"ageOnlyDeletion\":false,\"apply\":\"refused\""), String.contains(policy, "\"uncoveredRoot\":\"exclusive-a\"")), policy)
    +declared : String = L.policy_json(specs, all, state)
    f : Unit <- check("policy-refused-with-exclusive", String.starts_with(declared, "{\"ageOnlyDeletion\":false,\"apply\":\"refused\""), declared)
    +no_specs : List<&2,L.RootSpec> = Nil{}
    +no_exclusive : List<&2,String> = Nil{}
    registered : String <- IO.try(String, DB.Sql.query(db, "INSERT OR REPLACE INTO log_files(session,log) VALUES('owner','/covered-a/log');"))
    +covered_state : S.State <- S.load(db)
    +covered : List<&2,L.RootSpec> = Con{L.RootSpec{T.LogEvidence{}, "/covered-a", ""}, Nil{}}
    +covered_policy : String = L.policy_json(covered, no_exclusive, covered_state)
    g : Unit <- check("policy-lease-gated-covered", String.starts_with(covered_policy, "{\"ageOnlyDeletion\":false,\"apply\":\"lease-gated\""), covered_policy)
    +empty_policy : String = L.policy_json(no_specs, no_exclusive, covered_state)
    cleared : String <- IO.try(String, DB.Sql.query(db, "DELETE FROM log_files WHERE session='owner' AND log='/covered-a/log';"))
    h : Unit <- check("policy-ready-without-roots", String.starts_with(empty_policy, "{\"ageOnlyDeletion\":false,\"apply\":\"ready\""), empty_policy)
    IO.pure(Unit, Unit{})

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
    linked : Unit <- run_cmd(["/bin/ln", "-s", "victim.txt", link])
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
    case T.Facts{owner, database, lease, process, dirty, unpublished, runtime_input, ref, pending_attempt}:
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

def facts_lease(+facts: T.Facts) -> T.Presence:
  match facts:
    case T.Facts{owner, database, lease, process, dirty, unpublished, runtime_input, ref, pending_attempt}: lease

def active_retained_apply(result: Result<&1,&1,U32 & String,List<T.Receipt>>, +path: String) -> IO(Unit):
  match result:
    case Fail{error}: check("active-retained-apply", False{}, "apply refused")
    case Done{receipts}: check_first_receipt("active-retained-apply", receipts, path, "kept")

def active_retained_check(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    +dir : String = root ++ "/active-retained"
    made : Unit <- IO.try(Unit, F.Files.mkdir(dir))
    +file : String = dir ++ "/active.jsonl"
    +base_file : String = dir ++ "/base.jsonl"
    wrote : Unit <- write_file(file, "retained")
    wrote_base : Unit <- write_file(base_file, "base")
    +attempt : String = "active-attempt"
    cleared : String <- IO.try(String, DB.Sql.query(db, "DELETE FROM executions WHERE id='" ++ attempt ++ "';DELETE FROM log_generations WHERE attempt='" ++ attempt ++ "';"))
    inserted : String <- IO.try(String, DB.Sql.query(db, "INSERT INTO executions(session,id,directory,phase,status) VALUES('owner','" ++ attempt ++ "','" ++ dir ++ "/attempt','running','running');INSERT INTO log_generations(session,attempt,log,base) VALUES('owner','" ++ attempt ++ "','" ++ file ++ "','" ++ base_file ++ "');INSERT OR REPLACE INTO log_files(session,log) VALUES('owner','" ++ file ++ "');INSERT OR REPLACE INTO log_files(session,log) VALUES('owner','" ++ base_file ++ "');"))
    +state : S.State <- S.load(db)
    facts : T.Facts <- S.facts_for(T.LogEvidence{}, "", file, state)
    +lease : T.Presence = facts_lease(facts)
    a : Unit <- check("active-retained-lease", String.eq(presence_detail(lease), "retained-log"), presence_detail(lease))
    facts_base : T.Facts <- S.facts_for(T.LogEvidence{}, "", base_file, state)
    +base_lease : T.Presence = facts_lease(facts_base)
    base_check : Unit <- check("active-retained-base-lease", String.eq(presence_detail(base_lease), "retained-log"), presence_detail(base_lease))
    +specs : List<&2,L.RootSpec> = Con{L.RootSpec{T.LogEvidence{}, dir, ""}, Nil{}}
    receipt_log : Result<&1,&1,U32 & String,List<T.Receipt>> <- L.apply_session_roots(db, "owner", specs)
    b : Unit <- active_retained_apply(receipt_log, file)
    kept : O.Observation <- O.observe(file)
    c : Unit <- check("active-retained-preserved", O.observation_is_found(kept), "active retained log removed")
    receipt_base : Result<&1,&1,U32 & String,List<T.Receipt>> <- L.apply_session_roots(db, "owner", specs)
    base_applied : Unit <- active_retained_apply(receipt_base, base_file)
    kept_base : O.Observation <- O.observe(base_file)
    d : Unit <- check("active-retained-base-preserved", O.observation_is_found(kept_base), "active retained base removed")
    dropped : String <- IO.try(String, DB.Sql.query(db, "DROP TABLE log_generations;"))
    absent_state : S.State <- S.load(db)
    absent_facts : T.Facts <- S.facts_for(T.LogEvidence{}, "", file, absent_state)
    +absent_lease : T.Presence = facts_lease(absent_facts)
    e : Unit <- check("active-retained-absent-table", String.eq(presence_detail(absent_lease), "retained-log"), presence_detail(absent_lease))
    receipt_files : Result<&1,&1,U32 & String,List<T.Receipt>> <- L.apply_session_roots(db, "owner", specs)
    files_applied : Unit <- active_retained_apply(receipt_files, file)
    kept_files : O.Observation <- O.observe(file)
    f : Unit <- check("active-retained-log-files", O.observation_is_found(kept_files), "log_files-only retained log removed")
    recreated : String <- IO.try(String, DB.Sql.query(db, "CREATE TABLE IF NOT EXISTS log_generations(session TEXT NOT NULL,attempt TEXT NOT NULL,log TEXT NOT NULL,base TEXT NOT NULL,PRIMARY KEY(session,attempt));"))
    cleaned : String <- IO.try(String, DB.Sql.query(db, "DELETE FROM executions WHERE id='" ++ attempt ++ "';DELETE FROM log_generations WHERE attempt='" ++ attempt ++ "';DELETE FROM log_files WHERE session='owner' AND log IN ('" ++ file ++ "','" ++ base_file ++ "');"))
    IO.pure(Unit, Unit{})

def malformed_db_check(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    bad : String <- IO.try(String, DB.Sql.query(db, "INSERT INTO messages(id,sender,recipient,kind,body) VALUES('bad','owner','','task','x');"))
    +state : S.State <- S.load(db)
    a : Unit <- check("malformed-db-invalid", Bool.not(S.valid_of(state)), "malformed DB accepted")
    facts : T.Facts <- S.facts_for(T.Scratch{}, "", root ++ "/unknown", state)
    b : Unit <- check("malformed-db-preserves", facts_owner_unknown(facts), "malformed DB produced a known owner")
    IO.pure(Unit, Unit{})

def overlap_refused(result: Result<&1,&1,U32 & String,List<T.Receipt>>) -> Bool:
  match result:
    case Fail{error}:
      (code, detail) = error
      Bool.and(U32.is_eq(code, 3), String.starts_with(detail, "storage apply refused: configured storage roots overlap"))
    case Done{receipts}: False{}

def overlap_check(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    +nested : String = root ++ "/nested"
    made : Unit <- IO.try(Unit, F.Files.mkdir(nested))
    +specs : List<&2,L.RootSpec> <- IO.pure(List<&2,L.RootSpec>, Con{L.RootSpec{T.Scratch{}, root, ""}, Con{L.RootSpec{T.BuildOutput{}, nested, ""}, Nil{}}})
    a : Unit <- check("overlapping-roots", L.roots_overlap(specs), "overlap accepted")
    applied : Result<&1,&1,U32 & String,List<T.Receipt>> <- L.apply_session_roots(db, "owner", specs)
    b : Unit <- check("overlap-refused-before-lease", overlap_refused(applied), "overlap not refused")
    +lease_path : String = nested ++ "/.baton-writer-lease"
    observed : O.Observation <- O.observe(lease_path)
    c : Unit <- check("overlap-no-lease-acquired", Bool.not(O.observation_is_found(observed)), "lease acquired before overlap refusal")
    IO.pure(Unit, Unit{})

def busy_check(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    specs : List<&2,L.RootSpec> <- IO.pure(List<&2,L.RootSpec>, Con{L.RootSpec{T.Scratch{}, root, ""}, Nil{}})
    result : Result<&1,&1,U32 & String,List<T.Receipt>> <- L.apply_locked("", db, specs, None{})
    a : Unit <- check("lock-busy-refused", Result.is_fail(&1,&1,U32 & String,List<T.Receipt>,result), "busy returned success")
    IO.pure(Unit, Unit{})

def main() -> IO(Unit):
  do IO<Unit>:
    +root : String <- command_output(["/usr/bin/realpath", "-m", ".scratch/bend2-storage-test"])
    +db : String <- command_output(["/usr/bin/realpath", "-m", ".scratch/bend2-storage-test.db"])
    setup : Unit <- setup_root(root)
    database : Unit <- db_setup(db, root)
    writer_lease : Unit <- writer_lease_check(db, root)
    pure : Unit <- pure_identity_checks()
    process : Unit <- process_checks(root)
    dbpaths : Unit <- database_checks(db, root)
    unlinked : Unit <- unlinked_holder_check(root)
    precedence : Unit <- positive_precedence_check(root)
    exclusive : Unit <- exclusive_check(db)
    applied : Unit <- apply_checks(db, root)
    active_retained : Unit <- active_retained_check(db, root)
    rootrace_dir : Unit <- IO.try(Unit, F.Files.mkdir(root ++ "/rootrace"))
    rootrace : Unit <- root_replacement_check(db, root ++ "/rootrace")
    unreadable : Unit <- unreadable_check(db, root)
    malformed : Unit <- malformed_entries_check(root)
    overlap : Unit <- overlap_check(db, root)
    busy : Unit <- busy_check(db, root)
    interrupted : Unit <- interrupted_check(db, root)
    parent_rename : Unit <- parent_rename_check(db, root)
    malformed_db : Unit <- malformed_db_check(db, root)
    malformed_endpoint : Unit <- database_malformed_check(db, root)
    IO.print("storage checks: all green")
