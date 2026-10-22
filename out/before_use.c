
// Imports
// =======

#pragma clang fp contract(off)

// the device dialect: a second RTC lane adds its macro here
#if defined(__CUDACC_RTC__)
#define BEND_RTC 1
#endif

#ifdef __METAL_VERSION__
#include <metal_stdlib>
using namespace metal;
#elif !defined(BEND_RTC)
#ifdef __APPLE__
#define _DARWIN_UNLIMITED_SELECT
#else
#define _GNU_SOURCE
#endif
#include <stdint.h>
#include <stdbool.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
#include <sched.h>
#include <stdatomic.h>
#include <unistd.h>
#include <signal.h>
#include <sys/mman.h>
#include <time.h>
#include <poll.h>
#include <sys/select.h>
#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif
#ifdef __OBJC__
// #include, not #import: bend -o reads an #import as an effect's framework
#include <Metal/Metal.h>
#include <Foundation/Foundation.h>
#elif BEND_CUDA
#include <cuda.h>
#include <nvrtc.h>
#include <fcntl.h>
#include <sys/stat.h>
#endif
#endif

// Dialect
// =======

#ifdef __METAL_VERSION__
// coherent(device) (MSL 3.2): M1-class parts else lose stores across
// threadgroups within a dispatch
#if __METAL_VERSION__ >= 320
#define DEV     coherent(device) device
#define DEVL    coherent(device) device
#else
#define DEV     device
#define DEVL    device
#endif
#define GA32    threadgroup atomic_uint
#define THR     thread
#define INLINE  inline
#define OUTLINE static
#define CONSTV  constant
#define DEVICE  1
#define CLZ(x)  clz(x)
#define A32(p)  ((DEV atomic_uint*)(p))
#define RLX     memory_order_relaxed
#define FENCE() atomic_thread_fence(mem_flags::mem_device, memory_order_seq_cst)
#define BAR()   threadgroup_barrier(mem_flags::mem_threadgroup)
#define BARD()  threadgroup_barrier(mem_flags::mem_device \
  | mem_flags::mem_threadgroup)

#define g32_ini(p)    atomic_store_explicit(p, 0, RLX)
#define g32_add(p, v) atomic_fetch_add_explicit(p, v, RLX)
#define g32_get(p)    atomic_load_explicit(p, RLX)
#else
#define DEVL
#define THR
#define INLINE  static inline
#define CONSTV  static const

#define g32_ini(p)    a32_store(p, 0)
#define g32_add(p, v) a32_add(p, v)
#define g32_get(p)    a32_load(p)
#ifdef BEND_RTC
// plain data stays L1-cacheable: cross-lane handoffs go through a32 + FENCE
#define DEV
#define GA32    __shared__ u32
#define OUTLINE static __attribute__((noinline))
#define DEVICE  1
#define CLZ(x)  (u32)__clz((int)(x))
#define FENCE() __threadfence()
#define BAR()   __syncthreads()
#define BARD()  \
  { __threadfence(); __syncthreads(); }
#else
#define DEV
// only clang 19+ has both, and only it compiles preserve_most soundly
#if __has_attribute(preserve_none) && __has_attribute(preserve_most)
#define PRESERVE(A) __attribute__((A))
#else
#define PRESERVE(A)
#endif
#define OUTLINE static __attribute__((noinline, cold)) PRESERVE(preserve_most)
#define DEVICE  0
#define CLZ(x)  (u32)__builtin_clz(x)
#endif
#endif
#define FAR static __attribute__((noinline))

// A segment: a case of the device's switch; on the host, a preserve_none
// function (WL_SIG) left by a musttail call, its words fresh at WL_OPEN.
#if DEVICE
#define LOCK(l)
#define UNLOCK(l)
#define WL_CASE(F) case F:
#define WL_OPEN    {
#define WL_JMP(F)  { fid = (F); break; }
#define WL_DYN     WL_JMP
#else
#define LOCK(l)    while (__atomic_exchange_n(&(l), 1, __ATOMIC_ACQUIRE)) {}
#define UNLOCK(l)  __atomic_store_n(&(l), 0, __ATOMIC_RELEASE)
#define WL_FN      static PRESERVE(preserve_none) __attribute__((noinline)) Reply
#define WL_CASE(F) WL_FN WL_##F(WL_SIG)
#define WL_OPEN    { WL_BANK u32 rn;
#define WL_JMP(F)  __attribute__((musttail)) return WL_##F(WL_ALL)
#define WL_DYN(F)  __attribute__((musttail)) return wl_tab[F](WL_ALL)
#endif
#define WL_SPIN     for (;;) { if (err_spun(e.mem, &wpoll)) { return 0; }
#define WL_SPUN     } break;
#define WL_AGAIN(F) continue
#define WL_POP()    { sp -= LANE_STEP; WL_DYN((Fid)STK(0)); }

#define LANE_STEP (DEVICE ? (int64_t)CUBE : 1)
#define STK(I)    sp[(int64_t)(I) * LANE_STEP]

#define WL_RETN(N)  { rn = (N); WL_POP(); }
#define WL_CONT     STK(-3)
#define WL_IDX      STK(-2)
#define WL_POPN(N)  sp -= N * LANE_STEP
#define WL_PUSHN(N) sp += N * LANE_STEP
#define WL_FRAME(T) \
  Loc wtl = task_tail(T); \
  u64 wtw = e.mem[wtl + 1]; \
  STK(0) = e.mem[wtl]; \
  STK(1) = (wtw >> 32) & 0xFFFF; \
  STK(2) = FID_EXIT; \
  sp += 3 * LANE_STEP;
#define WL_ARGS(A, N) \
  for (u32 wi = 0; wi + 1 < N; wi += 1) { \
    STK(wi) = e.mem[A + wi]; \
  } \
  sp += (N - 1) * LANE_STEP;
#define WL_ROOM(N) \
  if (DEVICE && sp + (N) * CUBE >= e.mem + STAT_OFF + CUBE) { \
    err_post(e.mem, ERR_DEEP); \
    return 0; \
  }

// Types
// =====

#ifdef __METAL_VERSION__
typedef ulong u64;
typedef uint  u32;
typedef uchar u8;
typedef float f32;
#elif defined(BEND_RTC)
typedef unsigned long long u64;
typedef long long          int64_t;
typedef unsigned int       u32;
typedef unsigned char      u8;
typedef float              f32;
#else
typedef uint64_t u64;
typedef uint32_t u32;
typedef uint8_t  u8;
typedef float    f32;
#endif

typedef u64 Loc;
#define LOC_MASK ((1ull << 40) - 1)

typedef u32 Cls;
typedef u32 Fid;

typedef u64 Term;
#define TAG_PAK 1ull
#define TAG_CTR 2ull
#define TAG_CLO 3ull
#define TAG_BUF 4ull
#define TAG_TSK 5ull
#define TAG_ARR 6ull

#define TERM_HOLE (~0ull)

#define RFC_BIT  (1ull << 63)
#define RFC_CNT  ((1u << 24) - 1)

typedef Term Reply;

typedef u32 Err;
#define ERR_RING 1
#define ERR_TAGS 2
#define ERR_HEAP 3
#define ERR_FIDS 4
#define ERR_NATS 5
#define ERR_RFCS 6
#define ERR_DEEP 7
#define ERR_ARRS 8

typedef u32 Ring;

typedef DEV u64* Corpus;

typedef struct {
  Corpus   mem;
  DEV u64* alc;
} Env;

typedef struct {
  u64 off;
  u32 rd;
  u32 wr;
  u32 top;
} Bank;

typedef DEVL Term* Stk;

typedef Term Nat;
#define NAT_IMM ((1ull << 48) - 1)

typedef Term U32;

#if DEVICE
typedef u32 u32a;
#else
typedef u32 __attribute__((may_alias)) u32a;
#endif

#ifdef __METAL_VERSION__
typedef threadgroup atomic_uint* Cur;
#else
typedef u32* Cur;
#endif

// Constants
// =========

#define LINE      16
#define PAGE_BITS 7
#define PAGE_LEN  (1ull << PAGE_BITS)
#define CUBE_T    128
#define CUBE      ((u64)CUBE_T * CUBE_T)
#define CUBE_G    (1u << CUBE_LOG)
#define LANES     ((u64)CUBE_T << CUBE_LOG)
#define RING_LOG  (17 - CUBE_LOG)
#define RING_LEN  (1ull << RING_LOG)
#define STAK_LEN  (1ull << 11)
#define NCLS      8
#define NCLS_ALL  32
#define IO_HELP   64

#define ALC_WORDS NCLS_ALL
#define TG_HOLD   2304
#define CHUNK     256
#define CAP_WORDS 32768
#define QUANTUM   (DEVICE ? PAGE_LEN \
  : KEEP_WORDS < 32 * PAGE_LEN ? KEEP_WORDS : 32 * PAGE_LEN)
#if DEVICE
#define KEEP_WORDS CHUNK
#endif
#define RING_WORDS ((1ull << 10) + 2)

#define H_BUMP       0
#define H_CAP        1
#define H_CURSOR     LINE
#define H_ROOT_DONE  (2 * LINE)
#define H_ERROR_CODE (3 * LINE)
#define H_ROOT_WORD  (4 * LINE)
#define H_BANK       (H_ROOT_WORD + WL_RESW)

#define PAGE_UP(n) (((n) + PAGE_LEN - 1) & ~(PAGE_LEN - 1))
#define ALC_OFF  PAGE_UP(H_BANK + 3 * NCLS_ALL)
#define RING_OFF (ALC_OFF + CUBE * 2 * ALC_WORDS)
#define STAK_OFF (RING_OFF + CUBE * RING_WORDS)
#define STAT_OFF (STAK_OFF + CUBE * STAK_LEN)
#define HEAP_OFF (STAT_OFF + PAGE_UP(STAT_LEN))

// Globals
// =======

#if !DEVICE

typedef pthread_mutex_t lock;

static Corpus CORPUS;
static u64    ALC[CUBE_T + 1][3 * ALC_WORDS] __attribute__((aligned(128)));
static u32    KEEP_WORDS;
// the bag: 2^CUBE_LOG groups of CUBE_T lanes (a -D constant on the device)
static u32    CUBE_LOG = 7;
static u32    bank_lock;

static u32            pool_size;
static _Atomic u32    pool_row;
static bool           pool_grow;
static _Atomic u64    pool_tick;
static _Atomic u32    pool_done;
static lock           pool_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t pool_wake = PTHREAD_COND_INITIALIZER;

// The device program compiles from the binary's own text.
#if BEND_METAL || BEND_CUDA
#pragma clang diagnostic ignored "-Wc23-extensions"
static const char BEND_SRC[] = {
#embed __FILE__
, 0 };
#endif

#ifdef __OBJC__
static id<MTLDevice>               gpu_dev;
static id<MTLCommandQueue>         gpu_que;
static id<MTLComputePipelineState> gpu_pso;
static id<MTLBuffer>               gpu_buf;
static id<MTLComputeCommandEncoder> gpu_enc;
#elif BEND_CUDA
static CUdevice   gpu_dev;
static CUmodule   gpu_lib;
static CUfunction gpu_pso;
#endif
static bool io_gpu;
static Stk  io_stk;

static const char* CLI_HELP =
  "usage: %s [options] [arguments]\n"
  "  --threads N       worker threads, 1 to 128 (default: the CPU count)\n"
  "  --gpu on|off|4GB  run ! calls on the GPU, over this much of its memory\n"
  "                    (default: on if present, over 2GB on Metal)\n"
  "  --gpu-build       write the GPU program and exit\n"
  "  --help            show this text\n"
  "  --                the rest are the program's arguments (IO.args)\n";

#endif

// Tables
// ======

#define CID_TUPLE 0
#define CID_SNIL 1
#define CID_SCON 2
#define CID_WCON 3
#define CID_EMIT 4
#define CID_HALT 5
#define CID_FAIL 6
#define CID_DONE 7
#define CID_NONE 8
#define CID_SOME 9
#define CID_FALSE 10
#define CID_TRUE 11
#define CID_UNIT 12
#define CID_CHR 13
#define CID_WNIL 14
#define FID_STRING_LENGTH 0
#define FID_STRING_LENGTH_K1 1
#define FID_G 2
#define FID_G_K3 3
#define FID_MAIN 4
#define FID_IO_EMIT 5
#define FID_CLO_APPLY 6
#define FID_EXIT 7
#define FID_ENTER 8
CONSTV u8 FID_ARITY_T[] = { 1, 1, 1, 1, 0, 1, 2 };
CONSTV u8 FID_FLAG_T[] = { 2, 2, 2, 2, 2, 2, 2 };
CONSTV u8 FID_RESW_T[] = { 0, 1, 0, 1, 0, 0, 0 };
CONSTV u8 CID_ARITY_T[] = { 2, 0, 2, 2, 1, 2, 1, 1, 0, 1, 0, 0, 0, 1, 0 };
CONSTV u8 CID_HOT_T[] = { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };
#define STAT_LEN 4

#define WL_RESW 1
#define BANGS   0

#define WL_BANK Term r0, r1;

#define WL_LOAD(A, N) \
  do { \
    if ((N) <= 0) break; r0 = e.mem[(A) + 0]; \
    if ((N) <= 1) break; r1 = e.mem[(A) + 1]; \
  } while (0);

#define WL_LAST(X) \
  switch (war) { \
    case 0: r0 = (X); \
      break; \
    case 1: r1 = (X); \
      break; \
  }

#define WL_SAVE(V) (V)[0] = r0;

#define WL_TAKE(V) r0 = (V)[0];

#define WL_SIG Env e, Stk sp, u32 seq, u32 rn, Term r0, Term r1

#define WL_ALL e, sp, seq, rn, r0, r1

#define WL_TABLE WL_X(FID_STRING_LENGTH) WL_X(FID_STRING_LENGTH_K1) WL_X(FID_G) WL_X(FID_G_K3) WL_X(FID_MAIN) WL_X(FID_IO_EMIT) WL_X(FID_CLO_APPLY) WL_X(FID_EXIT)
#define MAIN_FID FID_MAIN
#define MAIN_PURE 1
#define BLK_SHR 0

#if !DEVICE

static const u32 SHOW_DESC[] = { 0 };

static const char* SHOW_NAMES[] = {  };

#endif

#define TAB_AT(T, S, I) T[S < I ? S : I]

// Fid
// ===

#define fid_arity(x) ((u32)FID_ARITY_T[x])

#define fid_bangs(x) ((bool)(FID_FLAG_T[x] & 1))

#define fid_nofk(x) ((bool)(FID_FLAG_T[x] & 2))

#define fid_seqk(x) (fid_resw(x) != 0)

#define fid_resw(x) ((u32)FID_RESW_T[x])

// Cid
// ===

#define cid_arity(x) ((u32)CID_ARITY_T[x])
#define cid_hot(x) ((bool)CID_HOT_T[x])

// A32
// ===

#define A32_LOOP(k, x) \
  INLINE u32 a32_##k(DEV u32* p, u32 v) { \
    u32 o = a32_load(p); \
    while (!a32_cas(p, &o, x)) { \
    } \
    return o; \
  }

#ifdef __METAL_VERSION__

// via a volatile local: else the M1 backend folds the zext into the atomic
// load, cannot legalize it, and the pipeline build dies
#define a32_load(p)      \
  ({ volatile thread u32 _a32v = atomic_load_explicit(A32(p), RLX); _a32v; })
#define a32_store(p, v)  atomic_store_explicit(A32(p), v, RLX)
#define a32_add(p, v) atomic_fetch_add_explicit(A32(p), v, RLX)
#define a32_sub(p, v) atomic_fetch_sub_explicit(A32(p), v, RLX)
#define a32_and(p, v) atomic_fetch_and_explicit(A32(p), v, RLX)
#define a32_or(p, v) atomic_fetch_or_explicit(A32(p), v, RLX)
#define a32_xor(p, v) atomic_fetch_xor_explicit(A32(p), v, RLX)
#define a32_min(p, v) atomic_fetch_min_explicit(A32(p), v, RLX)
#define a32_max(p, v) atomic_fetch_max_explicit(A32(p), v, RLX)
#define a32_swp(p, e, v) \
  atomic_compare_exchange_weak_explicit(A32(p), e, v, RLX, RLX)

#elif defined(BEND_RTC)

#define a32_load(p)     (*(volatile u32*)(p))
#define a32_store(p, v) (*(volatile u32*)(p) = (v))
#define a32_add(p, v) atomicAdd((u32*)(p), v)
#define a32_sub(p, v) atomicSub((u32*)(p), v)
#define a32_and(p, v) atomicAnd((u32*)(p), v)
#define a32_or(p, v) atomicOr((u32*)(p), v)
#define a32_xor(p, v) atomicXor((u32*)(p), v)
#define a32_min(p, v) atomicMin((u32*)(p), v)
#define a32_max(p, v) atomicMax((u32*)(p), v)

INLINE bool a32_swp(DEV u32* p, u32* e, u32 v) {
  u32 x = *e;
  *e = atomicCAS((u32*)p, x, v);
  return *e == x;
}

#endif

#if DEVICE

INLINE u32 a32_sub_rel(DEV u32* p, u32 v) {
  FENCE();
  return a32_sub(p, v);
}

INLINE void a32_store_rel(DEV u32* p, u32 v) {
  FENCE();
  a32_store(p, v);
}

INLINE u32 a32_load_acq(DEV u32* p) {
  u32 v = a32_load(p);
  FENCE();
  return v;
}

#define a32_acq(p) FENCE()

INLINE bool a32_cas(DEV u32* p, THR u32* e, u32 v) {
  FENCE();
  bool ok = a32_swp(p, e, v);
  FENCE();
  return ok;
}

#else

#define a32_load(p)         __atomic_load_n(p, __ATOMIC_RELAXED)
#define a32_store(p, v)     __atomic_store_n(p, v, __ATOMIC_RELAXED)
#define a32_add(p, v) __atomic_fetch_add(p, v, __ATOMIC_RELAXED)
#define a32_sub(p, v) __atomic_fetch_sub(p, v, __ATOMIC_RELAXED)
#define a32_and(p, v) __atomic_fetch_and(p, v, __ATOMIC_RELAXED)
#define a32_or(p, v) __atomic_fetch_or(p, v, __ATOMIC_RELAXED)
#define a32_xor(p, v) __atomic_fetch_xor(p, v, __ATOMIC_RELAXED)
#define a32_min(p, v) __atomic_fetch_min(p, v, __ATOMIC_RELAXED)
#define a32_max(p, v) __atomic_fetch_max(p, v, __ATOMIC_RELAXED)
#define a32_sub_rel(p, v)   __atomic_fetch_sub(p, v, __ATOMIC_RELEASE)
#define a32_store_rel(p, v) __atomic_store_n(p, v, __ATOMIC_RELEASE)
#define a32_load_acq(p)     __atomic_load_n(p, __ATOMIC_ACQUIRE)
#define a32_acq(p)          ((void)a32_load_acq(p))

INLINE bool a32_cas(u32* p, u32* e, u32 v) {
  return __atomic_compare_exchange_n(
    p, e, v, 1, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE);
}

#endif

A32_LOOP(exch, v)

// a weak CAS may fail with the cell still x
INLINE u32 a32_cmpx(DEV u32* p, u32 x, u32 v) {
  u32 o = x;
  while (!a32_cas(p, &o, v) && o == x) {
  }
  return o;
}

#define a32_at(H, word) ((DEV u32*)&(H)[word])

// Err
// ===

#if DEVICE

INLINE void err_post(Corpus H, Err code) {
  u32 seen = 0;
  while (seen == 0 && !a32_cas(a32_at(H, H_ERROR_CODE), &seen, code)) {}
}

#else

static const char* ERR_TEXT[] = { "",
  "runtime fail-stop",
  "runtime fail-stop",
  "out of memory: run again with a bigger span, as in --gpu 8GB",
  "a function the device does not hold",
  "a Nat past the largest immediate 2^48-1",
  "runtime fail-stop",
  "memory fault (machine stack overflow?)",
  "an array past the deepest block class 31" };

static void err_fail(const char* msg) {
  fflush(stdout);
  fprintf(stderr, "bend: %s\n", msg);
  _exit(1);
}

static void err_post(Corpus H, Err code) {
  err_fail(ERR_TEXT[code]);
}

static void err_trap(int sig) {
  err_post(NULL, ERR_DEEP);
}

#endif

#define err_seen(H)    (DEVICE && a32_load(a32_at(H, H_ERROR_CODE)) != 0)
#define err_spun(H, n) ((++*(n) & 4095) == 0 && err_seen(H))

#ifdef __METAL_VERSION__
// Metal's atan2 is NaN at the origin; libm answers +-0 or +-pi there
INLINE f32 atan2_c99(f32 y, f32 x) {
  return y == 0.0f && x == x
    ? copysign(signbit(x) ? M_PI_F : 0.0f, y) : atan2(y, x);
}
#define sqrt  precise::sqrt
#define exp   precise::exp
#define log   precise::log
#define log2  precise::log2
#define log10 precise::log10
#define sin   fast::sin
#define cos   fast::cos
#define tan   fast::tan
#define pow   precise::pow
#define fmod  precise::fmod
#define atan2 atan2_c99
#endif

#define U32_BIN(a, o, b) ((u64)((u32)(a) o (u32)(b)))

// Metal folds a constant dividend within 128 of 2^32 through an f32: divide
// its half, then fix the odd bit.
#define U32_QUO(a, b) \
  ((a) / 2 / (b) * 2 + ((a) - (a) / 2 / (b) * 2 * (b) >= (b)))

INLINE f32 f32_unbox(u64 x) {
  union { u32 u; f32 f; } p = { (u32)x };
  return p.f;
}

INLINE u64 f32_rewrap(f32 x) {
  union { f32 f; u32 u; } p = { x };
  return p.u;
}

INLINE U32 f32_to_u32(U32 a) {
  f32 v = f32_unbox(a);
  return v >= 0.0f && v < 4294967296.0f ? (u32)v : 0;
}

INLINE Nat nat_chk(Env e, Nat n) {
  if (n > NAT_IMM) {
    err_post(e.mem, ERR_NATS);
    return NAT_IMM;
  }
  return n;
}

INLINE Nat nat_mul(Env e, Nat a, Nat b) {
  return nat_chk(e, b != 0 && a > NAT_IMM / b ? NAT_IMM + 1 : a * b);
}

#if DEVICE

#define f32_show(e, x) (err_post(e.mem, ERR_FIDS), 0)
#define f32_read(e, s) (err_post(e.mem, ERR_FIDS), 0)

#else

static Term f32_show(Env e, Term x);
static Term f32_read(Env e, Term s);

#endif

A32_LOOP(fadd, f32_rewrap(f32_unbox(o) + f32_unbox(v)))

// Cls
// ===

INLINE Cls cls_fit(u32 words) {
  return words > 1 ? 32 - CLZ(words - 1) : 0;
}

// Bank
// ====

// One stack of exact generations per class; 2 heap_words / max(CHUNK,
// 2^c) entries cover the old ones plus a pass of returns. The host
// pops and pushes at rd under bank_lock; a device pass pops down from
// rd and pushes above top, and the host then compacts [top, wr) onto
// rd, so a pass never sees what it handed.

#define bank_at(H, c) ((DEV Bank*)((H) + H_BANK) + (c))

INLINE Loc bank_pop(Corpus H, Cls c) {
  DEV Bank* b = bank_at(H, c);
  Loc got = 0;
  LOCK(bank_lock);
  u32 t = a32_sub(&b->rd, 1);
  if ((int)t > 0) {
    got = H[b->off + t - 1];
  } else {
    a32_add(&b->rd, 1);
  }
  if (!DEVICE) {
    b->wr = b->top = b->rd;
  }
  UNLOCK(bank_lock);
  return got;
}

INLINE void bank_push(Corpus H, Cls c, Loc head) {
  DEV Bank* b = bank_at(H, c);
  LOCK(bank_lock);
  H[b->off + a32_add(&b->wr, 1)] = head;
  if (!DEVICE) {
    b->rd = b->top = b->wr;
  }
  UNLOCK(bank_lock);
}

// Heap
// ====

// Per lane and class (a tile row on the device): HOT, a LIFO chain of
// free slots (word 0 the head it replaced); LEN, its exact length in
// words, off the chain; on the host COLD, one generation. A free is a
// push and an add. A host free at KEEP_WORDS (a slot for a wide class)
// runs heap_hand: COLD to the bank, HOT parked as COLD, generations
// exact. A miss takes COLD, else a bank entry, else a quantum of at
// most a generation, and sets LEN to what it took: no adoption past a
// generation, no list re-aged. A device lane keeps its frees for the
// pass; at the kernel end dev_cut hands its complete generations,
// walking only those. KEEP_WORDS is CAP_WORDS, or CHUNK with the GPU
// (fixed at boot), so a device lane may adopt every host entry.
// Bounds: a host lane and class under 2 max(KEEP_WORDS, 2^c) words, a
// device one under max(CHUNK, 2^c) after each kernel plus its own
// frees within one, bank entries exact. The bump grows only when this
// lane's HOT and COLD and the class's bank are empty. A zero row is an
// empty lane.

#define ALC_AT(e, i)   (e).alc[(i) * LANE_STEP]
#define ALC_LEN(e, c)  ALC_AT(e, ALC_WORDS + (c))
#define ALC_COLD(e, c) ALC_AT(e, 2 * ALC_WORDS + (c))
#define KEEP(c)        (KEEP_WORDS >> (c) ? KEEP_WORDS >> (c) : 1)

OUTLINE void heap_hand(Env e, Cls cls) {
  Loc cold = ALC_COLD(e, cls);
  if (cold) {
    bank_push(e.mem, cls, cold);
  }
  ALC_COLD(e, cls) = ALC_AT(e, cls);
  ALC_AT(e, cls)   = 0;
  ALC_LEN(e, cls)  = 0;
}

#if DEVICE
#define corpus_grow(H, n) false
#else
static bool corpus_grow(Corpus H, u64 need);
#endif

OUTLINE Loc heap_alloc_miss(Env e, Cls cls) {
  Corpus H = e.mem;
  Loc  got = 0;
  if (!DEVICE) {
    got = ALC_COLD(e, cls);
    ALC_COLD(e, cls) = 0;
  }
  if (!got) {
    got = bank_pop(H, cls);
  }
  u32 n = got ? KEEP(cls) : cls < NCLS ? QUANTUM >> cls : 1;
  if (!got) {
    u32 pages = (n << cls) >> PAGE_BITS;
    u32 p     = a32_add(a32_at(H, H_BUMP), pages);
    if ((u64)p + pages > a32_load_acq(a32_at(H, H_CAP))
      && !corpus_grow(H, (u64)p + pages)) {
      err_post(H, ERR_HEAP);
      return HEAP_OFF;
    }
    got = HEAP_OFF + ((u64)p << PAGE_BITS);
    for (u32 i = 1; i <= n; i += 1) {
      H[got + ((u64)(i - 1) << cls)] = i < n ? got + ((u64)i << cls) : 0;
    }
  }
  ALC_AT(e, cls)  = H[got];
  ALC_LEN(e, cls) = (u64)(n - 1) << cls;
  return got;
}

INLINE Loc heap_alloc(Env e, Cls cls) {
  Loc h = ALC_AT(e, cls);
  if (h) {
    ALC_AT(e, cls)   = e.mem[h];
    ALC_LEN(e, cls) -= 1ull << cls;
    return h;
  }
  return heap_alloc_miss(e, cls);
}

INLINE void heap_free(Env e, Cls cls, Loc loc) {
  if (err_seen(e.mem)) {
    return;
  }
  e.mem[loc]       = ALC_AT(e, cls);
  ALC_AT(e, cls)   = loc;
  ALC_LEN(e, cls) += 1ull << cls;
  if (!DEVICE && ALC_LEN(e, cls) >= KEEP_WORDS) {
    heap_hand(e, cls);
  }
}

// Spare
// =====

INLINE void spare_free(Env e, Cls cls, Loc loc) {
  if (loc >= HEAP_OFF) {
    heap_free(e, cls, loc);
  }
}

// Term
// ====

#define term_make(tag, aux, loc) \
  (((u64)(tag) << 56) | ((u64)(aux) << 40) | (u64)(loc))

#define term_ctr(cid, loc) term_make(TAG_CTR, cid, loc)
#define term_pak(cid, loc) term_make(TAG_PAK, cid, loc)
#define term_clo(fid, loc) term_make(TAG_CLO, fid, loc)
#define term_buf(cls, loc) term_make(TAG_BUF, cls, loc)
#define term_tsk(fid, loc) term_make(TAG_TSK, fid, loc)

INLINE Term term_blk(bool arr, Cls cls, Loc loc) {
  return term_buf(cls, loc) | ((u64)arr << 57);
}

INLINE u64 term_tag(Term t) {
  return (t >> 56) & 0x7f;
}

INLINE bool term_rfc(Term t) {
  return (t & RFC_BIT) != 0;
}

INLINE u64 term_aux(Term t) {
  return (t >> 40) & 0xFFFF;
}

INLINE Loc term_loc(Term t) {
  return t & LOC_MASK;
}

// A static node (below the heap) is trivial, as is a captureless closure.
INLINE bool term_triv(Term t) {
  return term_tag(t) <= TAG_PAK || t == TERM_HOLE || term_loc(t) < HEAP_OFF;
}

OUTLINE Term rfc_wrap(Env e, Term t, u32 cnt) {
  if (term_tag(t) == TAG_CLO || term_tag(t) == TAG_TSK) {
    err_post(e.mem, ERR_RFCS);
    return t;
  }
  Loc r = heap_alloc(e, 0);
  e.mem[r] = ((u64)term_loc(t) << 24) | cnt;
  return (t & ~LOC_MASK) | RFC_BIT | r;
}

INLINE Term rfc_seal(Env e, Term t) {
  if (term_tag(t) != TAG_CTR || term_rfc(t)) {
    return t;
  }
  return rfc_wrap(e, t, 1);
}

INLINE u64 rfc_view(Env e, Loc r) {
  DEV u32* w = a32_at(e.mem, r);
  u64 cell = ((u64)a32_load(w + 1) << 32) | a32_load(w);
  if ((cell & RFC_CNT) == 1) {
    a32_acq(w);
  }
  return cell;
}

INLINE void rfc_bump(Env e, Loc r, u32 k) {
  u32 c = a32_add(a32_at(e.mem, r), k);
  if ((c & RFC_CNT) >= RFC_CNT - k) {
    err_post(e.mem, ERR_RFCS);
  }
}

INLINE Term term_keep(Env e, Term t) {
  if (term_rfc(t)) {
    rfc_bump(e, term_loc(t), 1);
    return t;
  }
  if (term_triv(t)) {
    return t;
  }
  return rfc_wrap(e, t, 2);
}

INLINE Loc term_peek(Env e, Term t) {
  if (term_rfc(t)) {
    return rfc_view(e, term_loc(t)) >> 24;
  }
  return term_loc(t);
}

// A fork's handle (BLK_SHR: an Array binder is hot) is a redirect: a plain
// load, and a match copies it and drops it.
#define blk_shr(t) (BLK_SHR && term_rfc(t))

INLINE Loc blk_loc(Corpus H, Term a) {
  return blk_shr(a) ? H[term_loc(a)] >> 24 : term_loc(a);
}

INLINE Cls blk_cls(Term t) {
  return (u32)term_aux(t) & 31;
}

#define buf_wcls(c) ((c) == 0 ? 0 : (c) - 1)

INLINE Cls blk_span(Term t) {
  Cls c = blk_cls(t);
  return term_tag(t) == TAG_ARR ? c : buf_wcls(c);
}

FAR void term_drop(Env e, Term t) {
  Corpus H = e.mem;
  u64  cur = 0;
  Term c0  = 0;
  u32  step = 0;
  for (;;) {
    if (!term_triv(t) && term_rfc(t)) {
      Loc      r = term_loc(t);
      DEV u32* p = a32_at(H, r);
      if ((a32_sub_rel(p, 1) & RFC_CNT) != 1) {
        t = 0;
      } else {
        a32_acq(p);
        t = (t & ~(RFC_BIT | LOC_MASK)) | (H[r] >> 24);
        heap_free(e, 0, r);
      }
    }
    if (!term_triv(t)) {
      u64 tag = term_tag(t);
      if (tag == TAG_BUF) {
        heap_free(e, blk_span(t), term_loc(t));
      } else {
        u32 aux = (u32)term_aux(t);
        Loc loc = term_loc(t);
        u32 n   = 0;
        Cls cls;
        if (tag == TAG_ARR) {
          cls = 64 | blk_cls(t);
        } else {
          u32 ar;
          if (tag == TAG_CTR) {
            ar = cid_arity(aux);
          } else if (tag == TAG_CLO) {
            ar = fid_arity(aux) - 1;
          } else {
            ar = fid_arity(aux);
          }
          n   = ar;
          cls = cls_fit(tag == TAG_TSK ? ar + 2 : ar);
        }
        c0 = H[loc];
        H[loc] = cur;
        cur = loc | ((u64)n << 48) | ((u64)cls << 56);
      }
    }
    for (;;) {
      if (err_spun(H, &step)) {
        return;
      }
      if (cur == 0) {
        return;
      }
      Loc  loc = cur & LOC_MASK;
      u32  i   = (u8)(cur >> 40);
      u32  n   = (u8)(cur >> 48);
      Cls  cls = (u32)(cur >> 56);
      bool arr = cls > 63;
      u32  j   = i;
      if (arr) {
        cls &= 63;
        n   = 1u << cls;
        if (i == 2) {
          j = (u32)H[loc + 1];
        }
      }
      if (j < n) {
        Term c = j == 0 ? c0 : H[loc + j];
        if (arr && j > 0) {
          H[loc + 1] = j + 1;
        }
        if (!arr || i < 2) {
          cur += 1ull << 40;
        }
        if (!term_triv(c)) {
          t = c;
          break;
        }
      } else {
        u64 up = H[loc];
        heap_free(e, cls, loc);
        cur = up;
      }
    }
  }
}

INLINE void term_sink(Env e, Term t) {
  if (!term_triv(t)) {
    term_drop(e, t);
  }
}

OUTLINE void span_fade(Env e, Term t, Loc src, u32 n) {
  for (u32 j = 0; j < n; j += 1) {
    Term f = e.mem[src + j];
    if (term_rfc(f)) {
      rfc_bump(e, term_loc(f), 1);
    } else if (!term_triv(f)) {
      err_post(e.mem, ERR_RFCS);
    }
  }
  term_drop(e, t);
}

INLINE Loc ctr_take(Env e, Term t, u32 n, THR Term* out) {
  Corpus H = e.mem;
  if (!term_rfc(t)) {
    for (u32 j = 0; j < n; j += 1) {
      out[j] = H[term_loc(t) + j];
    }
    return term_loc(t);
  }
  Loc r    = term_loc(t);
  u64 cell = rfc_view(e, r);
  Loc src  = cell >> 24;
  for (u32 j = 0; j < n; j += 1) {
    out[j] = H[src + j];
  }
  if ((cell & RFC_CNT) == 1) {
    heap_free(e, 0, r);
    return src;
  }
  span_fade(e, t, src, n);
  return 0;
}

INLINE Term term_word(Env e, Term w) {
  u32 x = 0;
  Term t = w;
  for (u32 i = 0; i < 32 && term_aux(t) == CID_WCON; i += 1) {
    Loc l = term_peek(e, t);
    x |= (u32)(e.mem[l] & 1) << i;
    t = e.mem[l + 1];
  }
  term_sink(e, w);
  return x;
}

// Blk
// ===

// A block owns one allocation in its physical class (an ARR of class
// c 2^c Terms in 2^c words, a BUF 2^c u32 in 2^buf_wcls(c) words) and
// blk_free returns it there. A match on ANode is blk_half twice: each
// half allocated in its class and copied, the source freed shallow by
// the high call (its elements moved; the emitter binds the low half
// first). ANode{l, r} is blk_node: the merged class, l and r copied
// and freed shallow. Array.clone is blk_copy: a BUF raw, an ARR's
// elements retained through blk_keep. A match to the leaves copies
// O(n log n) words where a view copied none; get, set, swap, size and
// new open no half.

#define BLK_ALLOC(n, w) \
  Loc n = heap_alloc(e, w); \
  if (err_seen(e.mem)) { \
    return term_buf(0, n); \
  }

INLINE DEV u32a* blk_ptr(Corpus H, Loc loc, u32 i) {
  return (DEV u32a*)(H + loc) + i;
}

INLINE Term blk_read(Corpus H, bool arr, Loc loc, u32 i) {
  if (arr) {
    return H[loc + i];
  }
  return (u64)*blk_ptr(H, loc, i);
}

INLINE void blk_write(Corpus H, bool arr, Loc loc, u32 i, Term v) {
  if (arr) {
    H[loc + i] = v;
  } else {
    *blk_ptr(H, loc, i) = (u32)v;
  }
}

INLINE u32 blk_at(Term a, U32 i, u32 lgs) {
  return ((u32)i & (u32)((1ull << (blk_cls(a) - lgs)) - 1)) << lgs;
}

INLINE Term blk_keep(Env e, Loc at) {
  Term w = e.mem[at];
  Term v = term_keep(e, w);
  if (v != w) {
    e.mem[at] = v;
  }
  return v;
}

INLINE void blk_fill(Env e, Loc dst, Loc src, u64 n, bool keep) {
  for (u64 j = 0; j < n; j += 1) {
    e.mem[dst + j] = keep ? blk_keep(e, src + j) : e.mem[src + j];
  }
}

INLINE void blk_free(Env e, Term t) {
  blk_shr(t) ? term_drop(e, t) : heap_free(e, blk_span(t), term_loc(t));
}

OUTLINE Term blk_copy(Env e, Term a) {
  bool arr = term_tag(a) == TAG_ARR;
  Cls cls = blk_span(a);
  BLK_ALLOC(dst, cls)
  blk_fill(e, dst, blk_loc(e.mem, a), 1ull << cls, arr);
  return term_blk(arr, blk_cls(a), dst);
}

