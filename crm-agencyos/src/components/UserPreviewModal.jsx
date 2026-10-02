import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Mail, Phone, Briefcase, Building2, CalendarDays } from 'lucide-react';
import useAppStore, { getId } from '../store/useAppStore';
import { avatarUrl } from '../services/api';
import { cn, ROLE_CONFIG } from '../utils/helpers';

export const PREVIEW_EVENT = 'crm:preview-user';

const STATUS = {
  online:  { label: 'Online',  color: '#10b981' },
  away:    { label: 'Away',    color: '#f59e0b' },
  offline: { label: 'Offline', color: '#94a3b8' },
};

function InfoRow({ icon: Icon, children }) {
  return (
    <div className="flex items-start gap-2.5 text-[13px] text-slate-600 dark:text-slate-300">
      <Icon size={14} className="text-slate-400 mt-0.5 flex-shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

// One instance lives in DashboardLayout. Any <Avatar> dispatches PREVIEW_EVENT
// with the user it shows; we resolve the full record from the store (avatars
// often only carry name/color/initials) and show a larger photo + profile.
export default function UserPreviewModal() {
  const users = useAppStore((s) => s.users);
  const [target, setTarget] = useState(null);

  useEffect(() => {
    const open = (e) => setTarget(e.detail);
    window.addEventListener(PREVIEW_EVENT, open);
    return () => window.removeEventListener(PREVIEW_EVENT, open);
  }, []);

  useEffect(() => {
    if (!target) return;
    const onKey = (e) => e.key === 'Escape' && setTarget(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target]);

  const id = target ? getId(target) : null;
  const full = target ? { ...target, ...(id ? users.find((u) => getId(u) === id) : null) } : null;
  const photo = avatarUrl(full?.avatar);
  const role = ROLE_CONFIG[full?.role];
  const status = STATUS[full?.status] || STATUS.offline;
  const close = () => setTarget(null);

  return (
    <AnimatePresence>
      {full && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={close} />

          <motion.div
            className="relative w-full max-w-sm bg-white dark:bg-slate-800 rounded-2xl shadow-modal overflow-hidden"
            initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            role="dialog" aria-label={`${full.name || 'User'} profile`}
          >
            <button onClick={close} aria-label="Close" className="absolute top-3 right-3 z-10 btn-icon text-white/80 hover:text-white hover:bg-white/10">
              <X size={16} />
            </button>

            {/* Banner + big photo */}
            <div className="h-24" style={{ background: `linear-gradient(135deg, ${full.color || '#6366f1'}, ${full.color || '#6366f1'}99)` }} />
            <div className="flex flex-col items-center -mt-16 px-6 pb-6">
              <div className="relative">
                <div
                  className="w-32 h-32 rounded-full flex items-center justify-center text-white text-[40px] font-bold overflow-hidden ring-4 ring-white dark:ring-slate-800 shadow-lg"
                  style={{ background: photo ? '#0f172a' : (full.color || '#6366f1') }}
                >
                  {photo
                    ? <img src={photo} alt={full.name || ''} className="w-full h-full object-cover" draggable={false} />
                    : (full.initials || full.name?.[0] || '?')}
                </div>
                <span className="absolute bottom-2 right-2 w-4 h-4 rounded-full border-[3px] border-white dark:border-slate-800" style={{ background: status.color }} title={status.label} />
              </div>

              <h3 className="mt-3 text-[18px] font-bold text-slate-900 dark:text-white text-center">{full.name || 'Unknown user'}</h3>
              <div className="flex items-center gap-2 mt-1.5">
                {role && <span className={cn('badge text-[10.5px]', role.tw)}>{role.label}</span>}
                <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-500">
                  <span className="w-2 h-2 rounded-full" style={{ background: status.color }} /> {status.label}
                </span>
              </div>

              {(full.position || full.department || full.email || full.phone || full.joinDate) && (
                <div className="w-full mt-5 pt-4 border-t border-slate-200 dark:border-slate-700 space-y-2.5">
                  {full.position && <InfoRow icon={Briefcase}>{full.position}</InfoRow>}
                  {full.department && <InfoRow icon={Building2}>{full.department}</InfoRow>}
                  {full.email && <InfoRow icon={Mail}><a href={`mailto:${full.email}`} className="text-indigo-600 dark:text-indigo-300 hover:underline">{full.email}</a></InfoRow>}
                  {full.phone && <InfoRow icon={Phone}>{full.phone}</InfoRow>}
                  {full.joinDate && <InfoRow icon={CalendarDays}>Joined {full.joinDate}</InfoRow>}
                </div>
              )}

              {full.bio && (
                <p className="w-full mt-4 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/30 text-[12.5px] text-slate-600 dark:text-slate-300 leading-relaxed">
                  {full.bio}
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
