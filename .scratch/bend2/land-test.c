
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
#define CID____SRC_GIT_TYPES_RRUN 13
#define CID____SRC_GIT_TYPES_RSPAWN 14
#define CID_NIL 15
#define CID_CON 16
#define CID_CHR 17
#define CID____SRC_GIT_TYPES_SEXIT 18
#define CID____SRC_GIT_TYPES_SSIGNAL 19
#define CID____SRC_GIT_TYPES_GRUN 20
#define CID____SRC_GIT_TYPES_GBROKEN 21
#define CID____SRC_GIT_TYPES_FBRANCHEXISTS 22
#define CID____SRC_GIT_TYPES_FPATHEXISTS 23
#define CID____SRC_GIT_TYPES_FUNKNOWNBASE 24
#define CID____SRC_GIT_TYPES_FTARGETBUSY 25
#define CID____SRC_GIT_TYPES_FCMD 26
#define CID____SRC_GIT_TYPES_WCREATED 27
#define CID____SRC_GIT_TYPES_LLANDED 28
#define CID____SRC_GIT_TYPES_LALREADY 29
#define CID____SRC_GIT_TYPES_LCONFLICT 30
#define CID____SRC_GIT_TYPES_LBLOCKED 31
#define CID____SRC_GIT_CREATE_WORKTREE_CWDONE 32
#define CID____SRC_GIT_CREATE_WORKTREE_CWFAIL 33
#define CID____SRC_GIT_CREATE_WORKTREE_CWNEXT 34
#define CID____SRC_GIT_LAND_LDDONE 35
#define CID____SRC_GIT_LAND_LDFAIL 36
#define CID____SRC_GIT_LAND_LDWK 37
#define CID____SRC_GIT_LAND_LDTIP 38
#define CID____SRC_GIT_LAND_LDCAND 39
#define CID____SRC_GIT_LAND_LDRE 40
#define CID____SRC_GIT_LAND_PV 41
#define CID____SRC_GIT_LAND_VPASS 42
#define CID____SRC_GIT_LAND_VFAIL 43
#define CID____SRC_GIT_LAND_VNONE 44
#define CID____SRC_GIT_LAND_FV 45
#define CID_PROCESS_RUN 46
#define CID_IO_PRINT 47
#define FID____SRC_GIT_LAND_BLOCK_HAS_GO 0
#define FID____SRC_GIT_LAND_BLOCK_HAS_GO_K23 1
#define FID____SRC_GIT_LAND_BLOCK_HAS_GO_K24 2
#define FID____SRC_GIT_LAND_BLOCK_HAS 3
#define FID____SRC_GIT_LAND_NEW_LINES_GO 4
#define FID____SRC_GIT_LAND_NEW_LINES_GO_K52 5
#define FID____SRC_GIT_LAND_LD_UPDATE_PICK 6
#define FID____SRC_GIT_LAND_LD_UPDATE_PICK_K69 7
#define FID____SRC_GIT_LAND_UNJUDGED_LINE 8
#define FID____SRC_GIT_LAND_UNJUDGED_LINE_K71 9
#define FID_IS_UNKNOWN_BASE 10
#define FID_IS_UNKNOWN_BASE_K115 11
#define FID_IS_UNKNOWN_BASE_K116 12
#define FID____SRC_GIT_LAND_PAIR_NEWS 13
#define FID____SRC_GIT_LAND_PAIR_NEWS_K139 14
#define FID____SRC_GIT_LAND_PAIR_NEWS_K140 15
#define FID____SRC_GIT_LAND_PAIR_NEWS_K141 16
#define FID____SRC_GIT_LAND_PAIR_NEWS_K142 17
#define FID____SRC_GIT_LAND_PAIR_NEWS_K143 18
#define FID____SRC_GIT_LAND_RUN_VERDICT 19
#define FID____SRC_GIT_LAND_RUN_VERDICT_K145 20
#define FID____SRC_GIT_TEXT_STARTS_WITH 21
#define FID____SRC_GIT_TEXT_STARTS_WITH_K148 22
#define FID_IS_BUSY_FAIL 23
#define FID_IS_BUSY_FAIL_K167 24
#define FID_IS_BUSY_FAIL_K168 25
#define FID____SRC_GIT_LAND_PAIRS_NEWS_GO 26
#define FID____SRC_GIT_LAND_PAIRS_NEWS_GO_K194 27
#define FID____SRC_GIT_LAND_RUN_CHECK 28
#define FID____SRC_GIT_LAND_RUN_CHECK_K198 29
#define FID____SRC_GIT_LAND_RUN_CHECK_C199 30
#define FID____SRC_GIT_LAND_RUN_CHECK_C200 31
#define FID____SRC_GIT_LAND_RUN_CHECK_K201 32
#define FID____SRC_GIT_LAND_RUN_CHECK_C202 33
#define FID____SRC_GIT_LAND_LINE_NOTHING 34
#define FID_U32_READ_GO 35
#define FID____SRC_GIT_LAND_PAIRS_NEWS 36
#define FID____SRC_GIT_LAND_RUN_PAIR_GO 37
#define FID____SRC_GIT_LAND_RUN_PAIR_GO_C278 38
#define FID____SRC_GIT_LAND_RUN_PAIR_GO_K279 39
#define FID____SRC_GIT_LAND_RUN_PAIR_GO_C280 40
#define FID____SRC_GIT_LAND_RUN_PAIR_GO_C281 41
#define FID____SRC_GIT_LAND_RUN_PAIR_GO_K282 42
#define FID____SRC_GIT_LAND_RUN_PAIR_GO_C283 43
#define FID____SRC_GIT_LAND_RUN_PAIR_GO_C284 44
#define FID____SRC_GIT_LAND_NOTHING_GO 45
#define FID____SRC_GIT_LAND_NOTHING_GO_K286 46
#define FID____SRC_GIT_LAND_NOTHING_GO_K287 47
#define FID____SRC_GIT_LAND_LD_CAND_PICK 48
#define FID____SRC_GIT_LAND_LD_CAND_PICK_K292 49
#define FID____SRC_GIT_LAND_LD_UNMERGED_PICK 50
#define FID____SRC_GIT_LAND_LD_UNMERGED_PICK_K294 51
#define FID_U32_READ 52
#define FID_PARENT_OF 53
#define FID_PARENT_OF_K361 54
#define FID_PARENT_OF_C362 55
#define FID_PARENT_OF_C363 56
#define FID_PARENT_OF_K364 57
#define FID_PARENT_OF_C365 58
#define FID_HEAD_OF_BRANCH 59
#define FID_HEAD_OF_BRANCH_K367 60
#define FID_HEAD_OF_BRANCH_C368 61
#define FID_HEAD_OF_BRANCH_C369 62
#define FID_HEAD_OF_BRANCH_K370 63
#define FID_HEAD_OF_BRANCH_C371 64
#define FID____SRC_GIT_LAND_LD_BUSY_BRANCH 65
#define FID____SRC_GIT_LAND_LD_BUSY_ANY 66
#define FID____SRC_GIT_LAND_LD_BUSY_ANY_K374 67
#define FID____SRC_GIT_LAND_LD_BUSY_ANY_K375 68
#define FID____SRC_GIT_LAND_RUN_PAIRS 69
#define FID____SRC_GIT_LAND_LD_COMMIT_FAIL_GO_C413 70
#define FID____SRC_GIT_LAND_LD_COMMIT_FAIL_GO_C414 71
#define FID____SRC_GIT_LAND_LD_UNMERGED 72
#define FID____SRC_GIT_LAND_LD_UNMERGED_K422 73
#define FID____SRC_GIT_LAND_LD_UNMERGED_C423 74
#define FID____SRC_GIT_LAND_LD_UNMERGED_C424 75
#define FID____SRC_GIT_LAND_LD_UNMERGED_K425 76
#define FID____SRC_GIT_LAND_LD_UNMERGED_C426 77
#define FID____SRC_GIT_TEXT_RUN_RES_NUM 78
#define FID____SRC_GIT_TEXT_RUN_RES_NUM_K429 79
#define FID_IS_CONFLICT_FILE 80
#define FID_IS_CONFLICT_FILE_K540 81
#define FID_IS_CONFLICT_FILE_K541 82
#define FID_IS_CONFLICT_FILE_K542 83
#define FID_IS_CONFLICT_FILE_K543 84
#define FID____SRC_GIT_LAND_LD_ADVANCE 85
#define FID____SRC_GIT_LAND_LD_ADVANCE_K721 86
#define FID____SRC_GIT_LAND_LD_ADVANCE_C722 87
#define FID____SRC_GIT_LAND_LD_ADVANCE_C723 88
#define FID____SRC_GIT_LAND_LD_ADVANCE_K724 89
#define FID____SRC_GIT_LAND_LD_ADVANCE_K725 90
#define FID____SRC_GIT_LAND_LD_ADVANCE_C726 91
#define FID____SRC_GIT_LAND_LD_ADVANCE_K727 92
#define FID____SRC_GIT_LAND_LD_ADVANCE_K728 93
#define FID____SRC_GIT_LAND_LD_ADVANCE_C729 94
#define FID____SRC_GIT_LAND_LD_ADVANCE_C730 95
#define FID____SRC_GIT_LAND_LD_ADVANCE_K731 96
#define FID____SRC_GIT_LAND_LD_ADVANCE_K732 97
#define FID____SRC_GIT_LAND_LD_ADVANCE_K733 98
#define FID____SRC_GIT_LAND_LD_ADVANCE_K734 99
#define FID____SRC_GIT_LAND_LD_ADVANCE_C735 100
#define FID____SRC_GIT_LAND_LD_ADVANCE_C736 101
#define FID____SRC_GIT_LAND_LD_ADVANCE_K737 102
#define FID____SRC_GIT_LAND_LD_ADVANCE_C738 103
#define FID____SRC_GIT_LAND_LD_ADVANCE_K739 104
#define FID____SRC_GIT_LAND_LD_ADVANCE_C740 105
#define FID____SRC_GIT_LAND_LD_ADVANCE_C741 106
#define FID____SRC_GIT_LAND_LD_ADVANCE_K742 107
#define FID____SRC_GIT_LAND_LD_ADVANCE_K743 108
#define FID____SRC_GIT_LAND_LD_ADVANCE_C744 109
#define FID____SRC_GIT_LAND_LD_ADVANCE_C745 110
#define FID____SRC_GIT_LAND_LD_ADVANCE_K746 111
#define FID____SRC_GIT_LAND_LD_ADVANCE_K747 112
#define FID____SRC_GIT_LAND_LD_ADVANCE_C748 113
#define FID____SRC_GIT_LAND_LD_ADVANCE_C749 114
#define FID____SRC_GIT_LAND_LD_ADVANCE_C750 115
#define FID____SRC_GIT_LAND_LD_ADVANCE_C751 116
#define FID____SRC_GIT_LAND_LD_ADVANCE_C752 117
#define FID____SRC_GIT_LAND_LD_ADVANCE_C753 118
#define FID____SRC_GIT_LAND_LD_ADVANCE_C754 119
#define FID____SRC_GIT_LAND_LD_WT_PICK 120
#define FID____SRC_GIT_LAND_LD_WT_PICK_K779 121
#define FID____SRC_GIT_LAND_LD_TIP_OF 122
#define FID____SRC_GIT_LAND_LD_TIP_OF_K781 123
#define FID_IS_BLOCKED 124
#define FID_IS_BLOCKED_K943 125
#define FID_IS_BLOCKED_K944 126
#define FID____SRC_GIT_TYPES_STR_CAT3 127
#define FID____SRC_GIT_TYPES_STR_CAT3_K946 128
#define FID____SRC_GIT_TYPES_STR_CAT2 129
#define FID____SRC_GIT_LAND_LD_RESOLVED_OK_C999 130
#define FID____SRC_GIT_LAND_LD_RESOLVED_OK_C1000 131
#define FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE4_PICK 132
#define FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE4_PICK_K1003 133
#define FID_IS_ALREADY 134
#define FID_IS_ALREADY_K1181 135
#define FID_IS_ALREADY_K1182 136
#define FID____SRC_GIT_TEXT_STR_EQ_GO 137
#define FID____SRC_GIT_TEXT_STR_EQ_GO_K1184 138
#define FID____SRC_GIT_TYPES_FAIL_TEXT 139
#define FID____SRC_GIT_LAND_LD_GO6 140
#define FID____SRC_GIT_LAND_LD_GO6_C1194 141
#define FID____SRC_GIT_LAND_LD_GO6_C1195 142
#define FID____SRC_GIT_LAND_LD_UNREACH_C1196 143
#define FID____SRC_GIT_LAND_LD_GO5 144
#define FID____SRC_GIT_LAND_LD_GO5_C1198 145
#define FID____SRC_GIT_LAND_LD_GO5_C1199 146
#define FID____SRC_GIT_LAND_LD_GO5_K1200 147
#define FID____SRC_GIT_LAND_LD_GO5_K1201 148
#define FID____SRC_GIT_LAND_LD_GO5_C1202 149
#define FID____SRC_GIT_LAND_LD_GO5_C1203 150
#define FID____SRC_GIT_LAND_LD_GO5_K1204 151
#define FID____SRC_GIT_LAND_LD_GO5_C1205 152
#define FID____SRC_GIT_LAND_LD_GO5_C1206 153
#define FID____SRC_GIT_LAND_LD_GO5_K1207 154
#define FID____SRC_GIT_LAND_LD_GO5_K1208 155
#define FID____SRC_GIT_LAND_LD_GO5_K1209 156
#define FID____SRC_GIT_LAND_LD_GO5_C1210 157
#define FID____SRC_GIT_LAND_LD_GO5_C1211 158
#define FID____SRC_GIT_LAND_LD_GO5_C1212 159
#define FID____SRC_GIT_LAND_LD_GO4 160
#define FID____SRC_GIT_LAND_LD_GO4_C1214 161
#define FID____SRC_GIT_LAND_LD_GO4_C1215 162
#define FID____SRC_GIT_LAND_LD_GO4_K1216 163
#define FID____SRC_GIT_LAND_LD_GO4_K1217 164
#define FID____SRC_GIT_LAND_LD_GO4_C1218 165
#define FID____SRC_GIT_LAND_LD_GO4_C1219 166
#define FID____SRC_GIT_LAND_LD_GO4_K1220 167
#define FID____SRC_GIT_LAND_LD_GO4_K1221 168
#define FID____SRC_GIT_LAND_LD_GO4_C1222 169
#define FID____SRC_GIT_LAND_LD_GO4_C1223 170
#define FID____SRC_GIT_LAND_LD_GO4_K1224 171
#define FID____SRC_GIT_LAND_LD_GO4_C1225 172
#define FID____SRC_GIT_LAND_LD_GO4_K1226 173
#define FID____SRC_GIT_LAND_LD_GO4_C1227 174
#define FID____SRC_GIT_LAND_LD_GO3 175
#define FID____SRC_GIT_LAND_LD_GO3_C1229 176
#define FID____SRC_GIT_LAND_LD_GO3_C1230 177
#define FID____SRC_GIT_LAND_LD_GO3_K1231 178
#define FID____SRC_GIT_LAND_LD_GO3_C1232 179
#define FID____SRC_GIT_LAND_LD_GO3_C1233 180
#define FID____SRC_GIT_LAND_LD_GO3_K1234 181
#define FID____SRC_GIT_LAND_LD_GO3_C1235 182
#define FID____SRC_GIT_LAND_LD_GO3_C1236 183
#define FID____SRC_GIT_LAND_LD_GO2 184
#define FID____SRC_GIT_LAND_LD_GO2_C1238 185
#define FID____SRC_GIT_LAND_LD_GO2_C1239 186
#define FID____SRC_GIT_LAND_LD_GO2_K1240 187
#define FID____SRC_GIT_LAND_LD_GO2_C1241 188
#define FID____SRC_GIT_LAND_LD_GO2_C1242 189
#define FID____SRC_GIT_LAND_LD_GO2_K1243 190
#define FID____SRC_GIT_LAND_LD_GO2_C1244 191
#define FID____SRC_GIT_LAND_LD_GO1 192
#define FID____SRC_GIT_LAND_LD_GO1_C1246 193
#define FID____SRC_GIT_LAND_LD_GO1_C1247 194
#define FID____SRC_GIT_LAND_LD_GO1_K1248 195
#define FID____SRC_GIT_LAND_LD_GO1_K1249 196
#define FID____SRC_GIT_LAND_LD_GO1_C1250 197
#define FID____SRC_GIT_LAND_LD_GO1_C1251 198
#define FID____SRC_GIT_LAND_LD_GO1_K1252 199
#define FID____SRC_GIT_LAND_LD_GO1_C1253 200
#define FID____SRC_GIT_LAND_LD_STAGE1 201
#define FID____SRC_GIT_LAND_LD_STAGE1_K1255 202
#define FID____SRC_GIT_LAND_LD_STAGE1_K1256 203
#define FID____SRC_GIT_LAND_LD_STAGE1_C1257 204
#define FID____SRC_GIT_LAND_LD_STAGE1_C1258 205
#define FID____SRC_GIT_LAND_LD_RESOLVED_PICK_C1259 206
#define FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_PICK 207
#define FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_PICK_K1278 208
#define FID_U32_SHOW_GO 209
#define FID____SRC_GIT_TEXT_STR_EQ 210
#define FID_IS_LANDED 211
#define FID_IS_LANDED_K1464 212
#define FID_IS_LANDED_K1465 213
#define FID_IS_LANDED_K1466 214
#define FID____SRC_GIT_LAND_LD_ANSWER_C1489 215
#define FID____SRC_GIT_LAND_LD_ANSWER_C1490 216
#define FID____SRC_GIT_LAND_LD_ANSWER_C1491 217
#define FID____SRC_GIT_LAND_LD_ANSWER_C1492 218
#define FID____SRC_GIT_LAND_LD_ANSWER_C1493 219
#define FID____SRC_GIT_LAND_LD_ANSWER_C1494 220
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO4 221
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C1500 222
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C1501 223
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K1502 224
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C1503 225
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C1504 226
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K1505 227
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C1506 228
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO3 229
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C1508 230
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C1509 231
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_K1510 232
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C1511 233
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C1512 234
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C1513 235
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO2 236
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C1515 237
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C1516 238
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K1517 239
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K1518 240
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C1519 241
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C1520 242
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C1521 243
#define FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1 244
#define FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K1523 245
#define FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K1524 246
#define FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C1525 247
#define FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C1526 248
#define FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K1527 249
#define FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C1528 250
#define FID_BLOB_OF 251
#define FID_BLOB_OF_K1717 252
#define FID_BLOB_OF_K1718 253
#define FID_BLOB_OF_C1719 254
#define FID_BLOB_OF_C1720 255
#define FID_BLOB_OF_K1721 256
#define FID_BLOB_OF_C1722 257
#define FID_HEAD_OF 258
#define FID_HEAD_OF_K1724 259
#define FID_HEAD_OF_C1725 260
#define FID_HEAD_OF_C1726 261
#define FID_HEAD_OF_K1727 262
#define FID_HEAD_OF_C1728 263
#define FID_LAND_OK 264
#define FID_LAND_OK_K1730 265
#define FID_LAND_OK_C1731 266
#define FID_LAND_OK_C1732 267
#define FID_LAND_OK_K1733 268
#define FID_LAND_OK_C1734 269
#define FID_LAND_OK_C1735 270
#define FID_LAND_OK_K1736 271
#define FID_LAND_OK_C1737 272
#define FID_LAND_OK_C1738 273
#define FID_LAND_OK_K1739 274
#define FID_LAND_OK_C1740 275
#define FID_LAND_OK_C1741 276
#define FID_LAND_OK_K1742 277
#define FID_LAND_OK_C1743 278
#define FID_LAND_OK_C1744 279
#define FID_LAND_OK_K1745 280
#define FID_LAND_OK_C1746 281
#define FID_LAND_OK_C1747 282
#define FID_LAND_OK_K1748 283
#define FID_LAND_OK_C1749 284
#define FID_LAND_OK_C1750 285
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE 286
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1752 287
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1753 288
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1754 289
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1755 290
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1756 291
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1757 292
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1758 293
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1759 294
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1760 295
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1761 296
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1762 297
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1763 298
#define FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C1764 299
#define FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C1765 300
#define FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C1766 301
#define FID_U32_SHOW 302
#define FID_AUTHOR 303
#define FID_AUTHOR_K1970 304
#define FID_AUTHOR_C1971 305
#define FID_AUTHOR_C1972 306
#define FID_AUTHOR_K1973 307
#define FID_AUTHOR_C1974 308
#define FID_AUTHOR_C1975 309
#define FID_AUTHOR_K1976 310
#define FID_AUTHOR_C1977 311
#define FID_AUTHOR_C1978 312
#define FID_AUTHOR_K1979 313
#define FID_AUTHOR_C1980 314
#define FID_AUTHOR_C1981 315
#define FID_AUTHOR_K1982 316
#define FID_AUTHOR_C1983 317
#define FID_AUTHOR_C1984 318
#define FID_AUTHOR_K1985 319
#define FID_AUTHOR_C1986 320
#define FID____SRC_GIT_PROCESS_RUNGIT 321
#define FID____SRC_GIT_PROCESS_RUNGIT_K1999 322
#define FID____SRC_GIT_PROCESS_RUNGIT_C2000 323
#define FID____SRC_GIT_PROCESS_RUNGIT_C2001 324
#define FID____SRC_GIT_PROCESS_RUNGIT_C2002 325
#define FID_MOVE_SCRIPT 326
#define FID_MOVE_SCRIPT_K2004 327
#define FID_MOVE_SCRIPT_K2005 328
#define FID_MOVE_SCRIPT_K2006 329
#define FID_MOVE_SCRIPT_K2007 330
#define FID_GIT_SEQ 331
#define FID_GIT_SEQ_C2011 332
#define FID_GIT_SEQ_K2012 333
#define FID_GIT_SEQ_C2013 334
#define FID_GIT_SEQ_C2014 335
#define FID____SRC_GIT_TEXT_JOIN_GO 336
#define FID____SRC_GIT_TEXT_JOIN_GO_K2018 337
#define FID____SRC_GIT_TEXT_JOIN_GO_K2019 338
#define FID____SRC_GIT_TEXT_ENC_ARGV_GO 339
#define FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2025 340
#define FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2026 341
#define FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2027 342
#define FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2028 343
#define FID_SETUP 344
#define FID_SETUP_K2225 345
#define FID_SETUP_C2226 346
#define FID_SETUP_C2227 347
#define FID_SETUP_K2228 348
#define FID_SETUP_C2229 349
#define FID_SETUP_C2230 350
#define FID_SETUP_K2231 351
#define FID_SETUP_C2232 352
#define FID_SETUP_C2233 353
#define FID_SETUP_K2234 354
#define FID_SETUP_C2235 355
#define FID_SETUP_C2236 356
#define FID_SETUP_K2237 357
#define FID_SETUP_C2238 358
#define FID_SETUP_C2239 359
#define FID_SETUP_K2240 360
#define FID_SETUP_C2241 361
#define FID_SETUP_C2242 362
#define FID_SETUP_K2243 363
#define FID_SETUP_C2244 364
#define FID_SETUP_C2245 365
#define FID_SETUP_K2246 366
#define FID_SETUP_K2247 367
#define FID_SETUP_C2248 368
#define FID_SETUP_C2249 369
#define FID_SETUP_K2250 370
#define FID_SETUP_K2251 371
#define FID_SETUP_C2252 372
#define FID_SETUP_C2253 373
#define FID_SETUP_K2254 374
#define FID_SETUP_C2255 375
#define FID_SETUP_C2256 376
#define FID_SETUP_K2257 377
#define FID_SETUP_C2258 378
#define FID_SETUP_C2259 379
#define FID_SETUP_K2260 380
#define FID_SETUP_C2261 381
#define FID_SETUP_C2262 382
#define FID_SETUP_C2263 383
#define FID_SETUP_K2264 384
#define FID_SETUP_K2265 385
#define FID_SETUP_C2266 386
#define FID_SETUP_C2267 387
#define FID_SETUP_K2268 388
#define FID_SETUP_K2269 389
#define FID_SETUP_C2270 390
#define FID_SETUP_C2271 391
#define FID_SETUP_C2272 392
#define FID_STRING_APPEND 393
#define FID_STRING_APPEND_K2274 394
#define FID____SRC_GIT_TEXT_JOIN 395
#define FID____SRC_GIT_TEXT_RUN_RES 396
#define FID____SRC_GIT_TEXT_RUN_RES_K2278 397
#define FID____SRC_GIT_TEXT_RUN_RES_K2279 398
#define FID____SRC_GIT_TEXT_RUN_RES_K2280 399
#define FID____SRC_GIT_TEXT_ENC_ARGV 400
#define FID____SRC_GIT_TEXT_STR_CAT 401
#define FID____SRC_GIT_TEXT_TRIM_NL 402
#define FID_IO_PURE 403
#define FID____SRC_GIT_PROCESS_RUNFULL 404
#define FID____SRC_GIT_PROCESS_RUNFULL_K2487 405
#define FID____SRC_GIT_PROCESS_RUNFULL_C2488 406
#define FID____SRC_GIT_PROCESS_RUNFULL_C2489 407
#define FID____SRC_GIT_PROCESS_RUNFULL_K2490 408
#define FID____SRC_GIT_PROCESS_RUNFULL_C2491 409
#define FID_IO_BIND 410
#define FID_IO_BIND_C2493 411
#define FID_IO_BIND_K2494 412
#define FID_MAIN 413
#define FID_MAIN_K2496 414
#define FID_MAIN_C2497 415
#define FID_MAIN_C2498 416
#define FID_MAIN_K2499 417
#define FID_MAIN_C2500 418
#define FID_MAIN_C2501 419
#define FID_MAIN_C2502 420
#define FID_MAIN_K2503 421
#define FID_MAIN_K2504 422
#define FID_MAIN_C2505 423
#define FID_MAIN_C2506 424
#define FID_MAIN_C2507 425
#define FID_MAIN_K2508 426
#define FID_MAIN_C2509 427
#define FID_MAIN_C2510 428
#define FID_MAIN_K2511 429
#define FID_MAIN_K2512 430
#define FID_MAIN_K2513 431
#define FID_MAIN_C2514 432
#define FID_MAIN_C2515 433
#define FID_MAIN_K2516 434
#define FID_MAIN_K2517 435
#define FID_MAIN_C2518 436
#define FID_MAIN_C2519 437
#define FID_MAIN_K2520 438
#define FID_MAIN_C2521 439
#define FID_MAIN_C2522 440
#define FID_MAIN_K2523 441
#define FID_MAIN_C2524 442
#define FID_MAIN_C2525 443
#define FID_MAIN_K2526 444
#define FID_MAIN_K2527 445
#define FID_MAIN_K2528 446
#define FID_MAIN_K2529 447
#define FID_MAIN_K2530 448
#define FID_MAIN_K2531 449
#define FID_MAIN_C2532 450
#define FID_MAIN_C2533 451
#define FID_MAIN_K2534 452
#define FID_MAIN_C2535 453
#define FID_MAIN_C2536 454
#define FID_MAIN_C2537 455
#define FID_MAIN_K2538 456
#define FID_MAIN_K2539 457
#define FID_MAIN_K2540 458
#define FID_MAIN_C2541 459
#define FID_MAIN_C2542 460
#define FID_MAIN_K2543 461
#define FID_MAIN_K2544 462
#define FID_MAIN_C2545 463
#define FID_MAIN_C2546 464
#define FID_MAIN_K2547 465
#define FID_MAIN_C2548 466
#define FID_MAIN_C2549 467
#define FID_MAIN_K2550 468
#define FID_MAIN_C2551 469
#define FID_MAIN_C2552 470
#define FID_MAIN_C2553 471
#define FID_MAIN_K2554 472
#define FID_MAIN_C2555 473
#define FID_MAIN_C2556 474
#define FID_MAIN_C2557 475
#define FID_MAIN_K2558 476
#define FID_MAIN_K2559 477
#define FID_MAIN_K2560 478
#define FID_MAIN_K2561 479
#define FID_MAIN_C2562 480
#define FID_MAIN_C2563 481
#define FID_MAIN_K2564 482
#define FID_MAIN_K2565 483
#define FID_MAIN_C2566 484
#define FID_MAIN_C2567 485
#define FID_MAIN_K2568 486
#define FID_MAIN_C2569 487
#define FID_MAIN_C2570 488
#define FID_MAIN_K2571 489
#define FID_MAIN_C2572 490
#define FID_MAIN_C2573 491
#define FID_MAIN_K2574 492
#define FID_MAIN_C2575 493
#define FID_MAIN_C2576 494
#define FID_MAIN_C2577 495
#define FID_MAIN_K2578 496
#define FID_MAIN_C2579 497
#define FID_MAIN_C2580 498
#define FID_MAIN_C2581 499
#define FID_MAIN_K2582 500
#define FID_MAIN_K2583 501
#define FID_MAIN_K2584 502
#define FID_MAIN_K2585 503
#define FID_MAIN_C2586 504
#define FID_MAIN_C2587 505
#define FID_MAIN_K2588 506
#define FID_MAIN_K2589 507
#define FID_MAIN_C2590 508
#define FID_MAIN_C2591 509
#define FID_MAIN_K2592 510
#define FID_MAIN_C2593 511
#define FID_MAIN_C2594 512
#define FID_MAIN_C2595 513
#define FID_MAIN_K2596 514
#define FID_MAIN_K2597 515
#define FID_MAIN_C2598 516
#define FID_MAIN_C2599 517
#define FID_MAIN_K2600 518
#define FID_MAIN_C2601 519
#define FID_MAIN_C2602 520
#define FID_MAIN_K2603 521
#define FID_MAIN_K2604 522
#define FID_MAIN_C2605 523
#define FID_MAIN_C2606 524
#define FID_MAIN_K2607 525
#define FID_MAIN_K2608 526
#define FID_MAIN_C2609 527
#define FID_MAIN_C2610 528
#define FID_MAIN_K2611 529
#define FID_MAIN_C2612 530
#define FID_MAIN_C2613 531
#define FID_MAIN_K2614 532
#define FID_MAIN_C2615 533
#define FID_MAIN_C2616 534
#define FID_MAIN_K2617 535
#define FID_MAIN_C2618 536
#define FID_MAIN_C2619 537
#define FID_MAIN_K2620 538
#define FID_MAIN_C2621 539
#define FID_MAIN_C2622 540
#define FID_MAIN_K2623 541
#define FID_MAIN_C2624 542
#define FID_MAIN_C2625 543
#define FID_MAIN_C2626 544
#define FID_MAIN_K2627 545
#define FID_MAIN_C2628 546
#define FID_MAIN_C2629 547
#define FID_MAIN_C2630 548
#define FID_MAIN_K2631 549
#define FID_MAIN_C2632 550
#define FID_MAIN_C2633 551
#define FID_MAIN_C2634 552
#define FID_MAIN_K2635 553
#define FID_MAIN_C2636 554
#define FID_MAIN_C2637 555
#define FID_MAIN_C2638 556
#define FID_MAIN_K2639 557
#define FID_MAIN_K2640 558
#define FID_MAIN_K2641 559
#define FID_MAIN_K2642 560
#define FID_MAIN_K2643 561
#define FID_MAIN_C2644 562
#define FID_MAIN_C2645 563
#define FID_MAIN_K2646 564
#define FID_MAIN_C2647 565
#define FID_MAIN_C2648 566
#define FID_MAIN_K2649 567
#define FID_MAIN_K2650 568
#define FID_MAIN_C2651 569
#define FID_MAIN_C2652 570
#define FID_MAIN_K2653 571
#define FID_MAIN_K2654 572
#define FID_MAIN_C2655 573
#define FID_MAIN_C2656 574
#define FID_MAIN_K2657 575
#define FID_MAIN_C2658 576
#define FID_MAIN_C2659 577
#define FID_MAIN_K2660 578
#define FID_MAIN_C2661 579
#define FID_MAIN_C2662 580
#define FID_MAIN_C2663 581
#define FID_MAIN_K2664 582
#define FID_MAIN_C2665 583
#define FID_MAIN_C2666 584
#define FID_MAIN_C2667 585
#define FID_MAIN_K2668 586
#define FID_MAIN_K2669 587
#define FID_MAIN_K2670 588
#define FID_MAIN_K2671 589
#define FID_MAIN_C2672 590
#define FID_MAIN_C2673 591
#define FID_MAIN_K2674 592
#define FID_MAIN_C2675 593
#define FID_MAIN_C2676 594
#define FID_MAIN_K2677 595
#define FID_MAIN_K2678 596
#define FID_MAIN_C2679 597
#define FID_MAIN_C2680 598
#define FID_MAIN_K2681 599
#define FID_MAIN_K2682 600
#define FID_MAIN_C2683 601
#define FID_MAIN_C2684 602
#define FID_MAIN_K2685 603
#define FID_MAIN_C2686 604
#define FID_MAIN_C2687 605
#define FID_MAIN_C2688 606
#define FID_MAIN_K2689 607
#define FID_MAIN_K2690 608
#define FID_MAIN_C2691 609
#define FID_MAIN_C2692 610
#define FID_MAIN_K2693 611
#define FID_MAIN_K2694 612
#define FID_MAIN_K2695 613
#define FID_MAIN_C2696 614
#define FID_MAIN_C2697 615
#define FID_MAIN_K2698 616
#define FID_MAIN_C2699 617
#define FID_MAIN_C2700 618
#define FID_MAIN_C2701 619
#define FID_MAIN_K2702 620
#define FID_MAIN_K2703 621
#define FID_MAIN_C2704 622
#define FID_PROCESS_RUN 623
#define FID_IO_PRINT 624
#define FID_IO_EMIT 625
#define FID_CLO_APPLY 626
#define FID_EXIT 627
#define FID_ENTER 628
CONSTV u8 FID_ARITY_T[] = { 2, 4, 2, 2, 3, 5, 5, 4, 2, 1, 4, 1, 1, 6, 2, 2, 2, 2, 2, 5, 3, 2, 2, 4, 1, 1, 2, 2, 3, 2, 3, 2, 3, 4, 1, 2, 1, 5, 2, 7, 8, 7, 10, 11, 10, 1, 2, 2, 4, 3, 5, 4, 1, 1, 1, 2, 1, 1, 2, 2, 1, 2, 1, 1, 2, 1, 2, 4, 2, 4, 2, 2, 2, 3, 4, 3, 4, 5, 3, 4, 5, 2, 2, 1, 1, 6, 7, 8, 7, 8, 8, 2, 7, 7, 8, 7, 7, 8, 5, 3, 4, 3, 4, 5, 5, 6, 5, 6, 4, 5, 4, 4, 1, 2, 3, 1, 2, 2, 2, 2, 5, 4, 4, 3, 4, 1, 1, 3, 2, 2, 2, 2, 6, 1, 4, 1, 1, 2, 2, 3, 7, 4, 4, 1, 9, 4, 4, 8, 9, 10, 9, 6, 7, 6, 6, 1, 1, 2, 1, 2, 5, 4, 4, 4, 4, 5, 4, 5, 2, 3, 2, 4, 5, 4, 2, 5, 4, 4, 4, 5, 4, 5, 3, 2, 6, 4, 4, 3, 4, 3, 4, 5, 6, 4, 4, 3, 2, 3, 2, 4, 5, 3, 4, 4, 5, 4, 2, 4, 1, 3, 2, 5, 2, 1, 1, 4, 4, 1, 1, 1, 1, 7, 4, 4, 4, 5, 4, 4, 5, 7, 4, 4, 3, 4, 3, 7, 7, 4, 4, 4, 3, 4, 3, 6, 4, 3, 2, 3, 2, 4, 5, 2, 2, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 2, 6, 6, 7, 6, 6, 7, 6, 6, 7, 6, 6, 7, 6, 6, 7, 6, 4, 5, 4, 1, 2, 1, 4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 1, 2, 1, 4, 4, 1, 1, 5, 3, 4, 3, 2, 3, 2, 2, 3, 2, 2, 3, 2, 1, 2, 1, 1, 2, 2, 1, 2, 1, 5, 3, 3, 2, 2, 1, 2, 1, 3, 4, 3, 3, 4, 3, 2, 4, 4, 3, 2, 1, 2, 3, 2, 2, 3, 2, 2, 3, 2, 2, 3, 2, 2, 3, 2, 2, 3, 2, 2, 3, 2, 2, 2, 3, 2, 2, 2, 3, 2, 2, 3, 2, 2, 3, 2, 2, 3, 2, 2, 3, 3, 4, 3, 3, 2, 3, 2, 2, 2, 2, 2, 3, 2, 4, 4, 1, 2, 1, 2, 2, 2, 3, 1, 4, 5, 3, 3, 2, 0, 1, 2, 1, 1, 2, 2, 1, 2, 1, 2, 2, 1, 2, 3, 2, 2, 4, 4, 5, 4, 5, 5, 6, 5, 9, 10, 9, 10, 11, 10, 7, 8, 6, 5, 6, 6, 7, 6, 6, 7, 2, 6, 5, 5, 5, 6, 5, 6, 5, 6, 5, 9, 10, 9, 6, 7, 2, 6, 6, 6, 2, 5, 4, 3, 4, 4, 5, 4, 5, 4, 5, 4, 8, 9, 8, 9, 10, 9, 5, 6, 2, 5, 6, 6, 2, 5, 4, 3, 4, 3, 4, 3, 4, 3, 4, 3, 3, 4, 2, 3, 2, 3, 4, 3, 4, 5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 8, 9, 8, 9, 10, 9, 10, 11, 10, 11, 12, 11, 7, 8, 2, 7, 7, 7, 2, 6, 7, 7, 2, 6, 7, 7, 2, 6, 5, 4, 3, 2, 3, 4, 3, 4, 5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 8, 9, 8, 5, 6, 2, 5, 5, 5, 2, 4, 3, 2, 3, 3, 4, 3, 3, 4, 3, 4, 3, 4, 3, 4, 3, 4, 3, 3, 4, 2, 3, 4, 4, 5, 4, 2, 3, 2, 3, 2, 2, 3, 2, 2, 1, 1, 2, 3, 2, 1, 2 };
CONSTV u8 FID_FLAG_T[] = { 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2 };
CONSTV u8 FID_RESW_T[] = { 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 0, 3, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 4, 0, 0, 2, 0, 1, 1, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 4, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 4, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 4, 0, 0, 0, 0, 1, 1, 0, 0, 4, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 4, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 4, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 4, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0 };
CONSTV u8 CID_ARITY_T[] = { 2, 0, 2, 2, 1, 2, 1, 1, 0, 1, 0, 0, 0, 3, 1, 0, 2, 1, 1, 1, 2, 1, 1, 1, 1, 1, 2, 3, 2, 1, 2, 1, 3, 3, 1, 3, 3, 1, 2, 2, 2, 5, 0, 1, 1, 3, 3, 2 };
CONSTV u8 CID_HOT_T[] = { 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };
#define STAT_LEN 4584

#define WL_RESW 4
#define BANGS   0

#define WL_BANK Term r0, r1, r2, r3, r4, r5, rp, r6, r7, r8, r9, r10, r11;

#define WL_LOAD(A, N) \
  do { \
    if ((N) <= 0) break; r0 = e.mem[(A) + 0]; \
    if ((N) <= 1) break; r1 = e.mem[(A) + 1]; \
    if ((N) <= 2) break; r2 = e.mem[(A) + 2]; \
    if ((N) <= 3) break; r3 = e.mem[(A) + 3]; \
    if ((N) <= 4) break; r4 = e.mem[(A) + 4]; \
    if ((N) <= 5) break; r5 = e.mem[(A) + 5]; \
    if ((N) <= 6) break; r6 = e.mem[(A) + 6]; \
    if ((N) <= 7) break; r7 = e.mem[(A) + 7]; \
    if ((N) <= 8) break; r8 = e.mem[(A) + 8]; \
    if ((N) <= 9) break; r9 = e.mem[(A) + 9]; \
    if ((N) <= 10) break; r10 = e.mem[(A) + 10]; \
    if ((N) <= 11) break; r11 = e.mem[(A) + 11]; \
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
    case 5: r5 = (X); \
      break; \
    case 6: r6 = (X); \
      break; \
    case 7: r7 = (X); \
      break; \
    case 8: r8 = (X); \
      break; \
    case 9: r9 = (X); \
      break; \
    case 10: r10 = (X); \
      break; \
    case 11: r11 = (X); \
      break; \
  }

#define WL_SAVE(V) (V)[0] = r0; (V)[1] = r1; (V)[2] = r2; (V)[3] = r3;

#define WL_TAKE(V) r0 = (V)[0]; r1 = (V)[1]; r2 = (V)[2]; r3 = (V)[3];

#define WL_SIG Env e, Stk sp, u32 seq, u32 rn, Term r0, Term r1, Term r2, Term r3, Term r4, Term r5, Term rp, Term r6, Term r7, Term r8, Term r9, Term r10, Term r11

#define WL_ALL e, sp, seq, rn, r0, r1, r2, r3, r4, r5, rp, r6, r7, r8, r9, r10, r11

#define WL_TABLE WL_X(FID____SRC_GIT_LAND_BLOCK_HAS_GO) WL_X(FID____SRC_GIT_LAND_BLOCK_HAS_GO_K23) WL_X(FID____SRC_GIT_LAND_BLOCK_HAS_GO_K24) WL_X(FID____SRC_GIT_LAND_BLOCK_HAS) WL_X(FID____SRC_GIT_LAND_NEW_LINES_GO) WL_X(FID____SRC_GIT_LAND_NEW_LINES_GO_K52) WL_X(FID____SRC_GIT_LAND_LD_UPDATE_PICK) WL_X(FID____SRC_GIT_LAND_LD_UPDATE_PICK_K69) WL_X(FID____SRC_GIT_LAND_UNJUDGED_LINE) WL_X(FID____SRC_GIT_LAND_UNJUDGED_LINE_K71) WL_X(FID_IS_UNKNOWN_BASE) WL_X(FID_IS_UNKNOWN_BASE_K115) WL_X(FID_IS_UNKNOWN_BASE_K116) WL_X(FID____SRC_GIT_LAND_PAIR_NEWS) WL_X(FID____SRC_GIT_LAND_PAIR_NEWS_K139) WL_X(FID____SRC_GIT_LAND_PAIR_NEWS_K140) WL_X(FID____SRC_GIT_LAND_PAIR_NEWS_K141) WL_X(FID____SRC_GIT_LAND_PAIR_NEWS_K142) WL_X(FID____SRC_GIT_LAND_PAIR_NEWS_K143) WL_X(FID____SRC_GIT_LAND_RUN_VERDICT) WL_X(FID____SRC_GIT_LAND_RUN_VERDICT_K145) WL_X(FID____SRC_GIT_TEXT_STARTS_WITH) WL_X(FID____SRC_GIT_TEXT_STARTS_WITH_K148) WL_X(FID_IS_BUSY_FAIL) WL_X(FID_IS_BUSY_FAIL_K167) WL_X(FID_IS_BUSY_FAIL_K168) WL_X(FID____SRC_GIT_LAND_PAIRS_NEWS_GO) WL_X(FID____SRC_GIT_LAND_PAIRS_NEWS_GO_K194) WL_X(FID____SRC_GIT_LAND_RUN_CHECK) WL_X(FID____SRC_GIT_LAND_RUN_CHECK_K198) WL_X(FID____SRC_GIT_LAND_RUN_CHECK_C199) WL_X(FID____SRC_GIT_LAND_RUN_CHECK_C200) WL_X(FID____SRC_GIT_LAND_RUN_CHECK_K201) WL_X(FID____SRC_GIT_LAND_RUN_CHECK_C202) WL_X(FID____SRC_GIT_LAND_LINE_NOTHING) WL_X(FID_U32_READ_GO) WL_X(FID____SRC_GIT_LAND_PAIRS_NEWS) WL_X(FID____SRC_GIT_LAND_RUN_PAIR_GO) WL_X(FID____SRC_GIT_LAND_RUN_PAIR_GO_C278) WL_X(FID____SRC_GIT_LAND_RUN_PAIR_GO_K279) WL_X(FID____SRC_GIT_LAND_RUN_PAIR_GO_C280) WL_X(FID____SRC_GIT_LAND_RUN_PAIR_GO_C281) WL_X(FID____SRC_GIT_LAND_RUN_PAIR_GO_K282) WL_X(FID____SRC_GIT_LAND_RUN_PAIR_GO_C283) WL_X(FID____SRC_GIT_LAND_RUN_PAIR_GO_C284) WL_X(FID____SRC_GIT_LAND_NOTHING_GO) WL_X(FID____SRC_GIT_LAND_NOTHING_GO_K286) WL_X(FID____SRC_GIT_LAND_NOTHING_GO_K287) WL_X(FID____SRC_GIT_LAND_LD_CAND_PICK) WL_X(FID____SRC_GIT_LAND_LD_CAND_PICK_K292) WL_X(FID____SRC_GIT_LAND_LD_UNMERGED_PICK) WL_X(FID____SRC_GIT_LAND_LD_UNMERGED_PICK_K294) WL_X(FID_U32_READ) WL_X(FID_PARENT_OF) WL_X(FID_PARENT_OF_K361) WL_X(FID_PARENT_OF_C362) WL_X(FID_PARENT_OF_C363) WL_X(FID_PARENT_OF_K364) WL_X(FID_PARENT_OF_C365) WL_X(FID_HEAD_OF_BRANCH) WL_X(FID_HEAD_OF_BRANCH_K367) WL_X(FID_HEAD_OF_BRANCH_C368) WL_X(FID_HEAD_OF_BRANCH_C369) WL_X(FID_HEAD_OF_BRANCH_K370) WL_X(FID_HEAD_OF_BRANCH_C371) WL_X(FID____SRC_GIT_LAND_LD_BUSY_BRANCH) WL_X(FID____SRC_GIT_LAND_LD_BUSY_ANY) WL_X(FID____SRC_GIT_LAND_LD_BUSY_ANY_K374) WL_X(FID____SRC_GIT_LAND_LD_BUSY_ANY_K375) WL_X(FID____SRC_GIT_LAND_RUN_PAIRS) WL_X(FID____SRC_GIT_LAND_LD_COMMIT_FAIL_GO_C413) WL_X(FID____SRC_GIT_LAND_LD_COMMIT_FAIL_GO_C414) WL_X(FID____SRC_GIT_LAND_LD_UNMERGED) WL_X(FID____SRC_GIT_LAND_LD_UNMERGED_K422) WL_X(FID____SRC_GIT_LAND_LD_UNMERGED_C423) WL_X(FID____SRC_GIT_LAND_LD_UNMERGED_C424) WL_X(FID____SRC_GIT_LAND_LD_UNMERGED_K425) WL_X(FID____SRC_GIT_LAND_LD_UNMERGED_C426) WL_X(FID____SRC_GIT_TEXT_RUN_RES_NUM) WL_X(FID____SRC_GIT_TEXT_RUN_RES_NUM_K429) WL_X(FID_IS_CONFLICT_FILE) WL_X(FID_IS_CONFLICT_FILE_K540) WL_X(FID_IS_CONFLICT_FILE_K541) WL_X(FID_IS_CONFLICT_FILE_K542) WL_X(FID_IS_CONFLICT_FILE_K543) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_K721) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_C722) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_C723) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_K724) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_K725) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_C726) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_K727) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_K728) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_C729) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_C730) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_K731) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_K732) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_K733) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_K734) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_C735) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_C736) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_K737) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_C738) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_K739) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_C740) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_C741) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_K742) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_K743) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_C744) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_C745) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_K746) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_K747) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_C748) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_C749) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_C750) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_C751) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_C752) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_C753) WL_X(FID____SRC_GIT_LAND_LD_ADVANCE_C754) WL_X(FID____SRC_GIT_LAND_LD_WT_PICK) WL_X(FID____SRC_GIT_LAND_LD_WT_PICK_K779) WL_X(FID____SRC_GIT_LAND_LD_TIP_OF) WL_X(FID____SRC_GIT_LAND_LD_TIP_OF_K781) WL_X(FID_IS_BLOCKED) WL_X(FID_IS_BLOCKED_K943) WL_X(FID_IS_BLOCKED_K944) WL_X(FID____SRC_GIT_TYPES_STR_CAT3) WL_X(FID____SRC_GIT_TYPES_STR_CAT3_K946) WL_X(FID____SRC_GIT_TYPES_STR_CAT2) WL_X(FID____SRC_GIT_LAND_LD_RESOLVED_OK_C999) WL_X(FID____SRC_GIT_LAND_LD_RESOLVED_OK_C1000) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE4_PICK) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE4_PICK_K1003) WL_X(FID_IS_ALREADY) WL_X(FID_IS_ALREADY_K1181) WL_X(FID_IS_ALREADY_K1182) WL_X(FID____SRC_GIT_TEXT_STR_EQ_GO) WL_X(FID____SRC_GIT_TEXT_STR_EQ_GO_K1184) WL_X(FID____SRC_GIT_TYPES_FAIL_TEXT) WL_X(FID____SRC_GIT_LAND_LD_GO6) WL_X(FID____SRC_GIT_LAND_LD_GO6_C1194) WL_X(FID____SRC_GIT_LAND_LD_GO6_C1195) WL_X(FID____SRC_GIT_LAND_LD_UNREACH_C1196) WL_X(FID____SRC_GIT_LAND_LD_GO5) WL_X(FID____SRC_GIT_LAND_LD_GO5_C1198) WL_X(FID____SRC_GIT_LAND_LD_GO5_C1199) WL_X(FID____SRC_GIT_LAND_LD_GO5_K1200) WL_X(FID____SRC_GIT_LAND_LD_GO5_K1201) WL_X(FID____SRC_GIT_LAND_LD_GO5_C1202) WL_X(FID____SRC_GIT_LAND_LD_GO5_C1203) WL_X(FID____SRC_GIT_LAND_LD_GO5_K1204) WL_X(FID____SRC_GIT_LAND_LD_GO5_C1205) WL_X(FID____SRC_GIT_LAND_LD_GO5_C1206) WL_X(FID____SRC_GIT_LAND_LD_GO5_K1207) WL_X(FID____SRC_GIT_LAND_LD_GO5_K1208) WL_X(FID____SRC_GIT_LAND_LD_GO5_K1209) WL_X(FID____SRC_GIT_LAND_LD_GO5_C1210) WL_X(FID____SRC_GIT_LAND_LD_GO5_C1211) WL_X(FID____SRC_GIT_LAND_LD_GO5_C1212) WL_X(FID____SRC_GIT_LAND_LD_GO4) WL_X(FID____SRC_GIT_LAND_LD_GO4_C1214) WL_X(FID____SRC_GIT_LAND_LD_GO4_C1215) WL_X(FID____SRC_GIT_LAND_LD_GO4_K1216) WL_X(FID____SRC_GIT_LAND_LD_GO4_K1217) WL_X(FID____SRC_GIT_LAND_LD_GO4_C1218) WL_X(FID____SRC_GIT_LAND_LD_GO4_C1219) WL_X(FID____SRC_GIT_LAND_LD_GO4_K1220) WL_X(FID____SRC_GIT_LAND_LD_GO4_K1221) WL_X(FID____SRC_GIT_LAND_LD_GO4_C1222) WL_X(FID____SRC_GIT_LAND_LD_GO4_C1223) WL_X(FID____SRC_GIT_LAND_LD_GO4_K1224) WL_X(FID____SRC_GIT_LAND_LD_GO4_C1225) WL_X(FID____SRC_GIT_LAND_LD_GO4_K1226) WL_X(FID____SRC_GIT_LAND_LD_GO4_C1227) WL_X(FID____SRC_GIT_LAND_LD_GO3) WL_X(FID____SRC_GIT_LAND_LD_GO3_C1229) WL_X(FID____SRC_GIT_LAND_LD_GO3_C1230) WL_X(FID____SRC_GIT_LAND_LD_GO3_K1231) WL_X(FID____SRC_GIT_LAND_LD_GO3_C1232) WL_X(FID____SRC_GIT_LAND_LD_GO3_C1233) WL_X(FID____SRC_GIT_LAND_LD_GO3_K1234) WL_X(FID____SRC_GIT_LAND_LD_GO3_C1235) WL_X(FID____SRC_GIT_LAND_LD_GO3_C1236) WL_X(FID____SRC_GIT_LAND_LD_GO2) WL_X(FID____SRC_GIT_LAND_LD_GO2_C1238) WL_X(FID____SRC_GIT_LAND_LD_GO2_C1239) WL_X(FID____SRC_GIT_LAND_LD_GO2_K1240) WL_X(FID____SRC_GIT_LAND_LD_GO2_C1241) WL_X(FID____SRC_GIT_LAND_LD_GO2_C1242) WL_X(FID____SRC_GIT_LAND_LD_GO2_K1243) WL_X(FID____SRC_GIT_LAND_LD_GO2_C1244) WL_X(FID____SRC_GIT_LAND_LD_GO1) WL_X(FID____SRC_GIT_LAND_LD_GO1_C1246) WL_X(FID____SRC_GIT_LAND_LD_GO1_C1247) WL_X(FID____SRC_GIT_LAND_LD_GO1_K1248) WL_X(FID____SRC_GIT_LAND_LD_GO1_K1249) WL_X(FID____SRC_GIT_LAND_LD_GO1_C1250) WL_X(FID____SRC_GIT_LAND_LD_GO1_C1251) WL_X(FID____SRC_GIT_LAND_LD_GO1_K1252) WL_X(FID____SRC_GIT_LAND_LD_GO1_C1253) WL_X(FID____SRC_GIT_LAND_LD_STAGE1) WL_X(FID____SRC_GIT_LAND_LD_STAGE1_K1255) WL_X(FID____SRC_GIT_LAND_LD_STAGE1_K1256) WL_X(FID____SRC_GIT_LAND_LD_STAGE1_C1257) WL_X(FID____SRC_GIT_LAND_LD_STAGE1_C1258) WL_X(FID____SRC_GIT_LAND_LD_RESOLVED_PICK_C1259) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_PICK) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_PICK_K1278) WL_X(FID_U32_SHOW_GO) WL_X(FID____SRC_GIT_TEXT_STR_EQ) WL_X(FID_IS_LANDED) WL_X(FID_IS_LANDED_K1464) WL_X(FID_IS_LANDED_K1465) WL_X(FID_IS_LANDED_K1466) WL_X(FID____SRC_GIT_LAND_LD_ANSWER_C1489) WL_X(FID____SRC_GIT_LAND_LD_ANSWER_C1490) WL_X(FID____SRC_GIT_LAND_LD_ANSWER_C1491) WL_X(FID____SRC_GIT_LAND_LD_ANSWER_C1492) WL_X(FID____SRC_GIT_LAND_LD_ANSWER_C1493) WL_X(FID____SRC_GIT_LAND_LD_ANSWER_C1494) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C1500) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C1501) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K1502) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C1503) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C1504) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K1505) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C1506) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C1508) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C1509) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_K1510) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C1511) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C1512) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C1513) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C1515) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C1516) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K1517) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K1518) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C1519) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C1520) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C1521) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K1523) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K1524) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C1525) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C1526) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K1527) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C1528) WL_X(FID_BLOB_OF) WL_X(FID_BLOB_OF_K1717) WL_X(FID_BLOB_OF_K1718) WL_X(FID_BLOB_OF_C1719) WL_X(FID_BLOB_OF_C1720) WL_X(FID_BLOB_OF_K1721) WL_X(FID_BLOB_OF_C1722) WL_X(FID_HEAD_OF) WL_X(FID_HEAD_OF_K1724) WL_X(FID_HEAD_OF_C1725) WL_X(FID_HEAD_OF_C1726) WL_X(FID_HEAD_OF_K1727) WL_X(FID_HEAD_OF_C1728) WL_X(FID_LAND_OK) WL_X(FID_LAND_OK_K1730) WL_X(FID_LAND_OK_C1731) WL_X(FID_LAND_OK_C1732) WL_X(FID_LAND_OK_K1733) WL_X(FID_LAND_OK_C1734) WL_X(FID_LAND_OK_C1735) WL_X(FID_LAND_OK_K1736) WL_X(FID_LAND_OK_C1737) WL_X(FID_LAND_OK_C1738) WL_X(FID_LAND_OK_K1739) WL_X(FID_LAND_OK_C1740) WL_X(FID_LAND_OK_C1741) WL_X(FID_LAND_OK_K1742) WL_X(FID_LAND_OK_C1743) WL_X(FID_LAND_OK_C1744) WL_X(FID_LAND_OK_K1745) WL_X(FID_LAND_OK_C1746) WL_X(FID_LAND_OK_C1747) WL_X(FID_LAND_OK_K1748) WL_X(FID_LAND_OK_C1749) WL_X(FID_LAND_OK_C1750) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1752) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1753) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1754) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1755) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1756) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1757) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1758) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1759) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1760) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1761) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1762) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1763) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C1764) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C1765) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C1766) WL_X(FID_U32_SHOW) WL_X(FID_AUTHOR) WL_X(FID_AUTHOR_K1970) WL_X(FID_AUTHOR_C1971) WL_X(FID_AUTHOR_C1972) WL_X(FID_AUTHOR_K1973) WL_X(FID_AUTHOR_C1974) WL_X(FID_AUTHOR_C1975) WL_X(FID_AUTHOR_K1976) WL_X(FID_AUTHOR_C1977) WL_X(FID_AUTHOR_C1978) WL_X(FID_AUTHOR_K1979) WL_X(FID_AUTHOR_C1980) WL_X(FID_AUTHOR_C1981) WL_X(FID_AUTHOR_K1982) WL_X(FID_AUTHOR_C1983) WL_X(FID_AUTHOR_C1984) WL_X(FID_AUTHOR_K1985) WL_X(FID_AUTHOR_C1986) WL_X(FID____SRC_GIT_PROCESS_RUNGIT) WL_X(FID____SRC_GIT_PROCESS_RUNGIT_K1999) WL_X(FID____SRC_GIT_PROCESS_RUNGIT_C2000) WL_X(FID____SRC_GIT_PROCESS_RUNGIT_C2001) WL_X(FID____SRC_GIT_PROCESS_RUNGIT_C2002) WL_X(FID_MOVE_SCRIPT) WL_X(FID_MOVE_SCRIPT_K2004) WL_X(FID_MOVE_SCRIPT_K2005) WL_X(FID_MOVE_SCRIPT_K2006) WL_X(FID_MOVE_SCRIPT_K2007) WL_X(FID_GIT_SEQ) WL_X(FID_GIT_SEQ_C2011) WL_X(FID_GIT_SEQ_K2012) WL_X(FID_GIT_SEQ_C2013) WL_X(FID_GIT_SEQ_C2014) WL_X(FID____SRC_GIT_TEXT_JOIN_GO) WL_X(FID____SRC_GIT_TEXT_JOIN_GO_K2018) WL_X(FID____SRC_GIT_TEXT_JOIN_GO_K2019) WL_X(FID____SRC_GIT_TEXT_ENC_ARGV_GO) WL_X(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2025) WL_X(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2026) WL_X(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2027) WL_X(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2028) WL_X(FID_SETUP) WL_X(FID_SETUP_K2225) WL_X(FID_SETUP_C2226) WL_X(FID_SETUP_C2227) WL_X(FID_SETUP_K2228) WL_X(FID_SETUP_C2229) WL_X(FID_SETUP_C2230) WL_X(FID_SETUP_K2231) WL_X(FID_SETUP_C2232) WL_X(FID_SETUP_C2233) WL_X(FID_SETUP_K2234) WL_X(FID_SETUP_C2235) WL_X(FID_SETUP_C2236) WL_X(FID_SETUP_K2237) WL_X(FID_SETUP_C2238) WL_X(FID_SETUP_C2239) WL_X(FID_SETUP_K2240) WL_X(FID_SETUP_C2241) WL_X(FID_SETUP_C2242) WL_X(FID_SETUP_K2243) WL_X(FID_SETUP_C2244) WL_X(FID_SETUP_C2245) WL_X(FID_SETUP_K2246) WL_X(FID_SETUP_K2247) WL_X(FID_SETUP_C2248) WL_X(FID_SETUP_C2249) WL_X(FID_SETUP_K2250) WL_X(FID_SETUP_K2251) WL_X(FID_SETUP_C2252) WL_X(FID_SETUP_C2253) WL_X(FID_SETUP_K2254) WL_X(FID_SETUP_C2255) WL_X(FID_SETUP_C2256) WL_X(FID_SETUP_K2257) WL_X(FID_SETUP_C2258) WL_X(FID_SETUP_C2259) WL_X(FID_SETUP_K2260) WL_X(FID_SETUP_C2261) WL_X(FID_SETUP_C2262) WL_X(FID_SETUP_C2263) WL_X(FID_SETUP_K2264) WL_X(FID_SETUP_K2265) WL_X(FID_SETUP_C2266) WL_X(FID_SETUP_C2267) WL_X(FID_SETUP_K2268) WL_X(FID_SETUP_K2269) WL_X(FID_SETUP_C2270) WL_X(FID_SETUP_C2271) WL_X(FID_SETUP_C2272) WL_X(FID_STRING_APPEND) WL_X(FID_STRING_APPEND_K2274) WL_X(FID____SRC_GIT_TEXT_JOIN) WL_X(FID____SRC_GIT_TEXT_RUN_RES) WL_X(FID____SRC_GIT_TEXT_RUN_RES_K2278) WL_X(FID____SRC_GIT_TEXT_RUN_RES_K2279) WL_X(FID____SRC_GIT_TEXT_RUN_RES_K2280) WL_X(FID____SRC_GIT_TEXT_ENC_ARGV) WL_X(FID____SRC_GIT_TEXT_STR_CAT) WL_X(FID____SRC_GIT_TEXT_TRIM_NL) WL_X(FID_IO_PURE) WL_X(FID____SRC_GIT_PROCESS_RUNFULL) WL_X(FID____SRC_GIT_PROCESS_RUNFULL_K2487) WL_X(FID____SRC_GIT_PROCESS_RUNFULL_C2488) WL_X(FID____SRC_GIT_PROCESS_RUNFULL_C2489) WL_X(FID____SRC_GIT_PROCESS_RUNFULL_K2490) WL_X(FID____SRC_GIT_PROCESS_RUNFULL_C2491) WL_X(FID_IO_BIND) WL_X(FID_IO_BIND_C2493) WL_X(FID_IO_BIND_K2494) WL_X(FID_MAIN) WL_X(FID_MAIN_K2496) WL_X(FID_MAIN_C2497) WL_X(FID_MAIN_C2498) WL_X(FID_MAIN_K2499) WL_X(FID_MAIN_C2500) WL_X(FID_MAIN_C2501) WL_X(FID_MAIN_C2502) WL_X(FID_MAIN_K2503) WL_X(FID_MAIN_K2504) WL_X(FID_MAIN_C2505) WL_X(FID_MAIN_C2506) WL_X(FID_MAIN_C2507) WL_X(FID_MAIN_K2508) WL_X(FID_MAIN_C2509) WL_X(FID_MAIN_C2510) WL_X(FID_MAIN_K2511) WL_X(FID_MAIN_K2512) WL_X(FID_MAIN_K2513) WL_X(FID_MAIN_C2514) WL_X(FID_MAIN_C2515) WL_X(FID_MAIN_K2516) WL_X(FID_MAIN_K2517) WL_X(FID_MAIN_C2518) WL_X(FID_MAIN_C2519) WL_X(FID_MAIN_K2520) WL_X(FID_MAIN_C2521) WL_X(FID_MAIN_C2522) WL_X(FID_MAIN_K2523) WL_X(FID_MAIN_C2524) WL_X(FID_MAIN_C2525) WL_X(FID_MAIN_K2526) WL_X(FID_MAIN_K2527) WL_X(FID_MAIN_K2528) WL_X(FID_MAIN_K2529) WL_X(FID_MAIN_K2530) WL_X(FID_MAIN_K2531) WL_X(FID_MAIN_C2532) WL_X(FID_MAIN_C2533) WL_X(FID_MAIN_K2534) WL_X(FID_MAIN_C2535) WL_X(FID_MAIN_C2536) WL_X(FID_MAIN_C2537) WL_X(FID_MAIN_K2538) WL_X(FID_MAIN_K2539) WL_X(FID_MAIN_K2540) WL_X(FID_MAIN_C2541) WL_X(FID_MAIN_C2542) WL_X(FID_MAIN_K2543) WL_X(FID_MAIN_K2544) WL_X(FID_MAIN_C2545) WL_X(FID_MAIN_C2546) WL_X(FID_MAIN_K2547) WL_X(FID_MAIN_C2548) WL_X(FID_MAIN_C2549) WL_X(FID_MAIN_K2550) WL_X(FID_MAIN_C2551) WL_X(FID_MAIN_C2552) WL_X(FID_MAIN_C2553) WL_X(FID_MAIN_K2554) WL_X(FID_MAIN_C2555) WL_X(FID_MAIN_C2556) WL_X(FID_MAIN_C2557) WL_X(FID_MAIN_K2558) WL_X(FID_MAIN_K2559) WL_X(FID_MAIN_K2560) WL_X(FID_MAIN_K2561) WL_X(FID_MAIN_C2562) WL_X(FID_MAIN_C2563) WL_X(FID_MAIN_K2564) WL_X(FID_MAIN_K2565) WL_X(FID_MAIN_C2566) WL_X(FID_MAIN_C2567) WL_X(FID_MAIN_K2568) WL_X(FID_MAIN_C2569) WL_X(FID_MAIN_C2570) WL_X(FID_MAIN_K2571) WL_X(FID_MAIN_C2572) WL_X(FID_MAIN_C2573) WL_X(FID_MAIN_K2574) WL_X(FID_MAIN_C2575) WL_X(FID_MAIN_C2576) WL_X(FID_MAIN_C2577) WL_X(FID_MAIN_K2578) WL_X(FID_MAIN_C2579) WL_X(FID_MAIN_C2580) WL_X(FID_MAIN_C2581) WL_X(FID_MAIN_K2582) WL_X(FID_MAIN_K2583) WL_X(FID_MAIN_K2584) WL_X(FID_MAIN_K2585) WL_X(FID_MAIN_C2586) WL_X(FID_MAIN_C2587) WL_X(FID_MAIN_K2588) WL_X(FID_MAIN_K2589) WL_X(FID_MAIN_C2590) WL_X(FID_MAIN_C2591) WL_X(FID_MAIN_K2592) WL_X(FID_MAIN_C2593) WL_X(FID_MAIN_C2594) WL_X(FID_MAIN_C2595) WL_X(FID_MAIN_K2596) WL_X(FID_MAIN_K2597) WL_X(FID_MAIN_C2598) WL_X(FID_MAIN_C2599) WL_X(FID_MAIN_K2600) WL_X(FID_MAIN_C2601) WL_X(FID_MAIN_C2602) WL_X(FID_MAIN_K2603) WL_X(FID_MAIN_K2604) WL_X(FID_MAIN_C2605) WL_X(FID_MAIN_C2606) WL_X(FID_MAIN_K2607) WL_X(FID_MAIN_K2608) WL_X(FID_MAIN_C2609) WL_X(FID_MAIN_C2610) WL_X(FID_MAIN_K2611) WL_X(FID_MAIN_C2612) WL_X(FID_MAIN_C2613) WL_X(FID_MAIN_K2614) WL_X(FID_MAIN_C2615) WL_X(FID_MAIN_C2616) WL_X(FID_MAIN_K2617) WL_X(FID_MAIN_C2618) WL_X(FID_MAIN_C2619) WL_X(FID_MAIN_K2620) WL_X(FID_MAIN_C2621) WL_X(FID_MAIN_C2622) WL_X(FID_MAIN_K2623) WL_X(FID_MAIN_C2624) WL_X(FID_MAIN_C2625) WL_X(FID_MAIN_C2626) WL_X(FID_MAIN_K2627) WL_X(FID_MAIN_C2628) WL_X(FID_MAIN_C2629) WL_X(FID_MAIN_C2630) WL_X(FID_MAIN_K2631) WL_X(FID_MAIN_C2632) WL_X(FID_MAIN_C2633) WL_X(FID_MAIN_C2634) WL_X(FID_MAIN_K2635) WL_X(FID_MAIN_C2636) WL_X(FID_MAIN_C2637) WL_X(FID_MAIN_C2638) WL_X(FID_MAIN_K2639) WL_X(FID_MAIN_K2640) WL_X(FID_MAIN_K2641) WL_X(FID_MAIN_K2642) WL_X(FID_MAIN_K2643) WL_X(FID_MAIN_C2644) WL_X(FID_MAIN_C2645) WL_X(FID_MAIN_K2646) WL_X(FID_MAIN_C2647) WL_X(FID_MAIN_C2648) WL_X(FID_MAIN_K2649) WL_X(FID_MAIN_K2650) WL_X(FID_MAIN_C2651) WL_X(FID_MAIN_C2652) WL_X(FID_MAIN_K2653) WL_X(FID_MAIN_K2654) WL_X(FID_MAIN_C2655) WL_X(FID_MAIN_C2656) WL_X(FID_MAIN_K2657) WL_X(FID_MAIN_C2658) WL_X(FID_MAIN_C2659) WL_X(FID_MAIN_K2660) WL_X(FID_MAIN_C2661) WL_X(FID_MAIN_C2662) WL_X(FID_MAIN_C2663) WL_X(FID_MAIN_K2664) WL_X(FID_MAIN_C2665) WL_X(FID_MAIN_C2666) WL_X(FID_MAIN_C2667) WL_X(FID_MAIN_K2668) WL_X(FID_MAIN_K2669) WL_X(FID_MAIN_K2670) WL_X(FID_MAIN_K2671) WL_X(FID_MAIN_C2672) WL_X(FID_MAIN_C2673) WL_X(FID_MAIN_K2674) WL_X(FID_MAIN_C2675) WL_X(FID_MAIN_C2676) WL_X(FID_MAIN_K2677) WL_X(FID_MAIN_K2678) WL_X(FID_MAIN_C2679) WL_X(FID_MAIN_C2680) WL_X(FID_MAIN_K2681) WL_X(FID_MAIN_K2682) WL_X(FID_MAIN_C2683) WL_X(FID_MAIN_C2684) WL_X(FID_MAIN_K2685) WL_X(FID_MAIN_C2686) WL_X(FID_MAIN_C2687) WL_X(FID_MAIN_C2688) WL_X(FID_MAIN_K2689) WL_X(FID_MAIN_K2690) WL_X(FID_MAIN_C2691) WL_X(FID_MAIN_C2692) WL_X(FID_MAIN_K2693) WL_X(FID_MAIN_K2694) WL_X(FID_MAIN_K2695) WL_X(FID_MAIN_C2696) WL_X(FID_MAIN_C2697) WL_X(FID_MAIN_K2698) WL_X(FID_MAIN_C2699) WL_X(FID_MAIN_C2700) WL_X(FID_MAIN_C2701) WL_X(FID_MAIN_K2702) WL_X(FID_MAIN_K2703) WL_X(FID_MAIN_C2704) WL_X(FID_PROCESS_RUN) WL_X(FID_IO_PRINT) WL_X(FID_IO_EMIT) WL_X(FID_CLO_APPLY) WL_X(FID_EXIT)
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

CONSTV u64 STAT_IMG[] = { 32ull, term_pak(CID_SNIL, 0), 58ull, term_ctr(CID_SCON, STAT_OFF + 0), 110ull, term_ctr(CID_SCON, STAT_OFF + 2), 105ull, term_ctr(CID_SCON, STAT_OFF + 4), 97ull, term_ctr(CID_SCON, STAT_OFF + 6), 103ull, term_ctr(CID_SCON, STAT_OFF + 8), 97ull, term_ctr(CID_SCON, STAT_OFF + 10), 32ull, term_ctr(CID_SCON, STAT_OFF + 12), 100ull, term_ctr(CID_SCON, STAT_OFF + 14), 101ull, term_ctr(CID_SCON, STAT_OFF + 16), 118ull, term_ctr(CID_SCON, STAT_OFF + 18), 111ull, term_ctr(CID_SCON, STAT_OFF + 20), 109ull, term_ctr(CID_SCON, STAT_OFF + 22), 32ull, term_ctr(CID_SCON, STAT_OFF + 24), 116ull, term_ctr(CID_SCON, STAT_OFF + 26), 101ull, term_ctr(CID_SCON, STAT_OFF + 28), 103ull, term_ctr(CID_SCON, STAT_OFF + 30), 114ull, term_ctr(CID_SCON, STAT_OFF + 32), 97ull, term_ctr(CID_SCON, STAT_OFF + 34), 116ull, term_ctr(CID_SCON, STAT_OFF + 36), 100ull, term_pak(CID_SNIL, 0), 110ull, term_ctr(CID_SCON, STAT_OFF + 40), 97ull, term_ctr(CID_SCON, STAT_OFF + 42), 108ull, term_ctr(CID_SCON, STAT_OFF + 44), 101ull, term_pak(CID_SNIL, 0), 115ull, term_ctr(CID_SCON, STAT_OFF + 48), 97ull, term_ctr(CID_SCON, STAT_OFF + 50), 98ull, term_ctr(CID_SCON, STAT_OFF + 52), 101ull, term_ctr(CID_SCON, STAT_OFF + 54), 114ull, term_ctr(CID_SCON, STAT_OFF + 56), 32ull, term_ctr(CID_SCON, STAT_OFF + 58), 114ull, term_ctr(CID_SCON, STAT_OFF + 60), 101ull, term_ctr(CID_SCON, STAT_OFF + 62), 116ull, term_ctr(CID_SCON, STAT_OFF + 64), 102ull, term_ctr(CID_SCON, STAT_OFF + 66), 97ull, term_ctr(CID_SCON, STAT_OFF + 68), 32ull, term_ctr(CID_SCON, STAT_OFF + 70), 116ull, term_ctr(CID_SCON, STAT_OFF + 72), 105ull, term_ctr(CID_SCON, STAT_OFF + 74), 109ull, term_ctr(CID_SCON, STAT_OFF + 76), 109ull, term_ctr(CID_SCON, STAT_OFF + 78), 111ull, term_ctr(CID_SCON, STAT_OFF + 80), 99ull, term_ctr(CID_SCON, STAT_OFF + 82), 32ull, term_ctr(CID_SCON, STAT_OFF + 84), 101ull, term_ctr(CID_SCON, STAT_OFF + 86), 116ull, term_ctr(CID_SCON, STAT_OFF + 88), 97ull, term_ctr(CID_SCON, STAT_OFF + 90), 100ull, term_ctr(CID_SCON, STAT_OFF + 92), 105ull, term_ctr(CID_SCON, STAT_OFF + 94), 100ull, term_ctr(CID_SCON, STAT_OFF + 96), 110ull, term_ctr(CID_SCON, STAT_OFF + 98), 97ull, term_ctr(CID_SCON, STAT_OFF + 100), 99ull, term_ctr(CID_SCON, STAT_OFF + 102), 32ull, term_ctr(CID_SCON, STAT_OFF + 104), 111ull, term_ctr(CID_SCON, STAT_OFF + 106), 110ull, term_ctr(CID_SCON, STAT_OFF + 108), 4, term_ctr(CID_SCON, STAT_OFF + 46), term_ctr(CID_SCON, STAT_OFF + 110), 114ull, term_ctr(CID_SCON, STAT_OFF + 50), 97ull, term_ctr(CID_SCON, STAT_OFF + 115), 112ull, term_ctr(CID_SCON, STAT_OFF + 117), 45ull, term_ctr(CID_SCON, STAT_OFF + 119), 118ull, term_ctr(CID_SCON, STAT_OFF + 121), 101ull, term_ctr(CID_SCON, STAT_OFF + 123), 114ull, term_ctr(CID_SCON, STAT_OFF + 125), 68ull, term_pak(CID_SNIL, 0), 65ull, term_ctr(CID_SCON, STAT_OFF + 129), 69ull, term_ctr(CID_SCON, STAT_OFF + 131), 72ull, term_ctr(CID_SCON, STAT_OFF + 133), term_ctr(CID_SCON, STAT_OFF + 135), term_pak(CID_NIL, 0), term_ctr(CID_SCON, STAT_OFF + 127), term_ctr(CID_CON, STAT_OFF + 137), 115ull, term_pak(CID_SNIL, 0), 101ull, term_ctr(CID_SCON, STAT_OFF + 141), 105ull, term_ctr(CID_SCON, STAT_OFF + 143), 116ull, term_ctr(CID_SCON, STAT_OFF + 145), 105ull, term_ctr(CID_SCON, STAT_OFF + 147), 116ull, term_ctr(CID_SCON, STAT_OFF + 149), 110ull, term_ctr(CID_SCON, STAT_OFF + 151), 101ull, term_ctr(CID_SCON, STAT_OFF + 153), 100ull, term_ctr(CID_SCON, STAT_OFF + 155), 105ull, term_ctr(CID_SCON, STAT_OFF + 157), 32ull, term_ctr(CID_SCON, STAT_OFF + 159), 101ull, term_ctr(CID_SCON, STAT_OFF + 161), 114ull, term_ctr(CID_SCON, STAT_OFF + 163), 117ull, term_ctr(CID_SCON, STAT_OFF + 165), 108ull, term_ctr(CID_SCON, STAT_OFF + 167), 105ull, term_ctr(CID_SCON, STAT_OFF + 169), 97ull, term_ctr(CID_SCON, STAT_OFF + 171), 102ull, term_ctr(CID_SCON, STAT_OFF + 173), 32ull, term_ctr(CID_SCON, STAT_OFF + 175), 116ull, term_ctr(CID_SCON, STAT_OFF + 177), 111ull, term_ctr(CID_SCON, STAT_OFF + 179), 110ull, term_ctr(CID_SCON, STAT_OFF + 181), 32ull, term_ctr(CID_SCON, STAT_OFF + 183), 115ull, term_ctr(CID_SCON, STAT_OFF + 185), 105ull, term_ctr(CID_SCON, STAT_OFF + 187), 32ull, term_ctr(CID_SCON, STAT_OFF + 189), 116ull, term_ctr(CID_SCON, STAT_OFF + 191), 117ull, term_ctr(CID_SCON, STAT_OFF + 193), 112ull, term_ctr(CID_SCON, STAT_OFF + 195), 116ull, term_ctr(CID_SCON, STAT_OFF + 197), 117ull, term_ctr(CID_SCON, STAT_OFF + 199), 111ull, term_ctr(CID_SCON, STAT_OFF + 201), 32ull, term_ctr(CID_SCON, STAT_OFF + 203), 107ull, term_ctr(CID_SCON, STAT_OFF + 205), 99ull, term_ctr(CID_SCON, STAT_OFF + 207), 101ull, term_ctr(CID_SCON, STAT_OFF + 209), 104ull, term_ctr(CID_SCON, STAT_OFF + 211), 99ull, term_ctr(CID_SCON, STAT_OFF + 213), 100ull, term_ctr(CID_SCON, STAT_OFF + 0), 101ull, term_ctr(CID_SCON, STAT_OFF + 217), 103ull, term_ctr(CID_SCON, STAT_OFF + 219), 100ull, term_ctr(CID_SCON, STAT_OFF + 221), 117ull, term_ctr(CID_SCON, STAT_OFF + 223), 106ull, term_ctr(CID_SCON, STAT_OFF + 225), 110ull, term_ctr(CID_SCON, STAT_OFF + 227), 117ull, term_ctr(CID_SCON, STAT_OFF + 229), 63ull, term_ctr(CID_SCON, STAT_OFF + 231), 100ull, term_ctr(CID_SCON, STAT_OFF + 2), 101ull, term_ctr(CID_SCON, STAT_OFF + 235), 114ull, term_ctr(CID_SCON, STAT_OFF + 237), 101ull, term_ctr(CID_SCON, STAT_OFF + 239), 118ull, term_ctr(CID_SCON, STAT_OFF + 241), 111ull, term_ctr(CID_SCON, STAT_OFF + 243), 99ull, term_ctr(CID_SCON, STAT_OFF + 245), 110ull, term_ctr(CID_SCON, STAT_OFF + 247), 117ull, term_ctr(CID_SCON, STAT_OFF + 249), 63ull, term_ctr(CID_SCON, STAT_OFF + 251), 116ull, term_pak(CID_SNIL, 0), 101ull, term_ctr(CID_SCON, STAT_OFF + 255), 103ull, term_ctr(CID_SCON, STAT_OFF + 257), 114ull, term_ctr(CID_SCON, STAT_OFF + 259), 97ull, term_ctr(CID_SCON, STAT_OFF + 261), 116ull, term_ctr(CID_SCON, STAT_OFF + 263), 10ull, term_pak(CID_SNIL, 0), 58ull, term_ctr(CID_SCON, STAT_OFF + 267), 83ull, term_ctr(CID_SCON, STAT_OFF + 269), 69ull, term_ctr(CID_SCON, STAT_OFF + 271), 82ull, term_ctr(CID_SCON, STAT_OFF + 273), 85ull, term_ctr(CID_SCON, STAT_OFF + 275), 76ull, term_ctr(CID_SCON, STAT_OFF + 277), 73ull, term_ctr(CID_SCON, STAT_OFF + 279), 65ull, term_ctr(CID_SCON, STAT_OFF + 281), 70ull, term_ctr(CID_SCON, STAT_OFF + 283), 110ull, term_pak(CID_SNIL, 0), 101ull, term_ctr(CID_SCON, STAT_OFF + 287), 101ull, term_ctr(CID_SCON, STAT_OFF + 289), 114ull, term_ctr(CID_SCON, STAT_OFF + 291), 103ull, term_ctr(CID_SCON, STAT_OFF + 293), 32ull, term_ctr(CID_SCON, STAT_OFF + 295), 108ull, term_ctr(CID_SCON, STAT_OFF + 297), 108ull, term_ctr(CID_SCON, STAT_OFF + 299), 97ull, term_ctr(CID_SCON, STAT_OFF + 301), 32ull, term_ctr(CID_SCON, STAT_OFF + 303), 58ull, term_ctr(CID_SCON, STAT_OFF + 305), 115ull, term_ctr(CID_SCON, STAT_OFF + 307), 107ull, term_ctr(CID_SCON, STAT_OFF + 309), 99ull, term_ctr(CID_SCON, STAT_OFF + 311), 101ull, term_ctr(CID_SCON, STAT_OFF + 313), 104ull, term_ctr(CID_SCON, STAT_OFF + 315), 99ull, term_ctr(CID_SCON, STAT_OFF + 317), 32ull, term_ctr(CID_SCON, STAT_OFF + 319), 100ull, term_ctr(CID_SCON, STAT_OFF + 321), 110ull, term_ctr(CID_SCON, STAT_OFF + 323), 97ull, term_ctr(CID_SCON, STAT_OFF + 325), 108ull, term_ctr(CID_SCON, STAT_OFF + 327), 111ull, term_pak(CID_SNIL, 0), 116ull, term_ctr(CID_SCON, STAT_OFF + 331), 110ull, term_ctr(CID_SCON, STAT_OFF + 333), 111ull, term_ctr(CID_SCON, STAT_OFF + 335), 45ull, term_ctr(CID_SCON, STAT_OFF + 337), 45ull, term_ctr(CID_SCON, STAT_OFF + 339), 47ull, term_pak(CID_SNIL, 0), 115ull, term_ctr(CID_SCON, STAT_OFF + 343), 100ull, term_ctr(CID_SCON, STAT_OFF + 345), 97ull, term_ctr(CID_SCON, STAT_OFF + 347), 101ull, term_ctr(CID_SCON, STAT_OFF + 349), 104ull, term_ctr(CID_SCON, STAT_OFF + 351), 47ull, term_ctr(CID_SCON, STAT_OFF + 353), 115ull, term_ctr(CID_SCON, STAT_OFF + 355), 102ull, term_ctr(CID_SCON, STAT_OFF + 357), 101ull, term_ctr(CID_SCON, STAT_OFF + 359), 114ull, term_ctr(CID_SCON, STAT_OFF + 361), 102ull, term_pak(CID_SNIL, 0), 101ull, term_ctr(CID_SCON, STAT_OFF + 365), 114ull, term_ctr(CID_SCON, STAT_OFF + 367), 45ull, term_ctr(CID_SCON, STAT_OFF + 369), 101ull, term_ctr(CID_SCON, STAT_OFF + 371), 116ull, term_ctr(CID_SCON, STAT_OFF + 373), 97ull, term_ctr(CID_SCON, STAT_OFF + 375), 100ull, term_ctr(CID_SCON, STAT_OFF + 377), 112ull, term_ctr(CID_SCON, STAT_OFF + 379), 117ull, term_ctr(CID_SCON, STAT_OFF + 381), 116ull, term_ctr(CID_SCON, STAT_OFF + 48), 97ull, term_ctr(CID_SCON, STAT_OFF + 385), 100ull, term_ctr(CID_SCON, STAT_OFF + 387), 105ull, term_ctr(CID_SCON, STAT_OFF + 389), 100ull, term_ctr(CID_SCON, STAT_OFF + 391), 110ull, term_ctr(CID_SCON, STAT_OFF + 393), 97ull, term_ctr(CID_SCON, STAT_OFF + 395), 99ull, term_ctr(CID_SCON, STAT_OFF + 397), 116ull, term_ctr(CID_SCON, STAT_OFF + 237), 99ull, term_ctr(CID_SCON, STAT_OFF + 401), 101ull, term_ctr(CID_SCON, STAT_OFF + 403), 112ull, term_ctr(CID_SCON, STAT_OFF + 405), 120ull, term_ctr(CID_SCON, STAT_OFF + 407), 101ull, term_ctr(CID_SCON, STAT_OFF + 409), 32ull, term_ctr(CID_SCON, STAT_OFF + 411), 101ull, term_ctr(CID_SCON, STAT_OFF + 413), 115ull, term_ctr(CID_SCON, STAT_OFF + 415), 97ull, term_ctr(CID_SCON, STAT_OFF + 417), 98ull, term_ctr(CID_SCON, STAT_OFF + 419), 45ull, term_ctr(CID_SCON, STAT_OFF + 421), 110ull, term_ctr(CID_SCON, STAT_OFF + 423), 119ull, term_ctr(CID_SCON, STAT_OFF + 425), 111ull, term_ctr(CID_SCON, STAT_OFF + 427), 110ull, term_ctr(CID_SCON, STAT_OFF + 429), 107ull, term_ctr(CID_SCON, STAT_OFF + 431), 110ull, term_ctr(CID_SCON, STAT_OFF + 433), 117ull, term_ctr(CID_SCON, STAT_OFF + 435), 32ull, term_ctr(CID_SCON, STAT_OFF + 437), 101ull, term_ctr(CID_SCON, STAT_OFF + 439), 114ull, term_ctr(CID_SCON, STAT_OFF + 441), 101ull, term_ctr(CID_SCON, STAT_OFF + 443), 104ull, term_ctr(CID_SCON, STAT_OFF + 445), 119ull, term_ctr(CID_SCON, STAT_OFF + 447), 32ull, term_ctr(CID_SCON, STAT_OFF + 449), 108ull, term_ctr(CID_SCON, STAT_OFF + 451), 97ull, term_ctr(CID_SCON, STAT_OFF + 453), 115ull, term_ctr(CID_SCON, STAT_OFF + 455), 117ull, term_ctr(CID_SCON, STAT_OFF + 457), 102ull, term_ctr(CID_SCON, STAT_OFF + 459), 101ull, term_ctr(CID_SCON, STAT_OFF + 461), 114ull, term_ctr(CID_SCON, STAT_OFF + 463), 32ull, term_ctr(CID_SCON, STAT_OFF + 465), 114ull, term_ctr(CID_SCON, STAT_OFF + 467), 101ull, term_ctr(CID_SCON, STAT_OFF + 469), 104ull, term_ctr(CID_SCON, STAT_OFF + 471), 116ull, term_ctr(CID_SCON, STAT_OFF + 473), 111ull, term_ctr(CID_SCON, STAT_OFF + 475), 32ull, term_ctr(CID_SCON, STAT_OFF + 477), 58ull, term_ctr(CID_SCON, STAT_OFF + 479), 100ull, term_ctr(CID_SCON, STAT_OFF + 481), 110ull, term_ctr(CID_SCON, STAT_OFF + 483), 97ull, term_ctr(CID_SCON, STAT_OFF + 485), 108ull, term_ctr(CID_SCON, STAT_OFF + 487), 101ull, term_ctr(CID_SCON, STAT_OFF + 40), 116ull, term_ctr(CID_SCON, STAT_OFF + 491), 99ull, term_ctr(CID_SCON, STAT_OFF + 493), 101ull, term_ctr(CID_SCON, STAT_OFF + 495), 112ull, term_ctr(CID_SCON, STAT_OFF + 497), 120ull, term_ctr(CID_SCON, STAT_OFF + 499), 101ull, term_ctr(CID_SCON, STAT_OFF + 501), 32ull, term_ctr(CID_SCON, STAT_OFF + 503), 101ull, term_ctr(CID_SCON, STAT_OFF + 505), 115ull, term_ctr(CID_SCON, STAT_OFF + 507), 97ull, term_ctr(CID_SCON, STAT_OFF + 509), 98ull, term_ctr(CID_SCON, STAT_OFF + 511), 45ull, term_ctr(CID_SCON, STAT_OFF + 513), 110ull, term_ctr(CID_SCON, STAT_OFF + 515), 119ull, term_ctr(CID_SCON, STAT_OFF + 517), 111ull, term_ctr(CID_SCON, STAT_OFF + 519), 110ull, term_ctr(CID_SCON, STAT_OFF + 521), 107ull, term_ctr(CID_SCON, STAT_OFF + 523), 110ull, term_ctr(CID_SCON, STAT_OFF + 525), 117ull, term_ctr(CID_SCON, STAT_OFF + 527), 32ull, term_ctr(CID_SCON, STAT_OFF + 529), 101ull, term_ctr(CID_SCON, STAT_OFF + 531), 114ull, term_ctr(CID_SCON, STAT_OFF + 533), 101ull, term_ctr(CID_SCON, STAT_OFF + 535), 104ull, term_ctr(CID_SCON, STAT_OFF + 537), 119ull, term_ctr(CID_SCON, STAT_OFF + 539), 32ull, term_ctr(CID_SCON, STAT_OFF + 541), 101ull, term_ctr(CID_SCON, STAT_OFF + 543), 109ull, term_ctr(CID_SCON, STAT_OFF + 545), 111ull, term_ctr(CID_SCON, STAT_OFF + 547), 99ull, term_ctr(CID_SCON, STAT_OFF + 549), 116ull, term_ctr(CID_SCON, STAT_OFF + 551), 117ull, term_ctr(CID_SCON, STAT_OFF + 553), 111ull, term_ctr(CID_SCON, STAT_OFF + 555), 32ull, term_ctr(CID_SCON, STAT_OFF + 557), 58ull, term_ctr(CID_SCON, STAT_OFF + 559), 100ull, term_ctr(CID_SCON, STAT_OFF + 561), 110ull, term_ctr(CID_SCON, STAT_OFF + 563), 97ull, term_ctr(CID_SCON, STAT_OFF + 565), 108ull, term_ctr(CID_SCON, STAT_OFF + 567), 108ull, term_pak(CID_SNIL, 0), 97ull, term_ctr(CID_SCON, STAT_OFF + 571), 110ull, term_ctr(CID_SCON, STAT_OFF + 573), 103ull, term_ctr(CID_SCON, STAT_OFF + 575), 105ull, term_ctr(CID_SCON, STAT_OFF + 577), 115ull, term_ctr(CID_SCON, STAT_OFF + 579), 32ull, term_ctr(CID_SCON, STAT_OFF + 581), 121ull, term_ctr(CID_SCON, STAT_OFF + 583), 98ull, term_ctr(CID_SCON, STAT_OFF + 585), 32ull, term_ctr(CID_SCON, STAT_OFF + 587), 100ull, term_ctr(CID_SCON, STAT_OFF + 589), 101ull, term_ctr(CID_SCON, STAT_OFF + 591), 108ull, term_ctr(CID_SCON, STAT_OFF + 593), 108ull, term_ctr(CID_SCON, STAT_OFF + 595), 105ull, term_ctr(CID_SCON, STAT_OFF + 597), 107ull, term_ctr(CID_SCON, STAT_OFF + 599), 32ull, term_ctr(CID_SCON, STAT_OFF + 601), 107ull, term_ctr(CID_SCON, STAT_OFF + 603), 99ull, term_ctr(CID_SCON, STAT_OFF + 605), 101ull, term_ctr(CID_SCON, STAT_OFF + 607), 104ull, term_ctr(CID_SCON, STAT_OFF + 609), 99ull, term_ctr(CID_SCON, STAT_OFF + 611), 104ull, term_pak(CID_SNIL, 0), 115ull, term_ctr(CID_SCON, STAT_OFF + 615), 47ull, term_ctr(CID_SCON, STAT_OFF + 617), 110ull, term_ctr(CID_SCON, STAT_OFF + 619), 105ull, term_ctr(CID_SCON, STAT_OFF + 621), 98ull, term_ctr(CID_SCON, STAT_OFF + 623), 47ull, term_ctr(CID_SCON, STAT_OFF + 625), 105ull, term_pak(CID_SNIL, 0), 108ull, term_ctr(CID_SCON, STAT_OFF + 629), 45ull, term_ctr(CID_SCON, STAT_OFF + 631), 116ull, term_ctr(CID_SCON, STAT_OFF + 633), 108ull, term_ctr(CID_SCON, STAT_OFF + 635), 47ull, term_ctr(CID_SCON, STAT_OFF + 637), 104ull, term_ctr(CID_SCON, STAT_OFF + 639), 99ull, term_ctr(CID_SCON, STAT_OFF + 641), 116ull, term_ctr(CID_SCON, STAT_OFF + 643), 97ull, term_ctr(CID_SCON, STAT_OFF + 645), 114ull, term_ctr(CID_SCON, STAT_OFF + 647), 99ull, term_ctr(CID_SCON, STAT_OFF + 649), 115ull, term_ctr(CID_SCON, STAT_OFF + 651), 46ull, term_ctr(CID_SCON, STAT_OFF + 653), 47ull, term_ctr(CID_SCON, STAT_OFF + 655), 105ull, term_ctr(CID_SCON, STAT_OFF + 287), 97ull, term_ctr(CID_SCON, STAT_OFF + 659), 109ull, term_ctr(CID_SCON, STAT_OFF + 661), 52ull, term_ctr(CID_SCON, STAT_OFF + 48), 99ull, term_ctr(CID_SCON, STAT_OFF + 665), 50ull, term_ctr(CID_SCON, STAT_OFF + 667), 97ull, term_ctr(CID_SCON, STAT_OFF + 669), 56ull, term_ctr(CID_SCON, STAT_OFF + 671), 100ull, term_ctr(CID_SCON, STAT_OFF + 673), 48ull, term_ctr(CID_SCON, STAT_OFF + 675), 121ull, term_ctr(CID_SCON, STAT_OFF + 677), 114ull, term_ctr(CID_SCON, STAT_OFF + 679), 101ull, term_ctr(CID_SCON, STAT_OFF + 681), 116ull, term_ctr(CID_SCON, STAT_OFF + 683), 115ull, term_ctr(CID_SCON, STAT_OFF + 685), 121ull, term_ctr(CID_SCON, STAT_OFF + 687), 109ull, term_ctr(CID_SCON, STAT_OFF + 689), 120ull, term_ctr(CID_SCON, STAT_OFF + 255), 116ull, term_ctr(CID_SCON, STAT_OFF + 693), 46ull, term_ctr(CID_SCON, STAT_OFF + 695), 116ull, term_ctr(CID_SCON, STAT_OFF + 697), 97ull, term_ctr(CID_SCON, STAT_OFF + 699), 101ull, term_ctr(CID_SCON, STAT_OFF + 701), 102ull, term_ctr(CID_SCON, STAT_OFF + 703), term_ctr(CID_SCON, STAT_OFF + 705), term_pak(CID_NIL, 0), 46ull, term_ctr(CID_SCON, STAT_OFF + 617), 115ull, term_ctr(CID_SCON, STAT_OFF + 709), 115ull, term_ctr(CID_SCON, STAT_OFF + 711), 97ull, term_ctr(CID_SCON, STAT_OFF + 713), 112ull, term_ctr(CID_SCON, STAT_OFF + 715), 45ull, term_ctr(CID_SCON, STAT_OFF + 717), 107ull, term_ctr(CID_SCON, STAT_OFF + 719), 99ull, term_ctr(CID_SCON, STAT_OFF + 721), 101ull, term_ctr(CID_SCON, STAT_OFF + 723), 104ull, term_ctr(CID_SCON, STAT_OFF + 725), 99ull, term_ctr(CID_SCON, STAT_OFF + 727), 121ull, term_ctr(CID_SCON, STAT_OFF + 413), 115ull, term_ctr(CID_SCON, STAT_OFF + 731), 117ull, term_ctr(CID_SCON, STAT_OFF + 733), 98ull, term_ctr(CID_SCON, STAT_OFF + 735), 32ull, term_ctr(CID_SCON, STAT_OFF + 737), 101ull, term_ctr(CID_SCON, STAT_OFF + 739), 114ull, term_ctr(CID_SCON, STAT_OFF + 741), 101ull, term_ctr(CID_SCON, STAT_OFF + 743), 104ull, term_ctr(CID_SCON, STAT_OFF + 745), 119ull, term_ctr(CID_SCON, STAT_OFF + 747), 32ull, term_ctr(CID_SCON, STAT_OFF + 749), 108ull, term_ctr(CID_SCON, STAT_OFF + 751), 97ull, term_ctr(CID_SCON, STAT_OFF + 753), 115ull, term_ctr(CID_SCON, STAT_OFF + 755), 117ull, term_ctr(CID_SCON, STAT_OFF + 757), 102ull, term_ctr(CID_SCON, STAT_OFF + 759), 101ull, term_ctr(CID_SCON, STAT_OFF + 761), 114ull, term_ctr(CID_SCON, STAT_OFF + 763), 32ull, term_ctr(CID_SCON, STAT_OFF + 765), 114ull, term_ctr(CID_SCON, STAT_OFF + 767), 101ull, term_ctr(CID_SCON, STAT_OFF + 769), 104ull, term_ctr(CID_SCON, STAT_OFF + 771), 116ull, term_ctr(CID_SCON, STAT_OFF + 773), 111ull, term_ctr(CID_SCON, STAT_OFF + 775), 32ull, term_ctr(CID_SCON, STAT_OFF + 777), 58ull, term_ctr(CID_SCON, STAT_OFF + 779), 100ull, term_ctr(CID_SCON, STAT_OFF + 781), 110ull, term_ctr(CID_SCON, STAT_OFF + 783), 97ull, term_ctr(CID_SCON, STAT_OFF + 785), 108ull, term_ctr(CID_SCON, STAT_OFF + 787), 121ull, term_ctr(CID_SCON, STAT_OFF + 505), 115ull, term_ctr(CID_SCON, STAT_OFF + 791), 117ull, term_ctr(CID_SCON, STAT_OFF + 793), 98ull, term_ctr(CID_SCON, STAT_OFF + 795), 32ull, term_ctr(CID_SCON, STAT_OFF + 797), 101ull, term_ctr(CID_SCON, STAT_OFF + 799), 114ull, term_ctr(CID_SCON, STAT_OFF + 801), 101ull, term_ctr(CID_SCON, STAT_OFF + 803), 104ull, term_ctr(CID_SCON, STAT_OFF + 805), 119ull, term_ctr(CID_SCON, STAT_OFF + 807), 32ull, term_ctr(CID_SCON, STAT_OFF + 809), 100ull, term_ctr(CID_SCON, STAT_OFF + 811), 101ull, term_ctr(CID_SCON, STAT_OFF + 813), 100ull, term_ctr(CID_SCON, STAT_OFF + 815), 110ull, term_ctr(CID_SCON, STAT_OFF + 817), 97ull, term_ctr(CID_SCON, STAT_OFF + 819), 108ull, term_ctr(CID_SCON, STAT_OFF + 821), 32ull, term_ctr(CID_SCON, STAT_OFF + 823), 58ull, term_ctr(CID_SCON, STAT_OFF + 825), 100ull, term_ctr(CID_SCON, STAT_OFF + 827), 110ull, term_ctr(CID_SCON, STAT_OFF + 829), 97ull, term_ctr(CID_SCON, STAT_OFF + 831), 108ull, term_ctr(CID_SCON, STAT_OFF + 833), 101ull, term_ctr(CID_SCON, STAT_OFF + 811), 109ull, term_ctr(CID_SCON, STAT_OFF + 837), 111ull, term_ctr(CID_SCON, STAT_OFF + 839), 99ull, term_ctr(CID_SCON, STAT_OFF + 841), 116ull, term_ctr(CID_SCON, STAT_OFF + 843), 117ull, term_ctr(CID_SCON, STAT_OFF + 845), 111ull, term_ctr(CID_SCON, STAT_OFF + 847), 32ull, term_ctr(CID_SCON, STAT_OFF + 849), 58ull, term_ctr(CID_SCON, STAT_OFF + 851), 100ull, term_ctr(CID_SCON, STAT_OFF + 853), 110ull, term_ctr(CID_SCON, STAT_OFF + 855), 97ull, term_ctr(CID_SCON, STAT_OFF + 857), 108ull, term_ctr(CID_SCON, STAT_OFF + 859), 105ull, term_ctr(CID_SCON, STAT_OFF + 255), 109ull, term_ctr(CID_SCON, STAT_OFF + 863), 109ull, term_ctr(CID_SCON, STAT_OFF + 865), 111ull, term_ctr(CID_SCON, STAT_OFF + 867), 99ull, term_ctr(CID_SCON, STAT_OFF + 869), 32ull, term_ctr(CID_SCON, STAT_OFF + 871), 111ull, term_ctr(CID_SCON, STAT_OFF + 873), 116ull, term_ctr(CID_SCON, STAT_OFF + 875), 32ull, term_ctr(CID_SCON, STAT_OFF + 877), 103ull, term_ctr(CID_SCON, STAT_OFF + 879), 110ull, term_ctr(CID_SCON, STAT_OFF + 881), 105ull, term_ctr(CID_SCON, STAT_OFF + 883), 104ull, term_ctr(CID_SCON, STAT_OFF + 885), 116ull, term_ctr(CID_SCON, STAT_OFF + 887), 111ull, term_ctr(CID_SCON, STAT_OFF + 889), 110ull, term_ctr(CID_SCON, STAT_OFF + 891), 101ull, term_ctr(CID_SCON, STAT_OFF + 873), 116ull, term_ctr(CID_SCON, STAT_OFF + 895), 97ull, term_ctr(CID_SCON, STAT_OFF + 897), 100ull, term_ctr(CID_SCON, STAT_OFF + 899), 105ull, term_ctr(CID_SCON, STAT_OFF + 901), 100ull, term_ctr(CID_SCON, STAT_OFF + 903), 110ull, term_ctr(CID_SCON, STAT_OFF + 905), 97ull, term_ctr(CID_SCON, STAT_OFF + 907), 99ull, term_ctr(CID_SCON, STAT_OFF + 909), 32ull, term_ctr(CID_SCON, STAT_OFF + 911), 111ull, term_ctr(CID_SCON, STAT_OFF + 913), 110ull, term_ctr(CID_SCON, STAT_OFF + 915), 121ull, term_pak(CID_SNIL, 0), 115ull, term_ctr(CID_SCON, STAT_OFF + 919), 117ull, term_ctr(CID_SCON, STAT_OFF + 921), 98ull, term_ctr(CID_SCON, STAT_OFF + 923), 45ull, term_ctr(CID_SCON, STAT_OFF + 925), 116ull, term_ctr(CID_SCON, STAT_OFF + 927), 108ull, term_ctr(CID_SCON, STAT_OFF + 929), 47ull, term_ctr(CID_SCON, STAT_OFF + 931), 104ull, term_ctr(CID_SCON, STAT_OFF + 933), 99ull, term_ctr(CID_SCON, STAT_OFF + 935), 116ull, term_ctr(CID_SCON, STAT_OFF + 937), 97ull, term_ctr(CID_SCON, STAT_OFF + 939), 114ull, term_ctr(CID_SCON, STAT_OFF + 941), 99ull, term_ctr(CID_SCON, STAT_OFF + 943), 115ull, term_ctr(CID_SCON, STAT_OFF + 945), 46ull, term_ctr(CID_SCON, STAT_OFF + 947), 47ull, term_ctr(CID_SCON, STAT_OFF + 949), 103ull, term_ctr(CID_SCON, STAT_OFF + 863), 67ull, term_pak(CID_SNIL, 0), 45ull, term_ctr(CID_SCON, STAT_OFF + 955), 101ull, term_ctr(CID_SCON, STAT_OFF + 48), 114ull, term_ctr(CID_SCON, STAT_OFF + 959), 116ull, term_ctr(CID_SCON, STAT_OFF + 961), 107ull, term_ctr(CID_SCON, STAT_OFF + 963), 114ull, term_ctr(CID_SCON, STAT_OFF + 965), 111ull, term_ctr(CID_SCON, STAT_OFF + 967), 119ull, term_ctr(CID_SCON, STAT_OFF + 969), 100ull, term_ctr(CID_SCON, STAT_OFF + 40), 97ull, term_ctr(CID_SCON, STAT_OFF + 973), term_ctr(CID_SCON, STAT_OFF + 663), term_pak(CID_NIL, 0), 46ull, term_pak(CID_SNIL, 0), 119ull, term_ctr(CID_SCON, STAT_OFF + 615), 45ull, term_ctr(CID_SCON, STAT_OFF + 981), 116ull, term_ctr(CID_SCON, STAT_OFF + 983), 108ull, term_ctr(CID_SCON, STAT_OFF + 985), 47ull, term_ctr(CID_SCON, STAT_OFF + 987), 104ull, term_ctr(CID_SCON, STAT_OFF + 989), 99ull, term_ctr(CID_SCON, STAT_OFF + 991), 116ull, term_ctr(CID_SCON, STAT_OFF + 993), 97ull, term_ctr(CID_SCON, STAT_OFF + 995), 114ull, term_ctr(CID_SCON, STAT_OFF + 997), 99ull, term_ctr(CID_SCON, STAT_OFF + 999), 115ull, term_ctr(CID_SCON, STAT_OFF + 1001), 46ull, term_ctr(CID_SCON, STAT_OFF + 1003), 47ull, term_ctr(CID_SCON, STAT_OFF + 1005), 47ull, term_ctr(CID_SCON, STAT_OFF + 981), 110ull, term_ctr(CID_SCON, STAT_OFF + 1009), 111ull, term_ctr(CID_SCON, STAT_OFF + 1011), 116ull, term_ctr(CID_SCON, STAT_OFF + 1013), 97ull, term_ctr(CID_SCON, STAT_OFF + 1015), 98ull, term_ctr(CID_SCON, STAT_OFF + 1017), 52ull, term_ctr(CID_SCON, STAT_OFF + 697), 116ull, term_ctr(CID_SCON, STAT_OFF + 1021), 97ull, term_ctr(CID_SCON, STAT_OFF + 1023), 101ull, term_ctr(CID_SCON, STAT_OFF + 1025), 102ull, term_ctr(CID_SCON, STAT_OFF + 1027), 32ull, term_ctr(CID_SCON, STAT_OFF + 1029), 62ull, term_ctr(CID_SCON, STAT_OFF + 1031), 32ull, term_ctr(CID_SCON, STAT_OFF + 1033), 39ull, term_ctr(CID_SCON, STAT_OFF + 1035), 110ull, term_ctr(CID_SCON, STAT_OFF + 1037), 92ull, term_ctr(CID_SCON, STAT_OFF + 1039), 52ull, term_ctr(CID_SCON, STAT_OFF + 1041), 116ull, term_ctr(CID_SCON, STAT_OFF + 1043), 97ull, term_ctr(CID_SCON, STAT_OFF + 1045), 101ull, term_ctr(CID_SCON, STAT_OFF + 1047), 102ull, term_ctr(CID_SCON, STAT_OFF + 1049), 39ull, term_ctr(CID_SCON, STAT_OFF + 1051), 32ull, term_ctr(CID_SCON, STAT_OFF + 1053), 102ull, term_ctr(CID_SCON, STAT_OFF + 1055), 116ull, term_ctr(CID_SCON, STAT_OFF + 1057), 110ull, term_ctr(CID_SCON, STAT_OFF + 1059), 105ull, term_ctr(CID_SCON, STAT_OFF + 1061), 114ull, term_ctr(CID_SCON, STAT_OFF + 1063), 112ull, term_ctr(CID_SCON, STAT_OFF + 1065), 108ull, term_ctr(CID_SCON, STAT_OFF + 615), 45ull, term_ctr(CID_SCON, STAT_OFF + 1069), 116ull, term_ctr(CID_SCON, STAT_OFF + 1071), 108ull, term_ctr(CID_SCON, STAT_OFF + 1073), 47ull, term_ctr(CID_SCON, STAT_OFF + 1075), 104ull, term_ctr(CID_SCON, STAT_OFF + 1077), 99ull, term_ctr(CID_SCON, STAT_OFF + 1079), 116ull, term_ctr(CID_SCON, STAT_OFF + 1081), 97ull, term_ctr(CID_SCON, STAT_OFF + 1083), 114ull, term_ctr(CID_SCON, STAT_OFF + 1085), 99ull, term_ctr(CID_SCON, STAT_OFF + 1087), 115ull, term_ctr(CID_SCON, STAT_OFF + 1089), 46ull, term_ctr(CID_SCON, STAT_OFF + 1091), 47ull, term_ctr(CID_SCON, STAT_OFF + 1093), term_ctr(CID_SCON, STAT_OFF + 1029), term_pak(CID_NIL, 0), 118ull, term_ctr(CID_SCON, STAT_OFF + 48), 111ull, term_ctr(CID_SCON, STAT_OFF + 1099), 109ull, term_ctr(CID_SCON, STAT_OFF + 1101), 101ull, term_ctr(CID_SCON, STAT_OFF + 1103), 114ull, term_ctr(CID_SCON, STAT_OFF + 1105), 125ull, term_pak(CID_SNIL, 0), 116ull, term_ctr(CID_SCON, STAT_OFF + 1109), 105ull, term_ctr(CID_SCON, STAT_OFF + 1111), 109ull, term_ctr(CID_SCON, STAT_OFF + 1113), 109ull, term_ctr(CID_SCON, STAT_OFF + 1115), 111ull, term_ctr(CID_SCON, STAT_OFF + 1117), 99ull, term_ctr(CID_SCON, STAT_OFF + 1119), 123ull, term_ctr(CID_SCON, STAT_OFF + 1121), 94ull, term_ctr(CID_SCON, STAT_OFF + 1123), 102ull, term_ctr(CID_SCON, STAT_OFF + 919), 105ull, term_ctr(CID_SCON, STAT_OFF + 1127), 114ull, term_ctr(CID_SCON, STAT_OFF + 1129), 101ull, term_ctr(CID_SCON, STAT_OFF + 1131), 118ull, term_ctr(CID_SCON, STAT_OFF + 1133), 45ull, term_ctr(CID_SCON, STAT_OFF + 1135), 45ull, term_ctr(CID_SCON, STAT_OFF + 1137), 59ull, term_ctr(CID_SCON, STAT_OFF + 0), 115ull, term_ctr(CID_SCON, STAT_OFF + 2), 101ull, term_ctr(CID_SCON, STAT_OFF + 1143), 114ull, term_ctr(CID_SCON, STAT_OFF + 1145), 117ull, term_ctr(CID_SCON, STAT_OFF + 1147), 108ull, term_ctr(CID_SCON, STAT_OFF + 1149), 105ull, term_ctr(CID_SCON, STAT_OFF + 1151), 97ull, term_ctr(CID_SCON, STAT_OFF + 1153), 102ull, term_ctr(CID_SCON, STAT_OFF + 1155), 32ull, term_ctr(CID_SCON, STAT_OFF + 1157), 119ull, term_ctr(CID_SCON, STAT_OFF + 1159), 101ull, term_ctr(CID_SCON, STAT_OFF + 1161), 110ull, term_ctr(CID_SCON, STAT_OFF + 1163), 114ull, term_pak(CID_SNIL, 0), 101ull, term_ctr(CID_SCON, STAT_OFF + 1167), 98ull, term_ctr(CID_SCON, STAT_OFF + 1169), 109ull, term_ctr(CID_SCON, STAT_OFF + 1171), 117ull, term_ctr(CID_SCON, STAT_OFF + 1173), 110ull, term_ctr(CID_SCON, STAT_OFF + 1175), 32ull, term_ctr(CID_SCON, STAT_OFF + 1177), 115ull, term_ctr(CID_SCON, STAT_OFF + 1179), 117ull, term_ctr(CID_SCON, STAT_OFF + 1181), 116ull, term_ctr(CID_SCON, STAT_OFF + 1183), 97ull, term_ctr(CID_SCON, STAT_OFF + 1185), 116ull, term_ctr(CID_SCON, STAT_OFF + 1187), 115ull, term_ctr(CID_SCON, STAT_OFF + 1189), 32ull, term_ctr(CID_SCON, STAT_OFF + 1191), 100ull, term_ctr(CID_SCON, STAT_OFF + 1193), 101ull, term_ctr(CID_SCON, STAT_OFF + 1195), 109ull, term_ctr(CID_SCON, STAT_OFF + 1197), 114ull, term_ctr(CID_SCON, STAT_OFF + 1199), 111ull, term_ctr(CID_SCON, STAT_OFF + 1201), 102ull, term_ctr(CID_SCON, STAT_OFF + 1203), 108ull, term_ctr(CID_SCON, STAT_OFF + 1205), 97ull, term_ctr(CID_SCON, STAT_OFF + 1207), 109ull, term_ctr(CID_SCON, STAT_OFF + 1209), 50ull, term_pak(CID_SNIL, 0), 100ull, term_ctr(CID_SCON, STAT_OFF + 1213), 97ull, term_ctr(CID_SCON, STAT_OFF + 1215), 101ull, term_ctr(CID_SCON, STAT_OFF + 1217), 104ull, term_ctr(CID_SCON, STAT_OFF + 1219), 97ull, term_ctr(CID_SCON, STAT_OFF + 1221), 103ull, term_pak(CID_SNIL, 0), 119ull, term_ctr(CID_SCON, STAT_OFF + 1225), 45ull, term_ctr(CID_SCON, STAT_OFF + 1227), 116ull, term_ctr(CID_SCON, STAT_OFF + 1229), 108ull, term_ctr(CID_SCON, STAT_OFF + 1231), 47ull, term_ctr(CID_SCON, STAT_OFF + 1233), 104ull, term_ctr(CID_SCON, STAT_OFF + 1235), 99ull, term_ctr(CID_SCON, STAT_OFF + 1237), 116ull, term_ctr(CID_SCON, STAT_OFF + 1239), 97ull, term_ctr(CID_SCON, STAT_OFF + 1241), 114ull, term_ctr(CID_SCON, STAT_OFF + 1243), 99ull, term_ctr(CID_SCON, STAT_OFF + 1245), 115ull, term_ctr(CID_SCON, STAT_OFF + 1247), 46ull, term_ctr(CID_SCON, STAT_OFF + 1249), 47ull, term_ctr(CID_SCON, STAT_OFF + 1251), 47ull, term_ctr(CID_SCON, STAT_OFF + 1227), 110ull, term_ctr(CID_SCON, STAT_OFF + 1255), 111ull, term_ctr(CID_SCON, STAT_OFF + 1257), 116ull, term_ctr(CID_SCON, STAT_OFF + 1259), 97ull, term_ctr(CID_SCON, STAT_OFF + 1261), 98ull, term_ctr(CID_SCON, STAT_OFF + 1263), 112ull, term_ctr(CID_SCON, STAT_OFF + 697), 112ull, term_ctr(CID_SCON, STAT_OFF + 1267), 97ull, term_ctr(CID_SCON, STAT_OFF + 1269), 32ull, term_ctr(CID_SCON, STAT_OFF + 1271), 62ull, term_ctr(CID_SCON, STAT_OFF + 1273), 32ull, term_ctr(CID_SCON, STAT_OFF + 1275), 39ull, term_ctr(CID_SCON, STAT_OFF + 1277), 110ull, term_ctr(CID_SCON, STAT_OFF + 1279), 92ull, term_ctr(CID_SCON, STAT_OFF + 1281), 110ull, term_ctr(CID_SCON, STAT_OFF + 1283), 101ull, term_ctr(CID_SCON, STAT_OFF + 1285), 116ull, term_ctr(CID_SCON, STAT_OFF + 1287), 39ull, term_ctr(CID_SCON, STAT_OFF + 1289), 32ull, term_ctr(CID_SCON, STAT_OFF + 1291), 102ull, term_ctr(CID_SCON, STAT_OFF + 1293), 116ull, term_ctr(CID_SCON, STAT_OFF + 1295), 110ull, term_ctr(CID_SCON, STAT_OFF + 1297), 105ull, term_ctr(CID_SCON, STAT_OFF + 1299), 114ull, term_ctr(CID_SCON, STAT_OFF + 1301), 112ull, term_ctr(CID_SCON, STAT_OFF + 1303), 108ull, term_ctr(CID_SCON, STAT_OFF + 1225), 45ull, term_ctr(CID_SCON, STAT_OFF + 1307), 116ull, term_ctr(CID_SCON, STAT_OFF + 1309), 108ull, term_ctr(CID_SCON, STAT_OFF + 1311), 47ull, term_ctr(CID_SCON, STAT_OFF + 1313), 104ull, term_ctr(CID_SCON, STAT_OFF + 1315), 99ull, term_ctr(CID_SCON, STAT_OFF + 1317), 116ull, term_ctr(CID_SCON, STAT_OFF + 1319), 97ull, term_ctr(CID_SCON, STAT_OFF + 1321), 114ull, term_ctr(CID_SCON, STAT_OFF + 1323), 99ull, term_ctr(CID_SCON, STAT_OFF + 1325), 115ull, term_ctr(CID_SCON, STAT_OFF + 1327), 46ull, term_ctr(CID_SCON, STAT_OFF + 1329), 47ull, term_ctr(CID_SCON, STAT_OFF + 1331), term_ctr(CID_SCON, STAT_OFF + 1271), term_pak(CID_NIL, 0), 50ull, term_ctr(CID_SCON, STAT_OFF + 709), 101ull, term_ctr(CID_SCON, STAT_OFF + 1337), 118ull, term_ctr(CID_SCON, STAT_OFF + 1339), 111ull, term_ctr(CID_SCON, STAT_OFF + 1341), 109ull, term_ctr(CID_SCON, STAT_OFF + 1343), 45ull, term_ctr(CID_SCON, STAT_OFF + 1345), 107ull, term_ctr(CID_SCON, STAT_OFF + 1347), 99ull, term_ctr(CID_SCON, STAT_OFF + 1349), 101ull, term_ctr(CID_SCON, STAT_OFF + 1351), 104ull, term_ctr(CID_SCON, STAT_OFF + 1353), 99ull, term_ctr(CID_SCON, STAT_OFF + 1355), 112ull, term_pak(CID_SNIL, 0), 105ull, term_ctr(CID_SCON, STAT_OFF + 1359), 116ull, term_ctr(CID_SCON, STAT_OFF + 1361), 32ull, term_ctr(CID_SCON, STAT_OFF + 1363), 100ull, term_ctr(CID_SCON, STAT_OFF + 1365), 101ull, term_ctr(CID_SCON, STAT_OFF + 1367), 118ull, term_ctr(CID_SCON, STAT_OFF + 1369), 111ull, term_ctr(CID_SCON, STAT_OFF + 1371), 109ull, term_ctr(CID_SCON, STAT_OFF + 1373), 32ull, term_ctr(CID_SCON, STAT_OFF + 1375), 101ull, term_ctr(CID_SCON, STAT_OFF + 1377), 104ull, term_ctr(CID_SCON, STAT_OFF + 1379), 116ull, term_ctr(CID_SCON, STAT_OFF + 1381), 32ull, term_ctr(CID_SCON, STAT_OFF + 1383), 116ull, term_ctr(CID_SCON, STAT_OFF + 1385), 111ull, term_ctr(CID_SCON, STAT_OFF + 1387), 110ull, term_ctr(CID_SCON, STAT_OFF + 1389), 32ull, term_ctr(CID_SCON, STAT_OFF + 1391), 115ull, term_ctr(CID_SCON, STAT_OFF + 1393), 105ull, term_ctr(CID_SCON, STAT_OFF + 1395), 32ull, term_ctr(CID_SCON, STAT_OFF + 1397), 110ull, term_ctr(CID_SCON, STAT_OFF + 1399), 105ull, term_ctr(CID_SCON, STAT_OFF + 1401), 97ull, term_ctr(CID_SCON, STAT_OFF + 1403), 109ull, term_ctr(CID_SCON, STAT_OFF + 1405), 32ull, term_ctr(CID_SCON, STAT_OFF + 1407), 58ull, term_ctr(CID_SCON, STAT_OFF + 1409), 71ull, term_ctr(CID_SCON, STAT_OFF + 1411), 32ull, term_ctr(CID_SCON, STAT_OFF + 1413), 100ull, term_ctr(CID_SCON, STAT_OFF + 1415), 110ull, term_ctr(CID_SCON, STAT_OFF + 1417), 97ull, term_ctr(CID_SCON, STAT_OFF + 1419), 108ull, term_ctr(CID_SCON, STAT_OFF + 1421), 94ull, term_pak(CID_SNIL, 0), 110ull, term_ctr(CID_SCON, STAT_OFF + 1425), 105ull, term_ctr(CID_SCON, STAT_OFF + 1427), 97ull, term_ctr(CID_SCON, STAT_OFF + 1429), 109ull, term_ctr(CID_SCON, STAT_OFF + 1431), term_ctr(CID_SCON, STAT_OFF + 1433), term_pak(CID_NIL, 0), term_ctr(CID_SCON, STAT_OFF + 127), term_ctr(CID_CON, STAT_OFF + 1435), 32ull, term_ctr(CID_SCON, STAT_OFF + 363), 104ull, term_ctr(CID_SCON, STAT_OFF + 1439), 99ull, term_ctr(CID_SCON, STAT_OFF + 1441), 110ull, term_ctr(CID_SCON, STAT_OFF + 1443), 97ull, term_ctr(CID_SCON, STAT_OFF + 1445), 114ull, term_ctr(CID_SCON, STAT_OFF + 1447), 98ull, term_ctr(CID_SCON, STAT_OFF + 1449), 102ull, term_ctr(CID_SCON, STAT_OFF + 365), 105ull, term_ctr(CID_SCON, STAT_OFF + 1453), 100ull, term_ctr(CID_SCON, STAT_OFF + 1455), 108ull, term_ctr(CID_SCON, STAT_OFF + 919), 110ull, term_ctr(CID_SCON, STAT_OFF + 1459), 111ull, term_ctr(CID_SCON, STAT_OFF + 1461), 45ull, term_ctr(CID_SCON, STAT_OFF + 1463), 101ull, term_ctr(CID_SCON, STAT_OFF + 1465), 109ull, term_ctr(CID_SCON, STAT_OFF + 1467), 97ull, term_ctr(CID_SCON, STAT_OFF + 1469), 110ull, term_ctr(CID_SCON, STAT_OFF + 1471), 45ull, term_ctr(CID_SCON, STAT_OFF + 1473), 45ull, term_ctr(CID_SCON, STAT_OFF + 1475), 85ull, term_pak(CID_SNIL, 0), 61ull, term_ctr(CID_SCON, STAT_OFF + 1479), 114ull, term_ctr(CID_SCON, STAT_OFF + 1481), 101ull, term_ctr(CID_SCON, STAT_OFF + 1483), 116ull, term_ctr(CID_SCON, STAT_OFF + 1485), 108ull, term_ctr(CID_SCON, STAT_OFF + 1487), 105ull, term_ctr(CID_SCON, STAT_OFF + 1489), 102ull, term_ctr(CID_SCON, STAT_OFF + 1491), 45ull, term_ctr(CID_SCON, STAT_OFF + 1493), 102ull, term_ctr(CID_SCON, STAT_OFF + 1495), 102ull, term_ctr(CID_SCON, STAT_OFF + 1497), 105ull, term_ctr(CID_SCON, STAT_OFF + 1499), 100ull, term_ctr(CID_SCON, STAT_OFF + 1501), 45ull, term_ctr(CID_SCON, STAT_OFF + 1503), 45ull, term_ctr(CID_SCON, STAT_OFF + 1505), term_ctr(CID_SCON, STAT_OFF + 1507), term_pak(CID_NIL, 0), term_ctr(CID_SCON, STAT_OFF + 1477), term_ctr(CID_CON, STAT_OFF + 1509), term_ctr(CID_SCON, STAT_OFF + 1457), term_ctr(CID_CON, STAT_OFF + 1511), 107ull, term_ctr(CID_SCON, STAT_OFF + 289), 111ull, term_ctr(CID_SCON, STAT_OFF + 1515), 116ull, term_ctr(CID_SCON, STAT_OFF + 1517), 32ull, term_ctr(CID_SCON, STAT_OFF + 1519), 115ull, term_ctr(CID_SCON, STAT_OFF + 1521), 117ull, term_ctr(CID_SCON, STAT_OFF + 1523), 116ull, term_ctr(CID_SCON, STAT_OFF + 1525), 97ull, term_ctr(CID_SCON, STAT_OFF + 1527), 116ull, term_ctr(CID_SCON, STAT_OFF + 1529), 115ull, term_ctr(CID_SCON, STAT_OFF + 1531), 32ull, term_ctr(CID_SCON, STAT_OFF + 1533), 110ull, term_ctr(CID_SCON, STAT_OFF + 1535), 119ull, term_ctr(CID_SCON, STAT_OFF + 1537), 111ull, term_ctr(CID_SCON, STAT_OFF + 1539), 110ull, term_ctr(CID_SCON, STAT_OFF + 1541), 107ull, term_ctr(CID_SCON, STAT_OFF + 1543), 110ull, term_ctr(CID_SCON, STAT_OFF + 1545), 117ull, term_ctr(CID_SCON, STAT_OFF + 1547), 97ull, term_ctr(CID_SCON, STAT_OFF + 40), 101ull, term_ctr(CID_SCON, STAT_OFF + 1551), 104ull, term_ctr(CID_SCON, STAT_OFF + 1553), 97ull, term_ctr(CID_SCON, STAT_OFF + 1555), 119ull, term_ctr(CID_SCON, STAT_OFF + 365), 45ull, term_ctr(CID_SCON, STAT_OFF + 1559), 116ull, term_ctr(CID_SCON, STAT_OFF + 1561), 108ull, term_ctr(CID_SCON, STAT_OFF + 1563), 47ull, term_ctr(CID_SCON, STAT_OFF + 1565), 104ull, term_ctr(CID_SCON, STAT_OFF + 1567), 99ull, term_ctr(CID_SCON, STAT_OFF + 1569), 116ull, term_ctr(CID_SCON, STAT_OFF + 1571), 97ull, term_ctr(CID_SCON, STAT_OFF + 1573), 114ull, term_ctr(CID_SCON, STAT_OFF + 1575), 99ull, term_ctr(CID_SCON, STAT_OFF + 1577), 115ull, term_ctr(CID_SCON, STAT_OFF + 1579), 46ull, term_ctr(CID_SCON, STAT_OFF + 1581), 47ull, term_ctr(CID_SCON, STAT_OFF + 1583), 47ull, term_ctr(CID_SCON, STAT_OFF + 1559), 110ull, term_ctr(CID_SCON, STAT_OFF + 1587), 111ull, term_ctr(CID_SCON, STAT_OFF + 1589), 116ull, term_ctr(CID_SCON, STAT_OFF + 1591), 97ull, term_ctr(CID_SCON, STAT_OFF + 1593), 98ull, term_ctr(CID_SCON, STAT_OFF + 1595), 50ull, term_ctr(CID_SCON, STAT_OFF + 697), 116ull, term_ctr(CID_SCON, STAT_OFF + 1599), 97ull, term_ctr(CID_SCON, STAT_OFF + 1601), 101ull, term_ctr(CID_SCON, STAT_OFF + 1603), 102ull, term_ctr(CID_SCON, STAT_OFF + 1605), 32ull, term_ctr(CID_SCON, STAT_OFF + 1607), 62ull, term_ctr(CID_SCON, STAT_OFF + 1609), 32ull, term_ctr(CID_SCON, STAT_OFF + 1611), 39ull, term_ctr(CID_SCON, STAT_OFF + 1613), 110ull, term_ctr(CID_SCON, STAT_OFF + 1615), 92ull, term_ctr(CID_SCON, STAT_OFF + 1617), 50ull, term_ctr(CID_SCON, STAT_OFF + 1619), 116ull, term_ctr(CID_SCON, STAT_OFF + 1621), 97ull, term_ctr(CID_SCON, STAT_OFF + 1623), 101ull, term_ctr(CID_SCON, STAT_OFF + 1625), 102ull, term_ctr(CID_SCON, STAT_OFF + 1627), 39ull, term_ctr(CID_SCON, STAT_OFF + 1629), 32ull, term_ctr(CID_SCON, STAT_OFF + 1631), 102ull, term_ctr(CID_SCON, STAT_OFF + 1633), 116ull, term_ctr(CID_SCON, STAT_OFF + 1635), 110ull, term_ctr(CID_SCON, STAT_OFF + 1637), 105ull, term_ctr(CID_SCON, STAT_OFF + 1639), 114ull, term_ctr(CID_SCON, STAT_OFF + 1641), 112ull, term_ctr(CID_SCON, STAT_OFF + 1643), 108ull, term_ctr(CID_SCON, STAT_OFF + 365), 45ull, term_ctr(CID_SCON, STAT_OFF + 1647), 116ull, term_ctr(CID_SCON, STAT_OFF + 1649), 108ull, term_ctr(CID_SCON, STAT_OFF + 1651), 47ull, term_ctr(CID_SCON, STAT_OFF + 1653), 104ull, term_ctr(CID_SCON, STAT_OFF + 1655), 99ull, term_ctr(CID_SCON, STAT_OFF + 1657), 116ull, term_ctr(CID_SCON, STAT_OFF + 1659), 97ull, term_ctr(CID_SCON, STAT_OFF + 1661), 114ull, term_ctr(CID_SCON, STAT_OFF + 1663), 99ull, term_ctr(CID_SCON, STAT_OFF + 1665), 115ull, term_ctr(CID_SCON, STAT_OFF + 1667), 46ull, term_ctr(CID_SCON, STAT_OFF + 1669), 47ull, term_ctr(CID_SCON, STAT_OFF + 1671), term_ctr(CID_SCON, STAT_OFF + 1607), term_pak(CID_NIL, 0), 101ull, term_ctr(CID_SCON, STAT_OFF + 709), 118ull, term_ctr(CID_SCON, STAT_OFF + 1677), 111ull, term_ctr(CID_SCON, STAT_OFF + 1679), 109ull, term_ctr(CID_SCON, STAT_OFF + 1681), 45ull, term_ctr(CID_SCON, STAT_OFF + 1683), 107ull, term_ctr(CID_SCON, STAT_OFF + 1685), 99ull, term_ctr(CID_SCON, STAT_OFF + 1687), 101ull, term_ctr(CID_SCON, STAT_OFF + 1689), 104ull, term_ctr(CID_SCON, STAT_OFF + 1691), 99ull, term_ctr(CID_SCON, STAT_OFF + 1693), 114ull, term_ctr(CID_SCON, STAT_OFF + 697), 101ull, term_ctr(CID_SCON, STAT_OFF + 1697), 104ull, term_ctr(CID_SCON, STAT_OFF + 1699), 116ull, term_ctr(CID_SCON, STAT_OFF + 1701), 111ull, term_ctr(CID_SCON, STAT_OFF + 1703), 116ull, term_ctr(CID_SCON, STAT_OFF + 1399), 110ull, term_ctr(CID_SCON, STAT_OFF + 1707), 101ull, term_ctr(CID_SCON, STAT_OFF + 1709), 114ull, term_ctr(CID_SCON, STAT_OFF + 1711), 97ull, term_ctr(CID_SCON, STAT_OFF + 1713), 112ull, term_ctr(CID_SCON, STAT_OFF + 1715), 32ull, term_ctr(CID_SCON, STAT_OFF + 1717), 116ull, term_ctr(CID_SCON, STAT_OFF + 1719), 101ull, term_ctr(CID_SCON, STAT_OFF + 1721), 103ull, term_ctr(CID_SCON, STAT_OFF + 1723), 114ull, term_ctr(CID_SCON, STAT_OFF + 1725), 97ull, term_ctr(CID_SCON, STAT_OFF + 1727), 116ull, term_ctr(CID_SCON, STAT_OFF + 1729), 32ull, term_ctr(CID_SCON, STAT_OFF + 1731), 58ull, term_ctr(CID_SCON, STAT_OFF + 1733), 70ull, term_ctr(CID_SCON, STAT_OFF + 1735), 32ull, term_ctr(CID_SCON, STAT_OFF + 1737), 100ull, term_ctr(CID_SCON, STAT_OFF + 1739), 110ull, term_ctr(CID_SCON, STAT_OFF + 1741), 97ull, term_ctr(CID_SCON, STAT_OFF + 1743), 108ull, term_ctr(CID_SCON, STAT_OFF + 1745), 104ull, term_ctr(CID_SCON, STAT_OFF + 1169), 116ull, term_ctr(CID_SCON, STAT_OFF + 1749), 111ull, term_ctr(CID_SCON, STAT_OFF + 1751), 32ull, term_ctr(CID_SCON, STAT_OFF + 1103), 114ull, term_ctr(CID_SCON, STAT_OFF + 1755), 101ull, term_ctr(CID_SCON, STAT_OFF + 1757), 116ull, term_ctr(CID_SCON, STAT_OFF + 1759), 102ull, term_ctr(CID_SCON, STAT_OFF + 1761), 97ull, term_ctr(CID_SCON, STAT_OFF + 1763), 32ull, term_ctr(CID_SCON, STAT_OFF + 1765), 103ull, term_ctr(CID_SCON, STAT_OFF + 1767), 110ull, term_ctr(CID_SCON, STAT_OFF + 1769), 105ull, term_ctr(CID_SCON, STAT_OFF + 1771), 115ull, term_ctr(CID_SCON, STAT_OFF + 1773), 115ull, term_ctr(CID_SCON, STAT_OFF + 1775), 105ull, term_ctr(CID_SCON, STAT_OFF + 1777), 109ull, term_ctr(CID_SCON, STAT_OFF + 1779), 32ull, term_ctr(CID_SCON, STAT_OFF + 1781), 116ull, term_ctr(CID_SCON, STAT_OFF + 1783), 120ull, term_ctr(CID_SCON, STAT_OFF + 1785), 116ull, term_ctr(CID_SCON, STAT_OFF + 1787), 46ull, term_ctr(CID_SCON, STAT_OFF + 1789), 114ull, term_ctr(CID_SCON, STAT_OFF + 1791), 101ull, term_ctr(CID_SCON, STAT_OFF + 1793), 104ull, term_ctr(CID_SCON, STAT_OFF + 1795), 116ull, term_ctr(CID_SCON, STAT_OFF + 1797), 111ull, term_ctr(CID_SCON, STAT_OFF + 1799), 32ull, term_ctr(CID_SCON, STAT_OFF + 1801), 58ull, term_ctr(CID_SCON, STAT_OFF + 1803), 70ull, term_ctr(CID_SCON, STAT_OFF + 1805), 32ull, term_ctr(CID_SCON, STAT_OFF + 1807), 100ull, term_ctr(CID_SCON, STAT_OFF + 1809), 110ull, term_ctr(CID_SCON, STAT_OFF + 1811), 97ull, term_ctr(CID_SCON, STAT_OFF + 1813), 108ull, term_ctr(CID_SCON, STAT_OFF + 1815), 116ull, term_ctr(CID_SCON, STAT_OFF + 1213), 97ull, term_ctr(CID_SCON, STAT_OFF + 1819), 101ull, term_ctr(CID_SCON, STAT_OFF + 1821), 102ull, term_ctr(CID_SCON, STAT_OFF + 1823), 50ull, term_ctr(CID_SCON, STAT_OFF + 1791), 116ull, term_ctr(CID_SCON, STAT_OFF + 1827), 97ull, term_ctr(CID_SCON, STAT_OFF + 1829), 101ull, term_ctr(CID_SCON, STAT_OFF + 1831), 102ull, term_ctr(CID_SCON, STAT_OFF + 1833), 32ull, term_ctr(CID_SCON, STAT_OFF + 1835), 58ull, term_ctr(CID_SCON, STAT_OFF + 1837), 70ull, term_ctr(CID_SCON, STAT_OFF + 1839), 32ull, term_ctr(CID_SCON, STAT_OFF + 1841), 100ull, term_ctr(CID_SCON, STAT_OFF + 1843), 110ull, term_ctr(CID_SCON, STAT_OFF + 1845), 97ull, term_ctr(CID_SCON, STAT_OFF + 1847), 108ull, term_ctr(CID_SCON, STAT_OFF + 1849), 104ull, term_ctr(CID_SCON, STAT_OFF + 2), 99ull, term_ctr(CID_SCON, STAT_OFF + 1853), 116ull, term_ctr(CID_SCON, STAT_OFF + 1855), 97ull, term_ctr(CID_SCON, STAT_OFF + 1857), 109ull, term_ctr(CID_SCON, STAT_OFF + 1859), 115ull, term_ctr(CID_SCON, STAT_OFF + 1861), 105ull, term_ctr(CID_SCON, STAT_OFF + 1863), 109ull, term_ctr(CID_SCON, STAT_OFF + 1865), 32ull, term_ctr(CID_SCON, STAT_OFF + 1867), 115ull, term_ctr(CID_SCON, STAT_OFF + 1869), 104ull, term_ctr(CID_SCON, STAT_OFF + 1871), 116ull, term_ctr(CID_SCON, STAT_OFF + 1873), 97ull, term_ctr(CID_SCON, STAT_OFF + 1875), 112ull, term_ctr(CID_SCON, STAT_OFF + 1877), 32ull, term_ctr(CID_SCON, STAT_OFF + 1879), 116ull, term_ctr(CID_SCON, STAT_OFF + 1881), 99ull, term_ctr(CID_SCON, STAT_OFF + 1883), 105ull, term_ctr(CID_SCON, STAT_OFF + 1885), 108ull, term_ctr(CID_SCON, STAT_OFF + 1887), 102ull, term_ctr(CID_SCON, STAT_OFF + 1889), 110ull, term_ctr(CID_SCON, STAT_OFF + 1891), 111ull, term_ctr(CID_SCON, STAT_OFF + 1893), 99ull, term_ctr(CID_SCON, STAT_OFF + 1895), 32ull, term_ctr(CID_SCON, STAT_OFF + 1897), 58ull, term_ctr(CID_SCON, STAT_OFF + 1899), 100ull, term_ctr(CID_SCON, STAT_OFF + 1901), 110ull, term_ctr(CID_SCON, STAT_OFF + 1903), 97ull, term_ctr(CID_SCON, STAT_OFF + 1905), 108ull, term_ctr(CID_SCON, STAT_OFF + 1907), 116ull, term_ctr(CID_SCON, STAT_OFF + 505), 99ull, term_ctr(CID_SCON, STAT_OFF + 1911), 105ull, term_ctr(CID_SCON, STAT_OFF + 1913), 108ull, term_ctr(CID_SCON, STAT_OFF + 1915), 102ull, term_ctr(CID_SCON, STAT_OFF + 1917), 110ull, term_ctr(CID_SCON, STAT_OFF + 1919), 111ull, term_ctr(CID_SCON, STAT_OFF + 1921), 99ull, term_ctr(CID_SCON, STAT_OFF + 1923), 32ull, term_ctr(CID_SCON, STAT_OFF + 1925), 101ull, term_ctr(CID_SCON, STAT_OFF + 1927), 114ull, term_ctr(CID_SCON, STAT_OFF + 1929), 101ull, term_ctr(CID_SCON, STAT_OFF + 1931), 104ull, term_ctr(CID_SCON, STAT_OFF + 1933), 119ull, term_ctr(CID_SCON, STAT_OFF + 1935), 32ull, term_ctr(CID_SCON, STAT_OFF + 1937), 100ull, term_ctr(CID_SCON, STAT_OFF + 1939), 101ull, term_ctr(CID_SCON, STAT_OFF + 1941), 100ull, term_ctr(CID_SCON, STAT_OFF + 1943), 110ull, term_ctr(CID_SCON, STAT_OFF + 1945), 97ull, term_ctr(CID_SCON, STAT_OFF + 1947), 108ull, term_ctr(CID_SCON, STAT_OFF + 1949), 32ull, term_ctr(CID_SCON, STAT_OFF + 1951), 58ull, term_ctr(CID_SCON, STAT_OFF + 1953), 100ull, term_ctr(CID_SCON, STAT_OFF + 1955), 110ull, term_ctr(CID_SCON, STAT_OFF + 1957), 97ull, term_ctr(CID_SCON, STAT_OFF + 1959), 108ull, term_ctr(CID_SCON, STAT_OFF + 1961), 121ull, term_ctr(CID_SCON, STAT_OFF + 1939), 100ull, term_ctr(CID_SCON, STAT_OFF + 1965), 97ull, term_ctr(CID_SCON, STAT_OFF + 1967), 101ull, term_ctr(CID_SCON, STAT_OFF + 1969), 114ull, term_ctr(CID_SCON, STAT_OFF + 1971), 108ull, term_ctr(CID_SCON, STAT_OFF + 1973), 97ull, term_ctr(CID_SCON, STAT_OFF + 1975), 32ull, term_ctr(CID_SCON, STAT_OFF + 1977), 58ull, term_ctr(CID_SCON, STAT_OFF + 1979), 100ull, term_ctr(CID_SCON, STAT_OFF + 1981), 110ull, term_ctr(CID_SCON, STAT_OFF + 1983), 97ull, term_ctr(CID_SCON, STAT_OFF + 1985), 108ull, term_ctr(CID_SCON, STAT_OFF + 1987), 116ull, term_ctr(CID_SCON, STAT_OFF + 413), 99ull, term_ctr(CID_SCON, STAT_OFF + 1991), 105ull, term_ctr(CID_SCON, STAT_OFF + 1993), 108ull, term_ctr(CID_SCON, STAT_OFF + 1995), 102ull, term_ctr(CID_SCON, STAT_OFF + 1997), 110ull, term_ctr(CID_SCON, STAT_OFF + 1999), 111ull, term_ctr(CID_SCON, STAT_OFF + 2001), 99ull, term_ctr(CID_SCON, STAT_OFF + 2003), 32ull, term_ctr(CID_SCON, STAT_OFF + 2005), 101ull, term_ctr(CID_SCON, STAT_OFF + 2007), 114ull, term_ctr(CID_SCON, STAT_OFF + 2009), 101ull, term_ctr(CID_SCON, STAT_OFF + 2011), 104ull, term_ctr(CID_SCON, STAT_OFF + 2013), 119ull, term_ctr(CID_SCON, STAT_OFF + 2015), 32ull, term_ctr(CID_SCON, STAT_OFF + 2017), 100ull, term_ctr(CID_SCON, STAT_OFF + 2019), 101ull, term_ctr(CID_SCON, STAT_OFF + 2021), 107ull, term_ctr(CID_SCON, STAT_OFF + 2023), 99ull, term_ctr(CID_SCON, STAT_OFF + 2025), 111ull, term_ctr(CID_SCON, STAT_OFF + 2027), 108ull, term_ctr(CID_SCON, STAT_OFF + 2029), 98ull, term_ctr(CID_SCON, STAT_OFF + 2031), 32ull, term_ctr(CID_SCON, STAT_OFF + 2033), 58ull, term_ctr(CID_SCON, STAT_OFF + 2035), 100ull, term_ctr(CID_SCON, STAT_OFF + 2037), 110ull, term_ctr(CID_SCON, STAT_OFF + 2039), 97ull, term_ctr(CID_SCON, STAT_OFF + 2041), 108ull, term_ctr(CID_SCON, STAT_OFF + 2043), 115ull, term_ctr(CID_SCON, STAT_OFF + 237), 117ull, term_ctr(CID_SCON, STAT_OFF + 2047), 102ull, term_ctr(CID_SCON, STAT_OFF + 2049), 101ull, term_ctr(CID_SCON, STAT_OFF + 2051), 114ull, term_ctr(CID_SCON, STAT_OFF + 2053), 32ull, term_ctr(CID_SCON, STAT_OFF + 2055), 100ull, term_ctr(CID_SCON, STAT_OFF + 2057), 110ull, term_ctr(CID_SCON, STAT_OFF + 2059), 97ull, term_ctr(CID_SCON, STAT_OFF + 2061), 108ull, term_ctr(CID_SCON, STAT_OFF + 2063), 108ull, term_ctr(CID_SCON, STAT_OFF + 491), 105ull, term_ctr(CID_SCON, STAT_OFF + 2067), 97ull, term_ctr(CID_SCON, STAT_OFF + 2069), 102ull, term_ctr(CID_SCON, STAT_OFF + 2071), 32ull, term_ctr(CID_SCON, STAT_OFF + 2073), 101ull, term_ctr(CID_SCON, STAT_OFF + 2075), 101ull, term_ctr(CID_SCON, STAT_OFF + 2077), 114ull, term_ctr(CID_SCON, STAT_OFF + 2079), 116ull, term_ctr(CID_SCON, STAT_OFF + 2081), 107ull, term_ctr(CID_SCON, STAT_OFF + 2083), 114ull, term_ctr(CID_SCON, STAT_OFF + 2085), 111ull, term_ctr(CID_SCON, STAT_OFF + 2087), 119ull, term_ctr(CID_SCON, STAT_OFF + 2089), 32ull, term_ctr(CID_SCON, STAT_OFF + 2091), 116ull, term_ctr(CID_SCON, STAT_OFF + 2093), 101ull, term_ctr(CID_SCON, STAT_OFF + 2095), 103ull, term_ctr(CID_SCON, STAT_OFF + 2097), 114ull, term_ctr(CID_SCON, STAT_OFF + 2099), 97ull, term_ctr(CID_SCON, STAT_OFF + 2101), 116ull, term_ctr(CID_SCON, STAT_OFF + 2103), 4, term_ctr(CID_SCON, STAT_OFF + 46), term_ctr(CID_SCON, STAT_OFF + 2105), 32ull, term_ctr(CID_SCON, STAT_OFF + 265), 110ull, term_ctr(CID_SCON, STAT_OFF + 2110), 119ull, term_ctr(CID_SCON, STAT_OFF + 2112), 111ull, term_ctr(CID_SCON, STAT_OFF + 2114), 110ull, term_ctr(CID_SCON, STAT_OFF + 2116), 107ull, term_ctr(CID_SCON, STAT_OFF + 2118), 110ull, term_ctr(CID_SCON, STAT_OFF + 2120), 117ull, term_ctr(CID_SCON, STAT_OFF + 2122), 119ull, term_ctr(CID_SCON, STAT_OFF + 48), 45ull, term_ctr(CID_SCON, STAT_OFF + 2126), 116ull, term_ctr(CID_SCON, STAT_OFF + 2128), 108ull, term_ctr(CID_SCON, STAT_OFF + 2130), 47ull, term_ctr(CID_SCON, STAT_OFF + 2132), 104ull, term_ctr(CID_SCON, STAT_OFF + 2134), 99ull, term_ctr(CID_SCON, STAT_OFF + 2136), 116ull, term_ctr(CID_SCON, STAT_OFF + 2138), 97ull, term_ctr(CID_SCON, STAT_OFF + 2140), 114ull, term_ctr(CID_SCON, STAT_OFF + 2142), 99ull, term_ctr(CID_SCON, STAT_OFF + 2144), 115ull, term_ctr(CID_SCON, STAT_OFF + 2146), 46ull, term_ctr(CID_SCON, STAT_OFF + 2148), 47ull, term_ctr(CID_SCON, STAT_OFF + 2150), 47ull, term_ctr(CID_SCON, STAT_OFF + 2126), 110ull, term_ctr(CID_SCON, STAT_OFF + 2154), 111ull, term_ctr(CID_SCON, STAT_OFF + 2156), 116ull, term_ctr(CID_SCON, STAT_OFF + 2158), 97ull, term_ctr(CID_SCON, STAT_OFF + 2160), 98ull, term_ctr(CID_SCON, STAT_OFF + 2162), 101ull, term_ctr(CID_SCON, STAT_OFF + 1283), 101ull, term_ctr(CID_SCON, STAT_OFF + 2166), 114ull, term_ctr(CID_SCON, STAT_OFF + 2168), 104ull, term_ctr(CID_SCON, STAT_OFF + 2170), 116ull, term_ctr(CID_SCON, STAT_OFF + 2172), 39ull, term_ctr(CID_SCON, STAT_OFF + 2174), 32ull, term_ctr(CID_SCON, STAT_OFF + 2176), 102ull, term_ctr(CID_SCON, STAT_OFF + 2178), 116ull, term_ctr(CID_SCON, STAT_OFF + 2180), 110ull, term_ctr(CID_SCON, STAT_OFF + 2182), 105ull, term_ctr(CID_SCON, STAT_OFF + 2184), 114ull, term_ctr(CID_SCON, STAT_OFF + 2186), 112ull, term_ctr(CID_SCON, STAT_OFF + 2188), 108ull, term_ctr(CID_SCON, STAT_OFF + 48), 45ull, term_ctr(CID_SCON, STAT_OFF + 2192), 116ull, term_ctr(CID_SCON, STAT_OFF + 2194), 108ull, term_ctr(CID_SCON, STAT_OFF + 2196), 47ull, term_ctr(CID_SCON, STAT_OFF + 2198), 104ull, term_ctr(CID_SCON, STAT_OFF + 2200), 99ull, term_ctr(CID_SCON, STAT_OFF + 2202), 116ull, term_ctr(CID_SCON, STAT_OFF + 2204), 97ull, term_ctr(CID_SCON, STAT_OFF + 2206), 114ull, term_ctr(CID_SCON, STAT_OFF + 2208), 99ull, term_ctr(CID_SCON, STAT_OFF + 2210), 115ull, term_ctr(CID_SCON, STAT_OFF + 2212), 46ull, term_ctr(CID_SCON, STAT_OFF + 2214), 47ull, term_ctr(CID_SCON, STAT_OFF + 2216), 115ull, term_ctr(CID_SCON, STAT_OFF + 255), 105ull, term_ctr(CID_SCON, STAT_OFF + 2220), 108ull, term_ctr(CID_SCON, STAT_OFF + 2222), 108ull, term_ctr(CID_SCON, STAT_OFF + 661), 101ull, term_ctr(CID_SCON, STAT_OFF + 2226), 99ull, term_ctr(CID_SCON, STAT_OFF + 2228), 114ull, term_ctr(CID_SCON, STAT_OFF + 2230), 111ull, term_ctr(CID_SCON, STAT_OFF + 2232), 112ull, term_ctr(CID_SCON, STAT_OFF + 2234), 45ull, term_ctr(CID_SCON, STAT_OFF + 2236), 45ull, term_ctr(CID_SCON, STAT_OFF + 2238), term_ctr(CID_SCON, STAT_OFF + 2240), term_pak(CID_NIL, 0), term_ctr(CID_SCON, STAT_OFF + 2224), term_ctr(CID_CON, STAT_OFF + 2242), term_ctr(CID_SCON, STAT_OFF + 971), term_ctr(CID_CON, STAT_OFF + 2244), 45ull, term_ctr(CID_SCON, STAT_OFF + 971), 101ull, term_ctr(CID_SCON, STAT_OFF + 2248), 116ull, term_ctr(CID_SCON, STAT_OFF + 2250), 97ull, term_ctr(CID_SCON, STAT_OFF + 2252), 101ull, term_ctr(CID_SCON, STAT_OFF + 2254), 114ull, term_ctr(CID_SCON, STAT_OFF + 2256), 99ull, term_ctr(CID_SCON, STAT_OFF + 2258), 120ull, term_ctr(CID_SCON, STAT_OFF + 863), 101ull, term_ctr(CID_SCON, STAT_OFF + 2262), 119ull, term_ctr(CID_SCON, STAT_OFF + 40), 45ull, term_ctr(CID_SCON, STAT_OFF + 2266), 116ull, term_ctr(CID_SCON, STAT_OFF + 2268), 108ull, term_ctr(CID_SCON, STAT_OFF + 2270), 47ull, term_ctr(CID_SCON, STAT_OFF + 2272), 104ull, term_ctr(CID_SCON, STAT_OFF + 2274), 99ull, term_ctr(CID_SCON, STAT_OFF + 2276), 116ull, term_ctr(CID_SCON, STAT_OFF + 2278), 97ull, term_ctr(CID_SCON, STAT_OFF + 2280), 114ull, term_ctr(CID_SCON, STAT_OFF + 2282), 99ull, term_ctr(CID_SCON, STAT_OFF + 2284), 115ull, term_ctr(CID_SCON, STAT_OFF + 2286), 46ull, term_ctr(CID_SCON, STAT_OFF + 2288), 47ull, term_ctr(CID_SCON, STAT_OFF + 2290), 47ull, term_ctr(CID_SCON, STAT_OFF + 2266), 110ull, term_ctr(CID_SCON, STAT_OFF + 2294), 111ull, term_ctr(CID_SCON, STAT_OFF + 2296), 116ull, term_ctr(CID_SCON, STAT_OFF + 2298), 97ull, term_ctr(CID_SCON, STAT_OFF + 2300), 98ull, term_ctr(CID_SCON, STAT_OFF + 2302), 111ull, term_ctr(CID_SCON, STAT_OFF + 1283), 119ull, term_ctr(CID_SCON, STAT_OFF + 2306), 116ull, term_ctr(CID_SCON, STAT_OFF + 2308), 39ull, term_ctr(CID_SCON, STAT_OFF + 2310), 32ull, term_ctr(CID_SCON, STAT_OFF + 2312), 102ull, term_ctr(CID_SCON, STAT_OFF + 2314), 116ull, term_ctr(CID_SCON, STAT_OFF + 2316), 110ull, term_ctr(CID_SCON, STAT_OFF + 2318), 105ull, term_ctr(CID_SCON, STAT_OFF + 2320), 114ull, term_ctr(CID_SCON, STAT_OFF + 2322), 112ull, term_ctr(CID_SCON, STAT_OFF + 2324), 108ull, term_ctr(CID_SCON, STAT_OFF + 40), 45ull, term_ctr(CID_SCON, STAT_OFF + 2328), 116ull, term_ctr(CID_SCON, STAT_OFF + 2330), 108ull, term_ctr(CID_SCON, STAT_OFF + 2332), 47ull, term_ctr(CID_SCON, STAT_OFF + 2334), 104ull, term_ctr(CID_SCON, STAT_OFF + 2336), 99ull, term_ctr(CID_SCON, STAT_OFF + 2338), 116ull, term_ctr(CID_SCON, STAT_OFF + 2340), 97ull, term_ctr(CID_SCON, STAT_OFF + 2342), 114ull, term_ctr(CID_SCON, STAT_OFF + 2344), 99ull, term_ctr(CID_SCON, STAT_OFF + 2346), 115ull, term_ctr(CID_SCON, STAT_OFF + 2348), 46ull, term_ctr(CID_SCON, STAT_OFF + 2350), 47ull, term_ctr(CID_SCON, STAT_OFF + 2352), 121ull, term_ctr(CID_SCON, STAT_OFF + 711), 97ull, term_ctr(CID_SCON, STAT_OFF + 2356), 119ull, term_ctr(CID_SCON, STAT_OFF + 2358), 108ull, term_ctr(CID_SCON, STAT_OFF + 2360), 97ull, term_ctr(CID_SCON, STAT_OFF + 2362), 45ull, term_ctr(CID_SCON, STAT_OFF + 2364), 107ull, term_ctr(CID_SCON, STAT_OFF + 2366), 99ull, term_ctr(CID_SCON, STAT_OFF + 2368), 101ull, term_ctr(CID_SCON, STAT_OFF + 2370), 104ull, term_ctr(CID_SCON, STAT_OFF + 2372), 99ull, term_ctr(CID_SCON, STAT_OFF + 2374), 119ull, term_ctr(CID_SCON, STAT_OFF + 331), 116ull, term_ctr(CID_SCON, STAT_OFF + 2378), 110ull, term_ctr(CID_SCON, STAT_OFF + 1225), 105ull, term_ctr(CID_SCON, STAT_OFF + 2382), 100ull, term_ctr(CID_SCON, STAT_OFF + 2384), 110ull, term_ctr(CID_SCON, STAT_OFF + 2386), 97ull, term_ctr(CID_SCON, STAT_OFF + 2388), 108ull, term_ctr(CID_SCON, STAT_OFF + 2390), 32ull, term_ctr(CID_SCON, STAT_OFF + 2392), 114ull, term_ctr(CID_SCON, STAT_OFF + 2394), 101ull, term_ctr(CID_SCON, STAT_OFF + 2396), 116ull, term_ctr(CID_SCON, STAT_OFF + 2398), 102ull, term_ctr(CID_SCON, STAT_OFF + 2400), 97ull, term_ctr(CID_SCON, STAT_OFF + 2402), 32ull, term_ctr(CID_SCON, STAT_OFF + 2404), 103ull, term_ctr(CID_SCON, STAT_OFF + 2406), 110ull, term_ctr(CID_SCON, STAT_OFF + 2408), 111ull, term_ctr(CID_SCON, STAT_OFF + 2410), 114ull, term_ctr(CID_SCON, STAT_OFF + 2412), 119ull, term_ctr(CID_SCON, STAT_OFF + 2414), 32ull, term_ctr(CID_SCON, STAT_OFF + 2416), 116ull, term_ctr(CID_SCON, STAT_OFF + 2418), 120ull, term_ctr(CID_SCON, STAT_OFF + 2420), 116ull, term_ctr(CID_SCON, STAT_OFF + 2422), 46ull, term_ctr(CID_SCON, STAT_OFF + 2424), 112ull, term_ctr(CID_SCON, STAT_OFF + 2426), 112ull, term_ctr(CID_SCON, STAT_OFF + 2428), 97ull, term_ctr(CID_SCON, STAT_OFF + 2430), 32ull, term_ctr(CID_SCON, STAT_OFF + 2432), 58ull, term_ctr(CID_SCON, STAT_OFF + 2434), 68ull, term_ctr(CID_SCON, STAT_OFF + 2436), 32ull, term_ctr(CID_SCON, STAT_OFF + 2438), 100ull, term_ctr(CID_SCON, STAT_OFF + 2440), 110ull, term_ctr(CID_SCON, STAT_OFF + 2442), 97ull, term_ctr(CID_SCON, STAT_OFF + 2444), 108ull, term_ctr(CID_SCON, STAT_OFF + 2446), 100ull, term_ctr(CID_SCON, STAT_OFF + 505), 101ull, term_ctr(CID_SCON, STAT_OFF + 2450), 107ull, term_ctr(CID_SCON, STAT_OFF + 2452), 99ull, term_ctr(CID_SCON, STAT_OFF + 2454), 111ull, term_ctr(CID_SCON, STAT_OFF + 2456), 108ull, term_ctr(CID_SCON, STAT_OFF + 2458), 98ull, term_ctr(CID_SCON, STAT_OFF + 2460), 32ull, term_ctr(CID_SCON, STAT_OFF + 2462), 101ull, term_ctr(CID_SCON, STAT_OFF + 2464), 114ull, term_ctr(CID_SCON, STAT_OFF + 2466), 101ull, term_ctr(CID_SCON, STAT_OFF + 2468), 104ull, term_ctr(CID_SCON, STAT_OFF + 2470), 119ull, term_ctr(CID_SCON, STAT_OFF + 2472), 32ull, term_ctr(CID_SCON, STAT_OFF + 2474), 100ull, term_ctr(CID_SCON, STAT_OFF + 2476), 101ull, term_ctr(CID_SCON, STAT_OFF + 2478), 100ull, term_ctr(CID_SCON, STAT_OFF + 2480), 110ull, term_ctr(CID_SCON, STAT_OFF + 2482), 97ull, term_ctr(CID_SCON, STAT_OFF + 2484), 108ull, term_ctr(CID_SCON, STAT_OFF + 2486), 32ull, term_ctr(CID_SCON, STAT_OFF + 2488), 58ull, term_ctr(CID_SCON, STAT_OFF + 2490), 100ull, term_ctr(CID_SCON, STAT_OFF + 2492), 110ull, term_ctr(CID_SCON, STAT_OFF + 2494), 97ull, term_ctr(CID_SCON, STAT_OFF + 2496), 108ull, term_ctr(CID_SCON, STAT_OFF + 2498), 121ull, term_ctr(CID_SCON, STAT_OFF + 2476), 100ull, term_ctr(CID_SCON, STAT_OFF + 2502), 97ull, term_ctr(CID_SCON, STAT_OFF + 2504), 101ull, term_ctr(CID_SCON, STAT_OFF + 2506), 114ull, term_ctr(CID_SCON, STAT_OFF + 2508), 108ull, term_ctr(CID_SCON, STAT_OFF + 2510), 97ull, term_ctr(CID_SCON, STAT_OFF + 2512), 32ull, term_ctr(CID_SCON, STAT_OFF + 2514), 58ull, term_ctr(CID_SCON, STAT_OFF + 2516), 100ull, term_ctr(CID_SCON, STAT_OFF + 2518), 110ull, term_ctr(CID_SCON, STAT_OFF + 2520), 97ull, term_ctr(CID_SCON, STAT_OFF + 2522), 108ull, term_ctr(CID_SCON, STAT_OFF + 2524), 116ull, term_ctr(CID_SCON, STAT_OFF + 2476), 99ull, term_ctr(CID_SCON, STAT_OFF + 2528), 105ull, term_ctr(CID_SCON, STAT_OFF + 2530), 108ull, term_ctr(CID_SCON, STAT_OFF + 2532), 102ull, term_ctr(CID_SCON, STAT_OFF + 2534), 110ull, term_ctr(CID_SCON, STAT_OFF + 2536), 111ull, term_ctr(CID_SCON, STAT_OFF + 2538), 99ull, term_ctr(CID_SCON, STAT_OFF + 2540), 32ull, term_ctr(CID_SCON, STAT_OFF + 2542), 58ull, term_ctr(CID_SCON, STAT_OFF + 2544), 100ull, term_ctr(CID_SCON, STAT_OFF + 2546), 110ull, term_ctr(CID_SCON, STAT_OFF + 2548), 97ull, term_ctr(CID_SCON, STAT_OFF + 2550), 108ull, term_ctr(CID_SCON, STAT_OFF + 2552), 45ull, term_ctr(CID_SCON, STAT_OFF + 265), 99ull, term_ctr(CID_SCON, STAT_OFF + 615), 97ull, term_ctr(CID_SCON, STAT_OFF + 2558), 116ull, term_ctr(CID_SCON, STAT_OFF + 2560), 101ull, term_ctr(CID_SCON, STAT_OFF + 2562), 100ull, term_ctr(CID_SCON, STAT_OFF + 2564), 45ull, term_ctr(CID_SCON, STAT_OFF + 2566), 45ull, term_ctr(CID_SCON, STAT_OFF + 2568), 110ull, term_ctr(CID_SCON, STAT_OFF + 217), 97ull, term_ctr(CID_SCON, STAT_OFF + 2572), 108ull, term_ctr(CID_SCON, STAT_OFF + 2574), 113ull, term_pak(CID_SNIL, 0), 45ull, term_ctr(CID_SCON, STAT_OFF + 2578), 109ull, term_pak(CID_SNIL, 0), 45ull, term_ctr(CID_SCON, STAT_OFF + 2582), 103ull, term_ctr(CID_SCON, STAT_OFF + 48), 114ull, term_ctr(CID_SCON, STAT_OFF + 2586), 101ull, term_ctr(CID_SCON, STAT_OFF + 2588), 109ull, term_ctr(CID_SCON, STAT_OFF + 2590), 97ull, term_ctr(CID_SCON, STAT_OFF + 617), 117ull, term_ctr(CID_SCON, STAT_OFF + 2594), 113ull, term_ctr(CID_SCON, STAT_OFF + 2596), 115ull, term_ctr(CID_SCON, STAT_OFF + 2598), 45ull, term_ctr(CID_SCON, STAT_OFF + 2600), 45ull, term_ctr(CID_SCON, STAT_OFF + 2602), 97ull, term_ctr(CID_SCON, STAT_OFF + 2586), 116ull, term_ctr(CID_SCON, STAT_OFF + 2606), 115ull, term_ctr(CID_SCON, STAT_OFF + 2608), 32ull, term_ctr(CID_SCON, STAT_OFF + 2610), 101ull, term_ctr(CID_SCON, STAT_OFF + 2612), 108ull, term_ctr(CID_SCON, STAT_OFF + 2614), 98ull, term_ctr(CID_SCON, STAT_OFF + 2616), 97ull, term_ctr(CID_SCON, STAT_OFF + 2618), 104ull, term_ctr(CID_SCON, STAT_OFF + 2620), 99ull, term_ctr(CID_SCON, STAT_OFF + 2622), 97ull, term_ctr(CID_SCON, STAT_OFF + 2624), 101ull, term_ctr(CID_SCON, STAT_OFF + 2626), 114ull, term_ctr(CID_SCON, STAT_OFF + 2628), 110ull, term_ctr(CID_SCON, STAT_OFF + 2630), 117ull, term_ctr(CID_SCON, STAT_OFF + 2632), 4, term_ctr(CID_SCON, STAT_OFF + 46), term_ctr(CID_SCON, STAT_OFF + 2634), 110ull, term_ctr(CID_SCON, STAT_OFF + 48), 105ull, term_ctr(CID_SCON, STAT_OFF + 2639), 108ull, term_ctr(CID_SCON, STAT_OFF + 2641), 32ull, term_ctr(CID_SCON, STAT_OFF + 2643), 115ull, term_ctr(CID_SCON, STAT_OFF + 2645), 117ull, term_ctr(CID_SCON, STAT_OFF + 2647), 116ull, term_ctr(CID_SCON, STAT_OFF + 2649), 97ull, term_ctr(CID_SCON, STAT_OFF + 2651), 116ull, term_ctr(CID_SCON, STAT_OFF + 2653), 115ull, term_ctr(CID_SCON, STAT_OFF + 2655), 32ull, term_ctr(CID_SCON, STAT_OFF + 2657), 100ull, term_ctr(CID_SCON, STAT_OFF + 2659), 101ull, term_ctr(CID_SCON, STAT_OFF + 2661), 109ull, term_ctr(CID_SCON, STAT_OFF + 2663), 114ull, term_ctr(CID_SCON, STAT_OFF + 2665), 111ull, term_ctr(CID_SCON, STAT_OFF + 2667), 102ull, term_ctr(CID_SCON, STAT_OFF + 2669), 108ull, term_ctr(CID_SCON, STAT_OFF + 2671), 97ull, term_ctr(CID_SCON, STAT_OFF + 2673), 109ull, term_ctr(CID_SCON, STAT_OFF + 2675), 99ull, term_pak(CID_SNIL, 0), 119ull, term_ctr(CID_SCON, STAT_OFF + 2679), 45ull, term_ctr(CID_SCON, STAT_OFF + 2681), 116ull, term_ctr(CID_SCON, STAT_OFF + 2683), 108ull, term_ctr(CID_SCON, STAT_OFF + 2685), 47ull, term_ctr(CID_SCON, STAT_OFF + 2687), 104ull, term_ctr(CID_SCON, STAT_OFF + 2689), 99ull, term_ctr(CID_SCON, STAT_OFF + 2691), 116ull, term_ctr(CID_SCON, STAT_OFF + 2693), 97ull, term_ctr(CID_SCON, STAT_OFF + 2695), 114ull, term_ctr(CID_SCON, STAT_OFF + 2697), 99ull, term_ctr(CID_SCON, STAT_OFF + 2699), 115ull, term_ctr(CID_SCON, STAT_OFF + 2701), 46ull, term_ctr(CID_SCON, STAT_OFF + 2703), 47ull, term_ctr(CID_SCON, STAT_OFF + 2705), 47ull, term_ctr(CID_SCON, STAT_OFF + 2681), 110ull, term_ctr(CID_SCON, STAT_OFF + 2709), 111ull, term_ctr(CID_SCON, STAT_OFF + 2711), 116ull, term_ctr(CID_SCON, STAT_OFF + 2713), 97ull, term_ctr(CID_SCON, STAT_OFF + 2715), 98ull, term_ctr(CID_SCON, STAT_OFF + 2717), 108ull, term_ctr(CID_SCON, STAT_OFF + 2679), 45ull, term_ctr(CID_SCON, STAT_OFF + 2721), 116ull, term_ctr(CID_SCON, STAT_OFF + 2723), 108ull, term_ctr(CID_SCON, STAT_OFF + 2725), 47ull, term_ctr(CID_SCON, STAT_OFF + 2727), 104ull, term_ctr(CID_SCON, STAT_OFF + 2729), 99ull, term_ctr(CID_SCON, STAT_OFF + 2731), 116ull, term_ctr(CID_SCON, STAT_OFF + 2733), 97ull, term_ctr(CID_SCON, STAT_OFF + 2735), 114ull, term_ctr(CID_SCON, STAT_OFF + 2737), 99ull, term_ctr(CID_SCON, STAT_OFF + 2739), 115ull, term_ctr(CID_SCON, STAT_OFF + 2741), 46ull, term_ctr(CID_SCON, STAT_OFF + 2743), 47ull, term_ctr(CID_SCON, STAT_OFF + 2745), 108ull, term_ctr(CID_SCON, STAT_OFF + 709), 105ull, term_ctr(CID_SCON, STAT_OFF + 2749), 97ull, term_ctr(CID_SCON, STAT_OFF + 2751), 102ull, term_ctr(CID_SCON, STAT_OFF + 2753), 119ull, term_ctr(CID_SCON, STAT_OFF + 2755), 101ull, term_ctr(CID_SCON, STAT_OFF + 2757), 110ull, term_ctr(CID_SCON, STAT_OFF + 2759), 45ull, term_ctr(CID_SCON, STAT_OFF + 2761), 107ull, term_ctr(CID_SCON, STAT_OFF + 2763), 99ull, term_ctr(CID_SCON, STAT_OFF + 2765), 101ull, term_ctr(CID_SCON, STAT_OFF + 2767), 104ull, term_ctr(CID_SCON, STAT_OFF + 2769), 99ull, term_ctr(CID_SCON, STAT_OFF + 2771), 100ull, term_ctr(CID_SCON, STAT_OFF + 2394), 101ull, term_ctr(CID_SCON, STAT_OFF + 2775), 107ull, term_ctr(CID_SCON, STAT_OFF + 2777), 99ull, term_ctr(CID_SCON, STAT_OFF + 2779), 111ull, term_ctr(CID_SCON, STAT_OFF + 2781), 108ull, term_ctr(CID_SCON, STAT_OFF + 2783), 98ull, term_ctr(CID_SCON, STAT_OFF + 2785), 32ull, term_ctr(CID_SCON, STAT_OFF + 2787), 97ull, term_ctr(CID_SCON, STAT_OFF + 2789), 32ull, term_ctr(CID_SCON, STAT_OFF + 2791), 110ull, term_ctr(CID_SCON, STAT_OFF + 2793), 111ull, term_ctr(CID_SCON, STAT_OFF + 2795), 32ull, term_ctr(CID_SCON, STAT_OFF + 2797), 100ull, term_ctr(CID_SCON, STAT_OFF + 2799), 101ull, term_ctr(CID_SCON, STAT_OFF + 2801), 118ull, term_ctr(CID_SCON, STAT_OFF + 2803), 111ull, term_ctr(CID_SCON, STAT_OFF + 2805), 109ull, term_ctr(CID_SCON, STAT_OFF + 2807), 32ull, term_ctr(CID_SCON, STAT_OFF + 2809), 110ull, term_ctr(CID_SCON, STAT_OFF + 2811), 105ull, term_ctr(CID_SCON, STAT_OFF + 2813), 97ull, term_ctr(CID_SCON, STAT_OFF + 2815), 109ull, term_ctr(CID_SCON, STAT_OFF + 2817), 32ull, term_ctr(CID_SCON, STAT_OFF + 2819), 58ull, term_ctr(CID_SCON, STAT_OFF + 2821), 67ull, term_ctr(CID_SCON, STAT_OFF + 2823), 32ull, term_ctr(CID_SCON, STAT_OFF + 2825), 100ull, term_ctr(CID_SCON, STAT_OFF + 2827), 110ull, term_ctr(CID_SCON, STAT_OFF + 2829), 97ull, term_ctr(CID_SCON, STAT_OFF + 2831), 108ull, term_ctr(CID_SCON, STAT_OFF + 2833), 100ull, term_ctr(CID_SCON, STAT_OFF + 791), 97ull, term_ctr(CID_SCON, STAT_OFF + 2837), 101ull, term_ctr(CID_SCON, STAT_OFF + 2839), 114ull, term_ctr(CID_SCON, STAT_OFF + 2841), 108ull, term_ctr(CID_SCON, STAT_OFF + 2843), 97ull, term_ctr(CID_SCON, STAT_OFF + 2845), 32ull, term_ctr(CID_SCON, STAT_OFF + 2847), 101ull, term_ctr(CID_SCON, STAT_OFF + 2849), 114ull, term_ctr(CID_SCON, STAT_OFF + 2851), 101ull, term_ctr(CID_SCON, STAT_OFF + 2853), 104ull, term_ctr(CID_SCON, STAT_OFF + 2855), 119ull, term_ctr(CID_SCON, STAT_OFF + 2857), 32ull, term_ctr(CID_SCON, STAT_OFF + 2859), 100ull, term_ctr(CID_SCON, STAT_OFF + 2861), 101ull, term_ctr(CID_SCON, STAT_OFF + 2863), 100ull, term_ctr(CID_SCON, STAT_OFF + 2865), 110ull, term_ctr(CID_SCON, STAT_OFF + 2867), 97ull, term_ctr(CID_SCON, STAT_OFF + 2869), 108ull, term_ctr(CID_SCON, STAT_OFF + 2871), 32ull, term_ctr(CID_SCON, STAT_OFF + 2873), 58ull, term_ctr(CID_SCON, STAT_OFF + 2875), 100ull, term_ctr(CID_SCON, STAT_OFF + 2877), 110ull, term_ctr(CID_SCON, STAT_OFF + 2879), 97ull, term_ctr(CID_SCON, STAT_OFF + 2881), 108ull, term_ctr(CID_SCON, STAT_OFF + 2883), 116ull, term_ctr(CID_SCON, STAT_OFF + 2861), 99ull, term_ctr(CID_SCON, STAT_OFF + 2887), 105ull, term_ctr(CID_SCON, STAT_OFF + 2889), 108ull, term_ctr(CID_SCON, STAT_OFF + 2891), 102ull, term_ctr(CID_SCON, STAT_OFF + 2893), 110ull, term_ctr(CID_SCON, STAT_OFF + 2895), 111ull, term_ctr(CID_SCON, STAT_OFF + 2897), 99ull, term_ctr(CID_SCON, STAT_OFF + 2899), 32ull, term_ctr(CID_SCON, STAT_OFF + 2901), 58ull, term_ctr(CID_SCON, STAT_OFF + 2903), 100ull, term_ctr(CID_SCON, STAT_OFF + 2905), 110ull, term_ctr(CID_SCON, STAT_OFF + 2907), 97ull, term_ctr(CID_SCON, STAT_OFF + 2909), 108ull, term_ctr(CID_SCON, STAT_OFF + 2911), 107ull, term_ctr(CID_SCON, STAT_OFF + 2865), 99ull, term_ctr(CID_SCON, STAT_OFF + 2915), 111ull, term_ctr(CID_SCON, STAT_OFF + 2917), 108ull, term_ctr(CID_SCON, STAT_OFF + 2919), 98ull, term_ctr(CID_SCON, STAT_OFF + 2921), 32ull, term_ctr(CID_SCON, STAT_OFF + 2923), 58ull, term_ctr(CID_SCON, STAT_OFF + 2925), 100ull, term_ctr(CID_SCON, STAT_OFF + 2927), 110ull, term_ctr(CID_SCON, STAT_OFF + 2929), 97ull, term_ctr(CID_SCON, STAT_OFF + 2931), 108ull, term_ctr(CID_SCON, STAT_OFF + 2933), 116ull, term_ctr(CID_SCON, STAT_OFF + 1143), 115ull, term_ctr(CID_SCON, STAT_OFF + 2937), 105ull, term_ctr(CID_SCON, STAT_OFF + 2939), 120ull, term_ctr(CID_SCON, STAT_OFF + 2941), 101ull, term_ctr(CID_SCON, STAT_OFF + 2943), 32ull, term_ctr(CID_SCON, STAT_OFF + 2945), 104ull, term_ctr(CID_SCON, STAT_OFF + 2947), 99ull, term_ctr(CID_SCON, STAT_OFF + 2949), 110ull, term_ctr(CID_SCON, STAT_OFF + 2951), 97ull, term_ctr(CID_SCON, STAT_OFF + 2953), 114ull, term_ctr(CID_SCON, STAT_OFF + 2955), 98ull, term_ctr(CID_SCON, STAT_OFF + 2957), 116ull, term_ctr(CID_SCON, STAT_OFF + 2949), 97ull, term_ctr(CID_SCON, STAT_OFF + 2961), 112ull, term_ctr(CID_SCON, STAT_OFF + 2963), 101ull, term_ctr(CID_SCON, STAT_OFF + 2), 115ull, term_ctr(CID_SCON, STAT_OFF + 2967), 97ull, term_ctr(CID_SCON, STAT_OFF + 2969), 98ull, term_ctr(CID_SCON, STAT_OFF + 2971), 32ull, term_ctr(CID_SCON, STAT_OFF + 2973), 110ull, term_ctr(CID_SCON, STAT_OFF + 2975), 119ull, term_ctr(CID_SCON, STAT_OFF + 2977), 111ull, term_ctr(CID_SCON, STAT_OFF + 2979), 110ull, term_ctr(CID_SCON, STAT_OFF + 2981), 107ull, term_ctr(CID_SCON, STAT_OFF + 2983), 110ull, term_ctr(CID_SCON, STAT_OFF + 2985), 117ull, term_ctr(CID_SCON, STAT_OFF + 2987), 121ull, term_ctr(CID_SCON, STAT_OFF + 2), 115ull, term_ctr(CID_SCON, STAT_OFF + 2991), 117ull, term_ctr(CID_SCON, STAT_OFF + 2993), 98ull, term_ctr(CID_SCON, STAT_OFF + 2995), 32ull, term_ctr(CID_SCON, STAT_OFF + 2997), 116ull, term_ctr(CID_SCON, STAT_OFF + 2999), 101ull, term_ctr(CID_SCON, STAT_OFF + 3001), 103ull, term_ctr(CID_SCON, STAT_OFF + 3003), 114ull, term_ctr(CID_SCON, STAT_OFF + 3005), 97ull, term_ctr(CID_SCON, STAT_OFF + 3007), 116ull, term_ctr(CID_SCON, STAT_OFF + 3009), term_ctr(CID_SCON, STAT_OFF + 46), term_ctr(CID_SCON, STAT_OFF + 2634), term_ctr(CID____SRC_GIT_TYPES_FCMD, STAT_OFF + 3013), 105ull, term_ctr(CID_SCON, STAT_OFF + 257), 117ull, term_ctr(CID_SCON, STAT_OFF + 3016), 113ull, term_ctr(CID_SCON, STAT_OFF + 3018), 45ull, term_ctr(CID_SCON, STAT_OFF + 3020), 45ull, term_ctr(CID_SCON, STAT_OFF + 3022), 98ull, term_pak(CID_SNIL, 0), 45ull, term_ctr(CID_SCON, STAT_OFF + 3026), 108ull, term_ctr(CID_SCON, STAT_OFF + 141), 47ull, term_ctr(CID_SCON, STAT_OFF + 3030), 110ull, term_ctr(CID_SCON, STAT_OFF + 3032), 105ull, term_ctr(CID_SCON, STAT_OFF + 3034), 98ull, term_ctr(CID_SCON, STAT_OFF + 3036), 47ull, term_ctr(CID_SCON, STAT_OFF + 3038), 45ull, term_ctr(CID_SCON, STAT_OFF + 40), 45ull, term_pak(CID_SNIL, 0), 45ull, term_ctr(CID_SCON, STAT_OFF + 3044), 108ull, term_ctr(CID_SCON, STAT_OFF + 3026), 45ull, term_ctr(CID_SCON, STAT_OFF + 3048), 116ull, term_ctr(CID_SCON, STAT_OFF + 3050), 108ull, term_ctr(CID_SCON, STAT_OFF + 3052), 47ull, term_ctr(CID_SCON, STAT_OFF + 3054), 104ull, term_ctr(CID_SCON, STAT_OFF + 3056), 99ull, term_ctr(CID_SCON, STAT_OFF + 3058), 116ull, term_ctr(CID_SCON, STAT_OFF + 3060), 97ull, term_ctr(CID_SCON, STAT_OFF + 3062), 114ull, term_ctr(CID_SCON, STAT_OFF + 3064), 99ull, term_ctr(CID_SCON, STAT_OFF + 3066), 115ull, term_ctr(CID_SCON, STAT_OFF + 3068), 46ull, term_ctr(CID_SCON, STAT_OFF + 3070), 47ull, term_ctr(CID_SCON, STAT_OFF + 3072), 116ull, term_ctr(CID_SCON, STAT_OFF + 2558), 97ull, term_ctr(CID_SCON, STAT_OFF + 3076), 109ull, term_ctr(CID_SCON, STAT_OFF + 3078), 115ull, term_ctr(CID_SCON, STAT_OFF + 3080), 105ull, term_ctr(CID_SCON, STAT_OFF + 3082), 109ull, term_ctr(CID_SCON, STAT_OFF + 3084), 32ull, term_ctr(CID_SCON, STAT_OFF + 3086), 116ull, term_ctr(CID_SCON, STAT_OFF + 3088), 105ull, term_ctr(CID_SCON, STAT_OFF + 3090), 109ull, term_ctr(CID_SCON, STAT_OFF + 3092), 109ull, term_ctr(CID_SCON, STAT_OFF + 3094), 111ull, term_ctr(CID_SCON, STAT_OFF + 3096), 99ull, term_ctr(CID_SCON, STAT_OFF + 3098), 32ull, term_ctr(CID_SCON, STAT_OFF + 3100), 100ull, term_ctr(CID_SCON, STAT_OFF + 3102), 101ull, term_ctr(CID_SCON, STAT_OFF + 3104), 100ull, term_ctr(CID_SCON, STAT_OFF + 3106), 110ull, term_ctr(CID_SCON, STAT_OFF + 3108), 97ull, term_ctr(CID_SCON, STAT_OFF + 3110), 108ull, term_ctr(CID_SCON, STAT_OFF + 3112), 32ull, term_ctr(CID_SCON, STAT_OFF + 3114), 58ull, term_ctr(CID_SCON, STAT_OFF + 3116), 100ull, term_ctr(CID_SCON, STAT_OFF + 3118), 110ull, term_ctr(CID_SCON, STAT_OFF + 3120), 97ull, term_ctr(CID_SCON, STAT_OFF + 3122), 108ull, term_ctr(CID_SCON, STAT_OFF + 3124), 103ull, term_ctr(CID_SCON, STAT_OFF + 505), 110ull, term_ctr(CID_SCON, STAT_OFF + 3128), 105ull, term_ctr(CID_SCON, STAT_OFF + 3130), 100ull, term_ctr(CID_SCON, STAT_OFF + 3132), 110ull, term_ctr(CID_SCON, STAT_OFF + 3134), 97ull, term_ctr(CID_SCON, STAT_OFF + 3136), 108ull, term_ctr(CID_SCON, STAT_OFF + 3138), 32ull, term_ctr(CID_SCON, STAT_OFF + 3140), 101ull, term_ctr(CID_SCON, STAT_OFF + 3142), 114ull, term_ctr(CID_SCON, STAT_OFF + 3144), 101ull, term_ctr(CID_SCON, STAT_OFF + 3146), 104ull, term_ctr(CID_SCON, STAT_OFF + 3148), 119ull, term_ctr(CID_SCON, STAT_OFF + 3150), 32ull, term_ctr(CID_SCON, STAT_OFF + 3152), 121ull, term_ctr(CID_SCON, STAT_OFF + 3154), 100ull, term_ctr(CID_SCON, STAT_OFF + 3156), 97ull, term_ctr(CID_SCON, STAT_OFF + 3158), 101ull, term_ctr(CID_SCON, STAT_OFF + 3160), 114ull, term_ctr(CID_SCON, STAT_OFF + 3162), 108ull, term_ctr(CID_SCON, STAT_OFF + 3164), 97ull, term_ctr(CID_SCON, STAT_OFF + 3166), 32ull, term_ctr(CID_SCON, STAT_OFF + 3168), 58ull, term_ctr(CID_SCON, STAT_OFF + 3170), 100ull, term_ctr(CID_SCON, STAT_OFF + 3172), 110ull, term_ctr(CID_SCON, STAT_OFF + 3174), 97ull, term_ctr(CID_SCON, STAT_OFF + 3176), 108ull, term_ctr(CID_SCON, STAT_OFF + 3178), 103ull, term_ctr(CID_SCON, STAT_OFF + 413), 110ull, term_ctr(CID_SCON, STAT_OFF + 3182), 105ull, term_ctr(CID_SCON, STAT_OFF + 3184), 100ull, term_ctr(CID_SCON, STAT_OFF + 3186), 110ull, term_ctr(CID_SCON, STAT_OFF + 3188), 97ull, term_ctr(CID_SCON, STAT_OFF + 3190), 108ull, term_ctr(CID_SCON, STAT_OFF + 3192), 32ull, term_ctr(CID_SCON, STAT_OFF + 3194), 101ull, term_ctr(CID_SCON, STAT_OFF + 3196), 114ull, term_ctr(CID_SCON, STAT_OFF + 3198), 101ull, term_ctr(CID_SCON, STAT_OFF + 3200), 104ull, term_ctr(CID_SCON, STAT_OFF + 3202), 119ull, term_ctr(CID_SCON, STAT_OFF + 3204), 32ull, term_ctr(CID_SCON, STAT_OFF + 3206), 116ull, term_ctr(CID_SCON, STAT_OFF + 3208), 99ull, term_ctr(CID_SCON, STAT_OFF + 3210), 105ull, term_ctr(CID_SCON, STAT_OFF + 3212), 108ull, term_ctr(CID_SCON, STAT_OFF + 3214), 102ull, term_ctr(CID_SCON, STAT_OFF + 3216), 110ull, term_ctr(CID_SCON, STAT_OFF + 3218), 111ull, term_ctr(CID_SCON, STAT_OFF + 3220), 99ull, term_ctr(CID_SCON, STAT_OFF + 3222), 32ull, term_ctr(CID_SCON, STAT_OFF + 3224), 58ull, term_ctr(CID_SCON, STAT_OFF + 3226), 100ull, term_ctr(CID_SCON, STAT_OFF + 3228), 110ull, term_ctr(CID_SCON, STAT_OFF + 3230), 97ull, term_ctr(CID_SCON, STAT_OFF + 3232), 108ull, term_ctr(CID_SCON, STAT_OFF + 3234), 100ull, term_ctr(CID_SCON, STAT_OFF + 3208), 101ull, term_ctr(CID_SCON, STAT_OFF + 3238), 107ull, term_ctr(CID_SCON, STAT_OFF + 3240), 99ull, term_ctr(CID_SCON, STAT_OFF + 3242), 111ull, term_ctr(CID_SCON, STAT_OFF + 3244), 108ull, term_ctr(CID_SCON, STAT_OFF + 3246), 98ull, term_ctr(CID_SCON, STAT_OFF + 3248), 32ull, term_ctr(CID_SCON, STAT_OFF + 3250), 58ull, term_ctr(CID_SCON, STAT_OFF + 3252), 100ull, term_ctr(CID_SCON, STAT_OFF + 3254), 110ull, term_ctr(CID_SCON, STAT_OFF + 3256), 97ull, term_ctr(CID_SCON, STAT_OFF + 3258), 108ull, term_ctr(CID_SCON, STAT_OFF + 3260), term_ctr(CID_SCON, STAT_OFF + 2260), term_ctr(CID_SCON, STAT_OFF + 2634), term_ctr(CID____SRC_GIT_TYPES_FCMD, STAT_OFF + 3264), 48ull, term_pak(CID_SNIL, 0), 97ull, term_ctr(CID_SCON, STAT_OFF + 255), 101ull, term_ctr(CID_SCON, STAT_OFF + 3269), 102ull, term_ctr(CID_SCON, STAT_OFF + 3271), 116ull, term_ctr(CID_SCON, STAT_OFF + 2426), 97ull, term_ctr(CID_SCON, STAT_OFF + 3275), 101ull, term_ctr(CID_SCON, STAT_OFF + 3277), 102ull, term_ctr(CID_SCON, STAT_OFF + 3279), 32ull, term_ctr(CID_SCON, STAT_OFF + 3281), 58ull, term_ctr(CID_SCON, STAT_OFF + 3283), 65ull, term_ctr(CID_SCON, STAT_OFF + 3285), 32ull, term_ctr(CID_SCON, STAT_OFF + 3287), 100ull, term_ctr(CID_SCON, STAT_OFF + 3289), 110ull, term_ctr(CID_SCON, STAT_OFF + 3291), 97ull, term_ctr(CID_SCON, STAT_OFF + 3293), 108ull, term_ctr(CID_SCON, STAT_OFF + 3295), 58ull, term_pak(CID_SNIL, 0), 110ull, term_ctr(CID_SCON, STAT_OFF + 3299), 105ull, term_ctr(CID_SCON, STAT_OFF + 3301), 97ull, term_ctr(CID_SCON, STAT_OFF + 3303), 109ull, term_ctr(CID_SCON, STAT_OFF + 3305), 119ull, term_pak(CID_SNIL, 0), 111ull, term_ctr(CID_SCON, STAT_OFF + 3309), 104ull, term_ctr(CID_SCON, STAT_OFF + 3311), 115ull, term_ctr(CID_SCON, STAT_OFF + 3313), term_ctr(CID_SCON, STAT_OFF + 127), term_ctr(CID_CON, STAT_OFF + 977), 116ull, term_ctr(CID_SCON, STAT_OFF + 603), 105ull, term_ctr(CID_SCON, STAT_OFF + 3319), 103ull, term_ctr(CID_SCON, STAT_OFF + 3321), 104ull, term_ctr(CID_SCON, STAT_OFF + 2384), 116ull, term_ctr(CID_SCON, STAT_OFF + 3325), 111ull, term_ctr(CID_SCON, STAT_OFF + 3327), 110ull, term_ctr(CID_SCON, STAT_OFF + 3329), 32ull, term_ctr(CID_SCON, STAT_OFF + 3331), 100ull, term_ctr(CID_SCON, STAT_OFF + 3333), 101ull, term_ctr(CID_SCON, STAT_OFF + 3335), 114ull, term_ctr(CID_SCON, STAT_OFF + 3337), 101ull, term_ctr(CID_SCON, STAT_OFF + 3339), 119ull, term_ctr(CID_SCON, STAT_OFF + 3341), 115ull, term_ctr(CID_SCON, STAT_OFF + 3343), 110ull, term_ctr(CID_SCON, STAT_OFF + 3345), 97ull, term_ctr(CID_SCON, STAT_OFF + 3347), 32ull, term_ctr(CID_SCON, STAT_OFF + 3349), 115ull, term_ctr(CID_SCON, STAT_OFF + 3351), 115ull, term_ctr(CID_SCON, STAT_OFF + 3353), 101ull, term_ctr(CID_SCON, STAT_OFF + 3355), 99ull, term_ctr(CID_SCON, STAT_OFF + 3357), 111ull, term_ctr(CID_SCON, STAT_OFF + 3359), 114ull, term_ctr(CID_SCON, STAT_OFF + 3361), 112ull, term_ctr(CID_SCON, STAT_OFF + 3363), 97ull, term_pak(CID_SNIL, 0), 108ull, term_ctr(CID_SCON, STAT_OFF + 3367), 45ull, term_ctr(CID_SCON, STAT_OFF + 3369), 116ull, term_ctr(CID_SCON, STAT_OFF + 3371), 108ull, term_ctr(CID_SCON, STAT_OFF + 3373), 47ull, term_ctr(CID_SCON, STAT_OFF + 3375), 104ull, term_ctr(CID_SCON, STAT_OFF + 3377), 99ull, term_ctr(CID_SCON, STAT_OFF + 3379), 116ull, term_ctr(CID_SCON, STAT_OFF + 3381), 97ull, term_ctr(CID_SCON, STAT_OFF + 3383), 114ull, term_ctr(CID_SCON, STAT_OFF + 3385), 99ull, term_ctr(CID_SCON, STAT_OFF + 3387), 115ull, term_ctr(CID_SCON, STAT_OFF + 3389), 46ull, term_ctr(CID_SCON, STAT_OFF + 3391), 47ull, term_ctr(CID_SCON, STAT_OFF + 3393), 45ull, term_ctr(CID_SCON, STAT_OFF + 2679), 65ull, term_pak(CID_SNIL, 0), 45ull, term_ctr(CID_SCON, STAT_OFF + 3399), term_ctr(CID_SCON, STAT_OFF + 3401), term_pak(CID_NIL, 0), term_ctr(CID_SCON, STAT_OFF + 975), term_ctr(CID_CON, STAT_OFF + 3403), 110ull, term_ctr(CID_SCON, STAT_OFF + 2586), 97ull, term_ctr(CID_SCON, STAT_OFF + 3407), 104ull, term_ctr(CID_SCON, STAT_OFF + 3409), 99ull, term_ctr(CID_SCON, STAT_OFF + 3411), 32ull, term_ctr(CID_SCON, STAT_OFF + 3413), 114ull, term_ctr(CID_SCON, STAT_OFF + 3415), 101ull, term_ctr(CID_SCON, STAT_OFF + 3417), 107ull, term_ctr(CID_SCON, STAT_OFF + 3419), 114ull, term_ctr(CID_SCON, STAT_OFF + 3421), 111ull, term_ctr(CID_SCON, STAT_OFF + 3423), 119ull, term_ctr(CID_SCON, STAT_OFF + 3425), term_ctr(CID_SCON, STAT_OFF + 3427), term_pak(CID_NIL, 0), term_ctr(CID_SCON, STAT_OFF + 2584), term_ctr(CID_CON, STAT_OFF + 3429), term_ctr(CID_SCON, STAT_OFF + 2580), term_ctr(CID_CON, STAT_OFF + 3431), term_ctr(CID_SCON, STAT_OFF + 871), term_ctr(CID_CON, STAT_OFF + 3433), 45ull, term_ctr(CID_SCON, STAT_OFF + 1557), 116ull, term_ctr(CID_SCON, STAT_OFF + 3437), 108ull, term_ctr(CID_SCON, STAT_OFF + 3439), 47ull, term_ctr(CID_SCON, STAT_OFF + 3441), 104ull, term_ctr(CID_SCON, STAT_OFF + 3443), 99ull, term_ctr(CID_SCON, STAT_OFF + 3445), 116ull, term_ctr(CID_SCON, STAT_OFF + 3447), 97ull, term_ctr(CID_SCON, STAT_OFF + 3449), 114ull, term_ctr(CID_SCON, STAT_OFF + 3451), 99ull, term_ctr(CID_SCON, STAT_OFF + 3453), 115ull, term_ctr(CID_SCON, STAT_OFF + 3455), 46ull, term_ctr(CID_SCON, STAT_OFF + 3457), 47ull, term_ctr(CID_SCON, STAT_OFF + 3459), 32ull, term_ctr(CID_SCON, STAT_OFF + 1705), 62ull, term_ctr(CID_SCON, STAT_OFF + 3463), 32ull, term_ctr(CID_SCON, STAT_OFF + 3465), 39ull, term_ctr(CID_SCON, STAT_OFF + 3467), 110ull, term_ctr(CID_SCON, STAT_OFF + 3469), 92ull, term_ctr(CID_SCON, STAT_OFF + 3471), 114ull, term_ctr(CID_SCON, STAT_OFF + 3473), 101ull, term_ctr(CID_SCON, STAT_OFF + 3475), 104ull, term_ctr(CID_SCON, STAT_OFF + 3477), 116ull, term_ctr(CID_SCON, STAT_OFF + 3479), 111ull, term_ctr(CID_SCON, STAT_OFF + 3481), 39ull, term_ctr(CID_SCON, STAT_OFF + 3483), 32ull, term_ctr(CID_SCON, STAT_OFF + 3485), 102ull, term_ctr(CID_SCON, STAT_OFF + 3487), 116ull, term_ctr(CID_SCON, STAT_OFF + 3489), 110ull, term_ctr(CID_SCON, STAT_OFF + 3491), 105ull, term_ctr(CID_SCON, STAT_OFF + 3493), 114ull, term_ctr(CID_SCON, STAT_OFF + 3495), 112ull, term_ctr(CID_SCON, STAT_OFF + 3497), 45ull, term_ctr(CID_SCON, STAT_OFF + 1223), 116ull, term_ctr(CID_SCON, STAT_OFF + 3501), 108ull, term_ctr(CID_SCON, STAT_OFF + 3503), 47ull, term_ctr(CID_SCON, STAT_OFF + 3505), 104ull, term_ctr(CID_SCON, STAT_OFF + 3507), 99ull, term_ctr(CID_SCON, STAT_OFF + 3509), 116ull, term_ctr(CID_SCON, STAT_OFF + 3511), 97ull, term_ctr(CID_SCON, STAT_OFF + 3513), 114ull, term_ctr(CID_SCON, STAT_OFF + 3515), 99ull, term_ctr(CID_SCON, STAT_OFF + 3517), 115ull, term_ctr(CID_SCON, STAT_OFF + 3519), 46ull, term_ctr(CID_SCON, STAT_OFF + 3521), 47ull, term_ctr(CID_SCON, STAT_OFF + 3523), 110ull, term_ctr(CID_SCON, STAT_OFF + 2166), 105ull, term_ctr(CID_SCON, STAT_OFF + 3527), 110ull, term_ctr(CID_SCON, STAT_OFF + 3529), 39ull, term_ctr(CID_SCON, STAT_OFF + 3531), 32ull, term_ctr(CID_SCON, STAT_OFF + 3533), 102ull, term_ctr(CID_SCON, STAT_OFF + 3535), 116ull, term_ctr(CID_SCON, STAT_OFF + 3537), 110ull, term_ctr(CID_SCON, STAT_OFF + 3539), 105ull, term_ctr(CID_SCON, STAT_OFF + 3541), 114ull, term_ctr(CID_SCON, STAT_OFF + 3543), 112ull, term_ctr(CID_SCON, STAT_OFF + 3545), 62ull, term_ctr(CID_SCON, STAT_OFF + 0), 32ull, term_ctr(CID_SCON, STAT_OFF + 3549), 39ull, term_ctr(CID_SCON, STAT_OFF + 3551), 48ull, term_ctr(CID_SCON, STAT_OFF + 3553), 32ull, term_ctr(CID_SCON, STAT_OFF + 3555), 116ull, term_ctr(CID_SCON, STAT_OFF + 3557), 105ull, term_ctr(CID_SCON, STAT_OFF + 3559), 120ull, term_ctr(CID_SCON, STAT_OFF + 3561), 101ull, term_ctr(CID_SCON, STAT_OFF + 3563), 39ull, term_ctr(CID_SCON, STAT_OFF + 3565), 32ull, term_ctr(CID_SCON, STAT_OFF + 3567), 39ull, term_ctr(CID_SCON, STAT_OFF + 3569), 110ull, term_ctr(CID_SCON, STAT_OFF + 0), 105ull, term_ctr(CID_SCON, STAT_OFF + 3573), 97ull, term_ctr(CID_SCON, STAT_OFF + 3575), 109ull, term_ctr(CID_SCON, STAT_OFF + 3577), 32ull, term_ctr(CID_SCON, STAT_OFF + 3579), 102ull, term_ctr(CID_SCON, STAT_OFF + 3581), 45ull, term_ctr(CID_SCON, STAT_OFF + 3583), 32ull, term_ctr(CID_SCON, STAT_OFF + 3585), 104ull, term_ctr(CID_SCON, STAT_OFF + 3587), 99ull, term_ctr(CID_SCON, STAT_OFF + 3589), 110ull, term_ctr(CID_SCON, STAT_OFF + 3591), 97ull, term_ctr(CID_SCON, STAT_OFF + 3593), 114ull, term_ctr(CID_SCON, STAT_OFF + 3595), 98ull, term_ctr(CID_SCON, STAT_OFF + 3597), 32ull, term_ctr(CID_SCON, STAT_OFF + 3599), 67ull, term_ctr(CID_SCON, STAT_OFF + 0), 45ull, term_ctr(CID_SCON, STAT_OFF + 3603), 32ull, term_ctr(CID_SCON, STAT_OFF + 3605), 116ull, term_ctr(CID_SCON, STAT_OFF + 3607), 105ull, term_ctr(CID_SCON, STAT_OFF + 3609), 103ull, term_ctr(CID_SCON, STAT_OFF + 3611), 39ull, term_ctr(CID_SCON, STAT_OFF + 3613), 32ull, term_ctr(CID_SCON, STAT_OFF + 3615), 39ull, term_ctr(CID_SCON, STAT_OFF + 3617), 110ull, term_ctr(CID_SCON, STAT_OFF + 3619), 92ull, term_ctr(CID_SCON, STAT_OFF + 3621), 115ull, term_ctr(CID_SCON, STAT_OFF + 3623), 37ull, term_ctr(CID_SCON, STAT_OFF + 3625), 39ull, term_ctr(CID_SCON, STAT_OFF + 3627), 32ull, term_ctr(CID_SCON, STAT_OFF + 3629), 102ull, term_ctr(CID_SCON, STAT_OFF + 3631), 116ull, term_ctr(CID_SCON, STAT_OFF + 3633), 110ull, term_ctr(CID_SCON, STAT_OFF + 3635), 105ull, term_ctr(CID_SCON, STAT_OFF + 3637), 114ull, term_ctr(CID_SCON, STAT_OFF + 3639), 112ull, term_ctr(CID_SCON, STAT_OFF + 3641), 32ull, term_ctr(CID_SCON, STAT_OFF + 2376), 62ull, term_ctr(CID_SCON, STAT_OFF + 3645), 32ull, term_ctr(CID_SCON, STAT_OFF + 3647), 39ull, term_ctr(CID_SCON, STAT_OFF + 3649), 49ull, term_ctr(CID_SCON, STAT_OFF + 3651), 32ull, term_ctr(CID_SCON, STAT_OFF + 3653), 116ull, term_ctr(CID_SCON, STAT_OFF + 3655), 105ull, term_ctr(CID_SCON, STAT_OFF + 3657), 120ull, term_ctr(CID_SCON, STAT_OFF + 3659), 101ull, term_ctr(CID_SCON, STAT_OFF + 3661), 39ull, term_ctr(CID_SCON, STAT_OFF + 3663), 32ull, term_ctr(CID_SCON, STAT_OFF + 3665), 39ull, term_ctr(CID_SCON, STAT_OFF + 3667), 100ull, term_ctr(CID_SCON, STAT_OFF + 3669), 50ull, term_ctr(CID_SCON, STAT_OFF + 3671), 32ull, term_ctr(CID_SCON, STAT_OFF + 3673), 52ull, term_ctr(CID_SCON, STAT_OFF + 3675), 55ull, term_ctr(CID_SCON, STAT_OFF + 3677), 50ull, term_ctr(CID_SCON, STAT_OFF + 3679), 55ull, term_ctr(CID_SCON, STAT_OFF + 3681), 53ull, term_ctr(CID_SCON, STAT_OFF + 3683), 54ull, term_ctr(CID_SCON, STAT_OFF + 3685), 51ull, term_ctr(CID_SCON, STAT_OFF + 3687), 55ull, term_ctr(CID_SCON, STAT_OFF + 3689), 51ull, term_ctr(CID_SCON, STAT_OFF + 3691), 55ull, term_ctr(CID_SCON, STAT_OFF + 3693), 49ull, term_ctr(CID_SCON, STAT_OFF + 3695), 54ull, term_ctr(CID_SCON, STAT_OFF + 3697), 32ull, term_ctr(CID_SCON, STAT_OFF + 3699), 51ull, term_ctr(CID_SCON, STAT_OFF + 3701), 55ull, term_ctr(CID_SCON, STAT_OFF + 3703), 98ull, term_ctr(CID_SCON, STAT_OFF + 3705), 54ull, term_ctr(CID_SCON, STAT_OFF + 3707), 50ull, term_ctr(CID_SCON, STAT_OFF + 3709), 55ull, term_ctr(CID_SCON, STAT_OFF + 3711), 102ull, term_ctr(CID_SCON, STAT_OFF + 3713), 54ull, term_ctr(CID_SCON, STAT_OFF + 3715), 55ull, term_ctr(CID_SCON, STAT_OFF + 3717), 55ull, term_ctr(CID_SCON, STAT_OFF + 3719), 48ull, term_ctr(CID_SCON, STAT_OFF + 3721), 50ull, term_ctr(CID_SCON, STAT_OFF + 3723), 48ull, term_ctr(CID_SCON, STAT_OFF + 3725), 55ull, term_ctr(CID_SCON, STAT_OFF + 3727), 48ull, term_ctr(CID_SCON, STAT_OFF + 3729), 55ull, term_ctr(CID_SCON, STAT_OFF + 3731), 49ull, term_ctr(CID_SCON, STAT_OFF + 3733), 54ull, term_ctr(CID_SCON, STAT_OFF + 3735), 32ull, term_ctr(CID_SCON, STAT_OFF + 3737), 52ull, term_ctr(CID_SCON, STAT_OFF + 3739), 55ull, term_ctr(CID_SCON, STAT_OFF + 3741), 56ull, term_ctr(CID_SCON, STAT_OFF + 3743), 55ull, term_ctr(CID_SCON, STAT_OFF + 3745), 52ull, term_ctr(CID_SCON, STAT_OFF + 3747), 55ull, term_ctr(CID_SCON, STAT_OFF + 3749), 101ull, term_ctr(CID_SCON, STAT_OFF + 3751), 50ull, term_ctr(CID_SCON, STAT_OFF + 3753), 48ull, term_ctr(CID_SCON, STAT_OFF + 3755), 55ull, term_ctr(CID_SCON, STAT_OFF + 3757), 48ull, term_ctr(CID_SCON, STAT_OFF + 3759), 55ull, term_ctr(CID_SCON, STAT_OFF + 3761), 49ull, term_ctr(CID_SCON, STAT_OFF + 3763), 54ull, term_ctr(CID_SCON, STAT_OFF + 3765), 32ull, term_ctr(CID_SCON, STAT_OFF + 3767), 111ull, term_ctr(CID_SCON, STAT_OFF + 3769), 104ull, term_ctr(CID_SCON, STAT_OFF + 3771), 99ull, term_ctr(CID_SCON, STAT_OFF + 3773), 101ull, term_ctr(CID_SCON, STAT_OFF + 3775), 39ull, term_ctr(CID_SCON, STAT_OFF + 3777), 32ull, term_ctr(CID_SCON, STAT_OFF + 3779), 39ull, term_ctr(CID_SCON, STAT_OFF + 3781), 48ull, term_ctr(CID_SCON, STAT_OFF + 3783), 32ull, term_ctr(CID_SCON, STAT_OFF + 3785), 116ull, term_ctr(CID_SCON, STAT_OFF + 3787), 105ull, term_ctr(CID_SCON, STAT_OFF + 3789), 120ull, term_ctr(CID_SCON, STAT_OFF + 3791), 101ull, term_ctr(CID_SCON, STAT_OFF + 3793), 32ull, term_ctr(CID_SCON, STAT_OFF + 3795), 124ull, term_ctr(CID_SCON, STAT_OFF + 3797), 124ull, term_ctr(CID_SCON, STAT_OFF + 3799), 32ull, term_ctr(CID_SCON, STAT_OFF + 3801), 116ull, term_ctr(CID_SCON, STAT_OFF + 3803), 120ull, term_ctr(CID_SCON, STAT_OFF + 3805), 116ull, term_ctr(CID_SCON, STAT_OFF + 3807), 46ull, term_ctr(CID_SCON, STAT_OFF + 3809), 112ull, term_ctr(CID_SCON, STAT_OFF + 3811), 112ull, term_ctr(CID_SCON, STAT_OFF + 3813), 97ull, term_ctr(CID_SCON, STAT_OFF + 3815), 32ull, term_ctr(CID_SCON, STAT_OFF + 3817), 61ull, term_ctr(CID_SCON, STAT_OFF + 3819), 32ull, term_ctr(CID_SCON, STAT_OFF + 3821), 34ull, term_ctr(CID_SCON, STAT_OFF + 3823), 49ull, term_ctr(CID_SCON, STAT_OFF + 3825), 36ull, term_ctr(CID_SCON, STAT_OFF + 3827), 34ull, term_ctr(CID_SCON, STAT_OFF + 3829), 32ull, term_ctr(CID_SCON, STAT_OFF + 3831), 116ull, term_ctr(CID_SCON, STAT_OFF + 3833), 115ull, term_ctr(CID_SCON, STAT_OFF + 3835), 101ull, term_ctr(CID_SCON, STAT_OFF + 3837), 116ull, term_ctr(CID_SCON, STAT_OFF + 3839), 39ull, term_ctr(CID_SCON, STAT_OFF + 3841), 32ull, term_ctr(CID_SCON, STAT_OFF + 3843), 39ull, term_ctr(CID_SCON, STAT_OFF + 3845), 110ull, term_ctr(CID_SCON, STAT_OFF + 3847), 92ull, term_ctr(CID_SCON, STAT_OFF + 3849), 115ull, term_ctr(CID_SCON, STAT_OFF + 3851), 37ull, term_ctr(CID_SCON, STAT_OFF + 3853), 39ull, term_ctr(CID_SCON, STAT_OFF + 3855), 32ull, term_ctr(CID_SCON, STAT_OFF + 3857), 102ull, term_ctr(CID_SCON, STAT_OFF + 3859), 116ull, term_ctr(CID_SCON, STAT_OFF + 3861), 110ull, term_ctr(CID_SCON, STAT_OFF + 3863), 105ull, term_ctr(CID_SCON, STAT_OFF + 3865), 114ull, term_ctr(CID_SCON, STAT_OFF + 3867), 112ull, term_ctr(CID_SCON, STAT_OFF + 3869), 32ull, term_ctr(CID_SCON, STAT_OFF + 2773), 62ull, term_ctr(CID_SCON, STAT_OFF + 3873), 32ull, term_ctr(CID_SCON, STAT_OFF + 3875), 39ull, term_ctr(CID_SCON, STAT_OFF + 3877), 49ull, term_ctr(CID_SCON, STAT_OFF + 3879), 32ull, term_ctr(CID_SCON, STAT_OFF + 3881), 116ull, term_ctr(CID_SCON, STAT_OFF + 3883), 105ull, term_ctr(CID_SCON, STAT_OFF + 3885), 120ull, term_ctr(CID_SCON, STAT_OFF + 3887), 101ull, term_ctr(CID_SCON, STAT_OFF + 3889), 39ull, term_ctr(CID_SCON, STAT_OFF + 3891), 32ull, term_ctr(CID_SCON, STAT_OFF + 3893), 39ull, term_ctr(CID_SCON, STAT_OFF + 3895), 100ull, term_ctr(CID_SCON, STAT_OFF + 3897), 50ull, term_ctr(CID_SCON, STAT_OFF + 3899), 32ull, term_ctr(CID_SCON, STAT_OFF + 3901), 52ull, term_ctr(CID_SCON, STAT_OFF + 3903), 55ull, term_ctr(CID_SCON, STAT_OFF + 3905), 50ull, term_ctr(CID_SCON, STAT_OFF + 3907), 55ull, term_ctr(CID_SCON, STAT_OFF + 3909), 53ull, term_ctr(CID_SCON, STAT_OFF + 3911), 54ull, term_ctr(CID_SCON, STAT_OFF + 3913), 51ull, term_ctr(CID_SCON, STAT_OFF + 3915), 55ull, term_ctr(CID_SCON, STAT_OFF + 3917), 51ull, term_ctr(CID_SCON, STAT_OFF + 3919), 55ull, term_ctr(CID_SCON, STAT_OFF + 3921), 49ull, term_ctr(CID_SCON, STAT_OFF + 3923), 54ull, term_ctr(CID_SCON, STAT_OFF + 3925), 32ull, term_ctr(CID_SCON, STAT_OFF + 3927), 51ull, term_ctr(CID_SCON, STAT_OFF + 3929), 55ull, term_ctr(CID_SCON, STAT_OFF + 3931), 98ull, term_ctr(CID_SCON, STAT_OFF + 3933), 54ull, term_ctr(CID_SCON, STAT_OFF + 3935), 50ull, term_ctr(CID_SCON, STAT_OFF + 3937), 55ull, term_ctr(CID_SCON, STAT_OFF + 3939), 102ull, term_ctr(CID_SCON, STAT_OFF + 3941), 54ull, term_ctr(CID_SCON, STAT_OFF + 3943), 55ull, term_ctr(CID_SCON, STAT_OFF + 3945), 55ull, term_ctr(CID_SCON, STAT_OFF + 3947), 48ull, term_ctr(CID_SCON, STAT_OFF + 3949), 50ull, term_ctr(CID_SCON, STAT_OFF + 3951), 48ull, term_ctr(CID_SCON, STAT_OFF + 3953), 55ull, term_ctr(CID_SCON, STAT_OFF + 3955), 48ull, term_ctr(CID_SCON, STAT_OFF + 3957), 55ull, term_ctr(CID_SCON, STAT_OFF + 3959), 49ull, term_ctr(CID_SCON, STAT_OFF + 3961), 54ull, term_ctr(CID_SCON, STAT_OFF + 3963), 32ull, term_ctr(CID_SCON, STAT_OFF + 3965), 52ull, term_ctr(CID_SCON, STAT_OFF + 3967), 55ull, term_ctr(CID_SCON, STAT_OFF + 3969), 56ull, term_ctr(CID_SCON, STAT_OFF + 3971), 55ull, term_ctr(CID_SCON, STAT_OFF + 3973), 52ull, term_ctr(CID_SCON, STAT_OFF + 3975), 55ull, term_ctr(CID_SCON, STAT_OFF + 3977), 101ull, term_ctr(CID_SCON, STAT_OFF + 3979), 50ull, term_ctr(CID_SCON, STAT_OFF + 3981), 48ull, term_ctr(CID_SCON, STAT_OFF + 3983), 55ull, term_ctr(CID_SCON, STAT_OFF + 3985), 48ull, term_ctr(CID_SCON, STAT_OFF + 3987), 55ull, term_ctr(CID_SCON, STAT_OFF + 3989), 49ull, term_ctr(CID_SCON, STAT_OFF + 3991), 54ull, term_ctr(CID_SCON, STAT_OFF + 3993), 32ull, term_ctr(CID_SCON, STAT_OFF + 3995), 111ull, term_ctr(CID_SCON, STAT_OFF + 3997), 104ull, term_ctr(CID_SCON, STAT_OFF + 3999), 99ull, term_ctr(CID_SCON, STAT_OFF + 4001), 101ull, term_ctr(CID_SCON, STAT_OFF + 4003), 39ull, term_ctr(CID_SCON, STAT_OFF + 4005), 32ull, term_ctr(CID_SCON, STAT_OFF + 4007), 39ull, term_ctr(CID_SCON, STAT_OFF + 4009), 48ull, term_ctr(CID_SCON, STAT_OFF + 4011), 32ull, term_ctr(CID_SCON, STAT_OFF + 4013), 116ull, term_ctr(CID_SCON, STAT_OFF + 4015), 105ull, term_ctr(CID_SCON, STAT_OFF + 4017), 120ull, term_ctr(CID_SCON, STAT_OFF + 4019), 101ull, term_ctr(CID_SCON, STAT_OFF + 4021), 32ull, term_ctr(CID_SCON, STAT_OFF + 4023), 124ull, term_ctr(CID_SCON, STAT_OFF + 4025), 124ull, term_ctr(CID_SCON, STAT_OFF + 4027), 32ull, term_ctr(CID_SCON, STAT_OFF + 4029), 34ull, term_ctr(CID_SCON, STAT_OFF + 4031), 49ull, term_ctr(CID_SCON, STAT_OFF + 4033), 36ull, term_ctr(CID_SCON, STAT_OFF + 4035), 34ull, term_ctr(CID_SCON, STAT_OFF + 4037), 32ull, term_ctr(CID_SCON, STAT_OFF + 4039), 111ull, term_ctr(CID_SCON, STAT_OFF + 4041), 119ull, term_ctr(CID_SCON, STAT_OFF + 4043), 116ull, term_ctr(CID_SCON, STAT_OFF + 4045), 32ull, term_ctr(CID_SCON, STAT_OFF + 4047), 113ull, term_ctr(CID_SCON, STAT_OFF + 4049), 45ull, term_ctr(CID_SCON, STAT_OFF + 4051), 32ull, term_ctr(CID_SCON, STAT_OFF + 4053), 112ull, term_ctr(CID_SCON, STAT_OFF + 4055), 101ull, term_ctr(CID_SCON, STAT_OFF + 4057), 114ull, term_ctr(CID_SCON, STAT_OFF + 4059), 103ull, term_ctr(CID_SCON, STAT_OFF + 4061), 39ull, term_ctr(CID_SCON, STAT_OFF + 4063), 32ull, term_ctr(CID_SCON, STAT_OFF + 4065), 39ull, term_ctr(CID_SCON, STAT_OFF + 4067), 48ull, term_ctr(CID_SCON, STAT_OFF + 4069), 32ull, term_ctr(CID_SCON, STAT_OFF + 4071), 116ull, term_ctr(CID_SCON, STAT_OFF + 4073), 105ull, term_ctr(CID_SCON, STAT_OFF + 4075), 120ull, term_ctr(CID_SCON, STAT_OFF + 4077), 101ull, term_ctr(CID_SCON, STAT_OFF + 4079), 32ull, term_ctr(CID_SCON, STAT_OFF + 4081), 124ull, term_ctr(CID_SCON, STAT_OFF + 4083), 124ull, term_ctr(CID_SCON, STAT_OFF + 4085), 32ull, term_ctr(CID_SCON, STAT_OFF + 4087), 116ull, term_ctr(CID_SCON, STAT_OFF + 4089), 120ull, term_ctr(CID_SCON, STAT_OFF + 4091), 116ull, term_ctr(CID_SCON, STAT_OFF + 4093), 46ull, term_ctr(CID_SCON, STAT_OFF + 4095), 112ull, term_ctr(CID_SCON, STAT_OFF + 4097), 112ull, term_ctr(CID_SCON, STAT_OFF + 4099), 97ull, term_ctr(CID_SCON, STAT_OFF + 4101), 32ull, term_ctr(CID_SCON, STAT_OFF + 4103), 61ull, term_ctr(CID_SCON, STAT_OFF + 4105), 32ull, term_ctr(CID_SCON, STAT_OFF + 4107), 34ull, term_ctr(CID_SCON, STAT_OFF + 4109), 49ull, term_ctr(CID_SCON, STAT_OFF + 4111), 36ull, term_ctr(CID_SCON, STAT_OFF + 4113), 34ull, term_ctr(CID_SCON, STAT_OFF + 4115), 32ull, term_ctr(CID_SCON, STAT_OFF + 4117), 116ull, term_ctr(CID_SCON, STAT_OFF + 4119), 115ull, term_ctr(CID_SCON, STAT_OFF + 4121), 101ull, term_ctr(CID_SCON, STAT_OFF + 4123), 116ull, term_ctr(CID_SCON, STAT_OFF + 4125), 39ull, term_ctr(CID_SCON, STAT_OFF + 4127), 32ull, term_ctr(CID_SCON, STAT_OFF + 4129), 39ull, term_ctr(CID_SCON, STAT_OFF + 4131), 110ull, term_ctr(CID_SCON, STAT_OFF + 4133), 92ull, term_ctr(CID_SCON, STAT_OFF + 4135), 115ull, term_ctr(CID_SCON, STAT_OFF + 4137), 37ull, term_ctr(CID_SCON, STAT_OFF + 4139), 39ull, term_ctr(CID_SCON, STAT_OFF + 4141), 32ull, term_ctr(CID_SCON, STAT_OFF + 4143), 102ull, term_ctr(CID_SCON, STAT_OFF + 4145), 116ull, term_ctr(CID_SCON, STAT_OFF + 4147), 110ull, term_ctr(CID_SCON, STAT_OFF + 4149), 105ull, term_ctr(CID_SCON, STAT_OFF + 4151), 114ull, term_ctr(CID_SCON, STAT_OFF + 4153), 112ull, term_ctr(CID_SCON, STAT_OFF + 4155), 0, 0ull, term_pak(CID_SNIL, 0), 119ull, term_ctr(CID_SCON, STAT_OFF + 3367), 45ull, term_ctr(CID_SCON, STAT_OFF + 4162), 116ull, term_ctr(CID_SCON, STAT_OFF + 4164), 108ull, term_ctr(CID_SCON, STAT_OFF + 4166), 47ull, term_ctr(CID_SCON, STAT_OFF + 4168), 104ull, term_ctr(CID_SCON, STAT_OFF + 4170), 99ull, term_ctr(CID_SCON, STAT_OFF + 4172), 116ull, term_ctr(CID_SCON, STAT_OFF + 4174), 97ull, term_ctr(CID_SCON, STAT_OFF + 4176), 114ull, term_ctr(CID_SCON, STAT_OFF + 4178), 99ull, term_ctr(CID_SCON, STAT_OFF + 4180), 115ull, term_ctr(CID_SCON, STAT_OFF + 4182), 46ull, term_ctr(CID_SCON, STAT_OFF + 4184), 47ull, term_ctr(CID_SCON, STAT_OFF + 4186), 47ull, term_ctr(CID_SCON, STAT_OFF + 4162), 110ull, term_ctr(CID_SCON, STAT_OFF + 4190), 111ull, term_ctr(CID_SCON, STAT_OFF + 4192), 116ull, term_ctr(CID_SCON, STAT_OFF + 4194), 97ull, term_ctr(CID_SCON, STAT_OFF + 4196), 98ull, term_ctr(CID_SCON, STAT_OFF + 4198), 32ull, term_ctr(CID_SCON, STAT_OFF + 705), 62ull, term_ctr(CID_SCON, STAT_OFF + 4202), 32ull, term_ctr(CID_SCON, STAT_OFF + 4204), 39ull, term_ctr(CID_SCON, STAT_OFF + 4206), 110ull, term_ctr(CID_SCON, STAT_OFF + 4208), 92ull, term_ctr(CID_SCON, STAT_OFF + 4210), 116ull, term_ctr(CID_SCON, STAT_OFF + 4212), 97ull, term_ctr(CID_SCON, STAT_OFF + 4214), 101ull, term_ctr(CID_SCON, STAT_OFF + 4216), 102ull, term_ctr(CID_SCON, STAT_OFF + 4218), 39ull, term_ctr(CID_SCON, STAT_OFF + 4220), 32ull, term_ctr(CID_SCON, STAT_OFF + 4222), 102ull, term_ctr(CID_SCON, STAT_OFF + 4224), 116ull, term_ctr(CID_SCON, STAT_OFF + 4226), 110ull, term_ctr(CID_SCON, STAT_OFF + 4228), 105ull, term_ctr(CID_SCON, STAT_OFF + 4230), 114ull, term_ctr(CID_SCON, STAT_OFF + 4232), 112ull, term_ctr(CID_SCON, STAT_OFF + 4234), 114ull, term_ctr(CID_SCON, STAT_OFF + 2582), 47ull, term_ctr(CID_SCON, STAT_OFF + 4238), 110ull, term_ctr(CID_SCON, STAT_OFF + 4240), 105ull, term_ctr(CID_SCON, STAT_OFF + 4242), 98ull, term_ctr(CID_SCON, STAT_OFF + 4244), 47ull, term_ctr(CID_SCON, STAT_OFF + 4246), 114ull, term_ctr(CID_SCON, STAT_OFF + 365), 45ull, term_ctr(CID_SCON, STAT_OFF + 4250), 110ull, term_ctr(CID_SCON, STAT_OFF + 863), 105ull, term_ctr(CID_SCON, STAT_OFF + 4254), 105ull, term_ctr(CID_SCON, STAT_OFF + 1225), 102ull, term_ctr(CID_SCON, STAT_OFF + 4258), 110ull, term_ctr(CID_SCON, STAT_OFF + 4260), 111ull, term_ctr(CID_SCON, STAT_OFF + 4262), 99ull, term_ctr(CID_SCON, STAT_OFF + 4264), 105ull, term_ctr(CID_SCON, STAT_OFF + 571), 97ull, term_ctr(CID_SCON, STAT_OFF + 4268), 109ull, term_ctr(CID_SCON, STAT_OFF + 4270), 101ull, term_ctr(CID_SCON, STAT_OFF + 4272), 46ull, term_ctr(CID_SCON, STAT_OFF + 4274), 114ull, term_ctr(CID_SCON, STAT_OFF + 4276), 101ull, term_ctr(CID_SCON, STAT_OFF + 4278), 115ull, term_ctr(CID_SCON, STAT_OFF + 4280), 117ull, term_ctr(CID_SCON, STAT_OFF + 4282), 101ull, term_ctr(CID_SCON, STAT_OFF + 2220), 116ull, term_ctr(CID_SCON, STAT_OFF + 4286), 64ull, term_ctr(CID_SCON, STAT_OFF + 4288), 110ull, term_ctr(CID_SCON, STAT_OFF + 4290), 111ull, term_ctr(CID_SCON, STAT_OFF + 4292), 116ull, term_ctr(CID_SCON, STAT_OFF + 4294), 97ull, term_ctr(CID_SCON, STAT_OFF + 4296), 98ull, term_ctr(CID_SCON, STAT_OFF + 4298), term_ctr(CID_SCON, STAT_OFF + 4300), term_pak(CID_NIL, 0), term_ctr(CID_SCON, STAT_OFF + 4284), term_ctr(CID_CON, STAT_OFF + 4302), term_ctr(CID_SCON, STAT_OFF + 4266), term_ctr(CID_CON, STAT_OFF + 4304), 109ull, term_ctr(CID_SCON, STAT_OFF + 48), 97ull, term_ctr(CID_SCON, STAT_OFF + 4308), 110ull, term_ctr(CID_SCON, STAT_OFF + 4310), 46ull, term_ctr(CID_SCON, STAT_OFF + 4312), 114ull, term_ctr(CID_SCON, STAT_OFF + 4314), 101ull, term_ctr(CID_SCON, STAT_OFF + 4316), 115ull, term_ctr(CID_SCON, STAT_OFF + 4318), 117ull, term_ctr(CID_SCON, STAT_OFF + 4320), 32ull, term_ctr(CID_SCON, STAT_OFF + 4288), 110ull, term_ctr(CID_SCON, STAT_OFF + 4324), 111ull, term_ctr(CID_SCON, STAT_OFF + 4326), 116ull, term_ctr(CID_SCON, STAT_OFF + 4328), 97ull, term_ctr(CID_SCON, STAT_OFF + 4330), 98ull, term_ctr(CID_SCON, STAT_OFF + 4332), term_ctr(CID_SCON, STAT_OFF + 4334), term_pak(CID_NIL, 0), term_ctr(CID_SCON, STAT_OFF + 4322), term_ctr(CID_CON, STAT_OFF + 4336), term_ctr(CID_SCON, STAT_OFF + 4266), term_ctr(CID_CON, STAT_OFF + 4338), 116ull, term_ctr(CID_SCON, STAT_OFF + 919), 112ull, term_ctr(CID_SCON, STAT_OFF + 4342), 109ull, term_ctr(CID_SCON, STAT_OFF + 4344), 101ull, term_ctr(CID_SCON, STAT_OFF + 4346), 45ull, term_ctr(CID_SCON, STAT_OFF + 4348), 119ull, term_ctr(CID_SCON, STAT_OFF + 4350), 111ull, term_ctr(CID_SCON, STAT_OFF + 4352), 108ull, term_ctr(CID_SCON, STAT_OFF + 4354), 108ull, term_ctr(CID_SCON, STAT_OFF + 4356), 97ull, term_ctr(CID_SCON, STAT_OFF + 4358), 45ull, term_ctr(CID_SCON, STAT_OFF + 4360), 45ull, term_ctr(CID_SCON, STAT_OFF + 4362), 101ull, term_ctr(CID_SCON, STAT_OFF + 491), 115ull, term_ctr(CID_SCON, STAT_OFF + 4366), term_ctr(CID_SCON, STAT_OFF + 4368), term_pak(CID_NIL, 0), term_ctr(CID_SCON, STAT_OFF + 2584), term_ctr(CID_CON, STAT_OFF + 4370), term_ctr(CID_SCON, STAT_OFF + 4364), term_ctr(CID_CON, STAT_OFF + 4372), term_ctr(CID_SCON, STAT_OFF + 2580), term_ctr(CID_CON, STAT_OFF + 4374), term_ctr(CID_SCON, STAT_OFF + 871), term_ctr(CID_CON, STAT_OFF + 4376), term_ctr(CID_CON, STAT_OFF + 4378), term_pak(CID_NIL, 0), term_ctr(CID_CON, STAT_OFF + 4340), term_ctr(CID_CON, STAT_OFF + 4380), term_ctr(CID_CON, STAT_OFF + 4306), term_ctr(CID_CON, STAT_OFF + 4382), 111ull, term_ctr(CID_SCON, STAT_OFF + 3527), 39ull, term_ctr(CID_SCON, STAT_OFF + 4386), 32ull, term_ctr(CID_SCON, STAT_OFF + 4388), 102ull, term_ctr(CID_SCON, STAT_OFF + 4390), 116ull, term_ctr(CID_SCON, STAT_OFF + 4392), 110ull, term_ctr(CID_SCON, STAT_OFF + 4394), 105ull, term_ctr(CID_SCON, STAT_OFF + 4396), 114ull, term_ctr(CID_SCON, STAT_OFF + 4398), 112ull, term_ctr(CID_SCON, STAT_OFF + 4400), term_ctr(CID_SCON, STAT_OFF + 4402), term_pak(CID_NIL, 0), term_ctr(CID_SCON, STAT_OFF + 3397), term_ctr(CID_CON, STAT_OFF + 4404), term_ctr(CID_SCON, STAT_OFF + 627), term_ctr(CID_CON, STAT_OFF + 4406), 32ull, term_ctr(CID_SCON, STAT_OFF + 729), 62ull, term_ctr(CID_SCON, STAT_OFF + 4410), 32ull, term_ctr(CID_SCON, STAT_OFF + 4412), 39ull, term_ctr(CID_SCON, STAT_OFF + 4414), 110ull, term_ctr(CID_SCON, STAT_OFF + 4416), 92ull, term_ctr(CID_SCON, STAT_OFF + 4418), 48ull, term_ctr(CID_SCON, STAT_OFF + 4420), 32ull, term_ctr(CID_SCON, STAT_OFF + 4422), 116ull, term_ctr(CID_SCON, STAT_OFF + 4424), 105ull, term_ctr(CID_SCON, STAT_OFF + 4426), 120ull, term_ctr(CID_SCON, STAT_OFF + 4428), 101ull, term_ctr(CID_SCON, STAT_OFF + 4430), 39ull, term_ctr(CID_SCON, STAT_OFF + 4432), 32ull, term_ctr(CID_SCON, STAT_OFF + 4434), 102ull, term_ctr(CID_SCON, STAT_OFF + 4436), 116ull, term_ctr(CID_SCON, STAT_OFF + 4438), 110ull, term_ctr(CID_SCON, STAT_OFF + 4440), 105ull, term_ctr(CID_SCON, STAT_OFF + 4442), 114ull, term_ctr(CID_SCON, STAT_OFF + 4444), 112ull, term_ctr(CID_SCON, STAT_OFF + 4446), term_ctr(CID_SCON, STAT_OFF + 4448), term_pak(CID_NIL, 0), term_ctr(CID_SCON, STAT_OFF + 3397), term_ctr(CID_CON, STAT_OFF + 4450), term_ctr(CID_SCON, STAT_OFF + 627), term_ctr(CID_CON, STAT_OFF + 4452), term_ctr(CID_SCON, STAT_OFF + 4157), term_pak(CID_NIL, 0), term_ctr(CID_SCON, STAT_OFF + 3397), term_ctr(CID_CON, STAT_OFF + 4456), term_ctr(CID_SCON, STAT_OFF + 627), term_ctr(CID_CON, STAT_OFF + 4458), term_ctr(CID_SCON, STAT_OFF + 3871), term_pak(CID_NIL, 0), term_ctr(CID_SCON, STAT_OFF + 3397), term_ctr(CID_CON, STAT_OFF + 4462), term_ctr(CID_SCON, STAT_OFF + 627), term_ctr(CID_CON, STAT_OFF + 4464), 114ull, term_ctr(CID_SCON, STAT_OFF + 143), 117ull, term_ctr(CID_SCON, STAT_OFF + 4468), 116ull, term_ctr(CID_SCON, STAT_OFF + 4470), 120ull, term_ctr(CID_SCON, STAT_OFF + 4472), 105ull, term_ctr(CID_SCON, STAT_OFF + 4474), 102ull, term_ctr(CID_SCON, STAT_OFF + 4476), 32ull, term_ctr(CID_SCON, STAT_OFF + 4478), 103ull, term_ctr(CID_SCON, STAT_OFF + 4480), 110ull, term_ctr(CID_SCON, STAT_OFF + 4482), 105ull, term_ctr(CID_SCON, STAT_OFF + 4484), 100ull, term_ctr(CID_SCON, STAT_OFF + 4486), 110ull, term_ctr(CID_SCON, STAT_OFF + 4488), 97ull, term_ctr(CID_SCON, STAT_OFF + 4490), 108ull, term_ctr(CID_SCON, STAT_OFF + 4492), term_ctr(CID_SCON, STAT_OFF + 4494), term_pak(CID_NIL, 0), term_ctr(CID_SCON, STAT_OFF + 2584), term_ctr(CID_CON, STAT_OFF + 4496), term_ctr(CID_SCON, STAT_OFF + 2580), term_ctr(CID_CON, STAT_OFF + 4498), term_ctr(CID_SCON, STAT_OFF + 871), term_ctr(CID_CON, STAT_OFF + 4500), 117ull, term_ctr(CID_SCON, STAT_OFF + 255), 111ull, term_ctr(CID_SCON, STAT_OFF + 4504), 107ull, term_ctr(CID_SCON, STAT_OFF + 4506), 99ull, term_ctr(CID_SCON, STAT_OFF + 4508), 101ull, term_ctr(CID_SCON, STAT_OFF + 4510), 104ull, term_ctr(CID_SCON, STAT_OFF + 4512), 99ull, term_ctr(CID_SCON, STAT_OFF + 4514), term_ctr(CID_SCON, STAT_OFF + 2570), term_pak(CID_NIL, 0), term_ctr(CID_SCON, STAT_OFF + 2580), term_ctr(CID_CON, STAT_OFF + 4518), term_ctr(CID_SCON, STAT_OFF + 4516), term_ctr(CID_CON, STAT_OFF + 4520), term_ctr(CID_CON, STAT_OFF + 4522), term_pak(CID_NIL, 0), term_ctr(CID_CON, STAT_OFF + 4502), term_ctr(CID_CON, STAT_OFF + 4524), term_ctr(CID_CON, STAT_OFF + 3405), term_ctr(CID_CON, STAT_OFF + 4526), 45ull, term_ctr(CID_SCON, STAT_OFF + 4288), 100ull, term_ctr(CID_SCON, STAT_OFF + 4530), 110ull, term_ctr(CID_SCON, STAT_OFF + 4532), 97ull, term_ctr(CID_SCON, STAT_OFF + 4534), 108ull, term_ctr(CID_SCON, STAT_OFF + 4536), 45ull, term_ctr(CID_SCON, STAT_OFF + 4538), 50ull, term_ctr(CID_SCON, STAT_OFF + 4540), 100ull, term_ctr(CID_SCON, STAT_OFF + 4542), 110ull, term_ctr(CID_SCON, STAT_OFF + 4544), 101ull, term_ctr(CID_SCON, STAT_OFF + 4546), 98ull, term_ctr(CID_SCON, STAT_OFF + 4548), 47ull, term_ctr(CID_SCON, STAT_OFF + 4550), 104ull, term_ctr(CID_SCON, STAT_OFF + 4552), 99ull, term_ctr(CID_SCON, STAT_OFF + 4554), 116ull, term_ctr(CID_SCON, STAT_OFF + 4556), 97ull, term_ctr(CID_SCON, STAT_OFF + 4558), 114ull, term_ctr(CID_SCON, STAT_OFF + 4560), 99ull, term_ctr(CID_SCON, STAT_OFF + 4562), 115ull, term_ctr(CID_SCON, STAT_OFF + 4564), 46ull, term_ctr(CID_SCON, STAT_OFF + 4566), 112ull, term_ctr(CID_SCON, STAT_OFF + 2266), 47ull, term_ctr(CID_SCON, STAT_OFF + 4570), 110ull, term_ctr(CID_SCON, STAT_OFF + 4572), 105ull, term_ctr(CID_SCON, STAT_OFF + 4574), 98ull, term_ctr(CID_SCON, STAT_OFF + 4576), 47ull, term_ctr(CID_SCON, STAT_OFF + 4578), term_ctr(CID_SCON, STAT_OFF + 4580), term_pak(CID_NIL, 0) };

INLINE Term spin_0(Env e, THR Term* o, u32 r0) {
  u32 wpoll = 0;
  u32 _v_2 = 0;
  u32 _c_1 = r0;
  WL_SPIN
    _v_2 = _c_1;
  break;
  }
  o[0] = _v_2;
  return 1;
}

INLINE Term spin_1(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_5 = 0;
  u32 _c_2 = r0;
  Term _a_0 = r1;
  Term _b_1 = r2;
  WL_SPIN
    if (_c_2 == 0) {
      term_sink(e, _a_0);
      _v_5 = _b_1;
    } else {
      term_sink(e, _b_1);
      _v_5 = _a_0;
    }
  break;
  }
  o[0] = _v_5;
  return 1;
}

INLINE Term spin_2(Env e, THR Term* o, u32 r0) {
  u32 wpoll = 0;
  u32 _v_3 = 0;
  u32 _c_0 = r0;
  WL_SPIN
    u32 _v_4 = 0;
    u32 _v_5 = 0;
    Term _o_0[1];
    if (spin_0(e, _o_0, _c_0) == 0) {
      return 0;
    }
    _v_5 = _o_0[0];
    _v_4 = _v_5;
    u32 _lo1_0 = U32_BIN(47ull, <, _v_4);
    u32 _hi1_0 = U32_BIN(_v_4, <, 58ull);
    Term _v_6 = 0;
    Term _b_0 = 0;
    if (_hi1_0 == 0) {
      _b_0 = term_pak(CID_FALSE, 0);
    } else {
      _b_0 = term_pak(CID_TRUE, 0);
    }
    Term _v_7 = 0;
    Term _o_1[1];
    if (spin_1(e, _o_1, _lo1_0, _b_0, term_pak(CID_FALSE, 0)) == 0) {
      return 0;
    }
    _v_7 = _o_1[0];
    _v_6 = _v_7;
    u32 _lo2_0 = U32_BIN(96ull, <, _v_4);
    u32 _hi2_0 = U32_BIN(_v_4, <, 103ull);
    Term _v_8 = 0;
    Term _b_1 = 0;
    if (_hi2_0 == 0) {
      _b_1 = term_pak(CID_FALSE, 0);
    } else {
      _b_1 = term_pak(CID_TRUE, 0);
    }
    Term _v_9 = 0;
    Term _o_2[1];
    if (spin_1(e, _o_2, _lo2_0, _b_1, term_pak(CID_FALSE, 0)) == 0) {
      return 0;
    }
    _v_9 = _o_2[0];
    _v_8 = _v_9;
    u32 _lo3_0 = U32_BIN(64ull, <, _v_4);
    u32 _hi3_0 = U32_BIN(_v_4, <, 71ull);
    Term _v_10 = 0;
    Term _b_2 = 0;
    if (_hi3_0 == 0) {
      _b_2 = term_pak(CID_FALSE, 0);
    } else {
      _b_2 = term_pak(CID_TRUE, 0);
    }
    Term _v_11 = 0;
    Term _o_3[1];
    if (spin_1(e, _o_3, _lo3_0, _b_2, term_pak(CID_FALSE, 0)) == 0) {
      return 0;
    }
    _v_11 = _o_3[0];
    _v_10 = _v_11;
    Term _v_12 = 0;
    u32 _o_4 = 0;
    if (term_aux(_v_6) == CID_FALSE) {
      _o_4 = 0;
    } else {
      _o_4 = 1;
    }
    Term _v_13 = 0;
    Term _o_5[1];
    if (spin_1(e, _o_5, _o_4, term_pak(CID_TRUE, 0), _v_8) == 0) {
      return 0;
    }
    _v_13 = _o_5[0];
    _v_12 = _v_13;
    u32 _o_6 = 0;
    if (term_aux(_v_12) == CID_FALSE) {
      _o_6 = 0;
    } else {
      _o_6 = 1;
    }
    Term _v_14 = 0;
    Term _o_7[1];
    if (spin_1(e, _o_7, _o_6, term_pak(CID_TRUE, 0), _v_10) == 0) {
      return 0;
    }
    _v_14 = _o_7[0];
    u32 _o_8 = 0;
    if (term_aux(_v_14) == CID_FALSE) {
      _o_8 = 0;
    } else {
      _o_8 = 1;
    }
    _v_3 = _o_8;
  break;
  }
  o[0] = _v_3;
  return 1;
}

INLINE Term spin_3(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_2 = 0;
  Term _s_1 = r0;
  WL_SPIN
    if (term_aux(_s_1) == CID_SNIL) {
      _v_2 = 0;
    } else {
      u64 _sp_0 = term_peek(e, _s_1);
      u32 _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      _v_2 = 1;
    }
  break;
  }
  o[0] = _v_2;
  return 1;
}

INLINE Term spin_4(Env e, THR Term* o, Term r0, u32 r1) {
  u32 wpoll = 0;
  u32 _v_4 = 0;
  Term _s_2 = r0;
  u32 _ok_0 = r1;
  WL_SPIN
    if (term_aux(_s_2) == CID_SNIL) {
      _v_4 = _ok_0;
    } else {
      Term _fb_0[2];
      u64 _sp_1 = ctr_take(e, _s_2, 2, _fb_0);
      u32 _f_2 = _fb_0[0];
      Term _f_3 = _fb_0[1];
      Term _v_5 = 0;
      u32 _v_6 = 0;
      u32 _v_7 = 0;
      Term _o_1[1];
      if (spin_2(e, _o_1, _f_2) == 0) {
        return 0;
      }
      _v_7 = _o_1[0];
      _v_6 = _v_7;
      Term _b_0 = 0;
      if (_v_6 == 0) {
        _b_0 = term_pak(CID_FALSE, 0);
      } else {
        _b_0 = term_pak(CID_TRUE, 0);
      }
      Term _v_8 = 0;
      Term _o_2[1];
      if (spin_1(e, _o_2, _ok_0, _b_0, term_pak(CID_FALSE, 0)) == 0) {
        return 0;
      }
      _v_8 = _o_2[0];
      _v_5 = _v_8;
      u32 _o_3 = 0;
      if (term_aux(_v_5) == CID_FALSE) {
        _o_3 = 0;
      } else {
        _o_3 = 1;
      }
      spare_free(e, cls_fit(2), _sp_1);
      r0 = _f_3;
      r1 = _o_3;
      _s_2 = r0;
      _ok_0 = r1;
      WL_AGAIN(spin_4);
    }
  break;
  }
  o[0] = _v_4;
  return 1;
}

INLINE Term spin_5(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_3 = 0;
  Term _s_0 = r0;
  WL_SPIN
    u32 _v_4 = 0;
    u32 _v_5 = 0;
    Term _o_0[1];
    if (spin_3(e, _o_0, _s_0) == 0) {
      return 0;
    }
    _v_5 = _o_0[0];
    _v_4 = _v_5;
    u32 _v_6 = 0;
    Term _o_1[1];
    if (spin_4(e, _o_1, _s_0, _v_4) == 0) {
      return 0;
    }
    _v_6 = _o_1[0];
    _v_3 = _v_6;
  break;
  }
  o[0] = _v_3;
  return 1;
}

INLINE Term spin_10(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_13 = 0;
  Term _s_3 = r0;
  Term _acc_2 = r1;
  WL_SPIN
    if (term_aux(_s_3) == CID_SNIL) {
      _v_13 = _acc_2;
    } else {
      Term _fb_1[2];
      u64 _sp_1 = ctr_take(e, _s_3, 2, _fb_1);
      u32 _f_2 = _fb_1[0];
      Term _f_3 = _fb_1[1];
      u64 _nd_1 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
      e.mem[_nd_1 + 0] = rfc_seal(e, _f_2);
      e.mem[_nd_1 + 1] = rfc_seal(e, _acc_2);
      r0 = _f_3;
      r1 = term_ctr(CID_SCON, _nd_1);
      _s_3 = r0;
      _acc_2 = r1;
      WL_AGAIN(spin_10);
    }
  break;
  }
  o[0] = _v_13;
  return 1;
}

INLINE Term spin_9(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_11 = 0;
  Term _s_2 = r0;
  WL_SPIN
    Term _v_12 = 0;
    Term _o_0[1];
    if (spin_10(e, _o_0, _s_2, term_pak(CID_SNIL, 0)) == 0) {
      return 0;
    }
    _v_12 = _o_0[0];
    _v_11 = _v_12;
  break;
  }
  o[0] = _v_11;
  return 1;
}

INLINE Term spin_8(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_8 = 0;
  Term _acc_1 = r0;
  Term _out_1 = r1;
  WL_SPIN
    if (term_aux(_acc_1) == CID_SNIL) {
      _v_8 = _out_1;
    } else {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _acc_1, 2, _fb_0);
      u32 _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      Term _v_9 = 0;
      u64 _nd_0 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
      e.mem[_nd_0 + 0] = rfc_seal(e, _f_0);
      e.mem[_nd_0 + 1] = rfc_seal(e, _f_1);
      Term _v_10 = 0;
      Term _o_1[1];
      if (spin_9(e, _o_1, term_ctr(CID_SCON, _nd_0)) == 0) {
        return 0;
      }
      _v_10 = _o_1[0];
      _v_9 = _v_10;
      u64 _nd_2 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_2 + 0] = _v_9;
      e.mem[_nd_2 + 1] = _out_1;
      _v_8 = term_ctr(CID_CON, _nd_2);
    }
  break;
  }
  o[0] = _v_8;
  return 1;
}

INLINE Term spin_11(Env e, THR Term* o, u32 r0) {
  u32 wpoll = 0;
  u32 _v_16 = 0;
  u32 _c_0 = r0;
  WL_SPIN
    u32 _v_17 = 0;
    u32 _v_18 = 0;
    Term _o_3[1];
    if (spin_0(e, _o_3, _c_0) == 0) {
      return 0;
    }
    _v_18 = _o_3[0];
    _v_17 = _v_18;
    Term _v_19 = 0;
    Term _o_4[1];
    if (spin_1(e, _o_4, U32_BIN(_v_17, ==, 32ull), term_pak(CID_TRUE, 0), term_pak(CID_FALSE, 0)) == 0) {
      return 0;
    }
    _v_19 = _o_4[0];
    u32 _o_5 = 0;
    if (term_aux(_v_19) == CID_FALSE) {
      _o_5 = 0;
    } else {
      _o_5 = 1;
    }
    _v_16 = _o_5;
  break;
  }
  o[0] = _v_16;
  return 1;
}

INLINE Term spin_12(Env e, THR Term* o, u32 r0, u32 r1, Term r2) {
  u32 wpoll = 0;
  Term _v_22 = 0;
  u32 _nl_0 = r0;
  u32 _c_1 = r1;
  Term _acc_3 = r2;
  WL_SPIN
    if (_nl_0 == 1) {
      term_sink(e, _acc_3);
      _v_22 = term_pak(CID_SNIL, 0);
    } else {
      u64 _nd_3 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_3 + 0] = rfc_seal(e, _c_1);
      e.mem[_nd_3 + 1] = rfc_seal(e, _acc_3);
      _v_22 = term_ctr(CID_SCON, _nd_3);
    }
  break;
  }
  o[0] = _v_22;
  return 1;
}

INLINE Term spin_13(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_25 = 0;
  u32 _nl_1 = r0;
  Term _acc_4 = r1;
  Term _out_2 = r2;
  WL_SPIN
    if (_nl_1 == 1) {
      Term _v_26 = 0;
      Term _v_27 = 0;
      Term _o_8[1];
      if (spin_9(e, _o_8, _acc_4) == 0) {
        return 0;
      }
      _v_27 = _o_8[0];
      _v_26 = _v_27;
      u64 _nd_4 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_4 + 0] = _v_26;
      e.mem[_nd_4 + 1] = _out_2;
      _v_25 = term_ctr(CID_CON, _nd_4);
    } else {
      term_sink(e, _acc_4);
      _v_25 = _out_2;
    }
  break;
  }
  o[0] = _v_25;
  return 1;
}

INLINE Term spin_7(Env e, THR Term* o, Term r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_6 = 0;
  Term _s_1 = r0;
  Term _acc_0 = r1;
  Term _out_0 = r2;
  WL_SPIN
    if (term_aux(_s_1) == CID_SNIL) {
      Term _v_7 = 0;
      Term _o_2[1];
      if (spin_8(e, _o_2, _acc_0, _out_0) == 0) {
        return 0;
      }
      _v_7 = _o_2[0];
      _v_6 = _v_7;
    } else {
      u64 _sp_2 = term_peek(e, _s_1);
      u32 _f_4 = e.mem[_sp_2 + 0];
      Term _f_5 = e.mem[_sp_2 + 1];
      u32 _v_14 = 0;
      u32 _v_15 = 0;
      Term _o_6[1];
      if (spin_11(e, _o_6, _f_4) == 0) {
        return 0;
      }
      _v_15 = _o_6[0];
      _v_14 = _v_15;
      Term _v_20 = 0;
      _acc_0 = term_keep(e, _acc_0);
      Term _v_21 = 0;
      Term _o_7[1];
      if (spin_12(e, _o_7, _v_14, _f_4, _acc_0) == 0) {
        return 0;
      }
      _v_21 = _o_7[0];
      _v_20 = _v_21;
      Term _v_23 = 0;
      Term _v_24 = 0;
      Term _o_9[1];
      if (spin_13(e, _o_9, _v_14, _acc_0, _out_0) == 0) {
        return 0;
      }
      _v_24 = _o_9[0];
      _v_23 = _v_24;
      r0 = _f_5;
      r1 = _v_20;
      r2 = _v_23;
      _s_1 = r0;
      _acc_0 = r1;
      _out_0 = r2;
      WL_AGAIN(spin_7);
    }
  break;
  }
  o[0] = _v_6;
  return 1;
}

INLINE Term spin_15(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_31 = 0;
  Term _xs_1 = r0;
  Term _acc_5 = r1;
  WL_SPIN
    if (term_aux(_xs_1) == CID_NIL) {
      _v_31 = _acc_5;
    } else {
      Term _fb_2[2];
      u64 _sp_3 = ctr_take(e, _xs_1, 2, _fb_2);
      Term _f_6 = _fb_2[0];
      Term _f_7 = _fb_2[1];
      u64 _nd_5 = _sp_3 >= HEAP_OFF ? _sp_3 : heap_alloc(e, cls_fit(2));
      e.mem[_nd_5 + 0] = _f_6;
      e.mem[_nd_5 + 1] = _acc_5;
      r0 = _f_7;
      r1 = term_ctr(CID_CON, _nd_5);
      _xs_1 = r0;
      _acc_5 = r1;
      WL_AGAIN(spin_15);
    }
  break;
  }
  o[0] = _v_31;
  return 1;
}

INLINE Term spin_14(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_29 = 0;
  Term _xs_0 = r0;
  WL_SPIN
    Term _v_30 = 0;
    Term _o_11[1];
    if (spin_15(e, _o_11, _xs_0, term_pak(CID_NIL, 0)) == 0) {
      return 0;
    }
    _v_30 = _o_11[0];
    _v_29 = _v_30;
  break;
  }
  o[0] = _v_29;
  return 1;
}

INLINE Term spin_6(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_3 = 0;
  Term _s_0 = r0;
  WL_SPIN
    Term _v_4 = 0;
    Term _v_5 = 0;
    Term _o_10[1];
    if (spin_7(e, _o_10, _s_0, term_pak(CID_SNIL, 0), term_pak(CID_NIL, 0)) == 0) {
      return 0;
    }
    _v_5 = _o_10[0];
    _v_4 = _v_5;
    Term _v_28 = 0;
    Term _o_12[1];
    if (spin_14(e, _o_12, _v_4) == 0) {
      return 0;
    }
    _v_28 = _o_12[0];
    _v_3 = _v_28;
  break;
  }
  o[0] = _v_3;
  return 1;
}

INLINE Term spin_16(Env e, THR Term* o, Term r0, u32 r1) {
  u32 wpoll = 0;
  u32 _v_33 = 0;
  Term _fs_0 = r0;
  u32 _n_0 = r1;
  WL_SPIN
    if (term_aux(_fs_0) == CID_NIL) {
      _v_33 = _n_0;
    } else {
      Term _fb_3[2];
      u64 _sp_4 = ctr_take(e, _fs_0, 2, _fb_3);
      Term _f_8 = _fb_3[0];
      Term _f_9 = _fb_3[1];
      term_sink(e, _f_8);
      u32 _n2_0 = U32_BIN(_n_0, +, 1ull);
      spare_free(e, cls_fit(2), _sp_4);
      r0 = _f_9;
      r1 = _n2_0;
      _fs_0 = r0;
      _n_0 = r1;
      WL_AGAIN(spin_16);
    }
  break;
  }
  o[0] = _v_33;
  return 1;
}

INLINE Term spin_17(Env e, THR Term* o, Term r0, u32 r1) {
  u32 wpoll = 0;
  u32 _v_38 = 0;
  Term _fs_1 = r0;
  u32 _ok_0 = r1;
  WL_SPIN
    if (term_aux(_fs_1) == CID_NIL) {
      _v_38 = _ok_0;
    } else {
      Term _fb_4[2];
      u64 _sp_5 = ctr_take(e, _fs_1, 2, _fb_4);
      Term _f_10 = _fb_4[0];
      Term _f_11 = _fb_4[1];
      Term _v_39 = 0;
      u32 _v_40 = 0;
      u32 _v_41 = 0;
      Term _o_16[1];
      if (spin_5(e, _o_16, _f_10) == 0) {
        return 0;
      }
      _v_41 = _o_16[0];
      _v_40 = _v_41;
      Term _b_0 = 0;
      if (_v_40 == 0) {
        _b_0 = term_pak(CID_FALSE, 0);
      } else {
        _b_0 = term_pak(CID_TRUE, 0);
      }
      Term _v_42 = 0;
      Term _o_17[1];
      if (spin_1(e, _o_17, _ok_0, _b_0, term_pak(CID_FALSE, 0)) == 0) {
        return 0;
      }
      _v_42 = _o_17[0];
      _v_39 = _v_42;
      u32 _o_18 = 0;
      if (term_aux(_v_39) == CID_FALSE) {
        _o_18 = 0;
      } else {
        _o_18 = 1;
      }
      spare_free(e, cls_fit(2), _sp_5);
      r0 = _f_11;
      r1 = _o_18;
      _fs_1 = r0;
      _ok_0 = r1;
      WL_AGAIN(spin_17);
    }
  break;
  }
  o[0] = _v_38;
  return 1;
}

INLINE Term spin_18(Env e, THR Term* o, u32 r0, u32 r1) {
  u32 wpoll = 0;
  u32 _v_44 = 0;
  u32 _n_1 = r0;
  u32 _hexok_0 = r1;
  WL_SPIN
    Term _v_45 = 0;
    Term _b_1 = 0;
    if (_hexok_0 == 0) {
      _b_1 = term_pak(CID_FALSE, 0);
    } else {
      _b_1 = term_pak(CID_TRUE, 0);
    }
    Term _v_46 = 0;
    Term _o_20[1];
    if (spin_1(e, _o_20, U32_BIN(_n_1, ==, 4ull), _b_1, term_pak(CID_FALSE, 0)) == 0) {
      return 0;
    }
    _v_46 = _o_20[0];
    _v_45 = _v_46;
    u32 _o_21 = 0;
    if (term_aux(_v_45) == CID_FALSE) {
      _o_21 = 0;
    } else {
      _o_21 = 1;
    }
    _v_44 = _o_21;
  break;
  }
  o[0] = _v_44;
  return 1;
}

INLINE Term spin_21(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_7 = 0;
  Term _acc_1 = r0;
  Term _out_1 = r1;
  WL_SPIN
    if (term_aux(_acc_1) == CID_SNIL) {
      _v_7 = _out_1;
    } else {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _acc_1, 2, _fb_0);
      u32 _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      Term _v_8 = 0;
      u64 _nd_0 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
      e.mem[_nd_0 + 0] = rfc_seal(e, _f_0);
      e.mem[_nd_0 + 1] = rfc_seal(e, _f_1);
      Term _v_9 = 0;
      Term _o_0[1];
      if (spin_9(e, _o_0, term_ctr(CID_SCON, _nd_0)) == 0) {
        return 0;
      }
      _v_9 = _o_0[0];
      _v_8 = _v_9;
      u64 _nd_1 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_1 + 0] = _v_8;
      e.mem[_nd_1 + 1] = _out_1;
      _v_7 = term_ctr(CID_CON, _nd_1);
    }
  break;
  }
  o[0] = _v_7;
  return 1;
}

INLINE Term spin_22(Env e, THR Term* o, u32 r0) {
  u32 wpoll = 0;
  u32 _v_12 = 0;
  u32 _c_0 = r0;
  WL_SPIN
    u32 _v_13 = 0;
    u32 _v_14 = 0;
    Term _o_2[1];
    if (spin_0(e, _o_2, _c_0) == 0) {
      return 0;
    }
    _v_14 = _o_2[0];
    _v_13 = _v_14;
    Term _v_15 = 0;
    Term _o_3[1];
    if (spin_1(e, _o_3, U32_BIN(_v_13, ==, 10ull), term_pak(CID_TRUE, 0), term_pak(CID_FALSE, 0)) == 0) {
      return 0;
    }
    _v_15 = _o_3[0];
    u32 _o_4 = 0;
    if (term_aux(_v_15) == CID_FALSE) {
      _o_4 = 0;
    } else {
      _o_4 = 1;
    }
    _v_12 = _o_4;
  break;
  }
  o[0] = _v_12;
  return 1;
}

INLINE Term spin_23(Env e, THR Term* o, u32 r0, u32 r1, Term r2) {
  u32 wpoll = 0;
  Term _v_18 = 0;
  u32 _nl_0 = r0;
  u32 _c_1 = r1;
  Term _acc_2 = r2;
  WL_SPIN
    if (_nl_0 == 1) {
      term_sink(e, _acc_2);
      _v_18 = term_pak(CID_SNIL, 0);
    } else {
      u64 _nd_2 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_2 + 0] = rfc_seal(e, _c_1);
      e.mem[_nd_2 + 1] = rfc_seal(e, _acc_2);
      _v_18 = term_ctr(CID_SCON, _nd_2);
    }
  break;
  }
  o[0] = _v_18;
  return 1;
}

INLINE Term spin_24(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_21 = 0;
  u32 _nl_1 = r0;
  Term _acc_3 = r1;
  Term _out_2 = r2;
  WL_SPIN
    if (_nl_1 == 1) {
      Term _v_22 = 0;
      Term _v_23 = 0;
      Term _o_7[1];
      if (spin_9(e, _o_7, _acc_3) == 0) {
        return 0;
      }
      _v_23 = _o_7[0];
      _v_22 = _v_23;
      u64 _nd_3 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_3 + 0] = _v_22;
      e.mem[_nd_3 + 1] = _out_2;
      _v_21 = term_ctr(CID_CON, _nd_3);
    } else {
      term_sink(e, _acc_3);
      _v_21 = _out_2;
    }
  break;
  }
  o[0] = _v_21;
  return 1;
}

INLINE Term spin_20(Env e, THR Term* o, Term r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_5 = 0;
  Term _s_1 = r0;
  Term _acc_0 = r1;
  Term _out_0 = r2;
  WL_SPIN
    if (term_aux(_s_1) == CID_SNIL) {
      Term _v_6 = 0;
      Term _o_1[1];
      if (spin_21(e, _o_1, _acc_0, _out_0) == 0) {
        return 0;
      }
      _v_6 = _o_1[0];
      _v_5 = _v_6;
    } else {
      u64 _sp_1 = term_peek(e, _s_1);
      u32 _f_2 = e.mem[_sp_1 + 0];
      Term _f_3 = e.mem[_sp_1 + 1];
      u32 _v_10 = 0;
      u32 _v_11 = 0;
      Term _o_5[1];
      if (spin_22(e, _o_5, _f_2) == 0) {
        return 0;
      }
      _v_11 = _o_5[0];
      _v_10 = _v_11;
      Term _v_16 = 0;
      _acc_0 = term_keep(e, _acc_0);
      Term _v_17 = 0;
      Term _o_6[1];
      if (spin_23(e, _o_6, _v_10, _f_2, _acc_0) == 0) {
        return 0;
      }
      _v_17 = _o_6[0];
      _v_16 = _v_17;
      Term _v_19 = 0;
      Term _v_20 = 0;
      Term _o_8[1];
      if (spin_24(e, _o_8, _v_10, _acc_0, _out_0) == 0) {
        return 0;
      }
      _v_20 = _o_8[0];
      _v_19 = _v_20;
      r0 = _f_3;
      r1 = _v_16;
      r2 = _v_19;
      _s_1 = r0;
      _acc_0 = r1;
      _out_0 = r2;
      WL_AGAIN(spin_20);
    }
  break;
  }
  o[0] = _v_5;
  return 1;
}

INLINE Term spin_19(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_2 = 0;
  Term _s_0 = r0;
  WL_SPIN
    Term _v_3 = 0;
    Term _v_4 = 0;
    Term _o_9[1];
    if (spin_20(e, _o_9, _s_0, term_pak(CID_SNIL, 0), term_pak(CID_NIL, 0)) == 0) {
      return 0;
    }
    _v_4 = _o_9[0];
    _v_3 = _v_4;
    Term _v_24 = 0;
    Term _o_10[1];
    if (spin_14(e, _o_10, _v_3) == 0) {
      return 0;
    }
    _v_24 = _o_10[0];
    _v_2 = _v_24;
  break;
  }
  o[0] = _v_2;
  return 1;
}

INLINE Term spin_25(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_3 = 0;
  Term _line_0 = r0;
  WL_SPIN
    u32 _v_4 = 0;
    Term _v_5 = 0;
    Term _v_6 = 0;
    Term _o_0[1];
    if (spin_6(e, _o_0, _line_0) == 0) {
      return 0;
    }
    _v_6 = _o_0[0];
    _v_5 = _v_6;
    u32 _v_7 = 0;
    Term _o_1[1];
    if (spin_16(e, _o_1, _v_5, 0ull) == 0) {
      return 0;
    }
    _v_7 = _o_1[0];
    _v_4 = _v_7;
    u32 _v_8 = 0;
    Term _v_9 = 0;
    Term _v_10 = 0;
    Term _o_2[1];
    if (spin_6(e, _o_2, _line_0) == 0) {
      return 0;
    }
    _v_10 = _o_2[0];
    _v_9 = _v_10;
    u32 _v_11 = 0;
    Term _o_3[1];
    if (spin_17(e, _o_3, _v_9, 1) == 0) {
      return 0;
    }
    _v_11 = _o_3[0];
    _v_8 = _v_11;
    u32 _v_12 = 0;
    Term _o_4[1];
    if (spin_18(e, _o_4, _v_4, _v_8) == 0) {
      return 0;
    }
    _v_12 = _o_4[0];
    term_sink(e, _line_0);
    _v_3 = _v_12;
  break;
  }
  o[0] = _v_3;
  return 1;
}

INLINE Term spin_26(Env e, THR Term* o, u32 r0) {
  u32 wpoll = 0;
  u32 _v_4 = 0;
  u32 _b_0 = r0;
  WL_SPIN
    if (_b_0 == 0) {
      _v_4 = 1;
    } else {
      _v_4 = 0;
    }
  break;
  }
  o[0] = _v_4;
  return 1;
}

INLINE Term spin_27(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_6 = 0;
  u32 _keep_0 = r0;
  Term _f_4 = r1;
  Term _acc_2 = r2;
  WL_SPIN
    if (_keep_0 == 1) {
      u64 _nd_0 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_0 + 0] = _f_4;
      e.mem[_nd_0 + 1] = _acc_2;
      _v_6 = term_ctr(CID_CON, _nd_0);
    } else {
      term_sink(e, _f_4);
      _v_6 = _acc_2;
    }
  break;
  }
  o[0] = _v_6;
  return 1;
}

INLINE Term spin_28(Env e, THR Term* o, Term r0, u32 r1) {
  u32 wpoll = 0;
  u32 _v_3 = 0;
  Term _lines_0 = r0;
  u32 _ok_0 = r1;
  WL_SPIN
    if (term_aux(_lines_0) == CID_NIL) {
      _v_3 = _ok_0;
    } else {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _lines_0, 2, _fb_0);
      Term _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      Term _v_4 = 0;
      u32 _v_5 = 0;
      u32 _v_6 = 0;
      Term _o_1[1];
      if (spin_25(e, _o_1, _f_0) == 0) {
        return 0;
      }
      _v_6 = _o_1[0];
      _v_5 = _v_6;
      Term _b_0 = 0;
      if (_v_5 == 0) {
        _b_0 = term_pak(CID_FALSE, 0);
      } else {
        _b_0 = term_pak(CID_TRUE, 0);
      }
      Term _v_7 = 0;
      Term _o_2[1];
      if (spin_1(e, _o_2, _ok_0, _b_0, term_pak(CID_FALSE, 0)) == 0) {
        return 0;
      }
      _v_7 = _o_2[0];
      _v_4 = _v_7;
      u32 _o_3 = 0;
      if (term_aux(_v_4) == CID_FALSE) {
        _o_3 = 0;
      } else {
        _o_3 = 1;
      }
      spare_free(e, cls_fit(2), _sp_0);
      r0 = _f_1;
      r1 = _o_3;
      _lines_0 = r0;
      _ok_0 = r1;
      WL_AGAIN(spin_28);
    }
  break;
  }
  o[0] = _v_3;
  return 1;
}

INLINE Term spin_29(Env e, THR Term* o, u32 r0, Term r1, Term r2, Term r3) {
  u32 wpoll = 0;
  u32 _v_4 = 0;
  Term _v_5 = 0;
  Term _v_6 = 0;
  Term _v_7 = 0;
  u32 _ok_0 = r0;
  Term _out_0 = r1;
  Term _target_2 = r2;
  Term _cand_2 = r3;
  WL_SPIN
    if (_ok_0 == 1) {
      term_sink(e, _out_0);
      _v_4 = 0;
      _v_5 = 0;
      _v_6 = _target_2;
      _v_7 = _cand_2;
    } else {
      term_sink(e, _target_2);
      term_sink(e, _cand_2);
      _v_4 = 1;
      _v_5 = 4;
      _v_6 = term_ctr(CID_SCON, STAT_OFF + 46);
      _v_7 = _out_0;
    }
  break;
  }
  o[0] = _v_4;
  o[1] = _v_5;
  o[2] = _v_6;
  o[3] = _v_7;
  return 1;
}

INLINE Term spin_30(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_2 = 0;
  Term _block_1 = r0;
  WL_SPIN
    Term _v_3 = 0;
    Term _v_4 = 0;
    Term _o_0[1];
    if (spin_19(e, _o_0, _block_1) == 0) {
      return 0;
    }
    _v_4 = _o_0[0];
    _v_3 = _v_4;
    u32 _v_5 = 0;
    Term _o_1[1];
    if (spin_28(e, _o_1, _v_3, 1) == 0) {
      return 0;
    }
    _v_5 = _o_1[0];
    _v_2 = _v_5;
  break;
  }
  o[0] = _v_2;
  return 1;
}

INLINE Term spin_31(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_9 = 0;
  u32 _v_10 = 0;
  Term _v_11 = 0;
  u32 _ok_0 = r0;
  Term _block_2 = r1;
  Term _file_1 = r2;
  WL_SPIN
    if (_ok_0 == 1) {
      _v_9 = _file_1;
      _v_10 = 1;
      _v_11 = _block_2;
    } else {
      term_sink(e, _block_2);
      _v_9 = _file_1;
      _v_10 = 2;
      _v_11 = term_ctr(CID_SCON, STAT_OFF + 215);
    }
  break;
  }
  o[0] = _v_9;
  o[1] = _v_10;
  o[2] = _v_11;
  return 1;
}

INLINE Term spin_32(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_1 = 0;
  u32 _code_0 = r0;
  Term _msg_0 = r1;
  Term _k_0 = r2;
  WL_SPIN
    term_sink(e, _k_0);
    u64 _nd_1 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_1 + 0] = _code_0;
    e.mem[_nd_1 + 1] = _msg_0;
    _v_1 = term_ctr(CID_HALT, _nd_1);
  break;
  }
  o[0] = _v_1;
  return 1;
}

INLINE Term spin_33(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_5 = 0;
  u32 _v_6 = 0;
  Term _v_7 = 0;
  Term _block_0 = r0;
  Term _file_2 = r1;
  WL_SPIN
    u32 _v_8 = 0;
    u32 _v_9 = 0;
    Term _o_1[1];
    if (spin_30(e, _o_1, _block_0) == 0) {
      return 0;
    }
    _v_9 = _o_1[0];
    _v_8 = _v_9;
    Term _v_10 = 0;
    u32 _v_11 = 0;
    Term _v_12 = 0;
    Term _o_2[3];
    if (spin_31(e, _o_2, _v_8, _block_0, _file_2) == 0) {
      return 0;
    }
    _v_10 = _o_2[0];
    _v_11 = _o_2[1];
    _v_12 = _o_2[2];
    _v_5 = _v_10;
    _v_6 = _v_11;
    _v_7 = _v_12;
  break;
  }
  o[0] = _v_5;
  o[1] = _v_6;
  o[2] = _v_7;
  return 1;
}

INLINE Term spin_34(Env e, THR Term* o, u32 r0, u32 r1, Term r2) {
  u32 wpoll = 0;
  u32 _v_4 = 0;
  Term _v_5 = 0;
  u32 _v_6 = 0;
  Term _v_7 = 0;
  u32 _st_0 = r0;
  u32 _st_1 = r1;
  Term _rest_1 = r2;
  WL_SPIN
    _v_4 = 0;
    _v_5 = _st_0;
    _v_6 = _st_1;
    _v_7 = _rest_1;
  break;
  }
  o[0] = _v_4;
  o[1] = _v_5;
  o[2] = _v_6;
  o[3] = _v_7;
  return 1;
}

INLINE Term spin_35(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_2 = 0;
  Term _script_1 = r0;
  Term _file_1 = r1;
  WL_SPIN
    u64 _nd_0 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_0 + 0] = _file_1;
    e.mem[_nd_0 + 1] = term_pak(CID_NIL, 0);
    u64 _nd_1 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_1 + 0] = _script_1;
    e.mem[_nd_1 + 1] = term_ctr(CID_CON, _nd_0);
    u64 _nd_2 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_2 + 0] = term_ctr(CID_SCON, STAT_OFF + 627);
    e.mem[_nd_2 + 1] = term_ctr(CID_CON, _nd_1);
    _v_2 = term_ctr(CID_CON, _nd_2);
  break;
  }
  o[0] = _v_2;
  return 1;
}

INLINE Term spin_36(Env e, THR Term* o, u32 r0, Term r1, Term r2, Term r3) {
  u32 wpoll = 0;
  u32 _v_6 = 0;
  Term _v_7 = 0;
  Term _v_8 = 0;
  Term _v_9 = 0;
  u32 _has_0 = r0;
  Term _paths_1 = r1;
  Term _scratch_1 = r2;
  Term _why_1 = r3;
  WL_SPIN
    if (_has_0 == 1) {
      term_sink(e, _why_1);
      _v_6 = 0;
      _v_7 = 2;
      _v_8 = _paths_1;
      _v_9 = _scratch_1;
    } else {
      term_sink(e, _paths_1);
      term_sink(e, _scratch_1);
      _v_6 = 1;
      _v_7 = 4;
      _v_8 = term_ctr(CID_SCON, STAT_OFF + 46);
      _v_9 = _why_1;
    }
  break;
  }
  o[0] = _v_6;
  o[1] = _v_7;
  o[2] = _v_8;
  o[3] = _v_9;
  return 1;
}

INLINE Term spin_37(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_4 = 0;
  Term _v_5 = 0;
  u32 _v_6 = 0;
  Term _v_7 = 0;
  u32 _n_1 = r0;
  Term _rest_1 = r1;
  WL_SPIN
    u32 _v_8 = 0;
    Term _v_9 = 0;
    u32 _v_10 = 0;
    Term _v_11 = 0;
    Term _o_0[4];
    if (spin_34(e, _o_0, 1, _n_1, _rest_1) == 0) {
      return 0;
    }
    _v_8 = _o_0[0];
    _v_9 = _o_0[1];
    _v_10 = _o_0[2];
    _v_11 = _o_0[3];
    _v_4 = _v_8;
    _v_5 = _v_9;
    _v_6 = _v_10;
    _v_7 = _v_11;
  break;
  }
  o[0] = _v_4;
  o[1] = _v_5;
  o[2] = _v_6;
  o[3] = _v_7;
  return 1;
}

INLINE Term spin_38(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  u32 _v_16 = 0;
  Term _v_17 = 0;
  u32 _v_18 = 0;
  Term _v_19 = 0;
  u32 _n_2 = r0;
  Term _rest_2 = r1;
  WL_SPIN
    u32 _v_20 = 0;
    Term _v_21 = 0;
    u32 _v_22 = 0;
    Term _v_23 = 0;
    Term _o_2[4];
    if (spin_34(e, _o_2, 0, _n_2, _rest_2) == 0) {
      return 0;
    }
    _v_20 = _o_2[0];
    _v_21 = _o_2[1];
    _v_22 = _o_2[2];
    _v_23 = _o_2[3];
    _v_16 = _v_20;
    _v_17 = _v_21;
    _v_18 = _v_22;
    _v_19 = _v_23;
  break;
  }
  o[0] = _v_16;
  o[1] = _v_17;
  o[2] = _v_18;
  o[3] = _v_19;
  return 1;
}

INLINE Term spin_40(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_4 = 0;
  Term _xs_1 = r0;
  Term _acc_2 = r1;
  WL_SPIN
    if (term_aux(_xs_1) == CID_NIL) {
      _v_4 = _acc_2;
    } else {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _xs_1, 2, _fb_0);
      Term _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      u64 _nd_1 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
      e.mem[_nd_1 + 0] = _f_0;
      e.mem[_nd_1 + 1] = _acc_2;
      r0 = _f_1;
      r1 = term_ctr(CID_CON, _nd_1);
      _xs_1 = r0;
      _acc_2 = r1;
      WL_AGAIN(spin_40);
    }
  break;
  }
  o[0] = _v_4;
  return 1;
}

INLINE Term spin_39(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_2 = 0;
  Term _xs_0 = r0;
  WL_SPIN
    Term _v_3 = 0;
    Term _o_0[1];
    if (spin_40(e, _o_0, _xs_0, term_pak(CID_NIL, 0)) == 0) {
      return 0;
    }
    _v_3 = _o_0[0];
    _v_2 = _v_3;
  break;
  }
  o[0] = _v_2;
  return 1;
}

INLINE Term spin_41(Env e, THR Term* o, Term r0, u32 r1, Term r2) {
  u32 wpoll = 0;
  u32 _v_9 = 0;
  Term _v_10 = 0;
  Term _fv_0 = r0;
  u32 _fv_1 = r1;
  Term _fv_2 = r2;
  WL_SPIN
    term_sink(e, _fv_0);
    _v_9 = _fv_1;
    _v_10 = _fv_2;
  break;
  }
  o[0] = _v_9;
  o[1] = _v_10;
  return 1;
}

INLINE Term spin_42(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  u32 _v_4 = 0;
  Term _v_5 = 0;
  Term _v_6 = 0;
  Term _v_7 = 0;
  u32 _ok_0 = r0;
  Term _cand_0 = r1;
  Term _tip_2 = r2;
  WL_SPIN
    if (_ok_0 == 1) {
      _v_4 = 4;
      _v_5 = _tip_2;
      _v_6 = _cand_0;
      _v_7 = 0;
    } else {
      term_sink(e, _cand_0);
      term_sink(e, _tip_2);
      _v_4 = 1;
      _v_5 = 4;
      _v_6 = term_ctr(CID_SCON, STAT_OFF + 46);
      _v_7 = term_ctr(CID_SCON, STAT_OFF + 917);
    }
  break;
  }
  o[0] = _v_4;
  o[1] = _v_5;
  o[2] = _v_6;
  o[3] = _v_7;
  return 1;
}

INLINE Term spin_43(Env e, THR Term* o, Term r0, Term r1, Term r2) {
  u32 wpoll = 0;
  u32 _v_6 = 0;
  Term _v_7 = 0;
  Term _v_8 = 0;
  Term _v_9 = 0;
  Term _paths_0 = r0;
  Term _scratch_2 = r1;
  Term _why_2 = r2;
  WL_SPIN
    u32 _v_10 = 0;
    u32 _v_11 = 0;
    Term _o_1[1];
    if (spin_3(e, _o_1, _paths_0) == 0) {
      return 0;
    }
    _v_11 = _o_1[0];
    _v_10 = _v_11;
    u32 _v_12 = 0;
    Term _v_13 = 0;
    Term _v_14 = 0;
    Term _v_15 = 0;
    Term _o_2[4];
    if (spin_36(e, _o_2, _v_10, _paths_0, _scratch_2, _why_2) == 0) {
      return 0;
    }
    _v_12 = _o_2[0];
    _v_13 = _o_2[1];
    _v_14 = _o_2[2];
    _v_15 = _o_2[3];
    _v_6 = _v_12;
    _v_7 = _v_13;
    _v_8 = _v_14;
    _v_9 = _v_15;
  break;
  }
  o[0] = _v_6;
  o[1] = _v_7;
  o[2] = _v_8;
  o[3] = _v_9;
  return 1;
}

INLINE Term spin_44(Env e, THR Term* o, u32 r0, u32 r1, Term r2) {
  u32 wpoll = 0;
  u32 _v_4 = 0;
  Term _v_5 = 0;
  u32 _v_6 = 0;
  Term _v_7 = 0;
  u32 _sig_1 = r0;
  u32 _n_0 = r1;
  Term _rest_1 = r2;
  WL_SPIN
    if (_sig_1 == 1) {
      u32 _v_8 = 0;
      Term _v_9 = 0;
      u32 _v_10 = 0;
      Term _v_11 = 0;
      Term _o_0[4];
      if (spin_37(e, _o_0, _n_0, _rest_1) == 0) {
        return 0;
      }
      _v_8 = _o_0[0];
      _v_9 = _o_0[1];
      _v_10 = _o_0[2];
      _v_11 = _o_0[3];
      _v_4 = _v_8;
      _v_5 = _v_9;
      _v_6 = _v_10;
      _v_7 = _v_11;
    } else {
      u32 _v_12 = 0;
      Term _v_13 = 0;
      u32 _v_14 = 0;
      Term _v_15 = 0;
      Term _o_1[4];
      if (spin_38(e, _o_1, _n_0, _rest_1) == 0) {
        return 0;
      }
      _v_12 = _o_1[0];
      _v_13 = _o_1[1];
      _v_14 = _o_1[2];
      _v_15 = _o_1[3];
      _v_4 = _v_12;
      _v_5 = _v_13;
      _v_6 = _v_14;
      _v_7 = _v_15;
    }
  break;
  }
  o[0] = _v_4;
  o[1] = _v_5;
  o[2] = _v_6;
  o[3] = _v_7;
  return 1;
}

INLINE Term spin_46(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_4 = 0;
  u32 _c_0 = r0;
  Term _a_0 = r1;
  Term _b_0 = r2;
  WL_SPIN
    if (_c_0 == 0) {
      term_sink(e, _a_0);
      _v_4 = _b_0;
    } else {
      term_sink(e, _b_0);
      _v_4 = _a_0;
    }
  break;
  }
  o[0] = _v_4;
  return 1;
}

INLINE Term spin_45(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  Term _v_2 = 0;
  u32 _ok_0 = r0;
  Term _why_0 = r1;
  WL_SPIN
    Term _v_3 = 0;
    Term _o_22[1];
    if (spin_46(e, _o_22, _ok_0, term_pak(CID_SNIL, 0), _why_0) == 0) {
      return 0;
    }
    _v_3 = _o_22[0];
    _v_2 = _v_3;
  break;
  }
  o[0] = _v_2;
  return 1;
}

INLINE Term spin_47(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_2 = 0;
  u32 _r_1 = r0;
  Term _r_2 = r1;
  Term _r_3 = r2;
  WL_SPIN
    if (_r_1 == 0) {
      _v_2 = _r_3;
    } else {
      _v_2 = _r_2;
    }
  break;
  }
  o[0] = _v_2;
  return 1;
}

INLINE Term spin_48(Env e, THR Term* o, u32 r0, Term r1, Term r2, Term r3) {
  u32 wpoll = 0;
  Term _v_3 = 0;
  u32 _nothing_0 = r0;
  Term _out_2 = r1;
  Term _worker_2 = r2;
  Term _tip_2 = r3;
  WL_SPIN
    if (_nothing_0 == 1) {
      term_sink(e, _out_2);
      term_sink(e, _tip_2);
      u64 _nd_0 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_0 + 0] = _worker_2;
      _v_3 = term_clo(FID____SRC_GIT_LAND_LD_COMMIT_FAIL_GO_C413, _nd_0);
    } else {
      term_sink(e, _worker_2);
      term_sink(e, _tip_2);
      u64 _nd_2 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_2 + 0] = _out_2;
      _v_3 = term_clo(FID____SRC_GIT_LAND_LD_COMMIT_FAIL_GO_C414, _nd_2);
    }
  break;
  }
  o[0] = _v_3;
  return 1;
}

INLINE Term spin_49(Env e, THR Term* o, u32 r0, u32 r1, Term r2, u32 r3) {
  u32 wpoll = 0;
  u32 _v_4 = 0;
  Term _v_5 = 0;
  u32 _v_6 = 0;
  Term _v_7 = 0;
  u32 _m_0 = r0;
  u32 _m_1 = r1;
  Term _rest_2 = r2;
  u32 _sig_2 = r3;
  WL_SPIN
    if (_m_0 == 0) {
      term_sink(e, _rest_2);
      _v_4 = 1;
      _v_5 = term_ctr(CID_SCON, STAT_OFF + 1211);
      _v_6 = 0;
      _v_7 = 0;
    } else {
      u32 _v_8 = 0;
      Term _v_9 = 0;
      u32 _v_10 = 0;
      Term _v_11 = 0;
      Term _o_0[4];
      if (spin_44(e, _o_0, _sig_2, _m_1, _rest_2) == 0) {
        return 0;
      }
      _v_8 = _o_0[0];
      _v_9 = _o_0[1];
      _v_10 = _o_0[2];
      _v_11 = _o_0[3];
      _v_4 = _v_8;
      _v_5 = _v_9;
      _v_6 = _v_10;
      _v_7 = _v_11;
    }
  break;
  }
  o[0] = _v_4;
  o[1] = _v_5;
  o[2] = _v_6;
  o[3] = _v_7;
  return 1;
}

INLINE Term spin_50(Env e, THR Term* o, u32 r0, Term r1, Term r2, Term r3) {
  u32 wpoll = 0;
  u32 _v_4 = 0;
  Term _v_5 = 0;
  Term _v_6 = 0;
  Term _v_7 = 0;
  u32 _ok_0 = r0;
  Term _out_0 = r1;
  Term _worker_2 = r2;
  Term _tip_2 = r3;
  WL_SPIN
    if (_ok_0 == 1) {
      term_sink(e, _out_0);
      _v_4 = 3;
      _v_5 = _worker_2;
      _v_6 = _tip_2;
      _v_7 = 0;
    } else {
      term_sink(e, _worker_2);
      term_sink(e, _tip_2);
      _v_4 = 1;
      _v_5 = 4;
      _v_6 = term_ctr(CID_SCON, STAT_OFF + 46);
      _v_7 = _out_0;
    }
  break;
  }
  o[0] = _v_4;
  o[1] = _v_5;
  o[2] = _v_6;
  o[3] = _v_7;
  return 1;
}

INLINE Term spin_51(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  u32 _v_4 = 0;
  Term _v_5 = 0;
  Term _v_6 = 0;
  Term _v_7 = 0;
  u32 _ok_0 = r0;
  Term _tip_0 = r1;
  Term _worker_2 = r2;
  WL_SPIN
    if (_ok_0 == 1) {
      _v_4 = 3;
      _v_5 = _worker_2;
      _v_6 = _tip_0;
      _v_7 = 0;
    } else {
      term_sink(e, _tip_0);
      term_sink(e, _worker_2);
      _v_4 = 1;
      _v_5 = 4;
      _v_6 = term_ctr(CID_SCON, STAT_OFF + 46);
      _v_7 = term_ctr(CID_SCON, STAT_OFF + 2124);
    }
  break;
  }
  o[0] = _v_4;
  o[1] = _v_5;
  o[2] = _v_6;
  o[3] = _v_7;
  return 1;
}

INLINE Term spin_52(Env e, THR Term* o, u32 r0, Term r1, Term r2, Term r3) {
  u32 wpoll = 0;
  Term _v_1 = 0;
  u32 _ok_0 = r0;
  Term _repo_1 = r1;
  Term _target_1 = r2;
  Term _worker_1 = r3;
  WL_SPIN
    if (_ok_0 == 1) {
      term_sink(e, _repo_1);
      term_sink(e, _target_1);
      u64 _nd_0 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_0 + 0] = _worker_1;
      _v_1 = term_clo(FID____SRC_GIT_LAND_LD_RESOLVED_OK_C999, _nd_0);
    } else {
      term_sink(e, _repo_1);
      term_sink(e, _target_1);
      u64 _nd_2 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_2 + 0] = _worker_1;
      _v_1 = term_clo(FID____SRC_GIT_LAND_LD_RESOLVED_OK_C1000, _nd_2);
    }
  break;
  }
  o[0] = _v_1;
  return 1;
}

INLINE Term spin_53(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  u32 _v_4 = 0;
  Term _v_5 = 0;
  Term _v_6 = 0;
  Term _v_7 = 0;
  u32 _ok_0 = r0;
  Term _bc_1 = r1;
  Term _path_1 = r2;
  WL_SPIN
    if (_ok_0 == 1) {
      term_sink(e, _bc_1);
      _v_4 = 1;
      _v_5 = 1;
      _v_6 = _path_1;
      _v_7 = 0;
    } else {
      term_sink(e, _path_1);
      _v_4 = 2;
      _v_5 = _bc_1;
      _v_6 = 0;
      _v_7 = 0;
    }
  break;
  }
  o[0] = _v_4;
  o[1] = _v_5;
  o[2] = _v_6;
  o[3] = _v_7;
  return 1;
}

INLINE Term spin_54(Env e, THR Term* o, u32 r0, Term r1, Term r2, Term r3) {
  u32 wpoll = 0;
  u32 _v_4 = 0;
  Term _v_5 = 0;
  Term _v_6 = 0;
  Term _v_7 = 0;
  u32 _ok_0 = r0;
  Term _out_0 = r1;
  Term _bc_1 = r2;
  Term _branch_1 = r3;
  WL_SPIN
    if (_ok_0 == 1) {
      term_sink(e, _out_0);
      term_sink(e, _bc_1);
      _v_4 = 1;
      _v_5 = 0;
      _v_6 = _branch_1;
      _v_7 = 0;
    } else {
      term_sink(e, _out_0);
      term_sink(e, _branch_1);
      _v_4 = 2;
      _v_5 = _bc_1;
      _v_6 = 0;
      _v_7 = 0;
    }
  break;
  }
  o[0] = _v_4;
  o[1] = _v_5;
  o[2] = _v_6;
  o[3] = _v_7;
  return 1;
}

INLINE Term spin_55(Env e, THR Term* o) {
  u32 wpoll = 0;
  Term _v_1 = 0;
  WL_SPIN
    _v_1 = term_clo(FID____SRC_GIT_LAND_LD_UNREACH_C1196, 0);
  break;
  }
  o[0] = _v_1;
  return 1;
}

INLINE Term spin_56(Env e, THR Term* o, u32 r0, Term r1, Term r2, Term r3, Term r4, Term r5) {
  u32 wpoll = 0;
  Term _v_1 = 0;
  u32 _g_0 = r0;
  Term _g_1 = r1;
  Term _g_2 = r2;
  Term _repo_5 = r3;
  Term _target_5 = r4;
  Term _worker_5 = r5;
  WL_SPIN
    if (_g_0 == 0) {
      term_sink(e, _g_2);
      Term _v_2 = 0;
      Term _o_3[1];
      if (spin_52(e, _o_3, U32_BIN(_g_1, ==, 0ull), _repo_5, _target_5, _worker_5) == 0) {
        return 0;
      }
      _v_2 = _o_3[0];
      _v_1 = _v_2;
    } else {
      term_sink(e, _repo_5);
      term_sink(e, _target_5);
      term_sink(e, _worker_5);
      u64 _nd_6 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_6 + 0] = _g_1;
      _v_1 = term_clo(FID____SRC_GIT_LAND_LD_RESOLVED_PICK_C1259, _nd_6);
    }
  break;
  }
  o[0] = _v_1;
  return 1;
}

INLINE Term spin_57(Env e, THR Term* o, u32 r0, Term r1, u32 r2, Term r3, Term r4, Term r5) {
  u32 wpoll = 0;
  u32 _v_8 = 0;
  Term _v_9 = 0;
  Term _v_10 = 0;
  Term _v_11 = 0;
  u32 _r_0 = r0;
  Term _r_1 = r1;
  u32 _r_2 = r2;
  Term _r_3 = r3;
  Term _bc_5 = r4;
  Term _path_5 = r5;
  WL_SPIN
    if (_r_0 == 0) {
      if (_r_1 == 0) {
        term_sink(e, _r_3);
        u32 _v_12 = 0;
        Term _v_13 = 0;
        Term _v_14 = 0;
        Term _v_15 = 0;
        Term _o_8[4];
        if (spin_53(e, _o_8, U32_BIN(_r_2, ==, 0ull), _bc_5, _path_5) == 0) {
          return 0;
        }
        _v_12 = _o_8[0];
        _v_13 = _o_8[1];
        _v_14 = _o_8[2];
        _v_15 = _o_8[3];
        _v_8 = _v_12;
        _v_9 = _v_13;
        _v_10 = _v_14;
        _v_11 = _v_15;
      } else {
        term_sink(e, _r_3);
        term_sink(e, _path_5);
        _v_8 = 2;
        _v_9 = _bc_5;
        _v_10 = 0;
        _v_11 = 0;
      }
    } else {
      term_sink(e, _bc_5);
      term_sink(e, _path_5);
      _v_8 = 1;
      _v_9 = 4;
      _v_10 = term_ctr(CID_SCON, STAT_OFF + 2260);
      _v_11 = _r_1;
    }
  break;
  }
  o[0] = _v_8;
  o[1] = _v_9;
  o[2] = _v_10;
  o[3] = _v_11;
  return 1;
}

INLINE Term spin_58(Env e, THR Term* o, u32 r0, Term r1, Term r2, Term r3, Term r4) {
  u32 wpoll = 0;
  u32 _v_8 = 0;
  Term _v_9 = 0;
  Term _v_10 = 0;
  Term _v_11 = 0;
  u32 _r_0 = r0;
  Term _r_1 = r1;
  Term _r_2 = r2;
  Term _bc_6 = r3;
  Term _branch_6 = r4;
  WL_SPIN
    if (_r_0 == 0) {
      u32 _v_12 = 0;
      Term _v_13 = 0;
      Term _v_14 = 0;
      Term _v_15 = 0;
      Term _o_6[4];
      if (spin_54(e, _o_6, U32_BIN(_r_1, ==, 0ull), _r_2, _bc_6, _branch_6) == 0) {
        return 0;
      }
      _v_12 = _o_6[0];
      _v_13 = _o_6[1];
      _v_14 = _o_6[2];
      _v_15 = _o_6[3];
      _v_8 = _v_12;
      _v_9 = _v_13;
      _v_10 = _v_14;
      _v_11 = _v_15;
    } else {
      term_sink(e, _bc_6);
      term_sink(e, _branch_6);
      _v_8 = 1;
      _v_9 = 4;
      _v_10 = term_ctr(CID_SCON, STAT_OFF + 2260);
      _v_11 = _r_1;
    }
  break;
  }
  o[0] = _v_8;
  o[1] = _v_9;
  o[2] = _v_10;
  o[3] = _v_11;
  return 1;
}

INLINE Term spin_59(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_5 = 0;
  u32 _c_1 = r0;
  Term _a_0 = r1;
  Term _b_0 = r2;
  WL_SPIN
    if (_c_1 == 0) {
      term_sink(e, _a_0);
      _v_5 = _b_0;
    } else {
      term_sink(e, _b_0);
      _v_5 = _a_0;
    }
  break;
  }
  o[0] = _v_5;
  return 1;
}

INLINE Term spin_60(Env e, THR Term* o, u32 r0, Term r1, Term r2, Term r3) {
  u32 wpoll = 0;
  Term _v_1 = 0;
  u32 _r_0 = r0;
  Term _r_1 = r1;
  Term _r_2 = r2;
  Term _r_3 = r3;
  WL_SPIN
    if (_r_0 == 0) {
      u64 _nd_13 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_13 + 0] = _r_1;
      e.mem[_nd_13 + 1] = _r_2;
      e.mem[_nd_13 + 2] = _r_3;
      _v_1 = term_clo(FID____SRC_GIT_LAND_LD_ANSWER_C1489, _nd_13);
    } else if (_r_0 == 1) {
      u64 _nd_19 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_19 + 0] = _r_1;
      e.mem[_nd_19 + 1] = _r_2;
      e.mem[_nd_19 + 2] = _r_3;
      _v_1 = term_clo(FID____SRC_GIT_LAND_LD_ANSWER_C1490, _nd_19);
    } else if (_r_0 == 2) {
      term_sink(e, _r_1);
      _v_1 = term_clo(FID____SRC_GIT_LAND_LD_ANSWER_C1491, 0);
    } else if (_r_0 == 3) {
      term_sink(e, _r_1);
      term_sink(e, _r_2);
      _v_1 = term_clo(FID____SRC_GIT_LAND_LD_ANSWER_C1492, 0);
    } else if (_r_0 == 4) {
      term_sink(e, _r_1);
      term_sink(e, _r_2);
      _v_1 = term_clo(FID____SRC_GIT_LAND_LD_ANSWER_C1493, 0);
    } else {
      term_sink(e, _r_1);
      term_sink(e, _r_2);
      _v_1 = term_clo(FID____SRC_GIT_LAND_LD_ANSWER_C1494, 0);
    }
  break;
  }
  o[0] = _v_1;
  return 1;
}

INLINE Term spin_61(Env e, THR Term* o, u32 r0) {
  u32 wpoll = 0;
  u32 _v_2 = 0;
  u32 _c_0 = r0;
  WL_SPIN
    u32 _v_3 = 0;
    u32 _v_4 = 0;
    Term _o_0[1];
    if (spin_0(e, _o_0, _c_0) == 0) {
      return 0;
    }
    _v_4 = _o_0[0];
    _v_3 = _v_4;
    Term _v_5 = 0;
    Term _v_6 = 0;
    Term _v_7 = 0;
    Term _o_1[1];
    if (spin_59(e, _o_1, U32_BIN(_v_3, <, 65536ull), 3ull, 4ull) == 0) {
      return 0;
    }
    _v_7 = _o_1[0];
    _v_6 = _v_7;
    Term _v_8 = 0;
    Term _o_2[1];
    if (spin_59(e, _o_2, U32_BIN(_v_3, <, 2048ull), 2ull, _v_6) == 0) {
      return 0;
    }
    _v_8 = _o_2[0];
    _v_5 = _v_8;
    Term _v_9 = 0;
    Term _o_3[1];
    if (spin_59(e, _o_3, U32_BIN(_v_3, <, 128ull), 1ull, _v_5) == 0) {
      return 0;
    }
    _v_9 = _o_3[0];
    _v_2 = _v_9;
  break;
  }
  o[0] = _v_2;
  return 1;
}

INLINE Term spin_62(Env e, THR Term* o, u32 r0, Term r1, Term r2, Term r3) {
  u32 wpoll = 0;
  Term _v_1 = 0;
  u32 _r_0 = r0;
  Term _r_1 = r1;
  Term _r_2 = r2;
  Term _r_3 = r3;
  WL_SPIN
    if (_r_0 == 0) {
      u64 _nd_7 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_7 + 0] = _r_1;
      e.mem[_nd_7 + 1] = _r_2;
      e.mem[_nd_7 + 2] = _r_3;
      _v_1 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C1764, _nd_7);
    } else if (_r_0 == 1) {
      u64 _nd_10 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_10 + 0] = _r_1;
      e.mem[_nd_10 + 1] = _r_2;
      e.mem[_nd_10 + 2] = _r_3;
      _v_1 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C1765, _nd_10);
    } else {
      term_sink(e, _r_1);
      _v_1 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C1766, 0);
    }
  break;
  }
  o[0] = _v_1;
  return 1;
}

INLINE Term spin_63(Env e, THR Term* o, Term r0, u32 r1) {
  u32 wpoll = 0;
  u32 _v_1 = 0;
  Term _s_1 = r0;
  u32 _acc_0 = r1;
  WL_SPIN
    if (term_aux(_s_1) == CID_SNIL) {
      _v_1 = _acc_0;
    } else {
      u64 _sp_0 = term_peek(e, _s_1);
      u32 _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      u32 _v_2 = 0;
      u32 _v_3 = 0;
      Term _o_0[1];
      if (spin_61(e, _o_0, _f_0) == 0) {
        return 0;
      }
      _v_3 = _o_0[0];
      _v_2 = _v_3;
      r0 = _f_1;
      r1 = U32_BIN(_v_2, +, _acc_0);
      _s_1 = r0;
      _acc_0 = r1;
      WL_AGAIN(spin_63);
    }
  break;
  }
  o[0] = _v_1;
  return 1;
}

INLINE Term spin_64(Env e, THR Term* o, u32 r0, Term r1, u32 r2, Term r3) {
  u32 wpoll = 0;
  u32 _v_6 = 0;
  Term _v_7 = 0;
  Term _v_8 = 0;
  u32 _r_0 = r0;
  Term _r_1 = r1;
  u32 _r_2 = r2;
  Term _r_3 = r3;
  WL_SPIN
    if (_r_0 == 0) {
      if (_r_1 == 0) {
        _v_6 = 0;
        _v_7 = _r_2;
        _v_8 = _r_3;
      } else {
        term_sink(e, _r_3);
        _v_6 = 1;
        _v_7 = term_ctr(CID_SCON, STAT_OFF + 3323);
        _v_8 = 0;
      }
    } else {
      _v_6 = 1;
      _v_7 = _r_1;
      _v_8 = 0;
    }
  break;
  }
  o[0] = _v_6;
  o[1] = _v_7;
  o[2] = _v_8;
  return 1;
}

INLINE Term spin_65(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_2 = 0;
  Term _s_0 = r0;
  WL_SPIN
    u32 _v_3 = 0;
    Term _o_0[1];
    if (spin_63(e, _o_0, _s_0, 0ull) == 0) {
      return 0;
    }
    _v_3 = _o_0[0];
    _v_2 = _v_3;
  break;
  }
  o[0] = _v_2;
  return 1;
}

INLINE Term spin_66(Env e, THR Term* o, u32 r0, Term r1, u32 r2, Term r3) {
  u32 wpoll = 0;
  Term _v_2 = 0;
  u32 _r_0 = r0;
  Term _r_1 = r1;
  u32 _r_2 = r2;
  Term _r_3 = r3;
  WL_SPIN
    if (_r_0 == 0) {
      _v_2 = _r_3;
    } else {
      _v_2 = _r_1;
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
  WL_CASE(FID____SRC_GIT_LAND_BLOCK_HAS_GO)
  {
    Term _lines_0 = r0;
    Term _want_0 = r1;
    WL_OPEN
    if (term_aux(_lines_0) == CID_NIL) {
      term_sink(e, _want_0);
      r0 = 0;
      WL_RETN(1);
    } else {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _lines_0, 2, _fb_0);
      Term _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      _want_0 = term_keep(e, _want_0);
      spare_free(e, cls_fit(2), _sp_0);
      if (seq) {
        WL_ROOM(4);
        STK(0) = _f_0;
        STK(1) = _f_1;
        STK(2) = _want_0;
        STK(3) = FID____SRC_GIT_LAND_BLOCK_HAS_GO_K23;
        WL_PUSHN(4);
      } else {
        u64 _t_0 = task_node(e, FID____SRC_GIT_LAND_BLOCK_HAS_GO_K23, WL_CONT, WL_IDX, 1);
        e.mem[_t_0 + 0] = _f_0;
        e.mem[_t_0 + 1] = _f_1;
        e.mem[_t_0 + 2] = _want_0;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_BLOCK_HAS_GO_K23, _t_0);
        WL_IDX = 3;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_EQ)) {
        u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_STR_EQ, WL_CONT, WL_IDX, 0);
        e.mem[_t_1 + 0] = _f_0;
        e.mem[_t_1 + 1] = _want_0;
        return term_tsk(FID____SRC_GIT_TEXT_STR_EQ, _t_1);
      }
      r0 = _f_0;
      r1 = _want_0;
      WL_JMP(FID____SRC_GIT_TEXT_STR_EQ);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_BLOCK_HAS_GO_K23)
  {
    WL_POPN(3);
    Term _f_2 = STK(0);
    Term _f_3 = STK(1);
    Term _want_1 = STK(2);
    u32 _hit_0 = r0;
    WL_OPEN
    term_sink(e, _f_2);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _hit_0;
      STK(1) = FID____SRC_GIT_LAND_BLOCK_HAS_GO_K24;
      WL_PUSHN(2);
    } else {
      u64 _t_2 = task_node(e, FID____SRC_GIT_LAND_BLOCK_HAS_GO_K24, WL_CONT, WL_IDX, 1);
      e.mem[_t_2 + 0] = _hit_0;
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_BLOCK_HAS_GO_K24, _t_2);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_BLOCK_HAS_GO)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_LAND_BLOCK_HAS_GO, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _f_3;
      e.mem[_t_3 + 1] = _want_1;
      return term_tsk(FID____SRC_GIT_LAND_BLOCK_HAS_GO, _t_3);
    }
    r0 = _f_3;
    r1 = _want_1;
    WL_JMP(FID____SRC_GIT_LAND_BLOCK_HAS_GO);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_BLOCK_HAS_GO_K24)
  {
    WL_POPN(1);
    u32 _hit_1 = STK(0);
    u32 _h_0 = r0;
    WL_OPEN
    Term _b_0 = 0;
    if (_h_0 == 0) {
      _b_0 = term_pak(CID_FALSE, 0);
    } else {
      _b_0 = term_pak(CID_TRUE, 0);
    }
    Term _v_0 = 0;
    Term _o_0[1];
    if (spin_1(e, _o_0, _hit_1, term_pak(CID_TRUE, 0), _b_0) == 0) {
      return 0;
    }
    _v_0 = _o_0[0];
    u32 _o_1 = 0;
    if (term_aux(_v_0) == CID_FALSE) {
      _o_1 = 0;
    } else {
      _o_1 = 1;
    }
    r0 = _o_1;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_BLOCK_HAS)
  {
    Term _block_0 = r0;
    Term _want_0 = r1;
    WL_OPEN
    Term _v_0 = 0;
    Term _v_1 = 0;
    Term _o_11[1];
    if (spin_19(e, _o_11, _block_0) == 0) {
      return 0;
    }
    _v_1 = _o_11[0];
    _v_0 = _v_1;
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_BLOCK_HAS_GO)) {
      u64 _t_0 = task_node(e, FID____SRC_GIT_LAND_BLOCK_HAS_GO, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = _v_0;
      e.mem[_t_0 + 1] = _want_0;
      return term_tsk(FID____SRC_GIT_LAND_BLOCK_HAS_GO, _t_0);
    }
    r0 = _v_0;
    r1 = _want_0;
    WL_JMP(FID____SRC_GIT_LAND_BLOCK_HAS_GO);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_NEW_LINES_GO)
  {
    Term _cand_0 = r0;
    Term _targ_0 = r1;
    Term _acc_0 = r2;
    WL_OPEN
    if (term_aux(_cand_0) == CID_NIL) {
      term_sink(e, _targ_0);
      Term _v_0 = 0;
      Term _o_0[1];
      if (spin_14(e, _o_0, _acc_0) == 0) {
        return 0;
      }
      _v_0 = _o_0[0];
      r0 = _v_0;
      WL_RETN(1);
    } else {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _cand_0, 2, _fb_0);
      Term _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      _f_0 = term_keep(e, _f_0);
      spare_free(e, cls_fit(2), _sp_0);
      if (seq) {
        WL_ROOM(5);
        STK(0) = _f_1;
        STK(1) = _acc_0;
        STK(2) = _f_0;
        STK(3) = _targ_0;
        STK(4) = FID____SRC_GIT_LAND_NEW_LINES_GO_K52;
        WL_PUSHN(5);
      } else {
        u64 _t_0 = task_node(e, FID____SRC_GIT_LAND_NEW_LINES_GO_K52, WL_CONT, WL_IDX, 1);
        e.mem[_t_0 + 0] = _f_1;
        e.mem[_t_0 + 1] = _acc_0;
        e.mem[_t_0 + 2] = _f_0;
        e.mem[_t_0 + 3] = _targ_0;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_NEW_LINES_GO_K52, _t_0);
        WL_IDX = 4;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_BLOCK_HAS)) {
        u64 _t_1 = task_node(e, FID____SRC_GIT_LAND_BLOCK_HAS, WL_CONT, WL_IDX, 0);
        e.mem[_t_1 + 0] = _targ_0;
        e.mem[_t_1 + 1] = _f_0;
        return term_tsk(FID____SRC_GIT_LAND_BLOCK_HAS, _t_1);
      }
      r0 = _targ_0;
      r1 = _f_0;
      WL_JMP(FID____SRC_GIT_LAND_BLOCK_HAS);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_NEW_LINES_GO_K52)
  {
    WL_POPN(4);
    Term _f_2 = STK(0);
    Term _acc_1 = STK(1);
    Term _f_3 = STK(2);
    Term _targ_1 = STK(3);
    u32 _h_0 = r0;
    WL_OPEN
    Term _v_1 = 0;
    u32 _v_2 = 0;
    u32 _v_3 = 0;
    Term _o_1[1];
    if (spin_26(e, _o_1, _h_0) == 0) {
      return 0;
    }
    _v_3 = _o_1[0];
    _v_2 = _v_3;
    Term _v_5 = 0;
    Term _o_2[1];
    if (spin_27(e, _o_2, _v_2, _f_3, _acc_1) == 0) {
      return 0;
    }
    _v_5 = _o_2[0];
    _v_1 = _v_5;
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_NEW_LINES_GO)) {
      u64 _t_2 = task_node(e, FID____SRC_GIT_LAND_NEW_LINES_GO, WL_CONT, WL_IDX, 0);
      e.mem[_t_2 + 0] = _f_2;
      e.mem[_t_2 + 1] = _targ_1;
      e.mem[_t_2 + 2] = _v_1;
      return term_tsk(FID____SRC_GIT_LAND_NEW_LINES_GO, _t_2);
    }
    r0 = _f_2;
    r1 = _targ_1;
    r2 = _v_1;
    WL_JMP(FID____SRC_GIT_LAND_NEW_LINES_GO);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_UPDATE_PICK)
  {
    u32 _g_0 = r0;
    Term _g_1 = r1;
    Term _g_2 = r2;
    Term _target_0 = r3;
    Term _cand_0 = r4;
    WL_OPEN
    if (_g_0 == 0) {
      if (seq) {
        WL_ROOM(4);
        STK(0) = _g_1;
        STK(1) = _target_0;
        STK(2) = _cand_0;
        STK(3) = FID____SRC_GIT_LAND_LD_UPDATE_PICK_K69;
        WL_PUSHN(4);
      } else {
        u64 _t_0 = task_node(e, FID____SRC_GIT_LAND_LD_UPDATE_PICK_K69, WL_CONT, WL_IDX, 1);
        e.mem[_t_0 + 0] = _g_1;
        e.mem[_t_0 + 1] = _target_0;
        e.mem[_t_0 + 2] = _cand_0;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_UPDATE_PICK_K69, _t_0);
        WL_IDX = 3;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
        u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
        e.mem[_t_1 + 0] = _g_2;
        return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_1);
      }
      r0 = _g_2;
      WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
    } else {
      term_sink(e, _target_0);
      term_sink(e, _cand_0);
      r0 = 1;
      r1 = 4;
      r2 = term_ctr(CID_SCON, STAT_OFF + 46);
      r3 = _g_1;
      WL_RETN(4);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_UPDATE_PICK_K69)
  {
    WL_POPN(3);
    u32 _g_3 = STK(0);
    Term _target_1 = STK(1);
    Term _cand_1 = STK(2);
    Term _h_0 = r0;
    WL_OPEN
    u32 _v_0 = 0;
    Term _v_1 = 0;
    Term _v_2 = 0;
    Term _v_3 = 0;
    Term _o_0[4];
    if (spin_29(e, _o_0, U32_BIN(_g_3, ==, 0ull), _h_0, _target_1, _cand_1) == 0) {
      return 0;
    }
    _v_0 = _o_0[0];
    _v_1 = _o_0[1];
    _v_2 = _o_0[2];
    _v_3 = _o_0[3];
    r0 = _v_0;
    r1 = _v_1;
    r2 = _v_2;
    r3 = _v_3;
    WL_RETN(4);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_UNJUDGED_LINE)
  {
    Term _side_0 = r0;
    Term _why_0 = r1;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID____SRC_GIT_LAND_UNJUDGED_LINE_K71;
      WL_PUSHN(1);
    } else {
      u64 _t_0 = task_node(e, FID____SRC_GIT_LAND_UNJUDGED_LINE_K71, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_UNJUDGED_LINE_K71, _t_0);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TYPES_STR_CAT3)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_TYPES_STR_CAT3, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _side_0;
      e.mem[_t_1 + 1] = term_ctr(CID_SCON, STAT_OFF + 2);
      e.mem[_t_1 + 2] = _why_0;
      return term_tsk(FID____SRC_GIT_TYPES_STR_CAT3, _t_1);
    }
    r0 = _side_0;
    r1 = term_ctr(CID_SCON, STAT_OFF + 2);
    r2 = _why_0;
    WL_JMP(FID____SRC_GIT_TYPES_STR_CAT3);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_UNJUDGED_LINE_K71)
  {
    Term _h_0 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_2 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_2 + 0] = term_ctr(CID_SCON, STAT_OFF + 233);
      e.mem[_t_2 + 1] = _h_0;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_2);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 233);
    r1 = _h_0;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IS_UNKNOWN_BASE)
  {
    u32 _r_0 = r0;
    u32 _r_1 = r1;
    Term _r_2 = r2;
    Term _r_3 = r3;
    WL_OPEN
    if (_r_0 == 0) {
      if (_r_1 == 2) {
        term_sink(e, _r_2);
        r0 = term_pak(CID_SNIL, 0);
        WL_RETN(1);
      } else {
        if (seq) {
          WL_ROOM(1);
          STK(0) = FID_IS_UNKNOWN_BASE_K115;
          WL_PUSHN(1);
        } else {
          u64 _t_0 = task_node(e, FID_IS_UNKNOWN_BASE_K115, WL_CONT, WL_IDX, 1);
          WL_CONT = term_tsk(FID_IS_UNKNOWN_BASE_K115, _t_0);
          WL_IDX = 0;
        }
        if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TYPES_FAIL_TEXT)) {
          u64 _t_1 = task_node(e, FID____SRC_GIT_TYPES_FAIL_TEXT, WL_CONT, WL_IDX, 0);
          e.mem[_t_1 + 0] = _r_1;
          e.mem[_t_1 + 1] = _r_2;
          e.mem[_t_1 + 2] = _r_3;
          return term_tsk(FID____SRC_GIT_TYPES_FAIL_TEXT, _t_1);
        }
        r0 = _r_1;
        r1 = _r_2;
        r2 = _r_3;
        WL_JMP(FID____SRC_GIT_TYPES_FAIL_TEXT);
      }
    } else {
      term_sink(e, _r_2);
      term_sink(e, _r_3);
      r0 = term_ctr(CID_SCON, STAT_OFF + 569);
      WL_RETN(1);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IS_UNKNOWN_BASE_K115)
  {
    Term _h_0 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_IS_UNKNOWN_BASE_K116;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID_IS_UNKNOWN_BASE_K116, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_IS_UNKNOWN_BASE_K116, _t_2);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _h_0;
      return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_3);
    }
    r0 = _h_0;
    WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IS_UNKNOWN_BASE_K116)
  {
    Term _h_1 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_4 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = term_ctr(CID_SCON, STAT_OFF + 489);
      e.mem[_t_4 + 1] = _h_1;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_4);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 489);
    r1 = _h_1;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_PAIR_NEWS)
  {
    Term _pv_0 = r0;
    u32 _pv_1 = r1;
    Term _pv_2 = r2;
    u32 _pv_3 = r3;
    Term _pv_4 = r4;
    Term _acc_0 = r5;
    WL_OPEN
    if (_pv_1 == 0) {
      term_sink(e, _pv_4);
      term_sink(e, _pv_0);
      r0 = _acc_0;
      WL_RETN(1);
    } else if (_pv_1 == 1) {
      if (_pv_3 == 0) {
        term_sink(e, _pv_0);
        if (seq) {
          WL_ROOM(2);
          STK(0) = _acc_0;
          STK(1) = FID____SRC_GIT_LAND_PAIR_NEWS_K139;
          WL_PUSHN(2);
        } else {
          u64 _t_0 = task_node(e, FID____SRC_GIT_LAND_PAIR_NEWS_K139, WL_CONT, WL_IDX, 1);
          e.mem[_t_0 + 0] = _acc_0;
          WL_CONT = term_tsk(FID____SRC_GIT_LAND_PAIR_NEWS_K139, _t_0);
          WL_IDX = 1;
        }
        if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
          u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
          e.mem[_t_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 253);
          e.mem[_t_1 + 1] = _pv_2;
          return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_1);
        }
        r0 = term_ctr(CID_SCON, STAT_OFF + 253);
        r1 = _pv_2;
        WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
      } else if (_pv_3 == 1) {
        term_sink(e, _pv_0);
        Term _v_0 = 0;
        Term _v_1 = 0;
        Term _o_0[1];
        if (spin_19(e, _o_0, _pv_2) == 0) {
          return 0;
        }
        _v_1 = _o_0[0];
        _v_0 = _v_1;
        if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_NEW_LINES_GO)) {
          u64 _t_2 = task_node(e, FID____SRC_GIT_LAND_NEW_LINES_GO, WL_CONT, WL_IDX, 0);
          e.mem[_t_2 + 0] = _v_0;
          e.mem[_t_2 + 1] = _pv_4;
          e.mem[_t_2 + 2] = _acc_0;
          return term_tsk(FID____SRC_GIT_LAND_NEW_LINES_GO, _t_2);
        }
        r0 = _v_0;
        r1 = _pv_4;
        r2 = _acc_0;
        WL_JMP(FID____SRC_GIT_LAND_NEW_LINES_GO);
      } else {
        term_sink(e, _pv_2);
        if (seq) {
          WL_ROOM(2);
          STK(0) = _acc_0;
          STK(1) = FID____SRC_GIT_LAND_PAIR_NEWS_K140;
          WL_PUSHN(2);
        } else {
          u64 _t_3 = task_node(e, FID____SRC_GIT_LAND_PAIR_NEWS_K140, WL_CONT, WL_IDX, 1);
          e.mem[_t_3 + 0] = _acc_0;
          WL_CONT = term_tsk(FID____SRC_GIT_LAND_PAIR_NEWS_K140, _t_3);
          WL_IDX = 1;
        }
        if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TYPES_STR_CAT3)) {
          u64 _t_4 = task_node(e, FID____SRC_GIT_TYPES_STR_CAT3, WL_CONT, WL_IDX, 0);
          e.mem[_t_4 + 0] = _pv_0;
          e.mem[_t_4 + 1] = term_ctr(CID_SCON, STAT_OFF + 2);
          e.mem[_t_4 + 2] = _pv_4;
          return term_tsk(FID____SRC_GIT_TYPES_STR_CAT3, _t_4);
        }
        r0 = _pv_0;
        r1 = term_ctr(CID_SCON, STAT_OFF + 2);
        r2 = _pv_4;
        WL_JMP(FID____SRC_GIT_TYPES_STR_CAT3);
      }
    } else {
      term_sink(e, _pv_4);
      if (seq) {
        WL_ROOM(2);
        STK(0) = _acc_0;
        STK(1) = FID____SRC_GIT_LAND_PAIR_NEWS_K142;
        WL_PUSHN(2);
      } else {
        u64 _t_7 = task_node(e, FID____SRC_GIT_LAND_PAIR_NEWS_K142, WL_CONT, WL_IDX, 1);
        e.mem[_t_7 + 0] = _acc_0;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_PAIR_NEWS_K142, _t_7);
        WL_IDX = 1;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TYPES_STR_CAT3)) {
        u64 _t_8 = task_node(e, FID____SRC_GIT_TYPES_STR_CAT3, WL_CONT, WL_IDX, 0);
        e.mem[_t_8 + 0] = _pv_0;
        e.mem[_t_8 + 1] = term_ctr(CID_SCON, STAT_OFF + 2);
        e.mem[_t_8 + 2] = _pv_2;
        return term_tsk(FID____SRC_GIT_TYPES_STR_CAT3, _t_8);
      }
      r0 = _pv_0;
      r1 = term_ctr(CID_SCON, STAT_OFF + 2);
      r2 = _pv_2;
      WL_JMP(FID____SRC_GIT_TYPES_STR_CAT3);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_PAIR_NEWS_K139)
  {
    WL_POPN(1);
    Term _acc_1 = STK(0);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_0 + 0] = _h_0;
    e.mem[_nd_0 + 1] = _acc_1;
    r0 = term_ctr(CID_CON, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_PAIR_NEWS_K140)
  {
    WL_POPN(1);
    Term _acc_2 = STK(0);
    Term _h_1 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _acc_2;
      STK(1) = FID____SRC_GIT_LAND_PAIR_NEWS_K141;
      WL_PUSHN(2);
    } else {
      u64 _t_5 = task_node(e, FID____SRC_GIT_LAND_PAIR_NEWS_K141, WL_CONT, WL_IDX, 1);
      e.mem[_t_5 + 0] = _acc_2;
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_PAIR_NEWS_K141, _t_5);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_UNJUDGED_LINE)) {
      u64 _t_6 = task_node(e, FID____SRC_GIT_LAND_UNJUDGED_LINE, WL_CONT, WL_IDX, 0);
      e.mem[_t_6 + 0] = term_ctr(CID_SCON, STAT_OFF + 265);
      e.mem[_t_6 + 1] = _h_1;
      return term_tsk(FID____SRC_GIT_LAND_UNJUDGED_LINE, _t_6);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 265);
    r1 = _h_1;
    WL_JMP(FID____SRC_GIT_LAND_UNJUDGED_LINE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_PAIR_NEWS_K141)
  {
    WL_POPN(1);
    Term _acc_3 = STK(0);
    Term _h_2 = r0;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_1 + 0] = _h_2;
    e.mem[_nd_1 + 1] = _acc_3;
    r0 = term_ctr(CID_CON, _nd_1);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_PAIR_NEWS_K142)
  {
    WL_POPN(1);
    Term _acc_4 = STK(0);
    Term _h_3 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _acc_4;
      STK(1) = FID____SRC_GIT_LAND_PAIR_NEWS_K143;
      WL_PUSHN(2);
    } else {
      u64 _t_9 = task_node(e, FID____SRC_GIT_LAND_PAIR_NEWS_K143, WL_CONT, WL_IDX, 1);
      e.mem[_t_9 + 0] = _acc_4;
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_PAIR_NEWS_K143, _t_9);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_UNJUDGED_LINE)) {
      u64 _t_10 = task_node(e, FID____SRC_GIT_LAND_UNJUDGED_LINE, WL_CONT, WL_IDX, 0);
      e.mem[_t_10 + 0] = term_ctr(CID_SCON, STAT_OFF + 399);
      e.mem[_t_10 + 1] = _h_3;
      return term_tsk(FID____SRC_GIT_LAND_UNJUDGED_LINE, _t_10);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 399);
    r1 = _h_3;
    WL_JMP(FID____SRC_GIT_LAND_UNJUDGED_LINE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_PAIR_NEWS_K143)
  {
    WL_POPN(1);
    Term _acc_5 = STK(0);
    Term _h_4 = r0;
    WL_OPEN
    u64 _nd_2 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_2 + 0] = _h_4;
    e.mem[_nd_2 + 1] = _acc_5;
    r0 = term_ctr(CID_CON, _nd_2);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_RUN_VERDICT)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
    u32 _r_2 = r2;
    Term _r_3 = r3;
    Term _file_0 = r4;
    WL_OPEN
    if (_r_0 == 0) {
      if (_r_1 == 0) {
        u32 _s_0 = U32_BIN(_r_2, ==, 0ull);
        if (_s_0 == 1) {
          term_sink(e, _r_3);
          r0 = _file_0;
          r1 = 0;
          r2 = 0;
          WL_RETN(3);
        } else {
          Term _v_0 = 0;
          Term _v_1 = 0;
          Term _o_0[1];
          if (spin_19(e, _o_0, _r_3) == 0) {
            return 0;
          }
          _v_1 = _o_0[0];
          _v_0 = _v_1;
          if (seq) {
            WL_ROOM(3);
            STK(0) = _r_3;
            STK(1) = _file_0;
            STK(2) = FID____SRC_GIT_LAND_RUN_VERDICT_K145;
            WL_PUSHN(3);
          } else {
            u64 _t_0 = task_node(e, FID____SRC_GIT_LAND_RUN_VERDICT_K145, WL_CONT, WL_IDX, 1);
            e.mem[_t_0 + 0] = _r_3;
            e.mem[_t_0 + 1] = _file_0;
            WL_CONT = term_tsk(FID____SRC_GIT_LAND_RUN_VERDICT_K145, _t_0);
            WL_IDX = 2;
          }
          if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_JOIN)) {
            u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_JOIN, WL_CONT, WL_IDX, 0);
            e.mem[_t_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 267);
            e.mem[_t_1 + 1] = _v_0;
            return term_tsk(FID____SRC_GIT_TEXT_JOIN, _t_1);
          }
          r0 = term_ctr(CID_SCON, STAT_OFF + 267);
          r1 = _v_0;
          WL_JMP(FID____SRC_GIT_TEXT_JOIN);
        }
      } else {
        term_sink(e, _r_3);
        r0 = _file_0;
        r1 = 2;
        r2 = term_ctr(CID_SCON, STAT_OFF + 613);
        WL_RETN(3);
      }
    } else {
      r0 = _file_0;
      r1 = 2;
      r2 = _r_1;
      WL_RETN(3);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_RUN_VERDICT_K145)
  {
    WL_POPN(2);
    Term _r_4 = STK(0);
    Term _file_1 = STK(1);
    Term _h_0 = r0;
    WL_OPEN
    term_sink(e, _r_4);
    Term _v_2 = 0;
    u32 _v_3 = 0;
    Term _v_4 = 0;
    Term _o_1[3];
    if (spin_33(e, _o_1, _h_0, _file_1) == 0) {
      return 0;
    }
    _v_2 = _o_1[0];
    _v_3 = _o_1[1];
    _v_4 = _o_1[2];
    r0 = _v_2;
    r1 = _v_3;
    r2 = _v_4;
    WL_RETN(3);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_STARTS_WITH)
  {
    Term _s_0 = r0;
    Term _p_0 = r1;
    WL_OPEN
    WL_SPIN
    if (term_aux(_s_0) == CID_SNIL) {
      if (term_aux(_p_0) == CID_SNIL) {
        r0 = 1;
        WL_RETN(1);
      } else {
        Term _fb_0[2];
        u64 _sp_0 = ctr_take(e, _p_0, 2, _fb_0);
        u32 _f_0 = _fb_0[0];
        Term _f_1 = _fb_0[1];
        term_sink(e, _f_1);
        spare_free(e, cls_fit(2), _sp_0);
        r0 = 0;
        WL_RETN(1);
      }
    } else {
      Term _fb_1[2];
      u64 _sp_1 = ctr_take(e, _s_0, 2, _fb_1);
      u32 _f_2 = _fb_1[0];
      Term _f_3 = _fb_1[1];
      if (term_aux(_p_0) == CID_SNIL) {
        term_sink(e, _f_3);
        spare_free(e, cls_fit(2), _sp_1);
        r0 = 1;
        WL_RETN(1);
      } else {
        Term _fb_2[2];
        u64 _sp_2 = ctr_take(e, _p_0, 2, _fb_2);
        u32 _f_4 = _fb_2[0];
        Term _f_5 = _fb_2[1];
        u32 _v_0 = 0;
        u32 _v_1 = 0;
        Term _o_0[1];
        if (spin_0(e, _o_0, _f_2) == 0) {
          return 0;
        }
        _v_1 = _o_0[0];
        _v_0 = _v_1;
        u32 _v_2 = 0;
        u32 _v_3 = 0;
        Term _o_1[1];
        if (spin_0(e, _o_1, _f_4) == 0) {
          return 0;
        }
        _v_3 = _o_1[0];
        _v_2 = _v_3;
        u32 _eq_0 = U32_BIN(_v_0, ==, _v_2);
        spare_free(e, cls_fit(2), _sp_2);
        spare_free(e, cls_fit(2), _sp_1);
        if (seq) {
          WL_ROOM(2);
          STK(0) = _eq_0;
          STK(1) = FID____SRC_GIT_TEXT_STARTS_WITH_K148;
          WL_PUSHN(2);
        } else {
          u64 _t_0 = task_node(e, FID____SRC_GIT_TEXT_STARTS_WITH_K148, WL_CONT, WL_IDX, 1);
          e.mem[_t_0 + 0] = _eq_0;
          WL_CONT = term_tsk(FID____SRC_GIT_TEXT_STARTS_WITH_K148, _t_0);
          WL_IDX = 1;
        }
        r0 = _f_3;
        r1 = _f_5;
        _s_0 = r0;
        _p_0 = r1;
        WL_AGAIN(FID____SRC_GIT_TEXT_STARTS_WITH);
      }
    }
    WL_SPUN
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_STARTS_WITH_K148)
  {
    WL_POPN(1);
    u32 _eq_1 = STK(0);
    u32 _h_0 = r0;
    WL_OPEN
    Term _b_0 = 0;
    if (_h_0 == 0) {
      _b_0 = term_pak(CID_FALSE, 0);
    } else {
      _b_0 = term_pak(CID_TRUE, 0);
    }
    Term _v_4 = 0;
    Term _o_2[1];
    if (spin_1(e, _o_2, _eq_1, _b_0, term_pak(CID_FALSE, 0)) == 0) {
      return 0;
    }
    _v_4 = _o_2[0];
    u32 _o_3 = 0;
    if (term_aux(_v_4) == CID_FALSE) {
      _o_3 = 0;
    } else {
      _o_3 = 1;
    }
    r0 = _o_3;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IS_BUSY_FAIL)
  {
    u32 _r_0 = r0;
    u32 _r_1 = r1;
    Term _r_2 = r2;
    Term _r_3 = r3;
    WL_OPEN
    if (_r_0 == 0) {
      if (_r_1 == 3) {
        term_sink(e, _r_2);
        r0 = term_pak(CID_SNIL, 0);
        WL_RETN(1);
      } else {
        if (seq) {
          WL_ROOM(1);
          STK(0) = FID_IS_BUSY_FAIL_K167;
          WL_PUSHN(1);
        } else {
          u64 _t_0 = task_node(e, FID_IS_BUSY_FAIL_K167, WL_CONT, WL_IDX, 1);
          WL_CONT = term_tsk(FID_IS_BUSY_FAIL_K167, _t_0);
          WL_IDX = 0;
        }
        if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TYPES_FAIL_TEXT)) {
          u64 _t_1 = task_node(e, FID____SRC_GIT_TYPES_FAIL_TEXT, WL_CONT, WL_IDX, 0);
          e.mem[_t_1 + 0] = _r_1;
          e.mem[_t_1 + 1] = _r_2;
          e.mem[_t_1 + 2] = _r_3;
          return term_tsk(FID____SRC_GIT_TYPES_FAIL_TEXT, _t_1);
        }
        r0 = _r_1;
        r1 = _r_2;
        r2 = _r_3;
        WL_JMP(FID____SRC_GIT_TYPES_FAIL_TEXT);
      }
    } else {
      if (_r_1 == 0) {
        term_sink(e, _r_2);
        term_sink(e, _r_3);
        r0 = term_ctr(CID_SCON, STAT_OFF + 835);
        WL_RETN(1);
      } else {
        term_sink(e, _r_2);
        term_sink(e, _r_3);
        r0 = term_ctr(CID_SCON, STAT_OFF + 861);
        WL_RETN(1);
      }
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IS_BUSY_FAIL_K167)
  {
    Term _h_0 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_IS_BUSY_FAIL_K168;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID_IS_BUSY_FAIL_K168, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_IS_BUSY_FAIL_K168, _t_2);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _h_0;
      return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_3);
    }
    r0 = _h_0;
    WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IS_BUSY_FAIL_K168)
  {
    Term _h_1 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_4 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = term_ctr(CID_SCON, STAT_OFF + 789);
      e.mem[_t_4 + 1] = _h_1;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_4);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 789);
    r1 = _h_1;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_PAIRS_NEWS_GO)
  {
    Term _pvs_0 = r0;
    Term _acc_0 = r1;
    WL_OPEN
    if (term_aux(_pvs_0) == CID_NIL) {
      Term _v_0 = 0;
      Term _o_0[1];
      if (spin_14(e, _o_0, _acc_0) == 0) {
        return 0;
      }
      _v_0 = _o_0[0];
      r0 = _v_0;
      WL_RETN(1);
    } else {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _pvs_0, 2, _fb_0);
      Term _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      u64 _sp_1 = term_loc(_f_0);
      Term _f_2 = e.mem[_sp_1 + 0];
      u32 _f_3 = e.mem[_sp_1 + 1];
      Term _f_4 = e.mem[_sp_1 + 2];
      u32 _f_5 = e.mem[_sp_1 + 3];
      Term _f_6 = e.mem[_sp_1 + 4];
      heap_free(e, cls_fit(5), _sp_1);
      spare_free(e, cls_fit(2), _sp_0);
      if (seq) {
        WL_ROOM(2);
        STK(0) = _f_1;
        STK(1) = FID____SRC_GIT_LAND_PAIRS_NEWS_GO_K194;
        WL_PUSHN(2);
      } else {
        u64 _t_0 = task_node(e, FID____SRC_GIT_LAND_PAIRS_NEWS_GO_K194, WL_CONT, WL_IDX, 1);
        e.mem[_t_0 + 0] = _f_1;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_PAIRS_NEWS_GO_K194, _t_0);
        WL_IDX = 1;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_PAIR_NEWS)) {
        u64 _t_1 = task_node(e, FID____SRC_GIT_LAND_PAIR_NEWS, WL_CONT, WL_IDX, 0);
        e.mem[_t_1 + 0] = _f_2;
        e.mem[_t_1 + 1] = _f_3;
        e.mem[_t_1 + 2] = _f_4;
        e.mem[_t_1 + 3] = _f_5;
        e.mem[_t_1 + 4] = _f_6;
        e.mem[_t_1 + 5] = _acc_0;
        return term_tsk(FID____SRC_GIT_LAND_PAIR_NEWS, _t_1);
      }
      r0 = _f_2;
      r1 = _f_3;
      r2 = _f_4;
      r3 = _f_5;
      r4 = _f_6;
      r5 = _acc_0;
      WL_JMP(FID____SRC_GIT_LAND_PAIR_NEWS);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_PAIRS_NEWS_GO_K194)
  {
    WL_POPN(1);
    Term _f_7 = STK(0);
    Term _h_0 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_PAIRS_NEWS_GO)) {
      u64 _t_2 = task_node(e, FID____SRC_GIT_LAND_PAIRS_NEWS_GO, WL_CONT, WL_IDX, 0);
      e.mem[_t_2 + 0] = _f_7;
      e.mem[_t_2 + 1] = _h_0;
      return term_tsk(FID____SRC_GIT_LAND_PAIRS_NEWS_GO, _t_2);
    }
    r0 = _f_7;
    r1 = _h_0;
    WL_JMP(FID____SRC_GIT_LAND_PAIRS_NEWS_GO);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_RUN_CHECK)
  {
    Term _dir_0 = r0;
    Term _script_0 = r1;
    Term _file_0 = r2;
    WL_OPEN
    Term _v_0 = 0;
    _file_0 = term_keep(e, _file_0);
    Term _v_1 = 0;
    Term _o_0[1];
    if (spin_35(e, _o_0, _script_0, _file_0) == 0) {
      return 0;
    }
    _v_1 = _o_0[0];
    _v_0 = _v_1;
    if (seq) {
      WL_ROOM(2);
      STK(0) = _file_0;
      STK(1) = FID____SRC_GIT_LAND_RUN_CHECK_K198;
      WL_PUSHN(2);
    } else {
      u64 _t_0 = task_node(e, FID____SRC_GIT_LAND_RUN_CHECK_K198, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _file_0;
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_RUN_CHECK_K198, _t_0);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _v_0;
      e.mem[_t_1 + 1] = _dir_0;
      return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_1);
    }
    r0 = _v_0;
    r1 = _dir_0;
    WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_RUN_CHECK_K198)
  {
    WL_POPN(1);
    Term _file_2 = STK(0);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_3 + 0] = _file_2;
    e.mem[_nd_3 + 1] = _h_0;
    r0 = term_clo(FID____SRC_GIT_LAND_RUN_CHECK_C199, _nd_3);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_RUN_CHECK_C199)
  {
    Term _file_3 = r0;
    Term _h_1 = r1;
    Term _x_0 = r2;
    WL_OPEN
    u64 _nd_4 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_4 + 0] = _file_3;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_5 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _h_1;
      e.mem[_t_5 + 1] = term_clo(FID____SRC_GIT_LAND_RUN_CHECK_C200, _nd_4);
      e.mem[_t_5 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_5);
    }
    r0 = _h_1;
    r1 = term_clo(FID____SRC_GIT_LAND_RUN_CHECK_C200, _nd_4);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_RUN_CHECK_C200)
  {
    Term _file_4 = r0;
    Term _x_1 = r1;
    WL_OPEN
    u32 _o_1 = 0;
    Term _o_2 = 0;
    u32 _o_3 = 0;
    Term _o_4 = 0;
    if (term_aux(_x_1) == CID____SRC_GIT_TYPES_RRUN) {
      _o_1 = 0;
      Term _fb_0[3];
      u64 _sp_0 = ctr_take(e, _x_1, 3, _fb_0);
      u32 _f_0 = _fb_0[0];
      u32 _f_1 = _fb_0[1];
      Term _f_2 = _fb_0[2];
      spare_free(e, cls_fit(3), _sp_0);
      _o_2 = _f_0;
      _o_3 = _f_1;
      _o_4 = _f_2;
    } else {
      _o_1 = 1;
      u64 _sp_1 = term_loc(_x_1);
      Term _f_3 = e.mem[_sp_1 + 0];
      heap_free(e, cls_fit(1), _sp_1);
      _o_2 = _f_3;
    }
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID____SRC_GIT_LAND_RUN_CHECK_K201;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID____SRC_GIT_LAND_RUN_CHECK_K201, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_RUN_CHECK_K201, _t_2);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_RUN_VERDICT)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_LAND_RUN_VERDICT, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _o_1;
      e.mem[_t_3 + 1] = _o_2;
      e.mem[_t_3 + 2] = _o_3;
      e.mem[_t_3 + 3] = _o_4;
      e.mem[_t_3 + 4] = _file_4;
      return term_tsk(FID____SRC_GIT_LAND_RUN_VERDICT, _t_3);
    }
    r0 = _o_1;
    r1 = _o_2;
    r2 = _o_3;
    r3 = _o_4;
    r4 = _file_4;
    WL_JMP(FID____SRC_GIT_LAND_RUN_VERDICT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_RUN_CHECK_K201)
  {
    Term _h_2 = r0;
    u32 _h_3 = r1;
    Term _h_4 = r2;
    WL_OPEN
    u64 _nd_5 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_5 + 0] = _h_2;
    e.mem[_nd_5 + 1] = _h_3;
    e.mem[_nd_5 + 2] = _h_4;
    r0 = term_clo(FID____SRC_GIT_LAND_RUN_CHECK_C202, _nd_5);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_RUN_CHECK_C202)
  {
    Term _h_5 = r0;
    u32 _h_6 = r1;
    Term _h_7 = r2;
    Term _x_2 = r3;
    WL_OPEN
    u64 _nd_6 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_6 + 0] = _h_5;
    e.mem[_nd_6 + 1] = _h_6;
    e.mem[_nd_6 + 2] = _h_7;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_4 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = term_ctr(CID____SRC_GIT_LAND_FV, _nd_6);
      e.mem[_t_4 + 1] = _x_2;
      return term_tsk(FID_IO_PURE, _t_4);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_FV, _nd_6);
    r1 = _x_2;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LINE_NOTHING)
  {
    Term _line_0 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STARTS_WITH)) {
      u64 _t_0 = task_node(e, FID____SRC_GIT_TEXT_STARTS_WITH, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = _line_0;
      e.mem[_t_0 + 1] = term_ctr(CID_SCON, STAT_OFF + 893);
      return term_tsk(FID____SRC_GIT_TEXT_STARTS_WITH, _t_0);
    }
    r0 = _line_0;
    r1 = term_ctr(CID_SCON, STAT_OFF + 893);
    WL_JMP(FID____SRC_GIT_TEXT_STARTS_WITH);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_U32_READ_GO)
  {
    Term _s_0 = r0;
    u32 _acc_0 = r1;
    WL_OPEN
    WL_SPIN
    if (term_aux(_s_0) == CID_SNIL) {
      r0 = 1;
      r1 = _acc_0;
      WL_RETN(2);
    } else {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _s_0, 2, _fb_0);
      u32 _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      u32 _n_0 = U32_BIN(U32_BIN(_acc_0, *, 10ull), +, U32_BIN(_f_0, -, 48ull));
      Term _a_0 = 10ull;
      u32 _s_1 = U32_BIN(((u32)(_a_0) == 0 ? 0 : (u64)U32_QUO((u32)(_n_0), (u32)(_a_0))), ==, _acc_0);
      if (_s_1 == 1) {
        spare_free(e, cls_fit(2), _sp_0);
        r0 = _f_1;
        r1 = _n_0;
        _s_0 = r0;
        _acc_0 = r1;
        WL_AGAIN(FID_U32_READ_GO);
      } else {
        term_sink(e, _f_1);
        spare_free(e, cls_fit(2), _sp_0);
        r0 = 0;
        r1 = 0;
        WL_RETN(2);
      }
    }
    WL_SPUN
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_PAIRS_NEWS)
  {
    Term _pvs_0 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_PAIRS_NEWS_GO)) {
      u64 _t_0 = task_node(e, FID____SRC_GIT_LAND_PAIRS_NEWS_GO, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = _pvs_0;
      e.mem[_t_0 + 1] = term_pak(CID_NIL, 0);
      return term_tsk(FID____SRC_GIT_LAND_PAIRS_NEWS_GO, _t_0);
    }
    r0 = _pvs_0;
    r1 = term_pak(CID_NIL, 0);
    WL_JMP(FID____SRC_GIT_LAND_PAIRS_NEWS_GO);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_RUN_PAIR_GO)
  {
    Term _script_0 = r0;
    Term _files_0 = r1;
    Term _candTree_0 = r2;
    Term _targTree_0 = r3;
    Term _acc_0 = r4;
    WL_OPEN
    if (term_aux(_files_0) == CID_NIL) {
      term_sink(e, _script_0);
      term_sink(e, _candTree_0);
      term_sink(e, _targTree_0);
      u64 _nd_0 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_0 + 0] = _acc_0;
      r0 = term_clo(FID____SRC_GIT_LAND_RUN_PAIR_GO_C278, _nd_0);
      WL_RETN(1);
    } else {
      Term _fb_1[2];
      u64 _sp_1 = ctr_take(e, _files_0, 2, _fb_1);
      Term _f_2 = _fb_1[0];
      Term _f_3 = _fb_1[1];
      _candTree_0 = term_keep(e, _candTree_0);
      _script_0 = term_keep(e, _script_0);
      _f_2 = term_keep(e, _f_2);
      spare_free(e, cls_fit(2), _sp_1);
      if (seq) {
        WL_ROOM(7);
        STK(0) = _f_3;
        STK(1) = _acc_0;
        STK(2) = _script_0;
        STK(3) = _candTree_0;
        STK(4) = _targTree_0;
        STK(5) = _f_2;
        STK(6) = FID____SRC_GIT_LAND_RUN_PAIR_GO_K279;
        WL_PUSHN(7);
      } else {
        u64 _t_1 = task_node(e, FID____SRC_GIT_LAND_RUN_PAIR_GO_K279, WL_CONT, WL_IDX, 1);
        e.mem[_t_1 + 0] = _f_3;
        e.mem[_t_1 + 1] = _acc_0;
        e.mem[_t_1 + 2] = _script_0;
        e.mem[_t_1 + 3] = _candTree_0;
        e.mem[_t_1 + 4] = _targTree_0;
        e.mem[_t_1 + 5] = _f_2;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_RUN_PAIR_GO_K279, _t_1);
        WL_IDX = 6;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_RUN_CHECK)) {
        u64 _t_2 = task_node(e, FID____SRC_GIT_LAND_RUN_CHECK, WL_CONT, WL_IDX, 0);
        e.mem[_t_2 + 0] = _candTree_0;
        e.mem[_t_2 + 1] = _script_0;
        e.mem[_t_2 + 2] = _f_2;
        return term_tsk(FID____SRC_GIT_LAND_RUN_CHECK, _t_2);
      }
      r0 = _candTree_0;
      r1 = _script_0;
      r2 = _f_2;
      WL_JMP(FID____SRC_GIT_LAND_RUN_CHECK);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_RUN_PAIR_GO_C278)
  {
    Term _acc_1 = r0;
    Term _x_0 = r1;
    WL_OPEN
    Term _v_0 = 0;
    Term _v_1 = 0;
    Term _o_1[1];
    if (spin_39(e, _o_1, _acc_1) == 0) {
      return 0;
    }
    _v_1 = _o_1[0];
    _v_0 = _v_1;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_0 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = _v_0;
      e.mem[_t_0 + 1] = _x_0;
      return term_tsk(FID_IO_PURE, _t_0);
    }
    r0 = _v_0;
    r1 = _x_0;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_RUN_PAIR_GO_K279)
  {
    WL_POPN(6);
    Term _f_4 = STK(0);
    Term _acc_3 = STK(1);
    Term _script_1 = STK(2);
    Term _candTree_1 = STK(3);
    Term _targTree_1 = STK(4);
    Term _f_5 = STK(5);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_2 = heap_alloc(e, cls_fit(7));
    e.mem[_nd_2 + 0] = _f_4;
    e.mem[_nd_2 + 1] = _acc_3;
    e.mem[_nd_2 + 2] = _script_1;
    e.mem[_nd_2 + 3] = _candTree_1;
    e.mem[_nd_2 + 4] = _targTree_1;
    e.mem[_nd_2 + 5] = _f_5;
    e.mem[_nd_2 + 6] = _h_0;
    r0 = term_clo(FID____SRC_GIT_LAND_RUN_PAIR_GO_C280, _nd_2);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_RUN_PAIR_GO_C280)
  {
    Term _f_6 = r0;
    Term _acc_4 = r1;
    Term _script_2 = r2;
    Term _candTree_2 = r3;
    Term _targTree_2 = r4;
    Term _f_7 = r5;
    Term _h_1 = r6;
    Term _x_1 = r7;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(6));
    e.mem[_nd_3 + 0] = _f_6;
    e.mem[_nd_3 + 1] = _acc_4;
    e.mem[_nd_3 + 2] = _script_2;
    e.mem[_nd_3 + 3] = _candTree_2;
    e.mem[_nd_3 + 4] = _targTree_2;
    e.mem[_nd_3 + 5] = _f_7;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_7 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_7 + 0] = _h_1;
      e.mem[_t_7 + 1] = term_clo(FID____SRC_GIT_LAND_RUN_PAIR_GO_C281, _nd_3);
      e.mem[_t_7 + 2] = _x_1;
      return term_tsk(FID_IO_BIND, _t_7);
    }
    r0 = _h_1;
    r1 = term_clo(FID____SRC_GIT_LAND_RUN_PAIR_GO_C281, _nd_3);
    r2 = _x_1;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_RUN_PAIR_GO_C281)
  {
    Term _f_8 = r0;
    Term _acc_5 = r1;
    Term _script_3 = r2;
    Term _candTree_3 = r3;
    Term _targTree_3 = r4;
    Term _f_9 = r5;
    Term _x_2 = r6;
    WL_OPEN
    u64 _sp_2 = term_loc(_x_2);
    Term _f_10 = e.mem[_sp_2 + 0];
    u32 _f_11 = e.mem[_sp_2 + 1];
    Term _f_12 = e.mem[_sp_2 + 2];
    heap_free(e, cls_fit(3), _sp_2);
    _targTree_3 = term_keep(e, _targTree_3);
    _script_3 = term_keep(e, _script_3);
    _f_9 = term_keep(e, _f_9);
    if (seq) {
      WL_ROOM(10);
      STK(0) = _f_8;
      STK(1) = _acc_5;
      STK(2) = _script_3;
      STK(3) = _candTree_3;
      STK(4) = _targTree_3;
      STK(5) = _f_9;
      STK(6) = _f_10;
      STK(7) = _f_11;
      STK(8) = _f_12;
      STK(9) = FID____SRC_GIT_LAND_RUN_PAIR_GO_K282;
      WL_PUSHN(10);
    } else {
      u64 _t_3 = task_node(e, FID____SRC_GIT_LAND_RUN_PAIR_GO_K282, WL_CONT, WL_IDX, 1);
      e.mem[_t_3 + 0] = _f_8;
      e.mem[_t_3 + 1] = _acc_5;
      e.mem[_t_3 + 2] = _script_3;
      e.mem[_t_3 + 3] = _candTree_3;
      e.mem[_t_3 + 4] = _targTree_3;
      e.mem[_t_3 + 5] = _f_9;
      e.mem[_t_3 + 6] = _f_10;
      e.mem[_t_3 + 7] = _f_11;
      e.mem[_t_3 + 8] = _f_12;
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_RUN_PAIR_GO_K282, _t_3);
      WL_IDX = 9;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_RUN_CHECK)) {
      u64 _t_4 = task_node(e, FID____SRC_GIT_LAND_RUN_CHECK, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = _targTree_3;
      e.mem[_t_4 + 1] = _script_3;
      e.mem[_t_4 + 2] = _f_9;
      return term_tsk(FID____SRC_GIT_LAND_RUN_CHECK, _t_4);
    }
    r0 = _targTree_3;
    r1 = _script_3;
    r2 = _f_9;
    WL_JMP(FID____SRC_GIT_LAND_RUN_CHECK);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_RUN_PAIR_GO_K282)
  {
    WL_POPN(9);
    Term _f_13 = STK(0);
    Term _acc_6 = STK(1);
    Term _script_4 = STK(2);
    Term _candTree_4 = STK(3);
    Term _targTree_4 = STK(4);
    Term _f_14 = STK(5);
    Term _f_15 = STK(6);
    u32 _f_16 = STK(7);
    Term _f_17 = STK(8);
    Term _h_2 = r0;
    WL_OPEN
    u64 _nd_4 = heap_alloc(e, cls_fit(10));
    e.mem[_nd_4 + 0] = _f_13;
    e.mem[_nd_4 + 1] = _acc_6;
    e.mem[_nd_4 + 2] = _script_4;
    e.mem[_nd_4 + 3] = _candTree_4;
    e.mem[_nd_4 + 4] = _targTree_4;
    e.mem[_nd_4 + 5] = _f_14;
    e.mem[_nd_4 + 6] = _f_15;
    e.mem[_nd_4 + 7] = _f_16;
    e.mem[_nd_4 + 8] = _f_17;
    e.mem[_nd_4 + 9] = _h_2;
    r0 = term_clo(FID____SRC_GIT_LAND_RUN_PAIR_GO_C283, _nd_4);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_RUN_PAIR_GO_C283)
  {
    Term _f_18 = r0;
    Term _acc_7 = r1;
    Term _script_5 = r2;
    Term _candTree_5 = r3;
    Term _targTree_5 = r4;
    Term _f_19 = r5;
    Term _f_20 = r6;
    u32 _f_21 = r7;
    Term _f_22 = r8;
    Term _h_3 = r9;
    Term _x_3 = r10;
    WL_OPEN
    u64 _nd_5 = heap_alloc(e, cls_fit(9));
    e.mem[_nd_5 + 0] = _f_18;
    e.mem[_nd_5 + 1] = _acc_7;
    e.mem[_nd_5 + 2] = _script_5;
    e.mem[_nd_5 + 3] = _candTree_5;
    e.mem[_nd_5 + 4] = _targTree_5;
    e.mem[_nd_5 + 5] = _f_19;
    e.mem[_nd_5 + 6] = _f_20;
    e.mem[_nd_5 + 7] = _f_21;
    e.mem[_nd_5 + 8] = _f_22;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_6 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_6 + 0] = _h_3;
      e.mem[_t_6 + 1] = term_clo(FID____SRC_GIT_LAND_RUN_PAIR_GO_C284, _nd_5);
      e.mem[_t_6 + 2] = _x_3;
      return term_tsk(FID_IO_BIND, _t_6);
    }
    r0 = _h_3;
    r1 = term_clo(FID____SRC_GIT_LAND_RUN_PAIR_GO_C284, _nd_5);
    r2 = _x_3;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_RUN_PAIR_GO_C284)
  {
    Term _f_23 = r0;
    Term _acc_8 = r1;
    Term _script_6 = r2;
    Term _candTree_6 = r3;
    Term _targTree_6 = r4;
    Term _f_24 = r5;
    Term _f_25 = r6;
    u32 _f_26 = r7;
    Term _f_27 = r8;
    Term _x_4 = r9;
    WL_OPEN
    u64 _sp_3 = term_loc(_x_4);
    Term _f_28 = e.mem[_sp_3 + 0];
    u32 _f_29 = e.mem[_sp_3 + 1];
    Term _f_30 = e.mem[_sp_3 + 2];
    heap_free(e, cls_fit(3), _sp_3);
    u32 _v_5 = 0;
    Term _v_6 = 0;
    u32 _v_7 = 0;
    Term _v_8 = 0;
    Term _o_2[2];
    if (spin_41(e, _o_2, _f_25, _f_26, _f_27) == 0) {
      return 0;
    }
    _v_7 = _o_2[0];
    _v_8 = _o_2[1];
    _v_5 = _v_7;
    _v_6 = _v_8;
    u32 _v_11 = 0;
    Term _v_12 = 0;
    u32 _v_13 = 0;
    Term _v_14 = 0;
    Term _o_3[2];
    if (spin_41(e, _o_3, _f_28, _f_29, _f_30) == 0) {
      return 0;
    }
    _v_13 = _o_3[0];
    _v_14 = _o_3[1];
    _v_11 = _v_13;
    _v_12 = _v_14;
    u64 _nd_6 = heap_alloc(e, cls_fit(5));
    e.mem[_nd_6 + 0] = _f_24;
    e.mem[_nd_6 + 1] = _v_5;
    e.mem[_nd_6 + 2] = _v_6;
    e.mem[_nd_6 + 3] = _v_11;
    e.mem[_nd_6 + 4] = _v_12;
    u64 _nd_7 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_7 + 0] = term_ctr(CID____SRC_GIT_LAND_PV, _nd_6);
    e.mem[_nd_7 + 1] = _acc_8;
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_RUN_PAIR_GO)) {
      u64 _t_5 = task_node(e, FID____SRC_GIT_LAND_RUN_PAIR_GO, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _script_6;
      e.mem[_t_5 + 1] = _f_23;
      e.mem[_t_5 + 2] = _candTree_6;
      e.mem[_t_5 + 3] = _targTree_6;
      e.mem[_t_5 + 4] = term_ctr(CID_CON, _nd_7);
      return term_tsk(FID____SRC_GIT_LAND_RUN_PAIR_GO, _t_5);
    }
    r0 = _script_6;
    r1 = _f_23;
    r2 = _candTree_6;
    r3 = _targTree_6;
    r4 = term_ctr(CID_CON, _nd_7);
    WL_JMP(FID____SRC_GIT_LAND_RUN_PAIR_GO);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_NOTHING_GO)
  {
    Term _lines_0 = r0;
    WL_OPEN
    if (term_aux(_lines_0) == CID_NIL) {
      r0 = 0;
      WL_RETN(1);
    } else {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _lines_0, 2, _fb_0);
      Term _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      spare_free(e, cls_fit(2), _sp_0);
      if (seq) {
        WL_ROOM(2);
        STK(0) = _f_1;
        STK(1) = FID____SRC_GIT_LAND_NOTHING_GO_K286;
        WL_PUSHN(2);
      } else {
        u64 _t_0 = task_node(e, FID____SRC_GIT_LAND_NOTHING_GO_K286, WL_CONT, WL_IDX, 1);
        e.mem[_t_0 + 0] = _f_1;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_NOTHING_GO_K286, _t_0);
        WL_IDX = 1;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_LINE_NOTHING)) {
        u64 _t_1 = task_node(e, FID____SRC_GIT_LAND_LINE_NOTHING, WL_CONT, WL_IDX, 0);
        e.mem[_t_1 + 0] = _f_0;
        return term_tsk(FID____SRC_GIT_LAND_LINE_NOTHING, _t_1);
      }
      r0 = _f_0;
      WL_JMP(FID____SRC_GIT_LAND_LINE_NOTHING);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_NOTHING_GO_K286)
  {
    WL_POPN(1);
    Term _f_2 = STK(0);
    u32 _h_0 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _h_0;
      STK(1) = FID____SRC_GIT_LAND_NOTHING_GO_K287;
      WL_PUSHN(2);
    } else {
      u64 _t_2 = task_node(e, FID____SRC_GIT_LAND_NOTHING_GO_K287, WL_CONT, WL_IDX, 1);
      e.mem[_t_2 + 0] = _h_0;
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_NOTHING_GO_K287, _t_2);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_NOTHING_GO)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_LAND_NOTHING_GO, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _f_2;
      return term_tsk(FID____SRC_GIT_LAND_NOTHING_GO, _t_3);
    }
    r0 = _f_2;
    WL_JMP(FID____SRC_GIT_LAND_NOTHING_GO);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_NOTHING_GO_K287)
  {
    WL_POPN(1);
    u32 _h_1 = STK(0);
    u32 _h_2 = r0;
    WL_OPEN
    Term _b_0 = 0;
    if (_h_2 == 0) {
      _b_0 = term_pak(CID_FALSE, 0);
    } else {
      _b_0 = term_pak(CID_TRUE, 0);
    }
    Term _v_0 = 0;
    Term _o_0[1];
    if (spin_1(e, _o_0, _h_1, term_pak(CID_TRUE, 0), _b_0) == 0) {
      return 0;
    }
    _v_0 = _o_0[0];
    u32 _o_1 = 0;
    if (term_aux(_v_0) == CID_FALSE) {
      _o_1 = 0;
    } else {
      _o_1 = 1;
    }
    r0 = _o_1;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_CAND_PICK)
  {
    u32 _g_0 = r0;
    Term _g_1 = r1;
    Term _g_2 = r2;
    Term _tip_0 = r3;
    WL_OPEN
    if (_g_0 == 0) {
      if (seq) {
        WL_ROOM(3);
        STK(0) = _g_1;
        STK(1) = _tip_0;
        STK(2) = FID____SRC_GIT_LAND_LD_CAND_PICK_K292;
        WL_PUSHN(3);
      } else {
        u64 _t_0 = task_node(e, FID____SRC_GIT_LAND_LD_CAND_PICK_K292, WL_CONT, WL_IDX, 1);
        e.mem[_t_0 + 0] = _g_1;
        e.mem[_t_0 + 1] = _tip_0;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_CAND_PICK_K292, _t_0);
        WL_IDX = 2;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
        u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
        e.mem[_t_1 + 0] = _g_2;
        return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_1);
      }
      r0 = _g_2;
      WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
    } else {
      term_sink(e, _tip_0);
      r0 = 1;
      r1 = 4;
      r2 = term_ctr(CID_SCON, STAT_OFF + 46);
      r3 = _g_1;
      WL_RETN(4);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_CAND_PICK_K292)
  {
    WL_POPN(2);
    u32 _g_3 = STK(0);
    Term _tip_1 = STK(1);
    Term _h_0 = r0;
    WL_OPEN
    u32 _v_0 = 0;
    Term _v_1 = 0;
    Term _v_2 = 0;
    Term _v_3 = 0;
    Term _o_0[4];
    if (spin_42(e, _o_0, U32_BIN(_g_3, ==, 0ull), _h_0, _tip_1) == 0) {
      return 0;
    }
    _v_0 = _o_0[0];
    _v_1 = _o_0[1];
    _v_2 = _o_0[2];
    _v_3 = _o_0[3];
    r0 = _v_0;
    r1 = _v_1;
    r2 = _v_2;
    r3 = _v_3;
    WL_RETN(4);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_UNMERGED_PICK)
  {
    u32 _g_0 = r0;
    Term _g_1 = r1;
    Term _g_2 = r2;
    Term _scratch_0 = r3;
    Term _why_0 = r4;
    WL_OPEN
    if (_g_0 == 0) {
      Term _v_0 = 0;
      Term _v_1 = 0;
      Term _o_0[1];
      if (spin_19(e, _o_0, _g_2) == 0) {
        return 0;
      }
      _v_1 = _o_0[0];
      _v_0 = _v_1;
      if (seq) {
        WL_ROOM(4);
        STK(0) = _g_2;
        STK(1) = _scratch_0;
        STK(2) = _why_0;
        STK(3) = FID____SRC_GIT_LAND_LD_UNMERGED_PICK_K294;
        WL_PUSHN(4);
      } else {
        u64 _t_0 = task_node(e, FID____SRC_GIT_LAND_LD_UNMERGED_PICK_K294, WL_CONT, WL_IDX, 1);
        e.mem[_t_0 + 0] = _g_2;
        e.mem[_t_0 + 1] = _scratch_0;
        e.mem[_t_0 + 2] = _why_0;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_UNMERGED_PICK_K294, _t_0);
        WL_IDX = 3;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_JOIN)) {
        u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_JOIN, WL_CONT, WL_IDX, 0);
        e.mem[_t_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 267);
        e.mem[_t_1 + 1] = _v_0;
        return term_tsk(FID____SRC_GIT_TEXT_JOIN, _t_1);
      }
      r0 = term_ctr(CID_SCON, STAT_OFF + 267);
      r1 = _v_0;
      WL_JMP(FID____SRC_GIT_TEXT_JOIN);
    } else {
      term_sink(e, _scratch_0);
      term_sink(e, _why_0);
      r0 = 1;
      r1 = 4;
      r2 = term_ctr(CID_SCON, STAT_OFF + 46);
      r3 = _g_1;
      WL_RETN(4);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_UNMERGED_PICK_K294)
  {
    WL_POPN(3);
    Term _g_3 = STK(0);
    Term _scratch_1 = STK(1);
    Term _why_1 = STK(2);
    Term _h_0 = r0;
    WL_OPEN
    term_sink(e, _g_3);
    u32 _v_2 = 0;
    Term _v_3 = 0;
    Term _v_4 = 0;
    Term _v_5 = 0;
    Term _o_3[4];
    if (spin_43(e, _o_3, _h_0, _scratch_1, _why_1) == 0) {
      return 0;
    }
    _v_2 = _o_3[0];
    _v_3 = _o_3[1];
    _v_4 = _o_3[2];
    _v_5 = _o_3[3];
    r0 = _v_2;
    r1 = _v_3;
    r2 = _v_4;
    r3 = _v_5;
    WL_RETN(4);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_U32_READ)
  {
    Term _s_0 = r0;
    WL_OPEN
    if (term_aux(_s_0) == CID_SNIL) {
      r0 = 0;
      r1 = 0;
      WL_RETN(2);
    } else {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _s_0, 2, _fb_0);
      u32 _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      u64 _nd_0 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
      e.mem[_nd_0 + 0] = rfc_seal(e, _f_0);
      e.mem[_nd_0 + 1] = rfc_seal(e, _f_1);
      if (!DEVICE && !seq && fid_nofk(FID_U32_READ_GO)) {
        u64 _t_0 = task_node(e, FID_U32_READ_GO, WL_CONT, WL_IDX, 0);
        e.mem[_t_0 + 0] = term_ctr(CID_SCON, _nd_0);
        e.mem[_t_0 + 1] = 0ull;
        return term_tsk(FID_U32_READ_GO, _t_0);
      }
      r0 = term_ctr(CID_SCON, _nd_0);
      r1 = 0ull;
      WL_JMP(FID_U32_READ_GO);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID_PARENT_OF)
  {
    Term _r_0 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_PARENT_OF_K361;
      WL_PUSHN(1);
    } else {
      u64 _t_0 = task_node(e, FID_PARENT_OF_K361, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_PARENT_OF_K361, _t_0);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _r_0;
      e.mem[_t_1 + 1] = term_ctr(CID_CON, STAT_OFF + 1437);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_1);
    }
    r0 = _r_0;
    r1 = term_ctr(CID_CON, STAT_OFF + 1437);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_PARENT_OF_K361)
  {
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_0 + 0] = _h_0;
    r0 = term_clo(FID_PARENT_OF_C362, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_PARENT_OF_C362)
  {
    Term _h_1 = r0;
    Term _x_0 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_5 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _h_1;
      e.mem[_t_5 + 1] = term_clo(FID_PARENT_OF_C363, 0);
      e.mem[_t_5 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_5);
    }
    r0 = _h_1;
    r1 = term_clo(FID_PARENT_OF_C363, 0);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_PARENT_OF_C363)
  {
    Term _x_1 = r0;
    WL_OPEN
    u32 _o_0 = 0;
    Term _o_1 = 0;
    Term _o_2 = 0;
    if (term_aux(_x_1) == CID____SRC_GIT_TYPES_GRUN) {
      _o_0 = 0;
      u64 _sp_0 = term_loc(_x_1);
      u32 _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      heap_free(e, cls_fit(2), _sp_0);
      _o_1 = _f_0;
      _o_2 = _f_1;
    } else {
      _o_0 = 1;
      u64 _sp_1 = term_loc(_x_1);
      Term _f_2 = e.mem[_sp_1 + 0];
      heap_free(e, cls_fit(1), _sp_1);
      _o_1 = _f_2;
    }
    Term _v_0 = 0;
    Term _v_1 = 0;
    Term _o_3[1];
    if (spin_47(e, _o_3, _o_0, _o_1, _o_2) == 0) {
      return 0;
    }
    _v_1 = _o_3[0];
    _v_0 = _v_1;
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_PARENT_OF_K364;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID_PARENT_OF_K364, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_PARENT_OF_K364, _t_2);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _v_0;
      return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_3);
    }
    r0 = _v_0;
    WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_PARENT_OF_K364)
  {
    Term _h_2 = r0;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_1 + 0] = _h_2;
    r0 = term_clo(FID_PARENT_OF_C365, _nd_1);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_PARENT_OF_C365)
  {
    Term _h_3 = r0;
    Term _x_2 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_4 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = _h_3;
      e.mem[_t_4 + 1] = _x_2;
      return term_tsk(FID_IO_PURE, _t_4);
    }
    r0 = _h_3;
    r1 = _x_2;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_HEAD_OF_BRANCH)
  {
    Term _r_0 = r0;
    Term _branch_0 = r1;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_0 + 0] = _branch_0;
    e.mem[_nd_0 + 1] = term_pak(CID_NIL, 0);
    u64 _nd_1 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 1139);
    e.mem[_nd_1 + 1] = term_ctr(CID_CON, _nd_0);
    u64 _nd_2 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_2 + 0] = term_ctr(CID_SCON, STAT_OFF + 127);
    e.mem[_nd_2 + 1] = term_ctr(CID_CON, _nd_1);
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_HEAD_OF_BRANCH_K367;
      WL_PUSHN(1);
    } else {
      u64 _t_0 = task_node(e, FID_HEAD_OF_BRANCH_K367, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_HEAD_OF_BRANCH_K367, _t_0);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _r_0;
      e.mem[_t_1 + 1] = term_ctr(CID_CON, _nd_2);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_1);
    }
    r0 = _r_0;
    r1 = term_ctr(CID_CON, _nd_2);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_HEAD_OF_BRANCH_K367)
  {
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_3 + 0] = _h_0;
    r0 = term_clo(FID_HEAD_OF_BRANCH_C368, _nd_3);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_HEAD_OF_BRANCH_C368)
  {
    Term _h_1 = r0;
    Term _x_0 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_5 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _h_1;
      e.mem[_t_5 + 1] = term_clo(FID_HEAD_OF_BRANCH_C369, 0);
      e.mem[_t_5 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_5);
    }
    r0 = _h_1;
    r1 = term_clo(FID_HEAD_OF_BRANCH_C369, 0);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_HEAD_OF_BRANCH_C369)
  {
    Term _x_1 = r0;
    WL_OPEN
    u32 _o_0 = 0;
    Term _o_1 = 0;
    Term _o_2 = 0;
    if (term_aux(_x_1) == CID____SRC_GIT_TYPES_GRUN) {
      _o_0 = 0;
      u64 _sp_0 = term_loc(_x_1);
      u32 _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      heap_free(e, cls_fit(2), _sp_0);
      _o_1 = _f_0;
      _o_2 = _f_1;
    } else {
      _o_0 = 1;
      u64 _sp_1 = term_loc(_x_1);
      Term _f_2 = e.mem[_sp_1 + 0];
      heap_free(e, cls_fit(1), _sp_1);
      _o_1 = _f_2;
    }
    Term _v_0 = 0;
    Term _v_1 = 0;
    Term _o_3[1];
    if (spin_47(e, _o_3, _o_0, _o_1, _o_2) == 0) {
      return 0;
    }
    _v_1 = _o_3[0];
    _v_0 = _v_1;
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_HEAD_OF_BRANCH_K370;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID_HEAD_OF_BRANCH_K370, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_HEAD_OF_BRANCH_K370, _t_2);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _v_0;
      return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_3);
    }
    r0 = _v_0;
    WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_HEAD_OF_BRANCH_K370)
  {
    Term _h_2 = r0;
    WL_OPEN
    u64 _nd_4 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_4 + 0] = _h_2;
    r0 = term_clo(FID_HEAD_OF_BRANCH_C371, _nd_4);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_HEAD_OF_BRANCH_C371)
  {
    Term _h_3 = r0;
    Term _x_2 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_4 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = _h_3;
      e.mem[_t_4 + 1] = _x_2;
      return term_tsk(FID_IO_PURE, _t_4);
    }
    r0 = _h_3;
    r1 = _x_2;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_BUSY_BRANCH)
  {
    Term _target_0 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_0 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = term_ctr(CID_SCON, STAT_OFF + 1451);
      e.mem[_t_0 + 1] = _target_0;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_0);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 1451);
    r1 = _target_0;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_BUSY_ANY)
  {
    Term _lines_0 = r0;
    Term _want_0 = r1;
    WL_OPEN
    if (term_aux(_lines_0) == CID_NIL) {
      term_sink(e, _want_0);
      r0 = 0;
      WL_RETN(1);
    } else {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _lines_0, 2, _fb_0);
      Term _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      _want_0 = term_keep(e, _want_0);
      spare_free(e, cls_fit(2), _sp_0);
      if (seq) {
        WL_ROOM(4);
        STK(0) = _f_0;
        STK(1) = _f_1;
        STK(2) = _want_0;
        STK(3) = FID____SRC_GIT_LAND_LD_BUSY_ANY_K374;
        WL_PUSHN(4);
      } else {
        u64 _t_0 = task_node(e, FID____SRC_GIT_LAND_LD_BUSY_ANY_K374, WL_CONT, WL_IDX, 1);
        e.mem[_t_0 + 0] = _f_0;
        e.mem[_t_0 + 1] = _f_1;
        e.mem[_t_0 + 2] = _want_0;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_BUSY_ANY_K374, _t_0);
        WL_IDX = 3;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_EQ)) {
        u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_STR_EQ, WL_CONT, WL_IDX, 0);
        e.mem[_t_1 + 0] = _f_0;
        e.mem[_t_1 + 1] = _want_0;
        return term_tsk(FID____SRC_GIT_TEXT_STR_EQ, _t_1);
      }
      r0 = _f_0;
      r1 = _want_0;
      WL_JMP(FID____SRC_GIT_TEXT_STR_EQ);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_BUSY_ANY_K374)
  {
    WL_POPN(3);
    Term _f_2 = STK(0);
    Term _f_3 = STK(1);
    Term _want_1 = STK(2);
    u32 _hit_0 = r0;
    WL_OPEN
    term_sink(e, _f_2);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _hit_0;
      STK(1) = FID____SRC_GIT_LAND_LD_BUSY_ANY_K375;
      WL_PUSHN(2);
    } else {
      u64 _t_2 = task_node(e, FID____SRC_GIT_LAND_LD_BUSY_ANY_K375, WL_CONT, WL_IDX, 1);
      e.mem[_t_2 + 0] = _hit_0;
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_BUSY_ANY_K375, _t_2);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_LD_BUSY_ANY)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_LAND_LD_BUSY_ANY, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _f_3;
      e.mem[_t_3 + 1] = _want_1;
      return term_tsk(FID____SRC_GIT_LAND_LD_BUSY_ANY, _t_3);
    }
    r0 = _f_3;
    r1 = _want_1;
    WL_JMP(FID____SRC_GIT_LAND_LD_BUSY_ANY);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_BUSY_ANY_K375)
  {
    WL_POPN(1);
    u32 _hit_1 = STK(0);
    u32 _h_0 = r0;
    WL_OPEN
    Term _b_0 = 0;
    if (_h_0 == 0) {
      _b_0 = term_pak(CID_FALSE, 0);
    } else {
      _b_0 = term_pak(CID_TRUE, 0);
    }
    Term _v_0 = 0;
    Term _o_0[1];
    if (spin_1(e, _o_0, _hit_1, term_pak(CID_TRUE, 0), _b_0) == 0) {
      return 0;
    }
    _v_0 = _o_0[0];
    u32 _o_1 = 0;
    if (term_aux(_v_0) == CID_FALSE) {
      _o_1 = 0;
    } else {
      _o_1 = 1;
    }
    r0 = _o_1;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_RUN_PAIRS)
  {
    Term _script_0 = r0;
    Term _files_0 = r1;
    Term _candTree_0 = r2;
    Term _targTree_0 = r3;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_RUN_PAIR_GO)) {
      u64 _t_0 = task_node(e, FID____SRC_GIT_LAND_RUN_PAIR_GO, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = _script_0;
      e.mem[_t_0 + 1] = _files_0;
      e.mem[_t_0 + 2] = _candTree_0;
      e.mem[_t_0 + 3] = _targTree_0;
      e.mem[_t_0 + 4] = term_pak(CID_NIL, 0);
      return term_tsk(FID____SRC_GIT_LAND_RUN_PAIR_GO, _t_0);
    }
    r0 = _script_0;
    r1 = _files_0;
    r2 = _candTree_0;
    r3 = _targTree_0;
    r4 = term_pak(CID_NIL, 0);
    WL_JMP(FID____SRC_GIT_LAND_RUN_PAIR_GO);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_COMMIT_FAIL_GO_C413)
  {
    Term _worker_3 = r0;
    Term _x_0 = r1;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_1 + 0] = 1;
    e.mem[_nd_1 + 1] = _worker_3;
    e.mem[_nd_1 + 2] = 0;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_2 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_2 + 0] = term_ctr(CID____SRC_GIT_LAND_LDDONE, _nd_1);
      e.mem[_t_2 + 1] = _x_0;
      return term_tsk(FID_IO_PURE, _t_2);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDDONE, _nd_1);
    r1 = _x_0;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_COMMIT_FAIL_GO_C414)
  {
    Term _out_3 = r0;
    Term _x_1 = r1;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_3 + 0] = 4;
    e.mem[_nd_3 + 1] = term_ctr(CID_SCON, STAT_OFF + 46);
    e.mem[_nd_3 + 2] = _out_3;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_3 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_3);
      e.mem[_t_3 + 1] = _x_1;
      return term_tsk(FID_IO_PURE, _t_3);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_3);
    r1 = _x_1;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_UNMERGED)
  {
    Term _scratch_0 = r0;
    Term _why_0 = r1;
    WL_OPEN
    _scratch_0 = term_keep(e, _scratch_0);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _scratch_0;
      STK(1) = _why_0;
      STK(2) = FID____SRC_GIT_LAND_LD_UNMERGED_K422;
      WL_PUSHN(3);
    } else {
      u64 _t_0 = task_node(e, FID____SRC_GIT_LAND_LD_UNMERGED_K422, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _scratch_0;
      e.mem[_t_0 + 1] = _why_0;
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_UNMERGED_K422, _t_0);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _scratch_0;
      e.mem[_t_1 + 1] = term_ctr(CID_CON, STAT_OFF + 1513);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_1);
    }
    r0 = _scratch_0;
    r1 = term_ctr(CID_CON, STAT_OFF + 1513);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_UNMERGED_K422)
  {
    WL_POPN(2);
    Term _scratch_1 = STK(0);
    Term _why_1 = STK(1);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_0 + 0] = _scratch_1;
    e.mem[_nd_0 + 1] = _why_1;
    e.mem[_nd_0 + 2] = _h_0;
    r0 = term_clo(FID____SRC_GIT_LAND_LD_UNMERGED_C423, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_UNMERGED_C423)
  {
    Term _scratch_2 = r0;
    Term _why_2 = r1;
    Term _h_1 = r2;
    Term _x_0 = r3;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_1 + 0] = _scratch_2;
    e.mem[_nd_1 + 1] = _why_2;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_5 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _h_1;
      e.mem[_t_5 + 1] = term_clo(FID____SRC_GIT_LAND_LD_UNMERGED_C424, _nd_1);
      e.mem[_t_5 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_5);
    }
    r0 = _h_1;
    r1 = term_clo(FID____SRC_GIT_LAND_LD_UNMERGED_C424, _nd_1);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_UNMERGED_C424)
  {
    Term _scratch_3 = r0;
    Term _why_3 = r1;
    Term _x_1 = r2;
    WL_OPEN
    u32 _o_0 = 0;
    Term _o_1 = 0;
    Term _o_2 = 0;
    if (term_aux(_x_1) == CID____SRC_GIT_TYPES_GRUN) {
      _o_0 = 0;
      u64 _sp_0 = term_loc(_x_1);
      u32 _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      heap_free(e, cls_fit(2), _sp_0);
      _o_1 = _f_0;
      _o_2 = _f_1;
    } else {
      _o_0 = 1;
      u64 _sp_1 = term_loc(_x_1);
      Term _f_2 = e.mem[_sp_1 + 0];
      heap_free(e, cls_fit(1), _sp_1);
      _o_1 = _f_2;
    }
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID____SRC_GIT_LAND_LD_UNMERGED_K425;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID____SRC_GIT_LAND_LD_UNMERGED_K425, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_UNMERGED_K425, _t_2);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_LD_UNMERGED_PICK)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_LAND_LD_UNMERGED_PICK, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _o_0;
      e.mem[_t_3 + 1] = _o_1;
      e.mem[_t_3 + 2] = _o_2;
      e.mem[_t_3 + 3] = _scratch_3;
      e.mem[_t_3 + 4] = _why_3;
      return term_tsk(FID____SRC_GIT_LAND_LD_UNMERGED_PICK, _t_3);
    }
    r0 = _o_0;
    r1 = _o_1;
    r2 = _o_2;
    r3 = _scratch_3;
    r4 = _why_3;
    WL_JMP(FID____SRC_GIT_LAND_LD_UNMERGED_PICK);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_UNMERGED_K425)
  {
    u32 _h_2 = r0;
    Term _h_3 = r1;
    Term _h_4 = r2;
    Term _h_5 = r3;
    WL_OPEN
    u64 _nd_2 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_2 + 0] = _h_2;
    e.mem[_nd_2 + 1] = _h_3;
    e.mem[_nd_2 + 2] = _h_4;
    e.mem[_nd_2 + 3] = _h_5;
    r0 = term_clo(FID____SRC_GIT_LAND_LD_UNMERGED_C426, _nd_2);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_UNMERGED_C426)
  {
    u32 _h_6 = r0;
    Term _h_7 = r1;
    Term _h_8 = r2;
    Term _h_9 = r3;
    Term _x_2 = r4;
    WL_OPEN
    Term _b_0 = 0;
    if (_h_6 == 0) {
      u64 _nd_3 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_3 + 0] = _h_7;
      e.mem[_nd_3 + 1] = _h_8;
      e.mem[_nd_3 + 2] = _h_9;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDDONE, _nd_3);
    } else if (_h_6 == 1) {
      u64 _nd_4 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_4 + 0] = _h_7;
      e.mem[_nd_4 + 1] = _h_8;
      e.mem[_nd_4 + 2] = _h_9;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_4);
    } else if (_h_6 == 2) {
      u64 _nd_5 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_5 + 0] = _h_7;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDWK, _nd_5);
    } else if (_h_6 == 3) {
      u64 _nd_6 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_6 + 0] = _h_7;
      e.mem[_nd_6 + 1] = _h_8;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDTIP, _nd_6);
    } else if (_h_6 == 4) {
      u64 _nd_7 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_7 + 0] = _h_7;
      e.mem[_nd_7 + 1] = _h_8;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDCAND, _nd_7);
    } else {
      u64 _nd_8 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_8 + 0] = _h_7;
      e.mem[_nd_8 + 1] = _h_8;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDRE, _nd_8);
    }
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_4 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = _b_0;
      e.mem[_t_4 + 1] = _x_2;
      return term_tsk(FID_IO_PURE, _t_4);
    }
    r0 = _b_0;
    r1 = _x_2;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_RUN_RES_NUM)
  {
    Term _num_0 = r0;
    Term _rest_0 = r1;
    u32 _sig_0 = r2;
    WL_OPEN
    if (seq) {
      WL_ROOM(3);
      STK(0) = _rest_0;
      STK(1) = _sig_0;
      STK(2) = FID____SRC_GIT_TEXT_RUN_RES_NUM_K429;
      WL_PUSHN(3);
    } else {
      u64 _t_0 = task_node(e, FID____SRC_GIT_TEXT_RUN_RES_NUM_K429, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _rest_0;
      e.mem[_t_0 + 1] = _sig_0;
      WL_CONT = term_tsk(FID____SRC_GIT_TEXT_RUN_RES_NUM_K429, _t_0);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID_U32_READ)) {
      u64 _t_1 = task_node(e, FID_U32_READ, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _num_0;
      return term_tsk(FID_U32_READ, _t_1);
    }
    r0 = _num_0;
    WL_JMP(FID_U32_READ);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_RUN_RES_NUM_K429)
  {
    WL_POPN(2);
    Term _rest_1 = STK(0);
    u32 _sig_1 = STK(1);
    u32 _h_0 = r0;
    u32 _h_1 = r1;
    WL_OPEN
    u32 _v_0 = 0;
    Term _v_1 = 0;
    u32 _v_2 = 0;
    Term _v_3 = 0;
    Term _o_1[4];
    if (spin_49(e, _o_1, _h_0, _h_1, _rest_1, _sig_1) == 0) {
      return 0;
    }
    _v_0 = _o_1[0];
    _v_1 = _o_1[1];
    _v_2 = _o_1[2];
    _v_3 = _o_1[3];
    r0 = _v_0;
    r1 = _v_1;
    r2 = _v_2;
    r3 = _v_3;
    WL_RETN(4);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IS_CONFLICT_FILE)
  {
    u32 _r_0 = r0;
    u32 _r_1 = r1;
    Term _r_2 = r2;
    Term _r_3 = r3;
    Term _want_0 = r4;
    WL_OPEN
    if (_r_0 == 1) {
      if (_r_1 == 2) {
        term_sink(e, _r_3);
        if (seq) {
          WL_ROOM(2);
          STK(0) = _r_2;
          STK(1) = FID_IS_CONFLICT_FILE_K540;
          WL_PUSHN(2);
        } else {
          u64 _t_0 = task_node(e, FID_IS_CONFLICT_FILE_K540, WL_CONT, WL_IDX, 1);
          e.mem[_t_0 + 0] = _r_2;
          WL_CONT = term_tsk(FID_IS_CONFLICT_FILE_K540, _t_0);
          WL_IDX = 1;
        }
        if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_EQ)) {
          u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_STR_EQ, WL_CONT, WL_IDX, 0);
          e.mem[_t_1 + 0] = _r_2;
          e.mem[_t_1 + 1] = _want_0;
          return term_tsk(FID____SRC_GIT_TEXT_STR_EQ, _t_1);
        }
        r0 = _r_2;
        r1 = _want_0;
        WL_JMP(FID____SRC_GIT_TEXT_STR_EQ);
      } else if (_r_1 == 0) {
        term_sink(e, _r_2);
        term_sink(e, _r_3);
        term_sink(e, _want_0);
        r0 = term_ctr(CID_SCON, STAT_OFF + 1963);
        WL_RETN(1);
      } else if (_r_1 == 1) {
        term_sink(e, _r_2);
        term_sink(e, _want_0);
        r0 = term_ctr(CID_SCON, STAT_OFF + 1989);
        WL_RETN(1);
      } else {
        term_sink(e, _want_0);
        if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
          u64 _t_4 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
          e.mem[_t_4 + 0] = term_ctr(CID_SCON, STAT_OFF + 2045);
          e.mem[_t_4 + 1] = _r_2;
          return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_4);
        }
        r0 = term_ctr(CID_SCON, STAT_OFF + 2045);
        r1 = _r_2;
        WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
      }
    } else {
      term_sink(e, _want_0);
      if (seq) {
        WL_ROOM(1);
        STK(0) = FID_IS_CONFLICT_FILE_K542;
        WL_PUSHN(1);
      } else {
        u64 _t_5 = task_node(e, FID_IS_CONFLICT_FILE_K542, WL_CONT, WL_IDX, 1);
        WL_CONT = term_tsk(FID_IS_CONFLICT_FILE_K542, _t_5);
        WL_IDX = 0;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TYPES_FAIL_TEXT)) {
        u64 _t_6 = task_node(e, FID____SRC_GIT_TYPES_FAIL_TEXT, WL_CONT, WL_IDX, 0);
        e.mem[_t_6 + 0] = _r_1;
        e.mem[_t_6 + 1] = _r_2;
        e.mem[_t_6 + 2] = _r_3;
        return term_tsk(FID____SRC_GIT_TYPES_FAIL_TEXT, _t_6);
      }
      r0 = _r_1;
      r1 = _r_2;
      r2 = _r_3;
      WL_JMP(FID____SRC_GIT_TYPES_FAIL_TEXT);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IS_CONFLICT_FILE_K540)
  {
    WL_POPN(1);
    Term _r_4 = STK(0);
    u32 _h_0 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _h_0;
      STK(1) = FID_IS_CONFLICT_FILE_K541;
      WL_PUSHN(2);
    } else {
      u64 _t_2 = task_node(e, FID_IS_CONFLICT_FILE_K541, WL_CONT, WL_IDX, 1);
      e.mem[_t_2 + 0] = _h_0;
      WL_CONT = term_tsk(FID_IS_CONFLICT_FILE_K541, _t_2);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = term_ctr(CID_SCON, STAT_OFF + 1909);
      e.mem[_t_3 + 1] = _r_4;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_3);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 1909);
    r1 = _r_4;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IS_CONFLICT_FILE_K541)
  {
    WL_POPN(1);
    u32 _h_1 = STK(0);
    Term _h_2 = r0;
    WL_OPEN
    Term _v_0 = 0;
    Term _o_0[1];
    if (spin_45(e, _o_0, _h_1, _h_2) == 0) {
      return 0;
    }
    _v_0 = _o_0[0];
    r0 = _v_0;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IS_CONFLICT_FILE_K542)
  {
    Term _h_3 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_IS_CONFLICT_FILE_K543;
      WL_PUSHN(1);
    } else {
      u64 _t_7 = task_node(e, FID_IS_CONFLICT_FILE_K543, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_IS_CONFLICT_FILE_K543, _t_7);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
      u64 _t_8 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
      e.mem[_t_8 + 0] = _h_3;
      return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_8);
    }
    r0 = _h_3;
    WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IS_CONFLICT_FILE_K543)
  {
    Term _h_4 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_9 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_9 + 0] = term_ctr(CID_SCON, STAT_OFF + 2065);
      e.mem[_t_9 + 1] = _h_4;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_9);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 2065);
    r1 = _h_4;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE)
  {
    Term _repo_0 = r0;
    Term _target_0 = r1;
    Term _cand_0 = r2;
    Term _basis_0 = r3;
    Term _scratch_0 = r4;
    u32 _last_0 = r5;
    WL_OPEN
    _repo_0 = term_keep(e, _repo_0);
    if (seq) {
      WL_ROOM(7);
      STK(0) = _repo_0;
      STK(1) = _target_0;
      STK(2) = _cand_0;
      STK(3) = _basis_0;
      STK(4) = _scratch_0;
      STK(5) = _last_0;
      STK(6) = FID____SRC_GIT_LAND_LD_ADVANCE_K721;
      WL_PUSHN(7);
    } else {
      u64 _t_0 = task_node(e, FID____SRC_GIT_LAND_LD_ADVANCE_K721, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _repo_0;
      e.mem[_t_0 + 1] = _target_0;
      e.mem[_t_0 + 2] = _cand_0;
      e.mem[_t_0 + 3] = _basis_0;
      e.mem[_t_0 + 4] = _scratch_0;
      e.mem[_t_0 + 5] = _last_0;
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_ADVANCE_K721, _t_0);
      WL_IDX = 6;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _repo_0;
      e.mem[_t_1 + 1] = term_ctr(CID_CON, STAT_OFF + 2246);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_1);
    }
    r0 = _repo_0;
    r1 = term_ctr(CID_CON, STAT_OFF + 2246);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_K721)
  {
    WL_POPN(6);
    Term _repo_1 = STK(0);
    Term _target_1 = STK(1);
    Term _cand_1 = STK(2);
    Term _basis_1 = STK(3);
    Term _scratch_1 = STK(4);
    u32 _last_1 = STK(5);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(7));
    e.mem[_nd_0 + 0] = _repo_1;
    e.mem[_nd_0 + 1] = _target_1;
    e.mem[_nd_0 + 2] = _cand_1;
    e.mem[_nd_0 + 3] = _basis_1;
    e.mem[_nd_0 + 4] = _scratch_1;
    e.mem[_nd_0 + 5] = _last_1;
    e.mem[_nd_0 + 6] = _h_0;
    r0 = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C722, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_C722)
  {
    Term _repo_2 = r0;
    Term _target_2 = r1;
    Term _cand_2 = r2;
    Term _basis_2 = r3;
    Term _scratch_2 = r4;
    u32 _last_2 = r5;
    Term _h_1 = r6;
    Term _x_0 = r7;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(6));
    e.mem[_nd_1 + 0] = _repo_2;
    e.mem[_nd_1 + 1] = _target_2;
    e.mem[_nd_1 + 2] = _cand_2;
    e.mem[_nd_1 + 3] = _basis_2;
    e.mem[_nd_1 + 4] = _scratch_2;
    e.mem[_nd_1 + 5] = _last_2;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_44 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_44 + 0] = _h_1;
      e.mem[_t_44 + 1] = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C723, _nd_1);
      e.mem[_t_44 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_44);
    }
    r0 = _h_1;
    r1 = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C723, _nd_1);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_C723)
  {
    Term _repo_3 = r0;
    Term _target_3 = r1;
    Term _cand_3 = r2;
    Term _basis_3 = r3;
    Term _scratch_3 = r4;
    u32 _last_3 = r5;
    Term _x_1 = r6;
    WL_OPEN
    u32 _o_0 = 0;
    Term _o_1 = 0;
    Term _o_2 = 0;
    if (term_aux(_x_1) == CID____SRC_GIT_TYPES_GRUN) {
      _o_0 = 0;
      u64 _sp_0 = term_loc(_x_1);
      u32 _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      heap_free(e, cls_fit(2), _sp_0);
      _o_1 = _f_0;
      _o_2 = _f_1;
    } else {
      _o_0 = 1;
      u64 _sp_1 = term_loc(_x_1);
      Term _f_2 = e.mem[_sp_1 + 0];
      heap_free(e, cls_fit(1), _sp_1);
      _o_1 = _f_2;
    }
    if (_o_0 == 0) {
      _target_3 = term_keep(e, _target_3);
      if (seq) {
        WL_ROOM(8);
        STK(0) = _o_2;
        STK(1) = _repo_3;
        STK(2) = _cand_3;
        STK(3) = _basis_3;
        STK(4) = _scratch_3;
        STK(5) = _last_3;
        STK(6) = _target_3;
        STK(7) = FID____SRC_GIT_LAND_LD_ADVANCE_K724;
        WL_PUSHN(8);
      } else {
        u64 _t_2 = task_node(e, FID____SRC_GIT_LAND_LD_ADVANCE_K724, WL_CONT, WL_IDX, 1);
        e.mem[_t_2 + 0] = _o_2;
        e.mem[_t_2 + 1] = _repo_3;
        e.mem[_t_2 + 2] = _cand_3;
        e.mem[_t_2 + 3] = _basis_3;
        e.mem[_t_2 + 4] = _scratch_3;
        e.mem[_t_2 + 5] = _last_3;
        e.mem[_t_2 + 6] = _target_3;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_ADVANCE_K724, _t_2);
        WL_IDX = 7;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_LD_BUSY_BRANCH)) {
        u64 _t_3 = task_node(e, FID____SRC_GIT_LAND_LD_BUSY_BRANCH, WL_CONT, WL_IDX, 0);
        e.mem[_t_3 + 0] = _target_3;
        return term_tsk(FID____SRC_GIT_LAND_LD_BUSY_BRANCH, _t_3);
      }
      r0 = _target_3;
      WL_JMP(FID____SRC_GIT_LAND_LD_BUSY_BRANCH);
    } else {
      term_sink(e, _repo_3);
      term_sink(e, _target_3);
      term_sink(e, _cand_3);
      term_sink(e, _basis_3);
      term_sink(e, _scratch_3);
      u64 _nd_40 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_40 + 0] = _o_1;
      r0 = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C754, _nd_40);
      WL_RETN(1);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_K724)
  {
    WL_POPN(7);
    Term _o_3 = STK(0);
    Term _repo_4 = STK(1);
    Term _cand_4 = STK(2);
    Term _basis_4 = STK(3);
    Term _scratch_4 = STK(4);
    u32 _last_4 = STK(5);
    Term _target_4 = STK(6);
    Term _h_2 = r0;
    WL_OPEN
    Term _v_0 = 0;
    Term _v_1 = 0;
    Term _o_4[1];
    if (spin_19(e, _o_4, _o_3) == 0) {
      return 0;
    }
    _v_1 = _o_4[0];
    _v_0 = _v_1;
    if (seq) {
      WL_ROOM(8);
      STK(0) = _o_3;
      STK(1) = _repo_4;
      STK(2) = _cand_4;
      STK(3) = _basis_4;
      STK(4) = _scratch_4;
      STK(5) = _last_4;
      STK(6) = _target_4;
      STK(7) = FID____SRC_GIT_LAND_LD_ADVANCE_K725;
      WL_PUSHN(8);
    } else {
      u64 _t_4 = task_node(e, FID____SRC_GIT_LAND_LD_ADVANCE_K725, WL_CONT, WL_IDX, 1);
      e.mem[_t_4 + 0] = _o_3;
      e.mem[_t_4 + 1] = _repo_4;
      e.mem[_t_4 + 2] = _cand_4;
      e.mem[_t_4 + 3] = _basis_4;
      e.mem[_t_4 + 4] = _scratch_4;
      e.mem[_t_4 + 5] = _last_4;
      e.mem[_t_4 + 6] = _target_4;
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_ADVANCE_K725, _t_4);
      WL_IDX = 7;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_LD_BUSY_ANY)) {
      u64 _t_5 = task_node(e, FID____SRC_GIT_LAND_LD_BUSY_ANY, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _v_0;
      e.mem[_t_5 + 1] = _h_2;
      return term_tsk(FID____SRC_GIT_LAND_LD_BUSY_ANY, _t_5);
    }
    r0 = _v_0;
    r1 = _h_2;
    WL_JMP(FID____SRC_GIT_LAND_LD_BUSY_ANY);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_K725)
  {
    WL_POPN(7);
    Term _o_5 = STK(0);
    Term _repo_5 = STK(1);
    Term _cand_5 = STK(2);
    Term _basis_5 = STK(3);
    Term _scratch_5 = STK(4);
    u32 _last_5 = STK(5);
    Term _target_5 = STK(6);
    u32 _h_3 = r0;
    WL_OPEN
    term_sink(e, _o_5);
    if (_h_3 == 1) {
      term_sink(e, _repo_5);
      term_sink(e, _cand_5);
      term_sink(e, _basis_5);
      term_sink(e, _scratch_5);
      u64 _nd_2 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_2 + 0] = _target_5;
      r0 = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C726, _nd_2);
      WL_RETN(1);
    } else {
      _target_5 = term_keep(e, _target_5);
      if (seq) {
        WL_ROOM(7);
        STK(0) = _repo_5;
        STK(1) = _target_5;
        STK(2) = _cand_5;
        STK(3) = _basis_5;
        STK(4) = _scratch_5;
        STK(5) = _last_5;
        STK(6) = FID____SRC_GIT_LAND_LD_ADVANCE_K727;
        WL_PUSHN(7);
      } else {
        u64 _t_7 = task_node(e, FID____SRC_GIT_LAND_LD_ADVANCE_K727, WL_CONT, WL_IDX, 1);
        e.mem[_t_7 + 0] = _repo_5;
        e.mem[_t_7 + 1] = _target_5;
        e.mem[_t_7 + 2] = _cand_5;
        e.mem[_t_7 + 3] = _basis_5;
        e.mem[_t_7 + 4] = _scratch_5;
        e.mem[_t_7 + 5] = _last_5;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_ADVANCE_K727, _t_7);
        WL_IDX = 6;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
        u64 _t_8 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
        e.mem[_t_8 + 0] = _target_5;
        e.mem[_t_8 + 1] = term_ctr(CID_SCON, STAT_OFF + 1125);
        return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_8);
      }
      r0 = _target_5;
      r1 = term_ctr(CID_SCON, STAT_OFF + 1125);
      WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_C726)
  {
    Term _target_6 = r0;
    Term _x_2 = r1;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_3 + 0] = 3;
    e.mem[_nd_3 + 1] = _target_6;
    e.mem[_nd_3 + 2] = 0;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_6 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_6 + 0] = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_3);
      e.mem[_t_6 + 1] = _x_2;
      return term_tsk(FID_IO_PURE, _t_6);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_3);
    r1 = _x_2;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_K727)
  {
    WL_POPN(6);
    Term _repo_6 = STK(0);
    Term _target_7 = STK(1);
    Term _cand_6 = STK(2);
    Term _basis_6 = STK(3);
    Term _scratch_6 = STK(4);
    u32 _last_6 = STK(5);
    Term _h_4 = r0;
    WL_OPEN
    u64 _nd_4 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_4 + 0] = _h_4;
    e.mem[_nd_4 + 1] = term_pak(CID_NIL, 0);
    u64 _nd_5 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_5 + 0] = term_ctr(CID_SCON, STAT_OFF + 1139);
    e.mem[_nd_5 + 1] = term_ctr(CID_CON, _nd_4);
    u64 _nd_6 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_6 + 0] = term_ctr(CID_SCON, STAT_OFF + 127);
    e.mem[_nd_6 + 1] = term_ctr(CID_CON, _nd_5);
    _repo_6 = term_keep(e, _repo_6);
    if (seq) {
      WL_ROOM(7);
      STK(0) = _repo_6;
      STK(1) = _target_7;
      STK(2) = _cand_6;
      STK(3) = _basis_6;
      STK(4) = _scratch_6;
      STK(5) = _last_6;
      STK(6) = FID____SRC_GIT_LAND_LD_ADVANCE_K728;
      WL_PUSHN(7);
    } else {
      u64 _t_9 = task_node(e, FID____SRC_GIT_LAND_LD_ADVANCE_K728, WL_CONT, WL_IDX, 1);
      e.mem[_t_9 + 0] = _repo_6;
      e.mem[_t_9 + 1] = _target_7;
      e.mem[_t_9 + 2] = _cand_6;
      e.mem[_t_9 + 3] = _basis_6;
      e.mem[_t_9 + 4] = _scratch_6;
      e.mem[_t_9 + 5] = _last_6;
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_ADVANCE_K728, _t_9);
      WL_IDX = 6;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
      u64 _t_10 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
      e.mem[_t_10 + 0] = _repo_6;
      e.mem[_t_10 + 1] = term_ctr(CID_CON, _nd_6);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_10);
    }
    r0 = _repo_6;
    r1 = term_ctr(CID_CON, _nd_6);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_K728)
  {
    WL_POPN(6);
    Term _repo_7 = STK(0);
    Term _target_8 = STK(1);
    Term _cand_7 = STK(2);
    Term _basis_7 = STK(3);
    Term _scratch_7 = STK(4);
    u32 _last_7 = STK(5);
    Term _h_5 = r0;
    WL_OPEN
    u64 _nd_7 = heap_alloc(e, cls_fit(7));
    e.mem[_nd_7 + 0] = _repo_7;
    e.mem[_nd_7 + 1] = _target_8;
    e.mem[_nd_7 + 2] = _cand_7;
    e.mem[_nd_7 + 3] = _basis_7;
    e.mem[_nd_7 + 4] = _scratch_7;
    e.mem[_nd_7 + 5] = _last_7;
    e.mem[_nd_7 + 6] = _h_5;
    r0 = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C729, _nd_7);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_C729)
  {
    Term _repo_8 = r0;
    Term _target_9 = r1;
    Term _cand_8 = r2;
    Term _basis_8 = r3;
    Term _scratch_8 = r4;
    u32 _last_8 = r5;
    Term _h_6 = r6;
    Term _x_3 = r7;
    WL_OPEN
    u64 _nd_8 = heap_alloc(e, cls_fit(6));
    e.mem[_nd_8 + 0] = _repo_8;
    e.mem[_nd_8 + 1] = _target_9;
    e.mem[_nd_8 + 2] = _cand_8;
    e.mem[_nd_8 + 3] = _basis_8;
    e.mem[_nd_8 + 4] = _scratch_8;
    e.mem[_nd_8 + 5] = _last_8;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_42 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_42 + 0] = _h_6;
      e.mem[_t_42 + 1] = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C730, _nd_8);
      e.mem[_t_42 + 2] = _x_3;
      return term_tsk(FID_IO_BIND, _t_42);
    }
    r0 = _h_6;
    r1 = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C730, _nd_8);
    r2 = _x_3;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_C730)
  {
    Term _repo_9 = r0;
    Term _target_10 = r1;
    Term _cand_9 = r2;
    Term _basis_9 = r3;
    Term _scratch_9 = r4;
    u32 _last_9 = r5;
    Term _x_4 = r6;
    WL_OPEN
    u32 _o_6 = 0;
    Term _o_7 = 0;
    Term _o_8 = 0;
    if (term_aux(_x_4) == CID____SRC_GIT_TYPES_GRUN) {
      _o_6 = 0;
      u64 _sp_2 = term_loc(_x_4);
      u32 _f_3 = e.mem[_sp_2 + 0];
      Term _f_4 = e.mem[_sp_2 + 1];
      heap_free(e, cls_fit(2), _sp_2);
      _o_7 = _f_3;
      _o_8 = _f_4;
    } else {
      _o_6 = 1;
      u64 _sp_3 = term_loc(_x_4);
      Term _f_5 = e.mem[_sp_3 + 0];
      heap_free(e, cls_fit(1), _sp_3);
      _o_7 = _f_5;
    }
    if (_o_6 == 0) {
      if (seq) {
        WL_ROOM(7);
        STK(0) = _repo_9;
        STK(1) = _target_10;
        STK(2) = _cand_9;
        STK(3) = _scratch_9;
        STK(4) = _last_9;
        STK(5) = _basis_9;
        STK(6) = FID____SRC_GIT_LAND_LD_ADVANCE_K731;
        WL_PUSHN(7);
      } else {
        u64 _t_11 = task_node(e, FID____SRC_GIT_LAND_LD_ADVANCE_K731, WL_CONT, WL_IDX, 1);
        e.mem[_t_11 + 0] = _repo_9;
        e.mem[_t_11 + 1] = _target_10;
        e.mem[_t_11 + 2] = _cand_9;
        e.mem[_t_11 + 3] = _scratch_9;
        e.mem[_t_11 + 4] = _last_9;
        e.mem[_t_11 + 5] = _basis_9;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_ADVANCE_K731, _t_11);
        WL_IDX = 6;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
        u64 _t_12 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
        e.mem[_t_12 + 0] = _o_8;
        return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_12);
      }
      r0 = _o_8;
      WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
    } else {
      term_sink(e, _repo_9);
      term_sink(e, _target_10);
      term_sink(e, _cand_9);
      term_sink(e, _basis_9);
      term_sink(e, _scratch_9);
      u64 _nd_38 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_38 + 0] = _o_7;
      r0 = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C753, _nd_38);
      WL_RETN(1);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_K731)
  {
    WL_POPN(6);
    Term _repo_10 = STK(0);
    Term _target_11 = STK(1);
    Term _cand_10 = STK(2);
    Term _scratch_10 = STK(3);
    u32 _last_10 = STK(4);
    Term _basis_10 = STK(5);
    Term _o2_0 = r0;
    WL_OPEN
    _basis_10 = term_keep(e, _basis_10);
    if (seq) {
      WL_ROOM(8);
      STK(0) = _repo_10;
      STK(1) = _target_11;
      STK(2) = _cand_10;
      STK(3) = _scratch_10;
      STK(4) = _last_10;
      STK(5) = _basis_10;
      STK(6) = _o2_0;
      STK(7) = FID____SRC_GIT_LAND_LD_ADVANCE_K732;
      WL_PUSHN(8);
    } else {
      u64 _t_13 = task_node(e, FID____SRC_GIT_LAND_LD_ADVANCE_K732, WL_CONT, WL_IDX, 1);
      e.mem[_t_13 + 0] = _repo_10;
      e.mem[_t_13 + 1] = _target_11;
      e.mem[_t_13 + 2] = _cand_10;
      e.mem[_t_13 + 3] = _scratch_10;
      e.mem[_t_13 + 4] = _last_10;
      e.mem[_t_13 + 5] = _basis_10;
      e.mem[_t_13 + 6] = _o2_0;
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_ADVANCE_K732, _t_13);
      WL_IDX = 7;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_EQ)) {
      u64 _t_14 = task_node(e, FID____SRC_GIT_TEXT_STR_EQ, WL_CONT, WL_IDX, 0);
      e.mem[_t_14 + 0] = _o2_0;
      e.mem[_t_14 + 1] = _basis_10;
      return term_tsk(FID____SRC_GIT_TEXT_STR_EQ, _t_14);
    }
    r0 = _o2_0;
    r1 = _basis_10;
    WL_JMP(FID____SRC_GIT_TEXT_STR_EQ);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_K732)
  {
    WL_POPN(7);
    Term _repo_11 = STK(0);
    Term _target_12 = STK(1);
    Term _cand_11 = STK(2);
    Term _scratch_11 = STK(3);
    u32 _last_11 = STK(4);
    Term _basis_11 = STK(5);
    Term _o2_1 = STK(6);
    u32 _h_7 = r0;
    WL_OPEN
    if (_h_7 == 1) {
      term_sink(e, _o2_1);
      term_sink(e, _scratch_11);
      _target_12 = term_keep(e, _target_12);
      if (seq) {
        WL_ROOM(5);
        STK(0) = _repo_11;
        STK(1) = _target_12;
        STK(2) = _cand_11;
        STK(3) = _basis_11;
        STK(4) = FID____SRC_GIT_LAND_LD_ADVANCE_K733;
        WL_PUSHN(5);
      } else {
        u64 _t_15 = task_node(e, FID____SRC_GIT_LAND_LD_ADVANCE_K733, WL_CONT, WL_IDX, 1);
        e.mem[_t_15 + 0] = _repo_11;
        e.mem[_t_15 + 1] = _target_12;
        e.mem[_t_15 + 2] = _cand_11;
        e.mem[_t_15 + 3] = _basis_11;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_ADVANCE_K733, _t_15);
        WL_IDX = 4;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
        u64 _t_16 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
        e.mem[_t_16 + 0] = term_ctr(CID_SCON, STAT_OFF + 363);
        e.mem[_t_16 + 1] = _target_12;
        return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_16);
      }
      r0 = term_ctr(CID_SCON, STAT_OFF + 363);
      r1 = _target_12;
      WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
    } else {
      term_sink(e, _repo_11);
      term_sink(e, _target_12);
      term_sink(e, _cand_11);
      _o2_1 = term_keep(e, _o2_1);
      _basis_11 = term_keep(e, _basis_11);
      u64 _nd_22 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_22 + 0] = _basis_11;
      e.mem[_nd_22 + 1] = term_pak(CID_NIL, 0);
      u64 _nd_23 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_23 + 0] = _o2_1;
      e.mem[_nd_23 + 1] = term_ctr(CID_CON, _nd_22);
      u64 _nd_24 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_24 + 0] = term_ctr(CID_SCON, STAT_OFF + 341);
      e.mem[_nd_24 + 1] = term_ctr(CID_CON, _nd_23);
      u64 _nd_25 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_25 + 0] = term_ctr(CID_SCON, STAT_OFF + 58);
      e.mem[_nd_25 + 1] = term_ctr(CID_CON, _nd_24);
      _scratch_11 = term_keep(e, _scratch_11);
      if (seq) {
        WL_ROOM(5);
        STK(0) = _basis_11;
        STK(1) = _o2_1;
        STK(2) = _scratch_11;
        STK(3) = _last_11;
        STK(4) = FID____SRC_GIT_LAND_LD_ADVANCE_K739;
        WL_PUSHN(5);
      } else {
        u64 _t_23 = task_node(e, FID____SRC_GIT_LAND_LD_ADVANCE_K739, WL_CONT, WL_IDX, 1);
        e.mem[_t_23 + 0] = _basis_11;
        e.mem[_t_23 + 1] = _o2_1;
        e.mem[_t_23 + 2] = _scratch_11;
        e.mem[_t_23 + 3] = _last_11;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_ADVANCE_K739, _t_23);
        WL_IDX = 4;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
        u64 _t_24 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
        e.mem[_t_24 + 0] = _scratch_11;
        e.mem[_t_24 + 1] = term_ctr(CID_CON, _nd_25);
        return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_24);
      }
      r0 = _scratch_11;
      r1 = term_ctr(CID_CON, _nd_25);
      WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_K733)
  {
    WL_POPN(4);
    Term _repo_12 = STK(0);
    Term _target_13 = STK(1);
    Term _cand_12 = STK(2);
    Term _basis_12 = STK(3);
    Term _h_8 = r0;
    WL_OPEN
    _cand_12 = term_keep(e, _cand_12);
    u64 _nd_9 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_9 + 0] = _basis_12;
    e.mem[_nd_9 + 1] = term_pak(CID_NIL, 0);
    u64 _nd_10 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_10 + 0] = _cand_12;
    e.mem[_nd_10 + 1] = term_ctr(CID_CON, _nd_9);
    u64 _nd_11 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_11 + 0] = _h_8;
    e.mem[_nd_11 + 1] = term_ctr(CID_CON, _nd_10);
    u64 _nd_12 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_12 + 0] = term_ctr(CID_SCON, STAT_OFF + 383);
    e.mem[_nd_12 + 1] = term_ctr(CID_CON, _nd_11);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _target_13;
      STK(1) = _cand_12;
      STK(2) = FID____SRC_GIT_LAND_LD_ADVANCE_K734;
      WL_PUSHN(3);
    } else {
      u64 _t_17 = task_node(e, FID____SRC_GIT_LAND_LD_ADVANCE_K734, WL_CONT, WL_IDX, 1);
      e.mem[_t_17 + 0] = _target_13;
      e.mem[_t_17 + 1] = _cand_12;
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_ADVANCE_K734, _t_17);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
      u64 _t_18 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
      e.mem[_t_18 + 0] = _repo_12;
      e.mem[_t_18 + 1] = term_ctr(CID_CON, _nd_12);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_18);
    }
    r0 = _repo_12;
    r1 = term_ctr(CID_CON, _nd_12);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_K734)
  {
    WL_POPN(2);
    Term _target_14 = STK(0);
    Term _cand_13 = STK(1);
    Term _h_9 = r0;
    WL_OPEN
    u64 _nd_13 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_13 + 0] = _target_14;
    e.mem[_nd_13 + 1] = _cand_13;
    e.mem[_nd_13 + 2] = _h_9;
    r0 = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C735, _nd_13);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_C735)
  {
    Term _target_15 = r0;
    Term _cand_14 = r1;
    Term _h_10 = r2;
    Term _x_5 = r3;
    WL_OPEN
    u64 _nd_14 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_14 + 0] = _target_15;
    e.mem[_nd_14 + 1] = _cand_14;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_22 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_22 + 0] = _h_10;
      e.mem[_t_22 + 1] = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C736, _nd_14);
      e.mem[_t_22 + 2] = _x_5;
      return term_tsk(FID_IO_BIND, _t_22);
    }
    r0 = _h_10;
    r1 = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C736, _nd_14);
    r2 = _x_5;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_C736)
  {
    Term _target_16 = r0;
    Term _cand_15 = r1;
    Term _x_6 = r2;
    WL_OPEN
    u32 _o_9 = 0;
    Term _o_10 = 0;
    Term _o_11 = 0;
    if (term_aux(_x_6) == CID____SRC_GIT_TYPES_GRUN) {
      _o_9 = 0;
      u64 _sp_4 = term_loc(_x_6);
      u32 _f_6 = e.mem[_sp_4 + 0];
      Term _f_7 = e.mem[_sp_4 + 1];
      heap_free(e, cls_fit(2), _sp_4);
      _o_10 = _f_6;
      _o_11 = _f_7;
    } else {
      _o_9 = 1;
      u64 _sp_5 = term_loc(_x_6);
      Term _f_8 = e.mem[_sp_5 + 0];
      heap_free(e, cls_fit(1), _sp_5);
      _o_10 = _f_8;
    }
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID____SRC_GIT_LAND_LD_ADVANCE_K737;
      WL_PUSHN(1);
    } else {
      u64 _t_19 = task_node(e, FID____SRC_GIT_LAND_LD_ADVANCE_K737, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_ADVANCE_K737, _t_19);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_LD_UPDATE_PICK)) {
      u64 _t_20 = task_node(e, FID____SRC_GIT_LAND_LD_UPDATE_PICK, WL_CONT, WL_IDX, 0);
      e.mem[_t_20 + 0] = _o_9;
      e.mem[_t_20 + 1] = _o_10;
      e.mem[_t_20 + 2] = _o_11;
      e.mem[_t_20 + 3] = _target_16;
      e.mem[_t_20 + 4] = _cand_15;
      return term_tsk(FID____SRC_GIT_LAND_LD_UPDATE_PICK, _t_20);
    }
    r0 = _o_9;
    r1 = _o_10;
    r2 = _o_11;
    r3 = _target_16;
    r4 = _cand_15;
    WL_JMP(FID____SRC_GIT_LAND_LD_UPDATE_PICK);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_K737)
  {
    u32 _h_11 = r0;
    Term _h_12 = r1;
    Term _h_13 = r2;
    Term _h_14 = r3;
    WL_OPEN
    u64 _nd_15 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_15 + 0] = _h_11;
    e.mem[_nd_15 + 1] = _h_12;
    e.mem[_nd_15 + 2] = _h_13;
    e.mem[_nd_15 + 3] = _h_14;
    r0 = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C738, _nd_15);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_C738)
  {
    u32 _h_15 = r0;
    Term _h_16 = r1;
    Term _h_17 = r2;
    Term _h_18 = r3;
    Term _x_7 = r4;
    WL_OPEN
    Term _b_0 = 0;
    if (_h_15 == 0) {
      u64 _nd_16 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_16 + 0] = _h_16;
      e.mem[_nd_16 + 1] = _h_17;
      e.mem[_nd_16 + 2] = _h_18;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDDONE, _nd_16);
    } else if (_h_15 == 1) {
      u64 _nd_17 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_17 + 0] = _h_16;
      e.mem[_nd_17 + 1] = _h_17;
      e.mem[_nd_17 + 2] = _h_18;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_17);
    } else if (_h_15 == 2) {
      u64 _nd_18 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_18 + 0] = _h_16;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDWK, _nd_18);
    } else if (_h_15 == 3) {
      u64 _nd_19 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_19 + 0] = _h_16;
      e.mem[_nd_19 + 1] = _h_17;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDTIP, _nd_19);
    } else if (_h_15 == 4) {
      u64 _nd_20 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_20 + 0] = _h_16;
      e.mem[_nd_20 + 1] = _h_17;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDCAND, _nd_20);
    } else {
      u64 _nd_21 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_21 + 0] = _h_16;
      e.mem[_nd_21 + 1] = _h_17;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDRE, _nd_21);
    }
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_21 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_21 + 0] = _b_0;
      e.mem[_t_21 + 1] = _x_7;
      return term_tsk(FID_IO_PURE, _t_21);
    }
    r0 = _b_0;
    r1 = _x_7;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_K739)
  {
    WL_POPN(4);
    Term _basis_13 = STK(0);
    Term _o2_2 = STK(1);
    Term _scratch_12 = STK(2);
    u32 _last_12 = STK(3);
    Term _h_19 = r0;
    WL_OPEN
    u64 _nd_26 = heap_alloc(e, cls_fit(5));
    e.mem[_nd_26 + 0] = _basis_13;
    e.mem[_nd_26 + 1] = _o2_2;
    e.mem[_nd_26 + 2] = _scratch_12;
    e.mem[_nd_26 + 3] = _last_12;
    e.mem[_nd_26 + 4] = _h_19;
    r0 = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C740, _nd_26);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_C740)
  {
    Term _basis_14 = r0;
    Term _o2_3 = r1;
    Term _scratch_13 = r2;
    u32 _last_13 = r3;
    Term _h_20 = r4;
    Term _x_8 = r5;
    WL_OPEN
    u64 _nd_27 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_27 + 0] = _basis_14;
    e.mem[_nd_27 + 1] = _o2_3;
    e.mem[_nd_27 + 2] = _scratch_13;
    e.mem[_nd_27 + 3] = _last_13;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_40 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_40 + 0] = _h_20;
      e.mem[_t_40 + 1] = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C741, _nd_27);
      e.mem[_t_40 + 2] = _x_8;
      return term_tsk(FID_IO_BIND, _t_40);
    }
    r0 = _h_20;
    r1 = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C741, _nd_27);
    r2 = _x_8;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_C741)
  {
    Term _basis_15 = r0;
    Term _o2_4 = r1;
    Term _scratch_14 = r2;
    u32 _last_14 = r3;
    Term _x_9 = r4;
    WL_OPEN
    u32 _o_12 = 0;
    Term _o_13 = 0;
    Term _o_14 = 0;
    if (term_aux(_x_9) == CID____SRC_GIT_TYPES_GRUN) {
      _o_12 = 0;
      u64 _sp_6 = term_loc(_x_9);
      u32 _f_9 = e.mem[_sp_6 + 0];
      Term _f_10 = e.mem[_sp_6 + 1];
      heap_free(e, cls_fit(2), _sp_6);
      _o_13 = _f_9;
      _o_14 = _f_10;
    } else {
      _o_12 = 1;
      u64 _sp_7 = term_loc(_x_9);
      Term _f_11 = e.mem[_sp_7 + 0];
      heap_free(e, cls_fit(1), _sp_7);
      _o_13 = _f_11;
    }
    if (_o_12 == 0) {
      if (seq) {
        WL_ROOM(6);
        STK(0) = _o_13;
        STK(1) = _basis_15;
        STK(2) = _o2_4;
        STK(3) = _scratch_14;
        STK(4) = _last_14;
        STK(5) = FID____SRC_GIT_LAND_LD_ADVANCE_K742;
        WL_PUSHN(6);
      } else {
        u64 _t_25 = task_node(e, FID____SRC_GIT_LAND_LD_ADVANCE_K742, WL_CONT, WL_IDX, 1);
        e.mem[_t_25 + 0] = _o_13;
        e.mem[_t_25 + 1] = _basis_15;
        e.mem[_t_25 + 2] = _o2_4;
        e.mem[_t_25 + 3] = _scratch_14;
        e.mem[_t_25 + 4] = _last_14;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_ADVANCE_K742, _t_25);
        WL_IDX = 5;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
        u64 _t_26 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
        e.mem[_t_26 + 0] = _o_14;
        return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_26);
      }
      r0 = _o_14;
      WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
    } else {
      term_sink(e, _basis_15);
      term_sink(e, _o2_4);
      term_sink(e, _scratch_14);
      u64 _nd_36 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_36 + 0] = _o_13;
      r0 = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C752, _nd_36);
      WL_RETN(1);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_K742)
  {
    WL_POPN(5);
    u32 _o_15 = STK(0);
    Term _basis_16 = STK(1);
    Term _o2_5 = STK(2);
    Term _scratch_15 = STK(3);
    u32 _last_15 = STK(4);
    Term _h_21 = r0;
    WL_OPEN
    u32 _s_0 = U32_BIN(_o_15, ==, 0ull);
    if (_s_0 == 1) {
      term_sink(e, _h_21);
      term_sink(e, _basis_16);
      _scratch_15 = term_keep(e, _scratch_15);
      if (seq) {
        WL_ROOM(4);
        STK(0) = _o2_5;
        STK(1) = _scratch_15;
        STK(2) = _last_15;
        STK(3) = FID____SRC_GIT_LAND_LD_ADVANCE_K743;
        WL_PUSHN(4);
      } else {
        u64 _t_27 = task_node(e, FID____SRC_GIT_LAND_LD_ADVANCE_K743, WL_CONT, WL_IDX, 1);
        e.mem[_t_27 + 0] = _o2_5;
        e.mem[_t_27 + 1] = _scratch_15;
        e.mem[_t_27 + 2] = _last_15;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_ADVANCE_K743, _t_27);
        WL_IDX = 3;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
        u64 _t_28 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
        e.mem[_t_28 + 0] = _scratch_15;
        e.mem[_t_28 + 1] = term_ctr(CID_CON, STAT_OFF + 139);
        return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_28);
      }
      r0 = _scratch_15;
      r1 = term_ctr(CID_CON, STAT_OFF + 139);
      WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
    } else {
      term_sink(e, _basis_16);
      term_sink(e, _o2_5);
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_LD_UNMERGED)) {
        u64 _t_38 = task_node(e, FID____SRC_GIT_LAND_LD_UNMERGED, WL_CONT, WL_IDX, 0);
        e.mem[_t_38 + 0] = _scratch_15;
        e.mem[_t_38 + 1] = _h_21;
        return term_tsk(FID____SRC_GIT_LAND_LD_UNMERGED, _t_38);
      }
      r0 = _scratch_15;
      r1 = _h_21;
      WL_JMP(FID____SRC_GIT_LAND_LD_UNMERGED);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_K743)
  {
    WL_POPN(3);
    Term _o2_6 = STK(0);
    Term _scratch_16 = STK(1);
    u32 _last_16 = STK(2);
    Term _h_22 = r0;
    WL_OPEN
    u64 _nd_28 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_28 + 0] = _o2_6;
    e.mem[_nd_28 + 1] = _scratch_16;
    e.mem[_nd_28 + 2] = _last_16;
    e.mem[_nd_28 + 3] = _h_22;
    r0 = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C744, _nd_28);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_C744)
  {
    Term _o2_7 = r0;
    Term _scratch_17 = r1;
    u32 _last_17 = r2;
    Term _h_23 = r3;
    Term _x_10 = r4;
    WL_OPEN
    u64 _nd_29 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_29 + 0] = _o2_7;
    e.mem[_nd_29 + 1] = _scratch_17;
    e.mem[_nd_29 + 2] = _last_17;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_37 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_37 + 0] = _h_23;
      e.mem[_t_37 + 1] = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C745, _nd_29);
      e.mem[_t_37 + 2] = _x_10;
      return term_tsk(FID_IO_BIND, _t_37);
    }
    r0 = _h_23;
    r1 = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C745, _nd_29);
    r2 = _x_10;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_C745)
  {
    Term _o2_8 = r0;
    Term _scratch_18 = r1;
    u32 _last_18 = r2;
    Term _x_11 = r3;
    WL_OPEN
    u32 _o_16 = 0;
    Term _o_17 = 0;
    Term _o_18 = 0;
    if (term_aux(_x_11) == CID____SRC_GIT_TYPES_GRUN) {
      _o_16 = 0;
      u64 _sp_8 = term_loc(_x_11);
      u32 _f_12 = e.mem[_sp_8 + 0];
      Term _f_13 = e.mem[_sp_8 + 1];
      heap_free(e, cls_fit(2), _sp_8);
      _o_17 = _f_12;
      _o_18 = _f_13;
    } else {
      _o_16 = 1;
      u64 _sp_9 = term_loc(_x_11);
      Term _f_14 = e.mem[_sp_9 + 0];
      heap_free(e, cls_fit(1), _sp_9);
      _o_17 = _f_14;
    }
    if (_o_16 == 0) {
      term_sink(e, _scratch_18);
      if (seq) {
        WL_ROOM(4);
        STK(0) = _o_17;
        STK(1) = _o2_8;
        STK(2) = _last_18;
        STK(3) = FID____SRC_GIT_LAND_LD_ADVANCE_K746;
        WL_PUSHN(4);
      } else {
        u64 _t_29 = task_node(e, FID____SRC_GIT_LAND_LD_ADVANCE_K746, WL_CONT, WL_IDX, 1);
        e.mem[_t_29 + 0] = _o_17;
        e.mem[_t_29 + 1] = _o2_8;
        e.mem[_t_29 + 2] = _last_18;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_ADVANCE_K746, _t_29);
        WL_IDX = 3;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
        u64 _t_30 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
        e.mem[_t_30 + 0] = _o_18;
        return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_30);
      }
      r0 = _o_18;
      WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
    } else {
      term_sink(e, _o2_8);
      term_sink(e, _scratch_18);
      u64 _nd_34 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_34 + 0] = _o_17;
      r0 = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C751, _nd_34);
      WL_RETN(1);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_K746)
  {
    WL_POPN(3);
    u32 _o_19 = STK(0);
    Term _o2_9 = STK(1);
    u32 _last_19 = STK(2);
    Term _h_24 = r0;
    WL_OPEN
    u32 _s_1 = U32_BIN(_o_19, ==, 0ull);
    if (_s_1 == 1) {
      if (_last_19 == 1) {
        term_sink(e, _h_24);
        if (seq) {
          WL_ROOM(1);
          STK(0) = FID____SRC_GIT_LAND_LD_ADVANCE_K747;
          WL_PUSHN(1);
        } else {
          u64 _t_31 = task_node(e, FID____SRC_GIT_LAND_LD_ADVANCE_K747, WL_CONT, WL_IDX, 1);
          WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_ADVANCE_K747, _t_31);
          WL_IDX = 0;
        }
        if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
          u64 _t_32 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
          e.mem[_t_32 + 0] = term_ctr(CID_SCON, STAT_OFF + 38);
          e.mem[_t_32 + 1] = _o2_9;
          return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_32);
        }
        r0 = term_ctr(CID_SCON, STAT_OFF + 38);
        r1 = _o2_9;
        WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
      } else {
        u64 _nd_32 = heap_alloc(e, cls_fit(2));
        e.mem[_nd_32 + 0] = _h_24;
        e.mem[_nd_32 + 1] = _o2_9;
        r0 = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C749, _nd_32);
        WL_RETN(1);
      }
    } else {
      term_sink(e, _h_24);
      term_sink(e, _o2_9);
      r0 = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C750, 0);
      WL_RETN(1);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_K747)
  {
    Term _h_25 = r0;
    WL_OPEN
    u64 _nd_30 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_30 + 0] = _h_25;
    r0 = term_clo(FID____SRC_GIT_LAND_LD_ADVANCE_C748, _nd_30);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_C748)
  {
    Term _h_26 = r0;
    Term _x_12 = r1;
    WL_OPEN
    u64 _nd_31 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_31 + 0] = 4;
    e.mem[_nd_31 + 1] = term_ctr(CID_SCON, STAT_OFF + 46);
    e.mem[_nd_31 + 2] = _h_26;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_33 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_33 + 0] = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_31);
      e.mem[_t_33 + 1] = _x_12;
      return term_tsk(FID_IO_PURE, _t_33);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_31);
    r1 = _x_12;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_C749)
  {
    Term _h_27 = r0;
    Term _o2_10 = r1;
    Term _x_13 = r2;
    WL_OPEN
    u64 _nd_33 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_33 + 0] = _h_27;
    e.mem[_nd_33 + 1] = _o2_10;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_34 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_34 + 0] = term_ctr(CID____SRC_GIT_LAND_LDRE, _nd_33);
      e.mem[_t_34 + 1] = _x_13;
      return term_tsk(FID_IO_PURE, _t_34);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDRE, _nd_33);
    r1 = _x_13;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_C750)
  {
    Term _x_14 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_35 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_35 + 0] = term_ctr(CID____SRC_GIT_LAND_LDFAIL, STAT_OFF + 112);
      e.mem[_t_35 + 1] = _x_14;
      return term_tsk(FID_IO_PURE, _t_35);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, STAT_OFF + 112);
    r1 = _x_14;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_C751)
  {
    Term _o_20 = r0;
    Term _x_15 = r1;
    WL_OPEN
    u64 _nd_35 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_35 + 0] = 4;
    e.mem[_nd_35 + 1] = term_ctr(CID_SCON, STAT_OFF + 46);
    e.mem[_nd_35 + 2] = _o_20;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_36 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_36 + 0] = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_35);
      e.mem[_t_36 + 1] = _x_15;
      return term_tsk(FID_IO_PURE, _t_36);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_35);
    r1 = _x_15;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_C752)
  {
    Term _o_21 = r0;
    Term _x_16 = r1;
    WL_OPEN
    u64 _nd_37 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_37 + 0] = 4;
    e.mem[_nd_37 + 1] = term_ctr(CID_SCON, STAT_OFF + 46);
    e.mem[_nd_37 + 2] = _o_21;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_39 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_39 + 0] = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_37);
      e.mem[_t_39 + 1] = _x_16;
      return term_tsk(FID_IO_PURE, _t_39);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_37);
    r1 = _x_16;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_C753)
  {
    Term _o_22 = r0;
    Term _x_17 = r1;
    WL_OPEN
    u64 _nd_39 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_39 + 0] = 4;
    e.mem[_nd_39 + 1] = term_ctr(CID_SCON, STAT_OFF + 46);
    e.mem[_nd_39 + 2] = _o_22;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_41 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_41 + 0] = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_39);
      e.mem[_t_41 + 1] = _x_17;
      return term_tsk(FID_IO_PURE, _t_41);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_39);
    r1 = _x_17;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ADVANCE_C754)
  {
    Term _o_23 = r0;
    Term _x_18 = r1;
    WL_OPEN
    u64 _nd_41 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_41 + 0] = 4;
    e.mem[_nd_41 + 1] = term_ctr(CID_SCON, STAT_OFF + 46);
    e.mem[_nd_41 + 2] = _o_23;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_43 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_43 + 0] = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_41);
      e.mem[_t_43 + 1] = _x_18;
      return term_tsk(FID_IO_PURE, _t_43);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_41);
    r1 = _x_18;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_WT_PICK)
  {
    u32 _g_0 = r0;
    Term _g_1 = r1;
    Term _g_2 = r2;
    Term _worker_0 = r3;
    Term _tip_0 = r4;
    WL_OPEN
    if (_g_0 == 0) {
      if (seq) {
        WL_ROOM(4);
        STK(0) = _g_1;
        STK(1) = _worker_0;
        STK(2) = _tip_0;
        STK(3) = FID____SRC_GIT_LAND_LD_WT_PICK_K779;
        WL_PUSHN(4);
      } else {
        u64 _t_0 = task_node(e, FID____SRC_GIT_LAND_LD_WT_PICK_K779, WL_CONT, WL_IDX, 1);
        e.mem[_t_0 + 0] = _g_1;
        e.mem[_t_0 + 1] = _worker_0;
        e.mem[_t_0 + 2] = _tip_0;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_WT_PICK_K779, _t_0);
        WL_IDX = 3;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
        u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
        e.mem[_t_1 + 0] = _g_2;
        return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_1);
      }
      r0 = _g_2;
      WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
    } else {
      term_sink(e, _worker_0);
      term_sink(e, _tip_0);
      r0 = 1;
      r1 = 4;
      r2 = term_ctr(CID_SCON, STAT_OFF + 46);
      r3 = _g_1;
      WL_RETN(4);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_WT_PICK_K779)
  {
    WL_POPN(3);
    u32 _g_3 = STK(0);
    Term _worker_1 = STK(1);
    Term _tip_1 = STK(2);
    Term _h_0 = r0;
    WL_OPEN
    u32 _v_0 = 0;
    Term _v_1 = 0;
    Term _v_2 = 0;
    Term _v_3 = 0;
    Term _o_0[4];
    if (spin_50(e, _o_0, U32_BIN(_g_3, ==, 0ull), _h_0, _worker_1, _tip_1) == 0) {
      return 0;
    }
    _v_0 = _o_0[0];
    _v_1 = _o_0[1];
    _v_2 = _o_0[2];
    _v_3 = _o_0[3];
    r0 = _v_0;
    r1 = _v_1;
    r2 = _v_2;
    r3 = _v_3;
    WL_RETN(4);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_TIP_OF)
  {
    u32 _g_0 = r0;
    Term _g_1 = r1;
    Term _g_2 = r2;
    Term _worker_0 = r3;
    WL_OPEN
    if (_g_0 == 0) {
      if (seq) {
        WL_ROOM(3);
        STK(0) = _g_1;
        STK(1) = _worker_0;
        STK(2) = FID____SRC_GIT_LAND_LD_TIP_OF_K781;
        WL_PUSHN(3);
      } else {
        u64 _t_0 = task_node(e, FID____SRC_GIT_LAND_LD_TIP_OF_K781, WL_CONT, WL_IDX, 1);
        e.mem[_t_0 + 0] = _g_1;
        e.mem[_t_0 + 1] = _worker_0;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_TIP_OF_K781, _t_0);
        WL_IDX = 2;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
        u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
        e.mem[_t_1 + 0] = _g_2;
        return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_1);
      }
      r0 = _g_2;
      WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
    } else {
      term_sink(e, _worker_0);
      r0 = 1;
      r1 = 4;
      r2 = term_ctr(CID_SCON, STAT_OFF + 46);
      r3 = _g_1;
      WL_RETN(4);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_TIP_OF_K781)
  {
    WL_POPN(2);
    u32 _g_3 = STK(0);
    Term _worker_1 = STK(1);
    Term _h_0 = r0;
    WL_OPEN
    u32 _v_0 = 0;
    Term _v_1 = 0;
    Term _v_2 = 0;
    Term _v_3 = 0;
    Term _o_0[4];
    if (spin_51(e, _o_0, U32_BIN(_g_3, ==, 0ull), _h_0, _worker_1) == 0) {
      return 0;
    }
    _v_0 = _o_0[0];
    _v_1 = _o_0[1];
    _v_2 = _o_0[2];
    _v_3 = _o_0[3];
    r0 = _v_0;
    r1 = _v_1;
    r2 = _v_2;
    r3 = _v_3;
    WL_RETN(4);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IS_BLOCKED)
  {
    u32 _r_0 = r0;
    u32 _r_1 = r1;
    Term _r_2 = r2;
    Term _r_3 = r3;
    WL_OPEN
    if (_r_0 == 1) {
      if (_r_1 == 3) {
        term_sink(e, _r_2);
        r0 = term_pak(CID_SNIL, 0);
        WL_RETN(1);
      } else if (_r_1 == 0) {
        term_sink(e, _r_2);
        term_sink(e, _r_3);
        r0 = term_ctr(CID_SCON, STAT_OFF + 2500);
        WL_RETN(1);
      } else if (_r_1 == 1) {
        term_sink(e, _r_2);
        r0 = term_ctr(CID_SCON, STAT_OFF + 2526);
        WL_RETN(1);
      } else {
        term_sink(e, _r_2);
        term_sink(e, _r_3);
        r0 = term_ctr(CID_SCON, STAT_OFF + 2554);
        WL_RETN(1);
      }
    } else {
      if (seq) {
        WL_ROOM(1);
        STK(0) = FID_IS_BLOCKED_K943;
        WL_PUSHN(1);
      } else {
        u64 _t_0 = task_node(e, FID_IS_BLOCKED_K943, WL_CONT, WL_IDX, 1);
        WL_CONT = term_tsk(FID_IS_BLOCKED_K943, _t_0);
        WL_IDX = 0;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TYPES_FAIL_TEXT)) {
        u64 _t_1 = task_node(e, FID____SRC_GIT_TYPES_FAIL_TEXT, WL_CONT, WL_IDX, 0);
        e.mem[_t_1 + 0] = _r_1;
        e.mem[_t_1 + 1] = _r_2;
        e.mem[_t_1 + 2] = _r_3;
        return term_tsk(FID____SRC_GIT_TYPES_FAIL_TEXT, _t_1);
      }
      r0 = _r_1;
      r1 = _r_2;
      r2 = _r_3;
      WL_JMP(FID____SRC_GIT_TYPES_FAIL_TEXT);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IS_BLOCKED_K943)
  {
    Term _h_0 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_IS_BLOCKED_K944;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID_IS_BLOCKED_K944, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_IS_BLOCKED_K944, _t_2);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _h_0;
      return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_3);
    }
    r0 = _h_0;
    WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IS_BLOCKED_K944)
  {
    Term _h_1 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_4 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = term_ctr(CID_SCON, STAT_OFF + 2065);
      e.mem[_t_4 + 1] = _h_1;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_4);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 2065);
    r1 = _h_1;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TYPES_STR_CAT3)
  {
    Term _a_0 = r0;
    Term _b_0 = r1;
    Term _c_0 = r2;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _a_0;
      STK(1) = FID____SRC_GIT_TYPES_STR_CAT3_K946;
      WL_PUSHN(2);
    } else {
      u64 _t_0 = task_node(e, FID____SRC_GIT_TYPES_STR_CAT3_K946, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _a_0;
      WL_CONT = term_tsk(FID____SRC_GIT_TYPES_STR_CAT3_K946, _t_0);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID_STRING_APPEND)) {
      u64 _t_1 = task_node(e, FID_STRING_APPEND, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _b_0;
      e.mem[_t_1 + 1] = _c_0;
      return term_tsk(FID_STRING_APPEND, _t_1);
    }
    r0 = _b_0;
    r1 = _c_0;
    WL_JMP(FID_STRING_APPEND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TYPES_STR_CAT3_K946)
  {
    WL_POPN(1);
    Term _a_1 = STK(0);
    Term _h_0 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_STRING_APPEND)) {
      u64 _t_2 = task_node(e, FID_STRING_APPEND, WL_CONT, WL_IDX, 0);
      e.mem[_t_2 + 0] = _a_1;
      e.mem[_t_2 + 1] = _h_0;
      return term_tsk(FID_STRING_APPEND, _t_2);
    }
    r0 = _a_1;
    r1 = _h_0;
    WL_JMP(FID_STRING_APPEND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TYPES_STR_CAT2)
  {
    Term _a_0 = r0;
    Term _b_0 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_STRING_APPEND)) {
      u64 _t_0 = task_node(e, FID_STRING_APPEND, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = _a_0;
      e.mem[_t_0 + 1] = _b_0;
      return term_tsk(FID_STRING_APPEND, _t_0);
    }
    r0 = _a_0;
    r1 = _b_0;
    WL_JMP(FID_STRING_APPEND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_RESOLVED_OK_C999)
  {
    Term _worker_2 = r0;
    Term _x_0 = r1;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_1 + 0] = _worker_2;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_0 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = term_ctr(CID____SRC_GIT_LAND_LDWK, _nd_1);
      e.mem[_t_0 + 1] = _x_0;
      return term_tsk(FID_IO_PURE, _t_0);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDWK, _nd_1);
    r1 = _x_0;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_RESOLVED_OK_C1000)
  {
    Term _worker_3 = r0;
    Term _x_1 = r1;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_3 + 0] = 2;
    e.mem[_nd_3 + 1] = _worker_3;
    e.mem[_nd_3 + 2] = 0;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_1 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_3);
      e.mem[_t_1 + 1] = _x_1;
      return term_tsk(FID_IO_PURE, _t_1);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_3);
    r1 = _x_1;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE4_PICK)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
    Term _r_2 = r2;
    Term _bc_0 = r3;
    Term _branch_0 = r4;
    Term _path_0 = r5;
    WL_OPEN
    if (_r_0 == 0) {
      u32 _s_0 = U32_BIN(_r_1, ==, 0ull);
      if (_s_0 == 1) {
        term_sink(e, _r_2);
        r0 = 0;
        r1 = _branch_0;
        r2 = _path_0;
        r3 = _bc_0;
        WL_RETN(4);
      } else {
        term_sink(e, _bc_0);
        term_sink(e, _branch_0);
        term_sink(e, _path_0);
        if (seq) {
          WL_ROOM(1);
          STK(0) = FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE4_PICK_K1003;
          WL_PUSHN(1);
        } else {
          u64 _t_0 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE4_PICK_K1003, WL_CONT, WL_IDX, 1);
          WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE4_PICK_K1003, _t_0);
          WL_IDX = 0;
        }
        if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
          u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
          e.mem[_t_1 + 0] = _r_2;
          return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_1);
        }
        r0 = _r_2;
        WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
      }
    } else {
      term_sink(e, _bc_0);
      term_sink(e, _branch_0);
      term_sink(e, _path_0);
      r0 = 1;
      r1 = 4;
      r2 = term_ctr(CID_SCON, STAT_OFF + 2260);
      r3 = _r_1;
      WL_RETN(4);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE4_PICK_K1003)
  {
    Term _h_0 = r0;
    WL_OPEN
    r0 = 1;
    r1 = 4;
    r2 = term_ctr(CID_SCON, STAT_OFF + 2260);
    r3 = _h_0;
    WL_RETN(4);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IS_ALREADY)
  {
    u32 _r_0 = r0;
    u32 _r_1 = r1;
    Term _r_2 = r2;
    Term _r_3 = r3;
    WL_OPEN
    if (_r_0 == 1) {
      if (_r_1 == 1) {
        term_sink(e, _r_2);
        r0 = term_pak(CID_SNIL, 0);
        WL_RETN(1);
      } else if (_r_1 == 0) {
        term_sink(e, _r_2);
        term_sink(e, _r_3);
        r0 = term_ctr(CID_SCON, STAT_OFF + 2885);
        WL_RETN(1);
      } else if (_r_1 == 2) {
        term_sink(e, _r_2);
        term_sink(e, _r_3);
        r0 = term_ctr(CID_SCON, STAT_OFF + 2913);
        WL_RETN(1);
      } else {
        term_sink(e, _r_2);
        r0 = term_ctr(CID_SCON, STAT_OFF + 2935);
        WL_RETN(1);
      }
    } else {
      if (seq) {
        WL_ROOM(1);
        STK(0) = FID_IS_ALREADY_K1181;
        WL_PUSHN(1);
      } else {
        u64 _t_0 = task_node(e, FID_IS_ALREADY_K1181, WL_CONT, WL_IDX, 1);
        WL_CONT = term_tsk(FID_IS_ALREADY_K1181, _t_0);
        WL_IDX = 0;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TYPES_FAIL_TEXT)) {
        u64 _t_1 = task_node(e, FID____SRC_GIT_TYPES_FAIL_TEXT, WL_CONT, WL_IDX, 0);
        e.mem[_t_1 + 0] = _r_1;
        e.mem[_t_1 + 1] = _r_2;
        e.mem[_t_1 + 2] = _r_3;
        return term_tsk(FID____SRC_GIT_TYPES_FAIL_TEXT, _t_1);
      }
      r0 = _r_1;
      r1 = _r_2;
      r2 = _r_3;
      WL_JMP(FID____SRC_GIT_TYPES_FAIL_TEXT);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IS_ALREADY_K1181)
  {
    Term _h_0 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_IS_ALREADY_K1182;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID_IS_ALREADY_K1182, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_IS_ALREADY_K1182, _t_2);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _h_0;
      return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_3);
    }
    r0 = _h_0;
    WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IS_ALREADY_K1182)
  {
    Term _h_1 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_4 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = term_ctr(CID_SCON, STAT_OFF + 2065);
      e.mem[_t_4 + 1] = _h_1;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_4);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 2065);
    r1 = _h_1;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_STR_EQ_GO)
  {
    Term _a_0 = r0;
    Term _b_0 = r1;
    WL_OPEN
    WL_SPIN
    if (term_aux(_a_0) == CID_SNIL) {
      if (term_aux(_b_0) == CID_SNIL) {
        r0 = 1;
        WL_RETN(1);
      } else {
        Term _fb_0[2];
        u64 _sp_0 = ctr_take(e, _b_0, 2, _fb_0);
        u32 _f_0 = _fb_0[0];
        Term _f_1 = _fb_0[1];
        term_sink(e, _f_1);
        spare_free(e, cls_fit(2), _sp_0);
        r0 = 0;
        WL_RETN(1);
      }
    } else {
      u64 _sp_1 = term_peek(e, _a_0);
      u32 _f_2 = e.mem[_sp_1 + 0];
      Term _f_3 = e.mem[_sp_1 + 1];
      if (term_aux(_b_0) == CID_SCON) {
        Term _fb_1[2];
        u64 _sp_2 = ctr_take(e, _b_0, 2, _fb_1);
        u32 _f_4 = _fb_1[0];
        Term _f_5 = _fb_1[1];
        u32 _v_0 = 0;
        u32 _v_1 = 0;
        Term _o_0[1];
        if (spin_0(e, _o_0, _f_2) == 0) {
          return 0;
        }
        _v_1 = _o_0[0];
        _v_0 = _v_1;
        u32 _v_2 = 0;
        u32 _v_3 = 0;
        Term _o_1[1];
        if (spin_0(e, _o_1, _f_4) == 0) {
          return 0;
        }
        _v_3 = _o_1[0];
        _v_2 = _v_3;
        u32 _eq_0 = U32_BIN(_v_0, ==, _v_2);
        spare_free(e, cls_fit(2), _sp_2);
        if (seq) {
          WL_ROOM(2);
          STK(0) = _eq_0;
          STK(1) = FID____SRC_GIT_TEXT_STR_EQ_GO_K1184;
          WL_PUSHN(2);
        } else {
          u64 _t_0 = task_node(e, FID____SRC_GIT_TEXT_STR_EQ_GO_K1184, WL_CONT, WL_IDX, 1);
          e.mem[_t_0 + 0] = _eq_0;
          WL_CONT = term_tsk(FID____SRC_GIT_TEXT_STR_EQ_GO_K1184, _t_0);
          WL_IDX = 1;
        }
        r0 = _f_3;
        r1 = _f_5;
        _a_0 = r0;
        _b_0 = r1;
        WL_AGAIN(FID____SRC_GIT_TEXT_STR_EQ_GO);
      } else {
        r0 = 0;
        WL_RETN(1);
      }
    }
    WL_SPUN
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_STR_EQ_GO_K1184)
  {
    WL_POPN(1);
    u32 _eq_1 = STK(0);
    u32 _h_0 = r0;
    WL_OPEN
    Term _b_1 = 0;
    if (_h_0 == 0) {
      _b_1 = term_pak(CID_FALSE, 0);
    } else {
      _b_1 = term_pak(CID_TRUE, 0);
    }
    Term _v_4 = 0;
    Term _o_2[1];
    if (spin_1(e, _o_2, _eq_1, _b_1, term_pak(CID_FALSE, 0)) == 0) {
      return 0;
    }
    _v_4 = _o_2[0];
    u32 _o_3 = 0;
    if (term_aux(_v_4) == CID_FALSE) {
      _o_3 = 0;
    } else {
      _o_3 = 1;
    }
    r0 = _o_3;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TYPES_FAIL_TEXT)
  {
    u32 _f_0 = r0;
    Term _f_1 = r1;
    Term _f_2 = r2;
    WL_OPEN
    if (_f_0 == 0) {
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TYPES_STR_CAT2)) {
        u64 _t_0 = task_node(e, FID____SRC_GIT_TYPES_STR_CAT2, WL_CONT, WL_IDX, 0);
        e.mem[_t_0 + 0] = term_ctr(CID_SCON, STAT_OFF + 2959);
        e.mem[_t_0 + 1] = _f_1;
        return term_tsk(FID____SRC_GIT_TYPES_STR_CAT2, _t_0);
      }
      r0 = term_ctr(CID_SCON, STAT_OFF + 2959);
      r1 = _f_1;
      WL_JMP(FID____SRC_GIT_TYPES_STR_CAT2);
    } else if (_f_0 == 1) {
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TYPES_STR_CAT2)) {
        u64 _t_1 = task_node(e, FID____SRC_GIT_TYPES_STR_CAT2, WL_CONT, WL_IDX, 0);
        e.mem[_t_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 2965);
        e.mem[_t_1 + 1] = _f_1;
        return term_tsk(FID____SRC_GIT_TYPES_STR_CAT2, _t_1);
      }
      r0 = term_ctr(CID_SCON, STAT_OFF + 2965);
      r1 = _f_1;
      WL_JMP(FID____SRC_GIT_TYPES_STR_CAT2);
    } else if (_f_0 == 2) {
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TYPES_STR_CAT2)) {
        u64 _t_2 = task_node(e, FID____SRC_GIT_TYPES_STR_CAT2, WL_CONT, WL_IDX, 0);
        e.mem[_t_2 + 0] = term_ctr(CID_SCON, STAT_OFF + 2989);
        e.mem[_t_2 + 1] = _f_1;
        return term_tsk(FID____SRC_GIT_TYPES_STR_CAT2, _t_2);
      }
      r0 = term_ctr(CID_SCON, STAT_OFF + 2989);
      r1 = _f_1;
      WL_JMP(FID____SRC_GIT_TYPES_STR_CAT2);
    } else if (_f_0 == 3) {
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TYPES_STR_CAT2)) {
        u64 _t_3 = task_node(e, FID____SRC_GIT_TYPES_STR_CAT2, WL_CONT, WL_IDX, 0);
        e.mem[_t_3 + 0] = term_ctr(CID_SCON, STAT_OFF + 3011);
        e.mem[_t_3 + 1] = _f_1;
        return term_tsk(FID____SRC_GIT_TYPES_STR_CAT2, _t_3);
      }
      r0 = term_ctr(CID_SCON, STAT_OFF + 3011);
      r1 = _f_1;
      WL_JMP(FID____SRC_GIT_TYPES_STR_CAT2);
    } else {
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TYPES_STR_CAT3)) {
        u64 _t_4 = task_node(e, FID____SRC_GIT_TYPES_STR_CAT3, WL_CONT, WL_IDX, 0);
        e.mem[_t_4 + 0] = _f_1;
        e.mem[_t_4 + 1] = term_ctr(CID_SCON, STAT_OFF + 2);
        e.mem[_t_4 + 2] = _f_2;
        return term_tsk(FID____SRC_GIT_TYPES_STR_CAT3, _t_4);
      }
      r0 = _f_1;
      r1 = term_ctr(CID_SCON, STAT_OFF + 2);
      r2 = _f_2;
      WL_JMP(FID____SRC_GIT_TYPES_STR_CAT3);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO6)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
    Term _r_2 = r2;
    Term _r_3 = r3;
    Term _repo_0 = r4;
    Term _target_0 = r5;
    Term _scratch_0 = r6;
    WL_OPEN
    if (_r_0 == 0) {
      term_sink(e, _repo_0);
      term_sink(e, _target_0);
      term_sink(e, _scratch_0);
      u64 _nd_0 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_0 + 0] = _r_1;
      e.mem[_nd_0 + 1] = _r_2;
      e.mem[_nd_0 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_LAND_LD_GO6_C1194, _nd_0);
      WL_RETN(1);
    } else if (_r_0 == 1) {
      term_sink(e, _repo_0);
      term_sink(e, _target_0);
      term_sink(e, _scratch_0);
      u64 _nd_2 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_2 + 0] = _r_1;
      e.mem[_nd_2 + 1] = _r_2;
      e.mem[_nd_2 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_LAND_LD_GO6_C1195, _nd_2);
      WL_RETN(1);
    } else if (_r_0 == 2) {
      term_sink(e, _r_1);
      term_sink(e, _repo_0);
      term_sink(e, _target_0);
      term_sink(e, _scratch_0);
      Term _v_0 = 0;
      Term _o_0[1];
      if (spin_55(e, _o_0) == 0) {
        return 0;
      }
      _v_0 = _o_0[0];
      r0 = _v_0;
      WL_RETN(1);
    } else if (_r_0 == 3) {
      term_sink(e, _r_1);
      term_sink(e, _r_2);
      term_sink(e, _repo_0);
      term_sink(e, _target_0);
      term_sink(e, _scratch_0);
      Term _v_2 = 0;
      Term _o_1[1];
      if (spin_55(e, _o_1) == 0) {
        return 0;
      }
      _v_2 = _o_1[0];
      r0 = _v_2;
      WL_RETN(1);
    } else if (_r_0 == 4) {
      term_sink(e, _r_1);
      term_sink(e, _r_2);
      term_sink(e, _repo_0);
      term_sink(e, _target_0);
      term_sink(e, _scratch_0);
      Term _v_3 = 0;
      Term _o_2[1];
      if (spin_55(e, _o_2) == 0) {
        return 0;
      }
      _v_3 = _o_2[0];
      r0 = _v_3;
      WL_RETN(1);
    } else {
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_LD_ADVANCE)) {
        u64 _t_3 = task_node(e, FID____SRC_GIT_LAND_LD_ADVANCE, WL_CONT, WL_IDX, 0);
        e.mem[_t_3 + 0] = _repo_0;
        e.mem[_t_3 + 1] = _target_0;
        e.mem[_t_3 + 2] = _r_1;
        e.mem[_t_3 + 3] = _r_2;
        e.mem[_t_3 + 4] = _scratch_0;
        e.mem[_t_3 + 5] = 1;
        return term_tsk(FID____SRC_GIT_LAND_LD_ADVANCE, _t_3);
      }
      r0 = _repo_0;
      r1 = _target_0;
      r2 = _r_1;
      r3 = _r_2;
      r4 = _scratch_0;
      r5 = 1;
      WL_JMP(FID____SRC_GIT_LAND_LD_ADVANCE);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO6_C1194)
  {
    u32 _r_4 = r0;
    Term _r_5 = r1;
    Term _r_6 = r2;
    Term _x_0 = r3;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_1 + 0] = _r_4;
    e.mem[_nd_1 + 1] = _r_5;
    e.mem[_nd_1 + 2] = _r_6;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_0 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = term_ctr(CID____SRC_GIT_LAND_LDDONE, _nd_1);
      e.mem[_t_0 + 1] = _x_0;
      return term_tsk(FID_IO_PURE, _t_0);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDDONE, _nd_1);
    r1 = _x_0;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO6_C1195)
  {
    u32 _r_7 = r0;
    Term _r_8 = r1;
    Term _r_9 = r2;
    Term _x_1 = r3;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_3 + 0] = _r_7;
    e.mem[_nd_3 + 1] = _r_8;
    e.mem[_nd_3 + 2] = _r_9;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_1 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_3);
      e.mem[_t_1 + 1] = _x_1;
      return term_tsk(FID_IO_PURE, _t_1);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_3);
    r1 = _x_1;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_UNREACH_C1196)
  {
    Term _x_2 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_2 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_2 + 0] = term_ctr(CID____SRC_GIT_LAND_LDFAIL, STAT_OFF + 2636);
      e.mem[_t_2 + 1] = _x_2;
      return term_tsk(FID_IO_PURE, _t_2);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, STAT_OFF + 2636);
    r1 = _x_2;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO5)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
    Term _r_2 = r2;
    Term _r_3 = r3;
    Term _repo_0 = r4;
    Term _target_0 = r5;
    Term _script_0 = r6;
    Term _files_0 = r7;
    Term _scratch_0 = r8;
    WL_OPEN
    if (_r_0 == 0) {
      term_sink(e, _repo_0);
      term_sink(e, _target_0);
      term_sink(e, _script_0);
      term_sink(e, _files_0);
      term_sink(e, _scratch_0);
      u64 _nd_0 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_0 + 0] = _r_1;
      e.mem[_nd_0 + 1] = _r_2;
      e.mem[_nd_0 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_LAND_LD_GO5_C1198, _nd_0);
      WL_RETN(1);
    } else if (_r_0 == 1) {
      term_sink(e, _repo_0);
      term_sink(e, _target_0);
      term_sink(e, _script_0);
      term_sink(e, _files_0);
      term_sink(e, _scratch_0);
      u64 _nd_2 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_2 + 0] = _r_1;
      e.mem[_nd_2 + 1] = _r_2;
      e.mem[_nd_2 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_LAND_LD_GO5_C1199, _nd_2);
      WL_RETN(1);
    } else if (_r_0 == 2) {
      term_sink(e, _r_1);
      term_sink(e, _repo_0);
      term_sink(e, _target_0);
      term_sink(e, _script_0);
      term_sink(e, _files_0);
      term_sink(e, _scratch_0);
      Term _v_0 = 0;
      Term _o_0[1];
      if (spin_55(e, _o_0) == 0) {
        return 0;
      }
      _v_0 = _o_0[0];
      r0 = _v_0;
      WL_RETN(1);
    } else if (_r_0 == 3) {
      term_sink(e, _r_1);
      term_sink(e, _r_2);
      term_sink(e, _repo_0);
      term_sink(e, _target_0);
      term_sink(e, _script_0);
      term_sink(e, _files_0);
      term_sink(e, _scratch_0);
      Term _v_1 = 0;
      Term _o_1[1];
      if (spin_55(e, _o_1) == 0) {
        return 0;
      }
      _v_1 = _o_1[0];
      r0 = _v_1;
      WL_RETN(1);
    } else if (_r_0 == 4) {
      _scratch_0 = term_keep(e, _scratch_0);
      if (seq) {
        WL_ROOM(8);
        STK(0) = _target_0;
        STK(1) = _script_0;
        STK(2) = _files_0;
        STK(3) = _r_2;
        STK(4) = _repo_0;
        STK(5) = _scratch_0;
        STK(6) = _r_1;
        STK(7) = FID____SRC_GIT_LAND_LD_GO5_K1200;
        WL_PUSHN(8);
      } else {
        u64 _t_2 = task_node(e, FID____SRC_GIT_LAND_LD_GO5_K1200, WL_CONT, WL_IDX, 1);
        e.mem[_t_2 + 0] = _target_0;
        e.mem[_t_2 + 1] = _script_0;
        e.mem[_t_2 + 2] = _files_0;
        e.mem[_t_2 + 3] = _r_2;
        e.mem[_t_2 + 4] = _repo_0;
        e.mem[_t_2 + 5] = _scratch_0;
        e.mem[_t_2 + 6] = _r_1;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_GO5_K1200, _t_2);
        WL_IDX = 7;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
        u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
        e.mem[_t_3 + 0] = _scratch_0;
        e.mem[_t_3 + 1] = term_ctr(CID_SCON, STAT_OFF + 2556);
        return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_3);
      }
      r0 = _scratch_0;
      r1 = term_ctr(CID_SCON, STAT_OFF + 2556);
      WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
    } else {
      term_sink(e, _r_1);
      term_sink(e, _r_2);
      term_sink(e, _repo_0);
      term_sink(e, _target_0);
      term_sink(e, _script_0);
      term_sink(e, _files_0);
      term_sink(e, _scratch_0);
      Term _v_2 = 0;
      Term _o_6[1];
      if (spin_55(e, _o_6) == 0) {
        return 0;
      }
      _v_2 = _o_6[0];
      r0 = _v_2;
      WL_RETN(1);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO5_C1198)
  {
    u32 _r_4 = r0;
    Term _r_5 = r1;
    Term _r_6 = r2;
    Term _x_0 = r3;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_1 + 0] = _r_4;
    e.mem[_nd_1 + 1] = _r_5;
    e.mem[_nd_1 + 2] = _r_6;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_0 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = term_ctr(CID____SRC_GIT_LAND_LDDONE, _nd_1);
      e.mem[_t_0 + 1] = _x_0;
      return term_tsk(FID_IO_PURE, _t_0);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDDONE, _nd_1);
    r1 = _x_0;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO5_C1199)
  {
    u32 _r_7 = r0;
    Term _r_8 = r1;
    Term _r_9 = r2;
    Term _x_1 = r3;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_3 + 0] = _r_7;
    e.mem[_nd_3 + 1] = _r_8;
    e.mem[_nd_3 + 2] = _r_9;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_1 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_3);
      e.mem[_t_1 + 1] = _x_1;
      return term_tsk(FID_IO_PURE, _t_1);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_3);
    r1 = _x_1;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO5_K1200)
  {
    WL_POPN(7);
    Term _target_1 = STK(0);
    Term _script_1 = STK(1);
    Term _files_1 = STK(2);
    Term _r_10 = STK(3);
    Term _repo_1 = STK(4);
    Term _scratch_1 = STK(5);
    Term _r_11 = STK(6);
    Term _tw_0 = r0;
    WL_OPEN
    _tw_0 = term_keep(e, _tw_0);
    _r_11 = term_keep(e, _r_11);
    u64 _nd_4 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_4 + 0] = _r_11;
    e.mem[_nd_4 + 1] = term_pak(CID_NIL, 0);
    u64 _nd_5 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_5 + 0] = _tw_0;
    e.mem[_nd_5 + 1] = term_ctr(CID_CON, _nd_4);
    u64 _nd_6 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_6 + 0] = term_ctr(CID_SCON, STAT_OFF + 2570);
    e.mem[_nd_6 + 1] = term_ctr(CID_CON, _nd_5);
    u64 _nd_7 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_7 + 0] = term_ctr(CID_SCON, STAT_OFF + 975);
    e.mem[_nd_7 + 1] = term_ctr(CID_CON, _nd_6);
    u64 _nd_8 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_8 + 0] = term_ctr(CID_SCON, STAT_OFF + 971);
    e.mem[_nd_8 + 1] = term_ctr(CID_CON, _nd_7);
    _repo_1 = term_keep(e, _repo_1);
    if (seq) {
      WL_ROOM(9);
      STK(0) = _target_1;
      STK(1) = _script_1;
      STK(2) = _files_1;
      STK(3) = _r_10;
      STK(4) = _repo_1;
      STK(5) = _scratch_1;
      STK(6) = _r_11;
      STK(7) = _tw_0;
      STK(8) = FID____SRC_GIT_LAND_LD_GO5_K1201;
      WL_PUSHN(9);
    } else {
      u64 _t_4 = task_node(e, FID____SRC_GIT_LAND_LD_GO5_K1201, WL_CONT, WL_IDX, 1);
      e.mem[_t_4 + 0] = _target_1;
      e.mem[_t_4 + 1] = _script_1;
      e.mem[_t_4 + 2] = _files_1;
      e.mem[_t_4 + 3] = _r_10;
      e.mem[_t_4 + 4] = _repo_1;
      e.mem[_t_4 + 5] = _scratch_1;
      e.mem[_t_4 + 6] = _r_11;
      e.mem[_t_4 + 7] = _tw_0;
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_GO5_K1201, _t_4);
      WL_IDX = 8;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
      u64 _t_5 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _repo_1;
      e.mem[_t_5 + 1] = term_ctr(CID_CON, _nd_8);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_5);
    }
    r0 = _repo_1;
    r1 = term_ctr(CID_CON, _nd_8);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO5_K1201)
  {
    WL_POPN(8);
    Term _target_2 = STK(0);
    Term _script_2 = STK(1);
    Term _files_2 = STK(2);
    Term _r_12 = STK(3);
    Term _repo_2 = STK(4);
    Term _scratch_2 = STK(5);
    Term _r_13 = STK(6);
    Term _tw_1 = STK(7);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_9 = heap_alloc(e, cls_fit(9));
    e.mem[_nd_9 + 0] = _target_2;
    e.mem[_nd_9 + 1] = _script_2;
    e.mem[_nd_9 + 2] = _files_2;
    e.mem[_nd_9 + 3] = _r_12;
    e.mem[_nd_9 + 4] = _repo_2;
    e.mem[_nd_9 + 5] = _scratch_2;
    e.mem[_nd_9 + 6] = _r_13;
    e.mem[_nd_9 + 7] = _tw_1;
    e.mem[_nd_9 + 8] = _h_0;
    r0 = term_clo(FID____SRC_GIT_LAND_LD_GO5_C1202, _nd_9);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO5_C1202)
  {
    Term _target_3 = r0;
    Term _script_3 = r1;
    Term _files_3 = r2;
    Term _r_14 = r3;
    Term _repo_3 = r4;
    Term _scratch_3 = r5;
    Term _r_15 = r6;
    Term _tw_2 = r7;
    Term _h_1 = r8;
    Term _x_2 = r9;
    WL_OPEN
    u64 _nd_10 = heap_alloc(e, cls_fit(8));
    e.mem[_nd_10 + 0] = _target_3;
    e.mem[_nd_10 + 1] = _script_3;
    e.mem[_nd_10 + 2] = _files_3;
    e.mem[_nd_10 + 3] = _r_14;
    e.mem[_nd_10 + 4] = _repo_3;
    e.mem[_nd_10 + 5] = _scratch_3;
    e.mem[_nd_10 + 6] = _r_15;
    e.mem[_nd_10 + 7] = _tw_2;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_19 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_19 + 0] = _h_1;
      e.mem[_t_19 + 1] = term_clo(FID____SRC_GIT_LAND_LD_GO5_C1203, _nd_10);
      e.mem[_t_19 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_19);
    }
    r0 = _h_1;
    r1 = term_clo(FID____SRC_GIT_LAND_LD_GO5_C1203, _nd_10);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO5_C1203)
  {
    Term _target_4 = r0;
    Term _script_4 = r1;
    Term _files_4 = r2;
    Term _r_16 = r3;
    Term _repo_4 = r4;
    Term _scratch_4 = r5;
    Term _r_17 = r6;
    Term _tw_3 = r7;
    Term _x_3 = r8;
    WL_OPEN
    u32 _o_2 = 0;
    Term _o_3 = 0;
    Term _o_4 = 0;
    if (term_aux(_x_3) == CID____SRC_GIT_TYPES_GRUN) {
      _o_2 = 0;
      u64 _sp_0 = term_loc(_x_3);
      u32 _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      heap_free(e, cls_fit(2), _sp_0);
      _o_3 = _f_0;
      _o_4 = _f_1;
    } else {
      _o_2 = 1;
      u64 _sp_1 = term_loc(_x_3);
      Term _f_2 = e.mem[_sp_1 + 0];
      heap_free(e, cls_fit(1), _sp_1);
      _o_3 = _f_2;
    }
    if (_o_2 == 0) {
      term_sink(e, _o_4);
      u32 _s_0 = U32_BIN(_o_3, ==, 0ull);
      if (_s_0 == 1) {
        _scratch_4 = term_keep(e, _scratch_4);
        if (seq) {
          WL_ROOM(6);
          STK(0) = _repo_4;
          STK(1) = _target_4;
          STK(2) = _r_17;
          STK(3) = _r_16;
          STK(4) = _scratch_4;
          STK(5) = FID____SRC_GIT_LAND_LD_GO5_K1204;
          WL_PUSHN(6);
        } else {
          u64 _t_6 = task_node(e, FID____SRC_GIT_LAND_LD_GO5_K1204, WL_CONT, WL_IDX, 1);
          e.mem[_t_6 + 0] = _repo_4;
          e.mem[_t_6 + 1] = _target_4;
          e.mem[_t_6 + 2] = _r_17;
          e.mem[_t_6 + 3] = _r_16;
          e.mem[_t_6 + 4] = _scratch_4;
          WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_GO5_K1204, _t_6);
          WL_IDX = 5;
        }
        if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_RUN_PAIRS)) {
          u64 _t_7 = task_node(e, FID____SRC_GIT_LAND_RUN_PAIRS, WL_CONT, WL_IDX, 0);
          e.mem[_t_7 + 0] = _script_4;
          e.mem[_t_7 + 1] = _files_4;
          e.mem[_t_7 + 2] = _scratch_4;
          e.mem[_t_7 + 3] = _tw_3;
          return term_tsk(FID____SRC_GIT_LAND_RUN_PAIRS, _t_7);
        }
        r0 = _script_4;
        r1 = _files_4;
        r2 = _scratch_4;
        r3 = _tw_3;
        WL_JMP(FID____SRC_GIT_LAND_RUN_PAIRS);
      } else {
        term_sink(e, _repo_4);
        term_sink(e, _target_4);
        term_sink(e, _script_4);
        term_sink(e, _files_4);
        term_sink(e, _scratch_4);
        term_sink(e, _r_17);
        term_sink(e, _r_16);
        term_sink(e, _tw_3);
        r0 = term_clo(FID____SRC_GIT_LAND_LD_GO5_C1211, 0);
        WL_RETN(1);
      }
    } else {
      term_sink(e, _repo_4);
      term_sink(e, _target_4);
      term_sink(e, _script_4);
      term_sink(e, _files_4);
      term_sink(e, _scratch_4);
      term_sink(e, _r_17);
      term_sink(e, _r_16);
      term_sink(e, _tw_3);
      u64 _nd_16 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_16 + 0] = _o_3;
      r0 = term_clo(FID____SRC_GIT_LAND_LD_GO5_C1212, _nd_16);
      WL_RETN(1);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO5_K1204)
  {
    WL_POPN(5);
    Term _repo_5 = STK(0);
    Term _target_5 = STK(1);
    Term _r_18 = STK(2);
    Term _r_19 = STK(3);
    Term _scratch_5 = STK(4);
    Term _h_2 = r0;
    WL_OPEN
    u64 _nd_11 = heap_alloc(e, cls_fit(6));
    e.mem[_nd_11 + 0] = _repo_5;
    e.mem[_nd_11 + 1] = _target_5;
    e.mem[_nd_11 + 2] = _r_18;
    e.mem[_nd_11 + 3] = _r_19;
    e.mem[_nd_11 + 4] = _scratch_5;
    e.mem[_nd_11 + 5] = _h_2;
    r0 = term_clo(FID____SRC_GIT_LAND_LD_GO5_C1205, _nd_11);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO5_C1205)
  {
    Term _repo_6 = r0;
    Term _target_6 = r1;
    Term _r_20 = r2;
    Term _r_21 = r3;
    Term _scratch_6 = r4;
    Term _h_3 = r5;
    Term _x_4 = r6;
    WL_OPEN
    u64 _nd_12 = heap_alloc(e, cls_fit(5));
    e.mem[_nd_12 + 0] = _repo_6;
    e.mem[_nd_12 + 1] = _target_6;
    e.mem[_nd_12 + 2] = _r_20;
    e.mem[_nd_12 + 3] = _r_21;
    e.mem[_nd_12 + 4] = _scratch_6;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_16 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_16 + 0] = _h_3;
      e.mem[_t_16 + 1] = term_clo(FID____SRC_GIT_LAND_LD_GO5_C1206, _nd_12);
      e.mem[_t_16 + 2] = _x_4;
      return term_tsk(FID_IO_BIND, _t_16);
    }
    r0 = _h_3;
    r1 = term_clo(FID____SRC_GIT_LAND_LD_GO5_C1206, _nd_12);
    r2 = _x_4;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO5_C1206)
  {
    Term _repo_7 = r0;
    Term _target_7 = r1;
    Term _r_22 = r2;
    Term _r_23 = r3;
    Term _scratch_7 = r4;
    Term _x_5 = r5;
    WL_OPEN
    if (seq) {
      WL_ROOM(6);
      STK(0) = _repo_7;
      STK(1) = _target_7;
      STK(2) = _scratch_7;
      STK(3) = _r_22;
      STK(4) = _r_23;
      STK(5) = FID____SRC_GIT_LAND_LD_GO5_K1207;
      WL_PUSHN(6);
    } else {
      u64 _t_8 = task_node(e, FID____SRC_GIT_LAND_LD_GO5_K1207, WL_CONT, WL_IDX, 1);
      e.mem[_t_8 + 0] = _repo_7;
      e.mem[_t_8 + 1] = _target_7;
      e.mem[_t_8 + 2] = _scratch_7;
      e.mem[_t_8 + 3] = _r_22;
      e.mem[_t_8 + 4] = _r_23;
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_GO5_K1207, _t_8);
      WL_IDX = 5;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_PAIRS_NEWS)) {
      u64 _t_9 = task_node(e, FID____SRC_GIT_LAND_PAIRS_NEWS, WL_CONT, WL_IDX, 0);
      e.mem[_t_9 + 0] = _x_5;
      return term_tsk(FID____SRC_GIT_LAND_PAIRS_NEWS, _t_9);
    }
    r0 = _x_5;
    WL_JMP(FID____SRC_GIT_LAND_PAIRS_NEWS);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO5_K1207)
  {
    WL_POPN(5);
    Term _repo_8 = STK(0);
    Term _target_8 = STK(1);
    Term _scratch_8 = STK(2);
    Term _r_24 = STK(3);
    Term _r_25 = STK(4);
    Term _h_4 = r0;
    WL_OPEN
    if (term_aux(_h_4) == CID_NIL) {
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_LD_ADVANCE)) {
        u64 _t_10 = task_node(e, FID____SRC_GIT_LAND_LD_ADVANCE, WL_CONT, WL_IDX, 0);
        e.mem[_t_10 + 0] = _repo_8;
        e.mem[_t_10 + 1] = _target_8;
        e.mem[_t_10 + 2] = _r_25;
        e.mem[_t_10 + 3] = _r_24;
        e.mem[_t_10 + 4] = _scratch_8;
        e.mem[_t_10 + 5] = 0;
        return term_tsk(FID____SRC_GIT_LAND_LD_ADVANCE, _t_10);
      }
      r0 = _repo_8;
      r1 = _target_8;
      r2 = _r_25;
      r3 = _r_24;
      r4 = _scratch_8;
      r5 = 0;
      WL_JMP(FID____SRC_GIT_LAND_LD_ADVANCE);
    } else {
      Term _fb_0[2];
      u64 _sp_2 = ctr_take(e, _h_4, 2, _fb_0);
      Term _f_3 = _fb_0[0];
      Term _f_4 = _fb_0[1];
      term_sink(e, _repo_8);
      term_sink(e, _target_8);
      term_sink(e, _scratch_8);
      term_sink(e, _r_24);
      term_sink(e, _r_25);
      u64 _nd_13 = _sp_2 >= HEAP_OFF ? _sp_2 : heap_alloc(e, cls_fit(2));
      e.mem[_nd_13 + 0] = _f_3;
      e.mem[_nd_13 + 1] = _f_4;
      if (seq) {
        WL_ROOM(1);
        STK(0) = FID____SRC_GIT_LAND_LD_GO5_K1208;
        WL_PUSHN(1);
      } else {
        u64 _t_11 = task_node(e, FID____SRC_GIT_LAND_LD_GO5_K1208, WL_CONT, WL_IDX, 1);
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_GO5_K1208, _t_11);
        WL_IDX = 0;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_JOIN)) {
        u64 _t_12 = task_node(e, FID____SRC_GIT_TEXT_JOIN, WL_CONT, WL_IDX, 0);
        e.mem[_t_12 + 0] = term_ctr(CID_SCON, STAT_OFF + 1141);
        e.mem[_t_12 + 1] = term_ctr(CID_CON, _nd_13);
        return term_tsk(FID____SRC_GIT_TEXT_JOIN, _t_12);
      }
      r0 = term_ctr(CID_SCON, STAT_OFF + 1141);
      r1 = term_ctr(CID_CON, _nd_13);
      WL_JMP(FID____SRC_GIT_TEXT_JOIN);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO5_K1208)
  {
    Term _h_5 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID____SRC_GIT_LAND_LD_GO5_K1209;
      WL_PUSHN(1);
    } else {
      u64 _t_13 = task_node(e, FID____SRC_GIT_LAND_LD_GO5_K1209, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_GO5_K1209, _t_13);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_14 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_14 + 0] = term_ctr(CID_SCON, STAT_OFF + 1165);
      e.mem[_t_14 + 1] = _h_5;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_14);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 1165);
    r1 = _h_5;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO5_K1209)
  {
    Term _h_6 = r0;
    WL_OPEN
    u64 _nd_14 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_14 + 0] = _h_6;
    r0 = term_clo(FID____SRC_GIT_LAND_LD_GO5_C1210, _nd_14);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO5_C1210)
  {
    Term _h_7 = r0;
    Term _x_6 = r1;
    WL_OPEN
    u64 _nd_15 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_15 + 0] = 3;
    e.mem[_nd_15 + 1] = _h_7;
    e.mem[_nd_15 + 2] = 0;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_15 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_15 + 0] = term_ctr(CID____SRC_GIT_LAND_LDDONE, _nd_15);
      e.mem[_t_15 + 1] = _x_6;
      return term_tsk(FID_IO_PURE, _t_15);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDDONE, _nd_15);
    r1 = _x_6;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO5_C1211)
  {
    Term _x_7 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_17 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_17 + 0] = term_ctr(CID____SRC_GIT_LAND_LDFAIL, STAT_OFF + 2107);
      e.mem[_t_17 + 1] = _x_7;
      return term_tsk(FID_IO_PURE, _t_17);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, STAT_OFF + 2107);
    r1 = _x_7;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO5_C1212)
  {
    Term _o_5 = r0;
    Term _x_8 = r1;
    WL_OPEN
    u64 _nd_17 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_17 + 0] = 4;
    e.mem[_nd_17 + 1] = term_ctr(CID_SCON, STAT_OFF + 46);
    e.mem[_nd_17 + 2] = _o_5;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_18 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_18 + 0] = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_17);
      e.mem[_t_18 + 1] = _x_8;
      return term_tsk(FID_IO_PURE, _t_18);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_17);
    r1 = _x_8;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO4)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
    Term _r_2 = r2;
    Term _r_3 = r3;
    Term _scratch_0 = r4;
    WL_OPEN
    if (_r_0 == 0) {
      term_sink(e, _scratch_0);
      u64 _nd_0 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_0 + 0] = _r_1;
      e.mem[_nd_0 + 1] = _r_2;
      e.mem[_nd_0 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_LAND_LD_GO4_C1214, _nd_0);
      WL_RETN(1);
    } else if (_r_0 == 1) {
      term_sink(e, _scratch_0);
      u64 _nd_2 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_2 + 0] = _r_1;
      e.mem[_nd_2 + 1] = _r_2;
      e.mem[_nd_2 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_LAND_LD_GO4_C1215, _nd_2);
      WL_RETN(1);
    } else if (_r_0 == 2) {
      term_sink(e, _r_1);
      term_sink(e, _scratch_0);
      Term _v_0 = 0;
      Term _o_0[1];
      if (spin_55(e, _o_0) == 0) {
        return 0;
      }
      _v_0 = _o_0[0];
      r0 = _v_0;
      WL_RETN(1);
    } else if (_r_0 == 3) {
      _r_1 = term_keep(e, _r_1);
      if (seq) {
        WL_ROOM(4);
        STK(0) = _scratch_0;
        STK(1) = _r_1;
        STK(2) = _r_2;
        STK(3) = FID____SRC_GIT_LAND_LD_GO4_K1216;
        WL_PUSHN(4);
      } else {
        u64 _t_2 = task_node(e, FID____SRC_GIT_LAND_LD_GO4_K1216, WL_CONT, WL_IDX, 1);
        e.mem[_t_2 + 0] = _scratch_0;
        e.mem[_t_2 + 1] = _r_1;
        e.mem[_t_2 + 2] = _r_2;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_GO4_K1216, _t_2);
        WL_IDX = 3;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
        u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
        e.mem[_t_3 + 0] = term_ctr(CID_SCON, STAT_OFF + 2576);
        e.mem[_t_3 + 1] = _r_1;
        return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_3);
      }
      r0 = term_ctr(CID_SCON, STAT_OFF + 2576);
      r1 = _r_1;
      WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
    } else if (_r_0 == 4) {
      term_sink(e, _r_1);
      term_sink(e, _r_2);
      term_sink(e, _scratch_0);
      Term _v_4 = 0;
      Term _o_11[1];
      if (spin_55(e, _o_11) == 0) {
        return 0;
      }
      _v_4 = _o_11[0];
      r0 = _v_4;
      WL_RETN(1);
    } else {
      term_sink(e, _r_1);
      term_sink(e, _r_2);
      term_sink(e, _scratch_0);
      Term _v_5 = 0;
      Term _o_12[1];
      if (spin_55(e, _o_12) == 0) {
        return 0;
      }
      _v_5 = _o_12[0];
      r0 = _v_5;
      WL_RETN(1);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO4_C1214)
  {
    u32 _r_4 = r0;
    Term _r_5 = r1;
    Term _r_6 = r2;
    Term _x_0 = r3;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_1 + 0] = _r_4;
    e.mem[_nd_1 + 1] = _r_5;
    e.mem[_nd_1 + 2] = _r_6;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_0 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = term_ctr(CID____SRC_GIT_LAND_LDDONE, _nd_1);
      e.mem[_t_0 + 1] = _x_0;
      return term_tsk(FID_IO_PURE, _t_0);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDDONE, _nd_1);
    r1 = _x_0;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO4_C1215)
  {
    u32 _r_7 = r0;
    Term _r_8 = r1;
    Term _r_9 = r2;
    Term _x_1 = r3;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_3 + 0] = _r_7;
    e.mem[_nd_3 + 1] = _r_8;
    e.mem[_nd_3 + 2] = _r_9;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_1 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_3);
      e.mem[_t_1 + 1] = _x_1;
      return term_tsk(FID_IO_PURE, _t_1);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_3);
    r1 = _x_1;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO4_K1216)
  {
    WL_POPN(3);
    Term _scratch_1 = STK(0);
    Term _r_10 = STK(1);
    Term _r_11 = STK(2);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_4 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_4 + 0] = _h_0;
    e.mem[_nd_4 + 1] = term_pak(CID_NIL, 0);
    u64 _nd_5 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_5 + 0] = term_ctr(CID_SCON, STAT_OFF + 2584);
    e.mem[_nd_5 + 1] = term_ctr(CID_CON, _nd_4);
    u64 _nd_6 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_6 + 0] = term_ctr(CID_SCON, STAT_OFF + 2580);
    e.mem[_nd_6 + 1] = term_ctr(CID_CON, _nd_5);
    u64 _nd_7 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_7 + 0] = term_ctr(CID_SCON, STAT_OFF + 871);
    e.mem[_nd_7 + 1] = term_ctr(CID_CON, _nd_6);
    _scratch_1 = term_keep(e, _scratch_1);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _scratch_1;
      STK(1) = _r_10;
      STK(2) = _r_11;
      STK(3) = FID____SRC_GIT_LAND_LD_GO4_K1217;
      WL_PUSHN(4);
    } else {
      u64 _t_4 = task_node(e, FID____SRC_GIT_LAND_LD_GO4_K1217, WL_CONT, WL_IDX, 1);
      e.mem[_t_4 + 0] = _scratch_1;
      e.mem[_t_4 + 1] = _r_10;
      e.mem[_t_4 + 2] = _r_11;
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_GO4_K1217, _t_4);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
      u64 _t_5 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _scratch_1;
      e.mem[_t_5 + 1] = term_ctr(CID_CON, _nd_7);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_5);
    }
    r0 = _scratch_1;
    r1 = term_ctr(CID_CON, _nd_7);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO4_K1217)
  {
    WL_POPN(3);
    Term _scratch_2 = STK(0);
    Term _r_12 = STK(1);
    Term _r_13 = STK(2);
    Term _h_1 = r0;
    WL_OPEN
    u64 _nd_8 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_8 + 0] = _scratch_2;
    e.mem[_nd_8 + 1] = _r_12;
    e.mem[_nd_8 + 2] = _r_13;
    e.mem[_nd_8 + 3] = _h_1;
    r0 = term_clo(FID____SRC_GIT_LAND_LD_GO4_C1218, _nd_8);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO4_C1218)
  {
    Term _scratch_3 = r0;
    Term _r_14 = r1;
    Term _r_15 = r2;
    Term _h_2 = r3;
    Term _x_2 = r4;
    WL_OPEN
    u64 _nd_9 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_9 + 0] = _scratch_3;
    e.mem[_nd_9 + 1] = _r_14;
    e.mem[_nd_9 + 2] = _r_15;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_17 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_17 + 0] = _h_2;
      e.mem[_t_17 + 1] = term_clo(FID____SRC_GIT_LAND_LD_GO4_C1219, _nd_9);
      e.mem[_t_17 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_17);
    }
    r0 = _h_2;
    r1 = term_clo(FID____SRC_GIT_LAND_LD_GO4_C1219, _nd_9);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO4_C1219)
  {
    Term _scratch_4 = r0;
    Term _r_16 = r1;
    Term _r_17 = r2;
    Term _x_3 = r3;
    WL_OPEN
    u32 _o_1 = 0;
    Term _o_2 = 0;
    Term _o_3 = 0;
    if (term_aux(_x_3) == CID____SRC_GIT_TYPES_GRUN) {
      _o_1 = 0;
      u64 _sp_0 = term_loc(_x_3);
      u32 _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      heap_free(e, cls_fit(2), _sp_0);
      _o_2 = _f_0;
      _o_3 = _f_1;
    } else {
      _o_1 = 1;
      u64 _sp_1 = term_loc(_x_3);
      Term _f_2 = e.mem[_sp_1 + 0];
      heap_free(e, cls_fit(1), _sp_1);
      _o_2 = _f_2;
    }
    if (_o_1 == 0) {
      if (seq) {
        WL_ROOM(5);
        STK(0) = _o_2;
        STK(1) = _scratch_4;
        STK(2) = _r_16;
        STK(3) = _r_17;
        STK(4) = FID____SRC_GIT_LAND_LD_GO4_K1220;
        WL_PUSHN(5);
      } else {
        u64 _t_6 = task_node(e, FID____SRC_GIT_LAND_LD_GO4_K1220, WL_CONT, WL_IDX, 1);
        e.mem[_t_6 + 0] = _o_2;
        e.mem[_t_6 + 1] = _scratch_4;
        e.mem[_t_6 + 2] = _r_16;
        e.mem[_t_6 + 3] = _r_17;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_GO4_K1220, _t_6);
        WL_IDX = 4;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
        u64 _t_7 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
        e.mem[_t_7 + 0] = _o_3;
        return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_7);
      }
      r0 = _o_3;
      WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
    } else {
      term_sink(e, _scratch_4);
      term_sink(e, _r_16);
      term_sink(e, _r_17);
      u64 _nd_19 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_19 + 0] = _o_2;
      r0 = term_clo(FID____SRC_GIT_LAND_LD_GO4_C1227, _nd_19);
      WL_RETN(1);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO4_K1220)
  {
    WL_POPN(4);
    u32 _o_4 = STK(0);
    Term _scratch_5 = STK(1);
    Term _r_18 = STK(2);
    Term _r_19 = STK(3);
    Term _h_3 = r0;
    WL_OPEN
    u32 _s_0 = U32_BIN(_o_4, ==, 0ull);
    if (_s_0 == 1) {
      term_sink(e, _h_3);
      term_sink(e, _r_18);
      if (seq) {
        WL_ROOM(2);
        STK(0) = _r_19;
        STK(1) = FID____SRC_GIT_LAND_LD_GO4_K1221;
        WL_PUSHN(2);
      } else {
        u64 _t_8 = task_node(e, FID____SRC_GIT_LAND_LD_GO4_K1221, WL_CONT, WL_IDX, 1);
        e.mem[_t_8 + 0] = _r_19;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_GO4_K1221, _t_8);
        WL_IDX = 1;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
        u64 _t_9 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
        e.mem[_t_9 + 0] = _scratch_5;
        e.mem[_t_9 + 1] = term_ctr(CID_CON, STAT_OFF + 139);
        return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_9);
      }
      r0 = _scratch_5;
      r1 = term_ctr(CID_CON, STAT_OFF + 139);
      WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
    } else {
      term_sink(e, _scratch_5);
      Term _v_1 = 0;
      Term _v_2 = 0;
      Term _o_8[1];
      if (spin_19(e, _o_8, _h_3) == 0) {
        return 0;
      }
      _v_2 = _o_8[0];
      _v_1 = _v_2;
      if (seq) {
        WL_ROOM(4);
        STK(0) = _r_18;
        STK(1) = _r_19;
        STK(2) = _h_3;
        STK(3) = FID____SRC_GIT_LAND_LD_GO4_K1226;
        WL_PUSHN(4);
      } else {
        u64 _t_14 = task_node(e, FID____SRC_GIT_LAND_LD_GO4_K1226, WL_CONT, WL_IDX, 1);
        e.mem[_t_14 + 0] = _r_18;
        e.mem[_t_14 + 1] = _r_19;
        e.mem[_t_14 + 2] = _h_3;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_GO4_K1226, _t_14);
        WL_IDX = 3;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_NOTHING_GO)) {
        u64 _t_15 = task_node(e, FID____SRC_GIT_LAND_NOTHING_GO, WL_CONT, WL_IDX, 0);
        e.mem[_t_15 + 0] = _v_1;
        return term_tsk(FID____SRC_GIT_LAND_NOTHING_GO, _t_15);
      }
      r0 = _v_1;
      WL_JMP(FID____SRC_GIT_LAND_NOTHING_GO);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO4_K1221)
  {
    WL_POPN(1);
    Term _r_20 = STK(0);
    Term _h_4 = r0;
    WL_OPEN
    u64 _nd_10 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_10 + 0] = _r_20;
    e.mem[_nd_10 + 1] = _h_4;
    r0 = term_clo(FID____SRC_GIT_LAND_LD_GO4_C1222, _nd_10);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO4_C1222)
  {
    Term _r_21 = r0;
    Term _h_5 = r1;
    Term _x_4 = r2;
    WL_OPEN
    u64 _nd_11 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_11 + 0] = _r_21;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_13 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_13 + 0] = _h_5;
      e.mem[_t_13 + 1] = term_clo(FID____SRC_GIT_LAND_LD_GO4_C1223, _nd_11);
      e.mem[_t_13 + 2] = _x_4;
      return term_tsk(FID_IO_BIND, _t_13);
    }
    r0 = _h_5;
    r1 = term_clo(FID____SRC_GIT_LAND_LD_GO4_C1223, _nd_11);
    r2 = _x_4;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO4_C1223)
  {
    Term _r_22 = r0;
    Term _x_5 = r1;
    WL_OPEN
    u32 _o_5 = 0;
    Term _o_6 = 0;
    Term _o_7 = 0;
    if (term_aux(_x_5) == CID____SRC_GIT_TYPES_GRUN) {
      _o_5 = 0;
      u64 _sp_2 = term_loc(_x_5);
      u32 _f_3 = e.mem[_sp_2 + 0];
      Term _f_4 = e.mem[_sp_2 + 1];
      heap_free(e, cls_fit(2), _sp_2);
      _o_6 = _f_3;
      _o_7 = _f_4;
    } else {
      _o_5 = 1;
      u64 _sp_3 = term_loc(_x_5);
      Term _f_5 = e.mem[_sp_3 + 0];
      heap_free(e, cls_fit(1), _sp_3);
      _o_6 = _f_5;
    }
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID____SRC_GIT_LAND_LD_GO4_K1224;
      WL_PUSHN(1);
    } else {
      u64 _t_10 = task_node(e, FID____SRC_GIT_LAND_LD_GO4_K1224, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_GO4_K1224, _t_10);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_LD_CAND_PICK)) {
      u64 _t_11 = task_node(e, FID____SRC_GIT_LAND_LD_CAND_PICK, WL_CONT, WL_IDX, 0);
      e.mem[_t_11 + 0] = _o_5;
      e.mem[_t_11 + 1] = _o_6;
      e.mem[_t_11 + 2] = _o_7;
      e.mem[_t_11 + 3] = _r_22;
      return term_tsk(FID____SRC_GIT_LAND_LD_CAND_PICK, _t_11);
    }
    r0 = _o_5;
    r1 = _o_6;
    r2 = _o_7;
    r3 = _r_22;
    WL_JMP(FID____SRC_GIT_LAND_LD_CAND_PICK);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO4_K1224)
  {
    u32 _h_6 = r0;
    Term _h_7 = r1;
    Term _h_8 = r2;
    Term _h_9 = r3;
    WL_OPEN
    u64 _nd_12 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_12 + 0] = _h_6;
    e.mem[_nd_12 + 1] = _h_7;
    e.mem[_nd_12 + 2] = _h_8;
    e.mem[_nd_12 + 3] = _h_9;
    r0 = term_clo(FID____SRC_GIT_LAND_LD_GO4_C1225, _nd_12);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO4_C1225)
  {
    u32 _h_10 = r0;
    Term _h_11 = r1;
    Term _h_12 = r2;
    Term _h_13 = r3;
    Term _x_6 = r4;
    WL_OPEN
    Term _b_0 = 0;
    if (_h_10 == 0) {
      u64 _nd_13 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_13 + 0] = _h_11;
      e.mem[_nd_13 + 1] = _h_12;
      e.mem[_nd_13 + 2] = _h_13;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDDONE, _nd_13);
    } else if (_h_10 == 1) {
      u64 _nd_14 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_14 + 0] = _h_11;
      e.mem[_nd_14 + 1] = _h_12;
      e.mem[_nd_14 + 2] = _h_13;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_14);
    } else if (_h_10 == 2) {
      u64 _nd_15 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_15 + 0] = _h_11;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDWK, _nd_15);
    } else if (_h_10 == 3) {
      u64 _nd_16 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_16 + 0] = _h_11;
      e.mem[_nd_16 + 1] = _h_12;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDTIP, _nd_16);
    } else if (_h_10 == 4) {
      u64 _nd_17 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_17 + 0] = _h_11;
      e.mem[_nd_17 + 1] = _h_12;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDCAND, _nd_17);
    } else {
      u64 _nd_18 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_18 + 0] = _h_11;
      e.mem[_nd_18 + 1] = _h_12;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDRE, _nd_18);
    }
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_12 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_12 + 0] = _b_0;
      e.mem[_t_12 + 1] = _x_6;
      return term_tsk(FID_IO_PURE, _t_12);
    }
    r0 = _b_0;
    r1 = _x_6;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO4_K1226)
  {
    WL_POPN(3);
    Term _r_23 = STK(0);
    Term _r_24 = STK(1);
    Term _h_14 = STK(2);
    u32 _h_15 = r0;
    WL_OPEN
    Term _v_3 = 0;
    Term _o_9[1];
    if (spin_48(e, _o_9, _h_15, _h_14, _r_23, _r_24) == 0) {
      return 0;
    }
    _v_3 = _o_9[0];
    r0 = _v_3;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO4_C1227)
  {
    Term _o_10 = r0;
    Term _x_7 = r1;
    WL_OPEN
    u64 _nd_20 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_20 + 0] = 4;
    e.mem[_nd_20 + 1] = term_ctr(CID_SCON, STAT_OFF + 46);
    e.mem[_nd_20 + 2] = _o_10;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_16 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_16 + 0] = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_20);
      e.mem[_t_16 + 1] = _x_7;
      return term_tsk(FID_IO_PURE, _t_16);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_20);
    r1 = _x_7;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO3)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
    Term _r_2 = r2;
    Term _r_3 = r3;
    Term _scratch_0 = r4;
    WL_OPEN
    if (_r_0 == 0) {
      term_sink(e, _scratch_0);
      u64 _nd_0 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_0 + 0] = _r_1;
      e.mem[_nd_0 + 1] = _r_2;
      e.mem[_nd_0 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_LAND_LD_GO3_C1229, _nd_0);
      WL_RETN(1);
    } else if (_r_0 == 1) {
      term_sink(e, _scratch_0);
      u64 _nd_2 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_2 + 0] = _r_1;
      e.mem[_nd_2 + 1] = _r_2;
      e.mem[_nd_2 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_LAND_LD_GO3_C1230, _nd_2);
      WL_RETN(1);
    } else if (_r_0 == 2) {
      term_sink(e, _r_1);
      term_sink(e, _scratch_0);
      Term _v_0 = 0;
      Term _o_0[1];
      if (spin_55(e, _o_0) == 0) {
        return 0;
      }
      _v_0 = _o_0[0];
      r0 = _v_0;
      WL_RETN(1);
    } else if (_r_0 == 3) {
      _r_1 = term_keep(e, _r_1);
      u64 _nd_4 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_4 + 0] = _r_1;
      e.mem[_nd_4 + 1] = term_pak(CID_NIL, 0);
      u64 _nd_5 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_5 + 0] = term_ctr(CID_SCON, STAT_OFF + 2604);
      e.mem[_nd_5 + 1] = term_ctr(CID_CON, _nd_4);
      u64 _nd_6 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_6 + 0] = term_ctr(CID_SCON, STAT_OFF + 2592);
      e.mem[_nd_6 + 1] = term_ctr(CID_CON, _nd_5);
      _scratch_0 = term_keep(e, _scratch_0);
      if (seq) {
        WL_ROOM(4);
        STK(0) = _r_2;
        STK(1) = _scratch_0;
        STK(2) = _r_1;
        STK(3) = FID____SRC_GIT_LAND_LD_GO3_K1231;
        WL_PUSHN(4);
      } else {
        u64 _t_2 = task_node(e, FID____SRC_GIT_LAND_LD_GO3_K1231, WL_CONT, WL_IDX, 1);
        e.mem[_t_2 + 0] = _r_2;
        e.mem[_t_2 + 1] = _scratch_0;
        e.mem[_t_2 + 2] = _r_1;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_GO3_K1231, _t_2);
        WL_IDX = 3;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
        u64 _t_3 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
        e.mem[_t_3 + 0] = _scratch_0;
        e.mem[_t_3 + 1] = term_ctr(CID_CON, _nd_6);
        return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_3);
      }
      r0 = _scratch_0;
      r1 = term_ctr(CID_CON, _nd_6);
      WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
    } else if (_r_0 == 4) {
      term_sink(e, _r_1);
      term_sink(e, _r_2);
      term_sink(e, _scratch_0);
      Term _v_1 = 0;
      Term _o_6[1];
      if (spin_55(e, _o_6) == 0) {
        return 0;
      }
      _v_1 = _o_6[0];
      r0 = _v_1;
      WL_RETN(1);
    } else {
      term_sink(e, _r_1);
      term_sink(e, _r_2);
      term_sink(e, _scratch_0);
      Term _v_2 = 0;
      Term _o_7[1];
      if (spin_55(e, _o_7) == 0) {
        return 0;
      }
      _v_2 = _o_7[0];
      r0 = _v_2;
      WL_RETN(1);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO3_C1229)
  {
    u32 _r_4 = r0;
    Term _r_5 = r1;
    Term _r_6 = r2;
    Term _x_0 = r3;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_1 + 0] = _r_4;
    e.mem[_nd_1 + 1] = _r_5;
    e.mem[_nd_1 + 2] = _r_6;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_0 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = term_ctr(CID____SRC_GIT_LAND_LDDONE, _nd_1);
      e.mem[_t_0 + 1] = _x_0;
      return term_tsk(FID_IO_PURE, _t_0);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDDONE, _nd_1);
    r1 = _x_0;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO3_C1230)
  {
    u32 _r_7 = r0;
    Term _r_8 = r1;
    Term _r_9 = r2;
    Term _x_1 = r3;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_3 + 0] = _r_7;
    e.mem[_nd_3 + 1] = _r_8;
    e.mem[_nd_3 + 2] = _r_9;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_1 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_3);
      e.mem[_t_1 + 1] = _x_1;
      return term_tsk(FID_IO_PURE, _t_1);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_3);
    r1 = _x_1;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO3_K1231)
  {
    WL_POPN(3);
    Term _r_10 = STK(0);
    Term _scratch_1 = STK(1);
    Term _r_11 = STK(2);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_7 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_7 + 0] = _r_10;
    e.mem[_nd_7 + 1] = _scratch_1;
    e.mem[_nd_7 + 2] = _r_11;
    e.mem[_nd_7 + 3] = _h_0;
    r0 = term_clo(FID____SRC_GIT_LAND_LD_GO3_C1232, _nd_7);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO3_C1232)
  {
    Term _r_12 = r0;
    Term _scratch_2 = r1;
    Term _r_13 = r2;
    Term _h_1 = r3;
    Term _x_2 = r4;
    WL_OPEN
    u64 _nd_8 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_8 + 0] = _r_12;
    e.mem[_nd_8 + 1] = _scratch_2;
    e.mem[_nd_8 + 2] = _r_13;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_9 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_9 + 0] = _h_1;
      e.mem[_t_9 + 1] = term_clo(FID____SRC_GIT_LAND_LD_GO3_C1233, _nd_8);
      e.mem[_t_9 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_9);
    }
    r0 = _h_1;
    r1 = term_clo(FID____SRC_GIT_LAND_LD_GO3_C1233, _nd_8);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO3_C1233)
  {
    Term _r_14 = r0;
    Term _scratch_3 = r1;
    Term _r_15 = r2;
    Term _x_3 = r3;
    WL_OPEN
    u32 _o_1 = 0;
    Term _o_2 = 0;
    Term _o_3 = 0;
    if (term_aux(_x_3) == CID____SRC_GIT_TYPES_GRUN) {
      _o_1 = 0;
      u64 _sp_0 = term_loc(_x_3);
      u32 _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      heap_free(e, cls_fit(2), _sp_0);
      _o_2 = _f_0;
      _o_3 = _f_1;
    } else {
      _o_1 = 1;
      u64 _sp_1 = term_loc(_x_3);
      Term _f_2 = e.mem[_sp_1 + 0];
      heap_free(e, cls_fit(1), _sp_1);
      _o_2 = _f_2;
    }
    if (_o_1 == 0) {
      if (seq) {
        WL_ROOM(5);
        STK(0) = _o_2;
        STK(1) = _r_15;
        STK(2) = _r_14;
        STK(3) = _scratch_3;
        STK(4) = FID____SRC_GIT_LAND_LD_GO3_K1234;
        WL_PUSHN(5);
      } else {
        u64 _t_4 = task_node(e, FID____SRC_GIT_LAND_LD_GO3_K1234, WL_CONT, WL_IDX, 1);
        e.mem[_t_4 + 0] = _o_2;
        e.mem[_t_4 + 1] = _r_15;
        e.mem[_t_4 + 2] = _r_14;
        e.mem[_t_4 + 3] = _scratch_3;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_GO3_K1234, _t_4);
        WL_IDX = 4;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
        u64 _t_5 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
        e.mem[_t_5 + 0] = _o_3;
        return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_5);
      }
      r0 = _o_3;
      WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
    } else {
      term_sink(e, _r_15);
      term_sink(e, _r_14);
      term_sink(e, _scratch_3);
      u64 _nd_11 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_11 + 0] = _o_2;
      r0 = term_clo(FID____SRC_GIT_LAND_LD_GO3_C1236, _nd_11);
      WL_RETN(1);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO3_K1234)
  {
    WL_POPN(4);
    u32 _o_4 = STK(0);
    Term _r_16 = STK(1);
    Term _r_17 = STK(2);
    Term _scratch_4 = STK(3);
    Term _h_2 = r0;
    WL_OPEN
    u32 _s_0 = U32_BIN(_o_4, ==, 0ull);
    if (_s_0 == 1) {
      term_sink(e, _h_2);
      term_sink(e, _scratch_4);
      u64 _nd_9 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_9 + 0] = _r_16;
      e.mem[_nd_9 + 1] = _r_17;
      r0 = term_clo(FID____SRC_GIT_LAND_LD_GO3_C1235, _nd_9);
      WL_RETN(1);
    } else {
      term_sink(e, _r_16);
      term_sink(e, _r_17);
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_LD_UNMERGED)) {
        u64 _t_7 = task_node(e, FID____SRC_GIT_LAND_LD_UNMERGED, WL_CONT, WL_IDX, 0);
        e.mem[_t_7 + 0] = _scratch_4;
        e.mem[_t_7 + 1] = _h_2;
        return term_tsk(FID____SRC_GIT_LAND_LD_UNMERGED, _t_7);
      }
      r0 = _scratch_4;
      r1 = _h_2;
      WL_JMP(FID____SRC_GIT_LAND_LD_UNMERGED);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO3_C1235)
  {
    Term _r_18 = r0;
    Term _r_19 = r1;
    Term _x_4 = r2;
    WL_OPEN
    u64 _nd_10 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_10 + 0] = _r_18;
    e.mem[_nd_10 + 1] = _r_19;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_6 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_6 + 0] = term_ctr(CID____SRC_GIT_LAND_LDTIP, _nd_10);
      e.mem[_t_6 + 1] = _x_4;
      return term_tsk(FID_IO_PURE, _t_6);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDTIP, _nd_10);
    r1 = _x_4;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO3_C1236)
  {
    Term _o_5 = r0;
    Term _x_5 = r1;
    WL_OPEN
    u64 _nd_12 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_12 + 0] = 4;
    e.mem[_nd_12 + 1] = term_ctr(CID_SCON, STAT_OFF + 46);
    e.mem[_nd_12 + 2] = _o_5;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_8 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_8 + 0] = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_12);
      e.mem[_t_8 + 1] = _x_5;
      return term_tsk(FID_IO_PURE, _t_8);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_12);
    r1 = _x_5;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO2)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
    Term _r_2 = r2;
    Term _r_3 = r3;
    Term _repo_0 = r4;
    Term _scratch_0 = r5;
    WL_OPEN
    if (_r_0 == 0) {
      term_sink(e, _repo_0);
      term_sink(e, _scratch_0);
      u64 _nd_0 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_0 + 0] = _r_1;
      e.mem[_nd_0 + 1] = _r_2;
      e.mem[_nd_0 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_LAND_LD_GO2_C1238, _nd_0);
      WL_RETN(1);
    } else if (_r_0 == 1) {
      term_sink(e, _repo_0);
      term_sink(e, _scratch_0);
      u64 _nd_2 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_2 + 0] = _r_1;
      e.mem[_nd_2 + 1] = _r_2;
      e.mem[_nd_2 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_LAND_LD_GO2_C1239, _nd_2);
      WL_RETN(1);
    } else if (_r_0 == 2) {
      term_sink(e, _r_1);
      term_sink(e, _repo_0);
      term_sink(e, _scratch_0);
      Term _v_0 = 0;
      Term _o_0[1];
      if (spin_55(e, _o_0) == 0) {
        return 0;
      }
      _v_0 = _o_0[0];
      r0 = _v_0;
      WL_RETN(1);
    } else if (_r_0 == 3) {
      _r_2 = term_keep(e, _r_2);
      u64 _nd_4 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_4 + 0] = _r_2;
      e.mem[_nd_4 + 1] = term_pak(CID_NIL, 0);
      u64 _nd_5 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_5 + 0] = _scratch_0;
      e.mem[_nd_5 + 1] = term_ctr(CID_CON, _nd_4);
      u64 _nd_6 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_6 + 0] = term_ctr(CID_SCON, STAT_OFF + 2570);
      e.mem[_nd_6 + 1] = term_ctr(CID_CON, _nd_5);
      u64 _nd_7 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_7 + 0] = term_ctr(CID_SCON, STAT_OFF + 975);
      e.mem[_nd_7 + 1] = term_ctr(CID_CON, _nd_6);
      u64 _nd_8 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_8 + 0] = term_ctr(CID_SCON, STAT_OFF + 971);
      e.mem[_nd_8 + 1] = term_ctr(CID_CON, _nd_7);
      if (seq) {
        WL_ROOM(3);
        STK(0) = _r_1;
        STK(1) = _r_2;
        STK(2) = FID____SRC_GIT_LAND_LD_GO2_K1240;
        WL_PUSHN(3);
      } else {
        u64 _t_2 = task_node(e, FID____SRC_GIT_LAND_LD_GO2_K1240, WL_CONT, WL_IDX, 1);
        e.mem[_t_2 + 0] = _r_1;
        e.mem[_t_2 + 1] = _r_2;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_GO2_K1240, _t_2);
        WL_IDX = 2;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
        u64 _t_3 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
        e.mem[_t_3 + 0] = _repo_0;
        e.mem[_t_3 + 1] = term_ctr(CID_CON, _nd_8);
        return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_3);
      }
      r0 = _repo_0;
      r1 = term_ctr(CID_CON, _nd_8);
      WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
    } else if (_r_0 == 4) {
      term_sink(e, _r_1);
      term_sink(e, _r_2);
      term_sink(e, _repo_0);
      term_sink(e, _scratch_0);
      Term _v_1 = 0;
      Term _o_4[1];
      if (spin_55(e, _o_4) == 0) {
        return 0;
      }
      _v_1 = _o_4[0];
      r0 = _v_1;
      WL_RETN(1);
    } else {
      term_sink(e, _r_1);
      term_sink(e, _r_2);
      term_sink(e, _repo_0);
      term_sink(e, _scratch_0);
      Term _v_2 = 0;
      Term _o_5[1];
      if (spin_55(e, _o_5) == 0) {
        return 0;
      }
      _v_2 = _o_5[0];
      r0 = _v_2;
      WL_RETN(1);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO2_C1238)
  {
    u32 _r_4 = r0;
    Term _r_5 = r1;
    Term _r_6 = r2;
    Term _x_0 = r3;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_1 + 0] = _r_4;
    e.mem[_nd_1 + 1] = _r_5;
    e.mem[_nd_1 + 2] = _r_6;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_0 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = term_ctr(CID____SRC_GIT_LAND_LDDONE, _nd_1);
      e.mem[_t_0 + 1] = _x_0;
      return term_tsk(FID_IO_PURE, _t_0);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDDONE, _nd_1);
    r1 = _x_0;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO2_C1239)
  {
    u32 _r_7 = r0;
    Term _r_8 = r1;
    Term _r_9 = r2;
    Term _x_1 = r3;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_3 + 0] = _r_7;
    e.mem[_nd_3 + 1] = _r_8;
    e.mem[_nd_3 + 2] = _r_9;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_1 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_3);
      e.mem[_t_1 + 1] = _x_1;
      return term_tsk(FID_IO_PURE, _t_1);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_3);
    r1 = _x_1;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO2_K1240)
  {
    WL_POPN(2);
    Term _r_10 = STK(0);
    Term _r_11 = STK(1);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_9 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_9 + 0] = _r_10;
    e.mem[_nd_9 + 1] = _r_11;
    e.mem[_nd_9 + 2] = _h_0;
    r0 = term_clo(FID____SRC_GIT_LAND_LD_GO2_C1241, _nd_9);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO2_C1241)
  {
    Term _r_12 = r0;
    Term _r_13 = r1;
    Term _h_1 = r2;
    Term _x_2 = r3;
    WL_OPEN
    u64 _nd_10 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_10 + 0] = _r_12;
    e.mem[_nd_10 + 1] = _r_13;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_7 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_7 + 0] = _h_1;
      e.mem[_t_7 + 1] = term_clo(FID____SRC_GIT_LAND_LD_GO2_C1242, _nd_10);
      e.mem[_t_7 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_7);
    }
    r0 = _h_1;
    r1 = term_clo(FID____SRC_GIT_LAND_LD_GO2_C1242, _nd_10);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO2_C1242)
  {
    Term _r_14 = r0;
    Term _r_15 = r1;
    Term _x_3 = r2;
    WL_OPEN
    u32 _o_1 = 0;
    Term _o_2 = 0;
    Term _o_3 = 0;
    if (term_aux(_x_3) == CID____SRC_GIT_TYPES_GRUN) {
      _o_1 = 0;
      u64 _sp_0 = term_loc(_x_3);
      u32 _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      heap_free(e, cls_fit(2), _sp_0);
      _o_2 = _f_0;
      _o_3 = _f_1;
    } else {
      _o_1 = 1;
      u64 _sp_1 = term_loc(_x_3);
      Term _f_2 = e.mem[_sp_1 + 0];
      heap_free(e, cls_fit(1), _sp_1);
      _o_2 = _f_2;
    }
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID____SRC_GIT_LAND_LD_GO2_K1243;
      WL_PUSHN(1);
    } else {
      u64 _t_4 = task_node(e, FID____SRC_GIT_LAND_LD_GO2_K1243, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_GO2_K1243, _t_4);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_LD_WT_PICK)) {
      u64 _t_5 = task_node(e, FID____SRC_GIT_LAND_LD_WT_PICK, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _o_1;
      e.mem[_t_5 + 1] = _o_2;
      e.mem[_t_5 + 2] = _o_3;
      e.mem[_t_5 + 3] = _r_14;
      e.mem[_t_5 + 4] = _r_15;
      return term_tsk(FID____SRC_GIT_LAND_LD_WT_PICK, _t_5);
    }
    r0 = _o_1;
    r1 = _o_2;
    r2 = _o_3;
    r3 = _r_14;
    r4 = _r_15;
    WL_JMP(FID____SRC_GIT_LAND_LD_WT_PICK);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO2_K1243)
  {
    u32 _h_2 = r0;
    Term _h_3 = r1;
    Term _h_4 = r2;
    Term _h_5 = r3;
    WL_OPEN
    u64 _nd_11 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_11 + 0] = _h_2;
    e.mem[_nd_11 + 1] = _h_3;
    e.mem[_nd_11 + 2] = _h_4;
    e.mem[_nd_11 + 3] = _h_5;
    r0 = term_clo(FID____SRC_GIT_LAND_LD_GO2_C1244, _nd_11);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO2_C1244)
  {
    u32 _h_6 = r0;
    Term _h_7 = r1;
    Term _h_8 = r2;
    Term _h_9 = r3;
    Term _x_4 = r4;
    WL_OPEN
    Term _b_0 = 0;
    if (_h_6 == 0) {
      u64 _nd_12 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_12 + 0] = _h_7;
      e.mem[_nd_12 + 1] = _h_8;
      e.mem[_nd_12 + 2] = _h_9;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDDONE, _nd_12);
    } else if (_h_6 == 1) {
      u64 _nd_13 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_13 + 0] = _h_7;
      e.mem[_nd_13 + 1] = _h_8;
      e.mem[_nd_13 + 2] = _h_9;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_13);
    } else if (_h_6 == 2) {
      u64 _nd_14 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_14 + 0] = _h_7;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDWK, _nd_14);
    } else if (_h_6 == 3) {
      u64 _nd_15 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_15 + 0] = _h_7;
      e.mem[_nd_15 + 1] = _h_8;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDTIP, _nd_15);
    } else if (_h_6 == 4) {
      u64 _nd_16 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_16 + 0] = _h_7;
      e.mem[_nd_16 + 1] = _h_8;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDCAND, _nd_16);
    } else {
      u64 _nd_17 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_17 + 0] = _h_7;
      e.mem[_nd_17 + 1] = _h_8;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDRE, _nd_17);
    }
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_6 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_6 + 0] = _b_0;
      e.mem[_t_6 + 1] = _x_4;
      return term_tsk(FID_IO_PURE, _t_6);
    }
    r0 = _b_0;
    r1 = _x_4;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO1)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
    Term _r_2 = r2;
    Term _r_3 = r3;
    Term _repo_0 = r4;
    Term _target_0 = r5;
    WL_OPEN
    if (_r_0 == 0) {
      term_sink(e, _repo_0);
      term_sink(e, _target_0);
      u64 _nd_0 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_0 + 0] = _r_1;
      e.mem[_nd_0 + 1] = _r_2;
      e.mem[_nd_0 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_LAND_LD_GO1_C1246, _nd_0);
      WL_RETN(1);
    } else if (_r_0 == 1) {
      term_sink(e, _repo_0);
      term_sink(e, _target_0);
      u64 _nd_2 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_2 + 0] = _r_1;
      e.mem[_nd_2 + 1] = _r_2;
      e.mem[_nd_2 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_LAND_LD_GO1_C1247, _nd_2);
      WL_RETN(1);
    } else if (_r_0 == 2) {
      if (seq) {
        WL_ROOM(3);
        STK(0) = _repo_0;
        STK(1) = _r_1;
        STK(2) = FID____SRC_GIT_LAND_LD_GO1_K1248;
        WL_PUSHN(3);
      } else {
        u64 _t_2 = task_node(e, FID____SRC_GIT_LAND_LD_GO1_K1248, WL_CONT, WL_IDX, 1);
        e.mem[_t_2 + 0] = _repo_0;
        e.mem[_t_2 + 1] = _r_1;
        WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_GO1_K1248, _t_2);
        WL_IDX = 2;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
        u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
        e.mem[_t_3 + 0] = _target_0;
        e.mem[_t_3 + 1] = term_ctr(CID_SCON, STAT_OFF + 1125);
        return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_3);
      }
      r0 = _target_0;
      r1 = term_ctr(CID_SCON, STAT_OFF + 1125);
      WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
    } else if (_r_0 == 3) {
      term_sink(e, _r_1);
      term_sink(e, _r_2);
      term_sink(e, _repo_0);
      term_sink(e, _target_0);
      Term _v_0 = 0;
      Term _o_3[1];
      if (spin_55(e, _o_3) == 0) {
        return 0;
      }
      _v_0 = _o_3[0];
      r0 = _v_0;
      WL_RETN(1);
    } else if (_r_0 == 4) {
      term_sink(e, _r_1);
      term_sink(e, _r_2);
      term_sink(e, _repo_0);
      term_sink(e, _target_0);
      Term _v_1 = 0;
      Term _o_4[1];
      if (spin_55(e, _o_4) == 0) {
        return 0;
      }
      _v_1 = _o_4[0];
      r0 = _v_1;
      WL_RETN(1);
    } else {
      term_sink(e, _r_1);
      term_sink(e, _r_2);
      term_sink(e, _repo_0);
      term_sink(e, _target_0);
      Term _v_2 = 0;
      Term _o_5[1];
      if (spin_55(e, _o_5) == 0) {
        return 0;
      }
      _v_2 = _o_5[0];
      r0 = _v_2;
      WL_RETN(1);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO1_C1246)
  {
    u32 _r_4 = r0;
    Term _r_5 = r1;
    Term _r_6 = r2;
    Term _x_0 = r3;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_1 + 0] = _r_4;
    e.mem[_nd_1 + 1] = _r_5;
    e.mem[_nd_1 + 2] = _r_6;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_0 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = term_ctr(CID____SRC_GIT_LAND_LDDONE, _nd_1);
      e.mem[_t_0 + 1] = _x_0;
      return term_tsk(FID_IO_PURE, _t_0);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDDONE, _nd_1);
    r1 = _x_0;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO1_C1247)
  {
    u32 _r_7 = r0;
    Term _r_8 = r1;
    Term _r_9 = r2;
    Term _x_1 = r3;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_3 + 0] = _r_7;
    e.mem[_nd_3 + 1] = _r_8;
    e.mem[_nd_3 + 2] = _r_9;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_1 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_3);
      e.mem[_t_1 + 1] = _x_1;
      return term_tsk(FID_IO_PURE, _t_1);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_3);
    r1 = _x_1;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO1_K1248)
  {
    WL_POPN(2);
    Term _repo_1 = STK(0);
    Term _r_10 = STK(1);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_4 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_4 + 0] = _h_0;
    e.mem[_nd_4 + 1] = term_pak(CID_NIL, 0);
    u64 _nd_5 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_5 + 0] = term_ctr(CID_SCON, STAT_OFF + 1139);
    e.mem[_nd_5 + 1] = term_ctr(CID_CON, _nd_4);
    u64 _nd_6 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_6 + 0] = term_ctr(CID_SCON, STAT_OFF + 127);
    e.mem[_nd_6 + 1] = term_ctr(CID_CON, _nd_5);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _r_10;
      STK(1) = FID____SRC_GIT_LAND_LD_GO1_K1249;
      WL_PUSHN(2);
    } else {
      u64 _t_4 = task_node(e, FID____SRC_GIT_LAND_LD_GO1_K1249, WL_CONT, WL_IDX, 1);
      e.mem[_t_4 + 0] = _r_10;
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_GO1_K1249, _t_4);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
      u64 _t_5 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _repo_1;
      e.mem[_t_5 + 1] = term_ctr(CID_CON, _nd_6);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_5);
    }
    r0 = _repo_1;
    r1 = term_ctr(CID_CON, _nd_6);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO1_K1249)
  {
    WL_POPN(1);
    Term _r_11 = STK(0);
    Term _h_1 = r0;
    WL_OPEN
    u64 _nd_7 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_7 + 0] = _r_11;
    e.mem[_nd_7 + 1] = _h_1;
    r0 = term_clo(FID____SRC_GIT_LAND_LD_GO1_C1250, _nd_7);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO1_C1250)
  {
    Term _r_12 = r0;
    Term _h_2 = r1;
    Term _x_2 = r2;
    WL_OPEN
    u64 _nd_8 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_8 + 0] = _r_12;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_9 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_9 + 0] = _h_2;
      e.mem[_t_9 + 1] = term_clo(FID____SRC_GIT_LAND_LD_GO1_C1251, _nd_8);
      e.mem[_t_9 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_9);
    }
    r0 = _h_2;
    r1 = term_clo(FID____SRC_GIT_LAND_LD_GO1_C1251, _nd_8);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO1_C1251)
  {
    Term _r_13 = r0;
    Term _x_3 = r1;
    WL_OPEN
    u32 _o_0 = 0;
    Term _o_1 = 0;
    Term _o_2 = 0;
    if (term_aux(_x_3) == CID____SRC_GIT_TYPES_GRUN) {
      _o_0 = 0;
      u64 _sp_0 = term_loc(_x_3);
      u32 _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      heap_free(e, cls_fit(2), _sp_0);
      _o_1 = _f_0;
      _o_2 = _f_1;
    } else {
      _o_0 = 1;
      u64 _sp_1 = term_loc(_x_3);
      Term _f_2 = e.mem[_sp_1 + 0];
      heap_free(e, cls_fit(1), _sp_1);
      _o_1 = _f_2;
    }
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID____SRC_GIT_LAND_LD_GO1_K1252;
      WL_PUSHN(1);
    } else {
      u64 _t_6 = task_node(e, FID____SRC_GIT_LAND_LD_GO1_K1252, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_GO1_K1252, _t_6);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_LD_TIP_OF)) {
      u64 _t_7 = task_node(e, FID____SRC_GIT_LAND_LD_TIP_OF, WL_CONT, WL_IDX, 0);
      e.mem[_t_7 + 0] = _o_0;
      e.mem[_t_7 + 1] = _o_1;
      e.mem[_t_7 + 2] = _o_2;
      e.mem[_t_7 + 3] = _r_13;
      return term_tsk(FID____SRC_GIT_LAND_LD_TIP_OF, _t_7);
    }
    r0 = _o_0;
    r1 = _o_1;
    r2 = _o_2;
    r3 = _r_13;
    WL_JMP(FID____SRC_GIT_LAND_LD_TIP_OF);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO1_K1252)
  {
    u32 _h_3 = r0;
    Term _h_4 = r1;
    Term _h_5 = r2;
    Term _h_6 = r3;
    WL_OPEN
    u64 _nd_9 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_9 + 0] = _h_3;
    e.mem[_nd_9 + 1] = _h_4;
    e.mem[_nd_9 + 2] = _h_5;
    e.mem[_nd_9 + 3] = _h_6;
    r0 = term_clo(FID____SRC_GIT_LAND_LD_GO1_C1253, _nd_9);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_GO1_C1253)
  {
    u32 _h_7 = r0;
    Term _h_8 = r1;
    Term _h_9 = r2;
    Term _h_10 = r3;
    Term _x_4 = r4;
    WL_OPEN
    Term _b_0 = 0;
    if (_h_7 == 0) {
      u64 _nd_10 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_10 + 0] = _h_8;
      e.mem[_nd_10 + 1] = _h_9;
      e.mem[_nd_10 + 2] = _h_10;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDDONE, _nd_10);
    } else if (_h_7 == 1) {
      u64 _nd_11 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_11 + 0] = _h_8;
      e.mem[_nd_11 + 1] = _h_9;
      e.mem[_nd_11 + 2] = _h_10;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_11);
    } else if (_h_7 == 2) {
      u64 _nd_12 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_12 + 0] = _h_8;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDWK, _nd_12);
    } else if (_h_7 == 3) {
      u64 _nd_13 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_13 + 0] = _h_8;
      e.mem[_nd_13 + 1] = _h_9;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDTIP, _nd_13);
    } else if (_h_7 == 4) {
      u64 _nd_14 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_14 + 0] = _h_8;
      e.mem[_nd_14 + 1] = _h_9;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDCAND, _nd_14);
    } else {
      u64 _nd_15 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_15 + 0] = _h_8;
      e.mem[_nd_15 + 1] = _h_9;
      _b_0 = term_ctr(CID____SRC_GIT_LAND_LDRE, _nd_15);
    }
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_8 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_8 + 0] = _b_0;
      e.mem[_t_8 + 1] = _x_4;
      return term_tsk(FID_IO_PURE, _t_8);
    }
    r0 = _b_0;
    r1 = _x_4;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_STAGE1)
  {
    Term _repo_0 = r0;
    Term _target_0 = r1;
    Term _worker_0 = r2;
    WL_OPEN
    _worker_0 = term_keep(e, _worker_0);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _repo_0;
      STK(1) = _target_0;
      STK(2) = _worker_0;
      STK(3) = FID____SRC_GIT_LAND_LD_STAGE1_K1255;
      WL_PUSHN(4);
    } else {
      u64 _t_0 = task_node(e, FID____SRC_GIT_LAND_LD_STAGE1_K1255, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _repo_0;
      e.mem[_t_0 + 1] = _target_0;
      e.mem[_t_0 + 2] = _worker_0;
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_STAGE1_K1255, _t_0);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _worker_0;
      e.mem[_t_1 + 1] = term_ctr(CID_SCON, STAT_OFF + 1125);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_1);
    }
    r0 = _worker_0;
    r1 = term_ctr(CID_SCON, STAT_OFF + 1125);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_STAGE1_K1255)
  {
    WL_POPN(3);
    Term _repo_1 = STK(0);
    Term _target_1 = STK(1);
    Term _worker_1 = STK(2);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_0 + 0] = _h_0;
    e.mem[_nd_0 + 1] = term_pak(CID_NIL, 0);
    u64 _nd_1 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 3024);
    e.mem[_nd_1 + 1] = term_ctr(CID_CON, _nd_0);
    u64 _nd_2 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_2 + 0] = term_ctr(CID_SCON, STAT_OFF + 1139);
    e.mem[_nd_2 + 1] = term_ctr(CID_CON, _nd_1);
    u64 _nd_3 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_3 + 0] = term_ctr(CID_SCON, STAT_OFF + 127);
    e.mem[_nd_3 + 1] = term_ctr(CID_CON, _nd_2);
    _repo_1 = term_keep(e, _repo_1);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _repo_1;
      STK(1) = _target_1;
      STK(2) = _worker_1;
      STK(3) = FID____SRC_GIT_LAND_LD_STAGE1_K1256;
      WL_PUSHN(4);
    } else {
      u64 _t_2 = task_node(e, FID____SRC_GIT_LAND_LD_STAGE1_K1256, WL_CONT, WL_IDX, 1);
      e.mem[_t_2 + 0] = _repo_1;
      e.mem[_t_2 + 1] = _target_1;
      e.mem[_t_2 + 2] = _worker_1;
      WL_CONT = term_tsk(FID____SRC_GIT_LAND_LD_STAGE1_K1256, _t_2);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _repo_1;
      e.mem[_t_3 + 1] = term_ctr(CID_CON, _nd_3);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_3);
    }
    r0 = _repo_1;
    r1 = term_ctr(CID_CON, _nd_3);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_STAGE1_K1256)
  {
    WL_POPN(3);
    Term _repo_2 = STK(0);
    Term _target_2 = STK(1);
    Term _worker_2 = STK(2);
    Term _h_1 = r0;
    WL_OPEN
    u64 _nd_4 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_4 + 0] = _repo_2;
    e.mem[_nd_4 + 1] = _target_2;
    e.mem[_nd_4 + 2] = _worker_2;
    e.mem[_nd_4 + 3] = _h_1;
    r0 = term_clo(FID____SRC_GIT_LAND_LD_STAGE1_C1257, _nd_4);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_STAGE1_C1257)
  {
    Term _repo_3 = r0;
    Term _target_3 = r1;
    Term _worker_3 = r2;
    Term _h_2 = r3;
    Term _x_0 = r4;
    WL_OPEN
    u64 _nd_5 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_5 + 0] = _repo_3;
    e.mem[_nd_5 + 1] = _target_3;
    e.mem[_nd_5 + 2] = _worker_3;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_5 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _h_2;
      e.mem[_t_5 + 1] = term_clo(FID____SRC_GIT_LAND_LD_STAGE1_C1258, _nd_5);
      e.mem[_t_5 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_5);
    }
    r0 = _h_2;
    r1 = term_clo(FID____SRC_GIT_LAND_LD_STAGE1_C1258, _nd_5);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_STAGE1_C1258)
  {
    Term _repo_4 = r0;
    Term _target_4 = r1;
    Term _worker_4 = r2;
    Term _x_1 = r3;
    WL_OPEN
    u32 _o_0 = 0;
    Term _o_1 = 0;
    Term _o_2 = 0;
    if (term_aux(_x_1) == CID____SRC_GIT_TYPES_GRUN) {
      _o_0 = 0;
      u64 _sp_0 = term_loc(_x_1);
      u32 _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      heap_free(e, cls_fit(2), _sp_0);
      _o_1 = _f_0;
      _o_2 = _f_1;
    } else {
      _o_0 = 1;
      u64 _sp_1 = term_loc(_x_1);
      Term _f_2 = e.mem[_sp_1 + 0];
      heap_free(e, cls_fit(1), _sp_1);
      _o_1 = _f_2;
    }
    Term _v_0 = 0;
    Term _o_4[1];
    if (spin_56(e, _o_4, _o_0, _o_1, _o_2, _repo_4, _target_4, _worker_4) == 0) {
      return 0;
    }
    _v_0 = _o_4[0];
    r0 = _v_0;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_RESOLVED_PICK_C1259)
  {
    Term _g_3 = r0;
    Term _x_2 = r1;
    WL_OPEN
    u64 _nd_7 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_7 + 0] = 4;
    e.mem[_nd_7 + 1] = term_ctr(CID_SCON, STAT_OFF + 46);
    e.mem[_nd_7 + 2] = _g_3;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_4 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_7);
      e.mem[_t_4 + 1] = _x_2;
      return term_tsk(FID_IO_PURE, _t_4);
    }
    r0 = term_ctr(CID____SRC_GIT_LAND_LDFAIL, _nd_7);
    r1 = _x_2;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_PICK)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
    Term _r_2 = r2;
    Term _base_0 = r3;
    WL_OPEN
    if (_r_0 == 0) {
      u32 _s_0 = U32_BIN(_r_1, ==, 0ull);
      if (_s_0 == 1) {
        term_sink(e, _base_0);
        if (seq) {
          WL_ROOM(1);
          STK(0) = FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_PICK_K1278;
          WL_PUSHN(1);
        } else {
          u64 _t_0 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_PICK_K1278, WL_CONT, WL_IDX, 1);
          WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_PICK_K1278, _t_0);
          WL_IDX = 0;
        }
        if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
          u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
          e.mem[_t_1 + 0] = _r_2;
          return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_1);
        }
        r0 = _r_2;
        WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
      } else {
        term_sink(e, _r_2);
        r0 = 1;
        r1 = 2;
        r2 = _base_0;
        r3 = 0;
        WL_RETN(4);
      }
    } else {
      term_sink(e, _base_0);
      r0 = 1;
      r1 = 4;
      r2 = term_ctr(CID_SCON, STAT_OFF + 2260);
      r3 = _r_1;
      WL_RETN(4);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_PICK_K1278)
  {
    Term _h_0 = r0;
    WL_OPEN
    r0 = 2;
    r1 = _h_0;
    r2 = 0;
    r3 = 0;
    WL_RETN(4);
  }}
#endif

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
        e.mem[_nd_0 + 0] = rfc_seal(e, U32_BIN(48ull, +, ((u32)(_a_1) == 0 ? _n_0 : U32_BIN(_n_0, -, U32_QUO((u32)(_n_0), (u32)(_a_1)) * _a_1))));
        e.mem[_nd_0 + 1] = rfc_seal(e, _acc_0);
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
  WL_CASE(FID____SRC_GIT_TEXT_STR_EQ)
  {
    Term _a_0 = r0;
    Term _b_0 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_EQ_GO)) {
      u64 _t_0 = task_node(e, FID____SRC_GIT_TEXT_STR_EQ_GO, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = _a_0;
      e.mem[_t_0 + 1] = _b_0;
      return term_tsk(FID____SRC_GIT_TEXT_STR_EQ_GO, _t_0);
    }
    r0 = _a_0;
    r1 = _b_0;
    WL_JMP(FID____SRC_GIT_TEXT_STR_EQ_GO);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IS_LANDED)
  {
    u32 _r_0 = r0;
    u32 _r_1 = r1;
    Term _r_2 = r2;
    Term _r_3 = r3;
    Term _want_0 = r4;
    WL_OPEN
    if (_r_0 == 1) {
      if (_r_1 == 0) {
        term_sink(e, _r_2);
        if (seq) {
          WL_ROOM(2);
          STK(0) = _r_3;
          STK(1) = FID_IS_LANDED_K1464;
          WL_PUSHN(2);
        } else {
          u64 _t_0 = task_node(e, FID_IS_LANDED_K1464, WL_CONT, WL_IDX, 1);
          e.mem[_t_0 + 0] = _r_3;
          WL_CONT = term_tsk(FID_IS_LANDED_K1464, _t_0);
          WL_IDX = 1;
        }
        if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_EQ)) {
          u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_STR_EQ, WL_CONT, WL_IDX, 0);
          e.mem[_t_1 + 0] = _r_3;
          e.mem[_t_1 + 1] = _want_0;
          return term_tsk(FID____SRC_GIT_TEXT_STR_EQ, _t_1);
        }
        r0 = _r_3;
        r1 = _want_0;
        WL_JMP(FID____SRC_GIT_TEXT_STR_EQ);
      } else if (_r_1 == 1) {
        term_sink(e, _r_2);
        term_sink(e, _want_0);
        r0 = term_ctr(CID_SCON, STAT_OFF + 3180);
        WL_RETN(1);
      } else if (_r_1 == 2) {
        term_sink(e, _r_3);
        term_sink(e, _want_0);
        if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
          u64 _t_2 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
          e.mem[_t_2 + 0] = term_ctr(CID_SCON, STAT_OFF + 3236);
          e.mem[_t_2 + 1] = _r_2;
          return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_2);
        }
        r0 = term_ctr(CID_SCON, STAT_OFF + 3236);
        r1 = _r_2;
        WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
      } else {
        term_sink(e, _want_0);
        if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
          u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
          e.mem[_t_3 + 0] = term_ctr(CID_SCON, STAT_OFF + 3262);
          e.mem[_t_3 + 1] = _r_2;
          return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_3);
        }
        r0 = term_ctr(CID_SCON, STAT_OFF + 3262);
        r1 = _r_2;
        WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
      }
    } else {
      term_sink(e, _want_0);
      if (seq) {
        WL_ROOM(1);
        STK(0) = FID_IS_LANDED_K1465;
        WL_PUSHN(1);
      } else {
        u64 _t_4 = task_node(e, FID_IS_LANDED_K1465, WL_CONT, WL_IDX, 1);
        WL_CONT = term_tsk(FID_IS_LANDED_K1465, _t_4);
        WL_IDX = 0;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TYPES_FAIL_TEXT)) {
        u64 _t_5 = task_node(e, FID____SRC_GIT_TYPES_FAIL_TEXT, WL_CONT, WL_IDX, 0);
        e.mem[_t_5 + 0] = _r_1;
        e.mem[_t_5 + 1] = _r_2;
        e.mem[_t_5 + 2] = _r_3;
        return term_tsk(FID____SRC_GIT_TYPES_FAIL_TEXT, _t_5);
      }
      r0 = _r_1;
      r1 = _r_2;
      r2 = _r_3;
      WL_JMP(FID____SRC_GIT_TYPES_FAIL_TEXT);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IS_LANDED_K1464)
  {
    WL_POPN(1);
    Term _r_4 = STK(0);
    u32 _h_0 = r0;
    WL_OPEN
    term_sink(e, _r_4);
    Term _v_0 = 0;
    Term _o_0[1];
    if (spin_45(e, _o_0, _h_0, term_ctr(CID_SCON, STAT_OFF + 3126)) == 0) {
      return 0;
    }
    _v_0 = _o_0[0];
    r0 = _v_0;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IS_LANDED_K1465)
  {
    Term _h_1 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_IS_LANDED_K1466;
      WL_PUSHN(1);
    } else {
      u64 _t_6 = task_node(e, FID_IS_LANDED_K1466, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_IS_LANDED_K1466, _t_6);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
      u64 _t_7 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
      e.mem[_t_7 + 0] = _h_1;
      return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_7);
    }
    r0 = _h_1;
    WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IS_LANDED_K1466)
  {
    Term _h_2 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_8 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_8 + 0] = term_ctr(CID_SCON, STAT_OFF + 2065);
      e.mem[_t_8 + 1] = _h_2;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_8);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 2065);
    r1 = _h_2;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ANSWER_C1489)
  {
    u32 _r_4 = r0;
    Term _r_5 = r1;
    Term _r_6 = r2;
    Term _x_14 = r3;
    WL_OPEN
    Term _b_0 = 0;
    if (_r_4 == 0) {
      u64 _nd_14 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_14 + 0] = _r_5;
      e.mem[_nd_14 + 1] = _r_6;
      _b_0 = term_ctr(CID____SRC_GIT_TYPES_LLANDED, _nd_14);
    } else if (_r_4 == 1) {
      u64 _nd_15 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_15 + 0] = _r_5;
      _b_0 = term_ctr(CID____SRC_GIT_TYPES_LALREADY, _nd_15);
    } else if (_r_4 == 2) {
      u64 _nd_16 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_16 + 0] = _r_5;
      e.mem[_nd_16 + 1] = _r_6;
      _b_0 = term_ctr(CID____SRC_GIT_TYPES_LCONFLICT, _nd_16);
    } else {
      u64 _nd_17 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_17 + 0] = _r_5;
      _b_0 = term_ctr(CID____SRC_GIT_TYPES_LBLOCKED, _nd_17);
    }
    u64 _nd_18 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_18 + 0] = _b_0;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_14 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_14 + 0] = term_ctr(CID_DONE, _nd_18);
      e.mem[_t_14 + 1] = _x_14;
      return term_tsk(FID_IO_PURE, _t_14);
    }
    r0 = term_ctr(CID_DONE, _nd_18);
    r1 = _x_14;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ANSWER_C1490)
  {
    u32 _r_7 = r0;
    Term _r_8 = r1;
    Term _r_9 = r2;
    Term _x_15 = r3;
    WL_OPEN
    Term _b_1 = 0;
    if (_r_7 == 0) {
      u64 _nd_20 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_20 + 0] = _r_8;
      _b_1 = term_ctr(CID____SRC_GIT_TYPES_FBRANCHEXISTS, _nd_20);
    } else if (_r_7 == 1) {
      u64 _nd_21 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_21 + 0] = _r_8;
      _b_1 = term_ctr(CID____SRC_GIT_TYPES_FPATHEXISTS, _nd_21);
    } else if (_r_7 == 2) {
      u64 _nd_22 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_22 + 0] = _r_8;
      _b_1 = term_ctr(CID____SRC_GIT_TYPES_FUNKNOWNBASE, _nd_22);
    } else if (_r_7 == 3) {
      u64 _nd_23 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_23 + 0] = _r_8;
      _b_1 = term_ctr(CID____SRC_GIT_TYPES_FTARGETBUSY, _nd_23);
    } else {
      u64 _nd_24 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_24 + 0] = _r_8;
      e.mem[_nd_24 + 1] = _r_9;
      _b_1 = term_ctr(CID____SRC_GIT_TYPES_FCMD, _nd_24);
    }
    u64 _nd_25 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_25 + 0] = _b_1;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_15 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_15 + 0] = term_ctr(CID_FAIL, _nd_25);
      e.mem[_t_15 + 1] = _x_15;
      return term_tsk(FID_IO_PURE, _t_15);
    }
    r0 = term_ctr(CID_FAIL, _nd_25);
    r1 = _x_15;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ANSWER_C1491)
  {
    Term _x_16 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_16 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_16 + 0] = term_ctr(CID_FAIL, STAT_OFF + 3015);
      e.mem[_t_16 + 1] = _x_16;
      return term_tsk(FID_IO_PURE, _t_16);
    }
    r0 = term_ctr(CID_FAIL, STAT_OFF + 3015);
    r1 = _x_16;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ANSWER_C1492)
  {
    Term _x_17 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_17 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_17 + 0] = term_ctr(CID_FAIL, STAT_OFF + 3015);
      e.mem[_t_17 + 1] = _x_17;
      return term_tsk(FID_IO_PURE, _t_17);
    }
    r0 = term_ctr(CID_FAIL, STAT_OFF + 3015);
    r1 = _x_17;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ANSWER_C1493)
  {
    Term _x_18 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_18 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_18 + 0] = term_ctr(CID_FAIL, STAT_OFF + 3015);
      e.mem[_t_18 + 1] = _x_18;
      return term_tsk(FID_IO_PURE, _t_18);
    }
    r0 = term_ctr(CID_FAIL, STAT_OFF + 3015);
    r1 = _x_18;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_LAND_LD_ANSWER_C1494)
  {
    Term _x_19 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_19 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_19 + 0] = term_ctr(CID_FAIL, STAT_OFF + 3015);
      e.mem[_t_19 + 1] = _x_19;
      return term_tsk(FID_IO_PURE, _t_19);
    }
    r0 = term_ctr(CID_FAIL, STAT_OFF + 3015);
    r1 = _x_19;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
    Term _r_2 = r2;
    Term _r_3 = r3;
    Term _repo_0 = r4;
    Term _branch_0 = r5;
    Term _path_0 = r6;
    WL_OPEN
    if (_r_0 == 0) {
      term_sink(e, _repo_0);
      term_sink(e, _branch_0);
      term_sink(e, _path_0);
      u64 _nd_0 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_0 + 0] = _r_1;
      e.mem[_nd_0 + 1] = _r_2;
      e.mem[_nd_0 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C1500, _nd_0);
      WL_RETN(1);
    } else if (_r_0 == 1) {
      term_sink(e, _repo_0);
      term_sink(e, _branch_0);
      term_sink(e, _path_0);
      u64 _nd_2 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_2 + 0] = _r_1;
      e.mem[_nd_2 + 1] = _r_2;
      e.mem[_nd_2 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C1501, _nd_2);
      WL_RETN(1);
    } else {
      _branch_0 = term_keep(e, _branch_0);
      _path_0 = term_keep(e, _path_0);
      _r_1 = term_keep(e, _r_1);
      u64 _nd_4 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_4 + 0] = _r_1;
      e.mem[_nd_4 + 1] = term_pak(CID_NIL, 0);
      u64 _nd_5 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_5 + 0] = _path_0;
      e.mem[_nd_5 + 1] = term_ctr(CID_CON, _nd_4);
      u64 _nd_6 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_6 + 0] = _branch_0;
      e.mem[_nd_6 + 1] = term_ctr(CID_CON, _nd_5);
      u64 _nd_7 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_7 + 0] = term_ctr(CID_SCON, STAT_OFF + 3028);
      e.mem[_nd_7 + 1] = term_ctr(CID_CON, _nd_6);
      u64 _nd_8 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_8 + 0] = term_ctr(CID_SCON, STAT_OFF + 975);
      e.mem[_nd_8 + 1] = term_ctr(CID_CON, _nd_7);
      u64 _nd_9 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_9 + 0] = term_ctr(CID_SCON, STAT_OFF + 971);
      e.mem[_nd_9 + 1] = term_ctr(CID_CON, _nd_8);
      if (seq) {
        WL_ROOM(4);
        STK(0) = _branch_0;
        STK(1) = _path_0;
        STK(2) = _r_1;
        STK(3) = FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K1502;
        WL_PUSHN(4);
      } else {
        u64 _t_2 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K1502, WL_CONT, WL_IDX, 1);
        e.mem[_t_2 + 0] = _branch_0;
        e.mem[_t_2 + 1] = _path_0;
        e.mem[_t_2 + 2] = _r_1;
        WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K1502, _t_2);
        WL_IDX = 3;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
        u64 _t_3 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
        e.mem[_t_3 + 0] = _repo_0;
        e.mem[_t_3 + 1] = term_ctr(CID_CON, _nd_9);
        return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_3);
      }
      r0 = _repo_0;
      r1 = term_ctr(CID_CON, _nd_9);
      WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C1500)
  {
    Term _r_4 = r0;
    Term _r_5 = r1;
    Term _r_6 = r2;
    Term _x_0 = r3;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_1 + 0] = _r_4;
    e.mem[_nd_1 + 1] = _r_5;
    e.mem[_nd_1 + 2] = _r_6;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_0 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWDONE, _nd_1);
      e.mem[_t_0 + 1] = _x_0;
      return term_tsk(FID_IO_PURE, _t_0);
    }
    r0 = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWDONE, _nd_1);
    r1 = _x_0;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C1501)
  {
    u32 _r_7 = r0;
    Term _r_8 = r1;
    Term _r_9 = r2;
    Term _x_1 = r3;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_3 + 0] = _r_7;
    e.mem[_nd_3 + 1] = _r_8;
    e.mem[_nd_3 + 2] = _r_9;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_1 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWFAIL, _nd_3);
      e.mem[_t_1 + 1] = _x_1;
      return term_tsk(FID_IO_PURE, _t_1);
    }
    r0 = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWFAIL, _nd_3);
    r1 = _x_1;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K1502)
  {
    WL_POPN(3);
    Term _branch_1 = STK(0);
    Term _path_1 = STK(1);
    Term _r_10 = STK(2);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_10 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_10 + 0] = _branch_1;
    e.mem[_nd_10 + 1] = _path_1;
    e.mem[_nd_10 + 2] = _r_10;
    e.mem[_nd_10 + 3] = _h_0;
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C1503, _nd_10);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C1503)
  {
    Term _branch_2 = r0;
    Term _path_2 = r1;
    Term _r_11 = r2;
    Term _h_1 = r3;
    Term _x_2 = r4;
    WL_OPEN
    u64 _nd_11 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_11 + 0] = _branch_2;
    e.mem[_nd_11 + 1] = _path_2;
    e.mem[_nd_11 + 2] = _r_11;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_7 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_7 + 0] = _h_1;
      e.mem[_t_7 + 1] = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C1504, _nd_11);
      e.mem[_t_7 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_7);
    }
    r0 = _h_1;
    r1 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C1504, _nd_11);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C1504)
  {
    Term _branch_3 = r0;
    Term _path_3 = r1;
    Term _r_12 = r2;
    Term _x_3 = r3;
    WL_OPEN
    u32 _o_0 = 0;
    Term _o_1 = 0;
    Term _o_2 = 0;
    if (term_aux(_x_3) == CID____SRC_GIT_TYPES_GRUN) {
      _o_0 = 0;
      u64 _sp_0 = term_loc(_x_3);
      u32 _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      heap_free(e, cls_fit(2), _sp_0);
      _o_1 = _f_0;
      _o_2 = _f_1;
    } else {
      _o_0 = 1;
      u64 _sp_1 = term_loc(_x_3);
      Term _f_2 = e.mem[_sp_1 + 0];
      heap_free(e, cls_fit(1), _sp_1);
      _o_1 = _f_2;
    }
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K1505;
      WL_PUSHN(1);
    } else {
      u64 _t_4 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K1505, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K1505, _t_4);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE4_PICK)) {
      u64 _t_5 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE4_PICK, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _o_0;
      e.mem[_t_5 + 1] = _o_1;
      e.mem[_t_5 + 2] = _o_2;
      e.mem[_t_5 + 3] = _r_12;
      e.mem[_t_5 + 4] = _branch_3;
      e.mem[_t_5 + 5] = _path_3;
      return term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE4_PICK, _t_5);
    }
    r0 = _o_0;
    r1 = _o_1;
    r2 = _o_2;
    r3 = _r_12;
    r4 = _branch_3;
    r5 = _path_3;
    WL_JMP(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE4_PICK);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K1505)
  {
    u32 _h_2 = r0;
    Term _h_3 = r1;
    Term _h_4 = r2;
    Term _h_5 = r3;
    WL_OPEN
    u64 _nd_12 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_12 + 0] = _h_2;
    e.mem[_nd_12 + 1] = _h_3;
    e.mem[_nd_12 + 2] = _h_4;
    e.mem[_nd_12 + 3] = _h_5;
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C1506, _nd_12);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C1506)
  {
    u32 _h_6 = r0;
    Term _h_7 = r1;
    Term _h_8 = r2;
    Term _h_9 = r3;
    Term _x_4 = r4;
    WL_OPEN
    Term _b_0 = 0;
    if (_h_6 == 0) {
      u64 _nd_13 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_13 + 0] = _h_7;
      e.mem[_nd_13 + 1] = _h_8;
      e.mem[_nd_13 + 2] = _h_9;
      _b_0 = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWDONE, _nd_13);
    } else if (_h_6 == 1) {
      u64 _nd_14 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_14 + 0] = _h_7;
      e.mem[_nd_14 + 1] = _h_8;
      e.mem[_nd_14 + 2] = _h_9;
      _b_0 = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWFAIL, _nd_14);
    } else {
      u64 _nd_15 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_15 + 0] = _h_7;
      _b_0 = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWNEXT, _nd_15);
    }
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_6 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_6 + 0] = _b_0;
      e.mem[_t_6 + 1] = _x_4;
      return term_tsk(FID_IO_PURE, _t_6);
    }
    r0 = _b_0;
    r1 = _x_4;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
    Term _r_2 = r2;
    Term _r_3 = r3;
    Term _repo_0 = r4;
    Term _branch_0 = r5;
    Term _path_0 = r6;
    WL_OPEN
    if (_r_0 == 0) {
      term_sink(e, _repo_0);
      term_sink(e, _path_0);
      u64 _nd_0 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_0 + 0] = _r_1;
      e.mem[_nd_0 + 1] = _r_2;
      e.mem[_nd_0 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C1508, _nd_0);
      WL_RETN(1);
    } else if (_r_0 == 1) {
      term_sink(e, _repo_0);
      term_sink(e, _path_0);
      u64 _nd_2 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_2 + 0] = _r_1;
      e.mem[_nd_2 + 1] = _r_2;
      e.mem[_nd_2 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C1509, _nd_2);
      WL_RETN(1);
    } else {
      _path_0 = term_keep(e, _path_0);
      u64 _nd_4 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_4 + 0] = _path_0;
      e.mem[_nd_4 + 1] = term_pak(CID_NIL, 0);
      u64 _nd_5 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_5 + 0] = term_ctr(CID_SCON, STAT_OFF + 3046);
      e.mem[_nd_5 + 1] = term_ctr(CID_CON, _nd_4);
      u64 _nd_6 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_6 + 0] = term_ctr(CID_SCON, STAT_OFF + 3042);
      e.mem[_nd_6 + 1] = term_ctr(CID_CON, _nd_5);
      u64 _nd_7 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_7 + 0] = term_ctr(CID_SCON, STAT_OFF + 3040);
      e.mem[_nd_7 + 1] = term_ctr(CID_CON, _nd_6);
      if (seq) {
        WL_ROOM(3);
        STK(0) = _r_1;
        STK(1) = _path_0;
        STK(2) = FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_K1510;
        WL_PUSHN(3);
      } else {
        u64 _t_2 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_K1510, WL_CONT, WL_IDX, 1);
        e.mem[_t_2 + 0] = _r_1;
        e.mem[_t_2 + 1] = _path_0;
        WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_K1510, _t_2);
        WL_IDX = 2;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
        u64 _t_3 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
        e.mem[_t_3 + 0] = term_ctr(CID_CON, _nd_7);
        e.mem[_t_3 + 1] = _repo_0;
        return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_3);
      }
      r0 = term_ctr(CID_CON, _nd_7);
      r1 = _repo_0;
      WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C1508)
  {
    Term _r_4 = r0;
    Term _r_5 = r1;
    Term _r_6 = r2;
    Term _x_0 = r3;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_1 + 0] = _r_4;
    e.mem[_nd_1 + 1] = _r_5;
    e.mem[_nd_1 + 2] = _r_6;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_0 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWDONE, _nd_1);
      e.mem[_t_0 + 1] = _x_0;
      return term_tsk(FID_IO_PURE, _t_0);
    }
    r0 = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWDONE, _nd_1);
    r1 = _x_0;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C1509)
  {
    u32 _r_7 = r0;
    Term _r_8 = r1;
    Term _r_9 = r2;
    Term _x_1 = r3;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_3 + 0] = _r_7;
    e.mem[_nd_3 + 1] = _r_8;
    e.mem[_nd_3 + 2] = _r_9;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_1 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWFAIL, _nd_3);
      e.mem[_t_1 + 1] = _x_1;
      return term_tsk(FID_IO_PURE, _t_1);
    }
    r0 = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWFAIL, _nd_3);
    r1 = _x_1;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_K1510)
  {
    WL_POPN(2);
    Term _r_10 = STK(0);
    Term _path_1 = STK(1);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_8 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_8 + 0] = _r_10;
    e.mem[_nd_8 + 1] = _path_1;
    e.mem[_nd_8 + 2] = _h_0;
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C1511, _nd_8);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C1511)
  {
    Term _r_11 = r0;
    Term _path_2 = r1;
    Term _h_1 = r2;
    Term _x_2 = r3;
    WL_OPEN
    u64 _nd_9 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_9 + 0] = _r_11;
    e.mem[_nd_9 + 1] = _path_2;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_5 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _h_1;
      e.mem[_t_5 + 1] = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C1512, _nd_9);
      e.mem[_t_5 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_5);
    }
    r0 = _h_1;
    r1 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C1512, _nd_9);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C1512)
  {
    Term _r_12 = r0;
    Term _path_3 = r1;
    Term _x_3 = r2;
    WL_OPEN
    u32 _o_0 = 0;
    Term _o_1 = 0;
    u32 _o_2 = 0;
    Term _o_3 = 0;
    if (term_aux(_x_3) == CID____SRC_GIT_TYPES_RRUN) {
      _o_0 = 0;
      Term _fb_0[3];
      u64 _sp_0 = ctr_take(e, _x_3, 3, _fb_0);
      u32 _f_0 = _fb_0[0];
      u32 _f_1 = _fb_0[1];
      Term _f_2 = _fb_0[2];
      spare_free(e, cls_fit(3), _sp_0);
      _o_1 = _f_0;
      _o_2 = _f_1;
      _o_3 = _f_2;
    } else {
      _o_0 = 1;
      u64 _sp_1 = term_loc(_x_3);
      Term _f_3 = e.mem[_sp_1 + 0];
      heap_free(e, cls_fit(1), _sp_1);
      _o_1 = _f_3;
    }
    u64 _nd_10 = heap_alloc(e, cls_fit(6));
    e.mem[_nd_10 + 0] = _r_12;
    e.mem[_nd_10 + 1] = _path_3;
    e.mem[_nd_10 + 2] = _o_0;
    e.mem[_nd_10 + 3] = _o_1;
    e.mem[_nd_10 + 4] = _o_2;
    e.mem[_nd_10 + 5] = _o_3;
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C1513, _nd_10);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C1513)
  {
    Term _r_13 = r0;
    Term _path_4 = r1;
    u32 _o_4 = r2;
    Term _o_5 = r3;
    u32 _o_6 = r4;
    Term _o_7 = r5;
    Term _x_4 = r6;
    WL_OPEN
    u32 _v_0 = 0;
    Term _v_1 = 0;
    Term _v_2 = 0;
    Term _v_3 = 0;
    u32 _v_4 = 0;
    Term _v_5 = 0;
    Term _v_6 = 0;
    Term _v_7 = 0;
    Term _o_8[4];
    if (spin_57(e, _o_8, _o_4, _o_5, _o_6, _o_7, _r_13, _path_4) == 0) {
      return 0;
    }
    _v_4 = _o_8[0];
    _v_5 = _o_8[1];
    _v_6 = _o_8[2];
    _v_7 = _o_8[3];
    _v_0 = _v_4;
    _v_1 = _v_5;
    _v_2 = _v_6;
    _v_3 = _v_7;
    Term _b_0 = 0;
    if (_v_0 == 0) {
      u64 _nd_11 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_11 + 0] = _v_1;
      e.mem[_nd_11 + 1] = _v_2;
      e.mem[_nd_11 + 2] = _v_3;
      _b_0 = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWDONE, _nd_11);
    } else if (_v_0 == 1) {
      u64 _nd_12 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_12 + 0] = _v_1;
      e.mem[_nd_12 + 1] = _v_2;
      e.mem[_nd_12 + 2] = _v_3;
      _b_0 = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWFAIL, _nd_12);
    } else {
      u64 _nd_13 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_13 + 0] = _v_1;
      _b_0 = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWNEXT, _nd_13);
    }
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_4 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = _b_0;
      e.mem[_t_4 + 1] = _x_4;
      return term_tsk(FID_IO_PURE, _t_4);
    }
    r0 = _b_0;
    r1 = _x_4;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
    Term _r_2 = r2;
    Term _r_3 = r3;
    Term _repo_0 = r4;
    Term _branch_0 = r5;
    Term _path_0 = r6;
    WL_OPEN
    if (_r_0 == 0) {
      term_sink(e, _repo_0);
      term_sink(e, _branch_0);
      u64 _nd_0 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_0 + 0] = _r_1;
      e.mem[_nd_0 + 1] = _r_2;
      e.mem[_nd_0 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C1515, _nd_0);
      WL_RETN(1);
    } else if (_r_0 == 1) {
      term_sink(e, _repo_0);
      term_sink(e, _branch_0);
      u64 _nd_2 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_2 + 0] = _r_1;
      e.mem[_nd_2 + 1] = _r_2;
      e.mem[_nd_2 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C1516, _nd_2);
      WL_RETN(1);
    } else {
      _branch_0 = term_keep(e, _branch_0);
      if (seq) {
        WL_ROOM(4);
        STK(0) = _r_1;
        STK(1) = _repo_0;
        STK(2) = _branch_0;
        STK(3) = FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K1517;
        WL_PUSHN(4);
      } else {
        u64 _t_2 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K1517, WL_CONT, WL_IDX, 1);
        e.mem[_t_2 + 0] = _r_1;
        e.mem[_t_2 + 1] = _repo_0;
        e.mem[_t_2 + 2] = _branch_0;
        WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K1517, _t_2);
        WL_IDX = 3;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
        u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
        e.mem[_t_3 + 0] = term_ctr(CID_SCON, STAT_OFF + 363);
        e.mem[_t_3 + 1] = _branch_0;
        return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_3);
      }
      r0 = term_ctr(CID_SCON, STAT_OFF + 363);
      r1 = _branch_0;
      WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C1515)
  {
    Term _r_4 = r0;
    Term _r_5 = r1;
    Term _r_6 = r2;
    Term _x_0 = r3;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_1 + 0] = _r_4;
    e.mem[_nd_1 + 1] = _r_5;
    e.mem[_nd_1 + 2] = _r_6;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_0 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWDONE, _nd_1);
      e.mem[_t_0 + 1] = _x_0;
      return term_tsk(FID_IO_PURE, _t_0);
    }
    r0 = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWDONE, _nd_1);
    r1 = _x_0;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C1516)
  {
    u32 _r_7 = r0;
    Term _r_8 = r1;
    Term _r_9 = r2;
    Term _x_1 = r3;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_3 + 0] = _r_7;
    e.mem[_nd_3 + 1] = _r_8;
    e.mem[_nd_3 + 2] = _r_9;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_1 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWFAIL, _nd_3);
      e.mem[_t_1 + 1] = _x_1;
      return term_tsk(FID_IO_PURE, _t_1);
    }
    r0 = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWFAIL, _nd_3);
    r1 = _x_1;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K1517)
  {
    WL_POPN(3);
    Term _r_10 = STK(0);
    Term _repo_1 = STK(1);
    Term _branch_1 = STK(2);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_4 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_4 + 0] = _h_0;
    e.mem[_nd_4 + 1] = term_pak(CID_NIL, 0);
    u64 _nd_5 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_5 + 0] = term_ctr(CID_SCON, STAT_OFF + 3024);
    e.mem[_nd_5 + 1] = term_ctr(CID_CON, _nd_4);
    u64 _nd_6 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_6 + 0] = term_ctr(CID_SCON, STAT_OFF + 1139);
    e.mem[_nd_6 + 1] = term_ctr(CID_CON, _nd_5);
    u64 _nd_7 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_7 + 0] = term_ctr(CID_SCON, STAT_OFF + 127);
    e.mem[_nd_7 + 1] = term_ctr(CID_CON, _nd_6);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _r_10;
      STK(1) = _branch_1;
      STK(2) = FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K1518;
      WL_PUSHN(3);
    } else {
      u64 _t_4 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K1518, WL_CONT, WL_IDX, 1);
      e.mem[_t_4 + 0] = _r_10;
      e.mem[_t_4 + 1] = _branch_1;
      WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K1518, _t_4);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
      u64 _t_5 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _repo_1;
      e.mem[_t_5 + 1] = term_ctr(CID_CON, _nd_7);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_5);
    }
    r0 = _repo_1;
    r1 = term_ctr(CID_CON, _nd_7);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K1518)
  {
    WL_POPN(2);
    Term _r_11 = STK(0);
    Term _branch_2 = STK(1);
    Term _h_1 = r0;
    WL_OPEN
    u64 _nd_8 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_8 + 0] = _r_11;
    e.mem[_nd_8 + 1] = _branch_2;
    e.mem[_nd_8 + 2] = _h_1;
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C1519, _nd_8);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C1519)
  {
    Term _r_12 = r0;
    Term _branch_3 = r1;
    Term _h_2 = r2;
    Term _x_2 = r3;
    WL_OPEN
    u64 _nd_9 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_9 + 0] = _r_12;
    e.mem[_nd_9 + 1] = _branch_3;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_7 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_7 + 0] = _h_2;
      e.mem[_t_7 + 1] = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C1520, _nd_9);
      e.mem[_t_7 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_7);
    }
    r0 = _h_2;
    r1 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C1520, _nd_9);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C1520)
  {
    Term _r_13 = r0;
    Term _branch_4 = r1;
    Term _x_3 = r2;
    WL_OPEN
    u32 _o_0 = 0;
    Term _o_1 = 0;
    Term _o_2 = 0;
    if (term_aux(_x_3) == CID____SRC_GIT_TYPES_GRUN) {
      _o_0 = 0;
      u64 _sp_0 = term_loc(_x_3);
      u32 _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      heap_free(e, cls_fit(2), _sp_0);
      _o_1 = _f_0;
      _o_2 = _f_1;
    } else {
      _o_0 = 1;
      u64 _sp_1 = term_loc(_x_3);
      Term _f_2 = e.mem[_sp_1 + 0];
      heap_free(e, cls_fit(1), _sp_1);
      _o_1 = _f_2;
    }
    u64 _nd_10 = heap_alloc(e, cls_fit(5));
    e.mem[_nd_10 + 0] = _r_13;
    e.mem[_nd_10 + 1] = _branch_4;
    e.mem[_nd_10 + 2] = _o_0;
    e.mem[_nd_10 + 3] = _o_1;
    e.mem[_nd_10 + 4] = _o_2;
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C1521, _nd_10);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C1521)
  {
    Term _r_14 = r0;
    Term _branch_5 = r1;
    u32 _o_3 = r2;
    Term _o_4 = r3;
    Term _o_5 = r4;
    Term _x_4 = r5;
    WL_OPEN
    u32 _v_0 = 0;
    Term _v_1 = 0;
    Term _v_2 = 0;
    Term _v_3 = 0;
    u32 _v_4 = 0;
    Term _v_5 = 0;
    Term _v_6 = 0;
    Term _v_7 = 0;
    Term _o_6[4];
    if (spin_58(e, _o_6, _o_3, _o_4, _o_5, _r_14, _branch_5) == 0) {
      return 0;
    }
    _v_4 = _o_6[0];
    _v_5 = _o_6[1];
    _v_6 = _o_6[2];
    _v_7 = _o_6[3];
    _v_0 = _v_4;
    _v_1 = _v_5;
    _v_2 = _v_6;
    _v_3 = _v_7;
    Term _b_0 = 0;
    if (_v_0 == 0) {
      u64 _nd_11 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_11 + 0] = _v_1;
      e.mem[_nd_11 + 1] = _v_2;
      e.mem[_nd_11 + 2] = _v_3;
      _b_0 = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWDONE, _nd_11);
    } else if (_v_0 == 1) {
      u64 _nd_12 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_12 + 0] = _v_1;
      e.mem[_nd_12 + 1] = _v_2;
      e.mem[_nd_12 + 2] = _v_3;
      _b_0 = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWFAIL, _nd_12);
    } else {
      u64 _nd_13 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_13 + 0] = _v_1;
      _b_0 = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWNEXT, _nd_13);
    }
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_6 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_6 + 0] = _b_0;
      e.mem[_t_6 + 1] = _x_4;
      return term_tsk(FID_IO_PURE, _t_6);
    }
    r0 = _b_0;
    r1 = _x_4;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1)
  {
    Term _repo_0 = r0;
    Term _branch_0 = r1;
    Term _path_0 = r2;
    Term _base_0 = r3;
    WL_OPEN
    _base_0 = term_keep(e, _base_0);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _repo_0;
      STK(1) = _base_0;
      STK(2) = FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K1523;
      WL_PUSHN(3);
    } else {
      u64 _t_0 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K1523, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _repo_0;
      e.mem[_t_0 + 1] = _base_0;
      WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K1523, _t_0);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _base_0;
      e.mem[_t_1 + 1] = term_ctr(CID_SCON, STAT_OFF + 1125);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_1);
    }
    r0 = _base_0;
    r1 = term_ctr(CID_SCON, STAT_OFF + 1125);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K1523)
  {
    WL_POPN(2);
    Term _repo_1 = STK(0);
    Term _base_1 = STK(1);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_0 + 0] = _h_0;
    e.mem[_nd_0 + 1] = term_pak(CID_NIL, 0);
    u64 _nd_1 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 3024);
    e.mem[_nd_1 + 1] = term_ctr(CID_CON, _nd_0);
    u64 _nd_2 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_2 + 0] = term_ctr(CID_SCON, STAT_OFF + 1139);
    e.mem[_nd_2 + 1] = term_ctr(CID_CON, _nd_1);
    u64 _nd_3 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_3 + 0] = term_ctr(CID_SCON, STAT_OFF + 127);
    e.mem[_nd_3 + 1] = term_ctr(CID_CON, _nd_2);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _base_1;
      STK(1) = FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K1524;
      WL_PUSHN(2);
    } else {
      u64 _t_2 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K1524, WL_CONT, WL_IDX, 1);
      e.mem[_t_2 + 0] = _base_1;
      WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K1524, _t_2);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _repo_1;
      e.mem[_t_3 + 1] = term_ctr(CID_CON, _nd_3);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_3);
    }
    r0 = _repo_1;
    r1 = term_ctr(CID_CON, _nd_3);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K1524)
  {
    WL_POPN(1);
    Term _base_2 = STK(0);
    Term _h_1 = r0;
    WL_OPEN
    u64 _nd_4 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_4 + 0] = _base_2;
    e.mem[_nd_4 + 1] = _h_1;
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C1525, _nd_4);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C1525)
  {
    Term _base_3 = r0;
    Term _h_2 = r1;
    Term _x_0 = r2;
    WL_OPEN
    u64 _nd_5 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_5 + 0] = _base_3;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_7 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_7 + 0] = _h_2;
      e.mem[_t_7 + 1] = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C1526, _nd_5);
      e.mem[_t_7 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_7);
    }
    r0 = _h_2;
    r1 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C1526, _nd_5);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C1526)
  {
    Term _base_4 = r0;
    Term _x_1 = r1;
    WL_OPEN
    u32 _o_0 = 0;
    Term _o_1 = 0;
    Term _o_2 = 0;
    if (term_aux(_x_1) == CID____SRC_GIT_TYPES_GRUN) {
      _o_0 = 0;
      u64 _sp_0 = term_loc(_x_1);
      u32 _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      heap_free(e, cls_fit(2), _sp_0);
      _o_1 = _f_0;
      _o_2 = _f_1;
    } else {
      _o_0 = 1;
      u64 _sp_1 = term_loc(_x_1);
      Term _f_2 = e.mem[_sp_1 + 0];
      heap_free(e, cls_fit(1), _sp_1);
      _o_1 = _f_2;
    }
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K1527;
      WL_PUSHN(1);
    } else {
      u64 _t_4 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K1527, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K1527, _t_4);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_PICK)) {
      u64 _t_5 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_PICK, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _o_0;
      e.mem[_t_5 + 1] = _o_1;
      e.mem[_t_5 + 2] = _o_2;
      e.mem[_t_5 + 3] = _base_4;
      return term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_PICK, _t_5);
    }
    r0 = _o_0;
    r1 = _o_1;
    r2 = _o_2;
    r3 = _base_4;
    WL_JMP(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_PICK);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K1527)
  {
    u32 _h_3 = r0;
    Term _h_4 = r1;
    Term _h_5 = r2;
    Term _h_6 = r3;
    WL_OPEN
    u64 _nd_6 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_6 + 0] = _h_3;
    e.mem[_nd_6 + 1] = _h_4;
    e.mem[_nd_6 + 2] = _h_5;
    e.mem[_nd_6 + 3] = _h_6;
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C1528, _nd_6);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C1528)
  {
    u32 _h_7 = r0;
    Term _h_8 = r1;
    Term _h_9 = r2;
    Term _h_10 = r3;
    Term _x_2 = r4;
    WL_OPEN
    Term _b_0 = 0;
    if (_h_7 == 0) {
      u64 _nd_7 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_7 + 0] = _h_8;
      e.mem[_nd_7 + 1] = _h_9;
      e.mem[_nd_7 + 2] = _h_10;
      _b_0 = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWDONE, _nd_7);
    } else if (_h_7 == 1) {
      u64 _nd_8 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_8 + 0] = _h_8;
      e.mem[_nd_8 + 1] = _h_9;
      e.mem[_nd_8 + 2] = _h_10;
      _b_0 = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWFAIL, _nd_8);
    } else {
      u64 _nd_9 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_9 + 0] = _h_8;
      _b_0 = term_ctr(CID____SRC_GIT_CREATE_WORKTREE_CWNEXT, _nd_9);
    }
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_6 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_6 + 0] = _b_0;
      e.mem[_t_6 + 1] = _x_2;
      return term_tsk(FID_IO_PURE, _t_6);
    }
    r0 = _b_0;
    r1 = _x_2;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_BLOB_OF)
  {
    Term _r_0 = r0;
    Term _path_0 = r1;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _r_0;
      STK(1) = FID_BLOB_OF_K1717;
      WL_PUSHN(2);
    } else {
      u64 _t_0 = task_node(e, FID_BLOB_OF_K1717, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _r_0;
      WL_CONT = term_tsk(FID_BLOB_OF_K1717, _t_0);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 3307);
      e.mem[_t_1 + 1] = _path_0;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_1);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 3307);
    r1 = _path_0;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_BLOB_OF_K1717)
  {
    WL_POPN(1);
    Term _r_1 = STK(0);
    Term _p2_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_0 + 0] = _p2_0;
    e.mem[_nd_0 + 1] = term_pak(CID_NIL, 0);
    u64 _nd_1 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 3315);
    e.mem[_nd_1 + 1] = term_ctr(CID_CON, _nd_0);
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_BLOB_OF_K1718;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID_BLOB_OF_K1718, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_BLOB_OF_K1718, _t_2);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _r_1;
      e.mem[_t_3 + 1] = term_ctr(CID_CON, _nd_1);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_3);
    }
    r0 = _r_1;
    r1 = term_ctr(CID_CON, _nd_1);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_BLOB_OF_K1718)
  {
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_2 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_2 + 0] = _h_0;
    r0 = term_clo(FID_BLOB_OF_C1719, _nd_2);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_BLOB_OF_C1719)
  {
    Term _h_1 = r0;
    Term _x_0 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_7 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_7 + 0] = _h_1;
      e.mem[_t_7 + 1] = term_clo(FID_BLOB_OF_C1720, 0);
      e.mem[_t_7 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_7);
    }
    r0 = _h_1;
    r1 = term_clo(FID_BLOB_OF_C1720, 0);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_BLOB_OF_C1720)
  {
    Term _x_1 = r0;
    WL_OPEN
    u32 _o_0 = 0;
    Term _o_1 = 0;
    Term _o_2 = 0;
    if (term_aux(_x_1) == CID____SRC_GIT_TYPES_GRUN) {
      _o_0 = 0;
      u64 _sp_0 = term_loc(_x_1);
      u32 _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      heap_free(e, cls_fit(2), _sp_0);
      _o_1 = _f_0;
      _o_2 = _f_1;
    } else {
      _o_0 = 1;
      u64 _sp_1 = term_loc(_x_1);
      Term _f_2 = e.mem[_sp_1 + 0];
      heap_free(e, cls_fit(1), _sp_1);
      _o_1 = _f_2;
    }
    Term _v_0 = 0;
    Term _v_1 = 0;
    Term _o_3[1];
    if (spin_47(e, _o_3, _o_0, _o_1, _o_2) == 0) {
      return 0;
    }
    _v_1 = _o_3[0];
    _v_0 = _v_1;
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_BLOB_OF_K1721;
      WL_PUSHN(1);
    } else {
      u64 _t_4 = task_node(e, FID_BLOB_OF_K1721, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_BLOB_OF_K1721, _t_4);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
      u64 _t_5 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _v_0;
      return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_5);
    }
    r0 = _v_0;
    WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_BLOB_OF_K1721)
  {
    Term _h_2 = r0;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_3 + 0] = _h_2;
    r0 = term_clo(FID_BLOB_OF_C1722, _nd_3);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_BLOB_OF_C1722)
  {
    Term _h_3 = r0;
    Term _x_2 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_6 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_6 + 0] = _h_3;
      e.mem[_t_6 + 1] = _x_2;
      return term_tsk(FID_IO_PURE, _t_6);
    }
    r0 = _h_3;
    r1 = _x_2;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_HEAD_OF)
  {
    Term _r_0 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_HEAD_OF_K1724;
      WL_PUSHN(1);
    } else {
      u64 _t_0 = task_node(e, FID_HEAD_OF_K1724, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_HEAD_OF_K1724, _t_0);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _r_0;
      e.mem[_t_1 + 1] = term_ctr(CID_CON, STAT_OFF + 3317);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_1);
    }
    r0 = _r_0;
    r1 = term_ctr(CID_CON, STAT_OFF + 3317);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_HEAD_OF_K1724)
  {
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_0 + 0] = _h_0;
    r0 = term_clo(FID_HEAD_OF_C1725, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_HEAD_OF_C1725)
  {
    Term _h_1 = r0;
    Term _x_0 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_5 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _h_1;
      e.mem[_t_5 + 1] = term_clo(FID_HEAD_OF_C1726, 0);
      e.mem[_t_5 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_5);
    }
    r0 = _h_1;
    r1 = term_clo(FID_HEAD_OF_C1726, 0);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_HEAD_OF_C1726)
  {
    Term _x_1 = r0;
    WL_OPEN
    u32 _o_0 = 0;
    Term _o_1 = 0;
    Term _o_2 = 0;
    if (term_aux(_x_1) == CID____SRC_GIT_TYPES_GRUN) {
      _o_0 = 0;
      u64 _sp_0 = term_loc(_x_1);
      u32 _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      heap_free(e, cls_fit(2), _sp_0);
      _o_1 = _f_0;
      _o_2 = _f_1;
    } else {
      _o_0 = 1;
      u64 _sp_1 = term_loc(_x_1);
      Term _f_2 = e.mem[_sp_1 + 0];
      heap_free(e, cls_fit(1), _sp_1);
      _o_1 = _f_2;
    }
    Term _v_0 = 0;
    Term _v_1 = 0;
    Term _o_3[1];
    if (spin_47(e, _o_3, _o_0, _o_1, _o_2) == 0) {
      return 0;
    }
    _v_1 = _o_3[0];
    _v_0 = _v_1;
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_HEAD_OF_K1727;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID_HEAD_OF_K1727, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_HEAD_OF_K1727, _t_2);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _v_0;
      return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_3);
    }
    r0 = _v_0;
    WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_HEAD_OF_K1727)
  {
    Term _h_2 = r0;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_1 + 0] = _h_2;
    r0 = term_clo(FID_HEAD_OF_C1728, _nd_1);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_HEAD_OF_C1728)
  {
    Term _h_3 = r0;
    Term _x_2 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_4 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = _h_3;
      e.mem[_t_4 + 1] = _x_2;
      return term_tsk(FID_IO_PURE, _t_4);
    }
    r0 = _h_3;
    r1 = _x_2;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LAND_OK)
  {
    Term _r_0 = r0;
    Term _target_0 = r1;
    Term _worker_0 = r2;
    Term _files_0 = r3;
    Term _script_0 = r4;
    Term _scratch_0 = r5;
    WL_OPEN
    _r_0 = term_keep(e, _r_0);
    _target_0 = term_keep(e, _target_0);
    if (seq) {
      WL_ROOM(6);
      STK(0) = _files_0;
      STK(1) = _r_0;
      STK(2) = _target_0;
      STK(3) = _script_0;
      STK(4) = _scratch_0;
      STK(5) = FID_LAND_OK_K1730;
      WL_PUSHN(6);
    } else {
      u64 _t_0 = task_node(e, FID_LAND_OK_K1730, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _files_0;
      e.mem[_t_0 + 1] = _r_0;
      e.mem[_t_0 + 2] = _target_0;
      e.mem[_t_0 + 3] = _script_0;
      e.mem[_t_0 + 4] = _scratch_0;
      WL_CONT = term_tsk(FID_LAND_OK_K1730, _t_0);
      WL_IDX = 5;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_LD_STAGE1)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_LAND_LD_STAGE1, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _r_0;
      e.mem[_t_1 + 1] = _target_0;
      e.mem[_t_1 + 2] = _worker_0;
      return term_tsk(FID____SRC_GIT_LAND_LD_STAGE1, _t_1);
    }
    r0 = _r_0;
    r1 = _target_0;
    r2 = _worker_0;
    WL_JMP(FID____SRC_GIT_LAND_LD_STAGE1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LAND_OK_K1730)
  {
    WL_POPN(5);
    Term _files_1 = STK(0);
    Term _r_1 = STK(1);
    Term _target_1 = STK(2);
    Term _script_1 = STK(3);
    Term _scratch_1 = STK(4);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(6));
    e.mem[_nd_0 + 0] = _files_1;
    e.mem[_nd_0 + 1] = _r_1;
    e.mem[_nd_0 + 2] = _target_1;
    e.mem[_nd_0 + 3] = _script_1;
    e.mem[_nd_0 + 4] = _scratch_1;
    e.mem[_nd_0 + 5] = _h_0;
    r0 = term_clo(FID_LAND_OK_C1731, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LAND_OK_C1731)
  {
    Term _files_2 = r0;
    Term _r_2 = r1;
    Term _target_2 = r2;
    Term _script_2 = r3;
    Term _scratch_2 = r4;
    Term _h_1 = r5;
    Term _x_0 = r6;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(5));
    e.mem[_nd_1 + 0] = _files_2;
    e.mem[_nd_1 + 1] = _r_2;
    e.mem[_nd_1 + 2] = _target_2;
    e.mem[_nd_1 + 3] = _script_2;
    e.mem[_nd_1 + 4] = _scratch_2;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_20 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_20 + 0] = _h_1;
      e.mem[_t_20 + 1] = term_clo(FID_LAND_OK_C1732, _nd_1);
      e.mem[_t_20 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_20);
    }
    r0 = _h_1;
    r1 = term_clo(FID_LAND_OK_C1732, _nd_1);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LAND_OK_C1732)
  {
    Term _files_3 = r0;
    Term _r_3 = r1;
    Term _target_3 = r2;
    Term _script_3 = r3;
    Term _scratch_3 = r4;
    Term _x_1 = r5;
    WL_OPEN
    u32 _o_0 = 0;
    Term _o_1 = 0;
    Term _o_2 = 0;
    Term _o_3 = 0;
    if (term_aux(_x_1) == CID____SRC_GIT_LAND_LDDONE) {
      _o_0 = 0;
      u64 _sp_0 = term_loc(_x_1);
      u32 _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      Term _f_2 = e.mem[_sp_0 + 2];
      heap_free(e, cls_fit(3), _sp_0);
      _o_1 = _f_0;
      _o_2 = _f_1;
      _o_3 = _f_2;
    } else if (term_aux(_x_1) == CID____SRC_GIT_LAND_LDFAIL) {
      _o_0 = 1;
      Term _fb_0[3];
      u64 _sp_1 = ctr_take(e, _x_1, 3, _fb_0);
      u32 _f_3 = _fb_0[0];
      Term _f_4 = _fb_0[1];
      Term _f_5 = _fb_0[2];
      spare_free(e, cls_fit(3), _sp_1);
      _o_1 = _f_3;
      _o_2 = _f_4;
      _o_3 = _f_5;
    } else if (term_aux(_x_1) == CID____SRC_GIT_LAND_LDWK) {
      _o_0 = 2;
      u64 _sp_2 = term_loc(_x_1);
      Term _f_6 = e.mem[_sp_2 + 0];
      heap_free(e, cls_fit(1), _sp_2);
      _o_1 = _f_6;
    } else if (term_aux(_x_1) == CID____SRC_GIT_LAND_LDTIP) {
      _o_0 = 3;
      u64 _sp_3 = term_loc(_x_1);
      Term _f_7 = e.mem[_sp_3 + 0];
      Term _f_8 = e.mem[_sp_3 + 1];
      heap_free(e, cls_fit(2), _sp_3);
      _o_1 = _f_7;
      _o_2 = _f_8;
    } else if (term_aux(_x_1) == CID____SRC_GIT_LAND_LDCAND) {
      _o_0 = 4;
      u64 _sp_4 = term_loc(_x_1);
      Term _f_9 = e.mem[_sp_4 + 0];
      Term _f_10 = e.mem[_sp_4 + 1];
      heap_free(e, cls_fit(2), _sp_4);
      _o_1 = _f_9;
      _o_2 = _f_10;
    } else {
      _o_0 = 5;
      u64 _sp_5 = term_loc(_x_1);
      Term _f_11 = e.mem[_sp_5 + 0];
      Term _f_12 = e.mem[_sp_5 + 1];
      heap_free(e, cls_fit(2), _sp_5);
      _o_1 = _f_11;
      _o_2 = _f_12;
    }
    _r_3 = term_keep(e, _r_3);
    _target_3 = term_keep(e, _target_3);
    if (seq) {
      WL_ROOM(6);
      STK(0) = _files_3;
      STK(1) = _r_3;
      STK(2) = _target_3;
      STK(3) = _script_3;
      STK(4) = _scratch_3;
      STK(5) = FID_LAND_OK_K1733;
      WL_PUSHN(6);
    } else {
      u64 _t_2 = task_node(e, FID_LAND_OK_K1733, WL_CONT, WL_IDX, 1);
      e.mem[_t_2 + 0] = _files_3;
      e.mem[_t_2 + 1] = _r_3;
      e.mem[_t_2 + 2] = _target_3;
      e.mem[_t_2 + 3] = _script_3;
      e.mem[_t_2 + 4] = _scratch_3;
      WL_CONT = term_tsk(FID_LAND_OK_K1733, _t_2);
      WL_IDX = 5;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_LD_GO1)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_LAND_LD_GO1, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _o_0;
      e.mem[_t_3 + 1] = _o_1;
      e.mem[_t_3 + 2] = _o_2;
      e.mem[_t_3 + 3] = _o_3;
      e.mem[_t_3 + 4] = _r_3;
      e.mem[_t_3 + 5] = _target_3;
      return term_tsk(FID____SRC_GIT_LAND_LD_GO1, _t_3);
    }
    r0 = _o_0;
    r1 = _o_1;
    r2 = _o_2;
    r3 = _o_3;
    r4 = _r_3;
    r5 = _target_3;
    WL_JMP(FID____SRC_GIT_LAND_LD_GO1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LAND_OK_K1733)
  {
    WL_POPN(5);
    Term _files_4 = STK(0);
    Term _r_4 = STK(1);
    Term _target_4 = STK(2);
    Term _script_4 = STK(3);
    Term _scratch_4 = STK(4);
    Term _h_2 = r0;
    WL_OPEN
    u64 _nd_2 = heap_alloc(e, cls_fit(6));
    e.mem[_nd_2 + 0] = _files_4;
    e.mem[_nd_2 + 1] = _r_4;
    e.mem[_nd_2 + 2] = _target_4;
    e.mem[_nd_2 + 3] = _script_4;
    e.mem[_nd_2 + 4] = _scratch_4;
    e.mem[_nd_2 + 5] = _h_2;
    r0 = term_clo(FID_LAND_OK_C1734, _nd_2);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LAND_OK_C1734)
  {
    Term _files_5 = r0;
    Term _r_5 = r1;
    Term _target_5 = r2;
    Term _script_5 = r3;
    Term _scratch_5 = r4;
    Term _h_3 = r5;
    Term _x_2 = r6;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(5));
    e.mem[_nd_3 + 0] = _files_5;
    e.mem[_nd_3 + 1] = _r_5;
    e.mem[_nd_3 + 2] = _target_5;
    e.mem[_nd_3 + 3] = _script_5;
    e.mem[_nd_3 + 4] = _scratch_5;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_19 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_19 + 0] = _h_3;
      e.mem[_t_19 + 1] = term_clo(FID_LAND_OK_C1735, _nd_3);
      e.mem[_t_19 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_19);
    }
    r0 = _h_3;
    r1 = term_clo(FID_LAND_OK_C1735, _nd_3);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LAND_OK_C1735)
  {
    Term _files_6 = r0;
    Term _r_6 = r1;
    Term _target_6 = r2;
    Term _script_6 = r3;
    Term _scratch_6 = r4;
    Term _x_3 = r5;
    WL_OPEN
    u32 _o_4 = 0;
    Term _o_5 = 0;
    Term _o_6 = 0;
    Term _o_7 = 0;
    if (term_aux(_x_3) == CID____SRC_GIT_LAND_LDDONE) {
      _o_4 = 0;
      u64 _sp_6 = term_loc(_x_3);
      u32 _f_13 = e.mem[_sp_6 + 0];
      Term _f_14 = e.mem[_sp_6 + 1];
      Term _f_15 = e.mem[_sp_6 + 2];
      heap_free(e, cls_fit(3), _sp_6);
      _o_5 = _f_13;
      _o_6 = _f_14;
      _o_7 = _f_15;
    } else if (term_aux(_x_3) == CID____SRC_GIT_LAND_LDFAIL) {
      _o_4 = 1;
      Term _fb_1[3];
      u64 _sp_7 = ctr_take(e, _x_3, 3, _fb_1);
      u32 _f_16 = _fb_1[0];
      Term _f_17 = _fb_1[1];
      Term _f_18 = _fb_1[2];
      spare_free(e, cls_fit(3), _sp_7);
      _o_5 = _f_16;
      _o_6 = _f_17;
      _o_7 = _f_18;
    } else if (term_aux(_x_3) == CID____SRC_GIT_LAND_LDWK) {
      _o_4 = 2;
      u64 _sp_8 = term_loc(_x_3);
      Term _f_19 = e.mem[_sp_8 + 0];
      heap_free(e, cls_fit(1), _sp_8);
      _o_5 = _f_19;
    } else if (term_aux(_x_3) == CID____SRC_GIT_LAND_LDTIP) {
      _o_4 = 3;
      u64 _sp_9 = term_loc(_x_3);
      Term _f_20 = e.mem[_sp_9 + 0];
      Term _f_21 = e.mem[_sp_9 + 1];
      heap_free(e, cls_fit(2), _sp_9);
      _o_5 = _f_20;
      _o_6 = _f_21;
    } else if (term_aux(_x_3) == CID____SRC_GIT_LAND_LDCAND) {
      _o_4 = 4;
      u64 _sp_10 = term_loc(_x_3);
      Term _f_22 = e.mem[_sp_10 + 0];
      Term _f_23 = e.mem[_sp_10 + 1];
      heap_free(e, cls_fit(2), _sp_10);
      _o_5 = _f_22;
      _o_6 = _f_23;
    } else {
      _o_4 = 5;
      u64 _sp_11 = term_loc(_x_3);
      Term _f_24 = e.mem[_sp_11 + 0];
      Term _f_25 = e.mem[_sp_11 + 1];
      heap_free(e, cls_fit(2), _sp_11);
      _o_5 = _f_24;
      _o_6 = _f_25;
    }
    _r_6 = term_keep(e, _r_6);
    _scratch_6 = term_keep(e, _scratch_6);
    if (seq) {
      WL_ROOM(6);
      STK(0) = _files_6;
      STK(1) = _r_6;
      STK(2) = _target_6;
      STK(3) = _script_6;
      STK(4) = _scratch_6;
      STK(5) = FID_LAND_OK_K1736;
      WL_PUSHN(6);
    } else {
      u64 _t_4 = task_node(e, FID_LAND_OK_K1736, WL_CONT, WL_IDX, 1);
      e.mem[_t_4 + 0] = _files_6;
      e.mem[_t_4 + 1] = _r_6;
      e.mem[_t_4 + 2] = _target_6;
      e.mem[_t_4 + 3] = _script_6;
      e.mem[_t_4 + 4] = _scratch_6;
      WL_CONT = term_tsk(FID_LAND_OK_K1736, _t_4);
      WL_IDX = 5;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_LD_GO2)) {
      u64 _t_5 = task_node(e, FID____SRC_GIT_LAND_LD_GO2, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _o_4;
      e.mem[_t_5 + 1] = _o_5;
      e.mem[_t_5 + 2] = _o_6;
      e.mem[_t_5 + 3] = _o_7;
      e.mem[_t_5 + 4] = _r_6;
      e.mem[_t_5 + 5] = _scratch_6;
      return term_tsk(FID____SRC_GIT_LAND_LD_GO2, _t_5);
    }
    r0 = _o_4;
    r1 = _o_5;
    r2 = _o_6;
    r3 = _o_7;
    r4 = _r_6;
    r5 = _scratch_6;
    WL_JMP(FID____SRC_GIT_LAND_LD_GO2);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LAND_OK_K1736)
  {
    WL_POPN(5);
    Term _files_7 = STK(0);
    Term _r_7 = STK(1);
    Term _target_7 = STK(2);
    Term _script_7 = STK(3);
    Term _scratch_7 = STK(4);
    Term _h_4 = r0;
    WL_OPEN
    u64 _nd_4 = heap_alloc(e, cls_fit(6));
    e.mem[_nd_4 + 0] = _files_7;
    e.mem[_nd_4 + 1] = _r_7;
    e.mem[_nd_4 + 2] = _target_7;
    e.mem[_nd_4 + 3] = _script_7;
    e.mem[_nd_4 + 4] = _scratch_7;
    e.mem[_nd_4 + 5] = _h_4;
    r0 = term_clo(FID_LAND_OK_C1737, _nd_4);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LAND_OK_C1737)
  {
    Term _files_8 = r0;
    Term _r_8 = r1;
    Term _target_8 = r2;
    Term _script_8 = r3;
    Term _scratch_8 = r4;
    Term _h_5 = r5;
    Term _x_4 = r6;
    WL_OPEN
    u64 _nd_5 = heap_alloc(e, cls_fit(5));
    e.mem[_nd_5 + 0] = _files_8;
    e.mem[_nd_5 + 1] = _r_8;
    e.mem[_nd_5 + 2] = _target_8;
    e.mem[_nd_5 + 3] = _script_8;
    e.mem[_nd_5 + 4] = _scratch_8;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_18 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_18 + 0] = _h_5;
      e.mem[_t_18 + 1] = term_clo(FID_LAND_OK_C1738, _nd_5);
      e.mem[_t_18 + 2] = _x_4;
      return term_tsk(FID_IO_BIND, _t_18);
    }
    r0 = _h_5;
    r1 = term_clo(FID_LAND_OK_C1738, _nd_5);
    r2 = _x_4;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LAND_OK_C1738)
  {
    Term _files_9 = r0;
    Term _r_9 = r1;
    Term _target_9 = r2;
    Term _script_9 = r3;
    Term _scratch_9 = r4;
    Term _x_5 = r5;
    WL_OPEN
    u32 _o_8 = 0;
    Term _o_9 = 0;
    Term _o_10 = 0;
    Term _o_11 = 0;
    if (term_aux(_x_5) == CID____SRC_GIT_LAND_LDDONE) {
      _o_8 = 0;
      u64 _sp_12 = term_loc(_x_5);
      u32 _f_26 = e.mem[_sp_12 + 0];
      Term _f_27 = e.mem[_sp_12 + 1];
      Term _f_28 = e.mem[_sp_12 + 2];
      heap_free(e, cls_fit(3), _sp_12);
      _o_9 = _f_26;
      _o_10 = _f_27;
      _o_11 = _f_28;
    } else if (term_aux(_x_5) == CID____SRC_GIT_LAND_LDFAIL) {
      _o_8 = 1;
      Term _fb_2[3];
      u64 _sp_13 = ctr_take(e, _x_5, 3, _fb_2);
      u32 _f_29 = _fb_2[0];
      Term _f_30 = _fb_2[1];
      Term _f_31 = _fb_2[2];
      spare_free(e, cls_fit(3), _sp_13);
      _o_9 = _f_29;
      _o_10 = _f_30;
      _o_11 = _f_31;
    } else if (term_aux(_x_5) == CID____SRC_GIT_LAND_LDWK) {
      _o_8 = 2;
      u64 _sp_14 = term_loc(_x_5);
      Term _f_32 = e.mem[_sp_14 + 0];
      heap_free(e, cls_fit(1), _sp_14);
      _o_9 = _f_32;
    } else if (term_aux(_x_5) == CID____SRC_GIT_LAND_LDTIP) {
      _o_8 = 3;
      u64 _sp_15 = term_loc(_x_5);
      Term _f_33 = e.mem[_sp_15 + 0];
      Term _f_34 = e.mem[_sp_15 + 1];
      heap_free(e, cls_fit(2), _sp_15);
      _o_9 = _f_33;
      _o_10 = _f_34;
    } else if (term_aux(_x_5) == CID____SRC_GIT_LAND_LDCAND) {
      _o_8 = 4;
      u64 _sp_16 = term_loc(_x_5);
      Term _f_35 = e.mem[_sp_16 + 0];
      Term _f_36 = e.mem[_sp_16 + 1];
      heap_free(e, cls_fit(2), _sp_16);
      _o_9 = _f_35;
      _o_10 = _f_36;
    } else {
      _o_8 = 5;
      u64 _sp_17 = term_loc(_x_5);
      Term _f_37 = e.mem[_sp_17 + 0];
      Term _f_38 = e.mem[_sp_17 + 1];
      heap_free(e, cls_fit(2), _sp_17);
      _o_9 = _f_37;
      _o_10 = _f_38;
    }
    _scratch_9 = term_keep(e, _scratch_9);
    if (seq) {
      WL_ROOM(6);
      STK(0) = _files_9;
      STK(1) = _r_9;
      STK(2) = _target_9;
      STK(3) = _script_9;
      STK(4) = _scratch_9;
      STK(5) = FID_LAND_OK_K1739;
      WL_PUSHN(6);
    } else {
      u64 _t_6 = task_node(e, FID_LAND_OK_K1739, WL_CONT, WL_IDX, 1);
      e.mem[_t_6 + 0] = _files_9;
      e.mem[_t_6 + 1] = _r_9;
      e.mem[_t_6 + 2] = _target_9;
      e.mem[_t_6 + 3] = _script_9;
      e.mem[_t_6 + 4] = _scratch_9;
      WL_CONT = term_tsk(FID_LAND_OK_K1739, _t_6);
      WL_IDX = 5;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_LD_GO3)) {
      u64 _t_7 = task_node(e, FID____SRC_GIT_LAND_LD_GO3, WL_CONT, WL_IDX, 0);
      e.mem[_t_7 + 0] = _o_8;
      e.mem[_t_7 + 1] = _o_9;
      e.mem[_t_7 + 2] = _o_10;
      e.mem[_t_7 + 3] = _o_11;
      e.mem[_t_7 + 4] = _scratch_9;
      return term_tsk(FID____SRC_GIT_LAND_LD_GO3, _t_7);
    }
    r0 = _o_8;
    r1 = _o_9;
    r2 = _o_10;
    r3 = _o_11;
    r4 = _scratch_9;
    WL_JMP(FID____SRC_GIT_LAND_LD_GO3);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LAND_OK_K1739)
  {
    WL_POPN(5);
    Term _files_10 = STK(0);
    Term _r_10 = STK(1);
    Term _target_10 = STK(2);
    Term _script_10 = STK(3);
    Term _scratch_10 = STK(4);
    Term _h_6 = r0;
    WL_OPEN
    u64 _nd_6 = heap_alloc(e, cls_fit(6));
    e.mem[_nd_6 + 0] = _files_10;
    e.mem[_nd_6 + 1] = _r_10;
    e.mem[_nd_6 + 2] = _target_10;
    e.mem[_nd_6 + 3] = _script_10;
    e.mem[_nd_6 + 4] = _scratch_10;
    e.mem[_nd_6 + 5] = _h_6;
    r0 = term_clo(FID_LAND_OK_C1740, _nd_6);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LAND_OK_C1740)
  {
    Term _files_11 = r0;
    Term _r_11 = r1;
    Term _target_11 = r2;
    Term _script_11 = r3;
    Term _scratch_11 = r4;
    Term _h_7 = r5;
    Term _x_6 = r6;
    WL_OPEN
    u64 _nd_7 = heap_alloc(e, cls_fit(5));
    e.mem[_nd_7 + 0] = _files_11;
    e.mem[_nd_7 + 1] = _r_11;
    e.mem[_nd_7 + 2] = _target_11;
    e.mem[_nd_7 + 3] = _script_11;
    e.mem[_nd_7 + 4] = _scratch_11;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_17 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_17 + 0] = _h_7;
      e.mem[_t_17 + 1] = term_clo(FID_LAND_OK_C1741, _nd_7);
      e.mem[_t_17 + 2] = _x_6;
      return term_tsk(FID_IO_BIND, _t_17);
    }
    r0 = _h_7;
    r1 = term_clo(FID_LAND_OK_C1741, _nd_7);
    r2 = _x_6;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LAND_OK_C1741)
  {
    Term _files_12 = r0;
    Term _r_12 = r1;
    Term _target_12 = r2;
    Term _script_12 = r3;
    Term _scratch_12 = r4;
    Term _x_7 = r5;
    WL_OPEN
    u32 _o_12 = 0;
    Term _o_13 = 0;
    Term _o_14 = 0;
    Term _o_15 = 0;
    if (term_aux(_x_7) == CID____SRC_GIT_LAND_LDDONE) {
      _o_12 = 0;
      u64 _sp_18 = term_loc(_x_7);
      u32 _f_39 = e.mem[_sp_18 + 0];
      Term _f_40 = e.mem[_sp_18 + 1];
      Term _f_41 = e.mem[_sp_18 + 2];
      heap_free(e, cls_fit(3), _sp_18);
      _o_13 = _f_39;
      _o_14 = _f_40;
      _o_15 = _f_41;
    } else if (term_aux(_x_7) == CID____SRC_GIT_LAND_LDFAIL) {
      _o_12 = 1;
      Term _fb_3[3];
      u64 _sp_19 = ctr_take(e, _x_7, 3, _fb_3);
      u32 _f_42 = _fb_3[0];
      Term _f_43 = _fb_3[1];
      Term _f_44 = _fb_3[2];
      spare_free(e, cls_fit(3), _sp_19);
      _o_13 = _f_42;
      _o_14 = _f_43;
      _o_15 = _f_44;
    } else if (term_aux(_x_7) == CID____SRC_GIT_LAND_LDWK) {
      _o_12 = 2;
      u64 _sp_20 = term_loc(_x_7);
      Term _f_45 = e.mem[_sp_20 + 0];
      heap_free(e, cls_fit(1), _sp_20);
      _o_13 = _f_45;
    } else if (term_aux(_x_7) == CID____SRC_GIT_LAND_LDTIP) {
      _o_12 = 3;
      u64 _sp_21 = term_loc(_x_7);
      Term _f_46 = e.mem[_sp_21 + 0];
      Term _f_47 = e.mem[_sp_21 + 1];
      heap_free(e, cls_fit(2), _sp_21);
      _o_13 = _f_46;
      _o_14 = _f_47;
    } else if (term_aux(_x_7) == CID____SRC_GIT_LAND_LDCAND) {
      _o_12 = 4;
      u64 _sp_22 = term_loc(_x_7);
      Term _f_48 = e.mem[_sp_22 + 0];
      Term _f_49 = e.mem[_sp_22 + 1];
      heap_free(e, cls_fit(2), _sp_22);
      _o_13 = _f_48;
      _o_14 = _f_49;
    } else {
      _o_12 = 5;
      u64 _sp_23 = term_loc(_x_7);
      Term _f_50 = e.mem[_sp_23 + 0];
      Term _f_51 = e.mem[_sp_23 + 1];
      heap_free(e, cls_fit(2), _sp_23);
      _o_13 = _f_50;
      _o_14 = _f_51;
    }
    _scratch_12 = term_keep(e, _scratch_12);
    if (seq) {
      WL_ROOM(6);
      STK(0) = _files_12;
      STK(1) = _r_12;
      STK(2) = _target_12;
      STK(3) = _script_12;
      STK(4) = _scratch_12;
      STK(5) = FID_LAND_OK_K1742;
      WL_PUSHN(6);
    } else {
      u64 _t_8 = task_node(e, FID_LAND_OK_K1742, WL_CONT, WL_IDX, 1);
      e.mem[_t_8 + 0] = _files_12;
      e.mem[_t_8 + 1] = _r_12;
      e.mem[_t_8 + 2] = _target_12;
      e.mem[_t_8 + 3] = _script_12;
      e.mem[_t_8 + 4] = _scratch_12;
      WL_CONT = term_tsk(FID_LAND_OK_K1742, _t_8);
      WL_IDX = 5;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_LD_GO4)) {
      u64 _t_9 = task_node(e, FID____SRC_GIT_LAND_LD_GO4, WL_CONT, WL_IDX, 0);
      e.mem[_t_9 + 0] = _o_12;
      e.mem[_t_9 + 1] = _o_13;
      e.mem[_t_9 + 2] = _o_14;
      e.mem[_t_9 + 3] = _o_15;
      e.mem[_t_9 + 4] = _scratch_12;
      return term_tsk(FID____SRC_GIT_LAND_LD_GO4, _t_9);
    }
    r0 = _o_12;
    r1 = _o_13;
    r2 = _o_14;
    r3 = _o_15;
    r4 = _scratch_12;
    WL_JMP(FID____SRC_GIT_LAND_LD_GO4);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LAND_OK_K1742)
  {
    WL_POPN(5);
    Term _files_13 = STK(0);
    Term _r_13 = STK(1);
    Term _target_13 = STK(2);
    Term _script_13 = STK(3);
    Term _scratch_13 = STK(4);
    Term _h_8 = r0;
    WL_OPEN
    u64 _nd_8 = heap_alloc(e, cls_fit(6));
    e.mem[_nd_8 + 0] = _files_13;
    e.mem[_nd_8 + 1] = _r_13;
    e.mem[_nd_8 + 2] = _target_13;
    e.mem[_nd_8 + 3] = _script_13;
    e.mem[_nd_8 + 4] = _scratch_13;
    e.mem[_nd_8 + 5] = _h_8;
    r0 = term_clo(FID_LAND_OK_C1743, _nd_8);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LAND_OK_C1743)
  {
    Term _files_14 = r0;
    Term _r_14 = r1;
    Term _target_14 = r2;
    Term _script_14 = r3;
    Term _scratch_14 = r4;
    Term _h_9 = r5;
    Term _x_8 = r6;
    WL_OPEN
    u64 _nd_9 = heap_alloc(e, cls_fit(5));
    e.mem[_nd_9 + 0] = _files_14;
    e.mem[_nd_9 + 1] = _r_14;
    e.mem[_nd_9 + 2] = _target_14;
    e.mem[_nd_9 + 3] = _script_14;
    e.mem[_nd_9 + 4] = _scratch_14;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_16 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_16 + 0] = _h_9;
      e.mem[_t_16 + 1] = term_clo(FID_LAND_OK_C1744, _nd_9);
      e.mem[_t_16 + 2] = _x_8;
      return term_tsk(FID_IO_BIND, _t_16);
    }
    r0 = _h_9;
    r1 = term_clo(FID_LAND_OK_C1744, _nd_9);
    r2 = _x_8;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LAND_OK_C1744)
  {
    Term _files_15 = r0;
    Term _r_15 = r1;
    Term _target_15 = r2;
    Term _script_15 = r3;
    Term _scratch_15 = r4;
    Term _x_9 = r5;
    WL_OPEN
    u32 _o_16 = 0;
    Term _o_17 = 0;
    Term _o_18 = 0;
    Term _o_19 = 0;
    if (term_aux(_x_9) == CID____SRC_GIT_LAND_LDDONE) {
      _o_16 = 0;
      u64 _sp_24 = term_loc(_x_9);
      u32 _f_52 = e.mem[_sp_24 + 0];
      Term _f_53 = e.mem[_sp_24 + 1];
      Term _f_54 = e.mem[_sp_24 + 2];
      heap_free(e, cls_fit(3), _sp_24);
      _o_17 = _f_52;
      _o_18 = _f_53;
      _o_19 = _f_54;
    } else if (term_aux(_x_9) == CID____SRC_GIT_LAND_LDFAIL) {
      _o_16 = 1;
      Term _fb_4[3];
      u64 _sp_25 = ctr_take(e, _x_9, 3, _fb_4);
      u32 _f_55 = _fb_4[0];
      Term _f_56 = _fb_4[1];
      Term _f_57 = _fb_4[2];
      spare_free(e, cls_fit(3), _sp_25);
      _o_17 = _f_55;
      _o_18 = _f_56;
      _o_19 = _f_57;
    } else if (term_aux(_x_9) == CID____SRC_GIT_LAND_LDWK) {
      _o_16 = 2;
      u64 _sp_26 = term_loc(_x_9);
      Term _f_58 = e.mem[_sp_26 + 0];
      heap_free(e, cls_fit(1), _sp_26);
      _o_17 = _f_58;
    } else if (term_aux(_x_9) == CID____SRC_GIT_LAND_LDTIP) {
      _o_16 = 3;
      u64 _sp_27 = term_loc(_x_9);
      Term _f_59 = e.mem[_sp_27 + 0];
      Term _f_60 = e.mem[_sp_27 + 1];
      heap_free(e, cls_fit(2), _sp_27);
      _o_17 = _f_59;
      _o_18 = _f_60;
    } else if (term_aux(_x_9) == CID____SRC_GIT_LAND_LDCAND) {
      _o_16 = 4;
      u64 _sp_28 = term_loc(_x_9);
      Term _f_61 = e.mem[_sp_28 + 0];
      Term _f_62 = e.mem[_sp_28 + 1];
      heap_free(e, cls_fit(2), _sp_28);
      _o_17 = _f_61;
      _o_18 = _f_62;
    } else {
      _o_16 = 5;
      u64 _sp_29 = term_loc(_x_9);
      Term _f_63 = e.mem[_sp_29 + 0];
      Term _f_64 = e.mem[_sp_29 + 1];
      heap_free(e, cls_fit(2), _sp_29);
      _o_17 = _f_63;
      _o_18 = _f_64;
    }
    _r_15 = term_keep(e, _r_15);
    _target_15 = term_keep(e, _target_15);
    _scratch_15 = term_keep(e, _scratch_15);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _r_15;
      STK(1) = _target_15;
      STK(2) = _scratch_15;
      STK(3) = FID_LAND_OK_K1745;
      WL_PUSHN(4);
    } else {
      u64 _t_10 = task_node(e, FID_LAND_OK_K1745, WL_CONT, WL_IDX, 1);
      e.mem[_t_10 + 0] = _r_15;
      e.mem[_t_10 + 1] = _target_15;
      e.mem[_t_10 + 2] = _scratch_15;
      WL_CONT = term_tsk(FID_LAND_OK_K1745, _t_10);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_LD_GO5)) {
      u64 _t_11 = task_node(e, FID____SRC_GIT_LAND_LD_GO5, WL_CONT, WL_IDX, 0);
      e.mem[_t_11 + 0] = _o_16;
      e.mem[_t_11 + 1] = _o_17;
      e.mem[_t_11 + 2] = _o_18;
      e.mem[_t_11 + 3] = _o_19;
      e.mem[_t_11 + 4] = _r_15;
      e.mem[_t_11 + 5] = _target_15;
      e.mem[_t_11 + 6] = _script_15;
      e.mem[_t_11 + 7] = _files_15;
      e.mem[_t_11 + 8] = _scratch_15;
      return term_tsk(FID____SRC_GIT_LAND_LD_GO5, _t_11);
    }
    r0 = _o_16;
    r1 = _o_17;
    r2 = _o_18;
    r3 = _o_19;
    r4 = _r_15;
    r5 = _target_15;
    r6 = _script_15;
    r7 = _files_15;
    r8 = _scratch_15;
    WL_JMP(FID____SRC_GIT_LAND_LD_GO5);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LAND_OK_K1745)
  {
    WL_POPN(3);
    Term _r_16 = STK(0);
    Term _target_16 = STK(1);
    Term _scratch_16 = STK(2);
    Term _h_10 = r0;
    WL_OPEN
    u64 _nd_10 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_10 + 0] = _r_16;
    e.mem[_nd_10 + 1] = _target_16;
    e.mem[_nd_10 + 2] = _scratch_16;
    e.mem[_nd_10 + 3] = _h_10;
    r0 = term_clo(FID_LAND_OK_C1746, _nd_10);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LAND_OK_C1746)
  {
    Term _r_17 = r0;
    Term _target_17 = r1;
    Term _scratch_17 = r2;
    Term _h_11 = r3;
    Term _x_10 = r4;
    WL_OPEN
    u64 _nd_11 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_11 + 0] = _r_17;
    e.mem[_nd_11 + 1] = _target_17;
    e.mem[_nd_11 + 2] = _scratch_17;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_15 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_15 + 0] = _h_11;
      e.mem[_t_15 + 1] = term_clo(FID_LAND_OK_C1747, _nd_11);
      e.mem[_t_15 + 2] = _x_10;
      return term_tsk(FID_IO_BIND, _t_15);
    }
    r0 = _h_11;
    r1 = term_clo(FID_LAND_OK_C1747, _nd_11);
    r2 = _x_10;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LAND_OK_C1747)
  {
    Term _r_18 = r0;
    Term _target_18 = r1;
    Term _scratch_18 = r2;
    Term _x_11 = r3;
    WL_OPEN
    u32 _o_20 = 0;
    Term _o_21 = 0;
    Term _o_22 = 0;
    Term _o_23 = 0;
    if (term_aux(_x_11) == CID____SRC_GIT_LAND_LDDONE) {
      _o_20 = 0;
      u64 _sp_30 = term_loc(_x_11);
      u32 _f_65 = e.mem[_sp_30 + 0];
      Term _f_66 = e.mem[_sp_30 + 1];
      Term _f_67 = e.mem[_sp_30 + 2];
      heap_free(e, cls_fit(3), _sp_30);
      _o_21 = _f_65;
      _o_22 = _f_66;
      _o_23 = _f_67;
    } else if (term_aux(_x_11) == CID____SRC_GIT_LAND_LDFAIL) {
      _o_20 = 1;
      Term _fb_5[3];
      u64 _sp_31 = ctr_take(e, _x_11, 3, _fb_5);
      u32 _f_68 = _fb_5[0];
      Term _f_69 = _fb_5[1];
      Term _f_70 = _fb_5[2];
      spare_free(e, cls_fit(3), _sp_31);
      _o_21 = _f_68;
      _o_22 = _f_69;
      _o_23 = _f_70;
    } else if (term_aux(_x_11) == CID____SRC_GIT_LAND_LDWK) {
      _o_20 = 2;
      u64 _sp_32 = term_loc(_x_11);
      Term _f_71 = e.mem[_sp_32 + 0];
      heap_free(e, cls_fit(1), _sp_32);
      _o_21 = _f_71;
    } else if (term_aux(_x_11) == CID____SRC_GIT_LAND_LDTIP) {
      _o_20 = 3;
      u64 _sp_33 = term_loc(_x_11);
      Term _f_72 = e.mem[_sp_33 + 0];
      Term _f_73 = e.mem[_sp_33 + 1];
      heap_free(e, cls_fit(2), _sp_33);
      _o_21 = _f_72;
      _o_22 = _f_73;
    } else if (term_aux(_x_11) == CID____SRC_GIT_LAND_LDCAND) {
      _o_20 = 4;
      u64 _sp_34 = term_loc(_x_11);
      Term _f_74 = e.mem[_sp_34 + 0];
      Term _f_75 = e.mem[_sp_34 + 1];
      heap_free(e, cls_fit(2), _sp_34);
      _o_21 = _f_74;
      _o_22 = _f_75;
    } else {
      _o_20 = 5;
      u64 _sp_35 = term_loc(_x_11);
      Term _f_76 = e.mem[_sp_35 + 0];
      Term _f_77 = e.mem[_sp_35 + 1];
      heap_free(e, cls_fit(2), _sp_35);
      _o_21 = _f_76;
      _o_22 = _f_77;
    }
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_LAND_OK_K1748;
      WL_PUSHN(1);
    } else {
      u64 _t_12 = task_node(e, FID_LAND_OK_K1748, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_LAND_OK_K1748, _t_12);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_LAND_LD_GO6)) {
      u64 _t_13 = task_node(e, FID____SRC_GIT_LAND_LD_GO6, WL_CONT, WL_IDX, 0);
      e.mem[_t_13 + 0] = _o_20;
      e.mem[_t_13 + 1] = _o_21;
      e.mem[_t_13 + 2] = _o_22;
      e.mem[_t_13 + 3] = _o_23;
      e.mem[_t_13 + 4] = _r_18;
      e.mem[_t_13 + 5] = _target_18;
      e.mem[_t_13 + 6] = _scratch_18;
      return term_tsk(FID____SRC_GIT_LAND_LD_GO6, _t_13);
    }
    r0 = _o_20;
    r1 = _o_21;
    r2 = _o_22;
    r3 = _o_23;
    r4 = _r_18;
    r5 = _target_18;
    r6 = _scratch_18;
    WL_JMP(FID____SRC_GIT_LAND_LD_GO6);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LAND_OK_K1748)
  {
    Term _h_12 = r0;
    WL_OPEN
    u64 _nd_12 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_12 + 0] = _h_12;
    r0 = term_clo(FID_LAND_OK_C1749, _nd_12);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LAND_OK_C1749)
  {
    Term _h_13 = r0;
    Term _x_12 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_14 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_14 + 0] = _h_13;
      e.mem[_t_14 + 1] = term_clo(FID_LAND_OK_C1750, 0);
      e.mem[_t_14 + 2] = _x_12;
      return term_tsk(FID_IO_BIND, _t_14);
    }
    r0 = _h_13;
    r1 = term_clo(FID_LAND_OK_C1750, 0);
    r2 = _x_12;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_LAND_OK_C1750)
  {
    Term _x_13 = r0;
    WL_OPEN
    u32 _o_24 = 0;
    Term _o_25 = 0;
    Term _o_26 = 0;
    Term _o_27 = 0;
    if (term_aux(_x_13) == CID____SRC_GIT_LAND_LDDONE) {
      _o_24 = 0;
      u64 _sp_36 = term_loc(_x_13);
      u32 _f_78 = e.mem[_sp_36 + 0];
      Term _f_79 = e.mem[_sp_36 + 1];
      Term _f_80 = e.mem[_sp_36 + 2];
      heap_free(e, cls_fit(3), _sp_36);
      _o_25 = _f_78;
      _o_26 = _f_79;
      _o_27 = _f_80;
    } else if (term_aux(_x_13) == CID____SRC_GIT_LAND_LDFAIL) {
      _o_24 = 1;
      Term _fb_6[3];
      u64 _sp_37 = ctr_take(e, _x_13, 3, _fb_6);
      u32 _f_81 = _fb_6[0];
      Term _f_82 = _fb_6[1];
      Term _f_83 = _fb_6[2];
      spare_free(e, cls_fit(3), _sp_37);
      _o_25 = _f_81;
      _o_26 = _f_82;
      _o_27 = _f_83;
    } else if (term_aux(_x_13) == CID____SRC_GIT_LAND_LDWK) {
      _o_24 = 2;
      u64 _sp_38 = term_loc(_x_13);
      Term _f_84 = e.mem[_sp_38 + 0];
      heap_free(e, cls_fit(1), _sp_38);
      _o_25 = _f_84;
    } else if (term_aux(_x_13) == CID____SRC_GIT_LAND_LDTIP) {
      _o_24 = 3;
      u64 _sp_39 = term_loc(_x_13);
      Term _f_85 = e.mem[_sp_39 + 0];
      Term _f_86 = e.mem[_sp_39 + 1];
      heap_free(e, cls_fit(2), _sp_39);
      _o_25 = _f_85;
      _o_26 = _f_86;
    } else if (term_aux(_x_13) == CID____SRC_GIT_LAND_LDCAND) {
      _o_24 = 4;
      u64 _sp_40 = term_loc(_x_13);
      Term _f_87 = e.mem[_sp_40 + 0];
      Term _f_88 = e.mem[_sp_40 + 1];
      heap_free(e, cls_fit(2), _sp_40);
      _o_25 = _f_87;
      _o_26 = _f_88;
    } else {
      _o_24 = 5;
      u64 _sp_41 = term_loc(_x_13);
      Term _f_89 = e.mem[_sp_41 + 0];
      Term _f_90 = e.mem[_sp_41 + 1];
      heap_free(e, cls_fit(2), _sp_41);
      _o_25 = _f_89;
      _o_26 = _f_90;
    }
    Term _v_0 = 0;
    Term _o_28[1];
    if (spin_60(e, _o_28, _o_24, _o_25, _o_26, _o_27) == 0) {
      return 0;
    }
    _v_0 = _o_28[0];
    r0 = _v_0;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE)
  {
    Term _repo_0 = r0;
    Term _branch_0 = r1;
    Term _path_0 = r2;
    Term _base_0 = r3;
    WL_OPEN
    _repo_0 = term_keep(e, _repo_0);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _repo_0;
      STK(1) = _branch_0;
      STK(2) = _path_0;
      STK(3) = FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1752;
      WL_PUSHN(4);
    } else {
      u64 _t_0 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1752, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _repo_0;
      e.mem[_t_0 + 1] = _branch_0;
      e.mem[_t_0 + 2] = _path_0;
      WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1752, _t_0);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _repo_0;
      e.mem[_t_1 + 1] = _branch_0;
      e.mem[_t_1 + 2] = _path_0;
      e.mem[_t_1 + 3] = _base_0;
      return term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1, _t_1);
    }
    r0 = _repo_0;
    r1 = _branch_0;
    r2 = _path_0;
    r3 = _base_0;
    WL_JMP(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1752)
  {
    WL_POPN(3);
    Term _repo_1 = STK(0);
    Term _branch_1 = STK(1);
    Term _path_1 = STK(2);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_0 + 0] = _repo_1;
    e.mem[_nd_0 + 1] = _branch_1;
    e.mem[_nd_0 + 2] = _path_1;
    e.mem[_nd_0 + 3] = _h_0;
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1753, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1753)
  {
    Term _repo_2 = r0;
    Term _branch_2 = r1;
    Term _path_2 = r2;
    Term _h_1 = r3;
    Term _x_0 = r4;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_1 + 0] = _repo_2;
    e.mem[_nd_1 + 1] = _branch_2;
    e.mem[_nd_1 + 2] = _path_2;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_14 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_14 + 0] = _h_1;
      e.mem[_t_14 + 1] = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1754, _nd_1);
      e.mem[_t_14 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_14);
    }
    r0 = _h_1;
    r1 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1754, _nd_1);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1754)
  {
    Term _repo_3 = r0;
    Term _branch_3 = r1;
    Term _path_3 = r2;
    Term _x_1 = r3;
    WL_OPEN
    u32 _o_0 = 0;
    Term _o_1 = 0;
    Term _o_2 = 0;
    Term _o_3 = 0;
    if (term_aux(_x_1) == CID____SRC_GIT_CREATE_WORKTREE_CWDONE) {
      _o_0 = 0;
      u64 _sp_0 = term_loc(_x_1);
      Term _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      Term _f_2 = e.mem[_sp_0 + 2];
      heap_free(e, cls_fit(3), _sp_0);
      _o_1 = _f_0;
      _o_2 = _f_1;
      _o_3 = _f_2;
    } else if (term_aux(_x_1) == CID____SRC_GIT_CREATE_WORKTREE_CWFAIL) {
      _o_0 = 1;
      u64 _sp_1 = term_loc(_x_1);
      u32 _f_3 = e.mem[_sp_1 + 0];
      Term _f_4 = e.mem[_sp_1 + 1];
      Term _f_5 = e.mem[_sp_1 + 2];
      heap_free(e, cls_fit(3), _sp_1);
      _o_1 = _f_3;
      _o_2 = _f_4;
      _o_3 = _f_5;
    } else {
      _o_0 = 2;
      u64 _sp_2 = term_loc(_x_1);
      Term _f_6 = e.mem[_sp_2 + 0];
      heap_free(e, cls_fit(1), _sp_2);
      _o_1 = _f_6;
    }
    _repo_3 = term_keep(e, _repo_3);
    _branch_3 = term_keep(e, _branch_3);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _repo_3;
      STK(1) = _branch_3;
      STK(2) = _path_3;
      STK(3) = FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1755;
      WL_PUSHN(4);
    } else {
      u64 _t_2 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1755, WL_CONT, WL_IDX, 1);
      e.mem[_t_2 + 0] = _repo_3;
      e.mem[_t_2 + 1] = _branch_3;
      e.mem[_t_2 + 2] = _path_3;
      WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1755, _t_2);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_GO2, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _o_0;
      e.mem[_t_3 + 1] = _o_1;
      e.mem[_t_3 + 2] = _o_2;
      e.mem[_t_3 + 3] = _o_3;
      e.mem[_t_3 + 4] = _repo_3;
      e.mem[_t_3 + 5] = _branch_3;
      e.mem[_t_3 + 6] = _path_3;
      return term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2, _t_3);
    }
    r0 = _o_0;
    r1 = _o_1;
    r2 = _o_2;
    r3 = _o_3;
    r4 = _repo_3;
    r5 = _branch_3;
    r6 = _path_3;
    WL_JMP(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1755)
  {
    WL_POPN(3);
    Term _repo_4 = STK(0);
    Term _branch_4 = STK(1);
    Term _path_4 = STK(2);
    Term _h_2 = r0;
    WL_OPEN
    u64 _nd_2 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_2 + 0] = _repo_4;
    e.mem[_nd_2 + 1] = _branch_4;
    e.mem[_nd_2 + 2] = _path_4;
    e.mem[_nd_2 + 3] = _h_2;
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1756, _nd_2);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1756)
  {
    Term _repo_5 = r0;
    Term _branch_5 = r1;
    Term _path_5 = r2;
    Term _h_3 = r3;
    Term _x_2 = r4;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_3 + 0] = _repo_5;
    e.mem[_nd_3 + 1] = _branch_5;
    e.mem[_nd_3 + 2] = _path_5;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_13 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_13 + 0] = _h_3;
      e.mem[_t_13 + 1] = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1757, _nd_3);
      e.mem[_t_13 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_13);
    }
    r0 = _h_3;
    r1 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1757, _nd_3);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1757)
  {
    Term _repo_6 = r0;
    Term _branch_6 = r1;
    Term _path_6 = r2;
    Term _x_3 = r3;
    WL_OPEN
    u32 _o_4 = 0;
    Term _o_5 = 0;
    Term _o_6 = 0;
    Term _o_7 = 0;
    if (term_aux(_x_3) == CID____SRC_GIT_CREATE_WORKTREE_CWDONE) {
      _o_4 = 0;
      u64 _sp_3 = term_loc(_x_3);
      Term _f_7 = e.mem[_sp_3 + 0];
      Term _f_8 = e.mem[_sp_3 + 1];
      Term _f_9 = e.mem[_sp_3 + 2];
      heap_free(e, cls_fit(3), _sp_3);
      _o_5 = _f_7;
      _o_6 = _f_8;
      _o_7 = _f_9;
    } else if (term_aux(_x_3) == CID____SRC_GIT_CREATE_WORKTREE_CWFAIL) {
      _o_4 = 1;
      u64 _sp_4 = term_loc(_x_3);
      u32 _f_10 = e.mem[_sp_4 + 0];
      Term _f_11 = e.mem[_sp_4 + 1];
      Term _f_12 = e.mem[_sp_4 + 2];
      heap_free(e, cls_fit(3), _sp_4);
      _o_5 = _f_10;
      _o_6 = _f_11;
      _o_7 = _f_12;
    } else {
      _o_4 = 2;
      u64 _sp_5 = term_loc(_x_3);
      Term _f_13 = e.mem[_sp_5 + 0];
      heap_free(e, cls_fit(1), _sp_5);
      _o_5 = _f_13;
    }
    _repo_6 = term_keep(e, _repo_6);
    _path_6 = term_keep(e, _path_6);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _repo_6;
      STK(1) = _branch_6;
      STK(2) = _path_6;
      STK(3) = FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1758;
      WL_PUSHN(4);
    } else {
      u64 _t_4 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1758, WL_CONT, WL_IDX, 1);
      e.mem[_t_4 + 0] = _repo_6;
      e.mem[_t_4 + 1] = _branch_6;
      e.mem[_t_4 + 2] = _path_6;
      WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1758, _t_4);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3)) {
      u64 _t_5 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_GO3, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _o_4;
      e.mem[_t_5 + 1] = _o_5;
      e.mem[_t_5 + 2] = _o_6;
      e.mem[_t_5 + 3] = _o_7;
      e.mem[_t_5 + 4] = _repo_6;
      e.mem[_t_5 + 5] = _branch_6;
      e.mem[_t_5 + 6] = _path_6;
      return term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3, _t_5);
    }
    r0 = _o_4;
    r1 = _o_5;
    r2 = _o_6;
    r3 = _o_7;
    r4 = _repo_6;
    r5 = _branch_6;
    r6 = _path_6;
    WL_JMP(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1758)
  {
    WL_POPN(3);
    Term _repo_7 = STK(0);
    Term _branch_7 = STK(1);
    Term _path_7 = STK(2);
    Term _h_4 = r0;
    WL_OPEN
    u64 _nd_4 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_4 + 0] = _repo_7;
    e.mem[_nd_4 + 1] = _branch_7;
    e.mem[_nd_4 + 2] = _path_7;
    e.mem[_nd_4 + 3] = _h_4;
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1759, _nd_4);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1759)
  {
    Term _repo_8 = r0;
    Term _branch_8 = r1;
    Term _path_8 = r2;
    Term _h_5 = r3;
    Term _x_4 = r4;
    WL_OPEN
    u64 _nd_5 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_5 + 0] = _repo_8;
    e.mem[_nd_5 + 1] = _branch_8;
    e.mem[_nd_5 + 2] = _path_8;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_12 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_12 + 0] = _h_5;
      e.mem[_t_12 + 1] = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1760, _nd_5);
      e.mem[_t_12 + 2] = _x_4;
      return term_tsk(FID_IO_BIND, _t_12);
    }
    r0 = _h_5;
    r1 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1760, _nd_5);
    r2 = _x_4;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1760)
  {
    Term _repo_9 = r0;
    Term _branch_9 = r1;
    Term _path_9 = r2;
    Term _x_5 = r3;
    WL_OPEN
    u32 _o_8 = 0;
    Term _o_9 = 0;
    Term _o_10 = 0;
    Term _o_11 = 0;
    if (term_aux(_x_5) == CID____SRC_GIT_CREATE_WORKTREE_CWDONE) {
      _o_8 = 0;
      u64 _sp_6 = term_loc(_x_5);
      Term _f_14 = e.mem[_sp_6 + 0];
      Term _f_15 = e.mem[_sp_6 + 1];
      Term _f_16 = e.mem[_sp_6 + 2];
      heap_free(e, cls_fit(3), _sp_6);
      _o_9 = _f_14;
      _o_10 = _f_15;
      _o_11 = _f_16;
    } else if (term_aux(_x_5) == CID____SRC_GIT_CREATE_WORKTREE_CWFAIL) {
      _o_8 = 1;
      u64 _sp_7 = term_loc(_x_5);
      u32 _f_17 = e.mem[_sp_7 + 0];
      Term _f_18 = e.mem[_sp_7 + 1];
      Term _f_19 = e.mem[_sp_7 + 2];
      heap_free(e, cls_fit(3), _sp_7);
      _o_9 = _f_17;
      _o_10 = _f_18;
      _o_11 = _f_19;
    } else {
      _o_8 = 2;
      u64 _sp_8 = term_loc(_x_5);
      Term _f_20 = e.mem[_sp_8 + 0];
      heap_free(e, cls_fit(1), _sp_8);
      _o_9 = _f_20;
    }
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1761;
      WL_PUSHN(1);
    } else {
      u64 _t_6 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1761, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1761, _t_6);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4)) {
      u64 _t_7 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_GO4, WL_CONT, WL_IDX, 0);
      e.mem[_t_7 + 0] = _o_8;
      e.mem[_t_7 + 1] = _o_9;
      e.mem[_t_7 + 2] = _o_10;
      e.mem[_t_7 + 3] = _o_11;
      e.mem[_t_7 + 4] = _repo_9;
      e.mem[_t_7 + 5] = _branch_9;
      e.mem[_t_7 + 6] = _path_9;
      return term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4, _t_7);
    }
    r0 = _o_8;
    r1 = _o_9;
    r2 = _o_10;
    r3 = _o_11;
    r4 = _repo_9;
    r5 = _branch_9;
    r6 = _path_9;
    WL_JMP(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K1761)
  {
    Term _h_6 = r0;
    WL_OPEN
    u64 _nd_6 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_6 + 0] = _h_6;
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1762, _nd_6);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1762)
  {
    Term _h_7 = r0;
    Term _x_6 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_11 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_11 + 0] = _h_7;
      e.mem[_t_11 + 1] = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1763, 0);
      e.mem[_t_11 + 2] = _x_6;
      return term_tsk(FID_IO_BIND, _t_11);
    }
    r0 = _h_7;
    r1 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1763, 0);
    r2 = _x_6;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C1763)
  {
    Term _x_7 = r0;
    WL_OPEN
    u32 _o_12 = 0;
    Term _o_13 = 0;
    Term _o_14 = 0;
    Term _o_15 = 0;
    if (term_aux(_x_7) == CID____SRC_GIT_CREATE_WORKTREE_CWDONE) {
      _o_12 = 0;
      u64 _sp_9 = term_loc(_x_7);
      Term _f_21 = e.mem[_sp_9 + 0];
      Term _f_22 = e.mem[_sp_9 + 1];
      Term _f_23 = e.mem[_sp_9 + 2];
      heap_free(e, cls_fit(3), _sp_9);
      _o_13 = _f_21;
      _o_14 = _f_22;
      _o_15 = _f_23;
    } else if (term_aux(_x_7) == CID____SRC_GIT_CREATE_WORKTREE_CWFAIL) {
      _o_12 = 1;
      u64 _sp_10 = term_loc(_x_7);
      u32 _f_24 = e.mem[_sp_10 + 0];
      Term _f_25 = e.mem[_sp_10 + 1];
      Term _f_26 = e.mem[_sp_10 + 2];
      heap_free(e, cls_fit(3), _sp_10);
      _o_13 = _f_24;
      _o_14 = _f_25;
      _o_15 = _f_26;
    } else {
      _o_12 = 2;
      u64 _sp_11 = term_loc(_x_7);
      Term _f_27 = e.mem[_sp_11 + 0];
      heap_free(e, cls_fit(1), _sp_11);
      _o_13 = _f_27;
    }
    Term _v_0 = 0;
    Term _o_16[1];
    if (spin_62(e, _o_16, _o_12, _o_13, _o_14, _o_15) == 0) {
      return 0;
    }
    _v_0 = _o_16[0];
    r0 = _v_0;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C1764)
  {
    Term _r_4 = r0;
    Term _r_5 = r1;
    Term _r_6 = r2;
    Term _x_8 = r3;
    WL_OPEN
    u64 _nd_8 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_8 + 0] = _r_4;
    e.mem[_nd_8 + 1] = _r_5;
    e.mem[_nd_8 + 2] = _r_6;
    u64 _nd_9 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_9 + 0] = term_ctr(CID____SRC_GIT_TYPES_WCREATED, _nd_8);
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_8 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_8 + 0] = term_ctr(CID_DONE, _nd_9);
      e.mem[_t_8 + 1] = _x_8;
      return term_tsk(FID_IO_PURE, _t_8);
    }
    r0 = term_ctr(CID_DONE, _nd_9);
    r1 = _x_8;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C1765)
  {
    u32 _r_7 = r0;
    Term _r_8 = r1;
    Term _r_9 = r2;
    Term _x_9 = r3;
    WL_OPEN
    Term _b_0 = 0;
    if (_r_7 == 0) {
      u64 _nd_11 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_11 + 0] = _r_8;
      _b_0 = term_ctr(CID____SRC_GIT_TYPES_FBRANCHEXISTS, _nd_11);
    } else if (_r_7 == 1) {
      u64 _nd_12 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_12 + 0] = _r_8;
      _b_0 = term_ctr(CID____SRC_GIT_TYPES_FPATHEXISTS, _nd_12);
    } else if (_r_7 == 2) {
      u64 _nd_13 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_13 + 0] = _r_8;
      _b_0 = term_ctr(CID____SRC_GIT_TYPES_FUNKNOWNBASE, _nd_13);
    } else if (_r_7 == 3) {
      u64 _nd_14 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_14 + 0] = _r_8;
      _b_0 = term_ctr(CID____SRC_GIT_TYPES_FTARGETBUSY, _nd_14);
    } else {
      u64 _nd_15 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_15 + 0] = _r_8;
      e.mem[_nd_15 + 1] = _r_9;
      _b_0 = term_ctr(CID____SRC_GIT_TYPES_FCMD, _nd_15);
    }
    u64 _nd_16 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_16 + 0] = _b_0;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_9 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_9 + 0] = term_ctr(CID_FAIL, _nd_16);
      e.mem[_t_9 + 1] = _x_9;
      return term_tsk(FID_IO_PURE, _t_9);
    }
    r0 = term_ctr(CID_FAIL, _nd_16);
    r1 = _x_9;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C1766)
  {
    Term _x_10 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_10 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_10 + 0] = term_ctr(CID_FAIL, STAT_OFF + 3266);
      e.mem[_t_10 + 1] = _x_10;
      return term_tsk(FID_IO_PURE, _t_10);
    }
    r0 = term_ctr(CID_FAIL, STAT_OFF + 3266);
    r1 = _x_10;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_U32_SHOW)
  {
    u32 _a_0 = r0;
    WL_OPEN
    u32 _s_0 = U32_BIN(_a_0, ==, 0);
    if (_s_0 == 1) {
      r0 = term_ctr(CID_SCON, STAT_OFF + 3267);
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
  WL_CASE(FID_AUTHOR)
  {
    Term _r_0 = r0;
    Term _wt_0 = r1;
    Term _branch_0 = r2;
    Term _base_0 = r3;
    Term _script_0 = r4;
    WL_OPEN
    _wt_0 = term_keep(e, _wt_0);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _wt_0;
      STK(1) = _script_0;
      STK(2) = FID_AUTHOR_K1970;
      WL_PUSHN(3);
    } else {
      u64 _t_0 = task_node(e, FID_AUTHOR_K1970, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _wt_0;
      e.mem[_t_0 + 1] = _script_0;
      WL_CONT = term_tsk(FID_AUTHOR_K1970, _t_0);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _r_0;
      e.mem[_t_1 + 1] = _branch_0;
      e.mem[_t_1 + 2] = _wt_0;
      e.mem[_t_1 + 3] = _base_0;
      return term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE, _t_1);
    }
    r0 = _r_0;
    r1 = _branch_0;
    r2 = _wt_0;
    r3 = _base_0;
    WL_JMP(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_AUTHOR_K1970)
  {
    WL_POPN(2);
    Term _wt_1 = STK(0);
    Term _script_1 = STK(1);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_0 + 0] = _wt_1;
    e.mem[_nd_0 + 1] = _script_1;
    e.mem[_nd_0 + 2] = _h_0;
    r0 = term_clo(FID_AUTHOR_C1971, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_AUTHOR_C1971)
  {
    Term _wt_2 = r0;
    Term _script_2 = r1;
    Term _h_1 = r2;
    Term _x_0 = r3;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_1 + 0] = _wt_2;
    e.mem[_nd_1 + 1] = _script_2;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_17 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_17 + 0] = _h_1;
      e.mem[_t_17 + 1] = term_clo(FID_AUTHOR_C1972, _nd_1);
      e.mem[_t_17 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_17);
    }
    r0 = _h_1;
    r1 = term_clo(FID_AUTHOR_C1972, _nd_1);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_AUTHOR_C1972)
  {
    Term _wt_3 = r0;
    Term _script_3 = r1;
    Term _x_1 = r2;
    WL_OPEN
    u32 _o_0 = 0;
    Term _o_1 = 0;
    Term _o_2 = 0;
    Term _o_3 = 0;
    if (term_aux(_x_1) == CID_FAIL) {
      _o_0 = 0;
      Term _fb_0[1];
      u64 _sp_0 = ctr_take(e, _x_1, 1, _fb_0);
      Term _f_0 = _fb_0[0];
      spare_free(e, cls_fit(1), _sp_0);
      u32 _o_4 = 0;
      Term _o_5 = 0;
      Term _o_6 = 0;
      if (term_aux(_f_0) == CID____SRC_GIT_TYPES_FBRANCHEXISTS) {
        _o_4 = 0;
        u64 _sp_1 = term_loc(_f_0);
        Term _f_1 = e.mem[_sp_1 + 0];
        heap_free(e, cls_fit(1), _sp_1);
        _o_5 = _f_1;
      } else if (term_aux(_f_0) == CID____SRC_GIT_TYPES_FPATHEXISTS) {
        _o_4 = 1;
        u64 _sp_2 = term_loc(_f_0);
        Term _f_2 = e.mem[_sp_2 + 0];
        heap_free(e, cls_fit(1), _sp_2);
        _o_5 = _f_2;
      } else if (term_aux(_f_0) == CID____SRC_GIT_TYPES_FUNKNOWNBASE) {
        _o_4 = 2;
        u64 _sp_3 = term_loc(_f_0);
        Term _f_3 = e.mem[_sp_3 + 0];
        heap_free(e, cls_fit(1), _sp_3);
        _o_5 = _f_3;
      } else if (term_aux(_f_0) == CID____SRC_GIT_TYPES_FTARGETBUSY) {
        _o_4 = 3;
        u64 _sp_4 = term_loc(_f_0);
        Term _f_4 = e.mem[_sp_4 + 0];
        heap_free(e, cls_fit(1), _sp_4);
        _o_5 = _f_4;
      } else {
        _o_4 = 4;
        Term _fb_1[2];
        u64 _sp_5 = ctr_take(e, _f_0, 2, _fb_1);
        Term _f_5 = _fb_1[0];
        Term _f_6 = _fb_1[1];
        spare_free(e, cls_fit(2), _sp_5);
        _o_5 = _f_5;
        _o_6 = _f_6;
      }
      _o_1 = _o_4;
      _o_2 = _o_5;
      _o_3 = _o_6;
    } else {
      _o_0 = 1;
      u64 _sp_6 = term_loc(_x_1);
      Term _f_7 = e.mem[_sp_6 + 0];
      heap_free(e, cls_fit(1), _sp_6);
      u64 _sp_7 = term_loc(_f_7);
      Term _f_8 = e.mem[_sp_7 + 0];
      Term _f_9 = e.mem[_sp_7 + 1];
      Term _f_10 = e.mem[_sp_7 + 2];
      heap_free(e, cls_fit(3), _sp_7);
      _o_1 = _f_8;
      _o_2 = _f_9;
      _o_3 = _f_10;
    }
    term_sink(e, _o_1);
    term_sink(e, _o_2);
    term_sink(e, _o_3);
    u64 _nd_2 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_2 + 0] = _script_3;
    e.mem[_nd_2 + 1] = term_pak(CID_NIL, 0);
    u64 _nd_3 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_3 + 0] = term_ctr(CID_SCON, STAT_OFF + 3397);
    e.mem[_nd_3 + 1] = term_ctr(CID_CON, _nd_2);
    u64 _nd_4 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_4 + 0] = term_ctr(CID_SCON, STAT_OFF + 627);
    e.mem[_nd_4 + 1] = term_ctr(CID_CON, _nd_3);
    _wt_3 = term_keep(e, _wt_3);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _wt_3;
      STK(1) = FID_AUTHOR_K1973;
      WL_PUSHN(2);
    } else {
      u64 _t_2 = task_node(e, FID_AUTHOR_K1973, WL_CONT, WL_IDX, 1);
      e.mem[_t_2 + 0] = _wt_3;
      WL_CONT = term_tsk(FID_AUTHOR_K1973, _t_2);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = term_ctr(CID_CON, _nd_4);
      e.mem[_t_3 + 1] = _wt_3;
      return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_3);
    }
    r0 = term_ctr(CID_CON, _nd_4);
    r1 = _wt_3;
    WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_AUTHOR_K1973)
  {
    WL_POPN(1);
    Term _wt_4 = STK(0);
    Term _h_2 = r0;
    WL_OPEN
    u64 _nd_5 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_5 + 0] = _wt_4;
    e.mem[_nd_5 + 1] = _h_2;
    r0 = term_clo(FID_AUTHOR_C1974, _nd_5);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_AUTHOR_C1974)
  {
    Term _wt_5 = r0;
    Term _h_3 = r1;
    Term _x_2 = r2;
    WL_OPEN
    u64 _nd_6 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_6 + 0] = _wt_5;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_16 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_16 + 0] = _h_3;
      e.mem[_t_16 + 1] = term_clo(FID_AUTHOR_C1975, _nd_6);
      e.mem[_t_16 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_16);
    }
    r0 = _h_3;
    r1 = term_clo(FID_AUTHOR_C1975, _nd_6);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_AUTHOR_C1975)
  {
    Term _wt_6 = r0;
    Term _x_3 = r1;
    WL_OPEN
    u32 _o_7 = 0;
    Term _o_8 = 0;
    u32 _o_9 = 0;
    Term _o_10 = 0;
    if (term_aux(_x_3) == CID____SRC_GIT_TYPES_RRUN) {
      _o_7 = 0;
      Term _fb_2[3];
      u64 _sp_8 = ctr_take(e, _x_3, 3, _fb_2);
      u32 _f_11 = _fb_2[0];
      u32 _f_12 = _fb_2[1];
      Term _f_13 = _fb_2[2];
      spare_free(e, cls_fit(3), _sp_8);
      _o_8 = _f_11;
      _o_9 = _f_12;
      _o_10 = _f_13;
    } else {
      _o_7 = 1;
      u64 _sp_9 = term_loc(_x_3);
      Term _f_14 = e.mem[_sp_9 + 0];
      heap_free(e, cls_fit(1), _sp_9);
      _o_8 = _f_14;
    }
    term_sink(e, _o_8);
    term_sink(e, _o_10);
    _wt_6 = term_keep(e, _wt_6);
    u64 _nd_7 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_7 + 0] = _wt_6;
    e.mem[_nd_7 + 1] = term_ctr(CID_CON, STAT_OFF + 3405);
    u64 _nd_8 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_8 + 0] = term_ctr(CID_SCON, STAT_OFF + 957);
    e.mem[_nd_8 + 1] = term_ctr(CID_CON, _nd_7);
    u64 _nd_9 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_9 + 0] = term_ctr(CID_SCON, STAT_OFF + 953);
    e.mem[_nd_9 + 1] = term_ctr(CID_CON, _nd_8);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _wt_6;
      STK(1) = FID_AUTHOR_K1976;
      WL_PUSHN(2);
    } else {
      u64 _t_4 = task_node(e, FID_AUTHOR_K1976, WL_CONT, WL_IDX, 1);
      e.mem[_t_4 + 0] = _wt_6;
      WL_CONT = term_tsk(FID_AUTHOR_K1976, _t_4);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
      u64 _t_5 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = term_ctr(CID_CON, _nd_9);
      e.mem[_t_5 + 1] = term_ctr(CID_SCON, STAT_OFF + 979);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_5);
    }
    r0 = term_ctr(CID_CON, _nd_9);
    r1 = term_ctr(CID_SCON, STAT_OFF + 979);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_AUTHOR_K1976)
  {
    WL_POPN(1);
    Term _wt_7 = STK(0);
    Term _h_4 = r0;
    WL_OPEN
    u64 _nd_10 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_10 + 0] = _wt_7;
    e.mem[_nd_10 + 1] = _h_4;
    r0 = term_clo(FID_AUTHOR_C1977, _nd_10);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_AUTHOR_C1977)
  {
    Term _wt_8 = r0;
    Term _h_5 = r1;
    Term _x_4 = r2;
    WL_OPEN
    u64 _nd_11 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_11 + 0] = _wt_8;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_15 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_15 + 0] = _h_5;
      e.mem[_t_15 + 1] = term_clo(FID_AUTHOR_C1978, _nd_11);
      e.mem[_t_15 + 2] = _x_4;
      return term_tsk(FID_IO_BIND, _t_15);
    }
    r0 = _h_5;
    r1 = term_clo(FID_AUTHOR_C1978, _nd_11);
    r2 = _x_4;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_AUTHOR_C1978)
  {
    Term _wt_9 = r0;
    Term _x_5 = r1;
    WL_OPEN
    u32 _o_11 = 0;
    Term _o_12 = 0;
    u32 _o_13 = 0;
    Term _o_14 = 0;
    if (term_aux(_x_5) == CID____SRC_GIT_TYPES_RRUN) {
      _o_11 = 0;
      Term _fb_3[3];
      u64 _sp_10 = ctr_take(e, _x_5, 3, _fb_3);
      u32 _f_15 = _fb_3[0];
      u32 _f_16 = _fb_3[1];
      Term _f_17 = _fb_3[2];
      spare_free(e, cls_fit(3), _sp_10);
      _o_12 = _f_15;
      _o_13 = _f_16;
      _o_14 = _f_17;
    } else {
      _o_11 = 1;
      u64 _sp_11 = term_loc(_x_5);
      Term _f_18 = e.mem[_sp_11 + 0];
      heap_free(e, cls_fit(1), _sp_11);
      _o_12 = _f_18;
    }
    term_sink(e, _o_12);
    term_sink(e, _o_14);
    _wt_9 = term_keep(e, _wt_9);
    u64 _nd_12 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_12 + 0] = _wt_9;
    e.mem[_nd_12 + 1] = term_ctr(CID_CON, STAT_OFF + 3435);
    u64 _nd_13 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_13 + 0] = term_ctr(CID_SCON, STAT_OFF + 957);
    e.mem[_nd_13 + 1] = term_ctr(CID_CON, _nd_12);
    u64 _nd_14 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_14 + 0] = term_ctr(CID_SCON, STAT_OFF + 953);
    e.mem[_nd_14 + 1] = term_ctr(CID_CON, _nd_13);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _wt_9;
      STK(1) = FID_AUTHOR_K1979;
      WL_PUSHN(2);
    } else {
      u64 _t_6 = task_node(e, FID_AUTHOR_K1979, WL_CONT, WL_IDX, 1);
      e.mem[_t_6 + 0] = _wt_9;
      WL_CONT = term_tsk(FID_AUTHOR_K1979, _t_6);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
      u64 _t_7 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
      e.mem[_t_7 + 0] = term_ctr(CID_CON, _nd_14);
      e.mem[_t_7 + 1] = term_ctr(CID_SCON, STAT_OFF + 979);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_7);
    }
    r0 = term_ctr(CID_CON, _nd_14);
    r1 = term_ctr(CID_SCON, STAT_OFF + 979);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_AUTHOR_K1979)
  {
    WL_POPN(1);
    Term _wt_10 = STK(0);
    Term _h_6 = r0;
    WL_OPEN
    u64 _nd_15 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_15 + 0] = _wt_10;
    e.mem[_nd_15 + 1] = _h_6;
    r0 = term_clo(FID_AUTHOR_C1980, _nd_15);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_AUTHOR_C1980)
  {
    Term _wt_11 = r0;
    Term _h_7 = r1;
    Term _x_6 = r2;
    WL_OPEN
    u64 _nd_16 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_16 + 0] = _wt_11;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_14 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_14 + 0] = _h_7;
      e.mem[_t_14 + 1] = term_clo(FID_AUTHOR_C1981, _nd_16);
      e.mem[_t_14 + 2] = _x_6;
      return term_tsk(FID_IO_BIND, _t_14);
    }
    r0 = _h_7;
    r1 = term_clo(FID_AUTHOR_C1981, _nd_16);
    r2 = _x_6;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_AUTHOR_C1981)
  {
    Term _wt_12 = r0;
    Term _x_7 = r1;
    WL_OPEN
    u32 _o_15 = 0;
    Term _o_16 = 0;
    u32 _o_17 = 0;
    Term _o_18 = 0;
    if (term_aux(_x_7) == CID____SRC_GIT_TYPES_RRUN) {
      _o_15 = 0;
      Term _fb_4[3];
      u64 _sp_12 = ctr_take(e, _x_7, 3, _fb_4);
      u32 _f_19 = _fb_4[0];
      u32 _f_20 = _fb_4[1];
      Term _f_21 = _fb_4[2];
      spare_free(e, cls_fit(3), _sp_12);
      _o_16 = _f_19;
      _o_17 = _f_20;
      _o_18 = _f_21;
    } else {
      _o_15 = 1;
      u64 _sp_13 = term_loc(_x_7);
      Term _f_22 = e.mem[_sp_13 + 0];
      heap_free(e, cls_fit(1), _sp_13);
      _o_16 = _f_22;
    }
    term_sink(e, _o_16);
    term_sink(e, _o_18);
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_AUTHOR_K1982;
      WL_PUSHN(1);
    } else {
      u64 _t_8 = task_node(e, FID_AUTHOR_K1982, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_AUTHOR_K1982, _t_8);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
      u64 _t_9 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
      e.mem[_t_9 + 0] = _wt_12;
      e.mem[_t_9 + 1] = term_ctr(CID_CON, STAT_OFF + 139);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_9);
    }
    r0 = _wt_12;
    r1 = term_ctr(CID_CON, STAT_OFF + 139);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_AUTHOR_K1982)
  {
    Term _h_8 = r0;
    WL_OPEN
    u64 _nd_17 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_17 + 0] = _h_8;
    r0 = term_clo(FID_AUTHOR_C1983, _nd_17);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_AUTHOR_C1983)
  {
    Term _h_9 = r0;
    Term _x_8 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_13 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_13 + 0] = _h_9;
      e.mem[_t_13 + 1] = term_clo(FID_AUTHOR_C1984, 0);
      e.mem[_t_13 + 2] = _x_8;
      return term_tsk(FID_IO_BIND, _t_13);
    }
    r0 = _h_9;
    r1 = term_clo(FID_AUTHOR_C1984, 0);
    r2 = _x_8;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_AUTHOR_C1984)
  {
    Term _x_9 = r0;
    WL_OPEN
    u32 _o_19 = 0;
    Term _o_20 = 0;
    Term _o_21 = 0;
    if (term_aux(_x_9) == CID____SRC_GIT_TYPES_GRUN) {
      _o_19 = 0;
      u64 _sp_14 = term_loc(_x_9);
      u32 _f_23 = e.mem[_sp_14 + 0];
      Term _f_24 = e.mem[_sp_14 + 1];
      heap_free(e, cls_fit(2), _sp_14);
      _o_20 = _f_23;
      _o_21 = _f_24;
    } else {
      _o_19 = 1;
      u64 _sp_15 = term_loc(_x_9);
      Term _f_25 = e.mem[_sp_15 + 0];
      heap_free(e, cls_fit(1), _sp_15);
      _o_20 = _f_25;
    }
    Term _v_0 = 0;
    Term _v_1 = 0;
    Term _o_22[1];
    if (spin_47(e, _o_22, _o_19, _o_20, _o_21) == 0) {
      return 0;
    }
    _v_1 = _o_22[0];
    _v_0 = _v_1;
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_AUTHOR_K1985;
      WL_PUSHN(1);
    } else {
      u64 _t_10 = task_node(e, FID_AUTHOR_K1985, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_AUTHOR_K1985, _t_10);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
      u64 _t_11 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
      e.mem[_t_11 + 0] = _v_0;
      return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_11);
    }
    r0 = _v_0;
    WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_AUTHOR_K1985)
  {
    Term _h_10 = r0;
    WL_OPEN
    u64 _nd_18 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_18 + 0] = _h_10;
    r0 = term_clo(FID_AUTHOR_C1986, _nd_18);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_AUTHOR_C1986)
  {
    Term _h_11 = r0;
    Term _x_10 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_12 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_12 + 0] = _h_11;
      e.mem[_t_12 + 1] = _x_10;
      return term_tsk(FID_IO_PURE, _t_12);
    }
    r0 = _h_11;
    r1 = _x_10;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_PROCESS_RUNGIT)
  {
    Term _dir_0 = r0;
    Term _args_0 = r1;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_0 + 0] = _dir_0;
    e.mem[_nd_0 + 1] = _args_0;
    u64 _nd_1 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 957);
    e.mem[_nd_1 + 1] = term_ctr(CID_CON, _nd_0);
    u64 _nd_2 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_2 + 0] = term_ctr(CID_SCON, STAT_OFF + 953);
    e.mem[_nd_2 + 1] = term_ctr(CID_CON, _nd_1);
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID____SRC_GIT_PROCESS_RUNGIT_K1999;
      WL_PUSHN(1);
    } else {
      u64 _t_0 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT_K1999, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_PROCESS_RUNGIT_K1999, _t_0);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = term_ctr(CID_CON, _nd_2);
      e.mem[_t_1 + 1] = term_ctr(CID_SCON, STAT_OFF + 979);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_1);
    }
    r0 = term_ctr(CID_CON, _nd_2);
    r1 = term_ctr(CID_SCON, STAT_OFF + 979);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_PROCESS_RUNGIT_K1999)
  {
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_3 + 0] = _h_0;
    r0 = term_clo(FID____SRC_GIT_PROCESS_RUNGIT_C2000, _nd_3);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_PROCESS_RUNGIT_C2000)
  {
    Term _h_1 = r0;
    Term _x_0 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_3 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _h_1;
      e.mem[_t_3 + 1] = term_clo(FID____SRC_GIT_PROCESS_RUNGIT_C2001, 0);
      e.mem[_t_3 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_3);
    }
    r0 = _h_1;
    r1 = term_clo(FID____SRC_GIT_PROCESS_RUNGIT_C2001, 0);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_PROCESS_RUNGIT_C2001)
  {
    Term _x_1 = r0;
    WL_OPEN
    u32 _o_0 = 0;
    Term _o_1 = 0;
    u32 _o_2 = 0;
    Term _o_3 = 0;
    if (term_aux(_x_1) == CID____SRC_GIT_TYPES_RRUN) {
      _o_0 = 0;
      Term _fb_0[3];
      u64 _sp_0 = ctr_take(e, _x_1, 3, _fb_0);
      u32 _f_0 = _fb_0[0];
      u32 _f_1 = _fb_0[1];
      Term _f_2 = _fb_0[2];
      spare_free(e, cls_fit(3), _sp_0);
      _o_1 = _f_0;
      _o_2 = _f_1;
      _o_3 = _f_2;
    } else {
      _o_0 = 1;
      u64 _sp_1 = term_loc(_x_1);
      Term _f_3 = e.mem[_sp_1 + 0];
      heap_free(e, cls_fit(1), _sp_1);
      _o_1 = _f_3;
    }
    u64 _nd_4 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_4 + 0] = _o_0;
    e.mem[_nd_4 + 1] = _o_1;
    e.mem[_nd_4 + 2] = _o_2;
    e.mem[_nd_4 + 3] = _o_3;
    r0 = term_clo(FID____SRC_GIT_PROCESS_RUNGIT_C2002, _nd_4);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_PROCESS_RUNGIT_C2002)
  {
    u32 _o_4 = r0;
    Term _o_5 = r1;
    u32 _o_6 = r2;
    Term _o_7 = r3;
    Term _x_2 = r4;
    WL_OPEN
    u32 _v_0 = 0;
    Term _v_1 = 0;
    Term _v_2 = 0;
    u32 _v_3 = 0;
    Term _v_4 = 0;
    Term _v_5 = 0;
    Term _o_8[3];
    if (spin_64(e, _o_8, _o_4, _o_5, _o_6, _o_7) == 0) {
      return 0;
    }
    _v_3 = _o_8[0];
    _v_4 = _o_8[1];
    _v_5 = _o_8[2];
    _v_0 = _v_3;
    _v_1 = _v_4;
    _v_2 = _v_5;
    Term _b_0 = 0;
    if (_v_0 == 0) {
      u64 _nd_5 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_5 + 0] = _v_1;
      e.mem[_nd_5 + 1] = _v_2;
      _b_0 = term_ctr(CID____SRC_GIT_TYPES_GRUN, _nd_5);
    } else {
      u64 _nd_6 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_6 + 0] = _v_1;
      _b_0 = term_ctr(CID____SRC_GIT_TYPES_GBROKEN, _nd_6);
    }
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_2 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_2 + 0] = _b_0;
      e.mem[_t_2 + 1] = _x_2;
      return term_tsk(FID_IO_PURE, _t_2);
    }
    r0 = _b_0;
    r1 = _x_2;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MOVE_SCRIPT)
  {
    Term _r_0 = r0;
    Term _name_0 = r1;
    Term _branch_0 = r2;
    WL_OPEN
    if (seq) {
      WL_ROOM(3);
      STK(0) = _r_0;
      STK(1) = _branch_0;
      STK(2) = FID_MOVE_SCRIPT_K2004;
      WL_PUSHN(3);
    } else {
      u64 _t_0 = task_node(e, FID_MOVE_SCRIPT_K2004, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _r_0;
      e.mem[_t_0 + 1] = _branch_0;
      WL_CONT = term_tsk(FID_MOVE_SCRIPT_K2004, _t_0);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 3571);
      e.mem[_t_1 + 1] = _name_0;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_1);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 3571);
    r1 = _name_0;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MOVE_SCRIPT_K2004)
  {
    WL_POPN(2);
    Term _r_1 = STK(0);
    Term _branch_1 = STK(1);
    Term _h_0 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _r_1;
      STK(1) = FID_MOVE_SCRIPT_K2005;
      WL_PUSHN(2);
    } else {
      u64 _t_2 = task_node(e, FID_MOVE_SCRIPT_K2005, WL_CONT, WL_IDX, 1);
      e.mem[_t_2 + 0] = _r_1;
      WL_CONT = term_tsk(FID_MOVE_SCRIPT_K2005, _t_2);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _branch_1;
      e.mem[_t_3 + 1] = _h_0;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_3);
    }
    r0 = _branch_1;
    r1 = _h_0;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MOVE_SCRIPT_K2005)
  {
    WL_POPN(1);
    Term _r_2 = STK(0);
    Term _h_1 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _r_2;
      STK(1) = FID_MOVE_SCRIPT_K2006;
      WL_PUSHN(2);
    } else {
      u64 _t_4 = task_node(e, FID_MOVE_SCRIPT_K2006, WL_CONT, WL_IDX, 1);
      e.mem[_t_4 + 0] = _r_2;
      WL_CONT = term_tsk(FID_MOVE_SCRIPT_K2006, _t_4);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_5 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = term_ctr(CID_SCON, STAT_OFF + 3601);
      e.mem[_t_5 + 1] = _h_1;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_5);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 3601);
    r1 = _h_1;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MOVE_SCRIPT_K2006)
  {
    WL_POPN(1);
    Term _r_3 = STK(0);
    Term _h_2 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_MOVE_SCRIPT_K2007;
      WL_PUSHN(1);
    } else {
      u64 _t_6 = task_node(e, FID_MOVE_SCRIPT_K2007, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_MOVE_SCRIPT_K2007, _t_6);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_7 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_7 + 0] = _r_3;
      e.mem[_t_7 + 1] = _h_2;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_7);
    }
    r0 = _r_3;
    r1 = _h_2;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MOVE_SCRIPT_K2007)
  {
    Term _h_3 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_8 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_8 + 0] = term_ctr(CID_SCON, STAT_OFF + 3643);
      e.mem[_t_8 + 1] = _h_3;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_8);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 3643);
    r1 = _h_3;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_GIT_SEQ)
  {
    Term _cmds_0 = r0;
    Term _dir_0 = r1;
    WL_OPEN
    if (term_aux(_cmds_0) == CID_NIL) {
      term_sink(e, _dir_0);
      r0 = term_clo(FID_GIT_SEQ_C2011, 0);
      WL_RETN(1);
    } else {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _cmds_0, 2, _fb_0);
      Term _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      _dir_0 = term_keep(e, _dir_0);
      u64 _nd_0 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
      e.mem[_nd_0 + 0] = _dir_0;
      e.mem[_nd_0 + 1] = _f_0;
      u64 _nd_1 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 957);
      e.mem[_nd_1 + 1] = term_ctr(CID_CON, _nd_0);
      u64 _nd_2 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_2 + 0] = term_ctr(CID_SCON, STAT_OFF + 953);
      e.mem[_nd_2 + 1] = term_ctr(CID_CON, _nd_1);
      if (seq) {
        WL_ROOM(3);
        STK(0) = _f_1;
        STK(1) = _dir_0;
        STK(2) = FID_GIT_SEQ_K2012;
        WL_PUSHN(3);
      } else {
        u64 _t_1 = task_node(e, FID_GIT_SEQ_K2012, WL_CONT, WL_IDX, 1);
        e.mem[_t_1 + 0] = _f_1;
        e.mem[_t_1 + 1] = _dir_0;
        WL_CONT = term_tsk(FID_GIT_SEQ_K2012, _t_1);
        WL_IDX = 2;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
        u64 _t_2 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
        e.mem[_t_2 + 0] = term_ctr(CID_CON, _nd_2);
        e.mem[_t_2 + 1] = term_ctr(CID_SCON, STAT_OFF + 979);
        return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_2);
      }
      r0 = term_ctr(CID_CON, _nd_2);
      r1 = term_ctr(CID_SCON, STAT_OFF + 979);
      WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID_GIT_SEQ_C2011)
  {
    Term _x_0 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_0 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = term_ctr(CID____SRC_GIT_TYPES_RRUN, STAT_OFF + 4159);
      e.mem[_t_0 + 1] = _x_0;
      return term_tsk(FID_IO_PURE, _t_0);
    }
    r0 = term_ctr(CID____SRC_GIT_TYPES_RRUN, STAT_OFF + 4159);
    r1 = _x_0;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_GIT_SEQ_K2012)
  {
    WL_POPN(2);
    Term _f_2 = STK(0);
    Term _dir_1 = STK(1);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_3 + 0] = _f_2;
    e.mem[_nd_3 + 1] = _dir_1;
    e.mem[_nd_3 + 2] = _h_0;
    r0 = term_clo(FID_GIT_SEQ_C2013, _nd_3);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_GIT_SEQ_C2013)
  {
    Term _f_3 = r0;
    Term _dir_2 = r1;
    Term _h_1 = r2;
    Term _x_1 = r3;
    WL_OPEN
    u64 _nd_4 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_4 + 0] = _f_3;
    e.mem[_nd_4 + 1] = _dir_2;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_4 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = _h_1;
      e.mem[_t_4 + 1] = term_clo(FID_GIT_SEQ_C2014, _nd_4);
      e.mem[_t_4 + 2] = _x_1;
      return term_tsk(FID_IO_BIND, _t_4);
    }
    r0 = _h_1;
    r1 = term_clo(FID_GIT_SEQ_C2014, _nd_4);
    r2 = _x_1;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_GIT_SEQ_C2014)
  {
    Term _f_4 = r0;
    Term _dir_3 = r1;
    Term _x_2 = r2;
    WL_OPEN
    u32 _o_0 = 0;
    Term _o_1 = 0;
    u32 _o_2 = 0;
    Term _o_3 = 0;
    if (term_aux(_x_2) == CID____SRC_GIT_TYPES_RRUN) {
      _o_0 = 0;
      Term _fb_1[3];
      u64 _sp_1 = ctr_take(e, _x_2, 3, _fb_1);
      u32 _f_5 = _fb_1[0];
      u32 _f_6 = _fb_1[1];
      Term _f_7 = _fb_1[2];
      spare_free(e, cls_fit(3), _sp_1);
      _o_1 = _f_5;
      _o_2 = _f_6;
      _o_3 = _f_7;
    } else {
      _o_0 = 1;
      u64 _sp_2 = term_loc(_x_2);
      Term _f_8 = e.mem[_sp_2 + 0];
      heap_free(e, cls_fit(1), _sp_2);
      _o_1 = _f_8;
    }
    term_sink(e, _o_1);
    term_sink(e, _o_3);
    if (!DEVICE && !seq && fid_nofk(FID_GIT_SEQ)) {
      u64 _t_3 = task_node(e, FID_GIT_SEQ, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _f_4;
      e.mem[_t_3 + 1] = _dir_3;
      return term_tsk(FID_GIT_SEQ, _t_3);
    }
    r0 = _f_4;
    r1 = _dir_3;
    WL_JMP(FID_GIT_SEQ);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_JOIN_GO)
  {
    Term _sep_0 = r0;
    Term _xs_0 = r1;
    Term _s_0 = r2;
    WL_OPEN
    if (term_aux(_xs_0) == CID_NIL) {
      term_sink(e, _sep_0);
      r0 = _s_0;
      WL_RETN(1);
    } else {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _xs_0, 2, _fb_0);
      Term _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      _sep_0 = term_keep(e, _sep_0);
      spare_free(e, cls_fit(2), _sp_0);
      if (seq) {
        WL_ROOM(4);
        STK(0) = _f_1;
        STK(1) = _s_0;
        STK(2) = _sep_0;
        STK(3) = FID____SRC_GIT_TEXT_JOIN_GO_K2018;
        WL_PUSHN(4);
      } else {
        u64 _t_0 = task_node(e, FID____SRC_GIT_TEXT_JOIN_GO_K2018, WL_CONT, WL_IDX, 1);
        e.mem[_t_0 + 0] = _f_1;
        e.mem[_t_0 + 1] = _s_0;
        e.mem[_t_0 + 2] = _sep_0;
        WL_CONT = term_tsk(FID____SRC_GIT_TEXT_JOIN_GO_K2018, _t_0);
        WL_IDX = 3;
      }
      if (!DEVICE && !seq && fid_nofk(FID_STRING_APPEND)) {
        u64 _t_1 = task_node(e, FID_STRING_APPEND, WL_CONT, WL_IDX, 0);
        e.mem[_t_1 + 0] = _sep_0;
        e.mem[_t_1 + 1] = _f_0;
        return term_tsk(FID_STRING_APPEND, _t_1);
      }
      r0 = _sep_0;
      r1 = _f_0;
      WL_JMP(FID_STRING_APPEND);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_JOIN_GO_K2018)
  {
    WL_POPN(3);
    Term _f_2 = STK(0);
    Term _s_1 = STK(1);
    Term _sep_1 = STK(2);
    Term _h_0 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(3);
      STK(0) = _f_2;
      STK(1) = _sep_1;
      STK(2) = FID____SRC_GIT_TEXT_JOIN_GO_K2019;
      WL_PUSHN(3);
    } else {
      u64 _t_2 = task_node(e, FID____SRC_GIT_TEXT_JOIN_GO_K2019, WL_CONT, WL_IDX, 1);
      e.mem[_t_2 + 0] = _f_2;
      e.mem[_t_2 + 1] = _sep_1;
      WL_CONT = term_tsk(FID____SRC_GIT_TEXT_JOIN_GO_K2019, _t_2);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID_STRING_APPEND)) {
      u64 _t_3 = task_node(e, FID_STRING_APPEND, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _s_1;
      e.mem[_t_3 + 1] = _h_0;
      return term_tsk(FID_STRING_APPEND, _t_3);
    }
    r0 = _s_1;
    r1 = _h_0;
    WL_JMP(FID_STRING_APPEND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_JOIN_GO_K2019)
  {
    WL_POPN(2);
    Term _f_3 = STK(0);
    Term _sep_2 = STK(1);
    Term _h_1 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_JOIN_GO)) {
      u64 _t_4 = task_node(e, FID____SRC_GIT_TEXT_JOIN_GO, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = _sep_2;
      e.mem[_t_4 + 1] = _f_3;
      e.mem[_t_4 + 2] = _h_1;
      return term_tsk(FID____SRC_GIT_TEXT_JOIN_GO, _t_4);
    }
    r0 = _sep_2;
    r1 = _f_3;
    r2 = _h_1;
    WL_JMP(FID____SRC_GIT_TEXT_JOIN_GO);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_ENC_ARGV_GO)
  {
    Term _xs_0 = r0;
    Term _acc_0 = r1;
    WL_OPEN
    if (term_aux(_xs_0) == CID_NIL) {
      r0 = _acc_0;
      WL_RETN(1);
    } else {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _xs_0, 2, _fb_0);
      Term _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      u32 _v_0 = 0;
      u32 _v_1 = 0;
      Term _o_1[1];
      if (spin_65(e, _o_1, _f_0) == 0) {
        return 0;
      }
      _v_1 = _o_1[0];
      _v_0 = _v_1;
      spare_free(e, cls_fit(2), _sp_0);
      if (seq) {
        WL_ROOM(4);
        STK(0) = _f_1;
        STK(1) = _f_0;
        STK(2) = _acc_0;
        STK(3) = FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2025;
        WL_PUSHN(4);
      } else {
        u64 _t_0 = task_node(e, FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2025, WL_CONT, WL_IDX, 1);
        e.mem[_t_0 + 0] = _f_1;
        e.mem[_t_0 + 1] = _f_0;
        e.mem[_t_0 + 2] = _acc_0;
        WL_CONT = term_tsk(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2025, _t_0);
        WL_IDX = 3;
      }
      if (!DEVICE && !seq && fid_nofk(FID_U32_SHOW)) {
        u64 _t_1 = task_node(e, FID_U32_SHOW, WL_CONT, WL_IDX, 0);
        e.mem[_t_1 + 0] = _v_0;
        return term_tsk(FID_U32_SHOW, _t_1);
      }
      r0 = _v_0;
      WL_JMP(FID_U32_SHOW);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2025)
  {
    WL_POPN(3);
    Term _f_2 = STK(0);
    Term _f_3 = STK(1);
    Term _acc_1 = STK(2);
    Term _h_0 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(4);
      STK(0) = _f_2;
      STK(1) = _acc_1;
      STK(2) = _h_0;
      STK(3) = FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2026;
      WL_PUSHN(4);
    } else {
      u64 _t_2 = task_node(e, FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2026, WL_CONT, WL_IDX, 1);
      e.mem[_t_2 + 0] = _f_2;
      e.mem[_t_2 + 1] = _acc_1;
      e.mem[_t_2 + 2] = _h_0;
      WL_CONT = term_tsk(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2026, _t_2);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID_STRING_APPEND)) {
      u64 _t_3 = task_node(e, FID_STRING_APPEND, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = term_ctr(CID_SCON, STAT_OFF + 3299);
      e.mem[_t_3 + 1] = _f_3;
      return term_tsk(FID_STRING_APPEND, _t_3);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 3299);
    r1 = _f_3;
    WL_JMP(FID_STRING_APPEND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2026)
  {
    WL_POPN(3);
    Term _f_4 = STK(0);
    Term _acc_2 = STK(1);
    Term _h_1 = STK(2);
    Term _h_2 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(3);
      STK(0) = _f_4;
      STK(1) = _acc_2;
      STK(2) = FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2027;
      WL_PUSHN(3);
    } else {
      u64 _t_4 = task_node(e, FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2027, WL_CONT, WL_IDX, 1);
      e.mem[_t_4 + 0] = _f_4;
      e.mem[_t_4 + 1] = _acc_2;
      WL_CONT = term_tsk(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2027, _t_4);
      WL_IDX = 2;
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
  WL_CASE(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2027)
  {
    WL_POPN(2);
    Term _f_5 = STK(0);
    Term _acc_3 = STK(1);
    Term _h_3 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _f_5;
      STK(1) = FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2028;
      WL_PUSHN(2);
    } else {
      u64 _t_6 = task_node(e, FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2028, WL_CONT, WL_IDX, 1);
      e.mem[_t_6 + 0] = _f_5;
      WL_CONT = term_tsk(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2028, _t_6);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID_STRING_APPEND)) {
      u64 _t_7 = task_node(e, FID_STRING_APPEND, WL_CONT, WL_IDX, 0);
      e.mem[_t_7 + 0] = _acc_3;
      e.mem[_t_7 + 1] = _h_3;
      return term_tsk(FID_STRING_APPEND, _t_7);
    }
    r0 = _acc_3;
    r1 = _h_3;
    WL_JMP(FID_STRING_APPEND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K2028)
  {
    WL_POPN(1);
    Term _f_6 = STK(0);
    Term _h_4 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_ENC_ARGV_GO)) {
      u64 _t_8 = task_node(e, FID____SRC_GIT_TEXT_ENC_ARGV_GO, WL_CONT, WL_IDX, 0);
      e.mem[_t_8 + 0] = _f_6;
      e.mem[_t_8 + 1] = _h_4;
      return term_tsk(FID____SRC_GIT_TEXT_ENC_ARGV_GO, _t_8);
    }
    r0 = _f_6;
    r1 = _h_4;
    WL_JMP(FID____SRC_GIT_TEXT_ENC_ARGV_GO);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP)
  {
    Term _r_0 = r0;
    WL_OPEN
    _r_0 = term_keep(e, _r_0);
    u64 _nd_0 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_0 + 0] = _r_0;
    e.mem[_nd_0 + 1] = term_pak(CID_NIL, 0);
    u64 _nd_1 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 4252);
    e.mem[_nd_1 + 1] = term_ctr(CID_CON, _nd_0);
    u64 _nd_2 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_2 + 0] = term_ctr(CID_SCON, STAT_OFF + 4248);
    e.mem[_nd_2 + 1] = term_ctr(CID_CON, _nd_1);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _r_0;
      STK(1) = FID_SETUP_K2225;
      WL_PUSHN(2);
    } else {
      u64 _t_0 = task_node(e, FID_SETUP_K2225, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _r_0;
      WL_CONT = term_tsk(FID_SETUP_K2225, _t_0);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = term_ctr(CID_CON, _nd_2);
      e.mem[_t_1 + 1] = term_ctr(CID_SCON, STAT_OFF + 979);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_1);
    }
    r0 = term_ctr(CID_CON, _nd_2);
    r1 = term_ctr(CID_SCON, STAT_OFF + 979);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_K2225)
  {
    WL_POPN(1);
    Term _r_1 = STK(0);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_3 + 0] = _r_1;
    e.mem[_nd_3 + 1] = _h_0;
    r0 = term_clo(FID_SETUP_C2226, _nd_3);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2226)
  {
    Term _r_2 = r0;
    Term _h_1 = r1;
    Term _x_0 = r2;
    WL_OPEN
    u64 _nd_4 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_4 + 0] = _r_2;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_51 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_51 + 0] = _h_1;
      e.mem[_t_51 + 1] = term_clo(FID_SETUP_C2227, _nd_4);
      e.mem[_t_51 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_51);
    }
    r0 = _h_1;
    r1 = term_clo(FID_SETUP_C2227, _nd_4);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2227)
  {
    Term _r_3 = r0;
    Term _x_1 = r1;
    WL_OPEN
    u32 _o_0 = 0;
    Term _o_1 = 0;
    u32 _o_2 = 0;
    Term _o_3 = 0;
    if (term_aux(_x_1) == CID____SRC_GIT_TYPES_RRUN) {
      _o_0 = 0;
      Term _fb_0[3];
      u64 _sp_0 = ctr_take(e, _x_1, 3, _fb_0);
      u32 _f_0 = _fb_0[0];
      u32 _f_1 = _fb_0[1];
      Term _f_2 = _fb_0[2];
      spare_free(e, cls_fit(3), _sp_0);
      _o_1 = _f_0;
      _o_2 = _f_1;
      _o_3 = _f_2;
    } else {
      _o_0 = 1;
      u64 _sp_1 = term_loc(_x_1);
      Term _f_3 = e.mem[_sp_1 + 0];
      heap_free(e, cls_fit(1), _sp_1);
      _o_1 = _f_3;
    }
    term_sink(e, _o_1);
    term_sink(e, _o_3);
    _r_3 = term_keep(e, _r_3);
    u64 _nd_5 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_5 + 0] = _r_3;
    e.mem[_nd_5 + 1] = term_pak(CID_NIL, 0);
    u64 _nd_6 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_6 + 0] = term_ctr(CID_SCON, STAT_OFF + 663);
    e.mem[_nd_6 + 1] = term_ctr(CID_CON, _nd_5);
    u64 _nd_7 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_7 + 0] = term_ctr(CID_SCON, STAT_OFF + 3028);
    e.mem[_nd_7 + 1] = term_ctr(CID_CON, _nd_6);
    u64 _nd_8 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_8 + 0] = term_ctr(CID_SCON, STAT_OFF + 2580);
    e.mem[_nd_8 + 1] = term_ctr(CID_CON, _nd_7);
    u64 _nd_9 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_9 + 0] = term_ctr(CID_SCON, STAT_OFF + 4256);
    e.mem[_nd_9 + 1] = term_ctr(CID_CON, _nd_8);
    u64 _nd_10 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_10 + 0] = term_ctr(CID_SCON, STAT_OFF + 953);
    e.mem[_nd_10 + 1] = term_ctr(CID_CON, _nd_9);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _r_3;
      STK(1) = FID_SETUP_K2228;
      WL_PUSHN(2);
    } else {
      u64 _t_2 = task_node(e, FID_SETUP_K2228, WL_CONT, WL_IDX, 1);
      e.mem[_t_2 + 0] = _r_3;
      WL_CONT = term_tsk(FID_SETUP_K2228, _t_2);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = term_ctr(CID_CON, _nd_10);
      e.mem[_t_3 + 1] = term_ctr(CID_SCON, STAT_OFF + 979);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_3);
    }
    r0 = term_ctr(CID_CON, _nd_10);
    r1 = term_ctr(CID_SCON, STAT_OFF + 979);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_K2228)
  {
    WL_POPN(1);
    Term _r_4 = STK(0);
    Term _h_2 = r0;
    WL_OPEN
    u64 _nd_11 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_11 + 0] = _r_4;
    e.mem[_nd_11 + 1] = _h_2;
    r0 = term_clo(FID_SETUP_C2229, _nd_11);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2229)
  {
    Term _r_5 = r0;
    Term _h_3 = r1;
    Term _x_2 = r2;
    WL_OPEN
    u64 _nd_12 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_12 + 0] = _r_5;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_50 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_50 + 0] = _h_3;
      e.mem[_t_50 + 1] = term_clo(FID_SETUP_C2230, _nd_12);
      e.mem[_t_50 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_50);
    }
    r0 = _h_3;
    r1 = term_clo(FID_SETUP_C2230, _nd_12);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2230)
  {
    Term _r_6 = r0;
    Term _x_3 = r1;
    WL_OPEN
    u32 _o_4 = 0;
    Term _o_5 = 0;
    u32 _o_6 = 0;
    Term _o_7 = 0;
    if (term_aux(_x_3) == CID____SRC_GIT_TYPES_RRUN) {
      _o_4 = 0;
      Term _fb_1[3];
      u64 _sp_2 = ctr_take(e, _x_3, 3, _fb_1);
      u32 _f_4 = _fb_1[0];
      u32 _f_5 = _fb_1[1];
      Term _f_6 = _fb_1[2];
      spare_free(e, cls_fit(3), _sp_2);
      _o_5 = _f_4;
      _o_6 = _f_5;
      _o_7 = _f_6;
    } else {
      _o_4 = 1;
      u64 _sp_3 = term_loc(_x_3);
      Term _f_7 = e.mem[_sp_3 + 0];
      heap_free(e, cls_fit(1), _sp_3);
      _o_5 = _f_7;
    }
    term_sink(e, _o_5);
    term_sink(e, _o_7);
    _r_6 = term_keep(e, _r_6);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _r_6;
      STK(1) = FID_SETUP_K2231;
      WL_PUSHN(2);
    } else {
      u64 _t_4 = task_node(e, FID_SETUP_K2231, WL_CONT, WL_IDX, 1);
      e.mem[_t_4 + 0] = _r_6;
      WL_CONT = term_tsk(FID_SETUP_K2231, _t_4);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID_GIT_SEQ)) {
      u64 _t_5 = task_node(e, FID_GIT_SEQ, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = term_ctr(CID_CON, STAT_OFF + 4384);
      e.mem[_t_5 + 1] = _r_6;
      return term_tsk(FID_GIT_SEQ, _t_5);
    }
    r0 = term_ctr(CID_CON, STAT_OFF + 4384);
    r1 = _r_6;
    WL_JMP(FID_GIT_SEQ);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_K2231)
  {
    WL_POPN(1);
    Term _r_7 = STK(0);
    Term _h_4 = r0;
    WL_OPEN
    u64 _nd_13 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_13 + 0] = _r_7;
    e.mem[_nd_13 + 1] = _h_4;
    r0 = term_clo(FID_SETUP_C2232, _nd_13);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2232)
  {
    Term _r_8 = r0;
    Term _h_5 = r1;
    Term _x_4 = r2;
    WL_OPEN
    u64 _nd_14 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_14 + 0] = _r_8;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_49 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_49 + 0] = _h_5;
      e.mem[_t_49 + 1] = term_clo(FID_SETUP_C2233, _nd_14);
      e.mem[_t_49 + 2] = _x_4;
      return term_tsk(FID_IO_BIND, _t_49);
    }
    r0 = _h_5;
    r1 = term_clo(FID_SETUP_C2233, _nd_14);
    r2 = _x_4;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2233)
  {
    Term _r_9 = r0;
    Term _x_5 = r1;
    WL_OPEN
    u32 _o_8 = 0;
    Term _o_9 = 0;
    u32 _o_10 = 0;
    Term _o_11 = 0;
    if (term_aux(_x_5) == CID____SRC_GIT_TYPES_RRUN) {
      _o_8 = 0;
      Term _fb_2[3];
      u64 _sp_4 = ctr_take(e, _x_5, 3, _fb_2);
      u32 _f_8 = _fb_2[0];
      u32 _f_9 = _fb_2[1];
      Term _f_10 = _fb_2[2];
      spare_free(e, cls_fit(3), _sp_4);
      _o_9 = _f_8;
      _o_10 = _f_9;
      _o_11 = _f_10;
    } else {
      _o_8 = 1;
      u64 _sp_5 = term_loc(_x_5);
      Term _f_11 = e.mem[_sp_5 + 0];
      heap_free(e, cls_fit(1), _sp_5);
      _o_9 = _f_11;
    }
    term_sink(e, _o_9);
    term_sink(e, _o_11);
    _r_9 = term_keep(e, _r_9);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _r_9;
      STK(1) = FID_SETUP_K2234;
      WL_PUSHN(2);
    } else {
      u64 _t_6 = task_node(e, FID_SETUP_K2234, WL_CONT, WL_IDX, 1);
      e.mem[_t_6 + 0] = _r_9;
      WL_CONT = term_tsk(FID_SETUP_K2234, _t_6);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
      u64 _t_7 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
      e.mem[_t_7 + 0] = term_ctr(CID_CON, STAT_OFF + 4408);
      e.mem[_t_7 + 1] = _r_9;
      return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_7);
    }
    r0 = term_ctr(CID_CON, STAT_OFF + 4408);
    r1 = _r_9;
    WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_K2234)
  {
    WL_POPN(1);
    Term _r_10 = STK(0);
    Term _h_6 = r0;
    WL_OPEN
    u64 _nd_15 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_15 + 0] = _r_10;
    e.mem[_nd_15 + 1] = _h_6;
    r0 = term_clo(FID_SETUP_C2235, _nd_15);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2235)
  {
    Term _r_11 = r0;
    Term _h_7 = r1;
    Term _x_6 = r2;
    WL_OPEN
    u64 _nd_16 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_16 + 0] = _r_11;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_48 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_48 + 0] = _h_7;
      e.mem[_t_48 + 1] = term_clo(FID_SETUP_C2236, _nd_16);
      e.mem[_t_48 + 2] = _x_6;
      return term_tsk(FID_IO_BIND, _t_48);
    }
    r0 = _h_7;
    r1 = term_clo(FID_SETUP_C2236, _nd_16);
    r2 = _x_6;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2236)
  {
    Term _r_12 = r0;
    Term _x_7 = r1;
    WL_OPEN
    u32 _o_12 = 0;
    Term _o_13 = 0;
    u32 _o_14 = 0;
    Term _o_15 = 0;
    if (term_aux(_x_7) == CID____SRC_GIT_TYPES_RRUN) {
      _o_12 = 0;
      Term _fb_3[3];
      u64 _sp_6 = ctr_take(e, _x_7, 3, _fb_3);
      u32 _f_12 = _fb_3[0];
      u32 _f_13 = _fb_3[1];
      Term _f_14 = _fb_3[2];
      spare_free(e, cls_fit(3), _sp_6);
      _o_13 = _f_12;
      _o_14 = _f_13;
      _o_15 = _f_14;
    } else {
      _o_12 = 1;
      u64 _sp_7 = term_loc(_x_7);
      Term _f_15 = e.mem[_sp_7 + 0];
      heap_free(e, cls_fit(1), _sp_7);
      _o_13 = _f_15;
    }
    term_sink(e, _o_13);
    term_sink(e, _o_15);
    _r_12 = term_keep(e, _r_12);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _r_12;
      STK(1) = FID_SETUP_K2237;
      WL_PUSHN(2);
    } else {
      u64 _t_8 = task_node(e, FID_SETUP_K2237, WL_CONT, WL_IDX, 1);
      e.mem[_t_8 + 0] = _r_12;
      WL_CONT = term_tsk(FID_SETUP_K2237, _t_8);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
      u64 _t_9 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
      e.mem[_t_9 + 0] = term_ctr(CID_CON, STAT_OFF + 4454);
      e.mem[_t_9 + 1] = _r_12;
      return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_9);
    }
    r0 = term_ctr(CID_CON, STAT_OFF + 4454);
    r1 = _r_12;
    WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_K2237)
  {
    WL_POPN(1);
    Term _r_13 = STK(0);
    Term _h_8 = r0;
    WL_OPEN
    u64 _nd_17 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_17 + 0] = _r_13;
    e.mem[_nd_17 + 1] = _h_8;
    r0 = term_clo(FID_SETUP_C2238, _nd_17);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2238)
  {
    Term _r_14 = r0;
    Term _h_9 = r1;
    Term _x_8 = r2;
    WL_OPEN
    u64 _nd_18 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_18 + 0] = _r_14;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_47 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_47 + 0] = _h_9;
      e.mem[_t_47 + 1] = term_clo(FID_SETUP_C2239, _nd_18);
      e.mem[_t_47 + 2] = _x_8;
      return term_tsk(FID_IO_BIND, _t_47);
    }
    r0 = _h_9;
    r1 = term_clo(FID_SETUP_C2239, _nd_18);
    r2 = _x_8;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2239)
  {
    Term _r_15 = r0;
    Term _x_9 = r1;
    WL_OPEN
    u32 _o_16 = 0;
    Term _o_17 = 0;
    u32 _o_18 = 0;
    Term _o_19 = 0;
    if (term_aux(_x_9) == CID____SRC_GIT_TYPES_RRUN) {
      _o_16 = 0;
      Term _fb_4[3];
      u64 _sp_8 = ctr_take(e, _x_9, 3, _fb_4);
      u32 _f_16 = _fb_4[0];
      u32 _f_17 = _fb_4[1];
      Term _f_18 = _fb_4[2];
      spare_free(e, cls_fit(3), _sp_8);
      _o_17 = _f_16;
      _o_18 = _f_17;
      _o_19 = _f_18;
    } else {
      _o_16 = 1;
      u64 _sp_9 = term_loc(_x_9);
      Term _f_19 = e.mem[_sp_9 + 0];
      heap_free(e, cls_fit(1), _sp_9);
      _o_17 = _f_19;
    }
    term_sink(e, _o_17);
    term_sink(e, _o_19);
    _r_15 = term_keep(e, _r_15);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _r_15;
      STK(1) = FID_SETUP_K2240;
      WL_PUSHN(2);
    } else {
      u64 _t_10 = task_node(e, FID_SETUP_K2240, WL_CONT, WL_IDX, 1);
      e.mem[_t_10 + 0] = _r_15;
      WL_CONT = term_tsk(FID_SETUP_K2240, _t_10);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
      u64 _t_11 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
      e.mem[_t_11 + 0] = term_ctr(CID_CON, STAT_OFF + 4460);
      e.mem[_t_11 + 1] = _r_15;
      return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_11);
    }
    r0 = term_ctr(CID_CON, STAT_OFF + 4460);
    r1 = _r_15;
    WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_K2240)
  {
    WL_POPN(1);
    Term _r_16 = STK(0);
    Term _h_10 = r0;
    WL_OPEN
    u64 _nd_19 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_19 + 0] = _r_16;
    e.mem[_nd_19 + 1] = _h_10;
    r0 = term_clo(FID_SETUP_C2241, _nd_19);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2241)
  {
    Term _r_17 = r0;
    Term _h_11 = r1;
    Term _x_10 = r2;
    WL_OPEN
    u64 _nd_20 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_20 + 0] = _r_17;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_46 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_46 + 0] = _h_11;
      e.mem[_t_46 + 1] = term_clo(FID_SETUP_C2242, _nd_20);
      e.mem[_t_46 + 2] = _x_10;
      return term_tsk(FID_IO_BIND, _t_46);
    }
    r0 = _h_11;
    r1 = term_clo(FID_SETUP_C2242, _nd_20);
    r2 = _x_10;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2242)
  {
    Term _r_18 = r0;
    Term _x_11 = r1;
    WL_OPEN
    u32 _o_20 = 0;
    Term _o_21 = 0;
    u32 _o_22 = 0;
    Term _o_23 = 0;
    if (term_aux(_x_11) == CID____SRC_GIT_TYPES_RRUN) {
      _o_20 = 0;
      Term _fb_5[3];
      u64 _sp_10 = ctr_take(e, _x_11, 3, _fb_5);
      u32 _f_20 = _fb_5[0];
      u32 _f_21 = _fb_5[1];
      Term _f_22 = _fb_5[2];
      spare_free(e, cls_fit(3), _sp_10);
      _o_21 = _f_20;
      _o_22 = _f_21;
      _o_23 = _f_22;
    } else {
      _o_20 = 1;
      u64 _sp_11 = term_loc(_x_11);
      Term _f_23 = e.mem[_sp_11 + 0];
      heap_free(e, cls_fit(1), _sp_11);
      _o_21 = _f_23;
    }
    term_sink(e, _o_21);
    term_sink(e, _o_23);
    _r_18 = term_keep(e, _r_18);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _r_18;
      STK(1) = FID_SETUP_K2243;
      WL_PUSHN(2);
    } else {
      u64 _t_12 = task_node(e, FID_SETUP_K2243, WL_CONT, WL_IDX, 1);
      e.mem[_t_12 + 0] = _r_18;
      WL_CONT = term_tsk(FID_SETUP_K2243, _t_12);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
      u64 _t_13 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
      e.mem[_t_13 + 0] = term_ctr(CID_CON, STAT_OFF + 4466);
      e.mem[_t_13 + 1] = _r_18;
      return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_13);
    }
    r0 = term_ctr(CID_CON, STAT_OFF + 4466);
    r1 = _r_18;
    WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_K2243)
  {
    WL_POPN(1);
    Term _r_19 = STK(0);
    Term _h_12 = r0;
    WL_OPEN
    u64 _nd_21 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_21 + 0] = _r_19;
    e.mem[_nd_21 + 1] = _h_12;
    r0 = term_clo(FID_SETUP_C2244, _nd_21);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2244)
  {
    Term _r_20 = r0;
    Term _h_13 = r1;
    Term _x_12 = r2;
    WL_OPEN
    u64 _nd_22 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_22 + 0] = _r_20;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_45 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_45 + 0] = _h_13;
      e.mem[_t_45 + 1] = term_clo(FID_SETUP_C2245, _nd_22);
      e.mem[_t_45 + 2] = _x_12;
      return term_tsk(FID_IO_BIND, _t_45);
    }
    r0 = _h_13;
    r1 = term_clo(FID_SETUP_C2245, _nd_22);
    r2 = _x_12;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2245)
  {
    Term _r_21 = r0;
    Term _x_13 = r1;
    WL_OPEN
    u32 _o_24 = 0;
    Term _o_25 = 0;
    u32 _o_26 = 0;
    Term _o_27 = 0;
    if (term_aux(_x_13) == CID____SRC_GIT_TYPES_RRUN) {
      _o_24 = 0;
      Term _fb_6[3];
      u64 _sp_12 = ctr_take(e, _x_13, 3, _fb_6);
      u32 _f_24 = _fb_6[0];
      u32 _f_25 = _fb_6[1];
      Term _f_26 = _fb_6[2];
      spare_free(e, cls_fit(3), _sp_12);
      _o_25 = _f_24;
      _o_26 = _f_25;
      _o_27 = _f_26;
    } else {
      _o_24 = 1;
      u64 _sp_13 = term_loc(_x_13);
      Term _f_27 = e.mem[_sp_13 + 0];
      heap_free(e, cls_fit(1), _sp_13);
      _o_25 = _f_27;
    }
    term_sink(e, _o_25);
    term_sink(e, _o_27);
    _r_21 = term_keep(e, _r_21);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _r_21;
      STK(1) = FID_SETUP_K2246;
      WL_PUSHN(2);
    } else {
      u64 _t_14 = task_node(e, FID_SETUP_K2246, WL_CONT, WL_IDX, 1);
      e.mem[_t_14 + 0] = _r_21;
      WL_CONT = term_tsk(FID_SETUP_K2246, _t_14);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID_MOVE_SCRIPT)) {
      u64 _t_15 = task_node(e, FID_MOVE_SCRIPT, WL_CONT, WL_IDX, 0);
      e.mem[_t_15 + 0] = _r_21;
      e.mem[_t_15 + 1] = term_ctr(CID_SCON, STAT_OFF + 1695);
      e.mem[_t_15 + 2] = term_ctr(CID_SCON, STAT_OFF + 1557);
      return term_tsk(FID_MOVE_SCRIPT, _t_15);
    }
    r0 = _r_21;
    r1 = term_ctr(CID_SCON, STAT_OFF + 1695);
    r2 = term_ctr(CID_SCON, STAT_OFF + 1557);
    WL_JMP(FID_MOVE_SCRIPT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_K2246)
  {
    WL_POPN(1);
    Term _r_22 = STK(0);
    Term _h_14 = r0;
    WL_OPEN
    u64 _nd_23 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_23 + 0] = _h_14;
    e.mem[_nd_23 + 1] = term_pak(CID_NIL, 0);
    u64 _nd_24 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_24 + 0] = term_ctr(CID_SCON, STAT_OFF + 3397);
    e.mem[_nd_24 + 1] = term_ctr(CID_CON, _nd_23);
    u64 _nd_25 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_25 + 0] = term_ctr(CID_SCON, STAT_OFF + 627);
    e.mem[_nd_25 + 1] = term_ctr(CID_CON, _nd_24);
    _r_22 = term_keep(e, _r_22);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _r_22;
      STK(1) = FID_SETUP_K2247;
      WL_PUSHN(2);
    } else {
      u64 _t_16 = task_node(e, FID_SETUP_K2247, WL_CONT, WL_IDX, 1);
      e.mem[_t_16 + 0] = _r_22;
      WL_CONT = term_tsk(FID_SETUP_K2247, _t_16);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
      u64 _t_17 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
      e.mem[_t_17 + 0] = term_ctr(CID_CON, _nd_25);
      e.mem[_t_17 + 1] = _r_22;
      return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_17);
    }
    r0 = term_ctr(CID_CON, _nd_25);
    r1 = _r_22;
    WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_K2247)
  {
    WL_POPN(1);
    Term _r_23 = STK(0);
    Term _h_15 = r0;
    WL_OPEN
    u64 _nd_26 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_26 + 0] = _r_23;
    e.mem[_nd_26 + 1] = _h_15;
    r0 = term_clo(FID_SETUP_C2248, _nd_26);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2248)
  {
    Term _r_24 = r0;
    Term _h_16 = r1;
    Term _x_14 = r2;
    WL_OPEN
    u64 _nd_27 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_27 + 0] = _r_24;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_44 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_44 + 0] = _h_16;
      e.mem[_t_44 + 1] = term_clo(FID_SETUP_C2249, _nd_27);
      e.mem[_t_44 + 2] = _x_14;
      return term_tsk(FID_IO_BIND, _t_44);
    }
    r0 = _h_16;
    r1 = term_clo(FID_SETUP_C2249, _nd_27);
    r2 = _x_14;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2249)
  {
    Term _r_25 = r0;
    Term _x_15 = r1;
    WL_OPEN
    u32 _o_28 = 0;
    Term _o_29 = 0;
    u32 _o_30 = 0;
    Term _o_31 = 0;
    if (term_aux(_x_15) == CID____SRC_GIT_TYPES_RRUN) {
      _o_28 = 0;
      Term _fb_7[3];
      u64 _sp_14 = ctr_take(e, _x_15, 3, _fb_7);
      u32 _f_28 = _fb_7[0];
      u32 _f_29 = _fb_7[1];
      Term _f_30 = _fb_7[2];
      spare_free(e, cls_fit(3), _sp_14);
      _o_29 = _f_28;
      _o_30 = _f_29;
      _o_31 = _f_30;
    } else {
      _o_28 = 1;
      u64 _sp_15 = term_loc(_x_15);
      Term _f_31 = e.mem[_sp_15 + 0];
      heap_free(e, cls_fit(1), _sp_15);
      _o_29 = _f_31;
    }
    term_sink(e, _o_29);
    term_sink(e, _o_31);
    _r_25 = term_keep(e, _r_25);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _r_25;
      STK(1) = FID_SETUP_K2250;
      WL_PUSHN(2);
    } else {
      u64 _t_18 = task_node(e, FID_SETUP_K2250, WL_CONT, WL_IDX, 1);
      e.mem[_t_18 + 0] = _r_25;
      WL_CONT = term_tsk(FID_SETUP_K2250, _t_18);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID_MOVE_SCRIPT)) {
      u64 _t_19 = task_node(e, FID_MOVE_SCRIPT, WL_CONT, WL_IDX, 0);
      e.mem[_t_19 + 0] = _r_25;
      e.mem[_t_19 + 1] = term_ctr(CID_SCON, STAT_OFF + 1357);
      e.mem[_t_19 + 2] = term_ctr(CID_SCON, STAT_OFF + 1223);
      return term_tsk(FID_MOVE_SCRIPT, _t_19);
    }
    r0 = _r_25;
    r1 = term_ctr(CID_SCON, STAT_OFF + 1357);
    r2 = term_ctr(CID_SCON, STAT_OFF + 1223);
    WL_JMP(FID_MOVE_SCRIPT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_K2250)
  {
    WL_POPN(1);
    Term _r_26 = STK(0);
    Term _h_17 = r0;
    WL_OPEN
    u64 _nd_28 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_28 + 0] = _h_17;
    e.mem[_nd_28 + 1] = term_pak(CID_NIL, 0);
    u64 _nd_29 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_29 + 0] = term_ctr(CID_SCON, STAT_OFF + 3397);
    e.mem[_nd_29 + 1] = term_ctr(CID_CON, _nd_28);
    u64 _nd_30 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_30 + 0] = term_ctr(CID_SCON, STAT_OFF + 627);
    e.mem[_nd_30 + 1] = term_ctr(CID_CON, _nd_29);
    _r_26 = term_keep(e, _r_26);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _r_26;
      STK(1) = FID_SETUP_K2251;
      WL_PUSHN(2);
    } else {
      u64 _t_20 = task_node(e, FID_SETUP_K2251, WL_CONT, WL_IDX, 1);
      e.mem[_t_20 + 0] = _r_26;
      WL_CONT = term_tsk(FID_SETUP_K2251, _t_20);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
      u64 _t_21 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
      e.mem[_t_21 + 0] = term_ctr(CID_CON, _nd_30);
      e.mem[_t_21 + 1] = _r_26;
      return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_21);
    }
    r0 = term_ctr(CID_CON, _nd_30);
    r1 = _r_26;
    WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_K2251)
  {
    WL_POPN(1);
    Term _r_27 = STK(0);
    Term _h_18 = r0;
    WL_OPEN
    u64 _nd_31 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_31 + 0] = _r_27;
    e.mem[_nd_31 + 1] = _h_18;
    r0 = term_clo(FID_SETUP_C2252, _nd_31);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2252)
  {
    Term _r_28 = r0;
    Term _h_19 = r1;
    Term _x_16 = r2;
    WL_OPEN
    u64 _nd_32 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_32 + 0] = _r_28;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_43 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_43 + 0] = _h_19;
      e.mem[_t_43 + 1] = term_clo(FID_SETUP_C2253, _nd_32);
      e.mem[_t_43 + 2] = _x_16;
      return term_tsk(FID_IO_BIND, _t_43);
    }
    r0 = _h_19;
    r1 = term_clo(FID_SETUP_C2253, _nd_32);
    r2 = _x_16;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2253)
  {
    Term _r_29 = r0;
    Term _x_17 = r1;
    WL_OPEN
    u32 _o_32 = 0;
    Term _o_33 = 0;
    u32 _o_34 = 0;
    Term _o_35 = 0;
    if (term_aux(_x_17) == CID____SRC_GIT_TYPES_RRUN) {
      _o_32 = 0;
      Term _fb_8[3];
      u64 _sp_16 = ctr_take(e, _x_17, 3, _fb_8);
      u32 _f_32 = _fb_8[0];
      u32 _f_33 = _fb_8[1];
      Term _f_34 = _fb_8[2];
      spare_free(e, cls_fit(3), _sp_16);
      _o_33 = _f_32;
      _o_34 = _f_33;
      _o_35 = _f_34;
    } else {
      _o_32 = 1;
      u64 _sp_17 = term_loc(_x_17);
      Term _f_35 = e.mem[_sp_17 + 0];
      heap_free(e, cls_fit(1), _sp_17);
      _o_33 = _f_35;
    }
    term_sink(e, _o_33);
    term_sink(e, _o_35);
    _r_29 = term_keep(e, _r_29);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _r_29;
      STK(1) = FID_SETUP_K2254;
      WL_PUSHN(2);
    } else {
      u64 _t_22 = task_node(e, FID_SETUP_K2254, WL_CONT, WL_IDX, 1);
      e.mem[_t_22 + 0] = _r_29;
      WL_CONT = term_tsk(FID_SETUP_K2254, _t_22);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID_GIT_SEQ)) {
      u64 _t_23 = task_node(e, FID_GIT_SEQ, WL_CONT, WL_IDX, 0);
      e.mem[_t_23 + 0] = term_ctr(CID_CON, STAT_OFF + 4528);
      e.mem[_t_23 + 1] = _r_29;
      return term_tsk(FID_GIT_SEQ, _t_23);
    }
    r0 = term_ctr(CID_CON, STAT_OFF + 4528);
    r1 = _r_29;
    WL_JMP(FID_GIT_SEQ);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_K2254)
  {
    WL_POPN(1);
    Term _r_30 = STK(0);
    Term _h_20 = r0;
    WL_OPEN
    u64 _nd_33 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_33 + 0] = _r_30;
    e.mem[_nd_33 + 1] = _h_20;
    r0 = term_clo(FID_SETUP_C2255, _nd_33);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2255)
  {
    Term _r_31 = r0;
    Term _h_21 = r1;
    Term _x_18 = r2;
    WL_OPEN
    u64 _nd_34 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_34 + 0] = _r_31;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_42 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_42 + 0] = _h_21;
      e.mem[_t_42 + 1] = term_clo(FID_SETUP_C2256, _nd_34);
      e.mem[_t_42 + 2] = _x_18;
      return term_tsk(FID_IO_BIND, _t_42);
    }
    r0 = _h_21;
    r1 = term_clo(FID_SETUP_C2256, _nd_34);
    r2 = _x_18;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2256)
  {
    Term _r_32 = r0;
    Term _x_19 = r1;
    WL_OPEN
    u32 _o_36 = 0;
    Term _o_37 = 0;
    u32 _o_38 = 0;
    Term _o_39 = 0;
    if (term_aux(_x_19) == CID____SRC_GIT_TYPES_RRUN) {
      _o_36 = 0;
      Term _fb_9[3];
      u64 _sp_18 = ctr_take(e, _x_19, 3, _fb_9);
      u32 _f_36 = _fb_9[0];
      u32 _f_37 = _fb_9[1];
      Term _f_38 = _fb_9[2];
      spare_free(e, cls_fit(3), _sp_18);
      _o_37 = _f_36;
      _o_38 = _f_37;
      _o_39 = _f_38;
    } else {
      _o_36 = 1;
      u64 _sp_19 = term_loc(_x_19);
      Term _f_39 = e.mem[_sp_19 + 0];
      heap_free(e, cls_fit(1), _sp_19);
      _o_37 = _f_39;
    }
    term_sink(e, _o_37);
    term_sink(e, _o_39);
    _r_32 = term_keep(e, _r_32);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _r_32;
      STK(1) = FID_SETUP_K2257;
      WL_PUSHN(2);
    } else {
      u64 _t_24 = task_node(e, FID_SETUP_K2257, WL_CONT, WL_IDX, 1);
      e.mem[_t_24 + 0] = _r_32;
      WL_CONT = term_tsk(FID_SETUP_K2257, _t_24);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
      u64 _t_25 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
      e.mem[_t_25 + 0] = _r_32;
      e.mem[_t_25 + 1] = term_ctr(CID_CON, STAT_OFF + 139);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_25);
    }
    r0 = _r_32;
    r1 = term_ctr(CID_CON, STAT_OFF + 139);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_K2257)
  {
    WL_POPN(1);
    Term _r_33 = STK(0);
    Term _h_22 = r0;
    WL_OPEN
    u64 _nd_35 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_35 + 0] = _r_33;
    e.mem[_nd_35 + 1] = _h_22;
    r0 = term_clo(FID_SETUP_C2258, _nd_35);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2258)
  {
    Term _r_34 = r0;
    Term _h_23 = r1;
    Term _x_20 = r2;
    WL_OPEN
    u64 _nd_36 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_36 + 0] = _r_34;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_41 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_41 + 0] = _h_23;
      e.mem[_t_41 + 1] = term_clo(FID_SETUP_C2259, _nd_36);
      e.mem[_t_41 + 2] = _x_20;
      return term_tsk(FID_IO_BIND, _t_41);
    }
    r0 = _h_23;
    r1 = term_clo(FID_SETUP_C2259, _nd_36);
    r2 = _x_20;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2259)
  {
    Term _r_35 = r0;
    Term _x_21 = r1;
    WL_OPEN
    u32 _o_40 = 0;
    Term _o_41 = 0;
    Term _o_42 = 0;
    if (term_aux(_x_21) == CID____SRC_GIT_TYPES_GRUN) {
      _o_40 = 0;
      u64 _sp_20 = term_loc(_x_21);
      u32 _f_40 = e.mem[_sp_20 + 0];
      Term _f_41 = e.mem[_sp_20 + 1];
      heap_free(e, cls_fit(2), _sp_20);
      _o_41 = _f_40;
      _o_42 = _f_41;
    } else {
      _o_40 = 1;
      u64 _sp_21 = term_loc(_x_21);
      Term _f_42 = e.mem[_sp_21 + 0];
      heap_free(e, cls_fit(1), _sp_21);
      _o_41 = _f_42;
    }
    Term _v_0 = 0;
    Term _v_1 = 0;
    Term _o_43[1];
    if (spin_47(e, _o_43, _o_40, _o_41, _o_42) == 0) {
      return 0;
    }
    _v_1 = _o_43[0];
    _v_0 = _v_1;
    if (seq) {
      WL_ROOM(2);
      STK(0) = _r_35;
      STK(1) = FID_SETUP_K2260;
      WL_PUSHN(2);
    } else {
      u64 _t_26 = task_node(e, FID_SETUP_K2260, WL_CONT, WL_IDX, 1);
      e.mem[_t_26 + 0] = _r_35;
      WL_CONT = term_tsk(FID_SETUP_K2260, _t_26);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
      u64 _t_27 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
      e.mem[_t_27 + 0] = _v_0;
      return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_27);
    }
    r0 = _v_0;
    WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_K2260)
  {
    WL_POPN(1);
    Term _r_36 = STK(0);
    Term _h_24 = r0;
    WL_OPEN
    u64 _nd_37 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_37 + 0] = _r_36;
    e.mem[_nd_37 + 1] = _h_24;
    r0 = term_clo(FID_SETUP_C2261, _nd_37);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2261)
  {
    Term _r_37 = r0;
    Term _h_25 = r1;
    Term _x_22 = r2;
    WL_OPEN
    u64 _nd_38 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_38 + 0] = _h_25;
    u64 _nd_39 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_39 + 0] = _r_37;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_40 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_40 + 0] = term_clo(FID_SETUP_C2262, _nd_38);
      e.mem[_t_40 + 1] = term_clo(FID_SETUP_C2263, _nd_39);
      e.mem[_t_40 + 2] = _x_22;
      return term_tsk(FID_IO_BIND, _t_40);
    }
    r0 = term_clo(FID_SETUP_C2262, _nd_38);
    r1 = term_clo(FID_SETUP_C2263, _nd_39);
    r2 = _x_22;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2262)
  {
    Term _h_26 = r0;
    Term _x_23 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_28 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_28 + 0] = _h_26;
      e.mem[_t_28 + 1] = _x_23;
      return term_tsk(FID_IO_PURE, _t_28);
    }
    r0 = _h_26;
    r1 = _x_23;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2263)
  {
    Term _r_38 = r0;
    Term _x_24 = r1;
    WL_OPEN
    _r_38 = term_keep(e, _r_38);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _r_38;
      STK(1) = _x_24;
      STK(2) = FID_SETUP_K2264;
      WL_PUSHN(3);
    } else {
      u64 _t_29 = task_node(e, FID_SETUP_K2264, WL_CONT, WL_IDX, 1);
      e.mem[_t_29 + 0] = _r_38;
      e.mem[_t_29 + 1] = _x_24;
      WL_CONT = term_tsk(FID_SETUP_K2264, _t_29);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_30 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_30 + 0] = _r_38;
      e.mem[_t_30 + 1] = term_ctr(CID_SCON, STAT_OFF + 3461);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_30);
    }
    r0 = _r_38;
    r1 = term_ctr(CID_SCON, STAT_OFF + 3461);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_K2264)
  {
    WL_POPN(2);
    Term _r_39 = STK(0);
    Term _x_25 = STK(1);
    Term _h_27 = r0;
    WL_OPEN
    _r_39 = term_keep(e, _r_39);
    _x_25 = term_keep(e, _x_25);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _r_39;
      STK(1) = _x_25;
      STK(2) = FID_SETUP_K2265;
      WL_PUSHN(3);
    } else {
      u64 _t_31 = task_node(e, FID_SETUP_K2265, WL_CONT, WL_IDX, 1);
      e.mem[_t_31 + 0] = _r_39;
      e.mem[_t_31 + 1] = _x_25;
      WL_CONT = term_tsk(FID_SETUP_K2265, _t_31);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID_AUTHOR)) {
      u64 _t_32 = task_node(e, FID_AUTHOR, WL_CONT, WL_IDX, 0);
      e.mem[_t_32 + 0] = _r_39;
      e.mem[_t_32 + 1] = _h_27;
      e.mem[_t_32 + 2] = term_ctr(CID_SCON, STAT_OFF + 1557);
      e.mem[_t_32 + 3] = _x_25;
      e.mem[_t_32 + 4] = term_ctr(CID_SCON, STAT_OFF + 3499);
      return term_tsk(FID_AUTHOR, _t_32);
    }
    r0 = _r_39;
    r1 = _h_27;
    r2 = term_ctr(CID_SCON, STAT_OFF + 1557);
    r3 = _x_25;
    r4 = term_ctr(CID_SCON, STAT_OFF + 3499);
    WL_JMP(FID_AUTHOR);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_K2265)
  {
    WL_POPN(2);
    Term _r_40 = STK(0);
    Term _x_26 = STK(1);
    Term _h_28 = r0;
    WL_OPEN
    u64 _nd_40 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_40 + 0] = _r_40;
    e.mem[_nd_40 + 1] = _x_26;
    e.mem[_nd_40 + 2] = _h_28;
    r0 = term_clo(FID_SETUP_C2266, _nd_40);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2266)
  {
    Term _r_41 = r0;
    Term _x_27 = r1;
    Term _h_29 = r2;
    Term _x_28 = r3;
    WL_OPEN
    u64 _nd_41 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_41 + 0] = _r_41;
    e.mem[_nd_41 + 1] = _x_27;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_39 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_39 + 0] = _h_29;
      e.mem[_t_39 + 1] = term_clo(FID_SETUP_C2267, _nd_41);
      e.mem[_t_39 + 2] = _x_28;
      return term_tsk(FID_IO_BIND, _t_39);
    }
    r0 = _h_29;
    r1 = term_clo(FID_SETUP_C2267, _nd_41);
    r2 = _x_28;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2267)
  {
    Term _r_42 = r0;
    Term _x_29 = r1;
    Term _x_30 = r2;
    WL_OPEN
    term_sink(e, _x_30);
    _r_42 = term_keep(e, _r_42);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _r_42;
      STK(1) = _x_29;
      STK(2) = FID_SETUP_K2268;
      WL_PUSHN(3);
    } else {
      u64 _t_33 = task_node(e, FID_SETUP_K2268, WL_CONT, WL_IDX, 1);
      e.mem[_t_33 + 0] = _r_42;
      e.mem[_t_33 + 1] = _x_29;
      WL_CONT = term_tsk(FID_SETUP_K2268, _t_33);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_34 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_34 + 0] = _r_42;
      e.mem[_t_34 + 1] = term_ctr(CID_SCON, STAT_OFF + 3525);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_34);
    }
    r0 = _r_42;
    r1 = term_ctr(CID_SCON, STAT_OFF + 3525);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_K2268)
  {
    WL_POPN(2);
    Term _r_43 = STK(0);
    Term _x_31 = STK(1);
    Term _h_30 = r0;
    WL_OPEN
    _x_31 = term_keep(e, _x_31);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _x_31;
      STK(1) = FID_SETUP_K2269;
      WL_PUSHN(2);
    } else {
      u64 _t_35 = task_node(e, FID_SETUP_K2269, WL_CONT, WL_IDX, 1);
      e.mem[_t_35 + 0] = _x_31;
      WL_CONT = term_tsk(FID_SETUP_K2269, _t_35);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID_AUTHOR)) {
      u64 _t_36 = task_node(e, FID_AUTHOR, WL_CONT, WL_IDX, 0);
      e.mem[_t_36 + 0] = _r_43;
      e.mem[_t_36 + 1] = _h_30;
      e.mem[_t_36 + 2] = term_ctr(CID_SCON, STAT_OFF + 1223);
      e.mem[_t_36 + 3] = _x_31;
      e.mem[_t_36 + 4] = term_ctr(CID_SCON, STAT_OFF + 3547);
      return term_tsk(FID_AUTHOR, _t_36);
    }
    r0 = _r_43;
    r1 = _h_30;
    r2 = term_ctr(CID_SCON, STAT_OFF + 1223);
    r3 = _x_31;
    r4 = term_ctr(CID_SCON, STAT_OFF + 3547);
    WL_JMP(FID_AUTHOR);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_K2269)
  {
    WL_POPN(1);
    Term _x_32 = STK(0);
    Term _h_31 = r0;
    WL_OPEN
    u64 _nd_42 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_42 + 0] = _x_32;
    e.mem[_nd_42 + 1] = _h_31;
    r0 = term_clo(FID_SETUP_C2270, _nd_42);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2270)
  {
    Term _x_33 = r0;
    Term _h_32 = r1;
    Term _x_34 = r2;
    WL_OPEN
    u64 _nd_43 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_43 + 0] = _x_33;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_38 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_38 + 0] = _h_32;
      e.mem[_t_38 + 1] = term_clo(FID_SETUP_C2271, _nd_43);
      e.mem[_t_38 + 2] = _x_34;
      return term_tsk(FID_IO_BIND, _t_38);
    }
    r0 = _h_32;
    r1 = term_clo(FID_SETUP_C2271, _nd_43);
    r2 = _x_34;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2271)
  {
    Term _x_35 = r0;
    Term _x_36 = r1;
    WL_OPEN
    term_sink(e, _x_36);
    u64 _nd_44 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_44 + 0] = _x_35;
    r0 = term_clo(FID_SETUP_C2272, _nd_44);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C2272)
  {
    Term _x_37 = r0;
    Term _x_38 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_37 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_37 + 0] = _x_37;
      e.mem[_t_37 + 1] = _x_38;
      return term_tsk(FID_IO_PURE, _t_37);
    }
    r0 = _x_37;
    r1 = _x_38;
    WL_JMP(FID_IO_PURE);
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
        STK(1) = FID_STRING_APPEND_K2274;
        WL_PUSHN(2);
      } else {
        u64 _t_0 = task_node(e, FID_STRING_APPEND_K2274, WL_CONT, WL_IDX, 1);
        e.mem[_t_0 + 0] = _f_0;
        WL_CONT = term_tsk(FID_STRING_APPEND_K2274, _t_0);
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
  WL_CASE(FID_STRING_APPEND_K2274)
  {
    WL_POPN(1);
    u32 _f_2 = STK(0);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_0 + 0] = rfc_seal(e, _f_2);
    e.mem[_nd_0 + 1] = rfc_seal(e, _h_0);
    r0 = term_ctr(CID_SCON, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_JOIN)
  {
    Term _sep_0 = r0;
    Term _xs_0 = r1;
    WL_OPEN
    if (term_aux(_xs_0) == CID_NIL) {
      term_sink(e, _sep_0);
      r0 = term_pak(CID_SNIL, 0);
      WL_RETN(1);
    } else {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _xs_0, 2, _fb_0);
      Term _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      spare_free(e, cls_fit(2), _sp_0);
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_JOIN_GO)) {
        u64 _t_0 = task_node(e, FID____SRC_GIT_TEXT_JOIN_GO, WL_CONT, WL_IDX, 0);
        e.mem[_t_0 + 0] = _sep_0;
        e.mem[_t_0 + 1] = _f_1;
        e.mem[_t_0 + 2] = _f_0;
        return term_tsk(FID____SRC_GIT_TEXT_JOIN_GO, _t_0);
      }
      r0 = _sep_0;
      r1 = _f_1;
      r2 = _f_0;
      WL_JMP(FID____SRC_GIT_TEXT_JOIN_GO);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_RUN_RES)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
    Term _r_2 = r2;
    WL_OPEN
    if (_r_0 == 0) {
      r0 = 1;
      r1 = _r_2;
      r2 = 0;
      r3 = 0;
      WL_RETN(4);
    } else {
      Term _v_0 = 0;
      Term _v_1 = 0;
      Term _o_0[1];
      if (spin_19(e, _o_0, _r_1) == 0) {
        return 0;
      }
      _v_1 = _o_0[0];
      _v_0 = _v_1;
      if (term_aux(_v_0) == CID_NIL) {
        term_sink(e, _r_1);
        r0 = 1;
        r1 = term_ctr(CID_SCON, STAT_OFF + 3365);
        r2 = 0;
        r3 = 0;
        WL_RETN(4);
      } else {
        Term _fb_0[2];
        u64 _sp_0 = ctr_take(e, _v_0, 2, _fb_0);
        Term _f_0 = _fb_0[0];
        Term _f_1 = _fb_0[1];
        term_sink(e, _r_1);
        spare_free(e, cls_fit(2), _sp_0);
        if (seq) {
          WL_ROOM(2);
          STK(0) = _f_0;
          STK(1) = FID____SRC_GIT_TEXT_RUN_RES_K2278;
          WL_PUSHN(2);
        } else {
          u64 _t_0 = task_node(e, FID____SRC_GIT_TEXT_RUN_RES_K2278, WL_CONT, WL_IDX, 1);
          e.mem[_t_0 + 0] = _f_0;
          WL_CONT = term_tsk(FID____SRC_GIT_TEXT_RUN_RES_K2278, _t_0);
          WL_IDX = 1;
        }
        if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_JOIN)) {
          u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_JOIN, WL_CONT, WL_IDX, 0);
          e.mem[_t_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 267);
          e.mem[_t_1 + 1] = _f_1;
          return term_tsk(FID____SRC_GIT_TEXT_JOIN, _t_1);
        }
        r0 = term_ctr(CID_SCON, STAT_OFF + 267);
        r1 = _f_1;
        WL_JMP(FID____SRC_GIT_TEXT_JOIN);
      }
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_RUN_RES_K2278)
  {
    WL_POPN(1);
    Term _f_2 = STK(0);
    Term _h_0 = r0;
    WL_OPEN
    Term _v_2 = 0;
    Term _v_3 = 0;
    Term _o_1[1];
    if (spin_6(e, _o_1, _f_2) == 0) {
      return 0;
    }
    _v_3 = _o_1[0];
    _v_2 = _v_3;
    if (term_aux(_v_2) == CID_NIL) {
      term_sink(e, _f_2);
      term_sink(e, _h_0);
      r0 = 1;
      r1 = term_ctr(CID_SCON, STAT_OFF + 2677);
      r2 = 0;
      r3 = 0;
      WL_RETN(4);
    } else {
      term_sink(e, _f_2);
      Term _fb_1[2];
      u64 _sp_1 = ctr_take(e, _v_2, 2, _fb_1);
      Term _f_3 = _fb_1[0];
      Term _f_4 = _fb_1[1];
      if (term_aux(_f_4) == CID_NIL) {
        term_sink(e, _f_3);
        term_sink(e, _h_0);
        spare_free(e, cls_fit(2), _sp_1);
        r0 = 1;
        r1 = term_ctr(CID_SCON, STAT_OFF + 2677);
        r2 = 0;
        r3 = 0;
        WL_RETN(4);
      } else {
        Term _fb_2[2];
        u64 _sp_2 = ctr_take(e, _f_4, 2, _fb_2);
        Term _f_5 = _fb_2[0];
        Term _f_6 = _fb_2[1];
        if (term_aux(_f_6) == CID_NIL) {
          spare_free(e, cls_fit(2), _sp_2);
          spare_free(e, cls_fit(2), _sp_1);
          if (seq) {
            WL_ROOM(4);
            STK(0) = _f_5;
            STK(1) = _h_0;
            STK(2) = _f_3;
            STK(3) = FID____SRC_GIT_TEXT_RUN_RES_K2279;
            WL_PUSHN(4);
          } else {
            u64 _t_2 = task_node(e, FID____SRC_GIT_TEXT_RUN_RES_K2279, WL_CONT, WL_IDX, 1);
            e.mem[_t_2 + 0] = _f_5;
            e.mem[_t_2 + 1] = _h_0;
            e.mem[_t_2 + 2] = _f_3;
            WL_CONT = term_tsk(FID____SRC_GIT_TEXT_RUN_RES_K2279, _t_2);
            WL_IDX = 3;
          }
          if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_EQ)) {
            u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_STR_EQ, WL_CONT, WL_IDX, 0);
            e.mem[_t_3 + 0] = _f_3;
            e.mem[_t_3 + 1] = term_ctr(CID_SCON, STAT_OFF + 2264);
            return term_tsk(FID____SRC_GIT_TEXT_STR_EQ, _t_3);
          }
          r0 = _f_3;
          r1 = term_ctr(CID_SCON, STAT_OFF + 2264);
          WL_JMP(FID____SRC_GIT_TEXT_STR_EQ);
        } else {
          term_sink(e, _f_3);
          term_sink(e, _f_5);
          Term _fb_3[2];
          u64 _sp_3 = ctr_take(e, _f_6, 2, _fb_3);
          Term _f_11 = _fb_3[0];
          Term _f_12 = _fb_3[1];
          term_sink(e, _f_11);
          term_sink(e, _f_12);
          term_sink(e, _h_0);
          spare_free(e, cls_fit(2), _sp_3);
          spare_free(e, cls_fit(2), _sp_2);
          spare_free(e, cls_fit(2), _sp_1);
          r0 = 1;
          r1 = term_ctr(CID_SCON, STAT_OFF + 2677);
          r2 = 0;
          r3 = 0;
          WL_RETN(4);
        }
      }
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_RUN_RES_K2279)
  {
    WL_POPN(3);
    Term _f_7 = STK(0);
    Term _h_1 = STK(1);
    Term _f_8 = STK(2);
    u32 _h_2 = r0;
    WL_OPEN
    if (_h_2 == 1) {
      term_sink(e, _f_8);
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_RUN_RES_NUM)) {
        u64 _t_4 = task_node(e, FID____SRC_GIT_TEXT_RUN_RES_NUM, WL_CONT, WL_IDX, 0);
        e.mem[_t_4 + 0] = _f_7;
        e.mem[_t_4 + 1] = _h_1;
        e.mem[_t_4 + 2] = 0;
        return term_tsk(FID____SRC_GIT_TEXT_RUN_RES_NUM, _t_4);
      }
      r0 = _f_7;
      r1 = _h_1;
      r2 = 0;
      WL_JMP(FID____SRC_GIT_TEXT_RUN_RES_NUM);
    } else {
      if (seq) {
        WL_ROOM(4);
        STK(0) = _f_8;
        STK(1) = _f_7;
        STK(2) = _h_1;
        STK(3) = FID____SRC_GIT_TEXT_RUN_RES_K2280;
        WL_PUSHN(4);
      } else {
        u64 _t_5 = task_node(e, FID____SRC_GIT_TEXT_RUN_RES_K2280, WL_CONT, WL_IDX, 1);
        e.mem[_t_5 + 0] = _f_8;
        e.mem[_t_5 + 1] = _f_7;
        e.mem[_t_5 + 2] = _h_1;
        WL_CONT = term_tsk(FID____SRC_GIT_TEXT_RUN_RES_K2280, _t_5);
        WL_IDX = 3;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_EQ)) {
        u64 _t_6 = task_node(e, FID____SRC_GIT_TEXT_STR_EQ, WL_CONT, WL_IDX, 0);
        e.mem[_t_6 + 0] = _f_8;
        e.mem[_t_6 + 1] = term_ctr(CID_SCON, STAT_OFF + 581);
        return term_tsk(FID____SRC_GIT_TEXT_STR_EQ, _t_6);
      }
      r0 = _f_8;
      r1 = term_ctr(CID_SCON, STAT_OFF + 581);
      WL_JMP(FID____SRC_GIT_TEXT_STR_EQ);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_RUN_RES_K2280)
  {
    WL_POPN(3);
    Term _f_9 = STK(0);
    Term _f_10 = STK(1);
    Term _h_3 = STK(2);
    u32 _h_4 = r0;
    WL_OPEN
    term_sink(e, _f_9);
    if (_h_4 == 1) {
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_RUN_RES_NUM)) {
        u64 _t_7 = task_node(e, FID____SRC_GIT_TEXT_RUN_RES_NUM, WL_CONT, WL_IDX, 0);
        e.mem[_t_7 + 0] = _f_10;
        e.mem[_t_7 + 1] = _h_3;
        e.mem[_t_7 + 2] = 1;
        return term_tsk(FID____SRC_GIT_TEXT_RUN_RES_NUM, _t_7);
      }
      r0 = _f_10;
      r1 = _h_3;
      r2 = 1;
      WL_JMP(FID____SRC_GIT_TEXT_RUN_RES_NUM);
    } else {
      term_sink(e, _f_10);
      term_sink(e, _h_3);
      r0 = 1;
      r1 = term_ctr(CID_SCON, STAT_OFF + 1549);
      r2 = 0;
      r3 = 0;
      WL_RETN(4);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_ENC_ARGV)
  {
    Term _xs_0 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_ENC_ARGV_GO)) {
      u64 _t_0 = task_node(e, FID____SRC_GIT_TEXT_ENC_ARGV_GO, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = _xs_0;
      e.mem[_t_0 + 1] = term_pak(CID_SNIL, 0);
      return term_tsk(FID____SRC_GIT_TEXT_ENC_ARGV_GO, _t_0);
    }
    r0 = _xs_0;
    r1 = term_pak(CID_SNIL, 0);
    WL_JMP(FID____SRC_GIT_TEXT_ENC_ARGV_GO);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_STR_CAT)
  {
    Term _a_0 = r0;
    Term _b_0 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_STRING_APPEND)) {
      u64 _t_0 = task_node(e, FID_STRING_APPEND, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = _a_0;
      e.mem[_t_0 + 1] = _b_0;
      return term_tsk(FID_STRING_APPEND, _t_0);
    }
    r0 = _a_0;
    r1 = _b_0;
    WL_JMP(FID_STRING_APPEND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_TRIM_NL)
  {
    Term _s_0 = r0;
    WL_OPEN
    Term _v_0 = 0;
    Term _v_1 = 0;
    Term _o_0[1];
    if (spin_19(e, _o_0, _s_0) == 0) {
      return 0;
    }
    _v_1 = _o_0[0];
    _v_0 = _v_1;
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_JOIN)) {
      u64 _t_0 = task_node(e, FID____SRC_GIT_TEXT_JOIN, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = term_ctr(CID_SCON, STAT_OFF + 267);
      e.mem[_t_0 + 1] = _v_0;
      return term_tsk(FID____SRC_GIT_TEXT_JOIN, _t_0);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 267);
    r1 = _v_0;
    WL_JMP(FID____SRC_GIT_TEXT_JOIN);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_PURE)
  {
    Term _x_0 = r0;
    Term _k_0 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_CLO_APPLY)) {
      u64 _t_0 = task_node(e, FID_CLO_APPLY, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = _k_0;
      e.mem[_t_0 + 1] = _x_0;
      return term_tsk(FID_CLO_APPLY, _t_0);
    }
    r0 = _k_0;
    r1 = _x_0;
    WL_JMP(FID_CLO_APPLY);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_PROCESS_RUNFULL)
  {
    Term _args_0 = r0;
    Term _cwd_0 = r1;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _cwd_0;
      STK(1) = FID____SRC_GIT_PROCESS_RUNFULL_K2487;
      WL_PUSHN(2);
    } else {
      u64 _t_0 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL_K2487, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _cwd_0;
      WL_CONT = term_tsk(FID____SRC_GIT_PROCESS_RUNFULL_K2487, _t_0);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_ENC_ARGV)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_ENC_ARGV, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _args_0;
      return term_tsk(FID____SRC_GIT_TEXT_ENC_ARGV, _t_1);
    }
    r0 = _args_0;
    WL_JMP(FID____SRC_GIT_TEXT_ENC_ARGV);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_PROCESS_RUNFULL_K2487)
  {
    WL_POPN(1);
    Term _cwd_1 = STK(0);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_0 + 0] = _cwd_1;
    e.mem[_nd_0 + 1] = _h_0;
    r0 = term_clo(FID____SRC_GIT_PROCESS_RUNFULL_C2488, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_PROCESS_RUNFULL_C2488)
  {
    Term _cwd_2 = r0;
    Term _h_1 = r1;
    Term _x_0 = r2;
    WL_OPEN
    Term _v_0 = 0;
    Term _v_1 = 0;
    Term _v_2 = 0;
    Term _o_0[1];
    if (spin_9(e, _o_0, _h_1) == 0) {
      return 0;
    }
    _v_2 = _o_0[0];
    _v_1 = _v_2;
    Term _v_3 = 0;
    Term _o_1[1];
    if (spin_9(e, _o_1, _v_1) == 0) {
      return 0;
    }
    _v_3 = _o_1[0];
    _v_0 = _v_3;
    u64 _nd_1 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_1 + 0] = _v_0;
    e.mem[_nd_1 + 1] = _cwd_2;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_5 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = term_clo(FID_PROCESS_RUN, _nd_1);
      e.mem[_t_5 + 1] = term_clo(FID____SRC_GIT_PROCESS_RUNFULL_C2489, 0);
      e.mem[_t_5 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_5);
    }
    r0 = term_clo(FID_PROCESS_RUN, _nd_1);
    r1 = term_clo(FID____SRC_GIT_PROCESS_RUNFULL_C2489, 0);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_PROCESS_RUNFULL_C2489)
  {
    Term _x_1 = r0;
    WL_OPEN
    u32 _o_2 = 0;
    Term _o_3 = 0;
    Term _o_4 = 0;
    if (term_aux(_x_1) == CID_FAIL) {
      _o_2 = 0;
      Term _fb_0[1];
      u64 _sp_0 = ctr_take(e, _x_1, 1, _fb_0);
      Term _f_0 = _fb_0[0];
      spare_free(e, cls_fit(1), _sp_0);
      u64 _sp_1 = term_loc(_f_0);
      Term _f_1 = e.mem[_sp_1 + 0];
      Term _f_2 = e.mem[_sp_1 + 1];
      heap_free(e, cls_fit(2), _sp_1);
      _o_3 = _f_1;
      _o_4 = _f_2;
    } else {
      _o_2 = 1;
      u64 _sp_2 = term_loc(_x_1);
      Term _f_3 = e.mem[_sp_2 + 0];
      heap_free(e, cls_fit(1), _sp_2);
      _o_3 = _f_3;
    }
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID____SRC_GIT_PROCESS_RUNFULL_K2490;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL_K2490, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_PROCESS_RUNFULL_K2490, _t_2);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_RUN_RES)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_RUN_RES, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _o_2;
      e.mem[_t_3 + 1] = _o_3;
      e.mem[_t_3 + 2] = _o_4;
      return term_tsk(FID____SRC_GIT_TEXT_RUN_RES, _t_3);
    }
    r0 = _o_2;
    r1 = _o_3;
    r2 = _o_4;
    WL_JMP(FID____SRC_GIT_TEXT_RUN_RES);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_PROCESS_RUNFULL_K2490)
  {
    u32 _h_2 = r0;
    Term _h_3 = r1;
    u32 _h_4 = r2;
    Term _h_5 = r3;
    WL_OPEN
    u64 _nd_2 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_2 + 0] = _h_2;
    e.mem[_nd_2 + 1] = _h_3;
    e.mem[_nd_2 + 2] = _h_4;
    e.mem[_nd_2 + 3] = _h_5;
    r0 = term_clo(FID____SRC_GIT_PROCESS_RUNFULL_C2491, _nd_2);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_PROCESS_RUNFULL_C2491)
  {
    u32 _h_6 = r0;
    Term _h_7 = r1;
    u32 _h_8 = r2;
    Term _h_9 = r3;
    Term _x_2 = r4;
    WL_OPEN
    Term _b_0 = 0;
    if (_h_6 == 0) {
      u64 _nd_3 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_3 + 0] = _h_7;
      e.mem[_nd_3 + 1] = _h_8;
      e.mem[_nd_3 + 2] = _h_9;
      _b_0 = term_ctr(CID____SRC_GIT_TYPES_RRUN, _nd_3);
    } else {
      u64 _nd_4 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_4 + 0] = _h_7;
      _b_0 = term_ctr(CID____SRC_GIT_TYPES_RSPAWN, _nd_4);
    }
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_4 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = _b_0;
      e.mem[_t_4 + 1] = _x_2;
      return term_tsk(FID_IO_PURE, _t_4);
    }
    r0 = _b_0;
    r1 = _x_2;
    WL_JMP(FID_IO_PURE);
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
      e.mem[_t_3 + 1] = term_clo(FID_IO_BIND_C2493, _nd_0);
      return term_tsk(FID_CLO_APPLY, _t_3);
    }
    r0 = _m_0;
    r1 = term_clo(FID_IO_BIND_C2493, _nd_0);
    WL_JMP(FID_CLO_APPLY);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_BIND_C2493)
  {
    Term _f_1 = r0;
    Term _k_1 = r1;
    Term _x_0 = r2;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _k_1;
      STK(1) = FID_IO_BIND_K2494;
      WL_PUSHN(2);
    } else {
      u64 _t_0 = task_node(e, FID_IO_BIND_K2494, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _k_1;
      WL_CONT = term_tsk(FID_IO_BIND_K2494, _t_0);
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
  WL_CASE(FID_IO_BIND_K2494)
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
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_MAIN_K2496;
      WL_PUSHN(1);
    } else {
      u64 _t_0 = task_node(e, FID_MAIN_K2496, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_MAIN_K2496, _t_0);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = term_ctr(CID_CON, STAT_OFF + 4582);
      e.mem[_t_1 + 1] = term_ctr(CID_SCON, STAT_OFF + 979);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_1);
    }
    r0 = term_ctr(CID_CON, STAT_OFF + 4582);
    r1 = term_ctr(CID_SCON, STAT_OFF + 979);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2496)
  {
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_0 + 0] = _h_0;
    r0 = term_clo(FID_MAIN_C2497, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2497)
  {
    Term _h_1 = r0;
    Term _x_0 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_246 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_246 + 0] = _h_1;
      e.mem[_t_246 + 1] = term_clo(FID_MAIN_C2498, 0);
      e.mem[_t_246 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_246);
    }
    r0 = _h_1;
    r1 = term_clo(FID_MAIN_C2498, 0);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2498)
  {
    Term _x_1 = r0;
    WL_OPEN
    u32 _o_0 = 0;
    Term _o_1 = 0;
    u32 _o_2 = 0;
    Term _o_3 = 0;
    if (term_aux(_x_1) == CID____SRC_GIT_TYPES_RRUN) {
      _o_0 = 0;
      Term _fb_0[3];
      u64 _sp_0 = ctr_take(e, _x_1, 3, _fb_0);
      u32 _f_0 = _fb_0[0];
      u32 _f_1 = _fb_0[1];
      Term _f_2 = _fb_0[2];
      spare_free(e, cls_fit(3), _sp_0);
      _o_1 = _f_0;
      _o_2 = _f_1;
      _o_3 = _f_2;
    } else {
      _o_0 = 1;
      u64 _sp_1 = term_loc(_x_1);
      Term _f_3 = e.mem[_sp_1 + 0];
      heap_free(e, cls_fit(1), _sp_1);
      _o_1 = _f_3;
    }
    Term _v_0 = 0;
    Term _v_1 = 0;
    Term _o_4[1];
    if (spin_66(e, _o_4, _o_0, _o_1, _o_2, _o_3) == 0) {
      return 0;
    }
    _v_1 = _o_4[0];
    _v_0 = _v_1;
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_MAIN_K2499;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID_MAIN_K2499, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_MAIN_K2499, _t_2);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _v_0;
      return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_3);
    }
    r0 = _v_0;
    WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2499)
  {
    Term _h_2 = r0;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_1 + 0] = _h_2;
    r0 = term_clo(FID_MAIN_C2500, _nd_1);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2500)
  {
    Term _h_3 = r0;
    Term _x_2 = r1;
    WL_OPEN
    u64 _nd_2 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_2 + 0] = _h_3;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_245 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_245 + 0] = term_clo(FID_MAIN_C2501, _nd_2);
      e.mem[_t_245 + 1] = term_clo(FID_MAIN_C2502, 0);
      e.mem[_t_245 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_245);
    }
    r0 = term_clo(FID_MAIN_C2501, _nd_2);
    r1 = term_clo(FID_MAIN_C2502, 0);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2501)
  {
    Term _h_4 = r0;
    Term _x_3 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_4 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = _h_4;
      e.mem[_t_4 + 1] = _x_3;
      return term_tsk(FID_IO_PURE, _t_4);
    }
    r0 = _h_4;
    r1 = _x_3;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2502)
  {
    Term _x_4 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _x_4;
      STK(1) = FID_MAIN_K2503;
      WL_PUSHN(2);
    } else {
      u64 _t_5 = task_node(e, FID_MAIN_K2503, WL_CONT, WL_IDX, 1);
      e.mem[_t_5 + 0] = _x_4;
      WL_CONT = term_tsk(FID_MAIN_K2503, _t_5);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_6 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_6 + 0] = term_ctr(CID_SCON, STAT_OFF + 343);
      e.mem[_t_6 + 1] = term_ctr(CID_SCON, STAT_OFF + 4568);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_6);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 343);
    r1 = term_ctr(CID_SCON, STAT_OFF + 4568);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2503)
  {
    WL_POPN(1);
    Term _x_5 = STK(0);
    Term _h_5 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_MAIN_K2504;
      WL_PUSHN(1);
    } else {
      u64 _t_7 = task_node(e, FID_MAIN_K2504, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_MAIN_K2504, _t_7);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_8 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_8 + 0] = _x_5;
      e.mem[_t_8 + 1] = _h_5;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_8);
    }
    r0 = _x_5;
    r1 = _h_5;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2504)
  {
    Term _h_6 = r0;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_3 + 0] = _h_6;
    r0 = term_clo(FID_MAIN_C2505, _nd_3);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2505)
  {
    Term _h_7 = r0;
    Term _x_6 = r1;
    WL_OPEN
    u64 _nd_4 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_4 + 0] = _h_7;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_244 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_244 + 0] = term_clo(FID_MAIN_C2506, _nd_4);
      e.mem[_t_244 + 1] = term_clo(FID_MAIN_C2507, 0);
      e.mem[_t_244 + 2] = _x_6;
      return term_tsk(FID_IO_BIND, _t_244);
    }
    r0 = term_clo(FID_MAIN_C2506, _nd_4);
    r1 = term_clo(FID_MAIN_C2507, 0);
    r2 = _x_6;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2506)
  {
    Term _h_8 = r0;
    Term _x_7 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_9 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_9 + 0] = _h_8;
      e.mem[_t_9 + 1] = _x_7;
      return term_tsk(FID_IO_PURE, _t_9);
    }
    r0 = _h_8;
    r1 = _x_7;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2507)
  {
    Term _x_8 = r0;
    WL_OPEN
    _x_8 = term_keep(e, _x_8);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _x_8;
      STK(1) = FID_MAIN_K2508;
      WL_PUSHN(2);
    } else {
      u64 _t_10 = task_node(e, FID_MAIN_K2508, WL_CONT, WL_IDX, 1);
      e.mem[_t_10 + 0] = _x_8;
      WL_CONT = term_tsk(FID_MAIN_K2508, _t_10);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID_SETUP)) {
      u64 _t_11 = task_node(e, FID_SETUP, WL_CONT, WL_IDX, 0);
      e.mem[_t_11 + 0] = _x_8;
      return term_tsk(FID_SETUP, _t_11);
    }
    r0 = _x_8;
    WL_JMP(FID_SETUP);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2508)
  {
    WL_POPN(1);
    Term _x_9 = STK(0);
    Term _h_9 = r0;
    WL_OPEN
    u64 _nd_5 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_5 + 0] = _x_9;
    e.mem[_nd_5 + 1] = _h_9;
    r0 = term_clo(FID_MAIN_C2509, _nd_5);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2509)
  {
    Term _x_10 = r0;
    Term _h_10 = r1;
    Term _x_11 = r2;
    WL_OPEN
    u64 _nd_6 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_6 + 0] = _x_10;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_243 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_243 + 0] = _h_10;
      e.mem[_t_243 + 1] = term_clo(FID_MAIN_C2510, _nd_6);
      e.mem[_t_243 + 2] = _x_11;
      return term_tsk(FID_IO_BIND, _t_243);
    }
    r0 = _h_10;
    r1 = term_clo(FID_MAIN_C2510, _nd_6);
    r2 = _x_11;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2510)
  {
    Term _x_12 = r0;
    Term _x_13 = r1;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _x_12;
      STK(1) = FID_MAIN_K2511;
      WL_PUSHN(2);
    } else {
      u64 _t_12 = task_node(e, FID_MAIN_K2511, WL_CONT, WL_IDX, 1);
      e.mem[_t_12 + 0] = _x_12;
      WL_CONT = term_tsk(FID_MAIN_K2511, _t_12);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
      u64 _t_13 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
      e.mem[_t_13 + 0] = _x_13;
      return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_13);
    }
    r0 = _x_13;
    WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2511)
  {
    WL_POPN(1);
    Term _x_14 = STK(0);
    Term _h_11 = r0;
    WL_OPEN
    Term _acc_0 = term_pak(CID_SNIL, 0);
    _x_14 = term_keep(e, _x_14);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _x_14;
      STK(1) = _h_11;
      STK(2) = _acc_0;
      STK(3) = FID_MAIN_K2512;
      WL_PUSHN(4);
    } else {
      u64 _t_14 = task_node(e, FID_MAIN_K2512, WL_CONT, WL_IDX, 1);
      e.mem[_t_14 + 0] = _x_14;
      e.mem[_t_14 + 1] = _h_11;
      e.mem[_t_14 + 2] = _acc_0;
      WL_CONT = term_tsk(FID_MAIN_K2512, _t_14);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_15 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_15 + 0] = _x_14;
      e.mem[_t_15 + 1] = term_ctr(CID_SCON, STAT_OFF + 4188);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_15);
    }
    r0 = _x_14;
    r1 = term_ctr(CID_SCON, STAT_OFF + 4188);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2512)
  {
    WL_POPN(3);
    Term _x_15 = STK(0);
    Term _h_12 = STK(1);
    Term _acc_1 = STK(2);
    Term _h_13 = r0;
    WL_OPEN
    _x_15 = term_keep(e, _x_15);
    _h_12 = term_keep(e, _h_12);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _x_15;
      STK(1) = _h_12;
      STK(2) = _acc_1;
      STK(3) = FID_MAIN_K2513;
      WL_PUSHN(4);
    } else {
      u64 _t_16 = task_node(e, FID_MAIN_K2513, WL_CONT, WL_IDX, 1);
      e.mem[_t_16 + 0] = _x_15;
      e.mem[_t_16 + 1] = _h_12;
      e.mem[_t_16 + 2] = _acc_1;
      WL_CONT = term_tsk(FID_MAIN_K2513, _t_16);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID_AUTHOR)) {
      u64 _t_17 = task_node(e, FID_AUTHOR, WL_CONT, WL_IDX, 0);
      e.mem[_t_17 + 0] = _x_15;
      e.mem[_t_17 + 1] = _h_13;
      e.mem[_t_17 + 2] = term_ctr(CID_SCON, STAT_OFF + 4200);
      e.mem[_t_17 + 3] = _h_12;
      e.mem[_t_17 + 4] = term_ctr(CID_SCON, STAT_OFF + 4236);
      return term_tsk(FID_AUTHOR, _t_17);
    }
    r0 = _x_15;
    r1 = _h_13;
    r2 = term_ctr(CID_SCON, STAT_OFF + 4200);
    r3 = _h_12;
    r4 = term_ctr(CID_SCON, STAT_OFF + 4236);
    WL_JMP(FID_AUTHOR);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2513)
  {
    WL_POPN(3);
    Term _x_16 = STK(0);
    Term _h_14 = STK(1);
    Term _acc_2 = STK(2);
    Term _h_15 = r0;
    WL_OPEN
    u64 _nd_7 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_7 + 0] = _x_16;
    e.mem[_nd_7 + 1] = _h_14;
    e.mem[_nd_7 + 2] = _acc_2;
    e.mem[_nd_7 + 3] = _h_15;
    r0 = term_clo(FID_MAIN_C2514, _nd_7);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2514)
  {
    Term _x_17 = r0;
    Term _h_16 = r1;
    Term _acc_3 = r2;
    Term _h_17 = r3;
    Term _x_18 = r4;
    WL_OPEN
    u64 _nd_8 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_8 + 0] = _x_17;
    e.mem[_nd_8 + 1] = _h_16;
    e.mem[_nd_8 + 2] = _acc_3;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_242 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_242 + 0] = _h_17;
      e.mem[_t_242 + 1] = term_clo(FID_MAIN_C2515, _nd_8);
      e.mem[_t_242 + 2] = _x_18;
      return term_tsk(FID_IO_BIND, _t_242);
    }
    r0 = _h_17;
    r1 = term_clo(FID_MAIN_C2515, _nd_8);
    r2 = _x_18;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2515)
  {
    Term _x_19 = r0;
    Term _h_18 = r1;
    Term _acc_4 = r2;
    Term _x_20 = r3;
    WL_OPEN
    _x_19 = term_keep(e, _x_19);
    if (seq) {
      WL_ROOM(5);
      STK(0) = _x_19;
      STK(1) = _h_18;
      STK(2) = _x_20;
      STK(3) = _acc_4;
      STK(4) = FID_MAIN_K2516;
      WL_PUSHN(5);
    } else {
      u64 _t_18 = task_node(e, FID_MAIN_K2516, WL_CONT, WL_IDX, 1);
      e.mem[_t_18 + 0] = _x_19;
      e.mem[_t_18 + 1] = _h_18;
      e.mem[_t_18 + 2] = _x_20;
      e.mem[_t_18 + 3] = _acc_4;
      WL_CONT = term_tsk(FID_MAIN_K2516, _t_18);
      WL_IDX = 4;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_19 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_19 + 0] = _x_19;
      e.mem[_t_19 + 1] = term_ctr(CID_SCON, STAT_OFF + 3395);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_19);
    }
    r0 = _x_19;
    r1 = term_ctr(CID_SCON, STAT_OFF + 3395);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2516)
  {
    WL_POPN(4);
    Term _x_21 = STK(0);
    Term _h_19 = STK(1);
    Term _x_22 = STK(2);
    Term _acc_5 = STK(3);
    Term _h_20 = r0;
    WL_OPEN
    _x_21 = term_keep(e, _x_21);
    _x_22 = term_keep(e, _x_22);
    if (seq) {
      WL_ROOM(5);
      STK(0) = _x_21;
      STK(1) = _h_19;
      STK(2) = _x_22;
      STK(3) = _acc_5;
      STK(4) = FID_MAIN_K2517;
      WL_PUSHN(5);
    } else {
      u64 _t_20 = task_node(e, FID_MAIN_K2517, WL_CONT, WL_IDX, 1);
      e.mem[_t_20 + 0] = _x_21;
      e.mem[_t_20 + 1] = _h_19;
      e.mem[_t_20 + 2] = _x_22;
      e.mem[_t_20 + 3] = _acc_5;
      WL_CONT = term_tsk(FID_MAIN_K2517, _t_20);
      WL_IDX = 4;
    }
    if (!DEVICE && !seq && fid_nofk(FID_LAND_OK)) {
      u64 _t_21 = task_node(e, FID_LAND_OK, WL_CONT, WL_IDX, 0);
      e.mem[_t_21 + 0] = _x_21;
      e.mem[_t_21 + 1] = term_ctr(CID_SCON, STAT_OFF + 663);
      e.mem[_t_21 + 2] = _x_22;
      e.mem[_t_21 + 3] = term_ctr(CID_CON, STAT_OFF + 707);
      e.mem[_t_21 + 4] = term_ctr(CID_SCON, STAT_OFF + 729);
      e.mem[_t_21 + 5] = _h_20;
      return term_tsk(FID_LAND_OK, _t_21);
    }
    r0 = _x_21;
    r1 = term_ctr(CID_SCON, STAT_OFF + 663);
    r2 = _x_22;
    r3 = term_ctr(CID_CON, STAT_OFF + 707);
    r4 = term_ctr(CID_SCON, STAT_OFF + 729);
    r5 = _h_20;
    WL_JMP(FID_LAND_OK);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2517)
  {
    WL_POPN(4);
    Term _x_23 = STK(0);
    Term _h_21 = STK(1);
    Term _x_24 = STK(2);
    Term _acc_6 = STK(3);
    Term _h_22 = r0;
    WL_OPEN
    u64 _nd_9 = heap_alloc(e, cls_fit(5));
    e.mem[_nd_9 + 0] = _x_23;
    e.mem[_nd_9 + 1] = _h_21;
    e.mem[_nd_9 + 2] = _x_24;
    e.mem[_nd_9 + 3] = _acc_6;
    e.mem[_nd_9 + 4] = _h_22;
    r0 = term_clo(FID_MAIN_C2518, _nd_9);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2518)
  {
    Term _x_25 = r0;
    Term _h_23 = r1;
    Term _x_26 = r2;
    Term _acc_7 = r3;
    Term _h_24 = r4;
    Term _x_27 = r5;
    WL_OPEN
    u64 _nd_10 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_10 + 0] = _x_25;
    e.mem[_nd_10 + 1] = _h_23;
    e.mem[_nd_10 + 2] = _x_26;
    e.mem[_nd_10 + 3] = _acc_7;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_241 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_241 + 0] = _h_24;
      e.mem[_t_241 + 1] = term_clo(FID_MAIN_C2519, _nd_10);
      e.mem[_t_241 + 2] = _x_27;
      return term_tsk(FID_IO_BIND, _t_241);
    }
    r0 = _h_24;
    r1 = term_clo(FID_MAIN_C2519, _nd_10);
    r2 = _x_27;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2519)
  {
    Term _x_28 = r0;
    Term _h_25 = r1;
    Term _x_29 = r2;
    Term _acc_8 = r3;
    Term _x_30 = r4;
    WL_OPEN
    u32 _o_5 = 0;
    u32 _o_6 = 0;
    Term _o_7 = 0;
    Term _o_8 = 0;
    if (term_aux(_x_30) == CID_FAIL) {
      _o_5 = 0;
      Term _fb_1[1];
      u64 _sp_2 = ctr_take(e, _x_30, 1, _fb_1);
      Term _f_4 = _fb_1[0];
      spare_free(e, cls_fit(1), _sp_2);
      u32 _o_9 = 0;
      Term _o_10 = 0;
      Term _o_11 = 0;
      if (term_aux(_f_4) == CID____SRC_GIT_TYPES_FBRANCHEXISTS) {
        _o_9 = 0;
        u64 _sp_3 = term_loc(_f_4);
        Term _f_5 = e.mem[_sp_3 + 0];
        heap_free(e, cls_fit(1), _sp_3);
        _o_10 = _f_5;
      } else if (term_aux(_f_4) == CID____SRC_GIT_TYPES_FPATHEXISTS) {
        _o_9 = 1;
        u64 _sp_4 = term_loc(_f_4);
        Term _f_6 = e.mem[_sp_4 + 0];
        heap_free(e, cls_fit(1), _sp_4);
        _o_10 = _f_6;
      } else if (term_aux(_f_4) == CID____SRC_GIT_TYPES_FUNKNOWNBASE) {
        _o_9 = 2;
        u64 _sp_5 = term_loc(_f_4);
        Term _f_7 = e.mem[_sp_5 + 0];
        heap_free(e, cls_fit(1), _sp_5);
        _o_10 = _f_7;
      } else if (term_aux(_f_4) == CID____SRC_GIT_TYPES_FTARGETBUSY) {
        _o_9 = 3;
        u64 _sp_6 = term_loc(_f_4);
        Term _f_8 = e.mem[_sp_6 + 0];
        heap_free(e, cls_fit(1), _sp_6);
        _o_10 = _f_8;
      } else {
        _o_9 = 4;
        Term _fb_2[2];
        u64 _sp_7 = ctr_take(e, _f_4, 2, _fb_2);
        Term _f_9 = _fb_2[0];
        Term _f_10 = _fb_2[1];
        spare_free(e, cls_fit(2), _sp_7);
        _o_10 = _f_9;
        _o_11 = _f_10;
      }
      _o_6 = _o_9;
      _o_7 = _o_10;
      _o_8 = _o_11;
    } else {
      _o_5 = 1;
      u64 _sp_8 = term_loc(_x_30);
      Term _f_11 = e.mem[_sp_8 + 0];
      heap_free(e, cls_fit(1), _sp_8);
      u32 _o_12 = 0;
      Term _o_13 = 0;
      Term _o_14 = 0;
      if (term_aux(_f_11) == CID____SRC_GIT_TYPES_LLANDED) {
        _o_12 = 0;
        u64 _sp_9 = term_loc(_f_11);
        Term _f_12 = e.mem[_sp_9 + 0];
        Term _f_13 = e.mem[_sp_9 + 1];
        heap_free(e, cls_fit(2), _sp_9);
        _o_13 = _f_12;
        _o_14 = _f_13;
      } else if (term_aux(_f_11) == CID____SRC_GIT_TYPES_LALREADY) {
        _o_12 = 1;
        u64 _sp_10 = term_loc(_f_11);
        Term _f_14 = e.mem[_sp_10 + 0];
        heap_free(e, cls_fit(1), _sp_10);
        _o_13 = _f_14;
      } else if (term_aux(_f_11) == CID____SRC_GIT_TYPES_LCONFLICT) {
        _o_12 = 2;
        u64 _sp_11 = term_loc(_f_11);
        Term _f_15 = e.mem[_sp_11 + 0];
        Term _f_16 = e.mem[_sp_11 + 1];
        heap_free(e, cls_fit(2), _sp_11);
        _o_13 = _f_15;
        _o_14 = _f_16;
      } else {
        _o_12 = 3;
        u64 _sp_12 = term_loc(_f_11);
        Term _f_17 = e.mem[_sp_12 + 0];
        heap_free(e, cls_fit(1), _sp_12);
        _o_13 = _f_17;
      }
      _o_6 = _o_12;
      _o_7 = _o_13;
      _o_8 = _o_14;
    }
    _x_28 = term_keep(e, _x_28);
    if (seq) {
      WL_ROOM(9);
      STK(0) = _x_28;
      STK(1) = _h_25;
      STK(2) = _x_29;
      STK(3) = _acc_8;
      STK(4) = _o_5;
      STK(5) = _o_6;
      STK(6) = _o_7;
      STK(7) = _o_8;
      STK(8) = FID_MAIN_K2520;
      WL_PUSHN(9);
    } else {
      u64 _t_22 = task_node(e, FID_MAIN_K2520, WL_CONT, WL_IDX, 1);
      e.mem[_t_22 + 0] = _x_28;
      e.mem[_t_22 + 1] = _h_25;
      e.mem[_t_22 + 2] = _x_29;
      e.mem[_t_22 + 3] = _acc_8;
      e.mem[_t_22 + 4] = _o_5;
      e.mem[_t_22 + 5] = _o_6;
      e.mem[_t_22 + 6] = _o_7;
      e.mem[_t_22 + 7] = _o_8;
      WL_CONT = term_tsk(FID_MAIN_K2520, _t_22);
      WL_IDX = 8;
    }
    if (!DEVICE && !seq && fid_nofk(FID_HEAD_OF)) {
      u64 _t_23 = task_node(e, FID_HEAD_OF, WL_CONT, WL_IDX, 0);
      e.mem[_t_23 + 0] = _x_28;
      return term_tsk(FID_HEAD_OF, _t_23);
    }
    r0 = _x_28;
    WL_JMP(FID_HEAD_OF);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2520)
  {
    WL_POPN(8);
    Term _x_31 = STK(0);
    Term _h_26 = STK(1);
    Term _x_32 = STK(2);
    Term _acc_9 = STK(3);
    u32 _o_15 = STK(4);
    u32 _o_16 = STK(5);
    Term _o_17 = STK(6);
    Term _o_18 = STK(7);
    Term _h_27 = r0;
    WL_OPEN
    u64 _nd_11 = heap_alloc(e, cls_fit(9));
    e.mem[_nd_11 + 0] = _x_31;
    e.mem[_nd_11 + 1] = _h_26;
    e.mem[_nd_11 + 2] = _x_32;
    e.mem[_nd_11 + 3] = _acc_9;
    e.mem[_nd_11 + 4] = _o_15;
    e.mem[_nd_11 + 5] = _o_16;
    e.mem[_nd_11 + 6] = _o_17;
    e.mem[_nd_11 + 7] = _o_18;
    e.mem[_nd_11 + 8] = _h_27;
    r0 = term_clo(FID_MAIN_C2521, _nd_11);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2521)
  {
    Term _x_33 = r0;
    Term _h_28 = r1;
    Term _x_34 = r2;
    Term _acc_10 = r3;
    u32 _o_19 = r4;
    u32 _o_20 = r5;
    Term _o_21 = r6;
    Term _o_22 = r7;
    Term _h_29 = r8;
    Term _x_35 = r9;
    WL_OPEN
    u64 _nd_12 = heap_alloc(e, cls_fit(8));
    e.mem[_nd_12 + 0] = _x_33;
    e.mem[_nd_12 + 1] = _h_28;
    e.mem[_nd_12 + 2] = _x_34;
    e.mem[_nd_12 + 3] = _acc_10;
    e.mem[_nd_12 + 4] = _o_19;
    e.mem[_nd_12 + 5] = _o_20;
    e.mem[_nd_12 + 6] = _o_21;
    e.mem[_nd_12 + 7] = _o_22;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_240 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_240 + 0] = _h_29;
      e.mem[_t_240 + 1] = term_clo(FID_MAIN_C2522, _nd_12);
      e.mem[_t_240 + 2] = _x_35;
      return term_tsk(FID_IO_BIND, _t_240);
    }
    r0 = _h_29;
    r1 = term_clo(FID_MAIN_C2522, _nd_12);
    r2 = _x_35;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2522)
  {
    Term _x_36 = r0;
    Term _h_30 = r1;
    Term _x_37 = r2;
    Term _acc_11 = r3;
    u32 _o_23 = r4;
    u32 _o_24 = r5;
    Term _o_25 = r6;
    Term _o_26 = r7;
    Term _x_38 = r8;
    WL_OPEN
    _x_36 = term_keep(e, _x_36);
    if (seq) {
      WL_ROOM(10);
      STK(0) = _x_36;
      STK(1) = _h_30;
      STK(2) = _x_37;
      STK(3) = _acc_11;
      STK(4) = _o_23;
      STK(5) = _o_24;
      STK(6) = _o_25;
      STK(7) = _o_26;
      STK(8) = _x_38;
      STK(9) = FID_MAIN_K2523;
      WL_PUSHN(10);
    } else {
      u64 _t_24 = task_node(e, FID_MAIN_K2523, WL_CONT, WL_IDX, 1);
      e.mem[_t_24 + 0] = _x_36;
      e.mem[_t_24 + 1] = _h_30;
      e.mem[_t_24 + 2] = _x_37;
      e.mem[_t_24 + 3] = _acc_11;
      e.mem[_t_24 + 4] = _o_23;
      e.mem[_t_24 + 5] = _o_24;
      e.mem[_t_24 + 6] = _o_25;
      e.mem[_t_24 + 7] = _o_26;
      e.mem[_t_24 + 8] = _x_38;
      WL_CONT = term_tsk(FID_MAIN_K2523, _t_24);
      WL_IDX = 9;
    }
    if (!DEVICE && !seq && fid_nofk(FID_BLOB_OF)) {
      u64 _t_25 = task_node(e, FID_BLOB_OF, WL_CONT, WL_IDX, 0);
      e.mem[_t_25 + 0] = _x_36;
      e.mem[_t_25 + 1] = term_ctr(CID_SCON, STAT_OFF + 705);
      return term_tsk(FID_BLOB_OF, _t_25);
    }
    r0 = _x_36;
    r1 = term_ctr(CID_SCON, STAT_OFF + 705);
    WL_JMP(FID_BLOB_OF);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2523)
  {
    WL_POPN(9);
    Term _x_39 = STK(0);
    Term _h_31 = STK(1);
    Term _x_40 = STK(2);
    Term _acc_12 = STK(3);
    u32 _o_27 = STK(4);
    u32 _o_28 = STK(5);
    Term _o_29 = STK(6);
    Term _o_30 = STK(7);
    Term _x_41 = STK(8);
    Term _h_32 = r0;
    WL_OPEN
    u64 _nd_13 = heap_alloc(e, cls_fit(10));
    e.mem[_nd_13 + 0] = _x_39;
    e.mem[_nd_13 + 1] = _h_31;
    e.mem[_nd_13 + 2] = _x_40;
    e.mem[_nd_13 + 3] = _acc_12;
    e.mem[_nd_13 + 4] = _o_27;
    e.mem[_nd_13 + 5] = _o_28;
    e.mem[_nd_13 + 6] = _o_29;
    e.mem[_nd_13 + 7] = _o_30;
    e.mem[_nd_13 + 8] = _x_41;
    e.mem[_nd_13 + 9] = _h_32;
    r0 = term_clo(FID_MAIN_C2524, _nd_13);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2524)
  {
    Term _x_42 = r0;
    Term _h_33 = r1;
    Term _x_43 = r2;
    Term _acc_13 = r3;
    u32 _o_31 = r4;
    u32 _o_32 = r5;
    Term _o_33 = r6;
    Term _o_34 = r7;
    Term _x_44 = r8;
    Term _h_34 = r9;
    Term _x_45 = r10;
    WL_OPEN
    u64 _nd_14 = heap_alloc(e, cls_fit(9));
    e.mem[_nd_14 + 0] = _x_42;
    e.mem[_nd_14 + 1] = _h_33;
    e.mem[_nd_14 + 2] = _x_43;
    e.mem[_nd_14 + 3] = _acc_13;
    e.mem[_nd_14 + 4] = _o_31;
    e.mem[_nd_14 + 5] = _o_32;
    e.mem[_nd_14 + 6] = _o_33;
    e.mem[_nd_14 + 7] = _o_34;
    e.mem[_nd_14 + 8] = _x_44;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_239 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_239 + 0] = _h_34;
      e.mem[_t_239 + 1] = term_clo(FID_MAIN_C2525, _nd_14);
      e.mem[_t_239 + 2] = _x_45;
      return term_tsk(FID_IO_BIND, _t_239);
    }
    r0 = _h_34;
    r1 = term_clo(FID_MAIN_C2525, _nd_14);
    r2 = _x_45;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2525)
  {
    Term _x_46 = r0;
    Term _h_35 = r1;
    Term _x_47 = r2;
    Term _acc_14 = r3;
    u32 _o_35 = r4;
    u32 _o_36 = r5;
    Term _o_37 = r6;
    Term _o_38 = r7;
    Term _x_48 = r8;
    Term _x_49 = r9;
    WL_OPEN
    _x_48 = term_keep(e, _x_48);
    if (seq) {
      WL_ROOM(7);
      STK(0) = _x_49;
      STK(1) = _x_46;
      STK(2) = _h_35;
      STK(3) = _x_48;
      STK(4) = _x_47;
      STK(5) = _acc_14;
      STK(6) = FID_MAIN_K2526;
      WL_PUSHN(7);
    } else {
      u64 _t_26 = task_node(e, FID_MAIN_K2526, WL_CONT, WL_IDX, 1);
      e.mem[_t_26 + 0] = _x_49;
      e.mem[_t_26 + 1] = _x_46;
      e.mem[_t_26 + 2] = _h_35;
      e.mem[_t_26 + 3] = _x_48;
      e.mem[_t_26 + 4] = _x_47;
      e.mem[_t_26 + 5] = _acc_14;
      WL_CONT = term_tsk(FID_MAIN_K2526, _t_26);
      WL_IDX = 6;
    }
    if (!DEVICE && !seq && fid_nofk(FID_IS_LANDED)) {
      u64 _t_27 = task_node(e, FID_IS_LANDED, WL_CONT, WL_IDX, 0);
      e.mem[_t_27 + 0] = _o_35;
      e.mem[_t_27 + 1] = _o_36;
      e.mem[_t_27 + 2] = _o_37;
      e.mem[_t_27 + 3] = _o_38;
      e.mem[_t_27 + 4] = _x_48;
      return term_tsk(FID_IS_LANDED, _t_27);
    }
    r0 = _o_35;
    r1 = _o_36;
    r2 = _o_37;
    r3 = _o_38;
    r4 = _x_48;
    WL_JMP(FID_IS_LANDED);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2526)
  {
    WL_POPN(6);
    Term _x_50 = STK(0);
    Term _x_51 = STK(1);
    Term _h_36 = STK(2);
    Term _x_52 = STK(3);
    Term _x_53 = STK(4);
    Term _acc_15 = STK(5);
    Term _f1_0 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(8);
      STK(0) = _x_50;
      STK(1) = _x_51;
      STK(2) = _h_36;
      STK(3) = _x_52;
      STK(4) = _x_53;
      STK(5) = _acc_15;
      STK(6) = _f1_0;
      STK(7) = FID_MAIN_K2527;
      WL_PUSHN(8);
    } else {
      u64 _t_28 = task_node(e, FID_MAIN_K2527, WL_CONT, WL_IDX, 1);
      e.mem[_t_28 + 0] = _x_50;
      e.mem[_t_28 + 1] = _x_51;
      e.mem[_t_28 + 2] = _h_36;
      e.mem[_t_28 + 3] = _x_52;
      e.mem[_t_28 + 4] = _x_53;
      e.mem[_t_28 + 5] = _acc_15;
      e.mem[_t_28 + 6] = _f1_0;
      WL_CONT = term_tsk(FID_MAIN_K2527, _t_28);
      WL_IDX = 7;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_EQ)) {
      u64 _t_29 = task_node(e, FID____SRC_GIT_TEXT_STR_EQ, WL_CONT, WL_IDX, 0);
      e.mem[_t_29 + 0] = _x_50;
      e.mem[_t_29 + 1] = term_ctr(CID_SCON, STAT_OFF + 3273);
      return term_tsk(FID____SRC_GIT_TEXT_STR_EQ, _t_29);
    }
    r0 = _x_50;
    r1 = term_ctr(CID_SCON, STAT_OFF + 3273);
    WL_JMP(FID____SRC_GIT_TEXT_STR_EQ);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2527)
  {
    WL_POPN(7);
    Term _x_54 = STK(0);
    Term _x_55 = STK(1);
    Term _h_37 = STK(2);
    Term _x_56 = STK(3);
    Term _x_57 = STK(4);
    Term _acc_16 = STK(5);
    Term _f1_1 = STK(6);
    u32 _h_38 = r0;
    WL_OPEN
    term_sink(e, _x_54);
    Term _v_3 = 0;
    Term _v_4 = 0;
    Term _o_39[1];
    if (spin_45(e, _o_39, _h_38, term_ctr(CID_SCON, STAT_OFF + 3297)) == 0) {
      return 0;
    }
    _v_4 = _o_39[0];
    _v_3 = _v_4;
    if (seq) {
      WL_ROOM(6);
      STK(0) = _x_55;
      STK(1) = _h_37;
      STK(2) = _x_56;
      STK(3) = _x_57;
      STK(4) = _acc_16;
      STK(5) = FID_MAIN_K2528;
      WL_PUSHN(6);
    } else {
      u64 _t_30 = task_node(e, FID_MAIN_K2528, WL_CONT, WL_IDX, 1);
      e.mem[_t_30 + 0] = _x_55;
      e.mem[_t_30 + 1] = _h_37;
      e.mem[_t_30 + 2] = _x_56;
      e.mem[_t_30 + 3] = _x_57;
      e.mem[_t_30 + 4] = _acc_16;
      WL_CONT = term_tsk(FID_MAIN_K2528, _t_30);
      WL_IDX = 5;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_31 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_31 + 0] = _f1_1;
      e.mem[_t_31 + 1] = _v_3;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_31);
    }
    r0 = _f1_1;
    r1 = _v_3;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2528)
  {
    WL_POPN(5);
    Term _x_58 = STK(0);
    Term _h_39 = STK(1);
    Term _x_59 = STK(2);
    Term _x_60 = STK(3);
    Term _acc_17 = STK(4);
    Term _h_40 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(5);
      STK(0) = _x_58;
      STK(1) = _h_39;
      STK(2) = _x_59;
      STK(3) = _x_60;
      STK(4) = FID_MAIN_K2529;
      WL_PUSHN(5);
    } else {
      u64 _t_32 = task_node(e, FID_MAIN_K2529, WL_CONT, WL_IDX, 1);
      e.mem[_t_32 + 0] = _x_58;
      e.mem[_t_32 + 1] = _h_39;
      e.mem[_t_32 + 2] = _x_59;
      e.mem[_t_32 + 3] = _x_60;
      WL_CONT = term_tsk(FID_MAIN_K2529, _t_32);
      WL_IDX = 4;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_33 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_33 + 0] = _acc_17;
      e.mem[_t_33 + 1] = _h_40;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_33);
    }
    r0 = _acc_17;
    r1 = _h_40;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2529)
  {
    WL_POPN(4);
    Term _x_61 = STK(0);
    Term _h_41 = STK(1);
    Term _x_62 = STK(2);
    Term _x_63 = STK(3);
    Term _h_42 = r0;
    WL_OPEN
    _x_61 = term_keep(e, _x_61);
    if (seq) {
      WL_ROOM(6);
      STK(0) = _x_61;
      STK(1) = _h_41;
      STK(2) = _x_63;
      STK(3) = _x_62;
      STK(4) = _h_42;
      STK(5) = FID_MAIN_K2530;
      WL_PUSHN(6);
    } else {
      u64 _t_34 = task_node(e, FID_MAIN_K2530, WL_CONT, WL_IDX, 1);
      e.mem[_t_34 + 0] = _x_61;
      e.mem[_t_34 + 1] = _h_41;
      e.mem[_t_34 + 2] = _x_63;
      e.mem[_t_34 + 3] = _x_62;
      e.mem[_t_34 + 4] = _h_42;
      WL_CONT = term_tsk(FID_MAIN_K2530, _t_34);
      WL_IDX = 5;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_35 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_35 + 0] = _x_61;
      e.mem[_t_35 + 1] = term_ctr(CID_SCON, STAT_OFF + 3074);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_35);
    }
    r0 = _x_61;
    r1 = term_ctr(CID_SCON, STAT_OFF + 3074);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2530)
  {
    WL_POPN(5);
    Term _x_64 = STK(0);
    Term _h_43 = STK(1);
    Term _x_65 = STK(2);
    Term _x_66 = STK(3);
    Term _h_44 = STK(4);
    Term _h_45 = r0;
    WL_OPEN
    _x_64 = term_keep(e, _x_64);
    _x_65 = term_keep(e, _x_65);
    if (seq) {
      WL_ROOM(6);
      STK(0) = _x_64;
      STK(1) = _h_43;
      STK(2) = _x_65;
      STK(3) = _x_66;
      STK(4) = _h_44;
      STK(5) = FID_MAIN_K2531;
      WL_PUSHN(6);
    } else {
      u64 _t_36 = task_node(e, FID_MAIN_K2531, WL_CONT, WL_IDX, 1);
      e.mem[_t_36 + 0] = _x_64;
      e.mem[_t_36 + 1] = _h_43;
      e.mem[_t_36 + 2] = _x_65;
      e.mem[_t_36 + 3] = _x_66;
      e.mem[_t_36 + 4] = _h_44;
      WL_CONT = term_tsk(FID_MAIN_K2531, _t_36);
      WL_IDX = 5;
    }
    if (!DEVICE && !seq && fid_nofk(FID_LAND_OK)) {
      u64 _t_37 = task_node(e, FID_LAND_OK, WL_CONT, WL_IDX, 0);
      e.mem[_t_37 + 0] = _x_64;
      e.mem[_t_37 + 1] = term_ctr(CID_SCON, STAT_OFF + 663);
      e.mem[_t_37 + 2] = _x_65;
      e.mem[_t_37 + 3] = term_ctr(CID_CON, STAT_OFF + 707);
      e.mem[_t_37 + 4] = term_ctr(CID_SCON, STAT_OFF + 729);
      e.mem[_t_37 + 5] = _h_45;
      return term_tsk(FID_LAND_OK, _t_37);
    }
    r0 = _x_64;
    r1 = term_ctr(CID_SCON, STAT_OFF + 663);
    r2 = _x_65;
    r3 = term_ctr(CID_CON, STAT_OFF + 707);
    r4 = term_ctr(CID_SCON, STAT_OFF + 729);
    r5 = _h_45;
    WL_JMP(FID_LAND_OK);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2531)
  {
    WL_POPN(5);
    Term _x_67 = STK(0);
    Term _h_46 = STK(1);
    Term _x_68 = STK(2);
    Term _x_69 = STK(3);
    Term _h_47 = STK(4);
    Term _h_48 = r0;
    WL_OPEN
    u64 _nd_15 = heap_alloc(e, cls_fit(6));
    e.mem[_nd_15 + 0] = _x_67;
    e.mem[_nd_15 + 1] = _h_46;
    e.mem[_nd_15 + 2] = _x_68;
    e.mem[_nd_15 + 3] = _x_69;
    e.mem[_nd_15 + 4] = _h_47;
    e.mem[_nd_15 + 5] = _h_48;
    r0 = term_clo(FID_MAIN_C2532, _nd_15);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2532)
  {
    Term _x_70 = r0;
    Term _h_49 = r1;
    Term _x_71 = r2;
    Term _x_72 = r3;
    Term _h_50 = r4;
    Term _h_51 = r5;
    Term _x_73 = r6;
    WL_OPEN
    u64 _nd_16 = heap_alloc(e, cls_fit(5));
    e.mem[_nd_16 + 0] = _x_70;
    e.mem[_nd_16 + 1] = _h_49;
    e.mem[_nd_16 + 2] = _x_71;
    e.mem[_nd_16 + 3] = _x_72;
    e.mem[_nd_16 + 4] = _h_50;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_238 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_238 + 0] = _h_51;
      e.mem[_t_238 + 1] = term_clo(FID_MAIN_C2533, _nd_16);
      e.mem[_t_238 + 2] = _x_73;
      return term_tsk(FID_IO_BIND, _t_238);
    }
    r0 = _h_51;
    r1 = term_clo(FID_MAIN_C2533, _nd_16);
    r2 = _x_73;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2533)
  {
    Term _x_74 = r0;
    Term _h_52 = r1;
    Term _x_75 = r2;
    Term _x_76 = r3;
    Term _h_53 = r4;
    Term _x_77 = r5;
    WL_OPEN
    u32 _o_40 = 0;
    u32 _o_41 = 0;
    Term _o_42 = 0;
    Term _o_43 = 0;
    if (term_aux(_x_77) == CID_FAIL) {
      _o_40 = 0;
      Term _fb_3[1];
      u64 _sp_13 = ctr_take(e, _x_77, 1, _fb_3);
      Term _f_18 = _fb_3[0];
      spare_free(e, cls_fit(1), _sp_13);
      u32 _o_44 = 0;
      Term _o_45 = 0;
      Term _o_46 = 0;
      if (term_aux(_f_18) == CID____SRC_GIT_TYPES_FBRANCHEXISTS) {
        _o_44 = 0;
        u64 _sp_14 = term_loc(_f_18);
        Term _f_19 = e.mem[_sp_14 + 0];
        heap_free(e, cls_fit(1), _sp_14);
        _o_45 = _f_19;
      } else if (term_aux(_f_18) == CID____SRC_GIT_TYPES_FPATHEXISTS) {
        _o_44 = 1;
        u64 _sp_15 = term_loc(_f_18);
        Term _f_20 = e.mem[_sp_15 + 0];
        heap_free(e, cls_fit(1), _sp_15);
        _o_45 = _f_20;
      } else if (term_aux(_f_18) == CID____SRC_GIT_TYPES_FUNKNOWNBASE) {
        _o_44 = 2;
        u64 _sp_16 = term_loc(_f_18);
        Term _f_21 = e.mem[_sp_16 + 0];
        heap_free(e, cls_fit(1), _sp_16);
        _o_45 = _f_21;
      } else if (term_aux(_f_18) == CID____SRC_GIT_TYPES_FTARGETBUSY) {
        _o_44 = 3;
        u64 _sp_17 = term_loc(_f_18);
        Term _f_22 = e.mem[_sp_17 + 0];
        heap_free(e, cls_fit(1), _sp_17);
        _o_45 = _f_22;
      } else {
        _o_44 = 4;
        Term _fb_4[2];
        u64 _sp_18 = ctr_take(e, _f_18, 2, _fb_4);
        Term _f_23 = _fb_4[0];
        Term _f_24 = _fb_4[1];
        spare_free(e, cls_fit(2), _sp_18);
        _o_45 = _f_23;
        _o_46 = _f_24;
      }
      _o_41 = _o_44;
      _o_42 = _o_45;
      _o_43 = _o_46;
    } else {
      _o_40 = 1;
      u64 _sp_19 = term_loc(_x_77);
      Term _f_25 = e.mem[_sp_19 + 0];
      heap_free(e, cls_fit(1), _sp_19);
      u32 _o_47 = 0;
      Term _o_48 = 0;
      Term _o_49 = 0;
      if (term_aux(_f_25) == CID____SRC_GIT_TYPES_LLANDED) {
        _o_47 = 0;
        u64 _sp_20 = term_loc(_f_25);
        Term _f_26 = e.mem[_sp_20 + 0];
        Term _f_27 = e.mem[_sp_20 + 1];
        heap_free(e, cls_fit(2), _sp_20);
        _o_48 = _f_26;
        _o_49 = _f_27;
      } else if (term_aux(_f_25) == CID____SRC_GIT_TYPES_LALREADY) {
        _o_47 = 1;
        u64 _sp_21 = term_loc(_f_25);
        Term _f_28 = e.mem[_sp_21 + 0];
        heap_free(e, cls_fit(1), _sp_21);
        _o_48 = _f_28;
      } else if (term_aux(_f_25) == CID____SRC_GIT_TYPES_LCONFLICT) {
        _o_47 = 2;
        u64 _sp_22 = term_loc(_f_25);
        Term _f_29 = e.mem[_sp_22 + 0];
        Term _f_30 = e.mem[_sp_22 + 1];
        heap_free(e, cls_fit(2), _sp_22);
        _o_48 = _f_29;
        _o_49 = _f_30;
      } else {
        _o_47 = 3;
        u64 _sp_23 = term_loc(_f_25);
        Term _f_31 = e.mem[_sp_23 + 0];
        heap_free(e, cls_fit(1), _sp_23);
        _o_48 = _f_31;
      }
      _o_41 = _o_47;
      _o_42 = _o_48;
      _o_43 = _o_49;
    }
    if (seq) {
      WL_ROOM(6);
      STK(0) = _x_74;
      STK(1) = _h_52;
      STK(2) = _x_75;
      STK(3) = _x_76;
      STK(4) = _h_53;
      STK(5) = FID_MAIN_K2534;
      WL_PUSHN(6);
    } else {
      u64 _t_38 = task_node(e, FID_MAIN_K2534, WL_CONT, WL_IDX, 1);
      e.mem[_t_38 + 0] = _x_74;
      e.mem[_t_38 + 1] = _h_52;
      e.mem[_t_38 + 2] = _x_75;
      e.mem[_t_38 + 3] = _x_76;
      e.mem[_t_38 + 4] = _h_53;
      WL_CONT = term_tsk(FID_MAIN_K2534, _t_38);
      WL_IDX = 5;
    }
    if (!DEVICE && !seq && fid_nofk(FID_IS_ALREADY)) {
      u64 _t_39 = task_node(e, FID_IS_ALREADY, WL_CONT, WL_IDX, 0);
      e.mem[_t_39 + 0] = _o_40;
      e.mem[_t_39 + 1] = _o_41;
      e.mem[_t_39 + 2] = _o_42;
      e.mem[_t_39 + 3] = _o_43;
      return term_tsk(FID_IS_ALREADY, _t_39);
    }
    r0 = _o_40;
    r1 = _o_41;
    r2 = _o_42;
    r3 = _o_43;
    WL_JMP(FID_IS_ALREADY);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2534)
  {
    WL_POPN(5);
    Term _x_78 = STK(0);
    Term _h_54 = STK(1);
    Term _x_79 = STK(2);
    Term _x_80 = STK(3);
    Term _h_55 = STK(4);
    Term _h_56 = r0;
    WL_OPEN
    u64 _nd_17 = heap_alloc(e, cls_fit(6));
    e.mem[_nd_17 + 0] = _x_78;
    e.mem[_nd_17 + 1] = _h_54;
    e.mem[_nd_17 + 2] = _x_79;
    e.mem[_nd_17 + 3] = _x_80;
    e.mem[_nd_17 + 4] = _h_55;
    e.mem[_nd_17 + 5] = _h_56;
    r0 = term_clo(FID_MAIN_C2535, _nd_17);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2535)
  {
    Term _x_81 = r0;
    Term _h_57 = r1;
    Term _x_82 = r2;
    Term _x_83 = r3;
    Term _h_58 = r4;
    Term _h_59 = r5;
    Term _x_84 = r6;
    WL_OPEN
    u64 _nd_18 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_18 + 0] = _h_59;
    u64 _nd_19 = heap_alloc(e, cls_fit(5));
    e.mem[_nd_19 + 0] = _x_81;
    e.mem[_nd_19 + 1] = _h_57;
    e.mem[_nd_19 + 2] = _x_82;
    e.mem[_nd_19 + 3] = _x_83;
    e.mem[_nd_19 + 4] = _h_58;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_237 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_237 + 0] = term_clo(FID_MAIN_C2536, _nd_18);
      e.mem[_t_237 + 1] = term_clo(FID_MAIN_C2537, _nd_19);
      e.mem[_t_237 + 2] = _x_84;
      return term_tsk(FID_IO_BIND, _t_237);
    }
    r0 = term_clo(FID_MAIN_C2536, _nd_18);
    r1 = term_clo(FID_MAIN_C2537, _nd_19);
    r2 = _x_84;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2536)
  {
    Term _h_60 = r0;
    Term _x_85 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_40 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_40 + 0] = _h_60;
      e.mem[_t_40 + 1] = _x_85;
      return term_tsk(FID_IO_PURE, _t_40);
    }
    r0 = _h_60;
    r1 = _x_85;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2537)
  {
    Term _x_86 = r0;
    Term _h_61 = r1;
    Term _x_87 = r2;
    Term _x_88 = r3;
    Term _h_62 = r4;
    Term _x_89 = r5;
    WL_OPEN
    if (seq) {
      WL_ROOM(5);
      STK(0) = _x_86;
      STK(1) = _h_61;
      STK(2) = _x_87;
      STK(3) = _x_88;
      STK(4) = FID_MAIN_K2538;
      WL_PUSHN(5);
    } else {
      u64 _t_41 = task_node(e, FID_MAIN_K2538, WL_CONT, WL_IDX, 1);
      e.mem[_t_41 + 0] = _x_86;
      e.mem[_t_41 + 1] = _h_61;
      e.mem[_t_41 + 2] = _x_87;
      e.mem[_t_41 + 3] = _x_88;
      WL_CONT = term_tsk(FID_MAIN_K2538, _t_41);
      WL_IDX = 4;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_42 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_42 + 0] = _h_62;
      e.mem[_t_42 + 1] = _x_89;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_42);
    }
    r0 = _h_62;
    r1 = _x_89;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2538)
  {
    WL_POPN(4);
    Term _x_90 = STK(0);
    Term _h_63 = STK(1);
    Term _x_91 = STK(2);
    Term _x_92 = STK(3);
    Term _h_64 = r0;
    WL_OPEN
    term_sink(e, _x_91);
    _x_90 = term_keep(e, _x_90);
    if (seq) {
      WL_ROOM(5);
      STK(0) = _x_90;
      STK(1) = _h_63;
      STK(2) = _x_92;
      STK(3) = _h_64;
      STK(4) = FID_MAIN_K2539;
      WL_PUSHN(5);
    } else {
      u64 _t_43 = task_node(e, FID_MAIN_K2539, WL_CONT, WL_IDX, 1);
      e.mem[_t_43 + 0] = _x_90;
      e.mem[_t_43 + 1] = _h_63;
      e.mem[_t_43 + 2] = _x_92;
      e.mem[_t_43 + 3] = _h_64;
      WL_CONT = term_tsk(FID_MAIN_K2539, _t_43);
      WL_IDX = 4;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_44 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_44 + 0] = _x_90;
      e.mem[_t_44 + 1] = term_ctr(CID_SCON, STAT_OFF + 2707);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_44);
    }
    r0 = _x_90;
    r1 = term_ctr(CID_SCON, STAT_OFF + 2707);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2539)
  {
    WL_POPN(4);
    Term _x_93 = STK(0);
    Term _h_65 = STK(1);
    Term _x_94 = STK(2);
    Term _h_66 = STK(3);
    Term _h_67 = r0;
    WL_OPEN
    _x_93 = term_keep(e, _x_93);
    _h_65 = term_keep(e, _h_65);
    if (seq) {
      WL_ROOM(5);
      STK(0) = _x_93;
      STK(1) = _h_65;
      STK(2) = _x_94;
      STK(3) = _h_66;
      STK(4) = FID_MAIN_K2540;
      WL_PUSHN(5);
    } else {
      u64 _t_45 = task_node(e, FID_MAIN_K2540, WL_CONT, WL_IDX, 1);
      e.mem[_t_45 + 0] = _x_93;
      e.mem[_t_45 + 1] = _h_65;
      e.mem[_t_45 + 2] = _x_94;
      e.mem[_t_45 + 3] = _h_66;
      WL_CONT = term_tsk(FID_MAIN_K2540, _t_45);
      WL_IDX = 4;
    }
    if (!DEVICE && !seq && fid_nofk(FID_AUTHOR)) {
      u64 _t_46 = task_node(e, FID_AUTHOR, WL_CONT, WL_IDX, 0);
      e.mem[_t_46 + 0] = _x_93;
      e.mem[_t_46 + 1] = _h_67;
      e.mem[_t_46 + 2] = term_ctr(CID_SCON, STAT_OFF + 2719);
      e.mem[_t_46 + 3] = _h_65;
      e.mem[_t_46 + 4] = term_ctr(CID_SCON, STAT_OFF + 2326);
      return term_tsk(FID_AUTHOR, _t_46);
    }
    r0 = _x_93;
    r1 = _h_67;
    r2 = term_ctr(CID_SCON, STAT_OFF + 2719);
    r3 = _h_65;
    r4 = term_ctr(CID_SCON, STAT_OFF + 2326);
    WL_JMP(FID_AUTHOR);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2540)
  {
    WL_POPN(4);
    Term _x_95 = STK(0);
    Term _h_68 = STK(1);
    Term _x_96 = STK(2);
    Term _h_69 = STK(3);
    Term _h_70 = r0;
    WL_OPEN
    u64 _nd_20 = heap_alloc(e, cls_fit(5));
    e.mem[_nd_20 + 0] = _x_95;
    e.mem[_nd_20 + 1] = _h_68;
    e.mem[_nd_20 + 2] = _x_96;
    e.mem[_nd_20 + 3] = _h_69;
    e.mem[_nd_20 + 4] = _h_70;
    r0 = term_clo(FID_MAIN_C2541, _nd_20);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2541)
  {
    Term _x_97 = r0;
    Term _h_71 = r1;
    Term _x_98 = r2;
    Term _h_72 = r3;
    Term _h_73 = r4;
    Term _x_99 = r5;
    WL_OPEN
    u64 _nd_21 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_21 + 0] = _x_97;
    e.mem[_nd_21 + 1] = _h_71;
    e.mem[_nd_21 + 2] = _x_98;
    e.mem[_nd_21 + 3] = _h_72;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_236 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_236 + 0] = _h_73;
      e.mem[_t_236 + 1] = term_clo(FID_MAIN_C2542, _nd_21);
      e.mem[_t_236 + 2] = _x_99;
      return term_tsk(FID_IO_BIND, _t_236);
    }
    r0 = _h_73;
    r1 = term_clo(FID_MAIN_C2542, _nd_21);
    r2 = _x_99;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2542)
  {
    Term _x_100 = r0;
    Term _h_74 = r1;
    Term _x_101 = r2;
    Term _h_75 = r3;
    Term _x_102 = r4;
    WL_OPEN
    _x_100 = term_keep(e, _x_100);
    if (seq) {
      WL_ROOM(6);
      STK(0) = _x_100;
      STK(1) = _h_74;
      STK(2) = _x_101;
      STK(3) = _h_75;
      STK(4) = _x_102;
      STK(5) = FID_MAIN_K2543;
      WL_PUSHN(6);
    } else {
      u64 _t_47 = task_node(e, FID_MAIN_K2543, WL_CONT, WL_IDX, 1);
      e.mem[_t_47 + 0] = _x_100;
      e.mem[_t_47 + 1] = _h_74;
      e.mem[_t_47 + 2] = _x_101;
      e.mem[_t_47 + 3] = _h_75;
      e.mem[_t_47 + 4] = _x_102;
      WL_CONT = term_tsk(FID_MAIN_K2543, _t_47);
      WL_IDX = 5;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_48 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_48 + 0] = _x_100;
      e.mem[_t_48 + 1] = term_ctr(CID_SCON, STAT_OFF + 2747);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_48);
    }
    r0 = _x_100;
    r1 = term_ctr(CID_SCON, STAT_OFF + 2747);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2543)
  {
    WL_POPN(5);
    Term _x_103 = STK(0);
    Term _h_76 = STK(1);
    Term _x_104 = STK(2);
    Term _h_77 = STK(3);
    Term _x_105 = STK(4);
    Term _h_78 = r0;
    WL_OPEN
    _x_103 = term_keep(e, _x_103);
    if (seq) {
      WL_ROOM(5);
      STK(0) = _x_103;
      STK(1) = _h_76;
      STK(2) = _x_104;
      STK(3) = _h_77;
      STK(4) = FID_MAIN_K2544;
      WL_PUSHN(5);
    } else {
      u64 _t_49 = task_node(e, FID_MAIN_K2544, WL_CONT, WL_IDX, 1);
      e.mem[_t_49 + 0] = _x_103;
      e.mem[_t_49 + 1] = _h_76;
      e.mem[_t_49 + 2] = _x_104;
      e.mem[_t_49 + 3] = _h_77;
      WL_CONT = term_tsk(FID_MAIN_K2544, _t_49);
      WL_IDX = 4;
    }
    if (!DEVICE && !seq && fid_nofk(FID_LAND_OK)) {
      u64 _t_50 = task_node(e, FID_LAND_OK, WL_CONT, WL_IDX, 0);
      e.mem[_t_50 + 0] = _x_103;
      e.mem[_t_50 + 1] = term_ctr(CID_SCON, STAT_OFF + 663);
      e.mem[_t_50 + 2] = _x_105;
      e.mem[_t_50 + 3] = term_ctr(CID_CON, STAT_OFF + 1335);
      e.mem[_t_50 + 4] = term_ctr(CID_SCON, STAT_OFF + 2773);
      e.mem[_t_50 + 5] = _h_78;
      return term_tsk(FID_LAND_OK, _t_50);
    }
    r0 = _x_103;
    r1 = term_ctr(CID_SCON, STAT_OFF + 663);
    r2 = _x_105;
    r3 = term_ctr(CID_CON, STAT_OFF + 1335);
    r4 = term_ctr(CID_SCON, STAT_OFF + 2773);
    r5 = _h_78;
    WL_JMP(FID_LAND_OK);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2544)
  {
    WL_POPN(4);
    Term _x_106 = STK(0);
    Term _h_79 = STK(1);
    Term _x_107 = STK(2);
    Term _h_80 = STK(3);
    Term _h_81 = r0;
    WL_OPEN
    u64 _nd_22 = heap_alloc(e, cls_fit(5));
    e.mem[_nd_22 + 0] = _x_106;
    e.mem[_nd_22 + 1] = _h_79;
    e.mem[_nd_22 + 2] = _x_107;
    e.mem[_nd_22 + 3] = _h_80;
    e.mem[_nd_22 + 4] = _h_81;
    r0 = term_clo(FID_MAIN_C2545, _nd_22);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2545)
  {
    Term _x_108 = r0;
    Term _h_82 = r1;
    Term _x_109 = r2;
    Term _h_83 = r3;
    Term _h_84 = r4;
    Term _x_110 = r5;
    WL_OPEN
    u64 _nd_23 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_23 + 0] = _x_108;
    e.mem[_nd_23 + 1] = _h_82;
    e.mem[_nd_23 + 2] = _x_109;
    e.mem[_nd_23 + 3] = _h_83;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_235 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_235 + 0] = _h_84;
      e.mem[_t_235 + 1] = term_clo(FID_MAIN_C2546, _nd_23);
      e.mem[_t_235 + 2] = _x_110;
      return term_tsk(FID_IO_BIND, _t_235);
    }
    r0 = _h_84;
    r1 = term_clo(FID_MAIN_C2546, _nd_23);
    r2 = _x_110;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2546)
  {
    Term _x_111 = r0;
    Term _h_85 = r1;
    Term _x_112 = r2;
    Term _h_86 = r3;
    Term _x_113 = r4;
    WL_OPEN
    u32 _o_50 = 0;
    u32 _o_51 = 0;
    Term _o_52 = 0;
    Term _o_53 = 0;
    if (term_aux(_x_113) == CID_FAIL) {
      _o_50 = 0;
      Term _fb_5[1];
      u64 _sp_24 = ctr_take(e, _x_113, 1, _fb_5);
      Term _f_32 = _fb_5[0];
      spare_free(e, cls_fit(1), _sp_24);
      u32 _o_54 = 0;
      Term _o_55 = 0;
      Term _o_56 = 0;
      if (term_aux(_f_32) == CID____SRC_GIT_TYPES_FBRANCHEXISTS) {
        _o_54 = 0;
        u64 _sp_25 = term_loc(_f_32);
        Term _f_33 = e.mem[_sp_25 + 0];
        heap_free(e, cls_fit(1), _sp_25);
        _o_55 = _f_33;
      } else if (term_aux(_f_32) == CID____SRC_GIT_TYPES_FPATHEXISTS) {
        _o_54 = 1;
        u64 _sp_26 = term_loc(_f_32);
        Term _f_34 = e.mem[_sp_26 + 0];
        heap_free(e, cls_fit(1), _sp_26);
        _o_55 = _f_34;
      } else if (term_aux(_f_32) == CID____SRC_GIT_TYPES_FUNKNOWNBASE) {
        _o_54 = 2;
        u64 _sp_27 = term_loc(_f_32);
        Term _f_35 = e.mem[_sp_27 + 0];
        heap_free(e, cls_fit(1), _sp_27);
        _o_55 = _f_35;
      } else if (term_aux(_f_32) == CID____SRC_GIT_TYPES_FTARGETBUSY) {
        _o_54 = 3;
        u64 _sp_28 = term_loc(_f_32);
        Term _f_36 = e.mem[_sp_28 + 0];
        heap_free(e, cls_fit(1), _sp_28);
        _o_55 = _f_36;
      } else {
        _o_54 = 4;
        Term _fb_6[2];
        u64 _sp_29 = ctr_take(e, _f_32, 2, _fb_6);
        Term _f_37 = _fb_6[0];
        Term _f_38 = _fb_6[1];
        spare_free(e, cls_fit(2), _sp_29);
        _o_55 = _f_37;
        _o_56 = _f_38;
      }
      _o_51 = _o_54;
      _o_52 = _o_55;
      _o_53 = _o_56;
    } else {
      _o_50 = 1;
      u64 _sp_30 = term_loc(_x_113);
      Term _f_39 = e.mem[_sp_30 + 0];
      heap_free(e, cls_fit(1), _sp_30);
      u32 _o_57 = 0;
      Term _o_58 = 0;
      Term _o_59 = 0;
      if (term_aux(_f_39) == CID____SRC_GIT_TYPES_LLANDED) {
        _o_57 = 0;
        u64 _sp_31 = term_loc(_f_39);
        Term _f_40 = e.mem[_sp_31 + 0];
        Term _f_41 = e.mem[_sp_31 + 1];
        heap_free(e, cls_fit(2), _sp_31);
        _o_58 = _f_40;
        _o_59 = _f_41;
      } else if (term_aux(_f_39) == CID____SRC_GIT_TYPES_LALREADY) {
        _o_57 = 1;
        u64 _sp_32 = term_loc(_f_39);
        Term _f_42 = e.mem[_sp_32 + 0];
        heap_free(e, cls_fit(1), _sp_32);
        _o_58 = _f_42;
      } else if (term_aux(_f_39) == CID____SRC_GIT_TYPES_LCONFLICT) {
        _o_57 = 2;
        u64 _sp_33 = term_loc(_f_39);
        Term _f_43 = e.mem[_sp_33 + 0];
        Term _f_44 = e.mem[_sp_33 + 1];
        heap_free(e, cls_fit(2), _sp_33);
        _o_58 = _f_43;
        _o_59 = _f_44;
      } else {
        _o_57 = 3;
        u64 _sp_34 = term_loc(_f_39);
        Term _f_45 = e.mem[_sp_34 + 0];
        heap_free(e, cls_fit(1), _sp_34);
        _o_58 = _f_45;
      }
      _o_51 = _o_57;
      _o_52 = _o_58;
      _o_53 = _o_59;
    }
    _x_111 = term_keep(e, _x_111);
    if (seq) {
      WL_ROOM(9);
      STK(0) = _x_111;
      STK(1) = _h_85;
      STK(2) = _x_112;
      STK(3) = _h_86;
      STK(4) = _o_50;
      STK(5) = _o_51;
      STK(6) = _o_52;
      STK(7) = _o_53;
      STK(8) = FID_MAIN_K2547;
      WL_PUSHN(9);
    } else {
      u64 _t_51 = task_node(e, FID_MAIN_K2547, WL_CONT, WL_IDX, 1);
      e.mem[_t_51 + 0] = _x_111;
      e.mem[_t_51 + 1] = _h_85;
      e.mem[_t_51 + 2] = _x_112;
      e.mem[_t_51 + 3] = _h_86;
      e.mem[_t_51 + 4] = _o_50;
      e.mem[_t_51 + 5] = _o_51;
      e.mem[_t_51 + 6] = _o_52;
      e.mem[_t_51 + 7] = _o_53;
      WL_CONT = term_tsk(FID_MAIN_K2547, _t_51);
      WL_IDX = 8;
    }
    if (!DEVICE && !seq && fid_nofk(FID_HEAD_OF)) {
      u64 _t_52 = task_node(e, FID_HEAD_OF, WL_CONT, WL_IDX, 0);
      e.mem[_t_52 + 0] = _x_111;
      return term_tsk(FID_HEAD_OF, _t_52);
    }
    r0 = _x_111;
    WL_JMP(FID_HEAD_OF);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2547)
  {
    WL_POPN(8);
    Term _x_114 = STK(0);
    Term _h_87 = STK(1);
    Term _x_115 = STK(2);
    Term _h_88 = STK(3);
    u32 _o_60 = STK(4);
    u32 _o_61 = STK(5);
    Term _o_62 = STK(6);
    Term _o_63 = STK(7);
    Term _h_89 = r0;
    WL_OPEN
    u64 _nd_24 = heap_alloc(e, cls_fit(9));
    e.mem[_nd_24 + 0] = _x_114;
    e.mem[_nd_24 + 1] = _h_87;
    e.mem[_nd_24 + 2] = _x_115;
    e.mem[_nd_24 + 3] = _h_88;
    e.mem[_nd_24 + 4] = _o_60;
    e.mem[_nd_24 + 5] = _o_61;
    e.mem[_nd_24 + 6] = _o_62;
    e.mem[_nd_24 + 7] = _o_63;
    e.mem[_nd_24 + 8] = _h_89;
    r0 = term_clo(FID_MAIN_C2548, _nd_24);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2548)
  {
    Term _x_116 = r0;
    Term _h_90 = r1;
    Term _x_117 = r2;
    Term _h_91 = r3;
    u32 _o_64 = r4;
    u32 _o_65 = r5;
    Term _o_66 = r6;
    Term _o_67 = r7;
    Term _h_92 = r8;
    Term _x_118 = r9;
    WL_OPEN
    u64 _nd_25 = heap_alloc(e, cls_fit(8));
    e.mem[_nd_25 + 0] = _x_116;
    e.mem[_nd_25 + 1] = _h_90;
    e.mem[_nd_25 + 2] = _x_117;
    e.mem[_nd_25 + 3] = _h_91;
    e.mem[_nd_25 + 4] = _o_64;
    e.mem[_nd_25 + 5] = _o_65;
    e.mem[_nd_25 + 6] = _o_66;
    e.mem[_nd_25 + 7] = _o_67;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_234 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_234 + 0] = _h_92;
      e.mem[_t_234 + 1] = term_clo(FID_MAIN_C2549, _nd_25);
      e.mem[_t_234 + 2] = _x_118;
      return term_tsk(FID_IO_BIND, _t_234);
    }
    r0 = _h_92;
    r1 = term_clo(FID_MAIN_C2549, _nd_25);
    r2 = _x_118;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2549)
  {
    Term _x_119 = r0;
    Term _h_93 = r1;
    Term _x_120 = r2;
    Term _h_94 = r3;
    u32 _o_68 = r4;
    u32 _o_69 = r5;
    Term _o_70 = r6;
    Term _o_71 = r7;
    Term _x_121 = r8;
    WL_OPEN
    if (seq) {
      WL_ROOM(6);
      STK(0) = _x_119;
      STK(1) = _h_93;
      STK(2) = _x_120;
      STK(3) = _h_94;
      STK(4) = _x_121;
      STK(5) = FID_MAIN_K2550;
      WL_PUSHN(6);
    } else {
      u64 _t_53 = task_node(e, FID_MAIN_K2550, WL_CONT, WL_IDX, 1);
      e.mem[_t_53 + 0] = _x_119;
      e.mem[_t_53 + 1] = _h_93;
      e.mem[_t_53 + 2] = _x_120;
      e.mem[_t_53 + 3] = _h_94;
      e.mem[_t_53 + 4] = _x_121;
      WL_CONT = term_tsk(FID_MAIN_K2550, _t_53);
      WL_IDX = 5;
    }
    if (!DEVICE && !seq && fid_nofk(FID_IS_BLOCKED)) {
      u64 _t_54 = task_node(e, FID_IS_BLOCKED, WL_CONT, WL_IDX, 0);
      e.mem[_t_54 + 0] = _o_68;
      e.mem[_t_54 + 1] = _o_69;
      e.mem[_t_54 + 2] = _o_70;
      e.mem[_t_54 + 3] = _o_71;
      return term_tsk(FID_IS_BLOCKED, _t_54);
    }
    r0 = _o_68;
    r1 = _o_69;
    r2 = _o_70;
    r3 = _o_71;
    WL_JMP(FID_IS_BLOCKED);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2550)
  {
    WL_POPN(5);
    Term _x_122 = STK(0);
    Term _h_95 = STK(1);
    Term _x_123 = STK(2);
    Term _h_96 = STK(3);
    Term _x_124 = STK(4);
    Term _h_97 = r0;
    WL_OPEN
    u64 _nd_26 = heap_alloc(e, cls_fit(6));
    e.mem[_nd_26 + 0] = _x_122;
    e.mem[_nd_26 + 1] = _h_95;
    e.mem[_nd_26 + 2] = _x_123;
    e.mem[_nd_26 + 3] = _h_96;
    e.mem[_nd_26 + 4] = _x_124;
    e.mem[_nd_26 + 5] = _h_97;
    r0 = term_clo(FID_MAIN_C2551, _nd_26);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2551)
  {
    Term _x_125 = r0;
    Term _h_98 = r1;
    Term _x_126 = r2;
    Term _h_99 = r3;
    Term _x_127 = r4;
    Term _h_100 = r5;
    Term _x_128 = r6;
    WL_OPEN
    u64 _nd_27 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_27 + 0] = _h_100;
    u64 _nd_28 = heap_alloc(e, cls_fit(5));
    e.mem[_nd_28 + 0] = _x_125;
    e.mem[_nd_28 + 1] = _h_98;
    e.mem[_nd_28 + 2] = _x_126;
    e.mem[_nd_28 + 3] = _h_99;
    e.mem[_nd_28 + 4] = _x_127;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_233 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_233 + 0] = term_clo(FID_MAIN_C2552, _nd_27);
      e.mem[_t_233 + 1] = term_clo(FID_MAIN_C2553, _nd_28);
      e.mem[_t_233 + 2] = _x_128;
      return term_tsk(FID_IO_BIND, _t_233);
    }
    r0 = term_clo(FID_MAIN_C2552, _nd_27);
    r1 = term_clo(FID_MAIN_C2553, _nd_28);
    r2 = _x_128;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2552)
  {
    Term _h_101 = r0;
    Term _x_129 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_55 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_55 + 0] = _h_101;
      e.mem[_t_55 + 1] = _x_129;
      return term_tsk(FID_IO_PURE, _t_55);
    }
    r0 = _h_101;
    r1 = _x_129;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2553)
  {
    Term _x_130 = r0;
    Term _h_102 = r1;
    Term _x_131 = r2;
    Term _h_103 = r3;
    Term _x_132 = r4;
    Term _x_133 = r5;
    WL_OPEN
    if (seq) {
      WL_ROOM(6);
      STK(0) = _x_130;
      STK(1) = _h_102;
      STK(2) = _h_103;
      STK(3) = _x_132;
      STK(4) = _x_133;
      STK(5) = FID_MAIN_K2554;
      WL_PUSHN(6);
    } else {
      u64 _t_56 = task_node(e, FID_MAIN_K2554, WL_CONT, WL_IDX, 1);
      e.mem[_t_56 + 0] = _x_130;
      e.mem[_t_56 + 1] = _h_102;
      e.mem[_t_56 + 2] = _h_103;
      e.mem[_t_56 + 3] = _x_132;
      e.mem[_t_56 + 4] = _x_133;
      WL_CONT = term_tsk(FID_MAIN_K2554, _t_56);
      WL_IDX = 5;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_EQ)) {
      u64 _t_57 = task_node(e, FID____SRC_GIT_TEXT_STR_EQ, WL_CONT, WL_IDX, 0);
      e.mem[_t_57 + 0] = _x_132;
      e.mem[_t_57 + 1] = _x_131;
      return term_tsk(FID____SRC_GIT_TEXT_STR_EQ, _t_57);
    }
    r0 = _x_132;
    r1 = _x_131;
    WL_JMP(FID____SRC_GIT_TEXT_STR_EQ);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2554)
  {
    WL_POPN(5);
    Term _x_134 = STK(0);
    Term _h_104 = STK(1);
    Term _h_105 = STK(2);
    Term _x_135 = STK(3);
    Term _x_136 = STK(4);
    u32 _h_106 = r0;
    WL_OPEN
    term_sink(e, _x_135);
    u64 _nd_29 = heap_alloc(e, cls_fit(5));
    e.mem[_nd_29 + 0] = _x_134;
    e.mem[_nd_29 + 1] = _h_104;
    e.mem[_nd_29 + 2] = _h_105;
    e.mem[_nd_29 + 3] = _x_136;
    e.mem[_nd_29 + 4] = _h_106;
    r0 = term_clo(FID_MAIN_C2555, _nd_29);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2555)
  {
    Term _x_137 = r0;
    Term _h_107 = r1;
    Term _h_108 = r2;
    Term _x_138 = r3;
    u32 _h_109 = r4;
    Term _x_139 = r5;
    WL_OPEN
    u64 _nd_30 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_30 + 0] = _h_109;
    u64 _nd_31 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_31 + 0] = _x_137;
    e.mem[_nd_31 + 1] = _h_107;
    e.mem[_nd_31 + 2] = _h_108;
    e.mem[_nd_31 + 3] = _x_138;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_232 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_232 + 0] = term_clo(FID_MAIN_C2556, _nd_30);
      e.mem[_t_232 + 1] = term_clo(FID_MAIN_C2557, _nd_31);
      e.mem[_t_232 + 2] = _x_139;
      return term_tsk(FID_IO_BIND, _t_232);
    }
    r0 = term_clo(FID_MAIN_C2556, _nd_30);
    r1 = term_clo(FID_MAIN_C2557, _nd_31);
    r2 = _x_139;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2556)
  {
    u32 _h_110 = r0;
    Term _x_140 = r1;
    WL_OPEN
    Term _v_5 = 0;
    Term _v_6 = 0;
    Term _o_72[1];
    if (spin_45(e, _o_72, _h_110, term_ctr(CID_SCON, STAT_OFF + 2835)) == 0) {
      return 0;
    }
    _v_6 = _o_72[0];
    _v_5 = _v_6;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_58 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_58 + 0] = _v_5;
      e.mem[_t_58 + 1] = _x_140;
      return term_tsk(FID_IO_PURE, _t_58);
    }
    r0 = _v_5;
    r1 = _x_140;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2557)
  {
    Term _x_141 = r0;
    Term _h_111 = r1;
    Term _h_112 = r2;
    Term _x_142 = r3;
    Term _x_143 = r4;
    WL_OPEN
    if (seq) {
      WL_ROOM(4);
      STK(0) = _x_141;
      STK(1) = _h_111;
      STK(2) = _h_112;
      STK(3) = FID_MAIN_K2558;
      WL_PUSHN(4);
    } else {
      u64 _t_59 = task_node(e, FID_MAIN_K2558, WL_CONT, WL_IDX, 1);
      e.mem[_t_59 + 0] = _x_141;
      e.mem[_t_59 + 1] = _h_111;
      e.mem[_t_59 + 2] = _h_112;
      WL_CONT = term_tsk(FID_MAIN_K2558, _t_59);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_60 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_60 + 0] = _x_142;
      e.mem[_t_60 + 1] = _x_143;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_60);
    }
    r0 = _x_142;
    r1 = _x_143;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2558)
  {
    WL_POPN(3);
    Term _x_144 = STK(0);
    Term _h_113 = STK(1);
    Term _h_114 = STK(2);
    Term _h_115 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(3);
      STK(0) = _x_144;
      STK(1) = _h_113;
      STK(2) = FID_MAIN_K2559;
      WL_PUSHN(3);
    } else {
      u64 _t_61 = task_node(e, FID_MAIN_K2559, WL_CONT, WL_IDX, 1);
      e.mem[_t_61 + 0] = _x_144;
      e.mem[_t_61 + 1] = _h_113;
      WL_CONT = term_tsk(FID_MAIN_K2559, _t_61);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_62 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_62 + 0] = _h_114;
      e.mem[_t_62 + 1] = _h_115;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_62);
    }
    r0 = _h_114;
    r1 = _h_115;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2559)
  {
    WL_POPN(2);
    Term _x_145 = STK(0);
    Term _h_116 = STK(1);
    Term _h_117 = r0;
    WL_OPEN
    _x_145 = term_keep(e, _x_145);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _x_145;
      STK(1) = _h_116;
      STK(2) = _h_117;
      STK(3) = FID_MAIN_K2560;
      WL_PUSHN(4);
    } else {
      u64 _t_63 = task_node(e, FID_MAIN_K2560, WL_CONT, WL_IDX, 1);
      e.mem[_t_63 + 0] = _x_145;
      e.mem[_t_63 + 1] = _h_116;
      e.mem[_t_63 + 2] = _h_117;
      WL_CONT = term_tsk(FID_MAIN_K2560, _t_63);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_64 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_64 + 0] = _x_145;
      e.mem[_t_64 + 1] = term_ctr(CID_SCON, STAT_OFF + 2292);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_64);
    }
    r0 = _x_145;
    r1 = term_ctr(CID_SCON, STAT_OFF + 2292);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2560)
  {
    WL_POPN(3);
    Term _x_146 = STK(0);
    Term _h_118 = STK(1);
    Term _h_119 = STK(2);
    Term _h_120 = r0;
    WL_OPEN
    _x_146 = term_keep(e, _x_146);
    _h_118 = term_keep(e, _h_118);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _x_146;
      STK(1) = _h_118;
      STK(2) = _h_119;
      STK(3) = FID_MAIN_K2561;
      WL_PUSHN(4);
    } else {
      u64 _t_65 = task_node(e, FID_MAIN_K2561, WL_CONT, WL_IDX, 1);
      e.mem[_t_65 + 0] = _x_146;
      e.mem[_t_65 + 1] = _h_118;
      e.mem[_t_65 + 2] = _h_119;
      WL_CONT = term_tsk(FID_MAIN_K2561, _t_65);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID_AUTHOR)) {
      u64 _t_66 = task_node(e, FID_AUTHOR, WL_CONT, WL_IDX, 0);
      e.mem[_t_66 + 0] = _x_146;
      e.mem[_t_66 + 1] = _h_120;
      e.mem[_t_66 + 2] = term_ctr(CID_SCON, STAT_OFF + 2304);
      e.mem[_t_66 + 3] = _h_118;
      e.mem[_t_66 + 4] = term_ctr(CID_SCON, STAT_OFF + 2326);
      return term_tsk(FID_AUTHOR, _t_66);
    }
    r0 = _x_146;
    r1 = _h_120;
    r2 = term_ctr(CID_SCON, STAT_OFF + 2304);
    r3 = _h_118;
    r4 = term_ctr(CID_SCON, STAT_OFF + 2326);
    WL_JMP(FID_AUTHOR);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2561)
  {
    WL_POPN(3);
    Term _x_147 = STK(0);
    Term _h_121 = STK(1);
    Term _h_122 = STK(2);
    Term _h_123 = r0;
    WL_OPEN
    u64 _nd_32 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_32 + 0] = _x_147;
    e.mem[_nd_32 + 1] = _h_121;
    e.mem[_nd_32 + 2] = _h_122;
    e.mem[_nd_32 + 3] = _h_123;
    r0 = term_clo(FID_MAIN_C2562, _nd_32);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2562)
  {
    Term _x_148 = r0;
    Term _h_124 = r1;
    Term _h_125 = r2;
    Term _h_126 = r3;
    Term _x_149 = r4;
    WL_OPEN
    u64 _nd_33 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_33 + 0] = _x_148;
    e.mem[_nd_33 + 1] = _h_124;
    e.mem[_nd_33 + 2] = _h_125;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_231 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_231 + 0] = _h_126;
      e.mem[_t_231 + 1] = term_clo(FID_MAIN_C2563, _nd_33);
      e.mem[_t_231 + 2] = _x_149;
      return term_tsk(FID_IO_BIND, _t_231);
    }
    r0 = _h_126;
    r1 = term_clo(FID_MAIN_C2563, _nd_33);
    r2 = _x_149;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2563)
  {
    Term _x_150 = r0;
    Term _h_127 = r1;
    Term _h_128 = r2;
    Term _x_151 = r3;
    WL_OPEN
    _x_150 = term_keep(e, _x_150);
    if (seq) {
      WL_ROOM(5);
      STK(0) = _x_150;
      STK(1) = _h_127;
      STK(2) = _h_128;
      STK(3) = _x_151;
      STK(4) = FID_MAIN_K2564;
      WL_PUSHN(5);
    } else {
      u64 _t_67 = task_node(e, FID_MAIN_K2564, WL_CONT, WL_IDX, 1);
      e.mem[_t_67 + 0] = _x_150;
      e.mem[_t_67 + 1] = _h_127;
      e.mem[_t_67 + 2] = _h_128;
      e.mem[_t_67 + 3] = _x_151;
      WL_CONT = term_tsk(FID_MAIN_K2564, _t_67);
      WL_IDX = 4;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_68 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_68 + 0] = _x_150;
      e.mem[_t_68 + 1] = term_ctr(CID_SCON, STAT_OFF + 2354);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_68);
    }
    r0 = _x_150;
    r1 = term_ctr(CID_SCON, STAT_OFF + 2354);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2564)
  {
    WL_POPN(4);
    Term _x_152 = STK(0);
    Term _h_129 = STK(1);
    Term _h_130 = STK(2);
    Term _x_153 = STK(3);
    Term _h_131 = r0;
    WL_OPEN
    _x_152 = term_keep(e, _x_152);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _x_152;
      STK(1) = _h_129;
      STK(2) = _h_130;
      STK(3) = FID_MAIN_K2565;
      WL_PUSHN(4);
    } else {
      u64 _t_69 = task_node(e, FID_MAIN_K2565, WL_CONT, WL_IDX, 1);
      e.mem[_t_69 + 0] = _x_152;
      e.mem[_t_69 + 1] = _h_129;
      e.mem[_t_69 + 2] = _h_130;
      WL_CONT = term_tsk(FID_MAIN_K2565, _t_69);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID_LAND_OK)) {
      u64 _t_70 = task_node(e, FID_LAND_OK, WL_CONT, WL_IDX, 0);
      e.mem[_t_70 + 0] = _x_152;
      e.mem[_t_70 + 1] = term_ctr(CID_SCON, STAT_OFF + 663);
      e.mem[_t_70 + 2] = _x_153;
      e.mem[_t_70 + 3] = term_ctr(CID_CON, STAT_OFF + 1335);
      e.mem[_t_70 + 4] = term_ctr(CID_SCON, STAT_OFF + 2376);
      e.mem[_t_70 + 5] = _h_131;
      return term_tsk(FID_LAND_OK, _t_70);
    }
    r0 = _x_152;
    r1 = term_ctr(CID_SCON, STAT_OFF + 663);
    r2 = _x_153;
    r3 = term_ctr(CID_CON, STAT_OFF + 1335);
    r4 = term_ctr(CID_SCON, STAT_OFF + 2376);
    r5 = _h_131;
    WL_JMP(FID_LAND_OK);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2565)
  {
    WL_POPN(3);
    Term _x_154 = STK(0);
    Term _h_132 = STK(1);
    Term _h_133 = STK(2);
    Term _h_134 = r0;
    WL_OPEN
    u64 _nd_34 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_34 + 0] = _x_154;
    e.mem[_nd_34 + 1] = _h_132;
    e.mem[_nd_34 + 2] = _h_133;
    e.mem[_nd_34 + 3] = _h_134;
    r0 = term_clo(FID_MAIN_C2566, _nd_34);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2566)
  {
    Term _x_155 = r0;
    Term _h_135 = r1;
    Term _h_136 = r2;
    Term _h_137 = r3;
    Term _x_156 = r4;
    WL_OPEN
    u64 _nd_35 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_35 + 0] = _x_155;
    e.mem[_nd_35 + 1] = _h_135;
    e.mem[_nd_35 + 2] = _h_136;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_230 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_230 + 0] = _h_137;
      e.mem[_t_230 + 1] = term_clo(FID_MAIN_C2567, _nd_35);
      e.mem[_t_230 + 2] = _x_156;
      return term_tsk(FID_IO_BIND, _t_230);
    }
    r0 = _h_137;
    r1 = term_clo(FID_MAIN_C2567, _nd_35);
    r2 = _x_156;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2567)
  {
    Term _x_157 = r0;
    Term _h_138 = r1;
    Term _h_139 = r2;
    Term _x_158 = r3;
    WL_OPEN
    u32 _o_73 = 0;
    u32 _o_74 = 0;
    Term _o_75 = 0;
    Term _o_76 = 0;
    if (term_aux(_x_158) == CID_FAIL) {
      _o_73 = 0;
      Term _fb_7[1];
      u64 _sp_35 = ctr_take(e, _x_158, 1, _fb_7);
      Term _f_46 = _fb_7[0];
      spare_free(e, cls_fit(1), _sp_35);
      u32 _o_77 = 0;
      Term _o_78 = 0;
      Term _o_79 = 0;
      if (term_aux(_f_46) == CID____SRC_GIT_TYPES_FBRANCHEXISTS) {
        _o_77 = 0;
        u64 _sp_36 = term_loc(_f_46);
        Term _f_47 = e.mem[_sp_36 + 0];
        heap_free(e, cls_fit(1), _sp_36);
        _o_78 = _f_47;
      } else if (term_aux(_f_46) == CID____SRC_GIT_TYPES_FPATHEXISTS) {
        _o_77 = 1;
        u64 _sp_37 = term_loc(_f_46);
        Term _f_48 = e.mem[_sp_37 + 0];
        heap_free(e, cls_fit(1), _sp_37);
        _o_78 = _f_48;
      } else if (term_aux(_f_46) == CID____SRC_GIT_TYPES_FUNKNOWNBASE) {
        _o_77 = 2;
        u64 _sp_38 = term_loc(_f_46);
        Term _f_49 = e.mem[_sp_38 + 0];
        heap_free(e, cls_fit(1), _sp_38);
        _o_78 = _f_49;
      } else if (term_aux(_f_46) == CID____SRC_GIT_TYPES_FTARGETBUSY) {
        _o_77 = 3;
        u64 _sp_39 = term_loc(_f_46);
        Term _f_50 = e.mem[_sp_39 + 0];
        heap_free(e, cls_fit(1), _sp_39);
        _o_78 = _f_50;
      } else {
        _o_77 = 4;
        Term _fb_8[2];
        u64 _sp_40 = ctr_take(e, _f_46, 2, _fb_8);
        Term _f_51 = _fb_8[0];
        Term _f_52 = _fb_8[1];
        spare_free(e, cls_fit(2), _sp_40);
        _o_78 = _f_51;
        _o_79 = _f_52;
      }
      _o_74 = _o_77;
      _o_75 = _o_78;
      _o_76 = _o_79;
    } else {
      _o_73 = 1;
      u64 _sp_41 = term_loc(_x_158);
      Term _f_53 = e.mem[_sp_41 + 0];
      heap_free(e, cls_fit(1), _sp_41);
      u32 _o_80 = 0;
      Term _o_81 = 0;
      Term _o_82 = 0;
      if (term_aux(_f_53) == CID____SRC_GIT_TYPES_LLANDED) {
        _o_80 = 0;
        u64 _sp_42 = term_loc(_f_53);
        Term _f_54 = e.mem[_sp_42 + 0];
        Term _f_55 = e.mem[_sp_42 + 1];
        heap_free(e, cls_fit(2), _sp_42);
        _o_81 = _f_54;
        _o_82 = _f_55;
      } else if (term_aux(_f_53) == CID____SRC_GIT_TYPES_LALREADY) {
        _o_80 = 1;
        u64 _sp_43 = term_loc(_f_53);
        Term _f_56 = e.mem[_sp_43 + 0];
        heap_free(e, cls_fit(1), _sp_43);
        _o_81 = _f_56;
      } else if (term_aux(_f_53) == CID____SRC_GIT_TYPES_LCONFLICT) {
        _o_80 = 2;
        u64 _sp_44 = term_loc(_f_53);
        Term _f_57 = e.mem[_sp_44 + 0];
        Term _f_58 = e.mem[_sp_44 + 1];
        heap_free(e, cls_fit(2), _sp_44);
        _o_81 = _f_57;
        _o_82 = _f_58;
      } else {
        _o_80 = 3;
        u64 _sp_45 = term_loc(_f_53);
        Term _f_59 = e.mem[_sp_45 + 0];
        heap_free(e, cls_fit(1), _sp_45);
        _o_81 = _f_59;
      }
      _o_74 = _o_80;
      _o_75 = _o_81;
      _o_76 = _o_82;
    }
    _x_157 = term_keep(e, _x_157);
    if (seq) {
      WL_ROOM(8);
      STK(0) = _x_157;
      STK(1) = _h_138;
      STK(2) = _h_139;
      STK(3) = _o_73;
      STK(4) = _o_74;
      STK(5) = _o_75;
      STK(6) = _o_76;
      STK(7) = FID_MAIN_K2568;
      WL_PUSHN(8);
    } else {
      u64 _t_71 = task_node(e, FID_MAIN_K2568, WL_CONT, WL_IDX, 1);
      e.mem[_t_71 + 0] = _x_157;
      e.mem[_t_71 + 1] = _h_138;
      e.mem[_t_71 + 2] = _h_139;
      e.mem[_t_71 + 3] = _o_73;
      e.mem[_t_71 + 4] = _o_74;
      e.mem[_t_71 + 5] = _o_75;
      e.mem[_t_71 + 6] = _o_76;
      WL_CONT = term_tsk(FID_MAIN_K2568, _t_71);
      WL_IDX = 7;
    }
    if (!DEVICE && !seq && fid_nofk(FID_HEAD_OF)) {
      u64 _t_72 = task_node(e, FID_HEAD_OF, WL_CONT, WL_IDX, 0);
      e.mem[_t_72 + 0] = _x_157;
      return term_tsk(FID_HEAD_OF, _t_72);
    }
    r0 = _x_157;
    WL_JMP(FID_HEAD_OF);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2568)
  {
    WL_POPN(7);
    Term _x_159 = STK(0);
    Term _h_140 = STK(1);
    Term _h_141 = STK(2);
    u32 _o_83 = STK(3);
    u32 _o_84 = STK(4);
    Term _o_85 = STK(5);
    Term _o_86 = STK(6);
    Term _h_142 = r0;
    WL_OPEN
    u64 _nd_36 = heap_alloc(e, cls_fit(8));
    e.mem[_nd_36 + 0] = _x_159;
    e.mem[_nd_36 + 1] = _h_140;
    e.mem[_nd_36 + 2] = _h_141;
    e.mem[_nd_36 + 3] = _o_83;
    e.mem[_nd_36 + 4] = _o_84;
    e.mem[_nd_36 + 5] = _o_85;
    e.mem[_nd_36 + 6] = _o_86;
    e.mem[_nd_36 + 7] = _h_142;
    r0 = term_clo(FID_MAIN_C2569, _nd_36);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2569)
  {
    Term _x_160 = r0;
    Term _h_143 = r1;
    Term _h_144 = r2;
    u32 _o_87 = r3;
    u32 _o_88 = r4;
    Term _o_89 = r5;
    Term _o_90 = r6;
    Term _h_145 = r7;
    Term _x_161 = r8;
    WL_OPEN
    u64 _nd_37 = heap_alloc(e, cls_fit(7));
    e.mem[_nd_37 + 0] = _x_160;
    e.mem[_nd_37 + 1] = _h_143;
    e.mem[_nd_37 + 2] = _h_144;
    e.mem[_nd_37 + 3] = _o_87;
    e.mem[_nd_37 + 4] = _o_88;
    e.mem[_nd_37 + 5] = _o_89;
    e.mem[_nd_37 + 6] = _o_90;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_229 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_229 + 0] = _h_145;
      e.mem[_t_229 + 1] = term_clo(FID_MAIN_C2570, _nd_37);
      e.mem[_t_229 + 2] = _x_161;
      return term_tsk(FID_IO_BIND, _t_229);
    }
    r0 = _h_145;
    r1 = term_clo(FID_MAIN_C2570, _nd_37);
    r2 = _x_161;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2570)
  {
    Term _x_162 = r0;
    Term _h_146 = r1;
    Term _h_147 = r2;
    u32 _o_91 = r3;
    u32 _o_92 = r4;
    Term _o_93 = r5;
    Term _o_94 = r6;
    Term _x_163 = r7;
    WL_OPEN
    _x_162 = term_keep(e, _x_162);
    if (seq) {
      WL_ROOM(9);
      STK(0) = _x_162;
      STK(1) = _h_146;
      STK(2) = _h_147;
      STK(3) = _o_91;
      STK(4) = _o_92;
      STK(5) = _o_93;
      STK(6) = _o_94;
      STK(7) = _x_163;
      STK(8) = FID_MAIN_K2571;
      WL_PUSHN(9);
    } else {
      u64 _t_73 = task_node(e, FID_MAIN_K2571, WL_CONT, WL_IDX, 1);
      e.mem[_t_73 + 0] = _x_162;
      e.mem[_t_73 + 1] = _h_146;
      e.mem[_t_73 + 2] = _h_147;
      e.mem[_t_73 + 3] = _o_91;
      e.mem[_t_73 + 4] = _o_92;
      e.mem[_t_73 + 5] = _o_93;
      e.mem[_t_73 + 6] = _o_94;
      e.mem[_t_73 + 7] = _x_163;
      WL_CONT = term_tsk(FID_MAIN_K2571, _t_73);
      WL_IDX = 8;
    }
    if (!DEVICE && !seq && fid_nofk(FID_BLOB_OF)) {
      u64 _t_74 = task_node(e, FID_BLOB_OF, WL_CONT, WL_IDX, 0);
      e.mem[_t_74 + 0] = _x_162;
      e.mem[_t_74 + 1] = term_ctr(CID_SCON, STAT_OFF + 1271);
      return term_tsk(FID_BLOB_OF, _t_74);
    }
    r0 = _x_162;
    r1 = term_ctr(CID_SCON, STAT_OFF + 1271);
    WL_JMP(FID_BLOB_OF);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2571)
  {
    WL_POPN(8);
    Term _x_164 = STK(0);
    Term _h_148 = STK(1);
    Term _h_149 = STK(2);
    u32 _o_95 = STK(3);
    u32 _o_96 = STK(4);
    Term _o_97 = STK(5);
    Term _o_98 = STK(6);
    Term _x_165 = STK(7);
    Term _h_150 = r0;
    WL_OPEN
    u64 _nd_38 = heap_alloc(e, cls_fit(9));
    e.mem[_nd_38 + 0] = _x_164;
    e.mem[_nd_38 + 1] = _h_148;
    e.mem[_nd_38 + 2] = _h_149;
    e.mem[_nd_38 + 3] = _o_95;
    e.mem[_nd_38 + 4] = _o_96;
    e.mem[_nd_38 + 5] = _o_97;
    e.mem[_nd_38 + 6] = _o_98;
    e.mem[_nd_38 + 7] = _x_165;
    e.mem[_nd_38 + 8] = _h_150;
    r0 = term_clo(FID_MAIN_C2572, _nd_38);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2572)
  {
    Term _x_166 = r0;
    Term _h_151 = r1;
    Term _h_152 = r2;
    u32 _o_99 = r3;
    u32 _o_100 = r4;
    Term _o_101 = r5;
    Term _o_102 = r6;
    Term _x_167 = r7;
    Term _h_153 = r8;
    Term _x_168 = r9;
    WL_OPEN
    u64 _nd_39 = heap_alloc(e, cls_fit(8));
    e.mem[_nd_39 + 0] = _x_166;
    e.mem[_nd_39 + 1] = _h_151;
    e.mem[_nd_39 + 2] = _h_152;
    e.mem[_nd_39 + 3] = _o_99;
    e.mem[_nd_39 + 4] = _o_100;
    e.mem[_nd_39 + 5] = _o_101;
    e.mem[_nd_39 + 6] = _o_102;
    e.mem[_nd_39 + 7] = _x_167;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_228 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_228 + 0] = _h_153;
      e.mem[_t_228 + 1] = term_clo(FID_MAIN_C2573, _nd_39);
      e.mem[_t_228 + 2] = _x_168;
      return term_tsk(FID_IO_BIND, _t_228);
    }
    r0 = _h_153;
    r1 = term_clo(FID_MAIN_C2573, _nd_39);
    r2 = _x_168;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2573)
  {
    Term _x_169 = r0;
    Term _h_154 = r1;
    Term _h_155 = r2;
    u32 _o_103 = r3;
    u32 _o_104 = r4;
    Term _o_105 = r5;
    Term _o_106 = r6;
    Term _x_170 = r7;
    Term _x_171 = r8;
    WL_OPEN
    if (seq) {
      WL_ROOM(5);
      STK(0) = _x_169;
      STK(1) = _h_154;
      STK(2) = _h_155;
      STK(3) = _x_171;
      STK(4) = FID_MAIN_K2574;
      WL_PUSHN(5);
    } else {
      u64 _t_75 = task_node(e, FID_MAIN_K2574, WL_CONT, WL_IDX, 1);
      e.mem[_t_75 + 0] = _x_169;
      e.mem[_t_75 + 1] = _h_154;
      e.mem[_t_75 + 2] = _h_155;
      e.mem[_t_75 + 3] = _x_171;
      WL_CONT = term_tsk(FID_MAIN_K2574, _t_75);
      WL_IDX = 4;
    }
    if (!DEVICE && !seq && fid_nofk(FID_IS_LANDED)) {
      u64 _t_76 = task_node(e, FID_IS_LANDED, WL_CONT, WL_IDX, 0);
      e.mem[_t_76 + 0] = _o_103;
      e.mem[_t_76 + 1] = _o_104;
      e.mem[_t_76 + 2] = _o_105;
      e.mem[_t_76 + 3] = _o_106;
      e.mem[_t_76 + 4] = _x_170;
      return term_tsk(FID_IS_LANDED, _t_76);
    }
    r0 = _o_103;
    r1 = _o_104;
    r2 = _o_105;
    r3 = _o_106;
    r4 = _x_170;
    WL_JMP(FID_IS_LANDED);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2574)
  {
    WL_POPN(4);
    Term _x_172 = STK(0);
    Term _h_156 = STK(1);
    Term _h_157 = STK(2);
    Term _x_173 = STK(3);
    Term _h_158 = r0;
    WL_OPEN
    u64 _nd_40 = heap_alloc(e, cls_fit(5));
    e.mem[_nd_40 + 0] = _x_172;
    e.mem[_nd_40 + 1] = _h_156;
    e.mem[_nd_40 + 2] = _h_157;
    e.mem[_nd_40 + 3] = _x_173;
    e.mem[_nd_40 + 4] = _h_158;
    r0 = term_clo(FID_MAIN_C2575, _nd_40);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2575)
  {
    Term _x_174 = r0;
    Term _h_159 = r1;
    Term _h_160 = r2;
    Term _x_175 = r3;
    Term _h_161 = r4;
    Term _x_176 = r5;
    WL_OPEN
    u64 _nd_41 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_41 + 0] = _h_161;
    u64 _nd_42 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_42 + 0] = _x_174;
    e.mem[_nd_42 + 1] = _h_159;
    e.mem[_nd_42 + 2] = _h_160;
    e.mem[_nd_42 + 3] = _x_175;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_227 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_227 + 0] = term_clo(FID_MAIN_C2576, _nd_41);
      e.mem[_t_227 + 1] = term_clo(FID_MAIN_C2577, _nd_42);
      e.mem[_t_227 + 2] = _x_176;
      return term_tsk(FID_IO_BIND, _t_227);
    }
    r0 = term_clo(FID_MAIN_C2576, _nd_41);
    r1 = term_clo(FID_MAIN_C2577, _nd_42);
    r2 = _x_176;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2576)
  {
    Term _h_162 = r0;
    Term _x_177 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_77 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_77 + 0] = _h_162;
      e.mem[_t_77 + 1] = _x_177;
      return term_tsk(FID_IO_PURE, _t_77);
    }
    r0 = _h_162;
    r1 = _x_177;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2577)
  {
    Term _x_178 = r0;
    Term _h_163 = r1;
    Term _h_164 = r2;
    Term _x_179 = r3;
    Term _x_180 = r4;
    WL_OPEN
    if (seq) {
      WL_ROOM(6);
      STK(0) = _x_178;
      STK(1) = _h_163;
      STK(2) = _h_164;
      STK(3) = _x_179;
      STK(4) = _x_180;
      STK(5) = FID_MAIN_K2578;
      WL_PUSHN(6);
    } else {
      u64 _t_78 = task_node(e, FID_MAIN_K2578, WL_CONT, WL_IDX, 1);
      e.mem[_t_78 + 0] = _x_178;
      e.mem[_t_78 + 1] = _h_163;
      e.mem[_t_78 + 2] = _h_164;
      e.mem[_t_78 + 3] = _x_179;
      e.mem[_t_78 + 4] = _x_180;
      WL_CONT = term_tsk(FID_MAIN_K2578, _t_78);
      WL_IDX = 5;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_EQ)) {
      u64 _t_79 = task_node(e, FID____SRC_GIT_TEXT_STR_EQ, WL_CONT, WL_IDX, 0);
      e.mem[_t_79 + 0] = _x_179;
      e.mem[_t_79 + 1] = term_ctr(CID_SCON, STAT_OFF + 2380);
      return term_tsk(FID____SRC_GIT_TEXT_STR_EQ, _t_79);
    }
    r0 = _x_179;
    r1 = term_ctr(CID_SCON, STAT_OFF + 2380);
    WL_JMP(FID____SRC_GIT_TEXT_STR_EQ);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2578)
  {
    WL_POPN(5);
    Term _x_181 = STK(0);
    Term _h_165 = STK(1);
    Term _h_166 = STK(2);
    Term _x_182 = STK(3);
    Term _x_183 = STK(4);
    u32 _h_167 = r0;
    WL_OPEN
    term_sink(e, _x_182);
    u64 _nd_43 = heap_alloc(e, cls_fit(5));
    e.mem[_nd_43 + 0] = _x_181;
    e.mem[_nd_43 + 1] = _h_165;
    e.mem[_nd_43 + 2] = _h_166;
    e.mem[_nd_43 + 3] = _x_183;
    e.mem[_nd_43 + 4] = _h_167;
    r0 = term_clo(FID_MAIN_C2579, _nd_43);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2579)
  {
    Term _x_184 = r0;
    Term _h_168 = r1;
    Term _h_169 = r2;
    Term _x_185 = r3;
    u32 _h_170 = r4;
    Term _x_186 = r5;
    WL_OPEN
    u64 _nd_44 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_44 + 0] = _h_170;
    u64 _nd_45 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_45 + 0] = _x_184;
    e.mem[_nd_45 + 1] = _h_168;
    e.mem[_nd_45 + 2] = _h_169;
    e.mem[_nd_45 + 3] = _x_185;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_226 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_226 + 0] = term_clo(FID_MAIN_C2580, _nd_44);
      e.mem[_t_226 + 1] = term_clo(FID_MAIN_C2581, _nd_45);
      e.mem[_t_226 + 2] = _x_186;
      return term_tsk(FID_IO_BIND, _t_226);
    }
    r0 = term_clo(FID_MAIN_C2580, _nd_44);
    r1 = term_clo(FID_MAIN_C2581, _nd_45);
    r2 = _x_186;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2580)
  {
    u32 _h_171 = r0;
    Term _x_187 = r1;
    WL_OPEN
    Term _v_7 = 0;
    Term _v_8 = 0;
    Term _o_107[1];
    if (spin_45(e, _o_107, _h_171, term_ctr(CID_SCON, STAT_OFF + 2448)) == 0) {
      return 0;
    }
    _v_8 = _o_107[0];
    _v_7 = _v_8;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_80 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_80 + 0] = _v_7;
      e.mem[_t_80 + 1] = _x_187;
      return term_tsk(FID_IO_PURE, _t_80);
    }
    r0 = _v_7;
    r1 = _x_187;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2581)
  {
    Term _x_188 = r0;
    Term _h_172 = r1;
    Term _h_173 = r2;
    Term _x_189 = r3;
    Term _x_190 = r4;
    WL_OPEN
    if (seq) {
      WL_ROOM(4);
      STK(0) = _x_188;
      STK(1) = _h_172;
      STK(2) = _h_173;
      STK(3) = FID_MAIN_K2582;
      WL_PUSHN(4);
    } else {
      u64 _t_81 = task_node(e, FID_MAIN_K2582, WL_CONT, WL_IDX, 1);
      e.mem[_t_81 + 0] = _x_188;
      e.mem[_t_81 + 1] = _h_172;
      e.mem[_t_81 + 2] = _h_173;
      WL_CONT = term_tsk(FID_MAIN_K2582, _t_81);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_82 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_82 + 0] = _x_189;
      e.mem[_t_82 + 1] = _x_190;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_82);
    }
    r0 = _x_189;
    r1 = _x_190;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2582)
  {
    WL_POPN(3);
    Term _x_191 = STK(0);
    Term _h_174 = STK(1);
    Term _h_175 = STK(2);
    Term _h_176 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(3);
      STK(0) = _x_191;
      STK(1) = _h_174;
      STK(2) = FID_MAIN_K2583;
      WL_PUSHN(3);
    } else {
      u64 _t_83 = task_node(e, FID_MAIN_K2583, WL_CONT, WL_IDX, 1);
      e.mem[_t_83 + 0] = _x_191;
      e.mem[_t_83 + 1] = _h_174;
      WL_CONT = term_tsk(FID_MAIN_K2583, _t_83);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_84 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_84 + 0] = _h_175;
      e.mem[_t_84 + 1] = _h_176;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_84);
    }
    r0 = _h_175;
    r1 = _h_176;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2583)
  {
    WL_POPN(2);
    Term _x_192 = STK(0);
    Term _h_177 = STK(1);
    Term _h_178 = r0;
    WL_OPEN
    _x_192 = term_keep(e, _x_192);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _x_192;
      STK(1) = _h_177;
      STK(2) = _h_178;
      STK(3) = FID_MAIN_K2584;
      WL_PUSHN(4);
    } else {
      u64 _t_85 = task_node(e, FID_MAIN_K2584, WL_CONT, WL_IDX, 1);
      e.mem[_t_85 + 0] = _x_192;
      e.mem[_t_85 + 1] = _h_177;
      e.mem[_t_85 + 2] = _h_178;
      WL_CONT = term_tsk(FID_MAIN_K2584, _t_85);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_86 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_86 + 0] = _x_192;
      e.mem[_t_86 + 1] = term_ctr(CID_SCON, STAT_OFF + 2152);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_86);
    }
    r0 = _x_192;
    r1 = term_ctr(CID_SCON, STAT_OFF + 2152);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2584)
  {
    WL_POPN(3);
    Term _x_193 = STK(0);
    Term _h_179 = STK(1);
    Term _h_180 = STK(2);
    Term _h_181 = r0;
    WL_OPEN
    _x_193 = term_keep(e, _x_193);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _x_193;
      STK(1) = _h_180;
      STK(2) = FID_MAIN_K2585;
      WL_PUSHN(3);
    } else {
      u64 _t_87 = task_node(e, FID_MAIN_K2585, WL_CONT, WL_IDX, 1);
      e.mem[_t_87 + 0] = _x_193;
      e.mem[_t_87 + 1] = _h_180;
      WL_CONT = term_tsk(FID_MAIN_K2585, _t_87);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID_AUTHOR)) {
      u64 _t_88 = task_node(e, FID_AUTHOR, WL_CONT, WL_IDX, 0);
      e.mem[_t_88 + 0] = _x_193;
      e.mem[_t_88 + 1] = _h_181;
      e.mem[_t_88 + 2] = term_ctr(CID_SCON, STAT_OFF + 2164);
      e.mem[_t_88 + 3] = _h_179;
      e.mem[_t_88 + 4] = term_ctr(CID_SCON, STAT_OFF + 2190);
      return term_tsk(FID_AUTHOR, _t_88);
    }
    r0 = _x_193;
    r1 = _h_181;
    r2 = term_ctr(CID_SCON, STAT_OFF + 2164);
    r3 = _h_179;
    r4 = term_ctr(CID_SCON, STAT_OFF + 2190);
    WL_JMP(FID_AUTHOR);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2585)
  {
    WL_POPN(2);
    Term _x_194 = STK(0);
    Term _h_182 = STK(1);
    Term _h_183 = r0;
    WL_OPEN
    u64 _nd_46 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_46 + 0] = _x_194;
    e.mem[_nd_46 + 1] = _h_182;
    e.mem[_nd_46 + 2] = _h_183;
    r0 = term_clo(FID_MAIN_C2586, _nd_46);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2586)
  {
    Term _x_195 = r0;
    Term _h_184 = r1;
    Term _h_185 = r2;
    Term _x_196 = r3;
    WL_OPEN
    u64 _nd_47 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_47 + 0] = _x_195;
    e.mem[_nd_47 + 1] = _h_184;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_225 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_225 + 0] = _h_185;
      e.mem[_t_225 + 1] = term_clo(FID_MAIN_C2587, _nd_47);
      e.mem[_t_225 + 2] = _x_196;
      return term_tsk(FID_IO_BIND, _t_225);
    }
    r0 = _h_185;
    r1 = term_clo(FID_MAIN_C2587, _nd_47);
    r2 = _x_196;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2587)
  {
    Term _x_197 = r0;
    Term _h_186 = r1;
    Term _x_198 = r2;
    WL_OPEN
    _x_197 = term_keep(e, _x_197);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _x_197;
      STK(1) = _h_186;
      STK(2) = _x_198;
      STK(3) = FID_MAIN_K2588;
      WL_PUSHN(4);
    } else {
      u64 _t_89 = task_node(e, FID_MAIN_K2588, WL_CONT, WL_IDX, 1);
      e.mem[_t_89 + 0] = _x_197;
      e.mem[_t_89 + 1] = _h_186;
      e.mem[_t_89 + 2] = _x_198;
      WL_CONT = term_tsk(FID_MAIN_K2588, _t_89);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_90 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_90 + 0] = _x_197;
      e.mem[_t_90 + 1] = term_ctr(CID_SCON, STAT_OFF + 2218);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_90);
    }
    r0 = _x_197;
    r1 = term_ctr(CID_SCON, STAT_OFF + 2218);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2588)
  {
    WL_POPN(3);
    Term _x_199 = STK(0);
    Term _h_187 = STK(1);
    Term _x_200 = STK(2);
    Term _h_188 = r0;
    WL_OPEN
    _x_199 = term_keep(e, _x_199);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _x_199;
      STK(1) = _h_187;
      STK(2) = FID_MAIN_K2589;
      WL_PUSHN(3);
    } else {
      u64 _t_91 = task_node(e, FID_MAIN_K2589, WL_CONT, WL_IDX, 1);
      e.mem[_t_91 + 0] = _x_199;
      e.mem[_t_91 + 1] = _h_187;
      WL_CONT = term_tsk(FID_MAIN_K2589, _t_91);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID_LAND_OK)) {
      u64 _t_92 = task_node(e, FID_LAND_OK, WL_CONT, WL_IDX, 0);
      e.mem[_t_92 + 0] = _x_199;
      e.mem[_t_92 + 1] = term_ctr(CID_SCON, STAT_OFF + 663);
      e.mem[_t_92 + 2] = _x_200;
      e.mem[_t_92 + 3] = term_ctr(CID_CON, STAT_OFF + 1335);
      e.mem[_t_92 + 4] = term_ctr(CID_SCON, STAT_OFF + 729);
      e.mem[_t_92 + 5] = _h_188;
      return term_tsk(FID_LAND_OK, _t_92);
    }
    r0 = _x_199;
    r1 = term_ctr(CID_SCON, STAT_OFF + 663);
    r2 = _x_200;
    r3 = term_ctr(CID_CON, STAT_OFF + 1335);
    r4 = term_ctr(CID_SCON, STAT_OFF + 729);
    r5 = _h_188;
    WL_JMP(FID_LAND_OK);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2589)
  {
    WL_POPN(2);
    Term _x_201 = STK(0);
    Term _h_189 = STK(1);
    Term _h_190 = r0;
    WL_OPEN
    u64 _nd_48 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_48 + 0] = _x_201;
    e.mem[_nd_48 + 1] = _h_189;
    e.mem[_nd_48 + 2] = _h_190;
    r0 = term_clo(FID_MAIN_C2590, _nd_48);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2590)
  {
    Term _x_202 = r0;
    Term _h_191 = r1;
    Term _h_192 = r2;
    Term _x_203 = r3;
    WL_OPEN
    u64 _nd_49 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_49 + 0] = _x_202;
    e.mem[_nd_49 + 1] = _h_191;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_224 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_224 + 0] = _h_192;
      e.mem[_t_224 + 1] = term_clo(FID_MAIN_C2591, _nd_49);
      e.mem[_t_224 + 2] = _x_203;
      return term_tsk(FID_IO_BIND, _t_224);
    }
    r0 = _h_192;
    r1 = term_clo(FID_MAIN_C2591, _nd_49);
    r2 = _x_203;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2591)
  {
    Term _x_204 = r0;
    Term _h_193 = r1;
    Term _x_205 = r2;
    WL_OPEN
    u32 _o_108 = 0;
    u32 _o_109 = 0;
    Term _o_110 = 0;
    Term _o_111 = 0;
    if (term_aux(_x_205) == CID_FAIL) {
      _o_108 = 0;
      Term _fb_9[1];
      u64 _sp_46 = ctr_take(e, _x_205, 1, _fb_9);
      Term _f_60 = _fb_9[0];
      spare_free(e, cls_fit(1), _sp_46);
      u32 _o_112 = 0;
      Term _o_113 = 0;
      Term _o_114 = 0;
      if (term_aux(_f_60) == CID____SRC_GIT_TYPES_FBRANCHEXISTS) {
        _o_112 = 0;
        u64 _sp_47 = term_loc(_f_60);
        Term _f_61 = e.mem[_sp_47 + 0];
        heap_free(e, cls_fit(1), _sp_47);
        _o_113 = _f_61;
      } else if (term_aux(_f_60) == CID____SRC_GIT_TYPES_FPATHEXISTS) {
        _o_112 = 1;
        u64 _sp_48 = term_loc(_f_60);
        Term _f_62 = e.mem[_sp_48 + 0];
        heap_free(e, cls_fit(1), _sp_48);
        _o_113 = _f_62;
      } else if (term_aux(_f_60) == CID____SRC_GIT_TYPES_FUNKNOWNBASE) {
        _o_112 = 2;
        u64 _sp_49 = term_loc(_f_60);
        Term _f_63 = e.mem[_sp_49 + 0];
        heap_free(e, cls_fit(1), _sp_49);
        _o_113 = _f_63;
      } else if (term_aux(_f_60) == CID____SRC_GIT_TYPES_FTARGETBUSY) {
        _o_112 = 3;
        u64 _sp_50 = term_loc(_f_60);
        Term _f_64 = e.mem[_sp_50 + 0];
        heap_free(e, cls_fit(1), _sp_50);
        _o_113 = _f_64;
      } else {
        _o_112 = 4;
        Term _fb_10[2];
        u64 _sp_51 = ctr_take(e, _f_60, 2, _fb_10);
        Term _f_65 = _fb_10[0];
        Term _f_66 = _fb_10[1];
        spare_free(e, cls_fit(2), _sp_51);
        _o_113 = _f_65;
        _o_114 = _f_66;
      }
      _o_109 = _o_112;
      _o_110 = _o_113;
      _o_111 = _o_114;
    } else {
      _o_108 = 1;
      u64 _sp_52 = term_loc(_x_205);
      Term _f_67 = e.mem[_sp_52 + 0];
      heap_free(e, cls_fit(1), _sp_52);
      u32 _o_115 = 0;
      Term _o_116 = 0;
      Term _o_117 = 0;
      if (term_aux(_f_67) == CID____SRC_GIT_TYPES_LLANDED) {
        _o_115 = 0;
        u64 _sp_53 = term_loc(_f_67);
        Term _f_68 = e.mem[_sp_53 + 0];
        Term _f_69 = e.mem[_sp_53 + 1];
        heap_free(e, cls_fit(2), _sp_53);
        _o_116 = _f_68;
        _o_117 = _f_69;
      } else if (term_aux(_f_67) == CID____SRC_GIT_TYPES_LALREADY) {
        _o_115 = 1;
        u64 _sp_54 = term_loc(_f_67);
        Term _f_70 = e.mem[_sp_54 + 0];
        heap_free(e, cls_fit(1), _sp_54);
        _o_116 = _f_70;
      } else if (term_aux(_f_67) == CID____SRC_GIT_TYPES_LCONFLICT) {
        _o_115 = 2;
        u64 _sp_55 = term_loc(_f_67);
        Term _f_71 = e.mem[_sp_55 + 0];
        Term _f_72 = e.mem[_sp_55 + 1];
        heap_free(e, cls_fit(2), _sp_55);
        _o_116 = _f_71;
        _o_117 = _f_72;
      } else {
        _o_115 = 3;
        u64 _sp_56 = term_loc(_f_67);
        Term _f_73 = e.mem[_sp_56 + 0];
        heap_free(e, cls_fit(1), _sp_56);
        _o_116 = _f_73;
      }
      _o_109 = _o_115;
      _o_110 = _o_116;
      _o_111 = _o_117;
    }
    if (seq) {
      WL_ROOM(3);
      STK(0) = _x_204;
      STK(1) = _h_193;
      STK(2) = FID_MAIN_K2592;
      WL_PUSHN(3);
    } else {
      u64 _t_93 = task_node(e, FID_MAIN_K2592, WL_CONT, WL_IDX, 1);
      e.mem[_t_93 + 0] = _x_204;
      e.mem[_t_93 + 1] = _h_193;
      WL_CONT = term_tsk(FID_MAIN_K2592, _t_93);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID_IS_CONFLICT_FILE)) {
      u64 _t_94 = task_node(e, FID_IS_CONFLICT_FILE, WL_CONT, WL_IDX, 0);
      e.mem[_t_94 + 0] = _o_108;
      e.mem[_t_94 + 1] = _o_109;
      e.mem[_t_94 + 2] = _o_110;
      e.mem[_t_94 + 3] = _o_111;
      e.mem[_t_94 + 4] = term_ctr(CID_SCON, STAT_OFF + 1271);
      return term_tsk(FID_IS_CONFLICT_FILE, _t_94);
    }
    r0 = _o_108;
    r1 = _o_109;
    r2 = _o_110;
    r3 = _o_111;
    r4 = term_ctr(CID_SCON, STAT_OFF + 1271);
    WL_JMP(FID_IS_CONFLICT_FILE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2592)
  {
    WL_POPN(2);
    Term _x_206 = STK(0);
    Term _h_194 = STK(1);
    Term _h_195 = r0;
    WL_OPEN
    u64 _nd_50 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_50 + 0] = _x_206;
    e.mem[_nd_50 + 1] = _h_194;
    e.mem[_nd_50 + 2] = _h_195;
    r0 = term_clo(FID_MAIN_C2593, _nd_50);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2593)
  {
    Term _x_207 = r0;
    Term _h_196 = r1;
    Term _h_197 = r2;
    Term _x_208 = r3;
    WL_OPEN
    u64 _nd_51 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_51 + 0] = _h_197;
    u64 _nd_52 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_52 + 0] = _x_207;
    e.mem[_nd_52 + 1] = _h_196;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_223 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_223 + 0] = term_clo(FID_MAIN_C2594, _nd_51);
      e.mem[_t_223 + 1] = term_clo(FID_MAIN_C2595, _nd_52);
      e.mem[_t_223 + 2] = _x_208;
      return term_tsk(FID_IO_BIND, _t_223);
    }
    r0 = term_clo(FID_MAIN_C2594, _nd_51);
    r1 = term_clo(FID_MAIN_C2595, _nd_52);
    r2 = _x_208;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2594)
  {
    Term _h_198 = r0;
    Term _x_209 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_95 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_95 + 0] = _h_198;
      e.mem[_t_95 + 1] = _x_209;
      return term_tsk(FID_IO_PURE, _t_95);
    }
    r0 = _h_198;
    r1 = _x_209;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2595)
  {
    Term _x_210 = r0;
    Term _h_199 = r1;
    Term _x_211 = r2;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _x_210;
      STK(1) = FID_MAIN_K2596;
      WL_PUSHN(2);
    } else {
      u64 _t_96 = task_node(e, FID_MAIN_K2596, WL_CONT, WL_IDX, 1);
      e.mem[_t_96 + 0] = _x_210;
      WL_CONT = term_tsk(FID_MAIN_K2596, _t_96);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_97 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_97 + 0] = _h_199;
      e.mem[_t_97 + 1] = _x_211;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_97);
    }
    r0 = _h_199;
    r1 = _x_211;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2596)
  {
    WL_POPN(1);
    Term _x_212 = STK(0);
    Term _h_200 = r0;
    WL_OPEN
    _x_212 = term_keep(e, _x_212);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _x_212;
      STK(1) = _h_200;
      STK(2) = FID_MAIN_K2597;
      WL_PUSHN(3);
    } else {
      u64 _t_98 = task_node(e, FID_MAIN_K2597, WL_CONT, WL_IDX, 1);
      e.mem[_t_98 + 0] = _x_212;
      e.mem[_t_98 + 1] = _h_200;
      WL_CONT = term_tsk(FID_MAIN_K2597, _t_98);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID_HEAD_OF)) {
      u64 _t_99 = task_node(e, FID_HEAD_OF, WL_CONT, WL_IDX, 0);
      e.mem[_t_99 + 0] = _x_212;
      return term_tsk(FID_HEAD_OF, _t_99);
    }
    r0 = _x_212;
    WL_JMP(FID_HEAD_OF);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2597)
  {
    WL_POPN(2);
    Term _x_213 = STK(0);
    Term _h_201 = STK(1);
    Term _h_202 = r0;
    WL_OPEN
    u64 _nd_53 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_53 + 0] = _x_213;
    e.mem[_nd_53 + 1] = _h_201;
    e.mem[_nd_53 + 2] = _h_202;
    r0 = term_clo(FID_MAIN_C2598, _nd_53);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2598)
  {
    Term _x_214 = r0;
    Term _h_203 = r1;
    Term _h_204 = r2;
    Term _x_215 = r3;
    WL_OPEN
    u64 _nd_54 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_54 + 0] = _x_214;
    e.mem[_nd_54 + 1] = _h_203;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_222 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_222 + 0] = _h_204;
      e.mem[_t_222 + 1] = term_clo(FID_MAIN_C2599, _nd_54);
      e.mem[_t_222 + 2] = _x_215;
      return term_tsk(FID_IO_BIND, _t_222);
    }
    r0 = _h_204;
    r1 = term_clo(FID_MAIN_C2599, _nd_54);
    r2 = _x_215;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2599)
  {
    Term _x_216 = r0;
    Term _h_205 = r1;
    Term _x_217 = r2;
    WL_OPEN
    _x_216 = term_keep(e, _x_216);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _x_216;
      STK(1) = _h_205;
      STK(2) = _x_217;
      STK(3) = FID_MAIN_K2600;
      WL_PUSHN(4);
    } else {
      u64 _t_100 = task_node(e, FID_MAIN_K2600, WL_CONT, WL_IDX, 1);
      e.mem[_t_100 + 0] = _x_216;
      e.mem[_t_100 + 1] = _h_205;
      e.mem[_t_100 + 2] = _x_217;
      WL_CONT = term_tsk(FID_MAIN_K2600, _t_100);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID_HEAD_OF_BRANCH)) {
      u64 _t_101 = task_node(e, FID_HEAD_OF_BRANCH, WL_CONT, WL_IDX, 0);
      e.mem[_t_101 + 0] = _x_216;
      e.mem[_t_101 + 1] = term_ctr(CID_SCON, STAT_OFF + 1557);
      return term_tsk(FID_HEAD_OF_BRANCH, _t_101);
    }
    r0 = _x_216;
    r1 = term_ctr(CID_SCON, STAT_OFF + 1557);
    WL_JMP(FID_HEAD_OF_BRANCH);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2600)
  {
    WL_POPN(3);
    Term _x_218 = STK(0);
    Term _h_206 = STK(1);
    Term _x_219 = STK(2);
    Term _h_207 = r0;
    WL_OPEN
    u64 _nd_55 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_55 + 0] = _x_218;
    e.mem[_nd_55 + 1] = _h_206;
    e.mem[_nd_55 + 2] = _x_219;
    e.mem[_nd_55 + 3] = _h_207;
    r0 = term_clo(FID_MAIN_C2601, _nd_55);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2601)
  {
    Term _x_220 = r0;
    Term _h_208 = r1;
    Term _x_221 = r2;
    Term _h_209 = r3;
    Term _x_222 = r4;
    WL_OPEN
    u64 _nd_56 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_56 + 0] = _x_220;
    e.mem[_nd_56 + 1] = _h_208;
    e.mem[_nd_56 + 2] = _x_221;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_221 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_221 + 0] = _h_209;
      e.mem[_t_221 + 1] = term_clo(FID_MAIN_C2602, _nd_56);
      e.mem[_t_221 + 2] = _x_222;
      return term_tsk(FID_IO_BIND, _t_221);
    }
    r0 = _h_209;
    r1 = term_clo(FID_MAIN_C2602, _nd_56);
    r2 = _x_222;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2602)
  {
    Term _x_223 = r0;
    Term _h_210 = r1;
    Term _x_224 = r2;
    Term _x_225 = r3;
    WL_OPEN
    _x_223 = term_keep(e, _x_223);
    if (seq) {
      WL_ROOM(5);
      STK(0) = _x_223;
      STK(1) = _h_210;
      STK(2) = _x_224;
      STK(3) = _x_225;
      STK(4) = FID_MAIN_K2603;
      WL_PUSHN(5);
    } else {
      u64 _t_102 = task_node(e, FID_MAIN_K2603, WL_CONT, WL_IDX, 1);
      e.mem[_t_102 + 0] = _x_223;
      e.mem[_t_102 + 1] = _h_210;
      e.mem[_t_102 + 2] = _x_224;
      e.mem[_t_102 + 3] = _x_225;
      WL_CONT = term_tsk(FID_MAIN_K2603, _t_102);
      WL_IDX = 4;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_103 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_103 + 0] = _x_223;
      e.mem[_t_103 + 1] = term_ctr(CID_SCON, STAT_OFF + 1585);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_103);
    }
    r0 = _x_223;
    r1 = term_ctr(CID_SCON, STAT_OFF + 1585);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2603)
  {
    WL_POPN(4);
    Term _x_226 = STK(0);
    Term _h_211 = STK(1);
    Term _x_227 = STK(2);
    Term _x_228 = STK(3);
    Term _h_212 = r0;
    WL_OPEN
    _x_226 = term_keep(e, _x_226);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _x_226;
      STK(1) = _h_211;
      STK(2) = _x_228;
      STK(3) = FID_MAIN_K2604;
      WL_PUSHN(4);
    } else {
      u64 _t_104 = task_node(e, FID_MAIN_K2604, WL_CONT, WL_IDX, 1);
      e.mem[_t_104 + 0] = _x_226;
      e.mem[_t_104 + 1] = _h_211;
      e.mem[_t_104 + 2] = _x_228;
      WL_CONT = term_tsk(FID_MAIN_K2604, _t_104);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID_AUTHOR)) {
      u64 _t_105 = task_node(e, FID_AUTHOR, WL_CONT, WL_IDX, 0);
      e.mem[_t_105 + 0] = _x_226;
      e.mem[_t_105 + 1] = _h_212;
      e.mem[_t_105 + 2] = term_ctr(CID_SCON, STAT_OFF + 1597);
      e.mem[_t_105 + 3] = _x_227;
      e.mem[_t_105 + 4] = term_ctr(CID_SCON, STAT_OFF + 1645);
      return term_tsk(FID_AUTHOR, _t_105);
    }
    r0 = _x_226;
    r1 = _h_212;
    r2 = term_ctr(CID_SCON, STAT_OFF + 1597);
    r3 = _x_227;
    r4 = term_ctr(CID_SCON, STAT_OFF + 1645);
    WL_JMP(FID_AUTHOR);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2604)
  {
    WL_POPN(3);
    Term _x_229 = STK(0);
    Term _h_213 = STK(1);
    Term _x_230 = STK(2);
    Term _h_214 = r0;
    WL_OPEN
    u64 _nd_57 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_57 + 0] = _x_229;
    e.mem[_nd_57 + 1] = _h_213;
    e.mem[_nd_57 + 2] = _x_230;
    e.mem[_nd_57 + 3] = _h_214;
    r0 = term_clo(FID_MAIN_C2605, _nd_57);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2605)
  {
    Term _x_231 = r0;
    Term _h_215 = r1;
    Term _x_232 = r2;
    Term _h_216 = r3;
    Term _x_233 = r4;
    WL_OPEN
    u64 _nd_58 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_58 + 0] = _x_231;
    e.mem[_nd_58 + 1] = _h_215;
    e.mem[_nd_58 + 2] = _x_232;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_220 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_220 + 0] = _h_216;
      e.mem[_t_220 + 1] = term_clo(FID_MAIN_C2606, _nd_58);
      e.mem[_t_220 + 2] = _x_233;
      return term_tsk(FID_IO_BIND, _t_220);
    }
    r0 = _h_216;
    r1 = term_clo(FID_MAIN_C2606, _nd_58);
    r2 = _x_233;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2606)
  {
    Term _x_234 = r0;
    Term _h_217 = r1;
    Term _x_235 = r2;
    Term _x_236 = r3;
    WL_OPEN
    _x_234 = term_keep(e, _x_234);
    if (seq) {
      WL_ROOM(5);
      STK(0) = _x_234;
      STK(1) = _h_217;
      STK(2) = _x_235;
      STK(3) = _x_236;
      STK(4) = FID_MAIN_K2607;
      WL_PUSHN(5);
    } else {
      u64 _t_106 = task_node(e, FID_MAIN_K2607, WL_CONT, WL_IDX, 1);
      e.mem[_t_106 + 0] = _x_234;
      e.mem[_t_106 + 1] = _h_217;
      e.mem[_t_106 + 2] = _x_235;
      e.mem[_t_106 + 3] = _x_236;
      WL_CONT = term_tsk(FID_MAIN_K2607, _t_106);
      WL_IDX = 4;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_107 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_107 + 0] = _x_234;
      e.mem[_t_107 + 1] = term_ctr(CID_SCON, STAT_OFF + 1673);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_107);
    }
    r0 = _x_234;
    r1 = term_ctr(CID_SCON, STAT_OFF + 1673);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2607)
  {
    WL_POPN(4);
    Term _x_237 = STK(0);
    Term _h_218 = STK(1);
    Term _x_238 = STK(2);
    Term _x_239 = STK(3);
    Term _h_219 = r0;
    WL_OPEN
    _x_237 = term_keep(e, _x_237);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _x_237;
      STK(1) = _h_218;
      STK(2) = _x_238;
      STK(3) = FID_MAIN_K2608;
      WL_PUSHN(4);
    } else {
      u64 _t_108 = task_node(e, FID_MAIN_K2608, WL_CONT, WL_IDX, 1);
      e.mem[_t_108 + 0] = _x_237;
      e.mem[_t_108 + 1] = _h_218;
      e.mem[_t_108 + 2] = _x_238;
      WL_CONT = term_tsk(FID_MAIN_K2608, _t_108);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID_LAND_OK)) {
      u64 _t_109 = task_node(e, FID_LAND_OK, WL_CONT, WL_IDX, 0);
      e.mem[_t_109 + 0] = _x_237;
      e.mem[_t_109 + 1] = term_ctr(CID_SCON, STAT_OFF + 663);
      e.mem[_t_109 + 2] = _x_239;
      e.mem[_t_109 + 3] = term_ctr(CID_CON, STAT_OFF + 1675);
      e.mem[_t_109 + 4] = term_ctr(CID_SCON, STAT_OFF + 1695);
      e.mem[_t_109 + 5] = _h_219;
      return term_tsk(FID_LAND_OK, _t_109);
    }
    r0 = _x_237;
    r1 = term_ctr(CID_SCON, STAT_OFF + 663);
    r2 = _x_239;
    r3 = term_ctr(CID_CON, STAT_OFF + 1675);
    r4 = term_ctr(CID_SCON, STAT_OFF + 1695);
    r5 = _h_219;
    WL_JMP(FID_LAND_OK);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2608)
  {
    WL_POPN(3);
    Term _x_240 = STK(0);
    Term _h_220 = STK(1);
    Term _x_241 = STK(2);
    Term _h_221 = r0;
    WL_OPEN
    u64 _nd_59 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_59 + 0] = _x_240;
    e.mem[_nd_59 + 1] = _h_220;
    e.mem[_nd_59 + 2] = _x_241;
    e.mem[_nd_59 + 3] = _h_221;
    r0 = term_clo(FID_MAIN_C2609, _nd_59);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2609)
  {
    Term _x_242 = r0;
    Term _h_222 = r1;
    Term _x_243 = r2;
    Term _h_223 = r3;
    Term _x_244 = r4;
    WL_OPEN
    u64 _nd_60 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_60 + 0] = _x_242;
    e.mem[_nd_60 + 1] = _h_222;
    e.mem[_nd_60 + 2] = _x_243;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_219 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_219 + 0] = _h_223;
      e.mem[_t_219 + 1] = term_clo(FID_MAIN_C2610, _nd_60);
      e.mem[_t_219 + 2] = _x_244;
      return term_tsk(FID_IO_BIND, _t_219);
    }
    r0 = _h_223;
    r1 = term_clo(FID_MAIN_C2610, _nd_60);
    r2 = _x_244;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2610)
  {
    Term _x_245 = r0;
    Term _h_224 = r1;
    Term _x_246 = r2;
    Term _x_247 = r3;
    WL_OPEN
    u32 _o_118 = 0;
    u32 _o_119 = 0;
    Term _o_120 = 0;
    Term _o_121 = 0;
    if (term_aux(_x_247) == CID_FAIL) {
      _o_118 = 0;
      Term _fb_11[1];
      u64 _sp_57 = ctr_take(e, _x_247, 1, _fb_11);
      Term _f_74 = _fb_11[0];
      spare_free(e, cls_fit(1), _sp_57);
      u32 _o_122 = 0;
      Term _o_123 = 0;
      Term _o_124 = 0;
      if (term_aux(_f_74) == CID____SRC_GIT_TYPES_FBRANCHEXISTS) {
        _o_122 = 0;
        u64 _sp_58 = term_loc(_f_74);
        Term _f_75 = e.mem[_sp_58 + 0];
        heap_free(e, cls_fit(1), _sp_58);
        _o_123 = _f_75;
      } else if (term_aux(_f_74) == CID____SRC_GIT_TYPES_FPATHEXISTS) {
        _o_122 = 1;
        u64 _sp_59 = term_loc(_f_74);
        Term _f_76 = e.mem[_sp_59 + 0];
        heap_free(e, cls_fit(1), _sp_59);
        _o_123 = _f_76;
      } else if (term_aux(_f_74) == CID____SRC_GIT_TYPES_FUNKNOWNBASE) {
        _o_122 = 2;
        u64 _sp_60 = term_loc(_f_74);
        Term _f_77 = e.mem[_sp_60 + 0];
        heap_free(e, cls_fit(1), _sp_60);
        _o_123 = _f_77;
      } else if (term_aux(_f_74) == CID____SRC_GIT_TYPES_FTARGETBUSY) {
        _o_122 = 3;
        u64 _sp_61 = term_loc(_f_74);
        Term _f_78 = e.mem[_sp_61 + 0];
        heap_free(e, cls_fit(1), _sp_61);
        _o_123 = _f_78;
      } else {
        _o_122 = 4;
        Term _fb_12[2];
        u64 _sp_62 = ctr_take(e, _f_74, 2, _fb_12);
        Term _f_79 = _fb_12[0];
        Term _f_80 = _fb_12[1];
        spare_free(e, cls_fit(2), _sp_62);
        _o_123 = _f_79;
        _o_124 = _f_80;
      }
      _o_119 = _o_122;
      _o_120 = _o_123;
      _o_121 = _o_124;
    } else {
      _o_118 = 1;
      u64 _sp_63 = term_loc(_x_247);
      Term _f_81 = e.mem[_sp_63 + 0];
      heap_free(e, cls_fit(1), _sp_63);
      u32 _o_125 = 0;
      Term _o_126 = 0;
      Term _o_127 = 0;
      if (term_aux(_f_81) == CID____SRC_GIT_TYPES_LLANDED) {
        _o_125 = 0;
        u64 _sp_64 = term_loc(_f_81);
        Term _f_82 = e.mem[_sp_64 + 0];
        Term _f_83 = e.mem[_sp_64 + 1];
        heap_free(e, cls_fit(2), _sp_64);
        _o_126 = _f_82;
        _o_127 = _f_83;
      } else if (term_aux(_f_81) == CID____SRC_GIT_TYPES_LALREADY) {
        _o_125 = 1;
        u64 _sp_65 = term_loc(_f_81);
        Term _f_84 = e.mem[_sp_65 + 0];
        heap_free(e, cls_fit(1), _sp_65);
        _o_126 = _f_84;
      } else if (term_aux(_f_81) == CID____SRC_GIT_TYPES_LCONFLICT) {
        _o_125 = 2;
        u64 _sp_66 = term_loc(_f_81);
        Term _f_85 = e.mem[_sp_66 + 0];
        Term _f_86 = e.mem[_sp_66 + 1];
        heap_free(e, cls_fit(2), _sp_66);
        _o_126 = _f_85;
        _o_127 = _f_86;
      } else {
        _o_125 = 3;
        u64 _sp_67 = term_loc(_f_81);
        Term _f_87 = e.mem[_sp_67 + 0];
        heap_free(e, cls_fit(1), _sp_67);
        _o_126 = _f_87;
      }
      _o_119 = _o_125;
      _o_120 = _o_126;
      _o_121 = _o_127;
    }
    _x_245 = term_keep(e, _x_245);
    if (seq) {
      WL_ROOM(8);
      STK(0) = _x_245;
      STK(1) = _h_224;
      STK(2) = _x_246;
      STK(3) = _o_118;
      STK(4) = _o_119;
      STK(5) = _o_120;
      STK(6) = _o_121;
      STK(7) = FID_MAIN_K2611;
      WL_PUSHN(8);
    } else {
      u64 _t_110 = task_node(e, FID_MAIN_K2611, WL_CONT, WL_IDX, 1);
      e.mem[_t_110 + 0] = _x_245;
      e.mem[_t_110 + 1] = _h_224;
      e.mem[_t_110 + 2] = _x_246;
      e.mem[_t_110 + 3] = _o_118;
      e.mem[_t_110 + 4] = _o_119;
      e.mem[_t_110 + 5] = _o_120;
      e.mem[_t_110 + 6] = _o_121;
      WL_CONT = term_tsk(FID_MAIN_K2611, _t_110);
      WL_IDX = 7;
    }
    if (!DEVICE && !seq && fid_nofk(FID_HEAD_OF)) {
      u64 _t_111 = task_node(e, FID_HEAD_OF, WL_CONT, WL_IDX, 0);
      e.mem[_t_111 + 0] = _x_245;
      return term_tsk(FID_HEAD_OF, _t_111);
    }
    r0 = _x_245;
    WL_JMP(FID_HEAD_OF);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2611)
  {
    WL_POPN(7);
    Term _x_248 = STK(0);
    Term _h_225 = STK(1);
    Term _x_249 = STK(2);
    u32 _o_128 = STK(3);
    u32 _o_129 = STK(4);
    Term _o_130 = STK(5);
    Term _o_131 = STK(6);
    Term _h_226 = r0;
    WL_OPEN
    u64 _nd_61 = heap_alloc(e, cls_fit(8));
    e.mem[_nd_61 + 0] = _x_248;
    e.mem[_nd_61 + 1] = _h_225;
    e.mem[_nd_61 + 2] = _x_249;
    e.mem[_nd_61 + 3] = _o_128;
    e.mem[_nd_61 + 4] = _o_129;
    e.mem[_nd_61 + 5] = _o_130;
    e.mem[_nd_61 + 6] = _o_131;
    e.mem[_nd_61 + 7] = _h_226;
    r0 = term_clo(FID_MAIN_C2612, _nd_61);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2612)
  {
    Term _x_250 = r0;
    Term _h_227 = r1;
    Term _x_251 = r2;
    u32 _o_132 = r3;
    u32 _o_133 = r4;
    Term _o_134 = r5;
    Term _o_135 = r6;
    Term _h_228 = r7;
    Term _x_252 = r8;
    WL_OPEN
    u64 _nd_62 = heap_alloc(e, cls_fit(7));
    e.mem[_nd_62 + 0] = _x_250;
    e.mem[_nd_62 + 1] = _h_227;
    e.mem[_nd_62 + 2] = _x_251;
    e.mem[_nd_62 + 3] = _o_132;
    e.mem[_nd_62 + 4] = _o_133;
    e.mem[_nd_62 + 5] = _o_134;
    e.mem[_nd_62 + 6] = _o_135;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_218 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_218 + 0] = _h_228;
      e.mem[_t_218 + 1] = term_clo(FID_MAIN_C2613, _nd_62);
      e.mem[_t_218 + 2] = _x_252;
      return term_tsk(FID_IO_BIND, _t_218);
    }
    r0 = _h_228;
    r1 = term_clo(FID_MAIN_C2613, _nd_62);
    r2 = _x_252;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2613)
  {
    Term _x_253 = r0;
    Term _h_229 = r1;
    Term _x_254 = r2;
    u32 _o_136 = r3;
    u32 _o_137 = r4;
    Term _o_138 = r5;
    Term _o_139 = r6;
    Term _x_255 = r7;
    WL_OPEN
    _x_253 = term_keep(e, _x_253);
    if (seq) {
      WL_ROOM(9);
      STK(0) = _x_253;
      STK(1) = _h_229;
      STK(2) = _x_254;
      STK(3) = _o_136;
      STK(4) = _o_137;
      STK(5) = _o_138;
      STK(6) = _o_139;
      STK(7) = _x_255;
      STK(8) = FID_MAIN_K2614;
      WL_PUSHN(9);
    } else {
      u64 _t_112 = task_node(e, FID_MAIN_K2614, WL_CONT, WL_IDX, 1);
      e.mem[_t_112 + 0] = _x_253;
      e.mem[_t_112 + 1] = _h_229;
      e.mem[_t_112 + 2] = _x_254;
      e.mem[_t_112 + 3] = _o_136;
      e.mem[_t_112 + 4] = _o_137;
      e.mem[_t_112 + 5] = _o_138;
      e.mem[_t_112 + 6] = _o_139;
      e.mem[_t_112 + 7] = _x_255;
      WL_CONT = term_tsk(FID_MAIN_K2614, _t_112);
      WL_IDX = 8;
    }
    if (!DEVICE && !seq && fid_nofk(FID_PARENT_OF)) {
      u64 _t_113 = task_node(e, FID_PARENT_OF, WL_CONT, WL_IDX, 0);
      e.mem[_t_113 + 0] = _x_253;
      return term_tsk(FID_PARENT_OF, _t_113);
    }
    r0 = _x_253;
    WL_JMP(FID_PARENT_OF);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2614)
  {
    WL_POPN(8);
    Term _x_256 = STK(0);
    Term _h_230 = STK(1);
    Term _x_257 = STK(2);
    u32 _o_140 = STK(3);
    u32 _o_141 = STK(4);
    Term _o_142 = STK(5);
    Term _o_143 = STK(6);
    Term _x_258 = STK(7);
    Term _h_231 = r0;
    WL_OPEN
    u64 _nd_63 = heap_alloc(e, cls_fit(9));
    e.mem[_nd_63 + 0] = _x_256;
    e.mem[_nd_63 + 1] = _h_230;
    e.mem[_nd_63 + 2] = _x_257;
    e.mem[_nd_63 + 3] = _o_140;
    e.mem[_nd_63 + 4] = _o_141;
    e.mem[_nd_63 + 5] = _o_142;
    e.mem[_nd_63 + 6] = _o_143;
    e.mem[_nd_63 + 7] = _x_258;
    e.mem[_nd_63 + 8] = _h_231;
    r0 = term_clo(FID_MAIN_C2615, _nd_63);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2615)
  {
    Term _x_259 = r0;
    Term _h_232 = r1;
    Term _x_260 = r2;
    u32 _o_144 = r3;
    u32 _o_145 = r4;
    Term _o_146 = r5;
    Term _o_147 = r6;
    Term _x_261 = r7;
    Term _h_233 = r8;
    Term _x_262 = r9;
    WL_OPEN
    u64 _nd_64 = heap_alloc(e, cls_fit(8));
    e.mem[_nd_64 + 0] = _x_259;
    e.mem[_nd_64 + 1] = _h_232;
    e.mem[_nd_64 + 2] = _x_260;
    e.mem[_nd_64 + 3] = _o_144;
    e.mem[_nd_64 + 4] = _o_145;
    e.mem[_nd_64 + 5] = _o_146;
    e.mem[_nd_64 + 6] = _o_147;
    e.mem[_nd_64 + 7] = _x_261;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_217 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_217 + 0] = _h_233;
      e.mem[_t_217 + 1] = term_clo(FID_MAIN_C2616, _nd_64);
      e.mem[_t_217 + 2] = _x_262;
      return term_tsk(FID_IO_BIND, _t_217);
    }
    r0 = _h_233;
    r1 = term_clo(FID_MAIN_C2616, _nd_64);
    r2 = _x_262;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2616)
  {
    Term _x_263 = r0;
    Term _h_234 = r1;
    Term _x_264 = r2;
    u32 _o_148 = r3;
    u32 _o_149 = r4;
    Term _o_150 = r5;
    Term _o_151 = r6;
    Term _x_265 = r7;
    Term _x_266 = r8;
    WL_OPEN
    _x_263 = term_keep(e, _x_263);
    if (seq) {
      WL_ROOM(10);
      STK(0) = _x_263;
      STK(1) = _h_234;
      STK(2) = _x_264;
      STK(3) = _o_148;
      STK(4) = _o_149;
      STK(5) = _o_150;
      STK(6) = _o_151;
      STK(7) = _x_265;
      STK(8) = _x_266;
      STK(9) = FID_MAIN_K2617;
      WL_PUSHN(10);
    } else {
      u64 _t_114 = task_node(e, FID_MAIN_K2617, WL_CONT, WL_IDX, 1);
      e.mem[_t_114 + 0] = _x_263;
      e.mem[_t_114 + 1] = _h_234;
      e.mem[_t_114 + 2] = _x_264;
      e.mem[_t_114 + 3] = _o_148;
      e.mem[_t_114 + 4] = _o_149;
      e.mem[_t_114 + 5] = _o_150;
      e.mem[_t_114 + 6] = _o_151;
      e.mem[_t_114 + 7] = _x_265;
      e.mem[_t_114 + 8] = _x_266;
      WL_CONT = term_tsk(FID_MAIN_K2617, _t_114);
      WL_IDX = 9;
    }
    if (!DEVICE && !seq && fid_nofk(FID_BLOB_OF)) {
      u64 _t_115 = task_node(e, FID_BLOB_OF, WL_CONT, WL_IDX, 0);
      e.mem[_t_115 + 0] = _x_263;
      e.mem[_t_115 + 1] = term_ctr(CID_SCON, STAT_OFF + 1705);
      return term_tsk(FID_BLOB_OF, _t_115);
    }
    r0 = _x_263;
    r1 = term_ctr(CID_SCON, STAT_OFF + 1705);
    WL_JMP(FID_BLOB_OF);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2617)
  {
    WL_POPN(9);
    Term _x_267 = STK(0);
    Term _h_235 = STK(1);
    Term _x_268 = STK(2);
    u32 _o_152 = STK(3);
    u32 _o_153 = STK(4);
    Term _o_154 = STK(5);
    Term _o_155 = STK(6);
    Term _x_269 = STK(7);
    Term _x_270 = STK(8);
    Term _h_236 = r0;
    WL_OPEN
    u64 _nd_65 = heap_alloc(e, cls_fit(10));
    e.mem[_nd_65 + 0] = _x_267;
    e.mem[_nd_65 + 1] = _h_235;
    e.mem[_nd_65 + 2] = _x_268;
    e.mem[_nd_65 + 3] = _o_152;
    e.mem[_nd_65 + 4] = _o_153;
    e.mem[_nd_65 + 5] = _o_154;
    e.mem[_nd_65 + 6] = _o_155;
    e.mem[_nd_65 + 7] = _x_269;
    e.mem[_nd_65 + 8] = _x_270;
    e.mem[_nd_65 + 9] = _h_236;
    r0 = term_clo(FID_MAIN_C2618, _nd_65);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2618)
  {
    Term _x_271 = r0;
    Term _h_237 = r1;
    Term _x_272 = r2;
    u32 _o_156 = r3;
    u32 _o_157 = r4;
    Term _o_158 = r5;
    Term _o_159 = r6;
    Term _x_273 = r7;
    Term _x_274 = r8;
    Term _h_238 = r9;
    Term _x_275 = r10;
    WL_OPEN
    u64 _nd_66 = heap_alloc(e, cls_fit(9));
    e.mem[_nd_66 + 0] = _x_271;
    e.mem[_nd_66 + 1] = _h_237;
    e.mem[_nd_66 + 2] = _x_272;
    e.mem[_nd_66 + 3] = _o_156;
    e.mem[_nd_66 + 4] = _o_157;
    e.mem[_nd_66 + 5] = _o_158;
    e.mem[_nd_66 + 6] = _o_159;
    e.mem[_nd_66 + 7] = _x_273;
    e.mem[_nd_66 + 8] = _x_274;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_216 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_216 + 0] = _h_238;
      e.mem[_t_216 + 1] = term_clo(FID_MAIN_C2619, _nd_66);
      e.mem[_t_216 + 2] = _x_275;
      return term_tsk(FID_IO_BIND, _t_216);
    }
    r0 = _h_238;
    r1 = term_clo(FID_MAIN_C2619, _nd_66);
    r2 = _x_275;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2619)
  {
    Term _x_276 = r0;
    Term _h_239 = r1;
    Term _x_277 = r2;
    u32 _o_160 = r3;
    u32 _o_161 = r4;
    Term _o_162 = r5;
    Term _o_163 = r6;
    Term _x_278 = r7;
    Term _x_279 = r8;
    Term _x_280 = r9;
    WL_OPEN
    _x_276 = term_keep(e, _x_276);
    if (seq) {
      WL_ROOM(11);
      STK(0) = _x_276;
      STK(1) = _h_239;
      STK(2) = _x_277;
      STK(3) = _o_160;
      STK(4) = _o_161;
      STK(5) = _o_162;
      STK(6) = _o_163;
      STK(7) = _x_278;
      STK(8) = _x_279;
      STK(9) = _x_280;
      STK(10) = FID_MAIN_K2620;
      WL_PUSHN(11);
    } else {
      u64 _t_116 = task_node(e, FID_MAIN_K2620, WL_CONT, WL_IDX, 1);
      e.mem[_t_116 + 0] = _x_276;
      e.mem[_t_116 + 1] = _h_239;
      e.mem[_t_116 + 2] = _x_277;
      e.mem[_t_116 + 3] = _o_160;
      e.mem[_t_116 + 4] = _o_161;
      e.mem[_t_116 + 5] = _o_162;
      e.mem[_t_116 + 6] = _o_163;
      e.mem[_t_116 + 7] = _x_278;
      e.mem[_t_116 + 8] = _x_279;
      e.mem[_t_116 + 9] = _x_280;
      WL_CONT = term_tsk(FID_MAIN_K2620, _t_116);
      WL_IDX = 10;
    }
    if (!DEVICE && !seq && fid_nofk(FID_BLOB_OF)) {
      u64 _t_117 = task_node(e, FID_BLOB_OF, WL_CONT, WL_IDX, 0);
      e.mem[_t_117 + 0] = _x_276;
      e.mem[_t_117 + 1] = term_ctr(CID_SCON, STAT_OFF + 1607);
      return term_tsk(FID_BLOB_OF, _t_117);
    }
    r0 = _x_276;
    r1 = term_ctr(CID_SCON, STAT_OFF + 1607);
    WL_JMP(FID_BLOB_OF);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2620)
  {
    WL_POPN(10);
    Term _x_281 = STK(0);
    Term _h_240 = STK(1);
    Term _x_282 = STK(2);
    u32 _o_164 = STK(3);
    u32 _o_165 = STK(4);
    Term _o_166 = STK(5);
    Term _o_167 = STK(6);
    Term _x_283 = STK(7);
    Term _x_284 = STK(8);
    Term _x_285 = STK(9);
    Term _h_241 = r0;
    WL_OPEN
    u64 _nd_67 = heap_alloc(e, cls_fit(11));
    e.mem[_nd_67 + 0] = _x_281;
    e.mem[_nd_67 + 1] = _h_240;
    e.mem[_nd_67 + 2] = _x_282;
    e.mem[_nd_67 + 3] = _o_164;
    e.mem[_nd_67 + 4] = _o_165;
    e.mem[_nd_67 + 5] = _o_166;
    e.mem[_nd_67 + 6] = _o_167;
    e.mem[_nd_67 + 7] = _x_283;
    e.mem[_nd_67 + 8] = _x_284;
    e.mem[_nd_67 + 9] = _x_285;
    e.mem[_nd_67 + 10] = _h_241;
    r0 = term_clo(FID_MAIN_C2621, _nd_67);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2621)
  {
    Term _x_286 = r0;
    Term _h_242 = r1;
    Term _x_287 = r2;
    u32 _o_168 = r3;
    u32 _o_169 = r4;
    Term _o_170 = r5;
    Term _o_171 = r6;
    Term _x_288 = r7;
    Term _x_289 = r8;
    Term _x_290 = r9;
    Term _h_243 = r10;
    Term _x_291 = r11;
    WL_OPEN
    u64 _nd_68 = heap_alloc(e, cls_fit(10));
    e.mem[_nd_68 + 0] = _x_286;
    e.mem[_nd_68 + 1] = _h_242;
    e.mem[_nd_68 + 2] = _x_287;
    e.mem[_nd_68 + 3] = _o_168;
    e.mem[_nd_68 + 4] = _o_169;
    e.mem[_nd_68 + 5] = _o_170;
    e.mem[_nd_68 + 6] = _o_171;
    e.mem[_nd_68 + 7] = _x_288;
    e.mem[_nd_68 + 8] = _x_289;
    e.mem[_nd_68 + 9] = _x_290;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_215 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_215 + 0] = _h_243;
      e.mem[_t_215 + 1] = term_clo(FID_MAIN_C2622, _nd_68);
      e.mem[_t_215 + 2] = _x_291;
      return term_tsk(FID_IO_BIND, _t_215);
    }
    r0 = _h_243;
    r1 = term_clo(FID_MAIN_C2622, _nd_68);
    r2 = _x_291;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2622)
  {
    Term _x_292 = r0;
    Term _h_244 = r1;
    Term _x_293 = r2;
    u32 _o_172 = r3;
    u32 _o_173 = r4;
    Term _o_174 = r5;
    Term _o_175 = r6;
    Term _x_294 = r7;
    Term _x_295 = r8;
    Term _x_296 = r9;
    Term _x_297 = r10;
    WL_OPEN
    if (seq) {
      WL_ROOM(7);
      STK(0) = _x_292;
      STK(1) = _h_244;
      STK(2) = _x_293;
      STK(3) = _x_295;
      STK(4) = _x_296;
      STK(5) = _x_297;
      STK(6) = FID_MAIN_K2623;
      WL_PUSHN(7);
    } else {
      u64 _t_118 = task_node(e, FID_MAIN_K2623, WL_CONT, WL_IDX, 1);
      e.mem[_t_118 + 0] = _x_292;
      e.mem[_t_118 + 1] = _h_244;
      e.mem[_t_118 + 2] = _x_293;
      e.mem[_t_118 + 3] = _x_295;
      e.mem[_t_118 + 4] = _x_296;
      e.mem[_t_118 + 5] = _x_297;
      WL_CONT = term_tsk(FID_MAIN_K2623, _t_118);
      WL_IDX = 6;
    }
    if (!DEVICE && !seq && fid_nofk(FID_IS_LANDED)) {
      u64 _t_119 = task_node(e, FID_IS_LANDED, WL_CONT, WL_IDX, 0);
      e.mem[_t_119 + 0] = _o_172;
      e.mem[_t_119 + 1] = _o_173;
      e.mem[_t_119 + 2] = _o_174;
      e.mem[_t_119 + 3] = _o_175;
      e.mem[_t_119 + 4] = _x_294;
      return term_tsk(FID_IS_LANDED, _t_119);
    }
    r0 = _o_172;
    r1 = _o_173;
    r2 = _o_174;
    r3 = _o_175;
    r4 = _x_294;
    WL_JMP(FID_IS_LANDED);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2623)
  {
    WL_POPN(6);
    Term _x_298 = STK(0);
    Term _h_245 = STK(1);
    Term _x_299 = STK(2);
    Term _x_300 = STK(3);
    Term _x_301 = STK(4);
    Term _x_302 = STK(5);
    Term _h_246 = r0;
    WL_OPEN
    u64 _nd_69 = heap_alloc(e, cls_fit(7));
    e.mem[_nd_69 + 0] = _x_298;
    e.mem[_nd_69 + 1] = _h_245;
    e.mem[_nd_69 + 2] = _x_299;
    e.mem[_nd_69 + 3] = _x_300;
    e.mem[_nd_69 + 4] = _x_301;
    e.mem[_nd_69 + 5] = _x_302;
    e.mem[_nd_69 + 6] = _h_246;
    r0 = term_clo(FID_MAIN_C2624, _nd_69);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2624)
  {
    Term _x_303 = r0;
    Term _h_247 = r1;
    Term _x_304 = r2;
    Term _x_305 = r3;
    Term _x_306 = r4;
    Term _x_307 = r5;
    Term _h_248 = r6;
    Term _x_308 = r7;
    WL_OPEN
    u64 _nd_70 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_70 + 0] = _h_248;
    u64 _nd_71 = heap_alloc(e, cls_fit(6));
    e.mem[_nd_71 + 0] = _x_303;
    e.mem[_nd_71 + 1] = _h_247;
    e.mem[_nd_71 + 2] = _x_304;
    e.mem[_nd_71 + 3] = _x_305;
    e.mem[_nd_71 + 4] = _x_306;
    e.mem[_nd_71 + 5] = _x_307;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_214 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_214 + 0] = term_clo(FID_MAIN_C2625, _nd_70);
      e.mem[_t_214 + 1] = term_clo(FID_MAIN_C2626, _nd_71);
      e.mem[_t_214 + 2] = _x_308;
      return term_tsk(FID_IO_BIND, _t_214);
    }
    r0 = term_clo(FID_MAIN_C2625, _nd_70);
    r1 = term_clo(FID_MAIN_C2626, _nd_71);
    r2 = _x_308;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2625)
  {
    Term _h_249 = r0;
    Term _x_309 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_120 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_120 + 0] = _h_249;
      e.mem[_t_120 + 1] = _x_309;
      return term_tsk(FID_IO_PURE, _t_120);
    }
    r0 = _h_249;
    r1 = _x_309;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2626)
  {
    Term _x_310 = r0;
    Term _h_250 = r1;
    Term _x_311 = r2;
    Term _x_312 = r3;
    Term _x_313 = r4;
    Term _x_314 = r5;
    Term _x_315 = r6;
    WL_OPEN
    if (seq) {
      WL_ROOM(7);
      STK(0) = _x_310;
      STK(1) = _h_250;
      STK(2) = _x_312;
      STK(3) = _x_313;
      STK(4) = _x_314;
      STK(5) = _x_315;
      STK(6) = FID_MAIN_K2627;
      WL_PUSHN(7);
    } else {
      u64 _t_121 = task_node(e, FID_MAIN_K2627, WL_CONT, WL_IDX, 1);
      e.mem[_t_121 + 0] = _x_310;
      e.mem[_t_121 + 1] = _h_250;
      e.mem[_t_121 + 2] = _x_312;
      e.mem[_t_121 + 3] = _x_313;
      e.mem[_t_121 + 4] = _x_314;
      e.mem[_t_121 + 5] = _x_315;
      WL_CONT = term_tsk(FID_MAIN_K2627, _t_121);
      WL_IDX = 6;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_EQ)) {
      u64 _t_122 = task_node(e, FID____SRC_GIT_TEXT_STR_EQ, WL_CONT, WL_IDX, 0);
      e.mem[_t_122 + 0] = _x_312;
      e.mem[_t_122 + 1] = _x_311;
      return term_tsk(FID____SRC_GIT_TEXT_STR_EQ, _t_122);
    }
    r0 = _x_312;
    r1 = _x_311;
    WL_JMP(FID____SRC_GIT_TEXT_STR_EQ);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2627)
  {
    WL_POPN(6);
    Term _x_316 = STK(0);
    Term _h_251 = STK(1);
    Term _x_317 = STK(2);
    Term _x_318 = STK(3);
    Term _x_319 = STK(4);
    Term _x_320 = STK(5);
    u32 _h_252 = r0;
    WL_OPEN
    term_sink(e, _x_317);
    u64 _nd_72 = heap_alloc(e, cls_fit(6));
    e.mem[_nd_72 + 0] = _x_316;
    e.mem[_nd_72 + 1] = _h_251;
    e.mem[_nd_72 + 2] = _x_318;
    e.mem[_nd_72 + 3] = _x_319;
    e.mem[_nd_72 + 4] = _x_320;
    e.mem[_nd_72 + 5] = _h_252;
    r0 = term_clo(FID_MAIN_C2628, _nd_72);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2628)
  {
    Term _x_321 = r0;
    Term _h_253 = r1;
    Term _x_322 = r2;
    Term _x_323 = r3;
    Term _x_324 = r4;
    u32 _h_254 = r5;
    Term _x_325 = r6;
    WL_OPEN
    u64 _nd_73 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_73 + 0] = _h_254;
    u64 _nd_74 = heap_alloc(e, cls_fit(5));
    e.mem[_nd_74 + 0] = _x_321;
    e.mem[_nd_74 + 1] = _h_253;
    e.mem[_nd_74 + 2] = _x_322;
    e.mem[_nd_74 + 3] = _x_323;
    e.mem[_nd_74 + 4] = _x_324;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_213 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_213 + 0] = term_clo(FID_MAIN_C2629, _nd_73);
      e.mem[_t_213 + 1] = term_clo(FID_MAIN_C2630, _nd_74);
      e.mem[_t_213 + 2] = _x_325;
      return term_tsk(FID_IO_BIND, _t_213);
    }
    r0 = term_clo(FID_MAIN_C2629, _nd_73);
    r1 = term_clo(FID_MAIN_C2630, _nd_74);
    r2 = _x_325;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2629)
  {
    u32 _h_255 = r0;
    Term _x_326 = r1;
    WL_OPEN
    Term _v_9 = 0;
    Term _v_10 = 0;
    Term _o_176[1];
    if (spin_45(e, _o_176, _h_255, term_ctr(CID_SCON, STAT_OFF + 1747)) == 0) {
      return 0;
    }
    _v_10 = _o_176[0];
    _v_9 = _v_10;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_123 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_123 + 0] = _v_9;
      e.mem[_t_123 + 1] = _x_326;
      return term_tsk(FID_IO_PURE, _t_123);
    }
    r0 = _v_9;
    r1 = _x_326;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2630)
  {
    Term _x_327 = r0;
    Term _h_256 = r1;
    Term _x_328 = r2;
    Term _x_329 = r3;
    Term _x_330 = r4;
    Term _x_331 = r5;
    WL_OPEN
    if (seq) {
      WL_ROOM(7);
      STK(0) = _x_327;
      STK(1) = _h_256;
      STK(2) = _x_328;
      STK(3) = _x_329;
      STK(4) = _x_330;
      STK(5) = _x_331;
      STK(6) = FID_MAIN_K2631;
      WL_PUSHN(7);
    } else {
      u64 _t_124 = task_node(e, FID_MAIN_K2631, WL_CONT, WL_IDX, 1);
      e.mem[_t_124 + 0] = _x_327;
      e.mem[_t_124 + 1] = _h_256;
      e.mem[_t_124 + 2] = _x_328;
      e.mem[_t_124 + 3] = _x_329;
      e.mem[_t_124 + 4] = _x_330;
      e.mem[_t_124 + 5] = _x_331;
      WL_CONT = term_tsk(FID_MAIN_K2631, _t_124);
      WL_IDX = 6;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_EQ)) {
      u64 _t_125 = task_node(e, FID____SRC_GIT_TEXT_STR_EQ, WL_CONT, WL_IDX, 0);
      e.mem[_t_125 + 0] = _x_328;
      e.mem[_t_125 + 1] = term_ctr(CID_SCON, STAT_OFF + 1753);
      return term_tsk(FID____SRC_GIT_TEXT_STR_EQ, _t_125);
    }
    r0 = _x_328;
    r1 = term_ctr(CID_SCON, STAT_OFF + 1753);
    WL_JMP(FID____SRC_GIT_TEXT_STR_EQ);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2631)
  {
    WL_POPN(6);
    Term _x_332 = STK(0);
    Term _h_257 = STK(1);
    Term _x_333 = STK(2);
    Term _x_334 = STK(3);
    Term _x_335 = STK(4);
    Term _x_336 = STK(5);
    u32 _h_258 = r0;
    WL_OPEN
    term_sink(e, _x_333);
    u64 _nd_75 = heap_alloc(e, cls_fit(6));
    e.mem[_nd_75 + 0] = _x_332;
    e.mem[_nd_75 + 1] = _h_257;
    e.mem[_nd_75 + 2] = _x_334;
    e.mem[_nd_75 + 3] = _x_335;
    e.mem[_nd_75 + 4] = _x_336;
    e.mem[_nd_75 + 5] = _h_258;
    r0 = term_clo(FID_MAIN_C2632, _nd_75);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2632)
  {
    Term _x_337 = r0;
    Term _h_259 = r1;
    Term _x_338 = r2;
    Term _x_339 = r3;
    Term _x_340 = r4;
    u32 _h_260 = r5;
    Term _x_341 = r6;
    WL_OPEN
    u64 _nd_76 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_76 + 0] = _h_260;
    u64 _nd_77 = heap_alloc(e, cls_fit(5));
    e.mem[_nd_77 + 0] = _x_337;
    e.mem[_nd_77 + 1] = _h_259;
    e.mem[_nd_77 + 2] = _x_338;
    e.mem[_nd_77 + 3] = _x_339;
    e.mem[_nd_77 + 4] = _x_340;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_212 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_212 + 0] = term_clo(FID_MAIN_C2633, _nd_76);
      e.mem[_t_212 + 1] = term_clo(FID_MAIN_C2634, _nd_77);
      e.mem[_t_212 + 2] = _x_341;
      return term_tsk(FID_IO_BIND, _t_212);
    }
    r0 = term_clo(FID_MAIN_C2633, _nd_76);
    r1 = term_clo(FID_MAIN_C2634, _nd_77);
    r2 = _x_341;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2633)
  {
    u32 _h_261 = r0;
    Term _x_342 = r1;
    WL_OPEN
    Term _v_11 = 0;
    Term _v_12 = 0;
    Term _o_177[1];
    if (spin_45(e, _o_177, _h_261, term_ctr(CID_SCON, STAT_OFF + 1817)) == 0) {
      return 0;
    }
    _v_12 = _o_177[0];
    _v_11 = _v_12;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_126 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_126 + 0] = _v_11;
      e.mem[_t_126 + 1] = _x_342;
      return term_tsk(FID_IO_PURE, _t_126);
    }
    r0 = _v_11;
    r1 = _x_342;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2634)
  {
    Term _x_343 = r0;
    Term _h_262 = r1;
    Term _x_344 = r2;
    Term _x_345 = r3;
    Term _x_346 = r4;
    Term _x_347 = r5;
    WL_OPEN
    if (seq) {
      WL_ROOM(7);
      STK(0) = _x_343;
      STK(1) = _h_262;
      STK(2) = _x_344;
      STK(3) = _x_345;
      STK(4) = _x_346;
      STK(5) = _x_347;
      STK(6) = FID_MAIN_K2635;
      WL_PUSHN(7);
    } else {
      u64 _t_127 = task_node(e, FID_MAIN_K2635, WL_CONT, WL_IDX, 1);
      e.mem[_t_127 + 0] = _x_343;
      e.mem[_t_127 + 1] = _h_262;
      e.mem[_t_127 + 2] = _x_344;
      e.mem[_t_127 + 3] = _x_345;
      e.mem[_t_127 + 4] = _x_346;
      e.mem[_t_127 + 5] = _x_347;
      WL_CONT = term_tsk(FID_MAIN_K2635, _t_127);
      WL_IDX = 6;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_EQ)) {
      u64 _t_128 = task_node(e, FID____SRC_GIT_TEXT_STR_EQ, WL_CONT, WL_IDX, 0);
      e.mem[_t_128 + 0] = _x_344;
      e.mem[_t_128 + 1] = term_ctr(CID_SCON, STAT_OFF + 1825);
      return term_tsk(FID____SRC_GIT_TEXT_STR_EQ, _t_128);
    }
    r0 = _x_344;
    r1 = term_ctr(CID_SCON, STAT_OFF + 1825);
    WL_JMP(FID____SRC_GIT_TEXT_STR_EQ);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2635)
  {
    WL_POPN(6);
    Term _x_348 = STK(0);
    Term _h_263 = STK(1);
    Term _x_349 = STK(2);
    Term _x_350 = STK(3);
    Term _x_351 = STK(4);
    Term _x_352 = STK(5);
    u32 _h_264 = r0;
    WL_OPEN
    term_sink(e, _x_349);
    u64 _nd_78 = heap_alloc(e, cls_fit(6));
    e.mem[_nd_78 + 0] = _x_348;
    e.mem[_nd_78 + 1] = _h_263;
    e.mem[_nd_78 + 2] = _x_350;
    e.mem[_nd_78 + 3] = _x_351;
    e.mem[_nd_78 + 4] = _x_352;
    e.mem[_nd_78 + 5] = _h_264;
    r0 = term_clo(FID_MAIN_C2636, _nd_78);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2636)
  {
    Term _x_353 = r0;
    Term _h_265 = r1;
    Term _x_354 = r2;
    Term _x_355 = r3;
    Term _x_356 = r4;
    u32 _h_266 = r5;
    Term _x_357 = r6;
    WL_OPEN
    u64 _nd_79 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_79 + 0] = _h_266;
    u64 _nd_80 = heap_alloc(e, cls_fit(5));
    e.mem[_nd_80 + 0] = _x_353;
    e.mem[_nd_80 + 1] = _h_265;
    e.mem[_nd_80 + 2] = _x_354;
    e.mem[_nd_80 + 3] = _x_355;
    e.mem[_nd_80 + 4] = _x_356;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_211 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_211 + 0] = term_clo(FID_MAIN_C2637, _nd_79);
      e.mem[_t_211 + 1] = term_clo(FID_MAIN_C2638, _nd_80);
      e.mem[_t_211 + 2] = _x_357;
      return term_tsk(FID_IO_BIND, _t_211);
    }
    r0 = term_clo(FID_MAIN_C2637, _nd_79);
    r1 = term_clo(FID_MAIN_C2638, _nd_80);
    r2 = _x_357;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2637)
  {
    u32 _h_267 = r0;
    Term _x_358 = r1;
    WL_OPEN
    Term _v_13 = 0;
    Term _v_14 = 0;
    Term _o_178[1];
    if (spin_45(e, _o_178, _h_267, term_ctr(CID_SCON, STAT_OFF + 1851)) == 0) {
      return 0;
    }
    _v_14 = _o_178[0];
    _v_13 = _v_14;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_129 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_129 + 0] = _v_13;
      e.mem[_t_129 + 1] = _x_358;
      return term_tsk(FID_IO_PURE, _t_129);
    }
    r0 = _v_13;
    r1 = _x_358;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2638)
  {
    Term _x_359 = r0;
    Term _h_268 = r1;
    Term _x_360 = r2;
    Term _x_361 = r3;
    Term _x_362 = r4;
    Term _x_363 = r5;
    WL_OPEN
    if (seq) {
      WL_ROOM(5);
      STK(0) = _x_359;
      STK(1) = _h_268;
      STK(2) = _x_360;
      STK(3) = _x_361;
      STK(4) = FID_MAIN_K2639;
      WL_PUSHN(5);
    } else {
      u64 _t_130 = task_node(e, FID_MAIN_K2639, WL_CONT, WL_IDX, 1);
      e.mem[_t_130 + 0] = _x_359;
      e.mem[_t_130 + 1] = _h_268;
      e.mem[_t_130 + 2] = _x_360;
      e.mem[_t_130 + 3] = _x_361;
      WL_CONT = term_tsk(FID_MAIN_K2639, _t_130);
      WL_IDX = 4;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_131 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_131 + 0] = _x_362;
      e.mem[_t_131 + 1] = _x_363;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_131);
    }
    r0 = _x_362;
    r1 = _x_363;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2639)
  {
    WL_POPN(4);
    Term _x_364 = STK(0);
    Term _h_269 = STK(1);
    Term _x_365 = STK(2);
    Term _x_366 = STK(3);
    Term _h_270 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(4);
      STK(0) = _x_364;
      STK(1) = _h_269;
      STK(2) = _x_365;
      STK(3) = FID_MAIN_K2640;
      WL_PUSHN(4);
    } else {
      u64 _t_132 = task_node(e, FID_MAIN_K2640, WL_CONT, WL_IDX, 1);
      e.mem[_t_132 + 0] = _x_364;
      e.mem[_t_132 + 1] = _h_269;
      e.mem[_t_132 + 2] = _x_365;
      WL_CONT = term_tsk(FID_MAIN_K2640, _t_132);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_133 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_133 + 0] = _x_366;
      e.mem[_t_133 + 1] = _h_270;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_133);
    }
    r0 = _x_366;
    r1 = _h_270;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2640)
  {
    WL_POPN(3);
    Term _x_367 = STK(0);
    Term _h_271 = STK(1);
    Term _x_368 = STK(2);
    Term _h_272 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(3);
      STK(0) = _x_367;
      STK(1) = _h_271;
      STK(2) = FID_MAIN_K2641;
      WL_PUSHN(3);
    } else {
      u64 _t_134 = task_node(e, FID_MAIN_K2641, WL_CONT, WL_IDX, 1);
      e.mem[_t_134 + 0] = _x_367;
      e.mem[_t_134 + 1] = _h_271;
      WL_CONT = term_tsk(FID_MAIN_K2641, _t_134);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_135 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_135 + 0] = _x_368;
      e.mem[_t_135 + 1] = _h_272;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_135);
    }
    r0 = _x_368;
    r1 = _h_272;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2641)
  {
    WL_POPN(2);
    Term _x_369 = STK(0);
    Term _h_273 = STK(1);
    Term _h_274 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _x_369;
      STK(1) = FID_MAIN_K2642;
      WL_PUSHN(2);
    } else {
      u64 _t_136 = task_node(e, FID_MAIN_K2642, WL_CONT, WL_IDX, 1);
      e.mem[_t_136 + 0] = _x_369;
      WL_CONT = term_tsk(FID_MAIN_K2642, _t_136);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_137 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_137 + 0] = _h_273;
      e.mem[_t_137 + 1] = _h_274;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_137);
    }
    r0 = _h_273;
    r1 = _h_274;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2642)
  {
    WL_POPN(1);
    Term _x_370 = STK(0);
    Term _h_275 = r0;
    WL_OPEN
    _x_370 = term_keep(e, _x_370);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _x_370;
      STK(1) = _h_275;
      STK(2) = FID_MAIN_K2643;
      WL_PUSHN(3);
    } else {
      u64 _t_138 = task_node(e, FID_MAIN_K2643, WL_CONT, WL_IDX, 1);
      e.mem[_t_138 + 0] = _x_370;
      e.mem[_t_138 + 1] = _h_275;
      WL_CONT = term_tsk(FID_MAIN_K2643, _t_138);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID_HEAD_OF)) {
      u64 _t_139 = task_node(e, FID_HEAD_OF, WL_CONT, WL_IDX, 0);
      e.mem[_t_139 + 0] = _x_370;
      return term_tsk(FID_HEAD_OF, _t_139);
    }
    r0 = _x_370;
    WL_JMP(FID_HEAD_OF);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2643)
  {
    WL_POPN(2);
    Term _x_371 = STK(0);
    Term _h_276 = STK(1);
    Term _h_277 = r0;
    WL_OPEN
    u64 _nd_81 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_81 + 0] = _x_371;
    e.mem[_nd_81 + 1] = _h_276;
    e.mem[_nd_81 + 2] = _h_277;
    r0 = term_clo(FID_MAIN_C2644, _nd_81);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2644)
  {
    Term _x_372 = r0;
    Term _h_278 = r1;
    Term _h_279 = r2;
    Term _x_373 = r3;
    WL_OPEN
    u64 _nd_82 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_82 + 0] = _x_372;
    e.mem[_nd_82 + 1] = _h_278;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_210 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_210 + 0] = _h_279;
      e.mem[_t_210 + 1] = term_clo(FID_MAIN_C2645, _nd_82);
      e.mem[_t_210 + 2] = _x_373;
      return term_tsk(FID_IO_BIND, _t_210);
    }
    r0 = _h_279;
    r1 = term_clo(FID_MAIN_C2645, _nd_82);
    r2 = _x_373;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2645)
  {
    Term _x_374 = r0;
    Term _h_280 = r1;
    Term _x_375 = r2;
    WL_OPEN
    _x_374 = term_keep(e, _x_374);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _x_374;
      STK(1) = _h_280;
      STK(2) = _x_375;
      STK(3) = FID_MAIN_K2646;
      WL_PUSHN(4);
    } else {
      u64 _t_140 = task_node(e, FID_MAIN_K2646, WL_CONT, WL_IDX, 1);
      e.mem[_t_140 + 0] = _x_374;
      e.mem[_t_140 + 1] = _h_280;
      e.mem[_t_140 + 2] = _x_375;
      WL_CONT = term_tsk(FID_MAIN_K2646, _t_140);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID_HEAD_OF_BRANCH)) {
      u64 _t_141 = task_node(e, FID_HEAD_OF_BRANCH, WL_CONT, WL_IDX, 0);
      e.mem[_t_141 + 0] = _x_374;
      e.mem[_t_141 + 1] = term_ctr(CID_SCON, STAT_OFF + 1223);
      return term_tsk(FID_HEAD_OF_BRANCH, _t_141);
    }
    r0 = _x_374;
    r1 = term_ctr(CID_SCON, STAT_OFF + 1223);
    WL_JMP(FID_HEAD_OF_BRANCH);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2646)
  {
    WL_POPN(3);
    Term _x_376 = STK(0);
    Term _h_281 = STK(1);
    Term _x_377 = STK(2);
    Term _h_282 = r0;
    WL_OPEN
    u64 _nd_83 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_83 + 0] = _x_376;
    e.mem[_nd_83 + 1] = _h_281;
    e.mem[_nd_83 + 2] = _x_377;
    e.mem[_nd_83 + 3] = _h_282;
    r0 = term_clo(FID_MAIN_C2647, _nd_83);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2647)
  {
    Term _x_378 = r0;
    Term _h_283 = r1;
    Term _x_379 = r2;
    Term _h_284 = r3;
    Term _x_380 = r4;
    WL_OPEN
    u64 _nd_84 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_84 + 0] = _x_378;
    e.mem[_nd_84 + 1] = _h_283;
    e.mem[_nd_84 + 2] = _x_379;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_209 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_209 + 0] = _h_284;
      e.mem[_t_209 + 1] = term_clo(FID_MAIN_C2648, _nd_84);
      e.mem[_t_209 + 2] = _x_380;
      return term_tsk(FID_IO_BIND, _t_209);
    }
    r0 = _h_284;
    r1 = term_clo(FID_MAIN_C2648, _nd_84);
    r2 = _x_380;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2648)
  {
    Term _x_381 = r0;
    Term _h_285 = r1;
    Term _x_382 = r2;
    Term _x_383 = r3;
    WL_OPEN
    _x_381 = term_keep(e, _x_381);
    if (seq) {
      WL_ROOM(5);
      STK(0) = _x_381;
      STK(1) = _h_285;
      STK(2) = _x_382;
      STK(3) = _x_383;
      STK(4) = FID_MAIN_K2649;
      WL_PUSHN(5);
    } else {
      u64 _t_142 = task_node(e, FID_MAIN_K2649, WL_CONT, WL_IDX, 1);
      e.mem[_t_142 + 0] = _x_381;
      e.mem[_t_142 + 1] = _h_285;
      e.mem[_t_142 + 2] = _x_382;
      e.mem[_t_142 + 3] = _x_383;
      WL_CONT = term_tsk(FID_MAIN_K2649, _t_142);
      WL_IDX = 4;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_143 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_143 + 0] = _x_381;
      e.mem[_t_143 + 1] = term_ctr(CID_SCON, STAT_OFF + 1253);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_143);
    }
    r0 = _x_381;
    r1 = term_ctr(CID_SCON, STAT_OFF + 1253);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2649)
  {
    WL_POPN(4);
    Term _x_384 = STK(0);
    Term _h_286 = STK(1);
    Term _x_385 = STK(2);
    Term _x_386 = STK(3);
    Term _h_287 = r0;
    WL_OPEN
    _x_384 = term_keep(e, _x_384);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _x_384;
      STK(1) = _h_286;
      STK(2) = _x_386;
      STK(3) = FID_MAIN_K2650;
      WL_PUSHN(4);
    } else {
      u64 _t_144 = task_node(e, FID_MAIN_K2650, WL_CONT, WL_IDX, 1);
      e.mem[_t_144 + 0] = _x_384;
      e.mem[_t_144 + 1] = _h_286;
      e.mem[_t_144 + 2] = _x_386;
      WL_CONT = term_tsk(FID_MAIN_K2650, _t_144);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID_AUTHOR)) {
      u64 _t_145 = task_node(e, FID_AUTHOR, WL_CONT, WL_IDX, 0);
      e.mem[_t_145 + 0] = _x_384;
      e.mem[_t_145 + 1] = _h_287;
      e.mem[_t_145 + 2] = term_ctr(CID_SCON, STAT_OFF + 1265);
      e.mem[_t_145 + 3] = _x_385;
      e.mem[_t_145 + 4] = term_ctr(CID_SCON, STAT_OFF + 1305);
      return term_tsk(FID_AUTHOR, _t_145);
    }
    r0 = _x_384;
    r1 = _h_287;
    r2 = term_ctr(CID_SCON, STAT_OFF + 1265);
    r3 = _x_385;
    r4 = term_ctr(CID_SCON, STAT_OFF + 1305);
    WL_JMP(FID_AUTHOR);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2650)
  {
    WL_POPN(3);
    Term _x_387 = STK(0);
    Term _h_288 = STK(1);
    Term _x_388 = STK(2);
    Term _h_289 = r0;
    WL_OPEN
    u64 _nd_85 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_85 + 0] = _x_387;
    e.mem[_nd_85 + 1] = _h_288;
    e.mem[_nd_85 + 2] = _x_388;
    e.mem[_nd_85 + 3] = _h_289;
    r0 = term_clo(FID_MAIN_C2651, _nd_85);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2651)
  {
    Term _x_389 = r0;
    Term _h_290 = r1;
    Term _x_390 = r2;
    Term _h_291 = r3;
    Term _x_391 = r4;
    WL_OPEN
    u64 _nd_86 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_86 + 0] = _x_389;
    e.mem[_nd_86 + 1] = _h_290;
    e.mem[_nd_86 + 2] = _x_390;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_208 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_208 + 0] = _h_291;
      e.mem[_t_208 + 1] = term_clo(FID_MAIN_C2652, _nd_86);
      e.mem[_t_208 + 2] = _x_391;
      return term_tsk(FID_IO_BIND, _t_208);
    }
    r0 = _h_291;
    r1 = term_clo(FID_MAIN_C2652, _nd_86);
    r2 = _x_391;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2652)
  {
    Term _x_392 = r0;
    Term _h_292 = r1;
    Term _x_393 = r2;
    Term _x_394 = r3;
    WL_OPEN
    _x_392 = term_keep(e, _x_392);
    if (seq) {
      WL_ROOM(5);
      STK(0) = _x_392;
      STK(1) = _h_292;
      STK(2) = _x_393;
      STK(3) = _x_394;
      STK(4) = FID_MAIN_K2653;
      WL_PUSHN(5);
    } else {
      u64 _t_146 = task_node(e, FID_MAIN_K2653, WL_CONT, WL_IDX, 1);
      e.mem[_t_146 + 0] = _x_392;
      e.mem[_t_146 + 1] = _h_292;
      e.mem[_t_146 + 2] = _x_393;
      e.mem[_t_146 + 3] = _x_394;
      WL_CONT = term_tsk(FID_MAIN_K2653, _t_146);
      WL_IDX = 4;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_147 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_147 + 0] = _x_392;
      e.mem[_t_147 + 1] = term_ctr(CID_SCON, STAT_OFF + 1333);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_147);
    }
    r0 = _x_392;
    r1 = term_ctr(CID_SCON, STAT_OFF + 1333);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2653)
  {
    WL_POPN(4);
    Term _x_395 = STK(0);
    Term _h_293 = STK(1);
    Term _x_396 = STK(2);
    Term _x_397 = STK(3);
    Term _h_294 = r0;
    WL_OPEN
    _x_395 = term_keep(e, _x_395);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _x_395;
      STK(1) = _h_293;
      STK(2) = _x_396;
      STK(3) = FID_MAIN_K2654;
      WL_PUSHN(4);
    } else {
      u64 _t_148 = task_node(e, FID_MAIN_K2654, WL_CONT, WL_IDX, 1);
      e.mem[_t_148 + 0] = _x_395;
      e.mem[_t_148 + 1] = _h_293;
      e.mem[_t_148 + 2] = _x_396;
      WL_CONT = term_tsk(FID_MAIN_K2654, _t_148);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID_LAND_OK)) {
      u64 _t_149 = task_node(e, FID_LAND_OK, WL_CONT, WL_IDX, 0);
      e.mem[_t_149 + 0] = _x_395;
      e.mem[_t_149 + 1] = term_ctr(CID_SCON, STAT_OFF + 663);
      e.mem[_t_149 + 2] = _x_397;
      e.mem[_t_149 + 3] = term_ctr(CID_CON, STAT_OFF + 1335);
      e.mem[_t_149 + 4] = term_ctr(CID_SCON, STAT_OFF + 1357);
      e.mem[_t_149 + 5] = _h_294;
      return term_tsk(FID_LAND_OK, _t_149);
    }
    r0 = _x_395;
    r1 = term_ctr(CID_SCON, STAT_OFF + 663);
    r2 = _x_397;
    r3 = term_ctr(CID_CON, STAT_OFF + 1335);
    r4 = term_ctr(CID_SCON, STAT_OFF + 1357);
    r5 = _h_294;
    WL_JMP(FID_LAND_OK);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2654)
  {
    WL_POPN(3);
    Term _x_398 = STK(0);
    Term _h_295 = STK(1);
    Term _x_399 = STK(2);
    Term _h_296 = r0;
    WL_OPEN
    u64 _nd_87 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_87 + 0] = _x_398;
    e.mem[_nd_87 + 1] = _h_295;
    e.mem[_nd_87 + 2] = _x_399;
    e.mem[_nd_87 + 3] = _h_296;
    r0 = term_clo(FID_MAIN_C2655, _nd_87);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2655)
  {
    Term _x_400 = r0;
    Term _h_297 = r1;
    Term _x_401 = r2;
    Term _h_298 = r3;
    Term _x_402 = r4;
    WL_OPEN
    u64 _nd_88 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_88 + 0] = _x_400;
    e.mem[_nd_88 + 1] = _h_297;
    e.mem[_nd_88 + 2] = _x_401;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_207 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_207 + 0] = _h_298;
      e.mem[_t_207 + 1] = term_clo(FID_MAIN_C2656, _nd_88);
      e.mem[_t_207 + 2] = _x_402;
      return term_tsk(FID_IO_BIND, _t_207);
    }
    r0 = _h_298;
    r1 = term_clo(FID_MAIN_C2656, _nd_88);
    r2 = _x_402;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2656)
  {
    Term _x_403 = r0;
    Term _h_299 = r1;
    Term _x_404 = r2;
    Term _x_405 = r3;
    WL_OPEN
    u32 _o_179 = 0;
    u32 _o_180 = 0;
    Term _o_181 = 0;
    Term _o_182 = 0;
    if (term_aux(_x_405) == CID_FAIL) {
      _o_179 = 0;
      Term _fb_13[1];
      u64 _sp_68 = ctr_take(e, _x_405, 1, _fb_13);
      Term _f_88 = _fb_13[0];
      spare_free(e, cls_fit(1), _sp_68);
      u32 _o_183 = 0;
      Term _o_184 = 0;
      Term _o_185 = 0;
      if (term_aux(_f_88) == CID____SRC_GIT_TYPES_FBRANCHEXISTS) {
        _o_183 = 0;
        u64 _sp_69 = term_loc(_f_88);
        Term _f_89 = e.mem[_sp_69 + 0];
        heap_free(e, cls_fit(1), _sp_69);
        _o_184 = _f_89;
      } else if (term_aux(_f_88) == CID____SRC_GIT_TYPES_FPATHEXISTS) {
        _o_183 = 1;
        u64 _sp_70 = term_loc(_f_88);
        Term _f_90 = e.mem[_sp_70 + 0];
        heap_free(e, cls_fit(1), _sp_70);
        _o_184 = _f_90;
      } else if (term_aux(_f_88) == CID____SRC_GIT_TYPES_FUNKNOWNBASE) {
        _o_183 = 2;
        u64 _sp_71 = term_loc(_f_88);
        Term _f_91 = e.mem[_sp_71 + 0];
        heap_free(e, cls_fit(1), _sp_71);
        _o_184 = _f_91;
      } else if (term_aux(_f_88) == CID____SRC_GIT_TYPES_FTARGETBUSY) {
        _o_183 = 3;
        u64 _sp_72 = term_loc(_f_88);
        Term _f_92 = e.mem[_sp_72 + 0];
        heap_free(e, cls_fit(1), _sp_72);
        _o_184 = _f_92;
      } else {
        _o_183 = 4;
        Term _fb_14[2];
        u64 _sp_73 = ctr_take(e, _f_88, 2, _fb_14);
        Term _f_93 = _fb_14[0];
        Term _f_94 = _fb_14[1];
        spare_free(e, cls_fit(2), _sp_73);
        _o_184 = _f_93;
        _o_185 = _f_94;
      }
      _o_180 = _o_183;
      _o_181 = _o_184;
      _o_182 = _o_185;
    } else {
      _o_179 = 1;
      u64 _sp_74 = term_loc(_x_405);
      Term _f_95 = e.mem[_sp_74 + 0];
      heap_free(e, cls_fit(1), _sp_74);
      u32 _o_186 = 0;
      Term _o_187 = 0;
      Term _o_188 = 0;
      if (term_aux(_f_95) == CID____SRC_GIT_TYPES_LLANDED) {
        _o_186 = 0;
        u64 _sp_75 = term_loc(_f_95);
        Term _f_96 = e.mem[_sp_75 + 0];
        Term _f_97 = e.mem[_sp_75 + 1];
        heap_free(e, cls_fit(2), _sp_75);
        _o_187 = _f_96;
        _o_188 = _f_97;
      } else if (term_aux(_f_95) == CID____SRC_GIT_TYPES_LALREADY) {
        _o_186 = 1;
        u64 _sp_76 = term_loc(_f_95);
        Term _f_98 = e.mem[_sp_76 + 0];
        heap_free(e, cls_fit(1), _sp_76);
        _o_187 = _f_98;
      } else if (term_aux(_f_95) == CID____SRC_GIT_TYPES_LCONFLICT) {
        _o_186 = 2;
        u64 _sp_77 = term_loc(_f_95);
        Term _f_99 = e.mem[_sp_77 + 0];
        Term _f_100 = e.mem[_sp_77 + 1];
        heap_free(e, cls_fit(2), _sp_77);
        _o_187 = _f_99;
        _o_188 = _f_100;
      } else {
        _o_186 = 3;
        u64 _sp_78 = term_loc(_f_95);
        Term _f_101 = e.mem[_sp_78 + 0];
        heap_free(e, cls_fit(1), _sp_78);
        _o_187 = _f_101;
      }
      _o_180 = _o_186;
      _o_181 = _o_187;
      _o_182 = _o_188;
    }
    _x_403 = term_keep(e, _x_403);
    if (seq) {
      WL_ROOM(8);
      STK(0) = _x_403;
      STK(1) = _h_299;
      STK(2) = _x_404;
      STK(3) = _o_179;
      STK(4) = _o_180;
      STK(5) = _o_181;
      STK(6) = _o_182;
      STK(7) = FID_MAIN_K2657;
      WL_PUSHN(8);
    } else {
      u64 _t_150 = task_node(e, FID_MAIN_K2657, WL_CONT, WL_IDX, 1);
      e.mem[_t_150 + 0] = _x_403;
      e.mem[_t_150 + 1] = _h_299;
      e.mem[_t_150 + 2] = _x_404;
      e.mem[_t_150 + 3] = _o_179;
      e.mem[_t_150 + 4] = _o_180;
      e.mem[_t_150 + 5] = _o_181;
      e.mem[_t_150 + 6] = _o_182;
      WL_CONT = term_tsk(FID_MAIN_K2657, _t_150);
      WL_IDX = 7;
    }
    if (!DEVICE && !seq && fid_nofk(FID_HEAD_OF)) {
      u64 _t_151 = task_node(e, FID_HEAD_OF, WL_CONT, WL_IDX, 0);
      e.mem[_t_151 + 0] = _x_403;
      return term_tsk(FID_HEAD_OF, _t_151);
    }
    r0 = _x_403;
    WL_JMP(FID_HEAD_OF);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2657)
  {
    WL_POPN(7);
    Term _x_406 = STK(0);
    Term _h_300 = STK(1);
    Term _x_407 = STK(2);
    u32 _o_189 = STK(3);
    u32 _o_190 = STK(4);
    Term _o_191 = STK(5);
    Term _o_192 = STK(6);
    Term _h_301 = r0;
    WL_OPEN
    u64 _nd_89 = heap_alloc(e, cls_fit(8));
    e.mem[_nd_89 + 0] = _x_406;
    e.mem[_nd_89 + 1] = _h_300;
    e.mem[_nd_89 + 2] = _x_407;
    e.mem[_nd_89 + 3] = _o_189;
    e.mem[_nd_89 + 4] = _o_190;
    e.mem[_nd_89 + 5] = _o_191;
    e.mem[_nd_89 + 6] = _o_192;
    e.mem[_nd_89 + 7] = _h_301;
    r0 = term_clo(FID_MAIN_C2658, _nd_89);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2658)
  {
    Term _x_408 = r0;
    Term _h_302 = r1;
    Term _x_409 = r2;
    u32 _o_193 = r3;
    u32 _o_194 = r4;
    Term _o_195 = r5;
    Term _o_196 = r6;
    Term _h_303 = r7;
    Term _x_410 = r8;
    WL_OPEN
    u64 _nd_90 = heap_alloc(e, cls_fit(7));
    e.mem[_nd_90 + 0] = _x_408;
    e.mem[_nd_90 + 1] = _h_302;
    e.mem[_nd_90 + 2] = _x_409;
    e.mem[_nd_90 + 3] = _o_193;
    e.mem[_nd_90 + 4] = _o_194;
    e.mem[_nd_90 + 5] = _o_195;
    e.mem[_nd_90 + 6] = _o_196;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_206 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_206 + 0] = _h_303;
      e.mem[_t_206 + 1] = term_clo(FID_MAIN_C2659, _nd_90);
      e.mem[_t_206 + 2] = _x_410;
      return term_tsk(FID_IO_BIND, _t_206);
    }
    r0 = _h_303;
    r1 = term_clo(FID_MAIN_C2659, _nd_90);
    r2 = _x_410;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2659)
  {
    Term _x_411 = r0;
    Term _h_304 = r1;
    Term _x_412 = r2;
    u32 _o_197 = r3;
    u32 _o_198 = r4;
    Term _o_199 = r5;
    Term _o_200 = r6;
    Term _x_413 = r7;
    WL_OPEN
    if (seq) {
      WL_ROOM(5);
      STK(0) = _x_411;
      STK(1) = _h_304;
      STK(2) = _x_412;
      STK(3) = _x_413;
      STK(4) = FID_MAIN_K2660;
      WL_PUSHN(5);
    } else {
      u64 _t_152 = task_node(e, FID_MAIN_K2660, WL_CONT, WL_IDX, 1);
      e.mem[_t_152 + 0] = _x_411;
      e.mem[_t_152 + 1] = _h_304;
      e.mem[_t_152 + 2] = _x_412;
      e.mem[_t_152 + 3] = _x_413;
      WL_CONT = term_tsk(FID_MAIN_K2660, _t_152);
      WL_IDX = 4;
    }
    if (!DEVICE && !seq && fid_nofk(FID_IS_CONFLICT_FILE)) {
      u64 _t_153 = task_node(e, FID_IS_CONFLICT_FILE, WL_CONT, WL_IDX, 0);
      e.mem[_t_153 + 0] = _o_197;
      e.mem[_t_153 + 1] = _o_198;
      e.mem[_t_153 + 2] = _o_199;
      e.mem[_t_153 + 3] = _o_200;
      e.mem[_t_153 + 4] = term_ctr(CID_SCON, STAT_OFF + 1271);
      return term_tsk(FID_IS_CONFLICT_FILE, _t_153);
    }
    r0 = _o_197;
    r1 = _o_198;
    r2 = _o_199;
    r3 = _o_200;
    r4 = term_ctr(CID_SCON, STAT_OFF + 1271);
    WL_JMP(FID_IS_CONFLICT_FILE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2660)
  {
    WL_POPN(4);
    Term _x_414 = STK(0);
    Term _h_305 = STK(1);
    Term _x_415 = STK(2);
    Term _x_416 = STK(3);
    Term _h_306 = r0;
    WL_OPEN
    u64 _nd_91 = heap_alloc(e, cls_fit(5));
    e.mem[_nd_91 + 0] = _x_414;
    e.mem[_nd_91 + 1] = _h_305;
    e.mem[_nd_91 + 2] = _x_415;
    e.mem[_nd_91 + 3] = _x_416;
    e.mem[_nd_91 + 4] = _h_306;
    r0 = term_clo(FID_MAIN_C2661, _nd_91);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2661)
  {
    Term _x_417 = r0;
    Term _h_307 = r1;
    Term _x_418 = r2;
    Term _x_419 = r3;
    Term _h_308 = r4;
    Term _x_420 = r5;
    WL_OPEN
    u64 _nd_92 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_92 + 0] = _h_308;
    u64 _nd_93 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_93 + 0] = _x_417;
    e.mem[_nd_93 + 1] = _h_307;
    e.mem[_nd_93 + 2] = _x_418;
    e.mem[_nd_93 + 3] = _x_419;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_205 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_205 + 0] = term_clo(FID_MAIN_C2662, _nd_92);
      e.mem[_t_205 + 1] = term_clo(FID_MAIN_C2663, _nd_93);
      e.mem[_t_205 + 2] = _x_420;
      return term_tsk(FID_IO_BIND, _t_205);
    }
    r0 = term_clo(FID_MAIN_C2662, _nd_92);
    r1 = term_clo(FID_MAIN_C2663, _nd_93);
    r2 = _x_420;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2662)
  {
    Term _h_309 = r0;
    Term _x_421 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_154 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_154 + 0] = _h_309;
      e.mem[_t_154 + 1] = _x_421;
      return term_tsk(FID_IO_PURE, _t_154);
    }
    r0 = _h_309;
    r1 = _x_421;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2663)
  {
    Term _x_422 = r0;
    Term _h_310 = r1;
    Term _x_423 = r2;
    Term _x_424 = r3;
    Term _x_425 = r4;
    WL_OPEN
    if (seq) {
      WL_ROOM(5);
      STK(0) = _x_422;
      STK(1) = _h_310;
      STK(2) = _x_424;
      STK(3) = _x_425;
      STK(4) = FID_MAIN_K2664;
      WL_PUSHN(5);
    } else {
      u64 _t_155 = task_node(e, FID_MAIN_K2664, WL_CONT, WL_IDX, 1);
      e.mem[_t_155 + 0] = _x_422;
      e.mem[_t_155 + 1] = _h_310;
      e.mem[_t_155 + 2] = _x_424;
      e.mem[_t_155 + 3] = _x_425;
      WL_CONT = term_tsk(FID_MAIN_K2664, _t_155);
      WL_IDX = 4;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_EQ)) {
      u64 _t_156 = task_node(e, FID____SRC_GIT_TEXT_STR_EQ, WL_CONT, WL_IDX, 0);
      e.mem[_t_156 + 0] = _x_424;
      e.mem[_t_156 + 1] = _x_423;
      return term_tsk(FID____SRC_GIT_TEXT_STR_EQ, _t_156);
    }
    r0 = _x_424;
    r1 = _x_423;
    WL_JMP(FID____SRC_GIT_TEXT_STR_EQ);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2664)
  {
    WL_POPN(4);
    Term _x_426 = STK(0);
    Term _h_311 = STK(1);
    Term _x_427 = STK(2);
    Term _x_428 = STK(3);
    u32 _h_312 = r0;
    WL_OPEN
    term_sink(e, _x_427);
    u64 _nd_94 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_94 + 0] = _x_426;
    e.mem[_nd_94 + 1] = _h_311;
    e.mem[_nd_94 + 2] = _x_428;
    e.mem[_nd_94 + 3] = _h_312;
    r0 = term_clo(FID_MAIN_C2665, _nd_94);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2665)
  {
    Term _x_429 = r0;
    Term _h_313 = r1;
    Term _x_430 = r2;
    u32 _h_314 = r3;
    Term _x_431 = r4;
    WL_OPEN
    u64 _nd_95 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_95 + 0] = _h_314;
    u64 _nd_96 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_96 + 0] = _x_429;
    e.mem[_nd_96 + 1] = _h_313;
    e.mem[_nd_96 + 2] = _x_430;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_204 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_204 + 0] = term_clo(FID_MAIN_C2666, _nd_95);
      e.mem[_t_204 + 1] = term_clo(FID_MAIN_C2667, _nd_96);
      e.mem[_t_204 + 2] = _x_431;
      return term_tsk(FID_IO_BIND, _t_204);
    }
    r0 = term_clo(FID_MAIN_C2666, _nd_95);
    r1 = term_clo(FID_MAIN_C2667, _nd_96);
    r2 = _x_431;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2666)
  {
    u32 _h_315 = r0;
    Term _x_432 = r1;
    WL_OPEN
    Term _v_15 = 0;
    Term _v_16 = 0;
    Term _o_201[1];
    if (spin_45(e, _o_201, _h_315, term_ctr(CID_SCON, STAT_OFF + 1423)) == 0) {
      return 0;
    }
    _v_16 = _o_201[0];
    _v_15 = _v_16;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_157 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_157 + 0] = _v_15;
      e.mem[_t_157 + 1] = _x_432;
      return term_tsk(FID_IO_PURE, _t_157);
    }
    r0 = _v_15;
    r1 = _x_432;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2667)
  {
    Term _x_433 = r0;
    Term _h_316 = r1;
    Term _x_434 = r2;
    Term _x_435 = r3;
    WL_OPEN
    if (seq) {
      WL_ROOM(3);
      STK(0) = _x_433;
      STK(1) = _h_316;
      STK(2) = FID_MAIN_K2668;
      WL_PUSHN(3);
    } else {
      u64 _t_158 = task_node(e, FID_MAIN_K2668, WL_CONT, WL_IDX, 1);
      e.mem[_t_158 + 0] = _x_433;
      e.mem[_t_158 + 1] = _h_316;
      WL_CONT = term_tsk(FID_MAIN_K2668, _t_158);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_159 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_159 + 0] = _x_434;
      e.mem[_t_159 + 1] = _x_435;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_159);
    }
    r0 = _x_434;
    r1 = _x_435;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2668)
  {
    WL_POPN(2);
    Term _x_436 = STK(0);
    Term _h_317 = STK(1);
    Term _h_318 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _x_436;
      STK(1) = FID_MAIN_K2669;
      WL_PUSHN(2);
    } else {
      u64 _t_160 = task_node(e, FID_MAIN_K2669, WL_CONT, WL_IDX, 1);
      e.mem[_t_160 + 0] = _x_436;
      WL_CONT = term_tsk(FID_MAIN_K2669, _t_160);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_161 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_161 + 0] = _h_317;
      e.mem[_t_161 + 1] = _h_318;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_161);
    }
    r0 = _h_317;
    r1 = _h_318;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2669)
  {
    WL_POPN(1);
    Term _x_437 = STK(0);
    Term _h_319 = r0;
    WL_OPEN
    _x_437 = term_keep(e, _x_437);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _x_437;
      STK(1) = _h_319;
      STK(2) = FID_MAIN_K2670;
      WL_PUSHN(3);
    } else {
      u64 _t_162 = task_node(e, FID_MAIN_K2670, WL_CONT, WL_IDX, 1);
      e.mem[_t_162 + 0] = _x_437;
      e.mem[_t_162 + 1] = _h_319;
      WL_CONT = term_tsk(FID_MAIN_K2670, _t_162);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_163 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_163 + 0] = _x_437;
      e.mem[_t_163 + 1] = term_ctr(CID_SCON, STAT_OFF + 951);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_163);
    }
    r0 = _x_437;
    r1 = term_ctr(CID_SCON, STAT_OFF + 951);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2670)
  {
    WL_POPN(2);
    Term _x_438 = STK(0);
    Term _h_320 = STK(1);
    Term _h_321 = r0;
    WL_OPEN
    _x_438 = term_keep(e, _x_438);
    u64 _nd_97 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_97 + 0] = _h_321;
    e.mem[_nd_97 + 1] = term_ctr(CID_CON, STAT_OFF + 977);
    u64 _nd_98 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_98 + 0] = term_ctr(CID_SCON, STAT_OFF + 975);
    e.mem[_nd_98 + 1] = term_ctr(CID_CON, _nd_97);
    u64 _nd_99 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_99 + 0] = term_ctr(CID_SCON, STAT_OFF + 971);
    e.mem[_nd_99 + 1] = term_ctr(CID_CON, _nd_98);
    u64 _nd_100 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_100 + 0] = _x_438;
    e.mem[_nd_100 + 1] = term_ctr(CID_CON, _nd_99);
    u64 _nd_101 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_101 + 0] = term_ctr(CID_SCON, STAT_OFF + 957);
    e.mem[_nd_101 + 1] = term_ctr(CID_CON, _nd_100);
    u64 _nd_102 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_102 + 0] = term_ctr(CID_SCON, STAT_OFF + 953);
    e.mem[_nd_102 + 1] = term_ctr(CID_CON, _nd_101);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _x_438;
      STK(1) = _h_320;
      STK(2) = FID_MAIN_K2671;
      WL_PUSHN(3);
    } else {
      u64 _t_164 = task_node(e, FID_MAIN_K2671, WL_CONT, WL_IDX, 1);
      e.mem[_t_164 + 0] = _x_438;
      e.mem[_t_164 + 1] = _h_320;
      WL_CONT = term_tsk(FID_MAIN_K2671, _t_164);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
      u64 _t_165 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
      e.mem[_t_165 + 0] = term_ctr(CID_CON, _nd_102);
      e.mem[_t_165 + 1] = term_ctr(CID_SCON, STAT_OFF + 979);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_165);
    }
    r0 = term_ctr(CID_CON, _nd_102);
    r1 = term_ctr(CID_SCON, STAT_OFF + 979);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2671)
  {
    WL_POPN(2);
    Term _x_439 = STK(0);
    Term _h_322 = STK(1);
    Term _h_323 = r0;
    WL_OPEN
    u64 _nd_103 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_103 + 0] = _x_439;
    e.mem[_nd_103 + 1] = _h_322;
    e.mem[_nd_103 + 2] = _h_323;
    r0 = term_clo(FID_MAIN_C2672, _nd_103);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2672)
  {
    Term _x_440 = r0;
    Term _h_324 = r1;
    Term _h_325 = r2;
    Term _x_441 = r3;
    WL_OPEN
    u64 _nd_104 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_104 + 0] = _x_440;
    e.mem[_nd_104 + 1] = _h_324;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_203 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_203 + 0] = _h_325;
      e.mem[_t_203 + 1] = term_clo(FID_MAIN_C2673, _nd_104);
      e.mem[_t_203 + 2] = _x_441;
      return term_tsk(FID_IO_BIND, _t_203);
    }
    r0 = _h_325;
    r1 = term_clo(FID_MAIN_C2673, _nd_104);
    r2 = _x_441;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2673)
  {
    Term _x_442 = r0;
    Term _h_326 = r1;
    Term _x_443 = r2;
    WL_OPEN
    u32 _o_202 = 0;
    Term _o_203 = 0;
    u32 _o_204 = 0;
    Term _o_205 = 0;
    if (term_aux(_x_443) == CID____SRC_GIT_TYPES_RRUN) {
      _o_202 = 0;
      Term _fb_15[3];
      u64 _sp_79 = ctr_take(e, _x_443, 3, _fb_15);
      u32 _f_102 = _fb_15[0];
      u32 _f_103 = _fb_15[1];
      Term _f_104 = _fb_15[2];
      spare_free(e, cls_fit(3), _sp_79);
      _o_203 = _f_102;
      _o_204 = _f_103;
      _o_205 = _f_104;
    } else {
      _o_202 = 1;
      u64 _sp_80 = term_loc(_x_443);
      Term _f_105 = e.mem[_sp_80 + 0];
      heap_free(e, cls_fit(1), _sp_80);
      _o_203 = _f_105;
    }
    term_sink(e, _o_203);
    term_sink(e, _o_205);
    _x_442 = term_keep(e, _x_442);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _x_442;
      STK(1) = _h_326;
      STK(2) = FID_MAIN_K2674;
      WL_PUSHN(3);
    } else {
      u64 _t_166 = task_node(e, FID_MAIN_K2674, WL_CONT, WL_IDX, 1);
      e.mem[_t_166 + 0] = _x_442;
      e.mem[_t_166 + 1] = _h_326;
      WL_CONT = term_tsk(FID_MAIN_K2674, _t_166);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID_HEAD_OF)) {
      u64 _t_167 = task_node(e, FID_HEAD_OF, WL_CONT, WL_IDX, 0);
      e.mem[_t_167 + 0] = _x_442;
      return term_tsk(FID_HEAD_OF, _t_167);
    }
    r0 = _x_442;
    WL_JMP(FID_HEAD_OF);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2674)
  {
    WL_POPN(2);
    Term _x_444 = STK(0);
    Term _h_327 = STK(1);
    Term _h_328 = r0;
    WL_OPEN
    u64 _nd_105 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_105 + 0] = _x_444;
    e.mem[_nd_105 + 1] = _h_327;
    e.mem[_nd_105 + 2] = _h_328;
    r0 = term_clo(FID_MAIN_C2675, _nd_105);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2675)
  {
    Term _x_445 = r0;
    Term _h_329 = r1;
    Term _h_330 = r2;
    Term _x_446 = r3;
    WL_OPEN
    u64 _nd_106 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_106 + 0] = _x_445;
    e.mem[_nd_106 + 1] = _h_329;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_202 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_202 + 0] = _h_330;
      e.mem[_t_202 + 1] = term_clo(FID_MAIN_C2676, _nd_106);
      e.mem[_t_202 + 2] = _x_446;
      return term_tsk(FID_IO_BIND, _t_202);
    }
    r0 = _h_330;
    r1 = term_clo(FID_MAIN_C2676, _nd_106);
    r2 = _x_446;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2676)
  {
    Term _x_447 = r0;
    Term _h_331 = r1;
    Term _x_448 = r2;
    WL_OPEN
    _x_447 = term_keep(e, _x_447);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _x_447;
      STK(1) = _h_331;
      STK(2) = _x_448;
      STK(3) = FID_MAIN_K2677;
      WL_PUSHN(4);
    } else {
      u64 _t_168 = task_node(e, FID_MAIN_K2677, WL_CONT, WL_IDX, 1);
      e.mem[_t_168 + 0] = _x_447;
      e.mem[_t_168 + 1] = _h_331;
      e.mem[_t_168 + 2] = _x_448;
      WL_CONT = term_tsk(FID_MAIN_K2677, _t_168);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_169 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_169 + 0] = _x_447;
      e.mem[_t_169 + 1] = term_ctr(CID_SCON, STAT_OFF + 1007);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_169);
    }
    r0 = _x_447;
    r1 = term_ctr(CID_SCON, STAT_OFF + 1007);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2677)
  {
    WL_POPN(3);
    Term _x_449 = STK(0);
    Term _h_332 = STK(1);
    Term _x_450 = STK(2);
    Term _h_333 = r0;
    WL_OPEN
    _x_449 = term_keep(e, _x_449);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _x_449;
      STK(1) = _h_332;
      STK(2) = FID_MAIN_K2678;
      WL_PUSHN(3);
    } else {
      u64 _t_170 = task_node(e, FID_MAIN_K2678, WL_CONT, WL_IDX, 1);
      e.mem[_t_170 + 0] = _x_449;
      e.mem[_t_170 + 1] = _h_332;
      WL_CONT = term_tsk(FID_MAIN_K2678, _t_170);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID_AUTHOR)) {
      u64 _t_171 = task_node(e, FID_AUTHOR, WL_CONT, WL_IDX, 0);
      e.mem[_t_171 + 0] = _x_449;
      e.mem[_t_171 + 1] = _h_333;
      e.mem[_t_171 + 2] = term_ctr(CID_SCON, STAT_OFF + 1019);
      e.mem[_t_171 + 3] = _x_450;
      e.mem[_t_171 + 4] = term_ctr(CID_SCON, STAT_OFF + 1067);
      return term_tsk(FID_AUTHOR, _t_171);
    }
    r0 = _x_449;
    r1 = _h_333;
    r2 = term_ctr(CID_SCON, STAT_OFF + 1019);
    r3 = _x_450;
    r4 = term_ctr(CID_SCON, STAT_OFF + 1067);
    WL_JMP(FID_AUTHOR);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2678)
  {
    WL_POPN(2);
    Term _x_451 = STK(0);
    Term _h_334 = STK(1);
    Term _h_335 = r0;
    WL_OPEN
    u64 _nd_107 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_107 + 0] = _x_451;
    e.mem[_nd_107 + 1] = _h_334;
    e.mem[_nd_107 + 2] = _h_335;
    r0 = term_clo(FID_MAIN_C2679, _nd_107);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2679)
  {
    Term _x_452 = r0;
    Term _h_336 = r1;
    Term _h_337 = r2;
    Term _x_453 = r3;
    WL_OPEN
    u64 _nd_108 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_108 + 0] = _x_452;
    e.mem[_nd_108 + 1] = _h_336;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_201 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_201 + 0] = _h_337;
      e.mem[_t_201 + 1] = term_clo(FID_MAIN_C2680, _nd_108);
      e.mem[_t_201 + 2] = _x_453;
      return term_tsk(FID_IO_BIND, _t_201);
    }
    r0 = _h_337;
    r1 = term_clo(FID_MAIN_C2680, _nd_108);
    r2 = _x_453;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2680)
  {
    Term _x_454 = r0;
    Term _h_338 = r1;
    Term _x_455 = r2;
    WL_OPEN
    _x_454 = term_keep(e, _x_454);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _x_454;
      STK(1) = _h_338;
      STK(2) = _x_455;
      STK(3) = FID_MAIN_K2681;
      WL_PUSHN(4);
    } else {
      u64 _t_172 = task_node(e, FID_MAIN_K2681, WL_CONT, WL_IDX, 1);
      e.mem[_t_172 + 0] = _x_454;
      e.mem[_t_172 + 1] = _h_338;
      e.mem[_t_172 + 2] = _x_455;
      WL_CONT = term_tsk(FID_MAIN_K2681, _t_172);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_173 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_173 + 0] = _x_454;
      e.mem[_t_173 + 1] = term_ctr(CID_SCON, STAT_OFF + 1095);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_173);
    }
    r0 = _x_454;
    r1 = term_ctr(CID_SCON, STAT_OFF + 1095);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2681)
  {
    WL_POPN(3);
    Term _x_456 = STK(0);
    Term _h_339 = STK(1);
    Term _x_457 = STK(2);
    Term _h_340 = r0;
    WL_OPEN
    _x_456 = term_keep(e, _x_456);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _x_456;
      STK(1) = _h_339;
      STK(2) = FID_MAIN_K2682;
      WL_PUSHN(3);
    } else {
      u64 _t_174 = task_node(e, FID_MAIN_K2682, WL_CONT, WL_IDX, 1);
      e.mem[_t_174 + 0] = _x_456;
      e.mem[_t_174 + 1] = _h_339;
      WL_CONT = term_tsk(FID_MAIN_K2682, _t_174);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID_LAND_OK)) {
      u64 _t_175 = task_node(e, FID_LAND_OK, WL_CONT, WL_IDX, 0);
      e.mem[_t_175 + 0] = _x_456;
      e.mem[_t_175 + 1] = term_ctr(CID_SCON, STAT_OFF + 663);
      e.mem[_t_175 + 2] = _x_457;
      e.mem[_t_175 + 3] = term_ctr(CID_CON, STAT_OFF + 1097);
      e.mem[_t_175 + 4] = term_ctr(CID_SCON, STAT_OFF + 729);
      e.mem[_t_175 + 5] = _h_340;
      return term_tsk(FID_LAND_OK, _t_175);
    }
    r0 = _x_456;
    r1 = term_ctr(CID_SCON, STAT_OFF + 663);
    r2 = _x_457;
    r3 = term_ctr(CID_CON, STAT_OFF + 1097);
    r4 = term_ctr(CID_SCON, STAT_OFF + 729);
    r5 = _h_340;
    WL_JMP(FID_LAND_OK);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2682)
  {
    WL_POPN(2);
    Term _x_458 = STK(0);
    Term _h_341 = STK(1);
    Term _h_342 = r0;
    WL_OPEN
    u64 _nd_109 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_109 + 0] = _x_458;
    e.mem[_nd_109 + 1] = _h_341;
    e.mem[_nd_109 + 2] = _h_342;
    r0 = term_clo(FID_MAIN_C2683, _nd_109);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2683)
  {
    Term _x_459 = r0;
    Term _h_343 = r1;
    Term _h_344 = r2;
    Term _x_460 = r3;
    WL_OPEN
    u64 _nd_110 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_110 + 0] = _x_459;
    e.mem[_nd_110 + 1] = _h_343;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_200 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_200 + 0] = _h_344;
      e.mem[_t_200 + 1] = term_clo(FID_MAIN_C2684, _nd_110);
      e.mem[_t_200 + 2] = _x_460;
      return term_tsk(FID_IO_BIND, _t_200);
    }
    r0 = _h_344;
    r1 = term_clo(FID_MAIN_C2684, _nd_110);
    r2 = _x_460;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2684)
  {
    Term _x_461 = r0;
    Term _h_345 = r1;
    Term _x_462 = r2;
    WL_OPEN
    u32 _o_206 = 0;
    u32 _o_207 = 0;
    Term _o_208 = 0;
    Term _o_209 = 0;
    if (term_aux(_x_462) == CID_FAIL) {
      _o_206 = 0;
      Term _fb_16[1];
      u64 _sp_81 = ctr_take(e, _x_462, 1, _fb_16);
      Term _f_106 = _fb_16[0];
      spare_free(e, cls_fit(1), _sp_81);
      u32 _o_210 = 0;
      Term _o_211 = 0;
      Term _o_212 = 0;
      if (term_aux(_f_106) == CID____SRC_GIT_TYPES_FBRANCHEXISTS) {
        _o_210 = 0;
        u64 _sp_82 = term_loc(_f_106);
        Term _f_107 = e.mem[_sp_82 + 0];
        heap_free(e, cls_fit(1), _sp_82);
        _o_211 = _f_107;
      } else if (term_aux(_f_106) == CID____SRC_GIT_TYPES_FPATHEXISTS) {
        _o_210 = 1;
        u64 _sp_83 = term_loc(_f_106);
        Term _f_108 = e.mem[_sp_83 + 0];
        heap_free(e, cls_fit(1), _sp_83);
        _o_211 = _f_108;
      } else if (term_aux(_f_106) == CID____SRC_GIT_TYPES_FUNKNOWNBASE) {
        _o_210 = 2;
        u64 _sp_84 = term_loc(_f_106);
        Term _f_109 = e.mem[_sp_84 + 0];
        heap_free(e, cls_fit(1), _sp_84);
        _o_211 = _f_109;
      } else if (term_aux(_f_106) == CID____SRC_GIT_TYPES_FTARGETBUSY) {
        _o_210 = 3;
        u64 _sp_85 = term_loc(_f_106);
        Term _f_110 = e.mem[_sp_85 + 0];
        heap_free(e, cls_fit(1), _sp_85);
        _o_211 = _f_110;
      } else {
        _o_210 = 4;
        Term _fb_17[2];
        u64 _sp_86 = ctr_take(e, _f_106, 2, _fb_17);
        Term _f_111 = _fb_17[0];
        Term _f_112 = _fb_17[1];
        spare_free(e, cls_fit(2), _sp_86);
        _o_211 = _f_111;
        _o_212 = _f_112;
      }
      _o_207 = _o_210;
      _o_208 = _o_211;
      _o_209 = _o_212;
    } else {
      _o_206 = 1;
      u64 _sp_87 = term_loc(_x_462);
      Term _f_113 = e.mem[_sp_87 + 0];
      heap_free(e, cls_fit(1), _sp_87);
      u32 _o_213 = 0;
      Term _o_214 = 0;
      Term _o_215 = 0;
      if (term_aux(_f_113) == CID____SRC_GIT_TYPES_LLANDED) {
        _o_213 = 0;
        u64 _sp_88 = term_loc(_f_113);
        Term _f_114 = e.mem[_sp_88 + 0];
        Term _f_115 = e.mem[_sp_88 + 1];
        heap_free(e, cls_fit(2), _sp_88);
        _o_214 = _f_114;
        _o_215 = _f_115;
      } else if (term_aux(_f_113) == CID____SRC_GIT_TYPES_LALREADY) {
        _o_213 = 1;
        u64 _sp_89 = term_loc(_f_113);
        Term _f_116 = e.mem[_sp_89 + 0];
        heap_free(e, cls_fit(1), _sp_89);
        _o_214 = _f_116;
      } else if (term_aux(_f_113) == CID____SRC_GIT_TYPES_LCONFLICT) {
        _o_213 = 2;
        u64 _sp_90 = term_loc(_f_113);
        Term _f_117 = e.mem[_sp_90 + 0];
        Term _f_118 = e.mem[_sp_90 + 1];
        heap_free(e, cls_fit(2), _sp_90);
        _o_214 = _f_117;
        _o_215 = _f_118;
      } else {
        _o_213 = 3;
        u64 _sp_91 = term_loc(_f_113);
        Term _f_119 = e.mem[_sp_91 + 0];
        heap_free(e, cls_fit(1), _sp_91);
        _o_214 = _f_119;
      }
      _o_207 = _o_213;
      _o_208 = _o_214;
      _o_209 = _o_215;
    }
    if (seq) {
      WL_ROOM(3);
      STK(0) = _x_461;
      STK(1) = _h_345;
      STK(2) = FID_MAIN_K2685;
      WL_PUSHN(3);
    } else {
      u64 _t_176 = task_node(e, FID_MAIN_K2685, WL_CONT, WL_IDX, 1);
      e.mem[_t_176 + 0] = _x_461;
      e.mem[_t_176 + 1] = _h_345;
      WL_CONT = term_tsk(FID_MAIN_K2685, _t_176);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID_IS_BUSY_FAIL)) {
      u64 _t_177 = task_node(e, FID_IS_BUSY_FAIL, WL_CONT, WL_IDX, 0);
      e.mem[_t_177 + 0] = _o_206;
      e.mem[_t_177 + 1] = _o_207;
      e.mem[_t_177 + 2] = _o_208;
      e.mem[_t_177 + 3] = _o_209;
      return term_tsk(FID_IS_BUSY_FAIL, _t_177);
    }
    r0 = _o_206;
    r1 = _o_207;
    r2 = _o_208;
    r3 = _o_209;
    WL_JMP(FID_IS_BUSY_FAIL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2685)
  {
    WL_POPN(2);
    Term _x_463 = STK(0);
    Term _h_346 = STK(1);
    Term _h_347 = r0;
    WL_OPEN
    u64 _nd_111 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_111 + 0] = _x_463;
    e.mem[_nd_111 + 1] = _h_346;
    e.mem[_nd_111 + 2] = _h_347;
    r0 = term_clo(FID_MAIN_C2686, _nd_111);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2686)
  {
    Term _x_464 = r0;
    Term _h_348 = r1;
    Term _h_349 = r2;
    Term _x_465 = r3;
    WL_OPEN
    u64 _nd_112 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_112 + 0] = _h_349;
    u64 _nd_113 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_113 + 0] = _x_464;
    e.mem[_nd_113 + 1] = _h_348;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_199 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_199 + 0] = term_clo(FID_MAIN_C2687, _nd_112);
      e.mem[_t_199 + 1] = term_clo(FID_MAIN_C2688, _nd_113);
      e.mem[_t_199 + 2] = _x_465;
      return term_tsk(FID_IO_BIND, _t_199);
    }
    r0 = term_clo(FID_MAIN_C2687, _nd_112);
    r1 = term_clo(FID_MAIN_C2688, _nd_113);
    r2 = _x_465;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2687)
  {
    Term _h_350 = r0;
    Term _x_466 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_178 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_178 + 0] = _h_350;
      e.mem[_t_178 + 1] = _x_466;
      return term_tsk(FID_IO_PURE, _t_178);
    }
    r0 = _h_350;
    r1 = _x_466;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2688)
  {
    Term _x_467 = r0;
    Term _h_351 = r1;
    Term _x_468 = r2;
    WL_OPEN
    _x_467 = term_keep(e, _x_467);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _x_467;
      STK(1) = _h_351;
      STK(2) = _x_468;
      STK(3) = FID_MAIN_K2689;
      WL_PUSHN(4);
    } else {
      u64 _t_179 = task_node(e, FID_MAIN_K2689, WL_CONT, WL_IDX, 1);
      e.mem[_t_179 + 0] = _x_467;
      e.mem[_t_179 + 1] = _h_351;
      e.mem[_t_179 + 2] = _x_468;
      WL_CONT = term_tsk(FID_MAIN_K2689, _t_179);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_180 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_180 + 0] = _x_467;
      e.mem[_t_180 + 1] = term_ctr(CID_SCON, STAT_OFF + 951);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_180);
    }
    r0 = _x_467;
    r1 = term_ctr(CID_SCON, STAT_OFF + 951);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2689)
  {
    WL_POPN(3);
    Term _x_469 = STK(0);
    Term _h_352 = STK(1);
    Term _x_470 = STK(2);
    Term _h_353 = r0;
    WL_OPEN
    _x_469 = term_keep(e, _x_469);
    u64 _nd_114 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_114 + 0] = _h_353;
    e.mem[_nd_114 + 1] = term_pak(CID_NIL, 0);
    u64 _nd_115 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_115 + 0] = term_ctr(CID_SCON, STAT_OFF + 1107);
    e.mem[_nd_115 + 1] = term_ctr(CID_CON, _nd_114);
    u64 _nd_116 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_116 + 0] = term_ctr(CID_SCON, STAT_OFF + 971);
    e.mem[_nd_116 + 1] = term_ctr(CID_CON, _nd_115);
    u64 _nd_117 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_117 + 0] = _x_469;
    e.mem[_nd_117 + 1] = term_ctr(CID_CON, _nd_116);
    u64 _nd_118 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_118 + 0] = term_ctr(CID_SCON, STAT_OFF + 957);
    e.mem[_nd_118 + 1] = term_ctr(CID_CON, _nd_117);
    u64 _nd_119 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_119 + 0] = term_ctr(CID_SCON, STAT_OFF + 953);
    e.mem[_nd_119 + 1] = term_ctr(CID_CON, _nd_118);
    if (seq) {
      WL_ROOM(4);
      STK(0) = _x_469;
      STK(1) = _h_352;
      STK(2) = _x_470;
      STK(3) = FID_MAIN_K2690;
      WL_PUSHN(4);
    } else {
      u64 _t_181 = task_node(e, FID_MAIN_K2690, WL_CONT, WL_IDX, 1);
      e.mem[_t_181 + 0] = _x_469;
      e.mem[_t_181 + 1] = _h_352;
      e.mem[_t_181 + 2] = _x_470;
      WL_CONT = term_tsk(FID_MAIN_K2690, _t_181);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
      u64 _t_182 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
      e.mem[_t_182 + 0] = term_ctr(CID_CON, _nd_119);
      e.mem[_t_182 + 1] = term_ctr(CID_SCON, STAT_OFF + 979);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_182);
    }
    r0 = term_ctr(CID_CON, _nd_119);
    r1 = term_ctr(CID_SCON, STAT_OFF + 979);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2690)
  {
    WL_POPN(3);
    Term _x_471 = STK(0);
    Term _h_354 = STK(1);
    Term _x_472 = STK(2);
    Term _h_355 = r0;
    WL_OPEN
    u64 _nd_120 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_120 + 0] = _x_471;
    e.mem[_nd_120 + 1] = _h_354;
    e.mem[_nd_120 + 2] = _x_472;
    e.mem[_nd_120 + 3] = _h_355;
    r0 = term_clo(FID_MAIN_C2691, _nd_120);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2691)
  {
    Term _x_473 = r0;
    Term _h_356 = r1;
    Term _x_474 = r2;
    Term _h_357 = r3;
    Term _x_475 = r4;
    WL_OPEN
    u64 _nd_121 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_121 + 0] = _x_473;
    e.mem[_nd_121 + 1] = _h_356;
    e.mem[_nd_121 + 2] = _x_474;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_198 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_198 + 0] = _h_357;
      e.mem[_t_198 + 1] = term_clo(FID_MAIN_C2692, _nd_121);
      e.mem[_t_198 + 2] = _x_475;
      return term_tsk(FID_IO_BIND, _t_198);
    }
    r0 = _h_357;
    r1 = term_clo(FID_MAIN_C2692, _nd_121);
    r2 = _x_475;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2692)
  {
    Term _x_476 = r0;
    Term _h_358 = r1;
    Term _x_477 = r2;
    Term _x_478 = r3;
    WL_OPEN
    u32 _o_216 = 0;
    Term _o_217 = 0;
    u32 _o_218 = 0;
    Term _o_219 = 0;
    if (term_aux(_x_478) == CID____SRC_GIT_TYPES_RRUN) {
      _o_216 = 0;
      Term _fb_18[3];
      u64 _sp_92 = ctr_take(e, _x_478, 3, _fb_18);
      u32 _f_120 = _fb_18[0];
      u32 _f_121 = _fb_18[1];
      Term _f_122 = _fb_18[2];
      spare_free(e, cls_fit(3), _sp_92);
      _o_217 = _f_120;
      _o_218 = _f_121;
      _o_219 = _f_122;
    } else {
      _o_216 = 1;
      u64 _sp_93 = term_loc(_x_478);
      Term _f_123 = e.mem[_sp_93 + 0];
      heap_free(e, cls_fit(1), _sp_93);
      _o_217 = _f_123;
    }
    term_sink(e, _o_217);
    term_sink(e, _o_219);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _x_476;
      STK(1) = FID_MAIN_K2693;
      WL_PUSHN(2);
    } else {
      u64 _t_183 = task_node(e, FID_MAIN_K2693, WL_CONT, WL_IDX, 1);
      e.mem[_t_183 + 0] = _x_476;
      WL_CONT = term_tsk(FID_MAIN_K2693, _t_183);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_184 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_184 + 0] = _h_358;
      e.mem[_t_184 + 1] = _x_477;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_184);
    }
    r0 = _h_358;
    r1 = _x_477;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2693)
  {
    WL_POPN(1);
    Term _x_479 = STK(0);
    Term _h_359 = r0;
    WL_OPEN
    _x_479 = term_keep(e, _x_479);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _x_479;
      STK(1) = _h_359;
      STK(2) = FID_MAIN_K2694;
      WL_PUSHN(3);
    } else {
      u64 _t_185 = task_node(e, FID_MAIN_K2694, WL_CONT, WL_IDX, 1);
      e.mem[_t_185 + 0] = _x_479;
      e.mem[_t_185 + 1] = _h_359;
      WL_CONT = term_tsk(FID_MAIN_K2694, _t_185);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_186 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_186 + 0] = _x_479;
      e.mem[_t_186 + 1] = term_ctr(CID_SCON, STAT_OFF + 657);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_186);
    }
    r0 = _x_479;
    r1 = term_ctr(CID_SCON, STAT_OFF + 657);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2694)
  {
    WL_POPN(2);
    Term _x_480 = STK(0);
    Term _h_360 = STK(1);
    Term _h_361 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _h_360;
      STK(1) = FID_MAIN_K2695;
      WL_PUSHN(2);
    } else {
      u64 _t_187 = task_node(e, FID_MAIN_K2695, WL_CONT, WL_IDX, 1);
      e.mem[_t_187 + 0] = _h_360;
      WL_CONT = term_tsk(FID_MAIN_K2695, _t_187);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID_LAND_OK)) {
      u64 _t_188 = task_node(e, FID_LAND_OK, WL_CONT, WL_IDX, 0);
      e.mem[_t_188 + 0] = _x_480;
      e.mem[_t_188 + 1] = term_ctr(CID_SCON, STAT_OFF + 663);
      e.mem[_t_188 + 2] = term_ctr(CID_SCON, STAT_OFF + 691);
      e.mem[_t_188 + 3] = term_ctr(CID_CON, STAT_OFF + 707);
      e.mem[_t_188 + 4] = term_ctr(CID_SCON, STAT_OFF + 729);
      e.mem[_t_188 + 5] = _h_361;
      return term_tsk(FID_LAND_OK, _t_188);
    }
    r0 = _x_480;
    r1 = term_ctr(CID_SCON, STAT_OFF + 663);
    r2 = term_ctr(CID_SCON, STAT_OFF + 691);
    r3 = term_ctr(CID_CON, STAT_OFF + 707);
    r4 = term_ctr(CID_SCON, STAT_OFF + 729);
    r5 = _h_361;
    WL_JMP(FID_LAND_OK);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2695)
  {
    WL_POPN(1);
    Term _h_362 = STK(0);
    Term _h_363 = r0;
    WL_OPEN
    u64 _nd_122 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_122 + 0] = _h_362;
    e.mem[_nd_122 + 1] = _h_363;
    r0 = term_clo(FID_MAIN_C2696, _nd_122);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2696)
  {
    Term _h_364 = r0;
    Term _h_365 = r1;
    Term _x_481 = r2;
    WL_OPEN
    u64 _nd_123 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_123 + 0] = _h_364;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_197 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_197 + 0] = _h_365;
      e.mem[_t_197 + 1] = term_clo(FID_MAIN_C2697, _nd_123);
      e.mem[_t_197 + 2] = _x_481;
      return term_tsk(FID_IO_BIND, _t_197);
    }
    r0 = _h_365;
    r1 = term_clo(FID_MAIN_C2697, _nd_123);
    r2 = _x_481;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2697)
  {
    Term _h_366 = r0;
    Term _x_482 = r1;
    WL_OPEN
    u32 _o_220 = 0;
    u32 _o_221 = 0;
    Term _o_222 = 0;
    Term _o_223 = 0;
    if (term_aux(_x_482) == CID_FAIL) {
      _o_220 = 0;
      Term _fb_19[1];
      u64 _sp_94 = ctr_take(e, _x_482, 1, _fb_19);
      Term _f_124 = _fb_19[0];
      spare_free(e, cls_fit(1), _sp_94);
      u32 _o_224 = 0;
      Term _o_225 = 0;
      Term _o_226 = 0;
      if (term_aux(_f_124) == CID____SRC_GIT_TYPES_FBRANCHEXISTS) {
        _o_224 = 0;
        u64 _sp_95 = term_loc(_f_124);
        Term _f_125 = e.mem[_sp_95 + 0];
        heap_free(e, cls_fit(1), _sp_95);
        _o_225 = _f_125;
      } else if (term_aux(_f_124) == CID____SRC_GIT_TYPES_FPATHEXISTS) {
        _o_224 = 1;
        u64 _sp_96 = term_loc(_f_124);
        Term _f_126 = e.mem[_sp_96 + 0];
        heap_free(e, cls_fit(1), _sp_96);
        _o_225 = _f_126;
      } else if (term_aux(_f_124) == CID____SRC_GIT_TYPES_FUNKNOWNBASE) {
        _o_224 = 2;
        u64 _sp_97 = term_loc(_f_124);
        Term _f_127 = e.mem[_sp_97 + 0];
        heap_free(e, cls_fit(1), _sp_97);
        _o_225 = _f_127;
      } else if (term_aux(_f_124) == CID____SRC_GIT_TYPES_FTARGETBUSY) {
        _o_224 = 3;
        u64 _sp_98 = term_loc(_f_124);
        Term _f_128 = e.mem[_sp_98 + 0];
        heap_free(e, cls_fit(1), _sp_98);
        _o_225 = _f_128;
      } else {
        _o_224 = 4;
        Term _fb_20[2];
        u64 _sp_99 = ctr_take(e, _f_124, 2, _fb_20);
        Term _f_129 = _fb_20[0];
        Term _f_130 = _fb_20[1];
        spare_free(e, cls_fit(2), _sp_99);
        _o_225 = _f_129;
        _o_226 = _f_130;
      }
      _o_221 = _o_224;
      _o_222 = _o_225;
      _o_223 = _o_226;
    } else {
      _o_220 = 1;
      u64 _sp_100 = term_loc(_x_482);
      Term _f_131 = e.mem[_sp_100 + 0];
      heap_free(e, cls_fit(1), _sp_100);
      u32 _o_227 = 0;
      Term _o_228 = 0;
      Term _o_229 = 0;
      if (term_aux(_f_131) == CID____SRC_GIT_TYPES_LLANDED) {
        _o_227 = 0;
        u64 _sp_101 = term_loc(_f_131);
        Term _f_132 = e.mem[_sp_101 + 0];
        Term _f_133 = e.mem[_sp_101 + 1];
        heap_free(e, cls_fit(2), _sp_101);
        _o_228 = _f_132;
        _o_229 = _f_133;
      } else if (term_aux(_f_131) == CID____SRC_GIT_TYPES_LALREADY) {
        _o_227 = 1;
        u64 _sp_102 = term_loc(_f_131);
        Term _f_134 = e.mem[_sp_102 + 0];
        heap_free(e, cls_fit(1), _sp_102);
        _o_228 = _f_134;
      } else if (term_aux(_f_131) == CID____SRC_GIT_TYPES_LCONFLICT) {
        _o_227 = 2;
        u64 _sp_103 = term_loc(_f_131);
        Term _f_135 = e.mem[_sp_103 + 0];
        Term _f_136 = e.mem[_sp_103 + 1];
        heap_free(e, cls_fit(2), _sp_103);
        _o_228 = _f_135;
        _o_229 = _f_136;
      } else {
        _o_227 = 3;
        u64 _sp_104 = term_loc(_f_131);
        Term _f_137 = e.mem[_sp_104 + 0];
        heap_free(e, cls_fit(1), _sp_104);
        _o_228 = _f_137;
      }
      _o_221 = _o_227;
      _o_222 = _o_228;
      _o_223 = _o_229;
    }
    if (seq) {
      WL_ROOM(2);
      STK(0) = _h_366;
      STK(1) = FID_MAIN_K2698;
      WL_PUSHN(2);
    } else {
      u64 _t_189 = task_node(e, FID_MAIN_K2698, WL_CONT, WL_IDX, 1);
      e.mem[_t_189 + 0] = _h_366;
      WL_CONT = term_tsk(FID_MAIN_K2698, _t_189);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID_IS_UNKNOWN_BASE)) {
      u64 _t_190 = task_node(e, FID_IS_UNKNOWN_BASE, WL_CONT, WL_IDX, 0);
      e.mem[_t_190 + 0] = _o_220;
      e.mem[_t_190 + 1] = _o_221;
      e.mem[_t_190 + 2] = _o_222;
      e.mem[_t_190 + 3] = _o_223;
      return term_tsk(FID_IS_UNKNOWN_BASE, _t_190);
    }
    r0 = _o_220;
    r1 = _o_221;
    r2 = _o_222;
    r3 = _o_223;
    WL_JMP(FID_IS_UNKNOWN_BASE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2698)
  {
    WL_POPN(1);
    Term _h_367 = STK(0);
    Term _h_368 = r0;
    WL_OPEN
    u64 _nd_124 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_124 + 0] = _h_367;
    e.mem[_nd_124 + 1] = _h_368;
    r0 = term_clo(FID_MAIN_C2699, _nd_124);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2699)
  {
    Term _h_369 = r0;
    Term _h_370 = r1;
    Term _x_483 = r2;
    WL_OPEN
    u64 _nd_125 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_125 + 0] = _h_370;
    u64 _nd_126 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_126 + 0] = _h_369;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_196 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_196 + 0] = term_clo(FID_MAIN_C2700, _nd_125);
      e.mem[_t_196 + 1] = term_clo(FID_MAIN_C2701, _nd_126);
      e.mem[_t_196 + 2] = _x_483;
      return term_tsk(FID_IO_BIND, _t_196);
    }
    r0 = term_clo(FID_MAIN_C2700, _nd_125);
    r1 = term_clo(FID_MAIN_C2701, _nd_126);
    r2 = _x_483;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2700)
  {
    Term _h_371 = r0;
    Term _x_484 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_191 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_191 + 0] = _h_371;
      e.mem[_t_191 + 1] = _x_484;
      return term_tsk(FID_IO_PURE, _t_191);
    }
    r0 = _h_371;
    r1 = _x_484;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2701)
  {
    Term _h_372 = r0;
    Term _x_485 = r1;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_MAIN_K2702;
      WL_PUSHN(1);
    } else {
      u64 _t_192 = task_node(e, FID_MAIN_K2702, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_MAIN_K2702, _t_192);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_193 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_193 + 0] = _h_372;
      e.mem[_t_193 + 1] = _x_485;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_193);
    }
    r0 = _h_372;
    r1 = _x_485;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2702)
  {
    Term _h_373 = r0;
    WL_OPEN
    u32 _v_17 = 0;
    u32 _v_18 = 0;
    Term _o_230[1];
    if (spin_3(e, _o_230, _h_373) == 0) {
      return 0;
    }
    _v_18 = _o_230[0];
    _v_17 = _v_18;
    if (_v_17 == 1) {
      if (seq) {
        WL_ROOM(1);
        STK(0) = FID_MAIN_K2703;
        WL_PUSHN(1);
      } else {
        u64 _t_194 = task_node(e, FID_MAIN_K2703, WL_CONT, WL_IDX, 1);
        WL_CONT = term_tsk(FID_MAIN_K2703, _t_194);
        WL_IDX = 0;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
        u64 _t_195 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
        e.mem[_t_195 + 0] = term_ctr(CID_SCON, STAT_OFF + 285);
        e.mem[_t_195 + 1] = _h_373;
        return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_195);
      }
      r0 = term_ctr(CID_SCON, STAT_OFF + 285);
      r1 = _h_373;
      WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
    } else {
      term_sink(e, _h_373);
      u64 _nd_128 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_128 + 0] = term_ctr(CID_SCON, STAT_OFF + 329);
      r0 = term_clo(FID_IO_PRINT, _nd_128);
      WL_RETN(1);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K2703)
  {
    Term _h_374 = r0;
    WL_OPEN
    u64 _nd_127 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_127 + 0] = _h_374;
    r0 = term_clo(FID_MAIN_C2704, _nd_127);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C2704)
  {
    Term _h_375 = r0;
    Term _x_486 = r1;
    WL_OPEN
    Term _v_19 = 0;
    Term _o_231[1];
    if (spin_32(e, _o_231, 1ull, _h_375, _x_486) == 0) {
      return 0;
    }
    _v_19 = _o_231[0];
    r0 = _v_19;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_PROCESS_RUN)
  {
    Term _argv_0 = r0;
    Term _cwd_0 = r1;
    Term _k_0 = r2;
    WL_OPEN
    u64 _nd_129 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_129 + 0] = _argv_0;
    e.mem[_nd_129 + 1] = _cwd_0;
    e.mem[_nd_129 + 2] = _k_0;
    r0 = term_ctr(CID_PROCESS_RUN, _nd_129);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_PRINT)
  {
    Term _text_0 = r0;
    Term _k_1 = r1;
    WL_OPEN
    u64 _nd_130 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_130 + 0] = _text_0;
    e.mem[_nd_130 + 1] = _k_1;
    r0 = term_ctr(CID_IO_PRINT, _nd_130);
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

// The C host half of Process.run: spawn one process with an argv built from
// the length-prefixed argument string, answer "exit <n>\n" or "signal <n>\n"
// followed by everything the child wrote to stdout and stderr (the child's
// stderr is duped onto stdout). A spawn or read failure answers io_fail with
// the errno; the blocking spawn and wait run through io_work like
// effs/file_read.c.
//
// Argument encoding: each argv element is its UTF-8 byte length in decimal, a
// colon, then the bytes; "0:" is an empty element. The encoding is
// self-describing and survives any bytes OS argv can carry, including spaces
// and newlines, so no element needs quoting and no shell runs anywhere.
//
// IoWork fields across the park, per the effs/ discipline of raw values only:
// hand = argv vector, text = cwd, data = output buffer, word = capacity,
// size = output length, made = kind * 1000 + status number, code = errno.

#include <errno.h>
#include <spawn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

extern char** environ;

#define GIT_PROC_KIND_EXIT 0
#define GIT_PROC_KIND_SIGNAL 1

static char** git_proc_parse_argv(const char* enc) {
  u32 cap = 8, argc = 0;
  char** argv = malloc(cap * sizeof(char*));
  const char* p = enc;
  while (*p) {
    char* end = NULL;
    unsigned long len = strtoul(p, &end, 10);
    if (end == p || *end != ':') {
      break; // unreachable for Bend-built input; stop rather than overrun
    }
    p = end + 1;
    if (argc + 2 > cap) {
      cap *= 2;
      argv = realloc(argv, cap * sizeof(char*));
    }
    argv[argc] = malloc((size_t)len + 1);
    memcpy(argv[argc], p, len);
    argv[argc][len] = 0;
    argc += 1;
    p += len;
  }
  argv[argc] = NULL;
  return argv;
}

static void git_proc_free_argv(char** argv) {
  for (int i = 0; argv[i]; i += 1) {
    free(argv[i]);
  }
  free(argv);
}

static void git_proc_call(IoWork* w) {
  char** argv = (char**)w->hand;
  char* cwd = w->text;
  int fds[2];
  if (pipe(fds) != 0) {
    w->code = errno;
    return;
  }
  posix_spawn_file_actions_t acts;
  posix_spawn_file_actions_init(&acts);
  posix_spawn_file_actions_addclose(&acts, fds[0]);
  posix_spawn_file_actions_adddup2(&acts, fds[1], 1);
  posix_spawn_file_actions_adddup2(&acts, fds[1], 2);
  posix_spawn_file_actions_addclose(&acts, fds[1]);
  posix_spawn_file_actions_addchdir_np(&acts, cwd);
  pid_t pid = -1;
  int rc = posix_spawnp(&pid, argv[0], &acts, NULL, argv, environ);
  posix_spawn_file_actions_destroy(&acts);
  close(fds[1]);
  if (rc != 0) {
    close(fds[0]);
    w->code = (u32)rc;
    return;
  }
  for (;;) {
    if (w->size == w->word) {
      w->word *= 2;
      w->data = io_mem(realloc(w->data, w->word));
    }
    ssize_t got = read(fds[0], w->data + w->size, w->word - w->size);
    if (got < 0) {
      if (errno == EINTR) {
        continue;
      }
      w->code = errno;
      close(fds[0]);
      return;
    }
    if (got == 0) {
      break;
    }
    w->size += (u32)got;
  }
  close(fds[0]);
  int st = 0;
  if (waitpid(pid, &st, 0) < 0) {
    w->code = errno;
    return;
  }
  if (WIFEXITED(st)) {
    w->made = GIT_PROC_KIND_EXIT * 1000 + WEXITSTATUS(st);
  } else if (WIFSIGNALED(st)) {
    w->made = GIT_PROC_KIND_SIGNAL * 1000 + WTERMSIG(st);
  } else {
    w->made = GIT_PROC_KIND_SIGNAL * 1000 + 127;
  }
}

static Term git_proc_pack(Env e, IoWork* w) {
  Term r;
  if (w->code) {
    r = io_fail(e, w->code, NULL);
  } else {
    int kind = (int)(w->made / 1000);
    int num = (int)(w->made % 1000);
    char head[20];
    int hn = snprintf(head, sizeof(head),
      kind == GIT_PROC_KIND_EXIT ? "exit %d\n" : "signal %d\n", num);
    char* out = malloc((u64)hn + w->size);
    memcpy(out, head, (u64)hn);
    memcpy(out + hn, w->data, w->size);
    r = io_done(e, io_str(e, out, hn + w->size));
    free(out);
  }
  git_proc_free_argv((char**)w->hand);
  free(w->text);
  free(w->data);
  return r;
}

#ifdef CID_PROCESS_RUN

Term process_run_run(Env e, Term* f, IoWork* w) {
  u64 alen = 0, clen = 0;
  char* enc = io_cstr(e, f[0], &alen);
  w->hand = (intptr_t)git_proc_parse_argv(enc);
  free(enc);
  w->text = io_cstr(e, f[1], &clen); // freed in pack
  w->word = 65536;
  w->size = 0;
  w->data = io_mem(malloc(w->word));
  w->made = 0;
  w->code = 0;
  return io_work(w, git_proc_call, git_proc_pack);
}

static void __attribute__((constructor)) process_run_use(void) {
  io_eff(CID_PROCESS_RUN, process_run_run, 0);
}

#endif
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
