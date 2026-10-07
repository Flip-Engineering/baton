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
import ../json/canonical.bend as J
import ./request.bend as Req
import ../coordinator/commands.bend as C
import ../host/sqlite.bend as DB
import ../host/process.bend as Process
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

def query_source_argv(+runtime_path: String, +executable: String) -> String:
  Process.argv([runtime_path, "--experimental-strip-types",
    installed_provider_path(executable), "--examine-query-source"])

def query_artifact_request(+owner: String, +worktree: String, +query: String) -> String:
  J.json_text(J.Jobj{J.Jpair{"owner", J.Jstr{owner},
    J.Jpair{"worktree", J.Jstr{worktree},
      J.Jpair{"query", J.Jstr{query}, J.Jnil{}}}}})

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
  "SELECT workspace FROM sessions WHERE id=" ++ C.q(owner) ++ ";"

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

def query_selection_answer(+verdict: Sel.Verdict) -> IO(Unit):
  match verdict:
    case Sel.VerdictRefused{stage, +reason}:
      IO.die(Unit, 3, "selection:" ++ stage ++ ":" ++ Sel.rq_code(reason)
        ++ ":" ++ Sel.rq_detail(reason))
    case Sel.VerdictAdmitted{plan, result_schema}:
      IO.die(Unit, 3, "selectedPlanRequiresPreparedExecutionLifecycle")

def project_selection(+db: String, +binding: String, +owner: String, +query: String,
                      +canonical: String, +cwd: String, +catalog: Decl.Cat,
                      +inventory: Decl.Inv,
                      +operands: Sel.RequestOperands, +installed: Eng.SS,
                      +disabled: Eng.SS, +preferred: Eng.SS,
                      +identity: Sel.ProjectPolicyIdentity,
                      +source_path: String) -> IO(Unit):
  query_selection_answer(Sel.request_verdict(catalog,
    Sel.sel_inputs(operands, Sel.ProjectState{Eng.ss_one(source_path), Eng.ss_empty(),
      installed, disabled, preferred, identity}), inventory, Sel.CapNil{}))

def query_catalog_admitted(+db: String, +binding: String, +owner: String, +query: String,
                           catalog: NativeCatalog.CatalogDecode,
                           +canonical: String, +cwd: String,
                           operands: Sel.RequestOperands,
                           policy: ProjectPolicyAnswer,
                           source: BoundaryPath) -> IO(Unit):
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
              match project_policy:
                case NativePolicy.ProjectPolicy{disabled, preferred}:
                  project_selection(db, binding, owner, query, canonical, cwd,
                    catalog, inventory, operands, installed, disabled, preferred, identity,
                    verified_path)

def query_catalog_decoded(+db: String, +binding: String, +owner: String, +query: String,
                          catalog: NativeCatalog.CatalogDecode,
                          request: NativeRequest.RequestDecode,
                          policy: ProjectPolicyAnswer,
                          source: BoundaryPath) -> IO(Unit):
  match request:
    case NativeRequest.RequestDecodeRefused{condition}:
      IO.die(Unit, 3, "request:" ++ condition)
    case NativeRequest.RequestDecoded{canonical, operands, operation_chain, cwd, source_path}:
      query_catalog_admitted(db, binding, owner, query, catalog, canonical,
        cwd, operands, policy, source)

def query_catalog_rows_result(+db: String, +binding: String, +owner: String, +query: String,
                              request: NativeRequest.RequestDecode,
                              policy: ProjectPolicyAnswer,
                              source: BoundaryPath,
                              result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.die(Unit, 3, "providerInventoryDecodeRead")
    case Done{+rows}:
      query_catalog_decoded(db, binding, owner, query,
        NativeCatalog.inventory_rows(rows), request, policy, source)

def query_catalog_rows(+db: String, +binding: String, +owner: String, +query: String,
                       +value: String,
                       request: NativeRequest.RequestDecode,
                       policy: ProjectPolicyAnswer,
                       source: BoundaryPath) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding,
      Req.json_tree_sql(value))
    query_catalog_rows_result(db, binding, owner, query, request, policy,
      source, result)

def query_catalog_output(+db: String, +binding: String, +owner: String, +query: String,
                         request: NativeRequest.RequestDecode,
                         policy: ProjectPolicyAnswer, status: String,
                         value: String, source: BoundaryPath) -> IO(Unit):
  match status:
    case "exit 0": query_catalog_rows(db, binding, owner, query, value,
      request, policy, source)
    case other: IO.die(Unit, 3, "providerInventory:" ++ value)

def query_catalog_result(+db: String, +binding: String, +owner: String, +query: String,
                         policy: ProjectPolicyAnswer,
                         answer: ProviderAnswer,
                         request: NativeRequest.RequestDecode,
                         source: BoundaryPath) -> IO(Unit):
  match answer:
    case ProviderRefused{reason}: IO.die(Unit, 3, "providerInventory:" ++ reason)
    case ProviderRuntime{path, version}: IO.die(Unit, 3, "providerInventoryMalformed")
    case ProviderOutput{value, status}: query_catalog_output(db, binding, owner,
      query, request, policy, status, value, source)

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
        query_catalog_result(db, binding, owner, query, policy, answer,
          request, source)

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

def result(db: String, query: String) -> IO(Unit):
  IO.die(Unit, 3, "Native result lookup remains unavailable for " ++ query)
