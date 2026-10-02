// ── This file exports all routers ──────────────────────────────
// Each section creates its own express.Router() and exports it.
// The app.js imports these.

const express = require('express');
const { protect, authorize, authorizeRoles, denyClientWrites } = require('../middleware/auth');
const { authorizeFeature } = require('../middleware/authorizeFeature');
const upload  = require('../middleware/upload');
const { uploadAvatar } = require('../middleware/uploadAvatar');
const { loginLimiter, witPublicLimiter } = require('../middleware/rateLimiters');

const auth = require('../controllers/authController');
const ctrl = require('../controllers/mainControllers');
const xtra = require('../controllers/extraControllers');
const revenue = require('../controllers/revenueController');
const meetingScheduler = require('../controllers/meetingSchedulerController');
const serviceCtr = require('../controllers/serviceController');
const billing = require('../controllers/billingController');

// ── Auth routes ───────────────────────────────────────────────
const authRouter = express.Router();
authRouter.post('/login',    loginLimiter, auth.login);
authRouter.post('/logout',   auth.logout);
authRouter.post('/refresh',  auth.refresh);
authRouter.get('/me',        protect, auth.me);
authRouter.put('/profile',   protect, auth.updateProfile);
authRouter.put('/password',  protect, auth.changePassword);
authRouter.put('/avatar',    protect, (req, res, next) => uploadAvatar.single('avatar')(req, res, (err) => {
  if (err) return res.status(400).json({ success: false, message: err.message });
  next();
}), auth.uploadAvatar);
authRouter.delete('/avatar', protect, auth.removeAvatar);
module.exports.auth = authRouter;

// ── Users routes ──────────────────────────────────────────────
const usersRouter = express.Router();
usersRouter.use(protect);
usersRouter.get('/',        ctrl.getUsers);
usersRouter.post('/',       authorizeFeature('team', ['admin','manager']), ctrl.createUser);
usersRouter.put('/:id',     authorizeFeature('team', ['admin','manager']), ctrl.updateUser);
usersRouter.delete('/:id',  authorizeFeature('team', ['admin','manager']), ctrl.deleteUser);
module.exports.users = usersRouter;

// ── Clients routes ────────────────────────────────────────────
const clientsRouter = express.Router();
clientsRouter.use(protect);
// Members can VIEW Clients & Projects (they are in the 'clients' feature rule), but must never
// create/edit/delete — that rule also gates the write routes below, so block them explicitly.
const denyMemberWrites = (req, res, next) => (req.user.role === 'member'
  ? res.status(403).json({ success: false, message: 'Members have read-only access to clients and projects' })
  : next());
clientsRouter.get('/',             ctrl.getClients);
clientsRouter.get('/:id',          ctrl.getClient);
clientsRouter.post('/',            denyMemberWrites, authorizeFeature('clients', ['admin','manager']), ctrl.createClient);
clientsRouter.put('/:id',          denyMemberWrites, authorizeFeature('clients', ['admin','manager']), ctrl.updateClient);
clientsRouter.delete('/:id',       denyMemberWrites, authorizeFeature('clients', ['admin','manager']), ctrl.deleteClient);
clientsRouter.post('/:id/notes',              ctrl.addClientNote);
clientsRouter.post('/:id/reset-portal-password', authorize('admin'), ctrl.resetPortalPassword);
module.exports.clients = clientsRouter;

// ── Tasks routes ──────────────────────────────────────────────
const tasksRouter = express.Router();
tasksRouter.use(protect);
tasksRouter.use(authorizeFeature('tasks', ['admin','manager','member','client_relations'], { clientBypass: true }));
tasksRouter.use(denyClientWrites); // clients are read-only
tasksRouter.get('/',    ctrl.getTasks);
tasksRouter.post('/',   upload.array('files', 10), ctrl.createTask);
tasksRouter.put('/:id', upload.array('files', 10), ctrl.updateTask);
tasksRouter.delete('/:id', authorize('admin','manager'), ctrl.deleteTask);
module.exports.tasks = tasksRouter;

