# Implementation Report — 2026-10-15

Record of everything implemented in this session, why, and what it means for
anyone picking the work up later. Companion documents:

| Document | Purpose |
|---|---|
| `BACKLOG.md` | Everything still open, including items needing a product decision |
| `PROSPECT_AUDIT_PERSONALIZATION_PLAN.md` | The full plan this session partly implements |
| `handoff.md` | Previous session's handoff (2026-08-21) |

Base commit at session start: `92130e1`. A `git pull origin main` landed
mid-session (fast-forward to `e08c75b`), bringing in an Admin Portal SSO
endpoint that is **not** part of this work — see §5.

---

## 1. Starting point: what was actually wrong

A full read-through found three problems that made the goal
("detailed audits → personalised email → higher conversion") unreachable as
written, none of them about crawler depth:

1. **Tiering discarded the best prospects.** `tier` was decided by
   `technicalScore` alone (`< 30` → `skip`). A site with the basics right can
   only pass 30 by being badly broken, so an established business actively
   spending on ads with a slow site scored need 25 / opportunity 100 and came
   out `skip`, flagged `technically_sound`. Since `tier` drives the prospect
   table filter and the CSV export, sales was being steered away from exactly
   the prospects worth contacting.

2. **PageSpeed data was missing and its absence read as "fine".** PSI shared
   the 10s page-fetch timeout, so essentially every call aborted. Because the
   failure was swallowed and `psiPerformanceScore` stayed `null`, every
   PSI-dependent scoring branch was skipped — a failed measurement scored
   identically to a perfect one.

3. **No audit finding could reach an email.** `ProspectAudit` and
   `CampaignLead` had no connection whatsoever. The only route between them
   was a CSV export whose importer keeps 7 columns, and the merge tags covered
   names and email only. Tripling crawler depth would not have changed one
   word of any sent email.

---

## 2. Implemented

### 2.1 Audit data quality and tiering

- PageSpeed got its own `PSI_TIMEOUT_MS` (60s) plus one retry, and the outcome
  is now recorded: `psiStatus` (`pending|ok|failed|skipped`), `psiError`,
  `needsRecrawl`, surfaced in the UI as an `incomplete_audit` flag.
- `runTier1` now checks `res.ok` and records `httpStatus`. A 403/404/bot-wall
  page was previously parsed and scored as the real site, producing confident
  findings about an error page — unacceptable once those findings go in email.
- Response bodies are size-capped at 3MB (worker concurrency is 5).
- `coreWebVitals.inp` held the `interactive` audit, i.e. Time to Interactive.
  TTI now has its own field; `inp` is left `null` when Lighthouse doesn't
  report it rather than carrying an unrelated metric.
- Tiering rewritten so both axes decide and evidence of ad spend can never be
  skipped, with a new `hot` tier for spend + fixable problems:

  | Prospect | before | after |
  |---|---|---|
  | Established, runs ads, mobile 32/100 | `skip` | **`hot`** |
  | Same, PageSpeed failed | `skip` | `high` + `incomplete_audit` |
  | Genuinely good site, no ad spend | `skip` | `skip` |

- `technically_sound` can no longer coexist with `slow_load`/`no_ssl`, and is
  withheld entirely when the audit is incomplete.

**Note:** tiers are computed at crawl time, so existing prospects keep their
stored tier until re-crawled.

### 2.2 Findings — the personalisation layer

New `backend/src/utils/auditFindings.js`. A catalogue of 13 findings, each
with a stable `code`, a sales `angle`, `severity`, `pitchValue`, an
`applies()` predicate and a `sentence()` built **only** from measured values.
Ranked by `pitchValue × severity`; the top one becomes `topFinding`.

Deliberately deterministic, not LLM-written: every sentence is authored once
by a human with placeholders for measurements, so a claim can never exceed the
data. One verifiably wrong statement about a stranger's website ends that
conversation and, at volume, teaches people to distrust the sender.

Highest-value findings, in rank order: `ads_to_slow_site`, `noindex`,
`no_ssl`, `ads_without_analytics`, `mobile_desktop_gap`, `slow_lcp`,
`no_local_schema`, `no_contact_form`, `missing_meta`, `heavy_page`,
`images_no_alt`, `no_sitemap`.

Example output for an ads-spending prospect with a slow site:

