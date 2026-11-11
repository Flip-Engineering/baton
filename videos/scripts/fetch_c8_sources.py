#!/usr/bin/env python3
"""MUSIC c8: fetch what `ingest_c8_sources.py` cuts up.  Everything is fetched by HTTP (range members of a Zenodo zip, flac files of
archive.org items); delete DIR afterwards (the repo keeps only the cut events, about 15 MB).

    python3 videos/scripts/fetch_c8_sources.py DIR [--pirogov]
      DIR/vs/FULL/male*/...          VocalSet (Wilkins, Seetharaman, Wahl, Pardo, ISMIR 2018; Zenodo 1193957): CC BY 4.0, the eleven men's
                                     long_tones/forte, arpeggios/{belt,vocal_fry,fast_forte}, scales/vocal_fry, vowels a o u  (about 130 MB)
      DIR/rl/*.flac                  "Red Library" / "GOLD TAPE" sound effects of the USC Cinema and the Sunset Editorial Collection, archive.org,
                                     labelled CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/): single men's grunts, strains and
                                     breaths, groups of men, marching on dirt and gravel, horses, a steam locomotive getting up to speed
      DIR/ref/pirogov.flac           (--pirogov) Pirogov and chorus, "Dubinushka" (Pathe 21746, 1910, public domain): the reference for the HUH
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request

RL = {
    "Red_Library_Crowds_Men": ["R07-46", "R16-08", "R15-70", "R15-73", "R08-04", "R08-07", "R24-01"],
    "Red_Library_Voices_Men_1": ["R15-30", "R15-52", "R15-33", "R15-34", "R15-31", "R21-14", "R21-12", "R21-21"],
    "Red_Library_Voices_Men_2": ["R19-16", "R26-08", "R27-23", "R19-24", "R24-03"],
    "Red_Library_Footsteps_4": ["R16-15", "R16-16", "R24-02", "R27-40", "R23-64", "R17-22", "R19-19"],
    "Red_Library_Animals_Horses_3": ["R14-25", "R14-11", "R14-18"],
    "Red_Library_Animals_Horses_4": ["R23-51", "R14-32", "R23-57"],
    "GOLD_TAPE_47_48_49_Trains": ["G47-04", "G47-08"],
    "Red_Library_Trains": ["R20-40"],
}


def get(url, dest):
    if os.path.exists(dest):
        return
    data = urllib.request.urlopen(url, timeout=240).read()
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    open(dest, "wb").write(data)
    print("ok", os.path.basename(dest), len(data), flush=True)


def main(D, pirogov=False):
    os.makedirs(D, exist_ok=True)
    for item, prefixes in RL.items():
        md = json.load(urllib.request.urlopen(f"https://archive.org/metadata/{item}", timeout=60))
        names = [f["name"] for f in md["files"] if f["name"].endswith(".flac")]
        for p in prefixes:
            for n in names:
                if n.startswith(p):
                    get(f"https://archive.org/download/{item}/{urllib.parse.quote(n)}", os.path.join(D, "rl", n.replace(" ", "_")))
    if pirogov:
        get("https://archive.org/download/78_dubinushka_335_11/Dubinushka%20-%20Grigoris.%20Pirogovg.%20-%20Anatol%20Alexandrov.flac", os.path.join(D, "ref", "pirogov.flac"))
    from remotezip import RemoteZip
    pat = re.compile(r"FULL/male(\d+)/(long_tones/forte|arpeggios/belt|arpeggios/vocal_fry|arpeggios/fast_forte|scales/vocal_fry)/.*_[aou]\.wav$")
    with RemoteZip("https://zenodo.org/api/records/1193957/files/VocalSet.zip/content") as z:
        for n in z.namelist():
            if pat.search(n) and not os.path.exists(os.path.join(D, "vs", n)):
                z.extract(n, os.path.join(D, "vs"))
    print("done", D)


if __name__ == "__main__":
    main(sys.argv[1], "--pirogov" in sys.argv)
