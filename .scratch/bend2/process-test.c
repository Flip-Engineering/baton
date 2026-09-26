
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
#define CID_LT 16
#define CID_EQ 17
#define CID_GT 18
#define CID_IO_ARGS 19
#define CID_PROCESSCHILD_SPAWN 20
#define CID_PROCESSCHILD_CLOSE_STDIN 21
#define CID_PROCESSCHILD_READ_LINE 22
#define CID_PROCESSCHILD_WAIT 23
#define CID_PROCESSCHILD_WRITE 24
#define CID_IO_PRINT 25
#define FID_IO_TRY_C7 0
#define FID_IO_TRY_C8 1
#define FID_IO_PASS_C9 2
#define FID_IO_PASS_C10 3
#define FID_STRING_CMP 4
#define FID_STRING_CMP_K14 5
#define FID_LINES 6
#define FID_FINISH_C17 7
#define FID_FINISH_C18 8
#define FID_LINES_C19 9
#define FID_LINES_C20 10
#define FID_LINES_C21 11
#define FID_IO_TRY_C22 12
#define FID_IO_TRY_C23 13
#define FID_IO_PASS_C24 14
#define FID_IO_PASS_C25 15
#define FID_LINES_C26 16
#define FID_IO_TRY_C30 17
#define FID_IO_TRY_C31 18
#define FID_IO_PASS_C32 19
#define FID_IO_PASS_C33 20
#define FID_STRING_APPEND 21
#define FID_STRING_APPEND_K36 22
#define FID_STRING_EQ 23
#define FID_STRING_EQ_K42 24
#define FID_CLOSED_C44 25
#define FID_CLOSED_C45 26
#define FID____SRC_HOST_PROCESS_ARGV 27
#define FID____SRC_HOST_PROCESS_ARGV_K51 28
#define FID____SRC_HOST_PROCESS_ARGV_K52 29
#define FID_IO_TRY_C59 30
#define FID_IO_TRY_C60 31
#define FID_IO_PASS_C61 32
#define FID_IO_PASS_C62 33
#define FID_IO_BIND 34
#define FID_IO_BIND_C73 35
#define FID_IO_BIND_K74 36
#define FID_MAIN 37
#define FID_MAIN_C76 38
#define FID_MAIN_C77 39
#define FID_MAIN_K78 40
#define FID_MAIN_C79 41
#define FID_MAIN_C80 42
#define FID_MAIN_K81 43
#define FID_MAIN_C82 44
#define FID_MAIN_C83 45
#define FID_MAIN_C84 46
#define FID_MAIN_C85 47
#define FID_MAIN_C86 48
#define FID_MAIN_C87 49
#define FID_MAIN_C88 50
#define FID_IO_ARGS 51
#define FID_PROCESSCHILD_SPAWN 52
#define FID_PROCESSCHILD_CLOSE_STDIN 53
#define FID_PROCESSCHILD_READ_LINE 54
#define FID_PROCESSCHILD_WAIT 55
#define FID_PROCESSCHILD_WRITE 56
#define FID_IO_PRINT 57
#define FID_IO_EMIT 58
#define FID_CLO_APPLY 59
#define FID_EXIT 60
#define FID_ENTER 61
CONSTV u8 FID_ARITY_T[] = { 2, 1, 2, 3, 2, 5, 3, 2, 1, 3, 2, 2, 2, 1, 2, 3, 2, 2, 1, 2, 3, 2, 2, 2, 3, 2, 2, 1, 2, 2, 2, 1, 2, 3, 3, 3, 2, 0, 1, 1, 4, 5, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 4, 2, 2, 2, 3, 2, 1, 2 };
CONSTV u8 FID_FLAG_T[] = { 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2 };
CONSTV u8 FID_RESW_T[] = { 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 3, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };
CONSTV u8 CID_ARITY_T[] = { 2, 0, 2, 2, 1, 2, 1, 1, 0, 1, 0, 0, 0, 0, 2, 1, 0, 0, 0, 1, 4, 2, 2, 2, 3, 2 };
CONSTV u8 CID_HOT_T[] = { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };
#define STAT_LEN 100

#define WL_RESW 3
#define BANGS   0

#define WL_BANK Term r0, r1, r2, r3, r4;

#define WL_LOAD(A, N) \
  do { \
    if ((N) <= 0) break; r0 = e.mem[(A) + 0]; \
    if ((N) <= 1) break; r1 = e.mem[(A) + 1]; \
    if ((N) <= 2) break; r2 = e.mem[(A) + 2]; \
    if ((N) <= 3) break; r3 = e.mem[(A) + 3]; \
    if ((N) <= 4) break; r4 = e.mem[(A) + 4]; \
  } while (0);

#define WL_LAST(X) \
  switch (war) { \
    case 0: r0 = (X); \
      break; \
    case 1: r1 = (X); \
      break; \
    case 2: r2 = (X); \
      break; \
    case 3: r3 = (X); \
      break; \
    case 4: r4 = (X); \
      break; \
  }

#define WL_SAVE(V) (V)[0] = r0; (V)[1] = r1; (V)[2] = r2;

#define WL_TAKE(V) r0 = (V)[0]; r1 = (V)[1]; r2 = (V)[2];

#define WL_SIG Env e, Stk sp, u32 seq, u32 rn, Term r0, Term r1, Term r2, Term r3, Term r4

#define WL_ALL e, sp, seq, rn, r0, r1, r2, r3, r4

#define WL_TABLE WL_X(FID_IO_TRY_C7) WL_X(FID_IO_TRY_C8) WL_X(FID_IO_PASS_C9) WL_X(FID_IO_PASS_C10) WL_X(FID_STRING_CMP) WL_X(FID_STRING_CMP_K14) WL_X(FID_LINES) WL_X(FID_FINISH_C17) WL_X(FID_FINISH_C18) WL_X(FID_LINES_C19) WL_X(FID_LINES_C20) WL_X(FID_LINES_C21) WL_X(FID_IO_TRY_C22) WL_X(FID_IO_TRY_C23) WL_X(FID_IO_PASS_C24) WL_X(FID_IO_PASS_C25) WL_X(FID_LINES_C26) WL_X(FID_IO_TRY_C30) WL_X(FID_IO_TRY_C31) WL_X(FID_IO_PASS_C32) WL_X(FID_IO_PASS_C33) WL_X(FID_STRING_APPEND) WL_X(FID_STRING_APPEND_K36) WL_X(FID_STRING_EQ) WL_X(FID_STRING_EQ_K42) WL_X(FID_CLOSED_C44) WL_X(FID_CLOSED_C45) WL_X(FID____SRC_HOST_PROCESS_ARGV) WL_X(FID____SRC_HOST_PROCESS_ARGV_K51) WL_X(FID____SRC_HOST_PROCESS_ARGV_K52) WL_X(FID_IO_TRY_C59) WL_X(FID_IO_TRY_C60) WL_X(FID_IO_PASS_C61) WL_X(FID_IO_PASS_C62) WL_X(FID_IO_BIND) WL_X(FID_IO_BIND_C73) WL_X(FID_IO_BIND_K74) WL_X(FID_MAIN) WL_X(FID_MAIN_C76) WL_X(FID_MAIN_C77) WL_X(FID_MAIN_K78) WL_X(FID_MAIN_C79) WL_X(FID_MAIN_C80) WL_X(FID_MAIN_K81) WL_X(FID_MAIN_C82) WL_X(FID_MAIN_C83) WL_X(FID_MAIN_C84) WL_X(FID_MAIN_C85) WL_X(FID_MAIN_C86) WL_X(FID_MAIN_C87) WL_X(FID_MAIN_C88) WL_X(FID_IO_ARGS) WL_X(FID_PROCESSCHILD_SPAWN) WL_X(FID_PROCESSCHILD_CLOSE_STDIN) WL_X(FID_PROCESSCHILD_READ_LINE) WL_X(FID_PROCESSCHILD_WAIT) WL_X(FID_PROCESSCHILD_WRITE) WL_X(FID_IO_PRINT) WL_X(FID_IO_EMIT) WL_X(FID_CLO_APPLY) WL_X(FID_EXIT)
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

