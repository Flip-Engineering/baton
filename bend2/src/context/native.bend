# Native context entry points and the selected-provider invocation frame.
# Provider execution receives only the frozen Core invocation and resolves its
# installed package from the executable prefix.
import Base
import ./codec-wire.bend as Codec
import ./codec.bend as CoreCodec
import ./engines.bend as Eng
import ./engines-select.bend as Sel
import ./engines-decl.bend as Decl
import ./engines-wire.bend as EnginesWire
import ./native-request.bend as NativeRequest
import ./native-catalog.bend as NativeCatalog
import ./native-project-policy.bend as NativePolicy
import ./service.bend as ContextService
import ./native-managed-query.bend as ManagedQuery
import ./bound-admission.bend as ContextAdmit
import ./identity.bend as ContextIdentity
import ../json/canonical.bend as J
import ./request.bend as Req
import ../coordinator/commands.bend as ContextCommands
import ../coordinator/logs.bend as CoordinatorLogs
import ./store.bend as ContextStore
import ../host/sqlite.bend as DB
import ../host/process.bend as Process
import ../host/instance.bend as Instance
import ../host/session-lock.bend as Host
import ../git/process.bend as Git
import ../git/types.bend as G
import ../git/text.bend as Tx

type InvocationFrame is Data:
  NativeFrameReady{value: String}
  NativeFrameRefused{reason: String}

type StepInvocationFrame is Data:
  NativeStepFrame{frame: InvocationFrame}
  NativeStepRefused{module_id: String, declaration_digest: String, operation: String}

type InvocationVerification is Data:
  InvocationVerified{artifact_sha256: String}
  InvocationVerificationRefused{reason: String}

type ManagedLaunch is Data:
  ManagedLaunch{bootstrap: ManagedQuery.Bootstrap, invocation_text: String,
    executable: String, runtime_path: String, worktree: String,
    bootstrap_digest: String}

type ManagedOutput is Data:
  ManagedOutput{event_frame: String, error_json: String, exit_status: U32,
    complete: Bool}

type ManagedStoreDisposition is Data:
  ManagedStatePublished{}
  ManagedInterruptedRetained{}
  ManagedStoreRefused{reason: String}

type ManagedExit is Data:
  ManagedExit{code: U32, complete: Bool}
  ManagedExitRefused{}

def invocation_frame(+invocation: Sel.Invocation) -> InvocationFrame:
  match invocation:
    case Sel.Invocation{version, query, owner, binding, request,
                        operation_plan, inputs, role, incarnation}:
      Bool.pick(InvocationFrame, String.eq(version, "2"),
        NativeFrameReady{Codec.invocation_frame(query, owner,
          EnginesWire.bind_text(binding), request,
          EnginesWire.captures_text(inputs), EnginesWire.plan_text(operation_plan),
          role, incarnation)},
        NativeFrameRefused{"invocationVersion"})

def invocation_outcome(outcome: Sel.InvocationOutcome) -> StepInvocationFrame:
  match outcome:
    case Sel.InvocationMissing{module_id, declaration_digest, operation}:
      NativeStepRefused{module_id, declaration_digest, operation}
    case Sel.InvocationBound{invocation}:
      NativeStepFrame{invocation_frame(invocation)}

def invocation_for_step(+plan: Sel.Plan, +module_id: String, +digest: String,
                        +operation: String, +query: String, +owner: String,
                        +request: String, +role: String,
                        +incarnation: String) -> StepInvocationFrame:
  invocation_outcome(Sel.invocation_for_step(plan, module_id, digest, operation,
    query, owner, request, role, incarnation))

def dirname_step(+rest: String, +current: String, +last: String) -> String:
  match rest:
    case SNil{}: last
    case SCon{+head, +tail}:
      Bool.pick(String, U32.is_eq(Char.to_u32(head), 47),
        dirname_step(tail, current ++ SCon{head, SNil{}}, current ++ SCon{head, SNil{}}),
        dirname_step(tail, current ++ SCon{head, SNil{}}, last))

def executable_directory(path: String) -> String:
  dirname_step(path, SNil{}, SNil{})

def installed_provider_path(executable: String) -> String:
  executable_directory(executable) ++ "../libexec/baton2/context-provider.mjs"

def inventory_argv(+runtime_path: String, +executable: String) -> String:
  Process.argv([runtime_path, "--experimental-strip-types",
    installed_provider_path(executable), "--inventory"])

def project_policy_argv(+runtime_path: String, +executable: String) -> String:
  Process.argv([runtime_path, "--experimental-strip-types",
    installed_provider_path(executable), "--project-policy"])

def project_policy_request(+owner: String, +worktree: String) -> String:
  J.json_text(J.Jobj{J.Jpair{"owner", J.Jstr{owner},
    J.Jpair{"worktree", J.Jstr{worktree}, J.Jnil{}}}})

def query_artifact_argv(+runtime_path: String, +executable: String) -> String:
  Process.argv([runtime_path, "--experimental-strip-types",
    installed_provider_path(executable), "--prepare-query-artifact"])

def query_bootstrap_argv(+runtime_path: String, +executable: String) -> String:
  Process.argv([runtime_path, "--experimental-strip-types",
    installed_provider_path(executable), "--persist-query-bootstrap"])

def query_bootstrap_read_argv(+runtime_path: String, +executable: String,
                              +owner: String, +worktree: String,
                              +query: String, +path: String) -> String:
  Process.argv([runtime_path, "--experimental-strip-types",
    installed_provider_path(executable), "--read-query-bootstrap", owner,
    worktree, query, path])

def verify_invocation_file_argv(+runtime_path: String, +executable: String,
                                +path: String) -> String:
  Process.argv([runtime_path, "--experimental-strip-types",
    installed_provider_path(executable), "--verify-invocation-file", path])

def query_outcome_argv(+runtime_path: String, +executable: String) -> String:
  Process.argv([runtime_path, "--experimental-strip-types",
    installed_provider_path(executable), "--persist-query-outcome"])

def query_source_argv(+runtime_path: String, +executable: String) -> String:
  Process.argv([runtime_path, "--experimental-strip-types",
    installed_provider_path(executable), "--examine-query-source"])

def verify_invocation_argv(+runtime_path: String, +executable: String) -> String:
  Process.argv([runtime_path, "--experimental-strip-types",
    installed_provider_path(executable), "--verify-invocation"])

def query_artifact_request(+owner: String, +worktree: String, +query: String) -> String:
  J.json_text(J.Jobj{J.Jpair{"owner", J.Jstr{owner},
    J.Jpair{"worktree", J.Jstr{worktree},
      J.Jpair{"query", J.Jstr{query}, J.Jnil{}}}}})

def query_bootstrap_request(+owner: String, +worktree: String, +query: String,
                            +bootstrap_text: String) -> String:
  J.json_text(J.Jobj{J.Jpair{"owner", J.Jstr{owner},
    J.Jpair{"worktree", J.Jstr{worktree},
      J.Jpair{"query", J.Jstr{query},
      J.Jpair{"bootstrapText", J.Jstr{bootstrap_text}, J.Jnil{}}}}}})

def query_outcome_request(+owner: String, +worktree: String, +query: String,
                          +bootstrap_digest: String, +exit_status: U32,
                          +event_frame: String) -> String:
  J.json_text(J.Jobj{J.Jpair{"owner", J.Jstr{owner},
    J.Jpair{"worktree", J.Jstr{worktree},
      J.Jpair{"query", J.Jstr{query},
        J.Jpair{"bootstrapSha256", J.Jstr{bootstrap_digest},
          J.Jpair{"exitStatus", J.Jint{exit_status},
            J.Jpair{"eventFrame", J.Jstr{event_frame}, J.Jnil{}}}}}}}})

def query_source_request(+owner: String, +worktree: String, +cwd: String,
                         +path: String) -> String:
  J.json_text(J.Jobj{J.Jpair{"owner", J.Jstr{owner},
    J.Jpair{"worktree", J.Jstr{worktree},
      J.Jpair{"cwd", J.Jstr{cwd},
        J.Jpair{"path", J.Jstr{path}, J.Jnil{}}}}}})

type ProviderAnswer is Data:
  ProviderOutput{value: String, status: String}
  ProviderRefused{reason: String}
  ProviderRuntime{path: String, version: String}

type OwnerWorkspace is Data:
  OwnerWorkspaceReady{path: String}
  OwnerWorkspaceRefused{reason: String}

type ProjectPolicyAnswer is Data:
  ProjectPolicyReady{policy: NativePolicy.ProjectPolicy,
                     identity: Sel.ProjectPolicyIdentity}
  ProjectPolicyRefused{reason: String}

type ProjectPolicyJson is Data:
  ProjectPolicyJsonReady{value: J.Json}
  ProjectPolicyJsonRefused{reason: String}

type BoundaryPath is Data:
  BoundaryPathReady{path: String}
  BoundaryPathRefused{reason: String}

def owner_workspace_sql(owner: String) -> String:
  "SELECT workspace FROM sessions WHERE id=" ++ ContextCommands.q(owner) ++ ";"

# The query captures the owner's active attempt once before keeper preparation.
# That exact value enters the sealed bootstrap and first Core admission; later
# attempts do not replace launch provenance. An owner with no active attempt
# keeps SQL NULL through the bootstrap's nullable field.
def origin_attempt_sql(owner: String) -> String:
  "SELECT coalesce((SELECT id FROM executions WHERE session=" ++ ContextCommands.q(owner)
  ++ " AND phase<>'exited' ORDER BY rowid DESC LIMIT 1),'');"

def origin_attempt_rows(+rows: String) -> String:
  Tx.trim_nl(rows)

def origin_attempt_result(result: Result<&1,&1,U32 & String,String>) -> IO(String):
  match result:
    case Fail{error}: IO.die(String, 3, "originAttemptRead")
    case Done{+rows}: IO.pure(String, origin_attempt_rows(rows))

def owner_origin_attempt(+db: String, +binding: String, +owner: String) -> IO(String):
  do IO<String>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding,
      origin_attempt_sql(owner))
    origin_attempt_result(result)

def owner_workspace_fields(fields: List<String>) -> OwnerWorkspace:
  match fields:
    case +path <> Nil{}:
      Bool.pick(OwnerWorkspace, String.is_empty(path),
        OwnerWorkspaceRefused{"sessionWorkspaceMissing"}, OwnerWorkspaceReady{path})
    case Nil{}: OwnerWorkspaceRefused{"sessionWorkspaceAbsent"}
    case other: OwnerWorkspaceRefused{"sessionWorkspaceShape"}

def owner_workspace_lines(lines: List<String>) -> OwnerWorkspace:
  match lines:
    case Nil{}: OwnerWorkspaceRefused{"sessionWorkspaceAbsent"}
    case +line <> rest:
      match rest:
        case Nil{}: owner_workspace_fields(Tx.split_tabs(line))
        case other: OwnerWorkspaceRefused{"sessionWorkspaceSurplus"}

def owner_workspace_rows(rows: String) -> OwnerWorkspace:
  owner_workspace_lines(Tx.split_lines(rows))

def owner_workspace_result(result: Result<&1,&1,U32 & String,String>) -> IO(OwnerWorkspace):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(OwnerWorkspace, OwnerWorkspaceRefused{"sessionWorkspaceRead"})
    case Done{+rows}: IO.pure(OwnerWorkspace, owner_workspace_rows(rows))

def read_owner_workspace(+db: String, +binding: String, +owner: String) -> IO(OwnerWorkspace):
  do IO<OwnerWorkspace>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding,
      owner_workspace_sql(owner))
    owner_workspace_result(result)

def absolute_node_path(+path: String) -> Bool:
  match path:
    case SNil{}: False{}
    case SCon{head, tail}: U32.is_eq(Char.to_u32(head), 47)

def node_runtime_fields(fields: List<String>) -> ProviderAnswer:
  match fields:
    case +path <> +support <> +version <> Nil{}:
      Bool.pick(ProviderAnswer,
        Bool.and(absolute_node_path(path), String.eq(support, "supported")),
        ProviderRuntime{path, version}, ProviderRefused{"nodeRuntimeUnsupported"})
    case other: ProviderRefused{"nodeRuntimeProbeMalformed"}

def node_runtime_status(+line: String, +status: String, surplus: Bool) -> ProviderAnswer:
  Bool.pick(ProviderAnswer, surplus, ProviderRefused{"nodeRuntimeProbeSurplus"},
    Bool.pick(ProviderAnswer, String.eq(status, "exit 0"),
      node_runtime_fields(Tx.split_tabs(line)), ProviderRefused{"nodeRuntimeProbeExit"}))

def node_runtime_wait(+line: String, surplus: Bool,
                      waited: Result<&1,&1,U32 & String,String>) -> IO(ProviderAnswer):
  match waited:
    case Fail{error}: IO.pure(ProviderAnswer, ProviderRefused{"nodeRuntimeProbeWait"})
    case Done{+status}: IO.pure(ProviderAnswer, node_runtime_status(line, status, surplus))