INLINE Term blk_node(Env e, Term l, Term r) {
  Corpus H = e.mem;
  bool arr = term_tag(l) == TAG_ARR;
  Cls c = blk_cls(l);
  if (c != blk_cls(r) || c + 1 >= NCLS_ALL) {
    err_post(H, ERR_TAGS);
    return l;
  }
  Loc pl = blk_loc(H, l);
  Loc pr = blk_loc(H, r);
  BLK_ALLOC(n, arr ? c + 1 : c)
  if (!arr && c == 0) {
    H[n] = (u64)*blk_ptr(H, pl, 0) | ((u64)*blk_ptr(H, pr, 0) << 32);
  } else {
    u64 cw = 1ull << blk_span(l);
    blk_fill(e, n, pl, cw, arr && blk_shr(l));
    blk_fill(e, n + cw, pr, cw, arr && blk_shr(r));
  }
  blk_free(e, l);
  blk_free(e, r);
  return term_blk(arr, c + 1, n);
}

INLINE Term blk_half(Env e, Term a, u32 hi) {
  Corpus H = e.mem;
  bool arr = term_tag(a) == TAG_ARR;
  Cls c = blk_cls(a);
  if (c == 0) {
    err_post(H, ERR_TAGS);
    return a;
  }
  c -= 1;
  Cls cw = arr ? c : buf_wcls(c);
  Loc src = blk_loc(H, a);
  BLK_ALLOC(n, cw)
  if (!arr && c == 0) {
    H[n] = (u64)*blk_ptr(H, src, hi);
  } else {
    blk_fill(e, n, src + ((u64)hi << cw), 1ull << cw, arr && blk_shr(a));
  }
  if (hi) {
    blk_free(e, a);
  }
  return term_blk(arr, c, n);
}

INLINE Term blk_new(Env e, bool arr, Nat d, u32 lgs, u32 n, THR Term* v) {
  Corpus H = e.mem;
  if (d + lgs > 31) {
    err_post(H, ERR_ARRS);
    d = 0;
  }
  Cls c = (u32)d + lgs;
  BLK_ALLOC(l, arr ? c : buf_wcls(c))
  for (u32 j = 0; j < n; j += 1) {
    Term w = v[j];
    if (arr && d > 0 && !term_triv(w)) {
      if (d >= 24) {
        err_post(H, ERR_RFCS);
      } else if (term_rfc(w)) {
        rfc_bump(e, term_loc(w), (1u << d) - 1);
      } else {
        w = rfc_wrap(e, w, 1u << d);
      }
    }
    v[j] = w;
  }
  for (u64 i = 0; i < (1ull << c); i += 1) {
    blk_write(H, arr, l, (u32)i, i % (1u << lgs) < n ? v[i % (1u << lgs)] : 0);
  }
  return term_blk(arr, c, l);
}

// Ring
// ====

// planes LANES wide: a smaller bag has deeper rings in the same region
#define ring_word(H, r, w) ((H) + RING_OFF + (w) * LANES + (r))
#define ring_slot(H, r, p) ring_word(H, r, (p) & (RING_LEN - 1))
#define ring_get(H, r)     ((DEV u32*)ring_word(H, r, RING_LEN))
#define ring_put(H, r)     ((DEV u32*)ring_word(H, r, RING_LEN + 1))

INLINE u32 ring_lap(u32 pos) {
  return ~(u32)(pos / RING_LEN) & 1;
}

INLINE void ring_push(Corpus H, Ring r, Term tsk) {
  u32 pos = a32_add(ring_put(H, r), 1);
  if (pos - a32_load(ring_get(H, r)) >= RING_LEN) {
    err_post(H, ERR_RING);
    return;
  }
  DEV u32* lo = (DEV u32*)ring_slot(H, r, pos);
  a32_store(lo, (u32)tsk);
  a32_store_rel(lo + 1, (u32)(tsk >> 32) | (ring_lap(pos) << 31));
}

INLINE Ring ring_flip(u32 i) {
  return (i % CUBE_T << CUBE_LOG) + i / CUBE_T;
}

#define ring_pick(b, s, c) ((b) + (s) * (g32_add(c, 1) & (CUBE_T - 1)))

// Task
// ====

INLINE Loc task_node(Env e, Fid fid, Term cont, u32 idx, u32 rem) {
  u32 ar  = fid_arity(fid);
  Loc loc = heap_alloc(e, cls_fit(ar + 2));
  for (u32 i = 0; rem && i < ar; i += 1) {
    e.mem[loc + i] = TERM_HOLE;
  }
  e.mem[loc + ar]     = cont;
  e.mem[loc + ar + 1] = ((u64)idx << 32) | rem;
  return loc;
}

INLINE Loc task_tail(Term t) {
  return term_loc(t) + fid_arity((u32)term_aux(t));
}

INLINE Term task_deliver(Corpus H, Term cont, u32 idx, THR Term* v, u32 n) {
  Loc at = cont == TERM_HOLE ? H_ROOT_WORD : term_loc(cont) + idx;
  for (u32 j = 0; j < WL_RESW; j += 1) {
    if (j < n) {
      H[at + j] = v[j];
    }
  }
  if (cont == TERM_HOLE) {
    a32_store_rel(a32_at(H, H_ROOT_DONE), n + 1);
    return 0;
  }
  Loc tl = task_tail(cont);
  if (a32_sub_rel(a32_at(H, tl + 1), 1) == 1) {
    a32_acq(a32_at(H, tl + 1));
    return cont;
  }
  return 0;
}

INLINE void task_deal(Corpus H, Term join, u32 base, u32 stride, Cur cur) {
  Loc loc = term_loc(join);
  u32 ar  = fid_arity((u32)term_aux(join));
  u32 g   = 0;
  if (stride == 0) {
    u32 rem = (u32)H[loc + ar + 1];
    g = a32_add(a32_at(H, H_CURSOR), rem);
  }
  for (u32 i = 0; i < ar; i += 1) {
    Term k = H[loc + i];
    if (term_tag(k) == TAG_TSK) {
      H[loc + i] = TERM_HOLE;
      Ring to;
      if (stride != 0) {
        to = ring_pick(base, stride, cur);
      } else {
        to = ring_flip(g & (u32)(LANES - 1));
        g += 1;
      }
      ring_push(H, to, k);
    }
  }
}

// Root
// ====

INLINE bool root_done(Corpus H) {
  return a32_load_acq(a32_at(H, H_ROOT_DONE)) != 0;
}

static u32 root_take(Corpus H, THR Term* v) {
  u32 n = a32_load_acq(a32_at(H, H_ROOT_DONE)) - 1;
  for (u32 j = 0; j < n; j += 1) {
    v[j] = H[H_ROOT_WORD + j];
  }
  a32_store(a32_at(H, H_ROOT_DONE), 0);
  return n;
}

// Spins
// =====

CONSTV u64 STAT_IMG[] = { 122ull, term_pak(CID_SNIL, 0), 122ull, term_ctr(CID_SCON, STAT_OFF + 0) };

// Work
// ====

// A host self-jump is a tail call: as a loop, MachineLICM hoisted eleven
// constants into symreg's entry (3.05 s against 2.51 s).
#if !DEVICE
#undef  WL_SPIN
#undef  WL_SPUN
#undef  WL_AGAIN
#define WL_SPIN
#define WL_SPUN
#define WL_AGAIN(F) __attribute__((musttail)) return WL_##F(WL_ALL)

typedef Reply (PRESERVE(preserve_none) *WlFn)(WL_SIG);
#define WL_X(F) WL_FN WL_##F(WL_SIG);
WL_TABLE WL_X(FID_ENTER)
#undef WL_X
#define WL_X(F) WL_##F,
static const WlFn wl_tab[] = { WL_TABLE };
#undef WL_X
#endif

static Reply work_loop(Env e, Stk sp, Term t, u32 seq) {
  WL_BANK
  u32 rn = 0;
  r0 = t;
#if DEVICE
  Fid fid   = FID_ENTER;
  u32 wpoll = 0;
  for (;;) {
  if (err_spun(e.mem, &wpoll)) {
    return 0;
  }
  switch (fid) {
#else
  return WL_FID_ENTER(WL_ALL);
}
#endif

// Segments
// ========

#if !DEVICE
  WL_CASE(FID_STRING_LENGTH)
  {
    Term _s_0 = r0;
    WL_OPEN
    WL_SPIN
    if (term_aux(_s_0) == CID_SNIL) {
      r0 = 0;
      WL_RETN(1);
    } else {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _s_0, 2, _fb_0);
      u32 _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      spare_free(e, cls_fit(2), _sp_0);
      if (seq) {
        WL_ROOM(1);
        STK(0) = FID_STRING_LENGTH_K1;
        WL_PUSHN(1);
      } else {
        u64 _t_0 = task_node(e, FID_STRING_LENGTH_K1, WL_CONT, WL_IDX, 1);
        WL_CONT = term_tsk(FID_STRING_LENGTH_K1, _t_0);
        WL_IDX = 0;
      }
      r0 = _f_1;
      _s_0 = r0;
      WL_AGAIN(FID_STRING_LENGTH);
    }
    WL_SPUN
  }}
#endif

