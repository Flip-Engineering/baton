# CLAIM: a complete captured prefix of original octets, taken from absolute byte zero through
# a caller-declared captured extent, is split into ordered half-open LF-terminated frame ranges
# with their exact original bytes, plus at most one retained pending suffix.
# Scope. This module frames bytes. It performs no selected fold, claims no cursor beyond the
# last complete boundary it reports, issues no final note, and reads no file, process, terminal
# or acknowledgement. A qualified source fault is an explicit failure and never a completion.
# Positions come from the reviewed position module through an exact import; this module adds
# one to a position per byte and never carries a whole-position integer, a floating value or an
# unbounded length counter.
# Identity. The source context is nine opaque identity strings carried for exact comparison and
# copied into every frame and every refusal. Matching fields establish internal correlation
# only: pure code cannot authenticate provenance, acquire a lease or grant authority, and a
# constructed value is not trusted as validated.
# Validation precedence, applied in this order and documented so a refusal is deterministic:
# one, every octet is in zero through two hundred fifty five; two, the declared captured extent
# parses as a checked position; three, the octet count derived by checked addition equals that
# declared extent; four, the observation belongs to the requested source; five, a fault
# observation is reported as a source fault; six, a sealed observation's final extent must equal
# the captured extent; seven, the scan produces frames and a pending suffix; eight, under a
# same-extent sealed observation the nonempty pending suffix becomes exactly one final frame.
# Language forms grounded on the reviewed number, string, frame and position modules and the
# pinned Base: sibling imports written as ./name.bend, element-with-list cons, Bool.pick with a
# first type argument, U32.is_eq, definitions before their callers, positional constructor
# patterns, and a plus binder on any binding used more than once. Every function is declared
# before the functions that call it, none is mutually recursive, and no match subject is a
# computed call.
# UNCOMPILED and UNTESTED.

import Base
import ./output-position.bend as P

type SourceId is Data:
  SourceRef{store: String, actor: String, attempt: String, stream: String,
            attempt_dir: String, stream_id: String, incarnation: String,
            contract_version: String, lease_owner: String}

type Observation is Data:
  OpenObs{source: SourceId}
  SealedObs{source: SourceId, final_extent: P.Pos}
  FaultObs{source: SourceId, reason: String}

type Frame is Data:
  FrameRange{start: P.Pos, end: P.Pos, source: SourceId, bytes: List<U32>}

type PendingSuffix is Data:
  NoPending{at: P.Pos}
  PendingFrame{start: P.Pos, end: P.Pos, bytes: List<U32>}

type ScanOutcome is Data:
  ScanDone{frames: List<Frame>, pending: PendingSuffix, boundary: P.Pos, inspected: P.Pos}
  ScanRefused{reason: String}

type FramingResult is Data:
  Framed{frames: List<Frame>, pending: PendingSuffix, boundary: P.Pos, inspected: P.Pos,
         source: SourceId, original: List<U32>}
  FramingRefused{reason: String, source: SourceId, original: List<U32>}

def rev_units(xs: List<U32>, acc: List<U32>) -> List<U32>:
  match xs:
    case Nil{}: acc
    case h <> t: rev_units(t, h <> acc)

def rev_frames(xs: List<Frame>, acc: List<Frame>) -> List<Frame>:
  match xs:
    case Nil{}: acc
    case h <> t: rev_frames(t, h <> acc)

def listed(rest: List<U32>) -> Bool:
  match rest:
    case Nil{}: False{}
    case _h <> _t: True{}

def all_octets(+xs: List<U32>) -> Bool:
  match xs:
    case Nil{}: True{}
    case +h <> t: Bool.pick(Bool, U32.is_lt(h, 256), all_octets(t), False{})

def is_lf(+code: U32) -> Bool:
  U32.is_eq(code, 10)

def zero_pos() -> P.Pos:
  P.PosDigits{[0]}

def one_pos() -> P.Pos:
  P.PosDigits{[1]}

def top_pos() -> P.Pos:
  P.PosDigits{[9, 2, 2, 3, 3, 7, 2, 0, 3, 6, 8, 5, 4, 7, 7, 5, 8, 0, 7]}

def same_text(+left: String, +right: String) -> Bool:
  String.eq(left, right)

