'use strict';
// Paces prospect-website crawling. Runs every minute in the main API
// process (same as campaignDispatcher.js) — it only ever enqueues jobs, the
// actual fetch/PSI-call work happens in workers/prospectAuditWorker.js.
//
// The pacing constraint here is different from campaigns' per-day send cap:
// Google PageSpeed Insights recommends staying around ~1 request/sec
// sustained per API key, on top of a 25,000/day hard cap. This releases a
// small batch of prospects per tick (well under 1/sec) rather than one per
// tick like campaignDispatcher — one-per-minute would take 17+ days to
// crawl a 25k-prospect list, nowhere near using the available daily budget.
//
// Daily-count tracking is kept in-memory, not persisted — same
// single-process assumption already documented elsewhere this session
// (leadPipelineSync.js's per-email queue, campaignDispatcher's own pacing
// state). A restart resets the count to 0, which just means being slightly
// conservative for the rest of that day, not a correctness problem.

const cron = require('node-cron');
const ProspectAuditBatch = require('../models/ProspectAuditBatch');
const ProspectAudit = require('../models/ProspectAudit');
const { SystemSettings } = require('../models/index');
const { addProspectAuditToQueue } = require('../queues/prospectAuditQueue');
const { autoPushCompletedBatch } = require('../services/prospectPushService');

let sysLog = { info: () => {}, warn: () => {}, error: () => {} };
try { sysLog = require('../utils/sysLogger').logger; } catch {}

// Each prospect now costs up to TWO PSI calls (mobile always, desktop only
// when the mobile score is low enough for a gap to exist — see
// runTier2Desktop). Pacing and the daily budget are both charged at the
// worst case: overshooting Google's hard 25k/day cap stalls a crawl outright,
// while under-using it only means a slightly longer run.
const PSI_CALLS_PER_PROSPECT = 2;
const RELEASES_PER_TICK = 30; // 30 prospects/60s × 2 calls = 1 req/sec worst case
const DAILY_CAP_PER_KEY = 25000;

function startProspectAuditDispatcher() {
  cron.schedule('* * * * *', runProspectAuditTick);
  console.log('✅ Prospect audit dispatcher cron scheduled (every minute)');
  sysLog.info('PROSPECT_AUDIT', 'Dispatcher cron scheduled (every minute)');
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, local process time
}

// key -> { count, date } — reset whenever the date rolls over
const dailyCounts = new Map();

function remainingBudget(keyName) {
  const entry = dailyCounts.get(keyName);
  if (!entry || entry.date !== todayKey()) {
    dailyCounts.set(keyName, { count: 0, date: todayKey() });
    return DAILY_CAP_PER_KEY;
  }
  return Math.max(0, DAILY_CAP_PER_KEY - entry.count);
}

function recordUsage(keyName, n) {
  const entry = dailyCounts.get(keyName) || { count: 0, date: todayKey() };
  if (entry.date !== todayKey()) { entry.count = 0; entry.date = todayKey(); }
  entry.count += n;
  dailyCounts.set(keyName, entry);
}

let tickRunning = false;

