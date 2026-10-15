'use strict';
// Public, unauthenticated endpoints — hit directly by the tracking snippet
// running in visitors' browsers (and, for /lead, by the tracked website's
// own backend). No `protect` middleware; identity comes from the
// per-website trackingId (public, ships in the snippet) or, for the
// lead-capture write, an additional apiSecret that's never re-displayed
// after creation. Every handler is deliberately tolerant of malformed/stale
// input — a broken tracking call must never surface an error to a real
// site visitor, so failures are logged and swallowed, not thrown.
const TrackedWebsite = require('../models/TrackedWebsite');
const WitVisitor = require('../models/WitVisitor');
const WitSession = require('../models/WitSession');
const WitPageview = require('../models/WitPageview');
const WitFormEvent = require('../models/WitFormEvent');
const Lead = require('../models/Lead');
const { parseUserAgent } = require('../utils/uaParser');
const { lookupGeo } = require('../utils/geoip');
const { categorize, domainOf } = require('../utils/trafficSource');
const { autoAssignLead } = require('../utils/leadAssignment');
const { secretsMatch } = require('../utils/secretsMatch');
const notifService = require('../services/notificationService');

const SESSION_TIMEOUT_MIN = 30;

// These handlers take their input straight from the public tracking
// endpoints, and several of these fields are used directly in Mongo queries
// (sessionId, visitorId, path). A JSON object value such as {"$ne": null}
// would otherwise reach the query as an operator and match/overwrite other
// websites' sessions and pageviews. Coerce every identifier to a string at
// the boundary — non-strings become '' and fail the existing required checks.
const str = (v) => (typeof v === 'string' ? v : (typeof v === 'number' ? String(v) : ''));

async function resolveWebsite(trackingId) {
  if (!trackingId) return null;
  // Coerced to a string: these bodies come straight off the public tracking
  // endpoints, so a JSON value like {"$ne": null} would otherwise reach the
  // query as a Mongo operator and resolve to an arbitrary active website.
  return TrackedWebsite.findOne({ trackingId: String(trackingId), isActive: true });
}

// Atomic upsert — two near-simultaneous pageviews for the same visitor (a
// fast double page-load, a prefetch, a retry) must not lose a lastSeenAt
// update to a stale read-modify-write. includeResultMetadata gives us
// updatedExisting, which is the only race-proof way to know "was this
// visitor already known" — comparing timestamps after the fact isn't,
// since concurrent requests each compute their own `now`.
async function touchVisitor(website, visitorId, geo) {
  const now = new Date();
  if (geo?.country) {
    // Only backfill geo if this visitor doesn't already have it — cheap
    // read, not part of the atomic op (geo is best-effort, not counted).
    const existing = await WitVisitor.findOne({ websiteId: website._id, visitorId }).select('country').lean();
    if (existing && existing.country) geo = null;
  }
  const result = await WitVisitor.findOneAndUpdate(
    { websiteId: website._id, visitorId },
    {
      $setOnInsert: {
        visitorId, websiteId: website._id, firstSeenAt: now,
        country: geo?.country || '', region: geo?.region || '', city: geo?.city || '',
      },
      $set: { lastSeenAt: now, ...(geo?.country ? geo : {}) },
    },
    { upsert: true, new: true, includeResultMetadata: true }
  );
  return { visitor: result.value, isNewVisitor: !result.lastErrorObject?.updatedExisting };
}

