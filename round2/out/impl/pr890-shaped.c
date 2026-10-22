
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
#define CID_NIL 13
#define CID_CON 14
#define CID_CHR 15
#define CID_WNIL 16
#define CID_IO_ARGS 17
#define CID_IO_WRITE 18
#define FID_ARM_79_C82 0
#define FID_MAIN 1
#define FID_MAIN_C122 2
#define FID_MAIN_C123 3
#define FID_MAIN_C124 4
#define FID_MAIN_K125 5
#define FID_IO_ARGS 6
#define FID_IO_WRITE 7
#define FID_IO_EMIT 8
#define FID_CLO_APPLY 9
#define FID_EXIT 10
#define FID_ENTER 11
CONSTV u8 FID_ARITY_T[] = { 1, 0, 1, 1, 3, 2, 1, 2, 1, 2 };
CONSTV u8 FID_FLAG_T[] = { 2, 2, 2, 2, 2, 2, 2, 2, 2, 2 };
CONSTV u8 FID_RESW_T[] = { 0, 0, 0, 0, 0, 1, 0, 0, 0, 0 };
CONSTV u8 CID_ARITY_T[] = { 2, 0, 2, 2, 1, 2, 1, 1, 0, 1, 0, 0, 0, 0, 2, 1, 0, 1, 2 };
CONSTV u8 CID_HOT_T[] = { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };
#define STAT_LEN 22

#define WL_RESW 1
#define BANGS   0

#define WL_BANK Term r0, r1, r2;

#define WL_LOAD(A, N) \
  do { \
    if ((N) <= 0) break; r0 = e.mem[(A) + 0]; \
    if ((N) <= 1) break; r1 = e.mem[(A) + 1]; \
    if ((N) <= 2) break; r2 = e.mem[(A) + 2]; \
  } while (0);

#define WL_LAST(X) \
  switch (war) { \
    case 0: r0 = (X); \
      break; \
    case 1: r1 = (X); \
      break; \
    case 2: r2 = (X); \
      break; \
  }

#define WL_SAVE(V) (V)[0] = r0;

#define WL_TAKE(V) r0 = (V)[0];

#define WL_SIG Env e, Stk sp, u32 seq, u32 rn, Term r0, Term r1, Term r2

#define WL_ALL e, sp, seq, rn, r0, r1, r2

#define WL_TABLE WL_X(FID_ARM_79_C82) WL_X(FID_MAIN) WL_X(FID_MAIN_C122) WL_X(FID_MAIN_C123) WL_X(FID_MAIN_C124) WL_X(FID_MAIN_K125) WL_X(FID_IO_ARGS) WL_X(FID_IO_WRITE) WL_X(FID_IO_EMIT) WL_X(FID_CLO_APPLY) WL_X(FID_EXIT)
#define MAIN_FID FID_MAIN
#define MAIN_PURE 0
#define BLK_SHR 0

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

CONSTV u64 STAT_IMG[] = { 116ull, term_pak(CID_SNIL, 0), 115ull, term_ctr(CID_SCON, STAT_OFF + 0), 111ull, term_ctr(CID_SCON, STAT_OFF + 2), 104ull, term_ctr(CID_SCON, STAT_OFF + 4), 51ull, term_pak(CID_SNIL, 0), 49ull, term_ctr(CID_SCON, STAT_OFF + 8), 114ull, term_pak(CID_SNIL, 0), 101ull, term_ctr(CID_SCON, STAT_OFF + 12), 104ull, term_ctr(CID_SCON, STAT_OFF + 14), 116ull, term_ctr(CID_SCON, STAT_OFF + 16), 111ull, term_ctr(CID_SCON, STAT_OFF + 18) };

INLINE Term arm_67(Env e, THR Term* o) {
  u32 wpoll = 0;
  Term _v_67 = 0;
  WL_SPIN
    u64 _nd_0 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_0 + 0] = term_ctr(CID_SCON, STAT_OFF + 6);
    _v_67 = term_clo(FID_IO_WRITE, _nd_0);
  break;
  }
  o[0] = _v_67;
  return 1;
}

INLINE Term arm_78(Env e, THR Term* o) {
  u32 wpoll = 0;
  Term _v_78 = 0;
  WL_SPIN
    u64 _nd_1 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 10);
    _v_78 = term_clo(FID_IO_WRITE, _nd_1);
  break;
  }
  o[0] = _v_78;
  return 1;
}

INLINE Term spin_0(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_81 = 0;
  u32 _code_0 = r0;
  Term _msg_0 = r1;
  Term _k_0 = r2;
  WL_SPIN
    term_sink(e, _k_0);
    u64 _nd_2 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_2 + 0] = _code_0;
    e.mem[_nd_2 + 1] = _msg_0;
    _v_81 = term_ctr(CID_HALT, _nd_2);
  break;
  }
  o[0] = _v_81;
  return 1;
}

INLINE Term arm_79(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_79 = 0;
  Term _a_195 = r0;
  WL_SPIN
    term_sink(e, _a_195);
    _v_79 = term_clo(FID_ARM_79_C82, 0);
  break;
  }
  o[0] = _v_79;
  return 1;
}

INLINE Term arm_77(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_77 = 0;
  Term _a_193 = r0;
  Term _a_194 = r1;
  WL_SPIN
    term_sink(e, _a_193);
    if (term_aux(_a_194) == CID_NIL) {
      Term _o_1[1];
      if (arm_78(e, _o_1) == 0) {
        return 0;
      }
      _v_77 = _o_1[0];
    } else {
      Term _o_3[1];
      if (arm_79(e, _o_3, _a_194) == 0) {
        return 0;
      }
      _v_77 = _o_3[0];
    }
  break;
  }
  o[0] = _v_77;
  return 1;
}

INLINE Term arm_76(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_76 = 0;
  Term _a_191 = r0;
  Term _a_192 = r1;
  WL_SPIN
    term_sink(e, _a_191);
    if (term_aux(_a_192) == CID_CON) {
      u64 _sp_33 = term_loc(_a_192);
      Term _f_66 = e.mem[_sp_33 + 0];
      Term _f_67 = e.mem[_sp_33 + 1];
      Term _o_4[1];
      if (arm_77(e, _o_4, _f_66, _f_67) == 0) {
        return 0;
      }
      _v_76 = _o_4[0];
      heap_free(e, cls_fit(2), _sp_33);
    } else {
      Term _o_5[1];
      if (arm_79(e, _o_5, _a_192) == 0) {
        return 0;
      }
      _v_76 = _o_5[0];
    }
  break;
  }
  o[0] = _v_76;
  return 1;
}

INLINE Term arm_75(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_75 = 0;
  Term _a_189 = r0;
  Term _a_190 = r1;
  WL_SPIN
    term_sink(e, _a_189);
    if (term_aux(_a_190) == CID_CON) {
      u64 _sp_32 = term_loc(_a_190);
      Term _f_64 = e.mem[_sp_32 + 0];
      Term _f_65 = e.mem[_sp_32 + 1];
      Term _o_6[1];
      if (arm_76(e, _o_6, _f_64, _f_65) == 0) {
        return 0;
      }
      _v_75 = _o_6[0];
      heap_free(e, cls_fit(2), _sp_32);
    } else {
      Term _o_7[1];
      if (arm_79(e, _o_7, _a_190) == 0) {
        return 0;
      }
      _v_75 = _o_7[0];
    }
  break;
  }
  o[0] = _v_75;
  return 1;
}

INLINE Term arm_74(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_74 = 0;
  Term _a_187 = r0;
  Term _a_188 = r1;
  WL_SPIN
    term_sink(e, _a_187);
    if (term_aux(_a_188) == CID_CON) {
      u64 _sp_31 = term_loc(_a_188);
      Term _f_62 = e.mem[_sp_31 + 0];
      Term _f_63 = e.mem[_sp_31 + 1];
      Term _o_8[1];
      if (arm_75(e, _o_8, _f_62, _f_63) == 0) {
        return 0;
      }
      _v_74 = _o_8[0];
      heap_free(e, cls_fit(2), _sp_31);
    } else {
      Term _o_9[1];
      if (arm_79(e, _o_9, _a_188) == 0) {
        return 0;
      }
      _v_74 = _o_9[0];
    }
  break;
  }
  o[0] = _v_74;
  return 1;
}

INLINE Term arm_73(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_73 = 0;
  Term _a_185 = r0;
  Term _a_186 = r1;
  WL_SPIN
    term_sink(e, _a_185);
    if (term_aux(_a_186) == CID_CON) {
      u64 _sp_30 = term_loc(_a_186);
      Term _f_60 = e.mem[_sp_30 + 0];
      Term _f_61 = e.mem[_sp_30 + 1];
      Term _o_10[1];
      if (arm_74(e, _o_10, _f_60, _f_61) == 0) {
        return 0;
      }
      _v_73 = _o_10[0];
      heap_free(e, cls_fit(2), _sp_30);
    } else {
      Term _o_11[1];
      if (arm_79(e, _o_11, _a_186) == 0) {
        return 0;
      }
      _v_73 = _o_11[0];
    }
  break;
  }
  o[0] = _v_73;
  return 1;
}

INLINE Term arm_72(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_72 = 0;
  Term _a_183 = r0;
  Term _a_184 = r1;
  WL_SPIN
    term_sink(e, _a_183);
    if (term_aux(_a_184) == CID_CON) {
      u64 _sp_29 = term_loc(_a_184);
      Term _f_58 = e.mem[_sp_29 + 0];
      Term _f_59 = e.mem[_sp_29 + 1];
      Term _o_12[1];
      if (arm_73(e, _o_12, _f_58, _f_59) == 0) {
        return 0;
      }
      _v_72 = _o_12[0];
      heap_free(e, cls_fit(2), _sp_29);
    } else {
      Term _o_13[1];
      if (arm_79(e, _o_13, _a_184) == 0) {
        return 0;
      }
      _v_72 = _o_13[0];
    }
  break;
  }
  o[0] = _v_72;
  return 1;
}

INLINE Term arm_71(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_71 = 0;
  Term _a_181 = r0;
  Term _a_182 = r1;
  WL_SPIN
    term_sink(e, _a_181);
    if (term_aux(_a_182) == CID_CON) {
      u64 _sp_28 = term_loc(_a_182);
      Term _f_56 = e.mem[_sp_28 + 0];
      Term _f_57 = e.mem[_sp_28 + 1];
      Term _o_14[1];
      if (arm_72(e, _o_14, _f_56, _f_57) == 0) {
        return 0;
      }
      _v_71 = _o_14[0];
      heap_free(e, cls_fit(2), _sp_28);
    } else {
      Term _o_15[1];
      if (arm_79(e, _o_15, _a_182) == 0) {
        return 0;
      }
      _v_71 = _o_15[0];
    }
  break;
  }
  o[0] = _v_71;
  return 1;
}

INLINE Term arm_70(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_70 = 0;
  Term _a_179 = r0;
  Term _a_180 = r1;
  WL_SPIN
    term_sink(e, _a_179);
    if (term_aux(_a_180) == CID_CON) {
      u64 _sp_27 = term_loc(_a_180);
      Term _f_54 = e.mem[_sp_27 + 0];
      Term _f_55 = e.mem[_sp_27 + 1];
      Term _o_16[1];
      if (arm_71(e, _o_16, _f_54, _f_55) == 0) {
        return 0;
      }
      _v_70 = _o_16[0];
      heap_free(e, cls_fit(2), _sp_27);
    } else {
      Term _o_17[1];
      if (arm_79(e, _o_17, _a_180) == 0) {
        return 0;
      }
      _v_70 = _o_17[0];
    }
  break;
  }
  o[0] = _v_70;
  return 1;
}

INLINE Term arm_69(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_69 = 0;
  Term _a_177 = r0;
  Term _a_178 = r1;
  WL_SPIN
    term_sink(e, _a_177);
    if (term_aux(_a_178) == CID_CON) {
      u64 _sp_26 = term_loc(_a_178);
      Term _f_52 = e.mem[_sp_26 + 0];
      Term _f_53 = e.mem[_sp_26 + 1];
      Term _o_18[1];
      if (arm_70(e, _o_18, _f_52, _f_53) == 0) {
        return 0;
      }
      _v_69 = _o_18[0];
      heap_free(e, cls_fit(2), _sp_26);
    } else {
      Term _o_19[1];
      if (arm_79(e, _o_19, _a_178) == 0) {
        return 0;
      }
      _v_69 = _o_19[0];
    }
  break;
  }
  o[0] = _v_69;
  return 1;
}

INLINE Term arm_68(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_68 = 0;
  Term _a_175 = r0;
  Term _a_176 = r1;
  WL_SPIN
    term_sink(e, _a_175);
    if (term_aux(_a_176) == CID_CON) {
      u64 _sp_25 = term_loc(_a_176);
      Term _f_50 = e.mem[_sp_25 + 0];
      Term _f_51 = e.mem[_sp_25 + 1];
      Term _o_20[1];
      if (arm_69(e, _o_20, _f_50, _f_51) == 0) {
        return 0;
      }
      _v_68 = _o_20[0];
      heap_free(e, cls_fit(2), _sp_25);
    } else {
      Term _o_21[1];
      if (arm_79(e, _o_21, _a_176) == 0) {
        return 0;
      }
      _v_68 = _o_21[0];
    }
  break;
  }
  o[0] = _v_68;
  return 1;
}

INLINE Term arm_66(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_66 = 0;
  Term _a_173 = r0;
  Term _a_174 = r1;
  WL_SPIN
    term_sink(e, _a_173);
    if (term_aux(_a_174) == CID_NIL) {
      Term _o_0[1];
      if (arm_67(e, _o_0) == 0) {
        return 0;
      }
      _v_66 = _o_0[0];
    } else {
      u64 _sp_24 = term_loc(_a_174);
      Term _f_48 = e.mem[_sp_24 + 0];
      Term _f_49 = e.mem[_sp_24 + 1];
      Term _o_22[1];
      if (arm_68(e, _o_22, _f_48, _f_49) == 0) {
        return 0;
      }
      _v_66 = _o_22[0];
      heap_free(e, cls_fit(2), _sp_24);
    }
  break;
  }
  o[0] = _v_66;
  return 1;
}

INLINE Term arm_65(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_65 = 0;
  Term _a_171 = r0;
  Term _a_172 = r1;
  WL_SPIN
    term_sink(e, _a_171);
    if (term_aux(_a_172) == CID_CON) {
      u64 _sp_23 = term_loc(_a_172);
      Term _f_46 = e.mem[_sp_23 + 0];
      Term _f_47 = e.mem[_sp_23 + 1];
      Term _o_23[1];
      if (arm_66(e, _o_23, _f_46, _f_47) == 0) {
        return 0;
      }
      _v_65 = _o_23[0];
      heap_free(e, cls_fit(2), _sp_23);
    } else {
      Term _o_24[1];
      if (arm_79(e, _o_24, _a_172) == 0) {
        return 0;
      }
      _v_65 = _o_24[0];
    }
  break;
  }
  o[0] = _v_65;
  return 1;
}

INLINE Term arm_64(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_64 = 0;
  Term _a_170 = r0;
  WL_SPIN
    if (term_aux(_a_170) == CID_CON) {
      u64 _sp_22 = term_loc(_a_170);
      Term _f_44 = e.mem[_sp_22 + 0];
      Term _f_45 = e.mem[_sp_22 + 1];
      Term _o_25[1];
      if (arm_65(e, _o_25, _f_44, _f_45) == 0) {
        return 0;
      }
      _v_64 = _o_25[0];
      heap_free(e, cls_fit(2), _sp_22);
    } else {
      Term _o_26[1];
      if (arm_79(e, _o_26, _a_170) == 0) {
        return 0;
      }
      _v_64 = _o_26[0];
    }
  break;
  }
  o[0] = _v_64;
  return 1;
}

INLINE Term arm_82(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_84 = 0;
  Term _a_200 = r0;
  Term _a_201 = r1;
  WL_SPIN
    term_sink(e, _a_200);
    if (term_aux(_a_201) == CID_CON) {
      u64 _sp_36 = term_loc(_a_201);
      Term _f_72 = e.mem[_sp_36 + 0];
      Term _f_73 = e.mem[_sp_36 + 1];
      Term _o_28[1];
      if (arm_68(e, _o_28, _f_72, _f_73) == 0) {
        return 0;
      }
      _v_84 = _o_28[0];
      heap_free(e, cls_fit(2), _sp_36);
    } else {
      Term _o_29[1];
      if (arm_79(e, _o_29, _a_201) == 0) {
        return 0;
      }
      _v_84 = _o_29[0];
    }
  break;
  }
  o[0] = _v_84;
  return 1;
}

INLINE Term arm_81(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_83 = 0;
  Term _a_198 = r0;
  Term _a_199 = r1;
  WL_SPIN
    term_sink(e, _a_198);
    if (term_aux(_a_199) == CID_CON) {
      u64 _sp_35 = term_loc(_a_199);
      Term _f_70 = e.mem[_sp_35 + 0];
      Term _f_71 = e.mem[_sp_35 + 1];
      Term _o_30[1];
      if (arm_82(e, _o_30, _f_70, _f_71) == 0) {
        return 0;
      }
      _v_83 = _o_30[0];
      heap_free(e, cls_fit(2), _sp_35);
    } else {
      Term _o_31[1];
      if (arm_79(e, _o_31, _a_199) == 0) {
        return 0;
      }
      _v_83 = _o_31[0];
    }
  break;
  }
  o[0] = _v_83;
  return 1;
}

INLINE Term arm_80(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_82 = 0;
  Term _a_196 = r0;
  Term _a_197 = r1;
  WL_SPIN
    term_sink(e, _a_196);
    if (term_aux(_a_197) == CID_CON) {
      u64 _sp_34 = term_loc(_a_197);
      Term _f_68 = e.mem[_sp_34 + 0];
      Term _f_69 = e.mem[_sp_34 + 1];
      Term _o_32[1];
      if (arm_81(e, _o_32, _f_68, _f_69) == 0) {
        return 0;
      }
      _v_82 = _o_32[0];
      heap_free(e, cls_fit(2), _sp_34);
    } else {
      Term _o_33[1];
      if (arm_79(e, _o_33, _a_197) == 0) {
        return 0;
      }
      _v_82 = _o_33[0];
    }
  break;
  }
  o[0] = _v_82;
  return 1;
}

INLINE Term arm_63(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_63 = 0;
  Term _a_168 = r0;
  Term _a_169 = r1;
  WL_SPIN
    if (term_aux(_a_168) == CID_SNIL) {
      Term _o_27[1];
      if (arm_64(e, _o_27, _a_169) == 0) {
        return 0;
      }
      _v_63 = _o_27[0];
    } else {
      Term _o_34[1];
      if (arm_80(e, _o_34, _a_168, _a_169) == 0) {
        return 0;
      }
      _v_63 = _o_34[0];
    }
  break;
  }
  o[0] = _v_63;
  return 1;
}

INLINE Term arm_83(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_85 = 0;
  u32 _a_202 = r0;
  Term _a_203 = r1;
  Term _a_204 = r2;
  WL_SPIN
    term_sink(e, _a_203);
    if (term_aux(_a_204) == CID_CON) {
      u64 _sp_37 = term_loc(_a_204);
      Term _f_74 = e.mem[_sp_37 + 0];
      Term _f_75 = e.mem[_sp_37 + 1];
      Term _o_36[1];
      if (arm_81(e, _o_36, _f_74, _f_75) == 0) {
        return 0;
      }
      _v_85 = _o_36[0];
      heap_free(e, cls_fit(2), _sp_37);
    } else {
      Term _o_37[1];
      if (arm_79(e, _o_37, _a_204) == 0) {
        return 0;
      }
      _v_85 = _o_37[0];
    }
  break;
  }
  o[0] = _v_85;
  return 1;
}

INLINE Term arm_84(Env e, THR Term* o, u32 r0, u32 r1, Term r2, Term r3) {
  u32 wpoll = 0;
  Term _v_86 = 0;
  u32 _a_205 = r0;
  u32 _a_206 = r1;
  Term _a_207 = r2;
  Term _a_208 = r3;
  WL_SPIN
    term_sink(e, _a_207);
    if (term_aux(_a_208) == CID_CON) {
      u64 _sp_38 = term_loc(_a_208);
      Term _f_76 = e.mem[_sp_38 + 0];
      Term _f_77 = e.mem[_sp_38 + 1];
      Term _o_39[1];
      if (arm_81(e, _o_39, _f_76, _f_77) == 0) {
        return 0;
      }
      _v_86 = _o_39[0];
      heap_free(e, cls_fit(2), _sp_38);
    } else {
      Term _o_40[1];
      if (arm_79(e, _o_40, _a_208) == 0) {
        return 0;
      }
      _v_86 = _o_40[0];
    }
  break;
  }
  o[0] = _v_86;
  return 1;
}

INLINE Term arm_85(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, Term r3, Term r4) {
  u32 wpoll = 0;
  Term _v_87 = 0;
  u32 _a_209 = r0;
  u32 _a_210 = r1;
  u32 _a_211 = r2;
  Term _a_212 = r3;
  Term _a_213 = r4;
  WL_SPIN
    term_sink(e, _a_212);
    if (term_aux(_a_213) == CID_CON) {
      u64 _sp_39 = term_loc(_a_213);
      Term _f_78 = e.mem[_sp_39 + 0];
      Term _f_79 = e.mem[_sp_39 + 1];
      Term _o_42[1];
      if (arm_81(e, _o_42, _f_78, _f_79) == 0) {
        return 0;
      }
      _v_87 = _o_42[0];
      heap_free(e, cls_fit(2), _sp_39);
    } else {
      Term _o_43[1];
      if (arm_79(e, _o_43, _a_213) == 0) {
        return 0;
      }
      _v_87 = _o_43[0];
    }
  break;
  }
  o[0] = _v_87;
  return 1;
}

INLINE Term arm_86(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, Term r4, Term r5) {
  u32 wpoll = 0;
  Term _v_88 = 0;
  u32 _a_214 = r0;
  u32 _a_215 = r1;
  u32 _a_216 = r2;
  u32 _a_217 = r3;
  Term _a_218 = r4;
  Term _a_219 = r5;
  WL_SPIN
    term_sink(e, _a_218);
    if (term_aux(_a_219) == CID_CON) {
      u64 _sp_40 = term_loc(_a_219);
      Term _f_80 = e.mem[_sp_40 + 0];
      Term _f_81 = e.mem[_sp_40 + 1];
      Term _o_45[1];
      if (arm_81(e, _o_45, _f_80, _f_81) == 0) {
        return 0;
      }
      _v_88 = _o_45[0];
      heap_free(e, cls_fit(2), _sp_40);
    } else {
      Term _o_46[1];
      if (arm_79(e, _o_46, _a_219) == 0) {
        return 0;
      }
      _v_88 = _o_46[0];
    }
  break;
  }
  o[0] = _v_88;
  return 1;
}

INLINE Term arm_87(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, Term r5, Term r6) {
  u32 wpoll = 0;
  Term _v_89 = 0;
  u32 _a_220 = r0;
  u32 _a_221 = r1;
  u32 _a_222 = r2;
  u32 _a_223 = r3;
  u32 _a_224 = r4;
  Term _a_225 = r5;
  Term _a_226 = r6;
  WL_SPIN
    term_sink(e, _a_225);
    if (term_aux(_a_226) == CID_CON) {
      u64 _sp_41 = term_loc(_a_226);
      Term _f_82 = e.mem[_sp_41 + 0];
      Term _f_83 = e.mem[_sp_41 + 1];
      Term _o_48[1];
      if (arm_81(e, _o_48, _f_82, _f_83) == 0) {
        return 0;
      }
      _v_89 = _o_48[0];
      heap_free(e, cls_fit(2), _sp_41);
    } else {
      Term _o_49[1];
      if (arm_79(e, _o_49, _a_226) == 0) {
        return 0;
      }
      _v_89 = _o_49[0];
    }
  break;
  }
  o[0] = _v_89;
  return 1;
}

INLINE Term arm_88(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, Term r6, Term r7) {
  u32 wpoll = 0;
  Term _v_90 = 0;
  u32 _a_227 = r0;
  u32 _a_228 = r1;
  u32 _a_229 = r2;
  u32 _a_230 = r3;
  u32 _a_231 = r4;
  u32 _a_232 = r5;
  Term _a_233 = r6;
  Term _a_234 = r7;
  WL_SPIN
    term_sink(e, _a_233);
    if (term_aux(_a_234) == CID_CON) {
      u64 _sp_42 = term_loc(_a_234);
      Term _f_84 = e.mem[_sp_42 + 0];
      Term _f_85 = e.mem[_sp_42 + 1];
      Term _o_51[1];
      if (arm_81(e, _o_51, _f_84, _f_85) == 0) {
        return 0;
      }
      _v_90 = _o_51[0];
      heap_free(e, cls_fit(2), _sp_42);
    } else {
      Term _o_52[1];
      if (arm_79(e, _o_52, _a_234) == 0) {
        return 0;
      }
      _v_90 = _o_52[0];
    }
  break;
  }
  o[0] = _v_90;
  return 1;
}

INLINE Term arm_89(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, Term r7, Term r8) {
  u32 wpoll = 0;
  Term _v_91 = 0;
  u32 _a_235 = r0;
  u32 _a_236 = r1;
  u32 _a_237 = r2;
  u32 _a_238 = r3;
  u32 _a_239 = r4;
  u32 _a_240 = r5;
  u32 _a_241 = r6;
  Term _a_242 = r7;
  Term _a_243 = r8;
  WL_SPIN
    term_sink(e, _a_242);
    if (term_aux(_a_243) == CID_CON) {
      u64 _sp_43 = term_loc(_a_243);
      Term _f_86 = e.mem[_sp_43 + 0];
      Term _f_87 = e.mem[_sp_43 + 1];
      Term _o_54[1];
      if (arm_81(e, _o_54, _f_86, _f_87) == 0) {
        return 0;
      }
      _v_91 = _o_54[0];
      heap_free(e, cls_fit(2), _sp_43);
    } else {
      Term _o_55[1];
      if (arm_79(e, _o_55, _a_243) == 0) {
        return 0;
      }
      _v_91 = _o_55[0];
    }
  break;
  }
  o[0] = _v_91;
  return 1;
}

INLINE Term arm_90(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, Term r8, Term r9) {
  u32 wpoll = 0;
  Term _v_92 = 0;
  u32 _a_244 = r0;
  u32 _a_245 = r1;
  u32 _a_246 = r2;
  u32 _a_247 = r3;
  u32 _a_248 = r4;
  u32 _a_249 = r5;
  u32 _a_250 = r6;
  u32 _a_251 = r7;
  Term _a_252 = r8;
  Term _a_253 = r9;
  WL_SPIN
    term_sink(e, _a_252);
    if (term_aux(_a_253) == CID_CON) {
      u64 _sp_44 = term_loc(_a_253);
      Term _f_88 = e.mem[_sp_44 + 0];
      Term _f_89 = e.mem[_sp_44 + 1];
      Term _o_57[1];
      if (arm_81(e, _o_57, _f_88, _f_89) == 0) {
        return 0;
      }
      _v_92 = _o_57[0];
      heap_free(e, cls_fit(2), _sp_44);
    } else {
      Term _o_58[1];
      if (arm_79(e, _o_58, _a_253) == 0) {
        return 0;
      }
      _v_92 = _o_58[0];
    }
  break;
  }
  o[0] = _v_92;
  return 1;
}

INLINE Term arm_91(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, Term r9, Term r10) {
  u32 wpoll = 0;
  Term _v_93 = 0;
  u32 _a_254 = r0;
  u32 _a_255 = r1;
  u32 _a_256 = r2;
  u32 _a_257 = r3;
  u32 _a_258 = r4;
  u32 _a_259 = r5;
  u32 _a_260 = r6;
  u32 _a_261 = r7;
  u32 _a_262 = r8;
  Term _a_263 = r9;
  Term _a_264 = r10;
  WL_SPIN
    term_sink(e, _a_263);
    if (term_aux(_a_264) == CID_CON) {
      u64 _sp_45 = term_loc(_a_264);
      Term _f_90 = e.mem[_sp_45 + 0];
      Term _f_91 = e.mem[_sp_45 + 1];
      Term _o_60[1];
      if (arm_81(e, _o_60, _f_90, _f_91) == 0) {
        return 0;
      }
      _v_93 = _o_60[0];
      heap_free(e, cls_fit(2), _sp_45);
    } else {
      Term _o_61[1];
      if (arm_79(e, _o_61, _a_264) == 0) {
        return 0;
      }
      _v_93 = _o_61[0];
    }
  break;
  }
  o[0] = _v_93;
  return 1;
}

INLINE Term arm_92(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, Term r10, Term r11) {
  u32 wpoll = 0;
  Term _v_94 = 0;
  u32 _a_265 = r0;
  u32 _a_266 = r1;
  u32 _a_267 = r2;
  u32 _a_268 = r3;
  u32 _a_269 = r4;
  u32 _a_270 = r5;
  u32 _a_271 = r6;
  u32 _a_272 = r7;
  u32 _a_273 = r8;
  u32 _a_274 = r9;
  Term _a_275 = r10;
  Term _a_276 = r11;
  WL_SPIN
    term_sink(e, _a_275);
    if (term_aux(_a_276) == CID_CON) {
      u64 _sp_46 = term_loc(_a_276);
      Term _f_92 = e.mem[_sp_46 + 0];
      Term _f_93 = e.mem[_sp_46 + 1];
      Term _o_63[1];
      if (arm_81(e, _o_63, _f_92, _f_93) == 0) {
        return 0;
      }
      _v_94 = _o_63[0];
      heap_free(e, cls_fit(2), _sp_46);
    } else {
      Term _o_64[1];
      if (arm_79(e, _o_64, _a_276) == 0) {
        return 0;
      }
      _v_94 = _o_64[0];
    }
  break;
  }
  o[0] = _v_94;
  return 1;
}

INLINE Term arm_93(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, Term r11, Term r12) {
  u32 wpoll = 0;
  Term _v_95 = 0;
  u32 _a_277 = r0;
  u32 _a_278 = r1;
  u32 _a_279 = r2;
  u32 _a_280 = r3;
  u32 _a_281 = r4;
  u32 _a_282 = r5;
  u32 _a_283 = r6;
  u32 _a_284 = r7;
  u32 _a_285 = r8;
  u32 _a_286 = r9;
  u32 _a_287 = r10;
  Term _a_288 = r11;
  Term _a_289 = r12;
  WL_SPIN
    term_sink(e, _a_288);
    if (term_aux(_a_289) == CID_CON) {
      u64 _sp_47 = term_loc(_a_289);
      Term _f_94 = e.mem[_sp_47 + 0];
      Term _f_95 = e.mem[_sp_47 + 1];
      Term _o_66[1];
      if (arm_81(e, _o_66, _f_94, _f_95) == 0) {
        return 0;
      }
      _v_95 = _o_66[0];
      heap_free(e, cls_fit(2), _sp_47);
    } else {
      Term _o_67[1];
      if (arm_79(e, _o_67, _a_289) == 0) {
        return 0;
      }
      _v_95 = _o_67[0];
    }
  break;
  }
  o[0] = _v_95;
  return 1;
}

INLINE Term arm_94(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, Term r12, Term r13) {
  u32 wpoll = 0;
  Term _v_96 = 0;
  u32 _a_290 = r0;
  u32 _a_291 = r1;
  u32 _a_292 = r2;
  u32 _a_293 = r3;
  u32 _a_294 = r4;
  u32 _a_295 = r5;
  u32 _a_296 = r6;
  u32 _a_297 = r7;
  u32 _a_298 = r8;
  u32 _a_299 = r9;
  u32 _a_300 = r10;
  u32 _a_301 = r11;
  Term _a_302 = r12;
  Term _a_303 = r13;
  WL_SPIN
    term_sink(e, _a_302);
    if (term_aux(_a_303) == CID_CON) {
      u64 _sp_48 = term_loc(_a_303);
      Term _f_96 = e.mem[_sp_48 + 0];
      Term _f_97 = e.mem[_sp_48 + 1];
      Term _o_69[1];
      if (arm_81(e, _o_69, _f_96, _f_97) == 0) {
        return 0;
      }
      _v_96 = _o_69[0];
      heap_free(e, cls_fit(2), _sp_48);
    } else {
      Term _o_70[1];
      if (arm_79(e, _o_70, _a_303) == 0) {
        return 0;
      }
      _v_96 = _o_70[0];
    }
  break;
  }
  o[0] = _v_96;
  return 1;
}

INLINE Term arm_95(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, Term r13, Term r14) {
  u32 wpoll = 0;
  Term _v_97 = 0;
  u32 _a_304 = r0;
  u32 _a_305 = r1;
  u32 _a_306 = r2;
  u32 _a_307 = r3;
  u32 _a_308 = r4;
  u32 _a_309 = r5;
  u32 _a_310 = r6;
  u32 _a_311 = r7;
  u32 _a_312 = r8;
  u32 _a_313 = r9;
  u32 _a_314 = r10;
  u32 _a_315 = r11;
  u32 _a_316 = r12;
  Term _a_317 = r13;
  Term _a_318 = r14;
  WL_SPIN
    term_sink(e, _a_317);
    if (term_aux(_a_318) == CID_CON) {
      u64 _sp_49 = term_loc(_a_318);
      Term _f_98 = e.mem[_sp_49 + 0];
      Term _f_99 = e.mem[_sp_49 + 1];
      Term _o_72[1];
      if (arm_81(e, _o_72, _f_98, _f_99) == 0) {
        return 0;
      }
      _v_97 = _o_72[0];
      heap_free(e, cls_fit(2), _sp_49);
    } else {
      Term _o_73[1];
      if (arm_79(e, _o_73, _a_318) == 0) {
        return 0;
      }
      _v_97 = _o_73[0];
    }
  break;
  }
  o[0] = _v_97;
  return 1;
}

INLINE Term arm_96(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, u32 r13, Term r14, Term r15) {
  u32 wpoll = 0;
  Term _v_98 = 0;
  u32 _a_319 = r0;
  u32 _a_320 = r1;
  u32 _a_321 = r2;
  u32 _a_322 = r3;
  u32 _a_323 = r4;
  u32 _a_324 = r5;
  u32 _a_325 = r6;
  u32 _a_326 = r7;
  u32 _a_327 = r8;
  u32 _a_328 = r9;
  u32 _a_329 = r10;
  u32 _a_330 = r11;
  u32 _a_331 = r12;
  u32 _a_332 = r13;
  Term _a_333 = r14;
  Term _a_334 = r15;
  WL_SPIN
    term_sink(e, _a_333);
    if (term_aux(_a_334) == CID_CON) {
      u64 _sp_50 = term_loc(_a_334);
      Term _f_100 = e.mem[_sp_50 + 0];
      Term _f_101 = e.mem[_sp_50 + 1];
      Term _o_75[1];
      if (arm_81(e, _o_75, _f_100, _f_101) == 0) {
        return 0;
      }
      _v_98 = _o_75[0];
      heap_free(e, cls_fit(2), _sp_50);
    } else {
      Term _o_76[1];
      if (arm_79(e, _o_76, _a_334) == 0) {
        return 0;
      }
      _v_98 = _o_76[0];
    }
  break;
  }
  o[0] = _v_98;
  return 1;
}

INLINE Term arm_97(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, u32 r13, u32 r14, Term r15, Term r16) {
  u32 wpoll = 0;
  Term _v_99 = 0;
  u32 _a_335 = r0;
  u32 _a_336 = r1;
  u32 _a_337 = r2;
  u32 _a_338 = r3;
  u32 _a_339 = r4;
  u32 _a_340 = r5;
  u32 _a_341 = r6;
  u32 _a_342 = r7;
  u32 _a_343 = r8;
  u32 _a_344 = r9;
  u32 _a_345 = r10;
  u32 _a_346 = r11;
  u32 _a_347 = r12;
  u32 _a_348 = r13;
  u32 _a_349 = r14;
  Term _a_350 = r15;
  Term _a_351 = r16;
  WL_SPIN
    term_sink(e, _a_350);
    if (term_aux(_a_351) == CID_CON) {
      u64 _sp_51 = term_loc(_a_351);
      Term _f_102 = e.mem[_sp_51 + 0];
      Term _f_103 = e.mem[_sp_51 + 1];
      Term _o_78[1];
      if (arm_81(e, _o_78, _f_102, _f_103) == 0) {
        return 0;
      }
      _v_99 = _o_78[0];
      heap_free(e, cls_fit(2), _sp_51);
    } else {
      Term _o_79[1];
      if (arm_79(e, _o_79, _a_351) == 0) {
        return 0;
      }
      _v_99 = _o_79[0];
    }
  break;
  }
  o[0] = _v_99;
  return 1;
}

INLINE Term arm_98(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, u32 r13, u32 r14, u32 r15, Term r16, Term r17) {
  u32 wpoll = 0;
  Term _v_100 = 0;
  u32 _a_352 = r0;
  u32 _a_353 = r1;
  u32 _a_354 = r2;
  u32 _a_355 = r3;
  u32 _a_356 = r4;
  u32 _a_357 = r5;
  u32 _a_358 = r6;
  u32 _a_359 = r7;
  u32 _a_360 = r8;
  u32 _a_361 = r9;
  u32 _a_362 = r10;
  u32 _a_363 = r11;
  u32 _a_364 = r12;
  u32 _a_365 = r13;
  u32 _a_366 = r14;
  u32 _a_367 = r15;
  Term _a_368 = r16;
  Term _a_369 = r17;
  WL_SPIN
    term_sink(e, _a_368);
    if (term_aux(_a_369) == CID_CON) {
      u64 _sp_52 = term_loc(_a_369);
      Term _f_104 = e.mem[_sp_52 + 0];
      Term _f_105 = e.mem[_sp_52 + 1];
      Term _o_81[1];
      if (arm_81(e, _o_81, _f_104, _f_105) == 0) {
        return 0;
      }
      _v_100 = _o_81[0];
      heap_free(e, cls_fit(2), _sp_52);
    } else {
      Term _o_82[1];
      if (arm_79(e, _o_82, _a_369) == 0) {
        return 0;
      }
      _v_100 = _o_82[0];
    }
  break;
  }
  o[0] = _v_100;
  return 1;
}

INLINE Term arm_99(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, u32 r13, u32 r14, u32 r15, u32 r16, Term r17, Term r18) {
  u32 wpoll = 0;
  Term _v_101 = 0;
  u32 _a_370 = r0;
  u32 _a_371 = r1;
  u32 _a_372 = r2;
  u32 _a_373 = r3;
  u32 _a_374 = r4;
  u32 _a_375 = r5;
  u32 _a_376 = r6;
  u32 _a_377 = r7;
  u32 _a_378 = r8;
  u32 _a_379 = r9;
  u32 _a_380 = r10;
  u32 _a_381 = r11;
  u32 _a_382 = r12;
  u32 _a_383 = r13;
  u32 _a_384 = r14;
  u32 _a_385 = r15;
  u32 _a_386 = r16;
  Term _a_387 = r17;
  Term _a_388 = r18;
  WL_SPIN
    term_sink(e, _a_387);
    if (term_aux(_a_388) == CID_CON) {
      u64 _sp_53 = term_loc(_a_388);
      Term _f_106 = e.mem[_sp_53 + 0];
      Term _f_107 = e.mem[_sp_53 + 1];
      Term _o_84[1];
      if (arm_81(e, _o_84, _f_106, _f_107) == 0) {
        return 0;
      }
      _v_101 = _o_84[0];
      heap_free(e, cls_fit(2), _sp_53);
    } else {
      Term _o_85[1];
      if (arm_79(e, _o_85, _a_388) == 0) {
        return 0;
      }
      _v_101 = _o_85[0];
    }
  break;
  }
  o[0] = _v_101;
  return 1;
}

INLINE Term arm_100(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, u32 r13, u32 r14, u32 r15, u32 r16, u32 r17, Term r18, Term r19) {
  u32 wpoll = 0;
  Term _v_102 = 0;
  u32 _a_389 = r0;
  u32 _a_390 = r1;
  u32 _a_391 = r2;
  u32 _a_392 = r3;
  u32 _a_393 = r4;
  u32 _a_394 = r5;
  u32 _a_395 = r6;
  u32 _a_396 = r7;
  u32 _a_397 = r8;
  u32 _a_398 = r9;
  u32 _a_399 = r10;
  u32 _a_400 = r11;
  u32 _a_401 = r12;
  u32 _a_402 = r13;
  u32 _a_403 = r14;
  u32 _a_404 = r15;
  u32 _a_405 = r16;
  u32 _a_406 = r17;
  Term _a_407 = r18;
  Term _a_408 = r19;
  WL_SPIN
    term_sink(e, _a_407);
    if (term_aux(_a_408) == CID_CON) {
      u64 _sp_54 = term_loc(_a_408);
      Term _f_108 = e.mem[_sp_54 + 0];
      Term _f_109 = e.mem[_sp_54 + 1];
      Term _o_87[1];
      if (arm_81(e, _o_87, _f_108, _f_109) == 0) {
        return 0;
      }
      _v_102 = _o_87[0];
      heap_free(e, cls_fit(2), _sp_54);
    } else {
      Term _o_88[1];
      if (arm_79(e, _o_88, _a_408) == 0) {
        return 0;
      }
      _v_102 = _o_88[0];
    }
  break;
  }
  o[0] = _v_102;
  return 1;
}

INLINE Term arm_101(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, u32 r13, u32 r14, u32 r15, u32 r16, u32 r17, u32 r18, Term r19, Term r20) {
  u32 wpoll = 0;
  Term _v_103 = 0;
  u32 _a_409 = r0;
  u32 _a_410 = r1;
  u32 _a_411 = r2;
  u32 _a_412 = r3;
  u32 _a_413 = r4;
  u32 _a_414 = r5;
  u32 _a_415 = r6;
  u32 _a_416 = r7;
  u32 _a_417 = r8;
  u32 _a_418 = r9;
  u32 _a_419 = r10;
  u32 _a_420 = r11;
  u32 _a_421 = r12;
  u32 _a_422 = r13;
  u32 _a_423 = r14;
  u32 _a_424 = r15;
  u32 _a_425 = r16;
  u32 _a_426 = r17;
  u32 _a_427 = r18;
  Term _a_428 = r19;
  Term _a_429 = r20;
  WL_SPIN
    term_sink(e, _a_428);
    if (term_aux(_a_429) == CID_CON) {
      u64 _sp_55 = term_loc(_a_429);
      Term _f_110 = e.mem[_sp_55 + 0];
      Term _f_111 = e.mem[_sp_55 + 1];
      Term _o_90[1];
      if (arm_81(e, _o_90, _f_110, _f_111) == 0) {
        return 0;
      }
      _v_103 = _o_90[0];
      heap_free(e, cls_fit(2), _sp_55);
    } else {
      Term _o_91[1];
      if (arm_79(e, _o_91, _a_429) == 0) {
        return 0;
      }
      _v_103 = _o_91[0];
    }
  break;
  }
  o[0] = _v_103;
  return 1;
}

INLINE Term arm_102(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, u32 r13, u32 r14, u32 r15, u32 r16, u32 r17, u32 r18, u32 r19, Term r20, Term r21) {
  u32 wpoll = 0;
  Term _v_104 = 0;
  u32 _a_430 = r0;
  u32 _a_431 = r1;
  u32 _a_432 = r2;
  u32 _a_433 = r3;
  u32 _a_434 = r4;
  u32 _a_435 = r5;
  u32 _a_436 = r6;
  u32 _a_437 = r7;
  u32 _a_438 = r8;
  u32 _a_439 = r9;
  u32 _a_440 = r10;
  u32 _a_441 = r11;
  u32 _a_442 = r12;
  u32 _a_443 = r13;
  u32 _a_444 = r14;
  u32 _a_445 = r15;
  u32 _a_446 = r16;
  u32 _a_447 = r17;
  u32 _a_448 = r18;
  u32 _a_449 = r19;
  Term _a_450 = r20;
  Term _a_451 = r21;
  WL_SPIN
    term_sink(e, _a_450);
    if (term_aux(_a_451) == CID_CON) {
      u64 _sp_56 = term_loc(_a_451);
      Term _f_112 = e.mem[_sp_56 + 0];
      Term _f_113 = e.mem[_sp_56 + 1];
      Term _o_93[1];
      if (arm_81(e, _o_93, _f_112, _f_113) == 0) {
        return 0;
      }
      _v_104 = _o_93[0];
      heap_free(e, cls_fit(2), _sp_56);
    } else {
      Term _o_94[1];
      if (arm_79(e, _o_94, _a_451) == 0) {
        return 0;
      }
      _v_104 = _o_94[0];
    }
  break;
  }
  o[0] = _v_104;
  return 1;
}

INLINE Term arm_103(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, u32 r13, u32 r14, u32 r15, u32 r16, u32 r17, u32 r18, u32 r19, u32 r20, Term r21, Term r22) {
  u32 wpoll = 0;
  Term _v_105 = 0;
  u32 _a_452 = r0;
  u32 _a_453 = r1;
  u32 _a_454 = r2;
  u32 _a_455 = r3;
  u32 _a_456 = r4;
  u32 _a_457 = r5;
  u32 _a_458 = r6;
  u32 _a_459 = r7;
  u32 _a_460 = r8;
  u32 _a_461 = r9;
  u32 _a_462 = r10;
  u32 _a_463 = r11;
  u32 _a_464 = r12;
  u32 _a_465 = r13;
  u32 _a_466 = r14;
  u32 _a_467 = r15;
  u32 _a_468 = r16;
  u32 _a_469 = r17;
  u32 _a_470 = r18;
  u32 _a_471 = r19;
  u32 _a_472 = r20;
  Term _a_473 = r21;
  Term _a_474 = r22;
  WL_SPIN
    term_sink(e, _a_473);
    if (term_aux(_a_474) == CID_CON) {
      u64 _sp_57 = term_loc(_a_474);
      Term _f_114 = e.mem[_sp_57 + 0];
      Term _f_115 = e.mem[_sp_57 + 1];
      Term _o_96[1];
      if (arm_81(e, _o_96, _f_114, _f_115) == 0) {
        return 0;
      }
      _v_105 = _o_96[0];
      heap_free(e, cls_fit(2), _sp_57);
    } else {
      Term _o_97[1];
      if (arm_79(e, _o_97, _a_474) == 0) {
        return 0;
      }
      _v_105 = _o_97[0];
    }
  break;
  }
  o[0] = _v_105;
  return 1;
}

INLINE Term arm_104(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, u32 r13, u32 r14, u32 r15, u32 r16, u32 r17, u32 r18, u32 r19, u32 r20, u32 r21, Term r22, Term r23) {
  u32 wpoll = 0;
  Term _v_106 = 0;
  u32 _a_475 = r0;
  u32 _a_476 = r1;
  u32 _a_477 = r2;
  u32 _a_478 = r3;
  u32 _a_479 = r4;
  u32 _a_480 = r5;
  u32 _a_481 = r6;
  u32 _a_482 = r7;
  u32 _a_483 = r8;
  u32 _a_484 = r9;
  u32 _a_485 = r10;
  u32 _a_486 = r11;
  u32 _a_487 = r12;
  u32 _a_488 = r13;
  u32 _a_489 = r14;
  u32 _a_490 = r15;
  u32 _a_491 = r16;
  u32 _a_492 = r17;
  u32 _a_493 = r18;
  u32 _a_494 = r19;
  u32 _a_495 = r20;
  u32 _a_496 = r21;
  Term _a_497 = r22;
  Term _a_498 = r23;
  WL_SPIN
    term_sink(e, _a_497);
    if (term_aux(_a_498) == CID_CON) {
      u64 _sp_58 = term_loc(_a_498);
      Term _f_116 = e.mem[_sp_58 + 0];
      Term _f_117 = e.mem[_sp_58 + 1];
      Term _o_99[1];
      if (arm_81(e, _o_99, _f_116, _f_117) == 0) {
        return 0;
      }
      _v_106 = _o_99[0];
      heap_free(e, cls_fit(2), _sp_58);
    } else {
      Term _o_100[1];
      if (arm_79(e, _o_100, _a_498) == 0) {
        return 0;
      }
      _v_106 = _o_100[0];
    }
  break;
  }
  o[0] = _v_106;
  return 1;
}

INLINE Term arm_105(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, u32 r13, u32 r14, u32 r15, u32 r16, u32 r17, u32 r18, u32 r19, u32 r20, u32 r21, u32 r22, Term r23, Term r24) {
  u32 wpoll = 0;
  Term _v_107 = 0;
  u32 _a_499 = r0;
  u32 _a_500 = r1;
  u32 _a_501 = r2;
  u32 _a_502 = r3;
  u32 _a_503 = r4;
  u32 _a_504 = r5;
  u32 _a_505 = r6;
  u32 _a_506 = r7;
  u32 _a_507 = r8;
  u32 _a_508 = r9;
  u32 _a_509 = r10;
  u32 _a_510 = r11;
  u32 _a_511 = r12;
  u32 _a_512 = r13;
  u32 _a_513 = r14;
  u32 _a_514 = r15;
  u32 _a_515 = r16;
  u32 _a_516 = r17;
  u32 _a_517 = r18;
  u32 _a_518 = r19;
  u32 _a_519 = r20;
  u32 _a_520 = r21;
  u32 _a_521 = r22;
  Term _a_522 = r23;
  Term _a_523 = r24;
  WL_SPIN
    term_sink(e, _a_522);
    if (term_aux(_a_523) == CID_CON) {
      u64 _sp_59 = term_loc(_a_523);
      Term _f_118 = e.mem[_sp_59 + 0];
      Term _f_119 = e.mem[_sp_59 + 1];
      Term _o_102[1];
      if (arm_81(e, _o_102, _f_118, _f_119) == 0) {
        return 0;
      }
      _v_107 = _o_102[0];
      heap_free(e, cls_fit(2), _sp_59);
    } else {
      Term _o_103[1];
      if (arm_79(e, _o_103, _a_523) == 0) {
        return 0;
      }
      _v_107 = _o_103[0];
    }
  break;
  }
  o[0] = _v_107;
  return 1;
}

INLINE Term arm_106(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, u32 r13, u32 r14, u32 r15, u32 r16, u32 r17, u32 r18, u32 r19, u32 r20, u32 r21, u32 r22, u32 r23, Term r24, Term r25) {
  u32 wpoll = 0;
  Term _v_108 = 0;
  u32 _a_524 = r0;
  u32 _a_525 = r1;
  u32 _a_526 = r2;
  u32 _a_527 = r3;
  u32 _a_528 = r4;
  u32 _a_529 = r5;
  u32 _a_530 = r6;
  u32 _a_531 = r7;
  u32 _a_532 = r8;
  u32 _a_533 = r9;
  u32 _a_534 = r10;
  u32 _a_535 = r11;
  u32 _a_536 = r12;
  u32 _a_537 = r13;
  u32 _a_538 = r14;
  u32 _a_539 = r15;
  u32 _a_540 = r16;
  u32 _a_541 = r17;
  u32 _a_542 = r18;
  u32 _a_543 = r19;
  u32 _a_544 = r20;
  u32 _a_545 = r21;
  u32 _a_546 = r22;
  u32 _a_547 = r23;
  Term _a_548 = r24;
  Term _a_549 = r25;
  WL_SPIN
    term_sink(e, _a_548);
    if (term_aux(_a_549) == CID_CON) {
      u64 _sp_60 = term_loc(_a_549);
      Term _f_120 = e.mem[_sp_60 + 0];
      Term _f_121 = e.mem[_sp_60 + 1];
      Term _o_105[1];
      if (arm_81(e, _o_105, _f_120, _f_121) == 0) {
        return 0;
      }
      _v_108 = _o_105[0];
      heap_free(e, cls_fit(2), _sp_60);
    } else {
      Term _o_106[1];
      if (arm_79(e, _o_106, _a_549) == 0) {
        return 0;
      }
      _v_108 = _o_106[0];
    }
  break;
  }
  o[0] = _v_108;
  return 1;
}

INLINE Term arm_107(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, u32 r13, u32 r14, u32 r15, u32 r16, u32 r17, u32 r18, u32 r19, u32 r20, u32 r21, u32 r22, u32 r23, u32 r24, Term r25, Term r26) {
  u32 wpoll = 0;
  Term _v_109 = 0;
  u32 _a_550 = r0;
  u32 _a_551 = r1;
  u32 _a_552 = r2;
  u32 _a_553 = r3;
  u32 _a_554 = r4;
  u32 _a_555 = r5;
  u32 _a_556 = r6;
  u32 _a_557 = r7;
  u32 _a_558 = r8;
  u32 _a_559 = r9;
  u32 _a_560 = r10;
  u32 _a_561 = r11;
  u32 _a_562 = r12;
  u32 _a_563 = r13;
  u32 _a_564 = r14;
  u32 _a_565 = r15;
  u32 _a_566 = r16;
  u32 _a_567 = r17;
  u32 _a_568 = r18;
  u32 _a_569 = r19;
  u32 _a_570 = r20;
  u32 _a_571 = r21;
  u32 _a_572 = r22;
  u32 _a_573 = r23;
  u32 _a_574 = r24;
  Term _a_575 = r25;
  Term _a_576 = r26;
  WL_SPIN
    term_sink(e, _a_575);
    if (term_aux(_a_576) == CID_CON) {
      u64 _sp_61 = term_loc(_a_576);
      Term _f_122 = e.mem[_sp_61 + 0];
      Term _f_123 = e.mem[_sp_61 + 1];
      Term _o_108[1];
      if (arm_81(e, _o_108, _f_122, _f_123) == 0) {
        return 0;
      }
      _v_109 = _o_108[0];
      heap_free(e, cls_fit(2), _sp_61);
    } else {
      Term _o_109[1];
      if (arm_79(e, _o_109, _a_576) == 0) {
        return 0;
      }
      _v_109 = _o_109[0];
    }
  break;
  }
  o[0] = _v_109;
  return 1;
}

INLINE Term arm_108(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, u32 r13, u32 r14, u32 r15, u32 r16, u32 r17, u32 r18, u32 r19, u32 r20, u32 r21, u32 r22, u32 r23, u32 r24, u32 r25, Term r26, Term r27) {
  u32 wpoll = 0;
  Term _v_110 = 0;
  u32 _a_577 = r0;
  u32 _a_578 = r1;
  u32 _a_579 = r2;
  u32 _a_580 = r3;
  u32 _a_581 = r4;
  u32 _a_582 = r5;
  u32 _a_583 = r6;
  u32 _a_584 = r7;
  u32 _a_585 = r8;
  u32 _a_586 = r9;
  u32 _a_587 = r10;
  u32 _a_588 = r11;
  u32 _a_589 = r12;
  u32 _a_590 = r13;
  u32 _a_591 = r14;
  u32 _a_592 = r15;
  u32 _a_593 = r16;
  u32 _a_594 = r17;
  u32 _a_595 = r18;
  u32 _a_596 = r19;
  u32 _a_597 = r20;
  u32 _a_598 = r21;
  u32 _a_599 = r22;
  u32 _a_600 = r23;
  u32 _a_601 = r24;
  u32 _a_602 = r25;
  Term _a_603 = r26;
  Term _a_604 = r27;
  WL_SPIN
    term_sink(e, _a_603);
    if (term_aux(_a_604) == CID_CON) {
      u64 _sp_62 = term_loc(_a_604);
      Term _f_124 = e.mem[_sp_62 + 0];
      Term _f_125 = e.mem[_sp_62 + 1];
      Term _o_111[1];
      if (arm_81(e, _o_111, _f_124, _f_125) == 0) {
        return 0;
      }
      _v_110 = _o_111[0];
      heap_free(e, cls_fit(2), _sp_62);
    } else {
      Term _o_112[1];
      if (arm_79(e, _o_112, _a_604) == 0) {
        return 0;
      }
      _v_110 = _o_112[0];
    }
  break;
  }
  o[0] = _v_110;
  return 1;
}

INLINE Term arm_109(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, u32 r13, u32 r14, u32 r15, u32 r16, u32 r17, u32 r18, u32 r19, u32 r20, u32 r21, u32 r22, u32 r23, u32 r24, u32 r25, u32 r26, Term r27, Term r28) {
  u32 wpoll = 0;
  Term _v_111 = 0;
  u32 _a_605 = r0;
  u32 _a_606 = r1;
  u32 _a_607 = r2;
  u32 _a_608 = r3;
  u32 _a_609 = r4;
  u32 _a_610 = r5;
  u32 _a_611 = r6;
  u32 _a_612 = r7;
  u32 _a_613 = r8;
  u32 _a_614 = r9;
  u32 _a_615 = r10;
  u32 _a_616 = r11;
  u32 _a_617 = r12;
  u32 _a_618 = r13;
  u32 _a_619 = r14;
  u32 _a_620 = r15;
  u32 _a_621 = r16;
  u32 _a_622 = r17;
  u32 _a_623 = r18;
  u32 _a_624 = r19;
  u32 _a_625 = r20;
  u32 _a_626 = r21;
  u32 _a_627 = r22;
  u32 _a_628 = r23;
  u32 _a_629 = r24;
  u32 _a_630 = r25;
  u32 _a_631 = r26;
  Term _a_632 = r27;
  Term _a_633 = r28;
  WL_SPIN
    term_sink(e, _a_632);
    if (term_aux(_a_633) == CID_CON) {
      u64 _sp_63 = term_loc(_a_633);
      Term _f_126 = e.mem[_sp_63 + 0];
      Term _f_127 = e.mem[_sp_63 + 1];
      Term _o_114[1];
      if (arm_81(e, _o_114, _f_126, _f_127) == 0) {
        return 0;
      }
      _v_111 = _o_114[0];
      heap_free(e, cls_fit(2), _sp_63);
    } else {
      Term _o_115[1];
      if (arm_79(e, _o_115, _a_633) == 0) {
        return 0;
      }
      _v_111 = _o_115[0];
    }
  break;
  }
  o[0] = _v_111;
  return 1;
}

INLINE Term arm_110(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, u32 r13, u32 r14, u32 r15, u32 r16, u32 r17, u32 r18, u32 r19, u32 r20, u32 r21, u32 r22, u32 r23, u32 r24, u32 r25, u32 r26, u32 r27, Term r28, Term r29) {
  u32 wpoll = 0;
  Term _v_112 = 0;
  u32 _a_634 = r0;
  u32 _a_635 = r1;
  u32 _a_636 = r2;
  u32 _a_637 = r3;
  u32 _a_638 = r4;
  u32 _a_639 = r5;
  u32 _a_640 = r6;
  u32 _a_641 = r7;
  u32 _a_642 = r8;
  u32 _a_643 = r9;
  u32 _a_644 = r10;
  u32 _a_645 = r11;
  u32 _a_646 = r12;
  u32 _a_647 = r13;
  u32 _a_648 = r14;
  u32 _a_649 = r15;
  u32 _a_650 = r16;
  u32 _a_651 = r17;
  u32 _a_652 = r18;
  u32 _a_653 = r19;
  u32 _a_654 = r20;
  u32 _a_655 = r21;
  u32 _a_656 = r22;
  u32 _a_657 = r23;
  u32 _a_658 = r24;
  u32 _a_659 = r25;
  u32 _a_660 = r26;
  u32 _a_661 = r27;
  Term _a_662 = r28;
  Term _a_663 = r29;
  WL_SPIN
    term_sink(e, _a_662);
    if (term_aux(_a_663) == CID_CON) {
      u64 _sp_64 = term_loc(_a_663);
      Term _f_128 = e.mem[_sp_64 + 0];
      Term _f_129 = e.mem[_sp_64 + 1];
      Term _o_117[1];
      if (arm_81(e, _o_117, _f_128, _f_129) == 0) {
        return 0;
      }
      _v_112 = _o_117[0];
      heap_free(e, cls_fit(2), _sp_64);
    } else {
      Term _o_118[1];
      if (arm_79(e, _o_118, _a_663) == 0) {
        return 0;
      }
      _v_112 = _o_118[0];
    }
  break;
  }
  o[0] = _v_112;
  return 1;
}

INLINE Term arm_111(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, u32 r13, u32 r14, u32 r15, u32 r16, u32 r17, u32 r18, u32 r19, u32 r20, u32 r21, u32 r22, u32 r23, u32 r24, u32 r25, u32 r26, u32 r27, u32 r28, Term r29, Term r30) {
  u32 wpoll = 0;
  Term _v_113 = 0;
  u32 _a_664 = r0;
  u32 _a_665 = r1;
  u32 _a_666 = r2;
  u32 _a_667 = r3;
  u32 _a_668 = r4;
  u32 _a_669 = r5;
  u32 _a_670 = r6;
  u32 _a_671 = r7;
  u32 _a_672 = r8;
  u32 _a_673 = r9;
  u32 _a_674 = r10;
  u32 _a_675 = r11;
  u32 _a_676 = r12;
  u32 _a_677 = r13;
  u32 _a_678 = r14;
  u32 _a_679 = r15;
  u32 _a_680 = r16;
  u32 _a_681 = r17;
  u32 _a_682 = r18;
  u32 _a_683 = r19;
  u32 _a_684 = r20;
  u32 _a_685 = r21;
  u32 _a_686 = r22;
  u32 _a_687 = r23;
  u32 _a_688 = r24;
  u32 _a_689 = r25;
  u32 _a_690 = r26;
  u32 _a_691 = r27;
  u32 _a_692 = r28;
  Term _a_693 = r29;
  Term _a_694 = r30;
  WL_SPIN
    term_sink(e, _a_693);
    if (term_aux(_a_694) == CID_CON) {
      u64 _sp_65 = term_loc(_a_694);
      Term _f_130 = e.mem[_sp_65 + 0];
      Term _f_131 = e.mem[_sp_65 + 1];
      Term _o_120[1];
      if (arm_81(e, _o_120, _f_130, _f_131) == 0) {
        return 0;
      }
      _v_113 = _o_120[0];
      heap_free(e, cls_fit(2), _sp_65);
    } else {
      Term _o_121[1];
      if (arm_79(e, _o_121, _a_694) == 0) {
        return 0;
      }
      _v_113 = _o_121[0];
    }
  break;
  }
  o[0] = _v_113;
  return 1;
}

INLINE Term arm_112(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, u32 r13, u32 r14, u32 r15, u32 r16, u32 r17, u32 r18, u32 r19, u32 r20, u32 r21, u32 r22, u32 r23, u32 r24, u32 r25, u32 r26, u32 r27, u32 r28, u32 r29, Term r30, Term r31) {
  u32 wpoll = 0;
  Term _v_114 = 0;
  u32 _a_695 = r0;
  u32 _a_696 = r1;
  u32 _a_697 = r2;
  u32 _a_698 = r3;
  u32 _a_699 = r4;
  u32 _a_700 = r5;
  u32 _a_701 = r6;
  u32 _a_702 = r7;
  u32 _a_703 = r8;
  u32 _a_704 = r9;
  u32 _a_705 = r10;
  u32 _a_706 = r11;
  u32 _a_707 = r12;
  u32 _a_708 = r13;
  u32 _a_709 = r14;
  u32 _a_710 = r15;
  u32 _a_711 = r16;
  u32 _a_712 = r17;
  u32 _a_713 = r18;
  u32 _a_714 = r19;
  u32 _a_715 = r20;
  u32 _a_716 = r21;
  u32 _a_717 = r22;
  u32 _a_718 = r23;
  u32 _a_719 = r24;
  u32 _a_720 = r25;
  u32 _a_721 = r26;
  u32 _a_722 = r27;
  u32 _a_723 = r28;
  u32 _a_724 = r29;
  Term _a_725 = r30;
  Term _a_726 = r31;
  WL_SPIN
    term_sink(e, _a_725);
    if (term_aux(_a_726) == CID_CON) {
      u64 _sp_66 = term_loc(_a_726);
      Term _f_132 = e.mem[_sp_66 + 0];
      Term _f_133 = e.mem[_sp_66 + 1];
      Term _o_123[1];
      if (arm_81(e, _o_123, _f_132, _f_133) == 0) {
        return 0;
      }
      _v_114 = _o_123[0];
      heap_free(e, cls_fit(2), _sp_66);
    } else {
      Term _o_124[1];
      if (arm_79(e, _o_124, _a_726) == 0) {
        return 0;
      }
      _v_114 = _o_124[0];
    }
  break;
  }
  o[0] = _v_114;
  return 1;
}

INLINE Term arm_113(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, u32 r13, u32 r14, u32 r15, u32 r16, u32 r17, u32 r18, u32 r19, u32 r20, u32 r21, u32 r22, u32 r23, u32 r24, u32 r25, u32 r26, u32 r27, u32 r28, u32 r29, u32 r30, Term r31, Term r32) {
  u32 wpoll = 0;
  Term _v_115 = 0;
  u32 _a_727 = r0;
  u32 _a_728 = r1;
  u32 _a_729 = r2;
  u32 _a_730 = r3;
  u32 _a_731 = r4;
  u32 _a_732 = r5;
  u32 _a_733 = r6;
  u32 _a_734 = r7;
  u32 _a_735 = r8;
  u32 _a_736 = r9;
  u32 _a_737 = r10;
  u32 _a_738 = r11;
  u32 _a_739 = r12;
  u32 _a_740 = r13;
  u32 _a_741 = r14;
  u32 _a_742 = r15;
  u32 _a_743 = r16;
  u32 _a_744 = r17;
  u32 _a_745 = r18;
  u32 _a_746 = r19;
  u32 _a_747 = r20;
  u32 _a_748 = r21;
  u32 _a_749 = r22;
  u32 _a_750 = r23;
  u32 _a_751 = r24;
  u32 _a_752 = r25;
  u32 _a_753 = r26;
  u32 _a_754 = r27;
  u32 _a_755 = r28;
  u32 _a_756 = r29;
  u32 _a_757 = r30;
  Term _a_758 = r31;
  Term _a_759 = r32;
  WL_SPIN
    term_sink(e, _a_758);
    if (term_aux(_a_759) == CID_CON) {
      u64 _sp_67 = term_loc(_a_759);
      Term _f_134 = e.mem[_sp_67 + 0];
      Term _f_135 = e.mem[_sp_67 + 1];
      Term _o_126[1];
      if (arm_81(e, _o_126, _f_134, _f_135) == 0) {
        return 0;
      }
      _v_115 = _o_126[0];
      heap_free(e, cls_fit(2), _sp_67);
    } else {
      Term _o_127[1];
      if (arm_79(e, _o_127, _a_759) == 0) {
        return 0;
      }
      _v_115 = _o_127[0];
    }
  break;
  }
  o[0] = _v_115;
  return 1;
}

INLINE Term arm_114(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, u32 r13, u32 r14, u32 r15, u32 r16, u32 r17, u32 r18, u32 r19, u32 r20, u32 r21, u32 r22, u32 r23, u32 r24, u32 r25, u32 r26, u32 r27, u32 r28, u32 r29, u32 r30, u32 r31, Term r32, Term r33) {
  u32 wpoll = 0;
  Term _v_116 = 0;
  u32 _a_760 = r0;
  u32 _a_761 = r1;
  u32 _a_762 = r2;
  u32 _a_763 = r3;
  u32 _a_764 = r4;
  u32 _a_765 = r5;
  u32 _a_766 = r6;
  u32 _a_767 = r7;
  u32 _a_768 = r8;
  u32 _a_769 = r9;
  u32 _a_770 = r10;
  u32 _a_771 = r11;
  u32 _a_772 = r12;
  u32 _a_773 = r13;
  u32 _a_774 = r14;
  u32 _a_775 = r15;
  u32 _a_776 = r16;
  u32 _a_777 = r17;
  u32 _a_778 = r18;
  u32 _a_779 = r19;
  u32 _a_780 = r20;
  u32 _a_781 = r21;
  u32 _a_782 = r22;
  u32 _a_783 = r23;
  u32 _a_784 = r24;
  u32 _a_785 = r25;
  u32 _a_786 = r26;
  u32 _a_787 = r27;
  u32 _a_788 = r28;
  u32 _a_789 = r29;
  u32 _a_790 = r30;
  u32 _a_791 = r31;
  Term _a_792 = r32;
  Term _a_793 = r33;
  WL_SPIN
    term_sink(e, _a_792);
    if (term_aux(_a_793) == CID_CON) {
      u64 _sp_68 = term_loc(_a_793);
      Term _f_136 = e.mem[_sp_68 + 0];
      Term _f_137 = e.mem[_sp_68 + 1];
      Term _o_129[1];
      if (arm_81(e, _o_129, _f_136, _f_137) == 0) {
        return 0;
      }
      _v_116 = _o_129[0];
      heap_free(e, cls_fit(2), _sp_68);
    } else {
      Term _o_130[1];
      if (arm_79(e, _o_130, _a_793) == 0) {
        return 0;
      }
      _v_116 = _o_130[0];
    }
  break;
  }
  o[0] = _v_116;
  return 1;
}

INLINE Term arm_62(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_62 = 0;
  u32 _a_165 = r0;
  Term _a_166 = r1;
  Term _a_167 = r2;
  WL_SPIN
    if (_a_165 == 114) {
      Term _o_35[1];
      if (arm_63(e, _o_35, _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_35[0];
    } else if ((_a_165 & 2147483647) == 114) {
      Term _o_38[1];
      if (arm_83(e, _o_38, ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_38[0];
    } else if ((_a_165 & 1073741823) == 114) {
      Term _o_41[1];
      if (arm_84(e, _o_41, ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_41[0];
    } else if ((_a_165 & 536870911) == 114) {
      Term _o_44[1];
      if (arm_85(e, _o_44, ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_44[0];
    } else if ((_a_165 & 268435455) == 114) {
      Term _o_47[1];
      if (arm_86(e, _o_47, ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_47[0];
    } else if ((_a_165 & 134217727) == 114) {
      Term _o_50[1];
      if (arm_87(e, _o_50, ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_50[0];
    } else if ((_a_165 & 67108863) == 114) {
      Term _o_53[1];
      if (arm_88(e, _o_53, ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_53[0];
    } else if ((_a_165 & 33554431) == 114) {
      Term _o_56[1];
      if (arm_89(e, _o_56, ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_56[0];
    } else if ((_a_165 & 16777215) == 114) {
      Term _o_59[1];
      if (arm_90(e, _o_59, ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_59[0];
    } else if ((_a_165 & 8388607) == 114) {
      Term _o_62[1];
      if (arm_91(e, _o_62, ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_62[0];
    } else if ((_a_165 & 4194303) == 114) {
      Term _o_65[1];
      if (arm_92(e, _o_65, ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_65[0];
    } else if ((_a_165 & 2097151) == 114) {
      Term _o_68[1];
      if (arm_93(e, _o_68, ((_a_165 >> 21) & 1), ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_68[0];
    } else if ((_a_165 & 1048575) == 114) {
      Term _o_71[1];
      if (arm_94(e, _o_71, ((_a_165 >> 20) & 1), ((_a_165 >> 21) & 1), ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_71[0];
    } else if ((_a_165 & 524287) == 114) {
      Term _o_74[1];
      if (arm_95(e, _o_74, ((_a_165 >> 19) & 1), ((_a_165 >> 20) & 1), ((_a_165 >> 21) & 1), ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_74[0];
    } else if ((_a_165 & 262143) == 114) {
      Term _o_77[1];
      if (arm_96(e, _o_77, ((_a_165 >> 18) & 1), ((_a_165 >> 19) & 1), ((_a_165 >> 20) & 1), ((_a_165 >> 21) & 1), ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_77[0];
    } else if ((_a_165 & 131071) == 114) {
      Term _o_80[1];
      if (arm_97(e, _o_80, ((_a_165 >> 17) & 1), ((_a_165 >> 18) & 1), ((_a_165 >> 19) & 1), ((_a_165 >> 20) & 1), ((_a_165 >> 21) & 1), ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_80[0];
    } else if ((_a_165 & 65535) == 114) {
      Term _o_83[1];
      if (arm_98(e, _o_83, ((_a_165 >> 16) & 1), ((_a_165 >> 17) & 1), ((_a_165 >> 18) & 1), ((_a_165 >> 19) & 1), ((_a_165 >> 20) & 1), ((_a_165 >> 21) & 1), ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_83[0];
    } else if ((_a_165 & 32767) == 114) {
      Term _o_86[1];
      if (arm_99(e, _o_86, ((_a_165 >> 15) & 1), ((_a_165 >> 16) & 1), ((_a_165 >> 17) & 1), ((_a_165 >> 18) & 1), ((_a_165 >> 19) & 1), ((_a_165 >> 20) & 1), ((_a_165 >> 21) & 1), ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_86[0];
    } else if ((_a_165 & 16383) == 114) {
      Term _o_89[1];
      if (arm_100(e, _o_89, ((_a_165 >> 14) & 1), ((_a_165 >> 15) & 1), ((_a_165 >> 16) & 1), ((_a_165 >> 17) & 1), ((_a_165 >> 18) & 1), ((_a_165 >> 19) & 1), ((_a_165 >> 20) & 1), ((_a_165 >> 21) & 1), ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_89[0];
    } else if ((_a_165 & 8191) == 114) {
      Term _o_92[1];
      if (arm_101(e, _o_92, ((_a_165 >> 13) & 1), ((_a_165 >> 14) & 1), ((_a_165 >> 15) & 1), ((_a_165 >> 16) & 1), ((_a_165 >> 17) & 1), ((_a_165 >> 18) & 1), ((_a_165 >> 19) & 1), ((_a_165 >> 20) & 1), ((_a_165 >> 21) & 1), ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_92[0];
    } else if ((_a_165 & 4095) == 114) {
      Term _o_95[1];
      if (arm_102(e, _o_95, ((_a_165 >> 12) & 1), ((_a_165 >> 13) & 1), ((_a_165 >> 14) & 1), ((_a_165 >> 15) & 1), ((_a_165 >> 16) & 1), ((_a_165 >> 17) & 1), ((_a_165 >> 18) & 1), ((_a_165 >> 19) & 1), ((_a_165 >> 20) & 1), ((_a_165 >> 21) & 1), ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_95[0];
    } else if ((_a_165 & 2047) == 114) {
      Term _o_98[1];
      if (arm_103(e, _o_98, ((_a_165 >> 11) & 1), ((_a_165 >> 12) & 1), ((_a_165 >> 13) & 1), ((_a_165 >> 14) & 1), ((_a_165 >> 15) & 1), ((_a_165 >> 16) & 1), ((_a_165 >> 17) & 1), ((_a_165 >> 18) & 1), ((_a_165 >> 19) & 1), ((_a_165 >> 20) & 1), ((_a_165 >> 21) & 1), ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_98[0];
    } else if ((_a_165 & 1023) == 114) {
      Term _o_101[1];
      if (arm_104(e, _o_101, ((_a_165 >> 10) & 1), ((_a_165 >> 11) & 1), ((_a_165 >> 12) & 1), ((_a_165 >> 13) & 1), ((_a_165 >> 14) & 1), ((_a_165 >> 15) & 1), ((_a_165 >> 16) & 1), ((_a_165 >> 17) & 1), ((_a_165 >> 18) & 1), ((_a_165 >> 19) & 1), ((_a_165 >> 20) & 1), ((_a_165 >> 21) & 1), ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_101[0];
    } else if ((_a_165 & 511) == 114) {
      Term _o_104[1];
      if (arm_105(e, _o_104, ((_a_165 >> 9) & 1), ((_a_165 >> 10) & 1), ((_a_165 >> 11) & 1), ((_a_165 >> 12) & 1), ((_a_165 >> 13) & 1), ((_a_165 >> 14) & 1), ((_a_165 >> 15) & 1), ((_a_165 >> 16) & 1), ((_a_165 >> 17) & 1), ((_a_165 >> 18) & 1), ((_a_165 >> 19) & 1), ((_a_165 >> 20) & 1), ((_a_165 >> 21) & 1), ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_104[0];
    } else if ((_a_165 & 255) == 114) {
      Term _o_107[1];
      if (arm_106(e, _o_107, ((_a_165 >> 8) & 1), ((_a_165 >> 9) & 1), ((_a_165 >> 10) & 1), ((_a_165 >> 11) & 1), ((_a_165 >> 12) & 1), ((_a_165 >> 13) & 1), ((_a_165 >> 14) & 1), ((_a_165 >> 15) & 1), ((_a_165 >> 16) & 1), ((_a_165 >> 17) & 1), ((_a_165 >> 18) & 1), ((_a_165 >> 19) & 1), ((_a_165 >> 20) & 1), ((_a_165 >> 21) & 1), ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_107[0];
    } else if ((_a_165 & 127) == 114) {
      Term _o_110[1];
      if (arm_107(e, _o_110, ((_a_165 >> 7) & 1), ((_a_165 >> 8) & 1), ((_a_165 >> 9) & 1), ((_a_165 >> 10) & 1), ((_a_165 >> 11) & 1), ((_a_165 >> 12) & 1), ((_a_165 >> 13) & 1), ((_a_165 >> 14) & 1), ((_a_165 >> 15) & 1), ((_a_165 >> 16) & 1), ((_a_165 >> 17) & 1), ((_a_165 >> 18) & 1), ((_a_165 >> 19) & 1), ((_a_165 >> 20) & 1), ((_a_165 >> 21) & 1), ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_110[0];
    } else if ((_a_165 & 63) == 50) {
      Term _o_113[1];
      if (arm_108(e, _o_113, ((_a_165 >> 6) & 1), ((_a_165 >> 7) & 1), ((_a_165 >> 8) & 1), ((_a_165 >> 9) & 1), ((_a_165 >> 10) & 1), ((_a_165 >> 11) & 1), ((_a_165 >> 12) & 1), ((_a_165 >> 13) & 1), ((_a_165 >> 14) & 1), ((_a_165 >> 15) & 1), ((_a_165 >> 16) & 1), ((_a_165 >> 17) & 1), ((_a_165 >> 18) & 1), ((_a_165 >> 19) & 1), ((_a_165 >> 20) & 1), ((_a_165 >> 21) & 1), ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_113[0];
    } else if ((_a_165 & 31) == 18) {
      Term _o_116[1];
      if (arm_109(e, _o_116, ((_a_165 >> 5) & 1), ((_a_165 >> 6) & 1), ((_a_165 >> 7) & 1), ((_a_165 >> 8) & 1), ((_a_165 >> 9) & 1), ((_a_165 >> 10) & 1), ((_a_165 >> 11) & 1), ((_a_165 >> 12) & 1), ((_a_165 >> 13) & 1), ((_a_165 >> 14) & 1), ((_a_165 >> 15) & 1), ((_a_165 >> 16) & 1), ((_a_165 >> 17) & 1), ((_a_165 >> 18) & 1), ((_a_165 >> 19) & 1), ((_a_165 >> 20) & 1), ((_a_165 >> 21) & 1), ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_116[0];
    } else if ((_a_165 & 15) == 2) {
      Term _o_119[1];
      if (arm_110(e, _o_119, ((_a_165 >> 4) & 1), ((_a_165 >> 5) & 1), ((_a_165 >> 6) & 1), ((_a_165 >> 7) & 1), ((_a_165 >> 8) & 1), ((_a_165 >> 9) & 1), ((_a_165 >> 10) & 1), ((_a_165 >> 11) & 1), ((_a_165 >> 12) & 1), ((_a_165 >> 13) & 1), ((_a_165 >> 14) & 1), ((_a_165 >> 15) & 1), ((_a_165 >> 16) & 1), ((_a_165 >> 17) & 1), ((_a_165 >> 18) & 1), ((_a_165 >> 19) & 1), ((_a_165 >> 20) & 1), ((_a_165 >> 21) & 1), ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_119[0];
    } else if ((_a_165 & 7) == 2) {
      Term _o_122[1];
      if (arm_111(e, _o_122, ((_a_165 >> 3) & 1), ((_a_165 >> 4) & 1), ((_a_165 >> 5) & 1), ((_a_165 >> 6) & 1), ((_a_165 >> 7) & 1), ((_a_165 >> 8) & 1), ((_a_165 >> 9) & 1), ((_a_165 >> 10) & 1), ((_a_165 >> 11) & 1), ((_a_165 >> 12) & 1), ((_a_165 >> 13) & 1), ((_a_165 >> 14) & 1), ((_a_165 >> 15) & 1), ((_a_165 >> 16) & 1), ((_a_165 >> 17) & 1), ((_a_165 >> 18) & 1), ((_a_165 >> 19) & 1), ((_a_165 >> 20) & 1), ((_a_165 >> 21) & 1), ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_122[0];
    } else if ((_a_165 & 3) == 2) {
      Term _o_125[1];
      if (arm_112(e, _o_125, ((_a_165 >> 2) & 1), ((_a_165 >> 3) & 1), ((_a_165 >> 4) & 1), ((_a_165 >> 5) & 1), ((_a_165 >> 6) & 1), ((_a_165 >> 7) & 1), ((_a_165 >> 8) & 1), ((_a_165 >> 9) & 1), ((_a_165 >> 10) & 1), ((_a_165 >> 11) & 1), ((_a_165 >> 12) & 1), ((_a_165 >> 13) & 1), ((_a_165 >> 14) & 1), ((_a_165 >> 15) & 1), ((_a_165 >> 16) & 1), ((_a_165 >> 17) & 1), ((_a_165 >> 18) & 1), ((_a_165 >> 19) & 1), ((_a_165 >> 20) & 1), ((_a_165 >> 21) & 1), ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_125[0];
    } else if ((_a_165 & 1) == 0) {
      Term _o_128[1];
      if (arm_113(e, _o_128, ((_a_165 >> 1) & 1), ((_a_165 >> 2) & 1), ((_a_165 >> 3) & 1), ((_a_165 >> 4) & 1), ((_a_165 >> 5) & 1), ((_a_165 >> 6) & 1), ((_a_165 >> 7) & 1), ((_a_165 >> 8) & 1), ((_a_165 >> 9) & 1), ((_a_165 >> 10) & 1), ((_a_165 >> 11) & 1), ((_a_165 >> 12) & 1), ((_a_165 >> 13) & 1), ((_a_165 >> 14) & 1), ((_a_165 >> 15) & 1), ((_a_165 >> 16) & 1), ((_a_165 >> 17) & 1), ((_a_165 >> 18) & 1), ((_a_165 >> 19) & 1), ((_a_165 >> 20) & 1), ((_a_165 >> 21) & 1), ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_128[0];
    } else {
      Term _o_131[1];
      if (arm_114(e, _o_131, ((_a_165 >> 0) & 1), ((_a_165 >> 1) & 1), ((_a_165 >> 2) & 1), ((_a_165 >> 3) & 1), ((_a_165 >> 4) & 1), ((_a_165 >> 5) & 1), ((_a_165 >> 6) & 1), ((_a_165 >> 7) & 1), ((_a_165 >> 8) & 1), ((_a_165 >> 9) & 1), ((_a_165 >> 10) & 1), ((_a_165 >> 11) & 1), ((_a_165 >> 12) & 1), ((_a_165 >> 13) & 1), ((_a_165 >> 14) & 1), ((_a_165 >> 15) & 1), ((_a_165 >> 16) & 1), ((_a_165 >> 17) & 1), ((_a_165 >> 18) & 1), ((_a_165 >> 19) & 1), ((_a_165 >> 20) & 1), ((_a_165 >> 21) & 1), ((_a_165 >> 22) & 1), ((_a_165 >> 23) & 1), ((_a_165 >> 24) & 1), ((_a_165 >> 25) & 1), ((_a_165 >> 26) & 1), ((_a_165 >> 27) & 1), ((_a_165 >> 28) & 1), ((_a_165 >> 29) & 1), ((_a_165 >> 30) & 1), ((_a_165 >> 31) & 1), _a_166, _a_167) == 0) {
        return 0;
      }
      _v_62 = _o_131[0];
    }
  break;
  }
  o[0] = _v_62;
  return 1;
}

INLINE Term arm_61(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_61 = 0;
  u32 _a_162 = r0;
  Term _a_163 = r1;
  Term _a_164 = r2;
  WL_SPIN
    Term _o_132[1];
    if (arm_62(e, _o_132, _a_162, _a_163, _a_164) == 0) {
      return 0;
    }
    _v_61 = _o_132[0];
  break;
  }
  o[0] = _v_61;
  return 1;
}

INLINE Term arm_60(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_60 = 0;
  Term _a_160 = r0;
  Term _a_161 = r1;
  WL_SPIN
    if (term_aux(_a_160) == CID_SCON) {
      Term _fb_20[2];
      u64 _sp_21 = ctr_take(e, _a_160, 2, _fb_20);
      u32 _f_42 = _fb_20[0];
      Term _f_43 = _fb_20[1];
      Term _o_133[1];
      if (arm_61(e, _o_133, _f_42, _f_43, _a_161) == 0) {
        return 0;
      }
      _v_60 = _o_133[0];
      spare_free(e, cls_fit(2), _sp_21);
    } else {
      Term _o_134[1];
      if (arm_80(e, _o_134, _a_160, _a_161) == 0) {
        return 0;
      }
      _v_60 = _o_134[0];
    }
  break;
  }
  o[0] = _v_60;
  return 1;
}

INLINE Term arm_59(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_59 = 0;
  u32 _a_157 = r0;
  Term _a_158 = r1;
  Term _a_159 = r2;
  WL_SPIN
    if (_a_157 == 101) {
      Term _o_135[1];
      if (arm_60(e, _o_135, _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_135[0];
    } else if ((_a_157 & 2147483647) == 101) {
      Term _o_136[1];
      if (arm_83(e, _o_136, ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_136[0];
    } else if ((_a_157 & 1073741823) == 101) {
      Term _o_137[1];
      if (arm_84(e, _o_137, ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_137[0];
    } else if ((_a_157 & 536870911) == 101) {
      Term _o_138[1];
      if (arm_85(e, _o_138, ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_138[0];
    } else if ((_a_157 & 268435455) == 101) {
      Term _o_139[1];
      if (arm_86(e, _o_139, ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_139[0];
    } else if ((_a_157 & 134217727) == 101) {
      Term _o_140[1];
      if (arm_87(e, _o_140, ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_140[0];
    } else if ((_a_157 & 67108863) == 101) {
      Term _o_141[1];
      if (arm_88(e, _o_141, ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_141[0];
    } else if ((_a_157 & 33554431) == 101) {
      Term _o_142[1];
      if (arm_89(e, _o_142, ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_142[0];
    } else if ((_a_157 & 16777215) == 101) {
      Term _o_143[1];
      if (arm_90(e, _o_143, ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_143[0];
    } else if ((_a_157 & 8388607) == 101) {
      Term _o_144[1];
      if (arm_91(e, _o_144, ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_144[0];
    } else if ((_a_157 & 4194303) == 101) {
      Term _o_145[1];
      if (arm_92(e, _o_145, ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_145[0];
    } else if ((_a_157 & 2097151) == 101) {
      Term _o_146[1];
      if (arm_93(e, _o_146, ((_a_157 >> 21) & 1), ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_146[0];
    } else if ((_a_157 & 1048575) == 101) {
      Term _o_147[1];
      if (arm_94(e, _o_147, ((_a_157 >> 20) & 1), ((_a_157 >> 21) & 1), ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_147[0];
    } else if ((_a_157 & 524287) == 101) {
      Term _o_148[1];
      if (arm_95(e, _o_148, ((_a_157 >> 19) & 1), ((_a_157 >> 20) & 1), ((_a_157 >> 21) & 1), ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_148[0];
    } else if ((_a_157 & 262143) == 101) {
      Term _o_149[1];
      if (arm_96(e, _o_149, ((_a_157 >> 18) & 1), ((_a_157 >> 19) & 1), ((_a_157 >> 20) & 1), ((_a_157 >> 21) & 1), ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_149[0];
    } else if ((_a_157 & 131071) == 101) {
      Term _o_150[1];
      if (arm_97(e, _o_150, ((_a_157 >> 17) & 1), ((_a_157 >> 18) & 1), ((_a_157 >> 19) & 1), ((_a_157 >> 20) & 1), ((_a_157 >> 21) & 1), ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_150[0];
    } else if ((_a_157 & 65535) == 101) {
      Term _o_151[1];
      if (arm_98(e, _o_151, ((_a_157 >> 16) & 1), ((_a_157 >> 17) & 1), ((_a_157 >> 18) & 1), ((_a_157 >> 19) & 1), ((_a_157 >> 20) & 1), ((_a_157 >> 21) & 1), ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_151[0];
    } else if ((_a_157 & 32767) == 101) {
      Term _o_152[1];
      if (arm_99(e, _o_152, ((_a_157 >> 15) & 1), ((_a_157 >> 16) & 1), ((_a_157 >> 17) & 1), ((_a_157 >> 18) & 1), ((_a_157 >> 19) & 1), ((_a_157 >> 20) & 1), ((_a_157 >> 21) & 1), ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_152[0];
    } else if ((_a_157 & 16383) == 101) {
      Term _o_153[1];
      if (arm_100(e, _o_153, ((_a_157 >> 14) & 1), ((_a_157 >> 15) & 1), ((_a_157 >> 16) & 1), ((_a_157 >> 17) & 1), ((_a_157 >> 18) & 1), ((_a_157 >> 19) & 1), ((_a_157 >> 20) & 1), ((_a_157 >> 21) & 1), ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_153[0];
    } else if ((_a_157 & 8191) == 101) {
      Term _o_154[1];
      if (arm_101(e, _o_154, ((_a_157 >> 13) & 1), ((_a_157 >> 14) & 1), ((_a_157 >> 15) & 1), ((_a_157 >> 16) & 1), ((_a_157 >> 17) & 1), ((_a_157 >> 18) & 1), ((_a_157 >> 19) & 1), ((_a_157 >> 20) & 1), ((_a_157 >> 21) & 1), ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_154[0];
    } else if ((_a_157 & 4095) == 101) {
      Term _o_155[1];
      if (arm_102(e, _o_155, ((_a_157 >> 12) & 1), ((_a_157 >> 13) & 1), ((_a_157 >> 14) & 1), ((_a_157 >> 15) & 1), ((_a_157 >> 16) & 1), ((_a_157 >> 17) & 1), ((_a_157 >> 18) & 1), ((_a_157 >> 19) & 1), ((_a_157 >> 20) & 1), ((_a_157 >> 21) & 1), ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_155[0];
    } else if ((_a_157 & 2047) == 101) {
      Term _o_156[1];
      if (arm_103(e, _o_156, ((_a_157 >> 11) & 1), ((_a_157 >> 12) & 1), ((_a_157 >> 13) & 1), ((_a_157 >> 14) & 1), ((_a_157 >> 15) & 1), ((_a_157 >> 16) & 1), ((_a_157 >> 17) & 1), ((_a_157 >> 18) & 1), ((_a_157 >> 19) & 1), ((_a_157 >> 20) & 1), ((_a_157 >> 21) & 1), ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_156[0];
    } else if ((_a_157 & 1023) == 101) {
      Term _o_157[1];
      if (arm_104(e, _o_157, ((_a_157 >> 10) & 1), ((_a_157 >> 11) & 1), ((_a_157 >> 12) & 1), ((_a_157 >> 13) & 1), ((_a_157 >> 14) & 1), ((_a_157 >> 15) & 1), ((_a_157 >> 16) & 1), ((_a_157 >> 17) & 1), ((_a_157 >> 18) & 1), ((_a_157 >> 19) & 1), ((_a_157 >> 20) & 1), ((_a_157 >> 21) & 1), ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_157[0];
    } else if ((_a_157 & 511) == 101) {
      Term _o_158[1];
      if (arm_105(e, _o_158, ((_a_157 >> 9) & 1), ((_a_157 >> 10) & 1), ((_a_157 >> 11) & 1), ((_a_157 >> 12) & 1), ((_a_157 >> 13) & 1), ((_a_157 >> 14) & 1), ((_a_157 >> 15) & 1), ((_a_157 >> 16) & 1), ((_a_157 >> 17) & 1), ((_a_157 >> 18) & 1), ((_a_157 >> 19) & 1), ((_a_157 >> 20) & 1), ((_a_157 >> 21) & 1), ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_158[0];
    } else if ((_a_157 & 255) == 101) {
      Term _o_159[1];
      if (arm_106(e, _o_159, ((_a_157 >> 8) & 1), ((_a_157 >> 9) & 1), ((_a_157 >> 10) & 1), ((_a_157 >> 11) & 1), ((_a_157 >> 12) & 1), ((_a_157 >> 13) & 1), ((_a_157 >> 14) & 1), ((_a_157 >> 15) & 1), ((_a_157 >> 16) & 1), ((_a_157 >> 17) & 1), ((_a_157 >> 18) & 1), ((_a_157 >> 19) & 1), ((_a_157 >> 20) & 1), ((_a_157 >> 21) & 1), ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_159[0];
    } else if ((_a_157 & 127) == 101) {
      Term _o_160[1];
      if (arm_107(e, _o_160, ((_a_157 >> 7) & 1), ((_a_157 >> 8) & 1), ((_a_157 >> 9) & 1), ((_a_157 >> 10) & 1), ((_a_157 >> 11) & 1), ((_a_157 >> 12) & 1), ((_a_157 >> 13) & 1), ((_a_157 >> 14) & 1), ((_a_157 >> 15) & 1), ((_a_157 >> 16) & 1), ((_a_157 >> 17) & 1), ((_a_157 >> 18) & 1), ((_a_157 >> 19) & 1), ((_a_157 >> 20) & 1), ((_a_157 >> 21) & 1), ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_160[0];
    } else if ((_a_157 & 63) == 37) {
      Term _o_161[1];
      if (arm_108(e, _o_161, ((_a_157 >> 6) & 1), ((_a_157 >> 7) & 1), ((_a_157 >> 8) & 1), ((_a_157 >> 9) & 1), ((_a_157 >> 10) & 1), ((_a_157 >> 11) & 1), ((_a_157 >> 12) & 1), ((_a_157 >> 13) & 1), ((_a_157 >> 14) & 1), ((_a_157 >> 15) & 1), ((_a_157 >> 16) & 1), ((_a_157 >> 17) & 1), ((_a_157 >> 18) & 1), ((_a_157 >> 19) & 1), ((_a_157 >> 20) & 1), ((_a_157 >> 21) & 1), ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_161[0];
    } else if ((_a_157 & 31) == 5) {
      Term _o_162[1];
      if (arm_109(e, _o_162, ((_a_157 >> 5) & 1), ((_a_157 >> 6) & 1), ((_a_157 >> 7) & 1), ((_a_157 >> 8) & 1), ((_a_157 >> 9) & 1), ((_a_157 >> 10) & 1), ((_a_157 >> 11) & 1), ((_a_157 >> 12) & 1), ((_a_157 >> 13) & 1), ((_a_157 >> 14) & 1), ((_a_157 >> 15) & 1), ((_a_157 >> 16) & 1), ((_a_157 >> 17) & 1), ((_a_157 >> 18) & 1), ((_a_157 >> 19) & 1), ((_a_157 >> 20) & 1), ((_a_157 >> 21) & 1), ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_162[0];
    } else if ((_a_157 & 15) == 5) {
      Term _o_163[1];
      if (arm_110(e, _o_163, ((_a_157 >> 4) & 1), ((_a_157 >> 5) & 1), ((_a_157 >> 6) & 1), ((_a_157 >> 7) & 1), ((_a_157 >> 8) & 1), ((_a_157 >> 9) & 1), ((_a_157 >> 10) & 1), ((_a_157 >> 11) & 1), ((_a_157 >> 12) & 1), ((_a_157 >> 13) & 1), ((_a_157 >> 14) & 1), ((_a_157 >> 15) & 1), ((_a_157 >> 16) & 1), ((_a_157 >> 17) & 1), ((_a_157 >> 18) & 1), ((_a_157 >> 19) & 1), ((_a_157 >> 20) & 1), ((_a_157 >> 21) & 1), ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_163[0];
    } else if ((_a_157 & 7) == 5) {
      Term _o_164[1];
      if (arm_111(e, _o_164, ((_a_157 >> 3) & 1), ((_a_157 >> 4) & 1), ((_a_157 >> 5) & 1), ((_a_157 >> 6) & 1), ((_a_157 >> 7) & 1), ((_a_157 >> 8) & 1), ((_a_157 >> 9) & 1), ((_a_157 >> 10) & 1), ((_a_157 >> 11) & 1), ((_a_157 >> 12) & 1), ((_a_157 >> 13) & 1), ((_a_157 >> 14) & 1), ((_a_157 >> 15) & 1), ((_a_157 >> 16) & 1), ((_a_157 >> 17) & 1), ((_a_157 >> 18) & 1), ((_a_157 >> 19) & 1), ((_a_157 >> 20) & 1), ((_a_157 >> 21) & 1), ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_164[0];
    } else if ((_a_157 & 3) == 1) {
      Term _o_165[1];
      if (arm_112(e, _o_165, ((_a_157 >> 2) & 1), ((_a_157 >> 3) & 1), ((_a_157 >> 4) & 1), ((_a_157 >> 5) & 1), ((_a_157 >> 6) & 1), ((_a_157 >> 7) & 1), ((_a_157 >> 8) & 1), ((_a_157 >> 9) & 1), ((_a_157 >> 10) & 1), ((_a_157 >> 11) & 1), ((_a_157 >> 12) & 1), ((_a_157 >> 13) & 1), ((_a_157 >> 14) & 1), ((_a_157 >> 15) & 1), ((_a_157 >> 16) & 1), ((_a_157 >> 17) & 1), ((_a_157 >> 18) & 1), ((_a_157 >> 19) & 1), ((_a_157 >> 20) & 1), ((_a_157 >> 21) & 1), ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_165[0];
    } else if ((_a_157 & 1) == 1) {
      Term _o_166[1];
      if (arm_113(e, _o_166, ((_a_157 >> 1) & 1), ((_a_157 >> 2) & 1), ((_a_157 >> 3) & 1), ((_a_157 >> 4) & 1), ((_a_157 >> 5) & 1), ((_a_157 >> 6) & 1), ((_a_157 >> 7) & 1), ((_a_157 >> 8) & 1), ((_a_157 >> 9) & 1), ((_a_157 >> 10) & 1), ((_a_157 >> 11) & 1), ((_a_157 >> 12) & 1), ((_a_157 >> 13) & 1), ((_a_157 >> 14) & 1), ((_a_157 >> 15) & 1), ((_a_157 >> 16) & 1), ((_a_157 >> 17) & 1), ((_a_157 >> 18) & 1), ((_a_157 >> 19) & 1), ((_a_157 >> 20) & 1), ((_a_157 >> 21) & 1), ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_166[0];
    } else {
      Term _o_167[1];
      if (arm_114(e, _o_167, ((_a_157 >> 0) & 1), ((_a_157 >> 1) & 1), ((_a_157 >> 2) & 1), ((_a_157 >> 3) & 1), ((_a_157 >> 4) & 1), ((_a_157 >> 5) & 1), ((_a_157 >> 6) & 1), ((_a_157 >> 7) & 1), ((_a_157 >> 8) & 1), ((_a_157 >> 9) & 1), ((_a_157 >> 10) & 1), ((_a_157 >> 11) & 1), ((_a_157 >> 12) & 1), ((_a_157 >> 13) & 1), ((_a_157 >> 14) & 1), ((_a_157 >> 15) & 1), ((_a_157 >> 16) & 1), ((_a_157 >> 17) & 1), ((_a_157 >> 18) & 1), ((_a_157 >> 19) & 1), ((_a_157 >> 20) & 1), ((_a_157 >> 21) & 1), ((_a_157 >> 22) & 1), ((_a_157 >> 23) & 1), ((_a_157 >> 24) & 1), ((_a_157 >> 25) & 1), ((_a_157 >> 26) & 1), ((_a_157 >> 27) & 1), ((_a_157 >> 28) & 1), ((_a_157 >> 29) & 1), ((_a_157 >> 30) & 1), ((_a_157 >> 31) & 1), _a_158, _a_159) == 0) {
        return 0;
      }
      _v_59 = _o_167[0];
    }
  break;
  }
  o[0] = _v_59;
  return 1;
}

INLINE Term arm_58(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_58 = 0;
  u32 _a_154 = r0;
  Term _a_155 = r1;
  Term _a_156 = r2;
  WL_SPIN
    Term _o_168[1];
    if (arm_59(e, _o_168, _a_154, _a_155, _a_156) == 0) {
      return 0;
    }
    _v_58 = _o_168[0];
  break;
  }
  o[0] = _v_58;
  return 1;
}

INLINE Term arm_57(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_57 = 0;
  Term _a_152 = r0;
  Term _a_153 = r1;
  WL_SPIN
    if (term_aux(_a_152) == CID_SCON) {
      Term _fb_19[2];
      u64 _sp_20 = ctr_take(e, _a_152, 2, _fb_19);
      u32 _f_40 = _fb_19[0];
      Term _f_41 = _fb_19[1];
      Term _o_169[1];
      if (arm_58(e, _o_169, _f_40, _f_41, _a_153) == 0) {
        return 0;
      }
      _v_57 = _o_169[0];
      spare_free(e, cls_fit(2), _sp_20);
    } else {
      Term _o_170[1];
      if (arm_80(e, _o_170, _a_152, _a_153) == 0) {
        return 0;
      }
      _v_57 = _o_170[0];
    }
  break;
  }
  o[0] = _v_57;
  return 1;
}

INLINE Term arm_56(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_56 = 0;
  u32 _a_149 = r0;
  Term _a_150 = r1;
  Term _a_151 = r2;
  WL_SPIN
    if (_a_149 == 112) {
      Term _o_171[1];
      if (arm_57(e, _o_171, _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_171[0];
    } else if ((_a_149 & 2147483647) == 112) {
      Term _o_172[1];
      if (arm_83(e, _o_172, ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_172[0];
    } else if ((_a_149 & 1073741823) == 112) {
      Term _o_173[1];
      if (arm_84(e, _o_173, ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_173[0];
    } else if ((_a_149 & 536870911) == 112) {
      Term _o_174[1];
      if (arm_85(e, _o_174, ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_174[0];
    } else if ((_a_149 & 268435455) == 112) {
      Term _o_175[1];
      if (arm_86(e, _o_175, ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_175[0];
    } else if ((_a_149 & 134217727) == 112) {
      Term _o_176[1];
      if (arm_87(e, _o_176, ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_176[0];
    } else if ((_a_149 & 67108863) == 112) {
      Term _o_177[1];
      if (arm_88(e, _o_177, ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_177[0];
    } else if ((_a_149 & 33554431) == 112) {
      Term _o_178[1];
      if (arm_89(e, _o_178, ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_178[0];
    } else if ((_a_149 & 16777215) == 112) {
      Term _o_179[1];
      if (arm_90(e, _o_179, ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_179[0];
    } else if ((_a_149 & 8388607) == 112) {
      Term _o_180[1];
      if (arm_91(e, _o_180, ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_180[0];
    } else if ((_a_149 & 4194303) == 112) {
      Term _o_181[1];
      if (arm_92(e, _o_181, ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_181[0];
    } else if ((_a_149 & 2097151) == 112) {
      Term _o_182[1];
      if (arm_93(e, _o_182, ((_a_149 >> 21) & 1), ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_182[0];
    } else if ((_a_149 & 1048575) == 112) {
      Term _o_183[1];
      if (arm_94(e, _o_183, ((_a_149 >> 20) & 1), ((_a_149 >> 21) & 1), ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_183[0];
    } else if ((_a_149 & 524287) == 112) {
      Term _o_184[1];
      if (arm_95(e, _o_184, ((_a_149 >> 19) & 1), ((_a_149 >> 20) & 1), ((_a_149 >> 21) & 1), ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_184[0];
    } else if ((_a_149 & 262143) == 112) {
      Term _o_185[1];
      if (arm_96(e, _o_185, ((_a_149 >> 18) & 1), ((_a_149 >> 19) & 1), ((_a_149 >> 20) & 1), ((_a_149 >> 21) & 1), ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_185[0];
    } else if ((_a_149 & 131071) == 112) {
      Term _o_186[1];
      if (arm_97(e, _o_186, ((_a_149 >> 17) & 1), ((_a_149 >> 18) & 1), ((_a_149 >> 19) & 1), ((_a_149 >> 20) & 1), ((_a_149 >> 21) & 1), ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_186[0];
    } else if ((_a_149 & 65535) == 112) {
      Term _o_187[1];
      if (arm_98(e, _o_187, ((_a_149 >> 16) & 1), ((_a_149 >> 17) & 1), ((_a_149 >> 18) & 1), ((_a_149 >> 19) & 1), ((_a_149 >> 20) & 1), ((_a_149 >> 21) & 1), ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_187[0];
    } else if ((_a_149 & 32767) == 112) {
      Term _o_188[1];
      if (arm_99(e, _o_188, ((_a_149 >> 15) & 1), ((_a_149 >> 16) & 1), ((_a_149 >> 17) & 1), ((_a_149 >> 18) & 1), ((_a_149 >> 19) & 1), ((_a_149 >> 20) & 1), ((_a_149 >> 21) & 1), ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_188[0];
    } else if ((_a_149 & 16383) == 112) {
      Term _o_189[1];
      if (arm_100(e, _o_189, ((_a_149 >> 14) & 1), ((_a_149 >> 15) & 1), ((_a_149 >> 16) & 1), ((_a_149 >> 17) & 1), ((_a_149 >> 18) & 1), ((_a_149 >> 19) & 1), ((_a_149 >> 20) & 1), ((_a_149 >> 21) & 1), ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_189[0];
    } else if ((_a_149 & 8191) == 112) {
      Term _o_190[1];
      if (arm_101(e, _o_190, ((_a_149 >> 13) & 1), ((_a_149 >> 14) & 1), ((_a_149 >> 15) & 1), ((_a_149 >> 16) & 1), ((_a_149 >> 17) & 1), ((_a_149 >> 18) & 1), ((_a_149 >> 19) & 1), ((_a_149 >> 20) & 1), ((_a_149 >> 21) & 1), ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_190[0];
    } else if ((_a_149 & 4095) == 112) {
      Term _o_191[1];
      if (arm_102(e, _o_191, ((_a_149 >> 12) & 1), ((_a_149 >> 13) & 1), ((_a_149 >> 14) & 1), ((_a_149 >> 15) & 1), ((_a_149 >> 16) & 1), ((_a_149 >> 17) & 1), ((_a_149 >> 18) & 1), ((_a_149 >> 19) & 1), ((_a_149 >> 20) & 1), ((_a_149 >> 21) & 1), ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_191[0];
    } else if ((_a_149 & 2047) == 112) {
      Term _o_192[1];
      if (arm_103(e, _o_192, ((_a_149 >> 11) & 1), ((_a_149 >> 12) & 1), ((_a_149 >> 13) & 1), ((_a_149 >> 14) & 1), ((_a_149 >> 15) & 1), ((_a_149 >> 16) & 1), ((_a_149 >> 17) & 1), ((_a_149 >> 18) & 1), ((_a_149 >> 19) & 1), ((_a_149 >> 20) & 1), ((_a_149 >> 21) & 1), ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_192[0];
    } else if ((_a_149 & 1023) == 112) {
      Term _o_193[1];
      if (arm_104(e, _o_193, ((_a_149 >> 10) & 1), ((_a_149 >> 11) & 1), ((_a_149 >> 12) & 1), ((_a_149 >> 13) & 1), ((_a_149 >> 14) & 1), ((_a_149 >> 15) & 1), ((_a_149 >> 16) & 1), ((_a_149 >> 17) & 1), ((_a_149 >> 18) & 1), ((_a_149 >> 19) & 1), ((_a_149 >> 20) & 1), ((_a_149 >> 21) & 1), ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_193[0];
    } else if ((_a_149 & 511) == 112) {
      Term _o_194[1];
      if (arm_105(e, _o_194, ((_a_149 >> 9) & 1), ((_a_149 >> 10) & 1), ((_a_149 >> 11) & 1), ((_a_149 >> 12) & 1), ((_a_149 >> 13) & 1), ((_a_149 >> 14) & 1), ((_a_149 >> 15) & 1), ((_a_149 >> 16) & 1), ((_a_149 >> 17) & 1), ((_a_149 >> 18) & 1), ((_a_149 >> 19) & 1), ((_a_149 >> 20) & 1), ((_a_149 >> 21) & 1), ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_194[0];
    } else if ((_a_149 & 255) == 112) {
      Term _o_195[1];
      if (arm_106(e, _o_195, ((_a_149 >> 8) & 1), ((_a_149 >> 9) & 1), ((_a_149 >> 10) & 1), ((_a_149 >> 11) & 1), ((_a_149 >> 12) & 1), ((_a_149 >> 13) & 1), ((_a_149 >> 14) & 1), ((_a_149 >> 15) & 1), ((_a_149 >> 16) & 1), ((_a_149 >> 17) & 1), ((_a_149 >> 18) & 1), ((_a_149 >> 19) & 1), ((_a_149 >> 20) & 1), ((_a_149 >> 21) & 1), ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_195[0];
    } else if ((_a_149 & 127) == 112) {
      Term _o_196[1];
      if (arm_107(e, _o_196, ((_a_149 >> 7) & 1), ((_a_149 >> 8) & 1), ((_a_149 >> 9) & 1), ((_a_149 >> 10) & 1), ((_a_149 >> 11) & 1), ((_a_149 >> 12) & 1), ((_a_149 >> 13) & 1), ((_a_149 >> 14) & 1), ((_a_149 >> 15) & 1), ((_a_149 >> 16) & 1), ((_a_149 >> 17) & 1), ((_a_149 >> 18) & 1), ((_a_149 >> 19) & 1), ((_a_149 >> 20) & 1), ((_a_149 >> 21) & 1), ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_196[0];
    } else if ((_a_149 & 63) == 48) {
      Term _o_197[1];
      if (arm_108(e, _o_197, ((_a_149 >> 6) & 1), ((_a_149 >> 7) & 1), ((_a_149 >> 8) & 1), ((_a_149 >> 9) & 1), ((_a_149 >> 10) & 1), ((_a_149 >> 11) & 1), ((_a_149 >> 12) & 1), ((_a_149 >> 13) & 1), ((_a_149 >> 14) & 1), ((_a_149 >> 15) & 1), ((_a_149 >> 16) & 1), ((_a_149 >> 17) & 1), ((_a_149 >> 18) & 1), ((_a_149 >> 19) & 1), ((_a_149 >> 20) & 1), ((_a_149 >> 21) & 1), ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_197[0];
    } else if ((_a_149 & 31) == 16) {
      Term _o_198[1];
      if (arm_109(e, _o_198, ((_a_149 >> 5) & 1), ((_a_149 >> 6) & 1), ((_a_149 >> 7) & 1), ((_a_149 >> 8) & 1), ((_a_149 >> 9) & 1), ((_a_149 >> 10) & 1), ((_a_149 >> 11) & 1), ((_a_149 >> 12) & 1), ((_a_149 >> 13) & 1), ((_a_149 >> 14) & 1), ((_a_149 >> 15) & 1), ((_a_149 >> 16) & 1), ((_a_149 >> 17) & 1), ((_a_149 >> 18) & 1), ((_a_149 >> 19) & 1), ((_a_149 >> 20) & 1), ((_a_149 >> 21) & 1), ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_198[0];
    } else if ((_a_149 & 15) == 0) {
      Term _o_199[1];
      if (arm_110(e, _o_199, ((_a_149 >> 4) & 1), ((_a_149 >> 5) & 1), ((_a_149 >> 6) & 1), ((_a_149 >> 7) & 1), ((_a_149 >> 8) & 1), ((_a_149 >> 9) & 1), ((_a_149 >> 10) & 1), ((_a_149 >> 11) & 1), ((_a_149 >> 12) & 1), ((_a_149 >> 13) & 1), ((_a_149 >> 14) & 1), ((_a_149 >> 15) & 1), ((_a_149 >> 16) & 1), ((_a_149 >> 17) & 1), ((_a_149 >> 18) & 1), ((_a_149 >> 19) & 1), ((_a_149 >> 20) & 1), ((_a_149 >> 21) & 1), ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_199[0];
    } else if ((_a_149 & 7) == 0) {
      Term _o_200[1];
      if (arm_111(e, _o_200, ((_a_149 >> 3) & 1), ((_a_149 >> 4) & 1), ((_a_149 >> 5) & 1), ((_a_149 >> 6) & 1), ((_a_149 >> 7) & 1), ((_a_149 >> 8) & 1), ((_a_149 >> 9) & 1), ((_a_149 >> 10) & 1), ((_a_149 >> 11) & 1), ((_a_149 >> 12) & 1), ((_a_149 >> 13) & 1), ((_a_149 >> 14) & 1), ((_a_149 >> 15) & 1), ((_a_149 >> 16) & 1), ((_a_149 >> 17) & 1), ((_a_149 >> 18) & 1), ((_a_149 >> 19) & 1), ((_a_149 >> 20) & 1), ((_a_149 >> 21) & 1), ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_200[0];
    } else if ((_a_149 & 3) == 0) {
      Term _o_201[1];
      if (arm_112(e, _o_201, ((_a_149 >> 2) & 1), ((_a_149 >> 3) & 1), ((_a_149 >> 4) & 1), ((_a_149 >> 5) & 1), ((_a_149 >> 6) & 1), ((_a_149 >> 7) & 1), ((_a_149 >> 8) & 1), ((_a_149 >> 9) & 1), ((_a_149 >> 10) & 1), ((_a_149 >> 11) & 1), ((_a_149 >> 12) & 1), ((_a_149 >> 13) & 1), ((_a_149 >> 14) & 1), ((_a_149 >> 15) & 1), ((_a_149 >> 16) & 1), ((_a_149 >> 17) & 1), ((_a_149 >> 18) & 1), ((_a_149 >> 19) & 1), ((_a_149 >> 20) & 1), ((_a_149 >> 21) & 1), ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_201[0];
    } else if ((_a_149 & 1) == 0) {
      Term _o_202[1];
      if (arm_113(e, _o_202, ((_a_149 >> 1) & 1), ((_a_149 >> 2) & 1), ((_a_149 >> 3) & 1), ((_a_149 >> 4) & 1), ((_a_149 >> 5) & 1), ((_a_149 >> 6) & 1), ((_a_149 >> 7) & 1), ((_a_149 >> 8) & 1), ((_a_149 >> 9) & 1), ((_a_149 >> 10) & 1), ((_a_149 >> 11) & 1), ((_a_149 >> 12) & 1), ((_a_149 >> 13) & 1), ((_a_149 >> 14) & 1), ((_a_149 >> 15) & 1), ((_a_149 >> 16) & 1), ((_a_149 >> 17) & 1), ((_a_149 >> 18) & 1), ((_a_149 >> 19) & 1), ((_a_149 >> 20) & 1), ((_a_149 >> 21) & 1), ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_202[0];
    } else {
      Term _o_203[1];
      if (arm_114(e, _o_203, ((_a_149 >> 0) & 1), ((_a_149 >> 1) & 1), ((_a_149 >> 2) & 1), ((_a_149 >> 3) & 1), ((_a_149 >> 4) & 1), ((_a_149 >> 5) & 1), ((_a_149 >> 6) & 1), ((_a_149 >> 7) & 1), ((_a_149 >> 8) & 1), ((_a_149 >> 9) & 1), ((_a_149 >> 10) & 1), ((_a_149 >> 11) & 1), ((_a_149 >> 12) & 1), ((_a_149 >> 13) & 1), ((_a_149 >> 14) & 1), ((_a_149 >> 15) & 1), ((_a_149 >> 16) & 1), ((_a_149 >> 17) & 1), ((_a_149 >> 18) & 1), ((_a_149 >> 19) & 1), ((_a_149 >> 20) & 1), ((_a_149 >> 21) & 1), ((_a_149 >> 22) & 1), ((_a_149 >> 23) & 1), ((_a_149 >> 24) & 1), ((_a_149 >> 25) & 1), ((_a_149 >> 26) & 1), ((_a_149 >> 27) & 1), ((_a_149 >> 28) & 1), ((_a_149 >> 29) & 1), ((_a_149 >> 30) & 1), ((_a_149 >> 31) & 1), _a_150, _a_151) == 0) {
        return 0;
      }
      _v_56 = _o_203[0];
    }
  break;
  }
  o[0] = _v_56;
  return 1;
}

INLINE Term arm_55(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_55 = 0;
  u32 _a_146 = r0;
  Term _a_147 = r1;
  Term _a_148 = r2;
  WL_SPIN
    Term _o_204[1];
    if (arm_56(e, _o_204, _a_146, _a_147, _a_148) == 0) {
      return 0;
    }
    _v_55 = _o_204[0];
  break;
  }
  o[0] = _v_55;
  return 1;
}

INLINE Term arm_54(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_54 = 0;
  Term _a_144 = r0;
  Term _a_145 = r1;
  WL_SPIN
    if (term_aux(_a_144) == CID_SCON) {
      Term _fb_18[2];
      u64 _sp_19 = ctr_take(e, _a_144, 2, _fb_18);
      u32 _f_38 = _fb_18[0];
      Term _f_39 = _fb_18[1];
      Term _o_205[1];
      if (arm_55(e, _o_205, _f_38, _f_39, _a_145) == 0) {
        return 0;
      }
      _v_54 = _o_205[0];
      spare_free(e, cls_fit(2), _sp_19);
    } else {
      Term _o_206[1];
      if (arm_80(e, _o_206, _a_144, _a_145) == 0) {
        return 0;
      }
      _v_54 = _o_206[0];
    }
  break;
  }
  o[0] = _v_54;
  return 1;
}

INLINE Term arm_53(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_53 = 0;
  u32 _a_141 = r0;
  Term _a_142 = r1;
  Term _a_143 = r2;
  WL_SPIN
    if (_a_141 == 101) {
      Term _o_207[1];
      if (arm_54(e, _o_207, _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_207[0];
    } else if ((_a_141 & 2147483647) == 101) {
      Term _o_208[1];
      if (arm_83(e, _o_208, ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_208[0];
    } else if ((_a_141 & 1073741823) == 101) {
      Term _o_209[1];
      if (arm_84(e, _o_209, ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_209[0];
    } else if ((_a_141 & 536870911) == 101) {
      Term _o_210[1];
      if (arm_85(e, _o_210, ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_210[0];
    } else if ((_a_141 & 268435455) == 101) {
      Term _o_211[1];
      if (arm_86(e, _o_211, ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_211[0];
    } else if ((_a_141 & 134217727) == 101) {
      Term _o_212[1];
      if (arm_87(e, _o_212, ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_212[0];
    } else if ((_a_141 & 67108863) == 101) {
      Term _o_213[1];
      if (arm_88(e, _o_213, ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_213[0];
    } else if ((_a_141 & 33554431) == 101) {
      Term _o_214[1];
      if (arm_89(e, _o_214, ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_214[0];
    } else if ((_a_141 & 16777215) == 101) {
      Term _o_215[1];
      if (arm_90(e, _o_215, ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_215[0];
    } else if ((_a_141 & 8388607) == 101) {
      Term _o_216[1];
      if (arm_91(e, _o_216, ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_216[0];
    } else if ((_a_141 & 4194303) == 101) {
      Term _o_217[1];
      if (arm_92(e, _o_217, ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_217[0];
    } else if ((_a_141 & 2097151) == 101) {
      Term _o_218[1];
      if (arm_93(e, _o_218, ((_a_141 >> 21) & 1), ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_218[0];
    } else if ((_a_141 & 1048575) == 101) {
      Term _o_219[1];
      if (arm_94(e, _o_219, ((_a_141 >> 20) & 1), ((_a_141 >> 21) & 1), ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_219[0];
    } else if ((_a_141 & 524287) == 101) {
      Term _o_220[1];
      if (arm_95(e, _o_220, ((_a_141 >> 19) & 1), ((_a_141 >> 20) & 1), ((_a_141 >> 21) & 1), ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_220[0];
    } else if ((_a_141 & 262143) == 101) {
      Term _o_221[1];
      if (arm_96(e, _o_221, ((_a_141 >> 18) & 1), ((_a_141 >> 19) & 1), ((_a_141 >> 20) & 1), ((_a_141 >> 21) & 1), ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_221[0];
    } else if ((_a_141 & 131071) == 101) {
      Term _o_222[1];
      if (arm_97(e, _o_222, ((_a_141 >> 17) & 1), ((_a_141 >> 18) & 1), ((_a_141 >> 19) & 1), ((_a_141 >> 20) & 1), ((_a_141 >> 21) & 1), ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_222[0];
    } else if ((_a_141 & 65535) == 101) {
      Term _o_223[1];
      if (arm_98(e, _o_223, ((_a_141 >> 16) & 1), ((_a_141 >> 17) & 1), ((_a_141 >> 18) & 1), ((_a_141 >> 19) & 1), ((_a_141 >> 20) & 1), ((_a_141 >> 21) & 1), ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_223[0];
    } else if ((_a_141 & 32767) == 101) {
      Term _o_224[1];
      if (arm_99(e, _o_224, ((_a_141 >> 15) & 1), ((_a_141 >> 16) & 1), ((_a_141 >> 17) & 1), ((_a_141 >> 18) & 1), ((_a_141 >> 19) & 1), ((_a_141 >> 20) & 1), ((_a_141 >> 21) & 1), ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_224[0];
    } else if ((_a_141 & 16383) == 101) {
      Term _o_225[1];
      if (arm_100(e, _o_225, ((_a_141 >> 14) & 1), ((_a_141 >> 15) & 1), ((_a_141 >> 16) & 1), ((_a_141 >> 17) & 1), ((_a_141 >> 18) & 1), ((_a_141 >> 19) & 1), ((_a_141 >> 20) & 1), ((_a_141 >> 21) & 1), ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_225[0];
    } else if ((_a_141 & 8191) == 101) {
      Term _o_226[1];
      if (arm_101(e, _o_226, ((_a_141 >> 13) & 1), ((_a_141 >> 14) & 1), ((_a_141 >> 15) & 1), ((_a_141 >> 16) & 1), ((_a_141 >> 17) & 1), ((_a_141 >> 18) & 1), ((_a_141 >> 19) & 1), ((_a_141 >> 20) & 1), ((_a_141 >> 21) & 1), ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_226[0];
    } else if ((_a_141 & 4095) == 101) {
      Term _o_227[1];
      if (arm_102(e, _o_227, ((_a_141 >> 12) & 1), ((_a_141 >> 13) & 1), ((_a_141 >> 14) & 1), ((_a_141 >> 15) & 1), ((_a_141 >> 16) & 1), ((_a_141 >> 17) & 1), ((_a_141 >> 18) & 1), ((_a_141 >> 19) & 1), ((_a_141 >> 20) & 1), ((_a_141 >> 21) & 1), ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_227[0];
    } else if ((_a_141 & 2047) == 101) {
      Term _o_228[1];
      if (arm_103(e, _o_228, ((_a_141 >> 11) & 1), ((_a_141 >> 12) & 1), ((_a_141 >> 13) & 1), ((_a_141 >> 14) & 1), ((_a_141 >> 15) & 1), ((_a_141 >> 16) & 1), ((_a_141 >> 17) & 1), ((_a_141 >> 18) & 1), ((_a_141 >> 19) & 1), ((_a_141 >> 20) & 1), ((_a_141 >> 21) & 1), ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_228[0];
    } else if ((_a_141 & 1023) == 101) {
      Term _o_229[1];
      if (arm_104(e, _o_229, ((_a_141 >> 10) & 1), ((_a_141 >> 11) & 1), ((_a_141 >> 12) & 1), ((_a_141 >> 13) & 1), ((_a_141 >> 14) & 1), ((_a_141 >> 15) & 1), ((_a_141 >> 16) & 1), ((_a_141 >> 17) & 1), ((_a_141 >> 18) & 1), ((_a_141 >> 19) & 1), ((_a_141 >> 20) & 1), ((_a_141 >> 21) & 1), ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_229[0];
    } else if ((_a_141 & 511) == 101) {
      Term _o_230[1];
      if (arm_105(e, _o_230, ((_a_141 >> 9) & 1), ((_a_141 >> 10) & 1), ((_a_141 >> 11) & 1), ((_a_141 >> 12) & 1), ((_a_141 >> 13) & 1), ((_a_141 >> 14) & 1), ((_a_141 >> 15) & 1), ((_a_141 >> 16) & 1), ((_a_141 >> 17) & 1), ((_a_141 >> 18) & 1), ((_a_141 >> 19) & 1), ((_a_141 >> 20) & 1), ((_a_141 >> 21) & 1), ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_230[0];
    } else if ((_a_141 & 255) == 101) {
      Term _o_231[1];
      if (arm_106(e, _o_231, ((_a_141 >> 8) & 1), ((_a_141 >> 9) & 1), ((_a_141 >> 10) & 1), ((_a_141 >> 11) & 1), ((_a_141 >> 12) & 1), ((_a_141 >> 13) & 1), ((_a_141 >> 14) & 1), ((_a_141 >> 15) & 1), ((_a_141 >> 16) & 1), ((_a_141 >> 17) & 1), ((_a_141 >> 18) & 1), ((_a_141 >> 19) & 1), ((_a_141 >> 20) & 1), ((_a_141 >> 21) & 1), ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_231[0];
    } else if ((_a_141 & 127) == 101) {
      Term _o_232[1];
      if (arm_107(e, _o_232, ((_a_141 >> 7) & 1), ((_a_141 >> 8) & 1), ((_a_141 >> 9) & 1), ((_a_141 >> 10) & 1), ((_a_141 >> 11) & 1), ((_a_141 >> 12) & 1), ((_a_141 >> 13) & 1), ((_a_141 >> 14) & 1), ((_a_141 >> 15) & 1), ((_a_141 >> 16) & 1), ((_a_141 >> 17) & 1), ((_a_141 >> 18) & 1), ((_a_141 >> 19) & 1), ((_a_141 >> 20) & 1), ((_a_141 >> 21) & 1), ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_232[0];
    } else if ((_a_141 & 63) == 37) {
      Term _o_233[1];
      if (arm_108(e, _o_233, ((_a_141 >> 6) & 1), ((_a_141 >> 7) & 1), ((_a_141 >> 8) & 1), ((_a_141 >> 9) & 1), ((_a_141 >> 10) & 1), ((_a_141 >> 11) & 1), ((_a_141 >> 12) & 1), ((_a_141 >> 13) & 1), ((_a_141 >> 14) & 1), ((_a_141 >> 15) & 1), ((_a_141 >> 16) & 1), ((_a_141 >> 17) & 1), ((_a_141 >> 18) & 1), ((_a_141 >> 19) & 1), ((_a_141 >> 20) & 1), ((_a_141 >> 21) & 1), ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_233[0];
    } else if ((_a_141 & 31) == 5) {
      Term _o_234[1];
      if (arm_109(e, _o_234, ((_a_141 >> 5) & 1), ((_a_141 >> 6) & 1), ((_a_141 >> 7) & 1), ((_a_141 >> 8) & 1), ((_a_141 >> 9) & 1), ((_a_141 >> 10) & 1), ((_a_141 >> 11) & 1), ((_a_141 >> 12) & 1), ((_a_141 >> 13) & 1), ((_a_141 >> 14) & 1), ((_a_141 >> 15) & 1), ((_a_141 >> 16) & 1), ((_a_141 >> 17) & 1), ((_a_141 >> 18) & 1), ((_a_141 >> 19) & 1), ((_a_141 >> 20) & 1), ((_a_141 >> 21) & 1), ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_234[0];
    } else if ((_a_141 & 15) == 5) {
      Term _o_235[1];
      if (arm_110(e, _o_235, ((_a_141 >> 4) & 1), ((_a_141 >> 5) & 1), ((_a_141 >> 6) & 1), ((_a_141 >> 7) & 1), ((_a_141 >> 8) & 1), ((_a_141 >> 9) & 1), ((_a_141 >> 10) & 1), ((_a_141 >> 11) & 1), ((_a_141 >> 12) & 1), ((_a_141 >> 13) & 1), ((_a_141 >> 14) & 1), ((_a_141 >> 15) & 1), ((_a_141 >> 16) & 1), ((_a_141 >> 17) & 1), ((_a_141 >> 18) & 1), ((_a_141 >> 19) & 1), ((_a_141 >> 20) & 1), ((_a_141 >> 21) & 1), ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_235[0];
    } else if ((_a_141 & 7) == 5) {
      Term _o_236[1];
      if (arm_111(e, _o_236, ((_a_141 >> 3) & 1), ((_a_141 >> 4) & 1), ((_a_141 >> 5) & 1), ((_a_141 >> 6) & 1), ((_a_141 >> 7) & 1), ((_a_141 >> 8) & 1), ((_a_141 >> 9) & 1), ((_a_141 >> 10) & 1), ((_a_141 >> 11) & 1), ((_a_141 >> 12) & 1), ((_a_141 >> 13) & 1), ((_a_141 >> 14) & 1), ((_a_141 >> 15) & 1), ((_a_141 >> 16) & 1), ((_a_141 >> 17) & 1), ((_a_141 >> 18) & 1), ((_a_141 >> 19) & 1), ((_a_141 >> 20) & 1), ((_a_141 >> 21) & 1), ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_236[0];
    } else if ((_a_141 & 3) == 1) {
      Term _o_237[1];
      if (arm_112(e, _o_237, ((_a_141 >> 2) & 1), ((_a_141 >> 3) & 1), ((_a_141 >> 4) & 1), ((_a_141 >> 5) & 1), ((_a_141 >> 6) & 1), ((_a_141 >> 7) & 1), ((_a_141 >> 8) & 1), ((_a_141 >> 9) & 1), ((_a_141 >> 10) & 1), ((_a_141 >> 11) & 1), ((_a_141 >> 12) & 1), ((_a_141 >> 13) & 1), ((_a_141 >> 14) & 1), ((_a_141 >> 15) & 1), ((_a_141 >> 16) & 1), ((_a_141 >> 17) & 1), ((_a_141 >> 18) & 1), ((_a_141 >> 19) & 1), ((_a_141 >> 20) & 1), ((_a_141 >> 21) & 1), ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_237[0];
    } else if ((_a_141 & 1) == 1) {
      Term _o_238[1];
      if (arm_113(e, _o_238, ((_a_141 >> 1) & 1), ((_a_141 >> 2) & 1), ((_a_141 >> 3) & 1), ((_a_141 >> 4) & 1), ((_a_141 >> 5) & 1), ((_a_141 >> 6) & 1), ((_a_141 >> 7) & 1), ((_a_141 >> 8) & 1), ((_a_141 >> 9) & 1), ((_a_141 >> 10) & 1), ((_a_141 >> 11) & 1), ((_a_141 >> 12) & 1), ((_a_141 >> 13) & 1), ((_a_141 >> 14) & 1), ((_a_141 >> 15) & 1), ((_a_141 >> 16) & 1), ((_a_141 >> 17) & 1), ((_a_141 >> 18) & 1), ((_a_141 >> 19) & 1), ((_a_141 >> 20) & 1), ((_a_141 >> 21) & 1), ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_238[0];
    } else {
      Term _o_239[1];
      if (arm_114(e, _o_239, ((_a_141 >> 0) & 1), ((_a_141 >> 1) & 1), ((_a_141 >> 2) & 1), ((_a_141 >> 3) & 1), ((_a_141 >> 4) & 1), ((_a_141 >> 5) & 1), ((_a_141 >> 6) & 1), ((_a_141 >> 7) & 1), ((_a_141 >> 8) & 1), ((_a_141 >> 9) & 1), ((_a_141 >> 10) & 1), ((_a_141 >> 11) & 1), ((_a_141 >> 12) & 1), ((_a_141 >> 13) & 1), ((_a_141 >> 14) & 1), ((_a_141 >> 15) & 1), ((_a_141 >> 16) & 1), ((_a_141 >> 17) & 1), ((_a_141 >> 18) & 1), ((_a_141 >> 19) & 1), ((_a_141 >> 20) & 1), ((_a_141 >> 21) & 1), ((_a_141 >> 22) & 1), ((_a_141 >> 23) & 1), ((_a_141 >> 24) & 1), ((_a_141 >> 25) & 1), ((_a_141 >> 26) & 1), ((_a_141 >> 27) & 1), ((_a_141 >> 28) & 1), ((_a_141 >> 29) & 1), ((_a_141 >> 30) & 1), ((_a_141 >> 31) & 1), _a_142, _a_143) == 0) {
        return 0;
      }
      _v_53 = _o_239[0];
    }
  break;
  }
  o[0] = _v_53;
  return 1;
}

INLINE Term arm_52(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_52 = 0;
  u32 _a_138 = r0;
  Term _a_139 = r1;
  Term _a_140 = r2;
  WL_SPIN
    Term _o_240[1];
    if (arm_53(e, _o_240, _a_138, _a_139, _a_140) == 0) {
      return 0;
    }
    _v_52 = _o_240[0];
  break;
  }
  o[0] = _v_52;
  return 1;
}

INLINE Term arm_51(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_51 = 0;
  Term _a_136 = r0;
  Term _a_137 = r1;
  WL_SPIN
    if (term_aux(_a_136) == CID_SCON) {
      Term _fb_17[2];
      u64 _sp_18 = ctr_take(e, _a_136, 2, _fb_17);
      u32 _f_36 = _fb_17[0];
      Term _f_37 = _fb_17[1];
      Term _o_241[1];
      if (arm_52(e, _o_241, _f_36, _f_37, _a_137) == 0) {
        return 0;
      }
      _v_51 = _o_241[0];
      spare_free(e, cls_fit(2), _sp_18);
    } else {
      Term _o_242[1];
      if (arm_80(e, _o_242, _a_136, _a_137) == 0) {
        return 0;
      }
      _v_51 = _o_242[0];
    }
  break;
  }
  o[0] = _v_51;
  return 1;
}

INLINE Term arm_50(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_50 = 0;
  u32 _a_133 = r0;
  Term _a_134 = r1;
  Term _a_135 = r2;
  WL_SPIN
    if (_a_133 == 101) {
      Term _o_243[1];
      if (arm_51(e, _o_243, _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_243[0];
    } else if ((_a_133 & 2147483647) == 101) {
      Term _o_244[1];
      if (arm_83(e, _o_244, ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_244[0];
    } else if ((_a_133 & 1073741823) == 101) {
      Term _o_245[1];
      if (arm_84(e, _o_245, ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_245[0];
    } else if ((_a_133 & 536870911) == 101) {
      Term _o_246[1];
      if (arm_85(e, _o_246, ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_246[0];
    } else if ((_a_133 & 268435455) == 101) {
      Term _o_247[1];
      if (arm_86(e, _o_247, ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_247[0];
    } else if ((_a_133 & 134217727) == 101) {
      Term _o_248[1];
      if (arm_87(e, _o_248, ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_248[0];
    } else if ((_a_133 & 67108863) == 101) {
      Term _o_249[1];
      if (arm_88(e, _o_249, ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_249[0];
    } else if ((_a_133 & 33554431) == 101) {
      Term _o_250[1];
      if (arm_89(e, _o_250, ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_250[0];
    } else if ((_a_133 & 16777215) == 101) {
      Term _o_251[1];
      if (arm_90(e, _o_251, ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_251[0];
    } else if ((_a_133 & 8388607) == 101) {
      Term _o_252[1];
      if (arm_91(e, _o_252, ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_252[0];
    } else if ((_a_133 & 4194303) == 101) {
      Term _o_253[1];
      if (arm_92(e, _o_253, ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_253[0];
    } else if ((_a_133 & 2097151) == 101) {
      Term _o_254[1];
      if (arm_93(e, _o_254, ((_a_133 >> 21) & 1), ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_254[0];
    } else if ((_a_133 & 1048575) == 101) {
      Term _o_255[1];
      if (arm_94(e, _o_255, ((_a_133 >> 20) & 1), ((_a_133 >> 21) & 1), ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_255[0];
    } else if ((_a_133 & 524287) == 101) {
      Term _o_256[1];
      if (arm_95(e, _o_256, ((_a_133 >> 19) & 1), ((_a_133 >> 20) & 1), ((_a_133 >> 21) & 1), ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_256[0];
    } else if ((_a_133 & 262143) == 101) {
      Term _o_257[1];
      if (arm_96(e, _o_257, ((_a_133 >> 18) & 1), ((_a_133 >> 19) & 1), ((_a_133 >> 20) & 1), ((_a_133 >> 21) & 1), ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_257[0];
    } else if ((_a_133 & 131071) == 101) {
      Term _o_258[1];
      if (arm_97(e, _o_258, ((_a_133 >> 17) & 1), ((_a_133 >> 18) & 1), ((_a_133 >> 19) & 1), ((_a_133 >> 20) & 1), ((_a_133 >> 21) & 1), ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_258[0];
    } else if ((_a_133 & 65535) == 101) {
      Term _o_259[1];
      if (arm_98(e, _o_259, ((_a_133 >> 16) & 1), ((_a_133 >> 17) & 1), ((_a_133 >> 18) & 1), ((_a_133 >> 19) & 1), ((_a_133 >> 20) & 1), ((_a_133 >> 21) & 1), ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_259[0];
    } else if ((_a_133 & 32767) == 101) {
      Term _o_260[1];
      if (arm_99(e, _o_260, ((_a_133 >> 15) & 1), ((_a_133 >> 16) & 1), ((_a_133 >> 17) & 1), ((_a_133 >> 18) & 1), ((_a_133 >> 19) & 1), ((_a_133 >> 20) & 1), ((_a_133 >> 21) & 1), ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_260[0];
    } else if ((_a_133 & 16383) == 101) {
      Term _o_261[1];
      if (arm_100(e, _o_261, ((_a_133 >> 14) & 1), ((_a_133 >> 15) & 1), ((_a_133 >> 16) & 1), ((_a_133 >> 17) & 1), ((_a_133 >> 18) & 1), ((_a_133 >> 19) & 1), ((_a_133 >> 20) & 1), ((_a_133 >> 21) & 1), ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_261[0];
    } else if ((_a_133 & 8191) == 101) {
      Term _o_262[1];
      if (arm_101(e, _o_262, ((_a_133 >> 13) & 1), ((_a_133 >> 14) & 1), ((_a_133 >> 15) & 1), ((_a_133 >> 16) & 1), ((_a_133 >> 17) & 1), ((_a_133 >> 18) & 1), ((_a_133 >> 19) & 1), ((_a_133 >> 20) & 1), ((_a_133 >> 21) & 1), ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_262[0];
    } else if ((_a_133 & 4095) == 101) {
      Term _o_263[1];
      if (arm_102(e, _o_263, ((_a_133 >> 12) & 1), ((_a_133 >> 13) & 1), ((_a_133 >> 14) & 1), ((_a_133 >> 15) & 1), ((_a_133 >> 16) & 1), ((_a_133 >> 17) & 1), ((_a_133 >> 18) & 1), ((_a_133 >> 19) & 1), ((_a_133 >> 20) & 1), ((_a_133 >> 21) & 1), ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_263[0];
    } else if ((_a_133 & 2047) == 101) {
      Term _o_264[1];
      if (arm_103(e, _o_264, ((_a_133 >> 11) & 1), ((_a_133 >> 12) & 1), ((_a_133 >> 13) & 1), ((_a_133 >> 14) & 1), ((_a_133 >> 15) & 1), ((_a_133 >> 16) & 1), ((_a_133 >> 17) & 1), ((_a_133 >> 18) & 1), ((_a_133 >> 19) & 1), ((_a_133 >> 20) & 1), ((_a_133 >> 21) & 1), ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_264[0];
    } else if ((_a_133 & 1023) == 101) {
      Term _o_265[1];
      if (arm_104(e, _o_265, ((_a_133 >> 10) & 1), ((_a_133 >> 11) & 1), ((_a_133 >> 12) & 1), ((_a_133 >> 13) & 1), ((_a_133 >> 14) & 1), ((_a_133 >> 15) & 1), ((_a_133 >> 16) & 1), ((_a_133 >> 17) & 1), ((_a_133 >> 18) & 1), ((_a_133 >> 19) & 1), ((_a_133 >> 20) & 1), ((_a_133 >> 21) & 1), ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_265[0];
    } else if ((_a_133 & 511) == 101) {
      Term _o_266[1];
      if (arm_105(e, _o_266, ((_a_133 >> 9) & 1), ((_a_133 >> 10) & 1), ((_a_133 >> 11) & 1), ((_a_133 >> 12) & 1), ((_a_133 >> 13) & 1), ((_a_133 >> 14) & 1), ((_a_133 >> 15) & 1), ((_a_133 >> 16) & 1), ((_a_133 >> 17) & 1), ((_a_133 >> 18) & 1), ((_a_133 >> 19) & 1), ((_a_133 >> 20) & 1), ((_a_133 >> 21) & 1), ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_266[0];
    } else if ((_a_133 & 255) == 101) {
      Term _o_267[1];
      if (arm_106(e, _o_267, ((_a_133 >> 8) & 1), ((_a_133 >> 9) & 1), ((_a_133 >> 10) & 1), ((_a_133 >> 11) & 1), ((_a_133 >> 12) & 1), ((_a_133 >> 13) & 1), ((_a_133 >> 14) & 1), ((_a_133 >> 15) & 1), ((_a_133 >> 16) & 1), ((_a_133 >> 17) & 1), ((_a_133 >> 18) & 1), ((_a_133 >> 19) & 1), ((_a_133 >> 20) & 1), ((_a_133 >> 21) & 1), ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_267[0];
    } else if ((_a_133 & 127) == 101) {
      Term _o_268[1];
      if (arm_107(e, _o_268, ((_a_133 >> 7) & 1), ((_a_133 >> 8) & 1), ((_a_133 >> 9) & 1), ((_a_133 >> 10) & 1), ((_a_133 >> 11) & 1), ((_a_133 >> 12) & 1), ((_a_133 >> 13) & 1), ((_a_133 >> 14) & 1), ((_a_133 >> 15) & 1), ((_a_133 >> 16) & 1), ((_a_133 >> 17) & 1), ((_a_133 >> 18) & 1), ((_a_133 >> 19) & 1), ((_a_133 >> 20) & 1), ((_a_133 >> 21) & 1), ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_268[0];
    } else if ((_a_133 & 63) == 37) {
      Term _o_269[1];
      if (arm_108(e, _o_269, ((_a_133 >> 6) & 1), ((_a_133 >> 7) & 1), ((_a_133 >> 8) & 1), ((_a_133 >> 9) & 1), ((_a_133 >> 10) & 1), ((_a_133 >> 11) & 1), ((_a_133 >> 12) & 1), ((_a_133 >> 13) & 1), ((_a_133 >> 14) & 1), ((_a_133 >> 15) & 1), ((_a_133 >> 16) & 1), ((_a_133 >> 17) & 1), ((_a_133 >> 18) & 1), ((_a_133 >> 19) & 1), ((_a_133 >> 20) & 1), ((_a_133 >> 21) & 1), ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_269[0];
    } else if ((_a_133 & 31) == 5) {
      Term _o_270[1];
      if (arm_109(e, _o_270, ((_a_133 >> 5) & 1), ((_a_133 >> 6) & 1), ((_a_133 >> 7) & 1), ((_a_133 >> 8) & 1), ((_a_133 >> 9) & 1), ((_a_133 >> 10) & 1), ((_a_133 >> 11) & 1), ((_a_133 >> 12) & 1), ((_a_133 >> 13) & 1), ((_a_133 >> 14) & 1), ((_a_133 >> 15) & 1), ((_a_133 >> 16) & 1), ((_a_133 >> 17) & 1), ((_a_133 >> 18) & 1), ((_a_133 >> 19) & 1), ((_a_133 >> 20) & 1), ((_a_133 >> 21) & 1), ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_270[0];
    } else if ((_a_133 & 15) == 5) {
      Term _o_271[1];
      if (arm_110(e, _o_271, ((_a_133 >> 4) & 1), ((_a_133 >> 5) & 1), ((_a_133 >> 6) & 1), ((_a_133 >> 7) & 1), ((_a_133 >> 8) & 1), ((_a_133 >> 9) & 1), ((_a_133 >> 10) & 1), ((_a_133 >> 11) & 1), ((_a_133 >> 12) & 1), ((_a_133 >> 13) & 1), ((_a_133 >> 14) & 1), ((_a_133 >> 15) & 1), ((_a_133 >> 16) & 1), ((_a_133 >> 17) & 1), ((_a_133 >> 18) & 1), ((_a_133 >> 19) & 1), ((_a_133 >> 20) & 1), ((_a_133 >> 21) & 1), ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_271[0];
    } else if ((_a_133 & 7) == 5) {
      Term _o_272[1];
      if (arm_111(e, _o_272, ((_a_133 >> 3) & 1), ((_a_133 >> 4) & 1), ((_a_133 >> 5) & 1), ((_a_133 >> 6) & 1), ((_a_133 >> 7) & 1), ((_a_133 >> 8) & 1), ((_a_133 >> 9) & 1), ((_a_133 >> 10) & 1), ((_a_133 >> 11) & 1), ((_a_133 >> 12) & 1), ((_a_133 >> 13) & 1), ((_a_133 >> 14) & 1), ((_a_133 >> 15) & 1), ((_a_133 >> 16) & 1), ((_a_133 >> 17) & 1), ((_a_133 >> 18) & 1), ((_a_133 >> 19) & 1), ((_a_133 >> 20) & 1), ((_a_133 >> 21) & 1), ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_272[0];
    } else if ((_a_133 & 3) == 1) {
      Term _o_273[1];
      if (arm_112(e, _o_273, ((_a_133 >> 2) & 1), ((_a_133 >> 3) & 1), ((_a_133 >> 4) & 1), ((_a_133 >> 5) & 1), ((_a_133 >> 6) & 1), ((_a_133 >> 7) & 1), ((_a_133 >> 8) & 1), ((_a_133 >> 9) & 1), ((_a_133 >> 10) & 1), ((_a_133 >> 11) & 1), ((_a_133 >> 12) & 1), ((_a_133 >> 13) & 1), ((_a_133 >> 14) & 1), ((_a_133 >> 15) & 1), ((_a_133 >> 16) & 1), ((_a_133 >> 17) & 1), ((_a_133 >> 18) & 1), ((_a_133 >> 19) & 1), ((_a_133 >> 20) & 1), ((_a_133 >> 21) & 1), ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_273[0];
    } else if ((_a_133 & 1) == 1) {
      Term _o_274[1];
      if (arm_113(e, _o_274, ((_a_133 >> 1) & 1), ((_a_133 >> 2) & 1), ((_a_133 >> 3) & 1), ((_a_133 >> 4) & 1), ((_a_133 >> 5) & 1), ((_a_133 >> 6) & 1), ((_a_133 >> 7) & 1), ((_a_133 >> 8) & 1), ((_a_133 >> 9) & 1), ((_a_133 >> 10) & 1), ((_a_133 >> 11) & 1), ((_a_133 >> 12) & 1), ((_a_133 >> 13) & 1), ((_a_133 >> 14) & 1), ((_a_133 >> 15) & 1), ((_a_133 >> 16) & 1), ((_a_133 >> 17) & 1), ((_a_133 >> 18) & 1), ((_a_133 >> 19) & 1), ((_a_133 >> 20) & 1), ((_a_133 >> 21) & 1), ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_274[0];
    } else {
      Term _o_275[1];
      if (arm_114(e, _o_275, ((_a_133 >> 0) & 1), ((_a_133 >> 1) & 1), ((_a_133 >> 2) & 1), ((_a_133 >> 3) & 1), ((_a_133 >> 4) & 1), ((_a_133 >> 5) & 1), ((_a_133 >> 6) & 1), ((_a_133 >> 7) & 1), ((_a_133 >> 8) & 1), ((_a_133 >> 9) & 1), ((_a_133 >> 10) & 1), ((_a_133 >> 11) & 1), ((_a_133 >> 12) & 1), ((_a_133 >> 13) & 1), ((_a_133 >> 14) & 1), ((_a_133 >> 15) & 1), ((_a_133 >> 16) & 1), ((_a_133 >> 17) & 1), ((_a_133 >> 18) & 1), ((_a_133 >> 19) & 1), ((_a_133 >> 20) & 1), ((_a_133 >> 21) & 1), ((_a_133 >> 22) & 1), ((_a_133 >> 23) & 1), ((_a_133 >> 24) & 1), ((_a_133 >> 25) & 1), ((_a_133 >> 26) & 1), ((_a_133 >> 27) & 1), ((_a_133 >> 28) & 1), ((_a_133 >> 29) & 1), ((_a_133 >> 30) & 1), ((_a_133 >> 31) & 1), _a_134, _a_135) == 0) {
        return 0;
      }
      _v_50 = _o_275[0];
    }
  break;
  }
  o[0] = _v_50;
  return 1;
}

INLINE Term arm_49(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_49 = 0;
  u32 _a_130 = r0;
  Term _a_131 = r1;
  Term _a_132 = r2;
  WL_SPIN
    Term _o_276[1];
    if (arm_50(e, _o_276, _a_130, _a_131, _a_132) == 0) {
      return 0;
    }
    _v_49 = _o_276[0];
  break;
  }
  o[0] = _v_49;
  return 1;
}

INLINE Term arm_48(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_48 = 0;
  Term _a_128 = r0;
  Term _a_129 = r1;
  WL_SPIN
    if (term_aux(_a_128) == CID_SCON) {
      Term _fb_16[2];
      u64 _sp_17 = ctr_take(e, _a_128, 2, _fb_16);
      u32 _f_34 = _fb_16[0];
      Term _f_35 = _fb_16[1];
      Term _o_277[1];
      if (arm_49(e, _o_277, _f_34, _f_35, _a_129) == 0) {
        return 0;
      }
      _v_48 = _o_277[0];
      spare_free(e, cls_fit(2), _sp_17);
    } else {
      Term _o_278[1];
      if (arm_80(e, _o_278, _a_128, _a_129) == 0) {
        return 0;
      }
      _v_48 = _o_278[0];
    }
  break;
  }
  o[0] = _v_48;
  return 1;
}

INLINE Term arm_47(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_47 = 0;
  u32 _a_125 = r0;
  Term _a_126 = r1;
  Term _a_127 = r2;
  WL_SPIN
    if (_a_125 == 107) {
      Term _o_279[1];
      if (arm_48(e, _o_279, _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_279[0];
    } else if ((_a_125 & 2147483647) == 107) {
      Term _o_280[1];
      if (arm_83(e, _o_280, ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_280[0];
    } else if ((_a_125 & 1073741823) == 107) {
      Term _o_281[1];
      if (arm_84(e, _o_281, ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_281[0];
    } else if ((_a_125 & 536870911) == 107) {
      Term _o_282[1];
      if (arm_85(e, _o_282, ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_282[0];
    } else if ((_a_125 & 268435455) == 107) {
      Term _o_283[1];
      if (arm_86(e, _o_283, ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_283[0];
    } else if ((_a_125 & 134217727) == 107) {
      Term _o_284[1];
      if (arm_87(e, _o_284, ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_284[0];
    } else if ((_a_125 & 67108863) == 107) {
      Term _o_285[1];
      if (arm_88(e, _o_285, ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_285[0];
    } else if ((_a_125 & 33554431) == 107) {
      Term _o_286[1];
      if (arm_89(e, _o_286, ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_286[0];
    } else if ((_a_125 & 16777215) == 107) {
      Term _o_287[1];
      if (arm_90(e, _o_287, ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_287[0];
    } else if ((_a_125 & 8388607) == 107) {
      Term _o_288[1];
      if (arm_91(e, _o_288, ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_288[0];
    } else if ((_a_125 & 4194303) == 107) {
      Term _o_289[1];
      if (arm_92(e, _o_289, ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_289[0];
    } else if ((_a_125 & 2097151) == 107) {
      Term _o_290[1];
      if (arm_93(e, _o_290, ((_a_125 >> 21) & 1), ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_290[0];
    } else if ((_a_125 & 1048575) == 107) {
      Term _o_291[1];
      if (arm_94(e, _o_291, ((_a_125 >> 20) & 1), ((_a_125 >> 21) & 1), ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_291[0];
    } else if ((_a_125 & 524287) == 107) {
      Term _o_292[1];
      if (arm_95(e, _o_292, ((_a_125 >> 19) & 1), ((_a_125 >> 20) & 1), ((_a_125 >> 21) & 1), ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_292[0];
    } else if ((_a_125 & 262143) == 107) {
      Term _o_293[1];
      if (arm_96(e, _o_293, ((_a_125 >> 18) & 1), ((_a_125 >> 19) & 1), ((_a_125 >> 20) & 1), ((_a_125 >> 21) & 1), ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_293[0];
    } else if ((_a_125 & 131071) == 107) {
      Term _o_294[1];
      if (arm_97(e, _o_294, ((_a_125 >> 17) & 1), ((_a_125 >> 18) & 1), ((_a_125 >> 19) & 1), ((_a_125 >> 20) & 1), ((_a_125 >> 21) & 1), ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_294[0];
    } else if ((_a_125 & 65535) == 107) {
      Term _o_295[1];
      if (arm_98(e, _o_295, ((_a_125 >> 16) & 1), ((_a_125 >> 17) & 1), ((_a_125 >> 18) & 1), ((_a_125 >> 19) & 1), ((_a_125 >> 20) & 1), ((_a_125 >> 21) & 1), ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_295[0];
    } else if ((_a_125 & 32767) == 107) {
      Term _o_296[1];
      if (arm_99(e, _o_296, ((_a_125 >> 15) & 1), ((_a_125 >> 16) & 1), ((_a_125 >> 17) & 1), ((_a_125 >> 18) & 1), ((_a_125 >> 19) & 1), ((_a_125 >> 20) & 1), ((_a_125 >> 21) & 1), ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_296[0];
    } else if ((_a_125 & 16383) == 107) {
      Term _o_297[1];
      if (arm_100(e, _o_297, ((_a_125 >> 14) & 1), ((_a_125 >> 15) & 1), ((_a_125 >> 16) & 1), ((_a_125 >> 17) & 1), ((_a_125 >> 18) & 1), ((_a_125 >> 19) & 1), ((_a_125 >> 20) & 1), ((_a_125 >> 21) & 1), ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_297[0];
    } else if ((_a_125 & 8191) == 107) {
      Term _o_298[1];
      if (arm_101(e, _o_298, ((_a_125 >> 13) & 1), ((_a_125 >> 14) & 1), ((_a_125 >> 15) & 1), ((_a_125 >> 16) & 1), ((_a_125 >> 17) & 1), ((_a_125 >> 18) & 1), ((_a_125 >> 19) & 1), ((_a_125 >> 20) & 1), ((_a_125 >> 21) & 1), ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_298[0];
    } else if ((_a_125 & 4095) == 107) {
      Term _o_299[1];
      if (arm_102(e, _o_299, ((_a_125 >> 12) & 1), ((_a_125 >> 13) & 1), ((_a_125 >> 14) & 1), ((_a_125 >> 15) & 1), ((_a_125 >> 16) & 1), ((_a_125 >> 17) & 1), ((_a_125 >> 18) & 1), ((_a_125 >> 19) & 1), ((_a_125 >> 20) & 1), ((_a_125 >> 21) & 1), ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_299[0];
    } else if ((_a_125 & 2047) == 107) {
      Term _o_300[1];
      if (arm_103(e, _o_300, ((_a_125 >> 11) & 1), ((_a_125 >> 12) & 1), ((_a_125 >> 13) & 1), ((_a_125 >> 14) & 1), ((_a_125 >> 15) & 1), ((_a_125 >> 16) & 1), ((_a_125 >> 17) & 1), ((_a_125 >> 18) & 1), ((_a_125 >> 19) & 1), ((_a_125 >> 20) & 1), ((_a_125 >> 21) & 1), ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_300[0];
    } else if ((_a_125 & 1023) == 107) {
      Term _o_301[1];
      if (arm_104(e, _o_301, ((_a_125 >> 10) & 1), ((_a_125 >> 11) & 1), ((_a_125 >> 12) & 1), ((_a_125 >> 13) & 1), ((_a_125 >> 14) & 1), ((_a_125 >> 15) & 1), ((_a_125 >> 16) & 1), ((_a_125 >> 17) & 1), ((_a_125 >> 18) & 1), ((_a_125 >> 19) & 1), ((_a_125 >> 20) & 1), ((_a_125 >> 21) & 1), ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_301[0];
    } else if ((_a_125 & 511) == 107) {
      Term _o_302[1];
      if (arm_105(e, _o_302, ((_a_125 >> 9) & 1), ((_a_125 >> 10) & 1), ((_a_125 >> 11) & 1), ((_a_125 >> 12) & 1), ((_a_125 >> 13) & 1), ((_a_125 >> 14) & 1), ((_a_125 >> 15) & 1), ((_a_125 >> 16) & 1), ((_a_125 >> 17) & 1), ((_a_125 >> 18) & 1), ((_a_125 >> 19) & 1), ((_a_125 >> 20) & 1), ((_a_125 >> 21) & 1), ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_302[0];
    } else if ((_a_125 & 255) == 107) {
      Term _o_303[1];
      if (arm_106(e, _o_303, ((_a_125 >> 8) & 1), ((_a_125 >> 9) & 1), ((_a_125 >> 10) & 1), ((_a_125 >> 11) & 1), ((_a_125 >> 12) & 1), ((_a_125 >> 13) & 1), ((_a_125 >> 14) & 1), ((_a_125 >> 15) & 1), ((_a_125 >> 16) & 1), ((_a_125 >> 17) & 1), ((_a_125 >> 18) & 1), ((_a_125 >> 19) & 1), ((_a_125 >> 20) & 1), ((_a_125 >> 21) & 1), ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_303[0];
    } else if ((_a_125 & 127) == 107) {
      Term _o_304[1];
      if (arm_107(e, _o_304, ((_a_125 >> 7) & 1), ((_a_125 >> 8) & 1), ((_a_125 >> 9) & 1), ((_a_125 >> 10) & 1), ((_a_125 >> 11) & 1), ((_a_125 >> 12) & 1), ((_a_125 >> 13) & 1), ((_a_125 >> 14) & 1), ((_a_125 >> 15) & 1), ((_a_125 >> 16) & 1), ((_a_125 >> 17) & 1), ((_a_125 >> 18) & 1), ((_a_125 >> 19) & 1), ((_a_125 >> 20) & 1), ((_a_125 >> 21) & 1), ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_304[0];
    } else if ((_a_125 & 63) == 43) {
      Term _o_305[1];
      if (arm_108(e, _o_305, ((_a_125 >> 6) & 1), ((_a_125 >> 7) & 1), ((_a_125 >> 8) & 1), ((_a_125 >> 9) & 1), ((_a_125 >> 10) & 1), ((_a_125 >> 11) & 1), ((_a_125 >> 12) & 1), ((_a_125 >> 13) & 1), ((_a_125 >> 14) & 1), ((_a_125 >> 15) & 1), ((_a_125 >> 16) & 1), ((_a_125 >> 17) & 1), ((_a_125 >> 18) & 1), ((_a_125 >> 19) & 1), ((_a_125 >> 20) & 1), ((_a_125 >> 21) & 1), ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_305[0];
    } else if ((_a_125 & 31) == 11) {
      Term _o_306[1];
      if (arm_109(e, _o_306, ((_a_125 >> 5) & 1), ((_a_125 >> 6) & 1), ((_a_125 >> 7) & 1), ((_a_125 >> 8) & 1), ((_a_125 >> 9) & 1), ((_a_125 >> 10) & 1), ((_a_125 >> 11) & 1), ((_a_125 >> 12) & 1), ((_a_125 >> 13) & 1), ((_a_125 >> 14) & 1), ((_a_125 >> 15) & 1), ((_a_125 >> 16) & 1), ((_a_125 >> 17) & 1), ((_a_125 >> 18) & 1), ((_a_125 >> 19) & 1), ((_a_125 >> 20) & 1), ((_a_125 >> 21) & 1), ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_306[0];
    } else if ((_a_125 & 15) == 11) {
      Term _o_307[1];
      if (arm_110(e, _o_307, ((_a_125 >> 4) & 1), ((_a_125 >> 5) & 1), ((_a_125 >> 6) & 1), ((_a_125 >> 7) & 1), ((_a_125 >> 8) & 1), ((_a_125 >> 9) & 1), ((_a_125 >> 10) & 1), ((_a_125 >> 11) & 1), ((_a_125 >> 12) & 1), ((_a_125 >> 13) & 1), ((_a_125 >> 14) & 1), ((_a_125 >> 15) & 1), ((_a_125 >> 16) & 1), ((_a_125 >> 17) & 1), ((_a_125 >> 18) & 1), ((_a_125 >> 19) & 1), ((_a_125 >> 20) & 1), ((_a_125 >> 21) & 1), ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_307[0];
    } else if ((_a_125 & 7) == 3) {
      Term _o_308[1];
      if (arm_111(e, _o_308, ((_a_125 >> 3) & 1), ((_a_125 >> 4) & 1), ((_a_125 >> 5) & 1), ((_a_125 >> 6) & 1), ((_a_125 >> 7) & 1), ((_a_125 >> 8) & 1), ((_a_125 >> 9) & 1), ((_a_125 >> 10) & 1), ((_a_125 >> 11) & 1), ((_a_125 >> 12) & 1), ((_a_125 >> 13) & 1), ((_a_125 >> 14) & 1), ((_a_125 >> 15) & 1), ((_a_125 >> 16) & 1), ((_a_125 >> 17) & 1), ((_a_125 >> 18) & 1), ((_a_125 >> 19) & 1), ((_a_125 >> 20) & 1), ((_a_125 >> 21) & 1), ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_308[0];
    } else if ((_a_125 & 3) == 3) {
      Term _o_309[1];
      if (arm_112(e, _o_309, ((_a_125 >> 2) & 1), ((_a_125 >> 3) & 1), ((_a_125 >> 4) & 1), ((_a_125 >> 5) & 1), ((_a_125 >> 6) & 1), ((_a_125 >> 7) & 1), ((_a_125 >> 8) & 1), ((_a_125 >> 9) & 1), ((_a_125 >> 10) & 1), ((_a_125 >> 11) & 1), ((_a_125 >> 12) & 1), ((_a_125 >> 13) & 1), ((_a_125 >> 14) & 1), ((_a_125 >> 15) & 1), ((_a_125 >> 16) & 1), ((_a_125 >> 17) & 1), ((_a_125 >> 18) & 1), ((_a_125 >> 19) & 1), ((_a_125 >> 20) & 1), ((_a_125 >> 21) & 1), ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_309[0];
    } else if ((_a_125 & 1) == 1) {
      Term _o_310[1];
      if (arm_113(e, _o_310, ((_a_125 >> 1) & 1), ((_a_125 >> 2) & 1), ((_a_125 >> 3) & 1), ((_a_125 >> 4) & 1), ((_a_125 >> 5) & 1), ((_a_125 >> 6) & 1), ((_a_125 >> 7) & 1), ((_a_125 >> 8) & 1), ((_a_125 >> 9) & 1), ((_a_125 >> 10) & 1), ((_a_125 >> 11) & 1), ((_a_125 >> 12) & 1), ((_a_125 >> 13) & 1), ((_a_125 >> 14) & 1), ((_a_125 >> 15) & 1), ((_a_125 >> 16) & 1), ((_a_125 >> 17) & 1), ((_a_125 >> 18) & 1), ((_a_125 >> 19) & 1), ((_a_125 >> 20) & 1), ((_a_125 >> 21) & 1), ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_310[0];
    } else {
      Term _o_311[1];
      if (arm_114(e, _o_311, ((_a_125 >> 0) & 1), ((_a_125 >> 1) & 1), ((_a_125 >> 2) & 1), ((_a_125 >> 3) & 1), ((_a_125 >> 4) & 1), ((_a_125 >> 5) & 1), ((_a_125 >> 6) & 1), ((_a_125 >> 7) & 1), ((_a_125 >> 8) & 1), ((_a_125 >> 9) & 1), ((_a_125 >> 10) & 1), ((_a_125 >> 11) & 1), ((_a_125 >> 12) & 1), ((_a_125 >> 13) & 1), ((_a_125 >> 14) & 1), ((_a_125 >> 15) & 1), ((_a_125 >> 16) & 1), ((_a_125 >> 17) & 1), ((_a_125 >> 18) & 1), ((_a_125 >> 19) & 1), ((_a_125 >> 20) & 1), ((_a_125 >> 21) & 1), ((_a_125 >> 22) & 1), ((_a_125 >> 23) & 1), ((_a_125 >> 24) & 1), ((_a_125 >> 25) & 1), ((_a_125 >> 26) & 1), ((_a_125 >> 27) & 1), ((_a_125 >> 28) & 1), ((_a_125 >> 29) & 1), ((_a_125 >> 30) & 1), ((_a_125 >> 31) & 1), _a_126, _a_127) == 0) {
        return 0;
      }
      _v_47 = _o_311[0];
    }
  break;
  }
  o[0] = _v_47;
  return 1;
}

INLINE Term arm_46(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_46 = 0;
  u32 _a_122 = r0;
  Term _a_123 = r1;
  Term _a_124 = r2;
  WL_SPIN
    Term _o_312[1];
    if (arm_47(e, _o_312, _a_122, _a_123, _a_124) == 0) {
      return 0;
    }
    _v_46 = _o_312[0];
  break;
  }
  o[0] = _v_46;
  return 1;
}

INLINE Term arm_45(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_45 = 0;
  Term _a_120 = r0;
  Term _a_121 = r1;
  WL_SPIN
    if (term_aux(_a_120) == CID_SCON) {
      Term _fb_15[2];
      u64 _sp_16 = ctr_take(e, _a_120, 2, _fb_15);
      u32 _f_32 = _fb_15[0];
      Term _f_33 = _fb_15[1];
      Term _o_313[1];
      if (arm_46(e, _o_313, _f_32, _f_33, _a_121) == 0) {
        return 0;
      }
      _v_45 = _o_313[0];
      spare_free(e, cls_fit(2), _sp_16);
    } else {
      Term _o_314[1];
      if (arm_80(e, _o_314, _a_120, _a_121) == 0) {
        return 0;
      }
      _v_45 = _o_314[0];
    }
  break;
  }
  o[0] = _v_45;
  return 1;
}

INLINE Term arm_44(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_44 = 0;
  u32 _a_117 = r0;
  Term _a_118 = r1;
  Term _a_119 = r2;
  WL_SPIN
    if (_a_117 == 45) {
      Term _o_315[1];
      if (arm_45(e, _o_315, _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_315[0];
    } else if ((_a_117 & 2147483647) == 45) {
      Term _o_316[1];
      if (arm_83(e, _o_316, ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_316[0];
    } else if ((_a_117 & 1073741823) == 45) {
      Term _o_317[1];
      if (arm_84(e, _o_317, ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_317[0];
    } else if ((_a_117 & 536870911) == 45) {
      Term _o_318[1];
      if (arm_85(e, _o_318, ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_318[0];
    } else if ((_a_117 & 268435455) == 45) {
      Term _o_319[1];
      if (arm_86(e, _o_319, ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_319[0];
    } else if ((_a_117 & 134217727) == 45) {
      Term _o_320[1];
      if (arm_87(e, _o_320, ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_320[0];
    } else if ((_a_117 & 67108863) == 45) {
      Term _o_321[1];
      if (arm_88(e, _o_321, ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_321[0];
    } else if ((_a_117 & 33554431) == 45) {
      Term _o_322[1];
      if (arm_89(e, _o_322, ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_322[0];
    } else if ((_a_117 & 16777215) == 45) {
      Term _o_323[1];
      if (arm_90(e, _o_323, ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_323[0];
    } else if ((_a_117 & 8388607) == 45) {
      Term _o_324[1];
      if (arm_91(e, _o_324, ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_324[0];
    } else if ((_a_117 & 4194303) == 45) {
      Term _o_325[1];
      if (arm_92(e, _o_325, ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_325[0];
    } else if ((_a_117 & 2097151) == 45) {
      Term _o_326[1];
      if (arm_93(e, _o_326, ((_a_117 >> 21) & 1), ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_326[0];
    } else if ((_a_117 & 1048575) == 45) {
      Term _o_327[1];
      if (arm_94(e, _o_327, ((_a_117 >> 20) & 1), ((_a_117 >> 21) & 1), ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_327[0];
    } else if ((_a_117 & 524287) == 45) {
      Term _o_328[1];
      if (arm_95(e, _o_328, ((_a_117 >> 19) & 1), ((_a_117 >> 20) & 1), ((_a_117 >> 21) & 1), ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_328[0];
    } else if ((_a_117 & 262143) == 45) {
      Term _o_329[1];
      if (arm_96(e, _o_329, ((_a_117 >> 18) & 1), ((_a_117 >> 19) & 1), ((_a_117 >> 20) & 1), ((_a_117 >> 21) & 1), ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_329[0];
    } else if ((_a_117 & 131071) == 45) {
      Term _o_330[1];
      if (arm_97(e, _o_330, ((_a_117 >> 17) & 1), ((_a_117 >> 18) & 1), ((_a_117 >> 19) & 1), ((_a_117 >> 20) & 1), ((_a_117 >> 21) & 1), ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_330[0];
    } else if ((_a_117 & 65535) == 45) {
      Term _o_331[1];
      if (arm_98(e, _o_331, ((_a_117 >> 16) & 1), ((_a_117 >> 17) & 1), ((_a_117 >> 18) & 1), ((_a_117 >> 19) & 1), ((_a_117 >> 20) & 1), ((_a_117 >> 21) & 1), ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_331[0];
    } else if ((_a_117 & 32767) == 45) {
      Term _o_332[1];
      if (arm_99(e, _o_332, ((_a_117 >> 15) & 1), ((_a_117 >> 16) & 1), ((_a_117 >> 17) & 1), ((_a_117 >> 18) & 1), ((_a_117 >> 19) & 1), ((_a_117 >> 20) & 1), ((_a_117 >> 21) & 1), ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_332[0];
    } else if ((_a_117 & 16383) == 45) {
      Term _o_333[1];
      if (arm_100(e, _o_333, ((_a_117 >> 14) & 1), ((_a_117 >> 15) & 1), ((_a_117 >> 16) & 1), ((_a_117 >> 17) & 1), ((_a_117 >> 18) & 1), ((_a_117 >> 19) & 1), ((_a_117 >> 20) & 1), ((_a_117 >> 21) & 1), ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_333[0];
    } else if ((_a_117 & 8191) == 45) {
      Term _o_334[1];
      if (arm_101(e, _o_334, ((_a_117 >> 13) & 1), ((_a_117 >> 14) & 1), ((_a_117 >> 15) & 1), ((_a_117 >> 16) & 1), ((_a_117 >> 17) & 1), ((_a_117 >> 18) & 1), ((_a_117 >> 19) & 1), ((_a_117 >> 20) & 1), ((_a_117 >> 21) & 1), ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_334[0];
    } else if ((_a_117 & 4095) == 45) {
      Term _o_335[1];
      if (arm_102(e, _o_335, ((_a_117 >> 12) & 1), ((_a_117 >> 13) & 1), ((_a_117 >> 14) & 1), ((_a_117 >> 15) & 1), ((_a_117 >> 16) & 1), ((_a_117 >> 17) & 1), ((_a_117 >> 18) & 1), ((_a_117 >> 19) & 1), ((_a_117 >> 20) & 1), ((_a_117 >> 21) & 1), ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_335[0];
    } else if ((_a_117 & 2047) == 45) {
      Term _o_336[1];
      if (arm_103(e, _o_336, ((_a_117 >> 11) & 1), ((_a_117 >> 12) & 1), ((_a_117 >> 13) & 1), ((_a_117 >> 14) & 1), ((_a_117 >> 15) & 1), ((_a_117 >> 16) & 1), ((_a_117 >> 17) & 1), ((_a_117 >> 18) & 1), ((_a_117 >> 19) & 1), ((_a_117 >> 20) & 1), ((_a_117 >> 21) & 1), ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_336[0];
    } else if ((_a_117 & 1023) == 45) {
      Term _o_337[1];
      if (arm_104(e, _o_337, ((_a_117 >> 10) & 1), ((_a_117 >> 11) & 1), ((_a_117 >> 12) & 1), ((_a_117 >> 13) & 1), ((_a_117 >> 14) & 1), ((_a_117 >> 15) & 1), ((_a_117 >> 16) & 1), ((_a_117 >> 17) & 1), ((_a_117 >> 18) & 1), ((_a_117 >> 19) & 1), ((_a_117 >> 20) & 1), ((_a_117 >> 21) & 1), ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_337[0];
    } else if ((_a_117 & 511) == 45) {
      Term _o_338[1];
      if (arm_105(e, _o_338, ((_a_117 >> 9) & 1), ((_a_117 >> 10) & 1), ((_a_117 >> 11) & 1), ((_a_117 >> 12) & 1), ((_a_117 >> 13) & 1), ((_a_117 >> 14) & 1), ((_a_117 >> 15) & 1), ((_a_117 >> 16) & 1), ((_a_117 >> 17) & 1), ((_a_117 >> 18) & 1), ((_a_117 >> 19) & 1), ((_a_117 >> 20) & 1), ((_a_117 >> 21) & 1), ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_338[0];
    } else if ((_a_117 & 255) == 45) {
      Term _o_339[1];
      if (arm_106(e, _o_339, ((_a_117 >> 8) & 1), ((_a_117 >> 9) & 1), ((_a_117 >> 10) & 1), ((_a_117 >> 11) & 1), ((_a_117 >> 12) & 1), ((_a_117 >> 13) & 1), ((_a_117 >> 14) & 1), ((_a_117 >> 15) & 1), ((_a_117 >> 16) & 1), ((_a_117 >> 17) & 1), ((_a_117 >> 18) & 1), ((_a_117 >> 19) & 1), ((_a_117 >> 20) & 1), ((_a_117 >> 21) & 1), ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_339[0];
    } else if ((_a_117 & 127) == 45) {
      Term _o_340[1];
      if (arm_107(e, _o_340, ((_a_117 >> 7) & 1), ((_a_117 >> 8) & 1), ((_a_117 >> 9) & 1), ((_a_117 >> 10) & 1), ((_a_117 >> 11) & 1), ((_a_117 >> 12) & 1), ((_a_117 >> 13) & 1), ((_a_117 >> 14) & 1), ((_a_117 >> 15) & 1), ((_a_117 >> 16) & 1), ((_a_117 >> 17) & 1), ((_a_117 >> 18) & 1), ((_a_117 >> 19) & 1), ((_a_117 >> 20) & 1), ((_a_117 >> 21) & 1), ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_340[0];
    } else if ((_a_117 & 63) == 45) {
      Term _o_341[1];
      if (arm_108(e, _o_341, ((_a_117 >> 6) & 1), ((_a_117 >> 7) & 1), ((_a_117 >> 8) & 1), ((_a_117 >> 9) & 1), ((_a_117 >> 10) & 1), ((_a_117 >> 11) & 1), ((_a_117 >> 12) & 1), ((_a_117 >> 13) & 1), ((_a_117 >> 14) & 1), ((_a_117 >> 15) & 1), ((_a_117 >> 16) & 1), ((_a_117 >> 17) & 1), ((_a_117 >> 18) & 1), ((_a_117 >> 19) & 1), ((_a_117 >> 20) & 1), ((_a_117 >> 21) & 1), ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_341[0];
    } else if ((_a_117 & 31) == 13) {
      Term _o_342[1];
      if (arm_109(e, _o_342, ((_a_117 >> 5) & 1), ((_a_117 >> 6) & 1), ((_a_117 >> 7) & 1), ((_a_117 >> 8) & 1), ((_a_117 >> 9) & 1), ((_a_117 >> 10) & 1), ((_a_117 >> 11) & 1), ((_a_117 >> 12) & 1), ((_a_117 >> 13) & 1), ((_a_117 >> 14) & 1), ((_a_117 >> 15) & 1), ((_a_117 >> 16) & 1), ((_a_117 >> 17) & 1), ((_a_117 >> 18) & 1), ((_a_117 >> 19) & 1), ((_a_117 >> 20) & 1), ((_a_117 >> 21) & 1), ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_342[0];
    } else if ((_a_117 & 15) == 13) {
      Term _o_343[1];
      if (arm_110(e, _o_343, ((_a_117 >> 4) & 1), ((_a_117 >> 5) & 1), ((_a_117 >> 6) & 1), ((_a_117 >> 7) & 1), ((_a_117 >> 8) & 1), ((_a_117 >> 9) & 1), ((_a_117 >> 10) & 1), ((_a_117 >> 11) & 1), ((_a_117 >> 12) & 1), ((_a_117 >> 13) & 1), ((_a_117 >> 14) & 1), ((_a_117 >> 15) & 1), ((_a_117 >> 16) & 1), ((_a_117 >> 17) & 1), ((_a_117 >> 18) & 1), ((_a_117 >> 19) & 1), ((_a_117 >> 20) & 1), ((_a_117 >> 21) & 1), ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_343[0];
    } else if ((_a_117 & 7) == 5) {
      Term _o_344[1];
      if (arm_111(e, _o_344, ((_a_117 >> 3) & 1), ((_a_117 >> 4) & 1), ((_a_117 >> 5) & 1), ((_a_117 >> 6) & 1), ((_a_117 >> 7) & 1), ((_a_117 >> 8) & 1), ((_a_117 >> 9) & 1), ((_a_117 >> 10) & 1), ((_a_117 >> 11) & 1), ((_a_117 >> 12) & 1), ((_a_117 >> 13) & 1), ((_a_117 >> 14) & 1), ((_a_117 >> 15) & 1), ((_a_117 >> 16) & 1), ((_a_117 >> 17) & 1), ((_a_117 >> 18) & 1), ((_a_117 >> 19) & 1), ((_a_117 >> 20) & 1), ((_a_117 >> 21) & 1), ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_344[0];
    } else if ((_a_117 & 3) == 1) {
      Term _o_345[1];
      if (arm_112(e, _o_345, ((_a_117 >> 2) & 1), ((_a_117 >> 3) & 1), ((_a_117 >> 4) & 1), ((_a_117 >> 5) & 1), ((_a_117 >> 6) & 1), ((_a_117 >> 7) & 1), ((_a_117 >> 8) & 1), ((_a_117 >> 9) & 1), ((_a_117 >> 10) & 1), ((_a_117 >> 11) & 1), ((_a_117 >> 12) & 1), ((_a_117 >> 13) & 1), ((_a_117 >> 14) & 1), ((_a_117 >> 15) & 1), ((_a_117 >> 16) & 1), ((_a_117 >> 17) & 1), ((_a_117 >> 18) & 1), ((_a_117 >> 19) & 1), ((_a_117 >> 20) & 1), ((_a_117 >> 21) & 1), ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_345[0];
    } else if ((_a_117 & 1) == 1) {
      Term _o_346[1];
      if (arm_113(e, _o_346, ((_a_117 >> 1) & 1), ((_a_117 >> 2) & 1), ((_a_117 >> 3) & 1), ((_a_117 >> 4) & 1), ((_a_117 >> 5) & 1), ((_a_117 >> 6) & 1), ((_a_117 >> 7) & 1), ((_a_117 >> 8) & 1), ((_a_117 >> 9) & 1), ((_a_117 >> 10) & 1), ((_a_117 >> 11) & 1), ((_a_117 >> 12) & 1), ((_a_117 >> 13) & 1), ((_a_117 >> 14) & 1), ((_a_117 >> 15) & 1), ((_a_117 >> 16) & 1), ((_a_117 >> 17) & 1), ((_a_117 >> 18) & 1), ((_a_117 >> 19) & 1), ((_a_117 >> 20) & 1), ((_a_117 >> 21) & 1), ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_346[0];
    } else {
      Term _o_347[1];
      if (arm_114(e, _o_347, ((_a_117 >> 0) & 1), ((_a_117 >> 1) & 1), ((_a_117 >> 2) & 1), ((_a_117 >> 3) & 1), ((_a_117 >> 4) & 1), ((_a_117 >> 5) & 1), ((_a_117 >> 6) & 1), ((_a_117 >> 7) & 1), ((_a_117 >> 8) & 1), ((_a_117 >> 9) & 1), ((_a_117 >> 10) & 1), ((_a_117 >> 11) & 1), ((_a_117 >> 12) & 1), ((_a_117 >> 13) & 1), ((_a_117 >> 14) & 1), ((_a_117 >> 15) & 1), ((_a_117 >> 16) & 1), ((_a_117 >> 17) & 1), ((_a_117 >> 18) & 1), ((_a_117 >> 19) & 1), ((_a_117 >> 20) & 1), ((_a_117 >> 21) & 1), ((_a_117 >> 22) & 1), ((_a_117 >> 23) & 1), ((_a_117 >> 24) & 1), ((_a_117 >> 25) & 1), ((_a_117 >> 26) & 1), ((_a_117 >> 27) & 1), ((_a_117 >> 28) & 1), ((_a_117 >> 29) & 1), ((_a_117 >> 30) & 1), ((_a_117 >> 31) & 1), _a_118, _a_119) == 0) {
        return 0;
      }
      _v_44 = _o_347[0];
    }
  break;
  }
  o[0] = _v_44;
  return 1;
}

INLINE Term arm_43(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_43 = 0;
  u32 _a_114 = r0;
  Term _a_115 = r1;
  Term _a_116 = r2;
  WL_SPIN
    Term _o_348[1];
    if (arm_44(e, _o_348, _a_114, _a_115, _a_116) == 0) {
      return 0;
    }
    _v_43 = _o_348[0];
  break;
  }
  o[0] = _v_43;
  return 1;
}

INLINE Term arm_42(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_42 = 0;
  Term _a_112 = r0;
  Term _a_113 = r1;
  WL_SPIN
    if (term_aux(_a_112) == CID_SCON) {
      Term _fb_14[2];
      u64 _sp_15 = ctr_take(e, _a_112, 2, _fb_14);
      u32 _f_30 = _fb_14[0];
      Term _f_31 = _fb_14[1];
      Term _o_349[1];
      if (arm_43(e, _o_349, _f_30, _f_31, _a_113) == 0) {
        return 0;
      }
      _v_42 = _o_349[0];
      spare_free(e, cls_fit(2), _sp_15);
    } else {
      Term _o_350[1];
      if (arm_80(e, _o_350, _a_112, _a_113) == 0) {
        return 0;
      }
      _v_42 = _o_350[0];
    }
  break;
  }
  o[0] = _v_42;
  return 1;
}

INLINE Term arm_41(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_41 = 0;
  u32 _a_109 = r0;
  Term _a_110 = r1;
  Term _a_111 = r2;
  WL_SPIN
    if (_a_109 == 115) {
      Term _o_351[1];
      if (arm_42(e, _o_351, _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_351[0];
    } else if ((_a_109 & 2147483647) == 115) {
      Term _o_352[1];
      if (arm_83(e, _o_352, ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_352[0];
    } else if ((_a_109 & 1073741823) == 115) {
      Term _o_353[1];
      if (arm_84(e, _o_353, ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_353[0];
    } else if ((_a_109 & 536870911) == 115) {
      Term _o_354[1];
      if (arm_85(e, _o_354, ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_354[0];
    } else if ((_a_109 & 268435455) == 115) {
      Term _o_355[1];
      if (arm_86(e, _o_355, ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_355[0];
    } else if ((_a_109 & 134217727) == 115) {
      Term _o_356[1];
      if (arm_87(e, _o_356, ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_356[0];
    } else if ((_a_109 & 67108863) == 115) {
      Term _o_357[1];
      if (arm_88(e, _o_357, ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_357[0];
    } else if ((_a_109 & 33554431) == 115) {
      Term _o_358[1];
      if (arm_89(e, _o_358, ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_358[0];
    } else if ((_a_109 & 16777215) == 115) {
      Term _o_359[1];
      if (arm_90(e, _o_359, ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_359[0];
    } else if ((_a_109 & 8388607) == 115) {
      Term _o_360[1];
      if (arm_91(e, _o_360, ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_360[0];
    } else if ((_a_109 & 4194303) == 115) {
      Term _o_361[1];
      if (arm_92(e, _o_361, ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_361[0];
    } else if ((_a_109 & 2097151) == 115) {
      Term _o_362[1];
      if (arm_93(e, _o_362, ((_a_109 >> 21) & 1), ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_362[0];
    } else if ((_a_109 & 1048575) == 115) {
      Term _o_363[1];
      if (arm_94(e, _o_363, ((_a_109 >> 20) & 1), ((_a_109 >> 21) & 1), ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_363[0];
    } else if ((_a_109 & 524287) == 115) {
      Term _o_364[1];
      if (arm_95(e, _o_364, ((_a_109 >> 19) & 1), ((_a_109 >> 20) & 1), ((_a_109 >> 21) & 1), ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_364[0];
    } else if ((_a_109 & 262143) == 115) {
      Term _o_365[1];
      if (arm_96(e, _o_365, ((_a_109 >> 18) & 1), ((_a_109 >> 19) & 1), ((_a_109 >> 20) & 1), ((_a_109 >> 21) & 1), ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_365[0];
    } else if ((_a_109 & 131071) == 115) {
      Term _o_366[1];
      if (arm_97(e, _o_366, ((_a_109 >> 17) & 1), ((_a_109 >> 18) & 1), ((_a_109 >> 19) & 1), ((_a_109 >> 20) & 1), ((_a_109 >> 21) & 1), ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_366[0];
    } else if ((_a_109 & 65535) == 115) {
      Term _o_367[1];
      if (arm_98(e, _o_367, ((_a_109 >> 16) & 1), ((_a_109 >> 17) & 1), ((_a_109 >> 18) & 1), ((_a_109 >> 19) & 1), ((_a_109 >> 20) & 1), ((_a_109 >> 21) & 1), ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_367[0];
    } else if ((_a_109 & 32767) == 115) {
      Term _o_368[1];
      if (arm_99(e, _o_368, ((_a_109 >> 15) & 1), ((_a_109 >> 16) & 1), ((_a_109 >> 17) & 1), ((_a_109 >> 18) & 1), ((_a_109 >> 19) & 1), ((_a_109 >> 20) & 1), ((_a_109 >> 21) & 1), ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_368[0];
    } else if ((_a_109 & 16383) == 115) {
      Term _o_369[1];
      if (arm_100(e, _o_369, ((_a_109 >> 14) & 1), ((_a_109 >> 15) & 1), ((_a_109 >> 16) & 1), ((_a_109 >> 17) & 1), ((_a_109 >> 18) & 1), ((_a_109 >> 19) & 1), ((_a_109 >> 20) & 1), ((_a_109 >> 21) & 1), ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_369[0];
    } else if ((_a_109 & 8191) == 115) {
      Term _o_370[1];
      if (arm_101(e, _o_370, ((_a_109 >> 13) & 1), ((_a_109 >> 14) & 1), ((_a_109 >> 15) & 1), ((_a_109 >> 16) & 1), ((_a_109 >> 17) & 1), ((_a_109 >> 18) & 1), ((_a_109 >> 19) & 1), ((_a_109 >> 20) & 1), ((_a_109 >> 21) & 1), ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_370[0];
    } else if ((_a_109 & 4095) == 115) {
      Term _o_371[1];
      if (arm_102(e, _o_371, ((_a_109 >> 12) & 1), ((_a_109 >> 13) & 1), ((_a_109 >> 14) & 1), ((_a_109 >> 15) & 1), ((_a_109 >> 16) & 1), ((_a_109 >> 17) & 1), ((_a_109 >> 18) & 1), ((_a_109 >> 19) & 1), ((_a_109 >> 20) & 1), ((_a_109 >> 21) & 1), ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_371[0];
    } else if ((_a_109 & 2047) == 115) {
      Term _o_372[1];
      if (arm_103(e, _o_372, ((_a_109 >> 11) & 1), ((_a_109 >> 12) & 1), ((_a_109 >> 13) & 1), ((_a_109 >> 14) & 1), ((_a_109 >> 15) & 1), ((_a_109 >> 16) & 1), ((_a_109 >> 17) & 1), ((_a_109 >> 18) & 1), ((_a_109 >> 19) & 1), ((_a_109 >> 20) & 1), ((_a_109 >> 21) & 1), ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_372[0];
    } else if ((_a_109 & 1023) == 115) {
      Term _o_373[1];
      if (arm_104(e, _o_373, ((_a_109 >> 10) & 1), ((_a_109 >> 11) & 1), ((_a_109 >> 12) & 1), ((_a_109 >> 13) & 1), ((_a_109 >> 14) & 1), ((_a_109 >> 15) & 1), ((_a_109 >> 16) & 1), ((_a_109 >> 17) & 1), ((_a_109 >> 18) & 1), ((_a_109 >> 19) & 1), ((_a_109 >> 20) & 1), ((_a_109 >> 21) & 1), ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_373[0];
    } else if ((_a_109 & 511) == 115) {
      Term _o_374[1];
      if (arm_105(e, _o_374, ((_a_109 >> 9) & 1), ((_a_109 >> 10) & 1), ((_a_109 >> 11) & 1), ((_a_109 >> 12) & 1), ((_a_109 >> 13) & 1), ((_a_109 >> 14) & 1), ((_a_109 >> 15) & 1), ((_a_109 >> 16) & 1), ((_a_109 >> 17) & 1), ((_a_109 >> 18) & 1), ((_a_109 >> 19) & 1), ((_a_109 >> 20) & 1), ((_a_109 >> 21) & 1), ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_374[0];
    } else if ((_a_109 & 255) == 115) {
      Term _o_375[1];
      if (arm_106(e, _o_375, ((_a_109 >> 8) & 1), ((_a_109 >> 9) & 1), ((_a_109 >> 10) & 1), ((_a_109 >> 11) & 1), ((_a_109 >> 12) & 1), ((_a_109 >> 13) & 1), ((_a_109 >> 14) & 1), ((_a_109 >> 15) & 1), ((_a_109 >> 16) & 1), ((_a_109 >> 17) & 1), ((_a_109 >> 18) & 1), ((_a_109 >> 19) & 1), ((_a_109 >> 20) & 1), ((_a_109 >> 21) & 1), ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_375[0];
    } else if ((_a_109 & 127) == 115) {
      Term _o_376[1];
      if (arm_107(e, _o_376, ((_a_109 >> 7) & 1), ((_a_109 >> 8) & 1), ((_a_109 >> 9) & 1), ((_a_109 >> 10) & 1), ((_a_109 >> 11) & 1), ((_a_109 >> 12) & 1), ((_a_109 >> 13) & 1), ((_a_109 >> 14) & 1), ((_a_109 >> 15) & 1), ((_a_109 >> 16) & 1), ((_a_109 >> 17) & 1), ((_a_109 >> 18) & 1), ((_a_109 >> 19) & 1), ((_a_109 >> 20) & 1), ((_a_109 >> 21) & 1), ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_376[0];
    } else if ((_a_109 & 63) == 51) {
      Term _o_377[1];
      if (arm_108(e, _o_377, ((_a_109 >> 6) & 1), ((_a_109 >> 7) & 1), ((_a_109 >> 8) & 1), ((_a_109 >> 9) & 1), ((_a_109 >> 10) & 1), ((_a_109 >> 11) & 1), ((_a_109 >> 12) & 1), ((_a_109 >> 13) & 1), ((_a_109 >> 14) & 1), ((_a_109 >> 15) & 1), ((_a_109 >> 16) & 1), ((_a_109 >> 17) & 1), ((_a_109 >> 18) & 1), ((_a_109 >> 19) & 1), ((_a_109 >> 20) & 1), ((_a_109 >> 21) & 1), ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_377[0];
    } else if ((_a_109 & 31) == 19) {
      Term _o_378[1];
      if (arm_109(e, _o_378, ((_a_109 >> 5) & 1), ((_a_109 >> 6) & 1), ((_a_109 >> 7) & 1), ((_a_109 >> 8) & 1), ((_a_109 >> 9) & 1), ((_a_109 >> 10) & 1), ((_a_109 >> 11) & 1), ((_a_109 >> 12) & 1), ((_a_109 >> 13) & 1), ((_a_109 >> 14) & 1), ((_a_109 >> 15) & 1), ((_a_109 >> 16) & 1), ((_a_109 >> 17) & 1), ((_a_109 >> 18) & 1), ((_a_109 >> 19) & 1), ((_a_109 >> 20) & 1), ((_a_109 >> 21) & 1), ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_378[0];
    } else if ((_a_109 & 15) == 3) {
      Term _o_379[1];
      if (arm_110(e, _o_379, ((_a_109 >> 4) & 1), ((_a_109 >> 5) & 1), ((_a_109 >> 6) & 1), ((_a_109 >> 7) & 1), ((_a_109 >> 8) & 1), ((_a_109 >> 9) & 1), ((_a_109 >> 10) & 1), ((_a_109 >> 11) & 1), ((_a_109 >> 12) & 1), ((_a_109 >> 13) & 1), ((_a_109 >> 14) & 1), ((_a_109 >> 15) & 1), ((_a_109 >> 16) & 1), ((_a_109 >> 17) & 1), ((_a_109 >> 18) & 1), ((_a_109 >> 19) & 1), ((_a_109 >> 20) & 1), ((_a_109 >> 21) & 1), ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_379[0];
    } else if ((_a_109 & 7) == 3) {
      Term _o_380[1];
      if (arm_111(e, _o_380, ((_a_109 >> 3) & 1), ((_a_109 >> 4) & 1), ((_a_109 >> 5) & 1), ((_a_109 >> 6) & 1), ((_a_109 >> 7) & 1), ((_a_109 >> 8) & 1), ((_a_109 >> 9) & 1), ((_a_109 >> 10) & 1), ((_a_109 >> 11) & 1), ((_a_109 >> 12) & 1), ((_a_109 >> 13) & 1), ((_a_109 >> 14) & 1), ((_a_109 >> 15) & 1), ((_a_109 >> 16) & 1), ((_a_109 >> 17) & 1), ((_a_109 >> 18) & 1), ((_a_109 >> 19) & 1), ((_a_109 >> 20) & 1), ((_a_109 >> 21) & 1), ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_380[0];
    } else if ((_a_109 & 3) == 3) {
      Term _o_381[1];
      if (arm_112(e, _o_381, ((_a_109 >> 2) & 1), ((_a_109 >> 3) & 1), ((_a_109 >> 4) & 1), ((_a_109 >> 5) & 1), ((_a_109 >> 6) & 1), ((_a_109 >> 7) & 1), ((_a_109 >> 8) & 1), ((_a_109 >> 9) & 1), ((_a_109 >> 10) & 1), ((_a_109 >> 11) & 1), ((_a_109 >> 12) & 1), ((_a_109 >> 13) & 1), ((_a_109 >> 14) & 1), ((_a_109 >> 15) & 1), ((_a_109 >> 16) & 1), ((_a_109 >> 17) & 1), ((_a_109 >> 18) & 1), ((_a_109 >> 19) & 1), ((_a_109 >> 20) & 1), ((_a_109 >> 21) & 1), ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_381[0];
    } else if ((_a_109 & 1) == 1) {
      Term _o_382[1];
      if (arm_113(e, _o_382, ((_a_109 >> 1) & 1), ((_a_109 >> 2) & 1), ((_a_109 >> 3) & 1), ((_a_109 >> 4) & 1), ((_a_109 >> 5) & 1), ((_a_109 >> 6) & 1), ((_a_109 >> 7) & 1), ((_a_109 >> 8) & 1), ((_a_109 >> 9) & 1), ((_a_109 >> 10) & 1), ((_a_109 >> 11) & 1), ((_a_109 >> 12) & 1), ((_a_109 >> 13) & 1), ((_a_109 >> 14) & 1), ((_a_109 >> 15) & 1), ((_a_109 >> 16) & 1), ((_a_109 >> 17) & 1), ((_a_109 >> 18) & 1), ((_a_109 >> 19) & 1), ((_a_109 >> 20) & 1), ((_a_109 >> 21) & 1), ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_382[0];
    } else {
      Term _o_383[1];
      if (arm_114(e, _o_383, ((_a_109 >> 0) & 1), ((_a_109 >> 1) & 1), ((_a_109 >> 2) & 1), ((_a_109 >> 3) & 1), ((_a_109 >> 4) & 1), ((_a_109 >> 5) & 1), ((_a_109 >> 6) & 1), ((_a_109 >> 7) & 1), ((_a_109 >> 8) & 1), ((_a_109 >> 9) & 1), ((_a_109 >> 10) & 1), ((_a_109 >> 11) & 1), ((_a_109 >> 12) & 1), ((_a_109 >> 13) & 1), ((_a_109 >> 14) & 1), ((_a_109 >> 15) & 1), ((_a_109 >> 16) & 1), ((_a_109 >> 17) & 1), ((_a_109 >> 18) & 1), ((_a_109 >> 19) & 1), ((_a_109 >> 20) & 1), ((_a_109 >> 21) & 1), ((_a_109 >> 22) & 1), ((_a_109 >> 23) & 1), ((_a_109 >> 24) & 1), ((_a_109 >> 25) & 1), ((_a_109 >> 26) & 1), ((_a_109 >> 27) & 1), ((_a_109 >> 28) & 1), ((_a_109 >> 29) & 1), ((_a_109 >> 30) & 1), ((_a_109 >> 31) & 1), _a_110, _a_111) == 0) {
        return 0;
      }
      _v_41 = _o_383[0];
    }
  break;
  }
  o[0] = _v_41;
  return 1;
}

INLINE Term arm_40(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_40 = 0;
  u32 _a_106 = r0;
  Term _a_107 = r1;
  Term _a_108 = r2;
  WL_SPIN
    Term _o_384[1];
    if (arm_41(e, _o_384, _a_106, _a_107, _a_108) == 0) {
      return 0;
    }
    _v_40 = _o_384[0];
  break;
  }
  o[0] = _v_40;
  return 1;
}

INLINE Term arm_39(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_39 = 0;
  Term _a_104 = r0;
  Term _a_105 = r1;
  WL_SPIN
    if (term_aux(_a_104) == CID_SCON) {
      Term _fb_13[2];
      u64 _sp_14 = ctr_take(e, _a_104, 2, _fb_13);
      u32 _f_28 = _fb_13[0];
      Term _f_29 = _fb_13[1];
      Term _o_385[1];
      if (arm_40(e, _o_385, _f_28, _f_29, _a_105) == 0) {
        return 0;
      }
      _v_39 = _o_385[0];
      spare_free(e, cls_fit(2), _sp_14);
    } else {
      Term _o_386[1];
      if (arm_80(e, _o_386, _a_104, _a_105) == 0) {
        return 0;
      }
      _v_39 = _o_386[0];
    }
  break;
  }
  o[0] = _v_39;
  return 1;
}

INLINE Term arm_38(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_38 = 0;
  u32 _a_101 = r0;
  Term _a_102 = r1;
  Term _a_103 = r2;
  WL_SPIN
    if (_a_101 == 115) {
      Term _o_387[1];
      if (arm_39(e, _o_387, _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_387[0];
    } else if ((_a_101 & 2147483647) == 115) {
      Term _o_388[1];
      if (arm_83(e, _o_388, ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_388[0];
    } else if ((_a_101 & 1073741823) == 115) {
      Term _o_389[1];
      if (arm_84(e, _o_389, ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_389[0];
    } else if ((_a_101 & 536870911) == 115) {
      Term _o_390[1];
      if (arm_85(e, _o_390, ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_390[0];
    } else if ((_a_101 & 268435455) == 115) {
      Term _o_391[1];
      if (arm_86(e, _o_391, ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_391[0];
    } else if ((_a_101 & 134217727) == 115) {
      Term _o_392[1];
      if (arm_87(e, _o_392, ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_392[0];
    } else if ((_a_101 & 67108863) == 115) {
      Term _o_393[1];
      if (arm_88(e, _o_393, ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_393[0];
    } else if ((_a_101 & 33554431) == 115) {
      Term _o_394[1];
      if (arm_89(e, _o_394, ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_394[0];
    } else if ((_a_101 & 16777215) == 115) {
      Term _o_395[1];
      if (arm_90(e, _o_395, ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_395[0];
    } else if ((_a_101 & 8388607) == 115) {
      Term _o_396[1];
      if (arm_91(e, _o_396, ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_396[0];
    } else if ((_a_101 & 4194303) == 115) {
      Term _o_397[1];
      if (arm_92(e, _o_397, ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_397[0];
    } else if ((_a_101 & 2097151) == 115) {
      Term _o_398[1];
      if (arm_93(e, _o_398, ((_a_101 >> 21) & 1), ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_398[0];
    } else if ((_a_101 & 1048575) == 115) {
      Term _o_399[1];
      if (arm_94(e, _o_399, ((_a_101 >> 20) & 1), ((_a_101 >> 21) & 1), ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_399[0];
    } else if ((_a_101 & 524287) == 115) {
      Term _o_400[1];
      if (arm_95(e, _o_400, ((_a_101 >> 19) & 1), ((_a_101 >> 20) & 1), ((_a_101 >> 21) & 1), ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_400[0];
    } else if ((_a_101 & 262143) == 115) {
      Term _o_401[1];
      if (arm_96(e, _o_401, ((_a_101 >> 18) & 1), ((_a_101 >> 19) & 1), ((_a_101 >> 20) & 1), ((_a_101 >> 21) & 1), ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_401[0];
    } else if ((_a_101 & 131071) == 115) {
      Term _o_402[1];
      if (arm_97(e, _o_402, ((_a_101 >> 17) & 1), ((_a_101 >> 18) & 1), ((_a_101 >> 19) & 1), ((_a_101 >> 20) & 1), ((_a_101 >> 21) & 1), ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_402[0];
    } else if ((_a_101 & 65535) == 115) {
      Term _o_403[1];
      if (arm_98(e, _o_403, ((_a_101 >> 16) & 1), ((_a_101 >> 17) & 1), ((_a_101 >> 18) & 1), ((_a_101 >> 19) & 1), ((_a_101 >> 20) & 1), ((_a_101 >> 21) & 1), ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_403[0];
    } else if ((_a_101 & 32767) == 115) {
      Term _o_404[1];
      if (arm_99(e, _o_404, ((_a_101 >> 15) & 1), ((_a_101 >> 16) & 1), ((_a_101 >> 17) & 1), ((_a_101 >> 18) & 1), ((_a_101 >> 19) & 1), ((_a_101 >> 20) & 1), ((_a_101 >> 21) & 1), ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_404[0];
    } else if ((_a_101 & 16383) == 115) {
      Term _o_405[1];
      if (arm_100(e, _o_405, ((_a_101 >> 14) & 1), ((_a_101 >> 15) & 1), ((_a_101 >> 16) & 1), ((_a_101 >> 17) & 1), ((_a_101 >> 18) & 1), ((_a_101 >> 19) & 1), ((_a_101 >> 20) & 1), ((_a_101 >> 21) & 1), ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_405[0];
    } else if ((_a_101 & 8191) == 115) {
      Term _o_406[1];
      if (arm_101(e, _o_406, ((_a_101 >> 13) & 1), ((_a_101 >> 14) & 1), ((_a_101 >> 15) & 1), ((_a_101 >> 16) & 1), ((_a_101 >> 17) & 1), ((_a_101 >> 18) & 1), ((_a_101 >> 19) & 1), ((_a_101 >> 20) & 1), ((_a_101 >> 21) & 1), ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_406[0];
    } else if ((_a_101 & 4095) == 115) {
      Term _o_407[1];
      if (arm_102(e, _o_407, ((_a_101 >> 12) & 1), ((_a_101 >> 13) & 1), ((_a_101 >> 14) & 1), ((_a_101 >> 15) & 1), ((_a_101 >> 16) & 1), ((_a_101 >> 17) & 1), ((_a_101 >> 18) & 1), ((_a_101 >> 19) & 1), ((_a_101 >> 20) & 1), ((_a_101 >> 21) & 1), ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_407[0];
    } else if ((_a_101 & 2047) == 115) {
      Term _o_408[1];
      if (arm_103(e, _o_408, ((_a_101 >> 11) & 1), ((_a_101 >> 12) & 1), ((_a_101 >> 13) & 1), ((_a_101 >> 14) & 1), ((_a_101 >> 15) & 1), ((_a_101 >> 16) & 1), ((_a_101 >> 17) & 1), ((_a_101 >> 18) & 1), ((_a_101 >> 19) & 1), ((_a_101 >> 20) & 1), ((_a_101 >> 21) & 1), ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_408[0];
    } else if ((_a_101 & 1023) == 115) {
      Term _o_409[1];
      if (arm_104(e, _o_409, ((_a_101 >> 10) & 1), ((_a_101 >> 11) & 1), ((_a_101 >> 12) & 1), ((_a_101 >> 13) & 1), ((_a_101 >> 14) & 1), ((_a_101 >> 15) & 1), ((_a_101 >> 16) & 1), ((_a_101 >> 17) & 1), ((_a_101 >> 18) & 1), ((_a_101 >> 19) & 1), ((_a_101 >> 20) & 1), ((_a_101 >> 21) & 1), ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_409[0];
    } else if ((_a_101 & 511) == 115) {
      Term _o_410[1];
      if (arm_105(e, _o_410, ((_a_101 >> 9) & 1), ((_a_101 >> 10) & 1), ((_a_101 >> 11) & 1), ((_a_101 >> 12) & 1), ((_a_101 >> 13) & 1), ((_a_101 >> 14) & 1), ((_a_101 >> 15) & 1), ((_a_101 >> 16) & 1), ((_a_101 >> 17) & 1), ((_a_101 >> 18) & 1), ((_a_101 >> 19) & 1), ((_a_101 >> 20) & 1), ((_a_101 >> 21) & 1), ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_410[0];
    } else if ((_a_101 & 255) == 115) {
      Term _o_411[1];
      if (arm_106(e, _o_411, ((_a_101 >> 8) & 1), ((_a_101 >> 9) & 1), ((_a_101 >> 10) & 1), ((_a_101 >> 11) & 1), ((_a_101 >> 12) & 1), ((_a_101 >> 13) & 1), ((_a_101 >> 14) & 1), ((_a_101 >> 15) & 1), ((_a_101 >> 16) & 1), ((_a_101 >> 17) & 1), ((_a_101 >> 18) & 1), ((_a_101 >> 19) & 1), ((_a_101 >> 20) & 1), ((_a_101 >> 21) & 1), ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_411[0];
    } else if ((_a_101 & 127) == 115) {
      Term _o_412[1];
      if (arm_107(e, _o_412, ((_a_101 >> 7) & 1), ((_a_101 >> 8) & 1), ((_a_101 >> 9) & 1), ((_a_101 >> 10) & 1), ((_a_101 >> 11) & 1), ((_a_101 >> 12) & 1), ((_a_101 >> 13) & 1), ((_a_101 >> 14) & 1), ((_a_101 >> 15) & 1), ((_a_101 >> 16) & 1), ((_a_101 >> 17) & 1), ((_a_101 >> 18) & 1), ((_a_101 >> 19) & 1), ((_a_101 >> 20) & 1), ((_a_101 >> 21) & 1), ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_412[0];
    } else if ((_a_101 & 63) == 51) {
      Term _o_413[1];
      if (arm_108(e, _o_413, ((_a_101 >> 6) & 1), ((_a_101 >> 7) & 1), ((_a_101 >> 8) & 1), ((_a_101 >> 9) & 1), ((_a_101 >> 10) & 1), ((_a_101 >> 11) & 1), ((_a_101 >> 12) & 1), ((_a_101 >> 13) & 1), ((_a_101 >> 14) & 1), ((_a_101 >> 15) & 1), ((_a_101 >> 16) & 1), ((_a_101 >> 17) & 1), ((_a_101 >> 18) & 1), ((_a_101 >> 19) & 1), ((_a_101 >> 20) & 1), ((_a_101 >> 21) & 1), ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_413[0];
    } else if ((_a_101 & 31) == 19) {
      Term _o_414[1];
      if (arm_109(e, _o_414, ((_a_101 >> 5) & 1), ((_a_101 >> 6) & 1), ((_a_101 >> 7) & 1), ((_a_101 >> 8) & 1), ((_a_101 >> 9) & 1), ((_a_101 >> 10) & 1), ((_a_101 >> 11) & 1), ((_a_101 >> 12) & 1), ((_a_101 >> 13) & 1), ((_a_101 >> 14) & 1), ((_a_101 >> 15) & 1), ((_a_101 >> 16) & 1), ((_a_101 >> 17) & 1), ((_a_101 >> 18) & 1), ((_a_101 >> 19) & 1), ((_a_101 >> 20) & 1), ((_a_101 >> 21) & 1), ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_414[0];
    } else if ((_a_101 & 15) == 3) {
      Term _o_415[1];
      if (arm_110(e, _o_415, ((_a_101 >> 4) & 1), ((_a_101 >> 5) & 1), ((_a_101 >> 6) & 1), ((_a_101 >> 7) & 1), ((_a_101 >> 8) & 1), ((_a_101 >> 9) & 1), ((_a_101 >> 10) & 1), ((_a_101 >> 11) & 1), ((_a_101 >> 12) & 1), ((_a_101 >> 13) & 1), ((_a_101 >> 14) & 1), ((_a_101 >> 15) & 1), ((_a_101 >> 16) & 1), ((_a_101 >> 17) & 1), ((_a_101 >> 18) & 1), ((_a_101 >> 19) & 1), ((_a_101 >> 20) & 1), ((_a_101 >> 21) & 1), ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_415[0];
    } else if ((_a_101 & 7) == 3) {
      Term _o_416[1];
      if (arm_111(e, _o_416, ((_a_101 >> 3) & 1), ((_a_101 >> 4) & 1), ((_a_101 >> 5) & 1), ((_a_101 >> 6) & 1), ((_a_101 >> 7) & 1), ((_a_101 >> 8) & 1), ((_a_101 >> 9) & 1), ((_a_101 >> 10) & 1), ((_a_101 >> 11) & 1), ((_a_101 >> 12) & 1), ((_a_101 >> 13) & 1), ((_a_101 >> 14) & 1), ((_a_101 >> 15) & 1), ((_a_101 >> 16) & 1), ((_a_101 >> 17) & 1), ((_a_101 >> 18) & 1), ((_a_101 >> 19) & 1), ((_a_101 >> 20) & 1), ((_a_101 >> 21) & 1), ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_416[0];
    } else if ((_a_101 & 3) == 3) {
      Term _o_417[1];
      if (arm_112(e, _o_417, ((_a_101 >> 2) & 1), ((_a_101 >> 3) & 1), ((_a_101 >> 4) & 1), ((_a_101 >> 5) & 1), ((_a_101 >> 6) & 1), ((_a_101 >> 7) & 1), ((_a_101 >> 8) & 1), ((_a_101 >> 9) & 1), ((_a_101 >> 10) & 1), ((_a_101 >> 11) & 1), ((_a_101 >> 12) & 1), ((_a_101 >> 13) & 1), ((_a_101 >> 14) & 1), ((_a_101 >> 15) & 1), ((_a_101 >> 16) & 1), ((_a_101 >> 17) & 1), ((_a_101 >> 18) & 1), ((_a_101 >> 19) & 1), ((_a_101 >> 20) & 1), ((_a_101 >> 21) & 1), ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_417[0];
    } else if ((_a_101 & 1) == 1) {
      Term _o_418[1];
      if (arm_113(e, _o_418, ((_a_101 >> 1) & 1), ((_a_101 >> 2) & 1), ((_a_101 >> 3) & 1), ((_a_101 >> 4) & 1), ((_a_101 >> 5) & 1), ((_a_101 >> 6) & 1), ((_a_101 >> 7) & 1), ((_a_101 >> 8) & 1), ((_a_101 >> 9) & 1), ((_a_101 >> 10) & 1), ((_a_101 >> 11) & 1), ((_a_101 >> 12) & 1), ((_a_101 >> 13) & 1), ((_a_101 >> 14) & 1), ((_a_101 >> 15) & 1), ((_a_101 >> 16) & 1), ((_a_101 >> 17) & 1), ((_a_101 >> 18) & 1), ((_a_101 >> 19) & 1), ((_a_101 >> 20) & 1), ((_a_101 >> 21) & 1), ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_418[0];
    } else {
      Term _o_419[1];
      if (arm_114(e, _o_419, ((_a_101 >> 0) & 1), ((_a_101 >> 1) & 1), ((_a_101 >> 2) & 1), ((_a_101 >> 3) & 1), ((_a_101 >> 4) & 1), ((_a_101 >> 5) & 1), ((_a_101 >> 6) & 1), ((_a_101 >> 7) & 1), ((_a_101 >> 8) & 1), ((_a_101 >> 9) & 1), ((_a_101 >> 10) & 1), ((_a_101 >> 11) & 1), ((_a_101 >> 12) & 1), ((_a_101 >> 13) & 1), ((_a_101 >> 14) & 1), ((_a_101 >> 15) & 1), ((_a_101 >> 16) & 1), ((_a_101 >> 17) & 1), ((_a_101 >> 18) & 1), ((_a_101 >> 19) & 1), ((_a_101 >> 20) & 1), ((_a_101 >> 21) & 1), ((_a_101 >> 22) & 1), ((_a_101 >> 23) & 1), ((_a_101 >> 24) & 1), ((_a_101 >> 25) & 1), ((_a_101 >> 26) & 1), ((_a_101 >> 27) & 1), ((_a_101 >> 28) & 1), ((_a_101 >> 29) & 1), ((_a_101 >> 30) & 1), ((_a_101 >> 31) & 1), _a_102, _a_103) == 0) {
        return 0;
      }
      _v_38 = _o_419[0];
    }
  break;
  }
  o[0] = _v_38;
  return 1;
}

INLINE Term arm_37(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_37 = 0;
  u32 _a_98 = r0;
  Term _a_99 = r1;
  Term _a_100 = r2;
  WL_SPIN
    Term _o_420[1];
    if (arm_38(e, _o_420, _a_98, _a_99, _a_100) == 0) {
      return 0;
    }
    _v_37 = _o_420[0];
  break;
  }
  o[0] = _v_37;
  return 1;
}

INLINE Term arm_36(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_36 = 0;
  Term _a_96 = r0;
  Term _a_97 = r1;
  WL_SPIN
    if (term_aux(_a_96) == CID_SCON) {
      Term _fb_12[2];
      u64 _sp_13 = ctr_take(e, _a_96, 2, _fb_12);
      u32 _f_26 = _fb_12[0];
      Term _f_27 = _fb_12[1];
      Term _o_421[1];
      if (arm_37(e, _o_421, _f_26, _f_27, _a_97) == 0) {
        return 0;
      }
      _v_36 = _o_421[0];
      spare_free(e, cls_fit(2), _sp_13);
    } else {
      Term _o_422[1];
      if (arm_80(e, _o_422, _a_96, _a_97) == 0) {
        return 0;
      }
      _v_36 = _o_422[0];
    }
  break;
  }
  o[0] = _v_36;
  return 1;
}

INLINE Term arm_35(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_35 = 0;
  u32 _a_93 = r0;
  Term _a_94 = r1;
  Term _a_95 = r2;
  WL_SPIN
    if (_a_93 == 101) {
      Term _o_423[1];
      if (arm_36(e, _o_423, _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_423[0];
    } else if ((_a_93 & 2147483647) == 101) {
      Term _o_424[1];
      if (arm_83(e, _o_424, ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_424[0];
    } else if ((_a_93 & 1073741823) == 101) {
      Term _o_425[1];
      if (arm_84(e, _o_425, ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_425[0];
    } else if ((_a_93 & 536870911) == 101) {
      Term _o_426[1];
      if (arm_85(e, _o_426, ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_426[0];
    } else if ((_a_93 & 268435455) == 101) {
      Term _o_427[1];
      if (arm_86(e, _o_427, ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_427[0];
    } else if ((_a_93 & 134217727) == 101) {
      Term _o_428[1];
      if (arm_87(e, _o_428, ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_428[0];
    } else if ((_a_93 & 67108863) == 101) {
      Term _o_429[1];
      if (arm_88(e, _o_429, ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_429[0];
    } else if ((_a_93 & 33554431) == 101) {
      Term _o_430[1];
      if (arm_89(e, _o_430, ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_430[0];
    } else if ((_a_93 & 16777215) == 101) {
      Term _o_431[1];
      if (arm_90(e, _o_431, ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_431[0];
    } else if ((_a_93 & 8388607) == 101) {
      Term _o_432[1];
      if (arm_91(e, _o_432, ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_432[0];
    } else if ((_a_93 & 4194303) == 101) {
      Term _o_433[1];
      if (arm_92(e, _o_433, ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_433[0];
    } else if ((_a_93 & 2097151) == 101) {
      Term _o_434[1];
      if (arm_93(e, _o_434, ((_a_93 >> 21) & 1), ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_434[0];
    } else if ((_a_93 & 1048575) == 101) {
      Term _o_435[1];
      if (arm_94(e, _o_435, ((_a_93 >> 20) & 1), ((_a_93 >> 21) & 1), ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_435[0];
    } else if ((_a_93 & 524287) == 101) {
      Term _o_436[1];
      if (arm_95(e, _o_436, ((_a_93 >> 19) & 1), ((_a_93 >> 20) & 1), ((_a_93 >> 21) & 1), ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_436[0];
    } else if ((_a_93 & 262143) == 101) {
      Term _o_437[1];
      if (arm_96(e, _o_437, ((_a_93 >> 18) & 1), ((_a_93 >> 19) & 1), ((_a_93 >> 20) & 1), ((_a_93 >> 21) & 1), ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_437[0];
    } else if ((_a_93 & 131071) == 101) {
      Term _o_438[1];
      if (arm_97(e, _o_438, ((_a_93 >> 17) & 1), ((_a_93 >> 18) & 1), ((_a_93 >> 19) & 1), ((_a_93 >> 20) & 1), ((_a_93 >> 21) & 1), ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_438[0];
    } else if ((_a_93 & 65535) == 101) {
      Term _o_439[1];
      if (arm_98(e, _o_439, ((_a_93 >> 16) & 1), ((_a_93 >> 17) & 1), ((_a_93 >> 18) & 1), ((_a_93 >> 19) & 1), ((_a_93 >> 20) & 1), ((_a_93 >> 21) & 1), ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_439[0];
    } else if ((_a_93 & 32767) == 101) {
      Term _o_440[1];
      if (arm_99(e, _o_440, ((_a_93 >> 15) & 1), ((_a_93 >> 16) & 1), ((_a_93 >> 17) & 1), ((_a_93 >> 18) & 1), ((_a_93 >> 19) & 1), ((_a_93 >> 20) & 1), ((_a_93 >> 21) & 1), ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_440[0];
    } else if ((_a_93 & 16383) == 101) {
      Term _o_441[1];
      if (arm_100(e, _o_441, ((_a_93 >> 14) & 1), ((_a_93 >> 15) & 1), ((_a_93 >> 16) & 1), ((_a_93 >> 17) & 1), ((_a_93 >> 18) & 1), ((_a_93 >> 19) & 1), ((_a_93 >> 20) & 1), ((_a_93 >> 21) & 1), ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_441[0];
    } else if ((_a_93 & 8191) == 101) {
      Term _o_442[1];
      if (arm_101(e, _o_442, ((_a_93 >> 13) & 1), ((_a_93 >> 14) & 1), ((_a_93 >> 15) & 1), ((_a_93 >> 16) & 1), ((_a_93 >> 17) & 1), ((_a_93 >> 18) & 1), ((_a_93 >> 19) & 1), ((_a_93 >> 20) & 1), ((_a_93 >> 21) & 1), ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_442[0];
    } else if ((_a_93 & 4095) == 101) {
      Term _o_443[1];
      if (arm_102(e, _o_443, ((_a_93 >> 12) & 1), ((_a_93 >> 13) & 1), ((_a_93 >> 14) & 1), ((_a_93 >> 15) & 1), ((_a_93 >> 16) & 1), ((_a_93 >> 17) & 1), ((_a_93 >> 18) & 1), ((_a_93 >> 19) & 1), ((_a_93 >> 20) & 1), ((_a_93 >> 21) & 1), ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_443[0];
    } else if ((_a_93 & 2047) == 101) {
      Term _o_444[1];
      if (arm_103(e, _o_444, ((_a_93 >> 11) & 1), ((_a_93 >> 12) & 1), ((_a_93 >> 13) & 1), ((_a_93 >> 14) & 1), ((_a_93 >> 15) & 1), ((_a_93 >> 16) & 1), ((_a_93 >> 17) & 1), ((_a_93 >> 18) & 1), ((_a_93 >> 19) & 1), ((_a_93 >> 20) & 1), ((_a_93 >> 21) & 1), ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_444[0];
    } else if ((_a_93 & 1023) == 101) {
      Term _o_445[1];
      if (arm_104(e, _o_445, ((_a_93 >> 10) & 1), ((_a_93 >> 11) & 1), ((_a_93 >> 12) & 1), ((_a_93 >> 13) & 1), ((_a_93 >> 14) & 1), ((_a_93 >> 15) & 1), ((_a_93 >> 16) & 1), ((_a_93 >> 17) & 1), ((_a_93 >> 18) & 1), ((_a_93 >> 19) & 1), ((_a_93 >> 20) & 1), ((_a_93 >> 21) & 1), ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_445[0];
    } else if ((_a_93 & 511) == 101) {
      Term _o_446[1];
      if (arm_105(e, _o_446, ((_a_93 >> 9) & 1), ((_a_93 >> 10) & 1), ((_a_93 >> 11) & 1), ((_a_93 >> 12) & 1), ((_a_93 >> 13) & 1), ((_a_93 >> 14) & 1), ((_a_93 >> 15) & 1), ((_a_93 >> 16) & 1), ((_a_93 >> 17) & 1), ((_a_93 >> 18) & 1), ((_a_93 >> 19) & 1), ((_a_93 >> 20) & 1), ((_a_93 >> 21) & 1), ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_446[0];
    } else if ((_a_93 & 255) == 101) {
      Term _o_447[1];
      if (arm_106(e, _o_447, ((_a_93 >> 8) & 1), ((_a_93 >> 9) & 1), ((_a_93 >> 10) & 1), ((_a_93 >> 11) & 1), ((_a_93 >> 12) & 1), ((_a_93 >> 13) & 1), ((_a_93 >> 14) & 1), ((_a_93 >> 15) & 1), ((_a_93 >> 16) & 1), ((_a_93 >> 17) & 1), ((_a_93 >> 18) & 1), ((_a_93 >> 19) & 1), ((_a_93 >> 20) & 1), ((_a_93 >> 21) & 1), ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_447[0];
    } else if ((_a_93 & 127) == 101) {
      Term _o_448[1];
      if (arm_107(e, _o_448, ((_a_93 >> 7) & 1), ((_a_93 >> 8) & 1), ((_a_93 >> 9) & 1), ((_a_93 >> 10) & 1), ((_a_93 >> 11) & 1), ((_a_93 >> 12) & 1), ((_a_93 >> 13) & 1), ((_a_93 >> 14) & 1), ((_a_93 >> 15) & 1), ((_a_93 >> 16) & 1), ((_a_93 >> 17) & 1), ((_a_93 >> 18) & 1), ((_a_93 >> 19) & 1), ((_a_93 >> 20) & 1), ((_a_93 >> 21) & 1), ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_448[0];
    } else if ((_a_93 & 63) == 37) {
      Term _o_449[1];
      if (arm_108(e, _o_449, ((_a_93 >> 6) & 1), ((_a_93 >> 7) & 1), ((_a_93 >> 8) & 1), ((_a_93 >> 9) & 1), ((_a_93 >> 10) & 1), ((_a_93 >> 11) & 1), ((_a_93 >> 12) & 1), ((_a_93 >> 13) & 1), ((_a_93 >> 14) & 1), ((_a_93 >> 15) & 1), ((_a_93 >> 16) & 1), ((_a_93 >> 17) & 1), ((_a_93 >> 18) & 1), ((_a_93 >> 19) & 1), ((_a_93 >> 20) & 1), ((_a_93 >> 21) & 1), ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_449[0];
    } else if ((_a_93 & 31) == 5) {
      Term _o_450[1];
      if (arm_109(e, _o_450, ((_a_93 >> 5) & 1), ((_a_93 >> 6) & 1), ((_a_93 >> 7) & 1), ((_a_93 >> 8) & 1), ((_a_93 >> 9) & 1), ((_a_93 >> 10) & 1), ((_a_93 >> 11) & 1), ((_a_93 >> 12) & 1), ((_a_93 >> 13) & 1), ((_a_93 >> 14) & 1), ((_a_93 >> 15) & 1), ((_a_93 >> 16) & 1), ((_a_93 >> 17) & 1), ((_a_93 >> 18) & 1), ((_a_93 >> 19) & 1), ((_a_93 >> 20) & 1), ((_a_93 >> 21) & 1), ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_450[0];
    } else if ((_a_93 & 15) == 5) {
      Term _o_451[1];
      if (arm_110(e, _o_451, ((_a_93 >> 4) & 1), ((_a_93 >> 5) & 1), ((_a_93 >> 6) & 1), ((_a_93 >> 7) & 1), ((_a_93 >> 8) & 1), ((_a_93 >> 9) & 1), ((_a_93 >> 10) & 1), ((_a_93 >> 11) & 1), ((_a_93 >> 12) & 1), ((_a_93 >> 13) & 1), ((_a_93 >> 14) & 1), ((_a_93 >> 15) & 1), ((_a_93 >> 16) & 1), ((_a_93 >> 17) & 1), ((_a_93 >> 18) & 1), ((_a_93 >> 19) & 1), ((_a_93 >> 20) & 1), ((_a_93 >> 21) & 1), ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_451[0];
    } else if ((_a_93 & 7) == 5) {
      Term _o_452[1];
      if (arm_111(e, _o_452, ((_a_93 >> 3) & 1), ((_a_93 >> 4) & 1), ((_a_93 >> 5) & 1), ((_a_93 >> 6) & 1), ((_a_93 >> 7) & 1), ((_a_93 >> 8) & 1), ((_a_93 >> 9) & 1), ((_a_93 >> 10) & 1), ((_a_93 >> 11) & 1), ((_a_93 >> 12) & 1), ((_a_93 >> 13) & 1), ((_a_93 >> 14) & 1), ((_a_93 >> 15) & 1), ((_a_93 >> 16) & 1), ((_a_93 >> 17) & 1), ((_a_93 >> 18) & 1), ((_a_93 >> 19) & 1), ((_a_93 >> 20) & 1), ((_a_93 >> 21) & 1), ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_452[0];
    } else if ((_a_93 & 3) == 1) {
      Term _o_453[1];
      if (arm_112(e, _o_453, ((_a_93 >> 2) & 1), ((_a_93 >> 3) & 1), ((_a_93 >> 4) & 1), ((_a_93 >> 5) & 1), ((_a_93 >> 6) & 1), ((_a_93 >> 7) & 1), ((_a_93 >> 8) & 1), ((_a_93 >> 9) & 1), ((_a_93 >> 10) & 1), ((_a_93 >> 11) & 1), ((_a_93 >> 12) & 1), ((_a_93 >> 13) & 1), ((_a_93 >> 14) & 1), ((_a_93 >> 15) & 1), ((_a_93 >> 16) & 1), ((_a_93 >> 17) & 1), ((_a_93 >> 18) & 1), ((_a_93 >> 19) & 1), ((_a_93 >> 20) & 1), ((_a_93 >> 21) & 1), ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_453[0];
    } else if ((_a_93 & 1) == 1) {
      Term _o_454[1];
      if (arm_113(e, _o_454, ((_a_93 >> 1) & 1), ((_a_93 >> 2) & 1), ((_a_93 >> 3) & 1), ((_a_93 >> 4) & 1), ((_a_93 >> 5) & 1), ((_a_93 >> 6) & 1), ((_a_93 >> 7) & 1), ((_a_93 >> 8) & 1), ((_a_93 >> 9) & 1), ((_a_93 >> 10) & 1), ((_a_93 >> 11) & 1), ((_a_93 >> 12) & 1), ((_a_93 >> 13) & 1), ((_a_93 >> 14) & 1), ((_a_93 >> 15) & 1), ((_a_93 >> 16) & 1), ((_a_93 >> 17) & 1), ((_a_93 >> 18) & 1), ((_a_93 >> 19) & 1), ((_a_93 >> 20) & 1), ((_a_93 >> 21) & 1), ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_454[0];
    } else {
      Term _o_455[1];
      if (arm_114(e, _o_455, ((_a_93 >> 0) & 1), ((_a_93 >> 1) & 1), ((_a_93 >> 2) & 1), ((_a_93 >> 3) & 1), ((_a_93 >> 4) & 1), ((_a_93 >> 5) & 1), ((_a_93 >> 6) & 1), ((_a_93 >> 7) & 1), ((_a_93 >> 8) & 1), ((_a_93 >> 9) & 1), ((_a_93 >> 10) & 1), ((_a_93 >> 11) & 1), ((_a_93 >> 12) & 1), ((_a_93 >> 13) & 1), ((_a_93 >> 14) & 1), ((_a_93 >> 15) & 1), ((_a_93 >> 16) & 1), ((_a_93 >> 17) & 1), ((_a_93 >> 18) & 1), ((_a_93 >> 19) & 1), ((_a_93 >> 20) & 1), ((_a_93 >> 21) & 1), ((_a_93 >> 22) & 1), ((_a_93 >> 23) & 1), ((_a_93 >> 24) & 1), ((_a_93 >> 25) & 1), ((_a_93 >> 26) & 1), ((_a_93 >> 27) & 1), ((_a_93 >> 28) & 1), ((_a_93 >> 29) & 1), ((_a_93 >> 30) & 1), ((_a_93 >> 31) & 1), _a_94, _a_95) == 0) {
        return 0;
      }
      _v_35 = _o_455[0];
    }
  break;
  }
  o[0] = _v_35;
  return 1;
}

INLINE Term arm_34(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_34 = 0;
  u32 _a_90 = r0;
  Term _a_91 = r1;
  Term _a_92 = r2;
  WL_SPIN
    Term _o_456[1];
    if (arm_35(e, _o_456, _a_90, _a_91, _a_92) == 0) {
      return 0;
    }
    _v_34 = _o_456[0];
  break;
  }
  o[0] = _v_34;
  return 1;
}

INLINE Term arm_33(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_33 = 0;
  Term _a_88 = r0;
  Term _a_89 = r1;
  WL_SPIN
    if (term_aux(_a_88) == CID_SCON) {
      Term _fb_11[2];
      u64 _sp_12 = ctr_take(e, _a_88, 2, _fb_11);
      u32 _f_24 = _fb_11[0];
      Term _f_25 = _fb_11[1];
      Term _o_457[1];
      if (arm_34(e, _o_457, _f_24, _f_25, _a_89) == 0) {
        return 0;
      }
      _v_33 = _o_457[0];
      spare_free(e, cls_fit(2), _sp_12);
    } else {
      Term _o_458[1];
      if (arm_80(e, _o_458, _a_88, _a_89) == 0) {
        return 0;
      }
      _v_33 = _o_458[0];
    }
  break;
  }
  o[0] = _v_33;
  return 1;
}

INLINE Term arm_32(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_32 = 0;
  u32 _a_85 = r0;
  Term _a_86 = r1;
  Term _a_87 = r2;
  WL_SPIN
    if (_a_85 == 99) {
      Term _o_459[1];
      if (arm_33(e, _o_459, _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_459[0];
    } else if ((_a_85 & 2147483647) == 99) {
      Term _o_460[1];
      if (arm_83(e, _o_460, ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_460[0];
    } else if ((_a_85 & 1073741823) == 99) {
      Term _o_461[1];
      if (arm_84(e, _o_461, ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_461[0];
    } else if ((_a_85 & 536870911) == 99) {
      Term _o_462[1];
      if (arm_85(e, _o_462, ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_462[0];
    } else if ((_a_85 & 268435455) == 99) {
      Term _o_463[1];
      if (arm_86(e, _o_463, ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_463[0];
    } else if ((_a_85 & 134217727) == 99) {
      Term _o_464[1];
      if (arm_87(e, _o_464, ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_464[0];
    } else if ((_a_85 & 67108863) == 99) {
      Term _o_465[1];
      if (arm_88(e, _o_465, ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_465[0];
    } else if ((_a_85 & 33554431) == 99) {
      Term _o_466[1];
      if (arm_89(e, _o_466, ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_466[0];
    } else if ((_a_85 & 16777215) == 99) {
      Term _o_467[1];
      if (arm_90(e, _o_467, ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_467[0];
    } else if ((_a_85 & 8388607) == 99) {
      Term _o_468[1];
      if (arm_91(e, _o_468, ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_468[0];
    } else if ((_a_85 & 4194303) == 99) {
      Term _o_469[1];
      if (arm_92(e, _o_469, ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_469[0];
    } else if ((_a_85 & 2097151) == 99) {
      Term _o_470[1];
      if (arm_93(e, _o_470, ((_a_85 >> 21) & 1), ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_470[0];
    } else if ((_a_85 & 1048575) == 99) {
      Term _o_471[1];
      if (arm_94(e, _o_471, ((_a_85 >> 20) & 1), ((_a_85 >> 21) & 1), ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_471[0];
    } else if ((_a_85 & 524287) == 99) {
      Term _o_472[1];
      if (arm_95(e, _o_472, ((_a_85 >> 19) & 1), ((_a_85 >> 20) & 1), ((_a_85 >> 21) & 1), ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_472[0];
    } else if ((_a_85 & 262143) == 99) {
      Term _o_473[1];
      if (arm_96(e, _o_473, ((_a_85 >> 18) & 1), ((_a_85 >> 19) & 1), ((_a_85 >> 20) & 1), ((_a_85 >> 21) & 1), ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_473[0];
    } else if ((_a_85 & 131071) == 99) {
      Term _o_474[1];
      if (arm_97(e, _o_474, ((_a_85 >> 17) & 1), ((_a_85 >> 18) & 1), ((_a_85 >> 19) & 1), ((_a_85 >> 20) & 1), ((_a_85 >> 21) & 1), ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_474[0];
    } else if ((_a_85 & 65535) == 99) {
      Term _o_475[1];
      if (arm_98(e, _o_475, ((_a_85 >> 16) & 1), ((_a_85 >> 17) & 1), ((_a_85 >> 18) & 1), ((_a_85 >> 19) & 1), ((_a_85 >> 20) & 1), ((_a_85 >> 21) & 1), ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_475[0];
    } else if ((_a_85 & 32767) == 99) {
      Term _o_476[1];
      if (arm_99(e, _o_476, ((_a_85 >> 15) & 1), ((_a_85 >> 16) & 1), ((_a_85 >> 17) & 1), ((_a_85 >> 18) & 1), ((_a_85 >> 19) & 1), ((_a_85 >> 20) & 1), ((_a_85 >> 21) & 1), ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_476[0];
    } else if ((_a_85 & 16383) == 99) {
      Term _o_477[1];
      if (arm_100(e, _o_477, ((_a_85 >> 14) & 1), ((_a_85 >> 15) & 1), ((_a_85 >> 16) & 1), ((_a_85 >> 17) & 1), ((_a_85 >> 18) & 1), ((_a_85 >> 19) & 1), ((_a_85 >> 20) & 1), ((_a_85 >> 21) & 1), ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_477[0];
    } else if ((_a_85 & 8191) == 99) {
      Term _o_478[1];
      if (arm_101(e, _o_478, ((_a_85 >> 13) & 1), ((_a_85 >> 14) & 1), ((_a_85 >> 15) & 1), ((_a_85 >> 16) & 1), ((_a_85 >> 17) & 1), ((_a_85 >> 18) & 1), ((_a_85 >> 19) & 1), ((_a_85 >> 20) & 1), ((_a_85 >> 21) & 1), ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_478[0];
    } else if ((_a_85 & 4095) == 99) {
      Term _o_479[1];
      if (arm_102(e, _o_479, ((_a_85 >> 12) & 1), ((_a_85 >> 13) & 1), ((_a_85 >> 14) & 1), ((_a_85 >> 15) & 1), ((_a_85 >> 16) & 1), ((_a_85 >> 17) & 1), ((_a_85 >> 18) & 1), ((_a_85 >> 19) & 1), ((_a_85 >> 20) & 1), ((_a_85 >> 21) & 1), ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_479[0];
    } else if ((_a_85 & 2047) == 99) {
      Term _o_480[1];
      if (arm_103(e, _o_480, ((_a_85 >> 11) & 1), ((_a_85 >> 12) & 1), ((_a_85 >> 13) & 1), ((_a_85 >> 14) & 1), ((_a_85 >> 15) & 1), ((_a_85 >> 16) & 1), ((_a_85 >> 17) & 1), ((_a_85 >> 18) & 1), ((_a_85 >> 19) & 1), ((_a_85 >> 20) & 1), ((_a_85 >> 21) & 1), ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_480[0];
    } else if ((_a_85 & 1023) == 99) {
      Term _o_481[1];
      if (arm_104(e, _o_481, ((_a_85 >> 10) & 1), ((_a_85 >> 11) & 1), ((_a_85 >> 12) & 1), ((_a_85 >> 13) & 1), ((_a_85 >> 14) & 1), ((_a_85 >> 15) & 1), ((_a_85 >> 16) & 1), ((_a_85 >> 17) & 1), ((_a_85 >> 18) & 1), ((_a_85 >> 19) & 1), ((_a_85 >> 20) & 1), ((_a_85 >> 21) & 1), ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_481[0];
    } else if ((_a_85 & 511) == 99) {
      Term _o_482[1];
      if (arm_105(e, _o_482, ((_a_85 >> 9) & 1), ((_a_85 >> 10) & 1), ((_a_85 >> 11) & 1), ((_a_85 >> 12) & 1), ((_a_85 >> 13) & 1), ((_a_85 >> 14) & 1), ((_a_85 >> 15) & 1), ((_a_85 >> 16) & 1), ((_a_85 >> 17) & 1), ((_a_85 >> 18) & 1), ((_a_85 >> 19) & 1), ((_a_85 >> 20) & 1), ((_a_85 >> 21) & 1), ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_482[0];
    } else if ((_a_85 & 255) == 99) {
      Term _o_483[1];
      if (arm_106(e, _o_483, ((_a_85 >> 8) & 1), ((_a_85 >> 9) & 1), ((_a_85 >> 10) & 1), ((_a_85 >> 11) & 1), ((_a_85 >> 12) & 1), ((_a_85 >> 13) & 1), ((_a_85 >> 14) & 1), ((_a_85 >> 15) & 1), ((_a_85 >> 16) & 1), ((_a_85 >> 17) & 1), ((_a_85 >> 18) & 1), ((_a_85 >> 19) & 1), ((_a_85 >> 20) & 1), ((_a_85 >> 21) & 1), ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_483[0];
    } else if ((_a_85 & 127) == 99) {
      Term _o_484[1];
      if (arm_107(e, _o_484, ((_a_85 >> 7) & 1), ((_a_85 >> 8) & 1), ((_a_85 >> 9) & 1), ((_a_85 >> 10) & 1), ((_a_85 >> 11) & 1), ((_a_85 >> 12) & 1), ((_a_85 >> 13) & 1), ((_a_85 >> 14) & 1), ((_a_85 >> 15) & 1), ((_a_85 >> 16) & 1), ((_a_85 >> 17) & 1), ((_a_85 >> 18) & 1), ((_a_85 >> 19) & 1), ((_a_85 >> 20) & 1), ((_a_85 >> 21) & 1), ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_484[0];
    } else if ((_a_85 & 63) == 35) {
      Term _o_485[1];
      if (arm_108(e, _o_485, ((_a_85 >> 6) & 1), ((_a_85 >> 7) & 1), ((_a_85 >> 8) & 1), ((_a_85 >> 9) & 1), ((_a_85 >> 10) & 1), ((_a_85 >> 11) & 1), ((_a_85 >> 12) & 1), ((_a_85 >> 13) & 1), ((_a_85 >> 14) & 1), ((_a_85 >> 15) & 1), ((_a_85 >> 16) & 1), ((_a_85 >> 17) & 1), ((_a_85 >> 18) & 1), ((_a_85 >> 19) & 1), ((_a_85 >> 20) & 1), ((_a_85 >> 21) & 1), ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_485[0];
    } else if ((_a_85 & 31) == 3) {
      Term _o_486[1];
      if (arm_109(e, _o_486, ((_a_85 >> 5) & 1), ((_a_85 >> 6) & 1), ((_a_85 >> 7) & 1), ((_a_85 >> 8) & 1), ((_a_85 >> 9) & 1), ((_a_85 >> 10) & 1), ((_a_85 >> 11) & 1), ((_a_85 >> 12) & 1), ((_a_85 >> 13) & 1), ((_a_85 >> 14) & 1), ((_a_85 >> 15) & 1), ((_a_85 >> 16) & 1), ((_a_85 >> 17) & 1), ((_a_85 >> 18) & 1), ((_a_85 >> 19) & 1), ((_a_85 >> 20) & 1), ((_a_85 >> 21) & 1), ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_486[0];
    } else if ((_a_85 & 15) == 3) {
      Term _o_487[1];
      if (arm_110(e, _o_487, ((_a_85 >> 4) & 1), ((_a_85 >> 5) & 1), ((_a_85 >> 6) & 1), ((_a_85 >> 7) & 1), ((_a_85 >> 8) & 1), ((_a_85 >> 9) & 1), ((_a_85 >> 10) & 1), ((_a_85 >> 11) & 1), ((_a_85 >> 12) & 1), ((_a_85 >> 13) & 1), ((_a_85 >> 14) & 1), ((_a_85 >> 15) & 1), ((_a_85 >> 16) & 1), ((_a_85 >> 17) & 1), ((_a_85 >> 18) & 1), ((_a_85 >> 19) & 1), ((_a_85 >> 20) & 1), ((_a_85 >> 21) & 1), ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_487[0];
    } else if ((_a_85 & 7) == 3) {
      Term _o_488[1];
      if (arm_111(e, _o_488, ((_a_85 >> 3) & 1), ((_a_85 >> 4) & 1), ((_a_85 >> 5) & 1), ((_a_85 >> 6) & 1), ((_a_85 >> 7) & 1), ((_a_85 >> 8) & 1), ((_a_85 >> 9) & 1), ((_a_85 >> 10) & 1), ((_a_85 >> 11) & 1), ((_a_85 >> 12) & 1), ((_a_85 >> 13) & 1), ((_a_85 >> 14) & 1), ((_a_85 >> 15) & 1), ((_a_85 >> 16) & 1), ((_a_85 >> 17) & 1), ((_a_85 >> 18) & 1), ((_a_85 >> 19) & 1), ((_a_85 >> 20) & 1), ((_a_85 >> 21) & 1), ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_488[0];
    } else if ((_a_85 & 3) == 3) {
      Term _o_489[1];
      if (arm_112(e, _o_489, ((_a_85 >> 2) & 1), ((_a_85 >> 3) & 1), ((_a_85 >> 4) & 1), ((_a_85 >> 5) & 1), ((_a_85 >> 6) & 1), ((_a_85 >> 7) & 1), ((_a_85 >> 8) & 1), ((_a_85 >> 9) & 1), ((_a_85 >> 10) & 1), ((_a_85 >> 11) & 1), ((_a_85 >> 12) & 1), ((_a_85 >> 13) & 1), ((_a_85 >> 14) & 1), ((_a_85 >> 15) & 1), ((_a_85 >> 16) & 1), ((_a_85 >> 17) & 1), ((_a_85 >> 18) & 1), ((_a_85 >> 19) & 1), ((_a_85 >> 20) & 1), ((_a_85 >> 21) & 1), ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_489[0];
    } else if ((_a_85 & 1) == 1) {
      Term _o_490[1];
      if (arm_113(e, _o_490, ((_a_85 >> 1) & 1), ((_a_85 >> 2) & 1), ((_a_85 >> 3) & 1), ((_a_85 >> 4) & 1), ((_a_85 >> 5) & 1), ((_a_85 >> 6) & 1), ((_a_85 >> 7) & 1), ((_a_85 >> 8) & 1), ((_a_85 >> 9) & 1), ((_a_85 >> 10) & 1), ((_a_85 >> 11) & 1), ((_a_85 >> 12) & 1), ((_a_85 >> 13) & 1), ((_a_85 >> 14) & 1), ((_a_85 >> 15) & 1), ((_a_85 >> 16) & 1), ((_a_85 >> 17) & 1), ((_a_85 >> 18) & 1), ((_a_85 >> 19) & 1), ((_a_85 >> 20) & 1), ((_a_85 >> 21) & 1), ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_490[0];
    } else {
      Term _o_491[1];
      if (arm_114(e, _o_491, ((_a_85 >> 0) & 1), ((_a_85 >> 1) & 1), ((_a_85 >> 2) & 1), ((_a_85 >> 3) & 1), ((_a_85 >> 4) & 1), ((_a_85 >> 5) & 1), ((_a_85 >> 6) & 1), ((_a_85 >> 7) & 1), ((_a_85 >> 8) & 1), ((_a_85 >> 9) & 1), ((_a_85 >> 10) & 1), ((_a_85 >> 11) & 1), ((_a_85 >> 12) & 1), ((_a_85 >> 13) & 1), ((_a_85 >> 14) & 1), ((_a_85 >> 15) & 1), ((_a_85 >> 16) & 1), ((_a_85 >> 17) & 1), ((_a_85 >> 18) & 1), ((_a_85 >> 19) & 1), ((_a_85 >> 20) & 1), ((_a_85 >> 21) & 1), ((_a_85 >> 22) & 1), ((_a_85 >> 23) & 1), ((_a_85 >> 24) & 1), ((_a_85 >> 25) & 1), ((_a_85 >> 26) & 1), ((_a_85 >> 27) & 1), ((_a_85 >> 28) & 1), ((_a_85 >> 29) & 1), ((_a_85 >> 30) & 1), ((_a_85 >> 31) & 1), _a_86, _a_87) == 0) {
        return 0;
      }
      _v_32 = _o_491[0];
    }
  break;
  }
  o[0] = _v_32;
  return 1;
}

INLINE Term arm_31(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_31 = 0;
  u32 _a_82 = r0;
  Term _a_83 = r1;
  Term _a_84 = r2;
  WL_SPIN
    Term _o_492[1];
    if (arm_32(e, _o_492, _a_82, _a_83, _a_84) == 0) {
      return 0;
    }
    _v_31 = _o_492[0];
  break;
  }
  o[0] = _v_31;
  return 1;
}

INLINE Term arm_30(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_30 = 0;
  Term _a_80 = r0;
  Term _a_81 = r1;
  WL_SPIN
    if (term_aux(_a_80) == CID_SCON) {
      Term _fb_10[2];
      u64 _sp_11 = ctr_take(e, _a_80, 2, _fb_10);
      u32 _f_22 = _fb_10[0];
      Term _f_23 = _fb_10[1];
      Term _o_493[1];
      if (arm_31(e, _o_493, _f_22, _f_23, _a_81) == 0) {
        return 0;
      }
      _v_30 = _o_493[0];
      spare_free(e, cls_fit(2), _sp_11);
    } else {
      Term _o_494[1];
      if (arm_80(e, _o_494, _a_80, _a_81) == 0) {
        return 0;
      }
      _v_30 = _o_494[0];
    }
  break;
  }
  o[0] = _v_30;
  return 1;
}

INLINE Term arm_29(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_29 = 0;
  u32 _a_77 = r0;
  Term _a_78 = r1;
  Term _a_79 = r2;
  WL_SPIN
    if (_a_77 == 111) {
      Term _o_495[1];
      if (arm_30(e, _o_495, _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_495[0];
    } else if ((_a_77 & 2147483647) == 111) {
      Term _o_496[1];
      if (arm_83(e, _o_496, ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_496[0];
    } else if ((_a_77 & 1073741823) == 111) {
      Term _o_497[1];
      if (arm_84(e, _o_497, ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_497[0];
    } else if ((_a_77 & 536870911) == 111) {
      Term _o_498[1];
      if (arm_85(e, _o_498, ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_498[0];
    } else if ((_a_77 & 268435455) == 111) {
      Term _o_499[1];
      if (arm_86(e, _o_499, ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_499[0];
    } else if ((_a_77 & 134217727) == 111) {
      Term _o_500[1];
      if (arm_87(e, _o_500, ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_500[0];
    } else if ((_a_77 & 67108863) == 111) {
      Term _o_501[1];
      if (arm_88(e, _o_501, ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_501[0];
    } else if ((_a_77 & 33554431) == 111) {
      Term _o_502[1];
      if (arm_89(e, _o_502, ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_502[0];
    } else if ((_a_77 & 16777215) == 111) {
      Term _o_503[1];
      if (arm_90(e, _o_503, ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_503[0];
    } else if ((_a_77 & 8388607) == 111) {
      Term _o_504[1];
      if (arm_91(e, _o_504, ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_504[0];
    } else if ((_a_77 & 4194303) == 111) {
      Term _o_505[1];
      if (arm_92(e, _o_505, ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_505[0];
    } else if ((_a_77 & 2097151) == 111) {
      Term _o_506[1];
      if (arm_93(e, _o_506, ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_506[0];
    } else if ((_a_77 & 1048575) == 111) {
      Term _o_507[1];
      if (arm_94(e, _o_507, ((_a_77 >> 20) & 1), ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_507[0];
    } else if ((_a_77 & 524287) == 111) {
      Term _o_508[1];
      if (arm_95(e, _o_508, ((_a_77 >> 19) & 1), ((_a_77 >> 20) & 1), ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_508[0];
    } else if ((_a_77 & 262143) == 111) {
      Term _o_509[1];
      if (arm_96(e, _o_509, ((_a_77 >> 18) & 1), ((_a_77 >> 19) & 1), ((_a_77 >> 20) & 1), ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_509[0];
    } else if ((_a_77 & 131071) == 111) {
      Term _o_510[1];
      if (arm_97(e, _o_510, ((_a_77 >> 17) & 1), ((_a_77 >> 18) & 1), ((_a_77 >> 19) & 1), ((_a_77 >> 20) & 1), ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_510[0];
    } else if ((_a_77 & 65535) == 111) {
      Term _o_511[1];
      if (arm_98(e, _o_511, ((_a_77 >> 16) & 1), ((_a_77 >> 17) & 1), ((_a_77 >> 18) & 1), ((_a_77 >> 19) & 1), ((_a_77 >> 20) & 1), ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_511[0];
    } else if ((_a_77 & 32767) == 111) {
      Term _o_512[1];
      if (arm_99(e, _o_512, ((_a_77 >> 15) & 1), ((_a_77 >> 16) & 1), ((_a_77 >> 17) & 1), ((_a_77 >> 18) & 1), ((_a_77 >> 19) & 1), ((_a_77 >> 20) & 1), ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_512[0];
    } else if ((_a_77 & 16383) == 111) {
      Term _o_513[1];
      if (arm_100(e, _o_513, ((_a_77 >> 14) & 1), ((_a_77 >> 15) & 1), ((_a_77 >> 16) & 1), ((_a_77 >> 17) & 1), ((_a_77 >> 18) & 1), ((_a_77 >> 19) & 1), ((_a_77 >> 20) & 1), ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_513[0];
    } else if ((_a_77 & 8191) == 111) {
      Term _o_514[1];
      if (arm_101(e, _o_514, ((_a_77 >> 13) & 1), ((_a_77 >> 14) & 1), ((_a_77 >> 15) & 1), ((_a_77 >> 16) & 1), ((_a_77 >> 17) & 1), ((_a_77 >> 18) & 1), ((_a_77 >> 19) & 1), ((_a_77 >> 20) & 1), ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_514[0];
    } else if ((_a_77 & 4095) == 111) {
      Term _o_515[1];
      if (arm_102(e, _o_515, ((_a_77 >> 12) & 1), ((_a_77 >> 13) & 1), ((_a_77 >> 14) & 1), ((_a_77 >> 15) & 1), ((_a_77 >> 16) & 1), ((_a_77 >> 17) & 1), ((_a_77 >> 18) & 1), ((_a_77 >> 19) & 1), ((_a_77 >> 20) & 1), ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_515[0];
    } else if ((_a_77 & 2047) == 111) {
      Term _o_516[1];
      if (arm_103(e, _o_516, ((_a_77 >> 11) & 1), ((_a_77 >> 12) & 1), ((_a_77 >> 13) & 1), ((_a_77 >> 14) & 1), ((_a_77 >> 15) & 1), ((_a_77 >> 16) & 1), ((_a_77 >> 17) & 1), ((_a_77 >> 18) & 1), ((_a_77 >> 19) & 1), ((_a_77 >> 20) & 1), ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_516[0];
    } else if ((_a_77 & 1023) == 111) {
      Term _o_517[1];
      if (arm_104(e, _o_517, ((_a_77 >> 10) & 1), ((_a_77 >> 11) & 1), ((_a_77 >> 12) & 1), ((_a_77 >> 13) & 1), ((_a_77 >> 14) & 1), ((_a_77 >> 15) & 1), ((_a_77 >> 16) & 1), ((_a_77 >> 17) & 1), ((_a_77 >> 18) & 1), ((_a_77 >> 19) & 1), ((_a_77 >> 20) & 1), ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_517[0];
    } else if ((_a_77 & 511) == 111) {
      Term _o_518[1];
      if (arm_105(e, _o_518, ((_a_77 >> 9) & 1), ((_a_77 >> 10) & 1), ((_a_77 >> 11) & 1), ((_a_77 >> 12) & 1), ((_a_77 >> 13) & 1), ((_a_77 >> 14) & 1), ((_a_77 >> 15) & 1), ((_a_77 >> 16) & 1), ((_a_77 >> 17) & 1), ((_a_77 >> 18) & 1), ((_a_77 >> 19) & 1), ((_a_77 >> 20) & 1), ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_518[0];
    } else if ((_a_77 & 255) == 111) {
      Term _o_519[1];
      if (arm_106(e, _o_519, ((_a_77 >> 8) & 1), ((_a_77 >> 9) & 1), ((_a_77 >> 10) & 1), ((_a_77 >> 11) & 1), ((_a_77 >> 12) & 1), ((_a_77 >> 13) & 1), ((_a_77 >> 14) & 1), ((_a_77 >> 15) & 1), ((_a_77 >> 16) & 1), ((_a_77 >> 17) & 1), ((_a_77 >> 18) & 1), ((_a_77 >> 19) & 1), ((_a_77 >> 20) & 1), ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_519[0];
    } else if ((_a_77 & 127) == 111) {
      Term _o_520[1];
      if (arm_107(e, _o_520, ((_a_77 >> 7) & 1), ((_a_77 >> 8) & 1), ((_a_77 >> 9) & 1), ((_a_77 >> 10) & 1), ((_a_77 >> 11) & 1), ((_a_77 >> 12) & 1), ((_a_77 >> 13) & 1), ((_a_77 >> 14) & 1), ((_a_77 >> 15) & 1), ((_a_77 >> 16) & 1), ((_a_77 >> 17) & 1), ((_a_77 >> 18) & 1), ((_a_77 >> 19) & 1), ((_a_77 >> 20) & 1), ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_520[0];
    } else if ((_a_77 & 63) == 47) {
      Term _o_521[1];
      if (arm_108(e, _o_521, ((_a_77 >> 6) & 1), ((_a_77 >> 7) & 1), ((_a_77 >> 8) & 1), ((_a_77 >> 9) & 1), ((_a_77 >> 10) & 1), ((_a_77 >> 11) & 1), ((_a_77 >> 12) & 1), ((_a_77 >> 13) & 1), ((_a_77 >> 14) & 1), ((_a_77 >> 15) & 1), ((_a_77 >> 16) & 1), ((_a_77 >> 17) & 1), ((_a_77 >> 18) & 1), ((_a_77 >> 19) & 1), ((_a_77 >> 20) & 1), ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_521[0];
    } else if ((_a_77 & 31) == 15) {
      Term _o_522[1];
      if (arm_109(e, _o_522, ((_a_77 >> 5) & 1), ((_a_77 >> 6) & 1), ((_a_77 >> 7) & 1), ((_a_77 >> 8) & 1), ((_a_77 >> 9) & 1), ((_a_77 >> 10) & 1), ((_a_77 >> 11) & 1), ((_a_77 >> 12) & 1), ((_a_77 >> 13) & 1), ((_a_77 >> 14) & 1), ((_a_77 >> 15) & 1), ((_a_77 >> 16) & 1), ((_a_77 >> 17) & 1), ((_a_77 >> 18) & 1), ((_a_77 >> 19) & 1), ((_a_77 >> 20) & 1), ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_522[0];
    } else if ((_a_77 & 15) == 15) {
      Term _o_523[1];
      if (arm_110(e, _o_523, ((_a_77 >> 4) & 1), ((_a_77 >> 5) & 1), ((_a_77 >> 6) & 1), ((_a_77 >> 7) & 1), ((_a_77 >> 8) & 1), ((_a_77 >> 9) & 1), ((_a_77 >> 10) & 1), ((_a_77 >> 11) & 1), ((_a_77 >> 12) & 1), ((_a_77 >> 13) & 1), ((_a_77 >> 14) & 1), ((_a_77 >> 15) & 1), ((_a_77 >> 16) & 1), ((_a_77 >> 17) & 1), ((_a_77 >> 18) & 1), ((_a_77 >> 19) & 1), ((_a_77 >> 20) & 1), ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_523[0];
    } else if ((_a_77 & 7) == 7) {
      Term _o_524[1];
      if (arm_111(e, _o_524, ((_a_77 >> 3) & 1), ((_a_77 >> 4) & 1), ((_a_77 >> 5) & 1), ((_a_77 >> 6) & 1), ((_a_77 >> 7) & 1), ((_a_77 >> 8) & 1), ((_a_77 >> 9) & 1), ((_a_77 >> 10) & 1), ((_a_77 >> 11) & 1), ((_a_77 >> 12) & 1), ((_a_77 >> 13) & 1), ((_a_77 >> 14) & 1), ((_a_77 >> 15) & 1), ((_a_77 >> 16) & 1), ((_a_77 >> 17) & 1), ((_a_77 >> 18) & 1), ((_a_77 >> 19) & 1), ((_a_77 >> 20) & 1), ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_524[0];
    } else if ((_a_77 & 3) == 3) {
      Term _o_525[1];
      if (arm_112(e, _o_525, ((_a_77 >> 2) & 1), ((_a_77 >> 3) & 1), ((_a_77 >> 4) & 1), ((_a_77 >> 5) & 1), ((_a_77 >> 6) & 1), ((_a_77 >> 7) & 1), ((_a_77 >> 8) & 1), ((_a_77 >> 9) & 1), ((_a_77 >> 10) & 1), ((_a_77 >> 11) & 1), ((_a_77 >> 12) & 1), ((_a_77 >> 13) & 1), ((_a_77 >> 14) & 1), ((_a_77 >> 15) & 1), ((_a_77 >> 16) & 1), ((_a_77 >> 17) & 1), ((_a_77 >> 18) & 1), ((_a_77 >> 19) & 1), ((_a_77 >> 20) & 1), ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_525[0];
    } else if ((_a_77 & 1) == 1) {
      Term _o_526[1];
      if (arm_113(e, _o_526, ((_a_77 >> 1) & 1), ((_a_77 >> 2) & 1), ((_a_77 >> 3) & 1), ((_a_77 >> 4) & 1), ((_a_77 >> 5) & 1), ((_a_77 >> 6) & 1), ((_a_77 >> 7) & 1), ((_a_77 >> 8) & 1), ((_a_77 >> 9) & 1), ((_a_77 >> 10) & 1), ((_a_77 >> 11) & 1), ((_a_77 >> 12) & 1), ((_a_77 >> 13) & 1), ((_a_77 >> 14) & 1), ((_a_77 >> 15) & 1), ((_a_77 >> 16) & 1), ((_a_77 >> 17) & 1), ((_a_77 >> 18) & 1), ((_a_77 >> 19) & 1), ((_a_77 >> 20) & 1), ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_526[0];
    } else {
      Term _o_527[1];
      if (arm_114(e, _o_527, ((_a_77 >> 0) & 1), ((_a_77 >> 1) & 1), ((_a_77 >> 2) & 1), ((_a_77 >> 3) & 1), ((_a_77 >> 4) & 1), ((_a_77 >> 5) & 1), ((_a_77 >> 6) & 1), ((_a_77 >> 7) & 1), ((_a_77 >> 8) & 1), ((_a_77 >> 9) & 1), ((_a_77 >> 10) & 1), ((_a_77 >> 11) & 1), ((_a_77 >> 12) & 1), ((_a_77 >> 13) & 1), ((_a_77 >> 14) & 1), ((_a_77 >> 15) & 1), ((_a_77 >> 16) & 1), ((_a_77 >> 17) & 1), ((_a_77 >> 18) & 1), ((_a_77 >> 19) & 1), ((_a_77 >> 20) & 1), ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78, _a_79) == 0) {
        return 0;
      }
      _v_29 = _o_527[0];
    }
  break;
  }
  o[0] = _v_29;
  return 1;
}

INLINE Term arm_28(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_28 = 0;
  u32 _a_74 = r0;
  Term _a_75 = r1;
  Term _a_76 = r2;
  WL_SPIN
    Term _o_528[1];
    if (arm_29(e, _o_528, _a_74, _a_75, _a_76) == 0) {
      return 0;
    }
    _v_28 = _o_528[0];
  break;
  }
  o[0] = _v_28;
  return 1;
}

INLINE Term arm_27(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_27 = 0;
  Term _a_72 = r0;
  Term _a_73 = r1;
  WL_SPIN
    if (term_aux(_a_72) == CID_SCON) {
      Term _fb_9[2];
      u64 _sp_10 = ctr_take(e, _a_72, 2, _fb_9);
      u32 _f_20 = _fb_9[0];
      Term _f_21 = _fb_9[1];
      Term _o_529[1];
      if (arm_28(e, _o_529, _f_20, _f_21, _a_73) == 0) {
        return 0;
      }
      _v_27 = _o_529[0];
      spare_free(e, cls_fit(2), _sp_10);
    } else {
      Term _o_530[1];
      if (arm_80(e, _o_530, _a_72, _a_73) == 0) {
        return 0;
      }
      _v_27 = _o_530[0];
    }
  break;
  }
  o[0] = _v_27;
  return 1;
}

INLINE Term arm_26(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_26 = 0;
  u32 _a_69 = r0;
  Term _a_70 = r1;
  Term _a_71 = r2;
  WL_SPIN
    if (_a_69 == 114) {
      Term _o_531[1];
      if (arm_27(e, _o_531, _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_531[0];
    } else if ((_a_69 & 2147483647) == 114) {
      Term _o_532[1];
      if (arm_83(e, _o_532, ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_532[0];
    } else if ((_a_69 & 1073741823) == 114) {
      Term _o_533[1];
      if (arm_84(e, _o_533, ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_533[0];
    } else if ((_a_69 & 536870911) == 114) {
      Term _o_534[1];
      if (arm_85(e, _o_534, ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_534[0];
    } else if ((_a_69 & 268435455) == 114) {
      Term _o_535[1];
      if (arm_86(e, _o_535, ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_535[0];
    } else if ((_a_69 & 134217727) == 114) {
      Term _o_536[1];
      if (arm_87(e, _o_536, ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_536[0];
    } else if ((_a_69 & 67108863) == 114) {
      Term _o_537[1];
      if (arm_88(e, _o_537, ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_537[0];
    } else if ((_a_69 & 33554431) == 114) {
      Term _o_538[1];
      if (arm_89(e, _o_538, ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_538[0];
    } else if ((_a_69 & 16777215) == 114) {
      Term _o_539[1];
      if (arm_90(e, _o_539, ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_539[0];
    } else if ((_a_69 & 8388607) == 114) {
      Term _o_540[1];
      if (arm_91(e, _o_540, ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_540[0];
    } else if ((_a_69 & 4194303) == 114) {
      Term _o_541[1];
      if (arm_92(e, _o_541, ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_541[0];
    } else if ((_a_69 & 2097151) == 114) {
      Term _o_542[1];
      if (arm_93(e, _o_542, ((_a_69 >> 21) & 1), ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_542[0];
    } else if ((_a_69 & 1048575) == 114) {
      Term _o_543[1];
      if (arm_94(e, _o_543, ((_a_69 >> 20) & 1), ((_a_69 >> 21) & 1), ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_543[0];
    } else if ((_a_69 & 524287) == 114) {
      Term _o_544[1];
      if (arm_95(e, _o_544, ((_a_69 >> 19) & 1), ((_a_69 >> 20) & 1), ((_a_69 >> 21) & 1), ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_544[0];
    } else if ((_a_69 & 262143) == 114) {
      Term _o_545[1];
      if (arm_96(e, _o_545, ((_a_69 >> 18) & 1), ((_a_69 >> 19) & 1), ((_a_69 >> 20) & 1), ((_a_69 >> 21) & 1), ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_545[0];
    } else if ((_a_69 & 131071) == 114) {
      Term _o_546[1];
      if (arm_97(e, _o_546, ((_a_69 >> 17) & 1), ((_a_69 >> 18) & 1), ((_a_69 >> 19) & 1), ((_a_69 >> 20) & 1), ((_a_69 >> 21) & 1), ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_546[0];
    } else if ((_a_69 & 65535) == 114) {
      Term _o_547[1];
      if (arm_98(e, _o_547, ((_a_69 >> 16) & 1), ((_a_69 >> 17) & 1), ((_a_69 >> 18) & 1), ((_a_69 >> 19) & 1), ((_a_69 >> 20) & 1), ((_a_69 >> 21) & 1), ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_547[0];
    } else if ((_a_69 & 32767) == 114) {
      Term _o_548[1];
      if (arm_99(e, _o_548, ((_a_69 >> 15) & 1), ((_a_69 >> 16) & 1), ((_a_69 >> 17) & 1), ((_a_69 >> 18) & 1), ((_a_69 >> 19) & 1), ((_a_69 >> 20) & 1), ((_a_69 >> 21) & 1), ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_548[0];
    } else if ((_a_69 & 16383) == 114) {
      Term _o_549[1];
      if (arm_100(e, _o_549, ((_a_69 >> 14) & 1), ((_a_69 >> 15) & 1), ((_a_69 >> 16) & 1), ((_a_69 >> 17) & 1), ((_a_69 >> 18) & 1), ((_a_69 >> 19) & 1), ((_a_69 >> 20) & 1), ((_a_69 >> 21) & 1), ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_549[0];
    } else if ((_a_69 & 8191) == 114) {
      Term _o_550[1];
      if (arm_101(e, _o_550, ((_a_69 >> 13) & 1), ((_a_69 >> 14) & 1), ((_a_69 >> 15) & 1), ((_a_69 >> 16) & 1), ((_a_69 >> 17) & 1), ((_a_69 >> 18) & 1), ((_a_69 >> 19) & 1), ((_a_69 >> 20) & 1), ((_a_69 >> 21) & 1), ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_550[0];
    } else if ((_a_69 & 4095) == 114) {
      Term _o_551[1];
      if (arm_102(e, _o_551, ((_a_69 >> 12) & 1), ((_a_69 >> 13) & 1), ((_a_69 >> 14) & 1), ((_a_69 >> 15) & 1), ((_a_69 >> 16) & 1), ((_a_69 >> 17) & 1), ((_a_69 >> 18) & 1), ((_a_69 >> 19) & 1), ((_a_69 >> 20) & 1), ((_a_69 >> 21) & 1), ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_551[0];
    } else if ((_a_69 & 2047) == 114) {
      Term _o_552[1];
      if (arm_103(e, _o_552, ((_a_69 >> 11) & 1), ((_a_69 >> 12) & 1), ((_a_69 >> 13) & 1), ((_a_69 >> 14) & 1), ((_a_69 >> 15) & 1), ((_a_69 >> 16) & 1), ((_a_69 >> 17) & 1), ((_a_69 >> 18) & 1), ((_a_69 >> 19) & 1), ((_a_69 >> 20) & 1), ((_a_69 >> 21) & 1), ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_552[0];
    } else if ((_a_69 & 1023) == 114) {
      Term _o_553[1];
      if (arm_104(e, _o_553, ((_a_69 >> 10) & 1), ((_a_69 >> 11) & 1), ((_a_69 >> 12) & 1), ((_a_69 >> 13) & 1), ((_a_69 >> 14) & 1), ((_a_69 >> 15) & 1), ((_a_69 >> 16) & 1), ((_a_69 >> 17) & 1), ((_a_69 >> 18) & 1), ((_a_69 >> 19) & 1), ((_a_69 >> 20) & 1), ((_a_69 >> 21) & 1), ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_553[0];
    } else if ((_a_69 & 511) == 114) {
      Term _o_554[1];
      if (arm_105(e, _o_554, ((_a_69 >> 9) & 1), ((_a_69 >> 10) & 1), ((_a_69 >> 11) & 1), ((_a_69 >> 12) & 1), ((_a_69 >> 13) & 1), ((_a_69 >> 14) & 1), ((_a_69 >> 15) & 1), ((_a_69 >> 16) & 1), ((_a_69 >> 17) & 1), ((_a_69 >> 18) & 1), ((_a_69 >> 19) & 1), ((_a_69 >> 20) & 1), ((_a_69 >> 21) & 1), ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_554[0];
    } else if ((_a_69 & 255) == 114) {
      Term _o_555[1];
      if (arm_106(e, _o_555, ((_a_69 >> 8) & 1), ((_a_69 >> 9) & 1), ((_a_69 >> 10) & 1), ((_a_69 >> 11) & 1), ((_a_69 >> 12) & 1), ((_a_69 >> 13) & 1), ((_a_69 >> 14) & 1), ((_a_69 >> 15) & 1), ((_a_69 >> 16) & 1), ((_a_69 >> 17) & 1), ((_a_69 >> 18) & 1), ((_a_69 >> 19) & 1), ((_a_69 >> 20) & 1), ((_a_69 >> 21) & 1), ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_555[0];
    } else if ((_a_69 & 127) == 114) {
      Term _o_556[1];
      if (arm_107(e, _o_556, ((_a_69 >> 7) & 1), ((_a_69 >> 8) & 1), ((_a_69 >> 9) & 1), ((_a_69 >> 10) & 1), ((_a_69 >> 11) & 1), ((_a_69 >> 12) & 1), ((_a_69 >> 13) & 1), ((_a_69 >> 14) & 1), ((_a_69 >> 15) & 1), ((_a_69 >> 16) & 1), ((_a_69 >> 17) & 1), ((_a_69 >> 18) & 1), ((_a_69 >> 19) & 1), ((_a_69 >> 20) & 1), ((_a_69 >> 21) & 1), ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_556[0];
    } else if ((_a_69 & 63) == 50) {
      Term _o_557[1];
      if (arm_108(e, _o_557, ((_a_69 >> 6) & 1), ((_a_69 >> 7) & 1), ((_a_69 >> 8) & 1), ((_a_69 >> 9) & 1), ((_a_69 >> 10) & 1), ((_a_69 >> 11) & 1), ((_a_69 >> 12) & 1), ((_a_69 >> 13) & 1), ((_a_69 >> 14) & 1), ((_a_69 >> 15) & 1), ((_a_69 >> 16) & 1), ((_a_69 >> 17) & 1), ((_a_69 >> 18) & 1), ((_a_69 >> 19) & 1), ((_a_69 >> 20) & 1), ((_a_69 >> 21) & 1), ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_557[0];
    } else if ((_a_69 & 31) == 18) {
      Term _o_558[1];
      if (arm_109(e, _o_558, ((_a_69 >> 5) & 1), ((_a_69 >> 6) & 1), ((_a_69 >> 7) & 1), ((_a_69 >> 8) & 1), ((_a_69 >> 9) & 1), ((_a_69 >> 10) & 1), ((_a_69 >> 11) & 1), ((_a_69 >> 12) & 1), ((_a_69 >> 13) & 1), ((_a_69 >> 14) & 1), ((_a_69 >> 15) & 1), ((_a_69 >> 16) & 1), ((_a_69 >> 17) & 1), ((_a_69 >> 18) & 1), ((_a_69 >> 19) & 1), ((_a_69 >> 20) & 1), ((_a_69 >> 21) & 1), ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_558[0];
    } else if ((_a_69 & 15) == 2) {
      Term _o_559[1];
      if (arm_110(e, _o_559, ((_a_69 >> 4) & 1), ((_a_69 >> 5) & 1), ((_a_69 >> 6) & 1), ((_a_69 >> 7) & 1), ((_a_69 >> 8) & 1), ((_a_69 >> 9) & 1), ((_a_69 >> 10) & 1), ((_a_69 >> 11) & 1), ((_a_69 >> 12) & 1), ((_a_69 >> 13) & 1), ((_a_69 >> 14) & 1), ((_a_69 >> 15) & 1), ((_a_69 >> 16) & 1), ((_a_69 >> 17) & 1), ((_a_69 >> 18) & 1), ((_a_69 >> 19) & 1), ((_a_69 >> 20) & 1), ((_a_69 >> 21) & 1), ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_559[0];
    } else if ((_a_69 & 7) == 2) {
      Term _o_560[1];
      if (arm_111(e, _o_560, ((_a_69 >> 3) & 1), ((_a_69 >> 4) & 1), ((_a_69 >> 5) & 1), ((_a_69 >> 6) & 1), ((_a_69 >> 7) & 1), ((_a_69 >> 8) & 1), ((_a_69 >> 9) & 1), ((_a_69 >> 10) & 1), ((_a_69 >> 11) & 1), ((_a_69 >> 12) & 1), ((_a_69 >> 13) & 1), ((_a_69 >> 14) & 1), ((_a_69 >> 15) & 1), ((_a_69 >> 16) & 1), ((_a_69 >> 17) & 1), ((_a_69 >> 18) & 1), ((_a_69 >> 19) & 1), ((_a_69 >> 20) & 1), ((_a_69 >> 21) & 1), ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_560[0];
    } else if ((_a_69 & 3) == 2) {
      Term _o_561[1];
      if (arm_112(e, _o_561, ((_a_69 >> 2) & 1), ((_a_69 >> 3) & 1), ((_a_69 >> 4) & 1), ((_a_69 >> 5) & 1), ((_a_69 >> 6) & 1), ((_a_69 >> 7) & 1), ((_a_69 >> 8) & 1), ((_a_69 >> 9) & 1), ((_a_69 >> 10) & 1), ((_a_69 >> 11) & 1), ((_a_69 >> 12) & 1), ((_a_69 >> 13) & 1), ((_a_69 >> 14) & 1), ((_a_69 >> 15) & 1), ((_a_69 >> 16) & 1), ((_a_69 >> 17) & 1), ((_a_69 >> 18) & 1), ((_a_69 >> 19) & 1), ((_a_69 >> 20) & 1), ((_a_69 >> 21) & 1), ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_561[0];
    } else if ((_a_69 & 1) == 0) {
      Term _o_562[1];
      if (arm_113(e, _o_562, ((_a_69 >> 1) & 1), ((_a_69 >> 2) & 1), ((_a_69 >> 3) & 1), ((_a_69 >> 4) & 1), ((_a_69 >> 5) & 1), ((_a_69 >> 6) & 1), ((_a_69 >> 7) & 1), ((_a_69 >> 8) & 1), ((_a_69 >> 9) & 1), ((_a_69 >> 10) & 1), ((_a_69 >> 11) & 1), ((_a_69 >> 12) & 1), ((_a_69 >> 13) & 1), ((_a_69 >> 14) & 1), ((_a_69 >> 15) & 1), ((_a_69 >> 16) & 1), ((_a_69 >> 17) & 1), ((_a_69 >> 18) & 1), ((_a_69 >> 19) & 1), ((_a_69 >> 20) & 1), ((_a_69 >> 21) & 1), ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_562[0];
    } else {
      Term _o_563[1];
      if (arm_114(e, _o_563, ((_a_69 >> 0) & 1), ((_a_69 >> 1) & 1), ((_a_69 >> 2) & 1), ((_a_69 >> 3) & 1), ((_a_69 >> 4) & 1), ((_a_69 >> 5) & 1), ((_a_69 >> 6) & 1), ((_a_69 >> 7) & 1), ((_a_69 >> 8) & 1), ((_a_69 >> 9) & 1), ((_a_69 >> 10) & 1), ((_a_69 >> 11) & 1), ((_a_69 >> 12) & 1), ((_a_69 >> 13) & 1), ((_a_69 >> 14) & 1), ((_a_69 >> 15) & 1), ((_a_69 >> 16) & 1), ((_a_69 >> 17) & 1), ((_a_69 >> 18) & 1), ((_a_69 >> 19) & 1), ((_a_69 >> 20) & 1), ((_a_69 >> 21) & 1), ((_a_69 >> 22) & 1), ((_a_69 >> 23) & 1), ((_a_69 >> 24) & 1), ((_a_69 >> 25) & 1), ((_a_69 >> 26) & 1), ((_a_69 >> 27) & 1), ((_a_69 >> 28) & 1), ((_a_69 >> 29) & 1), ((_a_69 >> 30) & 1), ((_a_69 >> 31) & 1), _a_70, _a_71) == 0) {
        return 0;
      }
      _v_26 = _o_563[0];
    }
  break;
  }
  o[0] = _v_26;
  return 1;
}

INLINE Term arm_25(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_25 = 0;
  u32 _a_66 = r0;
  Term _a_67 = r1;
  Term _a_68 = r2;
  WL_SPIN
    Term _o_564[1];
    if (arm_26(e, _o_564, _a_66, _a_67, _a_68) == 0) {
      return 0;
    }
    _v_25 = _o_564[0];
  break;
  }
  o[0] = _v_25;
  return 1;
}

INLINE Term arm_24(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_24 = 0;
  Term _a_64 = r0;
  Term _a_65 = r1;
  WL_SPIN
    if (term_aux(_a_64) == CID_SCON) {
      Term _fb_8[2];
      u64 _sp_9 = ctr_take(e, _a_64, 2, _fb_8);
      u32 _f_18 = _fb_8[0];
      Term _f_19 = _fb_8[1];
      Term _o_565[1];
      if (arm_25(e, _o_565, _f_18, _f_19, _a_65) == 0) {
        return 0;
      }
      _v_24 = _o_565[0];
      spare_free(e, cls_fit(2), _sp_9);
    } else {
      Term _o_566[1];
      if (arm_80(e, _o_566, _a_64, _a_65) == 0) {
        return 0;
      }
      _v_24 = _o_566[0];
    }
  break;
  }
  o[0] = _v_24;
  return 1;
}

INLINE Term arm_23(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_23 = 0;
  u32 _a_61 = r0;
  Term _a_62 = r1;
  Term _a_63 = r2;
  WL_SPIN
    if (_a_61 == 112) {
      Term _o_567[1];
      if (arm_24(e, _o_567, _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_567[0];
    } else if ((_a_61 & 2147483647) == 112) {
      Term _o_568[1];
      if (arm_83(e, _o_568, ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_568[0];
    } else if ((_a_61 & 1073741823) == 112) {
      Term _o_569[1];
      if (arm_84(e, _o_569, ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_569[0];
    } else if ((_a_61 & 536870911) == 112) {
      Term _o_570[1];
      if (arm_85(e, _o_570, ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_570[0];
    } else if ((_a_61 & 268435455) == 112) {
      Term _o_571[1];
      if (arm_86(e, _o_571, ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_571[0];
    } else if ((_a_61 & 134217727) == 112) {
      Term _o_572[1];
      if (arm_87(e, _o_572, ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_572[0];
    } else if ((_a_61 & 67108863) == 112) {
      Term _o_573[1];
      if (arm_88(e, _o_573, ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_573[0];
    } else if ((_a_61 & 33554431) == 112) {
      Term _o_574[1];
      if (arm_89(e, _o_574, ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_574[0];
    } else if ((_a_61 & 16777215) == 112) {
      Term _o_575[1];
      if (arm_90(e, _o_575, ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_575[0];
    } else if ((_a_61 & 8388607) == 112) {
      Term _o_576[1];
      if (arm_91(e, _o_576, ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_576[0];
    } else if ((_a_61 & 4194303) == 112) {
      Term _o_577[1];
      if (arm_92(e, _o_577, ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_577[0];
    } else if ((_a_61 & 2097151) == 112) {
      Term _o_578[1];
      if (arm_93(e, _o_578, ((_a_61 >> 21) & 1), ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_578[0];
    } else if ((_a_61 & 1048575) == 112) {
      Term _o_579[1];
      if (arm_94(e, _o_579, ((_a_61 >> 20) & 1), ((_a_61 >> 21) & 1), ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_579[0];
    } else if ((_a_61 & 524287) == 112) {
      Term _o_580[1];
      if (arm_95(e, _o_580, ((_a_61 >> 19) & 1), ((_a_61 >> 20) & 1), ((_a_61 >> 21) & 1), ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_580[0];
    } else if ((_a_61 & 262143) == 112) {
      Term _o_581[1];
      if (arm_96(e, _o_581, ((_a_61 >> 18) & 1), ((_a_61 >> 19) & 1), ((_a_61 >> 20) & 1), ((_a_61 >> 21) & 1), ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_581[0];
    } else if ((_a_61 & 131071) == 112) {
      Term _o_582[1];
      if (arm_97(e, _o_582, ((_a_61 >> 17) & 1), ((_a_61 >> 18) & 1), ((_a_61 >> 19) & 1), ((_a_61 >> 20) & 1), ((_a_61 >> 21) & 1), ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_582[0];
    } else if ((_a_61 & 65535) == 112) {
      Term _o_583[1];
      if (arm_98(e, _o_583, ((_a_61 >> 16) & 1), ((_a_61 >> 17) & 1), ((_a_61 >> 18) & 1), ((_a_61 >> 19) & 1), ((_a_61 >> 20) & 1), ((_a_61 >> 21) & 1), ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_583[0];
    } else if ((_a_61 & 32767) == 112) {
      Term _o_584[1];
      if (arm_99(e, _o_584, ((_a_61 >> 15) & 1), ((_a_61 >> 16) & 1), ((_a_61 >> 17) & 1), ((_a_61 >> 18) & 1), ((_a_61 >> 19) & 1), ((_a_61 >> 20) & 1), ((_a_61 >> 21) & 1), ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_584[0];
    } else if ((_a_61 & 16383) == 112) {
      Term _o_585[1];
      if (arm_100(e, _o_585, ((_a_61 >> 14) & 1), ((_a_61 >> 15) & 1), ((_a_61 >> 16) & 1), ((_a_61 >> 17) & 1), ((_a_61 >> 18) & 1), ((_a_61 >> 19) & 1), ((_a_61 >> 20) & 1), ((_a_61 >> 21) & 1), ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_585[0];
    } else if ((_a_61 & 8191) == 112) {
      Term _o_586[1];
      if (arm_101(e, _o_586, ((_a_61 >> 13) & 1), ((_a_61 >> 14) & 1), ((_a_61 >> 15) & 1), ((_a_61 >> 16) & 1), ((_a_61 >> 17) & 1), ((_a_61 >> 18) & 1), ((_a_61 >> 19) & 1), ((_a_61 >> 20) & 1), ((_a_61 >> 21) & 1), ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_586[0];
    } else if ((_a_61 & 4095) == 112) {
      Term _o_587[1];
      if (arm_102(e, _o_587, ((_a_61 >> 12) & 1), ((_a_61 >> 13) & 1), ((_a_61 >> 14) & 1), ((_a_61 >> 15) & 1), ((_a_61 >> 16) & 1), ((_a_61 >> 17) & 1), ((_a_61 >> 18) & 1), ((_a_61 >> 19) & 1), ((_a_61 >> 20) & 1), ((_a_61 >> 21) & 1), ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_587[0];
    } else if ((_a_61 & 2047) == 112) {
      Term _o_588[1];
      if (arm_103(e, _o_588, ((_a_61 >> 11) & 1), ((_a_61 >> 12) & 1), ((_a_61 >> 13) & 1), ((_a_61 >> 14) & 1), ((_a_61 >> 15) & 1), ((_a_61 >> 16) & 1), ((_a_61 >> 17) & 1), ((_a_61 >> 18) & 1), ((_a_61 >> 19) & 1), ((_a_61 >> 20) & 1), ((_a_61 >> 21) & 1), ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_588[0];
    } else if ((_a_61 & 1023) == 112) {
      Term _o_589[1];
      if (arm_104(e, _o_589, ((_a_61 >> 10) & 1), ((_a_61 >> 11) & 1), ((_a_61 >> 12) & 1), ((_a_61 >> 13) & 1), ((_a_61 >> 14) & 1), ((_a_61 >> 15) & 1), ((_a_61 >> 16) & 1), ((_a_61 >> 17) & 1), ((_a_61 >> 18) & 1), ((_a_61 >> 19) & 1), ((_a_61 >> 20) & 1), ((_a_61 >> 21) & 1), ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_589[0];
    } else if ((_a_61 & 511) == 112) {
      Term _o_590[1];
      if (arm_105(e, _o_590, ((_a_61 >> 9) & 1), ((_a_61 >> 10) & 1), ((_a_61 >> 11) & 1), ((_a_61 >> 12) & 1), ((_a_61 >> 13) & 1), ((_a_61 >> 14) & 1), ((_a_61 >> 15) & 1), ((_a_61 >> 16) & 1), ((_a_61 >> 17) & 1), ((_a_61 >> 18) & 1), ((_a_61 >> 19) & 1), ((_a_61 >> 20) & 1), ((_a_61 >> 21) & 1), ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_590[0];
    } else if ((_a_61 & 255) == 112) {
      Term _o_591[1];
      if (arm_106(e, _o_591, ((_a_61 >> 8) & 1), ((_a_61 >> 9) & 1), ((_a_61 >> 10) & 1), ((_a_61 >> 11) & 1), ((_a_61 >> 12) & 1), ((_a_61 >> 13) & 1), ((_a_61 >> 14) & 1), ((_a_61 >> 15) & 1), ((_a_61 >> 16) & 1), ((_a_61 >> 17) & 1), ((_a_61 >> 18) & 1), ((_a_61 >> 19) & 1), ((_a_61 >> 20) & 1), ((_a_61 >> 21) & 1), ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_591[0];
    } else if ((_a_61 & 127) == 112) {
      Term _o_592[1];
      if (arm_107(e, _o_592, ((_a_61 >> 7) & 1), ((_a_61 >> 8) & 1), ((_a_61 >> 9) & 1), ((_a_61 >> 10) & 1), ((_a_61 >> 11) & 1), ((_a_61 >> 12) & 1), ((_a_61 >> 13) & 1), ((_a_61 >> 14) & 1), ((_a_61 >> 15) & 1), ((_a_61 >> 16) & 1), ((_a_61 >> 17) & 1), ((_a_61 >> 18) & 1), ((_a_61 >> 19) & 1), ((_a_61 >> 20) & 1), ((_a_61 >> 21) & 1), ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_592[0];
    } else if ((_a_61 & 63) == 48) {
      Term _o_593[1];
      if (arm_108(e, _o_593, ((_a_61 >> 6) & 1), ((_a_61 >> 7) & 1), ((_a_61 >> 8) & 1), ((_a_61 >> 9) & 1), ((_a_61 >> 10) & 1), ((_a_61 >> 11) & 1), ((_a_61 >> 12) & 1), ((_a_61 >> 13) & 1), ((_a_61 >> 14) & 1), ((_a_61 >> 15) & 1), ((_a_61 >> 16) & 1), ((_a_61 >> 17) & 1), ((_a_61 >> 18) & 1), ((_a_61 >> 19) & 1), ((_a_61 >> 20) & 1), ((_a_61 >> 21) & 1), ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_593[0];
    } else if ((_a_61 & 31) == 16) {
      Term _o_594[1];
      if (arm_109(e, _o_594, ((_a_61 >> 5) & 1), ((_a_61 >> 6) & 1), ((_a_61 >> 7) & 1), ((_a_61 >> 8) & 1), ((_a_61 >> 9) & 1), ((_a_61 >> 10) & 1), ((_a_61 >> 11) & 1), ((_a_61 >> 12) & 1), ((_a_61 >> 13) & 1), ((_a_61 >> 14) & 1), ((_a_61 >> 15) & 1), ((_a_61 >> 16) & 1), ((_a_61 >> 17) & 1), ((_a_61 >> 18) & 1), ((_a_61 >> 19) & 1), ((_a_61 >> 20) & 1), ((_a_61 >> 21) & 1), ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_594[0];
    } else if ((_a_61 & 15) == 0) {
      Term _o_595[1];
      if (arm_110(e, _o_595, ((_a_61 >> 4) & 1), ((_a_61 >> 5) & 1), ((_a_61 >> 6) & 1), ((_a_61 >> 7) & 1), ((_a_61 >> 8) & 1), ((_a_61 >> 9) & 1), ((_a_61 >> 10) & 1), ((_a_61 >> 11) & 1), ((_a_61 >> 12) & 1), ((_a_61 >> 13) & 1), ((_a_61 >> 14) & 1), ((_a_61 >> 15) & 1), ((_a_61 >> 16) & 1), ((_a_61 >> 17) & 1), ((_a_61 >> 18) & 1), ((_a_61 >> 19) & 1), ((_a_61 >> 20) & 1), ((_a_61 >> 21) & 1), ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_595[0];
    } else if ((_a_61 & 7) == 0) {
      Term _o_596[1];
      if (arm_111(e, _o_596, ((_a_61 >> 3) & 1), ((_a_61 >> 4) & 1), ((_a_61 >> 5) & 1), ((_a_61 >> 6) & 1), ((_a_61 >> 7) & 1), ((_a_61 >> 8) & 1), ((_a_61 >> 9) & 1), ((_a_61 >> 10) & 1), ((_a_61 >> 11) & 1), ((_a_61 >> 12) & 1), ((_a_61 >> 13) & 1), ((_a_61 >> 14) & 1), ((_a_61 >> 15) & 1), ((_a_61 >> 16) & 1), ((_a_61 >> 17) & 1), ((_a_61 >> 18) & 1), ((_a_61 >> 19) & 1), ((_a_61 >> 20) & 1), ((_a_61 >> 21) & 1), ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_596[0];
    } else if ((_a_61 & 3) == 0) {
      Term _o_597[1];
      if (arm_112(e, _o_597, ((_a_61 >> 2) & 1), ((_a_61 >> 3) & 1), ((_a_61 >> 4) & 1), ((_a_61 >> 5) & 1), ((_a_61 >> 6) & 1), ((_a_61 >> 7) & 1), ((_a_61 >> 8) & 1), ((_a_61 >> 9) & 1), ((_a_61 >> 10) & 1), ((_a_61 >> 11) & 1), ((_a_61 >> 12) & 1), ((_a_61 >> 13) & 1), ((_a_61 >> 14) & 1), ((_a_61 >> 15) & 1), ((_a_61 >> 16) & 1), ((_a_61 >> 17) & 1), ((_a_61 >> 18) & 1), ((_a_61 >> 19) & 1), ((_a_61 >> 20) & 1), ((_a_61 >> 21) & 1), ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_597[0];
    } else if ((_a_61 & 1) == 0) {
      Term _o_598[1];
      if (arm_113(e, _o_598, ((_a_61 >> 1) & 1), ((_a_61 >> 2) & 1), ((_a_61 >> 3) & 1), ((_a_61 >> 4) & 1), ((_a_61 >> 5) & 1), ((_a_61 >> 6) & 1), ((_a_61 >> 7) & 1), ((_a_61 >> 8) & 1), ((_a_61 >> 9) & 1), ((_a_61 >> 10) & 1), ((_a_61 >> 11) & 1), ((_a_61 >> 12) & 1), ((_a_61 >> 13) & 1), ((_a_61 >> 14) & 1), ((_a_61 >> 15) & 1), ((_a_61 >> 16) & 1), ((_a_61 >> 17) & 1), ((_a_61 >> 18) & 1), ((_a_61 >> 19) & 1), ((_a_61 >> 20) & 1), ((_a_61 >> 21) & 1), ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_598[0];
    } else {
      Term _o_599[1];
      if (arm_114(e, _o_599, ((_a_61 >> 0) & 1), ((_a_61 >> 1) & 1), ((_a_61 >> 2) & 1), ((_a_61 >> 3) & 1), ((_a_61 >> 4) & 1), ((_a_61 >> 5) & 1), ((_a_61 >> 6) & 1), ((_a_61 >> 7) & 1), ((_a_61 >> 8) & 1), ((_a_61 >> 9) & 1), ((_a_61 >> 10) & 1), ((_a_61 >> 11) & 1), ((_a_61 >> 12) & 1), ((_a_61 >> 13) & 1), ((_a_61 >> 14) & 1), ((_a_61 >> 15) & 1), ((_a_61 >> 16) & 1), ((_a_61 >> 17) & 1), ((_a_61 >> 18) & 1), ((_a_61 >> 19) & 1), ((_a_61 >> 20) & 1), ((_a_61 >> 21) & 1), ((_a_61 >> 22) & 1), ((_a_61 >> 23) & 1), ((_a_61 >> 24) & 1), ((_a_61 >> 25) & 1), ((_a_61 >> 26) & 1), ((_a_61 >> 27) & 1), ((_a_61 >> 28) & 1), ((_a_61 >> 29) & 1), ((_a_61 >> 30) & 1), ((_a_61 >> 31) & 1), _a_62, _a_63) == 0) {
        return 0;
      }
      _v_23 = _o_599[0];
    }
  break;
  }
  o[0] = _v_23;
  return 1;
}

INLINE Term arm_22(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_22 = 0;
  u32 _a_58 = r0;
  Term _a_59 = r1;
  Term _a_60 = r2;
  WL_SPIN
    Term _o_600[1];
    if (arm_23(e, _o_600, _a_58, _a_59, _a_60) == 0) {
      return 0;
    }
    _v_22 = _o_600[0];
  break;
  }
  o[0] = _v_22;
  return 1;
}

INLINE Term arm_21(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_21 = 0;
  Term _a_56 = r0;
  Term _a_57 = r1;
  WL_SPIN
    if (term_aux(_a_56) == CID_SCON) {
      Term _fb_7[2];
      u64 _sp_8 = ctr_take(e, _a_56, 2, _fb_7);
      u32 _f_16 = _fb_7[0];
      Term _f_17 = _fb_7[1];
      Term _o_601[1];
      if (arm_22(e, _o_601, _f_16, _f_17, _a_57) == 0) {
        return 0;
      }
      _v_21 = _o_601[0];
      spare_free(e, cls_fit(2), _sp_8);
    } else {
      Term _o_602[1];
      if (arm_80(e, _o_602, _a_56, _a_57) == 0) {
        return 0;
      }
      _v_21 = _o_602[0];
    }
  break;
  }
  o[0] = _v_21;
  return 1;
}

INLINE Term arm_20(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_20 = 0;
  u32 _a_53 = r0;
  Term _a_54 = r1;
  Term _a_55 = r2;
  WL_SPIN
    if (_a_53 == 45) {
      Term _o_603[1];
      if (arm_21(e, _o_603, _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_603[0];
    } else if ((_a_53 & 2147483647) == 45) {
      Term _o_604[1];
      if (arm_83(e, _o_604, ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_604[0];
    } else if ((_a_53 & 1073741823) == 45) {
      Term _o_605[1];
      if (arm_84(e, _o_605, ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_605[0];
    } else if ((_a_53 & 536870911) == 45) {
      Term _o_606[1];
      if (arm_85(e, _o_606, ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_606[0];
    } else if ((_a_53 & 268435455) == 45) {
      Term _o_607[1];
      if (arm_86(e, _o_607, ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_607[0];
    } else if ((_a_53 & 134217727) == 45) {
      Term _o_608[1];
      if (arm_87(e, _o_608, ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_608[0];
    } else if ((_a_53 & 67108863) == 45) {
      Term _o_609[1];
      if (arm_88(e, _o_609, ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_609[0];
    } else if ((_a_53 & 33554431) == 45) {
      Term _o_610[1];
      if (arm_89(e, _o_610, ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_610[0];
    } else if ((_a_53 & 16777215) == 45) {
      Term _o_611[1];
      if (arm_90(e, _o_611, ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_611[0];
    } else if ((_a_53 & 8388607) == 45) {
      Term _o_612[1];
      if (arm_91(e, _o_612, ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_612[0];
    } else if ((_a_53 & 4194303) == 45) {
      Term _o_613[1];
      if (arm_92(e, _o_613, ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_613[0];
    } else if ((_a_53 & 2097151) == 45) {
      Term _o_614[1];
      if (arm_93(e, _o_614, ((_a_53 >> 21) & 1), ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_614[0];
    } else if ((_a_53 & 1048575) == 45) {
      Term _o_615[1];
      if (arm_94(e, _o_615, ((_a_53 >> 20) & 1), ((_a_53 >> 21) & 1), ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_615[0];
    } else if ((_a_53 & 524287) == 45) {
      Term _o_616[1];
      if (arm_95(e, _o_616, ((_a_53 >> 19) & 1), ((_a_53 >> 20) & 1), ((_a_53 >> 21) & 1), ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_616[0];
    } else if ((_a_53 & 262143) == 45) {
      Term _o_617[1];
      if (arm_96(e, _o_617, ((_a_53 >> 18) & 1), ((_a_53 >> 19) & 1), ((_a_53 >> 20) & 1), ((_a_53 >> 21) & 1), ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_617[0];
    } else if ((_a_53 & 131071) == 45) {
      Term _o_618[1];
      if (arm_97(e, _o_618, ((_a_53 >> 17) & 1), ((_a_53 >> 18) & 1), ((_a_53 >> 19) & 1), ((_a_53 >> 20) & 1), ((_a_53 >> 21) & 1), ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_618[0];
    } else if ((_a_53 & 65535) == 45) {
      Term _o_619[1];
      if (arm_98(e, _o_619, ((_a_53 >> 16) & 1), ((_a_53 >> 17) & 1), ((_a_53 >> 18) & 1), ((_a_53 >> 19) & 1), ((_a_53 >> 20) & 1), ((_a_53 >> 21) & 1), ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_619[0];
    } else if ((_a_53 & 32767) == 45) {
      Term _o_620[1];
      if (arm_99(e, _o_620, ((_a_53 >> 15) & 1), ((_a_53 >> 16) & 1), ((_a_53 >> 17) & 1), ((_a_53 >> 18) & 1), ((_a_53 >> 19) & 1), ((_a_53 >> 20) & 1), ((_a_53 >> 21) & 1), ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_620[0];
    } else if ((_a_53 & 16383) == 45) {
      Term _o_621[1];
      if (arm_100(e, _o_621, ((_a_53 >> 14) & 1), ((_a_53 >> 15) & 1), ((_a_53 >> 16) & 1), ((_a_53 >> 17) & 1), ((_a_53 >> 18) & 1), ((_a_53 >> 19) & 1), ((_a_53 >> 20) & 1), ((_a_53 >> 21) & 1), ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_621[0];
    } else if ((_a_53 & 8191) == 45) {
      Term _o_622[1];
      if (arm_101(e, _o_622, ((_a_53 >> 13) & 1), ((_a_53 >> 14) & 1), ((_a_53 >> 15) & 1), ((_a_53 >> 16) & 1), ((_a_53 >> 17) & 1), ((_a_53 >> 18) & 1), ((_a_53 >> 19) & 1), ((_a_53 >> 20) & 1), ((_a_53 >> 21) & 1), ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_622[0];
    } else if ((_a_53 & 4095) == 45) {
      Term _o_623[1];
      if (arm_102(e, _o_623, ((_a_53 >> 12) & 1), ((_a_53 >> 13) & 1), ((_a_53 >> 14) & 1), ((_a_53 >> 15) & 1), ((_a_53 >> 16) & 1), ((_a_53 >> 17) & 1), ((_a_53 >> 18) & 1), ((_a_53 >> 19) & 1), ((_a_53 >> 20) & 1), ((_a_53 >> 21) & 1), ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_623[0];
    } else if ((_a_53 & 2047) == 45) {
      Term _o_624[1];
      if (arm_103(e, _o_624, ((_a_53 >> 11) & 1), ((_a_53 >> 12) & 1), ((_a_53 >> 13) & 1), ((_a_53 >> 14) & 1), ((_a_53 >> 15) & 1), ((_a_53 >> 16) & 1), ((_a_53 >> 17) & 1), ((_a_53 >> 18) & 1), ((_a_53 >> 19) & 1), ((_a_53 >> 20) & 1), ((_a_53 >> 21) & 1), ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_624[0];
    } else if ((_a_53 & 1023) == 45) {
      Term _o_625[1];
      if (arm_104(e, _o_625, ((_a_53 >> 10) & 1), ((_a_53 >> 11) & 1), ((_a_53 >> 12) & 1), ((_a_53 >> 13) & 1), ((_a_53 >> 14) & 1), ((_a_53 >> 15) & 1), ((_a_53 >> 16) & 1), ((_a_53 >> 17) & 1), ((_a_53 >> 18) & 1), ((_a_53 >> 19) & 1), ((_a_53 >> 20) & 1), ((_a_53 >> 21) & 1), ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_625[0];
    } else if ((_a_53 & 511) == 45) {
      Term _o_626[1];
      if (arm_105(e, _o_626, ((_a_53 >> 9) & 1), ((_a_53 >> 10) & 1), ((_a_53 >> 11) & 1), ((_a_53 >> 12) & 1), ((_a_53 >> 13) & 1), ((_a_53 >> 14) & 1), ((_a_53 >> 15) & 1), ((_a_53 >> 16) & 1), ((_a_53 >> 17) & 1), ((_a_53 >> 18) & 1), ((_a_53 >> 19) & 1), ((_a_53 >> 20) & 1), ((_a_53 >> 21) & 1), ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_626[0];
    } else if ((_a_53 & 255) == 45) {
      Term _o_627[1];
      if (arm_106(e, _o_627, ((_a_53 >> 8) & 1), ((_a_53 >> 9) & 1), ((_a_53 >> 10) & 1), ((_a_53 >> 11) & 1), ((_a_53 >> 12) & 1), ((_a_53 >> 13) & 1), ((_a_53 >> 14) & 1), ((_a_53 >> 15) & 1), ((_a_53 >> 16) & 1), ((_a_53 >> 17) & 1), ((_a_53 >> 18) & 1), ((_a_53 >> 19) & 1), ((_a_53 >> 20) & 1), ((_a_53 >> 21) & 1), ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_627[0];
    } else if ((_a_53 & 127) == 45) {
      Term _o_628[1];
      if (arm_107(e, _o_628, ((_a_53 >> 7) & 1), ((_a_53 >> 8) & 1), ((_a_53 >> 9) & 1), ((_a_53 >> 10) & 1), ((_a_53 >> 11) & 1), ((_a_53 >> 12) & 1), ((_a_53 >> 13) & 1), ((_a_53 >> 14) & 1), ((_a_53 >> 15) & 1), ((_a_53 >> 16) & 1), ((_a_53 >> 17) & 1), ((_a_53 >> 18) & 1), ((_a_53 >> 19) & 1), ((_a_53 >> 20) & 1), ((_a_53 >> 21) & 1), ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_628[0];
    } else if ((_a_53 & 63) == 45) {
      Term _o_629[1];
      if (arm_108(e, _o_629, ((_a_53 >> 6) & 1), ((_a_53 >> 7) & 1), ((_a_53 >> 8) & 1), ((_a_53 >> 9) & 1), ((_a_53 >> 10) & 1), ((_a_53 >> 11) & 1), ((_a_53 >> 12) & 1), ((_a_53 >> 13) & 1), ((_a_53 >> 14) & 1), ((_a_53 >> 15) & 1), ((_a_53 >> 16) & 1), ((_a_53 >> 17) & 1), ((_a_53 >> 18) & 1), ((_a_53 >> 19) & 1), ((_a_53 >> 20) & 1), ((_a_53 >> 21) & 1), ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_629[0];
    } else if ((_a_53 & 31) == 13) {
      Term _o_630[1];
      if (arm_109(e, _o_630, ((_a_53 >> 5) & 1), ((_a_53 >> 6) & 1), ((_a_53 >> 7) & 1), ((_a_53 >> 8) & 1), ((_a_53 >> 9) & 1), ((_a_53 >> 10) & 1), ((_a_53 >> 11) & 1), ((_a_53 >> 12) & 1), ((_a_53 >> 13) & 1), ((_a_53 >> 14) & 1), ((_a_53 >> 15) & 1), ((_a_53 >> 16) & 1), ((_a_53 >> 17) & 1), ((_a_53 >> 18) & 1), ((_a_53 >> 19) & 1), ((_a_53 >> 20) & 1), ((_a_53 >> 21) & 1), ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_630[0];
    } else if ((_a_53 & 15) == 13) {
      Term _o_631[1];
      if (arm_110(e, _o_631, ((_a_53 >> 4) & 1), ((_a_53 >> 5) & 1), ((_a_53 >> 6) & 1), ((_a_53 >> 7) & 1), ((_a_53 >> 8) & 1), ((_a_53 >> 9) & 1), ((_a_53 >> 10) & 1), ((_a_53 >> 11) & 1), ((_a_53 >> 12) & 1), ((_a_53 >> 13) & 1), ((_a_53 >> 14) & 1), ((_a_53 >> 15) & 1), ((_a_53 >> 16) & 1), ((_a_53 >> 17) & 1), ((_a_53 >> 18) & 1), ((_a_53 >> 19) & 1), ((_a_53 >> 20) & 1), ((_a_53 >> 21) & 1), ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_631[0];
    } else if ((_a_53 & 7) == 5) {
      Term _o_632[1];
      if (arm_111(e, _o_632, ((_a_53 >> 3) & 1), ((_a_53 >> 4) & 1), ((_a_53 >> 5) & 1), ((_a_53 >> 6) & 1), ((_a_53 >> 7) & 1), ((_a_53 >> 8) & 1), ((_a_53 >> 9) & 1), ((_a_53 >> 10) & 1), ((_a_53 >> 11) & 1), ((_a_53 >> 12) & 1), ((_a_53 >> 13) & 1), ((_a_53 >> 14) & 1), ((_a_53 >> 15) & 1), ((_a_53 >> 16) & 1), ((_a_53 >> 17) & 1), ((_a_53 >> 18) & 1), ((_a_53 >> 19) & 1), ((_a_53 >> 20) & 1), ((_a_53 >> 21) & 1), ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_632[0];
    } else if ((_a_53 & 3) == 1) {
      Term _o_633[1];
      if (arm_112(e, _o_633, ((_a_53 >> 2) & 1), ((_a_53 >> 3) & 1), ((_a_53 >> 4) & 1), ((_a_53 >> 5) & 1), ((_a_53 >> 6) & 1), ((_a_53 >> 7) & 1), ((_a_53 >> 8) & 1), ((_a_53 >> 9) & 1), ((_a_53 >> 10) & 1), ((_a_53 >> 11) & 1), ((_a_53 >> 12) & 1), ((_a_53 >> 13) & 1), ((_a_53 >> 14) & 1), ((_a_53 >> 15) & 1), ((_a_53 >> 16) & 1), ((_a_53 >> 17) & 1), ((_a_53 >> 18) & 1), ((_a_53 >> 19) & 1), ((_a_53 >> 20) & 1), ((_a_53 >> 21) & 1), ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_633[0];
    } else if ((_a_53 & 1) == 1) {
      Term _o_634[1];
      if (arm_113(e, _o_634, ((_a_53 >> 1) & 1), ((_a_53 >> 2) & 1), ((_a_53 >> 3) & 1), ((_a_53 >> 4) & 1), ((_a_53 >> 5) & 1), ((_a_53 >> 6) & 1), ((_a_53 >> 7) & 1), ((_a_53 >> 8) & 1), ((_a_53 >> 9) & 1), ((_a_53 >> 10) & 1), ((_a_53 >> 11) & 1), ((_a_53 >> 12) & 1), ((_a_53 >> 13) & 1), ((_a_53 >> 14) & 1), ((_a_53 >> 15) & 1), ((_a_53 >> 16) & 1), ((_a_53 >> 17) & 1), ((_a_53 >> 18) & 1), ((_a_53 >> 19) & 1), ((_a_53 >> 20) & 1), ((_a_53 >> 21) & 1), ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_634[0];
    } else {
      Term _o_635[1];
      if (arm_114(e, _o_635, ((_a_53 >> 0) & 1), ((_a_53 >> 1) & 1), ((_a_53 >> 2) & 1), ((_a_53 >> 3) & 1), ((_a_53 >> 4) & 1), ((_a_53 >> 5) & 1), ((_a_53 >> 6) & 1), ((_a_53 >> 7) & 1), ((_a_53 >> 8) & 1), ((_a_53 >> 9) & 1), ((_a_53 >> 10) & 1), ((_a_53 >> 11) & 1), ((_a_53 >> 12) & 1), ((_a_53 >> 13) & 1), ((_a_53 >> 14) & 1), ((_a_53 >> 15) & 1), ((_a_53 >> 16) & 1), ((_a_53 >> 17) & 1), ((_a_53 >> 18) & 1), ((_a_53 >> 19) & 1), ((_a_53 >> 20) & 1), ((_a_53 >> 21) & 1), ((_a_53 >> 22) & 1), ((_a_53 >> 23) & 1), ((_a_53 >> 24) & 1), ((_a_53 >> 25) & 1), ((_a_53 >> 26) & 1), ((_a_53 >> 27) & 1), ((_a_53 >> 28) & 1), ((_a_53 >> 29) & 1), ((_a_53 >> 30) & 1), ((_a_53 >> 31) & 1), _a_54, _a_55) == 0) {
        return 0;
      }
      _v_20 = _o_635[0];
    }
  break;
  }
  o[0] = _v_20;
  return 1;
}

INLINE Term arm_19(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_19 = 0;
  u32 _a_50 = r0;
  Term _a_51 = r1;
  Term _a_52 = r2;
  WL_SPIN
    Term _o_636[1];
    if (arm_20(e, _o_636, _a_50, _a_51, _a_52) == 0) {
      return 0;
    }
    _v_19 = _o_636[0];
  break;
  }
  o[0] = _v_19;
  return 1;
}

INLINE Term arm_18(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_18 = 0;
  Term _a_48 = r0;
  Term _a_49 = r1;
  WL_SPIN
    if (term_aux(_a_48) == CID_SCON) {
      Term _fb_6[2];
      u64 _sp_7 = ctr_take(e, _a_48, 2, _fb_6);
      u32 _f_14 = _fb_6[0];
      Term _f_15 = _fb_6[1];
      Term _o_637[1];
      if (arm_19(e, _o_637, _f_14, _f_15, _a_49) == 0) {
        return 0;
      }
      _v_18 = _o_637[0];
      spare_free(e, cls_fit(2), _sp_7);
    } else {
      Term _o_638[1];
      if (arm_80(e, _o_638, _a_48, _a_49) == 0) {
        return 0;
      }
      _v_18 = _o_638[0];
    }
  break;
  }
  o[0] = _v_18;
  return 1;
}

INLINE Term arm_17(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_17 = 0;
  u32 _a_45 = r0;
  Term _a_46 = r1;
  Term _a_47 = r2;
  WL_SPIN
    if (_a_45 == 116) {
      Term _o_639[1];
      if (arm_18(e, _o_639, _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_639[0];
    } else if ((_a_45 & 2147483647) == 116) {
      Term _o_640[1];
      if (arm_83(e, _o_640, ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_640[0];
    } else if ((_a_45 & 1073741823) == 116) {
      Term _o_641[1];
      if (arm_84(e, _o_641, ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_641[0];
    } else if ((_a_45 & 536870911) == 116) {
      Term _o_642[1];
      if (arm_85(e, _o_642, ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_642[0];
    } else if ((_a_45 & 268435455) == 116) {
      Term _o_643[1];
      if (arm_86(e, _o_643, ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_643[0];
    } else if ((_a_45 & 134217727) == 116) {
      Term _o_644[1];
      if (arm_87(e, _o_644, ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_644[0];
    } else if ((_a_45 & 67108863) == 116) {
      Term _o_645[1];
      if (arm_88(e, _o_645, ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_645[0];
    } else if ((_a_45 & 33554431) == 116) {
      Term _o_646[1];
      if (arm_89(e, _o_646, ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_646[0];
    } else if ((_a_45 & 16777215) == 116) {
      Term _o_647[1];
      if (arm_90(e, _o_647, ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_647[0];
    } else if ((_a_45 & 8388607) == 116) {
      Term _o_648[1];
      if (arm_91(e, _o_648, ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_648[0];
    } else if ((_a_45 & 4194303) == 116) {
      Term _o_649[1];
      if (arm_92(e, _o_649, ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_649[0];
    } else if ((_a_45 & 2097151) == 116) {
      Term _o_650[1];
      if (arm_93(e, _o_650, ((_a_45 >> 21) & 1), ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_650[0];
    } else if ((_a_45 & 1048575) == 116) {
      Term _o_651[1];
      if (arm_94(e, _o_651, ((_a_45 >> 20) & 1), ((_a_45 >> 21) & 1), ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_651[0];
    } else if ((_a_45 & 524287) == 116) {
      Term _o_652[1];
      if (arm_95(e, _o_652, ((_a_45 >> 19) & 1), ((_a_45 >> 20) & 1), ((_a_45 >> 21) & 1), ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_652[0];
    } else if ((_a_45 & 262143) == 116) {
      Term _o_653[1];
      if (arm_96(e, _o_653, ((_a_45 >> 18) & 1), ((_a_45 >> 19) & 1), ((_a_45 >> 20) & 1), ((_a_45 >> 21) & 1), ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_653[0];
    } else if ((_a_45 & 131071) == 116) {
      Term _o_654[1];
      if (arm_97(e, _o_654, ((_a_45 >> 17) & 1), ((_a_45 >> 18) & 1), ((_a_45 >> 19) & 1), ((_a_45 >> 20) & 1), ((_a_45 >> 21) & 1), ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_654[0];
    } else if ((_a_45 & 65535) == 116) {
      Term _o_655[1];
      if (arm_98(e, _o_655, ((_a_45 >> 16) & 1), ((_a_45 >> 17) & 1), ((_a_45 >> 18) & 1), ((_a_45 >> 19) & 1), ((_a_45 >> 20) & 1), ((_a_45 >> 21) & 1), ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_655[0];
    } else if ((_a_45 & 32767) == 116) {
      Term _o_656[1];
      if (arm_99(e, _o_656, ((_a_45 >> 15) & 1), ((_a_45 >> 16) & 1), ((_a_45 >> 17) & 1), ((_a_45 >> 18) & 1), ((_a_45 >> 19) & 1), ((_a_45 >> 20) & 1), ((_a_45 >> 21) & 1), ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_656[0];
    } else if ((_a_45 & 16383) == 116) {
      Term _o_657[1];
      if (arm_100(e, _o_657, ((_a_45 >> 14) & 1), ((_a_45 >> 15) & 1), ((_a_45 >> 16) & 1), ((_a_45 >> 17) & 1), ((_a_45 >> 18) & 1), ((_a_45 >> 19) & 1), ((_a_45 >> 20) & 1), ((_a_45 >> 21) & 1), ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_657[0];
    } else if ((_a_45 & 8191) == 116) {
      Term _o_658[1];
      if (arm_101(e, _o_658, ((_a_45 >> 13) & 1), ((_a_45 >> 14) & 1), ((_a_45 >> 15) & 1), ((_a_45 >> 16) & 1), ((_a_45 >> 17) & 1), ((_a_45 >> 18) & 1), ((_a_45 >> 19) & 1), ((_a_45 >> 20) & 1), ((_a_45 >> 21) & 1), ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_658[0];
    } else if ((_a_45 & 4095) == 116) {
      Term _o_659[1];
      if (arm_102(e, _o_659, ((_a_45 >> 12) & 1), ((_a_45 >> 13) & 1), ((_a_45 >> 14) & 1), ((_a_45 >> 15) & 1), ((_a_45 >> 16) & 1), ((_a_45 >> 17) & 1), ((_a_45 >> 18) & 1), ((_a_45 >> 19) & 1), ((_a_45 >> 20) & 1), ((_a_45 >> 21) & 1), ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_659[0];
    } else if ((_a_45 & 2047) == 116) {
      Term _o_660[1];
      if (arm_103(e, _o_660, ((_a_45 >> 11) & 1), ((_a_45 >> 12) & 1), ((_a_45 >> 13) & 1), ((_a_45 >> 14) & 1), ((_a_45 >> 15) & 1), ((_a_45 >> 16) & 1), ((_a_45 >> 17) & 1), ((_a_45 >> 18) & 1), ((_a_45 >> 19) & 1), ((_a_45 >> 20) & 1), ((_a_45 >> 21) & 1), ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_660[0];
    } else if ((_a_45 & 1023) == 116) {
      Term _o_661[1];
      if (arm_104(e, _o_661, ((_a_45 >> 10) & 1), ((_a_45 >> 11) & 1), ((_a_45 >> 12) & 1), ((_a_45 >> 13) & 1), ((_a_45 >> 14) & 1), ((_a_45 >> 15) & 1), ((_a_45 >> 16) & 1), ((_a_45 >> 17) & 1), ((_a_45 >> 18) & 1), ((_a_45 >> 19) & 1), ((_a_45 >> 20) & 1), ((_a_45 >> 21) & 1), ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_661[0];
    } else if ((_a_45 & 511) == 116) {
      Term _o_662[1];
      if (arm_105(e, _o_662, ((_a_45 >> 9) & 1), ((_a_45 >> 10) & 1), ((_a_45 >> 11) & 1), ((_a_45 >> 12) & 1), ((_a_45 >> 13) & 1), ((_a_45 >> 14) & 1), ((_a_45 >> 15) & 1), ((_a_45 >> 16) & 1), ((_a_45 >> 17) & 1), ((_a_45 >> 18) & 1), ((_a_45 >> 19) & 1), ((_a_45 >> 20) & 1), ((_a_45 >> 21) & 1), ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_662[0];
    } else if ((_a_45 & 255) == 116) {
      Term _o_663[1];
      if (arm_106(e, _o_663, ((_a_45 >> 8) & 1), ((_a_45 >> 9) & 1), ((_a_45 >> 10) & 1), ((_a_45 >> 11) & 1), ((_a_45 >> 12) & 1), ((_a_45 >> 13) & 1), ((_a_45 >> 14) & 1), ((_a_45 >> 15) & 1), ((_a_45 >> 16) & 1), ((_a_45 >> 17) & 1), ((_a_45 >> 18) & 1), ((_a_45 >> 19) & 1), ((_a_45 >> 20) & 1), ((_a_45 >> 21) & 1), ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_663[0];
    } else if ((_a_45 & 127) == 116) {
      Term _o_664[1];
      if (arm_107(e, _o_664, ((_a_45 >> 7) & 1), ((_a_45 >> 8) & 1), ((_a_45 >> 9) & 1), ((_a_45 >> 10) & 1), ((_a_45 >> 11) & 1), ((_a_45 >> 12) & 1), ((_a_45 >> 13) & 1), ((_a_45 >> 14) & 1), ((_a_45 >> 15) & 1), ((_a_45 >> 16) & 1), ((_a_45 >> 17) & 1), ((_a_45 >> 18) & 1), ((_a_45 >> 19) & 1), ((_a_45 >> 20) & 1), ((_a_45 >> 21) & 1), ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_664[0];
    } else if ((_a_45 & 63) == 52) {
      Term _o_665[1];
      if (arm_108(e, _o_665, ((_a_45 >> 6) & 1), ((_a_45 >> 7) & 1), ((_a_45 >> 8) & 1), ((_a_45 >> 9) & 1), ((_a_45 >> 10) & 1), ((_a_45 >> 11) & 1), ((_a_45 >> 12) & 1), ((_a_45 >> 13) & 1), ((_a_45 >> 14) & 1), ((_a_45 >> 15) & 1), ((_a_45 >> 16) & 1), ((_a_45 >> 17) & 1), ((_a_45 >> 18) & 1), ((_a_45 >> 19) & 1), ((_a_45 >> 20) & 1), ((_a_45 >> 21) & 1), ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_665[0];
    } else if ((_a_45 & 31) == 20) {
      Term _o_666[1];
      if (arm_109(e, _o_666, ((_a_45 >> 5) & 1), ((_a_45 >> 6) & 1), ((_a_45 >> 7) & 1), ((_a_45 >> 8) & 1), ((_a_45 >> 9) & 1), ((_a_45 >> 10) & 1), ((_a_45 >> 11) & 1), ((_a_45 >> 12) & 1), ((_a_45 >> 13) & 1), ((_a_45 >> 14) & 1), ((_a_45 >> 15) & 1), ((_a_45 >> 16) & 1), ((_a_45 >> 17) & 1), ((_a_45 >> 18) & 1), ((_a_45 >> 19) & 1), ((_a_45 >> 20) & 1), ((_a_45 >> 21) & 1), ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_666[0];
    } else if ((_a_45 & 15) == 4) {
      Term _o_667[1];
      if (arm_110(e, _o_667, ((_a_45 >> 4) & 1), ((_a_45 >> 5) & 1), ((_a_45 >> 6) & 1), ((_a_45 >> 7) & 1), ((_a_45 >> 8) & 1), ((_a_45 >> 9) & 1), ((_a_45 >> 10) & 1), ((_a_45 >> 11) & 1), ((_a_45 >> 12) & 1), ((_a_45 >> 13) & 1), ((_a_45 >> 14) & 1), ((_a_45 >> 15) & 1), ((_a_45 >> 16) & 1), ((_a_45 >> 17) & 1), ((_a_45 >> 18) & 1), ((_a_45 >> 19) & 1), ((_a_45 >> 20) & 1), ((_a_45 >> 21) & 1), ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_667[0];
    } else if ((_a_45 & 7) == 4) {
      Term _o_668[1];
      if (arm_111(e, _o_668, ((_a_45 >> 3) & 1), ((_a_45 >> 4) & 1), ((_a_45 >> 5) & 1), ((_a_45 >> 6) & 1), ((_a_45 >> 7) & 1), ((_a_45 >> 8) & 1), ((_a_45 >> 9) & 1), ((_a_45 >> 10) & 1), ((_a_45 >> 11) & 1), ((_a_45 >> 12) & 1), ((_a_45 >> 13) & 1), ((_a_45 >> 14) & 1), ((_a_45 >> 15) & 1), ((_a_45 >> 16) & 1), ((_a_45 >> 17) & 1), ((_a_45 >> 18) & 1), ((_a_45 >> 19) & 1), ((_a_45 >> 20) & 1), ((_a_45 >> 21) & 1), ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_668[0];
    } else if ((_a_45 & 3) == 0) {
      Term _o_669[1];
      if (arm_112(e, _o_669, ((_a_45 >> 2) & 1), ((_a_45 >> 3) & 1), ((_a_45 >> 4) & 1), ((_a_45 >> 5) & 1), ((_a_45 >> 6) & 1), ((_a_45 >> 7) & 1), ((_a_45 >> 8) & 1), ((_a_45 >> 9) & 1), ((_a_45 >> 10) & 1), ((_a_45 >> 11) & 1), ((_a_45 >> 12) & 1), ((_a_45 >> 13) & 1), ((_a_45 >> 14) & 1), ((_a_45 >> 15) & 1), ((_a_45 >> 16) & 1), ((_a_45 >> 17) & 1), ((_a_45 >> 18) & 1), ((_a_45 >> 19) & 1), ((_a_45 >> 20) & 1), ((_a_45 >> 21) & 1), ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_669[0];
    } else if ((_a_45 & 1) == 0) {
      Term _o_670[1];
      if (arm_113(e, _o_670, ((_a_45 >> 1) & 1), ((_a_45 >> 2) & 1), ((_a_45 >> 3) & 1), ((_a_45 >> 4) & 1), ((_a_45 >> 5) & 1), ((_a_45 >> 6) & 1), ((_a_45 >> 7) & 1), ((_a_45 >> 8) & 1), ((_a_45 >> 9) & 1), ((_a_45 >> 10) & 1), ((_a_45 >> 11) & 1), ((_a_45 >> 12) & 1), ((_a_45 >> 13) & 1), ((_a_45 >> 14) & 1), ((_a_45 >> 15) & 1), ((_a_45 >> 16) & 1), ((_a_45 >> 17) & 1), ((_a_45 >> 18) & 1), ((_a_45 >> 19) & 1), ((_a_45 >> 20) & 1), ((_a_45 >> 21) & 1), ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_670[0];
    } else {
      Term _o_671[1];
      if (arm_114(e, _o_671, ((_a_45 >> 0) & 1), ((_a_45 >> 1) & 1), ((_a_45 >> 2) & 1), ((_a_45 >> 3) & 1), ((_a_45 >> 4) & 1), ((_a_45 >> 5) & 1), ((_a_45 >> 6) & 1), ((_a_45 >> 7) & 1), ((_a_45 >> 8) & 1), ((_a_45 >> 9) & 1), ((_a_45 >> 10) & 1), ((_a_45 >> 11) & 1), ((_a_45 >> 12) & 1), ((_a_45 >> 13) & 1), ((_a_45 >> 14) & 1), ((_a_45 >> 15) & 1), ((_a_45 >> 16) & 1), ((_a_45 >> 17) & 1), ((_a_45 >> 18) & 1), ((_a_45 >> 19) & 1), ((_a_45 >> 20) & 1), ((_a_45 >> 21) & 1), ((_a_45 >> 22) & 1), ((_a_45 >> 23) & 1), ((_a_45 >> 24) & 1), ((_a_45 >> 25) & 1), ((_a_45 >> 26) & 1), ((_a_45 >> 27) & 1), ((_a_45 >> 28) & 1), ((_a_45 >> 29) & 1), ((_a_45 >> 30) & 1), ((_a_45 >> 31) & 1), _a_46, _a_47) == 0) {
        return 0;
      }
      _v_17 = _o_671[0];
    }
  break;
  }
  o[0] = _v_17;
  return 1;
}

INLINE Term arm_16(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_16 = 0;
  u32 _a_42 = r0;
  Term _a_43 = r1;
  Term _a_44 = r2;
  WL_SPIN
    Term _o_672[1];
    if (arm_17(e, _o_672, _a_42, _a_43, _a_44) == 0) {
      return 0;
    }
    _v_16 = _o_672[0];
  break;
  }
  o[0] = _v_16;
  return 1;
}

INLINE Term arm_15(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_15 = 0;
  Term _a_40 = r0;
  Term _a_41 = r1;
  WL_SPIN
    if (term_aux(_a_40) == CID_SCON) {
      Term _fb_5[2];
      u64 _sp_6 = ctr_take(e, _a_40, 2, _fb_5);
      u32 _f_12 = _fb_5[0];
      Term _f_13 = _fb_5[1];
      Term _o_673[1];
      if (arm_16(e, _o_673, _f_12, _f_13, _a_41) == 0) {
        return 0;
      }
      _v_15 = _o_673[0];
      spare_free(e, cls_fit(2), _sp_6);
    } else {
      Term _o_674[1];
      if (arm_80(e, _o_674, _a_40, _a_41) == 0) {
        return 0;
      }
      _v_15 = _o_674[0];
    }
  break;
  }
  o[0] = _v_15;
  return 1;
}

INLINE Term arm_14(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_14 = 0;
  u32 _a_37 = r0;
  Term _a_38 = r1;
  Term _a_39 = r2;
  WL_SPIN
    if (_a_37 == 115) {
      Term _o_675[1];
      if (arm_15(e, _o_675, _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_675[0];
    } else if ((_a_37 & 2147483647) == 115) {
      Term _o_676[1];
      if (arm_83(e, _o_676, ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_676[0];
    } else if ((_a_37 & 1073741823) == 115) {
      Term _o_677[1];
      if (arm_84(e, _o_677, ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_677[0];
    } else if ((_a_37 & 536870911) == 115) {
      Term _o_678[1];
      if (arm_85(e, _o_678, ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_678[0];
    } else if ((_a_37 & 268435455) == 115) {
      Term _o_679[1];
      if (arm_86(e, _o_679, ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_679[0];
    } else if ((_a_37 & 134217727) == 115) {
      Term _o_680[1];
      if (arm_87(e, _o_680, ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_680[0];
    } else if ((_a_37 & 67108863) == 115) {
      Term _o_681[1];
      if (arm_88(e, _o_681, ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_681[0];
    } else if ((_a_37 & 33554431) == 115) {
      Term _o_682[1];
      if (arm_89(e, _o_682, ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_682[0];
    } else if ((_a_37 & 16777215) == 115) {
      Term _o_683[1];
      if (arm_90(e, _o_683, ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_683[0];
    } else if ((_a_37 & 8388607) == 115) {
      Term _o_684[1];
      if (arm_91(e, _o_684, ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_684[0];
    } else if ((_a_37 & 4194303) == 115) {
      Term _o_685[1];
      if (arm_92(e, _o_685, ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_685[0];
    } else if ((_a_37 & 2097151) == 115) {
      Term _o_686[1];
      if (arm_93(e, _o_686, ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_686[0];
    } else if ((_a_37 & 1048575) == 115) {
      Term _o_687[1];
      if (arm_94(e, _o_687, ((_a_37 >> 20) & 1), ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_687[0];
    } else if ((_a_37 & 524287) == 115) {
      Term _o_688[1];
      if (arm_95(e, _o_688, ((_a_37 >> 19) & 1), ((_a_37 >> 20) & 1), ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_688[0];
    } else if ((_a_37 & 262143) == 115) {
      Term _o_689[1];
      if (arm_96(e, _o_689, ((_a_37 >> 18) & 1), ((_a_37 >> 19) & 1), ((_a_37 >> 20) & 1), ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_689[0];
    } else if ((_a_37 & 131071) == 115) {
      Term _o_690[1];
      if (arm_97(e, _o_690, ((_a_37 >> 17) & 1), ((_a_37 >> 18) & 1), ((_a_37 >> 19) & 1), ((_a_37 >> 20) & 1), ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_690[0];
    } else if ((_a_37 & 65535) == 115) {
      Term _o_691[1];
      if (arm_98(e, _o_691, ((_a_37 >> 16) & 1), ((_a_37 >> 17) & 1), ((_a_37 >> 18) & 1), ((_a_37 >> 19) & 1), ((_a_37 >> 20) & 1), ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_691[0];
    } else if ((_a_37 & 32767) == 115) {
      Term _o_692[1];
      if (arm_99(e, _o_692, ((_a_37 >> 15) & 1), ((_a_37 >> 16) & 1), ((_a_37 >> 17) & 1), ((_a_37 >> 18) & 1), ((_a_37 >> 19) & 1), ((_a_37 >> 20) & 1), ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_692[0];
    } else if ((_a_37 & 16383) == 115) {
      Term _o_693[1];
      if (arm_100(e, _o_693, ((_a_37 >> 14) & 1), ((_a_37 >> 15) & 1), ((_a_37 >> 16) & 1), ((_a_37 >> 17) & 1), ((_a_37 >> 18) & 1), ((_a_37 >> 19) & 1), ((_a_37 >> 20) & 1), ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_693[0];
    } else if ((_a_37 & 8191) == 115) {
      Term _o_694[1];
      if (arm_101(e, _o_694, ((_a_37 >> 13) & 1), ((_a_37 >> 14) & 1), ((_a_37 >> 15) & 1), ((_a_37 >> 16) & 1), ((_a_37 >> 17) & 1), ((_a_37 >> 18) & 1), ((_a_37 >> 19) & 1), ((_a_37 >> 20) & 1), ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_694[0];
    } else if ((_a_37 & 4095) == 115) {
      Term _o_695[1];
      if (arm_102(e, _o_695, ((_a_37 >> 12) & 1), ((_a_37 >> 13) & 1), ((_a_37 >> 14) & 1), ((_a_37 >> 15) & 1), ((_a_37 >> 16) & 1), ((_a_37 >> 17) & 1), ((_a_37 >> 18) & 1), ((_a_37 >> 19) & 1), ((_a_37 >> 20) & 1), ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_695[0];
    } else if ((_a_37 & 2047) == 115) {
      Term _o_696[1];
      if (arm_103(e, _o_696, ((_a_37 >> 11) & 1), ((_a_37 >> 12) & 1), ((_a_37 >> 13) & 1), ((_a_37 >> 14) & 1), ((_a_37 >> 15) & 1), ((_a_37 >> 16) & 1), ((_a_37 >> 17) & 1), ((_a_37 >> 18) & 1), ((_a_37 >> 19) & 1), ((_a_37 >> 20) & 1), ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_696[0];
    } else if ((_a_37 & 1023) == 115) {
      Term _o_697[1];
      if (arm_104(e, _o_697, ((_a_37 >> 10) & 1), ((_a_37 >> 11) & 1), ((_a_37 >> 12) & 1), ((_a_37 >> 13) & 1), ((_a_37 >> 14) & 1), ((_a_37 >> 15) & 1), ((_a_37 >> 16) & 1), ((_a_37 >> 17) & 1), ((_a_37 >> 18) & 1), ((_a_37 >> 19) & 1), ((_a_37 >> 20) & 1), ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_697[0];
    } else if ((_a_37 & 511) == 115) {
      Term _o_698[1];
      if (arm_105(e, _o_698, ((_a_37 >> 9) & 1), ((_a_37 >> 10) & 1), ((_a_37 >> 11) & 1), ((_a_37 >> 12) & 1), ((_a_37 >> 13) & 1), ((_a_37 >> 14) & 1), ((_a_37 >> 15) & 1), ((_a_37 >> 16) & 1), ((_a_37 >> 17) & 1), ((_a_37 >> 18) & 1), ((_a_37 >> 19) & 1), ((_a_37 >> 20) & 1), ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_698[0];
    } else if ((_a_37 & 255) == 115) {
      Term _o_699[1];
      if (arm_106(e, _o_699, ((_a_37 >> 8) & 1), ((_a_37 >> 9) & 1), ((_a_37 >> 10) & 1), ((_a_37 >> 11) & 1), ((_a_37 >> 12) & 1), ((_a_37 >> 13) & 1), ((_a_37 >> 14) & 1), ((_a_37 >> 15) & 1), ((_a_37 >> 16) & 1), ((_a_37 >> 17) & 1), ((_a_37 >> 18) & 1), ((_a_37 >> 19) & 1), ((_a_37 >> 20) & 1), ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_699[0];
    } else if ((_a_37 & 127) == 115) {
      Term _o_700[1];
      if (arm_107(e, _o_700, ((_a_37 >> 7) & 1), ((_a_37 >> 8) & 1), ((_a_37 >> 9) & 1), ((_a_37 >> 10) & 1), ((_a_37 >> 11) & 1), ((_a_37 >> 12) & 1), ((_a_37 >> 13) & 1), ((_a_37 >> 14) & 1), ((_a_37 >> 15) & 1), ((_a_37 >> 16) & 1), ((_a_37 >> 17) & 1), ((_a_37 >> 18) & 1), ((_a_37 >> 19) & 1), ((_a_37 >> 20) & 1), ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_700[0];
    } else if ((_a_37 & 63) == 51) {
      Term _o_701[1];
      if (arm_108(e, _o_701, ((_a_37 >> 6) & 1), ((_a_37 >> 7) & 1), ((_a_37 >> 8) & 1), ((_a_37 >> 9) & 1), ((_a_37 >> 10) & 1), ((_a_37 >> 11) & 1), ((_a_37 >> 12) & 1), ((_a_37 >> 13) & 1), ((_a_37 >> 14) & 1), ((_a_37 >> 15) & 1), ((_a_37 >> 16) & 1), ((_a_37 >> 17) & 1), ((_a_37 >> 18) & 1), ((_a_37 >> 19) & 1), ((_a_37 >> 20) & 1), ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_701[0];
    } else if ((_a_37 & 31) == 19) {
      Term _o_702[1];
      if (arm_109(e, _o_702, ((_a_37 >> 5) & 1), ((_a_37 >> 6) & 1), ((_a_37 >> 7) & 1), ((_a_37 >> 8) & 1), ((_a_37 >> 9) & 1), ((_a_37 >> 10) & 1), ((_a_37 >> 11) & 1), ((_a_37 >> 12) & 1), ((_a_37 >> 13) & 1), ((_a_37 >> 14) & 1), ((_a_37 >> 15) & 1), ((_a_37 >> 16) & 1), ((_a_37 >> 17) & 1), ((_a_37 >> 18) & 1), ((_a_37 >> 19) & 1), ((_a_37 >> 20) & 1), ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_702[0];
    } else if ((_a_37 & 15) == 3) {
      Term _o_703[1];
      if (arm_110(e, _o_703, ((_a_37 >> 4) & 1), ((_a_37 >> 5) & 1), ((_a_37 >> 6) & 1), ((_a_37 >> 7) & 1), ((_a_37 >> 8) & 1), ((_a_37 >> 9) & 1), ((_a_37 >> 10) & 1), ((_a_37 >> 11) & 1), ((_a_37 >> 12) & 1), ((_a_37 >> 13) & 1), ((_a_37 >> 14) & 1), ((_a_37 >> 15) & 1), ((_a_37 >> 16) & 1), ((_a_37 >> 17) & 1), ((_a_37 >> 18) & 1), ((_a_37 >> 19) & 1), ((_a_37 >> 20) & 1), ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_703[0];
    } else if ((_a_37 & 7) == 3) {
      Term _o_704[1];
      if (arm_111(e, _o_704, ((_a_37 >> 3) & 1), ((_a_37 >> 4) & 1), ((_a_37 >> 5) & 1), ((_a_37 >> 6) & 1), ((_a_37 >> 7) & 1), ((_a_37 >> 8) & 1), ((_a_37 >> 9) & 1), ((_a_37 >> 10) & 1), ((_a_37 >> 11) & 1), ((_a_37 >> 12) & 1), ((_a_37 >> 13) & 1), ((_a_37 >> 14) & 1), ((_a_37 >> 15) & 1), ((_a_37 >> 16) & 1), ((_a_37 >> 17) & 1), ((_a_37 >> 18) & 1), ((_a_37 >> 19) & 1), ((_a_37 >> 20) & 1), ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_704[0];
    } else if ((_a_37 & 3) == 3) {
      Term _o_705[1];
      if (arm_112(e, _o_705, ((_a_37 >> 2) & 1), ((_a_37 >> 3) & 1), ((_a_37 >> 4) & 1), ((_a_37 >> 5) & 1), ((_a_37 >> 6) & 1), ((_a_37 >> 7) & 1), ((_a_37 >> 8) & 1), ((_a_37 >> 9) & 1), ((_a_37 >> 10) & 1), ((_a_37 >> 11) & 1), ((_a_37 >> 12) & 1), ((_a_37 >> 13) & 1), ((_a_37 >> 14) & 1), ((_a_37 >> 15) & 1), ((_a_37 >> 16) & 1), ((_a_37 >> 17) & 1), ((_a_37 >> 18) & 1), ((_a_37 >> 19) & 1), ((_a_37 >> 20) & 1), ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_705[0];
    } else if ((_a_37 & 1) == 1) {
      Term _o_706[1];
      if (arm_113(e, _o_706, ((_a_37 >> 1) & 1), ((_a_37 >> 2) & 1), ((_a_37 >> 3) & 1), ((_a_37 >> 4) & 1), ((_a_37 >> 5) & 1), ((_a_37 >> 6) & 1), ((_a_37 >> 7) & 1), ((_a_37 >> 8) & 1), ((_a_37 >> 9) & 1), ((_a_37 >> 10) & 1), ((_a_37 >> 11) & 1), ((_a_37 >> 12) & 1), ((_a_37 >> 13) & 1), ((_a_37 >> 14) & 1), ((_a_37 >> 15) & 1), ((_a_37 >> 16) & 1), ((_a_37 >> 17) & 1), ((_a_37 >> 18) & 1), ((_a_37 >> 19) & 1), ((_a_37 >> 20) & 1), ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_706[0];
    } else {
      Term _o_707[1];
      if (arm_114(e, _o_707, ((_a_37 >> 0) & 1), ((_a_37 >> 1) & 1), ((_a_37 >> 2) & 1), ((_a_37 >> 3) & 1), ((_a_37 >> 4) & 1), ((_a_37 >> 5) & 1), ((_a_37 >> 6) & 1), ((_a_37 >> 7) & 1), ((_a_37 >> 8) & 1), ((_a_37 >> 9) & 1), ((_a_37 >> 10) & 1), ((_a_37 >> 11) & 1), ((_a_37 >> 12) & 1), ((_a_37 >> 13) & 1), ((_a_37 >> 14) & 1), ((_a_37 >> 15) & 1), ((_a_37 >> 16) & 1), ((_a_37 >> 17) & 1), ((_a_37 >> 18) & 1), ((_a_37 >> 19) & 1), ((_a_37 >> 20) & 1), ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38, _a_39) == 0) {
        return 0;
      }
      _v_14 = _o_707[0];
    }
  break;
  }
  o[0] = _v_14;
  return 1;
}

INLINE Term arm_13(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_13 = 0;
  u32 _a_34 = r0;
  Term _a_35 = r1;
  Term _a_36 = r2;
  WL_SPIN
    Term _o_708[1];
    if (arm_14(e, _o_708, _a_34, _a_35, _a_36) == 0) {
      return 0;
    }
    _v_13 = _o_708[0];
  break;
  }
  o[0] = _v_13;
  return 1;
}

INLINE Term arm_12(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_12 = 0;
  Term _a_32 = r0;
  Term _a_33 = r1;
  WL_SPIN
    if (term_aux(_a_32) == CID_SCON) {
      Term _fb_4[2];
      u64 _sp_5 = ctr_take(e, _a_32, 2, _fb_4);
      u32 _f_10 = _fb_4[0];
      Term _f_11 = _fb_4[1];
      Term _o_709[1];
      if (arm_13(e, _o_709, _f_10, _f_11, _a_33) == 0) {
        return 0;
      }
      _v_12 = _o_709[0];
      spare_free(e, cls_fit(2), _sp_5);
    } else {
      Term _o_710[1];
      if (arm_80(e, _o_710, _a_32, _a_33) == 0) {
        return 0;
      }
      _v_12 = _o_710[0];
    }
  break;
  }
  o[0] = _v_12;
  return 1;
}

INLINE Term arm_11(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_11 = 0;
  u32 _a_29 = r0;
  Term _a_30 = r1;
  Term _a_31 = r2;
  WL_SPIN
    if (_a_29 == 111) {
      Term _o_711[1];
      if (arm_12(e, _o_711, _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_711[0];
    } else if ((_a_29 & 2147483647) == 111) {
      Term _o_712[1];
      if (arm_83(e, _o_712, ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_712[0];
    } else if ((_a_29 & 1073741823) == 111) {
      Term _o_713[1];
      if (arm_84(e, _o_713, ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_713[0];
    } else if ((_a_29 & 536870911) == 111) {
      Term _o_714[1];
      if (arm_85(e, _o_714, ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_714[0];
    } else if ((_a_29 & 268435455) == 111) {
      Term _o_715[1];
      if (arm_86(e, _o_715, ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_715[0];
    } else if ((_a_29 & 134217727) == 111) {
      Term _o_716[1];
      if (arm_87(e, _o_716, ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_716[0];
    } else if ((_a_29 & 67108863) == 111) {
      Term _o_717[1];
      if (arm_88(e, _o_717, ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_717[0];
    } else if ((_a_29 & 33554431) == 111) {
      Term _o_718[1];
      if (arm_89(e, _o_718, ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_718[0];
    } else if ((_a_29 & 16777215) == 111) {
      Term _o_719[1];
      if (arm_90(e, _o_719, ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_719[0];
    } else if ((_a_29 & 8388607) == 111) {
      Term _o_720[1];
      if (arm_91(e, _o_720, ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_720[0];
    } else if ((_a_29 & 4194303) == 111) {
      Term _o_721[1];
      if (arm_92(e, _o_721, ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_721[0];
    } else if ((_a_29 & 2097151) == 111) {
      Term _o_722[1];
      if (arm_93(e, _o_722, ((_a_29 >> 21) & 1), ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_722[0];
    } else if ((_a_29 & 1048575) == 111) {
      Term _o_723[1];
      if (arm_94(e, _o_723, ((_a_29 >> 20) & 1), ((_a_29 >> 21) & 1), ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_723[0];
    } else if ((_a_29 & 524287) == 111) {
      Term _o_724[1];
      if (arm_95(e, _o_724, ((_a_29 >> 19) & 1), ((_a_29 >> 20) & 1), ((_a_29 >> 21) & 1), ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_724[0];
    } else if ((_a_29 & 262143) == 111) {
      Term _o_725[1];
      if (arm_96(e, _o_725, ((_a_29 >> 18) & 1), ((_a_29 >> 19) & 1), ((_a_29 >> 20) & 1), ((_a_29 >> 21) & 1), ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_725[0];
    } else if ((_a_29 & 131071) == 111) {
      Term _o_726[1];
      if (arm_97(e, _o_726, ((_a_29 >> 17) & 1), ((_a_29 >> 18) & 1), ((_a_29 >> 19) & 1), ((_a_29 >> 20) & 1), ((_a_29 >> 21) & 1), ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_726[0];
    } else if ((_a_29 & 65535) == 111) {
      Term _o_727[1];
      if (arm_98(e, _o_727, ((_a_29 >> 16) & 1), ((_a_29 >> 17) & 1), ((_a_29 >> 18) & 1), ((_a_29 >> 19) & 1), ((_a_29 >> 20) & 1), ((_a_29 >> 21) & 1), ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_727[0];
    } else if ((_a_29 & 32767) == 111) {
      Term _o_728[1];
      if (arm_99(e, _o_728, ((_a_29 >> 15) & 1), ((_a_29 >> 16) & 1), ((_a_29 >> 17) & 1), ((_a_29 >> 18) & 1), ((_a_29 >> 19) & 1), ((_a_29 >> 20) & 1), ((_a_29 >> 21) & 1), ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_728[0];
    } else if ((_a_29 & 16383) == 111) {
      Term _o_729[1];
      if (arm_100(e, _o_729, ((_a_29 >> 14) & 1), ((_a_29 >> 15) & 1), ((_a_29 >> 16) & 1), ((_a_29 >> 17) & 1), ((_a_29 >> 18) & 1), ((_a_29 >> 19) & 1), ((_a_29 >> 20) & 1), ((_a_29 >> 21) & 1), ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_729[0];
    } else if ((_a_29 & 8191) == 111) {
      Term _o_730[1];
      if (arm_101(e, _o_730, ((_a_29 >> 13) & 1), ((_a_29 >> 14) & 1), ((_a_29 >> 15) & 1), ((_a_29 >> 16) & 1), ((_a_29 >> 17) & 1), ((_a_29 >> 18) & 1), ((_a_29 >> 19) & 1), ((_a_29 >> 20) & 1), ((_a_29 >> 21) & 1), ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_730[0];
    } else if ((_a_29 & 4095) == 111) {
      Term _o_731[1];
      if (arm_102(e, _o_731, ((_a_29 >> 12) & 1), ((_a_29 >> 13) & 1), ((_a_29 >> 14) & 1), ((_a_29 >> 15) & 1), ((_a_29 >> 16) & 1), ((_a_29 >> 17) & 1), ((_a_29 >> 18) & 1), ((_a_29 >> 19) & 1), ((_a_29 >> 20) & 1), ((_a_29 >> 21) & 1), ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_731[0];
    } else if ((_a_29 & 2047) == 111) {
      Term _o_732[1];
      if (arm_103(e, _o_732, ((_a_29 >> 11) & 1), ((_a_29 >> 12) & 1), ((_a_29 >> 13) & 1), ((_a_29 >> 14) & 1), ((_a_29 >> 15) & 1), ((_a_29 >> 16) & 1), ((_a_29 >> 17) & 1), ((_a_29 >> 18) & 1), ((_a_29 >> 19) & 1), ((_a_29 >> 20) & 1), ((_a_29 >> 21) & 1), ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_732[0];
    } else if ((_a_29 & 1023) == 111) {
      Term _o_733[1];
      if (arm_104(e, _o_733, ((_a_29 >> 10) & 1), ((_a_29 >> 11) & 1), ((_a_29 >> 12) & 1), ((_a_29 >> 13) & 1), ((_a_29 >> 14) & 1), ((_a_29 >> 15) & 1), ((_a_29 >> 16) & 1), ((_a_29 >> 17) & 1), ((_a_29 >> 18) & 1), ((_a_29 >> 19) & 1), ((_a_29 >> 20) & 1), ((_a_29 >> 21) & 1), ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_733[0];
    } else if ((_a_29 & 511) == 111) {
      Term _o_734[1];
      if (arm_105(e, _o_734, ((_a_29 >> 9) & 1), ((_a_29 >> 10) & 1), ((_a_29 >> 11) & 1), ((_a_29 >> 12) & 1), ((_a_29 >> 13) & 1), ((_a_29 >> 14) & 1), ((_a_29 >> 15) & 1), ((_a_29 >> 16) & 1), ((_a_29 >> 17) & 1), ((_a_29 >> 18) & 1), ((_a_29 >> 19) & 1), ((_a_29 >> 20) & 1), ((_a_29 >> 21) & 1), ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_734[0];
    } else if ((_a_29 & 255) == 111) {
      Term _o_735[1];
      if (arm_106(e, _o_735, ((_a_29 >> 8) & 1), ((_a_29 >> 9) & 1), ((_a_29 >> 10) & 1), ((_a_29 >> 11) & 1), ((_a_29 >> 12) & 1), ((_a_29 >> 13) & 1), ((_a_29 >> 14) & 1), ((_a_29 >> 15) & 1), ((_a_29 >> 16) & 1), ((_a_29 >> 17) & 1), ((_a_29 >> 18) & 1), ((_a_29 >> 19) & 1), ((_a_29 >> 20) & 1), ((_a_29 >> 21) & 1), ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_735[0];
    } else if ((_a_29 & 127) == 111) {
      Term _o_736[1];
      if (arm_107(e, _o_736, ((_a_29 >> 7) & 1), ((_a_29 >> 8) & 1), ((_a_29 >> 9) & 1), ((_a_29 >> 10) & 1), ((_a_29 >> 11) & 1), ((_a_29 >> 12) & 1), ((_a_29 >> 13) & 1), ((_a_29 >> 14) & 1), ((_a_29 >> 15) & 1), ((_a_29 >> 16) & 1), ((_a_29 >> 17) & 1), ((_a_29 >> 18) & 1), ((_a_29 >> 19) & 1), ((_a_29 >> 20) & 1), ((_a_29 >> 21) & 1), ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_736[0];
    } else if ((_a_29 & 63) == 47) {
      Term _o_737[1];
      if (arm_108(e, _o_737, ((_a_29 >> 6) & 1), ((_a_29 >> 7) & 1), ((_a_29 >> 8) & 1), ((_a_29 >> 9) & 1), ((_a_29 >> 10) & 1), ((_a_29 >> 11) & 1), ((_a_29 >> 12) & 1), ((_a_29 >> 13) & 1), ((_a_29 >> 14) & 1), ((_a_29 >> 15) & 1), ((_a_29 >> 16) & 1), ((_a_29 >> 17) & 1), ((_a_29 >> 18) & 1), ((_a_29 >> 19) & 1), ((_a_29 >> 20) & 1), ((_a_29 >> 21) & 1), ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_737[0];
    } else if ((_a_29 & 31) == 15) {
      Term _o_738[1];
      if (arm_109(e, _o_738, ((_a_29 >> 5) & 1), ((_a_29 >> 6) & 1), ((_a_29 >> 7) & 1), ((_a_29 >> 8) & 1), ((_a_29 >> 9) & 1), ((_a_29 >> 10) & 1), ((_a_29 >> 11) & 1), ((_a_29 >> 12) & 1), ((_a_29 >> 13) & 1), ((_a_29 >> 14) & 1), ((_a_29 >> 15) & 1), ((_a_29 >> 16) & 1), ((_a_29 >> 17) & 1), ((_a_29 >> 18) & 1), ((_a_29 >> 19) & 1), ((_a_29 >> 20) & 1), ((_a_29 >> 21) & 1), ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_738[0];
    } else if ((_a_29 & 15) == 15) {
      Term _o_739[1];
      if (arm_110(e, _o_739, ((_a_29 >> 4) & 1), ((_a_29 >> 5) & 1), ((_a_29 >> 6) & 1), ((_a_29 >> 7) & 1), ((_a_29 >> 8) & 1), ((_a_29 >> 9) & 1), ((_a_29 >> 10) & 1), ((_a_29 >> 11) & 1), ((_a_29 >> 12) & 1), ((_a_29 >> 13) & 1), ((_a_29 >> 14) & 1), ((_a_29 >> 15) & 1), ((_a_29 >> 16) & 1), ((_a_29 >> 17) & 1), ((_a_29 >> 18) & 1), ((_a_29 >> 19) & 1), ((_a_29 >> 20) & 1), ((_a_29 >> 21) & 1), ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_739[0];
    } else if ((_a_29 & 7) == 7) {
      Term _o_740[1];
      if (arm_111(e, _o_740, ((_a_29 >> 3) & 1), ((_a_29 >> 4) & 1), ((_a_29 >> 5) & 1), ((_a_29 >> 6) & 1), ((_a_29 >> 7) & 1), ((_a_29 >> 8) & 1), ((_a_29 >> 9) & 1), ((_a_29 >> 10) & 1), ((_a_29 >> 11) & 1), ((_a_29 >> 12) & 1), ((_a_29 >> 13) & 1), ((_a_29 >> 14) & 1), ((_a_29 >> 15) & 1), ((_a_29 >> 16) & 1), ((_a_29 >> 17) & 1), ((_a_29 >> 18) & 1), ((_a_29 >> 19) & 1), ((_a_29 >> 20) & 1), ((_a_29 >> 21) & 1), ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_740[0];
    } else if ((_a_29 & 3) == 3) {
      Term _o_741[1];
      if (arm_112(e, _o_741, ((_a_29 >> 2) & 1), ((_a_29 >> 3) & 1), ((_a_29 >> 4) & 1), ((_a_29 >> 5) & 1), ((_a_29 >> 6) & 1), ((_a_29 >> 7) & 1), ((_a_29 >> 8) & 1), ((_a_29 >> 9) & 1), ((_a_29 >> 10) & 1), ((_a_29 >> 11) & 1), ((_a_29 >> 12) & 1), ((_a_29 >> 13) & 1), ((_a_29 >> 14) & 1), ((_a_29 >> 15) & 1), ((_a_29 >> 16) & 1), ((_a_29 >> 17) & 1), ((_a_29 >> 18) & 1), ((_a_29 >> 19) & 1), ((_a_29 >> 20) & 1), ((_a_29 >> 21) & 1), ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_741[0];
    } else if ((_a_29 & 1) == 1) {
      Term _o_742[1];
      if (arm_113(e, _o_742, ((_a_29 >> 1) & 1), ((_a_29 >> 2) & 1), ((_a_29 >> 3) & 1), ((_a_29 >> 4) & 1), ((_a_29 >> 5) & 1), ((_a_29 >> 6) & 1), ((_a_29 >> 7) & 1), ((_a_29 >> 8) & 1), ((_a_29 >> 9) & 1), ((_a_29 >> 10) & 1), ((_a_29 >> 11) & 1), ((_a_29 >> 12) & 1), ((_a_29 >> 13) & 1), ((_a_29 >> 14) & 1), ((_a_29 >> 15) & 1), ((_a_29 >> 16) & 1), ((_a_29 >> 17) & 1), ((_a_29 >> 18) & 1), ((_a_29 >> 19) & 1), ((_a_29 >> 20) & 1), ((_a_29 >> 21) & 1), ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_742[0];
    } else {
      Term _o_743[1];
      if (arm_114(e, _o_743, ((_a_29 >> 0) & 1), ((_a_29 >> 1) & 1), ((_a_29 >> 2) & 1), ((_a_29 >> 3) & 1), ((_a_29 >> 4) & 1), ((_a_29 >> 5) & 1), ((_a_29 >> 6) & 1), ((_a_29 >> 7) & 1), ((_a_29 >> 8) & 1), ((_a_29 >> 9) & 1), ((_a_29 >> 10) & 1), ((_a_29 >> 11) & 1), ((_a_29 >> 12) & 1), ((_a_29 >> 13) & 1), ((_a_29 >> 14) & 1), ((_a_29 >> 15) & 1), ((_a_29 >> 16) & 1), ((_a_29 >> 17) & 1), ((_a_29 >> 18) & 1), ((_a_29 >> 19) & 1), ((_a_29 >> 20) & 1), ((_a_29 >> 21) & 1), ((_a_29 >> 22) & 1), ((_a_29 >> 23) & 1), ((_a_29 >> 24) & 1), ((_a_29 >> 25) & 1), ((_a_29 >> 26) & 1), ((_a_29 >> 27) & 1), ((_a_29 >> 28) & 1), ((_a_29 >> 29) & 1), ((_a_29 >> 30) & 1), ((_a_29 >> 31) & 1), _a_30, _a_31) == 0) {
        return 0;
      }
      _v_11 = _o_743[0];
    }
  break;
  }
  o[0] = _v_11;
  return 1;
}

INLINE Term arm_10(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_10 = 0;
  u32 _a_26 = r0;
  Term _a_27 = r1;
  Term _a_28 = r2;
  WL_SPIN
    Term _o_744[1];
    if (arm_11(e, _o_744, _a_26, _a_27, _a_28) == 0) {
      return 0;
    }
    _v_10 = _o_744[0];
  break;
  }
  o[0] = _v_10;
  return 1;
}

INLINE Term arm_9(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_9 = 0;
  Term _a_24 = r0;
  Term _a_25 = r1;
  WL_SPIN
    if (term_aux(_a_24) == CID_SCON) {
      Term _fb_3[2];
      u64 _sp_4 = ctr_take(e, _a_24, 2, _fb_3);
      u32 _f_8 = _fb_3[0];
      Term _f_9 = _fb_3[1];
      Term _o_745[1];
      if (arm_10(e, _o_745, _f_8, _f_9, _a_25) == 0) {
        return 0;
      }
      _v_9 = _o_745[0];
      spare_free(e, cls_fit(2), _sp_4);
    } else {
      Term _o_746[1];
      if (arm_80(e, _o_746, _a_24, _a_25) == 0) {
        return 0;
      }
      _v_9 = _o_746[0];
    }
  break;
  }
  o[0] = _v_9;
  return 1;
}

INLINE Term arm_8(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_8 = 0;
  u32 _a_21 = r0;
  Term _a_22 = r1;
  Term _a_23 = r2;
  WL_SPIN
    if (_a_21 == 104) {
      Term _o_747[1];
      if (arm_9(e, _o_747, _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_747[0];
    } else if ((_a_21 & 2147483647) == 104) {
      Term _o_748[1];
      if (arm_83(e, _o_748, ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_748[0];
    } else if ((_a_21 & 1073741823) == 104) {
      Term _o_749[1];
      if (arm_84(e, _o_749, ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_749[0];
    } else if ((_a_21 & 536870911) == 104) {
      Term _o_750[1];
      if (arm_85(e, _o_750, ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_750[0];
    } else if ((_a_21 & 268435455) == 104) {
      Term _o_751[1];
      if (arm_86(e, _o_751, ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_751[0];
    } else if ((_a_21 & 134217727) == 104) {
      Term _o_752[1];
      if (arm_87(e, _o_752, ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_752[0];
    } else if ((_a_21 & 67108863) == 104) {
      Term _o_753[1];
      if (arm_88(e, _o_753, ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_753[0];
    } else if ((_a_21 & 33554431) == 104) {
      Term _o_754[1];
      if (arm_89(e, _o_754, ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_754[0];
    } else if ((_a_21 & 16777215) == 104) {
      Term _o_755[1];
      if (arm_90(e, _o_755, ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_755[0];
    } else if ((_a_21 & 8388607) == 104) {
      Term _o_756[1];
      if (arm_91(e, _o_756, ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_756[0];
    } else if ((_a_21 & 4194303) == 104) {
      Term _o_757[1];
      if (arm_92(e, _o_757, ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_757[0];
    } else if ((_a_21 & 2097151) == 104) {
      Term _o_758[1];
      if (arm_93(e, _o_758, ((_a_21 >> 21) & 1), ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_758[0];
    } else if ((_a_21 & 1048575) == 104) {
      Term _o_759[1];
      if (arm_94(e, _o_759, ((_a_21 >> 20) & 1), ((_a_21 >> 21) & 1), ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_759[0];
    } else if ((_a_21 & 524287) == 104) {
      Term _o_760[1];
      if (arm_95(e, _o_760, ((_a_21 >> 19) & 1), ((_a_21 >> 20) & 1), ((_a_21 >> 21) & 1), ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_760[0];
    } else if ((_a_21 & 262143) == 104) {
      Term _o_761[1];
      if (arm_96(e, _o_761, ((_a_21 >> 18) & 1), ((_a_21 >> 19) & 1), ((_a_21 >> 20) & 1), ((_a_21 >> 21) & 1), ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_761[0];
    } else if ((_a_21 & 131071) == 104) {
      Term _o_762[1];
      if (arm_97(e, _o_762, ((_a_21 >> 17) & 1), ((_a_21 >> 18) & 1), ((_a_21 >> 19) & 1), ((_a_21 >> 20) & 1), ((_a_21 >> 21) & 1), ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_762[0];
    } else if ((_a_21 & 65535) == 104) {
      Term _o_763[1];
      if (arm_98(e, _o_763, ((_a_21 >> 16) & 1), ((_a_21 >> 17) & 1), ((_a_21 >> 18) & 1), ((_a_21 >> 19) & 1), ((_a_21 >> 20) & 1), ((_a_21 >> 21) & 1), ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_763[0];
    } else if ((_a_21 & 32767) == 104) {
      Term _o_764[1];
      if (arm_99(e, _o_764, ((_a_21 >> 15) & 1), ((_a_21 >> 16) & 1), ((_a_21 >> 17) & 1), ((_a_21 >> 18) & 1), ((_a_21 >> 19) & 1), ((_a_21 >> 20) & 1), ((_a_21 >> 21) & 1), ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_764[0];
    } else if ((_a_21 & 16383) == 104) {
      Term _o_765[1];
      if (arm_100(e, _o_765, ((_a_21 >> 14) & 1), ((_a_21 >> 15) & 1), ((_a_21 >> 16) & 1), ((_a_21 >> 17) & 1), ((_a_21 >> 18) & 1), ((_a_21 >> 19) & 1), ((_a_21 >> 20) & 1), ((_a_21 >> 21) & 1), ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_765[0];
    } else if ((_a_21 & 8191) == 104) {
      Term _o_766[1];
      if (arm_101(e, _o_766, ((_a_21 >> 13) & 1), ((_a_21 >> 14) & 1), ((_a_21 >> 15) & 1), ((_a_21 >> 16) & 1), ((_a_21 >> 17) & 1), ((_a_21 >> 18) & 1), ((_a_21 >> 19) & 1), ((_a_21 >> 20) & 1), ((_a_21 >> 21) & 1), ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_766[0];
    } else if ((_a_21 & 4095) == 104) {
      Term _o_767[1];
      if (arm_102(e, _o_767, ((_a_21 >> 12) & 1), ((_a_21 >> 13) & 1), ((_a_21 >> 14) & 1), ((_a_21 >> 15) & 1), ((_a_21 >> 16) & 1), ((_a_21 >> 17) & 1), ((_a_21 >> 18) & 1), ((_a_21 >> 19) & 1), ((_a_21 >> 20) & 1), ((_a_21 >> 21) & 1), ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_767[0];
    } else if ((_a_21 & 2047) == 104) {
      Term _o_768[1];
      if (arm_103(e, _o_768, ((_a_21 >> 11) & 1), ((_a_21 >> 12) & 1), ((_a_21 >> 13) & 1), ((_a_21 >> 14) & 1), ((_a_21 >> 15) & 1), ((_a_21 >> 16) & 1), ((_a_21 >> 17) & 1), ((_a_21 >> 18) & 1), ((_a_21 >> 19) & 1), ((_a_21 >> 20) & 1), ((_a_21 >> 21) & 1), ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_768[0];
    } else if ((_a_21 & 1023) == 104) {
      Term _o_769[1];
      if (arm_104(e, _o_769, ((_a_21 >> 10) & 1), ((_a_21 >> 11) & 1), ((_a_21 >> 12) & 1), ((_a_21 >> 13) & 1), ((_a_21 >> 14) & 1), ((_a_21 >> 15) & 1), ((_a_21 >> 16) & 1), ((_a_21 >> 17) & 1), ((_a_21 >> 18) & 1), ((_a_21 >> 19) & 1), ((_a_21 >> 20) & 1), ((_a_21 >> 21) & 1), ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_769[0];
    } else if ((_a_21 & 511) == 104) {
      Term _o_770[1];
      if (arm_105(e, _o_770, ((_a_21 >> 9) & 1), ((_a_21 >> 10) & 1), ((_a_21 >> 11) & 1), ((_a_21 >> 12) & 1), ((_a_21 >> 13) & 1), ((_a_21 >> 14) & 1), ((_a_21 >> 15) & 1), ((_a_21 >> 16) & 1), ((_a_21 >> 17) & 1), ((_a_21 >> 18) & 1), ((_a_21 >> 19) & 1), ((_a_21 >> 20) & 1), ((_a_21 >> 21) & 1), ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_770[0];
    } else if ((_a_21 & 255) == 104) {
      Term _o_771[1];
      if (arm_106(e, _o_771, ((_a_21 >> 8) & 1), ((_a_21 >> 9) & 1), ((_a_21 >> 10) & 1), ((_a_21 >> 11) & 1), ((_a_21 >> 12) & 1), ((_a_21 >> 13) & 1), ((_a_21 >> 14) & 1), ((_a_21 >> 15) & 1), ((_a_21 >> 16) & 1), ((_a_21 >> 17) & 1), ((_a_21 >> 18) & 1), ((_a_21 >> 19) & 1), ((_a_21 >> 20) & 1), ((_a_21 >> 21) & 1), ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_771[0];
    } else if ((_a_21 & 127) == 104) {
      Term _o_772[1];
      if (arm_107(e, _o_772, ((_a_21 >> 7) & 1), ((_a_21 >> 8) & 1), ((_a_21 >> 9) & 1), ((_a_21 >> 10) & 1), ((_a_21 >> 11) & 1), ((_a_21 >> 12) & 1), ((_a_21 >> 13) & 1), ((_a_21 >> 14) & 1), ((_a_21 >> 15) & 1), ((_a_21 >> 16) & 1), ((_a_21 >> 17) & 1), ((_a_21 >> 18) & 1), ((_a_21 >> 19) & 1), ((_a_21 >> 20) & 1), ((_a_21 >> 21) & 1), ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_772[0];
    } else if ((_a_21 & 63) == 40) {
      Term _o_773[1];
      if (arm_108(e, _o_773, ((_a_21 >> 6) & 1), ((_a_21 >> 7) & 1), ((_a_21 >> 8) & 1), ((_a_21 >> 9) & 1), ((_a_21 >> 10) & 1), ((_a_21 >> 11) & 1), ((_a_21 >> 12) & 1), ((_a_21 >> 13) & 1), ((_a_21 >> 14) & 1), ((_a_21 >> 15) & 1), ((_a_21 >> 16) & 1), ((_a_21 >> 17) & 1), ((_a_21 >> 18) & 1), ((_a_21 >> 19) & 1), ((_a_21 >> 20) & 1), ((_a_21 >> 21) & 1), ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_773[0];
    } else if ((_a_21 & 31) == 8) {
      Term _o_774[1];
      if (arm_109(e, _o_774, ((_a_21 >> 5) & 1), ((_a_21 >> 6) & 1), ((_a_21 >> 7) & 1), ((_a_21 >> 8) & 1), ((_a_21 >> 9) & 1), ((_a_21 >> 10) & 1), ((_a_21 >> 11) & 1), ((_a_21 >> 12) & 1), ((_a_21 >> 13) & 1), ((_a_21 >> 14) & 1), ((_a_21 >> 15) & 1), ((_a_21 >> 16) & 1), ((_a_21 >> 17) & 1), ((_a_21 >> 18) & 1), ((_a_21 >> 19) & 1), ((_a_21 >> 20) & 1), ((_a_21 >> 21) & 1), ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_774[0];
    } else if ((_a_21 & 15) == 8) {
      Term _o_775[1];
      if (arm_110(e, _o_775, ((_a_21 >> 4) & 1), ((_a_21 >> 5) & 1), ((_a_21 >> 6) & 1), ((_a_21 >> 7) & 1), ((_a_21 >> 8) & 1), ((_a_21 >> 9) & 1), ((_a_21 >> 10) & 1), ((_a_21 >> 11) & 1), ((_a_21 >> 12) & 1), ((_a_21 >> 13) & 1), ((_a_21 >> 14) & 1), ((_a_21 >> 15) & 1), ((_a_21 >> 16) & 1), ((_a_21 >> 17) & 1), ((_a_21 >> 18) & 1), ((_a_21 >> 19) & 1), ((_a_21 >> 20) & 1), ((_a_21 >> 21) & 1), ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_775[0];
    } else if ((_a_21 & 7) == 0) {
      Term _o_776[1];
      if (arm_111(e, _o_776, ((_a_21 >> 3) & 1), ((_a_21 >> 4) & 1), ((_a_21 >> 5) & 1), ((_a_21 >> 6) & 1), ((_a_21 >> 7) & 1), ((_a_21 >> 8) & 1), ((_a_21 >> 9) & 1), ((_a_21 >> 10) & 1), ((_a_21 >> 11) & 1), ((_a_21 >> 12) & 1), ((_a_21 >> 13) & 1), ((_a_21 >> 14) & 1), ((_a_21 >> 15) & 1), ((_a_21 >> 16) & 1), ((_a_21 >> 17) & 1), ((_a_21 >> 18) & 1), ((_a_21 >> 19) & 1), ((_a_21 >> 20) & 1), ((_a_21 >> 21) & 1), ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_776[0];
    } else if ((_a_21 & 3) == 0) {
      Term _o_777[1];
      if (arm_112(e, _o_777, ((_a_21 >> 2) & 1), ((_a_21 >> 3) & 1), ((_a_21 >> 4) & 1), ((_a_21 >> 5) & 1), ((_a_21 >> 6) & 1), ((_a_21 >> 7) & 1), ((_a_21 >> 8) & 1), ((_a_21 >> 9) & 1), ((_a_21 >> 10) & 1), ((_a_21 >> 11) & 1), ((_a_21 >> 12) & 1), ((_a_21 >> 13) & 1), ((_a_21 >> 14) & 1), ((_a_21 >> 15) & 1), ((_a_21 >> 16) & 1), ((_a_21 >> 17) & 1), ((_a_21 >> 18) & 1), ((_a_21 >> 19) & 1), ((_a_21 >> 20) & 1), ((_a_21 >> 21) & 1), ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_777[0];
    } else if ((_a_21 & 1) == 0) {
      Term _o_778[1];
      if (arm_113(e, _o_778, ((_a_21 >> 1) & 1), ((_a_21 >> 2) & 1), ((_a_21 >> 3) & 1), ((_a_21 >> 4) & 1), ((_a_21 >> 5) & 1), ((_a_21 >> 6) & 1), ((_a_21 >> 7) & 1), ((_a_21 >> 8) & 1), ((_a_21 >> 9) & 1), ((_a_21 >> 10) & 1), ((_a_21 >> 11) & 1), ((_a_21 >> 12) & 1), ((_a_21 >> 13) & 1), ((_a_21 >> 14) & 1), ((_a_21 >> 15) & 1), ((_a_21 >> 16) & 1), ((_a_21 >> 17) & 1), ((_a_21 >> 18) & 1), ((_a_21 >> 19) & 1), ((_a_21 >> 20) & 1), ((_a_21 >> 21) & 1), ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_778[0];
    } else {
      Term _o_779[1];
      if (arm_114(e, _o_779, ((_a_21 >> 0) & 1), ((_a_21 >> 1) & 1), ((_a_21 >> 2) & 1), ((_a_21 >> 3) & 1), ((_a_21 >> 4) & 1), ((_a_21 >> 5) & 1), ((_a_21 >> 6) & 1), ((_a_21 >> 7) & 1), ((_a_21 >> 8) & 1), ((_a_21 >> 9) & 1), ((_a_21 >> 10) & 1), ((_a_21 >> 11) & 1), ((_a_21 >> 12) & 1), ((_a_21 >> 13) & 1), ((_a_21 >> 14) & 1), ((_a_21 >> 15) & 1), ((_a_21 >> 16) & 1), ((_a_21 >> 17) & 1), ((_a_21 >> 18) & 1), ((_a_21 >> 19) & 1), ((_a_21 >> 20) & 1), ((_a_21 >> 21) & 1), ((_a_21 >> 22) & 1), ((_a_21 >> 23) & 1), ((_a_21 >> 24) & 1), ((_a_21 >> 25) & 1), ((_a_21 >> 26) & 1), ((_a_21 >> 27) & 1), ((_a_21 >> 28) & 1), ((_a_21 >> 29) & 1), ((_a_21 >> 30) & 1), ((_a_21 >> 31) & 1), _a_22, _a_23) == 0) {
        return 0;
      }
      _v_8 = _o_779[0];
    }
  break;
  }
  o[0] = _v_8;
  return 1;
}

INLINE Term arm_7(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_7 = 0;
  u32 _a_18 = r0;
  Term _a_19 = r1;
  Term _a_20 = r2;
  WL_SPIN
    Term _o_780[1];
    if (arm_8(e, _o_780, _a_18, _a_19, _a_20) == 0) {
      return 0;
    }
    _v_7 = _o_780[0];
  break;
  }
  o[0] = _v_7;
  return 1;
}

INLINE Term arm_6(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_6 = 0;
  Term _a_16 = r0;
  Term _a_17 = r1;
  WL_SPIN
    if (term_aux(_a_16) == CID_SCON) {
      Term _fb_2[2];
      u64 _sp_3 = ctr_take(e, _a_16, 2, _fb_2);
      u32 _f_6 = _fb_2[0];
      Term _f_7 = _fb_2[1];
      Term _o_781[1];
      if (arm_7(e, _o_781, _f_6, _f_7, _a_17) == 0) {
        return 0;
      }
      _v_6 = _o_781[0];
      spare_free(e, cls_fit(2), _sp_3);
    } else {
      Term _o_782[1];
      if (arm_80(e, _o_782, _a_16, _a_17) == 0) {
        return 0;
      }
      _v_6 = _o_782[0];
    }
  break;
  }
  o[0] = _v_6;
  return 1;
}

INLINE Term arm_5(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_5 = 0;
  u32 _a_13 = r0;
  Term _a_14 = r1;
  Term _a_15 = r2;
  WL_SPIN
    if (_a_13 == 45) {
      Term _o_783[1];
      if (arm_6(e, _o_783, _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_783[0];
    } else if ((_a_13 & 2147483647) == 45) {
      Term _o_784[1];
      if (arm_83(e, _o_784, ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_784[0];
    } else if ((_a_13 & 1073741823) == 45) {
      Term _o_785[1];
      if (arm_84(e, _o_785, ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_785[0];
    } else if ((_a_13 & 536870911) == 45) {
      Term _o_786[1];
      if (arm_85(e, _o_786, ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_786[0];
    } else if ((_a_13 & 268435455) == 45) {
      Term _o_787[1];
      if (arm_86(e, _o_787, ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_787[0];
    } else if ((_a_13 & 134217727) == 45) {
      Term _o_788[1];
      if (arm_87(e, _o_788, ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_788[0];
    } else if ((_a_13 & 67108863) == 45) {
      Term _o_789[1];
      if (arm_88(e, _o_789, ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_789[0];
    } else if ((_a_13 & 33554431) == 45) {
      Term _o_790[1];
      if (arm_89(e, _o_790, ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_790[0];
    } else if ((_a_13 & 16777215) == 45) {
      Term _o_791[1];
      if (arm_90(e, _o_791, ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_791[0];
    } else if ((_a_13 & 8388607) == 45) {
      Term _o_792[1];
      if (arm_91(e, _o_792, ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_792[0];
    } else if ((_a_13 & 4194303) == 45) {
      Term _o_793[1];
      if (arm_92(e, _o_793, ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_793[0];
    } else if ((_a_13 & 2097151) == 45) {
      Term _o_794[1];
      if (arm_93(e, _o_794, ((_a_13 >> 21) & 1), ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_794[0];
    } else if ((_a_13 & 1048575) == 45) {
      Term _o_795[1];
      if (arm_94(e, _o_795, ((_a_13 >> 20) & 1), ((_a_13 >> 21) & 1), ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_795[0];
    } else if ((_a_13 & 524287) == 45) {
      Term _o_796[1];
      if (arm_95(e, _o_796, ((_a_13 >> 19) & 1), ((_a_13 >> 20) & 1), ((_a_13 >> 21) & 1), ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_796[0];
    } else if ((_a_13 & 262143) == 45) {
      Term _o_797[1];
      if (arm_96(e, _o_797, ((_a_13 >> 18) & 1), ((_a_13 >> 19) & 1), ((_a_13 >> 20) & 1), ((_a_13 >> 21) & 1), ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_797[0];
    } else if ((_a_13 & 131071) == 45) {
      Term _o_798[1];
      if (arm_97(e, _o_798, ((_a_13 >> 17) & 1), ((_a_13 >> 18) & 1), ((_a_13 >> 19) & 1), ((_a_13 >> 20) & 1), ((_a_13 >> 21) & 1), ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_798[0];
    } else if ((_a_13 & 65535) == 45) {
      Term _o_799[1];
      if (arm_98(e, _o_799, ((_a_13 >> 16) & 1), ((_a_13 >> 17) & 1), ((_a_13 >> 18) & 1), ((_a_13 >> 19) & 1), ((_a_13 >> 20) & 1), ((_a_13 >> 21) & 1), ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_799[0];
    } else if ((_a_13 & 32767) == 45) {
      Term _o_800[1];
      if (arm_99(e, _o_800, ((_a_13 >> 15) & 1), ((_a_13 >> 16) & 1), ((_a_13 >> 17) & 1), ((_a_13 >> 18) & 1), ((_a_13 >> 19) & 1), ((_a_13 >> 20) & 1), ((_a_13 >> 21) & 1), ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_800[0];
    } else if ((_a_13 & 16383) == 45) {
      Term _o_801[1];
      if (arm_100(e, _o_801, ((_a_13 >> 14) & 1), ((_a_13 >> 15) & 1), ((_a_13 >> 16) & 1), ((_a_13 >> 17) & 1), ((_a_13 >> 18) & 1), ((_a_13 >> 19) & 1), ((_a_13 >> 20) & 1), ((_a_13 >> 21) & 1), ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_801[0];
    } else if ((_a_13 & 8191) == 45) {
      Term _o_802[1];
      if (arm_101(e, _o_802, ((_a_13 >> 13) & 1), ((_a_13 >> 14) & 1), ((_a_13 >> 15) & 1), ((_a_13 >> 16) & 1), ((_a_13 >> 17) & 1), ((_a_13 >> 18) & 1), ((_a_13 >> 19) & 1), ((_a_13 >> 20) & 1), ((_a_13 >> 21) & 1), ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_802[0];
    } else if ((_a_13 & 4095) == 45) {
      Term _o_803[1];
      if (arm_102(e, _o_803, ((_a_13 >> 12) & 1), ((_a_13 >> 13) & 1), ((_a_13 >> 14) & 1), ((_a_13 >> 15) & 1), ((_a_13 >> 16) & 1), ((_a_13 >> 17) & 1), ((_a_13 >> 18) & 1), ((_a_13 >> 19) & 1), ((_a_13 >> 20) & 1), ((_a_13 >> 21) & 1), ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_803[0];
    } else if ((_a_13 & 2047) == 45) {
      Term _o_804[1];
      if (arm_103(e, _o_804, ((_a_13 >> 11) & 1), ((_a_13 >> 12) & 1), ((_a_13 >> 13) & 1), ((_a_13 >> 14) & 1), ((_a_13 >> 15) & 1), ((_a_13 >> 16) & 1), ((_a_13 >> 17) & 1), ((_a_13 >> 18) & 1), ((_a_13 >> 19) & 1), ((_a_13 >> 20) & 1), ((_a_13 >> 21) & 1), ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_804[0];
    } else if ((_a_13 & 1023) == 45) {
      Term _o_805[1];
      if (arm_104(e, _o_805, ((_a_13 >> 10) & 1), ((_a_13 >> 11) & 1), ((_a_13 >> 12) & 1), ((_a_13 >> 13) & 1), ((_a_13 >> 14) & 1), ((_a_13 >> 15) & 1), ((_a_13 >> 16) & 1), ((_a_13 >> 17) & 1), ((_a_13 >> 18) & 1), ((_a_13 >> 19) & 1), ((_a_13 >> 20) & 1), ((_a_13 >> 21) & 1), ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_805[0];
    } else if ((_a_13 & 511) == 45) {
      Term _o_806[1];
      if (arm_105(e, _o_806, ((_a_13 >> 9) & 1), ((_a_13 >> 10) & 1), ((_a_13 >> 11) & 1), ((_a_13 >> 12) & 1), ((_a_13 >> 13) & 1), ((_a_13 >> 14) & 1), ((_a_13 >> 15) & 1), ((_a_13 >> 16) & 1), ((_a_13 >> 17) & 1), ((_a_13 >> 18) & 1), ((_a_13 >> 19) & 1), ((_a_13 >> 20) & 1), ((_a_13 >> 21) & 1), ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_806[0];
    } else if ((_a_13 & 255) == 45) {
      Term _o_807[1];
      if (arm_106(e, _o_807, ((_a_13 >> 8) & 1), ((_a_13 >> 9) & 1), ((_a_13 >> 10) & 1), ((_a_13 >> 11) & 1), ((_a_13 >> 12) & 1), ((_a_13 >> 13) & 1), ((_a_13 >> 14) & 1), ((_a_13 >> 15) & 1), ((_a_13 >> 16) & 1), ((_a_13 >> 17) & 1), ((_a_13 >> 18) & 1), ((_a_13 >> 19) & 1), ((_a_13 >> 20) & 1), ((_a_13 >> 21) & 1), ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_807[0];
    } else if ((_a_13 & 127) == 45) {
      Term _o_808[1];
      if (arm_107(e, _o_808, ((_a_13 >> 7) & 1), ((_a_13 >> 8) & 1), ((_a_13 >> 9) & 1), ((_a_13 >> 10) & 1), ((_a_13 >> 11) & 1), ((_a_13 >> 12) & 1), ((_a_13 >> 13) & 1), ((_a_13 >> 14) & 1), ((_a_13 >> 15) & 1), ((_a_13 >> 16) & 1), ((_a_13 >> 17) & 1), ((_a_13 >> 18) & 1), ((_a_13 >> 19) & 1), ((_a_13 >> 20) & 1), ((_a_13 >> 21) & 1), ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_808[0];
    } else if ((_a_13 & 63) == 45) {
      Term _o_809[1];
      if (arm_108(e, _o_809, ((_a_13 >> 6) & 1), ((_a_13 >> 7) & 1), ((_a_13 >> 8) & 1), ((_a_13 >> 9) & 1), ((_a_13 >> 10) & 1), ((_a_13 >> 11) & 1), ((_a_13 >> 12) & 1), ((_a_13 >> 13) & 1), ((_a_13 >> 14) & 1), ((_a_13 >> 15) & 1), ((_a_13 >> 16) & 1), ((_a_13 >> 17) & 1), ((_a_13 >> 18) & 1), ((_a_13 >> 19) & 1), ((_a_13 >> 20) & 1), ((_a_13 >> 21) & 1), ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_809[0];
    } else if ((_a_13 & 31) == 13) {
      Term _o_810[1];
      if (arm_109(e, _o_810, ((_a_13 >> 5) & 1), ((_a_13 >> 6) & 1), ((_a_13 >> 7) & 1), ((_a_13 >> 8) & 1), ((_a_13 >> 9) & 1), ((_a_13 >> 10) & 1), ((_a_13 >> 11) & 1), ((_a_13 >> 12) & 1), ((_a_13 >> 13) & 1), ((_a_13 >> 14) & 1), ((_a_13 >> 15) & 1), ((_a_13 >> 16) & 1), ((_a_13 >> 17) & 1), ((_a_13 >> 18) & 1), ((_a_13 >> 19) & 1), ((_a_13 >> 20) & 1), ((_a_13 >> 21) & 1), ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_810[0];
    } else if ((_a_13 & 15) == 13) {
      Term _o_811[1];
      if (arm_110(e, _o_811, ((_a_13 >> 4) & 1), ((_a_13 >> 5) & 1), ((_a_13 >> 6) & 1), ((_a_13 >> 7) & 1), ((_a_13 >> 8) & 1), ((_a_13 >> 9) & 1), ((_a_13 >> 10) & 1), ((_a_13 >> 11) & 1), ((_a_13 >> 12) & 1), ((_a_13 >> 13) & 1), ((_a_13 >> 14) & 1), ((_a_13 >> 15) & 1), ((_a_13 >> 16) & 1), ((_a_13 >> 17) & 1), ((_a_13 >> 18) & 1), ((_a_13 >> 19) & 1), ((_a_13 >> 20) & 1), ((_a_13 >> 21) & 1), ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_811[0];
    } else if ((_a_13 & 7) == 5) {
      Term _o_812[1];
      if (arm_111(e, _o_812, ((_a_13 >> 3) & 1), ((_a_13 >> 4) & 1), ((_a_13 >> 5) & 1), ((_a_13 >> 6) & 1), ((_a_13 >> 7) & 1), ((_a_13 >> 8) & 1), ((_a_13 >> 9) & 1), ((_a_13 >> 10) & 1), ((_a_13 >> 11) & 1), ((_a_13 >> 12) & 1), ((_a_13 >> 13) & 1), ((_a_13 >> 14) & 1), ((_a_13 >> 15) & 1), ((_a_13 >> 16) & 1), ((_a_13 >> 17) & 1), ((_a_13 >> 18) & 1), ((_a_13 >> 19) & 1), ((_a_13 >> 20) & 1), ((_a_13 >> 21) & 1), ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_812[0];
    } else if ((_a_13 & 3) == 1) {
      Term _o_813[1];
      if (arm_112(e, _o_813, ((_a_13 >> 2) & 1), ((_a_13 >> 3) & 1), ((_a_13 >> 4) & 1), ((_a_13 >> 5) & 1), ((_a_13 >> 6) & 1), ((_a_13 >> 7) & 1), ((_a_13 >> 8) & 1), ((_a_13 >> 9) & 1), ((_a_13 >> 10) & 1), ((_a_13 >> 11) & 1), ((_a_13 >> 12) & 1), ((_a_13 >> 13) & 1), ((_a_13 >> 14) & 1), ((_a_13 >> 15) & 1), ((_a_13 >> 16) & 1), ((_a_13 >> 17) & 1), ((_a_13 >> 18) & 1), ((_a_13 >> 19) & 1), ((_a_13 >> 20) & 1), ((_a_13 >> 21) & 1), ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_813[0];
    } else if ((_a_13 & 1) == 1) {
      Term _o_814[1];
      if (arm_113(e, _o_814, ((_a_13 >> 1) & 1), ((_a_13 >> 2) & 1), ((_a_13 >> 3) & 1), ((_a_13 >> 4) & 1), ((_a_13 >> 5) & 1), ((_a_13 >> 6) & 1), ((_a_13 >> 7) & 1), ((_a_13 >> 8) & 1), ((_a_13 >> 9) & 1), ((_a_13 >> 10) & 1), ((_a_13 >> 11) & 1), ((_a_13 >> 12) & 1), ((_a_13 >> 13) & 1), ((_a_13 >> 14) & 1), ((_a_13 >> 15) & 1), ((_a_13 >> 16) & 1), ((_a_13 >> 17) & 1), ((_a_13 >> 18) & 1), ((_a_13 >> 19) & 1), ((_a_13 >> 20) & 1), ((_a_13 >> 21) & 1), ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_814[0];
    } else {
      Term _o_815[1];
      if (arm_114(e, _o_815, ((_a_13 >> 0) & 1), ((_a_13 >> 1) & 1), ((_a_13 >> 2) & 1), ((_a_13 >> 3) & 1), ((_a_13 >> 4) & 1), ((_a_13 >> 5) & 1), ((_a_13 >> 6) & 1), ((_a_13 >> 7) & 1), ((_a_13 >> 8) & 1), ((_a_13 >> 9) & 1), ((_a_13 >> 10) & 1), ((_a_13 >> 11) & 1), ((_a_13 >> 12) & 1), ((_a_13 >> 13) & 1), ((_a_13 >> 14) & 1), ((_a_13 >> 15) & 1), ((_a_13 >> 16) & 1), ((_a_13 >> 17) & 1), ((_a_13 >> 18) & 1), ((_a_13 >> 19) & 1), ((_a_13 >> 20) & 1), ((_a_13 >> 21) & 1), ((_a_13 >> 22) & 1), ((_a_13 >> 23) & 1), ((_a_13 >> 24) & 1), ((_a_13 >> 25) & 1), ((_a_13 >> 26) & 1), ((_a_13 >> 27) & 1), ((_a_13 >> 28) & 1), ((_a_13 >> 29) & 1), ((_a_13 >> 30) & 1), ((_a_13 >> 31) & 1), _a_14, _a_15) == 0) {
        return 0;
      }
      _v_5 = _o_815[0];
    }
  break;
  }
  o[0] = _v_5;
  return 1;
}

INLINE Term arm_4(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_4 = 0;
  u32 _a_10 = r0;
  Term _a_11 = r1;
  Term _a_12 = r2;
  WL_SPIN
    Term _o_816[1];
    if (arm_5(e, _o_816, _a_10, _a_11, _a_12) == 0) {
      return 0;
    }
    _v_4 = _o_816[0];
  break;
  }
  o[0] = _v_4;
  return 1;
}

INLINE Term arm_3(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_3 = 0;
  Term _a_8 = r0;
  Term _a_9 = r1;
  WL_SPIN
    if (term_aux(_a_8) == CID_SCON) {
      Term _fb_1[2];
      u64 _sp_2 = ctr_take(e, _a_8, 2, _fb_1);
      u32 _f_4 = _fb_1[0];
      Term _f_5 = _fb_1[1];
      Term _o_817[1];
      if (arm_4(e, _o_817, _f_4, _f_5, _a_9) == 0) {
        return 0;
      }
      _v_3 = _o_817[0];
      spare_free(e, cls_fit(2), _sp_2);
    } else {
      Term _o_818[1];
      if (arm_80(e, _o_818, _a_8, _a_9) == 0) {
        return 0;
      }
      _v_3 = _o_818[0];
    }
  break;
  }
  o[0] = _v_3;
  return 1;
}

INLINE Term arm_2(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_2 = 0;
  u32 _a_5 = r0;
  Term _a_6 = r1;
  Term _a_7 = r2;
  WL_SPIN
    if (_a_5 == 45) {
      Term _o_819[1];
      if (arm_3(e, _o_819, _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_819[0];
    } else if ((_a_5 & 2147483647) == 45) {
      Term _o_820[1];
      if (arm_83(e, _o_820, ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_820[0];
    } else if ((_a_5 & 1073741823) == 45) {
      Term _o_821[1];
      if (arm_84(e, _o_821, ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_821[0];
    } else if ((_a_5 & 536870911) == 45) {
      Term _o_822[1];
      if (arm_85(e, _o_822, ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_822[0];
    } else if ((_a_5 & 268435455) == 45) {
      Term _o_823[1];
      if (arm_86(e, _o_823, ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_823[0];
    } else if ((_a_5 & 134217727) == 45) {
      Term _o_824[1];
      if (arm_87(e, _o_824, ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_824[0];
    } else if ((_a_5 & 67108863) == 45) {
      Term _o_825[1];
      if (arm_88(e, _o_825, ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_825[0];
    } else if ((_a_5 & 33554431) == 45) {
      Term _o_826[1];
      if (arm_89(e, _o_826, ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_826[0];
    } else if ((_a_5 & 16777215) == 45) {
      Term _o_827[1];
      if (arm_90(e, _o_827, ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_827[0];
    } else if ((_a_5 & 8388607) == 45) {
      Term _o_828[1];
      if (arm_91(e, _o_828, ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_828[0];
    } else if ((_a_5 & 4194303) == 45) {
      Term _o_829[1];
      if (arm_92(e, _o_829, ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_829[0];
    } else if ((_a_5 & 2097151) == 45) {
      Term _o_830[1];
      if (arm_93(e, _o_830, ((_a_5 >> 21) & 1), ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_830[0];
    } else if ((_a_5 & 1048575) == 45) {
      Term _o_831[1];
      if (arm_94(e, _o_831, ((_a_5 >> 20) & 1), ((_a_5 >> 21) & 1), ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_831[0];
    } else if ((_a_5 & 524287) == 45) {
      Term _o_832[1];
      if (arm_95(e, _o_832, ((_a_5 >> 19) & 1), ((_a_5 >> 20) & 1), ((_a_5 >> 21) & 1), ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_832[0];
    } else if ((_a_5 & 262143) == 45) {
      Term _o_833[1];
      if (arm_96(e, _o_833, ((_a_5 >> 18) & 1), ((_a_5 >> 19) & 1), ((_a_5 >> 20) & 1), ((_a_5 >> 21) & 1), ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_833[0];
    } else if ((_a_5 & 131071) == 45) {
      Term _o_834[1];
      if (arm_97(e, _o_834, ((_a_5 >> 17) & 1), ((_a_5 >> 18) & 1), ((_a_5 >> 19) & 1), ((_a_5 >> 20) & 1), ((_a_5 >> 21) & 1), ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_834[0];
    } else if ((_a_5 & 65535) == 45) {
      Term _o_835[1];
      if (arm_98(e, _o_835, ((_a_5 >> 16) & 1), ((_a_5 >> 17) & 1), ((_a_5 >> 18) & 1), ((_a_5 >> 19) & 1), ((_a_5 >> 20) & 1), ((_a_5 >> 21) & 1), ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_835[0];
    } else if ((_a_5 & 32767) == 45) {
      Term _o_836[1];
      if (arm_99(e, _o_836, ((_a_5 >> 15) & 1), ((_a_5 >> 16) & 1), ((_a_5 >> 17) & 1), ((_a_5 >> 18) & 1), ((_a_5 >> 19) & 1), ((_a_5 >> 20) & 1), ((_a_5 >> 21) & 1), ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_836[0];
    } else if ((_a_5 & 16383) == 45) {
      Term _o_837[1];
      if (arm_100(e, _o_837, ((_a_5 >> 14) & 1), ((_a_5 >> 15) & 1), ((_a_5 >> 16) & 1), ((_a_5 >> 17) & 1), ((_a_5 >> 18) & 1), ((_a_5 >> 19) & 1), ((_a_5 >> 20) & 1), ((_a_5 >> 21) & 1), ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_837[0];
    } else if ((_a_5 & 8191) == 45) {
      Term _o_838[1];
      if (arm_101(e, _o_838, ((_a_5 >> 13) & 1), ((_a_5 >> 14) & 1), ((_a_5 >> 15) & 1), ((_a_5 >> 16) & 1), ((_a_5 >> 17) & 1), ((_a_5 >> 18) & 1), ((_a_5 >> 19) & 1), ((_a_5 >> 20) & 1), ((_a_5 >> 21) & 1), ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_838[0];
    } else if ((_a_5 & 4095) == 45) {
      Term _o_839[1];
      if (arm_102(e, _o_839, ((_a_5 >> 12) & 1), ((_a_5 >> 13) & 1), ((_a_5 >> 14) & 1), ((_a_5 >> 15) & 1), ((_a_5 >> 16) & 1), ((_a_5 >> 17) & 1), ((_a_5 >> 18) & 1), ((_a_5 >> 19) & 1), ((_a_5 >> 20) & 1), ((_a_5 >> 21) & 1), ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_839[0];
    } else if ((_a_5 & 2047) == 45) {
      Term _o_840[1];
      if (arm_103(e, _o_840, ((_a_5 >> 11) & 1), ((_a_5 >> 12) & 1), ((_a_5 >> 13) & 1), ((_a_5 >> 14) & 1), ((_a_5 >> 15) & 1), ((_a_5 >> 16) & 1), ((_a_5 >> 17) & 1), ((_a_5 >> 18) & 1), ((_a_5 >> 19) & 1), ((_a_5 >> 20) & 1), ((_a_5 >> 21) & 1), ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_840[0];
    } else if ((_a_5 & 1023) == 45) {
      Term _o_841[1];
      if (arm_104(e, _o_841, ((_a_5 >> 10) & 1), ((_a_5 >> 11) & 1), ((_a_5 >> 12) & 1), ((_a_5 >> 13) & 1), ((_a_5 >> 14) & 1), ((_a_5 >> 15) & 1), ((_a_5 >> 16) & 1), ((_a_5 >> 17) & 1), ((_a_5 >> 18) & 1), ((_a_5 >> 19) & 1), ((_a_5 >> 20) & 1), ((_a_5 >> 21) & 1), ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_841[0];
    } else if ((_a_5 & 511) == 45) {
      Term _o_842[1];
      if (arm_105(e, _o_842, ((_a_5 >> 9) & 1), ((_a_5 >> 10) & 1), ((_a_5 >> 11) & 1), ((_a_5 >> 12) & 1), ((_a_5 >> 13) & 1), ((_a_5 >> 14) & 1), ((_a_5 >> 15) & 1), ((_a_5 >> 16) & 1), ((_a_5 >> 17) & 1), ((_a_5 >> 18) & 1), ((_a_5 >> 19) & 1), ((_a_5 >> 20) & 1), ((_a_5 >> 21) & 1), ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_842[0];
    } else if ((_a_5 & 255) == 45) {
      Term _o_843[1];
      if (arm_106(e, _o_843, ((_a_5 >> 8) & 1), ((_a_5 >> 9) & 1), ((_a_5 >> 10) & 1), ((_a_5 >> 11) & 1), ((_a_5 >> 12) & 1), ((_a_5 >> 13) & 1), ((_a_5 >> 14) & 1), ((_a_5 >> 15) & 1), ((_a_5 >> 16) & 1), ((_a_5 >> 17) & 1), ((_a_5 >> 18) & 1), ((_a_5 >> 19) & 1), ((_a_5 >> 20) & 1), ((_a_5 >> 21) & 1), ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_843[0];
    } else if ((_a_5 & 127) == 45) {
      Term _o_844[1];
      if (arm_107(e, _o_844, ((_a_5 >> 7) & 1), ((_a_5 >> 8) & 1), ((_a_5 >> 9) & 1), ((_a_5 >> 10) & 1), ((_a_5 >> 11) & 1), ((_a_5 >> 12) & 1), ((_a_5 >> 13) & 1), ((_a_5 >> 14) & 1), ((_a_5 >> 15) & 1), ((_a_5 >> 16) & 1), ((_a_5 >> 17) & 1), ((_a_5 >> 18) & 1), ((_a_5 >> 19) & 1), ((_a_5 >> 20) & 1), ((_a_5 >> 21) & 1), ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_844[0];
    } else if ((_a_5 & 63) == 45) {
      Term _o_845[1];
      if (arm_108(e, _o_845, ((_a_5 >> 6) & 1), ((_a_5 >> 7) & 1), ((_a_5 >> 8) & 1), ((_a_5 >> 9) & 1), ((_a_5 >> 10) & 1), ((_a_5 >> 11) & 1), ((_a_5 >> 12) & 1), ((_a_5 >> 13) & 1), ((_a_5 >> 14) & 1), ((_a_5 >> 15) & 1), ((_a_5 >> 16) & 1), ((_a_5 >> 17) & 1), ((_a_5 >> 18) & 1), ((_a_5 >> 19) & 1), ((_a_5 >> 20) & 1), ((_a_5 >> 21) & 1), ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_845[0];
    } else if ((_a_5 & 31) == 13) {
      Term _o_846[1];
      if (arm_109(e, _o_846, ((_a_5 >> 5) & 1), ((_a_5 >> 6) & 1), ((_a_5 >> 7) & 1), ((_a_5 >> 8) & 1), ((_a_5 >> 9) & 1), ((_a_5 >> 10) & 1), ((_a_5 >> 11) & 1), ((_a_5 >> 12) & 1), ((_a_5 >> 13) & 1), ((_a_5 >> 14) & 1), ((_a_5 >> 15) & 1), ((_a_5 >> 16) & 1), ((_a_5 >> 17) & 1), ((_a_5 >> 18) & 1), ((_a_5 >> 19) & 1), ((_a_5 >> 20) & 1), ((_a_5 >> 21) & 1), ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_846[0];
    } else if ((_a_5 & 15) == 13) {
      Term _o_847[1];
      if (arm_110(e, _o_847, ((_a_5 >> 4) & 1), ((_a_5 >> 5) & 1), ((_a_5 >> 6) & 1), ((_a_5 >> 7) & 1), ((_a_5 >> 8) & 1), ((_a_5 >> 9) & 1), ((_a_5 >> 10) & 1), ((_a_5 >> 11) & 1), ((_a_5 >> 12) & 1), ((_a_5 >> 13) & 1), ((_a_5 >> 14) & 1), ((_a_5 >> 15) & 1), ((_a_5 >> 16) & 1), ((_a_5 >> 17) & 1), ((_a_5 >> 18) & 1), ((_a_5 >> 19) & 1), ((_a_5 >> 20) & 1), ((_a_5 >> 21) & 1), ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_847[0];
    } else if ((_a_5 & 7) == 5) {
      Term _o_848[1];
      if (arm_111(e, _o_848, ((_a_5 >> 3) & 1), ((_a_5 >> 4) & 1), ((_a_5 >> 5) & 1), ((_a_5 >> 6) & 1), ((_a_5 >> 7) & 1), ((_a_5 >> 8) & 1), ((_a_5 >> 9) & 1), ((_a_5 >> 10) & 1), ((_a_5 >> 11) & 1), ((_a_5 >> 12) & 1), ((_a_5 >> 13) & 1), ((_a_5 >> 14) & 1), ((_a_5 >> 15) & 1), ((_a_5 >> 16) & 1), ((_a_5 >> 17) & 1), ((_a_5 >> 18) & 1), ((_a_5 >> 19) & 1), ((_a_5 >> 20) & 1), ((_a_5 >> 21) & 1), ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_848[0];
    } else if ((_a_5 & 3) == 1) {
      Term _o_849[1];
      if (arm_112(e, _o_849, ((_a_5 >> 2) & 1), ((_a_5 >> 3) & 1), ((_a_5 >> 4) & 1), ((_a_5 >> 5) & 1), ((_a_5 >> 6) & 1), ((_a_5 >> 7) & 1), ((_a_5 >> 8) & 1), ((_a_5 >> 9) & 1), ((_a_5 >> 10) & 1), ((_a_5 >> 11) & 1), ((_a_5 >> 12) & 1), ((_a_5 >> 13) & 1), ((_a_5 >> 14) & 1), ((_a_5 >> 15) & 1), ((_a_5 >> 16) & 1), ((_a_5 >> 17) & 1), ((_a_5 >> 18) & 1), ((_a_5 >> 19) & 1), ((_a_5 >> 20) & 1), ((_a_5 >> 21) & 1), ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_849[0];
    } else if ((_a_5 & 1) == 1) {
      Term _o_850[1];
      if (arm_113(e, _o_850, ((_a_5 >> 1) & 1), ((_a_5 >> 2) & 1), ((_a_5 >> 3) & 1), ((_a_5 >> 4) & 1), ((_a_5 >> 5) & 1), ((_a_5 >> 6) & 1), ((_a_5 >> 7) & 1), ((_a_5 >> 8) & 1), ((_a_5 >> 9) & 1), ((_a_5 >> 10) & 1), ((_a_5 >> 11) & 1), ((_a_5 >> 12) & 1), ((_a_5 >> 13) & 1), ((_a_5 >> 14) & 1), ((_a_5 >> 15) & 1), ((_a_5 >> 16) & 1), ((_a_5 >> 17) & 1), ((_a_5 >> 18) & 1), ((_a_5 >> 19) & 1), ((_a_5 >> 20) & 1), ((_a_5 >> 21) & 1), ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_850[0];
    } else {
      Term _o_851[1];
      if (arm_114(e, _o_851, ((_a_5 >> 0) & 1), ((_a_5 >> 1) & 1), ((_a_5 >> 2) & 1), ((_a_5 >> 3) & 1), ((_a_5 >> 4) & 1), ((_a_5 >> 5) & 1), ((_a_5 >> 6) & 1), ((_a_5 >> 7) & 1), ((_a_5 >> 8) & 1), ((_a_5 >> 9) & 1), ((_a_5 >> 10) & 1), ((_a_5 >> 11) & 1), ((_a_5 >> 12) & 1), ((_a_5 >> 13) & 1), ((_a_5 >> 14) & 1), ((_a_5 >> 15) & 1), ((_a_5 >> 16) & 1), ((_a_5 >> 17) & 1), ((_a_5 >> 18) & 1), ((_a_5 >> 19) & 1), ((_a_5 >> 20) & 1), ((_a_5 >> 21) & 1), ((_a_5 >> 22) & 1), ((_a_5 >> 23) & 1), ((_a_5 >> 24) & 1), ((_a_5 >> 25) & 1), ((_a_5 >> 26) & 1), ((_a_5 >> 27) & 1), ((_a_5 >> 28) & 1), ((_a_5 >> 29) & 1), ((_a_5 >> 30) & 1), ((_a_5 >> 31) & 1), _a_6, _a_7) == 0) {
        return 0;
      }
      _v_2 = _o_851[0];
    }
  break;
  }
  o[0] = _v_2;
  return 1;
}

INLINE Term arm_1(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_1 = 0;
  u32 _a_2 = r0;
  Term _a_3 = r1;
  Term _a_4 = r2;
  WL_SPIN
    Term _o_852[1];
    if (arm_2(e, _o_852, _a_2, _a_3, _a_4) == 0) {
      return 0;
    }
    _v_1 = _o_852[0];
  break;
  }
  o[0] = _v_1;
  return 1;
}

INLINE Term arm_0(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_0 = 0;
  Term _a_0 = r0;
  Term _a_1 = r1;
  WL_SPIN
    if (term_aux(_a_0) == CID_SCON) {
      Term _fb_0[2];
      u64 _sp_1 = ctr_take(e, _a_0, 2, _fb_0);
      u32 _f_2 = _fb_0[0];
      Term _f_3 = _fb_0[1];
      Term _o_853[1];
      if (arm_1(e, _o_853, _f_2, _f_3, _a_1) == 0) {
        return 0;
      }
      _v_0 = _o_853[0];
      spare_free(e, cls_fit(2), _sp_1);
    } else {
      Term _o_854[1];
      if (arm_80(e, _o_854, _a_0, _a_1) == 0) {
        return 0;
      }
      _v_0 = _o_854[0];
    }
  break;
  }
  o[0] = _v_0;
  return 1;
}

INLINE Term spin_1(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_1 = 0;
  Term _args_0 = r0;
  WL_SPIN
    if (term_aux(_args_0) == CID_CON) {
      u64 _sp_0 = term_loc(_args_0);
      Term _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      Term _o_0[1];
      if (arm_0(e, _o_0, _f_0, _f_1) == 0) {
        return 0;
      }
      _v_1 = _o_0[0];
      heap_free(e, cls_fit(2), _sp_0);
    } else {
      Term _o_1[1];
      if (arm_79(e, _o_1, _args_0) == 0) {
        return 0;
      }
      _v_1 = _o_1[0];
    }
  break;
  }
  o[0] = _v_1;
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
  WL_CASE(FID_ARM_79_C82)
  {
    Term _x_0 = r0;
    WL_OPEN
    Term _v_80 = 0;
    Term _o_2[1];
    if (spin_0(e, _o_2, 2ull, term_ctr(CID_SCON, STAT_OFF + 20), _x_0) == 0) {
      return 0;
    }
    _v_80 = _o_2[0];
    r0 = _v_80;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN)
  {
    WL_OPEN
    r0 = term_clo(FID_MAIN_C122, 0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C122)
  {
    Term _x_0 = r0;
    WL_OPEN
    Term _m_0 = term_clo(FID_IO_ARGS, 0);
    Term _f_2 = term_clo(FID_MAIN_C123, 0);
    u64 _nd_0 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_0 + 0] = _f_2;
    e.mem[_nd_0 + 1] = _x_0;
    if (!DEVICE && !seq && fid_nofk(FID_CLO_APPLY)) {
      u64 _t_3 = task_node(e, FID_CLO_APPLY, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _m_0;
      e.mem[_t_3 + 1] = term_clo(FID_MAIN_C124, _nd_0);
      return term_tsk(FID_CLO_APPLY, _t_3);
    }
    r0 = _m_0;
    r1 = term_clo(FID_MAIN_C124, _nd_0);
    WL_JMP(FID_CLO_APPLY);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C123)
  {
    Term _x_1 = r0;
    WL_OPEN
    Term _v_0 = 0;
    Term _o_2[1];
    if (spin_1(e, _o_2, _x_1) == 0) {
      return 0;
    }
    _v_0 = _o_2[0];
    r0 = _v_0;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C124)
  {
    Term _f_3 = r0;
    Term _x_2 = r1;
    Term _x_3 = r2;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _x_2;
      STK(1) = FID_MAIN_K125;
      WL_PUSHN(2);
    } else {
      u64 _t_0 = task_node(e, FID_MAIN_K125, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _x_2;
      WL_CONT = term_tsk(FID_MAIN_K125, _t_0);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID_CLO_APPLY)) {
      u64 _t_1 = task_node(e, FID_CLO_APPLY, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _f_3;
      e.mem[_t_1 + 1] = _x_3;
      return term_tsk(FID_CLO_APPLY, _t_1);
    }
    r0 = _f_3;
    r1 = _x_3;
    WL_JMP(FID_CLO_APPLY);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K125)
  {
    WL_POPN(1);
    Term _x_4 = STK(0);
    Term _h_0 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_CLO_APPLY)) {
      u64 _t_2 = task_node(e, FID_CLO_APPLY, WL_CONT, WL_IDX, 0);
      e.mem[_t_2 + 0] = _h_0;
      e.mem[_t_2 + 1] = _x_4;
      return term_tsk(FID_CLO_APPLY, _t_2);
    }
    r0 = _h_0;
    r1 = _x_4;
    WL_JMP(FID_CLO_APPLY);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_ARGS)
  {
    Term _k_0 = r0;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_1 + 0] = _k_0;
    r0 = term_ctr(CID_IO_ARGS, _nd_1);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_WRITE)
  {
    Term _text_0 = r0;
    Term _k_1 = r1;
    WL_OPEN
    u64 _nd_2 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_2 + 0] = _text_0;
    e.mem[_nd_2 + 1] = _k_1;
    r0 = term_ctr(CID_IO_WRITE, _nd_2);
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

// IO
// ==

Term io_args_run(Env e, Term* f, IoWork* w) {
  Term xs = term_pak(CID_NIL, 0);
  for (int i = io_argc; i > 0; i -= 1) {
    const char* a = io_argv[i - 1];
    xs = io_node(e, CID_CON, io_str(e, a, strlen(a)), xs);
  }
  return xs;
}

static void __attribute__((constructor)) io_args_use(void) {
  io_eff(CID_IO_ARGS, io_args_run, 0);
}
// IO
// ==

void io_write(const char* data, uint64_t len) {
  io_out(stdout, data, len);
}

Term io_write_run(Env e, Term* f, IoWork* w) {
  uint64_t n = 0;
  char* text = io_cstr(e, f[0], &n);
  io_write(text, n);
  free(text);
  return term_pak(CID_UNIT, 0);
}

static void __attribute__((constructor)) io_write_use(void) {
  io_eff(CID_IO_WRITE, io_write_run, 0);
}


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