CONSTV u64 STAT_IMG[] = { 110ull, term_pak(CID_SNIL, 0), 105ull, term_ctr(CID_SCON, STAT_OFF + 0), 100ull, term_ctr(CID_SCON, STAT_OFF + 2), 116ull, term_ctr(CID_SCON, STAT_OFF + 4), 115ull, term_ctr(CID_SCON, STAT_OFF + 6), 32ull, term_ctr(CID_SCON, STAT_OFF + 8), 100ull, term_ctr(CID_SCON, STAT_OFF + 10), 101ull, term_ctr(CID_SCON, STAT_OFF + 12), 115ull, term_ctr(CID_SCON, STAT_OFF + 14), 111ull, term_ctr(CID_SCON, STAT_OFF + 16), 108ull, term_ctr(CID_SCON, STAT_OFF + 18), 99ull, term_ctr(CID_SCON, STAT_OFF + 20), 0ull, term_pak(CID_SNIL, 0), 100ull, term_pak(CID_SNIL, 0), 101ull, term_ctr(CID_SCON, STAT_OFF + 26), 115ull, term_ctr(CID_SCON, STAT_OFF + 28), 111ull, term_ctr(CID_SCON, STAT_OFF + 30), 108ull, term_ctr(CID_SCON, STAT_OFF + 32), 99ull, term_ctr(CID_SCON, STAT_OFF + 34), 46ull, term_pak(CID_SNIL, 0), 46ull, term_ctr(CID_SCON, STAT_OFF + 38), 46ull, term_ctr(CID_SCON, STAT_OFF + 40), 83ull, term_ctr(CID_SCON, STAT_OFF + 42), 71ull, term_ctr(CID_SCON, STAT_OFF + 44), 82ull, term_ctr(CID_SCON, STAT_OFF + 46), 65ull, term_ctr(CID_SCON, STAT_OFF + 48), 32ull, term_ctr(CID_SCON, STAT_OFF + 50), 77ull, term_ctr(CID_SCON, STAT_OFF + 52), 65ull, term_ctr(CID_SCON, STAT_OFF + 54), 82ull, term_ctr(CID_SCON, STAT_OFF + 56), 71ull, term_ctr(CID_SCON, STAT_OFF + 58), 79ull, term_ctr(CID_SCON, STAT_OFF + 60), 82ull, term_ctr(CID_SCON, STAT_OFF + 62), 80ull, term_ctr(CID_SCON, STAT_OFF + 64), 32ull, term_ctr(CID_SCON, STAT_OFF + 66), 82ull, term_ctr(CID_SCON, STAT_OFF + 68), 82ull, term_ctr(CID_SCON, STAT_OFF + 70), 69ull, term_ctr(CID_SCON, STAT_OFF + 72), 68ull, term_ctr(CID_SCON, STAT_OFF + 74), 84ull, term_ctr(CID_SCON, STAT_OFF + 76), 83ull, term_ctr(CID_SCON, STAT_OFF + 78), 32ull, term_ctr(CID_SCON, STAT_OFF + 80), 68ull, term_ctr(CID_SCON, STAT_OFF + 82), 87ull, term_ctr(CID_SCON, STAT_OFF + 84), 67ull, term_ctr(CID_SCON, STAT_OFF + 86), 32ull, term_ctr(CID_SCON, STAT_OFF + 88), 69ull, term_ctr(CID_SCON, STAT_OFF + 90), 68ull, term_ctr(CID_SCON, STAT_OFF + 92), 79ull, term_ctr(CID_SCON, STAT_OFF + 94), 77ull, term_ctr(CID_SCON, STAT_OFF + 96) };

INLINE Term spin_0(Env e, THR Term* o, u32 r0, u32 r1, Term r2, Term r3, u32 r4) {
  u32 wpoll = 0;
  Term _v_3 = 0;
  Term _v_4 = 0;
  u32 _v_5 = 0;
  u32 _h1b_0 = r0;
  u32 _h2b_0 = r1;
  Term _rr_0 = r2;
  Term _rr_1 = r3;
  u32 _rr_2 = r4;
  WL_SPIN
    u64 _nd_2 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_2 + 0] = _h1b_0;
    e.mem[_nd_2 + 1] = _rr_0;
    u64 _nd_3 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_3 + 0] = _h2b_0;
    e.mem[_nd_3 + 1] = _rr_1;
    _v_3 = term_ctr(CID_SCON, _nd_2);
    _v_4 = term_ctr(CID_SCON, _nd_3);
    _v_5 = _rr_2;
  break;
  }
  o[0] = _v_3;
  o[1] = _v_4;
  o[2] = _v_5;
  return 1;
}

INLINE Term spin_3(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_6 = 0;
  u32 _code_0 = r0;
  Term _msg_0 = r1;
  Term _k_0 = r2;
  WL_SPIN
    term_sink(e, _k_0);
    u64 _nd_5 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_5 + 0] = _code_0;
    e.mem[_nd_5 + 1] = _msg_0;
    _v_6 = term_ctr(CID_HALT, _nd_5);
  break;
  }
  o[0] = _v_6;
  return 1;
}

INLINE Term spin_2(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_4 = 0;
  u32 _r_0 = r0;
  Term _r_1 = r1;
  Term _r_2 = r2;
  WL_SPIN
    if (_r_0 == 1) {
      u64 _nd_3 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_3 + 0] = _r_1;
      _v_4 = term_clo(FID_IO_PASS_C9, _nd_3);
    } else {
      u64 _nd_4 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_4 + 0] = _r_1;
      e.mem[_nd_4 + 1] = _r_2;
      _v_4 = term_clo(FID_IO_PASS_C10, _nd_4);
    }
  break;
  }
  o[0] = _v_4;
  return 1;
}

INLINE Term spin_1(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_2 = 0;
  Term _act_0 = r0;
  WL_SPIN
    u64 _nd_2 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_2 + 0] = _act_0;
    _v_2 = term_clo(FID_IO_TRY_C7, _nd_2);
  break;
  }
  o[0] = _v_2;
  return 1;
}

INLINE Term spin_4(Env e, THR Term* o, u32 r0, u32 r1) {
  u32 wpoll = 0;
  u32 _v_6 = 0;
  u32 _v_7 = 0;
  u32 _v_8 = 0;
  u32 _a_1 = r0;
  u32 _b_1 = r1;
  WL_SPIN
    _v_6 = _a_1;
    _v_7 = _b_1;
    _v_8 = (U32_BIN(_a_1, >, _b_1) + U32_BIN(_a_1, >=, _b_1));
  break;
  }
  o[0] = _v_6;
  o[1] = _v_7;
  o[2] = _v_8;
  return 1;
}

INLINE Term spin_5(Env e, THR Term* o, u32 r0) {
  u32 wpoll = 0;
  u32 _v_1 = 0;
  u32 _c_0 = r0;
  WL_SPIN
    if (_c_0 == 0) {
      _v_1 = 0;
    } else if (_c_0 == 1) {
      _v_1 = 1;
    } else {
      _v_1 = 0;
    }
  break;
  }
  o[0] = _v_1;
  return 1;
}

INLINE Term spin_6(Env e, THR Term* o, u32 r0) {
  u32 wpoll = 0;
  Term _v_1 = 0;
  u32 _handle_1 = r0;
  WL_SPIN
    u64 _nd_0 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_0 + 0] = _handle_1;
    _v_1 = term_clo(FID_FINISH_C17, _nd_0);
  break;
  }
  o[0] = _v_1;
  return 1;
}

INLINE Term spin_9(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_10 = 0;
  u32 _code_0 = r0;
  Term _msg_0 = r1;
  Term _k_0 = r2;
  WL_SPIN
    term_sink(e, _k_0);
    u64 _nd_12 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_12 + 0] = _code_0;
    e.mem[_nd_12 + 1] = _msg_0;
    _v_10 = term_ctr(CID_HALT, _nd_12);
  break;
  }
  o[0] = _v_10;
  return 1;
}

INLINE Term spin_8(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_8 = 0;
  u32 _r_0 = r0;
  Term _r_1 = r1;
  Term _r_2 = r2;
  WL_SPIN
    if (_r_0 == 1) {
      u64 _nd_10 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_10 + 0] = _r_1;
      _v_8 = term_clo(FID_IO_PASS_C24, _nd_10);
    } else {
      u64 _nd_11 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_11 + 0] = _r_1;
      e.mem[_nd_11 + 1] = _r_2;
      _v_8 = term_clo(FID_IO_PASS_C25, _nd_11);
    }
  break;
  }
  o[0] = _v_8;
  return 1;
}

INLINE Term spin_7(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_6 = 0;
  Term _act_0 = r0;
  WL_SPIN
    u64 _nd_8 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_8 + 0] = _act_0;
    _v_6 = term_clo(FID_IO_TRY_C22, _nd_8);
  break;
  }
  o[0] = _v_6;
  return 1;
}

INLINE Term spin_12(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_7 = 0;
  u32 _code_0 = r0;
  Term _msg_0 = r1;
  Term _k_0 = r2;
  WL_SPIN
    term_sink(e, _k_0);
    u64 _nd_7 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_7 + 0] = _code_0;
    e.mem[_nd_7 + 1] = _msg_0;
    _v_7 = term_ctr(CID_HALT, _nd_7);
  break;
  }
  o[0] = _v_7;
  return 1;
}

INLINE Term spin_11(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_5 = 0;
  u32 _r_0 = r0;
  Term _r_1 = r1;
  Term _r_2 = r2;
  WL_SPIN
    if (_r_0 == 1) {
      u64 _nd_5 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_5 + 0] = _r_1;
      _v_5 = term_clo(FID_IO_PASS_C32, _nd_5);
    } else {
      u64 _nd_6 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_6 + 0] = _r_1;
      e.mem[_nd_6 + 1] = _r_2;
      _v_5 = term_clo(FID_IO_PASS_C33, _nd_6);
    }
  break;
  }
  o[0] = _v_5;
  return 1;
}

INLINE Term spin_10(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_3 = 0;
  Term _act_0 = r0;
  WL_SPIN
    u64 _nd_4 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_4 + 0] = _act_0;
    _v_3 = term_clo(FID_IO_TRY_C30, _nd_4);
  break;
  }
  o[0] = _v_3;
  return 1;
}

