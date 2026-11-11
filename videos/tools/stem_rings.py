#!/usr/bin/env python3
"""Per-stem ring finder and solo/mute bounce for a DAW-session song (TOOLING c32; from the HORDE v19 builder and director).

    python3 videos/tools/stem_rings.py SONGMODULE rings  [--level track|bus|both] [--gate-db 35] [--min-db 10] [--fmin 600] [--fmax 8000] [--from S --to S]
    python3 videos/tools/stem_rings.py SONGMODULE bounce OUT.wav [--solo a,b] [--mute c,d] [--from S --to S]
    python3 videos/tools/stem_rings.py SONGMODULE list
    python3 videos/tools/stem_rings.py --selftest

SONGMODULE is e.g. songs2.horde_c19 (it must have build() returning (Session, ...) or (Session), or song() returning an object with .S).
Nothing in the song is edited: the session is built, tracks are muted in memory, the session is rendered (stems are cached, so a mute
costs only the buses, rooms and master).  The cache goes in $ACP_DAW_CACHE (default /tmp/acp_daw_cache; set it to a scratch dir to keep
other agents' cached stems intact, and delete it after).

rings   Builds the song once and runs the ring finder (ring_find.py) on every track's stem and every bus, with near-silent frames ignored
        (--gate-db: only frames within that many dB of the stem's loudest frame count; default 35), then prints, per stem, the lines it
        found (a list, no verdict: a pitched instrument is a line too; listen).  Answers 'which track carries the 1 kHz line' without
        clobbering events.  Also runs the master.  Track stems are before
        sends/buses (the dry track, with its own chain and gain); bus signals are after the bus chain (its filters), before the rooms.
        If a line is in the master and in no stem or bus, it comes from a room (reverb) or the master chain.
bounce  A real mix with tracks muted (--mute) or only some tracks kept (--solo); names match by substring, case-insensitive, against the
        track names (see `list`).  A muted track's reverb sends go with it.  Writes the session master (before the song's own
        loudness master and the finish stage) as a 16-bit wav; --from/--to cut it.  Use it to listen to or measure (ring_find, audio_profile) a
        stem in context: 'the mix without the mauls', 'the exhaust alone'.
levels  (c35) One call, no re-bounce: per window (--win s, stepping --step s), each stem's solo loudness (RMS dBFS) and share of the
        window's total power, sorted loudest first, with the master's level and the DOMINANT stem named; then a per-track summary (windows
        where it dominates).  Stems are dry (own chain and gain, before sends/buses), so a heavily reverb-sent track reads lower than it sounds.
        Silent windows of a stem print '-'.  Answers 'what is carrying 13-24 s' and 'is the horse audible over the men in 0-4 s'.
list    Track names, buses, and each track's event count.
"""
import argparse, importlib, os, sys, tempfile
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
for p in (HERE, VIDEOS, os.path.join(VIDEOS, 'web', 'audio')):
    if p not in sys.path: sys.path.insert(0, p)
import ring_find as RF  # noqa: E402

SR = 44100


def get_session(modname):
    m = importlib.import_module(modname)
    if hasattr(m, 'build'):
        r = m.build()
        return r[0] if isinstance(r, tuple) else r
    s = m.song()
    for k in ('S', 'session', 'sess'):
        if hasattr(s, k): return getattr(s, k)
    raise SystemExit(f'{modname}: need build() -> Session or song().S')


def pick(S, names):
    out = []
    for q in names:
        hit = [n for n in S.tracks if q.lower() in n.lower()]
        if not hit: raise SystemExit(f'no track matches {q!r}; `list` shows the names')
        out += hit
    return list(dict.fromkeys(out))


def apply_mutes(S, solo, mute):
    keep = set(pick(S, solo)) if solo else set(S.tracks)
    drop = set(pick(S, mute)) if mute else set()
    for n, tr in S.tracks.items():
        if n not in keep or n in drop:
            tr.gain_db = -200.0   # after the cached stem: the cache stays valid; sends follow the gain
    return sorted(set(S.tracks) - keep | drop)


def mono(x, a=None, b=None):
    y = x.mean(axis=1) if x.ndim > 1 else x
    if a is not None: y = y[int(a * SR): int((b if b else len(y) / SR) * SR)]
    return y.astype(np.float64)


