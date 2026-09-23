# Suitability of proposed laws as Baton2 contracts

Review date: 2026-09-21. This is an independent first-pass suitability assessment of all 138 revision-3 candidates. It applies the operator's clarification that the first question is whether a rule deserves to bind Baton2 development at all. A technically enforceable rule can still be a poor contract.

No row is approved here. The operator retains approval authority. The companion `codex-context-and-review-r3.md` records the source pin, language experiments, technical findings and review limits.

## Admission test for a law

Before working on its Bend encoding, ask:

1. What user-visible or authority-preserving guarantee does the rule establish? Name a concrete failure it prevents.
2. Why should it remain true across valid changes to storage, protocols, scheduling, provider adapters and deployment topology?
3. Does it state only the necessary restriction? Construct a useful alternative design that violates its wording; if that design meets the intended guarantee, the wording is too restrictive.
4. Are its scope, premises and authorized exceptional transitions explicit? Cancellation, recovery and operator-directed changes must have coherent semantics.
5. Can it be satisfied trivially while the intended guarantee fails? A system that never lands anything satisfies several safety rules while failing Baton's purpose.
6. Is it consistent with the other accepted contracts and later operator rulings?
7. Can the approved guarantee be connected to the implementation, proof command and external effect assumptions without silently weakening it?

A candidate must pass these questions before a proof mechanism makes it worth adopting. A current runtime check, a passing test, a historical incident or a convenient Bend type is insufficient justification by itself.

## Classes

- **Candidate:** the underlying guarantee appears suitable for a durable contract. This is a provisional judgment about purpose, not approval of the row's exact wording or its claimed proof.
- **Split:** the row combines a useful guarantee with policy, implementation detail, missing scope or unrelated promises. Extract and assess the components separately.
- **Policy:** a product, deployment or development choice that needs independent justification before being made inviolable. A policy can be important and operator-mandated without belonging in `laws.bend`.
- **Implementation:** a representation, algorithm, storage layout or code-organization choice. Preserve its necessary behavior without freezing this mechanism.
- **Retire:** the proposed behavior conflicts with a later explicit operator ruling.
- **Evidence task:** missing tests or other validation work; assess the rule those tests would support separately.

These classes address the justification supplied in this draft. A chosen product policy can be an appropriate Bend law: the upstream game intentionally makes winning impossible. The operator can choose such a permanent commitment after considering its consequences. Conversely, a behavioral contract can be proved as a quantified theorem over implementation functions even if an ordinary data constructor permits irrelevant malformed values. Neither policy status nor the failure of the proposed carrier settles the law's suitability by itself.

First-pass counts: 38 Candidate, 46 Split, 29 Policy, 20 Implementation, one Retire, four Evidence task. See [the language examples and technical review](codex-context-and-review-r3.md) and [six independent proposals](codex-own-law-proposals.md).

## Assessment