INLINE Term spin_13(Env e, THR Term* o, Term r0, Term r1, u32 r2) {
  u32 wpoll = 0;
  u32 _v_1 = 0;
  Term _r_0 = r0;
  Term _r_1 = r1;
  u32 _r_2 = r2;
  WL_SPIN
    term_sink(e, _r_0);
    term_sink(e, _r_1);
    u32 _v_2 = 0;
    Term _o_0[1];
    if (spin_5(e, _o_0, _r_2) == 0) {
      return 0;
    }
    _v_2 = _o_0[0];
    _v_1 = _v_2;
  break;
  }
  o[0] = _v_1;
  return 1;
}

INLINE Term spin_14(Env e, THR Term* o, u32 r0) {
  u32 wpoll = 0;
  Term _v_1 = 0;
  u32 _handle_1 = r0;
  WL_SPIN
    u64 _nd_0 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_0 + 0] = _handle_1;
    _v_1 = term_clo(FID_CLOSED_C44, _nd_0);
  break;
  }
  o[0] = _v_1;
  return 1;
}

INLINE Term spin_17(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_6 = 0;
  u32 _code_0 = r0;
  Term _msg_0 = r1;
  Term _k_0 = r2;
  WL_SPIN
    term_sink(e, _k_0);
    u64 _nd_5 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_5 + 0] = _code_0;
    e.mem[_nd_5 + 1] = _msg_0;
    _v_6 = term_ctr(CID_HALT, _nd_5);
  break;
  }
  o[0] = _v_6;
  return 1;
}

INLINE Term spin_16(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_4 = 0;
  u32 _r_0 = r0;
  Term _r_1 = r1;
  Term _r_2 = r2;
  WL_SPIN
    if (_r_0 == 1) {
      u64 _nd_3 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_3 + 0] = _r_1;
      _v_4 = term_clo(FID_IO_PASS_C61, _nd_3);
    } else {
      u64 _nd_4 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_4 + 0] = _r_1;
      e.mem[_nd_4 + 1] = _r_2;
      _v_4 = term_clo(FID_IO_PASS_C62, _nd_4);
    }
  break;
  }
  o[0] = _v_4;
  return 1;
}

INLINE Term spin_15(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_2 = 0;
  Term _act_0 = r0;
  WL_SPIN
    u64 _nd_2 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_2 + 0] = _act_0;
    _v_2 = term_clo(FID_IO_TRY_C59, _nd_2);
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
  WL_CASE(FID_IO_TRY_C7)
  {
    Term _act_1 = r0;
    Term _x_1 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_1 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _act_1;
      e.mem[_t_1 + 1] = term_clo(FID_IO_TRY_C8, 0);
      e.mem[_t_1 + 2] = _x_1;
      return term_tsk(FID_IO_BIND, _t_1);
    }
    r0 = _act_1;
    r1 = term_clo(FID_IO_TRY_C8, 0);
    r2 = _x_1;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_TRY_C8)
  {
    Term _x_2 = r0;
    WL_OPEN
    u32 _o_0 = 0;
    Term _o_1 = 0;
    Term _o_2 = 0;
    if (term_aux(_x_2) == CID_FAIL) {
      _o_0 = 0;
      u64 _sp_0 = term_loc(_x_2);
      Term _f_0 = e.mem[_sp_0 + 0];
      heap_free(e, cls_fit(1), _sp_0);
      u64 _sp_1 = term_loc(_f_0);
      Term _f_1 = e.mem[_sp_1 + 0];
      Term _f_2 = e.mem[_sp_1 + 1];
      heap_free(e, cls_fit(2), _sp_1);
      _o_1 = _f_1;
      _o_2 = _f_2;
    } else {
      _o_0 = 1;
      u64 _sp_2 = term_loc(_x_2);
      Term _f_3 = e.mem[_sp_2 + 0];
      heap_free(e, cls_fit(1), _sp_2);
      _o_1 = _f_3;
    }
    Term _v_3 = 0;
    Term _o_4[1];
    if (spin_2(e, _o_4, _o_0, _o_1, _o_2) == 0) {
      return 0;
    }
    _v_3 = _o_4[0];
    r0 = _v_3;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_PASS_C9)
  {
    Term _r_3 = r0;
    Term _x_3 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_CLO_APPLY)) {
      u64 _t_0 = task_node(e, FID_CLO_APPLY, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = _x_3;
      e.mem[_t_0 + 1] = _r_3;
      return term_tsk(FID_CLO_APPLY, _t_0);
    }
    r0 = _x_3;
    r1 = _r_3;
    WL_JMP(FID_CLO_APPLY);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_PASS_C10)
  {
    u32 _r_4 = r0;
    Term _r_5 = r1;
    Term _x_4 = r2;
    WL_OPEN
    Term _v_5 = 0;
    Term _o_3[1];
    if (spin_3(e, _o_3, _r_4, _r_5, _x_4) == 0) {
      return 0;
    }
    _v_5 = _o_3[0];
    r0 = _v_5;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_STRING_CMP)
  {
    Term _a_0 = r0;
    Term _b_0 = r1;
    WL_OPEN
    WL_SPIN
    if (term_aux(_a_0) == CID_SNIL) {
      if (term_aux(_b_0) == CID_SNIL) {
        r0 = term_pak(CID_SNIL, 0);
        r1 = term_pak(CID_SNIL, 0);
        r2 = 1;
        WL_RETN(3);
      } else {
        Term _fb_0[2];
        u64 _sp_0 = ctr_take(e, _b_0, 2, _fb_0);
        u32 _f_0 = _fb_0[0];
        Term _f_1 = _fb_0[1];
        u64 _nd_0 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
        e.mem[_nd_0 + 0] = _f_0;
        e.mem[_nd_0 + 1] = _f_1;
        r0 = term_pak(CID_SNIL, 0);
        r1 = term_ctr(CID_SCON, _nd_0);
        r2 = 0;
        WL_RETN(3);
      }
    } else {
      Term _fb_1[2];
      u64 _sp_1 = ctr_take(e, _a_0, 2, _fb_1);
      u32 _f_2 = _fb_1[0];
      Term _f_3 = _fb_1[1];
      if (term_aux(_b_0) == CID_SNIL) {
        u64 _nd_1 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
        e.mem[_nd_1 + 0] = _f_2;
        e.mem[_nd_1 + 1] = _f_3;
        r0 = term_ctr(CID_SCON, _nd_1);
        r1 = term_pak(CID_SNIL, 0);
        r2 = 2;
        WL_RETN(3);
      } else {
        Term _fb_2[2];
        u64 _sp_2 = ctr_take(e, _b_0, 2, _fb_2);
        u32 _f_4 = _fb_2[0];
        Term _f_5 = _fb_2[1];
        u32 _v_0 = 0;
        u32 _v_1 = 0;
        u32 _v_2 = 0;
        u32 _v_3 = 0;
        u32 _v_4 = 0;
        u32 _v_5 = 0;
        Term _o_0[3];
        if (spin_4(e, _o_0, _f_2, _f_4) == 0) {
          return 0;
        }
        _v_3 = _o_0[0];
        _v_4 = _o_0[1];
        _v_5 = _o_0[2];
        _v_0 = _v_3;
        _v_1 = _v_4;
        _v_2 = _v_5;
        if (_v_2 == 0) {
          u64 _nd_2 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
          e.mem[_nd_2 + 0] = _v_0;
          e.mem[_nd_2 + 1] = _f_3;
          u64 _nd_3 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
          e.mem[_nd_3 + 0] = _v_1;
          e.mem[_nd_3 + 1] = _f_5;
          r0 = term_ctr(CID_SCON, _nd_2);
          r1 = term_ctr(CID_SCON, _nd_3);
          r2 = 0;
          WL_RETN(3);
        } else if (_v_2 == 1) {
          spare_free(e, cls_fit(2), _sp_2);
          spare_free(e, cls_fit(2), _sp_1);
          if (seq) {
            WL_ROOM(3);
            STK(0) = _v_0;
            STK(1) = _v_1;
            STK(2) = FID_STRING_CMP_K14;
            WL_PUSHN(3);
          } else {
            u64 _t_0 = task_node(e, FID_STRING_CMP_K14, WL_CONT, WL_IDX, 1);
            e.mem[_t_0 + 0] = _v_0;
            e.mem[_t_0 + 1] = _v_1;
            WL_CONT = term_tsk(FID_STRING_CMP_K14, _t_0);
            WL_IDX = 2;
          }
          r0 = _f_3;
          r1 = _f_5;
          _a_0 = r0;
          _b_0 = r1;
          WL_AGAIN(FID_STRING_CMP);
        } else {
          u64 _nd_4 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
          e.mem[_nd_4 + 0] = _v_0;
          e.mem[_nd_4 + 1] = _f_3;
          u64 _nd_5 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
          e.mem[_nd_5 + 0] = _v_1;
          e.mem[_nd_5 + 1] = _f_5;
          r0 = term_ctr(CID_SCON, _nd_4);
          r1 = term_ctr(CID_SCON, _nd_5);
          r2 = 2;
          WL_RETN(3);
        }
      }
    }
    WL_SPUN
  }}
#endif

