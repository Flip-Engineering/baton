# Operative laws for the native selected-provider boundary.
import Base
import ./native.bend as Native
import ./engines-select.bend as Sel
import ./engines.bend as Eng
import ./engines-decl.bend as Decl

def fixture_invocation() -> Sel.Invocation:
  Sel.Invocation{"2", "query-1", "owner-1",
    Sel.MBind{"bend2", "rev-1", "decl-sha", "2", "sourceAnalysis",
      Decl.ArtsNil{}, Eng.SSNil{}}, "{}", Sel.StepsNil{}, Sel.CapNil{},
    "worker", "incarnation-1"}

law native_invocation_frame_preserves_typed_v2_values:
  {Native.invocation_frame(fixture_invocation()) == Native.NativeFrameReady{
    "{\"version\":2,\"query\":\"query-1\",\"owner\":\"owner-1\",\"moduleBinding\":{\"id\":\"bend2\",\"revision\":\"rev-1\",\"declarationDigest\":\"decl-sha\",\"protocolVersion\":\"2\",\"operation\":\"sourceAnalysis\",\"artifactIdentities\":[],\"schemaIdentities\":[]},\"request\":{},\"inputIdentities\":[],\"operationPlan\":[],\"role\":\"worker\",\"incarnation\":\"incarnation-1\"}"} : Native.InvocationFrame}

def native_invocation_frame_preserves_typed_v2_values():
  {==}

law native_invocation_frame_refuses_another_protocol_version:
  {Native.invocation_frame(Sel.Invocation{"1", "q", "o",
    Sel.MBind{"bend2", "r", "d", "2", "sourceAnalysis", Decl.ArtsNil{}, Eng.SSNil{}},
    "{}", Sel.StepsNil{}, Sel.CapNil{}, "", ""}) ==
    Native.NativeFrameRefused{"invocationVersion"} : Native.InvocationFrame}

def native_invocation_frame_refuses_another_protocol_version():
  {==}

law native_engines_refuses_without_admission:
  for +db: String
  {Native.engines(db) == Native.unavailable("context-engines") : IO(Unit)}

def native_engines_refuses_without_admission(db):
  {==}

law native_query_file_refuses_without_admission:
  for +db: String
  for +owner: String
  for +query: String
  for +path: String
  {Native.query_file(db, owner, query, path) == Native.unavailable("context-query-file") : IO(Unit)}

def native_query_file_refuses_without_admission(db,owner,query,path):
  {==}

law native_result_refuses_without_admission:
  for +db: String
  for +query: String
  {Native.result(db, query) == Native.unavailable("context-result") : IO(Unit)}

def native_result_refuses_without_admission(db,query):
  {==}
