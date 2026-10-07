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
import ../src/json/canonical.bend as J
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

def obs(+key: String, +value: String) -> IO(Unit):
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
    +subject : ContextRole.Subject <- IO.pure(ContextRole.Subject, ContextRole.SubjectQuery{"q7"})
    +identity : String <- IO.pure(String, ContextRole.guard_identity("/work/coord.sqlite", subject, ContextRole.RoleStarter{}, "0"))
    obs("identity.starter", identity)
    +other : String <- IO.pure(String, ContextRole.guard_identity("/work/coord.sqlite", subject, ContextRole.RoleTarget{}, "0"))
    obs("identity.distinct", Bool.show(Bool.not(String.eq(identity, other))))
    obs("identity.admitted", Bool.show(ContextRole.identity_admitted(identity, identity)))
    obs("identity.rejected", Bool.show(ContextRole.identity_admitted(identity, other)))
    obs("lock.name", ContextRole.guard_lock_name("00ffa5"))
    obs("lock.length", Nat.show(String.length(ContextRole.guard_lock_name("00ffa5"))))
    obs("anchor", ContextRole.guard_anchor("/work/log"))
    obs("directory", ContextRole.role_directory("/work/log", "abc"))

def progress_surfaces() -> IO(Unit):
  do IO<Unit>:
    waiting : List<ContextProgress.Waiting> <- IO.pure(List<ContextProgress.Waiting>, Con{ContextProgress.WaitingProviderResponse{}, Nil{}})
    obs("progress.empty", ContextProgress.progress_json(True{}, ContextProgress.PhaseRunning{}, Nil{}, ContextProgress.ControlUnobserved{}, ContextProgress.CleanupNotRequested{}))
    obs("progress.waiting", ContextProgress.progress_document(ContextProgress.PhaseWaiting{}, waiting, ContextProgress.ControlAvailable{}, ContextProgress.CleanupPending{}))
    obs("progress.diagnostics", J.json_text(ContextProgress.waiting_json(Con{ContextProgress.WaitingDiagnostics{"file:///a.c", 3}, Nil{}})))
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

def admission_surfaces() -> IO(Unit):
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
    case Some{handle}: IO.try(Unit, Lock.SessionLock.release(handle))

def observe_lock(lock: Maybe<U32>) -> IO(Maybe<U32>):
  match lock:
    case None{}: do IO<Maybe<U32>>:
      reported : Unit <- obs("lock.acquired", "false")
      IO.pure(Maybe<U32>, None{})
    case Some{handle}: do IO<Maybe<U32>>:
      reported : Unit <- obs("lock.acquired", "true")
      IO.pure(Maybe<U32>, Some{handle})

def host_surfaces(+log: String) -> IO(Unit):
  do IO<Unit>:
    +anchor : String <- IO.try(String, ContextRole.prepare_guard_anchor(log))
    obs("anchor.canonical", anchor)
    +key : String <- IO.try(String, ContextRole.role_guard_key("abc"))
    obs("key.abc", key)
    acquired : Maybe<U32> <- IO.try(Maybe<U32>, Lock.SessionLock.try_acquire(anchor, key))
    lock : Maybe<U32> <- observe_lock(acquired)
    +found : String <- IO.try(String, Files.Files.find_suffix(log, ContextRole.guard_lock_name(key)))
    obs("lock.found", found)
    released : Unit <- release_lock(lock)
    IO.pure(Unit, Unit{})

def binding_surfaces(+db: String, +copy: String) -> IO(String):
  do IO<String>:
    +bound : String <- IO.try(String, DB.Sql.binding(db))
    obs("binding.original", bound)
    bound_result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, bound, "SELECT 1;")
    show("bound.rows", bound_result)
    +copied : String <- IO.try(String, DB.Sql.binding(copy))
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
    +body : String <- IO.pure(String, "{\"kind\":\"context-admission-rejected\",\"query\":\"q2\"}")
    rejected : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextStore.reject_sql("q2", "root", "{\"version\":1}", "/work", "", "/log/q2", "/art/q2", error, progress, notice, body))
    show("reject.q2", rejected)
    notice_read : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, "SELECT body FROM messages WHERE id=" ++ C.q(notice) ++ ";")
    show("reject.notice", notice_read)
    refused : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextStore.envelope_sql("q2"))
    show("reject.envelope", refused)
    IO.pure(Unit, Unit{})

