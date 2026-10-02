const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const morgan      = require('morgan');
const path        = require('path');
const cookieParser= require('cookie-parser');
const errorHandler= require('./middleware/errorHandler');

const app = express();

// Trust exactly one hop (the nginx reverse proxy in front of this process)
// so req.ip resolves to the real visitor's address from X-Forwarded-For,
// not nginx's own loopback IP. Without this, every req.ip read anywhere in
// the app — audit log IPs, campaign open-tracking IPs, Website Intelligence
// geo lookups — silently records 127.0.0.1 for every request in production.
app.set('trust proxy', 1);

// Baseline security headers (X-Frame-Options, X-Content-Type-Options,
// no more X-Powered-By, etc). Two defaults deliberately overridden:
//   - contentSecurityPolicy: off — helmet's default CSP is strict enough to
//     break an existing app's own asset loading if turned on retroactively
//     without a tailored policy; needs its own dedicated pass, not a
//     drive-by default here.
//   - crossOriginResourcePolicy: 'cross-origin' — helmet's default
//     ('same-origin') would block the 5 tracked websites from loading
//     /wit.js and calling /api/wit/* cross-origin, undoing the CORS work
//     those routes already depend on.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ── Website Intelligence public tracking endpoints — mounted BEFORE the
// app-wide CORS allowlist below (with their own permissive CORS applied in
// routes/witPublic.js) since these are called from the 5 monitored
// websites' own origins, not from this CRM's own frontend. Analogous to how
// the campaign tracking pixel is public, except this one needs real CORS
// headers (fetch/sendBeacon calls, not an <img> tag).
app.use('/api/wit', require('./routes/witPublic'));

// ── External API — every endpoint the main CRM (or another outside system)
// calls server-to-server, not a browser, so none of this needs CORS
// handling (only mounted early to stay consistent with the other public/
// webhook routes above the app's own origin allowlist). Auth is an
// admin-issued API key (see external-api/middleware/apiKeyAuth.js), not
// this app's normal JWT flow. One app.use() per domain, each owning its
// own base path — see external-api/README.md to add a new domain.
const externalApi = require('./external-api');
app.use('/api/lead-sync', externalApi.leadSync);

// leadCapture is the one exception to "none of this needs CORS" above — it
// IS hit directly from a browser (a frontend-only site's own form JS, no
// backend in between), so it carries its own per-site CORS (see
// leadCapture.routes.js), separate from the general allowlist below.
app.use('/api/lead-capture', externalApi.leadCapture);

// ── CORS — allow dev (localhost:5173, 5174), configured CLIENT_URL, and any LAN IP ──
const clientUrl = process.env.CLIENT_URL ? process.env.CLIENT_URL.replace(/\/$/, '') : null;
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://localhost:5000',
  clientUrl,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, same-origin production requests)
    if (!origin) return callback(null, true);
    
    // Normalize trailing slashes for resilient comparison
    const normalizedOrigin = origin.replace(/\/$/, '');
    
    // Allow any configured origin exactly
    if (ALLOWED_ORIGINS.includes(normalizedOrigin)) return callback(null, true);
    // Allow any LAN IP (192.168.x.x or 10.x.x.x) on any port
    if (/^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(normalizedOrigin)) return callback(null, true);
    
    // 403, not the default 500 — this is a rejected/untrusted request, not a
    // server malfunction. Also keeps it out of logger.error's >=500 gate, so
    // routine bot/scanner noise (constant on any public API) stops flooding
    // System Monitor's error feed as if something were actually broken.
    const err = new Error(`CORS blocked: ${origin}`);
    err.statusCode = 403;
    callback(err);
  },
  credentials: true,
  methods:     ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// ── Static files (uploaded attachments) ────────────────────
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ── Website Intelligence tracking snippet — embedded on the 5 tracked
// sites via <script src=".../wit.js" data-tracking-id="..." async>. Served
// with CORS wide open (any site can load it — that's the point of a
// tracking snippet) and short caching so a fix ships to every site quickly.
app.get('/wit.js', (req, res) => {
  res.set({
    'Content-Type': 'application/javascript; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300',
  });
  res.sendFile(path.join(__dirname, '../public/wit.js'));
});

// ── API Routes ──────────────────────────────────────────────
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/users',    require('./routes/users'));
app.use('/api/clients',  require('./routes/clients'));
app.use('/api/tasks',    require('./routes/tasks'));
app.use('/api/todos',    require('./routes/todos'));
app.use('/api/meetings', require('./routes/meetings'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/reports',  require('./routes/reports'));
app.use('/api/worklog',        require('./routes/worklog'));
app.use('/api/revenue',        require('./routes/revenue'));
app.use('/api/notifications',  require('./routes/notifications'));
app.use('/api/services',       require('./routes/services'));
app.use('/api/channels',       require('./routes/channels'));
app.use('/api/projects',       require('./routes/projects'));
app.use('/api/leads',          require('./routes/leads'));
app.use('/api/settings',       require('./routes/settings'));
app.use('/api/audit',          require('./routes/audit'));
app.use('/api/admin/logs',     require('./routes/adminLogs'));
app.use('/api/portal',         require('./routes/portal'));
app.use('/api/billing',        require('./routes/billing'));
app.use('/api/email-accounts', require('./routes/emailAccounts'));
app.use('/api/email-templates', require('./routes/emailTemplates'));
app.use('/api/meta-ads',       require('./routes/metaAds'));
app.use('/api/website-intelligence', require('./routes/websiteIntelligence'));
app.use('/api/api-keys',       require('./routes/apiKeys'));
app.use('/api/payroll',        require('./routes/payroll'));
app.use('/api/main-crm-integration', require('./routes/mainCrmIntegration'));
app.use('/api/pagespeed-integration', require('./routes/pageSpeedIntegration'));
app.use('/api/prospect-audits', require('./routes/prospectAudits'));
app.use('/api/social-platforms', require('./routes/socialPlatformSettings'));
app.use('/api/social/accounts', require('./routes/socialAccounts'));
app.use('/api/social/posts', require('./routes/socialPosts'));
app.use('/api/social/publications', require('./routes/socialPublications'));
app.use('/api/social/calendar', require('./routes/socialCalendar'));
app.use('/api/social/analytics', require('./routes/socialAnalytics'));
// Public tracking (open pixel / click redirect / unsubscribe) MUST be
// mounted before the protected campaigns router — both share the
// /api/campaigns prefix, and Express matches in registration order.
app.use('/api/campaigns',      require('./routes/campaignPublic'));
app.use('/api/campaigns',      require('./routes/campaigns'));

// ── Health check ─────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), env: process.env.NODE_ENV });
});

// ── Serve built React frontend in production ─────────────────
// dist/ lives at crm-agencyos/dist/ — two levels up from backend/src/
const distPath = path.join(__dirname, '../../dist');
app.use(express.static(distPath));
// SPA fallback — must come AFTER all /api routes
app.get('*', (req, res) => {
  // Don't intercept actual API calls that reached here somehow
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'Route not found' });
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

// ── Error handler ─────────────────────────────────────────────
app.use(errorHandler);

module.exports = app;

