#!/usr/bin/env python3
"""argue: the argument engine's command line. A reading instrument for a writer: it finds passages by idea, shows
them whole in their context with their grades, and suggests how one passage can answer, correct, concede-then-turn
or raise the stakes on another. It writes no script and judges no draft; nothing depends on it.

    python3 videos/tools/argue.py fetch [--only ID ...] [--force]     full texts from research/sources/registry.json
    python3 videos/tools/argue.py build [--embedder NAME]             the index (20-45 min on this shared CPU)
    python3 videos/tools/argue.py stats                               what the index holds, by tier and source
    python3 videos/tools/argue.py search "IDEA" [--k 40] [--no-read] [--tier party chairman ...]
    python3 videos/tools/argue.py chain "IDEA" [--seed ID|"words from a passage"] [--n 3]
    python3 videos/tools/argue.py show ID                             a passage whole: context, grades, cautions
    python3 videos/tools/argue.py card ID [--max-words 30] [--tight]  phone length: split first, cut with a ledger
    python3 videos/tools/argue.py sheet "IDEA" ["IDEA" ...] --out DIR  results as a reading script (md, html, json)

Env: ARGUE_EMBEDDER (bge-small-int8 | st:<hf id> on a GPU), ARGUE_MODEL (default anthropic/claude-sonnet-5.5),
ARGUE_LLM_URL (an OpenAI-compatible endpoint, e.g. vLLM on the GPUs), ARGUE_NO_LLM=1 (cue words only, labelled so).
Notes: research/capabilities/argument.md.
"""
import argparse
import json
import os
import sys
import textwrap

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.argument import cards, chains, index, llm, reader, search, sheet, sources  # noqa: E402
from engine.argument.index import TIER_LABEL  # noqa: E402


def _w(s, ind="    "):
    return textwrap.fill(s, 100, initial_indent=ind, subsequent_indent=ind)


def cmd_stats(a):
    ix = index.load(a.embedder)
    print(json.dumps(ix.meta, indent=1))
    import collections
    by = collections.Counter((r["tier"], r["author"]) for r in ix.records)
    for (t, au), n in sorted(by.items(), key=lambda x: (index.TIERS.index(x[0][0]) if x[0][0] in index.TIERS else 9, -x[1])):
        print(f"  {TIER_LABEL.get(t, t):<28} {au:<44} {n}")
    hinged = sum(1 for r in ix.records if r.get("hinge"))
    graded = sum(1 for r in ix.records if r["note_grades"])
    print(f"  passages with a turn inside: {hinged}; carrying a grade from the notes: {graded}")


def _print_item(ix, it, n=None):
    r = ix.records[it["i"]]
    sc = f"{it['score']:.0f}" if it.get("score") is not None else "-"
    print(f"[{sc}] {r['id']}  {r['author']}, {r['work']}" + (f", {r['section']}" if r.get("section") else "")
          + f"  · {TIER_LABEL.get(r['tier'], r['tier'])} · {r['grade']}")
    t = r["text"] if n is None else " ".join(r["text"].split()[:n]) + (" …" if len(r["text"].split()) > n else "")
    print(_w(t))
    if it.get("words"):
        print(f"      speaks to it in: \"{it['words']}\"")


def cmd_search(a):
    ix = index.load(a.embedder)
    res = search.run(ix, a.idea, k=a.k, read=not a.no_read, tiers=a.tier)
    cv = res["coverage"]
    print(f"\n\"{a.idea}\": {cv['passages']} passages, {cv['sources']} sources; "
          f"{', '.join(f'{x} {n}' for x, n in cv['authors'][:6])} ({cv['basis']})\n")
    for gi, g in res["groups"].items():
        if not g["items"]:
            continue
        p = g["position"]
        print(f"== {p['label']}" + (f": {p['claim']}" if p["claim"] else ""))
        for it in g["items"][:a.per]:
            _print_item(ix, it, 80)
        print()
    _stats()


def _resolve(ix, seed):
    if seed in ix.by_id:
        return ix.by_id[seed]
    import numpy as np
    s = ix.bm25(seed) + 0 * np.arange(len(ix.records))
    i = int(np.argmax(s))
    return i


def cmd_chain(a):
    ix = index.load(a.embedder)
    res = search.run(ix, a.idea, read=llm.available())
    if a.seed:
        i = _resolve(ix, a.seed)
        if all(it["i"] != i for it in res["items"]):
            res["items"].insert(0, dict(i=i, id=ix.records[i]["id"], fused=0, rank=-1, score=3, position=-1,
                                        words="", role="poses", read=True))
        else:
            for it in res["items"]:
                if it["i"] == i:
                    it.update(score=3, role="poses")
        for it in res["items"]:
            if it["i"] != i and it.get("role") == "poses":
                it["role"] = "claims"
    out = chains.build(ix, a.idea, res, n_chains=a.n, openers=1 if a.seed else 4)
    if a.seed:
        out = [s for s in out if s["path"][0] == _resolve(ix, a.seed)] or out
    for ci, s in enumerate(out):
        print(f"\n=== chain {chr(65 + ci)}  (mean link {s['mean']:.2f})")
        for k, i in enumerate(s["path"]):
            if k:
                L = s["links"][k - 1]
                mv, rst, _ = reader.MOVES[L["move"]]
                print(f"   -> {mv.upper()} ({rst}; {L['strength']:.0f}/3, {L.get('by')})" +
                      (f" on \"{L['pivot']}\"" if L.get("pivot") else ""))
                print(_w(L["reason"], "      "))
            _print_item(ix, dict(i=i))
    _stats()