#if !DEVICE
  WL_CASE(FID_STRING_LENGTH_K1)
  {
    Term _h_0 = r0;
    WL_OPEN
    r0 = nat_chk(e, _h_0 + 1);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_G)
  {
    Term _s_0 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_G_K3;
      WL_PUSHN(1);
    } else {
      u64 _t_0 = task_node(e, FID_G_K3, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_G_K3, _t_0);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID_STRING_LENGTH)) {
      u64 _t_1 = task_node(e, FID_STRING_LENGTH, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _s_0;
      return term_tsk(FID_STRING_LENGTH, _t_1);
    }
    r0 = _s_0;
    WL_JMP(FID_STRING_LENGTH);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_G_K3)
  {
    Term _h_0 = r0;
    WL_OPEN
    r0 = ((u64)(u32)(_h_0));
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN)
  {
    WL_OPEN
    Term _s_0 = term_ctr(CID_SCON, STAT_OFF + 2);
    if (term_aux(_s_0) == CID_SCON) {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _s_0, 2, _fb_0);
      u32 _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      if (_f_0 == 97) {
        if (term_aux(_f_1) == CID_SCON) {
          Term _fb_1[2];
          u64 _sp_1 = ctr_take(e, _f_1, 2, _fb_1);
          u32 _f_2 = _fb_1[0];
          Term _f_3 = _fb_1[1];
          if (_f_2 == 98) {
            if (term_aux(_f_3) == CID_SCON) {
              Term _fb_2[2];
              u64 _sp_2 = ctr_take(e, _f_3, 2, _fb_2);
              u32 _f_4 = _fb_2[0];
              Term _f_5 = _fb_2[1];
              if (_f_4 == 99) {
                if (term_aux(_f_5) == CID_SCON) {
                  Term _fb_3[2];
                  u64 _sp_3 = ctr_take(e, _f_5, 2, _fb_3);
                  u32 _f_6 = _fb_3[0];
                  Term _f_7 = _fb_3[1];
                  if (_f_6 == 100) {
                    if (term_aux(_f_7) == CID_SCON) {
                      Term _fb_4[2];
                      u64 _sp_4 = ctr_take(e, _f_7, 2, _fb_4);
                      u32 _f_8 = _fb_4[0];
                      Term _f_9 = _fb_4[1];
                      if (_f_8 == 101) {
                        if (term_aux(_f_9) == CID_SCON) {
                          Term _fb_5[2];
                          u64 _sp_5 = ctr_take(e, _f_9, 2, _fb_5);
                          u32 _f_10 = _fb_5[0];
                          Term _f_11 = _fb_5[1];
                          if (_f_10 == 102) {
                            if (term_aux(_f_11) == CID_SCON) {
                              Term _fb_6[2];
                              u64 _sp_6 = ctr_take(e, _f_11, 2, _fb_6);
                              u32 _f_12 = _fb_6[0];
                              Term _f_13 = _fb_6[1];
                              if (_f_12 == 103) {
                                if (term_aux(_f_13) == CID_SCON) {
                                  Term _fb_7[2];
                                  u64 _sp_7 = ctr_take(e, _f_13, 2, _fb_7);
                                  u32 _f_14 = _fb_7[0];
                                  Term _f_15 = _fb_7[1];
                                  if (_f_14 == 104) {
                                    if (term_aux(_f_15) == CID_SCON) {
                                      Term _fb_8[2];
                                      u64 _sp_8 = ctr_take(e, _f_15, 2, _fb_8);
                                      u32 _f_16 = _fb_8[0];
                                      Term _f_17 = _fb_8[1];
                                      if (_f_16 == 105) {
                                        if (term_aux(_f_17) == CID_SCON) {
                                          Term _fb_9[2];
                                          u64 _sp_9 = ctr_take(e, _f_17, 2, _fb_9);
                                          u32 _f_18 = _fb_9[0];
                                          Term _f_19 = _fb_9[1];
                                          if (_f_18 == 106) {
                                            if (term_aux(_f_19) == CID_SCON) {
                                              Term _fb_10[2];
                                              u64 _sp_10 = ctr_take(e, _f_19, 2, _fb_10);
                                              u32 _f_20 = _fb_10[0];
                                              Term _f_21 = _fb_10[1];
                                              if (_f_20 == 107) {
                                                if (term_aux(_f_21) == CID_SCON) {
                                                  Term _fb_11[2];
                                                  u64 _sp_11 = ctr_take(e, _f_21, 2, _fb_11);
                                                  u32 _f_22 = _fb_11[0];
                                                  Term _f_23 = _fb_11[1];
                                                  if (_f_22 == 108) {
                                                    if (term_aux(_f_23) == CID_SCON) {
                                                      Term _fb_12[2];
                                                      u64 _sp_12 = ctr_take(e, _f_23, 2, _fb_12);
                                                      u32 _f_24 = _fb_12[0];
                                                      Term _f_25 = _fb_12[1];
                                                      if (_f_24 == 109) {
                                                        if (term_aux(_f_25) == CID_SCON) {
                                                          Term _fb_13[2];
                                                          u64 _sp_13 = ctr_take(e, _f_25, 2, _fb_13);
                                                          u32 _f_26 = _fb_13[0];
                                                          Term _f_27 = _fb_13[1];
                                                          if (_f_26 == 110) {
                                                            if (term_aux(_f_27) == CID_SCON) {
                                                              Term _fb_14[2];
                                                              u64 _sp_14 = ctr_take(e, _f_27, 2, _fb_14);
                                                              u32 _f_28 = _fb_14[0];
                                                              Term _f_29 = _fb_14[1];
                                                              if (_f_28 == 111) {
                                                                if (term_aux(_f_29) == CID_SCON) {
                                                                  Term _fb_15[2];
                                                                  u64 _sp_15 = ctr_take(e, _f_29, 2, _fb_15);
                                                                  u32 _f_30 = _fb_15[0];
                                                                  Term _f_31 = _fb_15[1];
                                                                  if (_f_30 == 112) {
                                                                    if (term_aux(_f_31) == CID_SCON) {
                                                                      Term _fb_16[2];
                                                                      u64 _sp_16 = ctr_take(e, _f_31, 2, _fb_16);
                                                                      u32 _f_32 = _fb_16[0];
                                                                      Term _f_33 = _fb_16[1];
                                                                      if (_f_32 == 113) {
                                                                        if (term_aux(_f_33) == CID_SCON) {
                                                                          Term _fb_17[2];
                                                                          u64 _sp_17 = ctr_take(e, _f_33, 2, _fb_17);
                                                                          u32 _f_34 = _fb_17[0];
                                                                          Term _f_35 = _fb_17[1];
                                                                          if (_f_34 == 114) {
                                                                            if (term_aux(_f_35) == CID_SCON) {
                                                                              Term _fb_18[2];
                                                                              u64 _sp_18 = ctr_take(e, _f_35, 2, _fb_18);
                                                                              u32 _f_36 = _fb_18[0];
                                                                              Term _f_37 = _fb_18[1];
                                                                              if (_f_36 == 115) {
                                                                                if (term_aux(_f_37) == CID_SCON) {
                                                                                  Term _fb_19[2];
                                                                                  u64 _sp_19 = ctr_take(e, _f_37, 2, _fb_19);
                                                                                  u32 _f_38 = _fb_19[0];
                                                                                  Term _f_39 = _fb_19[1];
                                                                                  if (_f_38 == 116) {
                                                                                    if (term_aux(_f_39) == CID_SCON) {
                                                                                      Term _fb_20[2];
                                                                                      u64 _sp_20 = ctr_take(e, _f_39, 2, _fb_20);
                                                                                      u32 _f_40 = _fb_20[0];
                                                                                      Term _f_41 = _fb_20[1];
                                                                                      if (_f_40 == 117) {
                                                                                        if (term_aux(_f_41) == CID_SNIL) {
                                                                                          spare_free(e, cls_fit(2), _sp_20);
                                                                                          spare_free(e, cls_fit(2), _sp_19);
                                                                                          spare_free(e, cls_fit(2), _sp_18);
                                                                                          spare_free(e, cls_fit(2), _sp_17);
                                                                                          spare_free(e, cls_fit(2), _sp_16);
                                                                                          spare_free(e, cls_fit(2), _sp_15);
                                                                                          spare_free(e, cls_fit(2), _sp_14);
                                                                                          spare_free(e, cls_fit(2), _sp_13);
                                                                                          spare_free(e, cls_fit(2), _sp_12);
                                                                                          spare_free(e, cls_fit(2), _sp_11);
                                                                                          spare_free(e, cls_fit(2), _sp_10);
                                                                                          spare_free(e, cls_fit(2), _sp_9);
                                                                                          spare_free(e, cls_fit(2), _sp_8);
                                                                                          spare_free(e, cls_fit(2), _sp_7);
                                                                                          spare_free(e, cls_fit(2), _sp_6);
                                                                                          spare_free(e, cls_fit(2), _sp_5);
                                                                                          spare_free(e, cls_fit(2), _sp_4);
                                                                                          spare_free(e, cls_fit(2), _sp_3);
                                                                                          spare_free(e, cls_fit(2), _sp_2);
                                                                                          spare_free(e, cls_fit(2), _sp_1);
                                                                                          spare_free(e, cls_fit(2), _sp_0);
                                                                                          r0 = 21ull;
                                                                                          WL_RETN(1);
                                                                                        } else {
                                                                                          u64 _nd_0 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                                                                          e.mem[_nd_0 + 0] = 117ull;
                                                                                          e.mem[_nd_0 + 1] = _f_41;
                                                                                          u64 _nd_1 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                                                                          e.mem[_nd_1 + 0] = 116ull;
                                                                                          e.mem[_nd_1 + 1] = term_ctr(CID_SCON, _nd_0);
                                                                                          u64 _nd_2 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                                                                          e.mem[_nd_2 + 0] = 115ull;
                                                                                          e.mem[_nd_2 + 1] = term_ctr(CID_SCON, _nd_1);
                                                                                          u64 _nd_3 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                                                                          e.mem[_nd_3 + 0] = 114ull;
                                                                                          e.mem[_nd_3 + 1] = term_ctr(CID_SCON, _nd_2);
                                                                                          u64 _nd_4 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                                                                          e.mem[_nd_4 + 0] = 113ull;
                                                                                          e.mem[_nd_4 + 1] = term_ctr(CID_SCON, _nd_3);
                                                                                          u64 _nd_5 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                                                                          e.mem[_nd_5 + 0] = 112ull;
                                                                                          e.mem[_nd_5 + 1] = term_ctr(CID_SCON, _nd_4);
                                                                                          u64 _nd_6 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                                                                          e.mem[_nd_6 + 0] = 111ull;
                                                                                          e.mem[_nd_6 + 1] = term_ctr(CID_SCON, _nd_5);
                                                                                          u64 _nd_7 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                                                                          e.mem[_nd_7 + 0] = 110ull;
                                                                                          e.mem[_nd_7 + 1] = term_ctr(CID_SCON, _nd_6);
                                                                                          u64 _nd_8 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                                                                          e.mem[_nd_8 + 0] = 109ull;
                                                                                          e.mem[_nd_8 + 1] = term_ctr(CID_SCON, _nd_7);
                                                                                          u64 _nd_9 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                                                                          e.mem[_nd_9 + 0] = 108ull;
                                                                                          e.mem[_nd_9 + 1] = term_ctr(CID_SCON, _nd_8);
                                                                                          u64 _nd_10 = _sp_10 >= HEAP_OFF ? _sp_10 : heap_alloc(e, cls_fit(2));
                                                                                          e.mem[_nd_10 + 0] = 107ull;
                                                                                          e.mem[_nd_10 + 1] = term_ctr(CID_SCON, _nd_9);
                                                                                          u64 _nd_11 = _sp_11 >= HEAP_OFF ? _sp_11 : heap_alloc(e, cls_fit(2));
                                                                                          e.mem[_nd_11 + 0] = 106ull;
                                                                                          e.mem[_nd_11 + 1] = term_ctr(CID_SCON, _nd_10);
                                                                                          u64 _nd_12 = _sp_12 >= HEAP_OFF ? _sp_12 : heap_alloc(e, cls_fit(2));
                                                                                          e.mem[_nd_12 + 0] = 105ull;
                                                                                          e.mem[_nd_12 + 1] = term_ctr(CID_SCON, _nd_11);
                                                                                          u64 _nd_13 = _sp_13 >= HEAP_OFF ? _sp_13 : heap_alloc(e, cls_fit(2));
                                                                                          e.mem[_nd_13 + 0] = 104ull;
                                                                                          e.mem[_nd_13 + 1] = term_ctr(CID_SCON, _nd_12);
                                                                                          u64 _nd_14 = _sp_14 >= HEAP_OFF ? _sp_14 : heap_alloc(e, cls_fit(2));
                                                                                          e.mem[_nd_14 + 0] = 103ull;
                                                                                          e.mem[_nd_14 + 1] = term_ctr(CID_SCON, _nd_13);
                                                                                          u64 _nd_15 = _sp_15 >= HEAP_OFF ? _sp_15 : heap_alloc(e, cls_fit(2));
                                                                                          e.mem[_nd_15 + 0] = 102ull;
                                                                                          e.mem[_nd_15 + 1] = term_ctr(CID_SCON, _nd_14);
                                                                                          u64 _nd_16 = _sp_16 >= HEAP_OFF ? _sp_16 : heap_alloc(e, cls_fit(2));
                                                                                          e.mem[_nd_16 + 0] = 101ull;
                                                                                          e.mem[_nd_16 + 1] = term_ctr(CID_SCON, _nd_15);
                                                                                          u64 _nd_17 = _sp_17 >= HEAP_OFF ? _sp_17 : heap_alloc(e, cls_fit(2));
                                                                                          e.mem[_nd_17 + 0] = 100ull;
                                                                                          e.mem[_nd_17 + 1] = term_ctr(CID_SCON, _nd_16);
                                                                                          u64 _nd_18 = _sp_18 >= HEAP_OFF ? _sp_18 : heap_alloc(e, cls_fit(2));
                                                                                          e.mem[_nd_18 + 0] = 99ull;
                                                                                          e.mem[_nd_18 + 1] = term_ctr(CID_SCON, _nd_17);
                                                                                          u64 _nd_19 = _sp_19 >= HEAP_OFF ? _sp_19 : heap_alloc(e, cls_fit(2));
                                                                                          e.mem[_nd_19 + 0] = 98ull;
                                                                                          e.mem[_nd_19 + 1] = term_ctr(CID_SCON, _nd_18);
                                                                                          u64 _nd_20 = _sp_20 >= HEAP_OFF ? _sp_20 : heap_alloc(e, cls_fit(2));
                                                                                          e.mem[_nd_20 + 0] = 97ull;
                                                                                          e.mem[_nd_20 + 1] = term_ctr(CID_SCON, _nd_19);
                                                                                          if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                                                                            u64 _t_0 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                                                                            e.mem[_t_0 + 0] = term_ctr(CID_SCON, _nd_20);
                                                                                            return term_tsk(FID_G, _t_0);
                                                                                          }
                                                                                          r0 = term_ctr(CID_SCON, _nd_20);
                                                                                          WL_JMP(FID_G);
                                                                                        }
                                                                                      } else {
                                                                                        u32 _1368_0 = ((_f_40 >> 0) & 1);
                                                                                        u32 _1369_0 = ((_f_40 >> 1) & 1);
                                                                                        u32 _1369_1 = ((_f_40 >> 2) & 1);
                                                                                        u32 _1369_2 = ((_f_40 >> 3) & 1);
                                                                                        u32 _1369_3 = ((_f_40 >> 4) & 1);
                                                                                        u32 _1369_4 = ((_f_40 >> 5) & 1);
                                                                                        u32 _1369_5 = ((_f_40 >> 6) & 1);
                                                                                        u32 _1369_6 = ((_f_40 >> 7) & 1);
                                                                                        u32 _1369_7 = ((_f_40 >> 8) & 1);
                                                                                        u32 _1369_8 = ((_f_40 >> 9) & 1);
                                                                                        u32 _1369_9 = ((_f_40 >> 10) & 1);
                                                                                        u32 _1369_10 = ((_f_40 >> 11) & 1);
                                                                                        u32 _1369_11 = ((_f_40 >> 12) & 1);
                                                                                        u32 _1369_12 = ((_f_40 >> 13) & 1);
                                                                                        u32 _1369_13 = ((_f_40 >> 14) & 1);
                                                                                        u32 _1369_14 = ((_f_40 >> 15) & 1);
                                                                                        u32 _1369_15 = ((_f_40 >> 16) & 1);
                                                                                        u32 _1369_16 = ((_f_40 >> 17) & 1);
                                                                                        u32 _1369_17 = ((_f_40 >> 18) & 1);
                                                                                        u32 _1369_18 = ((_f_40 >> 19) & 1);
                                                                                        u32 _1369_19 = ((_f_40 >> 20) & 1);
                                                                                        u32 _1369_20 = ((_f_40 >> 21) & 1);
                                                                                        u32 _1369_21 = ((_f_40 >> 22) & 1);
                                                                                        u32 _1369_22 = ((_f_40 >> 23) & 1);
                                                                                        u32 _1369_23 = ((_f_40 >> 24) & 1);
                                                                                        u32 _1369_24 = ((_f_40 >> 25) & 1);
                                                                                        u32 _1369_25 = ((_f_40 >> 26) & 1);
                                                                                        u32 _1369_26 = ((_f_40 >> 27) & 1);
                                                                                        u32 _1369_27 = ((_f_40 >> 28) & 1);
                                                                                        u32 _1369_28 = ((_f_40 >> 29) & 1);
                                                                                        u32 _1369_29 = ((_f_40 >> 30) & 1);
                                                                                        u32 _1369_30 = ((_f_40 >> 31) & 1);
                                                                                        u64 _nd_21 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                                                                        e.mem[_nd_21 + 0] = (((u64)_1368_0 << 0) | ((u64)_1369_0 << 1) | ((u64)_1369_1 << 2) | ((u64)_1369_2 << 3) | ((u64)_1369_3 << 4) | ((u64)_1369_4 << 5) | ((u64)_1369_5 << 6) | ((u64)_1369_6 << 7) | ((u64)_1369_7 << 8) | ((u64)_1369_8 << 9) | ((u64)_1369_9 << 10) | ((u64)_1369_10 << 11) | ((u64)_1369_11 << 12) | ((u64)_1369_12 << 13) | ((u64)_1369_13 << 14) | ((u64)_1369_14 << 15) | ((u64)_1369_15 << 16) | ((u64)_1369_16 << 17) | ((u64)_1369_17 << 18) | ((u64)_1369_18 << 19) | ((u64)_1369_19 << 20) | ((u64)_1369_20 << 21) | ((u64)_1369_21 << 22) | ((u64)_1369_22 << 23) | ((u64)_1369_23 << 24) | ((u64)_1369_24 << 25) | ((u64)_1369_25 << 26) | ((u64)_1369_26 << 27) | ((u64)_1369_27 << 28) | ((u64)_1369_28 << 29) | ((u64)_1369_29 << 30) | ((u64)_1369_30 << 31));
                                                                                        e.mem[_nd_21 + 1] = _f_41;
                                                                                        u64 _nd_22 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                                                                        e.mem[_nd_22 + 0] = 116ull;
                                                                                        e.mem[_nd_22 + 1] = term_ctr(CID_SCON, _nd_21);
                                                                                        u64 _nd_23 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                                                                        e.mem[_nd_23 + 0] = 115ull;
                                                                                        e.mem[_nd_23 + 1] = term_ctr(CID_SCON, _nd_22);
                                                                                        u64 _nd_24 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                                                                        e.mem[_nd_24 + 0] = 114ull;
                                                                                        e.mem[_nd_24 + 1] = term_ctr(CID_SCON, _nd_23);
                                                                                        u64 _nd_25 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                                                                        e.mem[_nd_25 + 0] = 113ull;
                                                                                        e.mem[_nd_25 + 1] = term_ctr(CID_SCON, _nd_24);
                                                                                        u64 _nd_26 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                                                                        e.mem[_nd_26 + 0] = 112ull;
                                                                                        e.mem[_nd_26 + 1] = term_ctr(CID_SCON, _nd_25);
                                                                                        u64 _nd_27 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                                                                        e.mem[_nd_27 + 0] = 111ull;
                                                                                        e.mem[_nd_27 + 1] = term_ctr(CID_SCON, _nd_26);
                                                                                        u64 _nd_28 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                                                                        e.mem[_nd_28 + 0] = 110ull;
                                                                                        e.mem[_nd_28 + 1] = term_ctr(CID_SCON, _nd_27);
                                                                                        u64 _nd_29 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                                                                        e.mem[_nd_29 + 0] = 109ull;
                                                                                        e.mem[_nd_29 + 1] = term_ctr(CID_SCON, _nd_28);
                                                                                        u64 _nd_30 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                                                                        e.mem[_nd_30 + 0] = 108ull;
                                                                                        e.mem[_nd_30 + 1] = term_ctr(CID_SCON, _nd_29);
                                                                                        u64 _nd_31 = _sp_10 >= HEAP_OFF ? _sp_10 : heap_alloc(e, cls_fit(2));
                                                                                        e.mem[_nd_31 + 0] = 107ull;
                                                                                        e.mem[_nd_31 + 1] = term_ctr(CID_SCON, _nd_30);
                                                                                        u64 _nd_32 = _sp_11 >= HEAP_OFF ? _sp_11 : heap_alloc(e, cls_fit(2));
                                                                                        e.mem[_nd_32 + 0] = 106ull;
                                                                                        e.mem[_nd_32 + 1] = term_ctr(CID_SCON, _nd_31);
                                                                                        u64 _nd_33 = _sp_12 >= HEAP_OFF ? _sp_12 : heap_alloc(e, cls_fit(2));
                                                                                        e.mem[_nd_33 + 0] = 105ull;
                                                                                        e.mem[_nd_33 + 1] = term_ctr(CID_SCON, _nd_32);
                                                                                        u64 _nd_34 = _sp_13 >= HEAP_OFF ? _sp_13 : heap_alloc(e, cls_fit(2));
                                                                                        e.mem[_nd_34 + 0] = 104ull;
                                                                                        e.mem[_nd_34 + 1] = term_ctr(CID_SCON, _nd_33);
                                                                                        u64 _nd_35 = _sp_14 >= HEAP_OFF ? _sp_14 : heap_alloc(e, cls_fit(2));
                                                                                        e.mem[_nd_35 + 0] = 103ull;
                                                                                        e.mem[_nd_35 + 1] = term_ctr(CID_SCON, _nd_34);
                                                                                        u64 _nd_36 = _sp_15 >= HEAP_OFF ? _sp_15 : heap_alloc(e, cls_fit(2));
                                                                                        e.mem[_nd_36 + 0] = 102ull;
                                                                                        e.mem[_nd_36 + 1] = term_ctr(CID_SCON, _nd_35);
                                                                                        u64 _nd_37 = _sp_16 >= HEAP_OFF ? _sp_16 : heap_alloc(e, cls_fit(2));
                                                                                        e.mem[_nd_37 + 0] = 101ull;
                                                                                        e.mem[_nd_37 + 1] = term_ctr(CID_SCON, _nd_36);
                                                                                        u64 _nd_38 = _sp_17 >= HEAP_OFF ? _sp_17 : heap_alloc(e, cls_fit(2));
                                                                                        e.mem[_nd_38 + 0] = 100ull;
                                                                                        e.mem[_nd_38 + 1] = term_ctr(CID_SCON, _nd_37);
                                                                                        u64 _nd_39 = _sp_18 >= HEAP_OFF ? _sp_18 : heap_alloc(e, cls_fit(2));
                                                                                        e.mem[_nd_39 + 0] = 99ull;
                                                                                        e.mem[_nd_39 + 1] = term_ctr(CID_SCON, _nd_38);
                                                                                        u64 _nd_40 = _sp_19 >= HEAP_OFF ? _sp_19 : heap_alloc(e, cls_fit(2));
                                                                                        e.mem[_nd_40 + 0] = 98ull;
                                                                                        e.mem[_nd_40 + 1] = term_ctr(CID_SCON, _nd_39);
                                                                                        u64 _nd_41 = _sp_20 >= HEAP_OFF ? _sp_20 : heap_alloc(e, cls_fit(2));
                                                                                        e.mem[_nd_41 + 0] = 97ull;
                                                                                        e.mem[_nd_41 + 1] = term_ctr(CID_SCON, _nd_40);
                                                                                        if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                                                                          u64 _t_1 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                                                                          e.mem[_t_1 + 0] = term_ctr(CID_SCON, _nd_41);
                                                                                          return term_tsk(FID_G, _t_1);
                                                                                        }
                                                                                        r0 = term_ctr(CID_SCON, _nd_41);
                                                                                        WL_JMP(FID_G);
                                                                                      }
                                                                                    } else {
                                                                                      u64 _nd_42 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                                                                      e.mem[_nd_42 + 0] = 116ull;
                                                                                      e.mem[_nd_42 + 1] = _f_39;
                                                                                      u64 _nd_43 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                                                                      e.mem[_nd_43 + 0] = 115ull;
                                                                                      e.mem[_nd_43 + 1] = term_ctr(CID_SCON, _nd_42);
                                                                                      u64 _nd_44 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                                                                      e.mem[_nd_44 + 0] = 114ull;
                                                                                      e.mem[_nd_44 + 1] = term_ctr(CID_SCON, _nd_43);
                                                                                      u64 _nd_45 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                                                                      e.mem[_nd_45 + 0] = 113ull;
                                                                                      e.mem[_nd_45 + 1] = term_ctr(CID_SCON, _nd_44);
                                                                                      u64 _nd_46 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                                                                      e.mem[_nd_46 + 0] = 112ull;
                                                                                      e.mem[_nd_46 + 1] = term_ctr(CID_SCON, _nd_45);
                                                                                      u64 _nd_47 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                                                                      e.mem[_nd_47 + 0] = 111ull;
                                                                                      e.mem[_nd_47 + 1] = term_ctr(CID_SCON, _nd_46);
                                                                                      u64 _nd_48 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                                                                      e.mem[_nd_48 + 0] = 110ull;
                                                                                      e.mem[_nd_48 + 1] = term_ctr(CID_SCON, _nd_47);
                                                                                      u64 _nd_49 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                                                                      e.mem[_nd_49 + 0] = 109ull;
                                                                                      e.mem[_nd_49 + 1] = term_ctr(CID_SCON, _nd_48);
                                                                                      u64 _nd_50 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                                                                      e.mem[_nd_50 + 0] = 108ull;
                                                                                      e.mem[_nd_50 + 1] = term_ctr(CID_SCON, _nd_49);
                                                                                      u64 _nd_51 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                                                                      e.mem[_nd_51 + 0] = 107ull;
                                                                                      e.mem[_nd_51 + 1] = term_ctr(CID_SCON, _nd_50);
                                                                                      u64 _nd_52 = _sp_10 >= HEAP_OFF ? _sp_10 : heap_alloc(e, cls_fit(2));
                                                                                      e.mem[_nd_52 + 0] = 106ull;
                                                                                      e.mem[_nd_52 + 1] = term_ctr(CID_SCON, _nd_51);
                                                                                      u64 _nd_53 = _sp_11 >= HEAP_OFF ? _sp_11 : heap_alloc(e, cls_fit(2));
                                                                                      e.mem[_nd_53 + 0] = 105ull;
                                                                                      e.mem[_nd_53 + 1] = term_ctr(CID_SCON, _nd_52);
                                                                                      u64 _nd_54 = _sp_12 >= HEAP_OFF ? _sp_12 : heap_alloc(e, cls_fit(2));
                                                                                      e.mem[_nd_54 + 0] = 104ull;
                                                                                      e.mem[_nd_54 + 1] = term_ctr(CID_SCON, _nd_53);
                                                                                      u64 _nd_55 = _sp_13 >= HEAP_OFF ? _sp_13 : heap_alloc(e, cls_fit(2));
                                                                                      e.mem[_nd_55 + 0] = 103ull;
                                                                                      e.mem[_nd_55 + 1] = term_ctr(CID_SCON, _nd_54);
                                                                                      u64 _nd_56 = _sp_14 >= HEAP_OFF ? _sp_14 : heap_alloc(e, cls_fit(2));
                                                                                      e.mem[_nd_56 + 0] = 102ull;
                                                                                      e.mem[_nd_56 + 1] = term_ctr(CID_SCON, _nd_55);
                                                                                      u64 _nd_57 = _sp_15 >= HEAP_OFF ? _sp_15 : heap_alloc(e, cls_fit(2));
                                                                                      e.mem[_nd_57 + 0] = 101ull;
                                                                                      e.mem[_nd_57 + 1] = term_ctr(CID_SCON, _nd_56);
                                                                                      u64 _nd_58 = _sp_16 >= HEAP_OFF ? _sp_16 : heap_alloc(e, cls_fit(2));
                                                                                      e.mem[_nd_58 + 0] = 100ull;
                                                                                      e.mem[_nd_58 + 1] = term_ctr(CID_SCON, _nd_57);
                                                                                      u64 _nd_59 = _sp_17 >= HEAP_OFF ? _sp_17 : heap_alloc(e, cls_fit(2));
                                                                                      e.mem[_nd_59 + 0] = 99ull;
                                                                                      e.mem[_nd_59 + 1] = term_ctr(CID_SCON, _nd_58);
                                                                                      u64 _nd_60 = _sp_18 >= HEAP_OFF ? _sp_18 : heap_alloc(e, cls_fit(2));
                                                                                      e.mem[_nd_60 + 0] = 98ull;
                                                                                      e.mem[_nd_60 + 1] = term_ctr(CID_SCON, _nd_59);
                                                                                      u64 _nd_61 = _sp_19 >= HEAP_OFF ? _sp_19 : heap_alloc(e, cls_fit(2));
                                                                                      e.mem[_nd_61 + 0] = 97ull;
                                                                                      e.mem[_nd_61 + 1] = term_ctr(CID_SCON, _nd_60);
                                                                                      if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                                                                        u64 _t_2 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                                                                        e.mem[_t_2 + 0] = term_ctr(CID_SCON, _nd_61);
                                                                                        return term_tsk(FID_G, _t_2);
                                                                                      }
                                                                                      r0 = term_ctr(CID_SCON, _nd_61);
                                                                                      WL_JMP(FID_G);
                                                                                    }
                                                                                  } else {
                                                                                    u32 _1300_0 = ((_f_38 >> 0) & 1);
                                                                                    u32 _1301_0 = ((_f_38 >> 1) & 1);
                                                                                    u32 _1301_1 = ((_f_38 >> 2) & 1);
                                                                                    u32 _1301_2 = ((_f_38 >> 3) & 1);
                                                                                    u32 _1301_3 = ((_f_38 >> 4) & 1);
                                                                                    u32 _1301_4 = ((_f_38 >> 5) & 1);
                                                                                    u32 _1301_5 = ((_f_38 >> 6) & 1);
                                                                                    u32 _1301_6 = ((_f_38 >> 7) & 1);
                                                                                    u32 _1301_7 = ((_f_38 >> 8) & 1);
                                                                                    u32 _1301_8 = ((_f_38 >> 9) & 1);
                                                                                    u32 _1301_9 = ((_f_38 >> 10) & 1);
                                                                                    u32 _1301_10 = ((_f_38 >> 11) & 1);
                                                                                    u32 _1301_11 = ((_f_38 >> 12) & 1);
                                                                                    u32 _1301_12 = ((_f_38 >> 13) & 1);
                                                                                    u32 _1301_13 = ((_f_38 >> 14) & 1);
                                                                                    u32 _1301_14 = ((_f_38 >> 15) & 1);
                                                                                    u32 _1301_15 = ((_f_38 >> 16) & 1);
                                                                                    u32 _1301_16 = ((_f_38 >> 17) & 1);
                                                                                    u32 _1301_17 = ((_f_38 >> 18) & 1);
                                                                                    u32 _1301_18 = ((_f_38 >> 19) & 1);
                                                                                    u32 _1301_19 = ((_f_38 >> 20) & 1);
                                                                                    u32 _1301_20 = ((_f_38 >> 21) & 1);
                                                                                    u32 _1301_21 = ((_f_38 >> 22) & 1);
                                                                                    u32 _1301_22 = ((_f_38 >> 23) & 1);
                                                                                    u32 _1301_23 = ((_f_38 >> 24) & 1);
                                                                                    u32 _1301_24 = ((_f_38 >> 25) & 1);
                                                                                    u32 _1301_25 = ((_f_38 >> 26) & 1);
                                                                                    u32 _1301_26 = ((_f_38 >> 27) & 1);
                                                                                    u32 _1301_27 = ((_f_38 >> 28) & 1);
                                                                                    u32 _1301_28 = ((_f_38 >> 29) & 1);
                                                                                    u32 _1301_29 = ((_f_38 >> 30) & 1);
                                                                                    u32 _1301_30 = ((_f_38 >> 31) & 1);
                                                                                    u64 _nd_62 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                                                                    e.mem[_nd_62 + 0] = (((u64)_1300_0 << 0) | ((u64)_1301_0 << 1) | ((u64)_1301_1 << 2) | ((u64)_1301_2 << 3) | ((u64)_1301_3 << 4) | ((u64)_1301_4 << 5) | ((u64)_1301_5 << 6) | ((u64)_1301_6 << 7) | ((u64)_1301_7 << 8) | ((u64)_1301_8 << 9) | ((u64)_1301_9 << 10) | ((u64)_1301_10 << 11) | ((u64)_1301_11 << 12) | ((u64)_1301_12 << 13) | ((u64)_1301_13 << 14) | ((u64)_1301_14 << 15) | ((u64)_1301_15 << 16) | ((u64)_1301_16 << 17) | ((u64)_1301_17 << 18) | ((u64)_1301_18 << 19) | ((u64)_1301_19 << 20) | ((u64)_1301_20 << 21) | ((u64)_1301_21 << 22) | ((u64)_1301_22 << 23) | ((u64)_1301_23 << 24) | ((u64)_1301_24 << 25) | ((u64)_1301_25 << 26) | ((u64)_1301_26 << 27) | ((u64)_1301_27 << 28) | ((u64)_1301_28 << 29) | ((u64)_1301_29 << 30) | ((u64)_1301_30 << 31));
                                                                                    e.mem[_nd_62 + 1] = _f_39;
                                                                                    u64 _nd_63 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                                                                    e.mem[_nd_63 + 0] = 115ull;
                                                                                    e.mem[_nd_63 + 1] = term_ctr(CID_SCON, _nd_62);
                                                                                    u64 _nd_64 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                                                                    e.mem[_nd_64 + 0] = 114ull;
                                                                                    e.mem[_nd_64 + 1] = term_ctr(CID_SCON, _nd_63);
                                                                                    u64 _nd_65 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                                                                    e.mem[_nd_65 + 0] = 113ull;
                                                                                    e.mem[_nd_65 + 1] = term_ctr(CID_SCON, _nd_64);
                                                                                    u64 _nd_66 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                                                                    e.mem[_nd_66 + 0] = 112ull;
                                                                                    e.mem[_nd_66 + 1] = term_ctr(CID_SCON, _nd_65);
                                                                                    u64 _nd_67 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                                                                    e.mem[_nd_67 + 0] = 111ull;
                                                                                    e.mem[_nd_67 + 1] = term_ctr(CID_SCON, _nd_66);
                                                                                    u64 _nd_68 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                                                                    e.mem[_nd_68 + 0] = 110ull;
                                                                                    e.mem[_nd_68 + 1] = term_ctr(CID_SCON, _nd_67);
                                                                                    u64 _nd_69 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                                                                    e.mem[_nd_69 + 0] = 109ull;
                                                                                    e.mem[_nd_69 + 1] = term_ctr(CID_SCON, _nd_68);
                                                                                    u64 _nd_70 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                                                                    e.mem[_nd_70 + 0] = 108ull;
                                                                                    e.mem[_nd_70 + 1] = term_ctr(CID_SCON, _nd_69);
                                                                                    u64 _nd_71 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                                                                    e.mem[_nd_71 + 0] = 107ull;
                                                                                    e.mem[_nd_71 + 1] = term_ctr(CID_SCON, _nd_70);
                                                                                    u64 _nd_72 = _sp_10 >= HEAP_OFF ? _sp_10 : heap_alloc(e, cls_fit(2));
                                                                                    e.mem[_nd_72 + 0] = 106ull;
                                                                                    e.mem[_nd_72 + 1] = term_ctr(CID_SCON, _nd_71);
                                                                                    u64 _nd_73 = _sp_11 >= HEAP_OFF ? _sp_11 : heap_alloc(e, cls_fit(2));
                                                                                    e.mem[_nd_73 + 0] = 105ull;
                                                                                    e.mem[_nd_73 + 1] = term_ctr(CID_SCON, _nd_72);
                                                                                    u64 _nd_74 = _sp_12 >= HEAP_OFF ? _sp_12 : heap_alloc(e, cls_fit(2));
                                                                                    e.mem[_nd_74 + 0] = 104ull;
                                                                                    e.mem[_nd_74 + 1] = term_ctr(CID_SCON, _nd_73);
                                                                                    u64 _nd_75 = _sp_13 >= HEAP_OFF ? _sp_13 : heap_alloc(e, cls_fit(2));
                                                                                    e.mem[_nd_75 + 0] = 103ull;
                                                                                    e.mem[_nd_75 + 1] = term_ctr(CID_SCON, _nd_74);
                                                                                    u64 _nd_76 = _sp_14 >= HEAP_OFF ? _sp_14 : heap_alloc(e, cls_fit(2));
                                                                                    e.mem[_nd_76 + 0] = 102ull;
                                                                                    e.mem[_nd_76 + 1] = term_ctr(CID_SCON, _nd_75);
                                                                                    u64 _nd_77 = _sp_15 >= HEAP_OFF ? _sp_15 : heap_alloc(e, cls_fit(2));
                                                                                    e.mem[_nd_77 + 0] = 101ull;
                                                                                    e.mem[_nd_77 + 1] = term_ctr(CID_SCON, _nd_76);
                                                                                    u64 _nd_78 = _sp_16 >= HEAP_OFF ? _sp_16 : heap_alloc(e, cls_fit(2));
                                                                                    e.mem[_nd_78 + 0] = 100ull;
                                                                                    e.mem[_nd_78 + 1] = term_ctr(CID_SCON, _nd_77);
                                                                                    u64 _nd_79 = _sp_17 >= HEAP_OFF ? _sp_17 : heap_alloc(e, cls_fit(2));
                                                                                    e.mem[_nd_79 + 0] = 99ull;
                                                                                    e.mem[_nd_79 + 1] = term_ctr(CID_SCON, _nd_78);
                                                                                    u64 _nd_80 = _sp_18 >= HEAP_OFF ? _sp_18 : heap_alloc(e, cls_fit(2));
                                                                                    e.mem[_nd_80 + 0] = 98ull;
                                                                                    e.mem[_nd_80 + 1] = term_ctr(CID_SCON, _nd_79);
                                                                                    u64 _nd_81 = _sp_19 >= HEAP_OFF ? _sp_19 : heap_alloc(e, cls_fit(2));
                                                                                    e.mem[_nd_81 + 0] = 97ull;
                                                                                    e.mem[_nd_81 + 1] = term_ctr(CID_SCON, _nd_80);
                                                                                    if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                                                                      u64 _t_3 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                                                                      e.mem[_t_3 + 0] = term_ctr(CID_SCON, _nd_81);
                                                                                      return term_tsk(FID_G, _t_3);
                                                                                    }
                                                                                    r0 = term_ctr(CID_SCON, _nd_81);
                                                                                    WL_JMP(FID_G);
                                                                                  }
                                                                                } else {
                                                                                  u64 _nd_82 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                                                                  e.mem[_nd_82 + 0] = 115ull;
                                                                                  e.mem[_nd_82 + 1] = _f_37;
                                                                                  u64 _nd_83 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                                                                  e.mem[_nd_83 + 0] = 114ull;
                                                                                  e.mem[_nd_83 + 1] = term_ctr(CID_SCON, _nd_82);
                                                                                  u64 _nd_84 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                                                                  e.mem[_nd_84 + 0] = 113ull;
                                                                                  e.mem[_nd_84 + 1] = term_ctr(CID_SCON, _nd_83);
                                                                                  u64 _nd_85 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                                                                  e.mem[_nd_85 + 0] = 112ull;
                                                                                  e.mem[_nd_85 + 1] = term_ctr(CID_SCON, _nd_84);
                                                                                  u64 _nd_86 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                                                                  e.mem[_nd_86 + 0] = 111ull;
                                                                                  e.mem[_nd_86 + 1] = term_ctr(CID_SCON, _nd_85);
                                                                                  u64 _nd_87 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                                                                  e.mem[_nd_87 + 0] = 110ull;
                                                                                  e.mem[_nd_87 + 1] = term_ctr(CID_SCON, _nd_86);
                                                                                  u64 _nd_88 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                                                                  e.mem[_nd_88 + 0] = 109ull;
                                                                                  e.mem[_nd_88 + 1] = term_ctr(CID_SCON, _nd_87);
                                                                                  u64 _nd_89 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                                                                  e.mem[_nd_89 + 0] = 108ull;
                                                                                  e.mem[_nd_89 + 1] = term_ctr(CID_SCON, _nd_88);
                                                                                  u64 _nd_90 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                                                                  e.mem[_nd_90 + 0] = 107ull;
                                                                                  e.mem[_nd_90 + 1] = term_ctr(CID_SCON, _nd_89);
                                                                                  u64 _nd_91 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                                                                  e.mem[_nd_91 + 0] = 106ull;
                                                                                  e.mem[_nd_91 + 1] = term_ctr(CID_SCON, _nd_90);
                                                                                  u64 _nd_92 = _sp_10 >= HEAP_OFF ? _sp_10 : heap_alloc(e, cls_fit(2));
                                                                                  e.mem[_nd_92 + 0] = 105ull;
                                                                                  e.mem[_nd_92 + 1] = term_ctr(CID_SCON, _nd_91);
                                                                                  u64 _nd_93 = _sp_11 >= HEAP_OFF ? _sp_11 : heap_alloc(e, cls_fit(2));
                                                                                  e.mem[_nd_93 + 0] = 104ull;
                                                                                  e.mem[_nd_93 + 1] = term_ctr(CID_SCON, _nd_92);
                                                                                  u64 _nd_94 = _sp_12 >= HEAP_OFF ? _sp_12 : heap_alloc(e, cls_fit(2));
                                                                                  e.mem[_nd_94 + 0] = 103ull;
                                                                                  e.mem[_nd_94 + 1] = term_ctr(CID_SCON, _nd_93);
                                                                                  u64 _nd_95 = _sp_13 >= HEAP_OFF ? _sp_13 : heap_alloc(e, cls_fit(2));
                                                                                  e.mem[_nd_95 + 0] = 102ull;
                                                                                  e.mem[_nd_95 + 1] = term_ctr(CID_SCON, _nd_94);
                                                                                  u64 _nd_96 = _sp_14 >= HEAP_OFF ? _sp_14 : heap_alloc(e, cls_fit(2));
                                                                                  e.mem[_nd_96 + 0] = 101ull;
                                                                                  e.mem[_nd_96 + 1] = term_ctr(CID_SCON, _nd_95);
                                                                                  u64 _nd_97 = _sp_15 >= HEAP_OFF ? _sp_15 : heap_alloc(e, cls_fit(2));
                                                                                  e.mem[_nd_97 + 0] = 100ull;
                                                                                  e.mem[_nd_97 + 1] = term_ctr(CID_SCON, _nd_96);
                                                                                  u64 _nd_98 = _sp_16 >= HEAP_OFF ? _sp_16 : heap_alloc(e, cls_fit(2));
                                                                                  e.mem[_nd_98 + 0] = 99ull;
                                                                                  e.mem[_nd_98 + 1] = term_ctr(CID_SCON, _nd_97);
                                                                                  u64 _nd_99 = _sp_17 >= HEAP_OFF ? _sp_17 : heap_alloc(e, cls_fit(2));
                                                                                  e.mem[_nd_99 + 0] = 98ull;
                                                                                  e.mem[_nd_99 + 1] = term_ctr(CID_SCON, _nd_98);
                                                                                  u64 _nd_100 = _sp_18 >= HEAP_OFF ? _sp_18 : heap_alloc(e, cls_fit(2));
                                                                                  e.mem[_nd_100 + 0] = 97ull;
                                                                                  e.mem[_nd_100 + 1] = term_ctr(CID_SCON, _nd_99);
                                                                                  if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                                                                    u64 _t_4 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                                                                    e.mem[_t_4 + 0] = term_ctr(CID_SCON, _nd_100);
                                                                                    return term_tsk(FID_G, _t_4);
                                                                                  }
                                                                                  r0 = term_ctr(CID_SCON, _nd_100);
                                                                                  WL_JMP(FID_G);
                                                                                }
                                                                              } else {
                                                                                u32 _1232_0 = ((_f_36 >> 0) & 1);
                                                                                u32 _1233_0 = ((_f_36 >> 1) & 1);
                                                                                u32 _1233_1 = ((_f_36 >> 2) & 1);
                                                                                u32 _1233_2 = ((_f_36 >> 3) & 1);
                                                                                u32 _1233_3 = ((_f_36 >> 4) & 1);
                                                                                u32 _1233_4 = ((_f_36 >> 5) & 1);
                                                                                u32 _1233_5 = ((_f_36 >> 6) & 1);
                                                                                u32 _1233_6 = ((_f_36 >> 7) & 1);
                                                                                u32 _1233_7 = ((_f_36 >> 8) & 1);
                                                                                u32 _1233_8 = ((_f_36 >> 9) & 1);
                                                                                u32 _1233_9 = ((_f_36 >> 10) & 1);
                                                                                u32 _1233_10 = ((_f_36 >> 11) & 1);
                                                                                u32 _1233_11 = ((_f_36 >> 12) & 1);
                                                                                u32 _1233_12 = ((_f_36 >> 13) & 1);
                                                                                u32 _1233_13 = ((_f_36 >> 14) & 1);
                                                                                u32 _1233_14 = ((_f_36 >> 15) & 1);
                                                                                u32 _1233_15 = ((_f_36 >> 16) & 1);
                                                                                u32 _1233_16 = ((_f_36 >> 17) & 1);
                                                                                u32 _1233_17 = ((_f_36 >> 18) & 1);
                                                                                u32 _1233_18 = ((_f_36 >> 19) & 1);
                                                                                u32 _1233_19 = ((_f_36 >> 20) & 1);
                                                                                u32 _1233_20 = ((_f_36 >> 21) & 1);
                                                                                u32 _1233_21 = ((_f_36 >> 22) & 1);
                                                                                u32 _1233_22 = ((_f_36 >> 23) & 1);
                                                                                u32 _1233_23 = ((_f_36 >> 24) & 1);
                                                                                u32 _1233_24 = ((_f_36 >> 25) & 1);
                                                                                u32 _1233_25 = ((_f_36 >> 26) & 1);
                                                                                u32 _1233_26 = ((_f_36 >> 27) & 1);
                                                                                u32 _1233_27 = ((_f_36 >> 28) & 1);
                                                                                u32 _1233_28 = ((_f_36 >> 29) & 1);
                                                                                u32 _1233_29 = ((_f_36 >> 30) & 1);
                                                                                u32 _1233_30 = ((_f_36 >> 31) & 1);
                                                                                u64 _nd_101 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                                                                e.mem[_nd_101 + 0] = (((u64)_1232_0 << 0) | ((u64)_1233_0 << 1) | ((u64)_1233_1 << 2) | ((u64)_1233_2 << 3) | ((u64)_1233_3 << 4) | ((u64)_1233_4 << 5) | ((u64)_1233_5 << 6) | ((u64)_1233_6 << 7) | ((u64)_1233_7 << 8) | ((u64)_1233_8 << 9) | ((u64)_1233_9 << 10) | ((u64)_1233_10 << 11) | ((u64)_1233_11 << 12) | ((u64)_1233_12 << 13) | ((u64)_1233_13 << 14) | ((u64)_1233_14 << 15) | ((u64)_1233_15 << 16) | ((u64)_1233_16 << 17) | ((u64)_1233_17 << 18) | ((u64)_1233_18 << 19) | ((u64)_1233_19 << 20) | ((u64)_1233_20 << 21) | ((u64)_1233_21 << 22) | ((u64)_1233_22 << 23) | ((u64)_1233_23 << 24) | ((u64)_1233_24 << 25) | ((u64)_1233_25 << 26) | ((u64)_1233_26 << 27) | ((u64)_1233_27 << 28) | ((u64)_1233_28 << 29) | ((u64)_1233_29 << 30) | ((u64)_1233_30 << 31));
                                                                                e.mem[_nd_101 + 1] = _f_37;
                                                                                u64 _nd_102 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                                                                e.mem[_nd_102 + 0] = 114ull;
                                                                                e.mem[_nd_102 + 1] = term_ctr(CID_SCON, _nd_101);
                                                                                u64 _nd_103 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                                                                e.mem[_nd_103 + 0] = 113ull;
                                                                                e.mem[_nd_103 + 1] = term_ctr(CID_SCON, _nd_102);
                                                                                u64 _nd_104 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                                                                e.mem[_nd_104 + 0] = 112ull;
                                                                                e.mem[_nd_104 + 1] = term_ctr(CID_SCON, _nd_103);
                                                                                u64 _nd_105 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                                                                e.mem[_nd_105 + 0] = 111ull;
                                                                                e.mem[_nd_105 + 1] = term_ctr(CID_SCON, _nd_104);
                                                                                u64 _nd_106 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                                                                e.mem[_nd_106 + 0] = 110ull;
                                                                                e.mem[_nd_106 + 1] = term_ctr(CID_SCON, _nd_105);
                                                                                u64 _nd_107 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                                                                e.mem[_nd_107 + 0] = 109ull;
                                                                                e.mem[_nd_107 + 1] = term_ctr(CID_SCON, _nd_106);
                                                                                u64 _nd_108 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                                                                e.mem[_nd_108 + 0] = 108ull;
                                                                                e.mem[_nd_108 + 1] = term_ctr(CID_SCON, _nd_107);
                                                                                u64 _nd_109 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                                                                e.mem[_nd_109 + 0] = 107ull;
                                                                                e.mem[_nd_109 + 1] = term_ctr(CID_SCON, _nd_108);
                                                                                u64 _nd_110 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                                                                e.mem[_nd_110 + 0] = 106ull;
                                                                                e.mem[_nd_110 + 1] = term_ctr(CID_SCON, _nd_109);
                                                                                u64 _nd_111 = _sp_10 >= HEAP_OFF ? _sp_10 : heap_alloc(e, cls_fit(2));
                                                                                e.mem[_nd_111 + 0] = 105ull;
                                                                                e.mem[_nd_111 + 1] = term_ctr(CID_SCON, _nd_110);
                                                                                u64 _nd_112 = _sp_11 >= HEAP_OFF ? _sp_11 : heap_alloc(e, cls_fit(2));
                                                                                e.mem[_nd_112 + 0] = 104ull;
                                                                                e.mem[_nd_112 + 1] = term_ctr(CID_SCON, _nd_111);
                                                                                u64 _nd_113 = _sp_12 >= HEAP_OFF ? _sp_12 : heap_alloc(e, cls_fit(2));
                                                                                e.mem[_nd_113 + 0] = 103ull;
                                                                                e.mem[_nd_113 + 1] = term_ctr(CID_SCON, _nd_112);
                                                                                u64 _nd_114 = _sp_13 >= HEAP_OFF ? _sp_13 : heap_alloc(e, cls_fit(2));
                                                                                e.mem[_nd_114 + 0] = 102ull;
                                                                                e.mem[_nd_114 + 1] = term_ctr(CID_SCON, _nd_113);
                                                                                u64 _nd_115 = _sp_14 >= HEAP_OFF ? _sp_14 : heap_alloc(e, cls_fit(2));
                                                                                e.mem[_nd_115 + 0] = 101ull;
                                                                                e.mem[_nd_115 + 1] = term_ctr(CID_SCON, _nd_114);
                                                                                u64 _nd_116 = _sp_15 >= HEAP_OFF ? _sp_15 : heap_alloc(e, cls_fit(2));
                                                                                e.mem[_nd_116 + 0] = 100ull;
                                                                                e.mem[_nd_116 + 1] = term_ctr(CID_SCON, _nd_115);
                                                                                u64 _nd_117 = _sp_16 >= HEAP_OFF ? _sp_16 : heap_alloc(e, cls_fit(2));
                                                                                e.mem[_nd_117 + 0] = 99ull;
                                                                                e.mem[_nd_117 + 1] = term_ctr(CID_SCON, _nd_116);
                                                                                u64 _nd_118 = _sp_17 >= HEAP_OFF ? _sp_17 : heap_alloc(e, cls_fit(2));
                                                                                e.mem[_nd_118 + 0] = 98ull;
                                                                                e.mem[_nd_118 + 1] = term_ctr(CID_SCON, _nd_117);
                                                                                u64 _nd_119 = _sp_18 >= HEAP_OFF ? _sp_18 : heap_alloc(e, cls_fit(2));
                                                                                e.mem[_nd_119 + 0] = 97ull;
                                                                                e.mem[_nd_119 + 1] = term_ctr(CID_SCON, _nd_118);
                                                                                if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                                                                  u64 _t_5 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                                                                  e.mem[_t_5 + 0] = term_ctr(CID_SCON, _nd_119);
                                                                                  return term_tsk(FID_G, _t_5);
                                                                                }
                                                                                r0 = term_ctr(CID_SCON, _nd_119);
                                                                                WL_JMP(FID_G);
                                                                              }
                                                                            } else {
                                                                              u64 _nd_120 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                                                              e.mem[_nd_120 + 0] = 114ull;
                                                                              e.mem[_nd_120 + 1] = _f_35;
                                                                              u64 _nd_121 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                                                              e.mem[_nd_121 + 0] = 113ull;
                                                                              e.mem[_nd_121 + 1] = term_ctr(CID_SCON, _nd_120);
                                                                              u64 _nd_122 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                                                              e.mem[_nd_122 + 0] = 112ull;
                                                                              e.mem[_nd_122 + 1] = term_ctr(CID_SCON, _nd_121);
                                                                              u64 _nd_123 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                                                              e.mem[_nd_123 + 0] = 111ull;
                                                                              e.mem[_nd_123 + 1] = term_ctr(CID_SCON, _nd_122);
                                                                              u64 _nd_124 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                                                              e.mem[_nd_124 + 0] = 110ull;
                                                                              e.mem[_nd_124 + 1] = term_ctr(CID_SCON, _nd_123);
                                                                              u64 _nd_125 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                                                              e.mem[_nd_125 + 0] = 109ull;
                                                                              e.mem[_nd_125 + 1] = term_ctr(CID_SCON, _nd_124);
                                                                              u64 _nd_126 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                                                              e.mem[_nd_126 + 0] = 108ull;
                                                                              e.mem[_nd_126 + 1] = term_ctr(CID_SCON, _nd_125);
                                                                              u64 _nd_127 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                                                              e.mem[_nd_127 + 0] = 107ull;
                                                                              e.mem[_nd_127 + 1] = term_ctr(CID_SCON, _nd_126);
                                                                              u64 _nd_128 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                                                              e.mem[_nd_128 + 0] = 106ull;
                                                                              e.mem[_nd_128 + 1] = term_ctr(CID_SCON, _nd_127);
                                                                              u64 _nd_129 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                                                              e.mem[_nd_129 + 0] = 105ull;
                                                                              e.mem[_nd_129 + 1] = term_ctr(CID_SCON, _nd_128);
                                                                              u64 _nd_130 = _sp_10 >= HEAP_OFF ? _sp_10 : heap_alloc(e, cls_fit(2));
                                                                              e.mem[_nd_130 + 0] = 104ull;
                                                                              e.mem[_nd_130 + 1] = term_ctr(CID_SCON, _nd_129);
                                                                              u64 _nd_131 = _sp_11 >= HEAP_OFF ? _sp_11 : heap_alloc(e, cls_fit(2));
                                                                              e.mem[_nd_131 + 0] = 103ull;
                                                                              e.mem[_nd_131 + 1] = term_ctr(CID_SCON, _nd_130);
                                                                              u64 _nd_132 = _sp_12 >= HEAP_OFF ? _sp_12 : heap_alloc(e, cls_fit(2));
                                                                              e.mem[_nd_132 + 0] = 102ull;
                                                                              e.mem[_nd_132 + 1] = term_ctr(CID_SCON, _nd_131);
                                                                              u64 _nd_133 = _sp_13 >= HEAP_OFF ? _sp_13 : heap_alloc(e, cls_fit(2));
                                                                              e.mem[_nd_133 + 0] = 101ull;
                                                                              e.mem[_nd_133 + 1] = term_ctr(CID_SCON, _nd_132);
                                                                              u64 _nd_134 = _sp_14 >= HEAP_OFF ? _sp_14 : heap_alloc(e, cls_fit(2));
                                                                              e.mem[_nd_134 + 0] = 100ull;
                                                                              e.mem[_nd_134 + 1] = term_ctr(CID_SCON, _nd_133);
                                                                              u64 _nd_135 = _sp_15 >= HEAP_OFF ? _sp_15 : heap_alloc(e, cls_fit(2));
                                                                              e.mem[_nd_135 + 0] = 99ull;
                                                                              e.mem[_nd_135 + 1] = term_ctr(CID_SCON, _nd_134);
                                                                              u64 _nd_136 = _sp_16 >= HEAP_OFF ? _sp_16 : heap_alloc(e, cls_fit(2));
                                                                              e.mem[_nd_136 + 0] = 98ull;
                                                                              e.mem[_nd_136 + 1] = term_ctr(CID_SCON, _nd_135);
                                                                              u64 _nd_137 = _sp_17 >= HEAP_OFF ? _sp_17 : heap_alloc(e, cls_fit(2));
                                                                              e.mem[_nd_137 + 0] = 97ull;
                                                                              e.mem[_nd_137 + 1] = term_ctr(CID_SCON, _nd_136);
                                                                              if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                                                                u64 _t_6 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                                                                e.mem[_t_6 + 0] = term_ctr(CID_SCON, _nd_137);
                                                                                return term_tsk(FID_G, _t_6);
                                                                              }
                                                                              r0 = term_ctr(CID_SCON, _nd_137);
                                                                              WL_JMP(FID_G);
                                                                            }
                                                                          } else {
                                                                            u32 _1164_0 = ((_f_34 >> 0) & 1);
                                                                            u32 _1165_0 = ((_f_34 >> 1) & 1);
                                                                            u32 _1165_1 = ((_f_34 >> 2) & 1);
                                                                            u32 _1165_2 = ((_f_34 >> 3) & 1);
                                                                            u32 _1165_3 = ((_f_34 >> 4) & 1);
                                                                            u32 _1165_4 = ((_f_34 >> 5) & 1);
                                                                            u32 _1165_5 = ((_f_34 >> 6) & 1);
                                                                            u32 _1165_6 = ((_f_34 >> 7) & 1);
                                                                            u32 _1165_7 = ((_f_34 >> 8) & 1);
                                                                            u32 _1165_8 = ((_f_34 >> 9) & 1);
                                                                            u32 _1165_9 = ((_f_34 >> 10) & 1);
                                                                            u32 _1165_10 = ((_f_34 >> 11) & 1);
                                                                            u32 _1165_11 = ((_f_34 >> 12) & 1);
                                                                            u32 _1165_12 = ((_f_34 >> 13) & 1);
                                                                            u32 _1165_13 = ((_f_34 >> 14) & 1);
                                                                            u32 _1165_14 = ((_f_34 >> 15) & 1);
                                                                            u32 _1165_15 = ((_f_34 >> 16) & 1);
                                                                            u32 _1165_16 = ((_f_34 >> 17) & 1);
                                                                            u32 _1165_17 = ((_f_34 >> 18) & 1);
                                                                            u32 _1165_18 = ((_f_34 >> 19) & 1);
                                                                            u32 _1165_19 = ((_f_34 >> 20) & 1);
                                                                            u32 _1165_20 = ((_f_34 >> 21) & 1);
                                                                            u32 _1165_21 = ((_f_34 >> 22) & 1);
                                                                            u32 _1165_22 = ((_f_34 >> 23) & 1);
                                                                            u32 _1165_23 = ((_f_34 >> 24) & 1);
                                                                            u32 _1165_24 = ((_f_34 >> 25) & 1);
                                                                            u32 _1165_25 = ((_f_34 >> 26) & 1);
                                                                            u32 _1165_26 = ((_f_34 >> 27) & 1);
                                                                            u32 _1165_27 = ((_f_34 >> 28) & 1);
                                                                            u32 _1165_28 = ((_f_34 >> 29) & 1);
                                                                            u32 _1165_29 = ((_f_34 >> 30) & 1);
                                                                            u32 _1165_30 = ((_f_34 >> 31) & 1);
                                                                            u64 _nd_138 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                                                            e.mem[_nd_138 + 0] = (((u64)_1164_0 << 0) | ((u64)_1165_0 << 1) | ((u64)_1165_1 << 2) | ((u64)_1165_2 << 3) | ((u64)_1165_3 << 4) | ((u64)_1165_4 << 5) | ((u64)_1165_5 << 6) | ((u64)_1165_6 << 7) | ((u64)_1165_7 << 8) | ((u64)_1165_8 << 9) | ((u64)_1165_9 << 10) | ((u64)_1165_10 << 11) | ((u64)_1165_11 << 12) | ((u64)_1165_12 << 13) | ((u64)_1165_13 << 14) | ((u64)_1165_14 << 15) | ((u64)_1165_15 << 16) | ((u64)_1165_16 << 17) | ((u64)_1165_17 << 18) | ((u64)_1165_18 << 19) | ((u64)_1165_19 << 20) | ((u64)_1165_20 << 21) | ((u64)_1165_21 << 22) | ((u64)_1165_22 << 23) | ((u64)_1165_23 << 24) | ((u64)_1165_24 << 25) | ((u64)_1165_25 << 26) | ((u64)_1165_26 << 27) | ((u64)_1165_27 << 28) | ((u64)_1165_28 << 29) | ((u64)_1165_29 << 30) | ((u64)_1165_30 << 31));
                                                                            e.mem[_nd_138 + 1] = _f_35;
                                                                            u64 _nd_139 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                                                            e.mem[_nd_139 + 0] = 113ull;
                                                                            e.mem[_nd_139 + 1] = term_ctr(CID_SCON, _nd_138);
                                                                            u64 _nd_140 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                                                            e.mem[_nd_140 + 0] = 112ull;
                                                                            e.mem[_nd_140 + 1] = term_ctr(CID_SCON, _nd_139);
                                                                            u64 _nd_141 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                                                            e.mem[_nd_141 + 0] = 111ull;
                                                                            e.mem[_nd_141 + 1] = term_ctr(CID_SCON, _nd_140);
                                                                            u64 _nd_142 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                                                            e.mem[_nd_142 + 0] = 110ull;
                                                                            e.mem[_nd_142 + 1] = term_ctr(CID_SCON, _nd_141);
                                                                            u64 _nd_143 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                                                            e.mem[_nd_143 + 0] = 109ull;
                                                                            e.mem[_nd_143 + 1] = term_ctr(CID_SCON, _nd_142);
                                                                            u64 _nd_144 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                                                            e.mem[_nd_144 + 0] = 108ull;
                                                                            e.mem[_nd_144 + 1] = term_ctr(CID_SCON, _nd_143);
                                                                            u64 _nd_145 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                                                            e.mem[_nd_145 + 0] = 107ull;
                                                                            e.mem[_nd_145 + 1] = term_ctr(CID_SCON, _nd_144);
                                                                            u64 _nd_146 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                                                            e.mem[_nd_146 + 0] = 106ull;
                                                                            e.mem[_nd_146 + 1] = term_ctr(CID_SCON, _nd_145);
                                                                            u64 _nd_147 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                                                            e.mem[_nd_147 + 0] = 105ull;
                                                                            e.mem[_nd_147 + 1] = term_ctr(CID_SCON, _nd_146);
                                                                            u64 _nd_148 = _sp_10 >= HEAP_OFF ? _sp_10 : heap_alloc(e, cls_fit(2));
                                                                            e.mem[_nd_148 + 0] = 104ull;
                                                                            e.mem[_nd_148 + 1] = term_ctr(CID_SCON, _nd_147);
                                                                            u64 _nd_149 = _sp_11 >= HEAP_OFF ? _sp_11 : heap_alloc(e, cls_fit(2));
                                                                            e.mem[_nd_149 + 0] = 103ull;
                                                                            e.mem[_nd_149 + 1] = term_ctr(CID_SCON, _nd_148);
                                                                            u64 _nd_150 = _sp_12 >= HEAP_OFF ? _sp_12 : heap_alloc(e, cls_fit(2));
                                                                            e.mem[_nd_150 + 0] = 102ull;
                                                                            e.mem[_nd_150 + 1] = term_ctr(CID_SCON, _nd_149);
                                                                            u64 _nd_151 = _sp_13 >= HEAP_OFF ? _sp_13 : heap_alloc(e, cls_fit(2));
                                                                            e.mem[_nd_151 + 0] = 101ull;
                                                                            e.mem[_nd_151 + 1] = term_ctr(CID_SCON, _nd_150);
                                                                            u64 _nd_152 = _sp_14 >= HEAP_OFF ? _sp_14 : heap_alloc(e, cls_fit(2));
                                                                            e.mem[_nd_152 + 0] = 100ull;
                                                                            e.mem[_nd_152 + 1] = term_ctr(CID_SCON, _nd_151);
                                                                            u64 _nd_153 = _sp_15 >= HEAP_OFF ? _sp_15 : heap_alloc(e, cls_fit(2));
                                                                            e.mem[_nd_153 + 0] = 99ull;
                                                                            e.mem[_nd_153 + 1] = term_ctr(CID_SCON, _nd_152);
                                                                            u64 _nd_154 = _sp_16 >= HEAP_OFF ? _sp_16 : heap_alloc(e, cls_fit(2));
                                                                            e.mem[_nd_154 + 0] = 98ull;
                                                                            e.mem[_nd_154 + 1] = term_ctr(CID_SCON, _nd_153);
                                                                            u64 _nd_155 = _sp_17 >= HEAP_OFF ? _sp_17 : heap_alloc(e, cls_fit(2));
                                                                            e.mem[_nd_155 + 0] = 97ull;
                                                                            e.mem[_nd_155 + 1] = term_ctr(CID_SCON, _nd_154);
                                                                            if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                                                              u64 _t_7 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                                                              e.mem[_t_7 + 0] = term_ctr(CID_SCON, _nd_155);
                                                                              return term_tsk(FID_G, _t_7);
                                                                            }
                                                                            r0 = term_ctr(CID_SCON, _nd_155);
                                                                            WL_JMP(FID_G);
                                                                          }
                                                                        } else {
                                                                          u64 _nd_156 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                                                          e.mem[_nd_156 + 0] = 113ull;
                                                                          e.mem[_nd_156 + 1] = _f_33;
                                                                          u64 _nd_157 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                                                          e.mem[_nd_157 + 0] = 112ull;
                                                                          e.mem[_nd_157 + 1] = term_ctr(CID_SCON, _nd_156);
                                                                          u64 _nd_158 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                                                          e.mem[_nd_158 + 0] = 111ull;
                                                                          e.mem[_nd_158 + 1] = term_ctr(CID_SCON, _nd_157);
                                                                          u64 _nd_159 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                                                          e.mem[_nd_159 + 0] = 110ull;
                                                                          e.mem[_nd_159 + 1] = term_ctr(CID_SCON, _nd_158);
                                                                          u64 _nd_160 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                                                          e.mem[_nd_160 + 0] = 109ull;
                                                                          e.mem[_nd_160 + 1] = term_ctr(CID_SCON, _nd_159);
                                                                          u64 _nd_161 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                                                          e.mem[_nd_161 + 0] = 108ull;
                                                                          e.mem[_nd_161 + 1] = term_ctr(CID_SCON, _nd_160);
                                                                          u64 _nd_162 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                                                          e.mem[_nd_162 + 0] = 107ull;
                                                                          e.mem[_nd_162 + 1] = term_ctr(CID_SCON, _nd_161);
                                                                          u64 _nd_163 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                                                          e.mem[_nd_163 + 0] = 106ull;
                                                                          e.mem[_nd_163 + 1] = term_ctr(CID_SCON, _nd_162);
                                                                          u64 _nd_164 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                                                          e.mem[_nd_164 + 0] = 105ull;
                                                                          e.mem[_nd_164 + 1] = term_ctr(CID_SCON, _nd_163);
                                                                          u64 _nd_165 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                                                          e.mem[_nd_165 + 0] = 104ull;
                                                                          e.mem[_nd_165 + 1] = term_ctr(CID_SCON, _nd_164);
                                                                          u64 _nd_166 = _sp_10 >= HEAP_OFF ? _sp_10 : heap_alloc(e, cls_fit(2));
                                                                          e.mem[_nd_166 + 0] = 103ull;
                                                                          e.mem[_nd_166 + 1] = term_ctr(CID_SCON, _nd_165);
                                                                          u64 _nd_167 = _sp_11 >= HEAP_OFF ? _sp_11 : heap_alloc(e, cls_fit(2));
                                                                          e.mem[_nd_167 + 0] = 102ull;
                                                                          e.mem[_nd_167 + 1] = term_ctr(CID_SCON, _nd_166);
                                                                          u64 _nd_168 = _sp_12 >= HEAP_OFF ? _sp_12 : heap_alloc(e, cls_fit(2));
                                                                          e.mem[_nd_168 + 0] = 101ull;
                                                                          e.mem[_nd_168 + 1] = term_ctr(CID_SCON, _nd_167);
                                                                          u64 _nd_169 = _sp_13 >= HEAP_OFF ? _sp_13 : heap_alloc(e, cls_fit(2));
                                                                          e.mem[_nd_169 + 0] = 100ull;
                                                                          e.mem[_nd_169 + 1] = term_ctr(CID_SCON, _nd_168);
                                                                          u64 _nd_170 = _sp_14 >= HEAP_OFF ? _sp_14 : heap_alloc(e, cls_fit(2));
                                                                          e.mem[_nd_170 + 0] = 99ull;
                                                                          e.mem[_nd_170 + 1] = term_ctr(CID_SCON, _nd_169);
                                                                          u64 _nd_171 = _sp_15 >= HEAP_OFF ? _sp_15 : heap_alloc(e, cls_fit(2));
                                                                          e.mem[_nd_171 + 0] = 98ull;
                                                                          e.mem[_nd_171 + 1] = term_ctr(CID_SCON, _nd_170);
                                                                          u64 _nd_172 = _sp_16 >= HEAP_OFF ? _sp_16 : heap_alloc(e, cls_fit(2));
                                                                          e.mem[_nd_172 + 0] = 97ull;
                                                                          e.mem[_nd_172 + 1] = term_ctr(CID_SCON, _nd_171);
                                                                          if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                                                            u64 _t_8 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                                                            e.mem[_t_8 + 0] = term_ctr(CID_SCON, _nd_172);
                                                                            return term_tsk(FID_G, _t_8);
                                                                          }
                                                                          r0 = term_ctr(CID_SCON, _nd_172);
                                                                          WL_JMP(FID_G);
                                                                        }
                                                                      } else {
                                                                        u32 _1096_0 = ((_f_32 >> 0) & 1);
                                                                        u32 _1097_0 = ((_f_32 >> 1) & 1);
                                                                        u32 _1097_1 = ((_f_32 >> 2) & 1);
                                                                        u32 _1097_2 = ((_f_32 >> 3) & 1);
                                                                        u32 _1097_3 = ((_f_32 >> 4) & 1);
                                                                        u32 _1097_4 = ((_f_32 >> 5) & 1);
                                                                        u32 _1097_5 = ((_f_32 >> 6) & 1);
                                                                        u32 _1097_6 = ((_f_32 >> 7) & 1);
                                                                        u32 _1097_7 = ((_f_32 >> 8) & 1);
                                                                        u32 _1097_8 = ((_f_32 >> 9) & 1);
                                                                        u32 _1097_9 = ((_f_32 >> 10) & 1);
                                                                        u32 _1097_10 = ((_f_32 >> 11) & 1);
                                                                        u32 _1097_11 = ((_f_32 >> 12) & 1);
                                                                        u32 _1097_12 = ((_f_32 >> 13) & 1);
                                                                        u32 _1097_13 = ((_f_32 >> 14) & 1);
                                                                        u32 _1097_14 = ((_f_32 >> 15) & 1);
                                                                        u32 _1097_15 = ((_f_32 >> 16) & 1);
                                                                        u32 _1097_16 = ((_f_32 >> 17) & 1);
                                                                        u32 _1097_17 = ((_f_32 >> 18) & 1);
                                                                        u32 _1097_18 = ((_f_32 >> 19) & 1);
                                                                        u32 _1097_19 = ((_f_32 >> 20) & 1);
                                                                        u32 _1097_20 = ((_f_32 >> 21) & 1);
                                                                        u32 _1097_21 = ((_f_32 >> 22) & 1);
                                                                        u32 _1097_22 = ((_f_32 >> 23) & 1);
                                                                        u32 _1097_23 = ((_f_32 >> 24) & 1);
                                                                        u32 _1097_24 = ((_f_32 >> 25) & 1);
                                                                        u32 _1097_25 = ((_f_32 >> 26) & 1);
                                                                        u32 _1097_26 = ((_f_32 >> 27) & 1);
                                                                        u32 _1097_27 = ((_f_32 >> 28) & 1);
                                                                        u32 _1097_28 = ((_f_32 >> 29) & 1);
                                                                        u32 _1097_29 = ((_f_32 >> 30) & 1);
                                                                        u32 _1097_30 = ((_f_32 >> 31) & 1);
                                                                        u64 _nd_173 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                                                        e.mem[_nd_173 + 0] = (((u64)_1096_0 << 0) | ((u64)_1097_0 << 1) | ((u64)_1097_1 << 2) | ((u64)_1097_2 << 3) | ((u64)_1097_3 << 4) | ((u64)_1097_4 << 5) | ((u64)_1097_5 << 6) | ((u64)_1097_6 << 7) | ((u64)_1097_7 << 8) | ((u64)_1097_8 << 9) | ((u64)_1097_9 << 10) | ((u64)_1097_10 << 11) | ((u64)_1097_11 << 12) | ((u64)_1097_12 << 13) | ((u64)_1097_13 << 14) | ((u64)_1097_14 << 15) | ((u64)_1097_15 << 16) | ((u64)_1097_16 << 17) | ((u64)_1097_17 << 18) | ((u64)_1097_18 << 19) | ((u64)_1097_19 << 20) | ((u64)_1097_20 << 21) | ((u64)_1097_21 << 22) | ((u64)_1097_22 << 23) | ((u64)_1097_23 << 24) | ((u64)_1097_24 << 25) | ((u64)_1097_25 << 26) | ((u64)_1097_26 << 27) | ((u64)_1097_27 << 28) | ((u64)_1097_28 << 29) | ((u64)_1097_29 << 30) | ((u64)_1097_30 << 31));
                                                                        e.mem[_nd_173 + 1] = _f_33;
                                                                        u64 _nd_174 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                                                        e.mem[_nd_174 + 0] = 112ull;
                                                                        e.mem[_nd_174 + 1] = term_ctr(CID_SCON, _nd_173);
                                                                        u64 _nd_175 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                                                        e.mem[_nd_175 + 0] = 111ull;
                                                                        e.mem[_nd_175 + 1] = term_ctr(CID_SCON, _nd_174);
                                                                        u64 _nd_176 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                                                        e.mem[_nd_176 + 0] = 110ull;
                                                                        e.mem[_nd_176 + 1] = term_ctr(CID_SCON, _nd_175);
                                                                        u64 _nd_177 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                                                        e.mem[_nd_177 + 0] = 109ull;
                                                                        e.mem[_nd_177 + 1] = term_ctr(CID_SCON, _nd_176);
                                                                        u64 _nd_178 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                                                        e.mem[_nd_178 + 0] = 108ull;
                                                                        e.mem[_nd_178 + 1] = term_ctr(CID_SCON, _nd_177);
                                                                        u64 _nd_179 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                                                        e.mem[_nd_179 + 0] = 107ull;
                                                                        e.mem[_nd_179 + 1] = term_ctr(CID_SCON, _nd_178);
                                                                        u64 _nd_180 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                                                        e.mem[_nd_180 + 0] = 106ull;
                                                                        e.mem[_nd_180 + 1] = term_ctr(CID_SCON, _nd_179);
                                                                        u64 _nd_181 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                                                        e.mem[_nd_181 + 0] = 105ull;
                                                                        e.mem[_nd_181 + 1] = term_ctr(CID_SCON, _nd_180);
                                                                        u64 _nd_182 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                                                        e.mem[_nd_182 + 0] = 104ull;
                                                                        e.mem[_nd_182 + 1] = term_ctr(CID_SCON, _nd_181);
                                                                        u64 _nd_183 = _sp_10 >= HEAP_OFF ? _sp_10 : heap_alloc(e, cls_fit(2));
                                                                        e.mem[_nd_183 + 0] = 103ull;
                                                                        e.mem[_nd_183 + 1] = term_ctr(CID_SCON, _nd_182);
                                                                        u64 _nd_184 = _sp_11 >= HEAP_OFF ? _sp_11 : heap_alloc(e, cls_fit(2));
                                                                        e.mem[_nd_184 + 0] = 102ull;
                                                                        e.mem[_nd_184 + 1] = term_ctr(CID_SCON, _nd_183);
                                                                        u64 _nd_185 = _sp_12 >= HEAP_OFF ? _sp_12 : heap_alloc(e, cls_fit(2));
                                                                        e.mem[_nd_185 + 0] = 101ull;
                                                                        e.mem[_nd_185 + 1] = term_ctr(CID_SCON, _nd_184);
                                                                        u64 _nd_186 = _sp_13 >= HEAP_OFF ? _sp_13 : heap_alloc(e, cls_fit(2));
                                                                        e.mem[_nd_186 + 0] = 100ull;
                                                                        e.mem[_nd_186 + 1] = term_ctr(CID_SCON, _nd_185);
                                                                        u64 _nd_187 = _sp_14 >= HEAP_OFF ? _sp_14 : heap_alloc(e, cls_fit(2));
                                                                        e.mem[_nd_187 + 0] = 99ull;
                                                                        e.mem[_nd_187 + 1] = term_ctr(CID_SCON, _nd_186);
                                                                        u64 _nd_188 = _sp_15 >= HEAP_OFF ? _sp_15 : heap_alloc(e, cls_fit(2));
                                                                        e.mem[_nd_188 + 0] = 98ull;
                                                                        e.mem[_nd_188 + 1] = term_ctr(CID_SCON, _nd_187);
                                                                        u64 _nd_189 = _sp_16 >= HEAP_OFF ? _sp_16 : heap_alloc(e, cls_fit(2));
                                                                        e.mem[_nd_189 + 0] = 97ull;
                                                                        e.mem[_nd_189 + 1] = term_ctr(CID_SCON, _nd_188);
                                                                        if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                                                          u64 _t_9 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                                                          e.mem[_t_9 + 0] = term_ctr(CID_SCON, _nd_189);
                                                                          return term_tsk(FID_G, _t_9);
                                                                        }
                                                                        r0 = term_ctr(CID_SCON, _nd_189);
                                                                        WL_JMP(FID_G);
                                                                      }
                                                                    } else {
                                                                      u64 _nd_190 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                                                      e.mem[_nd_190 + 0] = 112ull;
                                                                      e.mem[_nd_190 + 1] = _f_31;
                                                                      u64 _nd_191 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                                                      e.mem[_nd_191 + 0] = 111ull;
                                                                      e.mem[_nd_191 + 1] = term_ctr(CID_SCON, _nd_190);
                                                                      u64 _nd_192 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                                                      e.mem[_nd_192 + 0] = 110ull;
                                                                      e.mem[_nd_192 + 1] = term_ctr(CID_SCON, _nd_191);
                                                                      u64 _nd_193 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                                                      e.mem[_nd_193 + 0] = 109ull;
                                                                      e.mem[_nd_193 + 1] = term_ctr(CID_SCON, _nd_192);
                                                                      u64 _nd_194 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                                                      e.mem[_nd_194 + 0] = 108ull;
                                                                      e.mem[_nd_194 + 1] = term_ctr(CID_SCON, _nd_193);
                                                                      u64 _nd_195 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                                                      e.mem[_nd_195 + 0] = 107ull;
                                                                      e.mem[_nd_195 + 1] = term_ctr(CID_SCON, _nd_194);
                                                                      u64 _nd_196 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                                                      e.mem[_nd_196 + 0] = 106ull;
                                                                      e.mem[_nd_196 + 1] = term_ctr(CID_SCON, _nd_195);
                                                                      u64 _nd_197 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                                                      e.mem[_nd_197 + 0] = 105ull;
                                                                      e.mem[_nd_197 + 1] = term_ctr(CID_SCON, _nd_196);
                                                                      u64 _nd_198 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                                                      e.mem[_nd_198 + 0] = 104ull;
                                                                      e.mem[_nd_198 + 1] = term_ctr(CID_SCON, _nd_197);
                                                                      u64 _nd_199 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                                                      e.mem[_nd_199 + 0] = 103ull;
                                                                      e.mem[_nd_199 + 1] = term_ctr(CID_SCON, _nd_198);
                                                                      u64 _nd_200 = _sp_10 >= HEAP_OFF ? _sp_10 : heap_alloc(e, cls_fit(2));
                                                                      e.mem[_nd_200 + 0] = 102ull;
                                                                      e.mem[_nd_200 + 1] = term_ctr(CID_SCON, _nd_199);
                                                                      u64 _nd_201 = _sp_11 >= HEAP_OFF ? _sp_11 : heap_alloc(e, cls_fit(2));
                                                                      e.mem[_nd_201 + 0] = 101ull;
                                                                      e.mem[_nd_201 + 1] = term_ctr(CID_SCON, _nd_200);
                                                                      u64 _nd_202 = _sp_12 >= HEAP_OFF ? _sp_12 : heap_alloc(e, cls_fit(2));
                                                                      e.mem[_nd_202 + 0] = 100ull;
                                                                      e.mem[_nd_202 + 1] = term_ctr(CID_SCON, _nd_201);
                                                                      u64 _nd_203 = _sp_13 >= HEAP_OFF ? _sp_13 : heap_alloc(e, cls_fit(2));
                                                                      e.mem[_nd_203 + 0] = 99ull;
                                                                      e.mem[_nd_203 + 1] = term_ctr(CID_SCON, _nd_202);
                                                                      u64 _nd_204 = _sp_14 >= HEAP_OFF ? _sp_14 : heap_alloc(e, cls_fit(2));
                                                                      e.mem[_nd_204 + 0] = 98ull;
                                                                      e.mem[_nd_204 + 1] = term_ctr(CID_SCON, _nd_203);
                                                                      u64 _nd_205 = _sp_15 >= HEAP_OFF ? _sp_15 : heap_alloc(e, cls_fit(2));
                                                                      e.mem[_nd_205 + 0] = 97ull;
                                                                      e.mem[_nd_205 + 1] = term_ctr(CID_SCON, _nd_204);
                                                                      if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                                                        u64 _t_10 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                                                        e.mem[_t_10 + 0] = term_ctr(CID_SCON, _nd_205);
                                                                        return term_tsk(FID_G, _t_10);
                                                                      }
                                                                      r0 = term_ctr(CID_SCON, _nd_205);
                                                                      WL_JMP(FID_G);
                                                                    }
                                                                  } else {
                                                                    u32 _1028_0 = ((_f_30 >> 0) & 1);
                                                                    u32 _1029_0 = ((_f_30 >> 1) & 1);
                                                                    u32 _1029_1 = ((_f_30 >> 2) & 1);
                                                                    u32 _1029_2 = ((_f_30 >> 3) & 1);
                                                                    u32 _1029_3 = ((_f_30 >> 4) & 1);
                                                                    u32 _1029_4 = ((_f_30 >> 5) & 1);
                                                                    u32 _1029_5 = ((_f_30 >> 6) & 1);
                                                                    u32 _1029_6 = ((_f_30 >> 7) & 1);
                                                                    u32 _1029_7 = ((_f_30 >> 8) & 1);
                                                                    u32 _1029_8 = ((_f_30 >> 9) & 1);
                                                                    u32 _1029_9 = ((_f_30 >> 10) & 1);
                                                                    u32 _1029_10 = ((_f_30 >> 11) & 1);
                                                                    u32 _1029_11 = ((_f_30 >> 12) & 1);
                                                                    u32 _1029_12 = ((_f_30 >> 13) & 1);
                                                                    u32 _1029_13 = ((_f_30 >> 14) & 1);
                                                                    u32 _1029_14 = ((_f_30 >> 15) & 1);
                                                                    u32 _1029_15 = ((_f_30 >> 16) & 1);
                                                                    u32 _1029_16 = ((_f_30 >> 17) & 1);
                                                                    u32 _1029_17 = ((_f_30 >> 18) & 1);
                                                                    u32 _1029_18 = ((_f_30 >> 19) & 1);
                                                                    u32 _1029_19 = ((_f_30 >> 20) & 1);
                                                                    u32 _1029_20 = ((_f_30 >> 21) & 1);
                                                                    u32 _1029_21 = ((_f_30 >> 22) & 1);
                                                                    u32 _1029_22 = ((_f_30 >> 23) & 1);
                                                                    u32 _1029_23 = ((_f_30 >> 24) & 1);
                                                                    u32 _1029_24 = ((_f_30 >> 25) & 1);
                                                                    u32 _1029_25 = ((_f_30 >> 26) & 1);
                                                                    u32 _1029_26 = ((_f_30 >> 27) & 1);
                                                                    u32 _1029_27 = ((_f_30 >> 28) & 1);
                                                                    u32 _1029_28 = ((_f_30 >> 29) & 1);
                                                                    u32 _1029_29 = ((_f_30 >> 30) & 1);
                                                                    u32 _1029_30 = ((_f_30 >> 31) & 1);
                                                                    u64 _nd_206 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                                                    e.mem[_nd_206 + 0] = (((u64)_1028_0 << 0) | ((u64)_1029_0 << 1) | ((u64)_1029_1 << 2) | ((u64)_1029_2 << 3) | ((u64)_1029_3 << 4) | ((u64)_1029_4 << 5) | ((u64)_1029_5 << 6) | ((u64)_1029_6 << 7) | ((u64)_1029_7 << 8) | ((u64)_1029_8 << 9) | ((u64)_1029_9 << 10) | ((u64)_1029_10 << 11) | ((u64)_1029_11 << 12) | ((u64)_1029_12 << 13) | ((u64)_1029_13 << 14) | ((u64)_1029_14 << 15) | ((u64)_1029_15 << 16) | ((u64)_1029_16 << 17) | ((u64)_1029_17 << 18) | ((u64)_1029_18 << 19) | ((u64)_1029_19 << 20) | ((u64)_1029_20 << 21) | ((u64)_1029_21 << 22) | ((u64)_1029_22 << 23) | ((u64)_1029_23 << 24) | ((u64)_1029_24 << 25) | ((u64)_1029_25 << 26) | ((u64)_1029_26 << 27) | ((u64)_1029_27 << 28) | ((u64)_1029_28 << 29) | ((u64)_1029_29 << 30) | ((u64)_1029_30 << 31));
                                                                    e.mem[_nd_206 + 1] = _f_31;
                                                                    u64 _nd_207 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                                                    e.mem[_nd_207 + 0] = 111ull;
                                                                    e.mem[_nd_207 + 1] = term_ctr(CID_SCON, _nd_206);
                                                                    u64 _nd_208 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                                                    e.mem[_nd_208 + 0] = 110ull;
                                                                    e.mem[_nd_208 + 1] = term_ctr(CID_SCON, _nd_207);
                                                                    u64 _nd_209 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                                                    e.mem[_nd_209 + 0] = 109ull;
                                                                    e.mem[_nd_209 + 1] = term_ctr(CID_SCON, _nd_208);
                                                                    u64 _nd_210 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                                                    e.mem[_nd_210 + 0] = 108ull;
                                                                    e.mem[_nd_210 + 1] = term_ctr(CID_SCON, _nd_209);
                                                                    u64 _nd_211 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                                                    e.mem[_nd_211 + 0] = 107ull;
                                                                    e.mem[_nd_211 + 1] = term_ctr(CID_SCON, _nd_210);
                                                                    u64 _nd_212 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                                                    e.mem[_nd_212 + 0] = 106ull;
                                                                    e.mem[_nd_212 + 1] = term_ctr(CID_SCON, _nd_211);
                                                                    u64 _nd_213 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                                                    e.mem[_nd_213 + 0] = 105ull;
                                                                    e.mem[_nd_213 + 1] = term_ctr(CID_SCON, _nd_212);
                                                                    u64 _nd_214 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                                                    e.mem[_nd_214 + 0] = 104ull;
                                                                    e.mem[_nd_214 + 1] = term_ctr(CID_SCON, _nd_213);
                                                                    u64 _nd_215 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                                                    e.mem[_nd_215 + 0] = 103ull;
                                                                    e.mem[_nd_215 + 1] = term_ctr(CID_SCON, _nd_214);
                                                                    u64 _nd_216 = _sp_10 >= HEAP_OFF ? _sp_10 : heap_alloc(e, cls_fit(2));
                                                                    e.mem[_nd_216 + 0] = 102ull;
                                                                    e.mem[_nd_216 + 1] = term_ctr(CID_SCON, _nd_215);
                                                                    u64 _nd_217 = _sp_11 >= HEAP_OFF ? _sp_11 : heap_alloc(e, cls_fit(2));
                                                                    e.mem[_nd_217 + 0] = 101ull;
                                                                    e.mem[_nd_217 + 1] = term_ctr(CID_SCON, _nd_216);
                                                                    u64 _nd_218 = _sp_12 >= HEAP_OFF ? _sp_12 : heap_alloc(e, cls_fit(2));
                                                                    e.mem[_nd_218 + 0] = 100ull;
                                                                    e.mem[_nd_218 + 1] = term_ctr(CID_SCON, _nd_217);
                                                                    u64 _nd_219 = _sp_13 >= HEAP_OFF ? _sp_13 : heap_alloc(e, cls_fit(2));
                                                                    e.mem[_nd_219 + 0] = 99ull;
                                                                    e.mem[_nd_219 + 1] = term_ctr(CID_SCON, _nd_218);
                                                                    u64 _nd_220 = _sp_14 >= HEAP_OFF ? _sp_14 : heap_alloc(e, cls_fit(2));
                                                                    e.mem[_nd_220 + 0] = 98ull;
                                                                    e.mem[_nd_220 + 1] = term_ctr(CID_SCON, _nd_219);
                                                                    u64 _nd_221 = _sp_15 >= HEAP_OFF ? _sp_15 : heap_alloc(e, cls_fit(2));
                                                                    e.mem[_nd_221 + 0] = 97ull;
                                                                    e.mem[_nd_221 + 1] = term_ctr(CID_SCON, _nd_220);
                                                                    if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                                                      u64 _t_11 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                                                      e.mem[_t_11 + 0] = term_ctr(CID_SCON, _nd_221);
                                                                      return term_tsk(FID_G, _t_11);
                                                                    }
                                                                    r0 = term_ctr(CID_SCON, _nd_221);
                                                                    WL_JMP(FID_G);
                                                                  }
                                                                } else {
                                                                  u64 _nd_222 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                                                  e.mem[_nd_222 + 0] = 111ull;
                                                                  e.mem[_nd_222 + 1] = _f_29;
                                                                  u64 _nd_223 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                                                  e.mem[_nd_223 + 0] = 110ull;
                                                                  e.mem[_nd_223 + 1] = term_ctr(CID_SCON, _nd_222);
                                                                  u64 _nd_224 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                                                  e.mem[_nd_224 + 0] = 109ull;
                                                                  e.mem[_nd_224 + 1] = term_ctr(CID_SCON, _nd_223);
                                                                  u64 _nd_225 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                                                  e.mem[_nd_225 + 0] = 108ull;
                                                                  e.mem[_nd_225 + 1] = term_ctr(CID_SCON, _nd_224);
                                                                  u64 _nd_226 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                                                  e.mem[_nd_226 + 0] = 107ull;
                                                                  e.mem[_nd_226 + 1] = term_ctr(CID_SCON, _nd_225);
                                                                  u64 _nd_227 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                                                  e.mem[_nd_227 + 0] = 106ull;
                                                                  e.mem[_nd_227 + 1] = term_ctr(CID_SCON, _nd_226);
                                                                  u64 _nd_228 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                                                  e.mem[_nd_228 + 0] = 105ull;
                                                                  e.mem[_nd_228 + 1] = term_ctr(CID_SCON, _nd_227);
                                                                  u64 _nd_229 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                                                  e.mem[_nd_229 + 0] = 104ull;
                                                                  e.mem[_nd_229 + 1] = term_ctr(CID_SCON, _nd_228);
                                                                  u64 _nd_230 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                                                  e.mem[_nd_230 + 0] = 103ull;
                                                                  e.mem[_nd_230 + 1] = term_ctr(CID_SCON, _nd_229);
                                                                  u64 _nd_231 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                                                  e.mem[_nd_231 + 0] = 102ull;
                                                                  e.mem[_nd_231 + 1] = term_ctr(CID_SCON, _nd_230);
                                                                  u64 _nd_232 = _sp_10 >= HEAP_OFF ? _sp_10 : heap_alloc(e, cls_fit(2));
                                                                  e.mem[_nd_232 + 0] = 101ull;
                                                                  e.mem[_nd_232 + 1] = term_ctr(CID_SCON, _nd_231);
                                                                  u64 _nd_233 = _sp_11 >= HEAP_OFF ? _sp_11 : heap_alloc(e, cls_fit(2));
                                                                  e.mem[_nd_233 + 0] = 100ull;
                                                                  e.mem[_nd_233 + 1] = term_ctr(CID_SCON, _nd_232);
                                                                  u64 _nd_234 = _sp_12 >= HEAP_OFF ? _sp_12 : heap_alloc(e, cls_fit(2));
                                                                  e.mem[_nd_234 + 0] = 99ull;
                                                                  e.mem[_nd_234 + 1] = term_ctr(CID_SCON, _nd_233);
                                                                  u64 _nd_235 = _sp_13 >= HEAP_OFF ? _sp_13 : heap_alloc(e, cls_fit(2));
                                                                  e.mem[_nd_235 + 0] = 98ull;
                                                                  e.mem[_nd_235 + 1] = term_ctr(CID_SCON, _nd_234);
                                                                  u64 _nd_236 = _sp_14 >= HEAP_OFF ? _sp_14 : heap_alloc(e, cls_fit(2));
                                                                  e.mem[_nd_236 + 0] = 97ull;
                                                                  e.mem[_nd_236 + 1] = term_ctr(CID_SCON, _nd_235);
                                                                  if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                                                    u64 _t_12 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                                                    e.mem[_t_12 + 0] = term_ctr(CID_SCON, _nd_236);
                                                                    return term_tsk(FID_G, _t_12);
                                                                  }
                                                                  r0 = term_ctr(CID_SCON, _nd_236);
                                                                  WL_JMP(FID_G);
                                                                }
                                                              } else {
                                                                u32 _960_0 = ((_f_28 >> 0) & 1);
                                                                u32 _961_0 = ((_f_28 >> 1) & 1);
                                                                u32 _961_1 = ((_f_28 >> 2) & 1);
                                                                u32 _961_2 = ((_f_28 >> 3) & 1);
                                                                u32 _961_3 = ((_f_28 >> 4) & 1);
                                                                u32 _961_4 = ((_f_28 >> 5) & 1);
                                                                u32 _961_5 = ((_f_28 >> 6) & 1);
                                                                u32 _961_6 = ((_f_28 >> 7) & 1);
                                                                u32 _961_7 = ((_f_28 >> 8) & 1);
                                                                u32 _961_8 = ((_f_28 >> 9) & 1);
                                                                u32 _961_9 = ((_f_28 >> 10) & 1);
                                                                u32 _961_10 = ((_f_28 >> 11) & 1);
                                                                u32 _961_11 = ((_f_28 >> 12) & 1);
                                                                u32 _961_12 = ((_f_28 >> 13) & 1);
                                                                u32 _961_13 = ((_f_28 >> 14) & 1);
                                                                u32 _961_14 = ((_f_28 >> 15) & 1);
                                                                u32 _961_15 = ((_f_28 >> 16) & 1);
                                                                u32 _961_16 = ((_f_28 >> 17) & 1);
                                                                u32 _961_17 = ((_f_28 >> 18) & 1);
                                                                u32 _961_18 = ((_f_28 >> 19) & 1);
                                                                u32 _961_19 = ((_f_28 >> 20) & 1);
                                                                u32 _961_20 = ((_f_28 >> 21) & 1);
                                                                u32 _961_21 = ((_f_28 >> 22) & 1);
                                                                u32 _961_22 = ((_f_28 >> 23) & 1);
                                                                u32 _961_23 = ((_f_28 >> 24) & 1);
                                                                u32 _961_24 = ((_f_28 >> 25) & 1);
                                                                u32 _961_25 = ((_f_28 >> 26) & 1);
                                                                u32 _961_26 = ((_f_28 >> 27) & 1);
                                                                u32 _961_27 = ((_f_28 >> 28) & 1);
                                                                u32 _961_28 = ((_f_28 >> 29) & 1);
                                                                u32 _961_29 = ((_f_28 >> 30) & 1);
                                                                u32 _961_30 = ((_f_28 >> 31) & 1);
                                                                u64 _nd_237 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                                                e.mem[_nd_237 + 0] = (((u64)_960_0 << 0) | ((u64)_961_0 << 1) | ((u64)_961_1 << 2) | ((u64)_961_2 << 3) | ((u64)_961_3 << 4) | ((u64)_961_4 << 5) | ((u64)_961_5 << 6) | ((u64)_961_6 << 7) | ((u64)_961_7 << 8) | ((u64)_961_8 << 9) | ((u64)_961_9 << 10) | ((u64)_961_10 << 11) | ((u64)_961_11 << 12) | ((u64)_961_12 << 13) | ((u64)_961_13 << 14) | ((u64)_961_14 << 15) | ((u64)_961_15 << 16) | ((u64)_961_16 << 17) | ((u64)_961_17 << 18) | ((u64)_961_18 << 19) | ((u64)_961_19 << 20) | ((u64)_961_20 << 21) | ((u64)_961_21 << 22) | ((u64)_961_22 << 23) | ((u64)_961_23 << 24) | ((u64)_961_24 << 25) | ((u64)_961_25 << 26) | ((u64)_961_26 << 27) | ((u64)_961_27 << 28) | ((u64)_961_28 << 29) | ((u64)_961_29 << 30) | ((u64)_961_30 << 31));
                                                                e.mem[_nd_237 + 1] = _f_29;
                                                                u64 _nd_238 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                                                e.mem[_nd_238 + 0] = 110ull;
                                                                e.mem[_nd_238 + 1] = term_ctr(CID_SCON, _nd_237);
                                                                u64 _nd_239 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                                                e.mem[_nd_239 + 0] = 109ull;
                                                                e.mem[_nd_239 + 1] = term_ctr(CID_SCON, _nd_238);
                                                                u64 _nd_240 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                                                e.mem[_nd_240 + 0] = 108ull;
                                                                e.mem[_nd_240 + 1] = term_ctr(CID_SCON, _nd_239);
                                                                u64 _nd_241 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                                                e.mem[_nd_241 + 0] = 107ull;
                                                                e.mem[_nd_241 + 1] = term_ctr(CID_SCON, _nd_240);
                                                                u64 _nd_242 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                                                e.mem[_nd_242 + 0] = 106ull;
                                                                e.mem[_nd_242 + 1] = term_ctr(CID_SCON, _nd_241);
                                                                u64 _nd_243 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                                                e.mem[_nd_243 + 0] = 105ull;
                                                                e.mem[_nd_243 + 1] = term_ctr(CID_SCON, _nd_242);
                                                                u64 _nd_244 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                                                e.mem[_nd_244 + 0] = 104ull;
                                                                e.mem[_nd_244 + 1] = term_ctr(CID_SCON, _nd_243);
                                                                u64 _nd_245 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                                                e.mem[_nd_245 + 0] = 103ull;
                                                                e.mem[_nd_245 + 1] = term_ctr(CID_SCON, _nd_244);
                                                                u64 _nd_246 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                                                e.mem[_nd_246 + 0] = 102ull;
                                                                e.mem[_nd_246 + 1] = term_ctr(CID_SCON, _nd_245);
                                                                u64 _nd_247 = _sp_10 >= HEAP_OFF ? _sp_10 : heap_alloc(e, cls_fit(2));
                                                                e.mem[_nd_247 + 0] = 101ull;
                                                                e.mem[_nd_247 + 1] = term_ctr(CID_SCON, _nd_246);
                                                                u64 _nd_248 = _sp_11 >= HEAP_OFF ? _sp_11 : heap_alloc(e, cls_fit(2));
                                                                e.mem[_nd_248 + 0] = 100ull;
                                                                e.mem[_nd_248 + 1] = term_ctr(CID_SCON, _nd_247);
                                                                u64 _nd_249 = _sp_12 >= HEAP_OFF ? _sp_12 : heap_alloc(e, cls_fit(2));
                                                                e.mem[_nd_249 + 0] = 99ull;
                                                                e.mem[_nd_249 + 1] = term_ctr(CID_SCON, _nd_248);
                                                                u64 _nd_250 = _sp_13 >= HEAP_OFF ? _sp_13 : heap_alloc(e, cls_fit(2));
                                                                e.mem[_nd_250 + 0] = 98ull;
                                                                e.mem[_nd_250 + 1] = term_ctr(CID_SCON, _nd_249);
                                                                u64 _nd_251 = _sp_14 >= HEAP_OFF ? _sp_14 : heap_alloc(e, cls_fit(2));
                                                                e.mem[_nd_251 + 0] = 97ull;
                                                                e.mem[_nd_251 + 1] = term_ctr(CID_SCON, _nd_250);
                                                                if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                                                  u64 _t_13 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                                                  e.mem[_t_13 + 0] = term_ctr(CID_SCON, _nd_251);
                                                                  return term_tsk(FID_G, _t_13);
                                                                }
                                                                r0 = term_ctr(CID_SCON, _nd_251);
                                                                WL_JMP(FID_G);
                                                              }
                                                            } else {
                                                              u64 _nd_252 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                                              e.mem[_nd_252 + 0] = 110ull;
                                                              e.mem[_nd_252 + 1] = _f_27;
                                                              u64 _nd_253 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                                              e.mem[_nd_253 + 0] = 109ull;
                                                              e.mem[_nd_253 + 1] = term_ctr(CID_SCON, _nd_252);
                                                              u64 _nd_254 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                                              e.mem[_nd_254 + 0] = 108ull;
                                                              e.mem[_nd_254 + 1] = term_ctr(CID_SCON, _nd_253);
                                                              u64 _nd_255 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                                              e.mem[_nd_255 + 0] = 107ull;
                                                              e.mem[_nd_255 + 1] = term_ctr(CID_SCON, _nd_254);
                                                              u64 _nd_256 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                                              e.mem[_nd_256 + 0] = 106ull;
                                                              e.mem[_nd_256 + 1] = term_ctr(CID_SCON, _nd_255);
                                                              u64 _nd_257 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                                              e.mem[_nd_257 + 0] = 105ull;
                                                              e.mem[_nd_257 + 1] = term_ctr(CID_SCON, _nd_256);
                                                              u64 _nd_258 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                                              e.mem[_nd_258 + 0] = 104ull;
                                                              e.mem[_nd_258 + 1] = term_ctr(CID_SCON, _nd_257);
                                                              u64 _nd_259 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                                              e.mem[_nd_259 + 0] = 103ull;
                                                              e.mem[_nd_259 + 1] = term_ctr(CID_SCON, _nd_258);
                                                              u64 _nd_260 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                                              e.mem[_nd_260 + 0] = 102ull;
                                                              e.mem[_nd_260 + 1] = term_ctr(CID_SCON, _nd_259);
                                                              u64 _nd_261 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                                              e.mem[_nd_261 + 0] = 101ull;
                                                              e.mem[_nd_261 + 1] = term_ctr(CID_SCON, _nd_260);
                                                              u64 _nd_262 = _sp_10 >= HEAP_OFF ? _sp_10 : heap_alloc(e, cls_fit(2));
                                                              e.mem[_nd_262 + 0] = 100ull;
                                                              e.mem[_nd_262 + 1] = term_ctr(CID_SCON, _nd_261);
                                                              u64 _nd_263 = _sp_11 >= HEAP_OFF ? _sp_11 : heap_alloc(e, cls_fit(2));
                                                              e.mem[_nd_263 + 0] = 99ull;
                                                              e.mem[_nd_263 + 1] = term_ctr(CID_SCON, _nd_262);
                                                              u64 _nd_264 = _sp_12 >= HEAP_OFF ? _sp_12 : heap_alloc(e, cls_fit(2));
                                                              e.mem[_nd_264 + 0] = 98ull;
                                                              e.mem[_nd_264 + 1] = term_ctr(CID_SCON, _nd_263);
                                                              u64 _nd_265 = _sp_13 >= HEAP_OFF ? _sp_13 : heap_alloc(e, cls_fit(2));
                                                              e.mem[_nd_265 + 0] = 97ull;
                                                              e.mem[_nd_265 + 1] = term_ctr(CID_SCON, _nd_264);
                                                              if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                                                u64 _t_14 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                                                e.mem[_t_14 + 0] = term_ctr(CID_SCON, _nd_265);
                                                                return term_tsk(FID_G, _t_14);
                                                              }
                                                              r0 = term_ctr(CID_SCON, _nd_265);
                                                              WL_JMP(FID_G);
                                                            }
                                                          } else {
                                                            u32 _892_0 = ((_f_26 >> 0) & 1);
                                                            u32 _893_0 = ((_f_26 >> 1) & 1);
                                                            u32 _893_1 = ((_f_26 >> 2) & 1);
                                                            u32 _893_2 = ((_f_26 >> 3) & 1);
                                                            u32 _893_3 = ((_f_26 >> 4) & 1);
                                                            u32 _893_4 = ((_f_26 >> 5) & 1);
                                                            u32 _893_5 = ((_f_26 >> 6) & 1);
                                                            u32 _893_6 = ((_f_26 >> 7) & 1);
                                                            u32 _893_7 = ((_f_26 >> 8) & 1);
                                                            u32 _893_8 = ((_f_26 >> 9) & 1);
                                                            u32 _893_9 = ((_f_26 >> 10) & 1);
                                                            u32 _893_10 = ((_f_26 >> 11) & 1);
                                                            u32 _893_11 = ((_f_26 >> 12) & 1);
                                                            u32 _893_12 = ((_f_26 >> 13) & 1);
                                                            u32 _893_13 = ((_f_26 >> 14) & 1);
                                                            u32 _893_14 = ((_f_26 >> 15) & 1);
                                                            u32 _893_15 = ((_f_26 >> 16) & 1);
                                                            u32 _893_16 = ((_f_26 >> 17) & 1);
                                                            u32 _893_17 = ((_f_26 >> 18) & 1);
                                                            u32 _893_18 = ((_f_26 >> 19) & 1);
                                                            u32 _893_19 = ((_f_26 >> 20) & 1);
                                                            u32 _893_20 = ((_f_26 >> 21) & 1);
                                                            u32 _893_21 = ((_f_26 >> 22) & 1);
                                                            u32 _893_22 = ((_f_26 >> 23) & 1);
                                                            u32 _893_23 = ((_f_26 >> 24) & 1);
                                                            u32 _893_24 = ((_f_26 >> 25) & 1);
                                                            u32 _893_25 = ((_f_26 >> 26) & 1);
                                                            u32 _893_26 = ((_f_26 >> 27) & 1);
                                                            u32 _893_27 = ((_f_26 >> 28) & 1);
                                                            u32 _893_28 = ((_f_26 >> 29) & 1);
                                                            u32 _893_29 = ((_f_26 >> 30) & 1);
                                                            u32 _893_30 = ((_f_26 >> 31) & 1);
                                                            u64 _nd_266 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                                            e.mem[_nd_266 + 0] = (((u64)_892_0 << 0) | ((u64)_893_0 << 1) | ((u64)_893_1 << 2) | ((u64)_893_2 << 3) | ((u64)_893_3 << 4) | ((u64)_893_4 << 5) | ((u64)_893_5 << 6) | ((u64)_893_6 << 7) | ((u64)_893_7 << 8) | ((u64)_893_8 << 9) | ((u64)_893_9 << 10) | ((u64)_893_10 << 11) | ((u64)_893_11 << 12) | ((u64)_893_12 << 13) | ((u64)_893_13 << 14) | ((u64)_893_14 << 15) | ((u64)_893_15 << 16) | ((u64)_893_16 << 17) | ((u64)_893_17 << 18) | ((u64)_893_18 << 19) | ((u64)_893_19 << 20) | ((u64)_893_20 << 21) | ((u64)_893_21 << 22) | ((u64)_893_22 << 23) | ((u64)_893_23 << 24) | ((u64)_893_24 << 25) | ((u64)_893_25 << 26) | ((u64)_893_26 << 27) | ((u64)_893_27 << 28) | ((u64)_893_28 << 29) | ((u64)_893_29 << 30) | ((u64)_893_30 << 31));
                                                            e.mem[_nd_266 + 1] = _f_27;
                                                            u64 _nd_267 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                                            e.mem[_nd_267 + 0] = 109ull;
                                                            e.mem[_nd_267 + 1] = term_ctr(CID_SCON, _nd_266);
                                                            u64 _nd_268 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                                            e.mem[_nd_268 + 0] = 108ull;
                                                            e.mem[_nd_268 + 1] = term_ctr(CID_SCON, _nd_267);
                                                            u64 _nd_269 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                                            e.mem[_nd_269 + 0] = 107ull;
                                                            e.mem[_nd_269 + 1] = term_ctr(CID_SCON, _nd_268);
                                                            u64 _nd_270 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                                            e.mem[_nd_270 + 0] = 106ull;
                                                            e.mem[_nd_270 + 1] = term_ctr(CID_SCON, _nd_269);
                                                            u64 _nd_271 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                                            e.mem[_nd_271 + 0] = 105ull;
                                                            e.mem[_nd_271 + 1] = term_ctr(CID_SCON, _nd_270);
                                                            u64 _nd_272 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                                            e.mem[_nd_272 + 0] = 104ull;
                                                            e.mem[_nd_272 + 1] = term_ctr(CID_SCON, _nd_271);
                                                            u64 _nd_273 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                                            e.mem[_nd_273 + 0] = 103ull;
                                                            e.mem[_nd_273 + 1] = term_ctr(CID_SCON, _nd_272);
                                                            u64 _nd_274 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                                            e.mem[_nd_274 + 0] = 102ull;
                                                            e.mem[_nd_274 + 1] = term_ctr(CID_SCON, _nd_273);
                                                            u64 _nd_275 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                                            e.mem[_nd_275 + 0] = 101ull;
                                                            e.mem[_nd_275 + 1] = term_ctr(CID_SCON, _nd_274);
                                                            u64 _nd_276 = _sp_10 >= HEAP_OFF ? _sp_10 : heap_alloc(e, cls_fit(2));
                                                            e.mem[_nd_276 + 0] = 100ull;
                                                            e.mem[_nd_276 + 1] = term_ctr(CID_SCON, _nd_275);
                                                            u64 _nd_277 = _sp_11 >= HEAP_OFF ? _sp_11 : heap_alloc(e, cls_fit(2));
                                                            e.mem[_nd_277 + 0] = 99ull;
                                                            e.mem[_nd_277 + 1] = term_ctr(CID_SCON, _nd_276);
                                                            u64 _nd_278 = _sp_12 >= HEAP_OFF ? _sp_12 : heap_alloc(e, cls_fit(2));
                                                            e.mem[_nd_278 + 0] = 98ull;
                                                            e.mem[_nd_278 + 1] = term_ctr(CID_SCON, _nd_277);
                                                            u64 _nd_279 = _sp_13 >= HEAP_OFF ? _sp_13 : heap_alloc(e, cls_fit(2));
                                                            e.mem[_nd_279 + 0] = 97ull;
                                                            e.mem[_nd_279 + 1] = term_ctr(CID_SCON, _nd_278);
                                                            if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                                              u64 _t_15 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                                              e.mem[_t_15 + 0] = term_ctr(CID_SCON, _nd_279);
                                                              return term_tsk(FID_G, _t_15);
                                                            }
                                                            r0 = term_ctr(CID_SCON, _nd_279);
                                                            WL_JMP(FID_G);
                                                          }
                                                        } else {
                                                          spare_free(e, cls_fit(2), _sp_12);
                                                          spare_free(e, cls_fit(2), _sp_11);
                                                          spare_free(e, cls_fit(2), _sp_10);
                                                          spare_free(e, cls_fit(2), _sp_9);
                                                          spare_free(e, cls_fit(2), _sp_8);
                                                          spare_free(e, cls_fit(2), _sp_7);
                                                          spare_free(e, cls_fit(2), _sp_6);
                                                          spare_free(e, cls_fit(2), _sp_5);
                                                          spare_free(e, cls_fit(2), _sp_4);
                                                          spare_free(e, cls_fit(2), _sp_3);
                                                          spare_free(e, cls_fit(2), _sp_2);
                                                          spare_free(e, cls_fit(2), _sp_1);
                                                          spare_free(e, cls_fit(2), _sp_0);
                                                          r0 = 13ull;
                                                          WL_RETN(1);
                                                        }
                                                      } else {
                                                        u32 _824_0 = ((_f_24 >> 0) & 1);
                                                        u32 _825_0 = ((_f_24 >> 1) & 1);
                                                        u32 _825_1 = ((_f_24 >> 2) & 1);
                                                        u32 _825_2 = ((_f_24 >> 3) & 1);
                                                        u32 _825_3 = ((_f_24 >> 4) & 1);
                                                        u32 _825_4 = ((_f_24 >> 5) & 1);
                                                        u32 _825_5 = ((_f_24 >> 6) & 1);
                                                        u32 _825_6 = ((_f_24 >> 7) & 1);
                                                        u32 _825_7 = ((_f_24 >> 8) & 1);
                                                        u32 _825_8 = ((_f_24 >> 9) & 1);
                                                        u32 _825_9 = ((_f_24 >> 10) & 1);
                                                        u32 _825_10 = ((_f_24 >> 11) & 1);
                                                        u32 _825_11 = ((_f_24 >> 12) & 1);
                                                        u32 _825_12 = ((_f_24 >> 13) & 1);
                                                        u32 _825_13 = ((_f_24 >> 14) & 1);
                                                        u32 _825_14 = ((_f_24 >> 15) & 1);
                                                        u32 _825_15 = ((_f_24 >> 16) & 1);
                                                        u32 _825_16 = ((_f_24 >> 17) & 1);
                                                        u32 _825_17 = ((_f_24 >> 18) & 1);
                                                        u32 _825_18 = ((_f_24 >> 19) & 1);
                                                        u32 _825_19 = ((_f_24 >> 20) & 1);
                                                        u32 _825_20 = ((_f_24 >> 21) & 1);
                                                        u32 _825_21 = ((_f_24 >> 22) & 1);
                                                        u32 _825_22 = ((_f_24 >> 23) & 1);
                                                        u32 _825_23 = ((_f_24 >> 24) & 1);
                                                        u32 _825_24 = ((_f_24 >> 25) & 1);
                                                        u32 _825_25 = ((_f_24 >> 26) & 1);
                                                        u32 _825_26 = ((_f_24 >> 27) & 1);
                                                        u32 _825_27 = ((_f_24 >> 28) & 1);
                                                        u32 _825_28 = ((_f_24 >> 29) & 1);
                                                        u32 _825_29 = ((_f_24 >> 30) & 1);
                                                        u32 _825_30 = ((_f_24 >> 31) & 1);
                                                        u64 _nd_280 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                                        e.mem[_nd_280 + 0] = (((u64)_824_0 << 0) | ((u64)_825_0 << 1) | ((u64)_825_1 << 2) | ((u64)_825_2 << 3) | ((u64)_825_3 << 4) | ((u64)_825_4 << 5) | ((u64)_825_5 << 6) | ((u64)_825_6 << 7) | ((u64)_825_7 << 8) | ((u64)_825_8 << 9) | ((u64)_825_9 << 10) | ((u64)_825_10 << 11) | ((u64)_825_11 << 12) | ((u64)_825_12 << 13) | ((u64)_825_13 << 14) | ((u64)_825_14 << 15) | ((u64)_825_15 << 16) | ((u64)_825_16 << 17) | ((u64)_825_17 << 18) | ((u64)_825_18 << 19) | ((u64)_825_19 << 20) | ((u64)_825_20 << 21) | ((u64)_825_21 << 22) | ((u64)_825_22 << 23) | ((u64)_825_23 << 24) | ((u64)_825_24 << 25) | ((u64)_825_25 << 26) | ((u64)_825_26 << 27) | ((u64)_825_27 << 28) | ((u64)_825_28 << 29) | ((u64)_825_29 << 30) | ((u64)_825_30 << 31));
                                                        e.mem[_nd_280 + 1] = _f_25;
                                                        u64 _nd_281 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                                        e.mem[_nd_281 + 0] = 108ull;
                                                        e.mem[_nd_281 + 1] = term_ctr(CID_SCON, _nd_280);
                                                        u64 _nd_282 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                                        e.mem[_nd_282 + 0] = 107ull;
                                                        e.mem[_nd_282 + 1] = term_ctr(CID_SCON, _nd_281);
                                                        u64 _nd_283 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                                        e.mem[_nd_283 + 0] = 106ull;
                                                        e.mem[_nd_283 + 1] = term_ctr(CID_SCON, _nd_282);
                                                        u64 _nd_284 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                                        e.mem[_nd_284 + 0] = 105ull;
                                                        e.mem[_nd_284 + 1] = term_ctr(CID_SCON, _nd_283);
                                                        u64 _nd_285 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                                        e.mem[_nd_285 + 0] = 104ull;
                                                        e.mem[_nd_285 + 1] = term_ctr(CID_SCON, _nd_284);
                                                        u64 _nd_286 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                                        e.mem[_nd_286 + 0] = 103ull;
                                                        e.mem[_nd_286 + 1] = term_ctr(CID_SCON, _nd_285);
                                                        u64 _nd_287 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                                        e.mem[_nd_287 + 0] = 102ull;
                                                        e.mem[_nd_287 + 1] = term_ctr(CID_SCON, _nd_286);
                                                        u64 _nd_288 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                                        e.mem[_nd_288 + 0] = 101ull;
                                                        e.mem[_nd_288 + 1] = term_ctr(CID_SCON, _nd_287);
                                                        u64 _nd_289 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                                        e.mem[_nd_289 + 0] = 100ull;
                                                        e.mem[_nd_289 + 1] = term_ctr(CID_SCON, _nd_288);
                                                        u64 _nd_290 = _sp_10 >= HEAP_OFF ? _sp_10 : heap_alloc(e, cls_fit(2));
                                                        e.mem[_nd_290 + 0] = 99ull;
                                                        e.mem[_nd_290 + 1] = term_ctr(CID_SCON, _nd_289);
                                                        u64 _nd_291 = _sp_11 >= HEAP_OFF ? _sp_11 : heap_alloc(e, cls_fit(2));
                                                        e.mem[_nd_291 + 0] = 98ull;
                                                        e.mem[_nd_291 + 1] = term_ctr(CID_SCON, _nd_290);
                                                        u64 _nd_292 = _sp_12 >= HEAP_OFF ? _sp_12 : heap_alloc(e, cls_fit(2));
                                                        e.mem[_nd_292 + 0] = 97ull;
                                                        e.mem[_nd_292 + 1] = term_ctr(CID_SCON, _nd_291);
                                                        if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                                          u64 _t_16 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                                          e.mem[_t_16 + 0] = term_ctr(CID_SCON, _nd_292);
                                                          return term_tsk(FID_G, _t_16);
                                                        }
                                                        r0 = term_ctr(CID_SCON, _nd_292);
                                                        WL_JMP(FID_G);
                                                      }
                                                    } else {
                                                      u64 _nd_293 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                                      e.mem[_nd_293 + 0] = 108ull;
                                                      e.mem[_nd_293 + 1] = _f_23;
                                                      u64 _nd_294 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                                      e.mem[_nd_294 + 0] = 107ull;
                                                      e.mem[_nd_294 + 1] = term_ctr(CID_SCON, _nd_293);
                                                      u64 _nd_295 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                                      e.mem[_nd_295 + 0] = 106ull;
                                                      e.mem[_nd_295 + 1] = term_ctr(CID_SCON, _nd_294);
                                                      u64 _nd_296 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                                      e.mem[_nd_296 + 0] = 105ull;
                                                      e.mem[_nd_296 + 1] = term_ctr(CID_SCON, _nd_295);
                                                      u64 _nd_297 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                                      e.mem[_nd_297 + 0] = 104ull;
                                                      e.mem[_nd_297 + 1] = term_ctr(CID_SCON, _nd_296);
                                                      u64 _nd_298 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                                      e.mem[_nd_298 + 0] = 103ull;
                                                      e.mem[_nd_298 + 1] = term_ctr(CID_SCON, _nd_297);
                                                      u64 _nd_299 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                                      e.mem[_nd_299 + 0] = 102ull;
                                                      e.mem[_nd_299 + 1] = term_ctr(CID_SCON, _nd_298);
                                                      u64 _nd_300 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                                      e.mem[_nd_300 + 0] = 101ull;
                                                      e.mem[_nd_300 + 1] = term_ctr(CID_SCON, _nd_299);
                                                      u64 _nd_301 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                                      e.mem[_nd_301 + 0] = 100ull;
                                                      e.mem[_nd_301 + 1] = term_ctr(CID_SCON, _nd_300);
                                                      u64 _nd_302 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                                      e.mem[_nd_302 + 0] = 99ull;
                                                      e.mem[_nd_302 + 1] = term_ctr(CID_SCON, _nd_301);
                                                      u64 _nd_303 = _sp_10 >= HEAP_OFF ? _sp_10 : heap_alloc(e, cls_fit(2));
                                                      e.mem[_nd_303 + 0] = 98ull;
                                                      e.mem[_nd_303 + 1] = term_ctr(CID_SCON, _nd_302);
                                                      u64 _nd_304 = _sp_11 >= HEAP_OFF ? _sp_11 : heap_alloc(e, cls_fit(2));
                                                      e.mem[_nd_304 + 0] = 97ull;
                                                      e.mem[_nd_304 + 1] = term_ctr(CID_SCON, _nd_303);
                                                      if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                                        u64 _t_17 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                                        e.mem[_t_17 + 0] = term_ctr(CID_SCON, _nd_304);
                                                        return term_tsk(FID_G, _t_17);
                                                      }
                                                      r0 = term_ctr(CID_SCON, _nd_304);
                                                      WL_JMP(FID_G);
                                                    }
                                                  } else {
                                                    u32 _756_0 = ((_f_22 >> 0) & 1);
                                                    u32 _757_0 = ((_f_22 >> 1) & 1);
                                                    u32 _757_1 = ((_f_22 >> 2) & 1);
                                                    u32 _757_2 = ((_f_22 >> 3) & 1);
                                                    u32 _757_3 = ((_f_22 >> 4) & 1);
                                                    u32 _757_4 = ((_f_22 >> 5) & 1);
                                                    u32 _757_5 = ((_f_22 >> 6) & 1);
                                                    u32 _757_6 = ((_f_22 >> 7) & 1);
                                                    u32 _757_7 = ((_f_22 >> 8) & 1);
                                                    u32 _757_8 = ((_f_22 >> 9) & 1);
                                                    u32 _757_9 = ((_f_22 >> 10) & 1);
                                                    u32 _757_10 = ((_f_22 >> 11) & 1);
                                                    u32 _757_11 = ((_f_22 >> 12) & 1);
                                                    u32 _757_12 = ((_f_22 >> 13) & 1);
                                                    u32 _757_13 = ((_f_22 >> 14) & 1);
                                                    u32 _757_14 = ((_f_22 >> 15) & 1);
                                                    u32 _757_15 = ((_f_22 >> 16) & 1);
                                                    u32 _757_16 = ((_f_22 >> 17) & 1);
                                                    u32 _757_17 = ((_f_22 >> 18) & 1);
                                                    u32 _757_18 = ((_f_22 >> 19) & 1);
                                                    u32 _757_19 = ((_f_22 >> 20) & 1);
                                                    u32 _757_20 = ((_f_22 >> 21) & 1);
                                                    u32 _757_21 = ((_f_22 >> 22) & 1);
                                                    u32 _757_22 = ((_f_22 >> 23) & 1);
                                                    u32 _757_23 = ((_f_22 >> 24) & 1);
                                                    u32 _757_24 = ((_f_22 >> 25) & 1);
                                                    u32 _757_25 = ((_f_22 >> 26) & 1);
                                                    u32 _757_26 = ((_f_22 >> 27) & 1);
                                                    u32 _757_27 = ((_f_22 >> 28) & 1);
                                                    u32 _757_28 = ((_f_22 >> 29) & 1);
                                                    u32 _757_29 = ((_f_22 >> 30) & 1);
                                                    u32 _757_30 = ((_f_22 >> 31) & 1);
                                                    u64 _nd_305 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                                    e.mem[_nd_305 + 0] = (((u64)_756_0 << 0) | ((u64)_757_0 << 1) | ((u64)_757_1 << 2) | ((u64)_757_2 << 3) | ((u64)_757_3 << 4) | ((u64)_757_4 << 5) | ((u64)_757_5 << 6) | ((u64)_757_6 << 7) | ((u64)_757_7 << 8) | ((u64)_757_8 << 9) | ((u64)_757_9 << 10) | ((u64)_757_10 << 11) | ((u64)_757_11 << 12) | ((u64)_757_12 << 13) | ((u64)_757_13 << 14) | ((u64)_757_14 << 15) | ((u64)_757_15 << 16) | ((u64)_757_16 << 17) | ((u64)_757_17 << 18) | ((u64)_757_18 << 19) | ((u64)_757_19 << 20) | ((u64)_757_20 << 21) | ((u64)_757_21 << 22) | ((u64)_757_22 << 23) | ((u64)_757_23 << 24) | ((u64)_757_24 << 25) | ((u64)_757_25 << 26) | ((u64)_757_26 << 27) | ((u64)_757_27 << 28) | ((u64)_757_28 << 29) | ((u64)_757_29 << 30) | ((u64)_757_30 << 31));
                                                    e.mem[_nd_305 + 1] = _f_23;
                                                    u64 _nd_306 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                                    e.mem[_nd_306 + 0] = 107ull;
                                                    e.mem[_nd_306 + 1] = term_ctr(CID_SCON, _nd_305);
                                                    u64 _nd_307 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                                    e.mem[_nd_307 + 0] = 106ull;
                                                    e.mem[_nd_307 + 1] = term_ctr(CID_SCON, _nd_306);
                                                    u64 _nd_308 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                                    e.mem[_nd_308 + 0] = 105ull;
                                                    e.mem[_nd_308 + 1] = term_ctr(CID_SCON, _nd_307);
                                                    u64 _nd_309 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                                    e.mem[_nd_309 + 0] = 104ull;
                                                    e.mem[_nd_309 + 1] = term_ctr(CID_SCON, _nd_308);
                                                    u64 _nd_310 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                                    e.mem[_nd_310 + 0] = 103ull;
                                                    e.mem[_nd_310 + 1] = term_ctr(CID_SCON, _nd_309);
                                                    u64 _nd_311 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                                    e.mem[_nd_311 + 0] = 102ull;
                                                    e.mem[_nd_311 + 1] = term_ctr(CID_SCON, _nd_310);
                                                    u64 _nd_312 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                                    e.mem[_nd_312 + 0] = 101ull;
                                                    e.mem[_nd_312 + 1] = term_ctr(CID_SCON, _nd_311);
                                                    u64 _nd_313 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                                    e.mem[_nd_313 + 0] = 100ull;
                                                    e.mem[_nd_313 + 1] = term_ctr(CID_SCON, _nd_312);
                                                    u64 _nd_314 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                                    e.mem[_nd_314 + 0] = 99ull;
                                                    e.mem[_nd_314 + 1] = term_ctr(CID_SCON, _nd_313);
                                                    u64 _nd_315 = _sp_10 >= HEAP_OFF ? _sp_10 : heap_alloc(e, cls_fit(2));
                                                    e.mem[_nd_315 + 0] = 98ull;
                                                    e.mem[_nd_315 + 1] = term_ctr(CID_SCON, _nd_314);
                                                    u64 _nd_316 = _sp_11 >= HEAP_OFF ? _sp_11 : heap_alloc(e, cls_fit(2));
                                                    e.mem[_nd_316 + 0] = 97ull;
                                                    e.mem[_nd_316 + 1] = term_ctr(CID_SCON, _nd_315);
                                                    if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                                      u64 _t_18 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                                      e.mem[_t_18 + 0] = term_ctr(CID_SCON, _nd_316);
                                                      return term_tsk(FID_G, _t_18);
                                                    }
                                                    r0 = term_ctr(CID_SCON, _nd_316);
                                                    WL_JMP(FID_G);
                                                  }
                                                } else {
                                                  u64 _nd_317 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                                  e.mem[_nd_317 + 0] = 107ull;
                                                  e.mem[_nd_317 + 1] = _f_21;
                                                  u64 _nd_318 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                                  e.mem[_nd_318 + 0] = 106ull;
                                                  e.mem[_nd_318 + 1] = term_ctr(CID_SCON, _nd_317);
                                                  u64 _nd_319 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                                  e.mem[_nd_319 + 0] = 105ull;
                                                  e.mem[_nd_319 + 1] = term_ctr(CID_SCON, _nd_318);
                                                  u64 _nd_320 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                                  e.mem[_nd_320 + 0] = 104ull;
                                                  e.mem[_nd_320 + 1] = term_ctr(CID_SCON, _nd_319);
                                                  u64 _nd_321 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                                  e.mem[_nd_321 + 0] = 103ull;
                                                  e.mem[_nd_321 + 1] = term_ctr(CID_SCON, _nd_320);
                                                  u64 _nd_322 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                                  e.mem[_nd_322 + 0] = 102ull;
                                                  e.mem[_nd_322 + 1] = term_ctr(CID_SCON, _nd_321);
                                                  u64 _nd_323 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                                  e.mem[_nd_323 + 0] = 101ull;
                                                  e.mem[_nd_323 + 1] = term_ctr(CID_SCON, _nd_322);
                                                  u64 _nd_324 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                                  e.mem[_nd_324 + 0] = 100ull;
                                                  e.mem[_nd_324 + 1] = term_ctr(CID_SCON, _nd_323);
                                                  u64 _nd_325 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                                  e.mem[_nd_325 + 0] = 99ull;
                                                  e.mem[_nd_325 + 1] = term_ctr(CID_SCON, _nd_324);
                                                  u64 _nd_326 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                                  e.mem[_nd_326 + 0] = 98ull;
                                                  e.mem[_nd_326 + 1] = term_ctr(CID_SCON, _nd_325);
                                                  u64 _nd_327 = _sp_10 >= HEAP_OFF ? _sp_10 : heap_alloc(e, cls_fit(2));
                                                  e.mem[_nd_327 + 0] = 97ull;
                                                  e.mem[_nd_327 + 1] = term_ctr(CID_SCON, _nd_326);
                                                  if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                                    u64 _t_19 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                                    e.mem[_t_19 + 0] = term_ctr(CID_SCON, _nd_327);
                                                    return term_tsk(FID_G, _t_19);
                                                  }
                                                  r0 = term_ctr(CID_SCON, _nd_327);
                                                  WL_JMP(FID_G);
                                                }
                                              } else {
                                                u32 _688_0 = ((_f_20 >> 0) & 1);
                                                u32 _689_0 = ((_f_20 >> 1) & 1);
                                                u32 _689_1 = ((_f_20 >> 2) & 1);
                                                u32 _689_2 = ((_f_20 >> 3) & 1);
                                                u32 _689_3 = ((_f_20 >> 4) & 1);
                                                u32 _689_4 = ((_f_20 >> 5) & 1);
                                                u32 _689_5 = ((_f_20 >> 6) & 1);
                                                u32 _689_6 = ((_f_20 >> 7) & 1);
                                                u32 _689_7 = ((_f_20 >> 8) & 1);
                                                u32 _689_8 = ((_f_20 >> 9) & 1);
                                                u32 _689_9 = ((_f_20 >> 10) & 1);
                                                u32 _689_10 = ((_f_20 >> 11) & 1);
                                                u32 _689_11 = ((_f_20 >> 12) & 1);
                                                u32 _689_12 = ((_f_20 >> 13) & 1);
                                                u32 _689_13 = ((_f_20 >> 14) & 1);
                                                u32 _689_14 = ((_f_20 >> 15) & 1);
                                                u32 _689_15 = ((_f_20 >> 16) & 1);
                                                u32 _689_16 = ((_f_20 >> 17) & 1);
                                                u32 _689_17 = ((_f_20 >> 18) & 1);
                                                u32 _689_18 = ((_f_20 >> 19) & 1);
                                                u32 _689_19 = ((_f_20 >> 20) & 1);
                                                u32 _689_20 = ((_f_20 >> 21) & 1);
                                                u32 _689_21 = ((_f_20 >> 22) & 1);
                                                u32 _689_22 = ((_f_20 >> 23) & 1);
                                                u32 _689_23 = ((_f_20 >> 24) & 1);
                                                u32 _689_24 = ((_f_20 >> 25) & 1);
                                                u32 _689_25 = ((_f_20 >> 26) & 1);
                                                u32 _689_26 = ((_f_20 >> 27) & 1);
                                                u32 _689_27 = ((_f_20 >> 28) & 1);
                                                u32 _689_28 = ((_f_20 >> 29) & 1);
                                                u32 _689_29 = ((_f_20 >> 30) & 1);
                                                u32 _689_30 = ((_f_20 >> 31) & 1);
                                                u64 _nd_328 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                                e.mem[_nd_328 + 0] = (((u64)_688_0 << 0) | ((u64)_689_0 << 1) | ((u64)_689_1 << 2) | ((u64)_689_2 << 3) | ((u64)_689_3 << 4) | ((u64)_689_4 << 5) | ((u64)_689_5 << 6) | ((u64)_689_6 << 7) | ((u64)_689_7 << 8) | ((u64)_689_8 << 9) | ((u64)_689_9 << 10) | ((u64)_689_10 << 11) | ((u64)_689_11 << 12) | ((u64)_689_12 << 13) | ((u64)_689_13 << 14) | ((u64)_689_14 << 15) | ((u64)_689_15 << 16) | ((u64)_689_16 << 17) | ((u64)_689_17 << 18) | ((u64)_689_18 << 19) | ((u64)_689_19 << 20) | ((u64)_689_20 << 21) | ((u64)_689_21 << 22) | ((u64)_689_22 << 23) | ((u64)_689_23 << 24) | ((u64)_689_24 << 25) | ((u64)_689_25 << 26) | ((u64)_689_26 << 27) | ((u64)_689_27 << 28) | ((u64)_689_28 << 29) | ((u64)_689_29 << 30) | ((u64)_689_30 << 31));
                                                e.mem[_nd_328 + 1] = _f_21;
                                                u64 _nd_329 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                                e.mem[_nd_329 + 0] = 106ull;
                                                e.mem[_nd_329 + 1] = term_ctr(CID_SCON, _nd_328);
                                                u64 _nd_330 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                                e.mem[_nd_330 + 0] = 105ull;
                                                e.mem[_nd_330 + 1] = term_ctr(CID_SCON, _nd_329);
                                                u64 _nd_331 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                                e.mem[_nd_331 + 0] = 104ull;
                                                e.mem[_nd_331 + 1] = term_ctr(CID_SCON, _nd_330);
                                                u64 _nd_332 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                                e.mem[_nd_332 + 0] = 103ull;
                                                e.mem[_nd_332 + 1] = term_ctr(CID_SCON, _nd_331);
                                                u64 _nd_333 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                                e.mem[_nd_333 + 0] = 102ull;
                                                e.mem[_nd_333 + 1] = term_ctr(CID_SCON, _nd_332);
                                                u64 _nd_334 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                                e.mem[_nd_334 + 0] = 101ull;
                                                e.mem[_nd_334 + 1] = term_ctr(CID_SCON, _nd_333);
                                                u64 _nd_335 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                                e.mem[_nd_335 + 0] = 100ull;
                                                e.mem[_nd_335 + 1] = term_ctr(CID_SCON, _nd_334);
                                                u64 _nd_336 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                                e.mem[_nd_336 + 0] = 99ull;
                                                e.mem[_nd_336 + 1] = term_ctr(CID_SCON, _nd_335);
                                                u64 _nd_337 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                                e.mem[_nd_337 + 0] = 98ull;
                                                e.mem[_nd_337 + 1] = term_ctr(CID_SCON, _nd_336);
                                                u64 _nd_338 = _sp_10 >= HEAP_OFF ? _sp_10 : heap_alloc(e, cls_fit(2));
                                                e.mem[_nd_338 + 0] = 97ull;
                                                e.mem[_nd_338 + 1] = term_ctr(CID_SCON, _nd_337);
                                                if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                                  u64 _t_20 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                                  e.mem[_t_20 + 0] = term_ctr(CID_SCON, _nd_338);
                                                  return term_tsk(FID_G, _t_20);
                                                }
                                                r0 = term_ctr(CID_SCON, _nd_338);
                                                WL_JMP(FID_G);
                                              }
                                            } else {
                                              u64 _nd_339 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                              e.mem[_nd_339 + 0] = 106ull;
                                              e.mem[_nd_339 + 1] = _f_19;
                                              u64 _nd_340 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                              e.mem[_nd_340 + 0] = 105ull;
                                              e.mem[_nd_340 + 1] = term_ctr(CID_SCON, _nd_339);
                                              u64 _nd_341 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                              e.mem[_nd_341 + 0] = 104ull;
                                              e.mem[_nd_341 + 1] = term_ctr(CID_SCON, _nd_340);
                                              u64 _nd_342 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                              e.mem[_nd_342 + 0] = 103ull;
                                              e.mem[_nd_342 + 1] = term_ctr(CID_SCON, _nd_341);
                                              u64 _nd_343 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                              e.mem[_nd_343 + 0] = 102ull;
                                              e.mem[_nd_343 + 1] = term_ctr(CID_SCON, _nd_342);
                                              u64 _nd_344 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                              e.mem[_nd_344 + 0] = 101ull;
                                              e.mem[_nd_344 + 1] = term_ctr(CID_SCON, _nd_343);
                                              u64 _nd_345 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                              e.mem[_nd_345 + 0] = 100ull;
                                              e.mem[_nd_345 + 1] = term_ctr(CID_SCON, _nd_344);
                                              u64 _nd_346 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                              e.mem[_nd_346 + 0] = 99ull;
                                              e.mem[_nd_346 + 1] = term_ctr(CID_SCON, _nd_345);
                                              u64 _nd_347 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                              e.mem[_nd_347 + 0] = 98ull;
                                              e.mem[_nd_347 + 1] = term_ctr(CID_SCON, _nd_346);
                                              u64 _nd_348 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                              e.mem[_nd_348 + 0] = 97ull;
                                              e.mem[_nd_348 + 1] = term_ctr(CID_SCON, _nd_347);
                                              if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                                u64 _t_21 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                                e.mem[_t_21 + 0] = term_ctr(CID_SCON, _nd_348);
                                                return term_tsk(FID_G, _t_21);
                                              }
                                              r0 = term_ctr(CID_SCON, _nd_348);
                                              WL_JMP(FID_G);
                                            }
                                          } else {
                                            u32 _620_0 = ((_f_18 >> 0) & 1);
                                            u32 _621_0 = ((_f_18 >> 1) & 1);
                                            u32 _621_1 = ((_f_18 >> 2) & 1);
                                            u32 _621_2 = ((_f_18 >> 3) & 1);
                                            u32 _621_3 = ((_f_18 >> 4) & 1);
                                            u32 _621_4 = ((_f_18 >> 5) & 1);
                                            u32 _621_5 = ((_f_18 >> 6) & 1);
                                            u32 _621_6 = ((_f_18 >> 7) & 1);
                                            u32 _621_7 = ((_f_18 >> 8) & 1);
                                            u32 _621_8 = ((_f_18 >> 9) & 1);
                                            u32 _621_9 = ((_f_18 >> 10) & 1);
                                            u32 _621_10 = ((_f_18 >> 11) & 1);
                                            u32 _621_11 = ((_f_18 >> 12) & 1);
                                            u32 _621_12 = ((_f_18 >> 13) & 1);
                                            u32 _621_13 = ((_f_18 >> 14) & 1);
                                            u32 _621_14 = ((_f_18 >> 15) & 1);
                                            u32 _621_15 = ((_f_18 >> 16) & 1);
                                            u32 _621_16 = ((_f_18 >> 17) & 1);
                                            u32 _621_17 = ((_f_18 >> 18) & 1);
                                            u32 _621_18 = ((_f_18 >> 19) & 1);
                                            u32 _621_19 = ((_f_18 >> 20) & 1);
                                            u32 _621_20 = ((_f_18 >> 21) & 1);
                                            u32 _621_21 = ((_f_18 >> 22) & 1);
                                            u32 _621_22 = ((_f_18 >> 23) & 1);
                                            u32 _621_23 = ((_f_18 >> 24) & 1);
                                            u32 _621_24 = ((_f_18 >> 25) & 1);
                                            u32 _621_25 = ((_f_18 >> 26) & 1);
                                            u32 _621_26 = ((_f_18 >> 27) & 1);
                                            u32 _621_27 = ((_f_18 >> 28) & 1);
                                            u32 _621_28 = ((_f_18 >> 29) & 1);
                                            u32 _621_29 = ((_f_18 >> 30) & 1);
                                            u32 _621_30 = ((_f_18 >> 31) & 1);
                                            u64 _nd_349 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                            e.mem[_nd_349 + 0] = (((u64)_620_0 << 0) | ((u64)_621_0 << 1) | ((u64)_621_1 << 2) | ((u64)_621_2 << 3) | ((u64)_621_3 << 4) | ((u64)_621_4 << 5) | ((u64)_621_5 << 6) | ((u64)_621_6 << 7) | ((u64)_621_7 << 8) | ((u64)_621_8 << 9) | ((u64)_621_9 << 10) | ((u64)_621_10 << 11) | ((u64)_621_11 << 12) | ((u64)_621_12 << 13) | ((u64)_621_13 << 14) | ((u64)_621_14 << 15) | ((u64)_621_15 << 16) | ((u64)_621_16 << 17) | ((u64)_621_17 << 18) | ((u64)_621_18 << 19) | ((u64)_621_19 << 20) | ((u64)_621_20 << 21) | ((u64)_621_21 << 22) | ((u64)_621_22 << 23) | ((u64)_621_23 << 24) | ((u64)_621_24 << 25) | ((u64)_621_25 << 26) | ((u64)_621_26 << 27) | ((u64)_621_27 << 28) | ((u64)_621_28 << 29) | ((u64)_621_29 << 30) | ((u64)_621_30 << 31));
                                            e.mem[_nd_349 + 1] = _f_19;
                                            u64 _nd_350 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                            e.mem[_nd_350 + 0] = 105ull;
                                            e.mem[_nd_350 + 1] = term_ctr(CID_SCON, _nd_349);
                                            u64 _nd_351 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                            e.mem[_nd_351 + 0] = 104ull;
                                            e.mem[_nd_351 + 1] = term_ctr(CID_SCON, _nd_350);
                                            u64 _nd_352 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                            e.mem[_nd_352 + 0] = 103ull;
                                            e.mem[_nd_352 + 1] = term_ctr(CID_SCON, _nd_351);
                                            u64 _nd_353 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                            e.mem[_nd_353 + 0] = 102ull;
                                            e.mem[_nd_353 + 1] = term_ctr(CID_SCON, _nd_352);
                                            u64 _nd_354 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                            e.mem[_nd_354 + 0] = 101ull;
                                            e.mem[_nd_354 + 1] = term_ctr(CID_SCON, _nd_353);
                                            u64 _nd_355 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                            e.mem[_nd_355 + 0] = 100ull;
                                            e.mem[_nd_355 + 1] = term_ctr(CID_SCON, _nd_354);
                                            u64 _nd_356 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                            e.mem[_nd_356 + 0] = 99ull;
                                            e.mem[_nd_356 + 1] = term_ctr(CID_SCON, _nd_355);
                                            u64 _nd_357 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                            e.mem[_nd_357 + 0] = 98ull;
                                            e.mem[_nd_357 + 1] = term_ctr(CID_SCON, _nd_356);
                                            u64 _nd_358 = _sp_9 >= HEAP_OFF ? _sp_9 : heap_alloc(e, cls_fit(2));
                                            e.mem[_nd_358 + 0] = 97ull;
                                            e.mem[_nd_358 + 1] = term_ctr(CID_SCON, _nd_357);
                                            if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                              u64 _t_22 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                              e.mem[_t_22 + 0] = term_ctr(CID_SCON, _nd_358);
                                              return term_tsk(FID_G, _t_22);
                                            }
                                            r0 = term_ctr(CID_SCON, _nd_358);
                                            WL_JMP(FID_G);
                                          }
                                        } else {
                                          u64 _nd_359 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                          e.mem[_nd_359 + 0] = 105ull;
                                          e.mem[_nd_359 + 1] = _f_17;
                                          u64 _nd_360 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                          e.mem[_nd_360 + 0] = 104ull;
                                          e.mem[_nd_360 + 1] = term_ctr(CID_SCON, _nd_359);
                                          u64 _nd_361 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                          e.mem[_nd_361 + 0] = 103ull;
                                          e.mem[_nd_361 + 1] = term_ctr(CID_SCON, _nd_360);
                                          u64 _nd_362 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                          e.mem[_nd_362 + 0] = 102ull;
                                          e.mem[_nd_362 + 1] = term_ctr(CID_SCON, _nd_361);
                                          u64 _nd_363 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                          e.mem[_nd_363 + 0] = 101ull;
                                          e.mem[_nd_363 + 1] = term_ctr(CID_SCON, _nd_362);
                                          u64 _nd_364 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                          e.mem[_nd_364 + 0] = 100ull;
                                          e.mem[_nd_364 + 1] = term_ctr(CID_SCON, _nd_363);
                                          u64 _nd_365 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                          e.mem[_nd_365 + 0] = 99ull;
                                          e.mem[_nd_365 + 1] = term_ctr(CID_SCON, _nd_364);
                                          u64 _nd_366 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                          e.mem[_nd_366 + 0] = 98ull;
                                          e.mem[_nd_366 + 1] = term_ctr(CID_SCON, _nd_365);
                                          u64 _nd_367 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                          e.mem[_nd_367 + 0] = 97ull;
                                          e.mem[_nd_367 + 1] = term_ctr(CID_SCON, _nd_366);
                                          if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                            u64 _t_23 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                            e.mem[_t_23 + 0] = term_ctr(CID_SCON, _nd_367);
                                            return term_tsk(FID_G, _t_23);
                                          }
                                          r0 = term_ctr(CID_SCON, _nd_367);
                                          WL_JMP(FID_G);
                                        }
                                      } else {
                                        u32 _552_0 = ((_f_16 >> 0) & 1);
                                        u32 _553_0 = ((_f_16 >> 1) & 1);
                                        u32 _553_1 = ((_f_16 >> 2) & 1);
                                        u32 _553_2 = ((_f_16 >> 3) & 1);
                                        u32 _553_3 = ((_f_16 >> 4) & 1);
                                        u32 _553_4 = ((_f_16 >> 5) & 1);
                                        u32 _553_5 = ((_f_16 >> 6) & 1);
                                        u32 _553_6 = ((_f_16 >> 7) & 1);
                                        u32 _553_7 = ((_f_16 >> 8) & 1);
                                        u32 _553_8 = ((_f_16 >> 9) & 1);
                                        u32 _553_9 = ((_f_16 >> 10) & 1);
                                        u32 _553_10 = ((_f_16 >> 11) & 1);
                                        u32 _553_11 = ((_f_16 >> 12) & 1);
                                        u32 _553_12 = ((_f_16 >> 13) & 1);
                                        u32 _553_13 = ((_f_16 >> 14) & 1);
                                        u32 _553_14 = ((_f_16 >> 15) & 1);
                                        u32 _553_15 = ((_f_16 >> 16) & 1);
                                        u32 _553_16 = ((_f_16 >> 17) & 1);
                                        u32 _553_17 = ((_f_16 >> 18) & 1);
                                        u32 _553_18 = ((_f_16 >> 19) & 1);
                                        u32 _553_19 = ((_f_16 >> 20) & 1);
                                        u32 _553_20 = ((_f_16 >> 21) & 1);
                                        u32 _553_21 = ((_f_16 >> 22) & 1);
                                        u32 _553_22 = ((_f_16 >> 23) & 1);
                                        u32 _553_23 = ((_f_16 >> 24) & 1);
                                        u32 _553_24 = ((_f_16 >> 25) & 1);
                                        u32 _553_25 = ((_f_16 >> 26) & 1);
                                        u32 _553_26 = ((_f_16 >> 27) & 1);
                                        u32 _553_27 = ((_f_16 >> 28) & 1);
                                        u32 _553_28 = ((_f_16 >> 29) & 1);
                                        u32 _553_29 = ((_f_16 >> 30) & 1);
                                        u32 _553_30 = ((_f_16 >> 31) & 1);
                                        u64 _nd_368 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                        e.mem[_nd_368 + 0] = (((u64)_552_0 << 0) | ((u64)_553_0 << 1) | ((u64)_553_1 << 2) | ((u64)_553_2 << 3) | ((u64)_553_3 << 4) | ((u64)_553_4 << 5) | ((u64)_553_5 << 6) | ((u64)_553_6 << 7) | ((u64)_553_7 << 8) | ((u64)_553_8 << 9) | ((u64)_553_9 << 10) | ((u64)_553_10 << 11) | ((u64)_553_11 << 12) | ((u64)_553_12 << 13) | ((u64)_553_13 << 14) | ((u64)_553_14 << 15) | ((u64)_553_15 << 16) | ((u64)_553_16 << 17) | ((u64)_553_17 << 18) | ((u64)_553_18 << 19) | ((u64)_553_19 << 20) | ((u64)_553_20 << 21) | ((u64)_553_21 << 22) | ((u64)_553_22 << 23) | ((u64)_553_23 << 24) | ((u64)_553_24 << 25) | ((u64)_553_25 << 26) | ((u64)_553_26 << 27) | ((u64)_553_27 << 28) | ((u64)_553_28 << 29) | ((u64)_553_29 << 30) | ((u64)_553_30 << 31));
                                        e.mem[_nd_368 + 1] = _f_17;
                                        u64 _nd_369 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                        e.mem[_nd_369 + 0] = 104ull;
                                        e.mem[_nd_369 + 1] = term_ctr(CID_SCON, _nd_368);
                                        u64 _nd_370 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                        e.mem[_nd_370 + 0] = 103ull;
                                        e.mem[_nd_370 + 1] = term_ctr(CID_SCON, _nd_369);
                                        u64 _nd_371 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                        e.mem[_nd_371 + 0] = 102ull;
                                        e.mem[_nd_371 + 1] = term_ctr(CID_SCON, _nd_370);
                                        u64 _nd_372 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                        e.mem[_nd_372 + 0] = 101ull;
                                        e.mem[_nd_372 + 1] = term_ctr(CID_SCON, _nd_371);
                                        u64 _nd_373 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                        e.mem[_nd_373 + 0] = 100ull;
                                        e.mem[_nd_373 + 1] = term_ctr(CID_SCON, _nd_372);
                                        u64 _nd_374 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                        e.mem[_nd_374 + 0] = 99ull;
                                        e.mem[_nd_374 + 1] = term_ctr(CID_SCON, _nd_373);
                                        u64 _nd_375 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                        e.mem[_nd_375 + 0] = 98ull;
                                        e.mem[_nd_375 + 1] = term_ctr(CID_SCON, _nd_374);
                                        u64 _nd_376 = _sp_8 >= HEAP_OFF ? _sp_8 : heap_alloc(e, cls_fit(2));
                                        e.mem[_nd_376 + 0] = 97ull;
                                        e.mem[_nd_376 + 1] = term_ctr(CID_SCON, _nd_375);
                                        if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                          u64 _t_24 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                          e.mem[_t_24 + 0] = term_ctr(CID_SCON, _nd_376);
                                          return term_tsk(FID_G, _t_24);
                                        }
                                        r0 = term_ctr(CID_SCON, _nd_376);
                                        WL_JMP(FID_G);
                                      }
                                    } else {
                                      u64 _nd_377 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                      e.mem[_nd_377 + 0] = 104ull;
                                      e.mem[_nd_377 + 1] = _f_15;
                                      u64 _nd_378 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                      e.mem[_nd_378 + 0] = 103ull;
                                      e.mem[_nd_378 + 1] = term_ctr(CID_SCON, _nd_377);
                                      u64 _nd_379 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                      e.mem[_nd_379 + 0] = 102ull;
                                      e.mem[_nd_379 + 1] = term_ctr(CID_SCON, _nd_378);
                                      u64 _nd_380 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                      e.mem[_nd_380 + 0] = 101ull;
                                      e.mem[_nd_380 + 1] = term_ctr(CID_SCON, _nd_379);
                                      u64 _nd_381 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                      e.mem[_nd_381 + 0] = 100ull;
                                      e.mem[_nd_381 + 1] = term_ctr(CID_SCON, _nd_380);
                                      u64 _nd_382 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                      e.mem[_nd_382 + 0] = 99ull;
                                      e.mem[_nd_382 + 1] = term_ctr(CID_SCON, _nd_381);
                                      u64 _nd_383 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                      e.mem[_nd_383 + 0] = 98ull;
                                      e.mem[_nd_383 + 1] = term_ctr(CID_SCON, _nd_382);
                                      u64 _nd_384 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                      e.mem[_nd_384 + 0] = 97ull;
                                      e.mem[_nd_384 + 1] = term_ctr(CID_SCON, _nd_383);
                                      if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                        u64 _t_25 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                        e.mem[_t_25 + 0] = term_ctr(CID_SCON, _nd_384);
                                        return term_tsk(FID_G, _t_25);
                                      }
                                      r0 = term_ctr(CID_SCON, _nd_384);
                                      WL_JMP(FID_G);
                                    }
                                  } else {
                                    u32 _484_0 = ((_f_14 >> 0) & 1);
                                    u32 _485_0 = ((_f_14 >> 1) & 1);
                                    u32 _485_1 = ((_f_14 >> 2) & 1);
                                    u32 _485_2 = ((_f_14 >> 3) & 1);
                                    u32 _485_3 = ((_f_14 >> 4) & 1);
                                    u32 _485_4 = ((_f_14 >> 5) & 1);
                                    u32 _485_5 = ((_f_14 >> 6) & 1);
                                    u32 _485_6 = ((_f_14 >> 7) & 1);
                                    u32 _485_7 = ((_f_14 >> 8) & 1);
                                    u32 _485_8 = ((_f_14 >> 9) & 1);
                                    u32 _485_9 = ((_f_14 >> 10) & 1);
                                    u32 _485_10 = ((_f_14 >> 11) & 1);
                                    u32 _485_11 = ((_f_14 >> 12) & 1);
                                    u32 _485_12 = ((_f_14 >> 13) & 1);
                                    u32 _485_13 = ((_f_14 >> 14) & 1);
                                    u32 _485_14 = ((_f_14 >> 15) & 1);
                                    u32 _485_15 = ((_f_14 >> 16) & 1);
                                    u32 _485_16 = ((_f_14 >> 17) & 1);
                                    u32 _485_17 = ((_f_14 >> 18) & 1);
                                    u32 _485_18 = ((_f_14 >> 19) & 1);
                                    u32 _485_19 = ((_f_14 >> 20) & 1);
                                    u32 _485_20 = ((_f_14 >> 21) & 1);
                                    u32 _485_21 = ((_f_14 >> 22) & 1);
                                    u32 _485_22 = ((_f_14 >> 23) & 1);
                                    u32 _485_23 = ((_f_14 >> 24) & 1);
                                    u32 _485_24 = ((_f_14 >> 25) & 1);
                                    u32 _485_25 = ((_f_14 >> 26) & 1);
                                    u32 _485_26 = ((_f_14 >> 27) & 1);
                                    u32 _485_27 = ((_f_14 >> 28) & 1);
                                    u32 _485_28 = ((_f_14 >> 29) & 1);
                                    u32 _485_29 = ((_f_14 >> 30) & 1);
                                    u32 _485_30 = ((_f_14 >> 31) & 1);
                                    u64 _nd_385 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                    e.mem[_nd_385 + 0] = (((u64)_484_0 << 0) | ((u64)_485_0 << 1) | ((u64)_485_1 << 2) | ((u64)_485_2 << 3) | ((u64)_485_3 << 4) | ((u64)_485_4 << 5) | ((u64)_485_5 << 6) | ((u64)_485_6 << 7) | ((u64)_485_7 << 8) | ((u64)_485_8 << 9) | ((u64)_485_9 << 10) | ((u64)_485_10 << 11) | ((u64)_485_11 << 12) | ((u64)_485_12 << 13) | ((u64)_485_13 << 14) | ((u64)_485_14 << 15) | ((u64)_485_15 << 16) | ((u64)_485_16 << 17) | ((u64)_485_17 << 18) | ((u64)_485_18 << 19) | ((u64)_485_19 << 20) | ((u64)_485_20 << 21) | ((u64)_485_21 << 22) | ((u64)_485_22 << 23) | ((u64)_485_23 << 24) | ((u64)_485_24 << 25) | ((u64)_485_25 << 26) | ((u64)_485_26 << 27) | ((u64)_485_27 << 28) | ((u64)_485_28 << 29) | ((u64)_485_29 << 30) | ((u64)_485_30 << 31));
                                    e.mem[_nd_385 + 1] = _f_15;
                                    u64 _nd_386 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                    e.mem[_nd_386 + 0] = 103ull;
                                    e.mem[_nd_386 + 1] = term_ctr(CID_SCON, _nd_385);
                                    u64 _nd_387 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                    e.mem[_nd_387 + 0] = 102ull;
                                    e.mem[_nd_387 + 1] = term_ctr(CID_SCON, _nd_386);
                                    u64 _nd_388 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                    e.mem[_nd_388 + 0] = 101ull;
                                    e.mem[_nd_388 + 1] = term_ctr(CID_SCON, _nd_387);
                                    u64 _nd_389 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                    e.mem[_nd_389 + 0] = 100ull;
                                    e.mem[_nd_389 + 1] = term_ctr(CID_SCON, _nd_388);
                                    u64 _nd_390 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                    e.mem[_nd_390 + 0] = 99ull;
                                    e.mem[_nd_390 + 1] = term_ctr(CID_SCON, _nd_389);
                                    u64 _nd_391 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                    e.mem[_nd_391 + 0] = 98ull;
                                    e.mem[_nd_391 + 1] = term_ctr(CID_SCON, _nd_390);
                                    u64 _nd_392 = _sp_7 >= HEAP_OFF ? _sp_7 : heap_alloc(e, cls_fit(2));
                                    e.mem[_nd_392 + 0] = 97ull;
                                    e.mem[_nd_392 + 1] = term_ctr(CID_SCON, _nd_391);
                                    if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                      u64 _t_26 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                      e.mem[_t_26 + 0] = term_ctr(CID_SCON, _nd_392);
                                      return term_tsk(FID_G, _t_26);
                                    }
                                    r0 = term_ctr(CID_SCON, _nd_392);
                                    WL_JMP(FID_G);
                                  }
                                } else {
                                  u64 _nd_393 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                  e.mem[_nd_393 + 0] = 103ull;
                                  e.mem[_nd_393 + 1] = _f_13;
                                  u64 _nd_394 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                  e.mem[_nd_394 + 0] = 102ull;
                                  e.mem[_nd_394 + 1] = term_ctr(CID_SCON, _nd_393);
                                  u64 _nd_395 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                  e.mem[_nd_395 + 0] = 101ull;
                                  e.mem[_nd_395 + 1] = term_ctr(CID_SCON, _nd_394);
                                  u64 _nd_396 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                  e.mem[_nd_396 + 0] = 100ull;
                                  e.mem[_nd_396 + 1] = term_ctr(CID_SCON, _nd_395);
                                  u64 _nd_397 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                  e.mem[_nd_397 + 0] = 99ull;
                                  e.mem[_nd_397 + 1] = term_ctr(CID_SCON, _nd_396);
                                  u64 _nd_398 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                  e.mem[_nd_398 + 0] = 98ull;
                                  e.mem[_nd_398 + 1] = term_ctr(CID_SCON, _nd_397);
                                  u64 _nd_399 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                  e.mem[_nd_399 + 0] = 97ull;
                                  e.mem[_nd_399 + 1] = term_ctr(CID_SCON, _nd_398);
                                  if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                    u64 _t_27 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                    e.mem[_t_27 + 0] = term_ctr(CID_SCON, _nd_399);
                                    return term_tsk(FID_G, _t_27);
                                  }
                                  r0 = term_ctr(CID_SCON, _nd_399);
                                  WL_JMP(FID_G);
                                }
                              } else {
                                u32 _416_0 = ((_f_12 >> 0) & 1);
                                u32 _417_0 = ((_f_12 >> 1) & 1);
                                u32 _417_1 = ((_f_12 >> 2) & 1);
                                u32 _417_2 = ((_f_12 >> 3) & 1);
                                u32 _417_3 = ((_f_12 >> 4) & 1);
                                u32 _417_4 = ((_f_12 >> 5) & 1);
                                u32 _417_5 = ((_f_12 >> 6) & 1);
                                u32 _417_6 = ((_f_12 >> 7) & 1);
                                u32 _417_7 = ((_f_12 >> 8) & 1);
                                u32 _417_8 = ((_f_12 >> 9) & 1);
                                u32 _417_9 = ((_f_12 >> 10) & 1);
                                u32 _417_10 = ((_f_12 >> 11) & 1);
                                u32 _417_11 = ((_f_12 >> 12) & 1);
                                u32 _417_12 = ((_f_12 >> 13) & 1);
                                u32 _417_13 = ((_f_12 >> 14) & 1);
                                u32 _417_14 = ((_f_12 >> 15) & 1);
                                u32 _417_15 = ((_f_12 >> 16) & 1);
                                u32 _417_16 = ((_f_12 >> 17) & 1);
                                u32 _417_17 = ((_f_12 >> 18) & 1);
                                u32 _417_18 = ((_f_12 >> 19) & 1);
                                u32 _417_19 = ((_f_12 >> 20) & 1);
                                u32 _417_20 = ((_f_12 >> 21) & 1);
                                u32 _417_21 = ((_f_12 >> 22) & 1);
                                u32 _417_22 = ((_f_12 >> 23) & 1);
                                u32 _417_23 = ((_f_12 >> 24) & 1);
                                u32 _417_24 = ((_f_12 >> 25) & 1);
                                u32 _417_25 = ((_f_12 >> 26) & 1);
                                u32 _417_26 = ((_f_12 >> 27) & 1);
                                u32 _417_27 = ((_f_12 >> 28) & 1);
                                u32 _417_28 = ((_f_12 >> 29) & 1);
                                u32 _417_29 = ((_f_12 >> 30) & 1);
                                u32 _417_30 = ((_f_12 >> 31) & 1);
                                u64 _nd_400 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                                e.mem[_nd_400 + 0] = (((u64)_416_0 << 0) | ((u64)_417_0 << 1) | ((u64)_417_1 << 2) | ((u64)_417_2 << 3) | ((u64)_417_3 << 4) | ((u64)_417_4 << 5) | ((u64)_417_5 << 6) | ((u64)_417_6 << 7) | ((u64)_417_7 << 8) | ((u64)_417_8 << 9) | ((u64)_417_9 << 10) | ((u64)_417_10 << 11) | ((u64)_417_11 << 12) | ((u64)_417_12 << 13) | ((u64)_417_13 << 14) | ((u64)_417_14 << 15) | ((u64)_417_15 << 16) | ((u64)_417_16 << 17) | ((u64)_417_17 << 18) | ((u64)_417_18 << 19) | ((u64)_417_19 << 20) | ((u64)_417_20 << 21) | ((u64)_417_21 << 22) | ((u64)_417_22 << 23) | ((u64)_417_23 << 24) | ((u64)_417_24 << 25) | ((u64)_417_25 << 26) | ((u64)_417_26 << 27) | ((u64)_417_27 << 28) | ((u64)_417_28 << 29) | ((u64)_417_29 << 30) | ((u64)_417_30 << 31));
                                e.mem[_nd_400 + 1] = _f_13;
                                u64 _nd_401 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                                e.mem[_nd_401 + 0] = 102ull;
                                e.mem[_nd_401 + 1] = term_ctr(CID_SCON, _nd_400);
                                u64 _nd_402 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                                e.mem[_nd_402 + 0] = 101ull;
                                e.mem[_nd_402 + 1] = term_ctr(CID_SCON, _nd_401);
                                u64 _nd_403 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                                e.mem[_nd_403 + 0] = 100ull;
                                e.mem[_nd_403 + 1] = term_ctr(CID_SCON, _nd_402);
                                u64 _nd_404 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                                e.mem[_nd_404 + 0] = 99ull;
                                e.mem[_nd_404 + 1] = term_ctr(CID_SCON, _nd_403);
                                u64 _nd_405 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                                e.mem[_nd_405 + 0] = 98ull;
                                e.mem[_nd_405 + 1] = term_ctr(CID_SCON, _nd_404);
                                u64 _nd_406 = _sp_6 >= HEAP_OFF ? _sp_6 : heap_alloc(e, cls_fit(2));
                                e.mem[_nd_406 + 0] = 97ull;
                                e.mem[_nd_406 + 1] = term_ctr(CID_SCON, _nd_405);
                                if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                  u64 _t_28 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                  e.mem[_t_28 + 0] = term_ctr(CID_SCON, _nd_406);
                                  return term_tsk(FID_G, _t_28);
                                }
                                r0 = term_ctr(CID_SCON, _nd_406);
                                WL_JMP(FID_G);
                              }
                            } else {
                              u64 _nd_407 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                              e.mem[_nd_407 + 0] = 102ull;
                              e.mem[_nd_407 + 1] = _f_11;
                              u64 _nd_408 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                              e.mem[_nd_408 + 0] = 101ull;
                              e.mem[_nd_408 + 1] = term_ctr(CID_SCON, _nd_407);
                              u64 _nd_409 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                              e.mem[_nd_409 + 0] = 100ull;
                              e.mem[_nd_409 + 1] = term_ctr(CID_SCON, _nd_408);
                              u64 _nd_410 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                              e.mem[_nd_410 + 0] = 99ull;
                              e.mem[_nd_410 + 1] = term_ctr(CID_SCON, _nd_409);
                              u64 _nd_411 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                              e.mem[_nd_411 + 0] = 98ull;
                              e.mem[_nd_411 + 1] = term_ctr(CID_SCON, _nd_410);
                              u64 _nd_412 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                              e.mem[_nd_412 + 0] = 97ull;
                              e.mem[_nd_412 + 1] = term_ctr(CID_SCON, _nd_411);
                              if (!DEVICE && !seq && fid_nofk(FID_G)) {
                                u64 _t_29 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                                e.mem[_t_29 + 0] = term_ctr(CID_SCON, _nd_412);
                                return term_tsk(FID_G, _t_29);
                              }
                              r0 = term_ctr(CID_SCON, _nd_412);
                              WL_JMP(FID_G);
                            }
                          } else {
                            u32 _348_0 = ((_f_10 >> 0) & 1);
                            u32 _349_0 = ((_f_10 >> 1) & 1);
                            u32 _349_1 = ((_f_10 >> 2) & 1);
                            u32 _349_2 = ((_f_10 >> 3) & 1);
                            u32 _349_3 = ((_f_10 >> 4) & 1);
                            u32 _349_4 = ((_f_10 >> 5) & 1);
                            u32 _349_5 = ((_f_10 >> 6) & 1);
                            u32 _349_6 = ((_f_10 >> 7) & 1);
                            u32 _349_7 = ((_f_10 >> 8) & 1);
                            u32 _349_8 = ((_f_10 >> 9) & 1);
                            u32 _349_9 = ((_f_10 >> 10) & 1);
                            u32 _349_10 = ((_f_10 >> 11) & 1);
                            u32 _349_11 = ((_f_10 >> 12) & 1);
                            u32 _349_12 = ((_f_10 >> 13) & 1);
                            u32 _349_13 = ((_f_10 >> 14) & 1);
                            u32 _349_14 = ((_f_10 >> 15) & 1);
                            u32 _349_15 = ((_f_10 >> 16) & 1);
                            u32 _349_16 = ((_f_10 >> 17) & 1);
                            u32 _349_17 = ((_f_10 >> 18) & 1);
                            u32 _349_18 = ((_f_10 >> 19) & 1);
                            u32 _349_19 = ((_f_10 >> 20) & 1);
                            u32 _349_20 = ((_f_10 >> 21) & 1);
                            u32 _349_21 = ((_f_10 >> 22) & 1);
                            u32 _349_22 = ((_f_10 >> 23) & 1);
                            u32 _349_23 = ((_f_10 >> 24) & 1);
                            u32 _349_24 = ((_f_10 >> 25) & 1);
                            u32 _349_25 = ((_f_10 >> 26) & 1);
                            u32 _349_26 = ((_f_10 >> 27) & 1);
                            u32 _349_27 = ((_f_10 >> 28) & 1);
                            u32 _349_28 = ((_f_10 >> 29) & 1);
                            u32 _349_29 = ((_f_10 >> 30) & 1);
                            u32 _349_30 = ((_f_10 >> 31) & 1);
                            u64 _nd_413 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                            e.mem[_nd_413 + 0] = (((u64)_348_0 << 0) | ((u64)_349_0 << 1) | ((u64)_349_1 << 2) | ((u64)_349_2 << 3) | ((u64)_349_3 << 4) | ((u64)_349_4 << 5) | ((u64)_349_5 << 6) | ((u64)_349_6 << 7) | ((u64)_349_7 << 8) | ((u64)_349_8 << 9) | ((u64)_349_9 << 10) | ((u64)_349_10 << 11) | ((u64)_349_11 << 12) | ((u64)_349_12 << 13) | ((u64)_349_13 << 14) | ((u64)_349_14 << 15) | ((u64)_349_15 << 16) | ((u64)_349_16 << 17) | ((u64)_349_17 << 18) | ((u64)_349_18 << 19) | ((u64)_349_19 << 20) | ((u64)_349_20 << 21) | ((u64)_349_21 << 22) | ((u64)_349_22 << 23) | ((u64)_349_23 << 24) | ((u64)_349_24 << 25) | ((u64)_349_25 << 26) | ((u64)_349_26 << 27) | ((u64)_349_27 << 28) | ((u64)_349_28 << 29) | ((u64)_349_29 << 30) | ((u64)_349_30 << 31));
                            e.mem[_nd_413 + 1] = _f_11;
                            u64 _nd_414 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                            e.mem[_nd_414 + 0] = 101ull;
                            e.mem[_nd_414 + 1] = term_ctr(CID_SCON, _nd_413);
                            u64 _nd_415 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                            e.mem[_nd_415 + 0] = 100ull;
                            e.mem[_nd_415 + 1] = term_ctr(CID_SCON, _nd_414);
                            u64 _nd_416 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                            e.mem[_nd_416 + 0] = 99ull;
                            e.mem[_nd_416 + 1] = term_ctr(CID_SCON, _nd_415);
                            u64 _nd_417 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                            e.mem[_nd_417 + 0] = 98ull;
                            e.mem[_nd_417 + 1] = term_ctr(CID_SCON, _nd_416);
                            u64 _nd_418 = _sp_5 >= HEAP_OFF ? _sp_5 : heap_alloc(e, cls_fit(2));
                            e.mem[_nd_418 + 0] = 97ull;
                            e.mem[_nd_418 + 1] = term_ctr(CID_SCON, _nd_417);
                            if (!DEVICE && !seq && fid_nofk(FID_G)) {
                              u64 _t_30 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                              e.mem[_t_30 + 0] = term_ctr(CID_SCON, _nd_418);
                              return term_tsk(FID_G, _t_30);
                            }
                            r0 = term_ctr(CID_SCON, _nd_418);
                            WL_JMP(FID_G);
                          }
                        } else {
                          u64 _nd_419 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                          e.mem[_nd_419 + 0] = 101ull;
                          e.mem[_nd_419 + 1] = _f_9;
                          u64 _nd_420 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                          e.mem[_nd_420 + 0] = 100ull;
                          e.mem[_nd_420 + 1] = term_ctr(CID_SCON, _nd_419);
                          u64 _nd_421 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                          e.mem[_nd_421 + 0] = 99ull;
                          e.mem[_nd_421 + 1] = term_ctr(CID_SCON, _nd_420);
                          u64 _nd_422 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                          e.mem[_nd_422 + 0] = 98ull;
                          e.mem[_nd_422 + 1] = term_ctr(CID_SCON, _nd_421);
                          u64 _nd_423 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                          e.mem[_nd_423 + 0] = 97ull;
                          e.mem[_nd_423 + 1] = term_ctr(CID_SCON, _nd_422);
                          if (!DEVICE && !seq && fid_nofk(FID_G)) {
                            u64 _t_31 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                            e.mem[_t_31 + 0] = term_ctr(CID_SCON, _nd_423);
                            return term_tsk(FID_G, _t_31);
                          }
                          r0 = term_ctr(CID_SCON, _nd_423);
                          WL_JMP(FID_G);
                        }
                      } else {
                        u32 _280_0 = ((_f_8 >> 0) & 1);
                        u32 _281_0 = ((_f_8 >> 1) & 1);
                        u32 _281_1 = ((_f_8 >> 2) & 1);
                        u32 _281_2 = ((_f_8 >> 3) & 1);
                        u32 _281_3 = ((_f_8 >> 4) & 1);
                        u32 _281_4 = ((_f_8 >> 5) & 1);
                        u32 _281_5 = ((_f_8 >> 6) & 1);
                        u32 _281_6 = ((_f_8 >> 7) & 1);
                        u32 _281_7 = ((_f_8 >> 8) & 1);
                        u32 _281_8 = ((_f_8 >> 9) & 1);
                        u32 _281_9 = ((_f_8 >> 10) & 1);
                        u32 _281_10 = ((_f_8 >> 11) & 1);
                        u32 _281_11 = ((_f_8 >> 12) & 1);
                        u32 _281_12 = ((_f_8 >> 13) & 1);
                        u32 _281_13 = ((_f_8 >> 14) & 1);
                        u32 _281_14 = ((_f_8 >> 15) & 1);
                        u32 _281_15 = ((_f_8 >> 16) & 1);
                        u32 _281_16 = ((_f_8 >> 17) & 1);
                        u32 _281_17 = ((_f_8 >> 18) & 1);
                        u32 _281_18 = ((_f_8 >> 19) & 1);
                        u32 _281_19 = ((_f_8 >> 20) & 1);
                        u32 _281_20 = ((_f_8 >> 21) & 1);
                        u32 _281_21 = ((_f_8 >> 22) & 1);
                        u32 _281_22 = ((_f_8 >> 23) & 1);
                        u32 _281_23 = ((_f_8 >> 24) & 1);
                        u32 _281_24 = ((_f_8 >> 25) & 1);
                        u32 _281_25 = ((_f_8 >> 26) & 1);
                        u32 _281_26 = ((_f_8 >> 27) & 1);
                        u32 _281_27 = ((_f_8 >> 28) & 1);
                        u32 _281_28 = ((_f_8 >> 29) & 1);
                        u32 _281_29 = ((_f_8 >> 30) & 1);
                        u32 _281_30 = ((_f_8 >> 31) & 1);
                        u64 _nd_424 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                        e.mem[_nd_424 + 0] = (((u64)_280_0 << 0) | ((u64)_281_0 << 1) | ((u64)_281_1 << 2) | ((u64)_281_2 << 3) | ((u64)_281_3 << 4) | ((u64)_281_4 << 5) | ((u64)_281_5 << 6) | ((u64)_281_6 << 7) | ((u64)_281_7 << 8) | ((u64)_281_8 << 9) | ((u64)_281_9 << 10) | ((u64)_281_10 << 11) | ((u64)_281_11 << 12) | ((u64)_281_12 << 13) | ((u64)_281_13 << 14) | ((u64)_281_14 << 15) | ((u64)_281_15 << 16) | ((u64)_281_16 << 17) | ((u64)_281_17 << 18) | ((u64)_281_18 << 19) | ((u64)_281_19 << 20) | ((u64)_281_20 << 21) | ((u64)_281_21 << 22) | ((u64)_281_22 << 23) | ((u64)_281_23 << 24) | ((u64)_281_24 << 25) | ((u64)_281_25 << 26) | ((u64)_281_26 << 27) | ((u64)_281_27 << 28) | ((u64)_281_28 << 29) | ((u64)_281_29 << 30) | ((u64)_281_30 << 31));
                        e.mem[_nd_424 + 1] = _f_9;
                        u64 _nd_425 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                        e.mem[_nd_425 + 0] = 100ull;
                        e.mem[_nd_425 + 1] = term_ctr(CID_SCON, _nd_424);
                        u64 _nd_426 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                        e.mem[_nd_426 + 0] = 99ull;
                        e.mem[_nd_426 + 1] = term_ctr(CID_SCON, _nd_425);
                        u64 _nd_427 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                        e.mem[_nd_427 + 0] = 98ull;
                        e.mem[_nd_427 + 1] = term_ctr(CID_SCON, _nd_426);
                        u64 _nd_428 = _sp_4 >= HEAP_OFF ? _sp_4 : heap_alloc(e, cls_fit(2));
                        e.mem[_nd_428 + 0] = 97ull;
                        e.mem[_nd_428 + 1] = term_ctr(CID_SCON, _nd_427);
                        if (!DEVICE && !seq && fid_nofk(FID_G)) {
                          u64 _t_32 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                          e.mem[_t_32 + 0] = term_ctr(CID_SCON, _nd_428);
                          return term_tsk(FID_G, _t_32);
                        }
                        r0 = term_ctr(CID_SCON, _nd_428);
                        WL_JMP(FID_G);
                      }
                    } else {
                      spare_free(e, cls_fit(2), _sp_3);
                      spare_free(e, cls_fit(2), _sp_2);
                      spare_free(e, cls_fit(2), _sp_1);
                      spare_free(e, cls_fit(2), _sp_0);
                      r0 = 4ull;
                      WL_RETN(1);
                    }
                  } else {
                    u32 _212_0 = ((_f_6 >> 0) & 1);
                    u32 _213_0 = ((_f_6 >> 1) & 1);
                    u32 _213_1 = ((_f_6 >> 2) & 1);
                    u32 _213_2 = ((_f_6 >> 3) & 1);
                    u32 _213_3 = ((_f_6 >> 4) & 1);
                    u32 _213_4 = ((_f_6 >> 5) & 1);
                    u32 _213_5 = ((_f_6 >> 6) & 1);
                    u32 _213_6 = ((_f_6 >> 7) & 1);
                    u32 _213_7 = ((_f_6 >> 8) & 1);
                    u32 _213_8 = ((_f_6 >> 9) & 1);
                    u32 _213_9 = ((_f_6 >> 10) & 1);
                    u32 _213_10 = ((_f_6 >> 11) & 1);
                    u32 _213_11 = ((_f_6 >> 12) & 1);
                    u32 _213_12 = ((_f_6 >> 13) & 1);
                    u32 _213_13 = ((_f_6 >> 14) & 1);
                    u32 _213_14 = ((_f_6 >> 15) & 1);
                    u32 _213_15 = ((_f_6 >> 16) & 1);
                    u32 _213_16 = ((_f_6 >> 17) & 1);
                    u32 _213_17 = ((_f_6 >> 18) & 1);
                    u32 _213_18 = ((_f_6 >> 19) & 1);
                    u32 _213_19 = ((_f_6 >> 20) & 1);
                    u32 _213_20 = ((_f_6 >> 21) & 1);
                    u32 _213_21 = ((_f_6 >> 22) & 1);
                    u32 _213_22 = ((_f_6 >> 23) & 1);
                    u32 _213_23 = ((_f_6 >> 24) & 1);
                    u32 _213_24 = ((_f_6 >> 25) & 1);
                    u32 _213_25 = ((_f_6 >> 26) & 1);
                    u32 _213_26 = ((_f_6 >> 27) & 1);
                    u32 _213_27 = ((_f_6 >> 28) & 1);
                    u32 _213_28 = ((_f_6 >> 29) & 1);
                    u32 _213_29 = ((_f_6 >> 30) & 1);
                    u32 _213_30 = ((_f_6 >> 31) & 1);
                    u64 _nd_429 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                    e.mem[_nd_429 + 0] = (((u64)_212_0 << 0) | ((u64)_213_0 << 1) | ((u64)_213_1 << 2) | ((u64)_213_2 << 3) | ((u64)_213_3 << 4) | ((u64)_213_4 << 5) | ((u64)_213_5 << 6) | ((u64)_213_6 << 7) | ((u64)_213_7 << 8) | ((u64)_213_8 << 9) | ((u64)_213_9 << 10) | ((u64)_213_10 << 11) | ((u64)_213_11 << 12) | ((u64)_213_12 << 13) | ((u64)_213_13 << 14) | ((u64)_213_14 << 15) | ((u64)_213_15 << 16) | ((u64)_213_16 << 17) | ((u64)_213_17 << 18) | ((u64)_213_18 << 19) | ((u64)_213_19 << 20) | ((u64)_213_20 << 21) | ((u64)_213_21 << 22) | ((u64)_213_22 << 23) | ((u64)_213_23 << 24) | ((u64)_213_24 << 25) | ((u64)_213_25 << 26) | ((u64)_213_26 << 27) | ((u64)_213_27 << 28) | ((u64)_213_28 << 29) | ((u64)_213_29 << 30) | ((u64)_213_30 << 31));
                    e.mem[_nd_429 + 1] = _f_7;
                    u64 _nd_430 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                    e.mem[_nd_430 + 0] = 99ull;
                    e.mem[_nd_430 + 1] = term_ctr(CID_SCON, _nd_429);
                    u64 _nd_431 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                    e.mem[_nd_431 + 0] = 98ull;
                    e.mem[_nd_431 + 1] = term_ctr(CID_SCON, _nd_430);
                    u64 _nd_432 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
                    e.mem[_nd_432 + 0] = 97ull;
                    e.mem[_nd_432 + 1] = term_ctr(CID_SCON, _nd_431);
                    if (!DEVICE && !seq && fid_nofk(FID_G)) {
                      u64 _t_33 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                      e.mem[_t_33 + 0] = term_ctr(CID_SCON, _nd_432);
                      return term_tsk(FID_G, _t_33);
                    }
                    r0 = term_ctr(CID_SCON, _nd_432);
                    WL_JMP(FID_G);
                  }
                } else {
                  u64 _nd_433 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                  e.mem[_nd_433 + 0] = 99ull;
                  e.mem[_nd_433 + 1] = _f_5;
                  u64 _nd_434 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                  e.mem[_nd_434 + 0] = 98ull;
                  e.mem[_nd_434 + 1] = term_ctr(CID_SCON, _nd_433);
                  u64 _nd_435 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                  e.mem[_nd_435 + 0] = 97ull;
                  e.mem[_nd_435 + 1] = term_ctr(CID_SCON, _nd_434);
                  if (!DEVICE && !seq && fid_nofk(FID_G)) {
                    u64 _t_34 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                    e.mem[_t_34 + 0] = term_ctr(CID_SCON, _nd_435);
                    return term_tsk(FID_G, _t_34);
                  }
                  r0 = term_ctr(CID_SCON, _nd_435);
                  WL_JMP(FID_G);
                }
              } else {
                u32 _144_0 = ((_f_4 >> 0) & 1);
                u32 _145_0 = ((_f_4 >> 1) & 1);
                u32 _145_1 = ((_f_4 >> 2) & 1);
                u32 _145_2 = ((_f_4 >> 3) & 1);
                u32 _145_3 = ((_f_4 >> 4) & 1);
                u32 _145_4 = ((_f_4 >> 5) & 1);
                u32 _145_5 = ((_f_4 >> 6) & 1);
                u32 _145_6 = ((_f_4 >> 7) & 1);
                u32 _145_7 = ((_f_4 >> 8) & 1);
                u32 _145_8 = ((_f_4 >> 9) & 1);
                u32 _145_9 = ((_f_4 >> 10) & 1);
                u32 _145_10 = ((_f_4 >> 11) & 1);
                u32 _145_11 = ((_f_4 >> 12) & 1);
                u32 _145_12 = ((_f_4 >> 13) & 1);
                u32 _145_13 = ((_f_4 >> 14) & 1);
                u32 _145_14 = ((_f_4 >> 15) & 1);
                u32 _145_15 = ((_f_4 >> 16) & 1);
                u32 _145_16 = ((_f_4 >> 17) & 1);
                u32 _145_17 = ((_f_4 >> 18) & 1);
                u32 _145_18 = ((_f_4 >> 19) & 1);
                u32 _145_19 = ((_f_4 >> 20) & 1);
                u32 _145_20 = ((_f_4 >> 21) & 1);
                u32 _145_21 = ((_f_4 >> 22) & 1);
                u32 _145_22 = ((_f_4 >> 23) & 1);
                u32 _145_23 = ((_f_4 >> 24) & 1);
                u32 _145_24 = ((_f_4 >> 25) & 1);
                u32 _145_25 = ((_f_4 >> 26) & 1);
                u32 _145_26 = ((_f_4 >> 27) & 1);
                u32 _145_27 = ((_f_4 >> 28) & 1);
                u32 _145_28 = ((_f_4 >> 29) & 1);
                u32 _145_29 = ((_f_4 >> 30) & 1);
                u32 _145_30 = ((_f_4 >> 31) & 1);
                u64 _nd_436 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
                e.mem[_nd_436 + 0] = (((u64)_144_0 << 0) | ((u64)_145_0 << 1) | ((u64)_145_1 << 2) | ((u64)_145_2 << 3) | ((u64)_145_3 << 4) | ((u64)_145_4 << 5) | ((u64)_145_5 << 6) | ((u64)_145_6 << 7) | ((u64)_145_7 << 8) | ((u64)_145_8 << 9) | ((u64)_145_9 << 10) | ((u64)_145_10 << 11) | ((u64)_145_11 << 12) | ((u64)_145_12 << 13) | ((u64)_145_13 << 14) | ((u64)_145_14 << 15) | ((u64)_145_15 << 16) | ((u64)_145_16 << 17) | ((u64)_145_17 << 18) | ((u64)_145_18 << 19) | ((u64)_145_19 << 20) | ((u64)_145_20 << 21) | ((u64)_145_21 << 22) | ((u64)_145_22 << 23) | ((u64)_145_23 << 24) | ((u64)_145_24 << 25) | ((u64)_145_25 << 26) | ((u64)_145_26 << 27) | ((u64)_145_27 << 28) | ((u64)_145_28 << 29) | ((u64)_145_29 << 30) | ((u64)_145_30 << 31));
                e.mem[_nd_436 + 1] = _f_5;
                u64 _nd_437 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
                e.mem[_nd_437 + 0] = 98ull;
                e.mem[_nd_437 + 1] = term_ctr(CID_SCON, _nd_436);
                u64 _nd_438 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
                e.mem[_nd_438 + 0] = 97ull;
                e.mem[_nd_438 + 1] = term_ctr(CID_SCON, _nd_437);
                if (!DEVICE && !seq && fid_nofk(FID_G)) {
                  u64 _t_35 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
                  e.mem[_t_35 + 0] = term_ctr(CID_SCON, _nd_438);
                  return term_tsk(FID_G, _t_35);
                }
                r0 = term_ctr(CID_SCON, _nd_438);
                WL_JMP(FID_G);
              }
            } else {
              spare_free(e, cls_fit(2), _sp_1);
              spare_free(e, cls_fit(2), _sp_0);
              r0 = 2ull;
              WL_RETN(1);
            }
          } else {
            u32 _76_0 = ((_f_2 >> 0) & 1);
            u32 _77_0 = ((_f_2 >> 1) & 1);
            u32 _77_1 = ((_f_2 >> 2) & 1);
            u32 _77_2 = ((_f_2 >> 3) & 1);
            u32 _77_3 = ((_f_2 >> 4) & 1);
            u32 _77_4 = ((_f_2 >> 5) & 1);
            u32 _77_5 = ((_f_2 >> 6) & 1);
            u32 _77_6 = ((_f_2 >> 7) & 1);
            u32 _77_7 = ((_f_2 >> 8) & 1);
            u32 _77_8 = ((_f_2 >> 9) & 1);
            u32 _77_9 = ((_f_2 >> 10) & 1);
            u32 _77_10 = ((_f_2 >> 11) & 1);
            u32 _77_11 = ((_f_2 >> 12) & 1);
            u32 _77_12 = ((_f_2 >> 13) & 1);
            u32 _77_13 = ((_f_2 >> 14) & 1);
            u32 _77_14 = ((_f_2 >> 15) & 1);
            u32 _77_15 = ((_f_2 >> 16) & 1);
            u32 _77_16 = ((_f_2 >> 17) & 1);
            u32 _77_17 = ((_f_2 >> 18) & 1);
            u32 _77_18 = ((_f_2 >> 19) & 1);
            u32 _77_19 = ((_f_2 >> 20) & 1);
            u32 _77_20 = ((_f_2 >> 21) & 1);
            u32 _77_21 = ((_f_2 >> 22) & 1);
            u32 _77_22 = ((_f_2 >> 23) & 1);
            u32 _77_23 = ((_f_2 >> 24) & 1);
            u32 _77_24 = ((_f_2 >> 25) & 1);
            u32 _77_25 = ((_f_2 >> 26) & 1);
            u32 _77_26 = ((_f_2 >> 27) & 1);
            u32 _77_27 = ((_f_2 >> 28) & 1);
            u32 _77_28 = ((_f_2 >> 29) & 1);
            u32 _77_29 = ((_f_2 >> 30) & 1);
            u32 _77_30 = ((_f_2 >> 31) & 1);
            u64 _nd_439 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
            e.mem[_nd_439 + 0] = (((u64)_76_0 << 0) | ((u64)_77_0 << 1) | ((u64)_77_1 << 2) | ((u64)_77_2 << 3) | ((u64)_77_3 << 4) | ((u64)_77_4 << 5) | ((u64)_77_5 << 6) | ((u64)_77_6 << 7) | ((u64)_77_7 << 8) | ((u64)_77_8 << 9) | ((u64)_77_9 << 10) | ((u64)_77_10 << 11) | ((u64)_77_11 << 12) | ((u64)_77_12 << 13) | ((u64)_77_13 << 14) | ((u64)_77_14 << 15) | ((u64)_77_15 << 16) | ((u64)_77_16 << 17) | ((u64)_77_17 << 18) | ((u64)_77_18 << 19) | ((u64)_77_19 << 20) | ((u64)_77_20 << 21) | ((u64)_77_21 << 22) | ((u64)_77_22 << 23) | ((u64)_77_23 << 24) | ((u64)_77_24 << 25) | ((u64)_77_25 << 26) | ((u64)_77_26 << 27) | ((u64)_77_27 << 28) | ((u64)_77_28 << 29) | ((u64)_77_29 << 30) | ((u64)_77_30 << 31));
            e.mem[_nd_439 + 1] = _f_3;
            u64 _nd_440 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
            e.mem[_nd_440 + 0] = 97ull;
            e.mem[_nd_440 + 1] = term_ctr(CID_SCON, _nd_439);
            if (!DEVICE && !seq && fid_nofk(FID_G)) {
              u64 _t_36 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
              e.mem[_t_36 + 0] = term_ctr(CID_SCON, _nd_440);
              return term_tsk(FID_G, _t_36);
            }
            r0 = term_ctr(CID_SCON, _nd_440);
            WL_JMP(FID_G);
          }
        } else {
          u64 _nd_441 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
          e.mem[_nd_441 + 0] = 97ull;
          e.mem[_nd_441 + 1] = _f_1;
          if (!DEVICE && !seq && fid_nofk(FID_G)) {
            u64 _t_37 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
            e.mem[_t_37 + 0] = term_ctr(CID_SCON, _nd_441);
            return term_tsk(FID_G, _t_37);
          }
          r0 = term_ctr(CID_SCON, _nd_441);
          WL_JMP(FID_G);
        }
      } else {
        u32 _8_0 = ((_f_0 >> 0) & 1);
        u32 _9_0 = ((_f_0 >> 1) & 1);
        u32 _9_1 = ((_f_0 >> 2) & 1);
        u32 _9_2 = ((_f_0 >> 3) & 1);
        u32 _9_3 = ((_f_0 >> 4) & 1);
        u32 _9_4 = ((_f_0 >> 5) & 1);
        u32 _9_5 = ((_f_0 >> 6) & 1);
        u32 _9_6 = ((_f_0 >> 7) & 1);
        u32 _9_7 = ((_f_0 >> 8) & 1);
        u32 _9_8 = ((_f_0 >> 9) & 1);
        u32 _9_9 = ((_f_0 >> 10) & 1);
        u32 _9_10 = ((_f_0 >> 11) & 1);
        u32 _9_11 = ((_f_0 >> 12) & 1);
        u32 _9_12 = ((_f_0 >> 13) & 1);
        u32 _9_13 = ((_f_0 >> 14) & 1);
        u32 _9_14 = ((_f_0 >> 15) & 1);
        u32 _9_15 = ((_f_0 >> 16) & 1);
        u32 _9_16 = ((_f_0 >> 17) & 1);
        u32 _9_17 = ((_f_0 >> 18) & 1);
        u32 _9_18 = ((_f_0 >> 19) & 1);
        u32 _9_19 = ((_f_0 >> 20) & 1);
        u32 _9_20 = ((_f_0 >> 21) & 1);
        u32 _9_21 = ((_f_0 >> 22) & 1);
        u32 _9_22 = ((_f_0 >> 23) & 1);
        u32 _9_23 = ((_f_0 >> 24) & 1);
        u32 _9_24 = ((_f_0 >> 25) & 1);
        u32 _9_25 = ((_f_0 >> 26) & 1);
        u32 _9_26 = ((_f_0 >> 27) & 1);
        u32 _9_27 = ((_f_0 >> 28) & 1);
        u32 _9_28 = ((_f_0 >> 29) & 1);
        u32 _9_29 = ((_f_0 >> 30) & 1);
        u32 _9_30 = ((_f_0 >> 31) & 1);
        u64 _nd_442 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
        e.mem[_nd_442 + 0] = (((u64)_8_0 << 0) | ((u64)_9_0 << 1) | ((u64)_9_1 << 2) | ((u64)_9_2 << 3) | ((u64)_9_3 << 4) | ((u64)_9_4 << 5) | ((u64)_9_5 << 6) | ((u64)_9_6 << 7) | ((u64)_9_7 << 8) | ((u64)_9_8 << 9) | ((u64)_9_9 << 10) | ((u64)_9_10 << 11) | ((u64)_9_11 << 12) | ((u64)_9_12 << 13) | ((u64)_9_13 << 14) | ((u64)_9_14 << 15) | ((u64)_9_15 << 16) | ((u64)_9_16 << 17) | ((u64)_9_17 << 18) | ((u64)_9_18 << 19) | ((u64)_9_19 << 20) | ((u64)_9_20 << 21) | ((u64)_9_21 << 22) | ((u64)_9_22 << 23) | ((u64)_9_23 << 24) | ((u64)_9_24 << 25) | ((u64)_9_25 << 26) | ((u64)_9_26 << 27) | ((u64)_9_27 << 28) | ((u64)_9_28 << 29) | ((u64)_9_29 << 30) | ((u64)_9_30 << 31));
        e.mem[_nd_442 + 1] = _f_1;
        if (!DEVICE && !seq && fid_nofk(FID_G)) {
          u64 _t_38 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
          e.mem[_t_38 + 0] = term_ctr(CID_SCON, _nd_442);
          return term_tsk(FID_G, _t_38);
        }
        r0 = term_ctr(CID_SCON, _nd_442);
        WL_JMP(FID_G);
      }
    } else {
      if (!DEVICE && !seq && fid_nofk(FID_G)) {
        u64 _t_39 = task_node(e, FID_G, WL_CONT, WL_IDX, 0);
        e.mem[_t_39 + 0] = _s_0;
        return term_tsk(FID_G, _t_39);
      }
      r0 = _s_0;
      WL_JMP(FID_G);
    }
  }}
