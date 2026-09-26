# Claude Code worker session lifecycle.
#
# Starts a Claude Code session in stream-json mode, writes a prompt to stdin,
# reads NDJSON output lines, and detects turn completion (type=result).
# Supports resume via --resume <sessionId>.

import Base
import ../host/process.bend as P
import ./wake.bend as W

def claude_base_args() -> String:
  "--print\n--input-format\nstream-json\n--output-format\nstream-json\n--verbose\n--permission-mode\nbypassPermissions"

def claude_args_with_model(+model: String, +effort: String) -> String:
  claude_base_args() ++ "\n--model\n" ++ model ++ "\n--effort\n" ++ effort

def claude_resume_args(+model: String, +effort: String, session_id: String) -> String:
  claude_args_with_model(model, effort) ++ "\n--resume\n" ++ session_id

def user_frame(text: String) -> String:
  "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"" ++ W.json_escape(text) ++ "\"}]}}\n"

def start_worker(claude_cmd: String, +model: String, +effort: String, cwd: String, prompt: String) -> IO(U32):
  do IO<U32>:
    +handle : U32 <- P.ProcessChild.spawn(claude_cmd, claude_args_with_model(model, effort), cwd)
    u1 : Unit <- P.ProcessChild.write(handle, user_frame(prompt))
    IO.pure(U32, handle)

def resume_worker(claude_cmd: String, +model: String, +effort: String, cwd: String, session_id: String, prompt: String) -> IO(U32):
  do IO<U32>:
    +handle : U32 <- P.ProcessChild.spawn(claude_cmd, claude_resume_args(model, effort, session_id), cwd)
    u1 : Unit <- P.ProcessChild.write(handle, user_frame(prompt))
    IO.pure(U32, handle)

def await_turn_result(handle: U32) -> IO(String):
  P.ProcessChild.read_until_result(handle)
