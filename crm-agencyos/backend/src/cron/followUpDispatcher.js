'use strict';
// Auto-sends a one-time follow-up email to leads that have gone "hot"
// (repeat opens past HOT_OPEN_THRESHOLD, or a "Request a Call" click) in a
// campaign that has settings.followUpEnabled turned on. Mirrors
// cron/campaignDispatcher.js's structure closely — same tickRunning guard,
// same sending-window/account-cap checks — but is deliberately its own file
// rather than folded into that dispatcher, since it reacts to campaigns in
// BOTH 'active' and 'completed' states (hot signals usually arrive after the
// primary send has finished), not just 'active' ones.

const cron = require('node-cron');
const Campaign     = require('../models/Campaign');
const CampaignLead = require('../models/CampaignLead');
const EmailAccount = require('../models/EmailAccount');
const { addFollowUpEmailToQueue } = require('../queues/campaignQueue');
const { effectiveDailyLimit } = require('../utils/warmup');
const { isWithinSendingWindow } = require('../utils/sendingWindow');
const { HOT_OPEN_THRESHOLD, LEGACY_RAW_OPEN_THRESHOLD } = require('../utils/campaignConstants');

function startFollowUpDispatcher() {
  cron.schedule('*/5 * * * *', runFollowUpTick);
  console.log('✅ Follow-up dispatcher cron scheduled (every 5 minutes)');
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Same overlapping-tick protection as campaignDispatcher.js/replySync.js.
let tickRunning = false;

async function runFollowUpTick() {
  if (tickRunning) { console.warn('[FollowUpDispatcher] previous tick still running — skipping this one'); return; }
  tickRunning = true;
  try {
    const campaigns = await Campaign.find({
      'settings.followUpEnabled': true,
      status: { $in: ['active', 'completed'] }, // 'paused'/'draft'/'scheduled' excluded on purpose
      isDeleted: { $ne: true },
    });
    for (const campaign of campaigns) {
      await dispatchOneFollowUp(campaign).catch((e) => console.error(`[FollowUpDispatcher] ${campaign._id}:`, e.message));
    }
  } catch (err) {
    console.error('[FollowUpDispatcher] tick error:', err.message);
  } finally {
    tickRunning = false;
  }
}

async function dispatchOneFollowUp(campaign) {
  const settings = campaign.settings || {};

  // Never queue a follow-up with nothing in it. followUpEnabled can be true
  // while the subject/body are still empty (the UI validates them on save,
  // but the flag and the content are separate fields and older campaigns may
  // predate that validation) — the worker would happily send a blank email.
  if (!String(settings.followUpSubject || '').trim() || !String(settings.followUpBodyHtml || '').trim()) {
    return;
  }

  // Same sending-hours window as the primary send — no separate
  // follow-up-specific hours setting.
  if (!isWithinSendingWindow(settings)) return;

  const accountIds = (settings.accounts || []).map(String);
  if (!accountIds.length) return;

  const accounts = await EmailAccount.find({ _id: { $in: accountIds }, isActive: true, isDeleted: { $ne: true } });
  if (!accounts.length) return;

  // Per-account daily cap — shared across ALL sends through that account,
  // original campaign sends AND follow-ups alike, since it's the mailbox's
  // reputation budget that's actually being protected here, not any one
  // campaign's or feature's own count. Union both accounting paths.
  const [originalSentToday, followUpSentToday] = await Promise.all([
    CampaignLead.aggregate([
      { $match: { accountUsed: { $in: accounts.map((a) => a._id) }, status: 'sent', sentAt: { $gte: startOfToday() } } },
      { $group: { _id: '$accountUsed', count: { $sum: 1 } } },
    ]),
    CampaignLead.aggregate([
      { $match: { followUpAccountUsed: { $in: accounts.map((a) => a._id) }, followUpStatus: 'sent', followUpSentAt: { $gte: startOfToday() } } },
      { $group: { _id: '$followUpAccountUsed', count: { $sum: 1 } } },
    ]),
  ]);
  const sentTodayByAccount = new Map();
  for (const r of originalSentToday) sentTodayByAccount.set(String(r._id), (sentTodayByAccount.get(String(r._id)) || 0) + r.count);
  for (const r of followUpSentToday) sentTodayByAccount.set(String(r._id), (sentTodayByAccount.get(String(r._id)) || 0) + r.count);

  const availableAccounts = accounts.filter(
    (a) => (sentTodayByAccount.get(String(a._id)) || 0) < (effectiveDailyLimit(a) || Infinity)
  );
  if (!availableAccounts.length) return;

  // One eligible hot lead, oldest qualifying event first. `status: 'sent'`
  // excludes leads that have since replied/bounced/unsubscribed/failed —
  // an automated follow-up to any of those would be wrong.
  const cutoff = new Date(Date.now() - (settings.followUpDelayHours || 0) * 3600000);
  const lead = await CampaignLead.findOne({
    campaign: campaign._id,
    status: 'sent',
    followUpStatus: 'none',
    $or: [
      // Qualified (non-scanner) opens — the primary rule, threshold 2.
      { humanOpenCount: { $gte: HOT_OPEN_THRESHOLD }, openedAt: { $lte: cutoff } },
      // Leads that predate humanOpenCount keep the original raw-open rule so
      // in-flight campaigns don't lose their follow-ups. See campaignConstants.
      { openCount: { $gte: LEGACY_RAW_OPEN_THRESHOLD }, openedAt: { $lte: cutoff } },
      { callRequested: true, callRequestedAt: { $lte: cutoff } },
    ],
  }).sort({ openedAt: 1 });
  if (!lead) return;

  // Round-robin across available accounts, independent of the primary
  // dispatcher's own lastAccountIndex (that index paces new-lead volume;
  // follow-up volume is a much smaller, separate stream).
  const account = availableAccounts[Math.floor(Math.random() * availableAccounts.length)];

  lead.followUpStatus = 'queued';
  lead.followUpAccountUsed = account._id;
  await lead.save();

  try {
    await addFollowUpEmailToQueue(lead._id);
  } catch (queueErr) {
    lead.followUpStatus = 'none';
    lead.followUpAccountUsed = null;
    await lead.save();
    throw queueErr;
  }
}

module.exports = { startFollowUpDispatcher, runFollowUpTick };
