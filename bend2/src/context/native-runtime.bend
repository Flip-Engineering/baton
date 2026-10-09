# Retained Runtime target and adapter I/O for the selected native caller.
import Base
import ../host/process.bend as Process
import ../host/instance.bend as Custody
import ../host/sqlite.bend as DB
import ../host/session-lock.bend as Host
import ../git/text.bend as Tx
import ../json/canonical.bend as J
import ../coordinator/commands.bend as ContextCommands
import ./store.bend as ContextStore
import ./text.bend as ContextText
import ./codec.bend as Codec
import ./codec-wire.bend as Wire
import ./request.bend as Req
import ./contracts.bend as Context

type RuntimeBridge is Data:
  RuntimeBridge{target: U32, adapter: U32, target_dir: String, adapter_dir: String}

def runtime_retained_handle(result: Result<&1,&1,U32 & String,Process.RetainedStart>) -> IO(U32):
  match result:
    case Fail{(code, detail)}: IO.die(U32, code, detail)
    case Done{started}:
      match started:
        case Process.Retained{handle}: IO.pure(U32, handle)
        case Process.Unstarted{error}: IO.die(U32, 3, error)

def runtime_setup(+owner: String, +launch_query: String, +stderr_path: String,
    +invocation_text: String) -> String:
  "{\"runtime\":" ++ J.json_text(J.Jstr{"rt:" ++ launch_query})
  ++ ",\"adapter\":\"0\",\"incarnation\":\"0\",\"owner\":"
  ++ J.json_text(J.Jstr{owner}) ++ ",\"stderrPath\":"
  ++ J.json_text(J.Jstr{stderr_path}) ++ ",\"invocation\":" ++ invocation_text ++ "}"

def runtime_target_argv(node: String, bootstrap_path: String) -> String:
  Process.argv(["/usr/bin/env", "-i", node, bootstrap_path])

def runtime_adapter_argv(node: String, provider_path: String, adapter_dir: String) -> String:
  Process.argv([node, "--experimental-strip-types", provider_path,
    "--runtime-adapter-file", adapter_dir ++ "/setup.json"])

def runtime_retained_open(+db: String, +target_dir: String, +target_argv: String,
    +target_stderr: String, +launch_document: String, +target_recovery: String,
    +adapter_dir: String, +adapter_argv: String, +adapter_stderr: String,
    +setup_text: String, +adapter_recovery: String, +cwd: String) -> IO(RuntimeBridge):
  do IO<RuntimeBridge>:
    target_start : Result<&1,&1,U32 & String,Process.RetainedStart> <-
      Custody.Instance.admit_with_file(db, target_dir, target_argv, cwd,
        target_stderr, "launchdoc.json", launch_document, launch_document,
        0, None{}, target_recovery)
    +target : U32 <- runtime_retained_handle(target_start)
    adapter_start : Result<&1,&1,U32 & String,Process.RetainedStart> <-
      Custody.Instance.admit_with_file(db, adapter_dir, adapter_argv, cwd,
        adapter_stderr, "setup.json", setup_text, SNil{}, 1, None{}, adapter_recovery)
    +adapter : U32 <- runtime_retained_handle(adapter_start)
    IO.pure(RuntimeBridge, RuntimeBridge{target, adapter, target_dir, adapter_dir})

def runtime_signal(signal: String) -> IO(U32):
  match signal:
    case "SIGTERM": IO.pure(U32, 15)
    case "SIGKILL": IO.pure(U32, 9)
    case other: IO.die(U32, 3, "runtimeSignalUnknown:" ++ other)

def runtime_exit_value(+kind: String, +code: U32) -> String:
  Bool.pick(String, String.eq(kind, "exit"),
    "\"code\":" ++ U32.show(code) ++ ",\"signal\":null",
    "\"code\":null,\"signal\":" ++ U32.show(code))

def runtime_exit_number(+kind: String, +status: String, number: Maybe<&2,U32>) -> IO(String):
  match number:
    case Some{code}: IO.pure(String, runtime_exit_value(kind, code))
    case None{}: IO.pure(String, "\"code\":null,\"signal\":null")

def runtime_exit_fields(+status: String, fields: List<String>) -> IO(String):
  match fields:
    case +kind <> +number <> Nil{}:
      Bool.pick(IO(String), Bool.or(String.eq(kind, "exit"), String.eq(kind, "signal")),
        runtime_exit_number(kind, status, U32.read(number)),
        IO.pure(String, "\"code\":null,\"signal\":null"))
    case other: IO.pure(String, "\"code\":null,\"signal\":null")

def runtime_release_response(+query: String, +fields: String, +status: String) -> String:
  "{\"type\":\"keeperReleased\",\"query\":" ++ J.json_text(J.Jstr{query})
  ++ ",\"result\":{\"nativeStatus\":" ++ J.json_text(J.Jstr{status})
  ++ "," ++ fields ++ "}}"

def runtime_target_exit_response(+fields: String, +status: String) -> String:
  "{\"type\":\"targetExited\",\"nativeStatus\":" ++ J.json_text(J.Jstr{status})
  ++ "," ++ fields ++ "}"

def runtime_release_error(+query: String, code: U32, detail: String) -> String:
  "{\"type\":\"keeperReleased\",\"query\":" ++ J.json_text(J.Jstr{query})
  ++ ",\"error\":{\"condition\":\"runtimeKeeperReleaseFailed\",\"detail\":{\"code\":"
  ++ U32.show(code) ++ ",\"detail\":" ++ J.json_text(J.Jstr{detail}) ++ "}}}"

def runtime_notify_commit(+db: String, +binding: String) -> IO(Unit):
  do IO<Unit>:
    cursor : String <- IO.try(String, DB.Sql.query_bound(db, binding,
      "SELECT CAST(coalesce(max(change_id),0) AS TEXT) FROM native_changes;"))
    IO.try(Unit, Custody.Instance.publish_commit(db, Tx.trim_nl(cursor)))

def runtime_control_error(result: Result<&1,&1,U32 & String,Unit>) -> String:
  match result:
    case Done{value}: "null"
    case Fail{(code, detail)}:
      "{\"code\":" ++ U32.show(code) ++ ",\"detail\":" ++ J.json_text(J.Jstr{detail}) ++ "}"

