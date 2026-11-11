#!/usr/bin/env python3
"""source_refresh: the movement's own channels, refreshed incrementally. What is new since the last run is filed into
research/sources (texts + registry.json, with dates and URLs) and summarised in a short dated digest.

    python3 videos/tools/source_refresh.py status [--md]                 one request per route: works / blocked, today
    python3 videos/tools/source_refresh.py run [--routes a,b] [--since YYYY-MM-DD] [--dry] [--pages N]
    python3 videos/tools/source_refresh.py flow [--md OUT]               where the mining files' verified quotes went
    python3 videos/tools/source_refresh.py log                           past runs, one line each

Routes (`--routes`, default all):
    dispatches   acp.us/dispatches: new dispatches -> full text + registry; also fills exact dates for ones on file
    activity     acp.us/activity (first page): chapter posts it links -> read each through fxtwitter
    x            X through api.fxtwitter.com: the profile timeline (/2/profile/<h>/statuses: posts and reposts) and
                 search from:<h> (/2/search: posts including replies in others' threads), for @American_Gladio
                 (client), @ACPMain (Party), @InfraHaz (Chairman). Own posts and replies -> monthly texts; reposts ->
                 the digest (the taste feed)
    substack     showinfrared.substack.com archive API: posts not on file -> full text + registry
    redamerica   redamerica.acp.us: issues not on file -> table of contents + each article's printed abstract
    youtube      the Infrared and ACP channel RSS feeds: titles and dates only (no transcripts reachable)
    kick         Haz's Kick streams (kick.com/api/v2/channels/infrared/videos): titles, times, length, views
    infrawiki    infrawiki.us recent changes (main namespace): page titles and times only, as leads

Where things go (all under research/sources/):
    texts/<id>.txt + registry.json    the full texts, in the argument engine's format (`argue.py build` indexes them)
    refresh/state.json                per route: last good run, ids already seen, last status
    refresh/runs.jsonl                one line per run and route: when, status, how many new
    refresh/x/<handle>.jsonl          every post record seen (own and reposts): id, date, url, text, counts
    refresh/digest_<date>.md          what is new since the last run, with dates and URLs; flags items the notes cite

It files and reports; it decides nothing about use. Grades follow r6_mining.md §0: X posts read through fxtwitter are
[V-fx]; Red America abstracts are [V-abs] (caption "Red America", never as the author's own sentence); a page read
whole is [V-full]. Small text only: no media is downloaded. About one request per second per host; fxtwitter's
intermittent 404s are retried. Notes: research/capabilities/source_refresh.md.
"""
import argparse
import datetime as dt
import glob
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from engine.argument import paths, sources as S  # noqa: E402

REPO = paths.REPO
RESEARCH = paths.RESEARCH
OUT = os.path.join(paths.SOURCES, "refresh")
STATE = os.path.join(OUT, "state.json")
RUNS = os.path.join(OUT, "runs.jsonl")
UA = "Mozilla/5.0 (X11; Linux x86_64) acp-studio-source-refresh/1.0 (research)"
FIRST_SINCE = "2026-09-26"   # the newest item of the last harvests (american_gladio.md: 25 Sep 23:59 UTC; r6: 28 Sep)
ROUTES = ["dispatches", "activity", "x", "substack", "redamerica", "youtube", "kick", "infrawiki"]
X_ACCOUNTS = [  # handle, tier, author as credited
    ("American_Gladio", "client", "@American_Gladio (the client)"),
    ("ACPMain", "party", "American Communist Party (@ACPMain)"),
    ("InfraHaz", "chairman", "Haz Al-Din (@InfraHaz)"),
]
YT = [("Infrared", "UCl63ZOm_bepvwoKjw24rogA"), ("American Communist Party", "UCkoUBYhZumqZAiIBluu8jIA")]
MONTHS = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


# ------------------------------------------------------------------------------------------------------------ net
class Net:
    def __init__(self, gap=1.0):
        self.gap, self.last, self.n = gap, {}, 0

    def get(self, url, tries=3, accept_json=False, timeout=45):
        host = urllib.parse.urlparse(url).netloc
        for a in range(tries):
            d = self.gap - (time.time() - self.last.get(host, 0))
            if d > 0:
                time.sleep(d)
            self.last[host] = time.time()
            self.n += 1
            req = urllib.request.Request(url, headers={"User-Agent": UA,
                                                       "Accept": "application/json" if accept_json else "*/*"})
            try:
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    raw = r.read()
                return raw.decode("utf-8", "replace")
            except urllib.error.HTTPError as e:
                # fxtwitter answers a good request with 404 now and then; a 403/429/451 is a refusal: stop, report
                if e.code in (403, 429, 451) or a == tries - 1:
                    raise RuntimeError(f"HTTP {e.code} from {host}")
                time.sleep(2 + 2 * a)
            except Exception as e:  # noqa: BLE001
                if a == tries - 1:
                    raise RuntimeError(f"{type(e).__name__} from {host}: {str(e)[:100]}")
                time.sleep(2 + 2 * a)

    def json(self, url, **kw):
        if "fxtwitter" in url:
            kw.setdefault("tries", 6)        # its 404s on good cursors clear on a retry or two
        return json.loads(self.get(url, accept_json=True, **kw))


# ------------------------------------------------------------------------------------------------------------ state
def load_state():
    try:
        return json.load(open(STATE))
    except (OSError, ValueError):
        return {"routes": {}}


def save_state(st):
    os.makedirs(OUT, exist_ok=True)
    for r in st["routes"].values():
        if isinstance(r.get("seen"), list):
            r["seen"] = sorted(set(r["seen"]))
    tmp = STATE + ".part"
    json.dump(st, open(tmp, "w"), indent=1, ensure_ascii=False)
    os.replace(tmp, STATE)


def route_state(st, name):
    return st["routes"].setdefault(name, {"last_ok": None, "seen": [], "last_status": None})