def role_surfaces(+db: String, +binding: String, +log: String) -> IO(Unit):
  do IO<Unit>:
    +identity : String <- IO.pure(String, ContextRole.guard_identity(binding, ContextRole.SubjectQuery{"q1"}, ContextRole.RoleStarter{}, "0"))
    +key : String <- IO.try(String, ContextRole.role_guard_key(identity))
    row : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextRoles.role_row_sql("q1", "starter", "0", "/log/q1", ContextRole.guard_anchor(log), key, identity, "[\"bat\",\"--recover-context-role\"]", binding, "prepared", "notRequested"))
    show("role.row", row)
    first : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextRoles.event_commit_sql("q1", "starter", "0", "root", "", "1", "{\"phase\":\"running\"}", "notice-1", "{\"kind\":\"context-progress\",\"query\":\"q1\"}", "{\"path\":\"/c/1\",\"sha256\":\"aa\",\"pointer\":\"/0\"}", ""))
    show("event.first", first)
    again : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextRoles.event_commit_sql("q1", "starter", "0", "root", "", "1", "{\"phase\":\"running\"}", "notice-1", "{\"kind\":\"context-progress\",\"query\":\"q1\"}", "{\"path\":\"/c/1\",\"sha256\":\"aa\",\"pointer\":\"/0\"}", ""))
    show("event.replay", again)
    stale : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextRoles.event_commit_sql("q1", "starter", "0", "root", "0", "2", "{\"phase\":\"waiting\"}", "notice-2", "{\"kind\":\"context-progress\",\"query\":\"q1\"}", "", ""))
    show("event.stale", stale)
    absent : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextRoles.event_commit_sql("q1", "target", "9", "root", "", "1", "", "", "", "", ""))
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
def show_duty(+key: String, result: Result<&1,&1,U32 & String,ContextDuties.DutyView>) -> IO(Unit):
  match result:
    case Done{+view}: obs(key, ContextDuties.duty_text(view))
    case Fail{error}:
      match error:
        case (code, message): obs(key ++ ".error", message)

def show_duty_has(+key: String, view: Result<&1,&1,U32 & String,ContextDuties.DutyView>, +kind: String, +subject: String) -> IO(Unit):
  match view:
    case Done{+duties}: obs(key, Bool.show(ContextDuties.duty_contains(duties, kind, subject)))
    case Fail{error}:
      match error:
        case (code, message): obs(key ++ ".error", message)

def show_duty_set(result: Result<&1,&1,U32 & String,ContextDuties.DutyView>) -> IO(Unit):
  match result:
    case Done{+view}: do IO<Unit>:
      shown : Unit <- obs("duties.view", ContextDuties.duty_text(view))
      first : Unit <- obs("duties.q1", Bool.show(ContextDuties.duty_contains(view, "query", "q1")))
      obs("duties.q4", Bool.show(ContextDuties.duty_contains(view, "query", "q4")))
    case Fail{error}:
      match error:
        case (code,+message): do IO<Unit>:
          shown : Unit <- obs("duties.view.error", message)
          first : Unit <- obs("duties.q1.error", message)
          obs("duties.q4.error", message)

def duty_surfaces(+db: String, +binding: String) -> IO(Unit):
  do IO<Unit>:
    created : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextStore.accept_sql("q4", "root", "{\"version\":1,\"engine\":\"typescript\"}", "/work", "", "/log/q4", "/art/q4"))
    show("duties.q4.accept", created)
    published : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextStore.state_publish_sql("q4", "complete", "{\"engine\":\"typescript\"}", ""))
    show("duties.q4.publish", published)
    settled : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextStore.envelope_sql("q4"))
    show("duties.q4.readback", settled)
    view : Result<&1,&1,U32 & String,ContextDuties.DutyView> <- ContextDuties.duties(db, binding)
    shown : Unit <- show_duty_set(view)
    missing : Result<&1,&1,U32 & String,ContextDuties.DutyView> <- ContextDuties.duties(db, binding ++ "-absent")
    show_duty("duties.missing", missing)
    IO.pure(Unit, Unit{})

