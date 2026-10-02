import axios from 'axios';

const getApiUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && envUrl.startsWith('http')) {
    const isLocalEnv = envUrl.includes('localhost') || envUrl.includes('127.0.0.1');
    const isLocalBrowser = typeof window !== 'undefined' && 
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.port === '5173');
    
    if (!isLocalEnv || isLocalBrowser) {
      return envUrl;
    }
  }
  
  if (typeof window !== 'undefined') {
    // If in development (Vite dev server), fallback to backend port 5000
    if (window.location.port === '5173') {
      return 'http://localhost:5000/api';
    }
    // In production, dynamically use the current browser origin!
    return `${window.location.origin}/api`;
  }
  return 'http://localhost:5000/api';
};

const BASE = getApiUrl();

export const getBackendUrl = () => {
  return BASE.endsWith('/api') ? BASE.slice(0, -4) : BASE;
};

// ── Axios instance ────────────────────────────────────────────
const api = axios.create({
  baseURL:         BASE,
  withCredentials: true,          // send cookies (refresh token)
  headers:         { 'Content-Type': 'application/json' },
  // 15s used to be too tight for a large campaign-lead import (email MX
  // verification runs per unique domain — a B2B import of thousands of
  // distinct company domains could take well past 15s even for the
  // synchronous path). The backend now offloads verification to the
  // background past a size threshold specifically so the import itself
  // stays fast regardless, but this is kept generous too as a margin for
  // whatever's just under that threshold.
  timeout:         60000,
});

// ── Request: attach access token ─────────────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('crm_access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Response: auto-refresh on 401 ────────────────────────────
let refreshing = false;
let queue      = [];

const processQueue = (err, token = null) => {
  queue.forEach((p) => (err ? p.reject(err) : p.resolve(token)));
  queue = [];
};

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const orig = err.config;
    // Avoid refresh loop on /auth/refresh itself, login, or logout endpoints
    const isAuthEndpoint = orig.url?.includes('/auth/refresh') || 
                           orig.url?.includes('/auth/login') || 
                           orig.url?.includes('/auth/logout');

    // Also skip refresh if there's no token (already logged out)
    const hasToken = !!localStorage.getItem('crm_access_token');

    if (err.response?.status === 401 && !orig._retry && !isAuthEndpoint && hasToken) {
      if (refreshing) {
        return new Promise((resolve, reject) => queue.push({ resolve, reject }))
          .then((token) => { orig.headers.Authorization = `Bearer ${token}`; return api(orig); });
      }
      orig._retry = true;
      refreshing  = true;
      try {
        const { data } = await axios.post(`${BASE}/auth/refresh`, {}, { withCredentials: true });
        const token    = data.accessToken;
        localStorage.setItem('crm_access_token', token);
        api.defaults.headers.Authorization = `Bearer ${token}`;
        processQueue(null, token);
        orig.headers.Authorization = `Bearer ${token}`;
        return api(orig);
      } catch (e) {
        processQueue(e, null);
        localStorage.removeItem('crm_access_token');
        window.dispatchEvent(new Event('crm:logout'));
        return Promise.reject(e);
      } finally {
        refreshing = false;
      }
    }
    return Promise.reject(err);
  }
);

export default api;

