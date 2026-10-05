import Base
import ./receive-request.bend as R

# Raw octets use the pinned Base Word type, without character decoding.
# The host adapter must preserve their order and exact bit values.
type FrameBytes is Data:
  FrameBytes{octets: List<&2,Word(8n)>}

# Unsigned 64-bit byte offsets, represented using the pinned U32 primitives.
type ByteOffset is Data:
  ByteOffset{high: U32, low: U32}

type OffsetFault is Data:
  OffsetOverflow{}

type Cursor is Data:
  Cursor{attempt: String, stream: String, offset: ByteOffset}

# These opaque identifiers are issued and validated by the host registry.
# They contain no public process-local handle index. Storage reuse needs a
# new capability identity; owner replacement needs a new owner identity.
type ReadVersion is Data:
  ReadVersion{owner: String, capability: String, generation: String}

type ReadRegistration is Data:
  ReadRegistration{version: ReadVersion, registration: String, sink: R.RequestOutput}

def offset_result(high: U32, low: U32, carry: Bool, overflow: Bool) -> Result<&2,&2,OffsetFault,ByteOffset>:
  match overflow:
    case True{}: Fail{OffsetOverflow{}}
    case False{}:
      match carry:
        case False{}: Done{ByteOffset{high,low}}
        case True{}:
          match U32.is_eq(high,4294967295):
            case True{}: Fail{OffsetOverflow{}}
            case False{}: Done{ByteOffset{U32.add(high,1),low}}

def offset_sum(left: ByteOffset, right: ByteOffset) -> Result<&2,&2,OffsetFault,ByteOffset>:
  match left:
    case ByteOffset{+high,+low}:
      match right:
        case ByteOffset{other_high,other_low}:
          +next_high = U32.add(high,other_high)
          +next_low = U32.add(low,other_low)
          offset_result(next_high,next_low,U32.is_lt(next_low,low),U32.is_lt(next_high,high))

law offset_carry_keeps_the_high_word:
  {offset_sum(ByteOffset{0,4294967295},ByteOffset{0,1}) == Done{ByteOffset{1,0}} : Result<&2,&2,OffsetFault,ByteOffset>}

def offset_carry_keeps_the_high_word():
  {==}

law offset_high_word_overflow_is_refused:
  {offset_sum(ByteOffset{4294967295,0},ByteOffset{1,0}) == Fail{OffsetOverflow{}} : Result<&2,&2,OffsetFault,ByteOffset>}

def offset_high_word_overflow_is_refused():
  {==}

law offset_carry_overflow_is_refused:
  {offset_sum(ByteOffset{4294967295,4294967295},ByteOffset{0,1}) == Fail{OffsetOverflow{}} : Result<&2,&2,OffsetFault,ByteOffset>}

def offset_carry_overflow_is_refused():
  {==}

law offset_empty_advance_preserves_position:
  {offset_sum(ByteOffset{4,12},ByteOffset{0,0}) == Done{ByteOffset{4,12}} : Result<&2,&2,OffsetFault,ByteOffset>}

def offset_empty_advance_preserves_position():
  {==}
