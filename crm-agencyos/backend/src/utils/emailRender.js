'use strict';
// Pure rendering/escaping helpers for outbound campaign email.
//
// Extracted out of workers/campaignWorker.js so they can be required and
// exercised directly: that file is a standalone daemon and requiring it
// starts a BullMQ Worker as a side effect, which made these impossible to
// test without Redis. Nothing here does I/O.

// ── HTML body ─────────────────────────────────────────────────────────────
// Everything substituted into an email BODY is escaped. Lead fields come from
// imported CSVs and public forms, and audit sentences embed values read off
// the prospect's own page — none of it should be able to inject markup into
// the email (or into the campaign preview, which renders the same HTML).
const escHtml = (v) => String(v ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// ── Subject / header ──────────────────────────────────────────────────────
// A subject is NOT HTML. It is a header value, shown as literal text by every
// mail client, so HTML-escaping it put "Joe&#39;s Diner" in front of the
// recipient.
//
// What a header does need is to stay a single line. A merge value carrying a
// newline — one stray cell in an imported CSV — would otherwise terminate the
// Subject header and let whatever follows be parsed as further headers
// (Bcc:, Reply-To:, …). Each control character is replaced individually
// rather than matching the \r\n pair, because a lone \n or a lone \r is
// enough on its own; U+2028/U+2029 are included as they are line terminators
// to some parsers and serve no purpose in a subject.
const HEADER_UNSAFE = /[\u0000-\u001f\u007f\u2028\u2029]+/g;
const escHeader = (v) => String(v ?? '').replace(HEADER_UNSAFE, ' ').replace(/\s{2,}/g, ' ').trim();

// ── Entity decoding (for the text/plain part) ─────────────────────────────
// Must decode everything escHtml can emit, or the plain-text alternative of
// every email shows its escapes verbatim — "You&#39;re running paid ads".
// For a text-only send (settings.textOnly) that is the ONLY copy that goes
// out, so this is recipient-visible, not cosmetic.
//
// `&amp;` is decoded LAST and deliberately: decoding it first turns a
// literal "&amp;#39;" (an ampersand the author actually typed, escaped once)
// into "&#39;", which the later rules would then decode again into an
// apostrophe that was never in the source. Named and numeric forms first,
// ampersand last, means one pass of escHtml round-trips exactly.
const decodeEntities = (s) => String(s ?? '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#0*34;|&#x0*22;/gi, '"')
  .replace(/&apos;/gi, "'")
  .replace(/&#0*39;|&#x0*27;/gi, "'")
  .replace(/&amp;/gi, '&');

// ── HTML → plain text ─────────────────────────────────────────────────────
const stripToPlain = (html) => String(html ?? '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  // Stripping tags below would otherwise throw away every href along with
  // its <a> tag, leaving only the visible link text — for text-only sends
  // (settings.textOnly), this is the ONLY copy of the email that goes out,
  // so a "click here" link would silently lose its URL entirely. Inline
  // the URL next to the link text before the generic tag strip runs.
  .replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, url, inner) => {
    const label = inner.replace(/<[^>]+>/g, '').trim();
    return label && label !== url ? `${label} (${url})` : url;
  })
  .replace(/<[^>]+>/g, ' ')
  // Entities are decoded AFTER tags are stripped: decoding first could turn
  // an escaped "&lt;script&gt;" back into a live-looking tag that the strip
  // above would then remove, silently eating the author's literal text.
  .replace(/&amp;|&lt;|&gt;|&quot;|&apos;|&nbsp;|&#0*(?:34|39);|&#x0*(?:22|27);/gi, (m) => decodeEntities(m))
  .replace(/\s{2,}/g, ' ')
  .trim();

module.exports = { escHtml, escHeader, decodeEntities, stripToPlain, HEADER_UNSAFE };
