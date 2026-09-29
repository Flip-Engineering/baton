# CLAIM: the operative laws whose real functions live in bend2/src/git, each stated over the
# function that implements it and proved beside its claim. The coordinator laws module imports
# this module, and the coordinator entry imports that, so every compile of the entry verifies
# every law here.
#
# Two groups in this file are marked Supplementary in their own section comments: the seven laws
# over WS.status_clean_fail, WS.status_dirty_fail and WS.status_cmd_fail, and the three over
# CW.is_branch_exists_fail, CW.is_path_exists_fail and CW.is_unknown_base_fail. Those ten laws are
# over readers that only bend2/tests/git.bend calls. Their proofs are checked with every other
# law here, and they are not operative runtime coverage. Every other law in this file is stated
# over a function a command in the entry's import graph reaches.
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

# ---------------------------------------------------------------------------
# Supplementary. The seven status-reader laws below are stated over
# WS.status_clean_fail, WS.status_dirty_fail and WS.status_cmd_fail. Their
# proofs are checked with every other law in this file, and they are not
# operative runtime coverage: no command in the entry's import graph calls
# these readers, only the tree's own test entry bend2/tests/git.bend.
#
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

# ---------------------------------------------------------------------------
# Supplementary. The three reader laws below are stated over
# CW.is_branch_exists_fail, CW.is_path_exists_fail and CW.is_unknown_base_fail.
# Their proofs are checked with every other law in this file, and they are not
# operative runtime coverage: only the tree's own test entry calls them. The
# stage laws above them are operative, because createWorktree calls the stages.
#
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

# ---------------------------------------------------------------------------
# Landing pipeline, second increment: the judged pairing, the compare-and-swap
# advance, the outcome answers, the scratch-tree disposal, the push path and
# the both-trees check runs. Each law is stated over the function in
# land.bend that implements it.

# M-3a: the judged pair carries the candidate verdict and the target verdict
# for one selected file. A candidate failure the target run also shows is
# dropped; one the target does not show is named.

# M-3a: no candidate lines means the carried set is unchanged.
law m3a_no_candidates_leaves_acc:
  {L.new_lines_go(Nil{}, "targ", Con{"a", Nil{}}) == Con{"a", Nil{}} : List<String>}

def m3a_no_candidates_leaves_acc():
  {==}

# M-3a: a candidate failure line the target block shows is dropped.
law m3a_new_lines_shared_is_dropped:
  {L.new_lines_go(Con{"a", Nil{}}, "a", Nil{}) == Nil{} : List<String>}

def m3a_new_lines_shared_is_dropped():
  {==}

# M-3a: a candidate failure line the target block does not show is kept.
law m3a_new_lines_novel_is_kept:
  {L.new_lines_go(Con{"b", Nil{}}, "a", Nil{}) == Con{"b", Nil{}} : List<String>}

def m3a_new_lines_novel_is_kept():
  {==}

# M-3a: a candidate failure against a passing target run always blocks and
# names the uncovered line.
law m3a_uncovered_target_blocks:
  for hex: String
  for file: String
  for acc: List<String>
  {L.pair_targ(hex, L.VPass{}, file, acc) == Con{"?uncovered: " ++ hex, acc} : List<String>}

def m3a_uncovered_target_blocks(hex, file, acc):
  {==}

# M-3a: a candidate failure the target failure block shows contributes nothing.
law m3a_target_failure_compares_same_block:
  {L.pair_targ("a", L.VFail{"a"}, "f", Nil{}) == Nil{} : List<String>}

def m3a_target_failure_compares_same_block():
  {==}

# M-3a: a candidate failure the target failure block does not show is named.
law m3a_target_missing_failure_is_named:
  {L.pair_targ("b", L.VFail{"a"}, "f", Nil{}) == Con{"b", Nil{}} : List<String>}

def m3a_target_missing_failure_is_named():
  {==}

# M-3a: no paired files means no blocking lines.
law m3a_pairs_news_empty_is_empty:
  {L.pairs_news(Nil{}) == Nil{} : List<String>}

def m3a_pairs_news_empty_is_empty():
  {==}

# M-3a: a file that passed on the candidate contributes nothing, whatever the
# target verdict is.
law m3a_pairs_news_pass_is_silent:
  for f: String
  for tv: L.Verdict
  {L.pairs_news(Con{L.PV{f, L.VPass{}, tv}, Nil{}}) == Nil{} : List<String>}

def m3a_pairs_news_pass_is_silent(f, tv):
  {==}

