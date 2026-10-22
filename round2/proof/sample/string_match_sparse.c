
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
#define CID_IO_PRINT 17
#define FID_U32_SHOW_GO 0
#define FID_U32_SHOW 1
#define FID_SHOW_ALL 2
#define FID_SHOW_ALL_K113 3
#define FID_SHOW_ALL_K114 4
#define FID_SHOW_ALL_K115 5
#define FID_STRING_APPEND 6
#define FID_STRING_APPEND_K117 7
#define FID_MAIN 8
#define FID_MAIN_K119 9
#define FID_MAIN_K120 10
#define FID_MAIN_K121 11
#define FID_IO_PRINT 12
#define FID_IO_EMIT 13
#define FID_CLO_APPLY 14
#define FID_EXIT 15
#define FID_ENTER 16
CONSTV u8 FID_ARITY_T[] = { 3, 1, 1, 2, 2, 2, 2, 2, 0, 1, 2, 1, 2, 1, 2 };
CONSTV u8 FID_FLAG_T[] = { 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2 };
CONSTV u8 FID_RESW_T[] = { 0, 0, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 0, 0 };
CONSTV u8 CID_ARITY_T[] = { 2, 0, 2, 2, 1, 2, 1, 1, 0, 1, 0, 0, 0, 0, 2, 1, 0, 2 };
CONSTV u8 CID_HOT_T[] = { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };
#define STAT_LEN 146

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

#define WL_TABLE WL_X(FID_U32_SHOW_GO) WL_X(FID_U32_SHOW) WL_X(FID_SHOW_ALL) WL_X(FID_SHOW_ALL_K113) WL_X(FID_SHOW_ALL_K114) WL_X(FID_SHOW_ALL_K115) WL_X(FID_STRING_APPEND) WL_X(FID_STRING_APPEND_K117) WL_X(FID_MAIN) WL_X(FID_MAIN_K119) WL_X(FID_MAIN_K120) WL_X(FID_MAIN_K121) WL_X(FID_IO_PRINT) WL_X(FID_IO_EMIT) WL_X(FID_CLO_APPLY) WL_X(FID_EXIT)
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

CONSTV u64 STAT_IMG[] = { 48ull, term_pak(CID_SNIL, 0), 32ull, term_pak(CID_SNIL, 0), 100ull, term_pak(CID_SNIL, 0), 101ull, term_ctr(CID_SCON, STAT_OFF + 4), 116ull, term_ctr(CID_SCON, STAT_OFF + 6), 101ull, term_ctr(CID_SCON, STAT_OFF + 8), 108ull, term_ctr(CID_SCON, STAT_OFF + 10), 112ull, term_ctr(CID_SCON, STAT_OFF + 12), 109ull, term_ctr(CID_SCON, STAT_OFF + 14), 111ull, term_ctr(CID_SCON, STAT_OFF + 16), 99ull, term_ctr(CID_SCON, STAT_OFF + 18), 46ull, term_ctr(CID_SCON, STAT_OFF + 20), 101ull, term_ctr(CID_SCON, STAT_OFF + 22), 115ull, term_ctr(CID_SCON, STAT_OFF + 24), 110ull, term_ctr(CID_SCON, STAT_OFF + 26), 111ull, term_ctr(CID_SCON, STAT_OFF + 28), 112ull, term_ctr(CID_SCON, STAT_OFF + 30), 115ull, term_ctr(CID_SCON, STAT_OFF + 32), 101ull, term_ctr(CID_SCON, STAT_OFF + 34), 114ull, term_ctr(CID_SCON, STAT_OFF + 36), 108ull, term_ctr(CID_SCON, STAT_OFF + 6), 105ull, term_ctr(CID_SCON, STAT_OFF + 40), 97ull, term_ctr(CID_SCON, STAT_OFF + 42), 102ull, term_ctr(CID_SCON, STAT_OFF + 44), 46ull, term_ctr(CID_SCON, STAT_OFF + 46), 101ull, term_ctr(CID_SCON, STAT_OFF + 48), 115ull, term_ctr(CID_SCON, STAT_OFF + 50), 110ull, term_ctr(CID_SCON, STAT_OFF + 52), 111ull, term_ctr(CID_SCON, STAT_OFF + 54), 112ull, term_ctr(CID_SCON, STAT_OFF + 56), 115ull, term_ctr(CID_SCON, STAT_OFF + 58), 101ull, term_ctr(CID_SCON, STAT_OFF + 60), 114ull, term_ctr(CID_SCON, STAT_OFF + 62), 101ull, term_pak(CID_SNIL, 0), 116ull, term_ctr(CID_SCON, STAT_OFF + 66), 101ull, term_ctr(CID_SCON, STAT_OFF + 68), 108ull, term_ctr(CID_SCON, STAT_OFF + 70), 112ull, term_ctr(CID_SCON, STAT_OFF + 72), 109ull, term_ctr(CID_SCON, STAT_OFF + 74), 111ull, term_ctr(CID_SCON, STAT_OFF + 76), 99ull, term_ctr(CID_SCON, STAT_OFF + 78), 110ull, term_ctr(CID_SCON, STAT_OFF + 80), 105ull, term_ctr(CID_SCON, STAT_OFF + 82), 46ull, term_ctr(CID_SCON, STAT_OFF + 84), 101ull, term_ctr(CID_SCON, STAT_OFF + 86), 115ull, term_ctr(CID_SCON, STAT_OFF + 88), 110ull, term_ctr(CID_SCON, STAT_OFF + 90), 111ull, term_ctr(CID_SCON, STAT_OFF + 92), 112ull, term_ctr(CID_SCON, STAT_OFF + 94), 115ull, term_ctr(CID_SCON, STAT_OFF + 96), 101ull, term_ctr(CID_SCON, STAT_OFF + 98), 114ull, term_ctr(CID_SCON, STAT_OFF + 100), 46ull, term_ctr(CID_SCON, STAT_OFF + 80), 101ull, term_ctr(CID_SCON, STAT_OFF + 104), 115ull, term_ctr(CID_SCON, STAT_OFF + 106), 110ull, term_ctr(CID_SCON, STAT_OFF + 108), 111ull, term_ctr(CID_SCON, STAT_OFF + 110), 112ull, term_ctr(CID_SCON, STAT_OFF + 112), 115ull, term_ctr(CID_SCON, STAT_OFF + 114), 101ull, term_ctr(CID_SCON, STAT_OFF + 116), 114ull, term_ctr(CID_SCON, STAT_OFF + 118), 115ull, term_ctr(CID_SCON, STAT_OFF + 66), 110ull, term_ctr(CID_SCON, STAT_OFF + 122), 111ull, term_ctr(CID_SCON, STAT_OFF + 124), 112ull, term_ctr(CID_SCON, STAT_OFF + 126), 115ull, term_ctr(CID_SCON, STAT_OFF + 128), 101ull, term_ctr(CID_SCON, STAT_OFF + 130), 114ull, term_ctr(CID_SCON, STAT_OFF + 132), term_ctr(CID_SCON, STAT_OFF + 134), term_pak(CID_NIL, 0), term_ctr(CID_SCON, STAT_OFF + 120), term_ctr(CID_CON, STAT_OFF + 136), term_ctr(CID_SCON, STAT_OFF + 102), term_ctr(CID_CON, STAT_OFF + 138), term_ctr(CID_SCON, STAT_OFF + 64), term_ctr(CID_CON, STAT_OFF + 140), term_ctr(CID_SCON, STAT_OFF + 38), term_ctr(CID_CON, STAT_OFF + 142) };

INLINE Term arm_0(Env e, THR Term* o) {
  u32 wpoll = 0;
  Term _v_0 = 0;
  WL_SPIN
    _v_0 = term_ctr(CID_SCON, STAT_OFF + 0);
  break;
  }
  o[0] = _v_0;
  return 1;
}

INLINE Term arm_55(Env e, THR Term* o) {
  u32 wpoll = 0;
  u32 _v_54 = 0;
  WL_SPIN
    _v_54 = 1ull;
  break;
  }
  o[0] = _v_54;
  return 1;
}

INLINE Term arm_56(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_55 = 0;
  Term _a_90 = r0;
  WL_SPIN
    term_sink(e, _a_90);
    _v_55 = 0ull;
  break;
  }
  o[0] = _v_55;
  return 1;
}

INLINE Term arm_54(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_53 = 0;
  Term _a_89 = r0;
  WL_SPIN
    if (term_aux(_a_89) == CID_SNIL) {
      Term _o_0[1];
      if (arm_55(e, _o_0) == 0) {
        return 0;
      }
      _v_53 = _o_0[0];
    } else {
      Term _o_1[1];
      if (arm_56(e, _o_1, _a_89) == 0) {
        return 0;
      }
      _v_53 = _o_1[0];
    }
  break;
  }
  o[0] = _v_53;
  return 1;
}

INLINE Term arm_57(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, u32 r13, u32 r14, u32 r15, u32 r16, u32 r17, u32 r18, u32 r19, u32 r20, u32 r21, u32 r22, u32 r23, u32 r24, u32 r25, u32 r26, u32 r27, u32 r28, u32 r29, u32 r30, u32 r31, Term r32) {
  u32 wpoll = 0;
  u32 _v_56 = 0;
  u32 _a_91 = r0;
  u32 _a_92 = r1;
  u32 _a_93 = r2;
  u32 _a_94 = r3;
  u32 _a_95 = r4;
  u32 _a_96 = r5;
  u32 _a_97 = r6;
  u32 _a_98 = r7;
  u32 _a_99 = r8;
  u32 _a_100 = r9;
  u32 _a_101 = r10;
  u32 _a_102 = r11;
  u32 _a_103 = r12;
  u32 _a_104 = r13;
  u32 _a_105 = r14;
  u32 _a_106 = r15;
  u32 _a_107 = r16;
  u32 _a_108 = r17;
  u32 _a_109 = r18;
  u32 _a_110 = r19;
  u32 _a_111 = r20;
  u32 _a_112 = r21;
  u32 _a_113 = r22;
  u32 _a_114 = r23;
  u32 _a_115 = r24;
  u32 _a_116 = r25;
  u32 _a_117 = r26;
  u32 _a_118 = r27;
  u32 _a_119 = r28;
  u32 _a_120 = r29;
  u32 _a_121 = r30;
  u32 _a_122 = r31;
  Term _a_123 = r32;
  WL_SPIN
    term_sink(e, _a_123);
    _v_56 = 0ull;
  break;
  }
  o[0] = _v_56;
  return 1;
}

INLINE Term arm_53(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_52 = 0;
  u32 _a_87 = r0;
  Term _a_88 = r1;
  WL_SPIN
    if (_a_87 == 100) {
      Term _o_2[1];
      if (arm_54(e, _o_2, _a_88) == 0) {
        return 0;
      }
      _v_52 = _o_2[0];
    } else {
      Term _o_3[1];
      if (arm_57(e, _o_3, ((_a_87 >> 0) & 1), ((_a_87 >> 1) & 1), ((_a_87 >> 2) & 1), ((_a_87 >> 3) & 1), ((_a_87 >> 4) & 1), ((_a_87 >> 5) & 1), ((_a_87 >> 6) & 1), ((_a_87 >> 7) & 1), ((_a_87 >> 8) & 1), ((_a_87 >> 9) & 1), ((_a_87 >> 10) & 1), ((_a_87 >> 11) & 1), ((_a_87 >> 12) & 1), ((_a_87 >> 13) & 1), ((_a_87 >> 14) & 1), ((_a_87 >> 15) & 1), ((_a_87 >> 16) & 1), ((_a_87 >> 17) & 1), ((_a_87 >> 18) & 1), ((_a_87 >> 19) & 1), ((_a_87 >> 20) & 1), ((_a_87 >> 21) & 1), ((_a_87 >> 22) & 1), ((_a_87 >> 23) & 1), ((_a_87 >> 24) & 1), ((_a_87 >> 25) & 1), ((_a_87 >> 26) & 1), ((_a_87 >> 27) & 1), ((_a_87 >> 28) & 1), ((_a_87 >> 29) & 1), ((_a_87 >> 30) & 1), ((_a_87 >> 31) & 1), _a_88) == 0) {
        return 0;
      }
      _v_52 = _o_3[0];
    }
  break;
  }
  o[0] = _v_52;
  return 1;
}

INLINE Term arm_52(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_51 = 0;
  u32 _a_85 = r0;
  Term _a_86 = r1;
  WL_SPIN
    Term _o_4[1];
    if (arm_53(e, _o_4, _a_85, _a_86) == 0) {
      return 0;
    }
    _v_51 = _o_4[0];
  break;
  }
  o[0] = _v_51;
  return 1;
}

INLINE Term arm_51(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_50 = 0;
  Term _a_84 = r0;
  WL_SPIN
    if (term_aux(_a_84) == CID_SCON) {
      Term _fb_17[2];
      u64 _sp_17 = ctr_take(e, _a_84, 2, _fb_17);
      u32 _f_34 = _fb_17[0];
      Term _f_35 = _fb_17[1];
      Term _o_5[1];
      if (arm_52(e, _o_5, _f_34, _f_35) == 0) {
        return 0;
      }
      _v_50 = _o_5[0];
      spare_free(e, cls_fit(2), _sp_17);
    } else {
      Term _o_6[1];
      if (arm_56(e, _o_6, _a_84) == 0) {
        return 0;
      }
      _v_50 = _o_6[0];
    }
  break;
  }
  o[0] = _v_50;
  return 1;
}

INLINE Term arm_50(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_49 = 0;
  u32 _a_82 = r0;
  Term _a_83 = r1;
  WL_SPIN
    if (_a_82 == 101) {
      Term _o_7[1];
      if (arm_51(e, _o_7, _a_83) == 0) {
        return 0;
      }
      _v_49 = _o_7[0];
    } else {
      Term _o_8[1];
      if (arm_57(e, _o_8, ((_a_82 >> 0) & 1), ((_a_82 >> 1) & 1), ((_a_82 >> 2) & 1), ((_a_82 >> 3) & 1), ((_a_82 >> 4) & 1), ((_a_82 >> 5) & 1), ((_a_82 >> 6) & 1), ((_a_82 >> 7) & 1), ((_a_82 >> 8) & 1), ((_a_82 >> 9) & 1), ((_a_82 >> 10) & 1), ((_a_82 >> 11) & 1), ((_a_82 >> 12) & 1), ((_a_82 >> 13) & 1), ((_a_82 >> 14) & 1), ((_a_82 >> 15) & 1), ((_a_82 >> 16) & 1), ((_a_82 >> 17) & 1), ((_a_82 >> 18) & 1), ((_a_82 >> 19) & 1), ((_a_82 >> 20) & 1), ((_a_82 >> 21) & 1), ((_a_82 >> 22) & 1), ((_a_82 >> 23) & 1), ((_a_82 >> 24) & 1), ((_a_82 >> 25) & 1), ((_a_82 >> 26) & 1), ((_a_82 >> 27) & 1), ((_a_82 >> 28) & 1), ((_a_82 >> 29) & 1), ((_a_82 >> 30) & 1), ((_a_82 >> 31) & 1), _a_83) == 0) {
        return 0;
      }
      _v_49 = _o_8[0];
    }
  break;
  }
  o[0] = _v_49;
  return 1;
}

INLINE Term arm_49(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_48 = 0;
  u32 _a_80 = r0;
  Term _a_81 = r1;
  WL_SPIN
    Term _o_9[1];
    if (arm_50(e, _o_9, _a_80, _a_81) == 0) {
      return 0;
    }
    _v_48 = _o_9[0];
  break;
  }
  o[0] = _v_48;
  return 1;
}

