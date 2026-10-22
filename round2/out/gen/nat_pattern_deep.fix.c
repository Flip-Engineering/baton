
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
#define FID_MAIN 0
#define FID_IO_EMIT 1
#define FID_CLO_APPLY 2
#define FID_EXIT 3
#define FID_ENTER 4
CONSTV u8 FID_ARITY_T[] = { 0, 1, 2 };
CONSTV u8 FID_FLAG_T[] = { 2, 2, 2 };
CONSTV u8 FID_RESW_T[] = { 0, 0, 0 };
CONSTV u8 CID_ARITY_T[] = { 2, 0, 2, 2, 1, 2, 1, 1, 0, 1, 0, 0, 0, 1 };
CONSTV u8 CID_HOT_T[] = { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };
#define STAT_LEN 0

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

#define WL_TABLE WL_X(FID_MAIN) WL_X(FID_IO_EMIT) WL_X(FID_CLO_APPLY) WL_X(FID_EXIT)
#define MAIN_FID FID_MAIN
#define MAIN_PURE 1
#define BLK_SHR 0

#if !DEVICE

static const u32 SHOW_DESC[] = { 2 };

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

CONSTV u64 STAT_IMG[] = { 0 };

INLINE Term mdflt_301(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_3 = 0;
  Term _a_0 = r0;
  WL_SPIN
    _v_3 = _a_0;
  break;
  }
  o[0] = _v_3;
  return 1;
}

INLINE Term mdflt_302(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_4 = 0;
  Term _a_1 = r0;
  WL_SPIN
    _v_4 = nat_chk(e, _a_1 + 1);
  break;
  }
  o[0] = _v_4;
  return 1;
}

INLINE Term mdflt_303(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_5 = 0;
  Term _a_2 = r0;
  WL_SPIN
    _v_5 = nat_chk(e, _a_2 + 2);
  break;
  }
  o[0] = _v_5;
  return 1;
}

INLINE Term mdflt_304(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_6 = 0;
  Term _a_3 = r0;
  WL_SPIN
    _v_6 = nat_chk(e, _a_3 + 3);
  break;
  }
  o[0] = _v_6;
  return 1;
}

INLINE Term mdflt_305(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_7 = 0;
  Term _a_4 = r0;
  WL_SPIN
    _v_7 = nat_chk(e, _a_4 + 4);
  break;
  }
  o[0] = _v_7;
  return 1;
}

INLINE Term mdflt_306(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_8 = 0;
  Term _a_5 = r0;
  WL_SPIN
    _v_8 = nat_chk(e, _a_5 + 5);
  break;
  }
  o[0] = _v_8;
  return 1;
}

INLINE Term mdflt_307(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_9 = 0;
  Term _a_6 = r0;
  WL_SPIN
    _v_9 = nat_chk(e, _a_6 + 6);
  break;
  }
  o[0] = _v_9;
  return 1;
}

INLINE Term mdflt_308(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_10 = 0;
  Term _a_7 = r0;
  WL_SPIN
    _v_10 = nat_chk(e, _a_7 + 7);
  break;
  }
  o[0] = _v_10;
  return 1;
}

INLINE Term mdflt_309(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_11 = 0;
  Term _a_8 = r0;
  WL_SPIN
    _v_11 = nat_chk(e, _a_8 + 8);
  break;
  }
  o[0] = _v_11;
  return 1;
}

INLINE Term mdflt_310(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_12 = 0;
  Term _a_9 = r0;
  WL_SPIN
    _v_12 = nat_chk(e, _a_9 + 9);
  break;
  }
  o[0] = _v_12;
  return 1;
}

INLINE Term mdflt_311(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_13 = 0;
  Term _a_10 = r0;
  WL_SPIN
    _v_13 = nat_chk(e, _a_10 + 10);
  break;
  }
  o[0] = _v_13;
  return 1;
}

INLINE Term mdflt_312(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_14 = 0;
  Term _a_11 = r0;
  WL_SPIN
    _v_14 = nat_chk(e, _a_11 + 11);
  break;
  }
  o[0] = _v_14;
  return 1;
}

INLINE Term mdflt_313(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_15 = 0;
  Term _a_12 = r0;
  WL_SPIN
    _v_15 = nat_chk(e, _a_12 + 12);
  break;
  }
  o[0] = _v_15;
  return 1;
}

INLINE Term mdflt_314(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_16 = 0;
  Term _a_13 = r0;
  WL_SPIN
    _v_16 = nat_chk(e, _a_13 + 13);
  break;
  }
  o[0] = _v_16;
  return 1;
}

INLINE Term mdflt_315(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_17 = 0;
  Term _a_14 = r0;
  WL_SPIN
    _v_17 = nat_chk(e, _a_14 + 14);
  break;
  }
  o[0] = _v_17;
  return 1;
}

INLINE Term mdflt_316(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_18 = 0;
  Term _a_15 = r0;
  WL_SPIN
    _v_18 = nat_chk(e, _a_15 + 15);
  break;
  }
  o[0] = _v_18;
  return 1;
}

INLINE Term mdflt_317(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_19 = 0;
  Term _a_16 = r0;
  WL_SPIN
    _v_19 = nat_chk(e, _a_16 + 16);
  break;
  }
  o[0] = _v_19;
  return 1;
}

INLINE Term mdflt_318(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_20 = 0;
  Term _a_17 = r0;
  WL_SPIN
    _v_20 = nat_chk(e, _a_17 + 17);
  break;
  }
  o[0] = _v_20;
  return 1;
}

INLINE Term mdflt_319(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_21 = 0;
  Term _a_18 = r0;
  WL_SPIN
    _v_21 = nat_chk(e, _a_18 + 18);
  break;
  }
  o[0] = _v_21;
  return 1;
}

INLINE Term mdflt_320(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_22 = 0;
  Term _a_19 = r0;
  WL_SPIN
    _v_22 = nat_chk(e, _a_19 + 19);
  break;
  }
  o[0] = _v_22;
  return 1;
}

INLINE Term mdflt_321(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_23 = 0;
  Term _a_20 = r0;
  WL_SPIN
    _v_23 = nat_chk(e, _a_20 + 20);
  break;
  }
  o[0] = _v_23;
  return 1;
}

INLINE Term mdflt_322(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_24 = 0;
  Term _a_21 = r0;
  WL_SPIN
    _v_24 = nat_chk(e, _a_21 + 21);
  break;
  }
  o[0] = _v_24;
  return 1;
}

INLINE Term mdflt_323(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_25 = 0;
  Term _a_22 = r0;
  WL_SPIN
    _v_25 = nat_chk(e, _a_22 + 22);
  break;
  }
  o[0] = _v_25;
  return 1;
}

INLINE Term mdflt_324(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_26 = 0;
  Term _a_23 = r0;
  WL_SPIN
    _v_26 = nat_chk(e, _a_23 + 23);
  break;
  }
  o[0] = _v_26;
  return 1;
}

INLINE Term mdflt_325(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_27 = 0;
  Term _a_24 = r0;
  WL_SPIN
    _v_27 = nat_chk(e, _a_24 + 24);
  break;
  }
  o[0] = _v_27;
  return 1;
}

INLINE Term mdflt_326(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_28 = 0;
  Term _a_25 = r0;
  WL_SPIN
    _v_28 = nat_chk(e, _a_25 + 25);
  break;
  }
  o[0] = _v_28;
  return 1;
}

INLINE Term mdflt_327(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_29 = 0;
  Term _a_26 = r0;
  WL_SPIN
    _v_29 = nat_chk(e, _a_26 + 26);
  break;
  }
  o[0] = _v_29;
  return 1;
}

INLINE Term mdflt_328(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_30 = 0;
  Term _a_27 = r0;
  WL_SPIN
    _v_30 = nat_chk(e, _a_27 + 27);
  break;
  }
  o[0] = _v_30;
  return 1;
}

INLINE Term mdflt_329(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_31 = 0;
  Term _a_28 = r0;
  WL_SPIN
    _v_31 = nat_chk(e, _a_28 + 28);
  break;
  }
  o[0] = _v_31;
  return 1;
}

INLINE Term mdflt_330(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_32 = 0;
  Term _a_29 = r0;
  WL_SPIN
    _v_32 = nat_chk(e, _a_29 + 29);
  break;
  }
  o[0] = _v_32;
  return 1;
}

INLINE Term mdflt_331(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_33 = 0;
  Term _a_30 = r0;
  WL_SPIN
    _v_33 = nat_chk(e, _a_30 + 30);
  break;
  }
  o[0] = _v_33;
  return 1;
}

INLINE Term mdflt_332(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_34 = 0;
  Term _a_31 = r0;
  WL_SPIN
    _v_34 = nat_chk(e, _a_31 + 31);
  break;
  }
  o[0] = _v_34;
  return 1;
}

INLINE Term mdflt_333(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_35 = 0;
  Term _a_32 = r0;
  WL_SPIN
    _v_35 = nat_chk(e, _a_32 + 32);
  break;
  }
  o[0] = _v_35;
  return 1;
}

INLINE Term mdflt_334(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_36 = 0;
  Term _a_33 = r0;
  WL_SPIN
    _v_36 = nat_chk(e, _a_33 + 33);
  break;
  }
  o[0] = _v_36;
  return 1;
}

INLINE Term mdflt_335(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_37 = 0;
  Term _a_34 = r0;
  WL_SPIN
    _v_37 = nat_chk(e, _a_34 + 34);
  break;
  }
  o[0] = _v_37;
  return 1;
}

INLINE Term mdflt_336(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_38 = 0;
  Term _a_35 = r0;
  WL_SPIN
    _v_38 = nat_chk(e, _a_35 + 35);
  break;
  }
  o[0] = _v_38;
  return 1;
}

INLINE Term mdflt_337(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_39 = 0;
  Term _a_36 = r0;
  WL_SPIN
    _v_39 = nat_chk(e, _a_36 + 36);
  break;
  }
  o[0] = _v_39;
  return 1;
}

INLINE Term mdflt_338(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_40 = 0;
  Term _a_37 = r0;
  WL_SPIN
    _v_40 = nat_chk(e, _a_37 + 37);
  break;
  }
  o[0] = _v_40;
  return 1;
}

INLINE Term mdflt_339(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_41 = 0;
  Term _a_38 = r0;
  WL_SPIN
    _v_41 = nat_chk(e, _a_38 + 38);
  break;
  }
  o[0] = _v_41;
  return 1;
}

INLINE Term mdflt_340(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_42 = 0;
  Term _a_39 = r0;
  WL_SPIN
    _v_42 = nat_chk(e, _a_39 + 39);
  break;
  }
  o[0] = _v_42;
  return 1;
}

INLINE Term mdflt_341(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_43 = 0;
  Term _a_40 = r0;
  WL_SPIN
    _v_43 = nat_chk(e, _a_40 + 40);
  break;
  }
  o[0] = _v_43;
  return 1;
}

INLINE Term mdflt_342(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_44 = 0;
  Term _a_41 = r0;
  WL_SPIN
    _v_44 = nat_chk(e, _a_41 + 41);
  break;
  }
  o[0] = _v_44;
  return 1;
}

INLINE Term mdflt_343(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_45 = 0;
  Term _a_42 = r0;
  WL_SPIN
    _v_45 = nat_chk(e, _a_42 + 42);
  break;
  }
  o[0] = _v_45;
  return 1;
}

INLINE Term mdflt_344(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_46 = 0;
  Term _a_43 = r0;
  WL_SPIN
    _v_46 = nat_chk(e, _a_43 + 43);
  break;
  }
  o[0] = _v_46;
  return 1;
}

INLINE Term mdflt_345(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_47 = 0;
  Term _a_44 = r0;
  WL_SPIN
    _v_47 = nat_chk(e, _a_44 + 44);
  break;
  }
  o[0] = _v_47;
  return 1;
}

INLINE Term mdflt_346(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_48 = 0;
  Term _a_45 = r0;
  WL_SPIN
    _v_48 = nat_chk(e, _a_45 + 45);
  break;
  }
  o[0] = _v_48;
  return 1;
}

INLINE Term mdflt_347(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_49 = 0;
  Term _a_46 = r0;
  WL_SPIN
    _v_49 = nat_chk(e, _a_46 + 46);
  break;
  }
  o[0] = _v_49;
  return 1;
}

INLINE Term mdflt_348(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_50 = 0;
  Term _a_47 = r0;
  WL_SPIN
    _v_50 = nat_chk(e, _a_47 + 47);
  break;
  }
  o[0] = _v_50;
  return 1;
}

INLINE Term mdflt_349(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_51 = 0;
  Term _a_48 = r0;
  WL_SPIN
    _v_51 = nat_chk(e, _a_48 + 48);
  break;
  }
  o[0] = _v_51;
  return 1;
}

INLINE Term mdflt_350(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_52 = 0;
  Term _a_49 = r0;
  WL_SPIN
    _v_52 = nat_chk(e, _a_49 + 49);
  break;
  }
  o[0] = _v_52;
  return 1;
}

INLINE Term mdflt_351(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_53 = 0;
  Term _a_50 = r0;
  WL_SPIN
    _v_53 = nat_chk(e, _a_50 + 50);
  break;
  }
  o[0] = _v_53;
  return 1;
}

INLINE Term mdflt_352(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_54 = 0;
  Term _a_51 = r0;
  WL_SPIN
    _v_54 = nat_chk(e, _a_51 + 51);
  break;
  }
  o[0] = _v_54;
  return 1;
}

INLINE Term mdflt_353(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_55 = 0;
  Term _a_52 = r0;
  WL_SPIN
    _v_55 = nat_chk(e, _a_52 + 52);
  break;
  }
  o[0] = _v_55;
  return 1;
}

INLINE Term mdflt_354(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_56 = 0;
  Term _a_53 = r0;
  WL_SPIN
    _v_56 = nat_chk(e, _a_53 + 53);
  break;
  }
  o[0] = _v_56;
  return 1;
}

INLINE Term mdflt_355(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_57 = 0;
  Term _a_54 = r0;
  WL_SPIN
    _v_57 = nat_chk(e, _a_54 + 54);
  break;
  }
  o[0] = _v_57;
  return 1;
}

INLINE Term mdflt_356(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_58 = 0;
  Term _a_55 = r0;
  WL_SPIN
    _v_58 = nat_chk(e, _a_55 + 55);
  break;
  }
  o[0] = _v_58;
  return 1;
}

INLINE Term mdflt_357(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_59 = 0;
  Term _a_56 = r0;
  WL_SPIN
    _v_59 = nat_chk(e, _a_56 + 56);
  break;
  }
  o[0] = _v_59;
  return 1;
}

INLINE Term mdflt_358(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_60 = 0;
  Term _a_57 = r0;
  WL_SPIN
    _v_60 = nat_chk(e, _a_57 + 57);
  break;
  }
  o[0] = _v_60;
  return 1;
}

INLINE Term mdflt_359(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_61 = 0;
  Term _a_58 = r0;
  WL_SPIN
    _v_61 = nat_chk(e, _a_58 + 58);
  break;
  }
  o[0] = _v_61;
  return 1;
}

INLINE Term mdflt_360(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_62 = 0;
  Term _a_59 = r0;
  WL_SPIN
    _v_62 = nat_chk(e, _a_59 + 59);
  break;
  }
  o[0] = _v_62;
  return 1;
}

INLINE Term mdflt_361(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_63 = 0;
  Term _a_60 = r0;
  WL_SPIN
    _v_63 = nat_chk(e, _a_60 + 60);
  break;
  }
  o[0] = _v_63;
  return 1;
}

INLINE Term mdflt_362(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_64 = 0;
  Term _a_61 = r0;
  WL_SPIN
    _v_64 = nat_chk(e, _a_61 + 61);
  break;
  }
  o[0] = _v_64;
  return 1;
}

INLINE Term mdflt_363(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_65 = 0;
  Term _a_62 = r0;
  WL_SPIN
    _v_65 = nat_chk(e, _a_62 + 62);
  break;
  }
  o[0] = _v_65;
  return 1;
}

INLINE Term mdflt_364(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_66 = 0;
  Term _a_63 = r0;
  WL_SPIN
    _v_66 = nat_chk(e, _a_63 + 63);
  break;
  }
  o[0] = _v_66;
  return 1;
}

INLINE Term mdflt_365(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_67 = 0;
  Term _a_64 = r0;
  WL_SPIN
    _v_67 = nat_chk(e, _a_64 + 64);
  break;
  }
  o[0] = _v_67;
  return 1;
}

INLINE Term mdflt_366(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_68 = 0;
  Term _a_65 = r0;
  WL_SPIN
    _v_68 = nat_chk(e, _a_65 + 65);
  break;
  }
  o[0] = _v_68;
  return 1;
}

INLINE Term mdflt_367(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_69 = 0;
  Term _a_66 = r0;
  WL_SPIN
    _v_69 = nat_chk(e, _a_66 + 66);
  break;
  }
  o[0] = _v_69;
  return 1;
}