def cited_in_notes():
    """Status ids and URLs already cited anywhere in research/*.md (and pieces/), so the digest can say 'already in
    the notes' instead of 'new'."""
    ids, urls = set(), set()
    for f in glob.glob(os.path.join(RESEARCH, "*.md")) + glob.glob(os.path.join(RESEARCH, "pieces", "*.md")):
        t = open(f, errors="replace").read()
        ids.update(re.findall(r"status/(\d{15,20})", t))
        urls.update(u.rstrip(").,;*`") for u in re.findall(r"https?://[^\s)\]>\"']+", t))
    return ids, urls


def utc(ts):
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc)


def slug_id(s, n=60):
    return re.sub(r"[^a-z0-9]+", "-", urllib.parse.unquote(s).lower()).strip("-")[:n].strip("-")


def short(t, n=280):
    t = re.sub(r"\s+", " ", t or "").strip()
    return t if len(t) <= n else t[:n].rsplit(" ", 1)[0] + " …"


# ------------------------------------------------------------------------------------------------------------ registry
def registry():
    return S.load_registry()


def reg_by_url(reg):
    return {urllib.parse.unquote(r["url"]).rstrip("/"): r for r in reg}


def merge_save(ctx):
    """Other agents edit registry.json too (by hand or with argue.py), so never write back a stale copy: reload it,
    add the entries this run created, refresh the ones it keeps (added_by source_refresh), fill the dates it found."""
    disk = S.load_registry()
    keep = {r["id"] for r in ctx["reg"]}
    disk = [r for r in disk if not (r["id"] in ctx.get("dropped", ()) and r["id"] not in keep and r.get("added_by") == "source_refresh")]
    by = {r["id"]: r for r in disk}
    urls = reg_by_url(disk)
    for e in ctx["reg"]:
        if e["id"] in by:
            if e.get("added_by") == "source_refresh":
                by[e["id"]].update(e)
        elif e["id"] not in ctx["snapshot"]:
            if urllib.parse.unquote(e["url"]).rstrip("/") in urls and e.get("route") not in ("x", "redamerica"):
                continue                                   # someone filed the same page under another id meanwhile
            disk.append(e)
    for i, d in ctx["dated"].items():
        if i in by and (not by[i].get("date") or len(by[i]["date"]) == 4):
            by[i]["date"] = d
    S.save_registry(disk)


def write_text(src, paras):
    p = paths.text_path(src)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as f:
        f.write("\n\n".join(paras) + "\n")
    src["fetched"] = time.strftime("%Y-%m-%d")
    src["words"] = sum(len(x.split()) for x in paras)
    return p


# ------------------------------------------------------------------------------------------------------------ routes
def r_dispatches(net, ctx):
    t = net.get("https://acp.us/dispatches")
    items = []
    for m in re.finditer(r'href="/dispatches/(\d{4}/[^"]+)"', t):
        seg = t[m.end():m.end() + 2500]
        tm = re.search(r"<time[^>]*>\s*([A-Z][a-z]{2})[a-z]* (\d{1,2}), (\d{4})", seg)
        h2 = re.search(r"<h2[^>]*>(.*?)</h2>", seg, re.S)
        date = f"{tm.group(3)}-{MONTHS[tm.group(1)]:02d}-{int(tm.group(2)):02d}" if tm else None
        title = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", h2.group(1)))).strip() if h2 else ""
        items.append((m.group(1), date, title))
    reg = ctx["reg"]
    have = reg_by_url(reg)
    new, dated = [], 0
    for slug, date, title in items:
        url = f"https://acp.us/dispatches/{slug}"
        src = have.get(urllib.parse.unquote(url))
        if src:
            if date and (not src.get("date") or len(src["date"]) == 4):   # the seed registry had the year only
                src["date"] = date
                ctx["dated"][src["id"]] = date
                dated += 1
            continue
        sid = "acp-d-" + slug_id(slug.split("/", 1)[1])
        src = S._src(sid, "American Communist Party", title or "Dispatch", date or slug[:4], "party", url,
                     edition="acp.us dispatches", title_from_page=True, added_by="source_refresh")
        rec = {"id": sid, "date": date, "title": title, "url": url}
        if not ctx["dry"]:
            try:
                S.fetch_one(src, force=True)
                reg.append(src)
                rec["words"] = src.get("words")
                rec["lede"] = short(" ".join(S.read_text(src)[:2]), 400)
            except Exception as e:  # noqa: BLE001
                rec["error"] = str(e)[:120]
        new.append(rec)
    return {"new": new, "dated": dated, "listed": len(items)}


def fx_status(net, sid):
    d = net.json(f"https://api.fxtwitter.com/i/status/{sid}")
    return d.get("tweet") or d.get("status") or {}


def post_record(s, via):
    a = (s.get("author") or {}).get("screen_name", "")
    rb = s.get("reposted_by")
    rb = rb.get("screen_name") if isinstance(rb, dict) else rb
    q = s.get("quote") or {}
    rep = s.get("replying_to")
    rep = (rep.get("screen_name"), rep.get("status")) if isinstance(rep, dict) else (s.get("replying_to"), s.get("replying_to_status"))
    return {"id": s.get("id"), "url": s.get("url"), "account": a, "via": via, "reposted_by": rb,
            "ts": s.get("created_timestamp"), "date": utc(s["created_timestamp"]).strftime("%Y-%m-%d %H:%M UTC") if s.get("created_timestamp") else s.get("created_at"),
            "text": s.get("text") or "", "reply_to": rep[0], "reply_to_status": rep[1],
            "quote": {"id": q.get("id"), "account": (q.get("author") or {}).get("screen_name"), "text": q.get("text"),
                      "url": q.get("url")} if q else None,
            "media": [m.get("type") for m in ((s.get("media") or {}).get("all") or [])],
            "views": s.get("views"), "likes": s.get("likes"), "reposts": s.get("reposts"), "replies": s.get("replies")}