INLINE Term arm_48(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_47 = 0;
  Term _a_79 = r0;
  WL_SPIN
    if (term_aux(_a_79) == CID_SCON) {
      Term _fb_16[2];
      u64 _sp_16 = ctr_take(e, _a_79, 2, _fb_16);
      u32 _f_32 = _fb_16[0];
      Term _f_33 = _fb_16[1];
      Term _o_10[1];
      if (arm_49(e, _o_10, _f_32, _f_33) == 0) {
        return 0;
      }
      _v_47 = _o_10[0];
      spare_free(e, cls_fit(2), _sp_16);
    } else {
      Term _o_11[1];
      if (arm_56(e, _o_11, _a_79) == 0) {
        return 0;
      }
      _v_47 = _o_11[0];
    }
  break;
  }
  o[0] = _v_47;
  return 1;
}

INLINE Term arm_47(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_46 = 0;
  u32 _a_77 = r0;
  Term _a_78 = r1;
  WL_SPIN
    if (_a_77 == 116) {
      Term _o_12[1];
      if (arm_48(e, _o_12, _a_78) == 0) {
        return 0;
      }
      _v_46 = _o_12[0];
    } else {
      Term _o_13[1];
      if (arm_57(e, _o_13, ((_a_77 >> 0) & 1), ((_a_77 >> 1) & 1), ((_a_77 >> 2) & 1), ((_a_77 >> 3) & 1), ((_a_77 >> 4) & 1), ((_a_77 >> 5) & 1), ((_a_77 >> 6) & 1), ((_a_77 >> 7) & 1), ((_a_77 >> 8) & 1), ((_a_77 >> 9) & 1), ((_a_77 >> 10) & 1), ((_a_77 >> 11) & 1), ((_a_77 >> 12) & 1), ((_a_77 >> 13) & 1), ((_a_77 >> 14) & 1), ((_a_77 >> 15) & 1), ((_a_77 >> 16) & 1), ((_a_77 >> 17) & 1), ((_a_77 >> 18) & 1), ((_a_77 >> 19) & 1), ((_a_77 >> 20) & 1), ((_a_77 >> 21) & 1), ((_a_77 >> 22) & 1), ((_a_77 >> 23) & 1), ((_a_77 >> 24) & 1), ((_a_77 >> 25) & 1), ((_a_77 >> 26) & 1), ((_a_77 >> 27) & 1), ((_a_77 >> 28) & 1), ((_a_77 >> 29) & 1), ((_a_77 >> 30) & 1), ((_a_77 >> 31) & 1), _a_78) == 0) {
        return 0;
      }
      _v_46 = _o_13[0];
    }
  break;
  }
  o[0] = _v_46;
  return 1;
}

INLINE Term arm_46(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_45 = 0;
  u32 _a_75 = r0;
  Term _a_76 = r1;
  WL_SPIN
    Term _o_14[1];
    if (arm_47(e, _o_14, _a_75, _a_76) == 0) {
      return 0;
    }
    _v_45 = _o_14[0];
  break;
  }
  o[0] = _v_45;
  return 1;
}

INLINE Term arm_45(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_44 = 0;
  Term _a_74 = r0;
  WL_SPIN
    if (term_aux(_a_74) == CID_SCON) {
      Term _fb_15[2];
      u64 _sp_15 = ctr_take(e, _a_74, 2, _fb_15);
      u32 _f_30 = _fb_15[0];
      Term _f_31 = _fb_15[1];
      Term _o_15[1];
      if (arm_46(e, _o_15, _f_30, _f_31) == 0) {
        return 0;
      }
      _v_44 = _o_15[0];
      spare_free(e, cls_fit(2), _sp_15);
    } else {
      Term _o_16[1];
      if (arm_56(e, _o_16, _a_74) == 0) {
        return 0;
      }
      _v_44 = _o_16[0];
    }
  break;
  }
  o[0] = _v_44;
  return 1;
}

INLINE Term arm_44(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_43 = 0;
  u32 _a_72 = r0;
  Term _a_73 = r1;
  WL_SPIN
    if (_a_72 == 101) {
      Term _o_17[1];
      if (arm_45(e, _o_17, _a_73) == 0) {
        return 0;
      }
      _v_43 = _o_17[0];
    } else {
      Term _o_18[1];
      if (arm_57(e, _o_18, ((_a_72 >> 0) & 1), ((_a_72 >> 1) & 1), ((_a_72 >> 2) & 1), ((_a_72 >> 3) & 1), ((_a_72 >> 4) & 1), ((_a_72 >> 5) & 1), ((_a_72 >> 6) & 1), ((_a_72 >> 7) & 1), ((_a_72 >> 8) & 1), ((_a_72 >> 9) & 1), ((_a_72 >> 10) & 1), ((_a_72 >> 11) & 1), ((_a_72 >> 12) & 1), ((_a_72 >> 13) & 1), ((_a_72 >> 14) & 1), ((_a_72 >> 15) & 1), ((_a_72 >> 16) & 1), ((_a_72 >> 17) & 1), ((_a_72 >> 18) & 1), ((_a_72 >> 19) & 1), ((_a_72 >> 20) & 1), ((_a_72 >> 21) & 1), ((_a_72 >> 22) & 1), ((_a_72 >> 23) & 1), ((_a_72 >> 24) & 1), ((_a_72 >> 25) & 1), ((_a_72 >> 26) & 1), ((_a_72 >> 27) & 1), ((_a_72 >> 28) & 1), ((_a_72 >> 29) & 1), ((_a_72 >> 30) & 1), ((_a_72 >> 31) & 1), _a_73) == 0) {
        return 0;
      }
      _v_43 = _o_18[0];
    }
  break;
  }
  o[0] = _v_43;
  return 1;
}

INLINE Term arm_43(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_42 = 0;
  u32 _a_70 = r0;
  Term _a_71 = r1;
  WL_SPIN
    Term _o_19[1];
    if (arm_44(e, _o_19, _a_70, _a_71) == 0) {
      return 0;
    }
    _v_42 = _o_19[0];
  break;
  }
  o[0] = _v_42;
  return 1;
}

INLINE Term arm_42(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_41 = 0;
  Term _a_69 = r0;
  WL_SPIN
    if (term_aux(_a_69) == CID_SCON) {
      Term _fb_14[2];
      u64 _sp_14 = ctr_take(e, _a_69, 2, _fb_14);
      u32 _f_28 = _fb_14[0];
      Term _f_29 = _fb_14[1];
      Term _o_20[1];
      if (arm_43(e, _o_20, _f_28, _f_29) == 0) {
        return 0;
      }
      _v_41 = _o_20[0];
      spare_free(e, cls_fit(2), _sp_14);
    } else {
      Term _o_21[1];
      if (arm_56(e, _o_21, _a_69) == 0) {
        return 0;
      }
      _v_41 = _o_21[0];
    }
  break;
  }
  o[0] = _v_41;
  return 1;
}

INLINE Term arm_41(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_40 = 0;
  u32 _a_67 = r0;
  Term _a_68 = r1;
  WL_SPIN
    if (_a_67 == 108) {
      Term _o_22[1];
      if (arm_42(e, _o_22, _a_68) == 0) {
        return 0;
      }
      _v_40 = _o_22[0];
    } else {
      Term _o_23[1];
      if (arm_57(e, _o_23, ((_a_67 >> 0) & 1), ((_a_67 >> 1) & 1), ((_a_67 >> 2) & 1), ((_a_67 >> 3) & 1), ((_a_67 >> 4) & 1), ((_a_67 >> 5) & 1), ((_a_67 >> 6) & 1), ((_a_67 >> 7) & 1), ((_a_67 >> 8) & 1), ((_a_67 >> 9) & 1), ((_a_67 >> 10) & 1), ((_a_67 >> 11) & 1), ((_a_67 >> 12) & 1), ((_a_67 >> 13) & 1), ((_a_67 >> 14) & 1), ((_a_67 >> 15) & 1), ((_a_67 >> 16) & 1), ((_a_67 >> 17) & 1), ((_a_67 >> 18) & 1), ((_a_67 >> 19) & 1), ((_a_67 >> 20) & 1), ((_a_67 >> 21) & 1), ((_a_67 >> 22) & 1), ((_a_67 >> 23) & 1), ((_a_67 >> 24) & 1), ((_a_67 >> 25) & 1), ((_a_67 >> 26) & 1), ((_a_67 >> 27) & 1), ((_a_67 >> 28) & 1), ((_a_67 >> 29) & 1), ((_a_67 >> 30) & 1), ((_a_67 >> 31) & 1), _a_68) == 0) {
        return 0;
      }
      _v_40 = _o_23[0];
    }
  break;
  }
  o[0] = _v_40;
  return 1;
}

INLINE Term arm_40(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_39 = 0;
  u32 _a_65 = r0;
  Term _a_66 = r1;
  WL_SPIN
    Term _o_24[1];
    if (arm_41(e, _o_24, _a_65, _a_66) == 0) {
      return 0;
    }
    _v_39 = _o_24[0];
  break;
  }
  o[0] = _v_39;
  return 1;
}

INLINE Term arm_39(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_38 = 0;
  Term _a_64 = r0;
  WL_SPIN
    if (term_aux(_a_64) == CID_SCON) {
      Term _fb_13[2];
      u64 _sp_13 = ctr_take(e, _a_64, 2, _fb_13);
      u32 _f_26 = _fb_13[0];
      Term _f_27 = _fb_13[1];
      Term _o_25[1];
      if (arm_40(e, _o_25, _f_26, _f_27) == 0) {
        return 0;
      }
      _v_38 = _o_25[0];
      spare_free(e, cls_fit(2), _sp_13);
    } else {
      Term _o_26[1];
      if (arm_56(e, _o_26, _a_64) == 0) {
        return 0;
      }
      _v_38 = _o_26[0];
    }
  break;
  }
  o[0] = _v_38;
  return 1;
}

INLINE Term arm_38(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_37 = 0;
  u32 _a_62 = r0;
  Term _a_63 = r1;
  WL_SPIN
    if (_a_62 == 112) {
      Term _o_27[1];
      if (arm_39(e, _o_27, _a_63) == 0) {
        return 0;
      }
      _v_37 = _o_27[0];
    } else {
      Term _o_28[1];
      if (arm_57(e, _o_28, ((_a_62 >> 0) & 1), ((_a_62 >> 1) & 1), ((_a_62 >> 2) & 1), ((_a_62 >> 3) & 1), ((_a_62 >> 4) & 1), ((_a_62 >> 5) & 1), ((_a_62 >> 6) & 1), ((_a_62 >> 7) & 1), ((_a_62 >> 8) & 1), ((_a_62 >> 9) & 1), ((_a_62 >> 10) & 1), ((_a_62 >> 11) & 1), ((_a_62 >> 12) & 1), ((_a_62 >> 13) & 1), ((_a_62 >> 14) & 1), ((_a_62 >> 15) & 1), ((_a_62 >> 16) & 1), ((_a_62 >> 17) & 1), ((_a_62 >> 18) & 1), ((_a_62 >> 19) & 1), ((_a_62 >> 20) & 1), ((_a_62 >> 21) & 1), ((_a_62 >> 22) & 1), ((_a_62 >> 23) & 1), ((_a_62 >> 24) & 1), ((_a_62 >> 25) & 1), ((_a_62 >> 26) & 1), ((_a_62 >> 27) & 1), ((_a_62 >> 28) & 1), ((_a_62 >> 29) & 1), ((_a_62 >> 30) & 1), ((_a_62 >> 31) & 1), _a_63) == 0) {
        return 0;
      }
      _v_37 = _o_28[0];
    }
  break;
  }
  o[0] = _v_37;
  return 1;
}

INLINE Term arm_37(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_36 = 0;
  u32 _a_60 = r0;
  Term _a_61 = r1;
  WL_SPIN
    Term _o_29[1];
    if (arm_38(e, _o_29, _a_60, _a_61) == 0) {
      return 0;
    }
    _v_36 = _o_29[0];
  break;
  }
  o[0] = _v_36;
  return 1;
}

INLINE Term arm_36(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_35 = 0;
  Term _a_59 = r0;
  WL_SPIN
    if (term_aux(_a_59) == CID_SCON) {
      Term _fb_12[2];
      u64 _sp_12 = ctr_take(e, _a_59, 2, _fb_12);
      u32 _f_24 = _fb_12[0];
      Term _f_25 = _fb_12[1];
      Term _o_30[1];
      if (arm_37(e, _o_30, _f_24, _f_25) == 0) {
        return 0;
      }
      _v_35 = _o_30[0];
      spare_free(e, cls_fit(2), _sp_12);
    } else {
      Term _o_31[1];
      if (arm_56(e, _o_31, _a_59) == 0) {
        return 0;
      }
      _v_35 = _o_31[0];
    }
  break;
  }
  o[0] = _v_35;
  return 1;
}

INLINE Term arm_35(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_34 = 0;
  u32 _a_57 = r0;
  Term _a_58 = r1;
  WL_SPIN
    if (_a_57 == 109) {
      Term _o_32[1];
      if (arm_36(e, _o_32, _a_58) == 0) {
        return 0;
      }
      _v_34 = _o_32[0];
    } else {
      Term _o_33[1];
      if (arm_57(e, _o_33, ((_a_57 >> 0) & 1), ((_a_57 >> 1) & 1), ((_a_57 >> 2) & 1), ((_a_57 >> 3) & 1), ((_a_57 >> 4) & 1), ((_a_57 >> 5) & 1), ((_a_57 >> 6) & 1), ((_a_57 >> 7) & 1), ((_a_57 >> 8) & 1), ((_a_57 >> 9) & 1), ((_a_57 >> 10) & 1), ((_a_57 >> 11) & 1), ((_a_57 >> 12) & 1), ((_a_57 >> 13) & 1), ((_a_57 >> 14) & 1), ((_a_57 >> 15) & 1), ((_a_57 >> 16) & 1), ((_a_57 >> 17) & 1), ((_a_57 >> 18) & 1), ((_a_57 >> 19) & 1), ((_a_57 >> 20) & 1), ((_a_57 >> 21) & 1), ((_a_57 >> 22) & 1), ((_a_57 >> 23) & 1), ((_a_57 >> 24) & 1), ((_a_57 >> 25) & 1), ((_a_57 >> 26) & 1), ((_a_57 >> 27) & 1), ((_a_57 >> 28) & 1), ((_a_57 >> 29) & 1), ((_a_57 >> 30) & 1), ((_a_57 >> 31) & 1), _a_58) == 0) {
        return 0;
      }
      _v_34 = _o_33[0];
    }
  break;
  }
  o[0] = _v_34;
  return 1;
}

INLINE Term arm_34(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_33 = 0;
  u32 _a_55 = r0;
  Term _a_56 = r1;
  WL_SPIN
    Term _o_34[1];
    if (arm_35(e, _o_34, _a_55, _a_56) == 0) {
      return 0;
    }
    _v_33 = _o_34[0];
  break;
  }
  o[0] = _v_33;
  return 1;
}

INLINE Term arm_33(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_32 = 0;
  Term _a_54 = r0;
  WL_SPIN
    if (term_aux(_a_54) == CID_SCON) {
      Term _fb_11[2];
      u64 _sp_11 = ctr_take(e, _a_54, 2, _fb_11);
      u32 _f_22 = _fb_11[0];
      Term _f_23 = _fb_11[1];
      Term _o_35[1];
      if (arm_34(e, _o_35, _f_22, _f_23) == 0) {
        return 0;
      }
      _v_32 = _o_35[0];
      spare_free(e, cls_fit(2), _sp_11);
    } else {
      Term _o_36[1];
      if (arm_56(e, _o_36, _a_54) == 0) {
        return 0;
      }
      _v_32 = _o_36[0];
    }
  break;
  }
  o[0] = _v_32;
  return 1;
}

