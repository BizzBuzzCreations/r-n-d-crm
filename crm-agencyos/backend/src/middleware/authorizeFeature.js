'use strict';
// Real, admin-configurable, per-feature access control — the roles/specific
// users who may hit a given feature's routes are read from
// SystemSettings.featureAccess (Settings → Feature Access Control), not
// hardcoded. Additive OR semantics, same as notificationRouting: a request
// is allowed if the caller's role is in the configured roles[] OR their own
// id is in userIds[] — so a specific person can be granted access with no
// role selected at all.
const { SystemSettings } = require('../models/index');

const CACHE_TTL_MS = 15 * 1000; // same tolerance as the existing rateLimits cache
let cache = { at: 0, map: null };

async function getFeatureAccessMap() {
  if (cache.map && Date.now() - cache.at < CACHE_TTL_MS) return cache.map;
  try {
    // Deliberately NOT .lean() — a lean query skips Mongoose's schema-default
    // hydration, so on any SystemSettings document that predates this field
    // it would silently come back undefined instead of the schema's default
    // rule (the exact pitfall hit and fixed in
    // notificationService.dispatchByRouting earlier this session). A real
    // (hydrated) document + Map#entries() applies the schema default
    // correctly either way. We only pay that real-document cost once per TTL
    // window — every gated request after that is a cheap in-memory lookup.
    const settings = await SystemSettings.findOne().select('featureAccess');
    const map = {};
    if (settings?.featureAccess) {
      for (const [key, rule] of settings.featureAccess.entries()) {
        map[key] = { roles: rule.roles || [], userIds: (rule.userIds || []).map(String) };
      }
    }
    cache = { at: Date.now(), map };
  } catch {
    cache.at = Date.now() - CACHE_TTL_MS + 5000; // retry soon, keep serving last-known-good map
  }
  return cache.map || {};
}

// Called by settingsController.updateSystemSettings right after a save that
// touches featureAccess, so a changed rule takes effect on the very next
// request instead of waiting out the TTL.
exports.invalidateFeatureAccessCache = () => { cache.at = 0; };

/**
 * Same decision as authorizeFeature, usable outside the Express middleware
 * chain — e.g. the socket handler deciding which broadcast rooms a connection
 * may join. Kept here so there is still exactly one place that answers
 * "can this user use this feature".
 */
exports.userHasFeature = async (user, featureKey, defaultRoles) => {
  if (!user) return false;
  if (user.role === 'client') return false; // portal access is a separate model
  const map = await getFeatureAccessMap();
  const rule = map[featureKey];
  const roles   = rule ? rule.roles   : defaultRoles;
  const userIds = rule ? rule.userIds : [];
  return roles.includes(user.role) || userIds.includes(String(user._id));
};

/**
 * Gates a route/router by an admin-configurable feature key.
 *
 * @param featureKey   Key into SystemSettings.featureAccess (e.g. 'campaigns').
 * @param defaultRoles Fallback role list used only if this feature has never
 *                     been configured (map/doc predates the field) —
 *                     preserves this route's pre-existing hardcoded behavior
 *                     on day one, mirrors dispatchByRouting's fallback.
 * @param clientBypass For routers shared with the client portal (tasks/
 *                     todos/meetings/messages) where role 'client' must
 *                     always pass regardless of admin configuration, because
 *                     portal access is governed by denyClientWrites +
 *                     controller-level ownership scoping, not this system.
 *                     Never set this on a feature the client shouldn't reach
 *                     at all.
 */
exports.authorizeFeature = (featureKey, defaultRoles, { clientBypass = false } = {}) => async (req, res, next) => {
  if (clientBypass && req.user.role === 'client') return next();

  const map = await getFeatureAccessMap();
  const rule = map[featureKey];
  const roles   = rule ? rule.roles   : defaultRoles;
  const userIds = rule ? rule.userIds : [];

  const uid = String(req.user._id);
  if (roles.includes(req.user.role) || userIds.includes(uid)) return next();

  return res.status(403).json({
    success: false,
    message: "You don't have access to this feature. Contact an admin if you believe this is a mistake.",
  });
};
