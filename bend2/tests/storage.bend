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
import ../src/host/storage.bend as Host
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
  "CREATE TABLE sessions(id TEXT PRIMARY KEY,parent TEXT,harness TEXT,model TEXT DEFAULT '',effort TEXT DEFAULT '',native TEXT DEFAULT '',observed_harness TEXT DEFAULT '',observed_model TEXT DEFAULT '',observed_effort TEXT DEFAULT '',endpoint TEXT DEFAULT '',workspace TEXT DEFAULT '',branch TEXT DEFAULT '',base TEXT DEFAULT '');CREATE TABLE executions(session TEXT,id TEXT,directory TEXT,phase TEXT,status TEXT);CREATE TABLE messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,sender TEXT,recipient TEXT,kind TEXT,body TEXT,receipt TEXT);CREATE TABLE message_reads(message TEXT,recipient TEXT,PRIMARY KEY(message,recipient));CREATE TABLE log_files(session TEXT,log TEXT,PRIMARY KEY(session,log));CREATE TABLE log_generations(session TEXT NOT NULL,attempt TEXT NOT NULL,log TEXT NOT NULL,base TEXT NOT NULL,PRIMARY KEY(session,attempt));"

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
  T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}

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
# Apply refreshes host facts before unlinking. A same-uid process that the
# fail-closed scan cannot inspect yields an unknown fact and preserves the
# candidate. Host process churn can move that answer between two adjacent
# scans, so the removal fixtures retry exactly that documented answer. Any
# other result fails on the first attempt.
def transient_scan_unknown(+report: String) -> Bool:
  Bool.or(
    String.eq(report, "changed|fresh evidence preserves: process-unknown"),
    String.eq(report, "changed|fresh evidence preserves: runtime-input-unknown"))