INLINE Term arm_32(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_31 = 0;
  u32 _a_52 = r0;
  Term _a_53 = r1;
  WL_SPIN
    if (_a_52 == 111) {
      Term _o_37[1];
      if (arm_33(e, _o_37, _a_53) == 0) {
        return 0;
      }
      _v_31 = _o_37[0];
    } else {
      Term _o_38[1];
      if (arm_57(e, _o_38, ((_a_52 >> 0) & 1), ((_a_52 >> 1) & 1), ((_a_52 >> 2) & 1), ((_a_52 >> 3) & 1), ((_a_52 >> 4) & 1), ((_a_52 >> 5) & 1), ((_a_52 >> 6) & 1), ((_a_52 >> 7) & 1), ((_a_52 >> 8) & 1), ((_a_52 >> 9) & 1), ((_a_52 >> 10) & 1), ((_a_52 >> 11) & 1), ((_a_52 >> 12) & 1), ((_a_52 >> 13) & 1), ((_a_52 >> 14) & 1), ((_a_52 >> 15) & 1), ((_a_52 >> 16) & 1), ((_a_52 >> 17) & 1), ((_a_52 >> 18) & 1), ((_a_52 >> 19) & 1), ((_a_52 >> 20) & 1), ((_a_52 >> 21) & 1), ((_a_52 >> 22) & 1), ((_a_52 >> 23) & 1), ((_a_52 >> 24) & 1), ((_a_52 >> 25) & 1), ((_a_52 >> 26) & 1), ((_a_52 >> 27) & 1), ((_a_52 >> 28) & 1), ((_a_52 >> 29) & 1), ((_a_52 >> 30) & 1), ((_a_52 >> 31) & 1), _a_53) == 0) {
        return 0;
      }
      _v_31 = _o_38[0];
    }
  break;
  }
  o[0] = _v_31;
  return 1;
}

INLINE Term arm_31(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_30 = 0;
  u32 _a_50 = r0;
  Term _a_51 = r1;
  WL_SPIN
    Term _o_39[1];
    if (arm_32(e, _o_39, _a_50, _a_51) == 0) {
      return 0;
    }
    _v_30 = _o_39[0];
  break;
  }
  o[0] = _v_30;
  return 1;
}

INLINE Term arm_30(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_29 = 0;
  Term _a_49 = r0;
  WL_SPIN
    if (term_aux(_a_49) == CID_SCON) {
      Term _fb_10[2];
      u64 _sp_10 = ctr_take(e, _a_49, 2, _fb_10);
      u32 _f_20 = _fb_10[0];
      Term _f_21 = _fb_10[1];
      Term _o_40[1];
      if (arm_31(e, _o_40, _f_20, _f_21) == 0) {
        return 0;
      }
      _v_29 = _o_40[0];
      spare_free(e, cls_fit(2), _sp_10);
    } else {
      Term _o_41[1];
      if (arm_56(e, _o_41, _a_49) == 0) {
        return 0;
      }
      _v_29 = _o_41[0];
    }
  break;
  }
  o[0] = _v_29;
  return 1;
}

INLINE Term arm_58(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, u32 r13, u32 r14, u32 r15, u32 r16, u32 r17, u32 r18, u32 r19, u32 r20, u32 r21, u32 r22, u32 r23, u32 r24, u32 r25, u32 r26, u32 r27, u32 r28, u32 r29, Term r30) {
  u32 wpoll = 0;
  u32 _v_57 = 0;
  u32 _a_124 = r0;
  u32 _a_125 = r1;
  u32 _a_126 = r2;
  u32 _a_127 = r3;
  u32 _a_128 = r4;
  u32 _a_129 = r5;
  u32 _a_130 = r6;
  u32 _a_131 = r7;
  u32 _a_132 = r8;
  u32 _a_133 = r9;
  u32 _a_134 = r10;
  u32 _a_135 = r11;
  u32 _a_136 = r12;
  u32 _a_137 = r13;
  u32 _a_138 = r14;
  u32 _a_139 = r15;
  u32 _a_140 = r16;
  u32 _a_141 = r17;
  u32 _a_142 = r18;
  u32 _a_143 = r19;
  u32 _a_144 = r20;
  u32 _a_145 = r21;
  u32 _a_146 = r22;
  u32 _a_147 = r23;
  u32 _a_148 = r24;
  u32 _a_149 = r25;
  u32 _a_150 = r26;
  u32 _a_151 = r27;
  u32 _a_152 = r28;
  u32 _a_153 = r29;
  Term _a_154 = r30;
  WL_SPIN
    term_sink(e, _a_154);
    _v_57 = 0ull;
  break;
  }
  o[0] = _v_57;
  return 1;
}

INLINE Term arm_87(Env e, THR Term* o) {
  u32 wpoll = 0;
  u32 _v_86 = 0;
  WL_SPIN
    _v_86 = 3ull;
  break;
  }
  o[0] = _v_86;
  return 1;
}

INLINE Term arm_86(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_85 = 0;
  Term _a_200 = r0;
  WL_SPIN
    if (term_aux(_a_200) == CID_SNIL) {
      Term _o_44[1];
      if (arm_87(e, _o_44) == 0) {
        return 0;
      }
      _v_85 = _o_44[0];
    } else {
      Term _o_45[1];
      if (arm_56(e, _o_45, _a_200) == 0) {
        return 0;
      }
      _v_85 = _o_45[0];
    }
  break;
  }
  o[0] = _v_85;
  return 1;
}

INLINE Term arm_85(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_84 = 0;
  u32 _a_198 = r0;
  Term _a_199 = r1;
  WL_SPIN
    if (_a_198 == 101) {
      Term _o_46[1];
      if (arm_86(e, _o_46, _a_199) == 0) {
        return 0;
      }
      _v_84 = _o_46[0];
    } else {
      Term _o_47[1];
      if (arm_57(e, _o_47, ((_a_198 >> 0) & 1), ((_a_198 >> 1) & 1), ((_a_198 >> 2) & 1), ((_a_198 >> 3) & 1), ((_a_198 >> 4) & 1), ((_a_198 >> 5) & 1), ((_a_198 >> 6) & 1), ((_a_198 >> 7) & 1), ((_a_198 >> 8) & 1), ((_a_198 >> 9) & 1), ((_a_198 >> 10) & 1), ((_a_198 >> 11) & 1), ((_a_198 >> 12) & 1), ((_a_198 >> 13) & 1), ((_a_198 >> 14) & 1), ((_a_198 >> 15) & 1), ((_a_198 >> 16) & 1), ((_a_198 >> 17) & 1), ((_a_198 >> 18) & 1), ((_a_198 >> 19) & 1), ((_a_198 >> 20) & 1), ((_a_198 >> 21) & 1), ((_a_198 >> 22) & 1), ((_a_198 >> 23) & 1), ((_a_198 >> 24) & 1), ((_a_198 >> 25) & 1), ((_a_198 >> 26) & 1), ((_a_198 >> 27) & 1), ((_a_198 >> 28) & 1), ((_a_198 >> 29) & 1), ((_a_198 >> 30) & 1), ((_a_198 >> 31) & 1), _a_199) == 0) {
        return 0;
      }
      _v_84 = _o_47[0];
    }
  break;
  }
  o[0] = _v_84;
  return 1;
}

INLINE Term arm_84(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_83 = 0;
  u32 _a_196 = r0;
  Term _a_197 = r1;
  WL_SPIN
    Term _o_48[1];
    if (arm_85(e, _o_48, _a_196, _a_197) == 0) {
      return 0;
    }
    _v_83 = _o_48[0];
  break;
  }
  o[0] = _v_83;
  return 1;
}

INLINE Term arm_83(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_82 = 0;
  Term _a_195 = r0;
  WL_SPIN
    if (term_aux(_a_195) == CID_SCON) {
      Term _fb_26[2];
      u64 _sp_26 = ctr_take(e, _a_195, 2, _fb_26);
      u32 _f_52 = _fb_26[0];
      Term _f_53 = _fb_26[1];
      Term _o_49[1];
      if (arm_84(e, _o_49, _f_52, _f_53) == 0) {
        return 0;
      }
      _v_82 = _o_49[0];
      spare_free(e, cls_fit(2), _sp_26);
    } else {
      Term _o_50[1];
      if (arm_56(e, _o_50, _a_195) == 0) {
        return 0;
      }
      _v_82 = _o_50[0];
    }
  break;
  }
  o[0] = _v_82;
  return 1;
}

INLINE Term arm_82(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_81 = 0;
  u32 _a_193 = r0;
  Term _a_194 = r1;
  WL_SPIN
    if (_a_193 == 116) {
      Term _o_51[1];
      if (arm_83(e, _o_51, _a_194) == 0) {
        return 0;
      }
      _v_81 = _o_51[0];
    } else {
      Term _o_52[1];
      if (arm_57(e, _o_52, ((_a_193 >> 0) & 1), ((_a_193 >> 1) & 1), ((_a_193 >> 2) & 1), ((_a_193 >> 3) & 1), ((_a_193 >> 4) & 1), ((_a_193 >> 5) & 1), ((_a_193 >> 6) & 1), ((_a_193 >> 7) & 1), ((_a_193 >> 8) & 1), ((_a_193 >> 9) & 1), ((_a_193 >> 10) & 1), ((_a_193 >> 11) & 1), ((_a_193 >> 12) & 1), ((_a_193 >> 13) & 1), ((_a_193 >> 14) & 1), ((_a_193 >> 15) & 1), ((_a_193 >> 16) & 1), ((_a_193 >> 17) & 1), ((_a_193 >> 18) & 1), ((_a_193 >> 19) & 1), ((_a_193 >> 20) & 1), ((_a_193 >> 21) & 1), ((_a_193 >> 22) & 1), ((_a_193 >> 23) & 1), ((_a_193 >> 24) & 1), ((_a_193 >> 25) & 1), ((_a_193 >> 26) & 1), ((_a_193 >> 27) & 1), ((_a_193 >> 28) & 1), ((_a_193 >> 29) & 1), ((_a_193 >> 30) & 1), ((_a_193 >> 31) & 1), _a_194) == 0) {
        return 0;
      }
      _v_81 = _o_52[0];
    }
  break;
  }
  o[0] = _v_81;
  return 1;
}

INLINE Term arm_81(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_80 = 0;
  u32 _a_191 = r0;
  Term _a_192 = r1;
  WL_SPIN
    Term _o_53[1];
    if (arm_82(e, _o_53, _a_191, _a_192) == 0) {
      return 0;
    }
    _v_80 = _o_53[0];
  break;
  }
  o[0] = _v_80;
  return 1;
}

INLINE Term arm_80(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_79 = 0;
  Term _a_190 = r0;
  WL_SPIN
    if (term_aux(_a_190) == CID_SCON) {
      Term _fb_25[2];
      u64 _sp_25 = ctr_take(e, _a_190, 2, _fb_25);
      u32 _f_50 = _fb_25[0];
      Term _f_51 = _fb_25[1];
      Term _o_54[1];
      if (arm_81(e, _o_54, _f_50, _f_51) == 0) {
        return 0;
      }
      _v_79 = _o_54[0];
      spare_free(e, cls_fit(2), _sp_25);
    } else {
      Term _o_55[1];
      if (arm_56(e, _o_55, _a_190) == 0) {
        return 0;
      }
      _v_79 = _o_55[0];
    }
  break;
  }
  o[0] = _v_79;
  return 1;
}

INLINE Term arm_79(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_78 = 0;
  u32 _a_188 = r0;
  Term _a_189 = r1;
  WL_SPIN
    if (_a_188 == 101) {
      Term _o_56[1];
      if (arm_80(e, _o_56, _a_189) == 0) {
        return 0;
      }
      _v_78 = _o_56[0];
    } else {
      Term _o_57[1];
      if (arm_57(e, _o_57, ((_a_188 >> 0) & 1), ((_a_188 >> 1) & 1), ((_a_188 >> 2) & 1), ((_a_188 >> 3) & 1), ((_a_188 >> 4) & 1), ((_a_188 >> 5) & 1), ((_a_188 >> 6) & 1), ((_a_188 >> 7) & 1), ((_a_188 >> 8) & 1), ((_a_188 >> 9) & 1), ((_a_188 >> 10) & 1), ((_a_188 >> 11) & 1), ((_a_188 >> 12) & 1), ((_a_188 >> 13) & 1), ((_a_188 >> 14) & 1), ((_a_188 >> 15) & 1), ((_a_188 >> 16) & 1), ((_a_188 >> 17) & 1), ((_a_188 >> 18) & 1), ((_a_188 >> 19) & 1), ((_a_188 >> 20) & 1), ((_a_188 >> 21) & 1), ((_a_188 >> 22) & 1), ((_a_188 >> 23) & 1), ((_a_188 >> 24) & 1), ((_a_188 >> 25) & 1), ((_a_188 >> 26) & 1), ((_a_188 >> 27) & 1), ((_a_188 >> 28) & 1), ((_a_188 >> 29) & 1), ((_a_188 >> 30) & 1), ((_a_188 >> 31) & 1), _a_189) == 0) {
        return 0;
      }
      _v_78 = _o_57[0];
    }
  break;
  }
  o[0] = _v_78;
  return 1;
}

INLINE Term arm_78(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_77 = 0;
  u32 _a_186 = r0;
  Term _a_187 = r1;
  WL_SPIN
    Term _o_58[1];
    if (arm_79(e, _o_58, _a_186, _a_187) == 0) {
      return 0;
    }
    _v_77 = _o_58[0];
  break;
  }
  o[0] = _v_77;
  return 1;
}

INLINE Term arm_77(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_76 = 0;
  Term _a_185 = r0;
  WL_SPIN
    if (term_aux(_a_185) == CID_SCON) {
      Term _fb_24[2];
      u64 _sp_24 = ctr_take(e, _a_185, 2, _fb_24);
      u32 _f_48 = _fb_24[0];
      Term _f_49 = _fb_24[1];
      Term _o_59[1];
      if (arm_78(e, _o_59, _f_48, _f_49) == 0) {
        return 0;
      }
      _v_76 = _o_59[0];
      spare_free(e, cls_fit(2), _sp_24);
    } else {
      Term _o_60[1];
      if (arm_56(e, _o_60, _a_185) == 0) {
        return 0;
      }
      _v_76 = _o_60[0];
    }
  break;
  }
  o[0] = _v_76;
  return 1;
}

INLINE Term arm_76(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_75 = 0;
  u32 _a_183 = r0;
  Term _a_184 = r1;
  WL_SPIN
    if (_a_183 == 108) {
      Term _o_61[1];
      if (arm_77(e, _o_61, _a_184) == 0) {
        return 0;
      }
      _v_75 = _o_61[0];
    } else {
      Term _o_62[1];
      if (arm_57(e, _o_62, ((_a_183 >> 0) & 1), ((_a_183 >> 1) & 1), ((_a_183 >> 2) & 1), ((_a_183 >> 3) & 1), ((_a_183 >> 4) & 1), ((_a_183 >> 5) & 1), ((_a_183 >> 6) & 1), ((_a_183 >> 7) & 1), ((_a_183 >> 8) & 1), ((_a_183 >> 9) & 1), ((_a_183 >> 10) & 1), ((_a_183 >> 11) & 1), ((_a_183 >> 12) & 1), ((_a_183 >> 13) & 1), ((_a_183 >> 14) & 1), ((_a_183 >> 15) & 1), ((_a_183 >> 16) & 1), ((_a_183 >> 17) & 1), ((_a_183 >> 18) & 1), ((_a_183 >> 19) & 1), ((_a_183 >> 20) & 1), ((_a_183 >> 21) & 1), ((_a_183 >> 22) & 1), ((_a_183 >> 23) & 1), ((_a_183 >> 24) & 1), ((_a_183 >> 25) & 1), ((_a_183 >> 26) & 1), ((_a_183 >> 27) & 1), ((_a_183 >> 28) & 1), ((_a_183 >> 29) & 1), ((_a_183 >> 30) & 1), ((_a_183 >> 31) & 1), _a_184) == 0) {
        return 0;
      }
      _v_75 = _o_62[0];
    }
  break;
  }
  o[0] = _v_75;
  return 1;
}