// ── Todos routes ──────────────────────────────────────────────
const todosRouter = express.Router();
todosRouter.use(protect);
todosRouter.use(authorizeFeature('todos', ['admin','manager','member','client_relations'], { clientBypass: true }));
todosRouter.get('/',    ctrl.getTodos);
todosRouter.post('/',   upload.array('files', 10), ctrl.createTodo);
todosRouter.put('/:id', upload.array('files', 10), ctrl.updateTodo);
todosRouter.delete('/:id', ctrl.deleteTodo);
module.exports.todos = todosRouter;

// ── Meetings routes ───────────────────────────────────────────
const meetingsRouter = express.Router();
meetingsRouter.use(protect);
meetingsRouter.use(authorizeFeature('meetings', ['admin','manager','member','client_relations'], { clientBypass: true }));
meetingsRouter.use(denyClientWrites); // clients are read-only
meetingsRouter.get('/',    ctrl.getMeetings);
meetingsRouter.post('/',   authorize('admin','manager'), ctrl.createMeeting);
meetingsRouter.put('/:id', authorize('admin','manager'), ctrl.updateMeeting);
meetingsRouter.delete('/:id', authorize('admin','manager'), ctrl.deleteMeeting);

// Invitation-based scheduler additions
meetingsRouter.post('/schedule',           meetingScheduler.scheduleMeeting);
meetingsRouter.put('/rsvp/:invitationId',  meetingScheduler.updateRSVP);
meetingsRouter.get('/my-schedule',         meetingScheduler.getMySchedule);

module.exports.meetings = meetingsRouter;

// ── Messages routes ───────────────────────────────────────────
const messagesRouter = express.Router();
messagesRouter.use(protect);
messagesRouter.use(authorizeFeature('messages', ['admin','manager','member','client_relations'], { clientBypass: true }));
messagesRouter.get('/:threadId',  xtra.getThreadMessages);
messagesRouter.post('/:threadId', upload.array('files', 5), xtra.sendMessage);
messagesRouter.delete('/:id',     xtra.deleteMessage);
messagesRouter.post('/:id/react', xtra.toggleReaction);
module.exports.messages = messagesRouter;

// ── Reports routes ────────────────────────────────────────────
const reportsRouter = express.Router();
reportsRouter.use(protect);
reportsRouter.use(authorizeFeature('reports', ['admin','manager','member','client_relations']));
reportsRouter.get('/', xtra.getReport);
module.exports.reports = reportsRouter;

// ── WorkLog routes ────────────────────────────────────────────
const worklogRouter = express.Router();
worklogRouter.use(protect);
worklogRouter.get('/',      xtra.getWorkLog);
worklogRouter.post('/',     xtra.upsertWorkLog);
worklogRouter.patch('/active', xtra.setUserActive);
worklogRouter.patch('/:id',    authorize('admin'), xtra.adminUpdateWorkLog); // admin correction, after /active
worklogRouter.delete('/bulk', authorize('admin'), xtra.bulkDeleteWorkLogs); // /bulk before /:id
worklogRouter.delete('/:id',  authorize('admin'), xtra.deleteWorkLog);
module.exports.worklog = worklogRouter;

// ── Revenue routes ────────────────────────────────────────────
const revenueRouter = express.Router();
revenueRouter.use(protect);
revenueRouter.get('/summary', authorizeRoles('admin', 'manager'), revenue.getRevenueSummary);
revenueRouter.post('/record', authorizeRoles('admin'), revenue.recordRevenue);
module.exports.revenue = revenueRouter;

// ── Services routes ───────────────────────────────────────────
const servicesRouter = express.Router();
servicesRouter.use(protect);
servicesRouter.get('/',     serviceCtr.getServices);
servicesRouter.post('/',    authorize('admin'), serviceCtr.createService);
servicesRouter.put('/:id',  authorize('admin'), serviceCtr.updateService);
servicesRouter.delete('/:id', authorize('admin'), serviceCtr.deleteService);
module.exports.services = servicesRouter;