def runtime_row_surfaces(+db: String, +binding: String) -> IO(Unit):
  do IO<Unit>:
    +owner : String <- IO.pure(String, "root")
    +big : String <- IO.pure(String, "12345678901234567890123456789012345")
    +bad : String <- IO.pure(String, "-1")
    valid : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextStore.runtime_row_sql("rt1", owner, "", "q1", "adapter-1", "starting", big))
    show("runtime.big", valid)
    after : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, "SELECT count(*) FROM semantic_runtimes WHERE id='rt1';")
    show("runtime.big.rows", after)
    refused : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextStore.runtime_row_sql("rt2", owner, "", "q4", "adapter-2", "starting", bad))
    show("runtime.bad", refused)
    none : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, "SELECT count(*) FROM semantic_runtimes WHERE id='rt2';")
    show("runtime.bad.rows", none)
    control : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextStore.runtime_row_sql("rt2", owner, "", "q4", "adapter-2", "starting", big))
    show("runtime.control", control)
    malformed : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextStore.runtime_row_sql("rt1", owner, "", "q9", "adapter-9", "running", bad))
    show("runtime.malformed", malformed)
    unchanged : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, "SELECT json_object('launchQuery',launch_query,'adapterId',adapter_id,'state',state,'epoch',epoch) FROM semantic_runtimes WHERE id='rt1';")
    show("runtime.unchanged", unchanged)
    conflict : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextStore.runtime_row_sql("rt1", owner, "", "q9", "adapter-9", "running", big))
    show("runtime.conflict", conflict)
    kept : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, "SELECT launch_query FROM semantic_runtimes WHERE id='rt1';")
    show("runtime.kept", kept)
    IO.pure(Unit, Unit{})

# --- the retained ref association -------------------------------------------

# One lookup answer as a pair of a label and its raw evidence text, so every case is
# asserted from its own observation and an unreadable answer shows the row it refused.
def ref_parts(+lookup: ContextStore.RefLookup) -> String & String:
  match lookup:
    case ContextStore.RefFound{+query, +refId, +state, +entry}: ("found:" ++ query ++ ":" ++ refId ++ ":" ++ state, entry)
    case ContextStore.RefAbsent{+query, +refId}: ("absent:" ++ query ++ ":" ++ refId, "")
    case ContextStore.RefAmbiguous{+query, +refId, +count}: ("ambiguous:" ++ query ++ ":" ++ refId ++ ":" ++ count, "")
    case ContextStore.RefOpen{+query, +refId, +state}: ("open:" ++ query ++ ":" ++ refId ++ ":" ++ state, "")
    case ContextStore.RefFailed{+query, +refId, +state}: ("failed:" ++ query ++ ":" ++ refId ++ ":" ++ state, "")
    case ContextStore.RefUnretained{+query, +refId}: ("unretained:" ++ query ++ ":" ++ refId, "")
    case ContextStore.RefQueryMissing{+query, +refId}: ("missing:" ++ query ++ ":" ++ refId, "")
    case ContextStore.RefUnreadable{+stage, +answer}: ("unreadable:" ++ stage, answer)

# The pair is matched as a declared parameter, and the raw evidence is bracketed by two
# key lines so the driver compares the whole text rather than a line fragment.
def ref_observe(+label: String, +pair: String & String) -> IO(Unit):
  match pair:
    case (label_text, evidence):
      do IO<Unit>:
        shown : Unit <- obs(label, label_text)
        opened : Unit <- obs(label ++ ".evidence.begin", "")
        raw : Unit <- IO.print(evidence)
        closed : Unit <- obs(label ++ ".evidence.end", "")
        IO.pure(Unit, Unit{})

def ref_after_case(+label: String, result: Result<&1,&1,U32 & String,ContextStore.RefLookup>) -> IO(Unit):
  match result:
    case Done{+lookup}: ref_observe(label, ref_parts(lookup))
    case Fail{error}:
      match error:
        case (code, message): obs(label ++ ".error", message)

def ref_case(+db: String, +binding: String, +label: String, +query: String, +refId: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,ContextStore.RefLookup> <- ContextStore.ref_lookup(db, binding, query, refId)
    ref_after_case(label, result)

def ref_accept(+db: String, +binding: String, +query: String) -> IO(Unit):
  do IO<Unit>:
    created : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextStore.accept_sql(query, "root", "{\"version\":1,\"engine\":\"typescript\"}", "/work", "", "/log/" ++ query, "/art/" ++ query))
    show("refs.accept." ++ query, created)

