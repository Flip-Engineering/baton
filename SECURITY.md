# Security disclosure

## Audit (2026-08-20, pre-org-transfer)

- **Secrets**: full-history scan (2,383 commits, all blobs) — zero real credentials. The 22
  credential-shaped strings in the tree are redaction-verifier test fixtures (pins that
  inject canary shapes to assert the sanitizers redact them).
- **Personal info**: historical commits contain the original author's local filesystem
  paths (`/Users/<author>` in captured evidence) and unix owner names in `ls`-style
  runtime captures — the natural residue of an event-sourced campaign run on one machine.
  Current-tree occurrences were scrubbed at transfer time; history retains them.
  Commit authorship (name/email) is intentionally preserved — this is attributed work.
- **Live secrets never in the repo**: session tokens and connection credentials live
  under `~/.config/baton/` (untracked local state, `.git/baton/` runtime state does not
  transfer).

Report vulnerabilities via the repo's private security advisories.
