# The managed-context lifecycle fixture. It exercises the role identity and digest,
# the guard anchor and lock naming, the closed progress document, the admission
# outcome surfaces, the semantic-context store transactions and the bound database
# path against a real coordination database, and prints one `key=value` observation
# per line.
#
# It writes no production state: the database, its copy and the log directory are
# throwaway paths named on the command line, and the production coordinator never
# imports this entry.
#
# Run from the repository root:
#   bend bend2/tests/context-lifecycle.bend -o .scratch/context-lifecycle/fixture.c
#   clang -O1 -pthread .scratch/context-lifecycle/fixture.c -lsqlite3 -lm -o .scratch/context-lifecycle/fixture
#   ./.scratch/context-lifecycle/fixture DB COPY LOG_DIR
import Base
import ../src/context/contracts.bend as Context
import ../src/context/identity.bend as ContextRole
import ../src/context/progress.bend as ContextProgress
import ../src/context/admission.bend as ContextAdmission
import ../src/context/store.bend as ContextStore
import ../src/context/roles.bend as ContextRoles
import ../src/context/control.bend as ContextControl
import ../src/context/lifecycle.bend as ContextLifecycle
import ../src/context/bound.bend as ContextBound
import ../src/context/bound-admission.bend as ContextAdmit
import ../src/context/duties.bend as ContextDuties
import ../src/context/laws.bend as ContextLaws
import ../src/coordinator/commands.bend as C
import ../src/host/sqlite.bend as DB
import ../src/host/session-lock.bend as Lock
import ../src/host/files.bend as Files
import ../src/git/text.bend as Tx

def obs(key: String, value: String) -> IO(Unit):
  IO.print(key ++ "=" ++ value)

def show(+key: String, result: Result<&1, &1, U32 & String, String>) -> IO(Unit):
  match result:
    case Done{+value}: obs(key, Tx.trim_nl(value))
    case Fail{error}:
      match error:
        case (code, message): obs(key ++ ".error", message)

# --- pure surfaces -----------------------------------------------------------

def identity_surfaces() -> IO(Unit):
  do IO<Unit>:
    subject : ContextRole.Subject <- IO.pure(ContextRole.Subject, ContextRole.SubjectQuery{"q7"})
    identity : String <- IO.pure(String, ContextRole.guard_identity("/work/coord.sqlite", subject, ContextRole.RoleStarter{}, "0"))
    obs("identity.starter", identity)
    other : String <- IO.pure(String, ContextRole.guard_identity("/work/coord.sqlite", subject, ContextRole.RoleTarget{}, "0"))
    obs("identity.distinct", Bool.show(Bool.not(String.eq(identity, other))))
    obs("identity.admitted", Bool.show(ContextRole.identity_admitted(identity, identity)))
    obs("identity.rejected", Bool.show(ContextRole.identity_admitted(identity, other)))
    obs("lock.name", ContextRole.guard_lock_name("00ffa5"))
    obs("lock.length", Nat.show(String.length(ContextRole.guard_lock_name("00ffa5"))))
    obs("anchor", ContextRole.guard_anchor("/work/log"))
    obs("directory", ContextRole.role_directory("/work/log", "abc"))

