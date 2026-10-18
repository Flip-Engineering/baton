# Pure Bend SHA-256 successor: incremental state over byte lists, the
# frozen API in rewrite-native/byte-digest-api.md. The compression core
# is the repaired K1 implementation, reused verbatim (rotations, schedule,
# rounds, feed-forward, split, padding helpers, one-shot String digest for
# the role identity consumers). The incremental layer adds the State carry
# pair, block buffering, and the exact-byte List<U32> domain the file
# composition needs. Ground vectors are hashlib constants over ASCII
# fixtures; the binary fixture carries NUL and invalid UTF-8 sequences as
# plain byte values; the incremental law pins split-equals-one-shot at a
# block boundary.
#
# Checker discipline as in K1: shrinking argument first, one dup bind per
# fanned value, matches at def-body heads, helpers before callers.

# Pure Bend SHA-256 over the UTF-8 bytes of a string. Replaces the C host
# implementation that was bound to Context.role_guard_key
# (bend2/src/context/role-digest.c, deleted in the same change). The digest
# domain is the string's exact UTF-8 bytes, matching the deleted C
# implementation's strlen semantics for any value the product builds. The C
# could also fail with ENOMEM; the Bend port has no such result, which is a
# recorded unproven-parity limitation, not a claim that evaluation cannot
# exhaust memory.
#
# The recursion follows the checker's rules: the shrinking argument first, one
# dup bind per fanned value, matches only at def-body heads, and every helper
# defined before its caller.

import Base
import ../json/canonical.bend as J

type ShaState is Data:
  ShaState{a: U32, b: U32, c: U32, d: U32, e: U32, f: U32, g: U32, h: U32}


# Rotate right by hi bits: hi + lo = 32.
def rotr(+x: U32, hi: Nat, lo: Nat) -> U32:
  U32.or(U32.shrn(x, hi), U32.shln(x, lo))

def ch(+e: U32, +f: U32, +g: U32) -> U32:
  U32.xor(U32.and(e, f), U32.and(U32.not(e), g))

def maj(+a: U32, +b: U32, +c: U32) -> U32:
  U32.xor(U32.xor(U32.and(a, b), U32.and(a, c)), U32.and(b, c))

def big_s0(+x: U32) -> U32:
  U32.xor(U32.xor(rotr(x, 2n, 30n), rotr(x, 13n, 19n)), rotr(x, 22n, 10n))

def big_s1(+x: U32) -> U32:
  U32.xor(U32.xor(rotr(x, 6n, 26n), rotr(x, 11n, 21n)), rotr(x, 25n, 7n))

def small_s0(+x: U32) -> U32:
  U32.xor(U32.xor(rotr(x, 7n, 25n), rotr(x, 18n, 14n)), U32.shrn(x, 3n))

def small_s1(+x: U32) -> U32:
  U32.xor(U32.xor(rotr(x, 17n, 15n), rotr(x, 19n, 13n)), U32.shrn(x, 10n))

# The 64 round constants of FIPS 180-4 section 4.2.2, as decimal U32.
def k_constants() -> List<&2, U32>:
  [1116352408, 1899447441, 3049323471, 3921009573,
   961987163, 1508970993, 2453635748, 2870763221,
   3624381080, 310598401, 607225278, 1426881987,
   1925078388, 2162078206, 2614888103, 3248222580,
   3835390401, 4022224774, 264347078, 604807628,
   770255983, 1249150122, 1555081692, 1996064986,
   2554220882, 2821834349, 2952996808, 3210313671,
   3336571891, 3584528711, 113926993, 338241895,
   666307205, 773529912, 1294757372, 1396182291,
   1695183700, 1986661051, 2177026350, 2456956037,
   2730485921, 2820302411, 3259730800, 3345764771,
   3516065817, 3600352804, 4094571909, 275423344,
   430227734, 506948616, 659060556, 883997877,
   958139571, 1322822218, 1537002063, 1747873779,
   1955562222, 2024104815, 2227730452, 2361852424,
   2428436474, 2756734187, 3204031479, 3329325298]

def h_initial() -> ShaState:
  ShaState{1779033703, 3144134277, 1013904242, 2773480762,
           1359893119, 2600822924, 528734635, 1541459225}

