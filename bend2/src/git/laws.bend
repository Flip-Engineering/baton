# CLAIM: the operative laws whose real functions live in bend2/src/git, each stated over the
# function that implements it and proved beside its claim. The coordinator laws module imports
# this module, and the coordinator entry imports that, so every compile of the entry verifies
# every law here.
#
# Policies: docs/bend2/laws-proposed.md. Reference: docs/bend2/reference/README.md, bend 2.0.25.
import Base
import ./types.bend as T
import ./process.bend as P
import ./land.bend as L
import ./debris.bend as Deb
import ./text.bend as Tx
import ./status.bend as WS
import ./create-worktree.bend as CW

# ---------------------------------------------------------------------------
# M-2: an unresolved external attempt stays unresolved until justified.
# The one place a process outcome becomes an answer is P.git_out. A process
# that reached a status answers that status; a process that never started
# answers GBroken with its own detail and never a fabricated status.

law m2_status_is_the_observed_status:
  for +code: U32
  for +out: String
  {P.git_out(T.RRun{T.SExit{code}, out}) == T.GRun{code, out} : T.GitOut}

def m2_status_is_the_observed_status(code, out):
  {==}

law m2_signal_is_unresolved_not_a_status:
  for +num: U32
  for +out: String
  {P.git_out(T.RRun{T.SSignal{num}, out}) == T.GBroken{"git killed by signal"} : T.GitOut}

def m2_signal_is_unresolved_not_a_status(num, out):
  {==}

law m2_unstarted_names_its_own_detail:
  for +detail: String
  {P.git_out(T.RSpawn{detail}) == T.GBroken{detail} : T.GitOut}

def m2_unstarted_names_its_own_detail(detail):
  {==}

# ---------------------------------------------------------------------------
# M-3a: publication carries its evidence conditions for the actual artifact and
# target. A verdict that did not run always blocks and names the file it covers,
# and a verdict that passed contributes nothing to the blocking set.

law m3a_unjudged_candidate_blocks:
  for +why: String
  for +tv: L.Verdict
  for +file: String
  for acc: List<String>
  {L.pair_cv(L.VNone{why}, tv, file, acc) == Con{L.unjudged_line("candidate", file ++ ": " ++ why), acc} : List<String>}

def m3a_unjudged_candidate_blocks(why, tv, file, acc):
  match tv:
    case L.VPass{}: {==}
    case L.VFail{+hex}: {==}
    case L.VNone{+twhy}: {==}

law m3a_unjudged_target_blocks:
  for +hex: String
  for +why: String
  for +file: String
  for acc: List<String>
  {L.pair_targ(hex, L.VNone{why}, file, acc) == Con{L.unjudged_line("target", file ++ ": " ++ why), acc} : List<String>}

def m3a_unjudged_target_blocks(hex, why, file, acc):
  {==}

law m3a_passing_candidate_contributes_nothing:
  for +tv: L.Verdict
  for +file: String
  for acc: List<String>
  {L.pair_cv(L.VPass{}, tv, file, acc) == acc : List<String>}

def m3a_passing_candidate_contributes_nothing(tv, file, acc):
  match tv:
    case L.VPass{}: {==}
    case L.VFail{+hex}: {==}
    case L.VNone{+why}: {==}

# The pairing binds each selected file to its own two verdicts: a candidate
# failure is compared with the target verdict of the same file.
law m3a_pairs_bind_file_to_its_verdicts:
  for +file: String
  for +cv: L.Verdict
  for +tv: L.Verdict
  for acc: List<String>
  {L.pair_news(L.PV{file, cv, tv}, acc) == L.pair_cv(cv, tv, file, acc) : List<String>}

def m3a_pairs_bind_file_to_its_verdicts(file, cv, tv, acc):
  {==}

# ---------------------------------------------------------------------------
# M-3b: no duplicate logical effect under one operation identity. A worker
# commit the target already contains is answered LAlready and is never landed
# a second time.