// ── Leads routes ──────────────────────────────────────────────
const leadCtrl = require('../controllers/leadController');
const leadsRouter = express.Router();
leadsRouter.use(protect);
leadsRouter.use(authorizeFeature('leads', ['admin','manager','client_relations']));
leadsRouter.get('/',            leadCtrl.getLeads);
leadsRouter.post('/bulk',       leadCtrl.bulkCreateLeads);   // /bulk before /:id
leadsRouter.post('/merge',      authorize('admin','manager'), leadCtrl.mergeLeads);
leadsRouter.post('/',           leadCtrl.createLead);
leadsRouter.put('/:id',         leadCtrl.updateLead);
leadsRouter.post('/:id/email',  leadCtrl.sendLeadEmail);
leadsRouter.get('/:id/emails',  leadCtrl.getLeadEmails);     // email history log
leadsRouter.delete('/:id',      authorize('admin','manager'), leadCtrl.deleteLead);
module.exports.leads = leadsRouter;

// ── Client Portal routes (role: client only) ──────────────────
const portalCtrl = require('../controllers/portalController');
const portalRouter = express.Router();
portalRouter.use(protect);
portalRouter.use(authorize('client'));
portalRouter.get('/overview', portalCtrl.getOverview);
portalRouter.get('/contacts', portalCtrl.getContacts);
portalRouter.get('/me',       portalCtrl.getMyClient);
portalRouter.get('/invoices', portalCtrl.getInvoices);
portalRouter.get('/invoices/:id', portalCtrl.getInvoice);
portalRouter.get('/invoices/:id/pdf', portalCtrl.downloadPDF);
module.exports.portal = portalRouter;

// ── Audit Log routes ──────────────────────────────────────────
const auditCtrl = require('../controllers/auditController');
const auditRouter = express.Router();
auditRouter.use(protect);
auditRouter.use(authorizeFeature('audit_logs', ['admin']));
auditRouter.get('/',       auditCtrl.getLogs);
auditRouter.get('/stats',  auditCtrl.getStats);
module.exports.audit = auditRouter;

// ── System / Server Logs routes (admin only) ──────────────────
const sysCtrl = require('../controllers/systemLogsController');
const adminLogsRouter = express.Router();
adminLogsRouter.use(protect);
adminLogsRouter.use(authorizeFeature('system_monitor', ['admin']));
adminLogsRouter.get('/status',              sysCtrl.getSystemStatus);
adminLogsRouter.get('/sources',             sysCtrl.listSources);
adminLogsRouter.get('/:source/download',    sysCtrl.downloadLog);
adminLogsRouter.get('/:source',             sysCtrl.getLogs);
module.exports.adminLogs = adminLogsRouter;

// ── Billing routes (admin + manager only) ─────────────────────
const billingRouter = express.Router();
billingRouter.use(protect);
billingRouter.use(authorizeFeature('billing', ['admin', 'manager']));
billingRouter.get('/collections',                         billing.getCollections);
billingRouter.get('/invoices',                            billing.getInvoices);
billingRouter.post('/invoices',                           billing.createInvoice);
billingRouter.get('/invoices/:id',                        billing.getInvoice);
billingRouter.put('/invoices/:id',                        billing.updateInvoice);
billingRouter.delete('/invoices/:id',                     billing.deleteInvoice);
billingRouter.get('/invoices/:id/pdf',                    billing.downloadPDF);
billingRouter.get('/invoices/:invoiceId/payments',        billing.getPayments);
billingRouter.post('/invoices/:invoiceId/payments',       upload.single('attachment'), billing.recordPayment);
billingRouter.put('/payments/:id',                        upload.single('attachment'), billing.updatePayment);
billingRouter.delete('/payments/:id',                     billing.deletePayment);
billingRouter.put('/clients/:clientId/billing-profile',   billing.updateBillingProfile);
module.exports.billing = billingRouter;

// ── Email Accounts routes (any authenticated user — manages their OWN
// connected mailboxes; admins/managers can additionally see/manage everyone
// else's for building company campaigns — enforced inside the controller) ──
const emailAccountCtrl = require('../controllers/emailAccountController');
const emailAccountsRouter = express.Router();
emailAccountsRouter.use(protect);
emailAccountsRouter.get('/',           emailAccountCtrl.getAccounts);
emailAccountsRouter.post('/',          emailAccountCtrl.createAccount);
emailAccountsRouter.put('/:id',        emailAccountCtrl.updateAccount);
emailAccountsRouter.delete('/:id',     emailAccountCtrl.deleteAccount);
emailAccountsRouter.post('/:id/test',  emailAccountCtrl.testAccount);
emailAccountsRouter.get('/:id/domain-check', emailAccountCtrl.checkDomain);
module.exports.emailAccounts = emailAccountsRouter;