INLINE Term arm_75(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_74 = 0;
  u32 _a_181 = r0;
  Term _a_182 = r1;
  WL_SPIN
    Term _o_63[1];
    if (arm_76(e, _o_63, _a_181, _a_182) == 0) {
      return 0;
    }
    _v_74 = _o_63[0];
  break;
  }
  o[0] = _v_74;
  return 1;
}

INLINE Term arm_74(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_73 = 0;
  Term _a_180 = r0;
  WL_SPIN
    if (term_aux(_a_180) == CID_SCON) {
      Term _fb_23[2];
      u64 _sp_23 = ctr_take(e, _a_180, 2, _fb_23);
      u32 _f_46 = _fb_23[0];
      Term _f_47 = _fb_23[1];
      Term _o_64[1];
      if (arm_75(e, _o_64, _f_46, _f_47) == 0) {
        return 0;
      }
      _v_73 = _o_64[0];
      spare_free(e, cls_fit(2), _sp_23);
    } else {
      Term _o_65[1];
      if (arm_56(e, _o_65, _a_180) == 0) {
        return 0;
      }
      _v_73 = _o_65[0];
    }
  break;
  }
  o[0] = _v_73;
  return 1;
}

INLINE Term arm_73(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_72 = 0;
  u32 _a_178 = r0;
  Term _a_179 = r1;
  WL_SPIN
    if (_a_178 == 112) {
      Term _o_66[1];
      if (arm_74(e, _o_66, _a_179) == 0) {
        return 0;
      }
      _v_72 = _o_66[0];
    } else {
      Term _o_67[1];
      if (arm_57(e, _o_67, ((_a_178 >> 0) & 1), ((_a_178 >> 1) & 1), ((_a_178 >> 2) & 1), ((_a_178 >> 3) & 1), ((_a_178 >> 4) & 1), ((_a_178 >> 5) & 1), ((_a_178 >> 6) & 1), ((_a_178 >> 7) & 1), ((_a_178 >> 8) & 1), ((_a_178 >> 9) & 1), ((_a_178 >> 10) & 1), ((_a_178 >> 11) & 1), ((_a_178 >> 12) & 1), ((_a_178 >> 13) & 1), ((_a_178 >> 14) & 1), ((_a_178 >> 15) & 1), ((_a_178 >> 16) & 1), ((_a_178 >> 17) & 1), ((_a_178 >> 18) & 1), ((_a_178 >> 19) & 1), ((_a_178 >> 20) & 1), ((_a_178 >> 21) & 1), ((_a_178 >> 22) & 1), ((_a_178 >> 23) & 1), ((_a_178 >> 24) & 1), ((_a_178 >> 25) & 1), ((_a_178 >> 26) & 1), ((_a_178 >> 27) & 1), ((_a_178 >> 28) & 1), ((_a_178 >> 29) & 1), ((_a_178 >> 30) & 1), ((_a_178 >> 31) & 1), _a_179) == 0) {
        return 0;
      }
      _v_72 = _o_67[0];
    }
  break;
  }
  o[0] = _v_72;
  return 1;
}

INLINE Term arm_72(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_71 = 0;
  u32 _a_176 = r0;
  Term _a_177 = r1;
  WL_SPIN
    Term _o_68[1];
    if (arm_73(e, _o_68, _a_176, _a_177) == 0) {
      return 0;
    }
    _v_71 = _o_68[0];
  break;
  }
  o[0] = _v_71;
  return 1;
}

INLINE Term arm_71(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_70 = 0;
  Term _a_175 = r0;
  WL_SPIN
    if (term_aux(_a_175) == CID_SCON) {
      Term _fb_22[2];
      u64 _sp_22 = ctr_take(e, _a_175, 2, _fb_22);
      u32 _f_44 = _fb_22[0];
      Term _f_45 = _fb_22[1];
      Term _o_69[1];
      if (arm_72(e, _o_69, _f_44, _f_45) == 0) {
        return 0;
      }
      _v_70 = _o_69[0];
      spare_free(e, cls_fit(2), _sp_22);
    } else {
      Term _o_70[1];
      if (arm_56(e, _o_70, _a_175) == 0) {
        return 0;
      }
      _v_70 = _o_70[0];
    }
  break;
  }
  o[0] = _v_70;
  return 1;
}

INLINE Term arm_70(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_69 = 0;
  u32 _a_173 = r0;
  Term _a_174 = r1;
  WL_SPIN
    if (_a_173 == 109) {
      Term _o_71[1];
      if (arm_71(e, _o_71, _a_174) == 0) {
        return 0;
      }
      _v_69 = _o_71[0];
    } else {
      Term _o_72[1];
      if (arm_57(e, _o_72, ((_a_173 >> 0) & 1), ((_a_173 >> 1) & 1), ((_a_173 >> 2) & 1), ((_a_173 >> 3) & 1), ((_a_173 >> 4) & 1), ((_a_173 >> 5) & 1), ((_a_173 >> 6) & 1), ((_a_173 >> 7) & 1), ((_a_173 >> 8) & 1), ((_a_173 >> 9) & 1), ((_a_173 >> 10) & 1), ((_a_173 >> 11) & 1), ((_a_173 >> 12) & 1), ((_a_173 >> 13) & 1), ((_a_173 >> 14) & 1), ((_a_173 >> 15) & 1), ((_a_173 >> 16) & 1), ((_a_173 >> 17) & 1), ((_a_173 >> 18) & 1), ((_a_173 >> 19) & 1), ((_a_173 >> 20) & 1), ((_a_173 >> 21) & 1), ((_a_173 >> 22) & 1), ((_a_173 >> 23) & 1), ((_a_173 >> 24) & 1), ((_a_173 >> 25) & 1), ((_a_173 >> 26) & 1), ((_a_173 >> 27) & 1), ((_a_173 >> 28) & 1), ((_a_173 >> 29) & 1), ((_a_173 >> 30) & 1), ((_a_173 >> 31) & 1), _a_174) == 0) {
        return 0;
      }
      _v_69 = _o_72[0];
    }
  break;
  }
  o[0] = _v_69;
  return 1;
}

INLINE Term arm_69(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_68 = 0;
  u32 _a_171 = r0;
  Term _a_172 = r1;
  WL_SPIN
    Term _o_73[1];
    if (arm_70(e, _o_73, _a_171, _a_172) == 0) {
      return 0;
    }
    _v_68 = _o_73[0];
  break;
  }
  o[0] = _v_68;
  return 1;
}

INLINE Term arm_68(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_67 = 0;
  Term _a_170 = r0;
  WL_SPIN
    if (term_aux(_a_170) == CID_SCON) {
      Term _fb_21[2];
      u64 _sp_21 = ctr_take(e, _a_170, 2, _fb_21);
      u32 _f_42 = _fb_21[0];
      Term _f_43 = _fb_21[1];
      Term _o_74[1];
      if (arm_69(e, _o_74, _f_42, _f_43) == 0) {
        return 0;
      }
      _v_67 = _o_74[0];
      spare_free(e, cls_fit(2), _sp_21);
    } else {
      Term _o_75[1];
      if (arm_56(e, _o_75, _a_170) == 0) {
        return 0;
      }
      _v_67 = _o_75[0];
    }
  break;
  }
  o[0] = _v_67;
  return 1;
}

INLINE Term arm_67(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_66 = 0;
  u32 _a_168 = r0;
  Term _a_169 = r1;
  WL_SPIN
    if (_a_168 == 111) {
      Term _o_76[1];
      if (arm_68(e, _o_76, _a_169) == 0) {
        return 0;
      }
      _v_66 = _o_76[0];
    } else {
      Term _o_77[1];
      if (arm_57(e, _o_77, ((_a_168 >> 0) & 1), ((_a_168 >> 1) & 1), ((_a_168 >> 2) & 1), ((_a_168 >> 3) & 1), ((_a_168 >> 4) & 1), ((_a_168 >> 5) & 1), ((_a_168 >> 6) & 1), ((_a_168 >> 7) & 1), ((_a_168 >> 8) & 1), ((_a_168 >> 9) & 1), ((_a_168 >> 10) & 1), ((_a_168 >> 11) & 1), ((_a_168 >> 12) & 1), ((_a_168 >> 13) & 1), ((_a_168 >> 14) & 1), ((_a_168 >> 15) & 1), ((_a_168 >> 16) & 1), ((_a_168 >> 17) & 1), ((_a_168 >> 18) & 1), ((_a_168 >> 19) & 1), ((_a_168 >> 20) & 1), ((_a_168 >> 21) & 1), ((_a_168 >> 22) & 1), ((_a_168 >> 23) & 1), ((_a_168 >> 24) & 1), ((_a_168 >> 25) & 1), ((_a_168 >> 26) & 1), ((_a_168 >> 27) & 1), ((_a_168 >> 28) & 1), ((_a_168 >> 29) & 1), ((_a_168 >> 30) & 1), ((_a_168 >> 31) & 1), _a_169) == 0) {
        return 0;
      }
      _v_66 = _o_77[0];
    }
  break;
  }
  o[0] = _v_66;
  return 1;
}

INLINE Term arm_66(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_65 = 0;
  u32 _a_166 = r0;
  Term _a_167 = r1;
  WL_SPIN
    Term _o_78[1];
    if (arm_67(e, _o_78, _a_166, _a_167) == 0) {
      return 0;
    }
    _v_65 = _o_78[0];
  break;
  }
  o[0] = _v_65;
  return 1;
}

INLINE Term arm_65(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_64 = 0;
  Term _a_165 = r0;
  WL_SPIN
    if (term_aux(_a_165) == CID_SCON) {
      Term _fb_20[2];
      u64 _sp_20 = ctr_take(e, _a_165, 2, _fb_20);
      u32 _f_40 = _fb_20[0];
      Term _f_41 = _fb_20[1];
      Term _o_79[1];
      if (arm_66(e, _o_79, _f_40, _f_41) == 0) {
        return 0;
      }
      _v_64 = _o_79[0];
      spare_free(e, cls_fit(2), _sp_20);
    } else {
      Term _o_80[1];
      if (arm_56(e, _o_80, _a_165) == 0) {
        return 0;
      }
      _v_64 = _o_80[0];
    }
  break;
  }
  o[0] = _v_64;
  return 1;
}

INLINE Term arm_64(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_63 = 0;
  u32 _a_163 = r0;
  Term _a_164 = r1;
  WL_SPIN
    if (_a_163 == 99) {
      Term _o_81[1];
      if (arm_65(e, _o_81, _a_164) == 0) {
        return 0;
      }
      _v_63 = _o_81[0];
    } else {
      Term _o_82[1];
      if (arm_57(e, _o_82, ((_a_163 >> 0) & 1), ((_a_163 >> 1) & 1), ((_a_163 >> 2) & 1), ((_a_163 >> 3) & 1), ((_a_163 >> 4) & 1), ((_a_163 >> 5) & 1), ((_a_163 >> 6) & 1), ((_a_163 >> 7) & 1), ((_a_163 >> 8) & 1), ((_a_163 >> 9) & 1), ((_a_163 >> 10) & 1), ((_a_163 >> 11) & 1), ((_a_163 >> 12) & 1), ((_a_163 >> 13) & 1), ((_a_163 >> 14) & 1), ((_a_163 >> 15) & 1), ((_a_163 >> 16) & 1), ((_a_163 >> 17) & 1), ((_a_163 >> 18) & 1), ((_a_163 >> 19) & 1), ((_a_163 >> 20) & 1), ((_a_163 >> 21) & 1), ((_a_163 >> 22) & 1), ((_a_163 >> 23) & 1), ((_a_163 >> 24) & 1), ((_a_163 >> 25) & 1), ((_a_163 >> 26) & 1), ((_a_163 >> 27) & 1), ((_a_163 >> 28) & 1), ((_a_163 >> 29) & 1), ((_a_163 >> 30) & 1), ((_a_163 >> 31) & 1), _a_164) == 0) {
        return 0;
      }
      _v_63 = _o_82[0];
    }
  break;
  }
  o[0] = _v_63;
  return 1;
}

INLINE Term arm_63(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_62 = 0;
  u32 _a_161 = r0;
  Term _a_162 = r1;
  WL_SPIN
    Term _o_83[1];
    if (arm_64(e, _o_83, _a_161, _a_162) == 0) {
      return 0;
    }
    _v_62 = _o_83[0];
  break;
  }
  o[0] = _v_62;
  return 1;
}

INLINE Term arm_62(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_61 = 0;
  Term _a_160 = r0;
  WL_SPIN
    if (term_aux(_a_160) == CID_SCON) {
      Term _fb_19[2];
      u64 _sp_19 = ctr_take(e, _a_160, 2, _fb_19);
      u32 _f_38 = _fb_19[0];
      Term _f_39 = _fb_19[1];
      Term _o_84[1];
      if (arm_63(e, _o_84, _f_38, _f_39) == 0) {
        return 0;
      }
      _v_61 = _o_84[0];
      spare_free(e, cls_fit(2), _sp_19);
    } else {
      Term _o_85[1];
      if (arm_56(e, _o_85, _a_160) == 0) {
        return 0;
      }
      _v_61 = _o_85[0];
    }
  break;
  }
  o[0] = _v_61;
  return 1;
}

INLINE Term arm_61(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_60 = 0;
  u32 _a_158 = r0;
  Term _a_159 = r1;
  WL_SPIN
    if (_a_158 == 110) {
      Term _o_86[1];
      if (arm_62(e, _o_86, _a_159) == 0) {
        return 0;
      }
      _v_60 = _o_86[0];
    } else {
      Term _o_87[1];
      if (arm_57(e, _o_87, ((_a_158 >> 0) & 1), ((_a_158 >> 1) & 1), ((_a_158 >> 2) & 1), ((_a_158 >> 3) & 1), ((_a_158 >> 4) & 1), ((_a_158 >> 5) & 1), ((_a_158 >> 6) & 1), ((_a_158 >> 7) & 1), ((_a_158 >> 8) & 1), ((_a_158 >> 9) & 1), ((_a_158 >> 10) & 1), ((_a_158 >> 11) & 1), ((_a_158 >> 12) & 1), ((_a_158 >> 13) & 1), ((_a_158 >> 14) & 1), ((_a_158 >> 15) & 1), ((_a_158 >> 16) & 1), ((_a_158 >> 17) & 1), ((_a_158 >> 18) & 1), ((_a_158 >> 19) & 1), ((_a_158 >> 20) & 1), ((_a_158 >> 21) & 1), ((_a_158 >> 22) & 1), ((_a_158 >> 23) & 1), ((_a_158 >> 24) & 1), ((_a_158 >> 25) & 1), ((_a_158 >> 26) & 1), ((_a_158 >> 27) & 1), ((_a_158 >> 28) & 1), ((_a_158 >> 29) & 1), ((_a_158 >> 30) & 1), ((_a_158 >> 31) & 1), _a_159) == 0) {
        return 0;
      }
      _v_60 = _o_87[0];
    }
  break;
  }
  o[0] = _v_60;
  return 1;
}

