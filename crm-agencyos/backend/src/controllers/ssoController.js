// NEW FILE for R&D CRM: backend/src/controllers/ssoController.js
//
// GET /api/auth/sso?token=<one-time token from the BBC Admin Portal>
//
// 1. Verifies the token with the portal's PUBLIC key (RS256), checks it was
//    issued by the portal, is meant for this CRM (aud = "rnd") and hasn't expired.
// 2. Makes sure the token is used only once (jti stored in SsoTokenUse).
// 3. Finds the user by email and sets the SAME refreshToken cookie a normal
//    password login sets (see authController.sendTokens).
// 4. Redirects to the app with ?sso=1 so the frontend swaps that cookie for an
//    access token (see INSTALL.md, frontend step).
//
// Nothing in the existing login flow is changed.
const fs    = require('fs');
const jwt   = require('jsonwebtoken');
const User  = require('../models/User');
const SsoTokenUse = require('../models/SsoTokenUse');
const audit = require('../services/auditService');

let cachedKey = null;
const publicKey = () => {
  if (!cachedKey) {
    const p = process.env.SSO_PUBLIC_KEY_PATH;
    if (!p) throw new Error('SSO_PUBLIC_KEY_PATH is not set');
    cachedKey = fs.readFileSync(p, 'utf8');
  }
  return cachedKey;
};

// Portal accounts must never land in a client-portal or read-only session.
const BLOCKED_ROLES = ['client'];

const appBase = (req) => {
  const fromEnv = process.env.CLIENT_URL && process.env.CLIENT_URL.replace(/\/$/, '');
  return fromEnv || `${req.protocol}://${req.get('host')}`;
};

exports.ssoLogin = async (req, res) => {
  const fail = (reason) => {
    console.warn(`[sso] rejected: ${reason} (ip ${req.ip})`);
    return res.redirect(`${appBase(req)}/login?sso_error=1`);
  };

  const token = req.query.token;
  if (!token || typeof token !== 'string') return fail('missing token');

  let claims;
  try {
    claims = jwt.verify(token, publicKey(), {
      algorithms: ['RS256'],
      audience:   'rnd',
      issuer:     process.env.SSO_ISSUER || 'bbc-admin-portal',
      clockTolerance: 10,
    });
  } catch (err) {
    return fail(`invalid token: ${err.message}`);
  }

  if (!claims.jti || !claims.sub) return fail('token missing jti/sub');

  // One-time use: the unique index on jti makes a replay fail with E11000.
  try {
    await SsoTokenUse.create({
      jti: claims.jti,
      email: claims.sub,
      expiresAt: new Date(claims.exp * 1000),
    });
  } catch (err) {
    if (err.code === 11000) return fail('token already used');
    return fail(`could not record token: ${err.message}`);
  }

  try {
    const user = await User.findOne({ email: String(claims.sub).toLowerCase() });
    if (!user) return fail(`no R&D user with email ${claims.sub}`);
    if (BLOCKED_ROLES.includes(user.role)) return fail(`role ${user.role} not allowed via SSO`);

    user.status = 'online';
    await user.save({ validateBeforeSave: false });

    audit.log(
      { user: { _id: user._id, name: user.name, role: user.role }, ip: req.ip, headers: req.headers },
      { action: 'login', category: 'auth', targetTitle: user.email,
        metadata: { role: user.role, via: 'admin-portal-sso', portalUser: claims.portal_user } }
    );

    // Same cookie + options as authController.sendTokens()
    res.cookie('refreshToken', user.getRefreshToken(), {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge:   30 * 24 * 60 * 60 * 1000,
    });
    return res.redirect(`${appBase(req)}/?sso=1`);
  } catch (err) {
    return fail(`server error: ${err.message}`);
  }
};
