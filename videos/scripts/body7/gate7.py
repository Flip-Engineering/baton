#!/usr/bin/env python3
"""BODY7 instrument 3: gate 6 (front-silhouette widths and proportions of OUR bodies against the photographs), before | after.

  python3 videos/scripts/body7/gate7.py --photos <photo_profile7.json> --ours <ours1.json> [<ours2.json> ...] --tags before,after --out <stem>
        [--table front|fb|c4] [--legs strict|alt] [--min-n 4] [--prof-min-n 5]

Reads photo_profile7.json (photo_profile7.py) and one or more ours_profile7.json (ours_profile7.py), writes <stem>.csv and <stem>.md. Plain python3: no photograph,
no image, no third-party import.

One row per person and key. Each person is compared with two photo groups of the same sex: the HEALTHY-build group (women: slim / average / athletic; men:
lean / average / athletic = all the men) and the sex-POOLED group (all builds). Verdict, per group: PASS = inside the photos' p25-p75, NEAR = inside p10-p90
but outside p25-p75, FAIL = outside p10-p90, NA = fewer than --min-n photo values for that key (4 by default). A photo group or key with n < 8 is flagged thin.
Percentile rank = share of the group's values below ours + half the ties (rm_common.pct_rank).
Key sets: GATE = shoulder waist hip; PROPORTION = h_shoulder h_elbow h_wrist h_hip h_knee h_ankle h_crotch h_eye (heights over stature) + heads;
LEGS = thigh knee calf ankle; EXTRA = shoulder_joints chest waist_hip. PROFILE = the share of the 51 width-profile levels (photo n >= --prof-min-n at that
level) where ours lies inside the photos' IQR, for 'full' (whole silhouette extent), 'trunk' (run under the midline) and 'trunk_clean' (trunk rows without
arm contact). --legs alt takes thigh / knee / calf / ankle / h_crotch from ours_profile7's legs_alt supplement. With two or more --ours files the md and csv carry a before | after layout.
"""
import argparse, csv, json, os, sys

THIN = 8
SETS = dict(GATE=['shoulder', 'waist', 'hip'],
            PROPORTION=['h_shoulder', 'h_elbow', 'h_wrist', 'h_hip', 'h_knee', 'h_ankle', 'h_crotch', 'h_eye', 'heads'],
            LEGS=['thigh', 'knee', 'calf', 'ankle'], EXTRA=['shoulder_joints', 'chest', 'waist_hip'])
KEY_SET = {k: s for s, ks in SETS.items() for k in ks}
ORDER = [k for s in ('GATE', 'PROPORTION', 'LEGS', 'EXTRA') for k in SETS[s]]
PROFILE_KINDS = ['full', 'trunk', 'trunk_clean']
LETTER = dict(PASS='P', NEAR='N', FAIL='F', NA='-', NONE='.')


def pct_rank(v, vals):
    if v is None or not vals: return None
    return round(100.0 * sum(1 for x in vals if x < v) / len(vals) + 50.0 * sum(1 for x in vals if x == v) / len(vals), 1)


def verdict(v, q, min_n):
    """-> (verdict, side) ; side = below p10 / below IQR / within IQR / above IQR / above p90"""
    if v is None: return 'NONE', ''                      # ours has no clean read of this key
    if not q or q.get('n', 0) < min_n: return 'NA', ''   # too few photo values
    side = 'below p10' if v < q['p10'] else 'below IQR' if v < q['p25'] else 'within IQR' if v <= q['p75'] else 'above IQR' if v <= q['p90'] else 'above p90'
    return ('PASS' if q['p25'] <= v <= q['p75'] else 'NEAR' if q['p10'] <= v <= q['p90'] else 'FAIL'), side


def profile_share(ours, prof, min_n):
    """ours: 51 values (or None); prof: the photo group's per-level stats -> (share inside p25-p75, levels compared)"""
    inside = tot = 0
    for v, e in zip(ours, prof):
        if v is None or e.get('n', 0) < min_n: continue
        tot += 1; inside += e['p25'] <= v <= e['p75']
    return (round(inside / tot, 3) if tot else None), tot


