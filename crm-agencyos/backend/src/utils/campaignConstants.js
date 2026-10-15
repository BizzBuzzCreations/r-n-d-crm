'use strict';

// A lead with this many QUALIFIED opens (humanOpenCount — opens that didn't
// look like a scanner/prefetch, see trackingController.trackOpen) is treated
// as "hot": it drives the B2B pipeline sync and triggers the auto-follow-up.
//
// Lowered 3 → 2 deliberately: two real opens is already a clear
// repeat-engagement signal, and waiting for a third meant most interested
// recipients never qualified at all — especially since any image-blocking
// client under-counts opens to begin with.
//
// This counts QUALIFIED opens, not raw ones, precisely because the threshold
// is now low: a security gateway plus an image proxy can easily produce two
// raw opens for a recipient who never looked at the email, and following up
// on that wastes a send and the mailbox's reputation budget.
exports.HOT_OPEN_THRESHOLD = 2;

// Back-compat for leads that predate humanOpenCount: their qualified count is
// stuck at 0, so they'd silently stop qualifying. The old raw-open rule keeps
// working for them, at its original (stricter) value. Both paths are OR'd
// together wherever "hot" is decided, so this is purely additive — no
// in-flight campaign loses follow-ups when this ships.
exports.LEGACY_RAW_OPEN_THRESHOLD = 3;

// Known automated fetchers that hit the open-tracking pixel while scanning
// or pre-rendering an inbound email — before a human ever opens it. Used
// only to gate the "Email opened" notification in trackingController.js;
// the raw open is still recorded regardless of UA. Extend this list as new
// false-positive sources are identified — no controller changes needed.
// Note: some prefetchers (notably Apple Mail Privacy Protection) don't
// self-identify with a distinctive UA, so they aren't reliably catchable
// here — OPEN_NOTIFICATION_DELAY_GATE_MS below is the main defense for those.
exports.SCANNER_UA_PATTERNS = [
  /GoogleImageProxy/i,
  /Mimecast/i,
  /Proofpoint|pp-/i,
  /Barracuda/i,
  /OutlookImageProxy/i,
  /bot|crawler|spider|scanner/i,
];

// A pixel hit this soon after send is far more likely to be an automated
// prefetch (Gmail Image Proxy, corporate security gateways scanning inbound
// mail at delivery time) than a human actually reading the email — see the
// gating comment in trackingController.js.
exports.OPEN_NOTIFICATION_DELAY_GATE_MS = 15 * 1000;
