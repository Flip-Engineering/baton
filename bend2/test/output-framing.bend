# Executable corpus for bend2/src/receive/output-framing.bend.
# CLAIM: every ordinary corpus case calls the public framer through frame_prefix, and every
# control case calls a comparator helper directly. Both compare the complete typed result,
# including the retained request and observation, every frame range with its exact bytes in
# order, the pending suffix, the last complete boundary, the inspected extent and the refusal
# reason. Control groups assert the comparators by requiring inequality when exactly one field
# differs. The fault rows appear in two groups, so their coverage is deliberately repeated.
# Representation. Case octets are literal byte values, and every position expectation is a
# literal decimal digit list, so no expectation is copied from the implementation. The captured
# extent is decimal text, as the API requires.
# Language forms: definitions before their callers, positional constructor patterns, Bool.pick
# with a first type argument, and a plus binder on any binding used more than once.
# UNCOMPILED and UNTESTED.

import Base
import ../src/receive/output-framing.bend as F
import ../src/receive/output-position.bend as P

def same_units(left: List<U32>, right: List<U32>) -> Bool:
  match left:
    case Nil{}:
      match right:
        case Nil{}: True{}
        case _r <> _rt: False{}
    case lh <> lt:
      match right:
        case Nil{}: False{}
        case rh <> rt: Bool.pick(Bool, U32.is_eq(lh, rh), same_units(lt, rt), False{})

def digits_of_pos(+value: P.Pos) -> List<U32>:
  match value:
    case P.PosDigits{digits}: digits

# Positions are compared through their raw constructor digits, so a forged invalid position in
# a retained request is compared exactly instead of being collapsed by checked numeric equality.
def same_pos(left: P.Pos, right: P.Pos) -> Bool:
  same_units(digits_of_pos(left), digits_of_pos(right))

def pos(digits: List<U32>) -> P.Pos:
  P.PosDigits{digits}

def same_source(left: F.SourceId, right: F.SourceId) -> Bool:
  match left:
    case F.SourceRef{store, actor, attempt, stream, attempt_dir, stream_id, incarnation,
                     contract_version, lease_owner}:
      match right:
        case F.SourceRef{b_store, b_actor, b_attempt, b_stream, b_dir, b_id, b_incarnation,
                         b_version, b_owner}:
          Bool.and(String.eq(store, b_store),
            Bool.and(String.eq(actor, b_actor),
              Bool.and(String.eq(attempt, b_attempt),
                Bool.and(String.eq(stream, b_stream),
                  Bool.and(String.eq(attempt_dir, b_dir),
                    Bool.and(String.eq(stream_id, b_id),
                      Bool.and(String.eq(incarnation, b_incarnation),
                        Bool.and(String.eq(contract_version, b_version),
                          String.eq(lease_owner, b_owner)))))))))

def same_observation(left: F.Observation, right: F.Observation) -> Bool:
  match left:
    case F.OpenObs{a_source}:
      match right:
        case F.OpenObs{b_source}: same_source(a_source, b_source)
        case F.SealedObs{_b_source, _b_extent}: False{}
        case F.FaultObs{_b_source, _b_reason}: False{}
    case F.SealedObs{a_source, a_extent}:
      match right:
        case F.OpenObs{_b_source}: False{}
        case F.SealedObs{b_source, b_extent}:
          Bool.and(same_source(a_source, b_source), same_pos(a_extent, b_extent))
        case F.FaultObs{_b_source, _b_reason}: False{}
    case F.FaultObs{a_source, a_reason}:
      match right:
        case F.OpenObs{_b_source}: False{}
        case F.SealedObs{_b_source, _b_extent}: False{}
        case F.FaultObs{b_source, b_reason}:
          Bool.and(same_source(a_source, b_source), String.eq(a_reason, b_reason))

def same_request(left: F.FrameRequest, right: F.FrameRequest) -> Bool:
  match left:
    case F.FrameAsk{a_octets, a_extent, a_source, a_observation}:
      match right:
        case F.FrameAsk{b_octets, b_extent, b_source, b_observation}:
          Bool.and(same_units(a_octets, b_octets),
            Bool.and(same_units(a_extent, b_extent),
              Bool.and(same_source(a_source, b_source),
                same_observation(a_observation, b_observation))))

