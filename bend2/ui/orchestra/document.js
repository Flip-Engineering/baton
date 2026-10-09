/* Read-only oversight document. Text is assigned through textContent.
   Rows follow the recorded activity order. Selecting a row opens its record.

   window.OversightDocument.render(data, opts)
     data.players    [{id, parent, role, model, status, pendingCount,
                      awaitingInput, action, actionAt, stale, ensembles[],
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

  // Failed executions and explicit stops retain their recorded indication.
  function workState(p) {
    if (!p) return "quiet";
    var live = p.status === "running" || p.status === "waiting" || p.status === "pending";
    if (p.status === "failed") return "stuck";
    if (p.status === "stopped" && (p.pendingCount || 0) > 0) return "stuck";
    if ((p.pendingCount || 0) > 0 || p.status === "pending") return "queued";
    if (live) return "working";
    return "quiet";
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
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

  /* One dense roster row. The action or the recorded task leads, then the age,
     then the name; ids, models and branches stay in the row's detail so the
     work reads before the bookkeeping. */
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

    var lead = el("span", "doc-lead");
    var work = p.action || p.taskTitle || "";
    if (work) {
      lead.appendChild(el("span", "doc-work" + (p.stale ? " stale" : ""), work));
    } else {
      lead.appendChild(el("span", "doc-work quiet", mark ? mark.word : "no work recorded"));
    }
    button.appendChild(lead);

    var age = ageText(p.actionAt);
    if (age) button.appendChild(el("span", "doc-age mono", age));

    var pending = p.pendingCount || 0;
    if (pending > 0) {
      button.appendChild(el("span", "doc-pending mono", pending));
    }

    var name = el("span", "doc-name mono", p.id);
    button.appendChild(name);

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
        head.appendChild(el("span", "doc-bracket", ensemble ? "" : "no ensemble"));
        head.appendChild(el("span", "doc-band-name mono",
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
  }

  /* The whole-orchestra view of the same records, drawn only while its
     disclosure is open, so it is never the default surface and holds no region
     while it is closed. */
  function renderWhole(wholeMount, data, opts) {
    if (!wholeMount) return;
    var open = wholeMount.parentElement && wholeMount.parentElement.open === true;
    if (open && window.KnowledgeLayer && window.KnowledgeLayer.renderKnowledge) {
      window.KnowledgeLayer.renderKnowledge(wholeMount, { overview: data.knowledge }, {
        mode: "whole",
        selectedId: opts.selectedFindingId,
        query: opts.knowledgeQuery || "",
        notice: opts.knowledgeNotice || "",
        onSelectFinding: opts.onSelectFinding,
        onSelectActor: opts.onSelect,
      });
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
      reading = window.renderAttention(mounts.attention, players, {
        onSelect: options.onSelect,
        selectedId: options.selectedId,
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
        });
      } else {
        mounts.ribbon.textContent = "";
      }
    }

    if (mounts.counts) {
      mounts.counts.textContent = "";
      var counts = (reading && reading.counts) || null;
      if (counts) {
        mounts.counts.appendChild(el("span", null,
          (counts.running || 0) + " running · " + (players.length) + " actors recorded"));
      }
    }
    return { ordered: ordered, reading: reading };
  }

  window.OversightDocument = { render: render, ageText: ageText };
})();
