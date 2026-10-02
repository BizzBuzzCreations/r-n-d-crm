import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import useAppStore from '../store/useAppStore';
import DashboardLayout from '../layouts/DashboardLayout';
import { hasFeatureAccess } from '../utils/featureAccess';

// Pages
import LoginPage          from '../pages/auth/LoginPage';
import DashboardPage      from '../pages/DashboardPage';
import TasksPage          from '../pages/TasksPage';
import TodosPage          from '../pages/TodosPage';
import ClientsPage        from '../pages/ClientsPage';
import LeadsPage          from '../pages/LeadsPage';
import MessagesPage       from '../pages/MessagesPage';
import ReportsPage        from '../pages/ReportsPage';
import MeetingsPage       from '../pages/MeetingsPage';
import CalendarPage       from '../pages/CalendarPage';
import TeamPage           from '../pages/TeamPage';
import SettingsPage       from '../pages/SettingsPage';
import LogsPage           from '../pages/LogsPage';
import SystemLogsPage     from '../pages/SystemLogsPage';
import ClientPortalPage   from '../pages/portal/ClientPortalPage';
import BillingPage        from '../pages/BillingPage';
import CampaignsPage      from '../pages/CampaignsPage';
import CampaignDetailPage from '../pages/CampaignDetailPage';
import MetaAdsPage        from '../pages/MetaAdsPage';
import WebsiteIntelligencePage from '../pages/WebsiteIntelligencePage';
import ProspectAuditsPage      from '../pages/ProspectAuditsPage';
import ProspectAuditDetailPage from '../pages/ProspectAuditDetailPage';
import SocialAccountsPage from '../pages/SocialAccountsPage';
import SocialComposerPage from '../pages/SocialComposerPage';
import SocialCalendarPage from '../pages/SocialCalendarPage';
import SocialPostsPage    from '../pages/SocialPostsPage';
import ApiKeysPage         from '../pages/ApiKeysPage';
import PayrollPayRunsPage from '../pages/payroll/PayrollPayRunsPage';
import PayrollLeavesPage  from '../pages/payroll/PayrollLeavesPage';

// ── Guards ────────────────────────────────────────────────────
function RequireAuth({ children }) {
  const authUser = useAppStore((s) => s.authUser);
  if (!authUser) return <Navigate to="/login" replace />;
  return children;
}

// Only used for /portal now (client-only, no featureKey/admin-configurable
// rule involved) — every other gated route uses RequireFeatureAccess below.
function RequireRole({ roles, children }) {
  const authUser = useAppStore((s) => s.authUser);
  if (!authUser) return <Navigate to="/login" replace />;
  if (!roles.includes(authUser?.role)) return <Navigate to="/dashboard" replace />;
  return children;
}

// Real, admin-configurable, per-feature access control — the single guard
// for every staff-facing route. Reads SystemSettings.featureAccess (Settings
// → Feature Access Control) via the same hasFeatureAccess() helper the
// Sidebar uses, so nav visibility and route access can never drift apart.
// `defaultRoles` is the feature's pre-existing hardcoded fallback, used only
// if the feature has never been configured — mirrors the backend's
// authorizeFeature(featureKey, defaultRoles) so the two layers agree.
function RequireFeatureAccess({ featureKey, defaultRoles, children }) {
  const authUser = useAppStore((s) => s.authUser);
  const systemSettings = useAppStore((s) => s.systemSettings);
  if (!authUser) return <Navigate to="/login" replace />;
  if (!hasFeatureAccess(authUser, systemSettings, featureKey, defaultRoles)) {
    // A client denied here must land on /portal, never /dashboard — /dashboard
    // itself denies clients too (client isn't in its defaultRoles), which
    // would otherwise bounce back here and loop.
    return <Navigate to={authUser.role === 'client' ? '/portal' : '/dashboard'} replace />;
  }
  return children;
}

// /payroll itself has no page — send people to the first sub-section they can use
// (Pay Runs for admin/manager, Leaves for everyone else).
function PayrollIndexRedirect() {
  const authUser = useAppStore((s) => s.authUser);
  const systemSettings = useAppStore((s) => s.systemSettings);
  const canPayRuns = hasFeatureAccess(authUser, systemSettings, 'payroll_pay_runs', ['admin', 'manager']);
  return <Navigate to={canPayRuns ? '/payroll/pay-runs' : '/payroll/leaves'} replace />;
}

// Clients land on /portal; staff land on /dashboard
function DefaultRedirect() {
  const authUser = useAppStore((s) => s.authUser);
  if (authUser?.role === 'client') return <Navigate to="/portal" replace />;
  return <Navigate to="/dashboard" replace />;
}

