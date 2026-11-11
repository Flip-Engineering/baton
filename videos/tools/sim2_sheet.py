# Contact sheet for videos/review/lab_sim2: one labelled tile per still (latest per shot), 4 across.
import sys, os, json
from PIL import Image, ImageDraw, ImageFont
d = sys.argv[1]; order = sys.argv[2:]
files = sorted(f for f in os.listdir(d) if f.endswith('.jpg') and not f.startswith('sheet') and not f.startswith('head_study'))
if order: files = [f for o in order for f in files if f.startswith(o + '_')]
tim = json.load(open(os.path.join(d, 'timing.json'))) if os.path.exists(os.path.join(d, 'timing.json')) else {}
W, H, cols = 360, 640, 4
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (cols * W, rows * (H + 40)), (12, 12, 12))
dr = ImageDraw.Draw(sheet)
try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 15)
except Exception: font = ImageFont.load_default()
for i, f in enumerate(files):
    im = Image.open(os.path.join(d, f)).resize((W, H), Image.LANCZOS)
    x, y = (i % cols) * W, (i // cols) * (H + 40)
    sheet.paste(im, (x, y))
    shot = f.rsplit('_', 1)[0]; k = next((k for k in tim if k.split('@')[0] == shot), None)
    ms = f" warm {tim[k]['frames'][-1]['warm']} ms" if k else ''
    dr.text((x + 8, y + H + 10), f"{shot}{ms}", fill=(230, 220, 200), font=font)
out = os.path.join(d, 'sheet.jpg'); sheet.save(out, quality=90); print(out, len(files))