law m3b_contained_commit_is_answered_already:
  for +wc: String
  {L.ff_stage2_ancestor(True{}, wc) == L.FFDone{T.LAlready{wc}} : L.FFLD}

def m3b_contained_commit_is_answered_already(wc):
  {==}

law m3b_absent_commit_is_not_answered_already:
  for +wc: String
  {L.ff_stage2_ancestor(False{}, wc) == L.FFNext{wc, SNil{}} : L.FFLD}

def m3b_absent_commit_is_not_answered_already(wc):
  {==}

# ---------------------------------------------------------------------------
# M-3c: no claiming a new effect that did not occur. The answer names the
# outcome the landing reached: an already-contained commit answers "already"
# and never "landed".

law m3c_already_answers_already:
  for +commit: String
  {L.outcome_json(T.LAlready{commit}) == "{\"status\":\"already\",\"commit\":\"" ++ commit ++ "\"}" : String}

def m3c_already_answers_already(commit):
  {==}

law m3c_landed_answers_landed:
  for +target: String
  for +commit: String
  {L.outcome_json(T.LLanded{target, commit}) == "{\"status\":\"landed\",\"target\":\"" ++ target ++ "\",\"commit\":\"" ++ commit ++ "\"}" : String}

def m3c_landed_answers_landed(target, commit):
  {==}

law m3c_blocked_answers_blocked:
  for +reason: String
  {L.outcome_json(T.LBlocked{reason}) == "{\"status\":\"blocked\",\"reason\":\"" ++ reason ++ "\"}" : String}

def m3c_blocked_answers_blocked(reason):
  {==}

# ---------------------------------------------------------------------------
# M-4: no disposal that violates custody or preservation. The only paths the
# landing drops are the paths the repository's own ignore rules added, and
# every dropped set is named on the commit message line a reader can see.

law m4_nothing_dropped_is_named_nothing:
  {Deb.debris_note(SNil{}) == SNil{} : String}

def m4_nothing_dropped_is_named_nothing():
  {==}

law m4_every_dropped_set_is_named:
  for +head: Char
  for +rest: String
  {Deb.debris_note(SCon{head, rest}) == "\ndropped (ignored by this repository): " ++ SCon{head, rest} : String}

def m4_every_dropped_set_is_named(head, rest):
  {==}

# ---------------------------------------------------------------------------
# M-10: no cutoff of valid requested work or owed data. The decision that
# decides what a selection runs takes the selection itself and no magnitude:
# the same selection runs whatever the count of pending rows.

law m10_check_argv_is_the_whole_selection:
  for +script: String
  for +file: String
  {L.check_argv(script, file) == Con{"/bin/sh", Con{script, Con{file, Nil{}}}} : List<String>}

def m10_check_argv_is_the_whole_selection(script, file):
  {==}

# ---------------------------------------------------------------------------
# M-11: caller input does not fabricate established facts. A verdict is made
# from the run that produced it: a run that never started is unjudged, and a
# run that produced no hex identity block is unjudged.

# M-11: a zero exit from the check is a pass, and nothing but the observed
# exit code produces one.
law m11_zero_exit_is_a_pass:
  for +out: String
  for +file: String
  {L.exit_verdict(True{}, out, file) == L.FV{file, L.VPass{}} : L.FV}

def m11_zero_exit_is_a_pass(out, file):
  {==}

law m11_unstarted_run_is_unjudged:
  for +detail: String
  for +file: String
  {L.run_verdict(T.RSpawn{detail}, file) == L.FV{file, L.VNone{detail}} : L.FV}

def m11_unstarted_run_is_unjudged(detail, file):
  {==}

law m11_killed_run_is_unjudged:
  for +num: U32
  for +out: String
  for +file: String
  {L.run_verdict(T.RRun{T.SSignal{num}, out}, file) == L.FV{file, L.VNone{"check killed by signal"}} : L.FV}

def m11_killed_run_is_unjudged(num, out, file):
  {==}

