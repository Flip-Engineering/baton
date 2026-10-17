# Knowledge graph audit #779: current Bend2 against project-manager and retrieval research

Date: 2026-10-17.

Source pin: `knowledge-deepseek-782-785` at `69558f7`, base `dd62ce8`.

Measured behavior: retained Main9 binary at
`/mnt/nvme4tb/ci-runners/baton2-native-homelab/retained/baton-knowledge-730-746-main9-20261016/knowledge-context/bin/baton2`.
Its `bend2/src/coordinator/knowledge.bend` sha256 is
`1a7d4a0d652f4bd6f9797fbfd7498467cefed6d13331e0a7b1e72fc192802b5d`, equal to
`dd62ce8`. The measurements therefore describe the deployed source, not the
`69558f7` candidate.

Status: source comparison, measured surface behavior and research assessment.
No `69558f7` build exists. No recall, precision or latency benchmark exists.

## Current Bend2 surface

| Operation | Source | Algorithm | Visibility |
|---|---|---|---|
| `knowledge read`, `knowledge-scope` | `knowledge.bend:101-205` | SQL projection over `knowledge`, `knowledge_promotions`, `knowledge_relations` | Reader session plus author/promotion holders; `worker`, `group`, `universal`, `all` |
| `knowledge search` | `knowledge.bend:221-236` | Space-split terms joined by `AND`; each term matched by `instr(lower(field),lower(term))` over id, kind, claim, evidence, limits and retained message body. Score: exact id 100, claim substring 30, kind exact 10, plus incident edge count | Same as read |
| `knowledge traverse` | `knowledge.bend:209-262` | Recursive CTE over authored relations plus derived `citation:` edges. Direction `in`, `out`, `both`; relation names normalized by removing `_` and `-`; recursive mode terminates through SQLite `UNION` deduplication | Same as read |
| `knowledge relations` | `knowledge.bend:65-69,129-141` | Relation projection with source/target reference normalization and stored or external kind | Same as read |
| `knowledge record`, `relate`, `promote` | `knowledge.bend:299-415` | Authored finding, relation and promotion rows; notices to the parent or destination owner | Author must be a registered session; promotion requires the destination owner |
| MCP surfaces | `mcp-conductor.mjs:501-545` | `baton2_knowledge`, `baton2_knowledge_relations`, `baton2_knowledge_search`, `baton2_knowledge_traverse` forward to the same coordinator commands | Scope and direction enums match the coordinator contract |

## Project-manager comparison

| PM surface | PM behavior (`pm-digest`) | Bend2 state | Verdict | Action |
|---|---|---|---|---|
| `pm_search` | FTS5 text match with composite text 1.0, evidence 0.2, recency 0.3 (`v6-cognitive-augmentation-scope.md` §7, §9) | Lexical `AND` over six fields; exact-id, claim and kind weights plus incident edge count (`knowledge.bend:221-228`) | ADAPT | Add term statistics and evidence/recency terms to the existing SQL score under deployment-owned weights. Keep one SQLite store. |
| `pm_query` | Search, rank, top 3 results with graph neighbors | Search returns every match, typed nodes, edges and references (`knowledge.bend:234-236`) | ADAPT | Add a compact grouped result for agent briefs. The graph data already exists in the response. |
| `pm_context` | Topic search grouped by node type, 1-hop neighbor expansion, cross-references | Search plus explicit traversal; no grouped projection (`knowledge.bend:234-262`) | ADAPT | Add a read projection that groups nodes by `kind` and includes typed 1-hop neighbors. |
| `pm_kg_traverse` | Single-hop and BFS multi-hop with depth, edge filter and bidirectionality (`src_kg_traversal.rs`) | Recursive CTE with direction and relation filters; no depth, path or proximity metadata (`knowledge.bend:239-262`) | ADAPT | Add an optional depth bound and path metadata to the response. Preserve cycle termination. |
| `pm_kg_audit` | Six-axis health score 0-100, including causal backbone, hypothesis coverage, literature utilization, edge density and temporal coherence | No audit surface | ADAPT the checks, reject the score | Add deterministic structural checks with named counts: unattached nodes, dangling citations, unresolved contradictions, empty evidence. A single aggregate score hides its reasons. |
| `pm_orphan_repair` | Finds orphaned nodes, decisions without upstream, cross-project bleed, missing phase assignments; returns repair actions | No orphan report | ADAPT the report, reject auto-repair | Add a read-only orphan and unattached-node report. Mutations remain explicit knowledge writes. |
| `pm_since` | Delta by ISO date or session | No delta surface | ADAPT | Add a delta read keyed to durable rowid or event sequence. Do not add wall-clock controls. |
| `pm_set_belief`, `pm_set_confidence` | Stored `belief_status` and `confidence` columns; MAD confidence from finding text | Authored relation rows with no validity or confidence fields (`knowledge.bend:18-20`) | DEFER | #710 owns structured edge provenance and uncertainty. Add fields there rather than a mutable belief scalar. |
| FTS5 | FTS5 virtual tables over seven node kinds | No FTS5; search reads the existing tables | REJECT | A second index is a second truth. Score the existing rows. |

## Research assessment

