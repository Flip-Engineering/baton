"""REFMEASURE comparison (RETIRED (8 Oct 2026): the comparison tables and pass bands no longer judge the people. Our renders are judged by looking at them beside the references at the same crop and size (refmeasure.py board / localboard, hair_sheets.py), not by where a number falls in the photographs' spread. Nothing in the studio runs this to judge a person; it is kept so the committed result files of round 7 can be read.)

Was: our value per person against the photographs' distribution in the person's gate group, PASS / FAIL, and the cast-level read.

Per person and key:  value, the gate group used ((sex, background) when it holds >= min_n photos, else sex, else all), that group's p10 p25 p50 p75 p90,
  PASS / FAIL against the interquartile range (gate 'iqr') or p10-p90 (gate 'wide'), where the value sits ('below p10' ... 'above p90'), its percentile rank
  among the photos and a z-like distance z = (value - photo median) / (IQR / 1.349).
Per key (the cast of twelve):  how many of the twelve are inside the IQR and inside p10-p90, the median z (the cast's bias in photo-spread units),
  and the verdict. WHY THE VERDICT IS NOT 'ALL TWELVE INSIDE THE IQR': by construction half of any real group falls outside its own IQR, so a person-by-person
  IQR gate fails 6 of 12 real people on average. The verdict is therefore about the CAST: PASS when the cast's median sits inside the photos' IQR
  (|median z| < 0.67) and at least 75 % of the judged people are inside p10-p90 (what 12 real people would do about 80 % of the time); the person-level IQR
  PASS / FAIL is reported beside it, as asked, and is the right gate only for a single hero face that must read as typical.

8 Oct revision (CHECK.md; NOTES.md 'INSTRUMENTS REVISED'). The verdict string is one of
  PASS | FAIL (direction in 'direction')                     as before
  NO GATE        the photo group the person is compared with holds fewer than no_gate_below photographs (clothing: 7 trouser photographs are not a gate), or the
                 cast has nobody left to judge after the background rule below; the value is still reported, nothing PASSES or FAILS
  NO VERDICT     more than max_fail (2) of the cast's N people could not be judged (no plate, a JPEG plate, no face, turned, mouth open, a patch rejected, a lip
                 key on a background with fewer than bg_min photographs ...): the reasons are in 'not_judged' and in each row's 'note'; the survivors' read is kept
                 as 'indicative' and is not a gate
  small_n        True whenever the group has fewer than SMALL_N (15) photographs, whatever floor the call used to pick the group (before, min_n=5 made it False for 7)
"""
import numpy as np
import rm_common as C

MIN_N = 15
SMALL_N = 15
MAX_FAIL = 2
EDGE = 0.15


def z_of(v, q):
    iqr = q['p75'] - q['p25']
    return None if iqr <= 0 else (v - q['p50']) / (iqr / 1.349)


def cast_read(rows, key, need_frac=0.75):
    """the cast read of already-compared rows: (PASS | FAIL | None, direction, median z, counts)"""
    ok = [r for r in rows if r['gate_iqr']]
    zs = [r['z'] for r in ok if r['z'] is not None]
    if not ok: return None, '', None, 0
    n_wide = sum(r['gate_wide'] == 'PASS' for r in ok); need = int(np.ceil(need_frac * len(ok)))
    mz = float(np.median(zs)) if zs else None
    v = 'PASS' if (mz is not None and abs(mz) < 0.67 and n_wide >= need) else 'FAIL'
    return v, ('' if v == 'PASS' else ('above' if (mz or 0) > 0 else 'below')), mz, len(ok)