#if !DEVICE
  WL_CASE(FID_STRING_CMP_K14)
  {
    WL_POPN(2);
    u32 _v_9 = STK(0);
    u32 _v_10 = STK(1);
    Term _h_0 = r0;
    Term _h_1 = r1;
    u32 _h_2 = r2;
    WL_OPEN
    Term _v_11 = 0;
    Term _v_12 = 0;
    u32 _v_13 = 0;
    Term _o_1[3];
    if (spin_0(e, _o_1, _v_9, _v_10, _h_0, _h_1, _h_2) == 0) {
      return 0;
    }
    _v_11 = _o_1[0];
    _v_12 = _o_1[1];
    _v_13 = _o_1[2];
    r0 = _v_11;
    r1 = _v_12;
    r2 = _v_13;
    WL_RETN(3);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LINES)
  {
    u32 _handle_0 = r0;
    u32 _line_0 = r1;
    Term _line_1 = r2;
    WL_OPEN
    if (_line_0 == 0) {
      Term _v_0 = 0;
      Term _o_1[1];
      if (spin_6(e, _o_1, _handle_0) == 0) {
        return 0;
      }
      _v_0 = _o_1[0];
      r0 = _v_0;
      WL_RETN(1);
    } else {
      u64 _nd_3 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_3 + 0] = _handle_0;
      e.mem[_nd_3 + 1] = _line_1;
      r0 = term_clo(FID_LINES_C19, _nd_3);
      WL_RETN(1);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID_FINISH_C17)
  {
    u32 _handle_2 = r0;
    Term _x_0 = r1;
    WL_OPEN
    Term _v_2 = 0;
    u64 _nd_1 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_1 + 0] = _handle_2;
    Term _v_3 = 0;
    Term _o_0[1];
    if (spin_1(e, _o_0, term_clo(FID_PROCESSCHILD_WAIT, _nd_1)) == 0) {
      return 0;
    }
    _v_3 = _o_0[0];
    _v_2 = _v_3;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_0 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = _v_2;
      e.mem[_t_0 + 1] = term_clo(FID_FINISH_C18, 0);
      e.mem[_t_0 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_0);
    }
    r0 = _v_2;
    r1 = term_clo(FID_FINISH_C18, 0);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_FINISH_C18)
  {
    Term _x_1 = r0;
    WL_OPEN
    u64 _nd_2 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_2 + 0] = _x_1;
    r0 = term_clo(FID_IO_PRINT, _nd_2);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LINES_C19)
  {
    u32 _handle_3 = r0;
    Term _line_2 = r1;
    Term _x_2 = r2;
    WL_OPEN
    u64 _nd_4 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_4 + 0] = _line_2;
    u64 _nd_5 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_5 + 0] = _handle_3;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_5 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = term_clo(FID_IO_PRINT, _nd_4);
      e.mem[_t_5 + 1] = term_clo(FID_LINES_C20, _nd_5);
      e.mem[_t_5 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_5);
    }
    r0 = term_clo(FID_IO_PRINT, _nd_4);
    r1 = term_clo(FID_LINES_C20, _nd_5);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LINES_C20)
  {
    u32 _handle_4 = r0;
    Term _x_3 = r1;
    WL_OPEN
    u64 _nd_6 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_6 + 0] = _handle_4;
    r0 = term_clo(FID_LINES_C21, _nd_6);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LINES_C21)
  {
    u32 _handle_5 = r0;
    Term _x_4 = r1;
    WL_OPEN
    Term _v_4 = 0;
    u64 _nd_7 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_7 + 0] = _handle_5;
    Term _v_5 = 0;
    Term _o_12[1];
    if (spin_7(e, _o_12, term_clo(FID_PROCESSCHILD_READ_LINE, _nd_7)) == 0) {
      return 0;
    }
    _v_5 = _o_12[0];
    _v_4 = _v_5;
    u64 _nd_13 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_13 + 0] = _handle_5;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_4 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = _v_4;
      e.mem[_t_4 + 1] = term_clo(FID_LINES_C26, _nd_13);
      e.mem[_t_4 + 2] = _x_4;
      return term_tsk(FID_IO_BIND, _t_4);
    }
    r0 = _v_4;
    r1 = term_clo(FID_LINES_C26, _nd_13);
    r2 = _x_4;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_TRY_C22)
  {
    Term _act_1 = r0;
    Term _x_5 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_2 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_2 + 0] = _act_1;
      e.mem[_t_2 + 1] = term_clo(FID_IO_TRY_C23, 0);
      e.mem[_t_2 + 2] = _x_5;
      return term_tsk(FID_IO_BIND, _t_2);
    }
    r0 = _act_1;
    r1 = term_clo(FID_IO_TRY_C23, 0);
    r2 = _x_5;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_TRY_C23)
  {
    Term _x_6 = r0;
    WL_OPEN
    u32 _o_2 = 0;
    u32 _o_3 = 0;
    Term _o_4 = 0;
    if (term_aux(_x_6) == CID_FAIL) {
      _o_2 = 0;
      u64 _sp_0 = term_loc(_x_6);
      Term _f_0 = e.mem[_sp_0 + 0];
      heap_free(e, cls_fit(1), _sp_0);
      u64 _sp_1 = term_loc(_f_0);
      Term _f_1 = e.mem[_sp_1 + 0];
      Term _f_2 = e.mem[_sp_1 + 1];
      heap_free(e, cls_fit(2), _sp_1);
      _o_3 = _f_1;
      _o_4 = _f_2;
    } else {
      _o_2 = 1;
      u64 _sp_2 = term_loc(_x_6);
      Term _f_3 = e.mem[_sp_2 + 0];
      heap_free(e, cls_fit(1), _sp_2);
      u32 _o_5 = 0;
      Term _o_6 = 0;
      if (term_aux(_f_3) == CID_NONE) {
        _o_5 = 0;
      } else {
        _o_5 = 1;
        u64 _sp_3 = term_loc(_f_3);
        Term _f_4 = e.mem[_sp_3 + 0];
        heap_free(e, cls_fit(1), _sp_3);
        _o_6 = _f_4;
      }
      _o_3 = _o_5;
      _o_4 = _o_6;
    }
    u32 _o_7 = 0;
    Term _o_8 = 0;
    Term _o_9 = 0;
    if (_o_2 == 0) {
      _o_7 = 0;
      _o_8 = _o_3;
      _o_9 = _o_4;
    } else {
      _o_7 = 1;
      Term _b_0 = 0;
      if (_o_3 == 0) {
        _b_0 = term_pak(CID_NONE, 0);
      } else {
        u64 _nd_9 = heap_alloc(e, cls_fit(1));
        e.mem[_nd_9 + 0] = _o_4;
        _b_0 = term_ctr(CID_SOME, _nd_9);
      }
      _o_8 = _b_0;
    }
    Term _v_7 = 0;
    Term _o_11[1];
    if (spin_8(e, _o_11, _o_7, _o_8, _o_9) == 0) {
      return 0;
    }
    _v_7 = _o_11[0];
    r0 = _v_7;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_PASS_C24)
  {
    Term _r_3 = r0;
    Term _x_7 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_CLO_APPLY)) {
      u64 _t_1 = task_node(e, FID_CLO_APPLY, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _x_7;
      e.mem[_t_1 + 1] = _r_3;
      return term_tsk(FID_CLO_APPLY, _t_1);
    }
    r0 = _x_7;
    r1 = _r_3;
    WL_JMP(FID_CLO_APPLY);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_PASS_C25)
  {
    u32 _r_4 = r0;
    Term _r_5 = r1;
    Term _x_8 = r2;
    WL_OPEN
    Term _v_9 = 0;
    Term _o_10[1];
    if (spin_9(e, _o_10, _r_4, _r_5, _x_8) == 0) {
      return 0;
    }
    _v_9 = _o_10[0];
    r0 = _v_9;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LINES_C26)
  {
    u32 _handle_6 = r0;
    Term _x_9 = r1;
    WL_OPEN
    u32 _o_13 = 0;
    Term _o_14 = 0;
    if (term_aux(_x_9) == CID_NONE) {
      _o_13 = 0;
    } else {
      _o_13 = 1;
      u64 _sp_4 = term_loc(_x_9);
      Term _f_5 = e.mem[_sp_4 + 0];
      heap_free(e, cls_fit(1), _sp_4);
      _o_14 = _f_5;
    }
    if (!DEVICE && !seq && fid_nofk(FID_LINES)) {
      u64 _t_3 = task_node(e, FID_LINES, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _handle_6;
      e.mem[_t_3 + 1] = _o_13;
      e.mem[_t_3 + 2] = _o_14;
      return term_tsk(FID_LINES, _t_3);
    }
    r0 = _handle_6;
    r1 = _o_13;
    r2 = _o_14;
    WL_JMP(FID_LINES);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_TRY_C30)
  {
    Term _act_1 = r0;
    Term _x_2 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_1 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _act_1;
      e.mem[_t_1 + 1] = term_clo(FID_IO_TRY_C31, 0);
      e.mem[_t_1 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_1);
    }
    r0 = _act_1;
    r1 = term_clo(FID_IO_TRY_C31, 0);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_TRY_C31)
  {
    Term _x_3 = r0;
    WL_OPEN
    u32 _o_1 = 0;
    u32 _o_2 = 0;
    Term _o_3 = 0;
    if (term_aux(_x_3) == CID_FAIL) {
      _o_1 = 0;
      u64 _sp_0 = term_loc(_x_3);
      Term _f_0 = e.mem[_sp_0 + 0];
      heap_free(e, cls_fit(1), _sp_0);
      u64 _sp_1 = term_loc(_f_0);
      Term _f_1 = e.mem[_sp_1 + 0];
      Term _f_2 = e.mem[_sp_1 + 1];
      heap_free(e, cls_fit(2), _sp_1);
      _o_2 = _f_1;
      _o_3 = _f_2;
    } else {
      _o_1 = 1;
      u64 _sp_2 = term_loc(_x_3);
      Term _f_3 = e.mem[_sp_2 + 0];
      heap_free(e, cls_fit(1), _sp_2);
    }
    u32 _o_4 = 0;
    Term _o_5 = 0;
    Term _o_6 = 0;
    if (_o_1 == 0) {
      _o_4 = 0;
      _o_5 = _o_2;
      _o_6 = _o_3;
    } else {
      _o_4 = 1;
      _o_5 = term_pak(CID_UNIT, 0);
    }
    Term _v_4 = 0;
    Term _o_8[1];
    if (spin_11(e, _o_8, _o_4, _o_5, _o_6) == 0) {
      return 0;
    }
    _v_4 = _o_8[0];
    r0 = _v_4;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_PASS_C32)
  {
    Term _r_3 = r0;
    Term _x_4 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_CLO_APPLY)) {
      u64 _t_0 = task_node(e, FID_CLO_APPLY, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = _x_4;
      e.mem[_t_0 + 1] = _r_3;
      return term_tsk(FID_CLO_APPLY, _t_0);
    }
    r0 = _x_4;
    r1 = _r_3;
    WL_JMP(FID_CLO_APPLY);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_PASS_C33)
  {
    u32 _r_4 = r0;
    Term _r_5 = r1;
    Term _x_5 = r2;
    WL_OPEN
    Term _v_6 = 0;
    Term _o_7[1];
    if (spin_12(e, _o_7, _r_4, _r_5, _x_5) == 0) {
      return 0;
    }
    _v_6 = _o_7[0];
    r0 = _v_6;
    WL_RETN(1);
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
        STK(1) = FID_STRING_APPEND_K36;
        WL_PUSHN(2);
      } else {
        u64 _t_0 = task_node(e, FID_STRING_APPEND_K36, WL_CONT, WL_IDX, 1);
        e.mem[_t_0 + 0] = _f_0;
        WL_CONT = term_tsk(FID_STRING_APPEND_K36, _t_0);
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
  WL_CASE(FID_STRING_APPEND_K36)
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
  WL_CASE(FID_STRING_EQ)
  {
    Term _a_0 = r0;
    Term _b_0 = r1;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_STRING_EQ_K42;
      WL_PUSHN(1);
    } else {
      u64 _t_0 = task_node(e, FID_STRING_EQ_K42, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_STRING_EQ_K42, _t_0);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID_STRING_CMP)) {
      u64 _t_1 = task_node(e, FID_STRING_CMP, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _a_0;
      e.mem[_t_1 + 1] = _b_0;
      return term_tsk(FID_STRING_CMP, _t_1);
    }
    r0 = _a_0;
    r1 = _b_0;
    WL_JMP(FID_STRING_CMP);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_STRING_EQ_K42)
  {
    Term _h_0 = r0;
    Term _h_1 = r1;
    u32 _h_2 = r2;
    WL_OPEN
    u32 _v_0 = 0;
    Term _o_1[1];
    if (spin_13(e, _o_1, _h_0, _h_1, _h_2) == 0) {
      return 0;
    }
    _v_0 = _o_1[0];
    r0 = _v_0;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CLOSED_C44)
  {
    u32 _handle_2 = r0;
    Term _x_0 = r1;
    WL_OPEN
    Term _v_2 = 0;
    u64 _nd_1 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_1 + 0] = _handle_2;
    Term _v_3 = 0;
    Term _o_0[1];
    if (spin_1(e, _o_0, term_clo(FID_PROCESSCHILD_WAIT, _nd_1)) == 0) {
      return 0;
    }
    _v_3 = _o_0[0];
    _v_2 = _v_3;
    u64 _nd_2 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_2 + 0] = _handle_2;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_0 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = _v_2;
      e.mem[_t_0 + 1] = term_clo(FID_CLOSED_C45, _nd_2);
      e.mem[_t_0 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_0);
    }
    r0 = _v_2;
    r1 = term_clo(FID_CLOSED_C45, _nd_2);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CLOSED_C45)
  {
    u32 _handle_3 = r0;
    Term _x_1 = r1;
    WL_OPEN
    term_sink(e, _x_1);
    u64 _nd_3 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_3 + 0] = _handle_3;
    e.mem[_nd_3 + 1] = term_ctr(CID_SCON, STAT_OFF + 22);
    Term _v_4 = 0;
    Term _o_1[1];
    if (spin_10(e, _o_1, term_clo(FID_PROCESSCHILD_WRITE, _nd_3)) == 0) {
      return 0;
    }
    _v_4 = _o_1[0];
    r0 = _v_4;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_HOST_PROCESS_ARGV)
  {
    Term _args_0 = r0;
    WL_OPEN
    WL_SPIN
    if (term_aux(_args_0) == CID_NIL) {
      r0 = term_pak(CID_SNIL, 0);
      WL_RETN(1);
    } else {
      u64 _sp_0 = term_loc(_args_0);
      Term _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      heap_free(e, cls_fit(2), _sp_0);
      if (seq) {
        WL_ROOM(2);
        STK(0) = _f_0;
        STK(1) = FID____SRC_HOST_PROCESS_ARGV_K51;
        WL_PUSHN(2);
      } else {
        u64 _t_0 = task_node(e, FID____SRC_HOST_PROCESS_ARGV_K51, WL_CONT, WL_IDX, 1);
        e.mem[_t_0 + 0] = _f_0;
        WL_CONT = term_tsk(FID____SRC_HOST_PROCESS_ARGV_K51, _t_0);
        WL_IDX = 1;
      }
      r0 = _f_1;
      _args_0 = r0;
      WL_AGAIN(FID____SRC_HOST_PROCESS_ARGV);
    }
    WL_SPUN
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_HOST_PROCESS_ARGV_K51)
  {
    WL_POPN(1);
    Term _f_2 = STK(0);
    Term _h_0 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _f_2;
      STK(1) = FID____SRC_HOST_PROCESS_ARGV_K52;
      WL_PUSHN(2);
    } else {
      u64 _t_1 = task_node(e, FID____SRC_HOST_PROCESS_ARGV_K52, WL_CONT, WL_IDX, 1);
      e.mem[_t_1 + 0] = _f_2;
      WL_CONT = term_tsk(FID____SRC_HOST_PROCESS_ARGV_K52, _t_1);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID_STRING_APPEND)) {
      u64 _t_2 = task_node(e, FID_STRING_APPEND, WL_CONT, WL_IDX, 0);
      e.mem[_t_2 + 0] = term_ctr(CID_SCON, STAT_OFF + 24);
      e.mem[_t_2 + 1] = _h_0;
      return term_tsk(FID_STRING_APPEND, _t_2);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 24);
    r1 = _h_0;
    WL_JMP(FID_STRING_APPEND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_HOST_PROCESS_ARGV_K52)
  {
    WL_POPN(1);
    Term _f_3 = STK(0);
    Term _h_1 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_STRING_APPEND)) {
      u64 _t_3 = task_node(e, FID_STRING_APPEND, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _f_3;
      e.mem[_t_3 + 1] = _h_1;
      return term_tsk(FID_STRING_APPEND, _t_3);
    }
    r0 = _f_3;
    r1 = _h_1;
    WL_JMP(FID_STRING_APPEND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_TRY_C59)
  {
    Term _act_1 = r0;
    Term _x_1 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_3 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _act_1;
      e.mem[_t_3 + 1] = term_clo(FID_IO_TRY_C60, 0);
      e.mem[_t_3 + 2] = _x_1;
      return term_tsk(FID_IO_BIND, _t_3);
    }
    r0 = _act_1;
    r1 = term_clo(FID_IO_TRY_C60, 0);
    r2 = _x_1;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_TRY_C60)
  {
    Term _x_2 = r0;
    WL_OPEN
    u32 _o_0 = 0;
    u32 _o_1 = 0;
    Term _o_2 = 0;
    if (term_aux(_x_2) == CID_FAIL) {
      _o_0 = 0;
      u64 _sp_3 = term_loc(_x_2);
      Term _f_12 = e.mem[_sp_3 + 0];
      heap_free(e, cls_fit(1), _sp_3);
      u64 _sp_4 = term_loc(_f_12);
      Term _f_13 = e.mem[_sp_4 + 0];
      Term _f_14 = e.mem[_sp_4 + 1];
      heap_free(e, cls_fit(2), _sp_4);
      _o_1 = _f_13;
      _o_2 = _f_14;
    } else {
      _o_0 = 1;
      u64 _sp_5 = term_loc(_x_2);
      Term _f_15 = e.mem[_sp_5 + 0];
      heap_free(e, cls_fit(1), _sp_5);
      _o_1 = _f_15;
    }
    u32 _o_3 = 0;
    Term _o_4 = 0;
    Term _o_5 = 0;
    if (_o_0 == 0) {
      _o_3 = 0;
      _o_4 = _o_1;
      _o_5 = _o_2;
    } else {
      _o_3 = 1;
      _o_4 = _o_1;
    }
    Term _v_3 = 0;
    Term _o_7[1];
    if (spin_16(e, _o_7, _o_3, _o_4, _o_5) == 0) {
      return 0;
    }
    _v_3 = _o_7[0];
    r0 = _v_3;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_PASS_C61)
  {
    Term _r_3 = r0;
    Term _x_3 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_CLO_APPLY)) {
      u64 _t_2 = task_node(e, FID_CLO_APPLY, WL_CONT, WL_IDX, 0);
      e.mem[_t_2 + 0] = _x_3;
      e.mem[_t_2 + 1] = _r_3;
      return term_tsk(FID_CLO_APPLY, _t_2);
    }
    r0 = _x_3;
    r1 = _r_3;
    WL_JMP(FID_CLO_APPLY);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_PASS_C62)
  {
    u32 _r_4 = r0;
    Term _r_5 = r1;
    Term _x_4 = r2;
    WL_OPEN
    Term _v_5 = 0;
    Term _o_6[1];
    if (spin_17(e, _o_6, _r_4, _r_5, _x_4) == 0) {
      return 0;
    }
    _v_5 = _o_6[0];
    r0 = _v_5;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_BIND)
  {
    Term _m_0 = r0;
    Term _f_0 = r1;
    Term _k_0 = r2;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_0 + 0] = _f_0;
    e.mem[_nd_0 + 1] = _k_0;
    if (!DEVICE && !seq && fid_nofk(FID_CLO_APPLY)) {
      u64 _t_3 = task_node(e, FID_CLO_APPLY, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _m_0;
      e.mem[_t_3 + 1] = term_clo(FID_IO_BIND_C73, _nd_0);
      return term_tsk(FID_CLO_APPLY, _t_3);
    }
    r0 = _m_0;
    r1 = term_clo(FID_IO_BIND_C73, _nd_0);
    WL_JMP(FID_CLO_APPLY);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_BIND_C73)
  {
    Term _f_1 = r0;
    Term _k_1 = r1;
    Term _x_0 = r2;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _k_1;
      STK(1) = FID_IO_BIND_K74;
      WL_PUSHN(2);
    } else {
      u64 _t_0 = task_node(e, FID_IO_BIND_K74, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _k_1;
      WL_CONT = term_tsk(FID_IO_BIND_K74, _t_0);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID_CLO_APPLY)) {
      u64 _t_1 = task_node(e, FID_CLO_APPLY, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _f_1;
      e.mem[_t_1 + 1] = _x_0;
      return term_tsk(FID_CLO_APPLY, _t_1);
    }
    r0 = _f_1;
    r1 = _x_0;
    WL_JMP(FID_CLO_APPLY);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_BIND_K74)
  {
    WL_POPN(1);
    Term _k_2 = STK(0);
    Term _h_0 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_CLO_APPLY)) {
      u64 _t_2 = task_node(e, FID_CLO_APPLY, WL_CONT, WL_IDX, 0);
      e.mem[_t_2 + 0] = _h_0;
      e.mem[_t_2 + 1] = _k_2;
      return term_tsk(FID_CLO_APPLY, _t_2);
    }
    r0 = _h_0;
    r1 = _k_2;
    WL_JMP(FID_CLO_APPLY);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN)
  {
    WL_OPEN
    r0 = term_clo(FID_MAIN_C76, 0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C76)
  {
    Term _x_0 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_8 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_8 + 0] = term_clo(FID_IO_ARGS, 0);
      e.mem[_t_8 + 1] = term_clo(FID_MAIN_C77, 0);
      e.mem[_t_8 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_8);
    }
    r0 = term_clo(FID_IO_ARGS, 0);
    r1 = term_clo(FID_MAIN_C77, 0);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C77)
  {
    Term _x_1 = r0;
    WL_OPEN
    if (term_aux(_x_1) == CID_CON) {
      u64 _sp_0 = term_loc(_x_1);
      Term _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      if (term_aux(_f_1) == CID_CON) {
        u64 _sp_1 = term_loc(_f_1);
        Term _f_2 = e.mem[_sp_1 + 0];
        Term _f_3 = e.mem[_sp_1 + 1];
        if (term_aux(_f_3) == CID_CON) {
          u64 _sp_2 = term_loc(_f_3);
          Term _f_4 = e.mem[_sp_2 + 0];
          Term _f_5 = e.mem[_sp_2 + 1];
          heap_free(e, cls_fit(2), _sp_2);
          heap_free(e, cls_fit(2), _sp_1);
          heap_free(e, cls_fit(2), _sp_0);
          if (seq) {
            WL_ROOM(4);
            STK(0) = _f_0;
            STK(1) = _f_2;
            STK(2) = _f_4;
            STK(3) = FID_MAIN_K78;
            WL_PUSHN(4);
          } else {
            u64 _t_0 = task_node(e, FID_MAIN_K78, WL_CONT, WL_IDX, 1);
            e.mem[_t_0 + 0] = _f_0;
            e.mem[_t_0 + 1] = _f_2;
            e.mem[_t_0 + 2] = _f_4;
            WL_CONT = term_tsk(FID_MAIN_K78, _t_0);
            WL_IDX = 3;
          }
          if (!DEVICE && !seq && fid_nofk(FID____SRC_HOST_PROCESS_ARGV)) {
            u64 _t_1 = task_node(e, FID____SRC_HOST_PROCESS_ARGV, WL_CONT, WL_IDX, 0);
            e.mem[_t_1 + 0] = _f_5;
            return term_tsk(FID____SRC_HOST_PROCESS_ARGV, _t_1);
          }
          r0 = _f_5;
          WL_JMP(FID____SRC_HOST_PROCESS_ARGV);
        } else {
          term_sink(e, _f_0);
          term_sink(e, _f_2);
          term_sink(e, _f_3);
          heap_free(e, cls_fit(2), _sp_1);
          heap_free(e, cls_fit(2), _sp_0);
          r0 = term_clo(FID_MAIN_C86, 0);
          WL_RETN(1);
        }
      } else {
        term_sink(e, _f_0);
        term_sink(e, _f_1);
        heap_free(e, cls_fit(2), _sp_0);
        r0 = term_clo(FID_MAIN_C87, 0);
        WL_RETN(1);
      }
    } else {
      term_sink(e, _x_1);
      r0 = term_clo(FID_MAIN_C88, 0);
      WL_RETN(1);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K78)
  {
    WL_POPN(3);
    Term _f_6 = STK(0);
    Term _f_7 = STK(1);
    Term _f_8 = STK(2);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_0 + 0] = _f_6;
    e.mem[_nd_0 + 1] = _f_7;
    e.mem[_nd_0 + 2] = _f_8;
    e.mem[_nd_0 + 3] = _h_0;
    r0 = term_clo(FID_MAIN_C79, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C79)
  {
    Term _f_9 = r0;
    Term _f_10 = r1;
    Term _f_11 = r2;
    Term _h_1 = r3;
    Term _x_2 = r4;
    WL_OPEN
    Term _v_0 = 0;
    u64 _nd_1 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_1 + 0] = _h_1;
    e.mem[_nd_1 + 1] = _f_10;
    e.mem[_nd_1 + 2] = _f_11;
    Term _v_1 = 0;
    Term _o_0[1];
    if (spin_15(e, _o_0, term_clo(FID_PROCESSCHILD_SPAWN, _nd_1)) == 0) {
      return 0;
    }
    _v_1 = _o_0[0];
    _v_0 = _v_1;
    u64 _nd_2 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_2 + 0] = _f_9;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_7 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_7 + 0] = _v_0;
      e.mem[_t_7 + 1] = term_clo(FID_MAIN_C80, _nd_2);
      e.mem[_t_7 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_7);
    }
    r0 = _v_0;
    r1 = term_clo(FID_MAIN_C80, _nd_2);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C80)
  {
    Term _f_12 = r0;
    Term _x_3 = r1;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _x_3;
      STK(1) = FID_MAIN_K81;
      WL_PUSHN(2);
    } else {
      u64 _t_2 = task_node(e, FID_MAIN_K81, WL_CONT, WL_IDX, 1);
      e.mem[_t_2 + 0] = _x_3;
      WL_CONT = term_tsk(FID_MAIN_K81, _t_2);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID_STRING_EQ)) {
      u64 _t_3 = task_node(e, FID_STRING_EQ, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _f_12;
      e.mem[_t_3 + 1] = term_ctr(CID_SCON, STAT_OFF + 36);
      return term_tsk(FID_STRING_EQ, _t_3);
    }
    r0 = _f_12;
    r1 = term_ctr(CID_SCON, STAT_OFF + 36);
    WL_JMP(FID_STRING_EQ);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K81)
  {
    WL_POPN(1);
    u32 _x_4 = STK(0);
    u32 _h_2 = r0;
    WL_OPEN
    if (_h_2 == 1) {
      Term _v_2 = 0;
      Term _o_1[1];
      if (spin_14(e, _o_1, _x_4) == 0) {
        return 0;
      }
      _v_2 = _o_1[0];
      r0 = _v_2;
      WL_RETN(1);
    } else {
      u64 _nd_3 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_3 + 0] = _x_4;
      r0 = term_clo(FID_MAIN_C82, _nd_3);
      WL_RETN(1);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C82)
  {
    u32 _x_5 = r0;
    Term _x_6 = r1;
    WL_OPEN
    Term _v_3 = 0;
    u64 _nd_4 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_4 + 0] = _x_5;
    Term _v_4 = 0;
    Term _o_2[1];
    if (spin_10(e, _o_2, term_clo(FID_PROCESSCHILD_CLOSE_STDIN, _nd_4)) == 0) {
      return 0;
    }
    _v_4 = _o_2[0];
    _v_3 = _v_4;
    u64 _nd_5 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_5 + 0] = _x_5;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_6 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_6 + 0] = _v_3;
      e.mem[_t_6 + 1] = term_clo(FID_MAIN_C83, _nd_5);
      e.mem[_t_6 + 2] = _x_6;
      return term_tsk(FID_IO_BIND, _t_6);
    }
    r0 = _v_3;
    r1 = term_clo(FID_MAIN_C83, _nd_5);
    r2 = _x_6;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C83)
  {
    u32 _x_7 = r0;
    Term _x_8 = r1;
    WL_OPEN
    u64 _nd_6 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_6 + 0] = _x_7;
    r0 = term_clo(FID_MAIN_C84, _nd_6);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C84)
  {
    u32 _x_9 = r0;
    Term _x_10 = r1;
    WL_OPEN
    Term _v_5 = 0;
    u64 _nd_7 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_7 + 0] = _x_9;
    Term _v_6 = 0;
    Term _o_3[1];
    if (spin_7(e, _o_3, term_clo(FID_PROCESSCHILD_READ_LINE, _nd_7)) == 0) {
      return 0;
    }
    _v_6 = _o_3[0];
    _v_5 = _v_6;
    u64 _nd_8 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_8 + 0] = _x_9;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_5 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _v_5;
      e.mem[_t_5 + 1] = term_clo(FID_MAIN_C85, _nd_8);
      e.mem[_t_5 + 2] = _x_10;
      return term_tsk(FID_IO_BIND, _t_5);
    }
    r0 = _v_5;
    r1 = term_clo(FID_MAIN_C85, _nd_8);
    r2 = _x_10;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C85)
  {
    u32 _x_11 = r0;
    Term _x_12 = r1;
    WL_OPEN
    u32 _o_4 = 0;
    Term _o_5 = 0;
    if (term_aux(_x_12) == CID_NONE) {
      _o_4 = 0;
    } else {
      _o_4 = 1;
      u64 _sp_3 = term_loc(_x_12);
      Term _f_13 = e.mem[_sp_3 + 0];
      heap_free(e, cls_fit(1), _sp_3);
      _o_5 = _f_13;
    }
    if (!DEVICE && !seq && fid_nofk(FID_LINES)) {
      u64 _t_4 = task_node(e, FID_LINES, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = _x_11;
      e.mem[_t_4 + 1] = _o_4;
      e.mem[_t_4 + 2] = _o_5;
      return term_tsk(FID_LINES, _t_4);
    }
    r0 = _x_11;
    r1 = _o_4;
    r2 = _o_5;
    WL_JMP(FID_LINES);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C86)
  {
    Term _x_13 = r0;
    WL_OPEN
    Term _v_7 = 0;
    Term _o_6[1];
    if (spin_12(e, _o_6, 2ull, term_ctr(CID_SCON, STAT_OFF + 98), _x_13) == 0) {
      return 0;
    }
    _v_7 = _o_6[0];
    r0 = _v_7;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C87)
  {
    Term _x_14 = r0;
    WL_OPEN
    Term _v_8 = 0;
    Term _o_7[1];
    if (spin_12(e, _o_7, 2ull, term_ctr(CID_SCON, STAT_OFF + 98), _x_14) == 0) {
      return 0;
    }
    _v_8 = _o_7[0];
    r0 = _v_8;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C88)
  {
    Term _x_15 = r0;
    WL_OPEN
    Term _v_9 = 0;
    Term _o_8[1];
    if (spin_12(e, _o_8, 2ull, term_ctr(CID_SCON, STAT_OFF + 98), _x_15) == 0) {
      return 0;
    }
    _v_9 = _o_8[0];
    r0 = _v_9;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_ARGS)
  {
    Term _k_0 = r0;
    WL_OPEN
    u64 _nd_9 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_9 + 0] = _k_0;
    r0 = term_ctr(CID_IO_ARGS, _nd_9);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_PROCESSCHILD_SPAWN)
  {
    Term _argv_0 = r0;
    Term _cwd_0 = r1;
    Term _stderr_0 = r2;
    Term _k_1 = r3;
    WL_OPEN
    u64 _nd_10 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_10 + 0] = _argv_0;
    e.mem[_nd_10 + 1] = _cwd_0;
    e.mem[_nd_10 + 2] = _stderr_0;
    e.mem[_nd_10 + 3] = _k_1;
    r0 = term_ctr(CID_PROCESSCHILD_SPAWN, _nd_10);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_PROCESSCHILD_CLOSE_STDIN)
  {
    Term _handle_0 = r0;
    Term _k_2 = r1;
    WL_OPEN
    u64 _nd_11 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_11 + 0] = _handle_0;
    e.mem[_nd_11 + 1] = _k_2;
    r0 = term_ctr(CID_PROCESSCHILD_CLOSE_STDIN, _nd_11);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_PROCESSCHILD_READ_LINE)
  {
    Term _handle_1 = r0;
    Term _k_3 = r1;
    WL_OPEN
    u64 _nd_12 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_12 + 0] = _handle_1;
    e.mem[_nd_12 + 1] = _k_3;
    r0 = term_ctr(CID_PROCESSCHILD_READ_LINE, _nd_12);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_PROCESSCHILD_WAIT)
  {
    Term _handle_2 = r0;
    Term _k_4 = r1;
    WL_OPEN
    u64 _nd_13 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_13 + 0] = _handle_2;
    e.mem[_nd_13 + 1] = _k_4;
    r0 = term_ctr(CID_PROCESSCHILD_WAIT, _nd_13);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_PROCESSCHILD_WRITE)
  {
    Term _handle_3 = r0;
    Term _data_0 = r1;
    Term _k_5 = r2;
    WL_OPEN
    u64 _nd_14 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_14 + 0] = _handle_3;
    e.mem[_nd_14 + 1] = _data_0;
    e.mem[_nd_14 + 2] = _k_5;
    r0 = term_ctr(CID_PROCESSCHILD_WRITE, _nd_14);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_PRINT)
  {
    Term _text_0 = r0;
    Term _k_6 = r1;
    WL_OPEN
    u64 _nd_15 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_15 + 0] = _text_0;
    e.mem[_nd_15 + 1] = _k_6;
    r0 = term_ctr(CID_IO_PRINT, _nd_15);
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
#include <errno.h>
#include <fcntl.h>
#include <spawn.h>
#include <sys/wait.h>

