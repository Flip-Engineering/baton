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

# M-5: the tab splitter separates the two fields of one ls-remote record.
law m5_tx_split_tabs_separates_the_record_fields:
  {Tx.split_tabs("ab\tcd") == Con{"ab", Con{"cd", Nil{}}} : List<String>}

def m5_tx_split_tabs_separates_the_record_fields():
  {==}

# M-5: no input fields means no fields out.
law m5_tx_no_fields_from_empty_tabs:
  {Tx.split_tabs(SNil{}) == Nil{} : List<String>}

def m5_tx_no_fields_from_empty_tabs():
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

# M-3a: the fast-forward landing runs its stages in order and answers the
# outcome it reached. The composition is written here independently of
# L.land_fast_forward, so an entry that dropped a stage, reordered two, or
# answered without running the last one breaks this proof. The reviewed-commit
# entry shares ff_stage2 to ff_stage5 with this pipeline, so the advance and its
# answer are the same functions there.
def fast_forward_stages(repo: String, workerBranch: String, target: String) -> IO(T.LandOutcome):
  +rp = repo
  +tg = target
  do IO<T.LandOutcome>:
    r1 : L.FFLD <- L.ff_stage1(rp, workerBranch)
    r2 : L.FFLD <- L.ff_go2(r1, rp, tg)
    r3 : L.FFLD <- L.ff_go3(r2, rp, tg)
    r4 : L.FFLD <- L.ff_go4(r3, rp, tg)
    r5 : L.FFLD <- L.ff_go5(r4, rp, tg)
    L.ff_answer(r5)

law m3a_the_fast_forward_landing_runs_every_stage_in_order:
  for repo: String
  for workerBranch: String
  for target: String
  {L.land_fast_forward(repo, workerBranch, target) == fast_forward_stages(repo, workerBranch, target) : IO(T.LandOutcome)}

def m3a_the_fast_forward_landing_runs_every_stage_in_order(repo, workerBranch, target):
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
def checked_pair_update(repo: String, +target: String, +cand: String, basis: String) -> IO(L.LAdv):
  do IO<L.LAdv>:
    g : T.GitOut <- P.runGit(repo, ["update-ref", "refs/heads/" ++ target, cand, basis])
    IO.pure(L.LAdv, L.ld_adv_cas(g))

law m3a_publication_invokes_checked_pair:
  for repo: String
  for target: String
  for cand: String
  for basis: String
  {L.ld_adv_cas_run(repo, target, cand, basis) == checked_pair_update(repo, target, cand, basis) : IO(L.LAdv)}

def m3a_publication_invokes_checked_pair(repo, target, cand, basis):
  {==}

# ---------------------------------------------------------------------------
# M-3c and M-3a: the checked landing's own composition and the answer it
# returns. The stages and the publication are bound above; these laws bind the
# sequence that runs them and the mapping from the pipeline's state to the
# caller's answer. Git's work inside each stage, its object identites and the
# host's report of each exit status remain host assumptions.

# M-3a: the checked landing calls each stage dispatch entry once, in its own
# order, on the candidate and target trees its arguments name. The composition
# is written here independently of L.land_checked, so a composition that dropped
# an entry, reordered two, or handed an entry the other tree's path breaks this
# proof. What each entry does with the state it is handed is a separate
# obligation, bound by the m10 laws over the ld_go entries.
def checked_landing_stages(repo: String, target: String, worker: String, script: String, files: List<String>, scratch: String) -> IO(Result<&1, &1, T.GitFail, T.LandOutcome>):
  +r2 = repo
  +t2 = target
  +k2 = script
  +s2 = scratch
  do IO<Result<&1, &1, T.GitFail, T.LandOutcome>>:
    a : L.Ld <- L.ld_stage1(r2, t2, worker)
    b : L.Ld <- L.ld_go1(a, r2, t2)
    c : L.Ld <- L.ld_go2(b, r2, s2)
    d : L.Ld <- L.ld_go3(c, s2)
    e : L.Ld <- L.ld_go4(d, r2, s2)
    f : L.Ld <- L.ld_go5(e, r2, t2, k2, files, s2)
    settled : L.Ld <- L.ld_settle(f, r2, s2)
    L.ld_answer(settled)

law m3a_the_checked_landing_runs_every_stage_in_order:
  for repo: String
  for target: String
  for worker: String
  for script: String
  for files: List<String>
  for scratch: String
  {L.land_checked(repo, target, worker, script, files, scratch) == checked_landing_stages(repo, target, worker, script, files, scratch) : IO(Result<&1, &1, T.GitFail, T.LandOutcome>)}

def m3a_the_checked_landing_runs_every_stage_in_order(repo, target, worker, script, files, scratch):
  {==}

# M-3c: a landed state answers landed with its own outcome, and a failed state
# answers its own failure.
law m3c_a_landed_state_answers_its_own_outcome:
  for target: String
  for commit: String
  {L.ld_answer(L.LdDone{T.LLanded{target, commit}}) == IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Done{T.LLanded{target, commit}}) : IO(Result<&1, &1, T.GitFail, T.LandOutcome>)}