| Candidate | First-pass class | Reason and necessary scope |
| --- | --- | --- |
| [CUST-1](laws-proposed-r3.md#L46) | Candidate | Preserve assigned work until custody is explicitly settled; bind this to real holders and retained content. |
| [CUST-2](laws-proposed-r3.md#L61) | Candidate | Closing a workspace must exclude new users of that same workspace generation. |
| [CUST-3](laws-proposed-r3.md#L75) | Split | Authoritative custody is necessary; a particular live-handle registry is an implementation choice and must include unfinished cleanup. |
| [CUST-4](laws-proposed-r3.md#L92) | Candidate | Destruction must preserve uncaptured work and live holders; a stale observation cannot authorize deletion. |
| [CUST-5](laws-proposed-r3.md#L109) | Candidate | An ordinary caller flag must not bypass preservation; define any separately authorized disposal action explicitly. |
| [CUST-6](laws-proposed-r3.md#L122) | Split | Require evidence that disposal is safe; the specific metadata, root-path and Git-untracked mechanisms can change. |
| [CUST-7](laws-proposed-r3.md#L139) | Split | Protect unowned user workspaces; making one Git folder name permanently special needs a separate product justification. |
| [CUST-8](laws-proposed-r3.md#L150) | Candidate | A custody/status observation must not manufacture authorship or approval evidence. |
| [CUST-9](laws-proposed-r3.md#L163) | Implementation | Shared Git refs and object storage are a workspace implementation; independent clones or snapshots may preserve all required behavior. |
| [CUST-10](laws-proposed-r3.md#L177) | Implementation | Moving a lane branch before removal is one preservation method; pinning an immutable artifact can serve the same purpose. |
| [CUST-11](laws-proposed-r3.md#L192) | Split | Effects require established custody; atomic receipt-file publication and reconciliation are particular mechanisms. |
| [CUST-12](laws-proposed-r3.md#L211) | Implementation | Consumers must agree on custody; a single function is a maintainability choice, not the behavioral contract. |
| [CAP-1](laws-proposed-r3.md#L228) | Split | Physical constraints need honest derivation; a particular threshold formula or opaque wrapper is not a permanent guarantee. |
| [CAP-2](laws-proposed-r3.md#L241) | Candidate | Do not reject agent work based on an arbitrary worker-slot or load threshold; expose actual resource conditions separately. |
| [CAP-3](laws-proposed-r3.md#L254) | Split | Durable pending work must survive waiting; strict FIFO is a scheduling policy that can conflict with priorities and feasibility. |
| [CAP-4](laws-proposed-r3.md#L271) | Policy | Budgeting only full suites is a workload policy; the current formula also does not measure actual suite cost. |
| [CAP-5](laws-proposed-r3.md#L282) | Policy | Proceeding without a lease on an undersized host is a chosen fallback, not a universal resource-safety contract. |
| [CAP-6](laws-proposed-r3.md#L297) | Split | Reclaim only after ownership is established to have ended; prove the process/resource relationship rather than only PID death. |
| [CAP-7](laws-proposed-r3.md#L310) | Candidate | A release must affect only the exact authority and resource instance it was issued for. |
| [CAP-8](laws-proposed-r3.md#L323) | Split | Closed record shapes can support valid construction; an arbitrary serialized-size cutoff conflicts with the later mandate. |
| [CAP-9](laws-proposed-r3.md#L338) | Implementation | Accurate liveness matters; sweeping dead entries during a read is one housekeeping design. |
| [CAP-10](laws-proposed-r3.md#L352) | Policy | One shed lease per exhaustion episode is a recovery policy; a different workload may require a different response. |
| [CAP-11](laws-proposed-r3.md#L364) | Policy | Parallel width, load thresholds and environment overrides are tunable scheduling decisions. |
| [CAP-12](laws-proposed-r3.md#L377) | Split | A child must not forge delegated resource authority; parent-token digest representation and transfer topology are mechanisms. |
| [CAP-13](laws-proposed-r3.md#L389) | Split | Preserve exclusive accounting and valid ownership; HMAC files, private roots and lock publication are replaceable mechanisms. |
| [CAP-14](laws-proposed-r3.md#L408) | Candidate | A stale reservation token must never release a newer reservation that reused an identifier. |
| [CAP-15](laws-proposed-r3.md#L422) | Split | Preserve an ambiguous or live owner's state; remove the deadline-as-terminal-cutoff component under the later ruling. |
| [CAP-16](laws-proposed-r3.md#L439) | Implementation | Equivalent pressure decisions matter; requiring one named predicate unnecessarily freezes code organization. |
| [CAP-17](laws-proposed-r3.md#L453) | Policy | A configurable worker ceiling still needs justification against the operator's no-cutoff rule; configuration alone is insufficient. |
| [WAKE-1](laws-proposed-r3.md#L470) | Split | Every relevant event needs a defined delivery meaning; exactly one class per row is a classification design. |
| [WAKE-2](laws-proposed-r3.md#L483) | Policy | Filter aliases and vocabulary belong to a versioned interface; keep malformed-filter handling explicit. |
| [WAKE-3](laws-proposed-r3.md#L497) | Candidate | Preserve ordered, complete cursor resumption across the declared history and delivery scope. |
| [WAKE-4](laws-proposed-r3.md#L511) | Policy | Starting at head is a subscription default; a first participant may instead need history from swarm creation. |
| [WAKE-5](laws-proposed-r3.md#L521) | Retire | Dropping recorded wake events past a buffer is explicitly rejected by the later issue-541 ruling. |
| [WAKE-6](laws-proposed-r3.md#L534) | Policy | Attach-time baseline and crossing behavior are per-signal subscription semantics, not universal orchestration requirements. |
| [WAKE-7](laws-proposed-r3.md#L547) | Policy | Transport close vocabularies and fallback mappings can evolve; retain truthful error classification. |
| [WAKE-8](laws-proposed-r3.md#L562) | Split | Deliver all subscribed, authorized events, including future groups where requested; one deployment-wide feed is a topology choice. |
| [WAKE-9](laws-proposed-r3.md#L575) | Policy | Metadata-only wakes add a retrieval dependency; including relevant content can be a valid later design. |
| [WAKE-10](laws-proposed-r3.md#L590) | Implementation | Parking on one ledger primitive is one push implementation; review actual delivery and progress guarantees. |
| [WAKE-11](laws-proposed-r3.md#L604) | Policy | Commit-header cadence and fallback values are observation policy. |
| [WAKE-12](laws-proposed-r3.md#L618) | Split | Continuation must preserve all remaining work; a particular page ceiling needs physical derivation and must not truncate history. |
| [WAKE-13](laws-proposed-r3.md#L632) | Implementation | WebSocket masking and close codes belong to transport conformance; Baton2 may use other transports. |
| [PROP-1](laws-proposed-r3.md#L648) | Split | Bound working memory while processing the whole history; a read-window interface is a design choice. |
| [PROP-2](laws-proposed-r3.md#L662) | Candidate | Every history admitted under a declared schema/version must have a defined replay result under that contract. |
| [PROP-3](laws-proposed-r3.md#L674) | Split | Require one coherent ordering authority; serializable multi-writer implementations need not be forbidden by an OS-writer count. |
| [LEDG-1](laws-proposed-r3.md#L690) | Split | Preserve accepted event history and order; one-based contiguous indices are a storage representation. |
| [LEDG-2](laws-proposed-r3.md#L704) | Split | Detect corrupted durable input and report it; UTF-8 and trailing newlines are codec-specific choices. |
| [LEDG-3](laws-proposed-r3.md#L718) | Candidate | A retry under the same operation identity must preserve its original disposition and must not duplicate the effect. |
| [LEDG-4](laws-proposed-r3.md#L732) | Candidate | An obsolete writer authority must not append after its generation loses ownership. |
| [LEDG-5](laws-proposed-r3.md#L746) | Implementation | Short-lived claim receipts are one exclusion protocol; alternative transactional storage can enforce ownership. |
| [LEDG-6](laws-proposed-r3.md#L760) | Split | Do not claim durability after failed persistence; flush-before-release is one implementation of safe completion. |
| [LEDG-7](laws-proposed-r3.md#L774) | Split | A failed projection must not become trusted state or destroy source history; restarting does not by itself repair every fault. |
| [LEDG-8](laws-proposed-r3.md#L787) | Split | Expose replay failures with actionable provenance; exact startup codes and record fields are versioned protocol decisions. |
| [LEDG-9](laws-proposed-r3.md#L801) | Implementation | Preserving corruption evidence matters; temporary files, rename and private-mode quarantine are one implementation. |
| [LEDG-10](laws-proposed-r3.md#L814) | Split | Compaction must preserve the accepted logical history; content-addressed segments and a particular rewrite order are mechanisms. |
| [LEDG-11](laws-proposed-r3.md#L832) | Implementation | Checkpoint coalescing and off-request scheduling are performance choices; checkpoints must remain derived state. |
| [LEDG-12](laws-proposed-r3.md#L847) | Split | Do not expose partially established authority; one shared sync/async open path is a code-organization choice. |
| [LEDG-13](laws-proposed-r3.md#L861) | Split | References must resolve consistently within an identified history; grammar tables and null-on-failure are interface choices. |
| [LEDG-14](laws-proposed-r3.md#L875) | Implementation | A 256-row clone-free reverse window is an algorithm and tuning choice, not an inviolable domain requirement. |
| [LEDG-15](laws-proposed-r3.md#L889) | Candidate | Pure admission/pre-write validation must not mutate the state it is judging. |
| [LEDG-16](laws-proposed-r3.md#L901) | Candidate | Do not authorize writes against state whose required recovery has not established its validity. |
| [LEDG-17](laws-proposed-r3.md#L913) | Candidate | Live admission and replay must agree on accepted transitions at the same schema and state; function identity is optional. |
| [LEDG-18](laws-proposed-r3.md#L927) | Implementation | A second session ledger and its byte format should not be frozen while the target proposes a partitioned journal. |
| [LEDG-19](laws-proposed-r3.md#L941) | Split | Validate cursor identity and range against the relevant history; head-only waiting is a subscription implementation. |
| [CS-01](laws-proposed-r3.md#L960) | Policy | Exactly thirteen caller event kinds would prohibit reviewed protocol growth; constrain construction against a declared version instead. |
| [CS-02](laws-proposed-r3.md#L974) | Split | Schema and event semantics must agree; deriving both from one declaration is a useful mechanism, not the law itself. |
| [CS-03](laws-proposed-r3.md#L989) | Candidate | A decoded command must satisfy its declared versioned argument contract before authority-bearing effects. |
| [CS-04](laws-proposed-r3.md#L1000) | Implementation | Omitting retry keys from two named verbs is one idempotency encoding. |
| [CS-05](laws-proposed-r3.md#L1011) | Split | Malformed inputs need useful structured refusals; a particular message template and table-derived list are presentation choices. |
| [CS-06](laws-proposed-r3.md#L1024) | Candidate | Unvalidated payload fields must not acquire meaning or authority during a state transition. |
| [CS-07](laws-proposed-r3.md#L1036) | Candidate | Required caller data must be established, and server-owned fields must derive from server authority. |
| [CS-08](laws-proposed-r3.md#L1050) | Policy | Text that parses as JSON can be an intentional note or example; automatic rejection needs a narrower boundary justification. |
| [CS-09](laws-proposed-r3.md#L1064) | Policy | Projection names and slicing options are a versioned query API. |
| [CS-10](laws-proposed-r3.md#L1077) | Policy | The exact two-mode vocabulary can evolve; the enduring property is preservation of admitted write authority. |
| [CS-11](laws-proposed-r3.md#L1088) | Policy | The exact two-priority vocabulary is a scheduling interface choice. |
| [CS-12](laws-proposed-r3.md#L1099) | Policy | Status and decision vocabularies evolve; prove their allowed transitions rather than freeze today's lists forever. |
| [CS-13](laws-proposed-r3.md#L1111) | Policy | Forbidding empty policy updates and choosing seven record variants are API choices that need a product reason. |
| [CS-14](laws-proposed-r3.md#L1125) | Policy | Exclusive work-item-versus-path claims are a modeling choice; explain why a combined claim must remain impossible. |
| [CS-15](laws-proposed-r3.md#L1137) | Implementation | A plan with exactly two fields encodes the current API, not the necessary behavior of future planning. |
| [CS-16](laws-proposed-r3.md#L1148) | Split | Every refusal needs a defined, consistent meaning; a single registry and exact code inventory are mechanisms. |
| [CS-17](laws-proposed-r3.md#L1165) | Candidate | A claimed contribution must satisfy the agreed versioned contract and retain useful boundary validation failures. |
| [CS-18](laws-proposed-r3.md#L1181) | Policy | Exactly three report statuses would constrain future reporting features without proving greater correctness. |
| [CS-19](laws-proposed-r3.md#L1191) | Split | Receipts must identify actual inputs, verdicts and effects; the exact nullable fields and hash representation can change. |
| [CS-20](laws-proposed-r3.md#L1206) | Implementation | Schema examples and load-time checks are development tooling; keep them outside the domain-law inventory. |
| [AB-01](laws-proposed-r3.md#L1225) | Implementation | One glob dialect is a selector implementation; other typed scope representations may serve Baton2 better. |
| [AB-02](laws-proposed-r3.md#L1238) | Split | Prevent unintended authority escape; lexical path rules alone do not establish filesystem confinement. |
| [AB-03](laws-proposed-r3.md#L1254) | Split | Claims need unambiguous targets; list representation and path spelling are subordinate design choices. |
| [AB-04](laws-proposed-r3.md#L1265) | Candidate | Exclusive claims on the same resource must not authorize conflicting concurrent mutation without an explicit coordination rule. |
| [AB-05](laws-proposed-r3.md#L1284) | Candidate | A claim must remain bound to the resource instance and authority under which it was established. |
| [AB-06](laws-proposed-r3.md#L1297) | Split | Transfer requires valid authority and a recorded transition; define authorized revocation and dead-holder recovery as well. |
| [AB-07](laws-proposed-r3.md#L1311) | Implementation | Reserved scope rows and identifier prefixes are a recording strategy; retain truthful authority provenance. |
| [AB-08](laws-proposed-r3.md#L1323) | Split | Distinguish declared scope from an exclusive hold; the exact scan exemptions and variants are mechanisms. |
| [AB-09](laws-proposed-r3.md#L1336) | Candidate | A caller must not fabricate another participant's system-issued scope authority; a string prefix is only one encoding. |
| [AB-10](laws-proposed-r3.md#L1349) | Candidate | Nested options must not enlarge the authority admitted by a read-only request. |
| [AB-11](laws-proposed-r3.md#L1361) | Candidate | A read-only result must not claim an authorized change; permit ordinary references to existing commits as evidence. |
| [AB-12](laws-proposed-r3.md#L1375) | Split | Require the intended scope contract for mutation; retire the arbitrary 64-entry cap and justify duplicate rejection separately. |
| [AB-13](laws-proposed-r3.md#L1390) | Split | Authenticate and recheck valid authority at the action boundary; loopback-only transport is a deployment policy. |
| [AB-14](laws-proposed-r3.md#L1406) | Candidate | Principal, scope and provenance must derive from authenticated authority; caller data must not impersonate them. |
| [PM-01](laws-proposed-r3.md#L1423) | Policy | Seven named permissions are today's authorization vocabulary, not a permanent bound on Baton2 capabilities. |
| [PM-02](laws-proposed-r3.md#L1436) | Policy | The default three grants are provisioning policy; different roles may need different defaults. |
| [PM-03](laws-proposed-r3.md#L1450) | Split | Each action must have a defined authority requirement; exactly one permission per event may prohibit valid conjunctions. |
| [PM-04](laws-proposed-r3.md#L1462) | Policy | Specific command-to-permission mappings belong to reviewed policy, not an immutable list of today's verbs. |
| [PM-05](laws-proposed-r3.md#L1473) | Implementation | Advertised and enforced authority must agree; calling one shared function is one way to ensure that. |
| [PM-06](laws-proposed-r3.md#L1487) | Policy | Self-action permission relaxations are policy decisions and require justification per operation. |
| [PM-07](laws-proposed-r3.md#L1501) | Candidate | Participant actions require currently valid membership and authority; model operator authority separately. |
| [PM-08](laws-proposed-r3.md#L1516) | Candidate | Delegation must not manufacture authority the delegator is unable to grant. |
| [PM-09](laws-proposed-r3.md#L1527) | Policy | The current knowledge-verb permission table should be allowed to evolve under a versioned policy contract. |
| [PM-10](laws-proposed-r3.md#L1540) | Split | Independent review is valuable; unequal labels alone do not prove independent authority or execution. |
| [PM-11](laws-proposed-r3.md#L1553) | Candidate | Review attribution must come from the actual authenticated actor and bind the reviewed artifact version. |
| [CL-01](laws-proposed-r3.md#L1571) | Split | Separate reports from notes explicitly; heuristic detection by six particular keys is a compatibility mechanism. |
| [CL-02](laws-proposed-r3.md#L1584) | Candidate | A report must not assert authorship unsupported by the submitting authority. |
| [CL-03](laws-proposed-r3.md#L1596) | Candidate | A claimed delivered revision must resolve to the actual, attributable artifact; bind any repository assumptions explicitly. |
| [CL-04](laws-proposed-r3.md#L1608) | Split | Report uncaptured work truthfully; the particular commit-null stamp and receipt vocabulary can change. |
| [CL-05](laws-proposed-r3.md#L1622) | Candidate | A stable contribution identity must not be reused to overwrite a different contribution or its history. |
| [CL-06](laws-proposed-r3.md#L1636) | Split | State must agree with recorded reviews; last-accept-wins is a review-resolution policy that may ignore unresolved objections. |
| [CL-07](laws-proposed-r3.md#L1649) | Candidate | Adding a review must preserve previous review facts and their order in the authoritative history. |
| [CL-08](laws-proposed-r3.md#L1660) | Candidate | Landing must require the applicable accepted review state for the exact contribution/version at the decision boundary. |
| [CL-09](laws-proposed-r3.md#L1675) | Implementation | One squashed commit is an integration strategy; preservation of the approved, verified change is the stronger contract. |
| [CL-10](laws-proposed-r3.md#L1689) | Split | Do not claim a change was landed when none occurred; empty-result treatment and scratch cleanup need separate lifecycle contracts. |
| [CL-11](laws-proposed-r3.md#L1701) | Policy | Blanket file-overlap refusal can reject valid sequential or semantically compatible work; require protection from unapproved overwrites. |
| [CL-12](laws-proposed-r3.md#L1713) | Implementation | Path/import-graph gate selection is a testing strategy; require the approved verification policy to have been satisfied. |
| [CL-13](laws-proposed-r3.md#L1727) | Candidate | Publish only the exact verified result under a valid target-version transition; distinguish ordinary integration from authorized rollback. |
| [CL-14](laws-proposed-r3.md#L1746) | Split | At-most-once integration, truthful attribution and replay agreement are separate worthwhile properties with distinct proof obligations. |
| [CL-15](laws-proposed-r3.md#L1759) | Candidate | Repository mutation requires valid repository authority and the applicable operation permission. |
| [CL-16](laws-proposed-r3.md#L1772) | Policy | Scanning prose for report-shaped text can reject legitimate instructions and examples; validate explicitly structured input at its boundary. |
| [CL-17](laws-proposed-r3.md#L1786) | Candidate | Caller commands must not forge internal execution, verification or landing facts. |
| [PR-01](laws-proposed-r3.md#L1799) | Candidate | Parse and establish scope semantics before using them for authority; malformed scope must not become unrestricted access. |
| [PR-02](laws-proposed-r3.md#L1815) | Evidence task | Adding missing pattern tests supplies evidence; it is not a behavioral law by itself. |
| [PR-03](laws-proposed-r3.md#L1827) | Evidence task | Pinning uncovered permission arms is test work; separately justify each permission rule. |
| [PR-04](laws-proposed-r3.md#L1838) | Evidence task | Pinning uncovered landing arms is test work; separately justify each landing requirement. |
| [PR-05](laws-proposed-r3.md#L1849) | Evidence task | A refusal-registry unit test is a validation task, not an inviolable Baton2 contract. |
| [DEV-1](laws-proposed-r3.md#L1866) | Split | Preserve valid work across arbitrary elapsed time or input volume; distinguish legitimate refusal, explicit cancellation and physical exhaustion. |
| [DEV-2](laws-proposed-r3.md#L1880) | Split | Acknowledge after durable intent without waiting for operation completion; literal instantaneous response is not the contract. |
| [DEV-3](laws-proposed-r3.md#L1893) | Split | Agent progress must not depend on invoking or rearming a watcher; optional history inspection remains a valid feature. |
| [DEV-4](laws-proposed-r3.md#L1904) | Candidate | A refusal must truthfully identify the failed rule, relevant input or state, and actionable remedy without inventing one. |
| [DEV-5](laws-proposed-r3.md#L1914) | Split | Gate accepted changes on required evidence and independent review; red-first chronology and exclusive publication need separate development controls. |
| [DEV-6](laws-proposed-r3.md#L1929) | Policy | Complete task scope and adequate authority need precise meanings; avoid requiring global authority or prohibiting useful task decomposition. |
| [DEV-7](laws-proposed-r3.md#L1941) | Policy | Plain technical English is a project writing rule enforced by review, not a Bend proof over runtime behavior. |

## Implications for the next draft

Do not present the current 99 `law` labels as 99 justified permanent contracts. Keep historical extraction separate from the desired Baton2 requirements. Consolidate duplicate guarantees so the operator is not asked to approve the same restriction through several mechanisms.

The strongest themes are truthful authority and provenance, preservation of accepted work and history, exact version binding, recovery without repeating uncertain effects, and continued delivery of durable work and events. Each still needs a precise scope and an adversarial counterexample.

The laws themselves also need change control: implementation agents must not satisfy a proof gate by weakening an operator-approved statement, adding an unsupported premise, hiding an unsafe dependency or proving a disconnected model. That is a development-governance requirement to design and justify, not a capability automatically supplied by naming a file `laws.bend`.

A useful review must also detect missing guarantees. A catalogue of existing guards can reproduce Baton's accumulated architecture while omitting the behavior Baton2 most needs. The target architecture should justify each retained contract by its purpose and preserve valid alternative implementations.
