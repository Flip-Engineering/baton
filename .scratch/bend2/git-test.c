
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
#define CID____SRC_GIT_TYPES_RRUN 14
#define CID____SRC_GIT_TYPES_RSPAWN 15
#define CID_NIL 16
#define CID_CON 17
#define CID____SRC_GIT_TYPES_GRUN 18
#define CID____SRC_GIT_TYPES_GBROKEN 19
#define CID____SRC_GIT_TYPES_SEXIT 20
#define CID____SRC_GIT_TYPES_SSIGNAL 21
#define CID____SRC_GIT_TYPES_FBRANCHEXISTS 22
#define CID____SRC_GIT_TYPES_FPATHEXISTS 23
#define CID____SRC_GIT_TYPES_FUNKNOWNBASE 24
#define CID____SRC_GIT_TYPES_FTARGETBUSY 25
#define CID____SRC_GIT_TYPES_FCMD 26
#define CID____SRC_GIT_TYPES_WCREATED 27
#define CID____SRC_GIT_CREATE_WORKTREE_CWDONE 28
#define CID____SRC_GIT_CREATE_WORKTREE_CWFAIL 29
#define CID____SRC_GIT_CREATE_WORKTREE_CWNEXT 30
#define CID____SRC_GIT_TYPES_WT 31
#define CID____SRC_GIT_STATUS_WSDONE 32
#define CID____SRC_GIT_STATUS_WSFAIL 33
#define CID____SRC_GIT_STATUS_WSNEXT 34
#define CID_IO_PRINT 35
#define CID_PROCESS_RUN 36
#define FID_U32_READ_GO 0
#define FID_U32_READ 1
#define FID____SRC_GIT_TEXT_RUN_RES_NUM 2
#define FID____SRC_GIT_TEXT_RUN_RES_NUM_K15 3
#define FID____SRC_GIT_STATUS_WS_STAGE3_PICK 4
#define FID____SRC_GIT_STATUS_WS_STAGE3_PICK_K17 5
#define FID____SRC_GIT_STATUS_WS_STAGE2_PICK 6
#define FID____SRC_GIT_STATUS_WS_STAGE2_PICK_K19 7
#define FID____SRC_GIT_STATUS_WS_STAGE2_PICK_K20 8
#define FID____SRC_GIT_STATUS_WS_STAGE1_PICK 9
#define FID____SRC_GIT_STATUS_WS_STAGE1_PICK_K40 10
#define FID____SRC_GIT_STATUS_WS_STAGE1_PICK_K41 11
#define FID____SRC_GIT_STATUS_STATUS_DIRTY_FAIL 12
#define FID____SRC_GIT_STATUS_STATUS_DIRTY_FAIL_K54 13
#define FID____SRC_GIT_STATUS_STATUS_DIRTY_FAIL_K55 14
#define FID____SRC_GIT_STATUS_WS_GO3 15
#define FID____SRC_GIT_STATUS_WS_GO3_C62 16
#define FID____SRC_GIT_STATUS_WS_GO3_C63 17
#define FID____SRC_GIT_STATUS_WS_GO3_K64 18
#define FID____SRC_GIT_STATUS_WS_GO3_C65 19
#define FID____SRC_GIT_STATUS_WS_GO3_C66 20
#define FID____SRC_GIT_STATUS_WS_GO3_K67 21
#define FID____SRC_GIT_STATUS_WS_GO3_C68 22
#define FID____SRC_GIT_STATUS_WS_GO2 23
#define FID____SRC_GIT_STATUS_WS_GO2_C70 24
#define FID____SRC_GIT_STATUS_WS_GO2_C71 25
#define FID____SRC_GIT_STATUS_WS_GO2_K72 26
#define FID____SRC_GIT_STATUS_WS_GO2_C73 27
#define FID____SRC_GIT_STATUS_WS_GO2_C74 28
#define FID____SRC_GIT_STATUS_WS_GO2_K75 29
#define FID____SRC_GIT_STATUS_WS_GO2_C76 30
#define FID____SRC_GIT_STATUS_WS_STAGE1 31
#define FID____SRC_GIT_STATUS_WS_STAGE1_K78 32
#define FID____SRC_GIT_STATUS_WS_STAGE1_C79 33
#define FID____SRC_GIT_STATUS_WS_STAGE1_C80 34
#define FID____SRC_GIT_STATUS_WS_STAGE1_K81 35
#define FID____SRC_GIT_STATUS_WS_STAGE1_C82 36
#define FID_CHK_STATUS_DIRTY 37
#define FID_CHK_STATUS_DIRTY_K92 38
#define FID_CHK_STATUS_DIRTY_K93 39
#define FID_CHK_STATUS_DIRTY_C94 40
#define FID_CHK_STATUS_DIRTY_C95 41
#define FID_CHK_STATUS_DIRTY_C96 42
#define FID_CHK_STATUS_DIRTY_C97 43
#define FID_CHK_STATUS_DIRTY_C98 44
#define FID_CHK_STATUS_DIRTY_K99 45
#define FID_CHK_STATUS_DIRTY_C100 46
#define FID_CHK_STATUS_DIRTY_C101 47
#define FID_CHK_STATUS_DIRTY_K102 48
#define FID_CHK_STATUS_DIRTY_C103 49
#define FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL 50
#define FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL_K105 51
#define FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL_K106 52
#define FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL_K107 53
#define FID____SRC_GIT_STATUS_WORKTREESTATUS 54
#define FID____SRC_GIT_STATUS_WORKTREESTATUS_K109 55
#define FID____SRC_GIT_STATUS_WORKTREESTATUS_C110 56
#define FID____SRC_GIT_STATUS_WORKTREESTATUS_C111 57
#define FID____SRC_GIT_STATUS_WORKTREESTATUS_K112 58
#define FID____SRC_GIT_STATUS_WORKTREESTATUS_C113 59
#define FID____SRC_GIT_STATUS_WORKTREESTATUS_C114 60
#define FID____SRC_GIT_STATUS_WORKTREESTATUS_K115 61
#define FID____SRC_GIT_STATUS_WORKTREESTATUS_C116 62
#define FID____SRC_GIT_STATUS_WORKTREESTATUS_C117 63
#define FID____SRC_GIT_STATUS_WS_ANSWER_C118 64
#define FID____SRC_GIT_STATUS_WS_ANSWER_C119 65
#define FID____SRC_GIT_STATUS_WS_ANSWER_C120 66
#define FID_U32_SHOW_GO 67
#define FID_CHK_STATUS_CLEAN 68
#define FID_CHK_STATUS_CLEAN_K139 69
#define FID_CHK_STATUS_CLEAN_C140 70
#define FID_CHK_STATUS_CLEAN_C141 71
#define FID_CHK_STATUS_CLEAN_K142 72
#define FID_CHK_STATUS_CLEAN_C143 73
#define FID____SRC_GIT_CREATE_WORKTREE_IS_UNKNOWN_BASE_FAIL 74
#define FID____SRC_GIT_CREATE_WORKTREE_IS_UNKNOWN_BASE_FAIL_K145 75
#define FID____SRC_GIT_CREATE_WORKTREE_IS_UNKNOWN_BASE_FAIL_K146 76
#define FID____SRC_GIT_TYPES_STR_CAT2 77
#define FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE4_PICK 78
#define FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE4_PICK_K151 79
#define FID_CHK_UNKNOWN_BASE 80
#define FID_CHK_UNKNOWN_BASE_K173 81
#define FID_CHK_UNKNOWN_BASE_C174 82
#define FID_CHK_UNKNOWN_BASE_C175 83
#define FID_CHK_UNKNOWN_BASE_K176 84
#define FID_CHK_UNKNOWN_BASE_C177 85
#define FID____SRC_GIT_CREATE_WORKTREE_IS_PATH_EXISTS_FAIL 86
#define FID____SRC_GIT_CREATE_WORKTREE_IS_PATH_EXISTS_FAIL_K179 87
#define FID____SRC_GIT_CREATE_WORKTREE_IS_PATH_EXISTS_FAIL_K180 88
#define FID____SRC_GIT_TYPES_FAIL_TEXT 89
#define FID____SRC_GIT_TYPES_FAIL_TEXT_K182 90
#define FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_PICK 91
#define FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_PICK_K202 92
#define FID_U32_SHOW 93
#define FID_CHK_PATH_EXISTS 94
#define FID_CHK_PATH_EXISTS_K230 95
#define FID_CHK_PATH_EXISTS_C231 96
#define FID_CHK_PATH_EXISTS_C232 97
#define FID_CHK_PATH_EXISTS_K233 98
#define FID_CHK_PATH_EXISTS_C234 99
#define FID____SRC_GIT_CREATE_WORKTREE_IS_BRANCH_EXISTS_FAIL 100
#define FID____SRC_GIT_CREATE_WORKTREE_IS_BRANCH_EXISTS_FAIL_K236 101
#define FID____SRC_GIT_CREATE_WORKTREE_IS_BRANCH_EXISTS_FAIL_K237 102
#define FID____SRC_GIT_TEXT_STR_EQ_GO 103
#define FID____SRC_GIT_TEXT_STR_EQ_GO_K239 104
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO4 105
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C246 106
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C247 107
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K248 108
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C249 109
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C250 110
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K251 111
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C252 112
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO3 113
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C254 114
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C255 115
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_K256 116
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C257 117
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C258 118
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C259 119
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO2 120
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C261 121
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C262 122
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K263 123
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K264 124
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C265 125
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C266 126
#define FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C267 127
#define FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1 128
#define FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K269 129
#define FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K270 130
#define FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C271 131
#define FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C272 132
#define FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K273 133
#define FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C274 134
#define FID____SRC_GIT_TEXT_ENC_ARGV_GO 135
#define FID____SRC_GIT_TEXT_ENC_ARGV_GO_K280 136
#define FID____SRC_GIT_TEXT_ENC_ARGV_GO_K281 137
#define FID____SRC_GIT_TEXT_ENC_ARGV_GO_K282 138
#define FID____SRC_GIT_TEXT_ENC_ARGV_GO_K283 139
#define FID____SRC_GIT_TEXT_JOIN_GO 140
#define FID____SRC_GIT_TEXT_JOIN_GO_K288 141
#define FID____SRC_GIT_TEXT_JOIN_GO_K289 142
#define FID_CHK_BRANCH_EXISTS 143
#define FID_CHK_BRANCH_EXISTS_K310 144
#define FID_CHK_BRANCH_EXISTS_C311 145
#define FID_CHK_BRANCH_EXISTS_C312 146
#define FID_CHK_BRANCH_EXISTS_K313 147
#define FID_CHK_BRANCH_EXISTS_C314 148
#define FID____SRC_GIT_TEXT_STR_EQ 149
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE 150
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K320 151
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C321 152
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C322 153
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K323 154
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C324 155
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C325 156
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K326 157
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C327 158
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C328 159
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K329 160
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C330 161
#define FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C331 162
#define FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C332 163
#define FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C333 164
#define FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C334 165
#define FID_STRING_APPEND 166
#define FID_STRING_APPEND_K336 167
#define FID____SRC_GIT_TEXT_RUN_RES 168
#define FID____SRC_GIT_TEXT_RUN_RES_K339 169
#define FID____SRC_GIT_TEXT_RUN_RES_K340 170
#define FID____SRC_GIT_TEXT_RUN_RES_K341 171
#define FID____SRC_GIT_TEXT_ENC_ARGV 172
#define FID____SRC_GIT_TEXT_JOIN 173
#define FID_CHK_CREATE_OK 174
#define FID_CHK_CREATE_OK_K370 175
#define FID_CHK_CREATE_OK_C371 176
#define FID_CHK_CREATE_OK_C372 177
#define FID_CHK_CREATE_OK_K373 178
#define FID_CHK_CREATE_OK_C374 179
#define FID____SRC_GIT_TEXT_STR_CAT 180
#define FID_IO_PURE 181
#define FID____SRC_GIT_PROCESS_RUNGIT 182
#define FID____SRC_GIT_PROCESS_RUNGIT_K379 183
#define FID____SRC_GIT_PROCESS_RUNGIT_C380 184
#define FID____SRC_GIT_PROCESS_RUNGIT_C381 185
#define FID____SRC_GIT_PROCESS_RUNGIT_C382 186
#define FID_GIT_SEQ 187
#define FID_GIT_SEQ_C384 188
#define FID_GIT_SEQ_K385 189
#define FID_GIT_SEQ_C386 190
#define FID_GIT_SEQ_C387 191
#define FID____SRC_GIT_PROCESS_RUNFULL 192
#define FID____SRC_GIT_PROCESS_RUNFULL_K389 193
#define FID____SRC_GIT_PROCESS_RUNFULL_C390 194
#define FID____SRC_GIT_PROCESS_RUNFULL_C391 195
#define FID____SRC_GIT_PROCESS_RUNFULL_K392 196
#define FID____SRC_GIT_PROCESS_RUNFULL_C393 197
#define FID____SRC_GIT_TEXT_TRIM_NL 198
#define FID_SETUP 199
#define FID_SETUP_K426 200
#define FID_SETUP_C427 201
#define FID_SETUP_C428 202
#define FID_SETUP_C429 203
#define FID_SETUP_C430 204
#define FID_SETUP_C431 205
#define FID_SETUP_C432 206
#define FID_SETUP_K433 207
#define FID_SETUP_C434 208
#define FID_SETUP_C435 209
#define FID_SETUP_K436 210
#define FID_SETUP_C437 211
#define FID_IO_BIND 212
#define FID_IO_BIND_C439 213
#define FID_IO_BIND_K440 214
#define FID_MAIN 215
#define FID_MAIN_K442 216
#define FID_MAIN_C443 217
#define FID_MAIN_C444 218
#define FID_MAIN_K445 219
#define FID_MAIN_K446 220
#define FID_MAIN_C447 221
#define FID_MAIN_C448 222
#define FID_MAIN_K449 223
#define FID_MAIN_C450 224
#define FID_MAIN_C451 225
#define FID_MAIN_K452 226
#define FID_MAIN_K453 227
#define FID_MAIN_C454 228
#define FID_MAIN_C455 229
#define FID_MAIN_K456 230
#define FID_MAIN_K457 231
#define FID_MAIN_C458 232
#define FID_MAIN_C459 233
#define FID_MAIN_K460 234
#define FID_MAIN_K461 235
#define FID_MAIN_C462 236
#define FID_MAIN_C463 237
#define FID_MAIN_K464 238
#define FID_MAIN_K465 239
#define FID_MAIN_C466 240
#define FID_MAIN_C467 241
#define FID_MAIN_K468 242
#define FID_MAIN_K469 243
#define FID_MAIN_C470 244
#define FID_MAIN_C471 245
#define FID_MAIN_K472 246
#define FID_MAIN_K473 247
#define FID_MAIN_C474 248
#define FID_IO_PRINT 249
#define FID_PROCESS_RUN 250
#define FID_IO_EMIT 251
#define FID_CLO_APPLY 252
#define FID_EXIT 253
#define FID_ENTER 254
CONSTV u8 FID_ARITY_T[] = { 2, 1, 3, 4, 5, 1, 5, 2, 1, 4, 1, 1, 5, 1, 1, 5, 4, 4, 3, 4, 3, 4, 5, 5, 4, 4, 3, 4, 3, 4, 5, 1, 2, 3, 2, 4, 5, 2, 3, 3, 4, 2, 1, 1, 3, 2, 3, 2, 1, 2, 5, 2, 1, 1, 1, 2, 3, 2, 2, 3, 2, 1, 2, 1, 4, 4, 1, 3, 2, 2, 3, 2, 1, 2, 4, 1, 1, 2, 6, 1, 3, 1, 2, 1, 1, 2, 4, 1, 1, 3, 2, 4, 1, 1, 3, 1, 2, 1, 1, 2, 4, 1, 1, 2, 2, 7, 4, 4, 4, 5, 4, 4, 5, 7, 4, 4, 3, 4, 3, 7, 7, 4, 4, 4, 3, 4, 3, 6, 4, 3, 2, 3, 2, 4, 5, 2, 4, 4, 3, 2, 3, 4, 3, 3, 1, 2, 1, 1, 2, 2, 4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 1, 2, 1, 4, 4, 1, 2, 2, 3, 2, 4, 3, 1, 2, 3, 2, 3, 2, 1, 2, 2, 2, 2, 1, 2, 1, 5, 3, 1, 4, 5, 4, 2, 2, 3, 1, 4, 5, 1, 1, 2, 3, 3, 3, 2, 2, 2, 1, 2, 1, 1, 2, 3, 3, 2, 0, 1, 2, 1, 1, 2, 3, 2, 2, 3, 2, 2, 3, 4, 3, 2, 3, 4, 3, 2, 3, 4, 3, 2, 3, 4, 3, 2, 2, 3, 2, 1, 1, 2, 2, 3, 1, 2 };
CONSTV u8 FID_FLAG_T[] = { 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2 };
CONSTV u8 FID_RESW_T[] = { 0, 0, 0, 2, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 0, 0, 1, 0, 0, 4, 0, 0, 0, 0, 1, 0, 0, 4, 0, 0, 1, 0, 0, 4, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 4, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 4, 0, 0, 1, 1, 1, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 4, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0 };
CONSTV u8 CID_ARITY_T[] = { 2, 0, 2, 2, 1, 2, 1, 1, 0, 1, 0, 0, 0, 1, 3, 1, 0, 2, 2, 1, 1, 1, 1, 1, 1, 1, 2, 3, 3, 3, 1, 3, 3, 3, 2, 2, 3 };
CONSTV u8 CID_HOT_T[] = { 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };
#define STAT_LEN 1619

#define WL_RESW 4
#define BANGS   0

#define WL_BANK Term r0, r1, r2, r3, r4, r5, rp, r6;

#define WL_LOAD(A, N) \
  do { \
    if ((N) <= 0) break; r0 = e.mem[(A) + 0]; \
    if ((N) <= 1) break; r1 = e.mem[(A) + 1]; \
    if ((N) <= 2) break; r2 = e.mem[(A) + 2]; \
    if ((N) <= 3) break; r3 = e.mem[(A) + 3]; \
    if ((N) <= 4) break; r4 = e.mem[(A) + 4]; \
    if ((N) <= 5) break; r5 = e.mem[(A) + 5]; \
    if ((N) <= 6) break; r6 = e.mem[(A) + 6]; \
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
  }

#define WL_SAVE(V) (V)[0] = r0; (V)[1] = r1; (V)[2] = r2; (V)[3] = r3;

#define WL_TAKE(V) r0 = (V)[0]; r1 = (V)[1]; r2 = (V)[2]; r3 = (V)[3];

#define WL_SIG Env e, Stk sp, u32 seq, u32 rn, Term r0, Term r1, Term r2, Term r3, Term r4, Term r5, Term rp, Term r6

#define WL_ALL e, sp, seq, rn, r0, r1, r2, r3, r4, r5, rp, r6

#define WL_TABLE WL_X(FID_U32_READ_GO) WL_X(FID_U32_READ) WL_X(FID____SRC_GIT_TEXT_RUN_RES_NUM) WL_X(FID____SRC_GIT_TEXT_RUN_RES_NUM_K15) WL_X(FID____SRC_GIT_STATUS_WS_STAGE3_PICK) WL_X(FID____SRC_GIT_STATUS_WS_STAGE3_PICK_K17) WL_X(FID____SRC_GIT_STATUS_WS_STAGE2_PICK) WL_X(FID____SRC_GIT_STATUS_WS_STAGE2_PICK_K19) WL_X(FID____SRC_GIT_STATUS_WS_STAGE2_PICK_K20) WL_X(FID____SRC_GIT_STATUS_WS_STAGE1_PICK) WL_X(FID____SRC_GIT_STATUS_WS_STAGE1_PICK_K40) WL_X(FID____SRC_GIT_STATUS_WS_STAGE1_PICK_K41) WL_X(FID____SRC_GIT_STATUS_STATUS_DIRTY_FAIL) WL_X(FID____SRC_GIT_STATUS_STATUS_DIRTY_FAIL_K54) WL_X(FID____SRC_GIT_STATUS_STATUS_DIRTY_FAIL_K55) WL_X(FID____SRC_GIT_STATUS_WS_GO3) WL_X(FID____SRC_GIT_STATUS_WS_GO3_C62) WL_X(FID____SRC_GIT_STATUS_WS_GO3_C63) WL_X(FID____SRC_GIT_STATUS_WS_GO3_K64) WL_X(FID____SRC_GIT_STATUS_WS_GO3_C65) WL_X(FID____SRC_GIT_STATUS_WS_GO3_C66) WL_X(FID____SRC_GIT_STATUS_WS_GO3_K67) WL_X(FID____SRC_GIT_STATUS_WS_GO3_C68) WL_X(FID____SRC_GIT_STATUS_WS_GO2) WL_X(FID____SRC_GIT_STATUS_WS_GO2_C70) WL_X(FID____SRC_GIT_STATUS_WS_GO2_C71) WL_X(FID____SRC_GIT_STATUS_WS_GO2_K72) WL_X(FID____SRC_GIT_STATUS_WS_GO2_C73) WL_X(FID____SRC_GIT_STATUS_WS_GO2_C74) WL_X(FID____SRC_GIT_STATUS_WS_GO2_K75) WL_X(FID____SRC_GIT_STATUS_WS_GO2_C76) WL_X(FID____SRC_GIT_STATUS_WS_STAGE1) WL_X(FID____SRC_GIT_STATUS_WS_STAGE1_K78) WL_X(FID____SRC_GIT_STATUS_WS_STAGE1_C79) WL_X(FID____SRC_GIT_STATUS_WS_STAGE1_C80) WL_X(FID____SRC_GIT_STATUS_WS_STAGE1_K81) WL_X(FID____SRC_GIT_STATUS_WS_STAGE1_C82) WL_X(FID_CHK_STATUS_DIRTY) WL_X(FID_CHK_STATUS_DIRTY_K92) WL_X(FID_CHK_STATUS_DIRTY_K93) WL_X(FID_CHK_STATUS_DIRTY_C94) WL_X(FID_CHK_STATUS_DIRTY_C95) WL_X(FID_CHK_STATUS_DIRTY_C96) WL_X(FID_CHK_STATUS_DIRTY_C97) WL_X(FID_CHK_STATUS_DIRTY_C98) WL_X(FID_CHK_STATUS_DIRTY_K99) WL_X(FID_CHK_STATUS_DIRTY_C100) WL_X(FID_CHK_STATUS_DIRTY_C101) WL_X(FID_CHK_STATUS_DIRTY_K102) WL_X(FID_CHK_STATUS_DIRTY_C103) WL_X(FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL) WL_X(FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL_K105) WL_X(FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL_K106) WL_X(FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL_K107) WL_X(FID____SRC_GIT_STATUS_WORKTREESTATUS) WL_X(FID____SRC_GIT_STATUS_WORKTREESTATUS_K109) WL_X(FID____SRC_GIT_STATUS_WORKTREESTATUS_C110) WL_X(FID____SRC_GIT_STATUS_WORKTREESTATUS_C111) WL_X(FID____SRC_GIT_STATUS_WORKTREESTATUS_K112) WL_X(FID____SRC_GIT_STATUS_WORKTREESTATUS_C113) WL_X(FID____SRC_GIT_STATUS_WORKTREESTATUS_C114) WL_X(FID____SRC_GIT_STATUS_WORKTREESTATUS_K115) WL_X(FID____SRC_GIT_STATUS_WORKTREESTATUS_C116) WL_X(FID____SRC_GIT_STATUS_WORKTREESTATUS_C117) WL_X(FID____SRC_GIT_STATUS_WS_ANSWER_C118) WL_X(FID____SRC_GIT_STATUS_WS_ANSWER_C119) WL_X(FID____SRC_GIT_STATUS_WS_ANSWER_C120) WL_X(FID_U32_SHOW_GO) WL_X(FID_CHK_STATUS_CLEAN) WL_X(FID_CHK_STATUS_CLEAN_K139) WL_X(FID_CHK_STATUS_CLEAN_C140) WL_X(FID_CHK_STATUS_CLEAN_C141) WL_X(FID_CHK_STATUS_CLEAN_K142) WL_X(FID_CHK_STATUS_CLEAN_C143) WL_X(FID____SRC_GIT_CREATE_WORKTREE_IS_UNKNOWN_BASE_FAIL) WL_X(FID____SRC_GIT_CREATE_WORKTREE_IS_UNKNOWN_BASE_FAIL_K145) WL_X(FID____SRC_GIT_CREATE_WORKTREE_IS_UNKNOWN_BASE_FAIL_K146) WL_X(FID____SRC_GIT_TYPES_STR_CAT2) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE4_PICK) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE4_PICK_K151) WL_X(FID_CHK_UNKNOWN_BASE) WL_X(FID_CHK_UNKNOWN_BASE_K173) WL_X(FID_CHK_UNKNOWN_BASE_C174) WL_X(FID_CHK_UNKNOWN_BASE_C175) WL_X(FID_CHK_UNKNOWN_BASE_K176) WL_X(FID_CHK_UNKNOWN_BASE_C177) WL_X(FID____SRC_GIT_CREATE_WORKTREE_IS_PATH_EXISTS_FAIL) WL_X(FID____SRC_GIT_CREATE_WORKTREE_IS_PATH_EXISTS_FAIL_K179) WL_X(FID____SRC_GIT_CREATE_WORKTREE_IS_PATH_EXISTS_FAIL_K180) WL_X(FID____SRC_GIT_TYPES_FAIL_TEXT) WL_X(FID____SRC_GIT_TYPES_FAIL_TEXT_K182) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_PICK) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_PICK_K202) WL_X(FID_U32_SHOW) WL_X(FID_CHK_PATH_EXISTS) WL_X(FID_CHK_PATH_EXISTS_K230) WL_X(FID_CHK_PATH_EXISTS_C231) WL_X(FID_CHK_PATH_EXISTS_C232) WL_X(FID_CHK_PATH_EXISTS_K233) WL_X(FID_CHK_PATH_EXISTS_C234) WL_X(FID____SRC_GIT_CREATE_WORKTREE_IS_BRANCH_EXISTS_FAIL) WL_X(FID____SRC_GIT_CREATE_WORKTREE_IS_BRANCH_EXISTS_FAIL_K236) WL_X(FID____SRC_GIT_CREATE_WORKTREE_IS_BRANCH_EXISTS_FAIL_K237) WL_X(FID____SRC_GIT_TEXT_STR_EQ_GO) WL_X(FID____SRC_GIT_TEXT_STR_EQ_GO_K239) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C246) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C247) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K248) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C249) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C250) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K251) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C252) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C254) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C255) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_K256) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C257) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C258) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C259) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C261) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C262) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K263) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K264) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C265) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C266) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C267) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K269) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K270) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C271) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C272) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K273) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C274) WL_X(FID____SRC_GIT_TEXT_ENC_ARGV_GO) WL_X(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K280) WL_X(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K281) WL_X(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K282) WL_X(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K283) WL_X(FID____SRC_GIT_TEXT_JOIN_GO) WL_X(FID____SRC_GIT_TEXT_JOIN_GO_K288) WL_X(FID____SRC_GIT_TEXT_JOIN_GO_K289) WL_X(FID_CHK_BRANCH_EXISTS) WL_X(FID_CHK_BRANCH_EXISTS_K310) WL_X(FID_CHK_BRANCH_EXISTS_C311) WL_X(FID_CHK_BRANCH_EXISTS_C312) WL_X(FID_CHK_BRANCH_EXISTS_K313) WL_X(FID_CHK_BRANCH_EXISTS_C314) WL_X(FID____SRC_GIT_TEXT_STR_EQ) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K320) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C321) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C322) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K323) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C324) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C325) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K326) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C327) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C328) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K329) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C330) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C331) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C332) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C333) WL_X(FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C334) WL_X(FID_STRING_APPEND) WL_X(FID_STRING_APPEND_K336) WL_X(FID____SRC_GIT_TEXT_RUN_RES) WL_X(FID____SRC_GIT_TEXT_RUN_RES_K339) WL_X(FID____SRC_GIT_TEXT_RUN_RES_K340) WL_X(FID____SRC_GIT_TEXT_RUN_RES_K341) WL_X(FID____SRC_GIT_TEXT_ENC_ARGV) WL_X(FID____SRC_GIT_TEXT_JOIN) WL_X(FID_CHK_CREATE_OK) WL_X(FID_CHK_CREATE_OK_K370) WL_X(FID_CHK_CREATE_OK_C371) WL_X(FID_CHK_CREATE_OK_C372) WL_X(FID_CHK_CREATE_OK_K373) WL_X(FID_CHK_CREATE_OK_C374) WL_X(FID____SRC_GIT_TEXT_STR_CAT) WL_X(FID_IO_PURE) WL_X(FID____SRC_GIT_PROCESS_RUNGIT) WL_X(FID____SRC_GIT_PROCESS_RUNGIT_K379) WL_X(FID____SRC_GIT_PROCESS_RUNGIT_C380) WL_X(FID____SRC_GIT_PROCESS_RUNGIT_C381) WL_X(FID____SRC_GIT_PROCESS_RUNGIT_C382) WL_X(FID_GIT_SEQ) WL_X(FID_GIT_SEQ_C384) WL_X(FID_GIT_SEQ_K385) WL_X(FID_GIT_SEQ_C386) WL_X(FID_GIT_SEQ_C387) WL_X(FID____SRC_GIT_PROCESS_RUNFULL) WL_X(FID____SRC_GIT_PROCESS_RUNFULL_K389) WL_X(FID____SRC_GIT_PROCESS_RUNFULL_C390) WL_X(FID____SRC_GIT_PROCESS_RUNFULL_C391) WL_X(FID____SRC_GIT_PROCESS_RUNFULL_K392) WL_X(FID____SRC_GIT_PROCESS_RUNFULL_C393) WL_X(FID____SRC_GIT_TEXT_TRIM_NL) WL_X(FID_SETUP) WL_X(FID_SETUP_K426) WL_X(FID_SETUP_C427) WL_X(FID_SETUP_C428) WL_X(FID_SETUP_C429) WL_X(FID_SETUP_C430) WL_X(FID_SETUP_C431) WL_X(FID_SETUP_C432) WL_X(FID_SETUP_K433) WL_X(FID_SETUP_C434) WL_X(FID_SETUP_C435) WL_X(FID_SETUP_K436) WL_X(FID_SETUP_C437) WL_X(FID_IO_BIND) WL_X(FID_IO_BIND_C439) WL_X(FID_IO_BIND_K440) WL_X(FID_MAIN) WL_X(FID_MAIN_K442) WL_X(FID_MAIN_C443) WL_X(FID_MAIN_C444) WL_X(FID_MAIN_K445) WL_X(FID_MAIN_K446) WL_X(FID_MAIN_C447) WL_X(FID_MAIN_C448) WL_X(FID_MAIN_K449) WL_X(FID_MAIN_C450) WL_X(FID_MAIN_C451) WL_X(FID_MAIN_K452) WL_X(FID_MAIN_K453) WL_X(FID_MAIN_C454) WL_X(FID_MAIN_C455) WL_X(FID_MAIN_K456) WL_X(FID_MAIN_K457) WL_X(FID_MAIN_C458) WL_X(FID_MAIN_C459) WL_X(FID_MAIN_K460) WL_X(FID_MAIN_K461) WL_X(FID_MAIN_C462) WL_X(FID_MAIN_C463) WL_X(FID_MAIN_K464) WL_X(FID_MAIN_K465) WL_X(FID_MAIN_C466) WL_X(FID_MAIN_C467) WL_X(FID_MAIN_K468) WL_X(FID_MAIN_K469) WL_X(FID_MAIN_C470) WL_X(FID_MAIN_C471) WL_X(FID_MAIN_K472) WL_X(FID_MAIN_K473) WL_X(FID_MAIN_C474) WL_X(FID_IO_PRINT) WL_X(FID_PROCESS_RUN) WL_X(FID_IO_EMIT) WL_X(FID_CLO_APPLY) WL_X(FID_EXIT)
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

