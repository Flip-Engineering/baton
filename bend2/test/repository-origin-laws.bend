import Base
import ../src/coordinator/control.bend as Control

law a_https_origin_normalizes_to_owner_name:
  {Control.without_git_suffix(Control.repository_url("https://github.com/Flip-Engineering/baton.git")) == "Flip-Engineering/baton" : String}

def a_https_origin_normalizes_to_owner_name():
  {==}

law an_scp_origin_normalizes_to_owner_name:
  {Control.without_git_suffix(Control.repository_url("git@github.com:Flip-Engineering/baton.git")) == "Flip-Engineering/baton" : String}

def an_scp_origin_normalizes_to_owner_name():
  {==}

law an_ssh_origin_normalizes_to_owner_name:
  {Control.without_git_suffix(Control.repository_url("ssh://git@github.com/Flip-Engineering/baton.git")) == "Flip-Engineering/baton" : String}

def an_ssh_origin_normalizes_to_owner_name():
  {==}
