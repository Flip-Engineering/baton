# Receive-owned pure output-view derivation. No IO, no source access, no semantic effects.
#
# This module implements the parts of Receive100/101 that need no JSON parsing: octet
# and range identity, the four filter states, selection, the fold step, the framing
# and phase machine with resumeAt and scannedThrough, and the note phases.
#
# Decoder status, stated plainly: decode_frame is NOT implemented here. Receive100
# records that the reviewed source has no qualified complete frame decoder, and
# writing one is a separate bounded piece that must validate the entire accepted
# JSON grammar. Everything below therefore consumes facts a qualified decoder
# supplies, and no caller may substitute unvalidated agreement for those facts.
#
# UNCOMPILED and UNTESTED. No local compiler, parser, SQL probe, fixture or test was
# executed. Assume the types below are the review surface, not a proven composition.

type SourceLease {
  Store: String
  Actor: String
  Attempt: String
  Stream: String
  Incarnation: String
}

type RawRange {
  Start: U32
  End: U32
}

# One complete LF-delimited original range, with its original LF and its bytes.
# Bytes are opaque here; only a qualified decoder interprets them.
type CorrelatedRange {
  Lease: SourceLease
  Range: RawRange
  Bytes: String
  Selected: U32
}

# Facts a qualified decoder produces from the actual original bytes. transition is
# one of Unchanged, Delta, Unconfirmed, Refused.
type Facts {
  Update: Bool
  Transition: U32
}

# Determined invalid or undecodable original octets. Kept unchanged, state unchanged.
type Opaque {
  Range: RawRange
  Reason: String
}

# Decoder resource or internal failure, and unsupported valid JSON. Distinct from
# Opaque and from a source fault, which is a Controls outcome and never a pure result.
type DecodeFailure {
  Range: RawRange
  Error: String
}

type FilterState {
  Acknowledged: U32
}

type Selection {
  KeepOriginalRange: RawRange
  SuppressUpdate: RawRange
}

type Step {
  Selected: Selection
  Next: FilterState
}

# Framing positions. Both retain the complete source association. At final extent E
# both equal E, and note phases consume zero raw bytes.
type Positions {
  ResumeAt: U32
  ScannedThrough: U32
  Phase: U32
}

type DerivedNote {
  Lease: SourceLease
  FinalExtent: U32
  ViewVersion: U32
  Payload: String
}

# Filter state constants. Unacknowledged expresses the observer's state and does not
# assert that any request was written; Unacknowledged=0, Delta=1, Unconfirmed=2, Refused=3.
def initial() -> FilterState:
  FilterState{0}

# Recognized OMP stdout message_update suppression is independent of acknowledgement,
# so suppression is decided from the class policy below, never from filter state.
def suppresses_update(harness: String, stream: String, update: Bool) -> Bool:
  match stream:
    case "stdout":
      match harness:
        case "omp":
          update
        case _: False
    case _: False

def classify(harness: String, stream: String, facts: Facts) -> Selection:
  match suppresses_update(harness, stream, facts.Update):
    case True{}: Selection{SuppressUpdate(RawRange{0, 0}), RawRange{0, 0}}
    case False{}: Selection{KeepOriginalRange(RawRange{0, 0}), RawRange{0, 0}}

# One pure step: choose selection, then let a recognized transition replace the state.
def step(harness: String, stream: String, state: FilterState, facts: Facts) -> Step:
  match Facts{Update: facts.Update, Transition: facts.Transition}:
    case Facts{Update: _u, Transition: t}:
      match t:
        case 0: Step{classify(harness, stream, facts), FilterState{state.Acknowledged}}
        case _: Step{classify(harness, stream, facts), FilterState{t}}

# A complete range always advances both boundaries; suppression is a selection
# outcome and never a fold skip.
def advance(positions: Positions, range: RawRange) -> Positions:
  Positions{range.End, range.End, positions.Phase}

# Opaque and failed ranges never advance the completed fold boundary.
def rejected(positions: Positions) -> Positions:
  positions

# finish takes the actual filter state. For OMP stdout it yields a note only when the
# qualified all-writer final extent equals the folded boundary. Non-OMP yields no note.
def finish(harness: String, stream: String, state: FilterState, folded_through: U32,
           qualified_final_extent: U32, lease: SourceLease, view: U32) -> String:
  match suppresses_update(harness, stream, False{}):
    case _:
      match U32.eq(folded_through, qualified_final_extent):
        case True{}:
          match stream:
            case "stdout":
              "note:" ++ lease.Attempt ++ ":" ++ U32.show(qualified_final_extent) ++ ":" ++ U32.show(view)
            case _: "none"
        case False{}: "incomplete"

# Pending emits the note and returns Consumed; Consumed emits none. Both retain E, so
# retrying an older token replays the same deterministic note identity.
def pending(phase: U32, note: String, extent: U32) -> String:
  match phase:
    case 1: note ++ ":" ++ U32.show(extent)
    case _: "none"

def consumed(phase: U32) -> String:
  match phase:
    case 2: "none"
    case _: "none"

# resumeAt must be a genuine fully folded boundary and the interval to scannedThrough
# must contain only the pending incomplete frame; a position beyond the qualified
# extent is refused rather than trusted.
def validate_continuation(positions: Positions, qualified_extent: U32) -> Bool:
  match U32.lte(positions.ResumeAt, positions.ScannedThrough):
    case True{}: U32.lte(positions.ScannedThrough, qualified_extent)
    case False{}: False{}

# A token taken while the tail was open stays legitimate after a newly qualified
# all-writer seal arrives at the same extent. resumeAt below scannedThrough equal to
# that extent is accepted, provided the pending suffix hid no complete LF-delimited
# frame; the newly eligible unterminated tail is then folded. A forged scannedThrough
# that stepped over a complete frame is rejected instead of folded.
def accepts_tail(hid_complete_frame: Bool, sealed: Bool, positions: Positions,
                 qualified_extent: U32) -> Bool:
  match hid_complete_frame:
    case True{}: False{}
    case False{}:
      match sealed:
        case True{}: U32.eq(positions.ScannedThrough, qualified_extent)
        case False{}: U32.lt(positions.ResumeAt, positions.ScannedThrough)
