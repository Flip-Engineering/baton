# Code Discovery & Retrieval — baton capability module

*Capability-plane module. Runtime codename: **`atlas`** — a shared, incremental, multi-modal code index the whole fleet queries instead of each worker re-walking the tree. Designed against the three planes of docs 04/05/08 and the adapter contract. The user named `fff`; the honest answer is that `fff` is one of four modalities `atlas` composes, not the whole thing.*

## Summary (5 bullets)

- **`fff` is real and good, but it's a single-process SDK, not a fleet service.** [dmtrKovalenko/fff](https://github.com/dmtrKovalenko/fff) is a Rust in-memory file-search SDK for AI agents: background file-watcher, frecency ranking, git-status via libgit2, SIMD fuzzy path/content matching, structured typed results with `isDefinition` tagging and cursor pagination, MCP + Node/Python/C bindings. Its Chromium (500k-file) benchmark is the whole thesis: **ripgrep ≈ 3–9 s per spawn vs `fff` < 10 ms per query after one scan.** baton should *wield* fff-class tech as the lexical leg of a **fleet-shared** index, not ship it per-worker.
- **The 2025–26 consensus is "grep won, but the grep replacement is three tools, not one":** lexical (ripgrep/Zoekt/BM25) + structural (ast-grep) + graph (LSP/SCIP), with semantic embeddings as an *opt-in fourth* for the cases where grep provably fails (large/unfamiliar/unstructured corpora). Claude Code, Cursor, Cline, Devin, Sourcegraph Amp all dropped default vector search in 2025; the hybrid-tools stance is the settled answer.
- **The multi-agent twist nobody else has to solve: N worktrees diverge.** Cursor's Merkle-tree incremental index assumes one working copy. A baton fleet has one immutable **base commit** shared by all workers plus **N cheap dirty overlays** (each worker's diff). `atlas` indexes the base *once* (shared, content-addressed, amortized across the fleet and across turns) and composes it with a per-worker overlay at query time — a copy-on-write/LSM query model. This is why a shared index beats N independent greps by more than a constant factor.
- **Discovery is orchestration-aware:** every query is a ledger event (doc 05), heavy index builds are task-DAG tasks whose shards register as content-addressed artifacts (doc 08), and the orchestrator can **seed worker attention** (`code_seed`: "look here first") — turning discovery into a steering surface, and turning out-of-scope searches into the scope-drift derived signal doc 05 §2 already computes.
- **Everything is token-bounded and staleness-honest.** Every verb takes `budget_tokens`; default results are symbol-anchored one-liners (path:line + enclosing symbol + `isDefinition`), not raw lines (the fff/gortex lesson: 3–50× fewer tokens, BM25 R@5 ~55% vs ripgrep ~17%). Every result carries `index_rev` + a `staleness` field (`fresh|lagging|base_only`) so agents and the supervisor *see* index lag rather than trusting it silently — the same discipline as `emulated:true` in harness cards.

## The problem for an agent fleet (why harness-native tools are insufficient here)

