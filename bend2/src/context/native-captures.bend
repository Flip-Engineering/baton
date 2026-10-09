# Decode the answer from the selected producer process before retaining a plan.
import Base
import ./codec.bend as Codec
import ./codec-convert.bend as Convert
import ./request.bend as Req
import ./engines-select.bend as Sel

type CaptureAnswer is Data:
  CapturesReady{captures: Sel.Captures}
  CapturesRefused{condition: String}

def producer_found(found: Sel.StepState) -> Bool:
  match found:
    case Sel.StepFound{step}: True{}
    case Sel.StepMissing{module_id, declaration_digest, operation}: False{}

def producers_match(+plan: Sel.Plan, +captures: Sel.Captures) -> Bool:
  match captures:
    case Sel.CapNil{}: True{}
    case Sel.CapCons{+head, +rest}:
      Bool.and(producer_found(Sel.step_lookup(plan, Sel.cap_producer_module(head),
        Sel.cap_producer_digest(head), Sel.cap_producer_operation(head))),
        producers_match(plan, rest))

def captures_decoded(+plan: Sel.Plan, decoded: Convert.WireCaptures) -> CaptureAnswer:
  match decoded:
    case Convert.WcRefused{condition}: CapturesRefused{condition}
    case Convert.WcOk{+captures}:
      Bool.pick(CaptureAnswer, producers_match(plan, captures),
        CapturesReady{captures}, CapturesRefused{"captureProducerMismatch"})

def answer_value(+plan: Sel.Plan, +query: String, +owner: String,
                 value: Codec.RawValue) -> CaptureAnswer:
  match value:
    case Codec.Robj{+members}:
      Bool.pick(CaptureAnswer,
        Bool.and(String.eq(Convert.wc_text_member("status", members), "captured"),
        Bool.and(String.eq(Convert.wc_text_member("query", members), query),
          String.eq(Convert.wc_text_member("owner", members), owner))),
        captures_decoded(plan, Convert.wire_captures_read(Convert.wc_value_member("captures", members))),
        CapturesRefused{"captureSupplierIdentityMismatch"})
    case other: CapturesRefused{"captureSupplierShape"}

def answer_frame(+plan: Sel.Plan, +query: String, +owner: String,
                 frame: Codec.FrameRead) -> CaptureAnswer:
  match frame:
    case Codec.FrRefused{condition}: CapturesRefused{condition}
    case Codec.FrValue{value}: answer_value(plan, query, owner, value)

def answer_rows(+plan: Sel.Plan, +query: String, +owner: String,
                +rows: String) -> CaptureAnswer:
  answer_frame(plan, query, owner, Codec.frame_read(Req.parse_rows(rows)))

def with_captures(+plan: Sel.Plan, +captures: Sel.Captures) -> Sel.Plan:
  match plan:
    case Sel.Plan{primary, common, steps, effective_effects, inputs, available, policy_identity}:
      Sel.Plan{primary, common, steps, effective_effects, captures, available, policy_identity}