async function runProspectAuditTick() {
  if (tickRunning) { console.warn('[ProspectAuditDispatcher] previous tick still running — skipping this one'); sysLog.warn('PROSPECT_AUDIT', 'Previous tick still running — skipped this one'); return; }
  tickRunning = true;
  try {
    await autoCompleteFinishedBatches();

    const batches = await ProspectAuditBatch.find({ status: 'crawling', isDeleted: { $ne: true } });
    // Deliberately quiet (no log line) when there's nothing active at all —
    // that's the normal resting state, not something worth watching. Once a
    // crawl is actually running, every tick below logs a summary so a
    // silent Crawler tab genuinely means "not crawling right now," not
    // "might be stuck."
    if (!batches.length) return;

    const settings = await SystemSettings.findOne().select('+pageSpeedIntegration.apiKeyEncrypted +pageSpeedIntegration.apiKey2Encrypted');
    const cfg = settings?.pageSpeedIntegration;
    const availableKeys = [];
    if (cfg?.apiKey) availableKeys.push('key1');
    if (cfg?.apiKey2) availableKeys.push('key2');
    if (!availableKeys.length) {
      sysLog.warn('PROSPECT_AUDIT', `Tick: ${batches.length} batch(es) waiting to crawl but no PageSpeed Insights API key is configured — add one in Settings → PageSpeed Insights`);
      return;
    }

    const batchIds = batches.map((b) => b._id);
    let released = 0;
    let keyIndex = 0;
    let stopReason = 'no more pending prospects';

    while (released < RELEASES_PER_TICK) {
      const keysWithBudget = availableKeys.filter((k) => remainingBudget(k) > 0);
      if (!keysWithBudget.length) { stopReason = 'daily PageSpeed Insights quota exhausted for all configured keys'; break; }

      const key = keysWithBudget[keyIndex % keysWithBudget.length];
      keyIndex++;

      const prospect = await ProspectAudit.findOneAndUpdate(
        { batch: { $in: batchIds }, crawlStatus: 'pending' },
        { crawlStatus: 'crawling', crawledAt: null },
        { new: true, sort: { createdAt: 1 } }
      );
      if (!prospect) break; // stopReason stays 'no more pending prospects' — the default

      try {
        await addProspectAuditToQueue(prospect._id, key);
        recordUsage(key, PSI_CALLS_PER_PROSPECT);
        released++;
      } catch (queueErr) {
        // Enqueueing failed (e.g. a Redis blip) — revert instead of leaving
        // this prospect stuck in 'crawling' with no job ever created for it.
        await ProspectAudit.updateOne({ _id: prospect._id }, { crawlStatus: 'pending' });
        console.error('[ProspectAuditDispatcher] enqueue failed:', queueErr.message);
        sysLog.error('PROSPECT_AUDIT', `Enqueue failed: ${queueErr.message}`);
        stopReason = 'a queue error occurred (see error log)';
        break;
      }
    }

    const budgetSummary = availableKeys.map((k) => `${k}: ${remainingBudget(k)} left today`).join(', ');
    sysLog.info('PROSPECT_AUDIT', `Tick: released ${released} across ${batches.length} active batch(es) — stopped because ${stopReason} (${budgetSummary})`);
  } catch (err) {
    console.error('[ProspectAuditDispatcher] tick error:', err.message);
    sysLog.error('PROSPECT_AUDIT', `Tick error: ${err.message}`);
  } finally {
    tickRunning = false;
  }
}

// A 'crawling' batch with no pending and no in-flight prospects left is
// done — flip it to 'completed' so the UI stops showing it as active.
async function autoCompleteFinishedBatches() {
  const active = await ProspectAuditBatch.find({ status: 'crawling', isDeleted: { $ne: true } });
  for (const batch of active) {
    const remaining = await ProspectAudit.countDocuments({ batch: batch._id, crawlStatus: { $in: ['pending', 'crawling'] } });
    if (remaining === 0) {
      await ProspectAuditBatch.updateOne({ _id: batch._id }, { status: 'completed' });
      // Opt-in only. A batch nobody configured falls straight through here and
      // the flow is exactly what it was: crawl, review, press the button.
      await autoPushCompletedBatch(batch).catch((e) => {
        // Belt and braces — autoPushCompletedBatch already records its own
        // failures. An exception escaping here would abandon the remaining
        // batches in this tick, so it is swallowed deliberately.
        console.error(`[ProspectAuditDispatcher] auto-push ${batch._id} threw:`, e.message);
        sysLog.error('PROSPECT_AUDIT', `Auto-push threw for batch ${batch._id}: ${e.message}`);
      });
    }
  }
}


module.exports = { startProspectAuditDispatcher, runProspectAuditTick };
