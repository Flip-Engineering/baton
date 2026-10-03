# CLAIM: the operative laws whose real functions live in bend2/src/harness, each stated over the
# function that implements it and proved beside its claim. The coordinator laws module imports this
# module, and the coordinator entry imports that, so every compile of the entry verifies every law
# here.
#
# Serves: M-2 an unresolved external attempt stays unresolved until justified; M-5 accepted
# identities survive; M-11 caller input does not fabricate established facts; M-13 required
# progress notifications reach the agent interface.
# Policies: docs/bend2/laws-proposed.md. Reference: docs/bend2/reference/README.md, bend 2.0.25.
import Base
import ../host/process.bend as P
import ../json/canonical.bend as J
import ./codex-player.bend as Codex
import ./omp-player.bend as Omp
import ./claude-player.bend as Claude
import ./muse-player.bend as Muse

# ---------------------------------------------------------------------------
# M-2: an unresolved external attempt stays unresolved until justified. A fresh
# start is the spawn attempt itself: the adapter returns the process child's own
# result and fabricates no handle and no status.

law m2_codex_fresh_start_is_the_spawn_attempt:
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +stderr: String
  for session: String
  {Codex.start_player(cmd, model, effort, cwd, stderr, session, True{}) == P.ProcessChild.spawn(P.argv(List.append(&1,String,["/usr/bin/env","-u","OPENAI_API_KEY","-u","CODEX_API_KEY",cmd,"-c","forced_login_method=\"chatgpt\"","exec"],Codex.arguments(model,effort))),cwd,stderr) : IO(Result<&1,&1,U32 & String,U32>)}

def m2_codex_fresh_start_is_the_spawn_attempt(cmd, model, effort, cwd, stderr, session):
  {==}

law m2_omp_fresh_start_is_the_spawn_attempt:
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +log: String
  for +sessions: String
  for session: String
  {Omp.start_player(cmd, model, effort, cwd, log, sessions, session, True{}) == P.ProcessChild.spawn(P.argv(Omp.arguments(cmd,model,effort,sessions)),cwd,log ++ ".stderr") : IO(Result<&1,&1,U32 & String,U32>)}

def m2_omp_fresh_start_is_the_spawn_attempt(cmd, model, effort, cwd, log, sessions, session):
  {==}

law m2_claude_start_is_the_spawn_attempt:
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +stderr: String
  {Claude.start_player(cmd, model, effort, cwd, stderr) == P.ProcessChild.spawn(P.argv(Claude.arguments(cmd,model,effort)),cwd,stderr) : IO(Result<&1,&1,U32 & String,U32>)}

def m2_claude_start_is_the_spawn_attempt(cmd, model, effort, cwd, stderr):
  {==}

law m2_muse_start_is_the_spawn_attempt:
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +stderr: String
  for +task: String
  {Muse.start_player(cmd, model, effort, cwd, stderr, task) == P.ProcessChild.spawn(P.argv(Muse.arguments(cmd,model,effort,task)),cwd,stderr) : IO(Result<&1,&1,U32 & String,U32>)}

def m2_muse_start_is_the_spawn_attempt(cmd, model, effort, cwd, stderr, task):
  {==}

# ---------------------------------------------------------------------------
# M-5: accepted identities survive. A resume carries the session identity the
# caller supplied into the resumed argv unchanged, so the continuation reaches
# the same accepted session.

law m5_codex_resume_carries_the_accepted_session:
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +stderr: String
  for +session: String
  {Codex.start_player(cmd, model, effort, cwd, stderr, session, False{}) == P.ProcessChild.spawn(P.argv(List.append(&1,String,["/usr/bin/env","-u","OPENAI_API_KEY","-u","CODEX_API_KEY",cmd,"-c","forced_login_method=\"chatgpt\"","exec","resume",session],Codex.arguments(model,effort))),cwd,stderr) : IO(Result<&1,&1,U32 & String,U32>)}

def m5_codex_resume_carries_the_accepted_session(cmd, model, effort, cwd, stderr, session):
  {==}

# Native Codex argv requests the ChatGPT subscription method and API-key removal.
# The host's env executable and Codex enforce those requests during execution.
law codex_fresh_argv_requests_chatgpt_and_key_removal:
  for +cmd: String
  for +model: String
  for +effort: String
  for session: String
  {Codex.argv(cmd, model, effort, session, True{}) == P.argv(List.append(&1,String,["/usr/bin/env","-u","OPENAI_API_KEY","-u","CODEX_API_KEY",cmd,"-c","forced_login_method=\"chatgpt\"","exec"],Codex.arguments(model,effort))) : String}

def codex_fresh_argv_requests_chatgpt_and_key_removal(cmd, model, effort, session):
  {==}

law codex_resume_argv_requests_chatgpt_and_key_removal:
  for +cmd: String
  for +model: String
  for +effort: String
  for +session: String
  {Codex.argv(cmd, model, effort, session, False{}) == P.argv(List.append(&1,String,["/usr/bin/env","-u","OPENAI_API_KEY","-u","CODEX_API_KEY",cmd,"-c","forced_login_method=\"chatgpt\"","exec","resume",session],Codex.arguments(model,effort))) : String}

