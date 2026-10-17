#!/usr/bin/env python3
"""Compose editable Flip poses, accessories, and brand emblems."""
import copy
import json
import re
import subprocess
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NS = "{http://www.w3.org/2000/svg}"
ET.register_namespace("", NS[1:-1])

def prefix_ids(tree, prefix):
    ids = {e.attrib["id"]: prefix + e.attrib["id"] for e in tree.iter() if "id" in e.attrib}
    for e in tree.iter():
        if "id" in e.attrib:
            e.set("id", ids[e.attrib["id"]])
        for key, value in list(e.attrib.items()):
            for old, new in ids.items():
                value = value.replace("url(#" + old + ")", "url(#" + new + ")")
                if key.endswith("href") and value == "#" + old:
                    value = "#" + new
            e.set(key, value)
    return tree

def resolved(tree):
    tree = copy.deepcopy(tree)
    def walk(e, inherited):
        palette = dict(inherited)
        styles = []
        for pair in e.get("style", "").split(";"):
            if ":" in pair:
                key, value = pair.split(":", 1)
                if key.strip().startswith("--"):
                    palette[key.strip()] = value.strip()
                else:
                    styles.append(pair)
        e.attrib.pop("style", None)
        if styles:
            e.set("style", ";".join(styles))
        for key, value in list(e.attrib.items()):
            e.set(key, re.sub(r"var\((--[\w-]+)\)", lambda m: palette[m[1]], value))
        for child in e:
            walk(child, palette)
    walk(tree, {})
    return tree

def render(svg, target, size):
    temporary = target.with_suffix(".render.svg")
    ET.ElementTree(resolved(svg)).write(temporary, encoding="utf-8", xml_declaration=True)
    renderer = shutil.which("rsvg-convert")
    if renderer is None:
        raise SystemExit("rsvg-convert must be available on PATH")
    try:
        subprocess.run([renderer, "--width", str(size), "--height", str(size), "--output", str(target), str(temporary)], check=True)
    finally:
        temporary.unlink(missing_ok=True)

def compose(settings, variant):
    root = ET.Element(NS + "svg", {"viewBox": "0 0 200 200", "width": "200", "height": "200", "role": "img", "aria-label": variant["label"]})
    ET.SubElement(root, NS + "title").text = variant["label"]
    ET.SubElement(root, NS + "path", {"id": variant["key"] + "-background", "d": "M0 0H200V200H0Z", "fill": settings["background"]})
    frame = ET.SubElement(root, NS + "g", {"id": variant["key"] + "-frame", "transform": settings["characterTransform"]})
    stage = ET.SubElement(frame, NS + "g", {"id": variant["key"] + "-stage", "transform": variant.get("poseTransform", "translate(0 0)")})
    character = ET.parse(ROOT / "base-character.svg").getroot().find(NS + "g")
    foreground = []
    if variant.get("pose"):
        pose = ET.parse(ROOT / variant["pose"]).getroot()
        replacements = {part.get("data-replaces"): part for part in pose if part.get("data-replaces")}
        for index, child in enumerate(list(character)):
            if child.get("id") in replacements:
                replacement = copy.deepcopy(replacements[child.get("id")])
                character.remove(child)
                if replacement.get("data-layer") == "foreground":
                    foreground.append(replacement)
                else:
                    character.insert(index, replacement)
    front = []
    for index, spec in enumerate(variant["modules"]):
        wrapper = ET.Element(NS + "g", {"id": variant["key"] + "-module-" + str(index), "transform": "translate(%s %s)" % tuple(settings["anchors"][spec["anchor"]]), "data-anchor": spec["anchor"], "data-layer": spec["layer"]})
        source = prefix_ids(ET.parse(ROOT / spec["source"]).getroot(), variant["key"] + "-accessory-" + str(index) + "-")
        for child in source:
            if child.tag != NS + "title":
                wrapper.append(copy.deepcopy(child))
        if spec.get("emblem"):
            emblem = ET.SubElement(wrapper, NS + "g", {"id": variant["key"] + "-emblem-" + str(index), "transform": spec["emblem"]["transform"], "data-source": spec["emblem"]["source"]})
            raw = prefix_ids(ET.parse(ROOT / spec["emblem"]["source"]).getroot(), variant["key"] + "-emblem-" + str(index) + "-")
            for attribute in ["color", "fill", "stroke", "style"]:
                if attribute in raw.attrib:
                    emblem.set(attribute, raw.get(attribute))
            for child in raw:
                if child.tag != NS + "title":
                    emblem.append(copy.deepcopy(child))
        if spec["layer"] == "back":
            stage.append(wrapper)
        else:
            front.append(wrapper)
    stage.append(prefix_ids(copy.deepcopy(character), variant["key"] + "-"))
    stage.extend(front)
    if foreground:
        hands = ET.SubElement(stage, NS + "g", {"id": variant["key"] + "-foreground", "style": character.get("style", "")})
        for part in foreground:
            hands.append(prefix_ids(part, variant["key"] + "-"))
    return root

def gallery(settings):
    import html
    cards = []
    for variant in settings["variants"]:
        name = html.escape(variant["displaySeries"])
        asset = html.escape(variant["assetId"])
        cards.append(f'<article><h2>{name}</h2><img class="actual" src="avatars/{asset}-60.png" width="60" height="60" alt="{name} avatar at 60 pixels"><p>60 px circle crop</p><img src="avatars/{asset}.png" width="200" height="200" alt="{name} illustration"><p>200 px illustration</p><img class="actual" src="avatars/{asset}-32.png" width="32" height="32" alt="{name} avatar at 32 pixels"><p>32 px circle crop</p></article>')
    return '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Flip series avatars</title><style>body{margin:0;background:#faf9f6;color:#3e454b;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1370px;padding:28px;margin:auto}h1{font-size:22px;margin:0 0 8px;font-weight:600}h2{font-size:14px;margin:0 0 22px;font-weight:600}.grid{display:grid;grid-template-columns:repeat(6,minmax(210px,1fr));gap:14px}article{background:white;text-align:center;padding:22px 10px;border:1px solid #e8e5de;border-radius:10px}img{display:block;margin:auto}.actual{border-radius:50%}p{font-size:11px;color:#71797e;margin:5px 0 22px}@media(max-width:1100px){.grid{grid-template-columns:repeat(3,minmax(210px,1fr))}}@media(max-width:710px){.grid{grid-template-columns:repeat(2,minmax(210px,1fr))}}</style><main><h1>Flip series avatars</h1><div class="grid">''' + "".join(cards) + '</div></main></html>\n'

def main():
    settings = json.loads((ROOT / "series.json").read_text())
    output = ROOT / "avatars"
    output.mkdir(exist_ok=True)
    for variant in settings["variants"]:
        svg = compose(settings, variant)
        ET.ElementTree(resolved(svg)).write(output / (variant["assetId"] + ".svg"), encoding="utf-8", xml_declaration=True)
        for size in [200, 60, 32]:
            filename = variant["assetId"] + ("" if size == 200 else "-" + str(size)) + ".png"
            render(svg, output / filename, size)
    (ROOT / "index.html").write_text(gallery(settings))

if __name__ == "__main__":
    main()
