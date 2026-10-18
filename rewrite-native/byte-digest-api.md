# Byte-read effect and pure Bend2 SHA-256: successor API freeze

Author: rewrite-native (GLM 5.3 Flash, omp). Ordered by root source
review (message on `2097aa9`/tree `dee3eddc`): implement the missing
mechanical byte-read effect, keep the SHA algorithm in Bend2, freeze the
exact successor API and obtain peer review before qualification. This
document is the freeze; no implementation lands before review.

## Host effect: exact-byte chunk reads (bend2/src/host/files.c)

Three effects on one open description, so identity holds across chunks:

    def Files.open(path: String) -> IO(Result<&1,&1,U32 & String,U32>)
    def Files.read_chunk(handle: U32, max: U32)
      -> IO(Result<&1,&1,U32 & String, List<U32> & U32>)
    def Files.close(handle: U32) -> IO(Result<&1,&1,U32 & String,Unit>)

- `open` admits regular files only (fstat after open; directories
  refuse EISDIR, other non-regular EINVAL, matching the copy gate) and
  answers a capability handle `slot | generation<<16` from a small fd
  registry in files.c, the BATCHILD pattern: a stale handle refuses
  ESTALE, a closed or unknown handle EBADF, registry exhaustion EMFILE.
- `read_chunk` returns up to `max` bytes as `List<U32>`, one `Con`
  cell per byte carrying its value 0..255 in the U32 - a grounded
  element type with toolchain precedent (U8 has none anywhere in the
  product sources) - paired with an end-of-file flag 0 or 1. Exact
  byte values: NUL and invalid UTF-8 pass as numbers; no UTF-8
  admission exists on this path. One internal read() syscall per
  call, EINTR resumed, errno kept on failure.
- `close` releases the registry slot and the descriptor; the errno of
  that close is the call's cause.
- No duration cap, no size cap beyond the caller's `max` (internal read
  bounded by `max` exactly, as upstream `file_read` bounds its count).

## Pure Bend2 SHA-256 (bend2/src/context/sha256.bend successor)

Incremental, pure, byte-list input - the K1 core's String boundary is
the reason it cannot serve files:

    type Sha256.State is Data:
      State{s0,s1,s2,s3,s4,s5,s6,s7: U32, bits_hi: U32, bits_lo: U32,
            block: List<&2, U32>, used: U32}
    def Sha256.init() -> State
    def Sha256.update(state: State, chunk: List<U32>) -> State
    def Sha256.final(state: State) -> List<&2, U32>  # 32 bytes, values 0..255
    def Sha256.hex(bytes: List<&2, U32>) -> String   # 64 lowercase hex digits
    def Sha256.digest(bytes: List<U32>) -> String # one-shot convenience

Grounded types per the review: the byte element is `U32` carrying
0..255, masked on entry so the module stays total for any caller; the
bit counter is a `U32` pair (bits_hi, bits_lo) - `U64` has no toolchain
precedent, and the pair covers inputs to 2^64 bits. The carry is
general, not bounded: adding a chunk of `m` bytes advances `bits_lo`
by the U32-wrapped `m << 3` and raises `bits_hi` by `(m >> 29) plus
one when the lo word wrapped` - `m >> 29` is exactly the number of
whole 2^32-bit words in `8*m`, so the formula is exact for every U32
`max` with no division and no stated cap. The FIPS 64-bit length
field emits bits_hi as the high four bytes and bits_lo as the low
four. The U32 operation set the round function and this carry need
(add, xor, and, not, shifts, rotations, compare) is the exact set the
K1 core already exercises in U32. Laws compile with the coordinator
entry and carry the algorithm: FIPS 180 "abc" vector, the empty-input
vector, and the 55/56/63/64/65 length-boundary vectors stated as
compile-time equations - the algorithm is verified at every compile,
which the C core could never offer.

## Composition and retirement sequencing

The install-check flow composes in Bend2:
`Files.open` -> `update` per chunk -> `final` -> `hex` -> `Files.close`.
Retirement follows the deletion-wins rule: when this slice qualifies,
`Files.digest`'s C half and `sha256.h` retire (kimi's K1 already deletes
`role-digest.c`), and tooling's consumer switches to the composition.
Until qualification, the C `Files.digest` remains the shipped path -
no window where the install check loses its digest.

## Qualification vectors (authored with the implementation, executed
under C-cap)

hashlib oracles, independent of both implementations: empty input;
binary content with NUL and invalid UTF-8 sequences; lengths 55, 56,
63, 64, 65 (padding boundaries); multi-chunk inputs crossing internal
read boundaries; one larger retained file (the tens-of-MB class, in
fixtures); concrete missing (ENOENT), permission (EACCES as non-root,
0-mode root-proof only where no x/read bit exists), type (directory
EISDIR, FIFO with no writer via the same nonblocking-open discipline
as copy), and mid-read failure causes. Paired target/candidate runs
preserve fixture directories, waits, output bytes and backend
identities.
