import Base
import ./darwin-sdk-selection.bend as S
import ../src/host/choice.bend as Choice
import ../src/git/text.bend as Text

def read_decimal(text: String, +value: Nat) -> Nat:
  match text:
    case SNil{}: value
    case SCon{digit, tail}:
      read_decimal(tail, Nat.add(Nat.mul(value, 10n), U32.to_nat(U32.sub(Char.to_u32(digit), 48))))

def decimal(+text: String, message: String) -> IO(Nat):
  do IO<Nat>:
    S.require(S.digits(String.trim(text)), message)
    IO.pure(Nat, read_decimal(String.trim(text), 0n))

def size(path: String) -> IO(String):
  do IO<String>:
    value : String <- S.command(".", "stat", ["-c", "%s", "--", path])
    IO.pure(String, String.trim(value))

def sha1(path: String) -> IO(String):
  do IO<String>:
    value : String <- S.command(".", "sha1sum", ["--zero", "--", path])
    IO.pure(String, String.take(value, 40n))

def slice(path: String, output: String, offset: Nat, length: Nat) -> IO(Unit):
  do IO<Unit>:
    unused : String <- S.command(".", "dd", ["if=" ++ path, "of=" ++ output, "iflag=skip_bytes,count_bytes",
      "skip=" ++ Nat.show(offset), "count=" ++ Nat.show(length), "status=none"])
    IO.pure(Unit, Unit{})

def xword(path: String, offset: String, width: String) -> IO(Nat):
  do IO<Nat>:
    value : String <- S.command(".", "od", ["-An", "-v", "--endian=big", "-t", "u" ++ width,
      "-j", offset, "-N", width, "--", path])
    decimal(String.trim(value), "The Apple SDK package uses an incomplete XAR header.")

def magic(path: String) -> IO(String):
  do IO<String>:
    value : String <- S.command(".", "od", ["-An", "-v", "-t", "x1", "-N", "4", "--", path])
    IO.pure(String, String.trim(value))

def payload(+package: String, +expected_size: String, expected_digest: String, +work: String) -> IO(String):
  +compressed = work ++ "/toc.zlib"
  +toc = work ++ "/toc.xml"
  +output = work ++ "/payload.pbzx"
  +entry = "/xar/toc/file[name='Payload']/data"
  do IO<String>:
    actual_size : String <- size(package)
    S.require(String.eq(actual_size, expected_size), "The Apple SDK package size differs from its catalog entry.")
    header_magic : String <- magic(package)
    +header_size : Nat <- xword(package, "4", "2")
    version : Nat <- xword(package, "6", "2")
    +toc_size : Nat <- xword(package, "8", "8")
    toc_length : Nat <- xword(package, "16", "8")
    checksum : Nat <- xword(package, "24", "4")
    S.require(Bool.and(String.eq(header_magic, "78 61 72 21"), Bool.and(Nat.is_ge(header_size, 28n),
      Bool.and(Nat.is_eq(version, 1n), Nat.is_eq(checksum, 1n)))),
      "The Apple SDK package uses an unsupported XAR header.")
    slice(package, compressed, header_size, toc_size)
    toc_sha1 : String <- sha1(compressed)
    S.require(String.eq(toc_sha1, expected_digest), "The Apple SDK package table of contents differs from its catalog digest.")
    unused : String <- S.command(".", "sh", ["-c", "exec zlib-flate -uncompress < \"$1\" > \"$2\"", "zlib-flate", compressed, toc])
    actual_length : String <- size(toc)
    S.require(String.eq(actual_length, Nat.show(toc_length)), "The Apple SDK package table of contents size differs.")
    data : String <- S.command(".", "xmllint", ["--nonet", "--xpath", "string(" ++ entry ++ "/offset)", toc])
    offset : Nat <- decimal(data, "The Apple SDK package has no Payload offset.")
    bytes : String <- S.command(".", "xmllint", ["--nonet", "--xpath", "string(" ++ entry ++ "/length)", toc])
    +length : Nat <- decimal(bytes, "The Apple SDK package has no Payload length.")
    archived : String <- S.command(".", "xmllint", ["--nonet", "--xpath",
      "string(" ++ entry ++ "/archived-checksum[@style='sha1'])", toc])
    slice(package, output, Nat.add(Nat.add(header_size, toc_size), offset), length)
    output_length : String <- size(output)
    actual_payload : String <- sha1(output)
    S.require(Bool.and(String.eq(output_length, Nat.show(length)), String.eq(actual_payload, String.trim(archived))),
      "The Apple SDK payload differs from its XAR table of contents.")
    IO.pure(String, output)

def chunk_sizes(result: List<String>) -> IO(Nat & Nat):
  match result:
    case raw <> stored <> Nil{}:
      do IO<Nat & Nat>:
        raw_size : Nat <- decimal(raw, "Invalid PBZX chunk length.")
        stored_size : Nat <- decimal(stored, "Invalid PBZX stored length.")
        IO.pure(Nat & Nat, (raw_size, stored_size))
    case other: IO.die(Nat & Nat, 1, "The PBZX chunk header is incomplete.")

@unsafe
def unpack_chunks(+data: String, +work: String, +position: Nat, +total: Nat) -> IO(Unit):
  Choice.choose(IO(Unit), Nat.is_eq(position, total), _ => IO.pure(Unit, Unit{}), _ =>
    do IO<Unit>:
      +start : Nat <- IO.pure(Nat, Nat.add(position, 16n))
      S.require(Nat.is_le(start, total), "The PBZX chunk header is incomplete.")
      header : String <- S.command(".", "od", ["-An", "-v", "--endian=big", "-t", "u8",
        "-j", Nat.show(position), "-N", "16", "--", data])
      +sizes : Nat & Nat <- chunk_sizes(Text.split_spaces(String.trim(header)))
      +raw : Nat <- IO.pure(Nat, Pair.fst(Nat, Nat, sizes))
      +stored : Nat <- IO.pure(Nat, Pair.snd(Nat, Nat, sizes))
      +end : Nat <- IO.pure(Nat, Nat.add(start, stored))
      S.require(Nat.is_le(end, total), "The PBZX chunk data is incomplete.")
      slice(data, work ++ "/block", start, stored)
      decoded : String <- Choice.choose(IO(String), Nat.is_eq(raw, stored),
        _ => IO.pure(String, work ++ "/block"),
        _ => do IO<String>:
          unused : String <- S.command(work, "sh", ["-c", "exec xz --decompress --stdout block > decoded"])
          IO.pure(String, work ++ "/decoded"))
      actual : String <- size(decoded)
      S.require(String.eq(actual, Nat.show(raw)), "The PBZX chunk size differs after decompression.")
      unused : String <- S.command(work, "sh", ["-c", "exec cat -- \"$1\" >> sdk.cpio", "cat", decoded])
      unpack_chunks(data, work, end, total))

def unpack(+data: String, +work: String, destination: String) -> IO(Unit):
  do IO<Unit>:
    header : String <- magic(data)
    length : String <- size(data)
    +total : Nat <- decimal(length, "Invalid PBZX file length.")
    S.require(Bool.and(Nat.is_ge(total, 12n), String.eq(header, "70 62 7a 78")), "The Apple SDK payload is not PBZX.")
    unused : String <- S.command(work, "touch", ["sdk.cpio"])
    unpack_chunks(data, work, 12n, total)
    unused : String <- S.command(destination, "sh", ["-c",
      "exec cpio --extract --make-directories --no-absolute-filenames --no-preserve-owner --quiet < \"$1\"",
      "cpio", work ++ "/sdk.cpio"])
    IO.pure(Unit, Unit{})