def progress_surfaces() -> IO<Unit>:
  do IO<Unit>:
    waiting : List<ContextProgress.Waiting> <- IO.pure(List<ContextProgress.Waiting>, Con{ContextProgress.WaitingProviderResponse{}, Nil{}})
    obs("progress.empty", ContextProgress.progress_json(True{}, ContextProgress.PhaseRunning{}, Nil{}, ContextProgress.ControlUnobserved{}, ContextProgress.CleanupNotRequested{}))
    obs("progress.waiting", ContextProgress.progress_document(ContextProgress.PhaseWaiting{}, waiting, ContextProgress.ControlAvailable{}, ContextProgress.CleanupPending{}))
    obs("progress.diagnostics", ContextProgress.waiting_json(Con{ContextProgress.WaitingDiagnostics{"file:///a.c", 3}, Nil{}}))
    obs("progress.noroles", ContextProgress.progress_json(False{}, ContextProgress.PhaseRunning{}, Nil{}, ContextProgress.ControlUnobserved{}, ContextProgress.CleanupNotRequested{}))
    obs("cleanup.intentless", ContextProgress.cleanup_text(ContextProgress.cleanup_of(False{}, 0, 0)))
    obs("cleanup.unreconciled", ContextProgress.cleanup_text(ContextProgress.cleanup_of(True{}, 1, 1)))
    obs("cleanup.pending", ContextProgress.cleanup_text(ContextProgress.cleanup_of(True{}, 0, 2)))
    obs("cleanup.complete", ContextProgress.cleanup_text(ContextProgress.cleanup_of(True{}, 0, 0)))
    obs("settled.owed", Bool.show(ContextProgress.phase_admitted(ContextProgress.PhaseSettled{}, ContextProgress.CleanupComplete{}, 1)))
    obs("settled.clean", Bool.show(ContextProgress.phase_admitted(ContextProgress.PhaseSettled{}, ContextProgress.CleanupComplete{}, 0)))
    obs("state.terminal", Bool.show(ContextProgress.terminal(Context.QsRefused{})))
    obs("state.late", Context.query_state_name(ContextProgress.state_after(Context.QsComplete{}, Context.QsFailed{})))
    obs("state.forward", Context.query_state_name(ContextProgress.state_after(Context.QsAccepted{}, Context.QsRunning{})))

def admission_surfaces() -> IO<Unit>:
  do IO<Unit>:
    obs("owner.active", Bool.show(ContextAdmission.owner_admission(True{}, True{}, ContextAdmission.OwnerOrdinary{})))
    obs("owner.stopped.ordinary", Bool.show(ContextAdmission.owner_admission(False{}, True{}, ContextAdmission.OwnerOrdinary{})))
    obs("owner.stopped.control", Bool.show(ContextAdmission.owner_admission(False{}, True{}, ContextAdmission.OwnerQueryControl{})))
    obs("owner.stopped.runtime", Bool.show(ContextAdmission.owner_admission(False{}, True{}, ContextAdmission.OwnerRuntimeRelease{})))
    obs("owner.foreign", Bool.show(ContextAdmission.owner_admission(True{}, False{}, ContextAdmission.OwnerOrdinary{})))
    obs("lifecycle.ready.all", Bool.show(ContextLifecycle.rejected_cleanup_ready(True{}, True{}, True{}, True{})))
    obs("lifecycle.ready.missing", Bool.show(ContextLifecycle.rejected_cleanup_ready(True{}, True{}, True{}, False{})))
    obs("delivery.attempt", ContextLifecycle.release_attempt_delivery("pending"))
    obs("delivery.ack", ContextLifecycle.release_ack_delivery(True{}))
    obs("delivery.unknown", ContextLifecycle.release_ack_delivery(False{}))
    obs("signal.order", ContextControl.signal_ordering("SIGKILL", "SIGTERM"))
    obs("bound.document", ContextBound.binding_document(ContextBound.Binding{"dev-ino-birth", 1, "/x", "1", "2", "3", "unix", ""}))
    obs("bound.tuple", ContextBound.physical_tuple(ContextBound.Binding{"dev-ino-birth", 1, "/x", "1", "2", "3", "unix", ""}))
    obs("refusal.prepare", Context.refusal_text(ContextAdmission.admission_refusal(ContextAdmission.OutcomePrepareFailed{ContextAdmission.StageSpool{}, "q9", "root", "/log/q9", ContextAdmission.NoEvidence{}, ContextAdmission.NoCode{}, False{}})))
    obs("refusal.uncertain", Context.refusal_text(ContextAdmission.admission_refusal(ContextAdmission.OutcomeUncertain{"q9", "root", "", ContextAdmission.ArtifactEvidence{"/e.json", "ab", "/0"}, True{}})))
    obs("refusal.rejected", Context.refusal_text(ContextAdmission.admission_refusal(ContextAdmission.OutcomeRejected{"q9", "preparedKeeperCancelled"})))
    obs("rejection.error", ContextAdmission.rejection_error("preparedKeeperCancelled"))
    obs("rejection.notice.id", ContextAdmission.rejection_message_id("q9"))