def same_frame(left: F.Frame, right: F.Frame) -> Bool:
  match left:
    case F.FrameRange{a_start, a_end, a_source, a_bytes}:
      match right:
        case F.FrameRange{b_start, b_end, b_source, b_bytes}:
          Bool.and(same_pos(a_start, b_start),
            Bool.and(same_pos(a_end, b_end),
              Bool.and(same_source(a_source, b_source), same_units(a_bytes, b_bytes))))

def same_frames(left: List<F.Frame>, right: List<F.Frame>) -> Bool:
  match left:
    case Nil{}:
      match right:
        case Nil{}: True{}
        case _r <> _rt: False{}
    case lh <> lt:
      match right:
        case Nil{}: False{}
        case rh <> rt: Bool.pick(Bool, same_frame(lh, rh), same_frames(lt, rt), False{})

def same_pending(left: F.PendingSuffix, right: F.PendingSuffix) -> Bool:
  match left:
    case F.NoPending{a_at}:
      match right:
        case F.NoPending{b_at}: same_pos(a_at, b_at)
        case F.PendingFrame{_b_source, _b_start, _b_end, _b_bytes}: False{}
    case F.PendingFrame{a_source, a_start, a_end, a_bytes}:
      match right:
        case F.NoPending{_b_at}: False{}
        case F.PendingFrame{b_source, b_start, b_end, b_bytes}:
          Bool.and(same_source(a_source, b_source),
            Bool.and(same_pos(a_start, b_start),
              Bool.and(same_pos(a_end, b_end), same_units(a_bytes, b_bytes))))

def same_result(left: F.FramingResult, right: F.FramingResult) -> Bool:
  match left:
    case F.Framed{a_request, a_frames, a_pending, a_boundary, a_inspected, a_original}:
      match right:
        case F.Framed{b_request, b_frames, b_pending, b_boundary, b_inspected, b_original}:
          Bool.and(same_request(a_request, b_request),
            Bool.and(same_frames(a_frames, b_frames),
              Bool.and(same_pending(a_pending, b_pending),
                Bool.and(same_pos(a_boundary, b_boundary),
                  Bool.and(same_pos(a_inspected, b_inspected),
                    same_units(a_original, b_original))))))
        case F.FramingRefused{_b_reason, _b_request, _b_original}: False{}
    case F.FramingRefused{a_reason, a_request, a_original}:
      match right:
        case F.Framed{_b_request, _b_frames, _b_pending, _b_boundary, _b_inspected, _b_original}:
          False{}
        case F.FramingRefused{b_reason, b_request, b_original}:
          Bool.and(String.eq(a_reason, b_reason),
            Bool.and(same_request(a_request, b_request), same_units(a_original, b_original)))

def source() -> F.SourceId:
  F.SourceRef{"store-a", "actor-a", "attempt-a", "stdout", "attempt-dir-a", "stream-a",
    "incarnation-a", "v1", "lease-a"}

def other_source() -> F.SourceId:
  F.SourceRef{"store-a", "actor-a", "attempt-a", "stdout", "attempt-dir-a", "stream-a",
    "incarnation-a", "v1", "lease-b"}

def open_obs() -> F.Observation:
  F.OpenObs{source()}

def sealed_obs(digits: List<U32>) -> F.Observation:
  F.SealedObs{source(), pos(digits)}

def fault_obs(reason: String) -> F.Observation:
  F.FaultObs{source(), reason}

def foreign_obs() -> F.Observation:
  F.OpenObs{other_source()}

def frame(start: List<U32>, end: List<U32>, bytes: List<U32>) -> F.Frame:
  F.FrameRange{pos(start), pos(end), source(), bytes}

def ask(octets: List<U32>, extent: List<U32>, observation: F.Observation) -> F.FrameRequest:
  F.FrameAsk{octets, extent, source(), observation}