def m3c_a_landed_state_answers_its_own_outcome(target, commit):
  {==}

law m3c_a_failed_state_answers_its_own_failure:
  for fail: T.GitFail
  {L.ld_answer(L.LdFail{fail}) == IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Fail{fail}) : IO(Result<&1, &1, T.GitFail, T.LandOutcome>)}

def m3c_a_failed_state_answers_its_own_failure(fail):
  {==}

# M-3c: the three states a stage leaves behind when the landing stopped before
# it finished are not outcomes. The answer names that fact and the stage.
law m3c_a_resolved_worker_alone_is_not_an_outcome:
  for worker: String
  for sha: String
  {L.ld_answer(L.LdWk{worker, sha}) == IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Fail{T.FCmd{"land", "unreachable stage"}}) : IO(Result<&1, &1, T.GitFail, T.LandOutcome>)}

def m3c_a_resolved_worker_alone_is_not_an_outcome(worker, sha):
  {==}

law m3c_a_prepared_tip_alone_is_not_an_outcome:
  for worker: String
  for sha: String
  for tip: String
  {L.ld_answer(L.LdTip{worker, sha, tip}) == IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Fail{T.FCmd{"land", "unreachable stage"}}) : IO(Result<&1, &1, T.GitFail, T.LandOutcome>)}

def m3c_a_prepared_tip_alone_is_not_an_outcome(worker, sha, tip):
  {==}

law m3c_a_prepared_candidate_alone_is_not_an_outcome:
  for tip: String
  for cand: String
  {L.ld_answer(L.LdCand{tip, cand}) == IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Fail{T.FCmd{"land", "unreachable stage"}}) : IO(Result<&1, &1, T.GitFail, T.LandOutcome>)}

def m3c_a_prepared_candidate_alone_is_not_an_outcome(tip, cand):
  {==}

# ---------------------------------------------------------------------------
# M-3a and M-3b: the target's advance. The advance reads the target tip and
# moves the branch only while it still reads as the basis that was checked, and
# a target a worktree holds moves through that worktree so the branch, the
# index and the files move together. Git's own work inside each effect, its
# object identities, its refusal of an overlapping uncommitted change and the
# host's report of each exit status remain boundary assumptions.

# M-3a: a changed target answers the movement and touches nothing.
law m3a_changed_basis_requires_new_check:
  for repo: String
  for target: String
  for cand: String
  for basis: String
  {L.ld_adv_same(False{}, repo, target, cand, basis) == IO.pure(L.LAdv, L.AdvMoved{}) : IO(L.LAdv)}

def m3a_changed_basis_requires_new_check(repo, target, cand, basis):
  {==}

# M-3a: a target tip that no longer matches the basis answers the movement
# without reading a worktree or running any effect.
law m3a_moved_tip_has_no_effect:
  for repo: String
  for target: String
  for cand: String
  {L.ld_adv_pick(T.GRun{0, "moved"}, repo, target, cand, "basis") == IO.pure(L.LAdv, L.AdvMoved{}) : IO(L.LAdv)}

def m3a_moved_tip_has_no_effect(repo, target, cand):
  {==}

# M-3a: the moved-target block names the next checked attempt, so the operator
# reads the operation that resolves it.
law m3a_moved_block_names_the_next_check:
  for target: String
  for cand: String
  {L.ld_adv_answer(L.AdvMoved{}, target, cand) == L.LdDone{T.LBlocked{"target moved during checked landing; rerun land-checked to prepare and check against the current target"}} : L.Ld}

def m3a_moved_block_names_the_next_check(target, cand):
  {==}

# M-3a: the advance reads the target commit itself, not a working tree, a
# branch name or any other resolution of the target.
law m3a_the_advance_reads_the_target_commit:
  for target: String
  {L.ld_tip_argv(target) == ["rev-parse", "--verify", target ++ "^{commit}"] : List<String>}

def m3a_the_advance_reads_the_target_commit(target):
  {==}

# The production advance reads that tip first and hands the read to the pick,
# so no update can start against a target the attempt never compared.
def advance_read(+repo: String, +target: String, +cand: String, +basis: String) -> IO(L.LAdv):
  do IO<L.LAdv>:
    g : T.GitOut <- P.runGit(repo, ["rev-parse", "--verify", target ++ "^{commit}"])
    L.ld_adv_pick(g, repo, target, cand, basis)

law m3a_the_advance_reads_the_tip_before_any_update:
  for repo: String
  for target: String
  for cand: String
  for basis: String
  {L.ld_adv_run(repo, target, cand, basis) == advance_read(repo, target, cand, basis) : IO(L.LAdv)}

def m3a_the_advance_reads_the_tip_before_any_update(repo, target, cand, basis):
  {==}

# M-3b: a compare-and-swap that still matches the basis lands the candidate,
# and the checked landing answers that landing with the candidate it moved to.
law m3b_cas_success_lands:
  for out: String
  for target: String
  for cand: String
  {L.ld_adv_answer(L.ld_adv_cas(T.GRun{0, out}), target, cand) == L.LdDone{T.LLanded{target, cand}} : L.Ld}

