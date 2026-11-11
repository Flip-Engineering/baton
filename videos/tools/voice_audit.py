#!/usr/bin/env python3
"""voice_audit.py: the voice guard's self-test, and a per-song audit of synthesized word vocals.

    python3 videos/tools/voice_audit.py --selftest           # engine guard + gate voices/clip checks (about 5 s)
    python3 videos/tools/voice_audit.py --c2                 # VOICE c2: the guard holds with voices off
    python3 videos/tools/voice_audit.py --c4                 # VOICE c4: found voices (provenance, no warp, tally, rights), natural read (words kept)
    python3 videos/tools/voice_audit.py --c3                 # VOICE c3: the take's own contour is recorded
    python3 videos/tools/voice_audit.py ascended empire      # render those songs (no master) and tally their voices
    python3 videos/tools/voice_audit.py --all                # every songs2/<key>.py module (the slate; ~20 s a song)

The audit renders each song body with voices OFF (the default) and prints what the guard did: worded say() /
neural calls silenced, worded '_stem's dropped, wordless vowels kept, and anything still audible (should be 0).
Songs with silenced calls still carry dead synth code: move the words to '_line' text hits (TOOLING_LOG 2026-09-27).
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
sys.path.insert(0, VIDEOS)
sys.path.insert(0, os.path.join(VIDEOS, 'web', 'audio'))
sys.path.insert(0, os.path.join(VIDEOS, 'scripts'))

import numpy as np  # noqa: E402

from engine import audio as A  # noqa: E402


def selftest():
    ok = []

    def check(name, cond):
        ok.append(bool(cond))
        print(f"  {'PASS' if cond else 'FAIL'}  {name}")

    A.voice_stats_reset()
    # 1. say(): worded text is silent with voices off, same length and meta as the voiced take
    x, m = A.say('FOLD IT.', 50, 'crowd', meta=True)
    with A.allow_voices():
        y, m2 = A.say('FOLD IT.', 50, 'crowd', meta=True)
    check('worded say() is silent with voices off', not np.any(x) and m.get('silenced'))
    check('the silent take keeps the voiced length and pcenter', x.shape == y.shape and abs(m['pcenter'] - m2['pcenter']) < 1e-9)
    check('allow_voices() turns the voice on inside its block only', np.abs(y).max() > 0.05 and not A.voices_on())
    check('wordless AH / OH still sound', np.abs(A.say('AH', 50, 'crowd')).max() > 0.05 and A.is_wordless('OHH'))
    check('the wrappers are guarded too (chant, crowd_cry vocal part)', not np.any(A.chant('WE RISE', 12)))
    # 2. strict mode raises
    os.environ['ACP_VOICE_STRICT'] = '1'
    try:
        A.say('WORKERS RULE', 50, 'lead')
        check('ACP_VOICE_STRICT=1 raises VoicesOffError', False)
    except A.VoicesOffError:
        check('ACP_VOICE_STRICT=1 raises VoicesOffError', True)
    finally:
        os.environ.pop('ACP_VOICE_STRICT', None)
    # 3. a Song: a textless '_stem' built from say() (the old bypass) places nothing; the text hit keeps its timing
    A.voice_stats_reset()
    arr = A.say('ASCENDED', 50, 'crowd')
    bars = [{'kick': 'x...x...x...x...', '_stem': [(arr, 0, 1.0, None), (arr, 8, 1.0, 'ASCENDED.')]}]
    S = A.Song(120, bars)
    st, kicks, hits = S.render()
    rep = A.voice_report(S)
    check('a Song with say()-built stems has no audible synth vocal', rep['synth_audible'] == 0)
    check('the worded stem still logs its text hit', any(h['text'] == 'ASCENDED.' for h in S.text_hits))
    S2 = A.Song(120, [dict(bars[0])], voices=True)
    A.voice_stats_reset()
    with A.allow_voices():
        arr2 = A.say('ASCENDED', 50, 'crowd')
    S2.bars[0]['_stem'] = [(arr2, 8, 1.0, 'ASCENDED.')]
    S2.render()
    check('Song(voices=True) places the voiced stem and the report says so', A.voice_report(S2)['synth_audible'] >= 1)
    # 4. gate: voices check and clip window
    import gate
    import argparse

    class R:
        def __init__(self):
            self.items, self.metrics = [], {}

        def add(self, check, status, msg, **kw):
            self.items.append({'check': check, 'status': status, 'msg': msg})

    orig = gate.tc.hits_for
    try:
        gate.tc.hits_for = lambda s: {'bpm': 120, 'duration': 30.0, 'text': [], 'voices': A.voice_report(S2)}
        r = R()
        gate.voices_check(r, 'x', None)
        check('gate voices check reports an audible synth vocal as information', any(i['status'] == 'INFO' for i in r.items)
              and not any(i['status'] == 'FAIL' for i in r.items))
        A.voice_stats_reset()
        gate.tc.hits_for = lambda s: {'bpm': 120, 'duration': 30.0, 'text': [], 'voices': A.voice_report(S)}
        r = R()
        gate.voices_check(r, 'x', None)
        check('gate voices check PASSes a guarded song', [i['status'] for i in r.items] == ['PASS'])
        gate.tc.hits_for = lambda s: {'bpm': 120, 'duration': 30.0}
        r = R()
        gate.voices_check(r, 'x', None)
        check('gate voices check WARNs on a hits.json from before the guard', r.items[0]['status'] == 'WARN')
        ns = argparse.Namespace(bpm=None, clip_from='b20', clip_to=None)
        c = gate.clip_window(ns, 'x', 5.0)
        check('clip window: b20 at 120 BPM = 10 s, to = from + clip length', c['from'] == 10.0 and c['to'] == 15.0)
        m = gate.CLIP_NAME.match('commonwealth3_17.25-24')
        check('render.mjs clip names are recognised', m and m.groups() == ('commonwealth3', '17.25', '24'))
    finally:
        gate.tc.hits_for = orig
    print(f"selftest: {sum(ok)}/{len(ok)} pass")
    return all(ok)


def selftest_c2():
    """VOICE c2: the guard holds with voices off. (The c2 quality checks, onset error, f0 peak, vowel ratio and HNR, are
    removed, 8 Oct: a voice is judged by listening.)"""
    ok = []

    def check(name, cond):
        ok.append(bool(cond))
        print(f"  {'PASS' if cond else 'FAIL'}  {name}")

    from engine import voice as V
    A.voice_stats_reset()
    st, meta = V.line('THINGS CANNOT GO ON', 'call')
    check('V.line() is silent with voices off (the guard holds)', not np.any(st) and meta.get('silenced'))
    print(f"selftest c2: {sum(ok)}/{len(ok)} pass")
    return all(ok)


def selftest_c3():
    """VOICE c3: the take keeps its own contour information (the transfer is recorded). (The c3 quality checks, tail level,
    hard steps, HNR range, answer attack and cast overlap, are removed, 8 Oct: a voice is judged by listening.)"""
    ok = []

    def check(name, cond):
        ok.append(bool(cond))
        print(f"  {'PASS' if cond else 'FAIL'}  {name}")

    from engine import voice as V
    from engine.voice import prosody as P
    if not V.models.available('kokoro1'):
        print('  SKIP  Kokoro v1.0 not fetched')
        return True
    x, sr = V.models.synth('kokoro1', 'no one trusts the institutions', 'am_fenrir')
    syls = [dict(text=t, t=0.15 * i + (0.1 if i > 2 else 0), dur=0.15, stress=s, word=w, phrase=0)
            for i, (t, s, w) in enumerate([('NO', 2, 'no'), ('ONE', 2, 'one'), ('TRUSTS', 3, 'trusts'), ('THE', 0, 'the'),
                                           ('IN', 1, 'institutions'), ('sti', 0, 'institutions'), ('TU', 3, 'institutions'),
                                           ('tions', 0, 'institutions')])]
    y, m = P.perform(x, sr, syls, 'call')
    check('the take keeps its own contour info (transfer recorded)', 'b_syl' in m.get('transfer', {}))
    print(f"selftest c3: {sum(ok)}/{len(ok)} pass")
    return all(ok)


def selftest_c4():
    """VOICE c4: a found voice keeps its timing and its provenance and is tallied (and never held), its rights are stated, and the
    natural read keeps its words. Breakage and facts only (8 Oct)."""
    ok = []

    def check(name, cond):
        ok.append(bool(cond))
        print(f"  {'PASS' if cond else 'FAIL'}  {name}")

    from engine import audio as A, voice as V
    from engine.voice import found as F, natural as N
    sr = 24000
    t = np.arange(int(sr * 3.0)) / sr
    # a synthetic 'phrase': three voiced bursts (f0 140 Hz + harmonics) on a noise floor
    x = 0.004 * np.random.default_rng(3).standard_normal(len(t))
    for c in (0.5, 1.4, 2.2):
        env = np.exp(-0.5 * ((t - c) / 0.12) ** 2)
        x += env * sum(np.sin(2 * np.pi * 140 * k * t) / k for k in range(1, 12)) * 0.2
    side = dict(item='selftest', url='file://x', rights_class='PD', credit='selftest credit', title='T')
    clip = dict(x=x, sr=sr, path='mem', side=side)
    A.voice_stats_reset()
    y, m = F.phrase(clip, film='newsreel', gate_db=9.0, lufs=-20.0)
    check('found.phrase: engine SR, duration kept (no time-warp), provenance carried', abs(len(y) / A.SR - 3.0) < 0.01 and m['rights'] == 'PD' and m['credit'] == 'selftest credit')
    check('found.phrase: the anchor is the rise of the first strong burst (0.15-0.5 s; the burst peaks at 0.5), not the noise floor', 0.15 < m['pcenter'] < 0.5)
    v = F.voiced_mask(y, A.SR)
    check('found.phrase: the floor is gated down between words (kept, not removed)', np.sqrt(np.mean(y[~v] ** 2)) < 0.5 * np.sqrt(np.mean(y[v] ** 2)) and np.abs(y[~v]).max() > 0)
    lane = np.zeros((A.SR * 6, 2))
    F.place(lane, y, 2.0, m)
    pk_lane = np.argmax(np.abs(lane[:, 0])) / A.SR
    pk_y = np.argmax(np.abs(y)) / A.SR
    check('found.place: no time-warp: the loudest sample sits (anchor - pcenter + its own offset) from the requested time within 2 ms', abs(pk_lane - (2.0 - m['pcenter'] + pk_y)) < 0.002)
    F.record(m, 2.0, 'selftest')
    rep = A.voice_report()
    check("found.record: hits.json 'voices' tallies it (found, found_items) and it is not a synthesized word vocal", rep['found'] == 1 and rep['synth_audible'] == 0
          and rep['found_items'][0]['rights'] == 'PD')
    check('found.check_rights: UNKNOWN warns, PD does not', F.check_rights(dict(rights='UNKNOWN', item='z', title='t')) != '' and F.check_rights(m) == '')
    if V.models.available('kokoro1'):
        xx, sr2 = V.models.synth('kokoro1', 'no one trusts the institutions', 'af_heart')
        syls = [dict(text=tx, t=0.15 * i, dur=0.15, stress=st, word=w, phrase=0) for i, (tx, st, w) in enumerate(
            [('NO', 2, 'no'), ('ONE', 2, 'one'), ('TRUSTS', 3, 'trusts'), ('THE', 0, 'the'), ('IN', 1, 'in'), ('sti', 0, 'in'), ('TU', 3, 'in'), ('tions', 0, 'in')])]
        yg, mg = N.anchored_checked(xx, sr2, syls, 'no one trusts the institutions')
        check('natural.anchored_checked: words within 0.1 of the raw take', mg['guard']['kept'] >= mg['guard']['raw'] - 0.1)
    else:
        print('  SKIP  Kokoro v1.0 not fetched (natural read not tested)')
    print(f"selftest c4: {sum(ok)}/{len(ok)} pass")
    return all(ok)


def audit(names):
    import importlib
    import songs
    worst = 0
    for name in names:
        A.voice_stats_reset()
        try:
            # a songs2 module key (commonwealth) first, else a songs.py function (commonwealth3, ascended_v1)
            v2 = os.path.exists(os.path.join(VIDEOS, 'web', 'audio', 'songs2', name + '.py'))
            song = importlib.import_module(f'songs2.{name}').song() if v2 else getattr(songs, name)()
            song.render()
        except Exception as e:           # a song that only fails under the guard (strict) or for other reasons
            print(f"  {name:<18} ERROR {type(e).__name__}: {e}")
            continue
        r = A.voice_report(song)
        worded = r['say_suppressed'] + r['neural_suppressed'] + r['stem_dropped']
        flag = 'AUDIBLE' if r['synth_audible'] else ('dead synth code' if worded else 'clean')
        worst = max(worst, 2 if r['synth_audible'] else 1 if worded else 0)
        print(f"  {name:<18} {flag:<16} audible {r['synth_audible']}, silenced say {r['say_suppressed']}, "
              f"neural {r['neural_suppressed']}, stems dropped {r['stem_dropped']}, wordless {r['say_wordless']}, "
              f"human takes {r['stem_human']}" + (f"  e.g. {', '.join(r['suppressed'][:4])}" if r['suppressed'] else ''))
    return worst


if __name__ == '__main__':
    a = sys.argv[1:]
    if a == ['--c2']:
        sys.exit(0 if selftest_c2() else 1)
    if a == ['--c3']:
        sys.exit(0 if selftest_c3() else 1)
    if a == ['--c4']:
        sys.exit(0 if selftest_c4() else 1)
    if not a or a == ['--selftest']:
        sys.exit(0 if selftest() else 1)
    if a == ['--all']:                   # the slate: every music-v2 module in web/audio/songs2/
        d = os.path.join(VIDEOS, 'web', 'audio', 'songs2')
        a = sorted(f[:-3] for f in os.listdir(d) if f.endswith('.py') and not f.startswith('_'))
    sys.exit(2 if audit(a) == 2 else 0)