```
1. [wasted_ad_spend] You're running paid ads to a homepage Google scores
   32/100 on mobile — most of that click spend leaves before the page
   finishes loading.
2. [mobile_broken]   Your site scores 81/100 on a computer but only 32/100
   on a phone, which is where most of your visitors are.
3. [slow_site]       Your homepage takes 8.4s to show its main content on a
   phone. Google treats anything over 2.5s as a problem.
```

Findings are generated at crawl time and stored on the prospect
(`findings[]`, `topFinding`, `topFindingAngle`), so the sentences an email
quotes always derive from the same data that produced the visible score.

Boolean predicates test truthiness rather than `=== false` on purpose: these
objects are Mongoose documents in the worker but plain objects elsewhere, and
a strict comparison silently dropped findings.

### 2.3 The bridge: audit → campaign

**`POST /api/prospect-audits/:id/push-to-campaign`**
Body: `{ campaignId, tiers?, minOpportunity?, requireFindings? }`

- Gated by **both** `prospect_audit` and `campaigns` features — it reads one
  and writes the other, so holding either alone isn't enough.
- Refuses a campaign that isn't `draft` or `paused`; pushing into a live
  campaign would start mailing unreviewed leads within the minute.
- Skips prospects with no email, no findings (unless `requireFindings: false`),
  or already present in the campaign, and reports each count back.
- Each created `CampaignLead` carries an embedded `auditSnapshot`.

**Why embedded rather than a reference to `ProspectAudit`:** sending must not
depend on a join in the worker's hot path, and an audit claim is
point-in-time — if the prospect fixes their site next week, an email already
sent should still reflect what was actually measured. Same write-once
reasoning as `Lead`'s attribution blocks.

UI: a **Push to Campaign** button on the batch page opens a modal to pick the
campaign and tiers, showing live counts of what will be added and what will be
skipped.

### 2.4 Merge tags

`renderMergeTags` in `workers/campaignWorker.js` now resolves, from
`auditSnapshot`:

| Tag | Resolves to |
|---|---|
| `{{top_finding}}` | highest-ranked finding sentence |
| `{{finding_2}}` / `{{finding_3}}` | next ranked sentences |
| `{{findings_list}}` | `<ul>` of all findings |
| `{{perf_score}}` / `{{perf_desktop}}` | mobile / desktop PageSpeed score |
| `{{seo_score}}` | PageSpeed SEO score |
| `{{lcp_seconds}}` | largest-contentful-paint, 1 decimal |
| `{{page_weight_mb}}` | homepage weight in MB |
| `{{website}}` / `{{audit_tier}}` | audited URL / tier |

Two safety properties, both previously absent:

1. **Everything substituted is HTML-escaped**, including the pre-existing
   name/email tags — those come from imported CSVs and public forms.
2. **A campaign can't send a half-rendered email.** `campaignReadiness`
   refuses to start a campaign whose subject/body/follow-up uses audit tags
   while any pending lead lacks a snapshot, naming the count. Without this a
   recipient gets "Your homepage takes  seconds to load". Tag detection lives
   in `utils/auditMergeTags.js` so the API can ask the question without
   requiring the worker file (which would spin up a BullMQ Worker as a side
   effect).

### 2.5 Follow-up: automatic after 2 real opens

The requested change was "2 or more opens → automatic follow-up". Implemented
as `HOT_OPEN_THRESHOLD = 2` (was 3), but counting **qualified** opens:

- New `CampaignLead.humanOpenCount`, incremented only when an open passes the
  scanner/prefetch filter already used to gate the "opened" notification
  (known scanner UA, or a hit within 15s of send). `openCount` still counts
  every pixel hit, so existing analytics are unchanged.
- **Why this matters at a threshold of 2:** a security gateway plus an image
  proxy can easily produce two raw opens for someone who never read the email.
  Following up on that wastes a send and the mailbox's reputation budget. With
  qualified counting, "2 opens" means two plausible human opens.
- **Back-compat:** leads created before this field have `humanOpenCount: 0`
  and would silently stop qualifying, so the original raw-open rule is kept at
  its stricter value (`LEGACY_RAW_OPEN_THRESHOLD = 3`) and OR'd in. Purely
  additive — no in-flight campaign loses its follow-ups.
- The dispatcher now also refuses to queue a follow-up whose subject or body
  is empty. `followUpEnabled` and the follow-up content are separate fields,
  so the flag could be true with nothing to send, and the worker would have
  sent a blank email.

Verified:

```
2 real opens            -> hot     (the requested behaviour)
1 real open             -> not hot
2 scanner-only opens    -> not hot
legacy lead, 3 raw opens-> still hot
legacy lead, 2 raw opens-> not hot
```