CONSTV u64 STAT_IMG[] = { 114ull, term_pak(CID_SNIL, 0), 101ull, term_ctr(CID_SCON, STAT_OFF + 0), 98ull, term_ctr(CID_SCON, STAT_OFF + 2), 109ull, term_ctr(CID_SCON, STAT_OFF + 4), 117ull, term_ctr(CID_SCON, STAT_OFF + 6), 110ull, term_ctr(CID_SCON, STAT_OFF + 8), 32ull, term_ctr(CID_SCON, STAT_OFF + 10), 115ull, term_ctr(CID_SCON, STAT_OFF + 12), 117ull, term_ctr(CID_SCON, STAT_OFF + 14), 116ull, term_ctr(CID_SCON, STAT_OFF + 16), 97ull, term_ctr(CID_SCON, STAT_OFF + 18), 116ull, term_ctr(CID_SCON, STAT_OFF + 20), 115ull, term_ctr(CID_SCON, STAT_OFF + 22), 32ull, term_ctr(CID_SCON, STAT_OFF + 24), 100ull, term_ctr(CID_SCON, STAT_OFF + 26), 101ull, term_ctr(CID_SCON, STAT_OFF + 28), 109ull, term_ctr(CID_SCON, STAT_OFF + 30), 114ull, term_ctr(CID_SCON, STAT_OFF + 32), 111ull, term_ctr(CID_SCON, STAT_OFF + 34), 102ull, term_ctr(CID_SCON, STAT_OFF + 36), 108ull, term_ctr(CID_SCON, STAT_OFF + 38), 97ull, term_ctr(CID_SCON, STAT_OFF + 40), 109ull, term_ctr(CID_SCON, STAT_OFF + 42), 115ull, term_pak(CID_SNIL, 0), 117ull, term_ctr(CID_SCON, STAT_OFF + 46), 116ull, term_ctr(CID_SCON, STAT_OFF + 48), 97ull, term_ctr(CID_SCON, STAT_OFF + 50), 116ull, term_ctr(CID_SCON, STAT_OFF + 52), 115ull, term_ctr(CID_SCON, STAT_OFF + 54), 45ull, term_ctr(CID_SCON, STAT_OFF + 56), 101ull, term_ctr(CID_SCON, STAT_OFF + 58), 101ull, term_ctr(CID_SCON, STAT_OFF + 60), 114ull, term_ctr(CID_SCON, STAT_OFF + 62), 116ull, term_ctr(CID_SCON, STAT_OFF + 64), 107ull, term_ctr(CID_SCON, STAT_OFF + 66), 114ull, term_ctr(CID_SCON, STAT_OFF + 68), 111ull, term_ctr(CID_SCON, STAT_OFF + 70), 119ull, term_ctr(CID_SCON, STAT_OFF + 72), 110ull, term_pak(CID_SNIL, 0), 101ull, term_ctr(CID_SCON, STAT_OFF + 76), 107ull, term_ctr(CID_SCON, STAT_OFF + 78), 111ull, term_ctr(CID_SCON, STAT_OFF + 80), 116ull, term_ctr(CID_SCON, STAT_OFF + 82), 32ull, term_ctr(CID_SCON, STAT_OFF + 84), 115ull, term_ctr(CID_SCON, STAT_OFF + 86), 117ull, term_ctr(CID_SCON, STAT_OFF + 88), 116ull, term_ctr(CID_SCON, STAT_OFF + 90), 97ull, term_ctr(CID_SCON, STAT_OFF + 92), 116ull, term_ctr(CID_SCON, STAT_OFF + 94), 115ull, term_ctr(CID_SCON, STAT_OFF + 96), 32ull, term_ctr(CID_SCON, STAT_OFF + 98), 110ull, term_ctr(CID_SCON, STAT_OFF + 100), 119ull, term_ctr(CID_SCON, STAT_OFF + 102), 111ull, term_ctr(CID_SCON, STAT_OFF + 104), 110ull, term_ctr(CID_SCON, STAT_OFF + 106), 107ull, term_ctr(CID_SCON, STAT_OFF + 108), 110ull, term_ctr(CID_SCON, STAT_OFF + 110), 117ull, term_ctr(CID_SCON, STAT_OFF + 112), 108ull, term_pak(CID_SNIL, 0), 97ull, term_ctr(CID_SCON, STAT_OFF + 116), 110ull, term_ctr(CID_SCON, STAT_OFF + 118), 103ull, term_ctr(CID_SCON, STAT_OFF + 120), 105ull, term_ctr(CID_SCON, STAT_OFF + 122), 115ull, term_ctr(CID_SCON, STAT_OFF + 124), 105ull, term_ctr(CID_SCON, STAT_OFF + 76), 97ull, term_ctr(CID_SCON, STAT_OFF + 128), 108ull, term_ctr(CID_SCON, STAT_OFF + 130), 101ull, term_ctr(CID_SCON, STAT_OFF + 132), 99ull, term_ctr(CID_SCON, STAT_OFF + 134), 114ull, term_ctr(CID_SCON, STAT_OFF + 136), 111ull, term_ctr(CID_SCON, STAT_OFF + 138), 112ull, term_ctr(CID_SCON, STAT_OFF + 140), 45ull, term_ctr(CID_SCON, STAT_OFF + 142), 45ull, term_ctr(CID_SCON, STAT_OFF + 144), term_ctr(CID_SCON, STAT_OFF + 146), term_pak(CID_NIL, 0), term_ctr(CID_SCON, STAT_OFF + 56), term_ctr(CID_CON, STAT_OFF + 148), 101ull, term_pak(CID_SNIL, 0), 115ull, term_ctr(CID_SCON, STAT_OFF + 152), 114ull, term_ctr(CID_SCON, STAT_OFF + 154), 97ull, term_ctr(CID_SCON, STAT_OFF + 156), 112ull, term_ctr(CID_SCON, STAT_OFF + 158), 45ull, term_ctr(CID_SCON, STAT_OFF + 160), 118ull, term_ctr(CID_SCON, STAT_OFF + 162), 101ull, term_ctr(CID_SCON, STAT_OFF + 164), 114ull, term_ctr(CID_SCON, STAT_OFF + 166), 68ull, term_pak(CID_SNIL, 0), 65ull, term_ctr(CID_SCON, STAT_OFF + 170), 69ull, term_ctr(CID_SCON, STAT_OFF + 172), 72ull, term_ctr(CID_SCON, STAT_OFF + 174), term_ctr(CID_SCON, STAT_OFF + 176), term_pak(CID_NIL, 0), term_ctr(CID_SCON, STAT_OFF + 168), term_ctr(CID_CON, STAT_OFF + 178), 116ull, term_pak(CID_SNIL, 0), 105ull, term_ctr(CID_SCON, STAT_OFF + 182), 120ull, term_ctr(CID_SCON, STAT_OFF + 184), 101ull, term_ctr(CID_SCON, STAT_OFF + 186), 10ull, term_pak(CID_SNIL, 0), 58ull, term_ctr(CID_SCON, STAT_OFF + 190), 83ull, term_ctr(CID_SCON, STAT_OFF + 192), 69ull, term_ctr(CID_SCON, STAT_OFF + 194), 82ull, term_ctr(CID_SCON, STAT_OFF + 196), 85ull, term_ctr(CID_SCON, STAT_OFF + 198), 76ull, term_ctr(CID_SCON, STAT_OFF + 200), 73ull, term_ctr(CID_SCON, STAT_OFF + 202), 65ull, term_ctr(CID_SCON, STAT_OFF + 204), 70ull, term_ctr(CID_SCON, STAT_OFF + 206), 101ull, term_ctr(CID_SCON, STAT_OFF + 78), 114ull, term_ctr(CID_SCON, STAT_OFF + 210), 103ull, term_ctr(CID_SCON, STAT_OFF + 212), 32ull, term_ctr(CID_SCON, STAT_OFF + 214), 108ull, term_ctr(CID_SCON, STAT_OFF + 216), 108ull, term_ctr(CID_SCON, STAT_OFF + 218), 97ull, term_ctr(CID_SCON, STAT_OFF + 220), 32ull, term_ctr(CID_SCON, STAT_OFF + 222), 58ull, term_ctr(CID_SCON, STAT_OFF + 224), 115ull, term_ctr(CID_SCON, STAT_OFF + 226), 107ull, term_ctr(CID_SCON, STAT_OFF + 228), 99ull, term_ctr(CID_SCON, STAT_OFF + 230), 101ull, term_ctr(CID_SCON, STAT_OFF + 232), 104ull, term_ctr(CID_SCON, STAT_OFF + 234), 99ull, term_ctr(CID_SCON, STAT_OFF + 236), 32ull, term_ctr(CID_SCON, STAT_OFF + 238), 101ull, term_ctr(CID_SCON, STAT_OFF + 240), 110ull, term_ctr(CID_SCON, STAT_OFF + 242), 97ull, term_ctr(CID_SCON, STAT_OFF + 244), 108ull, term_ctr(CID_SCON, STAT_OFF + 246), 45ull, term_ctr(CID_SCON, STAT_OFF + 248), 116ull, term_ctr(CID_SCON, STAT_OFF + 250), 105ull, term_ctr(CID_SCON, STAT_OFF + 252), 103ull, term_ctr(CID_SCON, STAT_OFF + 254), 104ull, term_pak(CID_SNIL, 0), 99ull, term_ctr(CID_SCON, STAT_OFF + 258), 117ull, term_ctr(CID_SCON, STAT_OFF + 260), 111ull, term_ctr(CID_SCON, STAT_OFF + 262), 116ull, term_ctr(CID_SCON, STAT_OFF + 264), 32ull, term_ctr(CID_SCON, STAT_OFF + 266), 114ull, term_ctr(CID_SCON, STAT_OFF + 268), 101ull, term_ctr(CID_SCON, STAT_OFF + 270), 116ull, term_ctr(CID_SCON, STAT_OFF + 272), 102ull, term_ctr(CID_SCON, STAT_OFF + 274), 97ull, term_ctr(CID_SCON, STAT_OFF + 276), 32ull, term_ctr(CID_SCON, STAT_OFF + 278), 103ull, term_ctr(CID_SCON, STAT_OFF + 280), 110ull, term_ctr(CID_SCON, STAT_OFF + 282), 105ull, term_ctr(CID_SCON, STAT_OFF + 284), 115ull, term_ctr(CID_SCON, STAT_OFF + 286), 115ull, term_ctr(CID_SCON, STAT_OFF + 288), 105ull, term_ctr(CID_SCON, STAT_OFF + 290), 109ull, term_ctr(CID_SCON, STAT_OFF + 292), 32ull, term_ctr(CID_SCON, STAT_OFF + 294), 103ull, term_ctr(CID_SCON, STAT_OFF + 296), 97ull, term_ctr(CID_SCON, STAT_OFF + 298), 108ull, term_ctr(CID_SCON, STAT_OFF + 300), 102ull, term_ctr(CID_SCON, STAT_OFF + 302), 32ull, term_ctr(CID_SCON, STAT_OFF + 304), 121ull, term_ctr(CID_SCON, STAT_OFF + 306), 116ull, term_ctr(CID_SCON, STAT_OFF + 308), 114ull, term_ctr(CID_SCON, STAT_OFF + 310), 105ull, term_ctr(CID_SCON, STAT_OFF + 312), 100ull, term_ctr(CID_SCON, STAT_OFF + 314), 32ull, term_ctr(CID_SCON, STAT_OFF + 316), 58ull, term_ctr(CID_SCON, STAT_OFF + 318), 115ull, term_ctr(CID_SCON, STAT_OFF + 320), 117ull, term_ctr(CID_SCON, STAT_OFF + 322), 116ull, term_ctr(CID_SCON, STAT_OFF + 324), 97ull, term_ctr(CID_SCON, STAT_OFF + 326), 116ull, term_ctr(CID_SCON, STAT_OFF + 328), 115ull, term_ctr(CID_SCON, STAT_OFF + 330), 32ull, term_pak(CID_SNIL, 0), 58ull, term_ctr(CID_SCON, STAT_OFF + 334), 100ull, term_ctr(CID_SCON, STAT_OFF + 336), 101ull, term_ctr(CID_SCON, STAT_OFF + 338), 115ull, term_ctr(CID_SCON, STAT_OFF + 340), 117ull, term_ctr(CID_SCON, STAT_OFF + 342), 102ull, term_ctr(CID_SCON, STAT_OFF + 344), 101ull, term_ctr(CID_SCON, STAT_OFF + 346), 114ull, term_ctr(CID_SCON, STAT_OFF + 348), 32ull, term_ctr(CID_SCON, STAT_OFF + 350), 115ull, term_ctr(CID_SCON, STAT_OFF + 352), 117ull, term_ctr(CID_SCON, STAT_OFF + 354), 116ull, term_ctr(CID_SCON, STAT_OFF + 356), 97ull, term_ctr(CID_SCON, STAT_OFF + 358), 116ull, term_ctr(CID_SCON, STAT_OFF + 360), 115ull, term_ctr(CID_SCON, STAT_OFF + 362), 103ull, term_ctr(CID_SCON, STAT_OFF + 152), 97ull, term_ctr(CID_SCON, STAT_OFF + 366), 116ull, term_ctr(CID_SCON, STAT_OFF + 368), 115ull, term_ctr(CID_SCON, STAT_OFF + 370), 32ull, term_ctr(CID_SCON, STAT_OFF + 372), 101ull, term_ctr(CID_SCON, STAT_OFF + 374), 108ull, term_ctr(CID_SCON, STAT_OFF + 376), 98ull, term_ctr(CID_SCON, STAT_OFF + 378), 97ull, term_ctr(CID_SCON, STAT_OFF + 380), 104ull, term_ctr(CID_SCON, STAT_OFF + 382), 99ull, term_ctr(CID_SCON, STAT_OFF + 384), 97ull, term_ctr(CID_SCON, STAT_OFF + 386), 101ull, term_ctr(CID_SCON, STAT_OFF + 388), 114ull, term_ctr(CID_SCON, STAT_OFF + 390), 110ull, term_ctr(CID_SCON, STAT_OFF + 392), 117ull, term_ctr(CID_SCON, STAT_OFF + 394), term_ctr(CID_SCON, STAT_OFF + 74), term_ctr(CID_SCON, STAT_OFF + 396), term_ctr(CID____SRC_GIT_TYPES_FCMD, STAT_OFF + 398), 102ull, term_pak(CID_SNIL, 0), 101ull, term_ctr(CID_SCON, STAT_OFF + 401), 114ull, term_ctr(CID_SCON, STAT_OFF + 403), 45ull, term_ctr(CID_SCON, STAT_OFF + 405), 118ull, term_ctr(CID_SCON, STAT_OFF + 407), 101ull, term_ctr(CID_SCON, STAT_OFF + 409), 114ull, term_ctr(CID_SCON, STAT_OFF + 411), 98ull, term_ctr(CID_SCON, STAT_OFF + 413), 98ull, term_ctr(CID_SCON, STAT_OFF + 415), 97ull, term_ctr(CID_SCON, STAT_OFF + 417), 45ull, term_ctr(CID_SCON, STAT_OFF + 419), 45ull, term_ctr(CID_SCON, STAT_OFF + 421), term_ctr(CID_SCON, STAT_OFF + 423), term_ctr(CID_CON, STAT_OFF + 178), term_ctr(CID_SCON, STAT_OFF + 168), term_ctr(CID_CON, STAT_OFF + 425), 110ull, term_ctr(CID_SCON, STAT_OFF + 152), 105ull, term_ctr(CID_SCON, STAT_OFF + 429), 108ull, term_ctr(CID_SCON, STAT_OFF + 431), 32ull, term_ctr(CID_SCON, STAT_OFF + 433), 115ull, term_ctr(CID_SCON, STAT_OFF + 435), 117ull, term_ctr(CID_SCON, STAT_OFF + 437), 116ull, term_ctr(CID_SCON, STAT_OFF + 439), 97ull, term_ctr(CID_SCON, STAT_OFF + 441), 116ull, term_ctr(CID_SCON, STAT_OFF + 443), 115ull, term_ctr(CID_SCON, STAT_OFF + 445), 32ull, term_ctr(CID_SCON, STAT_OFF + 447), 100ull, term_ctr(CID_SCON, STAT_OFF + 449), 101ull, term_ctr(CID_SCON, STAT_OFF + 451), 109ull, term_ctr(CID_SCON, STAT_OFF + 453), 114ull, term_ctr(CID_SCON, STAT_OFF + 455), 111ull, term_ctr(CID_SCON, STAT_OFF + 457), 102ull, term_ctr(CID_SCON, STAT_OFF + 459), 108ull, term_ctr(CID_SCON, STAT_OFF + 461), 97ull, term_ctr(CID_SCON, STAT_OFF + 463), 109ull, term_ctr(CID_SCON, STAT_OFF + 465), 120ull, term_ctr(CID_SCON, STAT_OFF + 182), 116ull, term_ctr(CID_SCON, STAT_OFF + 469), 46ull, term_ctr(CID_SCON, STAT_OFF + 471), 116ull, term_ctr(CID_SCON, STAT_OFF + 473), 114ull, term_ctr(CID_SCON, STAT_OFF + 475), 105ull, term_ctr(CID_SCON, STAT_OFF + 477), 100ull, term_ctr(CID_SCON, STAT_OFF + 479), 47ull, term_ctr(CID_SCON, STAT_OFF + 481), 47ull, term_ctr(CID_SCON, STAT_OFF + 266), 110ull, term_ctr(CID_SCON, STAT_OFF + 485), 105ull, term_ctr(CID_SCON, STAT_OFF + 487), 98ull, term_ctr(CID_SCON, STAT_OFF + 489), 47ull, term_ctr(CID_SCON, STAT_OFF + 491), 114ull, term_ctr(CID_SCON, STAT_OFF + 493), 115ull, term_ctr(CID_SCON, STAT_OFF + 495), 117ull, term_ctr(CID_SCON, STAT_OFF + 497), 47ull, term_ctr(CID_SCON, STAT_OFF + 499), 46ull, term_pak(CID_SNIL, 0), 121ull, term_pak(CID_SNIL, 0), 116ull, term_ctr(CID_SCON, STAT_OFF + 505), 114ull, term_ctr(CID_SCON, STAT_OFF + 507), 105ull, term_ctr(CID_SCON, STAT_OFF + 509), 100ull, term_ctr(CID_SCON, STAT_OFF + 511), 32ull, term_ctr(CID_SCON, STAT_OFF + 513), 121ull, term_ctr(CID_SCON, STAT_OFF + 515), 108ull, term_ctr(CID_SCON, STAT_OFF + 517), 100ull, term_ctr(CID_SCON, STAT_OFF + 519), 101ull, term_ctr(CID_SCON, STAT_OFF + 521), 116ull, term_ctr(CID_SCON, STAT_OFF + 523), 99ull, term_ctr(CID_SCON, STAT_OFF + 525), 101ull, term_ctr(CID_SCON, STAT_OFF + 527), 112ull, term_ctr(CID_SCON, STAT_OFF + 529), 120ull, term_ctr(CID_SCON, STAT_OFF + 531), 101ull, term_ctr(CID_SCON, STAT_OFF + 533), 110ull, term_ctr(CID_SCON, STAT_OFF + 535), 117ull, term_ctr(CID_SCON, STAT_OFF + 537), 32ull, term_ctr(CID_SCON, STAT_OFF + 539), 101ull, term_ctr(CID_SCON, STAT_OFF + 541), 101ull, term_ctr(CID_SCON, STAT_OFF + 543), 114ull, term_ctr(CID_SCON, STAT_OFF + 545), 116ull, term_ctr(CID_SCON, STAT_OFF + 547), 107ull, term_ctr(CID_SCON, STAT_OFF + 549), 114ull, term_ctr(CID_SCON, STAT_OFF + 551), 111ull, term_ctr(CID_SCON, STAT_OFF + 553), 119ull, term_ctr(CID_SCON, STAT_OFF + 555), 32ull, term_ctr(CID_SCON, STAT_OFF + 557), 58ull, term_ctr(CID_SCON, STAT_OFF + 559), 115ull, term_ctr(CID_SCON, STAT_OFF + 561), 117ull, term_ctr(CID_SCON, STAT_OFF + 563), 116ull, term_ctr(CID_SCON, STAT_OFF + 565), 97ull, term_ctr(CID_SCON, STAT_OFF + 567), 116ull, term_ctr(CID_SCON, STAT_OFF + 569), 115ull, term_ctr(CID_SCON, STAT_OFF + 571), 116ull, term_ctr(CID_SCON, STAT_OFF + 260), 97ull, term_ctr(CID_SCON, STAT_OFF + 575), 109ull, term_ctr(CID_SCON, STAT_OFF + 577), 115ull, term_ctr(CID_SCON, STAT_OFF + 579), 105ull, term_ctr(CID_SCON, STAT_OFF + 581), 109ull, term_ctr(CID_SCON, STAT_OFF + 583), 32ull, term_ctr(CID_SCON, STAT_OFF + 585), 116ull, term_ctr(CID_SCON, STAT_OFF + 587), 105ull, term_ctr(CID_SCON, STAT_OFF + 589), 109ull, term_ctr(CID_SCON, STAT_OFF + 591), 109ull, term_ctr(CID_SCON, STAT_OFF + 593), 111ull, term_ctr(CID_SCON, STAT_OFF + 595), 99ull, term_ctr(CID_SCON, STAT_OFF + 597), 32ull, term_ctr(CID_SCON, STAT_OFF + 599), 58ull, term_ctr(CID_SCON, STAT_OFF + 601), 115ull, term_ctr(CID_SCON, STAT_OFF + 603), 117ull, term_ctr(CID_SCON, STAT_OFF + 605), 116ull, term_ctr(CID_SCON, STAT_OFF + 607), 97ull, term_ctr(CID_SCON, STAT_OFF + 609), 116ull, term_ctr(CID_SCON, STAT_OFF + 611), 115ull, term_ctr(CID_SCON, STAT_OFF + 613), 101ull, term_ctr(CID_SCON, STAT_OFF + 152), 114ull, term_ctr(CID_SCON, STAT_OFF + 617), 116ull, term_ctr(CID_SCON, STAT_OFF + 619), 107ull, term_ctr(CID_SCON, STAT_OFF + 621), 114ull, term_ctr(CID_SCON, STAT_OFF + 623), 111ull, term_ctr(CID_SCON, STAT_OFF + 625), 119ull, term_ctr(CID_SCON, STAT_OFF + 627), 45ull, term_ctr(CID_SCON, STAT_OFF + 629), 101ull, term_ctr(CID_SCON, STAT_OFF + 631), 116ull, term_ctr(CID_SCON, STAT_OFF + 633), 97ull, term_ctr(CID_SCON, STAT_OFF + 635), 101ull, term_ctr(CID_SCON, STAT_OFF + 637), 114ull, term_ctr(CID_SCON, STAT_OFF + 639), 99ull, term_ctr(CID_SCON, STAT_OFF + 641), 119ull, term_ctr(CID_SCON, STAT_OFF + 182), 45ull, term_ctr(CID_SCON, STAT_OFF + 645), 116ull, term_ctr(CID_SCON, STAT_OFF + 647), 105ull, term_ctr(CID_SCON, STAT_OFF + 649), 103ull, term_ctr(CID_SCON, STAT_OFF + 651), 45ull, term_ctr(CID_SCON, STAT_OFF + 653), 50ull, term_ctr(CID_SCON, STAT_OFF + 655), 100ull, term_ctr(CID_SCON, STAT_OFF + 657), 110ull, term_ctr(CID_SCON, STAT_OFF + 659), 101ull, term_ctr(CID_SCON, STAT_OFF + 661), 98ull, term_ctr(CID_SCON, STAT_OFF + 663), 47ull, term_ctr(CID_SCON, STAT_OFF + 665), 104ull, term_ctr(CID_SCON, STAT_OFF + 667), 99ull, term_ctr(CID_SCON, STAT_OFF + 669), 116ull, term_ctr(CID_SCON, STAT_OFF + 671), 97ull, term_ctr(CID_SCON, STAT_OFF + 673), 114ull, term_ctr(CID_SCON, STAT_OFF + 675), 99ull, term_ctr(CID_SCON, STAT_OFF + 677), 115ull, term_ctr(CID_SCON, STAT_OFF + 679), 46ull, term_ctr(CID_SCON, STAT_OFF + 681), 47ull, term_ctr(CID_SCON, STAT_OFF + 683), 116ull, term_ctr(CID_SCON, STAT_OFF + 685), 115ull, term_ctr(CID_SCON, STAT_OFF + 687), 101ull, term_ctr(CID_SCON, STAT_OFF + 689), 116ull, term_ctr(CID_SCON, STAT_OFF + 691), 45ull, term_ctr(CID_SCON, STAT_OFF + 693), 116ull, term_ctr(CID_SCON, STAT_OFF + 695), 105ull, term_ctr(CID_SCON, STAT_OFF + 697), 103ull, term_ctr(CID_SCON, STAT_OFF + 699), 45ull, term_ctr(CID_SCON, STAT_OFF + 701), 50ull, term_ctr(CID_SCON, STAT_OFF + 703), 100ull, term_ctr(CID_SCON, STAT_OFF + 705), 110ull, term_ctr(CID_SCON, STAT_OFF + 707), 101ull, term_ctr(CID_SCON, STAT_OFF + 709), 98ull, term_ctr(CID_SCON, STAT_OFF + 711), 47ull, term_ctr(CID_SCON, STAT_OFF + 713), 104ull, term_ctr(CID_SCON, STAT_OFF + 715), 99ull, term_ctr(CID_SCON, STAT_OFF + 717), 116ull, term_ctr(CID_SCON, STAT_OFF + 719), 97ull, term_ctr(CID_SCON, STAT_OFF + 721), 114ull, term_ctr(CID_SCON, STAT_OFF + 723), 99ull, term_ctr(CID_SCON, STAT_OFF + 725), 115ull, term_ctr(CID_SCON, STAT_OFF + 727), 46ull, term_ctr(CID_SCON, STAT_OFF + 729), 116ull, term_ctr(CID_SCON, STAT_OFF + 336), 111ull, term_ctr(CID_SCON, STAT_OFF + 733), 103ull, term_ctr(CID_SCON, STAT_OFF + 735), 32ull, term_ctr(CID_SCON, STAT_OFF + 737), 44ull, term_ctr(CID_SCON, STAT_OFF + 739), 101ull, term_ctr(CID_SCON, STAT_OFF + 741), 115ull, term_ctr(CID_SCON, STAT_OFF + 743), 97ull, term_ctr(CID_SCON, STAT_OFF + 745), 98ull, term_ctr(CID_SCON, STAT_OFF + 747), 45ull, term_ctr(CID_SCON, STAT_OFF + 749), 110ull, term_ctr(CID_SCON, STAT_OFF + 751), 119ull, term_ctr(CID_SCON, STAT_OFF + 753), 111ull, term_ctr(CID_SCON, STAT_OFF + 755), 110ull, term_ctr(CID_SCON, STAT_OFF + 757), 107ull, term_ctr(CID_SCON, STAT_OFF + 759), 110ull, term_ctr(CID_SCON, STAT_OFF + 761), 117ull, term_ctr(CID_SCON, STAT_OFF + 763), 32ull, term_ctr(CID_SCON, STAT_OFF + 765), 100ull, term_ctr(CID_SCON, STAT_OFF + 767), 101ull, term_ctr(CID_SCON, STAT_OFF + 769), 116ull, term_ctr(CID_SCON, STAT_OFF + 771), 99ull, term_ctr(CID_SCON, STAT_OFF + 773), 101ull, term_ctr(CID_SCON, STAT_OFF + 775), 112ull, term_ctr(CID_SCON, STAT_OFF + 777), 120ull, term_ctr(CID_SCON, STAT_OFF + 779), 101ull, term_ctr(CID_SCON, STAT_OFF + 781), 100ull, term_pak(CID_SNIL, 0), 101ull, term_ctr(CID_SCON, STAT_OFF + 785), 100ull, term_ctr(CID_SCON, STAT_OFF + 787), 101ull, term_ctr(CID_SCON, STAT_OFF + 789), 101ull, term_ctr(CID_SCON, STAT_OFF + 791), 99ull, term_ctr(CID_SCON, STAT_OFF + 793), 99ull, term_ctr(CID_SCON, STAT_OFF + 795), 117ull, term_ctr(CID_SCON, STAT_OFF + 797), 115ull, term_ctr(CID_SCON, STAT_OFF + 799), 32ull, term_ctr(CID_SCON, STAT_OFF + 801), 101ull, term_ctr(CID_SCON, STAT_OFF + 803), 116ull, term_ctr(CID_SCON, STAT_OFF + 805), 97ull, term_ctr(CID_SCON, STAT_OFF + 807), 101ull, term_ctr(CID_SCON, STAT_OFF + 809), 114ull, term_ctr(CID_SCON, STAT_OFF + 811), 99ull, term_ctr(CID_SCON, STAT_OFF + 813), 32ull, term_ctr(CID_SCON, STAT_OFF + 815), 44ull, term_ctr(CID_SCON, STAT_OFF + 817), 108ull, term_ctr(CID_SCON, STAT_OFF + 819), 97ull, term_ctr(CID_SCON, STAT_OFF + 821), 115ull, term_ctr(CID_SCON, STAT_OFF + 823), 117ull, term_ctr(CID_SCON, STAT_OFF + 825), 102ull, term_ctr(CID_SCON, STAT_OFF + 827), 101ull, term_ctr(CID_SCON, STAT_OFF + 829), 114ull, term_ctr(CID_SCON, STAT_OFF + 831), 32ull, term_ctr(CID_SCON, STAT_OFF + 833), 101ull, term_ctr(CID_SCON, STAT_OFF + 835), 115ull, term_ctr(CID_SCON, STAT_OFF + 837), 97ull, term_ctr(CID_SCON, STAT_OFF + 839), 98ull, term_ctr(CID_SCON, STAT_OFF + 841), 45ull, term_ctr(CID_SCON, STAT_OFF + 843), 110ull, term_ctr(CID_SCON, STAT_OFF + 845), 119ull, term_ctr(CID_SCON, STAT_OFF + 847), 111ull, term_ctr(CID_SCON, STAT_OFF + 849), 110ull, term_ctr(CID_SCON, STAT_OFF + 851), 107ull, term_ctr(CID_SCON, STAT_OFF + 853), 110ull, term_ctr(CID_SCON, STAT_OFF + 855), 117ull, term_ctr(CID_SCON, STAT_OFF + 857), 32ull, term_ctr(CID_SCON, STAT_OFF + 859), 100ull, term_ctr(CID_SCON, STAT_OFF + 861), 101ull, term_ctr(CID_SCON, STAT_OFF + 863), 116ull, term_ctr(CID_SCON, STAT_OFF + 865), 99ull, term_ctr(CID_SCON, STAT_OFF + 867), 101ull, term_ctr(CID_SCON, STAT_OFF + 869), 112ull, term_ctr(CID_SCON, STAT_OFF + 871), 120ull, term_ctr(CID_SCON, STAT_OFF + 873), 101ull, term_ctr(CID_SCON, STAT_OFF + 875), 48ull, term_pak(CID_SNIL, 0), 51ull, term_pak(CID_SNIL, 0), 119ull, term_ctr(CID_SCON, STAT_OFF + 881), 47ull, term_ctr(CID_SCON, STAT_OFF + 883), 110ull, term_ctr(CID_SCON, STAT_OFF + 885), 111ull, term_ctr(CID_SCON, STAT_OFF + 887), 116ull, term_ctr(CID_SCON, STAT_OFF + 889), 97ull, term_ctr(CID_SCON, STAT_OFF + 891), 98ull, term_ctr(CID_SCON, STAT_OFF + 893), 121ull, term_ctr(CID_SCON, STAT_OFF + 407), 114ull, term_ctr(CID_SCON, STAT_OFF + 897), 101ull, term_ctr(CID_SCON, STAT_OFF + 899), 116ull, term_ctr(CID_SCON, STAT_OFF + 901), 115ull, term_ctr(CID_SCON, STAT_OFF + 903), 121ull, term_ctr(CID_SCON, STAT_OFF + 905), 109ull, term_ctr(CID_SCON, STAT_OFF + 907), 115ull, term_ctr(CID_SCON, STAT_OFF + 741), 116ull, term_ctr(CID_SCON, STAT_OFF + 911), 115ull, term_ctr(CID_SCON, STAT_OFF + 913), 105ull, term_ctr(CID_SCON, STAT_OFF + 915), 120ull, term_ctr(CID_SCON, STAT_OFF + 917), 101ull, term_ctr(CID_SCON, STAT_OFF + 919), 45ull, term_ctr(CID_SCON, STAT_OFF + 921), 104ull, term_ctr(CID_SCON, STAT_OFF + 923), 116ull, term_ctr(CID_SCON, STAT_OFF + 925), 97ull, term_ctr(CID_SCON, STAT_OFF + 927), 112ull, term_ctr(CID_SCON, STAT_OFF + 929), 32ull, term_ctr(CID_SCON, STAT_OFF + 931), 100ull, term_ctr(CID_SCON, STAT_OFF + 933), 101ull, term_ctr(CID_SCON, STAT_OFF + 935), 116ull, term_ctr(CID_SCON, STAT_OFF + 937), 99ull, term_ctr(CID_SCON, STAT_OFF + 939), 101ull, term_ctr(CID_SCON, STAT_OFF + 941), 112ull, term_ctr(CID_SCON, STAT_OFF + 943), 120ull, term_ctr(CID_SCON, STAT_OFF + 945), 101ull, term_ctr(CID_SCON, STAT_OFF + 947), 115ull, term_ctr(CID_SCON, STAT_OFF + 835), 116ull, term_ctr(CID_SCON, STAT_OFF + 951), 115ull, term_ctr(CID_SCON, STAT_OFF + 953), 105ull, term_ctr(CID_SCON, STAT_OFF + 955), 120ull, term_ctr(CID_SCON, STAT_OFF + 957), 101ull, term_ctr(CID_SCON, STAT_OFF + 959), 45ull, term_ctr(CID_SCON, STAT_OFF + 961), 104ull, term_ctr(CID_SCON, STAT_OFF + 963), 116ull, term_ctr(CID_SCON, STAT_OFF + 965), 97ull, term_ctr(CID_SCON, STAT_OFF + 967), 112ull, term_ctr(CID_SCON, STAT_OFF + 969), 32ull, term_ctr(CID_SCON, STAT_OFF + 971), 100ull, term_ctr(CID_SCON, STAT_OFF + 973), 101ull, term_ctr(CID_SCON, STAT_OFF + 975), 116ull, term_ctr(CID_SCON, STAT_OFF + 977), 99ull, term_ctr(CID_SCON, STAT_OFF + 979), 101ull, term_ctr(CID_SCON, STAT_OFF + 981), 112ull, term_ctr(CID_SCON, STAT_OFF + 983), 120ull, term_ctr(CID_SCON, STAT_OFF + 985), 101ull, term_ctr(CID_SCON, STAT_OFF + 987), 115ull, term_ctr(CID_SCON, STAT_OFF + 336), 116ull, term_ctr(CID_SCON, STAT_OFF + 991), 115ull, term_ctr(CID_SCON, STAT_OFF + 993), 105ull, term_ctr(CID_SCON, STAT_OFF + 995), 120ull, term_ctr(CID_SCON, STAT_OFF + 997), 101ull, term_ctr(CID_SCON, STAT_OFF + 999), 32ull, term_ctr(CID_SCON, STAT_OFF + 1001), 104ull, term_ctr(CID_SCON, STAT_OFF + 1003), 99ull, term_ctr(CID_SCON, STAT_OFF + 1005), 110ull, term_ctr(CID_SCON, STAT_OFF + 1007), 97ull, term_ctr(CID_SCON, STAT_OFF + 1009), 114ull, term_ctr(CID_SCON, STAT_OFF + 1011), 98ull, term_ctr(CID_SCON, STAT_OFF + 1013), 116ull, term_ctr(CID_SCON, STAT_OFF + 1005), 97ull, term_ctr(CID_SCON, STAT_OFF + 1017), 112ull, term_ctr(CID_SCON, STAT_OFF + 1019), 101ull, term_ctr(CID_SCON, STAT_OFF + 336), 115ull, term_ctr(CID_SCON, STAT_OFF + 1023), 97ull, term_ctr(CID_SCON, STAT_OFF + 1025), 98ull, term_ctr(CID_SCON, STAT_OFF + 1027), 32ull, term_ctr(CID_SCON, STAT_OFF + 1029), 110ull, term_ctr(CID_SCON, STAT_OFF + 1031), 119ull, term_ctr(CID_SCON, STAT_OFF + 1033), 111ull, term_ctr(CID_SCON, STAT_OFF + 1035), 110ull, term_ctr(CID_SCON, STAT_OFF + 1037), 107ull, term_ctr(CID_SCON, STAT_OFF + 1039), 110ull, term_ctr(CID_SCON, STAT_OFF + 1041), 117ull, term_ctr(CID_SCON, STAT_OFF + 1043), 121ull, term_ctr(CID_SCON, STAT_OFF + 336), 115ull, term_ctr(CID_SCON, STAT_OFF + 1047), 117ull, term_ctr(CID_SCON, STAT_OFF + 1049), 98ull, term_ctr(CID_SCON, STAT_OFF + 1051), 32ull, term_ctr(CID_SCON, STAT_OFF + 1053), 116ull, term_ctr(CID_SCON, STAT_OFF + 1055), 101ull, term_ctr(CID_SCON, STAT_OFF + 1057), 103ull, term_ctr(CID_SCON, STAT_OFF + 1059), 114ull, term_ctr(CID_SCON, STAT_OFF + 1061), 97ull, term_ctr(CID_SCON, STAT_OFF + 1063), 116ull, term_ctr(CID_SCON, STAT_OFF + 1065), 100ull, term_ctr(CID_SCON, STAT_OFF + 785), 97ull, term_ctr(CID_SCON, STAT_OFF + 1069), 98ull, term_pak(CID_SNIL, 0), 45ull, term_ctr(CID_SCON, STAT_OFF + 1073), 108ull, term_ctr(CID_SCON, STAT_OFF + 46), 47ull, term_ctr(CID_SCON, STAT_OFF + 1077), 110ull, term_ctr(CID_SCON, STAT_OFF + 1079), 105ull, term_ctr(CID_SCON, STAT_OFF + 1081), 98ull, term_ctr(CID_SCON, STAT_OFF + 1083), 47ull, term_ctr(CID_SCON, STAT_OFF + 1085), 45ull, term_ctr(CID_SCON, STAT_OFF + 785), 45ull, term_pak(CID_SNIL, 0), 45ull, term_ctr(CID_SCON, STAT_OFF + 1091), 47ull, term_pak(CID_SNIL, 0), 115ull, term_ctr(CID_SCON, STAT_OFF + 1095), 100ull, term_ctr(CID_SCON, STAT_OFF + 1097), 97ull, term_ctr(CID_SCON, STAT_OFF + 1099), 101ull, term_ctr(CID_SCON, STAT_OFF + 1101), 104ull, term_ctr(CID_SCON, STAT_OFF + 1103), 47ull, term_ctr(CID_SCON, STAT_OFF + 1105), 115ull, term_ctr(CID_SCON, STAT_OFF + 1107), 102ull, term_ctr(CID_SCON, STAT_OFF + 1109), 101ull, term_ctr(CID_SCON, STAT_OFF + 1111), 114ull, term_ctr(CID_SCON, STAT_OFF + 1113), 102ull, term_ctr(CID_SCON, STAT_OFF + 505), 105ull, term_ctr(CID_SCON, STAT_OFF + 1117), 114ull, term_ctr(CID_SCON, STAT_OFF + 1119), 101ull, term_ctr(CID_SCON, STAT_OFF + 1121), 118ull, term_ctr(CID_SCON, STAT_OFF + 1123), 45ull, term_ctr(CID_SCON, STAT_OFF + 1125), 45ull, term_ctr(CID_SCON, STAT_OFF + 1127), 101ull, term_ctr(CID_SCON, STAT_OFF + 182), 105ull, term_ctr(CID_SCON, STAT_OFF + 1131), 117ull, term_ctr(CID_SCON, STAT_OFF + 1133), 113ull, term_ctr(CID_SCON, STAT_OFF + 1135), 45ull, term_ctr(CID_SCON, STAT_OFF + 1137), 45ull, term_ctr(CID_SCON, STAT_OFF + 1139), 103ull, term_pak(CID_SNIL, 0), 110ull, term_ctr(CID_SCON, STAT_OFF + 1143), 105ull, term_ctr(CID_SCON, STAT_OFF + 1145), 104ull, term_ctr(CID_SCON, STAT_OFF + 1147), 116ull, term_ctr(CID_SCON, STAT_OFF + 1149), 111ull, term_ctr(CID_SCON, STAT_OFF + 1151), 110ull, term_ctr(CID_SCON, STAT_OFF + 1153), 32ull, term_ctr(CID_SCON, STAT_OFF + 1155), 100ull, term_ctr(CID_SCON, STAT_OFF + 1157), 101ull, term_ctr(CID_SCON, STAT_OFF + 1159), 114ull, term_ctr(CID_SCON, STAT_OFF + 1161), 101ull, term_ctr(CID_SCON, STAT_OFF + 1163), 119ull, term_ctr(CID_SCON, STAT_OFF + 1165), 115ull, term_ctr(CID_SCON, STAT_OFF + 1167), 110ull, term_ctr(CID_SCON, STAT_OFF + 1169), 97ull, term_ctr(CID_SCON, STAT_OFF + 1171), 32ull, term_ctr(CID_SCON, STAT_OFF + 1173), 115ull, term_ctr(CID_SCON, STAT_OFF + 1175), 115ull, term_ctr(CID_SCON, STAT_OFF + 1177), 101ull, term_ctr(CID_SCON, STAT_OFF + 1179), 99ull, term_ctr(CID_SCON, STAT_OFF + 1181), 111ull, term_ctr(CID_SCON, STAT_OFF + 1183), 114ull, term_ctr(CID_SCON, STAT_OFF + 1185), 112ull, term_ctr(CID_SCON, STAT_OFF + 1187), 115ull, term_ctr(CID_SCON, STAT_OFF + 182), 101ull, term_ctr(CID_SCON, STAT_OFF + 1191), 116ull, term_ctr(CID_SCON, STAT_OFF + 1193), 45ull, term_ctr(CID_SCON, STAT_OFF + 1195), 116ull, term_ctr(CID_SCON, STAT_OFF + 1197), 105ull, term_ctr(CID_SCON, STAT_OFF + 1199), 103ull, term_ctr(CID_SCON, STAT_OFF + 1201), 45ull, term_ctr(CID_SCON, STAT_OFF + 1203), 50ull, term_ctr(CID_SCON, STAT_OFF + 1205), 100ull, term_ctr(CID_SCON, STAT_OFF + 1207), 110ull, term_ctr(CID_SCON, STAT_OFF + 1209), 101ull, term_ctr(CID_SCON, STAT_OFF + 1211), 98ull, term_ctr(CID_SCON, STAT_OFF + 1213), 47ull, term_ctr(CID_SCON, STAT_OFF + 1215), 104ull, term_ctr(CID_SCON, STAT_OFF + 1217), 99ull, term_ctr(CID_SCON, STAT_OFF + 1219), 116ull, term_ctr(CID_SCON, STAT_OFF + 1221), 97ull, term_ctr(CID_SCON, STAT_OFF + 1223), 114ull, term_ctr(CID_SCON, STAT_OFF + 1225), 99ull, term_ctr(CID_SCON, STAT_OFF + 1227), 115ull, term_ctr(CID_SCON, STAT_OFF + 1229), 46ull, term_ctr(CID_SCON, STAT_OFF + 1231), 116ull, term_ctr(CID_SCON, STAT_OFF + 881), 119ull, term_ctr(CID_SCON, STAT_OFF + 1235), 45ull, term_ctr(CID_SCON, STAT_OFF + 1237), 116ull, term_ctr(CID_SCON, STAT_OFF + 1239), 105ull, term_ctr(CID_SCON, STAT_OFF + 1241), 103ull, term_ctr(CID_SCON, STAT_OFF + 1243), 45ull, term_ctr(CID_SCON, STAT_OFF + 1245), 50ull, term_ctr(CID_SCON, STAT_OFF + 1247), 100ull, term_ctr(CID_SCON, STAT_OFF + 1249), 110ull, term_ctr(CID_SCON, STAT_OFF + 1251), 101ull, term_ctr(CID_SCON, STAT_OFF + 1253), 98ull, term_ctr(CID_SCON, STAT_OFF + 1255), 47ull, term_ctr(CID_SCON, STAT_OFF + 1257), 104ull, term_ctr(CID_SCON, STAT_OFF + 1259), 99ull, term_ctr(CID_SCON, STAT_OFF + 1261), 116ull, term_ctr(CID_SCON, STAT_OFF + 1263), 97ull, term_ctr(CID_SCON, STAT_OFF + 1265), 114ull, term_ctr(CID_SCON, STAT_OFF + 1267), 99ull, term_ctr(CID_SCON, STAT_OFF + 1269), 115ull, term_ctr(CID_SCON, STAT_OFF + 1271), 46ull, term_ctr(CID_SCON, STAT_OFF + 1273), 50ull, term_pak(CID_SNIL, 0), 119ull, term_ctr(CID_SCON, STAT_OFF + 1277), 47ull, term_ctr(CID_SCON, STAT_OFF + 1279), 110ull, term_ctr(CID_SCON, STAT_OFF + 1281), 111ull, term_ctr(CID_SCON, STAT_OFF + 1283), 116ull, term_ctr(CID_SCON, STAT_OFF + 1285), 97ull, term_ctr(CID_SCON, STAT_OFF + 1287), 98ull, term_ctr(CID_SCON, STAT_OFF + 1289), 99ull, term_ctr(CID_SCON, STAT_OFF + 925), 110ull, term_ctr(CID_SCON, STAT_OFF + 1293), 97ull, term_ctr(CID_SCON, STAT_OFF + 1295), 114ull, term_ctr(CID_SCON, STAT_OFF + 1297), 98ull, term_ctr(CID_SCON, STAT_OFF + 1299), 32ull, term_ctr(CID_SCON, STAT_OFF + 1301), 100ull, term_ctr(CID_SCON, STAT_OFF + 1303), 101ull, term_ctr(CID_SCON, STAT_OFF + 1305), 116ull, term_ctr(CID_SCON, STAT_OFF + 1307), 99ull, term_ctr(CID_SCON, STAT_OFF + 1309), 101ull, term_ctr(CID_SCON, STAT_OFF + 1311), 112ull, term_ctr(CID_SCON, STAT_OFF + 1313), 120ull, term_ctr(CID_SCON, STAT_OFF + 1315), 101ull, term_ctr(CID_SCON, STAT_OFF + 1317), 99ull, term_ctr(CID_SCON, STAT_OFF + 965), 110ull, term_ctr(CID_SCON, STAT_OFF + 1321), 97ull, term_ctr(CID_SCON, STAT_OFF + 1323), 114ull, term_ctr(CID_SCON, STAT_OFF + 1325), 98ull, term_ctr(CID_SCON, STAT_OFF + 1327), 32ull, term_ctr(CID_SCON, STAT_OFF + 1329), 100ull, term_ctr(CID_SCON, STAT_OFF + 1331), 101ull, term_ctr(CID_SCON, STAT_OFF + 1333), 116ull, term_ctr(CID_SCON, STAT_OFF + 1335), 99ull, term_ctr(CID_SCON, STAT_OFF + 1337), 101ull, term_ctr(CID_SCON, STAT_OFF + 1339), 112ull, term_ctr(CID_SCON, STAT_OFF + 1341), 120ull, term_ctr(CID_SCON, STAT_OFF + 1343), 101ull, term_ctr(CID_SCON, STAT_OFF + 1345), term_ctr(CID_SCON, STAT_OFF + 643), term_ctr(CID_SCON, STAT_OFF + 396), term_ctr(CID____SRC_GIT_TYPES_FCMD, STAT_OFF + 1349), 125ull, term_pak(CID_SNIL, 0), 116ull, term_ctr(CID_SCON, STAT_OFF + 1352), 105ull, term_ctr(CID_SCON, STAT_OFF + 1354), 109ull, term_ctr(CID_SCON, STAT_OFF + 1356), 109ull, term_ctr(CID_SCON, STAT_OFF + 1358), 111ull, term_ctr(CID_SCON, STAT_OFF + 1360), 99ull, term_ctr(CID_SCON, STAT_OFF + 1362), 123ull, term_ctr(CID_SCON, STAT_OFF + 1364), 94ull, term_ctr(CID_SCON, STAT_OFF + 1366), 58ull, term_pak(CID_SNIL, 0), 49ull, term_pak(CID_SNIL, 0), 119ull, term_ctr(CID_SCON, STAT_OFF + 1372), 47ull, term_ctr(CID_SCON, STAT_OFF + 1374), 110ull, term_ctr(CID_SCON, STAT_OFF + 1376), 111ull, term_ctr(CID_SCON, STAT_OFF + 1378), 116ull, term_ctr(CID_SCON, STAT_OFF + 1380), 97ull, term_ctr(CID_SCON, STAT_OFF + 1382), 98ull, term_ctr(CID_SCON, STAT_OFF + 1384), 32ull, term_ctr(CID_SCON, STAT_OFF + 126), 121ull, term_ctr(CID_SCON, STAT_OFF + 1388), 98ull, term_ctr(CID_SCON, STAT_OFF + 1390), 32ull, term_ctr(CID_SCON, STAT_OFF + 1392), 100ull, term_ctr(CID_SCON, STAT_OFF + 1394), 101ull, term_ctr(CID_SCON, STAT_OFF + 1396), 108ull, term_ctr(CID_SCON, STAT_OFF + 1398), 108ull, term_ctr(CID_SCON, STAT_OFF + 1400), 105ull, term_ctr(CID_SCON, STAT_OFF + 1402), 107ull, term_ctr(CID_SCON, STAT_OFF + 1404), 32ull, term_ctr(CID_SCON, STAT_OFF + 1406), 116ull, term_ctr(CID_SCON, STAT_OFF + 1408), 105ull, term_ctr(CID_SCON, STAT_OFF + 1410), 103ull, term_ctr(CID_SCON, STAT_OFF + 1412), 101ull, term_ctr(CID_SCON, STAT_OFF + 601), 115ull, term_ctr(CID_SCON, STAT_OFF + 1416), 97ull, term_ctr(CID_SCON, STAT_OFF + 1418), 98ull, term_ctr(CID_SCON, STAT_OFF + 1420), 32ull, term_ctr(CID_SCON, STAT_OFF + 1422), 58ull, term_ctr(CID_SCON, STAT_OFF + 1424), 101ull, term_ctr(CID_SCON, STAT_OFF + 1426), 116ull, term_ctr(CID_SCON, STAT_OFF + 1428), 97ull, term_ctr(CID_SCON, STAT_OFF + 1430), 101ull, term_ctr(CID_SCON, STAT_OFF + 1432), 114ull, term_ctr(CID_SCON, STAT_OFF + 1434), 99ull, term_ctr(CID_SCON, STAT_OFF + 1436), 103ull, term_ctr(CID_SCON, STAT_OFF + 184), 67ull, term_pak(CID_SNIL, 0), 45ull, term_ctr(CID_SCON, STAT_OFF + 1442), 0, 0ull, term_pak(CID_SNIL, 0), 61ull, term_pak(CID_SNIL, 0), 101ull, term_ctr(CID_SCON, STAT_OFF + 1449), 115ull, term_ctr(CID_SCON, STAT_OFF + 1451), 97ull, term_ctr(CID_SCON, STAT_OFF + 1453), 98ull, term_ctr(CID_SCON, STAT_OFF + 1455), 109ull, term_pak(CID_SNIL, 0), 114ull, term_ctr(CID_SCON, STAT_OFF + 1459), 47ull, term_ctr(CID_SCON, STAT_OFF + 1461), 110ull, term_ctr(CID_SCON, STAT_OFF + 1463), 105ull, term_ctr(CID_SCON, STAT_OFF + 1465), 98ull, term_ctr(CID_SCON, STAT_OFF + 1467), 47ull, term_ctr(CID_SCON, STAT_OFF + 1469), 114ull, term_ctr(CID_SCON, STAT_OFF + 401), 45ull, term_ctr(CID_SCON, STAT_OFF + 1473), 110ull, term_ctr(CID_SCON, STAT_OFF + 184), 105ull, term_ctr(CID_SCON, STAT_OFF + 1477), 113ull, term_pak(CID_SNIL, 0), 45ull, term_ctr(CID_SCON, STAT_OFF + 1481), 109ull, term_ctr(CID_SCON, STAT_OFF + 130), 105ull, term_ctr(CID_SCON, STAT_OFF + 1143), 102ull, term_ctr(CID_SCON, STAT_OFF + 1487), 110ull, term_ctr(CID_SCON, STAT_OFF + 1489), 111ull, term_ctr(CID_SCON, STAT_OFF + 1491), 99ull, term_ctr(CID_SCON, STAT_OFF + 1493), 105ull, term_ctr(CID_SCON, STAT_OFF + 116), 97ull, term_ctr(CID_SCON, STAT_OFF + 1497), 109ull, term_ctr(CID_SCON, STAT_OFF + 1499), 101ull, term_ctr(CID_SCON, STAT_OFF + 1501), 46ull, term_ctr(CID_SCON, STAT_OFF + 1503), 114ull, term_ctr(CID_SCON, STAT_OFF + 1505), 101ull, term_ctr(CID_SCON, STAT_OFF + 1507), 115ull, term_ctr(CID_SCON, STAT_OFF + 1509), 117ull, term_ctr(CID_SCON, STAT_OFF + 1511), 64ull, term_ctr(CID_SCON, STAT_OFF + 1195), 110ull, term_ctr(CID_SCON, STAT_OFF + 1515), 111ull, term_ctr(CID_SCON, STAT_OFF + 1517), 116ull, term_ctr(CID_SCON, STAT_OFF + 1519), 97ull, term_ctr(CID_SCON, STAT_OFF + 1521), 98ull, term_ctr(CID_SCON, STAT_OFF + 1523), term_ctr(CID_SCON, STAT_OFF + 1525), term_pak(CID_NIL, 0), term_ctr(CID_SCON, STAT_OFF + 1513), term_ctr(CID_CON, STAT_OFF + 1527), term_ctr(CID_SCON, STAT_OFF + 1495), term_ctr(CID_CON, STAT_OFF + 1529), 109ull, term_ctr(CID_SCON, STAT_OFF + 152), 97ull, term_ctr(CID_SCON, STAT_OFF + 1533), 110ull, term_ctr(CID_SCON, STAT_OFF + 1535), 46ull, term_ctr(CID_SCON, STAT_OFF + 1537), 114ull, term_ctr(CID_SCON, STAT_OFF + 1539), 101ull, term_ctr(CID_SCON, STAT_OFF + 1541), 115ull, term_ctr(CID_SCON, STAT_OFF + 1543), 117ull, term_ctr(CID_SCON, STAT_OFF + 1545), 32ull, term_ctr(CID_SCON, STAT_OFF + 1195), 110ull, term_ctr(CID_SCON, STAT_OFF + 1549), 111ull, term_ctr(CID_SCON, STAT_OFF + 1551), 116ull, term_ctr(CID_SCON, STAT_OFF + 1553), 97ull, term_ctr(CID_SCON, STAT_OFF + 1555), 98ull, term_ctr(CID_SCON, STAT_OFF + 1557), term_ctr(CID_SCON, STAT_OFF + 1559), term_pak(CID_NIL, 0), term_ctr(CID_SCON, STAT_OFF + 1547), term_ctr(CID_CON, STAT_OFF + 1561), term_ctr(CID_SCON, STAT_OFF + 1495), term_ctr(CID_CON, STAT_OFF + 1563), 109ull, term_ctr(CID_SCON, STAT_OFF + 184), 109ull, term_ctr(CID_SCON, STAT_OFF + 1567), 111ull, term_ctr(CID_SCON, STAT_OFF + 1569), 99ull, term_ctr(CID_SCON, STAT_OFF + 1571), 112ull, term_ctr(CID_SCON, STAT_OFF + 507), 109ull, term_ctr(CID_SCON, STAT_OFF + 1575), 101ull, term_ctr(CID_SCON, STAT_OFF + 1577), 45ull, term_ctr(CID_SCON, STAT_OFF + 1579), 119ull, term_ctr(CID_SCON, STAT_OFF + 1581), 111ull, term_ctr(CID_SCON, STAT_OFF + 1583), 108ull, term_ctr(CID_SCON, STAT_OFF + 1585), 108ull, term_ctr(CID_SCON, STAT_OFF + 1587), 97ull, term_ctr(CID_SCON, STAT_OFF + 1589), 45ull, term_ctr(CID_SCON, STAT_OFF + 1591), 45ull, term_ctr(CID_SCON, STAT_OFF + 1593), 45ull, term_ctr(CID_SCON, STAT_OFF + 1459), 101ull, term_ctr(CID_SCON, STAT_OFF + 787), 115ull, term_ctr(CID_SCON, STAT_OFF + 1599), term_ctr(CID_SCON, STAT_OFF + 1601), term_pak(CID_NIL, 0), term_ctr(CID_SCON, STAT_OFF + 1597), term_ctr(CID_CON, STAT_OFF + 1603), term_ctr(CID_SCON, STAT_OFF + 1595), term_ctr(CID_CON, STAT_OFF + 1605), term_ctr(CID_SCON, STAT_OFF + 1483), term_ctr(CID_CON, STAT_OFF + 1607), term_ctr(CID_SCON, STAT_OFF + 1573), term_ctr(CID_CON, STAT_OFF + 1609), term_ctr(CID_CON, STAT_OFF + 1611), term_pak(CID_NIL, 0), term_ctr(CID_CON, STAT_OFF + 1565), term_ctr(CID_CON, STAT_OFF + 1613), term_ctr(CID_CON, STAT_OFF + 1531), term_ctr(CID_CON, STAT_OFF + 1615) };

