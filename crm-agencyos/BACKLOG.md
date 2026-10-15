# BBC CRM — Consolidated Backlog

Single index of everything planned, deferred, or known-broken. Compiled 2026-10-15 against
commit `92130e1` after a full read-through of the codebase.

Plans previously lived in four separate places — this file indexes them all:

| Document | Covers |
|---|---|
| `PROSPECT_AUDIT_PERSONALIZATION_PLAN.md` | Audit-driven personalised outreach (detailed, file-level) |
| `NOTIFICATION_ARCHITECTURE.md` | Web push / multi-channel notifications — **blueprint, not built** |
| `handoff.md` (2026-08-21) | Social module state, deployment checklist |
| this file | Everything else + status of the above |

Status key: `[x]` done · `[ ]` open · `[?]` needs a product decision · `[!]` security

---

## 0. Fixed 2026-10-15

### Batch 2 — security and isolation
- [x] **Portal isolation** — `GET /api/users` refuses portal logins (they have
      `/api/portal/contacts`); clients/clients-by-id scoped to their own record; todos router
      given `denyClientWrites`; client notes given `denyClientWrites`; work logs readable only by
      admin/manager; message threads gated so a client can only DM their actual account contacts
      and can no longer read legacy string-named staff channels.
- [x] **Privilege escalation** — only an admin may create an admin; an admin account can only be
      modified or deleted by an admin (a manager could previously set an admin's password and log
      in as them); user create/update now field-whitelisted.
- [x] **Mass assignment** — `updateInvoice`, `updateService`, `updateMeeting` and `updateProject`
      whitelisted. Invoice money fields (paidAmount/balanceDue/invoiceNumber/versions) can no
      longer be set from a request. Also fixed: a tax-rate- or discount-only edit now recomputes
      totals, which it previously skipped.
- [x] **Upload stored XSS** — stored extension derives from the accepted MIME type instead of the
      uploader's filename, so an `.html` file declared as `text/plain` can't be served from this
      app's origin.
- [x] **Leave attachments** — `/uploads/leaves` no longer publicly served; `/api/media?d=leaves`
      requires a session plus ownership (or admin/manager), fetched client-side through the
      authenticated API so no token appears in a URL.
- [x] **Broadcast scoping** — lead events go to a `leads` room (membership from the same Feature
      Access rule the REST routes use) and `settings:updated` to a `staff` room, instead of every
      connected socket.
- [x] **Mongo operator injection** — public WIT bodies coerced to strings at the boundary;
      `externalLeadId` coerced in both lookup paths.
- [x] **Campaign tracking** — click tracking stores only validated http(s) URLs (a `javascript:`
      URL was persisted and later rendered as an `<a href>`), redirects require a resolvable
      token, and `call-request`/`response` no longer mutate state for link-scanner user agents.
- [x] **`read_only`** removed from `isPrivileged` in the email-account controller.
- [x] **Regex injection** — audit-log search and the Won-handshake company lookup escaped.
- [x] Smaller: `updateTask` returns 404 instead of 500 for an unknown id; `logWatcher` uses
      `continue` on rotation so later log sources aren't skipped; geoip no longer treats public
      172.2x addresses as private and now covers IPv6 private ranges; CSV exports neutralise
      formula-injection prefixes; `maxNewLeadsPerDay` can't be saved as 0.

### Batch 1 — prospect audit and core breakage

- [x] **`[!]` Socket room bypass** — any logged-in user (incl. client portal) could join
      `admin:syslog`, `admin` or `user:<anyoneElse>`. Added a room-shape allowlist in
      `socket/socketHandler.js`, applied to `join:thread` and `typing:*`.
- [x] **Social OAuth tokens never persisted** — `findOneAndUpdate` silently drops Mongoose
      virtuals, so every connected account saved with an empty token and publishing could never
      work. Switched to load-then-save.
- [x] **IMAP replies missed** — `{uid:true}` was in the query instead of the options arg, so the
      UID range was read as sequence numbers and only the newest message was fetched.