| Source | Finding | Applicability |
|---|---|---|
| Robertson and Zaragoza, *The Probabilistic Relevance Framework: BM25 and Beyond* (2009), https://dl.acm.org/doi/10.1561/1500000019 | Term frequency, inverse document frequency and document-length normalization produce a strong lexical ranking baseline. | Applicable to `search_score`. The current score has no term frequency, document length or collection statistics. A SQL BM25 implementation over the six searched fields fits the existing store. |
| Haveliwala, *Topic-Sensitive PageRank* (2002), https://dl.acm.org/doi/10.1145/511446.511513 | Query-specific PageRank biases the graph walk toward topic-relevant nodes. | Applicable to traversal ranking. The current recursive traversal returns a reachable set with no node rank. A bounded personalization vector over the same edge table supplies a rank without a new store. |
| Edge et al., *From Local to Global: A Graph RAG Approach to Query-Focused Summarization* (2024), https://arxiv.org/abs/2404.16130 | Local entity neighborhoods serve local queries; community summaries serve global queries. | The local-neighborhood shape applies to `pm_context`-style reads. Global community summaries introduce derived text, freshness and cost. Defer until a measured global-query workload exists. |
| Gutiérrez et al., *HippoRAG* (2024), https://arxiv.org/abs/2405.14831 | Personalized PageRank over a knowledge graph supports single-step multi-hop retrieval and matches iterative retrieval at lower cost. | Applicable to multi-hop traversal ranking. The current relation graph already has the required directed edges. Measure PPR against the current reachable-set read before adding it. |
| Trivedi et al., *IRCoT* (2023), https://aclanthology.org/2023.acl-long.557/ | Interleaving retrieval with chain-of-thought steps improves multi-step question answering. | Applies to a consumer loop, not to the storage read. Keep retrieval operations explicit; the agent decides when to call them. |
| PROV-AGENT, https://arxiv.org/abs/2508.02866, and Zep/Graphiti, https://arxiv.org/abs/2501.13956 | Agent provenance needs decision, tool, model and cross-agent chains; temporal graph edges carry validity and ingestion time. | #710 owns the structured edge model. The current relation row stores id, author, source, relation and target only. |

## Measured behavior

Fixture: sessions `root` (principal conductor), `worker` and `sibling`; findings
`r-alpha` (`alpha beta probes`), `r-alpha-only` (`alpha only`) and `r-beta-only`
(`beta only`); relations `e1` (`r-alpha Supports r-alpha-only`), `e2`
(`r-alpha-only Supports r-beta-only`), `e3` (`r-beta-only Supports r-alpha`).

| Command | Result |
|---|---|
| `knowledge-search root all "" "alpha beta"` | Roots `finding:r-alpha` only. All terms must match. |
| `knowledge-search root all "" "alpha"` | Roots `finding:r-alpha`, `finding:r-alpha-only`. |
| `knowledge-search root all "" "probe"` and `..."probes"` | Both return `finding:r-alpha`. Matching is substring based; there is no stemming distinction. |
| `knowledge-search root all "" "r-alpha"` | `r-alpha` scores 100; `r-alpha-only` scores 0 because the id field contains the query string. A zero-score match remains in the result. |
| `knowledge-traverse root all "" finding:r-alpha both "" recursive` | Returns `r-alpha`, `r-alpha-only`, `r-beta-only` and edges `e1`, `e2`, `e3`; the `e3` cycle terminates. No depth or path field is present. |
| `knowledge-traverse ... supports neighbors` and `... support_s neighbors` | Both match relation `Supports`. |
| `knowledge-scope` worker/universal/all | Worker sees `r-beta-only`; universal sees the two root findings; all sees all three. |
| `knowledge-traverse` on a `run:` evidence finding | No `citation:` edge and no reference. |
| `knowledge-traverse` on a `message:` evidence finding | `citation:<id>` edge with relation `Cited` and a `message:` reference with `deliveryRead`. |
| `knowledge-audit`, `knowledge-since` | Unknown verbs; the CLI prints general help. No audit or delta surface exists. |

## Gaps and ownership

| Gap | Evidence | Owner and next action |
|---|---|---|
| Scope and direction validation | #783; source now matches the preserved 93221d663 function bodies | `knowledge-deepseek`; remote 214-case candidate arm at `69558f7` |
| Relation collision provenance | #785; source now matches the preserved f77cc16d function bodies | `knowledge-deepseek`; remote 36-case candidate arm at `69558f7` |
| Law gate and stale laws | #782; `check-native.sh:14` runs `laws.bend --check-only`; retained law-gate candidate fails at `messaging-laws.ensemble_creation_defaults_to_loose` | `knowledge-glm` owns the critic branch; no execution attempt. Next action: correct the law chain, wire evaluation, add focused laws for the new refusals and collision admission |
| Structured causal and evidentiary edges | #710; `knowledge_relations` has five columns | Root owns the model. PPR and edge-weighted ranking depend on these edge weights |
| Numeric precision in scientific reads | #711; retained diagnostic rounds `9007199254740993` and `0.123456789012345678901234567890` | Root owns the product correction |
| Deliberate scratchpad operations | #724; no CLI or MCP scratchpad operation | Separate owner; no source change here |
| Evidence inference from retained reports | #730; record requires an explicit `message:` ID | Separate owner |
| Consumer reads of promoted root holdings | #746; driver uses the unqualified read | Separate owner; needs the final installed candidate |
| Commit-and-cite context passing | #777; no cross-seat context value surface | Release/context owner |
| Retrieval quality benchmark | No recall/precision, ranking or latency fixture exists for the current search and traversal | This audit; next action: build a representative fixture and measure before changing scoring |

## Limits

- The measured binary is the retained Main9 production binary with the
  `dd62ce8` knowledge source. It is not the `69558f7` candidate.
- The comparison uses the retained `pm-digest` source and the cited papers. No
  project-manager runtime was available.
- No recall, precision, ranking, multi-hop quality or latency measurement exists
  yet. The recommendations above are source and research assessments.
- The audit does not change #784 evidence handling or the frozen #784 packet.