def ref_publish(+db: String, +binding: String, +query: String, +state: String, +result: String, +error: String) -> IO(Unit):
  do IO<Unit>:
    published : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextStore.state_publish_sql(query, state, result, error))
    show("refs.publish." ++ query, published)

# The retained ref association through the bound lookup. Each case is established by its
# own stored row before the lookup runs: a complete result whose refs array holds one
# intact entry, an empty refs array, a number element, a text element, an entry missing
# declared members, a repeated projections member, a repeated refs member, a repeated
# subject kind, a number projection element, an intact array whose requested identity is
# absent, a complete result without the refs member, two intact entries sharing the
# requested identity, an accepted query with no result, a failed query with no result, a
# query that was never admitted, and an unavailable binding.
def ref_surfaces(+db: String, +binding: String) -> IO(Unit):
  do IO<Unit>:
    +entry : String <- IO.pure(String, "{\n\t\t\"id\":\"ref-1\",\"engine\":\"typescript\",\"subject\":{\"kind\":\"entity\",\"database\":\"café\"},\"snapshotId\":\"s1\",\"projections\":[\"definition\"]}")
    +duplicate : String <- IO.pure(String, "{\"refs\":[{\"id\":\"ref-7\",\"engine\":\"typescript\",\"subject\":{\"kind\":\"entity\"},\"snapshotId\":\"s7\",\"projections\":[\"definition\"]},{\"id\":\"ref-7\",\"engine\":\"typescript\",\"subject\":{\"kind\":\"entity\"},\"snapshotId\":\"s7\",\"projections\":[\"definition\"]}]}")
    a1 : Unit <- ref_accept(db, binding, "qr1")
    p1 : Unit <- ref_publish(db, binding, "qr1", "complete", "{\"refs\":[" ++ entry ++ "]}", "")
    a2 : Unit <- ref_accept(db, binding, "qr2")
    p2 : Unit <- ref_publish(db, binding, "qr2", "complete", "{\"refs\":[]}", "")
    a3 : Unit <- ref_accept(db, binding, "qr3")
    p3 : Unit <- ref_publish(db, binding, "qr3", "complete", "{\"refs\":[42]}", "")
    a4 : Unit <- ref_accept(db, binding, "qr4")
    p4 : Unit <- ref_publish(db, binding, "qr4", "complete", "{\"refs\":[\"not-json\"]}", "")
    a5 : Unit <- ref_accept(db, binding, "qr5")
    p5 : Unit <- ref_publish(db, binding, "qr5", "complete", "{\"refs\":[{\"id\":\"ref-5\",\"engine\":\"typescript\"}]}", "")
    a6 : Unit <- ref_accept(db, binding, "qr6")
    p6 : Unit <- ref_publish(db, binding, "qr6", "complete", "{\"facts\":[]}", "")
    a7 : Unit <- ref_accept(db, binding, "qr7")
    p7 : Unit <- ref_publish(db, binding, "qr7", "complete", duplicate, "")
    a8 : Unit <- ref_accept(db, binding, "qr8")
    +duplicate_projections : String <- IO.pure(String, "{\"refs\":[{\"id\":\"ref-11\",\"engine\":\"typescript\",\"subject\":{\"kind\":\"entity\"},\"snapshotId\":\"s11\",\"projections\":[\"definition\"],\"projections\":[\"definition\"]}]}")
    +duplicate_refs : String <- IO.pure(String, "{\"refs\":[{\"id\":\"ref-12\",\"engine\":\"typescript\",\"subject\":{\"kind\":\"entity\"},\"snapshotId\":\"s12\",\"projections\":[\"definition\"]}],\"refs\":[]}")
    +duplicate_kind : String <- IO.pure(String, "{\"refs\":[{\"id\":\"ref-13\",\"engine\":\"typescript\",\"subject\":{\"kind\":\"entity\",\"kind\":\"other\"},\"snapshotId\":\"s13\",\"projections\":[\"definition\"]}]}")
    +number_projection : String <- IO.pure(String, "{\"refs\":[{\"id\":\"ref-14\",\"engine\":\"typescript\",\"subject\":{\"kind\":\"entity\"},\"snapshotId\":\"s14\",\"projections\":[42]}]}")
    +other_identity : String <- IO.pure(String, "{\"refs\":[{\"id\":\"ref-15\",\"engine\":\"typescript\",\"subject\":{\"kind\":\"entity\"},\"snapshotId\":\"s15\",\"projections\":[\"definition\"]}]}")
    a9 : Unit <- ref_accept(db, binding, "qr9")
    p9 : Unit <- ref_publish(db, binding, "qr9", "failed", "", "{\"kind\":\"providerFailed\"}")
    f1 : Unit <- ref_case(db, binding, "refs.found", "qr1", "ref-1")
    f2 : Unit <- ref_case(db, binding, "refs.absent", "qr2", "ref-2")
    f3 : Unit <- ref_case(db, binding, "refs.scalar", "qr3", "ref-3")
    f4 : Unit <- ref_case(db, binding, "refs.text", "qr4", "ref-4")
    f5 : Unit <- ref_case(db, binding, "refs.partial", "qr5", "ref-5")
    f6 : Unit <- ref_case(db, binding, "refs.container", "qr6", "ref-6")
    f7 : Unit <- ref_case(db, binding, "refs.duplicate", "qr7", "ref-7")
    f8 : Unit <- ref_case(db, binding, "refs.open", "qr8", "ref-8")
    f9 : Unit <- ref_case(db, binding, "refs.failed", "qr9", "ref-9")
    f10 : Unit <- ref_case(db, binding, "refs.missing", "qr10", "ref-10")
    a11 : Unit <- ref_accept(db, binding, "qr11")
    p11 : Unit <- ref_publish(db, binding, "qr11", "complete", duplicate_projections, "")
    a12 : Unit <- ref_accept(db, binding, "qr12")
    p12 : Unit <- ref_publish(db, binding, "qr12", "complete", duplicate_refs, "")
    a13 : Unit <- ref_accept(db, binding, "qr13")
    p13 : Unit <- ref_publish(db, binding, "qr13", "complete", duplicate_kind, "")
    a14 : Unit <- ref_accept(db, binding, "qr14")
    p14 : Unit <- ref_publish(db, binding, "qr14", "complete", number_projection, "")
    a15 : Unit <- ref_accept(db, binding, "qr15")
    p15 : Unit <- ref_publish(db, binding, "qr15", "complete", other_identity, "")
    g11 : Unit <- ref_case(db, binding, "refs.projections", "qr11", "ref-11")
    g12 : Unit <- ref_case(db, binding, "refs.duplicate.refs", "qr12", "ref-12")
    g13 : Unit <- ref_case(db, binding, "refs.duplicate.kind", "qr13", "ref-13")
    g14 : Unit <- ref_case(db, binding, "refs.projection.type", "qr14", "ref-14")
    g15 : Unit <- ref_case(db, binding, "refs.other.identity", "qr15", "ref-16")
    f11 : Unit <- ref_case(db, binding ++ "-absent", "refs.unavailable", "qr1", "ref-1")
    IO.pure(Unit, Unit{})

