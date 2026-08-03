# baton brand assets

The baton mark: **Flip, the project mascot, as the Sorcerer's Apprentice** — the Fantasia
hat, a conductor's baton mid-downbeat in paw, gold sparkles off the tip. The character is
the operator-supplied Flip mascot (`mascot-smile.svg`, `mascot-thinking.svg` — canonical,
verbatim): pink blob body (`#FF8FA3`), cream face (`#FFF0F3`), crimson features (`#C93550`),
gold cheek sparkles (`#FFD700`), teal thought bubbles in the thinking pose (`#4ECDC4`).

Lineage: the Flip identity (`/flip` repo) is a wordmark tile — near-black rounded square,
800-weight type. An earlier draft of this mark translated the *tile* with a generic
rounded-square chip character; the operator supplied the real mascot and the mark was
redrawn around it. The conducting concept is the operator's original brief: "the Flip
character using a baton like Mickey Mouse from Fantasia." Sorcerer hat
(`#3B4FA8`→`#1B2452`, stars/moon `#FFE9A8`), motion arc `#6C8CFF`, cork handle `#D9B38C`.

## Files

- `mascot-smile.svg` / `mascot-thinking.svg` — the canonical Flip mascot (do not edit;
  pose variants belong upstream).
- `baton-logo.svg` / `baton-logo-512.png` — the pfp/avatar mark (Flip + hat + baton on the
  dark tile; reads at 48px). Mirrored at `.github/assets/logo.svg` (+ `logo-192.png`,
  `logo-512.png`).
- `baton-banner.svg` / `baton-banner-1280x640.png` — GitHub repo social-preview banner
  (upload at repo Settings → Social preview). The README header banner is
  `.github/assets/banner.svg` (900×400, Flip + hat + baton + the six-seat fleet).
- `../../src/brand.mjs` — the mascot as terminal faces (`flipFace('smile'|'thinking')`,
  ANSI when TTY): CLI stderr brand/serve/error lines and the MCP `initialize`
  `instructions` field. stdout stays machine-clean JSON.

## Usage

- **Committer pfp:** the dogfood committer (`baton 0.1.0 <baton-dogfood@localhost>`) is a
  local-only identity; to give it a face on GitHub, attach `baton-logo-512.png` to whatever
  account displays the commits (a bot account, or a Gravatar registered for the noreply
  address — GitHub renders Gravatar for unknown emails).
- **Repo social preview:** upload `baton-banner-1280x640.png` in repo Settings.
- Regenerate previews: `qlmanage -t -s <px> -o <dir> <svg>`; crop with `sips -c <h> <w>`.
- Terminal faces: `import { flipFace, flipLine } from '../src/brand.mjs'` — smile for
  ready/success, thinking for working/waiting; pass `{ color: stream.isTTY === true }`.