def node_runtime_reap_answer(+reason: String,
                             waited: Result<&1,&1,U32 & String,String>) -> IO(ProviderAnswer):
  match waited:
    case Fail{error}: IO.pure(ProviderAnswer, ProviderRefused{"nodeRuntimeProbeWait"})
    case Done{+status}: IO.pure(ProviderAnswer, ProviderRefused{reason})

def node_runtime_reap(+handle: U32, +reason: String) -> IO(ProviderAnswer):
  do IO<ProviderAnswer>:
    waited : Result<&1,&1,U32 & String,String> <- Process.ProcessChild.wait(handle)
    node_runtime_reap_answer(reason, waited)

def node_runtime_wait_extra(+handle: U32, +line: String, surplus: Bool) -> IO(ProviderAnswer):
  do IO<ProviderAnswer>:
    waited : Result<&1,&1,U32 & String,String> <- Process.ProcessChild.wait(handle)
    node_runtime_wait(line, surplus, waited)

def node_runtime_second(+handle: U32, +line: String,
                        second: Result<&1,&1,U32 & String,Maybe<String>>) -> IO(ProviderAnswer):
  match second:
    case Fail{error}: node_runtime_reap(handle, "nodeRuntimeProbeRead")
    case Done{+extra}:
      match extra:
        case Some{+value}: node_runtime_wait_extra(handle, line, True{})
        case None{}: node_runtime_wait_extra(handle, line, False{})

def node_runtime_after_first(+handle: U32, +line: String) -> IO(ProviderAnswer):
  do IO<ProviderAnswer>:
    second : Result<&1,&1,U32 & String,Maybe<String>> <- Process.ProcessChild.read_line(handle)
    node_runtime_second(handle, line, second)

def node_runtime_read(+handle: U32,
                      first: Result<&1,&1,U32 & String,Maybe<String>>) -> IO(ProviderAnswer):
  match first:
    case Fail{error}:
      do IO<ProviderAnswer>:
        waited : Result<&1,&1,U32 & String,String> <- Process.ProcessChild.wait(handle)
        node_runtime_wait("", False{}, waited)
    case Done{+line}:
      match line:
        case None{}:
          do IO<ProviderAnswer>:
            waited : Result<&1,&1,U32 & String,String> <- Process.ProcessChild.wait(handle)
            node_runtime_wait("", False{}, waited)
        case Some{+value}: node_runtime_after_first(handle, value)

def node_runtime_started(result: Result<&1,&1,U32 & String,U32>) -> IO(ProviderAnswer):
  match result:
    case Fail{error}: IO.pure(ProviderAnswer, ProviderRefused{"nodeRuntimeProbeSpawn"})
    case Done{+handle}:
      do IO<ProviderAnswer>:
        first : Result<&1,&1,U32 & String,Maybe<String>> <- Process.ProcessChild.read_line(handle)
        node_runtime_read(handle, first)

def resolve_node_runtime(+cwd: String) -> IO(ProviderAnswer):
  do IO<ProviderAnswer>:
    result : Result<&1,&1,U32 & String,U32> <- Process.ProcessChild.spawn(
      Process.argv(["/usr/bin/env", "node", "-e",
        "const [major,minor]=process.versions.node.split('.').map(Number);process.stdout.write(process.execPath+'\\t'+((major>22||(major===22&&minor>=15))?'supported':'unsupported')+'\\t'+process.versions.node)"]),
      cwd, "/dev/null")
    node_runtime_started(result)

def provider_wait_answer(+value: String, surplus: Bool,
                         waited: Result<&1,&1,U32 & String,String>) -> IO(ProviderAnswer):
  match waited:
    case Done{+status}: IO.pure(ProviderAnswer,
      Bool.pick(ProviderAnswer, surplus, ProviderRefused{"providerOutputSurplus"}, ProviderOutput{value, status}))
    case Fail{error}: IO.pure(ProviderAnswer, ProviderRefused{"providerWait"})

def provider_wait(+handle: U32, +value: String, surplus: Bool) -> IO(ProviderAnswer):
  do IO<ProviderAnswer>:
    waited : Result<&1,&1,U32 & String,String> <- Process.ProcessChild.wait(handle)
    provider_wait_answer(value, surplus, waited)

def provider_reap_answer(+reason: String,
                         waited: Result<&1,&1,U32 & String,String>) -> IO(ProviderAnswer):
  match waited:
    case Done{status}: IO.pure(ProviderAnswer, ProviderRefused{reason})
    case Fail{error}: IO.pure(ProviderAnswer, ProviderRefused{"providerWait"})

def provider_reap(+handle: U32, +reason: String) -> IO(ProviderAnswer):
  do IO<ProviderAnswer>:
    waited : Result<&1,&1,U32 & String,String> <- Process.ProcessChild.wait(handle)
    provider_reap_answer(reason, waited)

def provider_second(+handle: U32, +value: String,
                    second: Result<&1,&1,U32 & String,Maybe<String>>) -> IO(ProviderAnswer):
  match second:
    case Fail{error}: provider_reap(handle, "providerOutputRead")
    case Done{+line}:
      match line:
        case Some{value}: provider_wait(handle, value, True{})
        case None{}: provider_wait(handle, value, False{})

def provider_after_first(+handle: U32, +value: String) -> IO(ProviderAnswer):
  do IO<ProviderAnswer>:
    extra : Result<&1,&1,U32 & String,Maybe<String>> <- Process.ProcessChild.read_line(handle)
    provider_second(handle, value, extra)

def provider_read(+handle: U32, result: Result<&1,&1,U32 & String,Maybe<String>>) -> IO(ProviderAnswer):
  match result:
    case Fail{error}: provider_reap(handle, "providerOutputRead")
    case Done{+line}:
      match line:
        case None{}: provider_reap(handle, "providerOutputMissing")
        case Some{+value}:
          provider_after_first(handle, value)

def provider_close(+handle: U32, result: Result<&1,&1,U32 & String,Unit>) -> IO(ProviderAnswer):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(ProviderAnswer, ProviderRefused{"providerInputClose"})
    case Done{unit}:
      do IO<ProviderAnswer>:
        output : Result<&1,&1,U32 & String,Maybe<String>> <- Process.ProcessChild.read_line(handle)
        provider_read(handle, output)

def provider_write(+handle: U32, result: Result<&1,&1,U32 & String,Unit>) -> IO(ProviderAnswer):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(ProviderAnswer, ProviderRefused{"providerInputWrite"})
    case Done{unit}:
      do IO<ProviderAnswer>:
        closed : Result<&1,&1,U32 & String,Unit> <- Process.ProcessChild.close_stdin(handle)
        provider_close(handle, closed)

def provider_spawn(+path: String, +cwd: String, +frame: String, result: Result<&1,&1,U32 & String,U32>) -> IO(ProviderAnswer):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(ProviderAnswer, ProviderRefused{"providerSpawn"})
    case Done{+handle}:
      do IO<ProviderAnswer>:
        written : Result<&1,&1,U32 & String,Unit> <- Process.ProcessChild.write(handle, frame ++ "\n")
        provider_write(handle, written)

def invocation_verify_sql(+output: String) -> String:
  "SELECT coalesce(json_extract(" ++ ContextCommands.q(output) ++ ",'$.status'),''),"
  ++ "coalesce(json_extract(" ++ ContextCommands.q(output) ++ ",'$.query'),''),"
  ++ "coalesce(json_extract(" ++ ContextCommands.q(output) ++ ",'$.owner'),''),"
  ++ "coalesce(json_extract(" ++ ContextCommands.q(output) ++ ",'$.moduleId'),''),"
  ++ "coalesce(json_extract(" ++ ContextCommands.q(output) ++ ",'$.declarationDigest'),''),"
  ++ "coalesce(json_extract(" ++ ContextCommands.q(output) ++ ",'$.artifactSha256'),'');"

def invocation_verify_fields(fields: List<String>, +query: String, +owner: String,
                             +module_id: String, +digest: String) -> InvocationVerification:
  match fields:
    case +status <> +seen_query <> +seen_owner <> +seen_module <> +seen_digest <> +artifact_sha <> Nil{}:
      Bool.pick(InvocationVerification,
        Bool.and(String.eq(status ++ "\t" ++ seen_query ++ "\t" ++ seen_owner
          ++ "\t" ++ seen_module ++ "\t" ++ seen_digest,
          "verified\t" ++ query ++ "\t" ++ owner ++ "\t" ++ module_id ++ "\t" ++ digest),
          Nat.is_eq(String.length(artifact_sha), 64n)),
        InvocationVerified{artifact_sha}, InvocationVerificationRefused{"invocationVerificationMismatch"})
    case _: InvocationVerificationRefused{"invocationVerificationShape"}

def invocation_verify_rows(+rows: String, +query: String, +owner: String,
                           +module_id: String, +digest: String) -> InvocationVerification:
  invocation_verify_lines(Tx.split_lines(rows), query, owner, module_id, digest)

def invocation_verify_lines(lines: List<String>, +query: String, +owner: String,
                             +module_id: String, +digest: String) -> InvocationVerification:
  match lines:
    case +line <> Nil{}:
      invocation_verify_fields(Tx.split_tabs(line), query, owner, module_id, digest)
    case _: InvocationVerificationRefused{"invocationVerificationRows"}

def invocation_verify_result(result: Result<&1,&1,U32 & String,String>,
                             +query: String, +owner: String,
                             +module_id: String, +digest: String) -> IO(InvocationVerification):
  match result:
    case Fail{error}: IO.pure(InvocationVerification, InvocationVerificationRefused{"invocationVerificationDecode"})
    case Done{+rows}: IO.pure(InvocationVerification,
      invocation_verify_rows(rows, query, owner, module_id, digest))

def invocation_verification_output(+db: String, +binding: String,
                                   +query: String, +owner: String,
                                   +module_id: String, +digest: String,
                                   answer: ProviderAnswer) -> IO(InvocationVerification):
  match answer:
    case ProviderRefused{reason}: IO.pure(InvocationVerification, InvocationVerificationRefused{reason})
    case ProviderRuntime{path, version}: IO.pure(InvocationVerification, InvocationVerificationRefused{"invocationVerifierMalformed"})
    case ProviderOutput{+value, +status}:
      Bool.pick(IO(InvocationVerification), String.eq(status, "exit 0"),
        do IO<InvocationVerification>:
          result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding,
            invocation_verify_sql(value))
          invocation_verify_result(result, query, owner, module_id, digest),
        IO.pure(InvocationVerification, InvocationVerificationRefused{"invocationVerifierExit"}))

def verify_invocation_frame(+db: String, +binding: String, +query: String,
                            +owner: String, +cwd: String, +executable: String,
                            +runtime_path: String, +module_id: String,
                            +digest: String, frame: InvocationFrame) -> IO(InvocationVerification):
  match frame:
    case NativeFrameRefused{reason}:
      IO.pure(InvocationVerification, InvocationVerificationRefused{reason})
    case NativeFrameReady{+value}:
      do IO<InvocationVerification>:
        spawned : Result<&1,&1,U32 & String,U32> <- Process.ProcessChild.spawn(
          verify_invocation_argv(runtime_path, executable), cwd, "/dev/null")
        answer : ProviderAnswer <- provider_spawn(installed_provider_path(executable), cwd,
          value, spawned)
        invocation_verification_output(db, binding, query, owner, module_id,
          digest, answer)

def boundary_member_value(found: Maybe<&2, J.Json>) -> J.Json:
  match found:
    case None{}: J.Jnil{}
    case Some{+value}: value

def boundary_member(+object: J.Json, +key: String) -> J.Json:
  match object:
    case J.Jobj{+members}: boundary_member_value(Req.member_lookup(key, members))
    case other: J.Jnil{}

def boundary_text(+object: J.Json, +key: String) -> String:
  Req.text_of(boundary_member(object, key))

def managed_exit_code(+kind: String, parsed: Maybe<U32>) -> ManagedExit:
  match parsed:
    case Some{code}:
      Bool.pick(ManagedExit, String.eq(kind, "exit"),
        ManagedExit{code, U32.is_eq(code, 0)},
        Bool.pick(ManagedExit, String.eq(kind, "signal"),
          Bool.pick(ManagedExit, U32.is_lt(code, 128),
            ManagedExit{U32.add(code, 128), False{}},
            ManagedExit{255, False{}}), ManagedExitRefused{}))
    case None{}: ManagedExitRefused{}

def managed_exit_fields(fields: List<String>) -> ManagedExit:
  match fields:
    case +kind <> +code_text <> Nil{}:
      managed_exit_code(kind, U32.read(code_text))
    case other: ManagedExitRefused{}

def managed_exit_status(+status: String) -> ManagedExit:
  managed_exit_fields(Tx.split_spaces(status))