def m3b_cas_success_lands(out, target, cand):
  {==}

# M-3b: a failed compare-and-swap names the failure and requires a fresh check.
law m3b_failed_cas_requires_new_check:
  for out: String
  for target: String
  for cand: String
  {L.ld_adv_answer(L.ld_adv_cas(T.GRun{1, out}), target, cand) == L.LdFail{T.FCmd{"land", "git update-ref failed; inspect the target and rerun land-checked to prepare and check a new candidate"}} : L.Ld}

def m3b_failed_cas_requires_new_check(out, target, cand):
  {==}

# M-3b: an advance the host never started is a failure, never a landing.
law m3b_update_broken_is_not_a_landing:
  for detail: String
  for target: String
  for cand: String
  {L.ld_adv_answer(L.ld_adv_cas(T.GBroken{detail}), target, cand) == L.LdFail{T.FCmd{"land", detail}} : L.Ld}

def m3b_update_broken_is_not_a_landing(detail, target, cand):
  {==}

# M-3a: the advance moves a target a worktree holds through that worktree, and
# a target no worktree holds through the checked compare-and-swap. An unusable
# listing moves nothing at all.
law m3a_no_holder_uses_the_checked_pair:
  for repo: String
  for target: String
  for cand: String
  for basis: String
  {L.ld_adv_holder(L.HoldNone{}, repo, target, cand, basis) == L.ld_adv_cas_run(repo, target, cand, basis) : IO(L.LAdv)}

def m3a_no_holder_uses_the_checked_pair(repo, target, cand, basis):
  {==}

law m3a_holder_advances_through_its_own_worktree:
  for path: String
  for repo: String
  for target: String
  for cand: String
  for basis: String
  {L.ld_adv_holder(L.HoldPath{path}, repo, target, cand, basis) == L.ld_adv_wt(path, repo, target, cand, basis) : IO(L.LAdv)}

def m3a_holder_advances_through_its_own_worktree(path, repo, target, cand, basis):
  {==}

law m3a_unusable_listing_advances_nothing:
  for detail: String
  for repo: String
  for target: String
  for cand: String
  for basis: String
  {L.ld_adv_holder(L.HoldBlocked{detail}, repo, target, cand, basis) == IO.pure(L.LAdv, L.AdvBroken{detail}) : IO(L.LAdv)}

def m3a_unusable_listing_advances_nothing(detail, repo, target, cand, basis):
  {==}

# The production effect for a held target is Git's own fast-forward inside the
# worktree that holds it, which is what makes the branch, the index and the
# files move together and keeps that worktree's uncommitted work.
def held_pair_update(+path: String, +repo: String, +target: String, +cand: String, +basis: String) -> IO(L.LAdv):
  do IO<L.LAdv>:
    g : T.GitOut <- P.runGit(path, ["merge", "--ff-only", cand])
    L.ld_adv_wt_pick(g, path, repo, target, cand, basis)

law m3a_held_advance_is_the_worktree_fast_forward:
  for path: String
  for repo: String
  for target: String
  for cand: String
  for basis: String
  {L.ld_adv_wt(path, repo, target, cand, basis) == held_pair_update(path, repo, target, cand, basis) : IO(L.LAdv)}

def m3a_held_advance_is_the_worktree_fast_forward(path, repo, target, cand, basis):
  {==}

# The held success arm dispatches through the source-bound publication
# observer; a zero exit from merge alone is not a landed answer.

# The observer proves the states the coordinator read. Git CLI cannot pin
# symbolic HEAD atomically across its final check and merge: a branch switch in
# that interval can make merge update another branch. The post-read refuses a
# landed answer on observed drift, but it cannot undo a concurrent ref update.
def held_success_arm(g: T.GitOut, path: String, repo: String, target: String, cand: String, basis: String) -> IO(L.LAdv):
  match g:
    case T.GRun{code, out}:
      +p2 = path
      +r2 = repo
      +t2 = target
      +c2 = cand
      +b2 = basis
      Bool.pick(IO(L.LAdv), U32.is_eq(code, 0),
        L.ld_adv_wt_observe(p2, r2, t2, c2),
        L.ld_adv_wt_refused(p2, r2, t2, b2))
    case T.GBroken{detail}: IO.pure(L.LAdv, L.AdvBroken{detail})

law m3a_held_success_arm_uses_publication_observation:
  for +g: T.GitOut
  for path: String
  for repo: String
  for target: String
  for cand: String
  for basis: String
  {L.ld_adv_wt_pick(g, path, repo, target, cand, basis) == held_success_arm(g, path, repo, target, cand, basis) : IO(L.LAdv)}

def m3a_held_success_arm_uses_publication_observation(g, path, repo, target, cand, basis):
  {==}

def held_success_observation(path: String, repo: String, target: String, cand: String) -> IO(L.LAdv):
  +p2 = path
  +r2 = repo
  +t2 = target
  +c2 = cand
  do IO<L.LAdv>:
    tip : T.GitOut <- P.runGit(r2, L.ld_target_ref_argv(t2))
    L.ld_adv_wt_observed_target_pick(tip, p2, t2, c2)