extern char **environ;

typedef struct {
  pid_t pid;
  int input;
  FILE *output;
  int reaped;
} BatonChild;

typedef struct {
  BatonChild *child;
  char *args, *cwd, *log, *text;
  size_t length;
  u32 handle, signal;
  int kind, error, eof;
} BatonProcessCall;

static BatonChild **baton_children;
static size_t baton_child_count, baton_child_capacity;

enum { BP_SPAWN, BP_WRITE, BP_CLOSE, BP_READ, BP_WAIT, BP_SIGNAL, BP_PID };

static int baton_pipe(int fds[2]) {
  if (pipe(fds)) return errno;
  if (fcntl(fds[0],F_SETFD,FD_CLOEXEC) < 0 || fcntl(fds[1],F_SETFD,FD_CLOEXEC) < 0) {
    int error=errno; close(fds[0]); close(fds[1]); return error;
  }
  return 0;
}

static void baton_child_spawn(BatonProcessCall *call) {
  if (!call->length || call->args[call->length-1] != 0 || !call->args[0]) {
    call->error=EINVAL; return;
  }
  size_t count=0;
  for(size_t i=0;i<call->length;i++) if(!call->args[i]) count++;
  char **argv=calloc(count+1,sizeof(char *));
  if(!argv) { call->error=ENOMEM; return; }
  size_t index=0, start=0;
  for(size_t i=0;i<call->length;i++) if(!call->args[i]) {
    argv[index++]=call->args+start; start=i+1;
  }
  int in[2], out[2];
  call->error=baton_pipe(in);
  if(call->error) { free(argv); return; }
  call->error=baton_pipe(out);
  if(call->error) { close(in[0]);close(in[1]);free(argv);return; }
  int log=open(call->log,O_CREAT|O_WRONLY|O_APPEND|O_CLOEXEC,0600);
  if(log<0) { call->error=errno; goto pipes; }
  FILE *reader=fdopen(out[0],"r");
  if(!reader) { call->error=errno; close(log); goto pipes; }
  posix_spawn_file_actions_t actions;
  posix_spawnattr_t attr;
  int rc=posix_spawn_file_actions_init(&actions);
  if(rc) { call->error=rc; fclose(reader);out[0]=-1;close(log);goto pipes; }
  rc=posix_spawnattr_init(&attr);
  if(rc) { call->error=rc;posix_spawn_file_actions_destroy(&actions);fclose(reader);out[0]=-1;close(log);goto pipes; }
#define BP_ACTION(expr) do { rc=(expr); if(rc) goto actions_done; } while(0)
  BP_ACTION(posix_spawn_file_actions_addchdir_np(&actions,call->cwd));
  BP_ACTION(posix_spawn_file_actions_adddup2(&actions,in[0],STDIN_FILENO));
  BP_ACTION(posix_spawn_file_actions_adddup2(&actions,out[1],STDOUT_FILENO));
  BP_ACTION(posix_spawn_file_actions_adddup2(&actions,log,STDERR_FILENO));
  BP_ACTION(posix_spawn_file_actions_addclose(&actions,in[0]));
  BP_ACTION(posix_spawn_file_actions_addclose(&actions,in[1]));
  BP_ACTION(posix_spawn_file_actions_addclose(&actions,out[0]));
  BP_ACTION(posix_spawn_file_actions_addclose(&actions,out[1]));
  BP_ACTION(posix_spawn_file_actions_addclose(&actions,log));
  sigset_t defaults;
  sigemptyset(&defaults); sigaddset(&defaults,SIGPIPE);
  BP_ACTION(posix_spawnattr_setsigdefault(&attr,&defaults));
  BP_ACTION(posix_spawnattr_setpgroup(&attr,0));
  BP_ACTION(posix_spawnattr_setflags(&attr,POSIX_SPAWN_SETPGROUP|POSIX_SPAWN_SETSIGDEF));
  rc=posix_spawnp(&call->child->pid,argv[0],&actions,&attr,argv,environ);
actions_done:
#undef BP_ACTION
  posix_spawnattr_destroy(&attr); posix_spawn_file_actions_destroy(&actions); close(log);
  if(rc) { call->error=rc;fclose(reader);out[0]=-1; }
  else {
    call->child->input=in[1];in[1]=-1;
    call->child->output=reader;out[0]=-1;
  }
pipes:
  if(in[0]>=0)close(in[0]); if(in[1]>=0)close(in[1]);
  if(out[0]>=0)close(out[0]); if(out[1]>=0)close(out[1]);
  free(argv);
}

