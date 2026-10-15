'use strict';
// Lead intake open to ANY external site, not a pre-registered allowlist
// (see sources.js) — no origin restriction, and an API key is accepted but
// OPTIONAL (see optionalApiKeyAuth in leadCapture.routes.js). This is meant
// to be droppable into many different sites with zero setup, whether or
// not that site has anywhere safe to hold a secret: a truly frontend-only
// site calls it anonymously, a site with its own backend/serverless
// function (e.g. a Netlify Function) can call it with a real key instead.
// Structurally mirrors witPublicController.captureLead (same "create a
// Lead with source Web Form, auto-assign, log an activity" shape) but
// without any of the visitor/session tracking machinery, since that
// requires the wit.js snippet this flow deliberately doesn't have.
const Lead = require('../../models/Lead');
const { autoAssignLead } = require('../../utils/leadAssignment');
const SOURCE_NAMES = require('./sources');
const notifService = require('../../services/notificationService');

// @POST /api/lead-capture/:source
exports.captureLead = async (req, res) => {
  try {
    // :source is a free-form label, not a credential or a registration
    // requirement — any value works. sources.js just maps a few known
    // slugs to a nicer display name; anything else falls back to the raw
    // slug as-is, so a brand-new site works immediately with no setup here.
    const sourceLabel = SOURCE_NAMES[req.params.source] || req.params.source;

    const { name, email, phone, dealValue, companyName, debtAmount, contactPreference, situation } = req.body || {};

    // Classic spam honeypot: a hidden form field real visitors never see or
    // fill, but naive bots that auto-fill every input on a page do. Reply
    // 201 as if it worked — never tell a bot its submission was filtered,
    // or it just adapts.
    if (req.body?.website) {
      return res.status(201).json({ success: true, message: 'Thank you' });
    }

    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'name is required' });
    }

    const parsedDealValue = Number(dealValue);
    const safeDealValue = Number.isFinite(parsedDealValue) ? parsedDealValue : 0;

    const assignedTo = await autoAssignLead();
    const lead = await Lead.create({
      // This flow captures personal debt-advice leads, not B2B companies —
      // Lead.companyName/contactPerson are required regardless, so
      // companyName falls back to the person's own name when the form (as
      // expected) doesn't collect one, rather than forcing every embedding
      // site to invent a fake company field.
      companyName: companyName?.trim() || name.trim(),
      contactPerson: name.trim(),
      email: email || '',
      phone: phone || '',
      dealValue: safeDealValue,
      status: 'New Lead',
      source: 'Web Form',
      assignedTo,
      utmSource: sourceLabel,
      debtAmount: debtAmount || '',
      contactPreference: contactPreference || '',
      situation: situation || '',
      activities: [{
        type: 'create',
        // Notes whether this came in via a verified API key (a trusted
        // server-side caller) or fully anonymously, so the activity trail
        // shows the actual trust level of the submission, not just "web
        // form" for every source regardless of how it was authenticated.
        text: req.apiKey
          ? `Lead captured from ${sourceLabel} via API key "${req.apiKey.name}"`
          : `Lead captured from public form on ${sourceLabel}`,
        performedBy: 'System',
      }],
    });

    const io = req.app.get('io');
    io?.to('leads').emit('lead:created', lead.toObject());

    // Fire-and-forget, same principle as witPublicController.captureLead —
    // never let a notification write delay or risk this response.
    notifService.dispatchByRouting(io, 'lead_capture', {
      type: 'lead_captured',
      priority: 'success',
      title: 'New lead captured',
      message: `${name.trim()} submitted a form via ${sourceLabel}`,
      link: '/leads',
      metadata: { leadId: String(lead._id), source: sourceLabel },
    }).catch(() => {});

    res.status(201).json({ success: true, data: { leadId: lead._id, leadRef: lead.leadId } });
  } catch (err) {
    console.error('[LeadCapture] captureLead failed:', err.message);
    res.status(500).json({ success: false, message: 'Failed to capture lead' });
  }
};
