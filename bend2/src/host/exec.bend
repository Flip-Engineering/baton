import Base

# The generic exec effect: spawn one process with no shell anywhere. argv
# is the length-prefixed string (the enc_argv encoding); the child's
# stdout is captured, its stderr is inherited for the coordinator's log,
# and the answer is "exit <n>\n" or "signal <n>\n" followed by the
# captured bytes. env is the child's environment delta over the
# inherited environment, NUL-separated entries: NAME=VALUE sets or
# overrides, a bare NAME removes, empty inherits all; an empty-name
# entry is refused EINVAL.
def Exec.run(argv: String, cwd: String, env: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./exec.c"

# The capture variant: the child's stderr is written to stderr_path
# (created or truncated before the child starts) instead of being
# inherited, so the delivery contract can record it per command. The
# answer wire and the env delta are identical to Exec.run.
def Exec.run_capture(argv: String, cwd: String, env: String, stderr_path: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./exec.c"
