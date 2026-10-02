const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../utils/crypto');

const PipelineStageSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  color:       { type: String, default: '#6366f1' },
  probability: { type: Number, default: 100 } // percentage
});

const PipelineSchema = new mongoose.Schema({
  name:        { type: String, default: 'Sales Funnel' },
  stages:      [PipelineStageSchema],
  lostReasons: [{ type: String }],
  wonReasons:  [{ type: String }]
});

// Who receives a given system-generated notification (e.g. 'email_opened').
// `roles` and `userIds` are independent and additive — a user gets notified
// if EITHER their role is in `roles` OR their id is in `userIds`, so a
// specific person can be granted a notification with no role selected at
// all (see notificationService.dispatchByRouting). Keyed by event type in a
// Map on SystemSettings so new notification features just add a new key,
// no schema migration needed.
const NotificationRoutingRuleSchema = new mongoose.Schema({
  roles:   { type: [String], enum: ['admin', 'manager', 'member', 'client_relations', 'read_only'], default: [] },
  userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { _id: false });

// Outbound integration: campaign email opens/call-requests/replies get
// reported here (POST notifyUrl) so the main CRM's own users get notified
// too — see utils/mainCrmNotify.js. Same encrypted-secret pattern as
// MetaAdsAccount/EmailAccount/TrackedWebsite (virtual setter/getter over an
// encrypted, select:false field via utils/crypto) — never returned in a
// plain GET /api/settings response.
const MainCrmIntegrationSchema = new mongoose.Schema({
  notifyUrl:       { type: String, default: 'https://crms.bizzbuzzcreations.com/api/external/leads/notify-activity/' },
  apiKeyEncrypted: { type: String, default: '', select: false },
  lastVerifiedAt:  { type: Date, default: null },
  lastVerifyError: { type: String, default: '' },
}, { _id: false });
MainCrmIntegrationSchema.virtual('apiKey')
  .set(function (val) { this.apiKeyEncrypted = encrypt(val); })
  .get(function () { return decrypt(this.apiKeyEncrypted); });

// Prospect Website Audit — Google PageSpeed Insights API key(s). Same
// encrypted-secret pattern as MainCrmIntegrationSchema above. A second,
// optional key exists purely for throughput: PSI caps each key at 25k
// requests/day, so a large batch can round-robin across two keys to
// roughly halve total crawl time (see cron/prospectAuditDispatcher.js).
const PageSpeedIntegrationSchema = new mongoose.Schema({
  apiKeyEncrypted:  { type: String, default: '', select: false },
  apiKey2Encrypted: { type: String, default: '', select: false },
  lastVerifiedAt:   { type: Date, default: null },
  lastVerifyError:  { type: String, default: '' },
}, { _id: false });
PageSpeedIntegrationSchema.virtual('apiKey')
  .set(function (val) { this.apiKeyEncrypted = encrypt(val); })
  .get(function () { return decrypt(this.apiKeyEncrypted); });
PageSpeedIntegrationSchema.virtual('apiKey2')
  .set(function (val) { this.apiKey2Encrypted = encrypt(val); })
  .get(function () { return decrypt(this.apiKey2Encrypted); });

// Social Media Management — Meta App (Facebook Pages + Instagram Business,
// one Meta App covers both via Facebook Login for Business) and LinkedIn App
// (Company Page posting) credentials, entered once by an admin in Settings →
// Social Media Platforms. These are the app-level Client ID/Secret used to
// run the OAuth authorize/exchange flow in socialAccountController.js — NOT
// the per-account access tokens themselves (those live on SocialAccount).
// Same encrypted-secret pattern as every other integration above.
const MetaAppSchema = new mongoose.Schema({
  appId:               { type: String, default: '' }, // not secret
  appSecretEncrypted:  { type: String, default: '', select: false },
  lastVerifiedAt:      { type: Date, default: null },
  lastVerifyError:     { type: String, default: '' },
}, { _id: false });
MetaAppSchema.virtual('appSecret')
  .set(function (val) { this.appSecretEncrypted = encrypt(val); })
  .get(function () { return decrypt(this.appSecretEncrypted); });

const LinkedInAppSchema = new mongoose.Schema({
  clientId:               { type: String, default: '' }, // not secret
  clientSecretEncrypted:  { type: String, default: '', select: false },
  lastVerifiedAt:         { type: Date, default: null },
  lastVerifyError:        { type: String, default: '' },
}, { _id: false });
LinkedInAppSchema.virtual('clientSecret')
  .set(function (val) { this.clientSecretEncrypted = encrypt(val); })
  .get(function () { return decrypt(this.clientSecretEncrypted); });

// X (Twitter) App — OAuth 2.0 with PKCE. clientSecret is only used for the
// "confidential client" token-exchange flow; X issues both a Client ID and
// Client Secret for this type of app registration.
const XAppSchema = new mongoose.Schema({
  clientId:               { type: String, default: '' },
  clientSecretEncrypted:  { type: String, default: '', select: false },
  lastVerifiedAt:         { type: Date, default: null },
  lastVerifyError:        { type: String, default: '' },
}, { _id: false });
XAppSchema.virtual('clientSecret')
  .set(function (val) { this.clientSecretEncrypted = encrypt(val); })
  .get(function () { return decrypt(this.clientSecretEncrypted); });

// YouTube App — standard Google OAuth 2.0 (googleapis is already a
// dependency here, reused by YouTubeProvider rather than hand-rolling
// Google's token endpoints).
const YouTubeAppSchema = new mongoose.Schema({
  clientId:               { type: String, default: '' },
  clientSecretEncrypted:  { type: String, default: '', select: false },
  lastVerifiedAt:         { type: Date, default: null },
  lastVerifyError:        { type: String, default: '' },
}, { _id: false });
YouTubeAppSchema.virtual('clientSecret')
  .set(function (val) { this.clientSecretEncrypted = encrypt(val); })
  .get(function () { return decrypt(this.clientSecretEncrypted); });

// TikTok App — OAuth 2.0. TikTok calls its public identifier "Client Key"
// (not "Client ID") in its own docs/dashboard — kept as clientKey here to
// match exactly what an admin will see when copying it in.
const TikTokAppSchema = new mongoose.Schema({
  clientKey:              { type: String, default: '' },
  clientSecretEncrypted:  { type: String, default: '', select: false },
  lastVerifiedAt:         { type: Date, default: null },
  lastVerifyError:        { type: String, default: '' },
}, { _id: false });
TikTokAppSchema.virtual('clientSecret')
  .set(function (val) { this.clientSecretEncrypted = encrypt(val); })
  .get(function () { return decrypt(this.clientSecretEncrypted); });

// Which roles/specific users can access a given sidebar "feature" — same
// additive OR semantics as NotificationRoutingRuleSchema (role match OR
// userId match). 'client' is deliberately NOT in the roles enum: the client
// portal's access to shared endpoints (tasks/todos/meetings/messages) is
// governed by each route's clientBypass, not by this admin UI — see
// middleware/authorizeFeature.js.
const FeatureAccessRuleSchema = new mongoose.Schema({
  roles:   { type: [String], enum: ['admin', 'manager', 'member', 'client_relations', 'read_only'], default: [] },
  userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { _id: false });

const CustomFieldSchema = new mongoose.Schema({
  module:   { type: String, enum: ['Contacts', 'Companies', 'Deals'], required: true },
  name:     { type: String, required: true },
  label:    { type: String, required: true },
  type:     { type: String, enum: ['text', 'number', 'date', 'boolean', 'select'], required: true },
  options:  [{ type: String }], // for select type
  required: { type: Boolean, default: false }
});



const SystemSettingsSchema = new mongoose.Schema({
  // Company Profile & Localization
  companyName:     { type: String, default: 'BizzBuzz Creations' },
  companyLogo:     { type: String, default: '' },
  defaultTimezone: { type: String, default: 'Asia/Kolkata' },
  defaultCurrency: { type: String, default: 'USD' },
  dateFormat:      { type: String, default: 'YYYY-MM-DD' },
  timeFormat:      { type: String, default: '12h' },

  // Billing & Subscription
  subscriptionPlan:    { type: String, default: 'Enterprise Growth' },
  subscriptionStatus:  { type: String, default: 'Active' },
  billingLimitApi:     { type: Number, default: 50000 },
  billingLimitStorage: { type: Number, default: 100 }, // in GB

  // Security & Authentication
  passwordComplexity:  { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  sessionTimeout:      { type: Number, default: 120 }, // minutes
  enforce2FA:          { type: Boolean, default: false },
  ipWhitelist:         [{ type: String }],

  // Rate limiting — request-count caps only (not the time window; see
  // rateLimiters.js for why). loginMax guards POST /api/auth/login against
  // credential-guessing; witPublicMax guards the public Website
  // Intelligence tracking endpoints against flooding/abuse.
  rateLimits: {
    loginMax:     { type: Number, default: 30, min: 1 },
    witPublicMax: { type: Number, default: 100, min: 1 },
  },

  // Lead & Pipeline Stages
  pipelines: {
    type: [PipelineSchema],
    default: [{
      name: 'Sales Funnel',
      stages: [
        { name: 'Lead Generated', color: '#3b82f6', probability: 20 },
        { name: 'Contacted', color: '#f59e0b', probability: 40 },
        { name: 'Proposal Sent', color: '#8b5cf6', probability: 70 },
        { name: 'Negotiation', color: '#ec4899', probability: 90 },
        { name: 'Closed Won', color: '#10b981', probability: 100 },
        { name: 'Closed Lost', color: '#ef4444', probability: 0 }
      ],
      lostReasons: ['Pricing too high', 'Went with competitor', 'Product feature gap', 'No budget'],
      wonReasons: ['Best solution match', 'Competitive pricing', 'Great relationships', 'Quick delivery']
    }]
  },

  // Custom Fields Configuration
  customFields: {
    type: [CustomFieldSchema],
    default: []
  },

  // Dynamic Teams & Departments list
  departments: {
    type: [String],
    default: ['Management', 'Sales', 'Engineering', 'Marketing', 'Support', 'General']
  },
  positions: {
    type: [String],
    default: ['Developer', 'Graphic Designer', 'Video Editor', 'SEO', 'HR', 'BDE', 'SMM', 'Other']
  },
  industries: {
    type: [String],
    default: ['Technology', 'Retail', 'Marketing', 'Finance', 'Healthcare', 'Education', 'Real Estate', 'Other']
  },
  teams: {
    type: [{
      name: { type: String, required: true },
      description: { type: String, default: '' }
    }],
    default: [
      { name: 'Sales Team East', description: 'East coast outreach and growth' },
      { name: 'Engineering Core', description: 'Core product engineers' },
      { name: 'Support Squad', description: 'Global client support team' }
    ]
  },

  // Task & Lead Assignment Rules
  assignmentRules: {
    leadDistribution:    { type: String, enum: ['none', 'round-robin', 'least-loaded'], default: 'round-robin' },
    activeSalesRepsOnly: { type: Boolean, default: true }
  },

  // Shared Templates
  emailTemplates: {
    type: [{
      name:    { type: String, required: true },
      subject: { type: String, required: true },
      body:    { type: String, required: true }
    }],
    default: [
      { name: 'Welcome Email', subject: 'Welcome to BizzBuzz!', body: 'Hi {{name}},\n\nThank you for choosing us! We are thrilled to partner with you.\n\nBest,\n{{sender}}' },
      { name: 'Meeting Follow Up', subject: 'Follow up on our discussion', body: 'Hi {{name}},\n\nIt was great speaking with you today. As discussed, here are the next steps...\n\nWarm regards,\n{{sender}}' }
    ]
  },
  snippetLibrary: {
    type: [{
      trigger: { type: String, required: true },
      text:    { type: String, required: true }
    }],
    default: [
      { trigger: ';greet', text: 'Thank you for reaching out to BizzBuzz support. How can I help you today?' },
      { trigger: ';close', text: 'If you have any further questions, please let us know. Have a wonderful day!' }
    ]
  },

  // Integrations config
  integrations: {
    slackEnabled:                { type: Boolean, default: false },
    slackWebhookUrl:             { type: String, default: '' },
    voipEnabled:                 { type: Boolean, default: false },
    marketingAutomationEnabled:  { type: Boolean, default: false }
  },

  // Notification routing — which roles/specific users receive each
  // system-generated notification GROUP. 'campaign' covers email opened /
  // call requested / lead replied as one setting (not one row per event
  // type); 'lead_capture' covers a new Lead created via an external/public
  // form integration (witPublicController.captureLead, external-api/
  // leadCapture) — deliberately separate from 'campaign' since it's a
  // different kind of event (a brand-new lead, not engagement on an
  // existing one) an admin may want routed to different people. Defaults
  // preserve pre-existing hardcoded behavior (admin+manager) until an admin
  // actually opens Settings → Notification Routing and changes it.
  notificationRouting: {
    type: Map,
    of: NotificationRoutingRuleSchema,
    default: () => new Map([
      ['campaign',      { roles: ['admin', 'manager'], userIds: [] }],
      ['lead_capture',  { roles: ['admin', 'manager'], userIds: [] }],
    ]),
  },

  // Feature access control — which roles/specific users can use each sidebar
  // feature (Settings → Feature Access Control). Defaults are taken verbatim
  // from the pre-existing hardcoded role arrays in Sidebar.jsx/AppRouter.jsx,
  // so day-one behavior is unchanged until an admin actually edits a rule.
  // Enforced for real on the backend, not just hidden in the UI — see
  // middleware/authorizeFeature.js and routes/index.js.
  featureAccess: {
    type: Map,
    of: FeatureAccessRuleSchema,
    default: () => new Map([
      ['dashboard',              { roles: ['admin', 'manager', 'member', 'client_relations', 'read_only'], userIds: [] }],
      ['todos',                  { roles: ['admin', 'manager', 'member', 'client_relations', 'read_only'], userIds: [] }],
      ['tasks',                  { roles: ['admin', 'manager', 'member', 'client_relations', 'read_only'], userIds: [] }],
      ['clients',                { roles: ['admin', 'manager', 'member', 'client_relations', 'read_only'], userIds: [] }],
      ['leads',                  { roles: ['admin', 'manager', 'client_relations', 'read_only'],           userIds: [] }],
      ['campaigns',              { roles: ['admin', 'manager', 'read_only'],                               userIds: [] }],
      ['ads_monitoring',         { roles: ['admin', 'manager', 'read_only'],                               userIds: [] }],
      ['website_intelligence',   { roles: ['admin', 'manager', 'read_only'],                               userIds: [] }],
      ['messages',               { roles: ['admin', 'manager', 'member', 'client_relations', 'read_only'], userIds: [] }],
      ['meetings',               { roles: ['admin', 'manager', 'member', 'client_relations', 'read_only'], userIds: [] }],
      ['reports',                { roles: ['admin', 'manager', 'member', 'client_relations', 'read_only'], userIds: [] }],
      ['calendar',               { roles: ['admin', 'manager', 'member', 'client_relations', 'read_only'], userIds: [] }],
      ['billing',                { roles: ['admin', 'manager', 'read_only'],                               userIds: [] }],
      ['team',                   { roles: ['admin', 'manager', 'read_only'],                               userIds: [] }],
      ['audit_logs',             { roles: ['admin', 'read_only'],                                          userIds: [] }],
      ['system_monitor',         { roles: ['admin', 'read_only'],                                          userIds: [] }],
      ['api_keys',               { roles: ['admin', 'read_only'],                                          userIds: [] }],
      ['prospect_audit',         { roles: ['admin', 'manager', 'read_only'],                                userIds: [] }],
      ['social_media',           { roles: ['admin', 'manager', 'read_only'],                                userIds: [] }],
      ['payroll_pay_runs',       { roles: ['admin', 'manager'],                                            userIds: [] }],
      ['payroll_leaves',         { roles: ['admin', 'manager', 'member', 'client_relations', 'read_only'], userIds: [] }],
    ]),
  },

  mainCrmIntegration: { type: MainCrmIntegrationSchema, default: () => ({}) },
  pageSpeedIntegration: { type: PageSpeedIntegrationSchema, default: () => ({}) },
  metaApp: { type: MetaAppSchema, default: () => ({}) },
  linkedinApp: { type: LinkedInAppSchema, default: () => ({}) },
  xApp: { type: XAppSchema, default: () => ({}) },
  youtubeApp: { type: YouTubeAppSchema, default: () => ({}) },
  tiktokApp: { type: TikTokAppSchema, default: () => ({}) },

  // Import/Export Control
  dataControl: {
    allowBulkImport:    { type: Boolean, default: true },
    allowExportClients: { type: Boolean, default: true },
    allowExportTasks:   { type: Boolean, default: true }
  }
}, { timestamps: true });

module.exports = mongoose.model('SystemSettings', SystemSettingsSchema);