# --- host surfaces -----------------------------------------------------------

def release_lock(lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.pure(Unit, Unit{})
    case Some{handle}: IO.try(Unit, Lock.release(handle))

def host_surfaces(+log: String) -> IO(Unit):
  do IO<Unit>:
    anchor : String <- IO.try(String, ContextRole.prepare_guard_anchor(log))
    obs("anchor.canonical", anchor)
    key : String <- IO.try(String, ContextRole.role_guard_key("abc"))
    obs("key.abc", key)
    lock : Maybe<U32> <- IO.try(Maybe<U32>, Lock.try_acquire(anchor, key))
    obs("lock.acquired", Bool.show(Maybe.is_some(&1, U32, lock)))
    found : String <- IO.try(String, Files.find_suffix(log, ContextRole.guard_lock_name(key)))
    obs("lock.found", found)
    released : Unit <- release_lock(lock)
    IO.pure(Unit, Unit{})

def binding_surfaces(+db: String, +copy: String) -> IO(String):
  do IO<String>:
    bound : String <- IO.try(String, DB.Sql.binding(db))
    obs("binding.original", bound)
    bound_result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, bound, "SELECT 1;")
    show("bound.rows", bound_result)
    copied : String <- IO.try(String, DB.Sql.binding(copy))
    obs("binding.copy", copied)
    crossed : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, copied, "SELECT 1;")
    show("cross.result", crossed)
    missing : Result<&1,&1,U32 & String,String> <- DB.Sql.binding(db ++ "-absent")
    show("missing.result", missing)
    token : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, ContextBound.binding_document(ContextBound.Binding{"dev-ino-birth", 1, db, "0", "0", "0", "unix", ""}), "SELECT 1;")
    show("binding.foreign", token)
    IO.pure(String, bound)

# --- store transactions ------------------------------------------------------

def setup_sql() -> String:
  "BEGIN IMMEDIATE;" ++ C.schema() ++ ContextStore.schema()
  ++ "INSERT INTO sessions(id,parent,harness,model,effort,workspace,branch,base) VALUES('root',NULL,'omp','m','high','/work','b','8a26');"
  ++ "INSERT INTO sessions(id,parent,harness,model,effort,workspace,branch,base) VALUES('kid','root','omp','m','high','/work/k','b','8a26');"
  ++ "COMMIT;"

def store_surfaces(+db: String, +binding: String) -> IO(Unit):
  do IO<Unit>:
    setup : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, setup_sql())
    show("setup", setup)
    accept : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextStore.accept_sql("q1", "root", "{\"version\":1,\"engine\":\"typescript\"}", "/work", "attempt-1", "/log/q1", "/art/q1"))
    show("accept.q1", accept)
    replay : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextStore.accept_sql("q1", "root", "{\"version\":1,\"engine\":\"typescript\"}", "/work", "attempt-1", "/log/q1", "/art/q1"))
    show("replay.q1", replay)
    conflict : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextStore.accept_sql("q1", "root", "{\"version\":1,\"engine\":\"clangd\"}", "/work", "attempt-1", "/log/q1", "/art/q1"))
    show("conflict.q1", conflict)
    complete : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextStore.state_publish_sql("q1", "complete", "{\"engine\":\"typescript\",\"facts\":[]}", ""))
    show("publish.complete", complete)
    repeat : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextStore.state_publish_sql("q1", "complete", "{\"engine\":\"typescript\",\"facts\":[]}", ""))
    show("publish.repeat", repeat)
    late : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextStore.state_publish_sql("q1", "failed", "", "{\"kind\":\"providerFailed\"}"))
    show("publish.late", late)
    kept : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextStore.envelope_sql("q1"))
    show("publish.kept", kept)
    IO.pure(Unit, Unit{})

