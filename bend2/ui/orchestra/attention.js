/* The pit stage: liveness, document order and the seating plan. Read-only.
   One global entry: renderAttention(container, data, options).

   Readings. Each actor gets one reading from its own record, and the two reads the
   shell names are kept apart. A seat that owes work holds recorded messages it has
   not acknowledged: that is the actor's own inbox responsibility and never asks
   for a person by itself. A seat that needs a person is held by a fact only a
   person clears: an explicit stop, or a failure on the current attempt, which
   counts even when the process exited zero. A stopped seat keeps its messages and
   may be resumed, so its word states what the record holds rather than what cannot
   happen.

   Order. The entry returns the document order the page composes against: what
   needs a person first, then live work, then queues, then quiet. Bands take the
   order of their highest-ranked member.

   The stage. The mount is drawn as the orchestra it records: the conductors on
   the podium tier, every ensemble a tier of seats, one seat per actor painted by
   its reading, the baton on the seat that acted most recently, a queue tick under
   a seat that holds one, an elapsed ring whose arc is how long that seat has been
   on its current action, and, when the shell passes them, the recorded relations
   as threads between the seats that hold them.

   Every tier is mapped onto the mount's width and wraps inside it, so no seat is
   ever painted outside the box. The stage's height is bounded and reported.

   The default set is the shell's: an actor is seated unless its id arrives in
   options.quietIds, or unless options.showEnded is true.

   Keyboard: the stage is one tab stop. Arrow keys walk the drawn seats in draw
   order, Home and End go to the ends, Enter and Space select through
   options.onSelect, and the cursor seat is announced.

   Presentation lives in attention.css, an ordinary stylesheet: the page serves
   `default-src 'self'` and refuses an inserted <style>, which is why the rules
   are not written here. The module reads no other module's DOM and starts no
   request. */

