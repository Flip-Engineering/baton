/* Read-only orchestra, activity, knowledge and selected record views.
   Text is assigned through textContent.

   window.OversightDocument.render(data, opts)
     data.players    [{id, parent, role, model, status, pendingCount, unreadCount,
                      owedTotal, owesWork, notProgressing, action, actionAt, stale, ensembles[],
                      taskTitle, authored, shared, received, live}]
     data.ensembles  [{id, owner, coupling, members[]}]
     data.events     newest first, as the page holds them
     data.knowledge  the overview, or null
     opts.mounts     {attention, legend, selection, ribbon,
                      knowledgeWhole, counts}
     opts.selectedId, opts.selectedFindingId, opts.query
     opts.position   reading position in the recorded history
     opts.scope      "live" for running actors and open work, "all" for history
     opts.onSelect(id), opts.onSelectEnsemble(id), opts.onSelectFinding(id), opts.onScrub(index),
     opts.onSelectEvent(index), opts.onListOpen(open), opts.onOpenRecord(id), opts.onLocate(ref)

   attention.js draws reporting depth and recorded activity. */
(function () {
  "use strict";

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

  function renderScopeControl(node, hidden, scope) {
    if (!node) return;
    node.textContent = "";
    if (scope === "all") {
      node.textContent = "Active orchestra";
      node.setAttribute("aria-pressed", "true");
    } else {
      node.textContent = hidden ? "Show history (" + hidden + ")" : "Show history";
      node.setAttribute("aria-pressed", "false");
    }
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

  /* The knowledge map reads the returned records and their relations. */
  function renderWhole(wholeMount, data, opts) {
    if (!wholeMount) return;
    if (window.KnowledgeLayer && window.KnowledgeLayer.renderKnowledge) {
      window.KnowledgeLayer.renderKnowledge(wholeMount, {
        overview: data.knowledge,
        messages: data.messages || {},
      }, {
        mode: "whole",
        selectedId: opts.selectedFindingId,
        query: opts.knowledgeQuery || "",
        notice: opts.knowledgeNotice || "",
        onSelectFinding: opts.onSelectFinding,
        onReadMessage: opts.onReadMessage,
        scientificSelected: opts.scientificSelected,
        onSelectScientific: opts.onSelectScientific,
        onOpenScientificReference: opts.onOpenScientificReference,
        // The card's one move into the record, forwarded so the card renders it.
        onOpenRecord: opts.onOpenRecord,
        // The way back: the shell selects the mark and shows its surface.
        onLocate: opts.onLocate,
        // The relation the record asked the map to light, by its recorded name.
        focusRelation: opts.focusRelation || "",
        // Its activation count, so a repeated activation is a fresh request.
        focusRelationSeq: opts.focusRelationSeq || 0,
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
      // The active filter selects actors with running or unfinished work. Recorded
      // ancestors remain visible as quiet reporting context in the Stage.
      var quietIds = [];
      players.forEach(function (p) {
        if (p.status !== "running" && !(p.owedTotal > 0 || p.owesWork === true || p.status === "pending")
          && !(p.taskCompletion && p.taskCompletion.open === true)) quietIds.push(p.id);
      });
      reading = window.renderAttention(mounts.attention, players, {
        legendMount: mounts.legend,
        onSelect: options.onSelect,
        onSelectEnsemble: options.onSelectEnsemble,
        selectedEnsemble: options.selectedEnsemble,
        selectedId: options.selectedId,
        // A seam click hands the shell the relation's own identity; the shell
        // routes it to the address and the scoped record.
        onSelectRelation: options.onSelectRelation,
        // The recorded knowledge overview, so the stage can draw each recorded
        // promotion as an arc between the seats it connects.
        knowledge: data.knowledge || null,
        // The page's event list, so the stage draws the recorded message traffic
        // between seats through the same threads the promotions use.
        events: data.events || [],
        // The recorded ensembles with their members and sections, so the
        // stage names its tiers from the payload instead of the id alone.
        ensembles: data.ensembles || [],
        // Quiet actors, by id, and whether the reader asked for them.
        quietIds: quietIds,
        showEnded: options.scope === "all",
        query: options.query || "",
        onSelectEvent: options.onSelectEvent,
      }) || null;
    }

    renderScopeControl(mounts.scopeControl, players.length - (reading ? reading.drawnSeats : 0), options.scope);
    renderWhole(mounts.knowledgeWhole, data, options);

    if (mounts.selection) {
      if (typeof window.renderSelection === "function") {
        window.renderSelection(mounts.selection, {
          seat: options.selectedSeat || null,
          finding: options.selectedFinding || null,
          // The way back to the graph and the hall, so the record can offer a return
          // move rather than making a reader hunt for the mark it holds.
          onLocate: options.onLocate,
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
          onReadMessage: options.onReadMessage,
          // The record's way back out of an outside-tree subject.
          onClearSelection: options.onClearSelection,
          // A change row opens the seat it names, the same callback the map and the ribbon use.
          onSelectActor: options.onSelect,
          // A relation statement asks the map to light that relation's edges.
          onFocusRelation: options.onFocusRelation,
          // The relation the map is currently lit for, so the record can mark it.
          focusRelation: options.focusRelation || "",
        });
      } else {
        var seat = options.selectedSeat || null;
        mounts.selection.textContent = "";
        if (!seat) {
          mounts.selection.appendChild(el("p", "muted",
            "Select an actor."));
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
        var visibleIds = new Set(reading ? reading.stage.tiers.flatMap(function (tier) { return tier.rows.map(function (row) { return row.id; }); }) : []);
        var events = data.events || [];
        var ribbonEvents = events.filter(function (event) { return visibleIds.has(event.session); });
        var eventIndex = function (index) { return events.indexOf(ribbonEvents[index]); };
        renderRibbon(mounts.ribbon, { events: ribbonEvents,
          // What the window is: the page's subject, and the open conversation when there is one.
          subject: data.subject || "", conversationId: options.projectConversation || "" }, {
          position: Math.max(0, ribbonEvents.indexOf(events[options.position || 0])),
          onScrub: function (index) { if (options.onScrub) options.onScrub(eventIndex(index)); },
          onSelectEvent: function (index) { if (options.onSelectEvent) options.onSelectEvent(eventIndex(index)); },
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
