// The JS half of HostProc.exec: spawn the command under a shell and answer its
// standard output. The compiler finds the function by the def's name lowercased
// with dots as underscores, and the loop answers with io_done and io_fail.

function hostproc_exec(cmd) {
  const p = Bun.spawnSync(["sh", "-c", cmd]);
  if (p.exitCode !== 0) {
    return io_fail(p.exitCode);
  }
  return io_done(p.stdout.toString());
}
