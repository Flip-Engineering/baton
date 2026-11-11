"""REFMEASURE: contact sheets of the c3 portraits (head and hair, numbered) for labelling hair colour by eye. LOCAL ONLY: the sheets go to
refs_local/refmeasure/hair_sheets/ and are never committed; the labels (committed) are keyed by manifest id only: hair_labels.csv.
   figvenv python hair_sheets.py [--yaw 0.35]"""
import json, os, sys
import numpy as np, cv2
import rm_common as C
import facepass as FP

def main():
    yawmax = float(sys.argv[sys.argv.index('--yaw') + 1]) if '--yaw' in sys.argv else 0.35
    P = json.load(open(os.path.join(C.OUT, 'photo_facepass.json')))['items']
    rows = {r['id']: r for r in C.portraits()}
    sel = [i for i in P if 'error' not in i['m'] and abs(i['m']['yaw']) < yawmax and i['id'] in rows]
    out = os.path.join(C.LOCAL, 'hair_sheets'); os.makedirs(out, exist_ok=True)
    T, cols, per = 230, 5, 20
    order = []
    for s0 in range(0, len(sel), per):
        tiles = []
        for k, it in enumerate(sel[s0:s0 + per]):
            rgb = FP.load_rgb(C.photo_path(rows[it['id']])); d = FP.detect(rgb)
            fr = FP.Frame(d['L'][:, :2]); c = fr.P(0, 0.9); half = 1.9 * fr.ipd * 1.15
            x0, y0 = int(c[0] - half), int(c[1] - half * 1.15); x1, y1 = int(c[0] + half), int(c[1] + half * 0.85)
            pad = np.zeros((max(0, -y0), 1, 3)); im = cv2.copyMakeBorder(rgb, max(0, -y0), max(0, y1 - rgb.shape[0]), max(0, -x0), max(0, x1 - rgb.shape[1]), cv2.BORDER_CONSTANT, value=(128, 128, 128))
            ox, oy = max(0, -x0), max(0, -y0)
            tile = im[y0 + oy:y1 + oy, x0 + ox:x1 + ox]
            tile = cv2.resize(tile, (T, T)); tile = cv2.cvtColor(tile, cv2.COLOR_RGB2BGR)
            cv2.putText(tile, str(s0 + k), (6, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 4); cv2.putText(tile, str(s0 + k), (6, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 255), 2)
            tiles.append(tile); order.append(it['id'])
        while len(tiles) % cols: tiles.append(np.zeros((T, T, 3), np.uint8))
        sheet = np.concatenate([np.concatenate(tiles[r * cols:(r + 1) * cols], 1) for r in range(len(tiles) // cols)], 0)
        cv2.imwrite(os.path.join(out, f'sheet_{s0 // per:02d}.jpg'), sheet, [cv2.IMWRITE_JPEG_QUALITY, 85])
    json.dump(order, open(os.path.join(out, 'order.json'), 'w'))
    print(len(sel), 'portraits,', (len(sel) + per - 1) // per, 'sheets ->', out)

if __name__ == '__main__': main()