def compare_people(people, key, dists, gate='iqr', min_n=MIN_N, by=('sex', 'bg'), no_gate_below=None, bg_min=None, max_fail=MAX_FAIL):
    """people: list of dicts with name, sex, bg, key -> value (None = not measured, then 'note' says why). dists: {(sex, bg): quant} from rm_common.group_dists.
    by: ('sex','bg') the finest group with n >= min_n, then sex, then all; ('bg',) the background alone (skin); ('sex',) the person's own sex only (clothing, no pooling).
    no_gate_below: a person whose photo group has fewer photographs than this is NO GATE. bg_min: a person whose background (both sexes) has fewer than this many
    photographs in dists is NO GATE (the lip keys). Returns (rows, summary)."""
    rows = []
    for p in people:
        v = p.get(key)
        if by == ('bg',):    # skin: the background group alone (both sexes pooled)
            g, q = None, None
            for k in ((None, p['bg']), (None, None)):
                if dists.get(k, {}).get('n', 0) >= min_n: g, q = k, dists[k]; break
            if q is None: g = (None, None); q = dists.get(g)
        elif by == ('sex',):
            g = (p['sex'], None); q = dists.get(g) or dict(n=0)
        else:
            g, q = C.pick_dist(dists, p['sex'], p['bg'], min_n)
        row = dict(name=p['name'], sex=p['sex'], bg=p['bg'], key=key, value=None if v is None else round(float(v), 4), group=f"{g[0] or 'all'}|{g[1] or 'all'}" if g else '', n_photos=(q or {}).get('n', 0),
                   note=p.get('note', ''))
        floor = min(8, min_n)
        small = (q or {}).get('n', 0) < SMALL_N
        why_no_gate = None
        if v is not None and q and no_gate_below and q.get('n', 0) < no_gate_below:
            why_no_gate = f"NO GATE: only {q.get('n', 0)} photographs in {row['group']} (< {no_gate_below})"
        if v is not None and bg_min and dists.get((None, p['bg']), {}).get('n', 0) < bg_min:
            nb = dists.get((None, p['bg']), {}).get('n'); why_no_gate = f"NO GATE: background {p['bg']} has {'fewer than 5' if nb is None else nb} photographs (< {bg_min})"
        if v is not None and q and q.get('n', 0) >= floor and not why_no_gate:
            for k in ('p10', 'p25', 'p50', 'p75', 'p90'): row[k] = q[k]
            row['gate_iqr'] = C.gate(v, q, floor=floor); row['gate_wide'] = C.gate(v, q, wide=True, floor=floor); row['side'] = C.side(v, q, floor=floor)
            row['z'] = None if z_of(v, q) is None else round(z_of(v, q), 2)
            row['small_n'] = small
        else:
            row.update(gate_iqr=None, gate_wide=None, side='', z=None, small_n=True)
            if why_no_gate:
                row['note'] = why_no_gate; row['no_gate'] = True
                if q and q.get('n', 0) >= floor and z_of(v, q) is not None:       # the direction only, against the group the person would have been compared with
                    row['z_info'] = round(z_of(v, q), 2); row['side_info'] = C.side(v, q, floor=floor)
                    row['note'] += f" (indicative only: z {row['z_info']:+.1f} against {row['group']}, n={q['n']})"
            elif v is not None: row['note'] = (row['note'] + '; ' if row['note'] else '') + f"NO GATE: only {(q or {}).get('n', 0)} photographs"; row['no_gate'] = True
            elif not row['note']: row['note'] = 'not measured'
        rows.append(row)
    ok = [r for r in rows if r['gate_iqr']]
    failed = [r for r in rows if r['value'] is None]
    no_gate = [r for r in rows if r.get('no_gate')]
    zs = [r['z'] for r in ok if r['z'] is not None]
    n = len(rows)
    s = dict(key=key, n=n, n_measured=len(ok), n_failed=len(failed), n_no_gate=len(no_gate), n_in_iqr=sum(r['gate_iqr'] == 'PASS' for r in ok), n_in_p10_p90=sum(r['gate_wide'] == 'PASS' for r in ok),
             median=None if not ok else round(float(np.median([r['value'] for r in ok])), 4), median_z=None if not zs else round(float(np.median(zs)), 2),
             min_photo_n=min([r['n_photos'] for r in ok], default=0),
             not_judged={r['name']: r['note'] for r in rows if r['value'] is None or r.get('no_gate')})
    read, direction, mz, _ = cast_read(rows, key)
    s['read'] = read; s['read_direction'] = direction          # the survivors' cast read, whatever the verdict below says
    s['median_value'] = None if not [r['value'] for r in rows if r['value'] is not None] else round(float(np.median([r['value'] for r in rows if r['value'] is not None])), 4)   # also when nothing is gated
    s['edge'] = bool(mz is not None and abs(abs(mz) - 0.67) <= EDGE)        # the median z is within EDGE of the 0.67 line: with 15-40 photographs it moves by ~0.3 between photo sets, so PASS / FAIL there is a coin flip
    if not ok and not failed and no_gate: s['verdict'] = 'NO GATE'; s['direction'] = ''
    elif not ok: s['verdict'] = 'NO DATA' if not no_gate else 'NO GATE'; s['direction'] = ''
    elif len(failed) + len(no_gate) > max_fail:
        s['verdict'] = 'NO VERDICT'; s['direction'] = ''
        s['indicative'] = read if len(ok) >= 2 else None; s['indicative_direction'] = direction
    else:
        s['verdict'] = read; s['direction'] = direction
    s['verdict_text'] = verdict_text(s)
    return rows, s


def verdict_text(s):
    v = s.get('verdict')
    if v == 'NO VERDICT':
        ind = s.get('indicative')
        return f"NO VERDICT ({s['n_failed'] + s['n_no_gate']} of {s['n']} not judged)" + (f"; survivors say {ind}{(' ' + s['indicative_direction']) if s.get('indicative_direction') else ''} (n={s['n_measured']}, indicative)" if ind else '')
    if v == 'NO GATE': return 'NO GATE'
    edge = f" (edge: median z {s['median_z']:+.2f}, within {EDGE} of the 0.67 line)" if s.get('edge') and v in ('PASS', 'FAIL') else ''
    if v == 'FAIL': return 'FAIL ' + s.get('direction', '') + edge
    return (v or '') + edge


def comparison_rows_csv(measure, tag, rows):
    out = []
    for r in rows:
        out.append(dict(measure=measure, tag=tag, **{k: r.get(k, '') for k in ('key', 'name', 'sex', 'bg', 'value', 'group', 'n_photos', 'p10', 'p25', 'p50', 'p75', 'p90', 'gate_iqr', 'gate_wide', 'side', 'z', 'small_n', 'note', 'p5', 'p95')}))
    return out
