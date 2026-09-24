// fixture-root.mjs — issue #571: the fixture-root derivation for fixtures that bind a Unix
// socket directly below the directory they mint.
//
// Two rules meet here:
//
// 1. Containment (#571): a fixture lives under os.tmpdir(), which the suite runner points at
//    the file's own suite-owned root (run-suite.mjs), so a leaked fixture directory is detected
//    and swept with the suite root.
// 2. sun_path (#446): the kernel bounds a Unix socket path at 103 bytes (104 with the NUL on
//    Darwin; the portable ceiling application-host.mjs enforces). An ambient TMPDIR can be deep
//    — a Baton seat's runtime tmp, a parallel gate's root — and a socket minted below it fails
//    configuration with 'Web host configuration is invalid' or EINVAL at listen.
//
// Measure the socket path the minted directory would carry, and fall back to the short system
// root when it would not fit — the same measure-then-fall-back derivation resident-authority.mjs
// applies to its own socket. Under the suite runner the ambient root is the short per-file root,
// so the fallback never triggers there and containment holds.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// sockaddr_un.sun_path is 104 bytes including the NUL terminator on Darwin (108 on Linux),
// so 103 bytes is the portable ceiling for a Unix socket path.
const SUN_PATH_CEILING = 103;

/** Mint a fixture directory a Unix socket can live directly below. `label` is the mkdtemp prefix
 * (it MUST end in '-'); `socketName` is the socket file the fixture binds below the directory.
 * Returns the minted directory path. */
export function fixtureSocketRoot(label, socketName = 'resident.sock') {
  const ambient = tmpdir();
  // mkdtemp appends SIX random characters to the prefix (#446: a probe that stands them in with
  // fewer reads short and admits a root the kernel then refuses).
  const probe = join(ambient, `${label}XXXXXX`, socketName);
  const parent = Buffer.byteLength(probe) > SUN_PATH_CEILING ? '/tmp' : ambient;
  return mkdtempSync(join(parent, label));
}
