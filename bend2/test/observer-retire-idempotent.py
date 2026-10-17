#!/usr/bin/env python3
"""Compile and exercise the exact observer-retirement function from process-spawn.c."""

from pathlib import Path
import subprocess
import tempfile
import os


ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(os.environ.get("BATON_PROCESS_SPAWN_SOURCE", ROOT / "src/host/process-spawn.c"))


def function_body(text: str, name: str) -> str:
    marker = f"static int {name}("
    start = text.index(marker)
    opening = text.index("{", start)
    depth = 0
    for offset in range(opening, len(text)):
        if text[offset] == "{":
            depth += 1
        elif text[offset] == "}":
            depth -= 1
            if depth == 0:
                return text[start : offset + 1]
    raise ValueError(f"unterminated function: {name}")


HARNESS = r"""
#define _GNU_SOURCE
#include <errno.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
typedef uint32_t u32;
#ifndef SYS_pidfd_open
#define SYS_pidfd_open 434
#endif
#ifndef SYS_pidfd_send_signal
#define SYS_pidfd_send_signal 424
#endif
typedef struct {
  int observer_life, observer_absent, observer_retired;
  u32 observer;
} BatonSessionLock;
static int lifetime_acquisitions;
static int br_process_lifetime(pid_t pid,int *ended) {
  lifetime_acquisitions++;
  int fd=(int)syscall(SYS_pidfd_open,pid,0);
  if(fd<0 && errno==ESRCH)*ended=1;
  return fd;
}
__FUNCTION__
static pid_t child(void) {
  pid_t pid=fork();
  if(pid<0){perror("fork");exit(90);}
  if(!pid)for(;;)pause();
  return pid;
}
static int alive(pid_t pid) { return kill(pid,0)==0 || errno==EPERM; }
static void reap(pid_t pid) {
  if(alive(pid))kill(pid,SIGKILL);
  int status;
  while(waitpid(pid,&status,0)<0 && errno==EINTR){}
}
int main(void) {
  int failures=0;
  pid_t unrelated=child();
  BatonSessionLock absent={.observer=(u32)unrelated,.observer_life=-1,.observer_absent=1};
  int first=baton_observer_retire(&absent);
  int second=baton_observer_retire(&absent);
  int absent_ok=first==0 && second==0 && lifetime_acquisitions==0 && alive(unrelated);
  printf("known-absence-sticky=%s acquisitions=%d unrelated-alive=%d\n",
         absent_ok?"PASS":"FAIL",lifetime_acquisitions,alive(unrelated));
  if(!absent_ok)failures++;
  reap(unrelated);

  pid_t target=child();
  unrelated=child();
  int target_fd=(int)syscall(SYS_pidfd_open,target,0);
  if(target_fd<0){perror("pidfd_open target");reap(target);reap(unrelated);return 3;}
  BatonSessionLock live={.observer=(u32)unrelated,.observer_life=target_fd};
  first=baton_observer_retire(&live);
  int status=0;
  int target_reaped=waitpid(target,&status,WNOHANG)==target;
  int acquisitions_after_first=lifetime_acquisitions;
  second=baton_observer_retire(&live);
  int live_ok=first==0 && second==0 && target_reaped &&
      acquisitions_after_first==0 && lifetime_acquisitions==0 && alive(unrelated);
  printf("successful-retirement-sticky=%s acquisitions=%d target-reaped=%d unrelated-alive=%d\n",
         live_ok?"PASS":"FAIL",lifetime_acquisitions,target_reaped,alive(unrelated));
  if(!live_ok)failures++;
  reap(unrelated);
  return failures?1:0;
}
"""


def main() -> int:
    source = SOURCE.read_text()
    retirement = function_body(source, "baton_observer_retire")
    harness = HARNESS.replace("__FUNCTION__", retirement)
    with tempfile.TemporaryDirectory(prefix="baton-observer-retire-") as temporary:
        c_file = Path(temporary) / "retire.c"
        executable = Path(temporary) / "retire"
        c_file.write_text(harness)
        subprocess.run(
            ["cc", "-O2", "-Wall", "-Wextra", "-Werror", str(c_file), "-o", str(executable)],
            check=True,
        )
        result = subprocess.run([str(executable)], check=False, text=True, capture_output=True)
        print(result.stdout, end="")
        if result.stderr:
            print(result.stderr, end="")
        return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