# --- the companion intent surfaces -------------------------------------------

# The pure intent decisions on the answers the bound read produces, including an answer
# that arrives without the host's terminating newline and one that is unrecognised.
def intent_surfaces() -> IO(Unit):
  do IO<Unit>:
    obs("intent.step.owed", ContextLifecycle.companion_text(ContextLifecycle.intent_step("1\n")))
    obs("intent.step.settled", ContextLifecycle.companion_text(ContextLifecycle.intent_step("0\n")))
    obs("intent.step.missing", ContextLifecycle.companion_text(ContextLifecycle.intent_step("missing\n")))
    obs("intent.step.unreadable", ContextLifecycle.companion_text(ContextLifecycle.intent_step("weird\n")))
    obs("intent.step.unterminated", ContextLifecycle.companion_text(ContextLifecycle.intent_step("1")))
    obs("intent.duty.attempted", Bool.show(ContextLifecycle.owns_live_duty("attempted")))
    obs("intent.duty.unavailable", Bool.show(ContextLifecycle.owns_live_duty("unavailable")))
    obs("intent.duty.acknowledged", Bool.show(ContextLifecycle.owns_live_duty("acknowledged")))
    obs("intent.duty.settled", Bool.show(ContextLifecycle.owns_live_duty("settled")))

def show_step(+key: String, step: ContextLifecycle.CompanionStep) -> IO(Unit):
  obs(key, ContextLifecycle.companion_text(step))