- [x] **Members saw an empty app** — un-caught `leadsAPI.getAll()` inside `Promise.all` rejected
      the whole data load for any role denied the `leads` feature.
- [x] **Bulk import leadId collisions** — reserved 1 counter value but consumed N; next single
      create died on the unique index. Now reserves the block atomically.
- [x] **Imported leads had no `slaDeadline`** — `insertMany` bypasses the pre-save hook.
- [x] **Crawler scored error pages as real sites** — `res.ok` unchecked; a 403/bot-wall page
      produced real-looking findings. Now fails the crawl and records `httpStatus`.
- [x] **PageSpeed always timed out** — shared the 10s page-fetch budget. Own 60s timeout + retry.
- [x] **PageSpeed failures were invisible** — now `psiStatus`/`psiError`/`needsRecrawl` +
      an `incomplete_audit` flag, so missing data no longer reads as "no problems found".
- [x] **`inp` held Time to Interactive** — a mislabelled number that would have been quoted to a
      prospect. TTI now stored under its own name.
- [x] **Tiering discarded the best prospects** — `technicalScore < 30 → skip` regardless of
      opportunity, so an established business running ads with a slow site came out `skip` +
      `technically_sound`. Both axes now decide; new `hot` tier; spending signals can never be
      skipped.

**Note:** existing prospects keep their stored tier until re-crawled.

---

## 1. Prospect audit → personalised outreach

Full detail in `PROSPECT_AUDIT_PERSONALIZATION_PLAN.md`. Remaining work:

### 1.1 Prerequisites (§5 of the plan)
- [ ] **`[!]` SSRF guard** in the crawler — it fetches any imported URL with `redirect: 'follow'`.
      Block private/link-local ranges after DNS resolution, cap redirects. Gets more important
      once the hosted report echoes crawled content back.
- [ ] **Stuck prospects** left in `crawling` after a worker crash are never reset, so
      `autoCompleteFinishedBatches` never completes the batch. Needs a stale-claim sweep.
- [ ] **Dedupe index probably doesn't exist** — `ProspectAudit.js` uses
      `partialFilterExpression: { email: { $ne: '' } }`; MongoDB partial indexes don't support
      `$ne`, so creation fails and the same business can be imported (and emailed) twice.
      Use `$gt: ''` and verify with `getIndexes()`.

### 1.2 Phase 1 — make the data usable
- [ ] **`utils/auditFindings.js`** — the finding catalogue: code, severity, pitch value,
      `applies()`, and one human-written `sentence()` filled only with measured values.
      This is the core of personalisation. ~12 findings to start.
- [ ] **Schema**: `findings[]`, `topFinding`, `reportToken`, desktop score, `pageWeightKb`,
      `renderBlockingCount`, CrUX fields.
- [ ] **The bridge** — `POST /api/prospect-audits/:id/push-to-campaign`, creating `CampaignLead`s
      with an embedded point-in-time `auditSnapshot`. Extract and reuse `importLeads`' dedupe and
      verification logic rather than duplicating it.
- [ ] **Merge tags** — `{{top_finding}}`, `{{perf_score}}`, `{{lcp_seconds}}`,
      `{{audit_report_url}}` etc., resolved at `campaignWorker.js:258-259`.
- [ ] **`[!]` HTML-escape all merge-tag values** — current tags interpolate raw lead fields into
      email HTML; audit sentences include text pulled from the prospect's own page.
- [ ] **Never send a half-rendered email** — readiness check refusing to start a campaign whose
      body uses audit tags while its leads lack snapshots, plus a per-lead dispatcher guard.
      Without this a prospect gets "takes undefined seconds".
- [ ] **Hosted report page** — `GET /api/prospect-audits/report/:token`, public, mounted before
      the protected router. Reuse the existing scanner-suppression heuristic, and make the CTA a
      POST so link scanners can't trigger it.