// ── Router ────────────────────────────────────────────────────
export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected — all inside DashboardLayout */}
        <Route
          path="/"
          element={
            <RequireAuth>
              <DashboardLayout />
            </RequireAuth>
          }
        >
          <Route index element={<DefaultRedirect />} />

          {/* ── Client portal (role: client only) ── */}
          <Route
            path="portal"
            element={
              <RequireRole roles={['client']}>
                <ClientPortalPage />
              </RequireRole>
            }
          />

          {/* ── Staff routes — access controlled by Settings → Feature Access
               Control (SystemSettings.featureAccess); defaultRoles below are
               the fallback used only if a feature has never been configured,
               and match the backend's authorizeFeature() defaults exactly. ── */}
          <Route path="dashboard" element={<RequireFeatureAccess featureKey="dashboard" defaultRoles={['admin', 'manager', 'member', 'client_relations']}><DashboardPage /></RequireFeatureAccess>} />
          <Route path="tasks"     element={<RequireFeatureAccess featureKey="tasks" defaultRoles={['admin', 'manager', 'member', 'client_relations']}><TasksPage /></RequireFeatureAccess>} />
          <Route path="todos"     element={<RequireFeatureAccess featureKey="todos" defaultRoles={['admin', 'manager', 'member', 'client_relations']}><TodosPage /></RequireFeatureAccess>} />
          <Route
            path="clients"
            element={
              <RequireFeatureAccess featureKey="clients" defaultRoles={['admin', 'manager', 'member', 'client_relations']}>
                <ClientsPage />
              </RequireFeatureAccess>
            }
          />
          <Route
            path="leads"
            element={
              <RequireFeatureAccess featureKey="leads" defaultRoles={['admin', 'manager', 'client_relations']}>
                <LeadsPage />
              </RequireFeatureAccess>
            }
          />
          <Route path="messages"  element={<RequireFeatureAccess featureKey="messages" defaultRoles={['admin', 'manager', 'member', 'client_relations', 'client']}><MessagesPage /></RequireFeatureAccess>} />
          <Route path="reports"   element={<RequireFeatureAccess featureKey="reports" defaultRoles={['admin', 'manager', 'member', 'client_relations']}><ReportsPage /></RequireFeatureAccess>} />
          <Route path="meetings"  element={<RequireFeatureAccess featureKey="meetings" defaultRoles={['admin', 'manager', 'member', 'client_relations']}><MeetingsPage /></RequireFeatureAccess>} />
          <Route path="calendar"  element={<RequireFeatureAccess featureKey="calendar" defaultRoles={['admin', 'manager', 'member', 'client_relations']}><CalendarPage /></RequireFeatureAccess>} />
          <Route
            path="billing"
            element={
              <RequireFeatureAccess featureKey="billing" defaultRoles={['admin', 'manager']}>
                <BillingPage />
              </RequireFeatureAccess>
            }
          />
          <Route
            path="team"
            element={
              <RequireFeatureAccess featureKey="team" defaultRoles={['admin', 'manager']}>
                <TeamPage />
              </RequireFeatureAccess>
            }
          />
          <Route
            path="campaigns"
            element={
              <RequireFeatureAccess featureKey="campaigns" defaultRoles={['admin', 'manager']}>
                <CampaignsPage />
              </RequireFeatureAccess>
            }
          />
          <Route
            path="campaigns/:id"
            element={
              <RequireFeatureAccess featureKey="campaigns" defaultRoles={['admin', 'manager']}>
                <CampaignDetailPage />
              </RequireFeatureAccess>
            }
          />
          <Route
            path="meta-ads"
            element={
              <RequireFeatureAccess featureKey="ads_monitoring" defaultRoles={['admin', 'manager']}>
                <MetaAdsPage />
              </RequireFeatureAccess>
            }
          />
          <Route
            path="website-intelligence"
            element={
              <RequireFeatureAccess featureKey="website_intelligence" defaultRoles={['admin', 'manager']}>
                <WebsiteIntelligencePage />
              </RequireFeatureAccess>
            }
          />
          <Route
            path="prospect-audits"
            element={
              <RequireFeatureAccess featureKey="prospect_audit" defaultRoles={['admin', 'manager']}>
                <ProspectAuditsPage />
              </RequireFeatureAccess>
            }
          />
          <Route
            path="prospect-audits/:id"
            element={
              <RequireFeatureAccess featureKey="prospect_audit" defaultRoles={['admin', 'manager']}>
                <ProspectAuditDetailPage />
              </RequireFeatureAccess>
            }
          />
          <Route path="payroll" element={<PayrollIndexRedirect />} />
          <Route
            path="payroll/pay-runs"
            element={
              <RequireFeatureAccess featureKey="payroll_pay_runs" defaultRoles={['admin', 'manager']}>
                <PayrollPayRunsPage />
              </RequireFeatureAccess>
            }
          />
          <Route
            path="payroll/leaves"
            element={
              <RequireFeatureAccess featureKey="payroll_leaves" defaultRoles={['admin', 'manager', 'member', 'client_relations', 'read_only']}>
                <PayrollLeavesPage />
              </RequireFeatureAccess>
            }
          />
          <Route
            path="social-media/accounts"
            element={
              <RequireFeatureAccess featureKey="social_media" defaultRoles={['admin', 'manager']}>
                <SocialAccountsPage />
              </RequireFeatureAccess>
            }
          />
          <Route
            path="social-media/composer"
            element={
              <RequireFeatureAccess featureKey="social_media" defaultRoles={['admin', 'manager']}>
                <SocialComposerPage />
              </RequireFeatureAccess>
            }
          />
          <Route
            path="social-media/calendar"
            element={
              <RequireFeatureAccess featureKey="social_media" defaultRoles={['admin', 'manager']}>
                <SocialCalendarPage />
              </RequireFeatureAccess>
            }
          />
          <Route
            path="social-media/posts"
            element={
              <RequireFeatureAccess featureKey="social_media" defaultRoles={['admin', 'manager']}>
                <SocialPostsPage />
              </RequireFeatureAccess>
            }
          />
          <Route path="settings" element={<SettingsPage />} />
          <Route
            path="logs"
            element={
              <RequireFeatureAccess featureKey="audit_logs" defaultRoles={['admin']}>
                <LogsPage />
              </RequireFeatureAccess>
            }
          />
          <Route
            path="system-logs"
            element={
              <RequireFeatureAccess featureKey="system_monitor" defaultRoles={['admin']}>
                <SystemLogsPage />
              </RequireFeatureAccess>
            }
          />
          <Route
            path="api-keys"
            element={
              <RequireFeatureAccess featureKey="api_keys" defaultRoles={['admin']}>
                <ApiKeysPage />
              </RequireFeatureAccess>
            }
          />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<DefaultRedirect />} />
      </Routes>
    </BrowserRouter>
  );
}