# M-3a: the advance checks the basis it prepared the candidate against. A
# target that is not a fast-forward of the basis blocks instead of moving.
law m3a_ff_not_fastforward_blocks:
  for wc: String
  for tb: String
  {L.ff_stage4_ff(False{}, wc, tb) == L.FFDone{T.LBlocked{"not a fast-forward; rebase the worker branch onto the target"}} : L.FFLD}

def m3a_ff_not_fastforward_blocks(wc, tb):
  {==}

# M-3a: a target that is a fast-forward of the basis carries the pair on.
law m3a_ff_fastforward_carries_pair:
  for wc: String
  for tb: String
  {L.ff_stage4_ff(True{}, wc, tb) == L.FFNext{wc, tb} : L.FFLD}

def m3a_ff_fastforward_carries_pair(wc, tb):
  {==}

# M-3a: every blocking line the judging named blocks the landing with its
# content.
law m3a_judged_block_names_news:
  for repo: String
  for target: String
  for scratch: String
  for tip: String
  for cand: String
  {L.ld_judged_news(Con{"x", Nil{}}, repo, target, scratch, tip, cand) == IO.pure(L.Ld, L.LdDone{T.LBlocked{"new failures: x"}}) : IO(L.Ld)}

def m3a_judged_block_names_news(repo, target, scratch, tip, cand):
  {==}

# M-3a: a passing gate carries its candidate and target basis into publication.
law m3a_checked_pair_reaches_publication:
  for repo: String
  for target: String
  for scratch: String
  for tip: String
  for cand: String
  {L.ld_judged_news(Nil{}, repo, target, scratch, tip, cand) == L.ld_advance(repo, target, cand, tip) : IO(L.Ld)}

def m3a_checked_pair_reaches_publication(repo, target, scratch, tip, cand):
  {==}

# M-3a: the command names the candidate and the expected old target exactly.
law m3a_cas_argv_binds_checked_pair:
  for target: String
  for cand: String
  for basis: String
  {L.ld_update_argv(target, cand, basis) == ["update-ref", "refs/heads/" ++ target, cand, basis] : List<String>}

def m3a_cas_argv_binds_checked_pair(target, cand, basis):
  {==}

# The production effect invokes Git with that exact pair. Git's atomic old-value
# comparison and the host's report of its exit status remain boundary assumptions.
def checked_pair_update(repo: String, +target: String, +cand: String, basis: String) -> IO(L.Ld):
  do IO<L.Ld>:
    g : T.GitOut <- P.runGit(repo, ["update-ref", "refs/heads/" ++ target, cand, basis])
    IO.pure(L.Ld, L.ld_update_pick(g, target, cand))

law m3a_publication_invokes_checked_pair:
  for repo: String
  for target: String
  for cand: String
  for basis: String
  {L.ld_adv_update(repo, target, cand, basis) == checked_pair_update(repo, target, cand, basis) : IO(L.Ld)}

def m3a_publication_invokes_checked_pair(repo, target, cand, basis):
  {==}

# ---------------------------------------------------------------------------
# M-3b: publication compares the target against the basis that was checked.

# M-3a: a changed target returns a retry result with no publication effect.
law m3a_changed_basis_requires_new_check:
  for repo: String
  for target: String
  for cand: String
  for basis: String
  {L.ld_adv_same(False{}, repo, target, cand, basis) == IO.pure(L.Ld, L.LdDone{T.LBlocked{"target moved during checked landing; rerun land-checked to prepare and check against the current target"}}) : IO(L.Ld)}

def m3a_changed_basis_requires_new_check(repo, target, cand, basis):
  {==}

# M-3b: a compare-and-swap that still matches the basis lands the candidate.
law m3b_cas_success_lands:
  for out: String
  for target: String
  for cand: String
  {L.ld_update_ok(True{}, out, target, cand) == L.LdDone{T.LLanded{target, cand}} : L.Ld}

def m3b_cas_success_lands(out, target, cand):
  {==}

# M-3b: a failed compare-and-swap names the failure and requires a fresh check.
law m3b_failed_cas_requires_new_check:
  for out: String
  for target: String
  for cand: String
  {L.ld_update_ok(False{}, out, target, cand) == L.LdFail{T.FCmd{"land", "git update-ref failed; inspect the target and rerun land-checked to prepare and check a new candidate"}} : L.Ld}

def m3b_failed_cas_requires_new_check(out, target, cand):
  {==}