def framed(+octets: List<U32>, extent: List<U32>, observation: F.Observation,
           frames: List<F.Frame>, pending: F.PendingSuffix, boundary: List<U32>,
           inspected: List<U32>) -> F.FramingResult:
  F.Framed{ask(octets, extent, observation), frames, pending, pos(boundary), pos(inspected),
    octets}

def refused(+octets: List<U32>, extent: List<U32>, observation: F.Observation,
            reason: String) -> F.FramingResult:
  F.FramingRefused{reason, ask(octets, extent, observation), octets}

def no_pending(at: List<U32>) -> F.PendingSuffix:
  F.NoPending{pos(at)}

def pending_bytes(start: List<U32>, end: List<U32>, bytes: List<U32>) -> F.PendingSuffix:
  F.PendingFrame{source(), pos(start), pos(end), bytes}

def cases() -> List<List<U32> & List<U32> & F.Observation & F.FramingResult & String>:
  [
    ([], [48], open_obs(), framed([], [48], open_obs(), [], no_pending([0]), [0], [0]),
      "empty-prefix-open"),
    ([], [48], sealed_obs([0]), framed([], [48], sealed_obs([0]), [], no_pending([0]), [0], [0]),
      "empty-prefix-sealed-no-extra-frame"),
    ([10], [49], open_obs(), framed([10], [49], open_obs(), [frame([0], [1], [10])], no_pending([1]),
      [1], [1]), "single-lf-one-frame"),
    ([10], [49], sealed_obs([1]),
      framed([10], [49], sealed_obs([1]), [frame([0], [1], [10])], no_pending([1]), [1], [1]),
      "single-lf-sealed-no-extra-frame"),
    ([13, 10], [50], open_obs(), framed([13, 10], [50], open_obs(), [frame([0], [2], [13, 10])],
      no_pending([2]), [2], [2]), "crlf-keeps-carriage-return"),
    ([97, 98, 10], [51], open_obs(),
      framed([97, 98, 10], [51], open_obs(), [frame([0], [3], [97, 98, 10])], no_pending([3]), [3], [3]),
      "ab-lf-unchanged-bytes"),
    ([97, 10, 98], [51], open_obs(),
      framed([97, 10, 98], [51], open_obs(), [frame([0], [2], [97, 10])], pending_bytes([2], [3], [98]),
        [2], [3]), "a-lf-b-open-retains-suffix"),
    ([97, 10, 98], [51], sealed_obs([3]),
      framed([97, 10, 98], [51], sealed_obs([3]), [frame([0], [2], [97, 10]), frame([2], [3], [98])],
        no_pending([3]), [3], [3]), "a-lf-b-sealed-appends-final-frame"),
    ([97, 10, 98], [51], sealed_obs([2]),
      refused([97, 10, 98], [51], sealed_obs([2]), "sealed_extent_mismatch"),
      "sealed-extent-mismatch-refused"),
    ([10, 10], [50], open_obs(), framed([10, 10], [50], open_obs(),
      [frame([0], [1], [10]), frame([1], [2], [10])], no_pending([2]), [2], [2]),
      "two-blank-lines-two-frames"),
    ([10, 10, 10], [51], open_obs(), framed([10, 10, 10], [51], open_obs(),
      [frame([0], [1], [10]), frame([1], [2], [10]), frame([2], [3], [10])], no_pending([3]), [3], [3]),
      "repeated-identical-frames-stay-distinct"),
    ([97, 10, 97, 10, 98], [53], open_obs(),
      framed([97, 10, 97, 10, 98], [53], open_obs(),
        [frame([0], [2], [97, 10]), frame([2], [4], [97, 10])], pending_bytes([4], [5], [98]), [4], [5]),
      "equal-frames-at-distinct-positions"),
    ([0, 255, 10], [51], open_obs(), framed([0, 255, 10], [51], open_obs(),
      [frame([0], [3], [0, 255, 10])], no_pending([3]), [3], [3]),
      "nul-and-non-utf8-retained"),
    ([123, 34, 97, 34, 58, 49, 125, 10], [56], open_obs(),
      framed([123, 34, 97, 34, 58, 49, 125, 10], [56], open_obs(),
        [frame([0], [8], [123, 34, 97, 34, 58, 49, 125, 10])], no_pending([8]), [8], [8]),
      "json-looking-bytes-have-no-framing-meaning"),
    ([97, 10], [50], open_obs(),
      framed([97, 10], [50], open_obs(), [frame([0], [2], [97, 10])], no_pending([2]), [2], [2]),
      "lf-ending-no-extra-frame"),
    ([97, 98], [50], open_obs(),
      framed([97, 98], [50], open_obs(), [], pending_bytes([0], [2], [97, 98]), [0], [2]),
      "no-lf-nonempty-open-retains-suffix"),
    ([97, 98], [50], sealed_obs([2]),
      framed([97, 98], [50], sealed_obs([2]), [frame([0], [2], [97, 98])], no_pending([2]), [2], [2]),
      "no-lf-nonempty-same-extent-seal-appends-frame"),
    ([10, 97, 10, 98, 99], [53], open_obs(),
      framed([10, 97, 10, 98, 99], [53], open_obs(),
        [frame([0], [1], [10]), frame([1], [3], [97, 10])], pending_bytes([3], [5], [98, 99]),
        [3], [5]), "several-frames-with-multi-byte-suffix"),
    ([97, 10], [50], F.SealedObs{source(), pos([0, 1])},
      refused([97, 10], [50], F.SealedObs{source(), pos([0, 1])}, "sealed_extent_mismatch"),
      "invalid-constructed-seal-pos-retained-and-refused"),
    ([97, 98, 10], [51], foreign_obs(),
      refused([97, 98, 10], [51], foreign_obs(), "foreign_source_observation"),
      "foreign-observation-source-refused"),
    ([97, 10], [51], open_obs(), refused([97, 10], [51], open_obs(), "extent_mismatch"),
      "declared-extent-mismatch-refused"),
    ([97, 10], [45, 49], open_obs(), refused([97, 10], [45, 49], open_obs(), "captured_extent_invalid"),
      "malformed-extent-bytes-refused"),
    ([97, 10], [], open_obs(), refused([97, 10], [], open_obs(), "captured_extent_invalid"),
      "empty-extent-bytes-refused"),
    ([97, 256], [50], open_obs(), refused([97, 256], [50], open_obs(), "not_an_octet"),
      "non-octet-payload-refused"),
    ([97, 10], [50], fault_obs("extent_mismatch"),
      refused([97, 10], [50], fault_obs("extent_mismatch"), "extent_mismatch"),
      "source-fault-reason-identical-to-extent-diagnostic"),
    ([97, 10], [50], fault_obs("source_fault_recorded"),
      refused([97, 10], [50], fault_obs("source_fault_recorded"), "source_fault_recorded"),
      "fault-reported-after-matching-extent"),
  ]

