/* Knowledge surface — recorded findings and promotion edges drawn as a seating
   plan over the recorded hierarchy.

   Read-only. Every character of text is written through textContent. The module
   takes plain data from the page, builds its own SVG, and reports a selection
   back through one callback; it reads no global and starts no request.

   One actor is one stand. The stand's filled height is the actor's authored
   finding count, the brass part is the findings that were promoted at least
   once, and the tick under the baseline is the number of promotions the actor
   received. A promotion is a line from its recorded source seat to its recorded
   destination seat. Seats the snapshot does not carry are labelled, so an
   authored finding is never dropped silently. */

(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";
  var LIVE_STATUS = ["running", "waiting", "pending"];
  var RANK_GAP = 92;
  var STAND_WIDTH = 7;
  // A seat label has to name the seat. Fourteen characters is the shortest label
  // the surface draws, so a rank is at least as wide as that label needs, and the
  // plan grows wider than its box rather than squeezing every name to a prefix.
  // A rank too wide to give every seat fourteen characters falls back to a
  // bounded plan and draws no labels.
  var LABEL_CHARS = 14;
  var LABEL_TAIL = 8;
  var LABEL_MAX_CHARS = 27;
  var CHAR_WIDTH = 6.4;
  var LABEL_STEP = LABEL_CHARS * CHAR_WIDTH;
  var STEP_MIN = 26;
  var STEP_MAX = 168;
  var MAX_PLAN_WIDTH = 8000;
  var STAND_MIN = 12;
  var STAND_MAX = 128;
  // A stand is drawn upward from its baseline at seat.y, and its pointer target
  // reaches HIT_OVERHANG above the body and HIT_BELOW below the baseline, where
  // the seat label sits. Only the first rank needs headroom above it, because
  // every other rank sits below its own baseline, and the headroom is the tallest
  // stand that rank actually carries rather than the global STAND_MAX: a plan
  // whose podium holds a small stand keeps its old height, and a first rank that
  // carries a STAND_MAX stand still gets the full room.
  var HIT_OVERHANG = 8;
  var HIT_BELOW = 22;
  var TOP_MARGIN = 8;
  var PAD = { left: 158, right: 30, bottom: 58 };
  var ARRIVAL_MS = 1600;

  var views = new WeakMap();

  function svg(name, attrs) {
    var node = document.createElementNS(SVG_NS, name);
    if (attrs) {
      var keys = Object.keys(attrs);
      for (var i = 0; i < keys.length; i += 1) node.setAttribute(keys[i], String(attrs[keys[i]]));
    }
    return node;
  }

  function html(name, className, value) {
    var node = document.createElement(name);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function fit(value, max) {
    var text = String(value === undefined || value === null ? "" : value);
    return text.length > max ? text.slice(0, max - 1) + "\u2026" : text;
  }

  // An id longer than the label budget keeps its head and its tail: the part that
  // tells two seats apart is usually the end, and three seats called
  // "dirty-review-…" name nothing. fit() still clamps the result to the budget.
  // The shortest budget, between LABEL_CHARS and the cap, at which no two seats in
  // one rank share a label. Two seats called "native-…ductor" name nothing, so the
  // plan pays for the widest label it needs and no more.
  function labelBudget(groups, cap) {
    for (var budget = LABEL_CHARS; budget <= cap; budget += 1) {
      var unique = true;
      for (var g = 0; g < groups.length && unique; g += 1) {
        var seen = new Set();
        var seats = groups[g].seats;
        for (var i = 0; i < seats.length; i += 1) {
          var label = labelFor(seats[i].id, budget);
          if (seen.has(label)) { unique = false; break; }
          seen.add(label);
        }
      }
      if (unique) return budget;
    }
    return cap;
  }

  // An id longer than the label budget keeps its head and its tail, because the
  // part that tells two seats apart is usually the end and three seats called
  // "dirty-review-…" name nothing. An eight-character tail measured the shortest
  // budget that still separates every seat in a rank of twenty-one; fit() remains
  // the clamp when a budget is too small to split at all.
  function labelFor(id, budget) {
    var text = String(id);
    if (text.length <= budget) return text;
    if (budget <= LABEL_TAIL + 5) return fit(text, budget);
    var tail = Math.min(LABEL_TAIL, budget - 5);
    var head = budget - 1 - tail;
    return text.slice(0, head) + "\u2026" + text.slice(text.length - tail);
  }

  function isLive(status) {
    return LIVE_STATUS.indexOf(status) !== -1;
  }

  /* --- model ------------------------------------------------------------- */

  // Findings, promotions and the snapshot become seats, counts and edges. The
  // counts are computed from the recorded rows themselves so the surface and the
  // list can never disagree about what was recorded.
  function buildModel(data) {
    var findings = Array.isArray(data.findings) ? data.findings : [];
    var promotions = Array.isArray(data.promotions) ? data.promotions : [];
    var players = new Map();
    var wanted = data.players || [];
    for (var i = 0; i < wanted.length; i += 1) {
      if (wanted[i] && wanted[i].id) players.set(wanted[i].id, wanted[i]);
    }

    var findingById = new Map();
    var stats = new Map();
    function stat(id) {
      var value = stats.get(id);
      if (!value) {
        value = { id: id, authored: 0, shared: 0, received: 0 };
        stats.set(id, value);
      }
      return value;
    }

    for (var f = 0; f < findings.length; f += 1) {
      var finding = findings[f];
      if (!finding || !finding.id) continue;
      findingById.set(finding.id, finding);
      if (finding.author) stat(String(finding.author)).authored += 1;
    }

    var promotionsOf = new Map();
    for (var p = 0; p < promotions.length; p += 1) {
      var promotion = promotions[p];
      if (!promotion) continue;
      var findingId = promotion.finding || promotion.id || "";
      if (!promotionsOf.has(findingId)) promotionsOf.set(findingId, []);
      promotionsOf.get(findingId).push(promotion);
      if (promotion.source) stat(String(promotion.source));
      if (promotion.destination) stat(String(promotion.destination)).received += 1;
    }

    promotionsOf.forEach(function (list, findingId) {
      var finding = findingById.get(findingId);
      var author = (finding && finding.author) || (list[0] && list[0].author) || "";
      if (author) stat(String(author)).shared += 1;
    });

    var edges = new Map();
    for (var q = 0; q < promotions.length; q += 1) {
      var item = promotions[q];
      if (!item) continue;
      var source = String(item.source || "");
      var destination = String(item.destination || "");
      if (!source && !destination) continue;
      var key = source + "\u0000" + destination;
      var edge = edges.get(key);
      if (!edge) {
        edge = { source: source, destination: destination, promotions: [] };
        edges.set(key, edge);
      }
      edge.promotions.push(item);
    }

    // Distance from the podium, counted over the whole recorded chain so a rank
    // keeps its meaning while seats are filtered out of the view.
    var ranks = new Map();
    function rankOf(id) {
      if (ranks.has(id)) return ranks.get(id);
      var seen = new Set();
      var cursor = players.get(id);
      var rank = 0;
      while (cursor && cursor.parent && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        var parent = players.get(cursor.parent);
        if (!parent) break;
        cursor = parent;
        rank += 1;
      }
      ranks.set(id, rank);
      return rank;
    }

    var seats = [];
    var ids = new Set();
    stats.forEach(function (value, id) { ids.add(id); });
    edges.forEach(function (edge) {
      if (edge.source) ids.add(edge.source);
      if (edge.destination) ids.add(edge.destination);
    });
    ids.forEach(function (id) {
      var value = stats.get(id) || { id: id, authored: 0, shared: 0, received: 0 };
      var player = players.get(id);
      seats.push({
        id: id,
        authored: value.authored,
        shared: value.shared,
        received: value.received,
        status: player ? String(player.status || "") : "",
        role: player ? String(player.role || "") : "",
        model: player ? String(player.model || "") : "",
        inView: Boolean(player),
        live: Boolean(player) && isLive(player.status),
        rank: player ? rankOf(id) : -1,
      });
    });

    seats.sort(function (a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    var promotionCount = promotions.length;
    var authoredTotal = 0;
    var sharedTotal = 0;
    for (var s = 0; s < seats.length; s += 1) {
      authoredTotal += seats[s].authored;
      sharedTotal += seats[s].shared;
    }

    return {
      seats: seats,
      edges: Array.from(edges.values()),
      findings: findings,
      findingById: findingById,
      promotionCount: promotionCount,
      authoredTotal: authoredTotal,
      sharedTotal: sharedTotal,
    };
  }

  /* --- layout ------------------------------------------------------------ */

  // Ranks are rows of stands, left aligned, top row nearest the podium. The step
  // between stands grows with the widest rank, and a step wide enough for one
  // label turns labels on.
  // A search dims the seats it does not match and leaves every stand where it
  // was, so the shape of the run does not move under the reader. The live filter
  // is a narrowing the reader asked for, and it hides what it removes.
  function layout(model, options) {
    var liveOnly = options.liveOnly !== false;
    var query = String(options.query || "").trim().toLowerCase();
    var searching = Boolean(query);

    var matching = model.seats.filter(function (seat) {
      return !(liveOnly && !seat.live);
    });
    for (var m = 0; m < matching.length; m += 1) {
      matching[m].dim = searching && !matchSeat(matching[m], query, model);
    }

    var groups = [];
    var outGroup = null;
    var byRank = new Map();
    for (var i = 0; i < matching.length; i += 1) {
      var seat = matching[i];
      if (!seat.inView) {
        if (!outGroup) {
          outGroup = { key: "out", label: "recorded outside this view", seats: [] };
          groups.push(outGroup);
        }
        outGroup.seats.push(seat);
        continue;
      }
      if (!byRank.has(seat.rank)) {
        var group = { key: String(seat.rank), label: "", seats: [] };
        byRank.set(seat.rank, group);
        groups.push(group);
      }
      byRank.get(seat.rank).seats.push(seat);
    }
    groups.sort(function (a, b) {
      if (a.key === "out") return 1;
      if (b.key === "out") return -1;
      return Number(a.key) - Number(b.key);
    });

    var widest = 1;
    for (var g = 0; g < groups.length; g += 1) {
      groups[g].seats.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
      if (!groups[g].label) groups[g].label = rankLabel(groups[g].key, groups[g].seats);
      widest = Math.max(widest, groups[g].seats.length);
    }

    var budget = labelBudget(groups, LABEL_MAX_CHARS);
    var available = Math.max(options.width || 0, 320) - PAD.left - PAD.right;
    var step = Math.min(STEP_MAX, Math.max(budget * CHAR_WIDTH, available / widest));
    if (step * widest > MAX_PLAN_WIDTH) step = Math.max(STEP_MIN, MAX_PLAN_WIDTH / widest);
    var width = Math.max(available, step * widest) + PAD.left + PAD.right;
    var labels = step >= LABEL_STEP;

    // A stand's height is decided before the rows are placed, because the first
    // row's headroom is the tallest stand it holds.
    for (var h = 0; h < groups.length; h += 1) {
      for (var s = 0; s < groups[h].seats.length; s += 1) {
        groups[h].seats[s].height = Math.min(STAND_MAX,
          STAND_MIN + Math.sqrt(groups[h].seats[s].authored) * 11);
      }
    }
    var topPad = firstRankHeadroom(groups);
    var height = topPad + Math.max(0, groups.length - 1) * RANK_GAP + PAD.bottom;

    var placed = new Map();
    for (var r = 0; r < groups.length; r += 1) {
      var group = groups[r];
      var y = topPad + r * RANK_GAP;
      group.y = y;
      for (var n = 0; n < group.seats.length; n += 1) {
        var seat = group.seats[n];
        seat.x = PAD.left + step * (n + 0.5);
        seat.y = y;
        placed.set(seat.id, seat);
      }
    }

    var edges = [];
    for (var e = 0; e < model.edges.length; e += 1) {
      var edge = model.edges[e];
      var from = placed.get(edge.source);
      var to = placed.get(edge.destination);
      if (!from || !to || from === to) continue;
      edges.push({ edge: edge, from: from, to: to });
    }

    return {
      groups: groups,
      placed: placed,
      edges: edges,
      width: width,
      height: height,
      topPad: topPad,
      step: step,
      labels: labels,
      labelChars: Math.floor(step / CHAR_WIDTH),
      hidden: model.seats.length - matching.length,
      shown: matching.length,
      dimmed: searching ? matching.filter(function (seat) { return seat.dim; }).length : 0,
    };
  }

  // The top pad clears the tallest stand in the first rank plus the pointer
  // target's overhang and a margin. A group is created only for seats it holds,
  // so the first rank is the top of the plan whenever the plan has seats at all.
  function firstRankHeadroom(groups) {
    var tallest = STAND_MIN;
    if (groups.length) {
      var seats = groups[0].seats;
      for (var i = 0; i < seats.length; i += 1) {
        if (seats[i].height > tallest) tallest = seats[i].height;
      }
    }
    return tallest + HIT_OVERHANG + TOP_MARGIN;
  }

  function matchSeat(seat, query, model) {
    if (seat.id.toLowerCase().indexOf(query) !== -1) return true;
    if (seat.role.toLowerCase().indexOf(query) !== -1) return true;
    var findings = model.findings;
    for (var i = 0; i < findings.length; i += 1) {
      var finding = findings[i];
      if (!finding || String(finding.author || "") !== seat.id) continue;
      if (String(finding.id || "").toLowerCase().indexOf(query) !== -1) return true;
      if (String(finding.claim || "").toLowerCase().indexOf(query) !== -1) return true;
    }
    return false;
  }

  // A rank is named for the roles it actually holds when they agree, and for its
  // distance from the podium when they do not.
  function rankLabel(rank, seats) {
    var roles = new Set();
    for (var i = 0; i < seats.length; i += 1) roles.add(String(seats[i].role || ""));
    if (roles.size === 1) {
      var role = Array.from(roles)[0];
      if (role) return roleName(role, seats.length);
    }
    if (rank === "0") return "podium";
    if (rank === "out") return "recorded outside this view";
    return "rank " + rank;
  }

  function roleName(role, count) {
    if (role === "principal-conductor") return "principal conductor";
    if (role === "associate-conductor") return count === 1 ? "associate conductor" : "associate conductors";
    if (role === "operator") return count === 1 ? "operator" : "operators";
    return count === 1 ? "player" : "players";
  }

  /* --- readout ----------------------------------------------------------- */

  function readoutText(seat) {
    var parts = [seat.id];
    if (seat.role) parts.push(seat.role);
    parts.push(seat.inView ? (seat.status || "no execution recorded") : "not in this view");
    parts.push(seat.authored + (seat.authored === 1 ? " finding" : " findings"));
    parts.push(seat.shared + " shared");
    if (seat.received) parts.push(seat.received + " received");
    return parts.join(" \u00b7 ");
  }

  function standLabel(seat) {
    return readoutText(seat) + ". Select to open the actor.";
  }

  function arcLabel(edge) {
    return edge.promotions.length + " promotion" + (edge.promotions.length === 1 ? "" : "s")
      + " from " + (edge.source || "an unrecorded source")
      + " to " + (edge.destination || "an unrecorded destination")
      + ". Select to read them.";
  }

  /* --- render ------------------------------------------------------------ */

  function render(container, data) {
    if (!container) return;
    var view = views.get(container);
    if (!view) {
      view = { focus: null, signature: "", timer: null };
      views.set(container, view);
    }
    var previousKeys = view.signature ? new Set(view.signature.split("\u0001")) : null;

    var model = buildModel(data || {});
    var plan = layout(model, {
      liveOnly: data.liveOnly,
      query: data.query,
      width: container.clientWidth || (container.parentElement && container.parentElement.clientWidth) || 900,
    });

    var active = document.activeElement;
    var focusKey = active && active.dataset ? active.dataset.ksKey || "" : "";

    // The plan is wider than its box and app.js re-renders the seats whenever the
    // tree's recorded state changes, so the reader's place in the plan survives a
    // render instead of jumping back to the podium on every committed event.
    var oldViewport = container.querySelector(".ks-viewport");
    var scroll = oldViewport ? { left: oldViewport.scrollLeft, top: oldViewport.scrollTop } : null;

    container.textContent = "";
    var figure = html("figure", "ks");
    figure.appendChild(summary(model, plan, data));

    if (!plan.shown) {
      figure.appendChild(notice(model, data));
      container.appendChild(figure);
      view.signature = signatureOf(model);
      return;
    }

    var viewport = html("div", "ks-viewport");
    var surface = svg("svg", {
      "class": "ks-svg",
      width: plan.width,
      height: plan.height,
      viewBox: "0 0 " + plan.width + " " + plan.height,
      role: "group",
      "aria-label": "Knowledge surface: " + plan.shown + " seats with recorded findings",
    });

    renderRanks(surface, plan);
    surface.appendChild(arcMarkers());
    var arcs = svg("g", { "class": "ks-arcs" });
    surface.appendChild(arcs);
    var stands = svg("g", { "class": "ks-stands" });
    surface.appendChild(stands);

    var currentKeys = [];
    var wiring = {
      model: model,
      view: view,
      figure: figure,
      readout: null,
      onSelect: typeof data.onSelect === "function" ? data.onSelect : null,
      onSelectFinding: typeof data.onSelectFinding === "function" ? data.onSelectFinding : null,
      selectedId: data.selectedId || "",
    };

    for (var a = 0; a < plan.edges.length; a += 1) {
      var entry = plan.edges[a];
      var key = "arc:" + entry.edge.source + "\u0000" + entry.edge.destination;
      currentKeys.push(key);
      arcs.appendChild(arcNode(entry, wiring, previousKeys ? !previousKeys.has(key) : false));
    }
    for (var s = 0; s < plan.groups.length; s += 1) {
      var group = plan.groups[s];
      for (var i = 0; i < group.seats.length; i += 1) {
        var seat = group.seats[i];
        var seatKey = "seat:" + seat.id;
        currentKeys.push(seatKey);
        stands.appendChild(standNode(seat, wiring, plan.labels, plan.labelChars,
          previousKeys ? !previousKeys.has(seatKey) : false));
      }
    }

    viewport.appendChild(surface);
    figure.appendChild(viewport);
    var readout = html("div", "ks-readout");
    figure.appendChild(readout);
    container.appendChild(figure);
    if (scroll) {
      var nextViewport = container.querySelector(".ks-viewport");
      if (nextViewport) {
        nextViewport.scrollLeft = scroll.left;
        nextViewport.scrollTop = scroll.top;
      }
    }
    wiring.readout = readout;
    setReadout(wiring, view.focus);

    view.signature = currentKeys.join("\u0001");
    if (view.timer) {
      clearTimeout(view.timer);
      view.timer = null;
    }
    var fresh = figure.querySelectorAll(".ks-new");
    if (fresh.length) {
      view.timer = setTimeout(function () {
        for (var j = 0; j < fresh.length; j += 1) fresh[j].classList.remove("ks-new");
      }, ARRIVAL_MS);
    }
    if (focusKey) {
      var restored = figure.querySelector('[data-ks-key="' + cssEscape(focusKey) + '"]');
      if (restored && typeof restored.focus === "function") restored.focus();
    }
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function signatureOf(model) {
    var keys = [];
    for (var i = 0; i < model.seats.length; i += 1) keys.push("seat:" + model.seats[i].id);
    for (var e = 0; e < model.edges.length; e += 1) {
      keys.push("arc:" + model.edges[e].source + "\u0000" + model.edges[e].destination);
    }
    return keys.join("\u0001");
  }

  function legendPair(className, label) {
    var pair = html("span", "ks-legend-pair");
    pair.appendChild(html("span", "ks-legend-item " + className));
    pair.appendChild(html("span", "ks-legend-text", label));
    return pair;
  }

  function summary(model, plan, data) {
    var cap = html("figcaption", "ks-legend");
    cap.appendChild(legendPair("ks-key-stand", "findings authored"));
    cap.appendChild(legendPair("ks-key-shared", "shared at least once"));
    cap.appendChild(legendPair("ks-key-arc", "recorded promotion, source to destination"));
    var counts = html("span", "ks-legend-count");
    counts.textContent = plan.shown + " of " + model.seats.length + " seats, "
      + model.sharedTotal + " of " + model.authoredTotal + " findings shared, "
      + model.promotionCount + " promotions";
    if (plan.dimmed) {
      counts.textContent += ", " + (plan.shown - plan.dimmed) + " match the filter";
    }
    if (data.liveOnly === true) {
      counts.textContent += ", live seats only";
      if (plan.hidden) counts.textContent += " (" + plan.hidden + " hidden)";
    }
    cap.appendChild(counts);
    return cap;
  }

  function notice(model, data) {
    var box = html("div", "ks-notice");
    var text;
    if (!model.seats.length) {
      text = (data && data.notice) || "No recorded findings.";
    } else if (data && data.liveOnly !== false) {
      text = "No live seat holds a recorded finding. "
        + model.seats.length + " seats are outside the live filter.";
    } else {
      text = "No seat matches the filter.";
    }
    box.textContent = text;
    return box;
  }

  // The arrow marks the destination end: a promotion is recorded from a source
  // seat to a destination seat, and the direction is part of the fact.
  function arcMarkers() {
    var defs = svg("defs");
    var marker = svg("marker", {
      id: "ks-arrow", viewBox: "0 0 8 8", refX: 7, refY: 4,
      markerWidth: 5, markerHeight: 5, orient: "auto-start-reverse",
    });
    marker.appendChild(svg("path", { "class": "ks-arrow-head", d: "M 0 1 L 8 4 L 0 7 z" }));
    defs.appendChild(marker);
    return defs;
  }

  function renderRanks(surface, plan) {
    for (var i = 0; i < plan.groups.length; i += 1) {
      var group = plan.groups[i];
      var line = svg("line", {
        "class": "ks-rank" + (group.key === "0" ? " ks-podium" : ""),
        x1: 0, x2: plan.width, y1: group.y, y2: group.y,
      });
      surface.appendChild(line);
      var label = svg("text", { "class": "ks-rank-label", x: 8, y: group.y - 6 });
      label.textContent = group.label + " \u00b7 " + group.seats.length;
      surface.appendChild(label);
    }
  }

  function standNode(seat, wiring, labels, labelChars, fresh) {
    var node = svg("g", {
      "class": "ks-stand ks-" + (seat.live ? "live" : seat.inView ? "idle" : "out")
        + (seat.id === wiring.selectedId ? " ks-selected" : "")
        + (seat.dim ? " ks-dim" : "")
        + (fresh ? " ks-new" : ""),
      transform: "translate(" + seat.x + " " + seat.y + ")",
      tabindex: "0",
      role: "button",
      "data-ks-key": "seat:" + seat.id,
      "data-ks-seat": seat.id,
      "data-ks-x": seat.x,
      "data-ks-y": seat.y,
      "aria-label": standLabel(seat),
    });
    var height = seat.height;
    var shared = seat.authored ? Math.round(height * (seat.shared / seat.authored)) : 0;

    node.appendChild(svg("rect", {
      "class": "ks-body",
      x: -STAND_WIDTH / 2, y: -height, width: STAND_WIDTH, height: height,
    }));
    if (shared > 0) {
      node.appendChild(svg("rect", {
        "class": "ks-shared",
        x: -STAND_WIDTH / 2, y: -shared, width: STAND_WIDTH, height: shared,
      }));
    }
    if (seat.received > 0) {
      var tickWidth = 9 + Math.min(seat.received, 9) * 3;
      node.appendChild(svg("rect", {
        "class": "ks-received",
        x: -tickWidth / 2, y: 5, width: tickWidth, height: 2.5,
      }));
    }
    node.appendChild(svg("line", {
      "class": "ks-foot", x1: -9, x2: 9, y1: 0, y2: 0,
    }));
    if (labels) {
      var label = svg("text", { "class": "ks-stand-label", x: 0, y: HIT_BELOW });
      label.textContent = labelFor(seat.id, labelChars);
      node.appendChild(label);
    }
    node.appendChild(svg("rect", {
      "class": "ks-hit", x: -13, y: -height - HIT_OVERHANG, width: 26,
      height: height + HIT_OVERHANG + HIT_BELOW,
    }));

    node.addEventListener("focus", function () {
      wiring.view.focus = { kind: "seat", id: seat.id };
      setReadout(wiring, wiring.view.focus);
    });
    node.addEventListener("pointerenter", function () {
      setReadout(wiring, { kind: "seat", id: seat.id });
    });
    node.addEventListener("click", function () {
      if (wiring.onSelect) wiring.onSelect(seat.id);
    });
    node.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (wiring.onSelect) wiring.onSelect(seat.id);
        return;
      }
      move(event, node, seat);
    });
    return node;
  }

  function arcNode(entry, wiring, fresh) {
    var from = entry.from;
    var to = entry.to;
    var x1 = from.x;
    var y1 = from.y - from.height;
    var x2 = to.x;
    var y2 = to.y - to.height;
    var bend = Math.max(18, Math.abs(y2 - y1) * 0.42);
    var path = svg("path", {
      "class": "ks-arc" + (entry.from.dim || entry.to.dim ? " ks-dim" : "") + (fresh ? " ks-new" : ""),
      d: "M " + x1 + " " + y1 + " C " + x1 + " " + (y1 - bend) + " " + x2 + " " + (y2 - bend) + " " + x2 + " " + y2,
      "data-ks-key": "arc:" + entry.edge.source + "\u0000" + entry.edge.destination,
      tabindex: "0",
      role: "button",
      "aria-label": arcLabel(entry.edge),
    });
    path.setAttribute("stroke-width", String(1 + Math.min(entry.edge.promotions.length, 4)));
    path.addEventListener("focus", function () {
      wiring.view.focus = { kind: "arc", source: entry.edge.source, destination: entry.edge.destination };
      setReadout(wiring, wiring.view.focus);
    });
    path.addEventListener("pointerenter", function () {
      setReadout(wiring, { kind: "arc", source: entry.edge.source, destination: entry.edge.destination });
    });
    path.addEventListener("click", function () {
      wiring.view.focus = { kind: "arc", source: entry.edge.source, destination: entry.edge.destination };
      setReadout(wiring, wiring.view.focus);
    });
    return path;
  }

  function move(event, node, seat) {
    var keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (keys.indexOf(event.key) === -1) return;
    var surface = node.ownerSVGElement;
    if (!surface) return;
    var stands = Array.prototype.slice.call(surface.querySelectorAll(".ks-stand"));
    var index = stands.indexOf(node);
    if (index === -1) return;
    event.preventDefault();
    var next = null;
    if (event.key === "ArrowLeft") next = stands[index - 1] || null;
    else if (event.key === "ArrowRight") next = stands[index + 1] || null;
    else {
      var up = event.key === "ArrowUp";
      var best = null;
      var bestScore = Infinity;
      for (var i = 0; i < stands.length; i += 1) {
        var other = stands[i];
        if (other === node) continue;
        var dy = Number(other.dataset.ksY || 0) - Number(node.dataset.ksY || 0);
        if (up ? dy >= -1 : dy <= 1) continue;
        var dx = Math.abs(Number(other.dataset.ksX || 0) - Number(node.dataset.ksX || 0));
        var score = dx + Math.abs(dy) * 0.3;
        if (score < bestScore) {
          bestScore = score;
          best = other;
        }
      }
      next = best;
    }
    if (next && typeof next.focus === "function") next.focus();
  }

  /* --- readout ----------------------------------------------------------- */

  function setReadout(wiring, focus) {
    var box = wiring.readout;
    if (!box) return;
    box.textContent = "";
    if (!focus) {
      box.appendChild(html("p", "ks-readout-hint",
        "Focus a stand to read its recorded findings; focus a line to read its promotions."));
      return;
    }
    if (focus.kind === "seat") {
      var seat = null;
      for (var i = 0; i < wiring.model.seats.length; i += 1) {
        if (wiring.model.seats[i].id === focus.id) seat = wiring.model.seats[i];
      }
      if (!seat) return;
      box.appendChild(html("h3", "ks-readout-title", seat.id));
      var dl = html("dl", "ks-readout-facts");
      addFact(dl, "recorded state", seat.inView ? (seat.status || "no execution recorded") : "not in this view");
      addFact(dl, "role", seat.role || "unknown");
      addFact(dl, "model", seat.model || "unknown");
      addFact(dl, "authored findings", String(seat.authored));
      addFact(dl, "shared at least once", String(seat.shared));
      addFact(dl, "promotions received", String(seat.received));
      box.appendChild(dl);
      var authored = [];
      wiring.model.findings.forEach(function (finding) {
        if (finding && String(finding.author || "") === seat.id) authored.push(finding);
      });
      if (!authored.length) {
        box.appendChild(html("p", "ks-readout-hint", "No authored finding recorded for this seat."));
        return;
      }
      var list = html("ol", "ks-findings");
      for (var f = 0; f < authored.length; f += 1) {
        var finding = authored[f];
        list.appendChild(findingRow(wiring, String(finding.id), String(finding.claim || ""), null));
      }
      box.appendChild(list);
      return;
    }
    var rows = [];
    for (var e = 0; e < wiring.model.edges.length; e += 1) {
      var edge = wiring.model.edges[e];
      if (edge.source === focus.source && edge.destination === focus.destination) {
        rows = edge.promotions;
        break;
      }
    }
    box.appendChild(html("h3", "ks-readout-title",
      (focus.source || "an unrecorded source") + " to " + (focus.destination || "an unrecorded destination")));
    if (!rows.length) {
      box.appendChild(html("p", "ks-readout-hint", "No promotion recorded on this line."));
      return;
    }
    var table = html("ol", "ks-findings");
    for (var r = 0; r < rows.length; r += 1) {
      var promotion = rows[r];
      var findingId = String(promotion.finding || promotion.id || "");
      var record = wiring.model.findingById.get(findingId);
      table.appendChild(findingRow(wiring, findingId,
        record && record.claim ? String(record.claim) : "",
        "author " + (promotion.author || "unknown")
        + ", promoted by " + (promotion.promotedBy || "unknown")));
    }
    box.appendChild(table);
  }

  // A finding row. When the page offers a finding handler the id is a control
  // that opens the recorded finding; otherwise the id is plain text.
  function findingRow(wiring, id, claim, meta) {
    var entry = html("li", "ks-finding");
    if (wiring.onSelectFinding) {
      var button = html("button", "ks-finding-id");
      button.type = "button";
      button.textContent = id;
      button.addEventListener("click", function () { wiring.onSelectFinding(id); });
      entry.appendChild(button);
    } else {
      entry.appendChild(html("code", "ks-finding-id", id));
    }
    entry.appendChild(html("span", "ks-finding-claim", claim || "Claim not carried by this read."));
    if (meta) entry.appendChild(html("span", "ks-finding-meta", meta));
    return entry;
  }

  function addFact(list, label, value) {
    var wrap = html("div", "ks-fact");
    wrap.appendChild(html("dt", null, label));
    wrap.appendChild(html("dd", null, value));
    list.appendChild(wrap);
  }

  /* The page entry point. `overview` is the knowledge overview the promotion
     list already reads; `options` carries the snapshot and the page state. */
  function renderKnowledgeSeats(container, overview, options) {
    var opts = options || {};
    render(container, {
      findings: (overview && overview.findings) || [],
      promotions: (overview && overview.promotions) || [],
      players: opts.players || [],
      liveOnly: opts.liveOnly,
      query: opts.query,
      selectedId: opts.selectedId,
      notice: opts.notice,
      onSelect: opts.onSelectActor,
      onSelectFinding: opts.onSelectFinding,
    });
  }

  window.KnowledgeSurface = { render: renderKnowledgeSeats };
})();
