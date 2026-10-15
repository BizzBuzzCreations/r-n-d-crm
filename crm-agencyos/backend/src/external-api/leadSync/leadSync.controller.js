'use strict';
// Everything the main CRM calls on rndCRM for leads: polling for leads it
// should sync status back for, pushing status changes in, and pulling
// campaign email activity out. All three routes require apiKeyAuth (see
// leadSync.routes.js) — req.apiKey is set by the time these run.
const Lead = require('../../models/Lead');
const CampaignLead = require('../../models/CampaignLead');
const EmailLog = require('../../models/EmailLog');

// Main CRM's own lead-status name → rndCRM Lead status. Replaces an earlier,
// wrong guess at this table (generic Vicidial disposition codes that don't
// actually match this system) with the real list the client pulled directly
// from their CRM's status settings, each already bucketed into one of 5
// categories (Not Confirmed / Lost / In Progress / Potential / Converted)
// that map cleanly 1:1 onto rndCRM's own 5 statuses. Kept server-side rather
// than in the n8n workflow so there's exactly one place to update if the
// client adds/renames a status, and n8n/the main CRM never need to know
// rndCRM's status vocabulary — they just forward whatever status name is on
// the lead.
//
// "In Progress" is a wide bucket (everything from a fresh callback to
// paperwork-stage names like "IVA Agreed"/"Full Docs Back") — mapped
// uniformly to First Contact rather than guessing per-name which are closer
// to a done deal. Only "Converted" (an actual confirmed win — IVA verified,
// pack back, PBS sold) maps to Won; only "Potential" (on hold, awaiting next
// step) maps to Proposal Sent. Revisit if finer granularity is wanted later.
const DISPOSITION_STATUS_MAP = {
  // NOT CONFIRMED — call happened but outcome isn't confirmed yet
  '3 WAY CALLS': 'New Lead', ALDMP: 'New Lead', DNC: 'New Lead',

  // LOST — disqualified, declined, or already handled elsewhere
  'ALREADY IN IVA': 'Lost', 'ALREADY IN TRUST DEED': 'Lost', CHARITY: 'Lost',
  'CHARITY DUPLICATE': 'Lost', 'CLAW BACK': 'Lost', DRO: 'Lost', 'HIGH DI': 'Lost',
  HOAX: 'Lost', 'HOME OWNER': 'Lost', IRATE: 'Lost', 'LANGUAGE BARRIER': 'Lost',
  'LOW DEBTS': 'Lost', 'LOW INCOME': 'Lost', 'NOT INTERESTED': 'Lost',
  'NOT STRUGGLING': 'Lost', 'PRIVATE TENANT': 'Lost', 'SIP FAILED': 'Lost',
  UNQUALIFIED: 'Lost',

  // IN PROGRESS — a real contact/engagement is happening, not yet resolved
  'ANSWERING MACHINE': 'First Contact', APPROVALS: 'First Contact',
  'AWAITING MORE DOCS': 'First Contact', 'AWAITING PICTURES': 'First Contact',
  'CALL BACK': 'First Contact', CHASE: 'First Contact',
  'CONTACTED OVER THE PHONE': 'First Contact', DMP: 'First Contact',
  'DMP AGREED': 'First Contact', 'DMP XFER': 'First Contact',
  "DOC'S BACK": 'First Contact', 'DUPLICATE LEAD': 'First Contact',
  'EMAIL / WHTATSAPP CHASED': 'First Contact', 'EXTERNAL LEAD': 'First Contact',
  'FULL DOCS BACK': 'First Contact', 'HANG UP HAS DEBTS': 'First Contact',
  'HAS DEBTS BUSY': 'First Contact', 'HAS DEBTS NOT INTERESTED': 'First Contact',
  'HOTKEY DONE': 'First Contact', 'IP QUERIES': 'First Contact',
  'IVA AGREED': 'First Contact', 'IVA XFER': 'First Contact', 'LEAD IN': 'First Contact',
  'MI NEEDED': 'First Contact', 'MI RESOLVED': 'First Contact', 'NO CONTACT': 'First Contact',
  'PART PACK BACK': 'First Contact', 'PICTURES RECEIVED': 'First Contact',
  'SENT TO CLEAR START': 'First Contact', 'SENT TO IP': 'First Contact',
  'SIP BOOKED': 'First Contact', 'STRUCTURE COMPLETED': 'First Contact',
  'TRYING RECONNECT': 'First Contact', 'VOICE MAIL / BUSY': 'First Contact',

  // POTENTIAL — on hold / awaiting the next step, still live
  'IVA HOLD': 'Proposal Sent', 'ON HOLD': 'Proposal Sent', 'PACK OUT': 'Proposal Sent',

  // CONVERTED — an actual confirmed win
  'IVA IN HOUSE VERIFIED': 'Won', 'PACK BACK': 'Won', 'PBS SOLD': 'Won', VERIFIED: 'Won',
};