def fault_cases() -> List<List<U32> & List<U32> & F.Observation & F.FramingResult & String>:
  [
    ([97, 10], [50], fault_obs("source_fault_recorded"),
      refused([97, 10], [50], fault_obs("source_fault_recorded"), "source_fault_recorded"),
      "source-fault-reported"),
    ([97, 10], [50], fault_obs("extent_mismatch"),
      refused([97, 10], [50], fault_obs("extent_mismatch"), "extent_mismatch"),
      "fault-reason-equal-to-another-diagnostic"),
    ([97, 10], [50], foreign_obs(),
      refused([97, 10], [50], foreign_obs(), "foreign_source_observation"),
      "foreign-observation-before-fault-check"),
  ]

def unequal_sources() -> List<F.SourceId & F.SourceId & String>:
  [
    (source(), other_source(), "synthetic-source-lease-owner"),
    (F.SourceRef{"store-b", "actor-a", "attempt-a", "stdout", "attempt-dir-a", "stream-a",
      "incarnation-a", "v1", "lease-a"}, source(), "synthetic-source-store"),
    (F.SourceRef{"store-a", "actor-b", "attempt-a", "stdout", "attempt-dir-a", "stream-a",
      "incarnation-a", "v1", "lease-a"}, source(), "synthetic-source-actor"),
    (F.SourceRef{"store-a", "actor-a", "attempt-b", "stdout", "attempt-dir-a", "stream-a",
      "incarnation-a", "v1", "lease-a"}, source(), "synthetic-source-attempt"),
    (F.SourceRef{"store-a", "actor-a", "attempt-a", "stderr", "attempt-dir-a", "stream-a",
      "incarnation-a", "v1", "lease-a"}, source(), "synthetic-source-stream"),
    (F.SourceRef{"store-a", "actor-a", "attempt-a", "stdout", "attempt-dir-b", "stream-a",
      "incarnation-a", "v1", "lease-a"}, source(), "synthetic-source-attempt-dir"),
    (F.SourceRef{"store-a", "actor-a", "attempt-a", "stdout", "attempt-dir-a", "stream-b",
      "incarnation-a", "v1", "lease-a"}, source(), "synthetic-source-stream-id"),
    (F.SourceRef{"store-a", "actor-a", "attempt-a", "stdout", "attempt-dir-a", "stream-a",
      "incarnation-b", "v1", "lease-a"}, source(), "synthetic-source-incarnation"),
    (F.SourceRef{"store-a", "actor-a", "attempt-a", "stdout", "attempt-dir-a", "stream-a",
      "incarnation-a", "v2", "lease-a"}, source(), "synthetic-source-contract-version"),
  ]