INLINE Term arm_60(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_59 = 0;
  u32 _a_156 = r0;
  Term _a_157 = r1;
  WL_SPIN
    Term _o_88[1];
    if (arm_61(e, _o_88, _a_156, _a_157) == 0) {
      return 0;
    }
    _v_59 = _o_88[0];
  break;
  }
  o[0] = _v_59;
  return 1;
}

INLINE Term arm_59(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_58 = 0;
  Term _a_155 = r0;
  WL_SPIN
    if (term_aux(_a_155) == CID_SCON) {
      Term _fb_18[2];
      u64 _sp_18 = ctr_take(e, _a_155, 2, _fb_18);
      u32 _f_36 = _fb_18[0];
      Term _f_37 = _fb_18[1];
      Term _o_89[1];
      if (arm_60(e, _o_89, _f_36, _f_37) == 0) {
        return 0;
      }
      _v_58 = _o_89[0];
      spare_free(e, cls_fit(2), _sp_18);
    } else {
      Term _o_90[1];
      if (arm_56(e, _o_90, _a_155) == 0) {
        return 0;
      }
      _v_58 = _o_90[0];
    }
  break;
  }
  o[0] = _v_58;
  return 1;
}

INLINE Term arm_104(Env e, THR Term* o) {
  u32 wpoll = 0;
  u32 _v_103 = 0;
  WL_SPIN
    _v_103 = 2ull;
  break;
  }
  o[0] = _v_103;
  return 1;
}

INLINE Term arm_103(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_102 = 0;
  Term _a_226 = r0;
  WL_SPIN
    if (term_aux(_a_226) == CID_SNIL) {
      Term _o_93[1];
      if (arm_104(e, _o_93) == 0) {
        return 0;
      }
      _v_102 = _o_93[0];
    } else {
      Term _o_94[1];
      if (arm_56(e, _o_94, _a_226) == 0) {
        return 0;
      }
      _v_102 = _o_94[0];
    }
  break;
  }
  o[0] = _v_102;
  return 1;
}

INLINE Term arm_102(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_101 = 0;
  u32 _a_224 = r0;
  Term _a_225 = r1;
  WL_SPIN
    if (_a_224 == 100) {
      Term _o_95[1];
      if (arm_103(e, _o_95, _a_225) == 0) {
        return 0;
      }
      _v_101 = _o_95[0];
    } else {
      Term _o_96[1];
      if (arm_57(e, _o_96, ((_a_224 >> 0) & 1), ((_a_224 >> 1) & 1), ((_a_224 >> 2) & 1), ((_a_224 >> 3) & 1), ((_a_224 >> 4) & 1), ((_a_224 >> 5) & 1), ((_a_224 >> 6) & 1), ((_a_224 >> 7) & 1), ((_a_224 >> 8) & 1), ((_a_224 >> 9) & 1), ((_a_224 >> 10) & 1), ((_a_224 >> 11) & 1), ((_a_224 >> 12) & 1), ((_a_224 >> 13) & 1), ((_a_224 >> 14) & 1), ((_a_224 >> 15) & 1), ((_a_224 >> 16) & 1), ((_a_224 >> 17) & 1), ((_a_224 >> 18) & 1), ((_a_224 >> 19) & 1), ((_a_224 >> 20) & 1), ((_a_224 >> 21) & 1), ((_a_224 >> 22) & 1), ((_a_224 >> 23) & 1), ((_a_224 >> 24) & 1), ((_a_224 >> 25) & 1), ((_a_224 >> 26) & 1), ((_a_224 >> 27) & 1), ((_a_224 >> 28) & 1), ((_a_224 >> 29) & 1), ((_a_224 >> 30) & 1), ((_a_224 >> 31) & 1), _a_225) == 0) {
        return 0;
      }
      _v_101 = _o_96[0];
    }
  break;
  }
  o[0] = _v_101;
  return 1;
}

INLINE Term arm_101(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_100 = 0;
  u32 _a_222 = r0;
  Term _a_223 = r1;
  WL_SPIN
    Term _o_97[1];
    if (arm_102(e, _o_97, _a_222, _a_223) == 0) {
      return 0;
    }
    _v_100 = _o_97[0];
  break;
  }
  o[0] = _v_100;
  return 1;
}

INLINE Term arm_100(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_99 = 0;
  Term _a_221 = r0;
  WL_SPIN
    if (term_aux(_a_221) == CID_SCON) {
      Term _fb_31[2];
      u64 _sp_31 = ctr_take(e, _a_221, 2, _fb_31);
      u32 _f_62 = _fb_31[0];
      Term _f_63 = _fb_31[1];
      Term _o_98[1];
      if (arm_101(e, _o_98, _f_62, _f_63) == 0) {
        return 0;
      }
      _v_99 = _o_98[0];
      spare_free(e, cls_fit(2), _sp_31);
    } else {
      Term _o_99[1];
      if (arm_56(e, _o_99, _a_221) == 0) {
        return 0;
      }
      _v_99 = _o_99[0];
    }
  break;
  }
  o[0] = _v_99;
  return 1;
}

INLINE Term arm_99(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_98 = 0;
  u32 _a_219 = r0;
  Term _a_220 = r1;
  WL_SPIN
    if (_a_219 == 101) {
      Term _o_100[1];
      if (arm_100(e, _o_100, _a_220) == 0) {
        return 0;
      }
      _v_98 = _o_100[0];
    } else {
      Term _o_101[1];
      if (arm_57(e, _o_101, ((_a_219 >> 0) & 1), ((_a_219 >> 1) & 1), ((_a_219 >> 2) & 1), ((_a_219 >> 3) & 1), ((_a_219 >> 4) & 1), ((_a_219 >> 5) & 1), ((_a_219 >> 6) & 1), ((_a_219 >> 7) & 1), ((_a_219 >> 8) & 1), ((_a_219 >> 9) & 1), ((_a_219 >> 10) & 1), ((_a_219 >> 11) & 1), ((_a_219 >> 12) & 1), ((_a_219 >> 13) & 1), ((_a_219 >> 14) & 1), ((_a_219 >> 15) & 1), ((_a_219 >> 16) & 1), ((_a_219 >> 17) & 1), ((_a_219 >> 18) & 1), ((_a_219 >> 19) & 1), ((_a_219 >> 20) & 1), ((_a_219 >> 21) & 1), ((_a_219 >> 22) & 1), ((_a_219 >> 23) & 1), ((_a_219 >> 24) & 1), ((_a_219 >> 25) & 1), ((_a_219 >> 26) & 1), ((_a_219 >> 27) & 1), ((_a_219 >> 28) & 1), ((_a_219 >> 29) & 1), ((_a_219 >> 30) & 1), ((_a_219 >> 31) & 1), _a_220) == 0) {
        return 0;
      }
      _v_98 = _o_101[0];
    }
  break;
  }
  o[0] = _v_98;
  return 1;
}

INLINE Term arm_98(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_97 = 0;
  u32 _a_217 = r0;
  Term _a_218 = r1;
  WL_SPIN
    Term _o_102[1];
    if (arm_99(e, _o_102, _a_217, _a_218) == 0) {
      return 0;
    }
    _v_97 = _o_102[0];
  break;
  }
  o[0] = _v_97;
  return 1;
}

INLINE Term arm_97(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_96 = 0;
  Term _a_216 = r0;
  WL_SPIN
    if (term_aux(_a_216) == CID_SCON) {
      Term _fb_30[2];
      u64 _sp_30 = ctr_take(e, _a_216, 2, _fb_30);
      u32 _f_60 = _fb_30[0];
      Term _f_61 = _fb_30[1];
      Term _o_103[1];
      if (arm_98(e, _o_103, _f_60, _f_61) == 0) {
        return 0;
      }
      _v_96 = _o_103[0];
      spare_free(e, cls_fit(2), _sp_30);
    } else {
      Term _o_104[1];
      if (arm_56(e, _o_104, _a_216) == 0) {
        return 0;
      }
      _v_96 = _o_104[0];
    }
  break;
  }
  o[0] = _v_96;
  return 1;
}

INLINE Term arm_96(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_95 = 0;
  u32 _a_214 = r0;
  Term _a_215 = r1;
  WL_SPIN
    if (_a_214 == 108) {
      Term _o_105[1];
      if (arm_97(e, _o_105, _a_215) == 0) {
        return 0;
      }
      _v_95 = _o_105[0];
    } else {
      Term _o_106[1];
      if (arm_57(e, _o_106, ((_a_214 >> 0) & 1), ((_a_214 >> 1) & 1), ((_a_214 >> 2) & 1), ((_a_214 >> 3) & 1), ((_a_214 >> 4) & 1), ((_a_214 >> 5) & 1), ((_a_214 >> 6) & 1), ((_a_214 >> 7) & 1), ((_a_214 >> 8) & 1), ((_a_214 >> 9) & 1), ((_a_214 >> 10) & 1), ((_a_214 >> 11) & 1), ((_a_214 >> 12) & 1), ((_a_214 >> 13) & 1), ((_a_214 >> 14) & 1), ((_a_214 >> 15) & 1), ((_a_214 >> 16) & 1), ((_a_214 >> 17) & 1), ((_a_214 >> 18) & 1), ((_a_214 >> 19) & 1), ((_a_214 >> 20) & 1), ((_a_214 >> 21) & 1), ((_a_214 >> 22) & 1), ((_a_214 >> 23) & 1), ((_a_214 >> 24) & 1), ((_a_214 >> 25) & 1), ((_a_214 >> 26) & 1), ((_a_214 >> 27) & 1), ((_a_214 >> 28) & 1), ((_a_214 >> 29) & 1), ((_a_214 >> 30) & 1), ((_a_214 >> 31) & 1), _a_215) == 0) {
        return 0;
      }
      _v_95 = _o_106[0];
    }
  break;
  }
  o[0] = _v_95;
  return 1;
}

INLINE Term arm_95(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_94 = 0;
  u32 _a_212 = r0;
  Term _a_213 = r1;
  WL_SPIN
    Term _o_107[1];
    if (arm_96(e, _o_107, _a_212, _a_213) == 0) {
      return 0;
    }
    _v_94 = _o_107[0];
  break;
  }
  o[0] = _v_94;
  return 1;
}

INLINE Term arm_94(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_93 = 0;
  Term _a_211 = r0;
  WL_SPIN
    if (term_aux(_a_211) == CID_SCON) {
      Term _fb_29[2];
      u64 _sp_29 = ctr_take(e, _a_211, 2, _fb_29);
      u32 _f_58 = _fb_29[0];
      Term _f_59 = _fb_29[1];
      Term _o_108[1];
      if (arm_95(e, _o_108, _f_58, _f_59) == 0) {
        return 0;
      }
      _v_93 = _o_108[0];
      spare_free(e, cls_fit(2), _sp_29);
    } else {
      Term _o_109[1];
      if (arm_56(e, _o_109, _a_211) == 0) {
        return 0;
      }
      _v_93 = _o_109[0];
    }
  break;
  }
  o[0] = _v_93;
  return 1;
}

INLINE Term arm_93(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_92 = 0;
  u32 _a_209 = r0;
  Term _a_210 = r1;
  WL_SPIN
    if (_a_209 == 105) {
      Term _o_110[1];
      if (arm_94(e, _o_110, _a_210) == 0) {
        return 0;
      }
      _v_92 = _o_110[0];
    } else {
      Term _o_111[1];
      if (arm_57(e, _o_111, ((_a_209 >> 0) & 1), ((_a_209 >> 1) & 1), ((_a_209 >> 2) & 1), ((_a_209 >> 3) & 1), ((_a_209 >> 4) & 1), ((_a_209 >> 5) & 1), ((_a_209 >> 6) & 1), ((_a_209 >> 7) & 1), ((_a_209 >> 8) & 1), ((_a_209 >> 9) & 1), ((_a_209 >> 10) & 1), ((_a_209 >> 11) & 1), ((_a_209 >> 12) & 1), ((_a_209 >> 13) & 1), ((_a_209 >> 14) & 1), ((_a_209 >> 15) & 1), ((_a_209 >> 16) & 1), ((_a_209 >> 17) & 1), ((_a_209 >> 18) & 1), ((_a_209 >> 19) & 1), ((_a_209 >> 20) & 1), ((_a_209 >> 21) & 1), ((_a_209 >> 22) & 1), ((_a_209 >> 23) & 1), ((_a_209 >> 24) & 1), ((_a_209 >> 25) & 1), ((_a_209 >> 26) & 1), ((_a_209 >> 27) & 1), ((_a_209 >> 28) & 1), ((_a_209 >> 29) & 1), ((_a_209 >> 30) & 1), ((_a_209 >> 31) & 1), _a_210) == 0) {
        return 0;
      }
      _v_92 = _o_111[0];
    }
  break;
  }
  o[0] = _v_92;
  return 1;
}

INLINE Term arm_92(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_91 = 0;
  u32 _a_207 = r0;
  Term _a_208 = r1;
  WL_SPIN
    Term _o_112[1];
    if (arm_93(e, _o_112, _a_207, _a_208) == 0) {
      return 0;
    }
    _v_91 = _o_112[0];
  break;
  }
  o[0] = _v_91;
  return 1;
}

INLINE Term arm_91(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_90 = 0;
  Term _a_206 = r0;
  WL_SPIN
    if (term_aux(_a_206) == CID_SCON) {
      Term _fb_28[2];
      u64 _sp_28 = ctr_take(e, _a_206, 2, _fb_28);
      u32 _f_56 = _fb_28[0];
      Term _f_57 = _fb_28[1];
      Term _o_113[1];
      if (arm_92(e, _o_113, _f_56, _f_57) == 0) {
        return 0;
      }
      _v_90 = _o_113[0];
      spare_free(e, cls_fit(2), _sp_28);
    } else {
      Term _o_114[1];
      if (arm_56(e, _o_114, _a_206) == 0) {
        return 0;
      }
      _v_90 = _o_114[0];
    }
  break;
  }
  o[0] = _v_90;
  return 1;
}

INLINE Term arm_90(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_89 = 0;
  u32 _a_204 = r0;
  Term _a_205 = r1;
  WL_SPIN
    if (_a_204 == 97) {
      Term _o_115[1];
      if (arm_91(e, _o_115, _a_205) == 0) {
        return 0;
      }
      _v_89 = _o_115[0];
    } else {
      Term _o_116[1];
      if (arm_57(e, _o_116, ((_a_204 >> 0) & 1), ((_a_204 >> 1) & 1), ((_a_204 >> 2) & 1), ((_a_204 >> 3) & 1), ((_a_204 >> 4) & 1), ((_a_204 >> 5) & 1), ((_a_204 >> 6) & 1), ((_a_204 >> 7) & 1), ((_a_204 >> 8) & 1), ((_a_204 >> 9) & 1), ((_a_204 >> 10) & 1), ((_a_204 >> 11) & 1), ((_a_204 >> 12) & 1), ((_a_204 >> 13) & 1), ((_a_204 >> 14) & 1), ((_a_204 >> 15) & 1), ((_a_204 >> 16) & 1), ((_a_204 >> 17) & 1), ((_a_204 >> 18) & 1), ((_a_204 >> 19) & 1), ((_a_204 >> 20) & 1), ((_a_204 >> 21) & 1), ((_a_204 >> 22) & 1), ((_a_204 >> 23) & 1), ((_a_204 >> 24) & 1), ((_a_204 >> 25) & 1), ((_a_204 >> 26) & 1), ((_a_204 >> 27) & 1), ((_a_204 >> 28) & 1), ((_a_204 >> 29) & 1), ((_a_204 >> 30) & 1), ((_a_204 >> 31) & 1), _a_205) == 0) {
        return 0;
      }
      _v_89 = _o_116[0];
    }
  break;
  }
  o[0] = _v_89;
  return 1;
}