// ── Campaign public tracking routes (NO auth — hit by email clients) ──
// Mounted at the SAME /api/campaigns prefix but registered before the
// protected campaigns router in app.js, so these specific sub-paths never
// hit the `protect` middleware. Identity comes from the unguessable token.
const trackCtrl = require('../controllers/trackingController');
const campaignPublicRouter = express.Router();
campaignPublicRouter.get('/track/open/:token',  trackCtrl.trackOpen);
campaignPublicRouter.get('/track/click/:token', trackCtrl.trackClick);
campaignPublicRouter.get('/track/call-request/:token', trackCtrl.requestCall);
campaignPublicRouter.get('/track/response/:token', trackCtrl.trackResponse); // checkbox-style response links — ?option=...
campaignPublicRouter.get('/unsubscribe/:token',  trackCtrl.unsubscribeConfirm); // shows a confirm page, doesn't mutate
campaignPublicRouter.post('/unsubscribe/:token', trackCtrl.unsubscribe);        // actually unsubscribes
module.exports.campaignPublic = campaignPublicRouter;

// ── Campaigns routes (admin + manager only — external bulk email sending) ──
const campaignCtrl = require('../controllers/campaignController');
const campaignsRouter = express.Router();
campaignsRouter.use(protect);
campaignsRouter.use(authorizeFeature('campaigns', ['admin', 'manager']));
campaignsRouter.post('/upload-image',             upload.single('image'), campaignCtrl.uploadImage); // before /:id
campaignsRouter.get('/',                          campaignCtrl.getCampaigns);
campaignsRouter.post('/',                         campaignCtrl.createCampaign);
campaignsRouter.get('/:id',                       campaignCtrl.getCampaign);
campaignsRouter.put('/:id',                       campaignCtrl.updateCampaign);
campaignsRouter.delete('/:id',                    campaignCtrl.deleteCampaign);
campaignsRouter.post('/:id/start',                campaignCtrl.startCampaign);
campaignsRouter.post('/:id/schedule',             campaignCtrl.scheduleCampaign);
campaignsRouter.post('/:id/unschedule',           campaignCtrl.unscheduleCampaign);
campaignsRouter.post('/:id/pause',                campaignCtrl.pauseCampaign);
campaignsRouter.get('/:id/diagnose',              campaignCtrl.diagnoseCampaign);
campaignsRouter.post('/:id/resolve-stuck',        campaignCtrl.resolveStuckLeads);
campaignsRouter.get('/:id/leads',                 campaignCtrl.getCampaignLeads);
campaignsRouter.post('/:id/leads/import',         upload.single('file'), campaignCtrl.importLeads);
campaignsRouter.post('/:id/leads/update-phones',  upload.single('file'), campaignCtrl.updateLeadPhones); // backfill phone on existing leads — before /:leadId routes
campaignsRouter.post('/:id/leads/verify-all',     campaignCtrl.verifyAllLeads);   // before /:leadId routes
campaignsRouter.delete('/:id/leads/:leadId',      campaignCtrl.deleteCampaignLead);
campaignsRouter.post('/:id/leads/:leadId/verify', campaignCtrl.verifyLead);
campaignsRouter.post('/:id/leads/:leadId/mark-replied', campaignCtrl.markReplied);
module.exports.campaigns = campaignsRouter;

// ── Email Templates routes (shared library, campaigns-access gated) ────
const emailTemplateCtrl = require('../controllers/emailTemplateController');
const emailTemplatesRouter = express.Router();
emailTemplatesRouter.use(protect);
emailTemplatesRouter.use(authorizeFeature('campaigns', ['admin', 'manager']));
emailTemplatesRouter.get('/',       emailTemplateCtrl.getTemplates);
emailTemplatesRouter.post('/',      emailTemplateCtrl.createTemplate);
emailTemplatesRouter.put('/:id',    emailTemplateCtrl.updateTemplate);
emailTemplatesRouter.delete('/:id', emailTemplateCtrl.deleteTemplate);
module.exports.emailTemplates = emailTemplatesRouter;