INLINE Term mdflt_368(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_70 = 0;
  Term _a_67 = r0;
  WL_SPIN
    _v_70 = nat_chk(e, _a_67 + 67);
  break;
  }
  o[0] = _v_70;
  return 1;
}

INLINE Term mdflt_369(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_71 = 0;
  Term _a_68 = r0;
  WL_SPIN
    _v_71 = nat_chk(e, _a_68 + 68);
  break;
  }
  o[0] = _v_71;
  return 1;
}

INLINE Term mdflt_370(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_72 = 0;
  Term _a_69 = r0;
  WL_SPIN
    _v_72 = nat_chk(e, _a_69 + 69);
  break;
  }
  o[0] = _v_72;
  return 1;
}

INLINE Term mdflt_371(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_73 = 0;
  Term _a_70 = r0;
  WL_SPIN
    _v_73 = nat_chk(e, _a_70 + 70);
  break;
  }
  o[0] = _v_73;
  return 1;
}

INLINE Term mdflt_372(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_74 = 0;
  Term _a_71 = r0;
  WL_SPIN
    _v_74 = nat_chk(e, _a_71 + 71);
  break;
  }
  o[0] = _v_74;
  return 1;
}

INLINE Term mdflt_373(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_75 = 0;
  Term _a_72 = r0;
  WL_SPIN
    _v_75 = nat_chk(e, _a_72 + 72);
  break;
  }
  o[0] = _v_75;
  return 1;
}

INLINE Term mdflt_374(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_76 = 0;
  Term _a_73 = r0;
  WL_SPIN
    _v_76 = nat_chk(e, _a_73 + 73);
  break;
  }
  o[0] = _v_76;
  return 1;
}

INLINE Term mdflt_375(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_77 = 0;
  Term _a_74 = r0;
  WL_SPIN
    _v_77 = nat_chk(e, _a_74 + 74);
  break;
  }
  o[0] = _v_77;
  return 1;
}

INLINE Term mdflt_376(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_78 = 0;
  Term _a_75 = r0;
  WL_SPIN
    _v_78 = nat_chk(e, _a_75 + 75);
  break;
  }
  o[0] = _v_78;
  return 1;
}

INLINE Term mdflt_377(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_79 = 0;
  Term _a_76 = r0;
  WL_SPIN
    _v_79 = nat_chk(e, _a_76 + 76);
  break;
  }
  o[0] = _v_79;
  return 1;
}

INLINE Term mdflt_378(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_80 = 0;
  Term _a_77 = r0;
  WL_SPIN
    _v_80 = nat_chk(e, _a_77 + 77);
  break;
  }
  o[0] = _v_80;
  return 1;
}

INLINE Term mdflt_379(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_81 = 0;
  Term _a_78 = r0;
  WL_SPIN
    _v_81 = nat_chk(e, _a_78 + 78);
  break;
  }
  o[0] = _v_81;
  return 1;
}

INLINE Term mdflt_380(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_82 = 0;
  Term _a_79 = r0;
  WL_SPIN
    _v_82 = nat_chk(e, _a_79 + 79);
  break;
  }
  o[0] = _v_82;
  return 1;
}

INLINE Term mdflt_381(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_83 = 0;
  Term _a_80 = r0;
  WL_SPIN
    _v_83 = nat_chk(e, _a_80 + 80);
  break;
  }
  o[0] = _v_83;
  return 1;
}

INLINE Term mdflt_382(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_84 = 0;
  Term _a_81 = r0;
  WL_SPIN
    _v_84 = nat_chk(e, _a_81 + 81);
  break;
  }
  o[0] = _v_84;
  return 1;
}

INLINE Term mdflt_383(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_85 = 0;
  Term _a_82 = r0;
  WL_SPIN
    _v_85 = nat_chk(e, _a_82 + 82);
  break;
  }
  o[0] = _v_85;
  return 1;
}

INLINE Term mdflt_384(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_86 = 0;
  Term _a_83 = r0;
  WL_SPIN
    _v_86 = nat_chk(e, _a_83 + 83);
  break;
  }
  o[0] = _v_86;
  return 1;
}

INLINE Term mdflt_385(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_87 = 0;
  Term _a_84 = r0;
  WL_SPIN
    _v_87 = nat_chk(e, _a_84 + 84);
  break;
  }
  o[0] = _v_87;
  return 1;
}

INLINE Term mdflt_386(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_88 = 0;
  Term _a_85 = r0;
  WL_SPIN
    _v_88 = nat_chk(e, _a_85 + 85);
  break;
  }
  o[0] = _v_88;
  return 1;
}

INLINE Term mdflt_387(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_89 = 0;
  Term _a_86 = r0;
  WL_SPIN
    _v_89 = nat_chk(e, _a_86 + 86);
  break;
  }
  o[0] = _v_89;
  return 1;
}

INLINE Term mdflt_388(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_90 = 0;
  Term _a_87 = r0;
  WL_SPIN
    _v_90 = nat_chk(e, _a_87 + 87);
  break;
  }
  o[0] = _v_90;
  return 1;
}

INLINE Term mdflt_389(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_91 = 0;
  Term _a_88 = r0;
  WL_SPIN
    _v_91 = nat_chk(e, _a_88 + 88);
  break;
  }
  o[0] = _v_91;
  return 1;
}

INLINE Term mdflt_390(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_92 = 0;
  Term _a_89 = r0;
  WL_SPIN
    _v_92 = nat_chk(e, _a_89 + 89);
  break;
  }
  o[0] = _v_92;
  return 1;
}

INLINE Term mdflt_391(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_93 = 0;
  Term _a_90 = r0;
  WL_SPIN
    _v_93 = nat_chk(e, _a_90 + 90);
  break;
  }
  o[0] = _v_93;
  return 1;
}

INLINE Term mdflt_392(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_94 = 0;
  Term _a_91 = r0;
  WL_SPIN
    _v_94 = nat_chk(e, _a_91 + 91);
  break;
  }
  o[0] = _v_94;
  return 1;
}

INLINE Term mdflt_393(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_95 = 0;
  Term _a_92 = r0;
  WL_SPIN
    _v_95 = nat_chk(e, _a_92 + 92);
  break;
  }
  o[0] = _v_95;
  return 1;
}

INLINE Term mdflt_394(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_96 = 0;
  Term _a_93 = r0;
  WL_SPIN
    _v_96 = nat_chk(e, _a_93 + 93);
  break;
  }
  o[0] = _v_96;
  return 1;
}

INLINE Term mdflt_395(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_97 = 0;
  Term _a_94 = r0;
  WL_SPIN
    _v_97 = nat_chk(e, _a_94 + 94);
  break;
  }
  o[0] = _v_97;
  return 1;
}

INLINE Term mdflt_396(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_98 = 0;
  Term _a_95 = r0;
  WL_SPIN
    _v_98 = nat_chk(e, _a_95 + 95);
  break;
  }
  o[0] = _v_98;
  return 1;
}

INLINE Term mdflt_397(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_99 = 0;
  Term _a_96 = r0;
  WL_SPIN
    _v_99 = nat_chk(e, _a_96 + 96);
  break;
  }
  o[0] = _v_99;
  return 1;
}

INLINE Term mdflt_398(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_100 = 0;
  Term _a_97 = r0;
  WL_SPIN
    _v_100 = nat_chk(e, _a_97 + 97);
  break;
  }
  o[0] = _v_100;
  return 1;
}

INLINE Term mdflt_399(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_101 = 0;
  Term _a_98 = r0;
  WL_SPIN
    _v_101 = nat_chk(e, _a_98 + 98);
  break;
  }
  o[0] = _v_101;
  return 1;
}

INLINE Term mdflt_400(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_102 = 0;
  Term _a_99 = r0;
  WL_SPIN
    _v_102 = nat_chk(e, _a_99 + 99);
  break;
  }
  o[0] = _v_102;
  return 1;
}

INLINE Term mdflt_401(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_103 = 0;
  Term _a_100 = r0;
  WL_SPIN
    _v_103 = nat_chk(e, _a_100 + 100);
  break;
  }
  o[0] = _v_103;
  return 1;
}

INLINE Term mdflt_402(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_104 = 0;
  Term _a_101 = r0;
  WL_SPIN
    _v_104 = nat_chk(e, _a_101 + 101);
  break;
  }
  o[0] = _v_104;
  return 1;
}

INLINE Term mdflt_403(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_105 = 0;
  Term _a_102 = r0;
  WL_SPIN
    _v_105 = nat_chk(e, _a_102 + 102);
  break;
  }
  o[0] = _v_105;
  return 1;
}

INLINE Term mdflt_404(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_106 = 0;
  Term _a_103 = r0;
  WL_SPIN
    _v_106 = nat_chk(e, _a_103 + 103);
  break;
  }
  o[0] = _v_106;
  return 1;
}

INLINE Term mdflt_405(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_107 = 0;
  Term _a_104 = r0;
  WL_SPIN
    _v_107 = nat_chk(e, _a_104 + 104);
  break;
  }
  o[0] = _v_107;
  return 1;
}

INLINE Term mdflt_406(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_108 = 0;
  Term _a_105 = r0;
  WL_SPIN
    _v_108 = nat_chk(e, _a_105 + 105);
  break;
  }
  o[0] = _v_108;
  return 1;
}

INLINE Term mdflt_407(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_109 = 0;
  Term _a_106 = r0;
  WL_SPIN
    _v_109 = nat_chk(e, _a_106 + 106);
  break;
  }
  o[0] = _v_109;
  return 1;
}

INLINE Term mdflt_408(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_110 = 0;
  Term _a_107 = r0;
  WL_SPIN
    _v_110 = nat_chk(e, _a_107 + 107);
  break;
  }
  o[0] = _v_110;
  return 1;
}

INLINE Term mdflt_409(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_111 = 0;
  Term _a_108 = r0;
  WL_SPIN
    _v_111 = nat_chk(e, _a_108 + 108);
  break;
  }
  o[0] = _v_111;
  return 1;
}

INLINE Term mdflt_410(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_112 = 0;
  Term _a_109 = r0;
  WL_SPIN
    _v_112 = nat_chk(e, _a_109 + 109);
  break;
  }
  o[0] = _v_112;
  return 1;
}

INLINE Term mdflt_411(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_113 = 0;
  Term _a_110 = r0;
  WL_SPIN
    _v_113 = nat_chk(e, _a_110 + 110);
  break;
  }
  o[0] = _v_113;
  return 1;
}

INLINE Term mdflt_412(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_114 = 0;
  Term _a_111 = r0;
  WL_SPIN
    _v_114 = nat_chk(e, _a_111 + 111);
  break;
  }
  o[0] = _v_114;
  return 1;
}

INLINE Term mdflt_413(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_115 = 0;
  Term _a_112 = r0;
  WL_SPIN
    _v_115 = nat_chk(e, _a_112 + 112);
  break;
  }
  o[0] = _v_115;
  return 1;
}

INLINE Term mdflt_414(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_116 = 0;
  Term _a_113 = r0;
  WL_SPIN
    _v_116 = nat_chk(e, _a_113 + 113);
  break;
  }
  o[0] = _v_116;
  return 1;
}

INLINE Term mdflt_415(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_117 = 0;
  Term _a_114 = r0;
  WL_SPIN
    _v_117 = nat_chk(e, _a_114 + 114);
  break;
  }
  o[0] = _v_117;
  return 1;
}

INLINE Term mdflt_416(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_118 = 0;
  Term _a_115 = r0;
  WL_SPIN
    _v_118 = nat_chk(e, _a_115 + 115);
  break;
  }
  o[0] = _v_118;
  return 1;
}

INLINE Term mdflt_417(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_119 = 0;
  Term _a_116 = r0;
  WL_SPIN
    _v_119 = nat_chk(e, _a_116 + 116);
  break;
  }
  o[0] = _v_119;
  return 1;
}

INLINE Term mdflt_418(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_120 = 0;
  Term _a_117 = r0;
  WL_SPIN
    _v_120 = nat_chk(e, _a_117 + 117);
  break;
  }
  o[0] = _v_120;
  return 1;
}

INLINE Term mdflt_419(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_121 = 0;
  Term _a_118 = r0;
  WL_SPIN
    _v_121 = nat_chk(e, _a_118 + 118);
  break;
  }
  o[0] = _v_121;
  return 1;
}

INLINE Term mdflt_420(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_122 = 0;
  Term _a_119 = r0;
  WL_SPIN
    _v_122 = nat_chk(e, _a_119 + 119);
  break;
  }
  o[0] = _v_122;
  return 1;
}

INLINE Term mdflt_421(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_123 = 0;
  Term _a_120 = r0;
  WL_SPIN
    _v_123 = nat_chk(e, _a_120 + 120);
  break;
  }
  o[0] = _v_123;
  return 1;
}

INLINE Term mdflt_422(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_124 = 0;
  Term _a_121 = r0;
  WL_SPIN
    _v_124 = nat_chk(e, _a_121 + 121);
  break;
  }
  o[0] = _v_124;
  return 1;
}

INLINE Term mdflt_423(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_125 = 0;
  Term _a_122 = r0;
  WL_SPIN
    _v_125 = nat_chk(e, _a_122 + 122);
  break;
  }
  o[0] = _v_125;
  return 1;
}

INLINE Term mdflt_424(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_126 = 0;
  Term _a_123 = r0;
  WL_SPIN
    _v_126 = nat_chk(e, _a_123 + 123);
  break;
  }
  o[0] = _v_126;
  return 1;
}

INLINE Term mdflt_425(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_127 = 0;
  Term _a_124 = r0;
  WL_SPIN
    _v_127 = nat_chk(e, _a_124 + 124);
  break;
  }
  o[0] = _v_127;
  return 1;
}

INLINE Term mdflt_426(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_128 = 0;
  Term _a_125 = r0;
  WL_SPIN
    _v_128 = nat_chk(e, _a_125 + 125);
  break;
  }
  o[0] = _v_128;
  return 1;
}

INLINE Term mdflt_427(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_129 = 0;
  Term _a_126 = r0;
  WL_SPIN
    _v_129 = nat_chk(e, _a_126 + 126);
  break;
  }
  o[0] = _v_129;
  return 1;
}

INLINE Term mdflt_428(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_130 = 0;
  Term _a_127 = r0;
  WL_SPIN
    _v_130 = nat_chk(e, _a_127 + 127);
  break;
  }
  o[0] = _v_130;
  return 1;
}

INLINE Term mdflt_429(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_131 = 0;
  Term _a_128 = r0;
  WL_SPIN
    _v_131 = nat_chk(e, _a_128 + 128);
  break;
  }
  o[0] = _v_131;
  return 1;
}

INLINE Term mdflt_430(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_132 = 0;
  Term _a_129 = r0;
  WL_SPIN
    _v_132 = nat_chk(e, _a_129 + 129);
  break;
  }
  o[0] = _v_132;
  return 1;
}

INLINE Term mdflt_431(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_133 = 0;
  Term _a_130 = r0;
  WL_SPIN
    _v_133 = nat_chk(e, _a_130 + 130);
  break;
  }
  o[0] = _v_133;
  return 1;
}

INLINE Term mdflt_432(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_134 = 0;
  Term _a_131 = r0;
  WL_SPIN
    _v_134 = nat_chk(e, _a_131 + 131);
  break;
  }
  o[0] = _v_134;
  return 1;
}

INLINE Term mdflt_433(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_135 = 0;
  Term _a_132 = r0;
  WL_SPIN
    _v_135 = nat_chk(e, _a_132 + 132);
  break;
  }
  o[0] = _v_135;
  return 1;
}

INLINE Term mdflt_434(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_136 = 0;
  Term _a_133 = r0;
  WL_SPIN
    _v_136 = nat_chk(e, _a_133 + 133);
  break;
  }
  o[0] = _v_136;
  return 1;
}

INLINE Term mdflt_435(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_137 = 0;
  Term _a_134 = r0;
  WL_SPIN
    _v_137 = nat_chk(e, _a_134 + 134);
  break;
  }
  o[0] = _v_137;
  return 1;
}

INLINE Term mdflt_436(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_138 = 0;
  Term _a_135 = r0;
  WL_SPIN
    _v_138 = nat_chk(e, _a_135 + 135);
  break;
  }
  o[0] = _v_138;
  return 1;
}

INLINE Term mdflt_437(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_139 = 0;
  Term _a_136 = r0;
  WL_SPIN
    _v_139 = nat_chk(e, _a_136 + 136);
  break;
  }
  o[0] = _v_139;
  return 1;
}

INLINE Term mdflt_438(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_140 = 0;
  Term _a_137 = r0;
  WL_SPIN
    _v_140 = nat_chk(e, _a_137 + 137);
  break;
  }
  o[0] = _v_140;
  return 1;
}

INLINE Term mdflt_439(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_141 = 0;
  Term _a_138 = r0;
  WL_SPIN
    _v_141 = nat_chk(e, _a_138 + 138);
  break;
  }
  o[0] = _v_141;
  return 1;
}