# Index into a list. The schedule recurrence only reads indices below the
# accumulated length, so the empty case is unreachable; the laws below pin the
# standard vectors end to end.
def nth(+xs: List<&2, U32>, n: Nat) -> U32:
  match xs:
    case Nil{}: 0
    case h <> t:
      match n:
        case 0n: h
        case 1n+p: nth(t, p)

def list_rev_go(xs: List<&2, U32>, acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}: acc
    case h <> t: list_rev_go(t, h <> acc)

def list_rev(xs: List<&2, U32>) -> List<&2, U32>:
  list_rev_go(xs, Nil{})

# Copy a type-kind byte list into a data-kind list so a + binder may use it
# more than once.
def to_data(xs: List<U32>) -> List<&2, U32>:
  match xs:
    case Nil{}: Nil{}
    case h <> t: h <> to_data(t)

# Append two data-kind byte lists.
def cat_bytes(xs: List<&2, U32>, ys: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}: ys
    case h <> t: h <> cat_bytes(t, ys)


# One big-endian word from four bytes.
def word4(+b0: U32, +b1: U32, +b2: U32, +b3: U32) -> U32:
  U32.or(U32.shln(b0, 24n),
    U32.or(U32.shln(b1, 16n),
      U32.or(U32.shln(b2, 8n), b3)))

# The first sixteen schedule words of a 64-byte block, accumulated newest
# first so the schedule recurrence can read recent words by small indices:
# rev[k] is w[i-1-k] when the next word i is computed. The four-byte group
# is one ordered head pattern, matching the run_res_more convention
# (bend2/src/git/text.bend); a short tail drops its partial group, which
# padded input never produces.
def words_go(bs: List<&2, U32>, acc: List<&2, U32>) -> List<&2, U32>:
  match bs:
    case Con{b0, Con{b1, Con{b2, Con{b3, t}}}}:
      words_go(t, word4(b0, b1, b2, b3) <> acc)
    case _: acc

# The next schedule word from the reversed accumulated schedule:
# w[i] = w[i-16] + s0(w[i-15]) + w[i-7] + s1(w[i-2]).
def next_word(+rev: List<&2, U32>) -> U32:
  U32.add(
    U32.add(nth(rev, 15n), small_s0(nth(rev, 14n))),
    U32.add(nth(rev, 6n), small_s1(nth(rev, 1n))))

# Extend the reversed sixteen-word schedule to sixty-four words.
def sched_go(n: Nat, +rev: List<&2, U32>) -> List<&2, U32>:
  match n:
    case 0n: rev
    case 1n+p: sched_go(p, next_word(rev) <> rev)

# The 64-word schedule of one block, in round order.
def sched(block: List<&2, U32>) -> List<&2, U32>:
  list_rev(sched_go(48n, words_go(block, Nil{})))

# One compression round with schedule word w and constant k.
def round(+s: ShaState, +w: U32, +k: U32) -> ShaState:
  match s:
    case ShaState{+a, +b, +c, +d, +e, +f, +g, +h}:
      +t1 = U32.add(U32.add(U32.add(U32.add(h, big_s1(e)), ch(e, f, g)), k), w)
      +t2 = U32.add(big_s0(a), maj(a, b, c))
      ShaState{U32.add(t1, t2), a, b, c, U32.add(d, t1), e, f, g}

# All 64 rounds of one block, with both lists matched at the def head and
# all four emptiness combinations enumerated (the str_eq_go convention).
# ks always has 64 entries when ws does, so the mixed cases are unreachable.
def rounds_go(ws: List<&2, U32>, ks: List<&2, U32>, +st: ShaState) -> ShaState:
  match ws:
    case Nil{}: st
    case w <> wt:
      match ks:
        case Nil{}: st
        case k <> kt: rounds_go(wt, kt, round(st, w, k))

# Fieldwise wrapping addition of two states: the feed-forward step of FIPS
# 180-4 section 6.2.2.
def add_state_x(+x: ShaState, +ya: U32, +yb: U32, +yc: U32, +yd: U32,
    +ye: U32, +yf: U32, +yg: U32, +yh: U32) -> ShaState:
  match x:
    case ShaState{+a, +b, +c, +d, +e, +f, +g, +h}:
      ShaState{U32.add(a, ya), U32.add(b, yb), U32.add(c, yc), U32.add(d, yd),
               U32.add(e, ye), U32.add(f, yf), U32.add(g, yg), U32.add(h, yh)}