// ── Meta Ads Analytics routes (admin/manager only — spend & ROI data) ──
const metaAdsCtrl = require('../controllers/metaAdsController');
const metaAdsRouter = express.Router();
metaAdsRouter.use(protect);
metaAdsRouter.use(authorizeFeature('ads_monitoring', ['admin', 'manager']));
metaAdsRouter.get('/status',          metaAdsCtrl.getStatus);
metaAdsRouter.put('/credentials',     metaAdsCtrl.saveCredentials);
metaAdsRouter.delete('/credentials',  metaAdsCtrl.clearCredentials);
metaAdsRouter.post('/test-connection', metaAdsCtrl.testConnection);
metaAdsRouter.post('/sync-now',       metaAdsCtrl.triggerSync);
metaAdsRouter.get('/summary',         metaAdsCtrl.getSummary);
metaAdsRouter.get('/trends',          metaAdsCtrl.getTrends);
metaAdsRouter.get('/campaigns',       metaAdsCtrl.getCampaigns);
metaAdsRouter.get('/adsets',          metaAdsCtrl.getAdSets);
metaAdsRouter.get('/ads',             metaAdsCtrl.getAds);
metaAdsRouter.get('/leads',           metaAdsCtrl.getLeadDetails);
module.exports.metaAds = metaAdsRouter;

// ── Website Intelligence — public tracking endpoints ────────────────
// Called from the 5 monitored websites' own origins (arbitrary third-party
// domains) via the embedded snippet (public/wit.js) — needs its own
// wide-open CORS, applied here rather than relying on the app-wide
// allowlist in app.js (which this router is deliberately mounted BEFORE).
const cors = require('cors');
const witPublicCtrl = require('../controllers/witPublicController');
const witPublicRouter = express.Router();
// credentials: true is required here even though these routes don't use
// cookie auth — navigator.sendBeacon() (used by pageend) always sends with
// credentials mode "include" per spec, so without Access-Control-Allow-
// Credentials: true in the response, every cross-origin pageend beacon
// silently fails CORS preflight and is never sent (sendBeacon has no error
// callback, so this is invisible from the page). origin:true still reflects
// the exact request origin rather than "*", which is required alongside
// credentials:true anyway.
witPublicRouter.use(cors({ origin: true, credentials: true }));
witPublicRouter.use(witPublicLimiter);
witPublicRouter.post('/pageview',   witPublicCtrl.pageview);
witPublicRouter.post('/pageend',    witPublicCtrl.pageend);
witPublicRouter.post('/ping',       witPublicCtrl.ping);
witPublicRouter.post('/form-event', witPublicCtrl.formEvent);
witPublicRouter.post('/lead',       witPublicCtrl.captureLead);
module.exports.witPublic = witPublicRouter;

// ── Website Intelligence — staff dashboard (admin/manager only) ────
const witCtrl = require('../controllers/witController');
const witRouter = express.Router();
witRouter.use(protect);
witRouter.use(authorizeFeature('website_intelligence', ['admin', 'manager']));
witRouter.get('/websites',                     witCtrl.getWebsites);
witRouter.post('/websites',                    witCtrl.createWebsite);
witRouter.put('/websites/:id',                 witCtrl.updateWebsite);
witRouter.post('/websites/:id/regenerate-secret', witCtrl.regenerateSecret);
witRouter.delete('/websites/:id',              witCtrl.deleteWebsite);
witRouter.get('/summary',           witCtrl.getSummary);
witRouter.get('/trends',            witCtrl.getTrends);
witRouter.get('/traffic-sources',   witCtrl.getTrafficSources);
witRouter.get('/countries',         witCtrl.getCountries);
witRouter.get('/devices',           witCtrl.getDevices);
witRouter.get('/pages',             witCtrl.getPages);
witRouter.get('/landing-pages',     witCtrl.getLandingPages);
witRouter.get('/forms',             witCtrl.getForms);
witRouter.get('/funnel',            witCtrl.getFunnel);
witRouter.get('/lead-attribution',  witCtrl.getLeadAttribution);
witRouter.get('/repeat-visitors',   witCtrl.getRepeatVisitors);
module.exports.websiteIntelligence = witRouter;