# ---------------------------------------------------------------------------
# M-14: a refusal states the actual failed rule and safe relevant context. The
# Git refusal vocabulary renders the operation and the git output that named
# the failure, and each constructor names its own subject.

law m14_git_cmd_refusal_names_operation_and_detail:
  for +op: String
  for +detail: String
  {T.fail_text(T.FCmd{op, detail}) == op ++ ": " ++ detail : String}

def m14_git_cmd_refusal_names_operation_and_detail(op, detail):
  {==}

law m14_branch_refusal_names_branch:
  for +branch: String
  {T.fail_text(T.FBranchExists{branch}) == "branch exists: " ++ branch : String}

def m14_branch_refusal_names_branch(branch):
  {==}

law m14_path_refusal_names_path:
  for +path: String
  {T.fail_text(T.FPathExists{path}) == "path exists: " ++ path : String}

def m14_path_refusal_names_path(path):
  {==}

law m14_base_refusal_names_base:
  for +base: String
  {T.fail_text(T.FUnknownBase{base}) == "unknown base: " ++ base : String}

def m14_base_refusal_names_base(base):
  {==}

law m14_busy_refusal_names_target:
  for +branch: String
  {T.fail_text(T.FTargetBusy{branch}) == "target busy: " ++ branch : String}

def m14_busy_refusal_names_target(branch):
  {==}

# ---------------------------------------------------------------------------
# M-10: the decision keeps every failure it decided to keep. A kept identity
# line stays in the answer; the lines the target also showed are the only ones
# omitted.

law m10_a_kept_failure_stays:
  for +f: String
  for acc: List<String>
  {L.append_when(True{}, f, acc) == Con{f, acc} : List<String>}

def m10_a_kept_failure_stays(f, acc):
  {==}

law m10_a_shared_failure_is_the_only_omission:
  for +f: String
  for acc: List<String>
  {L.append_when(False{}, f, acc) == acc : List<String>}

def m10_a_shared_failure_is_the_only_omission(f, acc):
  {==}

# ---------------------------------------------------------------------------
# M-18: no substitution of a publication destination. The push argv names the
# remote the caller declared, at the destination position, and the branch the
# caller declared as its refspec.

law m18_push_destination_is_the_declared_remote:
  for +branch: String
  for +remote: String
  {L.push_argv(branch, remote) == Con{"push", Con{remote, Con{branch, Nil{}}}} : List<String>}

def m18_push_destination_is_the_declared_remote(branch, remote):
  {==}

# ---------------------------------------------------------------------------
# Text helpers: the argv encoding and the run-result parser. M-2 keeps an
# unresolved attempt unresolved; M-11 reads established facts from the
# observed output and invents nothing; M-5 keeps accepted lines and order.

# M-2: a run the host never started stays unstarted, carrying its own detail.
law m2_tx_failed_run_invents_no_status:
  for +code: U32
  for +text: String
  {Tx.run_res(Fail{(code, text)}) == T.RSpawn{text} : T.RunRes}

def m2_tx_failed_run_invents_no_status(code, text):
  {==}

# M-11: the status is read from the observed output line, never invented. An
# "exit N" first line answers exit N, and the answer carries only the output
# that followed the status line.
law m11_tx_exit_reads_the_observed_status:
  {Tx.run_res(Done{"exit 0\n"}) == T.RRun{T.SExit{0}, ""} : T.RunRes}

def m11_tx_exit_reads_the_observed_status():
  {==}

# M-11: a "signal N" first line answers the killing signal, not a status.
law m11_tx_signal_reads_the_observed_status:
  {Tx.run_res(Done{"signal 9\n"}) == T.RRun{T.SSignal{9}, ""} : T.RunRes}

def m11_tx_signal_reads_the_observed_status():
  {==}

# M-2: a process that answered nothing stays unresolved until justified.
law m2_tx_empty_answer_stays_unresolved:
  {Tx.run_res(Done{""}) == T.RSpawn{"process answered nothing"} : T.RunRes}

def m2_tx_empty_answer_stays_unresolved():
  {==}

