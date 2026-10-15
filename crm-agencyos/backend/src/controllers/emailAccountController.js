'use strict';
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const EmailAccount = require('../models/EmailAccount');
const audit = require('../services/auditService');
const { checkDomainAuth } = require('../utils/domainAuth');
const { resolveIPv4 } = require('../utils/ipv4');

// read_only was included here, which gave a read-only account full sight of
// (and, via the other handlers, edit/delete/test over) every user's connected
// mailbox — SMTP hosts, usernames and IMAP settings. The role is meant to be
// view-only on business data, never an admin tier for credentials.
const isPrivileged = (role) => role === 'admin' || role === 'manager';

// GET /api/email-accounts
// Admins/managers see every connected mailbox (needed to build company
// campaigns from anyone's account); everyone else only sees their own.
exports.getAccounts = async (req, res, next) => {
  try {
    const filter = { isDeleted: { $ne: true } };
    if (!isPrivileged(req.user.role)) filter.owner = req.user._id;
    const accounts = await EmailAccount.find(filter).populate('owner', 'name email').sort({ createdAt: -1 });
    res.json({ success: true, data: accounts });
  } catch (err) { next(err); }
};

// POST /api/email-accounts — any authenticated user connects their own mailbox
exports.createAccount = async (req, res, next) => {
  try {
    const {
      name, email, fromName, replyTo,
      smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, smtpAllowInsecureTLS,
      imapEnabled, imapHost, imapPort, imapSecure, imapUser, imapPass, imapAllowInsecureTLS,
      dailySendLimit, warmupEnabled, warmupDays, warmupStartLimit,
    } = req.body;

    if (!name?.trim() || !email?.trim() || !smtpHost?.trim() || !smtpUser?.trim() || !smtpPass) {
      return res.status(400).json({ success: false, message: 'name, email, smtpHost, smtpUser and smtpPass are required' });
    }
    if (imapEnabled && (!imapHost?.trim() || !imapUser?.trim() || !imapPass)) {
      return res.status(400).json({ success: false, message: 'imapHost, imapUser and imapPass are required when IMAP is enabled' });
    }

    const account = new EmailAccount({
      name, email,
      fromName: fromName || name,
      replyTo:  replyTo || '',
      owner:    req.user._id,
      smtpHost, smtpUser,
      smtpPort:   smtpPort ? Number(smtpPort) : 587,
      smtpSecure: !!smtpSecure,
      smtpAllowInsecureTLS: !!smtpAllowInsecureTLS,
      imapEnabled: !!imapEnabled,
      imapHost:   imapEnabled ? imapHost : '',
      imapPort:   imapPort ? Number(imapPort) : 993,
      imapSecure: imapSecure !== undefined ? !!imapSecure : true,
      imapUser:   imapEnabled ? imapUser : '',
      imapAllowInsecureTLS: !!imapAllowInsecureTLS,
      dailySendLimit: dailySendLimit ? Number(dailySendLimit) : 100,
      warmupEnabled: !!warmupEnabled,
      warmupStartDate: warmupEnabled ? new Date() : null,
      warmupDays: warmupDays ? Number(warmupDays) : 14,
      warmupStartLimit: warmupStartLimit ? Number(warmupStartLimit) : 5,
      createdBy: req.user._id,
    });
    account.smtpPass = smtpPass; // virtual setter → encrypts into smtpPassEncrypted
    if (imapEnabled && imapPass) account.imapPass = imapPass;
    await account.save();

    audit.log(req, { action: 'create', category: 'email_account', targetId: account._id, targetModel: 'EmailAccount', targetTitle: email });

    const safe = await EmailAccount.findById(account._id).populate('owner', 'name email');
    res.status(201).json({ success: true, data: safe });
  } catch (err) { next(err); }
};