// @POST /api/wit/pageview
exports.pageview = async (req, res) => {
  res.status(204).end(); // never make a real visitor's page wait on this
  try {
    const b = req.body || {};
    const { isNewSession, utm } = b;
    const trackingId = str(b.trackingId), visitorId = str(b.visitorId), sessionId = str(b.sessionId);
    const url = str(b.url), path = str(b.path), title = str(b.title), referrer = str(b.referrer);
    if (!trackingId || !visitorId || !sessionId || !path) return;

    const website = await resolveWebsite(trackingId);
    if (!website) return;

    const ip = req.ip || req.socket?.remoteAddress || '';
    const geo = isNewSession ? await lookupGeo(ip) : null;
    const { visitor, isNewVisitor } = await touchVisitor(website, visitorId, geo);

    const now = new Date();
    const ua = parseUserAgent(req.headers['user-agent']);
    const trafficSource = categorize({ utmSource: utm?.source, utmMedium: utm?.medium, referrer, siteDomain: website.domain });

    // Atomic upsert-and-increment — the same fix as CampaignLead.openCount
    // elsewhere in this codebase: pageCount MUST come from $inc, never from
    // a load-then-save cycle, or two pageviews arriving close together will
    // stomp each other and silently under-count (which is exactly what
    // corrupts isBounce — a 2-page session gets miscounted as a bounce).
    const session = await WitSession.findOneAndUpdate(
      { sessionId },
      {
        $setOnInsert: {
          sessionId, visitorId, websiteId: website._id, isNewVisitor, startedAt: now,
          deviceType: ua.deviceType, browser: ua.browser, os: ua.os,
          referrer: referrer || '', referrerDomain: domainOf(referrer || ''),
          utmSource: utm?.source || '', utmMedium: utm?.medium || '',
          utmCampaign: utm?.campaign || '', utmTerm: utm?.term || '', utmContent: utm?.content || '',
          trafficSource, landingPage: path,
          country: geo?.country || visitor.country || '',
          region: geo?.region || visitor.region || '',
          city: geo?.city || visitor.city || '',
          ip,
        },
        $inc: { pageCount: 1 },
        $set: { exitPage: path, lastSeenAt: now },
      },
      { upsert: true, new: true }
    );

    // pageCount === 1 right after the atomic increment is unambiguous proof
    // this call is the one that created the session — race-proof, unlike
    // checking `!existingSessionFoundEarlier` from a separate read.
    if (session.pageCount === 1) {
      await WitVisitor.updateOne({ websiteId: website._id, visitorId }, { $inc: { totalSessions: 1 } });
    }

    const order = session.pageCount - 1; // 0-based position of THIS pageview within the session
    await WitPageview.create({ sessionId, visitorId, websiteId: website._id, url: url || path, path, title: title || '', order });

    // duration is soft "last write wins" — no correctness issue, only
    // cosmetic staleness risk. isBounce is NOT: each concurrent pageview
    // computes it from ITS OWN correctly-atomic-but-independently-obtained
    // pageCount snapshot, so two overlapping writes could still stomp each
    // other purely based on write ORDER (not the true final pageCount).
    // Fixed by making it a one-way transition — only ever flip bounce=true
    // to false, never write it back to true — which is race-proof because
    // every concurrent writer that agrees "false" agrees on the same value.
    const derivedUpdate = { duration: Math.round((now - session.startedAt) / 1000) };
    if (session.pageCount >= 2) derivedUpdate.isBounce = false;
    await WitSession.updateOne({ sessionId }, derivedUpdate);
  } catch (err) {
    console.error('[WIT] pageview failed:', err.message);
  }
};

// @POST /api/wit/pageend — sent via sendBeacon on unload/visibilitychange
// with this page's final duration + max scroll depth.
exports.pageend = async (req, res) => {
  res.status(204).end();
  try {
    const b = req.body || {};
    const { duration, maxScrollDepth } = b;
    const trackingId = str(b.trackingId), sessionId = str(b.sessionId), path = str(b.path);
    if (!trackingId || !sessionId || !path) return;
    const website = await resolveWebsite(trackingId);
    if (!website) return;

    const pv = await WitPageview.findOne({ sessionId, path, exitedAt: null }).sort({ enteredAt: -1 });
    if (pv) {
      pv.exitedAt = new Date();
      pv.duration = Math.max(0, Math.round(Number(duration) || 0));
      pv.maxScrollDepth = Math.min(100, Math.max(0, Math.round(Number(maxScrollDepth) || 0)));
      await pv.save();
    }

    const session = await WitSession.findOne({ sessionId });
    if (session) {
      session.lastSeenAt = new Date();
      session.duration = Math.round((session.lastSeenAt - session.startedAt) / 1000);
      session.endedAt = session.lastSeenAt;
      await session.save();
    }
  } catch (err) {
    console.error('[WIT] pageend failed:', err.message);
  }
};

// @POST /api/wit/ping — lightweight heartbeat while a tab stays open, so
// "Active Visitors" (last-5-minutes) stays accurate between pageviews.
exports.ping = async (req, res) => {
  res.status(204).end();
  try {
    const b = req.body || {};
    const trackingId = str(b.trackingId), visitorId = str(b.visitorId), sessionId = str(b.sessionId);
    if (!trackingId || !visitorId || !sessionId) return;
    const website = await resolveWebsite(trackingId);
    if (!website) return;
    const now = new Date();

    const session = await WitSession.findOne({ sessionId }).select('startedAt');
    await Promise.all([
      WitVisitor.updateOne({ websiteId: website._id, visitorId }, { lastSeenAt: now }),
      session
        ? WitSession.updateOne({ sessionId }, { lastSeenAt: now, duration: Math.round((now - session.startedAt) / 1000) })
        : Promise.resolve(),
    ]);
  } catch (err) {
    console.error('[WIT] ping failed:', err.message);
  }
};

// @POST /api/wit/form-event
exports.formEvent = async (req, res) => {
  res.status(204).end();
  try {
    const b = req.body || {};
    const { fieldOrder } = b;
    const trackingId = str(b.trackingId), sessionId = str(b.sessionId), visitorId = str(b.visitorId);
    const formId = str(b.formId), type = str(b.type), fieldName = str(b.fieldName), url = str(b.url), path = str(b.path);
    if (!trackingId || !sessionId || !visitorId || !formId || !type) return;
    const website = await resolveWebsite(trackingId);
    if (!website) return;
    await WitFormEvent.create({
      sessionId, visitorId, websiteId: website._id, formId, type,
      fieldName: fieldName || '', fieldOrder: fieldOrder ?? null, url: url || '', path: path || '',
    });
  } catch (err) {
    console.error('[WIT] form-event failed:', err.message);
  }
};

