# Native context entry points and the selected-provider invocation frame.
# Provider execution receives only the frozen Core invocation and resolves its
# installed package from the executable prefix.
import Base
import ./codec-wire.bend as Codec
import ./engines-select.bend as Sel
import ./engines-wire.bend as EnginesWire
import ./native-request.bend as NativeRequest
import ./native-catalog.bend as NativeCatalog
import ./request.bend as Req
import ../host/sqlite.bend as DB
import ../host/process.bend as Process
import ../host/session-lock.bend as Host
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
  executable_directory(executable) ++ "/../libexec/baton2/context-provider.mjs"

def inventory_argv(+runtime_path: String, +executable: String) -> String:
  Process.argv([runtime_path, "--experimental-strip-types",
    installed_provider_path(executable), "--inventory"])

type ProviderAnswer is Data:
  ProviderOutput{value: String, status: String}
  ProviderRefused{reason: String}
  ProviderRuntime{path: String, version: String}

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
                             runtime: ProviderAnswer) -> IO(ProviderAnswer):
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

def query_catalog_admitted(catalog: NativeCatalog.CatalogDecode) -> IO(Unit):
  match catalog:
    case NativeCatalog.CatalogRefused{condition}:
      IO.die(Unit, 3, "catalog:" ++ condition)
    case NativeCatalog.CatalogDecoded{catalog, inventory, installed}:
      IO.die(Unit, 3, "ownerBoundProjectCaptureRequired")

def query_catalog_decoded(catalog: NativeCatalog.CatalogDecode,
                          request: NativeRequest.RequestDecode) -> IO(Unit):
  match request:
    case NativeRequest.RequestDecodeRefused{condition}:
      IO.die(Unit, 3, "request:" ++ condition)
    case NativeRequest.RequestDecoded{canonical, operands, operation_chain, cwd, source_path}:
      query_catalog_admitted(catalog)

def query_catalog_rows_result(db: String, binding: String,
                              request: NativeRequest.RequestDecode,
                              result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.die(Unit, 3, "providerInventoryDecodeRead")
    case Done{+rows}:
      query_catalog_decoded(NativeCatalog.inventory_rows(rows), request)

def query_catalog_rows(db: String, binding: String, value: String,
                       request: NativeRequest.RequestDecode) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding,
      Req.json_tree_sql(value))
    query_catalog_rows_result(db, binding, request, result)

def query_catalog_result(db: String, binding: String, answer: ProviderAnswer,
                         request: NativeRequest.RequestDecode) -> IO(Unit):
  match answer:
    case ProviderRefused{reason}: IO.die(Unit, 3, "providerInventory:" ++ reason)
    case ProviderRuntime{path, version}: IO.die(Unit, 3, "providerInventoryMalformed")
    case ProviderOutput{value, status}:
      Bool.pick(IO(Unit), String.eq(status, "exit 0"),
        query_catalog_rows(db, binding, value, request),
        IO.die(Unit, 3, "providerInventory:" ++ value))

def query_request_result(db: String, binding: String, owner: String, query: String,
                         path: String, result: NativeRequest.RequestDecode) -> IO(Unit):
  match result:
    case NativeRequest.RequestDecodeRefused{condition}:
      IO.die(Unit, 3, "request:" ++ condition)
    case NativeRequest.RequestDecoded{canonical, operands, operation_chain, cwd, source_path}:
      do IO<Unit>:
        executable : String <- IO.try(String, Host.SessionLock.executable())
        runtime : ProviderAnswer <- resolve_node_runtime(cwd)
        answer : ProviderAnswer <- inventory_runtime_answer(executable, cwd, runtime)
        query_catalog_result(db, binding, answer, result)

def query_binding_result(db: String, owner: String, query: String, path: String,
                          binding_result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match binding_result:
    case Fail{error}:
      match error:
        case (code, detail): IO.die(Unit, 3, "databaseBindingUnavailable")
    case Done{+binding}:
      do IO<Unit>:
        request : NativeRequest.RequestDecode <- NativeRequest.read_file(db, binding, path)
        query_request_result(db, binding, owner, query, path, request)

def query_file(db: String, owner: String, query: String, path: String) -> IO(Unit):
  do IO<Unit>:
    binding : Result<&1,&1,U32 & String,String> <- DB.Sql.binding(db)
    query_binding_result(db, owner, query, path, binding)

def result(db: String, query: String) -> IO(Unit):
  IO.die(Unit, 3, "Native result lookup remains unavailable for " ++ query)