// @GET /api/lead-sync/pending — called by the polling n8n workflow BEFORE it
// touches the main CRM, so it never has to fetch/filter that system's full
// lead list. Returns only leads rndCRM is still waiting to hear about: ones
// with an externalLeadId (created via the main CRM) whose status hasn't
// already reached a terminal state. Once a lead is Won or Lost it drops out
// of this list on its own — no further syncing needed, keeps the list from
// growing forever.
exports.getPendingSyncLeads = async (req, res, next) => {
  try {
    const leads = await Lead.find({
      externalLeadId: { $exists: true, $ne: '' },
      status: { $nin: ['Won', 'Lost'] },
    }).select('externalLeadId phone status').lean();

    res.json({
      success: true,
      // phone is included because the main CRM's lookup endpoint only
      // accepts id/uid/phone — not an arbitrary external ID string — so
      // that's what the caller needs to look this lead up over there.
      // externalLeadId travels back through unchanged, for the sync-back
      // call afterward (that one matches against rndCRM's own record, which
      // does know its externalLeadId).
      data: leads.map((l) => ({ externalLeadId: l.externalLeadId, phone: l.phone, status: l.status })),
    });
  } catch (err) { next(err); }
};

// @POST /api/lead-sync/status — called by the MAIN CRM's own backend (not a
// browser, no CRM user session), whenever a lead it owns changes status or
// deal value. rndCRM only ever sees a lead once at creation (via
// leadController.createLead's externalLeadId) — without this webhook,
// "Qualified Leads" / "Won Customers" / "Revenue" / "ROI" / "ROAS" in the
// Meta Ads dashboard would stay stuck at whatever the lead's status was the
// moment it was created, forever.
exports.syncLeadStatus = async (req, res, next) => {
  try {
    const { externalLeadId, status: explicitStatus, disposition, dealValue, externalAssignedToName } = req.body || {};
    if (!externalLeadId) {
      return res.status(400).json({ success: false, message: 'externalLeadId is required' });
    }

    // String()-coerced: an API-key holder sending {"$gt": ""} would
    // otherwise match an arbitrary synced lead and overwrite its status,
    // deal value and assignee.
    const lead = await Lead.findOne({ externalLeadId: String(externalLeadId) });
    if (!lead) {
      return res.status(404).json({ success: false, message: 'No rndCRM lead found with that externalLeadId' });
    }

    // Prefer an already-mapped status if the caller sends one explicitly;
    // otherwise resolve it from the raw Vicidial disposition code, so the
    // caller (n8n) never has to know rndCRM's status vocabulary at all.
    const VALID_STATUSES = ['New Lead', 'First Contact', 'Proposal Sent', 'Won', 'Lost'];
    let status = explicitStatus;
    if (status === undefined && disposition !== undefined) {
      const mapped = DISPOSITION_STATUS_MAP[String(disposition).toUpperCase().trim()];
      if (!mapped) {
        return res.status(400).json({ success: false, message: `Unrecognized disposition code: "${disposition}"` });
      }
      status = mapped;
    }

    const changes = [];
    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ success: false, message: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      if (status !== lead.status) {
        changes.push(`status: ${lead.status} → ${status}${disposition ? ` (disposition: ${disposition})` : ''}`);
        lead.status = status;
      }
    }
    // Raw main-CRM status text, kept verbatim regardless of whether it moved
    // the collapsed `status` bucket — e.g. "IVA Agreed" -> "Full Docs Back"
    // are both First Contact, but reps should still see the exact stage.
    if (disposition !== undefined && disposition !== lead.externalStatusLabel) {
      changes.push(`stage: ${lead.externalStatusLabel || '(none)'} → ${disposition}`);
      lead.externalStatusLabel = disposition;
    }
    if (dealValue !== undefined) {
      const n = Number(dealValue);
      if (Number.isFinite(n) && n !== lead.dealValue) { changes.push(`dealValue: ${lead.dealValue} → ${n}`); lead.dealValue = n; }
    }
    if (externalAssignedToName !== undefined && externalAssignedToName !== lead.externalAssignedToName) {
      changes.push(`assigned agent: ${lead.externalAssignedToName || '(none)'} → ${externalAssignedToName}`);
      lead.externalAssignedToName = externalAssignedToName;
    }

    if (changes.length) {
      lead.activities.push({ type: 'status_change', text: `Synced from main CRM: ${changes.join(', ')}`, performedBy: 'System' });
      await lead.save();
    }

    res.json({
      success: true,
      data: {
        leadId: lead._id, status: lead.status, externalStatusLabel: lead.externalStatusLabel,
        dealValue: lead.dealValue, externalAssignedToName: lead.externalAssignedToName, changed: changes.length > 0,
      },
    });
  } catch (err) { next(err); }
};