// @POST /api/wit/lead — called by the TRACKED WEBSITE'S OWN BACKEND (not the
// browser) right after it creates a lead, so the anonymous visitor session
// gets linked to a real CRM Lead. Requires apiSecret — this is a write that
// creates real pipeline data, unlike the read-only tracking calls above.
exports.captureLead = async (req, res) => {
  try {
    const {
      trackingId, apiSecret, visitorId, sessionId, companyName, contactPerson, email, phone, dealValue,
      // Consumer debt-advice intake (see models/Lead.js) — DebtFreePath's
      // form sends its debt-range select as a label like "20k-50k", not a
      // number — distinct from the B2B `dealValue` above. Accept it either
      // as a top-level `debtValue` OR nested under `customFields.debtValue`
      // (the caller has sent both shapes at different times — top-level
      // first, then moved it inside customFields alongside
      // contactPreference/message — so don't assume either is final).
      // `contactPreference`/`message`/`debtValue` are pulled out into their
      // own Lead columns (see below); anything else in customFields still
      // lands in the generic Lead.customFields map so a new form field
      // never silently vanishes even before this controller knows its name.
      debtValue, customFields,
    } = req.body || {};
    const debtAmountValue = debtValue ?? customFields?.debtValue ?? '';
    if (!trackingId || !apiSecret) {
      return res.status(400).json({ success: false, message: 'trackingId and apiSecret are required' });
    }
    const website = await TrackedWebsite.findOne({ trackingId, isActive: true }).select('+apiSecretEncrypted');
    if (!website || !secretsMatch(website.apiSecret, apiSecret)) {
      return res.status(401).json({ success: false, message: 'Invalid tracking credentials' });
    }
    if (!companyName || !contactPerson) {
      return res.status(400).json({ success: false, message: 'companyName and contactPerson are required' });
    }

    const session = sessionId ? await WitSession.findOne({ sessionId, websiteId: website._id }) : null;

    // Number(malformed string) is NaN, and NaN silently poisons every
    // revenue aggregate that later sums this field (bucket.revenue += NaN
    // turns the WHOLE report NaN, not just this one lead) — never store it.
    const parsedDealValue = Number(dealValue);
    const safeDealValue = Number.isFinite(parsedDealValue) ? parsedDealValue : 0;

    const assignedTo = await autoAssignLead();
    const lead = await Lead.create({
      companyName, contactPerson,
      email: email || '', phone: phone || '',
      dealValue: safeDealValue,
      // debtValue is a range label ("£5,000–£10,000" / "20k-50k"), not the
      // numeric dealValue above — see the destructure comment up top.
      debtAmount: debtAmountValue,
      contactPreference: customFields?.contactPreference || '',
      situation: customFields?.message || '',
      // Keeps the raw payload too (including contactPreference/message,
      // redundant with the dedicated fields above) so a future form field
      // this controller doesn't know about yet still lands somewhere
      // instead of silently vanishing.
      customFields: customFields && typeof customFields === 'object' ? customFields : undefined,
      status: 'New Lead',
      source: 'Web Form',
      assignedTo,
      websiteId: website._id,
      websiteVisitorId: visitorId || '',
      websiteSessionId: sessionId || '',
      landingPageUrl: session?.landingPage || '',
      // session?.utmSource is the actual MARKETING channel (google, facebook,
      // ...) captured from a `?utm_source=` query param on the visit that
      // started the session — genuinely empty for a direct/organic visit
      // with no such param, not a bug. But the Leads table's "Source
      // Website" column (this same field) is meant to answer "which
      // registered site did this come from", which IS always known here
      // regardless of UTM presence — website.name — so that's the fallback
      // rather than leaving the column blank for the (very common) case of
      // a visitor who didn't arrive via a tagged campaign link.
      utmSource: session?.utmSource || website.name,
      utmMedium: session?.utmMedium || '',
      utmCampaign: session?.utmCampaign || '',
      activities: [{
        type: 'create',
        text: `Lead captured from website form on ${website.name}${session ? ` (landing page: ${session.landingPage})` : ''}`,
        performedBy: 'System',
      }],
    });

    if (visitorId) {
      await WitVisitor.updateOne(
        { websiteId: website._id, visitorId },
        { leadId: lead._id, leadIdentifiedAt: new Date() }
      );
    }
    if (session) {
      session.leadId = lead._id;
      await session.save();
    }

    // Fire-and-forget — the caller here is the tracked site's own backend
    // waiting on this response (e.g. a Netlify function), not a live
    // visitor's browser, but the principle is the same as trackOpen/
    // requestCall: a notification write must never delay or risk the
    // response the integration is depending on.
    notifService.dispatchByRouting(req.app.get('io'), 'lead_capture', {
      type: 'lead_captured',
      priority: 'success',
      title: 'New lead captured',
      message: `${contactPerson} at ${companyName} submitted a form on ${website.name}`,
      link: '/leads',
      metadata: { leadId: String(lead._id), websiteId: String(website._id) },
    }).catch(() => {});

    res.status(201).json({ success: true, data: { leadId: lead._id, leadRef: lead.leadId } });
  } catch (err) {
    console.error('[WIT] captureLead failed:', err.message);
    res.status(500).json({ success: false, message: 'Failed to capture lead' });
  }
};