# The settled reading's duty probe, marked under a key of its own so the driver can tell a
# probed conclusion from the short circuit a continuing or missing reading takes.
def probe_live(+key: String) -> IO(Bool):
  do IO<Bool>:
    marked : Unit <- obs(key, "probed")
    IO.pure(Bool, True{})

def probe_settled(+key: String) -> IO(Bool):
  do IO<Bool>:
    marked : Unit <- obs(key, "probed")
    IO.pure(Bool, False{})

# The continuation the streaming loop takes after a continuing reading, marked so the
# driver can tell that it ran rather than that the loop concluded on its own.
def continuation(+key: String) -> IO(ContextLifecycle.CompanionStep):
  do IO<ContextLifecycle.CompanionStep>:
    marked : Unit <- obs(key, "reached")
    IO.pure(ContextLifecycle.CompanionStep, ContextLifecycle.StepSettled{})

# The companion through the bound read, on a query of its own: the earlier control surfaces
# persist a cleanup intent for q1, and the intent read is open while the query or the role
# owes anything, so a settled reading can only be established on a query that carries no
# intent and no owed notice. The two role rows take keeper paths of their own because the
# keeper path is unique across the role table.
def companion_surfaces(+db: String, +binding: String, +log: String) -> IO(Unit):
  do IO<Unit>:
    +anchor : String <- IO.pure(String, ContextRole.guard_anchor(log))
    admitted : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextStore.accept_sql("qc1", "root", "{\"version\":1,\"engine\":\"typescript\"}", "/work", "", "/log/qc1", "/art/qc1"))
    show("companion.query", admitted)
    +owed_identity : String <- IO.pure(String, ContextRole.guard_identity(binding, ContextRole.SubjectQuery{"qc1"}, ContextRole.RoleStarter{}, "0"))
    +owed_key : String <- IO.try(String, ContextRole.role_guard_key(owed_identity))
    owed : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextRoles.role_row_sql("qc1", "starter", "0", "/log/qc1-owned", anchor, owed_key, owed_identity, "[\"bat\",\"--recover-context-role\"]", binding, "prepared", "pending"))
    show("companion.owed.row", owed)
    +settled_identity : String <- IO.pure(String, ContextRole.guard_identity(binding, ContextRole.SubjectQuery{"qc1"}, ContextRole.RoleTarget{}, "1"))
    +settled_key : String <- IO.try(String, ContextRole.role_guard_key(settled_identity))
    settled : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextRoles.role_row_sql("qc1", "target", "1", "/log/qc1-settled", anchor, settled_key, settled_identity, "[\"bat\",\"--recover-context-role\"]", binding, "settled", "complete"))
    show("companion.settled.row", settled)
    owed_read : ContextLifecycle.CompanionStep <- ContextLifecycle.companion_step(db, binding, "qc1", "starter", "0", u => probe_settled("companion.owed.probe"))
    show_step("companion.owed", owed_read)
    settled_live : ContextLifecycle.CompanionStep <- ContextLifecycle.companion_step(db, binding, "qc1", "target", "1", u => probe_live("companion.settled.live.probe"))
    show_step("companion.settled.live", settled_live)
    settled_done : ContextLifecycle.CompanionStep <- ContextLifecycle.companion_step(db, binding, "qc1", "target", "1", u => probe_settled("companion.settled.done.probe"))
    show_step("companion.settled.done", settled_done)
    missing_read : ContextLifecycle.CompanionStep <- ContextLifecycle.companion_step(db, binding, "qc1", "adapter", "9", u => probe_settled("companion.missing.probe"))
    show_step("companion.missing", missing_read)
    refused : ContextLifecycle.CompanionStep <- ContextLifecycle.companion_step(db, binding ++ "-absent", "qc1", "starter", "0", u => probe_settled("companion.refused.probe"))
    show_step("companion.refused", refused)
    looped : ContextLifecycle.CompanionStep <- ContextLifecycle.reconcile_intents(db, binding, "qc1", "starter", "0", u => probe_live("companion.loop.probe"), u => continuation("companion.loop.continuation"))
    show_step("companion.loop", looped)
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
    rows : Unit <- runtime_row_surfaces(db, binding)
    refs : Unit <- ref_surfaces(db, binding)
    intents : Unit <- intent_surfaces()
    companions : Unit <- companion_surfaces(db, binding, log)
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
