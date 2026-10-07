# Native context entry points and the selected-provider invocation frame.
# The frame is derived only from the frozen Core invocation. The CLI remains
# unavailable until a selected Bend2 provider can consume it and return events.
import Base
import ./codec-wire.bend as Codec
import ./engines-select.bend as Sel
import ./engines-wire.bend as EnginesWire

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

def unavailable(command: String) -> IO(Unit):
  IO.die(Unit, 3, "Native Bend2 context provider is unavailable for " ++ command ++ "; no query was admitted.")

def engines(db: String) -> IO(Unit):
  unavailable("context-engines")

def query_file(db: String, owner: String, query: String, path: String) -> IO(Unit):
  unavailable("context-query-file")

def result(db: String, query: String) -> IO(Unit):
  unavailable("context-result")