# M-3b: an advance the host never started is a failure, never a landing.
law m3b_update_broken_is_not_a_landing:
  for detail: String
  for target: String
  for cand: String
  {L.ld_update_pick(T.GBroken{detail}, target, cand) == L.LdFail{T.FCmd{"land", detail}} : L.Ld}

def m3b_update_broken_is_not_a_landing(detail, target, cand):
  {==}

# M-3b: the fast-forward compare-and-swap lands while the target is still at
# the recorded tip.
law m3b_ff_cas_success_lands:
  for wc: String
  for target: String
  {L.ff_stage5_ok(True{}, wc, target) == L.FFDone{T.LLanded{target, wc}} : L.FFLD}

def m3b_ff_cas_success_lands(wc, target):
  {==}

# M-3b: the fast-forward compare-and-swap refuses when the target moved.
law m3b_ff_cas_miss_refuses_retry:
  for wc: String
  for target: String
  {L.ff_stage5_ok(False{}, wc, target) == L.FFDone{T.LBlocked{"target moved during landing; retry"}} : L.FFLD}

def m3b_ff_cas_miss_refuses_retry(wc, target):
  {==}

# ---------------------------------------------------------------------------
# M-3c: the answer names the outcome actually reached.

# M-3c: a conflict answers conflict, naming the unmerged files and the tree
# that keeps them.
law m3c_conflict_answers_conflict:
  for files: String
  for dir: String
  {L.outcome_json(T.LConflict{files, dir}) == "{\"status\":\"conflict\",\"files\":\"" ++ files ++ "\",\"dir\":\"" ++ dir ++ "\"}" : String}

def m3c_conflict_answers_conflict(files, dir):
  {==}

# M-3c: a finished fast-forward stage answers the outcome it reached.
law m3c_ff_done_answers_its_outcome:
  for outcome: T.LandOutcome
  {L.ff_answer(L.FFDone{outcome}) == IO.pure(T.LandOutcome, outcome) : IO(T.LandOutcome)}

def m3c_ff_done_answers_its_outcome(outcome):
  {==}

# M-3c: an unfinished fast-forward stage answers a refusal, never an effect.
law m3c_ff_next_is_not_an_effect:
  for wc: String
  for tb: String
  {L.ff_answer(L.FFNext{wc, tb}) == IO.pure(T.LandOutcome, T.LBlocked{"unreachable stage"}) : IO(T.LandOutcome)}

def m3c_ff_next_is_not_an_effect(wc, tb):
  {==}

# ---------------------------------------------------------------------------
# M-4: a landing that answers landed or already removes exactly the candidate
# and target scratch worktrees it prepared, and a refused, conflicted or
# failed landing keeps them.

# M-4: the settled trees are exactly the candidate and its "-target" sibling.
law m4_settle_paths_are_exactly_the_two_trees:
  for +s: String
  {L.settle_paths(s) == Con{s, Con{s ++ "-target", Nil{}}} : List<String>}

def m4_settle_paths_are_exactly_the_two_trees(s):
  {==}

# M-4: a conflicted landing keeps the trees that carry the unmerged paths.
law m4_conflict_keeps_the_trees:
  for files: String
  for dir: String
  for repo: String
  for scratch: String
  {L.ld_settle(L.LdDone{T.LConflict{files, dir}}, repo, scratch) == IO.pure(L.Ld, L.LdDone{T.LConflict{files, dir}}) : IO(L.Ld)}

def m4_conflict_keeps_the_trees(files, dir, repo, scratch):
  {==}

# M-4: a refused landing keeps the trees for the requester.
law m4_blocked_keeps_the_trees:
  for reason: String
  for repo: String
  for scratch: String
  {L.ld_settle(L.LdDone{T.LBlocked{reason}}, repo, scratch) == IO.pure(L.Ld, L.LdDone{T.LBlocked{reason}}) : IO(L.Ld)}

def m4_blocked_keeps_the_trees(reason, repo, scratch):
  {==}

# M-4: a failed landing keeps the trees for the requester.
law m4_failed_keeps_the_trees:
  for fail: T.GitFail
  for repo: String
  for scratch: String
  {L.ld_settle(L.LdFail{fail}, repo, scratch) == IO.pure(L.Ld, L.LdFail{fail}) : IO(L.Ld)}

def m4_failed_keeps_the_trees(fail, repo, scratch):
  {==}

