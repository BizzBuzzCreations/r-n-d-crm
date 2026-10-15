'use strict';
// Connected social accounts (Facebook Pages / Instagram Business /
// LinkedIn Company Pages) — the real OAuth connect/callback dance, and
// account list/disconnect. This is the codebase's first authorization-code
// OAuth flow (every other integration uses a manually-pasted long-lived
// token) — see modules/social/services/socialService.js for how it resolves
// which provider to talk to.
const jwt = require('jsonwebtoken');
const SocialAccount = require('../models/SocialAccount');
const socialService = require('../modules/social/services/socialService');
let sysLog = { info: () => {}, warn: () => {}, error: () => {} };
try { sysLog = require('../utils/sysLogger').logger; } catch {}

const STATE_TTL_SECONDS = 600; // 10 minutes — plenty for a user to complete the platform's consent screen
const ALLOWED_PLATFORMS = ['meta', 'linkedin', 'x', 'youtube', 'tiktok'];

// req.protocol is unreliable here — nginx terminates HTTPS and proxies to
// this backend over plain HTTP without forwarding X-Forwarded-Proto, so
// Express (even with `trust proxy` set) sees every request as `http`. Every
// platform in this module (Meta, X, TikTok) rejects a non-HTTPS redirect
// URI outright, so guessing wrong here isn't a cosmetic issue — it breaks
// Connect entirely. Only actual localhost dev gets `http`; everything else
// is assumed HTTPS, which matches how this CRM is actually deployed.
function schemeFor(host) {
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http' : 'https';
}

function redirectUriFor(req, platform) {
  const host = req.get('host');
  return `${schemeFor(host)}://${host}/api/social/accounts/${platform}/callback`;
}

function frontendOrigin(req) {
  if (process.env.CLIENT_URL) return process.env.CLIENT_URL.replace(/\/$/, '');
  const host = req.get('host');
  return `${schemeFor(host)}://${host}`;
}

// @GET /api/social/accounts
exports.getAccounts = async (req, res, next) => {
  try {
    const accounts = await SocialAccount.find().populate('connectedBy', 'name email').sort({ createdAt: -1 });
    res.json({ success: true, data: accounts });
  } catch (err) { next(err); }
};

// @GET /api/social/accounts/:platform/connect — platform here is the
// app-config key ('meta' | 'linkedin' | 'x' | 'youtube' | 'tiktok'), not a
// SocialAccount.platform value.
exports.connect = async (req, res, next) => {
  try {
    const { platform } = req.params;
    if (!ALLOWED_PLATFORMS.includes(platform)) {
      return res.status(400).json({ success: false, message: `Unknown platform: ${platform}` });
    }

    const provider = await socialService.getProvider(platform);
    if (!provider) {
      return res.redirect(`${frontendOrigin(req)}/social-media/accounts?error=not_configured&platform=${platform}`);
    }

    // X and TikTok require PKCE — the verifier is generated here and
    // smuggled through inside the signed state JWT rather than a
    // server-side session store (stateless, single-process-safe). It only
    // round-trips through our own server (never exposed to the platform
    // beyond the derived code_challenge), and the token exchange is still
    // additionally authenticated with our confidential client_secret, so
    // this isn't the sole security boundary — just the extra layer these
    // two platforms mandate.
    const ProviderClass = socialService.REGISTRY[platform]?.ProviderClass;
    const pkce = ProviderClass?.generatePkce?.();

    const state = jwt.sign(
      {
        nonce: require('crypto').randomBytes(12).toString('hex'),
        userId: String(req.user._id),
        platform,
        ...(pkce ? { codeVerifier: pkce.verifier } : {}),
      },
      process.env.JWT_SECRET,
      { expiresIn: STATE_TTL_SECONDS }
    );

    const redirectUri = redirectUriFor(req, platform);
    const authUrl = provider.getAuthUrl(state, redirectUri, pkce?.challenge);
    res.redirect(authUrl);
  } catch (err) { next(err); }
};

// @GET /api/social/accounts/:platform/callback
exports.callback = async (req, res, next) => {
  const { platform } = req.params;
  const feOrigin = frontendOrigin(req);
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      sysLog.warn('SOCIAL', `OAuth callback (${platform}) — user denied or platform error: ${oauthError}`);
      return res.redirect(`${feOrigin}/social-media/accounts?error=denied`);
    }
    if (!code || !state) {
      return res.redirect(`${feOrigin}/social-media/accounts?error=missing_code`);
    }

    let decoded;
    try {
      decoded = jwt.verify(state, process.env.JWT_SECRET);
    } catch {
      return res.redirect(`${feOrigin}/social-media/accounts?error=invalid_state`);
    }
    if (decoded.platform !== platform) {
      return res.redirect(`${feOrigin}/social-media/accounts?error=invalid_state`);
    }

    const provider = await socialService.getProvider(platform);
    if (!provider) {
      return res.redirect(`${feOrigin}/social-media/accounts?error=not_configured`);
    }

    const redirectUri = redirectUriFor(req, platform);
    const tokens = await provider.exchangeCode(code, redirectUri, decoded.codeVerifier);
    const candidates = await provider.getAccountInfo(tokens.accessToken);

    let connectedCount = 0;
    for (const c of candidates) {
      // Load-then-save, NOT findOneAndUpdate: accessToken/refreshToken are
      // Mongoose *virtuals* whose setters do the encrypting (see
      // models/SocialAccount.js). Mongoose strips unknown/virtual paths out
      // of an update object while casting it, so a $set of those two keys is
      // silently dropped — the document saves fine, minus its tokens, and
      // every publish then fails with an empty credential. Assigning on a
      // real document runs the setters and populates
      // accessTokenEncrypted/refreshTokenEncrypted as intended.
      let account = await SocialAccount.findOne({
        platform: c.platform,
        platformAccountId: c.platformAccountId,
      });
      if (!account) {
        account = new SocialAccount({ platform: c.platform, platformAccountId: c.platformAccountId });
      }
      account.accountName    = c.accountName;
      account.username       = c.username || '';
      account.profileImage   = c.profileImage || '';
      account.connectedBy    = decoded.userId;
      account.accessToken    = c.accessToken;            // virtual setter -> encrypted
      account.refreshToken   = tokens.refreshToken || ''; // virtual setter -> encrypted
      account.tokenExpiresAt = tokens.expiresAt || null;
      account.scopes         = tokens.scopes || [];
      account.status         = 'active';
      account.metadata       = c.metadata || {};
      await account.save();
      connectedCount++;
    }

    sysLog.info('SOCIAL', `Connected ${connectedCount} account(s) via ${platform} OAuth`);
    res.redirect(`${feOrigin}/social-media/accounts?connected=${connectedCount}`);
  } catch (err) {
    sysLog.error('SOCIAL', `OAuth callback (${platform}) failed: ${err.message}`);
    res.redirect(`${feOrigin}/social-media/accounts?error=connect_failed`);
  }
};

// @DELETE /api/social/accounts/:id
exports.deleteAccount = async (req, res, next) => {
  try {
    const account = await SocialAccount.findByIdAndDelete(req.params.id);
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
    sysLog.info('SOCIAL', `Disconnected ${account.platform} account "${account.accountName}"`);
    res.json({ success: true });
  } catch (err) { next(err); }
};