static void baton_process_call(IoWork *w) {
  BatonProcessCall *call=(BatonProcessCall *)w->data;
  BatonChild *child=call->child;
  if(call->kind==BP_SPAWN) { baton_child_spawn(call);return; }
  if(call->kind==BP_WRITE) {
    size_t offset=0;
    while(offset<call->length) {
      ssize_t n=write(child->input,call->text+offset,call->length-offset);
      if(n<0 && errno==EINTR) continue;
      if(n<=0) { call->error=n<0?errno:EIO;break; }
      offset+=(size_t)n;
    }
  } else if(call->kind==BP_CLOSE) {
    if(child->input>=0) {
      if(close(child->input)) call->error=errno;
      child->input=-1;
    }
  } else if(call->kind==BP_READ) {
    if(!child->output) { call->error=EBADF;return; }
    size_t capacity=0;
    ssize_t n;
    do { errno=0;n=getline(&call->text,&capacity,child->output); }
    while(n<0 && errno==EINTR && (clearerr(child->output),1));
    if(n<0) {
      if(feof(child->output)) call->eof=1;
      else call->error=errno?errno:EIO;
    } else {
      call->length=(size_t)n;
      if(call->length && call->text[call->length-1]=='\n') call->length--;
    }
  } else if(call->kind==BP_WAIT) {
    int status;
    pid_t pid;
    do { pid=waitpid(child->pid,&status,0); } while(pid<0 && errno==EINTR);
    if(pid<0) { call->error=errno;return; }
    child->reaped=1;
    if(child->input>=0) {close(child->input);child->input=-1;}
    if(child->output) {fclose(child->output);child->output=NULL;}
    char status_text[64];
    if(WIFEXITED(status)) snprintf(status_text,sizeof(status_text),"exit %d",WEXITSTATUS(status));
    else if(WIFSIGNALED(status)) snprintf(status_text,sizeof(status_text),"signal %d",WTERMSIG(status));
    else { call->error=ECHILD;return; }
    call->text=strdup(status_text);
    if(!call->text) call->error=ENOMEM;
    else call->length=strlen(call->text);
  } else if(call->kind==BP_SIGNAL) {
    if(kill(-child->pid,(int)call->signal)) call->error=errno;
  }
}