def append_jsonl(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    have = set()
    if os.path.exists(path):
        for ln in open(path):
            try:
                have.add(json.loads(ln)["id"])
            except (ValueError, KeyError):
                pass
    with open(path, "a") as f:
        for r in rows:
            if r["id"] not in have:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
                have.add(r["id"])


def thread_posts(rows, handle, known=()):
    """The account's posts and the continuations of its own threads: a post that replies to nobody, or replies to the
    account's own status when that status is itself one of these (followed up the chain). Everything else the account
    wrote is a turn in someone else's conversation. `known` holds ids already judged to be posts on an earlier run."""
    by = {r["id"]: r for r in rows}
    memo = {k: True for k in known}

    def ok(r, depth=0):
        if r["id"] in memo:
            return memo[r["id"]]
        if not r.get("reply_to"):
            v = True
        elif r["reply_to"] != handle or depth > 50:
            v = False
        else:
            par = by.get(r.get("reply_to_status"))
            v = ok(par, depth + 1) if par else False
        memo[r["id"]] = v
        return v
    return [r for r in rows if ok(r)]


X_CAUTION = ("One paragraph per post, headed [date · URL · reply to / quoting]. Read through fxtwitter: wording, date "
             "and counts are the post's own. The thread, the quoted post and any image are not in the text, and a "
             "reply is one turn of a conversation, often off the line: open the URL and read the thread before "
             "quoting. Reposts are not here.")


def file_posts(ctx, handle, tier, author, posts, label=None):
    """Own posts -> one text per account and month (x-<handle>-YYYY-MM), each post its own paragraph headed by its
    date and URL, in the argument engine's format. Merges with what the month's file already holds."""
    by_month = {}
    for p in posts:
        if p.get("ts"):
            by_month.setdefault(utc(p["ts"]).strftime("%Y-%m"), []).append(p)
    reg = ctx["reg"]
    ids = {r["id"]: r for r in reg}
    out = []
    for ym, ps in sorted(by_month.items()):
        sid = f"x-{handle.lower().replace('_', '-')}-{ym}"
        src = ids.get(sid) or S._src(
            sid, author, f"Posts on X, {ym}" + (f" ({label})" if label else ""), ym, tier,
            f"https://x.com/{handle}" if handle != "acp-chapters" else "https://acp.us/activity",
            route="x", edition="X, read through api.fxtwitter.com", grade="[V-fx]", added_by="source_refresh",
            caution=X_CAUTION)
        src["caution"] = X_CAUTION
        old = {}
        p_ = paths.text_path(src)
        if os.path.exists(p_):
            for para in open(p_).read().split("\n\n"):
                m = re.search(r"status/(\d+)", para[:200])
                if m:
                    old[m.group(1)] = para.strip()
        for p in ps:
            if not (p["text"] or "").strip():
                continue
            hd = f"[{p['date']} · {p['url']}"
            if handle == "acp-chapters":
                hd += f" · @{p['account']}"
            if p.get("reply_to"):
                hd += f" · reply to @{p['reply_to']}"
            if p.get("quote"):
                hd += f" · quoting @{(p['quote'] or {}).get('account')}"
            old[p["id"]] = hd + "] " + re.sub(r"\s*\n\s*", " / ", p["text"].strip())
        paras = [old[k] for k in sorted(old, key=int)]
        if paras and not ctx["dry"]:
            write_text(src, paras)
            if sid not in ids:
                reg.append(src)
                ids[sid] = src
        out.append(sid)
    return out


def r_x(net, ctx):
    res = {}
    for handle, tier, author in X_ACCOUNTS:
        rs = route_state(ctx["state"], f"x:{handle}")
        since = ctx["since"] or (rs["last_ok"] or FIRST_SINCE)
        since_ts = dt.datetime.fromisoformat(since[:10]).replace(tzinfo=dt.timezone.utc).timestamp()
        seen = set(rs["seen"])
        own, reposts, pages, stops, err = [], [], 0, [], None
        # two feeds: the profile timeline (own posts and reposts; most replies left out) and search from:<handle>
        # (own posts including replies inside other people's threads; found by the r7 pass, 2 Oct)
        feeds = [("timeline", f"https://api.fxtwitter.com/2/profile/{handle}/statuses"),
                 ("search", f"https://api.fxtwitter.com/2/search?q=from%3A{handle}")]
        for feed, base in feeds:
            cursor, fp, stop = None, 0, None
            try:
                while fp < ctx["pages"]:
                    sep = "&" if "?" in base else "?"
                    d = net.json(base + (f"{sep}cursor={urllib.parse.quote(cursor)}" if cursor else ""))
                    fp += 1
                    rows = d.get("results") or []
                    if not rows:
                        stop = "empty page"
                        break
                    older = 0
                    for s in rows:
                        r = post_record(s, handle)
                        if (r["ts"] or 0) < since_ts:
                            older += 1
                            continue
                        if r["id"] in seen:
                            continue
                        seen.add(r["id"])
                        (reposts if r["reposted_by"] else own).append(r)
                    # newest first, but a repost carries the original's date: stop when a whole page is older
                    if older == len(rows):
                        stop = f"reached {since}"
                        break
                    nxt = (d.get("cursor") or {}).get("bottom")
                    if not nxt or nxt == cursor:
                        stop = "end"
                        break
                    cursor = nxt
                else:
                    stop = f"page cap {ctx['pages']} (raise --pages to go further back)"
            except RuntimeError as e:
                stop, err = f"stopped: {e}", str(e)
            pages += fp
            stops.append(f"{feed}: {stop}")
        stop = "; ".join(stops)
        if err and not own and not reposts:
            res[handle] = {"error": err, "pages": pages}
            rs["last_status"] = f"FAILED {err}"
            continue
        hist = os.path.join(OUT, "x", f"{handle}.jsonl")
        prior = [json.loads(x) for x in open(hist)] if os.path.exists(hist) else []
        mine_ids = {r["id"] for r in thread_posts(prior + own, handle)}
        mine = [p for p in own if p["id"] in mine_ids]                                     # posts and self-threads
        replies = [p for p in own if p not in mine]                                       # turns in others' threads
        tofile = own if ctx.get("file_replies") else mine
        files = file_posts(ctx, handle, tier, author, tofile) if tofile else []
        if not ctx["dry"]:
            append_jsonl(os.path.join(OUT, "x", f"{handle}.jsonl"), own + reposts)
            rs["seen"] = sorted(seen)[-5000:]
        res[handle] = {"own": mine, "replies": replies, "reposts": reposts, "pages": pages, "stop": stop, "since": since, "files": files}
        rs["_ok"] = "stopped" not in stop and "page cap" not in stop
    return res


def r_activity(net, ctx):
    t = net.get("https://acp.us/activity")
    ids = list(dict.fromkeys(re.findall(r"(?:x|twitter)\.com/(?:i|\w+)/status/(\d{15,20})", t)))
    rs = route_state(ctx["state"], "activity")
    seen = set(rs["seen"])
    new, errs = [], []
    for sid in ids:
        if sid in seen:
            continue
        try:
            s = fx_status(net, sid)
            if not s:
                raise RuntimeError("no status in reply")
            new.append(post_record(s, "acp.us/activity"))
            seen.add(sid)
        except RuntimeError as e:
            errs.append(f"{sid}: {e}")
    files = []
    if new:
        files = file_posts(ctx, "acp-chapters", "party", "ACP chapters (as linked on acp.us/activity)", new,
                           label="chapter accounts linked on acp.us/activity")
        if not ctx["dry"]:
            append_jsonl(os.path.join(OUT, "x", "acp-chapters.jsonl"), new)
    if not ctx["dry"]:
        rs["seen"] = sorted(seen)
    return {"listed": len(ids), "new": new, "errors": errs, "files": files}


def r_substack(net, ctx):
    posts, off = [], 0
    while True:
        b = net.json(f"https://showinfrared.substack.com/api/v1/archive?sort=new&limit=25&offset={off}")
        if not b:
            break
        posts += b
        off += len(b)
        if len(b) < 25:
            break
    reg = ctx["reg"]
    have = reg_by_url(reg)
    rs = route_state(ctx["state"], "substack")
    reported = set(rs["seen"])
    new = []
    for p in posts:
        url = (p.get("canonical_url") or "").rstrip("/")
        if not url or urllib.parse.unquote(url) in have or url in reported:
            continue
        if not ctx["dry"]:
            rs["seen"].append(url)                    # reported once; a post that cannot be filed is not re-reported
        by = [b.get("name") for b in (p.get("publishedBylines") or []) if b.get("name")]
        rec = {"id": "ss-" + slug_id(p["slug"], 50), "date": p["post_date"][:10], "title": p["title"].strip(),
               "url": url, "audience": p.get("audience"), "byline": ", ".join(by) or "?", "type": p.get("type")}
        if p.get("audience") == "everyone" and p.get("type") == "newsletter" and not ctx["dry"]:
            src = S._src(rec["id"], f"Infrared (Substack; byline: {rec['byline']})", rec["title"], rec["date"],
                         "chairman", url, edition="Infrared (Substack)", added_by="source_refresh",
                         caution="Signed with the publication's byline, not a name: credit it to Infrared unless the "
                                 "text names its writer. Read the date against the post before citing.")
            try:
                S.fetch_one(src, force=True)
                reg.append(src)
                rec["words"] = src.get("words")
                rec["lede"] = short(" ".join(S.read_text(src)[:2]), 300)
            except Exception as e:  # noqa: BLE001
                rec["error"] = str(e)[:120]
        new.append(rec)
    return {"listed": len(posts), "newest": posts[0]["post_date"][:10] if posts else None, "new": new}


def r_redamerica(net, ctx):
    t = net.get("https://redamerica.acp.us/")
    issues = sorted(set(re.findall(r"issues/(\d{3})\b", t)))
    reg = ctx["reg"]
    ids = {r["id"] for r in reg}
    new = []
    for iss in issues:
        sid = f"redamerica-{iss}"
        if sid in ids:
            continue
        it = net.get(f"https://redamerica.acp.us/issues/{iss}")
        arts = list(dict.fromkeys(re.findall(r'href="\.\./articles/([^"]+)"', it)))
        paras, rec_arts, idate = [], [], None
        for a in arts:
            try:
                at = net.get(f"https://redamerica.acp.us/articles/{a}")
            except RuntimeError as e:
                rec_arts.append({"slug": a, "error": str(e)})
                continue
            meta = {}
            for k, v in re.findall(r'<meta name="citation_([a-z_]+)" content="([^"]*)"', at):
                meta.setdefault(k, []).append(html.unescape(v))
            title = (meta.get("title") or [a])[0]
            authors = ", ".join(meta.get("author") or [])
            idate = idate or (meta.get("publication_date") or [None])[0]
            ab = (meta.get("abstract") or [""])[0].strip()
            url = f"https://redamerica.acp.us/articles/{a}"
            paras.append(f"## {title}. {authors or 'author not printed'}. {url}")
            if ab:
                paras.append(ab)
            rec_arts.append({"title": title, "authors": authors, "url": url, "abstract_words": len(ab.split())})
        date = idate.replace("/", "-") if idate else None
        rec = {"issue": iss, "date": date, "articles": rec_arts}
        if paras and not ctx["dry"]:
            src = S._src(sid, "Red America (official journal of the American Communist Party)",
                         f"Red America, issue {iss}: contents and abstracts", date or "", "party",
                         f"https://redamerica.acp.us/issues/{iss}", route="redamerica", grade="[V-abs]",
                         edition="redamerica.acp.us (abstracts as printed; full texts are behind the subscription)",
                         added_by="source_refresh",
                         caution="Each abstract is the journal's page, not necessarily the author's own sentence: "
                                 "caption it as 'Red America', never as the author (r6_mining.md §0, [V-abs]).")
            write_text(src, paras)
            reg.append(src)
        new.append(rec)
    return {"issues": len(issues), "latest": issues[-1] if issues else None, "new": new}


def r_youtube(net, ctx):
    rs = route_state(ctx["state"], "youtube")
    seen = set(rs["seen"])
    since = ctx["since"] or rs["last_ok"] or FIRST_SINCE
    out = {"_since_date": since}
    for name, cid in YT:
        try:
            t = net.get(f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}")
        except RuntimeError as e:
            out[name] = {"error": str(e)}
            continue
        vids = []
        for e in re.findall(r"<entry>(.*?)</entry>", t, re.S):
            vid = re.search(r"<yt:videoId>(.*?)<", e).group(1)
            v = {"id": vid, "date": re.search(r"<published>(.*?)<", e).group(1)[:10],
                 "title": html.unescape(re.search(r"<title>(.*?)<", e).group(1)),
                 "url": f"https://www.youtube.com/watch?v={vid}"}
            if vid not in seen:
                vids.append(v)
                seen.add(vid)
        out[name] = {"new": vids, "listed": t.count("<entry>")}
    if not ctx["dry"]:
        rs["seen"] = sorted(seen)
    return out


def r_infrawiki(net, ctx):
    """InfraWiki (infrawiki.us, the movement's community wiki): pages created or edited in the main namespace since the
    last run, titles and times only. A wiki is not the Party's or the Chairman's text; it is a lead list."""
    rs = route_state(ctx["state"], "infrawiki")
    since = ctx["since"] or rs["last_ok"] or FIRST_SINCE
    u = ("https://infrawiki.us/api.php?action=query&list=recentchanges&rcnamespace=0&rctype=new|edit&rclimit=200"
         f"&rcprop=title|timestamp|sizes|user&rcend={since}T00:00:00Z&format=json")
    d = net.json(u)
    pages = {}
    for c in d.get("query", {}).get("recentchanges", []):
        p = pages.setdefault(c["title"], {"title": c["title"], "edits": 0, "new": False, "last": c["timestamp"],
                                          "url": "https://infrawiki.us/index.php/" + urllib.parse.quote(c["title"].replace(" ", "_"))})
        p["edits"] += 1
        p["new"] = p["new"] or c.get("type") == "new"
    return {"since_date": since, "pages": sorted(pages.values(), key=lambda p: p["last"], reverse=True),
            "more": "continue" in d}


def r_kick(net, ctx):
    """Haz's streams on Kick (kick.com/api/v2/channels/infrared/videos): titles, start times, length, views. No
    transcripts. Route found by the r7 pass (2 Oct)."""
    rs = route_state(ctx["state"], "kick")
    seen = set(rs["seen"])
    vids = net.json("https://kick.com/api/v2/channels/infrared/videos")
    new = []
    for v in vids if isinstance(vids, list) else []:
        k = str(v.get("id"))
        if k in seen:
            continue
        seen.add(k)
        new.append({"id": k, "title": (v.get("session_title") or "").strip(), "start": v.get("start_time"),
                    "minutes": round((v.get("duration") or 0) / 60000), "views": v.get("views"),
                    "url": f"https://kick.com/infrared/videos/{(v.get('video') or {}).get('uuid', '')}" if v.get("video") else "https://kick.com/infrared"})
    if not ctx["dry"]:
        rs["seen"] = sorted(seen)
    return {"listed": len(vids) if isinstance(vids, list) else 0, "new": new}


RUN = {"dispatches": r_dispatches, "activity": r_activity, "x": r_x, "substack": r_substack,
       "redamerica": r_redamerica, "youtube": r_youtube, "infrawiki": r_infrawiki, "kick": r_kick}


# ------------------------------------------------------------------------------------------------------------ digest
def digest(res, ctx, started):
    ids_cited, urls_cited = ctx["cited"]

    def cited(p):
        return " *(already cited in the notes)*" if (p.get("id") in ids_cited or p.get("url") in urls_cited) else ""

    L = [f"# Sources: new since the last run ({started[:16].replace('T', ' ')} UTC)", "",
         "Written by `videos/tools/source_refresh.py run`. Everything below was read on the live source at the time "
         "above; quotes are the source's own text, cut only where marked …. Grades as in `r6_mining.md` §0. "
         "This is a list of what arrived, not a judgement of what to use.", ""]
    st = ctx["state"]["routes"]
    L += ["| route | result | since |", "|---|---|---|"]
    for k, v in res.items():
        L.append(f"| {k} | {v.get('_summary', '')} | {v.get('_since', '')} |")
    L.append("")
    if "x" in res and not res["x"].get("error"):
        for handle, tier, author in X_ACCOUNTS:
            r = res["x"].get(handle) or {}
            if r.get("error"):
                L += [f"## @{handle}: FAILED ({r['error']})", ""]
                continue
            L += [f"## @{handle}: {len(r.get('own', []))} posts, {len(r.get('replies', []))} replies in others' threads, "
                  f"{len(r.get('reposts', []))} reposts since {r.get('since')} [V-fx]", ""]
            if "page cap" in r.get("stop", "") or "stopped" in r.get("stop", ""):
                L += [f"*Incomplete: {r['stop']}.*", ""]
            for p in sorted(r.get("own", []), key=lambda p: p["ts"] or 0):
                ex = []
                if p.get("reply_to"):
                    ex.append(f"reply to @{p['reply_to']}")
                if p.get("quote"):
                    ex.append(f"quoting @{p['quote']['account']}: \"{short(p['quote']['text'], 160)}\" {p['quote'].get('url') or ''}")
                if p.get("media"):
                    ex.append("media: " + ", ".join(p["media"]))
                if p.get("views"):
                    ex.append(f"{p['views']:,} views")
                L.append(f"- {p['date']} {p['url']}{cited(p)}")
                L.append(f"  > {short(p['text'], 700)}" if p["text"].strip() else "  > (no text)")
                if ex:
                    L.append("  " + "; ".join(ex))
            rp = sorted(r.get("replies", []), key=lambda p: p["ts"] or 0)
            if rp:
                L += ["", f"**Replies in other people's threads ({len(rp)}; conversational, read the thread before any use; "
                          f"kept in refresh/x/{handle}.jsonl, not filed as texts):**"]
                L += [f"- {p['date'][:16]} to @{p['reply_to']} {p['url']}{cited(p)}: \"{short(p['text'], 220)}\"" for p in rp]
            reps = r.get("reposts", [])
            if reps:
                cap = None if handle == "American_Gladio" else 12
                pick = reps if cap is None else sorted(reps, key=lambda p: -(p.get("views") or 0))[:cap]
                what = " (all: the client’s taste feed)" if cap is None else (f" (top {cap} of {len(reps)} by views)" if len(reps) > cap else "")
                L += ["", f"**Reposts{what}; the date is the original post's, not the repost's:**"]
                for p in pick:
                    L.append(f"- @{p['account']}, {p['date'][:10]}, {p['url']}{cited(p)}: \"{short(p['text'], 200)}\"")
            L.append("")
    if "activity" in res and res["activity"].get("new"):
        L += [f"## acp.us/activity: {len(res['activity']['new'])} chapter posts not seen before [V-fx]", ""]
        for p in sorted(res["activity"]["new"], key=lambda p: p["ts"] or 0):
            L.append(f"- @{p['account']}, {p['date']}, {p['url']}{cited(p)}")
            L.append(f"  > {short(p['text'], 500)}")
        L.append("")
    if "dispatches" in res and res["dispatches"].get("new"):
        L += ["## acp.us dispatches not on file [V-full]", ""]
        for d in res["dispatches"]["new"]:
            L.append(f"- {d['date']} **{d['title']}** {d['url']}{cited(d)}" + (f" (ERROR {d['error']})" if d.get("error") else f", {d.get('words')} words"))
            if d.get("lede"):
                L.append(f"  > {d['lede']}")
        L.append("")
    if "substack" in res and res["substack"].get("new"):
        L += ["## showinfrared.substack.com posts not on file", ""]
        for d in res["substack"]["new"]:
            L.append(f"- {d['date']} **{d['title']}** (byline {d['byline']}; {d['audience']}) {d['url']}{cited(d)}"
                     + (f", {d.get('words')} words filed" if d.get("words") else "") + (f" ERROR {d['error']}" if d.get("error") else ""))
        L.append("")
    if "redamerica" in res and res["redamerica"].get("new"):
        L += ["## Red America issues not on file (contents and printed abstracts) [V-abs]", ""]
        for d in res["redamerica"]["new"]:
            L.append(f"- Issue {d['issue']} ({d['date']}): " + "; ".join(
                f"*{a.get('title')}* ({a.get('authors') or '?'})" for a in d["articles"] if a.get("title")))
        L.append("")
    if "youtube" in res:
        rows = [(n, v) for n, v in res["youtube"].items() if not n.startswith("_") and isinstance(v, dict) and v.get("new")]
        if rows:
            L += ["## YouTube uploads not seen before (titles and dates only; watch pages are behind a bot wall)", ""]
            since = res["youtube"].get("_since_date", "")
            for n, v in rows:
                fresh = [x for x in v["new"] if x["date"] >= since]
                for x in fresh:
                    L.append(f"- {n}: {x['date']} \"{html.unescape(x['title'])}\" {x['url']}")
                old = len(v["new"]) - len(fresh)
                if old:
                    L.append(f"- {n}: {old} older uploads seen for the first time (before {since}; the feed holds the last 15)")
            L.append("")
    kk = res.get("kick") or {}
    if kk.get("new"):
        L += ["## Kick: Haz's streams not seen before (titles only; no transcripts)", ""]
        L += [f"- {v['start'][:16] if v.get('start') else '?'} \"{v['title']}\" ({v['minutes']} min, {v['views']} views) {v['url']}"
              for v in kk["new"]]
        L.append("")
    iw = res.get("infrawiki") or {}
    if iw.get("pages"):
        L += [f"## InfraWiki: pages new or edited since {iw['since_date']} (titles only; a community wiki, not Party text)", ""]
        L += [f"- {p['last'][:16].replace('T', ' ')} {'NEW ' if p['new'] else ''}[{p['title']}]({p['url']}) ({p['edits']} edits)"
              for p in iw["pages"][:60]]
        if len(iw["pages"]) > 60:
            L.append(f"- … and {len(iw['pages']) - 60} more")
        L.append("")
    return "\n".join(L) + "\n"


def summarise(name, r):
    if r.get("error"):
        return f"FAILED: {r['error']}"
    if name == "x":
        return "; ".join(f"@{h}: " + (f"FAILED {v['error']}" if v.get("error") else
                                       f"{len(v['own'])} posts, {len(v.get('replies', []))} replies, {len(v['reposts'])} reposts ({v['pages']} pages, {v['stop']})")
                         for h, v in r.items() if not h.startswith("_"))
    if name == "dispatches":
        return f"{r['listed']} listed, {len(r['new'])} new" + (f", exact dates filled for {r['dated']}" if r["dated"] else "")
    if name == "activity":
        return f"{r['listed']} posts linked, {len(r['new'])} new" + (f", {len(r['errors'])} unread" if r["errors"] else "")
    if name == "substack":
        return f"{r['listed']} posts (newest {r['newest']}), {len(r['new'])} not on file"
    if name == "redamerica":
        return f"{r['issues']} issues (latest {r['latest']}), {len(r['new'])} not on file"
    if name == "kick":
        return f"{r['listed']} streams listed, {len(r['new'])} new"
    if name == "infrawiki":
        return f"{len(r['pages'])} pages new or edited" + (" (more than one page of changes; see the wiki)" if r.get("more") else "")
    if name == "youtube":
        return "; ".join(f"{n}: " + (f"FAILED {v['error']}" if v.get("error") else f"{len(v['new'])} new of {v['listed']}")
                         for n, v in r.items() if not n.startswith("_"))
    return ""


def cmd_run(a):
    started = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    st = load_state()
    reg = registry()
    ctx = {"state": st, "reg": reg, "snapshot": {r["id"] for r in reg}, "dated": {}, "dry": a.dry, "since": a.since, "pages": a.pages, "file_replies": a.file_replies, "cited": cited_in_notes()}
    net = Net(a.gap)
    res = {}
    for name in (a.routes.split(",") if a.routes else ROUTES):
        print(f"[{name}] …", file=sys.stderr, flush=True)
        rs = route_state(st, name)
        try:
            r = RUN[name](net, ctx)
        except Exception as e:  # noqa: BLE001 (a failed route is reported; the others still run)
            r = {"error": str(e)[:200]}
        r["_summary"] = summarise(name, r)
        r["_since"] = (a.since or rs.get("last_ok") or "first run") if name != "x" else "per account"
        ok = not r.get("error")
        if name == "x":
            for h, *_ in X_ACCOUNTS:
                xs = route_state(st, f"x:{h}")
                if (r.get(h) or {}).get("error") is None and xs.pop("_ok", False) and not a.dry:
                    xs["last_ok"] = started[:10]
                xs["last_status"] = summarise("x", {h: r[h]}) if h in r else xs.get("last_status")
                xs.pop("_ok", None)
        if not a.dry:
            if ok and name != "x":
                rs["last_ok"] = started[:10]
            rs["last_status"] = r["_summary"]
        print(f"[{name}] {r['_summary']}", file=sys.stderr, flush=True)
        res[name] = r
    text = digest(res, ctx, started)
    if a.dry:
        print(text)
        return
    merge_save(ctx)
    save_state(st)
    os.makedirs(OUT, exist_ok=True)
    dp = os.path.join(OUT, f"digest_{started[:10]}.md")
    if os.path.exists(dp):
        dp = os.path.join(OUT, f"digest_{started[:10]}_{started[11:16].replace(':', '')}.md")
    open(dp, "w").write(text)
    with open(RUNS, "a") as f:
        for k, v in res.items():
            f.write(json.dumps({"run": started, "route": k, "ok": not v.get("error"), "summary": v["_summary"],
                                "requests": net.n}, ensure_ascii=False) + "\n")
    print(f"digest: {os.path.relpath(dp, REPO)}  ({net.n} requests)")


# ------------------------------------------------------------------------------------------------------------ status
PROBES = [
    ("acp.us dispatches", "https://acp.us/dispatches", "dispatches"),
    ("acp.us activity (first page)", "https://acp.us/activity", "activity"),
    ("fxtwitter timeline", "https://api.fxtwitter.com/2/profile/American_Gladio/statuses", "x"),
    ("fxtwitter single post", "https://api.fxtwitter.com/i/status/2103623789221449826", "x (and activity)"),
    ("fxtwitter conversation", "https://api.fxtwitter.com/2/conversation/2103623789221449826", "manual (replies in others' threads)"),
    ("substack archive API", "https://showinfrared.substack.com/api/v1/archive?sort=new&limit=1", "substack"),
    ("Red America index", "https://redamerica.acp.us/", "redamerica"),
    ("infrared.gg (book)", "https://infrared.gg/thought/communism-in-the-post-maga-age/00", "argue.py fetch"),
    ("Kick VOD list", "https://kick.com/api/v2/channels/infrared/videos", "kick"),
    ("fxtwitter search from:", "https://api.fxtwitter.com/2/search?q=from%3AAmerican_Gladio", "x (replies)"),
    ("YouTube RSS (Infrared)", f"https://www.youtube.com/feeds/videos.xml?channel_id={YT[0][1]}", "youtube"),
    ("marxists.org", "https://www.marxists.org/archive/marx/works/1845/theses/theses.htm", "argue.py fetch"),
    ("archive.org metadata", "https://archive.org/metadata/towards-a-new-socialism/metadata", "argue.py fetch; archive_find"),
    ("en.wikipedia raw", "https://en.wikipedia.org/w/index.php?title=Eugene_V._Debs&action=raw", "manual"),
    ("loc.gov JSON", "https://www.loc.gov/pictures/?fo=json&q=strike", "archive_find"),
    ("InfraWiki API", "https://infrawiki.us/api.php?action=query&list=recentchanges&rclimit=1&format=json", "infrawiki"),
    ("michael-hudson.com", "https://michael-hudson.com/", "manual"),
    ("xcancel (X RSS)", "https://xcancel.com/InfraHaz/rss", "none"),
]


def cmd_status(a):
    net = Net(0.3)
    rows = []
    for label, url, used in PROBES:
        t0 = time.time()
        try:
            body = net.get(url, tries=2)
            ok = "works"
            if "sgcaptcha" in body or "Just a moment" in body[:2000]:
                ok = "BLOCKED (challenge page)"
            elif len(body) < 200:
                ok = f"suspect ({len(body)} bytes)"
        except RuntimeError as e:
            ok = f"BLOCKED ({e})"
        rows.append((label, ok, f"{time.time() - t0:.1f}", used, url))
    if a.md:
        print("| route | today | s | used by | probe |\n|---|---|---|---|---|")
        for r in rows:
            print("| " + " | ".join(r[:4]) + f" | `{r[4]}` |")
    else:
        for r in rows:
            print(f"{r[0]:<30} {r[1]:<40} {r[2]:>5}s  {r[3]}")


# ------------------------------------------------------------------------------------------------------------ flow
FLOW_FILES = ["r5_mining.md", "r6_mining.md"]
# the movement's own words only: r6 §1-§2 without the news, calendar, associative, people and hostile subsections
# (§1.5-§1.8, §2.8), and r5 §1 without the same. Rights statements, film credits and news copy are not lines.
FLOW_KEEP = {"r6_mining.md": (("## 1.", "## 2."), ("### 1.5", "### 1.6", "### 1.7", "### 1.8", "### 2.8")),
             "r5_mining.md": (("## 1.",), ("### 1.5", "### 1.6", "### 1.7"))}
QUOTE = re.compile(r"[\"“]([^\"“”]{20,400})[\"”]")


def _norm(s):
    s = s.lower().replace("’", "'").replace("—", " ").replace("–", " ")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9' ]+", " ", s)).strip()


def cmd_flow(a):
    """For each verified quote in the mining files, where it went: a script (research/scripts_final), a piece file
    (research/pieces, PIECE_NOTES), a concept bank (CONCEPTS, IDEAS_BANK), the sources file (LINE_SOURCES), or nowhere
    but the mining file. Matching is on the first eight words, normalised; a quote reworded downstream is missed."""
    def blob(globs):
        t = ""
        for g in globs:
            for f in glob.glob(os.path.join(REPO, g)):
                t += " " + _norm(open(f, errors="replace").read())
        return t
    dests = [("script", blob(["research/scripts_final/*.json"])),
             ("piece", blob(["research/pieces/*.md", "research/PIECE_NOTES.md"])),
             ("scene", blob(["videos/web/scenes/*.js"])),
             ("bank", blob(["research/CONCEPTS.md", "research/IDEAS_BANK.md", "videos/CONCEPTS.md"])),
             ("sources", blob(["research/LINE_SOURCES.md", "research/THEORY_CORPUS.md"]))]
    rows, sub, graded = [], True, False
    for fn in FLOW_FILES:
        keep, drop = FLOW_KEEP.get(fn, ((), ()))
        on = not keep
        for ln in open(os.path.join(RESEARCH, fn)):
            if ln.startswith("## "):
                on = any(ln.startswith(k) for k in keep) if keep else True
                sub = True
            if ln.startswith("### "):
                sub = not any(ln.startswith(d) for d in drop)
                graded = bool(re.search(r"\[V(-fx|-abs)?\]", ln))      # "(all [V-fx])" in a heading grades its lines
            if ln.startswith("## "):
                graded = False
            if not (on and sub):
                continue
            if not (graded or re.search(r"\[V(-fx|-abs)?\]", ln)) or re.search(r"\[(S|P|U|HOSTILE|CTX)\]", ln):
                continue
            for q in QUOTE.findall(ln):
                n = _norm(q)
                if len(n.split()) < 5:
                    continue
                key = " ".join(n.split()[:8])
                where = [d for d, b in dests if key in b]
                rows.append((fn, q, where))
    seen, uniq = set(), []
    for r in rows:
        k = _norm(r[1])[:60]
        if k not in seen:
            seen.add(k)
            uniq.append(r)
    from collections import Counter
    def furthest(w):
        for k in ("script", "scene", "piece", "bank", "sources"):
            if k in w:
                return k
        return "mining file only"
    c = Counter(furthest(w) for _, _, w in uniq)
    L = [f"# Where the verified quotes in {', '.join(FLOW_FILES)} went ({time.strftime('%Y-%m-%d')})", "",
         f"{len(uniq)} distinct verified quotes of five words or more. Furthest each one reached: " +
         ", ".join(f"{k} {v}" for k, v in c.most_common()) + ".", "",
         "Matching is on the first eight words; a quote cut or reworded downstream counts as not reached.", ""]
    for label in ["mining file only", "sources", "bank", "piece", "scene", "script"]:
        grp = [r for r in uniq if furthest(r[2]) == label]
        if not grp:
            continue
        L += [f"## {label} ({len(grp)})", ""]
        L += [f"- \"{short(q, 200)}\" ({fn})" for fn, q, _ in grp]
        L.append("")
    text = "\n".join(L)
    if a.md:
        open(a.md, "w").write(text)
        print(f"wrote {a.md}: " + ", ".join(f"{k} {v}" for k, v in c.most_common()))
    else:
        print(text)


def cmd_refile(a):
    """Rewrite the x-* texts from refresh/x/*.jsonl under the current filing rule (posts and self-threads; replies in
    others' threads only with --replies). Use after changing the rule; touches only texts this tool made."""
    reg = registry()
    ctx = {"reg": reg, "dry": False, "file_replies": a.replies, "state": load_state(), "snapshot": {r["id"] for r in reg},
           "dated": {}}
    for handle, tier, author in X_ACCOUNTS + [("acp-chapters", "party", "ACP chapters (as linked on acp.us/activity)")]:
        f = os.path.join(OUT, "x", f"{handle}.jsonl")
        if not os.path.exists(f):
            continue
        rows = [json.loads(x) for x in open(f)]
        rows = [r for r in rows if not r.get("reposted_by")]
        if handle != "acp-chapters" and not a.replies:
            rows = thread_posts(rows, handle)
        pre = f"x-{handle.lower().replace('_', '-')}-"
        for old in glob.glob(os.path.join(paths.TEXTS, pre + "*.txt")):
            os.remove(old)
        ctx["reg"][:] = [r for r in ctx["reg"] if not (r["id"].startswith(pre) and r.get("added_by") == "source_refresh")]
        ctx["dropped"] = ctx.get("dropped", set()) | {i for i in ctx["snapshot"] if i.startswith(pre)}
        ids = file_posts(ctx, handle, tier, author, rows,
                         label="chapter accounts linked on acp.us/activity" if handle == "acp-chapters" else None)
        print(handle, len(rows), "posts ->", ", ".join(ids))
    merge_save(ctx)


def cmd_log(a):
    if not os.path.exists(RUNS):
        print("no runs yet")
        return
    for ln in open(RUNS):
        r = json.loads(ln)
        print(f"{r['run'][:16]}  {r['route']:<11} {'ok ' if r['ok'] else 'ERR'} {r['summary']}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    r = sp.add_parser("run")
    r.add_argument("--routes", help="comma list of " + ",".join(ROUTES))
    r.add_argument("--since", help="YYYY-MM-DD; default: each route's last good run, else " + FIRST_SINCE)
    r.add_argument("--dry", action="store_true", help="read and print the digest; write nothing")
    r.add_argument("--pages", type=int, default=25, help="max timeline pages per X account (20 posts each)")
    r.add_argument("--file-replies", action="store_true", help="file X replies in others' threads as texts too")
    r.add_argument("--gap", type=float, default=1.0, help="seconds between requests to one host")
    s = sp.add_parser("status")
    s.add_argument("--md", action="store_true")
    f = sp.add_parser("flow")
    f.add_argument("--md")
    sp.add_parser("log")
    rf = sp.add_parser("refile")
    rf.add_argument("--replies", action="store_true", help="also file replies in others' threads as texts")
    a = ap.parse_args()
    {"run": cmd_run, "status": cmd_status, "flow": cmd_flow, "log": cmd_log, "refile": cmd_refile}[a.cmd](a)


if __name__ == "__main__":
    main()