# ---------------------------------------------------------------------------
# M-18: the push runs at the destination the argv names. The push argv is
# formed once, by L.push_argv, and the push effect runs exactly that argv.
# The destination-position claim is carried by the full equation at the top of
# this file, which names the remote and the branch in their positions; no
# helper function exists only to read one position out.

# M-18: the push effect runs the argv the declared remote and branch form.
law m18_the_push_runs_the_declared_argv:
  for repo: String
  for branch: String
  for remote: String
  {L.push_git(repo, branch, remote) == P.runGit(repo, L.push_argv(branch, remote)) : IO(T.GitOut)}

def m18_the_push_runs_the_declared_argv(repo, branch, remote):
  {==}

# M-18: the destination position of that argv holds the declared remote, read
# through Base's own list readers.
law m18_the_destination_position_holds_the_declared_remote:
  for branch: String
  for remote: String
  {List.head(&1, String, List.tail(&1, String, L.push_argv(branch, remote))) == Some{remote} : Maybe<String>}

def m18_the_destination_position_holds_the_declared_remote(branch, remote):
  {==}

# ---------------------------------------------------------------------------
# M-10: every selected file runs on both trees, and every candidate failure
# the target does not show is named. The pairing recurses over the whole
# selection with no count or clock.

# M-10: one new candidate failure is named.
law m10_pairs_news_names_every_new_failure:
  {L.pairs_news(Con{L.PV{"f", L.VFail{"b"}, L.VFail{"a"}}, Nil{}}) == Con{"b", Nil{}} : List<String>}

def m10_pairs_news_names_every_new_failure():
  {==}

# M-10: every selected file is judged; no file is truncated.
law m10_pairs_news_runs_every_selected_file:
  {L.pairs_news(Con{L.PV{"f", L.VFail{"b"}, L.VFail{"a"}}, Con{L.PV{"g", L.VFail{"c"}, L.VFail{""}}, Nil{}}}) == Con{"c", Con{"b", Nil{}}} : List<String>}

def m10_pairs_news_runs_every_selected_file():
  {==}

# M-10: a target tree that could not be prepared fails the attempt by name.
law m10_target_tree_failure_blocks:
  for repo: String
  for target: String
  for script: String
  for files: List<String>
  for scratch: String
  for tip: String
  for cand: String
  for tw: String
  {L.ld_tree_runs(False{}, repo, target, script, files, scratch, tip, cand, tw) == IO.pure(L.Ld, L.LdFail{T.FCmd{"land", "target worktree failed"}}) : IO(L.Ld)}

def m10_target_tree_failure_blocks(repo, target, script, files, scratch, tip, cand, tw):
  {==}

# M-10: an unjudged candidate run blocks and names the file and its cause.
law m10_unjudged_candidate_names_file_and_cause:
  {L.pairs_news(Con{L.PV{"f", L.VNone{"why"}, L.VPass{}}, Nil{}}) == Con{"?unjudged candidate: f: why", Nil{}} : List<String>}

def m10_unjudged_candidate_names_file_and_cause():
  {==}

# ---------------------------------------------------------------------------
# M-10: the checked trees carry the check execution into the verdict. Stage 6
# prepares the target tree as the candidate scratch tree's "-target" sibling,
# the selected checks run on those two trees, and the pairs the checks produced
# are the ones the verdict judges. Each right-hand side below is written here
# independently of the function it judges. The publication argv and the advance
# that runs it are stated above under M-3a.

# M-10: every selected file runs on the candidate tree first and on the target
# tree second, and each pair carries that file's own two verdicts. The step is
# composed here independently of L.run_pair_go, so a run that reads the other
# tree, drops a file or pairs the file with the other tree's verdict breaks this
# proof. The same step holds at every position of the selection, because the
# tail stays the production recursion.
def run_pair_step_of(script: String, file: String, rest: List<String>, candTree: String, targTree: String) -> IO(List<L.PV>):
  +s2 = script
  +ct2 = candTree
  +tt2 = targTree
  +f2 = file
  do IO<List<L.PV>>:
    cfv : L.FV <- L.run_check(ct2, s2, f2)
    tfv : L.FV <- L.run_check(tt2, s2, f2)
    L.run_pair_go(s2, rest, ct2, tt2, Con{L.PV{f2, L.fv_verdict(cfv), L.fv_verdict(tfv)}, Nil{}})

law m10_run_pairs_checks_each_file_on_its_own_tree:
  for script: String
  for file: String
  for rest: List<String>
  for candTree: String
  for targTree: String
  {L.run_pair_go(script, Con{file, rest}, candTree, targTree, Nil{}) == run_pair_step_of(script, file, rest, candTree, targTree) : IO(List<L.PV>)}