def managed_output_value(+event_frame: String, exit: ManagedExit) -> ManagedOutput:
  match exit:
    case ManagedExit{code, complete}:
      Bool.pick(ManagedOutput, complete,
        ManagedOutput{event_frame, SNil{}, code, True{}},
        ManagedOutput{event_frame, event_frame, code, False{}})
    case ManagedExitRefused{}:
      ManagedOutput{SNil{}, "{\"reason\":\"managedExitStatusMalformed\"}", 255, False{}}

def managed_wait_output(+handle: U32, +event_frame: String,
                        waited: Result<&1,&1,U32 & String,String>) -> IO(ManagedOutput):
  match waited:
    case Fail{error}: IO.die(ManagedOutput, 3, "managedChildWait")
    case Done{+status}:
      Bool.pick(IO(ManagedOutput), String.is_empty(status),
        IO.die(ManagedOutput, 3, "managedChildStatusMissing"),
        IO.pure(ManagedOutput, managed_output_value(event_frame,
          managed_exit_status(status))))

def managed_read_second(+handle: U32, +event_frame: String,
                        second: Result<&1,&1,U32 & String,Maybe<String>>) -> IO(ManagedOutput):
  match second:
    case Fail{error}: IO.die(ManagedOutput, 3, "managedChildOutputRead")
    case Done{+extra}:
      match extra:
        case Some{value}: IO.die(ManagedOutput, 3, "managedChildOutputSurplus")
        case None{}:
          do IO<ManagedOutput>:
            waited : Result<&1,&1,U32 & String,String> <- Process.ProcessChild.wait(handle)
            managed_wait_output(handle, event_frame, waited)

def managed_read_first(+handle: U32,
                       first: Result<&1,&1,U32 & String,Maybe<String>>) -> IO(ManagedOutput):
  match first:
    case Fail{error}: IO.die(ManagedOutput, 3, "managedChildOutputRead")
    case Done{+line}:
      match line:
        case None{}: IO.die(ManagedOutput, 3, "managedChildOutputMissing")
        case Some{+event_frame}:
          do IO<ManagedOutput>:
            second : Result<&1,&1,U32 & String,Maybe<String>> <- Process.ProcessChild.read_line(handle)
            managed_read_second(handle, event_frame, second)

def managed_observe(+handle: U32) -> IO(ManagedOutput):
  do IO<ManagedOutput>:
    first : Result<&1,&1,U32 & String,Maybe<String>> <- Process.ProcessChild.read_line(handle)
    managed_read_first(handle, first)

def managed_persist_output(+owner: String, +worktree: String, +query: String,
                           +bootstrap_digest: String,
                           output: ManagedOutput) -> String:
  match output:
    case ManagedOutput{event_frame, error_json, exit_status, complete}:
      event_frame

def managed_output_exit_status(output: ManagedOutput) -> U32:
  match output:
    case ManagedOutput{event_frame, error_json, exit_status, complete}: exit_status

def managed_outcome_persisted(+owner: String, +query: String,
                              output: ManagedOutput,
                              decoded: ProjectPolicyJson) -> Bool:
  match decoded:
    case ProjectPolicyJsonRefused{reason}: False{}
    case ProjectPolicyJsonReady{+value}:
      Bool.and(String.eq(boundary_text(value, "status"), "persisted"),
      Bool.and(String.eq(boundary_text(value, "owner"), owner),
      Bool.and(String.eq(boundary_text(value, "query"), query),
      String.eq(boundary_text(value, "exitStatus"),
        U32.show(managed_output_exit_status(output))))))

def managed_persist_answer(+owner: String, +worktree: String, +query: String,
                           +bootstrap_digest: String, output: ManagedOutput,
                           answer: ProviderAnswer) -> IO(ManagedOutput):
  match answer:
    case ProviderRefused{reason}: IO.die(ManagedOutput, 3, "managedOutcomePersistence:" ++ reason)
    case ProviderRuntime{path, version}: IO.die(ManagedOutput, 3, "managedOutcomePersistenceMalformed")
    case ProviderOutput{+value, +status}:
      Bool.pick(IO(ManagedOutput), Bool.and(String.eq(status, "exit 0"),
        managed_outcome_persisted(owner, query, output,
          project_policy_json_rows(value))),
        IO.pure(ManagedOutput, output),
        IO.die(ManagedOutput, 3, "managedOutcomePersistenceRefused"))

def persist_managed_output(+executable: String, +runtime_path: String,
                           +cwd: String, +owner: String, +worktree: String,
                           +query: String, +bootstrap_digest: String,
                           output: ManagedOutput) -> IO(ManagedOutput):
  do IO<ManagedOutput>:
    spawned : Result<&1,&1,U32 & String,U32> <- Process.ProcessChild.spawn(
      query_outcome_argv(runtime_path, executable), cwd, "/dev/null")
    answer : ProviderAnswer <- provider_spawn(installed_provider_path(executable),
      cwd, query_outcome_request(owner, worktree, query, bootstrap_digest,
        managed_output_exit_status(output),
        managed_persist_output(owner, worktree, query, bootstrap_digest, output)), spawned)
    managed_persist_answer(owner, worktree, query, bootstrap_digest, output, answer)

def managed_store_publish_result(result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Fail{(code, message)}: IO.die(Unit, code, "managedOwnerNoticePublish:" ++ message)
    case Done{value}: IO.pure(Unit, Unit{})

def managed_store_cursor(+db: String,
                         result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{(code, message)}: IO.die(Unit, code, "managedOwnerNoticeCursor:" ++ message)
    case Done{+rows}:
      managed_store_publish_result(Instance.publish_commit(db, Tx.trim_nl(rows)))

def managed_store_disposition(+requested_state: String,
                              decoded: ProjectPolicyJson) -> ManagedStoreDisposition:
  match decoded:
    case ProjectPolicyJsonRefused{reason}: ManagedStoreRefused{"managedOutcomeReadback"}
    case ProjectPolicyJsonReady{+value}:
      Bool.pick(ManagedStoreDisposition,
        String.eq(boundary_text(value, "state"), requested_state),
        ManagedStatePublished{},
        Bool.pick(ManagedStoreDisposition,
          Bool.and(String.eq(boundary_text(value, "state"), "interrupted"),
          Bool.or(String.eq(requested_state, "complete"),
                  String.eq(requested_state, "failed"))),
          ManagedInterruptedRetained{}, ManagedStoreRefused{"managedOutcomeConflict"}))

def managed_store_disposition_result(disposition: ManagedStoreDisposition) -> IO(Unit):
  match disposition:
    case ManagedStatePublished{}: IO.pure(Unit, Unit{})
    case ManagedInterruptedRetained{}: IO.pure(Unit, Unit{})
    case ManagedStoreRefused{reason}: IO.die(Unit, 3, reason)

def managed_store_rows(+db: String, +binding: String, +requested_state: String,
                       +rows: String) -> IO(Unit):
  do IO<Unit>:
    disposition : ManagedStoreDisposition <- IO.pure(ManagedStoreDisposition,
      managed_store_disposition(requested_state, project_policy_json_rows(rows)))
    checked : Unit <- managed_store_disposition_result(disposition)
    written : Unit <- IO.write(rows)
    cursor : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db,
      binding, "SELECT CAST(coalesce(max(change_id),0) AS TEXT) FROM native_changes;")
    managed_store_cursor(db, cursor)

def managed_store_result(+db: String, +binding: String,
                         +requested_state: String,
                         result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{error}: IO.die(Unit, 3, "managedOutcomeStore")
    case Done{+rows}: managed_store_rows(db, binding, requested_state, rows)

def store_managed_output(+db: String, +binding: String, +query: String, +owner: String,
                         output: ManagedOutput) -> IO(Unit):
  match output:
    case ManagedOutput{event_frame, error_json, exit_status, complete}:
      do IO<Unit>:
        result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding,
          ContextStore.state_publish_managed_sql(query, owner,
            Bool.pick(String, complete, "complete", "failed"),
            Bool.pick(String, complete, event_frame, SNil{}),
            Bool.pick(String, complete, SNil{}, error_json)))
        managed_store_result(db, binding,
          Bool.pick(String, complete, "complete", "failed"), result)

def launch_bootstrap(launch: ManagedLaunch) -> ManagedQuery.Bootstrap:
  match launch:
    case ManagedLaunch{bootstrap, invocation_text, executable, runtime_path,
        worktree, bootstrap_digest}: bootstrap

def managed_observe_complete(+db: String, +binding: String,
                             +launch: ManagedLaunch, handle: U32) -> IO(Unit):
  match launch:
    case ManagedLaunch{+bootstrap, invocation_text, executable, runtime_path,
        worktree, bootstrap_digest}:
      do IO<Unit>:
        output : ManagedOutput <- managed_observe(handle)
        persisted : ManagedOutput <- persist_managed_output(executable,
          runtime_path, ManagedQuery.bootstrap_cwd(bootstrap),
          ManagedQuery.bootstrap_owner(bootstrap), worktree,
          ManagedQuery.bootstrap_query(bootstrap), bootstrap_digest, output)
        store_managed_output(db, binding,
          ManagedQuery.bootstrap_query(bootstrap),
          ManagedQuery.bootstrap_owner(bootstrap), persisted)

def managed_start_decision(+db: String, +binding: String, +launch: ManagedLaunch,
                           handle: U32,
                           decision: ManagedQuery.StartDecision) -> IO(Unit):
  match decision:
    case ManagedQuery.StartGranted{query, owner, role, incarnation, request,
        keeper_path, artifact_path, plan_value, result_schema}:
      do IO<Unit>:
        started : Unit <- IO.try(Unit, Instance.start(handle,
          ManagedQuery.bootstrap_text(launch_bootstrap(launch)),
          ManagedQuery.start_decision_text(decision),
          ManagedQuery.bootstrap_owner_witness(launch_bootstrap(launch))))
        managed_observe_complete(db, binding, launch, handle)
    case ManagedQuery.StartCancelled{query, owner, reason, keeper_path}:
      do IO<Unit>:
        cancelled : Unit <- IO.try(Unit, Instance.cancel(handle,
          ManagedQuery.bootstrap_text(launch_bootstrap(launch)),
          ManagedQuery.start_decision_text(decision),
          ManagedQuery.bootstrap_owner_witness(launch_bootstrap(launch))))
        IO.die(Unit, 3, "managedAdmissionCancelled:" ++ reason)
    case ManagedQuery.StartHeld{reason}:
      IO.die(Unit, 3, "managedStartHeld:" ++ reason)

def managed_submit_start(+db: String, +binding: String,
                         +launch: ManagedLaunch, handle: U32,
                         readiness: ManagedQuery.KeeperReadiness) -> IO(Unit):
  match launch:
    case ManagedLaunch{+bootstrap, invocation_text, executable, runtime_path,
        worktree, bootstrap_digest}:
      do IO<Unit>:
        decision : ManagedQuery.StartDecision <- ManagedQuery.submit_after_observer_ready(
          bootstrap, readiness, db)
        managed_start_decision(db, binding, launch, handle, decision)

def recovery_file_verify_sql(+output: String) -> String:
  "SELECT coalesce(json_extract(" ++ ContextCommands.q(output) ++ ",'$.status'),''),"
  ++ "coalesce(json_extract(" ++ ContextCommands.q(output) ++ ",'$.artifactSha256'),'');"

def recovery_file_digest_fields(fields: List<String>) -> String:
  match fields:
    case +status <> +digest <> Nil{}:
      Bool.pick(String, Bool.and(String.eq(status, "verified"),
        Nat.is_eq(String.length(digest), 64n)), digest, SNil{})
    case other: SNil{}

def recovery_file_digest_lines(lines: List<String>) -> String:
  match lines:
    case +line <> Nil{}:
      recovery_file_digest_fields(Tx.split_tabs(line))
    case other: SNil{}

def recovery_file_digest(+rows: String) -> String:
  recovery_file_digest_lines(Tx.split_lines(rows))

def recovery_file_db_result(+expected_digest: String,
                            result: Result<&1,&1,U32 & String,String>) -> IO(Bool):
  match result:
    case Fail{error}: IO.pure(Bool, False{})
    case Done{+row}: IO.pure(Bool,
      String.eq(recovery_file_digest(row), expected_digest))

def recovery_file_provider_answer(+db: String, +binding: String,
                                  +expected_digest: String,
                                  answer: ProviderAnswer) -> IO(Bool):
  match answer:
    case ProviderOutput{+value, +status}:
      Bool.pick(IO(Bool), String.eq(status, "exit 0"),
        do IO<Bool>:
          rows : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db,
            binding, recovery_file_verify_sql(value))
          recovery_file_db_result(expected_digest, rows),
        IO.pure(Bool, False{}))
    case other: IO.pure(Bool, False{})

