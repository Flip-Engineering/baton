# Official Anthropic account and credit surfaces: research record

Status: research record, 2026-10-17, seat accounts-glm (ensemble `account-credit-product`),
requested by conductor accounts-wonder (role task `message:accounts-wonder:8ac1a1ce3763ecac95b91d90258abd2e`).
Every finding below was read from the named primary document during 2026-10-16. Local time of the
ensemble host is 2026-10-17; the documents were fetched on the operator-hosted session whose date
context names 2026-10-16. Any statement this record cannot ground in a fetched document is listed
under Unknowns. No endpoint is invented; absence findings mean absence from the cited
documentation as of the fetch date.

## 1. Is there a supported remaining-promotional-credit balance or expiry endpoint?

No endpoint for remaining promotional-credit balance or expiry appears in the official API
documentation fetched for this record. What the official sources name:

- Balance and expiry are presented as Console UI facts: credits appear in the **Promotional
  credits** section of the Billing page, with the amount and expiry date
  (https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers, "How credits are
  applied" and "Start building"; https://support.claude.com/en/articles/17154008, "How the credits
  work": "Visible in the Console ... with their amount and expiry date").
- The Usage and Cost API reports usage and cost only
  (https://platform.claude.com/docs/en/manage-claude/usage-cost-api): usage buckets from
  `GET /v1/organizations/usage_report/messages` (token counts by model, workspace, service tier,
  API key, context window, inference geo, speed; granularity 1m/1h/1d with bucket caps 1440/168/31)
  and costs from `GET /v1/organizations/cost_report` ("All costs in USD, reported as decimal
  strings in lowest units (cents)", daily granularity only). Neither response schema on that page
  contains a remaining-credit field. Priority Tier costs are excluded from the cost endpoint.
- Authentication for those two endpoints: an Admin API key (`sk-ant-admin01-...`), an OAuth token
  with `org:admin` scope, or a personal or service account key that is not scoped to a workspace;
  workspace API keys are rejected. Claude Enterprise organizations use the separate Analytics API
  with an Analytics API key. The Admin API is unavailable for individual accounts.
- The Organization API (https://platform.claude.com/docs/en/api/organization) exposes
  `GET /v1/organizations/me`, which "Retrieve[s] information about the organization associated
  with the authenticated API key" and returns an `OrganizationInfo` object `{type: "organization",
  id: <uuid>, name: <string>}`. The documented example authenticates with a plain API key header
  (`X-Api-Key: $ANTHROPIC_API_KEY`). The same reference lists organization-scoped management
  endpoints (API keys list, workspaces, usage and cost report references). No member of this
  surface reports a credit balance.

Consequence for the product (recorded, not re-derived in code): the balance source set is
Console-observed or operator-imported; `cost_report` supports external-spend reconciliation;
`/v1/organizations/me` is the supported key-to-organization verification call; no balance is ever
computed from spend deltas.

## 2. Documented exhaustion surfaces for the API funding route

From https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers, section "When
credits run out", quoted verbatim as documented provider wording:

- API requests, balance exhausted:
  `Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to
  upgrade or purchase credits.`
- A credits-only organization sending a request the credits do not cover, such as a Claude Code
  session; Claude Code displays:
  `Credit balance too low · Add funds: https://platform.claude.com/settings/billing`

From https://platform.claude.com/docs/en/api/errors:

- 402 `billing_error`: billing or payment information.
- 400 `invalid_request_error`: also returned when usage reaches an organization or workspace spend
  limit; Claude Code workspace spend limits can return 429.
- 429 `rate_limit_error`: organization rate limits, the usage tier's monthly spend cap (no
  `retry-after` header; keeps failing until access resumes), and Claude Code workspace spend
  limits.

These wordings and status/type pairs are documented, vendor-published text; a classification
fragment may cite them, and the fixture must reproduce the documented text. An observed terminal
from the operator's own accounts remains the stronger evidence class and supersedes or refines
these when they differ.

## 3. Coverage and the `claude -p` eligibility rule

- https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers, coverage table:
  Claude API, Claude Managed Agents, Claude Agent SDK, Playground: covered. "Claude Code": not
  covered. Claude Platform on AWS, Bedrock, Google Cloud, Microsoft Foundry: not covered.
- https://support.claude.com/en/articles/17154008, "What the credits cover" and the FAQ "Does this
  cover `claude -p`?": API credits cover `claude -p` and the Claude Agent SDK when run with an API
  key from the linked organization, because that usage is billed as Agent SDK usage. When signed in
  with the Claude plan, `claude -p` and Agent SDK usage draw from plan usage limits. Runs started
  by the Claude Code GitHub Action, an IDE extension, or the desktop app count as Claude Code
  usage even with `-p`. Interactive Claude Code in the terminal is not covered by credits.
- https://code.claude.com/docs/en/env-vars, `ANTHROPIC_API_KEY` row, quoted verbatim: "API key sent
  as `X-Api-Key` header. When set, this key is used instead of your Claude Pro, Max, Team, or
  Enterprise subscription even if you are logged in. In non-interactive mode (`-p`), the key is
  always used when present. In interactive mode, you are prompted to approve the key once before it
  overrides your subscription. To use your subscription instead, run `unset ANTHROPIC_API_KEY`."
  Related rows: `ANTHROPIC_AUTH_TOKEN` (Bearer header value), `apiKeyHelper` credential helper with
  `CLAUDE_CODE_API_KEY_HELPER_TTL_MS`, `ANTHROPIC_BETAS` (works with all auth methods, unlike the
  `--betas` flag which requires API key authentication), `CLAUDE_CONFIG_DIR` (relocates settings,
  session history, plugins; not settable from project or local settings).

Synthesis for the eligibility predicate: the deciding facts are the authentication credential of
the self-run headless process and the execution mode, and the harness name decides nothing by
itself. Baton's claude-code harness spawns `claude --print` (headless, `-p` mode); with
`ANTHROPIC_API_KEY` present the CLI uses the key on every run, which is billed as Agent SDK usage
and draws the organization's credits; with the subscription login (OAuth in the config directory)
and no key present it draws plan usage. GitHub Action, IDE extension and desktop-app launches are
Claude Code usage regardless, and Baton launches none of them.

## 4. Funding mechanics with modeling consequences

From the two credit articles:

- Amounts: Max 5x $100, Max 20x $200 per month; Team pools $20 per Standard seat and $100 per
  Premium seat, capped at $500, computed from seats at the start of each billing month.
- One Console organization per plan; each organization receives credits from only one plan; the
  link is not self-service changeable.
- Refresh on the billing cycle (monthly for annual plans); no rollover; included credits are spent
  before purchased credits; auto-reload reloads only the purchased balance.
- Every API key and workspace in the linked organization draws the same balance.
- Two clocks exist and they differ: spend caps reset on the first of each calendar month, while
  credits refresh on the plan's billing cycle. Usage paid with credits counts toward the
  organization's monthly spend cap. An organization can therefore refuse with a spend-cap
  condition while promotional credits remain, and can hold unspendable credits after a cap
  resets. Funding-route modeling must keep these as separate refusal facts.
- Tier effects: an organization linked to an eligible plan moves to at least the Start tier; with
  monthly credits over $200, at least the Build tier. Claiming credits does not otherwise move the
  usage tier.
- Plan changes: cancel/downgrade stops new credits, held credits stay usable to expiry; Max 5x to
  20x upgrade pays prorated credits immediately; Max to Team ends the Max link.

From https://code.claude.com/docs/en/settings (settings precedence, for the launch environment the
product builds): managed settings > `--settings` > project local > shared project > user;
environment variables are decided per key pair against settings keys, and a settings `env` block
overrides the inherited shell value in most sessions. An account profile that binds
`CLAUDE_CONFIG_DIR` therefore also fixes which settings files, managed policy and `env` block the
child reads; funding-route selection and settings-isolation are the same boundary.

## 5. Unknowns

- The operator's two browser sign-ins and their Console organizations are unverified; no statement
  in this record identifies them. `/v1/organizations/me` per credential is the supported
  verification step, owned by root's account setup.
- Whether the operator's organizations hold purchased credits or auto-reload: unknown; affects
  which exhaustion wording appears first, and both documented wordings above must classify.
- Whether any supported balance endpoint exists outside the fetched documentation cannot be proven;
  this record claims absence from the cited documents as of the fetch date only.
- The exact `claude` CLI behavior when both `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_API_KEY` are
  present is not stated on the fetched pages; the product sets exactly one credential variable per
  profile and unsets the others (its launch argv already unsets all three), so the ambiguity never
  arises in a Baton spawn.

## 6. Source list

- https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans
- https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers
- https://platform.claude.com/docs/en/manage-claude/usage-cost-api
- https://platform.claude.com/docs/en/api/organization
- https://platform.claude.com/docs/en/api/errors
- https://code.claude.com/docs/en/settings
- https://code.claude.com/docs/en/env-vars
