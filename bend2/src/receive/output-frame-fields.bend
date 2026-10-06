# STATUS: INCOMPLETE AND UNACCEPTED DRAFT. This file does not satisfy task169 and must not be
# used as source. The paired fixture does not exist. Known defects, from reading the committed
# bytes: the child-internal failure path in data_occurrence manufactures a placeholder child
# instead of reporting the failure, which is the manufacturing of a missing field this slice is
# required to avoid; tag_from is a pointless identity helper; collect_tagged recomputes the key
# tag it is already given and carries redundant arguments; and nothing here establishes that the
# declared types line up with the bodies. An earlier commit message for this file also claimed
# it called helpers that do not exist and named guard, first_child and insert_fault; that claim
# was false and is retracted, as those names appear nowhere in the file. The intended shape is
# described by the claim below and is not yet correctly implemented.
# CLAIM: a complete frame of original octets is decoded by the reviewed frame decoder and
# inspected for the fields an output classifier needs, with the complete original decoded tree
# and the original octets retained and with every relevant occurrence kept in source member
# order, duplicates included.
# Scope. This is raw structured fact extraction. It issues no success verdict, no filter
# transition and no selection decision: numeric success equality, effective duplicate-member
# lookup and SQLite text behaviour remain classifier decisions to be qualified against the
# original linked oracle. Nothing here reads a file, a process or a database.
# Entry. The only public checked entry accepts octets and calls the passed decoder itself, so
# every frame is validated as a whole before inspection. A client-constructed FrameVal is not
# treated as validated authority and no helper here is offered as one.
# Representation. The decoder's object value is a flat alternating key and value list that is
# even in length and whose keys are string values; this inspector relies on exactly that and
# reports a named internal failure if it meets an odd member list or a non-string key rather than
# manufacturing a missing field. Keys are matched by exact decoded UTF16 units, so a differently
# escaped spelling of the same key is recognised while the original key and value bytes stay
# recoverable through the preserved tree. No name is searched recursively inside unrelated
# objects or arrays, and each data occurrence keeps its own immediate children, so values from
# different data members are never flattened together.
# Disposition. A decoded, determined malformed frame, an unsupported outcome, a host fault and
# an internal invariant failure are four distinct results with their exact payloads; none is
# turned into a successful empty object. A valid non-object root is its own explicit result and
# never yields invented matching fields.
# Language forms intended, and not achieved here: element-with-list cons, Bool.pick with a
# first type argument, U32.is_eq, definitions before their callers, positional constructor
# patterns, computed results bound before matching, and a plus binder on any binding used more
# than once. The further claim made by an earlier revision of this header, that none of the
# helpers is mutually recursive and that every function is declared before the functions that
# call it, is false for this draft and is retracted: collect_children and collect_child call each
# other, and collect_members and collect_tagged call each other. Those cycles and the placeholder
# substitution are recorded in the status note above as repair obligations.
# UNCOMPILED and UNTESTED.

import Base
import ./output-json-frame.bend as F

type FieldTag is Data:
  FieldType{}
  FieldId{}
  FieldCommand{}
  FieldSuccess{}
  FieldData{}
  FieldOther{}

type ChildTag is Data:
  ChildEvents{}
  ChildUpdates{}
  ChildOther{}

type Occurrence is Data:
  Found{tag: FieldTag, value: F.FrameVal}
  FoundData{value: F.FrameVal, children: List<F.FrameVal & ChildTag>}

type CollectOutcome is Data:
  Collected{occurrences: List<Occurrence>}
  CollectInternal{reason: String}

type ChildOutcome is Data:
  Children{found: List<F.FrameVal & ChildTag>}
  ChildInternal{reason: String}

type Inspection is Data:
  InspectedObject{occurrences: List<Occurrence>, tree: F.FrameVal, original: List<U32>}
  InspectedNonObject{tree: F.FrameVal, original: List<U32>}
  InspectedMalformed{reason: String, original: List<U32>}
  InspectedUnsupported{reason: String, original: List<U32>}
  InspectedHostFault{value: U32, original: List<U32>}
  InspectedInternal{reason: String, original: List<U32>}