def m10_run_pairs_checks_each_file_on_its_own_tree(script, file, rest, candTree, targTree):
  {==}

# M-10: the candidate tree that is checked is the scratch tree, the target tree
# is its "-target" sibling, and the pairs reach the verdict unchanged.
def ld_tree_judged(repo: String, target: String, script: String, files: List<String>, scratch: String, tip: String, cand: String, tw: String) -> IO(L.Ld):
  +s2 = scratch
  do IO<L.Ld>:
    pvs : List<L.PV> <- L.run_pairs(script, files, s2, tw)
    L.ld_judged(pvs, repo, target, s2, tip, cand)

law m10_the_candidate_tree_and_the_target_sibling_are_judged:
  for repo: String
  for target: String
  for script: String
  for files: List<String>
  for scratch: String
  for tip: String
  for cand: String
  for tw: String
  {L.ld_tree_runs(True{}, repo, target, script, files, scratch, tip, cand, tw) == ld_tree_judged(repo, target, script, files, scratch, tip, cand, tw) : IO(L.Ld)}

def m10_the_candidate_tree_and_the_target_sibling_are_judged(repo, target, script, files, scratch, tip, cand, tw):
  {==}

# M-10: the verdict judges the pairs the checks produced, and nothing else.
law m10_the_verdict_judges_the_pairs_the_checks_produced:
  for pvs: List<L.PV>
  for repo: String
  for target: String
  for scratch: String
  for tip: String
  for cand: String
  {L.ld_judged(pvs, repo, target, scratch, tip, cand) == L.ld_judged_news(L.pairs_news(pvs), repo, target, scratch, tip, cand) : IO(L.Ld)}

def m10_the_verdict_judges_the_pairs_the_checks_produced(pvs, repo, target, scratch, tip, cand):
  {==}

# M-10: stage 6 prepares one detached tree at the target tip, named as the
# candidate scratch tree's "-target" sibling, and checks through it.
def stage_six_checks_the_sibling(repo: String, target: String, script: String, files: List<String>, scratch: String, tip: String, cand: String) -> IO(L.Ld):
  +r2 = repo
  +sc = scratch
  +t2 = tip
  +tw = Tx.str_cat(sc, "-target")
  do IO<L.Ld>:
    g : T.GitOut <- P.runGit(r2, ["worktree", "add", "--detach", tw, t2])
    L.ld_tree_ok(g, r2, target, script, files, sc, t2, cand, tw)

law m10_stage_six_checks_the_prepared_target_sibling:
  for repo: String
  for target: String
  for script: String
  for files: List<String>
  for scratch: String
  for tip: String
  for cand: String
  {L.ld_stage6(repo, target, script, files, scratch, tip, cand) == stage_six_checks_the_sibling(repo, target, script, files, scratch, tip, cand) : IO(L.Ld)}

def m10_stage_six_checks_the_prepared_target_sibling(repo, target, script, files, scratch, tip, cand):
  {==}

# M-10: the prepared worktree's result decides whether the checks run. A zero
# exit runs them on the trees stage 6 prepared; any other status fails the
# attempt by name, so no check ever runs against a tree that was not prepared.
law m10_prepared_tree_runs_the_checks:
  for out: String
  for repo: String
  for target: String
  for script: String
  for files: List<String>
  for scratch: String
  for tip: String
  for cand: String
  for tw: String
  {L.ld_tree_ok(T.GRun{0, out}, repo, target, script, files, scratch, tip, cand, tw) == L.ld_tree_runs(True{}, repo, target, script, files, scratch, tip, cand, tw) : IO(L.Ld)}

def m10_prepared_tree_runs_the_checks(out, repo, target, script, files, scratch, tip, cand, tw):
  {==}

law m10_unprepared_tree_blocks_by_name:
  for out: String
  for repo: String
  for target: String
  for script: String
  for files: List<String>
  for scratch: String
  for tip: String
  for cand: String
  for tw: String
  {L.ld_tree_ok(T.GRun{1, out}, repo, target, script, files, scratch, tip, cand, tw) == IO.pure(L.Ld, L.LdFail{T.FCmd{"land", "target worktree failed"}}) : IO(L.Ld)}

def m10_unprepared_tree_blocks_by_name(out, repo, target, script, files, scratch, tip, cand, tw):
  {==}