# M-2: a status line naming no known outcome stays unresolved, never a guess.
law m2_tx_unknown_token_stays_unresolved:
  {Tx.run_res(Done{"bogus 0\n"}) == T.RSpawn{"unknown status token"} : T.RunRes}

def m2_tx_unknown_token_stays_unresolved():
  {==}

# M-11: an empty argv encodes to no bytes; the encoder fabricates nothing.
law m11_tx_empty_argv_encodes_nothing:
  {Tx.enc_argv(Nil{}) == "" : String}

def m11_tx_empty_argv_encodes_nothing():
  {==}

# M-5: one argument survives the encoding with its byte length and content.
law m5_tx_single_argv_keeps_length_and_content:
  {Tx.enc_argv(Con{"ab", Nil{}}) == "2:ab" : String}

def m5_tx_single_argv_keeps_length_and_content():
  {==}

# M-5: no input lines means no lines out; the splitter invents none.
law m5_tx_no_lines_from_empty:
  {Tx.split_lines(SNil{}) == Nil{} : List<String>}

def m5_tx_no_lines_from_empty():
  {==}

# M-5: one line without a newline survives the split as itself.
law m5_tx_single_line_survives_split:
  {Tx.split_lines("a") == Con{"a", Nil{}} : List<String>}

def m5_tx_single_line_survives_split():
  {==}

# M-5: joining no lines answers the empty string.
law m5_tx_join_empty_is_empty:
  for +sep: String
  {Tx.join(sep, Nil{}) == "" : String}

def m5_tx_join_empty_is_empty(sep):
  {==}

# M-5: joining one line answers that line unchanged.
law m5_tx_join_single_is_identity:
  for +sep: String
  for +a: String
  {Tx.join(sep, Con{a, Nil{}}) == a : String}

def m5_tx_join_single_is_identity(sep, a):
  {==}

# M-5: no NUL-separated fields means no fields out.
law m5_tx_no_fields_from_empty_nul:
  {Tx.split_nul(SNil{}) == Nil{} : List<String>}

def m5_tx_no_fields_from_empty_nul():
  {==}

# ---------------------------------------------------------------------------
# Worktree status: the observed state of one worktree. M-2 carries the
# observed branch, commit and dirty flag into the answer and keeps a refusal
# a refusal; M-14 names the actual failed rule in every refusal rendering.

# M-2: the branch a successful stage read is the branch the answer carries.
law m2_ws_stage1_ok_carries_the_observed_branch:
  {WS.ws_stage1_ok(True{}, "main\n") == WS.WSNext{"main", SNil{}} : WS.WS}

def m2_ws_stage1_ok_carries_the_observed_branch():
  {==}

# M-14: a failed branch read names the git command that failed.
law m14_ws_stage1_fail_names_the_command:
  for +out: String
  {WS.ws_stage1_ok(False{}, out) == WS.WSFail{T.FCmd{"worktree-status", Tx.cmd_failed("git rev-parse --abbrev-ref HEAD")}} : WS.WS}

def m14_ws_stage1_fail_names_the_command(out):
  {==}

# M-2: the commit a successful stage read is the commit the answer carries.
law m2_ws_stage2_ok_carries_the_observed_commit:
  {WS.ws_stage2_ok(True{}, "abc123\n", "main") == WS.WSNext{"main", "abc123"} : WS.WS}

def m2_ws_stage2_ok_carries_the_observed_commit():
  {==}

# M-14: a failed commit read names the git command that failed.
law m14_ws_stage2_fail_names_the_command:
  for +out: String
  for +branch: String
  {WS.ws_stage2_ok(False{}, out, branch) == WS.WSFail{T.FCmd{"worktree-status", Tx.cmd_failed("git rev-parse HEAD")}} : WS.WS}

def m14_ws_stage2_fail_names_the_command(out, branch):
  {==}