def recovery_file_verified(+db: String, +binding: String, +executable: String,
                           +runtime_path: String, +cwd: String,
                           +artifact_file: String, +expected_digest: String) -> IO(Bool):
  do IO<Bool>:
    spawned : Result<&1,&1,U32 & String,U32> <- Process.ProcessChild.spawn(
      verify_invocation_file_argv(runtime_path, executable, artifact_file),
      cwd, "/dev/null")
    answer : ProviderAnswer <- provider_spawn(installed_provider_path(executable),
      cwd, SNil{}, spawned)
    recovery_file_provider_answer(db, binding, expected_digest, answer)

def managed_recovery_association_row_matches(+bootstrap: ManagedQuery.Bootstrap,
                                             association: ContextAdmit.ManagedAssociation) -> Bool:
  match association:
    case ContextAdmit.ManagedAssociationStored{planValue, planIdentity,
        resultSchema, artifactSha256, bootstrapText}:
      Bool.and(String.eq(planValue, ManagedQuery.bootstrap_plan_value(bootstrap)),
      Bool.and(String.eq(planIdentity, ManagedQuery.bootstrap_plan_identity(bootstrap)),
      Bool.and(String.eq(resultSchema, ManagedQuery.bootstrap_result_schema(bootstrap)),
      Bool.and(String.eq(artifactSha256,
        ManagedQuery.bootstrap_artifact_sha256(bootstrap)),
      String.eq(bootstrapText, ManagedQuery.bootstrap_text(bootstrap))))))
    case other: False{}

def managed_recovery_association_ok(+bootstrap: ManagedQuery.Bootstrap,
                                   +admission: ContextAdmit.Admission,
                                   +association: ContextAdmit.ManagedAssociation) -> Bool:
  Bool.and(Bool.or(ManagedQuery.recovery_admission_fields_match(bootstrap, admission),
    ManagedQuery.rejection_identity_match(
      ManagedQuery.bootstrap_owner(bootstrap),
      ManagedQuery.bootstrap_request(bootstrap),
      ManagedQuery.bootstrap_keeper_path(bootstrap),
      ManagedQuery.bootstrap_cwd(bootstrap),
      ManagedQuery.bootstrap_attempt(bootstrap),
      ManagedQuery.bootstrap_artifact_path(bootstrap), admission)),
    managed_recovery_association_row_matches(bootstrap, association))

def managed_recovery_association(+db: String, +binding: String,
                                 +bootstrap: ManagedQuery.Bootstrap,
                                 admission: ContextAdmit.Admission,
                                 result: Result<&1,&1,U32 & String,ContextAdmit.ManagedAssociation>) -> IO(Bool):
  match result:
    case Fail{error}: IO.pure(Bool, False{})
    case Done{+association}: IO.pure(Bool,
      managed_recovery_association_ok(bootstrap, admission, association))

def managed_recovery_readiness_json(+bootstrap: ManagedQuery.Bootstrap,
                                    +expected_binding: String,
                                    decoded: ProjectPolicyJson) -> IO(ManagedQuery.KeeperReadiness):
  match decoded:
    case ProjectPolicyJsonRefused{reason}:
      IO.pure(ManagedQuery.KeeperReadiness,
        ManagedQuery.KeeperObserverUnavailable{"recoveryStateJson:" ++ reason})
    case ProjectPolicyJsonReady{+value}:
      IO.pure(ManagedQuery.KeeperReadiness,
        ManagedQuery.keeper_recovery_readiness_from_host(bootstrap,
          expected_binding, ManagedQuery.bootstrap_owner_witness(bootstrap), value))

def managed_recovery_readiness_rows(+bootstrap: ManagedQuery.Bootstrap,
                                    +expected_binding: String,
                                    result: Result<&1,&1,U32 & String,String>) -> IO(ManagedQuery.KeeperReadiness):
  match result:
    case Fail{error}: IO.pure(ManagedQuery.KeeperReadiness,
      ManagedQuery.KeeperObserverUnavailable{"recoveryStateDecode"})
    case Done{+rows}: managed_recovery_readiness_json(bootstrap,
      expected_binding, project_policy_json_rows(rows))

def decode_managed_recovery_readiness(+db: String, +binding: String,
                                      +bootstrap: ManagedQuery.Bootstrap,
                                      +host_json: String) -> IO(ManagedQuery.KeeperReadiness):
  do IO<ManagedQuery.KeeperReadiness>:
    expected_binding : String <- IO.try(String,
      ContextIdentity.role_guard_key(ManagedQuery.bootstrap_text(bootstrap)))
    rows : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding,
      Req.json_tree_sql(host_json))
    managed_recovery_readiness_rows(bootstrap, expected_binding, rows)

def managed_recovery_admission(+db: String, +binding: String,
                               +bootstrap: ManagedQuery.Bootstrap,
                               result: Result<&1,&1,U32 & String,ContextAdmit.Admission>) -> IO(Bool):
  match result:
    case Fail{error}: IO.pure(Bool, False{})
    case Done{+admission}:
      Bool.pick(IO(Bool), ManagedQuery.rejection_identity_match(
        ManagedQuery.bootstrap_owner(bootstrap),
        ManagedQuery.bootstrap_request(bootstrap),
        ManagedQuery.bootstrap_keeper_path(bootstrap),
        ManagedQuery.bootstrap_cwd(bootstrap),
        ManagedQuery.bootstrap_attempt(bootstrap),
        ManagedQuery.bootstrap_artifact_path(bootstrap), admission),
        IO.pure(Bool, True{}),
      do IO<Bool>:
        association : Result<&1,&1,U32 & String,ContextAdmit.ManagedAssociation> <-
          ContextAdmit.readback_managed_association(db, binding,
            ManagedQuery.bootstrap_query(bootstrap))
        managed_recovery_association(db, binding, bootstrap, admission, association))

def managed_recovery_binding(+db: String, +bootstrap: ManagedQuery.Bootstrap,
                             result: Result<&1,&1,U32 & String,String>) -> IO(Bool):
  match result:
    case Fail{error}: IO.pure(Bool, False{})
    case Done{+binding}:
      Bool.pick(IO(Bool), String.eq(binding,
        ManagedQuery.bootstrap_database_binding(bootstrap)),
        do IO<Bool>:
          admission : Result<&1,&1,U32 & String,ContextAdmit.Admission> <-
            ContextAdmit.readback(db, binding,
              ManagedQuery.bootstrap_query(bootstrap))
          managed_recovery_admission(db, binding, bootstrap, admission),
        IO.pure(Bool, False{}))

def managed_recovery_start_decision(+db: String, +binding: String,
                                    +bootstrap: ManagedQuery.Bootstrap,
                                    +worktree: String, +bootstrap_digest: String,
                                    handle: U32,
                                    decision: IO(ManagedQuery.StartDecision)) -> IO(Unit):
  do IO<Unit>:
    committed : ManagedQuery.StartDecision <- decision
    managed_start_decision(db, binding, ManagedLaunch{bootstrap, SNil{},
      ManagedQuery.bootstrap_executable_path(bootstrap),
      ManagedQuery.bootstrap_runtime_path(bootstrap), worktree, bootstrap_digest},
      handle, committed)

def managed_recovery_readiness_decision(+db: String, +binding: String,
                                        +bootstrap: ManagedQuery.Bootstrap,
                                        +worktree: String, +bootstrap_digest: String,
                                        handle: U32,
                                        readiness: ManagedQuery.KeeperReadiness) -> IO(Unit):
  match readiness:
    case ManagedQuery.KeeperObserverUnavailable{reason}:
      IO.die(Unit, 3, "managedRecoveryReadinessUnavailable:" ++ reason)
    case ManagedQuery.KeeperObserverReady{query, owner, keeper_path, role, incarnation}:
      managed_recovery_start_decision(db, binding, bootstrap, worktree,
        bootstrap_digest, handle,
        ManagedQuery.reconcile_recovery_admission(bootstrap, "starter", "0", db))

def managed_recovery_readiness_loaded(+db: String, +binding: String,
                                      +bootstrap: ManagedQuery.Bootstrap,
                                      +worktree: String, +bootstrap_digest: String,
                                      handle: U32, +host_json: String) -> IO(Unit):
  do IO<Unit>:
    readiness : ManagedQuery.KeeperReadiness <- decode_managed_recovery_readiness(
      db, binding, bootstrap, host_json)
    managed_recovery_readiness_decision(db, binding, bootstrap, worktree,
      bootstrap_digest, handle, readiness)