INLINE Term arm_89(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_88 = 0;
  u32 _a_202 = r0;
  Term _a_203 = r1;
  WL_SPIN
    Term _o_117[1];
    if (arm_90(e, _o_117, _a_202, _a_203) == 0) {
      return 0;
    }
    _v_88 = _o_117[0];
  break;
  }
  o[0] = _v_88;
  return 1;
}

INLINE Term arm_88(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_87 = 0;
  Term _a_201 = r0;
  WL_SPIN
    if (term_aux(_a_201) == CID_SCON) {
      Term _fb_27[2];
      u64 _sp_27 = ctr_take(e, _a_201, 2, _fb_27);
      u32 _f_54 = _fb_27[0];
      Term _f_55 = _fb_27[1];
      Term _o_118[1];
      if (arm_89(e, _o_118, _f_54, _f_55) == 0) {
        return 0;
      }
      _v_87 = _o_118[0];
      spare_free(e, cls_fit(2), _sp_27);
    } else {
      Term _o_119[1];
      if (arm_56(e, _o_119, _a_201) == 0) {
        return 0;
      }
      _v_87 = _o_119[0];
    }
  break;
  }
  o[0] = _v_87;
  return 1;
}

INLINE Term arm_105(Env e, THR Term* o, u32 r0, u32 r1, u32 r2, u32 r3, u32 r4, u32 r5, u32 r6, u32 r7, u32 r8, u32 r9, u32 r10, u32 r11, u32 r12, u32 r13, u32 r14, u32 r15, u32 r16, u32 r17, u32 r18, u32 r19, u32 r20, u32 r21, u32 r22, u32 r23, u32 r24, u32 r25, u32 r26, u32 r27, u32 r28, u32 r29, u32 r30, Term r31) {
  u32 wpoll = 0;
  u32 _v_104 = 0;
  u32 _a_227 = r0;
  u32 _a_228 = r1;
  u32 _a_229 = r2;
  u32 _a_230 = r3;
  u32 _a_231 = r4;
  u32 _a_232 = r5;
  u32 _a_233 = r6;
  u32 _a_234 = r7;
  u32 _a_235 = r8;
  u32 _a_236 = r9;
  u32 _a_237 = r10;
  u32 _a_238 = r11;
  u32 _a_239 = r12;
  u32 _a_240 = r13;
  u32 _a_241 = r14;
  u32 _a_242 = r15;
  u32 _a_243 = r16;
  u32 _a_244 = r17;
  u32 _a_245 = r18;
  u32 _a_246 = r19;
  u32 _a_247 = r20;
  u32 _a_248 = r21;
  u32 _a_249 = r22;
  u32 _a_250 = r23;
  u32 _a_251 = r24;
  u32 _a_252 = r25;
  u32 _a_253 = r26;
  u32 _a_254 = r27;
  u32 _a_255 = r28;
  u32 _a_256 = r29;
  u32 _a_257 = r30;
  Term _a_258 = r31;
  WL_SPIN
    term_sink(e, _a_258);
    _v_104 = 0ull;
  break;
  }
  o[0] = _v_104;
  return 1;
}

INLINE Term arm_29(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_28 = 0;
  u32 _a_47 = r0;
  Term _a_48 = r1;
  WL_SPIN
    if (_a_47 == 99) {
      Term _o_42[1];
      if (arm_30(e, _o_42, _a_48) == 0) {
        return 0;
      }
      _v_28 = _o_42[0];
    } else if ((_a_47 & 3) == 3) {
      Term _o_43[1];
      if (arm_58(e, _o_43, ((_a_47 >> 2) & 1), ((_a_47 >> 3) & 1), ((_a_47 >> 4) & 1), ((_a_47 >> 5) & 1), ((_a_47 >> 6) & 1), ((_a_47 >> 7) & 1), ((_a_47 >> 8) & 1), ((_a_47 >> 9) & 1), ((_a_47 >> 10) & 1), ((_a_47 >> 11) & 1), ((_a_47 >> 12) & 1), ((_a_47 >> 13) & 1), ((_a_47 >> 14) & 1), ((_a_47 >> 15) & 1), ((_a_47 >> 16) & 1), ((_a_47 >> 17) & 1), ((_a_47 >> 18) & 1), ((_a_47 >> 19) & 1), ((_a_47 >> 20) & 1), ((_a_47 >> 21) & 1), ((_a_47 >> 22) & 1), ((_a_47 >> 23) & 1), ((_a_47 >> 24) & 1), ((_a_47 >> 25) & 1), ((_a_47 >> 26) & 1), ((_a_47 >> 27) & 1), ((_a_47 >> 28) & 1), ((_a_47 >> 29) & 1), ((_a_47 >> 30) & 1), ((_a_47 >> 31) & 1), _a_48) == 0) {
        return 0;
      }
      _v_28 = _o_43[0];
    } else if (_a_47 == 105) {
      Term _o_91[1];
      if (arm_59(e, _o_91, _a_48) == 0) {
        return 0;
      }
      _v_28 = _o_91[0];
    } else if ((_a_47 & 3) == 1) {
      Term _o_92[1];
      if (arm_58(e, _o_92, ((_a_47 >> 2) & 1), ((_a_47 >> 3) & 1), ((_a_47 >> 4) & 1), ((_a_47 >> 5) & 1), ((_a_47 >> 6) & 1), ((_a_47 >> 7) & 1), ((_a_47 >> 8) & 1), ((_a_47 >> 9) & 1), ((_a_47 >> 10) & 1), ((_a_47 >> 11) & 1), ((_a_47 >> 12) & 1), ((_a_47 >> 13) & 1), ((_a_47 >> 14) & 1), ((_a_47 >> 15) & 1), ((_a_47 >> 16) & 1), ((_a_47 >> 17) & 1), ((_a_47 >> 18) & 1), ((_a_47 >> 19) & 1), ((_a_47 >> 20) & 1), ((_a_47 >> 21) & 1), ((_a_47 >> 22) & 1), ((_a_47 >> 23) & 1), ((_a_47 >> 24) & 1), ((_a_47 >> 25) & 1), ((_a_47 >> 26) & 1), ((_a_47 >> 27) & 1), ((_a_47 >> 28) & 1), ((_a_47 >> 29) & 1), ((_a_47 >> 30) & 1), ((_a_47 >> 31) & 1), _a_48) == 0) {
        return 0;
      }
      _v_28 = _o_92[0];
    } else if (_a_47 == 102) {
      Term _o_120[1];
      if (arm_88(e, _o_120, _a_48) == 0) {
        return 0;
      }
      _v_28 = _o_120[0];
    } else {
      Term _o_121[1];
      if (arm_105(e, _o_121, ((_a_47 >> 1) & 1), ((_a_47 >> 2) & 1), ((_a_47 >> 3) & 1), ((_a_47 >> 4) & 1), ((_a_47 >> 5) & 1), ((_a_47 >> 6) & 1), ((_a_47 >> 7) & 1), ((_a_47 >> 8) & 1), ((_a_47 >> 9) & 1), ((_a_47 >> 10) & 1), ((_a_47 >> 11) & 1), ((_a_47 >> 12) & 1), ((_a_47 >> 13) & 1), ((_a_47 >> 14) & 1), ((_a_47 >> 15) & 1), ((_a_47 >> 16) & 1), ((_a_47 >> 17) & 1), ((_a_47 >> 18) & 1), ((_a_47 >> 19) & 1), ((_a_47 >> 20) & 1), ((_a_47 >> 21) & 1), ((_a_47 >> 22) & 1), ((_a_47 >> 23) & 1), ((_a_47 >> 24) & 1), ((_a_47 >> 25) & 1), ((_a_47 >> 26) & 1), ((_a_47 >> 27) & 1), ((_a_47 >> 28) & 1), ((_a_47 >> 29) & 1), ((_a_47 >> 30) & 1), ((_a_47 >> 31) & 1), _a_48) == 0) {
        return 0;
      }
      _v_28 = _o_121[0];
    }
  break;
  }
  o[0] = _v_28;
  return 1;
}

INLINE Term arm_28(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_27 = 0;
  u32 _a_45 = r0;
  Term _a_46 = r1;
  WL_SPIN
    Term _o_122[1];
    if (arm_29(e, _o_122, _a_45, _a_46) == 0) {
      return 0;
    }
    _v_27 = _o_122[0];
  break;
  }
  o[0] = _v_27;
  return 1;
}

INLINE Term arm_27(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_26 = 0;
  Term _a_44 = r0;
  WL_SPIN
    if (term_aux(_a_44) == CID_SCON) {
      Term _fb_9[2];
      u64 _sp_9 = ctr_take(e, _a_44, 2, _fb_9);
      u32 _f_18 = _fb_9[0];
      Term _f_19 = _fb_9[1];
      Term _o_123[1];
      if (arm_28(e, _o_123, _f_18, _f_19) == 0) {
        return 0;
      }
      _v_26 = _o_123[0];
      spare_free(e, cls_fit(2), _sp_9);
    } else {
      Term _o_124[1];
      if (arm_56(e, _o_124, _a_44) == 0) {
        return 0;
      }
      _v_26 = _o_124[0];
    }
  break;
  }
  o[0] = _v_26;
  return 1;
}

INLINE Term arm_26(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_25 = 0;
  u32 _a_42 = r0;
  Term _a_43 = r1;
  WL_SPIN
    if (_a_42 == 46) {
      Term _o_125[1];
      if (arm_27(e, _o_125, _a_43) == 0) {
        return 0;
      }
      _v_25 = _o_125[0];
    } else {
      Term _o_126[1];
      if (arm_57(e, _o_126, ((_a_42 >> 0) & 1), ((_a_42 >> 1) & 1), ((_a_42 >> 2) & 1), ((_a_42 >> 3) & 1), ((_a_42 >> 4) & 1), ((_a_42 >> 5) & 1), ((_a_42 >> 6) & 1), ((_a_42 >> 7) & 1), ((_a_42 >> 8) & 1), ((_a_42 >> 9) & 1), ((_a_42 >> 10) & 1), ((_a_42 >> 11) & 1), ((_a_42 >> 12) & 1), ((_a_42 >> 13) & 1), ((_a_42 >> 14) & 1), ((_a_42 >> 15) & 1), ((_a_42 >> 16) & 1), ((_a_42 >> 17) & 1), ((_a_42 >> 18) & 1), ((_a_42 >> 19) & 1), ((_a_42 >> 20) & 1), ((_a_42 >> 21) & 1), ((_a_42 >> 22) & 1), ((_a_42 >> 23) & 1), ((_a_42 >> 24) & 1), ((_a_42 >> 25) & 1), ((_a_42 >> 26) & 1), ((_a_42 >> 27) & 1), ((_a_42 >> 28) & 1), ((_a_42 >> 29) & 1), ((_a_42 >> 30) & 1), ((_a_42 >> 31) & 1), _a_43) == 0) {
        return 0;
      }
      _v_25 = _o_126[0];
    }
  break;
  }
  o[0] = _v_25;
  return 1;
}

INLINE Term arm_25(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_24 = 0;
  u32 _a_40 = r0;
  Term _a_41 = r1;
  WL_SPIN
    Term _o_127[1];
    if (arm_26(e, _o_127, _a_40, _a_41) == 0) {
      return 0;
    }
    _v_24 = _o_127[0];
  break;
  }
  o[0] = _v_24;
  return 1;
}

INLINE Term arm_24(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_23 = 0;
  Term _a_39 = r0;
  WL_SPIN
    if (term_aux(_a_39) == CID_SCON) {
      Term _fb_8[2];
      u64 _sp_8 = ctr_take(e, _a_39, 2, _fb_8);
      u32 _f_16 = _fb_8[0];
      Term _f_17 = _fb_8[1];
      Term _o_128[1];
      if (arm_25(e, _o_128, _f_16, _f_17) == 0) {
        return 0;
      }
      _v_23 = _o_128[0];
      spare_free(e, cls_fit(2), _sp_8);
    } else {
      Term _o_129[1];
      if (arm_56(e, _o_129, _a_39) == 0) {
        return 0;
      }
      _v_23 = _o_129[0];
    }
  break;
  }
  o[0] = _v_23;
  return 1;
}

INLINE Term arm_23(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_22 = 0;
  u32 _a_37 = r0;
  Term _a_38 = r1;
  WL_SPIN
    if (_a_37 == 101) {
      Term _o_130[1];
      if (arm_24(e, _o_130, _a_38) == 0) {
        return 0;
      }
      _v_22 = _o_130[0];
    } else {
      Term _o_131[1];
      if (arm_57(e, _o_131, ((_a_37 >> 0) & 1), ((_a_37 >> 1) & 1), ((_a_37 >> 2) & 1), ((_a_37 >> 3) & 1), ((_a_37 >> 4) & 1), ((_a_37 >> 5) & 1), ((_a_37 >> 6) & 1), ((_a_37 >> 7) & 1), ((_a_37 >> 8) & 1), ((_a_37 >> 9) & 1), ((_a_37 >> 10) & 1), ((_a_37 >> 11) & 1), ((_a_37 >> 12) & 1), ((_a_37 >> 13) & 1), ((_a_37 >> 14) & 1), ((_a_37 >> 15) & 1), ((_a_37 >> 16) & 1), ((_a_37 >> 17) & 1), ((_a_37 >> 18) & 1), ((_a_37 >> 19) & 1), ((_a_37 >> 20) & 1), ((_a_37 >> 21) & 1), ((_a_37 >> 22) & 1), ((_a_37 >> 23) & 1), ((_a_37 >> 24) & 1), ((_a_37 >> 25) & 1), ((_a_37 >> 26) & 1), ((_a_37 >> 27) & 1), ((_a_37 >> 28) & 1), ((_a_37 >> 29) & 1), ((_a_37 >> 30) & 1), ((_a_37 >> 31) & 1), _a_38) == 0) {
        return 0;
      }
      _v_22 = _o_131[0];
    }
  break;
  }
  o[0] = _v_22;
  return 1;
}

INLINE Term arm_22(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_21 = 0;
  u32 _a_35 = r0;
  Term _a_36 = r1;
  WL_SPIN
    Term _o_132[1];
    if (arm_23(e, _o_132, _a_35, _a_36) == 0) {
      return 0;
    }
    _v_21 = _o_132[0];
  break;
  }
  o[0] = _v_21;
  return 1;
}

INLINE Term arm_21(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_20 = 0;
  Term _a_34 = r0;
  WL_SPIN
    if (term_aux(_a_34) == CID_SCON) {
      Term _fb_7[2];
      u64 _sp_7 = ctr_take(e, _a_34, 2, _fb_7);
      u32 _f_14 = _fb_7[0];
      Term _f_15 = _fb_7[1];
      Term _o_133[1];
      if (arm_22(e, _o_133, _f_14, _f_15) == 0) {
        return 0;
      }
      _v_20 = _o_133[0];
      spare_free(e, cls_fit(2), _sp_7);
    } else {
      Term _o_134[1];
      if (arm_56(e, _o_134, _a_34) == 0) {
        return 0;
      }
      _v_20 = _o_134[0];
    }
  break;
  }
  o[0] = _v_20;
  return 1;
}