# M-2: empty porcelain output answers a clean worktree, never a dirty one.
law m2_ws_stage3_clean_reports_clean:
  {WS.ws_stage3_ok(True{}, SNil{}, "main", "abc") == WS.WSDone{T.Wt{"main", "abc", False{}}} : WS.WS}

def m2_ws_stage3_clean_reports_clean():
  {==}

# M-2: porcelain output answers a dirty worktree; the flag is read, not set.
law m2_ws_stage3_dirty_reports_dirty:
  {WS.ws_stage3_ok(True{}, " M x\n", "main", "abc") == WS.WSDone{T.Wt{"main", "abc", True{}}} : WS.WS}

def m2_ws_stage3_dirty_reports_dirty():
  {==}

# M-14: a failed porcelain read names the git command that failed.
law m14_ws_stage3_fail_names_the_command:
  for +out: String
  for +branch: String
  for +commit: String
  {WS.ws_stage3_ok(False{}, out, branch, commit) == WS.WSFail{T.FCmd{"worktree-status", Tx.cmd_failed("git status --porcelain")}} : WS.WS}

def m14_ws_stage3_fail_names_the_command(out, branch, commit):
  {==}

# M-2: a finished status answers the observed state.
law m2_ws_done_answers_the_status:
  {WS.ws_answer(WS.WSDone{T.Wt{"b", "c", False{}}}) == IO.pure(Result<&1,&1,T.GitFail,T.WtStatus>, Done{T.Wt{"b", "c", False{}}}) : IO(Result<&1,&1,T.GitFail,T.WtStatus>)}

def m2_ws_done_answers_the_status():
  {==}

# M-2: a refused status answers the refusal, never a fabricated state.
law m2_ws_fail_answers_the_refusal:
  {WS.ws_answer(WS.WSFail{T.FCmd{"worktree-status", "x"}}) == IO.pure(Result<&1,&1,T.GitFail,T.WtStatus>, Fail{T.FCmd{"worktree-status", "x"}}) : IO(Result<&1,&1,T.GitFail,T.WtStatus>)}

def m2_ws_fail_answers_the_refusal():
  {==}

# M-14: a clean worktree at the expected commit reports no failure.
law m14_ws_clean_match_is_silent:
  {WS.status_clean_fail(Done{T.Wt{"b", "c", False{}}}, "c") == "" : String}

def m14_ws_clean_match_is_silent():
  {==}

# M-14: a dirty worktree names the dirt the check did not expect.
law m14_ws_clean_dirty_names_the_rule:
  {WS.status_clean_fail(Done{T.Wt{"b", "c", True{}}}, "c") == "status: worktree unexpectedly dirty" : String}

def m14_ws_clean_dirty_names_the_rule():
  {==}

# M-14: a worktree at another commit names the mismatch.
law m14_ws_clean_mismatch_names_the_rule:
  {WS.status_clean_fail(Done{T.Wt{"b", "other", False{}}}, "c") == "status: commit mismatch" : String}

def m14_ws_clean_mismatch_names_the_rule():
  {==}

# M-14: a touched worktree whose dirty flag is set reports no failure.
law m14_ws_dirty_present_is_silent:
  {WS.status_dirty_fail(Done{T.Wt{"b", "c", True{}}}, "c") == "" : String}

def m14_ws_dirty_present_is_silent():
  {==}

# M-14: a touched worktree whose dirty flag is missing names the rule.
law m14_ws_dirty_missing_names_the_rule:
  {WS.status_dirty_fail(Done{T.Wt{"b", "c", False{}}}, "c") == "status: dirty flag missing after touch" : String}

def m14_ws_dirty_missing_names_the_rule():
  {==}

# M-14: a refusal over the failing command stays silent only for that command.
law m14_ws_cmd_refusal_names_the_command:
  {WS.status_cmd_fail(Fail{T.FCmd{"worktree-status", Tx.cmd_failed("git status --porcelain")}}, "git status --porcelain") == "" : String}

def m14_ws_cmd_refusal_names_the_command():
  {==}

