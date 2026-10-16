# Decode captured input records into the types used by the retained plan.
import Base
import ./codec.bend as Codec
import ./engines-select.bend as Sel

type WireCaptures is Data:
  WcOk{captures: Sel.Captures}
  WcRefused{condition: String}

def wc_name_present(+name: String, +members: Codec.RawValue) -> Bool:
  Codec.raw_member_present(name, members)

def wc_value_or(found: Maybe<&2, Codec.RawValue>) -> Codec.RawValue:
  match found:
    case None{}: Codec.Rnil{}
    case Some{value}: value

def wc_value_member(+name: String, +members: Codec.RawValue) -> Codec.RawValue:
  wc_value_or(Codec.raw_member(name, members))

def wc_text_of_value(value: Codec.RawValue) -> String:
  match value:
    case Codec.Rstr{+text}: text
    case other: SNil{}

def wc_text_or_empty(found: Maybe<&2, Codec.RawValue>) -> String:
  match found:
    case None{}: SNil{}
    case Some{value}: wc_text_of_value(value)

def wc_text_member(+name: String, +members: Codec.RawValue) -> String:
  wc_text_or_empty(Codec.raw_member(name, members))

def wc_text_kind(value: Codec.RawValue) -> Bool:
  match value:
    case Codec.Rstr{+text}: True{}
    case other: False{}

def wc_text_member_ok(+name: String, +members: Codec.RawValue) -> Bool:
  Bool.pick(Bool, wc_name_present(name, members), wc_text_kind(wc_value_member(name, members)), False{})

def wc_object_members(value: Codec.RawValue) -> Codec.RawValue:
  match value:
    case Codec.Robj{+members}: members
    case other: Codec.Rnil{}

def wc_text_member_for(+elem: Codec.RawValue, +name: String) -> String:
  wc_text_or_empty(Codec.raw_member(name, wc_object_members(elem)))

def wc_capture_members_ok(+members: Codec.RawValue) -> Bool:
  Bool.pick(Bool, wc_text_member_ok("captureKind", members),
    Bool.pick(Bool, wc_text_member_ok("role", members),
      Bool.pick(Bool, wc_text_member_ok("path", members),
        Bool.pick(Bool, wc_text_member_ok("marker", members),
          Bool.pick(Bool, wc_text_member_ok("payload", members),
            Bool.pick(Bool, wc_text_member_ok("payloadEncoding", members),
              Bool.pick(Bool, wc_text_member_ok("producerModule", members),
                Bool.pick(Bool, wc_text_member_ok("producerDigest", members),
                  wc_text_member_ok("producerOperation", members), False{}), False{}), False{}), False{}), False{}), False{}), False{}), False{})

def wc_capture_ok(+elem: Codec.RawValue) -> Bool:
  wc_capture_members_ok(wc_object_members(elem))

def wc_capture_build_elem(+elem: Codec.RawValue) -> Sel.Capture:
  Sel.Capture{wc_text_member_for(elem, "captureKind"), wc_text_member_for(elem, "role"),
    wc_text_member_for(elem, "path"), wc_text_member_for(elem, "marker"),
    wc_text_member_for(elem, "payload"), wc_text_member_for(elem, "payloadEncoding"),
    wc_text_member_for(elem, "producerModule"), wc_text_member_for(elem, "producerDigest"),
    wc_text_member_for(elem, "producerOperation")}

def wc_captures_rest_ok(+rest: Codec.RawValue) -> Bool:
  match rest:
    case Codec.Rnil{}: True{}
    case Codec.Rarr{+head, +tail}: Bool.pick(Bool, wc_capture_ok(head), wc_captures_rest_ok(tail), False{})
    case other: False{}

def wc_captures_ok(+value: Codec.RawValue) -> Bool:
  match value:
    case Codec.Rarr{Codec.Rnil{}, Codec.Rnil{}}: True{}
    case Codec.Rarr{+head, +tail}: Bool.pick(Bool, wc_capture_ok(head), wc_captures_rest_ok(tail), False{})
    case other: False{}

def wc_captures_build_tail(+rest: Codec.RawValue) -> Sel.Captures:
  match rest:
    case Codec.Rnil{}: Sel.CapNil{}
    case Codec.Rarr{+head, +tail}: Sel.CapCons{wc_capture_build_elem(head), wc_captures_build_tail(tail)}
    case other: Sel.CapNil{}

def wc_captures_build(+value: Codec.RawValue) -> Sel.Captures:
  match value:
    case Codec.Rarr{Codec.Rnil{}, Codec.Rnil{}}: Sel.CapNil{}
    case Codec.Rarr{+head, +tail}: Sel.CapCons{wc_capture_build_elem(head), wc_captures_build_tail(tail)}
    case other: Sel.CapNil{}

def wc_captures_step(+value: Codec.RawValue, ok: Bool) -> WireCaptures:
  Bool.pick(WireCaptures, ok, WcOk{wc_captures_build(value)}, WcRefused{"invalidCaptures"})

def wire_captures_read(+value: Codec.RawValue) -> WireCaptures:
  wc_captures_step(value, wc_captures_ok(value))