INLINE Term arm_20(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_19 = 0;
  u32 _a_32 = r0;
  Term _a_33 = r1;
  WL_SPIN
    if (_a_32 == 115) {
      Term _o_135[1];
      if (arm_21(e, _o_135, _a_33) == 0) {
        return 0;
      }
      _v_19 = _o_135[0];
    } else {
      Term _o_136[1];
      if (arm_57(e, _o_136, ((_a_32 >> 0) & 1), ((_a_32 >> 1) & 1), ((_a_32 >> 2) & 1), ((_a_32 >> 3) & 1), ((_a_32 >> 4) & 1), ((_a_32 >> 5) & 1), ((_a_32 >> 6) & 1), ((_a_32 >> 7) & 1), ((_a_32 >> 8) & 1), ((_a_32 >> 9) & 1), ((_a_32 >> 10) & 1), ((_a_32 >> 11) & 1), ((_a_32 >> 12) & 1), ((_a_32 >> 13) & 1), ((_a_32 >> 14) & 1), ((_a_32 >> 15) & 1), ((_a_32 >> 16) & 1), ((_a_32 >> 17) & 1), ((_a_32 >> 18) & 1), ((_a_32 >> 19) & 1), ((_a_32 >> 20) & 1), ((_a_32 >> 21) & 1), ((_a_32 >> 22) & 1), ((_a_32 >> 23) & 1), ((_a_32 >> 24) & 1), ((_a_32 >> 25) & 1), ((_a_32 >> 26) & 1), ((_a_32 >> 27) & 1), ((_a_32 >> 28) & 1), ((_a_32 >> 29) & 1), ((_a_32 >> 30) & 1), ((_a_32 >> 31) & 1), _a_33) == 0) {
        return 0;
      }
      _v_19 = _o_136[0];
    }
  break;
  }
  o[0] = _v_19;
  return 1;
}

INLINE Term arm_19(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_18 = 0;
  u32 _a_30 = r0;
  Term _a_31 = r1;
  WL_SPIN
    Term _o_137[1];
    if (arm_20(e, _o_137, _a_30, _a_31) == 0) {
      return 0;
    }
    _v_18 = _o_137[0];
  break;
  }
  o[0] = _v_18;
  return 1;
}

INLINE Term arm_18(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_17 = 0;
  Term _a_29 = r0;
  WL_SPIN
    if (term_aux(_a_29) == CID_SCON) {
      Term _fb_6[2];
      u64 _sp_6 = ctr_take(e, _a_29, 2, _fb_6);
      u32 _f_12 = _fb_6[0];
      Term _f_13 = _fb_6[1];
      Term _o_138[1];
      if (arm_19(e, _o_138, _f_12, _f_13) == 0) {
        return 0;
      }
      _v_17 = _o_138[0];
      spare_free(e, cls_fit(2), _sp_6);
    } else {
      Term _o_139[1];
      if (arm_56(e, _o_139, _a_29) == 0) {
        return 0;
      }
      _v_17 = _o_139[0];
    }
  break;
  }
  o[0] = _v_17;
  return 1;
}

INLINE Term arm_17(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_16 = 0;
  u32 _a_27 = r0;
  Term _a_28 = r1;
  WL_SPIN
    if (_a_27 == 110) {
      Term _o_140[1];
      if (arm_18(e, _o_140, _a_28) == 0) {
        return 0;
      }
      _v_16 = _o_140[0];
    } else {
      Term _o_141[1];
      if (arm_57(e, _o_141, ((_a_27 >> 0) & 1), ((_a_27 >> 1) & 1), ((_a_27 >> 2) & 1), ((_a_27 >> 3) & 1), ((_a_27 >> 4) & 1), ((_a_27 >> 5) & 1), ((_a_27 >> 6) & 1), ((_a_27 >> 7) & 1), ((_a_27 >> 8) & 1), ((_a_27 >> 9) & 1), ((_a_27 >> 10) & 1), ((_a_27 >> 11) & 1), ((_a_27 >> 12) & 1), ((_a_27 >> 13) & 1), ((_a_27 >> 14) & 1), ((_a_27 >> 15) & 1), ((_a_27 >> 16) & 1), ((_a_27 >> 17) & 1), ((_a_27 >> 18) & 1), ((_a_27 >> 19) & 1), ((_a_27 >> 20) & 1), ((_a_27 >> 21) & 1), ((_a_27 >> 22) & 1), ((_a_27 >> 23) & 1), ((_a_27 >> 24) & 1), ((_a_27 >> 25) & 1), ((_a_27 >> 26) & 1), ((_a_27 >> 27) & 1), ((_a_27 >> 28) & 1), ((_a_27 >> 29) & 1), ((_a_27 >> 30) & 1), ((_a_27 >> 31) & 1), _a_28) == 0) {
        return 0;
      }
      _v_16 = _o_141[0];
    }
  break;
  }
  o[0] = _v_16;
  return 1;
}

INLINE Term arm_16(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_15 = 0;
  u32 _a_25 = r0;
  Term _a_26 = r1;
  WL_SPIN
    Term _o_142[1];
    if (arm_17(e, _o_142, _a_25, _a_26) == 0) {
      return 0;
    }
    _v_15 = _o_142[0];
  break;
  }
  o[0] = _v_15;
  return 1;
}

INLINE Term arm_15(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_14 = 0;
  Term _a_24 = r0;
  WL_SPIN
    if (term_aux(_a_24) == CID_SCON) {
      Term _fb_5[2];
      u64 _sp_5 = ctr_take(e, _a_24, 2, _fb_5);
      u32 _f_10 = _fb_5[0];
      Term _f_11 = _fb_5[1];
      Term _o_143[1];
      if (arm_16(e, _o_143, _f_10, _f_11) == 0) {
        return 0;
      }
      _v_14 = _o_143[0];
      spare_free(e, cls_fit(2), _sp_5);
    } else {
      Term _o_144[1];
      if (arm_56(e, _o_144, _a_24) == 0) {
        return 0;
      }
      _v_14 = _o_144[0];
    }
  break;
  }
  o[0] = _v_14;
  return 1;
}

INLINE Term arm_14(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_13 = 0;
  u32 _a_22 = r0;
  Term _a_23 = r1;
  WL_SPIN
    if (_a_22 == 111) {
      Term _o_145[1];
      if (arm_15(e, _o_145, _a_23) == 0) {
        return 0;
      }
      _v_13 = _o_145[0];
    } else {
      Term _o_146[1];
      if (arm_57(e, _o_146, ((_a_22 >> 0) & 1), ((_a_22 >> 1) & 1), ((_a_22 >> 2) & 1), ((_a_22 >> 3) & 1), ((_a_22 >> 4) & 1), ((_a_22 >> 5) & 1), ((_a_22 >> 6) & 1), ((_a_22 >> 7) & 1), ((_a_22 >> 8) & 1), ((_a_22 >> 9) & 1), ((_a_22 >> 10) & 1), ((_a_22 >> 11) & 1), ((_a_22 >> 12) & 1), ((_a_22 >> 13) & 1), ((_a_22 >> 14) & 1), ((_a_22 >> 15) & 1), ((_a_22 >> 16) & 1), ((_a_22 >> 17) & 1), ((_a_22 >> 18) & 1), ((_a_22 >> 19) & 1), ((_a_22 >> 20) & 1), ((_a_22 >> 21) & 1), ((_a_22 >> 22) & 1), ((_a_22 >> 23) & 1), ((_a_22 >> 24) & 1), ((_a_22 >> 25) & 1), ((_a_22 >> 26) & 1), ((_a_22 >> 27) & 1), ((_a_22 >> 28) & 1), ((_a_22 >> 29) & 1), ((_a_22 >> 30) & 1), ((_a_22 >> 31) & 1), _a_23) == 0) {
        return 0;
      }
      _v_13 = _o_146[0];
    }
  break;
  }
  o[0] = _v_13;
  return 1;
}

INLINE Term arm_13(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_12 = 0;
  u32 _a_20 = r0;
  Term _a_21 = r1;
  WL_SPIN
    Term _o_147[1];
    if (arm_14(e, _o_147, _a_20, _a_21) == 0) {
      return 0;
    }
    _v_12 = _o_147[0];
  break;
  }
  o[0] = _v_12;
  return 1;
}

INLINE Term arm_12(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_11 = 0;
  Term _a_19 = r0;
  WL_SPIN
    if (term_aux(_a_19) == CID_SCON) {
      Term _fb_4[2];
      u64 _sp_4 = ctr_take(e, _a_19, 2, _fb_4);
      u32 _f_8 = _fb_4[0];
      Term _f_9 = _fb_4[1];
      Term _o_148[1];
      if (arm_13(e, _o_148, _f_8, _f_9) == 0) {
        return 0;
      }
      _v_11 = _o_148[0];
      spare_free(e, cls_fit(2), _sp_4);
    } else {
      Term _o_149[1];
      if (arm_56(e, _o_149, _a_19) == 0) {
        return 0;
      }
      _v_11 = _o_149[0];
    }
  break;
  }
  o[0] = _v_11;
  return 1;
}

INLINE Term arm_11(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_10 = 0;
  u32 _a_17 = r0;
  Term _a_18 = r1;
  WL_SPIN
    if (_a_17 == 112) {
      Term _o_150[1];
      if (arm_12(e, _o_150, _a_18) == 0) {
        return 0;
      }
      _v_10 = _o_150[0];
    } else {
      Term _o_151[1];
      if (arm_57(e, _o_151, ((_a_17 >> 0) & 1), ((_a_17 >> 1) & 1), ((_a_17 >> 2) & 1), ((_a_17 >> 3) & 1), ((_a_17 >> 4) & 1), ((_a_17 >> 5) & 1), ((_a_17 >> 6) & 1), ((_a_17 >> 7) & 1), ((_a_17 >> 8) & 1), ((_a_17 >> 9) & 1), ((_a_17 >> 10) & 1), ((_a_17 >> 11) & 1), ((_a_17 >> 12) & 1), ((_a_17 >> 13) & 1), ((_a_17 >> 14) & 1), ((_a_17 >> 15) & 1), ((_a_17 >> 16) & 1), ((_a_17 >> 17) & 1), ((_a_17 >> 18) & 1), ((_a_17 >> 19) & 1), ((_a_17 >> 20) & 1), ((_a_17 >> 21) & 1), ((_a_17 >> 22) & 1), ((_a_17 >> 23) & 1), ((_a_17 >> 24) & 1), ((_a_17 >> 25) & 1), ((_a_17 >> 26) & 1), ((_a_17 >> 27) & 1), ((_a_17 >> 28) & 1), ((_a_17 >> 29) & 1), ((_a_17 >> 30) & 1), ((_a_17 >> 31) & 1), _a_18) == 0) {
        return 0;
      }
      _v_10 = _o_151[0];
    }
  break;
  }
  o[0] = _v_10;
  return 1;
}

INLINE Term arm_10(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_9 = 0;
  u32 _a_15 = r0;
  Term _a_16 = r1;
  WL_SPIN
    Term _o_152[1];
    if (arm_11(e, _o_152, _a_15, _a_16) == 0) {
      return 0;
    }
    _v_9 = _o_152[0];
  break;
  }
  o[0] = _v_9;
  return 1;
}

INLINE Term arm_9(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_8 = 0;
  Term _a_14 = r0;
  WL_SPIN
    if (term_aux(_a_14) == CID_SCON) {
      Term _fb_3[2];
      u64 _sp_3 = ctr_take(e, _a_14, 2, _fb_3);
      u32 _f_6 = _fb_3[0];
      Term _f_7 = _fb_3[1];
      Term _o_153[1];
      if (arm_10(e, _o_153, _f_6, _f_7) == 0) {
        return 0;
      }
      _v_8 = _o_153[0];
      spare_free(e, cls_fit(2), _sp_3);
    } else {
      Term _o_154[1];
      if (arm_56(e, _o_154, _a_14) == 0) {
        return 0;
      }
      _v_8 = _o_154[0];
    }
  break;
  }
  o[0] = _v_8;
  return 1;
}

INLINE Term arm_8(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_7 = 0;
  u32 _a_12 = r0;
  Term _a_13 = r1;
  WL_SPIN
    if (_a_12 == 115) {
      Term _o_155[1];
      if (arm_9(e, _o_155, _a_13) == 0) {
        return 0;
      }
      _v_7 = _o_155[0];
    } else {
      Term _o_156[1];
      if (arm_57(e, _o_156, ((_a_12 >> 0) & 1), ((_a_12 >> 1) & 1), ((_a_12 >> 2) & 1), ((_a_12 >> 3) & 1), ((_a_12 >> 4) & 1), ((_a_12 >> 5) & 1), ((_a_12 >> 6) & 1), ((_a_12 >> 7) & 1), ((_a_12 >> 8) & 1), ((_a_12 >> 9) & 1), ((_a_12 >> 10) & 1), ((_a_12 >> 11) & 1), ((_a_12 >> 12) & 1), ((_a_12 >> 13) & 1), ((_a_12 >> 14) & 1), ((_a_12 >> 15) & 1), ((_a_12 >> 16) & 1), ((_a_12 >> 17) & 1), ((_a_12 >> 18) & 1), ((_a_12 >> 19) & 1), ((_a_12 >> 20) & 1), ((_a_12 >> 21) & 1), ((_a_12 >> 22) & 1), ((_a_12 >> 23) & 1), ((_a_12 >> 24) & 1), ((_a_12 >> 25) & 1), ((_a_12 >> 26) & 1), ((_a_12 >> 27) & 1), ((_a_12 >> 28) & 1), ((_a_12 >> 29) & 1), ((_a_12 >> 30) & 1), ((_a_12 >> 31) & 1), _a_13) == 0) {
        return 0;
      }
      _v_7 = _o_156[0];
    }
  break;
  }
  o[0] = _v_7;
  return 1;
}

INLINE Term arm_7(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_6 = 0;
  u32 _a_10 = r0;
  Term _a_11 = r1;
  WL_SPIN
    Term _o_157[1];
    if (arm_8(e, _o_157, _a_10, _a_11) == 0) {
      return 0;
    }
    _v_6 = _o_157[0];
  break;
  }
  o[0] = _v_6;
  return 1;
}

INLINE Term arm_6(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_5 = 0;
  Term _a_9 = r0;
  WL_SPIN
    if (term_aux(_a_9) == CID_SCON) {
      Term _fb_2[2];
      u64 _sp_2 = ctr_take(e, _a_9, 2, _fb_2);
      u32 _f_4 = _fb_2[0];
      Term _f_5 = _fb_2[1];
      Term _o_158[1];
      if (arm_7(e, _o_158, _f_4, _f_5) == 0) {
        return 0;
      }
      _v_5 = _o_158[0];
      spare_free(e, cls_fit(2), _sp_2);
    } else {
      Term _o_159[1];
      if (arm_56(e, _o_159, _a_9) == 0) {
        return 0;
      }
      _v_5 = _o_159[0];
    }
  break;
  }
  o[0] = _v_5;
  return 1;
}

INLINE Term arm_5(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_4 = 0;
  u32 _a_7 = r0;
  Term _a_8 = r1;
  WL_SPIN
    if (_a_7 == 101) {
      Term _o_160[1];
      if (arm_6(e, _o_160, _a_8) == 0) {
        return 0;
      }
      _v_4 = _o_160[0];
    } else {
      Term _o_161[1];
      if (arm_57(e, _o_161, ((_a_7 >> 0) & 1), ((_a_7 >> 1) & 1), ((_a_7 >> 2) & 1), ((_a_7 >> 3) & 1), ((_a_7 >> 4) & 1), ((_a_7 >> 5) & 1), ((_a_7 >> 6) & 1), ((_a_7 >> 7) & 1), ((_a_7 >> 8) & 1), ((_a_7 >> 9) & 1), ((_a_7 >> 10) & 1), ((_a_7 >> 11) & 1), ((_a_7 >> 12) & 1), ((_a_7 >> 13) & 1), ((_a_7 >> 14) & 1), ((_a_7 >> 15) & 1), ((_a_7 >> 16) & 1), ((_a_7 >> 17) & 1), ((_a_7 >> 18) & 1), ((_a_7 >> 19) & 1), ((_a_7 >> 20) & 1), ((_a_7 >> 21) & 1), ((_a_7 >> 22) & 1), ((_a_7 >> 23) & 1), ((_a_7 >> 24) & 1), ((_a_7 >> 25) & 1), ((_a_7 >> 26) & 1), ((_a_7 >> 27) & 1), ((_a_7 >> 28) & 1), ((_a_7 >> 29) & 1), ((_a_7 >> 30) & 1), ((_a_7 >> 31) & 1), _a_8) == 0) {
        return 0;
      }
      _v_4 = _o_161[0];
    }
  break;
  }
  o[0] = _v_4;
  return 1;
}