def rejection_surfaces(+db: String, +binding: String) -> IO(Unit):
  do IO<Unit>:
    +progress : String <- IO.pure(String, ContextProgress.progress_json(True{}, ContextProgress.PhaseCleaning{}, Nil{}, ContextProgress.ControlUnobserved{}, ContextProgress.CleanupPending{}))
    +error : String <- IO.pure(String, ContextAdmission.rejection_error("preparedKeeperCancelled"))
    +notice : String <- IO.pure(String, ContextAdmission.rejection_message_id("q2"))
    body : String <- IO.pure(String, "{\"kind\":\"context-admission-rejected\",\"query\":\"q2\"}")
    rejected : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextStore.reject_sql("q2", "root", "{\"version\":1}", "/work", "", "/log/q2", "/art/q2", error, progress, notice, body))
    show("reject.q2", rejected)
    notice_read : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, "SELECT body FROM messages WHERE id=" ++ C.q(notice) ++ ";")
    show("reject.notice", notice_read)
    refused : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextStore.envelope_sql("q2"))
    show("reject.envelope", refused)
    IO.pure(Unit, Unit{})

def role_surfaces(+db: String, +binding: String, +log: String) -> IO(Unit):
  do IO<Unit>:
    identity : String <- IO.pure(String, ContextRole.guard_identity(binding, ContextRole.SubjectQuery{"q1"}, ContextRole.RoleStarter{}, "0"))
    key : String <- IO.try(String, ContextRole.role_guard_key(identity))
    row : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextRoles.role_row_sql("q1", "starter", "0", "/log/q1", ContextRole.guard_anchor(log), key, identity, "[\"bat\",\"--recover-context-role\"]", binding, "prepared", "notRequested"))
    show("role.row", row)
    first : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextRoles.event_commit_sql("q1", "starter", "0", "root", "", "1", "{\"phase\":\"running\"}", "notice-1", "{\"kind\":\"context-progress\",\"query\":\"q1\"}", "{\"path\":\"/c/1\",\"sha256\":\"aa\",\"pointer\":\"/0\"}", ""))
    show("event.first", first)
    again : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextRoles.event_commit_sql("q1", "starter", "0", "root", "", "1", "{\"phase\":\"running\"}", "notice-1", "{\"kind\":\"context-progress\",\"query\":\"q1\"}", "{\"path\":\"/c/1\",\"sha256\":\"aa\",\"pointer\":\"/0\"}", ""))
    show("event.replay", again)
    stale : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextRoles.event_commit_sql("q1", "starter", "0", "root", "0", "2", "{\"phase\":\"waiting\"}", "notice-2", "{\"kind\":\"context-progress\",\"query\":\"q1\"}", "", ""))
    show("event.stale", stale)
    absent : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextRoles.event_commit_sql("q1", "target", "9", "root", "", "1", "", "", "", ""))
    show("event.absent", absent)
    notice_read : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, "SELECT body FROM messages WHERE id='notice-1';")
    show("event.notice", notice_read)
    intent : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextRoles.intent_read_sql("q1", "starter", "0"))
    show("intent.q1", intent)
    IO.pure(Unit, Unit{})

def control_surfaces(+db: String, +binding: String) -> IO(Unit):
  do IO<Unit>:
    +control_request : String <- IO.pure(String, "{\"version\":1,\"subject\":{\"intent\":\"release\",\"kind\":\"query-control\"}}")
    release : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextControl.control_admit_sql("cq1", "root", control_request, "q1", "release", "SIGTERM", "/work", "/art/cq1"))
    show("control.release", release)
    intent : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, "SELECT cleanup_intent_json FROM semantic_queries WHERE id='q1';")
    show("control.intent", intent)
    kill : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextControl.control_admit_sql("cq2", "root", control_request, "q1", "release", "SIGKILL", "/work", "/art/cq2"))
    show("control.kill", kill)
    downgrade : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextControl.control_admit_sql("cq3", "root", control_request, "q1", "release", "SIGTERM", "/work", "/art/cq3"))
    show("control.downgrade", downgrade)
    kept : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, "SELECT cleanup_intent_json FROM semantic_queries WHERE id='q1';")
    show("control.kept", kept)
    foreign : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextControl.control_admit_sql("cq4", "kid", control_request, "q1", "recover", "", "/work", "/art/cq4"))
    show("control.foreign", foreign)
    recover : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextControl.control_admit_sql("cq5", "root", control_request, "q2", "recover", "", "/work", "/art/cq5"))
    show("control.recover", recover)
    count : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, "SELECT count(*) FROM semantic_queries;")
    show("control.count", count)
    IO.pure(Unit, Unit{})

