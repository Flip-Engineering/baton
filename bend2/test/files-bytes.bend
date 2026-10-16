import Base
import ../src/host/text.bend as Text
import ../src/host/files.bend as Files
import ../src/context/sha256.bend as Sha256

# Files.open/read_chunk/close and the pure Bend2 SHA-256 composition
# vectors (bend2/src/context/sha256.bend, frozen API in
# rewrite-native/byte-digest-api.md). Each outcome lands in its own
# results file. The binary fixture is 200 bytes: two full 128-byte
# chunks and a 72-byte end-of-file chunk, crossing block and chunk
# boundaries at once. Expected hex values are hashlib constants in the
# driver.
def line_string(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Done{value}: "ok:" ++ value ++ "\n"
    case Fail{(code, message)}: "fail:" ++ U32.show(code) ++ "\n"

def line_u32(result: Result<&1,&1,U32 & String,U32>) -> String:
  match result:
    case Done{value}: "ok:\n"
    case Fail{(code, message)}: "fail:" ++ U32.show(code) ++ "\n"

def line_unit(result: Result<&1,&1,U32 & String,Unit>) -> String:
  match result:
    case Done{unit}: "ok:\n"
    case Fail{(code, message)}: "fail:" ++ U32.show(code) ++ "\n"

def line_bytes(result: Result<&1,&1,U32 & String,List<U32> & U32>) -> String:
  match result:
    case Done{(bytes, eof)}: "ok:\n"
    case Fail{(code, message)}: "fail:" ++ U32.show(code) ++ "\n"

def handle_of(result: Result<&1,&1,U32 & String,U32>) -> U32:
  match result:
    case Done{value}: value
    case Fail{(code, message)}: 0

def bytes_of(result: Result<&1,&1,U32 & String,List<U32> & U32>) -> List<U32>:
  match result:
    case Done{(bytes, eof)}: bytes
    case Fail{(code, message)}: Nil{}

def main() -> IO(Unit):
  do IO<Unit>:
    opened : Result<&1,&1,U32 & String,U32> <- Files.Files.open("cases/binary")
    handle : U32 <- IO.pure(U32,handle_of(opened))
    r1 : Result<&1,&1,U32 & String,List<U32> & U32> <- Files.Files.read_chunk(handle, 128)
    c1 : List<U32> <- IO.pure(List<U32>,bytes_of(r1))
    s1 : Sha256.State <- IO.pure(Sha256.State,Sha256.update(Sha256.init, c1))
    r2 : Result<&1,&1,U32 & String,List<U32> & U32> <- Files.Files.read_chunk(handle, 128)
    c2 : List<U32> <- IO.pure(List<U32>,bytes_of(r2))
    s2 : Sha256.State <- IO.pure(Sha256.State,Sha256.update(s1, c2))
    r3 : Result<&1,&1,U32 & String,List<U32> & U32> <- Files.Files.read_chunk(handle, 128)
    c3 : List<U32> <- IO.pure(List<U32>,bytes_of(r3))
    s3 : Sha256.State <- IO.pure(Sha256.State,Sha256.update(s2, c3))
    closed : Result<&1,&1,U32 & String,Unit> <- Files.Files.close(handle)
    IO.try(Unit,Text.Text.append("results-b1","ok:" ++ Sha256.hex(Sha256.final(s3)) ++ "\n"))
    reopened : Result<&1,&1,U32 & String,U32> <- Files.Files.open("cases/empty")
    empty_handle : U32 <- IO.pure(U32,handle_of(reopened))
    er : Result<&1,&1,U32 & String,List<U32> & U32> <- Files.Files.read_chunk(empty_handle, 128)
    ec : List<U32> <- IO.pure(List<U32>,bytes_of(er))
    es : Sha256.State <- IO.pure(Sha256.State,Sha256.update(Sha256.init, ec))
    IO.try(Unit,Text.Text.append("results-b2","ok:" ++ Sha256.hex(Sha256.final(es)) ++ "\n"))
    gone : Result<&1,&1,U32 & String,U32> <- Files.Files.open("cases/absent")
    IO.try(Unit,Text.Text.append("results-b3",line_u32(gone)))
    placed : Result<&1,&1,U32 & String,U32> <- Files.Files.open("cases/dir")
    IO.try(Unit,Text.Text.append("results-b4",line_u32(placed)))
    stale : Result<&1,&1,U32 & String,List<U32> & U32> <- Files.Files.read_chunk(handle, 8)
    IO.try(Unit,Text.Text.append("results-b5",line_bytes(stale)))
    again : Result<&1,&1,U32 & String,Unit> <- Files.Files.close(handle)
    IO.try(Unit,Text.Text.append("results-b6",line_unit(again)))