INLINE Term spin_0(Env e, THR Term* o, u32 r0, u32 r1, Term r2) {
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

INLINE Term spin_1(Env e, THR Term* o, u32 r0, Term r1) {
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
    if (spin_0(e, _o_0, 1, _n_1, _rest_1) == 0) {
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

INLINE Term spin_2(Env e, THR Term* o, u32 r0, Term r1) {
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
    if (spin_0(e, _o_2, 0, _n_2, _rest_2) == 0) {
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

INLINE Term spin_3(Env e, THR Term* o, u32 r0, u32 r1, Term r2) {
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
      if (spin_1(e, _o_0, _n_0, _rest_1) == 0) {
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
      if (spin_2(e, _o_1, _n_0, _rest_1) == 0) {
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

INLINE Term spin_4(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_2 = 0;
  Term _s_0 = r0;
  WL_SPIN
    if (term_aux(_s_0) == CID_SNIL) {
      _v_2 = 0;
    } else {
      u64 _sp_0 = term_peek(e, _s_0);
      u32 _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      _v_2 = 1;
    }
  break;
  }
  o[0] = _v_2;
  return 1;
}

INLINE Term spin_5(Env e, THR Term* o, u32 r0, u32 r1, Term r2, u32 r3) {
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
      _v_5 = term_ctr(CID_SCON, STAT_OFF + 44);
      _v_6 = 0;
      _v_7 = 0;
    } else {
      u32 _v_8 = 0;
      Term _v_9 = 0;
      u32 _v_10 = 0;
      Term _v_11 = 0;
      Term _o_0[4];
      if (spin_3(e, _o_0, _sig_2, _m_1, _rest_2) == 0) {
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

INLINE Term spin_7(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_4 = 0;
  Term _s_1 = r0;
  Term _acc_1 = r1;
  WL_SPIN
    if (term_aux(_s_1) == CID_SNIL) {
      _v_4 = _acc_1;
    } else {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _s_1, 2, _fb_0);
      u32 _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      u64 _nd_0 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
      e.mem[_nd_0 + 0] = rfc_seal(e, _f_0);
      e.mem[_nd_0 + 1] = rfc_seal(e, _acc_1);
      r0 = _f_1;
      r1 = term_ctr(CID_SCON, _nd_0);
      _s_1 = r0;
      _acc_1 = r1;
      WL_AGAIN(spin_7);
    }
  break;
  }
  o[0] = _v_4;
  return 1;
}

INLINE Term spin_6(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_2 = 0;
  Term _s_0 = r0;
  WL_SPIN
    Term _v_3 = 0;
    Term _o_0[1];
    if (spin_7(e, _o_0, _s_0, term_pak(CID_SNIL, 0)) == 0) {
      return 0;
    }
    _v_3 = _o_0[0];
    _v_2 = _v_3;
  break;
  }
  o[0] = _v_2;
  return 1;
}

INLINE Term spin_8(Env e, THR Term* o, u32 r0) {
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

INLINE Term spin_9(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_4 = 0;
  u32 _c_2 = r0;
  Term _a_0 = r1;
  Term _b_0 = r2;
  WL_SPIN
    if (_c_2 == 0) {
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

INLINE Term spin_10(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
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

INLINE Term spin_11(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_1 = 0;
  u32 _c_0 = r0;
  Term _a_0 = r1;
  Term _b_0 = r2;
  WL_SPIN
    if (_c_0 == 0) {
      term_sink(e, _a_0);
      _v_1 = _b_0;
    } else {
      term_sink(e, _b_0);
      _v_1 = _a_0;
    }
  break;
  }
  o[0] = _v_1;
  return 1;
}

INLINE Term spin_12(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_1 = 0;
  Term _acc_1 = r0;
  Term _out_1 = r1;
  WL_SPIN
    if (term_aux(_acc_1) == CID_SNIL) {
      _v_1 = _out_1;
    } else {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _acc_1, 2, _fb_0);
      u32 _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      Term _v_2 = 0;
      u64 _nd_0 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
      e.mem[_nd_0 + 0] = rfc_seal(e, _f_0);
      e.mem[_nd_0 + 1] = rfc_seal(e, _f_1);
      Term _v_3 = 0;
      Term _o_0[1];
      if (spin_6(e, _o_0, term_ctr(CID_SCON, _nd_0)) == 0) {
        return 0;
      }
      _v_3 = _o_0[0];
      _v_2 = _v_3;
      u64 _nd_1 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_1 + 0] = _v_2;
      e.mem[_nd_1 + 1] = _out_1;
      _v_1 = term_ctr(CID_CON, _nd_1);
    }
  break;
  }
  o[0] = _v_1;
  return 1;
}

INLINE Term spin_13(Env e, THR Term* o, u32 r0) {
  u32 wpoll = 0;
  u32 _v_6 = 0;
  u32 _c_0 = r0;
  WL_SPIN
    u32 _v_7 = 0;
    u32 _v_8 = 0;
    Term _o_2[1];
    if (spin_8(e, _o_2, _c_0) == 0) {
      return 0;
    }
    _v_8 = _o_2[0];
    _v_7 = _v_8;
    Term _v_9 = 0;
    Term _o_3[1];
    if (spin_9(e, _o_3, U32_BIN(_v_7, ==, 32ull), term_pak(CID_TRUE, 0), term_pak(CID_FALSE, 0)) == 0) {
      return 0;
    }
    _v_9 = _o_3[0];
    u32 _o_4 = 0;
    if (term_aux(_v_9) == CID_FALSE) {
      _o_4 = 0;
    } else {
      _o_4 = 1;
    }
    _v_6 = _o_4;
  break;
  }
  o[0] = _v_6;
  return 1;
}

INLINE Term spin_14(Env e, THR Term* o, u32 r0, u32 r1, Term r2) {
  u32 wpoll = 0;
  Term _v_12 = 0;
  u32 _nl_0 = r0;
  u32 _c_1 = r1;
  Term _acc_2 = r2;
  WL_SPIN
    if (_nl_0 == 1) {
      term_sink(e, _acc_2);
      _v_12 = term_pak(CID_SNIL, 0);
    } else {
      u64 _nd_2 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_2 + 0] = rfc_seal(e, _c_1);
      e.mem[_nd_2 + 1] = rfc_seal(e, _acc_2);
      _v_12 = term_ctr(CID_SCON, _nd_2);
    }
  break;
  }
  o[0] = _v_12;
  return 1;
}

INLINE Term spin_15(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_15 = 0;
  u32 _nl_1 = r0;
  Term _acc_3 = r1;
  Term _out_2 = r2;
  WL_SPIN
    if (_nl_1 == 1) {
      Term _v_16 = 0;
      Term _v_17 = 0;
      Term _o_7[1];
      if (spin_6(e, _o_7, _acc_3) == 0) {
        return 0;
      }
      _v_17 = _o_7[0];
      _v_16 = _v_17;
      u64 _nd_3 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_3 + 0] = _v_16;
      e.mem[_nd_3 + 1] = _out_2;
      _v_15 = term_ctr(CID_CON, _nd_3);
    } else {
      term_sink(e, _acc_3);
      _v_15 = _out_2;
    }
  break;
  }
  o[0] = _v_15;
  return 1;
}

INLINE Term spin_16(Env e, THR Term* o, u32 r0) {
  u32 wpoll = 0;
  u32 _v_3 = 0;
  u32 _b_0 = r0;
  WL_SPIN
    if (_b_0 == 0) {
      _v_3 = 1;
    } else {
      _v_3 = 0;
    }
  break;
  }
  o[0] = _v_3;
  return 1;
}

INLINE Term spin_17(Env e, THR Term* o, u32 r0, Term r1, Term r2, Term r3) {
  u32 wpoll = 0;
  Term _v_1 = 0;
  u32 _r_0 = r0;
  Term _r_1 = r1;
  Term _r_2 = r2;
  Term _r_3 = r3;
  WL_SPIN
    if (_r_0 == 0) {
      u64 _nd_5 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_5 + 0] = _r_1;
      e.mem[_nd_5 + 1] = _r_2;
      e.mem[_nd_5 + 2] = _r_3;
      _v_1 = term_clo(FID____SRC_GIT_STATUS_WS_ANSWER_C118, _nd_5);
    } else if (_r_0 == 1) {
      u64 _nd_8 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_8 + 0] = _r_1;
      e.mem[_nd_8 + 1] = _r_2;
      e.mem[_nd_8 + 2] = _r_3;
      _v_1 = term_clo(FID____SRC_GIT_STATUS_WS_ANSWER_C119, _nd_8);
    } else {
      term_sink(e, _r_1);
      term_sink(e, _r_2);
      _v_1 = term_clo(FID____SRC_GIT_STATUS_WS_ANSWER_C120, 0);
    }
  break;
  }
  o[0] = _v_1;
  return 1;
}

