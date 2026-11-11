"""MUSIC c7: fetch ONLY the members of two big Zenodo zips that c7_men needs, by HTTP range (pip install remotezip pyworld).

    python3 videos/scripts/fetch_c7_sources.py DIR       # -> DIR/vs/FULL/male*/long_tones/{forte,straight}/*_{a,o}.wav (35 MB),
                                                         #    DIR/csd/ChoralSingingDataset/CSD_ND_bass_{1-4}.wav + notes (71 MB)
    python3 videos/scripts/ingest_c7_sources.py --vs DIR/vs --csd DIR/csd/ChoralSingingDataset      # -> sources/audio/inst/c7_men (19 MB)

VocalSet (Wilkins, Seetharaman, Wahl, Pardo, ISMIR 2018; Zenodo 1193957, 2.1 GB zip): CC BY 4.0.
Choral Singing Dataset (Cuesta, Gomez, Martorell, Loaiciga 2018; Zenodo 2649950, 1.07 GB zip): CC BY 4.0.
Delete DIR afterwards: the bank is built and the disk is tight."""
import os, re, sys
from remotezip import RemoteZip
D = sys.argv[1]
with RemoteZip("https://zenodo.org/api/records/1193957/files/VocalSet.zip/content") as z:
    for n in z.namelist():
        if re.search(r"FULL/male\d+/long_tones/(forte|straight)/.*_(a|o)\.wav$", n):
            z.extract(n, os.path.join(D, "vs"))
with RemoteZip("https://zenodo.org/api/records/2649950/files/ChoralSingingDataset.zip/content") as z:
    for n in [f"CSD_ND_bass_{i}.wav" for i in (1, 2, 3, 4)] + ["CSD_ND_bass_notes.lab", "README.txt"]:
        z.extract("ChoralSingingDataset/" + n, os.path.join(D, "csd"))
print("ok", D)