law m3a_held_success_observation_reads_the_target_ref:
  for path: String
  for repo: String
  for target: String
  for cand: String
  {L.ld_adv_wt_observe(path, repo, target, cand) == held_success_observation(path, repo, target, cand) : IO(L.LAdv)}

def m3a_held_success_observation_reads_the_target_ref(path, repo, target, cand):
  {==}

def held_target_observation_same(same: Bool, path: String, target: String) -> IO(L.LAdv):
  match same:
    case False{}: IO.pure(L.LAdv, L.AdvMoved{})
    case True{}:
      +p2 = path
      +t2 = target
      do IO<L.LAdv>:
        holder : T.GitOut <- P.runGit(p2, L.ld_head_argv())
        L.ld_adv_wt_observed_holder_pick(holder, p2, t2)

def held_target_observation(g: T.GitOut, path: String, target: String, cand: String) -> IO(L.LAdv):
  match g:
    case T.GRun{code, out}:
      +status_ok = U32.is_eq(code, 0)
      +same = Bool.pick(Bool, status_ok, Tx.str_eq(Tx.trim_nl(out), cand), False{})
      held_target_observation_same(same, path, target)
    case T.GBroken{detail}: IO.pure(L.LAdv, L.AdvBroken{detail})

law m3a_held_target_observation_requires_the_candidate_tip:
  for +g: T.GitOut
  for path: String
  for target: String
  for cand: String
  {L.ld_adv_wt_observed_target_pick(g, path, target, cand) == held_target_observation(g, path, target, cand) : IO(L.LAdv)}

def m3a_held_target_observation_requires_the_candidate_tip(g, path, target, cand):
  {==}

def held_holder_observation(g: T.GitOut, path: String, target: String) -> IO(L.LAdv):
  match g:
    case T.GRun{code, out}:
      +status_ok = U32.is_eq(code, 0)
      +same = Bool.pick(Bool, status_ok,
        Tx.str_eq(Tx.trim_nl(out), L.ld_hold_ref(target)), False{})
      IO.pure(L.LAdv, L.ld_adv_wt_observed(True{}, same, path))
    case T.GBroken{detail}: IO.pure(L.LAdv, L.AdvBroken{detail})

law m3a_held_holder_observation_requires_the_target_branch:
  for +g: T.GitOut
  for path: String
  for target: String
  {L.ld_adv_wt_observed_holder_pick(g, path, target) == held_holder_observation(g, path, target) : IO(L.LAdv)}

def m3a_held_holder_observation_requires_the_target_branch(g, path, target):
  {==}

law m3a_held_tip_read_names_the_local_branch:
  {L.ld_target_ref_argv("main") == ["rev-parse", "--verify", "refs/heads/main^{commit}"] : List<String>}

def m3a_held_tip_read_names_the_local_branch():
  {==}

law m3a_held_identity_read_uses_symbolic_head:
  {L.ld_head_argv() == ["symbolic-ref", "--quiet", "HEAD"] : List<String>}

def m3a_held_identity_read_uses_symbolic_head():
  {==}

# M-3a: a refused fast-forward of a target that still reads as the basis is that
# worktree's own state. The answer names the worktree and the operation that
# resolves it, and it is a block, so the target stays where it was.
law m3a_refused_fastforward_of_the_basis_names_the_worktree:
  for path: String
  {L.ld_adv_refused_same(True{}, path) == L.AdvHeld{path} : L.LAdv}

def m3a_refused_fastforward_of_the_basis_names_the_worktree(path):
  {==}

law m3a_refused_fastforward_of_a_moved_target_is_the_movement:
  for path: String
  {L.ld_adv_refused_same(False{}, path) == L.AdvMoved{} : L.LAdv}

def m3a_refused_fastforward_of_a_moved_target_is_the_movement(path):
  {==}

law m3a_held_block_names_the_worktree_and_the_next_operation:
  for target: String
  for cand: String
  for path: String
  {L.ld_adv_answer(L.AdvHeld{path}, target, cand) == L.LdDone{T.LBlocked{L.ld_adv_held_text(target, path) ++ "rerun land-checked to prepare and check against the current target"}} : L.Ld}

def m3a_held_block_names_the_worktree_and_the_next_operation(target, cand, path):
  {==}

# M-3a: the blocked answer a held target produces names the worktree, the
# refusal and the operation that resolves it.
law m3a_held_text_names_the_worktree_and_the_operation:
  {L.ld_adv_held_text("main", "/w") == "the target branch main is checked out at /w; the fast-forward into that worktree was refused (git's own message is in the coordinator log); commit or stash that worktree's changes, or repair the worktree, and " : String}

def m3a_held_text_names_the_worktree_and_the_operation():
  {==}

# M-3b: the fast-forward advance lands while the target is still at the
# recorded tip.
law m3b_ff_advance_success_lands:
  for wc: String
  for target: String
  {L.ff_adv_answer(L.AdvLanded{}, wc, target) == L.FFDone{T.LLanded{target, wc}} : L.FFLD}

