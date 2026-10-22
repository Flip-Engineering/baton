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

def u32_of(value: Maybe<&2,U32>) -> U32:
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

def check_decision(+name: String, candidate: T.Candidate, +expected: String) -> IO(Unit):
  +reason : String = decision_reason_of(candidate)
  check(name, String.eq(reason, expected), reason)

def presence_unknown(presence: T.Presence) -> Bool:
  match presence:
    case T.Unknown{}: True{}
    case other: False{}

def pure_checks() -> IO(Unit):
  do IO<Unit>:
    base : T.Candidate <- IO.pure(T.Candidate, T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", clear_facts()})
    owner_bad : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerDiffers{"other"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    database_live : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Present{"database-path"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    database_unknown : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Unknown{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    lease_live : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Present{"lease"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    process_live : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Present{"pid"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    runtime_live : T.Candidate = T.Candidate{"/x", T.BuildOutput{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Present{"pid"}, T.Absent{}, T.Absent{}}}
    dirty : T.Candidate = T.Candidate{"/x", T.Checkout{}, "owner", "proof", 1n, "dir:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Present{"worktree"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    unpublished : T.Candidate = T.Candidate{"/x", T.Checkout{}, "owner", "proof", 1n, "dir:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Present{"1"}, T.Absent{}, T.Absent{}, T.Absent{}}}
    ref_live : T.Candidate = T.Candidate{"/x", T.GitObject{}, "owner", "proof", 1n, "dir:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Present{"aa"}, T.Absent{}}}
    pending : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Present{"1"}}}
    git_clear : T.Candidate = T.Candidate{"/x", T.GitObject{}, "owner", "proof", 1n, "dir:1:1", clear_facts()}
    a : Unit <- check_decision("owner-mismatch", owner_bad, "owner-mismatch")
    b : Unit <- check_decision("database-path", database_live, "database-path")
    c : Unit <- check_decision("database-path-unknown", database_unknown, "database-path-unknown")
    d : Unit <- check_decision("lease-live", lease_live, "lease-live")
    e : Unit <- check_decision("process-live", process_live, "process-live")
    f : Unit <- check_decision("runtime-input-live", runtime_live, "runtime-input-live")
    g : Unit <- check_decision("worktree-dirty", dirty, "worktree-dirty")
    h : Unit <- check_decision("unpublished-commits", unpublished, "unpublished-commits")
    i : Unit <- check_decision("ref-live", ref_live, "ref-live")
    j : Unit <- check_decision("pending-attempt", pending, "pending-attempt")
    k : Unit <- check_decision("git-object-report-only", git_clear, "git-object-report-only")
    l : Unit <- check_decision("scratch-clear", base, "remove:scratch-settled")
    malformed : T.Presence = O.presence_result(Done{"garbage"})
    m : Unit <- check("malformed-presence", presence_unknown(malformed), "malformed host result accepted")
    non_linux : T.Presence = O.presence_result(Done{"unknown:non-linux"})
    n : Unit <- check("non-linux-presence", presence_unknown(non_linux), "non-Linux scan accepted")
    IO.pure(Unit, Unit{})

def facts_database_or_unknown(+facts: T.Facts) -> T.Presence:
  match facts:
    case T.Facts{owner, database, lease, process, dirty, unpublished, runtime_input, ref, pending_attempt}: database

def database_checks(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    +dir : String <- IO.pure(String, root ++ "/database-protected")
    made : Unit <- IO.try(Unit, F.Files.mkdir(dir))
    +database : String = dir ++ "/orchestra.db"
    wrote : Unit <- write_file(database, "payload")
    seeded : Unit <- db_endpoint_setup(db, root, database)
    +state : S.State <- S.load(db)
    +facts_dir : T.Facts <- S.facts_for(T.Scratch{}, "", dir, state)
    +dir_reason : String = decision_text(P.decide(T.Scratch{}, "owner", facts_dir))
    a : Unit <- check("database-ancestor-preserved", String.eq(dir_reason, "database-path"), dir_reason)
    +dir_candidate : T.Candidate <- candidate_for(dir, T.Scratch{}, facts_dir)
    receipt : T.Receipt <- one_apply(db, root, dir_candidate)
    b : Unit <- check_receipt("database-ancestor-kept", receipt, dir, "kept")
    kept : O.Observation <- O.observe(database)
    c : Unit <- check("database-file-kept", O.observation_is_found(kept), "database file missing")
    facts_file : T.Facts <- S.facts_for(T.Scratch{}, "", database, state)
    +file_reason : String = decision_text(P.decide(T.Scratch{}, "owner", facts_file))
    d : Unit <- check("database-exact-preserved", String.eq(file_reason, "database-path"), file_reason)
    removed : Unit <- run_cmd(["/bin/rm", "-f", database])
    state2 : S.State <- S.load(db)
    facts_unlinked : T.Facts <- S.facts_for(T.Scratch{}, "", dir, state2)
    +unlinked_reason : String = decision_text(P.decide(T.Scratch{}, "owner", facts_unlinked))
    e : Unit <- check("database-unlinked-ancestor-preserved", String.eq(unlinked_reason, "database-path"), unlinked_reason)
    IO.pure(Unit, Unit{})

def exclusive_check() -> IO(Unit):
  do IO<Unit>:
    +rows : List<&2,String> <- IO.pure(List<&2,String>, L.parse_exclusive("# comment\nexclusive-a\n\nexclusive-b/\n"))
    a : Unit <- check("exclusive-member", L.exclusive_member("exclusive-a", rows), "exclusive root missing")
    b : Unit <- check("exclusive-normalized", L.exclusive_member("exclusive-b", rows), "trailing slash not normalized")
    +specs : List<&2,L.RootSpec> = Con{L.RootSpec{T.Scratch{}, "exclusive-a", ""}, Con{L.RootSpec{T.BuildOutput{}, "exclusive-c", ""}, Nil{}}}
    +missing : String = L.unproven_roots(specs, rows, "")
    c : Unit <- check("exclusive-missing", String.eq(missing, "exclusive-c"), missing)
    +all : List<&2,String> = Con{"exclusive-a", Con{"exclusive-c", Nil{}}}
    d : Unit <- check("exclusive-all", String.is_empty(L.unproven_roots(specs, all, "")), "unproven root remained")
    +policy : String = L.policy_json(specs, rows)
    e : Unit <- check("policy-refused", String.starts_with(policy, "{\"ageOnlyDeletion\":false,\"apply\":\"refused\""), policy)
    +ready : String = L.policy_json(specs, all)
    f : Unit <- check("policy-ready", String.starts_with(ready, "{\"ageOnlyDeletion\":false,\"apply\":\"ready\""), ready)
    IO.pure(Unit, Unit{})

def main() -> IO(Unit):
  do IO<Unit>:
    +root : String <- IO.pure(String, ".scratch/bend2-storage-test")
    +db : String <- IO.pure(String, ".scratch/bend2-storage-test.db")
    setup : Unit <- setup_root(root)
    database : Unit <- db_setup(db, root)
    pure : Unit <- pure_checks()
    dbpaths : Unit <- database_checks(db, root)
    exclusive : Unit <- exclusive_check()
    IO.print("storage trimmed checks: all green")