def add_state(+x: ShaState, +y: ShaState) -> ShaState:
  match y:
    case ShaState{+a, +b, +c, +d, +e, +f, +g, +h}:
      add_state_x(x, a, b, c, d, e, f, g, h)

def compress(+st: ShaState, +block: List<&2, U32>) -> ShaState:
  add_state(st, rounds_go(sched(block), k_constants(), st))

# Split one 64-byte block off the head of a padded input. Each match has
# one subject, in binder order; a short tail returns the reversed head
# with an empty rest, which padded input never produces.
def split_block(bs: List<&2, U32>, n: Nat, acc: List<&2, U32>)
    -> List<&2, U32> & List<&2, U32>:
  match bs:
    case Nil{}: (list_rev(acc), Nil{})
    case h <> t:
      match n:
        case 0n: (list_rev(acc), h <> t)
        case 1n+p: split_block(t, p, h <> acc)

def len_bytes(bs: List<&2, U32>) -> U32:
  match bs:
    case Nil{}: 0
    case h <> t: U32.add(1, len_bytes(t))

def zeros(n: Nat) -> List<&2, U32>:
  match n:
    case 0n: Nil{}
    case 1n+p: 0 <> zeros(p)

# z zero bytes make (n + 1 + z) congruent to 56 modulo 64.
def zero_count(+n: U32) -> Nat:
  U32.to_nat(U32.mod(U32.sub(120, U32.mod(U32.add(n, 1), 64)), 64))

# A word as four big-endian bytes.
def word_bytes(+x: U32) -> List<&2, U32>:
  [U32.and(U32.shrn(x, 24n), 255), U32.and(U32.shrn(x, 16n), 255),
   U32.and(U32.shrn(x, 8n), 255), U32.and(x, 255)]

# The final state as 32 big-endian bytes.
def state_bytes(+s: ShaState) -> List<&2, U32>:
  match s:
    case ShaState{+a, +b, +c, +d, +e, +f, +g, +h}:
      cat_bytes(word_bytes(a), cat_bytes(word_bytes(b),
        cat_bytes(word_bytes(c), cat_bytes(word_bytes(d),
          cat_bytes(word_bytes(e), cat_bytes(word_bytes(f),
            cat_bytes(word_bytes(g), word_bytes(h))))))))

def hex_go(bs: List<&2, U32>, acc: String) -> String:
  match bs:
    case Nil{}: acc
    case b <> t: hex_go(t, acc ++ J.hex_byte(b))


# The lowercase hex digest of the string's exact UTF-8 bytes.

# ---- incremental layer over the compression core ----
# The frozen successor API: State carries the eight hash words, the
# 64-bit bit counter as a hi/lo U32 pair, and the partial trailing block
# with its byte count.

type State is Data:
  State{h: ShaState, bits_hi: U32, bits_lo: U32, block: List<&2, U32>, used: U32}

def init() -> State:
  State{h_initial(), 0, 0, Nil{}, 0}

def drain(bs: List<&2, U32>, full: Bool, left: U32, acc: List<&2, U32>,
    st: ShaState) -> ShaState & List<&2, U32>:
  match bs full:
    case Nil{} True{}: (compress(st, list_rev(acc)), Nil{})
    case Nil{} False{}: (st, list_rev(acc))
    case Con{+b, +t} True{}:
      drain(t, False{}, 63, Con{b, Nil{}}, compress(st, list_rev(acc)))
    case Con{+b, +t} False{}:
      +l2 = U32.sub(left, 1)
      drain(t, U32.is_eq(l2, 0), l2, Con{b, acc}, st)

# One update: bit counter with the general division-free carry - bits_lo
# takes the U32-wrapped chunk bits and bits_hi rises by m>>29 plus one
# when the lo word wrapped - then the block buffer joins, drains, and
# keeps its remainder.
def update_finish(pair: ShaState & List<&2, U32>, bits_hi: U32, carry: U32,
    bits_lo: U32, used: U32, m: U32) -> State:
  match pair:
    case (st2, rest):
      State{st2, U32.add(bits_hi, carry), bits_lo, rest,
            U32.mod(U32.add(used, m), 64)}