**Still required to actually send:** `followUpEnabled` is per-campaign and
defaults to **false**, and a follow-up subject and body must be written. That
default was left alone deliberately — flipping it would start sending from
existing campaigns without anyone choosing to.

### 2.6 Security and correctness (earlier in the session)

31 fixes, committed separately. Summarised in `BACKLOG.md` §0; the headline
items were:

- **Socket room bypass** — any authenticated socket, including a client-portal
  login, could join `admin:syslog` (live server logs), `admin`, or
  `user:<anyoneElse>` just by naming it.
- **Portal isolation** — clients could list all staff and all client records,
  read every staff work log, modify any todo, and DM any employee.
- **Privilege escalation** — a manager could create an admin, and could reset
  an existing admin's password and log in as them.
- **Social OAuth never stored a token** (Mongoose drops virtuals in
  `findOneAndUpdate`), so publishing could never have worked.
- **IMAP reply sync** read a UID range as sequence numbers, fetching only the
  newest message.
- **Members saw an empty app** — an uncaught 403 rejected the whole data load.
- Mass assignment on invoices/services/meetings/projects, upload stored XSS,
  unauthenticated leave attachments, Mongo operator injection, campaign
  tracking XSS/open redirect/scanner-triggered state changes, regex injection.

---

## 3. How to use the new flow

1. Import prospects into a batch and **Start Crawl**. Needs a PageSpeed
   Insights API key in Settings → Integrations, otherwise audits run Tier 1
   only and are flagged `incomplete_audit`.
2. Review tiers. `hot` = evidence of ad spend plus fixable problems.
3. Create a campaign (leave it `draft`), and write the email using audit tags,
   e.g.

   ```
   Hi team at {{first_name}},

   {{top_finding}}

   Happy to send the full breakdown for {{website}} if useful.
   ```

4. On the batch page, **Push to Campaign** → pick the campaign and tiers.
5. Start the campaign. If any pending lead lacks audit data while the body
   uses audit tags, the start is refused with the count — that is the guard
   working, not a bug.

---

## 4. Verification

No test runner exists in this repo, so verification was:

- `node --check` on every changed backend file.
- A module smoke-load of all changed modules (catches bad requires and
  references that syntax checks miss).
- `npm run build` for the frontend.
- Behavioural tests written for each piece of new logic: finding ranking and
  predicates, merge-tag rendering (including that an unaudited lead renders
  empty rather than `undefined`), HTML escaping, the hot-lead rule across five
  cases, audit-tag detection, scoring/tiering across five prospect profiles,
  the socket room allowlist, lead-number block reservation, upload extension
  mapping, CSV escaping and the geoip ranges.

**Not verified:** anything requiring MongoDB, Redis and the worker processes
running together. The push-to-campaign endpoint, the follow-up dispatcher and
the merge tags have not been exercised against a live database. Before relying
on them, run one real campaign to a small internal list.

---

## 5. Not part of this work

A `git pull origin main` during the session brought in **Admin Portal SSO**
(`/api/auth/sso`, `ssoController.js`, `SsoTokenUse.js`). It was reviewed
because it mints sessions and looks sound: RS256 with a public key,
audience/issuer checks, one-time `jti` enforced by a unique index, blocks the
`client` role, and fails closed when the key path is unset. One nit: its
`BLOCKED_ROLES` comment says portal accounts must never reach "a client-portal
or read-only session", but only `client` is blocked, not `read_only`.

---

## 6. Next steps, in order

1. **Re-crawl one batch.** Existing prospects carry stale tiers and no
   findings; with PageSpeed working they'll get real data for the first time.
2. **Run one small real campaign** using `{{top_finding}}` and measure reply
   rate against a generic control.
3. **Angle routing** (`BACKLOG.md` §1.4) — the `angle` is already stored on
   every finding and on `auditSnapshot.primaryAngle`, so reply rate per angle
   is a simple aggregation and per-angle templates are the natural next step.
4. **Hosted audit report page** (plan §3.7) — strongest CTA, and a view is a
   high-intent signal.
5. **Remaining security items** in `BACKLOG.md` §2, especially the upload
   `Content-Disposition` hardening and enabling a real CSP.
6. **Social publishing** still cannot post media (URLs are stored as relative
   paths no platform can fetch) and has no token refresh. Now that accounts
   can finally hold a token, that path needs end-to-end testing.
