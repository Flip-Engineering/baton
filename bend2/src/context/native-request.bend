# Decode an already admitted canonical request into the selection operands owned by
# engines-select. This adapter reads the existing request, operations and closed profile
# contracts; it does not derive request facts from command-line tokens.
import Base
import ../json/canonical.bend as J
import ./engines.bend as Eng
import ./engines-select.bend as Sel
import ./operations.bend as Ops
import ./codec.bend as CoreCodec
import ./codec-schema.bend as Schema
import ./request.bend as Req
import ./raw.bend as Raw
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx

type RequestDecode is Data:
  RequestDecoded{canonical: String, operands: Sel.RequestOperands,
                 operation_chain: CoreCodec.OpChain, cwd: String, source_path: String}
  RequestDecodeRefused{condition: String}

type RawDecode is Data:
  RawDecoded{value: CoreCodec.RawValue}
  RawDecodeRefused{condition: String}

def projections_tail(+rest: J.Json) -> List<String>:
  match rest:
    case J.Jarr{+head, +tail}: Req.text_of(head) <> projections_tail(tail)
    case other: Nil{}

def projections_list(select: J.Json) -> List<String>:
  match select:
    case J.Jarr{+head, +tail}: Req.text_of(head) <> projections_tail(tail)
    case other: Nil{}

def request_members(+req: J.Json) -> J.Json:
  match req:
    case J.Jobj{+members}: members
    case other: J.Jnil{}

def optional_member_value(found: Maybe<&2, J.Json>) -> String:
  match found:
    case None{}: SNil{}
    case Some{+value}: Req.text_of(value)

def optional_member_text(+members: J.Json, +name: String) -> String:
  optional_member_value(Req.member_lookup(name, members))

def optional_member_json(found: Maybe<&2, J.Json>) -> J.Json:
  match found:
    case None{}: J.Jnil{}
    case Some{+value}: value

def request_select(+members: J.Json) -> J.Json:
  optional_member_json(Req.member_lookup("select", members))

def request_subject(+members: J.Json) -> J.Json:
  optional_member_json(Req.member_lookup("subject", members))

def source_path(req: J.Json) -> String:
  Ops.source_path(req)

def decoded_request(+req: J.Json, +canonical: String) -> RequestDecode:
  RequestDecoded{canonical,
    Sel.RequestOperands{Ops.request_subject_kind(req),
      Eng.ss_of_list(projections_list(request_select(request_members(req)))),
      optional_member_text(request_members(req), "engine"),
      CoreCodec.primary_operation(CoreCodec.request_operation_chain(req, Eng.ss_empty()))},
    CoreCodec.request_operation_chain(req, Eng.ss_empty()),
    optional_member_text(request_members(req), "cwd"),
    source_path(req)}

def request_validation_result(+req: J.Json, verdict: Req.Verdict) -> RequestDecode:
  match verdict:
    case Req.VRefused{condition}: RequestDecodeRefused{condition}
    case Req.VAccepted{}: decoded_request(req, Req.request_identity(req))

def request_validation(+req: J.Json) -> RequestDecode:
  request_validation_result(req, Req.request_validate(req))

def request_json_schema(raw: CoreCodec.RawValue, verdict: Schema.SchemaVerdict) -> RequestDecode:
  match verdict:
    case Schema.SvRefused{condition}: RequestDecodeRefused{condition}
    case Schema.SvOk{}: request_json_value(raw, CoreCodec.raw_to_json(raw))

def request_json_value(raw: CoreCodec.RawValue, converted: CoreCodec.JsonConv) -> RequestDecode:
  match converted:
    case CoreCodec.JcRefused{condition}: RequestDecodeRefused{condition}
    case CoreCodec.JcJson{+value}: request_validation(value)

def request_json(+raw: CoreCodec.RawValue) -> RequestDecode:
  request_json_schema(raw, Schema.schema_admit_value(Schema.DefsNil{}, Schema.SfJson{}, raw))

def request_rows_decoded(raw: RawDecode) -> RequestDecode:
  match raw:
    case RawDecodeRefused{condition}: RequestDecodeRefused{condition}
    case RawDecoded{+value}: request_json(value)

def request_rows(+rows: String) -> RequestDecode:
  request_rows_decoded(raw_rows(rows))

def raw_frame(frame: CoreCodec.FrameRead) -> RawDecode:
  match frame:
    case CoreCodec.FrRefused{condition}: RawDecodeRefused{condition}
    case CoreCodec.FrValue{+value}: RawDecoded{value}

def raw_rows(+rows: String) -> RawDecode:
  raw_frame(CoreCodec.frame_read(Req.parse_rows(rows)))