INLINE Term mdflt_440(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_142 = 0;
  Term _a_139 = r0;
  WL_SPIN
    _v_142 = nat_chk(e, _a_139 + 139);
  break;
  }
  o[0] = _v_142;
  return 1;
}

INLINE Term mdflt_441(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_143 = 0;
  Term _a_140 = r0;
  WL_SPIN
    _v_143 = nat_chk(e, _a_140 + 140);
  break;
  }
  o[0] = _v_143;
  return 1;
}

INLINE Term mdflt_442(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_144 = 0;
  Term _a_141 = r0;
  WL_SPIN
    _v_144 = nat_chk(e, _a_141 + 141);
  break;
  }
  o[0] = _v_144;
  return 1;
}

INLINE Term mdflt_443(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_145 = 0;
  Term _a_142 = r0;
  WL_SPIN
    _v_145 = nat_chk(e, _a_142 + 142);
  break;
  }
  o[0] = _v_145;
  return 1;
}

INLINE Term mdflt_444(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_146 = 0;
  Term _a_143 = r0;
  WL_SPIN
    _v_146 = nat_chk(e, _a_143 + 143);
  break;
  }
  o[0] = _v_146;
  return 1;
}

INLINE Term mdflt_445(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_147 = 0;
  Term _a_144 = r0;
  WL_SPIN
    _v_147 = nat_chk(e, _a_144 + 144);
  break;
  }
  o[0] = _v_147;
  return 1;
}

INLINE Term mdflt_446(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_148 = 0;
  Term _a_145 = r0;
  WL_SPIN
    _v_148 = nat_chk(e, _a_145 + 145);
  break;
  }
  o[0] = _v_148;
  return 1;
}

INLINE Term mdflt_447(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_149 = 0;
  Term _a_146 = r0;
  WL_SPIN
    _v_149 = nat_chk(e, _a_146 + 146);
  break;
  }
  o[0] = _v_149;
  return 1;
}

INLINE Term mdflt_448(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_150 = 0;
  Term _a_147 = r0;
  WL_SPIN
    _v_150 = nat_chk(e, _a_147 + 147);
  break;
  }
  o[0] = _v_150;
  return 1;
}

INLINE Term mdflt_449(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_151 = 0;
  Term _a_148 = r0;
  WL_SPIN
    _v_151 = nat_chk(e, _a_148 + 148);
  break;
  }
  o[0] = _v_151;
  return 1;
}

INLINE Term mdflt_450(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_152 = 0;
  Term _a_149 = r0;
  WL_SPIN
    _v_152 = nat_chk(e, _a_149 + 149);
  break;
  }
  o[0] = _v_152;
  return 1;
}

INLINE Term mdflt_451(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_153 = 0;
  Term _a_150 = r0;
  WL_SPIN
    _v_153 = nat_chk(e, _a_150 + 150);
  break;
  }
  o[0] = _v_153;
  return 1;
}

INLINE Term mdflt_452(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_154 = 0;
  Term _a_151 = r0;
  WL_SPIN
    _v_154 = nat_chk(e, _a_151 + 151);
  break;
  }
  o[0] = _v_154;
  return 1;
}

INLINE Term mdflt_453(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_155 = 0;
  Term _a_152 = r0;
  WL_SPIN
    _v_155 = nat_chk(e, _a_152 + 152);
  break;
  }
  o[0] = _v_155;
  return 1;
}

INLINE Term mdflt_454(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_156 = 0;
  Term _a_153 = r0;
  WL_SPIN
    _v_156 = nat_chk(e, _a_153 + 153);
  break;
  }
  o[0] = _v_156;
  return 1;
}

INLINE Term mdflt_455(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_157 = 0;
  Term _a_154 = r0;
  WL_SPIN
    _v_157 = nat_chk(e, _a_154 + 154);
  break;
  }
  o[0] = _v_157;
  return 1;
}

INLINE Term mdflt_456(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_158 = 0;
  Term _a_155 = r0;
  WL_SPIN
    _v_158 = nat_chk(e, _a_155 + 155);
  break;
  }
  o[0] = _v_158;
  return 1;
}

INLINE Term mdflt_457(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_159 = 0;
  Term _a_156 = r0;
  WL_SPIN
    _v_159 = nat_chk(e, _a_156 + 156);
  break;
  }
  o[0] = _v_159;
  return 1;
}

INLINE Term mdflt_458(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_160 = 0;
  Term _a_157 = r0;
  WL_SPIN
    _v_160 = nat_chk(e, _a_157 + 157);
  break;
  }
  o[0] = _v_160;
  return 1;
}

INLINE Term mdflt_459(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_161 = 0;
  Term _a_158 = r0;
  WL_SPIN
    _v_161 = nat_chk(e, _a_158 + 158);
  break;
  }
  o[0] = _v_161;
  return 1;
}

INLINE Term mdflt_460(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_162 = 0;
  Term _a_159 = r0;
  WL_SPIN
    _v_162 = nat_chk(e, _a_159 + 159);
  break;
  }
  o[0] = _v_162;
  return 1;
}

INLINE Term mdflt_461(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_163 = 0;
  Term _a_160 = r0;
  WL_SPIN
    _v_163 = nat_chk(e, _a_160 + 160);
  break;
  }
  o[0] = _v_163;
  return 1;
}

INLINE Term mdflt_462(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_164 = 0;
  Term _a_161 = r0;
  WL_SPIN
    _v_164 = nat_chk(e, _a_161 + 161);
  break;
  }
  o[0] = _v_164;
  return 1;
}

INLINE Term mdflt_463(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_165 = 0;
  Term _a_162 = r0;
  WL_SPIN
    _v_165 = nat_chk(e, _a_162 + 162);
  break;
  }
  o[0] = _v_165;
  return 1;
}

INLINE Term mdflt_464(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_166 = 0;
  Term _a_163 = r0;
  WL_SPIN
    _v_166 = nat_chk(e, _a_163 + 163);
  break;
  }
  o[0] = _v_166;
  return 1;
}

INLINE Term mdflt_465(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_167 = 0;
  Term _a_164 = r0;
  WL_SPIN
    _v_167 = nat_chk(e, _a_164 + 164);
  break;
  }
  o[0] = _v_167;
  return 1;
}

INLINE Term mdflt_466(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_168 = 0;
  Term _a_165 = r0;
  WL_SPIN
    _v_168 = nat_chk(e, _a_165 + 165);
  break;
  }
  o[0] = _v_168;
  return 1;
}

INLINE Term mdflt_467(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_169 = 0;
  Term _a_166 = r0;
  WL_SPIN
    _v_169 = nat_chk(e, _a_166 + 166);
  break;
  }
  o[0] = _v_169;
  return 1;
}

INLINE Term mdflt_468(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_170 = 0;
  Term _a_167 = r0;
  WL_SPIN
    _v_170 = nat_chk(e, _a_167 + 167);
  break;
  }
  o[0] = _v_170;
  return 1;
}

INLINE Term mdflt_469(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_171 = 0;
  Term _a_168 = r0;
  WL_SPIN
    _v_171 = nat_chk(e, _a_168 + 168);
  break;
  }
  o[0] = _v_171;
  return 1;
}

INLINE Term mdflt_470(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_172 = 0;
  Term _a_169 = r0;
  WL_SPIN
    _v_172 = nat_chk(e, _a_169 + 169);
  break;
  }
  o[0] = _v_172;
  return 1;
}

INLINE Term mdflt_471(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_173 = 0;
  Term _a_170 = r0;
  WL_SPIN
    _v_173 = nat_chk(e, _a_170 + 170);
  break;
  }
  o[0] = _v_173;
  return 1;
}

INLINE Term mdflt_472(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_174 = 0;
  Term _a_171 = r0;
  WL_SPIN
    _v_174 = nat_chk(e, _a_171 + 171);
  break;
  }
  o[0] = _v_174;
  return 1;
}

INLINE Term mdflt_473(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_175 = 0;
  Term _a_172 = r0;
  WL_SPIN
    _v_175 = nat_chk(e, _a_172 + 172);
  break;
  }
  o[0] = _v_175;
  return 1;
}

INLINE Term mdflt_474(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_176 = 0;
  Term _a_173 = r0;
  WL_SPIN
    _v_176 = nat_chk(e, _a_173 + 173);
  break;
  }
  o[0] = _v_176;
  return 1;
}

INLINE Term mdflt_475(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_177 = 0;
  Term _a_174 = r0;
  WL_SPIN
    _v_177 = nat_chk(e, _a_174 + 174);
  break;
  }
  o[0] = _v_177;
  return 1;
}

INLINE Term mdflt_476(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_178 = 0;
  Term _a_175 = r0;
  WL_SPIN
    _v_178 = nat_chk(e, _a_175 + 175);
  break;
  }
  o[0] = _v_178;
  return 1;
}

INLINE Term mdflt_477(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_179 = 0;
  Term _a_176 = r0;
  WL_SPIN
    _v_179 = nat_chk(e, _a_176 + 176);
  break;
  }
  o[0] = _v_179;
  return 1;
}

INLINE Term mdflt_478(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_180 = 0;
  Term _a_177 = r0;
  WL_SPIN
    _v_180 = nat_chk(e, _a_177 + 177);
  break;
  }
  o[0] = _v_180;
  return 1;
}

INLINE Term mdflt_479(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_181 = 0;
  Term _a_178 = r0;
  WL_SPIN
    _v_181 = nat_chk(e, _a_178 + 178);
  break;
  }
  o[0] = _v_181;
  return 1;
}

INLINE Term mdflt_480(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_182 = 0;
  Term _a_179 = r0;
  WL_SPIN
    _v_182 = nat_chk(e, _a_179 + 179);
  break;
  }
  o[0] = _v_182;
  return 1;
}

INLINE Term mdflt_481(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_183 = 0;
  Term _a_180 = r0;
  WL_SPIN
    _v_183 = nat_chk(e, _a_180 + 180);
  break;
  }
  o[0] = _v_183;
  return 1;
}

INLINE Term mdflt_482(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_184 = 0;
  Term _a_181 = r0;
  WL_SPIN
    _v_184 = nat_chk(e, _a_181 + 181);
  break;
  }
  o[0] = _v_184;
  return 1;
}

INLINE Term mdflt_483(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_185 = 0;
  Term _a_182 = r0;
  WL_SPIN
    _v_185 = nat_chk(e, _a_182 + 182);
  break;
  }
  o[0] = _v_185;
  return 1;
}

INLINE Term mdflt_484(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_186 = 0;
  Term _a_183 = r0;
  WL_SPIN
    _v_186 = nat_chk(e, _a_183 + 183);
  break;
  }
  o[0] = _v_186;
  return 1;
}

INLINE Term mdflt_485(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_187 = 0;
  Term _a_184 = r0;
  WL_SPIN
    _v_187 = nat_chk(e, _a_184 + 184);
  break;
  }
  o[0] = _v_187;
  return 1;
}

INLINE Term mdflt_486(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_188 = 0;
  Term _a_185 = r0;
  WL_SPIN
    _v_188 = nat_chk(e, _a_185 + 185);
  break;
  }
  o[0] = _v_188;
  return 1;
}

INLINE Term mdflt_487(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_189 = 0;
  Term _a_186 = r0;
  WL_SPIN
    _v_189 = nat_chk(e, _a_186 + 186);
  break;
  }
  o[0] = _v_189;
  return 1;
}

INLINE Term mdflt_488(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_190 = 0;
  Term _a_187 = r0;
  WL_SPIN
    _v_190 = nat_chk(e, _a_187 + 187);
  break;
  }
  o[0] = _v_190;
  return 1;
}

INLINE Term mdflt_489(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_191 = 0;
  Term _a_188 = r0;
  WL_SPIN
    _v_191 = nat_chk(e, _a_188 + 188);
  break;
  }
  o[0] = _v_191;
  return 1;
}

INLINE Term mdflt_490(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_192 = 0;
  Term _a_189 = r0;
  WL_SPIN
    _v_192 = nat_chk(e, _a_189 + 189);
  break;
  }
  o[0] = _v_192;
  return 1;
}

INLINE Term mdflt_491(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_193 = 0;
  Term _a_190 = r0;
  WL_SPIN
    _v_193 = nat_chk(e, _a_190 + 190);
  break;
  }
  o[0] = _v_193;
  return 1;
}

INLINE Term mdflt_492(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_194 = 0;
  Term _a_191 = r0;
  WL_SPIN
    _v_194 = nat_chk(e, _a_191 + 191);
  break;
  }
  o[0] = _v_194;
  return 1;
}

INLINE Term mdflt_493(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_195 = 0;
  Term _a_192 = r0;
  WL_SPIN
    _v_195 = nat_chk(e, _a_192 + 192);
  break;
  }
  o[0] = _v_195;
  return 1;
}

INLINE Term mdflt_494(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_196 = 0;
  Term _a_193 = r0;
  WL_SPIN
    _v_196 = nat_chk(e, _a_193 + 193);
  break;
  }
  o[0] = _v_196;
  return 1;
}

INLINE Term mdflt_495(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_197 = 0;
  Term _a_194 = r0;
  WL_SPIN
    _v_197 = nat_chk(e, _a_194 + 194);
  break;
  }
  o[0] = _v_197;
  return 1;
}

INLINE Term mdflt_496(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_198 = 0;
  Term _a_195 = r0;
  WL_SPIN
    _v_198 = nat_chk(e, _a_195 + 195);
  break;
  }
  o[0] = _v_198;
  return 1;
}

INLINE Term mdflt_497(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_199 = 0;
  Term _a_196 = r0;
  WL_SPIN
    _v_199 = nat_chk(e, _a_196 + 196);
  break;
  }
  o[0] = _v_199;
  return 1;
}

INLINE Term mdflt_498(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_200 = 0;
  Term _a_197 = r0;
  WL_SPIN
    _v_200 = nat_chk(e, _a_197 + 197);
  break;
  }
  o[0] = _v_200;
  return 1;
}

INLINE Term mdflt_499(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_201 = 0;
  Term _a_198 = r0;
  WL_SPIN
    _v_201 = nat_chk(e, _a_198 + 198);
  break;
  }
  o[0] = _v_201;
  return 1;
}

INLINE Term mdflt_500(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_202 = 0;
  Term _a_199 = r0;
  WL_SPIN
    _v_202 = nat_chk(e, _a_199 + 199);
  break;
  }
  o[0] = _v_202;
  return 1;
}

INLINE Term mdflt_501(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_203 = 0;
  Term _a_200 = r0;
  WL_SPIN
    _v_203 = nat_chk(e, _a_200 + 200);
  break;
  }
  o[0] = _v_203;
  return 1;
}

INLINE Term mdflt_502(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_204 = 0;
  Term _a_201 = r0;
  WL_SPIN
    _v_204 = nat_chk(e, _a_201 + 201);
  break;
  }
  o[0] = _v_204;
  return 1;
}

INLINE Term mdflt_503(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_205 = 0;
  Term _a_202 = r0;
  WL_SPIN
    _v_205 = nat_chk(e, _a_202 + 202);
  break;
  }
  o[0] = _v_205;
  return 1;
}

INLINE Term mdflt_504(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_206 = 0;
  Term _a_203 = r0;
  WL_SPIN
    _v_206 = nat_chk(e, _a_203 + 203);
  break;
  }
  o[0] = _v_206;
  return 1;
}

INLINE Term mdflt_505(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_207 = 0;
  Term _a_204 = r0;
  WL_SPIN
    _v_207 = nat_chk(e, _a_204 + 204);
  break;
  }
  o[0] = _v_207;
  return 1;
}

INLINE Term mdflt_506(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_208 = 0;
  Term _a_205 = r0;
  WL_SPIN
    _v_208 = nat_chk(e, _a_205 + 205);
  break;
  }
  o[0] = _v_208;
  return 1;
}

INLINE Term mdflt_507(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_209 = 0;
  Term _a_206 = r0;
  WL_SPIN
    _v_209 = nat_chk(e, _a_206 + 206);
  break;
  }
  o[0] = _v_209;
  return 1;
}

INLINE Term mdflt_508(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_210 = 0;
  Term _a_207 = r0;
  WL_SPIN
    _v_210 = nat_chk(e, _a_207 + 207);
  break;
  }
  o[0] = _v_210;
  return 1;
}

INLINE Term mdflt_509(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_211 = 0;
  Term _a_208 = r0;
  WL_SPIN
    _v_211 = nat_chk(e, _a_208 + 208);
  break;
  }
  o[0] = _v_211;
  return 1;
}

INLINE Term mdflt_510(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_212 = 0;
  Term _a_209 = r0;
  WL_SPIN
    _v_212 = nat_chk(e, _a_209 + 209);
  break;
  }
  o[0] = _v_212;
  return 1;
}

INLINE Term mdflt_511(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_213 = 0;
  Term _a_210 = r0;
  WL_SPIN
    _v_213 = nat_chk(e, _a_210 + 210);
  break;
  }
  o[0] = _v_213;
  return 1;
}