def m3b_ff_advance_success_lands(wc, target):
  {==}

# M-3b: the fast-forward advance refuses when the target moved, and when the
# compare-and-swap missed the basis it was prepared against.
law m3b_ff_advance_miss_refuses_retry:
  for wc: String
  for target: String
  {L.ff_adv_answer(L.AdvMoved{}, wc, target) == L.FFDone{T.LBlocked{"target moved during landing; retry"}} : L.FFLD}

def m3b_ff_advance_miss_refuses_retry(wc, target):
  {==}

law m3b_ff_advance_refusal_refuses_retry:
  for wc: String
  for target: String
  {L.ff_adv_answer(L.AdvRefused{}, wc, target) == L.FFDone{T.LBlocked{"target moved during landing; retry"}} : L.FFLD}

def m3b_ff_advance_refusal_refuses_retry(wc, target):
  {==}

law m3b_ff_advance_broken_is_not_a_landing:
  for detail: String
  for wc: String
  for target: String
  {L.ff_adv_answer(L.AdvBroken{detail}, wc, target) == L.FFDone{T.LBlocked{detail}} : L.FFLD}

def m3b_ff_advance_broken_is_not_a_landing(detail, wc, target):
  {==}

# M-11: the worktree that holds the target is read from Git's own worktree
# listing, and the listing is read only once the target tip still matches the
# basis the candidate was checked against.
law m11_the_holder_comes_from_the_worktree_listing:
  {L.ld_hold_of("worktree /one\nHEAD abc\ndetached\n\nworktree /two\nHEAD def\nbranch refs/heads/main\n\n", "main") == L.HoldPath{"/two"} : L.LdHold}

def m11_the_holder_comes_from_the_worktree_listing():
  {==}

law m11_a_listing_without_the_target_names_no_holder:
  {L.ld_hold_of("worktree /one\nHEAD abc\nbranch refs/heads/other\n\nworktree /two\nHEAD def\ndetached\n\n", "main") == L.HoldNone{} : L.LdHold}

def m11_a_listing_without_the_target_names_no_holder():
  {==}

# M-11: a listing that names the target twice, or before any worktree block,
# names no holder the advance may enter.
law m11_a_listing_that_names_the_target_twice_names_no_holder:
  {L.ld_hold_of("worktree /one\nHEAD abc\nbranch refs/heads/main\n\nworktree /two\nHEAD def\nbranch refs/heads/main\n\n", "main") == L.HoldBlocked{"the worktree listing names the target branch in more than one block, or outside a block"} : L.LdHold}

def m11_a_listing_that_names_the_target_twice_names_no_holder():
  {==}

law m11_a_target_named_outside_a_block_names_no_holder:
  {L.ld_hold_of("branch refs/heads/main\n\nworktree /one\nHEAD abc\ndetached\n\n", "main") == L.HoldBlocked{"the worktree listing names the target branch in more than one block, or outside a block"} : L.LdHold}

def m11_a_target_named_outside_a_block_names_no_holder():
  {==}

law m11_an_unreadable_listing_names_no_holder:
  for target: String
  for detail: String
  {L.ld_hold_read(T.GBroken{detail}, target) == L.HoldBlocked{detail} : L.LdHold}

def m11_an_unreadable_listing_names_no_holder(target, detail):
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
# M-18: the remote-tip read runs at the destination the argv names and reports
# only what that remote advertised for the requested ref.

# M-18: the requested branch is named as its own full ref.
law m18_the_remote_tip_names_the_requested_branch_ref:
  for branch: String
  {L.tip_ref(branch) == "refs/heads/" ++ branch : String}

def m18_the_remote_tip_names_the_requested_branch_ref(branch):
  {==}

# M-18: the read argv names the read verb, the declared remote and the
# requested ref, and nothing reads a default remote.
law m18_the_remote_tip_read_names_the_declared_remote_and_ref:
  for branch: String
  for remote: String
  {L.ls_remote_argv(branch, remote) == Con{"ls-remote", Con{"--", Con{remote, Con{"refs/heads/" ++ branch, Nil{}}}}} : List<String>}

def m18_the_remote_tip_read_names_the_declared_remote_and_ref(branch, remote):
  {==}

# M-18: the option terminator precedes both declared operands, read through
# Base's own list readers, so a declared remote that begins with a dash is the
# remote operand rather than an option.
law m18_the_remote_tip_read_terminates_its_declared_operands:
  for branch: String
  for remote: String
  {List.head(&1, String, List.tail(&1, String, L.ls_remote_argv(branch, remote))) == Some{"--"} : Maybe<String>}

def m18_the_remote_tip_read_terminates_its_declared_operands(branch, remote):
  {==}

# M-18: the declared remote is the operand the terminator precedes.
law m18_the_remote_tip_position_holds_the_declared_remote:
  for branch: String
  for remote: String
  {List.head(&1, String, List.tail(&1, String, List.tail(&1, String, L.ls_remote_argv(branch, remote)))) == Some{remote} : Maybe<String>}