def cmd_rings(S, a):
    mix = S.render(verbose=False)
    items = []
    if a.level in ('track', 'both'): items += [('track', n, x) for n, x in mix.stems.items()]
    if a.level in ('bus', 'both'): items += [('bus', n, x) for n, x in mix.buses.items()]
    items.append(('master', 'master', mix.master))
    for kind, n, x in items:
        y = mono(x, a.t0, a.to)
        if np.abs(y).max() < 1e-4: continue
        L = RF.find(SR, y, 0, None, a.min_db, a.fmin, a.fmax, gate_db=a.gate_db)
        print(f'{kind:6s} {n[:58]:58s} {len(L)} lines ({len(RF.lasting(L))} that last)')
        for l in L[:a.top]:
            print(f"         {l['hz']:6.0f} Hz  {l['frac']*100:4.1f}% ({l['secs']:.1f}s)  strikes {l['strikes']:3d}"
                  + (f" every {l['spacing']:.2f}s{' steady' if l['steady'] else ''}" if l['strikes'] >= 2 else '')
                  + f"  prom {l['prom']:.0f} dB @{l['at'] + (a.t0 or 0):.1f}s")
    return 0


def cmd_levels(S, a):
    mix = S.render(verbose=False)
    items = [(n, mono(x, a.t0, a.to)) for n, x in mix.stems.items() if np.abs(x).max() > 1e-4]
    if a.level == 'bus': items = [(n, mono(x, a.t0, a.to)) for n, x in mix.buses.items() if np.abs(x).max() > 1e-4]
    M = mono(mix.master, a.t0, a.to)
    off = a.t0 or 0
    W, H = int(a.win * SR), int(a.step * SR)
    def db(v): return 10 * np.log10(v + 1e-12)
    dom = {n: 0 for n, _ in items}; nwin = 0
    for s0 in range(0, max(1, len(M) - W + 1), H):
        pw = [(n, float(np.mean(y[s0:s0 + W] ** 2))) for n, y in items]
        tot = sum(p for _, p in pw) + 1e-18
        pw.sort(key=lambda r: -r[1])
        m = float(np.mean(M[s0:s0 + W] ** 2))
        row = ', '.join(f'{n[:28]} {db(p):.0f} ({100 * p / tot:.0f}%)' for n, p in pw[:a.top] if p / tot > 0.01)
        print(f'{off + s0 / SR:6.1f}-{off + (s0 + W) / SR:5.1f}s  master {db(m):5.1f} dBFS | dominant: {pw[0][0][:34]} | {row}')
        dom[pw[0][0]] += 1; nwin += 1
    print('\ndominant in N of %d windows:' % nwin)
    for n, c in sorted(dom.items(), key=lambda r: -r[1]):
        if c: print(f'  {c:3d}  {n}')
    return 0


def cmd_bounce(S, a):
    off = apply_mutes(S, a.solo.split(',') if a.solo else None, a.mute.split(',') if a.mute else None)
    print('muted:', len(off), 'tracks;', 'kept:', len(S.tracks) - len(off), file=sys.stderr)
    mix = S.render(verbose=False)
    import soundfile as sf
    x = mix.master
    if a.t0 or a.to: x = x[int((a.t0 or 0) * SR): int((a.to or len(x) / SR) * SR)]
    sf.write(a.out, np.clip(x, -1, 1), SR, subtype='PCM_16')
    print(f'{a.out}: {len(x)/SR:.2f} s, peak {20*np.log10(np.abs(x).max()+1e-9):.1f} dBFS')
    return 0