// @GET /api/lead-sync/email-activity?email=<email>&secret=<secret>
// Read-only pull for the main CRM: given a lead's email, return everything
// rndCRM knows about outreach to that address — every campaign it was ever
// part of (verification, sends, opens, clicks, replies, unsubscribes, call
// requests) plus any one-off emails sent from the Lead detail page. Reverse
// direction of syncLeadStatus above (main CRM pushes status *in*; this pulls
// engagement *out*).
//
// Lookup is by email, not externalLeadId — the main CRM's own record may not
// always carry rndCRM's internal ID, but it always knows the email. Lead.email
// has no uniqueness constraint in this schema (CSV imports/Web Form/Meta Ads
// leads can collide), so when more than one Lead shares the address this
// picks the most recently updated one as the "best match" rather than failing
// or guessing — see conversation/decision that landed on this over enforcing
// a hard-unique index (would need a data migration first).
//
// CampaignLead (the actual send/open/click/reply ledger) is the primary
// source, not Lead — a Lead document only exists here for addresses that
// converted (replied/hot) or were synced in from the main CRM, but most
// campaign recipients never cross that bar. Gating this endpoint on "a Lead
// exists" would 404 for the majority of real recipients the main CRM might
// ask about, so Lead is treated as optional enrichment (company/contact
// name, externalLeadId) layered on top of whatever CampaignLead/EmailLog
// activity is found — never a hard requirement to return data.
exports.getLeadEmailActivity = async (req, res, next) => {
  try {
    const { email } = req.query;
    if (!email || !String(email).trim()) {
      return res.status(400).json({ success: false, message: 'email is required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    // Case-insensitive exact match — Lead.email isn't lowercased on save
    // (unlike CampaignLead.email, which is), so this can't just be a
    // straight equality lookup.
    const [lead, campaignLeads] = await Promise.all([
      Lead.findOne({
        email: { $regex: `^${normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
      }).sort({ updatedAt: -1 }),
      CampaignLead.find({ email: normalizedEmail })
        .populate('campaign', 'name status subject')
        .populate('accountUsed', 'email')
        .sort({ sentAt: -1 })
        .lean(),
    ]);

    const directEmails = lead
      ? await EmailLog.find({ leadId: lead._id }).sort({ sentAt: -1 }).limit(100).lean()
      : [];

    if (!lead && campaignLeads.length === 0 && directEmails.length === 0) {
      return res.status(404).json({ success: false, message: 'No email activity found for that email' });
    }

    const campaigns = campaignLeads
      .filter((cl) => cl.campaign) // drop rows whose campaign was hard-deleted
      .map((cl) => ({
        campaignId: cl.campaign._id,
        campaignName: cl.campaign.name,
        campaignStatus: cl.campaign.status,
        subject: cl.campaign.subject,
        status: cl.status,
        accountUsed: cl.accountUsed?.email || '',
        verification: {
          status: cl.verificationStatus,
          provider: cl.provider,
          verifiedAt: cl.verifiedAt,
        },
        engagement: {
          sentAt: cl.sentAt,
          openCount: cl.openCount,
          firstOpenedAt: cl.opens?.[0]?.at || null,
          lastOpenedAt: cl.openedAt,
          opens: cl.opens || [],
          clickCount: cl.clickCount,
          clicks: cl.clicks || [],
          repliedAt: cl.repliedAt,
          unsubscribedAt: cl.unsubscribedAt,
          callRequested: cl.callRequested,
          callRequestedAt: cl.callRequestedAt,
        },
      }));

    const lastEngagementAt = campaigns.reduce((latest, c) => {
      const candidates = [c.engagement.lastOpenedAt, c.engagement.repliedAt, c.engagement.sentAt].filter(Boolean);
      const campaignLatest = candidates.length ? new Date(Math.max(...candidates.map((d) => new Date(d)))) : null;
      if (!campaignLatest) return latest;
      return !latest || campaignLatest > latest ? campaignLatest : latest;
    }, null);

    res.json({
      success: true,
      data: {
        // lead is null when this address was only ever a campaign recipient
        // that never converted/synced into a Lead document here — see the
        // comment above the handler. Callers should treat it as optional.
        lead: lead
          ? {
              externalLeadId: lead.externalLeadId || '',
              email: lead.email,
              companyName: lead.companyName,
              contactPerson: lead.contactPerson,
            }
          : null,
        summary: {
          totalCampaigns: campaigns.length,
          totalEmailsSent: campaigns.filter((c) => c.engagement.sentAt).length + directEmails.length,
          totalOpens: campaigns.reduce((s, c) => s + (c.engagement.openCount || 0), 0),
          totalClicks: campaigns.reduce((s, c) => s + (c.engagement.clickCount || 0), 0),
          totalReplies: campaigns.filter((c) => c.engagement.repliedAt).length,
          lastEngagementAt,
          convertedFromCampaign: lead?.campaignAttribution?.id
            ? { id: lead.campaignAttribution.id, name: lead.campaignAttribution.name }
            : null,
        },
        campaigns,
        directEmails: directEmails.map((e) => ({
          subject: e.subject,
          sentAt: e.sentAt,
          status: e.status,
          messageId: e.messageId,
        })),
      },
    });
  } catch (err) { next(err); }
};
