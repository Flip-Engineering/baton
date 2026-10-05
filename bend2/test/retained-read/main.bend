import Base
import ../../src/context/retained-read.bend as R

def show(value: Result<&2,&2,R.OffsetFault,R.ByteOffset>) -> String:
  match value:
    case Fail{R.OffsetOverflow{}}: "overflow"
    case Done{R.ByteOffset{high,low}}: U32.show(high) ++ ":" ++ U32.show(low)

def main() -> IO(Unit):
  IO.print(
    show(R.offset_sum(R.ByteOffset{0,4294967295},R.ByteOffset{0,1})) ++ "\n" ++
    show(R.offset_sum(R.ByteOffset{4294967295,0},R.ByteOffset{1,0})) ++ "\n" ++
    show(R.offset_sum(R.ByteOffset{4294967295,4294967295},R.ByteOffset{0,1})) ++ "\n" ++
    show(R.offset_sum(R.ByteOffset{4,12},R.ByteOffset{0,0})))
