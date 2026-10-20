#!/usr/bin/env python3
"""Compile the real starttime effect and text packer in a small host-C fixture."""
import os
import pathlib
import re
import subprocess
import tempfile

source = pathlib.Path(__file__).parents[1] / "src/host/compile-queue-lifecycle.c"
text = source.read_text()

def function(name):
    match = re.search(r"static (?:int|void|Term) " + re.escape(name) + r"\s*\(", text)
    if not match:
        raise SystemExit(f"missing C function: {name}")
    start = text.index("{", match.end())
    depth = 0
    for end in range(start, len(text)):
        if text[end] == "{":
            depth += 1
        elif text[end] == "}":
            depth -= 1
            if depth == 0:
                return text[match.start():end + 1]
    raise SystemExit(f"unterminated C function: {name}")

fixture = r"""
#define _GNU_SOURCE
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
typedef unsigned int u32;
typedef unsigned long long u64;
typedef char *Term;
typedef void *Env;
typedef struct { char *data; } IoWork;
typedef struct {
  char *path, *text, *second, *cwd, *stdout_path, *stderr_path, *argv;
  u32 pid, sig, key_lock, cgen_lock, millis;
  int error, code, disposition;
  char *out;
  size_t out_length, argv_length;
} CqCall;
static Term io_str(Env env, const char *text, size_t length) {
  (void)env; char *copy = malloc(length + 1); if (!copy) abort();
  memcpy(copy, text, length); copy[length] = 0; return copy;
}
static Term io_done(Env env, Term value) { (void)env; return value; }
static Term io_fail(Env env, int error, void *detail) {
  (void)env; (void)error; (void)detail; return NULL;
}
"""
fixture += "\n".join(function(name) for name in ("cq_free", "cq_text_pack", "cq_starttime_text", "cq_call_starttime"))
fixture += """
int main(void) {
  CqCall *call = calloc(1, sizeof(*call));
  if (!call) return 10;
  call->pid = (u32)getpid();
  IoWork work = { .data = (char *)call };
  cq_call_starttime(&work);
  if (call->error) return 11;
  if (!call->out || !*call->out) return 12;
  char *end = NULL; errno = 0; unsigned long long start = strtoull(call->out, &end, 10);
  if (errno || end == call->out || *end || !start) return 13;
  if (call->out_length != strlen(call->out)) return 14;
  Term packed = cq_text_pack(NULL, &work);
  if (!packed || strlen(packed) == 0 || strspn(packed, "0123456789") != strlen(packed)) return 15;
  free(packed);
  return 0;
}
"""
with tempfile.TemporaryDirectory(prefix="compile-queue-starttime-") as tmp:
    cfile = pathlib.Path(tmp) / "fixture.c"
    exe = pathlib.Path(tmp) / "fixture"
    cfile.write_text(fixture)
    subprocess.run([os.environ.get("CC", "cc"), "-std=c11", "-Wall", "-Wextra", "-Werror", str(cfile), "-o", str(exe)], check=True)
    subprocess.run([str(exe)], check=True)
print("starttime effect returns and packs a nonempty decimal process start identity")