INLINE Term mdflt_512(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_214 = 0;
  Term _a_211 = r0;
  WL_SPIN
    _v_214 = nat_chk(e, _a_211 + 211);
  break;
  }
  o[0] = _v_214;
  return 1;
}

INLINE Term mdflt_513(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_215 = 0;
  Term _a_212 = r0;
  WL_SPIN
    _v_215 = nat_chk(e, _a_212 + 212);
  break;
  }
  o[0] = _v_215;
  return 1;
}

INLINE Term mdflt_514(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_216 = 0;
  Term _a_213 = r0;
  WL_SPIN
    _v_216 = nat_chk(e, _a_213 + 213);
  break;
  }
  o[0] = _v_216;
  return 1;
}

INLINE Term mdflt_515(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_217 = 0;
  Term _a_214 = r0;
  WL_SPIN
    _v_217 = nat_chk(e, _a_214 + 214);
  break;
  }
  o[0] = _v_217;
  return 1;
}

INLINE Term mdflt_516(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_218 = 0;
  Term _a_215 = r0;
  WL_SPIN
    _v_218 = nat_chk(e, _a_215 + 215);
  break;
  }
  o[0] = _v_218;
  return 1;
}

INLINE Term mdflt_517(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_219 = 0;
  Term _a_216 = r0;
  WL_SPIN
    _v_219 = nat_chk(e, _a_216 + 216);
  break;
  }
  o[0] = _v_219;
  return 1;
}

INLINE Term mdflt_518(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_220 = 0;
  Term _a_217 = r0;
  WL_SPIN
    _v_220 = nat_chk(e, _a_217 + 217);
  break;
  }
  o[0] = _v_220;
  return 1;
}

INLINE Term mdflt_519(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_221 = 0;
  Term _a_218 = r0;
  WL_SPIN
    _v_221 = nat_chk(e, _a_218 + 218);
  break;
  }
  o[0] = _v_221;
  return 1;
}

INLINE Term mdflt_520(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_222 = 0;
  Term _a_219 = r0;
  WL_SPIN
    _v_222 = nat_chk(e, _a_219 + 219);
  break;
  }
  o[0] = _v_222;
  return 1;
}

INLINE Term mdflt_521(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_223 = 0;
  Term _a_220 = r0;
  WL_SPIN
    _v_223 = nat_chk(e, _a_220 + 220);
  break;
  }
  o[0] = _v_223;
  return 1;
}

INLINE Term mdflt_522(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_224 = 0;
  Term _a_221 = r0;
  WL_SPIN
    _v_224 = nat_chk(e, _a_221 + 221);
  break;
  }
  o[0] = _v_224;
  return 1;
}

INLINE Term mdflt_523(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_225 = 0;
  Term _a_222 = r0;
  WL_SPIN
    _v_225 = nat_chk(e, _a_222 + 222);
  break;
  }
  o[0] = _v_225;
  return 1;
}

INLINE Term mdflt_524(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_226 = 0;
  Term _a_223 = r0;
  WL_SPIN
    _v_226 = nat_chk(e, _a_223 + 223);
  break;
  }
  o[0] = _v_226;
  return 1;
}

INLINE Term mdflt_525(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_227 = 0;
  Term _a_224 = r0;
  WL_SPIN
    _v_227 = nat_chk(e, _a_224 + 224);
  break;
  }
  o[0] = _v_227;
  return 1;
}

INLINE Term mdflt_526(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_228 = 0;
  Term _a_225 = r0;
  WL_SPIN
    _v_228 = nat_chk(e, _a_225 + 225);
  break;
  }
  o[0] = _v_228;
  return 1;
}

INLINE Term mdflt_527(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_229 = 0;
  Term _a_226 = r0;
  WL_SPIN
    _v_229 = nat_chk(e, _a_226 + 226);
  break;
  }
  o[0] = _v_229;
  return 1;
}

INLINE Term mdflt_528(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_230 = 0;
  Term _a_227 = r0;
  WL_SPIN
    _v_230 = nat_chk(e, _a_227 + 227);
  break;
  }
  o[0] = _v_230;
  return 1;
}

INLINE Term mdflt_529(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_231 = 0;
  Term _a_228 = r0;
  WL_SPIN
    _v_231 = nat_chk(e, _a_228 + 228);
  break;
  }
  o[0] = _v_231;
  return 1;
}

INLINE Term mdflt_530(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_232 = 0;
  Term _a_229 = r0;
  WL_SPIN
    _v_232 = nat_chk(e, _a_229 + 229);
  break;
  }
  o[0] = _v_232;
  return 1;
}

INLINE Term mdflt_531(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_233 = 0;
  Term _a_230 = r0;
  WL_SPIN
    _v_233 = nat_chk(e, _a_230 + 230);
  break;
  }
  o[0] = _v_233;
  return 1;
}

INLINE Term mdflt_532(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_234 = 0;
  Term _a_231 = r0;
  WL_SPIN
    _v_234 = nat_chk(e, _a_231 + 231);
  break;
  }
  o[0] = _v_234;
  return 1;
}

INLINE Term mdflt_533(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_235 = 0;
  Term _a_232 = r0;
  WL_SPIN
    _v_235 = nat_chk(e, _a_232 + 232);
  break;
  }
  o[0] = _v_235;
  return 1;
}

INLINE Term mdflt_534(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_236 = 0;
  Term _a_233 = r0;
  WL_SPIN
    _v_236 = nat_chk(e, _a_233 + 233);
  break;
  }
  o[0] = _v_236;
  return 1;
}

INLINE Term mdflt_535(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_237 = 0;
  Term _a_234 = r0;
  WL_SPIN
    _v_237 = nat_chk(e, _a_234 + 234);
  break;
  }
  o[0] = _v_237;
  return 1;
}

INLINE Term mdflt_536(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_238 = 0;
  Term _a_235 = r0;
  WL_SPIN
    _v_238 = nat_chk(e, _a_235 + 235);
  break;
  }
  o[0] = _v_238;
  return 1;
}

INLINE Term mdflt_537(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_239 = 0;
  Term _a_236 = r0;
  WL_SPIN
    _v_239 = nat_chk(e, _a_236 + 236);
  break;
  }
  o[0] = _v_239;
  return 1;
}

INLINE Term mdflt_538(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_240 = 0;
  Term _a_237 = r0;
  WL_SPIN
    _v_240 = nat_chk(e, _a_237 + 237);
  break;
  }
  o[0] = _v_240;
  return 1;
}

INLINE Term mdflt_539(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_241 = 0;
  Term _a_238 = r0;
  WL_SPIN
    _v_241 = nat_chk(e, _a_238 + 238);
  break;
  }
  o[0] = _v_241;
  return 1;
}

INLINE Term mdflt_540(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_242 = 0;
  Term _a_239 = r0;
  WL_SPIN
    _v_242 = nat_chk(e, _a_239 + 239);
  break;
  }
  o[0] = _v_242;
  return 1;
}

INLINE Term mdflt_541(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_243 = 0;
  Term _a_240 = r0;
  WL_SPIN
    _v_243 = nat_chk(e, _a_240 + 240);
  break;
  }
  o[0] = _v_243;
  return 1;
}

INLINE Term mdflt_542(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_244 = 0;
  Term _a_241 = r0;
  WL_SPIN
    _v_244 = nat_chk(e, _a_241 + 241);
  break;
  }
  o[0] = _v_244;
  return 1;
}

INLINE Term mdflt_543(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_245 = 0;
  Term _a_242 = r0;
  WL_SPIN
    _v_245 = nat_chk(e, _a_242 + 242);
  break;
  }
  o[0] = _v_245;
  return 1;
}

INLINE Term mdflt_544(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_246 = 0;
  Term _a_243 = r0;
  WL_SPIN
    _v_246 = nat_chk(e, _a_243 + 243);
  break;
  }
  o[0] = _v_246;
  return 1;
}

INLINE Term mdflt_545(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_247 = 0;
  Term _a_244 = r0;
  WL_SPIN
    _v_247 = nat_chk(e, _a_244 + 244);
  break;
  }
  o[0] = _v_247;
  return 1;
}

INLINE Term mdflt_546(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_248 = 0;
  Term _a_245 = r0;
  WL_SPIN
    _v_248 = nat_chk(e, _a_245 + 245);
  break;
  }
  o[0] = _v_248;
  return 1;
}

INLINE Term mdflt_547(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_249 = 0;
  Term _a_246 = r0;
  WL_SPIN
    _v_249 = nat_chk(e, _a_246 + 246);
  break;
  }
  o[0] = _v_249;
  return 1;
}

INLINE Term mdflt_548(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_250 = 0;
  Term _a_247 = r0;
  WL_SPIN
    _v_250 = nat_chk(e, _a_247 + 247);
  break;
  }
  o[0] = _v_250;
  return 1;
}

INLINE Term mdflt_549(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_251 = 0;
  Term _a_248 = r0;
  WL_SPIN
    _v_251 = nat_chk(e, _a_248 + 248);
  break;
  }
  o[0] = _v_251;
  return 1;
}

INLINE Term mdflt_550(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_252 = 0;
  Term _a_249 = r0;
  WL_SPIN
    _v_252 = nat_chk(e, _a_249 + 249);
  break;
  }
  o[0] = _v_252;
  return 1;
}

INLINE Term mdflt_551(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_253 = 0;
  Term _a_250 = r0;
  WL_SPIN
    _v_253 = nat_chk(e, _a_250 + 250);
  break;
  }
  o[0] = _v_253;
  return 1;
}

INLINE Term mdflt_552(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_254 = 0;
  Term _a_251 = r0;
  WL_SPIN
    _v_254 = nat_chk(e, _a_251 + 251);
  break;
  }
  o[0] = _v_254;
  return 1;
}

INLINE Term mdflt_553(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_255 = 0;
  Term _a_252 = r0;
  WL_SPIN
    _v_255 = nat_chk(e, _a_252 + 252);
  break;
  }
  o[0] = _v_255;
  return 1;
}

INLINE Term mdflt_554(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_256 = 0;
  Term _a_253 = r0;
  WL_SPIN
    _v_256 = nat_chk(e, _a_253 + 253);
  break;
  }
  o[0] = _v_256;
  return 1;
}

INLINE Term mdflt_555(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_257 = 0;
  Term _a_254 = r0;
  WL_SPIN
    _v_257 = nat_chk(e, _a_254 + 254);
  break;
  }
  o[0] = _v_257;
  return 1;
}

INLINE Term mdflt_556(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_258 = 0;
  Term _a_255 = r0;
  WL_SPIN
    _v_258 = nat_chk(e, _a_255 + 255);
  break;
  }
  o[0] = _v_258;
  return 1;
}

INLINE Term mdflt_557(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_259 = 0;
  Term _a_256 = r0;
  WL_SPIN
    _v_259 = nat_chk(e, _a_256 + 256);
  break;
  }
  o[0] = _v_259;
  return 1;
}

INLINE Term mdflt_558(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_260 = 0;
  Term _a_257 = r0;
  WL_SPIN
    _v_260 = nat_chk(e, _a_257 + 257);
  break;
  }
  o[0] = _v_260;
  return 1;
}

INLINE Term mdflt_559(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_261 = 0;
  Term _a_258 = r0;
  WL_SPIN
    _v_261 = nat_chk(e, _a_258 + 258);
  break;
  }
  o[0] = _v_261;
  return 1;
}

INLINE Term mdflt_560(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_262 = 0;
  Term _a_259 = r0;
  WL_SPIN
    _v_262 = nat_chk(e, _a_259 + 259);
  break;
  }
  o[0] = _v_262;
  return 1;
}

INLINE Term mdflt_561(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_263 = 0;
  Term _a_260 = r0;
  WL_SPIN
    _v_263 = nat_chk(e, _a_260 + 260);
  break;
  }
  o[0] = _v_263;
  return 1;
}

INLINE Term mdflt_562(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_264 = 0;
  Term _a_261 = r0;
  WL_SPIN
    _v_264 = nat_chk(e, _a_261 + 261);
  break;
  }
  o[0] = _v_264;
  return 1;
}

INLINE Term mdflt_563(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_265 = 0;
  Term _a_262 = r0;
  WL_SPIN
    _v_265 = nat_chk(e, _a_262 + 262);
  break;
  }
  o[0] = _v_265;
  return 1;
}

INLINE Term mdflt_564(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_266 = 0;
  Term _a_263 = r0;
  WL_SPIN
    _v_266 = nat_chk(e, _a_263 + 263);
  break;
  }
  o[0] = _v_266;
  return 1;
}

INLINE Term mdflt_565(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_267 = 0;
  Term _a_264 = r0;
  WL_SPIN
    _v_267 = nat_chk(e, _a_264 + 264);
  break;
  }
  o[0] = _v_267;
  return 1;
}

INLINE Term mdflt_566(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_268 = 0;
  Term _a_265 = r0;
  WL_SPIN
    _v_268 = nat_chk(e, _a_265 + 265);
  break;
  }
  o[0] = _v_268;
  return 1;
}

INLINE Term mdflt_567(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_269 = 0;
  Term _a_266 = r0;
  WL_SPIN
    _v_269 = nat_chk(e, _a_266 + 266);
  break;
  }
  o[0] = _v_269;
  return 1;
}

INLINE Term mdflt_568(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_270 = 0;
  Term _a_267 = r0;
  WL_SPIN
    _v_270 = nat_chk(e, _a_267 + 267);
  break;
  }
  o[0] = _v_270;
  return 1;
}

INLINE Term mdflt_569(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_271 = 0;
  Term _a_268 = r0;
  WL_SPIN
    _v_271 = nat_chk(e, _a_268 + 268);
  break;
  }
  o[0] = _v_271;
  return 1;
}

INLINE Term mdflt_570(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_272 = 0;
  Term _a_269 = r0;
  WL_SPIN
    _v_272 = nat_chk(e, _a_269 + 269);
  break;
  }
  o[0] = _v_272;
  return 1;
}

INLINE Term mdflt_571(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_273 = 0;
  Term _a_270 = r0;
  WL_SPIN
    _v_273 = nat_chk(e, _a_270 + 270);
  break;
  }
  o[0] = _v_273;
  return 1;
}

INLINE Term mdflt_572(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_274 = 0;
  Term _a_271 = r0;
  WL_SPIN
    _v_274 = nat_chk(e, _a_271 + 271);
  break;
  }
  o[0] = _v_274;
  return 1;
}

INLINE Term mdflt_573(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_275 = 0;
  Term _a_272 = r0;
  WL_SPIN
    _v_275 = nat_chk(e, _a_272 + 272);
  break;
  }
  o[0] = _v_275;
  return 1;
}

INLINE Term mdflt_574(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_276 = 0;
  Term _a_273 = r0;
  WL_SPIN
    _v_276 = nat_chk(e, _a_273 + 273);
  break;
  }
  o[0] = _v_276;
  return 1;
}

INLINE Term mdflt_575(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_277 = 0;
  Term _a_274 = r0;
  WL_SPIN
    _v_277 = nat_chk(e, _a_274 + 274);
  break;
  }
  o[0] = _v_277;
  return 1;
}

INLINE Term mdflt_576(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_278 = 0;
  Term _a_275 = r0;
  WL_SPIN
    _v_278 = nat_chk(e, _a_275 + 275);
  break;
  }
  o[0] = _v_278;
  return 1;
}

INLINE Term mdflt_577(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_279 = 0;
  Term _a_276 = r0;
  WL_SPIN
    _v_279 = nat_chk(e, _a_276 + 276);
  break;
  }
  o[0] = _v_279;
  return 1;
}

INLINE Term mdflt_578(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_280 = 0;
  Term _a_277 = r0;
  WL_SPIN
    _v_280 = nat_chk(e, _a_277 + 277);
  break;
  }
  o[0] = _v_280;
  return 1;
}

INLINE Term mdflt_579(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_281 = 0;
  Term _a_278 = r0;
  WL_SPIN
    _v_281 = nat_chk(e, _a_278 + 278);
  break;
  }
  o[0] = _v_281;
  return 1;
}

INLINE Term mdflt_580(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_282 = 0;
  Term _a_279 = r0;
  WL_SPIN
    _v_282 = nat_chk(e, _a_279 + 279);
  break;
  }
  o[0] = _v_282;
  return 1;
}

INLINE Term mdflt_581(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_283 = 0;
  Term _a_280 = r0;
  WL_SPIN
    _v_283 = nat_chk(e, _a_280 + 280);
  break;
  }
  o[0] = _v_283;
  return 1;
}

INLINE Term mdflt_582(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_284 = 0;
  Term _a_281 = r0;
  WL_SPIN
    _v_284 = nat_chk(e, _a_281 + 281);
  break;
  }
  o[0] = _v_284;
  return 1;
}

INLINE Term mdflt_583(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_285 = 0;
  Term _a_282 = r0;
  WL_SPIN
    _v_285 = nat_chk(e, _a_282 + 282);
  break;
  }
  o[0] = _v_285;
  return 1;
}

