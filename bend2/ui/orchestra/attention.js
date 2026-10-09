/* Liveness and document order. Read-only. All text via textContent.
   One global entry: renderAttention(container, data, options).

   Two jobs, both from recorded fields only:

   1. Reading. Each actor gets one reading from its own record. Only a failure,
      or a stopped seat holding messages that can never be delivered to it, needs
      a person. A queue of ordinary messages is routine work: it is delivered to
      the actor that owns it, so it reads queued and never as a request for a
      human. Live work reads running or waiting; the rest is quiet.

   2. Order. The entry returns the document order the page composes against:
      what needs a person first, then live work, then queues, then quiet. Bands
      take the order of their highest-ranked member, so the document can sequence
      its bands without repeating the rule.

   The entry draws two things into the container it is given: one mark per actor
   in that order, so the shape of the run reads at a glance, and one row per seat
   that needs a person or holds a queue. Selecting a mark or a row goes back
   through options.onSelect. The module reads no other module's DOM and starts no
   request. */

(function () {
  "use strict";

  var STRIP_LIMIT = 12;
  var ID_SHOWN = 30;
  var MARK_PITCH = 8;
  var MARK_SIZE = 6;
  var MARK_ROW = 9;

  // Readings, most needing first. The index is the document order.
  var READINGS = ["failed", "stalled", "running", "waiting", "queued", "ended", "unobserved"];

  // One fill per reading. A queue is drawn as an outline so routine work never
  // takes the accent that marks a seat needing a person.
  var MARKS = {
    failed: { fill: "var(--failed, #b3261e)" },
    stalled: { fill: "var(--attention, #a2611f)" },
    running: { fill: "var(--running, #1e7e34)" },
    waiting: { fill: "var(--waiting, #8a6d00)" },
    queued: { fill: "none", stroke: "var(--muted, #5b6478)" },
    ended: { fill: "var(--hairline, #d7dce5)" },
    unobserved: { fill: "none", stroke: "var(--hairline, #d7dce5)" },
  };

  var expandedByContainer = new WeakMap();
  var lastByContainer = new WeakMap();

  function readingRank(reading) {
    var index = READINGS.indexOf(reading);
    return index === -1 ? READINGS.length : index;
  }

  function needsHuman(reading) {
    return reading === "failed" || reading === "stalled";
  }

  function isLive(reading) {
    return reading === "running" || reading === "waiting";
  }

  function shortId(id) {
    var full = String(id === undefined || id === null ? "" : id);
    return full.length > ID_SHOWN ? full.slice(0, ID_SHOWN - 1) + "\u2026" : full;
  }

  function owedCount(player) {
    var owed = Number(player.pendingCount);
    if (!isFinite(owed) || owed < 0) owed = 0;
    return owed;
  }

  // The reading comes from the actor's own recorded fields: its stop, its last
  // committed execution, and the messages still awaiting acknowledgement. A page
  // that has already summarised those fields into a status word is read from that
  // word instead, so the module states one reading whether it is handed the
  // records or their summary. A queue alone is never a reason to involve a human.
  function readingOf(player) {
    if (!player || !player.id) return "unobserved";
    var execution = player.execution || null;
    var stop = player.stop || null;
    var owed = owedCount(player);
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
    if (word === "completed") return owed > 0 ? "queued" : "ended";
    if (word === "pending") return "queued";
    return owed > 0 ? "queued" : "unobserved";
  }

  // What the actor is doing now, from its recorded action, then its recorded
  // task title. Nothing here infers work from the reading.
  function activityOf(player) {
    var action = player.currentAction || null;
    if (action && action.label) return String(action.label);
    if (player.taskTitle) return String(player.taskTitle);
    if (player.action) return String(player.action);
    return "";
  }

  function readingWord(reading, owed) {
    if (reading === "failed") return "failed";
    if (reading === "stalled") return "stopped, " + owed + " never delivered";
    if (reading === "running") return "running";
    if (reading === "waiting") return "starting";
    if (reading === "queued") return owed + " queued";
    if (reading === "ended") return "ended";
    return "no execution recorded";
  }

  function playerList(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.players)) return data.players;
    return [];
  }

  // The shell passes the actor's ensembles as `ensembles`; the earlier page shape
  // used `memberEnsembles`. Both name the same recorded membership, so the band
  // order reads either.
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

  // The order the document is composed in, and the readings behind it. Returned
  // from the single entry so the page sequences bands and members from one place.
  function analyse(data) {
    var players = playerList(data);
    var readings = {};
    var rows = [];
    for (var i = 0; i < players.length; i += 1) {
      var player = players[i];
      if (!player || !player.id) continue;
      var id = String(player.id);
      var reading = readingOf(player);
      var owed = owedCount(player);
      readings[id] = reading;
      rows.push({
        id: id,
        reading: reading,
        word: readingWord(reading, owed),
        rank: readingRank(reading),
        owed: owed,
        queued: owed > 0,
        live: isLive(reading),
        activity: activityOf(player),
        memberOf: memberIds(player),
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

    return {
      rows: rows,
      readings: readings,
      counts: counts,
      // Only a failure or a stopped seat holding undelivered messages is a
      // request for a person; a queue is listed because it is worth seeing.
      needHuman: rows.filter(function (row) { return needsHuman(row.reading); }),
      listed: rows.filter(function (row) {
        return needsHuman(row.reading) || row.queued;
      }),
      bandRank: bandRank,
    };
  }

  function setText(node, value) {
    node.textContent = value === undefined || value === null ? "" : String(value);
  }

  function span(className, value) {
    var node = document.createElement("span");
    node.className = className;
    setText(node, value);
    return node;
  }

  // One mark per actor, in the document order, so the shape of the run reads
  // before any word is read: where work is, where queues sit, where a failure is.
  // The marks carry no tab stop, because the document gives each row one; they
  // select on pointer, and the rows below carry the accessible text.
  function markBand(rows, width, options) {
    var svgNs = "http://www.w3.org/2000/svg";
    var perRow = Math.max(8, Math.floor(Math.max(width, 160) / MARK_PITCH));
    var lines = Math.max(1, Math.ceil(rows.length / perRow));
    var band = document.createElementNS(svgNs, "svg");
    band.setAttribute("class", "att-marks");
    band.setAttribute("width", String(Math.min(perRow, Math.max(rows.length, 1)) * MARK_PITCH));
    band.setAttribute("height", String(lines * MARK_ROW));
    band.setAttribute("aria-hidden", "true");
    band.setAttribute("focusable", "false");
    for (var i = 0; i < rows.length; i += 1) {
      var tone = MARKS[rows[i].reading] || MARKS.unobserved;
      var rect = document.createElementNS(svgNs, "rect");
      rect.setAttribute("x", String((i % perRow) * MARK_PITCH));
      rect.setAttribute("y", String(Math.floor(i / perRow) * MARK_ROW));
      rect.setAttribute("width", String(MARK_SIZE));
      rect.setAttribute("height", String(MARK_SIZE));
      rect.setAttribute("rx", "1");
      // Tokens are read through inline style, not through presentation
      // attributes: a presentation attribute does not substitute var().
      rect.style.fill = tone.fill || "none";
      if (tone.stroke) {
        rect.style.stroke = tone.stroke;
        rect.style.strokeWidth = "1";
      }
      var title = document.createElementNS(svgNs, "title");
      setText(title, rows[i].id + ", " + rows[i].word);
      rect.appendChild(title);
      rect.setAttribute("data-att-key", "mark:" + rows[i].id);
      rect.style.cursor = "pointer";
      rect.addEventListener("click", (function (id) {
        return function () {
          if (typeof options.onSelect === "function") options.onSelect(id);
        };
      })(rows[i].id));
      band.appendChild(rect);
    }
    return band;
  }

  // One row per seat that needs a person or holds a queue. A seat needing a
  // person takes the accent; a queue is muted, so routine delivery is never
  // presented as an intervention request.
  function chipNode(row, options) {
    var chip = document.createElement("button");
    chip.type = "button";
    var stuck = row.reading === "failed" || row.reading === "stalled";
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

  function renderAttention(container, data, options) {
    var opts = options || {};
    var result = analyse(data);
    if (!container) return result;

    var expanded = expandedByContainer.get(container) || false;
    var restore = null;
    var active = document.activeElement;
    if (active && active.dataset && container.contains(active)) {
      restore = active.dataset.attKey || null;
    }

    container.textContent = "";
    lastByContainer.set(container, data);
    // The mark band reads the width it is drawn into, because its wrap needs one;
    // nothing else on the page is measured.
    container.appendChild(markBand(result.rows, container.clientWidth || 320, opts));

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
      quiet.className = "att-quiet muted";
      setText(quiet, "Nothing needs a person and no queue is waiting. "
        + (result.counts.running + result.counts.waiting) + " seats are live.");
      container.appendChild(quiet);
      return result;
    }

    for (var i = 0; i < shown.length; i += 1) {
      container.appendChild(chipNode(shown[i], opts));
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
        renderAttention(container, lastByContainer.get(container), opts);
      });
      container.appendChild(fold);
    }

    if (restore) {
      var next = container.querySelector('[data-att-key="' + cssEscape(restore) + '"]');
      if (next && typeof next.focus === "function") next.focus();
    }
    return result;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }

  window.renderAttention = renderAttention;
})();