#endif

// A task enters through its words: a continuation's results ride r0.. and
// its parameters the stack; any other segment's parameters ride r0...
  WL_CASE(FID_ENTER)
  {
    Term t = r0;
    WL_OPEN
    Fid f   = (u32)term_aux(t);
    Loc a   = term_loc(t);
    u32 war = fid_arity(f);
    WL_FRAME(t)
    seq |= fid_nofk(f) << 1;
    if (fid_seqk(f)) {
      u32 rw = fid_resw(f);
      WL_LOAD(a + war - rw, rw)
      WL_ARGS(a, war - rw + 1)
    } else {
      WL_LOAD(a, war)
    }
    heap_free(e, cls_fit(war + 2), a);
    WL_DYN(f);
  }}

  WL_CASE(FID_IO_EMIT)
  {
    Term x = r0;
    WL_OPEN
    Loc l = heap_alloc(e, 0);
    e.mem[l] = x;
    r0 = term_ctr(CID_EMIT, l);
    WL_RETN(1);
  }}

  WL_CASE(FID_CLO_APPLY)
  {
    Term fun = r0;
    Term arg = r1;
    WL_OPEN
    Fid f    = (Fid)term_aux(fun);
    u32 war  = fid_arity(f) - 1;
    Loc a    = term_loc(fun);
    WL_LOAD(a, war)
    spare_free(e, cls_fit(war), a);
    WL_LAST(arg)
    WL_DYN(f);
  }}

  WL_CASE(FID_EXIT)
  {
    u32  n = rn;
    Term rv[WL_RESW];
    WL_SAVE(rv)
    WL_OPEN
    if (err_seen(e.mem)) {
      return 0;
    }
    sp -= 2 * LANE_STEP;
    Term cont = STK(0);
    u32  idx  = (u32)STK(1);
    if (cont != TERM_HOLE && fid_seqk((u32)term_aux(cont))) {
      Fid wf = (u32)term_aux(cont);
      Loc wa = term_loc(cont);
      u32 wn = fid_arity(wf);
      WL_FRAME(cont)
      seq = (seq & 1) | fid_nofk(wf) << 1;
      WL_ARGS(wa, wn - n + 1)
      heap_free(e, cls_fit(wn + 2), wa);
      WL_TAKE(rv)
      WL_DYN(wf);
    }
    return task_deliver(e.mem, cont, idx, rv, n);
  }}

