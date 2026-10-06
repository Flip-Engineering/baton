# Shared contributor qualification

The operator selected one shared contributor for all model series. Its
GitHub account is [Flip-Baton](https://github.com/Flip-Baton), User 338365132.
Its profile name is `Flip - Baton`; its verified receiving address is
`baton@flip.engineering`. Cloudflare forwards that address to the existing
verified operator-owned destination. A genuine GitHub verification message
reached that destination on 2026-10-06.

## Avatar

The shared avatar is [baton-contributor.svg](../assets/brand/baton-contributor.svg)
and its [512px PNG](../assets/brand/baton-contributor.png). Named SVG layers
separate the field, face, eyes, expression, hat, hand/baton and tip accent.
Independent visual review inspected square and circular 200px displays and
circular 60px and 32px displays. The face remains recognizable at 32px;
the hat, conducting grip and circular margins passed review.

The uploaded account image was retrieved from GitHub and visually checked
against the source. GitHub serves a resized account image.

| Source | SHA-256 |
|---|---|
| SVG | `e18530a0aaca0e97f8d078f34b5df2af0ba9eb2c707faf8561980c1582c4f236` |
| PNG | `143eccac6a64c86060a7e7a009a915d3d774034cb1cf2d0f35d66c58024bf639` |

## Attribution adapter

The [series identity helper](git-series-identities.md) accepts a registry-level
`attribution` object containing `name` and `email`. It supplies both Git
author and committer. Canonical per-series App authentication and native model
provenance remain recorded independently.

Source `fe0b05e696d4712f1f5826092f0b432c0e78e1df` was reviewed independently
and qualified on atari-homelab with Node 22.23.3 and Git 2.43.0. The admitted
command was `node --test bend2/test/git-series.mjs`. All 17 tests passed;
the fixture and wrapper exited 0, with empty stderr. Source and tool hashes
matched before and after execution. Controlled Git objects establish shared
author and committer headers for every series, per-series fallback and
canonical App credential selection.

The complete remote receipt is
`/mnt/nvme4tb/ci-runners/baton2-native-homelab/qualifications/git-series-fe0b05e6-ci150`.
The fixture used synthetic credentials and network isolation. Actual GitHub
association and the selected avatar require a real published contribution.
This document and the avatar assets supply that contribution.

The current pilot registry is separate from the live registry. Primary branch
composition, full coordinator gates, installed native inheritance and global
activation retain their own acceptance requirements.