def update_data(st: State, +chunk: List<&2, U32>) -> State:
  match st:
    case State{+h, +bits_hi, +bits_lo, +block, +used}:
      +m = len_bytes(chunk)
      +lo2 = U32.add(bits_lo, U32.shln(m, 3n))
      +carry = U32.add(U32.shrn(m, 29n),
        Bool.pick(U32, U32.is_lt(lo2, bits_lo), 1, 0))
      +joined = cat_bytes(block, chunk)
      update_finish(drain(joined, False{}, 64, Nil{}, h),
        bits_hi, carry, lo2, used, m)

def update(st: State, chunk: List<U32>) -> State:
  update_data(st, to_data(chunk))

def final_finish(pair: ShaState & List<&2, U32>) -> List<&2, U32>:
  match pair:
    case (st2, rest): state_bytes(st2)

# Padding of the partial block with the 64-bit big-endian bit counter.
def final(st: State) -> List<&2, U32>:
  match st:
    case State{+h, +bits_hi, +bits_lo, +block, +used}:
      +tail = cat_bytes(block, cat_bytes([128],
        cat_bytes(zeros(zero_count(used)),
          cat_bytes(word_bytes(bits_hi), word_bytes(bits_lo)))))
      final_finish(drain(tail, False{}, 64, Nil{}, h))

def hex(bytes: List<&2, U32>) -> String:
  hex_go(bytes, SNil{})

def digest_data(bytes: List<&2, U32>) -> String:
  hex(final(update_data(init, bytes)))

def digest_bytes(bytes: List<U32>) -> String:
  digest_data(to_data(bytes))

# The one-shot String digest, kept for the role identity consumers.
def digest(+s: String) -> String:
  digest_bytes(J.utf8(s))

# ---- ground vectors (hashlib oracle, fixed constants) ----

law sha256_bytes_empty:
  {digest_bytes(Nil{}) == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" : String}

def sha256_bytes_empty():
  {==}

law sha256_bytes_abc:
  {digest_bytes(J.utf8("abc")) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" : String}

def sha256_bytes_abc():
  {==}

# 55 bytes: the longest input that needs no second padding block.
law sha256_bytes_55:
  {digest_bytes(J.utf8("abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklm")) == "4243974b4dd5dcbe9952db216e4e399d1d1a21d0bc15d6197aa93a12136cef55" : String}

def sha256_bytes_55():
  {==}

# 56 bytes: exactly the two-block padding boundary.
law sha256_bytes_56:
  {digest_bytes(J.utf8("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")) == "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1" : String}

def sha256_bytes_56():
  {==}

law sha256_bytes_63:
  {digest_bytes(J.utf8("abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmn")) == "6e406c4796591ba9868fe98f1c8201e06c6d8b55d273f17fdd957d1288a31d85" : String}

def sha256_bytes_63():
  {==}

law sha256_bytes_64:
  {digest_bytes(J.utf8("abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmno")) == "2ff100b36c386c65a1afc462ad53e25479bec9498ed00aa5a04de584bc25301b" : String}

def sha256_bytes_64():
  {==}

law sha256_bytes_65:
  {digest_bytes(J.utf8("abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnop")) == "ea860b59bf33885e1695de11dcb17331d24d8be83366e97dbfffd9e4c361f635" : String}

def sha256_bytes_65():
  {==}

# Exact bytes: NUL and invalid UTF-8 sequences pass as plain numbers.
law sha256_bytes_binary:
  {digest_bytes([0, 255, 192, 175, 65, 0, 128]) == "ee4863d37336f7d84618978356a04a7a7679958e8929845e48c045714c3113f2" : String}

def sha256_bytes_binary():
  {==}

# Incremental splitting agrees with the one-shot digest on the same
# bytes, split exactly at a block boundary.
law sha256_incremental_split:
  {hex(final(update(update(init, J.utf8("abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmno")),
     J.utf8("ijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu"))))
    == hex(final(update(init, J.utf8("abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu")))) : String}

def sha256_incremental_split():
  {==}

# The role identity consumer path: the String digest over the exact
# UTF-8 bytes.
law sha256_digest_abc:
  {digest("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" : String}

def sha256_digest_abc():
  {==}

# Incremental splitting at a non-block-aligned boundary: the partial
# block carries used != 0 into the completing update.
law sha256_incremental_nonmultiple:
  {hex(final(update(update(init, J.utf8("abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnop")),
     J.utf8("qrstnopqrstu"))))
    == hex(final(update(init, J.utf8("abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu")))) : String}

def sha256_incremental_nonmultiple():
  {==}
