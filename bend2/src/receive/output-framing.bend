# CLAIM: a complete captured prefix of original octets, taken from absolute byte zero through
# a caller-declared captured extent, is split into ordered half-open LF-terminated frame ranges
# with their exact original bytes, plus at most one retained pending suffix.
# Scope. This module frames bytes. It performs no selected fold, claims no cursor beyond the
# last complete boundary it reports, issues no final note, and reads no file, process, terminal
# or acknowledgement. A qualified source fault is an explicit failure and never a completion.
# Positions come from the reviewed position module through an exact import; this module adds
# one to a position per byte, and it builds every range through that module's checked interval
# construction, whose typed refusal is carried out as a framing refusal.
# Identity and request. The source context is nine opaque identity strings carried for exact
# comparison. Every result and every refusal carries the exact request it was given, including
# the supplied observation variant and its reason and the supplied extent octets, so a foreign
# observation source or a forged seal position is reported as supplied and never replaced by
# the requested source or a parsed fallback. Matching fields establish internal correlation
# only: pure code cannot authenticate provenance, acquire a lease or grant authority, and a
# constructed value is not trusted as validated. A pending range carries its own source rather
# than relying on an enclosing result.
# Validation precedence, applied in this order and documented so a refusal is deterministic:
# one, every octet is in zero through two hundred fifty five; two, the declared captured extent
# parses as a checked position; three, the octet count derived by checked addition equals that
# declared extent; four, the observation belongs to the requested source; five, a fault
# observation is reported as a source fault; six, a sealed observation's final extent must equal
# the captured extent; seven, the scan builds ranges through checked interval construction and
# retains a pending suffix; eight, under a same-extent sealed observation the nonempty pending
# suffix becomes exactly one final frame.
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

type FrameRequest is Data:
  FrameAsk{octets: List<U32>, extent_octets: List<U32>, source: SourceId,
           observation: Observation}

type Frame is Data:
  FrameRange{start: P.Pos, end: P.Pos, source: SourceId, bytes: List<U32>}

type SpanRun is Data:
  SpanClosed{start: P.Pos, end: P.Pos, bytes: List<U32>}

type PendingSuffix is Data:
  NoPending{at: P.Pos}
  PendingFrame{source: SourceId, start: P.Pos, end: P.Pos, bytes: List<U32>}

type ScanOutcome is Data:
  ScanDone{runs: List<SpanRun>, pending: PendingSuffix, boundary: P.Pos, inspected: P.Pos}
  ScanRefused{reason: String}

type CountOutcome is Data:
  Counted{value: P.Pos}
  CountRefused{reason: String, original: List<U32>}

type FramingResult is Data:
  Framed{request: FrameRequest, frames: List<Frame>, pending: PendingSuffix, boundary: P.Pos,
         inspected: P.Pos, original: List<U32>}
  FramingRefused{reason: String, request: FrameRequest, original: List<U32>}

def rev_units(xs: List<U32>, acc: List<U32>) -> List<U32>:
  match xs:
    case Nil{}: acc
    case h <> t: rev_units(t, h <> acc)

def rev_runs(xs: List<SpanRun>, acc: List<SpanRun>) -> List<SpanRun>:
  match xs:
    case Nil{}: acc
    case h <> t: rev_runs(t, h <> acc)

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

def same_text(+left: String, +right: String) -> Bool:
  String.eq(left, right)

def same_source(+left: SourceId, +right: SourceId) -> Bool:
  match left:
    case SourceRef{store, actor, attempt, stream, attempt_dir, stream_id, incarnation,
                   contract_version, lease_owner}:
      match right:
        case SourceRef{b_store, b_actor, b_attempt, b_stream, b_dir, b_id, b_incarnation,
                       b_version, b_owner}:
          Bool.and(same_text(store, b_store),
            Bool.and(same_text(actor, b_actor),
              Bool.and(same_text(attempt, b_attempt),
                Bool.and(same_text(stream, b_stream),
                  Bool.and(same_text(attempt_dir, b_dir),
                    Bool.and(same_text(stream_id, b_id),
                      Bool.and(same_text(incarnation, b_incarnation),
                        Bool.and(same_text(contract_version, b_version),
                          same_text(lease_owner, b_owner)))))))))