// ── API Keys — admin-only management of credentials for external callers
// (e.g. the main CRM's lead-sync integration). Stricter than Website
// Intelligence's admin+manager: these keys grant read access to every
// lead's email activity, so issuance is admin-only.
const apiKeyCtrl = require('../controllers/apiKeyController');
const apiKeyRouter = express.Router();
apiKeyRouter.use(protect);
apiKeyRouter.use(authorizeFeature('api_keys', ['admin']));
apiKeyRouter.get('/',        apiKeyCtrl.getApiKeys);
apiKeyRouter.post('/',       apiKeyCtrl.createApiKey);
apiKeyRouter.delete('/:id',  apiKeyCtrl.deleteApiKey);
module.exports.apiKeys = apiKeyRouter;

// ── IVA CRM Integration — admin-only. Configures the outbound call rndCRM
// makes to the main CRM's activity-notification endpoint (see
// controllers/mainCrmController.js, utils/mainCrmNotify.js). Not tied to a
// sidebar feature/authorizeFeature key — this is system-level integration
// config, same admin-only sensitivity tier as API Keys.
const mainCrmCtrl = require('../controllers/mainCrmController');
const mainCrmRouter = express.Router();
mainCrmRouter.use(protect);
mainCrmRouter.use(authorize('admin'));
mainCrmRouter.get('/status',           mainCrmCtrl.getStatus);
mainCrmRouter.put('/credentials',      mainCrmCtrl.saveCredentials);
mainCrmRouter.delete('/credentials',   mainCrmCtrl.clearCredentials);
mainCrmRouter.post('/test-connection', mainCrmCtrl.testConnection);
module.exports.mainCrmIntegration = mainCrmRouter;

// ── PageSpeed Insights Integration — admin-only. Configures the Google API
// key(s) used by the Prospect Audit crawler (see
// controllers/pageSpeedIntegrationController.js, workers/prospectAuditWorker.js).
// Same admin-only sensitivity tier as IVA CRM Integration/API Keys.
const pageSpeedCtrl = require('../controllers/pageSpeedIntegrationController');
const pageSpeedRouter = express.Router();
pageSpeedRouter.use(protect);
pageSpeedRouter.use(authorize('admin'));
pageSpeedRouter.get('/status',           pageSpeedCtrl.getStatus);
pageSpeedRouter.put('/credentials',      pageSpeedCtrl.saveCredentials);
pageSpeedRouter.delete('/credentials',   pageSpeedCtrl.clearCredentials);
pageSpeedRouter.post('/test-connection', pageSpeedCtrl.testConnection);
module.exports.pageSpeedIntegration = pageSpeedRouter;

// ── Prospect Audits (admin + manager — sales-ops tool) ─────────────────
const prospectAuditCtrl = require('../controllers/prospectAuditController');
const prospectAuditsRouter = express.Router();
prospectAuditsRouter.use(protect);
prospectAuditsRouter.use(authorizeFeature('prospect_audit', ['admin', 'manager']));
prospectAuditsRouter.get('/',                              prospectAuditCtrl.getBatches);
prospectAuditsRouter.post('/',                             prospectAuditCtrl.createBatch);
prospectAuditsRouter.get('/:id',                           prospectAuditCtrl.getBatch);
prospectAuditsRouter.delete('/:id',                        prospectAuditCtrl.deleteBatch);
prospectAuditsRouter.post('/:id/import',                   upload.single('file'), prospectAuditCtrl.importProspects);
prospectAuditsRouter.get('/:id/prospects',                 prospectAuditCtrl.getProspects);
prospectAuditsRouter.delete('/:id/prospects/:prospectId',  prospectAuditCtrl.deleteProspect);
prospectAuditsRouter.post('/:id/start',                    prospectAuditCtrl.startCrawl);
prospectAuditsRouter.post('/:id/pause',                    prospectAuditCtrl.pauseCrawl);
module.exports.prospectAudits = prospectAuditsRouter;