def m18_the_remote_tip_position_holds_the_declared_remote(branch, remote):
  {==}

# M-18: the read effect runs exactly that argv.
law m18_the_remote_tip_read_runs_the_declared_argv:
  for repo: String
  for branch: String
  for remote: String
  {L.remote_tip_git(repo, branch, remote) == P.runGit(repo, L.ls_remote_argv(branch, remote)) : IO(T.GitOut)}

def m18_the_remote_tip_read_runs_the_declared_argv(repo, branch, remote):
  {==}

# M-18: an answer advertising the requested ref reads back as its object ID.
law m18_the_advertised_ref_reads_back_as_its_object:
  {L.tip_object("0123456789abcdef0123456789abcdef01234567\trefs/heads/main", "refs/heads/main") == "0123456789abcdef0123456789abcdef01234567" : String}

def m18_the_advertised_ref_reads_back_as_its_object():
  {==}

# M-18: an answer advertising another ref reads back as no advertisement of
# the requested one.
law m18_another_advertised_ref_reads_back_absent:
  {L.tip_object("0123456789abcdef0123456789abcdef01234567\trefs/heads/other", "refs/heads/main") == "" : String}

def m18_another_advertised_ref_reads_back_absent():
  {==}

# M-18: an empty answer reads back as no advertisement.
law m18_an_empty_remote_answer_reads_back_absent:
  {L.tip_object(SNil{}, "refs/heads/main") == "" : String}

def m18_an_empty_remote_answer_reads_back_absent():
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
# are the ones the verdict judges. The path each check runs in, and the pair it
# produces, are pinned here. Git's creation of those trees at the candidate and
# target revisions, the check subprocess itself, and the host's report of its
# exit and output remain host assumptions. The publication argv and the advance
# that runs it are stated above under M-3a.

# M-10: every selected file runs on the candidate tree first and on the target
# tree second, and each pair carries that file's own two verdicts. The step is
# composed here independently of L.run_pair_go and quantified over the
# accumulator, so it holds at every position of the selection; a run that reads
# the other tree, drops a file or pairs the file with the other tree's verdict
# breaks this proof. The trace begins at the empty accumulator and ends with the
# reversed pairs, stated below.
def run_pair_step_of(script: String, file: String, rest: List<String>, candTree: String, targTree: String, acc: List<L.PV>) -> IO(List<L.PV>):
  +s2 = script
  +ct2 = candTree
  +tt2 = targTree
  +f2 = file
  do IO<List<L.PV>>:
    cfv : L.FV <- L.run_check(ct2, s2, f2)
    tfv : L.FV <- L.run_check(tt2, s2, f2)
    L.run_pair_go(s2, rest, ct2, tt2, Con{L.PV{f2, L.fv_verdict(cfv), L.fv_verdict(tfv)}, acc})

law m10_run_pairs_checks_each_file_on_its_own_tree:
  for script: String
  for file: String
  for rest: List<String>
  for candTree: String
  for targTree: String
  for acc: List<L.PV>
  {L.run_pair_go(script, Con{file, rest}, candTree, targTree, acc) == run_pair_step_of(script, file, rest, candTree, targTree, acc) : IO(List<L.PV>)}

def m10_run_pairs_checks_each_file_on_its_own_tree(script, file, rest, candTree, targTree, acc):
  {==}

# M-10: the walk ends by reversing the accumulated pairs, and no file is added
# or dropped at the end.
law m10_the_selection_walk_ends_with_the_reversed_pairs:
  for script: String
  for candTree: String
  for targTree: String
  for acc: List<L.PV>
  {L.run_pair_go(script, Nil{}, candTree, targTree, acc) == IO.pure(List<L.PV>, List.reverse(&1, L.PV, acc)) : IO(List<L.PV>)}

def m10_the_selection_walk_ends_with_the_reversed_pairs(script, candTree, targTree, acc):
  {==}

# M-10: the checked selection is the walk over the selected files, started at
# the empty accumulator.
law m10_run_pairs_starts_from_an_empty_accumulator:
  for script: String
  for files: List<String>
  for candTree: String
  for targTree: String
  {L.run_pairs(script, files, candTree, targTree) == L.run_pair_go(script, files, candTree, targTree, Nil{}) : IO(List<L.PV>)}

def m10_run_pairs_starts_from_an_empty_accumulator(script, files, candTree, targTree):
  {==}

# M-10: one check runs in the directory it is given, with the argv that names
# its own selected file, and the result the invocation returned becomes that
# file's verdict. This is the dispatch the walk above calls. The subprocess
# itself and the host's report of its exit and output remain host assumptions.
def run_check_in_its_directory(dir: String, script: String, file: String) -> IO(L.FV):
  +d2 = dir
  +s2 = script
  +f2 = file
  do IO<L.FV>:
    r : T.RunRes <- P.runFull(L.check_argv(s2, f2), d2)
    IO.pure(L.FV, L.run_verdict(r, f2))

law m10_run_check_runs_its_argv_in_its_own_directory:
  for dir: String
  for script: String
  for file: String
  {L.run_check(dir, script, file) == run_check_in_its_directory(dir, script, file) : IO(L.FV)}

