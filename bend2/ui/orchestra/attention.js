/* Read-only actor stage. Reporting tiers follow complete recorded parent chains.
   Each drawn actor has one seat with its complete identifier, role and current state.
   Parent links and recorded coordination relations use separate drawing classes.
   Each actor includes activity on the shared time range.
   Keyboard arrows walk drawn actors; Enter and Space open the current actor. */

(function () {
  "use strict";

  /* ── geometry ─────────────────────────────────────────────────────────── */

  var CHAR_W = 6.2;
  var CARD_MIN = 220;
  var CARD_MAX = 340;
  var CARD_GAP = 20;
  var CARD_INSET = 14;
  var CAPTION_LINE = 18;
  var SEAT_RADIUS = 12;
  var ID_SHOWN = 30;      // characters of an id before the ellipsis
  var SHORT_KEEP = 24;    // an id this short is already its own short form
  var STAMP = /^\d{4,}$/; // a trailing date stamp is not part of a name
  // The window the trail grades against: the score's own live window, RIBBON_LIVE_MS in
  // ribbon.js, so the two surfaces agree about what recent means. Copied rather than
  // read, because this module reads no other module.
  var RECENT_WINDOW_MS = 90000;

  // The document order, and with it the strip's order and the roster's: work in flight
  // first, then the work a seat holds, then the record's held states, then quiet. A
  // retained failure keeps its mark, its chip and its title without leading the view.
  var READINGS = ["running", "queued", "owesWork", "stopped", "failed", "quiet"];

  // One ink and one silhouette per state. The shape carries the state too, so the
  // stage reads for a reader who cannot separate the colours. Every mark keeps its
  // own state's ink at the ink's own strength: nothing dims a mark below it, and no
  // signal borrows a state colour another state owns. The quiet dot is the faintest
  // mark on the stage by its ink alone, which reads 1.82:1 on the pit's flat hall
  // ground and 1.75:1 where the hall's own gradient is at its lit end; the state
  // and its count are stated in text in the plate line, the roster rows and the
  // record, so the quiet mark is a field the eye can find rather than the only
  // channel for the fact.
  var PAINT = {
    failed: { ink: "var(--failed, #ef6b5f)", shape: "triangle" },
    stopped: { ink: "var(--attention, #e2a94f)", shape: "square" },
    queued: { ink: "var(--stage-starting, #d7b45a)", shape: "ring" },
    owesWork: { ink: "var(--muted, #9aa3b4)", shape: "diamond" },
    running: { ink: "var(--running, #57c46a)", shape: "circle" },
    quiet: { ink: "var(--staff, #39404b)", shape: "dot" },
  };

  var SVG_NS = "http://www.w3.org/2000/svg";
  var dataByContainer = new WeakMap();
  var readingsByContainer = new WeakMap();
  var cursorByContainer = new WeakMap();
  var cursorSeatByContainer = new WeakMap();
  var optionsByContainer = new WeakMap();
  var resizeByContainer = new WeakMap();
  var stageViews = new WeakMap();

  /* ── readings ─────────────────────────────────────────────────────────── */

  function readingRank(reading) {
    var index = READINGS.indexOf(reading);
    return index === -1 ? READINGS.length : index;
  }

  // Not progressing: the record says a stop, or the current attempt failed. Nothing here
  // reads elapsed time, and no inactivity threshold takes part in the read.
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
    var parts = Object.create(null);
    var take = Object.create(null);
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
      var groups = Object.create(null);
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
    var forms = Object.create(null);
    for (i = 0; i < ids.length; i += 1) forms[ids[i]] = joinTail(parts[ids[i]], take[ids[i]], ids[i]);
    return forms;
  }

  function joinTail(parts, take, fallback) {
    if (!parts || !parts.length) return String(fallback);
    return parts.slice(-take).join("-");
  }

  // Everything the seat owes, and the one read behind the unit marks: queued input it has
  // not read, and reports it sent that were never read. The shell states
  // the total as owedTotal, so pendingCount alone is never the read; it misses reports. No
  // payload carries a read fact for a delivery: a message node's deliveryRead is a pointer
  // naming where the delivery lives, and the delivery's own read is in no payload, so the
  // units count what the seat's own record states here and nothing else.
  function owedCount(player) {
    function count(value) {
      var n = Number(value);
      return isFinite(n) && n > 0 ? n : 0;
    }
    if (!player) return 0;
    var total = count(player.owedTotal);
    if (total > 0) return total;
    return Math.max(count(player.pendingCount), count(player.unreadCount));
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
    var readings = Object.create(null);
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
        // Two reads: the flag the shell names when it names one, else the record's own
        // stop or a failure of the current attempt. The stop note carries the wording.
        notProgressing: namedFlag(player, "notProgressing", notProgressingReading(reading)),
        owesWork: namedFlag(player, "owesWork", owed > 0),
        stopNote: stopNote(player),
        live: reading === "running",
        role: String(player.role || ""),
        parent: String(player.parent || ""),
        conductor: isConductor(String(player.role || "")),
        activity: activityOf(player),
        at: atOf(player),
        stale: player.stale === true,
        memberOf: memberIds(player),
        // Seated unless the shell read it quiet, or the reader asked for all.
        seated: (showEnded || !isQuiet) && (!options.query || [id, player.role, player.model, player.action, player.taskTitle].join(" ").toLowerCase().includes(options.query.toLowerCase())),
      });
    }
    rows.sort(function (a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (b.owed !== a.owed) return b.owed - a.owed;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    var counts = { withQueue: 0 };
    for (var c = 0; c < READINGS.length; c += 1) counts[READINGS[c]] = 0;
    var bandRank = Object.create(null);
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
    }
    return {
      rows: rows,
      readings: readings,
      counts: counts,
      notProgressing: rows.filter(function (row) { return row.notProgressing; }),
      owing: rows.filter(function (row) { return row.owesWork; }),
      listed: rows.filter(isListed),
      bandRank: bandRank,
      // The ensembles arrive from the shell's options; a direct caller may hand them as data.
      // Group context carries the recorded memberships and sections. Depth reads
      // every recorded row. Quiet ancestors stay visible as reporting context
      // for the actors included by the current filter.
      stage: stagePlan(rows, seated, (Array.isArray(options.ensembles) && options.ensembles.length
        ? options.ensembles : (data && data.ensembles)) || []),
    };
  }

  /* ── the seating plan ─────────────────────────────────────────────────── */

  // Reporting depth, computed over every row so a parent chain through a quiet seat
  // still places its descendants. A row with no recorded parent and the principal
  // role sits at depth 0. Every other row sits one level below its recorded parent,
  // following complete parent chains. A row whose parent is absent from the record,
  // whose chain cycles, or that records no parent and is not the principal goes to
  // the separate tier for unknown ancestry: the depth -1, and no other value is
  // assigned to those rows.
  function parentDepths(rows) {
    var byId = Object.create(null);
    for (var i = 0; i < rows.length; i += 1) byId[rows[i].id] = rows[i];
    var ORPHAN = -1;
    var depth = Object.create(null);
    function resolve(row, stack) {
      if (depth[row.id] !== undefined) return depth[row.id];
      if (stack.indexOf(row.id) !== -1) return ORPHAN;
      stack.push(row.id);
      var level;
      if (!row.parent) {
        level = row.role === "principal-conductor" ? 0 : ORPHAN;
      } else if (!byId[row.parent]) {
        level = ORPHAN;
      } else {
        var up = resolve(byId[row.parent], stack);
        level = up === ORPHAN ? ORPHAN : up + 1;
      }
      stack.pop();
      depth[row.id] = level;
      return level;
    }
    for (var r = 0; r < rows.length; r += 1) resolve(rows[r], []);
    return depth;
  }

  // Each reporting depth occupies one row. Recorded ensembles group peers within it.
  function stagePlan(rows, seated, ensembles) {
    var depth = parentDepths(rows);
    var byId = new Map(rows.map(function (row) { return [row.id, row]; }));
    var drawn = new Set(seated.map(function (row) { return row.id; }));
    var contextIds = new Set();
    for (var s = 0; s < seated.length; s += 1) {
      var current = seated[s];
      var chain = new Set([current.id]);
      while (current.parent && byId.has(current.parent) && !chain.has(current.parent)) {
        current = byId.get(current.parent);
        chain.add(current.id);
        if (!drawn.has(current.id)) {
          drawn.add(current.id);
          contextIds.add(current.id);
        }
      }
    }
    var stageRows = rows.filter(function (row) { return drawn.has(row.id); });
    var byLevel = new Map();
    var orphans = [];
    var deepest = 0;
    for (var s = 0; s < stageRows.length; s += 1) {
      var row = stageRows[s];
      var level = depth[row.id];
      if (level === undefined || level < 0) { orphans.push(row); continue; }
      if (!byLevel.has(level)) byLevel.set(level, []);
      byLevel.get(level).push(row);
      deepest = Math.max(deepest, level);
    }
    var tiers = [];
    for (var level = 0; level <= deepest; level += 1) {
      var members = byLevel.get(level);
      if (!members || !members.length) continue;
      if (level === 0) {
        tiers.push({ depth: 0, label: members.length === 1 ? "principal conductor"
          : "principal conductors", conductors: true, rows: members });
        continue;
      }
      tiers.push({ depth: level, label: "depth " + level, rows: members });
    }
    if (orphans.length) tiers.push({ depth: -1, label: "unknown ancestry", rows: orphans });

    // The baton rests on the most recent recorded action among the working seats.
    var target = "";
    var newest = -1;
    for (var t = 0; t < rows.length; t += 1) {
      if (!rows[t].live || !rows[t].at) continue;
      var when = Date.parse(rows[t].at);
      if (isFinite(when) && when > newest) { newest = when; target = rows[t].id; }
    }

    return { tiers: tiers, batonTarget: target, ensembles: ensembles, rows: rows, contextIds: contextIds };
  }

  // Wrap complete identifiers against the current monospace font metrics.
  function textMeasure(container, size) {
    var family = "monospace";
    if (container && typeof window.getComputedStyle === "function") {
      family = window.getComputedStyle(container).getPropertyValue("--mono").trim() || family;
    }
    var canvas = document.createElement("canvas");
    var context = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    if (context) context.font = size + "px " + family;
    return function (text) {
      return context ? context.measureText(text).width : Array.from(text).length * size;
    };
  }

  function captionLines(text, width, measure) {
    var chars = Array.from(String(text || ""));
    var lines = [];
    var line = "";
    for (var i = 0; i < chars.length; i += 1) {
      var next = line + chars[i];
      if (line && measure(next) > width) {
        lines.push(line);
        line = chars[i];
      } else line = next;
    }
    if (line || !lines.length) lines.push(line);
    return lines;
  }

  // Display identifier words together; the exact identifier remains in the title.
  function readableName(id) {
    return String(id || "").replace(/[-_.]20\d{6}$/, "").replace(/[-_.]+/g, " ");
  }

  function wordLines(text, width, measure) {
    var words = String(text || "").split(/\s+/);
    var lines = [];
    var line = "";
    words.forEach(function (word) {
      var next = line ? line + " " + word : word;
      if (line && measure(next) > width) { lines.push(line); line = ""; }
      if (measure(word) > width) {
        if (line) { lines.push(line); line = ""; }
        var parts = captionLines(word, width, measure);
        lines = lines.concat(parts.slice(0, -1));
        line = parts[parts.length - 1];
      } else line = line ? line + " " + word : word;
    });
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  function roleWord(role) {
    if (role === "principal-conductor") return "Principal conductor";
    if (role === "associate-conductor") return "Associate conductor";
    if (role === "player") return "Player";
    if (role === "operator") return "Operator";
    return role || "Role unrecorded";
  }

  // Peers retain equal vertical positions at every viewport width.
  function layoutStage(plan, width, container, overview) {
    var viewport = Math.max(160, width || 640);
    var cardWidth = CARD_MIN;
    var groupGap = overview ? 8 : 44;
    var cardGap = overview ? 4 : CARD_GAP;
    var groups = [];
    var memberships = new Map();
    plan.ensembles.forEach(function (ensemble) {
      if (!ensemble || !ensemble.id) return;
      groupMemberIds(ensemble.members).forEach(function (id) {
        if (!memberships.has(id)) memberships.set(id, []);
        memberships.get(id).push(String(ensemble.id));
      });
    });
    var primary = function (row) {
      var ids = memberships.get(row.id) || row.memberOf || [];
      if (!ids.length) return "";
      // A parent's owned ensemble keeps its direct report group together.
      var owned = ids.find(function (id) {
        var ensemble = plan.ensembles.find(function (e) { return String(e.id) === id; });
        return ensemble && ensemble.owner === row.parent;
      });
      return owned || ids.slice().sort()[0];
    };
    var widths = [];
    var parentOrder = new Map();
    plan.tiers.forEach(function (tier) {
      var bands = new Map();
      tier.rows.forEach(function (row) {
        var ensemble = primary(row);
        var key = ensemble ? "ensemble:" + ensemble : "parent:" + (row.parent || "");
        if (!bands.has(key)) bands.set(key, { id: ensemble, parent: row.parent, rows: [] });
        bands.get(key).rows.push(row);
      });
      function reportOrder(band) {
        return band.rows.reduce(function (sum, row) { return sum + (parentOrder.get(row.parent) || 0); }, 0) / band.rows.length;
      }
      tier.groups = Array.from(bands.values()).sort(function (a, b) {
        return reportOrder(a) - reportOrder(b) || String(a.id || a.parent).localeCompare(String(b.id || b.parent));
      });
      var rank = 0;
      tier.groups.forEach(function (band) {
        band.rows.sort(function (a, b) {
          return (parentOrder.get(a.parent) || 0) - (parentOrder.get(b.parent) || 0) || a.id.localeCompare(b.id);
        });
        band.rows.forEach(function (row) { parentOrder.set(row.id, rank++); });
      });
    });
    if (overview) plan.tiers.forEach(function (tier) {
      var gaps = Math.max(0, tier.rows.length - tier.groups.length) * cardGap
        + Math.max(0, tier.groups.length - 1) * groupGap;
      cardWidth = Math.min(cardWidth, Math.max(12, (viewport - gaps - 48) / tier.rows.length));
    });
    var compact = cardWidth < 150;
    var dense = cardWidth < 48;
    plan.tiers.forEach(function (tier) {
      widths.push(tier.rows.length * cardWidth + Math.max(0, tier.rows.length - tier.groups.length) * cardGap
        + Math.max(0, tier.groups.length - 1) * groupGap + 48);
    });
    var w = Math.max.apply(null, [viewport].concat(widths));
    var captionMeasure = textMeasure(container, 13);
    var groupMeasure = textMeasure(container, 12);
    var seats = [];
    var order = [];
    var y = 30;
    for (var t = 0; t < plan.tiers.length; t += 1) {
      var tier = plan.tiers[t];
      tier.y = y;
      tier.header = [tier.label];
      tier.rowsOnTier = 1;
      var groupLines = 1;
      tier.groups.forEach(function (band) {
        var bandWidth = band.rows.length * cardWidth + (band.rows.length - 1) * cardGap;
        band.label = band.id || (band.parent ? "Reports to " + band.parent : "");
        var label = readableName(band.label);
        band.caption = wordLines(label, Math.max(20, bandWidth - 16), groupMeasure);
        if (overview && band.caption.length > 2) {
          band.caption = band.caption.slice(0, 2);
          band.caption[1] = band.caption[1].slice(0, -1) + "…";
        }
        groupLines = Math.max(groupLines, band.caption.length);
      });
      var top = y + 42 + groupLines * 16;
      var widestCaption = 1;
      var captions = new Map();
      tier.rows.forEach(function (member) {
        var lines = compact ? wordLines(readableName(member.id), Math.max(12, cardWidth - 8), captionMeasure)
          : captionLines(member.id, cardWidth - 62, captionMeasure);
        if (compact && lines.length > 3) {
          lines = lines.slice(0, 3);
          lines[2] = lines[2].slice(0, -1) + "…";
        }
        widestCaption = Math.max(widestCaption, lines.length);
        captions.set(member.id, lines);
      });
      var cardHeight = (dense ? 36 : compact ? 62 + widestCaption * CAPTION_LINE : 70 + widestCaption * CAPTION_LINE) + 34;
      var left = (w - widths[t] + 48) / 2;
      for (var r = 0; r < tier.groups.length; r += 1) {
        var band = tier.groups[r];
        var members = band.rows;
        var bandWidth = members.length * cardWidth + (members.length - 1) * cardGap;
        groups.push({ id: band.id, parent: band.parent, depth: tier.depth,
          x: left - (overview ? 2 : 10), y: y + 26, width: bandWidth + (overview ? 4 : 20), height: cardHeight + top - y - 10,
          label: band.label, caption: band.caption,
          rows: members });
        for (var m = 0; m < members.length; m += 1) {
          var seat = { seat: members[m], depth: tier.depth,
            context: plan.contextIds.has(members[m].id), x: left + cardWidth / 2 + m * (cardWidth + cardGap),
            y: top + (compact ? 18 : 35), top: top, bottom: top + cardHeight, width: cardWidth,
            height: cardHeight, caption: captions.get(members[m].id), stateY: (compact ? 24 : -2) + widestCaption * CAPTION_LINE,
            trail: { dir: 1, pad: SEAT_RADIUS + 1, room: SEAT_RADIUS * 1.8 } };
          seats.push(seat);
          order.push(members[m].id);
        }
        left += bandWidth + groupGap;
      }
      tier.bottom = top + cardHeight + 16;
      y = tier.bottom + 52;
    }
    var content = Math.max(0, y - 10);
    return { seats: seats, order: order, height: content, content: content,
      groups: groups, radius: SEAT_RADIUS, gap: cardGap, compact: compact, dense: dense, groupPadding: overview ? 2 : 10,
      perRow: Math.max.apply(null, [0].concat(plan.tiers.map(function (tier) { return tier.rows.length; }))),
      rows: plan.tiers.length, gutter: w - 12, parentGutter: 24,
      plateY: 12, width: w, viewport: viewport };
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
    }
    shape.setAttribute("class", "att-core");
    return shape;
  }

  // One arc of a role ring, as a path from angle a1 to a2 (radians, y-down screen
  // space), with angles measured from three o'clock. The associate's enclosure uses
  // two arcs, sweeping the top and the bottom, with gaps at three and nine o'clock.
  function roleArc(r, a1, a2) {
    function point(angle) {
      return (r * Math.cos(angle)).toFixed(2) + " " + (r * Math.sin(angle)).toFixed(2);
    }
    return svgEl("path", {
      "class": "att-role",
      d: "M " + point(a1) + " A " + r.toFixed(2) + " " + r.toFixed(2) + " 0 0 1 " + point(a2),
    });
  }

  // The conductor's role enclosure in the page's own ink: a whole ring for the
  // principal conductor, and the same ring with two gaps for an associate conductor.
  // The stage and the legend draw from this one function.
  function roleMark(role, radius) {
    var group = svgEl("g", { "class": "att-role" });
    var r = radius + 7;
    if (role === "principal-conductor") {
      group.appendChild(svgEl("circle", { "class": "att-role", cx: 0, cy: 0, r: r }));
      return group;
    }
    group.appendChild(roleArc(r, Math.PI * 0.45, Math.PI * 0.95));
    group.appendChild(roleArc(r, Math.PI * 1.45, Math.PI * 1.95));
    return group;
  }

  function seatNode(entry, options, marks, laid) {
    var seat = entry.seat;
    var radius = laid.radius;
    var paint = PAINT[seat.reading] || PAINT.quiet;
    var group = svgEl("g", {
      "class": "att-seat" + (laid.compact ? " att-compact" : "") + (laid.dense ? " att-dense" : "")
        + (marks.fresh ? " att-new" : "")
        + (seat.live ? " att-working" : "")
        + (options.selectedId === seat.id ? " att-selected" : "")
        + (marks.cursor ? " att-cursor" : ""),
      "data-att-key": "seat:" + seat.id,
      "data-att-id": seat.id,
      "data-att-state": seat.reading,
      "data-att-depth": entry.depth,
      tabindex: -1,
      role: "button",
    });
    // A state that has just changed flashes in its own ink: the ink travels on the
    // group as currentColor, so the flash adds the state's colour and never another
    // state's.
    if (marks.fresh) group.style.color = paint.ink;

    group.setAttribute("data-att-role", seat.role);
    group.setAttribute("data-att-parent", seat.parent);
    if (entry.context) group.setAttribute("data-att-context", "recorded-ancestor");
    group.appendChild(svgEl("rect", { "class": "att-seat-card",
      x: -entry.width / 2, y: entry.top - entry.y, width: entry.width,
      height: entry.height, rx: 8 }));
    var role = svgEl("text", { "class": "att-seat-role", x: 0, y: -19 });
    setText(role, roleWord(seat.role));
    group.appendChild(role);

    var glyph = svgEl("g", { transform: laid.compact ? "translate(0 0)" + (laid.dense ? " scale(0.35)" : " scale(0.7)") : "translate(" + (-entry.width / 2 + 23) + " -5)" });
    group.appendChild(glyph);
    if (seat.live) {
      var halo = svgEl("circle", { "class": "att-halo", r: radius + 5, cx: 0, cy: 0 });
      halo.style.fill = paint.ink;
      glyph.appendChild(halo);
    }

    // The fermata ring: a mark whose work the record holds still.
    if (seat.notProgressing) {
      var held = svgEl("circle", { "class": "att-ring", r: radius + 4, cx: 0, cy: 0 });
      held.style.fill = "none";
      held.style.stroke = paint.ink;
      glyph.appendChild(held);
    }

    // The role mark for a conductor's recorded role: a whole ring at radius + 7 in
    // the foreground colour for the principal conductor, the same ring with two gaps for an
    // associate. The fermata ring uses the seat state's colour at radius + 4 and the
    // selection ring marks focus at radius + 3. The enclosure uses radius + 7, and
    // its shape identifies the conductor's role.
    if (seat.role === "principal-conductor" || seat.role === "associate-conductor") {
      glyph.appendChild(roleMark(seat.role, radius));
    }

    glyph.appendChild(shapeNode(seat.reading, radius));

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
      glyph.appendChild(trail);
    }

    // What the seat owes, as units: one mark per item its own record states - queued input
    // it has not read, and reports it sent that were never read. The band
    // is the one the queue bar took (top radius + 3, bottom radius + 5.5, a tick 2px wide
    // and 2.5px tall with its round caps), so the room the next row's mark and an
    // under-label need is unchanged. Counting marks in a row answers how much is waiting
    // without measuring a length; the bar's six-item cap stays, and the exact figure
    // travels in the seat's title.
    if (seat.owed > 0) {
      var units = Math.min(seat.owed, 6);
      var pitch = 3.6;
      var lead = -((units - 1) * pitch) / 2;
      for (var u = 0; u < units; u += 1) {
        glyph.appendChild(svgEl("line", {
          "class": "att-owed",
          x1: lead + u * pitch, y1: radius + 4,
          x2: lead + u * pitch, y2: radius + 4.5,
        }));
      }
    }

    var ring = svgEl("circle", { "class": "att-seat-ring", r: radius + 3, cx: 0, cy: 0 });
    ring.style.fill = "none";
    glyph.appendChild(ring);

    var name = svgEl("text", { "class": "att-seat-label", x: laid.compact ? 0 : 13, y: laid.compact ? 28 : -2 });
    for (var line = 0; line < entry.caption.length; line += 1) {
      var part = svgEl("tspan", { x: laid.compact ? 0 : 13, y: (laid.compact ? 28 : -2) + line * CAPTION_LINE });
      setText(part, entry.caption[line]);
      name.appendChild(part);
    }
    group.appendChild(name);
    var state = svgEl("text", { "class": "att-seat-state", x: 0, y: entry.stateY });
    var stateText = seat.word + (entry.context && !laid.compact ? " · reporting context" : "");
    if (laid.compact && !laid.dense) {
      wordLines(stateText, entry.width - 8, textMeasure(null, 10)).forEach(function (words, index) {
        var part = svgEl("tspan", { x: 0, y: entry.stateY + index * 12 });
        setText(part, words);
        state.appendChild(part);
      });
    } else setText(state, stateText);
    group.appendChild(state);
    var memberships = svgEl("text", { "class": "att-seat-memberships", x: 0, y: entry.stateY + 17 });
    setText(memberships, seat.memberOf.length
      ? seat.memberOf.length + (seat.memberOf.length === 1 ? " ensemble" : " ensembles")
      : "0 ensembles");
    group.appendChild(memberships);

    group.appendChild(svgEl("rect", { "class": "att-hit", x: -entry.width / 2,
      y: entry.top - entry.y, width: entry.width, height: entry.height, rx: 8 }));

    var title = svgEl("title");
    setText(title, seat.id + " \u2014 " + seat.word
      + " \u2014 " + (seat.activity ? activityText(seat) : "no work recorded")
      + (marks.recent && marks.recent.age ? " \u2014 acted " + marks.recent.age + " ago" : "")
      + (seat.parent ? " \u2014 reports to " + seat.parent : "")
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
  // from the knowledge overview, message traffic from the page's events, and the
  // typed graph's authored claims and cited edges. Stroke only, so a thread reads as
  // a connection and never as a filled field.
  function relationThreads(stage, positions, knowledge, events, laid, options) {
    drawPromotions(stage, positions, knowledge);
    drawTraffic(stage, positions, events);
    drawTypedEdges(stage, positions, knowledge, laid, options);
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

  /* ── the typed graph's edges ──────────────────────────────────────────── */

  // One end of a typed edge. The payload names an end either by an id the stage seats or
  // by a reference (finding:, message:, file:, external:). A reference the store does not
  // hold is stated by the node list's referenceOnly true; such an end is drawn as a
  // reference and never as a seat. An end the payload does not place, or a reference the
  // store does hold, is skipped: the hall seats actors, and the map holds the rest.
  function edgeEnd(value, positions, unheld) {
    if (value === undefined || value === null) return null;
    var named = typeof value === "object";
    var id = String(named ? (value.id || value.reference || "") : value);
    if (!id) return null;
    var kind = String(named ? (value.kind || "") : "");
    var seat = positions[id];
    if (seat) return { seat: seat, kind: kind };
    var reference = String(named ? (value.reference || id) : id);
    if (!(named && value.referenceOnly === true) && !unheld.has(reference)) return null;
    return { reference: reference, kind: kind };
  }

  function provenanceClass(provenance) {
    return provenance === "authored" ? "att-seam-authored" : "att-seam-cited";
  }

  // An end's name in a seam's own words. A seat is named by its id alone: a kind carried
  // beside a seat end describes the record the edge came from, not the seat, and the id is
  // what the reader matches to the hall. A reference is named with its kind, because the
  // kind is what the reference is.
  function seamEndName(end) {
    if (end.seat) return end.seat.seat.id;
    return "reference " + end.reference + (end.kind ? " (" + end.kind + ")" : "")
      + ", which the store does not hold";
  }

  // The seam's own words: what the edge is, which provenance the payload recorded, and
  // the two ends by name. An anchored cited seam names the finding it stands for, its
  // author, and that the seam is drawn at that author's seat; a merged one - several
  // findings of one author citing the same material - states the author and the count,
  // and the findings themselves stay in the record. No word here is inferred from prose.
  function appendSeamTitle(node, seam) {
    var title = svgEl("title");
    var count = seam.count;
    if (seam.provenance === "authored") {
      setText(title, count + (count === 1 ? " authored claim" : " authored claims")
        + " from " + seamEndName(seam.from) + " to " + seamEndName(seam.to));
      node.appendChild(title);
      return;
    }
    var source;
    if (!seam.from.anchor) {
      source = "source " + seamEndName(seam.from);
    } else if (count === 1) {
      source = "source " + seam.from.anchor.reference
        + ", authored by " + seam.from.anchor.author + ", drawn at that author's seat";
    } else {
      source = "authored by " + seam.from.anchor.author + ", drawn at that author's seat";
    }
    setText(title, count + (count === 1 ? " cited edge" : " cited edges")
      + " recorded as evidence \u2014 " + source
      + " \u2014 cited material " + seamEndName(seam.to));
    node.appendChild(title);
  }

  // A point on a seam and the direction of travel there, a given distance back from the
  // end, so a seam's own glyph rides the curve wherever the curve runs: the hall's
  // tiers bow, and an arrowhead drawn on an assumed direction would leave its seam.
  // Twenty-four chords answer to about a pixel on the curves this stage draws.
  function curveBack(curve, back) {
    var steps = 24;
    var px = curve.toX;
    var py = curve.toY;
    var run = 0;
    var last = { x: curve.toX, y: curve.toY };
    for (var i = 1; i <= steps; i += 1) {
      var t = 1 - i / steps;
      var u = 1 - t;
      var x = u * u * u * curve.fromX + 3 * u * u * t * curve.fromX
        + 3 * u * t * t * curve.toX + t * t * t * curve.toX;
      var y = u * u * u * curve.fromY + 3 * u * u * t * (curve.fromY - curve.lift)
        + 3 * u * t * t * (curve.toY - curve.lift) + t * t * t * curve.toY;
      var dx = x - px;
      var dy = y - py;
      var step = Math.sqrt(dx * dx + dy * dy);
      if (step > 0 && run + step >= back) {
        var take = (back - run) / step;
        return { x: px + dx * take, y: py + dy * take, dx: dx / step, dy: dy / step };
      }
      run += step;
      last = { x: x, y: y };
      px = x;
      py = y;
    }
    return { x: last.x, y: last.y, dx: 0, dy: 1 };
  }

  // The authored seam's glyph: one solid chevron at the claimed end, pointing along the
  // seam. It is the authored language and is drawn nowhere else; it is 6px across and is
  // no seat silhouette, so it cannot be read as a state.
  function seamChevron(point) {
    var nx = -point.dy;
    var ny = point.dx;
    var head = 4.2;
    var half = 2.6;
    return svgEl("polygon", {
      "class": "att-seam-chevron",
      points: (point.x + point.dx * head) + " " + (point.y + point.dy * head)
        + " " + (point.x + nx * half) + " " + (point.y + ny * half)
        + " " + (point.x - nx * half) + " " + (point.y - ny * half),
    });
  }

  // The cited seam's glyph: two short bars across the seam near the end, the mark a
  // quotation takes. Two bars read as one mark, never as the counted units, which stand
  // under a seat's own mark and are round-capped.
  function seamBars(point) {
    var group = svgEl("g", { "class": "att-seam-bars" });
    var nx = -point.dy;
    var ny = point.dx;
    var half = 3.2;
    for (var i = 0; i < 2; i += 1) {
      var cx = point.x - point.dx * i * 3;
      var cy = point.y - point.dy * i * 3;
      group.appendChild(svgEl("line", {
        "class": "att-seam-bar",
        x1: cx - nx * half, y1: cy - ny * half,
        x2: cx + nx * half, y2: cy + ny * half,
      }));
    }
    return group;
  }

  // One seam, drawn. Between two seats it takes the stage's own arc, so a seam still
  // reads as a connection and never as a filled field. From a seat to a reference the
  // store does not hold it leaves the drawing on the side nearest that seat and ends in
  // an open bead at the hall's edge: a reference, and never a seat.
  function drawSeam(stage, seam, laid, options) {
    var width = 0.9 + Math.min(seam.count, 5) * 0.4;
    var className = "att-seam " + provenanceClass(seam.provenance);
    if (!seam.from.seat || !seam.to.seat) {
      var seatEnd = seam.from.seat ? seam.from : seam.to;
      var other = seam.from.seat ? seam.to : seam.from;
      var at = seatEnd.seat;
      var edgeX = at.x < laid.width / 2 ? 3 : laid.width - 3;
      var line = svgEl("line", { "class": className, x1: at.x, y1: at.y, x2: edgeX, y2: at.y });
      line.setAttribute("stroke-width", String(width));
      appendSeamTitle(line, seam);
      stage.appendChild(line);
      stage.appendChild(seamHit(svgEl("line", {
        x1: at.x, y1: at.y, x2: edgeX, y2: at.y,
      }), seam, options));
      var bead = svgEl("circle", { "class": "att-ref", cx: edgeX, cy: at.y, r: 3.4 });
      var beadTitle = svgEl("title");
      setText(beadTitle, "reference " + other.reference
        + (other.kind ? " (" + other.kind + ")" : "")
        + " \u2014 the store does not hold this record");
      bead.appendChild(beadTitle);
      stage.appendChild(bead);
      return;
    }
    var from = seam.from.seat;
    var to = seam.to.seat;
    var lift = arcLift(from.y, to.y, Math.min(90, Math.max(20, Math.abs(to.y - from.y) * 0.4)));
    var path = svgEl("path", {
      "class": className,
      d: "M " + from.x + " " + from.y
        + " C " + from.x + " " + (from.y - lift)
        + " " + to.x + " " + (to.y - lift)
        + " " + to.x + " " + to.y,
    });
    path.setAttribute("stroke-width", String(width));
    appendSeamTitle(path, seam);
    stage.appendChild(path);
    var point = curveBack({
      fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, lift: lift,
    }, laid.radius + 11);
    stage.appendChild(seam.provenance === "authored" ? seamChevron(point) : seamBars(point));
    stage.appendChild(seamHit(svgEl("path", { d: path.getAttribute("d") }), seam, options));
  }

  // What a seam click opens. The stage hands the shell the relation's own identity -
  // the provenance, both ends as drawn, and the finding a cited seam stands for - and
  // the shell routes it to the record and the address. Until the shell wires
  // onSelectRelation, a click falls back to what a seat click opens: the finding's
  // record for a cited seam, the claiming seat's record for an authored one.
  function selectSeam(seam, options) {
    var identity = {
      provenance: seam.provenance,
      source: seam.from.seat ? seam.from.seat.seat.id
        : (seam.from.anchor ? seam.from.anchor.reference : String(seam.from.reference || "")),
      target: seam.to.seat ? seam.to.seat.seat.id : String(seam.to.reference || ""),
      finding: seam.from.anchor ? seam.from.anchor.reference : "",
    };
    if (typeof options.onSelectRelation === "function") {
      options.onSelectRelation(identity);
      return;
    }
    if (seam.provenance === "recorded-evidence" && identity.finding
      && typeof options.onSelectFinding === "function") {
      options.onSelectFinding(identity.finding.replace(/^finding:/, ""));
      return;
    }
    if (seam.from.seat && typeof options.onSelect === "function") {
      options.onSelect(seam.from.seat.seat.id);
    }
  }

  // A seam's hit target: the seam's own geometry at 6px, transparent, above the
  // drawing, carrying the seam's title so the pointer still reads what the seam says.
  function seamHit(node, seam, options) {
    node.setAttribute("class", "att-seam-hit");
    appendSeamTitle(node, seam);
    node.addEventListener("click", function (event) {
      event.stopPropagation();
      selectSeam(seam, options);
    });
    return node;
  }

  // A cited edge's source is the finding that recorded the evidence, and the canonical
  // edge keeps that finding as its endpoint. The hall draws seats, so a cited source is
  // anchored at the seat of the finding's author - the actor the record names, carried on
  // the edge - and the seam's title states the finding, its author and the anchoring, so
  // the drawing shows the recorded attribution instead of implying that the seat is the
  // edge's endpoint. A source that is no held node, or whose author is no drawn seat, is
  // left to edgeEnd; a finding end on an authored edge is never anchored, because a claim
  // between two records is not a claim between two seats.
  function citedSource(edge, positions, heldRefs) {
    var seat = positions[String(edge.source || "")];
    if (seat) return { seat: seat, kind: String(edge.sourceKind || "") };
    var reference = String(edge.source || "");
    if (!reference || !heldRefs.has(reference)) return null;
    var author = String(edge.author || "");
    var at = author ? positions[author] : null;
    if (!at) return null;
    return {
      seat: at,
      kind: String(edge.sourceKind || ""),
      anchor: { reference: reference, author: author },
    };
  }

  // The typed graph's edges, when the payload carries them. An authored edge is a claim
  // someone recorded between two actors; a recorded-evidence edge is structured evidence
  // the store holds. They read on the two channels the hall has left: value, where the
  // claim is the brighter seam, and the glyph at the end, where a chevron is authored and
  // bars are cited. Ink hue belongs to the seat states and width to how many edges pair
  // two seats, so no meaning rides a channel another meaning owns. An edge whose ends the
  // payload does not place is not drawn.
  function drawTypedEdges(stage, positions, knowledge, laid, options) {
    var edges = knowledge && Array.isArray(knowledge.edges) ? knowledge.edges : [];
    if (!edges.length) return;
    var unheld = new Set();
    var heldRefs = new Set();
    var nodes = knowledge && Array.isArray(knowledge.nodes) ? knowledge.nodes : [];
    for (var n = 0; n < nodes.length; n += 1) {
      var node = nodes[n];
      if (!node || !node.reference) continue;
      if (node.referenceOnly === true) unheld.add(String(node.reference));
      else heldRefs.add(String(node.reference));
    }
    var seams = new Map();
    for (var i = 0; i < edges.length; i += 1) {
      var edge = edges[i];
      if (!edge) continue;
      var provenance = String(edge.provenance || "");
      if (provenance !== "authored" && provenance !== "recorded-evidence") continue;
      var from = provenance === "recorded-evidence"
        ? citedSource(edge, positions, heldRefs)
        : edgeEnd(edge.source, positions, unheld);
      var to = edgeEnd(edge.target, positions, unheld);
      if (!from || !to) continue;
      if (!from.kind) from.kind = String(edge.sourceKind || "");
      if (!to.kind) to.kind = String(edge.targetKind || "");
      if (from.seat && to.seat && from.seat === to.seat) continue;
      if (!from.seat && !to.seat) continue;
      var key = provenance + "\u0000"
        + (from.seat ? from.seat.seat.id : "ref:" + from.reference) + "\u0000"
        + (to.seat ? to.seat.seat.id : "ref:" + to.reference);
      var held = seams.get(key);
      if (held) {
        held.count += 1;
      } else {
        seams.set(key, { count: 1, from: from, to: to, provenance: provenance });
      }
    }
    seams.forEach(function (seam) {
      drawSeam(stage, seam, laid, options);
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
    var positions = Object.create(null);
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

    var labels = svgEl("g", { "class": "att-tier-labels" });
    for (var t = 0; t < plan.tiers.length; t += 1) {
      var tier = plan.tiers[t];
      svg.appendChild(svgEl("rect", { "class": "att-tier", x: 0, y: tier.y - 12,
        width: laid.width, height: tier.bottom - tier.y + 16, rx: 8 }));
      var label = svgEl("text", { "class": "att-section-label", x: laid.parentGutter, y: tier.y + 3 });
      for (var h = 0; h < tier.header.length; h += 1) {
        var line = svgEl("tspan", { x: laid.parentGutter, y: tier.y + 3 + h * 16 });
        setText(line, tier.header[h]);
        label.appendChild(line);
      }
      var title = svgEl("title");
      setText(title, tier.label + ", " + tier.rows.length + " actors");
      label.appendChild(title);
      labels.appendChild(label);
      var count = svgEl("text", { "class": "att-section", x: laid.width - 14, y: tier.y + 3 });
      setText(count, String(tier.rows.length));
      labels.appendChild(count);
    }

    // Draw a parent link only when both recorded actors have a drawn seat.
    for (var p = 0; p < laid.seats.length; p += 1) {
      var child = laid.seats[p];
      var parent = positions[child.seat.parent];
      if (!parent || parent === child || parent.bottom >= child.top) continue;
      var middle = (parent.bottom + child.top) / 2;
      var link = svgEl("path", { "class": "att-parent-link",
        "data-att-parent-from": parent.seat.id, "data-att-parent-to": child.seat.id,
        d: "M " + parent.x + " " + parent.bottom + " C " + parent.x + " " + middle
          + " " + child.x + " " + middle + " " + child.x + " " + child.top });
      var note = svgEl("title");
      setText(note, child.seat.id + " reports to " + parent.seat.id);
      link.appendChild(note);
      svg.appendChild(link);
    }

    laid.groups.forEach(function (band) {
      if (!band.label) return;
      var group = svgEl("g", { "class": "att-peer-group", "data-att-ensemble": band.id,
        "data-att-group-depth": band.depth });
      group.appendChild(svgEl("rect", { "class": "att-peer-boundary", x: band.x, y: band.y,
        width: band.width, height: band.height, rx: 4 }));
      group.appendChild(svgEl("rect", { "class": "att-peer-heading", x: band.x, y: band.y,
        width: band.width, height: band.caption.length * 16 + 10, rx: 4 }));
      var name = svgEl("text", { "class": "att-peer-name", x: band.x + laid.groupPadding, y: band.y + 18 });
      band.caption.forEach(function (words, index) {
        var line = svgEl("tspan", { x: band.x + laid.groupPadding, y: band.y + 18 + index * 16 });
        setText(line, words);
        name.appendChild(line);
      });
      group.appendChild(name);
      var title = svgEl("title");
      setText(title, band.label + ". " + band.rows.map(function (row) { return row.id; }).join(", "));
      group.appendChild(title);
      if (band.id && typeof options.onSelectEnsemble === "function") {
        name.setAttribute("role", "button");
        name.setAttribute("tabindex", "0");
        name.addEventListener("click", function () { options.onSelectEnsemble(band.id); });
        name.addEventListener("keydown", function (event) {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); options.onSelectEnsemble(band.id); }
        });
      }
      svg.appendChild(group);
    });
    svg.appendChild(labels);
    var now = Date.now();

    // How recent each drawn seat's action is, against the score's own live window: an
    // action inside the window grades between 1 and 0, one older than the window grades
    // 0, so a hall of old actions reads quiet and a fresh hall reads bright. A seat with
    // no recorded action has no entry at all, and the exact age travels in the title,
    // never in a word on the stage.
    var times = Object.create(null);
    for (var a = 0; a < laid.seats.length; a += 1) {
      var at = laid.seats[a].seat.at;
      if (!at) continue;
      var when = Date.parse(at);
      if (!isFinite(when)) continue;
      times[laid.seats[a].seat.id] = { at: at, age: Math.max(0, now - when) };
    }
    var recent = Object.create(null);
    var recentIds = Object.keys(times);
    for (var a2 = 0; a2 < recentIds.length; a2 += 1) {
      recent[recentIds[a2]] = {
        fresh: Math.max(0, Math.min(1, 1 - times[recentIds[a2]].age / RECENT_WINDOW_MS)),
        age: ageText(times[recentIds[a2]].at, now),
      };
    }

    var visibleIds = new Set(laid.seats.map(function (entry) { return entry.seat.id; }));
    var events = (options.events || []).map(function (event, index) { return { event: event, index: index, at: Date.parse(event.at) }; })
      .filter(function (item) { return visibleIds.has(item.event.session); });
    var stamps = events.filter(function (item) { return isFinite(item.at); }).map(function (item) { return item.at; });
    var oldest = Math.min.apply(null, stamps), newest = Math.max.apply(null, stamps);
    for (var i = 0; i < laid.seats.length; i += 1) {
      var entry = laid.seats[i];
      var node = seatNode(entry, options, {
        fresh: fresh[entry.seat.id] === true,
        recent: recent[entry.seat.id] || null,
        cursor: entry.seat.id === cursorId,
      }, laid);
      var staff = svgEl("g", { "class": "att-activity-staff", "data-att-activity": entry.seat.id });
      var left = -entry.width / 2 + 6, right = entry.width / 2 - 6;
      var staffY = entry.bottom - entry.y - 22;
      for (var line = 0; line < 5; line += 1) staff.appendChild(svgEl("line", {
        "class": "att-staff-line", x1: left, x2: right, y1: staffY + line * 3, y2: staffY + line * 3 }));
      events.filter(function (item) { return item.event.session === entry.seat.id && isFinite(item.at); }).forEach(function (item) {
        var x = left + (right - left) * (newest === oldest ? 1 : (item.at - oldest) / (newest - oldest));
        var note = svgEl("circle", { "class": "att-activity-note", cx: x, cy: staffY + 6, r: 2.5,
          role: "button", tabindex: "0", "data-att-event": item.index,
          "aria-label": item.event.kind + " · " + (item.event.summary || "") + " · " + item.event.at });
        var title = svgEl("title"); setText(title, note.getAttribute("aria-label")); note.appendChild(title);
        var open = function (event) { event.stopPropagation();
          if (typeof options.onSelectEvent === "function") options.onSelectEvent(item.index);
          if (typeof options.onSelect === "function") options.onSelect(entry.seat.id); };
        note.addEventListener("click", open);
        note.addEventListener("keydown", function (event) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(event); } });
        staff.appendChild(note);
      });
      node.appendChild(staff);
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
    var parentKey = span("att-key att-parent-key", "Recorded parent link");
    parentKey.dataset.attKey = "legend:parent";
    legend.appendChild(parentKey);
    // The role keys, after the states, drawing the same enclosures the seats carry,
    // so the ring forms are named on the legend.
    var ROLES = [
      { role: "principal-conductor", word: "principal" },
      { role: "associate-conductor", word: "associate" },
    ];
    for (var j = 0; j < ROLES.length; j += 1) {
      var roleKey = document.createElement("span");
      roleKey.className = "att-key";
      roleKey.dataset.attKey = "legend:role:" + ROLES[j].role;
      roleKey.setAttribute("title", ROLES[j].word + " conductor");
      var roleMarkSvg = svgEl("svg", {
        "class": "att-key-mark", width: 12, height: 12, viewBox: "-13 -13 26 26",
        "aria-hidden": "true", focusable: "false",
      });
      roleMarkSvg.appendChild(roleMark(ROLES[j].role, 4.4));
      roleKey.appendChild(roleMarkSvg);
      roleKey.appendChild(span(null, ROLES[j].word));
      legend.appendChild(roleKey);
    }
    return legend;
  }

  function groupMemberIds(list) {
    var ids = [];
    (Array.isArray(list) ? list : []).forEach(function (member) {
      var id = member && typeof member === "object" ? (member.id || member.session) : member;
      if (id && ids.indexOf(String(id)) < 0) ids.push(String(id));
    });
    return ids;
  }

  function mountWidth(container) {
    if (!container) return 640;
    var width = container.clientWidth || 640;
    if (typeof window.getComputedStyle === "function") {
      var style = window.getComputedStyle(container);
      width -= (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    }
    return Math.max(160, width);
  }

  function observeWidth(container) {
    if (resizeByContainer.has(container) || typeof window.ResizeObserver !== "function") return;
    var current = mountWidth(container);
    var observer = new window.ResizeObserver(function () {
      if (!container.isConnected) {
        observer.disconnect();
        resizeByContainer.delete(container);
        return;
      }
      var width = mountWidth(container);
      if (width === current) return;
      current = width;
      renderAttention(container, dataByContainer.get(container), optionsByContainer.get(container));
    });
    observer.observe(container);
    resizeByContainer.set(container, observer);
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }


  /* ── the entry ────────────────────────────────────────────────────────── */

  function renderAttention(container, data, options) {
    var opts = options || {};
    var result = analyse(data, opts);
    result.width = mountWidth(container);
    if (!container) return result;

    var cursor = cursorByContainer.get(container);
    if (typeof cursor !== "number") cursor = 0;

    var previous = readingsByContainer.get(container) || null;
    var fresh = Object.create(null);
    if (previous) {
      for (var i = 0; i < result.rows.length; i += 1) {
        var row = result.rows[i];
        if (previous[row.id] && previous[row.id] !== row.reading) fresh[row.id] = true;
      }
    }
    var next = Object.create(null);
    for (var j = 0; j < result.rows.length; j += 1) next[result.rows[j].id] = result.rows[j].reading;
    readingsByContainer.set(container, next);

    var restore = null;
    var active = document.activeElement;
    if (active && active.dataset && container.contains(active)) {
      restore = active.dataset.attKey || null;
    }

    var oldViewport = container.querySelector(".att-stage-viewport");
    var view = stageViews.get(container) || { fit: true, scroll: 0 };
    if (oldViewport) view.scroll = oldViewport.scrollLeft;
    stageViews.set(container, view);
    var minHeight = container.style.minHeight;
    container.style.minHeight = container.getBoundingClientRect().height + "px";
    container.textContent = "";
    var legendMount = opts.legendMount || container;
    if (legendMount !== container) legendMount.textContent = "";
    legendMount.appendChild(legendNode());
    dataByContainer.set(container, data);
    optionsByContainer.set(container, opts);
    observeWidth(container);

    var relations = {
      knowledge: (data && data.knowledge) || opts.knowledge || null,
      events: (data && data.events) || opts.events || null,
    };

    var laid = layoutStage(result.stage, result.width, container, view.fit);
    var priorSeat = cursorSeatByContainer.get(container);
    if (priorSeat && laid.order.indexOf(priorSeat) >= 0) cursor = laid.order.indexOf(priorSeat);
    if (laid.order.length) cursor = ((cursor % laid.order.length) + laid.order.length) % laid.order.length;
    else cursor = 0;
    cursorByContainer.set(container, cursor);
    var cursorId = laid.order[cursor] || "";
    cursorSeatByContainer.set(container, cursorId);
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
      var viewport = document.createElement("div");
      viewport.className = "att-stage-viewport";
      viewport.setAttribute("aria-label", "Orchestra hierarchy. Scroll horizontally to read all peers.");
      container.appendChild(viewport);
      viewport.appendChild(stage.svg);
      var tools = document.createElement("div");
      tools.className = "att-stage-tools";
      container.insertBefore(tools, viewport);
      stage.svg.style.width = laid.width + "px";
      stage.svg.style.height = laid.height + "px";
      viewport.scrollLeft = view.fit ? 0 : view.scroll;
      function fitStage(fit) {
        if (view.fit === fit) return;
        view.fit = fit;
        renderAttention(container, data, opts);
      }
      [["Fit hierarchy", true], ["Read labels", false]].forEach(function (item) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "att-stage-view";
        button.dataset.attKey = "view:" + item[1];
        button.setAttribute("aria-pressed", view.fit === item[1] ? "true" : "false");
        setText(button, item[0]);
        button.addEventListener("click", function () { fitStage(item[1]); });
        tools.appendChild(button);
      });
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

    function redrawCursor() {
      renderAttention(container, dataByContainer.get(container), opts);
      var current = container.querySelector(".att-seat.att-cursor");
      if (current && typeof current.scrollIntoView === "function") {
        current.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }

    function moveCursor(step) {
      var order = stage.order;
      if (!order.length) return;
      cursor = ((cursor + step) % order.length + order.length) % order.length;
      cursorByContainer.set(container, cursor);
      cursorSeatByContainer.set(container, order[cursor]);
      redrawCursor();
    }

    function selectCursor() {
      var id = stage.order[cursor] || "";
      if (!id) return;
      setText(live, "Opened " + id + ".");
      if (typeof opts.onSelect === "function") opts.onSelect(id);
    }

    if (stage.svg) {
      stage.svg.addEventListener("focusin", function (event) {
        var seat = event.target.closest && event.target.closest(".att-seat");
        if (!seat) return;
        var index = stage.order.indexOf(seat.dataset.attId);
        if (index < 0) return;
        cursor = index;
        cursorByContainer.set(container, cursor);
        cursorSeatByContainer.set(container, seat.dataset.attId);
        cursorRow = result.rows.find(function (row) { return row.id === seat.dataset.attId; });
      });
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
        if (event.defaultPrevented) return;
        var key = event.key;
        if (key === "ArrowRight" || key === "ArrowDown") { event.preventDefault(); moveCursor(1); return; }
        if (key === "ArrowLeft" || key === "ArrowUp") { event.preventDefault(); moveCursor(-1); return; }
        if (key === "Home") {
          event.preventDefault();
          cursor = 0;
          cursorByContainer.set(container, 0);
          cursorSeatByContainer.set(container, stage.order[0]);
          redrawCursor();
          return;
        }
        if (key === "End") {
          event.preventDefault();
          cursor = stage.order.length - 1;
          cursorByContainer.set(container, cursor);
          cursorSeatByContainer.set(container, stage.order[cursor]);
          redrawCursor();
          return;
        }
        if (key === "Enter" || key === " " || key === "Spacebar") { event.preventDefault(); selectCursor(); }
      });
    }

    // Preserve keyboard focus across redraws without moving the page.
    if (restore) {
      var back = container.querySelector('[data-att-key="' + cssEscape(restore) + '"]');
      if (back && typeof back.focus === "function") back.focus({ preventScroll: true });
    }
    container.style.minHeight = minHeight;
    return result;
  }

  window.renderAttention = renderAttention;
})();