#if DEVICE
  default: {
    err_post(e.mem, ERR_FIDS);
    return 0;
  }
  }
  }
}
#endif

// Monk
// ====

// One turn on a ring: its head task below put0 runs (a growing lane skips
// a fork-free one). The host grows a row ring by ring and works a ring
// until it drains; a device lane does both.
INLINE u32 monk_step(Env e, Stk stk, Ring rg, u32 put0, bool seq, u32 base,
  u32 stride, Cur cur) {
  Corpus   H   = e.mem;
  DEV u32* get = ring_get(H, rg);
  if (*get == put0) {
    return 0;
  }
  DEV u32* lo = (DEV u32*)ring_slot(H, rg, *get);
  u32      hi = a32_load_acq(lo + 1);
  Term     t  = (((u64)hi << 32) | a32_load(lo)) & ~RFC_BIT;
  if ((hi >> 31) != ring_lap(*get) || (!seq && fid_nofk((u32)term_aux(t)))) {
    return 0;
  }
  a32_store(get, *get + 1);
  u32 spin = 0;
  for (;;) {
    Reply r = work_loop(e, stk, t, seq);
    if (r == 0) {
      return 2;
    }
    if ((u32)H[task_tail(r) + 1] == 0) {
      if (err_spun(H, &spin)) {
        return 2;
      }
      if (stride != 0 && fid_nofk((u32)term_aux(r))) {
        ring_push(H, ring_pick(base, stride, cur), r);
        return 2;
      }
      t      = r;
      seq    = false;
      stride = 0;
      continue;
    }
    task_deal(H, r, base, stride, cur);
    return 1;
  }
}