# M-14: an answer where a refusal was owed names the expectation.
law m14_ws_cmd_success_names_the_expectation:
  {WS.status_cmd_fail(Done{T.Wt{"b", "c", False{}}}, "git status --porcelain") == "status: expected a refusal for a path Git cannot read" : String}

def m14_ws_cmd_success_names_the_expectation():
  {==}

# ---------------------------------------------------------------------------
# Create-worktree: one worker branch and worktree from an explicit base. M-2
# carries the resolved base and the created identity into the answer; M-4
# keeps the resolved base when a later guard refuses instead of disposing it;
# M-14 names the taken branch, the taken path, the unknown base, or the git
# command that failed.

# M-2: the base a successful resolve read is the base the pipeline carries.
law m2_cw_stage1_ok_carries_the_resolved_base:
  {CW.cw_stage1_ok(True{}, "abc123\n", "main") == CW.CWNext{"abc123"} : CW.CW}

def m2_cw_stage1_ok_carries_the_resolved_base():
  {==}

# M-14: an unresolvable base names the base the caller supplied.
law m14_cw_stage1_fail_names_the_base:
  for +out: String
  for +base: String
  {CW.cw_stage1_ok(False{}, out, base) == CW.CWFail{T.FUnknownBase{base}} : CW.CW}

def m14_cw_stage1_fail_names_the_base(out, base):
  {==}

# M-14: a taken branch names the branch instead of reusing it.
law m14_cw_stage2_taken_names_the_branch:
  for +out: String
  for +bc: String
  for +branch: String
  {CW.cw_stage2_ok(True{}, out, bc, branch) == CW.CWFail{T.FBranchExists{branch}} : CW.CW}

def m14_cw_stage2_taken_names_the_branch(out, bc, branch):
  {==}

# M-4: a free branch keeps the resolved base the first stage made.
law m4_cw_stage2_free_keeps_the_base:
  for +out: String
  for +bc: String
  for +branch: String
  {CW.cw_stage2_ok(False{}, out, bc, branch) == CW.CWNext{bc} : CW.CW}

def m4_cw_stage2_free_keeps_the_base(out, bc, branch):
  {==}

# M-14: a taken path names the path instead of overwriting it.
law m14_cw_stage3_taken_names_the_path:
  for +bc: String
  for +path: String
  {CW.cw_stage3_ok(True{}, bc, path) == CW.CWFail{T.FPathExists{path}} : CW.CW}

def m14_cw_stage3_taken_names_the_path(bc, path):
  {==}

# M-4: a free path keeps the resolved base the earlier stages made.
law m4_cw_stage3_free_keeps_the_base:
  for +bc: String
  for +path: String
  {CW.cw_stage3_ok(False{}, bc, path) == CW.CWNext{bc} : CW.CW}

def m4_cw_stage3_free_keeps_the_base(bc, path):
  {==}

# M-2: a successful add answers the branch, the path and the resolved base.
law m2_cw_stage4_ok_answers_branch_path_and_base:
  for +out: String
  for +bc: String
  for +br: String
  for +p: String
  {CW.cw_stage4_ok(True{}, out, bc, br, p) == CW.CWDone{T.WCreated{br, p, bc}} : CW.CW}

def m2_cw_stage4_ok_answers_branch_path_and_base(out, bc, br, p):
  {==}

# M-14: a failed add names the git command that failed.
law m14_cw_stage4_fail_names_the_command:
  for +out: String
  for +bc: String
  for +br: String
  for +p: String
  {CW.cw_stage4_ok(False{}, out, bc, br, p) == CW.CWFail{T.FCmd{"create-worktree", Tx.cmd_failed("git worktree add")}} : CW.CW}

def m14_cw_stage4_fail_names_the_command(out, bc, br, p):
  {==}

# M-14: the branch-exists reader stays silent only for that refusal.
law m14_cw_branch_reader_names_the_branch:
  {CW.is_branch_exists_fail(Fail{T.FBranchExists{"b"}}) == "" : String}

def m14_cw_branch_reader_names_the_branch():
  {==}

