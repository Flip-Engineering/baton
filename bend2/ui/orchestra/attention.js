/* The stage: liveness, document order and the seating plan. Read-only.
   One global entry: renderAttention(container, data, options).

   State vocabulary, settled: running, queued, stopped, failed, owes work,
   quiet. Starting is work in flight and reads as running. A stop or a failure is a
   state, never a request to a person. The document order is failed, stopped,
   queued, owes work, running, quiet; bands take their highest member's.

   A seat whose read carries no stop flag and no stop word says "no stop recorded" in
   its title and its label, and a stop the read names another way is quoted as it
   reads. The marks are unchanged by either: a stop that is read still draws its ring.

   The stage draws one seat per actor, shaped and inked by its state, with the
   baton on the seat that acted most recently, a recency trail above the mark, a
   queue bar under a seat that owes work, and the recorded relations as threads
   between the seats that hold them. Every tier maps onto the
   mount's width and wraps inside it, so no seat is painted outside the box.

   The default set is the shell's: an actor is seated unless its id arrives in
   options.quietIds, or unless options.showEnded is true. Keyboard: one tab stop;
   arrows walk the drawn seats, Home and End go to the ends, Enter and Space select
   through options.onSelect, and the cursor seat is announced. Presentation lives
   in attention.css. */

(function () {
  "use strict";

  /* ── geometry ─────────────────────────────────────────────────────────── */

  // The label column holds a tier's name flush left and its seat count flush
  // right. It is as wide as the names need: the floor keeps a clipped name
  // readable, the cap keeps the seats their room, and below the floor a name is
  // shortened with the full one in its title.
  var GUTTER_MIN = 96;
  var GUTTER_MAX = 200;
  var CHAR_W = 6.2;       // one character of the 10px mono label
  var LABEL_PAD = 26;     // the count's column and the gap to the seats
  var SEAT_TOP = 26;      // the least room above the top tier
  var R_MIN = 5.5;        // the mark's radius at the largest run
  var R_MAX = 18;         // the mark's radius at the smallest run
  // The hall keeps this height unless the mount states its own: the band the
  // shell gives the mount, less the legend and one row of chips.
  var SHELL_BOUND = 164;
  var BOW = 14;           // how far the outermost seats bow from the conductors' tier
  var STRIP_LIMIT = 12;   // strip rows before the fold
  var ID_SHOWN = 30;      // characters of an id before the ellipsis
  var SHORT_KEEP = 24;    // an id this short is already its own short form
  var STAMP = /^\d{4,}$/; // a trailing date stamp is not part of a name
  // The window the trail grades against: the score's own live window, RIBBON_LIVE_MS in
  // ribbon.js, so the two surfaces agree about what recent means. Copied rather than
  // read, because this module reads no other module.
  var RECENT_WINDOW_MS = 90000;

  // Worst first: the document order is also the strip's order and the roster's.
  var READINGS = ["failed", "stopped", "queued", "owesWork", "running", "quiet"];

  // One ink and one silhouette per state. The shape carries the state too, so the
  // stage reads for a reader who cannot separate the colours.
  var PAINT = {
    failed: { ink: "var(--failed, #ef6b5f)", shape: "triangle" },
    stopped: { ink: "var(--attention, #e2a94f)", shape: "square" },
    queued: { ink: "var(--stage-starting, #d7b45a)", shape: "ring" },
    owesWork: { ink: "var(--muted, #9aa3b4)", shape: "diamond" },
    running: { ink: "var(--running, #57c46a)", shape: "circle" },
    quiet: { ink: "var(--staff, #39404b)", shape: "dot", dim: true },
  };

  // A mark reads at any count: few actors get large marks, a large run gets
  // smaller ones, and the tier's pitch follows the radius so marks never touch.
  function radiusFor(count) {
    var radius = 20 - 1.6 * Math.sqrt(Math.max(1, count));
    return Math.max(R_MIN, Math.min(R_MAX, radius));
  }

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

  // The states whose work the record holds still.
  function notProgressingReading(reading) {
    return reading === "failed" || reading === "stopped";
  }

  function namedFlag(player, name, fallback) {
    var value = player ? player[name] : undefined;
    return typeof value === "boolean" ? value : fallback;
  }

  // What the strip lists: a seat whose work the record holds, or one that owes it.
  function isListed(row) {
    return row.notProgressing || row.owesWork;
  }

  function shortId(id, max) {
    var full = String(id === undefined || id === null ? "" : id);
    var limit = typeof max === "number" && max > 4 ? max : ID_SHOWN;
    return full.length > limit ? full.slice(0, limit - 1) + "\u2026" : full;
  }

  // A seat's short form: the part of its id that names it. The trailing stamp goes,
  // the last name part stays with its number when that part is short (dsflash-1,
  // muse-2), and a name that two seats would share takes one more part of their ids.
  function shortForms(ids) {
    var parts = {};
    var take = {};
    var i;
    for (i = 0; i < ids.length; i += 1) {
      var id = ids[i];
      var full = String(id);
      if (full.length <= SHORT_KEEP) {
        parts[id] = [full];
        take[id] = 1;
        continue;
      }
      var list = full.split(/[-_.]/).filter(function (part) { return part !== ""; });
      if (list.length > 1 && STAMP.test(list[list.length - 1])) list.pop();
      parts[id] = list.length ? list : [full];
      var last = parts[id][parts[id].length - 1];
      take[id] = parts[id].length > 1 && last.length <= 2 ? 2 : 1;
    }
    for (var pass = 0; pass < 8; pass += 1) {
      var groups = {};
      for (i = 0; i < ids.length; i += 1) {
        var text = joinTail(parts[ids[i]], take[ids[i]], ids[i]);
        if (groups[text]) groups[text].push(ids[i]);
        else groups[text] = [ids[i]];
      }
      var grew = false;
      var keys = Object.keys(groups);
      for (var g = 0; g < keys.length; g += 1) {
        if (groups[keys[g]].length < 2) continue;
        for (var m = 0; m < groups[keys[g]].length; m += 1) {
          var seatId = groups[keys[g]][m];
          if (take[seatId] < parts[seatId].length) {
            take[seatId] += 1;
            grew = true;
          }
        }
      }
      if (!grew) break;
    }
    var forms = {};
    for (i = 0; i < ids.length; i += 1) forms[ids[i]] = joinTail(parts[ids[i]], take[ids[i]], ids[i]);
    return forms;
  }

  function joinTail(parts, take, fallback) {
    if (!parts || !parts.length) return String(fallback);
    return parts.slice(-take).join("-");
  }

  // The forms a seat's name can take, longest first: the id, its short form, then
  // the name's head with its number and alone, down to two characters.
  function labelForms(id, short) {
    var forms = [];
    function push(text) {
      var value = String(text === undefined || text === null ? "" : text);
      if (value && forms.indexOf(value) === -1) forms.push(value);
    }
    push(shortId(id, ID_SHOWN));
    push(short);
    var tail = String(short).split(/[-_.]/);
    var number = tail.length > 1 && /^\d+$/.test(tail[tail.length - 1]) ? tail.pop() : "";
    var name = tail.length ? tail[tail.length - 1] : String(short);
    for (var k = 5; k >= 2; k -= 1) push(name.slice(0, k) + number);
    for (var j = 5; j >= 2; j -= 1) push(name.slice(0, j));
    forms.sort(function (a, b) {
      if (b.length !== a.length) return b.length - a.length;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return forms;
  }

  // The longest form that fits the room, and never the short form's floor cut below
  // it: a seat keeps a name it can carry rather than none.
  function formFor(forms, chars) {
    for (var i = 0; i < forms.length; i += 1) {
      if (forms[i].length <= chars) return forms[i];
    }
    return shortId(forms[forms.length - 1] || "", chars);
  }

  // A seat's name, placed so that no mark of the seat itself can cover it: beside the
  // mark in the seat's own band, which costs the row no height, or under the mark
  // when the row leaves a whole line free below the seat's own marks. The name is
  // shortened to the room it is given and kept only when two characters fit.
  function seatLabelFor(forms, place) {
    var label = labelBeside(forms, place);
    if (!label && place.gap >= place.radius * 2.2 + 18) label = labelUnder(forms, place);
    return label;
  }

  // Beside the mark, in the seat's own band: the room is what is left between the
  // next seat's mark, the box edge, the row's label column, and any name already
  // placed beside this row.
  function labelBeside(forms, place) {
    var pad = place.radius + 7;
    var right = place.caps.right - (place.x + pad) - 2;
    var left = (place.x - pad) - place.caps.left - 2;
    var room = Math.floor(Math.max(right, left) / CHAR_W);
    if (room < 2) return null;
    var toRight = right >= left;
    return {
      text: formFor(forms, room),
      anchor: toRight ? "start" : "end",
      dx: toRight ? pad : -pad,
      baseline: 4,
      under: false,
    };
  }

  // Under the mark. The seat's own marks reach past the queue bar at 5.5 radii below
  // its centre, and the next row's mark reaches 1.15 radii above its own, so the line
  // starts at radius + 14 and needs a row that leaves it that room.
  function labelUnder(forms, place) {
    var beside = place.pitch / 2;
    var left = place.x - 4;
    var right = place.width - 4 - place.x;
    var centred = 2 * Math.min(beside, left, right);
    var room;
    var anchor = "middle";
    var dx = 0;
    if (centred >= 2 * CHAR_W) {
      room = Math.floor(centred / CHAR_W);
    } else if (right >= left) {
      room = Math.floor((Math.min(right, beside) - 2) / CHAR_W);
      anchor = "start";
      dx = 2;
    } else {
      room = Math.floor((Math.min(left, beside) - 2) / CHAR_W);
      anchor = "end";
      dx = -2;
    }
    if (room < 2) return null;
    return {
      text: formFor(forms, room),
      anchor: anchor,
      dx: dx,
      baseline: place.radius + 14,
      under: true,
    };
  }

  // Everything the seat owes: queued inputs it has not acknowledged and reports
  // sent and never acknowledged. The shell states the total as owedTotal, so
  // pendingCount alone is never the read; it misses reports.
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
  // cleanly, else the provider failure it ended on. A failure is a failure even
  // when the process exited zero, so this is read before the exit status.
  function failureOf(player) {
    if (player && player.failure) return player.failure;
    var execution = player && player.execution;
    return (execution && execution.failure) || null;
  }

  // One state per actor, in the settled words. A stop outranks everything the
  // execution says, and a queue outranks quiet.
  function readingOf(player) {
    if (!player || !player.id) return "quiet";
    var execution = player.execution || null;
    var stop = player.stop || null;
    var owed = owedCount(player);
    if (failureOf(player)) return "failed";
    if (execution || stop) {
      if (execution && execution.phase === "exited" && execution.status !== "exit 0") return "failed";
      if (stop && stop.status === "stopped") return "stopped";
      if (execution && execution.phase === "running") return "running";
      if (execution && execution.phase === "starting") return "running";
      if (owed > 0) return execution && execution.phase === "exited" ? "queued" : "owesWork";
      return "quiet";
    }
    var word = String(player.status || "");
    if (word === "failed") return "failed";
    // A page that states only a word: the corrected state for a stored "waiting"
    // (an attempt that has started) is running, never queued.
    if (word === "running" || word === "waiting" || word === "starting") return "running";
    if (word === "stopped") return "stopped";
    if (word === "completed" || word === "ended") return owed > 0 ? "queued" : "quiet";
    if (word === "pending") return owed > 0 ? "owesWork" : "quiet";
    return owed > 0 ? "owesWork" : "quiet";
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

  // The state's own word, with an exact count where the seat owes work. Text
  // surfaces only: the stage and the strip carry the shape and the ink, and the
  // count travels with any state that holds work, running included.
  function readingWord(reading, owed) {
    var count = owed > 0 ? ", " + owed + " owed" : "";
    if (reading === "failed") return "failed";
    if (reading === "stopped") return "stopped" + count;
    if (reading === "queued") return "queued" + count;
    if (reading === "owesWork") return "owes work" + count;
    if (reading === "running") return "running" + count;
    return "quiet";
  }

  // An activity taken from an earlier recorded event says so. A retained
  // conversation must not read as one that is working now.
  function activityText(row) {
    if (!row || !row.activity) return "";
    return row.stale ? row.activity + " (recorded earlier)" : row.activity;
  }

  // What the read says about a stop, in the read's own words. Where the read carries
  // no stop flag and no stop word, the pit says the stop is not recorded instead of
  // drawing its absence as the record's own statement. The marks are unaffected: a
  // stop that is read still draws its ring and its word.
  function stopNote(player) {
    var stop = player ? player.stop : undefined;
    if (stop && String(stop.status || "") === "stopped") return "";
    if (stop && stop.status) return "stop recorded as " + String(stop.status);
    if (typeof (player ? player.notProgressing : undefined) === "boolean") return "";
    var word = String((player && player.status) || "");
    if (word === "stopped" || word === "failed") return "";
    return "no stop recorded";
  }

  // The age of a recorded action in the shell's own units, so the stage's title and
  // the roster's rows say the same thing: seconds, minutes, hours, days.
  function ageText(at, now) {
    if (!at) return "";
    var then = Date.parse(at);
    if (!isFinite(then)) return "";
    var seconds = Math.max(0, Math.round((now - then) / 1000));
    if (seconds < 90) return seconds + "s";
    var minutes = Math.round(seconds / 60);
    if (minutes < 90) return minutes + "m";
    var hours = Math.round(minutes / 60);
    if (hours < 48) return hours + "h";
    return Math.round(hours / 24) + "d";
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
      var isQuiet = quiet ? quiet.has(id) : reading === "quiet";
      readings[id] = reading;
      rows.push({
        id: id,
        reading: reading,
        word: readingWord(reading, owed),
        rank: readingRank(reading),
        owed: owed,
        queued: owed > 0,
        // Two reads, named by the shell when it names them, and the stop note the
        // read's own wording gives.
        notProgressing: namedFlag(player, "notProgressing", notProgressingReading(reading)),
        owesWork: namedFlag(player, "owesWork", owed > 0),
        stopNote: stopNote(player),
        live: reading === "running",
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

    var counts = { withQueue: 0 };
    for (var c = 0; c < READINGS.length; c += 1) counts[READINGS[c]] = 0;
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

    // Every actor carries the shortest form of its id that names it, read over the
    // whole hall so two seats never read alike.
    var shortById = shortForms(rows.map(function (row) { return row.id; }));
    for (var n = 0; n < rows.length; n += 1) {
      rows[n].short = shortById[rows[n].id] || rows[n].id;
      rows[n].forms = labelForms(rows[n].id, rows[n].short);
    }
    return {
      rows: rows,
      readings: readings,
      counts: counts,
      notProgressing: rows.filter(function (row) { return row.notProgressing; }),
      owing: rows.filter(function (row) { return row.owesWork; }),
      listed: rows.filter(isListed),
      bandRank: bandRank,
      stage: stagePlan(seated, (data && data.ensembles) || []),
    };
  }

  /* ── the seating plan ─────────────────────────────────────────────────── */

  // Conductors stand on their own tier; every ensemble is one tier, and actors
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
    if (podium.length) tiers.push({ id: "", label: "conductors", conductors: true, rows: podium });
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

  // A tier's seats span the usable box and wrap inside it when the tier is too
  // wide, so nothing is placed outside. The height the drawing needs is returned.
  function layoutStage(plan, width, bound) {
    var w = Math.max(width || 0, 320);
    var limit = Math.max(200, bound || SHELL_BOUND);
    var total = 0;
    var widest = 0;
    var longestName = 1;
    for (var t = 0; t < plan.tiers.length; t += 1) {
      total += plan.tiers[t].rows.length;
      if (plan.tiers[t].rows.length > widest) widest = plan.tiers[t].rows.length;
      var name = String(plan.tiers[t].label || "no ensemble");
      if (name.length > longestName) longestName = name.length;
    }

    // The column is as wide as the names ask for, inside its own bounds.
    var gutter = Math.round(longestName * CHAR_W + LABEL_PAD);
    gutter = Math.max(GUTTER_MIN, Math.min(GUTTER_MAX, gutter));
    var labelChars = Math.max(8, Math.floor((gutter - LABEL_PAD) / CHAR_W));

    // The mark's size follows the run's size, and the tier's pitch follows the
    // mark, so a tier never crowds and never paints outside the box.
    var radius = radiusFor(total);
    // The pointer target is the outermost thing a seat draws, so the box's inset
    // is derived from it rather than fixed.
    var hitRadius = Math.max(12, radius + 5);
    var usable = Math.max(40, w - gutter - hitRadius - 2);
    var pitchMin = 2 * radius + 7;
    var perRow = widest > 1 ? Math.max(2, Math.floor(usable / pitchMin)) : 1;
    if (widest && perRow > widest) perRow = widest;

    var totalRows = 0;
    for (var s = 0; s < plan.tiers.length; s += 1) {
      totalRows += Math.max(1, Math.ceil(plan.tiers[s].rows.length / perRow));
    }

    // Size the drawing to its rows and compress their spacing within the mount height.
    var gap = 2 * radius + 10;
    var seatTop = Math.max(SEAT_TOP, radius + 12);
    if (totalRows > 1) {
      var room = Math.floor((limit - seatTop - BOW - radius - 18) / (totalRows - 1));
      // Keep eight pixels between adjacent marks; larger groups scroll.
      if (room < gap) gap = Math.max(2 * radius + 8, room);
    }

    var seats = [];
    var order = [];
    var blocked = {};
    var underLabel = false;
    var y = seatTop;
    for (var i = 0; i < plan.tiers.length; i += 1) {
      var tier = plan.tiers[i];
      var count = tier.rows.length;
      var rowsOfTier = Math.max(1, Math.ceil(count / perRow));
      tier.y = y;
      tier.rowsOnTier = rowsOfTier;
      var inRow = Math.min(count, perRow);
      var pitch = inRow > 1 ? usable / (inRow - 1) : usable;
      var mid = w / 2;
      for (var k = 0; k < count; k += 1) {
        var row = Math.floor(k / inRow);
        var column = k - row * inRow;
        var x = inRow === 1 ? gutter + usable / 2 : gutter + column * pitch;
        // The tiers bow away from the conductors' tier at the edges, so the hall reads
        // seating plan.
        var bow = BOW * Math.pow((x - mid) / Math.max(1, mid), 2);
        // Where this seat's name may reach: the next seat's mark, the box, the row's
        // label column, and any name already placed beside this row.
        var lane = i + ":" + row;
        var nextLeft = column === inRow - 1 ? w - 4 : x + pitch - radius - 4;
        var caps = {
          left: Math.max((row === 0 ? gutter : 0) + 4, blocked[lane] || 0),
          right: nextLeft,
        };
        var label = seatLabelFor(tier.rows[k].forms, {
          x: x,
          row: row,
          pitch: pitch,
          gap: gap,
          radius: radius,
          gutter: gutter,
          width: w,
          caps: caps,
        });
        // The trail runs in its own band above the mark, where the neighbours' marks do
        // not reach: its room is the space to the next trail on either side, or to the
        // box. Its length is set at draw time from how recent the action is.
        var tickPad = radius + 1;
        var toOtherTrail = Math.max(0, pitch - 2 * tickPad);
        var tickLeft = Math.max(0, Math.min((x - tickPad) - 4, toOtherTrail));
        var tickRight = Math.max(0, Math.min((w - 4) - (x + tickPad), toOtherTrail));
        var tickDir = tickRight >= tickLeft ? 1 : -1;
        var tickRoom = Math.max(tickLeft, tickRight);
        var trail = tickRoom >= 3
          ? { dir: tickDir, pad: tickPad, room: Math.min(tickRoom, radius * 1.8) }
          : null;
        if (label && label.under) underLabel = true;
        if (label && label.anchor !== "middle") {
          blocked[lane] = label.anchor === "end"
            ? x + label.dx
            : x + label.dx + label.text.length * CHAR_W;
        }
        var seat = {
          seat: tier.rows[k],
          x: x,
          y: tier.y + row * gap + bow,
          label: label,
          trail: trail,
        };
        seats.push(seat);
        order.push(tier.rows[k].id);
      }
      y += rowsOfTier * gap;
    }

    // The height the drawing covers: the last row's centre, the bow the outermost
    // seats take, the mark, and the room a name under a mark needs - reserved only when
    // a name was actually drawn there, so a hall whose names all sit beside their marks
    // keeps no empty tail. The SVG, its viewBox and the published height all take this.
    var content = Math.round(y - (totalRows > 0 ? gap : 0) + BOW + radius + (underLabel ? 18 : 8));
    return {
      seats: seats,
      order: order,
      // The height the drawing covers: the SVG, its viewBox and the published
      // height all take this value, so nothing a seat draws falls outside.
      height: content,
      content: content,
      radius: radius,
      gap: gap,
      perRow: perRow,
      rows: totalRows,
      gutter: gutter,
      labelChars: labelChars,
      plateY: seatTop - 10,
      width: w,
    };
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

  // The silhouette of one state, at any size: triangle for failed, square for
  // stopped, ring for queued, diamond for owes work, circle for running,
  // dot for quiet. The stage and the legend draw from this one function.
  function shapeNode(state, radius) {
    var paint = PAINT[state] || PAINT.quiet;
    var r = radius;
    var hollow = paint.shape === "ring";
    var shape;
    if (paint.shape === "triangle") {
      shape = svgEl("polygon", {
        points: "0 " + (-r * 1.15) + " " + (r * 1.05) + " " + (r * 0.82)
          + " " + (-r * 1.05) + " " + (r * 0.82),
      });
    } else if (paint.shape === "square") {
      var side = r * 0.86;
      shape = svgEl("rect", { x: -side, y: -side, width: side * 2, height: side * 2 });
    } else if (paint.shape === "diamond") {
      shape = svgEl("polygon", {
        points: "0 " + (-r * 1.05) + " " + (r * 1.05) + " 0 0 " + (r * 1.05)
          + " " + (-r * 1.05) + " 0",
      });
    } else if (hollow) {
      shape = svgEl("circle", { cx: 0, cy: 0, r: Math.max(2, r * 0.86) });
    } else {
      shape = svgEl("circle", { cx: 0, cy: 0, r: paint.shape === "dot" ? r * 0.52 : r });
    }
    if (hollow) {
      shape.style.fill = "none";
      shape.style.stroke = paint.ink;
      shape.style.strokeWidth = String(Math.max(1.5, r * 0.34));
    } else {
      shape.style.fill = paint.ink;
      if (paint.dim) shape.style.opacity = "0.6";
    }
    shape.setAttribute("class", "att-core");
    return shape;
  }

  function seatNode(entry, options, marks, laid) {
    var seat = entry.seat;
    var radius = laid.radius;
    var paint = PAINT[seat.reading] || PAINT.quiet;
    var group = svgEl("g", {
      "class": "att-seat"
        + (marks.fresh ? " att-new" : "")
        + (seat.live ? " att-working" : "")
        + (options.selectedId === seat.id ? " att-selected" : "")
        + (marks.cursor ? " att-cursor" : ""),
      "data-att-key": "seat:" + seat.id,
      "data-att-id": seat.id,
      "data-att-state": seat.reading,
    });

    if (seat.live) {
      var halo = svgEl("circle", { "class": "att-halo", r: radius + 5, cx: 0, cy: 0 });
      halo.style.fill = paint.ink;
      group.appendChild(halo);
    }

    // The fermata ring: a mark whose work the record holds still.
    if (seat.notProgressing) {
      var held = svgEl("circle", { "class": "att-ring", r: radius + 4, cx: 0, cy: 0 });
      held.style.fill = "none";
      held.style.stroke = paint.ink;
      group.appendChild(held);
    }

    // The floor: every mark sits on a soft cast shadow, which is what gives the
    // hall depth without a second colour.
    var floor = svgEl("ellipse", {
      "class": "att-floor", cx: 0, cy: radius * 0.72,
      rx: radius * 1.05, ry: radius * 0.36,
    });
    group.appendChild(floor);

    group.appendChild(shapeNode(seat.reading, radius));

    // The trail: the pit's reading of activity, on its own band above the mark where
    // no name sits and no other mark reaches. Its length grades how recently the seat
    // acted, against the span the hall covers, and a broken trail marks an activity
    // from an earlier event. No recorded action, no trail. The queue bar keeps the
    // band below the mark, so the two read by position and never by width.
    if (entry.trail && marks.recent) {
      // Length is the channel. Weight and ink strength grade with the same value, so a
      // packed hall - where the length can only span about 3.6x - still separates a fresh
      // action from an old one. The width stops at 2px, which keeps the tick a clear
      // pixel from the halo below it and from the row above's mark.
      var reach = radius * 0.5 + marks.recent.fresh * Math.max(0, entry.trail.room - radius * 0.5);
      var from = entry.trail.dir * entry.trail.pad;
      var above = -(radius + 7);
      var trail = svgEl("line", {
        "class": "att-trail" + (seat.stale ? " att-trail-earlier" : ""),
        x1: from, y1: above,
        x2: from + entry.trail.dir * reach, y2: above,
      });
      trail.style.strokeWidth = (1.1 + marks.recent.fresh * 0.9).toFixed(2);
      trail.style.opacity = (0.6 + marks.recent.fresh * 0.4).toFixed(2);
      group.appendChild(trail);
    }

    // The queue as a bar: its length is the count, and the exact figure stays in
    // the title.
    if (seat.owed > 0) {
      var ticks = Math.min(seat.owed, 6);
      var bar = svgEl("rect", {
        "class": "att-tick", x: -(radius * 0.5 + ticks), y: radius + 3,
        width: radius + ticks * 2, height: 2.5, rx: 1,
      });
      bar.style.fill = "var(--muted, #9aa3b4)";
      group.appendChild(bar);
    }

    var ring = svgEl("circle", { "class": "att-seat-ring", r: radius + 3, cx: 0, cy: 0 });
    ring.style.fill = "none";
    group.appendChild(ring);

    // The seat's name: the plan placed it clear of this seat's own marks, so the
    // queue bar, the ring and the halo sit above or beside it, never over it.
    if (entry.label) {
      var name = svgEl("text", {
        "class": "att-seat-label", x: entry.label.dx, y: entry.label.baseline,
      });
      name.style.textAnchor = entry.label.anchor;
      setText(name, entry.label.text);
      group.appendChild(name);
    }

    var hit = svgEl("circle", { "class": "att-hit", r: Math.max(12, radius + 5), cx: 0, cy: 0 });
    group.appendChild(hit);

    var title = svgEl("title");
    setText(title, seat.id + " \u2014 " + seat.word
      + " \u2014 " + (seat.activity ? activityText(seat) : "no work recorded")
      + (marks.recent && marks.recent.age ? " \u2014 acted " + marks.recent.age + " ago" : "")
      + (seat.stopNote ? " \u2014 " + seat.stopNote : ""));
    group.appendChild(title);

    group.addEventListener("click", function () {
      if (typeof options.onSelect === "function") options.onSelect(seat.id);
    });
    return group;
  }

  // How far an arc may rise above its ends without leaving the box: the curve reaches
  // about three quarters of its control offset above the higher end.
  function arcLift(fromY, toY, want) {
    var top = Math.min(fromY, toY) - 8;
    return Math.max(6, Math.min(want, top * 1.33));
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
      var lift = arcLift(from.y, to.y, Math.min(90, Math.max(20, Math.abs(to.y - from.y) * 0.4)));
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

  // The kinds the ladder's families name. A kind outside them reads as the fallback,
  // so an unnamed kind can never wear a family's pattern.
  var THREAD_KINDS = {
    receipt: 1, report: 1, task: 1, guidance: 1, recovery: 1, stop: 1, execution: 1,
  };

  // The record names a kind with its namespace (message:task). A class name is a
  // selector token, so a recorded value passes one normaliser before it becomes one:
  // the namespace goes, anything else outside letters, digits, dash and underscore
  // becomes a dash, and a kind the families do not name becomes the fallback class.
  // The class is never the raw record value - a colon in it would match no rule and
  // fail silently - and the title keeps the record's own word.
  function kindClass(kind) {
    var text = String(kind || "").replace(/^[a-z]+:/i, "").toLowerCase();
    text = text.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    return THREAD_KINDS[text] ? text : "recorded";
  }

  // The page holds its events newest first. A thread joins the seat that recorded
  // the change to the seat on the far side; its ink is the recorded kind, and its
  // strength is how recent the newest of that pair is.
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
      var lift = arcLift(from.y, to.y, Math.min(90, Math.max(20, Math.abs(to.y - from.y) * 0.4)));
      var path = svgEl("path", {
        "class": "att-thread att-thread-" + kindClass(held.kind),
        d: "M " + from.x + " " + from.y
          + " C " + from.x + " " + (from.y - lift)
          + " " + to.x + " " + (to.y - lift)
          + " " + to.x + " " + to.y,
      });
      path.setAttribute("stroke-width", String(0.9 + Math.min(held.count, 5) * 0.4));
      path.style.opacity = (0.18 + 0.72 * (1 - held.age / oldest)).toFixed(2);
      var title = svgEl("title");
      setText(title, held.count + (held.count === 1 ? " recorded change" : " recorded changes")
        + (held.kind ? " (" + held.kind + ")" : "")
        + " between " + parts[0] + " and " + parts[1]);
      path.appendChild(title);
      stage.appendChild(path);
    });
  }

  // A named token's resolved value, read from the mounted container, so the
  // gradient carries the pit's own palette.
  function tokenColour(node, name, fallback) {
    var view = node && window.getComputedStyle ? window.getComputedStyle(node) : null;
    var value = view ? String(view.getPropertyValue(name) || "").trim() : "";
    return value || fallback;
  }

  // The hall's ground: one gradient from the lifted surface at the top to the deep
  // floor, defined once per document.
  function hallDefs(container) {
    var existing = document.getElementById("att-hall");
    if (existing) return null;
    var defs = svgEl("defs");
    var gradient = svgEl("linearGradient", { id: "att-hall", x1: 0, y1: 0, x2: 0, y2: 1 });
    var top = svgEl("stop", { offset: 0 });
    top.style.stopColor = tokenColour(container, "--surface", "#191410");
    var bottom = svgEl("stop", { offset: 1 });
    bottom.style.stopColor = tokenColour(container, "--hall", "#131009");
    gradient.appendChild(top);
    gradient.appendChild(bottom);
    defs.appendChild(gradient);
    return defs;
  }

  function stageSvg(result, laid, options, fresh, cursorId, relations, container) {
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
      "aria-label": "Agents. " + laid.seats.length + " seats drawn of "
        + result.rows.length + " recorded actors. Arrow keys walk the seats, Enter opens one.",
    });

    var defs = hallDefs(container);
    if (defs) svg.appendChild(defs);
    var ground = svgEl("rect", {
      "class": "att-hall", x: 0, y: 0, width: laid.width, height: laid.height,
    });
    ground.style.fill = "url(#att-hall)";
    svg.appendChild(ground);

    // A lifted band behind every other tier, so a wide row reads across the hall
    // as one line.
    for (var b = 0; b < plan.tiers.length; b += 1) {
      var banded = plan.tiers[b];
      if (!banded.rows.length || b % 2 === 0) continue;
      var bandTop = banded.y - laid.radius - 4;
      var bandHeight = (banded.rowsOnTier - 1) * laid.gap + BOW + laid.radius * 2 + 8;
      svg.appendChild(svgEl("rect", {
        "class": "att-tier", x: 0, y: bandTop, width: laid.width,
        height: bandHeight, rx: 6,
      }));
    }

    // The rule above the first tier, then each tier's name flush left and count flush right.
    var line = svgEl("line", {
      "class": "att-plate", x1: 0, x2: laid.width, y1: laid.plateY, y2: laid.plateY,
    });
    svg.appendChild(line);
    for (var t = 0; t < plan.tiers.length; t += 1) {
      var tierName = plan.tiers[t].label || "no ensemble";
      var nameText = svgEl("text", {
        "class": "att-section-label", x: 2, y: plan.tiers[t].y + 3,
      });
      setText(nameText, shortId(tierName, laid.labelChars));
      var full = svgEl("title");
      setText(full, tierName + ", " + plan.tiers[t].rows.length
        + (plan.tiers[t].rows.length === 1 ? " seat" : " seats"));
      nameText.appendChild(full);
      svg.appendChild(nameText);

      var countText = svgEl("text", {
        "class": "att-section", x: laid.gutter - 8, y: plan.tiers[t].y + 3,
      });
      setText(countText, String(plan.tiers[t].rows.length));
      svg.appendChild(countText);
    }

    var now = Date.now();

    // How recent each drawn seat's action is, against the score's own live window: an
    // action inside the window grades between 1 and 0, one older than the window grades
    // 0, so a hall of old actions reads quiet and a fresh hall reads bright. A seat with
    // no recorded action has no entry at all, and the exact age travels in the title,
    // never in a word on the stage.
    var times = {};
    for (var a = 0; a < laid.seats.length; a += 1) {
      var at = laid.seats[a].seat.at;
      if (!at) continue;
      var when = Date.parse(at);
      if (!isFinite(when)) continue;
      times[laid.seats[a].seat.id] = { at: at, age: Math.max(0, now - when) };
    }
    var recent = {};
    var recentIds = Object.keys(times);
    for (var a2 = 0; a2 < recentIds.length; a2 += 1) {
      recent[recentIds[a2]] = {
        fresh: Math.max(0, Math.min(1, 1 - times[recentIds[a2]].age / RECENT_WINDOW_MS)),
        age: ageText(times[recentIds[a2]].at, now),
      };
    }

    // The baton, drawn under the seats so it never hides one.
    var holderId = "";
    for (var h = 0; h < plan.tiers.length; h += 1) {
      if (!plan.tiers[h].conductors) continue;
      for (var q = 0; q < plan.tiers[h].rows.length; q += 1) {
        if (plan.tiers[h].rows[q].role === "principal-conductor") holderId = plan.tiers[h].rows[q].id;
      }
      if (!holderId && plan.tiers[h].rows.length) holderId = plan.tiers[h].rows[0].id;
    }
    var holder = positions[holderId];
    var target = positions[plan.batonTarget];
    if (holder && target && holder !== target) {
      var rise = arcLift(target.y - 10, target.y - 10, 46);
      var baton = svgEl("path", {
        "class": "att-baton",
        d: "M " + holder.x + " " + (holder.y + 10)
          + " C " + holder.x + " " + (holder.y + 10 + rise)
          + " " + target.x + " " + (target.y - 10 - rise)
          + " " + target.x + " " + (target.y - 10),
      });
      svg.appendChild(baton);
    }

    relationThreads(svg, positions, relations && relations.knowledge, relations && relations.events);

    for (var i = 0; i < laid.seats.length; i += 1) {
      var entry = laid.seats[i];
      var node = seatNode(entry, options, {
        fresh: fresh[entry.seat.id] === true,
        recent: recent[entry.seat.id] || null,
        cursor: entry.seat.id === cursorId,
      }, laid);
      node.setAttribute("transform", "translate(" + entry.x + " " + entry.y + ")");
      svg.appendChild(node);
    }

    svg.dataset.attHeight = String(laid.height);
    svg.dataset.attContent = String(laid.content);
    svg.dataset.attRadius = String(laid.radius);
    svg.dataset.attGap = String(laid.gap);
    svg.dataset.attRows = String(laid.rows);
    svg.dataset.attPerRow = String(laid.perRow);
    return svg;
  }

  // The legend is the label for the state vocabulary: one silhouette and ink per
  // state with its word beside it, in the order the document sorts them.
  function legendNode() {
    var legend = document.createElement("div");
    legend.className = "att-legend";
    for (var i = 0; i < READINGS.length; i += 1) {
      var state = READINGS[i];
      var key = document.createElement("span");
      key.className = "att-key";
      key.dataset.attKey = "legend:" + state;
      key.setAttribute("title", readingWord(state, 0));
      var mark = svgEl("svg", {
        "class": "att-key-mark", width: 12, height: 12, viewBox: "-6 -6 12 12",
        "aria-hidden": "true", focusable: "false",
      });
      mark.appendChild(shapeNode(state, 4.4));
      key.appendChild(mark);
      key.appendChild(span(null, readingWord(state, 0)));
      legend.appendChild(key);
    }
    return legend;
  }

  // One row per seat the record holds or that owes work. The mark carries the
  // state, so the strip scans by shape; the state's word and any exact count stay
  // in the title and the accessible label.
  function chipNode(row, options) {
    var chip = document.createElement("button");
    chip.type = "button";
    chip.className = "lane-chip" + (row.notProgressing ? " att-need" : "")
      + (options.selectedId === row.id ? " selected" : "");
    chip.dataset.attKey = "chip:" + row.id;
    var spoken = row.id + ", " + row.word + (row.activity ? ", " + activityText(row) : "")
      + (row.stopNote ? ", " + row.stopNote : "");
    chip.setAttribute("title", spoken);
    chip.setAttribute("aria-label", spoken + ". Select to open the actor.");
    var mark = svgEl("svg", {
      "class": "att-chip-mark", width: 12, height: 12, viewBox: "-6 -6 12 12",
      "aria-hidden": "true", focusable: "false",
    });
    mark.appendChild(shapeNode(row.reading, 4.4));
    chip.appendChild(mark);
    chip.appendChild(span("lane-id mono", row.short));
    if (row.activity) chip.appendChild(span("att-activity", activityText(row)));
    chip.addEventListener("click", function () {
      if (typeof options.onSelect === "function") options.onSelect(row.id);
    });
    return chip;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }

  // Keep the keyboard-selected actor visible by scrolling the stage container.
  function revealSeat(container, svg, seatY, radius) {
    var view = container.clientHeight;
    if (!view || !svg) return;
    var margin = radius + 14;
    var svgTop = svg.getBoundingClientRect().top
      - container.getBoundingClientRect().top + container.scrollTop;
    var y = svgTop + seatY;
    var top = container.scrollTop;
    if (y - margin < top) container.scrollTop = Math.max(0, y - margin);
    else if (y + margin > top + view) container.scrollTop = y + margin - view;
  }

  function seatYOf(laid, id) {
    for (var i = 0; i < laid.seats.length; i += 1) {
      if (laid.seats[i].seat.id === id) return laid.seats[i].y;
    }
    return null;
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

    var keptScroll = 0;
    if (typeof container.scrollTop === "number") keptScroll = container.scrollTop;
    container.textContent = "";
    dataByContainer.set(container, data);

    var relations = {
      knowledge: (data && data.knowledge) || opts.knowledge || null,
      events: (data && data.events) || opts.events || null,
    };

    // The mount bounds its own height, so the drawing fits the band it is given
    // and leaves the legend and a row of chips in view.
    var band = container.clientHeight >= 200
      ? container.clientHeight - 76
      : SHELL_BOUND;
    var laid = layoutStage(result.stage, result.width, band);
    if (laid.order.length) cursor = ((cursor % laid.order.length) + laid.order.length) % laid.order.length;
    else cursor = 0;
    cursorByContainer.set(container, cursor);
    var cursorId = laid.order[cursor] || "";
    var stage = { svg: null, order: laid.order, height: 0 };
    result.drawnHeight = 0;
    result.drawnSeats = laid.order.length;
    result.drawnGap = laid.gap;
    // A hall with no seat in it is not drawn at all: an empty slab would take the
    // space and answer nothing.
    if (laid.order.length) {
      stage.svg = stageSvg(result, laid, opts, fresh, cursorId, relations, container);
      stage.height = laid.height;
      result.drawnHeight = laid.height;
      container.appendChild(stage.svg);
    }

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

    if (stage.svg) {
      stage.svg.addEventListener("focus", function () {
        if (cursorRow) {
          setText(live, cursorRow.id + ", " + cursorRow.word
            + (cursorRow.activity ? ", " + activityText(cursorRow) : "")
            + (cursorRow.stopNote ? ", " + cursorRow.stopNote : ""));
        } else {
          setText(live, "Agents. No seat is drawn.");
        }
      });

      stage.svg.addEventListener("keydown", function (event) {
        var key = event.key;
        if (key === "ArrowRight" || key === "ArrowDown") { event.preventDefault(); moveCursor(1); return; }
        if (key === "ArrowLeft" || key === "ArrowUp") { event.preventDefault(); moveCursor(-1); return; }
        if (key === "Home") {
          event.preventDefault();
          cursor = 0;
          cursorByContainer.set(container, 0);
          renderAttention(container, dataByContainer.get(container), opts);
          return;
        }
        if (key === "End") {
          event.preventDefault();
          cursor = stage.order.length - 1;
          cursorByContainer.set(container, cursor);
          renderAttention(container, dataByContainer.get(container), opts);
          return;
        }
        if (key === "Enter" || key === " " || key === "Spacebar") { event.preventDefault(); selectCursor(); }
      });
    }

    var listed = result.listed;
    var shown = expanded ? listed : listed.slice(0, STRIP_LIMIT);

    // The legend decodes the marks the pit draws. With no seat seated and nothing
    // listed there is nothing to decode, so the pit keeps one line.
    if (laid.order.length || listed.length) container.appendChild(legendNode());

    var folded = listed.length - shown.length;
    result.strip = {
      shown: shown.length,
      total: listed.length,
      folded: folded,
      expanded: expanded,
      notProgressing: result.notProgressing.length,
    };

    // The quiet line is added and the pass continues to the restoration below: a
    // rebuild must give back focus and the reader's place, or the next key goes
    // nowhere. Do not return here.
    if (!listed.length) {
      var quiet = document.createElement("p");
      quiet.className = "att-quiet";
      setText(quiet, "Nothing is failed, stopped, queued or owing work. "
        + result.counts.running + " running.");
      container.appendChild(quiet);
    }

    for (var k = 0; k < shown.length; k += 1) {
      container.appendChild(chipNode(shown[k], opts));
    }

    // The fold: its word states the reach, and its figure is the exact count.
    if (folded > 0 || expanded) {
      var fold = document.createElement("button");
      fold.type = "button";
      fold.className = "lane-chip att-fold";
      fold.dataset.attKey = "fold";
      fold.setAttribute("aria-expanded", expanded ? "true" : "false");
      setText(fold, expanded ? "fewer" : "+" + folded + " more");
      fold.setAttribute("title", expanded
        ? "Show the " + STRIP_LIMIT + " highest"
        : "Show all " + listed.length + ", " + folded + " folded");
      fold.setAttribute("aria-label", expanded
        ? "Show the " + STRIP_LIMIT + " highest"
        : "Show all " + listed.length + " seats the record holds or that owe work, "
          + folded + " folded");
      fold.addEventListener("click", function () {
        expandedByContainer.set(container, !expanded);
        renderAttention(container, dataByContainer.get(container), opts);
      });
      container.appendChild(fold);
    }

    // The container keeps the reader's place across the rebuild, and while the
    // stage holds focus the cursor's seat is brought into the visible slice.
    if (typeof container.scrollTop === "number") container.scrollTop = keptScroll;
    if (restore) {
      var back = container.querySelector('[data-att-key="' + cssEscape(restore) + '"]');
      if (back && typeof back.focus === "function") back.focus();
    }
    if (cursorId && document.activeElement === stage.svg) {
      var cursorY = seatYOf(laid, cursorId);
      if (cursorY !== null) revealSeat(container, stage.svg, cursorY, laid.radius);
    }
    result.revealed = document.activeElement === stage.svg;
    return result;
  }

  window.renderAttention = renderAttention;
})();