// Dev
// ===

// TG_HOLD words of threadgroup memory (lane 0's write keeps them) hold
// one group per Apple core: without them bitonic runs 1.35x, kmeans
// 1.19x, matmul 1.13x. A grow pass ends when its group is full or nothing
// grew, as row_grow does, so a spine of forks unrolls whole.

#if DEVICE

INLINE void dev_cut(Env e) {
  if (err_seen(e.mem)) {
    return;
  }
  for (Cls c = 0; c < NCLS_ALL; c += 1) {
    u64 gen = (u64)KEEP(c) << c;
    while (ALC_LEN(e, c) >= gen) {
      Loc head = ALC_AT(e, c);
      Loc tail = head;
      for (u32 i = KEEP(c); --i;) {
        tail = e.mem[tail];
      }
      ALC_AT(e, c)    = e.mem[tail];
      ALC_LEN(e, c)  -= gen;
      e.mem[tail]     = 0;
      bank_push(e.mem, c, head);
    }
  }
}

// Pass 2, one group: each bank's [top, wr) slides onto rd, CUBE_T entries
// a step (loads, barrier, stores: rd <= top), off the host's pages.
INLINE void bank_pack(Corpus H, u32 lane) {
  for (Cls c = 0; c < NCLS_ALL; c += 1) {
    DEV Bank* b  = bank_at(H, c);
    u32       rd = b->rd;
    u32       n  = b->wr - b->top;
    for (u32 i = 0; i < n; i += CUBE_T) {
      Term v = i + lane < n ? H[b->off + b->top + i + lane] : 0;
      BAR();
      if (i + lane < n) {
        H[b->off + rd + i + lane] = v;
      }
    }
    BAR();
    if (lane == 0) {
      b->rd = b->wr = b->top = rd + n;
    }
  }
}

