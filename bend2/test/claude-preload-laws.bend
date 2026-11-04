# The Claude Code launch environment names the pinned agent_summary preload (#1338).
# BUN_OPTIONS carries the --preload= form, after any options already present.
import Base
import ../src/harness/claude-player.bend as Claude

law a_launch_without_inherited_options_names_only_the_preload:
  {Claude.bun_options("", "/opt/baton/libexec/baton2/no-agent-summary.js") == "--preload=/opt/baton/libexec/baton2/no-agent-summary.js" : String}

def a_launch_without_inherited_options_names_only_the_preload():
  {==}

law inherited_options_come_before_the_preload:
  {Claude.bun_options("--smol --hot", "/p/no-agent-summary.js") == "--smol --hot --preload=/p/no-agent-summary.js" : String}

def inherited_options_come_before_the_preload():
  {==}

law the_environment_entry_is_BUN_OPTIONS:
  {Claude.environment("", "/p/no-agent-summary.js") == ["BUN_OPTIONS=--preload=/p/no-agent-summary.js"] : List<String>}

def the_environment_entry_is_BUN_OPTIONS():
  {==}

law the_environment_entry_appends_to_inherited_options:
  {Claude.environment("--smol", "/p/no-agent-summary.js") == ["BUN_OPTIONS=--smol --preload=/p/no-agent-summary.js"] : List<String>}

def the_environment_entry_appends_to_inherited_options():
  {==}

law an_absent_preload_leaves_the_environment_unchanged:
  {Claude.environment("--smol", "") == Nil{} : List<String>}

def an_absent_preload_leaves_the_environment_unchanged():
  {==}

law entries_run_the_command_under_env:
  {Claude.with_environment(["BUN_OPTIONS=--preload=/p/x.js"], ["claude", "--print"]) == ["/usr/bin/env", "BUN_OPTIONS=--preload=/p/x.js", "claude", "--print"] : List<String>}

def entries_run_the_command_under_env():
  {==}

law no_entries_run_the_command_directly:
  {Claude.with_environment(Nil{}, ["claude", "--print"]) == ["claude", "--print"] : List<String>}

def no_entries_run_the_command_directly():
  {==}