// ── Social Media Platforms — admin-only. Meta App / LinkedIn App
// credentials used by the OAuth connect flow (see
// controllers/socialAccountController.js, modules/social/services/socialService.js).
// Same admin-only sensitivity tier as PageSpeed/Main CRM integrations.
const socialPlatformCtrl = require('../modules/social/controllers/socialPlatformSettingsController');
const socialPlatformRouter = express.Router();
socialPlatformRouter.use(protect);
socialPlatformRouter.use(authorize('admin'));
socialPlatformRouter.get('/:platform/status',         socialPlatformCtrl.getStatus);
socialPlatformRouter.put('/:platform/credentials',    socialPlatformCtrl.saveCredentials);
socialPlatformRouter.delete('/:platform/credentials', socialPlatformCtrl.clearCredentials);
module.exports.socialPlatformSettings = socialPlatformRouter;

// ── Social Media Management (admin + manager — marketing-ops tool) ─────
const socialAccountCtrl = require('../controllers/socialAccountController');
const socialPostCtrl = require('../controllers/socialPostController');
const socialUpload = require('../modules/social/utils/socialUpload');

const socialAccountsRouter = express.Router();
// Callback is hit by the OAuth platform's own server-side redirect — the
// user's browser navigating back from Facebook/LinkedIn/etc. with just
// `?code=&state=`, which can never carry our app's Bearer token or a
// `?token=` param the way `connect` does. Its authenticity instead comes
// from verifying the signed `state` JWT inside the controller itself (see
// socialAccountController.js#callback) — so this route must be registered
// BEFORE the protect/authorizeFeature gate below, or every real OAuth
// completion 401s before ever reaching the handler.
socialAccountsRouter.get('/:platform/callback',  socialAccountCtrl.callback);

socialAccountsRouter.use(protect);
socialAccountsRouter.use(authorizeFeature('social_media', ['admin', 'manager']));
socialAccountsRouter.get('/',                    socialAccountCtrl.getAccounts);
socialAccountsRouter.get('/:platform/connect',   socialAccountCtrl.connect);
socialAccountsRouter.delete('/:id',              socialAccountCtrl.deleteAccount);
module.exports.socialAccounts = socialAccountsRouter;

const socialPostsRouter = express.Router();
socialPostsRouter.use(protect);
socialPostsRouter.use(authorizeFeature('social_media', ['admin', 'manager']));
socialPostsRouter.post('/upload-media',       socialUpload.single('media'), socialPostCtrl.uploadMedia);
socialPostsRouter.post('/',                   socialPostCtrl.createPost);
socialPostsRouter.get('/',                    socialPostCtrl.getPosts);
socialPostsRouter.get('/:id',                 socialPostCtrl.getPost);
socialPostsRouter.patch('/:id',               socialPostCtrl.updatePost);
socialPostsRouter.delete('/:id',              socialPostCtrl.deletePost);
socialPostsRouter.post('/:id/publish',        socialPostCtrl.publishPost);
socialPostsRouter.post('/:id/schedule',       socialPostCtrl.schedulePost);
socialPostsRouter.post('/:id/cancel',         socialPostCtrl.cancelPost);
module.exports.socialPosts = socialPostsRouter;

const socialPublicationsRouter = express.Router();
socialPublicationsRouter.use(protect);
socialPublicationsRouter.use(authorizeFeature('social_media', ['admin', 'manager']));
socialPublicationsRouter.post('/:id/retry', socialPostCtrl.retryPublication);
module.exports.socialPublications = socialPublicationsRouter;

const socialCalendarRouter = express.Router();
socialCalendarRouter.use(protect);
socialCalendarRouter.use(authorizeFeature('social_media', ['admin', 'manager']));
socialCalendarRouter.get('/', socialPostCtrl.getCalendar);
module.exports.socialCalendar = socialCalendarRouter;

const socialAnalyticsRouter = express.Router();
socialAnalyticsRouter.use(protect);
socialAnalyticsRouter.use(authorizeFeature('social_media', ['admin', 'manager']));
socialAnalyticsRouter.get('/', socialPostCtrl.getAnalytics);
module.exports.socialAnalytics = socialAnalyticsRouter;