def same_source(+left: SourceId, +right: SourceId) -> Bool:
  match left:
    case SourceRef{store, actor, attempt, stream, attempt_dir, stream_id, incarnation,
                   contract_version, lease_owner}:
      match right:
        case SourceRef{b_store, b_actor, b_attempt, b_stream, b_dir, b_stream_id, b_incarnation,
                       b_version, b_owner}:
          Bool.and(same_text(store, b_store),
            Bool.and(same_text(actor, b_actor),
              Bool.and(same_text(attempt, b_attempt),
                Bool.and(same_text(stream, b_stream),
                  Bool.and(same_text(attempt_dir, b_dir),
                    Bool.and(same_text(stream_id, b_stream_id),
                      Bool.and(same_text(incarnation, b_incarnation),
                        Bool.and(same_text(contract_version, b_version),
                          same_text(lease_owner, b_owner)))))))))

def at_top(+position: P.Pos) -> Bool:
  P.passed(P.equal_checked(position, top_pos()))

# The single bounded increment. A position at the domain maximum cannot be advanced, which is
# the only way this scan can fail on arithmetic.
def bumped_ok(+position: P.Pos) -> Bool:
  Bool.pick(Bool, P.pos_ok(position), Bool.pick(Bool, at_top(position), False{}, True{}), False{})

def sum_digits(+outcome: P.PosSum) -> List<U32>:
  match outcome:
    case P.PosAdded{value, _left, _right}: P.digits_of(value)
    case P.PosSumRefused{_reason, _l, _r}: Nil{}

def next_pos(+position: P.Pos) -> P.Pos:
  P.PosDigits{sum_digits(P.add_pos(position, one_pos()))}

def count_to(+rest: List<U32>, +position: P.Pos) -> P.Pos:
  match rest:
    case Nil{}: position
    case _h <> t: count_to(t, next_pos(position))

def count_ok(+rest: List<U32>, +position: P.Pos) -> Bool:
  match rest:
    case Nil{}: True{}
    case _h <> t:
      Bool.pick(Bool, bumped_ok(position), count_ok(t, next_pos(position)), False{})

def extent_matches(+octets: List<U32>, +declared: P.Pos) -> Bool:
  Bool.pick(Bool, count_ok(octets, zero_pos()),
    P.passed(P.equal_checked(count_to(octets, zero_pos()), declared)), False{})

def frame_of(+start: P.Pos, +end: P.Pos, +source: SourceId, +bytes: List<U32>) -> Frame:
  FrameRange{start, end, source, bytes}

def pending_state(+pending: List<U32>, +start: P.Pos, +position: P.Pos) -> PendingSuffix:
  Bool.pick(PendingSuffix, listed(pending),
    PendingFrame{start, position, rev_units(pending, Nil{})}, NoPending{position})

def scan_go(+rest: List<U32>, +position: P.Pos, +start: P.Pos, +frames: List<Frame>,
            +pending: List<U32>, +source: SourceId, +boundary: P.Pos) -> ScanOutcome:
  match rest:
    case Nil{}:
      ScanDone{rev_frames(frames, Nil{}), pending_state(pending, start, position), boundary,
               position}
    case +h <> t:
      Bool.pick(ScanOutcome, bumped_ok(position),
        Bool.pick(ScanOutcome, is_lf(h),
          scan_go(t, next_pos(position), next_pos(position),
            frame_of(start, next_pos(position), source, h <> pending) <> frames, Nil{}, source,
            next_pos(position)),
          scan_go(t, next_pos(position), start, frames, h <> pending, source, boundary)),
        ScanRefused{"position_overflow"})

def scan_prefix(+octets: List<U32>, +source: SourceId) -> ScanOutcome:
  scan_go(octets, zero_pos(), zero_pos(), Nil{}, Nil{}, source, zero_pos())

def observation_source(+observation: Observation) -> SourceId:
  match observation:
    case OpenObs{source}: source
    case SealedObs{source, final_extent: _e}: source
    case FaultObs{source, reason: _r}: source

def observation_seal(+observation: Observation) -> P.Pos:
  match observation:
    case OpenObs{source: _s}: zero_pos()
    case SealedObs{source: _s, final_extent}: final_extent
    case FaultObs{source: _s, reason: _r}: zero_pos()

