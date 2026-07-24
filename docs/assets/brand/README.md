# baton brand assets

The baton mark: a conductor's baton mid-downbeat across a sorcerer-blue motion arc with
spark stars, on the Flip-family tile (`#0F0F12`, 22% corner radius, `#EAEAEA` foreground).

Lineage: the Flip identity (`/flip` repo, `priv/static/favicon.svg`) is a wordmark tile —
near-black rounded square, 800-weight type. Flip has no mascot, so the baton mark translates
the *tile*, and the character comes from the Fantasia reference the operator gave: Mickey as
the Sorcerer's Apprentice, conducting — the arc is the conducting sweep, the sparks are the
sorcery. One accent color distinguishes baton from Flip's monochrome: sorcerer blue `#6C8CFF`
(sparks `#AFC4FF`, cork handle `#D9B38C`).

## Files

- `baton-logo.svg` / `baton-logo-512.png` — the pfp/avatar mark (no text; reads at 48px).
- `baton-banner.svg` / `baton-banner-1280x640.png` — GitHub repo social-preview banner
  (upload at repo Settings → Social preview).
- Concept variations not yet drawn, if wanted: (a) monochrome tile exactly matching Flip's
  (arc and baton both `#EAEAEA`) for maximum family resemblance; (b) wordmark tile — "baton"
  in the Flip type with the baton glyph replacing the crossbar of the `t`; (c) animated arc
  (SMIL) for docs headers.

## Usage

- **Committer pfp:** the dogfood committer (`baton 0.1.0 <baton-dogfood@localhost>`) is a
  local-only identity; to give it a face on GitHub, attach `baton-logo-512.png` to whatever
  account displays the commits (a bot account, or a Gravatar registered for the noreply
  address — GitHub renders Gravatar for unknown emails).
- **Repo social preview:** upload `baton-banner-1280x640.png` in repo Settings.
- Regenerate previews: `qlmanage -t -s <px> -o <dir> <svg>`; crop with `sips -c <h> <w>`.
