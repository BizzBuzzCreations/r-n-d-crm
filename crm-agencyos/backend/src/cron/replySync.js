'use strict';
// Polls each IMAP-enabled EmailAccount's INBOX for new mail and, when the
// sender matches a lead this account has already sent to, marks that lead
// 'replied' (stopping further campaign sends to them). Runs in the main API
// process — same pattern as campaignDispatcher.js — no separate PM2 process
// needed. Auto-detect + auto-stop only: this does NOT pull reply content
// into the CRM, it only flips the lead's status. Read the actual reply in
// the mailbox itself (Hostinger webmail, Outlook, etc.).

const cron = require('node-cron');
const { ImapFlow } = require('imapflow');
const EmailAccount = require('../models/EmailAccount');
const CampaignLead = require('../models/CampaignLead');
const Campaign = require('../models/Campaign');
const { resolveIPv4 } = require('../utils/ipv4');
const { syncCampaignLeadToPipeline } = require('../utils/leadPipelineSync');
const notifService = require('../services/notificationService');
const { notifyMainCrm } = require('../utils/mainCrmNotify');

let tickRunning = false;

function startReplySyncCron(io) {
  cron.schedule('*/5 * * * *', () => runReplySyncTick(io));
  console.log('✅ Reply-sync cron scheduled (every 5 minutes)');
}

async function runReplySyncTick(io) {
  if (tickRunning) { console.warn('[ReplySync] previous tick still running — skipping this one'); return; }
  tickRunning = true;
  try {
    const accounts = await EmailAccount.find({
      imapEnabled: true, isActive: true, isDeleted: { $ne: true },
    }).select('+imapPassEncrypted');
    for (const account of accounts) {
      await syncAccount(account, io).catch((e) => console.error(`[ReplySync] ${account.email}:`, e.message));
    }
  } catch (err) {
    console.error('[ReplySync] tick error:', err.message);
  } finally {
    tickRunning = false;
  }
}

async function syncAccount(account, io) {
  const ip = await resolveIPv4(account.imapHost);
  const client = new ImapFlow({
    host: ip || account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: { user: account.imapUser, pass: (account.imapPass || '').replace(/\s/g, '') },
    tls: { rejectUnauthorized: !account.imapAllowInsecureTLS, servername: account.imapHost },
    logger: false,
    connectionTimeout: 10000,
  });

  try {
    await client.connect();
  } catch (e) {
    // Same "don't let a broken mailbox fail silently forever" treatment as
    // the Test-connection button — surfaces in the UI without needing a
    // manual test click.
    await EmailAccount.updateOne(
      { _id: account._id },
      { lastImapVerifiedAt: new Date(), lastImapVerifyError: (e.message || 'IMAP connection failed').slice(0, 300) }
    );
    throw e;
  }

  try {
    const box = await client.getMailboxLock('INBOX');
    try {
      const status = await client.status('INBOX', { uidNext: true });
      const currentMaxUid = (status.uidNext || 1) - 1;

      if (account.imapLastUid == null) {
        // First-ever poll for this account — record the current watermark
        // without processing anything. See the model comment: a mailbox can
        // have years of history that were never campaign replies.
        await EmailAccount.updateOne({ _id: account._id }, { imapLastUid: currentMaxUid });
        return;
      }

      if (currentMaxUid <= account.imapLastUid) return; // nothing new

      const range = `${account.imapLastUid + 1}:*`;
      const fromAddresses = new Map(); // lowercase email -> true, deduped
      // `{ uid: true }` MUST be the third argument (fetch options), not part
      // of the query: inside the query it only asks for the UID to be
      // returned, while the *range* keeps being read as message sequence
      // numbers. Since UIDs climb forever and sequence numbers only go up to
      // the current message count, `${lastUid + 1}:*` then resolves to the
      // newest message alone (or the wrong ones entirely) — so every reply
      // after the first in a polling window was silently missed.
      for await (const msg of client.fetch(range, { envelope: true }, { uid: true })) {
        const from = msg.envelope?.from?.[0]?.address;
        if (from) fromAddresses.set(from.toLowerCase(), true);
      }

      if (fromAddresses.size) {
        const matched = await CampaignLead.find(
          { accountUsed: account._id, status: 'sent', email: { $in: [...fromAddresses.keys()] } }
        );
        if (matched.length) {
          await CampaignLead.updateMany(
            { _id: { $in: matched.map((m) => m._id) } },
            { status: 'replied', repliedAt: new Date() }
          );
          console.log(`[ReplySync] ${account.email}: ${matched.length} lead(s) marked replied`);

          const campaignIds = [...new Set(matched.map((m) => String(m.campaign)))];
          const campaigns = await Campaign.find({ _id: { $in: campaignIds } }).select('name subject').lean().catch(() => []);
          const campaignById = new Map(campaigns.map((c) => [String(c._id), c]));

          for (const m of matched) {
            syncCampaignLeadToPipeline(m, 'replied').catch(() => {});

            const campaign = campaignById.get(String(m.campaign));
            if (campaign) {
              const who = [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email;
              notifService.dispatchByRouting(io, 'campaign', {
                type: 'email_replied',
                priority: 'success',
                title: 'Lead replied',
                message: `${who} replied to an email in campaign "${campaign.name}"`,
                link: `/campaigns/${campaign._id}`,
                metadata: { campaignId: String(campaign._id), campaignLeadId: String(m._id) },
              }).catch(() => {});
              // Also report this to the main CRM — see utils/mainCrmNotify.
              notifyMainCrm({ type: 'email_replied', email: m.email, phone: m.phone, subject: campaign.subject, campaignName: campaign.name });
            }
          }
        }
      }

      await EmailAccount.updateOne({ _id: account._id }, { imapLastUid: currentMaxUid });
    } finally {
      box.release();
    }
  } finally {
    client.logout().catch(() => {});
  }
}

module.exports = { startReplySyncCron, runReplySyncTick };