def show_admission(+key: String, result: Result<&1,&1,U32 & String,ContextAdmit.Admission>) -> IO(Unit):
  match result:
    case Done{+admission}: obs(key, ContextAdmit.admit_text(admission))
    case Fail{error}:
      match error:
        case (code, message): obs(key ++ ".error", message)

# The atomic bound admission: one transaction creates the row, a second identical
# admission returns the retained row, and a different request for the same identity
# returns the winner's recorded request so the caller can refuse it. The row count
# stays at one.
def admit_surfaces(+db: String, +binding: String) -> IO(Unit):
  do IO<Unit>:
    +request : String <- IO.pure(String, "{\"version\":1,\"engine\":\"typescript\"}")
    +other : String <- IO.pure(String, "{\"version\":1,\"engine\":\"clangd\"}")
    created : Result<&1,&1,U32 & String,ContextAdmit.Admission> <- ContextAdmit.admit(db, binding, "q3", "root", request, "/log/q3", "/work", "attempt-3", "/art/q3")
    show_admission("admit.created", created)
    retained : Result<&1,&1,U32 & String,ContextAdmit.Admission> <- ContextAdmit.admit(db, binding, "q3", "root", request, "/log/q3", "/work", "attempt-3", "/art/q3")
    show_admission("admit.retained", retained)
    conflict : Result<&1,&1,U32 & String,ContextAdmit.Admission> <- ContextAdmit.admit(db, binding, "q3", "root", other, "/log/q3", "/work", "attempt-9", "/art/q3")
    show_admission("admit.conflict", conflict)
    rows : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, "SELECT count(*) FROM semantic_queries WHERE id='q3';")
    show("admit.rows", rows)
    IO.pure(Unit, Unit{})

# The exported duty enumeration: a settled context answers none, and an owed notice
# for the query keeps the view from being settled.
def show_duty(key: String, result: Result<&1,&1,U32 & String,ContextDuties.DutyView>) -> IO(Unit):
  match result:
    case Done{+view}: obs(key, ContextDuties.duty_text(view))
    case Fail{error}:
      match error:
        case (code, message): obs(key ++ ".error", message)

def duty_surfaces(db: String, binding: String) -> IO(Unit):
  do IO<Unit>:
    settled : Result<&1,&1,U32 & String,ContextDuties.DutyView> <- ContextDuties.duties(db, binding)
    show_duty("duties.view", settled)
    owed : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, "SELECT json_extract(cleanup_intent_json,'$.signal') FROM semantic_queries WHERE id='q1';")
    show("duties.intent", owed)
    IO.pure(Unit, Unit{})

def run(+db: String, +copy: String, +log: String) -> IO(Unit):
  do IO<Unit>:
    pure : Unit <- identity_surfaces()
    more : Unit <- progress_surfaces()
    decisions : Unit <- admission_surfaces()
    host : Unit <- host_surfaces(log)
    +binding : String <- binding_surfaces(db, copy)
    store : Unit <- store_surfaces(db, binding)
    rejection : Unit <- rejection_surfaces(db, binding)
    admissions : Unit <- admit_surfaces(db, binding)
    roles : Unit <- role_surfaces(db, binding, log)
    control : Unit <- control_surfaces(db, binding)
    duties : Unit <- duty_surfaces(db, binding)
    IO.print("context-lifecycle: done")

def complain() -> IO(Unit):
  IO.die(Unit, 2, "usage: context-lifecycle DB COPY LOG_DIR")

def dispatch(args: List<String>) -> IO(Unit):
  match args:
    case +db <> rest0:
      match rest0:
        case +copy <> rest1:
          match rest1:
            case +log <> rest2: run(db, copy, log)
            case _: complain()
        case _: complain()
    case _: complain()

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args)