INLINE Term mdflt_584(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_286 = 0;
  Term _a_283 = r0;
  WL_SPIN
    _v_286 = nat_chk(e, _a_283 + 283);
  break;
  }
  o[0] = _v_286;
  return 1;
}

INLINE Term mdflt_585(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_287 = 0;
  Term _a_284 = r0;
  WL_SPIN
    _v_287 = nat_chk(e, _a_284 + 284);
  break;
  }
  o[0] = _v_287;
  return 1;
}

INLINE Term mdflt_586(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_288 = 0;
  Term _a_285 = r0;
  WL_SPIN
    _v_288 = nat_chk(e, _a_285 + 285);
  break;
  }
  o[0] = _v_288;
  return 1;
}

INLINE Term mdflt_587(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_289 = 0;
  Term _a_286 = r0;
  WL_SPIN
    _v_289 = nat_chk(e, _a_286 + 286);
  break;
  }
  o[0] = _v_289;
  return 1;
}

INLINE Term mdflt_588(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_290 = 0;
  Term _a_287 = r0;
  WL_SPIN
    _v_290 = nat_chk(e, _a_287 + 287);
  break;
  }
  o[0] = _v_290;
  return 1;
}

INLINE Term mdflt_589(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_291 = 0;
  Term _a_288 = r0;
  WL_SPIN
    _v_291 = nat_chk(e, _a_288 + 288);
  break;
  }
  o[0] = _v_291;
  return 1;
}

INLINE Term mdflt_590(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_292 = 0;
  Term _a_289 = r0;
  WL_SPIN
    _v_292 = nat_chk(e, _a_289 + 289);
  break;
  }
  o[0] = _v_292;
  return 1;
}

INLINE Term mdflt_591(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_293 = 0;
  Term _a_290 = r0;
  WL_SPIN
    _v_293 = nat_chk(e, _a_290 + 290);
  break;
  }
  o[0] = _v_293;
  return 1;
}

INLINE Term mdflt_592(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_294 = 0;
  Term _a_291 = r0;
  WL_SPIN
    _v_294 = nat_chk(e, _a_291 + 291);
  break;
  }
  o[0] = _v_294;
  return 1;
}

INLINE Term mdflt_593(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_295 = 0;
  Term _a_292 = r0;
  WL_SPIN
    _v_295 = nat_chk(e, _a_292 + 292);
  break;
  }
  o[0] = _v_295;
  return 1;
}

INLINE Term mdflt_594(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_296 = 0;
  Term _a_293 = r0;
  WL_SPIN
    _v_296 = nat_chk(e, _a_293 + 293);
  break;
  }
  o[0] = _v_296;
  return 1;
}

INLINE Term mdflt_595(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_297 = 0;
  Term _a_294 = r0;
  WL_SPIN
    _v_297 = nat_chk(e, _a_294 + 294);
  break;
  }
  o[0] = _v_297;
  return 1;
}

INLINE Term mdflt_596(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_298 = 0;
  Term _a_295 = r0;
  WL_SPIN
    _v_298 = nat_chk(e, _a_295 + 295);
  break;
  }
  o[0] = _v_298;
  return 1;
}

INLINE Term mdflt_597(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_299 = 0;
  Term _a_296 = r0;
  WL_SPIN
    _v_299 = nat_chk(e, _a_296 + 296);
  break;
  }
  o[0] = _v_299;
  return 1;
}

INLINE Term mdflt_598(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_300 = 0;
  Term _a_297 = r0;
  WL_SPIN
    _v_300 = nat_chk(e, _a_297 + 297);
  break;
  }
  o[0] = _v_300;
  return 1;
}

INLINE Term mdflt_599(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_301 = 0;
  Term _a_298 = r0;
  WL_SPIN
    _v_301 = nat_chk(e, _a_298 + 298);
  break;
  }
  o[0] = _v_301;
  return 1;
}

INLINE Term mdflt_600(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_302 = 0;
  Term _a_299 = r0;
  WL_SPIN
    _v_302 = nat_chk(e, _a_299 + 299);
  break;
  }
  o[0] = _v_302;
  return 1;
}

INLINE Term mdflt_601(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_303 = 0;
  Term _a_300 = r0;
  WL_SPIN
    _v_303 = nat_chk(e, _a_300 + 300);
  break;
  }
  o[0] = _v_303;
  return 1;
}