def bump_of(+position: P.Pos) -> P.PosSum:
  P.add_pos(position, one_pos())

def span_of(+low: P.Pos, +high: P.Pos) -> P.PosSpan:
  P.span_pos(low, high)

def count_go(+rest: List<U32>, +position: P.Pos, +original: List<U32>) -> CountOutcome:
  match rest:
    case Nil{}: Counted{position}
    case _h <> t:
      +bump = P.add_pos(position, one_pos())
      match bump:
        case P.PosSumRefused{_reason, _l, _r}: CountRefused{"position_overflow", original}
        case P.PosAdded{+value, _left, _right}: count_go(t, value, original)

def count_of(+octets: List<U32>) -> CountOutcome:
  count_go(octets, zero_pos(), octets)

def counted_matches(+outcome: CountOutcome, +declared: P.Pos) -> Bool:
  match outcome:
    case Counted{value}: P.passed(P.equal_checked(value, declared))
    case CountRefused{_reason, _original}: False{}

def count_refuses(+outcome: CountOutcome) -> Bool:
  match outcome:
    case Counted{_value}: False{}
    case CountRefused{_reason, _original}: True{}

def count_reason(+outcome: CountOutcome) -> String:
  match outcome:
    case Counted{_value}: ""
    case CountRefused{reason, _original}: reason

def extent_matches(+octets: List<U32>, +declared: P.Pos) -> Bool:
  counted_matches(count_of(octets), declared)

def frame_of(+start: P.Pos, +end: P.Pos, +source: SourceId, +bytes: List<U32>) -> Frame:
  FrameRange{start, end, source, bytes}

def pending_state(+pending: List<U32>, +source: SourceId, +start: P.Pos,
                  +position: P.Pos) -> PendingSuffix:
  Bool.pick(PendingSuffix, listed(pending),
    PendingFrame{source, start, position, rev_units(pending, Nil{})}, NoPending{position})

# The loop inspects the remaining bytes first, so an empty remainder returns the current
# validated position and never performs an increment. A nonempty remainder consumes exactly its
# head after one checked increment, and the checked interval from the frame start through that
# consumed byte, which includes a closing LF, is matched before any frame is emitted. A refused
# increment or interval becomes a framing refusal, and no position is ever fabricated. The
# interval of a retained suffix was validated when its last byte was consumed.
def scan_go(+rest: List<U32>, +position: P.Pos, +opened: P.Pos, +runs: List<SpanRun>,
            +pending: List<U32>, +source: SourceId, +boundary: P.Pos) -> ScanOutcome:
  match rest:
    case Nil{}:
      ScanDone{rev_runs(runs, Nil{}), pending_state(pending, source, opened, position),
               boundary, position}
    case +h <> +t:
      +bump = bump_of(position)
      match bump:
        case P.PosSumRefused{_reason, _l, _r}: ScanRefused{"position_overflow"}
        case P.PosAdded{+value, _left, _right}:
          +span = span_of(opened, value)
          match span:
            case P.SpanRefused{reason, _l, _h}: ScanRefused{reason}
            case P.SpanOrdered{start, end}:
              Bool.pick(ScanOutcome, is_lf(h),
                scan_go(t, value, value,
                  SpanClosed{start, end, rev_units(h <> pending, Nil{})} <> runs, Nil{}, source,
                  value),
                scan_go(t, value, opened, runs, h <> pending, source, boundary))

def scan_prefix(+octets: List<U32>, +source: SourceId) -> ScanOutcome:
  scan_go(octets, zero_pos(), zero_pos(), Nil{}, Nil{}, source, zero_pos())

def frames_of(+runs: List<SpanRun>, +source: SourceId) -> List<Frame>:
  match runs:
    case Nil{}: Nil{}
    case +h <> t:
      match h:
        case SpanClosed{start, end, bytes}:
          frame_of(start, end, source, bytes) <> frames_of(t, source)

def observation_source(+observation: Observation) -> SourceId:
  match observation:
    case OpenObs{source}: source
    case SealedObs{source, _extent}: source
    case FaultObs{source, _reason}: source

def observation_seal(+observation: Observation) -> P.Pos:
  match observation:
    case OpenObs{_source}: zero_pos()
    case SealedObs{_source, final_extent}: final_extent
    case FaultObs{_source, _reason}: zero_pos()