def codex_resume_argv_requests_chatgpt_and_key_removal(cmd, model, effort, session):
  {==}

law m5_omp_resume_carries_the_accepted_session:
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +log: String
  for +sessions: String
  for +session: String
  {Omp.start_player(cmd, model, effort, cwd, log, sessions, session, False{}) == P.ProcessChild.spawn(P.argv(List.append(&1,String,Omp.arguments(cmd,model,effort,sessions),["--resume",session])),cwd,log ++ ".stderr") : IO(Result<&1,&1,U32 & String,U32>)}

def m5_omp_resume_carries_the_accepted_session(cmd, model, effort, cwd, log, sessions, session):
  {==}

law m5_claude_resume_carries_the_accepted_session:
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +stderr: String
  for +session: String
  {Claude.resume_player(cmd, model, effort, cwd, stderr, session) == P.ProcessChild.spawn(P.argv(List.append(&1,String,Claude.arguments(cmd,model,effort),["--resume",session])),cwd,stderr) : IO(Result<&1,&1,U32 & String,U32>)}

def m5_claude_resume_carries_the_accepted_session(cmd, model, effort, cwd, stderr, session):
  {==}

law m5_muse_resume_carries_the_accepted_session:
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +stderr: String
  for +session: String
  for +task: String
  {Muse.resume_player(cmd, model, effort, cwd, stderr, session, task) == P.ProcessChild.spawn(P.argv(List.append(&1,String,Muse.arguments(cmd,model,effort,task),["--session-id",session])),cwd,stderr) : IO(Result<&1,&1,U32 & String,U32>)}

def m5_muse_resume_carries_the_accepted_session(cmd, model, effort, cwd, stderr, session, task):
  {==}

# ---------------------------------------------------------------------------
# M-11: caller input does not fabricate established facts. Each argv and frame
# builder carries the caller's text as its own element or as an escaped JSON
# string literal, so the text cannot become part of the command's own syntax.

law m11_codex_arguments_carry_the_declared_values:
  for +model: String
  for +effort: String
  {Codex.arguments(model, effort) == ["--json","--model",model,"-c","model_reasoning_effort=" ++ J.string_literal(effort),"--dangerously-bypass-approvals-and-sandbox","-"] : List<String>}

def m11_codex_arguments_carry_the_declared_values(model, effort):
  {==}

law m11_omp_arguments_carry_the_declared_values:
  for +cmd: String
  for +model: String
  for +effort: String
  for +sessions: String
  {Omp.arguments(cmd, model, effort, sessions) == [cmd,"--mode","rpc","--model",model,"--thinking",effort,"--approval-mode","yolo","--session-dir",sessions] : List<String>}

def m11_omp_arguments_carry_the_declared_values(cmd, model, effort, sessions):
  {==}

law m11_claude_user_frame_carries_the_text_as_a_literal:
  for +text: String
  {Claude.user_frame(text) == "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":" ++ J.string_literal(text) ++ "}}\n" : String}

def m11_claude_user_frame_carries_the_text_as_a_literal(text):
  {==}

law m11_muse_arguments_keep_the_task_one_element:
  for +cmd: String
  for +model: String
  for +effort: String
  for +task: String
  {Muse.arguments(cmd, model, effort, task) == [cmd,"exec","--json","--prompt-file",task,"--model",model,"--reasoning-effort",effort,"--yolo"] : List<String>}

def m11_muse_arguments_keep_the_task_one_element(cmd, model, effort, task):
  {==}

# ---------------------------------------------------------------------------
# M-13: required progress notifications reach the agent interface. Each adapter
# delivers the task through the child's own process interface: the input
# function writes the framed text to the handle the spawn returned, and the Muse
# adapter delivers its task through the argv prompt file, so its input writes
# no bytes to the child.

law m13_codex_input_writes_the_task_text:
  for +handle: U32
  for +text: String
  {Codex.input(handle, text) == P.ProcessChild.write(handle, text) : IO(Result<&1,&1,U32 & String,Unit>)}

def m13_codex_input_writes_the_task_text(handle, text):
  {==}

law m13_omp_input_writes_the_prompt_frames:
  for +handle: U32
  for +text: String
  {Omp.input(handle, text) == P.ProcessChild.write(handle, "{\"type\":\"get_state\",\"id\":\"baton:session\"}\n{\"type\":\"prompt\",\"id\":\"baton:prompt\",\"message\":" ++ J.string_literal(text) ++ "}\n") : IO(Result<&1,&1,U32 & String,Unit>)}

def m13_omp_input_writes_the_prompt_frames(handle, text):
  {==}

law m13_claude_input_writes_the_user_frame:
  for +handle: U32
  for +text: String
  {Claude.input(handle, text) == P.ProcessChild.write(handle, Claude.user_frame(text)) : IO(Result<&1,&1,U32 & String,Unit>)}

def m13_claude_input_writes_the_user_frame(handle, text):
  {==}

law m13_muse_input_writes_no_bytes:
  for handle: U32
  for text: String
  {Muse.input(handle, text) == IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}) : IO(Result<&1,&1,U32 & String,Unit>)}

def m13_muse_input_writes_no_bytes(handle, text):
  {==}