INLINE Term arm_4(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_3 = 0;
  u32 _a_5 = r0;
  Term _a_6 = r1;
  WL_SPIN
    Term _o_162[1];
    if (arm_5(e, _o_162, _a_5, _a_6) == 0) {
      return 0;
    }
    _v_3 = _o_162[0];
  break;
  }
  o[0] = _v_3;
  return 1;
}

INLINE Term arm_3(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_2 = 0;
  Term _a_4 = r0;
  WL_SPIN
    if (term_aux(_a_4) == CID_SCON) {
      Term _fb_1[2];
      u64 _sp_1 = ctr_take(e, _a_4, 2, _fb_1);
      u32 _f_2 = _fb_1[0];
      Term _f_3 = _fb_1[1];
      Term _o_163[1];
      if (arm_4(e, _o_163, _f_2, _f_3) == 0) {
        return 0;
      }
      _v_2 = _o_163[0];
      spare_free(e, cls_fit(2), _sp_1);
    } else {
      Term _o_164[1];
      if (arm_56(e, _o_164, _a_4) == 0) {
        return 0;
      }
      _v_2 = _o_164[0];
    }
  break;
  }
  o[0] = _v_2;
  return 1;
}

INLINE Term arm_2(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_1 = 0;
  u32 _a_2 = r0;
  Term _a_3 = r1;
  WL_SPIN
    if (_a_2 == 114) {
      Term _o_165[1];
      if (arm_3(e, _o_165, _a_3) == 0) {
        return 0;
      }
      _v_1 = _o_165[0];
    } else {
      Term _o_166[1];
      if (arm_57(e, _o_166, ((_a_2 >> 0) & 1), ((_a_2 >> 1) & 1), ((_a_2 >> 2) & 1), ((_a_2 >> 3) & 1), ((_a_2 >> 4) & 1), ((_a_2 >> 5) & 1), ((_a_2 >> 6) & 1), ((_a_2 >> 7) & 1), ((_a_2 >> 8) & 1), ((_a_2 >> 9) & 1), ((_a_2 >> 10) & 1), ((_a_2 >> 11) & 1), ((_a_2 >> 12) & 1), ((_a_2 >> 13) & 1), ((_a_2 >> 14) & 1), ((_a_2 >> 15) & 1), ((_a_2 >> 16) & 1), ((_a_2 >> 17) & 1), ((_a_2 >> 18) & 1), ((_a_2 >> 19) & 1), ((_a_2 >> 20) & 1), ((_a_2 >> 21) & 1), ((_a_2 >> 22) & 1), ((_a_2 >> 23) & 1), ((_a_2 >> 24) & 1), ((_a_2 >> 25) & 1), ((_a_2 >> 26) & 1), ((_a_2 >> 27) & 1), ((_a_2 >> 28) & 1), ((_a_2 >> 29) & 1), ((_a_2 >> 30) & 1), ((_a_2 >> 31) & 1), _a_3) == 0) {
        return 0;
      }
      _v_1 = _o_166[0];
    }
  break;
  }
  o[0] = _v_1;
  return 1;
}

INLINE Term arm_1(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_0 = 0;
  u32 _a_0 = r0;
  Term _a_1 = r1;
  WL_SPIN
    Term _o_167[1];
    if (arm_2(e, _o_167, _a_0, _a_1) == 0) {
      return 0;
    }
    _v_0 = _o_167[0];
  break;
  }
  o[0] = _v_0;
  return 1;
}

INLINE Term arm_106(Env e, THR Term* o) {
  u32 wpoll = 0;
  Term _v_0 = 0;
  WL_SPIN
    _v_0 = term_pak(CID_SNIL, 0);
  break;
  }
  o[0] = _v_0;
  return 1;
}

INLINE Term spin_0(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_3 = 0;
  Term _s_0 = r0;
  WL_SPIN
    if (term_aux(_s_0) == CID_SCON) {
      Term _fb_1[2];
      u64 _sp_1 = ctr_take(e, _s_0, 2, _fb_1);
      u32 _f_2 = _fb_1[0];
      Term _f_3 = _fb_1[1];
      Term _o_1[1];
      if (arm_1(e, _o_1, _f_2, _f_3) == 0) {
        return 0;
      }
      _v_3 = _o_1[0];
      spare_free(e, cls_fit(2), _sp_1);
    } else {
      Term _o_2[1];
      if (arm_56(e, _o_2, _s_0) == 0) {
        return 0;
      }
      _v_3 = _o_2[0];
    }
  break;
  }
  o[0] = _v_3;
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
  WL_CASE(FID_U32_SHOW_GO)
  {
    Term _f_0 = r0;
    u32 _n_0 = r1;
    Term _acc_0 = r2;
    WL_OPEN
    WL_SPIN
    if (_f_0 == 0) {
      r0 = _acc_0;
      WL_RETN(1);
    } else {
      Term _g_0 = (_f_0 - 1);
      u32 _s_0 = U32_BIN(_n_0, ==, 0);
      if (_s_0 == 1) {
        r0 = _acc_0;
        WL_RETN(1);
      } else {
        Term _a_0 = 10ull;
        Term _a_1 = 10ull;
        u64 _nd_0 = heap_alloc(e, cls_fit(2));
        e.mem[_nd_0 + 0] = U32_BIN(48ull, +, ((u32)(_a_1) == 0 ? _n_0 : U32_BIN(_n_0, -, U32_QUO((u32)(_n_0), (u32)(_a_1)) * _a_1)));
        e.mem[_nd_0 + 1] = _acc_0;
        r0 = _g_0;
        r1 = ((u32)(_a_0) == 0 ? 0 : (u64)U32_QUO((u32)(_n_0), (u32)(_a_0)));
        r2 = term_ctr(CID_SCON, _nd_0);
        _f_0 = r0;
        _n_0 = r1;
        _acc_0 = r2;
        WL_AGAIN(FID_U32_SHOW_GO);
      }
    }
    WL_SPUN
  }}
#endif

#if !DEVICE
  WL_CASE(FID_U32_SHOW)
  {
    u32 _a_0 = r0;
    WL_OPEN
    u32 _s_0 = U32_BIN(_a_0, ==, 0);
    if (_s_0 == 1) {
      Term _o_0[1];
      if (arm_0(e, _o_0) == 0) {
        return 0;
      }
      r0 = _o_0[0];
      WL_RETN(1);
    } else {
      if (!DEVICE && !seq && fid_nofk(FID_U32_SHOW_GO)) {
        u64 _t_0 = task_node(e, FID_U32_SHOW_GO, WL_CONT, WL_IDX, 0);
        e.mem[_t_0 + 0] = 10ull;
        e.mem[_t_0 + 1] = _a_0;
        e.mem[_t_0 + 2] = term_pak(CID_SNIL, 0);
        return term_tsk(FID_U32_SHOW_GO, _t_0);
      }
      r0 = 10ull;
      r1 = _a_0;
      r2 = term_pak(CID_SNIL, 0);
      WL_JMP(FID_U32_SHOW_GO);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SHOW_ALL)
  {
    Term _ss_0 = r0;
    WL_OPEN
    if (term_aux(_ss_0) == CID_NIL) {
      Term _o_0[1];
      if (arm_106(e, _o_0) == 0) {
        return 0;
      }
      r0 = _o_0[0];
      WL_RETN(1);
    } else {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _ss_0, 2, _fb_0);
      Term _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      u32 _v_1 = 0;
      u32 _v_2 = 0;
      Term _o_3[1];
      if (spin_0(e, _o_3, _f_0) == 0) {
        return 0;
      }
      _v_2 = _o_3[0];
      _v_1 = _v_2;
      spare_free(e, cls_fit(2), _sp_0);
      if (seq) {
        WL_ROOM(2);
        STK(0) = _f_1;
        STK(1) = FID_SHOW_ALL_K113;
        WL_PUSHN(2);
      } else {
        u64 _t_0 = task_node(e, FID_SHOW_ALL_K113, WL_CONT, WL_IDX, 1);
        e.mem[_t_0 + 0] = _f_1;
        WL_CONT = term_tsk(FID_SHOW_ALL_K113, _t_0);
        WL_IDX = 1;
      }
      if (!DEVICE && !seq && fid_nofk(FID_U32_SHOW)) {
        u64 _t_1 = task_node(e, FID_U32_SHOW, WL_CONT, WL_IDX, 0);
        e.mem[_t_1 + 0] = _v_1;
        return term_tsk(FID_U32_SHOW, _t_1);
      }
      r0 = _v_1;
      WL_JMP(FID_U32_SHOW);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SHOW_ALL_K113)
  {
    WL_POPN(1);
    Term _f_4 = STK(0);
    Term _h_0 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _h_0;
      STK(1) = FID_SHOW_ALL_K114;
      WL_PUSHN(2);
    } else {
      u64 _t_2 = task_node(e, FID_SHOW_ALL_K114, WL_CONT, WL_IDX, 1);
      e.mem[_t_2 + 0] = _h_0;
      WL_CONT = term_tsk(FID_SHOW_ALL_K114, _t_2);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID_SHOW_ALL)) {
      u64 _t_3 = task_node(e, FID_SHOW_ALL, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _f_4;
      return term_tsk(FID_SHOW_ALL, _t_3);
    }
    r0 = _f_4;
    WL_JMP(FID_SHOW_ALL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SHOW_ALL_K114)
  {
    WL_POPN(1);
    Term _h_1 = STK(0);
    Term _h_2 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _h_1;
      STK(1) = FID_SHOW_ALL_K115;
      WL_PUSHN(2);
    } else {
      u64 _t_4 = task_node(e, FID_SHOW_ALL_K115, WL_CONT, WL_IDX, 1);
      e.mem[_t_4 + 0] = _h_1;
      WL_CONT = term_tsk(FID_SHOW_ALL_K115, _t_4);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID_STRING_APPEND)) {
      u64 _t_5 = task_node(e, FID_STRING_APPEND, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = term_ctr(CID_SCON, STAT_OFF + 2);
      e.mem[_t_5 + 1] = _h_2;
      return term_tsk(FID_STRING_APPEND, _t_5);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 2);
    r1 = _h_2;
    WL_JMP(FID_STRING_APPEND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SHOW_ALL_K115)
  {
    WL_POPN(1);
    Term _h_3 = STK(0);
    Term _h_4 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_STRING_APPEND)) {
      u64 _t_6 = task_node(e, FID_STRING_APPEND, WL_CONT, WL_IDX, 0);
      e.mem[_t_6 + 0] = _h_3;
      e.mem[_t_6 + 1] = _h_4;
      return term_tsk(FID_STRING_APPEND, _t_6);
    }
    r0 = _h_3;
    r1 = _h_4;
    WL_JMP(FID_STRING_APPEND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_STRING_APPEND)
  {
    Term _a_0 = r0;
    Term _b_0 = r1;
    WL_OPEN
    WL_SPIN
    if (term_aux(_a_0) == CID_SNIL) {
      r0 = _b_0;
      WL_RETN(1);
    } else {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _a_0, 2, _fb_0);
      u32 _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      spare_free(e, cls_fit(2), _sp_0);
      if (seq) {
        WL_ROOM(2);
        STK(0) = _f_0;
        STK(1) = FID_STRING_APPEND_K117;
        WL_PUSHN(2);
      } else {
        u64 _t_0 = task_node(e, FID_STRING_APPEND_K117, WL_CONT, WL_IDX, 1);
        e.mem[_t_0 + 0] = _f_0;
        WL_CONT = term_tsk(FID_STRING_APPEND_K117, _t_0);
        WL_IDX = 1;
      }
      r0 = _f_1;
      r1 = _b_0;
      _a_0 = r0;
      _b_0 = r1;
      WL_AGAIN(FID_STRING_APPEND);
    }
    WL_SPUN
  }}
#endif

#if !DEVICE
  WL_CASE(FID_STRING_APPEND_K117)
  {
    WL_POPN(1);
    u32 _f_2 = STK(0);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_0 + 0] = _f_2;
    e.mem[_nd_0 + 1] = _h_0;
    r0 = term_ctr(CID_SCON, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN)
  {
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_MAIN_K119;
      WL_PUSHN(1);
    } else {
      u64 _t_0 = task_node(e, FID_MAIN_K119, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_MAIN_K119, _t_0);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID_SHOW_ALL)) {
      u64 _t_1 = task_node(e, FID_SHOW_ALL, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = term_ctr(CID_CON, STAT_OFF + 144);
      return term_tsk(FID_SHOW_ALL, _t_1);
    }
    r0 = term_ctr(CID_CON, STAT_OFF + 144);
    WL_JMP(FID_SHOW_ALL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K119)
  {
    Term _h_0 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _h_0;
      STK(1) = FID_MAIN_K120;
      WL_PUSHN(2);
    } else {
      u64 _t_2 = task_node(e, FID_MAIN_K120, WL_CONT, WL_IDX, 1);
      e.mem[_t_2 + 0] = _h_0;
      WL_CONT = term_tsk(FID_MAIN_K120, _t_2);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID_U32_SHOW)) {
      u64 _t_3 = task_node(e, FID_U32_SHOW, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = 0ull;
      return term_tsk(FID_U32_SHOW, _t_3);
    }
    r0 = 0ull;
    WL_JMP(FID_U32_SHOW);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K120)
  {
    WL_POPN(1);
    Term _h_1 = STK(0);
    Term _h_2 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_MAIN_K121;
      WL_PUSHN(1);
    } else {
      u64 _t_4 = task_node(e, FID_MAIN_K121, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_MAIN_K121, _t_4);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID_STRING_APPEND)) {
      u64 _t_5 = task_node(e, FID_STRING_APPEND, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _h_1;
      e.mem[_t_5 + 1] = _h_2;
      return term_tsk(FID_STRING_APPEND, _t_5);
    }
    r0 = _h_1;
    r1 = _h_2;
    WL_JMP(FID_STRING_APPEND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K121)
  {
    Term _h_3 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_0 + 0] = _h_3;
    r0 = term_clo(FID_IO_PRINT, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_PRINT)
  {
    Term _text_0 = r0;
    Term _k_0 = r1;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_1 + 0] = _text_0;
    e.mem[_nd_1 + 1] = _k_0;
    r0 = term_ctr(CID_IO_PRINT, _nd_1);
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

void io_print(const char* data, uint64_t len) {
  io_out(stdout, data, len);
  io_out(stdout, "\n", 1);
}

Term io_print_run(Env e, Term* f, IoWork* w) {
  uint64_t n = 0;
  char* text = io_cstr(e, f[0], &n);
  io_print(text, n);
  free(text);
  return term_pak(CID_UNIT, 0);
}

static void __attribute__((constructor)) io_print_use(void) {
  io_eff(CID_IO_PRINT, io_print_run, 0);
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