def managed_recovery_state_result(+db: String, +binding: String,
                                  +bootstrap: ManagedQuery.Bootstrap,
                                  +worktree: String, +bootstrap_digest: String,
                                  handle: U32,
                                  result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{error}: IO.die(Unit, 3, "managedRecoveryStateUnavailable")
    case Done{+host_json}: managed_recovery_readiness_loaded(db, binding,
      bootstrap, worktree, bootstrap_digest, handle, host_json)

def managed_recovery_attached_result(+db: String, +binding: String,
                                     +bootstrap: ManagedQuery.Bootstrap,
                                     +worktree: String, +bootstrap_digest: String,
                                     attached: Result<&1,&1,U32 & String,U32>) -> IO(Unit):
  match attached:
    case Fail{error}: IO.die(Unit, 3, "managedRecoveryAttachUnavailable")
    case Done{+handle}:
      do IO<Unit>:
        state : Result<&1,&1,U32 & String,String> <- Instance.state(handle)
        managed_recovery_state_result(db, binding, bootstrap, worktree,
          bootstrap_digest, handle, state)

def managed_recovery_attach_binding(+db: String,
                                    +worktree: String, +bootstrap_digest: String,
                                    +bootstrap: ManagedQuery.Bootstrap,
                                    binding_result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  do IO<Unit>:
    binding_ok : Bool <- managed_recovery_binding(db, bootstrap, binding_result)
    Bool.pick(IO(Unit), binding_ok,
      do IO<Unit>:
        attached : Result<&1,&1,U32 & String,U32> <- Instance.attach(db,
          ManagedQuery.bootstrap_keeper_path(bootstrap))
        managed_recovery_attached_result(db,
          ManagedQuery.bootstrap_database_binding(bootstrap), bootstrap,
          worktree, bootstrap_digest, attached),
      IO.die(Unit, 3, "managedRecoveryBindingMismatch"))

def managed_recovery_verified(+db: String, +worktree: String,
                              +bootstrap: ManagedQuery.Bootstrap,
                              +bootstrap_digest: String, verified: Bool) -> IO(Unit):
  Bool.pick(IO(Unit), verified,
    managed_recovery_attach_binding(db, worktree, bootstrap_digest, bootstrap,
      DB.Sql.binding(db)),
    IO.die(Unit, 3, "managedRecoveryInvocationMismatch"))

def managed_recovery_attach(+db: String, +worktree: String,
                            +bootstrap: ManagedQuery.Bootstrap,
                            bootstrap_digest: String) -> IO(Unit):
  do IO<Unit>:
    verified : Bool <- recovery_file_verified(db,
      ManagedQuery.bootstrap_database_binding(bootstrap),
      ManagedQuery.bootstrap_executable_path(bootstrap),
      ManagedQuery.bootstrap_runtime_path(bootstrap),
      ManagedQuery.bootstrap_cwd(bootstrap),
      ManagedQuery.bootstrap_invocation_path(bootstrap),
      ManagedQuery.bootstrap_invocation_sha256(bootstrap))
    managed_recovery_verified(db, worktree, bootstrap, bootstrap_digest,
      verified)

def managed_recovery_bootstrap_decoded(+db: String, +owner: String, +query: String,
    +directory: String, +worktree: String, +bootstrap_file: String,
    +executable: String, +runtime_path: String, +bootstrap_text: String,
    +bootstrap_digest: String,
    decoded: ManagedQuery.BootstrapDecode) -> IO(Unit):
  match decoded:
    case ManagedQuery.BootstrapDecodeRefused{reason}:
      IO.die(Unit, 3, "managedRecoveryBootstrapIdentity")
    case ManagedQuery.BootstrapDecoded{+bootstrap}:
      Bool.pick(IO(Unit), Bool.and(
        String.eq(bootstrap_text, ManagedQuery.bootstrap_text(bootstrap)),
        Bool.and(String.eq(ManagedQuery.bootstrap_keeper_path(bootstrap), directory),
        Bool.and(String.eq(directory, ContextIdentity.role_directory(
                  ManagedQuery.bootstrap_artifact_path(bootstrap),
                  ManagedQuery.bootstrap_guard_key(bootstrap))),
        Bool.and(String.eq(ManagedQuery.bootstrap_executable_path(bootstrap), executable),
        Bool.and(String.eq(ManagedQuery.bootstrap_runtime_path(bootstrap), runtime_path),
        Bool.and(String.eq(ManagedQuery.bootstrap_provider_path(bootstrap),
          installed_provider_path(executable)),
        Bool.and(String.eq(ManagedQuery.bootstrap_invocation_path(bootstrap),
          directory ++ "/invocation.json"),
        Bool.and(String.eq(ManagedQuery.bootstrap_artifact_path(bootstrap) ++ "/bootstrap.json",
                  bootstrap_file),
                String.eq(ManagedQuery.bootstrap_recovery_argv(bootstrap),
                  Process.argv([executable, "--recover-context-query", db, owner,
                    query, directory, worktree, bootstrap_file])))))))))),
        managed_recovery_attach(db, worktree, bootstrap, bootstrap_digest),
        IO.die(Unit, 3, "managedRecoveryBootstrapPathMismatch"))

def managed_recovery_bootstrap_json(+db: String, +owner: String, +query: String,
    +directory: String, +worktree: String, +bootstrap_file: String,
    +executable: String, +runtime_path: String,
    decoded: ProjectPolicyJson) -> IO(Unit):
  match decoded:
    case ProjectPolicyJsonRefused{reason}:
      IO.die(Unit, 3, "managedRecoveryBootstrapJson")
    case ProjectPolicyJsonReady{+envelope}:
      +value = boundary_member(envelope, "value")
      bootstrap_text = J.json_text(value)
      bootstrap_digest = boundary_text(envelope, "sha256")
      Bool.pick(IO(Unit), Bool.and(
        String.eq(boundary_text(envelope, "status"), "loaded"),
        Bool.and(String.eq(boundary_text(envelope, "owner"), owner),
        Bool.and(String.eq(boundary_text(envelope, "worktree"), worktree),
        Bool.and(String.eq(boundary_text(envelope, "query"), query),
        Bool.and(String.eq(boundary_text(envelope, "path"), bootstrap_file),
          Nat.is_eq(String.length(bootstrap_digest), 64n)))))),
        managed_recovery_bootstrap_decoded(db, owner, query, directory,
          worktree, bootstrap_file, executable, runtime_path, bootstrap_text,
          bootstrap_digest, ManagedQuery.bootstrap_from_json(value, owner, query)),
        IO.die(Unit, 3, "managedRecoveryBootstrapEnvelope"))

def managed_recovery_provider_answer(+db: String, +owner: String, +query: String,
                                     +directory: String, +worktree: String,
                                     +bootstrap_file: String, +executable: String,
                                     +runtime_path: String,
                                     answer: ProviderAnswer) -> IO(Unit):
  match answer:
    case ProviderOutput{+value, +status}:
      Bool.pick(IO(Unit), String.eq(status, "exit 0"),
        managed_recovery_bootstrap(db, owner, query, directory, worktree,
          bootstrap_file, executable, runtime_path, project_policy_json_rows(value)),
        IO.die(Unit, 3, "managedRecoveryBootstrapRead"))
    case other: IO.die(Unit, 3, "managedRecoveryBootstrapRead")

def managed_recovery_provider(+db: String, +owner: String, +query: String,
                              +directory: String, +worktree: String,
                              +bootstrap_file: String, +executable: String,
                              runtime: ProviderAnswer) -> IO(Unit):
  match runtime:
    case ProviderRuntime{+path, +version}:
      do IO<Unit>:
        spawned : Result<&1,&1,U32 & String,U32> <- Process.ProcessChild.spawn(
          query_bootstrap_read_argv(path, executable, owner, worktree, query,
            bootstrap_file), worktree, "/dev/null")
        answer : ProviderAnswer <- provider_spawn(installed_provider_path(executable),
          worktree, SNil{}, spawned)
        managed_recovery_provider_answer(db, owner, query, directory, worktree,
          bootstrap_file, executable, path, answer)
    case other: IO.die(Unit, 3, "managedRecoveryNodeRuntime")

def recover_managed_query(+db: String, +owner: String, +query: String,
                          +directory: String, +worktree: String,
                          +bootstrap_file: String) -> IO(Unit):
  do IO<Unit>:
    executable : String <- IO.try(String, Host.SessionLock.executable())
    runtime : ProviderAnswer <- resolve_node_runtime(worktree)
    managed_recovery_provider(db, owner, query, directory, worktree,
      bootstrap_file, executable, runtime)

def managed_prepare_result(+db: String, +binding: String, +launch: ManagedLaunch,
                           result: Result<&1,&1,U32 & String,U32 & String & String>) -> IO(Unit):
  match result:
    case Fail{error}: IO.die(Unit, 3, "managedKeeperPrepare")
    case Done{+prepared}:
      match prepared:
        case (handle, (identity, host_json)):
          Bool.pick(IO(Unit), String.eq(identity,
            ManagedQuery.bootstrap_text(launch_bootstrap(launch))),
            do IO<Unit>:
              readiness : ManagedQuery.KeeperReadiness <- decode_managed_readiness(
                db, binding, launch_bootstrap(launch), host_json)
              managed_submit_start(db, binding, launch, handle, readiness),
            IO.die(Unit, 3, "managedKeeperIdentityMismatch"))

def managed_prepare_roles(+db: String, +binding: String, +owner: String,
                          +query: String, +request: String, +cwd: String,
                          +worktree: String, +source_identity: String,
                          +artifact_path: String, +invocation_text: String,
                          +executable: String, +runtime_path: String,
                          +result_schema: String, +artifact_sha256: String,
                          +plan: Sel.Plan, +guard_identity: String,
                          +physical_identity: String, +lock: U32,
                          +owner_witness: String, +origin_attempt: String,
                          +budget: U32) -> IO(Unit):
  do IO<Unit>:
    guard_key : String <- IO.try(String, ContextIdentity.role_guard_key(guard_identity))
    physical_role_key : String <- IO.try(String,
      ContextIdentity.physical_role_key(physical_identity))
    +keeper_path = ContextIdentity.role_directory(artifact_path, guard_key)
    bootstrap_file = artifact_path ++ "/bootstrap.json"
    invocation_path = keeper_path ++ "/invocation.json"
    provider_path = installed_provider_path(executable)
    invocation_sha256 : String <- IO.try(String,
      ContextIdentity.role_guard_key(invocation_text))
    canonical_database : String <- IO.try(String, Host.SessionLock.canonical(db))
    +recovery_argv = Process.argv([executable, "--recover-context-query", canonical_database,
      owner, query, keeper_path, worktree, bootstrap_file])
    +bootstrap = ManagedQuery.query_bootstrap(binding, query, owner, request, cwd,
      origin_attempt, ManagedQuery.ArtifactEvidence{source_identity, artifact_sha256},
      EnginesWire.plan_value(plan), EnginesWire.plan_identity(plan), result_schema,
      artifact_path, keeper_path, guard_key, physical_role_key, owner_witness,
      recovery_argv, executable, runtime_path, provider_path, invocation_path,
      invocation_sha256)
    +bootstrap_text = ManagedQuery.bootstrap_text(bootstrap)
    bootstrap_digest : String <- persist_managed_bootstrap(executable, runtime_path,
      cwd, owner, worktree, query, bootstrap_file, bootstrap)
    +launch = ManagedLaunch{bootstrap, invocation_text, executable, runtime_path,
      worktree, bootstrap_digest}
    argv = Process.argv([runtime_path, "--experimental-strip-types",
      installed_provider_path(executable), "--invoke-file",
      keeper_path ++ "/invocation.json"])
    stderr_path = keeper_path ++ "/native.stderr"
    result : Result<&1,&1,U32 & String,U32 & String & String> <-
      Instance.prepare_with_file_bounded_start(db, keeper_path, argv, cwd,
        stderr_path, budget, "invocation.json", invocation_text, SNil{}, 0, lock,
        recovery_argv, bootstrap_text, owner_witness)
    managed_prepare_result(db, binding, launch, result)

def managed_prepare_owner(+db: String, +binding: String, +owner: String,
                          +query: String, +request: String, +cwd: String,
                          +worktree: String, +source_identity: String,
                          +artifact_path: String, +invocation_text: String,
                          +executable: String, +runtime_path: String,
                          +result_schema: String, +artifact_sha256: String,
                          +plan: Sel.Plan, +guard_identity: String,
                          +physical_identity: String, +lock: U32,
                          +budget: U32) -> IO(Unit):
  do IO<Unit>:
    owner_ready : Unit <- IO.try(Unit, Instance.owner(db))
    owner_witness : String <- IO.try(String, Instance.owner_witness(db))
    origin_attempt : String <- owner_origin_attempt(db, binding, owner)
    managed_prepare_roles(db, binding, owner, query, request, cwd, worktree,
      source_identity, artifact_path, invocation_text, executable, runtime_path,
      result_schema, artifact_sha256, plan, guard_identity, physical_identity,
      lock, owner_witness, origin_attempt, budget)

def managed_prepare_lock(+db: String, +binding: String, +owner: String,
                         +query: String, +request: String, +cwd: String,
                         +worktree: String, +source_identity: String,
                         +artifact_path: String, +invocation_text: String,
                         +executable: String, +runtime_path: String,
                         +result_schema: String, +artifact_sha256: String,
                         +plan: Sel.Plan, +guard_identity: String,
                         +physical_identity: String, budget: U32,
                         lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.die(Unit, 3, "managedRoleLockHeld")
    case Some{+lock_handle}:
      managed_prepare_owner(db, binding, owner, query, request, cwd,
        worktree, source_identity, artifact_path, invocation_text,
        executable, runtime_path, result_schema, artifact_sha256, plan,
        guard_identity, physical_identity, lock_handle, budget)

def managed_prepare_policy(+db: String, +binding: String, +owner: String,
                           +query: String, +request: String, +cwd: String,
                           +worktree: String, +source_identity: String,
                           +artifact_path: String, +invocation_text: String,
                           +executable: String, +runtime_path: String,
                           +result_schema: String, +artifact_sha256: String,
                           +plan: Sel.Plan, +guard_identity: String,
                           +physical_identity: String, +physical_role_key: String,
                           +anchor: String,
                           policy: CoordinatorLogs.Policy) -> IO(Unit):
  match policy:
    case CoordinatorLogs.Policy{level, budget, segments, pending, db0, session}:
      do IO<Unit>:
        lock : Maybe<U32> <- IO.try(Maybe<U32>, Host.SessionLock.try_acquire(
          anchor, ContextIdentity.guard_lock_name(physical_role_key)))
        managed_prepare_lock(db, binding, owner, query, request, cwd,
          worktree, source_identity, artifact_path, invocation_text,
          executable, runtime_path, result_schema, artifact_sha256, plan,
          guard_identity, physical_identity, budget, lock)

def managed_prepare_anchor(+db: String, +binding: String, +owner: String,
                           +query: String, +request: String, +cwd: String,
                           +worktree: String, +source_identity: String,
                           +artifact_path: String, +invocation_text: String,
                           +executable: String, +runtime_path: String,
                           +result_schema: String, +artifact_sha256: String,
                           +plan: Sel.Plan) -> IO(Unit):
  do IO<Unit>:
    guard_identity = ContextIdentity.guard_identity(binding,
      ContextIdentity.SubjectQuery{query}, ContextIdentity.RoleStarter{}, "0")
    physical_identity = ContextIdentity.physical_role_identity(
      ContextIdentity.SubjectQuery{query}, ContextIdentity.RoleStarter{})
    physical_role_key : String <- IO.try(String,
      ContextIdentity.physical_role_key(physical_identity))
    anchor : String <- IO.try(String, ContextIdentity.prepare_guard_anchor(artifact_path))
    policy : CoordinatorLogs.Policy <- CoordinatorLogs.policy(db, owner)
    managed_prepare_policy(db, binding, owner, query, request, cwd, worktree,
      source_identity, artifact_path, invocation_text, executable, runtime_path,
      result_schema, artifact_sha256, plan, guard_identity, physical_identity,
      physical_role_key, anchor, policy)

def managed_query_workspace(+plan: Sel.Plan, +result_schema: String,
                            +db: String, +binding: String, +owner: String,
                            +query: String, +request: String, +cwd: String,
                            +source_identity: String, +artifact_path: String,
                            +invocation_text: String, +executable: String,
                            +runtime_path: String, +artifact_sha256: String,
                            workspace: OwnerWorkspace) -> IO(Unit):
  match workspace:
    case OwnerWorkspaceRefused{reason}: IO.die(Unit, 3, reason)
    case OwnerWorkspaceReady{+path}:
      managed_prepare_anchor(db, binding, owner, query, request, cwd, path,
        source_identity, artifact_path, invocation_text, executable,
        runtime_path, result_schema, artifact_sha256, plan)

def managed_query_verified(+plan: Sel.Plan, +result_schema: String,
                           +db: String, +binding: String, +owner: String,
                           +query: String, +request: String, +cwd: String,
                           +source_identity: String, +artifact_path: String,
                           +invocation_text: String, +executable: String,
                           +runtime_path: String, +artifact_sha256: String) -> IO(Unit):
  do IO<Unit>:
    workspace : OwnerWorkspace <- read_owner_workspace(db, binding, owner)
    managed_query_workspace(plan, result_schema, db, binding, owner, query,
      request, cwd, source_identity, artifact_path, invocation_text,
      executable, runtime_path, artifact_sha256, workspace)

def project_policy_runtime_answer(+executable: String, +cwd: String,
                                  +owner: String, +worktree: String,
                                  +runtime: ProviderAnswer) -> IO(ProviderAnswer):
  match runtime:
    case ProviderRefused{reason}: IO.pure(ProviderAnswer, ProviderRefused{reason})
    case ProviderOutput{value, status}: IO.pure(ProviderAnswer, ProviderRefused{"nodeRuntimeProbeMalformed"})
    case ProviderRuntime{path, version}:
      do IO<ProviderAnswer>:
        spawned : Result<&1,&1,U32 & String,U32> <- Process.ProcessChild.spawn(
          project_policy_argv(path, executable), cwd, "/dev/null")
        provider_spawn(installed_provider_path(executable), cwd,
          project_policy_request(owner, worktree), spawned)

def invoke_frame(+executable: String, +runtime_path: String, +cwd: String,
                 frame: InvocationFrame) -> IO(ProviderAnswer):
  match frame:
    case NativeFrameRefused{reason}: IO.pure(ProviderAnswer, ProviderRefused{reason})
    case NativeFrameReady{value}:
      do IO<ProviderAnswer>:
        spawned : Result<&1,&1,U32 & String,U32> <- Process.ProcessChild.spawn(
          Process.argv([runtime_path, "--experimental-strip-types",
            installed_provider_path(executable)]), cwd, "/dev/null")
        provider_spawn(installed_provider_path(executable), cwd, value, spawned)

def invoke_runtime(+executable: String, +cwd: String, +invocation: Sel.Invocation,
                   runtime: ProviderAnswer) -> IO(ProviderAnswer):
  match runtime:
    case ProviderRefused{reason}: IO.pure(ProviderAnswer, ProviderRefused{reason})
    case ProviderRuntime{path, version}: invoke_frame(executable, path, cwd, invocation_frame(invocation))
    case ProviderOutput{value, status}: IO.pure(ProviderAnswer, ProviderRefused{"nodeRuntimeProbeMalformed"})

def invoke(+invocation: Sel.Invocation, +cwd: String) -> IO(ProviderAnswer):
  do IO<ProviderAnswer>:
    executable : String <- IO.try(String, Host.SessionLock.executable())
    runtime : ProviderAnswer <- resolve_node_runtime(cwd)
    invoke_runtime(executable, cwd, invocation, runtime)

def inventory_output(+status: String, +value: String) -> IO(Unit):
  match status:
    case "exit 0": IO.write(value)
    case other: IO.die(Unit, 2, value)

def inventory_answer(answer: ProviderAnswer) -> IO(Unit):
  match answer:
    case ProviderOutput{+value, +status}: inventory_output(status, value)
    case ProviderRefused{reason}: IO.die(Unit, 3, reason)
    case ProviderRuntime{path, version}: IO.die(Unit, 3, "nodeRuntimeProbeMalformed")

def inventory_runtime_answer(+executable: String, +cwd: String,
                             +runtime: ProviderAnswer) -> IO(ProviderAnswer):
  match runtime:
    case ProviderRefused{reason}: IO.pure(ProviderAnswer, ProviderRefused{reason})
    case ProviderOutput{value, status}: IO.pure(ProviderAnswer, ProviderRefused{"nodeRuntimeProbeMalformed"})
    case ProviderRuntime{path, version}:
      do IO<ProviderAnswer>:
        spawned : Result<&1,&1,U32 & String,U32> <- Process.ProcessChild.spawn(
          inventory_argv(path, executable), cwd, "/dev/null")
        provider_spawn(installed_provider_path(executable), cwd, "{}", spawned)

def inventory_with_runtime(+executable: String, +cwd: String,
                           runtime: ProviderAnswer) -> IO(Unit):
  do IO<Unit>:
    answer : ProviderAnswer <- inventory_runtime_answer(executable, cwd, runtime)
    inventory_answer(answer)

def engines(db: String) -> IO(Unit):
  do IO<Unit>:
    executable : String <- IO.try(String, Host.SessionLock.executable())
    runtime : ProviderAnswer <- resolve_node_runtime("/")
    inventory_with_runtime(executable, "/", runtime)

def project_policy_core_json(converted: CoreCodec.JsonConv) -> ProjectPolicyJson:
  match converted:
    case CoreCodec.JcRefused{condition}: ProjectPolicyJsonRefused{"projectPolicyJson:" ++ condition}
    case CoreCodec.JcJson{+value}: ProjectPolicyJsonReady{value}

def project_policy_json_decoded(raw: NativeRequest.RawDecode) -> ProjectPolicyJson:
  match raw:
    case NativeRequest.RawDecodeRefused{condition}: ProjectPolicyJsonRefused{"projectPolicyJson:" ++ condition}
    case NativeRequest.RawDecoded{value}:
      project_policy_core_json(CoreCodec.raw_to_json(value))

def project_policy_json_rows(+rows: String) -> ProjectPolicyJson:
  project_policy_json_decoded(NativeRequest.raw_rows(rows))

def managed_readiness_json(+bootstrap: ManagedQuery.Bootstrap,
                           +expected_binding: String,
                           decoded: ProjectPolicyJson) -> IO(ManagedQuery.KeeperReadiness):
  match decoded:
    case ProjectPolicyJsonRefused{reason}:
      IO.pure(ManagedQuery.KeeperReadiness,
        ManagedQuery.KeeperObserverUnavailable{"readinessJson:" ++ reason})
    case ProjectPolicyJsonReady{+value}:
      IO.pure(ManagedQuery.KeeperReadiness,
        ManagedQuery.keeper_readiness_from_host(bootstrap, expected_binding,
          ManagedQuery.bootstrap_owner_witness(bootstrap), value))

def managed_readiness_rows(+bootstrap: ManagedQuery.Bootstrap,
                           +expected_binding: String,
                           result: Result<&1,&1,U32 & String,String>) -> IO(ManagedQuery.KeeperReadiness):
  match result:
    case Fail{error}: IO.pure(ManagedQuery.KeeperReadiness,
      ManagedQuery.KeeperObserverUnavailable{"readinessDecode"})
    case Done{+rows}: managed_readiness_json(bootstrap, expected_binding,
      project_policy_json_rows(rows))

def managed_readiness_digest(+db: String, +binding: String,
                             +bootstrap: ManagedQuery.Bootstrap,
                             +host_json: String,
                             result: Result<&1,&1,U32 & String,String>) -> IO(ManagedQuery.KeeperReadiness):
  match result:
    case Fail{error}: IO.pure(ManagedQuery.KeeperReadiness,
      ManagedQuery.KeeperObserverUnavailable{"bootstrapBinding"})
    case Done{+expected_binding}:
      do IO<ManagedQuery.KeeperReadiness>:
        rows : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding,
          Req.json_tree_sql(host_json))
        managed_readiness_rows(bootstrap, expected_binding, rows)

def decode_managed_readiness(+db: String, +binding: String,
                             +bootstrap: ManagedQuery.Bootstrap,
                             +host_json: String) -> IO(ManagedQuery.KeeperReadiness):
  do IO<ManagedQuery.KeeperReadiness>:
    digest : Result<&1,&1,U32 & String,String> <- ContextIdentity.role_guard_key(
      ManagedQuery.bootstrap_text(bootstrap))
    managed_readiness_digest(db, binding, bootstrap, host_json, digest)

def managed_bootstrap_persisted(+owner: String, +worktree: String, +query: String,
                               +path: String, decoded: ProjectPolicyJson) -> Bool:
  match decoded:
    case ProjectPolicyJsonRefused{reason}: False{}
    case ProjectPolicyJsonReady{+value}:
      Bool.and(String.eq(boundary_text(value, "status"), "persisted"),
      Bool.and(String.eq(boundary_text(value, "owner"), owner),
      Bool.and(String.eq(boundary_text(value, "worktree"), worktree),
      Bool.and(String.eq(boundary_text(value, "query"), query),
      Bool.and(String.eq(boundary_text(value, "path"), path),
        Nat.is_eq(String.length(boundary_text(value, "sha256")), 64n))))))

def managed_bootstrap_persist_answer(+owner: String, +worktree: String,
                                    +query: String, +path: String,
                                    answer: ProviderAnswer) -> Bool:
  match answer:
    case ProviderRefused{reason}: False{}
    case ProviderRuntime{path, version}: False{}
    case ProviderOutput{+value, +status}:
      Bool.and(String.eq(status, "exit 0"),
        managed_bootstrap_persisted(owner, worktree, query, path,
          project_policy_json_rows(value)))

def managed_bootstrap_digest_result(+owner: String, +worktree: String,
                                    +query: String, +path: String,
                                    +bootstrap_text: String,
                                    answer: ProviderAnswer) -> IO(String):
  Bool.pick(IO(String), managed_bootstrap_persist_answer(owner, worktree,
    query, path, answer),
    IO.try(String, ContextIdentity.role_guard_key(bootstrap_text ++ "\n")),
    IO.die(String, 3, "managedBootstrapPersistence"))

def persist_managed_bootstrap(+executable: String, +runtime_path: String,
                              +cwd: String, +owner: String,
                              +worktree: String, +query: String,
                              +path: String, +bootstrap: ManagedQuery.Bootstrap)
                              -> IO(String):
  do IO<String>:
    spawned : Result<&1,&1,U32 & String,U32> <- Process.ProcessChild.spawn(
      query_bootstrap_argv(runtime_path, executable), cwd, "/dev/null")
    answer : ProviderAnswer <- provider_spawn(installed_provider_path(executable),
      cwd, query_bootstrap_request(owner, worktree, query,
        ManagedQuery.bootstrap_text(bootstrap)), spawned)
    managed_bootstrap_digest_result(owner, worktree, query, path,
      ManagedQuery.bootstrap_text(bootstrap), answer)

def query_source_json(+owner: String, +worktree: String,
                      decoded: ProjectPolicyJson) -> BoundaryPath:
  match decoded:
    case ProjectPolicyJsonRefused{reason}: BoundaryPathRefused{reason}
    case ProjectPolicyJsonReady{+value}:
      Bool.pick(BoundaryPath,
        Bool.and(String.eq(boundary_text(value, "status"), "examined"),
          Bool.and(String.eq(boundary_text(value, "owner"), owner),
            String.eq(boundary_text(value, "worktree"), worktree))),
        Bool.pick(BoundaryPath, String.is_empty(boundary_text(value, "identity")),
          BoundaryPathRefused{"querySourceIdentityMissing"},
          BoundaryPathReady{boundary_text(value, "identity")}),
        BoundaryPathRefused{"querySourceObservationMismatch"})

def query_artifact_json(+owner: String, +worktree: String, +query: String,
                        decoded: ProjectPolicyJson) -> BoundaryPath:
  match decoded:
    case ProjectPolicyJsonRefused{reason}: BoundaryPathRefused{reason}
    case ProjectPolicyJsonReady{+value}:
      Bool.pick(BoundaryPath,
        Bool.and(String.eq(boundary_text(value, "status"), "prepared"),
          Bool.and(String.eq(boundary_text(value, "owner"), owner),
            Bool.and(String.eq(boundary_text(value, "worktree"), worktree),
              String.eq(boundary_text(value, "query"), query)))),
        Bool.pick(BoundaryPath, String.is_empty(boundary_text(value, "path")),
          BoundaryPathRefused{"queryArtifactPathMissing"},
          BoundaryPathReady{boundary_text(value, "path")}),
        BoundaryPathRefused{"queryArtifactObservationMismatch"})

def query_boundary_decoded(+owner: String, +worktree: String, +query: String,
                           +source: Bool, decoded: ProjectPolicyJson) -> IO(BoundaryPath):
  match decoded:
    case ProjectPolicyJsonRefused{reason}:
      IO.pure(BoundaryPath, BoundaryPathRefused{reason})
    case ProjectPolicyJsonReady{+value}:
      IO.pure(BoundaryPath, Bool.pick(BoundaryPath, source,
        query_source_json(owner, worktree, ProjectPolicyJsonReady{value}),
        query_artifact_json(owner, worktree, query, ProjectPolicyJsonReady{value})))

def query_boundary_rows(+db: String, +binding: String, +owner: String,
                        +worktree: String, +query: String, +source: Bool,
                        result: Result<&1,&1,U32 & String,String>) -> IO(BoundaryPath):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(BoundaryPath, BoundaryPathRefused{"queryBoundaryDecodeRead"})
    case Done{+rows}:
      query_boundary_decoded(owner, worktree, query, source,
        project_policy_json_rows(rows))

def query_boundary_output(+db: String, +binding: String, +owner: String,
                         +worktree: String, +query: String,
                         +source: Bool, +answer: ProviderAnswer) -> IO(BoundaryPath):
  match answer:
    case ProviderRefused{reason}: IO.pure(BoundaryPath, BoundaryPathRefused{reason})
    case ProviderRuntime{path, version}: IO.pure(BoundaryPath, BoundaryPathRefused{"queryBoundaryRuntimeMalformed"})
    case ProviderOutput{+value, +status}:
      Bool.pick(IO(BoundaryPath), String.eq(status, "exit 0"),
        do IO<BoundaryPath>:
          result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding,
            Req.json_tree_sql(value))
          query_boundary_rows(db, binding, owner, worktree, query, source, result),
        IO.pure(BoundaryPath, BoundaryPathRefused{"queryBoundaryProcessRefused"}))

def query_boundary_runtime_answer(+db: String, +binding: String, +executable: String,
                                  +cwd: String, +owner: String, +worktree: String,
                                  +query: String, +source: Bool, +request: String,
                                  runtime: ProviderAnswer) -> IO(BoundaryPath):
  match runtime:
    case ProviderRefused{reason}: IO.pure(BoundaryPath, BoundaryPathRefused{reason})
    case ProviderOutput{value, status}: IO.pure(BoundaryPath, BoundaryPathRefused{"queryBoundaryRuntimeMalformed"})
    case ProviderRuntime{+path, +version}:
      do IO<BoundaryPath>:
        spawned : Result<&1,&1,U32 & String,U32> <- Process.ProcessChild.spawn(
          Bool.pick(String, source, query_source_argv(path, executable),
            query_artifact_argv(path, executable)), cwd, "/dev/null")
        answer : ProviderAnswer <- provider_spawn(installed_provider_path(executable), cwd, request, spawned)
        query_boundary_output(db, binding, owner, worktree, query, source, answer)

def query_boundary(+db: String, +binding: String, +executable: String,
                   +cwd: String, +owner: String, +worktree: String,
                   +query: String, +source: Bool, +request: String,
                   runtime: ProviderAnswer) -> IO(BoundaryPath):
  query_boundary_runtime_answer(db, binding, executable, cwd, owner, worktree,
    query, source, request, runtime)

def project_policy_is_present(observation: NativePolicy.PolicyObservation) -> Bool:
  match observation:
    case NativePolicy.PolicyPresent{owner, worktree, path, sha256, bytes}: True{}
    case NativePolicy.PolicyAbsent{owner, worktree, path}: False{}

def project_policy_identity_result(+observation: NativePolicy.PolicyObservation,
                                   identity: NativePolicy.PolicySelectionIdentity) -> ProjectPolicyAnswer:
  match identity:
    case NativePolicy.PolicySelectionRefused{condition}: ProjectPolicyRefused{condition}
    case NativePolicy.PolicySelectionRead{value}:
      Bool.pick(ProjectPolicyAnswer, project_policy_is_present(observation),
        ProjectPolicyReady{NativePolicy.ProjectPolicy{Eng.ss_empty(), Eng.ss_empty()}, value},
        ProjectPolicyRefused{"projectPolicyObservationMismatch"})
    case NativePolicy.PolicySelectionMissing{value}:
      Bool.pick(ProjectPolicyAnswer, project_policy_is_present(observation),
        ProjectPolicyRefused{"projectPolicyObservationMismatch"},
        ProjectPolicyReady{NativePolicy.ProjectPolicy{Eng.ss_empty(), Eng.ss_empty()}, value})

def project_policy_identity(+observation: NativePolicy.PolicyObservation) -> ProjectPolicyAnswer:
  project_policy_identity_result(observation, NativePolicy.selection_identity(observation))

def project_policy_document_identity(+observation: NativePolicy.PolicyObservation,
                                    +policy: NativePolicy.ProjectPolicy,
                                    identity: NativePolicy.PolicySelectionIdentity) -> ProjectPolicyAnswer:
  match identity:
    case NativePolicy.PolicySelectionRead{identity}: ProjectPolicyReady{policy, identity}
    case other: ProjectPolicyRefused{"projectPolicyIdentityUnavailable"}

def project_policy_document_decoded(+observation: NativePolicy.PolicyObservation,
                                    decoded: NativePolicy.PolicyDecode) -> ProjectPolicyAnswer:
  match decoded:
    case NativePolicy.PolicyRefused{condition}: ProjectPolicyRefused{condition}
    case NativePolicy.PolicyDecoded{+policy}:
      project_policy_document_identity(observation, policy,
        NativePolicy.selection_identity(observation))

def project_policy_document(+observation: NativePolicy.PolicyObservation,
                            value: J.Json) -> ProjectPolicyAnswer:
  project_policy_document_decoded(observation, NativePolicy.decode(value))

def project_policy_bytes_json(+observation: NativePolicy.PolicyObservation,
                              decoded: ProjectPolicyJson) -> IO(ProjectPolicyAnswer):
  match decoded:
    case ProjectPolicyJsonRefused{reason}:
      IO.pure(ProjectPolicyAnswer, ProjectPolicyRefused{reason})
    case ProjectPolicyJsonReady{value}:
      IO.pure(ProjectPolicyAnswer, project_policy_document(observation, value))

def project_policy_bytes_result(+db: String, +binding: String,
                                +observation: NativePolicy.PolicyObservation,
                                result: Result<&1,&1,U32 & String,String>) -> IO(ProjectPolicyAnswer):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(ProjectPolicyAnswer, ProjectPolicyRefused{"projectPolicyDocumentRead"})
    case Done{+rows}:
      project_policy_bytes_json(observation, project_policy_json_rows(rows))

def project_policy_observation_decoded(+db: String, +binding: String,
                                       observation: NativePolicy.PolicyObservation) -> IO(ProjectPolicyAnswer):
  match observation:
    case NativePolicy.PolicyAbsent{+owner, +worktree, +path}:
      IO.pure(ProjectPolicyAnswer, project_policy_identity(observation))
    case NativePolicy.PolicyPresent{+owner, +worktree, +path, +sha256, +bytes}:
      do IO<ProjectPolicyAnswer>:
        result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding,
          Req.json_tree_sql(bytes))
        project_policy_bytes_result(db, binding, observation, result)