INLINE Term spin_18(Env e, THR Term* o, Term r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_2 = 0;
  Term _s_1 = r0;
  Term _acc_0 = r1;
  Term _out_0 = r2;
  WL_SPIN
    if (term_aux(_s_1) == CID_SNIL) {
      Term _v_3 = 0;
      Term _o_0[1];
      if (spin_12(e, _o_0, _acc_0, _out_0) == 0) {
        return 0;
      }
      _v_3 = _o_0[0];
      _v_2 = _v_3;
    } else {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _s_1, 2, _fb_0);
      u32 _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      u32 _v_4 = 0;
      u32 _v_5 = 0;
      Term _o_1[1];
      if (spin_13(e, _o_1, _f_0) == 0) {
        return 0;
      }
      _v_5 = _o_1[0];
      _v_4 = _v_5;
      Term _v_6 = 0;
      _acc_0 = term_keep(e, _acc_0);
      Term _v_7 = 0;
      Term _o_2[1];
      if (spin_14(e, _o_2, _v_4, _f_0, _acc_0) == 0) {
        return 0;
      }
      _v_7 = _o_2[0];
      _v_6 = _v_7;
      Term _v_8 = 0;
      Term _v_9 = 0;
      Term _o_3[1];
      if (spin_15(e, _o_3, _v_4, _acc_0, _out_0) == 0) {
        return 0;
      }
      _v_9 = _o_3[0];
      _v_8 = _v_9;
      spare_free(e, cls_fit(2), _sp_0);
      r0 = _f_1;
      r1 = _v_6;
      r2 = _v_8;
      _s_1 = r0;
      _acc_0 = r1;
      _out_0 = r2;
      WL_AGAIN(spin_18);
    }
  break;
  }
  o[0] = _v_2;
  return 1;
}

INLINE Term spin_20(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_13 = 0;
  Term _xs_1 = r0;
  Term _acc_1 = r1;
  WL_SPIN
    if (term_aux(_xs_1) == CID_NIL) {
      _v_13 = _acc_1;
    } else {
      Term _fb_1[2];
      u64 _sp_1 = ctr_take(e, _xs_1, 2, _fb_1);
      Term _f_2 = _fb_1[0];
      Term _f_3 = _fb_1[1];
      u64 _nd_0 = _sp_1 >= HEAP_OFF ? _sp_1 : heap_alloc(e, cls_fit(2));
      e.mem[_nd_0 + 0] = _f_2;
      e.mem[_nd_0 + 1] = _acc_1;
      r0 = _f_3;
      r1 = term_ctr(CID_CON, _nd_0);
      _xs_1 = r0;
      _acc_1 = r1;
      WL_AGAIN(spin_20);
    }
  break;
  }
  o[0] = _v_13;
  return 1;
}

INLINE Term spin_19(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_11 = 0;
  Term _xs_0 = r0;
  WL_SPIN
    Term _v_12 = 0;
    Term _o_5[1];
    if (spin_20(e, _o_5, _xs_0, term_pak(CID_NIL, 0)) == 0) {
      return 0;
    }
    _v_12 = _o_5[0];
    _v_11 = _v_12;
  break;
  }
  o[0] = _v_11;
  return 1;
}

INLINE Term spin_21(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
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

INLINE Term spin_22(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
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

INLINE Term spin_23(Env e, THR Term* o, u32 r0, Term r1, Term r2, Term r3) {
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

INLINE Term spin_24(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_2 = 0;
  Term _s_0 = r0;
  WL_SPIN
    Term _v_3 = 0;
    Term _v_4 = 0;
    Term _o_0[1];
    if (spin_18(e, _o_0, _s_0, term_pak(CID_SNIL, 0), term_pak(CID_NIL, 0)) == 0) {
      return 0;
    }
    _v_4 = _o_0[0];
    _v_3 = _v_4;
    Term _v_5 = 0;
    Term _o_1[1];
    if (spin_19(e, _o_1, _v_3) == 0) {
      return 0;
    }
    _v_5 = _o_1[0];
    _v_2 = _v_5;
  break;
  }
  o[0] = _v_2;
  return 1;
}

INLINE Term spin_25(Env e, THR Term* o, u32 r0) {
  u32 wpoll = 0;
  u32 _v_2 = 0;
  u32 _c_0 = r0;
  WL_SPIN
    u32 _v_3 = 0;
    u32 _v_4 = 0;
    Term _o_0[1];
    if (spin_8(e, _o_0, _c_0) == 0) {
      return 0;
    }
    _v_4 = _o_0[0];
    _v_3 = _v_4;
    Term _v_5 = 0;
    Term _v_6 = 0;
    Term _v_7 = 0;
    Term _o_1[1];
    if (spin_21(e, _o_1, U32_BIN(_v_3, <, 65536ull), 3ull, 4ull) == 0) {
      return 0;
    }
    _v_7 = _o_1[0];
    _v_6 = _v_7;
    Term _v_8 = 0;
    Term _o_2[1];
    if (spin_21(e, _o_2, U32_BIN(_v_3, <, 2048ull), 2ull, _v_6) == 0) {
      return 0;
    }
    _v_8 = _o_2[0];
    _v_5 = _v_8;
    Term _v_9 = 0;
    Term _o_3[1];
    if (spin_21(e, _o_3, U32_BIN(_v_3, <, 128ull), 1ull, _v_5) == 0) {
      return 0;
    }
    _v_9 = _o_3[0];
    _v_2 = _v_9;
  break;
  }
  o[0] = _v_2;
  return 1;
}

INLINE Term spin_26(Env e, THR Term* o, u32 r0, Term r1, u32 r2, Term r3, Term r4, Term r5) {
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
        if (spin_22(e, _o_8, U32_BIN(_r_2, ==, 0ull), _bc_5, _path_5) == 0) {
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
      _v_10 = term_ctr(CID_SCON, STAT_OFF + 643);
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

INLINE Term spin_27(Env e, THR Term* o, u32 r0, Term r1, Term r2, Term r3, Term r4) {
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
      if (spin_23(e, _o_6, U32_BIN(_r_1, ==, 0ull), _r_2, _bc_6, _branch_6) == 0) {
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
      _v_10 = term_ctr(CID_SCON, STAT_OFF + 643);
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

INLINE Term spin_28(Env e, THR Term* o, Term r0, u32 r1) {
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
      if (spin_25(e, _o_0, _f_0) == 0) {
        return 0;
      }
      _v_3 = _o_0[0];
      _v_2 = _v_3;
      r0 = _f_1;
      r1 = U32_BIN(_v_2, +, _acc_0);
      _s_1 = r0;
      _acc_0 = r1;
      WL_AGAIN(spin_28);
    }
  break;
  }
  o[0] = _v_1;
  return 1;
}

INLINE Term spin_31(Env e, THR Term* o, Term r0, Term r1) {
  u32 wpoll = 0;
  Term _v_7 = 0;
  Term _acc_1 = r0;
  Term _out_2 = r1;
  WL_SPIN
    if (term_aux(_acc_1) == CID_SNIL) {
      _v_7 = _out_2;
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
      if (spin_6(e, _o_0, term_ctr(CID_SCON, _nd_0)) == 0) {
        return 0;
      }
      _v_9 = _o_0[0];
      _v_8 = _v_9;
      u64 _nd_1 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_1 + 0] = _v_8;
      e.mem[_nd_1 + 1] = _out_2;
      _v_7 = term_ctr(CID_CON, _nd_1);
    }
  break;
  }
  o[0] = _v_7;
  return 1;
}

INLINE Term spin_32(Env e, THR Term* o, u32 r0) {
  u32 wpoll = 0;
  u32 _v_12 = 0;
  u32 _c_0 = r0;
  WL_SPIN
    u32 _v_13 = 0;
    u32 _v_14 = 0;
    Term _o_2[1];
    if (spin_8(e, _o_2, _c_0) == 0) {
      return 0;
    }
    _v_14 = _o_2[0];
    _v_13 = _v_14;
    Term _v_15 = 0;
    Term _o_3[1];
    if (spin_9(e, _o_3, U32_BIN(_v_13, ==, 10ull), term_pak(CID_TRUE, 0), term_pak(CID_FALSE, 0)) == 0) {
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

INLINE Term spin_33(Env e, THR Term* o, u32 r0, u32 r1, Term r2) {
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

INLINE Term spin_34(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_21 = 0;
  u32 _nl_1 = r0;
  Term _acc_3 = r1;
  Term _out_3 = r2;
  WL_SPIN
    if (_nl_1 == 1) {
      Term _v_22 = 0;
      Term _v_23 = 0;
      Term _o_7[1];
      if (spin_6(e, _o_7, _acc_3) == 0) {
        return 0;
      }
      _v_23 = _o_7[0];
      _v_22 = _v_23;
      u64 _nd_3 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_3 + 0] = _v_22;
      e.mem[_nd_3 + 1] = _out_3;
      _v_21 = term_ctr(CID_CON, _nd_3);
    } else {
      term_sink(e, _acc_3);
      _v_21 = _out_3;
    }
  break;
  }
  o[0] = _v_21;
  return 1;
}

INLINE Term spin_30(Env e, THR Term* o, Term r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_5 = 0;
  Term _s_1 = r0;
  Term _acc_0 = r1;
  Term _out_1 = r2;
  WL_SPIN
    if (term_aux(_s_1) == CID_SNIL) {
      Term _v_6 = 0;
      Term _o_1[1];
      if (spin_31(e, _o_1, _acc_0, _out_1) == 0) {
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
      if (spin_32(e, _o_5, _f_2) == 0) {
        return 0;
      }
      _v_11 = _o_5[0];
      _v_10 = _v_11;
      Term _v_16 = 0;
      _acc_0 = term_keep(e, _acc_0);
      Term _v_17 = 0;
      Term _o_6[1];
      if (spin_33(e, _o_6, _v_10, _f_2, _acc_0) == 0) {
        return 0;
      }
      _v_17 = _o_6[0];
      _v_16 = _v_17;
      Term _v_19 = 0;
      Term _v_20 = 0;
      Term _o_8[1];
      if (spin_34(e, _o_8, _v_10, _acc_0, _out_1) == 0) {
        return 0;
      }
      _v_20 = _o_8[0];
      _v_19 = _v_20;
      r0 = _f_3;
      r1 = _v_16;
      r2 = _v_19;
      _s_1 = r0;
      _acc_0 = r1;
      _out_1 = r2;
      WL_AGAIN(spin_30);
    }
  break;
  }
  o[0] = _v_5;
  return 1;
}

INLINE Term spin_29(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  Term _v_2 = 0;
  Term _s_0 = r0;
  WL_SPIN
    Term _v_3 = 0;
    Term _v_4 = 0;
    Term _o_9[1];
    if (spin_30(e, _o_9, _s_0, term_pak(CID_SNIL, 0), term_pak(CID_NIL, 0)) == 0) {
      return 0;
    }
    _v_4 = _o_9[0];
    _v_3 = _v_4;
    Term _v_24 = 0;
    Term _o_10[1];
    if (spin_19(e, _o_10, _v_3) == 0) {
      return 0;
    }
    _v_24 = _o_10[0];
    _v_2 = _v_24;
  break;
  }
  o[0] = _v_2;
  return 1;
}

INLINE Term spin_35(Env e, THR Term* o, Term r0) {
  u32 wpoll = 0;
  u32 _v_2 = 0;
  Term _s_0 = r0;
  WL_SPIN
    u32 _v_3 = 0;
    Term _o_0[1];
    if (spin_28(e, _o_0, _s_0, 0ull) == 0) {
      return 0;
    }
    _v_3 = _o_0[0];
    _v_2 = _v_3;
  break;
  }
  o[0] = _v_2;
  return 1;
}

INLINE Term spin_36(Env e, THR Term* o, u32 r0, Term r1, Term r2, Term r3) {
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
      _v_1 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C332, _nd_7);
    } else if (_r_0 == 1) {
      u64 _nd_10 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_10 + 0] = _r_1;
      e.mem[_nd_10 + 1] = _r_2;
      e.mem[_nd_10 + 2] = _r_3;
      _v_1 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C333, _nd_10);
    } else {
      term_sink(e, _r_1);
      _v_1 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C334, 0);
    }
  break;
  }
  o[0] = _v_1;
  return 1;
}

INLINE Term spin_37(Env e, THR Term* o, u32 r0, Term r1, Term r2, Term r3) {
  u32 wpoll = 0;
  Term _v_7 = 0;
  Term _v_8 = 0;
  Term _v_9 = 0;
  u32 _r_0 = r0;
  Term _r_1 = r1;
  Term _r_2 = r2;
  Term _r_3 = r3;
  WL_SPIN
    if (_r_0 == 1) {
      _v_7 = _r_1;
      _v_8 = _r_2;
      _v_9 = _r_3;
    } else {
      term_sink(e, _r_2);
      term_sink(e, _r_3);
      _v_7 = term_pak(CID_SNIL, 0);
      _v_8 = term_pak(CID_SNIL, 0);
      _v_9 = term_pak(CID_SNIL, 0);
    }
  break;
  }
  o[0] = _v_7;
  o[1] = _v_8;
  o[2] = _v_9;
  return 1;
}

INLINE Term spin_38(Env e, THR Term* o, Term r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_11 = 0;
  Term _m_0 = r0;
  Term _m_1 = r1;
  Term _m_2 = r2;
  WL_SPIN
    term_sink(e, _m_0);
    term_sink(e, _m_1);
    _v_11 = _m_2;
  break;
  }
  o[0] = _v_11;
  return 1;
}

INLINE Term spin_39(Env e, THR Term* o, u32 r0, Term r1) {
  u32 wpoll = 0;
  Term _v_14 = 0;
  u32 _ok_0 = r0;
  Term _why_0 = r1;
  WL_SPIN
    Term _v_15 = 0;
    Term _o_9[1];
    if (spin_11(e, _o_9, _ok_0, term_pak(CID_SNIL, 0), _why_0) == 0) {
      return 0;
    }
    _v_15 = _o_9[0];
    _v_14 = _v_15;
  break;
  }
  o[0] = _v_14;
  return 1;
}

