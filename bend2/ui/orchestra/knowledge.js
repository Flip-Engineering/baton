// Knowledge layer for the oversight document.
//
// One global entry, called by the document shell with a container,
// recorded data and options. The module never reads another module's
// DOM and never starts a request.
//
// renderKnowledge(container, data, opts):
//   data   { overview } with overview.findings [{id, author, claim,
//          evidence, limits}], overview.promotions [{finding, source,
//          destination, promotedBy}], overview.actors {id: {role, parent}}.
//   opts   { mode, authorIds, selectedId, query, notice,
//          onSelectFinding, onSelectActor }.
//          mode "band" attaches compact finding rows to the given
//          authors inside their band; mode "whole" draws the
//          whole-orchestra canvas for the collapsed on-demand band.
//          The query dims non-matches in place without re-laying out.
(function () {
  "use strict";

  var KW_SVG_NS = "http://www.w3.org/2000/svg";

  function kwEl(parent, tag, attrs, text) {
    var el = document.createElement(tag);
    if (attrs) {
      for (const key of Object.keys(attrs)) el.setAttribute(key, attrs[key]);
    }
    if (text !== undefined && text !== null) el.textContent = text;
    if (parent) parent.appendChild(el);
    return el;
  }

  function kwSvg(parent, tag, attrs) {
    var el = document.createElementNS(KW_SVG_NS, tag);
    if (attrs) {
      for (const key of Object.keys(attrs)) el.setAttribute(key, attrs[key]);
    }
    if (parent) parent.appendChild(el);
    return el;
  }

  function kwMatches(query, id, claim, author) {
    if (!query) return true;
    const q = String(query).toLowerCase();
    return String(id || "").toLowerCase().includes(q)
      || String(claim || "").toLowerCase().includes(q)
      || String(author || "").toLowerCase().includes(q);
  }

  function kwDepthOf(meta, roles, id) {
    const roleOf = (v) => (meta[v] && meta[v].role) || roles[v] || "";
    if (!roleOf(id)) return -1;
    const chain = new Set();
    let cur = id, d = 0;
    for (;;) {
      if (chain.has(cur)) return -1;
      chain.add(cur);
      const entry = meta[cur];
      const p = entry ? entry.parent : undefined;
      if (p === null || p === undefined) return -1;
      if (p === "") return d;
      cur = p;
      d += 1;
    }
  }

  // First sight marks a node new so arrivals surface visually; the
  // mark is presentation only and never filters. The roster rebuilds
  // row containers on every render, so sight is tracked by finding id
  // rather than by container.
  var kwSeenIds = new Set();

  // Row arrival state, keyed by actor id: the last recorded read and how
  // many renders the arrival dot has left. The shell renders twice per
  // commit on the update path, so a single-render dot would vanish
  // before any reader sees it; two renders survive the pair.
  var kwRowSeen = new Map();

  function kwMarkNew(g, id) {
    if (kwSeenIds.has(id)) return;
    kwSeenIds.add(id);
    g.classList.add("kw-new");
  }

  // Band mode: one compact line per author inside the row. The holding
  // halo and the slur in the row gutter carry the graphic; this line
  // carries at most a compact count with the top shared claim elided on
  // the same line. Full claim, evidence and limits live in the record.
  function kwRenderBand(container, overview, promotions, opts) {
    const authors = (opts && opts.authorIds) || [];
    const wrap = kwEl(container, "div", { class: "kw-band" });
    for (const author of authors) {
      const own = (overview.findings || []).filter(
        (f) => String(f.author || "") === String(author));
      let received = 0;
      const seenReceived = new Set();
      for (const p of promotions) {
        if (String(p.destination || "") !== String(author)) continue;
        const f = (overview.findings || []).find(
          (cand) => cand.id === p.finding);
        if (f && String(f.author || "") !== String(author)
          && !seenReceived.has(f.id)) {
          seenReceived.add(f.id);
          received += 1;
        }
      }
      if (!own.length && !received) continue;
      let shared = 0;
      let top = null;
      let topDegree = 0;
      for (const f of own) {
        const degree = promotions.filter((p) => p.finding === f.id).length;
        if (degree > 0) shared += 1;
        if (degree > topDegree || (top === null && degree === topDegree)) {
          topDegree = degree;
          top = f;
        }
      }
      const line = kwEl(wrap, "p", {
        class: "kw-compact muted",
        "data-kw-author": String(author),
      });
      let text = own.length + (own.length === 1 ? " finding" : " findings")
        + " · " + shared + " shared";
      if (received) text += " · " + received + " received";
      if (top && topDegree > 0) {
        const claim = String(top.claim || top.id);
        text += " — " + (claim.length > 60 ? claim.slice(0, 59) + "…" : claim);
      }
      line.textContent = text;
    }
  }

  // Whole mode: the whole-orchestra canvas for the collapsed on-demand
  // band. Actors sit in rows by recorded parent depth; findings sit in
  // their author's row, shared first by promotion count. All four
  // recorded relation kinds draw directed with arrowheads. The canvas
  // fits its container width and grows vertically.
  var KW_GUTTER = 170;
  var KW_ACTOR_SLOT = 150;
  var KW_FIND_SLOT = 32;
  var KW_TOP = 44;
  var KW_PAD = 20;
  // Authors with more findings than this collapse to one count badge
  // that expands on focus, so one prolific author cannot fan over the
  // tiers below. Expansion survives shell re-renders.
  var KW_CLUSTER_AT = 12;
  var kwExpandedAuthors = new Set();
  var kwCollapsedEnsembles = new Set();
  var kwLastRender = null;
  // The map view: hand-rolled pan and zoom held in the layer so they
  // survive shell re-renders. One whole canvas renders at a time.
  var kwView = { x: 0, y: 0, k: 1 };
  var kwNodePos = new Map();
  var kwViewMoved = false;
  // A drag that pans the map must not also activate the node it
  // started on. Clicks consume the gesture; keydowns never pan.
  function kwConsumePan() {
    const moved = kwViewMoved;
    kwViewMoved = false;
    return moved;
  }

  function kwRenderWhole(container, overview, promotions, opts, collapsed) {
    const meta = (opts && opts.actorMeta) || overview.actors || {};
    const roles = (opts && opts.roles) || {};
    const findings = new Map(
      (overview.findings || []).map((f) => [f.id, f]));
    const width = Math.max(480, container.clientWidth || 1640);
    const actorPerRow = Math.max(1, Math.floor(
      (width - KW_GUTTER - KW_PAD) / KW_ACTOR_SLOT));
    const findPerRow = Math.max(1, Math.floor(
      (width - KW_GUTTER - KW_PAD - 8) / KW_FIND_SLOT));

    const authored = new Map();
    for (const f of overview.findings || []) {
      const author = String(f.author || "unknown");
      authored.set(author, (authored.get(author) || 0) + 1);
    }
    const actors = Array.from(authored.keys());
    for (const p of promotions) {
      for (const id of [p.source, p.destination, p.promotedBy]) {
        if (id && actors.indexOf(String(id)) === -1) {
          actors.push(String(id));
        }
      }
    }
    const tierOf = new Map();
    for (const id of actors) tierOf.set(id, kwDepthOf(meta, roles, id));
    const depths = Array.from(new Set(tierOf.values()))
      .filter((d) => d >= 0).sort((a, b) => a - b);
    // Actors without usable role or parent metadata keep an honest
    // unknown tier instead of dropping their findings off the canvas.
    if ([...tierOf.values()].some((d) => d < 0)) depths.push(-1);
    const byAuthor = new Map();
    for (const f of overview.findings || []) {
      const author = String(f.author || "unknown");
      if (!byAuthor.has(author)) byAuthor.set(author, []);
      byAuthor.get(author).push(f);
    }
    const promoCount = new Map();
    for (const p of promotions) {
      promoCount.set(p.finding, (promoCount.get(p.finding) || 0) + 1);
    }
    const sharedIds = new Set(promoCount.keys());

    const tiers = depths.map((d) => {
      const members = actors.filter((id) => tierOf.get(id) === d
        && !(collapsed && collapsed.has(id)))
        .sort((a, b) => ((authored.get(b) || 0) - (authored.get(a) || 0))
          || (a < b ? -1 : 1));
      const selectedFinding = opts && opts.selectedId;
      const slots = [];
      for (const id of members) {
        const group = (byAuthor.get(id) || []).slice().sort((a, b) =>
          ((promoCount.get(b.id) || 0) - (promoCount.get(a.id) || 0))
          || String(a.id).localeCompare(String(b.id)));
        const holdsSelected = group.some((f) => f.id === selectedFinding);
        if (group.length > KW_CLUSTER_AT && !kwExpandedAuthors.has(id)
          && !holdsSelected) {
          slots.push({ cluster: id, items: group });
        } else {
          for (const f of group) slots.push({ finding: f });
        }
      }
      const actorRows = Math.max(1, Math.ceil(members.length / actorPerRow));
      const findRows = Math.ceil(slots.length / findPerRow);
      return {
        d, members, slots, actorRows, findRows,
        height: 44 + actorRows * 30 + (slots.length ? 12 + findRows * 30 : 0) + 18,
      };
    });
    let height = KW_TOP;
    for (const t of tiers) {
      t.y = height;
      height += t.height;
    }
    height += KW_PAD;

    const svg = kwSvg(container, "svg", {
      viewBox: "0 0 " + width + " " + height,
      width: String(width),
      height: String(height),
      class: "kw-canvas",
      role: "img",
      "aria-label": "Whole-orchestra knowledge",
    });
    const defs = kwSvg(svg, "defs", null);
    const markers = [
      ["kw-arrow-author", "thin gray author to finding",
        "var(--muted, #5b6478)"],
      ["kw-arrow-share", "ochre sharing source to finding",
        "var(--attention, #a2611f)"],
      ["kw-arrow-deliver", "gray finding to destination",
        "var(--muted, #5b6478)"],
      ["kw-arrow-promote", "dashed dark promoter to finding",
        "var(--selection, #2a3e6b)"],
    ];
    for (const [mid, label, fill] of markers) {
      const marker = kwSvg(defs, "marker", {
        id: mid, viewBox: "0 0 8 8", refX: "7", refY: "4",
        markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse",
      });
      // Titles in defs concatenate in text reads of the mount, so each
      // entry carries its own separator.
      kwSvg(marker, "title", null).textContent = label + ". ";
      kwSvg(marker, "path", { d: "M0,0 L8,4 L0,8 Z", fill });
    }
    const edgeLayer = kwSvg(svg, "g", { class: "kw-edges" });
    const roleOf = (id) => (meta[id] && meta[id].role) || roles[id] || "";
    return { svg, edgeLayer, tiers, findings, actorPerRow, findPerRow, width, roleOf, markers, tierOf };
  }

  // One count badge where an author holds more findings than the
  // cluster threshold. Activating it expands the author's full fan in
  // place; activating again collapses. Focus moves into the result so
  // keyboard readers never lose their place.
  function kwClusterBadge(svg, slot, x, y, promotions, opts, query) {
    const author = slot.cluster;
    const items = slot.items;
    let shared = 0;
    for (const f of items) {
      shared += promotions.filter((p) => p.finding === f.id).length;
    }
    const g = kwSvg(svg, "g", {
      class: "kw-cluster",
      tabindex: "0", role: "button",
      "aria-label": items.length + " findings by " + author + ", activate to expand",
      "data-kw-cluster": String(author),
    });
    kwSvg(g, "rect", {
      x: String(x - 15), y: String(y - 10),
      width: "30", height: "20", rx: "10",
      class: "kw-cluster-box",
    });
    const count = kwSvg(g, "text", {
      x: String(x), y: String(y + 4),
      class: "kw-cluster-count", "text-anchor": "middle",
    });
    count.textContent = String(items.length);
    const tip = kwSvg(g, "title", null);
    tip.textContent = items.length + " findings, " + shared + " promotions — activate to expand. ";
    if (!items.some((f) => kwMatches(query, f.id, f.claim, f.author))) {
      g.classList.add("kw-dim");
    }
    const toggle = () => {
      if (kwConsumePan()) return;
      kwViewMoved = false;
      if (kwExpandedAuthors.has(author)) kwExpandedAuthors.delete(author);
      else kwExpandedAuthors.add(author);
      if (kwLastRender) {
        renderKnowledge(kwLastRender.container, kwLastRender.data, kwLastRender.opts);
        const mount = kwLastRender.container;
        const target = kwExpandedAuthors.has(author) && items.length
          ? mount.querySelector('[data-kw-node="' + CSS.escape(items[0].id) + '"]')
          : mount.querySelector('[data-kw-cluster="' + CSS.escape(String(author)) + '"]');
        if (target && typeof target.focus === "function") target.focus();
      }
      if (opts && typeof opts.onSelectActor === "function") opts.onSelectActor(author);
    };
    g.addEventListener("click", toggle);
    g.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        if (ev.preventDefault) ev.preventDefault();
        toggle();
      }
    });
  }

  // Convex hull (Andrew monotone chain) over padded points.
  function kwHullPath(points) {
    const pts = points.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2
        && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i -= 1) {
      const p = pts[i];
      while (upper.length >= 2
        && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  // Ensemble hulls group the drawn seats of each recorded ensemble.
  // Activating a hull collapses its members out of the tiers into one
  // count lozenge; activating again restores them. The layer sits under
  // the drawing and never joins hover isolation.
  function kwEnsembleHulls(svg, edgeLayer, layout, ensembles) {
    const list = Array.isArray(ensembles) ? ensembles : [];
    if (!list.length) return;
    const actorPos = layout.actorPos;
    const tiers = layout.tiers || [];
    const tierOf = layout.tierOf || new Map();
    const layer = kwSvg(svg, "g", { class: "kw-hulls" });
    svg.insertBefore(layer, edgeLayer);
    const lozenges = new Map();
    for (const e of list) {
      const id = e && e.id ? String(e.id) : "";
      const members = e && Array.isArray(e.members)
        ? e.members.map((m) => String(m)) : [];
      if (!id || !members.length) continue;
      const toggle = () => {
        if (kwCollapsedEnsembles.has(id)) kwCollapsedEnsembles.delete(id);
        else kwCollapsedEnsembles.add(id);
        if (kwLastRender) {
          renderKnowledge(kwLastRender.container, kwLastRender.data, kwLastRender.opts);
          const next = kwLastRender.container.querySelector(
            '[data-kw-hull="' + CSS.escape(id) + '"]');
          if (next && typeof next.focus === "function") next.focus();
        }
      };
      const wire = (g) => {
        g.addEventListener("click", () => { if (kwConsumePan()) return; toggle(); });
        g.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            if (ev.preventDefault) ev.preventDefault();
            kwViewMoved = false;
            toggle();
          }
        });
      };
      if (kwCollapsedEnsembles.has(id)) {
        const tier = tiers.find((t) => t.d === tierOf.get(members[0])) || tiers[0];
        if (!tier) continue;
        const n = lozenges.get(tier.d) || 0;
        lozenges.set(tier.d, n + 1);
        const x = KW_GUTTER + 75 + n * 90;
        const y = tier.y + 34;
        const g = kwSvg(layer, "g", {
          class: "kw-lozenge",
          tabindex: "0", role: "button",
          "aria-label": "ensemble " + id + ", " + members.length + " seats, activate to expand",
          "data-kw-hull": id,
        });
        kwSvg(g, "rect", {
          x: String(x - 40), y: String(y - 11),
          width: "80", height: "22", rx: "11",
          class: "kw-lozenge-box",
        });
        const label = kwSvg(g, "text", {
          x: String(x), y: String(y + 4),
          class: "kw-lozenge-label", "text-anchor": "middle",
        });
        label.textContent = id + " (" + members.length + ")";
        wire(g);
        continue;
      }
      const pts = [];
      for (const m of members) {
        if (actorPos.has(m)) pts.push(actorPos.get(m));
      }
      if (pts.length < 2) continue;
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      const padded = pts.map((p) => {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        return { x: p.x + dx / len * 24, y: p.y + dy / len * 24 };
      });
      const hull = kwHullPath(padded);
      const d = "M" + hull.map((p) => p.x + "," + p.y).join(" L") + " Z";
      const top = hull.reduce((a, b) => (a.y < b.y ? a : b));
      const g = kwSvg(layer, "g", {
        class: "kw-hull",
        tabindex: "0", role: "button",
        "aria-label": "ensemble " + id + ", " + members.length + " seats, activate to collapse",
        "data-kw-hull": id,
      });
      kwSvg(g, "path", { d, class: "kw-hull-line" });
      const label = kwSvg(g, "text", {
        x: String(top.x), y: String(top.y - 6),
        class: "kw-hull-label", "text-anchor": "middle",
      });
      label.textContent = id + " (" + members.length + ")";
      wire(g);
    }
  }

  function kwPlaceWhole(layout, container, overview, promotions, opts, ensembles, collapsed) {
    const { svg, edgeLayer, tiers } = layout;
    const actorPos = new Map();
    const findingPos = new Map();
    const query = opts && opts.query;
    for (const t of tiers) {
      const label = kwSvg(svg, "text", {
        x: String(KW_PAD), y: String(t.y + 4), class: "kw-tier",
      });
      label.textContent = t.d < 0 ? "depth unknown" : "depth " + t.d;
      const nameRows = new Map();
      t.members.forEach((id, i) => {
        const x = KW_GUTTER + (i % layout.actorPerRow) * KW_ACTOR_SLOT + 75;
        const y = t.y + 34 + Math.floor(i / layout.actorPerRow) * 30;
        actorPos.set(String(id), { x, y });
        const role = layout.roleOf ? layout.roleOf(id) : "";
        const conductor = role === "principal-conductor" || role === "associate-conductor";
        const s = conductor ? 11 : 8;
        const g = kwSvg(svg, "g", {
          class: "kw-anchor",
          tabindex: "0", role: "button",
          "aria-label": String(id),
          "data-kw-id": String(id),
        });
        kwSvg(g, "rect", {
          x: String(x - s / 2), y: String(y - s / 2),
          width: String(s), height: String(s),
          class: "kw-actor" + (conductor ? " role-conductor"
            : role === "operator" ? " role-operator" : ""),
        });
        // Actor names thin like finding labels: members arrive ranked
        // by authored count, and a name that would overlap one already
        // placed on its row is skipped while the anchor still draws.
        const arow = Math.floor(i / layout.actorPerRow);
        const nw = String(id).length * 6.5 + 10;
        const nbox = [x + 10, x + 10 + nw];
        const nboxes = nameRows.get(arow) || [];
        if (!nboxes.some((b) => nbox[0] < b[1] && b[0] < nbox[1])) {
          nboxes.push(nbox);
          nameRows.set(arow, nboxes);
          const name = kwSvg(g, "text", {
            x: String(x + 10), y: String(y + 4), class: "kw-name mono",
          });
          name.textContent = String(id);
        }
        if (!kwMatches(query, id, "", id)) g.classList.add("kw-dim");
        g.addEventListener("click", () => {
          if (kwConsumePan()) return;
          g.focus();
          kwIsolate(id, 2);
          if (opts && typeof opts.onSelectActor === "function") {
            opts.onSelectActor(id);
          }
        });
        g.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            if (ev.preventDefault) ev.preventDefault();
            kwViewMoved = false;
            kwIsolate(id, 2);
            if (opts && typeof opts.onSelectActor === "function") {
              opts.onSelectActor(id);
            }
          }
        });
      });
      const findTop = t.y + 34 + t.actorRows * 30 + 12;
      // Each tier labels its most promoted findings so the canvas reads
      // words at a glance; every other node keeps its claim one gesture
      // away through hover, keyboard, or selection.
      const visibleFindings = [];
      for (const s of t.slots) {
        if (s.finding) visibleFindings.push(s.finding);
      }
      const labeled = new Set(visibleFindings
        .filter((f) => promotions.some((p) => p.finding === f.id))
        .map((f) => [promotions.filter((p) => p.finding === f.id).length, f.id])
        .sort((a, b) => (b[0] - a[0]) || String(a[1]).localeCompare(String(b[1])))
        .slice(0, 8)
        .map((entry) => entry[1]));
      // Crowding rule: labels place in rank order and a label that would
      // overlap one already placed on its row is skipped, so dense tiers
      // thin themselves instead of knotting. Rank order is deterministic,
      // so the same labels survive every render.
      const slotIndex = new Map();
      t.slots.forEach((s, j) => {
        if (s.finding) slotIndex.set(s.finding.id, j);
      });
      const labelShown = new Set();
      const placedRows = new Map();
      for (const fid of labeled) {
        const j = slotIndex.get(fid);
        if (j === undefined) continue;
        const row = Math.floor(j / layout.findPerRow);
        const x = KW_GUTTER + (j % layout.findPerRow) * KW_FIND_SLOT + 16;
        const rec = layout.findings.get(fid);
        const words = String((rec && (rec.claim || rec.id)) || fid);
        const w = Math.min(27, words.length) * 6.5 + 10;
        const box = [x - w / 2, x + w / 2];
        const boxes = placedRows.get(row) || [];
        if (boxes.some((b) => box[0] < b[1] && b[0] < box[1])) continue;
        boxes.push(box);
        placedRows.set(row, boxes);
        labelShown.add(fid);
      }
      t.slots.forEach((slot, j) => {
        const x = KW_GUTTER + (j % layout.findPerRow) * KW_FIND_SLOT + 16;
        const y = findTop + Math.floor(j / layout.findPerRow) * 30;
        if (slot.cluster) {
          kwClusterBadge(svg, slot, x, y, promotions, opts, query);
          return;
        }
        const f = slot.finding;
        findingPos.set(f.id, { x, y });
        const selected = opts && opts.selectedId === f.id;
        const degree = promotions.filter((p) => p.finding === f.id).length;
        const g = kwSvg(svg, "g", {
          class: "knode" + (degree ? "" : " unshared") + (selected ? " selected" : ""),
          tabindex: "0", role: "button",
          "aria-label": String(f.id),
          "data-kw-node": String(f.id),
        });
        kwMarkNew(g, f.id);
        kwSvg(g, "circle", {
          cx: String(x), cy: String(y), r: String(5 + Math.min(3, degree)),
          class: "kw-finding" + (degree ? "" : " unshared"),
        });
        if (degree) {
          kwSvg(g, "circle", {
            cx: String(x), cy: String(y),
            r: String(8 + Math.min(3, degree)),
            class: "kw-halo",
          });
        }
        const heading = kwSvg(g, "title", null);
        heading.textContent = String(f.claim || f.id)
          + (f.evidence ? " — " + String(f.evidence) : "")
          + (f.limits ? " — " + String(f.limits) : "");
        if (selected || labelShown.has(f.id)) kwNodeLabel(g, f, x, y);
        if (!kwMatches(query, f.id, f.claim, f.author)) {
          g.classList.add("kw-dim");
        }
        g.addEventListener("click", () => {
          if (kwConsumePan()) return;
          g.focus();
          kwIsolate(f.id, 2);
          if (opts && typeof opts.onSelectFinding === "function") {
            opts.onSelectFinding(f.id);
          }
        });
        g.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            if (ev.preventDefault) ev.preventDefault();
            kwViewMoved = false;
            kwIsolate(f.id, 2);
            if (opts && typeof opts.onSelectFinding === "function") {
              opts.onSelectFinding(f.id);
            }
          }
        });
      });
    }
    // Promotion relations draw as arcs bowed off the straight line so
    // movement reads apart from structure; authorship stays straight.
    const edge = (x1, y1, x2, y2, cls, marker, label, kind, from, to, arc) => {
      const attrs = {
        class: cls, "marker-end": "url(#" + marker + ")",
        "aria-label": label, "data-kind": kind,
        "data-from": String(from), "data-to": String(to),
      };
      if (arc) {
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const bow = Math.min(40, len * 0.12);
        attrs.d = "M" + x1 + "," + y1 + " Q" + (mx - dy / len * bow) + ","
          + (my + dx / len * bow) + " " + x2 + "," + y2;
        return kwSvg(edgeLayer, "path", attrs);
      }
      attrs.x1 = String(x1);
      attrs.y1 = String(y1);
      attrs.x2 = String(x2);
      attrs.y2 = String(y2);
      return kwSvg(edgeLayer, "line", attrs);
    };
    for (const p of promotions) {
      const to = findingPos.get(p.finding);
      if (!to) continue;
      if (p.source && actorPos.has(String(p.source))) {
        const from = actorPos.get(String(p.source));
        edge(from.x, from.y + 6, to.x, to.y - 6, "kw-edge-share",
          "kw-arrow-share", "promotion from " + p.source, "share",
          p.source, p.finding, true);
      }
      if (p.destination && actorPos.has(String(p.destination))) {
        const dest = actorPos.get(String(p.destination));
        edge(to.x, to.y + 6, dest.x, dest.y - 6, "kw-edge-deliver",
          "kw-arrow-deliver", "delivery to " + p.destination, "deliver",
          p.finding, p.destination, true);
      }
      const promoter = p.promotedBy ? String(p.promotedBy) : "";
      if (promoter && promoter !== String(p.source || "")
        && promoter !== String(p.destination || "") && actorPos.has(promoter)) {
        const from = actorPos.get(promoter);
        edge(from.x, from.y + 6, to.x, to.y - 6, "kw-edge-promote",
          "kw-arrow-promote", "promoted by " + promoter, "promote",
          promoter, p.finding, true);
      }
    }
    for (const [fid, finding] of layout.findings) {
      if (!findingPos.has(fid)) continue;
      const author = finding.author ? String(finding.author) : "";
      if (!author || !actorPos.has(author)) continue;
      const from = actorPos.get(author);
      const to = findingPos.get(fid);
      edge(from.x, from.y + 6, to.x, to.y - 6, "kw-edge-authorship",
        "kw-arrow-author", "authored by " + author, "authorship",
        author, fid);
    }
    layout.actorPos = actorPos;
    kwEnsembleHulls(svg, edgeLayer, layout, ensembles || []);
    // Hover or keyboard focus isolates the anchor's recorded neighborhood:
    // the anchor, its connected anchors and findings, and their edges stay
    // lit while the rest of the canvas dims. A separate mark from the query
    // dimming so the two never fight; leaving restores the canvas.
    const kwNodeId = (g) => g.getAttribute("data-kw-node")
      || g.getAttribute("data-kw-id") || g.getAttribute("data-kw-cluster") || "";
    // Depth 1 lights the anchor and its direct relations; depth 2 adds
    // the neighbours of neighbours, which is the selection read.
    const kwIsolate = (id, depth) => {
      const near = new Set([id]);
      for (const edge of edgeLayer.children) {
        const from = edge.getAttribute("data-from") || "";
        const to = edge.getAttribute("data-to") || "";
        if (from === id || to === id) {
          near.add(from);
          near.add(to);
        }
      }
      const keep = new Set(near);
      if (depth === 2) {
        for (const edge of edgeLayer.children) {
          const from = edge.getAttribute("data-from") || "";
          const to = edge.getAttribute("data-to") || "";
          if (near.has(from) || near.has(to)) {
            keep.add(from);
            keep.add(to);
          }
        }
      }
      for (const g of svg.querySelectorAll("g.kw-anchor, g.knode, g.kw-cluster")) {
        g.classList.toggle("kw-hover-dim", !keep.has(kwNodeId(g)));
      }
      for (const edge of edgeLayer.children) {
        const from = edge.getAttribute("data-from") || "";
        const to = edge.getAttribute("data-to") || "";
        const lit = from === id || to === id
          || (depth === 2 && (near.has(from) || near.has(to)));
        edge.classList.toggle("kw-hover-dim", !lit);
      }
    };
    const kwClearIsolation = () => {
      for (const n of svg.querySelectorAll(".kw-hover-dim")) {
        n.classList.remove("kw-hover-dim");
      }
    };
    for (const g of svg.querySelectorAll("g.kw-anchor, g.knode, g.kw-cluster")) {
      g.addEventListener("mouseover", () => kwIsolate(kwNodeId(g)));
      g.addEventListener("mouseleave", kwClearIsolation);
      // The selected anchor keeps its two-hop read across re-renders;
      // every other focus reads one hop.
      g.addEventListener("focus", () => kwIsolate(kwNodeId(g),
        opts && opts.selectedId === kwNodeId(g) ? 2 : 1));
      g.addEventListener("blur", kwClearIsolation);
    }
    const legend = kwEl(container, "p", { class: "kw-legend muted" });
    legend.textContent = "Rows by recorded parent depth. Circles are "
      + "findings in their author row: size follows promotion count. "
      + "Each row names its most promoted findings. ";
    // The edge key generates from the same marker table that draws the
    // arrowheads, one entry per line, so the legend cannot drift from
    // the drawing. Each entry carries its own separator for text reads.
    const keys = kwEl(container, "ul", { class: "kw-legend-keys muted" });
    for (const entry of layout.markers || []) {
      const item = kwEl(keys, "li", null);
      item.textContent = String(entry[1]) + ". ";
    }
    // Pan and zoom wrap the whole drawing: every child but the marker
    // defs moves into one transform group, so placement code above draws
    // in canvas coordinates and the view reads from kwView.
    const view = kwSvg(svg, "g", { class: "kw-view" });
    for (const child of Array.from(svg.childNodes)) {
      if (child !== view && child.tagName !== "defs") view.appendChild(child);
    }
    kwApplyView(view);
    kwNodePos.clear();
    for (const [id, pos] of actorPos) kwNodePos.set(id, { x: pos.x, y: pos.y, kind: "actor" });
    for (const [id, pos] of findingPos) kwNodePos.set(id, { x: pos.x, y: pos.y, kind: "finding" });
    kwMapChrome(container, svg, view, overview, promotions, opts);
    kwPinCard(container, overview, promotions, opts);
  }

  function kwApplyView(view) {
    view.setAttribute("transform", "translate(" + kwView.x + "," + kwView.y + ") scale(" + kwView.k + ")");
  }

  function kwZoomAt(view, px, py, factor) {
    const k2 = Math.min(4, Math.max(0.25, kwView.k * factor));
    if (k2 === kwView.k) return;
    kwView.x = px - (px - kwView.x) * (k2 / kwView.k);
    kwView.y = py - (py - kwView.y) * (k2 / kwView.k);
    kwView.k = k2;
    kwApplyView(view);
  }

  // Map furniture: zoom buttons, a search box that centres its hit, and
  // drag-pan plus wheel-zoom on the canvas. All state lives in kwView.
  function kwMapChrome(container, svg, view, overview, promotions, opts) {
    const tools = kwEl(container, "div", { class: "kw-maptools" });
    const search = kwEl(tools, "input", {
      class: "kw-search mono",
      type: "search",
      placeholder: "Search the map…",
      "aria-label": "Search actors and findings on the map",
    });
    search.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") kwSearchCentre(container, view, overview, search.value, opts);
    });
    const mkBtn = (label, name, fn) => {
      const b = kwEl(tools, "button", { class: "kw-zoom mono", type: "button", "aria-label": name });
      b.textContent = label;
      b.addEventListener("click", fn);
      return b;
    };
    const centre = () => ({
      x: (container.clientWidth || 800) / 2,
      y: (container.clientHeight || 600) / 2,
    });
    mkBtn("+", "Zoom the map in", () => {
      const c = centre();
      kwZoomAt(view, c.x, c.y, 1.25);
    });
    mkBtn("−", "Zoom the map out", () => {
      const c = centre();
      kwZoomAt(view, c.x, c.y, 1 / 1.25);
    });
    mkBtn("1:1", "Reset the map view", () => {
      kwView.x = 0;
      kwView.y = 0;
      kwView.k = 1;
      kwApplyView(view);
    });
    svg.addEventListener("wheel", (ev) => {
      if (ev.preventDefault) ev.preventDefault();
      const rect = svg.getBoundingClientRect();
      kwZoomAt(view, ev.clientX - rect.left, ev.clientY - rect.top,
        ev.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
    // Drag pans; the move and up listeners live on the document for the
    // life of the drag so a redraw under the pointer cannot strand them.
    svg.addEventListener("pointerdown", (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      kwViewMoved = false;
      const sx = ev.clientX;
      const sy = ev.clientY;
      const ox = kwView.x;
      const oy = kwView.y;
      const move = (mv) => {
        const dx = mv.clientX - sx;
        const dy = mv.clientY - sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) kwViewMoved = true;
        kwView.x = ox + dx;
        kwView.y = oy + dy;
        kwApplyView(view);
      };
      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", up);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
    });
  }

  // Search centres the first match and selects it, which pins its card.
  // A hit inside a collapsed cluster expands the cluster first.
  function kwSearchCentre(container, view, overview, query, opts) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return;
    const findings = overview.findings || [];
    const hit = findings.find((f) => String(f.id).toLowerCase().includes(q)
      || String(f.claim || "").toLowerCase().includes(q)
      || String(f.author || "").toLowerCase().includes(q));
    const actors = Object.keys(overview.actors || {});
    const actorHit = !hit && actors.find((id) => id.toLowerCase().includes(q));
    const id = hit ? hit.id : actorHit;
    if (!id) return;
    if (hit) {
      const authored = findings.filter((f) => String(f.author || "") === String(hit.author || ""));
      if (authored.length > KW_CLUSTER_AT && !kwExpandedAuthors.has(String(hit.author || ""))
        && !kwNodePos.has(hit.id)) {
        kwExpandedAuthors.add(String(hit.author || ""));
        if (kwLastRender) {
          renderKnowledge(kwLastRender.container, kwLastRender.data, kwLastRender.opts);
        }
      }
    }
    const pos = kwNodePos.get(hit ? hit.id : id);
    if (!pos) return;
    const k = Math.max(kwView.k, 1.25);
    kwView.k = Math.min(4, k);
    kwView.x = (container.clientWidth || 800) / 2 - pos.x * kwView.k;
    kwView.y = (container.clientHeight || 600) / 2 - pos.y * kwView.k;
    kwApplyView(view);
    if (hit && opts && typeof opts.onSelectFinding === "function") {
      opts.onSelectFinding(hit.id);
    } else if (actorHit && opts && typeof opts.onSelectActor === "function") {
      opts.onSelectActor(actorHit);
    }
  }

  // The pinned detail card: the current selection rendered on the map
  // itself, derived from the same opts every render so it follows the
  // shell instead of fighting it.
  function kwPinCard(container, overview, promotions, opts) {
    const id = opts && opts.selectedId;
    if (!id) return;
    const findings = overview.findings || [];
    const found = findings.find((f) => f.id === id);
    const actors = overview.actors || {};
    if (!found && !actors[id]) return;
    if (typeof getComputedStyle === "function"
      && getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    const card = kwEl(container, "div", { class: "kw-card" });
    if (found) {
      const degree = promotions.filter((p) => p.finding === found.id).length;
      kwEl(card, "p", { class: "kw-card-title" }, String(found.claim || found.id));
      kwEl(card, "p", { class: "kw-card-fact muted" },
        "by " + String(found.author || "unknown") + " · " + degree
        + (degree === 1 ? " promotion" : " promotions"));
      if (found.evidence) kwEl(card, "p", { class: "kw-card-fact" }, String(found.evidence));
      if (found.limits) kwEl(card, "p", { class: "kw-card-fact muted" }, String(found.limits));
      const step = promotions.find((p) => p.finding === found.id);
      if (step) {
        kwEl(card, "p", { class: "kw-card-fact mono" },
          String(step.source || "?") + " → " + String(step.destination || "?")
          + (step.promotedBy ? " via " + String(step.promotedBy) : ""));
      }
    } else {
      const held = actors[id] || {};
      kwEl(card, "p", { class: "kw-card-title mono" }, String(id));
      kwEl(card, "p", { class: "kw-card-fact muted" },
        [held.role || "", held.parent ? "parent " + held.parent : ""].filter(Boolean).join(" · ")
        || "recorded actor");
      if (held.authored !== undefined || held.received !== undefined) {
        kwEl(card, "p", { class: "kw-card-fact" },
          (held.authored || 0) + " authored · " + (held.received || 0) + " received");
      }
    }
  }

  function kwNodeLabel(g, f, x, y) {
    const words = String(f.claim || f.id);
    const label = words.length > 26 ? words.slice(0, 25) + "…" : words;
    const text = kwSvg(g, "text", {
      x: String(x), y: String(y + 21), class: "kw-word",
      "text-anchor": "middle",
    });
    text.textContent = label;
  }

  function kwRestoreFocus(container, focused) {
    if (!focused) return;
    const node = container.querySelector(focused);
    if (node && typeof node.focus === "function") node.focus();
  }

  function renderKnowledge(container, data, opts) {
    if (!container) return null;
    const active = document.activeElement;
    let focused = null;
    if (active && container.contains(active)) {
      for (const name of ["data-kw-id", "data-kw-node"]) {
        if (active.hasAttribute(name)) focused = '[' + name + '="' + CSS.escape(active.getAttribute(name)) + '"]';
      }
    }
    container.textContent = "";
    const overview = (data && data.overview) || {};
    const promotions = overview.promotions || [];
    if (!overview || (opts && opts.notice)) {
      const p = kwEl(container, "p", { class: "muted" });
      p.textContent = (opts && opts.notice) || "No knowledge read yet.";
      return { findings: 0, promotions: 0 };
    }
    const mode = (opts && opts.mode) || "whole";
    if (!(overview.findings || []).length) {
      const p = kwEl(container, "p", { class: "muted" });
      p.textContent = (opts && opts.query)
        ? "No findings match." : "No recorded findings.";
      return { findings: 0, promotions: promotions.length };
    }
    if (mode === "band") {
      kwRenderBand(container, overview, promotions, opts);
      kwRestoreFocus(container, focused);
      return {
        findings: (overview.findings || []).length,
        promotions: promotions.length,
      };
    }
    kwLastRender = { container, data, opts };
    const ensembles = (data && data.ensembles) || [];
    const collapsed = new Set();
    for (const e of ensembles) {
      if (e && e.id && kwCollapsedEnsembles.has(String(e.id))) {
        for (const m of (e.members || [])) collapsed.add(String(m));
      }
    }
    const layout = kwRenderWhole(container, overview, promotions, opts, collapsed);
    kwPlaceWhole(layout, container, overview, promotions, opts, ensembles, collapsed);
    kwRestoreFocus(container, focused);
    return {
      findings: (overview.findings || []).length,
      promotions: promotions.length,
    };
  }

  // Roster overlay: one arc per recorded promotion joins the source
  // row to the destination row in the margin gutter, so sharing reads
  // at a glance in the default view. Rows that are not rendered take
  // no arc. The selection lights its own arcs.
  function renderArcs(mount, data) {
    if (!mount || typeof document === "undefined") return;
    const old = mount.querySelector(":scope > svg.kw-arcs");
    if (old) old.remove();
    const promotions = (data && data.promotions) || [];
    if (!promotions.length) return;
    if (typeof getComputedStyle === "function"
      && getComputedStyle(mount).position === "static") {
      mount.style.position = "relative";
    }
    const rows = mount.querySelectorAll(".doc-row[data-doc-id]");
    if (rows.length < 2) return;
    const mid = new Map();
    for (const row of rows) {
      mid.set(row.getAttribute("data-doc-id"),
        row.offsetTop + row.offsetHeight / 2);
    }
    const width = mount.scrollWidth || mount.clientWidth || 0;
    const height = mount.scrollHeight || mount.clientHeight || 0;
    if (!width || !height) return;
    const svg = kwSvg(mount, "svg", {
      class: "kw-arcs",
      width: String(width),
      height: String(height),
      viewBox: "0 0 " + width + " " + height,
      "aria-hidden": "true",
    });
    const selectedFinding = data.selectedFindingId || "";
    const selectedId = data.selectedId || "";
    const x = Math.max(0, width - 14);
    for (const p of promotions) {
      const from = p.source ? String(p.source) : "";
      const to = p.destination ? String(p.destination) : "";
      if (!from || !to || from === to) continue;
      if (!mid.has(from) || !mid.has(to)) continue;
      const y1 = mid.get(from);
      const y2 = mid.get(to);
      const hot = (selectedFinding && p.finding === selectedFinding)
        || (selectedId && (from === selectedId || to === selectedId));
      kwSvg(svg, "path", {
        d: "M" + x + "," + y1 + " Q" + (x + 16) + "," + ((y1 + y2) / 2)
          + " " + x + "," + y2,
        class: "kw-arc" + (hot ? " kw-arc-hot" : ""),
        "data-from": from,
        "data-to": to,
        "data-finding": p.finding ? String(p.finding) : "",
      });
    }
    // Row marks in the same overlay gutter: a holding halo where the seat
    // carries shared knowledge, sized by what it holds, and an arrival
    // dot where its recorded state or owed count changed. Only ids with
    // rows in the mount draw.
    const heldBy = (data && data.actors) || {};
    const seats = (data && data.players) || [];
    const sharing = new Set();
    for (const p of promotions) {
      if (p.source) sharing.add(String(p.source));
    }
    for (const seat of seats) {
      const id = seat && seat.id ? String(seat.id) : "";
      if (!id || !mid.has(id)) continue;
      const y = mid.get(id);
      const held = heldBy[id] || {};
      const total = (held.authored || 0) + (held.received || 0);
      if ((held.received || 0) > 0 || sharing.has(id)) {
        kwSvg(svg, "circle", {
          cx: String(x - 20), cy: String(y),
          r: String(4 + Math.min(3, total)),
          class: "kw-row-halo",
          "data-row": id,
        });
      }
      const owed = Math.max(seat.pendingCount || 0, seat.unacknowledgedCount || 0);
      const key = (seat.status || "") + "|" + owed + "|" + (seat.at || "");
      let seen = kwRowSeen.get(id);
      if (!seen) {
        seen = { key, left: 0 };
        kwRowSeen.set(id, seen);
      } else if (seen.key !== key) {
        seen.key = key;
        seen.left = 2;
      }
      if (seen.left > 0) {
        kwSvg(svg, "circle", {
          cx: String(x - 20), cy: String(y), r: "2.5",
          class: "kw-row-arrival kw-new",
          "data-row": id,
        });
        seen.left -= 1;
      }
    }
  }

  window.KnowledgeLayer = { renderKnowledge, renderArcs };
})();