static Term baton_process_pack(Env e, IoWork *w) {
  BatonProcessCall *call=(BatonProcessCall *)w->data;
  Term value=term_pak(CID_UNIT,0);
  if(!call->error) {
    if(call->kind==BP_SPAWN) value=(Term)call->handle;
    else if(call->kind==BP_WAIT) value=io_str(e,call->text,call->length);
#ifdef CID_SOME
    else if(call->kind==BP_READ) value=call->eof ? term_pak(CID_NONE,0)
      : io_box(e,CID_SOME,io_str(e,call->text,call->length));
#endif
  }
  Term result=call->error ? io_fail(e,call->error,NULL) : io_done(e,value);
  if(call->kind==BP_SPAWN && call->error) { baton_children[call->handle]=NULL;free(call->child); }
  free(call->args);free(call->cwd);free(call->log);free(call->text);free(call);
  w->data=NULL;
  return result;
}

static Term baton_process_begin(Env e, Term *f, IoWork *w, int kind) {
  BatonProcessCall *call=calloc(1,sizeof(*call));
  if(!call) return io_fail(e,ENOMEM,NULL);
  call->kind=kind;
  if(kind==BP_SPAWN) {
    if(baton_child_count==UINT32_MAX) {free(call);return io_fail(e,ENOMEM,NULL);}
    if(baton_child_count==baton_child_capacity) {
      size_t capacity=baton_child_capacity?baton_child_capacity*2:16;
      BatonChild **next=realloc(baton_children,capacity*sizeof(*next));
      if(!next) {free(call);return io_fail(e,ENOMEM,NULL);}
      baton_children=next;baton_child_capacity=capacity;
    }
    call->child=calloc(1,sizeof(*call->child));
    if(!call->child) {free(call);return io_fail(e,ENOMEM,NULL);}
    call->child->input=-1;
    call->handle=(u32)baton_child_count++;
    baton_children[call->handle]=call->child;
    u64 length=0,cwd_length=0,log_length=0;
    call->args=io_cstr(e,f[0],&length);call->length=length;
    call->cwd=io_cstr(e,f[1],&cwd_length);
    call->log=io_cstr(e,f[2],&log_length);
    if(strlen(call->cwd)!=cwd_length || strlen(call->log)!=log_length) call->error=EINVAL;
  } else {
    call->handle=(u32)f[0];
    if(call->handle>=baton_child_count || !baton_children[call->handle]) {free(call);return io_fail(e,EBADF,NULL);}
    call->child=baton_children[call->handle];
    if(call->child->reaped && kind!=BP_WRITE) {free(call);return io_fail(e,ECHILD,NULL);}
    if(kind==BP_PID) {Term pid=io_done(e,(Term)call->child->pid);free(call);return pid;}
    if(kind==BP_WRITE) {u64 length=0;call->text=io_cstr(e,f[1],&length);call->length=length;}
    if(kind==BP_SIGNAL) call->signal=(u32)f[1];
  }
  w->data=(char *)call;
  if(call->error) return baton_process_pack(e,w);
  return io_work(w,baton_process_call,baton_process_pack);
}