def cmd_show(a):
    ix = index.load(a.embedder)
    i = _resolve(ix, a.id)
    r = ix.records[i]
    b, _, af = ix.context(r, 2, 2)
    print(ix.cite(r))
    for p in b:
        print(_w(p, "  | "))
    print(_w(r["text"], "  > "))
    for p in af:
        print(_w(p, "  | "))
    for g in sheet._grades(r):
        print("  grade:", g)
    for c in r.get("cautions", []) + ([r["caution"]] if r.get("caution") else []):
        print("  caution:", c)
    if r.get("hinge"):
        print(f"  turns on \"{r['hinge']['word']}\": {r['hinge']['before'][:120]} || {r['hinge']['after'][:160]}")
    for t in r.get("twins", []):
        print("  shorter copy in the notes:", t[:140])


def cmd_card(a):
    ix = index.load(a.embedder)
    r = ix.records[_resolve(ix, a.id)]
    cd = cards.card(r, words="" if a.id in ix.by_id else a.id, max_words=a.max_words, want_tight=a.tight or None)
    print(ix.cite(r))
    print("key sentence:", cd["sentence"])
    print("split (no words lost):", " / ".join(f for f, _ in cd["split"]))
    t = cd.get("tight")
    if t:
        print(f"cut ({t['kept_words']}/{t['total_words']} words; ours marked […]): {t['display']}")
        print("  frames:", " / ".join(f for f, _ in t["frames"]))
        for c in t["ledger"]:
            print(f"  cut {c['where']}: {c['words']} words{' (includes ' + c['negation'] + ')' if c['negation'] else ''}: {c['removed'][:200]}")
        for f in t["flags"]:
            print("  read before using:", f)
        print("  note:", t["note"])
    _stats()


def cmd_sheet(a):
    ix = index.load(a.embedder)
    os.makedirs(a.out, exist_ok=True)
    D, raw = [], []
    for idea in a.ideas:
        print(f"... {idea}", file=sys.stderr)
        res = search.run(ix, idea)
        ch = chains.build(ix, idea, res, n_chains=a.n, log=lambda s: print(s, file=sys.stderr))
        D.append(sheet.concept_data(ix, res, ch))
        raw.append(dict(concept=idea, positions=res["positions"], coverage=res["coverage"],
                        items=[{k: v for k, v in it.items()} for it in res["items"]],
                        chains=[dict(path=[ix.records[i]["id"] for i in s["path"]], links=s["links"],
                                     mean=s["mean"], opposing=s.get("opens_on_opposing_voice")) for s in ch]))
    from engine.argument import notes as _notes
    _notes.names_a_piece("")
    bleed = sorted(set(m.group(0) for d in raw for m in _notes._PN.finditer(json.dumps(d, ensure_ascii=False))))
    print(f"video names found in the output: {bleed or 'none'}", file=sys.stderr)
    title = a.title or "Argument engine: neutral demos"
    open(os.path.join(a.out, "results.md"), "w").write(sheet.md(ix, D, title))
    open(os.path.join(a.out, "results.html"), "w").write(sheet.html_page(ix, D, title, a.lede or ""))
    json.dump(dict(index=ix.meta, video_names_in_output=bleed, model=llm.MODEL if llm.available() else None, concepts=raw),
              open(os.path.join(a.out, "results.json"), "w"), indent=1, ensure_ascii=False)
    print(f"wrote {a.out}/results.md, results.html, results.json", file=sys.stderr)
    _stats()


def _stats():
    s = llm.STATS
    if s["calls"] or s["cached"]:
        print(f"[model {llm.MODEL}: {s['calls']} calls, {s['cached']} from cache, {s['in']} in / {s['out']} out tokens]",
              file=sys.stderr)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--embedder", default=None)
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("fetch")
    p.add_argument("--only", nargs="*")
    p.add_argument("--force", action="store_true")
    sp.add_parser("build")
    sp.add_parser("stats")
    p = sp.add_parser("search")
    p.add_argument("idea")
    p.add_argument("--k", type=int, default=40)
    p.add_argument("--per", type=int, default=4)
    p.add_argument("--no-read", action="store_true")
    p.add_argument("--tier", nargs="*")
    p = sp.add_parser("chain")
    p.add_argument("idea")
    p.add_argument("--seed")
    p.add_argument("--n", type=int, default=3)
    p = sp.add_parser("show")
    p.add_argument("id")
    p = sp.add_parser("card")
    p.add_argument("id")
    p.add_argument("--max-words", type=int, default=30)
    p.add_argument("--tight", action="store_true")
    p = sp.add_parser("sheet")
    p.add_argument("ideas", nargs="+")
    p.add_argument("--out", required=True)
    p.add_argument("--n", type=int, default=2)
    p.add_argument("--title")
    p.add_argument("--lede")
    a = ap.parse_args()
    if a.cmd == "fetch":
        sources.fetch_all(a.only, a.force)
    elif a.cmd == "build":
        index.build(a.embedder)
    else:
        {"stats": cmd_stats, "search": cmd_search, "chain": cmd_chain, "show": cmd_show, "card": cmd_card,
         "sheet": cmd_sheet}[a.cmd](a)


if __name__ == "__main__":
    main()