def fmt(v, d=4):
    return '' if v is None else (f'{v:.{d}f}' if isinstance(v, float) else str(v))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--photos', required=True); ap.add_argument('--ours', nargs='+', required=True); ap.add_argument('--tags', default=None)
    ap.add_argument('--out', required=True); ap.add_argument('--table', default='front', choices=['front', 'fb', 'c4'])
    ap.add_argument('--min-n', type=int, default=4); ap.add_argument('--prof-min-n', type=int, default=5)
    ap.add_argument('--legs', default='strict', choices=['strict', 'alt'], help="strict = derive.measure()'s own leg / crotch read (the brief); alt = ours_profile7's legs_alt supplement (midline moved into the crotch gap)")
    a = ap.parse_args()
    P = json.load(open(a.photos)); T = P['tables'][a.table]; G = T['groups']
    O = [json.load(open(f)) for f in a.ours]
    if a.legs == 'alt':
        for o in O:
            for p in o['people'].values():
                if p.get('legs_alt', {}).get('vals'): p['vals'].update(p['legs_alt']['vals'])
    tags = a.tags.split(',') if a.tags else [o.get('tag', f'ours{i}') for i, o in enumerate(O)]
    assert len(tags) == len(O), 'one tag per --ours file'
    names = [n for n in O[0]['people'] if all(n in o['people'] for o in O)]
    keys = [k for k in ORDER if k in P['keys']]
    two = len(O) > 1

    rows, summ = [], {}                       # summ[(sex, tag, key, 'h'|'p')] = Counter-like dict
    for n in names:
        p0 = O[0]['people'][n]; sx = p0['sex']
        gh, gp = G[f'{sx}_healthy'], G[f'{sx}_all']
        for k in keys:
            qh, qp = gh['keys'][k], gp['keys'][k]
            r = dict(row_type='scalar', person=n, sex=sx, age=p0.get('age'), bg=p0.get('bg'), key=k, key_set=KEY_SET[k],
                     group_h=f'{sx}_healthy', n_h=qh['n'], thin_h=qh['n'] < THIN, group_p=f'{sx}_all', n_p=qp['n'], thin_p=qp['n'] < THIN)
            for q, s in ((qh, 'h'), (qp, 'p')):
                for c in ('p10', 'p25', 'p50', 'p75', 'p90'): r[f'{c}_{s}'] = q.get(c)
            for t, o in zip(tags, O):
                v = o['people'][n]['vals'].get(k); r[f'value_{t}'] = v
                for q, s in ((qh, 'h'), (qp, 'p')):
                    vd, side = verdict(v, q, a.min_n)
                    r[f'rank_{s}_{t}'] = pct_rank(v, q.get('vals', [])) if vd != 'NA' else None; r[f'verdict_{s}_{t}'] = vd; r[f'side_{s}_{t}'] = side
                    c = summ.setdefault((sx, t, k, s), dict(PASS=0, NEAR=0, FAIL=0, NA=0, NONE=0)); c[vd] += 1
            rows.append(r)
        for kind in PROFILE_KINDS:
            r = dict(row_type='profile', person=n, sex=sx, age=p0.get('age'), bg=p0.get('bg'), key='PROFILE_' + kind, key_set='PROFILE',
                     group_h=f'{sx}_healthy', n_h=gh['n_images'], thin_h=gh['n_images'] < THIN, group_p=f'{sx}_all', n_p=gp['n_images'], thin_p=gp['n_images'] < THIN)
            for t, o in zip(tags, O):
                for g, s in ((gh, 'h'), (gp, 'p')):
                    sh, tot = profile_share(o['people'][n]['profile_' + kind], g['profile'][kind], a.prof_min_n)
                    if s == 'h': r[f'value_{t}'] = sh                                  # value = the share against the healthy group; the pooled share in rank_p_<tag>
                    r[f'rank_{s}_{t}'] = sh; r[f'nlev_{s}_{t}'] = tot
            rows.append(r)

    # ---------------------------------------------------------------- csv
    cols = ['row_type', 'person', 'sex', 'age', 'bg', 'key', 'key_set', 'group_h', 'n_h', 'thin_h', 'p10_h', 'p25_h', 'p50_h', 'p75_h', 'p90_h',
            'group_p', 'n_p', 'thin_p', 'p10_p', 'p25_p', 'p50_p', 'p75_p', 'p90_p']
    for t in tags: cols += [f'value_{t}', f'rank_h_{t}', f'verdict_h_{t}', f'side_h_{t}', f'rank_p_{t}', f'verdict_p_{t}', f'side_p_{t}', f'nlev_h_{t}', f'nlev_p_{t}']
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out + '.csv', 'w', newline='') as f:
        w = csv.writer(f); w.writerow(cols)
        def cellv(r, c):
            v = r.get(c)
            if isinstance(v, bool): return str(v)
            if c.startswith('rank_') or c.startswith('nlev_') or c in ('age',): return '' if v is None else (str(v) if isinstance(v, int) else (f'{v:.1f}' if c.startswith('rank_') and r['row_type'] == 'scalar' else f'{v:.3f}'))
            return fmt(v)
        for r in rows: w.writerow([cellv(r, c) for c in cols])

    # ---------------------------------------------------------------- md
    L = []
    ap_ = L.append
    ap_(f'# BODY7 gate 6: {" | ".join(tags)}  (photo table `{a.table}`)\n')
    legs_txt = ("strict derive.measure() read (crotch found only where no run contains the landmark midline)" if a.legs == "strict" else
                "ALT read (ours_profile7 legs_alt: midline moved into the crotch gap, then the same derive.measure(); the photo side is always the strict read)")
    ap_("Leg widths and crotch height: %s." % legs_txt)
    n_ours = ", ".join("%s = %d people" % (t, len(o["people"])) for t, o in zip(tags, O))
    view_txt = "front + back views" if a.table == "fb" else "front view"
    shard_txt = ", shard c4:new only" if a.table == "c4" else ""
    ap_("Photo table `%s`: %d images (%s%s), modern typical figure studies, full crop, standing, unit = stature. Ours: %s." % (a.table, T["n_stature"], view_txt, shard_txt, n_ours))
    ap_('Verdict per photo group: P = PASS (inside p25-p75), N = NEAR (inside p10-p90), F = FAIL (outside p10-p90), - = NA (< %d photo values). Cell `H/P` = healthy-build group / sex-pooled group. `thin` = photo n < %d.\n' % (a.min_n, THIN))
    ap_('## Photo groups used (n of photo values per key)\n')
    ap_('| group | images | thin | builds | ' + ' | '.join(keys) + ' |'); ap_('|' + '---|' * (4 + len(keys)))
    for g in ('f_healthy', 'f_all', 'm_healthy', 'm_all'):
        q = G[g]; ap_(f'| {g} | {q["n_images"]} | {"thin" if q["thin"] else ""} | {", ".join(f"{b} {c}" for b, c in q["builds"].items())} | ' +
                      ' | '.join(f'{q["keys"][k]["n"]}{"*" if q["keys"][k]["n"] < THIN else ""}' for k in keys) + ' |')
    ap_('\n`*` = thin (n < %d). Photo quartiles of the healthy groups (p10 / p25 / p50 / p75 / p90):\n' % THIN)
    ap_('| key | ' + ' | '.join(f'{g}' for g in ('f_healthy', 'm_healthy')) + ' |'); ap_('|---|---|---|')
    for k in keys:
        cell = lambda g: ' / '.join(fmt(G[g]['keys'][k].get(c), 3) for c in ('p10', 'p25', 'p50', 'p75', 'p90')) + f' (n {G[g]["keys"][k]["n"]})'
        ap_(f'| {k} | {cell("f_healthy")} | {cell("m_healthy")} |')

    def extra(c): return (f' +{c["NONE"]} none' if c['NONE'] else '') + (f' +{c["NA"]} na' if c['NA'] else '')
    def cnt(sx, t, k, s):
        c = summ.get((sx, t, k, s))
        return '' if c is None else f'{c["PASS"]}/{c["NEAR"]}/{c["FAIL"]}' + extra(c)
    def setsum(sx, t, ks, s):
        tot = dict(PASS=0, NEAR=0, FAIL=0, NA=0, NONE=0)
        for k in ks:
            c = summ.get((sx, t, k, s))
            if c:
                for x in tot: tot[x] += c[x]
        return f'{tot["PASS"]}/{tot["NEAR"]}/{tot["FAIL"]}' + extra(tot)
    ap_('\n## Summary: persons PASS / NEAR / FAIL per key\n')
    for sx, lab in (('f', 'women'), ('m', 'men')):
        np_ = sum(1 for n in names if O[0]['people'][n]['sex'] == sx)
        ap_(f'### {lab} ({np_} people); cells PASS/NEAR/FAIL (+none = ours has no read, +na = fewer than {a.min_n} photo values), healthy group | pooled group\n')
        hdr = '| key | set | n_h | n_p | ' + ' | '.join(f'H {t}' for t in tags) + ' | ' + ' | '.join(f'P {t}' for t in tags) + ' |'
        ap_(hdr); ap_('|' + '---|' * (4 + 2 * len(tags)))
        for k in keys:
            qh, qp = G[f'{sx}_healthy']['keys'][k], G[f'{sx}_all']['keys'][k]
            ap_(f'| {k} | {KEY_SET[k]} | {qh["n"]}{"*" if qh["n"] < THIN else ""} | {qp["n"]}{"*" if qp["n"] < THIN else ""} | ' +
                ' | '.join(cnt(sx, t, k, 'h') for t in tags) + ' | ' + ' | '.join(cnt(sx, t, k, 'p') for t in tags) + ' |')
        for s_, ks in SETS.items():
            ap_(f'| **{s_} total** | | | | ' + ' | '.join(setsum(sx, t, ks, 'h') for t in tags) + ' | ' + ' | '.join(setsum(sx, t, ks, 'p') for t in tags) + ' |')
        ap_('')
    ap_('### PROFILE: mean share of the 51 levels inside the photo IQR (healthy | pooled), per sex\n')
    ap_('| sex | kind | ' + ' | '.join(f'H {t} | P {t}' for t in tags) + ' |'); ap_('|' + '---|' * (2 + 2 * len(tags)))
    for sx in 'fm':
        for kind in PROFILE_KINDS:
            cells = []
            for t in tags:
                for s in 'hp':
                    v = [r[f'rank_{s}_{t}'] for r in rows if r['row_type'] == 'profile' and r['sex'] == sx and r['key'] == 'PROFILE_' + kind and r.get(f'rank_{s}_{t}') is not None]
                    cells.append(f'{sum(v) / len(v):.2f}' if v else '')
            ap_(f'| {sx} | {kind} | ' + ' | '.join(cells) + ' |')

    def cell(r):
        out = []
        for t in tags:
            v = r.get(f'value_{t}')
            out.append('none' if v is None else f'{v:.4f} {LETTER[r[f"verdict_h_{t}"]]}/{LETTER[r[f"verdict_p_{t}"]]}' + (f' (r{r[f"rank_h_{t}"]:.0f})' if r.get(f'rank_h_{t}') is not None else ''))
        return ' → '.join(out) if two else out[0]
    ap_('\n## Per person: value, verdict healthy/pooled, percentile rank in the healthy group (rN)\n')
    for s_ in ('GATE', 'PROPORTION', 'LEGS', 'EXTRA'):
        ks = [k for k in SETS[s_] if k in keys]
        ap_(f'### {s_}\n'); ap_('| person | ' + ' | '.join(ks) + ' |'); ap_('|' + '---|' * (1 + len(ks)))
        for n in names:
            rr = {r['key']: r for r in rows if r['person'] == n and r['row_type'] == 'scalar'}
            ap_(f'| {n} | ' + ' | '.join(cell(rr[k]) for k in ks) + ' |')
        ap_('')
    ap_('### PROFILE share of levels inside the photo IQR (healthy / pooled; levels compared)\n')
    ap_('| person | ' + ' | '.join(PROFILE_KINDS) + ' |'); ap_('|' + '---|' * (1 + len(PROFILE_KINDS)))
    for n in names:
        cells = []
        for kind in PROFILE_KINDS:
            r = next(r for r in rows if r['person'] == n and r['key'] == 'PROFILE_' + kind)
            cells.append(' → '.join(f'{fmt(r.get(f"rank_h_{t}"), 2)}/{fmt(r.get(f"rank_p_{t}"), 2)} ({r.get(f"nlev_h_{t}")})' for t in tags))
        ap_(f'| {n} | ' + ' | '.join(cells) + ' |')
    open(a.out + '.md', 'w').write('\n'.join(L) + '\n')
    print('wrote', a.out + '.csv', a.out + '.md', f'({len(rows)} rows, {len(names)} people)')


if __name__ == '__main__':
    main()
