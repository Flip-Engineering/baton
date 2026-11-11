"""subject_script.py: research/scripts_final/subject.json and subject15.json from the picture's timeline (lead build, 29 Sep).

    python3 tools/subject_script.py        # run from videos/

The timeline (engine/droste/timeline.py) is the contract; this mirrors its cards into the script files the gate, the scansion tools and
the song read. Card 1's "[N]" becomes the audited display from videos/sources/record/subject/subject_counts.json when it exists (the
words shown on screen), and the script keeps the rule in its notes. The record lines and attributions are listed under "records".
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
ROOT = os.path.dirname(VIDEOS)
SRC = {'M': "[M] Marx, Capital I ch. 13 (Moore/Aveling), marxists.org/archive/marx/works/1867-c1/ch13.htm [V 29 Sep, re-read by the lead build]; split only at clause boundaries.",
       'H': "[H] Haz Al-Din, Communism in the Post-MAGA Age ch. 5, infrared.gg/thought/communism-in-the-post-maga-age/05 [V 29 Sep, re-read by the lead build], the page's curly quotes; split only at clause boundaries."}


def build(key):
    chain = key not in ('subject', 'subject15')          # droste c2: chain keys (engine/droste/chains/*.json) read their own built timeline
    is15 = key == 'subject15' or key.endswith('_15')
    if chain:
        sys.path.insert(0, VIDEOS)
        from engine.droste import chains
        tl = chains.load(key)
    else:
        tl = json.load(open(os.path.join(VIDEOS, 'engine', 'droste', 'timeline.json' if key == 'subject' else 'timeline15.json')))
    cp = os.path.join(VIDEOS, 'sources', 'record', 'subject', 'subject_counts.json')
    disp = json.load(open(cp)).get('display') if os.path.exists(cp) else None
    words, frames = [], []
    for c in tl['cards']:
        if c.get('closer'):
            continue
        txt = c['text'].replace('[N] PEOPLE', disp) if disp else c['text']
        src = SRC.get(c.get('src'), c.get('src', ''))
        if is15:
            src = SRC['M'] if c['n'] in (5, 6) else SRC['H'] if c['n'] in (7, 8, 9) else 'ours / LoC 2017878060'
        w = dict(beat=c['beat'], text=txt, emphasis=False, source=src)
        if c.get('src') in ('M', 'H') or (is15 and c['n'] >= 5):
            w['verbatim'] = True
        words.append(w); frames.append(dict(beat=c['beat'], t=round(c['beat'] * 0.625, 3), text=txt))
    closer = next(c['beat'] for c in tl['cards'] if c.get('closer'))
    out = dict(words=words, bpm=96, closer_beat=closer, frames=frames,
               records=[dict(beat=r['beat'], until=r['until'], text=r['text']) for r in tl.get('records', [])],
               notes=("THE SUBJECT%s: mirrored from videos/engine/droste/%s by videos/tools/subject_script.py. Card 1 shows the audited floor from "
                      "videos/sources/record/subject/subject_counts.json (%s). Record lines are verbatim from loc.gov/item JSON and images-api.nasa.gov "
                      "(checked 29 Sep).") % ('' if key == 'subject' else ' 15 s cut', 'timeline.json' if key == 'subject' else 'timeline15.json',
                                              disp or 'not yet computed: [N] stays a placeholder'),
               genre=('Optical-track soundstage to broadcast to full band; A -> C -> Eb -> F# -> A (minor thirds, one step per stage); each stage its own recorded work sound; real recordings only, no synthesized word.' if chain else 'Optical-track soundstage to broadcast to full band; A -> C# -> F -> A (Shepard-Risset, major thirds); real recordings only, no synthesized word.'))
    p = os.path.join(ROOT, 'research', 'scripts_final', key + '.json')
    old = json.load(open(p)) if os.path.exists(p) else None
    if old and old.get('words') and [w['text'] for w in old['words']] != [w['text'] for w in words]:
        out['old_snippet'] = [w['text'] for w in old['words']]
    json.dump(out, open(p, 'w'), indent=1, ensure_ascii=False)
    print(p, [w['text'] for w in words])


if __name__ == '__main__':
    if sys.argv[1:]:
        for k in sys.argv[1:]:
            build(k)
    else:
        build('subject'); build('subject15')