def project_policy_observation_result(+db: String, +binding: String,
                                      +owner: String, +worktree: String,
                                      decoded: NativePolicy.PolicyObservationDecode) -> IO(ProjectPolicyAnswer):
  match decoded:
    case NativePolicy.PolicyObservationRefused{condition}:
      IO.pure(ProjectPolicyAnswer, ProjectPolicyRefused{condition})
    case NativePolicy.PolicyObservationDecoded{+observation}:
      project_policy_observation_decoded(db, binding, observation)

def project_policy_observation_value(+db: String, +binding: String,
                                     +owner: String, +worktree: String,
                                     value: J.Json) -> IO(ProjectPolicyAnswer):
  project_policy_observation_result(db, binding, owner, worktree,
    NativePolicy.decode_observation(value, owner, worktree))

def project_policy_output_json(+db: String, +binding: String, +owner: String,
                               +worktree: String, decoded: ProjectPolicyJson) -> IO(ProjectPolicyAnswer):
  match decoded:
    case ProjectPolicyJsonRefused{reason}:
      IO.pure(ProjectPolicyAnswer, ProjectPolicyRefused{reason})
    case ProjectPolicyJsonReady{+value}:
      project_policy_observation_value(db, binding, owner, worktree, value)

def project_policy_output_rows(+db: String, +binding: String, +owner: String,
                               +worktree: String, +value: String,
                               result: Result<&1,&1,U32 & String,String>) -> IO(ProjectPolicyAnswer):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(ProjectPolicyAnswer, ProjectPolicyRefused{"projectPolicyObservationRead"})
    case Done{+rows}:
      project_policy_output_json(db, binding, owner, worktree,
        project_policy_json_rows(rows))

