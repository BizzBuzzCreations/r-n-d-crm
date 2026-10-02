import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Eye } from 'lucide-react';
import Sidebar from './Sidebar';
import Navbar from './Navbar';
import UserPreviewModal from '../components/UserPreviewModal';
import useAppStore from '../store/useAppStore';

export default function DashboardLayout() {
  const darkMode = useAppStore((s) => s.darkMode);
  const authUser = useAppStore((s) => s.authUser);
  const navigate = useNavigate();

  // ── In-app toast click → navigate to thread ──────────────────
  useEffect(() => {
    const handler = (e) => {
      useAppStore.getState().setActiveThread(e.detail.threadId);
      navigate('/messages');
    };
    window.addEventListener('crm:navigate-thread', handler);
    return () => window.removeEventListener('crm:navigate-thread', handler);
  }, [navigate]);

  // ── Service Worker registration + notification permission ─────
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Register the notification service worker
    navigator.serviceWorker
      .register('/sw-notify.js', { scope: '/' })
      .catch(() => {});

    // Handle click messages from the SW (OS notification clicked)
    const swMessageHandler = (event) => {
      const { type, path, threadId } = event.data || {};
      if (type === 'crm:navigate' && path) {
        if (threadId) useAppStore.getState().setActiveThread(threadId);
        navigate(path);
      }
      // legacy
      if (type === 'crm:navigate-thread' && threadId) {
        useAppStore.getState().setActiveThread(threadId);
        navigate('/messages');
      }
    };
    navigator.serviceWorker.addEventListener('message', swMessageHandler);

    return () => {
      navigator.serviceWorker.removeEventListener('message', swMessageHandler);
    };
  }, [navigate]);

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-slate-950">
        <Sidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <Navbar />
          {authUser?.role === 'read_only' && (
            <div className="flex items-center justify-center gap-2 py-1.5 px-4 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-900/50 text-[12px] font-medium text-amber-700 dark:text-amber-400">
              <Eye size={13} /> Read-only account — you can view everything, but changes aren't permitted.
            </div>
          )}
          <main className="flex-1 overflow-y-auto p-6">
            <Outlet />
          </main>
        </div>
      </div>
      <UserPreviewModal />
    </div>
  );
}
