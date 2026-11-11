"""Hit-map check: does the song run past the picture? (A song that ends before the closer is breakage.)
    python3 videos/scripts/validate_hits.py <script_key> <hits.json> [--closer BEAT]
Reads research/scripts_final/<script_key>.json and the hits file, prints the BPM, length and the text frames with their times,
and with --closer checks that the song lasts past the closer beat + 1.4 s. How the words and the music land together is heard.
Exit code 1 only when the song is shorter than the picture."""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

key, path = sys.argv[1], sys.argv[2]
closer = float(sys.argv[sys.argv.index('--closer') + 1]) if '--closer' in sys.argv else None
f = json.load(open(os.path.join(ROOT, 'research', 'scripts_final', f'{key}.json')))
h = json.load(open(path)); spb = 60 / h['bpm']
bad = []
if closer is not None and h['duration'] < closer * spb + 1.4:
    bad.append(f"song ends at {h['duration']:.2f}s, before closer beat {closer} + 1.4 s ({closer * spb + 1.4:.2f}s)")
words = [w for w in f['words'] if w.get('text')]
print(f"{key}: {h['bpm']} BPM, {h['bars']} bars, {h['duration']:.2f}s, {len(words)} text frames, {len(h.get('text', []))} voiced text events")
for w in words:
    print(f"  beat {w['beat']:>6}  {w['beat'] * spb:6.2f}s  {w['text']}")
if bad:
    print('\n'.join(bad))
sys.exit(1 if bad else 0)