Each worker harness already has `Grep`/`Glob`/`Read`. For a *solo* agent on a 50k-line repo that is genuinely enough — a handful of aimed greps beats any retrieval pipeline (Anthropic's own finding when they removed RAG from Claude Code in May 2025). So why build anything?

Because a **fleet** changes the cost structure and the coordination surface in four ways harness-native tools can't touch:

1. **The O(repo) walk is paid N×M×T times, not once.** With N workers, each doing M searches over T turns, stock `Grep` re-walks and re-reads the tree every spawn. fff's benchmark makes the multiplier concrete (3–9 s vs <10 ms). A *shared* index pays the walk/parse/embed **once per base commit** and amortizes it across every worker, every turn, and the orchestrator's own probes. This is a cache-sharing argument, and caches only pay off when shared — the fleet is exactly where a per-agent index stops being wasteful.
2. **Workers can't seed each other, and the orchestrator can't seed workers.** When worker w3 discovers "the auth entrypoint is `SessionManager.validate`," that knowledge dies in w3's context. Harness-native search has no fleet-visible output. baton wants discovery results to flow into the ledger (events) and the artifact registry (reusable context-packs/dossiers — the Augment "async pre-processing" lesson), and it wants the **orchestrator to push attention *downward*** ("look at `src/auth/` first"), which is exactly doc 08's *push-addressed-minimal* downward-context channel realized as a search primitive.
3. **Worktrees diverge — a correctness problem, not just a cost problem.** Per doc 06/08 every worker runs in its own git worktree. A naive shared index would show worker w2 the uncommitted edits of w5 (wrong: breaks isolation) or force N full re-indexes (wasteful). Neither Cursor's single-copy Merkle model nor stock grep addresses "one base, N diverging dirty trees." This is the module's defining constraint.
4. **Discovery must be steerable and interruptible like everything else in baton.** A `code_context_pack` over a monorepo, or a first-time embedding pass, is a *long operation* — it belongs in the task-DAG and must honor the control fence (`turn_epoch`), be cancelable, and degrade explicitly, not block a worker's turn or a `fleet_wait`. Harness-native search is a synchronous tool call with none of this.

Harness-native search is the right *fallback* (and the always-available read-verify-against-disk path). It is the wrong *fleet substrate*.

## Prior art

Real tools, current status verified July 2026. "Borrows / rejects" is from baton's specific fleet-orchestration vantage.

| Tool / system | What it does | 2025–26 status | What baton borrows | What baton rejects |
|---|---|---|---|---|
| **[fff](https://github.com/dmtrKovalenko/fff)** (dmtrKovalenko) | In-memory file-search SDK for agents; SIMD fuzzy path + Smith-Waterman content grep; frecency + git-status; incremental watcher; typed results, `isDefinition`, cursor pagination; MCP+Node/Py/C | Active, MIT; explicitly agent-targeted | The whole model of a *persistent in-memory index for long-running agents*; typed structured hits; frecency+git ranking; incremental file-watcher; `isDefinition` tagging | Per-process/per-worker scope — baton needs one index **shared** across the fleet with per-worktree views |
| **[ripgrep](https://github.com/BurntSushi/ripgrep)** / **[fd](https://github.com/sharkdp/fd)** | Fast regex grep / find alternative; gitignore-aware; no persistent index | Ubiquitous baseline | The lexical fallback semantics; gitignore/`.ignore` handling; regex engine quality | Spawn-per-query O(repo) cost as the fleet's primary path |
| **[Zoekt](https://github.com/sourcegraph/zoekt)** (Sourcegraph, orig. Google) | Positional **trigram** index; sub-50 ms on ~2 GB (Android); mmap'd shards; incremental reindex | Actively maintained by Sourcegraph | Trigram index + memory-mapped shards as the shared lexical leg; incremental per-shard reindex; shard-parallel search | Server/cluster deployment weight for an MVP single-box sidecar |
| **[ast-grep](https://github.com/ast-grep/ast-grep)** | Tree-sitter **CST** structural search/rewrite; `$METAVAR`; never matches comments/strings; SARIF output (Nov 2025) | Active (changes through Dec 2025), Rust, many langs | The structural leg verbatim — wrap as `code_ast`; no persistent index needed (parse-on-view) | Cross-file name resolution (it explicitly can't — that's the graph leg's job) |
| **[comby](https://github.com/comby-tools/comby)** | Language-agnostic structural search/replace via balanced-delimiter matching | Stable, lower activity | Fallback structural matcher for languages lacking a tree-sitter grammar | As the primary structural engine — less precise than ast-grep's CST |
| **[Serena](https://github.com/oraios/serena)** (oraios) | MCP toolkit running **real LSP servers**; `find_symbol`, `find_referencing_symbols`, `insert_after_symbol`; symbol **name-path addressing** (`MyClass/my_method`); 30–40+ langs | Active, MIT; the reference "IDE-brain for agents" | The graph/symbol leg design: name-path addressing (line-number-free, edit-safe), `find_referencing_symbols`, "token-cheap replacement for read-the-file" | Its per-project single-agent framing; baton needs LSP servers pooled per **view** across the fleet |
| **[SCIP](https://sourcegraph.com/blog/announcing-scip)** (Sourcegraph) | Language-agnostic code-intelligence protocol; **incremental** (reindex only changed files); go-to-def / refs / impls | Active successor to LSIF | The incremental-index format + "only reindex what changed" as the graph leg's persistence model | Requiring a per-language SCIP indexer as a hard dependency (opt-in per language) |
| **[stack-graphs](https://github.blog/open-source/introducing-stack-graphs/)** (GitHub) | Tree-sitter + `.tsg` grammars; name resolution "at scale"; incremental | **ARCHIVED 2025-09-09** — per-language `.tsg` maintenance proved unsustainable | The cautionary lesson: precise universal cross-file graphs are *not a solved problem* | Building baton's graph leg on a dead, per-language-grammar-heavy approach |
| **[Kythe](https://github.com/kythe/kythe)** (Google) | Heavyweight batch code-graph / cross-references | Alive but heavy, batch-oriented | Nothing operationally; only the north star of "resolved edges are valuable" | Batch/heavyweight indexing — wrong tempo for a live diverging fleet |
| **[Cursor indexing](https://cursor.com/blog/secure-codebase-indexing)** + [turbopuffer](https://turbopuffer.com/customers/cursor) | **Merkle tree** of file hashes → incremental change detection; local chunk → embed → vector DB (1T+ vectors); `copy_from_namespace` structural sharing across similar repos; path obfuscation; Merkle proofs gate reads | Production; scaled to 1T+ vectors | **Merkle content-addressing for incremental sync + structural sharing** — the exact mechanism for sharing a base index across the fleet cheaply | Cloud vector DB as a hard dependency; single-working-copy assumption (baton has N diverging trees) |
| **[claude-context](https://github.com/zilliztech/claude-context)** (Zilliz/Milvus) | MCP semantic search; **hybrid BM25 sparse + dense** in Milvus; Merkle incremental; ~40% token cut | Active, 11.8k★, self-hostable | Hybrid BM25+dense as the optional semantic leg; ~40% token-reduction target; local/self-host posture | Semantic search as the *default*; embeddings over dirty overlays |
| **[Aider repo-map](https://aider.chat/docs/repomap.html)** | Tree-sitter symbol extraction + **PageRank** relevance ranking → token-bounded repo map | Active | The `code_context_pack` design: PageRank-ranked, hard token budget (4–6% context vs 54–70% for blind iterative search) | Building it *per solo session* rather than as a reusable fleet artifact |
| **[Augment SWE-bench writeup](https://jxnl.co/writing/2025/09/11/why-grep-beat-embeddings-in-our-swe-bench-agent-lessons-from-augment/)** / **[gortex "three tools"](https://zzet.org/gortex/grep-replacement-for-ai-agents/)** | Field reports: grep beat embeddings on small structured repos; embeddings essential for large/unfamiliar/unstructured; "expose retrieval as *tools*, per-question modality" | Current (2025–26) discourse | The modality-per-question tool design; the explicit carve-out of *when* semantic earns its keep; re-rankers + hierarchical retrieval | Embeddings-by-default; single-tool maximalism in either direction |

## Module design

### Agent-facing interface (MCP tools / verbs)

`atlas` is an MCP server the fleet mounts — workers wield it for retrieval, the orchestrator wields it for seeding/steering. All verbs share three parameters: **`view`** (the isolation unit, below), **`budget_tokens`** (hard output cap), and optional **`page`** (opaque cursor). Modalities are *distinct verbs* on purpose — the agent picks per question (the "three tools not one" lesson).

```ts
// A view = (base_commit, worktree_id). Resolves to shared-base-index ⊕ per-worker-overlay.
// Passing just a worktree_id resolves base_commit from that worktree's merge-base.
type View = { worktree: WorkerId } | { base: string, worktree?: WorkerId };

// --- Lexical leg (Zoekt/fff-class trigram; the default, fastest, always-available) ---
code_grep(pattern: string, view: View, opts?: {
  regex?: boolean, path_scope?: Glob[], max_hits?: number, budget_tokens?: number
}) -> { hits: Hit[], total_hits: number, truncated: boolean,
        next_cursor?: string, index_rev: string, staleness: Staleness }

code_find_files(query: string, view: View, opts?: { budget_tokens?: number })
  -> { files: FileHit[], ranked_by: "frecency+git+fuzzy", index_rev, staleness }

// --- Structural leg (ast-grep; parse-on-view, no persistent index) ---
code_ast(pattern: string|RuleYAML, view: View, opts?: { lang?: Lang, budget_tokens?: number })
  -> { matches: AstMatch[] /* node_kind, metavars, enclosing_symbol */, truncated, ... }

// --- Graph leg (Serena/SCIP/LSP; symbol name-path addressed, edit-safe) ---
code_symbol(name_path: string /* "Auth/SessionManager/validate" */ | { query: string },
  view: View, want: ("def"|"refs"|"callers"|"impls"|"body")[], opts?: { budget_tokens?: number })
  -> { symbol: SymbolRef, def?: Loc, body?: string /* read live from disk */,
       refs?: Loc[], callers?: SymbolRef[], impls?: SymbolRef[], resolver: "lsp"|"scip"|"heuristic" }

// --- Semantic leg (OPT-IN; hybrid BM25+dense, re-ranked; may be unsupported per index) ---
code_semantic(nl_query: string, view: View, opts?: { k?: number, budget_tokens?: number })
  -> { chunks: SemanticHit[], reranked: boolean, index_rev, staleness /* base_only always */ }
  // OR: { unsupported: "semantic index disabled for this repo", fallback: "code_grep" }

// --- Context pack / repo-map (Aider-style PageRank, token-bounded; the SEED artifact) ---
code_context_pack(seed: { task_id: string } | { nl_query: string } | { symbols: string[] },
  view: View, budget_tokens: number)
  -> { pack_ref: ArtifactId, map: RankedFileMap, token_cost: number }  // registered as artifact

// --- Introspection (staleness is first-class, queryable) ---
code_index_status(view: View)
  -> { base_root: MerkleRoot, base_ready: boolean, overlay_rev: string,
       dirty_files: number, index_lag_ms: number, legs: { lexical, structural, graph, semantic: LegStatus } }

// --- Orchestrator-only steering ---
code_seed(target: WorkerId|TaskId, hints: { paths?: Glob[], symbols?: string[], pack_ref?: ArtifactId })
  -> Ack   // pushes attention into the worker's downward context (doc 08 push-addressed-minimal)
```

### Integration with the three planes

**Operational ledger (doc 05).** Every query emits a `capability.code.query` event (new closed-set kind under a `capability.*` namespace): `{ worker, view, verb, modality, hits, tokens_returned, index_rev, cache_hit, latency_ms, staleness }`. This is machine-written and cheap (doc 08 §2's "ledger is cheap" rule). It feeds two derived signals for free: **scope-drift** (doc 05 §2 — a worker searching/reading outside its seeded `path_scope` is the same predictive signal already computed) and a **discovery-thrash** signal (k near-identical failed searches = the retrieval analog of the edit/test/fail loop). Long verbs (`code_context_pack`, first `code_semantic`) carry the `(worker, turn_epoch)` control fence and are cancelable via `interrupt` — a monorepo pack is never a blocking tool call.

**Coordinative task-DAG + artifact registry (doc 08 §3).** A first-time **index build** (trigram shard, embedding pass, SCIP index) is a **task** in the DAG: `working → completed|failed`, subject to the same ready-work/concurrency machinery. Its output — an index shard — registers in the **artifact registry** content-addressed by **base-commit Merkle root**, so it is *shared by every worker on that base and reused across runs* (this is the fleet-sharing mechanism, structurally identical to Cursor's `copy_from_namespace`). `code_context_pack` outputs are likewise artifacts (`pack_ref`): the dossier worker w3 built for the auth subsystem is handed to w7 instead of rebuilt (the Augment async-preprocessing win). The registry stays a *manifest* (doc 08 §3b) — the index shards live on disk / in a local vector store; the registry just addresses them.

**Epistemic (doc 08 §5).** Follows doc 08's stance exactly: **discovery ships operational + coordinative; epistemic is export-only.** A high-value, cheaply-derived promotion: "symbol `SessionManager.validate` is the auth entrypoint, confirmed by `find_referencing_symbols` across 3 workers" → an optional `pm_log_finding`-shaped export at run boundary. Never a runtime dependency, never auto-injected into a new run's context (doc 08 §7 Q3).

**Steering & interruption.** `code_seed` is the orchestrator's attention primitive — it writes hints into a worker's downward-context channel ("look here first"), realizing doc 05 §6's "brief well, then intervene on signal" as a *retrieval* intervention: on a discovery-thrash signal, the orchestrator seeds the missing path/symbol rather than steering the whole turn. Human takeover (doc 05 §7) and any base-commit change **invalidate** the relevant index rev; the fence precedence (human > orchestrator > policy) governs who may pin/warm.

### Agent-ergonomic output shape (concrete)

A `code_grep("validate_session", { worktree: "w_codex_01" }, { budget_tokens: 400 })` returns symbol-anchored one-liners, not raw grep lines — the token difference that makes BM25 R@5 ~55% vs ripgrep ~17% at 3–50× fewer tokens:

```jsonc
{
  "index_rev": "sha:9f3c…@overlay:7",
  "staleness": "fresh",                    // overlay caught up to worktree mtime
  "total_hits": 11, "truncated": true, "next_cursor": "c:eyJvIjoxMH0",
  "hits": [
    { "path": "src/auth/session.rs", "line": 142,
      "symbol": "auth::SessionManager::validate_session", "isDefinition": true,
      "preview": "pub fn validate_session(&self, tok: &Token) -> Result<Claims>",
      "git": "committed" },
    { "path": "src/api/mw.rs", "line": 88,
      "symbol": "api::mw::require_auth", "isDefinition": false,
      "preview": "let claims = self.sessions.validate_session(&tok)?;",
      "git": "dirty" }                     // ← this line is in w_codex_01's overlay only
  ],
  "advice": "2 hits are definitions; use code_symbol want=[callers] on the def for the call graph."
}
```

`code_symbol("auth/SessionManager/validate_session", view, ["def","callers","body"])` addresses by **name path, not line number** (Serena's edit-safe model — bodies stay valid as edits shift lines) and reads the body **live from disk** (freshness — never a stale cached chunk):

```jsonc
{ "symbol": "auth::SessionManager::validate_session", "resolver": "lsp",
  "def": { "path": "src/auth/session.rs", "line": 142 },
  "body": "pub fn validate_session(&self, tok: &Token) -> Result<Claims> { … }",   // from disk
  "callers": [ { "symbol": "api::mw::require_auth", "path": "src/api/mw.rs", "line": 88 },
               { "symbol": "api::ws::on_connect",   "path": "src/api/ws.rs", "line": 51 } ],
  "staleness": "fresh", "budget_used": 310 }
```

### Shared vs per-worker (concurrency implications)

The core architecture is **shared immutable base ⊕ per-worker mutable overlay** — a copy-on-write/LSM query model:

- **Shared, immutable, fleet-wide:** the **base index** (trigram + symbol table + optional embeddings), content-addressed by the base-commit Merkle root. Built once, mmap'd, read by all N workers and the orchestrator, across all turns. Immutable ⇒ **readers never lock** (doc 08 §4's "no shared mutable world-state blob"). This is the entire economic case: the O(repo) walk/parse/embed is paid once, not N×M×T times.
- **Per-worker, mutable, tiny:** each worker's **overlay** — an index of just that worker's dirty files (`git diff base…worktree`), rebuilt incrementally by an fff-style file-watcher. Single-writer (the worker's own adapter) ⇒ no cross-writer contention. A worker sees *its own* uncommitted edits and *nobody else's* (isolation preserved). Overlay build is cheap because dirty sets are small.
- **Query composition:** `query(view_w) = query(base) ∖ shadowed_by(overlay_w) ∪ query(overlay_w)`. The subtle case (honest residual below) is deletions/renames in the overlay — a base hit in a file w deleted must be suppressed; the overlay carries tombstones for this.
- **Commit folds overlay into a new base node** via Merkle structural sharing (Cursor's `copy_from_namespace` trick): only the changed subtree reindexes; the new base is shared by any worker that rebases onto it. Divergence is thus a *first-class cheap overlay*, not N full indexes — the direct answer to "worktrees diverge."
- **The index is a projection, never the truth** (mirrors doc 08 §4/§5 on the SQLite index): the source of truth is git + the worktree. If a shard corrupts, drop and rebuild. This keeps the shared index from ever becoming a consensus bottleneck.

## Scoping (MVP rung vs later rungs)

- **Rung 0 (MVP — "fff/Zoekt as a fleet service"):** shared **lexical** trigram index keyed by base-commit + per-worker overlay from `git diff`; `code_grep`, `code_find_files`, `code_index_status`; symbol-anchored token-bounded output; results as `capability.code.query` ledger events; `code_seed` for the orchestrator. This alone beats N ripgreps and gives the orchestrator an attention lever. Ships on off-the-shelf parts (Zoekt or fff-core + a watcher).
- **Rung 1 — structural (`code_ast`):** wrap ast-grep, parse-on-view, **no new index** — cheap add, high value for refactor/codemod tasks; comby fallback for grammarless languages.
- **Rung 2 — graph (`code_symbol`):** pooled LSP servers per view (Serena-style) with SCIP incremental where a language indexer exists; heavy warmups run as task-DAG tasks. The token-cheapest "what calls this."
- **Rung 3 — semantic (`code_semantic`):** opt-in hybrid BM25+dense (claude-context/Milvus shape), **base-only, re-ranked, honest capability flag**, enabled only where grep provably underperforms (large/unfamiliar/unstructured repos — the Augment carve-out). Never default, never auto-injected.
- **Rung 4 — dossiers & promotion:** `code_context_pack` as reusable artifacts (Aider PageRank) + optional epistemic export of confirmed structural facts.

## Limitations & honest residuals

- **Precise cross-file graphs are not a solved problem.** GitHub archived **stack-graphs in Sept 2025** over per-language `.tsg` maintenance; SCIP needs a per-language indexer; LSP servers are per-language warmups that flake. `atlas` must declare the graph leg's coverage **per language** (a harness-card-style capability matrix) and degrade to heuristic/ctags resolution explicitly — never fake a universal call graph.
- **Semantic staleness is unfixable at fleet tempo.** Embeddings index the base only (re-embedding a dirty overlay per keystroke is infeasible), so semantic results are *base-fresh at best* — always stamped `staleness: base_only`. This is precisely why Claude Code dropped default vectors; `atlas` respects it by keeping semantic opt-in and always offering read-verify-against-disk.
- **Overlay composition has sharp edges:** deletions, renames, and large mechanical refactors in a worker's dirty set stress the tombstone/shadowing logic; a worker mid-rewrite has a large overlay that erodes the shared-base economy for *that* worker (correct, but slower).
- **Search output is untrusted input to the orchestrator** (doc 00 D7): a matched string can carry a prompt injection. Results flow as *data* into the ledger/registry with provenance, never as instructions — but the orchestrator consuming a `code_context_pack` must treat it as adversarial content.
- **Semantic-leg privacy:** embedding via a remote API can exfiltrate code past the OS-sandbox boundary (doc 05 §5). `atlas` must default to local embedding models or an explicit per-repo opt-in, honoring per-worker secrets scoping (doc 06 Q10) — Cursor's path-obfuscation is a patch; local-first is the honest posture.
- **Monorepo operational weight:** N languages ⇒ N tree-sitter grammars + N LSP servers + N SCIP indexers. The graph and semantic rungs carry real ops cost; the MVP deliberately doesn't.
- **`index_lag` is a real race:** between a worker's write and the watcher catching up, results are `lagging{n}`. `atlas` surfaces the lag rather than blocking; a worker needing write-read consistency uses `code_symbol want=body` (live disk read) instead of the cached index.

## Sources

- fff (fast file-finder SDK for agents): https://github.com/dmtrKovalenko/fff
- ripgrep: https://github.com/BurntSushi/ripgrep · fd: https://github.com/sharkdp/fd
- Zoekt (trigram code search): https://github.com/sourcegraph/zoekt · design: https://github.com/sourcegraph/zoekt/blob/main/doc/design.md
- ast-grep: https://github.com/ast-grep/ast-grep · docs: https://ast-grep.github.io/
- comby: https://github.com/comby-tools/comby
- Serena (LSP semantic MCP toolkit): https://github.com/oraios/serena
- SCIP (code intelligence protocol): https://sourcegraph.com/blog/announcing-scip · https://github.com/scip-code/scip
- stack-graphs (archived 2025-09): https://github.blog/open-source/introducing-stack-graphs/
- Kythe: https://github.com/kythe/kythe
- Cursor secure/Merkle indexing: https://cursor.com/blog/secure-codebase-indexing · turbopuffer scale: https://turbopuffer.com/customers/cursor · how it indexes: https://towardsdatascience.com/how-cursor-actually-indexes-your-codebase/
- claude-context (hybrid BM25+dense MCP): https://github.com/zilliztech/claude-context · https://milvus.io/blog/claude-context-reduce-claude-code-token-usage.md
- Aider repo-map (tree-sitter + PageRank): https://aider.chat/docs/repomap.html
- "The grep replacement is three tools, not one" (lexical/structural/graph): https://zzet.org/gortex/grep-replacement-for-ai-agents/
- Claude Code dropped vector search (agentic search): https://vadim.blog/claude-code-no-indexing/ · https://zerofilter.medium.com/why-claude-code-is-special-for-not-doing-rag-vector-search-agent-search-tool-calling-versus-41b9a6c0f4d9
- Augment: why grep beat embeddings on SWE-bench (+ when embeddings still help): https://jxnl.co/writing/2025/09/11/why-grep-beat-embeddings-in-our-swe-bench-agent-lessons-from-augment/
- Agentic vs semantic code-search debate notes: https://wowelec.wordpress.com/2026/05/18/agentic-semantic-or-both-notes-from-the-code-search-debate/

---

# Appendix: Design critique (workflow critic pass)

## Design critique & sharpening for discovery-search

This is a strong, well-researched dossier — the base⊕overlay insight is the right core idea, the prior-art table is accurate (I verified fff, the Gortex R@5 55.1/17.3 numbers, the stack-graphs 2025-09-09 archive, cAST), and the "three tools not one" stance is the settled 2025-26 answer. So I'll spend the whole budget on what's wrong, unbuilt, or hand-waved.

### 0. The headline miss: it doesn't conform to the capability-plane contract it's supposed to instantiate

The dossier was written against docs 04/05/08 + adapter-contract, but the **authoritative contract for this module is `spec/capability-plane.md`**, and `atlas` diverges from it in load-bearing ways. This is the single biggest correction — right now `atlas` floats *beside* the capability plane instead of *being* an instance of it.

- **The ACI result envelope (§3) is mandatory and `atlas` ignores it.** The spec fixes ONE return shape for every capability — `{op, status, summary, payload, refs, cursor, cost, provenance}` — so workers and the orchestrator learn a single consumption idiom. `code_grep` instead returns bespoke `{hits, total_hits, truncated, next_cursor, index_rev, staleness}`. Map it: `next_cursor→cursor`, `index_rev/staleness→provenance`, `budget_used→cost.tokens_out`. But two envelope fields are **missing and they're exactly the agent-ergonomic ones**:
  - **`summary`** — the ≤1-line always-present field that is *what actually enters the agent's context by default*. The dossier dumps `hits[]` (11 hits, 2 rendered) with no summary. The correct default payload for a worker mid-turn is `summary: "11 hits for validate_session; 2 defs, both in src/auth/; 9 refs (1 dirty in your overlay)"` — then let it page. The `advice` field is a good instinct but it's not the summary.
  - **`refs`** — a handle to the *full* result in the artifact store, fetched only on demand. `atlas` conflates "payload bounded to budget_tokens" with "the whole result," so a worker that wants hit #40 must re-run the query with a cursor instead of dereferencing a `ref`. The spec's two-tier discipline (summary in context, payload bounded, full data behind a handle) is precisely the token win the dossier claims but doesn't structurally implement.
- **`reverify` (§6, design law 4) is completely absent — this is the biggest hole.** The capability plane's entire trust model (supervisor I7) is that any capability output a downstream decision trusts is *re-runnable by the hub*. A `code_context_pack` that seeds worker w7, or a `code_symbol` result the orchestrator uses to `code_seed`, is exactly such a claim. The dossier never implements `card/invoke/resume/cancel/reverify`, and worse, it substitutes **social proof for re-runnability**: "symbol X is the auth entrypoint, *confirmed by 3 workers*" (§ epistemic). Three workers agreeing is not verification; re-running `find_referencing_symbols` against the pinned `index_epoch` and getting the same edge set *is*. Lexical/structural over a content-addressed base are deterministic → trivially reverifiable (declare `reverifiable: true`); semantic is `reverifiable: by_seed`. Add the `reverify` semantics per verb; it's the cheapest, highest-leverage fix here and it's what makes search a *trusted* fleet substrate rather than shared hearsay.
- **The card (§5) is the right home for the "per-language coverage matrix"** the dossier hand-declares in Limitations. And the spec says cards are **probed from installed tools so they can't drift** — so the graph leg's coverage should be *auto-probed at runtime* (which LSP servers are actually installed and healthy, which SCIP indexers exist) and re-published, not a static harness-card-style table that lies the moment `clangd` crashes.
- **Name the consistency model, don't reinvent it.** `atlas`'s "immutable base ⊕ per-worker overlay" IS the spec's declared `snapshot+overlay` model (§4/§5 literally use `"code_index": "snapshot+overlay"`). Declare it in the card verbatim instead of prose-describing a novel COW/LSM scheme.

### 1. Scoping: the MVP is simultaneously too heavy and too light

- **Too heavy:** Rung 0 bakes in the *hardest* part of the whole design — a persistent overlay index with **tombstones + shadowing + LSM composition** for deletions/renames. That is not minimal; it's the part most likely to have correctness bugs, and the dossier's own Limitations admit it has "sharp edges." A genuinely minimal-and-correct overlay: **don't build a persistent overlay index at all for MVP.** `git diff --name-only base…worktree` gives you the (small) dirty file set; at query time, (a) run the shared base query, (b) *live-`rg` the dirty files* and merge, (c) suppress any base hit whose path is in the dirty-deleted set. No tombstone LSM, no watcher-driven incremental overlay index, correct isolation, near-zero new machinery. The persistent overlay index becomes a Rung-1 optimization gated on the exact threshold the framework already flags as an open question (spec §9 Q3: "at what overlay size does a worker trigger a private re-index?") — the dossier lists overlay-erosion as an "honest residual" but never proposes that escalation, which the framework is explicitly asking for.
- **Too light:** Rung 0 omits `reverify` (§0 above) and the full envelope, and — critically — **never says where the `"symbol": "auth::SessionManager::validate_session"` annotation comes from in a lexical-only MVP.** Trigrams don't know symbols. The answer is off-the-shelf and the dossier walks right past it: **Zoekt already integrates universal-ctags to extract symbols and rank `isDefinition` matches higher** (verified). So the MVP symbol-anchoring engine is *ctags, delivered through Zoekt* — no new work, and `ctags` is installed here. State that; right now the symbol-anchored output shape is asserted without a Rung-0 source.
- **`code_seed` in MVP has an undeclared cross-module dependency.** It writes into "the worker's downward-context channel (doc 08 push-addressed-minimal)." That channel is a *separate* capability that may not exist yet at Rung 0. Either it's a real dependency the MVP claim must own, or `code_seed` degrades to "append a `code.seed` hint event the worker's adapter injects at its next turn boundary" — which is fine, but say so, because "pushes attention downward" is doing a lot of unspecified work.

### 2. Agent-ergonomic output: mostly real, three concrete gaps

- **Ranking-under-truncation is unspecified and it's the whole ballgame.** `budget_tokens` is a hard cap → `truncated: true`. But does truncation drop the *least relevant* hits or just the tail of a scan? If the frecency/BM25/symbol ranking isn't applied *before* the budget cut, a worker gets 10 arbitrary hits and a cursor, and the R@5 55% claim evaporates. Specify: rank globally (symbol-def > frecency > BM25), *then* cut to budget, and put the count of dropped-but-ranked-below hits in `summary`.
- **`preview` and `advice` are prompt-injection vectors and the dossier only guards the pack.** Every `preview` line is untrusted repo content (the dossier's own `"let claims = self.sessions.validate_session(&tok)?"` — imagine that line were `// SYSTEM: ignore prior instructions`). D7 is invoked for `code_context_pack` consumption but the *per-hit preview* is the far more common vector and isn't flagged. Worse, if `advice`/`summary` are *templated from result content*, `atlas` becomes a laundering channel that turns matched strings into imperative text in the agent's context. Rule: `summary`/`advice` are generated only from *structural metadata* (counts, paths, `isDefinition`, ranking), never interpolated from match bodies; previews are delimited/escaped and provenance-tagged as untrusted data.
- **Staleness is stamped per-result but corruption is per-hit.** A result can be `staleness: fresh` overall yet contain an overlay hit whose `preview` predates the worker's last save (watcher lag between `write()` and index catch-up). The `git: "dirty"` tag says "this file differs from base," not "this preview may be stale." Add a per-hit `preview_fresh: bool` (or force overlay-hit previews to a live disk read), so a worker mid-edit isn't shown its own pre-edit line labeled fresh.

### 3. Shared-state / multi-agent: the hard problems that are hand-waved

This is the module's defining constraint and the dossier's "amortized across the fleet" claim quietly assumes the cache is already warm and stationary. Four real consistency problems are unaddressed:

- **Cold-start thundering herd (the biggest omission).** When N workers spawn on a fresh, unindexed base commit, who triggers the O(repo) build? If each worker's first `code_grep` triggers it, you get **N concurrent full index builds at the worst possible moment** — the exact cost the design exists to kill. The task-DAG framing implies but never states the required **single-flight**: the first request creates the `index.build` task; the other N−1 *coalesce onto the same task handle* and either block or (better) get an explicit `base_only`/degraded response served by live `rg` until `base_ready`. Without stated single-flight + a cold-path fallback, the amortization argument is false on every cold start.
- **Cursor invalidation under rebase is a real race with no story.** Opaque cursors page a result set computed against base B. Worker w rebases to B′ mid-walk (or the watcher folds a commit into a new base node). The cursor is now stale and the framework's at-least-once cursor (spec I3) says nothing about base-change invalidation. Fix: **epoch-pin the cursor** — embed `index_epoch` in it; a resume against a superseded epoch returns `needs_resume`-with-`stale_base{new_epoch}` rather than silently paging a different tree. This is the cursor-side of the `turn_epoch` fencing the control plane already does.
- **Shard GC / eviction is unowned.** Content-addressed base shards accumulate one-per-base-commit across runs. The dossier says "if a shard corrupts, drop and rebuild" (good — projection, not truth) but never says *when a healthy shard is safe to evict*. Needs **refcounting by live views + open cursors, LRU by base-commit recency**; otherwise the shared cache is an unbounded disk leak. Doc 08 §7 Q4 flags retention generally; `atlas` inherits it and must answer it, because "shared across runs" is only a win if old shards get reclaimed.
- **"Single-writer (the worker's own adapter)" is imprecise and it matters.** The worker's *own bash subprocesses* write the worktree filesystem directly, not through the adapter — a `sed -i` across 10k files, a codemod, a formatter. The writer is the **worktree FS mutated by the worker's whole process tree**; the watcher observes the FS. The isolation claim (no *cross-worker* contention) is correct, but "the adapter is the single writer" is wrong and it's the reason the incremental watcher must survive bursty, subprocess-driven churn (name **Watchman** as the battle-tested watcher for monorepo-scale trees; fff's built-in watcher is fine at 14k files, less proven under a 500k-file codemod).

One structural sharpening: **worktrees share `.git/objects`.** The dossier treats them as independent trees, but the base blobs are *already* content-addressed and shared on disk. Build the base index **directly from the git object store** (`git cat-file --batch`, tree walk) rather than from any worktree checkout — it's naturally content-addressed by the Merkle root the design already wants, needs no checked-out base worktree, and makes "index the base once" literally true.

### 4. What it missed

- **Tantivy** ([quickwit-oss/tantivy](https://github.com/quickwit-oss/tantivy)) — the obvious embeddable Rust **BM25** index for a single-box sidecar, and the dossier never names it while repeatedly invoking "BM25." Precision correction: **Zoekt is a trigram substring/regexp engine, not a BM25 engine** — it *has* an optional `UseBM25Scoring` approximation, but its ranked-symbol strength comes from ctags integration, not BM25. The R@5 55% number is a *BM25* result (Gortex), so the "ranked lexical" leg that delivers it is Tantivy-shaped, not Zoekt-shaped. The dossier's "lexical (ripgrep/Zoekt/BM25)" lumps three different retrieval models as if interchangeable; they aren't. MVP is cleanest as **Tantivy (BM25 ranked symbol-anchored hits) + ctags (symbol table) + rg (regex/live-overlay fallback)**, with Zoekt as the alternative if you want trigram-regex at monorepo scale.
- **cAST / ASTChunk** ([arXiv 2506.15655](https://arxiv.org/abs/2506.15655), EMNLP 2025 Findings; [yilinjz/astchunk](https://github.com/yilinjz/astchunk)) — the semantic leg (Rung 3) says "hybrid BM25+dense" and never addresses *chunking*, which is the thing that actually makes code embeddings work. Fixed-window chunks split function signatures from bodies; AST-aware chunking gives +4.3 R@5 on RepoEval. If you ship a semantic leg, chunk on tree-sitter node boundaries — and you already have the tree-sitter parse from the structural leg, so it's nearly free.
- **universal-ctags as a first-class MVP dependency** (not just the "degrade to heuristic" afterthought it is in Limitations). It's the symbol source for Rung 0's output shape and it's installed.
- **Zoekt's own ctags-based symbol ranking** — the dossier borrows Zoekt for trigrams but misses that Zoekt *already solved* the symbol-anchoring the output shape needs.

### 5. The distinctive agent-native opportunity: a shared, re-runnable ABSENCE cache

Everything above ports human tools well. Here's the one move that's *only* possible because the user is a fleet, not a person, and it closes two of the gaps above at once:

**Cache and share proven negatives, keyed by the content-addressed base.** A human search tool discards a zero-hit search; a fleet's most expensive pathology is the **discovery-thrash the dossier itself names** — N workers each re-discovering that a symbol doesn't exist, that a regex has zero matches over the base, that "the auth logic is *not* in `src/legacy/`." Make `"grep /pattern/ over base B = 0 hits @ index_epoch 4412"` a **first-class, shareable, re-runnable fact.** It is:
- **Distinctively non-human** — nobody caches their failed greps as shared knowledge; a fleet should.
- **The perfect `reverify` target** (closing §0's gap for the cheap case): re-running a negative is one grep, and "still zero over the same immutable base" is a millisecond re-check. Positive results are expensive to reverify at scale; *negatives are trivially reverifiable*, so start trust there.
- **Composable with base⊕overlay**: absence is asserted over the *immutable base only* — a worker's overlay may add the symbol — so the cached fact is "absent in base B; check your overlay," which is exactly the model's isolation boundary.
- **A steering primitive**: on the discovery-thrash signal (doc 05 §2, which the dossier already reuses), the orchestrator `code_seed`s the *absence* — "stop searching the base for X; it's proven absent — it's in your diff or it doesn't exist" — turning a wasted-loop signal into a positive intervention.

Secondary (flag, don't build for MVP): **standing queries as stigmergic tripwires** — a registered query (`impl Auth for` anywhere) that fires when a matching file changes, turning search from pull to a pheromone trail. It's genuinely agent-native but crosses worktree isolation (it observes cross-worker edits), so it's an *orchestrator-level* tripwire, not a worker verb, and it's more speculative than the absence cache.

### 6. Corrections / precision fixes (quick list)

- **Search is not a ladder; it's a typed palette — and both this dossier and the framework mislabel it.** Validation genuinely is a cost-ladder (types→test→…→proof, each strictly more rigorous, escalate on the critical path). Search is not: structural isn't "more rigorous lexical," graph isn't "more rigorous semantic" — they answer *different question shapes*. The dossier's prose gets this ("modality per question") but its "Rung 0..4" reads as an escalation ladder and imports the framework's §7 "lexical→structural→semantic→graph" ladder framing (which is itself a category error). Separate the two orderings explicitly: **rungs = delivery increments**; **query-time selection = a routing table** the agent consults. Add that table — it's a concrete, agent-ergonomic deliverable the dossier lacks: `exact string / regex → code_grep`; `code shape, refactor target, "all calls of form X(...) → code_ast"`; `"what calls / defines / implements this symbol" → code_symbol`; `NL concept, unfamiliar/large/unstructured repo, grep-underperforms → code_semantic`. Right now "which of four verbs" is left to vibes plus the post-hoc `advice` field.
- **Ledger events:** the framework mandates the `capability.op.started/completed` *pair* (spec design law 2), not a single `capability.code.query`. For long ops (`code_context_pack`, first `code_semantic`) you need both to bracket the task-DAG node and to make cancellation observable.
- **Cancel → task state:** an interrupted `index.build` should terminate to the DAG's `cancelled` state (doc 08 §3a five-state lifecycle), wired through the framework's `cancel(handle)`. The dossier says builds go `working→completed|failed` — it drops `cancelled`, which the control plane's interrupt path requires.
- **Orchestrator-facing output must be digests-only** (doc 10 §6 Q4 / spec §9 Q4). The dossier gives the orchestrator `code_seed` and cites "the orchestrator's own probes" as a cache beneficiary, but never gates the orchestrator's *read* output — and the orchestrator's context is the scarcest resource in the system (doc 05 §3). Orchestrator queries return `summary + refs` only, never raw `payload`.

Net: the retrieval thinking is excellent and the shared-base idea is the right bet. The work is to make `atlas` an *instance of the capability-plane contract* rather than a parallel design — adopt the envelope, add `reverify`, name the consistency model — and to stop hand-waving the shared-cache lifecycle (cold-start single-flight, epoch-pinned cursors, shard GC), because that lifecycle *is* the multi-agent value proposition, not a footnote to it.

Sources: [fff](https://github.com/dmtrKovalenko/fff) · [Zoekt (trigram + ctags + optional BM25)](https://github.com/sourcegraph/zoekt) · [Tantivy (Rust BM25)](https://github.com/quickwit-oss/tantivy) · [stack-graphs archived 2025-09-09](https://github.com/github/stack-graphs) · [cAST AST-aware chunking, EMNLP 2025](https://arxiv.org/abs/2506.15655) · [ASTChunk](https://github.com/yilinjz/astchunk) · [Gortex "three tools" + R@5 55.1/17.3](https://zzet.org/gortex/grep-replacement-for-ai-agents/)