def observation_open(+observation: Observation) -> Bool:
  match observation:
    case OpenObs{source: _s}: True{}
    case SealedObs{source: _s, final_extent: _e}: False{}
    case FaultObs{source: _s, reason: _r}: False{}

def observation_fault(+observation: Observation) -> Bool:
  match observation:
    case OpenObs{source: _s}: False{}
    case SealedObs{source: _s, final_extent: _e}: False{}
    case FaultObs{source: _s, reason: _r}: True{}

def observation_reason(+observation: Observation) -> String:
  match observation:
    case OpenObs{source: _s}: ""
    case SealedObs{source: _s, final_extent: _e}: ""
    case FaultObs{source: _s, reason}: reason

def observation_sealed(+observation: Observation) -> Bool:
  Bool.pick(Bool, observation_open(observation), False{},
    Bool.pick(Bool, observation_fault(observation), False{}, True{}))

def sealed_extent_ok(+declared: P.Pos, +observation: Observation) -> Bool:
  Bool.pick(Bool, observation_sealed(observation),
    P.passed(P.equal_checked(declared, observation_seal(observation))), True{})

def append_frame(+frames: List<Frame>, +frame: Frame) -> List<Frame>:
  match frames:
    case Nil{}: frame <> Nil{}
    case +h <> t: h <> append_frame(t, frame)

def sealed_result(+frames: List<Frame>, +pending: PendingSuffix, +boundary: P.Pos,
                  +inspected: P.Pos, +sealed: Bool, +source: SourceId,
                  +original: List<U32>) -> FramingResult:
  match pending:
    case NoPending{at: _at}:
      Framed{frames, pending, boundary, inspected, source, original}
    case PendingFrame{start, end: _end, bytes}:
      Bool.pick(FramingResult, sealed,
        Framed{append_frame(frames, frame_of(start, inspected, source, bytes)),
          NoPending{inspected}, inspected, inspected, source, original},
        Framed{frames, pending, boundary, inspected, source, original})

def qualified(+outcome: ScanOutcome, +sealed: Bool, +source: SourceId,
              +original: List<U32>) -> FramingResult:
  match outcome:
    case ScanDone{frames, pending, boundary, inspected}:
      sealed_result(frames, pending, boundary, inspected, sealed, source, original)
    case ScanRefused{reason}: FramingRefused{reason, source, original}

def declared_is(+result: P.PosResult) -> Bool:
  match result:
    case P.PosAccepted{_value}: True{}
    case P.PosRefused{_reason, _original}: False{}

def declared_pos(+result: P.PosResult) -> P.Pos:
  match result:
    case P.PosAccepted{value}: value
    case P.PosRefused{_reason, _original}: zero_pos()

def parsed_extent(+extent_octets: List<U32>) -> P.PosResult:
  P.parse_pos(extent_octets)

def extent_ok(+extent_octets: List<U32>, +octets: List<U32>) -> Bool:
  Bool.pick(Bool, declared_is(parsed_extent(extent_octets)),
    extent_matches(octets, declared_pos(parsed_extent(extent_octets))), False{})

def frame_prefix(+octets: List<U32>, +extent_octets: List<U32>, +source: SourceId,
                 +observation: Observation) -> FramingResult:
  Bool.pick(FramingResult, all_octets(octets),
    Bool.pick(FramingResult, declared_is(parsed_extent(extent_octets)),
      Bool.pick(FramingResult, extent_ok(extent_octets, octets),
        Bool.pick(FramingResult, same_source(observation_source(observation), source),
          Bool.pick(FramingResult, observation_fault(observation),
            FramingRefused{observation_reason(observation), source, octets},
            Bool.pick(FramingResult,
              sealed_extent_ok(declared_pos(parsed_extent(extent_octets)), observation),
              qualified(scan_prefix(octets, source), observation_sealed(observation), source,
                octets),
              FramingRefused{"sealed_extent_mismatch", source, octets})),
          FramingRefused{"foreign_source_observation", source, octets}),
        FramingRefused{"extent_mismatch", source, octets}),
      FramingRefused{"captured_extent_invalid", source, octets}),
    FramingRefused{"not_an_octet", source, octets})