def unequal_observations() -> List<F.Observation & F.Observation & String>:
  [
    (open_obs(), sealed_obs([1]), "synthetic-observation-variant"),
    (sealed_obs([1]), sealed_obs([2]), "synthetic-observation-seal-extent"),
    (sealed_obs([1]), foreign_obs(), "synthetic-observation-source"),
    (fault_obs("first"), fault_obs("second"), "synthetic-observation-fault-reason"),
  ]

def unequal_requests() -> List<F.FrameRequest & F.FrameRequest & String>:
  [
    (ask([97], [49], open_obs()), ask([98], [49], open_obs()), "synthetic-request-octets"),
    (ask([97], [49], open_obs()), ask([97], [50], open_obs()), "synthetic-request-extent-octets"),
    (ask([97], [49], open_obs()), ask([97], [49], foreign_obs()),
      "synthetic-request-observation"),
  ]

def unequal_pendings() -> List<F.PendingSuffix & F.PendingSuffix & String>:
  [
    (no_pending([1]), pending_bytes([1], [2], [10]), "synthetic-pending-disposition"),
    (pending_bytes([1], [2], [10]), pending_bytes([1], [3], [10]), "synthetic-pending-end"),
    (pending_bytes([1], [2], [10]), pending_bytes([1], [2], [11]), "synthetic-pending-bytes"),
  ]

def unequal_results() -> List<F.FramingResult & F.FramingResult & String>:
  [
    (framed([10], [49], open_obs(), [frame([0], [1], [10])], no_pending([1]), [1], [1]),
      framed([10], [49], open_obs(), [frame([0], [1], [10])], no_pending([1]), [1], [2]),
      "synthetic-result-inspected"),
    (framed([10], [49], open_obs(), [frame([0], [1], [10])], no_pending([1]), [1], [1]),
      framed([10], [49], open_obs(), [frame([0], [1], [10])], no_pending([2]), [1], [1]),
      "synthetic-result-boundary"),
    (framed([10], [49], open_obs(), [], no_pending([1]), [1], [1]),
      framed([10], [49], open_obs(), [frame([0], [1], [10])], no_pending([1]), [1], [1]),
      "synthetic-result-frame-count"),
    (framed([10], [49], open_obs(), [frame([0], [1], [10])], no_pending([1]), [1], [1]),
      framed([10], [49], open_obs(), [frame([0], [1], [11])], no_pending([1]), [1], [1]),
      "synthetic-result-frame-bytes"),
    (framed([10], [49], open_obs(), [frame([0], [1], [10])], no_pending([1]), [1], [1]),
      refused([10], [49], open_obs(), "extent_mismatch"), "synthetic-result-disposition"),
    (refused([10], [49], open_obs(), "extent_mismatch"),
      refused([10], [49], open_obs(), "sealed_extent_mismatch"), "synthetic-result-reason"),
  ]