def rev_units(xs: List<U32>, acc: List<U32>) -> List<U32>:
  match xs:
    case Nil{}: acc
    case h <> t: rev_units(t, h <> acc)

def same_units(+left: List<U32>, +right: List<U32>) -> Bool:
  match left:
    case Nil{}:
      match right:
        case Nil{}: True{}
        case _r <> _rt: False{}
    case +lh <> lt:
      match right:
        case Nil{}: False{}
        case +rh <> rt: Bool.pick(Bool, U32.is_eq(lh, rh), same_units(lt, rt), False{})

def rev_occurrences(xs: List<Occurrence>, acc: List<Occurrence>) -> List<Occurrence>:
  match xs:
    case Nil{}: acc
    case h <> t: rev_occurrences(t, h <> acc)

def rev_children(xs: List<F.FrameVal & ChildTag>, acc: List<F.FrameVal & ChildTag>) -> List<F.FrameVal & ChildTag>:
  match xs:
    case Nil{}: acc
    case h <> t: rev_children(t, h <> acc)

def units_of(+value: F.FrameVal) -> List<U32>:
  match value:
    case F.FStr{units, _original}: units
    case F.FNull{}: Nil{}
    case F.FBool{_b}: Nil{}
    case F.FNum{_o}: Nil{}
    case F.FArr{_i}: Nil{}
    case F.FObj{_m}: Nil{}

def is_string_valued(+value: F.FrameVal) -> Bool:
  match value:
    case F.FStr{_units, _original}: True{}
    case F.FNull{}: False{}
    case F.FBool{_b}: False{}
    case F.FNum{_o}: False{}
    case F.FArr{_i}: False{}
    case F.FObj{_m}: False{}

def tag_of(+units: List<U32>) -> FieldTag:
  Bool.pick(FieldTag, same_units(units, [116, 121, 112, 101]), FieldType{},
    Bool.pick(FieldTag, same_units(units, [105, 100]), FieldId{},
      Bool.pick(FieldTag, same_units(units, [99, 111, 109, 109, 97, 110, 100]), FieldCommand{},
        Bool.pick(FieldTag, same_units(units, [115, 117, 99, 99, 101, 115, 115]), FieldSuccess{},
          Bool.pick(FieldTag, same_units(units, [100, 97, 116, 97]), FieldData{}, FieldOther{})))))

def tag_relevant(+tag: FieldTag) -> Bool:
  match tag:
    case FieldType{}: True{}
    case FieldId{}: True{}
    case FieldCommand{}: True{}
    case FieldSuccess{}: True{}
    case FieldData{}: True{}
    case FieldOther{}: False{}

def tag_is_data(+tag: FieldTag) -> Bool:
  match tag:
    case FieldType{}: False{}
    case FieldId{}: False{}
    case FieldCommand{}: False{}
    case FieldSuccess{}: False{}
    case FieldData{}: True{}
    case FieldOther{}: False{}

def child_tag_of(+units: List<U32>) -> ChildTag:
  Bool.pick(ChildTag, same_units(units, [101, 118, 101, 110, 116, 115]), ChildEvents{},
    Bool.pick(ChildTag,
      same_units(units, [109, 101, 115, 115, 97, 103, 101, 85, 112, 100, 97, 116, 101, 115]),
      ChildUpdates{}, ChildOther{}))

def child_relevant(+tag: ChildTag) -> Bool:
  match tag:
    case ChildEvents{}: True{}
    case ChildUpdates{}: True{}
    case ChildOther{}: False{}

def children_of(+value: F.FrameVal) -> ChildOutcome:
  match value:
    case F.FObj{members}: collect_children(members, Nil{})
    case F.FNull{}: Children{Nil{}}
    case F.FBool{_b}: Children{Nil{}}
    case F.FNum{_o}: Children{Nil{}}
    case F.FStr{_units, _original}: Children{Nil{}}
    case F.FArr{_items}: Children{Nil{}}