def selftest():
    """No song needed: a fake Session with one ringing track and one clean track; the ring lands on the right stem; muting removes it."""
    from engine.daw import session as SS
    rng = np.random.default_rng(2)
    n = SR * 5
    class G:  # a generator never called (we feed clips)
        pass
    S = SS.Session(bpm=120, beats=10, tail=0.5, name='stem_rings_selftest', cache=False)
    t1 = S.track('clean noise', None); t2 = S.track('bell track', None)
    noise = (rng.normal(0, 0.1, (SR * 4, 2))).astype(np.float32)
    tt = np.arange(int(0.6 * SR)) / SR
    bell = np.zeros((SR * 4, 2), np.float32)
    for k in range(5):
        s = int((0.3 + 0.7 * k) * SR); m = len(tt)
        bell[s:s + m] += (0.3 * np.sin(2 * np.pi * 1100 * tt) * np.exp(-tt * 6))[:, None]
    t1.clip(0, noise); t2.clip(0, bell + noise * 0.5)
    mix = S.render(verbose=False, dawdreamer=False)
    r = {}
    for nme, x in mix.stems.items():
        L = RF.find(SR, mono(x), 0, None, 10, 600, 8000, gate_db=35)
        r[nme] = bool(RF.lasting(L)), [l['hz'] for l in L[:1]]
    ok1 = r['bell track'][0] and abs(r['bell track'][1][0] - 1100) < 40 and not r['clean noise'][0]
    # mute by name via gain
    S2 = SS.Session(bpm=120, beats=10, tail=0.5, name='stem_rings_selftest2', cache=False)
    a2 = S2.track('clean noise', None); b2 = S2.track('bell track', None); a2.clip(0, noise); b2.clip(0, bell)
    apply_mutes(S2, None, ['bell'])
    m2 = S2.render(verbose=False, dawdreamer=False).master
    S3 = SS.Session(bpm=120, beats=10, tail=0.5, name='stem_rings_selftest3', cache=False)
    a3 = S3.track('clean noise', None); b3 = S3.track('bell track', None); a3.clip(0, noise); b3.clip(0, bell)
    apply_mutes(S3, ['bell'], None)
    m3 = S3.render(verbose=False, dawdreamer=False).master
    ok2 = not RF.lasting(RF.find(SR, mono(m2), 0, None, 10, 600, 8000, gate_db=35))
    ok3 = bool(RF.lasting(RF.find(SR, mono(m3), 0, None, 10, 600, 8000, gate_db=35)))
    # the silence gate: a stem that is only a 1100 Hz line 70 dB under its single loud noise burst is not a ring with the gate on
    y = np.zeros(SR * 4); y[SR:SR + 2000] = rng.normal(0, 0.3, 2000)
    y += 1e-5 * np.sin(2 * np.pi * 1100 * np.arange(len(y)) / SR) * (np.arange(len(y)) % SR < SR // 2)
    ok4 = not RF.lasting(RF.find(SR, y, 0, None, 10, 600, 8000, gate_db=35))
    # levels: loud track dominates in its own window
    S4 = SS.Session(bpm=120, beats=10, tail=0.5, name='stem_rings_selftest4', cache=False)
    q = S4.track('quiet', None); l = S4.track('loud', None)
    q.clip(0, noise * 0.1); l.clip(0, np.concatenate([np.zeros((SR * 2, 2), np.float32), noise[:SR * 2]]))
    import io, contextlib
    class A: t0 = None; to = None; win = 1.0; step = 1.0; top = 3; level = 'track'
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf): cmd_levels(S4, A)
    lines = buf.getvalue().splitlines()
    ok5 = 'dominant: quiet' in lines[0] and 'dominant: loud' in lines[2]
    print('levels names the dominant stem per window:', ok5)
    ok4 = ok4 and ok5
    print('ring on the right stem:', ok1, '| mute removes it:', ok2, '| solo keeps it:', ok3, '| silent-floor line ignored:', ok4)
    return 0 if ok1 and ok2 and ok3 and ok4 else 1


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('module', nargs='?'); ap.add_argument('cmd', nargs='?'); ap.add_argument('out', nargs='?')
    ap.add_argument('--level', default='both', choices=['track', 'bus', 'both']); ap.add_argument('--gate-db', type=float, default=35, dest='gate_db')
    ap.add_argument('--min-db', type=float, default=10, dest='min_db'); ap.add_argument('--fmin', type=float, default=600); ap.add_argument('--fmax', type=float, default=8000)
    ap.add_argument('--top', type=int, default=4); ap.add_argument('--win', type=float, default=3.0); ap.add_argument('--step', type=float, default=1.0); ap.add_argument('--solo'); ap.add_argument('--mute')
    ap.add_argument('--from', dest='t0', type=float); ap.add_argument('--to', type=float); ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest: sys.exit(selftest())
    if not a.module or a.cmd not in ('rings', 'bounce', 'list', 'levels'): ap.error('SONGMODULE rings|bounce|list|levels, or --selftest')
    S = get_session(a.module)
    if a.cmd == 'list':
        for n, t in S.tracks.items(): print(f'{n}  [bus {t.bus}, {len(t.events)} events, {t.gain_db:+g} dB]')
        print('buses:', ', '.join(S.buses)); sys.exit(0)
    if a.cmd == 'bounce':
        if not a.out: ap.error('bounce needs OUT.wav')
        sys.exit(cmd_bounce(S, a))
    if a.cmd == 'levels': sys.exit(cmd_levels(S, a))
    sys.exit(cmd_rings(S, a))