#define BP_EFFECT(name,ID,kind) \
  static Term name##_run(Env e,Term *f,IoWork *w){return baton_process_begin(e,f,w,kind);} \
  static void __attribute__((constructor)) name##_use(void){io_eff(ID,name##_run,0);}
#ifdef CID_PROCESSCHILD_SPAWN
BP_EFFECT(baton_process_spawn,CID_PROCESSCHILD_SPAWN,BP_SPAWN)
#endif
#ifdef CID_PROCESSCHILD_WRITE
BP_EFFECT(baton_process_write,CID_PROCESSCHILD_WRITE,BP_WRITE)
#endif
#ifdef CID_PROCESSCHILD_CLOSE_STDIN
BP_EFFECT(baton_process_close,CID_PROCESSCHILD_CLOSE_STDIN,BP_CLOSE)
#endif
#ifdef CID_PROCESSCHILD_READ_LINE
BP_EFFECT(baton_process_read,CID_PROCESSCHILD_READ_LINE,BP_READ)
#endif
#ifdef CID_PROCESSCHILD_WAIT
BP_EFFECT(baton_process_wait,CID_PROCESSCHILD_WAIT,BP_WAIT)
#endif
#ifdef CID_PROCESSCHILD_SIGNAL
BP_EFFECT(baton_process_signal,CID_PROCESSCHILD_SIGNAL,BP_SIGNAL)
#endif
#ifdef CID_PROCESSCHILD_PID
BP_EFFECT(baton_process_pid,CID_PROCESSCHILD_PID,BP_PID)
#endif
#undef BP_EFFECT
static void __attribute__((constructor)) baton_process_signals(void){signal(SIGPIPE,SIG_IGN);}
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
