import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { ChevronLeft, ChevronRight, Facebook, Instagram, Linkedin, Twitter, Youtube, Music2, X } from 'lucide-react';
import useAppStore from '../store/useAppStore';
import { Page, Modal, Button } from '../components/ui';
import { getCalendarDays, cn, localDateStr } from '../utils/helpers';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Mirrors STATUS_CHART_COLOR's light/dark validated palette convention in utils/helpers.js
const STATUS_COLOR = {
  draft:                { light: '#94a3b8', dark: '#7c8ba1', label: 'Draft' },
  scheduled:             { light: '#2a78d6', dark: '#3987e5', label: 'Scheduled' },
  publishing:            { light: '#eda100', dark: '#c98500', label: 'Publishing' },
  partially_published:   { light: '#eda100', dark: '#c98500', label: 'Partial' },
  published:             { light: '#1baf7a', dark: '#199e70', label: 'Published' },
  failed:                { light: '#dc2626', dark: '#c92e2e', label: 'Failed' },
  cancelled:             { light: '#94a3b8', dark: '#7c8ba1', label: 'Cancelled' },
};

const PLATFORM_ICON = { facebook_page: Facebook, instagram_business: Instagram, linkedin_organization: Linkedin, x: Twitter, youtube: Youtube, tiktok: Music2 };

function postDateKey(post) {
  const d = post.scheduledAt || post.createdAt;
  return localDateStr(new Date(d));
}

export default function SocialCalendarPage() {
  const navigate = useNavigate();
  const { posts, loadPosts } = useAppStore(useShallow((s) => ({
    posts: s.socialPosts,
    loadPosts: s.loadSocialPosts,
  })));

  const today = new Date();
  const todayStr = localDateStr(today);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedPost, setSelectedPost] = useState(null);

  useEffect(() => { loadPosts(); }, [loadPosts]);

  const days = getCalendarDays(year, month);
  const prevMonth = () => { if (month === 0) { setMonth(11); setYear((y) => y - 1); } else setMonth((m) => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear((y) => y + 1); } else setMonth((m) => m + 1); };
  const goToday = () => { setYear(today.getFullYear()); setMonth(today.getMonth()); };

  const postsByDate = useMemo(() => {
    const map = {};
    for (const p of posts) {
      const key = postDateKey(p);
      (map[key] = map[key] || []).push(p);
    }
    return map;
  }, [posts]);

  return (
    <Page>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="page-title">Content Calendar</h1>
          <p className="page-sub">Drafts, scheduled, published, and failed posts by day</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"><ChevronLeft size={16} /></button>
          <span className="text-[14px] font-semibold text-slate-800 dark:text-slate-200 min-w-[140px] text-center">{MONTHS[month]} {year}</span>
          <button onClick={nextMonth} className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"><ChevronRight size={16} /></button>
          <Button variant="outline" size="sm" onClick={goToday}>Today</Button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-700">
          {DAYS.map((d) => (
            <div key={d} className="py-2 text-center text-[11px] font-bold uppercase tracking-wide text-slate-400">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map(({ date, current }, i) => {
            const dateStr = localDateStr(date);
            const dayPosts = postsByDate[dateStr] || [];
            const isToday = dateStr === todayStr;
            return (
              <div
                key={i}
                className={cn(
                  'min-h-[95px] border-b border-r border-slate-100 dark:border-slate-800 p-1.5',
                  !current && 'bg-slate-50 dark:bg-slate-900/40',
                  i % 7 === 6 && 'border-r-0'
                )}
              >
                <div className={cn('w-6 h-6 rounded-full flex items-center justify-center text-[11.5px] font-semibold mb-1',
                  isToday ? 'bg-primary-500 text-white' : current ? 'text-slate-700 dark:text-slate-300' : 'text-slate-350 dark:text-slate-600')}>
                  {date.getDate()}
                </div>
                <div className="space-y-[3px]">
                  {dayPosts.slice(0, 3).map((p) => {
                    const cfg = STATUS_COLOR[p.status] || STATUS_COLOR.draft;
                    return (
                      <button
                        key={p._id}
                        onClick={() => setSelectedPost(p)}
                        className="flex items-center gap-1 w-full text-[10px] px-1.5 py-[3px] rounded border-l-[2px] truncate text-left"
                        style={{ background: `${cfg.light}18`, color: cfg.light, borderLeftColor: cfg.light }}
                      >
                        <span className="truncate">{p.content?.slice(0, 28) || '(no text)'}</span>
                      </button>
                    );
                  })}
                  {dayPosts.length > 3 && (
                    <p className="text-[9.5px] text-slate-400 pl-1">+{dayPosts.length - 3} more</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Modal open={!!selectedPost} onClose={() => setSelectedPost(null)} title="Post" size="md">
        {selectedPost && (
          <div className="px-6 py-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="badge" style={{ background: `${(STATUS_COLOR[selectedPost.status] || STATUS_COLOR.draft).light}18`, color: (STATUS_COLOR[selectedPost.status] || STATUS_COLOR.draft).light }}>
                {(STATUS_COLOR[selectedPost.status] || STATUS_COLOR.draft).label}
              </span>
              {selectedPost.scheduledAt && (
                <span className="text-[12px] text-slate-500 dark:text-slate-400">{new Date(selectedPost.scheduledAt).toLocaleString()}</span>
              )}
            </div>
            {selectedPost.title && <p className="text-[14.5px] font-bold text-slate-900 dark:text-white">{selectedPost.title}</p>}
            <p className="text-[13.5px] text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{selectedPost.content}</p>
            {selectedPost.media?.[0] && (
              selectedPost.media[0].type === 'image'
                ? <img src={selectedPost.media[0].url} alt="" className="max-h-56 rounded-lg" />
                : <video src={selectedPost.media[0].url} className="max-h-56 rounded-lg" controls />
            )}
            <div className="flex items-center gap-2">
              {(selectedPost.selectedAccounts || []).map((a) => {
                const Icon = PLATFORM_ICON[a.platform];
                return <span key={a._id} className="flex items-center gap-1 text-[11.5px] text-slate-500 dark:text-slate-400">{Icon && <Icon size={12} />} {a.accountName}</span>;
              })}
            </div>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => navigate('/social-media/posts')}>View in Posts</Button>
            </div>
          </div>
        )}
      </Modal>
    </Page>
  );
}