// One kernel, one pipeline: pass 0 grows the frontier (a task a lane a
// turn, votes between barriers), pass 1 works it (a lane drains its
// ring), pass 2 packs the banks; one call of monk_step, so the program
// compiles once.
#ifdef __METAL_VERSION__
kernel void bend_dev(Corpus H [[buffer(0)]], constant u32& pass [[buffer(1)]],
  threadgroup volatile u64* hold [[threadgroup(0)]],
  u32 grids [[threadgroups_per_grid]],
  u32 row [[threadgroup_position_in_grid]],
  u32 lane [[thread_position_in_threadgroup]]) {
#else
extern "C" __global__ void bend_dev(Corpus H, u32 pass) {
  extern __shared__ volatile u64 hold[];
  u32 grids = gridDim.x;
  u32 row   = blockIdx.x;
  u32 lane  = threadIdx.x;
#endif
  if (pass == 2) {
    bank_pack(H, lane);
    return;
  }
  u32  stride = grids == 1 ? CUBE_G : 1;
  u32  me     = row * CUBE_T + stride * lane;
  Ring rg     = pass ? ring_flip(me) : me;
  Env  e      = { H, H + ALC_OFF + me };
  Stk  stk    = (Stk)(H + STAK_OFF + me);
  if (lane == 0) {
    hold[0] = 0;
  }
  GA32 tg_cur, tg_grew, tg_has;
  g32_ini(&tg_cur);
  g32_ini(&tg_grew);
  g32_ini(&tg_has);
  BAR();
  u32 put0      = a32_load(ring_put(H, rg));
  u32 seen_has  = 0;
  u32 seen_grew = 0;
  for (;;) {
    if (pass) {
      if (*ring_get(H, rg) == put0 || err_seen(H)) {
        break;
      }
    } else {
      put0 = a32_load(ring_put(H, rg));
      u32 vote = put0 != a32_load(ring_get(H, rg));
      if (lane == 0 && (err_seen(H) || root_done(H))) {
        vote = CUBE_T;
      }
      g32_add(&tg_has, vote);
      BAR();
      u32 has = g32_get(&tg_has);
      if (has - seen_has >= CUBE_T) {
        break;
      }
      seen_has = has;
    }
    u32 ran = monk_step(e, stk, rg, put0, pass, pass ? rg : row * CUBE_T,
      pass ? 0 : stride, &tg_cur);
    if (!pass) {
      if (ran == 1) {
        g32_add(&tg_grew, 1);
      }
      BARD();
      u32 grew = g32_get(&tg_grew);
      if (grew == seen_grew) {
        break;
      }
      seen_grew = grew;
    }
  }
  dev_cut(e);
}

#endif

// Window
// ======

// The Linux kit's fill, the Mac's window_msl in the runtime's dialect:
// a ! build carries window_dev in its cubin, a host build walks the
// pixels itself. An Image is a quadtree over 2^k x 2^k: a Qua at level
// i splits its square in four (tl, tr, bl, br), a Qua under the pixels
// follows tl, a Pix is 0xRRGGBB.
#if defined(__linux__) || defined(BEND_RTC)

INLINE u32 window_pix(Corpus H, Term t, u32 k, u32 x, u32 y) {
  for (u32 i = k; term_tag(t) == TAG_CTR;) {
    u32 j = 0;
    if (i > 0) {
      i -= 1;
      j = ((y >> i) & 1) * 2 + ((x >> i) & 1);
    }
    Loc l = term_rfc(t) ? H[term_loc(t)] >> 24 : term_loc(t);
    t = H[l + j];
  }
  return (u32)term_loc(t) & 0xFFFFFF;
}

#ifdef BEND_RTC
extern "C" __global__ void window_dev(Corpus H, Term root, u32 w, u32 h,
  u32 k, u32* out) {
  u32 x = blockIdx.x * blockDim.x + threadIdx.x;
  u32 y = blockIdx.y * blockDim.y + threadIdx.y;
  if (x < w && y < h) {
    out[y * w + x] = window_pix(H, root, k, x, y);
  }
}
#endif

#endif

#if !DEVICE

// Row
// ===

static void row_grow(Env e, Stk stk, u32 base, u32 stride, u32 want) {
  Corpus H = e.mem;
  u32 cur = 0;
  for (;;) {
    u32 put0[CUBE_T];
    u32 has = 0;
    for (u32 i = 0; i < CUBE_T; i += 1) {
      put0[i] = *ring_put(H, base + i * stride);
      has += put0[i] != *ring_get(H, base + i * stride);
    }
    if (root_done(H) || has >= want) {
      return;
    }
    u32 grew = 0;
    u32 ran  = 0;
    for (u32 i = 0; i < CUBE_T && ran != 2; i += 1) {
      ran   = monk_step(e, stk, base + i * stride, put0[i], false, base,
        stride, &cur);
      grew += ran == 1;
    }
    if (grew == 0) {
      return;
    }
  }
}

// Pool
// ====

static void* pool_try(void* at, u64 bytes) {
  return mmap(at, bytes, PROT_READ | PROT_WRITE,
    MAP_PRIVATE | MAP_ANON | MAP_NORESERVE, -1, 0);
}

static void* pool_mmap(u64 bytes) {
  void* p = pool_try(NULL, bytes);
  if (p == MAP_FAILED) {
    err_fail("reservation failed");
  }
  return p;
}

static Term* pool_stack(void) {
  u64   len = 1ull << 31;
  char* p   = pool_mmap(len + 16384 + SIGSTKSZ);
  if (mprotect(p + len, 16384, PROT_NONE) != 0) {
    err_fail("stack guard failed");
  }
  stack_t ss = { .ss_sp = p + len + 16384, .ss_size = SIGSTKSZ };
  sigaltstack(&ss, NULL);
  struct sigaction sa = { .sa_handler = err_trap, .sa_flags = SA_ONSTACK };
  sigaction(SIGSEGV, &sa, NULL);
  sigaction(SIGBUS, &sa, NULL);
  return (Term*)p;
}

static void* pool_work(void* arg) {
  Term* stk  = pool_stack();
  u64   seen = 0;
  for (;;) {
    pthread_mutex_lock(&pool_lock);
    while (atomic_load_explicit(&pool_tick, memory_order_acquire) == seen) {
      pthread_cond_wait(&pool_wake, &pool_lock);
    }
    pthread_mutex_unlock(&pool_lock);
    seen = atomic_load_explicit(&pool_tick, memory_order_acquire);
    Env e = { CORPUS, ALC[1 + (u32)(uintptr_t)arg] };
    for (;;) {
      u32 r = atomic_fetch_add_explicit(&pool_row, 1, memory_order_relaxed);
      if (r >= (pool_grow ? CUBE_G : LANES / LINE)) {
        break;
      }
      if (pool_grow) {
        row_grow(e, stk, r * CUBE_T, 1, CUBE_T);
      } else {
        u32  step = CUBE_T / LINE;
        Ring row  = r / step * CUBE_T;
        for (Ring rg = row + r % step; rg < row + CUBE_T; rg += step) {
          u32 put0 = a32_load(ring_put(e.mem, rg));
          while (*ring_get(e.mem, rg) != put0 && !err_seen(e.mem)) {
            monk_step(e, stk, rg, put0, true, rg, 0, NULL);
          }
        }
      }
    }
    u32 done = atomic_fetch_add_explicit(&pool_done, 1, memory_order_release);
    if (done + 1 == pool_size) {
      pthread_mutex_lock(&pool_lock);
      pthread_cond_broadcast(&pool_wake);
      pthread_mutex_unlock(&pool_lock);
    }
  }
}

OUTLINE void pool_open(void) {
  static bool up;
  if (up) {
    return;
  }
  up = true;
  for (u32 w = 0; w < pool_size; w += 1) {
    pthread_t tid;
    if (pthread_create(&tid, NULL, pool_work, (void*)(uintptr_t)w)) {
      err_fail("pthread_create");
    }
  }
}

// The CPUs this process may use: affinity mask under the cgroup quota
static int cpu_read(const char* path, long* a, long* b) {
  FILE* f = fopen(path, "r");
  int   n = f == NULL ? 0 : fscanf(f, "%ld %ld", a, b);
  if (f != NULL) {
    fclose(f);
  }
  return n;
}

static long cpu_count(void) {
  long n = sysconf(_SC_NPROCESSORS_ONLN);
#ifdef __linux__
  cpu_set_t set;
  if (sched_getaffinity(0, sizeof set, &set) == 0) {
    n = CPU_COUNT(&set);
  }
  long q = 0;
  long p = 0;
  if (cpu_read("/sys/fs/cgroup/cpu.max", &q, &p) != 2) {
    cpu_read("/sys/fs/cgroup/cpu/cpu.cfs_quota_us", &q, &p);
    cpu_read("/sys/fs/cgroup/cpu/cpu.cfs_period_us", &p, &p);
  }
  if (q > 0 && p > 0 && (q + p - 1) / p < n) {
    n = (q + p - 1) / p;
  }
#endif
  return n;
}

OUTLINE void pool_turn(bool grow) {
  pool_grow = grow;
  atomic_store_explicit(&pool_row, 0, memory_order_relaxed);
  atomic_store_explicit(&pool_done, 0, memory_order_relaxed);
  pthread_mutex_lock(&pool_lock);
  atomic_fetch_add_explicit(&pool_tick, 1, memory_order_release);
  pthread_cond_broadcast(&pool_wake);
  while (atomic_load_explicit(&pool_done, memory_order_acquire) < pool_size) {
    pthread_cond_wait(&pool_wake, &pool_lock);
  }
  pthread_mutex_unlock(&pool_lock);
}

// Gpu
// ===

// gpu_make compiles the device program and, given a path, writes it as
// <binary>.gpu (--gpu-build, run by bend -o): Metal's binary archive
// of the pipeline (keyed by the compiled function, so a wrong file
// misses), CUDA's cubin behind a hash of the text. A launch loads it,
// else notes and compiles (Metal's OS cache keeps that pipeline; CUDA
// writes the file).

static const char* gpu_path(void) {
  static char path[4096];
  u32 n = sizeof path - 8;
#ifdef __APPLE__
  _NSGetExecutablePath(path, &n);
#else
  path[readlink("/proc/self/exe", path, n)] = 0;
#endif
  return strcat(path, ".gpu");
}

static void gpu_note(const char* path) {
  fprintf(stderr, "bend: compiling the GPU program (%s is missing or"
    " stale)\n", path);
}

#if !BEND_CUDA
#define gpu_map pool_mmap
#endif

#if BEND_METAL || BEND_CUDA

static void gpu_kernel(u32 pass, u32 groups);

static void gpu_run(u32 f) {
  if (f < CUBE_T) {
    gpu_kernel(0, 1);
  }
  if (f < LANES) {
    gpu_kernel(0, CUBE_G);
  }
  gpu_kernel(1, CUBE_G);
  gpu_kernel(2, 1);
}

#endif

#if BEND_CUDA

static u64 gpu_hash(void) {
  u64 key = 14695981039346656037ull ^ CUBE_LOG;
  for (const char* p = BEND_SRC; *p != 0; p += 1) {
    key = (key ^ (u8)*p) * 1099511628211ull;
  }
  return key;
}

#endif

#if BEND_METAL

static bool gpu_probe(void) {
  return (gpu_dev = MTLCreateSystemDefaultDevice()) != nil;
}

static MTLComputePipelineDescriptor* gpu_desc(void) {
  NSError* err = nil;
  MTLCompileOptions* opts = [MTLCompileOptions new];
  opts.mathMode = MTLMathModeSafe;
  opts.preprocessorMacros = @{ @"CUBE_LOG": @(CUBE_LOG) };
  id<MTLLibrary> lib = [gpu_dev newLibraryWithSource:@(BEND_SRC) options:opts
    error:&err];
  if (!lib) {
    err_fail([[err localizedDescription] UTF8String]);
  }
  MTLComputePipelineDescriptor* d = [MTLComputePipelineDescriptor new];
  d.computeFunction = [lib newFunctionWithName:@"bend_dev"];
  return d;
}

static bool gpu_make(const char* path) {
  NSError* err = nil;
  id<MTLBinaryArchive> ar = [gpu_dev
    newBinaryArchiveWithDescriptor:[MTLBinaryArchiveDescriptor new] error:&err];
  if (![ar addComputePipelineFunctionsWithDescriptor:gpu_desc() error:&err]) {
    err_fail([[err localizedDescription] UTF8String]);
  }
  return [ar serializeToURL:[NSURL fileURLWithPath:@(path)] error:&err];
}

static id<MTLComputePipelineState> gpu_pipe(MTLComputePipelineDescriptor* d,
  id<MTLBinaryArchive> ar) {
  NSError* err = nil;
  d.binaryArchives = ar ? @[ar] : @[];
  id<MTLComputePipelineState> pso = [gpu_dev
    newComputePipelineStateWithDescriptor:d
    options:ar ? MTLPipelineOptionFailOnBinaryArchiveMiss : 0 reflection:nil
    error:&err];
  if (!pso && !ar) {
    err_fail([[err localizedDescription] UTF8String]);
  }
  return pso;
}

static u64 gpu_span(void) {
  u64 span = [gpu_dev recommendedMaxWorkingSetSize];
  u64 most = [gpu_dev maxBufferLength];
  span = span < most ? span : most;
  return span < (2ull << 30) ? span : 2ull << 30;
}

static void gpu_load(u64 bytes) {
  gpu_buf = [gpu_dev newBufferWithBytesNoCopy:CORPUS length:bytes
    options:MTLResourceStorageModeShared
      | MTLResourceHazardTrackingModeUntracked deallocator:nil];
  if (!gpu_buf) {
    err_fail("the GPU span is more than the device has");
  }
  @autoreleasepool {
    gpu_que = [gpu_dev newCommandQueue];
    const char* path = gpu_path();
    MTLBinaryArchiveDescriptor* ad = [MTLBinaryArchiveDescriptor new];
    ad.url = [NSURL fileURLWithPath:@(path)];
    MTLComputePipelineDescriptor* d = gpu_desc();
    id<MTLBinaryArchive> ar = [gpu_dev newBinaryArchiveWithDescriptor:ad
      error:nil];
    gpu_pso = ar ? gpu_pipe(d, ar) : nil;
    if (!gpu_pso) {
      gpu_note(path);
      gpu_pso = gpu_pipe(d, nil);
    }
  }
}

static void gpu_kernel(u32 pass, u32 groups) {
  [gpu_enc setComputePipelineState:gpu_pso];
  [gpu_enc setBuffer:gpu_buf offset:0 atIndex:0];
  [gpu_enc setBytes:&pass length:sizeof pass atIndex:1];
  [gpu_enc setThreadgroupMemoryLength:TG_HOLD * 8 atIndex:0];
  [gpu_enc dispatchThreadgroups:MTLSizeMake(groups, 1, 1)
    threadsPerThreadgroup:MTLSizeMake(CUBE_T, 1, 1)];
  [gpu_enc memoryBarrierWithScope:MTLBarrierScopeBuffers];
}

static void gpu_pass(u32 f) {
  @autoreleasepool {
    id<MTLCommandBuffer> cb = [gpu_que commandBuffer];
    gpu_enc = [cb computeCommandEncoder];
    gpu_run(f);
    [gpu_enc endEncoding];
    [cb commit];
    [cb waitUntilCompleted];
    if ([cb error]) {
      err_fail([[[cb error] localizedDescription] UTF8String]);
    }
  }
}

#elif BEND_CUDA

// the bag from the device: a group of 128 lanes per 64 KB of L2, a power of
// two from 16 to 128 groups. Apple keeps the 128 the bag was tuned on: on an
// M4 (10 cores) 32 groups ran bitonic 1.85 -> 1.29 s, but the light one-pass
// benches 1.25x, their lanes four times fewer.
static void gpu_shape(int units) {
  CUBE_LOG = 31 - CLZ(units < 16 ? 16 : units > 128 ? 128 : units);
}

static bool gpu_probe(void) {
  int       managed = 0;
  CUcontext ctx;
  // one stream, so one hardware queue: the default 8 each cost a channel
  // at context creation and teardown, about half of the startup
  setenv("CUDA_DEVICE_MAX_CONNECTIONS", "1", 0);
  if (cuInit(0) == CUDA_SUCCESS && cuDeviceGet(&gpu_dev, 0) == CUDA_SUCCESS) {
    cuDeviceGetAttribute(&managed,
      CU_DEVICE_ATTRIBUTE_CONCURRENT_MANAGED_ACCESS, gpu_dev);
  }
  int l2 = 1 << 23;
  cuDeviceGetAttribute(&l2, CU_DEVICE_ATTRIBUTE_L2_CACHE_SIZE, gpu_dev);
  gpu_shape(l2 >> 16);
  return managed != 0
    && cuDevicePrimaryCtxRetain(&ctx, gpu_dev) == CUDA_SUCCESS
    && cuCtxSetCurrent(ctx) == CUDA_SUCCESS;
}

static Corpus gpu_map(u64 bytes) {
  CUdeviceptr p = 0;
  if (cuMemAllocManaged(&p, bytes, CU_MEM_ATTACH_GLOBAL) != CUDA_SUCCESS) {
    err_fail("corpus reservation failed");
  }
#if CUDA_VERSION >= 13000
  cuMemAdvise(p, bytes, CU_MEM_ADVISE_SET_PREFERRED_LOCATION,
    (CUmemLocation){ CU_MEM_LOCATION_TYPE_DEVICE, gpu_dev });
#else
  cuMemAdvise(p, bytes, CU_MEM_ADVISE_SET_PREFERRED_LOCATION, gpu_dev);
#endif
  return (Corpus)(uintptr_t)p;
}

static bool gpu_make(const char* path) {
  int cc[2] = {0, 0};
  cuDeviceGetAttribute(cc,
    CU_DEVICE_ATTRIBUTE_COMPUTE_CAPABILITY_MAJOR, gpu_dev);
  cuDeviceGetAttribute(cc + 1,
    CU_DEVICE_ATTRIBUTE_COMPUTE_CAPABILITY_MINOR, gpu_dev);
  char arch[40];
  char bag[24];
  snprintf(arch, sizeof arch, "--gpu-architecture=sm_%d%d", cc[0], cc[1]);
  snprintf(bag, sizeof bag, "-DCUBE_LOG=%u", CUBE_LOG);
  const char* opts[] = { arch, bag, "--fmad=false", "-default-device" };
  nvrtcProgram prog;
  if (nvrtcCreateProgram(&prog, BEND_SRC, "bend.cu", 0, NULL, NULL)
    != NVRTC_SUCCESS) {
    err_fail("cannot compile the CUDA library");
  }
  if (nvrtcCompileProgram(prog, 4, opts) != NVRTC_SUCCESS) {
    size_t n = 0;
    nvrtcGetProgramLogSize(prog, &n);
    char* log = calloc(n + 1, 1);
    if (log != NULL && nvrtcGetProgramLog(prog, log) == NVRTC_SUCCESS) {
      fprintf(stderr, "%s\n", log);
    }
    err_fail("cannot compile the CUDA library");
  }
  size_t len = 0;
  nvrtcGetCUBINSize(prog, &len);
  char* bin = malloc(len);
  if (bin == NULL || nvrtcGetCUBIN(prog, bin) != NVRTC_SUCCESS) {
    err_fail("cannot load the CUDA library");
  }
  nvrtcDestroyProgram(&prog);
  u64   key = gpu_hash();
  FILE* out = path == NULL ? NULL : fopen(path, "wb");
  bool  ok  = out != NULL && fwrite(&key, 8, 1, out) == 1
    && fwrite(bin, 1, len, out) == len && fclose(out) == 0;
  if (cuModuleLoadData(&gpu_lib, bin) != CUDA_SUCCESS) {
    err_fail("cannot load the CUDA library");
  }
  free(bin);
  return path == NULL || ok;
}

static u64 gpu_span(void) {
  size_t span = 0;
  cuDeviceTotalMem(&span, gpu_dev);
  return span;
}

static void gpu_load(u64 bytes) {
  const char* path = gpu_path();
  int         fd   = open(path, O_RDONLY);
  struct stat st   = { 0 };
  u64         key  = 0;
  char*       bin  = fd < 0 || fstat(fd, &st) != 0 || st.st_size <= 8 ? NULL
    : mmap(NULL, st.st_size, PROT_READ, MAP_PRIVATE, fd, 0);
  if (bin != NULL && bin != MAP_FAILED) {
    memcpy(&key, bin, 8);
  }
  if (key != gpu_hash()
    || cuModuleLoadData(&gpu_lib, bin + 8) != CUDA_SUCCESS) {
    gpu_note(path);
    gpu_make(path);
  }
  if (cuModuleGetFunction(&gpu_pso, gpu_lib, "bend_dev") != CUDA_SUCCESS) {
    err_fail("cannot load the GPU program");
  }
}

static void gpu_kernel(u32 pass, u32 groups) {
  void* args[] = { &CORPUS, &pass };
  if (cuLaunchKernel(gpu_pso, groups, 1, 1, CUBE_T, 1, 1, TG_HOLD * 8, NULL,
    args, NULL) != CUDA_SUCCESS) {
    err_fail("device launch failed");
  }
}

static void gpu_pass(u32 f) {
  gpu_run(f);
  if (cuCtxSynchronize() != CUDA_SUCCESS) {
    err_fail("device fault");
  }
}

#else

#define gpu_probe() false
#define gpu_make(p) true
#define gpu_span()  0
#define gpu_load(b)
#define gpu_pass(f)

#endif

// Cube
// ====

static void cube_run(Corpus H, bool gpu) {
  for (;;) {
    u32 f = a32_load(a32_at(H, H_CURSOR));
    a32_store(a32_at(H, H_CURSOR), 0);
    if (root_done(H)) {
      return;
    }
    if (f == 0) {
      err_fail("frontier drained without a result");
    }
    if (gpu) {
      gpu_pass(f);
    } else {
      // Under a unit (CUBE_T / LINE a row) per thread, the column grows to
      // the rows that give one; no more: each touches a page of every plane.
      if (f * (CUBE_T / LINE) < pool_size) {
        row_grow((Env){ H, ALC[0] }, io_stk, 0, CUBE_G,
          (pool_size + CUBE_T / LINE - 1) / (CUBE_T / LINE));
      }
      if (f < CUBE) {
        pool_turn(true);
      }
      pool_turn(false);
    }
    u32 ec = a32_load(a32_at(H, H_ERROR_CODE));
    if (ec != 0) {
      err_post(H, ec);
    }
  }
}

// Corpus
// ======

// The cores map 8 GiB at a high base and double it in place, a hint then
// a check (MAP_FIXED would replace a neighbour), so one base holds every
// Loc and a run pays for the room it reaches. The banks lie past the pages
// and move up at each step. The GPU maps its whole span once.

static u64 corpus_size;

static void* corpus_map(u64 size) {
  u64   hint = 1ull << 45;
  void* p    = pool_try((void*)hint, size);
  while (p != (void*)hint && hint > size) {
    if (p != MAP_FAILED) {
      munmap(p, size);
    }
    hint /= 2;
    p     = pool_try((void*)hint, size);
  }
  if (p == MAP_FAILED) {
    err_fail("reservation failed");
  }
  return p;
}

static void corpus_lay(Corpus H, u64 size) {
  u64 span = size / 8;
  u64 cap  = span > HEAP_OFF ? (span - HEAP_OFF) / (PAGE_LEN + 10) : 0;
  if (cap <= CUBE) {
    err_fail("the GPU span is under the rings, stacks and a page per lane");
  }
  cap = cap < ~0u ? cap : ~0u - 1;
  u64 at = HEAP_OFF + (cap << PAGE_BITS);
  for (u32 c = 0; c < NCLS_ALL; c += 1) {
    Bank* b = bank_at(H, c);
    memcpy(H + at, H + b->off, b->wr * sizeof(u64));
    b->off  = at;
    at     += 2 * (cap >> ((c < NCLS ? NCLS : c) - PAGE_BITS));
  }
  corpus_size = size;
  a32_store_rel(a32_at(H, H_CAP), (u32)cap);
}

static bool corpus_grow(Corpus H, u64 need) {
  bool ok = true;
  LOCK(bank_lock);
  while (ok && need > a32_load(a32_at(H, H_CAP))) {
    u64   more = corpus_size;
    char* at   = (char*)H + more;
    void* got  = io_gpu || more >= 1ull << 43 ? MAP_FAILED
      : pool_try(at, more);
    ok = got == at;
    if (ok) {
      corpus_lay(H, more * 2);
    } else if (got != MAP_FAILED) {
      munmap(got, more);
    }
  }
  UNLOCK(bank_lock);
  return ok;
}

static Corpus corpus_setup(bool gpu, long threads, u64 bytes) {
  io_gpu     = gpu;
  KEEP_WORDS = gpu ? CHUNK : CAP_WORDS;
  u64 dflt   = gpu ? gpu_span() : 1ull << 33;
  u64 size   = (gpu && bytes != 0 ? bytes : dflt) & ~16383ull;
  CORPUS     = gpu ? gpu_map(size) : corpus_map(size);
  Corpus H   = CORPUS;
#if BEND_CUDA
  if (gpu) {
    cuMemsetD8((CUdeviceptr)(uintptr_t)H, 0, STAK_OFF * 8);
    cuCtxSynchronize();
  }
#endif
  corpus_lay(H, size);
  memcpy(H + STAT_OFF, STAT_IMG, STAT_LEN * sizeof(u64));
  a32_store(a32_at(H, H_BUMP), 1);
  if (gpu) {
    gpu_load(size);
  }
  pool_size = threads < 1 ? 1 : threads < CUBE_T ? threads : CUBE_T;
  return H;
}

OUTLINE Term corpus_eval(Corpus H, Term t) {
  Env  e = { H, ALC[0] };
  Term rv[WL_RESW];
  for (;;) {
    Reply r = work_loop(e, io_stk, t, !BANGS && pool_size == 1);
    if (r == 0) {
      if (root_done(H)) {
        break;
      }
      err_fail("solo delivery lost");
    }
    if ((u32)H[task_tail(r) + 1] == 0) {
      t = r;
      if (io_gpu && fid_bangs((u32)term_aux(t))) {
        Loc  tl   = task_tail(t);
        Term cont = H[tl];
        u32  idx  = (u32)(H[tl + 1] >> 32) & 0xFFFF;
        H[tl]     = TERM_HOLE;
        a32_store(a32_at(H, H_CURSOR), 1);
        ring_push(H, 0, t);
        cube_run(H, true);
        Term p = task_deliver(H, cont, idx, rv, root_take(H, rv));
        if (root_done(H)) {
          break;
        }
        if (p == 0) {
          err_fail("seam delivery lost");
        }
        t = p;
      }
      continue;
    }
    task_deal(H, r, 0, 0, (Cur)0);
    pool_open();
    cube_run(H, false);
    break;
  }
  root_take(H, rv);
  return rv[0];
}

// Io
// ==

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <sys/socket.h>

#define IO_READ 1
#define IO_TIME 2
#define IO_PARK TERM_HOLE

// Base's opaque, linear handles pack host fds/pointers into aux/loc:
// no forging, copying, reuse or host wrapper.
#define io_hand(v)   term_make(TAG_PAK, (u64)(v) >> 40, (u64)(v) & LOC_MASK)
#define io_hand_v(t) (((u64)term_aux(t) << 40) | term_loc(t))

struct IoWork;
typedef void (*IoCall)(struct IoWork* w);
typedef Term (*IoPack)(Env e, struct IoWork* w);

// IoWork ::=
//   | IoWork(hand, made, word, size, data, text, code, call, pack)
typedef struct IoWork {
  intptr_t hand;
  intptr_t made;
  u32      word;
  u64      size;
  char*    data;
  char*    text;
  u32      code;
  IoCall   call;
  IoPack   pack;
} IoWork;

typedef Term (*Effect)(Env e, Term* f, IoWork* w);

// IoEff ::=
//   | IoEff(run, ask)
typedef struct {
  Effect run;
  u32    ask;
} IoEff;

static IoEff io_eff_rows[1 << 16];
static u32   io_live;

static u64 io_tick(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (u64)ts.tv_sec * 1000000000ull + (u64)ts.tv_nsec;
}

OUTLINE void* io_mem(void* mem) {
  if (mem == NULL) {
    err_fail("host allocation failed");
  }
  return mem;
}

static int io_sys_addr(const char* host, u32 port, struct sockaddr_in* at) {
  memset(at, 0, sizeof(*at));
  at->sin_family = AF_INET;
  at->sin_port   = htons((uint16_t)port);
  for (const char* p = host; *p != 0; p += 1) {
    bool zero = *p == '0' && p[1] >= '0' && p[1] <= '9';
    if ((p == host || p[-1] == '.') && zero) {
      return -1;
    }
  }
  return port > 65535 || inet_pton(AF_INET, host, &at->sin_addr) != 1
    ? -1 : 0;
}

// The program's arguments (IO.args).
static int    io_argc;
static char** io_argv;

static void io_eff(u32 cid, Effect run, u32 need) {
  io_eff_rows[cid] = (IoEff){ run, need };
}

static u64 io_sys_end(IoWork* w, ssize_t n) {
  w->code = n < 0 ? (u32)errno : 0;
  return n < 0 ? 0 : (u64)n;
}

// cont(item) is the next request (run by io_exec). Parked, word/time/evts
// hold fd/deadline/readiness; pack resumes. Leading work permits IoWork*
// to IoAct* casts.
// IoAct ::=
//   | IoAct(work, cont, item, time, evts, next)
typedef struct IoAct {
  IoWork        work;
  Term          cont;
  Term          item;
  u64           time;
  short         evts;
  struct IoAct* next;
} IoAct;

// IoQue ::=
//   | IoQue(head, last)
typedef struct {
  IoAct* head;
  IoAct* last;
} IoQue;

static IoQue io_runs;
static IoQue io_park;
static IoQue io_jobs;

static void io_push(IoQue* q, IoAct* a) {
  a->next = NULL;
  *(q->head == NULL ? &q->head : &q->last->next) = a;
  q->last = a;
}

static IoAct* io_pop(IoQue* q) {
  IoAct* a = q->head;
  q->head  = a->next;
  return a;
}

static void io_spawn(Term m) {
  IoAct* a = io_mem(calloc(1, sizeof(IoAct)));
  a->cont  = m;
  a->item  = term_clo(FID_IO_EMIT, 0);
  io_push(&io_runs, a);
  io_live += 1;
}

// Park until evts (POLLIN/POLLOUT; 0 ignores fd) or time (0: no deadline).
// The loop calls more: a value resumes, IO_PARK re-parks.
static Term io_wait_on(IoWork* w, int fd, short evts, u64 time, IoPack more) {
  IoAct* a     = (IoAct*)w;
  a->work.word = (u32)fd;
  a->work.pack = more;
  a->time      = time;
  a->evts      = evts;
  io_push(&io_park, a);
  return IO_PARK;
}

// Parked deadline (0: none).
static u64 io_wait_time(IoWork* w) {
  return ((IoAct*)w)->time;
}

OUTLINE void io_out(FILE* h, const char* data, u64 len) {
  if (fwrite(data, 1, len, h) != len) {
    err_fail("a short write on a standard stream");
  }
}

OUTLINE void io_sync(void) {
  if (fflush(stdout) != 0) {
    err_fail("a short write on a standard stream");
  }
}

// the edge is UTF-8
static u64 io_utf8(char* buf, u64 c) {
  u64 k = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  for (u64 i = k; i > 1; i -= 1) {
    buf[i - 1] = (char)(0x80 | (c & 0x3F));
    c >>= 6;
  }
  buf[0] = (char)(k == 1 ? c : (0xF00 >> k) | c);
  return k;
}

OUTLINE char* io_cstr(Env e, Term s, u64* len) {
  u64   cap = 64;
  u64   n   = 0;
  char* buf = io_mem(malloc(cap));
  while (term_aux(s) == CID_SCON) {
    Term fb[2];
    spare_free(e, cls_fit(2), ctr_take(e, s, 2, fb));
    if (n + 5 > cap) {
      cap *= 2;
      buf = io_mem(realloc(buf, cap));
    }
    n += io_utf8(buf + n, fb[0]);
    s = fb[1];
  }
  buf[n] = 0;
  *len = n;
  return buf;
}

OUTLINE void io_errs(Env e, Term s) {
  u64   n    = 0;
  char* text = io_cstr(e, s, &n);
  io_sync();
  io_out(stderr, text, n);
  io_out(stderr, "\n", 1);
  free(text);
}

#define io_nul(s, n) (strlen(s) != (n))

#define io_seal(e, t, cid) (cid_hot(cid) ? rfc_seal(e, t) : (t))

static Term io_node(Env e, u64 cid, Term a, Term b) {
  Loc l = heap_alloc(e, 1);
  e.mem[l]     = io_seal(e, a, cid);
  e.mem[l + 1] = io_seal(e, b, cid);
  return term_ctr(cid, l);
}

// io_str decodes UTF-8 as WHATWG does: the lead byte sets the count of
// continuation bytes and the range of the second; a byte that breaks the
// sequence (or the end) yields one U+FFFD and is read again as a lead.
static Term io_str(Env e, const char* p, u64 n) {
  Term s    = term_pak(CID_SNIL, 0);
  Loc  hole = 0;
  u64  c = 0, need = 0, lo = 0x80, hi = 0xBF;
  for (u64 i = 0; i < n || need > 0; i += 1) {
    u64 b = i < n ? (uint8_t)p[i] : 0x100;
    if (need > 0 && (b < lo || b > hi)) {
      need = 0;
      c    = 0xFFFD;
      i   -= 1;
    } else if (need > 0) {
      lo = 0x80;
      hi = 0xBF;
      c  = (c << 6) | (b & 0x3F);
      if (--need > 0) {
        continue;
      }
    } else if (b < 0x80) {
      c = b;
    } else if (b < 0xC2 || b > 0xF4) {
      c = 0xFFFD;
    } else {
      need = b < 0xE0 ? 1 : b < 0xF0 ? 2 : 3;
      lo   = b == 0xE0 ? 0xA0 : b == 0xF0 ? 0x90 : 0x80;
      hi   = b == 0xED ? 0x9F : b == 0xF4 ? 0x8F : 0xBF;
      c    = b & (0x3F >> need);
      continue;
    }
    Loc  l = heap_alloc(e, 1);
    Term t = term_ctr(CID_SCON, l);
    e.mem[l] = c;
    if (hole == 0) {
      s = t;
    } else {
      e.mem[hole] = io_seal(e, t, CID_SCON);
    }
    hole = l + 1;
  }
  if (hole != 0) {
    e.mem[hole] = io_seal(e, term_pak(CID_SNIL, 0), CID_SCON);
  }
  return s;
}

#define io_tup(e, a, b) io_node(e, CID_TUPLE, a, b)
#define io_done(e, v)   io_box(e, CID_DONE, v)

static Term io_box(Env e, u64 cid, Term v) {
  Loc l = heap_alloc(e, 0);
  e.mem[l] = io_seal(e, v, cid);
  return term_ctr(cid, l);
}

static Term io_fail(Env e, u32 code, const char* text) {
  const char* s = text != NULL ? text : strerror((int)code);
  Term t = io_tup(e, code, io_str(e, s, strlen(s)));
  return io_box(e, CID_FAIL, t);
}

static lock           io_gate = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t io_bell = PTHREAD_COND_INITIALIZER;
static u32            io_busy;
static u32            io_size;
static int            io_wake_fd[2];

static void io_take(Env e) {
  IoAct*  acts[64];
  ssize_t n;
  while ((n = read(io_wake_fd[0], acts, sizeof acts)) > 0) {
    for (u32 i = 0; i < (u32)n / sizeof(IoAct*); i += 1) {
      IoAct* a = acts[i];
      a->item  = a->work.pack(e, &a->work);
      io_push(&io_runs, a);
      io_busy -= 1;
    }
  }
}

static void* io_help(void* arg) {
  for (;;) {
    pthread_mutex_lock(&io_gate);
    while (io_jobs.head == NULL) {
      pthread_cond_wait(&io_bell, &io_gate);
    }
    IoAct* a = io_pop(&io_jobs);
    pthread_mutex_unlock(&io_gate);
    a->work.call(&a->work);
    while (write(io_wake_fd[1], &a, sizeof a) != sizeof a) {
    }
  }
}

// Run call on a helper thread, then pack on the loop to resume the effect.
static Term io_work(IoWork* w, IoCall call, IoPack pack) {
  w->call  = call;
  w->pack  = pack;
  io_busy += 1;
  if (io_busy > io_size && io_size < IO_HELP) {
    pthread_t tid;
    if (pthread_create(&tid, NULL, io_help, NULL)) {
      err_fail("pthread_create");
    }
    pthread_detach(tid);
    io_size += 1;
  }
  pthread_mutex_lock(&io_gate);
  io_push(&io_jobs, (IoAct*)w);
  pthread_cond_signal(&io_bell);
  pthread_mutex_unlock(&io_gate);
  return IO_PARK;
}

// Consume cont's request node; the effect returns a value or IO_PARK.
static Term io_exec(Env e, IoWork* w) {
  IoAct* a = (IoAct*)w;
  Term   fs[256];
  u32    c = (u32)term_aux(a->cont);
  u32    n = cid_arity(c);
  spare_free(e, cls_fit(n), ctr_take(e, a->cont, n, fs));
  a->cont = fs[n - 1];
  return io_eff_rows[c].run(e, fs, w);
}

// macOS poll misses FIFO EOF. Size select sets to the highest fd;
// _DARWIN_UNLIMITED_SELECT allows fds past FD_SETSIZE.
static bool io_bit(u8* set, int fd, bool put) {
  u8* at = set + fd / 8;
  *at |= put << fd % 8;
  return *at >> fd % 8 & 1;
}

static void io_wait(Env e) {
  int top  = io_wake_fd[0];
  u64 soon = 0;
  for (IoAct* a = io_park.head; a != NULL; a = a->next) {
    if (a->time != 0 && (soon == 0 || a->time < soon)) {
      soon = a->time;
    }
    if (a->evts != 0 && (int)a->work.word > top) {
      top = (int)a->work.word;
    }
  }
  u64 len = (u64)top / 64 * 8 + 8;
  u8* set[2] = { io_mem(calloc(2, len)), NULL };
  set[1] = set[0] + len;
  io_bit(set[0], io_wake_fd[0], true);
  for (IoAct* a = io_park.head; a != NULL; a = a->next) {
    if (a->evts != 0) {
      io_bit(set[a->evts == POLLOUT], (int)a->work.word, true);
    }
  }
  u64 tick = io_tick();
  u64 ms = soon > tick ? (soon - tick) / 1000000 + 1 : 0;
  struct timeval tv = { ms / 1000, ms % 1000 * 1000 };
  io_sync();
  while (select(top + 1, (fd_set*)set[0], (fd_set*)set[1], NULL,
    soon == 0 ? NULL : &tv) < 0) {
    if (errno != EINTR) {
      err_fail("the poller failed");
    }
  }
  if (io_bit(set[0], io_wake_fd[0], false)) {
    io_take(e);
  }
  u64   now  = io_tick();
  IoQue todo = io_park;
  io_park = (IoQue){0};
  while (todo.head != NULL) {
    IoAct* a   = io_pop(&todo);
    bool   due = (a->evts != 0
        && io_bit(set[a->evts == POLLOUT], (int)a->work.word, false))
      || (a->time != 0 && a->time <= now);
    if (!due) {
      io_push(&io_park, a);
      continue;
    }
    Term x = a->work.pack(e, &a->work);
    if (x != IO_PARK) {
      a->item = x;
      io_push(&io_runs, a);
    }
  }
  free(set[0]);
}

static int f32_text(char* buf, f32 v) {
  int n = 0;
  int p = 0;
  if (v != v) {
    return sprintf(buf, "nan");
  }
  for (; p < 9; p += 1) {
    n = snprintf(buf, 40, "%.*e", p, (double)v);
    if (strtof(buf, NULL) == v) {
      break;
    }
  }
  char* ep = strchr(buf, 'e');
  if (ep == NULL) {
    return n;
  }
  int ex = atoi(ep + 1);
  if (ex >= 21 || ex <= -7) {
    n = (int)(ep - buf) + sprintf(ep, "e%c%d", ex < 0 ? '-' : '+', abs(ex));
  } else if (ex <= p) {
    n = snprintf(buf, 40, "%.*f", p - ex, (double)v);
  } else {
    int s = *buf == '-';
    memmove(buf + s + 1, buf + s + 2, p);
    memset(buf + s + 1 + p, '0', ex - p);
    n = s + 1 + ex;
  }
  return n;
}

static Term f32_show(Env e, Term x) {
  char buf[40];
  return io_str(e, buf, f32_text(buf, f32_unbox(x)));
}

static Term f32_read(Env e, Term s) {
  u64 n = 0;
  char* text = io_cstr(e, s, &n);
  char* end;
  f32 v = strtof(text, &end);
  Term out = n > 0 && (u64)(end - text) == n && strpbrk(text, "xX(") == NULL
    ? io_box(e, CID_SOME, f32_rewrap(v)) : term_pak(CID_NONE, 0);
  free(text);
  return out;
}

// Show
// ====

#if MAIN_PURE

// A pure main's value, spelled as term_show spells it: d is a node of
// SHOW_DESC (see show_main), w the value's words. A boxed Data reads its
// arm by cid off a Term (packed, or a node), an inline one by tag off
// its words.
static void show_val(Env e, u32 d, const Term* w, char chain);

// char_show: an escape, a \u{hex}, else the code point in UTF-8
static void show_chr(u64 c, char q) {
  char b[4];
  int  k = c == 10 ? 'n' : c == 9 ? 't' : c == 13 ? 'r' : c == 0 ? '0'
    : c == 92 || c == (u64)q ? (int)c : 0;
  if (k != 0) {
    printf("\\%c", k);
  } else if (c < 32 || c == 127 || (c >= 0xD800 && c <= 0xDFFF)
    || c > 0x10FFFF) {
    printf("\\u{%llx}", (unsigned long long)c);
  } else {
    fwrite(b, 1, io_utf8(b, c), stdout);
  }
}

// The shortest text that reads back, as a literal: a point before an e
static void show_f32(u32 x) {
  char  buf[40];
  int   n  = f32_text(buf, f32_unbox(x));
  char* ep = memchr(buf, 'e', n);
  int   m  = ep == NULL ? n : (int)(ep - buf);
  buf[n] = 0;
  if (strpbrk(buf, ".ni") == NULL) {
    printf("%.*s.0%s", m, buf, buf + m);
  } else {
    fputs(buf, stdout);
  }
}

static void show_arr(Env e, u32 d, Term t, u32 lo, u32 c) {
  if (c > SHOW_DESC[d + 2]) {
    c -= 1;
    show_arr(e, d, t, lo, c);
    fputs(", ", stdout);
    show_arr(e, d, t, lo + (1u << c), c);
  } else {
    Term v[1u << c];
    for (u32 j = 0; j < 1u << c; j += 1) {
      v[j] = blk_read(e.mem, term_tag(t) == TAG_ARR, term_peek(e, t), lo + j);
    }
    show_val(e, SHOW_DESC[d + 1], v, 0);
  }
}

// chain is the bracket of the [a, b] or (a, b) this value continues, or
// 0: a Con or Nil spells a list, a Tuple a tuple, their tails continue
static void show_val(Env e, u32 d, const Term* w, char chain) {
  const u32* D = SHOW_DESC;
  Term one;
  char zs[4];
  u32  zn = 0;
  for (bool tail = true; tail;) switch (tail = false, D[d]) {
    case 0: printf("%u", (u32)w[0]); break;
    case 1: show_f32((u32)w[0]); break;
    case 2: printf("%llun", (unsigned long long)w[0]); break;
    case 3:
      putchar('\'');
      show_chr(D[d + 1] != 0 ? term_loc(w[0]) : w[0], '\'');
      putchar('\'');
      break;
    case 4:
      putchar('"');
      for (Term s = w[0]; term_aux(s) == CID_SCON;) {
        Loc l = term_peek(e, s);
        show_chr(e.mem[l], '"');
        s = e.mem[l + 1];
      }
      putchar('"');
      break;
    case 5: fputs("{==}", stdout); break;
    case 6:
      putchar('[');
      show_arr(e, d, w[0], 0, blk_cls(w[0]));
      putchar(']');
      break;
    default: {
      Term t   = w[0];
      bool box = D[d + 1] != 0;
      u32  key = box ? (u32)term_aux(t) : D[d + 2] > 1 ? (u32)t : 0;
      u32  a   = d + 3;
      for (u32 i = 0; box ? D[a + 1] != key : i != key; i += 1) {
        a += 3 + 2 * D[a + 2];
      }
      if (box) {
        one = term_loc(t);
        w   = term_tag(t) == TAG_PAK ? &one : e.mem + term_peek(e, t);
      }
      const char* k = SHOW_NAMES[D[a]];
      char o = '{';
      char z = '}';
      if (strcmp(k, "Con") == 0 || strcmp(k, "Nil") == 0) {
        o = '[';
        z = ']';
      } else if (strcmp(k, "Tuple") == 0) {
        o = '(';
        z = ')';
      }
      if (o == '{') {
        printf("%s{", k);
      } else if (chain != o) {
        putchar(o);
      }
      if (o == '{' || chain != o) {
        zs[zn++] = z;
      }
      for (u32 j = 0; j < D[a + 2]; j += 1) {
        if (o == '[' ? j == 0 && chain == o : j > 0) {
          fputs(", ", stdout);
        }
        if (j == 1 && o != '{') {
          tail  = true;
          chain = o;
          d     = D[a + 4 + 2 * j];
          w     = w + D[a + 3 + 2 * j];
        } else {
          show_val(e, D[a + 4 + 2 * j], w + D[a + 3 + 2 * j], 0);
        }
      }
    }
  }
  while (zn > 0) {
    putchar(zs[--zn]);
  }
}

#endif

// The continuation applied to the item is the next request.
static int io_step(Env e, IoAct* a) {
  for (;;) {
    Loc  ap  = task_node(e, FID_CLO_APPLY, TERM_HOLE, 0, 0);
    e.mem[ap]     = a->cont;
    e.mem[ap + 1] = a->item;
    Term req = corpus_eval(e.mem, term_tsk(FID_CLO_APPLY, ap));
    u32  c   = (u32)term_aux(req);
    Loc  at  = term_peek(e, req);
    if (c == CID_EMIT) {
      term_drop(e, req);
      free(a);
      io_live -= 1;
      return -1;
    }
    if (c == CID_HALT) {
      io_errs(e, e.mem[at + 1]);
      return (int)(u32)e.mem[at];
    }
    if (io_eff_rows[c].run == NULL) {
      err_fail("an alien request");
    }
    u32 need = io_eff_rows[c].ask;
    u32 word = (u32)(need & IO_READ ? io_hand_v(e.mem[at]) : e.mem[at]);
    a->cont  = req;
    if (need != 0) {
      io_wait_on(&a->work, (int)word, need & IO_READ ? POLLIN : 0,
        need & IO_TIME ? io_tick() + (u64)word * 1000000ull : 0, io_exec);
      return -1;
    }
    Term x = io_exec(e, &a->work);
    if (x == IO_PARK) {
      return -1;
    }
    a->item = x;
  }
}

OUTLINE int io_loop(Corpus H) {
  Env e = { H, ALC[0] };
  io_stk = pool_stack();
  signal(SIGPIPE, SIG_IGN);
  if (pipe(io_wake_fd) | fcntl(io_wake_fd[0], F_SETFL, O_NONBLOCK)) {
    err_fail("the event loop failed to open");
  }
  Term m = corpus_eval(H, term_tsk(MAIN_FID, task_node(e, MAIN_FID,
    TERM_HOLE, 0, 0)));
#if MAIN_PURE
  show_val(e, 0, H + H_ROOT_WORD, 0);
  putchar('\n');
  return 0;
#endif
  io_spawn(m);
  for (u32 n = 0;; n += 1) {
    if (io_runs.head == NULL) {
      if (io_live == 0) {
        return 0;
      }
      if (io_park.head == NULL && io_busy == 0) {
        io_sync();
        fprintf(stderr, "bend: deadlock: every computation waits on a"
          " channel\n");
        return 1;
      }
      io_wait(e);
      continue;
    }
    if ((n & 63) == 0 && io_busy != 0) {
      io_take(e);
    }
    int code = io_step(e, io_pop(&io_runs));
    if (code >= 0) {
      return code;
    }
  }
}

// Chan
// ====

// ChanRow ::=
//   | ChanRow(gen, next, room, size, head, live, shut, ring, wait)
typedef struct {
  u32   gen;
  u32   next;
  u32   room;
  u32   size;
  u32   head;
  u32   live;
  u32   shut;
  Term* ring;
  IoQue wait;
} ChanRow;

// A channel is Data: its handle is copied and may outlive the row, so it
// names the row by index and generation, a freed row waits on a list and
// comes back one generation up, and a stale copy finds no row (closed).
static ChanRow* chan_rows;
static u32      chan_len;
static u32      chan_idle = ~0u;

#define chan_some(e, v) io_box(e, CID_SOME, v)
#define chan_bool(b)    term_pak((b) ? CID_TRUE : CID_FALSE, 0)

static Term chan_open(u32 room) {
  u32 i = chan_idle;
  if (i != ~0u) {
    chan_idle = chan_rows[i].next;
  } else {
    if (chan_len == 1u << 24) {
      err_fail("more than 16777216 channels at once");
    }
    if ((chan_len & (chan_len - 1)) == 0) {
      chan_rows = io_mem(realloc(chan_rows,
        (chan_len == 0 ? 1 : 2 * chan_len) * sizeof(ChanRow)));
    }
    i = chan_len;
    chan_len += 1;
    chan_rows[i].gen = 0;
  }
  ChanRow* row = &chan_rows[i];
  row->gen  += 1;
  row->room  = room;
  row->size  = 0;
  row->head  = 0;
  row->live  = 1;
  row->shut  = 0;
  row->ring  = room == 0 ? NULL : io_mem(malloc(room * sizeof(Term)));
  row->wait.head = NULL;
  row->wait.last = NULL;
  return io_hand(((u64)row->gen << 24) | i);
}

static ChanRow* chan_at(Term t) {
  u64      v   = io_hand_v(t);
  u32      i   = (u32)v & 0xFFFFFF;
  ChanRow* row = i < chan_len ? &chan_rows[i] : NULL;
  return row != NULL && row->live && row->gen == (u32)(v >> 24) ? row : NULL;
}

// Parks the effect's activation on row with item: a sent value, or
// TERM_HOLE for a receiver.
static Term chan_park(ChanRow* row, IoWork* w, Term item) {
  IoAct* a = (IoAct*)w;
  a->item  = item;
  io_push(&row->wait, a);
  return IO_PARK;
}

static Term chan_wake(ChanRow* row, Term x) {
  IoAct* a  = io_pop(&row->wait);
  Term item = a->item;
  a->item   = x;
  io_push(&io_runs, a);
  return item;
}

static Term chan_take(ChanRow* row) {
  Term v = row->ring[row->head];
  row->head = (row->head + 1) % row->room;
  row->size -= 1;
  if (row->wait.head != NULL) {
    Term item = chan_wake(row, chan_bool(true));
    row->ring[(row->head + row->size) % row->room] = item;
    row->size += 1;
  }
  return v;
}

static void chan_free(ChanRow* row) {
  free(row->ring);
  row->live = 0;
  row->next = chan_idle;
  chan_idle = (u32)(row - chan_rows);
}

static void chan_shut(Env e, ChanRow* row) {
  row->shut = 1;
  while (row->wait.head != NULL) {
    bool rcv = row->wait.head->item == TERM_HOLE;
    Term x = rcv ? term_pak(CID_NONE, 0) : chan_bool(false);
    term_sink(e, chan_wake(row, x));
  }
  if (row->size == 0) {
    chan_free(row);
  }
}

// Requests
// ========



// Cli
// ===

static void cli_fail(const char* msg, const char* arg) {
  fprintf(stderr, "bend: %s%s\n", msg, arg != NULL ? arg : "");
  exit(1);
}

// Main
// ====

int main(int argc, char** argv) {
  long thr = 0;
  int  gpu = -1;
  u64  mem = 0;
  io_argv = argv + 1;
  for (int i = 1; i < argc; i += 1) {
    const char* a = argv[i];
    const char* v = i + 1 < argc ? argv[i + 1] : NULL;
    if (strcmp(a, "--") == 0) {
      while (i + 1 < argc) {
        io_argv[io_argc++] = argv[++i];
      }
    } else if (strcmp(a, "--help") == 0) {
      printf(CLI_HELP, argv[0]);
      return 0;
    } else if (strcmp(a, "--gpu-build") == 0) {
      if (gpu_probe() && !gpu_make(gpu_path())) {
        cli_fail("cannot write ", gpu_path());
      }
      return 0;
    } else if (strcmp(a, "--threads") == 0) {
      char* end = NULL;
      thr = v != NULL ? strtol(v, &end, 10) : 0;
      if (thr < 1 || end == NULL || *end != '\0') {
        cli_fail("expected a thread count of 1 or more after --threads", NULL);
      }
      i += 1;
    } else if (strcmp(a, "--gpu") == 0) {
      char*  end = NULL;
      double n   = v != NULL ? strtod(v, &end) : 0;
      u64    mul = end == NULL ? 0 : strcmp(end, "GB") == 0 ? 1ull << 30
        : strcmp(end, "MB") == 0 ? 1ull << 20 : 0;
      if (v != NULL && strcmp(v, "off") == 0) {
        gpu = 0;
      } else if (v != NULL && (strcmp(v, "on") == 0 || (mul != 0 && n > 0))) {
        gpu = 1;
        mem = (u64)(n * (double)mul);
      } else {
        cli_fail("expected on, off or a size like 4GB after --gpu", NULL);
      }
      i += 1;
    } else {
      io_argv[io_argc++] = argv[i];
    }
  }
  bool dev = gpu != 0 && BANGS != 0 && gpu_probe();
  if (gpu == 1 && BANGS != 0 && !dev) {
    cli_fail("--gpu on, but this binary found no GPU device", NULL);
  }
  Corpus H  = corpus_setup(dev, thr > 0 ? thr : cpu_count(), mem);
  int code  = io_loop(H);
  io_sync();
  return code;
}

#endif