(function () {
  "use strict";

  /* ── geometry ─────────────────────────────────────────────────────────── */

  var GUTTER = 132;       // the tier labels' column
  var EDGE_PAD = 16;      // keeps a seat's pointer target inside the box
  var MIN_PITCH = 17;     // seat width plus a gap; below this a tier wraps
  var SEAT_TOP = 26;      // room above the top tier for a halo and a label
  var TIER_GAP_MIN = 18;
  var TIER_GAP_MAX = 34;
  var MAX_STAGE_H = 470;  // the height the drawing is kept inside
  var SEAT_R = 5.5;
  var HIT_R = 12;
  var BOW = 14;
  var MARK_PAD = 10;
  var STRIP_LIMIT = 12;
  var ID_SHOWN = 30;

  // Readings, worst first. The index is the document order and it follows the
  // meanings: a recorded failure first, then live work, then the seats that owe
  // work or hold it under a stop, then quiet.
  var READINGS = ["failed", "running", "waiting", "stalled", "queued", "ended", "unobserved"];

  // One paint per reading. A queue is an outline, so routine work never takes the
  // accent that marks a seat needing a person. The fills name page tokens, which
  // the pit remaps to their lit variants.
  var PAINT = {
    failed: { fill: "var(--failed, #b3261e)", ring: "var(--failed, #b3261e)" },
    stalled: { fill: "var(--attention, #a2611f)", ring: "var(--attention, #a2611f)" },
    running: { fill: "var(--running, #1e7e34)", ring: "var(--running, #1e7e34)" },
    waiting: { fill: "var(--stage-starting, #d7b45a)", ring: "var(--stage-starting, #d7b45a)" },
    queued: { fill: "var(--wash, #eef1f6)", stroke: "var(--muted, #5b6478)" },
    ended: { fill: "var(--hairline, #d7dce5)" },
    unobserved: { fill: "none", stroke: "var(--hairline, #d7dce5)" },
  };

  var SVG_NS = "http://www.w3.org/2000/svg";
  var expandedByContainer = new WeakMap();
  var dataByContainer = new WeakMap();
  var readingsByContainer = new WeakMap();
  var cursorByContainer = new WeakMap();

  /* ── readings ─────────────────────────────────────────────────────────── */

  function readingRank(reading) {
    var index = READINGS.indexOf(reading);
    return index === -1 ? READINGS.length : index;
  }

  // What needs a person: a fact only a person can clear, which is an explicit stop
  // or a failure on the current attempt. A queue is work the actor owes, its own
  // inbox responsibility, and never asks for a person by itself. The shell states
  // both reads by name on every row it hands over; a caller that passes the raw
  // record is read from the record instead, by the same rule.
  function needsHuman(reading) {
    return reading === "failed" || reading === "stalled";
  }

  function namedFlag(player, name, fallback) {
    var value = player ? player[name] : undefined;
    return typeof value === "boolean" ? value : fallback;
  }

  // What the rail lists: a seat a person must act on, or a seat that owes work.
  // Only the first carries the accent.
  function isListed(row) {
    return row.needsPerson || row.owesWork;
  }

  function isLive(reading) {
    return reading === "running" || reading === "waiting";
  }

  function shortId(id) {
    var full = String(id === undefined || id === null ? "" : id);
    return full.length > ID_SHOWN ? full.slice(0, ID_SHOWN - 1) + "\u2026" : full;
  }

  // Everything the seat owes, whatever the kind: queued inputs it has not
  // acknowledged and reports it was sent and never acknowledged. The shell states
  // the total as owedTotal; a page that does not is read from the two counts it
  // does state, and never from pendingCount alone, which misses reports.
  function owedCount(player) {
    function count(value) {
      var n = Number(value);
      return isFinite(n) && n > 0 ? n : 0;
    }
    if (!player) return 0;
    var total = count(player.owedTotal);
    if (total > 0) return total;
    return Math.max(count(player.pendingCount), count(player.unacknowledgedCount));
  }

  // The recorded terminal of the current attempt: null when the attempt ended
  // cleanly, or the provider failure it ended on. A failure is a failure even
  // when the process itself exited zero, so this is read before the exit status.
  function failureOf(player) {
    if (player && player.failure) return player.failure;
    var execution = player && player.execution;
    return (execution && execution.failure) || null;
  }

  // A queue alone is never a reason to involve a human. A page that has already
  // summarised the record into a status word is read from that word instead.
  function readingOf(player) {
    if (!player || !player.id) return "unobserved";
    var execution = player.execution || null;
    var stop = player.stop || null;
    var owed = owedCount(player);
    if (failureOf(player)) return "failed";
    if (execution || stop) {
      if (execution && execution.phase === "exited" && execution.status !== "exit 0") return "failed";
      if (stop && stop.status === "stopped") return owed > 0 ? "stalled" : "ended";
      if (execution && execution.phase === "running") return "running";
      if (execution && execution.phase === "starting") return "waiting";
      if (owed > 0) return "queued";
      if (execution && execution.phase === "exited") return "ended";
      return "unobserved";
    }
    var word = String(player.status || "");
    if (word === "failed") return "failed";
    if (word === "running") return "running";
    if (word === "waiting" || word === "starting") return "waiting";
    if (word === "stopped") return owed > 0 ? "stalled" : "ended";
    if (word === "completed" || word === "ended") return owed > 0 ? "queued" : "ended";
    if (word === "pending") return "queued";
    return owed > 0 ? "queued" : "unobserved";
  }

  function activityOf(player) {
    var action = player.currentAction || null;
    if (action && action.label) return String(action.label);
    if (player.taskTitle) return String(player.taskTitle);
    if (player.action) return String(player.action);
    return "";
  }

  function atOf(player) {
    var action = player.currentAction || null;
    if (action && action.at) return String(action.at);
    if (player.actionAt) return String(player.actionAt);
    if (player.at) return String(player.at);
    return "";
  }

  function readingWord(reading, owed) {
    if (reading === "failed") return "failed";
    // A stopped seat keeps its messages: the record shows a stop and unacknowledged
    // messages, and it does not say they can never be delivered. The messages wait
    // for that actor, and the seat may be resumed.
    if (reading === "stalled") return "stopped, " + owed + " awaiting the actor";
    if (reading === "running") return "running";
    if (reading === "waiting") return "starting";
    if (reading === "queued") return owed + " owed";
    if (reading === "ended") return "ended";
    return "no execution recorded";
  }

  function playerList(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.players)) return data.players;
    return [];
  }

  function memberIds(player) {
    var ids = [];
    var listed = (player && (player.ensembles || player.memberEnsembles)) || [];
    for (var i = 0; i < listed.length; i += 1) {
      var id = listed[i] && typeof listed[i] === "object"
        ? (listed[i].id || listed[i].ensemble) : listed[i];
      if (id && ids.indexOf(String(id)) === -1) ids.push(String(id));
    }
    return ids;
  }

  function isConductor(role) {
    return role === "principal-conductor" || role === "associate-conductor";
  }

  function quietSet(options) {
    var listed = options.quietIds;
    if (!listed) return null;
    if (typeof listed.has === "function") return listed;
    var set = new Set();
    for (var i = 0; i < listed.length; i += 1) set.add(String(listed[i]));
    return set;
  }

  /* ── the analysis ─────────────────────────────────────────────────────── */

  function analyse(data, options) {
    var players = playerList(data);
    var quiet = quietSet(options);
    var showEnded = options.showEnded === true;
    var readings = {};
    var rows = [];
    for (var i = 0; i < players.length; i += 1) {
      var player = players[i];
      if (!player || !player.id) continue;
      var id = String(player.id);
      var reading = readingOf(player);
      var owed = owedCount(player);
      var isQuiet = quiet ? quiet.has(id)
        : (reading === "ended" || reading === "unobserved");
      readings[id] = reading;
      rows.push({
        id: id,
        reading: reading,
        word: readingWord(reading, owed),
        rank: readingRank(reading),
        owed: owed,
        queued: owed > 0,
        // The two reads, named by the shell when it names them.
        needsPerson: namedFlag(player, "needsPerson", needsHuman(reading)),
        owesWork: namedFlag(player, "owesWork", owed > 0),
        live: isLive(reading),
        role: String(player.role || ""),
        conductor: isConductor(String(player.role || "")),
        activity: activityOf(player),
        at: atOf(player),
        stale: player.stale === true,
        memberOf: memberIds(player),
        // Seated unless the shell read it quiet, or the reader asked for all.
        seated: showEnded || !isQuiet,
      });
    }
    rows.sort(function (a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (b.owed !== a.owed) return b.owed - a.owed;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    var counts = {
      failed: 0, stalled: 0, running: 0, waiting: 0,
      queued: 0, ended: 0, unobserved: 0, withQueue: 0,
    };
    var bandRank = {};
    for (var r = 0; r < rows.length; r += 1) {
      counts[rows[r].reading] += 1;
      if (rows[r].queued) counts.withQueue += 1;
      for (var m = 0; m < rows[r].memberOf.length; m += 1) {
        var band = rows[r].memberOf[m];
        if (bandRank[band] === undefined || rows[r].rank < bandRank[band].rank) {
          bandRank[band] = { rank: rows[r].rank, reading: rows[r].reading };
        }
      }
    }

    var seated = rows.filter(function (row) { return row.seated; });
    return {
      rows: rows,
      seatedRows: seated,
      readings: readings,
      counts: counts,
      needHuman: rows.filter(function (row) { return row.needsPerson; }),
      owing: rows.filter(function (row) { return row.owesWork; }),
      listed: rows.filter(isListed),
      bandRank: bandRank,
      stage: stagePlan(seated, (data && data.ensembles) || []),
    };
  }

  /* ── the seating plan ─────────────────────────────────────────────────── */

  // Conductors stand on the podium tier; every ensemble is one tier, and actors
  // in no ensemble share the last tier. Tiers keep the document order inside.
  function stagePlan(rows, ensembles) {
    var podium = [];
    var byBand = new Map();
    var loose = [];
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      if (row.conductor) { podium.push(row); continue; }
      if (!row.memberOf.length) { loose.push(row); continue; }
      var key = row.memberOf[0];
      if (!byBand.has(key)) byBand.set(key, []);
      byBand.get(key).push(row);
    }

    var labels = {};
    for (var e = 0; e < ensembles.length; e += 1) {
      if (ensembles[e] && ensembles[e].id) labels[String(ensembles[e].id)] = String(ensembles[e].id);
    }

    var tiers = [];
    if (podium.length) tiers.push({ id: "", label: "podium", rows: podium });
    byBand.forEach(function (members, key) {
      tiers.push({ id: key, label: shortId(labels[key] || key), rows: members });
    });
    if (loose.length) tiers.push({ id: "", label: "no ensemble", rows: loose });

    // The baton rests on the most recent recorded action among the working seats.
    var target = "";
    var newest = -1;
    for (var t = 0; t < rows.length; t += 1) {
      if (!rows[t].live || !rows[t].at) continue;
      var when = Date.parse(rows[t].at);
      if (isFinite(when) && when > newest) { newest = when; target = rows[t].id; }
    }

    return { tiers: tiers, batonTarget: target };
  }

  // Every tier is mapped onto the mount's width: its seats span the usable box,
  // and a tier too wide for one row wraps into further rows inside the same box.
  // Nothing is placed outside the box, and the height the drawing needs is
  // returned so the shell and the reader both know it.
  function layoutStage(plan, width) {
    var w = Math.max(width || 0, 320);
    var usable = Math.max(40, w - GUTTER - EDGE_PAD);
    var widest = 0;
    for (var t = 0; t < plan.tiers.length; t += 1) {
      if (plan.tiers[t].rows.length > widest) widest = plan.tiers[t].rows.length;
    }
    var perRow = widest > 1 ? Math.max(2, Math.floor(usable / MIN_PITCH)) : 1;
    if (widest && perRow > widest) perRow = widest;

    var totalRows = 0;
    for (var s = 0; s < plan.tiers.length; s += 1) {
      totalRows += Math.max(1, Math.ceil(plan.tiers[s].rows.length / perRow));
    }

    var budget = MAX_STAGE_H - SEAT_TOP - 30 - BOW;
    var gap = totalRows > 0
      ? Math.floor(budget / totalRows)
      : TIER_GAP_MAX;
    gap = Math.max(TIER_GAP_MIN, Math.min(TIER_GAP_MAX, gap));

    var seats = [];
    var order = [];
    var y = SEAT_TOP;
    for (var i = 0; i < plan.tiers.length; i += 1) {
      var tier = plan.tiers[i];
      var count = tier.rows.length;
      var rowsOfTier = Math.max(1, Math.ceil(count / perRow));
      tier.label = tier.label;
      tier.y = y;
      tier.rowsOnTier = rowsOfTier;
      var inRow = Math.min(count, perRow);
      var pitch = inRow > 1 ? usable / (inRow - 1) : 0;
      var half = w / 2;
      for (var k = 0; k < count; k += 1) {
        var row = Math.floor(k / inRow);
        var column = k - row * inRow;
        var x = inRow === 1 ? GUTTER + usable / 2 : GUTTER + column * pitch;
        // The tiers bow away from the podium at the edges, so the hall reads as a
        // seating plan rather than as a table of lines.
        var bow = BOW * Math.pow((x - half) / Math.max(1, half), 2);
        var seat = { seat: tier.rows[k], x: x, y: tier.y + row * gap + bow };
        seats.push(seat);
        order.push(tier.rows[k].id);
      }
      y += rowsOfTier * gap;
    }

    var height = Math.round(y + BOW + MARK_PAD);
    return { seats: seats, order: order, height: height, gap: gap, perRow: perRow, width: w };
  }

  /* ── drawing ──────────────────────────────────────────────────────────── */

  function svgEl(name, attrs) {
    var node = document.createElementNS(SVG_NS, name);
    if (attrs) {
      var keys = Object.keys(attrs);
      for (var i = 0; i < keys.length; i += 1) {
        node.setAttribute(keys[i], String(attrs[keys[i]]));
      }
    }
    return node;
  }

  function setText(node, value) {
    node.textContent = value === undefined || value === null ? "" : String(value);
  }

  function span(className, value) {
    var node = document.createElement("span");
    if (className) node.className = className;
    setText(node, value);
    return node;
  }

  // How long a working seat has been on its recorded action, against the longest
  // working seat, so duration is read as the length of an arc.
  function elapsedOf(row, now, longest) {
    if (!row.live || !row.at || !longest) return 0;
    var when = Date.parse(row.at);
    if (!isFinite(when)) return 0;
    var spent = now - when;
    if (!isFinite(spent) || spent <= 0) return 0;
    return Math.max(0.08, Math.min(1, spent / longest));
  }

  function seatNode(seat, options, fresh, fraction, cursor) {
    var paint = PAINT[seat.reading] || PAINT.unobserved;
    var group = svgEl("g", {
      "class": "att-seat"
        + (fresh ? " att-new" : "")
        + (seat.live ? " att-working" : "")
        + (seat.needsPerson ? " att-stuck" : "")
        + (options.selectedId === seat.id ? " att-selected" : "")
        + (cursor ? " att-cursor" : ""),
      "data-att-key": "seat:" + seat.id,
      "data-att-id": seat.id,
    });

    if (fraction > 0) {
      var radius = SEAT_R + 3.5;
      var circumference = 2 * Math.PI * radius;
      var spent = svgEl("circle", {
        "class": "att-elapsed", r: radius, cx: 0, cy: 0, transform: "rotate(-90)",
      });
      spent.style.fill = "none";
      spent.style.stroke = paint.ring || "var(--running, #1e7e34)";
      spent.style.strokeWidth = "1.6";
      spent.style.strokeDasharray = (fraction * circumference).toFixed(1) + " " + circumference.toFixed(1);
      group.appendChild(spent);
    }

    if (seat.live) {
      var halo = svgEl("circle", { "class": "att-halo", r: SEAT_R + 5, cx: 0, cy: 0 });
      halo.style.fill = paint.ring || "none";
      group.appendChild(halo);
    }

    // The fermata ring: the one accent, on a seat a person must act on.
    if (seat.needsPerson) {
      var alarm = svgEl("circle", { "class": "att-ring", r: SEAT_R + 4, cx: 0, cy: 0 });
      alarm.style.fill = "none";
      alarm.style.stroke = paint.ring || "none";
      group.appendChild(alarm);
    }

    var core = svgEl("circle", { "class": "att-core", r: SEAT_R, cx: 0, cy: 0 });
    core.style.fill = paint.fill || "none";
    if (paint.stroke) {
      core.style.stroke = paint.stroke;
      core.style.strokeWidth = "1.2";
    }
    group.appendChild(core);

    if (seat.queued) {
      var tick = svgEl("rect", {
        "class": "att-tick", x: -(2 + Math.min(seat.owed, 6)), y: SEAT_R + 3,
        width: 4 + Math.min(seat.owed, 6) * 2, height: 2.5, rx: 1,
      });
      tick.style.fill = "var(--muted, #5b6478)";
      group.appendChild(tick);
    }

    var ring = svgEl("circle", { "class": "att-seat-ring", r: SEAT_R + 2.5, cx: 0, cy: 0 });
    ring.style.fill = "none";
    group.appendChild(ring);

    var hit = svgEl("circle", { "class": "att-hit", r: HIT_R, cx: 0, cy: 0 });
    group.appendChild(hit);

    var title = svgEl("title");
    setText(title, seat.id + " \u2014 " + seat.word
      + (seat.activity ? " \u2014 " + seat.activity : "")
      + (seat.stale ? " (stale)" : ""));
    group.appendChild(title);

    group.addEventListener("click", function () {
      if (typeof options.onSelect === "function") options.onSelect(seat.id);
    });
    return group;
  }

  // Recorded relations as threads between the seats that hold them: promotions
  // from the knowledge overview, message traffic from the page's events. Stroke
  // only, so a thread reads as a connection and never as a filled field.
  function relationThreads(stage, positions, knowledge, events) {
    drawPromotions(stage, positions, knowledge);
    drawTraffic(stage, positions, events);
  }

  function drawPromotions(stage, positions, knowledge) {
    var promotions = knowledge && Array.isArray(knowledge.promotions)
      ? knowledge.promotions : [];
    if (!promotions.length) return;
    var pairs = new Map();
    for (var i = 0; i < promotions.length; i += 1) {
      var promotion = promotions[i];
      if (!promotion) continue;
      var source = String(promotion.source || "");
      var destination = String(promotion.destination || "");
      if (!source || !destination) continue;
      var key = source + "\u0000" + destination;
      pairs.set(key, (pairs.get(key) || 0) + 1);
    }
    pairs.forEach(function (count, key) {
      var parts = key.split("\u0000");
      var from = positions[parts[0]];
      var to = positions[parts[1]];
      if (!from || !to || from === to) return;
      var lift = Math.min(90, Math.max(20, Math.abs(to.y - from.y) * 0.4));
      var path = svgEl("path", {
        "class": "att-know",
        d: "M " + from.x + " " + from.y
          + " C " + from.x + " " + (from.y - lift)
          + " " + to.x + " " + (to.y - lift)
          + " " + to.x + " " + to.y,
      });
      path.setAttribute("stroke-width", String(0.9 + Math.min(count, 5) * 0.4));
      var title = svgEl("title");
      setText(title, count + (count === 1 ? " promotion" : " promotions")
        + " from " + parts[0] + " to " + parts[1]);
      path.appendChild(title);
      stage.appendChild(path);
    });
  }

  // The page holds its events newest first. A thread joins the seat that
  // recorded the change to the seat on the far side; its ink is the recorded
  // kind, and its strength is how recent the newest of that pair is.
  function drawTraffic(stage, positions, events) {
    if (!Array.isArray(events) || !events.length) return;
    var pairs = new Map();
    for (var i = 0; i < events.length; i += 1) {
      var event = events[i];
      if (!event) continue;
      var one = String(event.session || "");
      var other = String(event.counterpart || "");
      if (!one || !other || one === other) continue;
      if (!positions[one] || !positions[other]) continue;
      var key = one + "\u0000" + other;
      var held = pairs.get(key);
      if (held) held.count += 1;
      else pairs.set(key, { count: 1, age: i, kind: String(event.kind || "") });
    }
    var oldest = Math.max(1, events.length);
    pairs.forEach(function (held, key) {
      var parts = key.split("\u0000");
      var from = positions[parts[0]];
      var to = positions[parts[1]];
      if (!from || !to || from === to) return;
      var lift = Math.min(90, Math.max(20, Math.abs(to.y - from.y) * 0.4));
      var path = svgEl("path", {
        "class": "att-thread att-thread-" + (held.kind || "recorded"),
        d: "M " + from.x + " " + from.y
          + " C " + from.x + " " + (from.y - lift)
          + " " + to.x + " " + (to.y - lift)
          + " " + to.x + " " + to.y,
      });
      path.setAttribute("stroke-width", String(0.9 + Math.min(held.count, 5) * 0.4));
      path.style.opacity = (0.18 + 0.72 * (1 - held.age / oldest)).toFixed(2);
      var title = svgEl("title");
      setText(title, held.count + (held.count === 1 ? " recorded change" : " recorded changes")
        + " between " + parts[0] + " and " + parts[1]);
      path.appendChild(title);
      stage.appendChild(path);
    });
  }

  function stageSvg(result, laid, options, fresh, cursorId, relations) {
    var plan = result.stage;
    var positions = {};
    for (var p = 0; p < laid.seats.length; p += 1) positions[laid.seats[p].seat.id] = laid.seats[p];

    var svg = svgEl("svg", {
      "class": "att-stage",
      "data-att-key": "stage",
      width: laid.width,
      height: laid.height,
      viewBox: "0 0 " + laid.width + " " + laid.height,
      tabindex: "0",
      role: "application",
      "aria-label": "The stage. " + laid.seats.length + " seats drawn of "
        + result.rows.length + " recorded actors. Arrow keys walk the seats, Enter opens one.",
    });

    // The podium line and the tier labels.
    var line = svgEl("line", { x1: 0, x2: laid.width, y1: SEAT_TOP - 8, y2: SEAT_TOP - 8 });
    svg.appendChild(line);
    for (var t = 0; t < plan.tiers.length; t += 1) {
      var label = svgEl("text", { "class": "att-section", x: 2, y: plan.tiers[t].y + 3 });
      setText(label, plan.tiers[t].label);
      svg.appendChild(label);
    }

    var now = Date.now();
    var longest = 0;
    for (var w = 0; w < result.rows.length; w += 1) {
      var working = result.rows[w];
      if (!working.live || !working.at) continue;
      var since = Date.parse(working.at);
      if (isFinite(since) && now - since > longest) longest = now - since;
    }

    // The baton, drawn under the seats so it never hides one.
    var holderId = "";
    for (var h = 0; h < plan.tiers.length; h += 1) {
      if (plan.tiers[h].label !== "podium") continue;
      for (var q = 0; q < plan.tiers[h].rows.length; q += 1) {
        if (plan.tiers[h].rows[q].role === "principal-conductor") holderId = plan.tiers[h].rows[q].id;
      }
      if (!holderId && plan.tiers[h].rows.length) holderId = plan.tiers[h].rows[0].id;
    }
    var holder = positions[holderId];
    var target = positions[plan.batonTarget];
    if (holder && target && holder !== target) {
      var baton = svgEl("path", {
        "class": "att-baton",
        d: "M " + holder.x + " " + (holder.y + 10)
          + " C " + holder.x + " " + (holder.y + 46)
          + " " + target.x + " " + (target.y - 46)
          + " " + target.x + " " + (target.y - 10),
      });
      svg.appendChild(baton);
    }

    relationThreads(svg, positions, relations && relations.knowledge, relations && relations.events);

    for (var i = 0; i < laid.seats.length; i += 1) {
      var node = seatNode(laid.seats[i].seat, options, fresh[laid.seats[i].seat.id] === true,
        elapsedOf(laid.seats[i].seat, now, longest), laid.seats[i].seat.id === cursorId);
      node.setAttribute("transform", "translate(" + laid.seats[i].x + " " + laid.seats[i].y + ")");
      svg.appendChild(node);
    }

    svg.dataset.attHeight = String(laid.height);
    svg.dataset.attGap = String(laid.gap);
    svg.dataset.attPerRow = String(laid.perRow);
    return svg;
  }

  // The legend is a key to the marks, not a second report: the pit's plate line
  // already states how many seats need a person and how many owe work, so no
  // number is printed twice on the page.
  function legendNode() {
    var legend = document.createElement("div");
    legend.className = "att-legend";
    var keys = [
      ["var(--running, #1e7e34)", "", "playing"],
      ["var(--stage-starting, #d7b45a)", "", "starting"],
      ["var(--muted, #5b6478)", "var(--muted, #5b6478)", "owes work"],
      ["var(--attention, #a2611f)", "", "needs a person"],
      ["var(--hairline, #23272f)", "var(--muted, #5b6478)", "quiet"],
    ];
    for (var i = 0; i < keys.length; i += 1) {
      var key = document.createElement("span");
      key.className = "att-key";
      var swatch = document.createElement("i");
      swatch.style.background = keys[i][0];
      if (keys[i][1]) swatch.style.border = "1px solid " + keys[i][1];
      key.appendChild(swatch);
      key.appendChild(span(null, keys[i][2]));
      legend.appendChild(key);
    }
    return legend;
  }

  // One row per seat that needs a person or holds a queue. A seat needing a
  // person takes the accent; a queue is muted, so routine delivery is never
  // presented as an intervention request.
  function chipNode(row, options) {
    var chip = document.createElement("button");
    chip.type = "button";
    var stuck = row.needsPerson;
    chip.className = "lane-chip att-" + row.reading
      + (stuck ? " att-need" : " att-queued")
      + (row.live ? " att-live" : "")
      + (options.selectedId === row.id ? " selected" : "");
    chip.dataset.attKey = "chip:" + row.id;
    chip.setAttribute("aria-label",
      row.id + ", " + row.word + (row.activity ? ", " + row.activity : "")
      + ". Select to open the actor.");
    chip.appendChild(span("status-word", row.word));
    chip.appendChild(span("lane-id mono", shortId(row.id)));
    if (row.activity) chip.appendChild(span("att-activity", row.activity));
    if (row.owed > 0) chip.appendChild(span("lane-badge", row.owed));
    chip.addEventListener("click", function () {
      if (typeof options.onSelect === "function") options.onSelect(row.id);
    });
    return chip;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }

  /* ── the entry ────────────────────────────────────────────────────────── */

  function renderAttention(container, data, options) {
    var opts = options || {};
    var result = analyse(data, opts);
    result.width = container ? (container.clientWidth || 640) : 640;
    if (!container) return result;

    var expanded = expandedByContainer.get(container) || false;
    var cursor = cursorByContainer.get(container);
    if (typeof cursor !== "number") cursor = 0;

    var previous = readingsByContainer.get(container) || null;
    var fresh = {};
    if (previous) {
      for (var i = 0; i < result.rows.length; i += 1) {
        var row = result.rows[i];
        if (previous[row.id] && previous[row.id] !== row.reading) fresh[row.id] = true;
      }
    }
    var next = {};
    for (var j = 0; j < result.rows.length; j += 1) next[result.rows[j].id] = result.rows[j].reading;
    readingsByContainer.set(container, next);

    var restore = null;
    var active = document.activeElement;
    if (active && active.dataset && container.contains(active)) {
      restore = active.dataset.attKey || null;
    }

    container.textContent = "";
    dataByContainer.set(container, data);

    var relations = {
      knowledge: (data && data.knowledge) || opts.knowledge || null,
      events: (data && data.events) || opts.events || null,
    };

    var laid = layoutStage(result.stage, result.width);
    if (laid.order.length) cursor = ((cursor % laid.order.length) + laid.order.length) % laid.order.length;
    else cursor = 0;
    cursorByContainer.set(container, cursor);
    var cursorId = laid.order[cursor] || "";
    var stage = {
      svg: stageSvg(result, laid, opts, fresh, cursorId, relations),
      order: laid.order,
      height: laid.height,
    };
    result.drawnHeight = laid.height;
    result.drawnSeats = laid.order.length;
    result.drawnGap = laid.gap;
    container.appendChild(stage.svg);

    var live = document.createElement("div");
    live.className = "att-sr";
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    container.appendChild(live);
    result.announce = function (text) { setText(live, text); };

    var cursorRow = null;
    for (var c = 0; c < result.rows.length; c += 1) {
      if (result.rows[c].id === cursorId) cursorRow = result.rows[c];
    }

    function moveCursor(step) {
      var order = stage.order;
      if (!order.length) return;
      cursor = ((cursor + step) % order.length + order.length) % order.length;
      cursorByContainer.set(container, cursor);
      renderAttention(container, dataByContainer.get(container), opts);
    }

    function selectCursor() {
      var id = stage.order[cursor] || "";
      if (!id) return;
      setText(live, "Opened " + id + ".");
      if (typeof opts.onSelect === "function") opts.onSelect(id);
    }

    stage.svg.addEventListener("focus", function () {
      if (cursorRow) {
        setText(live, cursorRow.id + ", " + cursorRow.word
          + (cursorRow.activity ? ", " + cursorRow.activity : ""));
      } else {
        setText(live, "The stage. No seat is drawn.");
      }
    });

    stage.svg.addEventListener("keydown", function (event) {
      var key = event.key;
      if (key === "ArrowRight" || key === "ArrowDown") { event.preventDefault(); moveCursor(1); return; }
      if (key === "ArrowLeft" || key === "ArrowUp") { event.preventDefault(); moveCursor(-1); return; }
      if (key === "Home") { event.preventDefault(); cursor = 0; cursorByContainer.set(container, 0); renderAttention(container, dataByContainer.get(container), opts); return; }
      if (key === "End") {
        event.preventDefault();
        cursor = stage.order.length - 1;
        cursorByContainer.set(container, cursor);
        renderAttention(container, dataByContainer.get(container), opts);
        return;
      }
      if (key === "Enter" || key === " " || key === "Spacebar") { event.preventDefault(); selectCursor(); }
    });

    container.appendChild(legendNode());

    var listed = result.listed;
    var shown = expanded ? listed : listed.slice(0, STRIP_LIMIT);
    var folded = listed.length - shown.length;
    result.strip = {
      shown: shown.length,
      total: listed.length,
      folded: folded,
      expanded: expanded,
      humans: result.needHuman.length,
    };

    if (!listed.length) {
      var quiet = document.createElement("p");
      quiet.className = "att-quiet";
      setText(quiet, "Nothing needs a person and no queue is waiting. "
        + (result.counts.running + result.counts.waiting) + " seats are playing or starting.");
      container.appendChild(quiet);
      return result;
    }

    for (var k = 0; k < shown.length; k += 1) {
      container.appendChild(chipNode(shown[k], opts));
    }

    if (folded > 0 || expanded) {
      var fold = document.createElement("button");
      fold.type = "button";
      fold.className = "lane-chip att-fold";
      fold.dataset.attKey = "fold";
      fold.setAttribute("aria-expanded", expanded ? "true" : "false");
      setText(fold, expanded
        ? "Show the " + STRIP_LIMIT + " highest"
        : "Show all " + listed.length + " (" + folded + " folded)");
      fold.addEventListener("click", function () {
        expandedByContainer.set(container, !expanded);
        renderAttention(container, dataByContainer.get(container), opts);
      });
      container.appendChild(fold);
    }

    if (restore) {
      var back = container.querySelector('[data-att-key="' + cssEscape(restore) + '"]');
      if (back && typeof back.focus === "function") back.focus();
    }
    return result;
  }

  window.renderAttention = renderAttention;
})();