// Turn a stored avatar value (e.g. "/uploads/avatars/x.png") into a loadable URL.
const MEDIA_PATH = /^\/uploads\/(avatars|leaves)\/([^/?#]+)$/;
export const avatarUrl = (avatar) => {
  if (!avatar) return null;
  if (/^(https?:|data:|blob:)/.test(avatar)) return avatar;
  // Profile pictures / leave attachments go through the /api/media route (see backend app.js)
  // because /uploads/* isn't reliably reachable through the production reverse proxy.
  const m = MEDIA_PATH.exec(avatar);
  if (m) return `${BASE}/media?d=${m[1]}&f=${encodeURIComponent(m[2])}`;
  return `${getBackendUrl()}${avatar}`;
};

// ─────────────────────────────────────────────────────────────
// ── Auth  (Section 2)
// ─────────────────────────────────────────────────────────────
export const authAPI = {
  login:          (body)  => api.post('/auth/login',    body),
  logout:         ()      => api.post('/auth/logout'),
  refresh:        ()      => api.post('/auth/refresh'),
  me:             ()      => api.get('/auth/me'),
  updateProfile:  (body)  => api.put('/auth/profile',   body),
  changePassword: (body)  => api.put('/auth/password',  body),
  uploadAvatar:   (file)  => { const fd = new FormData(); fd.append('avatar', file); return api.put('/auth/avatar', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); },
  removeAvatar:   ()      => api.delete('/auth/avatar'),
};

// ─────────────────────────────────────────────────────────────
// ── Users  (Section 3)
// ─────────────────────────────────────────────────────────────
export const usersAPI = {
  getAll:  ()          => api.get('/users'),
  create:  (body)      => api.post('/users',      body),
  update:  (id, body)  => api.put(`/users/${id}`, body),
  delete:  (id)        => api.delete(`/users/${id}`),
};

// ─────────────────────────────────────────────────────────────
// ── Clients  (Section 4)
// ─────────────────────────────────────────────────────────────
export const clientsAPI = {
  getAll:               ()             => api.get('/clients'),
  getOne:               (id)           => api.get(`/clients/${id}`),
  create:               (body)         => api.post('/clients',      body),
  update:               (id, body)     => api.put(`/clients/${id}`, body),
  delete:               (id)           => api.delete(`/clients/${id}`),
  addNote:              (id, text)     => api.post(`/clients/${id}/notes`, { text }),
  resetPortalPassword:  (id, password) => api.post(`/clients/${id}/reset-portal-password`, { password }),
};

// ─────────────────────────────────────────────────────────────
// ── Tasks  (Section 5)
// ─────────────────────────────────────────────────────────────
export const tasksAPI = {
  getAll:          ()                => api.get('/tasks'),
  getByDateRange:  (start, end)      => api.get('/tasks', { params: { startDate: start, endDate: end } }),
  create:  (body)      => body instanceof FormData
    ? api.post('/tasks', body, { headers: { 'Content-Type': 'multipart/form-data' } })
    : api.post('/tasks', body),
  update:  (id, body)  => body instanceof FormData
    ? api.put(`/tasks/${id}`, body, { headers: { 'Content-Type': 'multipart/form-data' } })
    : api.put(`/tasks/${id}`, body),
  delete:  (id)        => api.delete(`/tasks/${id}`),
};

// ─────────────────────────────────────────────────────────────
// ── Todos  (Section 6)
// ─────────────────────────────────────────────────────────────
export const todosAPI = {
  getAll:          ()                => api.get('/todos'),
  getByDateRange:  (start, end)      => api.get('/todos', { params: { startDate: start, endDate: end } }),
  create:  (body)      => body instanceof FormData
    ? api.post('/todos', body, { headers: { 'Content-Type': 'multipart/form-data' } })
    : api.post('/todos', body),
  update:  (id, body)  => body instanceof FormData
    ? api.put(`/todos/${id}`, body, { headers: { 'Content-Type': 'multipart/form-data' } })
    : api.put(`/todos/${id}`, body),
  delete:  (id)        => api.delete(`/todos/${id}`),
};

// ─────────────────────────────────────────────────────────────
// ── Meetings  (Section 7)
// ─────────────────────────────────────────────────────────────
export const meetingsAPI = {
  getAll:  ()                        => api.get('/meetings'),
  create:  (body)                    => api.post('/meetings',      body),
  schedule: (body)                   => api.post('/meetings/schedule', body),
  update:  (id, body)                => api.put(`/meetings/${id}`, body),
  delete:  (id)                      => api.delete(`/meetings/${id}`),
  getMySchedule: ()                  => api.get('/meetings/my-schedule'),
  rsvp:    (invitationId, status)    => api.put(`/meetings/rsvp/${invitationId}`, { status }),
};

// ─────────────────────────────────────────────────────────────
// ── Messages  (Section 8)
// ─────────────────────────────────────────────────────────────
export const messagesAPI = {
  getThread:  (threadId)          => api.get(`/messages/${threadId}`),
  // text-only message
  send:       (threadId, text)    => api.post(`/messages/${threadId}`, { text }),
  // with file attachments — multipart/form-data
  sendFiles:  (threadId, fd)      => api.post(`/messages/${threadId}`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  delete:     (id)                => api.delete(`/messages/${id}`),
  react:      (id, emoji = '👍')  => api.post(`/messages/${id}/react`, { emoji }),
};

// ─────────────────────────────────────────────────────────────
// ── Revenue  (Section 9)
// ─────────────────────────────────────────────────────────────
export const revenueAPI = {
  getSummary: () => api.get('/revenue/summary'),
  record: (body) => api.post('/revenue/record', body),
};

// ─────────────────────────────────────────────────────────────
// ── Reports  (Section 9)
// ─────────────────────────────────────────────────────────────
export const reportsAPI = {
  // params: { period, userId, from, to }
  get: (params) => api.get('/reports', { params }),
};

// ─────────────────────────────────────────────────────────────
// ── Work Log  (Section 10)
// ─────────────────────────────────────────────────────────────
export const worklogAPI = {
  // params: { userId }
  getAll:    (params) => api.get('/worklog',        { params }),
  upsert:    (body)   => api.post('/worklog',        body),
  setActive: (active) => api.patch('/worklog/active', { active }),
  update:    (id, body) => api.patch(`/worklog/${id}`, body),
  delete:    (id)     => api.delete(`/worklog/${id}`),
  bulkDelete: (ids)   => api.delete('/worklog/bulk', { data: { ids } }),
};

// ─────────────────────────────────────────────────────────────
// ── Notifications  (Section 11)
// ─────────────────────────────────────────────────────────────
export const notificationsAPI = {
  getAll:         (params) => api.get('/notifications', { params }),
  getUnreadCount: ()       => api.get('/notifications/unread-count'),
  markRead:       (id)     => api.patch(`/notifications/${id}/read`),
  markAllRead:    ()       => api.patch('/notifications/read-all'),
  delete:    (id) => api.delete(`/notifications/${id}`),
};

// ─────────────────────────────────────────────────────────────
// ── Services  (Section 12)
// ─────────────────────────────────────────────────────────────
export const servicesAPI = {
  getAll:  ()          => api.get('/services'),
  create:  (body)      => api.post('/services', body),
  update:  (id, body)  => api.put(`/services/${id}`, body),
  delete:  (id)        => api.delete(`/services/${id}`),
};

// ─────────────────────────────────────────────────────────────
// ── Channels
// ─────────────────────────────────────────────────────────────
export const channelsAPI = {
  getAll: () => api.get('/channels'),
  create: (body) => api.post('/channels', body),
  update: (id, body) => api.put(`/channels/${id}`, body),
  delete: (id) => api.delete(`/channels/${id}`),
};

// ─────────────────────────────────────────────────────────────
// ── Projects
// ─────────────────────────────────────────────────────────────
export const projectsAPI = {
  getAll:  ()          => api.get('/projects'),
  create:  (body)      => api.post('/projects', body),
  update:  (id, body)  => api.put(`/projects/${id}`, body),
  delete:  (id)        => api.delete(`/projects/${id}`),
};

// ─────────────────────────────────────────────────────────────
// ── Settings
// ─────────────────────────────────────────────────────────────
export const settingsAPI = {
  get:    ()          => api.get('/settings'),
  update: (body)      => api.put('/settings', body),
  invite: (body)      => api.post('/settings/users', body),
  testAssignmentSheet: () => api.get('/settings/assignment-sheet-test'),
};

// ── Leads
// ─────────────────────────────────────────────────────────────
export const leadsAPI = {
  getAll: ()                      => api.get('/leads'),
  create: (body)                  => api.post('/leads', body),
  bulkCreate: (leads)             => api.post('/leads/bulk', { leads }),
  update: (id, body)              => api.put(`/leads/${id}`, body),
  delete: (id)                    => api.delete(`/leads/${id}`),
  merge:  (body)                  => api.post('/leads/merge', body),
  sendEmail: (id, subject, body)  => api.post(`/leads/${id}/email`, { subject, body }),
  getEmailLogs: (id)              => api.get(`/leads/${id}/emails`),
};

// ─────────────────────────────────────────────────────────────
// ── Audit Logs (admin only)
// ─────────────────────────────────────────────────────────────
export const auditAPI = {
  getLogs:  (params) => api.get('/audit',        { params }),
  getStats: ()       => api.get('/audit/stats'),
};

// ─────────────────────────────────────────────────────────────
// ── System / Server Logs (admin only)
// ─────────────────────────────────────────────────────────────
export const systemLogsAPI = {
  listSources:    ()                           => api.get('/admin/logs/sources'),
  getLogs:        (source, params)             => api.get(`/admin/logs/${source}`, { params }),
  getStatus:      ()                           => api.get('/admin/logs/status'),
  downloadUrl:    (source)                     => `${api.defaults.baseURL}/admin/logs/${source}/download`,
};

// ─────────────────────────────────────────────────────────────
// ── Billing & Invoicing (admin + manager only)
// ─────────────────────────────────────────────────────────────
export const billingAPI = {
  getInvoices:  (params)            => api.get('/billing/invoices', { params }),
  getInvoice:   (id)                => api.get(`/billing/invoices/${id}`),
  createInvoice:(body)              => api.post('/billing/invoices', body),
  updateInvoice:(id, body)          => api.put(`/billing/invoices/${id}`, body),
  deleteInvoice:(id)                => api.delete(`/billing/invoices/${id}`),
  pdfUrl:       (id)                => `${api.defaults.baseURL}/billing/invoices/${id}/pdf`,
  getPayments:    (invoiceId)       => api.get(`/billing/invoices/${invoiceId}/payments`),
  recordPayment:  (invoiceId, body) => body instanceof FormData
    ? api.post(`/billing/invoices/${invoiceId}/payments`, body, { headers: { 'Content-Type': 'multipart/form-data' } })
    : api.post(`/billing/invoices/${invoiceId}/payments`, body),
  updatePayment:  (id, body) => body instanceof FormData
    ? api.put(`/billing/payments/${id}`, body, { headers: { 'Content-Type': 'multipart/form-data' } })
    : api.put(`/billing/payments/${id}`, body),
  deletePayment:  (id)              => api.delete(`/billing/payments/${id}`),
  attachmentUrl:  (filePath)        => filePath
    ? api.defaults.baseURL.replace(/\/api$/, '') + filePath
    : null,
  getCollections: ()                => api.get('/billing/collections'),
  updateBillingProfile: (clientId, body) => api.put(`/billing/clients/${clientId}/billing-profile`, body),
};

// ─────────────────────────────────────────────────────────────
// ── Email Accounts (admin + manager — bulk campaign sending infra)
// ─────────────────────────────────────────────────────────────
export const emailAccountsAPI = {
  getAll:  ()          => api.get('/email-accounts'),
  create:  (body)      => api.post('/email-accounts', body),
  update:  (id, body)  => api.put(`/email-accounts/${id}`, body),
  delete:  (id)        => api.delete(`/email-accounts/${id}`),
  test:    (id)        => api.post(`/email-accounts/${id}/test`),
  checkDomain: (id)    => api.get(`/email-accounts/${id}/domain-check`),
};

// ─────────────────────────────────────────────────────────────
// ── Campaigns (admin + manager — bulk email campaigns)
// ─────────────────────────────────────────────────────────────
export const campaignsAPI = {
  getAll:   ()          => api.get('/campaigns'),
  getOne:   (id)        => api.get(`/campaigns/${id}`),
  create:   (body)      => api.post('/campaigns', body),
  update:   (id, body)  => api.put(`/campaigns/${id}`, body),
  delete:   (id)        => api.delete(`/campaigns/${id}`),
  start:    (id)        => api.post(`/campaigns/${id}/start`),
  schedule:   (id, scheduledAt) => api.post(`/campaigns/${id}/schedule`, { scheduledAt }),
  unschedule: (id)              => api.post(`/campaigns/${id}/unschedule`),
  pause:    (id)        => api.post(`/campaigns/${id}/pause`),
  diagnose: (id)        => api.get(`/campaigns/${id}/diagnose`),
  resolveStuck: (id)    => api.post(`/campaigns/${id}/resolve-stuck`),

  getLeads:      (id)              => api.get(`/campaigns/${id}/leads`),
  importLeadsCsv: (id, file)       => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/campaigns/${id}/leads/import`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  importLeadsJson: (id, leads)     => api.post(`/campaigns/${id}/leads/import`, { leads }),
  importLeadsSheet: (id, googleSheetUrl) => api.post(`/campaigns/${id}/leads/import`, { googleSheetUrl }),
  // Backfills `phone` on leads ALREADY in the campaign (matched by email) —
  // safe on a live/actively-sending campaign, unlike re-running import
  // (which is insert-only and silently skips emails already present).
  updatePhonesCsv: (id, file)      => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/campaigns/${id}/leads/update-phones`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  updatePhonesSheet: (id, googleSheetUrl) => api.post(`/campaigns/${id}/leads/update-phones`, { googleSheetUrl }),
  deleteLead:    (id, leadId)      => api.delete(`/campaigns/${id}/leads/${leadId}`),
  markReplied:   (id, leadId)      => api.post(`/campaigns/${id}/leads/${leadId}/mark-replied`),
  verifyLead:    (id, leadId)      => api.post(`/campaigns/${id}/leads/${leadId}/verify`),
  verifyAllLeads: (id)             => api.post(`/campaigns/${id}/leads/verify-all`),

  uploadImage: (file) => {
    const fd = new FormData();
    fd.append('image', file);
    return api.post('/campaigns/upload-image', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};

// ─────────────────────────────────────────────────────────────
// ── Email Templates (shared library — reusable campaign email content)
// ─────────────────────────────────────────────────────────────
export const emailTemplatesAPI = {
  getAll:  ()          => api.get('/email-templates'),
  create:  (body)      => api.post('/email-templates', body),
  update:  (id, body)  => api.put(`/email-templates/${id}`, body),
  delete:  (id)        => api.delete(`/email-templates/${id}`),
};

// ─────────────────────────────────────────────────────────────
// ── Meta Ads Analytics (admin/manager only)
// ─────────────────────────────────────────────────────────────
export const metaAdsAPI = {
  status:         ()               => api.get('/meta-ads/status'),
  saveCredentials: (body)          => api.put('/meta-ads/credentials', body),
  clearCredentials: ()             => api.delete('/meta-ads/credentials'),
  testConnection: ()               => api.post('/meta-ads/test-connection'),
  syncNow:        ()               => api.post('/meta-ads/sync-now'),
  summary:        (params)         => api.get('/meta-ads/summary', { params }),
  trends:         (params)         => api.get('/meta-ads/trends', { params }),
  campaigns:      (params)         => api.get('/meta-ads/campaigns', { params }),
  adsets:         (params)         => api.get('/meta-ads/adsets', { params }),
  ads:            (params)         => api.get('/meta-ads/ads', { params }),
  leads:          (params)         => api.get('/meta-ads/leads', { params }),
};

// ─────────────────────────────────────────────────────────────
// ── IVA CRM Integration (admin only)
// ─────────────────────────────────────────────────────────────
export const mainCrmAPI = {
  status:          ()     => api.get('/main-crm-integration/status'),
  saveCredentials: (body) => api.put('/main-crm-integration/credentials', body),
  clearCredentials: ()    => api.delete('/main-crm-integration/credentials'),
  testConnection:  ()     => api.post('/main-crm-integration/test-connection'),
};

// ─────────────────────────────────────────────────────────────
// ── PageSpeed Insights Integration (admin only)
// ─────────────────────────────────────────────────────────────
export const pageSpeedIntegrationAPI = {
  status:          ()     => api.get('/pagespeed-integration/status'),
  saveCredentials: (body) => api.put('/pagespeed-integration/credentials', body),
  clearCredentials: ()    => api.delete('/pagespeed-integration/credentials'),
  testConnection:  ()     => api.post('/pagespeed-integration/test-connection'),
};

// ─────────────────────────────────────────────────────────────
// ── Prospect Audits (admin/manager)
// ─────────────────────────────────────────────────────────────
export const prospectAuditsAPI = {
  getAll:  ()     => api.get('/prospect-audits'),
  getOne:  (id)   => api.get(`/prospect-audits/${id}`),
  create:  (body) => api.post('/prospect-audits', body),
  delete:  (id)   => api.delete(`/prospect-audits/${id}`),
  start:   (id)   => api.post(`/prospect-audits/${id}/start`),
  pause:   (id)   => api.post(`/prospect-audits/${id}/pause`),

  getProspects: (id) => api.get(`/prospect-audits/${id}/prospects`),
  deleteProspect: (id, prospectId) => api.delete(`/prospect-audits/${id}/prospects/${prospectId}`),
  importCsv: (id, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/prospect-audits/${id}/import`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  importSheet: (id, googleSheetUrl) => api.post(`/prospect-audits/${id}/import`, { googleSheetUrl }),
};

// ─────────────────────────────────────────────────────────────
// ── Social Media Platforms — Meta App / LinkedIn App credentials (admin only)
// ─────────────────────────────────────────────────────────────
export const socialPlatformSettingsAPI = {
  status:           (platform)       => api.get(`/social-platforms/${platform}/status`),
  saveCredentials:  (platform, body) => api.put(`/social-platforms/${platform}/credentials`, body),
  clearCredentials: (platform)       => api.delete(`/social-platforms/${platform}/credentials`),
};

// ─────────────────────────────────────────────────────────────
// ── Social Media Management (admin/manager)
// ─────────────────────────────────────────────────────────────
export const socialAPI = {
  getAccounts:   ()   => api.get('/social/accounts'),
  deleteAccount: (id) => api.delete(`/social/accounts/${id}`),
  // A real full-page browser navigation (OAuth needs the browser, not an
  // XHR) — token passed as a query param the same way billing/portal PDF
  // downloads already do (protect() supports ?token= as a fallback to the
  // Bearer header for exactly this kind of non-AJAX navigation).
  connectUrl: (platform) => `${api.defaults.baseURL}/social/accounts/${platform}/connect?token=${encodeURIComponent(localStorage.getItem('crm_access_token') || '')}`,

  getPosts:   (params) => api.get('/social/posts', { params }),
  getPost:    (id)     => api.get(`/social/posts/${id}`),
  createPost: (body)   => api.post('/social/posts', body),
  updatePost: (id, body) => api.patch(`/social/posts/${id}`, body),
  deletePost: (id)     => api.delete(`/social/posts/${id}`),
  publishPost:  (id)              => api.post(`/social/posts/${id}/publish`),
  schedulePost: (id, scheduledAt) => api.post(`/social/posts/${id}/schedule`, { scheduledAt }),
  cancelPost:   (id)              => api.post(`/social/posts/${id}/cancel`),

  retryPublication: (id) => api.post(`/social/publications/${id}/retry`),

  getCalendar:  (params) => api.get('/social/calendar', { params }),
  getAnalytics: ()       => api.get('/social/analytics'),

  uploadMedia: (file) => {
    const fd = new FormData();
    fd.append('media', file);
    return api.post('/social/posts/upload-media', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};

// ─────────────────────────────────────────────────────────────
// ── Website Intelligence (admin/manager only)
// ─────────────────────────────────────────────────────────────
export const witAPI = {
  getWebsites:       ()               => api.get('/website-intelligence/websites'),
  createWebsite:     (body)           => api.post('/website-intelligence/websites', body),
  updateWebsite:     (id, body)       => api.put(`/website-intelligence/websites/${id}`, body),
  regenerateSecret:  (id)             => api.post(`/website-intelligence/websites/${id}/regenerate-secret`),
  deleteWebsite:     (id)             => api.delete(`/website-intelligence/websites/${id}`),
  summary:           (params)         => api.get('/website-intelligence/summary', { params }),
  trends:            (params)         => api.get('/website-intelligence/trends', { params }),
  trafficSources:    (params)         => api.get('/website-intelligence/traffic-sources', { params }),
  countries:         (params)         => api.get('/website-intelligence/countries', { params }),
  devices:           (params)         => api.get('/website-intelligence/devices', { params }),
  pages:             (params)         => api.get('/website-intelligence/pages', { params }),
  landingPages:      (params)         => api.get('/website-intelligence/landing-pages', { params }),
  forms:             (params)         => api.get('/website-intelligence/forms', { params }),
  funnel:            (params)         => api.get('/website-intelligence/funnel', { params }),
  leadAttribution:   (params)         => api.get('/website-intelligence/lead-attribution', { params }),
  repeatVisitors:    (params)         => api.get('/website-intelligence/repeat-visitors', { params }),
};

// ─────────────────────────────────────────────────────────────
// ── API Keys (admin only) — credentials for external callers, e.g. the
// main CRM's lead-sync integration
// ─────────────────────────────────────────────────────────────
export const apiKeysAPI = {
  getKeys:    ()     => api.get('/api-keys'),
  createKey:  (body) => api.post('/api-keys', body),
  deleteKey:  (id)   => api.delete(`/api-keys/${id}`),
};

// ─────────────────────────────────────────────────────────────
// ── Payroll — Pay Runs (admin/manager) + Leaves (all staff, own-scoped)
// ─────────────────────────────────────────────────────────────
export const payrollAPI = {
  getLeaves:         (params)    => api.get('/payroll/leaves', { params }),
  // multipart because a leave request can carry an attachment
  createLeave:       (body)      => {
    const fd = new FormData();
    Object.entries(body).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') fd.append(k, v); });
    return api.post('/payroll/leaves', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  updateLeaveStatus: (id, body)  => api.put(`/payroll/leaves/${id}/status`, body),
  deleteLeave:       (id)        => api.delete(`/payroll/leaves/${id}`),
  getPayRuns:        ()          => api.get('/payroll/pay-runs'),
  createPayRun:      (body)      => api.post('/payroll/pay-runs', body),
  updatePayRun:      (id, body)  => api.put(`/payroll/pay-runs/${id}`, body),
  deletePayRun:      (id)        => api.delete(`/payroll/pay-runs/${id}`),
};

// ─────────────────────────────────────────────────────────────
// ── Client Portal (role: client only)
// ─────────────────────────────────────────────────────────────
export const portalAPI = {
  overview: () => api.get('/portal/overview'),
  me:       () => api.get('/portal/me'),
  contacts: () => api.get('/portal/contacts'),
  invoices: () => api.get('/portal/invoices'),
  invoice:  (id) => api.get(`/portal/invoices/${id}`),
  pdfUrl:   (id) => `${api.defaults.baseURL}/portal/invoices/${id}/pdf`,
};