def report_field_result(found: Maybe<&2, CoreCodec.RawValue>) -> String:
  match found:
    case None{}: SNil{}
    case Some{+value}:
      match value:
        case CoreCodec.Rnum{token}: token
        case other: SNil{}

def report_field(+name: String, +raw: CoreCodec.RawValue) -> String:
  report_field_result(CoreCodec.raw_field(raw, name))

def validation_report_condition(+raw: CoreCodec.RawValue) -> String:
  Bool.pick(String, String.eq(report_field("valid", raw), "1"),
    Bool.pick(String, String.eq(report_field("duplicates", raw), "0"),
      Bool.pick(String, String.eq(report_field("tokens", raw), "0"), "", "nonU32NumberInRequest"),
      "duplicateKey"),
    "invalidJson")

def report_decided(+db: String, +binding: String, +text: String, +condition: String) -> IO(RequestDecode):
  match condition:
    case "": request_rows_after_validation(db, binding, text)
    case other: IO.pure(RequestDecode, RequestDecodeRefused{condition})

def validation_report_decoded(+db: String, +binding: String, +text: String,
                              raw: RawDecode) -> IO(RequestDecode):
  match raw:
    case RawDecodeRefused{condition}:
      IO.pure(RequestDecode, RequestDecodeRefused{"malformedValidationReport"})
    case RawDecoded{+value}:
      report_decided(db, binding, text, validation_report_condition(value))

def validation_tree_result(+db: String, +binding: String, +text: String,
                           tree: Result<&1,&1,U32 & String,String>) -> IO(RequestDecode):
  match tree:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(RequestDecode, RequestDecodeRefused{"validationReportRead"})
    case Done{+rows}:
      validation_report_decoded(db, binding, text, raw_rows(rows))

def validation_query_result(+db: String, +binding: String, +text: String,
                             report: Result<&1,&1,U32 & String,String>) -> IO(RequestDecode):
  match report:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(RequestDecode, RequestDecodeRefused{"requestValidationRead"})
    case Done{+report_rows}:
      validation_tree_result(db, binding, text,
        DB.Sql.query_bound(db, binding, Req.json_tree_sql(Tx.trim_nl(report_rows))))

def validation_report_row(+db: String, +binding: String, +text: String,
                          +row: String) -> IO(RequestDecode):
  match row:
    case "1":
      do IO<RequestDecode>:
        report : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, Req.validate_json_text_sql(text))
        validation_query_result(db, binding, text, report)
    case "0": IO.pure(RequestDecode, RequestDecodeRefused{"invalidJson"})
    case other: IO.pure(RequestDecode, RequestDecodeRefused{"malformedValidationObservation"})

def report_after_validation(+db: String, +binding: String, +text: String,
                            validity: Result<&1,&1,U32 & String,String>) -> IO(RequestDecode):
  match validity:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(RequestDecode, RequestDecodeRefused{"requestValidationRead"})
    case Done{+row}: validation_report_row(db, binding, text, Tx.trim_nl(row))

def request_rows_after_validation(+db: String, +binding: String, +text: String) -> IO(RequestDecode):
  do IO<RequestDecode>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, Req.json_tree_sql(text))
    match result:
      case Fail{error}:
        match error:
          case (code, detail): IO.pure(RequestDecode, RequestDecodeRefused{"requestTreeRead"})
      case Done{+rows}: IO.pure(RequestDecode, request_rows(rows))

def read_raw_after(+db: String, +binding: String, result: Result<&1,&1,U32 & String,Raw.RawRead>) -> IO(RequestDecode):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(RequestDecode, RequestDecodeRefused{"requestRead"})
    case Done{+answer}:
      match answer:
        case Raw.RawText{+text}:
          do IO<RequestDecode>:
            validity : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, Req.validity_sql(text))
            report_after_validation(db, binding, text, validity)
        case invalid: RequestDecodeRefused{Req.raw_condition(invalid)}

def read_file(+db: String, +binding: String, +path: String) -> IO(RequestDecode):
  read_raw_after(db, binding, Req.read_utf8(path))

def decoded_subject_path(decoded: RequestDecode) -> String:
  match decoded:
    case RequestDecoded{canonical, operands, operation_chain, cwd, source_path}: source_path
    case RequestDecodeRefused{condition}: SNil{}

def decoded_cwd(decoded: RequestDecode) -> String:
  match decoded:
    case RequestDecoded{canonical, operands, operation_chain, cwd, source_path}: cwd
    case RequestDecodeRefused{condition}: SNil{}

def decoded_operands(decoded: RequestDecode) -> Sel.RequestOperands:
  match decoded:
    case RequestDecoded{canonical, operands, operation_chain, cwd, source_path}: operands
    case RequestDecodeRefused{condition}: Sel.RequestOperands{"", Eng.ss_empty(), "", ""}
