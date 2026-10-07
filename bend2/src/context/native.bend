# Native context entry points and the selected-provider invocation frame.
# Provider execution receives only the frozen Core invocation and resolves its
# installed package from the executable prefix.
import Base
import ./codec-wire.bend as Codec
import ./engines-select.bend as Sel
import ./engines-wire.bend as EnginesWire
import ../host/process.bend as Process
import ../host/session-lock.bend as Host
import ../git/text.bend as Tx

type InvocationFrame is Data:
  NativeFrameReady{value: String}
  NativeFrameRefused{reason: String}

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

type ProviderAnswer is Data:
  ProviderOutput{value: String, status: String}
  ProviderRefused{reason: String}

type NodeRuntime is Data:
  NodeRuntimeReady{path: String, version: String}
  NodeRuntimeRefused{reason: String}

def absolute_node_path(+path: String) -> Bool:
  match path:
    case SNil{}: False{}
    case SCon{head, tail}: U32.is_eq(Char.to_u32(head), 47)

def node_runtime_fields(fields: List<String>) -> NodeRuntime:
  match fields:
    case +path <> +support <> +version <> Nil{}:
      Bool.pick(NodeRuntime,
        Bool.and(absolute_node_path(path), String.eq(support, "supported")),
        NodeRuntimeReady{path, version}, NodeRuntimeRefused{"nodeRuntimeUnsupported"})
    case other: NodeRuntimeRefused{"nodeRuntimeProbeMalformed"}

def node_runtime_status(+line: String, +status: String, extra: Maybe<String>) -> NodeRuntime:
  match extra:
    case Some{value}: NodeRuntimeRefused{"nodeRuntimeProbeSurplus"}
    case None{}:
      Bool.pick(NodeRuntime, String.eq(status, "exit 0"),
        node_runtime_fields(Tx.split_tabs(line)), NodeRuntimeRefused{"nodeRuntimeProbeExit"})

def node_runtime_wait(+line: String, extra: Maybe<String>,
                      waited: Result<&1,&1,U32 & String,String>) -> IO(NodeRuntime):
  match waited:
    case Fail{error}: IO.pure(NodeRuntime, NodeRuntimeRefused{"nodeRuntimeProbeWait"})
    case Done{+status}: IO.pure(NodeRuntime, node_runtime_status(line, status, extra))

def node_runtime_read_refused(waited: Result<&1,&1,U32 & String,String>) -> IO(NodeRuntime):
  match waited:
    case Fail{error}: IO.pure(NodeRuntime, NodeRuntimeRefused{"nodeRuntimeProbeWait"})
    case Done{status}: IO.pure(NodeRuntime, NodeRuntimeRefused{"nodeRuntimeProbeRead"})

def node_runtime_second(+handle: U32, +line: String,
                        second: Result<&1,&1,U32 & String,Maybe<String>>) -> IO(NodeRuntime):
  match second:
    case Fail{error}:
      do IO<NodeRuntime>:
        waited : Result<&1,&1,U32 & String,String> <- Process.ProcessChild.wait(handle)
        node_runtime_read_refused(waited)
    case Done{+extra}:
      do IO<NodeRuntime>:
        waited : Result<&1,&1,U32 & String,String> <- Process.ProcessChild.wait(handle)
        node_runtime_wait(line, extra, waited)

def node_runtime_after_first(+handle: U32, +line: String) -> IO(NodeRuntime):
  do IO<NodeRuntime>:
    second : Result<&1,&1,U32 & String,Maybe<String>> <- Process.ProcessChild.read_line(handle)
    node_runtime_second(handle, line, second)

def node_runtime_read(+handle: U32,
                      first: Result<&1,&1,U32 & String,Maybe<String>>) -> IO(NodeRuntime):
  match first:
    case Fail{error}:
      do IO<NodeRuntime>:
        waited : Result<&1,&1,U32 & String,String> <- Process.ProcessChild.wait(handle)
        node_runtime_wait("", None{}, waited)
    case Done{+line}:
      match line:
        case None{}:
          do IO<NodeRuntime>:
            waited : Result<&1,&1,U32 & String,String> <- Process.ProcessChild.wait(handle)
            node_runtime_wait("", None{}, waited)
        case Some{+value}: node_runtime_after_first(handle, value)

def node_runtime_started(result: Result<&1,&1,U32 & String,U32>) -> IO(NodeRuntime):
  match result:
    case Fail{error}: IO.pure(NodeRuntime, NodeRuntimeRefused{"nodeRuntimeProbeSpawn"})
    case Done{+handle}:
      do IO<NodeRuntime>:
        first : Result<&1,&1,U32 & String,Maybe<String>> <- Process.ProcessChild.read_line(handle)
        node_runtime_read(handle, first)

def resolve_node_runtime(+cwd: String) -> IO(NodeRuntime):
  do IO<NodeRuntime>:
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
                   runtime: NodeRuntime) -> IO(ProviderAnswer):
  match runtime:
    case NodeRuntimeRefused{reason}: IO.pure(ProviderAnswer, ProviderRefused{reason})
    case NodeRuntimeReady{path, version}: invoke_frame(executable, path, cwd, invocation_frame(invocation))

def invoke(+invocation: Sel.Invocation, +cwd: String) -> IO(ProviderAnswer):
  do IO<ProviderAnswer>:
    executable : String <- IO.try(String, Host.SessionLock.executable())
    runtime : NodeRuntime <- resolve_node_runtime(cwd)
    invoke_runtime(executable, cwd, invocation, runtime)

def unavailable(command: String) -> IO(Unit):
  IO.die(Unit, 3, "Native Bend2 context provider is unavailable for " ++ command ++ "; no query was admitted.")

def engines(db: String) -> IO(Unit):
  unavailable("context-engines")

def query_file(db: String, owner: String, query: String, path: String) -> IO(Unit):
  unavailable("context-query-file")

def result(db: String, query: String) -> IO(Unit):
  unavailable("context-result")