def runtime_cleanup_result(+db: String, +binding: String, +directory: String,
    +phase: String, result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  do IO<Unit>:
    +error : String = runtime_control_error(result)
    saved : String <- IO.try(String, DB.Sql.query_bound(db, binding,
      "UPDATE semantic_roles SET cleanup_phase="
      ++ ContextCommands.q(Bool.pick(String, String.eq(error, "null"), phase, "failed"))
      ++ ",release_intent_json=CASE WHEN " ++ ContextCommands.q(error)
      ++ "='null' THEN release_intent_json ELSE json_set(release_intent_json,'$.cleanupError',json("
      ++ ContextCommands.q(error) ++ ")) END WHERE keeper_path=" ++ ContextCommands.q(directory) ++ ";"))
    IO.pure(Unit, Unit{})

def runtime_cleanup_acknowledged(+db: String, +binding: String, +directory: String,
    +handle: U32, result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Fail{error}: runtime_cleanup_result(db, binding, directory, "acknowledged", Fail{error})
    case Done{value}:
      do IO<Unit>:
        recorded : String <- IO.try(String, DB.Sql.query_bound(db, binding,
          "UPDATE semantic_roles SET release_intent_json=json_set(release_intent_json,'$.cleanupAcknowledged',json('true'))"
          ++ " WHERE keeper_path=" ++ ContextCommands.q(directory) ++ ";"))
        retired : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.retire(handle)
        runtime_cleanup_result(db, binding, directory, "released", retired)

def runtime_cleanup_released(+db: String, +binding: String, +directory: String,
    +handle: U32, result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Fail{error}: runtime_cleanup_result(db, binding, directory, "released", Fail{error})
    case Done{value}:
      do IO<Unit>:
        recorded : String <- IO.try(String, DB.Sql.query_bound(db, binding,
          "UPDATE semantic_roles SET release_intent_json=json_set(release_intent_json,'$.cleanupReleased',json('true'))"
          ++ " WHERE keeper_path=" ++ ContextCommands.q(directory) ++ ";"))
        acknowledged : Result<&1,&1,U32 & String,Unit> <- Process.ProcessChild.acknowledge(handle)
        runtime_cleanup_acknowledged(db, binding, directory, handle, acknowledged)

type RuntimeCopy is Data:
  RuntimeCopy{copied: Bool, evidence: String}

@unsafe
def runtime_copy_drain(+handle: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    line : Result<&1,&1,U32 & String,Maybe<String>> <- Process.ProcessChild.read_line(handle)
    match line:
      case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>, Fail{error})
      case Done{value}:
        match value:
          case None{}: IO.pure(Result<&1,&1,U32 & String,Unit>, Done{Unit{}})
          case Some{text}: runtime_copy_drain(handle)

def runtime_copy_waited(+close_error: String, +read_error: String,
    waited: Result<&1,&1,U32 & String,String>) -> RuntimeCopy:
  +errors : String = "\"closeError\":" ++ close_error ++ ",\"readError\":" ++ read_error
  match waited:
    case Fail{(code, detail)}:
      RuntimeCopy{False{}, "{" ++ errors ++ ",\"nativeStatus\":null,\"waitError\":"
        ++ runtime_control_error(Fail{(code, detail)}) ++ "}"}
    case Done{+status}:
      RuntimeCopy{Bool.and(String.eq(status, "exit 0"),
        Bool.and(String.eq(close_error, "null"), String.eq(read_error, "null"))),
        "{" ++ errors ++ ",\"nativeStatus\":" ++ J.json_text(J.Jstr{status})
        ++ ",\"waitError\":null}"}

def runtime_copy_started(started: Result<&1,&1,U32 & String,U32>) -> IO(RuntimeCopy):
  match started:
    case Fail{(code, detail)}:
      IO.pure(RuntimeCopy, RuntimeCopy{False{}, "{\"nativeStatus\":null,\"spawnError\":"
        ++ runtime_control_error(Fail{(code, detail)}) ++ "}"})
    case Done{+handle}:
      do IO<RuntimeCopy>:
        closed : Result<&1,&1,U32 & String,Unit> <- Process.ProcessChild.close_stdin(handle)
        drained : Result<&1,&1,U32 & String,Unit> <- runtime_copy_drain(handle)
        waited : Result<&1,&1,U32 & String,String> <- Process.ProcessChild.wait(handle)
        IO.pure(RuntimeCopy, runtime_copy_waited(runtime_control_error(closed),
          runtime_control_error(drained), waited))

def runtime_capture_record(+db: String, +binding: String, +directory: String,
    +destination: String, +phase: String, +copy_evidence: String) -> IO(Unit):
  do IO<Unit>:
    +capture : String = "{\"phase\":" ++ J.json_text(J.Jstr{phase})
      ++ ",\"source\":" ++ J.json_text(J.Jstr{directory ++ "/stdout"})
      ++ ",\"path\":" ++ J.json_text(J.Jstr{destination})
      ++ ",\"stderrPath\":" ++ J.json_text(J.Jstr{directory ++ "/stdout-copy.stderr"})
      ++ ",\"copy\":" ++ copy_evidence ++ "}"
    saved : String <- IO.try(String, DB.Sql.query_bound(db, binding,
      "UPDATE semantic_roles SET capture_json=json_set(coalesce(capture_json,'{}'),'$.stdout',json("
      ++ ContextCommands.q(capture) ++ ")),cleanup_phase=" ++ ContextCommands.q("output-" ++ phase)
      ++ " WHERE keeper_path=" ++ ContextCommands.q(directory) ++ ";"))
    IO.pure(Unit, Unit{})

def runtime_capture_copied(+db: String, +binding: String, +directory: String,
    +destination: String, copied: RuntimeCopy) -> IO(Unit):
  match copied:
    case RuntimeCopy{+complete, +evidence}:
      do IO<Unit>:
        saved : Unit <- runtime_capture_record(db, binding, directory, destination,
          Bool.pick(String, complete, "captured", "pending"), evidence)
        Bool.pick(IO(Unit), complete, IO.pure(Unit, Unit{}),
          IO.die(Unit, 3, "runtimeRoleOutputPending:" ++ directory ++ ":" ++ evidence))

# Copy each settled spool as bytes before either keeper acknowledges output.
def runtime_capture_output(+db: String, +binding: String, +directory: String,
    filename: String, artifact: Codec.FieldText) -> IO(Unit):
  match artifact:
    case Codec.FtBad{condition}: IO.die(Unit, 3, "runtimeRoleArtifactPath:" ++ condition)
    case Codec.FtText{artifact_path}:
      do IO<Unit>:
        +destination : String = artifact_path ++ "/" ++ filename
        pending : Unit <- runtime_capture_record(db, binding, directory, destination,
          "pending", "{\"nativeStatus\":null,\"cause\":\"copyRequested\"}")
        started : Result<&1,&1,U32 & String,U32> <- Process.ProcessChild.spawn(
          Process.argv(["/bin/cp", directory ++ "/stdout", destination]),
          "/", directory ++ "/stdout-copy.stderr")
        copied : RuntimeCopy <- runtime_copy_started(started)
        runtime_capture_copied(db, binding, directory, destination, copied)

def runtime_capture_role(+db: String, +binding: String, +directory: String,
    fields: List<String>) -> IO(Unit):
  match fields:
    case "target" <> artifact <> Nil{}:
      runtime_capture_output(db, binding, directory, "target.stdout", Codec.text_field(artifact))
    case "adapter" <> artifact <> Nil{}:
      runtime_capture_output(db, binding, directory, "adapter.stdout", Codec.text_field(artifact))
    case other: IO.die(Unit, 3, "runtimeCleanupRoleMissing")

def runtime_prepare_cleanup(+db: String, +binding: String, +directory: String) -> IO(Unit):
  do IO<Unit>:
    intent : String <- IO.try(String, DB.Sql.query_bound(db, binding,
      "UPDATE semantic_roles SET release_intent_json=coalesce(release_intent_json,json_object('cause',"
      ++ "CASE role WHEN 'target' THEN 'targetExited' ELSE 'adapterClosed' END,"
      ++ "'exitEvidence',json(exit_evidence_json))) WHERE keeper_path=" ++ ContextCommands.q(directory)
      ++ " AND ((role='target' AND phase='exited') OR (role='adapter' AND phase='closed'));"))
    requested : String <- IO.try(String, DB.Sql.query_bound(db, binding,
      "SELECT release_intent_json IS NOT NULL AND cleanup_phase<>'released' AND phase IN ('exited','closed')"
      ++ " AND coalesce(json_extract(capture_json,'$.stdout.phase'),'')<>'captured'"
      ++ " FROM semantic_roles WHERE keeper_path=" ++ ContextCommands.q(directory) ++ ";"))
    Bool.pick(IO(Unit), String.eq(Tx.trim_nl(requested), "1"),
      do IO<Unit>:
        row : String <- IO.try(String, DB.Sql.query_bound(db, binding,
          "SELECT p.role,hex(q.artifact_path) FROM semantic_roles p JOIN semantic_queries q ON q.id=p.query_id"
          ++ " WHERE q.admission_decision='accepted' AND p.keeper_path=" ++ ContextCommands.q(directory) ++ ";"))
        runtime_capture_role(db, binding, directory,
          ContextText.split_tabs(Tx.trim_nl(row))),
      IO.pure(Unit, Unit{}))

def runtime_finish_role(+db: String, +binding: String, +directory: String,
    +handle: U32) -> IO(Unit):
  do IO<Unit>:
    captured : String <- IO.try(String, DB.Sql.query_bound(db, binding,
      "SELECT release_intent_json IS NOT NULL AND cleanup_phase<>'released' AND phase IN ('exited','closed')"
      ++ " AND json_extract(capture_json,'$.stdout.phase')='captured'"
      ++ " FROM semantic_roles WHERE keeper_path=" ++ ContextCommands.q(directory) ++ ";"))
    Bool.pick(IO(Unit), String.eq(Tx.trim_nl(captured), "1"),
      do IO<Unit>:
        released : Result<&1,&1,U32 & String,Unit> <- Process.ProcessChild.release(handle)
        runtime_cleanup_released(db, binding, directory, handle, released),
      IO.pure(Unit, Unit{}))

# The native wait supplies the raw status. Signal acceptance alone records no exit.
def runtime_target_status(+db: String, +binding: String, +launch_query: String,
    +target_dir: String, +status: String) -> IO(String):
  do IO<String>:
    +fields : String <- runtime_exit_fields(status, Tx.split_spaces(status))
    +phase : String = Bool.pick(String, String.eq(fields, "\"code\":null,\"signal\":null"), "unknown", "exited")
    +evidence : String = "{\"nativeStatus\":" ++ J.json_text(J.Jstr{status})
      ++ "," ++ fields ++ "}"
    saved : String <- IO.try(String, DB.Sql.query_bound(db, binding,
      "BEGIN IMMEDIATE;UPDATE semantic_roles SET phase=" ++ ContextCommands.q(phase) ++ ",exit_evidence_json="
      ++ ContextCommands.q(evidence) ++ " WHERE query_id=" ++ ContextCommands.q(launch_query)
      ++ " AND role='target' AND keeper_path=" ++ ContextCommands.q(target_dir) ++ ";"
      ++ "UPDATE semantic_runtimes SET state=" ++ ContextCommands.q(phase) ++ ",outcome_json="
      ++ ContextCommands.q(evidence) ++ " WHERE launch_query=" ++ ContextCommands.q(launch_query)
      ++ ";INSERT INTO messages(id,sender,recipient,kind,body) SELECT "
      ++ ContextCommands.q("context-runtime:" ++ launch_query ++ ":target-status:" ++ status)
      ++ ",owner,owner,'report'," ++ ContextCommands.q(evidence)
      ++ " FROM semantic_runtimes WHERE launch_query=" ++ ContextCommands.q(launch_query)
      ++ ContextCommands.message_upsert() ++ "COMMIT;"))
    notified : Unit <- runtime_notify_commit(db, binding)
    IO.pure(String, fields)

def runtime_release_waited(+db: String, +binding: String, +launch_query: String,
    +bridge: RuntimeBridge, +query: String,
    waited: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match bridge:
    case RuntimeBridge{target, adapter, +target_dir, +adapter_dir}:
      match waited:
        case Fail{(code, detail)}:
          IO.try(Unit, Process.ProcessChild.control_write(adapter_dir,
            runtime_release_error(query, code, detail) ++ "\n"))
        case Done{+status}:
          do IO<Unit>:
            +fields : String <- runtime_target_status(db, binding, launch_query, target_dir, status)
            Bool.pick(IO(Unit), String.eq(fields, "\"code\":null,\"signal\":null"),
              IO.try(Unit, Process.ProcessChild.control_write(adapter_dir,
                runtime_release_error(query, 3, status) ++ "\n")),
              do IO<Unit>:
                replied : Unit <- IO.try(Unit, Process.ProcessChild.control_write(adapter_dir,
                  runtime_release_response(query, fields, status) ++ "\n"))
                IO.try(Unit, Process.ProcessChild.control_write(adapter_dir,
                  runtime_target_exit_response(fields, status) ++ "\n")))

def runtime_release_signaled(+db: String, +binding: String, +launch_query: String,
    +bridge: RuntimeBridge, +query: String,
    signaled: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match signaled:
    case Fail{(code, detail)}:
      runtime_release_waited(db, binding, launch_query, bridge, query, Fail{(code, detail)})
    case Done{value}:
      match bridge:
        case RuntimeBridge{+target, adapter, target_dir, adapter_dir}:
          do IO<Unit>:
            waited : Result<&1,&1,U32 & String,String> <- Process.ProcessChild.wait(target)
            runtime_release_waited(db, binding, launch_query, bridge, query, waited)

def runtime_retained_release(+db: String, +binding: String, +launch_query: String,
    +bridge: RuntimeBridge, +query: String, +signal: String) -> IO(Unit):
  match bridge:
    case RuntimeBridge{target, adapter, +target_dir, adapter_dir}:
      do IO<Unit>:
        signal_number : U32 <- runtime_signal(signal)
        signaled : Result<&1,&1,U32 & String,Unit> <- Process.ProcessChild.control_signal(target_dir, signal_number)
        runtime_release_signaled(db, binding, launch_query, bridge, query, signaled)

def runtime_target_wait_handle(+db: String, +binding: String, +launch_query: String,
    +target: U32, +target_dir: String, +adapter_dir: String) -> IO(Unit):
  do IO<Unit>:
    +status : String <- IO.try(String, Process.ProcessChild.wait(target))
    +fields : String <- runtime_target_status(db, binding, launch_query, target_dir, status)
    delivered : Result<&1,&1,U32 & String,Unit> <- Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),
      String.eq(fields, "\"code\":null,\"signal\":null"),
      IO.pure(Result<&1,&1,U32 & String,Unit>, Done{Unit{}}),
      Process.ProcessChild.control_write(adapter_dir, runtime_target_exit_response(fields, status) ++ "\n"))
    delivery_error : String = runtime_control_error(delivered)
    saved : String <- IO.try(String, DB.Sql.query_bound(db, binding,
      "UPDATE semantic_roles SET capture_json=json_set(coalesce(capture_json,'{}'),'$.targetExitDeliveryError',json("
      ++ ContextCommands.q(delivery_error) ++ ")) WHERE keeper_path=" ++ ContextCommands.q(target_dir) ++ ";"))
    IO.pure(Unit, Unit{})

# The background observer retains this wait until the target supplies its status.
def runtime_target_wait(+db: String, +binding: String, +launch_query: String,
    bridge: RuntimeBridge) -> IO(Unit):
  match bridge:
    case RuntimeBridge{target, adapter, target_dir, adapter_dir}:
      runtime_target_wait_handle(db, binding, launch_query, target, target_dir, adapter_dir)

def runtime_retained_invoke(+bridge: RuntimeBridge, +invocation_text: String) -> IO(Unit):
  match bridge:
    case RuntimeBridge{target, adapter, target_dir, +adapter_dir}:
      IO.try(Unit, Process.ProcessChild.control_write(adapter_dir, invocation_text ++ "\n"))

def runtime_frame_publish(+db: String, +binding: String, +owner: String,
    +query: String, +frame: String, +complete: Bool) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String, DB.Sql.query_bound(db, binding,
      ContextStore.state_publish_managed_sql(query, owner,
        Bool.pick(String, complete, "complete", "failed"),
        Bool.pick(String, complete, frame, SNil{}),
        Bool.pick(String, complete, SNil{}, frame))))
    cursor : String <- IO.try(String, DB.Sql.query_bound(db, binding,
      "SELECT CAST(coalesce(max(change_id),0) AS TEXT) FROM native_changes;"))
    published : Unit <- IO.try(Unit, Custody.Instance.publish_commit(db, Tx.trim_nl(cursor)))
    IO.pure(Unit, Unit{})

type RuntimeRead is Data:
  RuntimeReadFrame{frame: String, kind: String, query: String, signal: String, sequence: String}
  RuntimeReadFailed{frame: String}

def runtime_meta_text(field: Codec.FieldText) -> IO(String):
  match field:
    case Codec.FtText{value}: IO.pure(String, value)
    case Codec.FtBad{condition}: IO.die(String, 3, "runtimeAdapterField:" ++ condition)

def runtime_frame_meta(+frame: String, fields: List<String>) -> IO(RuntimeRead):
  match fields:
    case +kind_hex <> +query_hex <> +signal_hex <> +sequence_hex <> Nil{}:
      do IO<RuntimeRead>:
        kind : String <- runtime_meta_text(Codec.text_field(kind_hex))
        query : String <- runtime_meta_text(Codec.text_field(query_hex))
        signal : String <- runtime_meta_text(Codec.text_field(signal_hex))
        sequence : String <- runtime_meta_text(Codec.text_field(sequence_hex))
        IO.pure(RuntimeRead, RuntimeReadFrame{frame, kind, query, signal, sequence})
    case other: IO.pure(RuntimeRead, RuntimeReadFailed{frame})

def runtime_frame_meta_read(+db: String, +binding: String, +frame: String) -> IO(RuntimeRead):
  do IO<RuntimeRead>:
    fields : String <- IO.try(String, DB.Sql.query_bound(db, binding,
      "WITH native_frame(value) AS (VALUES(" ++ ContextCommands.q(frame) ++ ")) SELECT "
      ++ "hex(coalesce(json_extract(value,'$.type'),'')),"
      ++ "hex(coalesce(json_extract(value,'$.query'),'')),"
      ++ "hex(coalesce(json_extract(value,'$.signal'),'')),"
      ++ "hex(coalesce(json_extract(value,'$.sequence'),'')) FROM native_frame;"))
    runtime_frame_meta(frame, ContextText.split_tabs(Tx.trim_nl(fields)))

def runtime_frame_progress(+db: String, +binding: String, +owner: String,
    +launch_query: String, +query: String, +sequence: String, +frame: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String, DB.Sql.query_bound(db, binding,
      ContextStore.progress_publish_sql(
        Bool.pick(String, String.is_empty(query), launch_query, query), owner,
        frame, "context-runtime:" ++ launch_query ++ ":adapter:0:" ++ sequence, frame)))
    cursor : String <- IO.try(String, DB.Sql.query_bound(db, binding,
      "SELECT CAST(coalesce(max(change_id),0) AS TEXT) FROM native_changes;"))
    published : Unit <- IO.try(Unit, Custody.Instance.publish_commit(db, Tx.trim_nl(cursor)))
    IO.pure(Unit, Unit{})

def runtime_text(value: Context.OptText) -> String:
  match value:
    case Context.Absent{}: SNil{}
    case Context.Present{text}: text

def runtime_adapter_checkpoint(adapter: U32, frame: String) -> IO(Unit):
  IO.try(Unit, Custody.Instance.commit(adapter, 1, frame))

def runtime_checkpoint(bridge: RuntimeBridge, frame: String) -> IO(Unit):
  match bridge:
    case RuntimeBridge{target, +adapter, target_dir, adapter_dir}:
      runtime_adapter_checkpoint(adapter, frame)

def runtime_query_present(+db: String, +binding: String, +owner: String,
    +launch_query: String, +query: String) -> IO(Bool):
  do IO<Bool>:
    row : String <- IO.try(String, DB.Sql.query_bound(db, binding,
      "SELECT EXISTS(SELECT 1 FROM semantic_queries WHERE id=" ++ ContextCommands.q(query)
      ++ " AND owner=" ++ ContextCommands.q(owner) ++ " AND runtime_id="
      ++ ContextCommands.q("rt:" ++ launch_query) ++ ");"))
    IO.pure(Bool, String.eq(Tx.trim_nl(row), "1"))

def runtime_release_complete(+db: String, +binding: String, +query: String,
    +launch_query: String, +adapter: U32) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String, DB.Sql.query_bound(db, binding,
      "UPDATE semantic_roles SET release_intent_json=(SELECT request_json FROM semantic_queries WHERE id="
      ++ ContextCommands.q(query) ++ "),cleanup_phase='requested' WHERE query_id="
      ++ ContextCommands.q(launch_query) ++ " AND role IN ('target','adapter');"))
    IO.try(Unit, Process.ProcessChild.close_stdin(adapter))

def runtime_store_event(+db: String, +binding: String, +owner: String,
    +launch_query: String, +adapter: U32, +frame: String,
    +query: String, +sequence: String, +frame_type: String, +payload: Codec.RawValue) -> IO(Unit):
  do IO<Unit>:
    terminal : Bool = Bool.or(String.eq(frame_type, "failed"),
      Bool.and(String.eq(frame_type, "event"),
        String.eq(Codec.raw_field_text(payload, "schema"), "baton2.context.runtime.result.v1")))
    associated : Bool <- Bool.pick(IO(Bool), String.is_empty(query),
      IO.pure(Bool, Bool.and(Bool.not(terminal), String.eq(frame_type, "state"))),
      runtime_query_present(db, binding, owner, launch_query, query))
    saved : Unit <- Bool.pick(IO(Unit), associated,
      Bool.pick(IO(Unit), terminal,
        runtime_frame_publish(db, binding, owner, query, frame, String.eq(frame_type, "event")),
        runtime_frame_progress(db, binding, owner, launch_query, query, sequence, frame)),
      IO.die(Unit, 3, "runtimeAdapterQueryMismatch"))
    checkpointed : Unit <- runtime_adapter_checkpoint(adapter, frame)
    Bool.pick(IO(Unit), Bool.and(String.eq(frame_type, "event"),
      String.eq(Codec.raw_field_text(payload, "intent"), "release")),
      runtime_release_complete(db, binding, query, launch_query, adapter),
      IO.pure(Unit, Unit{}))

def runtime_common_event(+db: String, +binding: String, +owner: String,
    +launch_query: String, +adapter: U32, +frame: String,
    event: Wire.WireRead) -> IO(Unit):
  match event:
    case Wire.WrRefused{condition}: IO.die(Unit, 3, "runtimeAdapterFrame:" ++ condition)
    case Wire.WrInvocation{version, query, owner, binding, request, inputs, plan, role, incarnation}:
      IO.die(Unit, 3, "runtimeAdapterReturnedInvocation")
    case Wire.WrEvent{version, +query, +frame_owner, producer, +runtime, +role, +incarnation,
                     +sequence, +frame_type, +payload}:
      Bool.pick(IO(Unit),
        Bool.and(String.eq(runtime_text(frame_owner), owner),
        Bool.and(String.eq(runtime_text(runtime), "rt:" ++ launch_query),
        Bool.and(String.eq(runtime_text(role), "adapter"),
          String.eq(runtime_text(incarnation), "0")))),
        runtime_store_event(db, binding, owner, launch_query, adapter, frame,
          runtime_text(query), sequence, frame_type, payload),
        IO.die(Unit, 3, "runtimeAdapterIdentityMismatch"))

def runtime_common_read(+db: String, +binding: String, +owner: String,
    +launch_query: String, +adapter: U32, +frame: String) -> IO(Unit):
  do IO<Unit>:
    rows : String <- IO.try(String, DB.Sql.query_bound(db, binding, Req.json_tree_sql(frame)))
    runtime_common_event(db, binding, owner, launch_query, adapter, frame,
      Wire.wire_read(Req.parse_rows(rows)))

def runtime_adapter_closed(+db: String, +binding: String, +owner: String,
    +launch_query: String, bridge: RuntimeBridge) -> IO(Unit):
  match bridge:
    case RuntimeBridge{target, +adapter, target_dir, +adapter_dir}:
      do IO<Unit>:
        +status : String <- IO.try(String, Process.ProcessChild.wait(adapter))
        +fields : String <- runtime_exit_fields(status, Tx.split_spaces(status))
        phase : String = Bool.pick(String, String.eq(fields, "\"code\":null,\"signal\":null"), "unknown", "closed")
        +evidence : String = "{\"condition\":\"runtimeAdapterClosed\",\"nativeStatus\":"
          ++ J.json_text(J.Jstr{status}) ++ "," ++ fields ++ "}"
        saved : String <- IO.try(String, DB.Sql.query_bound(db, binding,
          "BEGIN IMMEDIATE;UPDATE semantic_roles SET phase=" ++ ContextCommands.q(phase) ++ ",exit_evidence_json="
          ++ ContextCommands.q(evidence) ++ " WHERE query_id=" ++ ContextCommands.q(launch_query)
          ++ " AND role='adapter' AND keeper_path=" ++ ContextCommands.q(adapter_dir) ++ ";"
          ++ "UPDATE semantic_queries SET state='failed',error_json=" ++ ContextCommands.q(evidence)
          ++ " WHERE owner=" ++ ContextCommands.q(owner) ++ " AND runtime_id="
          ++ ContextCommands.q("rt:" ++ launch_query) ++ " AND state IN ('accepted','running');"
          ++ ContextStore.owner_notice_sql("context-runtime:" ++ launch_query ++ ":adapter:closed:" ++ status, owner, evidence)
          ++ "COMMIT;"))
        runtime_notify_commit(db, binding)

def runtime_keeper_release(+db: String, +binding: String, +owner: String,
    +launch_query: String, +bridge: RuntimeBridge, +frame: String,
    +query: String, +signal: String) -> IO(Unit):
  do IO<Unit>:
    identity : String <- IO.try(String, DB.Sql.query_bound(db, binding,
      "WITH native_frame(value) AS (VALUES(" ++ ContextCommands.q(frame) ++ ")) SELECT "
      ++ "json_extract(value,'$.runtime')=" ++ ContextCommands.q("rt:" ++ launch_query)
      ++ " AND json_extract(value,'$.incarnation')='0' FROM native_frame;"))
    associated : Bool <- runtime_query_present(db, binding, owner, launch_query, query)
    released : Unit <- Bool.pick(IO(Unit), Bool.and(String.eq(Tx.trim_nl(identity), "1"), associated),
      runtime_retained_release(db, binding, launch_query, bridge, query, signal),
      IO.die(Unit, 3, "runtimeKeeperReleaseIdentityMismatch"))
    runtime_checkpoint(bridge, frame)

type RuntimeObserve is Data:
  RuntimeObserveNext{}
  RuntimeObserveLine{line: Maybe<String>}
  RuntimeObserveFrame{frame: RuntimeRead}

# One observer drains the retained adapter across all query terminals.
@unsafe
def runtime_observe_step(+db: String, +binding: String, +owner: String,
    +launch_query: String, +bridge: RuntimeBridge, step: RuntimeObserve) -> IO(Unit):
  match step:
    case RuntimeObserveNext{}:
      match bridge:
        case RuntimeBridge{target, +adapter, target_dir, adapter_dir}:
          do IO<Unit>:
            line : Maybe<String> <- IO.try(Maybe<String>, Process.ProcessChild.read_line(adapter))
            runtime_observe_step(db, binding, owner, launch_query, bridge, RuntimeObserveLine{line})
    case RuntimeObserveLine{line}:
      match line:
        case None{}: runtime_adapter_closed(db, binding, owner, launch_query, bridge)
        case Some{+frame}:
          do IO<Unit>:
            parsed : RuntimeRead <- runtime_frame_meta_read(db, binding, frame)
            runtime_observe_step(db, binding, owner, launch_query, bridge, RuntimeObserveFrame{parsed})
    case RuntimeObserveFrame{read}:
      match read:
        case RuntimeReadFailed{frame}: IO.die(Unit, 3, "runtimeAdapterFrameMalformed:" ++ frame)
        case RuntimeReadFrame{+frame, +kind, +query, +signal, sequence}:
          match bridge:
            case RuntimeBridge{target, +adapter, target_dir, adapter_dir}:
              do IO<Unit>:
                handled : Unit <- Bool.pick(IO(Unit), String.eq(kind, "keeperRelease"),
                  runtime_keeper_release(db, binding, owner, launch_query, bridge, frame, query, signal),
                  runtime_common_read(db, binding, owner, launch_query, adapter, frame))
                runtime_observe_step(db, binding, owner, launch_query, bridge, RuntimeObserveNext{})

def runtime_observe(db: String, binding: String, owner: String,
    launch_query: String, bridge: RuntimeBridge) -> IO(Unit):
  runtime_observe_step(db, binding, owner, launch_query, bridge, RuntimeObserveNext{})

def runtime_run_settled(+db: String, +binding: String, bridge: RuntimeBridge) -> IO(Unit):
  match bridge:
    case RuntimeBridge{+target, +adapter, +target_dir, +adapter_dir}:
      do IO<Unit>:
        target_captured : Unit <- runtime_prepare_cleanup(db, binding, target_dir)
        adapter_captured : Unit <- runtime_prepare_cleanup(db, binding, adapter_dir)
        target_done : Unit <- runtime_finish_role(db, binding, target_dir, target)
        runtime_finish_role(db, binding, adapter_dir, adapter)

def runtime_run_finished(+db: String, +binding: String, +bridge: RuntimeBridge,
    target_wait: Chan(Unit)) -> IO(Unit):
  match bridge:
    case RuntimeBridge{target, adapter, +target_dir, +adapter_dir}:
      do IO<Unit>:
        waited : Unit <- IO.join(Unit, target_wait)
        known : String <- IO.try(String, DB.Sql.query_bound(db, binding,
          "SELECT EXISTS(SELECT 1 FROM semantic_roles WHERE keeper_path=" ++ ContextCommands.q(target_dir)
          ++ " AND role='target' AND phase='exited') AND EXISTS(SELECT 1 FROM semantic_roles WHERE keeper_path="
          ++ ContextCommands.q(adapter_dir) ++ " AND role='adapter' AND phase='closed');"))
        Bool.pick(IO(Unit), String.eq(Tx.trim_nl(known), "1"),
          runtime_run_settled(db, binding, bridge),
          do IO<Unit>:
            evidence : String <- IO.try(String, DB.Sql.query_bound(db, binding,
              "SELECT json_object('target',json((SELECT exit_evidence_json FROM semantic_roles WHERE keeper_path="
              ++ ContextCommands.q(target_dir) ++ ")),'adapter',json((SELECT exit_evidence_json FROM semantic_roles WHERE keeper_path="
              ++ ContextCommands.q(adapter_dir) ++ ")));"))
            IO.die(Unit, 3, "runtimeNativeStatusUnavailable:" ++ Tx.trim_nl(evidence)))

# The public recovery CLI observes in the background after the launch CLI returns.
def runtime_run(+db: String, +binding: String, +owner: String,
    +launch_query: String, +bridge: RuntimeBridge) -> IO(Unit):
  match bridge:
    case RuntimeBridge{target, adapter, +target_dir, adapter_dir}:
      do IO<Unit>:
        target_wait : Chan(Unit) <- IO.fork(Unit, runtime_target_wait(db, binding, launch_query, bridge))
        observed : Unit <- runtime_observe(db, binding, owner, launch_query, bridge)
        runtime_run_finished(db, binding, bridge, target_wait)

def runtime_recovery_job(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Done{job}: "{\"job\":" ++ job ++ "}"
    case Fail{error}: "{\"jobError\":" ++ runtime_control_error(Fail{error}) ++ "}"

# This callback ends the recovery CLI. Its exit closes any partial attachment,
# and the disconnected keeper invokes its stored recovery command.
def runtime_recover_refused(+db: String, +target_dir: String, +adapter_dir: String,
    +role: String, +partial_target: Bool, +code: U32, +detail: String) -> IO(Unit):
  do IO<Unit>:
    target_job : Result<&1,&1,U32 & String,String> <- Custody.Instance.job(db, target_dir)
    adapter_job : Result<&1,&1,U32 & String,String> <- Custody.Instance.job(db, adapter_dir)
    reported : Unit <- IO.write("{\"condition\":\"runtimeObserverAttachRefused\",\"role\":"
      ++ J.json_text(J.Jstr{role}) ++ ",\"partialTargetAttached\":"
      ++ Bool.pick(String, partial_target, "true", "false")
      ++ ",\"error\":" ++ runtime_control_error(Fail{(code, detail)})
      ++ ",\"target\":" ++ runtime_recovery_job(target_job)
      ++ ",\"adapter\":" ++ runtime_recovery_job(adapter_job) ++ "}\n")
    # EBUSY is the public attach refusal for an existing observer.
    Bool.pick(IO(Unit), U32.is_eq(code, 16), IO.pure(Unit, Unit{}),
      IO.die(Unit, code, detail))

def runtime_recover_adapter(+db: String, +binding: String, +owner: String,
    +launch_query: String, +target_dir: String, +adapter_dir: String,
    target: U32, attached: Result<&1,&1,U32 & String,U32>) -> IO(Unit):
  match attached:
    case Fail{(code, detail)}:
      runtime_recover_refused(db, target_dir, adapter_dir, "adapter", True{}, code, detail)
    case Done{+adapter}:
      do IO<Unit>:
        restored : String <- IO.try(String, Custody.Instance.restore(adapter, 1))
        runtime_run(db, binding, owner, launch_query,
          RuntimeBridge{target, adapter, target_dir, adapter_dir})

def runtime_recover_target(+db: String, +binding: String, +owner: String,
    +launch_query: String, +target_dir: String, +adapter_dir: String,
    attached: Result<&1,&1,U32 & String,U32>) -> IO(Unit):
  match attached:
    case Fail{(code, detail)}:
      runtime_recover_refused(db, target_dir, adapter_dir, "target", False{}, code, detail)
    case Done{target}:
      do IO<Unit>:
        adapter : Result<&1,&1,U32 & String,U32> <- Custody.Instance.attach(db, adapter_dir)
        runtime_recover_adapter(db, binding, owner, launch_query,
          target_dir, adapter_dir, target, adapter)

def runtime_recover_remaining_attached(+db: String, +binding: String,
    +target_dir: String, +adapter_dir: String, +role: String, +directory: String,
    attached: Result<&1,&1,U32 & String,U32>) -> IO(Unit):
  match attached:
    case Fail{(code, detail)}:
      runtime_recover_refused(db, target_dir, adapter_dir, role, False{}, code, detail)
    case Done{handle}:
      do IO<Unit>:
        prepared : Unit <- runtime_prepare_cleanup(db, binding, directory)
        runtime_finish_role(db, binding, directory, handle)

def runtime_recover_remaining(+db: String, +binding: String,
    +target_dir: String, +adapter_dir: String, +role: String, +directory: String) -> IO(Unit):
  do IO<Unit>:
    attached : Result<&1,&1,U32 & String,U32> <- Custody.Instance.attach(db, directory)
    runtime_recover_remaining_attached(db, binding, target_dir, adapter_dir,
      role, directory, attached)

# A released role has completed spool capture and resource cleanup.
def runtime_recover_cleanup(+db: String, +binding: String, +owner: String,
    +launch_query: String, +target_dir: String, +adapter_dir: String,
    phases: List<String>) -> IO(Unit):
  match phases:
    case "0" <> "0" <> Nil{}:
      do IO<Unit>:
        target : Result<&1,&1,U32 & String,U32> <- Custody.Instance.attach(db, target_dir)
        runtime_recover_target(db, binding, owner, launch_query,
          target_dir, adapter_dir, target)
    case "1" <> "0" <> Nil{}:
      runtime_recover_remaining(db, binding, target_dir, adapter_dir, "adapter", adapter_dir)
    case "0" <> "1" <> Nil{}:
      runtime_recover_remaining(db, binding, target_dir, adapter_dir, "target", target_dir)
    case "1" <> "1" <> Nil{}:
      IO.write("{\"query\":" ++ J.json_text(J.Jstr{launch_query})
        ++ ",\"targetCleanup\":\"released\",\"adapterCleanup\":\"released\"}\n")
    case other: IO.die(Unit, 3, "runtimeCleanupRolesMissing")

def runtime_recover_acknowledged(+db: String, +binding: String, +directory: String) -> IO(Unit):
  do IO<Unit>:
    recorded : String <- IO.try(String, DB.Sql.query_bound(db, binding,
      "SELECT cleanup_phase<>'released' AND json_extract(release_intent_json,'$.cleanupAcknowledged')=1"
      ++ " AND phase IN ('exited','closed') AND json_extract(capture_json,'$.stdout.phase')='captured'"
      ++ " FROM semantic_roles WHERE keeper_path=" ++ ContextCommands.q(directory) ++ ";"))
    Bool.pick(IO(Unit), String.eq(Tx.trim_nl(recorded), "1"),
      do IO<Unit>:
        job : String <- IO.try(String, Custody.Instance.job(db, directory))
        saved : String <- IO.try(String, DB.Sql.query_bound(db, binding,
          "WITH retained_job(value) AS (VALUES(" ++ ContextCommands.q(job)
          ++ ")) UPDATE semantic_roles SET cleanup_phase='released',release_intent_json=json_set(release_intent_json,"
          ++ "'$.cleanupRecovery','acknowledged-no-observer','$.cleanupRecoveryJob',json((SELECT value FROM retained_job)))"
          ++ " WHERE keeper_path=" ++ ContextCommands.q(directory)
          ++ " AND (SELECT json_extract(value,'$.status_known')=1 AND json_extract(value,'$.observing')=0 FROM retained_job);"))
        IO.pure(Unit, Unit{}),
      IO.pure(Unit, Unit{}))

def runtime_recover_owned(+db: String, +binding: String, +owner: String,
    +launch_query: String, +target_dir: String, +adapter_dir: String,
    owned: Bool) -> IO(Unit):
  match owned:
    case False{}: IO.die(Unit, 3, "runtimeRetainedRolesMismatch")
    case True{}:
      do IO<Unit>:
        target_ack : Unit <- runtime_recover_acknowledged(db, binding, target_dir)
        adapter_ack : Unit <- runtime_recover_acknowledged(db, binding, adapter_dir)
        phases : String <- IO.try(String, DB.Sql.query_bound(db, binding,
          "SELECT t.cleanup_phase='released',a.cleanup_phase='released' FROM semantic_roles t"
          ++ " JOIN semantic_roles a ON a.query_id=t.query_id AND a.role='adapter' AND a.incarnation='0'"
          ++ " WHERE t.query_id=" ++ ContextCommands.q(launch_query)
          ++ " AND t.role='target' AND t.incarnation='0' AND t.keeper_path=" ++ ContextCommands.q(target_dir)
          ++ " AND a.keeper_path=" ++ ContextCommands.q(adapter_dir) ++ ";"))
        runtime_recover_cleanup(db, binding, owner, launch_query,
          target_dir, adapter_dir, ContextText.split_tabs(Tx.trim_nl(phases)))

# Recovery observes the retained launch and roles; it submits no replacement query.
def runtime_recover(+db: String, +owner: String, +launch_query: String,
    +target_dir: String, +adapter_dir: String) -> IO(Unit):
  do IO<Unit>:
    +database : String <- IO.try(String, Host.SessionLock.canonical(db))
    +binding : String <- IO.try(String, DB.Sql.binding(database))
    row : String <- IO.try(String, DB.Sql.query_bound(database, binding,
      "SELECT EXISTS(SELECT 1 FROM semantic_runtimes r JOIN semantic_queries q ON q.id=r.launch_query"
      ++ " JOIN semantic_roles t ON t.query_id=q.id AND t.role='target' AND t.incarnation='0'"
      ++ " JOIN semantic_roles a ON a.query_id=q.id AND a.role='adapter' AND a.incarnation='0'"
      ++ " WHERE r.id=" ++ ContextCommands.q("rt:" ++ launch_query)
      ++ " AND r.launch_query=" ++ ContextCommands.q(launch_query)
      ++ " AND r.owner=" ++ ContextCommands.q(owner) ++ " AND q.owner=r.owner"
      ++ " AND t.keeper_path=" ++ ContextCommands.q(target_dir)
      ++ " AND a.keeper_path=" ++ ContextCommands.q(adapter_dir)
      ++ " AND t.database_binding_json=" ++ ContextCommands.q(binding)
      ++ " AND a.database_binding_json=" ++ ContextCommands.q(binding) ++ ");"))
    runtime_recover_owned(database, binding, owner, launch_query, target_dir, adapter_dir,
      String.eq(Tx.trim_nl(row), "1"))

def runtime_submit_result(+db: String, +binding: String, +owner: String,
    +query: String, result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Done{value}: IO.pure(Unit, Unit{})
    case Fail{(+code, +detail)}:
      do IO<Unit>:
        error : String = "{\"condition\":\"runtimeAdapterWriteFailed\",\"code\":"
          ++ U32.show(code) ++ ",\"detail\":" ++ J.json_text(J.Jstr{detail}) ++ "}"
        saved : Unit <- runtime_frame_publish(db, binding, owner, query, error, False{})
        IO.die(Unit, code, detail)

def runtime_submit_directory(+db: String, +binding: String, +owner: String,
    +query: String, +invocation_text: String, directory: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,Unit> <- Process.ProcessChild.control_write(directory, invocation_text ++ "\n")
    runtime_submit_result(db, binding, owner, query, result)

def runtime_submit_rows(+db: String, +binding: String, +owner: String,
    +query: String, +invocation_text: String, rows: List<String>) -> IO(Unit):
  match rows:
    case +directory_hex <> Nil{}:
      do IO<Unit>:
        directory : String <- runtime_meta_text(Codec.text_field(directory_hex))
        runtime_submit_directory(db, binding, owner, query, invocation_text, directory)
    case other: IO.die(Unit, 3, "runtimeOwnedAdapterUnavailable")

# Core has admitted this query and retained its runtime association before submission.
def runtime_submit(+db: String, +binding: String, +owner: String, +query: String,
    +invocation_text: String) -> IO(Unit):
  do IO<Unit>:
    rows : String <- IO.try(String, DB.Sql.query_bound(db, binding,
      "WITH invocation(value) AS (VALUES(" ++ ContextCommands.q(invocation_text) ++ "))"
      ++ " SELECT hex(a.keeper_path) FROM invocation,semantic_queries q"
      ++ " JOIN semantic_runtimes r ON r.id=q.runtime_id AND r.owner=q.owner"
      ++ " JOIN semantic_roles a ON a.query_id=r.launch_query AND a.role='adapter' AND a.incarnation='0'"
      ++ " WHERE q.id=" ++ ContextCommands.q(query) ++ " AND q.owner=" ++ ContextCommands.q(owner)
      ++ " AND q.state IN ('accepted','running') AND q.admission_decision='accepted'"
      ++ " AND json_extract(value,'$.query')=q.id AND json_extract(value,'$.owner')=q.owner"
      ++ " AND json_extract(value,'$.request.subject.session')=r.id"
      ++ " AND a.database_binding_json=" ++ ContextCommands.q(binding) ++ ";"))
    runtime_submit_rows(db, binding, owner, query, invocation_text, Tx.split_lines(rows))

type RuntimeStopRole is Data:
  RuntimeStopRole{query: String, role: String, directory: String, signal: U32, live: Bool}

def runtime_stop_number(query: String, role: String, directory: String, live: Bool,
    number: Maybe<&2,U32>) -> IO(RuntimeStopRole):
  match number:
    case None{}: IO.die(RuntimeStopRole, 3, "runtimeStopSignalMalformed")
    case Some{signal}: IO.pure(RuntimeStopRole, RuntimeStopRole{query, role, directory, signal, live})

def runtime_stop_role(fields: List<String>) -> IO(RuntimeStopRole):
  match fields:
    case +query_hex <> +role_hex <> +directory_hex <> +signal <> +live <> Nil{}:
      do IO<RuntimeStopRole>:
        query : String <- runtime_meta_text(Codec.text_field(query_hex))
        role : String <- runtime_meta_text(Codec.text_field(role_hex))
        directory : String <- runtime_meta_text(Codec.text_field(directory_hex))
        runtime_stop_number(query, role, directory, String.eq(live, "1"), U32.read(signal))
    case other: IO.die(RuntimeStopRole, 3, "runtimeStopRoleMalformed")

def runtime_stop_send(+db: String, +binding: String, item: RuntimeStopRole) -> IO(Unit):
  match item:
    case RuntimeStopRole{+query, +role, +directory, +signal, live}:
      do IO<Unit>:
        result : Result<&1,&1,U32 & String,Unit> <- Bool.pick(IO(Result<&1,&1,U32 & String,Unit>), live,
          Process.ProcessChild.control_signal(directory, signal),
          IO.pure(Result<&1,&1,U32 & String,Unit>, Done{Unit{}}))
        error : String = runtime_control_error(result)
        saved : String <- IO.try(String, DB.Sql.query_bound(db, binding,
          "UPDATE semantic_roles SET release_intent_json=json_set(release_intent_json,'$.controlError',json("
          ++ ContextCommands.q(error) ++ ")) WHERE query_id=" ++ ContextCommands.q(query)
          ++ " AND role=" ++ ContextCommands.q(role) ++ " AND keeper_path=" ++ ContextCommands.q(directory) ++ ";"))
        IO.pure(Unit, Unit{})

@unsafe
def runtime_stop_send_rows(+db: String, +binding: String, rows: List<String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case +row <> rest:
      do IO<Unit>:
        item : RuntimeStopRole <- runtime_stop_role(ContextText.split_tabs(row))
        sent : Unit <- runtime_stop_send(db, binding, item)
        runtime_stop_send_rows(db, binding, rest)

# The session stop is already admitted by the coordinator before this callback.
def runtime_stop_owner(+db: String, +owner: String) -> IO(Unit):
  do IO<Unit>:
    +database : String <- IO.try(String, Host.SessionLock.canonical(db))
    +binding : String <- IO.try(String, DB.Sql.binding(database))
    saved : String <- IO.try(String, DB.Sql.query_bound(database, binding,
      "BEGIN IMMEDIATE;" ++ ContextStore.schema()
      ++ "UPDATE semantic_queries SET cleanup_intent_json=(SELECT json_object('stopId',id,'reason',reason,'signal',signal) FROM session_stops WHERE session="
      ++ ContextCommands.q(owner) ++ "),error_json=CASE WHEN state IN ('accepted','running') THEN json_object('condition','ownerStopped','stop',json((SELECT json_object('id',id,'reason',reason,'signal',signal) FROM session_stops WHERE session="
      ++ ContextCommands.q(owner) ++ "))) ELSE error_json END,state=CASE WHEN state IN ('accepted','running') THEN 'interrupted' ELSE state END"
      ++ " WHERE owner=" ++ ContextCommands.q(owner) ++ " AND runtime_id IN (SELECT id FROM semantic_runtimes WHERE owner="
      ++ ContextCommands.q(owner) ++ ") AND EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ ContextCommands.q(owner) ++ ");"
      ++ "UPDATE semantic_roles SET release_intent_json=(SELECT json_object('stopId',id,'reason',reason,'signal',signal) FROM session_stops WHERE session="
      ++ ContextCommands.q(owner) ++ "),cleanup_phase='requested' WHERE role IN ('target','adapter') AND cleanup_phase<>'released'"
      ++ " AND query_id IN (SELECT launch_query FROM semantic_runtimes WHERE owner=" ++ ContextCommands.q(owner)
      ++ ") AND EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ ContextCommands.q(owner) ++ ");COMMIT;"))
    +rows : String <- IO.try(String, DB.Sql.query_bound(database, binding,
      "SELECT hex(r.launch_query),hex(p.role),hex(p.keeper_path),s.signal,CASE WHEN p.phase IN ('exited','closed') THEN 0 ELSE 1 END"
      ++ " FROM semantic_runtimes r JOIN semantic_roles p ON p.query_id=r.launch_query AND p.role IN ('target','adapter')"
      ++ " JOIN session_stops s ON s.session=r.owner WHERE r.owner=" ++ ContextCommands.q(owner)
      ++ " AND p.cleanup_phase<>'released' ORDER BY r.launch_query,CASE p.role WHEN 'target' THEN 0 ELSE 1 END;"))
    sent : Unit <- runtime_stop_send_rows(database, binding, Tx.split_lines(rows))
    runtime_notify_commit(database, binding)