FAR Term spin_0(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_2 = 0;
  Term _n_0 = r0;
  WL_SPIN
    if (_n_0 == 0) {
      Term _o_0[1];
      if (mdflt_301(e, _o_0, (_n_0 - 0)) == 0) {
        return 0;
      }
      _v_2 = _o_0[0];
    } else if (_n_0 == 1) {
      Term _o_1[1];
      if (mdflt_302(e, _o_1, (_n_0 - 1)) == 0) {
        return 0;
      }
      _v_2 = _o_1[0];
    } else if (_n_0 == 2) {
      Term _o_2[1];
      if (mdflt_303(e, _o_2, (_n_0 - 2)) == 0) {
        return 0;
      }
      _v_2 = _o_2[0];
    } else if (_n_0 == 3) {
      Term _o_3[1];
      if (mdflt_304(e, _o_3, (_n_0 - 3)) == 0) {
        return 0;
      }
      _v_2 = _o_3[0];
    } else if (_n_0 == 4) {
      Term _o_4[1];
      if (mdflt_305(e, _o_4, (_n_0 - 4)) == 0) {
        return 0;
      }
      _v_2 = _o_4[0];
    } else if (_n_0 == 5) {
      Term _o_5[1];
      if (mdflt_306(e, _o_5, (_n_0 - 5)) == 0) {
        return 0;
      }
      _v_2 = _o_5[0];
    } else if (_n_0 == 6) {
      Term _o_6[1];
      if (mdflt_307(e, _o_6, (_n_0 - 6)) == 0) {
        return 0;
      }
      _v_2 = _o_6[0];
    } else if (_n_0 == 7) {
      Term _o_7[1];
      if (mdflt_308(e, _o_7, (_n_0 - 7)) == 0) {
        return 0;
      }
      _v_2 = _o_7[0];
    } else if (_n_0 == 8) {
      Term _o_8[1];
      if (mdflt_309(e, _o_8, (_n_0 - 8)) == 0) {
        return 0;
      }
      _v_2 = _o_8[0];
    } else if (_n_0 == 9) {
      Term _o_9[1];
      if (mdflt_310(e, _o_9, (_n_0 - 9)) == 0) {
        return 0;
      }
      _v_2 = _o_9[0];
    } else if (_n_0 == 10) {
      Term _o_10[1];
      if (mdflt_311(e, _o_10, (_n_0 - 10)) == 0) {
        return 0;
      }
      _v_2 = _o_10[0];
    } else if (_n_0 == 11) {
      Term _o_11[1];
      if (mdflt_312(e, _o_11, (_n_0 - 11)) == 0) {
        return 0;
      }
      _v_2 = _o_11[0];
    } else if (_n_0 == 12) {
      Term _o_12[1];
      if (mdflt_313(e, _o_12, (_n_0 - 12)) == 0) {
        return 0;
      }
      _v_2 = _o_12[0];
    } else if (_n_0 == 13) {
      Term _o_13[1];
      if (mdflt_314(e, _o_13, (_n_0 - 13)) == 0) {
        return 0;
      }
      _v_2 = _o_13[0];
    } else if (_n_0 == 14) {
      Term _o_14[1];
      if (mdflt_315(e, _o_14, (_n_0 - 14)) == 0) {
        return 0;
      }
      _v_2 = _o_14[0];
    } else if (_n_0 == 15) {
      Term _o_15[1];
      if (mdflt_316(e, _o_15, (_n_0 - 15)) == 0) {
        return 0;
      }
      _v_2 = _o_15[0];
    } else if (_n_0 == 16) {
      Term _o_16[1];
      if (mdflt_317(e, _o_16, (_n_0 - 16)) == 0) {
        return 0;
      }
      _v_2 = _o_16[0];
    } else if (_n_0 == 17) {
      Term _o_17[1];
      if (mdflt_318(e, _o_17, (_n_0 - 17)) == 0) {
        return 0;
      }
      _v_2 = _o_17[0];
    } else if (_n_0 == 18) {
      Term _o_18[1];
      if (mdflt_319(e, _o_18, (_n_0 - 18)) == 0) {
        return 0;
      }
      _v_2 = _o_18[0];
    } else if (_n_0 == 19) {
      Term _o_19[1];
      if (mdflt_320(e, _o_19, (_n_0 - 19)) == 0) {
        return 0;
      }
      _v_2 = _o_19[0];
    } else if (_n_0 == 20) {
      Term _o_20[1];
      if (mdflt_321(e, _o_20, (_n_0 - 20)) == 0) {
        return 0;
      }
      _v_2 = _o_20[0];
    } else if (_n_0 == 21) {
      Term _o_21[1];
      if (mdflt_322(e, _o_21, (_n_0 - 21)) == 0) {
        return 0;
      }
      _v_2 = _o_21[0];
    } else if (_n_0 == 22) {
      Term _o_22[1];
      if (mdflt_323(e, _o_22, (_n_0 - 22)) == 0) {
        return 0;
      }
      _v_2 = _o_22[0];
    } else if (_n_0 == 23) {
      Term _o_23[1];
      if (mdflt_324(e, _o_23, (_n_0 - 23)) == 0) {
        return 0;
      }
      _v_2 = _o_23[0];
    } else if (_n_0 == 24) {
      Term _o_24[1];
      if (mdflt_325(e, _o_24, (_n_0 - 24)) == 0) {
        return 0;
      }
      _v_2 = _o_24[0];
    } else if (_n_0 == 25) {
      Term _o_25[1];
      if (mdflt_326(e, _o_25, (_n_0 - 25)) == 0) {
        return 0;
      }
      _v_2 = _o_25[0];
    } else if (_n_0 == 26) {
      Term _o_26[1];
      if (mdflt_327(e, _o_26, (_n_0 - 26)) == 0) {
        return 0;
      }
      _v_2 = _o_26[0];
    } else if (_n_0 == 27) {
      Term _o_27[1];
      if (mdflt_328(e, _o_27, (_n_0 - 27)) == 0) {
        return 0;
      }
      _v_2 = _o_27[0];
    } else if (_n_0 == 28) {
      Term _o_28[1];
      if (mdflt_329(e, _o_28, (_n_0 - 28)) == 0) {
        return 0;
      }
      _v_2 = _o_28[0];
    } else if (_n_0 == 29) {
      Term _o_29[1];
      if (mdflt_330(e, _o_29, (_n_0 - 29)) == 0) {
        return 0;
      }
      _v_2 = _o_29[0];
    } else if (_n_0 == 30) {
      Term _o_30[1];
      if (mdflt_331(e, _o_30, (_n_0 - 30)) == 0) {
        return 0;
      }
      _v_2 = _o_30[0];
    } else if (_n_0 == 31) {
      Term _o_31[1];
      if (mdflt_332(e, _o_31, (_n_0 - 31)) == 0) {
        return 0;
      }
      _v_2 = _o_31[0];
    } else if (_n_0 == 32) {
      Term _o_32[1];
      if (mdflt_333(e, _o_32, (_n_0 - 32)) == 0) {
        return 0;
      }
      _v_2 = _o_32[0];
    } else if (_n_0 == 33) {
      Term _o_33[1];
      if (mdflt_334(e, _o_33, (_n_0 - 33)) == 0) {
        return 0;
      }
      _v_2 = _o_33[0];
    } else if (_n_0 == 34) {
      Term _o_34[1];
      if (mdflt_335(e, _o_34, (_n_0 - 34)) == 0) {
        return 0;
      }
      _v_2 = _o_34[0];
    } else if (_n_0 == 35) {
      Term _o_35[1];
      if (mdflt_336(e, _o_35, (_n_0 - 35)) == 0) {
        return 0;
      }
      _v_2 = _o_35[0];
    } else if (_n_0 == 36) {
      Term _o_36[1];
      if (mdflt_337(e, _o_36, (_n_0 - 36)) == 0) {
        return 0;
      }
      _v_2 = _o_36[0];
    } else if (_n_0 == 37) {
      Term _o_37[1];
      if (mdflt_338(e, _o_37, (_n_0 - 37)) == 0) {
        return 0;
      }
      _v_2 = _o_37[0];
    } else if (_n_0 == 38) {
      Term _o_38[1];
      if (mdflt_339(e, _o_38, (_n_0 - 38)) == 0) {
        return 0;
      }
      _v_2 = _o_38[0];
    } else if (_n_0 == 39) {
      Term _o_39[1];
      if (mdflt_340(e, _o_39, (_n_0 - 39)) == 0) {
        return 0;
      }
      _v_2 = _o_39[0];
    } else if (_n_0 == 40) {
      Term _o_40[1];
      if (mdflt_341(e, _o_40, (_n_0 - 40)) == 0) {
        return 0;
      }
      _v_2 = _o_40[0];
    } else if (_n_0 == 41) {
      Term _o_41[1];
      if (mdflt_342(e, _o_41, (_n_0 - 41)) == 0) {
        return 0;
      }
      _v_2 = _o_41[0];
    } else if (_n_0 == 42) {
      Term _o_42[1];
      if (mdflt_343(e, _o_42, (_n_0 - 42)) == 0) {
        return 0;
      }
      _v_2 = _o_42[0];
    } else if (_n_0 == 43) {
      Term _o_43[1];
      if (mdflt_344(e, _o_43, (_n_0 - 43)) == 0) {
        return 0;
      }
      _v_2 = _o_43[0];
    } else if (_n_0 == 44) {
      Term _o_44[1];
      if (mdflt_345(e, _o_44, (_n_0 - 44)) == 0) {
        return 0;
      }
      _v_2 = _o_44[0];
    } else if (_n_0 == 45) {
      Term _o_45[1];
      if (mdflt_346(e, _o_45, (_n_0 - 45)) == 0) {
        return 0;
      }
      _v_2 = _o_45[0];
    } else if (_n_0 == 46) {
      Term _o_46[1];
      if (mdflt_347(e, _o_46, (_n_0 - 46)) == 0) {
        return 0;
      }
      _v_2 = _o_46[0];
    } else if (_n_0 == 47) {
      Term _o_47[1];
      if (mdflt_348(e, _o_47, (_n_0 - 47)) == 0) {
        return 0;
      }
      _v_2 = _o_47[0];
    } else if (_n_0 == 48) {
      Term _o_48[1];
      if (mdflt_349(e, _o_48, (_n_0 - 48)) == 0) {
        return 0;
      }
      _v_2 = _o_48[0];
    } else if (_n_0 == 49) {
      Term _o_49[1];
      if (mdflt_350(e, _o_49, (_n_0 - 49)) == 0) {
        return 0;
      }
      _v_2 = _o_49[0];
    } else if (_n_0 == 50) {
      Term _o_50[1];
      if (mdflt_351(e, _o_50, (_n_0 - 50)) == 0) {
        return 0;
      }
      _v_2 = _o_50[0];
    } else if (_n_0 == 51) {
      Term _o_51[1];
      if (mdflt_352(e, _o_51, (_n_0 - 51)) == 0) {
        return 0;
      }
      _v_2 = _o_51[0];
    } else if (_n_0 == 52) {
      Term _o_52[1];
      if (mdflt_353(e, _o_52, (_n_0 - 52)) == 0) {
        return 0;
      }
      _v_2 = _o_52[0];
    } else if (_n_0 == 53) {
      Term _o_53[1];
      if (mdflt_354(e, _o_53, (_n_0 - 53)) == 0) {
        return 0;
      }
      _v_2 = _o_53[0];
    } else if (_n_0 == 54) {
      Term _o_54[1];
      if (mdflt_355(e, _o_54, (_n_0 - 54)) == 0) {
        return 0;
      }
      _v_2 = _o_54[0];
    } else if (_n_0 == 55) {
      Term _o_55[1];
      if (mdflt_356(e, _o_55, (_n_0 - 55)) == 0) {
        return 0;
      }
      _v_2 = _o_55[0];
    } else if (_n_0 == 56) {
      Term _o_56[1];
      if (mdflt_357(e, _o_56, (_n_0 - 56)) == 0) {
        return 0;
      }
      _v_2 = _o_56[0];
    } else if (_n_0 == 57) {
      Term _o_57[1];
      if (mdflt_358(e, _o_57, (_n_0 - 57)) == 0) {
        return 0;
      }
      _v_2 = _o_57[0];
    } else if (_n_0 == 58) {
      Term _o_58[1];
      if (mdflt_359(e, _o_58, (_n_0 - 58)) == 0) {
        return 0;
      }
      _v_2 = _o_58[0];
    } else if (_n_0 == 59) {
      Term _o_59[1];
      if (mdflt_360(e, _o_59, (_n_0 - 59)) == 0) {
        return 0;
      }
      _v_2 = _o_59[0];
    } else if (_n_0 == 60) {
      Term _o_60[1];
      if (mdflt_361(e, _o_60, (_n_0 - 60)) == 0) {
        return 0;
      }
      _v_2 = _o_60[0];
    } else if (_n_0 == 61) {
      Term _o_61[1];
      if (mdflt_362(e, _o_61, (_n_0 - 61)) == 0) {
        return 0;
      }
      _v_2 = _o_61[0];
    } else if (_n_0 == 62) {
      Term _o_62[1];
      if (mdflt_363(e, _o_62, (_n_0 - 62)) == 0) {
        return 0;
      }
      _v_2 = _o_62[0];
    } else if (_n_0 == 63) {
      Term _o_63[1];
      if (mdflt_364(e, _o_63, (_n_0 - 63)) == 0) {
        return 0;
      }
      _v_2 = _o_63[0];
    } else if (_n_0 == 64) {
      Term _o_64[1];
      if (mdflt_365(e, _o_64, (_n_0 - 64)) == 0) {
        return 0;
      }
      _v_2 = _o_64[0];
    } else if (_n_0 == 65) {
      Term _o_65[1];
      if (mdflt_366(e, _o_65, (_n_0 - 65)) == 0) {
        return 0;
      }
      _v_2 = _o_65[0];
    } else if (_n_0 == 66) {
      Term _o_66[1];
      if (mdflt_367(e, _o_66, (_n_0 - 66)) == 0) {
        return 0;
      }
      _v_2 = _o_66[0];
    } else if (_n_0 == 67) {
      Term _o_67[1];
      if (mdflt_368(e, _o_67, (_n_0 - 67)) == 0) {
        return 0;
      }
      _v_2 = _o_67[0];
    } else if (_n_0 == 68) {
      Term _o_68[1];
      if (mdflt_369(e, _o_68, (_n_0 - 68)) == 0) {
        return 0;
      }
      _v_2 = _o_68[0];
    } else if (_n_0 == 69) {
      Term _o_69[1];
      if (mdflt_370(e, _o_69, (_n_0 - 69)) == 0) {
        return 0;
      }
      _v_2 = _o_69[0];
    } else if (_n_0 == 70) {
      Term _o_70[1];
      if (mdflt_371(e, _o_70, (_n_0 - 70)) == 0) {
        return 0;
      }
      _v_2 = _o_70[0];
    } else if (_n_0 == 71) {
      Term _o_71[1];
      if (mdflt_372(e, _o_71, (_n_0 - 71)) == 0) {
        return 0;
      }
      _v_2 = _o_71[0];
    } else if (_n_0 == 72) {
      Term _o_72[1];
      if (mdflt_373(e, _o_72, (_n_0 - 72)) == 0) {
        return 0;
      }
      _v_2 = _o_72[0];
    } else if (_n_0 == 73) {
      Term _o_73[1];
      if (mdflt_374(e, _o_73, (_n_0 - 73)) == 0) {
        return 0;
      }
      _v_2 = _o_73[0];
    } else if (_n_0 == 74) {
      Term _o_74[1];
      if (mdflt_375(e, _o_74, (_n_0 - 74)) == 0) {
        return 0;
      }
      _v_2 = _o_74[0];
    } else if (_n_0 == 75) {
      Term _o_75[1];
      if (mdflt_376(e, _o_75, (_n_0 - 75)) == 0) {
        return 0;
      }
      _v_2 = _o_75[0];
    } else if (_n_0 == 76) {
      Term _o_76[1];
      if (mdflt_377(e, _o_76, (_n_0 - 76)) == 0) {
        return 0;
      }
      _v_2 = _o_76[0];
    } else if (_n_0 == 77) {
      Term _o_77[1];
      if (mdflt_378(e, _o_77, (_n_0 - 77)) == 0) {
        return 0;
      }
      _v_2 = _o_77[0];
    } else if (_n_0 == 78) {
      Term _o_78[1];
      if (mdflt_379(e, _o_78, (_n_0 - 78)) == 0) {
        return 0;
      }
      _v_2 = _o_78[0];
    } else if (_n_0 == 79) {
      Term _o_79[1];
      if (mdflt_380(e, _o_79, (_n_0 - 79)) == 0) {
        return 0;
      }
      _v_2 = _o_79[0];
    } else if (_n_0 == 80) {
      Term _o_80[1];
      if (mdflt_381(e, _o_80, (_n_0 - 80)) == 0) {
        return 0;
      }
      _v_2 = _o_80[0];
    } else if (_n_0 == 81) {
      Term _o_81[1];
      if (mdflt_382(e, _o_81, (_n_0 - 81)) == 0) {
        return 0;
      }
      _v_2 = _o_81[0];
    } else if (_n_0 == 82) {
      Term _o_82[1];
      if (mdflt_383(e, _o_82, (_n_0 - 82)) == 0) {
        return 0;
      }
      _v_2 = _o_82[0];
    } else if (_n_0 == 83) {
      Term _o_83[1];
      if (mdflt_384(e, _o_83, (_n_0 - 83)) == 0) {
        return 0;
      }
      _v_2 = _o_83[0];
    } else if (_n_0 == 84) {
      Term _o_84[1];
      if (mdflt_385(e, _o_84, (_n_0 - 84)) == 0) {
        return 0;
      }
      _v_2 = _o_84[0];
    } else if (_n_0 == 85) {
      Term _o_85[1];
      if (mdflt_386(e, _o_85, (_n_0 - 85)) == 0) {
        return 0;
      }
      _v_2 = _o_85[0];
    } else if (_n_0 == 86) {
      Term _o_86[1];
      if (mdflt_387(e, _o_86, (_n_0 - 86)) == 0) {
        return 0;
      }
      _v_2 = _o_86[0];
    } else if (_n_0 == 87) {
      Term _o_87[1];
      if (mdflt_388(e, _o_87, (_n_0 - 87)) == 0) {
        return 0;
      }
      _v_2 = _o_87[0];
    } else if (_n_0 == 88) {
      Term _o_88[1];
      if (mdflt_389(e, _o_88, (_n_0 - 88)) == 0) {
        return 0;
      }
      _v_2 = _o_88[0];
    } else if (_n_0 == 89) {
      Term _o_89[1];
      if (mdflt_390(e, _o_89, (_n_0 - 89)) == 0) {
        return 0;
      }
      _v_2 = _o_89[0];
    } else if (_n_0 == 90) {
      Term _o_90[1];
      if (mdflt_391(e, _o_90, (_n_0 - 90)) == 0) {
        return 0;
      }
      _v_2 = _o_90[0];
    } else if (_n_0 == 91) {
      Term _o_91[1];
      if (mdflt_392(e, _o_91, (_n_0 - 91)) == 0) {
        return 0;
      }
      _v_2 = _o_91[0];
    } else if (_n_0 == 92) {
      Term _o_92[1];
      if (mdflt_393(e, _o_92, (_n_0 - 92)) == 0) {
        return 0;
      }
      _v_2 = _o_92[0];
    } else if (_n_0 == 93) {
      Term _o_93[1];
      if (mdflt_394(e, _o_93, (_n_0 - 93)) == 0) {
        return 0;
      }
      _v_2 = _o_93[0];
    } else if (_n_0 == 94) {
      Term _o_94[1];
      if (mdflt_395(e, _o_94, (_n_0 - 94)) == 0) {
        return 0;
      }
      _v_2 = _o_94[0];
    } else if (_n_0 == 95) {
      Term _o_95[1];
      if (mdflt_396(e, _o_95, (_n_0 - 95)) == 0) {
        return 0;
      }
      _v_2 = _o_95[0];
    } else if (_n_0 == 96) {
      Term _o_96[1];
      if (mdflt_397(e, _o_96, (_n_0 - 96)) == 0) {
        return 0;
      }
      _v_2 = _o_96[0];
    } else if (_n_0 == 97) {
      Term _o_97[1];
      if (mdflt_398(e, _o_97, (_n_0 - 97)) == 0) {
        return 0;
      }
      _v_2 = _o_97[0];
    } else if (_n_0 == 98) {
      Term _o_98[1];
      if (mdflt_399(e, _o_98, (_n_0 - 98)) == 0) {
        return 0;
      }
      _v_2 = _o_98[0];
    } else if (_n_0 == 99) {
      Term _o_99[1];
      if (mdflt_400(e, _o_99, (_n_0 - 99)) == 0) {
        return 0;
      }
      _v_2 = _o_99[0];
    } else if (_n_0 == 100) {
      Term _o_100[1];
      if (mdflt_401(e, _o_100, (_n_0 - 100)) == 0) {
        return 0;
      }
      _v_2 = _o_100[0];
    } else if (_n_0 == 101) {
      Term _o_101[1];
      if (mdflt_402(e, _o_101, (_n_0 - 101)) == 0) {
        return 0;
      }
      _v_2 = _o_101[0];
    } else if (_n_0 == 102) {
      Term _o_102[1];
      if (mdflt_403(e, _o_102, (_n_0 - 102)) == 0) {
        return 0;
      }
      _v_2 = _o_102[0];
    } else if (_n_0 == 103) {
      Term _o_103[1];
      if (mdflt_404(e, _o_103, (_n_0 - 103)) == 0) {
        return 0;
      }
      _v_2 = _o_103[0];
    } else if (_n_0 == 104) {
      Term _o_104[1];
      if (mdflt_405(e, _o_104, (_n_0 - 104)) == 0) {
        return 0;
      }
      _v_2 = _o_104[0];
    } else if (_n_0 == 105) {
      Term _o_105[1];
      if (mdflt_406(e, _o_105, (_n_0 - 105)) == 0) {
        return 0;
      }
      _v_2 = _o_105[0];
    } else if (_n_0 == 106) {
      Term _o_106[1];
      if (mdflt_407(e, _o_106, (_n_0 - 106)) == 0) {
        return 0;
      }
      _v_2 = _o_106[0];
    } else if (_n_0 == 107) {
      Term _o_107[1];
      if (mdflt_408(e, _o_107, (_n_0 - 107)) == 0) {
        return 0;
      }
      _v_2 = _o_107[0];
    } else if (_n_0 == 108) {
      Term _o_108[1];
      if (mdflt_409(e, _o_108, (_n_0 - 108)) == 0) {
        return 0;
      }
      _v_2 = _o_108[0];
    } else if (_n_0 == 109) {
      Term _o_109[1];
      if (mdflt_410(e, _o_109, (_n_0 - 109)) == 0) {
        return 0;
      }
      _v_2 = _o_109[0];
    } else if (_n_0 == 110) {
      Term _o_110[1];
      if (mdflt_411(e, _o_110, (_n_0 - 110)) == 0) {
        return 0;
      }
      _v_2 = _o_110[0];
    } else if (_n_0 == 111) {
      Term _o_111[1];
      if (mdflt_412(e, _o_111, (_n_0 - 111)) == 0) {
        return 0;
      }
      _v_2 = _o_111[0];
    } else if (_n_0 == 112) {
      Term _o_112[1];
      if (mdflt_413(e, _o_112, (_n_0 - 112)) == 0) {
        return 0;
      }
      _v_2 = _o_112[0];
    } else if (_n_0 == 113) {
      Term _o_113[1];
      if (mdflt_414(e, _o_113, (_n_0 - 113)) == 0) {
        return 0;
      }
      _v_2 = _o_113[0];
    } else if (_n_0 == 114) {
      Term _o_114[1];
      if (mdflt_415(e, _o_114, (_n_0 - 114)) == 0) {
        return 0;
      }
      _v_2 = _o_114[0];
    } else if (_n_0 == 115) {
      Term _o_115[1];
      if (mdflt_416(e, _o_115, (_n_0 - 115)) == 0) {
        return 0;
      }
      _v_2 = _o_115[0];
    } else if (_n_0 == 116) {
      Term _o_116[1];
      if (mdflt_417(e, _o_116, (_n_0 - 116)) == 0) {
        return 0;
      }
      _v_2 = _o_116[0];
    } else if (_n_0 == 117) {
      Term _o_117[1];
      if (mdflt_418(e, _o_117, (_n_0 - 117)) == 0) {
        return 0;
      }
      _v_2 = _o_117[0];
    } else if (_n_0 == 118) {
      Term _o_118[1];
      if (mdflt_419(e, _o_118, (_n_0 - 118)) == 0) {
        return 0;
      }
      _v_2 = _o_118[0];
    } else if (_n_0 == 119) {
      Term _o_119[1];
      if (mdflt_420(e, _o_119, (_n_0 - 119)) == 0) {
        return 0;
      }
      _v_2 = _o_119[0];
    } else if (_n_0 == 120) {
      Term _o_120[1];
      if (mdflt_421(e, _o_120, (_n_0 - 120)) == 0) {
        return 0;
      }
      _v_2 = _o_120[0];
    } else if (_n_0 == 121) {
      Term _o_121[1];
      if (mdflt_422(e, _o_121, (_n_0 - 121)) == 0) {
        return 0;
      }
      _v_2 = _o_121[0];
    } else if (_n_0 == 122) {
      Term _o_122[1];
      if (mdflt_423(e, _o_122, (_n_0 - 122)) == 0) {
        return 0;
      }
      _v_2 = _o_122[0];
    } else if (_n_0 == 123) {
      Term _o_123[1];
      if (mdflt_424(e, _o_123, (_n_0 - 123)) == 0) {
        return 0;
      }
      _v_2 = _o_123[0];
    } else if (_n_0 == 124) {
      Term _o_124[1];
      if (mdflt_425(e, _o_124, (_n_0 - 124)) == 0) {
        return 0;
      }
      _v_2 = _o_124[0];
    } else if (_n_0 == 125) {
      Term _o_125[1];
      if (mdflt_426(e, _o_125, (_n_0 - 125)) == 0) {
        return 0;
      }
      _v_2 = _o_125[0];
    } else if (_n_0 == 126) {
      Term _o_126[1];
      if (mdflt_427(e, _o_126, (_n_0 - 126)) == 0) {
        return 0;
      }
      _v_2 = _o_126[0];
    } else if (_n_0 == 127) {
      Term _o_127[1];
      if (mdflt_428(e, _o_127, (_n_0 - 127)) == 0) {
        return 0;
      }
      _v_2 = _o_127[0];
    } else if (_n_0 == 128) {
      Term _o_128[1];
      if (mdflt_429(e, _o_128, (_n_0 - 128)) == 0) {
        return 0;
      }
      _v_2 = _o_128[0];
    } else if (_n_0 == 129) {
      Term _o_129[1];
      if (mdflt_430(e, _o_129, (_n_0 - 129)) == 0) {
        return 0;
      }
      _v_2 = _o_129[0];
    } else if (_n_0 == 130) {
      Term _o_130[1];
      if (mdflt_431(e, _o_130, (_n_0 - 130)) == 0) {
        return 0;
      }
      _v_2 = _o_130[0];
    } else if (_n_0 == 131) {
      Term _o_131[1];
      if (mdflt_432(e, _o_131, (_n_0 - 131)) == 0) {
        return 0;
      }
      _v_2 = _o_131[0];
    } else if (_n_0 == 132) {
      Term _o_132[1];
      if (mdflt_433(e, _o_132, (_n_0 - 132)) == 0) {
        return 0;
      }
      _v_2 = _o_132[0];
    } else if (_n_0 == 133) {
      Term _o_133[1];
      if (mdflt_434(e, _o_133, (_n_0 - 133)) == 0) {
        return 0;
      }
      _v_2 = _o_133[0];
    } else if (_n_0 == 134) {
      Term _o_134[1];
      if (mdflt_435(e, _o_134, (_n_0 - 134)) == 0) {
        return 0;
      }
      _v_2 = _o_134[0];
    } else if (_n_0 == 135) {
      Term _o_135[1];
      if (mdflt_436(e, _o_135, (_n_0 - 135)) == 0) {
        return 0;
      }
      _v_2 = _o_135[0];
    } else if (_n_0 == 136) {
      Term _o_136[1];
      if (mdflt_437(e, _o_136, (_n_0 - 136)) == 0) {
        return 0;
      }
      _v_2 = _o_136[0];
    } else if (_n_0 == 137) {
      Term _o_137[1];
      if (mdflt_438(e, _o_137, (_n_0 - 137)) == 0) {
        return 0;
      }
      _v_2 = _o_137[0];
    } else if (_n_0 == 138) {
      Term _o_138[1];
      if (mdflt_439(e, _o_138, (_n_0 - 138)) == 0) {
        return 0;
      }
      _v_2 = _o_138[0];
    } else if (_n_0 == 139) {
      Term _o_139[1];
      if (mdflt_440(e, _o_139, (_n_0 - 139)) == 0) {
        return 0;
      }
      _v_2 = _o_139[0];
    } else if (_n_0 == 140) {
      Term _o_140[1];
      if (mdflt_441(e, _o_140, (_n_0 - 140)) == 0) {
        return 0;
      }
      _v_2 = _o_140[0];
    } else if (_n_0 == 141) {
      Term _o_141[1];
      if (mdflt_442(e, _o_141, (_n_0 - 141)) == 0) {
        return 0;
      }
      _v_2 = _o_141[0];
    } else if (_n_0 == 142) {
      Term _o_142[1];
      if (mdflt_443(e, _o_142, (_n_0 - 142)) == 0) {
        return 0;
      }
      _v_2 = _o_142[0];
    } else if (_n_0 == 143) {
      Term _o_143[1];
      if (mdflt_444(e, _o_143, (_n_0 - 143)) == 0) {
        return 0;
      }
      _v_2 = _o_143[0];
    } else if (_n_0 == 144) {
      Term _o_144[1];
      if (mdflt_445(e, _o_144, (_n_0 - 144)) == 0) {
        return 0;
      }
      _v_2 = _o_144[0];
    } else if (_n_0 == 145) {
      Term _o_145[1];
      if (mdflt_446(e, _o_145, (_n_0 - 145)) == 0) {
        return 0;
      }
      _v_2 = _o_145[0];
    } else if (_n_0 == 146) {
      Term _o_146[1];
      if (mdflt_447(e, _o_146, (_n_0 - 146)) == 0) {
        return 0;
      }
      _v_2 = _o_146[0];
    } else if (_n_0 == 147) {
      Term _o_147[1];
      if (mdflt_448(e, _o_147, (_n_0 - 147)) == 0) {
        return 0;
      }
      _v_2 = _o_147[0];
    } else if (_n_0 == 148) {
      Term _o_148[1];
      if (mdflt_449(e, _o_148, (_n_0 - 148)) == 0) {
        return 0;
      }
      _v_2 = _o_148[0];
    } else if (_n_0 == 149) {
      Term _o_149[1];
      if (mdflt_450(e, _o_149, (_n_0 - 149)) == 0) {
        return 0;
      }
      _v_2 = _o_149[0];
    } else if (_n_0 == 150) {
      Term _o_150[1];
      if (mdflt_451(e, _o_150, (_n_0 - 150)) == 0) {
        return 0;
      }
      _v_2 = _o_150[0];
    } else if (_n_0 == 151) {
      Term _o_151[1];
      if (mdflt_452(e, _o_151, (_n_0 - 151)) == 0) {
        return 0;
      }
      _v_2 = _o_151[0];
    } else if (_n_0 == 152) {
      Term _o_152[1];
      if (mdflt_453(e, _o_152, (_n_0 - 152)) == 0) {
        return 0;
      }
      _v_2 = _o_152[0];
    } else if (_n_0 == 153) {
      Term _o_153[1];
      if (mdflt_454(e, _o_153, (_n_0 - 153)) == 0) {
        return 0;
      }
      _v_2 = _o_153[0];
    } else if (_n_0 == 154) {
      Term _o_154[1];
      if (mdflt_455(e, _o_154, (_n_0 - 154)) == 0) {
        return 0;
      }
      _v_2 = _o_154[0];
    } else if (_n_0 == 155) {
      Term _o_155[1];
      if (mdflt_456(e, _o_155, (_n_0 - 155)) == 0) {
        return 0;
      }
      _v_2 = _o_155[0];
    } else if (_n_0 == 156) {
      Term _o_156[1];
      if (mdflt_457(e, _o_156, (_n_0 - 156)) == 0) {
        return 0;
      }
      _v_2 = _o_156[0];
    } else if (_n_0 == 157) {
      Term _o_157[1];
      if (mdflt_458(e, _o_157, (_n_0 - 157)) == 0) {
        return 0;
      }
      _v_2 = _o_157[0];
    } else if (_n_0 == 158) {
      Term _o_158[1];
      if (mdflt_459(e, _o_158, (_n_0 - 158)) == 0) {
        return 0;
      }
      _v_2 = _o_158[0];
    } else if (_n_0 == 159) {
      Term _o_159[1];
      if (mdflt_460(e, _o_159, (_n_0 - 159)) == 0) {
        return 0;
      }
      _v_2 = _o_159[0];
    } else if (_n_0 == 160) {
      Term _o_160[1];
      if (mdflt_461(e, _o_160, (_n_0 - 160)) == 0) {
        return 0;
      }
      _v_2 = _o_160[0];
    } else if (_n_0 == 161) {
      Term _o_161[1];
      if (mdflt_462(e, _o_161, (_n_0 - 161)) == 0) {
        return 0;
      }
      _v_2 = _o_161[0];
    } else if (_n_0 == 162) {
      Term _o_162[1];
      if (mdflt_463(e, _o_162, (_n_0 - 162)) == 0) {
        return 0;
      }
      _v_2 = _o_162[0];
    } else if (_n_0 == 163) {
      Term _o_163[1];
      if (mdflt_464(e, _o_163, (_n_0 - 163)) == 0) {
        return 0;
      }
      _v_2 = _o_163[0];
    } else if (_n_0 == 164) {
      Term _o_164[1];
      if (mdflt_465(e, _o_164, (_n_0 - 164)) == 0) {
        return 0;
      }
      _v_2 = _o_164[0];
    } else if (_n_0 == 165) {
      Term _o_165[1];
      if (mdflt_466(e, _o_165, (_n_0 - 165)) == 0) {
        return 0;
      }
      _v_2 = _o_165[0];
    } else if (_n_0 == 166) {
      Term _o_166[1];
      if (mdflt_467(e, _o_166, (_n_0 - 166)) == 0) {
        return 0;
      }
      _v_2 = _o_166[0];
    } else if (_n_0 == 167) {
      Term _o_167[1];
      if (mdflt_468(e, _o_167, (_n_0 - 167)) == 0) {
        return 0;
      }
      _v_2 = _o_167[0];
    } else if (_n_0 == 168) {
      Term _o_168[1];
      if (mdflt_469(e, _o_168, (_n_0 - 168)) == 0) {
        return 0;
      }
      _v_2 = _o_168[0];
    } else if (_n_0 == 169) {
      Term _o_169[1];
      if (mdflt_470(e, _o_169, (_n_0 - 169)) == 0) {
        return 0;
      }
      _v_2 = _o_169[0];
    } else if (_n_0 == 170) {
      Term _o_170[1];
      if (mdflt_471(e, _o_170, (_n_0 - 170)) == 0) {
        return 0;
      }
      _v_2 = _o_170[0];
    } else if (_n_0 == 171) {
      Term _o_171[1];
      if (mdflt_472(e, _o_171, (_n_0 - 171)) == 0) {
        return 0;
      }
      _v_2 = _o_171[0];
    } else if (_n_0 == 172) {
      Term _o_172[1];
      if (mdflt_473(e, _o_172, (_n_0 - 172)) == 0) {
        return 0;
      }
      _v_2 = _o_172[0];
    } else if (_n_0 == 173) {
      Term _o_173[1];
      if (mdflt_474(e, _o_173, (_n_0 - 173)) == 0) {
        return 0;
      }
      _v_2 = _o_173[0];
    } else if (_n_0 == 174) {
      Term _o_174[1];
      if (mdflt_475(e, _o_174, (_n_0 - 174)) == 0) {
        return 0;
      }
      _v_2 = _o_174[0];
    } else if (_n_0 == 175) {
      Term _o_175[1];
      if (mdflt_476(e, _o_175, (_n_0 - 175)) == 0) {
        return 0;
      }
      _v_2 = _o_175[0];
    } else if (_n_0 == 176) {
      Term _o_176[1];
      if (mdflt_477(e, _o_176, (_n_0 - 176)) == 0) {
        return 0;
      }
      _v_2 = _o_176[0];
    } else if (_n_0 == 177) {
      Term _o_177[1];
      if (mdflt_478(e, _o_177, (_n_0 - 177)) == 0) {
        return 0;
      }
      _v_2 = _o_177[0];
    } else if (_n_0 == 178) {
      Term _o_178[1];
      if (mdflt_479(e, _o_178, (_n_0 - 178)) == 0) {
        return 0;
      }
      _v_2 = _o_178[0];
    } else if (_n_0 == 179) {
      Term _o_179[1];
      if (mdflt_480(e, _o_179, (_n_0 - 179)) == 0) {
        return 0;
      }
      _v_2 = _o_179[0];
    } else if (_n_0 == 180) {
      Term _o_180[1];
      if (mdflt_481(e, _o_180, (_n_0 - 180)) == 0) {
        return 0;
      }
      _v_2 = _o_180[0];
    } else if (_n_0 == 181) {
      Term _o_181[1];
      if (mdflt_482(e, _o_181, (_n_0 - 181)) == 0) {
        return 0;
      }
      _v_2 = _o_181[0];
    } else if (_n_0 == 182) {
      Term _o_182[1];
      if (mdflt_483(e, _o_182, (_n_0 - 182)) == 0) {
        return 0;
      }
      _v_2 = _o_182[0];
    } else if (_n_0 == 183) {
      Term _o_183[1];
      if (mdflt_484(e, _o_183, (_n_0 - 183)) == 0) {
        return 0;
      }
      _v_2 = _o_183[0];
    } else if (_n_0 == 184) {
      Term _o_184[1];
      if (mdflt_485(e, _o_184, (_n_0 - 184)) == 0) {
        return 0;
      }
      _v_2 = _o_184[0];
    } else if (_n_0 == 185) {
      Term _o_185[1];
      if (mdflt_486(e, _o_185, (_n_0 - 185)) == 0) {
        return 0;
      }
      _v_2 = _o_185[0];
    } else if (_n_0 == 186) {
      Term _o_186[1];
      if (mdflt_487(e, _o_186, (_n_0 - 186)) == 0) {
        return 0;
      }
      _v_2 = _o_186[0];
    } else if (_n_0 == 187) {
      Term _o_187[1];
      if (mdflt_488(e, _o_187, (_n_0 - 187)) == 0) {
        return 0;
      }
      _v_2 = _o_187[0];
    } else if (_n_0 == 188) {
      Term _o_188[1];
      if (mdflt_489(e, _o_188, (_n_0 - 188)) == 0) {
        return 0;
      }
      _v_2 = _o_188[0];
    } else if (_n_0 == 189) {
      Term _o_189[1];
      if (mdflt_490(e, _o_189, (_n_0 - 189)) == 0) {
        return 0;
      }
      _v_2 = _o_189[0];
    } else if (_n_0 == 190) {
      Term _o_190[1];
      if (mdflt_491(e, _o_190, (_n_0 - 190)) == 0) {
        return 0;
      }
      _v_2 = _o_190[0];
    } else if (_n_0 == 191) {
      Term _o_191[1];
      if (mdflt_492(e, _o_191, (_n_0 - 191)) == 0) {
        return 0;
      }
      _v_2 = _o_191[0];
    } else if (_n_0 == 192) {
      Term _o_192[1];
      if (mdflt_493(e, _o_192, (_n_0 - 192)) == 0) {
        return 0;
      }
      _v_2 = _o_192[0];
    } else if (_n_0 == 193) {
      Term _o_193[1];
      if (mdflt_494(e, _o_193, (_n_0 - 193)) == 0) {
        return 0;
      }
      _v_2 = _o_193[0];
    } else if (_n_0 == 194) {
      Term _o_194[1];
      if (mdflt_495(e, _o_194, (_n_0 - 194)) == 0) {
        return 0;
      }
      _v_2 = _o_194[0];
    } else if (_n_0 == 195) {
      Term _o_195[1];
      if (mdflt_496(e, _o_195, (_n_0 - 195)) == 0) {
        return 0;
      }
      _v_2 = _o_195[0];
    } else if (_n_0 == 196) {
      Term _o_196[1];
      if (mdflt_497(e, _o_196, (_n_0 - 196)) == 0) {
        return 0;
      }
      _v_2 = _o_196[0];
    } else if (_n_0 == 197) {
      Term _o_197[1];
      if (mdflt_498(e, _o_197, (_n_0 - 197)) == 0) {
        return 0;
      }
      _v_2 = _o_197[0];
    } else if (_n_0 == 198) {
      Term _o_198[1];
      if (mdflt_499(e, _o_198, (_n_0 - 198)) == 0) {
        return 0;
      }
      _v_2 = _o_198[0];
    } else if (_n_0 == 199) {
      Term _o_199[1];
      if (mdflt_500(e, _o_199, (_n_0 - 199)) == 0) {
        return 0;
      }
      _v_2 = _o_199[0];
    } else if (_n_0 == 200) {
      Term _o_200[1];
      if (mdflt_501(e, _o_200, (_n_0 - 200)) == 0) {
        return 0;
      }
      _v_2 = _o_200[0];
    } else if (_n_0 == 201) {
      Term _o_201[1];
      if (mdflt_502(e, _o_201, (_n_0 - 201)) == 0) {
        return 0;
      }
      _v_2 = _o_201[0];
    } else if (_n_0 == 202) {
      Term _o_202[1];
      if (mdflt_503(e, _o_202, (_n_0 - 202)) == 0) {
        return 0;
      }
      _v_2 = _o_202[0];
    } else if (_n_0 == 203) {
      Term _o_203[1];
      if (mdflt_504(e, _o_203, (_n_0 - 203)) == 0) {
        return 0;
      }
      _v_2 = _o_203[0];
    } else if (_n_0 == 204) {
      Term _o_204[1];
      if (mdflt_505(e, _o_204, (_n_0 - 204)) == 0) {
        return 0;
      }
      _v_2 = _o_204[0];
    } else if (_n_0 == 205) {
      Term _o_205[1];
      if (mdflt_506(e, _o_205, (_n_0 - 205)) == 0) {
        return 0;
      }
      _v_2 = _o_205[0];
    } else if (_n_0 == 206) {
      Term _o_206[1];
      if (mdflt_507(e, _o_206, (_n_0 - 206)) == 0) {
        return 0;
      }
      _v_2 = _o_206[0];
    } else if (_n_0 == 207) {
      Term _o_207[1];
      if (mdflt_508(e, _o_207, (_n_0 - 207)) == 0) {
        return 0;
      }
      _v_2 = _o_207[0];
    } else if (_n_0 == 208) {
      Term _o_208[1];
      if (mdflt_509(e, _o_208, (_n_0 - 208)) == 0) {
        return 0;
      }
      _v_2 = _o_208[0];
    } else if (_n_0 == 209) {
      Term _o_209[1];
      if (mdflt_510(e, _o_209, (_n_0 - 209)) == 0) {
        return 0;
      }
      _v_2 = _o_209[0];
    } else if (_n_0 == 210) {
      Term _o_210[1];
      if (mdflt_511(e, _o_210, (_n_0 - 210)) == 0) {
        return 0;
      }
      _v_2 = _o_210[0];
    } else if (_n_0 == 211) {
      Term _o_211[1];
      if (mdflt_512(e, _o_211, (_n_0 - 211)) == 0) {
        return 0;
      }
      _v_2 = _o_211[0];
    } else if (_n_0 == 212) {
      Term _o_212[1];
      if (mdflt_513(e, _o_212, (_n_0 - 212)) == 0) {
        return 0;
      }
      _v_2 = _o_212[0];
    } else if (_n_0 == 213) {
      Term _o_213[1];
      if (mdflt_514(e, _o_213, (_n_0 - 213)) == 0) {
        return 0;
      }
      _v_2 = _o_213[0];
    } else if (_n_0 == 214) {
      Term _o_214[1];
      if (mdflt_515(e, _o_214, (_n_0 - 214)) == 0) {
        return 0;
      }
      _v_2 = _o_214[0];
    } else if (_n_0 == 215) {
      Term _o_215[1];
      if (mdflt_516(e, _o_215, (_n_0 - 215)) == 0) {
        return 0;
      }
      _v_2 = _o_215[0];
    } else if (_n_0 == 216) {
      Term _o_216[1];
      if (mdflt_517(e, _o_216, (_n_0 - 216)) == 0) {
        return 0;
      }
      _v_2 = _o_216[0];
    } else if (_n_0 == 217) {
      Term _o_217[1];
      if (mdflt_518(e, _o_217, (_n_0 - 217)) == 0) {
        return 0;
      }
      _v_2 = _o_217[0];
    } else if (_n_0 == 218) {
      Term _o_218[1];
      if (mdflt_519(e, _o_218, (_n_0 - 218)) == 0) {
        return 0;
      }
      _v_2 = _o_218[0];
    } else if (_n_0 == 219) {
      Term _o_219[1];
      if (mdflt_520(e, _o_219, (_n_0 - 219)) == 0) {
        return 0;
      }
      _v_2 = _o_219[0];
    } else if (_n_0 == 220) {
      Term _o_220[1];
      if (mdflt_521(e, _o_220, (_n_0 - 220)) == 0) {
        return 0;
      }
      _v_2 = _o_220[0];
    } else if (_n_0 == 221) {
      Term _o_221[1];
      if (mdflt_522(e, _o_221, (_n_0 - 221)) == 0) {
        return 0;
      }
      _v_2 = _o_221[0];
    } else if (_n_0 == 222) {
      Term _o_222[1];
      if (mdflt_523(e, _o_222, (_n_0 - 222)) == 0) {
        return 0;
      }
      _v_2 = _o_222[0];
    } else if (_n_0 == 223) {
      Term _o_223[1];
      if (mdflt_524(e, _o_223, (_n_0 - 223)) == 0) {
        return 0;
      }
      _v_2 = _o_223[0];
    } else if (_n_0 == 224) {
      Term _o_224[1];
      if (mdflt_525(e, _o_224, (_n_0 - 224)) == 0) {
        return 0;
      }
      _v_2 = _o_224[0];
    } else if (_n_0 == 225) {
      Term _o_225[1];
      if (mdflt_526(e, _o_225, (_n_0 - 225)) == 0) {
        return 0;
      }
      _v_2 = _o_225[0];
    } else if (_n_0 == 226) {
      Term _o_226[1];
      if (mdflt_527(e, _o_226, (_n_0 - 226)) == 0) {
        return 0;
      }
      _v_2 = _o_226[0];
    } else if (_n_0 == 227) {
      Term _o_227[1];
      if (mdflt_528(e, _o_227, (_n_0 - 227)) == 0) {
        return 0;
      }
      _v_2 = _o_227[0];
    } else if (_n_0 == 228) {
      Term _o_228[1];
      if (mdflt_529(e, _o_228, (_n_0 - 228)) == 0) {
        return 0;
      }
      _v_2 = _o_228[0];
    } else if (_n_0 == 229) {
      Term _o_229[1];
      if (mdflt_530(e, _o_229, (_n_0 - 229)) == 0) {
        return 0;
      }
      _v_2 = _o_229[0];
    } else if (_n_0 == 230) {
      Term _o_230[1];
      if (mdflt_531(e, _o_230, (_n_0 - 230)) == 0) {
        return 0;
      }
      _v_2 = _o_230[0];
    } else if (_n_0 == 231) {
      Term _o_231[1];
      if (mdflt_532(e, _o_231, (_n_0 - 231)) == 0) {
        return 0;
      }
      _v_2 = _o_231[0];
    } else if (_n_0 == 232) {
      Term _o_232[1];
      if (mdflt_533(e, _o_232, (_n_0 - 232)) == 0) {
        return 0;
      }
      _v_2 = _o_232[0];
    } else if (_n_0 == 233) {
      Term _o_233[1];
      if (mdflt_534(e, _o_233, (_n_0 - 233)) == 0) {
        return 0;
      }
      _v_2 = _o_233[0];
    } else if (_n_0 == 234) {
      Term _o_234[1];
      if (mdflt_535(e, _o_234, (_n_0 - 234)) == 0) {
        return 0;
      }
      _v_2 = _o_234[0];
    } else if (_n_0 == 235) {
      Term _o_235[1];
      if (mdflt_536(e, _o_235, (_n_0 - 235)) == 0) {
        return 0;
      }
      _v_2 = _o_235[0];
    } else if (_n_0 == 236) {
      Term _o_236[1];
      if (mdflt_537(e, _o_236, (_n_0 - 236)) == 0) {
        return 0;
      }
      _v_2 = _o_236[0];
    } else if (_n_0 == 237) {
      Term _o_237[1];
      if (mdflt_538(e, _o_237, (_n_0 - 237)) == 0) {
        return 0;
      }
      _v_2 = _o_237[0];
    } else if (_n_0 == 238) {
      Term _o_238[1];
      if (mdflt_539(e, _o_238, (_n_0 - 238)) == 0) {
        return 0;
      }
      _v_2 = _o_238[0];
    } else if (_n_0 == 239) {
      Term _o_239[1];
      if (mdflt_540(e, _o_239, (_n_0 - 239)) == 0) {
        return 0;
      }
      _v_2 = _o_239[0];
    } else if (_n_0 == 240) {
      Term _o_240[1];
      if (mdflt_541(e, _o_240, (_n_0 - 240)) == 0) {
        return 0;
      }
      _v_2 = _o_240[0];
    } else if (_n_0 == 241) {
      Term _o_241[1];
      if (mdflt_542(e, _o_241, (_n_0 - 241)) == 0) {
        return 0;
      }
      _v_2 = _o_241[0];
    } else if (_n_0 == 242) {
      Term _o_242[1];
      if (mdflt_543(e, _o_242, (_n_0 - 242)) == 0) {
        return 0;
      }
      _v_2 = _o_242[0];
    } else if (_n_0 == 243) {
      Term _o_243[1];
      if (mdflt_544(e, _o_243, (_n_0 - 243)) == 0) {
        return 0;
      }
      _v_2 = _o_243[0];
    } else if (_n_0 == 244) {
      Term _o_244[1];
      if (mdflt_545(e, _o_244, (_n_0 - 244)) == 0) {
        return 0;
      }
      _v_2 = _o_244[0];
    } else if (_n_0 == 245) {
      Term _o_245[1];
      if (mdflt_546(e, _o_245, (_n_0 - 245)) == 0) {
        return 0;
      }
      _v_2 = _o_245[0];
    } else if (_n_0 == 246) {
      Term _o_246[1];
      if (mdflt_547(e, _o_246, (_n_0 - 246)) == 0) {
        return 0;
      }
      _v_2 = _o_246[0];
    } else if (_n_0 == 247) {
      Term _o_247[1];
      if (mdflt_548(e, _o_247, (_n_0 - 247)) == 0) {
        return 0;
      }
      _v_2 = _o_247[0];
    } else if (_n_0 == 248) {
      Term _o_248[1];
      if (mdflt_549(e, _o_248, (_n_0 - 248)) == 0) {
        return 0;
      }
      _v_2 = _o_248[0];
    } else if (_n_0 == 249) {
      Term _o_249[1];
      if (mdflt_550(e, _o_249, (_n_0 - 249)) == 0) {
        return 0;
      }
      _v_2 = _o_249[0];
    } else if (_n_0 == 250) {
      Term _o_250[1];
      if (mdflt_551(e, _o_250, (_n_0 - 250)) == 0) {
        return 0;
      }
      _v_2 = _o_250[0];
    } else if (_n_0 == 251) {
      Term _o_251[1];
      if (mdflt_552(e, _o_251, (_n_0 - 251)) == 0) {
        return 0;
      }
      _v_2 = _o_251[0];
    } else if (_n_0 == 252) {
      Term _o_252[1];
      if (mdflt_553(e, _o_252, (_n_0 - 252)) == 0) {
        return 0;
      }
      _v_2 = _o_252[0];
    } else if (_n_0 == 253) {
      Term _o_253[1];
      if (mdflt_554(e, _o_253, (_n_0 - 253)) == 0) {
        return 0;
      }
      _v_2 = _o_253[0];
    } else if (_n_0 == 254) {
      Term _o_254[1];
      if (mdflt_555(e, _o_254, (_n_0 - 254)) == 0) {
        return 0;
      }
      _v_2 = _o_254[0];
    } else if (_n_0 == 255) {
      Term _o_255[1];
      if (mdflt_556(e, _o_255, (_n_0 - 255)) == 0) {
        return 0;
      }
      _v_2 = _o_255[0];
    } else if (_n_0 == 256) {
      Term _o_256[1];
      if (mdflt_557(e, _o_256, (_n_0 - 256)) == 0) {
        return 0;
      }
      _v_2 = _o_256[0];
    } else if (_n_0 == 257) {
      Term _o_257[1];
      if (mdflt_558(e, _o_257, (_n_0 - 257)) == 0) {
        return 0;
      }
      _v_2 = _o_257[0];
    } else if (_n_0 == 258) {
      Term _o_258[1];
      if (mdflt_559(e, _o_258, (_n_0 - 258)) == 0) {
        return 0;
      }
      _v_2 = _o_258[0];
    } else if (_n_0 == 259) {
      Term _o_259[1];
      if (mdflt_560(e, _o_259, (_n_0 - 259)) == 0) {
        return 0;
      }
      _v_2 = _o_259[0];
    } else if (_n_0 == 260) {
      Term _o_260[1];
      if (mdflt_561(e, _o_260, (_n_0 - 260)) == 0) {
        return 0;
      }
      _v_2 = _o_260[0];
    } else if (_n_0 == 261) {
      Term _o_261[1];
      if (mdflt_562(e, _o_261, (_n_0 - 261)) == 0) {
        return 0;
      }
      _v_2 = _o_261[0];
    } else if (_n_0 == 262) {
      Term _o_262[1];
      if (mdflt_563(e, _o_262, (_n_0 - 262)) == 0) {
        return 0;
      }
      _v_2 = _o_262[0];
    } else if (_n_0 == 263) {
      Term _o_263[1];
      if (mdflt_564(e, _o_263, (_n_0 - 263)) == 0) {
        return 0;
      }
      _v_2 = _o_263[0];
    } else if (_n_0 == 264) {
      Term _o_264[1];
      if (mdflt_565(e, _o_264, (_n_0 - 264)) == 0) {
        return 0;
      }
      _v_2 = _o_264[0];
    } else if (_n_0 == 265) {
      Term _o_265[1];
      if (mdflt_566(e, _o_265, (_n_0 - 265)) == 0) {
        return 0;
      }
      _v_2 = _o_265[0];
    } else if (_n_0 == 266) {
      Term _o_266[1];
      if (mdflt_567(e, _o_266, (_n_0 - 266)) == 0) {
        return 0;
      }
      _v_2 = _o_266[0];
    } else if (_n_0 == 267) {
      Term _o_267[1];
      if (mdflt_568(e, _o_267, (_n_0 - 267)) == 0) {
        return 0;
      }
      _v_2 = _o_267[0];
    } else if (_n_0 == 268) {
      Term _o_268[1];
      if (mdflt_569(e, _o_268, (_n_0 - 268)) == 0) {
        return 0;
      }
      _v_2 = _o_268[0];
    } else if (_n_0 == 269) {
      Term _o_269[1];
      if (mdflt_570(e, _o_269, (_n_0 - 269)) == 0) {
        return 0;
      }
      _v_2 = _o_269[0];
    } else if (_n_0 == 270) {
      Term _o_270[1];
      if (mdflt_571(e, _o_270, (_n_0 - 270)) == 0) {
        return 0;
      }
      _v_2 = _o_270[0];
    } else if (_n_0 == 271) {
      Term _o_271[1];
      if (mdflt_572(e, _o_271, (_n_0 - 271)) == 0) {
        return 0;
      }
      _v_2 = _o_271[0];
    } else if (_n_0 == 272) {
      Term _o_272[1];
      if (mdflt_573(e, _o_272, (_n_0 - 272)) == 0) {
        return 0;
      }
      _v_2 = _o_272[0];
    } else if (_n_0 == 273) {
      Term _o_273[1];
      if (mdflt_574(e, _o_273, (_n_0 - 273)) == 0) {
        return 0;
      }
      _v_2 = _o_273[0];
    } else if (_n_0 == 274) {
      Term _o_274[1];
      if (mdflt_575(e, _o_274, (_n_0 - 274)) == 0) {
        return 0;
      }
      _v_2 = _o_274[0];
    } else if (_n_0 == 275) {
      Term _o_275[1];
      if (mdflt_576(e, _o_275, (_n_0 - 275)) == 0) {
        return 0;
      }
      _v_2 = _o_275[0];
    } else if (_n_0 == 276) {
      Term _o_276[1];
      if (mdflt_577(e, _o_276, (_n_0 - 276)) == 0) {
        return 0;
      }
      _v_2 = _o_276[0];
    } else if (_n_0 == 277) {
      Term _o_277[1];
      if (mdflt_578(e, _o_277, (_n_0 - 277)) == 0) {
        return 0;
      }
      _v_2 = _o_277[0];
    } else if (_n_0 == 278) {
      Term _o_278[1];
      if (mdflt_579(e, _o_278, (_n_0 - 278)) == 0) {
        return 0;
      }
      _v_2 = _o_278[0];
    } else if (_n_0 == 279) {
      Term _o_279[1];
      if (mdflt_580(e, _o_279, (_n_0 - 279)) == 0) {
        return 0;
      }
      _v_2 = _o_279[0];
    } else if (_n_0 == 280) {
      Term _o_280[1];
      if (mdflt_581(e, _o_280, (_n_0 - 280)) == 0) {
        return 0;
      }
      _v_2 = _o_280[0];
    } else if (_n_0 == 281) {
      Term _o_281[1];
      if (mdflt_582(e, _o_281, (_n_0 - 281)) == 0) {
        return 0;
      }
      _v_2 = _o_281[0];
    } else if (_n_0 == 282) {
      Term _o_282[1];
      if (mdflt_583(e, _o_282, (_n_0 - 282)) == 0) {
        return 0;
      }
      _v_2 = _o_282[0];
    } else if (_n_0 == 283) {
      Term _o_283[1];
      if (mdflt_584(e, _o_283, (_n_0 - 283)) == 0) {
        return 0;
      }
      _v_2 = _o_283[0];
    } else if (_n_0 == 284) {
      Term _o_284[1];
      if (mdflt_585(e, _o_284, (_n_0 - 284)) == 0) {
        return 0;
      }
      _v_2 = _o_284[0];
    } else if (_n_0 == 285) {
      Term _o_285[1];
      if (mdflt_586(e, _o_285, (_n_0 - 285)) == 0) {
        return 0;
      }
      _v_2 = _o_285[0];
    } else if (_n_0 == 286) {
      Term _o_286[1];
      if (mdflt_587(e, _o_286, (_n_0 - 286)) == 0) {
        return 0;
      }
      _v_2 = _o_286[0];
    } else if (_n_0 == 287) {
      Term _o_287[1];
      if (mdflt_588(e, _o_287, (_n_0 - 287)) == 0) {
        return 0;
      }
      _v_2 = _o_287[0];
    } else if (_n_0 == 288) {
      Term _o_288[1];
      if (mdflt_589(e, _o_288, (_n_0 - 288)) == 0) {
        return 0;
      }
      _v_2 = _o_288[0];
    } else if (_n_0 == 289) {
      Term _o_289[1];
      if (mdflt_590(e, _o_289, (_n_0 - 289)) == 0) {
        return 0;
      }
      _v_2 = _o_289[0];
    } else if (_n_0 == 290) {
      Term _o_290[1];
      if (mdflt_591(e, _o_290, (_n_0 - 290)) == 0) {
        return 0;
      }
      _v_2 = _o_290[0];
    } else if (_n_0 == 291) {
      Term _o_291[1];
      if (mdflt_592(e, _o_291, (_n_0 - 291)) == 0) {
        return 0;
      }
      _v_2 = _o_291[0];
    } else if (_n_0 == 292) {
      Term _o_292[1];
      if (mdflt_593(e, _o_292, (_n_0 - 292)) == 0) {
        return 0;
      }
      _v_2 = _o_292[0];
    } else if (_n_0 == 293) {
      Term _o_293[1];
      if (mdflt_594(e, _o_293, (_n_0 - 293)) == 0) {
        return 0;
      }
      _v_2 = _o_293[0];
    } else if (_n_0 == 294) {
      Term _o_294[1];
      if (mdflt_595(e, _o_294, (_n_0 - 294)) == 0) {
        return 0;
      }
      _v_2 = _o_294[0];
    } else if (_n_0 == 295) {
      Term _o_295[1];
      if (mdflt_596(e, _o_295, (_n_0 - 295)) == 0) {
        return 0;
      }
      _v_2 = _o_295[0];
    } else if (_n_0 == 296) {
      Term _o_296[1];
      if (mdflt_597(e, _o_296, (_n_0 - 296)) == 0) {
        return 0;
      }
      _v_2 = _o_296[0];
    } else if (_n_0 == 297) {
      Term _o_297[1];
      if (mdflt_598(e, _o_297, (_n_0 - 297)) == 0) {
        return 0;
      }
      _v_2 = _o_297[0];
    } else if (_n_0 == 298) {
      Term _o_298[1];
      if (mdflt_599(e, _o_298, (_n_0 - 298)) == 0) {
        return 0;
      }
      _v_2 = _o_298[0];
    } else if (_n_0 == 299) {
      Term _o_299[1];
      if (mdflt_600(e, _o_299, (_n_0 - 299)) == 0) {
        return 0;
      }
      _v_2 = _o_299[0];
    } else if (_n_0 == 300) {
      r0 = 299ull;
      _n_0 = r0;
      WL_AGAIN(spin_0);
    } else {
      Term _o_300[1];
      if (mdflt_601(e, _o_300, (_n_0 - 300)) == 0) {
        return 0;
      }
      _v_2 = _o_300[0];
    }
  break;
  }
  o[0] = _v_2;
  return 1;
}

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
  WL_CASE(FID_MAIN)
  {
    WL_OPEN
    Term _v_0 = 0;
    Term _v_1 = 0;
    Term _o_301[1];
    if (spin_0(e, _o_301, 300ull) == 0) {
      return 0;
    }
    _v_1 = _o_301[0];
    _v_0 = _v_1;
    r0 = nat_chk(e, _v_0 + 7ull);
    WL_RETN(1);
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