### 1.3 Phase 2 — crawler depth
- [ ] Contact page crawl (broken enquiry form = direct lost revenue)
- [ ] CrUX real-user Core Web Vitals (far more credible than lab numbers)
- [ ] Mobile **and** desktop PageSpeed (the gap is itself a pitch)
- [ ] Local SEO: name/address/phone consistency, `LocalBusiness` schema
- [ ] Social presence links; Open Graph tags (broken share previews)
- [ ] Tech staleness: jQuery version, `document.write`

### 1.4 Phase 3 — dynamic email (from the 2026-10-15 brainstorm, not yet in the plan doc)
- [?] **Angle routing** — group findings into sales angles (wasted ad spend, invisible on Google,
      not secure, mobile broken, flying blind, enquiries leaking, invisible locally, already
      solid) and let each own a whole email including the subject line. Implement by adding an
      `angle` field to the existing `EmailTemplate` model and selecting per lead at the single
      choke point in `campaignWorker.js`. **Decided direction, not yet folded into the plan doc.**
- [ ] **Feedback loop** — store `primaryAngle` on `CampaignLead`; existing open/click/reply
      tracking then gives reply-rate per angle for free. Tells you which angles convert and which
      crawler checks are worth building.
- [ ] **Escalating follow-up** — follow-up uses the *second*-ranked finding, not a repeat.
- [ ] **Send gating** — skip prospects whose best finding is weak, rather than sending anyway.
- [ ] **Freshness rule** — re-crawl if the audit is older than ~30 days, so you don't tell someone
      their site is slow after they fixed it.

### 1.5 Deferred
- Headless-browser auditing (Tier 3 / Playwright) — noted in the worker's own header comment.
- Screenshots in the report (needs a browser).
- Competitor comparison ("your competitor loads in 1.2s") — high pitch value, needs a reliable
  competitor source per prospect.

---

## 2. `[!]` Security — still open

Ordered by severity. None of these are fixed.

- [x] **Client-portal isolation gaps.** `GET /api/users` and `/api/clients` are unscoped, so a
      client can list every staff member and every other client. `POST /clients/:id/notes` has no
      role check. The todos router lacks `denyClientWrites`, so a client can create/update/delete
      any todo. `GET /api/worklog` scopes only `member`, so clients read all staff work logs.
      Over HTTP a client can read/post `dm-<anyUserId>`, bypassing the socket contact allowlist.
- [x] **Stored XSS via uploads.** `middleware/upload.js` keeps the client-supplied file extension
      and trusts the client-declared MIME type; uploads are served from the same origin with no
      auth and CSP is disabled in `app.js`. An `.html` file declared as `text/plain` runs on the
      CRM's own domain. Affects task/todo/message/payment attachments.
- [x] **Lead and settings documents broadcast to every socket.** `io.emit('lead:created'|
      'lead:updated'|'lead:won:alert')` and `settings:updated` go to all authenticated sockets,
      including client-portal logins and staff with no lead access.
- [x] **`updateInvoice` mass assignment** — copies the whole request body, so a caller can set
      `paidAmount`, `balanceDue`, `invoiceNumber`, `isDeleted` or the version history.
      `updateService`, `updateProject` and `updateMeeting` have the same pattern.