def m10_run_check_runs_its_argv_in_its_own_directory(dir, script, file):
  {==}

# M-10: the verdict a checked file carries is the verdict its own FV holds, so
# a reader that always answered pass would break this proof.
law m10_the_verdict_of_a_pair_is_the_verdict_it_carries:
  for file: String
  for verdict: L.Verdict
  {L.fv_verdict(L.FV{file, verdict}) == verdict : L.Verdict}

def m10_the_verdict_of_a_pair_is_the_verdict_it_carries(file, verdict):
  {==}

# M-10: a check that reached a normal exit reads its own status: the verdict is
# exit_verdict of the comparison of that status against zero, so a nonzero exit
# cannot read as a pass. The invocation's own output, and the host's report of
# its exit status, remain host assumptions.
law m10_a_normal_exit_reads_its_own_status:
  for code: U32
  for out: String
  for file: String
  {L.run_verdict(T.RRun{T.SExit{code}, out}, file) == L.exit_verdict(U32.is_eq(code, 0), out, file) : L.FV}

def m10_a_normal_exit_reads_its_own_status(code, out, file):
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

# M-10: the prepared worktree's exit status decides whether the checks run. The
# dispatch compares that status against zero, so a status the comparison rejects
# reaches the blocked answer m10_target_tree_failure_blocks states, and no check
# runs against a tree that was not prepared. A broken invocation fails with its
# own detail.
law m10_the_prepared_tree_status_decides_whether_the_checks_run:
  for code: U32
  for out: String
  for repo: String
  for target: String
  for script: String
  for files: List<String>
  for scratch: String
  for tip: String
  for cand: String
  for tw: String
  {L.ld_tree_ok(T.GRun{code, out}, repo, target, script, files, scratch, tip, cand, tw) == L.ld_tree_runs(U32.is_eq(code, 0), repo, target, script, files, scratch, tip, cand, tw) : IO(L.Ld)}

def m10_the_prepared_tree_status_decides_whether_the_checks_run(code, out, repo, target, script, files, scratch, tip, cand, tw):
  {==}

law m10_a_broken_tree_preparation_fails_with_its_detail:
  for detail: String
  for repo: String
  for target: String
  for script: String
  for files: List<String>
  for scratch: String
  for tip: String
  for cand: String
  for tw: String
  {L.ld_tree_ok(T.GBroken{detail}, repo, target, script, files, scratch, tip, cand, tw) == IO.pure(L.Ld, L.LdFail{T.FCmd{"land", detail}}) : IO(L.Ld)}

def m10_a_broken_tree_preparation_fails_with_its_detail(detail, repo, target, script, files, scratch, tip, cand, tw):
  {==}

# ---------------------------------------------------------------------------
# M-10: the state each stage entry is handed selects the arm that runs. The
# composition above binds that every entry is called once, in order, on the
# right trees; these laws bind what each entry does with the state it is
# handed: the arm that runs the entry's own stage with the values it holds, and
# the arm that carries a landing which already reached an outcome through
# unchanged, so a settled landing is not re-processed by a later entry. The
# stages themselves are bound above under M-10 and M-3a; Git's work inside each
# stage and the host's report of each exit status remain host assumptions. Each
# entry's remaining arms answer the unreachable refusal and are not restated
# here.

# M-10: the entry holding a resolved worker runs the target tip stage with the
# repo and target it was given.
law m10_ld_go1_runs_the_target_tip_stage:
  for worker: String
  for sha: String
  for repo: String
  for target: String
  {L.ld_go1(L.LdWk{worker, sha}, repo, target) == L.ld_stage2(repo, target, worker, sha) : IO(L.Ld)}

def m10_ld_go1_runs_the_target_tip_stage(worker, sha, repo, target):
  {==}

# M-10: the entry holding a prepared tip runs the candidate worktree stage with
# the repo and scratch it was given.
law m10_ld_go2_runs_the_candidate_worktree_stage:
  for worker: String
  for sha: String
  for tip: String
  for repo: String
  for scratch: String
  {L.ld_go2(L.LdTip{worker, sha, tip}, repo, scratch) == L.ld_stage3(repo, worker, sha, tip, scratch) : IO(L.Ld)}

def m10_ld_go2_runs_the_candidate_worktree_stage(worker, sha, tip, repo, scratch):
  {==}

# M-10: the entry holding a prepared tip runs the squash stage on the scratch
# tree it was given.
law m10_ld_go3_runs_the_squash_stage:
  for worker: String
  for sha: String
  for tip: String
  for scratch: String
  {L.ld_go3(L.LdTip{worker, sha, tip}, scratch) == L.ld_stage4(scratch, worker, sha, tip) : IO(L.Ld)}

def m10_ld_go3_runs_the_squash_stage(worker, sha, tip, scratch):
  {==}

