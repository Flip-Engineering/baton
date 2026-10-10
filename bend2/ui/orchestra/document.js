/* Read-only oversight document. Text is assigned through textContent.
   Rows follow the recorded activity order. Selecting a row opens its record.

   window.OversightDocument.render(data, opts)
     data.players    [{id, parent, role, model, status, pendingCount, unacknowledgedCount,
                      owedTotal, owesWork, notProgressing, action, actionAt, stale, ensembles[],
                      taskTitle, authored, shared, received, live}]
     data.ensembles  [{id, owner, coupling, members[]}]
     data.events     newest first, as the page holds them
     data.knowledge  the overview, or null
     opts.mounts     {attention, roster, knowledge, selection, ribbon,
                      knowledgeWhole, counts}
     opts.selectedId, opts.selectedFindingId, opts.query
     opts.position   reading position in the recorded history
     opts.scope      "live" for work in flight and seats the record holds, "all"
                     for everything recorded (the staves' control names the rest)
     opts.onSelect(id), opts.onSelectFinding(id), opts.onScrub(index),
     opts.onSelectEvent(index), opts.onListOpen(open)

   attention.js reads activity for the summary; order.js orders the rows. */
(function () {
  "use strict";

  // Ended and unobserved rows with no queued input are quiet.
  function isQuiet(mark) {
    if (!mark) return true;
    return mark.tone === "ended" || mark.tone === "unknown";
  }

  // Derive the row state from the current attempt and pending input.
  function workState(p) {
    if (!p) return "quiet";
    if (p.status === "failed") return "failed";
    if (p.status === "stopped") return "stopped";
    if (p.status === "running") return "working";
    if ((p.owedTotal || 0) > 0 || p.owesWork === true || p.status === "pending") return "queued";
    return "quiet";
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  // Separate the count and label while preserving readable textContent.
  function stat(label, value, tone) {
    var wrap = el("span", "stat" + (tone ? " " + tone : ""));
    wrap.appendChild(el("b", null, value));
    wrap.appendChild(el("span", null, " " + label));
    return wrap;
  }

  function statSeparator() {
    return el("span", "stat-sep", " ·");
  }

  function ageText(at) {
    if (!at) return "";
    var then = Date.parse(at);
    if (!then || Number.isNaN(then)) return "";
    var seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 90) return seconds + "s";
    var minutes = Math.round(seconds / 60);
    if (minutes < 90) return minutes + "m";
    var hours = Math.round(minutes / 60);
    if (hours < 48) return hours + "h";
    return Math.round(hours / 24) + "d";
  }

  function matchesQuery(p, query) {
    if (!query) return true;
    var q = String(query).toLowerCase();
    return [p.id, p.role, p.model, p.action, p.taskTitle, p.status]
      .concat(p.ensembles || [])
      .some(function (value) {
        return value && String(value).toLowerCase().indexOf(q) !== -1;
      });
  }

  /* One staff row: who the actor is, what it is doing, the staff of what it has
     recorded, then the counts of what it owes. The row's detail carries the
     bookkeeping: model, branch, workspace. */
  // The staff: one actor's recorded entries across the window the page holds,
  // left to right in time, ruled in five lines. A filled head is a committed
  // entry; an open head is the newest entry of a seat that is playing now. The
  // newest entries win the cap, so a busy actor keeps its recent history.
  var STAFF_NOTES = 28;

  function staffTone(ev) {
    var kind = String((ev && ev.kind) || "").toLowerCase();
    if (kind.indexOf("fail") !== -1) return "kind-failed";
    if (kind.indexOf("promot") !== -1 || kind.indexOf("shar") !== -1
      || kind.indexOf("finding") !== -1) return "kind-compose";
    if (kind.indexOf("execution") !== -1 || kind.indexOf("phase") !== -1) return "kind-run";
    if (kind.indexOf("message") !== -1 || kind.indexOf("receipt") !== -1
      || kind.indexOf("report") !== -1 || kind.indexOf("guidance") !== -1) {
      return "kind-message";
    }
    return "kind-quiet";
  }

  function staffNoteText(ev) {
    var parts = [String((ev && ev.kind) || "entry")];
    if (ev && ev.counterpart) parts.push("with " + ev.counterpart);
    if (ev && ev.summary) parts.push(ev.summary);
    if (ev && ev.at) parts.push(ageText(ev.at) || ev.at);
    return parts.join(" · ");
  }

  function staffFor(p, opts) {
    var staff = el("span", "doc-staff");
    staff.setAttribute("aria-hidden", "true");
    var events = opts.events || [];
    if (!events.length) return staff;
    var first = Infinity;
    var last = -Infinity;
    for (var i = 0; i < events.length; i += 1) {
      var stamp = events[i] && events[i].at ? Date.parse(events[i].at) : NaN;
      if (isNaN(stamp)) continue;
      if (stamp < first) first = stamp;
      if (stamp > last) last = stamp;
    }
    if (first === Infinity) return staff;
    if (last === first) last = first + 1;
    var mine = [];
    for (i = 0; i < events.length; i += 1) {
      var ev = events[i];
      if (!ev || ev.session !== p.id || !ev.at) continue;
      var time = Date.parse(ev.at);
      if (isNaN(time)) continue;
      mine.push({ ev: ev, left: ((time - first) / (last - first)) * 100 });
      if (mine.length >= STAFF_NOTES) break;
    }
    mine.reverse();
    for (i = 0; i < mine.length; i += 1) {
      var note = el("span", "staff-note " + staffTone(mine[i].ev));
      if (p.live === true && i === mine.length - 1) note.classList.add("open");
      note.style.left = mine[i].left.toFixed(2) + "%";
      note.title = staffNoteText(mine[i].ev);
      staff.appendChild(note);
    }
    return staff;
  }

  // The rehearsal mark: A, B, C ... for each run of rows, the way a score names
  // the place a passage starts.
  function rehearsalMark(index) {
    var letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    var out = "";
    var n = index + 1;
    while (n > 0) {
      var rest = (n - 1) % 26;
      out = letters.charAt(rest) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  }

  // The default roster is the work in flight: a seat playing now, or a seat whose turn
  // ended and waits on input. A held seat, the work a seat owes and the quiet record
  // are recorded state, and the control adds them with their count.
  function scopeLive(state_) {
    return state_ === "working";
  }

  // The control names the scope it would add, with the number of rows it adds, and
  // says so on the button itself rather than in a title.
  function renderScopeControl(node, hidden, scope) {
    if (!node) return;
    node.textContent = "";
    if (scope === "all") {
      text(node, "Show live only");
      node.setAttribute("aria-pressed", "true");
    } else {
      text(node, hidden ? "Show " + hidden + " more recorded" : "Show all recorded");
      node.setAttribute("aria-pressed", "false");
    }
  }

  function rowFor(p, mark, opts) {
    var state = workState(p);
    var li = el("li", "doc-row state-" + state + " tone-" + (mark ? mark.tone : "unknown"));
    li.dataset.docId = p.id;
    li.dataset.docState = state;
    li.tabIndex = -1;
    var selected = opts.selectedId === p.id;
    if (selected) li.classList.add("selected");

    var button = el("button", "doc-open");
    button.type = "button";
    button.dataset.docKey = "row:" + p.id;
    button.setAttribute("aria-current", selected ? "true" : "false");

    var name = el("span", "doc-name mono", p.id);
    name.title = p.id;
    button.appendChild(name);

    var lead = el("span", "doc-lead");
    // The glyph carries the state; the word stays only for the states an operator names
    // (queued, stopped, failed), where the state key is the word. Playing, owes work and
    // quiet read from the glyph, the rule ink and the count marks, with the word in the
    // title and the row's label.
    var named = state === "queued" || state === "stopped" || state === "failed"
      ? state
      : "";
    var glyph = el("span", "doc-glyph state-" + state);
    glyph.setAttribute("aria-hidden", "true");
    lead.appendChild(glyph);
    var workEl = el("span", "doc-work " + state, named);
    workEl.title = (named ? named + " \u00b7 " : "") + (p.action || p.taskTitle || "no work recorded");
    lead.appendChild(workEl);
    button.appendChild(lead);

    var age = ageText(p.actionAt);
    if (age) button.appendChild(el("span", "doc-age mono", age));

    // The badge counts the pending input set only. Owed reports read beside it
    // on the owed mark, so the two numbers are two different kinds of waiting.
    var pending = p.pendingCount || 0;
    if (pending > 0) {
      button.appendChild(el("span", "doc-pending mono", pending));
    }
    // Owed reports: the reports this seat was sent and never acknowledged, read
    // from the stored sample's kinds. The badge beside this counts the queued
    // input set, so the two marks stay two different kinds of waiting, and the
    // title states what the seat owes across every kind.
    var reports = p.reportCount || 0;
    if (reports > 0) {
      var owedMark = el("span", "doc-owed mono", reports);
      owedMark.title = reports + (reports === 1 ? " owed report" : " owed reports")
        + (p.owedTotal > reports ? ", of " + p.owedTotal + " messages owed" : "");
      button.appendChild(owedMark);
    }

    // The actor's own staff, drawn from the entries the page holds.
    var staff = staffFor(p, opts);
    button.appendChild(staff);

    // The staff and the marks are drawn for the eye; the label states the same
    // facts to a reader who cannot see them, in the same state words the row shows.
    var spoken = [p.id, named || state];
    if (p.action) spoken.push(p.action);
    if (pending > 0) spoken.push(pending + " pending");
    if (reports > 0) spoken.push(reports + (reports === 1 ? " report owed" : " reports owed"));
    if (age) spoken.push("last change " + age + " ago");
    var notes = staff.querySelectorAll(".staff-note").length;
    if (notes) {
      spoken.push(notes + " recorded " + (notes === 1 ? "entry" : "entries") + " in the window");
    }
    button.setAttribute("aria-label", spoken.join(", "));

    button.addEventListener("click", function () {
      if (typeof opts.onSelect === "function") opts.onSelect(p.id);
    });
    li.appendChild(button);

    // This author's recorded findings sit on this row, so the knowledge layer is
    // the rows rather than a second surface below them.
    if (opts.knowledgeAuthors && opts.knowledgeAuthors[p.id] && window.KnowledgeLayer) {
      var kw = el("div", "doc-row-knowledge");
      window.KnowledgeLayer.renderKnowledge(kw, { overview: opts.overview }, {
        mode: "band",
        width: opts.knowledgeWidth,
        authorIds: [p.id],
        selectedId: opts.selectedFindingId,
        query: opts.knowledgeQuery || "",
        onSelectFinding: opts.onSelectFinding,
        onSelectActor: opts.onSelect,
        // The card's one move into the record, so a row's card offers it too.
        onOpenRecord: opts.onOpenRecord,
      });
      li.appendChild(kw);
    }
    return li;
  }


  // The fallback record: a definition list of the recorded fields, drawn when the
  // selection module is not present. Full recorded detail belongs in the record, so
  // the raw fields stay here rather than on the row.
  function detailList(facts) {
    var dl = el("dl", "doc-facts");
    facts.forEach(function (item) {
      dl.appendChild(el("dt", null, item[0]));
      dl.appendChild(el("dd", item[1] === "" || item[1] === null
        || item[1] === undefined ? "unknown" : String(item[1])));
    });
    return dl;
  }

  // Draw one state marker per member and announce the totals.
  function bandTicks(members) {
    var line = el("span", "doc-band-ticks");
    var counts = {};
    var order = [];
    members.forEach(function (p) {
      var value = workState(p);
      if (counts[value] === undefined) { counts[value] = 0; order.push(value); }
      counts[value] += 1;
      line.appendChild(el("i", "doc-tick state-" + value));
    });
    var spoken = order.map(function (value) { return counts[value] + " " + value; });
    line.setAttribute("role", "img");
    line.setAttribute("aria-label", spoken.join(", ") || "no members recorded");
    line.title = spoken.join(" · ") || "no members recorded";
    return line;
  }

  // Each run names all recorded memberships shared by its rows.
  function renderRoster(mount, ordered, opts) {
    if (!mount) return;
    mount.textContent = "";
    if (!ordered.length) {
      mount.appendChild(el("p", "muted", opts.query
        ? "No actor matches." : "No actors recorded."));
      return;
    }
    opts.knowledgeWidth = Math.max(100, mount.clientWidth - 22);
    var shown = 0;
    var hidden = 0;
    var bandIndex = 0;
    var lastEnsemble = null;
    var run = null;
    // Each band's members, so its head can carry their states as one line.
    var bandMembers = new Map();
    ordered.forEach(function (p) {
      var key = (p.ensembles || []).join(" · ");
      if (!bandMembers.has(key)) bandMembers.set(key, []);
      bandMembers.get(key).push(p);
    });
    ordered.forEach(function (p) {
      var mark = typeof stateMark === "function" ? stateMark(p) : null;
      // Live scope shows running or queued actors.
      if (opts.scope !== "all" && !scopeLive(workState(p))) {
        hidden += 1;
        return;
      }
      var ensemble = (p.ensembles || []).join(" · ");
      if (ensemble !== lastEnsemble || !run) {
        run = el("section", "doc-band");
        run.dataset.docEnsemble = ensemble;
        var head = el("p", "doc-band-head");
        // The rehearsal mark names this run of rows, so a reader can point at
        // the place it starts.
        var bandMark = el("span", "doc-bracket", rehearsalMark(bandIndex));
        bandMark.title = ensemble || "not in a recorded ensemble";
        bandIndex += 1;
        head.appendChild(bandMark);
        // A band that names one recorded ensemble opens that group's knowledge on the
        // map: the name is the control, and the map's scope line states what it drew.
        var single = ensemble && ensemble.indexOf(" · ") < 0 && ensemble !== "not in a recorded ensemble";
        var bandName = single
          ? el("button", "doc-band-name doc-band-open", ensemble)
          : el("span", "doc-band-name", ensemble || "not in a recorded ensemble");
        if (single) {
          bandName.type = "button";
          bandName.dataset.docGroup = ensemble;
          bandName.title = "Show " + ensemble + "'s holdings";
        }
        head.appendChild(bandName);
        head.appendChild(bandTicks(bandMembers.get(ensemble) || []));
        run.appendChild(head);
        mount.appendChild(run);
        lastEnsemble = ensemble;
      }
      var matched = matchesQuery(p, opts.query);
      var li = rowFor(p, mark, opts);
      if (!matched) li.classList.add("doc-dim");
      else if (!opts.cursorSet && opts.query) {
        li.classList.add("doc-cursor");
        opts.cursorSet = true;
      }
      run.appendChild(li);
      shown += 1;
    });
    if (!shown) {
      mount.appendChild(el("p", "muted", opts.scope === "all"
        ? "No actors recorded."
        : (hidden
          ? "Nothing is running or queued. "
            + hidden + " more recorded."
          : "No actors recorded.")));
    }
    // The control names the scope it adds and how many rows that is.
    renderScopeControl(opts.scopeControl, hidden, opts.scope);
    // Promotion arcs join the rendered rows through the knowledge layer.
    // One hook line; the layer owns the overlay and its geometry.
    if (window.KnowledgeLayer && typeof window.KnowledgeLayer.renderArcs === "function") {
      window.KnowledgeLayer.renderArcs(mount, {
        promotions: (opts.overview && opts.overview.promotions) || [],
        // Supply current actor states and pending counts to the overlay.
        players: ordered.map(function (p) {
          return {
            id: p.id,
            status: p.status || "",
            pendingCount: p.pendingCount || 0,
            unacknowledgedCount: p.unacknowledgedCount || 0,
            owedTotal: p.owedTotal || 0,
            // The two reads with their own names: the work the actor owes its
            // own inbox, and whether the current attempt is stopped or failed.
            owesWork: p.owesWork === true,
            notProgressing: p.notProgressing === true,
            at: p.actionAt || "",
          };
        }),
        // What each actor holds in the knowledge record: authored and received
        // counts per actor id, as the overview reports them.
        actors: (opts.overview && opts.overview.actors) || {},
        selectedFindingId: opts.selectedFindingId || "",
        selectedId: opts.selectedId || "",
      });
    }
  }

  /* The map: the whole recorded ensemble on the paper ground. It is a main view,
     so it draws whenever its mount is in the page. It is the recorded ensemble,
     but a reader still asks how a seat is doing; the shell holds those reads, so
     they travel with the map's payload keyed by actor id. */
  function actorReads(players) {
    var out = {};
    (players || []).forEach(function (p) {
      out[p.id] = {
        status: p.status || "unknown",
        notProgressing: p.notProgressing === true,
        owesWork: p.owesWork === true,
        owedTotal: p.owedTotal || 0,
      };
    });
    return out;
  }

  // The smallest drawing area the map frame keeps for the canvas: the frame grows past
  // its viewport share rather than letting the tools, matches and key consume it all.
  var DRAWING_FLOOR = 240;

  function renderWhole(wholeMount, data, opts) {
    if (!wholeMount) return;
    if (window.KnowledgeLayer && window.KnowledgeLayer.renderKnowledge) {
      window.KnowledgeLayer.renderKnowledge(wholeMount, {
        overview: data.knowledge,
        // The recorded ensembles with their members: the map groups the tiers
        // its members occupy without reading the roster rows.
        ensembles: data.ensembles || [],
        // The per-actor reads, so the map's card states how a seat is doing and
        // not only what it holds.
        actorReads: actorReads(data.players),
      }, {
        mode: "whole",
        selectedId: opts.selectedFindingId,
        // The shell's actor selection, so the map lights the actor a reader picked
        // in the staves or the rail, not only the finding it holds.
        selectedActorId: opts.selectedId || "",
        query: opts.knowledgeQuery || "",
        notice: opts.knowledgeNotice || "",
        onSelectFinding: opts.onSelectFinding,
        onSelectActor: opts.onSelect,
        // The card's one move into the record, forwarded so the card renders it.
        onOpenRecord: opts.onOpenRecord,
        // The relation the record asked the map to light, by its recorded name.
        focusRelation: opts.focusRelation || "",
      });
      // The map publishes the height its own drawing needs; the frame takes that
      // height within bounds, so a small recorded ensemble does not sit in a tall
      // empty box. Without the published number the frame keeps its own size.
      var frame = wholeMount.closest(".map-frame");
      var natural = Number(wholeMount.getAttribute("data-kw-natural-height"));
      var chrome = Number(wholeMount.getAttribute("data-kw-chrome-height"));
      if (frame && isFinite(natural) && natural > 0) {
        var ceiling = Math.round((window.innerHeight || 900) * 0.78);
        var height = Math.min(ceiling, Math.round(natural));
        // The frame holds the tools, the match list and the key above the drawing,
        // so a dense view can leave the canvas nothing. The drawing keeps a stated
        // minimum: the frame grows past the viewport share rather than hiding it.
        if (isFinite(chrome) && chrome > 0) {
          height = Math.max(height, Math.round(chrome) + DRAWING_FLOOR);
        }
        frame.style.height = Math.max(320, height) + "px";
      }
    } else {
      wholeMount.textContent = "";
    }
  }

  function render(mounts, data, opts) {
    if (!mounts || !data) return;
    var options = opts || {};
    var players = Array.isArray(data.players) ? data.players : [];
    var ordered = typeof orderPlayers === "function"
      ? orderPlayers(players) : players.slice();

    var reading = null;
    if (mounts.attention && typeof window.renderAttention === "function") {
      // The same quiet test and the same toggle the roster uses decide which
      // seats the stage draws. The stage keeps the full list for parent depth
      // and for the relation threads, and seats an actor unless its id is here.
      var quietIds = [];
      players.forEach(function (p) {
        var mark = typeof stateMark === "function" ? stateMark(p) : null;
        if (isQuiet(mark)) quietIds.push(p.id);
      });
      reading = window.renderAttention(mounts.attention, players, {
        onSelect: options.onSelect,
        selectedId: options.selectedId,
        // The recorded knowledge overview, so the stage can draw each recorded
        // promotion as an arc between the seats it connects.
        knowledge: data.knowledge || null,
        // The page's event list, so the stage draws the recorded message traffic
        // between seats through the same threads the promotions use.
        events: data.events || [],
        // Quiet actors, by id, and whether the reader asked for them.
        quietIds: quietIds,
        showEnded: options.scope === "all",
      }) || null;
    }

    // Which authors carry a finding decides which rows carry a knowledge block.
    var overview = data.knowledge || null;
    var knowledgeAuthors = {};
    if (overview && overview.findings) {
      for (var i = 0; i < overview.findings.length; i += 1) {
        var author = overview.findings[i] && overview.findings[i].author;
        if (author) knowledgeAuthors[author] = true;
      }
    }

    var ro = Object.assign({}, options, {
      cursorSet: false,
      overview,
      knowledgeAuthors,
      // The entries the page holds, newest first: the staves draw their window
      // from the same list the axis reads.
      events: data.events || [],
      // The document owns the scope control, since it owns the scope.
      scopeControl: mounts.scopeControl,
    });
    renderRoster(mounts.roster, ordered, ro);
    renderWhole(mounts.knowledgeWhole, data, options);

    if (mounts.selection) {
      if (typeof window.renderSelection === "function") {
        window.renderSelection(mounts.selection, {
          seat: options.selectedSeat || null,
          finding: options.selectedFinding || null,
          // The selected id the snapshot does not carry, with the reads that answer for it.
          subject: options.selectedSubject || null,
          events: data.events || [],
          // The project surface's reads, at the level the record expects them.
          retained: (options.selectedSeat && options.selectedSeat.retained) || null,
          // The project read's outcome, so a refusal there is named rather than absent.
          retainedRead: (options.selectedSeat && options.selectedSeat.retainedRead) || null,
          resume: (options.selectedSeat && options.selectedSeat.resume) || null,
          // Complete stored bodies already read, and the way to ask for one.
          messages: data.messages || {},
        }, {
          onSelectEvent: options.onSelectEvent,
          onReadMessage: options.onReadMessage,
          // The record's way back out of an outside-tree subject.
          onClearSelection: options.onClearSelection,
          // A change row opens the seat it names, the same callback the map and the ribbon use.
          onSelectActor: options.onSelect,
          // A relation statement asks the map to light that relation's edges.
          onFocusRelation: options.onFocusRelation,
        });
      } else {
        var seat = options.selectedSeat || null;
        mounts.selection.textContent = "";
        if (!seat) {
          mounts.selection.appendChild(el("p", "muted",
            "Select a row."));
        } else {
          mounts.selection.appendChild(el("h2", "doc-section", seat.id));
          mounts.selection.appendChild(detailList([
            ["role", seat.role], ["status", seat.status],
            ["action", seat.action], ["task", seat.taskTitle],
            ["model", seat.model], ["parent", seat.parent],
          ]));
        }
      }
    }

    if (mounts.ribbon) {
      if (typeof renderRibbon === "function") {
        renderRibbon(mounts.ribbon, { events: data.events || [],
          // What the window is: the page's subject, and the open conversation when there is one.
          subject: data.subject || "", conversationId: options.projectConversation || "" }, {
          position: options.position || 0,
          onScrub: options.onScrub,
          onSelectEvent: options.onSelectEvent,
          onListOpen: options.onListOpen,
          // A chip opens that seat through the shell, and the chip for the
          // selected seat carries aria-current.
          selectedId: options.selectedId,
          onSelectActor: options.onSelect,
        });
      } else {
        mounts.ribbon.textContent = "";
      }
    }

    if (mounts.counts) {
      mounts.counts.textContent = "";
      var counts = (reading && reading.counts) || null;
      if (counts) {
        // Use the same count markup as the page header.
        mounts.counts.appendChild(stat("running", counts.running || 0, "running"));
        mounts.counts.appendChild(statSeparator());
        mounts.counts.appendChild(stat("actors recorded", players.length, ""));
      }
    }
    return { ordered: ordered, reading: reading };
  }

  window.OversightDocument = { render: render, ageText: ageText };
})();