// PUT /api/email-accounts/:id — owner, or an admin/manager, may edit
exports.updateAccount = async (req, res, next) => {
  try {
    const account = await EmailAccount.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!account) return res.status(404).json({ success: false, message: 'Email account not found' });
    if (String(account.owner) !== String(req.user._id) && !isPrivileged(req.user.role)) {
      return res.status(403).json({ success: false, message: 'You can only edit mailboxes you connected yourself' });
    }

    const {
      name, email, fromName, replyTo,
      smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, smtpAllowInsecureTLS,
      imapEnabled, imapHost, imapPort, imapSecure, imapUser, imapPass, imapAllowInsecureTLS,
      dailySendLimit, isActive, warmupEnabled, warmupDays, warmupStartLimit,
    } = req.body;

    // Detect whether anything that actually affects the SMTP/IMAP connection
    // changed, so a stale "last test passed" doesn't survive an edit that
    // was never re-tested — diagnoseCampaign and the UI both trust
    // lastSmtpVerifiedAt/lastSmtpVerifyError to mean "this exact config was
    // confirmed working", not just "some config once was".
    const smtpChanged = [
      [smtpHost, account.smtpHost], [smtpUser, account.smtpUser],
      [smtpPort !== undefined ? Number(smtpPort) : undefined, account.smtpPort],
      [smtpSecure !== undefined ? !!smtpSecure : undefined, account.smtpSecure],
      [smtpAllowInsecureTLS !== undefined ? !!smtpAllowInsecureTLS : undefined, account.smtpAllowInsecureTLS],
    ].some(([next, cur]) => next !== undefined && next !== cur) || !!smtpPass;
    const imapChanged = [
      [imapHost, account.imapHost], [imapUser, account.imapUser],
      [imapPort !== undefined ? Number(imapPort) : undefined, account.imapPort],
      [imapSecure !== undefined ? !!imapSecure : undefined, account.imapSecure],
      [imapAllowInsecureTLS !== undefined ? !!imapAllowInsecureTLS : undefined, account.imapAllowInsecureTLS],
    ].some(([next, cur]) => next !== undefined && next !== cur) || !!imapPass;

    if (name !== undefined) account.name = name;
    if (email !== undefined) account.email = email;
    if (fromName !== undefined) account.fromName = fromName;
    if (replyTo !== undefined) account.replyTo = replyTo;
    if (smtpHost !== undefined) account.smtpHost = smtpHost;
    if (smtpPort !== undefined) account.smtpPort = Number(smtpPort);
    if (smtpSecure !== undefined) account.smtpSecure = !!smtpSecure;
    if (smtpUser !== undefined) account.smtpUser = smtpUser;
    if (smtpAllowInsecureTLS !== undefined) account.smtpAllowInsecureTLS = !!smtpAllowInsecureTLS;
    if (dailySendLimit !== undefined) account.dailySendLimit = Number(dailySendLimit);
    if (isActive !== undefined) account.isActive = !!isActive;
    if (smtpPass) account.smtpPass = smtpPass; // only overwrite if a new password was actually provided
    if (smtpChanged) { account.lastSmtpVerifiedAt = null; account.lastSmtpVerifyError = ''; }

    if (warmupDays !== undefined) account.warmupDays = Number(warmupDays);
    if (warmupStartLimit !== undefined) account.warmupStartLimit = Number(warmupStartLimit);
    if (warmupEnabled !== undefined) {
      const turningOn = !!warmupEnabled && !account.warmupEnabled;
      account.warmupEnabled = !!warmupEnabled;
      if (turningOn) account.warmupStartDate = new Date(); // only stamp on the actual on-transition, not every save
      if (!warmupEnabled) account.warmupStartDate = null;
    }

    if (imapEnabled !== undefined) account.imapEnabled = !!imapEnabled;
    if (imapHost !== undefined) account.imapHost = imapHost;
    if (imapPort !== undefined) account.imapPort = Number(imapPort);
    if (imapSecure !== undefined) account.imapSecure = !!imapSecure;
    if (imapUser !== undefined) account.imapUser = imapUser;
    if (imapAllowInsecureTLS !== undefined) account.imapAllowInsecureTLS = !!imapAllowInsecureTLS;
    if (imapPass) account.imapPass = imapPass;
    if (imapChanged) { account.lastImapVerifiedAt = null; account.lastImapVerifyError = ''; }

    if (account.imapEnabled && (!account.imapHost || !account.imapUser)) {
      return res.status(400).json({ success: false, message: 'imapHost and imapUser are required when IMAP is enabled' });
    }

    await account.save();
    audit.log(req, { action: 'update', category: 'email_account', targetId: account._id, targetModel: 'EmailAccount', targetTitle: account.email });

    const safe = await EmailAccount.findById(account._id).populate('owner', 'name email');
    res.json({ success: true, data: safe });
  } catch (err) { next(err); }
};