# M-10: the entry holding a prepared tip runs the history stage with the repo
# and scratch it was given.
law m10_ld_go4_runs_the_history_stage:
  for worker: String
  for sha: String
  for tip: String
  for repo: String
  for scratch: String
  {L.ld_go4(L.LdTip{worker, sha, tip}, repo, scratch) == L.ld_stage5(repo, scratch, worker, sha, tip) : IO(L.Ld)}

def m10_ld_go4_runs_the_history_stage(worker, sha, tip, repo, scratch):
  {==}

# M-10: the entry holding a prepared candidate runs the checks stage: the seven
# arguments are the repo, target, script, files and scratch the entry was
# given, then the candidate state's own tip and cand. This is the arm that runs
# the checks.
law m10_ld_go5_runs_the_checks_stage:
  for tip: String
  for cand: String
  for repo: String
  for target: String
  for script: String
  for files: List<String>
  for scratch: String
  {L.ld_go5(L.LdCand{tip, cand}, repo, target, script, files, scratch) == L.ld_stage6(repo, target, script, files, scratch, tip, cand) : IO(L.Ld)}

def m10_ld_go5_runs_the_checks_stage(tip, cand, repo, target, script, files, scratch):
  {==}

# M-10: a settled landing passes through every entry unchanged: an entry handed
# a landing that already answered an outcome answers the same outcome again and
# runs no stage, and an entry handed a failure answers the same failure.

law m10_ld_go1_keeps_a_settled_landing:
  for made: T.LandOutcome
  for repo: String
  for target: String
  {L.ld_go1(L.LdDone{made}, repo, target) == IO.pure(L.Ld, L.LdDone{made}) : IO(L.Ld)}

def m10_ld_go1_keeps_a_settled_landing(made, repo, target):
  {==}

law m10_ld_go1_keeps_a_failed_landing:
  for fail: T.GitFail
  for repo: String
  for target: String
  {L.ld_go1(L.LdFail{fail}, repo, target) == IO.pure(L.Ld, L.LdFail{fail}) : IO(L.Ld)}

def m10_ld_go1_keeps_a_failed_landing(fail, repo, target):
  {==}

law m10_ld_go2_keeps_a_settled_landing:
  for made: T.LandOutcome
  for repo: String
  for scratch: String
  {L.ld_go2(L.LdDone{made}, repo, scratch) == IO.pure(L.Ld, L.LdDone{made}) : IO(L.Ld)}

def m10_ld_go2_keeps_a_settled_landing(made, repo, scratch):
  {==}

law m10_ld_go2_keeps_a_failed_landing:
  for fail: T.GitFail
  for repo: String
  for scratch: String
  {L.ld_go2(L.LdFail{fail}, repo, scratch) == IO.pure(L.Ld, L.LdFail{fail}) : IO(L.Ld)}

def m10_ld_go2_keeps_a_failed_landing(fail, repo, scratch):
  {==}

law m10_ld_go3_keeps_a_settled_landing:
  for made: T.LandOutcome
  for scratch: String
  {L.ld_go3(L.LdDone{made}, scratch) == IO.pure(L.Ld, L.LdDone{made}) : IO(L.Ld)}

def m10_ld_go3_keeps_a_settled_landing(made, scratch):
  {==}

law m10_ld_go3_keeps_a_failed_landing:
  for fail: T.GitFail
  for scratch: String
  {L.ld_go3(L.LdFail{fail}, scratch) == IO.pure(L.Ld, L.LdFail{fail}) : IO(L.Ld)}

def m10_ld_go3_keeps_a_failed_landing(fail, scratch):
  {==}

law m10_ld_go4_keeps_a_settled_landing:
  for made: T.LandOutcome
  for repo: String
  for scratch: String
  {L.ld_go4(L.LdDone{made}, repo, scratch) == IO.pure(L.Ld, L.LdDone{made}) : IO(L.Ld)}

def m10_ld_go4_keeps_a_settled_landing(made, repo, scratch):
  {==}

law m10_ld_go4_keeps_a_failed_landing:
  for fail: T.GitFail
  for repo: String
  for scratch: String
  {L.ld_go4(L.LdFail{fail}, repo, scratch) == IO.pure(L.Ld, L.LdFail{fail}) : IO(L.Ld)}

def m10_ld_go4_keeps_a_failed_landing(fail, repo, scratch):
  {==}

law m10_ld_go5_keeps_a_settled_landing:
  for made: T.LandOutcome
  for repo: String
  for target: String
  for script: String
  for files: List<String>
  for scratch: String
  {L.ld_go5(L.LdDone{made}, repo, target, script, files, scratch) == IO.pure(L.Ld, L.LdDone{made}) : IO(L.Ld)}

def m10_ld_go5_keeps_a_settled_landing(made, repo, target, script, files, scratch):
  {==}

law m10_ld_go5_keeps_a_failed_landing:
  for fail: T.GitFail
  for repo: String
  for target: String
  for script: String
  for files: List<String>
  for scratch: String
  {L.ld_go5(L.LdFail{fail}, repo, target, script, files, scratch) == IO.pure(L.Ld, L.LdFail{fail}) : IO(L.Ld)}

def m10_ld_go5_keeps_a_failed_landing(fail, repo, target, script, files, scratch):
  {==}