def project_policy_output(+db: String, +binding: String, +owner: String,
                          +worktree: String, answer: ProviderAnswer) -> IO(ProjectPolicyAnswer):
  match answer:
    case ProviderRefused{reason}: IO.pure(ProjectPolicyAnswer, ProjectPolicyRefused{reason})
    case ProviderRuntime{path, version}: IO.pure(ProjectPolicyAnswer, ProjectPolicyRefused{"projectPolicyRuntimeMalformed"})
    case ProviderOutput{+value, +status}:
      Bool.pick(IO(ProjectPolicyAnswer), String.eq(status, "exit 0"),
        do IO<ProjectPolicyAnswer>:
          result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding,
            Req.json_tree_sql(value))
          project_policy_output_rows(db, binding, owner, worktree, value, result),
        IO.pure(ProjectPolicyAnswer, ProjectPolicyRefused{"projectPolicyProcessRefused"}))

def observe_project_policy(+db: String, +binding: String, +executable: String,
                           +cwd: String, +owner: String, +worktree: String,
                           runtime: ProviderAnswer) -> IO(ProjectPolicyAnswer):
  do IO<ProjectPolicyAnswer>:
    answer : ProviderAnswer <- project_policy_runtime_answer(executable, cwd,
      owner, worktree, runtime)
    project_policy_output(db, binding, owner, worktree, answer)

def selected_plan_frame(+plan: Sel.Plan, +query: String, +owner: String,
                        +canonical: String) -> StepInvocationFrame:
  match plan:
    case Sel.Plan{primary, common, steps, effective_effects, inputs, available,
        policy_identity}:
      invocation_for_step(plan, Sel.bind_module(primary),
        Sel.bind_digest(primary), Sel.bind_operation(primary), query, owner,
        canonical, "starter", "0")

def verification_result(+plan: Sel.Plan, +result_schema: String,
                        +db: String, +binding: String, +owner: String,
                        +query: String, +canonical: String, +cwd: String,
                        +source_identity: String, +artifact_path: String,
                        +invocation_text: String, +executable: String,
                        +runtime_path: String,
                        verification: InvocationVerification) -> IO(Unit):
  match verification:
    case InvocationVerificationRefused{reason}:
      IO.die(Unit, 3, "invocationVerification:" ++ reason)
    case InvocationVerified{artifact_sha256}:
      managed_query_verified(plan, result_schema, db, binding, owner, query,
        canonical, cwd, source_identity, artifact_path, invocation_text,
        executable, runtime_path, artifact_sha256)

def verify_selected_plan(+plan: Sel.Plan, +result_schema: String,
                         +db: String, +binding: String, +owner: String,
                         +query: String, +canonical: String, +cwd: String,
                         +source_identity: String, +artifact_path: String,
                         +executable: String, +runtime_path: String) -> IO(Unit):
  match plan:
    case Sel.Plan{primary, common, steps, effective_effects, inputs, available,
        policy_identity}:
      verify_selected_plan_frame(plan, result_schema, db, binding, owner,
        query, canonical, cwd, source_identity, artifact_path,
        executable, runtime_path,
        selected_plan_frame(plan, query, owner, canonical))

def verify_selected_plan_frame(+plan: Sel.Plan, +result_schema: String,
                               +db: String, +binding: String, +owner: String,
                               +query: String, +canonical: String, +cwd: String,
                               +source_identity: String, +artifact_path: String,
                               +executable: String, +runtime_path: String,
                               step_frame: StepInvocationFrame) -> IO(Unit):
  match plan:
    case Sel.Plan{primary, common, steps, effective_effects, inputs, available,
        policy_identity}:
      match step_frame:
        case NativeStepRefused{module_id, declaration_digest, operation}:
          IO.die(Unit, 3, "stepInvocationUnavailable:" ++ module_id ++ ":" ++ operation)
        case NativeStepFrame{frame}:
          match frame:
            case NativeFrameRefused{reason}: IO.die(Unit, 3, reason)
            case NativeFrameReady{+value}:
              do IO<Unit>:
                verification : InvocationVerification <- verify_invocation_frame(db,
                  binding, query, owner, cwd, executable, runtime_path,
                  Sel.bind_module(primary), Sel.bind_digest(primary), NativeFrameReady{value})
                verification_result(plan, result_schema, db, binding, owner, query,
                  canonical, cwd, source_identity, artifact_path, value,
                  executable, runtime_path, verification)

def query_selection_answer(+db: String, +binding: String, +owner: String,
                           +query: String, +canonical: String, +cwd: String,
                           identity: Sel.ProjectPolicyIdentity,
                           +source_identity: String, +artifact_path: String,
                           +executable: String, +runtime_path: String,
                           +verdict: Sel.Verdict) -> IO(Unit):
  match verdict:
    case Sel.VerdictRefused{stage, +reason}:
      IO.die(Unit, 3, "selection:" ++ stage ++ ":" ++ Sel.rq_code(reason)
        ++ ":" ++ Sel.rq_detail(reason))
    case Sel.VerdictAdmitted{plan, result_schema}:
      verify_selected_plan(plan, result_schema, db, binding, owner, query,
        canonical, cwd, source_identity, artifact_path, executable, runtime_path)

