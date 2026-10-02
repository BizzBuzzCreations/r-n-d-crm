import { forwardRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, AlertCircle, Info, CheckCircle, Eye, EyeOff } from 'lucide-react';
import { avatarUrl } from '../../services/api';
import { cn, PRIORITY_CONFIG, STATUS_CONFIG } from '../../utils/helpers';

// ── Button ────────────────────────────────────────────────────
export const Button = forwardRef(function Button(
  { children, variant = 'outline', size = 'md', className, loading, disabled, ...props },
  ref
) {
  const variants = {
    primary: 'btn-primary',
    outline: 'btn-outline',
    ghost:   'btn-ghost',
    danger:  'btn-danger',
    success: 'btn-success',
    icon:    'btn-icon',
  };
  const sizes = {
    xs: 'btn-xs',
    sm: 'btn-sm',
    md: '',
    lg: '!px-5 !py-2.5 !text-[14.5px]',
  };
  return (
    <button
      ref={ref}
      className={cn(variants[variant], sizes[size], 'select-none', className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" />
        </svg>
      )}
      {children}
    </button>
  );
});

// ── Badge ─────────────────────────────────────────────────────
export function Badge({ children, variant = 'neutral', dot = false, className }) {
  return (
    <span className={cn('badge', `badge-${variant}`, className)}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function PriorityBadge({ priority }) {
  const cfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.medium;
  return (
    <span className={cn('badge', cfg.tw, 'gap-1')}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {cfg.label}
    </span>
  );
}

export function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || { label: status, tw: 'badge-neutral' };
  return <span className={cn('badge', cfg.tw)}>{cfg.label}</span>;
}

// ── Avatar ────────────────────────────────────────────────────
// Profile picture if the user has one, otherwise their initials. The parent must clip (overflow-hidden).
export function AvatarContent({ user, fallback }) {
  const src = avatarUrl(user?.avatar);
  if (src) return <img src={src} alt={user?.name || ''} className="w-full h-full object-cover" draggable={false} />;
  return <>{fallback ?? (user?.initials || '??')}</>;
}

// Event name shared with components/UserPreviewModal.jsx (kept as a string here so ui/ doesn't import a component).
const PREVIEW_EVENT = 'crm:preview-user';

// `preview` (default on): clicking the avatar opens a larger photo + the user's
// profile. Pass preview={false} where the avatar sits inside a picker/selector
// whose own click handler must keep working.
export function Avatar({ user, size = 'sm', showStatus = false, className, preview = true }) {
  const canPreview = preview && !!user && (user.name || user.avatar);
  const openPreview = (e) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent(PREVIEW_EVENT, { detail: user }));
  };
  const sizes = { xs: 'w-6 h-6 text-[10px]', sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-12 h-12 text-base', xl: 'w-16 h-16 text-xl' };
  const statusColors = { online: '#10b981', away: '#f59e0b', offline: '#94a3b8' };

  return (
    <div
      className={cn('relative inline-flex flex-shrink-0', canPreview && 'cursor-pointer', className)}
      onClick={canPreview ? openPreview : undefined}
      title={canPreview ? `View ${user.name || 'profile'}` : undefined}
    >
      <div
        className={cn('rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0 overflow-hidden', sizes[size])}
        style={{ background: user?.avatar ? 'transparent' : (user?.color || '#6366f1') }}
      >
        <AvatarContent user={user} />
      </div>
      {showStatus && (
        <span
          className="absolute bottom-0 right-0 rounded-full border-2 border-white dark:border-slate-800"
          style={{
            width: size === 'xl' ? 14 : size === 'lg' ? 12 : 9,
            height: size === 'xl' ? 14 : size === 'lg' ? 12 : 9,
            background: statusColors[user?.status] || '#94a3b8',
          }}
        />
      )}
    </div>
  );
}

