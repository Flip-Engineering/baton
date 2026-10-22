
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

static Term spin_0(Env e, THR Term* o, Term r0);

FAR Term spin_0(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_2 = 0;
  Term _n_2 = r0;
  WL_SPIN
    if (_n_2 == 0) {
      Term _n_3 = (_n_2 - 0);
      _v_2 = _n_3;
    } else if (_n_2 == 1) {
      Term _6_1 = (_n_2 - 1);
      _v_2 = nat_chk(e, _6_1 + 1);
    } else if (_n_2 == 2) {
      Term _7_1 = (_n_2 - 2);
      _v_2 = nat_chk(e, _7_1 + 2);
    } else if (_n_2 == 3) {
      Term _8_1 = (_n_2 - 3);
      _v_2 = nat_chk(e, _8_1 + 3);
    } else if (_n_2 == 4) {
      Term _9_1 = (_n_2 - 4);
      _v_2 = nat_chk(e, _9_1 + 4);
    } else if (_n_2 == 5) {
      Term _10_1 = (_n_2 - 5);
      _v_2 = nat_chk(e, _10_1 + 5);
    } else if (_n_2 == 6) {
      Term _11_1 = (_n_2 - 6);
      _v_2 = nat_chk(e, _11_1 + 6);
    } else if (_n_2 == 7) {
      Term _12_1 = (_n_2 - 7);
      _v_2 = nat_chk(e, _12_1 + 7);
    } else if (_n_2 == 8) {
      Term _13_1 = (_n_2 - 8);
      _v_2 = nat_chk(e, _13_1 + 8);
    } else if (_n_2 == 9) {
      Term _14_1 = (_n_2 - 9);
      _v_2 = nat_chk(e, _14_1 + 9);
    } else if (_n_2 == 10) {
      Term _15_1 = (_n_2 - 10);
      _v_2 = nat_chk(e, _15_1 + 10);
    } else if (_n_2 == 11) {
      Term _16_1 = (_n_2 - 11);
      _v_2 = nat_chk(e, _16_1 + 11);
    } else if (_n_2 == 12) {
      Term _17_1 = (_n_2 - 12);
      _v_2 = nat_chk(e, _17_1 + 12);
    } else if (_n_2 == 13) {
      Term _18_1 = (_n_2 - 13);
      _v_2 = nat_chk(e, _18_1 + 13);
    } else if (_n_2 == 14) {
      Term _19_1 = (_n_2 - 14);
      _v_2 = nat_chk(e, _19_1 + 14);
    } else if (_n_2 == 15) {
      Term _20_1 = (_n_2 - 15);
      _v_2 = nat_chk(e, _20_1 + 15);
    } else if (_n_2 == 16) {
      Term _21_1 = (_n_2 - 16);
      _v_2 = nat_chk(e, _21_1 + 16);
    } else if (_n_2 == 17) {
      Term _22_1 = (_n_2 - 17);
      _v_2 = nat_chk(e, _22_1 + 17);
    } else if (_n_2 == 18) {
      Term _23_1 = (_n_2 - 18);
      _v_2 = nat_chk(e, _23_1 + 18);
    } else if (_n_2 == 19) {
      Term _24_1 = (_n_2 - 19);
      _v_2 = nat_chk(e, _24_1 + 19);
    } else if (_n_2 == 20) {
      Term _25_1 = (_n_2 - 20);
      _v_2 = nat_chk(e, _25_1 + 20);
    } else if (_n_2 == 21) {
      Term _26_1 = (_n_2 - 21);
      _v_2 = nat_chk(e, _26_1 + 21);
    } else if (_n_2 == 22) {
      Term _27_1 = (_n_2 - 22);
      _v_2 = nat_chk(e, _27_1 + 22);
    } else if (_n_2 == 23) {
      Term _28_1 = (_n_2 - 23);
      _v_2 = nat_chk(e, _28_1 + 23);
    } else if (_n_2 == 24) {
      Term _29_1 = (_n_2 - 24);
      _v_2 = nat_chk(e, _29_1 + 24);
    } else if (_n_2 == 25) {
      Term _30_1 = (_n_2 - 25);
      _v_2 = nat_chk(e, _30_1 + 25);
    } else if (_n_2 == 26) {
      Term _31_1 = (_n_2 - 26);
      _v_2 = nat_chk(e, _31_1 + 26);
    } else if (_n_2 == 27) {
      Term _32_1 = (_n_2 - 27);
      _v_2 = nat_chk(e, _32_1 + 27);
    } else if (_n_2 == 28) {
      Term _33_1 = (_n_2 - 28);
      _v_2 = nat_chk(e, _33_1 + 28);
    } else if (_n_2 == 29) {
      Term _34_1 = (_n_2 - 29);
      _v_2 = nat_chk(e, _34_1 + 29);
    } else if (_n_2 == 30) {
      Term _35_1 = (_n_2 - 30);
      _v_2 = nat_chk(e, _35_1 + 30);
    } else if (_n_2 == 31) {
      Term _36_1 = (_n_2 - 31);
      _v_2 = nat_chk(e, _36_1 + 31);
    } else if (_n_2 == 32) {
      Term _37_1 = (_n_2 - 32);
      _v_2 = nat_chk(e, _37_1 + 32);
    } else if (_n_2 == 33) {
      Term _38_1 = (_n_2 - 33);
      _v_2 = nat_chk(e, _38_1 + 33);
    } else if (_n_2 == 34) {
      Term _39_1 = (_n_2 - 34);
      _v_2 = nat_chk(e, _39_1 + 34);
    } else if (_n_2 == 35) {
      Term _40_1 = (_n_2 - 35);
      _v_2 = nat_chk(e, _40_1 + 35);
    } else if (_n_2 == 36) {
      Term _41_1 = (_n_2 - 36);
      _v_2 = nat_chk(e, _41_1 + 36);
    } else if (_n_2 == 37) {
      Term _42_1 = (_n_2 - 37);
      _v_2 = nat_chk(e, _42_1 + 37);
    } else if (_n_2 == 38) {
      Term _43_1 = (_n_2 - 38);
      _v_2 = nat_chk(e, _43_1 + 38);
    } else if (_n_2 == 39) {
      Term _44_1 = (_n_2 - 39);
      _v_2 = nat_chk(e, _44_1 + 39);
    } else if (_n_2 == 40) {
      Term _45_1 = (_n_2 - 40);
      _v_2 = nat_chk(e, _45_1 + 40);
    } else if (_n_2 == 41) {
      Term _46_1 = (_n_2 - 41);
      _v_2 = nat_chk(e, _46_1 + 41);
    } else if (_n_2 == 42) {
      Term _47_1 = (_n_2 - 42);
      _v_2 = nat_chk(e, _47_1 + 42);
    } else if (_n_2 == 43) {
      Term _48_1 = (_n_2 - 43);
      _v_2 = nat_chk(e, _48_1 + 43);
    } else if (_n_2 == 44) {
      Term _49_1 = (_n_2 - 44);
      _v_2 = nat_chk(e, _49_1 + 44);
    } else if (_n_2 == 45) {
      Term _50_1 = (_n_2 - 45);
      _v_2 = nat_chk(e, _50_1 + 45);
    } else if (_n_2 == 46) {
      Term _51_1 = (_n_2 - 46);
      _v_2 = nat_chk(e, _51_1 + 46);
    } else if (_n_2 == 47) {
      Term _52_1 = (_n_2 - 47);
      _v_2 = nat_chk(e, _52_1 + 47);
    } else if (_n_2 == 48) {
      Term _53_1 = (_n_2 - 48);
      _v_2 = nat_chk(e, _53_1 + 48);
    } else if (_n_2 == 49) {
      Term _54_1 = (_n_2 - 49);
      _v_2 = nat_chk(e, _54_1 + 49);
    } else if (_n_2 == 50) {
      Term _55_1 = (_n_2 - 50);
      _v_2 = nat_chk(e, _55_1 + 50);
    } else if (_n_2 == 51) {
      Term _56_1 = (_n_2 - 51);
      _v_2 = nat_chk(e, _56_1 + 51);
    } else if (_n_2 == 52) {
      Term _57_1 = (_n_2 - 52);
      _v_2 = nat_chk(e, _57_1 + 52);
    } else if (_n_2 == 53) {
      Term _58_1 = (_n_2 - 53);
      _v_2 = nat_chk(e, _58_1 + 53);
    } else if (_n_2 == 54) {
      Term _59_1 = (_n_2 - 54);
      _v_2 = nat_chk(e, _59_1 + 54);
    } else if (_n_2 == 55) {
      Term _60_1 = (_n_2 - 55);
      _v_2 = nat_chk(e, _60_1 + 55);
    } else if (_n_2 == 56) {
      Term _61_1 = (_n_2 - 56);
      _v_2 = nat_chk(e, _61_1 + 56);
    } else if (_n_2 == 57) {
      Term _62_1 = (_n_2 - 57);
      _v_2 = nat_chk(e, _62_1 + 57);
    } else if (_n_2 == 58) {
      Term _63_1 = (_n_2 - 58);
      _v_2 = nat_chk(e, _63_1 + 58);
    } else if (_n_2 == 59) {
      Term _64_1 = (_n_2 - 59);
      _v_2 = nat_chk(e, _64_1 + 59);
    } else if (_n_2 == 60) {
      Term _65_1 = (_n_2 - 60);
      _v_2 = nat_chk(e, _65_1 + 60);
    } else if (_n_2 == 61) {
      Term _66_1 = (_n_2 - 61);
      _v_2 = nat_chk(e, _66_1 + 61);
    } else if (_n_2 == 62) {
      Term _67_1 = (_n_2 - 62);
      _v_2 = nat_chk(e, _67_1 + 62);
    } else if (_n_2 == 63) {
      Term _68_1 = (_n_2 - 63);
      _v_2 = nat_chk(e, _68_1 + 63);
    } else if (_n_2 == 64) {
      Term _69_1 = (_n_2 - 64);
      _v_2 = nat_chk(e, _69_1 + 64);
    } else if (_n_2 == 65) {
      Term _70_1 = (_n_2 - 65);
      _v_2 = nat_chk(e, _70_1 + 65);
    } else if (_n_2 == 66) {
      Term _71_1 = (_n_2 - 66);
      _v_2 = nat_chk(e, _71_1 + 66);
    } else if (_n_2 == 67) {
      Term _72_1 = (_n_2 - 67);
      _v_2 = nat_chk(e, _72_1 + 67);
    } else if (_n_2 == 68) {
      Term _73_1 = (_n_2 - 68);
      _v_2 = nat_chk(e, _73_1 + 68);
    } else if (_n_2 == 69) {
      Term _74_1 = (_n_2 - 69);
      _v_2 = nat_chk(e, _74_1 + 69);
    } else if (_n_2 == 70) {
      Term _75_1 = (_n_2 - 70);
      _v_2 = nat_chk(e, _75_1 + 70);
    } else if (_n_2 == 71) {
      Term _76_1 = (_n_2 - 71);
      _v_2 = nat_chk(e, _76_1 + 71);
    } else if (_n_2 == 72) {
      Term _77_1 = (_n_2 - 72);
      _v_2 = nat_chk(e, _77_1 + 72);
    } else if (_n_2 == 73) {
      Term _78_1 = (_n_2 - 73);
      _v_2 = nat_chk(e, _78_1 + 73);
    } else if (_n_2 == 74) {
      Term _79_1 = (_n_2 - 74);
      _v_2 = nat_chk(e, _79_1 + 74);
    } else if (_n_2 == 75) {
      Term _80_1 = (_n_2 - 75);
      _v_2 = nat_chk(e, _80_1 + 75);
    } else if (_n_2 == 76) {
      Term _81_1 = (_n_2 - 76);
      _v_2 = nat_chk(e, _81_1 + 76);
    } else if (_n_2 == 77) {
      Term _82_1 = (_n_2 - 77);
      _v_2 = nat_chk(e, _82_1 + 77);
    } else if (_n_2 == 78) {
      Term _83_1 = (_n_2 - 78);
      _v_2 = nat_chk(e, _83_1 + 78);
    } else if (_n_2 == 79) {
      Term _84_1 = (_n_2 - 79);
      _v_2 = nat_chk(e, _84_1 + 79);
    } else if (_n_2 == 80) {
      Term _85_1 = (_n_2 - 80);
      _v_2 = nat_chk(e, _85_1 + 80);
    } else if (_n_2 == 81) {
      Term _86_1 = (_n_2 - 81);
      _v_2 = nat_chk(e, _86_1 + 81);
    } else if (_n_2 == 82) {
      Term _87_1 = (_n_2 - 82);
      _v_2 = nat_chk(e, _87_1 + 82);
    } else if (_n_2 == 83) {
      Term _88_1 = (_n_2 - 83);
      _v_2 = nat_chk(e, _88_1 + 83);
    } else if (_n_2 == 84) {
      Term _89_1 = (_n_2 - 84);
      _v_2 = nat_chk(e, _89_1 + 84);
    } else if (_n_2 == 85) {
      Term _90_1 = (_n_2 - 85);
      _v_2 = nat_chk(e, _90_1 + 85);
    } else if (_n_2 == 86) {
      Term _91_1 = (_n_2 - 86);
      _v_2 = nat_chk(e, _91_1 + 86);
    } else if (_n_2 == 87) {
      Term _92_1 = (_n_2 - 87);
      _v_2 = nat_chk(e, _92_1 + 87);
    } else if (_n_2 == 88) {
      Term _93_1 = (_n_2 - 88);
      _v_2 = nat_chk(e, _93_1 + 88);
    } else if (_n_2 == 89) {
      Term _94_1 = (_n_2 - 89);
      _v_2 = nat_chk(e, _94_1 + 89);
    } else if (_n_2 == 90) {
      Term _95_1 = (_n_2 - 90);
      _v_2 = nat_chk(e, _95_1 + 90);
    } else if (_n_2 == 91) {
      Term _96_1 = (_n_2 - 91);
      _v_2 = nat_chk(e, _96_1 + 91);
    } else if (_n_2 == 92) {
      Term _97_1 = (_n_2 - 92);
      _v_2 = nat_chk(e, _97_1 + 92);
    } else if (_n_2 == 93) {
      Term _98_1 = (_n_2 - 93);
      _v_2 = nat_chk(e, _98_1 + 93);
    } else if (_n_2 == 94) {
      Term _99_1 = (_n_2 - 94);
      _v_2 = nat_chk(e, _99_1 + 94);
    } else if (_n_2 == 95) {
      Term _100_1 = (_n_2 - 95);
      _v_2 = nat_chk(e, _100_1 + 95);
    } else if (_n_2 == 96) {
      Term _101_1 = (_n_2 - 96);
      _v_2 = nat_chk(e, _101_1 + 96);
    } else if (_n_2 == 97) {
      Term _102_1 = (_n_2 - 97);
      _v_2 = nat_chk(e, _102_1 + 97);
    } else if (_n_2 == 98) {
      Term _103_1 = (_n_2 - 98);
      _v_2 = nat_chk(e, _103_1 + 98);
    } else if (_n_2 == 99) {
      Term _104_1 = (_n_2 - 99);
      _v_2 = nat_chk(e, _104_1 + 99);
    } else if (_n_2 == 100) {
      Term _105_1 = (_n_2 - 100);
      _v_2 = nat_chk(e, _105_1 + 100);
    } else if (_n_2 == 101) {
      Term _106_1 = (_n_2 - 101);
      _v_2 = nat_chk(e, _106_1 + 101);
    } else if (_n_2 == 102) {
      Term _107_1 = (_n_2 - 102);
      _v_2 = nat_chk(e, _107_1 + 102);
    } else if (_n_2 == 103) {
      Term _108_1 = (_n_2 - 103);
      _v_2 = nat_chk(e, _108_1 + 103);
    } else if (_n_2 == 104) {
      Term _109_1 = (_n_2 - 104);
      _v_2 = nat_chk(e, _109_1 + 104);
    } else if (_n_2 == 105) {
      Term _110_1 = (_n_2 - 105);
      _v_2 = nat_chk(e, _110_1 + 105);
    } else if (_n_2 == 106) {
      Term _111_1 = (_n_2 - 106);
      _v_2 = nat_chk(e, _111_1 + 106);
    } else if (_n_2 == 107) {
      Term _112_1 = (_n_2 - 107);
      _v_2 = nat_chk(e, _112_1 + 107);
    } else if (_n_2 == 108) {
      Term _113_1 = (_n_2 - 108);
      _v_2 = nat_chk(e, _113_1 + 108);
    } else if (_n_2 == 109) {
      Term _114_1 = (_n_2 - 109);
      _v_2 = nat_chk(e, _114_1 + 109);
    } else if (_n_2 == 110) {
      Term _115_1 = (_n_2 - 110);
      _v_2 = nat_chk(e, _115_1 + 110);
    } else if (_n_2 == 111) {
      Term _116_1 = (_n_2 - 111);
      _v_2 = nat_chk(e, _116_1 + 111);
    } else if (_n_2 == 112) {
      Term _117_1 = (_n_2 - 112);
      _v_2 = nat_chk(e, _117_1 + 112);
    } else if (_n_2 == 113) {
      Term _118_1 = (_n_2 - 113);
      _v_2 = nat_chk(e, _118_1 + 113);
    } else if (_n_2 == 114) {
      Term _119_1 = (_n_2 - 114);
      _v_2 = nat_chk(e, _119_1 + 114);
    } else if (_n_2 == 115) {
      Term _120_1 = (_n_2 - 115);
      _v_2 = nat_chk(e, _120_1 + 115);
    } else if (_n_2 == 116) {
      Term _121_1 = (_n_2 - 116);
      _v_2 = nat_chk(e, _121_1 + 116);
    } else if (_n_2 == 117) {
      Term _122_1 = (_n_2 - 117);
      _v_2 = nat_chk(e, _122_1 + 117);
    } else if (_n_2 == 118) {
      Term _123_1 = (_n_2 - 118);
      _v_2 = nat_chk(e, _123_1 + 118);
    } else if (_n_2 == 119) {
      Term _124_1 = (_n_2 - 119);
      _v_2 = nat_chk(e, _124_1 + 119);
    } else if (_n_2 == 120) {
      Term _125_1 = (_n_2 - 120);
      _v_2 = nat_chk(e, _125_1 + 120);
    } else if (_n_2 == 121) {
      Term _126_1 = (_n_2 - 121);
      _v_2 = nat_chk(e, _126_1 + 121);
    } else if (_n_2 == 122) {
      Term _127_1 = (_n_2 - 122);
      _v_2 = nat_chk(e, _127_1 + 122);
    } else if (_n_2 == 123) {
      Term _128_1 = (_n_2 - 123);
      _v_2 = nat_chk(e, _128_1 + 123);
    } else if (_n_2 == 124) {
      Term _129_1 = (_n_2 - 124);
      _v_2 = nat_chk(e, _129_1 + 124);
    } else if (_n_2 == 125) {
      Term _130_1 = (_n_2 - 125);
      _v_2 = nat_chk(e, _130_1 + 125);
    } else if (_n_2 == 126) {
      Term _131_1 = (_n_2 - 126);
      _v_2 = nat_chk(e, _131_1 + 126);
    } else if (_n_2 == 127) {
      Term _132_1 = (_n_2 - 127);
      _v_2 = nat_chk(e, _132_1 + 127);
    } else if (_n_2 == 128) {
      Term _133_1 = (_n_2 - 128);
      _v_2 = nat_chk(e, _133_1 + 128);
    } else if (_n_2 == 129) {
      Term _134_1 = (_n_2 - 129);
      _v_2 = nat_chk(e, _134_1 + 129);
    } else if (_n_2 == 130) {
      Term _135_1 = (_n_2 - 130);
      _v_2 = nat_chk(e, _135_1 + 130);
    } else if (_n_2 == 131) {
      Term _136_1 = (_n_2 - 131);
      _v_2 = nat_chk(e, _136_1 + 131);
    } else if (_n_2 == 132) {
      Term _137_1 = (_n_2 - 132);
      _v_2 = nat_chk(e, _137_1 + 132);
    } else if (_n_2 == 133) {
      Term _138_1 = (_n_2 - 133);
      _v_2 = nat_chk(e, _138_1 + 133);
    } else if (_n_2 == 134) {
      Term _139_1 = (_n_2 - 134);
      _v_2 = nat_chk(e, _139_1 + 134);
    } else if (_n_2 == 135) {
      Term _140_1 = (_n_2 - 135);
      _v_2 = nat_chk(e, _140_1 + 135);
    } else if (_n_2 == 136) {
      Term _141_1 = (_n_2 - 136);
      _v_2 = nat_chk(e, _141_1 + 136);
    } else if (_n_2 == 137) {
      Term _142_1 = (_n_2 - 137);
      _v_2 = nat_chk(e, _142_1 + 137);
    } else if (_n_2 == 138) {
      Term _143_1 = (_n_2 - 138);
      _v_2 = nat_chk(e, _143_1 + 138);
    } else if (_n_2 == 139) {
      Term _144_1 = (_n_2 - 139);
      _v_2 = nat_chk(e, _144_1 + 139);
    } else if (_n_2 == 140) {
      Term _145_1 = (_n_2 - 140);
      _v_2 = nat_chk(e, _145_1 + 140);
    } else if (_n_2 == 141) {
      Term _146_1 = (_n_2 - 141);
      _v_2 = nat_chk(e, _146_1 + 141);
    } else if (_n_2 == 142) {
      Term _147_1 = (_n_2 - 142);
      _v_2 = nat_chk(e, _147_1 + 142);
    } else if (_n_2 == 143) {
      Term _148_1 = (_n_2 - 143);
      _v_2 = nat_chk(e, _148_1 + 143);
    } else if (_n_2 == 144) {
      Term _149_1 = (_n_2 - 144);
      _v_2 = nat_chk(e, _149_1 + 144);
    } else if (_n_2 == 145) {
      Term _150_1 = (_n_2 - 145);
      _v_2 = nat_chk(e, _150_1 + 145);
    } else if (_n_2 == 146) {
      Term _151_1 = (_n_2 - 146);
      _v_2 = nat_chk(e, _151_1 + 146);
    } else if (_n_2 == 147) {
      Term _152_1 = (_n_2 - 147);
      _v_2 = nat_chk(e, _152_1 + 147);
    } else if (_n_2 == 148) {
      Term _153_1 = (_n_2 - 148);
      _v_2 = nat_chk(e, _153_1 + 148);
    } else if (_n_2 == 149) {
      Term _154_1 = (_n_2 - 149);
      _v_2 = nat_chk(e, _154_1 + 149);
    } else if (_n_2 == 150) {
      Term _155_1 = (_n_2 - 150);
      _v_2 = nat_chk(e, _155_1 + 150);
    } else if (_n_2 == 151) {
      Term _156_1 = (_n_2 - 151);
      _v_2 = nat_chk(e, _156_1 + 151);
    } else if (_n_2 == 152) {
      Term _157_1 = (_n_2 - 152);
      _v_2 = nat_chk(e, _157_1 + 152);
    } else if (_n_2 == 153) {
      Term _158_1 = (_n_2 - 153);
      _v_2 = nat_chk(e, _158_1 + 153);
    } else if (_n_2 == 154) {
      Term _159_1 = (_n_2 - 154);
      _v_2 = nat_chk(e, _159_1 + 154);
    } else if (_n_2 == 155) {
      Term _160_1 = (_n_2 - 155);
      _v_2 = nat_chk(e, _160_1 + 155);
    } else if (_n_2 == 156) {
      Term _161_1 = (_n_2 - 156);
      _v_2 = nat_chk(e, _161_1 + 156);
    } else if (_n_2 == 157) {
      Term _162_1 = (_n_2 - 157);
      _v_2 = nat_chk(e, _162_1 + 157);
    } else if (_n_2 == 158) {
      Term _163_1 = (_n_2 - 158);
      _v_2 = nat_chk(e, _163_1 + 158);
    } else if (_n_2 == 159) {
      Term _164_1 = (_n_2 - 159);
      _v_2 = nat_chk(e, _164_1 + 159);
    } else if (_n_2 == 160) {
      Term _165_1 = (_n_2 - 160);
      _v_2 = nat_chk(e, _165_1 + 160);
    } else if (_n_2 == 161) {
      Term _166_1 = (_n_2 - 161);
      _v_2 = nat_chk(e, _166_1 + 161);
    } else if (_n_2 == 162) {
      Term _167_1 = (_n_2 - 162);
      _v_2 = nat_chk(e, _167_1 + 162);
    } else if (_n_2 == 163) {
      Term _168_1 = (_n_2 - 163);
      _v_2 = nat_chk(e, _168_1 + 163);
    } else if (_n_2 == 164) {
      Term _169_1 = (_n_2 - 164);
      _v_2 = nat_chk(e, _169_1 + 164);
    } else if (_n_2 == 165) {
      Term _170_1 = (_n_2 - 165);
      _v_2 = nat_chk(e, _170_1 + 165);
    } else if (_n_2 == 166) {
      Term _171_1 = (_n_2 - 166);
      _v_2 = nat_chk(e, _171_1 + 166);
    } else if (_n_2 == 167) {
      Term _172_1 = (_n_2 - 167);
      _v_2 = nat_chk(e, _172_1 + 167);
    } else if (_n_2 == 168) {
      Term _173_1 = (_n_2 - 168);
      _v_2 = nat_chk(e, _173_1 + 168);
    } else if (_n_2 == 169) {
      Term _174_1 = (_n_2 - 169);
      _v_2 = nat_chk(e, _174_1 + 169);
    } else if (_n_2 == 170) {
      Term _175_1 = (_n_2 - 170);
      _v_2 = nat_chk(e, _175_1 + 170);
    } else if (_n_2 == 171) {
      Term _176_1 = (_n_2 - 171);
      _v_2 = nat_chk(e, _176_1 + 171);
    } else if (_n_2 == 172) {
      Term _177_1 = (_n_2 - 172);
      _v_2 = nat_chk(e, _177_1 + 172);
    } else if (_n_2 == 173) {
      Term _178_1 = (_n_2 - 173);
      _v_2 = nat_chk(e, _178_1 + 173);
    } else if (_n_2 == 174) {
      Term _179_1 = (_n_2 - 174);
      _v_2 = nat_chk(e, _179_1 + 174);
    } else if (_n_2 == 175) {
      Term _180_1 = (_n_2 - 175);
      _v_2 = nat_chk(e, _180_1 + 175);
    } else if (_n_2 == 176) {
      Term _181_1 = (_n_2 - 176);
      _v_2 = nat_chk(e, _181_1 + 176);
    } else if (_n_2 == 177) {
      Term _182_1 = (_n_2 - 177);
      _v_2 = nat_chk(e, _182_1 + 177);
    } else if (_n_2 == 178) {
      Term _183_1 = (_n_2 - 178);
      _v_2 = nat_chk(e, _183_1 + 178);
    } else if (_n_2 == 179) {
      Term _184_1 = (_n_2 - 179);
      _v_2 = nat_chk(e, _184_1 + 179);
    } else if (_n_2 == 180) {
      Term _185_1 = (_n_2 - 180);
      _v_2 = nat_chk(e, _185_1 + 180);
    } else if (_n_2 == 181) {
      Term _186_1 = (_n_2 - 181);
      _v_2 = nat_chk(e, _186_1 + 181);
    } else if (_n_2 == 182) {
      Term _187_1 = (_n_2 - 182);
      _v_2 = nat_chk(e, _187_1 + 182);
    } else if (_n_2 == 183) {
      Term _188_1 = (_n_2 - 183);
      _v_2 = nat_chk(e, _188_1 + 183);
    } else if (_n_2 == 184) {
      Term _189_1 = (_n_2 - 184);
      _v_2 = nat_chk(e, _189_1 + 184);
    } else if (_n_2 == 185) {
      Term _190_1 = (_n_2 - 185);
      _v_2 = nat_chk(e, _190_1 + 185);
    } else if (_n_2 == 186) {
      Term _191_1 = (_n_2 - 186);
      _v_2 = nat_chk(e, _191_1 + 186);
    } else if (_n_2 == 187) {
      Term _192_1 = (_n_2 - 187);
      _v_2 = nat_chk(e, _192_1 + 187);
    } else if (_n_2 == 188) {
      Term _193_1 = (_n_2 - 188);
      _v_2 = nat_chk(e, _193_1 + 188);
    } else if (_n_2 == 189) {
      Term _194_1 = (_n_2 - 189);
      _v_2 = nat_chk(e, _194_1 + 189);
    } else if (_n_2 == 190) {
      Term _195_1 = (_n_2 - 190);
      _v_2 = nat_chk(e, _195_1 + 190);
    } else if (_n_2 == 191) {
      Term _196_1 = (_n_2 - 191);
      _v_2 = nat_chk(e, _196_1 + 191);
    } else if (_n_2 == 192) {
      Term _197_1 = (_n_2 - 192);
      _v_2 = nat_chk(e, _197_1 + 192);
    } else if (_n_2 == 193) {
      Term _198_1 = (_n_2 - 193);
      _v_2 = nat_chk(e, _198_1 + 193);
    } else if (_n_2 == 194) {
      Term _199_1 = (_n_2 - 194);
      _v_2 = nat_chk(e, _199_1 + 194);
    } else if (_n_2 == 195) {
      Term _200_1 = (_n_2 - 195);
      _v_2 = nat_chk(e, _200_1 + 195);
    } else if (_n_2 == 196) {
      Term _201_1 = (_n_2 - 196);
      _v_2 = nat_chk(e, _201_1 + 196);
    } else if (_n_2 == 197) {
      Term _202_1 = (_n_2 - 197);
      _v_2 = nat_chk(e, _202_1 + 197);
    } else if (_n_2 == 198) {
      Term _203_1 = (_n_2 - 198);
      _v_2 = nat_chk(e, _203_1 + 198);
    } else if (_n_2 == 199) {
      Term _204_1 = (_n_2 - 199);
      _v_2 = nat_chk(e, _204_1 + 199);
    } else if (_n_2 == 200) {
      Term _205_1 = (_n_2 - 200);
      _v_2 = nat_chk(e, _205_1 + 200);
    } else if (_n_2 == 201) {
      Term _206_1 = (_n_2 - 201);
      _v_2 = nat_chk(e, _206_1 + 201);
    } else if (_n_2 == 202) {
      Term _207_1 = (_n_2 - 202);
      _v_2 = nat_chk(e, _207_1 + 202);
    } else if (_n_2 == 203) {
      Term _208_1 = (_n_2 - 203);
      _v_2 = nat_chk(e, _208_1 + 203);
    } else if (_n_2 == 204) {
      Term _209_1 = (_n_2 - 204);
      _v_2 = nat_chk(e, _209_1 + 204);
    } else if (_n_2 == 205) {
      Term _210_1 = (_n_2 - 205);
      _v_2 = nat_chk(e, _210_1 + 205);
    } else if (_n_2 == 206) {
      Term _211_1 = (_n_2 - 206);
      _v_2 = nat_chk(e, _211_1 + 206);
    } else if (_n_2 == 207) {
      Term _212_1 = (_n_2 - 207);
      _v_2 = nat_chk(e, _212_1 + 207);
    } else if (_n_2 == 208) {
      Term _213_1 = (_n_2 - 208);
      _v_2 = nat_chk(e, _213_1 + 208);
    } else if (_n_2 == 209) {
      Term _214_1 = (_n_2 - 209);
      _v_2 = nat_chk(e, _214_1 + 209);
    } else if (_n_2 == 210) {
      Term _215_1 = (_n_2 - 210);
      _v_2 = nat_chk(e, _215_1 + 210);
    } else if (_n_2 == 211) {
      Term _216_1 = (_n_2 - 211);
      _v_2 = nat_chk(e, _216_1 + 211);
    } else if (_n_2 == 212) {
      Term _217_1 = (_n_2 - 212);
      _v_2 = nat_chk(e, _217_1 + 212);
    } else if (_n_2 == 213) {
      Term _218_1 = (_n_2 - 213);
      _v_2 = nat_chk(e, _218_1 + 213);
    } else if (_n_2 == 214) {
      Term _219_1 = (_n_2 - 214);
      _v_2 = nat_chk(e, _219_1 + 214);
    } else if (_n_2 == 215) {
      Term _220_1 = (_n_2 - 215);
      _v_2 = nat_chk(e, _220_1 + 215);
    } else if (_n_2 == 216) {
      Term _221_1 = (_n_2 - 216);
      _v_2 = nat_chk(e, _221_1 + 216);
    } else if (_n_2 == 217) {
      Term _222_1 = (_n_2 - 217);
      _v_2 = nat_chk(e, _222_1 + 217);
    } else if (_n_2 == 218) {
      Term _223_1 = (_n_2 - 218);
      _v_2 = nat_chk(e, _223_1 + 218);
    } else if (_n_2 == 219) {
      Term _224_1 = (_n_2 - 219);
      _v_2 = nat_chk(e, _224_1 + 219);
    } else if (_n_2 == 220) {
      Term _225_1 = (_n_2 - 220);
      _v_2 = nat_chk(e, _225_1 + 220);
    } else if (_n_2 == 221) {
      Term _226_1 = (_n_2 - 221);
      _v_2 = nat_chk(e, _226_1 + 221);
    } else if (_n_2 == 222) {
      Term _227_1 = (_n_2 - 222);
      _v_2 = nat_chk(e, _227_1 + 222);
    } else if (_n_2 == 223) {
      Term _228_1 = (_n_2 - 223);
      _v_2 = nat_chk(e, _228_1 + 223);
    } else if (_n_2 == 224) {
      Term _229_1 = (_n_2 - 224);
      _v_2 = nat_chk(e, _229_1 + 224);
    } else if (_n_2 == 225) {
      Term _230_1 = (_n_2 - 225);
      _v_2 = nat_chk(e, _230_1 + 225);
    } else if (_n_2 == 226) {
      Term _231_1 = (_n_2 - 226);
      _v_2 = nat_chk(e, _231_1 + 226);
    } else if (_n_2 == 227) {
      Term _232_1 = (_n_2 - 227);
      _v_2 = nat_chk(e, _232_1 + 227);
    } else if (_n_2 == 228) {
      Term _233_1 = (_n_2 - 228);
      _v_2 = nat_chk(e, _233_1 + 228);
    } else if (_n_2 == 229) {
      Term _234_1 = (_n_2 - 229);
      _v_2 = nat_chk(e, _234_1 + 229);
    } else if (_n_2 == 230) {
      Term _235_1 = (_n_2 - 230);
      _v_2 = nat_chk(e, _235_1 + 230);
    } else if (_n_2 == 231) {
      Term _236_1 = (_n_2 - 231);
      _v_2 = nat_chk(e, _236_1 + 231);
    } else if (_n_2 == 232) {
      Term _237_1 = (_n_2 - 232);
      _v_2 = nat_chk(e, _237_1 + 232);
    } else if (_n_2 == 233) {
      Term _238_1 = (_n_2 - 233);
      _v_2 = nat_chk(e, _238_1 + 233);
    } else if (_n_2 == 234) {
      Term _239_1 = (_n_2 - 234);
      _v_2 = nat_chk(e, _239_1 + 234);
    } else if (_n_2 == 235) {
      Term _240_1 = (_n_2 - 235);
      _v_2 = nat_chk(e, _240_1 + 235);
    } else if (_n_2 == 236) {
      Term _241_1 = (_n_2 - 236);
      _v_2 = nat_chk(e, _241_1 + 236);
    } else if (_n_2 == 237) {
      Term _242_1 = (_n_2 - 237);
      _v_2 = nat_chk(e, _242_1 + 237);
    } else if (_n_2 == 238) {
      Term _243_1 = (_n_2 - 238);
      _v_2 = nat_chk(e, _243_1 + 238);
    } else if (_n_2 == 239) {
      Term _244_1 = (_n_2 - 239);
      _v_2 = nat_chk(e, _244_1 + 239);
    } else if (_n_2 == 240) {
      Term _245_1 = (_n_2 - 240);
      _v_2 = nat_chk(e, _245_1 + 240);
    } else if (_n_2 == 241) {
      Term _246_1 = (_n_2 - 241);
      _v_2 = nat_chk(e, _246_1 + 241);
    } else if (_n_2 == 242) {
      Term _247_1 = (_n_2 - 242);
      _v_2 = nat_chk(e, _247_1 + 242);
    } else if (_n_2 == 243) {
      Term _248_1 = (_n_2 - 243);
      _v_2 = nat_chk(e, _248_1 + 243);
    } else if (_n_2 == 244) {
      Term _249_1 = (_n_2 - 244);
      _v_2 = nat_chk(e, _249_1 + 244);
    } else if (_n_2 == 245) {
      Term _250_1 = (_n_2 - 245);
      _v_2 = nat_chk(e, _250_1 + 245);
    } else if (_n_2 == 246) {
      Term _251_1 = (_n_2 - 246);
      _v_2 = nat_chk(e, _251_1 + 246);
    } else if (_n_2 == 247) {
      Term _252_1 = (_n_2 - 247);
      _v_2 = nat_chk(e, _252_1 + 247);
    } else if (_n_2 == 248) {
      Term _253_1 = (_n_2 - 248);
      _v_2 = nat_chk(e, _253_1 + 248);
    } else if (_n_2 == 249) {
      Term _254_1 = (_n_2 - 249);
      _v_2 = nat_chk(e, _254_1 + 249);
    } else if (_n_2 == 250) {
      Term _255_1 = (_n_2 - 250);
      _v_2 = nat_chk(e, _255_1 + 250);
    } else if (_n_2 == 251) {
      Term _256_1 = (_n_2 - 251);
      _v_2 = nat_chk(e, _256_1 + 251);
    } else if (_n_2 == 252) {
      Term _257_1 = (_n_2 - 252);
      _v_2 = nat_chk(e, _257_1 + 252);
    } else if (_n_2 == 253) {
      Term _258_1 = (_n_2 - 253);
      _v_2 = nat_chk(e, _258_1 + 253);
    } else if (_n_2 == 254) {
      Term _259_1 = (_n_2 - 254);
      _v_2 = nat_chk(e, _259_1 + 254);
    } else if (_n_2 == 255) {
      Term _260_1 = (_n_2 - 255);
      _v_2 = nat_chk(e, _260_1 + 255);
    } else if (_n_2 == 256) {
      Term _261_1 = (_n_2 - 256);
      _v_2 = nat_chk(e, _261_1 + 256);
    } else if (_n_2 == 257) {
      Term _262_1 = (_n_2 - 257);
      _v_2 = nat_chk(e, _262_1 + 257);
    } else if (_n_2 == 258) {
      Term _263_1 = (_n_2 - 258);
      _v_2 = nat_chk(e, _263_1 + 258);
    } else if (_n_2 == 259) {
      Term _264_1 = (_n_2 - 259);
      _v_2 = nat_chk(e, _264_1 + 259);
    } else if (_n_2 == 260) {
      Term _265_1 = (_n_2 - 260);
      _v_2 = nat_chk(e, _265_1 + 260);
    } else if (_n_2 == 261) {
      Term _266_1 = (_n_2 - 261);
      _v_2 = nat_chk(e, _266_1 + 261);
    } else if (_n_2 == 262) {
      Term _267_1 = (_n_2 - 262);
      _v_2 = nat_chk(e, _267_1 + 262);
    } else if (_n_2 == 263) {
      Term _268_1 = (_n_2 - 263);
      _v_2 = nat_chk(e, _268_1 + 263);
    } else if (_n_2 == 264) {
      Term _269_1 = (_n_2 - 264);
      _v_2 = nat_chk(e, _269_1 + 264);
    } else if (_n_2 == 265) {
      Term _270_1 = (_n_2 - 265);
      _v_2 = nat_chk(e, _270_1 + 265);
    } else if (_n_2 == 266) {
      Term _271_1 = (_n_2 - 266);
      _v_2 = nat_chk(e, _271_1 + 266);
    } else if (_n_2 == 267) {
      Term _272_1 = (_n_2 - 267);
      _v_2 = nat_chk(e, _272_1 + 267);
    } else if (_n_2 == 268) {
      Term _273_1 = (_n_2 - 268);
      _v_2 = nat_chk(e, _273_1 + 268);
    } else if (_n_2 == 269) {
      Term _274_1 = (_n_2 - 269);
      _v_2 = nat_chk(e, _274_1 + 269);
    } else if (_n_2 == 270) {
      Term _275_1 = (_n_2 - 270);
      _v_2 = nat_chk(e, _275_1 + 270);
    } else if (_n_2 == 271) {
      Term _276_1 = (_n_2 - 271);
      _v_2 = nat_chk(e, _276_1 + 271);
    } else if (_n_2 == 272) {
      Term _277_1 = (_n_2 - 272);
      _v_2 = nat_chk(e, _277_1 + 272);
    } else if (_n_2 == 273) {
      Term _278_1 = (_n_2 - 273);
      _v_2 = nat_chk(e, _278_1 + 273);
    } else if (_n_2 == 274) {
      Term _279_1 = (_n_2 - 274);
      _v_2 = nat_chk(e, _279_1 + 274);
    } else if (_n_2 == 275) {
      Term _280_1 = (_n_2 - 275);
      _v_2 = nat_chk(e, _280_1 + 275);
    } else if (_n_2 == 276) {
      Term _281_1 = (_n_2 - 276);
      _v_2 = nat_chk(e, _281_1 + 276);
    } else if (_n_2 == 277) {
      Term _282_1 = (_n_2 - 277);
      _v_2 = nat_chk(e, _282_1 + 277);
    } else if (_n_2 == 278) {
      Term _283_1 = (_n_2 - 278);
      _v_2 = nat_chk(e, _283_1 + 278);
    } else if (_n_2 == 279) {
      Term _284_1 = (_n_2 - 279);
      _v_2 = nat_chk(e, _284_1 + 279);
    } else if (_n_2 == 280) {
      Term _285_1 = (_n_2 - 280);
      _v_2 = nat_chk(e, _285_1 + 280);
    } else if (_n_2 == 281) {
      Term _286_1 = (_n_2 - 281);
      _v_2 = nat_chk(e, _286_1 + 281);
    } else if (_n_2 == 282) {
      Term _287_1 = (_n_2 - 282);
      _v_2 = nat_chk(e, _287_1 + 282);
    } else if (_n_2 == 283) {
      Term _288_1 = (_n_2 - 283);
      _v_2 = nat_chk(e, _288_1 + 283);
    } else if (_n_2 == 284) {
      Term _289_1 = (_n_2 - 284);
      _v_2 = nat_chk(e, _289_1 + 284);
    } else if (_n_2 == 285) {
      Term _290_1 = (_n_2 - 285);
      _v_2 = nat_chk(e, _290_1 + 285);
    } else if (_n_2 == 286) {
      Term _291_1 = (_n_2 - 286);
      _v_2 = nat_chk(e, _291_1 + 286);
    } else if (_n_2 == 287) {
      Term _292_1 = (_n_2 - 287);
      _v_2 = nat_chk(e, _292_1 + 287);
    } else if (_n_2 == 288) {
      Term _293_1 = (_n_2 - 288);
      _v_2 = nat_chk(e, _293_1 + 288);
    } else if (_n_2 == 289) {
      Term _294_1 = (_n_2 - 289);
      _v_2 = nat_chk(e, _294_1 + 289);
    } else if (_n_2 == 290) {
      Term _295_1 = (_n_2 - 290);
      _v_2 = nat_chk(e, _295_1 + 290);
    } else if (_n_2 == 291) {
      Term _296_1 = (_n_2 - 291);
      _v_2 = nat_chk(e, _296_1 + 291);
    } else if (_n_2 == 292) {
      Term _297_1 = (_n_2 - 292);
      _v_2 = nat_chk(e, _297_1 + 292);
    } else if (_n_2 == 293) {
      Term _298_1 = (_n_2 - 293);
      _v_2 = nat_chk(e, _298_1 + 293);
    } else if (_n_2 == 294) {
      Term _299_1 = (_n_2 - 294);
      _v_2 = nat_chk(e, _299_1 + 294);
    } else if (_n_2 == 295) {
      Term _300_1 = (_n_2 - 295);
      _v_2 = nat_chk(e, _300_1 + 295);
    } else if (_n_2 == 296) {
      Term _301_1 = (_n_2 - 296);
      _v_2 = nat_chk(e, _301_1 + 296);
    } else if (_n_2 == 297) {
      Term _302_1 = (_n_2 - 297);
      _v_2 = nat_chk(e, _302_1 + 297);
    } else if (_n_2 == 298) {
      Term _303_1 = (_n_2 - 298);
      _v_2 = nat_chk(e, _303_1 + 298);
    } else if (_n_2 == 299) {
      Term _304_1 = (_n_2 - 299);
      _v_2 = nat_chk(e, _304_1 + 299);
    } else if (_n_2 == 300) {
      r0 = 299ull;
      _n_2 = r0;
      WL_AGAIN(spin_0);
    } else {
      Term _305_0 = (_n_2 - 300);
      _v_2 = nat_chk(e, _305_0 + 300);
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
    Term _o_0[1];
    if (spin_0(e, _o_0, 300ull) == 0) {
      return 0;
    }
    _v_1 = _o_0[0];
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