- [x] **Managers can take over admin accounts** — `createUser` accepts any `role` (so a manager
      can create an admin), `updateUser` still accepts `password` for non-admins (so a manager can
      reset an admin's password), and managers can delete admins. Also: every invited user gets
      the same hardcoded password `welcome123`.
- [x] **Mongo operator injection** — `externalLeadId` goes straight into `findOne`
      (`{"$gt":""}` matches an arbitrary lead), and the public WIT endpoints never type-check
      `trackingId`/`sessionId`, so an object value can resolve to or overwrite other sites'
      sessions. No `sanitizeFilter` anywhere.
- [~] **Campaign tracking endpoints** (stored XSS + scanner-triggered GET mutations fixed; the open redirect is now token-gated but still needs signed links) — stored XSS through the click-tracking `url` param (a
      `javascript:` URL is stored and later rendered as an `<a href>`), an open redirect on the
      same route, and state-changing GETs (`call-request`, `response`) that link scanners trigger,
      manufacturing fake call requests and pipeline syncs. No rate limiting on these routes.
- [ ] **Credentials in URLs** — API keys accepted via query string (and the reveal modal suggests
      it), JWTs accepted via `?token=`/`?_token=`, and invoice PDFs opened with the JWT in the URL.
      All land in server logs and browser history.
- [x] **Leave attachments are public** — medical certificates reachable with no login via
      `/uploads` and `/api/media?d=leaves`.
- [x] **`read_only` role over-granted** — `isPrivileged` in `emailAccountController.js` includes
      it, so read-only users can see/edit/delete everyone's mailboxes; the router has no
      `authorizeFeature` gate at all.
- [ ] **No global unsubscribe suppression** — unsubscribe is per-campaign, so the same address
      still receives other campaigns. CAN-SPAM risk.
- [ ] **Audit-log search regex injection**; **CSP disabled globally**; **Redis has no auth**.

---

## 3. Correctness bugs — still open

### Campaigns
- [?] **Follow-up barely runs** — `followUpEnabled` defaults to `false`, and even when on it
      requires `openCount >= 3` or a call request. Opens are unreliable (Apple Mail Privacy
      Protection is undetectable by the code's own admission), so most cold prospects get exactly
      **one** email ever. A proper 3-4 step sequence not gated on opens is probably the single
      biggest conversion lever in the system — and it's a product change, so it needs sign-off.
- [ ] Per-account daily cap undercounts (only `status:'sent'`; replied/unsubscribed/bounced drop
      out, follow-ups uncounted). `CampaignsPage`'s "Sent" figure disagrees with the Analytics tab.
- [ ] Lead claim is not atomic (`findOne` then `save`) — duplicate sends if ever clustered.
- [ ] Pause/delete don't stop already-queued jobs; the worker never re-checks campaign status.
- [ ] Worker's SMTP transporter cache is never invalidated when an account is edited.
- [x] `maxNewLeadsPerDay` accepts 0, silently sending nothing; start hour == end hour gives an
      empty window; empty `sendingDays` means "all days" on the backend but not in the UI.
- [ ] Daily caps use server-local midnight, not the campaign's timezone.
- [ ] Out-of-office auto-replies and `mailto:` unsubscribes are recorded as "replied"; async
      bounces never detected; any 5xx permanently marks a lead bounced.
- [ ] Large imports: >250 domains are inserted unverified and verified fire-and-forget (lost on
      restart, and the dispatcher can send before it finishes). `getCampaignLeads` is unpaginated.
- [ ] `settings.stopOnReply` is never read by the backend (replies always stop sending).

### Social
- [ ] **Media posting cannot work** — `uploadMedia` returns a relative `/uploads/...` path that
      providers hand to Meta/TikTok or `fetch()` directly. Also `media[].url` comes unvalidated
      from the request body → SSRF.
- [ ] No token refresh anywhere — `refreshToken()`/`validateAccount()` are never called and
      `status` is never set to `expired`. X (~2h) and YouTube (~1h) tokens will fail scheduled posts.
- [ ] Deleted posts still publish (soft delete, no job cancellation, worker doesn't check);
      cancel races with an in-flight job; retry after partial success can double-post.
- [ ] Instagram publishes even if the container is still `IN_PROGRESS`; LinkedIn pins
      `LinkedIn-Version: 202401` and never calls `finalizeUpload` for video; TikTok's error check
      is `=== 'error'` where it should be `!== 'ok'`; X media upload uses v1.1 with a v2 bearer.
- [ ] Capability rules duplicated between `SocialComposerPage.jsx` and the providers.
- [ ] **Re-test publishing end to end** now that the token bug is fixed — it has never worked.

### Meta Ads
- [ ] Reach is summed across days and campaigns (reach counts unique people — totals inflated).
- [ ] Conversions likely double-counted via the `/lead/i` regex matching several action types.
- [ ] Entities/insights carry no `accountId`, so switching ad accounts mixes two accounts' data;
      deleted entities are never pruned.
- [ ] `lastSyncedAt` written before the sync succeeds; "Sync Now" bypasses the cron's tick guard
      and runs synchronously inside the HTTP request; UTC vs account-timezone date mismatch.
- [ ] Credential endpoints sit behind the configurable `ads_monitoring` gate (admin+manager),
      unlike every other integration which is admin-only.

### Website Intelligence
- [ ] `pageend` fires on every `visibilitychange`, so the first tab-switch closes the pageview —
      time-on-page is undercounted and sessions end early.
- [x] Private-IP check uses `startsWith('172.2')`, which misclassifies public 172.2x addresses;
      IPv6 private ranges missed entirely.
- [ ] Raw visitor IPs stored and returned to managers, with no TTL/retention on any `Wit*`
      collection (GDPR exposure); geo cache Map unbounded; visitor IPs sent in cleartext to
      ip-api.com over plain HTTP.
- [ ] Reports load all sessions in range into memory; several lookups aren't scoped by website.
- [ ] `WitPageview.isExit` is never written.

### Billing / payroll / ops
- [ ] Payment sync overwrites `overdue`/`cancelled` statuses; no overpayment cap; payments
      accepted on cancelled invoices; `totalCollected` includes cancelled invoices.
- [ ] Invoice PDF: `₹` can't render in pdfkit's Helvetica (garbled amounts), `fillColor('rgba(...)')`
      unsupported, long invoices overflow the fixed footer, sender name hardcoded.
- [ ] Reminder cron emails `client.email`, not `billingProfile.billingEmail`.
- [ ] `createClient` auto-creates a draft invoice by parsing a free-text budget — `"50k"` → 50.
- [ ] `Revenue` is a separate manually-entered collection with no link to invoices/payments —
      two sources of truth; no list/edit endpoints; never audited.
- [ ] Payroll: no holiday calendar, no overlap check, no leave balances; pay runs compute nothing
      (no per-employee lines, no link to leaves/worklogs); `employees` defaults to all non-client
      users; any status jump allowed; no audit entries. A leave decision can be flipped later, and
      with only one manager that manager's own leave can never be approved.
- [ ] Task/todo **approval is UI-only** — `updateTask`/`updateTodo` have no ownership or role
      check, so any member can edit, reassign or complete anyone's record. `deleteTodo` likewise.
- [x] `updateTask` 500s on a non-existent id. The "ready for review" notification is dead code.
- [ ] `POST /meetings` requires admin/manager but `/meetings/schedule` has no role gate — and the
      UI uses `/schedule`. Emergency flag auto-accepts every invitation.
- [ ] Reports period filter is a no-op for tasks (`dueDate` is a string field compared against
      `''`/`'9999'`); "today" is a zero-width range; month range excludes its last day.
- [ ] Work log trusts client-posted `workSeconds` — timesheets are forgeable.
- [x] `logWatcher._tick` uses `return` where it needs `continue`, skipping the remaining log files
      for that tick on rotation. `getSystemStatus` opens a new Redis connection per request.
- [ ] Soft-deleted channels keep the unique name, so it can't be reused.
- [ ] Audit log never fires for meetings, projects, channels, leaves, pay runs, services, revenue,
      payment deletes, client notes or password changes; the `diff()` helper is unused so
      `changes` is always null.

### Leads
- [x] Regex injection in the Won handshake (`new RegExp('^' + companyName + '$')`) — a company
      name like `a(` throws a 500 and blocks marking the lead Won; re-entering Won duplicates the
      Project.
- [ ] Won via `/lead-sync/status` skips the client/project/notification handshake that
      `updateLead` performs.
- [ ] `sendLeadEmail` emits `lead:updated` with an unpopulated `assignedTo`, which crashes the
      Kanban view (`assignee.name.split` on an ObjectId string). Same shape from leadCapture.
- [ ] `mergeLeads` drops `externalLeadId`, tags, watchers and attribution before hard-deleting
      the source, breaking later main-CRM syncs.
- [ ] Meta Ads / synced leads get auto-assigned despite the model comment saying they never are —
      reps are notified about leads `getLeads` then hides from them.
- [ ] A `Hot`-tagged Manual lead appears in both Pipeline and Email Leads tabs simultaneously.
- [ ] `autoAssignLead` uses `.lean()`, so a legacy settings doc silently falls back to `'none'`
      while the UI shows `'round-robin'`. Round-robin eligibility includes admins and read_only
      users; `activeSalesRepsOnly` excludes anyone `offline`, so overnight nothing gets assigned.
- [ ] CSV import parser does naive `split(',')` (quoted commas break rows) and matches columns by
      substring in an order where "Contact Email" overwrites `contactPerson`.
- [x] CSV exports don't neutralise leading `=`/`+`/`-`/`@` (formula injection), and lead values can
      come from anonymous public forms.
- [ ] `dataControl.allowBulkImport` is never enforced; `canEdit`/`handleCellSync` in
      `LeadsPage.jsx` are dead code. No ownership scoping — anyone with the feature edits any lead.
- [ ] Currency symbols inconsistent (`$` in forecast, `₹` elsewhere).
- [ ] `SystemSettings.pipelines` is editable in Settings but **nothing reads it** — every pipeline
      view hardcodes its own 5 stages and ignores stage probabilities.

---

## 4. Notifications — `NOTIFICATION_ARCHITECTURE.md`

That document is a **blueprint, not the current system**. Today only socket + MongoDB delivery
exists. Unbuilt: web push via VAPID (no `web-push` dependency), the `NotificationPreference`
schema (`User` has a simple `notificationPrefs` Map), a BullMQ-driven notification queue, email
digests, and the full trigger/routing matrix.

- [?] Decide whether this is still wanted before building — it predates the current
      `notificationRouting` implementation in `SystemSettings`, which already covers part of it.

---

## 5. Social module — `handoff.md` follow-ups

- [ ] LinkedIn, X, YouTube, TikTok apps not created — only Meta is configured, so only
      Facebook/Instagram work. Credentials go in Settings → Social Media Platforms (no deploy).
- [ ] `@thatsbizzbuzzcreations_` needs its own dedicated Facebook Page before it can connect
      (Meta allows one Instagram account per Page).
- [ ] Deep engagement analytics (each platform's own Insights API) — explicitly deferred; the
      current analytics endpoint counts rows in our own DB, not platform data.
- [ ] Social inbox (comments/DMs) — explicitly deferred.

---

## 6. Infrastructure / ops

- [ ] **Manual server state not tracked in git** — production `.env` needs
      `JWT_REFRESH_EXPIRE=30d`, and nginx needs `client_max_body_size 15M`. Both are manual edits
      on the VPS; verify they're still in place.
- [ ] **No tests, linter or type checking anywhere.** CI only runs `deploy.sh`. Verification today
      means `node --check` plus `npm run build`.
- [ ] **Single-API-process assumption** — campaign pacing, PSI daily counts and the lead-sync
      queue are all in-memory, so clustering (PM2 cluster mode) would double-send. Must be moved
      to Redis/Mongo before scaling out.
- [ ] Frontend ships as one 2.8MB chunk — no code splitting.
- [ ] Worker concurrency (5) is far below the dispatcher's release rate (50/min) once PageSpeed
      actually runs; raise to ~20 (see §6 of the personalisation plan).

---

## 7. Documentation to correct

- [ ] `handoff.md` and the Serena memories claim a server restart resets `WorkLog` active flags —
      no longer true since commit `5460f64`.
- [ ] Serena memories omit the `read_only` role entirely.
- [ ] `CLAUDE.md` predates billing, payroll, social, WIT and prospect audits.
- [ ] `README.md`'s endpoint table is a small outdated subset.
- [ ] `EXTERNAL_API_DOCUMENTATION.md` §2.1 and `ApiDocsModal.jsx` claim web-form/Meta-Ads/campaign
      leads carry `externalLeadId`; only `createLead` sets it. The README also calls leadCapture
      "origin-restricted" while its CORS is wide open.
- [ ] Stale code comments: "no IMAP polling wired up yet", "no multi-step sequence yet",
      `stopOnReply`'s "see note below" pointing at a non-existent note.