// ── AvatarGroup ───────────────────────────────────────────────
export function AvatarGroup({ users, max = 3, size = 'sm' }) {
  const shown = users.slice(0, max);
  const rest  = users.length - max;
  return (
    <div className="flex items-center">
      {shown.map((u, i) => (
        <div key={u.id} className={cn('-ml-2 first:ml-0 ring-2 ring-white dark:ring-slate-800 rounded-full')}>
          <Avatar user={u} size={size} />
        </div>
      ))}
      {rest > 0 && (
        <div className={cn('-ml-2 ring-2 ring-white dark:ring-slate-800 rounded-full w-8 h-8 flex items-center justify-center bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 text-[11px] font-semibold')}>
          +{rest}
        </div>
      )}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, size = 'md', footer }) {
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-3xl' };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Box */}
          <motion.div
            className={cn('relative w-full bg-white dark:bg-slate-800 rounded-2xl shadow-modal flex flex-col max-h-[90vh]', widths[size])}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
              <h3 className="text-[15px] font-semibold text-slate-900 dark:text-white">{title}</h3>
              <button
                onClick={onClose}
                className="btn-icon text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">{children}</div>

            {/* Footer */}
            {footer && (
              <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Input ─────────────────────────────────────────────────────
export const Input = forwardRef(function Input(
  { label, error, className, type = 'text', ...props },
  ref
) {
  const [show, setShow] = useState(false);
  const isPassword = type === 'password';

  return (
    <div className="w-full">
      {label && <label className="form-label">{label}</label>}
      <div className="relative">
        <input
          ref={ref}
          type={isPassword ? (show ? 'text' : 'password') : type}
          className={cn('form-input', error && 'border-red-400 focus:border-red-400 focus:ring-red-400/20', className)}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
});

// ── Textarea ──────────────────────────────────────────────────
export const Textarea = forwardRef(function Textarea(
  { label, error, className, rows = 3, ...props },
  ref
) {
  return (
    <div className="w-full">
      {label && <label className="form-label">{label}</label>}
      <textarea
        ref={ref}
        rows={rows}
        className={cn('form-input resize-none', error && 'border-red-400', className)}
        {...props}
      />
      {error && <p className="form-error">{error}</p>}
    </div>
  );
});

// ── Select ────────────────────────────────────────────────────
export const Select = forwardRef(function Select(
  { label, error, className, children, ...props },
  ref
) {
  return (
    <div className="w-full">
      {label && <label className="form-label">{label}</label>}
      <select
        ref={ref}
        className={cn('form-input cursor-pointer', error && 'border-red-400', className)}
        {...props}
      >
        {children}
      </select>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
});

// ── ProgressBar ───────────────────────────────────────────────
export function ProgressBar({ value = 0, color = '#6366f1', height = 6, className }) {
  return (
    <div
      className={cn('rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden', className)}
      style={{ height }}
    >
      <motion.div
        className="h-full rounded-full"
        style={{ background: color }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
    </div>
  );
}

// ── Toggle ────────────────────────────────────────────────────
export function Toggle({ checked, onChange, label, description }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        {label && <p className="text-[13.5px] font-medium text-slate-800 dark:text-slate-200">{label}</p>}
        {description && <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 outline-none',
          checked ? 'bg-primary-500' : 'bg-slate-300 dark:bg-slate-600'
        )}
        role="switch"
        aria-checked={checked}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform ring-0 transition duration-200',
            checked ? 'translate-x-4' : 'translate-x-0'
          )}
        />
      </button>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────
export function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn(
        'rounded-lg bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 dark:from-slate-700 dark:via-slate-600 dark:to-slate-700',
        'bg-[length:200%_100%] animate-shimmer',
        className
      )}
      {...props}
    />
  );
}

// ── Empty State ───────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      {Icon && (
        <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
          <Icon size={24} className="text-slate-400" />
        </div>
      )}
      <p className="text-[15px] font-semibold text-slate-700 dark:text-slate-300 mb-1">{title}</p>
      {description && <p className="text-[13px] text-slate-500 dark:text-slate-400 max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────
export function StatCard({ icon: Icon, label, value, change, color = '#6366f1', bg = '#eef2ff', onClick }) {
  return (
    <motion.div
      className={cn('card p-5 cursor-default flex flex-col gap-3', onClick && 'cursor-pointer')}
      whileHover={{ y: -2, boxShadow: '0 6px 18px rgba(0,0,0,.1)' }}
      transition={{ duration: 0.15 }}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
          {Icon && <Icon size={20} style={{ color }} />}
        </div>
        {change !== undefined && (
          <span className={cn('text-[12px] font-semibold flex items-center gap-0.5', change >= 0 ? 'text-emerald-600' : 'text-red-500')}>
            {change >= 0 ? '↑' : '↓'} {Math.abs(change)}%
          </span>
        )}
      </div>
      <div>
        <div className="text-[28px] font-bold text-slate-900 dark:text-white leading-none">{value}</div>
        <div className="text-[13px] text-slate-500 dark:text-slate-400 font-medium mt-1">{label}</div>
      </div>
    </motion.div>
  );
}

// ── Confirm Dialog ────────────────────────────────────────────
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Delete', variant = 'danger' }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="px-6 py-5">
        <p className="text-[13.5px] text-slate-600 dark:text-slate-400">{message}</p>
      </div>
      <div className="flex justify-end gap-2.5 px-6 pb-5">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant={variant} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

// ── Page wrapper with animation ────────────────────────────────
export function Page({ children, className }) {
  return (
    <motion.div
      className={cn('w-full', className)}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────
export function Tabs({ tabs, active, onChange, className }) {
  return (
    <div className={cn('flex gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg p-1 w-fit', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={cn(
            'px-3.5 py-1.5 rounded-md text-[13px] font-medium transition-all duration-150',
            active === tab.value
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={cn('ml-1.5 text-[11px] px-1.5 py-0.5 rounded-full', active === tab.value ? 'bg-primary-100 text-primary-600' : 'bg-slate-200 dark:bg-slate-700 text-slate-500')}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── ViewToggle ────────────────────────────────────────────────
export function ViewToggle({ views, active, onChange }) {
  return (
    <div className="flex gap-0.5">
      {views.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          title={label}
          className={cn(
            'w-8 h-8 flex items-center justify-center rounded-lg border transition-all duration-150',
            active === value
              ? 'bg-primary-50 border-primary-300 text-primary-600 dark:bg-primary-900/20 dark:border-primary-700 dark:text-primary-400'
              : 'border-slate-300 dark:border-slate-600 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 bg-white dark:bg-transparent'
          )}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

// ── Dropdown Menu ─────────────────────────────────────────────
export function DropdownMenu({ trigger, items, align = 'right' }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <div onClick={() => setOpen((s) => !s)}>{trigger}</div>
      <AnimatePresence>
        {open && (
          <motion.div
            className={cn(
              'absolute z-50 mt-1.5 min-w-[160px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-modal overflow-hidden',
              align === 'right' ? 'right-0' : 'left-0'
            )}
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.12 }}
          >
            <div className="p-1">
              {items.map((item, i) =>
                item.separator ? (
                  <hr key={i} className="my-1 border-slate-200 dark:border-slate-700" />
                ) : (
                  <button
                    key={i}
                    onClick={() => { item.onClick?.(); setOpen(false); }}
                    className={cn(
                      'flex items-center gap-2 w-full px-2.5 py-2 rounded-lg text-[13px] transition-colors duration-100',
                      item.danger
                        ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                    )}
                  >
                    {item.icon && <item.icon size={14} />}
                    {item.label}
                  </button>
                )
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