def observation_open(+observation: Observation) -> Bool:
  match observation:
    case OpenObs{_source}: True{}
    case SealedObs{_source, _extent}: False{}
    case FaultObs{_source, _reason}: False{}

def observation_fault(+observation: Observation) -> Bool:
  match observation:
    case OpenObs{_source}: False{}
    case SealedObs{_source, _extent}: False{}
    case FaultObs{_source, _reason}: True{}

def observation_reason(+observation: Observation) -> String:
  match observation:
    case OpenObs{_source}: ""
    case SealedObs{_source, _extent}: ""
    case FaultObs{_source, reason}: reason

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

def sealed_result(+request: FrameRequest, +runs: List<SpanRun>, +pending: PendingSuffix,
                  +boundary: P.Pos, +inspected: P.Pos, +sealed: Bool, +source: SourceId,
                  +original: List<U32>) -> FramingResult:
  +frames = frames_of(runs, source)
  match pending:
    case NoPending{_at}:
      Framed{request, frames, pending, boundary, inspected, original}
    case PendingFrame{pending_source, start, _end, bytes}:
      Bool.pick(FramingResult, sealed,
        Framed{request, append_frame(frames, frame_of(start, inspected, pending_source, bytes)),
          NoPending{inspected}, inspected, inspected, original},
        Framed{request, frames, pending, boundary, inspected, original})

def qualified(+outcome: ScanOutcome, +request: FrameRequest, +sealed: Bool, +source: SourceId,
              +original: List<U32>) -> FramingResult:
  match outcome:
    case ScanDone{runs, pending, boundary, inspected}:
      sealed_result(request, runs, pending, boundary, inspected, sealed, source, original)
    case ScanRefused{reason}: FramingRefused{reason, request, original}

def declared_is(+result: P.PosResult) -> Bool:
  match result:
    case P.PosAccepted{_value}: True{}
    case P.PosRefused{_reason, _original}: False{}

def parsed_extent(+extent_octets: List<U32>) -> P.PosResult:
  P.parse_pos(extent_octets)

def declared_matches(+result: P.PosResult, +octets: List<U32>) -> Bool:
  match result:
    case P.PosAccepted{value}: extent_matches(octets, value)
    case P.PosRefused{_reason, _original}: False{}

def sealed_ok_for(+result: P.PosResult, +observation: Observation) -> Bool:
  match result:
    case P.PosAccepted{value}: sealed_extent_ok(value, observation)
    case P.PosRefused{_reason, _original}: False{}

def extent_ok(+extent_octets: List<U32>, +octets: List<U32>) -> Bool:
  declared_matches(parsed_extent(extent_octets), octets)

def ask_of(+octets: List<U32>, +extent_octets: List<U32>, +source: SourceId,
           +observation: Observation) -> FrameRequest:
  FrameAsk{octets, extent_octets, source, observation}

def frame_prefix(+octets: List<U32>, +extent_octets: List<U32>, +source: SourceId,
                 +observation: Observation) -> FramingResult:
  +request = ask_of(octets, extent_octets, source, observation)
  Bool.pick(FramingResult, all_octets(octets),
    Bool.pick(FramingResult, declared_is(parsed_extent(extent_octets)),
      Bool.pick(FramingResult, count_refuses(count_of(octets)),
        FramingRefused{count_reason(count_of(octets)), request, octets},
        Bool.pick(FramingResult, extent_ok(extent_octets, octets),
          Bool.pick(FramingResult, same_source(observation_source(observation), source),
            Bool.pick(FramingResult, observation_fault(observation),
              FramingRefused{observation_reason(observation), request, octets},
              Bool.pick(FramingResult,
                sealed_ok_for(parsed_extent(extent_octets), observation),
                qualified(scan_prefix(octets, source), request,
                  observation_sealed(observation), source, octets),
                FramingRefused{"sealed_extent_mismatch", request, octets})),
            FramingRefused{"foreign_source_observation", request, octets}),
          FramingRefused{"extent_mismatch", request, octets})),
      FramingRefused{"captured_extent_invalid", request, octets}),
    FramingRefused{"not_an_octet", request, octets})