INLINE Term spin_40(Env e, THR Term* o, u32 r0, Term r1, u32 r2, Term r3) {
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
        _v_7 = term_ctr(CID_SCON, STAT_OFF + 1414);
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

INLINE Term spin_41(Env e, THR Term* o, u32 r0, Term r1, Term r2) {
  u32 wpoll = 0;
  Term _v_2 = 0;
  u32 _r_0 = r0;
  Term _r_1 = r1;
  Term _r_2 = r2;
  WL_SPIN
    if (_r_0 == 0) {
      _v_2 = _r_2;
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
      STK(2) = FID____SRC_GIT_TEXT_RUN_RES_NUM_K15;
      WL_PUSHN(3);
    } else {
      u64 _t_0 = task_node(e, FID____SRC_GIT_TEXT_RUN_RES_NUM_K15, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _rest_0;
      e.mem[_t_0 + 1] = _sig_0;
      WL_CONT = term_tsk(FID____SRC_GIT_TEXT_RUN_RES_NUM_K15, _t_0);
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
  WL_CASE(FID____SRC_GIT_TEXT_RUN_RES_NUM_K15)
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
    if (spin_5(e, _o_1, _h_0, _h_1, _rest_1, _sig_1) == 0) {
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
  WL_CASE(FID____SRC_GIT_STATUS_WS_STAGE3_PICK)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
    Term _r_2 = r2;
    Term _branch_0 = r3;
    Term _commit_0 = r4;
    WL_OPEN
    if (_r_0 == 0) {
      u32 _s_0 = U32_BIN(_r_1, ==, 0ull);
      if (_s_0 == 1) {
        u32 _v_0 = 0;
        u32 _v_1 = 0;
        Term _o_0[1];
        if (spin_4(e, _o_0, _r_2) == 0) {
          return 0;
        }
        _v_1 = _o_0[0];
        _v_0 = _v_1;
        term_sink(e, _r_2);
        r0 = 0;
        r1 = _branch_0;
        r2 = _commit_0;
        r3 = _v_0;
        WL_RETN(4);
      } else {
        term_sink(e, _branch_0);
        term_sink(e, _commit_0);
        if (seq) {
          WL_ROOM(1);
          STK(0) = FID____SRC_GIT_STATUS_WS_STAGE3_PICK_K17;
          WL_PUSHN(1);
        } else {
          u64 _t_0 = task_node(e, FID____SRC_GIT_STATUS_WS_STAGE3_PICK_K17, WL_CONT, WL_IDX, 1);
          WL_CONT = term_tsk(FID____SRC_GIT_STATUS_WS_STAGE3_PICK_K17, _t_0);
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
      term_sink(e, _branch_0);
      term_sink(e, _commit_0);
      r0 = 1;
      r1 = 4;
      r2 = term_ctr(CID_SCON, STAT_OFF + 74);
      r3 = _r_1;
      WL_RETN(4);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_STAGE3_PICK_K17)
  {
    Term _h_0 = r0;
    WL_OPEN
    r0 = 1;
    r1 = 4;
    r2 = term_ctr(CID_SCON, STAT_OFF + 74);
    r3 = _h_0;
    WL_RETN(4);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_STAGE2_PICK)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
    Term _r_2 = r2;
    Term _branch_0 = r3;
    Term _path_0 = r4;
    WL_OPEN
    if (_r_0 == 0) {
      term_sink(e, _path_0);
      u32 _s_0 = U32_BIN(_r_1, ==, 0ull);
      if (_s_0 == 1) {
        if (seq) {
          WL_ROOM(2);
          STK(0) = _branch_0;
          STK(1) = FID____SRC_GIT_STATUS_WS_STAGE2_PICK_K19;
          WL_PUSHN(2);
        } else {
          u64 _t_0 = task_node(e, FID____SRC_GIT_STATUS_WS_STAGE2_PICK_K19, WL_CONT, WL_IDX, 1);
          e.mem[_t_0 + 0] = _branch_0;
          WL_CONT = term_tsk(FID____SRC_GIT_STATUS_WS_STAGE2_PICK_K19, _t_0);
          WL_IDX = 1;
        }
        if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
          u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
          e.mem[_t_1 + 0] = _r_2;
          return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_1);
        }
        r0 = _r_2;
        WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
      } else {
        term_sink(e, _branch_0);
        if (seq) {
          WL_ROOM(1);
          STK(0) = FID____SRC_GIT_STATUS_WS_STAGE2_PICK_K20;
          WL_PUSHN(1);
        } else {
          u64 _t_2 = task_node(e, FID____SRC_GIT_STATUS_WS_STAGE2_PICK_K20, WL_CONT, WL_IDX, 1);
          WL_CONT = term_tsk(FID____SRC_GIT_STATUS_WS_STAGE2_PICK_K20, _t_2);
          WL_IDX = 0;
        }
        if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
          u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
          e.mem[_t_3 + 0] = _r_2;
          return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_3);
        }
        r0 = _r_2;
        WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
      }
    } else {
      term_sink(e, _branch_0);
      term_sink(e, _path_0);
      r0 = 1;
      r1 = 4;
      r2 = term_ctr(CID_SCON, STAT_OFF + 74);
      r3 = _r_1;
      WL_RETN(4);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_STAGE2_PICK_K19)
  {
    WL_POPN(1);
    Term _branch_1 = STK(0);
    Term _h_0 = r0;
    WL_OPEN
    r0 = 2;
    r1 = _branch_1;
    r2 = _h_0;
    r3 = 0;
    WL_RETN(4);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_STAGE2_PICK_K20)
  {
    Term _h_1 = r0;
    WL_OPEN
    r0 = 1;
    r1 = 4;
    r2 = term_ctr(CID_SCON, STAT_OFF + 74);
    r3 = _h_1;
    WL_RETN(4);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_STAGE1_PICK)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
    Term _r_2 = r2;
    Term _path_0 = r3;
    WL_OPEN
    if (_r_0 == 0) {
      term_sink(e, _path_0);
      u32 _s_0 = U32_BIN(_r_1, ==, 0ull);
      if (_s_0 == 1) {
        if (seq) {
          WL_ROOM(1);
          STK(0) = FID____SRC_GIT_STATUS_WS_STAGE1_PICK_K40;
          WL_PUSHN(1);
        } else {
          u64 _t_0 = task_node(e, FID____SRC_GIT_STATUS_WS_STAGE1_PICK_K40, WL_CONT, WL_IDX, 1);
          WL_CONT = term_tsk(FID____SRC_GIT_STATUS_WS_STAGE1_PICK_K40, _t_0);
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
        if (seq) {
          WL_ROOM(1);
          STK(0) = FID____SRC_GIT_STATUS_WS_STAGE1_PICK_K41;
          WL_PUSHN(1);
        } else {
          u64 _t_2 = task_node(e, FID____SRC_GIT_STATUS_WS_STAGE1_PICK_K41, WL_CONT, WL_IDX, 1);
          WL_CONT = term_tsk(FID____SRC_GIT_STATUS_WS_STAGE1_PICK_K41, _t_2);
          WL_IDX = 0;
        }
        if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
          u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
          e.mem[_t_3 + 0] = _r_2;
          return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_3);
        }
        r0 = _r_2;
        WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
      }
    } else {
      term_sink(e, _path_0);
      r0 = 1;
      r1 = 4;
      r2 = term_ctr(CID_SCON, STAT_OFF + 74);
      r3 = _r_1;
      WL_RETN(4);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_STAGE1_PICK_K40)
  {
    Term _h_0 = r0;
    WL_OPEN
    r0 = 2;
    r1 = _h_0;
    r2 = term_pak(CID_SNIL, 0);
    r3 = 0;
    WL_RETN(4);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_STAGE1_PICK_K41)
  {
    Term _h_1 = r0;
    WL_OPEN
    r0 = 1;
    r1 = 4;
    r2 = term_ctr(CID_SCON, STAT_OFF + 74);
    r3 = _h_1;
    WL_RETN(4);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_STATUS_DIRTY_FAIL)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
    Term _r_2 = r2;
    Term _r_3 = r3;
    Term _base_0 = r4;
    WL_OPEN
    if (_r_0 == 1) {
      term_sink(e, _r_1);
      term_sink(e, _r_2);
      term_sink(e, _base_0);
      Term _v_0 = 0;
      Term _o_0[1];
      if (spin_11(e, _o_0, _r_3, term_pak(CID_SNIL, 0), term_ctr(CID_SCON, STAT_OFF + 332)) == 0) {
        return 0;
      }
      _v_0 = _o_0[0];
      r0 = _v_0;
      WL_RETN(1);
    } else {
      term_sink(e, _base_0);
      if (seq) {
        WL_ROOM(1);
        STK(0) = FID____SRC_GIT_STATUS_STATUS_DIRTY_FAIL_K54;
        WL_PUSHN(1);
      } else {
        u64 _t_0 = task_node(e, FID____SRC_GIT_STATUS_STATUS_DIRTY_FAIL_K54, WL_CONT, WL_IDX, 1);
        WL_CONT = term_tsk(FID____SRC_GIT_STATUS_STATUS_DIRTY_FAIL_K54, _t_0);
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
  WL_CASE(FID____SRC_GIT_STATUS_STATUS_DIRTY_FAIL_K54)
  {
    Term _h_0 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID____SRC_GIT_STATUS_STATUS_DIRTY_FAIL_K55;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID____SRC_GIT_STATUS_STATUS_DIRTY_FAIL_K55, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_STATUS_STATUS_DIRTY_FAIL_K55, _t_2);
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
  WL_CASE(FID____SRC_GIT_STATUS_STATUS_DIRTY_FAIL_K55)
  {
    Term _h_1 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_4 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = term_ctr(CID_SCON, STAT_OFF + 364);
      e.mem[_t_4 + 1] = _h_1;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_4);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 364);
    r1 = _h_1;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_GO3)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
    Term _r_2 = r2;
    Term _r_3 = r3;
    Term _path_0 = r4;
    WL_OPEN
    if (_r_0 == 0) {
      term_sink(e, _path_0);
      u64 _nd_0 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_0 + 0] = _r_1;
      e.mem[_nd_0 + 1] = _r_2;
      e.mem[_nd_0 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_STATUS_WS_GO3_C62, _nd_0);
      WL_RETN(1);
    } else if (_r_0 == 1) {
      term_sink(e, _path_0);
      u64 _nd_2 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_2 + 0] = _r_1;
      e.mem[_nd_2 + 1] = _r_2;
      e.mem[_nd_2 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_STATUS_WS_GO3_C63, _nd_2);
      WL_RETN(1);
    } else {
      if (seq) {
        WL_ROOM(3);
        STK(0) = _r_1;
        STK(1) = _r_2;
        STK(2) = FID____SRC_GIT_STATUS_WS_GO3_K64;
        WL_PUSHN(3);
      } else {
        u64 _t_2 = task_node(e, FID____SRC_GIT_STATUS_WS_GO3_K64, WL_CONT, WL_IDX, 1);
        e.mem[_t_2 + 0] = _r_1;
        e.mem[_t_2 + 1] = _r_2;
        WL_CONT = term_tsk(FID____SRC_GIT_STATUS_WS_GO3_K64, _t_2);
        WL_IDX = 2;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
        u64 _t_3 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
        e.mem[_t_3 + 0] = _path_0;
        e.mem[_t_3 + 1] = term_ctr(CID_CON, STAT_OFF + 150);
        return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_3);
      }
      r0 = _path_0;
      r1 = term_ctr(CID_CON, STAT_OFF + 150);
      WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_GO3_C62)
  {
    Term _r_4 = r0;
    Term _r_5 = r1;
    u32 _r_6 = r2;
    Term _x_0 = r3;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_1 + 0] = _r_4;
    e.mem[_nd_1 + 1] = _r_5;
    e.mem[_nd_1 + 2] = _r_6;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_0 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = term_ctr(CID____SRC_GIT_STATUS_WSDONE, _nd_1);
      e.mem[_t_0 + 1] = _x_0;
      return term_tsk(FID_IO_PURE, _t_0);
    }
    r0 = term_ctr(CID____SRC_GIT_STATUS_WSDONE, _nd_1);
    r1 = _x_0;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_GO3_C63)
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
      e.mem[_t_1 + 0] = term_ctr(CID____SRC_GIT_STATUS_WSFAIL, _nd_3);
      e.mem[_t_1 + 1] = _x_1;
      return term_tsk(FID_IO_PURE, _t_1);
    }
    r0 = term_ctr(CID____SRC_GIT_STATUS_WSFAIL, _nd_3);
    r1 = _x_1;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_GO3_K64)
  {
    WL_POPN(2);
    Term _r_10 = STK(0);
    Term _r_11 = STK(1);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_4 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_4 + 0] = _r_10;
    e.mem[_nd_4 + 1] = _r_11;
    e.mem[_nd_4 + 2] = _h_0;
    r0 = term_clo(FID____SRC_GIT_STATUS_WS_GO3_C65, _nd_4);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_GO3_C65)
  {
    Term _r_12 = r0;
    Term _r_13 = r1;
    Term _h_1 = r2;
    Term _x_2 = r3;
    WL_OPEN
    u64 _nd_5 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_5 + 0] = _r_12;
    e.mem[_nd_5 + 1] = _r_13;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_7 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_7 + 0] = _h_1;
      e.mem[_t_7 + 1] = term_clo(FID____SRC_GIT_STATUS_WS_GO3_C66, _nd_5);
      e.mem[_t_7 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_7);
    }
    r0 = _h_1;
    r1 = term_clo(FID____SRC_GIT_STATUS_WS_GO3_C66, _nd_5);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_GO3_C66)
  {
    Term _r_14 = r0;
    Term _r_15 = r1;
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
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID____SRC_GIT_STATUS_WS_GO3_K67;
      WL_PUSHN(1);
    } else {
      u64 _t_4 = task_node(e, FID____SRC_GIT_STATUS_WS_GO3_K67, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_STATUS_WS_GO3_K67, _t_4);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_STATUS_WS_STAGE3_PICK)) {
      u64 _t_5 = task_node(e, FID____SRC_GIT_STATUS_WS_STAGE3_PICK, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _o_0;
      e.mem[_t_5 + 1] = _o_1;
      e.mem[_t_5 + 2] = _o_2;
      e.mem[_t_5 + 3] = _r_14;
      e.mem[_t_5 + 4] = _r_15;
      return term_tsk(FID____SRC_GIT_STATUS_WS_STAGE3_PICK, _t_5);
    }
    r0 = _o_0;
    r1 = _o_1;
    r2 = _o_2;
    r3 = _r_14;
    r4 = _r_15;
    WL_JMP(FID____SRC_GIT_STATUS_WS_STAGE3_PICK);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_GO3_K67)
  {
    u32 _h_2 = r0;
    Term _h_3 = r1;
    Term _h_4 = r2;
    Term _h_5 = r3;
    WL_OPEN
    u64 _nd_6 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_6 + 0] = _h_2;
    e.mem[_nd_6 + 1] = _h_3;
    e.mem[_nd_6 + 2] = _h_4;
    e.mem[_nd_6 + 3] = _h_5;
    r0 = term_clo(FID____SRC_GIT_STATUS_WS_GO3_C68, _nd_6);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_GO3_C68)
  {
    u32 _h_6 = r0;
    Term _h_7 = r1;
    Term _h_8 = r2;
    Term _h_9 = r3;
    Term _x_4 = r4;
    WL_OPEN
    Term _b_0 = 0;
    if (_h_6 == 0) {
      u64 _nd_7 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_7 + 0] = _h_7;
      e.mem[_nd_7 + 1] = _h_8;
      e.mem[_nd_7 + 2] = _h_9;
      _b_0 = term_ctr(CID____SRC_GIT_STATUS_WSDONE, _nd_7);
    } else if (_h_6 == 1) {
      u64 _nd_8 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_8 + 0] = _h_7;
      e.mem[_nd_8 + 1] = _h_8;
      e.mem[_nd_8 + 2] = _h_9;
      _b_0 = term_ctr(CID____SRC_GIT_STATUS_WSFAIL, _nd_8);
    } else {
      u64 _nd_9 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_9 + 0] = _h_7;
      e.mem[_nd_9 + 1] = _h_8;
      _b_0 = term_ctr(CID____SRC_GIT_STATUS_WSNEXT, _nd_9);
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
  WL_CASE(FID____SRC_GIT_STATUS_WS_GO2)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
    Term _r_2 = r2;
    Term _r_3 = r3;
    Term _path_0 = r4;
    WL_OPEN
    if (_r_0 == 0) {
      term_sink(e, _path_0);
      u64 _nd_0 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_0 + 0] = _r_1;
      e.mem[_nd_0 + 1] = _r_2;
      e.mem[_nd_0 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_STATUS_WS_GO2_C70, _nd_0);
      WL_RETN(1);
    } else if (_r_0 == 1) {
      term_sink(e, _path_0);
      u64 _nd_2 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_2 + 0] = _r_1;
      e.mem[_nd_2 + 1] = _r_2;
      e.mem[_nd_2 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_STATUS_WS_GO2_C71, _nd_2);
      WL_RETN(1);
    } else {
      term_sink(e, _r_2);
      _path_0 = term_keep(e, _path_0);
      if (seq) {
        WL_ROOM(3);
        STK(0) = _r_1;
        STK(1) = _path_0;
        STK(2) = FID____SRC_GIT_STATUS_WS_GO2_K72;
        WL_PUSHN(3);
      } else {
        u64 _t_2 = task_node(e, FID____SRC_GIT_STATUS_WS_GO2_K72, WL_CONT, WL_IDX, 1);
        e.mem[_t_2 + 0] = _r_1;
        e.mem[_t_2 + 1] = _path_0;
        WL_CONT = term_tsk(FID____SRC_GIT_STATUS_WS_GO2_K72, _t_2);
        WL_IDX = 2;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
        u64 _t_3 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
        e.mem[_t_3 + 0] = _path_0;
        e.mem[_t_3 + 1] = term_ctr(CID_CON, STAT_OFF + 180);
        return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_3);
      }
      r0 = _path_0;
      r1 = term_ctr(CID_CON, STAT_OFF + 180);
      WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_GO2_C70)
  {
    Term _r_4 = r0;
    Term _r_5 = r1;
    u32 _r_6 = r2;
    Term _x_0 = r3;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_1 + 0] = _r_4;
    e.mem[_nd_1 + 1] = _r_5;
    e.mem[_nd_1 + 2] = _r_6;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_0 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = term_ctr(CID____SRC_GIT_STATUS_WSDONE, _nd_1);
      e.mem[_t_0 + 1] = _x_0;
      return term_tsk(FID_IO_PURE, _t_0);
    }
    r0 = term_ctr(CID____SRC_GIT_STATUS_WSDONE, _nd_1);
    r1 = _x_0;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_GO2_C71)
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
      e.mem[_t_1 + 0] = term_ctr(CID____SRC_GIT_STATUS_WSFAIL, _nd_3);
      e.mem[_t_1 + 1] = _x_1;
      return term_tsk(FID_IO_PURE, _t_1);
    }
    r0 = term_ctr(CID____SRC_GIT_STATUS_WSFAIL, _nd_3);
    r1 = _x_1;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_GO2_K72)
  {
    WL_POPN(2);
    Term _r_10 = STK(0);
    Term _path_1 = STK(1);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_4 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_4 + 0] = _r_10;
    e.mem[_nd_4 + 1] = _path_1;
    e.mem[_nd_4 + 2] = _h_0;
    r0 = term_clo(FID____SRC_GIT_STATUS_WS_GO2_C73, _nd_4);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_GO2_C73)
  {
    Term _r_11 = r0;
    Term _path_2 = r1;
    Term _h_1 = r2;
    Term _x_2 = r3;
    WL_OPEN
    u64 _nd_5 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_5 + 0] = _r_11;
    e.mem[_nd_5 + 1] = _path_2;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_7 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_7 + 0] = _h_1;
      e.mem[_t_7 + 1] = term_clo(FID____SRC_GIT_STATUS_WS_GO2_C74, _nd_5);
      e.mem[_t_7 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_7);
    }
    r0 = _h_1;
    r1 = term_clo(FID____SRC_GIT_STATUS_WS_GO2_C74, _nd_5);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_GO2_C74)
  {
    Term _r_12 = r0;
    Term _path_3 = r1;
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
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID____SRC_GIT_STATUS_WS_GO2_K75;
      WL_PUSHN(1);
    } else {
      u64 _t_4 = task_node(e, FID____SRC_GIT_STATUS_WS_GO2_K75, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_STATUS_WS_GO2_K75, _t_4);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_STATUS_WS_STAGE2_PICK)) {
      u64 _t_5 = task_node(e, FID____SRC_GIT_STATUS_WS_STAGE2_PICK, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _o_0;
      e.mem[_t_5 + 1] = _o_1;
      e.mem[_t_5 + 2] = _o_2;
      e.mem[_t_5 + 3] = _r_12;
      e.mem[_t_5 + 4] = _path_3;
      return term_tsk(FID____SRC_GIT_STATUS_WS_STAGE2_PICK, _t_5);
    }
    r0 = _o_0;
    r1 = _o_1;
    r2 = _o_2;
    r3 = _r_12;
    r4 = _path_3;
    WL_JMP(FID____SRC_GIT_STATUS_WS_STAGE2_PICK);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_GO2_K75)
  {
    u32 _h_2 = r0;
    Term _h_3 = r1;
    Term _h_4 = r2;
    Term _h_5 = r3;
    WL_OPEN
    u64 _nd_6 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_6 + 0] = _h_2;
    e.mem[_nd_6 + 1] = _h_3;
    e.mem[_nd_6 + 2] = _h_4;
    e.mem[_nd_6 + 3] = _h_5;
    r0 = term_clo(FID____SRC_GIT_STATUS_WS_GO2_C76, _nd_6);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_GO2_C76)
  {
    u32 _h_6 = r0;
    Term _h_7 = r1;
    Term _h_8 = r2;
    Term _h_9 = r3;
    Term _x_4 = r4;
    WL_OPEN
    Term _b_0 = 0;
    if (_h_6 == 0) {
      u64 _nd_7 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_7 + 0] = _h_7;
      e.mem[_nd_7 + 1] = _h_8;
      e.mem[_nd_7 + 2] = _h_9;
      _b_0 = term_ctr(CID____SRC_GIT_STATUS_WSDONE, _nd_7);
    } else if (_h_6 == 1) {
      u64 _nd_8 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_8 + 0] = _h_7;
      e.mem[_nd_8 + 1] = _h_8;
      e.mem[_nd_8 + 2] = _h_9;
      _b_0 = term_ctr(CID____SRC_GIT_STATUS_WSFAIL, _nd_8);
    } else {
      u64 _nd_9 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_9 + 0] = _h_7;
      e.mem[_nd_9 + 1] = _h_8;
      _b_0 = term_ctr(CID____SRC_GIT_STATUS_WSNEXT, _nd_9);
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
  WL_CASE(FID____SRC_GIT_STATUS_WS_STAGE1)
  {
    Term _path_0 = r0;
    WL_OPEN
    _path_0 = term_keep(e, _path_0);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _path_0;
      STK(1) = FID____SRC_GIT_STATUS_WS_STAGE1_K78;
      WL_PUSHN(2);
    } else {
      u64 _t_0 = task_node(e, FID____SRC_GIT_STATUS_WS_STAGE1_K78, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _path_0;
      WL_CONT = term_tsk(FID____SRC_GIT_STATUS_WS_STAGE1_K78, _t_0);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _path_0;
      e.mem[_t_1 + 1] = term_ctr(CID_CON, STAT_OFF + 427);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_1);
    }
    r0 = _path_0;
    r1 = term_ctr(CID_CON, STAT_OFF + 427);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_STAGE1_K78)
  {
    WL_POPN(1);
    Term _path_1 = STK(0);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_0 + 0] = _path_1;
    e.mem[_nd_0 + 1] = _h_0;
    r0 = term_clo(FID____SRC_GIT_STATUS_WS_STAGE1_C79, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_STAGE1_C79)
  {
    Term _path_2 = r0;
    Term _h_1 = r1;
    Term _x_0 = r2;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_1 + 0] = _path_2;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_5 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _h_1;
      e.mem[_t_5 + 1] = term_clo(FID____SRC_GIT_STATUS_WS_STAGE1_C80, _nd_1);
      e.mem[_t_5 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_5);
    }
    r0 = _h_1;
    r1 = term_clo(FID____SRC_GIT_STATUS_WS_STAGE1_C80, _nd_1);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_STAGE1_C80)
  {
    Term _path_3 = r0;
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
      STK(0) = FID____SRC_GIT_STATUS_WS_STAGE1_K81;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID____SRC_GIT_STATUS_WS_STAGE1_K81, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_STATUS_WS_STAGE1_K81, _t_2);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_STATUS_WS_STAGE1_PICK)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_STATUS_WS_STAGE1_PICK, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _o_0;
      e.mem[_t_3 + 1] = _o_1;
      e.mem[_t_3 + 2] = _o_2;
      e.mem[_t_3 + 3] = _path_3;
      return term_tsk(FID____SRC_GIT_STATUS_WS_STAGE1_PICK, _t_3);
    }
    r0 = _o_0;
    r1 = _o_1;
    r2 = _o_2;
    r3 = _path_3;
    WL_JMP(FID____SRC_GIT_STATUS_WS_STAGE1_PICK);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_STAGE1_K81)
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
    r0 = term_clo(FID____SRC_GIT_STATUS_WS_STAGE1_C82, _nd_2);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_STAGE1_C82)
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
      _b_0 = term_ctr(CID____SRC_GIT_STATUS_WSDONE, _nd_3);
    } else if (_h_6 == 1) {
      u64 _nd_4 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_4 + 0] = _h_7;
      e.mem[_nd_4 + 1] = _h_8;
      e.mem[_nd_4 + 2] = _h_9;
      _b_0 = term_ctr(CID____SRC_GIT_STATUS_WSFAIL, _nd_4);
    } else {
      u64 _nd_5 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_5 + 0] = _h_7;
      e.mem[_nd_5 + 1] = _h_8;
      _b_0 = term_ctr(CID____SRC_GIT_STATUS_WSNEXT, _nd_5);
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
  WL_CASE(FID_CHK_STATUS_DIRTY)
  {
    Term _wt_0 = r0;
    Term _base_0 = r1;
    WL_OPEN
    _wt_0 = term_keep(e, _wt_0);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _base_0;
      STK(1) = _wt_0;
      STK(2) = FID_CHK_STATUS_DIRTY_K92;
      WL_PUSHN(3);
    } else {
      u64 _t_0 = task_node(e, FID_CHK_STATUS_DIRTY_K92, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _base_0;
      e.mem[_t_0 + 1] = _wt_0;
      WL_CONT = term_tsk(FID_CHK_STATUS_DIRTY_K92, _t_0);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _wt_0;
      e.mem[_t_1 + 1] = term_ctr(CID_SCON, STAT_OFF + 483);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_1);
    }
    r0 = _wt_0;
    r1 = term_ctr(CID_SCON, STAT_OFF + 483);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_STATUS_DIRTY_K92)
  {
    WL_POPN(2);
    Term _base_1 = STK(0);
    Term _wt_1 = STK(1);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_0 + 0] = _h_0;
    e.mem[_nd_0 + 1] = term_pak(CID_NIL, 0);
    u64 _nd_1 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 501);
    e.mem[_nd_1 + 1] = term_ctr(CID_CON, _nd_0);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _base_1;
      STK(1) = _wt_1;
      STK(2) = FID_CHK_STATUS_DIRTY_K93;
      WL_PUSHN(3);
    } else {
      u64 _t_2 = task_node(e, FID_CHK_STATUS_DIRTY_K93, WL_CONT, WL_IDX, 1);
      e.mem[_t_2 + 0] = _base_1;
      e.mem[_t_2 + 1] = _wt_1;
      WL_CONT = term_tsk(FID_CHK_STATUS_DIRTY_K93, _t_2);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = term_ctr(CID_CON, _nd_1);
      e.mem[_t_3 + 1] = term_ctr(CID_SCON, STAT_OFF + 503);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_3);
    }
    r0 = term_ctr(CID_CON, _nd_1);
    r1 = term_ctr(CID_SCON, STAT_OFF + 503);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_STATUS_DIRTY_K93)
  {
    WL_POPN(2);
    Term _base_2 = STK(0);
    Term _wt_2 = STK(1);
    Term _h_1 = r0;
    WL_OPEN
    u64 _nd_2 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_2 + 0] = _base_2;
    e.mem[_nd_2 + 1] = _wt_2;
    e.mem[_nd_2 + 2] = _h_1;
    r0 = term_clo(FID_CHK_STATUS_DIRTY_C94, _nd_2);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_STATUS_DIRTY_C94)
  {
    Term _base_3 = r0;
    Term _wt_3 = r1;
    Term _h_2 = r2;
    Term _x_0 = r3;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_3 + 0] = _h_2;
    u64 _nd_4 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_4 + 0] = _base_3;
    e.mem[_nd_4 + 1] = _wt_3;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_12 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_12 + 0] = term_clo(FID_CHK_STATUS_DIRTY_C95, _nd_3);
      e.mem[_t_12 + 1] = term_clo(FID_CHK_STATUS_DIRTY_C98, _nd_4);
      e.mem[_t_12 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_12);
    }
    r0 = term_clo(FID_CHK_STATUS_DIRTY_C95, _nd_3);
    r1 = term_clo(FID_CHK_STATUS_DIRTY_C98, _nd_4);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_STATUS_DIRTY_C95)
  {
    Term _h_3 = r0;
    Term _x_1 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_5 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _h_3;
      e.mem[_t_5 + 1] = term_clo(FID_CHK_STATUS_DIRTY_C96, 0);
      e.mem[_t_5 + 2] = _x_1;
      return term_tsk(FID_IO_BIND, _t_5);
    }
    r0 = _h_3;
    r1 = term_clo(FID_CHK_STATUS_DIRTY_C96, 0);
    r2 = _x_1;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_STATUS_DIRTY_C96)
  {
    Term _x_2 = r0;
    WL_OPEN
    u32 _o_0 = 0;
    Term _o_1 = 0;
    u32 _o_2 = 0;
    Term _o_3 = 0;
    if (term_aux(_x_2) == CID____SRC_GIT_TYPES_RRUN) {
      _o_0 = 0;
      Term _fb_0[3];
      u64 _sp_0 = ctr_take(e, _x_2, 3, _fb_0);
      u32 _f_0 = _fb_0[0];
      u32 _f_1 = _fb_0[1];
      Term _f_2 = _fb_0[2];
      spare_free(e, cls_fit(3), _sp_0);
      _o_1 = _f_0;
      _o_2 = _f_1;
      _o_3 = _f_2;
    } else {
      _o_0 = 1;
      u64 _sp_1 = term_loc(_x_2);
      Term _f_3 = e.mem[_sp_1 + 0];
      heap_free(e, cls_fit(1), _sp_1);
      _o_1 = _f_3;
    }
    term_sink(e, _o_1);
    term_sink(e, _o_3);
    r0 = term_clo(FID_CHK_STATUS_DIRTY_C97, 0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_STATUS_DIRTY_C97)
  {
    Term _x_3 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_4 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = term_pak(CID_SNIL, 0);
      e.mem[_t_4 + 1] = _x_3;
      return term_tsk(FID_IO_PURE, _t_4);
    }
    r0 = term_pak(CID_SNIL, 0);
    r1 = _x_3;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_STATUS_DIRTY_C98)
  {
    Term _base_4 = r0;
    Term _wt_4 = r1;
    Term _x_4 = r2;
    WL_OPEN
    term_sink(e, _x_4);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _base_4;
      STK(1) = FID_CHK_STATUS_DIRTY_K99;
      WL_PUSHN(2);
    } else {
      u64 _t_6 = task_node(e, FID_CHK_STATUS_DIRTY_K99, WL_CONT, WL_IDX, 1);
      e.mem[_t_6 + 0] = _base_4;
      WL_CONT = term_tsk(FID_CHK_STATUS_DIRTY_K99, _t_6);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_STATUS_WORKTREESTATUS)) {
      u64 _t_7 = task_node(e, FID____SRC_GIT_STATUS_WORKTREESTATUS, WL_CONT, WL_IDX, 0);
      e.mem[_t_7 + 0] = _wt_4;
      return term_tsk(FID____SRC_GIT_STATUS_WORKTREESTATUS, _t_7);
    }
    r0 = _wt_4;
    WL_JMP(FID____SRC_GIT_STATUS_WORKTREESTATUS);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_STATUS_DIRTY_K99)
  {
    WL_POPN(1);
    Term _base_5 = STK(0);
    Term _h_4 = r0;
    WL_OPEN
    u64 _nd_5 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_5 + 0] = _base_5;
    e.mem[_nd_5 + 1] = _h_4;
    r0 = term_clo(FID_CHK_STATUS_DIRTY_C100, _nd_5);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_STATUS_DIRTY_C100)
  {
    Term _base_6 = r0;
    Term _h_5 = r1;
    Term _x_5 = r2;
    WL_OPEN
    u64 _nd_6 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_6 + 0] = _base_6;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_11 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_11 + 0] = _h_5;
      e.mem[_t_11 + 1] = term_clo(FID_CHK_STATUS_DIRTY_C101, _nd_6);
      e.mem[_t_11 + 2] = _x_5;
      return term_tsk(FID_IO_BIND, _t_11);
    }
    r0 = _h_5;
    r1 = term_clo(FID_CHK_STATUS_DIRTY_C101, _nd_6);
    r2 = _x_5;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_STATUS_DIRTY_C101)
  {
    Term _base_7 = r0;
    Term _x_6 = r1;
    WL_OPEN
    u32 _o_4 = 0;
    Term _o_5 = 0;
    Term _o_6 = 0;
    Term _o_7 = 0;
    if (term_aux(_x_6) == CID_FAIL) {
      _o_4 = 0;
      Term _fb_1[1];
      u64 _sp_2 = ctr_take(e, _x_6, 1, _fb_1);
      Term _f_4 = _fb_1[0];
      spare_free(e, cls_fit(1), _sp_2);
      u32 _o_8 = 0;
      Term _o_9 = 0;
      Term _o_10 = 0;
      if (term_aux(_f_4) == CID____SRC_GIT_TYPES_FBRANCHEXISTS) {
        _o_8 = 0;
        u64 _sp_3 = term_loc(_f_4);
        Term _f_5 = e.mem[_sp_3 + 0];
        heap_free(e, cls_fit(1), _sp_3);
        _o_9 = _f_5;
      } else if (term_aux(_f_4) == CID____SRC_GIT_TYPES_FPATHEXISTS) {
        _o_8 = 1;
        u64 _sp_4 = term_loc(_f_4);
        Term _f_6 = e.mem[_sp_4 + 0];
        heap_free(e, cls_fit(1), _sp_4);
        _o_9 = _f_6;
      } else if (term_aux(_f_4) == CID____SRC_GIT_TYPES_FUNKNOWNBASE) {
        _o_8 = 2;
        u64 _sp_5 = term_loc(_f_4);
        Term _f_7 = e.mem[_sp_5 + 0];
        heap_free(e, cls_fit(1), _sp_5);
        _o_9 = _f_7;
      } else if (term_aux(_f_4) == CID____SRC_GIT_TYPES_FTARGETBUSY) {
        _o_8 = 3;
        u64 _sp_6 = term_loc(_f_4);
        Term _f_8 = e.mem[_sp_6 + 0];
        heap_free(e, cls_fit(1), _sp_6);
        _o_9 = _f_8;
      } else {
        _o_8 = 4;
        Term _fb_2[2];
        u64 _sp_7 = ctr_take(e, _f_4, 2, _fb_2);
        Term _f_9 = _fb_2[0];
        Term _f_10 = _fb_2[1];
        spare_free(e, cls_fit(2), _sp_7);
        _o_9 = _f_9;
        _o_10 = _f_10;
      }
      _o_5 = _o_8;
      _o_6 = _o_9;
      _o_7 = _o_10;
    } else {
      _o_4 = 1;
      u64 _sp_8 = term_loc(_x_6);
      Term _f_11 = e.mem[_sp_8 + 0];
      heap_free(e, cls_fit(1), _sp_8);
      u64 _sp_9 = term_loc(_f_11);
      Term _f_12 = e.mem[_sp_9 + 0];
      Term _f_13 = e.mem[_sp_9 + 1];
      u32 _f_14 = e.mem[_sp_9 + 2];
      heap_free(e, cls_fit(3), _sp_9);
      _o_5 = _f_12;
      _o_6 = _f_13;
      _o_7 = _f_14;
    }
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_CHK_STATUS_DIRTY_K102;
      WL_PUSHN(1);
    } else {
      u64 _t_8 = task_node(e, FID_CHK_STATUS_DIRTY_K102, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_CHK_STATUS_DIRTY_K102, _t_8);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_STATUS_STATUS_DIRTY_FAIL)) {
      u64 _t_9 = task_node(e, FID____SRC_GIT_STATUS_STATUS_DIRTY_FAIL, WL_CONT, WL_IDX, 0);
      e.mem[_t_9 + 0] = _o_4;
      e.mem[_t_9 + 1] = _o_5;
      e.mem[_t_9 + 2] = _o_6;
      e.mem[_t_9 + 3] = _o_7;
      e.mem[_t_9 + 4] = _base_7;
      return term_tsk(FID____SRC_GIT_STATUS_STATUS_DIRTY_FAIL, _t_9);
    }
    r0 = _o_4;
    r1 = _o_5;
    r2 = _o_6;
    r3 = _o_7;
    r4 = _base_7;
    WL_JMP(FID____SRC_GIT_STATUS_STATUS_DIRTY_FAIL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_STATUS_DIRTY_K102)
  {
    Term _h_6 = r0;
    WL_OPEN
    u64 _nd_7 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_7 + 0] = _h_6;
    r0 = term_clo(FID_CHK_STATUS_DIRTY_C103, _nd_7);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_STATUS_DIRTY_C103)
  {
    Term _h_7 = r0;
    Term _x_7 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_10 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_10 + 0] = _h_7;
      e.mem[_t_10 + 1] = _x_7;
      return term_tsk(FID_IO_PURE, _t_10);
    }
    r0 = _h_7;
    r1 = _x_7;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
    Term _r_2 = r2;
    Term _r_3 = r3;
    Term _base_0 = r4;
    WL_OPEN
    if (_r_0 == 1) {
      term_sink(e, _r_1);
      if (seq) {
        WL_ROOM(2);
        STK(0) = _r_3;
        STK(1) = FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL_K105;
        WL_PUSHN(2);
      } else {
        u64 _t_0 = task_node(e, FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL_K105, WL_CONT, WL_IDX, 1);
        e.mem[_t_0 + 0] = _r_3;
        WL_CONT = term_tsk(FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL_K105, _t_0);
        WL_IDX = 1;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_EQ)) {
        u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_STR_EQ, WL_CONT, WL_IDX, 0);
        e.mem[_t_1 + 0] = _r_2;
        e.mem[_t_1 + 1] = _base_0;
        return term_tsk(FID____SRC_GIT_TEXT_STR_EQ, _t_1);
      }
      r0 = _r_2;
      r1 = _base_0;
      WL_JMP(FID____SRC_GIT_TEXT_STR_EQ);
    } else {
      term_sink(e, _base_0);
      if (seq) {
        WL_ROOM(1);
        STK(0) = FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL_K106;
        WL_PUSHN(1);
      } else {
        u64 _t_2 = task_node(e, FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL_K106, WL_CONT, WL_IDX, 1);
        WL_CONT = term_tsk(FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL_K106, _t_2);
        WL_IDX = 0;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TYPES_FAIL_TEXT)) {
        u64 _t_3 = task_node(e, FID____SRC_GIT_TYPES_FAIL_TEXT, WL_CONT, WL_IDX, 0);
        e.mem[_t_3 + 0] = _r_1;
        e.mem[_t_3 + 1] = _r_2;
        e.mem[_t_3 + 2] = _r_3;
        return term_tsk(FID____SRC_GIT_TYPES_FAIL_TEXT, _t_3);
      }
      r0 = _r_1;
      r1 = _r_2;
      r2 = _r_3;
      WL_JMP(FID____SRC_GIT_TYPES_FAIL_TEXT);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL_K105)
  {
    WL_POPN(1);
    u32 _r_4 = STK(0);
    u32 _h_0 = r0;
    WL_OPEN
    Term _v_0 = 0;
    u32 _v_1 = 0;
    u32 _v_2 = 0;
    Term _o_0[1];
    if (spin_16(e, _o_0, _r_4) == 0) {
      return 0;
    }
    _v_2 = _o_0[0];
    _v_1 = _v_2;
    Term _v_4 = 0;
    Term _o_1[1];
    if (spin_11(e, _o_1, _v_1, term_pak(CID_SNIL, 0), term_ctr(CID_SCON, STAT_OFF + 573)) == 0) {
      return 0;
    }
    _v_4 = _o_1[0];
    _v_0 = _v_4;
    Term _v_5 = 0;
    Term _o_2[1];
    if (spin_11(e, _o_2, _h_0, _v_0, term_ctr(CID_SCON, STAT_OFF + 615)) == 0) {
      return 0;
    }
    _v_5 = _o_2[0];
    r0 = _v_5;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL_K106)
  {
    Term _h_1 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL_K107;
      WL_PUSHN(1);
    } else {
      u64 _t_4 = task_node(e, FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL_K107, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL_K107, _t_4);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
      u64 _t_5 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _h_1;
      return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_5);
    }
    r0 = _h_1;
    WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL_K107)
  {
    Term _h_2 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_6 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_6 + 0] = term_ctr(CID_SCON, STAT_OFF + 364);
      e.mem[_t_6 + 1] = _h_2;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_6);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 364);
    r1 = _h_2;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WORKTREESTATUS)
  {
    Term _path_0 = r0;
    WL_OPEN
    _path_0 = term_keep(e, _path_0);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _path_0;
      STK(1) = FID____SRC_GIT_STATUS_WORKTREESTATUS_K109;
      WL_PUSHN(2);
    } else {
      u64 _t_0 = task_node(e, FID____SRC_GIT_STATUS_WORKTREESTATUS_K109, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _path_0;
      WL_CONT = term_tsk(FID____SRC_GIT_STATUS_WORKTREESTATUS_K109, _t_0);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_STATUS_WS_STAGE1)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_STATUS_WS_STAGE1, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _path_0;
      return term_tsk(FID____SRC_GIT_STATUS_WS_STAGE1, _t_1);
    }
    r0 = _path_0;
    WL_JMP(FID____SRC_GIT_STATUS_WS_STAGE1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WORKTREESTATUS_K109)
  {
    WL_POPN(1);
    Term _path_1 = STK(0);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_0 + 0] = _path_1;
    e.mem[_nd_0 + 1] = _h_0;
    r0 = term_clo(FID____SRC_GIT_STATUS_WORKTREESTATUS_C110, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WORKTREESTATUS_C110)
  {
    Term _path_2 = r0;
    Term _h_1 = r1;
    Term _x_0 = r2;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_1 + 0] = _path_2;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_11 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_11 + 0] = _h_1;
      e.mem[_t_11 + 1] = term_clo(FID____SRC_GIT_STATUS_WORKTREESTATUS_C111, _nd_1);
      e.mem[_t_11 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_11);
    }
    r0 = _h_1;
    r1 = term_clo(FID____SRC_GIT_STATUS_WORKTREESTATUS_C111, _nd_1);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WORKTREESTATUS_C111)
  {
    Term _path_3 = r0;
    Term _x_1 = r1;
    WL_OPEN
    u32 _o_0 = 0;
    Term _o_1 = 0;
    Term _o_2 = 0;
    Term _o_3 = 0;
    if (term_aux(_x_1) == CID____SRC_GIT_STATUS_WSDONE) {
      _o_0 = 0;
      u64 _sp_0 = term_loc(_x_1);
      Term _f_0 = e.mem[_sp_0 + 0];
      Term _f_1 = e.mem[_sp_0 + 1];
      u32 _f_2 = e.mem[_sp_0 + 2];
      heap_free(e, cls_fit(3), _sp_0);
      _o_1 = _f_0;
      _o_2 = _f_1;
      _o_3 = _f_2;
    } else if (term_aux(_x_1) == CID____SRC_GIT_STATUS_WSFAIL) {
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
      Term _f_7 = e.mem[_sp_2 + 1];
      heap_free(e, cls_fit(2), _sp_2);
      _o_1 = _f_6;
      _o_2 = _f_7;
    }
    _path_3 = term_keep(e, _path_3);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _path_3;
      STK(1) = FID____SRC_GIT_STATUS_WORKTREESTATUS_K112;
      WL_PUSHN(2);
    } else {
      u64 _t_2 = task_node(e, FID____SRC_GIT_STATUS_WORKTREESTATUS_K112, WL_CONT, WL_IDX, 1);
      e.mem[_t_2 + 0] = _path_3;
      WL_CONT = term_tsk(FID____SRC_GIT_STATUS_WORKTREESTATUS_K112, _t_2);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_STATUS_WS_GO2)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_STATUS_WS_GO2, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _o_0;
      e.mem[_t_3 + 1] = _o_1;
      e.mem[_t_3 + 2] = _o_2;
      e.mem[_t_3 + 3] = _o_3;
      e.mem[_t_3 + 4] = _path_3;
      return term_tsk(FID____SRC_GIT_STATUS_WS_GO2, _t_3);
    }
    r0 = _o_0;
    r1 = _o_1;
    r2 = _o_2;
    r3 = _o_3;
    r4 = _path_3;
    WL_JMP(FID____SRC_GIT_STATUS_WS_GO2);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WORKTREESTATUS_K112)
  {
    WL_POPN(1);
    Term _path_4 = STK(0);
    Term _h_2 = r0;
    WL_OPEN
    u64 _nd_2 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_2 + 0] = _path_4;
    e.mem[_nd_2 + 1] = _h_2;
    r0 = term_clo(FID____SRC_GIT_STATUS_WORKTREESTATUS_C113, _nd_2);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WORKTREESTATUS_C113)
  {
    Term _path_5 = r0;
    Term _h_3 = r1;
    Term _x_2 = r2;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_3 + 0] = _path_5;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_10 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_10 + 0] = _h_3;
      e.mem[_t_10 + 1] = term_clo(FID____SRC_GIT_STATUS_WORKTREESTATUS_C114, _nd_3);
      e.mem[_t_10 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_10);
    }
    r0 = _h_3;
    r1 = term_clo(FID____SRC_GIT_STATUS_WORKTREESTATUS_C114, _nd_3);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WORKTREESTATUS_C114)
  {
    Term _path_6 = r0;
    Term _x_3 = r1;
    WL_OPEN
    u32 _o_4 = 0;
    Term _o_5 = 0;
    Term _o_6 = 0;
    Term _o_7 = 0;
    if (term_aux(_x_3) == CID____SRC_GIT_STATUS_WSDONE) {
      _o_4 = 0;
      u64 _sp_3 = term_loc(_x_3);
      Term _f_8 = e.mem[_sp_3 + 0];
      Term _f_9 = e.mem[_sp_3 + 1];
      u32 _f_10 = e.mem[_sp_3 + 2];
      heap_free(e, cls_fit(3), _sp_3);
      _o_5 = _f_8;
      _o_6 = _f_9;
      _o_7 = _f_10;
    } else if (term_aux(_x_3) == CID____SRC_GIT_STATUS_WSFAIL) {
      _o_4 = 1;
      u64 _sp_4 = term_loc(_x_3);
      u32 _f_11 = e.mem[_sp_4 + 0];
      Term _f_12 = e.mem[_sp_4 + 1];
      Term _f_13 = e.mem[_sp_4 + 2];
      heap_free(e, cls_fit(3), _sp_4);
      _o_5 = _f_11;
      _o_6 = _f_12;
      _o_7 = _f_13;
    } else {
      _o_4 = 2;
      u64 _sp_5 = term_loc(_x_3);
      Term _f_14 = e.mem[_sp_5 + 0];
      Term _f_15 = e.mem[_sp_5 + 1];
      heap_free(e, cls_fit(2), _sp_5);
      _o_5 = _f_14;
      _o_6 = _f_15;
    }
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID____SRC_GIT_STATUS_WORKTREESTATUS_K115;
      WL_PUSHN(1);
    } else {
      u64 _t_4 = task_node(e, FID____SRC_GIT_STATUS_WORKTREESTATUS_K115, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_STATUS_WORKTREESTATUS_K115, _t_4);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_STATUS_WS_GO3)) {
      u64 _t_5 = task_node(e, FID____SRC_GIT_STATUS_WS_GO3, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _o_4;
      e.mem[_t_5 + 1] = _o_5;
      e.mem[_t_5 + 2] = _o_6;
      e.mem[_t_5 + 3] = _o_7;
      e.mem[_t_5 + 4] = _path_6;
      return term_tsk(FID____SRC_GIT_STATUS_WS_GO3, _t_5);
    }
    r0 = _o_4;
    r1 = _o_5;
    r2 = _o_6;
    r3 = _o_7;
    r4 = _path_6;
    WL_JMP(FID____SRC_GIT_STATUS_WS_GO3);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WORKTREESTATUS_K115)
  {
    Term _h_4 = r0;
    WL_OPEN
    u64 _nd_4 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_4 + 0] = _h_4;
    r0 = term_clo(FID____SRC_GIT_STATUS_WORKTREESTATUS_C116, _nd_4);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WORKTREESTATUS_C116)
  {
    Term _h_5 = r0;
    Term _x_4 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_9 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_9 + 0] = _h_5;
      e.mem[_t_9 + 1] = term_clo(FID____SRC_GIT_STATUS_WORKTREESTATUS_C117, 0);
      e.mem[_t_9 + 2] = _x_4;
      return term_tsk(FID_IO_BIND, _t_9);
    }
    r0 = _h_5;
    r1 = term_clo(FID____SRC_GIT_STATUS_WORKTREESTATUS_C117, 0);
    r2 = _x_4;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WORKTREESTATUS_C117)
  {
    Term _x_5 = r0;
    WL_OPEN
    u32 _o_8 = 0;
    Term _o_9 = 0;
    Term _o_10 = 0;
    Term _o_11 = 0;
    if (term_aux(_x_5) == CID____SRC_GIT_STATUS_WSDONE) {
      _o_8 = 0;
      u64 _sp_6 = term_loc(_x_5);
      Term _f_16 = e.mem[_sp_6 + 0];
      Term _f_17 = e.mem[_sp_6 + 1];
      u32 _f_18 = e.mem[_sp_6 + 2];
      heap_free(e, cls_fit(3), _sp_6);
      _o_9 = _f_16;
      _o_10 = _f_17;
      _o_11 = _f_18;
    } else if (term_aux(_x_5) == CID____SRC_GIT_STATUS_WSFAIL) {
      _o_8 = 1;
      u64 _sp_7 = term_loc(_x_5);
      u32 _f_19 = e.mem[_sp_7 + 0];
      Term _f_20 = e.mem[_sp_7 + 1];
      Term _f_21 = e.mem[_sp_7 + 2];
      heap_free(e, cls_fit(3), _sp_7);
      _o_9 = _f_19;
      _o_10 = _f_20;
      _o_11 = _f_21;
    } else {
      _o_8 = 2;
      u64 _sp_8 = term_loc(_x_5);
      Term _f_22 = e.mem[_sp_8 + 0];
      Term _f_23 = e.mem[_sp_8 + 1];
      heap_free(e, cls_fit(2), _sp_8);
      _o_9 = _f_22;
      _o_10 = _f_23;
    }
    Term _v_0 = 0;
    Term _o_12[1];
    if (spin_17(e, _o_12, _o_8, _o_9, _o_10, _o_11) == 0) {
      return 0;
    }
    _v_0 = _o_12[0];
    r0 = _v_0;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_ANSWER_C118)
  {
    Term _r_4 = r0;
    Term _r_5 = r1;
    u32 _r_6 = r2;
    Term _x_6 = r3;
    WL_OPEN
    u64 _nd_6 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_6 + 0] = _r_4;
    e.mem[_nd_6 + 1] = _r_5;
    e.mem[_nd_6 + 2] = _r_6;
    u64 _nd_7 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_7 + 0] = term_ctr(CID____SRC_GIT_TYPES_WT, _nd_6);
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_6 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_6 + 0] = term_ctr(CID_DONE, _nd_7);
      e.mem[_t_6 + 1] = _x_6;
      return term_tsk(FID_IO_PURE, _t_6);
    }
    r0 = term_ctr(CID_DONE, _nd_7);
    r1 = _x_6;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_ANSWER_C119)
  {
    u32 _r_7 = r0;
    Term _r_8 = r1;
    Term _r_9 = r2;
    Term _x_7 = r3;
    WL_OPEN
    Term _b_0 = 0;
    if (_r_7 == 0) {
      u64 _nd_9 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_9 + 0] = _r_8;
      _b_0 = term_ctr(CID____SRC_GIT_TYPES_FBRANCHEXISTS, _nd_9);
    } else if (_r_7 == 1) {
      u64 _nd_10 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_10 + 0] = _r_8;
      _b_0 = term_ctr(CID____SRC_GIT_TYPES_FPATHEXISTS, _nd_10);
    } else if (_r_7 == 2) {
      u64 _nd_11 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_11 + 0] = _r_8;
      _b_0 = term_ctr(CID____SRC_GIT_TYPES_FUNKNOWNBASE, _nd_11);
    } else if (_r_7 == 3) {
      u64 _nd_12 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_12 + 0] = _r_8;
      _b_0 = term_ctr(CID____SRC_GIT_TYPES_FTARGETBUSY, _nd_12);
    } else {
      u64 _nd_13 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_13 + 0] = _r_8;
      e.mem[_nd_13 + 1] = _r_9;
      _b_0 = term_ctr(CID____SRC_GIT_TYPES_FCMD, _nd_13);
    }
    u64 _nd_14 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_14 + 0] = _b_0;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_7 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_7 + 0] = term_ctr(CID_FAIL, _nd_14);
      e.mem[_t_7 + 1] = _x_7;
      return term_tsk(FID_IO_PURE, _t_7);
    }
    r0 = term_ctr(CID_FAIL, _nd_14);
    r1 = _x_7;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_STATUS_WS_ANSWER_C120)
  {
    Term _x_8 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_8 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_8 + 0] = term_ctr(CID_FAIL, STAT_OFF + 400);
      e.mem[_t_8 + 1] = _x_8;
      return term_tsk(FID_IO_PURE, _t_8);
    }
    r0 = term_ctr(CID_FAIL, STAT_OFF + 400);
    r1 = _x_8;
    WL_JMP(FID_IO_PURE);
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
  WL_CASE(FID_CHK_STATUS_CLEAN)
  {
    Term _wt_0 = r0;
    Term _base_0 = r1;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _base_0;
      STK(1) = FID_CHK_STATUS_CLEAN_K139;
      WL_PUSHN(2);
    } else {
      u64 _t_0 = task_node(e, FID_CHK_STATUS_CLEAN_K139, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _base_0;
      WL_CONT = term_tsk(FID_CHK_STATUS_CLEAN_K139, _t_0);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_STATUS_WORKTREESTATUS)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_STATUS_WORKTREESTATUS, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _wt_0;
      return term_tsk(FID____SRC_GIT_STATUS_WORKTREESTATUS, _t_1);
    }
    r0 = _wt_0;
    WL_JMP(FID____SRC_GIT_STATUS_WORKTREESTATUS);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_STATUS_CLEAN_K139)
  {
    WL_POPN(1);
    Term _base_1 = STK(0);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_0 + 0] = _base_1;
    e.mem[_nd_0 + 1] = _h_0;
    r0 = term_clo(FID_CHK_STATUS_CLEAN_C140, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_STATUS_CLEAN_C140)
  {
    Term _base_2 = r0;
    Term _h_1 = r1;
    Term _x_0 = r2;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_1 + 0] = _base_2;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_5 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _h_1;
      e.mem[_t_5 + 1] = term_clo(FID_CHK_STATUS_CLEAN_C141, _nd_1);
      e.mem[_t_5 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_5);
    }
    r0 = _h_1;
    r1 = term_clo(FID_CHK_STATUS_CLEAN_C141, _nd_1);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_STATUS_CLEAN_C141)
  {
    Term _base_3 = r0;
    Term _x_1 = r1;
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
      u32 _f_10 = e.mem[_sp_7 + 2];
      heap_free(e, cls_fit(3), _sp_7);
      _o_1 = _f_8;
      _o_2 = _f_9;
      _o_3 = _f_10;
    }
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_CHK_STATUS_CLEAN_K142;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID_CHK_STATUS_CLEAN_K142, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_CHK_STATUS_CLEAN_K142, _t_2);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _o_0;
      e.mem[_t_3 + 1] = _o_1;
      e.mem[_t_3 + 2] = _o_2;
      e.mem[_t_3 + 3] = _o_3;
      e.mem[_t_3 + 4] = _base_3;
      return term_tsk(FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL, _t_3);
    }
    r0 = _o_0;
    r1 = _o_1;
    r2 = _o_2;
    r3 = _o_3;
    r4 = _base_3;
    WL_JMP(FID____SRC_GIT_STATUS_STATUS_CLEAN_FAIL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_STATUS_CLEAN_K142)
  {
    Term _h_2 = r0;
    WL_OPEN
    u64 _nd_2 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_2 + 0] = _h_2;
    r0 = term_clo(FID_CHK_STATUS_CLEAN_C143, _nd_2);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_STATUS_CLEAN_C143)
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_IS_UNKNOWN_BASE_FAIL)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
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
          STK(0) = FID____SRC_GIT_CREATE_WORKTREE_IS_UNKNOWN_BASE_FAIL_K145;
          WL_PUSHN(1);
        } else {
          u64 _t_0 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_IS_UNKNOWN_BASE_FAIL_K145, WL_CONT, WL_IDX, 1);
          WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_IS_UNKNOWN_BASE_FAIL_K145, _t_0);
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
      term_sink(e, _r_1);
      term_sink(e, _r_2);
      term_sink(e, _r_3);
      r0 = term_ctr(CID_SCON, STAT_OFF + 877);
      WL_RETN(1);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_IS_UNKNOWN_BASE_FAIL_K145)
  {
    Term _h_0 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID____SRC_GIT_CREATE_WORKTREE_IS_UNKNOWN_BASE_FAIL_K146;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_IS_UNKNOWN_BASE_FAIL_K146, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_IS_UNKNOWN_BASE_FAIL_K146, _t_2);
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_IS_UNKNOWN_BASE_FAIL_K146)
  {
    Term _h_1 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_4 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = term_ctr(CID_SCON, STAT_OFF + 783);
      e.mem[_t_4 + 1] = _h_1;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_4);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 783);
    r1 = _h_1;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
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
          STK(0) = FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE4_PICK_K151;
          WL_PUSHN(1);
        } else {
          u64 _t_0 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE4_PICK_K151, WL_CONT, WL_IDX, 1);
          WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE4_PICK_K151, _t_0);
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
      r2 = term_ctr(CID_SCON, STAT_OFF + 643);
      r3 = _r_1;
      WL_RETN(4);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE4_PICK_K151)
  {
    Term _h_0 = r0;
    WL_OPEN
    r0 = 1;
    r1 = 4;
    r2 = term_ctr(CID_SCON, STAT_OFF + 643);
    r3 = _h_0;
    WL_RETN(4);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_UNKNOWN_BASE)
  {
    Term _repo_0 = r0;
    Term _wt3_0 = r1;
    Term _base_0 = r2;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_CHK_UNKNOWN_BASE_K173;
      WL_PUSHN(1);
    } else {
      u64 _t_0 = task_node(e, FID_CHK_UNKNOWN_BASE_K173, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_CHK_UNKNOWN_BASE_K173, _t_0);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _repo_0;
      e.mem[_t_1 + 1] = term_ctr(CID_SCON, STAT_OFF + 895);
      e.mem[_t_1 + 2] = _wt3_0;
      e.mem[_t_1 + 3] = term_ctr(CID_SCON, STAT_OFF + 909);
      return term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE, _t_1);
    }
    r0 = _repo_0;
    r1 = term_ctr(CID_SCON, STAT_OFF + 895);
    r2 = _wt3_0;
    r3 = term_ctr(CID_SCON, STAT_OFF + 909);
    WL_JMP(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_UNKNOWN_BASE_K173)
  {
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_0 + 0] = _h_0;
    r0 = term_clo(FID_CHK_UNKNOWN_BASE_C174, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_UNKNOWN_BASE_C174)
  {
    Term _h_1 = r0;
    Term _x_0 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_5 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _h_1;
      e.mem[_t_5 + 1] = term_clo(FID_CHK_UNKNOWN_BASE_C175, 0);
      e.mem[_t_5 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_5);
    }
    r0 = _h_1;
    r1 = term_clo(FID_CHK_UNKNOWN_BASE_C175, 0);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_UNKNOWN_BASE_C175)
  {
    Term _x_1 = r0;
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
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_CHK_UNKNOWN_BASE_K176;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID_CHK_UNKNOWN_BASE_K176, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_CHK_UNKNOWN_BASE_K176, _t_2);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_CREATE_WORKTREE_IS_UNKNOWN_BASE_FAIL)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_IS_UNKNOWN_BASE_FAIL, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _o_0;
      e.mem[_t_3 + 1] = _o_1;
      e.mem[_t_3 + 2] = _o_2;
      e.mem[_t_3 + 3] = _o_3;
      return term_tsk(FID____SRC_GIT_CREATE_WORKTREE_IS_UNKNOWN_BASE_FAIL, _t_3);
    }
    r0 = _o_0;
    r1 = _o_1;
    r2 = _o_2;
    r3 = _o_3;
    WL_JMP(FID____SRC_GIT_CREATE_WORKTREE_IS_UNKNOWN_BASE_FAIL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_UNKNOWN_BASE_K176)
  {
    Term _h_2 = r0;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_1 + 0] = _h_2;
    r0 = term_clo(FID_CHK_UNKNOWN_BASE_C177, _nd_1);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_UNKNOWN_BASE_C177)
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_IS_PATH_EXISTS_FAIL)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
    Term _r_2 = r2;
    Term _r_3 = r3;
    WL_OPEN
    if (_r_0 == 0) {
      if (_r_1 == 1) {
        term_sink(e, _r_2);
        r0 = term_pak(CID_SNIL, 0);
        WL_RETN(1);
      } else {
        if (seq) {
          WL_ROOM(1);
          STK(0) = FID____SRC_GIT_CREATE_WORKTREE_IS_PATH_EXISTS_FAIL_K179;
          WL_PUSHN(1);
        } else {
          u64 _t_0 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_IS_PATH_EXISTS_FAIL_K179, WL_CONT, WL_IDX, 1);
          WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_IS_PATH_EXISTS_FAIL_K179, _t_0);
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
      term_sink(e, _r_1);
      term_sink(e, _r_2);
      term_sink(e, _r_3);
      r0 = term_ctr(CID_SCON, STAT_OFF + 989);
      WL_RETN(1);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_IS_PATH_EXISTS_FAIL_K179)
  {
    Term _h_0 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID____SRC_GIT_CREATE_WORKTREE_IS_PATH_EXISTS_FAIL_K180;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_IS_PATH_EXISTS_FAIL_K180, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_IS_PATH_EXISTS_FAIL_K180, _t_2);
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_IS_PATH_EXISTS_FAIL_K180)
  {
    Term _h_1 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_4 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = term_ctr(CID_SCON, STAT_OFF + 949);
      e.mem[_t_4 + 1] = _h_1;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_4);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 949);
    r1 = _h_1;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
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
        e.mem[_t_0 + 0] = term_ctr(CID_SCON, STAT_OFF + 1015);
        e.mem[_t_0 + 1] = _f_1;
        return term_tsk(FID____SRC_GIT_TYPES_STR_CAT2, _t_0);
      }
      r0 = term_ctr(CID_SCON, STAT_OFF + 1015);
      r1 = _f_1;
      WL_JMP(FID____SRC_GIT_TYPES_STR_CAT2);
    } else if (_f_0 == 1) {
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TYPES_STR_CAT2)) {
        u64 _t_1 = task_node(e, FID____SRC_GIT_TYPES_STR_CAT2, WL_CONT, WL_IDX, 0);
        e.mem[_t_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 1021);
        e.mem[_t_1 + 1] = _f_1;
        return term_tsk(FID____SRC_GIT_TYPES_STR_CAT2, _t_1);
      }
      r0 = term_ctr(CID_SCON, STAT_OFF + 1021);
      r1 = _f_1;
      WL_JMP(FID____SRC_GIT_TYPES_STR_CAT2);
    } else if (_f_0 == 2) {
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TYPES_STR_CAT2)) {
        u64 _t_2 = task_node(e, FID____SRC_GIT_TYPES_STR_CAT2, WL_CONT, WL_IDX, 0);
        e.mem[_t_2 + 0] = term_ctr(CID_SCON, STAT_OFF + 1045);
        e.mem[_t_2 + 1] = _f_1;
        return term_tsk(FID____SRC_GIT_TYPES_STR_CAT2, _t_2);
      }
      r0 = term_ctr(CID_SCON, STAT_OFF + 1045);
      r1 = _f_1;
      WL_JMP(FID____SRC_GIT_TYPES_STR_CAT2);
    } else if (_f_0 == 3) {
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TYPES_STR_CAT2)) {
        u64 _t_3 = task_node(e, FID____SRC_GIT_TYPES_STR_CAT2, WL_CONT, WL_IDX, 0);
        e.mem[_t_3 + 0] = term_ctr(CID_SCON, STAT_OFF + 1067);
        e.mem[_t_3 + 1] = _f_1;
        return term_tsk(FID____SRC_GIT_TYPES_STR_CAT2, _t_3);
      }
      r0 = term_ctr(CID_SCON, STAT_OFF + 1067);
      r1 = _f_1;
      WL_JMP(FID____SRC_GIT_TYPES_STR_CAT2);
    } else {
      Term _b_0 = term_ctr(CID_SCON, STAT_OFF + 336);
      if (seq) {
        WL_ROOM(2);
        STK(0) = _f_1;
        STK(1) = FID____SRC_GIT_TYPES_FAIL_TEXT_K182;
        WL_PUSHN(2);
      } else {
        u64 _t_4 = task_node(e, FID____SRC_GIT_TYPES_FAIL_TEXT_K182, WL_CONT, WL_IDX, 1);
        e.mem[_t_4 + 0] = _f_1;
        WL_CONT = term_tsk(FID____SRC_GIT_TYPES_FAIL_TEXT_K182, _t_4);
        WL_IDX = 1;
      }
      if (!DEVICE && !seq && fid_nofk(FID_STRING_APPEND)) {
        u64 _t_5 = task_node(e, FID_STRING_APPEND, WL_CONT, WL_IDX, 0);
        e.mem[_t_5 + 0] = _b_0;
        e.mem[_t_5 + 1] = _f_2;
        return term_tsk(FID_STRING_APPEND, _t_5);
      }
      r0 = _b_0;
      r1 = _f_2;
      WL_JMP(FID_STRING_APPEND);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TYPES_FAIL_TEXT_K182)
  {
    WL_POPN(1);
    Term _f_3 = STK(0);
    Term _h_0 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_STRING_APPEND)) {
      u64 _t_6 = task_node(e, FID_STRING_APPEND, WL_CONT, WL_IDX, 0);
      e.mem[_t_6 + 0] = _f_3;
      e.mem[_t_6 + 1] = _h_0;
      return term_tsk(FID_STRING_APPEND, _t_6);
    }
    r0 = _f_3;
    r1 = _h_0;
    WL_JMP(FID_STRING_APPEND);
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
          STK(0) = FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_PICK_K202;
          WL_PUSHN(1);
        } else {
          u64 _t_0 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_PICK_K202, WL_CONT, WL_IDX, 1);
          WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_PICK_K202, _t_0);
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
      r2 = term_ctr(CID_SCON, STAT_OFF + 643);
      r3 = _r_1;
      WL_RETN(4);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_PICK_K202)
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
  WL_CASE(FID_U32_SHOW)
  {
    u32 _a_0 = r0;
    WL_OPEN
    u32 _s_0 = U32_BIN(_a_0, ==, 0);
    if (_s_0 == 1) {
      r0 = term_ctr(CID_SCON, STAT_OFF + 879);
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
  WL_CASE(FID_CHK_PATH_EXISTS)
  {
    Term _repo_0 = r0;
    Term _wt_0 = r1;
    Term _base_0 = r2;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_CHK_PATH_EXISTS_K230;
      WL_PUSHN(1);
    } else {
      u64 _t_0 = task_node(e, FID_CHK_PATH_EXISTS_K230, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_CHK_PATH_EXISTS_K230, _t_0);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _repo_0;
      e.mem[_t_1 + 1] = term_ctr(CID_SCON, STAT_OFF + 1291);
      e.mem[_t_1 + 2] = _wt_0;
      e.mem[_t_1 + 3] = _base_0;
      return term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE, _t_1);
    }
    r0 = _repo_0;
    r1 = term_ctr(CID_SCON, STAT_OFF + 1291);
    r2 = _wt_0;
    r3 = _base_0;
    WL_JMP(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_PATH_EXISTS_K230)
  {
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_0 + 0] = _h_0;
    r0 = term_clo(FID_CHK_PATH_EXISTS_C231, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_PATH_EXISTS_C231)
  {
    Term _h_1 = r0;
    Term _x_0 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_5 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _h_1;
      e.mem[_t_5 + 1] = term_clo(FID_CHK_PATH_EXISTS_C232, 0);
      e.mem[_t_5 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_5);
    }
    r0 = _h_1;
    r1 = term_clo(FID_CHK_PATH_EXISTS_C232, 0);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_PATH_EXISTS_C232)
  {
    Term _x_1 = r0;
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
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_CHK_PATH_EXISTS_K233;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID_CHK_PATH_EXISTS_K233, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_CHK_PATH_EXISTS_K233, _t_2);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_CREATE_WORKTREE_IS_PATH_EXISTS_FAIL)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_IS_PATH_EXISTS_FAIL, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _o_0;
      e.mem[_t_3 + 1] = _o_1;
      e.mem[_t_3 + 2] = _o_2;
      e.mem[_t_3 + 3] = _o_3;
      return term_tsk(FID____SRC_GIT_CREATE_WORKTREE_IS_PATH_EXISTS_FAIL, _t_3);
    }
    r0 = _o_0;
    r1 = _o_1;
    r2 = _o_2;
    r3 = _o_3;
    WL_JMP(FID____SRC_GIT_CREATE_WORKTREE_IS_PATH_EXISTS_FAIL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_PATH_EXISTS_K233)
  {
    Term _h_2 = r0;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_1 + 0] = _h_2;
    r0 = term_clo(FID_CHK_PATH_EXISTS_C234, _nd_1);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_PATH_EXISTS_C234)
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_IS_BRANCH_EXISTS_FAIL)
  {
    u32 _r_0 = r0;
    Term _r_1 = r1;
    Term _r_2 = r2;
    Term _r_3 = r3;
    WL_OPEN
    if (_r_0 == 0) {
      if (_r_1 == 0) {
        term_sink(e, _r_2);
        r0 = term_pak(CID_SNIL, 0);
        WL_RETN(1);
      } else {
        if (seq) {
          WL_ROOM(1);
          STK(0) = FID____SRC_GIT_CREATE_WORKTREE_IS_BRANCH_EXISTS_FAIL_K236;
          WL_PUSHN(1);
        } else {
          u64 _t_0 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_IS_BRANCH_EXISTS_FAIL_K236, WL_CONT, WL_IDX, 1);
          WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_IS_BRANCH_EXISTS_FAIL_K236, _t_0);
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
      term_sink(e, _r_1);
      term_sink(e, _r_2);
      term_sink(e, _r_3);
      r0 = term_ctr(CID_SCON, STAT_OFF + 1347);
      WL_RETN(1);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_IS_BRANCH_EXISTS_FAIL_K236)
  {
    Term _h_0 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID____SRC_GIT_CREATE_WORKTREE_IS_BRANCH_EXISTS_FAIL_K237;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_IS_BRANCH_EXISTS_FAIL_K237, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_IS_BRANCH_EXISTS_FAIL_K237, _t_2);
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_IS_BRANCH_EXISTS_FAIL_K237)
  {
    Term _h_1 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_4 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = term_ctr(CID_SCON, STAT_OFF + 1319);
      e.mem[_t_4 + 1] = _h_1;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_4);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 1319);
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
      Term _fb_1[2];
      u64 _sp_1 = ctr_take(e, _a_0, 2, _fb_1);
      u32 _f_2 = _fb_1[0];
      Term _f_3 = _fb_1[1];
      if (term_aux(_b_0) == CID_SCON) {
        Term _fb_2[2];
        u64 _sp_2 = ctr_take(e, _b_0, 2, _fb_2);
        u32 _f_4 = _fb_2[0];
        Term _f_5 = _fb_2[1];
        u32 _v_0 = 0;
        u32 _v_1 = 0;
        Term _o_0[1];
        if (spin_8(e, _o_0, _f_2) == 0) {
          return 0;
        }
        _v_1 = _o_0[0];
        _v_0 = _v_1;
        u32 _v_2 = 0;
        u32 _v_3 = 0;
        Term _o_1[1];
        if (spin_8(e, _o_1, _f_4) == 0) {
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
          STK(1) = FID____SRC_GIT_TEXT_STR_EQ_GO_K239;
          WL_PUSHN(2);
        } else {
          u64 _t_0 = task_node(e, FID____SRC_GIT_TEXT_STR_EQ_GO_K239, WL_CONT, WL_IDX, 1);
          e.mem[_t_0 + 0] = _eq_0;
          WL_CONT = term_tsk(FID____SRC_GIT_TEXT_STR_EQ_GO_K239, _t_0);
          WL_IDX = 1;
        }
        r0 = _f_3;
        r1 = _f_5;
        _a_0 = r0;
        _b_0 = r1;
        WL_AGAIN(FID____SRC_GIT_TEXT_STR_EQ_GO);
      } else {
        term_sink(e, _f_3);
        spare_free(e, cls_fit(2), _sp_1);
        r0 = 0;
        WL_RETN(1);
      }
    }
    WL_SPUN
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_STR_EQ_GO_K239)
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
    if (spin_9(e, _o_2, _eq_1, _b_1, term_pak(CID_FALSE, 0)) == 0) {
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
      r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C246, _nd_0);
      WL_RETN(1);
    } else if (_r_0 == 1) {
      term_sink(e, _repo_0);
      term_sink(e, _branch_0);
      term_sink(e, _path_0);
      u64 _nd_2 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_2 + 0] = _r_1;
      e.mem[_nd_2 + 1] = _r_2;
      e.mem[_nd_2 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C247, _nd_2);
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
      e.mem[_nd_7 + 0] = term_ctr(CID_SCON, STAT_OFF + 1075);
      e.mem[_nd_7 + 1] = term_ctr(CID_CON, _nd_6);
      u64 _nd_8 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_8 + 0] = term_ctr(CID_SCON, STAT_OFF + 1071);
      e.mem[_nd_8 + 1] = term_ctr(CID_CON, _nd_7);
      u64 _nd_9 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_9 + 0] = term_ctr(CID_SCON, STAT_OFF + 629);
      e.mem[_nd_9 + 1] = term_ctr(CID_CON, _nd_8);
      if (seq) {
        WL_ROOM(4);
        STK(0) = _branch_0;
        STK(1) = _path_0;
        STK(2) = _r_1;
        STK(3) = FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K248;
        WL_PUSHN(4);
      } else {
        u64 _t_2 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K248, WL_CONT, WL_IDX, 1);
        e.mem[_t_2 + 0] = _branch_0;
        e.mem[_t_2 + 1] = _path_0;
        e.mem[_t_2 + 2] = _r_1;
        WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K248, _t_2);
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C246)
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C247)
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K248)
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
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C249, _nd_10);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C249)
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
      e.mem[_t_7 + 1] = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C250, _nd_11);
      e.mem[_t_7 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_7);
    }
    r0 = _h_1;
    r1 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C250, _nd_11);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C250)
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
      STK(0) = FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K251;
      WL_PUSHN(1);
    } else {
      u64 _t_4 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K251, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K251, _t_4);
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_K251)
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
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C252, _nd_12);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO4_C252)
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
      r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C254, _nd_0);
      WL_RETN(1);
    } else if (_r_0 == 1) {
      term_sink(e, _repo_0);
      term_sink(e, _path_0);
      u64 _nd_2 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_2 + 0] = _r_1;
      e.mem[_nd_2 + 1] = _r_2;
      e.mem[_nd_2 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C255, _nd_2);
      WL_RETN(1);
    } else {
      _path_0 = term_keep(e, _path_0);
      u64 _nd_4 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_4 + 0] = _path_0;
      e.mem[_nd_4 + 1] = term_pak(CID_NIL, 0);
      u64 _nd_5 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_5 + 0] = term_ctr(CID_SCON, STAT_OFF + 1093);
      e.mem[_nd_5 + 1] = term_ctr(CID_CON, _nd_4);
      u64 _nd_6 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_6 + 0] = term_ctr(CID_SCON, STAT_OFF + 1089);
      e.mem[_nd_6 + 1] = term_ctr(CID_CON, _nd_5);
      u64 _nd_7 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_7 + 0] = term_ctr(CID_SCON, STAT_OFF + 1087);
      e.mem[_nd_7 + 1] = term_ctr(CID_CON, _nd_6);
      if (seq) {
        WL_ROOM(3);
        STK(0) = _r_1;
        STK(1) = _path_0;
        STK(2) = FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_K256;
        WL_PUSHN(3);
      } else {
        u64 _t_2 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_K256, WL_CONT, WL_IDX, 1);
        e.mem[_t_2 + 0] = _r_1;
        e.mem[_t_2 + 1] = _path_0;
        WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_K256, _t_2);
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C254)
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C255)
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_K256)
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
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C257, _nd_8);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C257)
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
      e.mem[_t_5 + 1] = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C258, _nd_9);
      e.mem[_t_5 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_5);
    }
    r0 = _h_1;
    r1 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C258, _nd_9);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C258)
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
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C259, _nd_10);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO3_C259)
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
    if (spin_26(e, _o_8, _o_4, _o_5, _o_6, _o_7, _r_13, _path_4) == 0) {
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
      r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C261, _nd_0);
      WL_RETN(1);
    } else if (_r_0 == 1) {
      term_sink(e, _repo_0);
      term_sink(e, _branch_0);
      u64 _nd_2 = heap_alloc(e, cls_fit(3));
      e.mem[_nd_2 + 0] = _r_1;
      e.mem[_nd_2 + 1] = _r_2;
      e.mem[_nd_2 + 2] = _r_3;
      r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C262, _nd_2);
      WL_RETN(1);
    } else {
      _branch_0 = term_keep(e, _branch_0);
      if (seq) {
        WL_ROOM(4);
        STK(0) = _r_1;
        STK(1) = _repo_0;
        STK(2) = _branch_0;
        STK(3) = FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K263;
        WL_PUSHN(4);
      } else {
        u64 _t_2 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K263, WL_CONT, WL_IDX, 1);
        e.mem[_t_2 + 0] = _r_1;
        e.mem[_t_2 + 1] = _repo_0;
        e.mem[_t_2 + 2] = _branch_0;
        WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K263, _t_2);
        WL_IDX = 3;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
        u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
        e.mem[_t_3 + 0] = term_ctr(CID_SCON, STAT_OFF + 1115);
        e.mem[_t_3 + 1] = _branch_0;
        return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_3);
      }
      r0 = term_ctr(CID_SCON, STAT_OFF + 1115);
      r1 = _branch_0;
      WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C261)
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C262)
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K263)
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
    e.mem[_nd_5 + 0] = term_ctr(CID_SCON, STAT_OFF + 1141);
    e.mem[_nd_5 + 1] = term_ctr(CID_CON, _nd_4);
    u64 _nd_6 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_6 + 0] = term_ctr(CID_SCON, STAT_OFF + 1129);
    e.mem[_nd_6 + 1] = term_ctr(CID_CON, _nd_5);
    u64 _nd_7 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_7 + 0] = term_ctr(CID_SCON, STAT_OFF + 168);
    e.mem[_nd_7 + 1] = term_ctr(CID_CON, _nd_6);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _r_10;
      STK(1) = _branch_1;
      STK(2) = FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K264;
      WL_PUSHN(3);
    } else {
      u64 _t_4 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K264, WL_CONT, WL_IDX, 1);
      e.mem[_t_4 + 0] = _r_10;
      e.mem[_t_4 + 1] = _branch_1;
      WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K264, _t_4);
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_K264)
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
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C265, _nd_8);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C265)
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
      e.mem[_t_7 + 1] = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C266, _nd_9);
      e.mem[_t_7 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_7);
    }
    r0 = _h_2;
    r1 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C266, _nd_9);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C266)
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
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C267, _nd_10);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_GO2_C267)
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
    if (spin_27(e, _o_6, _o_3, _o_4, _o_5, _r_14, _branch_5) == 0) {
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
      STK(2) = FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K269;
      WL_PUSHN(3);
    } else {
      u64 _t_0 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K269, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _repo_0;
      e.mem[_t_0 + 1] = _base_0;
      WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K269, _t_0);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _base_0;
      e.mem[_t_1 + 1] = term_ctr(CID_SCON, STAT_OFF + 1368);
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_1);
    }
    r0 = _base_0;
    r1 = term_ctr(CID_SCON, STAT_OFF + 1368);
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K269)
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
    e.mem[_nd_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 1141);
    e.mem[_nd_1 + 1] = term_ctr(CID_CON, _nd_0);
    u64 _nd_2 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_2 + 0] = term_ctr(CID_SCON, STAT_OFF + 1129);
    e.mem[_nd_2 + 1] = term_ctr(CID_CON, _nd_1);
    u64 _nd_3 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_3 + 0] = term_ctr(CID_SCON, STAT_OFF + 168);
    e.mem[_nd_3 + 1] = term_ctr(CID_CON, _nd_2);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _base_1;
      STK(1) = FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K270;
      WL_PUSHN(2);
    } else {
      u64 _t_2 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K270, WL_CONT, WL_IDX, 1);
      e.mem[_t_2 + 0] = _base_1;
      WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K270, _t_2);
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K270)
  {
    WL_POPN(1);
    Term _base_2 = STK(0);
    Term _h_1 = r0;
    WL_OPEN
    u64 _nd_4 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_4 + 0] = _base_2;
    e.mem[_nd_4 + 1] = _h_1;
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C271, _nd_4);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C271)
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
      e.mem[_t_7 + 1] = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C272, _nd_5);
      e.mem[_t_7 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_7);
    }
    r0 = _h_2;
    r1 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C272, _nd_5);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C272)
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
      STK(0) = FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K273;
      WL_PUSHN(1);
    } else {
      u64 _t_4 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K273, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K273, _t_4);
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_K273)
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
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C274, _nd_6);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_STAGE1_C274)
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
      if (spin_35(e, _o_1, _f_0) == 0) {
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
        STK(3) = FID____SRC_GIT_TEXT_ENC_ARGV_GO_K280;
        WL_PUSHN(4);
      } else {
        u64 _t_0 = task_node(e, FID____SRC_GIT_TEXT_ENC_ARGV_GO_K280, WL_CONT, WL_IDX, 1);
        e.mem[_t_0 + 0] = _f_1;
        e.mem[_t_0 + 1] = _f_0;
        e.mem[_t_0 + 2] = _acc_0;
        WL_CONT = term_tsk(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K280, _t_0);
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
  WL_CASE(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K280)
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
      STK(3) = FID____SRC_GIT_TEXT_ENC_ARGV_GO_K281;
      WL_PUSHN(4);
    } else {
      u64 _t_2 = task_node(e, FID____SRC_GIT_TEXT_ENC_ARGV_GO_K281, WL_CONT, WL_IDX, 1);
      e.mem[_t_2 + 0] = _f_2;
      e.mem[_t_2 + 1] = _acc_1;
      e.mem[_t_2 + 2] = _h_0;
      WL_CONT = term_tsk(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K281, _t_2);
      WL_IDX = 3;
    }
    if (!DEVICE && !seq && fid_nofk(FID_STRING_APPEND)) {
      u64 _t_3 = task_node(e, FID_STRING_APPEND, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = term_ctr(CID_SCON, STAT_OFF + 1370);
      e.mem[_t_3 + 1] = _f_3;
      return term_tsk(FID_STRING_APPEND, _t_3);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 1370);
    r1 = _f_3;
    WL_JMP(FID_STRING_APPEND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K281)
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
      STK(2) = FID____SRC_GIT_TEXT_ENC_ARGV_GO_K282;
      WL_PUSHN(3);
    } else {
      u64 _t_4 = task_node(e, FID____SRC_GIT_TEXT_ENC_ARGV_GO_K282, WL_CONT, WL_IDX, 1);
      e.mem[_t_4 + 0] = _f_4;
      e.mem[_t_4 + 1] = _acc_2;
      WL_CONT = term_tsk(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K282, _t_4);
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
  WL_CASE(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K282)
  {
    WL_POPN(2);
    Term _f_5 = STK(0);
    Term _acc_3 = STK(1);
    Term _h_3 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _f_5;
      STK(1) = FID____SRC_GIT_TEXT_ENC_ARGV_GO_K283;
      WL_PUSHN(2);
    } else {
      u64 _t_6 = task_node(e, FID____SRC_GIT_TEXT_ENC_ARGV_GO_K283, WL_CONT, WL_IDX, 1);
      e.mem[_t_6 + 0] = _f_5;
      WL_CONT = term_tsk(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K283, _t_6);
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
  WL_CASE(FID____SRC_GIT_TEXT_ENC_ARGV_GO_K283)
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
        STK(3) = FID____SRC_GIT_TEXT_JOIN_GO_K288;
        WL_PUSHN(4);
      } else {
        u64 _t_0 = task_node(e, FID____SRC_GIT_TEXT_JOIN_GO_K288, WL_CONT, WL_IDX, 1);
        e.mem[_t_0 + 0] = _f_1;
        e.mem[_t_0 + 1] = _s_0;
        e.mem[_t_0 + 2] = _sep_0;
        WL_CONT = term_tsk(FID____SRC_GIT_TEXT_JOIN_GO_K288, _t_0);
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
  WL_CASE(FID____SRC_GIT_TEXT_JOIN_GO_K288)
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
      STK(2) = FID____SRC_GIT_TEXT_JOIN_GO_K289;
      WL_PUSHN(3);
    } else {
      u64 _t_2 = task_node(e, FID____SRC_GIT_TEXT_JOIN_GO_K289, WL_CONT, WL_IDX, 1);
      e.mem[_t_2 + 0] = _f_2;
      e.mem[_t_2 + 1] = _sep_1;
      WL_CONT = term_tsk(FID____SRC_GIT_TEXT_JOIN_GO_K289, _t_2);
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
  WL_CASE(FID____SRC_GIT_TEXT_JOIN_GO_K289)
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
  WL_CASE(FID_CHK_BRANCH_EXISTS)
  {
    Term _repo_0 = r0;
    Term _wt_0 = r1;
    Term _base_0 = r2;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_CHK_BRANCH_EXISTS_K310;
      WL_PUSHN(1);
    } else {
      u64 _t_0 = task_node(e, FID_CHK_BRANCH_EXISTS_K310, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_CHK_BRANCH_EXISTS_K310, _t_0);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _repo_0;
      e.mem[_t_1 + 1] = term_ctr(CID_SCON, STAT_OFF + 1386);
      e.mem[_t_1 + 2] = _wt_0;
      e.mem[_t_1 + 3] = _base_0;
      return term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE, _t_1);
    }
    r0 = _repo_0;
    r1 = term_ctr(CID_SCON, STAT_OFF + 1386);
    r2 = _wt_0;
    r3 = _base_0;
    WL_JMP(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_BRANCH_EXISTS_K310)
  {
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_0 + 0] = _h_0;
    r0 = term_clo(FID_CHK_BRANCH_EXISTS_C311, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_BRANCH_EXISTS_C311)
  {
    Term _h_1 = r0;
    Term _x_0 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_5 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _h_1;
      e.mem[_t_5 + 1] = term_clo(FID_CHK_BRANCH_EXISTS_C312, 0);
      e.mem[_t_5 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_5);
    }
    r0 = _h_1;
    r1 = term_clo(FID_CHK_BRANCH_EXISTS_C312, 0);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_BRANCH_EXISTS_C312)
  {
    Term _x_1 = r0;
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
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_CHK_BRANCH_EXISTS_K313;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID_CHK_BRANCH_EXISTS_K313, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_CHK_BRANCH_EXISTS_K313, _t_2);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_CREATE_WORKTREE_IS_BRANCH_EXISTS_FAIL)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_IS_BRANCH_EXISTS_FAIL, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _o_0;
      e.mem[_t_3 + 1] = _o_1;
      e.mem[_t_3 + 2] = _o_2;
      e.mem[_t_3 + 3] = _o_3;
      return term_tsk(FID____SRC_GIT_CREATE_WORKTREE_IS_BRANCH_EXISTS_FAIL, _t_3);
    }
    r0 = _o_0;
    r1 = _o_1;
    r2 = _o_2;
    r3 = _o_3;
    WL_JMP(FID____SRC_GIT_CREATE_WORKTREE_IS_BRANCH_EXISTS_FAIL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_BRANCH_EXISTS_K313)
  {
    Term _h_2 = r0;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_1 + 0] = _h_2;
    r0 = term_clo(FID_CHK_BRANCH_EXISTS_C314, _nd_1);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_BRANCH_EXISTS_C314)
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
      STK(3) = FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K320;
      WL_PUSHN(4);
    } else {
      u64 _t_0 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K320, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _repo_0;
      e.mem[_t_0 + 1] = _branch_0;
      e.mem[_t_0 + 2] = _path_0;
      WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K320, _t_0);
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K320)
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
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C321, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C321)
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
      e.mem[_t_14 + 1] = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C322, _nd_1);
      e.mem[_t_14 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_14);
    }
    r0 = _h_1;
    r1 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C322, _nd_1);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C322)
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
      STK(3) = FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K323;
      WL_PUSHN(4);
    } else {
      u64 _t_2 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K323, WL_CONT, WL_IDX, 1);
      e.mem[_t_2 + 0] = _repo_3;
      e.mem[_t_2 + 1] = _branch_3;
      e.mem[_t_2 + 2] = _path_3;
      WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K323, _t_2);
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K323)
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
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C324, _nd_2);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C324)
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
      e.mem[_t_13 + 1] = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C325, _nd_3);
      e.mem[_t_13 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_13);
    }
    r0 = _h_3;
    r1 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C325, _nd_3);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C325)
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
      STK(3) = FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K326;
      WL_PUSHN(4);
    } else {
      u64 _t_4 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K326, WL_CONT, WL_IDX, 1);
      e.mem[_t_4 + 0] = _repo_6;
      e.mem[_t_4 + 1] = _branch_6;
      e.mem[_t_4 + 2] = _path_6;
      WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K326, _t_4);
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K326)
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
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C327, _nd_4);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C327)
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
      e.mem[_t_12 + 1] = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C328, _nd_5);
      e.mem[_t_12 + 2] = _x_4;
      return term_tsk(FID_IO_BIND, _t_12);
    }
    r0 = _h_5;
    r1 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C328, _nd_5);
    r2 = _x_4;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C328)
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
      STK(0) = FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K329;
      WL_PUSHN(1);
    } else {
      u64 _t_6 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K329, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K329, _t_6);
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_K329)
  {
    Term _h_6 = r0;
    WL_OPEN
    u64 _nd_6 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_6 + 0] = _h_6;
    r0 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C330, _nd_6);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C330)
  {
    Term _h_7 = r0;
    Term _x_6 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_11 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_11 + 0] = _h_7;
      e.mem[_t_11 + 1] = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C331, 0);
      e.mem[_t_11 + 2] = _x_6;
      return term_tsk(FID_IO_BIND, _t_11);
    }
    r0 = _h_7;
    r1 = term_clo(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C331, 0);
    r2 = _x_6;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE_C331)
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
    if (spin_36(e, _o_16, _o_12, _o_13, _o_14, _o_15) == 0) {
      return 0;
    }
    _v_0 = _o_16[0];
    r0 = _v_0;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C332)
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C333)
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
  WL_CASE(FID____SRC_GIT_CREATE_WORKTREE_CW_ANSWER_C334)
  {
    Term _x_10 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_10 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_10 + 0] = term_ctr(CID_FAIL, STAT_OFF + 1351);
      e.mem[_t_10 + 1] = _x_10;
      return term_tsk(FID_IO_PURE, _t_10);
    }
    r0 = term_ctr(CID_FAIL, STAT_OFF + 1351);
    r1 = _x_10;
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
        STK(1) = FID_STRING_APPEND_K336;
        WL_PUSHN(2);
      } else {
        u64 _t_0 = task_node(e, FID_STRING_APPEND_K336, WL_CONT, WL_IDX, 1);
        e.mem[_t_0 + 0] = _f_0;
        WL_CONT = term_tsk(FID_STRING_APPEND_K336, _t_0);
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
  WL_CASE(FID_STRING_APPEND_K336)
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
      if (spin_29(e, _o_0, _r_1) == 0) {
        return 0;
      }
      _v_1 = _o_0[0];
      _v_0 = _v_1;
      if (term_aux(_v_0) == CID_NIL) {
        term_sink(e, _r_1);
        r0 = 1;
        r1 = term_ctr(CID_SCON, STAT_OFF + 1189);
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
          STK(1) = FID____SRC_GIT_TEXT_RUN_RES_K339;
          WL_PUSHN(2);
        } else {
          u64 _t_0 = task_node(e, FID____SRC_GIT_TEXT_RUN_RES_K339, WL_CONT, WL_IDX, 1);
          e.mem[_t_0 + 0] = _f_0;
          WL_CONT = term_tsk(FID____SRC_GIT_TEXT_RUN_RES_K339, _t_0);
          WL_IDX = 1;
        }
        if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_JOIN)) {
          u64 _t_1 = task_node(e, FID____SRC_GIT_TEXT_JOIN, WL_CONT, WL_IDX, 0);
          e.mem[_t_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 190);
          e.mem[_t_1 + 1] = _f_1;
          return term_tsk(FID____SRC_GIT_TEXT_JOIN, _t_1);
        }
        r0 = term_ctr(CID_SCON, STAT_OFF + 190);
        r1 = _f_1;
        WL_JMP(FID____SRC_GIT_TEXT_JOIN);
      }
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_RUN_RES_K339)
  {
    WL_POPN(1);
    Term _f_2 = STK(0);
    Term _h_0 = r0;
    WL_OPEN
    Term _v_2 = 0;
    Term _v_3 = 0;
    Term _o_1[1];
    if (spin_24(e, _o_1, _f_2) == 0) {
      return 0;
    }
    _v_3 = _o_1[0];
    _v_2 = _v_3;
    if (term_aux(_v_2) == CID_NIL) {
      term_sink(e, _h_0);
      r0 = 1;
      r1 = term_ctr(CID_SCON, STAT_OFF + 467);
      r2 = 0;
      r3 = 0;
      WL_RETN(4);
    } else {
      Term _fb_1[2];
      u64 _sp_1 = ctr_take(e, _v_2, 2, _fb_1);
      Term _f_3 = _fb_1[0];
      Term _f_4 = _fb_1[1];
      if (term_aux(_f_4) == CID_NIL) {
        term_sink(e, _f_3);
        term_sink(e, _h_0);
        spare_free(e, cls_fit(2), _sp_1);
        r0 = 1;
        r1 = term_ctr(CID_SCON, STAT_OFF + 467);
        r2 = 0;
        r3 = 0;
        WL_RETN(4);
      } else {
        Term _fb_2[2];
        u64 _sp_2 = ctr_take(e, _f_4, 2, _fb_2);
        Term _f_5 = _fb_2[0];
        Term _f_6 = _fb_2[1];
        if (term_aux(_f_6) == CID_NIL) {
          _f_3 = term_keep(e, _f_3);
          spare_free(e, cls_fit(2), _sp_2);
          spare_free(e, cls_fit(2), _sp_1);
          if (seq) {
            WL_ROOM(4);
            STK(0) = _f_5;
            STK(1) = _h_0;
            STK(2) = _f_3;
            STK(3) = FID____SRC_GIT_TEXT_RUN_RES_K340;
            WL_PUSHN(4);
          } else {
            u64 _t_2 = task_node(e, FID____SRC_GIT_TEXT_RUN_RES_K340, WL_CONT, WL_IDX, 1);
            e.mem[_t_2 + 0] = _f_5;
            e.mem[_t_2 + 1] = _h_0;
            e.mem[_t_2 + 2] = _f_3;
            WL_CONT = term_tsk(FID____SRC_GIT_TEXT_RUN_RES_K340, _t_2);
            WL_IDX = 3;
          }
          if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_EQ)) {
            u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_STR_EQ, WL_CONT, WL_IDX, 0);
            e.mem[_t_3 + 0] = _f_3;
            e.mem[_t_3 + 1] = term_ctr(CID_SCON, STAT_OFF + 188);
            return term_tsk(FID____SRC_GIT_TEXT_STR_EQ, _t_3);
          }
          r0 = _f_3;
          r1 = term_ctr(CID_SCON, STAT_OFF + 188);
          WL_JMP(FID____SRC_GIT_TEXT_STR_EQ);
        } else {
          term_sink(e, _f_3);
          term_sink(e, _f_5);
          Term _fb_3[2];
          u64 _sp_3 = ctr_take(e, _f_6, 2, _fb_3);
          Term _f_10 = _fb_3[0];
          Term _f_11 = _fb_3[1];
          term_sink(e, _f_10);
          term_sink(e, _f_11);
          term_sink(e, _h_0);
          spare_free(e, cls_fit(2), _sp_3);
          spare_free(e, cls_fit(2), _sp_2);
          spare_free(e, cls_fit(2), _sp_1);
          r0 = 1;
          r1 = term_ctr(CID_SCON, STAT_OFF + 467);
          r2 = 0;
          r3 = 0;
          WL_RETN(4);
        }
      }
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_RUN_RES_K340)
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
        WL_ROOM(3);
        STK(0) = _f_7;
        STK(1) = _h_1;
        STK(2) = FID____SRC_GIT_TEXT_RUN_RES_K341;
        WL_PUSHN(3);
      } else {
        u64 _t_5 = task_node(e, FID____SRC_GIT_TEXT_RUN_RES_K341, WL_CONT, WL_IDX, 1);
        e.mem[_t_5 + 0] = _f_7;
        e.mem[_t_5 + 1] = _h_1;
        WL_CONT = term_tsk(FID____SRC_GIT_TEXT_RUN_RES_K341, _t_5);
        WL_IDX = 2;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_EQ)) {
        u64 _t_6 = task_node(e, FID____SRC_GIT_TEXT_STR_EQ, WL_CONT, WL_IDX, 0);
        e.mem[_t_6 + 0] = _f_8;
        e.mem[_t_6 + 1] = term_ctr(CID_SCON, STAT_OFF + 126);
        return term_tsk(FID____SRC_GIT_TEXT_STR_EQ, _t_6);
      }
      r0 = _f_8;
      r1 = term_ctr(CID_SCON, STAT_OFF + 126);
      WL_JMP(FID____SRC_GIT_TEXT_STR_EQ);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_TEXT_RUN_RES_K341)
  {
    WL_POPN(2);
    Term _f_9 = STK(0);
    Term _h_3 = STK(1);
    u32 _h_4 = r0;
    WL_OPEN
    if (_h_4 == 1) {
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_RUN_RES_NUM)) {
        u64 _t_7 = task_node(e, FID____SRC_GIT_TEXT_RUN_RES_NUM, WL_CONT, WL_IDX, 0);
        e.mem[_t_7 + 0] = _f_9;
        e.mem[_t_7 + 1] = _h_3;
        e.mem[_t_7 + 2] = 1;
        return term_tsk(FID____SRC_GIT_TEXT_RUN_RES_NUM, _t_7);
      }
      r0 = _f_9;
      r1 = _h_3;
      r2 = 1;
      WL_JMP(FID____SRC_GIT_TEXT_RUN_RES_NUM);
    } else {
      term_sink(e, _f_9);
      term_sink(e, _h_3);
      r0 = 1;
      r1 = term_ctr(CID_SCON, STAT_OFF + 114);
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
  WL_CASE(FID_CHK_CREATE_OK)
  {
    Term _repo_0 = r0;
    Term _wt_0 = r1;
    Term _base_0 = r2;
    WL_OPEN
    _base_0 = term_keep(e, _base_0);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _base_0;
      STK(1) = FID_CHK_CREATE_OK_K370;
      WL_PUSHN(2);
    } else {
      u64 _t_0 = task_node(e, FID_CHK_CREATE_OK_K370, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _base_0;
      WL_CONT = term_tsk(FID_CHK_CREATE_OK_K370, _t_0);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = _repo_0;
      e.mem[_t_1 + 1] = term_ctr(CID_SCON, STAT_OFF + 1386);
      e.mem[_t_1 + 2] = _wt_0;
      e.mem[_t_1 + 3] = _base_0;
      return term_tsk(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE, _t_1);
    }
    r0 = _repo_0;
    r1 = term_ctr(CID_SCON, STAT_OFF + 1386);
    r2 = _wt_0;
    r3 = _base_0;
    WL_JMP(FID____SRC_GIT_CREATE_WORKTREE_CREATEWORKTREE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_CREATE_OK_K370)
  {
    WL_POPN(1);
    Term _base_1 = STK(0);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_0 + 0] = _base_1;
    e.mem[_nd_0 + 1] = _h_0;
    r0 = term_clo(FID_CHK_CREATE_OK_C371, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_CREATE_OK_C371)
  {
    Term _base_2 = r0;
    Term _h_1 = r1;
    Term _x_0 = r2;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_1 + 0] = _base_2;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_5 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = _h_1;
      e.mem[_t_5 + 1] = term_clo(FID_CHK_CREATE_OK_C372, _nd_1);
      e.mem[_t_5 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_5);
    }
    r0 = _h_1;
    r1 = term_clo(FID_CHK_CREATE_OK_C372, _nd_1);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_CREATE_OK_C372)
  {
    Term _base_3 = r0;
    Term _x_1 = r1;
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
    Term _v_0 = 0;
    Term _v_1 = 0;
    Term _v_2 = 0;
    Term _v_3 = 0;
    Term _v_4 = 0;
    Term _v_5 = 0;
    Term _v_6 = 0;
    Term _o_7[3];
    if (spin_37(e, _o_7, _o_0, _o_1, _o_2, _o_3) == 0) {
      return 0;
    }
    _v_4 = _o_7[0];
    _v_5 = _o_7[1];
    _v_6 = _o_7[2];
    _v_1 = _v_4;
    _v_2 = _v_5;
    _v_3 = _v_6;
    Term _v_10 = 0;
    Term _o_8[1];
    if (spin_38(e, _o_8, _v_1, _v_2, _v_3) == 0) {
      return 0;
    }
    _v_10 = _o_8[0];
    _v_0 = _v_10;
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_CHK_CREATE_OK_K373;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID_CHK_CREATE_OK_K373, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_CHK_CREATE_OK_K373, _t_2);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_EQ)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_STR_EQ, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _v_0;
      e.mem[_t_3 + 1] = _base_3;
      return term_tsk(FID____SRC_GIT_TEXT_STR_EQ, _t_3);
    }
    r0 = _v_0;
    r1 = _base_3;
    WL_JMP(FID____SRC_GIT_TEXT_STR_EQ);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_CREATE_OK_K373)
  {
    u32 _h_2 = r0;
    WL_OPEN
    u64 _nd_2 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_2 + 0] = _h_2;
    r0 = term_clo(FID_CHK_CREATE_OK_C374, _nd_2);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_CHK_CREATE_OK_C374)
  {
    u32 _h_3 = r0;
    Term _x_2 = r1;
    WL_OPEN
    Term _v_12 = 0;
    Term _v_13 = 0;
    Term _o_10[1];
    if (spin_39(e, _o_10, _h_3, term_ctr(CID_SCON, STAT_OFF + 1438)) == 0) {
      return 0;
    }
    _v_13 = _o_10[0];
    _v_12 = _v_13;
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_4 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = _v_12;
      e.mem[_t_4 + 1] = _x_2;
      return term_tsk(FID_IO_PURE, _t_4);
    }
    r0 = _v_12;
    r1 = _x_2;
    WL_JMP(FID_IO_PURE);
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
  WL_CASE(FID____SRC_GIT_PROCESS_RUNGIT)
  {
    Term _dir_0 = r0;
    Term _args_0 = r1;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_0 + 0] = _dir_0;
    e.mem[_nd_0 + 1] = _args_0;
    u64 _nd_1 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 1444);
    e.mem[_nd_1 + 1] = term_ctr(CID_CON, _nd_0);
    u64 _nd_2 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_2 + 0] = term_ctr(CID_SCON, STAT_OFF + 1440);
    e.mem[_nd_2 + 1] = term_ctr(CID_CON, _nd_1);
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID____SRC_GIT_PROCESS_RUNGIT_K379;
      WL_PUSHN(1);
    } else {
      u64 _t_0 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT_K379, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_PROCESS_RUNGIT_K379, _t_0);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = term_ctr(CID_CON, _nd_2);
      e.mem[_t_1 + 1] = term_ctr(CID_SCON, STAT_OFF + 503);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_1);
    }
    r0 = term_ctr(CID_CON, _nd_2);
    r1 = term_ctr(CID_SCON, STAT_OFF + 503);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_PROCESS_RUNGIT_K379)
  {
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_3 + 0] = _h_0;
    r0 = term_clo(FID____SRC_GIT_PROCESS_RUNGIT_C380, _nd_3);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_PROCESS_RUNGIT_C380)
  {
    Term _h_1 = r0;
    Term _x_0 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_3 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _h_1;
      e.mem[_t_3 + 1] = term_clo(FID____SRC_GIT_PROCESS_RUNGIT_C381, 0);
      e.mem[_t_3 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_3);
    }
    r0 = _h_1;
    r1 = term_clo(FID____SRC_GIT_PROCESS_RUNGIT_C381, 0);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_PROCESS_RUNGIT_C381)
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
    r0 = term_clo(FID____SRC_GIT_PROCESS_RUNGIT_C382, _nd_4);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_PROCESS_RUNGIT_C382)
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
    if (spin_40(e, _o_8, _o_4, _o_5, _o_6, _o_7) == 0) {
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
  WL_CASE(FID_GIT_SEQ)
  {
    Term _cmds_0 = r0;
    Term _repo_cmd_0 = r1;
    Term _repo_seq_0 = r2;
    WL_OPEN
    if (term_aux(_cmds_0) == CID_NIL) {
      term_sink(e, _repo_cmd_0);
      term_sink(e, _repo_seq_0);
      r0 = term_clo(FID_GIT_SEQ_C384, 0);
      WL_RETN(1);
    } else {
      Term _fb_0[2];
      u64 _sp_0 = ctr_take(e, _cmds_0, 2, _fb_0);
      Term _f_0 = _fb_0[0];
      Term _f_1 = _fb_0[1];
      _repo_cmd_0 = term_keep(e, _repo_cmd_0);
      u64 _nd_0 = _sp_0 >= HEAP_OFF ? _sp_0 : heap_alloc(e, cls_fit(2));
      e.mem[_nd_0 + 0] = _repo_cmd_0;
      e.mem[_nd_0 + 1] = _f_0;
      u64 _nd_1 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 1444);
      e.mem[_nd_1 + 1] = term_ctr(CID_CON, _nd_0);
      u64 _nd_2 = heap_alloc(e, cls_fit(2));
      e.mem[_nd_2 + 0] = term_ctr(CID_SCON, STAT_OFF + 1440);
      e.mem[_nd_2 + 1] = term_ctr(CID_CON, _nd_1);
      if (seq) {
        WL_ROOM(4);
        STK(0) = _f_1;
        STK(1) = _repo_cmd_0;
        STK(2) = _repo_seq_0;
        STK(3) = FID_GIT_SEQ_K385;
        WL_PUSHN(4);
      } else {
        u64 _t_1 = task_node(e, FID_GIT_SEQ_K385, WL_CONT, WL_IDX, 1);
        e.mem[_t_1 + 0] = _f_1;
        e.mem[_t_1 + 1] = _repo_cmd_0;
        e.mem[_t_1 + 2] = _repo_seq_0;
        WL_CONT = term_tsk(FID_GIT_SEQ_K385, _t_1);
        WL_IDX = 3;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
        u64 _t_2 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
        e.mem[_t_2 + 0] = term_ctr(CID_CON, _nd_2);
        e.mem[_t_2 + 1] = term_ctr(CID_SCON, STAT_OFF + 503);
        return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_2);
      }
      r0 = term_ctr(CID_CON, _nd_2);
      r1 = term_ctr(CID_SCON, STAT_OFF + 503);
      WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID_GIT_SEQ_C384)
  {
    Term _x_0 = r0;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_0 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = term_ctr(CID____SRC_GIT_TYPES_RRUN, STAT_OFF + 1446);
      e.mem[_t_0 + 1] = _x_0;
      return term_tsk(FID_IO_PURE, _t_0);
    }
    r0 = term_ctr(CID____SRC_GIT_TYPES_RRUN, STAT_OFF + 1446);
    r1 = _x_0;
    WL_JMP(FID_IO_PURE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_GIT_SEQ_K385)
  {
    WL_POPN(3);
    Term _f_2 = STK(0);
    Term _repo_cmd_1 = STK(1);
    Term _repo_seq_1 = STK(2);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(4));
    e.mem[_nd_3 + 0] = _f_2;
    e.mem[_nd_3 + 1] = _repo_cmd_1;
    e.mem[_nd_3 + 2] = _repo_seq_1;
    e.mem[_nd_3 + 3] = _h_0;
    r0 = term_clo(FID_GIT_SEQ_C386, _nd_3);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_GIT_SEQ_C386)
  {
    Term _f_3 = r0;
    Term _repo_cmd_2 = r1;
    Term _repo_seq_2 = r2;
    Term _h_1 = r3;
    Term _x_1 = r4;
    WL_OPEN
    u64 _nd_4 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_4 + 0] = _f_3;
    e.mem[_nd_4 + 1] = _repo_cmd_2;
    e.mem[_nd_4 + 2] = _repo_seq_2;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_4 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = _h_1;
      e.mem[_t_4 + 1] = term_clo(FID_GIT_SEQ_C387, _nd_4);
      e.mem[_t_4 + 2] = _x_1;
      return term_tsk(FID_IO_BIND, _t_4);
    }
    r0 = _h_1;
    r1 = term_clo(FID_GIT_SEQ_C387, _nd_4);
    r2 = _x_1;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_GIT_SEQ_C387)
  {
    Term _f_4 = r0;
    Term _repo_cmd_3 = r1;
    Term _repo_seq_3 = r2;
    Term _x_2 = r3;
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
      e.mem[_t_3 + 1] = _repo_cmd_3;
      e.mem[_t_3 + 2] = _repo_seq_3;
      return term_tsk(FID_GIT_SEQ, _t_3);
    }
    r0 = _f_4;
    r1 = _repo_cmd_3;
    r2 = _repo_seq_3;
    WL_JMP(FID_GIT_SEQ);
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
      STK(1) = FID____SRC_GIT_PROCESS_RUNFULL_K389;
      WL_PUSHN(2);
    } else {
      u64 _t_0 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL_K389, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _cwd_0;
      WL_CONT = term_tsk(FID____SRC_GIT_PROCESS_RUNFULL_K389, _t_0);
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
  WL_CASE(FID____SRC_GIT_PROCESS_RUNFULL_K389)
  {
    WL_POPN(1);
    Term _cwd_1 = STK(0);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_0 + 0] = _cwd_1;
    e.mem[_nd_0 + 1] = _h_0;
    r0 = term_clo(FID____SRC_GIT_PROCESS_RUNFULL_C390, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_PROCESS_RUNFULL_C390)
  {
    Term _cwd_2 = r0;
    Term _h_1 = r1;
    Term _x_0 = r2;
    WL_OPEN
    Term _v_0 = 0;
    Term _v_1 = 0;
    Term _v_2 = 0;
    Term _o_0[1];
    if (spin_6(e, _o_0, _h_1) == 0) {
      return 0;
    }
    _v_2 = _o_0[0];
    _v_1 = _v_2;
    Term _v_3 = 0;
    Term _o_1[1];
    if (spin_6(e, _o_1, _v_1) == 0) {
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
      e.mem[_t_5 + 1] = term_clo(FID____SRC_GIT_PROCESS_RUNFULL_C391, 0);
      e.mem[_t_5 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_5);
    }
    r0 = term_clo(FID_PROCESS_RUN, _nd_1);
    r1 = term_clo(FID____SRC_GIT_PROCESS_RUNFULL_C391, 0);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_PROCESS_RUNFULL_C391)
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
      STK(0) = FID____SRC_GIT_PROCESS_RUNFULL_K392;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL_K392, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID____SRC_GIT_PROCESS_RUNFULL_K392, _t_2);
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
  WL_CASE(FID____SRC_GIT_PROCESS_RUNFULL_K392)
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
    r0 = term_clo(FID____SRC_GIT_PROCESS_RUNFULL_C393, _nd_2);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID____SRC_GIT_PROCESS_RUNFULL_C393)
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
  WL_CASE(FID____SRC_GIT_TEXT_TRIM_NL)
  {
    Term _s_0 = r0;
    WL_OPEN
    Term _v_0 = 0;
    Term _v_1 = 0;
    Term _o_0[1];
    if (spin_29(e, _o_0, _s_0) == 0) {
      return 0;
    }
    _v_1 = _o_0[0];
    _v_0 = _v_1;
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_JOIN)) {
      u64 _t_0 = task_node(e, FID____SRC_GIT_TEXT_JOIN, WL_CONT, WL_IDX, 0);
      e.mem[_t_0 + 0] = term_ctr(CID_SCON, STAT_OFF + 190);
      e.mem[_t_0 + 1] = _v_0;
      return term_tsk(FID____SRC_GIT_TEXT_JOIN, _t_0);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 190);
    r1 = _v_0;
    WL_JMP(FID____SRC_GIT_TEXT_JOIN);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP)
  {
    Term _repo_0 = r0;
    WL_OPEN
    _repo_0 = term_keep(e, _repo_0);
    u64 _nd_0 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_0 + 0] = _repo_0;
    e.mem[_nd_0 + 1] = term_pak(CID_NIL, 0);
    u64 _nd_1 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 1475);
    e.mem[_nd_1 + 1] = term_ctr(CID_CON, _nd_0);
    u64 _nd_2 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_2 + 0] = term_ctr(CID_SCON, STAT_OFF + 1471);
    e.mem[_nd_2 + 1] = term_ctr(CID_CON, _nd_1);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _repo_0;
      STK(1) = FID_SETUP_K426;
      WL_PUSHN(2);
    } else {
      u64 _t_0 = task_node(e, FID_SETUP_K426, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _repo_0;
      WL_CONT = term_tsk(FID_SETUP_K426, _t_0);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
      u64 _t_1 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = term_ctr(CID_CON, _nd_2);
      e.mem[_t_1 + 1] = term_ctr(CID_SCON, STAT_OFF + 503);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_1);
    }
    r0 = term_ctr(CID_CON, _nd_2);
    r1 = term_ctr(CID_SCON, STAT_OFF + 503);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_K426)
  {
    WL_POPN(1);
    Term _repo_1 = STK(0);
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_3 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_3 + 0] = _repo_1;
    e.mem[_nd_3 + 1] = _h_0;
    r0 = term_clo(FID_SETUP_C427, _nd_3);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C427)
  {
    Term _repo_2 = r0;
    Term _h_1 = r1;
    Term _x_0 = r2;
    WL_OPEN
    _repo_2 = term_keep(e, _repo_2);
    u64 _nd_4 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_4 + 0] = _repo_2;
    e.mem[_nd_4 + 1] = _h_1;
    u64 _nd_14 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_14 + 0] = _repo_2;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_12 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_12 + 0] = term_clo(FID_SETUP_C428, _nd_4);
      e.mem[_t_12 + 1] = term_clo(FID_SETUP_C432, _nd_14);
      e.mem[_t_12 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_12);
    }
    r0 = term_clo(FID_SETUP_C428, _nd_4);
    r1 = term_clo(FID_SETUP_C432, _nd_14);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C428)
  {
    Term _repo_3 = r0;
    Term _h_2 = r1;
    Term _x_1 = r2;
    WL_OPEN
    _repo_3 = term_keep(e, _repo_3);
    u64 _nd_5 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_5 + 0] = _repo_3;
    e.mem[_nd_5 + 1] = _h_2;
    u64 _nd_13 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_13 + 0] = _repo_3;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_5 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = term_clo(FID_SETUP_C429, _nd_5);
      e.mem[_t_5 + 1] = term_clo(FID_SETUP_C431, _nd_13);
      e.mem[_t_5 + 2] = _x_1;
      return term_tsk(FID_IO_BIND, _t_5);
    }
    r0 = term_clo(FID_SETUP_C429, _nd_5);
    r1 = term_clo(FID_SETUP_C431, _nd_13);
    r2 = _x_1;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C429)
  {
    Term _repo_4 = r0;
    Term _h_3 = r1;
    Term _x_2 = r2;
    WL_OPEN
    u64 _nd_6 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_6 + 0] = _repo_4;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_3 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _h_3;
      e.mem[_t_3 + 1] = term_clo(FID_SETUP_C430, _nd_6);
      e.mem[_t_3 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_3);
    }
    r0 = _h_3;
    r1 = term_clo(FID_SETUP_C430, _nd_6);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C430)
  {
    Term _repo_5 = r0;
    Term _x_3 = r1;
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
    term_sink(e, _o_1);
    term_sink(e, _o_3);
    u64 _nd_7 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_7 + 0] = _repo_5;
    e.mem[_nd_7 + 1] = term_pak(CID_NIL, 0);
    u64 _nd_8 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_8 + 0] = term_ctr(CID_SCON, STAT_OFF + 1485);
    e.mem[_nd_8 + 1] = term_ctr(CID_CON, _nd_7);
    u64 _nd_9 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_9 + 0] = term_ctr(CID_SCON, STAT_OFF + 1075);
    e.mem[_nd_9 + 1] = term_ctr(CID_CON, _nd_8);
    u64 _nd_10 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_10 + 0] = term_ctr(CID_SCON, STAT_OFF + 1483);
    e.mem[_nd_10 + 1] = term_ctr(CID_CON, _nd_9);
    u64 _nd_11 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_11 + 0] = term_ctr(CID_SCON, STAT_OFF + 1479);
    e.mem[_nd_11 + 1] = term_ctr(CID_CON, _nd_10);
    u64 _nd_12 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_12 + 0] = term_ctr(CID_SCON, STAT_OFF + 1440);
    e.mem[_nd_12 + 1] = term_ctr(CID_CON, _nd_11);
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNFULL)) {
      u64 _t_2 = task_node(e, FID____SRC_GIT_PROCESS_RUNFULL, WL_CONT, WL_IDX, 0);
      e.mem[_t_2 + 0] = term_ctr(CID_CON, _nd_12);
      e.mem[_t_2 + 1] = term_ctr(CID_SCON, STAT_OFF + 503);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNFULL, _t_2);
    }
    r0 = term_ctr(CID_CON, _nd_12);
    r1 = term_ctr(CID_SCON, STAT_OFF + 503);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNFULL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C431)
  {
    Term _repo_6 = r0;
    Term _x_4 = r1;
    WL_OPEN
    u32 _o_4 = 0;
    Term _o_5 = 0;
    u32 _o_6 = 0;
    Term _o_7 = 0;
    if (term_aux(_x_4) == CID____SRC_GIT_TYPES_RRUN) {
      _o_4 = 0;
      Term _fb_1[3];
      u64 _sp_2 = ctr_take(e, _x_4, 3, _fb_1);
      u32 _f_4 = _fb_1[0];
      u32 _f_5 = _fb_1[1];
      Term _f_6 = _fb_1[2];
      spare_free(e, cls_fit(3), _sp_2);
      _o_5 = _f_4;
      _o_6 = _f_5;
      _o_7 = _f_6;
    } else {
      _o_4 = 1;
      u64 _sp_3 = term_loc(_x_4);
      Term _f_7 = e.mem[_sp_3 + 0];
      heap_free(e, cls_fit(1), _sp_3);
      _o_5 = _f_7;
    }
    term_sink(e, _o_5);
    term_sink(e, _o_7);
    _repo_6 = term_keep(e, _repo_6);
    if (!DEVICE && !seq && fid_nofk(FID_GIT_SEQ)) {
      u64 _t_4 = task_node(e, FID_GIT_SEQ, WL_CONT, WL_IDX, 0);
      e.mem[_t_4 + 0] = term_ctr(CID_CON, STAT_OFF + 1617);
      e.mem[_t_4 + 1] = _repo_6;
      e.mem[_t_4 + 2] = _repo_6;
      return term_tsk(FID_GIT_SEQ, _t_4);
    }
    r0 = term_ctr(CID_CON, STAT_OFF + 1617);
    r1 = _repo_6;
    r2 = _repo_6;
    WL_JMP(FID_GIT_SEQ);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C432)
  {
    Term _repo_7 = r0;
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
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_SETUP_K433;
      WL_PUSHN(1);
    } else {
      u64 _t_6 = task_node(e, FID_SETUP_K433, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_SETUP_K433, _t_6);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_PROCESS_RUNGIT)) {
      u64 _t_7 = task_node(e, FID____SRC_GIT_PROCESS_RUNGIT, WL_CONT, WL_IDX, 0);
      e.mem[_t_7 + 0] = _repo_7;
      e.mem[_t_7 + 1] = term_ctr(CID_CON, STAT_OFF + 180);
      return term_tsk(FID____SRC_GIT_PROCESS_RUNGIT, _t_7);
    }
    r0 = _repo_7;
    r1 = term_ctr(CID_CON, STAT_OFF + 180);
    WL_JMP(FID____SRC_GIT_PROCESS_RUNGIT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_K433)
  {
    Term _h_4 = r0;
    WL_OPEN
    u64 _nd_15 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_15 + 0] = _h_4;
    r0 = term_clo(FID_SETUP_C434, _nd_15);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C434)
  {
    Term _h_5 = r0;
    Term _x_6 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_11 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_11 + 0] = _h_5;
      e.mem[_t_11 + 1] = term_clo(FID_SETUP_C435, 0);
      e.mem[_t_11 + 2] = _x_6;
      return term_tsk(FID_IO_BIND, _t_11);
    }
    r0 = _h_5;
    r1 = term_clo(FID_SETUP_C435, 0);
    r2 = _x_6;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C435)
  {
    Term _x_7 = r0;
    WL_OPEN
    u32 _o_12 = 0;
    Term _o_13 = 0;
    Term _o_14 = 0;
    if (term_aux(_x_7) == CID____SRC_GIT_TYPES_GRUN) {
      _o_12 = 0;
      u64 _sp_6 = term_loc(_x_7);
      u32 _f_12 = e.mem[_sp_6 + 0];
      Term _f_13 = e.mem[_sp_6 + 1];
      heap_free(e, cls_fit(2), _sp_6);
      _o_13 = _f_12;
      _o_14 = _f_13;
    } else {
      _o_12 = 1;
      u64 _sp_7 = term_loc(_x_7);
      Term _f_14 = e.mem[_sp_7 + 0];
      heap_free(e, cls_fit(1), _sp_7);
      _o_13 = _f_14;
    }
    Term _v_0 = 0;
    Term _v_1 = 0;
    Term _o_15[1];
    if (spin_41(e, _o_15, _o_12, _o_13, _o_14) == 0) {
      return 0;
    }
    _v_1 = _o_15[0];
    _v_0 = _v_1;
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_SETUP_K436;
      WL_PUSHN(1);
    } else {
      u64 _t_8 = task_node(e, FID_SETUP_K436, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_SETUP_K436, _t_8);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
      u64 _t_9 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
      e.mem[_t_9 + 0] = _v_0;
      return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_9);
    }
    r0 = _v_0;
    WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_K436)
  {
    Term _h_6 = r0;
    WL_OPEN
    u64 _nd_16 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_16 + 0] = _h_6;
    r0 = term_clo(FID_SETUP_C437, _nd_16);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_SETUP_C437)
  {
    Term _h_7 = r0;
    Term _x_8 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_PURE)) {
      u64 _t_10 = task_node(e, FID_IO_PURE, WL_CONT, WL_IDX, 0);
      e.mem[_t_10 + 0] = _h_7;
      e.mem[_t_10 + 1] = _x_8;
      return term_tsk(FID_IO_PURE, _t_10);
    }
    r0 = _h_7;
    r1 = _x_8;
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
      e.mem[_t_3 + 1] = term_clo(FID_IO_BIND_C439, _nd_0);
      return term_tsk(FID_CLO_APPLY, _t_3);
    }
    r0 = _m_0;
    r1 = term_clo(FID_IO_BIND_C439, _nd_0);
    WL_JMP(FID_CLO_APPLY);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_BIND_C439)
  {
    Term _f_1 = r0;
    Term _k_1 = r1;
    Term _x_0 = r2;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _k_1;
      STK(1) = FID_IO_BIND_K440;
      WL_PUSHN(2);
    } else {
      u64 _t_0 = task_node(e, FID_IO_BIND_K440, WL_CONT, WL_IDX, 1);
      e.mem[_t_0 + 0] = _k_1;
      WL_CONT = term_tsk(FID_IO_BIND_K440, _t_0);
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
  WL_CASE(FID_IO_BIND_K440)
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
      STK(0) = FID_MAIN_K442;
      WL_PUSHN(1);
    } else {
      u64 _t_0 = task_node(e, FID_MAIN_K442, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_MAIN_K442, _t_0);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID_SETUP)) {
      u64 _t_1 = task_node(e, FID_SETUP, WL_CONT, WL_IDX, 0);
      e.mem[_t_1 + 0] = term_ctr(CID_SCON, STAT_OFF + 1233);
      return term_tsk(FID_SETUP, _t_1);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 1233);
    WL_JMP(FID_SETUP);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K442)
  {
    Term _h_0 = r0;
    WL_OPEN
    u64 _nd_0 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_0 + 0] = _h_0;
    r0 = term_clo(FID_MAIN_C443, _nd_0);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C443)
  {
    Term _h_1 = r0;
    Term _x_0 = r1;
    WL_OPEN
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_39 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_39 + 0] = _h_1;
      e.mem[_t_39 + 1] = term_clo(FID_MAIN_C444, 0);
      e.mem[_t_39 + 2] = _x_0;
      return term_tsk(FID_IO_BIND, _t_39);
    }
    r0 = _h_1;
    r1 = term_clo(FID_MAIN_C444, 0);
    r2 = _x_0;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C444)
  {
    Term _x_1 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_MAIN_K445;
      WL_PUSHN(1);
    } else {
      u64 _t_2 = task_node(e, FID_MAIN_K445, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_MAIN_K445, _t_2);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_TRIM_NL)) {
      u64 _t_3 = task_node(e, FID____SRC_GIT_TEXT_TRIM_NL, WL_CONT, WL_IDX, 0);
      e.mem[_t_3 + 0] = _x_1;
      return term_tsk(FID____SRC_GIT_TEXT_TRIM_NL, _t_3);
    }
    r0 = _x_1;
    WL_JMP(FID____SRC_GIT_TEXT_TRIM_NL);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K445)
  {
    Term _h_2 = r0;
    WL_OPEN
    _h_2 = term_keep(e, _h_2);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _h_2;
      STK(1) = FID_MAIN_K446;
      WL_PUSHN(2);
    } else {
      u64 _t_4 = task_node(e, FID_MAIN_K446, WL_CONT, WL_IDX, 1);
      e.mem[_t_4 + 0] = _h_2;
      WL_CONT = term_tsk(FID_MAIN_K446, _t_4);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_5 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_5 + 0] = term_ctr(CID_SCON, STAT_OFF + 1457);
      e.mem[_t_5 + 1] = _h_2;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_5);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 1457);
    r1 = _h_2;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K446)
  {
    WL_POPN(1);
    Term _h_3 = STK(0);
    Term _h_4 = r0;
    WL_OPEN
    u64 _nd_1 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_1 + 0] = _h_3;
    e.mem[_nd_1 + 1] = _h_4;
    r0 = term_clo(FID_MAIN_C447, _nd_1);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C447)
  {
    Term _h_5 = r0;
    Term _h_6 = r1;
    Term _x_2 = r2;
    WL_OPEN
    u64 _nd_2 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_2 + 0] = _h_6;
    u64 _nd_3 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_3 + 0] = _h_5;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_38 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_38 + 0] = term_clo(FID_IO_PRINT, _nd_2);
      e.mem[_t_38 + 1] = term_clo(FID_MAIN_C448, _nd_3);
      e.mem[_t_38 + 2] = _x_2;
      return term_tsk(FID_IO_BIND, _t_38);
    }
    r0 = term_clo(FID_IO_PRINT, _nd_2);
    r1 = term_clo(FID_MAIN_C448, _nd_3);
    r2 = _x_2;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C448)
  {
    Term _h_7 = r0;
    Term _x_3 = r1;
    WL_OPEN
    _h_7 = term_keep(e, _h_7);
    if (seq) {
      WL_ROOM(2);
      STK(0) = _h_7;
      STK(1) = FID_MAIN_K449;
      WL_PUSHN(2);
    } else {
      u64 _t_6 = task_node(e, FID_MAIN_K449, WL_CONT, WL_IDX, 1);
      e.mem[_t_6 + 0] = _h_7;
      WL_CONT = term_tsk(FID_MAIN_K449, _t_6);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID_CHK_CREATE_OK)) {
      u64 _t_7 = task_node(e, FID_CHK_CREATE_OK, WL_CONT, WL_IDX, 0);
      e.mem[_t_7 + 0] = term_ctr(CID_SCON, STAT_OFF + 1233);
      e.mem[_t_7 + 1] = term_ctr(CID_SCON, STAT_OFF + 683);
      e.mem[_t_7 + 2] = _h_7;
      return term_tsk(FID_CHK_CREATE_OK, _t_7);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 1233);
    r1 = term_ctr(CID_SCON, STAT_OFF + 683);
    r2 = _h_7;
    WL_JMP(FID_CHK_CREATE_OK);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K449)
  {
    WL_POPN(1);
    Term _h_8 = STK(0);
    Term _h_9 = r0;
    WL_OPEN
    u64 _nd_4 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_4 + 0] = _h_8;
    e.mem[_nd_4 + 1] = _h_9;
    r0 = term_clo(FID_MAIN_C450, _nd_4);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C450)
  {
    Term _h_10 = r0;
    Term _h_11 = r1;
    Term _x_4 = r2;
    WL_OPEN
    u64 _nd_5 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_5 + 0] = _h_10;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_37 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_37 + 0] = _h_11;
      e.mem[_t_37 + 1] = term_clo(FID_MAIN_C451, _nd_5);
      e.mem[_t_37 + 2] = _x_4;
      return term_tsk(FID_IO_BIND, _t_37);
    }
    r0 = _h_11;
    r1 = term_clo(FID_MAIN_C451, _nd_5);
    r2 = _x_4;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C451)
  {
    Term _h_12 = r0;
    Term _x_5 = r1;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _h_12;
      STK(1) = FID_MAIN_K452;
      WL_PUSHN(2);
    } else {
      u64 _t_8 = task_node(e, FID_MAIN_K452, WL_CONT, WL_IDX, 1);
      e.mem[_t_8 + 0] = _h_12;
      WL_CONT = term_tsk(FID_MAIN_K452, _t_8);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_9 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_9 + 0] = term_pak(CID_SNIL, 0);
      e.mem[_t_9 + 1] = _x_5;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_9);
    }
    r0 = term_pak(CID_SNIL, 0);
    r1 = _x_5;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K452)
  {
    WL_POPN(1);
    Term _h_13 = STK(0);
    Term _h_14 = r0;
    WL_OPEN
    _h_13 = term_keep(e, _h_13);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _h_14;
      STK(1) = _h_13;
      STK(2) = FID_MAIN_K453;
      WL_PUSHN(3);
    } else {
      u64 _t_10 = task_node(e, FID_MAIN_K453, WL_CONT, WL_IDX, 1);
      e.mem[_t_10 + 0] = _h_14;
      e.mem[_t_10 + 1] = _h_13;
      WL_CONT = term_tsk(FID_MAIN_K453, _t_10);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID_CHK_BRANCH_EXISTS)) {
      u64 _t_11 = task_node(e, FID_CHK_BRANCH_EXISTS, WL_CONT, WL_IDX, 0);
      e.mem[_t_11 + 0] = term_ctr(CID_SCON, STAT_OFF + 1233);
      e.mem[_t_11 + 1] = term_ctr(CID_SCON, STAT_OFF + 683);
      e.mem[_t_11 + 2] = _h_13;
      return term_tsk(FID_CHK_BRANCH_EXISTS, _t_11);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 1233);
    r1 = term_ctr(CID_SCON, STAT_OFF + 683);
    r2 = _h_13;
    WL_JMP(FID_CHK_BRANCH_EXISTS);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K453)
  {
    WL_POPN(2);
    Term _h_15 = STK(0);
    Term _h_16 = STK(1);
    Term _h_17 = r0;
    WL_OPEN
    u64 _nd_6 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_6 + 0] = _h_15;
    e.mem[_nd_6 + 1] = _h_16;
    e.mem[_nd_6 + 2] = _h_17;
    r0 = term_clo(FID_MAIN_C454, _nd_6);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C454)
  {
    Term _h_18 = r0;
    Term _h_19 = r1;
    Term _h_20 = r2;
    Term _x_6 = r3;
    WL_OPEN
    u64 _nd_7 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_7 + 0] = _h_18;
    e.mem[_nd_7 + 1] = _h_19;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_36 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_36 + 0] = _h_20;
      e.mem[_t_36 + 1] = term_clo(FID_MAIN_C455, _nd_7);
      e.mem[_t_36 + 2] = _x_6;
      return term_tsk(FID_IO_BIND, _t_36);
    }
    r0 = _h_20;
    r1 = term_clo(FID_MAIN_C455, _nd_7);
    r2 = _x_6;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C455)
  {
    Term _h_21 = r0;
    Term _h_22 = r1;
    Term _x_7 = r2;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _h_22;
      STK(1) = FID_MAIN_K456;
      WL_PUSHN(2);
    } else {
      u64 _t_12 = task_node(e, FID_MAIN_K456, WL_CONT, WL_IDX, 1);
      e.mem[_t_12 + 0] = _h_22;
      WL_CONT = term_tsk(FID_MAIN_K456, _t_12);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_13 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_13 + 0] = _h_21;
      e.mem[_t_13 + 1] = _x_7;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_13);
    }
    r0 = _h_21;
    r1 = _x_7;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K456)
  {
    WL_POPN(1);
    Term _h_23 = STK(0);
    Term _h_24 = r0;
    WL_OPEN
    _h_23 = term_keep(e, _h_23);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _h_24;
      STK(1) = _h_23;
      STK(2) = FID_MAIN_K457;
      WL_PUSHN(3);
    } else {
      u64 _t_14 = task_node(e, FID_MAIN_K457, WL_CONT, WL_IDX, 1);
      e.mem[_t_14 + 0] = _h_24;
      e.mem[_t_14 + 1] = _h_23;
      WL_CONT = term_tsk(FID_MAIN_K457, _t_14);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID_CHK_PATH_EXISTS)) {
      u64 _t_15 = task_node(e, FID_CHK_PATH_EXISTS, WL_CONT, WL_IDX, 0);
      e.mem[_t_15 + 0] = term_ctr(CID_SCON, STAT_OFF + 1233);
      e.mem[_t_15 + 1] = term_ctr(CID_SCON, STAT_OFF + 683);
      e.mem[_t_15 + 2] = _h_23;
      return term_tsk(FID_CHK_PATH_EXISTS, _t_15);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 1233);
    r1 = term_ctr(CID_SCON, STAT_OFF + 683);
    r2 = _h_23;
    WL_JMP(FID_CHK_PATH_EXISTS);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K457)
  {
    WL_POPN(2);
    Term _h_25 = STK(0);
    Term _h_26 = STK(1);
    Term _h_27 = r0;
    WL_OPEN
    u64 _nd_8 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_8 + 0] = _h_25;
    e.mem[_nd_8 + 1] = _h_26;
    e.mem[_nd_8 + 2] = _h_27;
    r0 = term_clo(FID_MAIN_C458, _nd_8);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C458)
  {
    Term _h_28 = r0;
    Term _h_29 = r1;
    Term _h_30 = r2;
    Term _x_8 = r3;
    WL_OPEN
    u64 _nd_9 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_9 + 0] = _h_28;
    e.mem[_nd_9 + 1] = _h_29;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_35 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_35 + 0] = _h_30;
      e.mem[_t_35 + 1] = term_clo(FID_MAIN_C459, _nd_9);
      e.mem[_t_35 + 2] = _x_8;
      return term_tsk(FID_IO_BIND, _t_35);
    }
    r0 = _h_30;
    r1 = term_clo(FID_MAIN_C459, _nd_9);
    r2 = _x_8;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C459)
  {
    Term _h_31 = r0;
    Term _h_32 = r1;
    Term _x_9 = r2;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _h_32;
      STK(1) = FID_MAIN_K460;
      WL_PUSHN(2);
    } else {
      u64 _t_16 = task_node(e, FID_MAIN_K460, WL_CONT, WL_IDX, 1);
      e.mem[_t_16 + 0] = _h_32;
      WL_CONT = term_tsk(FID_MAIN_K460, _t_16);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_17 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_17 + 0] = _h_31;
      e.mem[_t_17 + 1] = _x_9;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_17);
    }
    r0 = _h_31;
    r1 = _x_9;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K460)
  {
    WL_POPN(1);
    Term _h_33 = STK(0);
    Term _h_34 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(3);
      STK(0) = _h_34;
      STK(1) = _h_33;
      STK(2) = FID_MAIN_K461;
      WL_PUSHN(3);
    } else {
      u64 _t_18 = task_node(e, FID_MAIN_K461, WL_CONT, WL_IDX, 1);
      e.mem[_t_18 + 0] = _h_34;
      e.mem[_t_18 + 1] = _h_33;
      WL_CONT = term_tsk(FID_MAIN_K461, _t_18);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID_CHK_UNKNOWN_BASE)) {
      u64 _t_19 = task_node(e, FID_CHK_UNKNOWN_BASE, WL_CONT, WL_IDX, 0);
      e.mem[_t_19 + 0] = term_ctr(CID_SCON, STAT_OFF + 1233);
      e.mem[_t_19 + 1] = term_ctr(CID_SCON, STAT_OFF + 1275);
      e.mem[_t_19 + 2] = _h_33;
      return term_tsk(FID_CHK_UNKNOWN_BASE, _t_19);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 1233);
    r1 = term_ctr(CID_SCON, STAT_OFF + 1275);
    r2 = _h_33;
    WL_JMP(FID_CHK_UNKNOWN_BASE);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K461)
  {
    WL_POPN(2);
    Term _h_35 = STK(0);
    Term _h_36 = STK(1);
    Term _h_37 = r0;
    WL_OPEN
    u64 _nd_10 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_10 + 0] = _h_35;
    e.mem[_nd_10 + 1] = _h_36;
    e.mem[_nd_10 + 2] = _h_37;
    r0 = term_clo(FID_MAIN_C462, _nd_10);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C462)
  {
    Term _h_38 = r0;
    Term _h_39 = r1;
    Term _h_40 = r2;
    Term _x_10 = r3;
    WL_OPEN
    u64 _nd_11 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_11 + 0] = _h_38;
    e.mem[_nd_11 + 1] = _h_39;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_34 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_34 + 0] = _h_40;
      e.mem[_t_34 + 1] = term_clo(FID_MAIN_C463, _nd_11);
      e.mem[_t_34 + 2] = _x_10;
      return term_tsk(FID_IO_BIND, _t_34);
    }
    r0 = _h_40;
    r1 = term_clo(FID_MAIN_C463, _nd_11);
    r2 = _x_10;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C463)
  {
    Term _h_41 = r0;
    Term _h_42 = r1;
    Term _x_11 = r2;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _h_42;
      STK(1) = FID_MAIN_K464;
      WL_PUSHN(2);
    } else {
      u64 _t_20 = task_node(e, FID_MAIN_K464, WL_CONT, WL_IDX, 1);
      e.mem[_t_20 + 0] = _h_42;
      WL_CONT = term_tsk(FID_MAIN_K464, _t_20);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_21 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_21 + 0] = _h_41;
      e.mem[_t_21 + 1] = _x_11;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_21);
    }
    r0 = _h_41;
    r1 = _x_11;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K464)
  {
    WL_POPN(1);
    Term _h_43 = STK(0);
    Term _h_44 = r0;
    WL_OPEN
    _h_43 = term_keep(e, _h_43);
    if (seq) {
      WL_ROOM(3);
      STK(0) = _h_44;
      STK(1) = _h_43;
      STK(2) = FID_MAIN_K465;
      WL_PUSHN(3);
    } else {
      u64 _t_22 = task_node(e, FID_MAIN_K465, WL_CONT, WL_IDX, 1);
      e.mem[_t_22 + 0] = _h_44;
      e.mem[_t_22 + 1] = _h_43;
      WL_CONT = term_tsk(FID_MAIN_K465, _t_22);
      WL_IDX = 2;
    }
    if (!DEVICE && !seq && fid_nofk(FID_CHK_STATUS_CLEAN)) {
      u64 _t_23 = task_node(e, FID_CHK_STATUS_CLEAN, WL_CONT, WL_IDX, 0);
      e.mem[_t_23 + 0] = term_ctr(CID_SCON, STAT_OFF + 731);
      e.mem[_t_23 + 1] = _h_43;
      return term_tsk(FID_CHK_STATUS_CLEAN, _t_23);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 731);
    r1 = _h_43;
    WL_JMP(FID_CHK_STATUS_CLEAN);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K465)
  {
    WL_POPN(2);
    Term _h_45 = STK(0);
    Term _h_46 = STK(1);
    Term _h_47 = r0;
    WL_OPEN
    u64 _nd_12 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_12 + 0] = _h_45;
    e.mem[_nd_12 + 1] = _h_46;
    e.mem[_nd_12 + 2] = _h_47;
    r0 = term_clo(FID_MAIN_C466, _nd_12);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C466)
  {
    Term _h_48 = r0;
    Term _h_49 = r1;
    Term _h_50 = r2;
    Term _x_12 = r3;
    WL_OPEN
    u64 _nd_13 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_13 + 0] = _h_48;
    e.mem[_nd_13 + 1] = _h_49;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_33 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_33 + 0] = _h_50;
      e.mem[_t_33 + 1] = term_clo(FID_MAIN_C467, _nd_13);
      e.mem[_t_33 + 2] = _x_12;
      return term_tsk(FID_IO_BIND, _t_33);
    }
    r0 = _h_50;
    r1 = term_clo(FID_MAIN_C467, _nd_13);
    r2 = _x_12;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C467)
  {
    Term _h_51 = r0;
    Term _h_52 = r1;
    Term _x_13 = r2;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _h_52;
      STK(1) = FID_MAIN_K468;
      WL_PUSHN(2);
    } else {
      u64 _t_24 = task_node(e, FID_MAIN_K468, WL_CONT, WL_IDX, 1);
      e.mem[_t_24 + 0] = _h_52;
      WL_CONT = term_tsk(FID_MAIN_K468, _t_24);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_25 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_25 + 0] = _h_51;
      e.mem[_t_25 + 1] = _x_13;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_25);
    }
    r0 = _h_51;
    r1 = _x_13;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K468)
  {
    WL_POPN(1);
    Term _h_53 = STK(0);
    Term _h_54 = r0;
    WL_OPEN
    if (seq) {
      WL_ROOM(2);
      STK(0) = _h_54;
      STK(1) = FID_MAIN_K469;
      WL_PUSHN(2);
    } else {
      u64 _t_26 = task_node(e, FID_MAIN_K469, WL_CONT, WL_IDX, 1);
      e.mem[_t_26 + 0] = _h_54;
      WL_CONT = term_tsk(FID_MAIN_K469, _t_26);
      WL_IDX = 1;
    }
    if (!DEVICE && !seq && fid_nofk(FID_CHK_STATUS_DIRTY)) {
      u64 _t_27 = task_node(e, FID_CHK_STATUS_DIRTY, WL_CONT, WL_IDX, 0);
      e.mem[_t_27 + 0] = term_ctr(CID_SCON, STAT_OFF + 731);
      e.mem[_t_27 + 1] = _h_53;
      return term_tsk(FID_CHK_STATUS_DIRTY, _t_27);
    }
    r0 = term_ctr(CID_SCON, STAT_OFF + 731);
    r1 = _h_53;
    WL_JMP(FID_CHK_STATUS_DIRTY);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K469)
  {
    WL_POPN(1);
    Term _h_55 = STK(0);
    Term _h_56 = r0;
    WL_OPEN
    u64 _nd_14 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_14 + 0] = _h_55;
    e.mem[_nd_14 + 1] = _h_56;
    r0 = term_clo(FID_MAIN_C470, _nd_14);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C470)
  {
    Term _h_57 = r0;
    Term _h_58 = r1;
    Term _x_14 = r2;
    WL_OPEN
    u64 _nd_15 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_15 + 0] = _h_57;
    if (!DEVICE && !seq && fid_nofk(FID_IO_BIND)) {
      u64 _t_32 = task_node(e, FID_IO_BIND, WL_CONT, WL_IDX, 0);
      e.mem[_t_32 + 0] = _h_58;
      e.mem[_t_32 + 1] = term_clo(FID_MAIN_C471, _nd_15);
      e.mem[_t_32 + 2] = _x_14;
      return term_tsk(FID_IO_BIND, _t_32);
    }
    r0 = _h_58;
    r1 = term_clo(FID_MAIN_C471, _nd_15);
    r2 = _x_14;
    WL_JMP(FID_IO_BIND);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C471)
  {
    Term _h_59 = r0;
    Term _x_15 = r1;
    WL_OPEN
    if (seq) {
      WL_ROOM(1);
      STK(0) = FID_MAIN_K472;
      WL_PUSHN(1);
    } else {
      u64 _t_28 = task_node(e, FID_MAIN_K472, WL_CONT, WL_IDX, 1);
      WL_CONT = term_tsk(FID_MAIN_K472, _t_28);
      WL_IDX = 0;
    }
    if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
      u64 _t_29 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
      e.mem[_t_29 + 0] = _h_59;
      e.mem[_t_29 + 1] = _x_15;
      return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_29);
    }
    r0 = _h_59;
    r1 = _x_15;
    WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K472)
  {
    Term _h_60 = r0;
    WL_OPEN
    u32 _v_0 = 0;
    u32 _v_1 = 0;
    Term _o_0[1];
    if (spin_4(e, _o_0, _h_60) == 0) {
      return 0;
    }
    _v_1 = _o_0[0];
    _v_0 = _v_1;
    if (_v_0 == 1) {
      if (seq) {
        WL_ROOM(1);
        STK(0) = FID_MAIN_K473;
        WL_PUSHN(1);
      } else {
        u64 _t_30 = task_node(e, FID_MAIN_K473, WL_CONT, WL_IDX, 1);
        WL_CONT = term_tsk(FID_MAIN_K473, _t_30);
        WL_IDX = 0;
      }
      if (!DEVICE && !seq && fid_nofk(FID____SRC_GIT_TEXT_STR_CAT)) {
        u64 _t_31 = task_node(e, FID____SRC_GIT_TEXT_STR_CAT, WL_CONT, WL_IDX, 0);
        e.mem[_t_31 + 0] = term_ctr(CID_SCON, STAT_OFF + 208);
        e.mem[_t_31 + 1] = _h_60;
        return term_tsk(FID____SRC_GIT_TEXT_STR_CAT, _t_31);
      }
      r0 = term_ctr(CID_SCON, STAT_OFF + 208);
      r1 = _h_60;
      WL_JMP(FID____SRC_GIT_TEXT_STR_CAT);
    } else {
      term_sink(e, _h_60);
      u64 _nd_17 = heap_alloc(e, cls_fit(1));
      e.mem[_nd_17 + 0] = term_ctr(CID_SCON, STAT_OFF + 256);
      r0 = term_clo(FID_IO_PRINT, _nd_17);
      WL_RETN(1);
    }
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_K473)
  {
    Term _h_61 = r0;
    WL_OPEN
    u64 _nd_16 = heap_alloc(e, cls_fit(1));
    e.mem[_nd_16 + 0] = _h_61;
    r0 = term_clo(FID_MAIN_C474, _nd_16);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_MAIN_C474)
  {
    Term _h_62 = r0;
    Term _x_16 = r1;
    WL_OPEN
    Term _v_2 = 0;
    Term _o_1[1];
    if (spin_10(e, _o_1, 1ull, _h_62, _x_16) == 0) {
      return 0;
    }
    _v_2 = _o_1[0];
    r0 = _v_2;
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_IO_PRINT)
  {
    Term _text_0 = r0;
    Term _k_0 = r1;
    WL_OPEN
    u64 _nd_18 = heap_alloc(e, cls_fit(2));
    e.mem[_nd_18 + 0] = _text_0;
    e.mem[_nd_18 + 1] = _k_0;
    r0 = term_ctr(CID_IO_PRINT, _nd_18);
    WL_RETN(1);
  }}
#endif

#if !DEVICE
  WL_CASE(FID_PROCESS_RUN)
  {
    Term _argv_0 = r0;
    Term _cwd_0 = r1;
    Term _k_1 = r2;
    WL_OPEN
    u64 _nd_19 = heap_alloc(e, cls_fit(3));
    e.mem[_nd_19 + 0] = _argv_0;
    e.mem[_nd_19 + 1] = _cwd_0;
    e.mem[_nd_19 + 2] = _k_1;
    r0 = term_ctr(CID_PROCESS_RUN, _nd_19);
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