def project_selection(+db: String, +binding: String, +owner: String, +query: String,
                      +canonical: String, +cwd: String, +catalog: Decl.Cat,
                      +inventory: Decl.Inv,
                      +operands: Sel.RequestOperands, +installed: Eng.SS,
                      +disabled: Eng.SS, +preferred: Eng.SS,
                      +identity: Sel.ProjectPolicyIdentity,
                      +source_path: String, +artifact_path: String,
                      +executable: String, +runtime_path: String) -> IO(Unit):
  query_selection_answer(db, binding, owner, query, canonical, cwd,
    identity, source_path, artifact_path, executable, runtime_path,
    Sel.request_verdict(catalog,
    Sel.sel_inputs(operands, Sel.ProjectState{Eng.ss_one(source_path), Eng.ss_empty(),
      installed, disabled, preferred, identity}), inventory, Sel.CapNil{}))

def project_selection_policy(+db: String, +binding: String, +owner: String,
                             +query: String, +canonical: String, +cwd: String,
                             +catalog: Decl.Cat, +inventory: Decl.Inv,
                             +operands: Sel.RequestOperands, +installed: Eng.SS,
                             +identity: Sel.ProjectPolicyIdentity,
                             +source_path: String,
                             +artifact_path: String, +executable: String,
                             +runtime_path: String,
                             project_policy: NativePolicy.ProjectPolicy) -> IO(Unit):
  match project_policy:
    case NativePolicy.ProjectPolicy{disabled, preferred}:
      project_selection(db, binding, owner, query, canonical, cwd, catalog,
        inventory, operands, installed, disabled, preferred, identity, source_path,
        artifact_path, executable, runtime_path)

def query_catalog_admitted(+db: String, +binding: String, +owner: String, +query: String,
                           catalog: NativeCatalog.CatalogDecode,
                           +canonical: String, +cwd: String,
                           operands: Sel.RequestOperands,
                           policy: ProjectPolicyAnswer,
                           source: BoundaryPath, artifact: BoundaryPath,
                           +executable: String, +runtime_path: String) -> IO(Unit):
  match catalog:
    case NativeCatalog.CatalogRefused{condition}:
      IO.die(Unit, 3, "catalog:" ++ condition)
    case NativeCatalog.CatalogDecoded{catalog, inventory, installed}:
      match policy:
        case ProjectPolicyRefused{reason}: IO.die(Unit, 3, reason)
        case ProjectPolicyReady{project_policy, identity}:
          match source:
            case BoundaryPathRefused{reason}: IO.die(Unit, 3, reason)
            case BoundaryPathReady{+verified_path}:
              match artifact:
                case BoundaryPathRefused{reason}: IO.die(Unit, 3, reason)
                case BoundaryPathReady{+artifact_path}:
                  project_selection_policy(db, binding, owner, query, canonical,
                    cwd, catalog, inventory, operands, installed, identity,
                    verified_path, artifact_path, executable, runtime_path, project_policy)

def query_catalog_decoded(+db: String, +binding: String, +owner: String, +query: String,
                          catalog: NativeCatalog.CatalogDecode,
                          request: NativeRequest.RequestDecode,
                          policy: ProjectPolicyAnswer,
                          source: BoundaryPath, artifact: BoundaryPath,
                          +executable: String, +runtime_path: String) -> IO(Unit):
  match request:
    case NativeRequest.RequestDecodeRefused{condition}:
      IO.die(Unit, 3, "request:" ++ condition)
    case NativeRequest.RequestDecoded{canonical, operands, operation_chain, cwd, source_path}:
      query_catalog_admitted(db, binding, owner, query, catalog, canonical,
        cwd, operands, policy, source, artifact, executable, runtime_path)

def query_catalog_rows_result(+db: String, +binding: String, +owner: String, +query: String,
                              request: NativeRequest.RequestDecode,
                              policy: ProjectPolicyAnswer,
                              source: BoundaryPath, artifact: BoundaryPath,
                              +executable: String, +runtime_path: String,
                              result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.die(Unit, 3, "providerInventoryDecodeRead")
    case Done{+rows}:
      query_catalog_decoded(db, binding, owner, query,
        NativeCatalog.inventory_rows(rows), request, policy, source, artifact,
        executable, runtime_path)

def query_catalog_rows(+db: String, +binding: String, +owner: String, +query: String,
                       +value: String,
                       request: NativeRequest.RequestDecode,
                       policy: ProjectPolicyAnswer,
                       source: BoundaryPath, artifact: BoundaryPath,
                       +executable: String, +runtime_path: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding,
      Req.json_tree_sql(value))
    query_catalog_rows_result(db, binding, owner, query, request, policy,
      source, artifact, executable, runtime_path, result)

def query_catalog_output(+db: String, +binding: String, +owner: String, +query: String,
                         request: NativeRequest.RequestDecode,
                         policy: ProjectPolicyAnswer, status: String,
                         value: String, source: BoundaryPath, artifact: BoundaryPath,
                         +executable: String, +runtime_path: String) -> IO(Unit):
  match status:
    case "exit 0": query_catalog_rows(db, binding, owner, query, value,
      request, policy, source, artifact, executable, runtime_path)
    case other: IO.die(Unit, 3, "providerInventory:" ++ value)

def query_catalog_result(+db: String, +binding: String, +owner: String, +query: String,
                         policy: ProjectPolicyAnswer,
                         answer: ProviderAnswer,
                         request: NativeRequest.RequestDecode,
                         source: BoundaryPath, artifact: BoundaryPath,
                         +executable: String, +runtime_path: String) -> IO(Unit):
  match answer:
    case ProviderRefused{reason}: IO.die(Unit, 3, "providerInventory:" ++ reason)
    case ProviderRuntime{path, version}: IO.die(Unit, 3, "providerInventoryMalformed")
    case ProviderOutput{value, status}: query_catalog_output(db, binding, owner,
      query, request, policy, status, value, source, artifact, executable, runtime_path)

def query_environment_runtime(+db: String, +binding: String, +owner: String,
                              +query: String, +cwd: String, +worktree: String,
                              +request: NativeRequest.RequestDecode,
                              +executable: String, runtime: ProviderAnswer) -> IO(Unit):
  match runtime:
    case ProviderRefused{reason}: IO.die(Unit, 3, reason)
    case ProviderOutput{value, status}: IO.die(Unit, 3, "nodeRuntimeProbeMalformed")
    case ProviderRuntime{+path, +version}:
      do IO<Unit>:
        answer : ProviderAnswer <- inventory_runtime_answer(executable, cwd,
          ProviderRuntime{path, version})
        policy : ProjectPolicyAnswer <- observe_project_policy(db, binding,
          executable, cwd, owner, worktree, ProviderRuntime{path, version})
        source : BoundaryPath <- query_boundary(db, binding, executable, cwd,
          owner, worktree, query, True{},
          query_source_request(owner, worktree, NativeRequest.decoded_cwd(request),
            NativeRequest.decoded_subject_path(request)), ProviderRuntime{path, version})
        artifact : BoundaryPath <- query_boundary(db, binding, executable, cwd,
          owner, worktree, query, False{},
          query_artifact_request(owner, worktree, query), ProviderRuntime{path, version})
        query_catalog_result(db, binding, owner, query, policy, answer,
          request, source, artifact, executable, path)

def query_request_environment(db: String, binding: String, owner: String, query: String,
                              cwd: String, worktree: String,
                              request: NativeRequest.RequestDecode) -> IO(Unit):
  match request:
    case NativeRequest.RequestDecodeRefused{condition}:
      IO.die(Unit, 3, "request:" ++ condition)
    case NativeRequest.RequestDecoded{canonical, operands, operation_chain, +cwd, source_path}:
      do IO<Unit>:
        executable : String <- IO.try(String, Host.SessionLock.executable())
        runtime : ProviderAnswer <- resolve_node_runtime(cwd)
        query_environment_runtime(db, binding, owner, query, cwd, worktree,
          request, executable, runtime)

def owner_root_matches(+workspace: String, root: G.GitOut) -> Bool:
  match root:
    case G.GBroken{detail}: False{}
    case G.GRun{code, out}:
      Bool.and(U32.is_eq(code, 0), String.eq(Tx.trim_nl(out), workspace))

def request_worktree_matches(+workspace: String, root: G.GitOut) -> Bool:
  owner_root_matches(workspace, root)

def request_cwd_root_result(+db: String, +binding: String, +owner: String, +query: String,
                            +cwd: String, +request: NativeRequest.RequestDecode,
                            +workspace: String, root: G.GitOut) -> IO(Unit):
  match root:
    case G.GBroken{detail}: IO.die(Unit, 3, "requestCwdWorktreeUnavailable")
    case G.GRun{code, +out}:
      Bool.pick(IO(Unit), request_worktree_matches(workspace, G.GRun{code, out}),
        query_request_environment(db, binding, owner, query, cwd, workspace, request),
        IO.die(Unit, 3, "requestCwdOutsideOwnerWorktree"))

def request_cwd_root(+db: String, +binding: String, +owner: String, +query: String,
                     +cwd: String, +request: NativeRequest.RequestDecode,
                     +workspace: String, root: G.GitOut) -> IO(Unit):
  match root:
    case G.GBroken{detail}: IO.die(Unit, 3, "ownerWorktreeRootUnavailable")
    case G.GRun{code, +out}:
      Bool.pick(IO(Unit), request_worktree_matches(workspace, G.GRun{code, out}),
        do IO<Unit>:
          cwd_root : G.GitOut <- Git.runGit(cwd, ["rev-parse", "--show-toplevel"])
          request_cwd_root_result(db, binding, owner, query, cwd, request, workspace, cwd_root),
        IO.die(Unit, 3, "ownerWorktreeRootMismatch"))

def owner_workspace_root(+db: String, +binding: String, +owner: String, +query: String,
                         +cwd: String, +request: NativeRequest.RequestDecode,
                         workspace: OwnerWorkspace) -> IO(Unit):
  match workspace:
    case OwnerWorkspaceRefused{reason}: IO.die(Unit, 3, reason)
    case OwnerWorkspaceReady{+path}:
      do IO<Unit>:
        root : G.GitOut <- Git.runGit(path, ["rev-parse", "--show-toplevel"])
        request_cwd_root(db, binding, owner, query, cwd, request, path, root)

def owner_workspace_loaded(+db: String, +binding: String, +owner: String, +query: String,
                           +cwd: String, +request: NativeRequest.RequestDecode,
                           workspace: OwnerWorkspace) -> IO(Unit):
  owner_workspace_root(db, binding, owner, query, cwd, request, workspace)

def owner_workspace_read(+db: String, +binding: String, +owner: String, +query: String,
                         +cwd: String, +request: NativeRequest.RequestDecode) -> IO(Unit):
  do IO<Unit>:
    workspace : OwnerWorkspace <- read_owner_workspace(db, binding, owner)
    owner_workspace_loaded(db, binding, owner, query, cwd, request, workspace)

def query_request_result(db: String, binding: String, owner: String, query: String,
                         result: NativeRequest.RequestDecode) -> IO(Unit):
  match result:
    case NativeRequest.RequestDecodeRefused{condition}:
      IO.die(Unit, 3, "request:" ++ condition)
    case NativeRequest.RequestDecoded{canonical, operands, operation_chain, +cwd, source_path}:
      owner_workspace_read(db, binding, owner, query, cwd, result)

def query_binding_result(+db: String, +owner: String, +query: String, path: String,
                          binding_result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match binding_result:
    case Fail{error}:
      match error:
        case (code, detail): IO.die(Unit, 3, "databaseBindingUnavailable")
    case Done{+binding}:
      do IO<Unit>:
        request : NativeRequest.RequestDecode <- NativeRequest.read_file(db, binding, path)
        query_request_result(db, binding, owner, query, request)

def query_file(+db: String, +owner: String, +query: String, path: String) -> IO(Unit):
  do IO<Unit>:
    binding : Result<&1,&1,U32 & String,String> <- DB.Sql.binding(db)
    query_binding_result(db, owner, query, path, binding)

def result_retained(query: String, retained: ContextService.Retained) -> IO(Unit):
  match retained:
    case ContextService.RetainedFound{state, envelope}:
      IO.write(envelope ++ "\n")
    case ContextService.RetainedAbsent{query}:
      IO.die(Unit, 3, "contextResultAbsent:" ++ query)
    case ContextService.RetainedUnreadable{stage, answer}:
      IO.die(Unit, 3, "contextResultUnreadable:" ++ stage)
    case ContextService.RetainedRefused{code, detail}:
      IO.die(Unit, code, detail)

def result_binding(+db: String, +query: String,
                   result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.die(Unit, code, detail)
    case Done{+binding}:
      do IO<Unit>:
        retained : ContextService.Retained <- ContextService.retained(db, binding, query)
        result_retained(query, retained)

def result(+db: String, +query: String) -> IO(Unit):
  do IO<Unit>:
    binding : Result<&1,&1,U32 & String,String> <- DB.Sql.binding(db)
    result_binding(db, query, binding)
