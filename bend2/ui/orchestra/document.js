/* Read-only oversight document. Text is assigned through textContent.
   Rows follow the recorded activity order. Selecting a row opens its record.

   window.OversightDocument.render(data, opts)
     data.players    [{id, parent, role, model, status, pendingCount, unacknowledgedCount,
                      owedTotal, owesWork, needsPerson, action, actionAt, stale, ensembles[],
                      taskTitle, authored, shared, received, live}]
     data.ensembles  [{id, owner, coupling, members[]}]
     data.events     newest first, as the page holds them
     data.knowledge  the overview, or null
     opts.mounts     {attention, roster, knowledge, selection, ribbon,
                      knowledgeWhole, counts}
     opts.selectedId, opts.selectedFindingId, opts.query
     opts.position   reading position in the recorded history
     opts.showEnded  whether quiet rows are shown
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

  // Failed executions and stopped seats keep a distinct read; the row paints
  // each state as the rule down its left edge. Held means a recorded fact stops
  // the seat and a person must act; the queued branch reads the work the actor
  // owes its own inbox, which never means a person is needed.
  function workState(p) {
    if (!p) return "quiet";
    var live = p.status === "running" || p.status === "waiting" || p.status === "pending";
    if (p.status === "failed") return "failed";
    if (p.status === "stopped") return "stopped";
    if ((p.owedTotal || 0) > 0 || p.owesWork === true || p.status === "pending") return "queued";
    if (live) return "working";
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
    var work = p.action || p.taskTitle || "";
    if (work) {
      lead.appendChild(el("span", "doc-work" + (p.stale ? " stale" : ""), work));
    } else {
      lead.appendChild(el("span", "doc-work quiet", mark ? mark.word : "no work recorded"));
    }
    // The row draws one line, so the elided text stays readable on hover.
    lead.title = work || (mark ? mark.word : "no work recorded");
    button.appendChild(lead);

    // The failed read: the recorded terminal of the attempt, in the row.
    if (p.status === "failed") {
      var failedWord = el("span", "doc-fail-word", "failed");
      failedWord.title = "the current attempt ended on a recorded failure";
      button.appendChild(failedWord);
    } else if (p.needsPerson === true && p.status === "stopped") {
      // The stopped read: a recorded stop holds the seat until a person resumes it.
      var stoppedWord = el("span", "doc-held-word", "stopped");
      stoppedWord.title = "the record holds this seat at an explicit stop";
      button.appendChild(stoppedWord);
    }

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
    // facts to a reader who cannot see them.
    var spoken = [p.id, p.status || "unknown"];
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

    if (selected && p.detail && p.detail.length) {
      li.appendChild(detailList(p.detail));
    }
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
      });
      li.appendChild(kw);
    }
    return li;
  }

  function detailList(facts) {
    var dl = el("dl", "doc-facts");
    facts.forEach(function (fact) {
      dl.appendChild(el("dt", null, fact[0]));
      dl.appendChild(el("dd", fact[1] === "" || fact[1] === null
        || fact[1] === undefined ? "unknown" : String(fact[1])));
    });
    return dl;
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
    var bandIndex = 0;
    var lastEnsemble = null;
    var run = null;
    ordered.forEach(function (p) {
      var mark = typeof stateMark === "function" ? stateMark(p) : null;
      var quiet = isQuiet(mark);
      if (quiet && !opts.showEnded) return;
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
        head.appendChild(el("span", "doc-band-name",
          ensemble || "not in a recorded ensemble"));
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
      mount.appendChild(el("p", "muted", opts.showEnded
        ? "No actors recorded." : "No live or queued work. Show quiet to see ended and unobserved actors."));
    }
    // Promotion arcs join the rendered rows through the knowledge layer.
    // One hook line; the layer owns the overlay and its geometry.
    if (window.KnowledgeLayer && typeof window.KnowledgeLayer.renderArcs === "function") {
      window.KnowledgeLayer.renderArcs(mount, {
        promotions: (opts.overview && opts.overview.promotions) || [],
        // The ordered row records, each carrying the reads the row marks use:
        // the recorded status, the two counts and whether the seat needs a
        // person. The layer draws only the ids whose rows are in the mount, so
        // the list travels whole.
        players: ordered.map(function (p) {
          return {
            id: p.id,
            status: p.status || "",
            pendingCount: p.pendingCount || 0,
            unacknowledgedCount: p.unacknowledgedCount || 0,
            owedTotal: p.owedTotal || 0,
            // The two reads with their own names: the work the actor owes its
            // own inbox, and whether a recorded fact holds the seat for a person.
            owesWork: p.owesWork === true,
            needsPerson: p.needsPerson === true,
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
        needsPerson: p.needsPerson === true,
        owesWork: p.owesWork === true,
        owedTotal: p.owedTotal || 0,
      };
    });
    return out;
  }

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
      });
      // The map publishes the height its own drawing needs; the frame takes that
      // height within bounds, so a small recorded ensemble does not sit in a tall
      // empty box. Without the published number the frame keeps its own size.
      var frame = wholeMount.closest(".map-frame");
      var natural = Number(wholeMount.getAttribute("data-kw-natural-height"));
      if (frame && isFinite(natural) && natural > 0) {
        var ceiling = Math.round((window.innerHeight || 900) * 0.78);
        frame.style.height = Math.max(320, Math.min(ceiling, Math.round(natural))) + "px";
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
        // Quiet actors, by id, and whether the reader asked for them.
        quietIds: quietIds,
        showEnded: options.showEnded === true,
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
    });
    renderRoster(mounts.roster, ordered, ro);
    renderWhole(mounts.knowledgeWhole, data, options);

    if (mounts.selection) {
      if (typeof window.renderSelection === "function") {
        window.renderSelection(mounts.selection, {
          seat: options.selectedSeat || null,
          finding: options.selectedFinding || null,
          events: data.events || [],
          // Complete stored bodies already read, and the way to ask for one.
          messages: data.messages || {},
        }, {
          onSelectEvent: options.onSelectEvent,
          onReadMessage: options.onReadMessage,
        });
      } else {
        var seat = options.selectedSeat || null;
        mounts.selection.textContent = "";
        if (!seat) {
          mounts.selection.appendChild(el("p", "muted",
            "Select a row to read its record here."));
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
        renderRibbon(mounts.ribbon, { events: data.events || [] }, {
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