def remove_until_settled(+db: String, +root: String, +candidate: T.Candidate, +path: String, +attempts: Nat) -> IO(String):
  match attempts:
    case 0n:
      do IO<String>:
        receipt : T.Receipt <- one_apply(db, root, candidate)
        IO.pure(String, receipt_outcome(receipt, path))
    case 1n+rest:
      do IO<String>:
        receipt : T.Receipt <- one_apply(db, root, candidate)
        +report : String = receipt_outcome(receipt, path)
        Bool.pick(IO(String), transient_scan_unknown(report),
          remove_until_settled(db, root, candidate, path, rest),
          IO.pure(String, report))


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
    owner_bad : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerDiffers{"other"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    database_live : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Present{"database-path"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    database_unknown : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Unknown{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    a : Unit <- check_decision("owner-mismatch", owner_bad, "owner-mismatch")
    b : Unit <- check_decision("database-path", database_live, "database-path")
    c : Unit <- check_decision("database-path-unknown", database_unknown, "database-path-unknown")
    IO.pure(Unit, Unit{})

def pure_runtime_checks() -> IO(Unit):
  do IO<Unit>:
    lease_live : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Present{"lease"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    process_live : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Present{"pid"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    runtime_live : T.Candidate = T.Candidate{"/x", T.BuildOutput{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Present{"pid"}, T.Absent{}, T.Absent{}}}
    a : Unit <- check_decision("lease-live", lease_live, "lease-live")
    b : Unit <- check_decision("process-live", process_live, "process-live")
    c : Unit <- check_decision("runtime-input-live", runtime_live, "runtime-input-live")
    IO.pure(Unit, Unit{})

def pure_checkout_checks() -> IO(Unit):
  do IO<Unit>:
    dirty : T.Candidate = T.Candidate{"/x", T.Checkout{}, "owner", "proof", 1n, "dir:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Present{"worktree"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    unpublished : T.Candidate = T.Candidate{"/x", T.Checkout{}, "owner", "proof", 1n, "dir:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Present{"1"}, T.Absent{}, T.Absent{}, T.Absent{}}}
    ref_live : T.Candidate = T.Candidate{"/x", T.GitObject{}, "owner", "proof", 1n, "dir:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Present{"aa"}, T.Absent{}}}
    a : Unit <- check_decision("worktree-dirty", dirty, "worktree-dirty")
    b : Unit <- check_decision("unpublished-commits", unpublished, "unpublished-commits")
    c : Unit <- check_decision("ref-live", ref_live, "ref-live")
    IO.pure(Unit, Unit{})

def pure_pending_checks() -> IO(Unit):
  do IO<Unit>:
    pending : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Present{"1"}}}
    git_clear : T.Candidate = T.Candidate{"/x", T.GitObject{}, "owner", "proof", 1n, "dir:1:1", clear_facts()}
    base : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "file:1:1", clear_facts()}
    a : Unit <- check_decision("pending-attempt", pending, "pending-attempt")
    b : Unit <- check_decision("git-object-report-only", git_clear, "git-object-report-only")
    c : Unit <- check_decision("scratch-clear", base, "remove:scratch-settled")
    IO.pure(Unit, Unit{})

def pure_transient_checks() -> IO(Unit):
  do IO<Unit>:
    export_clear : T.Candidate = T.Candidate{"/x", T.Export{}, "owner", "proof", 1n, "dir:1:1", clear_facts()}
    checkout_clear : T.Candidate = T.Candidate{"/x", T.Checkout{}, "owner", "proof", 1n, "dir:1:1", clear_facts()}
    execution_live : T.Candidate = T.Candidate{"/x", T.Scratch{}, "owner", "proof", 1n, "dir:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Present{"execution:1"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    execution_unknown : T.Candidate = T.Candidate{"/x", T.BuildOutput{}, "owner", "proof", 1n, "dir:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Unknown{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    evidence_clear : T.Candidate = T.Candidate{"/x", T.LogEvidence{}, "owner", "proof", 1n, "file:1:1", T.Facts{T.OwnerMatches{"owner"}, T.Present{"execution:1"}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}, T.Absent{}}}
    a : Unit <- check_decision("export-clear", export_clear, "remove:export-settled")
    b : Unit <- check_decision("checkout-clear", checkout_clear, "remove:checkout-clean-published")
    c : Unit <- check_decision("execution-live", execution_live, "execution-live")
    d : Unit <- check_decision("execution-unknown", execution_unknown, "execution-unknown")
    e : Unit <- check_decision("log-evidence-ignores-execution", evidence_clear, "remove:evidence-settled")
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
    transient : Unit <- pure_transient_checks()
    presence : Unit <- pure_presence_checks()
    IO.pure(Unit, Unit{})

def presence_detail(presence: T.Presence) -> String:
  match presence:
    case T.Present{detail}: detail
    case T.Absent{}: ""
    case T.Unknown{}: "unknown"

# Peers register in the test proc view and report readiness after setup.
def peer_line(value: Maybe<String>) -> String:
  match value:
    case Some{line}: Tx.trim_nl(line)
    case None{}: ""

def peer_ready(result: Result<&1,&1,U32 & String,U32>) -> IO(Result<&1,&1,U32 & String,U32>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,U32>, Fail{error})
    case Done{+handle}: do IO<Result<&1,&1,U32 & String,U32>>:
      ready : Maybe<String> <- IO.try(Maybe<String>, Proc.ProcessChild.read_line(handle))
      checked : Unit <- check("peer-ready", String.eq(peer_line(ready), "ready"), "peer did not initialize")
      IO.pure(Result<&1,&1,U32 & String,U32>, Done{handle})

def fixture_peer(+dir: String, +stderr: String, +file: String, +unreadable: String) -> IO(Result<&1,&1,U32 & String,U32>):
  do IO<Result<&1,&1,U32 & String,U32>>:
    script : String <- command_output(["/bin/realpath", "bend2/test/storage-peer.py"])
    child : Result<&1,&1,U32 & String,U32> <- Proc.ProcessChild.spawn(Proc.argv(["/usr/bin/env", "python3", script, file, unreadable]), dir, stderr)
    peer_ready(child)

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
    spawned : Result<&1,&1,U32 & String,U32> <- fixture_peer(dir, dir ++ "/stderr", "", "0")
    unit : Unit <- spawned_process(spawned, dir)
    +held : String = dir ++ "/held"
    wrote : Unit <- write_file(held, "x")
    +held_path : String <- command_output(["/bin/realpath", "-m", held])
    holder : Result<&1,&1,U32 & String,U32> <- fixture_peer(dir, dir ++ "/holder.stderr", held_path, "0")
    unit2 : Unit <- spawned_holder(holder, dir)
    IO.pure(Unit, unit2)

def facts_database_or_unknown(+facts: T.Facts) -> T.Presence:
  match facts:
    case T.Facts{owner, execution, database, lease, process, dirty, unpublished, runtime_input, ref, pending_attempt}: database

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


# Unknown runtime evidence preserves the candidate before removal is attempted.
# The removal check uses a readable 130-deep chain through the full apply and
# receipt path so the depth refusal is UID-independent and preservation stays
# separate from unknown-fact preservation.
# After the refusal the deep leaf and marker move to a shallow repaired path;
# a fresh preview and apply then remove the repaired candidate.
def deep_leaf_path(remaining: Nat, +prefix: String) -> String:
  match remaining:
    case 0n: prefix ++ "/leaf.txt"
    case 1n+rest: deep_leaf_path(rest, prefix ++ "/n")

def deep_marker_path(remaining: Nat, +prefix: String) -> String:
  match remaining:
    case 0n: prefix ++ "/marker.txt"
    case 1n+rest: deep_marker_path(rest, prefix ++ "/n")

def removal_repair_check(+db: String, +root: String, +dir: String, +deep: String, +leaf: String, +marker: String) -> IO(Unit):
  do IO<Unit>:
    +repair : String = "r=\"$1/repaired\"; mkdir -p \"$r\" || exit 1; mv \"$2\" \"$r/leaf.txt\" || exit 1; mv \"$3\" \"$r/marker.txt\" || exit 1; rm -rf \"$4\""
    repaired : Unit <- run_cmd(["/bin/sh", "-c", repair, "sh", dir, leaf, marker, deep])
    +repaired_leaf : String = dir ++ "/repaired/leaf.txt"
    +repaired_marker : String = dir ++ "/repaired/marker.txt"
    repaired_leaf_seen : O.Observation <- O.observe(repaired_leaf)
    e : Unit <- check("interrupted-repaired-leaf-preserved", O.observation_is_found(repaired_leaf_seen), "repaired leaf missing")
    repaired_marker_seen : O.Observation <- O.observe(repaired_marker)
    f : Unit <- check("interrupted-repaired-marker-preserved", O.observation_is_found(repaired_marker_seen), "repaired marker missing")
    +replayed_candidate : T.Candidate <- candidate_for(dir, T.Scratch{}, clear_facts())
    +replayed_report : String <- remove_until_settled(db, root, replayed_candidate, dir, 64n)
    g : Unit <- check("interrupted-replay", String.starts_with(replayed_report, "removed"), replayed_report)
    removed_leaf : O.Observation <- O.observe(repaired_leaf)
    h : Unit <- check("interrupted-replay-leaf-removed", Bool.not(O.observation_is_found(removed_leaf)), "repaired leaf remains")
    removed_marker : O.Observation <- O.observe(repaired_marker)
    i : Unit <- check("interrupted-replay-marker-removed", Bool.not(O.observation_is_found(removed_marker)), "repaired marker remains")
    IO.pure(Unit, Unit{})

def removal_refused_check(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    +dir : String = root ++ "/interrupted"
    made : Unit <- IO.try(Unit, F.Files.mkdir(dir))
    +deep : String = dir ++ "/deep"
    +script : String = "d=\"$1\"; mkdir -p \"$d\" || exit 1; cd \"$d\" || exit 1; i=0; while [ $i -lt 130 ]; do mkdir n || exit 1; cd n || exit 1; i=$((i+1)); done; printf leaf > leaf.txt; printf marker > marker.txt"
    built : Unit <- run_cmd(["/bin/sh", "-c", script, "sh", deep])
    +leaf : String = deep_leaf_path(130n, deep)
    +marker : String = deep_marker_path(130n, deep)
    +candidate : T.Candidate <- candidate_for(dir, T.Scratch{}, clear_facts())
    +report : String <- remove_until_settled(db, root, candidate, dir, 64n)
    a : Unit <- check("interrupted-refused", String.starts_with(report, "refused"), report)
    b : Unit <- check("interrupted-refused-detail", Bool.and(String.contains(report, "partial"), String.contains(report, "error=")), report)
    kept : O.Observation <- O.observe(leaf)
    c : Unit <- check("interrupted-leaf-preserved", O.observation_is_found(kept), "deep leaf removed")
    kept_marker : O.Observation <- O.observe(marker)
    d : Unit <- check("interrupted-marker-preserved", O.observation_is_found(kept_marker), "deep marker removed")
    replay : Unit <- removal_repair_check(db, root, dir, deep, leaf, marker)
    cleaned : Unit <- run_cmd(["/bin/rm", "-rf", dir])
    IO.pure(Unit, Unit{})

def unknown_runtime_spawned(result: Result<&1,&1,U32 & String,U32>, +db: String, +root: String, +file: String) -> IO(Unit):
  match result:
    case Fail{error}: IO.die(Unit, 1, "unknown runtime peer spawn failed")
    case Done{+handle}:
      do IO<Unit>:
        +candidate : T.Candidate <- candidate_for(file, T.Scratch{}, clear_facts())
        preview : T.Preview <- one_preview(root, candidate)
        receipt : T.Receipt <- apply_preview(db, preview)
        # The peer denies cwd, exe, descriptors and maps, so the fixed
        # preservation order reports the process fact unknown first.
        a : Unit <- check_receipt("unknown-runtime-preserved", receipt, file, "changed|fresh evidence preserves: process-unknown")
        observed : O.Observation <- O.observe(file)
        b : Unit <- check("unknown-runtime-kept", O.observation_is_found(observed), "unknown runtime candidate removed")
        signaled : Unit <- IO.try(Unit, Proc.ProcessChild.signal(handle, 15))
        waited : String <- IO.try(String, Proc.ProcessChild.wait(handle))
        IO.pure(Unit, Unit{})


def check_unknown_presence(presence: T.Presence) -> IO(Unit):
  match presence:
    case T.Unknown{}: check("unknown-without-match", True{}, "unknown")
    case other: check("unknown-without-match", False{}, presence_detail(other))

def spawned_unknown_holder(result: Result<&1,&1,U32 & String,U32>, +dir: String, +database: String) -> IO(Unit):
  match result:
    case Fail{error}: IO.die(Unit, 1, "unknown peer spawn failed")
    case Done{+handle}:
      do IO<Unit>:
        absent : T.Presence <- O.runtime_presence(dir)
        unknown_ok : Unit <- check_unknown_presence(absent)
        signaled : Unit <- IO.try(Unit, Proc.ProcessChild.signal(handle, 15))
        waited : String <- IO.try(String, Proc.ProcessChild.wait(handle))
        holder : Result<&1,&1,U32 & String,U32> <- fixture_peer(".", dir ++ ".holder.stderr", database, "0")
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
        holder : Result<&1,&1,U32 & String,U32> <- fixture_peer(dir, dir ++ ".cwd-holder.stderr", "", "0")
        spawned_positive_holder(holder, unknown_handle, dir)

def unknown_runtime_check(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    +dir : String = root ++ "/unknown-runtime"
    made : Unit <- IO.try(Unit, F.Files.mkdir(dir))
    +file : String = dir ++ "/candidate.txt"
    wrote : Unit <- write_file(file, "payload")
    spawned : Result<&1,&1,U32 & String,U32> <- fixture_peer(".", dir ++ ".unknown.stderr", "", "1")
    unit : Unit <- unknown_runtime_spawned(spawned, db, root, file)
    IO.pure(Unit, unit)

def positive_precedence_check(+root: String) -> IO(Unit):
  do IO<Unit>:
    +dir : String = root ++ "/positive-precedence"
    made : Unit <- IO.try(Unit, F.Files.mkdir(dir))
    unknown : Result<&1,&1,U32 & String,U32> <- fixture_peer(".", dir ++ ".unknown.stderr", "", "1")
    spawned_presence_precedence(unknown, dir)

def unlinked_holder_check(+root: String) -> IO(Unit):
  do IO<Unit>:
    absolute : String <- command_output(["/bin/realpath", "-m", root])
    +dir : String = absolute ++ "/unlinked-owner"
    made : Unit <- IO.try(Unit, F.Files.mkdir(dir))
    +database : String = dir ++ "/orchestra.db"
    wrote : Unit <- write_file(database, "payload")
    spawned : Result<&1,&1,U32 & String,U32> <- fixture_peer(".", dir ++ ".unknown.stderr", "", "1")
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
    +removed_report : String <- remove_until_settled(db, root, candidate, file, 64n)
    a : Unit <- check("apply-removed", String.starts_with(removed_report, "removed"), removed_report)
    receipt2 : T.Receipt <- one_apply(db, root, candidate)
    b : Unit <- check_receipt("apply-idempotent", receipt2, file, "already-absent")
    +victim : String = root ++ "/victim.txt"
    wrote_victim : Unit <- write_file(victim, "keep")
    +link : String = root ++ "/link"
    linked : Unit <- run_cmd(["/bin/ln", "-s", "victim.txt", link])
    +link_candidate : T.Candidate <- candidate_for(link, T.Scratch{}, clear_facts())
    +link_report : String <- remove_until_settled(db, root, link_candidate, link, 64n)
    c : Unit <- check("symlink-removed", String.starts_with(link_report, "removed"), link_report)
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
    case T.Facts{owner, execution, database, lease, process, dirty, unpublished, runtime_input, ref, pending_attempt}:
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

def facts_lease(+facts: T.Facts) -> T.Presence:
  match facts:
    case T.Facts{owner, execution, database, lease, process, dirty, unpublished, runtime_input, ref, pending_attempt}: lease

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

def sql_run(+db: String, +statement: String) -> IO(Unit):
  do IO<Unit>:
    _answer : String <- IO.try(String, DB.Sql.query(db, statement))
    IO.pure(Unit, Unit{})

def receipts_none(items: List<T.Receipt>) -> Bool:
  match items:
    case Nil{}: True{}
    case other: False{}

def collect_until_absent(+db: String, +session: String, +specs: List<&2,L.RootSpec>, +path: String, attempts: Nat) -> IO(Bool):
  match attempts:
    case 0n:
      do IO<Bool>:
        observed : O.Observation <- O.observe(path)
        IO.pure(Bool, Bool.not(O.observation_is_found(observed)))
    case 1n+rest:
      do IO<Bool>:
        _receipts : List<T.Receipt> <- L.collect_settled_roots(db, session, specs)
        observed : O.Observation <- O.observe(path)
        Bool.pick(IO(Bool), Bool.not(O.observation_is_found(observed)),
          IO.pure(Bool, True{}),
          collect_until_absent(db, session, specs, path, rest))

# The triggered collector runs only for a settled session. A live execution or
# pending input skips it, and an unknown session collects nothing.
def collect_check(+db: String, +root: String) -> IO(Unit):
  do IO<Unit>:
    +collect_root : String = root ++ "-collect"
    +work : String = collect_root ++ "/work"
    cleared_root : Unit <- run_cmd(["/bin/rm", "-rf", collect_root])
    made_root : Unit <- IO.try(Unit, F.Files.mkdir(collect_root))
    made_work : Unit <- IO.try(Unit, F.Files.mkdir(work))
    written : Unit <- write_file(work ++ "/artifact.bin", "collected")
    cleared : Unit <- sql_run(db, "DELETE FROM sessions WHERE id='collect-owner' OR id='bad-endpoint';DELETE FROM executions WHERE session='collect-owner';DELETE FROM messages WHERE recipient='collect-owner' OR recipient='';")
    inserted : Unit <- sql_run(db, "INSERT INTO sessions(id,parent,harness,workspace,branch,base) VALUES('collect-owner',NULL,'omp','" ++ work ++ "','','');")
    +specs : List<&2,L.RootSpec> = Con{L.RootSpec{T.Scratch{}, collect_root, ""}, Nil{}}
    settled : Bool <- collect_until_absent(db, "collect-owner", specs, work, 4n)
    a : Unit <- check("collect-settled-scratch-removed", settled, "candidate retained")
    made_work2 : Unit <- IO.try(Unit, F.Files.mkdir(work))
    written2 : Unit <- write_file(work ++ "/artifact.bin", "active")
    active_row : Unit <- sql_run(db, "INSERT INTO executions(session,id,directory,phase,status) VALUES('collect-owner','exec-collect','" ++ work ++ "','running','running');")
    active_receipts : List<T.Receipt> <- L.collect_settled_roots(db, "collect-owner", specs)
    b : Unit <- check("collect-active-execution-skips", receipts_none(active_receipts), "collected during execution")
    observed_active : O.Observation <- O.observe(work)
    c : Unit <- check("collect-active-execution-preserves", O.observation_is_found(observed_active), "active workspace removed")
    dropped_exec : Unit <- sql_run(db, "DELETE FROM executions WHERE session='collect-owner';")
    pending_row : Unit <- sql_run(db, "INSERT INTO messages(id,sender,recipient,kind,body) VALUES('collect-msg','operator','collect-owner','task','pending');")
    pending_receipts : List<T.Receipt> <- L.collect_settled_roots(db, "collect-owner", specs)
    d : Unit <- check("collect-pending-input-skips", receipts_none(pending_receipts), "collected with pending input")
    observed_pending : O.Observation <- O.observe(work)
    e : Unit <- check("collect-pending-input-preserves", O.observation_is_found(observed_pending), "pending workspace removed")
    dropped_msg : Unit <- sql_run(db, "DELETE FROM messages WHERE recipient='collect-owner';")
    unknown_receipts : List<T.Receipt> <- L.collect_settled_roots(db, "unknown-collect", specs)
    f : Unit <- check("collect-unknown-session-skips", receipts_none(unknown_receipts), "unknown session collected")
    observed_unknown : O.Observation <- O.observe(work)
    g : Unit <- check("collect-unknown-session-preserves", O.observation_is_found(observed_unknown), "unknown session workspace removed")
    +checkout_root : String = root ++ "-checkout"
    +checkout_work : String = checkout_root ++ "/work"
    cleared_checkout : Unit <- run_cmd(["/bin/rm", "-rf", checkout_root])
    made_checkout : Unit <- IO.try(Unit, F.Files.mkdir(checkout_root))
    made_checkout_work : Unit <- IO.try(Unit, F.Files.mkdir(checkout_work))
    checkout_file : Unit <- write_file(checkout_work ++ "/published.txt", "keep")
    moved_workspace : Unit <- sql_run(db, "UPDATE sessions SET workspace='" ++ checkout_work ++ "' WHERE id='collect-owner';")
    +checkout_specs : List<&2,L.RootSpec> = Con{L.RootSpec{T.Checkout{}, checkout_root, ""}, Nil{}}
    checkout_receipts : List<T.Receipt> <- L.collect_settled_roots(db, "collect-owner", checkout_specs)
    h : Unit <- check("collect-checkout-root-excluded", receipts_none(checkout_receipts), "checkout root collected")
    observed_checkout : O.Observation <- O.observe(checkout_work)
    i : Unit <- check("collect-checkout-workspace-preserved", O.observation_is_found(observed_checkout), "checkout workspace removed")
    unfiltered : Result<&1,&1,U32 & String,List<T.Receipt>> <- L.apply_session_roots(db, "collect-owner", checkout_specs)
    l : Unit <- apply_outcome_check("collect-checkout-unfiltered-sees", unfiltered, checkout_work, "kept")
    git_excluded : Bool = Bool.not(L.collectable_root(L.RootSpec{T.GitObject{}, "/objects", ""}))
    m : Unit <- check("collect-git-object-root-excluded", git_excluded, "git-object admitted")
    shared_excluded : Bool = Bool.not(L.collectable_root(L.RootSpec{T.SharedImmutable{}, "/assets", ""}))
    n : Unit <- check("collect-shared-immutable-root-excluded", shared_excluded, "shared-immutable admitted")
    unclassified_excluded : Bool = Bool.not(L.collectable_root(L.RootSpec{T.Unclassified{}, "/unknown", ""}))
    o : Unit <- check("collect-unclassified-root-excluded", unclassified_excluded, "unclassified admitted")
    scratch_admitted : Bool = L.collectable_root(L.RootSpec{T.Scratch{}, "/scratch", ""})
    p : Unit <- check("collect-scratch-root-admitted", scratch_admitted, "scratch excluded")
    +skipped_text : String = L.collect_skipped_json("collect-owner","pending-input:1")
    j : Unit <- check("collect-skipped-json", String.eq(skipped_text,"{\"session\":\"collect-owner\",\"skipped\":\"pending-input:1\",\"receipts\":[]}"), skipped_text)
    +refused_text : String = L.collect_refused_json("collect-owner",3,"storage cleanup busy")
    k : Unit <- check("collect-refused-json", String.eq(refused_text,"{\"session\":\"collect-owner\",\"refused\":\"3: storage cleanup busy\",\"receipts\":[]}"), refused_text)
    IO.pure(Unit, Unit{})

def storage_checks() -> IO(Unit):
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
    removal_refused : Unit <- removal_refused_check(db, root)
    unknown_runtime : Unit <- unknown_runtime_check(db, root)
    parent_rename : Unit <- parent_rename_check(db, root)
    malformed_db : Unit <- malformed_db_check(db, root)
    malformed_endpoint : Unit <- database_malformed_check(db, root)
    collection : Unit <- collect_check(db, root)
    IO.print("storage checks: all green")

def reference_scan(mode: String, +path: String) -> IO(Unit):
  match mode:
    case "process-refs":
      do IO<Unit>:
        result : String <- IO.try(String, Host.StorageHost.process_refs(path))
        IO.print(result)
    case "runtime-refs":
      do IO<Unit>:
        result : String <- IO.try(String, Host.StorageHost.runtime_refs(path))
        IO.print(result)
    case other: IO.die(Unit, 2, "storage-test [process-refs|runtime-refs PATH]")

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case Nil{}: storage_checks()
    case mode <> path <> Nil{}: reference_scan(mode, path)
    case other: IO.die(Unit, 2, "storage-test [process-refs|runtime-refs PATH]")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