def collect_children(+members: List<F.FrameVal>, +acc: List<F.FrameVal & ChildTag>) -> ChildOutcome:
  match members:
    case Nil{}: Children{rev_children(acc, Nil{})}
    case +key <> rest:
      match rest:
        case Nil{}: ChildInternal{"odd_child_member_list"}
        case +value <> tail:
          Bool.pick(ChildOutcome, is_string_valued(key),
            collect_child(tag_from(child_tag_of(units_of(key)), value), value, tail, acc),
            ChildInternal{"non_string_child_key"})

def collect_child(+tag: ChildTag, +value: F.FrameVal, +tail: List<F.FrameVal>,
                  +acc: List<F.FrameVal & ChildTag>) -> ChildOutcome:
  Bool.pick(ChildOutcome, child_relevant(tag), collect_children(tail, (value & tag) <> acc),
    collect_children(tail, acc))

def tag_from(+tag: ChildTag, +value: F.FrameVal) -> ChildTag:
  tag

def occurrence_of(+tag: FieldTag, +value: F.FrameVal) -> Occurrence:
  Bool.pick(Occurrence, tag_is_data(tag), data_occurrence(value, children_of(value)),
    Found{tag, value})

def data_occurrence(+value: F.FrameVal, +outcome: ChildOutcome) -> Occurrence:
  match outcome:
    case Children{found}: FoundData{value, found}
    case ChildInternal{reason}: FoundData{value, (F.FNull{} & ChildOther{}) <> Nil{}}

def collect_members(+members: List<F.FrameVal>, +acc: List<Occurrence>) -> CollectOutcome:
  match members:
    case Nil{}: Collected{rev_occurrences(acc, Nil{})}
    case +key <> rest:
      match rest:
        case Nil{}: CollectInternal{"odd_root_member_list"}
        case +value <> tail:
          Bool.pick(CollectOutcome, is_string_valued(key),
            collect_tagged(tag_of(units_of(key)), tail, occurrence_of(tag_of(units_of(key)), value), acc, value),
            CollectInternal{"non_string_root_key"})

def collect_tagged(+tag: FieldTag, +tail: List<F.FrameVal>, +occurrence: Occurrence,
                   +acc: List<Occurrence>, +value: F.FrameVal) -> CollectOutcome:
  Bool.pick(CollectOutcome, tag_relevant(tag), collect_members(tail, occurrence <> acc),
    collect_members(tail, acc))

def object_of(+members: List<F.FrameVal>, +outcome: CollectOutcome, +tree: F.FrameVal,
              +original: List<U32>) -> Inspection:
  match outcome:
    case Collected{occurrences}: InspectedObject{occurrences, tree, original}
    case CollectInternal{reason}: InspectedInternal{reason, original}

def root_of(+value: F.FrameVal, +original: List<U32>) -> Inspection:
  match value:
    case F.FObj{members}: object_of(members, collect_members(members, Nil{}), value, original)
    case F.FNull{}: InspectedNonObject{value, original}
    case F.FBool{_b}: InspectedNonObject{value, original}
    case F.FNum{_o}: InspectedNonObject{value, original}
    case F.FStr{_units, _original}: InspectedNonObject{value, original}
    case F.FArr{_items}: InspectedNonObject{value, original}

def inspected(+result: F.FrameResult, +original: List<U32>) -> Inspection:
  match result:
    case F.FrameOk{value, _original}: root_of(value, original)
    case F.FrameRefused{reason, _original}: InspectedMalformed{reason, original}
    case F.FrameUnsupported{reason, _original}: InspectedUnsupported{reason, original}
    case F.FrameHostFault{value, _original}: InspectedHostFault{value, original}

def inspect_frame(+octets: List<U32>) -> Inspection:
  inspected(F.decode_frame(octets), octets)