def judge(actual: F.FramingResult, expected: F.FramingResult, name: String) -> IO(Unit):
  +verdict = same_result(actual, expected)
  match verdict:
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.die(Unit, 1, name)

def judge_source(left: F.SourceId, right: F.SourceId, name: String) -> IO(Unit):
  +verdict = same_source(left, right)
  match verdict:
    case True{}: IO.die(Unit, 1, name)
    case False{}: IO.pure(Unit, Unit{})

def judge_observation(left: F.Observation, right: F.Observation, name: String) -> IO(Unit):
  +verdict = same_observation(left, right)
  match verdict:
    case True{}: IO.die(Unit, 1, name)
    case False{}: IO.pure(Unit, Unit{})

def judge_request(left: F.FrameRequest, right: F.FrameRequest, name: String) -> IO(Unit):
  +verdict = same_request(left, right)
  match verdict:
    case True{}: IO.die(Unit, 1, name)
    case False{}: IO.pure(Unit, Unit{})

def judge_pending(left: F.PendingSuffix, right: F.PendingSuffix, name: String) -> IO(Unit):
  +verdict = same_pending(left, right)
  match verdict:
    case True{}: IO.die(Unit, 1, name)
    case False{}: IO.pure(Unit, Unit{})

def judge_unequal(left: F.FramingResult, right: F.FramingResult, name: String) -> IO(Unit):
  +verdict = same_result(left, right)
  match verdict:
    case True{}: IO.die(Unit, 1, name)
    case False{}: IO.pure(Unit, Unit{})

def check(case: List<U32> & List<U32> & F.Observation & F.FramingResult & String) -> IO(Unit):
  (octets, extent, observation, expected, name) = case
  judge(F.frame_prefix(octets, extent, source(), observation), expected, name)

def check_source(pair: F.SourceId & F.SourceId & String) -> IO(Unit):
  (left, right, name) = pair
  judge_source(left, right, name)

def check_observation(pair: F.Observation & F.Observation & String) -> IO(Unit):
  (left, right, name) = pair
  judge_observation(left, right, name)

def check_request(pair: F.FrameRequest & F.FrameRequest & String) -> IO(Unit):
  (left, right, name) = pair
  judge_request(left, right, name)

def check_pending(pair: F.PendingSuffix & F.PendingSuffix & String) -> IO(Unit):
  (left, right, name) = pair
  judge_pending(left, right, name)

def check_pair(pair: F.FramingResult & F.FramingResult & String) -> IO(Unit):
  (left, right, name) = pair
  judge_unequal(left, right, name)

def run(rows: List<List<U32> & List<U32> & F.Observation & F.FramingResult & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check(h)
        run(t)

def run_sources(rows: List<F.SourceId & F.SourceId & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check_source(h)
        run_sources(t)

def run_observations(rows: List<F.Observation & F.Observation & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check_observation(h)
        run_observations(t)

def run_requests(rows: List<F.FrameRequest & F.FrameRequest & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check_request(h)
        run_requests(t)

def run_pendings(rows: List<F.PendingSuffix & F.PendingSuffix & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check_pending(h)
        run_pendings(t)

def run_pairs(rows: List<F.FramingResult & F.FramingResult & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check_pair(h)
        run_pairs(t)

def main() -> IO(Unit):
  do IO<Unit>:
    all : Unit <- run(cases())
    faults : Unit <- run(fault_cases())
    sources : Unit <- run_sources(unequal_sources())
    observations : Unit <- run_observations(unequal_observations())
    requests : Unit <- run_requests(unequal_requests())
    pendings : Unit <- run_pendings(unequal_pendings())
    pairs : Unit <- run_pairs(unequal_results())
    IO.pure(Unit, Unit{})
