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

  function kwPromotionsFor(promotions, fid) {
    return promotions.filter((p) => p.finding === fid);
  }

  // Band mode: one mini-surface per author. Each recorded finding is a
  // tick: filled when recorded promotions carry it, hollow when unshared,
  // sized by promotion degree. Distinct destinations read as directed
  // stubs under the ticks. Claims live in tooltips and in the selected
  // finding's label, so the row reads as marks first and words on demand.
  function kwRenderBand(container, overview, promotions, opts) {
    const authors = (opts && opts.authorIds) || [];
    const wrap = kwEl(container, "div", { class: "kw-band" });
    for (const author of authors) {
      const own = (overview.findings || []).filter(
        (f) => String(f.author || "") === String(author));
      if (!own.length) continue;
      const block = kwEl(wrap, "div", {
        class: "kw-author",
        "data-kw-author": String(author),
      });
      const width = Math.max(100, Number(opts && opts.width) || container.clientWidth || 480);
      const columns = Math.max(1, Math.floor((width - 24) / 20));
      const height = Math.ceil(own.length / columns) * 20;
      const svg = kwSvg(block, "svg", {
        class: "kw-strip",
        width: String(width),
        height: String(height),
        viewBox: "0 0 " + width + " " + height,
        role: "group",
        "aria-label": String(author) + ", " + own.length
          + (own.length === 1 ? " finding" : " findings"),
      });
      own.forEach((f, i) => {
        const rels = kwPromotionsFor(promotions, f.id);
        const x = 14 + (i % columns) * 20;
        const y = 10 + Math.floor(i / columns) * 20;
        const selected = opts && opts.selectedId === f.id;
        const g = kwSvg(svg, "g", {
          class: "kw-tick" + (rels.length ? " shared" : " unshared")
            + (selected ? " selected" : ""),
          tabindex: "0", role: "button",
          "aria-label": String(f.id),
          "data-kw-node": String(f.id),
        });
        kwSvg(g, "circle", {
          cx: String(x), cy: String(y),
          r: String(4 + Math.min(2, rels.length)),
          class: "kw-mark" + (rels.length ? "" : " unshared"),
        });
        const tip = kwSvg(g, "title", null);
        tip.textContent = String(f.claim || f.id) + " — " + (rels.length
          ? rels.length + (rels.length === 1 ? " promotion" : " promotions")
          : "unshared");
        if (!kwMatches(opts && opts.query, f.id, f.claim, f.author)) {
          g.classList.add("kw-dim");
        }
        const activate = () => {
          g.focus();
          if (opts && typeof opts.onSelectFinding === "function") {
            opts.onSelectFinding(f.id);
          }
        };
        g.addEventListener("click", activate);
        g.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            if (ev.preventDefault) ev.preventDefault();
            activate();
          }
        });
        if (selected) {
          const label = kwEl(block, "p", { class: "kw-claim" });
          label.textContent = String(f.claim || f.id);
          if (f.evidence) {
            const ev = kwEl(block, "p", { class: "kw-evidence" });
            ev.textContent = String(f.evidence);
          }
          if (f.limits) {
            const lim = kwEl(block, "p", { class: "kw-limits" });
            lim.textContent = String(f.limits);
          }
        }
      });
      const dests = [];
      for (const f of own) {
        for (const p of kwPromotionsFor(promotions, f.id)) {
          if (p.destination && dests.indexOf(String(p.destination)) === -1) {
            dests.push(String(p.destination));
          }
        }
      }
      const destinations = kwEl(block, "div", { class: "kw-destinations" });
      dests.forEach((d) => {
        kwEl(destinations, "span", { class: "kw-stub" }, "→ " + d);
      });
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

  function kwRenderWhole(container, overview, promotions, opts) {
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
      const members = actors.filter((id) => tierOf.get(id) === d)
        .sort((a, b) => ((authored.get(b) || 0) - (authored.get(a) || 0))
          || (a < b ? -1 : 1));
      const items = [];
      for (const id of members) {
        const group = (byAuthor.get(id) || []).slice().sort((a, b) =>
          ((promoCount.get(b.id) || 0) - (promoCount.get(a.id) || 0))
          || String(a.id).localeCompare(String(b.id)));
        items.push(...group);
      }
      const actorRows = Math.max(1, Math.ceil(members.length / actorPerRow));
      const findRows = Math.ceil(items.length / findPerRow);
      return {
        d, members, items, actorRows, findRows,
        height: 44 + actorRows * 30 + (items.length ? 12 + findRows * 30 : 0) + 18,
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
      kwSvg(marker, "title", null).textContent = label;
      kwSvg(marker, "path", { d: "M0,0 L8,4 L0,8 Z", fill });
    }
    const edgeLayer = kwSvg(svg, "g", { class: "kw-edges" });
    return { svg, edgeLayer, tiers, findings, actorPerRow, findPerRow, width };
  }

  function kwPlaceWhole(layout, container, overview, promotions, opts) {
    const { svg, edgeLayer, tiers } = layout;
    const actorPos = new Map();
    const findingPos = new Map();
    const query = opts && opts.query;
    for (const t of tiers) {
      const label = kwSvg(svg, "text", {
        x: String(KW_PAD), y: String(t.y + 4), class: "kw-tier",
      });
      label.textContent = t.d < 0 ? "depth unknown" : "depth " + t.d;
      t.members.forEach((id, i) => {
        const x = KW_GUTTER + (i % layout.actorPerRow) * KW_ACTOR_SLOT + 75;
        const y = t.y + 34 + Math.floor(i / layout.actorPerRow) * 30;
        actorPos.set(String(id), { x, y });
        const g = kwSvg(svg, "g", {
          class: "kw-anchor",
          tabindex: "0", role: "button",
          "aria-label": String(id),
          "data-kw-id": String(id),
        });
        kwSvg(g, "rect", {
          x: String(x - 4), y: String(y - 4), width: "8", height: "8",
          class: "kw-actor",
        });
        const name = kwSvg(g, "text", {
          x: String(x + 10), y: String(y + 4), class: "kw-name mono",
        });
        name.textContent = String(id);
        if (!kwMatches(query, id, "", id)) g.classList.add("kw-dim");
        g.addEventListener("click", () => {
          g.focus();
          if (opts && typeof opts.onSelectActor === "function") {
            opts.onSelectActor(id);
          }
        });
        g.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            if (ev.preventDefault) ev.preventDefault();
            if (opts && typeof opts.onSelectActor === "function") {
              opts.onSelectActor(id);
            }
          }
        });
      });
      const findTop = t.y + 34 + t.actorRows * 30 + 12;
      t.items.forEach((f, j) => {
        const x = KW_GUTTER + (j % layout.findPerRow) * KW_FIND_SLOT + 16;
        const y = findTop + Math.floor(j / layout.findPerRow) * 30;
        findingPos.set(f.id, { x, y });
        const selected = opts && opts.selectedId === f.id;
        const degree = promotions.filter((p) => p.finding === f.id).length;
        const g = kwSvg(svg, "g", {
          class: "knode" + (degree ? "" : " unshared") + (selected ? " selected" : ""),
          tabindex: "0", role: "button",
          "aria-label": String(f.id),
          "data-kw-node": String(f.id),
        });
        kwSvg(g, "circle", {
          cx: String(x), cy: String(y), r: String(5 + Math.min(3, degree)),
          class: "kw-finding" + (degree ? "" : " unshared"),
        });
        const heading = kwSvg(g, "title", null);
        heading.textContent = String(f.claim || f.id)
          + (f.evidence ? " — " + String(f.evidence) : "")
          + (f.limits ? " — " + String(f.limits) : "");
        if (selected) kwNodeLabel(g, f, x, y);
        if (!kwMatches(query, f.id, f.claim, f.author)) {
          g.classList.add("kw-dim");
        }
        g.addEventListener("click", () => {
          g.focus();
          if (opts && typeof opts.onSelectFinding === "function") {
            opts.onSelectFinding(f.id);
          }
        });
        g.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            if (ev.preventDefault) ev.preventDefault();
            if (opts && typeof opts.onSelectFinding === "function") {
              opts.onSelectFinding(f.id);
            }
          }
        });
      });
    }
    const edge = (x1, y1, x2, y2, cls, marker, label, kind, from, to) => {
      const line = kwSvg(edgeLayer, "line", {
        x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2),
        class: cls, "marker-end": "url(#" + marker + ")",
        "aria-label": label, "data-kind": kind,
        "data-from": String(from), "data-to": String(to),
      });
      return line;
    };
    for (const p of promotions) {
      const to = findingPos.get(p.finding);
      if (!to) continue;
      if (p.source && actorPos.has(String(p.source))) {
        const from = actorPos.get(String(p.source));
        edge(from.x, from.y + 6, to.x, to.y - 6, "kw-edge-share",
          "kw-arrow-share", "promotion from " + p.source, "share",
          p.source, p.finding);
      }
      if (p.destination && actorPos.has(String(p.destination))) {
        const dest = actorPos.get(String(p.destination));
        edge(to.x, to.y + 6, dest.x, dest.y - 6, "kw-edge-deliver",
          "kw-arrow-deliver", "delivery to " + p.destination, "deliver",
          p.finding, p.destination);
      }
      const promoter = p.promotedBy ? String(p.promotedBy) : "";
      if (promoter && promoter !== String(p.source || "")
        && promoter !== String(p.destination || "") && actorPos.has(promoter)) {
        const from = actorPos.get(promoter);
        edge(from.x, from.y + 6, to.x, to.y - 6, "kw-edge-promote",
          "kw-arrow-promote", "promoted by " + promoter, "promote",
          promoter, p.finding);
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
    const legend = kwEl(container, "p", { class: "kw-legend muted" });
    legend.textContent = "Rows by recorded parent depth. Circles are "
      + "findings in their author row: size follows promotion count. "
      + "Arrowheads mark direction: gray author to finding, ochre sharing "
      + "source to finding, gray finding to destination, dashed dark "
      + "promoter to finding.";
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
    const layout = kwRenderWhole(container, overview, promotions, opts);
    kwPlaceWhole(layout, container, overview, promotions, opts);
    kwRestoreFocus(container, focused);
    return {
      findings: (overview.findings || []).length,
      promotions: promotions.length,
    };
  }

  window.KnowledgeLayer = { renderKnowledge };
})();