// DELETE /api/email-accounts/:id  (soft delete) — owner, or an admin/manager
exports.deleteAccount = async (req, res, next) => {
  try {
    const account = await EmailAccount.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!account) return res.status(404).json({ success: false, message: 'Email account not found' });
    if (String(account.owner) !== String(req.user._id) && !isPrivileged(req.user.role)) {
      return res.status(403).json({ success: false, message: 'You can only remove mailboxes you connected yourself' });
    }
    account.isDeleted = true;
    account.isActive = false;
    await account.save();
    audit.log(req, { action: 'delete', category: 'email_account', targetId: account._id, targetModel: 'EmailAccount', targetTitle: account.email });
    res.json({ success: true, data: { _id: account._id } });
  } catch (err) { next(err); }
};

// ── Connection tests ──────────────────────────────────────────────────
async function testSmtp(account) {
  const ip = await resolveIPv4(account.smtpHost);
  const transporter = nodemailer.createTransport({
    host: ip || account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    auth: { user: account.smtpUser, pass: (account.smtpPass || '').replace(/\s/g, '') },
    tls: { rejectUnauthorized: !account.smtpAllowInsecureTLS, servername: account.smtpHost },
    connectionTimeout: 8000,
    family: 4, // avoid ENETUNREACH on hosts with unrouted IPv6 — see utils/ipv4.js
  });
  try {
    await transporter.verify();
    return { ok: true, message: 'SMTP connected' };
  } catch (e) {
    return { ok: false, message: e.message || 'SMTP verification failed' };
  } finally {
    transporter.close();
  }
}

async function testImap(account) {
  const ip = await resolveIPv4(account.imapHost);
  const client = new ImapFlow({
    host: ip || account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: { user: account.imapUser, pass: (account.imapPass || '').replace(/\s/g, '') },
    tls: { rejectUnauthorized: !account.imapAllowInsecureTLS, servername: account.imapHost },
    logger: false,
    connectionTimeout: 8000,
  });
  try {
    await client.connect();
    await client.logout();
    return { ok: true, message: 'IMAP connected' };
  } catch (e) {
    return { ok: false, message: e.message || 'IMAP verification failed' };
  } finally {
    // client.close() is synchronous (no Promise) unlike client.logout() above
    // — chaining .catch() on it throws "Cannot read properties of undefined
    // (reading 'catch')", which was masking the real IMAP error underneath.
    client.close();
  }
}

// POST /api/email-accounts/:id/test — verify SMTP (and IMAP, if enabled)
exports.testAccount = async (req, res, next) => {
  try {
    const account = await EmailAccount.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).select('+smtpPassEncrypted +imapPassEncrypted');
    if (!account) return res.status(404).json({ success: false, message: 'Email account not found' });
    if (String(account.owner) !== String(req.user._id) && !isPrivileged(req.user.role)) {
      return res.status(403).json({ success: false, message: 'You can only test mailboxes you connected yourself' });
    }

    const smtpResult = await testSmtp(account);
    account.lastSmtpVerifiedAt = new Date();
    account.lastSmtpVerifyError = smtpResult.ok ? '' : smtpResult.message.slice(0, 300);

    let imapResult = null;
    if (account.imapEnabled) {
      imapResult = await testImap(account);
      account.lastImapVerifiedAt = new Date();
      account.lastImapVerifyError = imapResult.ok ? '' : imapResult.message.slice(0, 300);
    }

    await account.save();

    const success = smtpResult.ok && (!imapResult || imapResult.ok);
    res.status(success ? 200 : 400).json({
      success,
      message: success ? 'Connection successful' : 'One or more connections failed — see details',
      smtp: smtpResult,
      imap: imapResult,
    });
  } catch (err) { next(err); }
};

// GET /api/email-accounts/:id/domain-check — SPF/DKIM/DMARC presence for
// this account's sending domain. Read-only diagnostics; doesn't touch DNS.
exports.checkDomain = async (req, res, next) => {
  try {
    const account = await EmailAccount.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!account) return res.status(404).json({ success: false, message: 'Email account not found' });
    const domain = account.email.split('@')[1];
    const result = await checkDomainAuth(domain);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
};