# M-14: the path-exists reader stays silent only for that refusal.
law m14_cw_path_reader_names_the_path:
  {CW.is_path_exists_fail(Fail{T.FPathExists{"p"}}) == "" : String}

def m14_cw_path_reader_names_the_path():
  {==}

# M-14: the unknown-base reader stays silent only for that refusal.
law m14_cw_base_reader_names_the_base:
  {CW.is_unknown_base_fail(Fail{T.FUnknownBase{"base"}}) == "" : String}

def m14_cw_base_reader_names_the_base():
  {==}

# ---------------------------------------------------------------------------
# Debris: the added paths the repository's own rules exclude, removed from
# the index before the tree is written. M-4 keeps custody of the right index
# (the worktree's own when INDEX is empty, a named private file otherwise),
# names every dropped set on the answer, and drops nothing when nothing was
# excluded. M-18 does not apply here: no publication destination is chosen.

# M-4: an empty INDEX judges the worktree's own index in place.
law m4_debris_empty_index_uses_the_own_index:
  for +dir: String
  for args: List<String>
  {Deb.debris_argv(SNil{}, dir, args) == Con{"git", Con{"-C", Con{dir, args}}} : List<String>}

def m4_debris_empty_index_uses_the_own_index(dir, args):
  {==}

# M-4: a private INDEX names its file, so the worktree's index stays intact.
law m4_debris_private_index_is_named:
  for +dir: String
  for args: List<String>
  {Deb.debris_argv("priv", dir, args) == Con{"/usr/bin/env", Con{"GIT_INDEX_FILE=priv", Con{"git", Con{"-C", Con{dir, args}}}}} : List<String>}

def m4_debris_private_index_is_named(dir, args):
  {==}

# M-4: the dropped set is named as one space-joined line.
law m4_debris_note_names_the_dropped_set:
  {Deb.debris_note_of("a\nb\n") == "a b" : String}

def m4_debris_note_names_the_dropped_set():
  {==}

# M-4: a successful rm answers the judged set; the worktree files stay, only
# the index entries go.
law m4_debris_rm_names_the_judged_set:
  {Deb.debris_rm_pick(True{}, SNil{}, "a\nb\n") == IO.pure(Deb.Debris, Deb.DFine{"a b"}) : IO(Deb.Debris)}

def m4_debris_rm_names_the_judged_set():
  {==}

# M-4: a failed rm names the git command that failed, not a dropped set.
law m4_debris_rm_fail_names_the_command:
  for +out: String
  for +judged: String
  {Deb.debris_rm_pick(False{}, out, judged) == IO.pure(Deb.Debris, Deb.DFail{Tx.cmd_failed("git rm --cached")}) : IO(Deb.Debris)}

def m4_debris_rm_fail_names_the_command(out, judged):
  {==}

# M-4: no excluded path means a fine empty drop, never a failure.
law m4_debris_nothing_excluded_is_fine:
  for +out: String
  {Deb.debris_none(True{}, out) == IO.pure(Deb.Debris, Deb.DFine{""}) : IO(Deb.Debris)}

def m4_debris_nothing_excluded_is_fine(out):
  {==}

# M-4: a judgement that cannot be made fails the caller by name.
law m4_debris_judge_fail_names_the_command:
  for +out: String
  {Deb.debris_none(False{}, out) == IO.pure(Deb.Debris, Deb.DFail{Tx.cmd_failed("git check-ignore --no-index")}) : IO(Deb.Debris)}

def m4_debris_judge_fail_names_the_command(out):
  {==}

# M-4: no added paths means nothing to drop and nothing dropped.
law m4_debris_empty_added_drops_nothing:
  for +repo: String
  for +index: String
  for +dir: String
  {Deb.debris_judge(repo, index, dir, Nil{}) == IO.pure(Deb.Debris, Deb.DFine{""}) : IO(Deb.Debris)}

def m4_debris_empty_added_drops_nothing(repo, index, dir):
  {==}
