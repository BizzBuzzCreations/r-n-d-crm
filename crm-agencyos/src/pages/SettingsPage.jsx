import { useState, useMemo, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { 
  Download, AlertTriangle, RefreshCw, Save, Lock, User, Bell, Database, Clock, 
  Layers, Plus, Trash2, X, Edit2, Zap, Palette, Smartphone, Globe, BarChart3, 
  PenTool, Clapperboard, Camera, Wrench, Lightbulb, Shield, Rocket, HelpCircle, 
  Mail, Calendar, Users, Sliders, FileText, Check, Settings, Info, ArrowUpRight, Megaphone, Search, Share2,
  Twitter, Youtube, Music2,
  Wallet, CalendarOff,
  LayoutDashboard, ListTodo, CheckSquare, Target, MessageSquare, Video, Receipt, UserCircle, Terminal, KeyRound,
} from 'lucide-react';
import useAppStore, { getId, sameId } from '../store/useAppStore';
import { useShallow } from 'zustand/shallow';
import { Page, Toggle, Button, ConfirmDialog, Modal, AvatarContent } from '../components/ui';
import { cn, canManage, canAdmin, fmtDate, fmtTimer, ROLE_CONFIG, localDateStr } from '../utils/helpers';
import api, { metaAdsAPI, witAPI, mainCrmAPI, pageSpeedIntegrationAPI, socialPlatformSettingsAPI } from '../services/api';
import EmailAccountsManager from '../components/campaigns/EmailAccountsManager';
import EmailTemplatesManager from '../components/campaigns/EmailTemplatesManager';

// ── Shared Helper: CSV / JSON Downloader ───────────────────────────
function downloadCSV(rows, filename) {
  const csv  = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const PRESET_ICONS = ['⚡', '🎨', '📱', '🌐', '📊', '✍️', '🎬', '📸', '🔧', '💡', '🛡️', '🚀'];
const COLOR_SWATCHES = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#3b82f6', '#64748b'];

// ───────────────────────────────────────────────────────────────────
// ── Settings Subcomponents
// ───────────────────────────────────────────────────────────────────

// 1. Company Profile & Localization (Admin Only)
function CompanyProfileSection({ settings, onSave }) {
  const { register, handleSubmit } = useForm({
    defaultValues: {
      companyName:     settings?.companyName || 'BizzBuzz Creations',
      defaultTimezone: settings?.defaultTimezone || 'Asia/Kolkata',
      defaultCurrency: settings?.defaultCurrency || 'USD',
      dateFormat:      settings?.dateFormat || 'YYYY-MM-DD',
      timeFormat:      settings?.timeFormat || '12h'
    }
  });

  return (
    <form onSubmit={handleSubmit(onSave)} className="space-y-6">
      <h3 className="text-[16px] font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-200 dark:border-slate-700/60 flex items-center gap-2">
        <Globe size={18} className="text-indigo-500" /> Company Profile & Localization
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <label className="block text-[13.5px] font-semibold text-slate-700 dark:text-slate-350 mb-1.5">Company Name</label>
          <input className="form-input text-[13.5px] py-2" {...register('companyName')} />
        </div>
        <div>
          <label className="block text-[13.5px] font-semibold text-slate-700 dark:text-slate-350 mb-1.5">Default Timezone</label>
          <select className="form-input text-[13.5px] py-2" {...register('defaultTimezone')}>
            <option value="Asia/Kolkata">India (GMT+5:30) - Asia/Kolkata</option>
            <option value="UTC">UTC (GMT+0)</option>
            <option value="America/New_York">New York (EST) - America/New_York</option>
            <option value="Europe/London">London (BST) - Europe/London</option>
            <option value="Asia/Tokyo">Tokyo (JST) - Asia/Tokyo</option>
          </select>
        </div>
        <div>
          <label className="block text-[13.5px] font-semibold text-slate-700 dark:text-slate-350 mb-1.5">Default Currency</label>
          <select className="form-input text-[13.5px] py-2" {...register('defaultCurrency')}>
            <option value="USD">USD ($)</option>
            <option value="INR">INR (₹)</option>
            <option value="EUR">EUR (€)</option>
            <option value="GBP">GBP (£)</option>
          </select>
        </div>
        <div>
          <label className="block text-[13.5px] font-semibold text-slate-700 dark:text-slate-350 mb-1.5">Date Format</label>
          <select className="form-input text-[13.5px] py-2" {...register('dateFormat')}>
            <option value="YYYY-MM-DD">YYYY-MM-DD (2026-05-28)</option>
            <option value="DD/MM/YYYY">DD/MM/YYYY (28/05/2026)</option>
            <option value="MM/DD/YYYY">MM/DD/YYYY (05/28/2026)</option>
          </select>
        </div>
        <div>
          <label className="block text-[13.5px] font-semibold text-slate-700 dark:text-slate-350 mb-1.5">Time Format</label>
          <select className="form-input text-[13.5px] py-2" {...register('timeFormat')}>
            <option value="12h">12-hour (05:30 PM)</option>
            <option value="24h">24-hour (17:30)</option>
          </select>
        </div>
      </div>
      <Button variant="primary" type="submit" className="mt-2">
        <Save size={14} /> Save Profile Settings
      </Button>
    </form>
  );
}

// 2. Billing & Subscription (Admin Only)
function BillingSubscriptionSection({ settings, onSave }) {
  const [apiLimit, setApiLimit] = useState(settings?.billingLimitApi || 50000);
  const [storageLimit, setStorageLimit] = useState(settings?.billingLimitStorage || 100);

  const handleSave = () => {
    onSave({ billingLimitApi: Number(apiLimit), billingLimitStorage: Number(storageLimit) });
  };

  const mockInvoices = [
    { id: 'INV-2026-003', date: '2026-05-01', amount: '$499.00', status: 'Paid' },
    { id: 'INV-2026-002', date: '2026-04-01', amount: '$499.00', status: 'Paid' },
    { id: 'INV-2026-001', date: '2026-03-01', amount: '$499.00', status: 'Paid' }
  ];

  return (
    <div className="space-y-6">
      <h3 className="text-[16px] font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-200 dark:border-slate-700/60 flex items-center gap-2">
        <Rocket size={18} className="text-indigo-500" /> Billing & Plan Subscription
      </h3>

      <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-transparent border border-indigo-500/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <span className="badge badge-purple uppercase tracking-widest text-[10.5px] px-2.5 py-0.5 font-bold mb-2 inline-block">
            {settings?.subscriptionPlan || 'Enterprise Growth'}
          </span>
          <h4 className="text-[17px] font-bold text-slate-800 dark:text-white">Active Plan Status: <span className="text-emerald-500">{settings?.subscriptionStatus || 'Active'}</span></h4>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">Next invoice renewal: June 01, 2026 ($499.00/mo)</p>
        </div>
        <Button variant="outline" className="text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800">Upgrade / Modify Plan</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Sliders for limits */}
        <div className="bg-slate-50 dark:bg-slate-900/30 p-5 rounded-xl border border-slate-200 dark:border-slate-800/80">
          <label className="block text-[13.5px] font-bold text-slate-700 dark:text-slate-350 mb-2">Monthly API Call Limits: <span className="text-indigo-600 dark:text-indigo-400">{apiLimit.toLocaleString()} requests</span></label>
          <input 
            type="range" min="1000" max="100000" step="5000"
            className="w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-slate-200 dark:bg-slate-700 accent-indigo-500"
            value={apiLimit} onChange={(e) => setApiLimit(e.target.value)} 
          />
          <div className="flex justify-between text-[11px] text-slate-400 mt-2">
            <span>1,000 reqs</span>
            <span>100,000 reqs</span>
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-900/30 p-5 rounded-xl border border-slate-200 dark:border-slate-800/80">
          <label className="block text-[13.5px] font-bold text-slate-700 dark:text-slate-350 mb-2">Dynamic Storage Cap: <span className="text-indigo-600 dark:text-indigo-400">{storageLimit} GB</span></label>
          <input 
            type="range" min="10" max="500" step="10"
            className="w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-slate-200 dark:bg-slate-700 accent-indigo-500"
            value={storageLimit} onChange={(e) => setStorageLimit(e.target.value)} 
          />
          <div className="flex justify-between text-[11px] text-slate-400 mt-2">
            <span>10 GB</span>
            <span>500 GB</span>
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-[14px] font-bold text-slate-800 dark:text-slate-200 mb-3">Subscription Invoices History</h4>
        <div className="overflow-x-auto border border-slate-250 dark:border-slate-800 rounded-xl">
          <table className="w-full border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800/40">
              <tr className="border-b border-slate-250 dark:border-slate-800">
                <th className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3 px-4">Invoice ID</th>
                <th className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3 px-4">Date</th>
                <th className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3 px-4">Amount</th>
                <th className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {mockInvoices.map((inv) => (
                <tr key={inv.id} className="border-b border-slate-200 dark:border-slate-800/60 last:border-b-0 hover:bg-slate-50/40 dark:hover:bg-slate-900/10">
                  <td className="py-3 px-4 text-[13px] font-semibold text-indigo-650 dark:text-indigo-400">{inv.id}</td>
                  <td className="py-3 px-4 text-[13px] text-slate-600 dark:text-slate-450">{inv.date}</td>
                  <td className="py-3 px-4 text-[13px] font-mono text-slate-850 dark:text-slate-200">{inv.amount}</td>
                  <td className="py-3 px-4 text-[13px]"><span className="badge badge-success px-2 py-0.5">{inv.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Button variant="primary" onClick={handleSave}>
        <Save size={14} /> Update Limits & Preferences
      </Button>
    </div>
  );
}

// 3. Security & Authentication Global config (Admin Only)
function SecurityConfigSection({ settings, onSave }) {
  const [ipInput, setIpInput] = useState('');
  const [ipList, setIpList] = useState(settings?.ipWhitelist || []);
  const { register, handleSubmit } = useForm({
    defaultValues: {
      passwordComplexity: settings?.passwordComplexity || 'medium',
      sessionTimeout:     settings?.sessionTimeout || 120,
      enforce2FA:         !!settings?.enforce2FA,
      loginMax:           settings?.rateLimits?.loginMax || 30,
      witPublicMax:       settings?.rateLimits?.witPublicMax || 100,
    }
  });

  const handleAddIp = () => {
    if (!ipInput.trim()) return;
    if (ipList.includes(ipInput.trim())) return;
    setIpList([...ipList, ipInput.trim()]);
    setIpInput('');
  };

  const handleRemoveIp = (ip) => {
    setIpList(ipList.filter((x) => x !== ip));
  };

  const onSubmit = (data) => {
    const { loginMax, witPublicMax, ...rest } = data;
    onSave({
      ...rest,
      ipWhitelist: ipList,
      rateLimits: { loginMax: Number(loginMax) || 30, witPublicMax: Number(witPublicMax) || 100 },
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <h3 className="text-[16px] font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-200 dark:border-slate-700/60 flex items-center gap-2">
        <Shield size={18} className="text-indigo-500" /> Security & Authentication (Global Rules)
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <label className="block text-[13.5px] font-semibold text-slate-700 dark:text-slate-350 mb-1.5">Password Complexity Rules</label>
          <select className="form-input text-[13.5px] py-2" {...register('passwordComplexity')}>
            <option value="low">Low (Min 6 Characters)</option>
            <option value="medium">Medium (Min 8 Characters + Numbers)</option>
            <option value="high">High (Min 8 Characters + Caps/Special Symbols)</option>
          </select>
        </div>
        <div>
          <label className="block text-[13.5px] font-semibold text-slate-700 dark:text-slate-350 mb-1.5">Session Timeout (Minutes)</label>
          <input type="number" className="form-input text-[13.5px] py-2" {...register('sessionTimeout')} />
        </div>
      </div>

      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800">
        <h4 className="text-[14px] font-bold text-slate-800 dark:text-slate-200 mb-2">Two-Factor Authentication (2FA)</h4>
        <div className="flex items-center justify-between">
          <p className="text-[13px] text-slate-500 dark:text-slate-400">Enforce all CRM team members and sales representatives to complete 2FA login verification.</p>
          <input type="checkbox" className="w-5 h-5 accent-indigo-500" {...register('enforce2FA')} />
        </div>
      </div>

      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800">
        <h4 className="text-[14px] font-bold text-slate-800 dark:text-slate-200 mb-1.5">Rate Limiting</h4>
        <p className="text-[12.5px] text-slate-400 mb-3">
          Caps how many requests one IP can make before getting blocked, without a redeploy. Takes effect on the very next request after saving.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-350 mb-1.5">Login attempts (per 15 min, per IP)</label>
            <input type="number" min="1" className="form-input text-[13.5px] py-2" {...register('loginMax')} />
            <p className="text-[11.5px] text-slate-400 mt-1">Guards <code>/api/auth/login</code> against password guessing. Raise this if a legitimate automation (e.g. n8n) needs to log in repeatedly and keeps getting blocked.</p>
          </div>
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-350 mb-1.5">Tracking requests (per minute, per IP)</label>
            <input type="number" min="1" className="form-input text-[13.5px] py-2" {...register('witPublicMax')} />
            <p className="text-[11.5px] text-slate-400 mt-1">Guards the public Website Intelligence tracking endpoints against flooding. Many real visitors can share one IP (offices, mobile carriers) — keep this generous.</p>
          </div>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800">
        <h4 className="text-[14px] font-bold text-slate-800 dark:text-slate-200 mb-1.5">Whitelisted Corporate IPs</h4>
        <p className="text-[12.5px] text-slate-400 mb-3">Add static office IP addresses to restrict database access. Keep empty to permit login from anywhere.</p>
        <div className="flex gap-2 mb-3">
          <input 
            placeholder="e.g. 192.168.1.155" 
            className="form-input text-[13px] py-1.5 max-w-sm" 
            value={ipInput} onChange={(e) => setIpInput(e.target.value)} 
          />
          <Button variant="outline" type="button" onClick={handleAddIp}><Plus size={14} /> Whitelist IP</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {ipList.length === 0 ? (
            <span className="text-[12.5px] text-slate-400 italic">No IPs whitelisted yet. Global access enabled.</span>
          ) : (
            ipList.map((ip) => (
              <span key={ip} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12.5px] font-semibold bg-indigo-50 dark:bg-indigo-900/20 text-indigo-750 dark:text-indigo-350 border border-indigo-100 dark:border-indigo-950">
                {ip}
                <button type="button" onClick={() => handleRemoveIp(ip)} className="hover:text-red-500"><X size={12} /></button>
              </span>
            ))
          )}
        </div>
      </div>

      <Button variant="primary" type="submit">
        <Save size={14} /> Update Authentication Controls
      </Button>
    </form>
  );
}

// 4. Pipelines & Sales Funnel stages (Admin Only)
function PipelinesStagesSection({ settings, onSave }) {
  const [stages, setStages] = useState(settings?.pipelines?.[0]?.stages || []);
  const [newStageName, setNewStageName] = useState('');
  const [newStageColor, setNewStageColor] = useState('#6366f1');
  const [newStageProb, setNewStageProb] = useState(50);

  const [lostReasons, setLostReasons] = useState(settings?.pipelines?.[0]?.lostReasons || []);
  const [lostInput, setLostInput] = useState('');

  const [wonReasons, setWonReasons] = useState(settings?.pipelines?.[0]?.wonReasons || []);
  const [wonInput, setWonInput] = useState('');

  const handleAddStage = () => {
    if (!newStageName.trim()) return;
    setStages([...stages, { 
      name: newStageName.trim(), 
      color: newStageColor, 
      probability: Number(newStageProb) 
    }]);
    setNewStageName('');
    setNewStageColor('#6366f1');
    setNewStageProb(50);
  };

  const handleRemoveStage = (index) => {
    setStages(stages.filter((_, i) => i !== index));
  };

  const handleAddLost = () => {
    if (!lostInput.trim()) return;
    if (lostReasons.includes(lostInput.trim())) return;
    setLostReasons([...lostReasons, lostInput.trim()]);
    setLostInput('');
  };

  const handleAddWon = () => {
    if (!wonInput.trim()) return;
    if (wonReasons.includes(wonInput.trim())) return;
    setWonReasons([...wonReasons, wonInput.trim()]);
    setWonInput('');
  };

  const handleSave = () => {
    onSave({
      pipelines: [{
        name: 'Sales Funnel',
        stages,
        lostReasons,
        wonReasons
      }]
    });
  };

  return (
    <div className="space-y-6">
      <h3 className="text-[16px] font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-200 dark:border-slate-700/60 flex items-center gap-2">
        <Sliders size={18} className="text-indigo-500" /> Pipeline Stages & Deal Funnel Customizer
      </h3>

      <div className="space-y-4">
        <h4 className="text-[14px] font-bold text-slate-800 dark:text-slate-250">Deal Pipeline Progress Stages</h4>
        
        {/* Render stages */}
        <div className="flex flex-col gap-2">
          {stages.map((st, i) => (
            <div key={i} className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30">
              <div className="flex items-center gap-3">
                <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ background: st.color }} />
                <span className="text-[14px] font-bold text-slate-800 dark:text-slate-200">{st.name}</span>
                <span className="text-[12px] px-2 py-0.5 rounded-full bg-slate-200/50 dark:bg-slate-800 text-slate-500 font-semibold">{st.probability}% Prob</span>
              </div>
              <button 
                onClick={() => handleRemoveStage(i)} 
                className="text-slate-400 hover:text-red-500 p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        {/* Add Stage fields */}
        <div className="bg-slate-100/50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-750 flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[12.5px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Stage Name</label>
            <input 
              placeholder="e.g. Qualified Lead" 
              className="form-input text-[13px] py-1.5" 
              value={newStageName} onChange={(e) => setNewStageName(e.target.value)} 
            />
          </div>
          <div>
            <label className="block text-[12.5px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Prob (%)</label>
            <input 
              type="number" min="0" max="100" 
              className="form-input text-[13px] py-1.5 w-20" 
              value={newStageProb} onChange={(e) => setNewStageProb(e.target.value)} 
            />
          </div>
          <div>
            <label className="block text-[12.5px] font-semibold text-slate-600 dark:text-slate-400 mb-1">Color</label>
            <div className="flex items-center gap-1.5 h-10">
              <input type="color" className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent" value={newStageColor} onChange={(e) => setNewStageColor(e.target.value)} />
            </div>
          </div>
          <Button variant="outline" onClick={handleAddStage} className="h-10 px-4"><Plus size={14} /> Add Stage</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Lost Reasons */}
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800">
          <h4 className="text-[13.5px] font-bold text-slate-800 dark:text-slate-200 mb-2">Deal Closed Lost Reasons</h4>
          <div className="flex gap-2 mb-3">
            <input 
              placeholder="e.g. Budget Freeze" 
              className="form-input text-[13px] py-1.5" 
              value={lostInput} onChange={(e) => setLostInput(e.target.value)} 
            />
            <Button variant="outline" type="button" onClick={handleAddLost}><Plus size={13} /></Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {lostReasons.map((lr) => (
              <span key={lr} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 text-[12px] font-medium border border-red-100 dark:border-red-950">
                {lr}
                <button type="button" onClick={() => setLostReasons(lostReasons.filter(x => x !== lr))} className="hover:text-red-900"><X size={10} /></button>
              </span>
            ))}
          </div>
        </div>

        {/* Won Reasons */}
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800">
          <h4 className="text-[13.5px] font-bold text-slate-800 dark:text-slate-200 mb-2">Deal Closed Won Reasons</h4>
          <div className="flex gap-2 mb-3">
            <input 
              placeholder="e.g. Premium Support" 
              className="form-input text-[13px] py-1.5" 
              value={wonInput} onChange={(e) => setWonInput(e.target.value)} 
            />
            <Button variant="outline" type="button" onClick={handleAddWon}><Plus size={13} /></Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {wonReasons.map((wr) => (
              <span key={wr} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 text-[12px] font-medium border border-emerald-100 dark:border-emerald-950">
                {wr}
                <button type="button" onClick={() => setWonReasons(wonReasons.filter(x => x !== wr))} className="hover:text-emerald-950"><X size={10} /></button>
              </span>
            ))}
          </div>
        </div>
      </div>

      <Button variant="primary" onClick={handleSave}>
        <Save size={14} /> Persist Pipeline Configuration
      </Button>
    </div>
  );
}

// 5b. Notification Routing (Admins & Managers) — who receives each
// system-generated notification GROUP, by role and/or by specific person.
// The two are independent and additive server-side (see notificationService
// .dispatchByRouting) — a person picked here gets notified even with no
// role selected at all. 'campaign' covers every campaign-engagement event
// (email opened, call requested, lead replied) as ONE setting, not one row
// per event type.
const NOTIFICATION_EVENT_DEFS = [
  { key: 'campaign', label: 'Campaign', description: 'Any campaign engagement — a lead opens an email, requests a call, or replies.' },
];
const NOTIFICATION_ROUTABLE_ROLES = ['admin', 'manager', 'member', 'client_relations', 'read_only'];

// Shared by the initial state and the resync effect below — see the `dirty`
// comment in NotificationRoutingSection for why a resync effect exists.
function buildRoutingFromSettings(settings) {
  const src = settings?.notificationRouting || {};
  const init = {};
  NOTIFICATION_EVENT_DEFS.forEach(({ key }) => {
    const rule = src[key];
    init[key] = {
      roles:   rule?.roles   ? [...rule.roles] : ['admin', 'manager'],
      userIds: rule?.userIds ? rule.userIds.map(String) : [],
    };
  });
  return init;
}

function NotificationRoutingSection({ settings, onSave, users }) {
  const [routing, setRouting] = useState(() => buildRoutingFromSettings(settings));
  const [userSearch, setUserSearch] = useState('');
  const [saving, setSaving] = useState(false);
  // Same staleness bug/fix as FeatureAccessSection's `dirty` — settings
  // broadcast live to every open session from any save anywhere, so this
  // local copy must resync whenever there are no in-progress local edits,
  // or a save here can silently blast a stale full snapshot over a change
  // that happened elsewhere in the meantime.
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (dirty) return;
    setRouting(buildRoutingFromSettings(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, dirty]);

  const toggleRole = (eventKey, role) => {
    setDirty(true);
    setRouting((r) => {
      const cur = r[eventKey].roles;
      const next = cur.includes(role) ? cur.filter((x) => x !== role) : [...cur, role];
      return { ...r, [eventKey]: { ...r[eventKey], roles: next } };
    });
  };

  const toggleUser = (eventKey, userId) => {
    setDirty(true);
    setRouting((r) => {
      const cur = r[eventKey].userIds;
      const next = cur.includes(userId) ? cur.filter((x) => x !== userId) : [...cur, userId];
      return { ...r, [eventKey]: { ...r[eventKey], userIds: next } };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ notificationRouting: routing });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q));
  }, [users, userSearch]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-200 dark:border-slate-700/60">
        <div>
          <h3 className="text-[16px] font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Bell size={18} className="text-indigo-500" /> Notification Routing
          </h3>
          <p className="text-[12.5px] text-slate-500 dark:text-slate-400 mt-1">
            Who gets notified for each event — by role, by specific person, or both. Either match is enough to notify someone.
          </p>
        </div>
        <div className="relative w-[220px] flex-shrink-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            placeholder="Filter people…"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            className="form-input pl-8 text-[13px] py-1.5 w-full"
          />
        </div>
      </div>

      {NOTIFICATION_EVENT_DEFS.map(({ key, label, description }) => {
        const rule = routing[key];
        return (
          <div key={key} className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 space-y-4">
            <div>
              <h4 className="text-[14px] font-bold text-slate-800 dark:text-slate-200">{label}</h4>
              <p className="text-[12.5px] text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">By role</label>
              <div className="flex flex-wrap gap-2">
                {NOTIFICATION_ROUTABLE_ROLES.map((role) => {
                  const active = rule.roles.includes(role);
                  const cfg = ROLE_CONFIG[role];
                  return (
                    <button
                      key={role} type="button"
                      onClick={() => toggleRole(key, role)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border transition-colors',
                        active
                          ? 'text-white border-transparent'
                          : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                      )}
                      style={active ? { background: cfg.color } : undefined}
                    >
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                By specific person {rule.userIds.length > 0 && `(${rule.userIds.length} selected)`}
              </label>
              <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900/40">
                {filteredUsers.map((u) => {
                  const uid = getId(u);
                  const checked = rule.userIds.includes(uid);
                  return (
                    <label key={uid} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60">
                      <input type="checkbox" checked={checked} onChange={() => toggleUser(key, uid)} className="rounded border-slate-300 dark:border-slate-600" />
                      <div className="w-6 h-6 rounded-full text-white font-bold flex items-center justify-center text-[10px] flex-shrink-0" style={{ background: u.color || '#6366f1' }}>
                        {u.name?.[0]}
                      </div>
                      <span className="text-[13px] text-slate-700 dark:text-slate-300">{u.name}</span>
                      <span className="text-[11px] text-slate-400 ml-auto">{ROLE_CONFIG[u.role]?.label || u.role}</span>
                    </label>
                  );
                })}
                {filteredUsers.length === 0 && (
                  <p className="text-[12.5px] text-slate-400 text-center py-4">No users match "{userSearch}"</p>
                )}
              </div>
            </div>

            {rule.roles.length === 0 && rule.userIds.length === 0 && (
              <p className="text-[12px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <AlertTriangle size={13} /> Nobody will be notified for this event.
              </p>
            )}
          </div>
        );
      })}

      <Button variant="primary" onClick={handleSave} disabled={saving}>
        <Save size={14} /> {saving ? 'Saving…' : 'Save Notification Routing'}
      </Button>
    </div>
  );
}

// 5c. Feature Access Control (Admin only) — which roles/specific users can
// use each sidebar feature. Same additive OR semantics and {roles, userIds}
// shape as notificationRouting, but enforced for REAL on the backend (see
// backend/src/middleware/authorizeFeature.js + routes/index.js) — this
// isn't just hiding a nav link. Master-detail: click a feature on the left,
// configure it on the right — 17 features is too many for one long page.
const FEATURE_DEFS = [
  { key: 'dashboard',            label: 'Dashboard',            icon: LayoutDashboard, defaultRoles: ['admin', 'manager', 'member', 'client_relations', 'read_only'] },
  { key: 'todos',                label: 'Todos',                icon: ListTodo,        defaultRoles: ['admin', 'manager', 'member', 'client_relations', 'read_only'] },
  { key: 'tasks',                label: 'Tasks',                icon: CheckSquare,     defaultRoles: ['admin', 'manager', 'member', 'client_relations', 'read_only'] },
  { key: 'clients',              label: 'Clients & Projects',   icon: Users,           defaultRoles: ['admin', 'manager', 'member', 'client_relations', 'read_only'] },
  { key: 'leads',                label: 'Leads Pipeline',       icon: Target,          defaultRoles: ['admin', 'manager', 'client_relations', 'read_only'] },
  { key: 'campaigns',            label: 'Campaigns',            icon: Mail,            defaultRoles: ['admin', 'manager', 'read_only'] },
  { key: 'ads_monitoring',       label: 'Ads Monitoring',       icon: Megaphone,       defaultRoles: ['admin', 'manager', 'read_only'] },
  { key: 'website_intelligence', label: 'Website Intelligence', icon: Globe,           defaultRoles: ['admin', 'manager', 'read_only'] },
  { key: 'messages',             label: 'Messages',             icon: MessageSquare,   defaultRoles: ['admin', 'manager', 'member', 'client_relations', 'read_only'] },
  { key: 'meetings',             label: 'Meetings',             icon: Video,           defaultRoles: ['admin', 'manager', 'member', 'client_relations', 'read_only'] },
  { key: 'reports',              label: 'Reports',              icon: BarChart3,       defaultRoles: ['admin', 'manager', 'member', 'client_relations', 'read_only'] },
  { key: 'calendar',             label: 'Calendar',             icon: Calendar,        defaultRoles: ['admin', 'manager', 'member', 'client_relations', 'read_only'] },
  { key: 'billing',              label: 'Billing',              icon: Receipt,         defaultRoles: ['admin', 'manager', 'read_only'] },
  { key: 'team',                 label: 'Team',                 icon: UserCircle,      defaultRoles: ['admin', 'manager', 'read_only'] },
  { key: 'audit_logs',           label: 'Audit Logs',           icon: Shield,          defaultRoles: ['admin', 'read_only'] },
  { key: 'system_monitor',       label: 'System Monitor',       icon: Terminal,        defaultRoles: ['admin', 'read_only'] },
  { key: 'api_keys',             label: 'API Keys',             icon: KeyRound,        defaultRoles: ['admin', 'read_only'] },
  { key: 'prospect_audit',       label: 'Prospect Audits',      icon: Search,          defaultRoles: ['admin', 'manager', 'read_only'] },
  { key: 'social_media',         label: 'Social Media',         icon: Share2,          defaultRoles: ['admin', 'manager', 'read_only'] },
  { key: 'payroll_pay_runs',     label: 'Payroll — Pay Runs',   icon: Wallet,          defaultRoles: ['admin', 'manager'] },
  { key: 'payroll_leaves',       label: 'Payroll — Leaves',     icon: CalendarOff,     defaultRoles: ['admin', 'manager', 'member', 'client_relations', 'read_only'] },
];
const FEATURE_ROUTABLE_ROLES = ['admin', 'manager', 'member', 'client_relations', 'read_only'];

// Shared by the initial state and the resync effect below — see the `dirty`
// comment in FeatureAccessSection for why a resync effect exists at all.
function buildRulesFromSettings(settings) {
  const src = settings?.featureAccess || {};
  const init = {};
  FEATURE_DEFS.forEach(({ key, defaultRoles }) => {
    const rule = src[key];
    init[key] = {
      roles:   rule?.roles   ? [...rule.roles] : [...defaultRoles],
      userIds: rule?.userIds ? rule.userIds.map(String) : [],
    };
  });
  return init;
}

function FeatureAccessSection({ settings, onSave, users }) {
  const [rules, setRules] = useState(() => buildRulesFromSettings(settings));
  const [selectedKey, setSelectedKey] = useState(FEATURE_DEFS[0].key);
  const [userSearch, setUserSearch] = useState('');
  const [saving, setSaving] = useState(false);
  // Tracks whether the admin has touched anything since the map was last
  // loaded/saved. SystemSettings updates broadcast live to every open
  // session (any admin, any section — see useAppStore.js's `settings:updated`
  // handler), so `settings` can change under this component at any time.
  // Without this, a lazy-init-only local copy would silently go stale, and
  // saving would blast that stale full snapshot back over whatever changed
  // in the meantime — exactly what happened when a live backfill script's
  // changes to 15 of 17 features got wiped by a save from a browser tab that
  // had been open since before the backfill ran.
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (dirty) return; // don't clobber in-progress edits with a concurrent update
    setRules(buildRulesFromSettings(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, dirty]);

  const toggleRole = (featureKey, role) => {
    setDirty(true);
    setRules((r) => {
      const cur = r[featureKey].roles;
      const next = cur.includes(role) ? cur.filter((x) => x !== role) : [...cur, role];
      return { ...r, [featureKey]: { ...r[featureKey], roles: next } };
    });
  };

  const toggleUser = (featureKey, userId) => {
    setDirty(true);
    setRules((r) => {
      const cur = r[featureKey].userIds;
      const next = cur.includes(userId) ? cur.filter((x) => x !== userId) : [...cur, userId];
      return { ...r, [featureKey]: { ...r[featureKey], userIds: next } };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ featureAccess: rules });
      setDirty(false); // now in sync with what we just sent — safe to resync from live updates again
    } finally {
      setSaving(false);
    }
  };

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q));
  }, [users, userSearch]);

  const selected = FEATURE_DEFS.find((f) => f.key === selectedKey);
  const selectedRule = rules[selectedKey];

  return (
    <div className="space-y-5">
      <div className="pb-3 border-b border-slate-200 dark:border-slate-700/60">
        <h3 className="text-[16px] font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Lock size={18} className="text-indigo-500" /> Feature Access Control
        </h3>
        <p className="text-[12.5px] text-slate-500 dark:text-slate-400 mt-1">
          Real, backend-enforced access — not just a hidden nav link. Who can use each feature, by role, by specific person, or both.
        </p>
      </div>

      <div className="flex gap-5 items-start">
        {/* Master: feature list */}
        <div className="w-60 flex-shrink-0 space-y-1">
          {FEATURE_DEFS.map((f) => {
            const rule = rules[f.key];
            const count = rule.roles.length + rule.userIds.length;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setSelectedKey(f.key)}
                className={cn(
                  'flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-[13px] font-semibold text-left transition-colors',
                  selectedKey === f.key
                    ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                )}
              >
                <f.icon size={15} className="flex-shrink-0" />
                <span className="truncate">{f.label}</span>
                <span className={cn(
                  'ml-auto text-[10.5px] font-bold rounded-full px-1.5 py-0.5 flex-shrink-0',
                  count === 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Detail: role pills + searchable user checklist for the selected feature */}
        {selected && selectedRule && (
          <div className="flex-1 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 space-y-4 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-[14px] font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <selected.icon size={16} /> {selected.label}
              </h4>
              <div className="relative w-[200px] flex-shrink-0">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  placeholder="Filter people…"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="form-input pl-7 text-[12.5px] py-1.5 w-full"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">By role</label>
              <div className="flex flex-wrap gap-2">
                {FEATURE_ROUTABLE_ROLES.map((role) => {
                  const active = selectedRule.roles.includes(role);
                  const cfg = ROLE_CONFIG[role];
                  return (
                    <button
                      key={role} type="button"
                      onClick={() => toggleRole(selectedKey, role)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border transition-colors',
                        active
                          ? 'text-white border-transparent'
                          : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                      )}
                      style={active ? { background: cfg.color } : undefined}
                    >
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                By specific person {selectedRule.userIds.length > 0 && `(${selectedRule.userIds.length} selected)`}
              </label>
              <div className="max-h-56 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900/40">
                {filteredUsers.map((u) => {
                  const uid = getId(u);
                  const checked = selectedRule.userIds.includes(uid);
                  return (
                    <label key={uid} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60">
                      <input type="checkbox" checked={checked} onChange={() => toggleUser(selectedKey, uid)} className="rounded border-slate-300 dark:border-slate-600" />
                      <div className="w-6 h-6 rounded-full text-white font-bold flex items-center justify-center text-[10px] flex-shrink-0" style={{ background: u.color || '#6366f1' }}>
                        {u.name?.[0]}
                      </div>
                      <span className="text-[13px] text-slate-700 dark:text-slate-300">{u.name}</span>
                      <span className="text-[11px] text-slate-400 ml-auto">{ROLE_CONFIG[u.role]?.label || u.role}</span>
                    </label>
                  );
                })}
                {filteredUsers.length === 0 && (
                  <p className="text-[12.5px] text-slate-400 text-center py-4">No users match "{userSearch}"</p>
                )}
              </div>
            </div>

            {selectedRule.roles.length === 0 && selectedRule.userIds.length === 0 && (
              <p className="text-[12px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <AlertTriangle size={13} /> Nobody will have access to this feature.
              </p>
            )}
          </div>
        )}
      </div>

      <Button variant="primary" onClick={handleSave} disabled={saving}>
        <Save size={14} /> {saving ? 'Saving…' : 'Save Feature Access'}
      </Button>
    </div>
  );
}

// 6. User invite & Dynamic Teams (Admins & Managers)
function TeamsManagementSection({ settings, onSave, users, onInvite }) {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [teams, setTeams] = useState(settings?.teams || []);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDesc, setNewTeamDesc] = useState('');

  // Staffing metadata config

  const [depList, setDepList] = useState(settings?.departments || []);
  const [newDep, setNewDep] = useState('');

  const [indList, setIndList] = useState(settings?.industries || []);
  const [newInd, setNewInd] = useState('');

  // Sync state if settings changes
  useEffect(() => {
    if (settings) {
      setTeams(settings.teams || []);
      setDepList(settings.departments || []);
      setIndList(settings.industries || []);
    }
  }, [settings]);

  // Form hooks for Invite modal
  const { register, handleSubmit, reset } = useForm();

  const handleCreateTeam = () => {
    if (!newTeamName.trim()) return;
    setTeams([...teams, { name: newTeamName.trim(), description: newTeamDesc.trim() }]);
    setNewTeamName('');
    setNewTeamDesc('');
  };



  const handleAddDep = () => {
    if (!newDep.trim()) return;
    const dep = newDep.trim();
    if (depList.includes(dep)) {
      toast.error('Department already exists');
      return;
    }
    setDepList([...depList, dep]);
    setNewDep('');
  };

  const handleRemoveDep = (dep) => {
    if (dep === 'Management' || dep === 'General') {
      toast.error('Core departments cannot be deleted');
      return;
    }
    setDepList(depList.filter((d) => d !== dep));
  };

  const handleAddInd = () => {
    if (!newInd.trim()) return;
    const ind = newInd.trim();
    if (indList.includes(ind)) {
      toast.error('Industry already exists');
      return;
    }
    setIndList([...indList, ind]);
    setNewInd('');
  };

  const handleRemoveInd = (ind) => {
    setIndList(indList.filter((x) => x !== ind));
  };

  const handleSaveAllFramework = () => {
    onSave({ 
      teams, 
      departments: depList, 
      industries: indList 
    });
  };

  const handleInviteSubmit = async (data) => {
    try {
      await onInvite(data);
      setShowInviteModal(false);
      reset();
    } catch {}
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-700/60">
        <h3 className="text-[16px] font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Users size={18} className="text-indigo-500" /> Users & Dynamic Teams Management
        </h3>
        <Button variant="primary" onClick={() => setShowInviteModal(true)}>
          <Plus size={14} /> Invite New Member
        </Button>
      </div>

      {/* Users list with details */}
      <div className="space-y-3">
        <h4 className="text-[14px] font-bold text-slate-800 dark:text-slate-200">Active Agency Staff & Members</h4>
        <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-850">
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-455 py-3 px-4">Member</th>
                <th className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-455 py-3 px-4">Email</th>
                <th className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-455 py-3 px-4">Role</th>
                <th className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-455 py-3 px-4">Department</th>
                <th className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-455 py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                return (
                  <tr key={u._id} className="border-b border-slate-200 dark:border-slate-800/60 last:border-b-0 hover:bg-slate-50/40 dark:hover:bg-slate-900/10">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full text-white font-bold flex items-center justify-center text-[12px] overflow-hidden" style={{ background: u.avatar ? 'transparent' : (u.color || '#6366f1') }}>
                          <AvatarContent user={u} fallback={u.initials || u.name?.[0]} />
                        </div>
                        <div>
                          <p className="text-[13px] font-bold text-slate-800 dark:text-slate-200">{u.name}</p>
                          <p className="text-[11.5px] text-slate-450">{u.position || 'Representative'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-[13px] text-slate-600 dark:text-slate-400">{u.email}</td>
                    <td className="py-3 px-4">
                      <span className={cn('badge text-[11px]', ROLE_CONFIG[u.role]?.tw || 'badge-neutral')}>
                        {ROLE_CONFIG[u.role]?.label || u.role}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-[13px] text-slate-600 dark:text-slate-400">{u.department || 'General'}</td>
                    <td className="py-3 px-4">
                      <span className={cn('inline-flex items-center gap-1 text-[11.5px] font-bold', u.status === 'online' ? 'text-emerald-500' : u.status === 'away' ? 'text-amber-500' : 'text-slate-400')}>
                        <span className={cn('w-1.5 h-1.5 rounded-full', u.status === 'online' ? 'bg-emerald-500' : u.status === 'away' ? 'bg-amber-500' : 'bg-slate-400')} />
                        {u.status || 'offline'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>


      {/* Teams list */}
      <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-850">
        <h4 className="text-[14px] font-bold text-slate-800 dark:text-slate-200">Custom Dynamic Teams</h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {teams.map((t, i) => (
            <div key={i} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 flex items-start justify-between">
              <div>
                <p className="text-[14px] font-bold text-slate-800 dark:text-slate-200">{t.name}</p>
                <p className="text-[12.5px] text-slate-500 dark:text-slate-400 mt-1">{t.description || 'No description provided.'}</p>
              </div>
              <button 
                onClick={() => setTeams(teams.filter((_, idx) => idx !== i))} 
                className="text-slate-400 hover:text-red-500 p-1"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>

        {/* Create team inputs */}
        <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-750 flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[12.5px] font-semibold text-slate-650 dark:text-slate-450 mb-1">Team Name</label>
            <input placeholder="e.g. Sales Team East" className="form-input text-[13px] py-1.5" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} />
          </div>
          <div className="flex-[2] min-w-[300px]">
            <label className="block text-[12.5px] font-semibold text-slate-655 dark:text-slate-455 mb-1">Description / Focus</label>
            <input placeholder="e.g. East coast outreach, enterprise deals" className="form-input text-[13px] py-1.5" value={newTeamDesc} onChange={(e) => setNewTeamDesc(e.target.value)} />
          </div>
          <Button variant="outline" className="h-10" onClick={handleCreateTeam}><Plus size={14} /> Create Team</Button>
        </div>
      </div>

      <Button variant="primary" onClick={handleSaveAllFramework}>
        <Save size={14} /> Save Staff & Organization Framework
      </Button>

      {/* Invite Member modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-[16px] font-bold text-slate-900 dark:text-white">Invite CRM Member</h3>
              <button onClick={() => setShowInviteModal(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleSubmit(handleInviteSubmit)}>
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-350 mb-1">Full Name</label>
                  <input className="form-input text-[13px] py-2" required {...register('name')} placeholder="e.g. Alice Cooper" />
                </div>
                <div>
                  <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-350 mb-1">Email Address</label>
                  <input type="email" className="form-input text-[13px] py-2" required {...register('email')} placeholder="e.g. alice@bizzbuzz.com" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-350 mb-1">Role</label>
                    <select className="form-input text-[13px] py-2" {...register('role')}>
                      <option value="member">Member</option>
                      <option value="manager">Manager</option>
                      <option value="admin">Admin</option>
                      <option value="client_relations">Client Relations</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-350 mb-1">Department</label>
                    <select className="form-input text-[13px] py-2" {...register('department')}>
                      {depList.map((dep) => (
                        <option key={dep} value={dep}>{dep}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-350 mb-1">Position / Title</label>
                  <input className="form-input text-[13px] py-2" {...register('position')} placeholder="e.g. Sales Specialist" />
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
                <Button variant="ghost" type="button" onClick={() => setShowInviteModal(false)}>Cancel</Button>
                <Button variant="primary" type="submit">Invite Member</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// 7. Lead & Task Assignment Rules (Admins & Managers)
function AssignmentRulesSection({ settings, onSave }) {
  const { register, handleSubmit } = useForm({
    defaultValues: {
      leadDistribution:    settings?.assignmentRules?.leadDistribution || 'round-robin',
      activeSalesRepsOnly: !!settings?.assignmentRules?.activeSalesRepsOnly
    }
  });

  return (
    <form onSubmit={handleSubmit((data) => onSave({ assignmentRules: data }))} className="space-y-6">
      <h3 className="text-[16px] font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-200 dark:border-slate-700/60 flex items-center gap-2">
        <Sliders size={18} className="text-indigo-500" /> Automatic Lead & Task Assignment Rules
      </h3>

      <div className="space-y-4">
        <div>
          <label className="block text-[13.5px] font-semibold text-slate-700 dark:text-slate-350 mb-1.5">Lead Distribution Algorithm</label>
          <select className="form-input text-[13.5px] py-2 max-w-md" {...register('leadDistribution')}>
            <option value="none">Manual Assign Only (No Auto-distribution)</option>
            <option value="round-robin">Round-Robin (Fair and sequential distribution)</option>
            <option value="least-loaded">Least-Loaded (Assigns to rep with fewest open tasks)</option>
          </select>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800/80 flex items-center justify-between max-w-2xl">
          <div>
            <h4 className="text-[13.5px] font-bold text-slate-800 dark:text-slate-200">Active Reps Only</h4>
            <p className="text-[12.5px] text-slate-500 dark:text-slate-400 mt-0.5">Only assign incoming clients and leads to representatives who are currently online or active.</p>
          </div>
          <input type="checkbox" className="w-5 h-5 accent-indigo-500 flex-shrink-0 ml-4" {...register('activeSalesRepsOnly')} />
        </div>
      </div>

      <Button variant="primary" type="submit">
        <Save size={14} /> Update Assignment Rules
      </Button>
    </form>
  );
}

// 8. Shared Email Templates (real Campaign template library, see
// EmailTemplatesManager) & Snippets (Admins & Managers)
function TemplatesSection({ settings, onSave }) {
  const [snippets, setSnippets] = useState(settings?.snippetLibrary || []);
  const [sTrigger, setSTrigger] = useState('');
  const [sText, setSText] = useState('');

  const handleAddSnippet = () => {
    const trigger = sTrigger.trim();
    if (!trigger || !sText.trim()) {
      toast.error('Snippet trigger and replacement are required');
      return;
    }
    if (snippets.some((s) => s.trigger === trigger)) {
      toast.error(`A snippet with trigger "${trigger}" already exists`);
      return;
    }
    // The Compose editor's live picker only activates on ";" — auto-prefix
    // it if forgotten so this snippet actually shows up when browsing,
    // rather than silently only working via the type-then-space shortcut.
    const normalizedTrigger = trigger.startsWith(';') ? trigger : `;${trigger}`;
    setSnippets([...snippets, { trigger: normalizedTrigger, text: sText.trim() }]);
    setSTrigger('');
    setSText('');
  };

  const handleSave = () => {
    onSave({ snippetLibrary: snippets });
  };

  return (
    <div className="space-y-6">
      <h3 className="text-[16px] font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-200 dark:border-slate-700/60 flex items-center gap-2">
        <FileText size={18} className="text-indigo-500" /> Shared Communication Templates & Snippets
      </h3>

      <div className="space-y-4">
        <div>
          <h4 className="text-[14px] font-bold text-slate-800 dark:text-slate-250">Shared Email Templates</h4>
          <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">
            The same library used by the "Templates" button in every campaign's Compose tab — create or edit one here and it's immediately available there, and vice versa.
          </p>
        </div>
        <EmailTemplatesManager />
      </div>

      <div className="space-y-4 pt-6 border-t border-slate-200 dark:border-slate-850">
        <h4 className="text-[14px] font-bold text-slate-800 dark:text-slate-250">Shared Snippets Library</h4>

        <div className="flex flex-wrap gap-2">
          {snippets.map((sn, idx) => (
            <span key={idx} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[12.5px] text-slate-700 dark:text-slate-350">
              <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{sn.trigger}</span>
              <span className="text-slate-300">|</span>
              <span className="truncate max-w-[150px]">{sn.text}</span>
              <button onClick={() => setSnippets(snippets.filter((_, i) => i !== idx))} className="hover:text-red-500"><X size={12} /></button>
            </span>
          ))}
        </div>

        {/* Add snippet form */}
        <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-250 dark:border-slate-750 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-[12px] font-semibold text-slate-500 mb-1">Trigger Keyword</label>
            <input placeholder="e.g. ;greet" className="form-input text-[13px] py-1.5 w-32 font-mono" value={sTrigger} onChange={(e) => setSTrigger(e.target.value)} />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[12px] font-semibold text-slate-500 mb-1">Replacement Text</label>
            <input placeholder="e.g. Thanks for choosing BizzBuzz!" className="form-input text-[13px] py-1.5" value={sText} onChange={(e) => setSText(e.target.value)} />
          </div>
          <Button variant="outline" onClick={handleAddSnippet} className="h-9"><Plus size={13} /> Add Snippet</Button>
        </div>
      </div>

      {/* Templates save immediately per-item via EmailTemplatesManager above —
          this button only persists the snippet list, which still uses the
          generic settings blob (batch save, unrelated to campaigns). */}
      <Button variant="primary" onClick={handleSave}>
        <Save size={14} /> Save Snippets Library
      </Button>
    </div>
  );
}

// 9. Data Import/Export Control (Admins & Managers)
function DataControlSection({ settings, onSave, onExportTasks, onExportTodos, onExportClients, onFullBackup }) {
  const { register, handleSubmit } = useForm({
    defaultValues: {
      allowBulkImport:    !!settings?.dataControl?.allowBulkImport,
      allowExportClients: !!settings?.dataControl?.allowExportClients,
      allowExportTasks:   !!settings?.dataControl?.allowExportTasks
    }
  });

  return (
    <div className="space-y-6">
      <h3 className="text-[16px] font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-200 dark:border-slate-700/60 flex items-center gap-2">
        <Database size={18} className="text-indigo-500" /> Data Governance & Export Controls
      </h3>

      <form onSubmit={handleSubmit((data) => onSave({ dataControl: data }))} className="space-y-4">
        <h4 className="text-[14px] font-bold text-slate-800 dark:text-slate-250">Data Security Controls</h4>
        
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 space-y-3.5 max-w-2xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13.5px] font-bold text-slate-850 dark:text-slate-200">Bulk Import via CSV</p>
              <p className="text-[12.5px] text-slate-500">Permit administrators and operational managers to bulk-import CSV data models.</p>
            </div>
            <input type="checkbox" className="w-5 h-5 accent-indigo-500" {...register('allowBulkImport')} />
          </div>
          
          <div className="border-t border-slate-200 dark:border-slate-800/80 pt-3 flex items-center justify-between">
            <div>
              <p className="text-[13.5px] font-bold text-slate-850 dark:text-slate-200">Export Client Portfolio Records</p>
              <p className="text-[12.5px] text-slate-500">Restricts client databases downloading to prevent unauthorized leakage.</p>
            </div>
            <input type="checkbox" className="w-5 h-5 accent-indigo-500" {...register('allowExportClients')} />
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800/80 pt-3 flex items-center justify-between">
            <div>
              <p className="text-[13.5px] font-bold text-slate-850 dark:text-slate-200">Export Tasks & Worklog Records</p>
              <p className="text-[12.5px] text-slate-500">Allow team member task and performance logs exporting in CSV format.</p>
            </div>
            <input type="checkbox" className="w-5 h-5 accent-indigo-500" {...register('allowExportTasks')} />
          </div>
        </div>
        <Button variant="primary" type="submit">Update Data Controls</Button>
      </form>

      {/* Actual Export rows */}
      <div className="space-y-3 pt-6 border-t border-slate-200 dark:border-slate-850">
        <h4 className="text-[14px] font-bold text-slate-800 dark:text-slate-250">Download Database Backups</h4>
        
        <div className="flex flex-col gap-2 max-w-xl">
          <div className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-slate-850">
            <div>
              <p className="text-[13.5px] font-semibold text-slate-850 dark:text-slate-200">Export Tasks List</p>
              <p className="text-[12px] text-slate-450">Download active CRM tasks table in CSV</p>
            </div>
            <Button variant="outline" size="sm" onClick={onExportTasks} disabled={!settings?.dataControl?.allowExportTasks}><Download size={13} /> Export CSV</Button>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-slate-850">
            <div>
              <p className="text-[13.5px] font-semibold text-slate-850 dark:text-slate-200">Export Daily Todos</p>
              <p className="text-[12px] text-slate-450">Download internal daily schedules in CSV</p>
            </div>
            <Button variant="outline" size="sm" onClick={onExportTodos}><Download size={13} /> Export CSV</Button>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-slate-850">
            <div>
              <p className="text-[13.5px] font-semibold text-slate-850 dark:text-slate-200">Export Clients Portfolio</p>
              <p className="text-[12px] text-slate-450">Download full client directory details in CSV</p>
            </div>
            <Button variant="outline" size="sm" onClick={onExportClients} disabled={!settings?.dataControl?.allowExportClients}><Download size={13} /> Export CSV</Button>
          </div>

          <div className="flex items-center justify-between py-3 last:border-0">
            <div>
              <p className="text-[13.5px] font-semibold text-slate-850 dark:text-slate-200">Full Workspace Database Backup</p>
              <p className="text-[12px] text-slate-450">Download entire workspace configuration in JSON</p>
            </div>
            <Button variant="outline" size="sm" onClick={onFullBackup}><Download size={13} /> Backup JSON</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 10. Integrations management (Admins & Managers)
function IntegrationsSection({ settings, onSave }) {
  const { register, handleSubmit } = useForm({
    defaultValues: {
      slackEnabled:                !!settings?.integrations?.slackEnabled,
      slackWebhookUrl:             settings?.integrations?.slackWebhookUrl || '',
      voipEnabled:                 !!settings?.integrations?.voipEnabled,
      marketingAutomationEnabled:  !!settings?.integrations?.marketingAutomationEnabled
    }
  });

  return (
    <form onSubmit={handleSubmit((data) => onSave({ integrations: data }))} className="space-y-6">
      <h3 className="text-[16px] font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-200 dark:border-slate-700/60 flex items-center gap-2">
        <Zap size={18} className="text-indigo-500" /> Third-Party Workspace Integrations
      </h3>

      <div className="space-y-5 max-w-2xl">
        {/* Slack */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
              <h4 className="text-[14px] font-bold text-slate-850 dark:text-slate-200">Slack Notifications Feed</h4>
            </div>
            <input type="checkbox" className="w-5 h-5 accent-indigo-500" {...register('slackEnabled')} />
          </div>
          <p className="text-[12.5px] text-slate-550 dark:text-slate-400">Dispatch live updates to your Slack workgroups whenever client projects, deals, or tasks change.</p>
          <input 
            placeholder="e.g. https://hooks.slack.com/services/..." 
            className="form-input text-[13px] py-1.5" 
            {...register('slackWebhookUrl')} 
          />
        </div>

        {/* VoIP */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 flex items-center justify-between">
          <div>
            <h4 className="text-[14px] font-bold text-slate-850 dark:text-slate-200">Integrated VoIP Calling System</h4>
            <p className="text-[12.5px] text-slate-550 dark:text-slate-400 mt-1">Connect corporate Twilio / VoIP services to trigger clicks-to-call direct from client directory grids.</p>
          </div>
          <input type="checkbox" className="w-5 h-5 accent-indigo-500 ml-4 flex-shrink-0" {...register('voipEnabled')} />
        </div>

        {/* Marketing Automation */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 flex items-center justify-between">
          <div>
            <h4 className="text-[14px] font-bold text-slate-850 dark:text-slate-200">Marketing & Email Automation Platform</h4>
            <p className="text-[12.5px] text-slate-550 dark:text-slate-400 mt-1">Sync contacts data blocks with Mailchimp/Hubspot campaign setups dynamically.</p>
          </div>
          <input type="checkbox" className="w-5 h-5 accent-indigo-500 ml-4 flex-shrink-0" {...register('marketingAutomationEnabled')} />
        </div>
      </div>

      <Button variant="primary" type="submit">
        <Save size={14} /> Save Enabled Integrations
      </Button>
    </form>
  );
}

// 10b. Meta Ads connection — credentials entered here, encrypted at rest in
// the database (same pattern as EmailAccount's SMTP/IMAP passwords), never
// echoed back to the browser. No backend/.env edit or server restart needed.
function MetaAdsSection() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const { register, handleSubmit, reset } = useForm({
    defaultValues: { accessToken: '', adAccountId: '', appId: '', appSecret: '' },
  });

  const loadStatus = async () => {
    try {
      const { data } = await metaAdsAPI.status();
      setStatus(data.data);
      reset({
        accessToken: '',
        adAccountId: data.data?.account?.adAccountId || '',
        appId: data.data?.account?.appId || '',
        appSecret: '',
      });
    } catch {
      toast.error('Failed to load Meta Ads status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStatus(); }, []);

  const onSave = async (formData) => {
    setSaving(true);
    try {
      const { data } = await metaAdsAPI.saveCredentials(formData);
      if (data.verified) {
        toast.success(`Connected: ${data.data.accountName} (${data.data.currency})`);
      } else {
        toast.error(data.message || 'Saved, but could not verify the connection');
      }
      await loadStatus();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to save credentials');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const { data } = await metaAdsAPI.testConnection();
      toast.success(`Connected: ${data.data.accountName} (${data.data.currency})`);
      await loadStatus();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Connection test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await metaAdsAPI.syncNow();
      toast.success('Meta Ads data synced');
      await loadStatus();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Meta Ads? Cached campaign history stays in place — you can reconnect any time.')) return;
    setDisconnecting(true);
    try {
      await metaAdsAPI.clearCredentials();
      toast.success('Meta Ads disconnected');
      await loadStatus();
    } catch {
      toast.error('Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="space-y-6">
      <h3 className="text-[16px] font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-200 dark:border-slate-700/60 flex items-center gap-2">
        <Megaphone size={18} className="text-indigo-500" /> Meta Ads Integration
      </h3>

      {loading ? (
        <p className="text-[13px] text-slate-400">Loading status…</p>
      ) : (
        <div className="max-w-2xl space-y-5">
          {status?.account?.accountName && (
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={cn('w-2.5 h-2.5 rounded-full', status?.configured ? 'bg-emerald-500' : 'bg-slate-350')} />
                  <h4 className="text-[14px] font-bold text-slate-850 dark:text-slate-200">Connected</h4>
                </div>
                <button type="button" onClick={handleDisconnect} disabled={disconnecting} className="text-[12px] font-semibold text-red-500 hover:text-red-700">
                  Disconnect
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-[12.5px]">
                <div><span className="text-slate-400 block">Ad Account</span><span className="font-semibold text-slate-700 dark:text-slate-300">{status.account.accountName || '—'}</span></div>
                <div><span className="text-slate-400 block">Currency</span><span className="font-semibold text-slate-700 dark:text-slate-300">{status.account.currency || '—'}</span></div>
                <div><span className="text-slate-400 block">Last Synced</span><span className="font-semibold text-slate-700 dark:text-slate-300">{status.account.lastSyncedAt ? new Date(status.account.lastSyncedAt).toLocaleString() : 'Never'}</span></div>
                <div>
                  <span className="text-slate-400 block">Sync Health</span>
                  <span className={cn('font-semibold', status.account.lastSyncError ? 'text-red-500' : 'text-emerald-600')}>
                    {status.account.lastSyncError ? 'Error' : status.account.lastSyncOkAt ? 'Healthy' : 'Pending first sync'}
                  </span>
                </div>
              </div>
              {status?.account?.lastSyncError && (
                <p className="text-[11.5px] text-red-500 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-2">
                  {status.account.lastSyncError}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={handleTest} loading={testing}>Test Connection</Button>
                <Button size="sm" variant="primary" onClick={handleSync} loading={syncing}>Sync Now</Button>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit(onSave)} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 space-y-4">
            <p className="text-[12.5px] text-slate-550 dark:text-slate-400">
              A long-lived System User access token with <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-[11.5px]">ads_read</code> permission on the target ad account. Never shown again once saved.
            </p>
            <div>
              <label className="block text-[11px] font-bold text-slate-450 uppercase tracking-widest mb-1.5">Access Token *</label>
              <input type="password" autoComplete="new-password" className="form-input text-[13px]"
                placeholder={status?.account?.accountName ? '•••••••• (already set — leave blank to keep)' : 'EAAG...'}
                {...register('accessToken')} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-450 uppercase tracking-widest mb-1.5">Ad Account ID *</label>
              <input className="form-input text-[13px]" placeholder="act_1234567890 (or just the digits)" {...register('adAccountId', { required: true })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-450 uppercase tracking-widest mb-1.5">App ID <span className="normal-case font-normal text-slate-400">(optional)</span></label>
                <input className="form-input text-[13px]" {...register('appId')} />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-450 uppercase tracking-widest mb-1.5">App Secret <span className="normal-case font-normal text-slate-400">(optional)</span></label>
                <input type="password" autoComplete="new-password" className="form-input text-[13px]"
                  placeholder={status?.account?.appId ? '•••••••• (already set)' : ''} {...register('appSecret')} />
              </div>
            </div>
            <Button variant="primary" type="submit" loading={saving}>
              <Save size={14} /> Save & Verify
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}

// 9b. IVA CRM Integration (Admin only) — configures the outbound call
// rndCRM makes whenever a campaign email is opened/call-requested/replied
// to (utils/mainCrmNotify.js), so the main CRM's own users get notified
// too. Same pattern as MetaAdsSection above: encrypted API key (never
// re-displayed, blank = keep existing), Save & Verify, separate Test
// Connection button.
function MainCrmIntegrationSection() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const { register, handleSubmit, reset } = useForm({
    defaultValues: { notifyUrl: '', apiKey: '' },
  });

  const loadStatus = async () => {
    try {
      const { data } = await mainCrmAPI.status();
      setStatus(data.data);
      reset({ notifyUrl: data.data?.notifyUrl || '', apiKey: '' });
    } catch {
      toast.error('Failed to load IVA CRM Integration status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStatus(); }, []);

  const onSave = async (formData) => {
    setSaving(true);
    try {
      await mainCrmAPI.saveCredentials(formData);
      toast.success('Saved — use Test Connection to verify');
      await loadStatus();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to save credentials');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const { data } = await mainCrmAPI.testConnection();
      toast.success(data.data?.message || 'Connected — the main CRM accepted the test request');
      await loadStatus();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Connection test failed');
      await loadStatus();
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect the IVA CRM Integration? Campaign email opens/call-requests/replies will stop being reported there until you reconnect.')) return;
    setDisconnecting(true);
    try {
      await mainCrmAPI.clearCredentials();
      toast.success('Disconnected');
      await loadStatus();
    } catch {
      toast.error('Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="space-y-6">
      <h3 className="text-[16px] font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-200 dark:border-slate-700/60 flex items-center gap-2">
        <ArrowUpRight size={18} className="text-indigo-500" /> IVA CRM Integration
      </h3>

      {loading ? (
        <p className="text-[13px] text-slate-400">Loading status…</p>
      ) : (
        <div className="max-w-2xl space-y-5">
          <p className="text-[12.5px] text-slate-550 dark:text-slate-400">
            When a lead opens a campaign email, requests a call, or replies, rndCRM also reports it to the
            main CRM (<code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-[11.5px]">crms.bizzbuzzcreations.com</code>) so its own users get notified — in addition to, not instead of, the notification here.
          </p>

          {status?.configured && (
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={cn('w-2.5 h-2.5 rounded-full', status.lastVerifyError ? 'bg-red-500' : status.lastVerifiedAt ? 'bg-emerald-500' : 'bg-slate-350')} />
                  <h4 className="text-[14px] font-bold text-slate-850 dark:text-slate-200">Configured</h4>
                </div>
                <button type="button" onClick={handleDisconnect} disabled={disconnecting} className="text-[12px] font-semibold text-red-500 hover:text-red-700">
                  Disconnect
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-[12.5px]">
                <div><span className="text-slate-400 block">Notify URL</span><span className="font-semibold text-slate-700 dark:text-slate-300 break-all">{status.notifyUrl || '—'}</span></div>
                <div>
                  <span className="text-slate-400 block">Connection Health</span>
                  <span className={cn('font-semibold', status.lastVerifyError ? 'text-red-500' : status.lastVerifiedAt ? 'text-emerald-600' : 'text-slate-500')}>
                    {status.lastVerifyError ? 'Error' : status.lastVerifiedAt ? `Healthy — last ${new Date(status.lastVerifiedAt).toLocaleString()}` : 'Not yet verified'}
                  </span>
                </div>
              </div>
              {status.lastVerifyError && (
                <p className="text-[11.5px] text-red-500 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-2">
                  {status.lastVerifyError}
                </p>
              )}
              <div className="pt-1">
                <Button size="sm" variant="outline" onClick={handleTest} loading={testing}>Test Connection</Button>
              </div>
              <p className="text-[11px] text-slate-400">
                Test Connection sends a real request to the main CRM with a placeholder email that won't match any real lead — it may still notify whoever's configured there under Settings v3 → Marketing → Additional Activity Notification Recipients.
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit(onSave)} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 space-y-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-450 uppercase tracking-widest mb-1.5">Notify URL</label>
              <input className="form-input text-[13px]" placeholder="https://crms.bizzbuzzcreations.com/api/external/leads/notify-activity/" {...register('notifyUrl')} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-450 uppercase tracking-widest mb-1.5">API Key *</label>
              <input type="password" autoComplete="new-password" className="form-input text-[13px]"
                placeholder={status?.configured ? '•••••••• (already set — leave blank to keep)' : 'Paste the API key from Settings v3 → API Keys'}
                {...register('apiKey')} />
            </div>
            <Button variant="primary" type="submit" loading={saving}>
              <Save size={14} /> Save
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}

// Prospect Audits crawler's Google API key(s) — same Save/Test Connection/
// Disconnect shape as MainCrmIntegrationSection above, adapted for two
// optional keys (a second key roughly halves crawl time on large batches,
// since PageSpeed Insights caps each key at 25k requests/day) instead of a
// notify URL.
function PageSpeedIntegrationSection() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const { register, handleSubmit, reset } = useForm({
    defaultValues: { apiKey: '', apiKey2: '' },
  });

  const loadStatus = async () => {
    try {
      const { data } = await pageSpeedIntegrationAPI.status();
      setStatus(data.data);
      reset({ apiKey: '', apiKey2: '' });
    } catch {
      toast.error('Failed to load PageSpeed Insights status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStatus(); }, []);

  const onSave = async (formData) => {
    setSaving(true);
    try {
      await pageSpeedIntegrationAPI.saveCredentials(formData);
      toast.success('Saved — use Test Connection to verify');
      await loadStatus();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to save credentials');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const { data } = await pageSpeedIntegrationAPI.testConnection();
      toast.success(data.data?.message || 'Connected — the API key is valid');
      await loadStatus();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Connection test failed');
      await loadStatus();
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect PageSpeed Insights? Prospect Audit crawls will stop working until you reconnect a key.')) return;
    setDisconnecting(true);
    try {
      await pageSpeedIntegrationAPI.clearCredentials();
      toast.success('Disconnected');
      await loadStatus();
    } catch {
      toast.error('Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="space-y-6">
      <h3 className="text-[16px] font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-200 dark:border-slate-700/60 flex items-center gap-2">
        <Search size={18} className="text-indigo-500" /> PageSpeed Insights Integration
      </h3>

      {loading ? (
        <p className="text-[13px] text-slate-400">Loading status…</p>
      ) : (
        <div className="max-w-2xl space-y-5">
          <p className="text-[12.5px] text-slate-550 dark:text-slate-400">
            Powers the Prospect Audits crawler's technical/SEO scoring (Settings → console.cloud.google.com
            → enable "PageSpeed Insights API" → Credentials → Create API Key). Free, 25,000 requests/day per key.
            Adding a second key roughly halves crawl time on large batches — optional, not required to start.
          </p>

          {status?.configured && (
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={cn('w-2.5 h-2.5 rounded-full', status.lastVerifyError ? 'bg-red-500' : status.lastVerifiedAt ? 'bg-emerald-500' : 'bg-slate-350')} />
                  <h4 className="text-[14px] font-bold text-slate-850 dark:text-slate-200">Configured{status.hasSecondKey ? ' — 2 keys' : ''}</h4>
                </div>
                <button type="button" onClick={handleDisconnect} disabled={disconnecting} className="text-[12px] font-semibold text-red-500 hover:text-red-700">
                  Disconnect
                </button>
              </div>
              <div>
                <span className="text-slate-400 block text-[12.5px]">Connection Health</span>
                <span className={cn('font-semibold text-[12.5px]', status.lastVerifyError ? 'text-red-500' : status.lastVerifiedAt ? 'text-emerald-600' : 'text-slate-500')}>
                  {status.lastVerifyError ? 'Error' : status.lastVerifiedAt ? `Healthy — last ${new Date(status.lastVerifiedAt).toLocaleString()}` : 'Not yet verified'}
                </span>
              </div>
              {status.lastVerifyError && (
                <p className="text-[11.5px] text-red-500 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-2">
                  {status.lastVerifyError}
                </p>
              )}
              <div className="pt-1">
                <Button size="sm" variant="outline" onClick={handleTest} loading={testing}>Test Connection</Button>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit(onSave)} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 space-y-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-450 uppercase tracking-widest mb-1.5">API Key *</label>
              <input type="password" autoComplete="new-password" className="form-input text-[13px]"
                placeholder={status?.configured ? '•••••••• (already set — leave blank to keep)' : 'Paste your PageSpeed Insights API key'}
                {...register('apiKey')} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-450 uppercase tracking-widest mb-1.5">Second API Key (optional)</label>
              <input type="password" autoComplete="new-password" className="form-input text-[13px]"
                placeholder={status?.hasSecondKey ? '•••••••• (already set — leave blank to keep)' : 'For faster crawling on large batches'}
                {...register('apiKey2')} />
            </div>
            <Button variant="primary" type="submit" loading={saving}>
              <Save size={14} /> Save
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}

// Shared skeleton for the two Social Media Platform app-credential cards
// (Meta App, LinkedIn App) — same pattern as PageSpeedIntegrationSection,
// but no "Test Connection": there's no unauthenticated endpoint to validate
// an App ID/Secret pair against before a real OAuth grant exists. The real
// test is the Connect flow itself succeeding from Connected Accounts.
function SocialPlatformAppSection({ platform, icon: Icon, title, idField, idLabel, secretField, secretLabel, helpText }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const { register, handleSubmit, reset } = useForm({ defaultValues: { [idField]: '', [secretField]: '' } });

  // Must match exactly what socialAccountController.js's redirectUriFor()
  // actually sends to the platform — that's derived from the BACKEND's own
  // host (req.get('host')), not the browser's. In production these are the
  // same origin (nginx serves both), but in dev the frontend (:5173) and
  // backend (:5000) differ — window.location.origin would be wrong here.
  // api.defaults.baseURL already resolves to the correct backend origin in
  // both cases (see services/api.js's getApiUrl()).
  const callbackUrl = `${api.defaults.baseURL.replace(/\/api$/, '')}/api/social/accounts/${platform}/callback`;

  const loadStatus = async () => {
    try {
      const { data } = await socialPlatformSettingsAPI.status(platform);
      setStatus(data.data);
      reset({ [idField]: data.data?.[idField] || '', [secretField]: '' });
    } catch {
      toast.error(`Failed to load ${title} status`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStatus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onSave = async (formData) => {
    setSaving(true);
    try {
      await socialPlatformSettingsAPI.saveCredentials(platform, formData);
      toast.success('Saved');
      await loadStatus();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to save credentials');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm(`Clear ${title} credentials? Connect buttons for this platform will stop working until reconfigured.`)) return;
    setDisconnecting(true);
    try {
      await socialPlatformSettingsAPI.clearCredentials(platform);
      toast.success('Cleared');
      await loadStatus();
    } catch {
      toast.error('Failed to clear credentials');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="space-y-6">
      <h3 className="text-[16px] font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-200 dark:border-slate-700/60 flex items-center gap-2">
        <Icon size={18} className="text-indigo-500" /> {title}
      </h3>

      {loading ? (
        <p className="text-[13px] text-slate-400">Loading status…</p>
      ) : (
        <div className="max-w-2xl space-y-5">
          <p className="text-[12.5px] text-slate-550 dark:text-slate-400">{helpText}</p>

          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30">
            <span className="text-slate-400 block text-[11px] font-bold uppercase tracking-widest mb-1">Callback URL to register</span>
            <code className="text-[12px] text-slate-700 dark:text-slate-300 break-all">{callbackUrl}</code>
          </div>

          {status?.configured && (
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <h4 className="text-[14px] font-bold text-slate-850 dark:text-slate-200">Configured</h4>
                </div>
                <button type="button" onClick={handleDisconnect} disabled={disconnecting} className="text-[12px] font-semibold text-red-500 hover:text-red-700">
                  Clear
                </button>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit(onSave)} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 space-y-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-450 uppercase tracking-widest mb-1.5">{idLabel} *</label>
              <input type="text" className="form-input text-[13px]" placeholder={idLabel} {...register(idField)} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-450 uppercase tracking-widest mb-1.5">{secretLabel} *</label>
              <input type="password" autoComplete="new-password" className="form-input text-[13px]"
                placeholder={status?.configured ? '•••••••• (already set — leave blank to keep)' : secretLabel}
                {...register(secretField)} />
            </div>
            <Button variant="primary" type="submit" loading={saving}>
              <Save size={14} /> Save
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}

function MetaAppSettingsSection() {
  return (
    <SocialPlatformAppSection
      platform="meta" icon={Share2} title="Meta App (Facebook & Instagram)"
      idField="appId" idLabel="App ID" secretField="appSecret" secretLabel="App Secret"
      helpText="Powers Connect for Facebook Pages and Instagram Business/Creator accounts (one Meta App covers both via Facebook Login for Business). Create at developers.facebook.com — enable Pages API + Instagram Graph API, register the callback URL below, request scopes: pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic, instagram_content_publish, business_management."
    />
  );
}

function LinkedInAppSettingsSection() {
  return (
    <SocialPlatformAppSection
      platform="linkedin" icon={Share2} title="LinkedIn App (Company Pages)"
      idField="clientId" idLabel="Client ID" secretField="clientSecret" secretLabel="Client Secret"
      helpText="Powers Connect for LinkedIn Company Pages. Create at developer.linkedin.com — add the Community Management API product (needed for posting as an organization; LinkedIn reviews this request, typically a few days), register the callback URL below."
    />
  );
}

function XAppSettingsSection() {
  return (
    <SocialPlatformAppSection
      platform="x" icon={Twitter} title="X (Twitter) App"
      idField="clientId" idLabel="Client ID" secretField="clientSecret" secretLabel="Client Secret"
      helpText="Powers Connect for X. Create an app at developer.x.com with OAuth 2.0 enabled, register the callback URL below. Note: meaningful posting volume via the API requires at least X's paid Basic API tier — the free tier is very limited."
    />
  );
}

function YouTubeAppSettingsSection() {
  return (
    <SocialPlatformAppSection
      platform="youtube" icon={Youtube} title="YouTube App"
      idField="clientId" idLabel="Client ID" secretField="clientSecret" secretLabel="Client Secret"
      helpText="Powers Connect for YouTube channels. Create an OAuth 2.0 Client ID at console.cloud.google.com (enable the YouTube Data API v3 first), register the callback URL below. YouTube is video-only — every post here needs an attached video file."
    />
  );
}

function TikTokAppSettingsSection() {
  return (
    <SocialPlatformAppSection
      platform="tiktok" icon={Music2} title="TikTok App"
      idField="clientKey" idLabel="Client Key" secretField="clientSecret" secretLabel="Client Secret"
      helpText="Powers Connect for TikTok. Create an app at developers.tiktok.com with the Content Posting API product, register the callback URL below. Until your app completes TikTok's audit, posts publish as private (visible only to the connected creator) — this is a TikTok-side restriction, not a bug here."
    />
  );
}

// 10c. Website Intelligence — manage the tracked websites (Settings →
// Websites). Each gets a public trackingId (ships in the embedded snippet)
// and a private apiSecret (shown exactly once, for the lead-capture call).
function WebsitesSection() {
  const [websites, setWebsites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [creating, setCreating] = useState(false);
  const [revealSecret, setRevealSecret] = useState(null); // { website, apiSecret }
  const [snippetFor, setSnippetFor] = useState(null); // website being viewed
  const [deletingId, setDeletingId] = useState(null);

  const origin = window.location.origin;

  const load = async () => {
    try {
      const { data } = await witAPI.getWebsites();
      setWebsites(data.data);
    } catch {
      toast.error('Failed to load websites');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim() || !newDomain.trim()) return;
    setCreating(true);
    try {
      const { data } = await witAPI.createWebsite({ name: newName.trim(), domain: newDomain.trim() });
      toast.success(`"${data.data.name}" added`);
      setRevealSecret({ website: data.data, apiSecret: data.data.apiSecret });
      setNewName(''); setNewDomain(''); setShowAddForm(false);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to add website');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (website) => {
    try {
      await witAPI.updateWebsite(website._id, { isActive: !website.isActive });
      toast.success(website.isActive ? 'Website paused' : 'Website resumed');
      await load();
    } catch {
      toast.error('Failed to update website');
    }
  };

  const handleRegenerateSecret = async (website) => {
    if (!window.confirm(`Regenerate the API secret for "${website.name}"? Any code still using the old secret will stop being able to capture leads until updated.`)) return;
    try {
      const { data } = await witAPI.regenerateSecret(website._id);
      setRevealSecret({ website, apiSecret: data.data.apiSecret });
    } catch {
      toast.error('Failed to regenerate secret');
    }
  };

  const handleDelete = async (website) => {
    if (!window.confirm(`Permanently delete "${website.name}"? This removes its visitor/session/pageview history for good. Any leads already captured from it are kept, just unlinked from this site entry.`)) return;
    setDeletingId(website._id);
    try {
      await witAPI.deleteWebsite(website._id);
      toast.success(`"${website.name}" deleted`);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to delete website');
    } finally {
      setDeletingId(null);
    }
  };

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-700/60">
        <h3 className="text-[16px] font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Globe size={18} className="text-indigo-500" /> Tracked Websites
        </h3>
        <Button size="sm" variant="primary" onClick={() => setShowAddForm((v) => !v)}>
          <Plus size={14} /> Add Website
        </Button>
      </div>

      {showAddForm && (
        <form onSubmit={handleCreate} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 space-y-3 max-w-xl">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-450 uppercase tracking-widest mb-1.5">Website Name</label>
              <input className="form-input text-[13px]" placeholder="Main Company Site" value={newName} onChange={(e) => setNewName(e.target.value)} required />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-450 uppercase tracking-widest mb-1.5">Domain</label>
              <input className="form-input text-[13px]" placeholder="example.com" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} required />
            </div>
          </div>
          <Button variant="primary" type="submit" loading={creating}>Create & Get Snippet</Button>
        </form>
      )}

      {loading ? (
        <p className="text-[13px] text-slate-400">Loading…</p>
      ) : websites.length === 0 ? (
        <p className="text-[13px] text-slate-400">No websites added yet.</p>
      ) : (
        <div className="space-y-3 max-w-3xl">
          {websites.map((w) => (
            <div key={w._id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', w.isActive ? 'bg-emerald-500' : 'bg-slate-350')} />
                <div className="min-w-0">
                  <p className="text-[14px] font-bold text-slate-850 dark:text-slate-200 truncate">{w.name}</p>
                  <p className="text-[12px] text-slate-450 truncate">{w.domain}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button size="xs" variant="outline" onClick={() => setSnippetFor(w)}>Snippet</Button>
                <Button size="xs" variant="outline" onClick={() => handleRegenerateSecret(w)}>New Secret</Button>
                <Button size="xs" variant={w.isActive ? 'outline' : 'primary'} onClick={() => handleToggleActive(w)}>
                  {w.isActive ? 'Pause' : 'Resume'}
                </Button>
                <button
                  onClick={() => handleDelete(w)}
                  disabled={deletingId === w._id}
                  title="Delete website"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Reveal secret modal (shown ONCE at creation / regeneration) ── */}
      {revealSecret && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4" onClick={() => setRevealSecret(null)}>
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">API Secret for {revealSecret.website.name}</h3>
            <p className="text-[12.5px] text-red-500 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-2.5">
              Save this now — it will never be shown again. It's needed only by your site's own backend, to POST captured leads to <code>/api/wit/lead</code>.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[12.5px] bg-slate-100 dark:bg-slate-800 px-3 py-2 rounded-lg break-all">{revealSecret.apiSecret}</code>
              <Button size="sm" variant="outline" onClick={() => copyToClipboard(revealSecret.apiSecret, 'Secret')}>Copy</Button>
            </div>
            <div className="text-right">
              <Button variant="primary" onClick={() => setRevealSecret(null)}>Done</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Snippet / integration instructions modal ── */}
      {snippetFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4" onClick={() => setSnippetFor(null)}>
          <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">Embed on {snippetFor.name}</h3>
              <button onClick={() => setSnippetFor(null)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-450"><X size={16} /></button>
            </div>

            <div>
              <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">1. Add to every page (before <code>&lt;/body&gt;</code>)</p>
              <div className="flex items-start gap-2">
                <pre className="flex-1 text-[12px] bg-slate-900 text-slate-200 rounded-lg p-3 overflow-x-auto">{`<script src="${origin}/wit.js" data-tracking-id="${snippetFor.trackingId}" async></script>`}</pre>
                <Button size="xs" variant="outline" onClick={() => copyToClipboard(`<script src="${origin}/wit.js" data-tracking-id="${snippetFor.trackingId}" async></script>`, 'Snippet')}>Copy</Button>
              </div>
            </div>

            <div>
              <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">2. (Optional) Tag lead forms to track Form Analytics</p>
              <pre className="text-[12px] bg-slate-900 text-slate-200 rounded-lg p-3 overflow-x-auto">{`<form data-wit-form="quote-request">\n  <input name="name" />\n  <input name="email" />\n  <button type="submit">Send</button>\n</form>`}</pre>
            </div>

            <div>
              <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">3. When your backend creates the lead, link it to this visitor</p>
              <pre className="text-[12px] bg-slate-900 text-slate-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">{`POST ${origin}/api/wit/lead\n{\n  "trackingId": "${snippetFor.trackingId}",\n  "apiSecret": "<your saved secret>",\n  "visitorId": "<from wit.getIds() client-side, or the hidden wit_visitor_id form field>",\n  "sessionId": "<same, wit_session_id>",\n  "companyName": "...", "contactPerson": "...", "email": "...", "phone": "...", "dealValue": 0,\n  "customFields": {\n    "contactPreference": "phone",\n    "message": "...",\n    "debtValue": "20k-50k"\n  }\n}`}</pre>
              <p className="text-[11.5px] text-slate-450 mt-1.5">This creates the lead directly in the pipeline with source "Web Form" and full UTM/landing-page attribution — you don't need to separately call the regular Leads API.</p>
              <p className="text-[11.5px] text-slate-450 mt-1">
                <code className="text-[11px]">customFields.debtValue</code>, <code className="text-[11px]">customFields.contactPreference</code>, and <code className="text-[11px]">customFields.message</code> are optional, for consumer debt-advice forms —
                they map onto the Leads table's Debt Amount / Preferred Contact / Situation columns (a top-level <code className="text-[11px]">debtValue</code> also still works, if that's easier for your integration). Any other key under <code className="text-[11px]">customFields</code> is still saved, just without a dedicated column.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 11. Personal Profile Settings (All Members)
function PersonalProfileSection({ user, onUpdate }) {
  const updateAvatar = useAppStore((s) => s.updateAvatar);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileRef = useRef(null);

  const handleAvatarPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return toast.error('Please choose a JPG, PNG, WebP or GIF image');
    if (file.size > 3 * 1024 * 1024) return toast.error('Image must be 3 MB or smaller');
    setAvatarBusy(true);
    const res = await updateAvatar(file);
    setAvatarBusy(false);
    if (res.success) toast.success('Profile picture updated!');
  };

  const handleAvatarRemove = async () => {
    setAvatarBusy(true);
    const res = await updateAvatar(null);
    setAvatarBusy(false);
    if (res.success) toast.success('Profile picture removed');
  };

  const { register, handleSubmit } = useForm({
    defaultValues: {
      name:  user?.name  || '',
      email: user?.email || '',
      phone: user?.phone || '',
      bio:   user?.bio   || ''
    }
  });

  const [color, setColor] = useState(user?.color || '#6366f1');

  const onSubmit = (data) => {
    onUpdate({ ...data, color });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <h3 className="text-[16px] font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-200 dark:border-slate-700/60 flex items-center gap-2">
        <User size={18} className="text-indigo-500" /> Individual Agent Workspace Profile
      </h3>

      <div className="flex items-center gap-4 mb-3">
        <div 
          className="w-16 h-16 rounded-full flex items-center justify-center text-white text-[22px] font-bold shadow-sm overflow-hidden flex-shrink-0"
          style={{ background: user?.avatar ? 'transparent' : color }}
        >
          <AvatarContent user={user} fallback={user?.name?.[0] || 'U'} />
        </div>
        <div className="min-w-0">
          <p className="text-[15.5px] font-bold text-slate-900 dark:text-white">{user?.name}</p>
          <span className="badge badge-purple uppercase tracking-wider text-[9.5px] font-bold inline-block mt-0.5">{user?.role}</span>
          <div className="flex items-center gap-2 mt-2">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleAvatarPick} />
            <Button variant="outline" size="sm" type="button" disabled={avatarBusy} onClick={() => fileRef.current?.click()}>
              <Camera size={13} /> {avatarBusy ? 'Uploading…' : user?.avatar ? 'Change Photo' : 'Upload Photo'}
            </Button>
            {user?.avatar && (
              <Button variant="ghost" size="sm" type="button" disabled={avatarBusy} onClick={handleAvatarRemove}>
                <Trash2 size={13} /> Remove
              </Button>
            )}
          </div>
          <p className="text-[11.5px] text-slate-400 mt-1.5">JPG, PNG, WebP or GIF · max 3 MB</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <label className="block text-[13.5px] font-semibold text-slate-700 dark:text-slate-350 mb-1.5">Full Name</label>
          <input className="form-input text-[13.5px] py-2" {...register('name')} />
        </div>
        <div>
          <label className="block text-[13.5px] font-semibold text-slate-700 dark:text-slate-350 mb-1.5">Work Email</label>
          <input type="email" className="form-input text-[13.5px] py-2" {...register('email')} />
        </div>
        <div>
          <label className="block text-[13.5px] font-semibold text-slate-700 dark:text-slate-350 mb-1.5">Contact Number</label>
          <input className="form-input text-[13.5px] py-2" {...register('phone')} />
        </div>
        {/* The accent colour only shows behind initials, so hide it once a photo is set */}
        {!user?.avatar && (
        <div>
          <label className="block text-[13.5px] font-semibold text-slate-700 dark:text-slate-350 mb-1.5">Personal Avatar Accent Color</label>
          <div className="flex flex-wrap gap-2 mt-1.5">
            {COLOR_SWATCHES.map((c) => (
              <button
                key={c} type="button" onClick={() => setColor(c)}
                className={cn('w-7 h-7 rounded-full border-2 transition-all', color === c ? 'border-slate-800 dark:border-white scale-110' : 'border-transparent hover:scale-105')}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
        )}
        <div className="md:col-span-2">
          <label className="block text-[13.5px] font-semibold text-slate-700 dark:text-slate-350 mb-1.5">Short Bio</label>
          <textarea rows={3} className="form-input text-[13.5px] py-2 resize-none" {...register('bio')} placeholder="Write a short summary about yourself..." />
        </div>
      </div>

      <Button variant="primary" type="submit">
        <Save size={14} /> Update Profile
      </Button>
    </form>
  );
}

// 12. Email & Calendar synchronization (All Members)
function EmailCalendarSyncSection({ user, onUpdate }) {
  const [calendarSync, setCalendarSync] = useState(!!user?.calendarSyncEnabled);

  const handleCalendarToggle = (checked) => {
    setCalendarSync(checked);
    onUpdate({ calendarSyncEnabled: checked });
  };

  return (
    <div className="space-y-6">
      <h3 className="text-[16px] font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-200 dark:border-slate-700/60 flex items-center gap-2">
        <Mail size={18} className="text-indigo-500" /> Connected Mailboxes
      </h3>

      <div className="space-y-4">
        <p className="text-[12.5px] text-slate-500 dark:text-slate-400 -mt-2">
          Connect a mailbox with SMTP (sending) and, optionally, IMAP (inbox sync). You can connect more than
          one — each is tested independently and only you (or an admin/manager) can manage the ones you add.
        </p>

        <div className="max-w-2xl">
          <EmailAccountsManager initialView="list" showBackFromAdd={false} />
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/10 flex items-center justify-between max-w-xl">
          <div>
            <h4 className="text-[13.5px] font-bold text-slate-850 dark:text-slate-200">Calendar Sync Integration</h4>
            <p className="text-[12px] text-slate-500 mt-0.5">Permit the CRM to read your calendar availability and create invite bookings instantly.</p>
          </div>
          <input type="checkbox" className="w-5 h-5 accent-indigo-500" checked={calendarSync} onChange={(e) => handleCalendarToggle(e.target.checked)} />
        </div>
      </div>
    </div>
  );
}

// 13. Personal Notification preferences (All Members)
function PersonalNotificationSection({ user, onUpdate, role }) {
  const initialPrefs = useMemo(() => {
    // Convert Map or Object to clean keys
    const raw = user?.notificationPrefs;
    const defaults = {
      task_assigned: true,
      task_approved: true,
      meeting_reminder: true,
      client_update: false,
      message_dm: true,
      weekly_report: false,
      deal_closed: true,
      new_comment: true,
      lead_assigned: true,
      lead_mentioned: true
    };
    if (!raw) return defaults;
    
    // Handle Map structure or plain object safely
    const obj = {};
    Object.keys(defaults).forEach((k) => {
      obj[k] = raw instanceof Map ? raw.get(k) : raw[k];
      if (obj[k] === undefined) obj[k] = defaults[k];
    });
    return obj;
  }, [user]);

  const [prefs, setPrefs] = useState(initialPrefs);
  const [permission, setPermission] = useState(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  );

  useEffect(() => {
    setPrefs(initialPrefs);
  }, [initialPrefs]);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  const handleToggle = (key, val) => {
    setPrefs({ ...prefs, [key]: val });
  };

  const handleSave = () => {
    onUpdate({ notificationPrefs: prefs });
  };

  const requestPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const res = await Notification.requestPermission();
      setPermission(res);
      if (res === 'granted') {
        toast.success('System notifications successfully enabled!');
        sendTestNotification();
      } else if (res === 'denied') {
        toast.error('Notification permission was denied. Please update your browser site settings.');
      }
    } catch {
      toast.error('Failed to request notification permission.');
    }
  };

  const sendTestNotification = async () => {
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') {
      toast.error('Notifications are not permitted by your browser.');
      return;
    }
    
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        reg.showNotification('CRM System Test', {
          body: 'Hello! This is a test Windows toast notification from your CRM.',
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag: 'test-notification',
          renotify: true,
          requireInteraction: false
        });
      } else {
        new Notification('CRM System Test', {
          body: 'Hello! This is a test Windows toast notification from your CRM.',
          icon: '/favicon.ico',
          tag: 'test-notification'
        });
      }
      toast.success('Test notification sent!');
    } catch (err) {
      new Notification('CRM System Test', {
        body: 'Hello! This is a test Windows toast notification from your CRM.',
        icon: '/favicon.ico',
        tag: 'test-notification'
      });
      toast.success('Test notification sent via fallback!');
    }
  };

  const allPrefsList = [
    { key: 'task_assigned',    label: 'New Task Assigned',       desc: 'Get notified immediately when a task is assigned to you.' },
    { key: 'task_approved',    label: 'Task Completed',          desc: 'Alert when a task you submitted for review is marked as completed.' },
    { key: 'meeting_reminder', label: '15-Min Meeting Alert',    desc: 'Pre-meeting alerts 15 minutes before a meeting starts.' },
    { key: 'message_dm',       label: 'Channel Messages',        desc: 'Notifications on receiving direct chat thread communications.' },
    { key: 'new_comment',      label: 'Comments & Activity',     desc: 'Get alerts on task feedback or activity notes.' },
    // staff-only below
    { key: 'client_update',    label: 'Client Profile updates',  desc: 'Get updates when client budget, contract or onboarding terms are modified.', staffOnly: true },
    { key: 'deal_closed',      label: 'Closed Deal summary',     desc: 'Admin summary alerts when sales deals are closed won/lost.', staffOnly: true },
    { key: 'weekly_report',    label: 'Weekly Digest summary',   desc: 'Receive Monday performance stats in a summary email.', staffOnly: true },
    { key: 'lead_assigned',    label: 'Lead Reassignments',      desc: 'Get notified immediately when a B2B sales lead is assigned to you.', staffOnly: true },
    { key: 'lead_mentioned',   label: 'Lead Note @Mentions',     desc: 'Alert when other sales reps or admins tag you in internal lead activity streams.', staffOnly: true },
  ];
  const prefsList = role === 'client'
    ? allPrefsList.filter((p) => !p.staffOnly)
    : allPrefsList;

  return (
    <div className="space-y-6">
      <h3 className="text-[16px] font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-200 dark:border-slate-700/60 flex items-center gap-2">
        <Bell size={18} className="text-indigo-500" /> Personal Notification Preferences
      </h3>

      {/* OS Notification Status Card */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-550/5 dark:bg-slate-900/30 max-w-xl space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h4 className="text-[13.5px] font-bold text-slate-850 dark:text-slate-200 flex items-center gap-1.5">
              <Smartphone size={16} className="text-indigo-500" /> Windows / Desktop OS Notifications
            </h4>
            <p className="text-[12px] text-slate-500 mt-1">
              To receive Windows-level toast notifications outside the CRM, you must grant permission in your browser.
            </p>
          </div>
          <span className={cn(
            'px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider',
            permission === 'granted' ? 'bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400' :
            permission === 'denied' ? 'bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400' :
            'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400'
          )}>
            {permission === 'granted' ? 'Active' : permission === 'denied' ? 'Blocked' : 'Not Configured'}
          </span>
        </div>

        <div className="flex flex-wrap gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80">
          {(permission === 'default' || permission === 'unsupported') && (
            <Button variant="primary" size="sm" onClick={requestPermission} disabled={permission === 'unsupported'}>
              Enable OS Notifications
            </Button>
          )}
          {permission === 'denied' && (
            <div className="text-[12px] text-red-500 flex items-start gap-1 font-semibold">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5 text-red-500 animate-pulse" />
              <span>Permission blocked in Brave/Chrome. Click the lock/settings icon in the URL bar and change Notifications to "Allow".</span>
            </div>
          )}
          {permission === 'granted' && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={sendTestNotification}>
                Send Test OS Notification
              </Button>
              <span className="text-[12px] text-slate-400 flex items-center gap-1">
                <Check size={13} className="text-green-500" /> OS push integration active
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="divide-y divide-slate-100 dark:divide-slate-800/80 max-w-xl">
        {prefsList.map((p) => (
          <Toggle
            key={p.key}
            label={p.label}
            description={p.desc}
            checked={!!prefs[p.key]}
            onChange={(v) => handleToggle(p.key, v)}
          />
        ))}
      </div>

      <div className="mt-2">
        <Button variant="primary" onClick={handleSave}>
          <Save size={14} /> Save Preferences
        </Button>
      </div>
    </div>
  );
}

// 14. Signature & Landing view preferences (All Members)
function SignaturePreferencesSection({ user, onUpdate }) {
  const [landingView, setLandingView] = useState(user?.defaultLandingView || 'dashboard');
  const [signature, setSignature] = useState(user?.personalSignature || '');

  const handleSave = () => {
    onUpdate({
      personalSignature: signature,
      defaultLandingView: landingView
    });
  };

  return (
    <div className="space-y-6">
      <h3 className="text-[16px] font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-200 dark:border-slate-700/60 flex items-center gap-2">
        <PenTool size={18} className="text-indigo-500" /> Personal Signature & View Preferences
      </h3>

      <div className="space-y-4 max-w-xl">
        <div>
          <label className="block text-[13.5px] font-semibold text-slate-700 dark:text-slate-350 mb-1.5">Default Landing View</label>
          <p className="text-[12px] text-slate-450 mb-2">Choose which interface opens directly upon logging into the BizzBuzz CRM.</p>
          <select className="form-input text-[13.5px] py-2" value={landingView} onChange={(e) => setLandingView(e.target.value)}>
            <option value="dashboard">Analytics Dashboard Summary</option>
            <option value="tasks">Tasks Board Kanban Grid</option>
            <option value="clients">Clients & Dynamic Projects Directory</option>
          </select>
        </div>

        <div className="pt-4 border-t border-slate-200 dark:border-slate-850">
          <label className="block text-[13.5px] font-semibold text-slate-700 dark:text-slate-350 mb-1.5">Professional Email Signature</label>
          <p className="text-[12.5px] text-slate-450 mb-2">This signature will automatically append to all client outreach emails sent from the CRM.</p>
          <textarea 
            rows={5} className="form-input text-[13px] py-2 resize-none font-mono" 
            value={signature} onChange={(e) => setSignature(e.target.value)} 
            placeholder={`Regards,\n${user?.name || 'Representative'}\nBizzBuzz Creations`}
          />
        </div>
      </div>

      <Button variant="primary" onClick={handleSave}>
        <Save size={14} /> Update Signature & Layout
      </Button>
    </div>
  );
}


// ───────────────────────────────────────────────────────────────────
// ── Main Settings Page Dashboard
// ───────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { 
    authUser, users, tasks, todos, clients, systemSettings, 
    updateSystemSettings, inviteUser, updateProfile 
  } = useAppStore(
    useShallow((s) => ({
      authUser:             s.authUser,
      users:                s.users,
      tasks:                s.tasks,
      todos:                s.todos,
      clients:              s.clients,
      systemSettings:       s.systemSettings,
      updateSystemSettings: s.updateSystemSettings,
      inviteUser:           s.inviteUser,
      updateProfile:        s.updateProfile
    }))
  );

  const role = authUser?.role;
  const isClient = role === 'client';
  const isManager = canManage(role);
  const isAdmin = canAdmin(role);

  // Group tabs dynamically
  const tabsList = useMemo(() => {
    const list = [];

    if (isClient) {
      // Clients only see profile, notifications, and password change
      list.push({ group: 'My Account', items: [
        { id: 'profile',       label: 'My Profile',   icon: User },
        { id: 'notifications', label: 'Notifications', icon: Bell },
        { id: 'security',      label: 'Change Password', icon: Lock },
      ]});
      return list;
    }

    // Tier 3: Personal Settings (All Members)
    list.push({ group: 'Personal Setup', items: [
      { id: 'profile',       label: 'My Profile',      icon: User },
      { id: 'email_sync',    label: 'Email & Sync',    icon: Mail },
      { id: 'notifications', label: 'My Alerts',       icon: Bell },
      { id: 'signature',     label: 'Signature',       icon: PenTool },
      { id: 'security',      label: 'Security & Pwd',  icon: Lock },
      { id: 'worklog',       label: 'Hours Log',       icon: Clock },
      { id: 'lead_import',   label: 'Lead Importer',   icon: Database }
    ]});

    // Tier 2: Managerial Settings (Admins & Managers)
    if (isManager) {
      list.push({ group: 'Operations', items: [
        { id: 'teams',            label: 'Users & Teams',   icon: Users },
        { id: 'workspace',        label: 'Workspace Lists', icon: Settings },
        { id: 'assignment_rules', label: 'Lead Routing',    icon: Sliders },
        { id: 'templates',        label: 'Communication',   icon: FileText },
        { id: 'notification_routing', label: 'Notification Routing', icon: Bell },
        { id: 'integrations',     label: 'Integrations',    icon: Zap },
        { id: 'data',             label: 'Data Controls',   icon: Database }
      ]});
    }

    // External integrations — visible to managers (Meta Ads, Websites) and
    // admins (everything else); built conditionally so each item keeps
    // exactly the access level it had before this group existed, just
    // regrouped.
    const integrationItems = [];
    if (isManager) {
      integrationItems.push(
        { id: 'meta_ads',  label: 'Meta Ads',  icon: Megaphone },
        { id: 'websites',  label: 'Websites',  icon: Globe },
      );
    }
    if (isAdmin) {
      integrationItems.push(
        { id: 'main_crm_integration', label: 'IVA CRM Integration', icon: ArrowUpRight },
        { id: 'pagespeed_integration', label: 'PageSpeed Insights', icon: Search },
      );
    }
    if (integrationItems.length) list.push({ group: 'Integrations', items: integrationItems });

    // Tier 1: System Settings (Admins Only)
    if (isAdmin) {
      list.push({ group: 'Global Admin', items: [
        { id: 'company',        label: 'Company Profile', icon: Globe },
       // { id: 'billing',        label: 'CRM Subscription',icon: Rocket },
        { id: 'security_config',label: 'Auth Controls',   icon: Shield },
        { id: 'pipelines',      label: 'Sales Pipelines', icon: Sliders },
        { id: 'feature_access', label: 'Feature Access Control', icon: Lock },
        { id: 'services',       label: 'Services Dir',    icon: Layers }
      ]});

      // Social Media Management's per-platform app credentials (Settings ->
      // this group) — kept separate from the general Integrations group
      // above since these are specifically what the Connect flow on
      // Social Media -> Connected Accounts reads from.
      list.push({ group: 'Social Media Platforms', items: [
        { id: 'meta_app_settings',    label: 'Meta App (FB/IG)', icon: Share2 },
        { id: 'linkedin_app_settings', label: 'LinkedIn App',    icon: Share2 },
        { id: 'x_app_settings',       label: 'X App',            icon: Twitter },
        { id: 'youtube_app_settings', label: 'YouTube App',      icon: Youtube },
        { id: 'tiktok_app_settings',  label: 'TikTok App',       icon: Music2 },
      ]});
    }

    return list;
  }, [isAdmin, isManager]);

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(tabParam || 'profile');

  useEffect(() => {
    if (tabParam) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  // Personal Profile updates
  const handleUpdateProfile = async (body) => {
    try {
      const res = await updateProfile(body);
      if (res?.success) toast.success('Profile updated!');
    } catch {}
  };

  // Global settings updates
  const handleUpdateSystemSettings = async (body) => {
    try {
      await updateSystemSettings(body);
    } catch {}
  };

  // Export handlers
  const today = localDateStr();

  const handleExportTasks = () => {
    const rows = [
      ['Title','Assigned To','Status','Priority','Due Date','Created','Type'],
      ...tasks.map((t) => [t.title, String(t.assignedTo), t.status, t.priority, t.dueDate||'', t.createdAt||'', t.type]),
    ];
    downloadCSV(rows, `tasks-${today}.csv`);
    toast.success('Tasks exported!');
  };

  const handleExportTodos = () => {
    const rows = [
      ['Title','User ID','Status','Priority','ETA','Created'],
      ...todos.map((t) => [t.title, String(t.userId), t.status, t.priority, t.eta||'', t.createdAt||'']),
    ];
    downloadCSV(rows, `todos-${today}.csv`);
    toast.success('Todos exported!');
  };

  const handleExportClients = () => {
    const rows = [
      ['Name','Contact','Email','Phone','Industry','Status','Payment'],
      ...clients.map((c) => [c.name, c.contact, c.email, c.phone, c.industry, c.status, c.paymentStatus]),
    ];
    downloadCSV(rows, `clients-${today}.csv`);
    toast.success('Clients exported!');
  };

  const handleFullBackup = () => {
    downloadJSON({ tasks, todos, clients, systemSettings, exported: today }, `bbc-crm-backup-${today}.json`);
    toast.success('Full database backup downloaded!');
  };

  return (
    <Page>
      <div className="mb-6">
        <h1 className="page-title">{isClient ? 'Account Settings' : 'General Settings Dashboard'}</h1>
        <p className="page-sub">{isClient ? 'Manage your profile, notifications, and portal password' : 'Configure dynamic workspace setups, lead distributions, templates, and agent sync accounts'}</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* ── Left Navigation Panels ── */}
        <div className="w-full lg:w-60 flex-shrink-0 space-y-4">
          {tabsList.map((grp) => (
            <div key={grp.group} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/80 p-2 shadow-card">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 px-3 py-1.5">{grp.group}</p>
              {grp.items.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id} onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all text-left mb-0.5 last:mb-0',
                      isActive
                        ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 shadow-sm border-l-2 border-indigo-500'
                        : 'text-slate-600 dark:text-slate-450 hover:bg-slate-50 dark:hover:bg-slate-700/30'
                    )}
                  >
                    <tab.icon size={15} className={cn('flex-shrink-0', isActive ? 'text-indigo-500' : 'text-slate-400')} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* ── Right Content Dashboard Panel ── */}
        <div className={cn(
          'flex-1 w-full bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/80 p-6 md:p-8 shadow-card min-h-[500px]',
          // Keep the panel pinned while the left navigation scrolls; tall tabs scroll inside the panel
          'lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-7.5rem)] lg:overflow-y-auto'
        )}>
          {/* Tier 3: Personal Settings */}
          {activeTab === 'profile' && (
            <PersonalProfileSection user={authUser} onUpdate={handleUpdateProfile} />
          )}
          {activeTab === 'email_sync' && (
            <EmailCalendarSyncSection user={authUser} onUpdate={handleUpdateProfile} />
          )}
          {activeTab === 'notifications' && (
            <PersonalNotificationSection user={authUser} onUpdate={handleUpdateProfile} role={role} />
          )}
          {activeTab === 'signature' && (
            <SignaturePreferencesSection user={authUser} onUpdate={handleUpdateProfile} />
          )}
          {activeTab === 'security' && (
            <div className="space-y-6">
              <h3 className="text-[16px] font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-200 dark:border-slate-700/60 flex items-center gap-2">
                <Lock size={18} className="text-indigo-500" /> Account Security Controls
              </h3>
              <div className="bg-slate-50 dark:bg-slate-900/30 p-4 rounded-xl border border-slate-200 dark:border-slate-800 text-[13px] text-slate-500 flex gap-2">
                <Info size={16} className="text-indigo-500 flex-shrink-0 mt-0.5" />
                <span>To change your password, fill in your current credentials below to verify your session ownership.</span>
              </div>
              <SecuritySection />
            </div>
          )}
          {activeTab === 'worklog' && (
            <div>
              <div className="bg-slate-50 dark:bg-slate-900/30 p-4 rounded-xl border border-slate-200 dark:border-slate-800 mb-6 flex gap-2">
                <Clock size={16} className="text-indigo-500 flex-shrink-0 mt-0.5" />
                <span className="text-[13px] text-slate-500">Track and monitor your daily work hours log and breaks history recorded by the active session timer.</span>
              </div>
              <WorkLogSection authUser={authUser} users={users} />
            </div>
          )}
          {activeTab === 'lead_import' && (
            <LeadImporterSection />
          )}

          {/* Tier 2: Managerial Settings */}
          {isManager && activeTab === 'teams' && (
            <TeamsManagementSection 
              settings={systemSettings} onSave={handleUpdateSystemSettings} 
              users={users} onInvite={inviteUser} 
            />
          )}
          {isManager && activeTab === 'assignment_rules' && (
            <AssignmentRulesSection settings={systemSettings} onSave={handleUpdateSystemSettings} />
          )}
          {isManager && activeTab === 'templates' && (
            <TemplatesSection settings={systemSettings} onSave={handleUpdateSystemSettings} />
          )}
          {isManager && activeTab === 'notification_routing' && (
            <NotificationRoutingSection settings={systemSettings} onSave={handleUpdateSystemSettings} users={users} />
          )}
          {isManager && activeTab === 'integrations' && (
            <IntegrationsSection settings={systemSettings} onSave={handleUpdateSystemSettings} />
          )}
          {isManager && activeTab === 'meta_ads' && <MetaAdsSection />}
          {isManager && activeTab === 'websites' && <WebsitesSection />}
          {isManager && activeTab === 'data' && (
            <DataControlSection 
              settings={systemSettings} onSave={handleUpdateSystemSettings}
              onExportTasks={handleExportTasks} onExportTodos={handleExportTodos} 
              onExportClients={handleExportClients} onFullBackup={handleFullBackup} 
            />
          )}

          {/* Tier 1: Admin Only Settings */}
          {isAdmin && activeTab === 'company' && (
            <CompanyProfileSection settings={systemSettings} onSave={handleUpdateSystemSettings} />
          )}
          {isAdmin && activeTab === 'billing' && (
            <BillingSubscriptionSection settings={systemSettings} onSave={handleUpdateSystemSettings} />
          )}
          {isAdmin && activeTab === 'security_config' && (
            <SecurityConfigSection settings={systemSettings} onSave={handleUpdateSystemSettings} />
          )}
          {isAdmin && activeTab === 'pipelines' && (
            <PipelinesStagesSection settings={systemSettings} onSave={handleUpdateSystemSettings} />
          )}
          {isAdmin && activeTab === 'feature_access' && (
            <FeatureAccessSection settings={systemSettings} onSave={handleUpdateSystemSettings} users={users} />
          )}
          {isAdmin && activeTab === 'main_crm_integration' && (
            <MainCrmIntegrationSection />
          )}
          {isAdmin && activeTab === 'pagespeed_integration' && (
            <PageSpeedIntegrationSection />
          )}
          {isAdmin && activeTab === 'meta_app_settings' && (
            <MetaAppSettingsSection />
          )}
          {isAdmin && activeTab === 'linkedin_app_settings' && (
            <LinkedInAppSettingsSection />
          )}
          {isAdmin && activeTab === 'x_app_settings' && (
            <XAppSettingsSection />
          )}
          {isAdmin && activeTab === 'youtube_app_settings' && (
            <YouTubeAppSettingsSection />
          )}
          {isAdmin && activeTab === 'tiktok_app_settings' && (
            <TikTokAppSettingsSection />
          )}
          {isAdmin && activeTab === 'services' && (
            <ServicesSection />
          )}
          {isManager && activeTab === 'workspace' && (
            <WorkspaceSection settings={systemSettings} onSave={handleUpdateSystemSettings} />
          )}
        </div>
      </div>
    </Page>
  );
}

// ───────────────────────────────────────────────────────────────────
// ── Keep legacy layout / subcomponents compatible ──────────────────
// ───────────────────────────────────────────────────────────────────

function SecuritySection() {
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, reset } = useForm({
    defaultValues: { currentPwd: '', newPwd: '', confirmPwd: '' },
  });
  const changePassword = useAppStore((s) => s.changePassword);

  const onSubmit = async (data) => {
    if (data.newPwd !== data.confirmPwd) {
      toast.error('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const res = await changePassword(data.currentPwd, data.newPwd);
      if (res?.success) {
        reset();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 max-w-md">
      <div>
        <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-350 mb-1">Current Password</label>
        <input type="password" required className="form-input text-[13px] py-1.5" {...register('currentPwd')} />
      </div>
      <div>
        <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-350 mb-1">New Password</label>
        <input type="password" required minLength={6} className="form-input text-[13px] py-1.5" {...register('newPwd')} placeholder="Min 6 characters" />
      </div>
      <div>
        <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-350 mb-1">Confirm New Password</label>
        <input type="password" required className="form-input text-[13px] py-1.5" {...register('confirmPwd')} />
      </div>
      <Button variant="primary" type="submit" disabled={loading}>
        {loading ? <RefreshCw size={14} className="animate-spin mr-1" /> : <Lock size={14} className="mr-1" />}
        {loading ? 'Updating...' : 'Update Password'}
      </Button>
    </form>
  );
}

function WorkLogSection({ authUser, users }) {
  const isManager   = canManage(authUser?.role);
  const isAdmin     = canAdmin(authUser?.role);
  const [filterUser, setFilterUser] = useState('all');
  const fetchWorkLog = useAppStore((s) => s.fetchWorkLog);
  const updateWorkLog = useAppStore((s) => s.updateWorkLog);
  const deleteWorkLog = useAppStore((s) => s.deleteWorkLog);
  const bulkDeleteWorkLogs = useAppStore((s) => s.bulkDeleteWorkLogs);
  const [dbLogs, setDbLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // { ids: string[], label: string }
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [editRow, setEditRow] = useState(null); // { id, label, hours, minutes, targetHours }
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchWorkLog();
        if (active) setDbLogs(data || []);
      } catch (err) {
        console.error('Failed to fetch work logs from backend', err);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [fetchWorkLog]);

  const allRows = useMemo(() => {
    const rows = [];
    dbLogs.forEach((log) => {
      const u = users.find((usr) => sameId(usr, log.userId));
      if (!u) return;
      if (!isManager && !sameId(u, authUser)) return;
      rows.push({
        id:            log._id,
        user:          u,
        date:          log.date,
        workSeconds:   log.workSeconds || 0,
        breaks:        log.breaks || [],
        isToday:       log.date === localDateStr(),
        targetSeconds: log.targetSeconds || (8 * 3600),
      });
    });
    return rows.sort((a, b) => {
      if (a.isToday && !b.isToday) return -1;
      if (!a.isToday && b.isToday) return 1;
      return (b.date || '').localeCompare(a.date || '');
    });
  }, [dbLogs, users, authUser, isManager]);

  const filtered = useMemo(() => {
    if (!isManager || filterUser === 'all') return allRows;
    return allRows.filter((r) => getId(r.user) === filterUser);
  }, [allRows, filterUser, isManager]);

  // Selection is scoped to the current filter — reset it when the filter changes
  // so a hidden/stale selection can't be bulk-deleted without the admin seeing it.
  useEffect(() => { setSelectedIds(new Set()); }, [filterUser]);

  const breakTotal = (breaks, type) => {
    if (!breaks?.length) return 0;
    return breaks.filter((b) => b.type === type).reduce((a, b) => a + (b.actual || b.planned || 0), 0);
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((r) => r.id))));
  };

  const toggleSelectRow = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleDeleteConfirmed = async () => {
    if (!confirmDelete || deleting) return;
    setDeleting(true);
    try {
      const { ids } = confirmDelete;
      if (ids.length === 1) await deleteWorkLog(ids[0]);
      else await bulkDeleteWorkLogs(ids);
      const idSet = new Set(ids);
      setDbLogs((logs) => logs.filter((l) => !idSet.has(l._id)));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    } catch {} finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  };

  const openEdit = (row) => {
    setEditRow({
      id: row.id,
      label: `${row.user.name} — ${fmtDate(row.date)}`,
      hours:   String(Math.floor(row.workSeconds / 3600)),
      minutes: String(Math.floor((row.workSeconds % 3600) / 60)),
      targetHours: String(Math.round((row.targetSeconds || 8 * 3600) / 3600)),
    });
  };

  const handleEditSave = async () => {
    if (!editRow || savingEdit) return;
    const hours   = Math.max(0, parseInt(editRow.hours, 10)   || 0);
    const minutes = Math.max(0, Math.min(59, parseInt(editRow.minutes, 10) || 0));
    const targetHours = Math.max(1, parseInt(editRow.targetHours, 10) || 8);
    const workSeconds   = hours * 3600 + minutes * 60;
    const targetSeconds = targetHours * 3600;

    setSavingEdit(true);
    try {
      const updated = await updateWorkLog(editRow.id, { workSeconds, targetSeconds });
      setDbLogs((logs) => logs.map((l) => (l._id === editRow.id ? { ...l, workSeconds: updated.workSeconds, targetSeconds: updated.targetSeconds } : l)));
      setEditRow(null);
    } catch {} finally {
      setSavingEdit(false);
    }
  };

  return (
    <div>
      {isManager && (
        <div className="flex items-center gap-2 text-[13px] text-slate-500 mb-4 justify-end">
          <span className="font-semibold">Viewing Logs:</span>
          <select className="form-input w-[160px] py-1.5 text-[13px]" value={filterUser} onChange={(e) => setFilterUser(e.target.value)}>
            <option value="all">All Members</option>
            {users.map((u) => (
              <option key={getId(u)} value={getId(u)}>{u.name}</option>
            ))}
          </select>
        </div>
      )}

      {isAdmin && selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-2 mb-3 px-4 py-2.5 rounded-xl bg-red-50 dark:bg-red-900/15 border border-red-200 dark:border-red-900/40">
          <span className="text-[13px] font-semibold text-red-700 dark:text-red-300">
            {selectedIds.size} log{selectedIds.size === 1 ? '' : 's'} selected
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedIds(new Set())} className="text-[12.5px] font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 px-2 py-1">
              Clear
            </button>
            <button
              onClick={() => setConfirmDelete({
                ids: Array.from(selectedIds),
                label: `${selectedIds.size} work log ${selectedIds.size === 1 ? 'entry' : 'entries'}`,
              })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[12.5px] font-semibold transition-colors"
            >
              <Trash2 size={13} /> Delete Selected
            </button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="py-12 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
          <Clock size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-[14.5px] font-semibold">No work log entries found</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 dark:border-slate-850 rounded-xl">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40">
                {isAdmin && (
                  <th className="py-3 px-4 w-8">
                    <input
                      type="checkbox"
                      checked={selectedIds.size > 0 && selectedIds.size === filtered.length}
                      onChange={toggleSelectAll}
                      className="rounded border-slate-300 dark:border-slate-600"
                      aria-label="Select all work log entries"
                    />
                  </th>
                )}
                {[...['Member','Date','Time Worked','Lunch Used','Tea Used','Custom Break','Status'], ...(isAdmin ? ['Actions'] : [])].map((h) => (
                  <th key={h} className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 py-3 px-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => {
                const isActive   = sameId(row.user, authUser) && row.isToday;
                const target     = row.targetSeconds || (8 * 3600);
                const pct        = Math.min(100, (row.workSeconds / target) * 100);
                const lunchSecs  = breakTotal(row.breaks, 'lunch');
                const teaSecs    = breakTotal(row.breaks, 'tea');
                const customSecs = breakTotal(row.breaks, 'custom');

                return (
                  <tr key={i} className="border-b border-slate-200 dark:border-slate-800/60 last:border-b-0 hover:bg-slate-50/40 dark:hover:bg-slate-900/10">
                    {isAdmin && (
                      <td className="py-3 px-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(row.id)}
                          onChange={() => toggleSelectRow(row.id)}
                          className="rounded border-slate-300 dark:border-slate-600"
                          aria-label={`Select ${row.user.name}'s log for ${fmtDate(row.date)}`}
                        />
                      </td>
                    )}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full text-white font-bold flex items-center justify-center text-[12px]" style={{ background: row.user.color || '#6366f1' }}>
                          {row.user.name?.[0]}
                        </div>
                        <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">{row.user.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-[13px] text-slate-650 dark:text-slate-400">{fmtDate(row.date)}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-12 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 100 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444' }} />
                        </div>
                        <span className="font-mono text-[13px] font-bold text-slate-800 dark:text-slate-200">{fmtTimer(row.workSeconds)}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-[13px] font-mono text-slate-550 dark:text-slate-450">{fmtTimer(lunchSecs)}</td>
                    <td className="py-3 px-4 text-[13px] font-mono text-slate-550 dark:text-slate-450">{fmtTimer(teaSecs)}</td>
                    <td className="py-3 px-4 text-[13px] font-mono text-slate-550 dark:text-slate-450">{fmtTimer(customSecs)}</td>
                    <td className="py-3 px-4">
                      <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold', isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-450')}>
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openEdit(row)}
                            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                            title="Edit this log entry"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => setConfirmDelete({ ids: [row.id], label: `${row.user.name}'s log for ${fmtDate(row.date)}` })}
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            title="Delete this log entry"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title={confirmDelete?.ids.length > 1 ? 'Delete work log entries?' : 'Delete work log entry?'}
        message={`Permanently delete ${confirmDelete?.label || ''}? This cannot be undone.`}
        confirmLabel={deleting ? 'Deleting…' : (confirmDelete?.ids.length > 1 ? 'Delete Entries' : 'Delete Entry')}
        onConfirm={handleDeleteConfirmed}
        onClose={() => setConfirmDelete(null)}
      />

      <Modal
        open={!!editRow}
        onClose={() => setEditRow(null)}
        title="Edit Work Log"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditRow(null)}>Cancel</Button>
            <Button variant="primary" onClick={handleEditSave} disabled={savingEdit}>
              {savingEdit ? 'Saving…' : 'Save Changes'}
            </Button>
          </>
        }
      >
        {editRow && (
          <div className="p-6 space-y-4">
            <p className="text-[13px] text-slate-500 dark:text-slate-400">{editRow.label}</p>
            <div>
              <label className="block text-[12.5px] font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Time Worked</label>
              <div className="flex items-center gap-2">
                <input
                  type="number" min="0"
                  value={editRow.hours}
                  onChange={(e) => setEditRow((r) => ({ ...r, hours: e.target.value }))}
                  className="form-input w-20 text-center"
                />
                <span className="text-[13px] text-slate-500">hrs</span>
                <input
                  type="number" min="0" max="59"
                  value={editRow.minutes}
                  onChange={(e) => setEditRow((r) => ({ ...r, minutes: e.target.value }))}
                  className="form-input w-20 text-center"
                />
                <span className="text-[13px] text-slate-500">min</span>
              </div>
            </div>
            <div>
              <label className="block text-[12.5px] font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Daily Target (hours)</label>
              <input
                type="number" min="1"
                value={editRow.targetHours}
                onChange={(e) => setEditRow((r) => ({ ...r, targetHours: e.target.value }))}
                className="form-input w-24 text-center"
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function AddServiceModal({ onClose, onSave }) {
  const [name, setName]       = useState('');
  const [desc, setDesc]       = useState('');
  const [category, setCategory] = useState('');
  const [color, setColor]     = useState('#6366f1');
  const [icon, setIcon]       = useState('⚡');
  const [saving, setSaving]   = useState(false);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Service name is required'); return; }
    setSaving(true);
    try {
      await onSave({ name: name.trim(), description: desc.trim(), category: category.trim() || 'General', color, icon });
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create service');
    } finally {
      setSaving(false);
    }
  };

  const SERVICE_ICON_MAP = {
    '⚡': Zap, '🎨': Palette, '📱': Smartphone, '🌐': Globe, '📊': BarChart3, 
    '✍️': PenTool, '🎬': Clapperboard, '📸': Camera, '🔧': Wrench, '💡': Lightbulb, 
    '🛡️': Shield, '🚀': Rocket
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-[16px] font-bold text-slate-900 dark:text-white">Add New Service</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400">
            <X size={16} />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-350 mb-1">Name *</label>
            <input className="form-input text-[13.5px] py-1.5" placeholder="e.g. Social Media Management" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-350 mb-1">Description</label>
            <textarea className="form-input text-[13.5px] py-1.5 resize-none" rows={2} placeholder="Brief description..." value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-350 mb-1">Category</label>
            <input className="form-input text-[13.5px] py-1.5" placeholder="e.g. Marketing, Design" value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-350 mb-1">Icon Preset</label>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_ICONS.map((ic) => (
                <button
                  key={ic} type="button" onClick={() => setIcon(ic)}
                  className={cn('w-8 h-8 rounded-lg flex items-center justify-center transition-all border', icon === ic ? 'bg-indigo-50 border-indigo-400 text-indigo-650' : 'bg-slate-50 dark:bg-slate-900/40 border-transparent hover:border-slate-200')}
                >
                  {ic}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-350 mb-1">Theme Accent Color</label>
            <div className="flex flex-wrap gap-1.5">
              {COLOR_SWATCHES.map((c) => (
                <button
                  key={c} type="button" onClick={() => setColor(c)}
                  className={cn('w-6 h-6 rounded-full border transition-all', color === c ? 'border-slate-800 scale-110' : 'border-transparent')}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Add Service'}</Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Workspace Lists Section
// ─────────────────────────────────────────────────────────────
function TagList({ items, onAdd, onRemove, placeholder, isAdmin }) {
  const [input, setInput] = useState('');

  const handleAdd = () => {
    const val = input.trim();
    if (!val || items.includes(val)) { setInput(''); return; }
    onAdd(val);
    setInput('');
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3 min-h-[36px]">
        {items.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] font-medium bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/40"
          >
            {item}
            {isAdmin && (
              <button
                onClick={() => onRemove(item)}
                className="text-indigo-400 hover:text-red-500 transition-colors ml-0.5"
              >
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        {items.length === 0 && (
          <span className="text-[12.5px] text-slate-400 italic">No items added yet</span>
        )}
      </div>
      {isAdmin && (
        <div className="flex gap-2">
          <input
            className="form-input text-[13.5px] py-2 flex-1"
            placeholder={placeholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <button
            onClick={handleAdd}
            disabled={!input.trim()}
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-[13px] font-semibold hover:bg-indigo-700 disabled:opacity-40 transition-all flex items-center gap-1.5"
          >
            <Plus size={13} /> Add
          </button>
        </div>
      )}
    </div>
  );
}

function WorkspaceSection({ settings, onSave }) {
  const authUser = useAppStore((s) => s.authUser);
  const isAdmin  = authUser?.role === 'admin';
  const [saving, setSaving] = useState(null); // which field is saving

  const departments = settings?.departments || [];
  const positions   = settings?.positions   || [];
  const industries  = settings?.industries  || [];

  const handleAdd = async (field, value) => {
    setSaving(field);
    try {
      await onSave({ [field]: [...(settings?.[field] || []), value] });
    } finally { setSaving(null); }
  };

  const handleRemove = async (field, value) => {
    setSaving(field);
    try {
      await onSave({ [field]: (settings?.[field] || []).filter((v) => v !== value) });
    } finally { setSaving(null); }
  };

  const lists = [
    {
      key:         'departments',
      label:       'Departments',
      desc:        'Used when assigning team members to departments.',
      items:       departments,
      placeholder: 'e.g. Design',
    },
    {
      key:         'positions',
      label:       'Job Positions',
      desc:        'Available job titles when creating or editing team members.',
      items:       positions,
      placeholder: 'e.g. Motion Designer',
    },
    {
      key:         'industries',
      label:       'Industries',
      desc:        'Industry options available when adding clients.',
      items:       industries,
      placeholder: 'e.g. E-commerce',
    },
  ];

  return (
    <div>
      <div className="pb-4 border-b border-slate-200 dark:border-slate-700 mb-6">
        <h2 className="text-[18px] font-bold text-slate-900 dark:text-white">Workspace Lists</h2>
        <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
          Manage the dropdown options used across the CRM — departments, job positions, and industries.
        </p>
      </div>

      <div className="space-y-8">
        {lists.map(({ key, label, desc, items, placeholder }) => (
          <div key={key}>
            <div className="flex items-center justify-between mb-1.5">
              <div>
                <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">{label}</h3>
                <p className="text-[12px] text-slate-500 dark:text-slate-400">{desc}</p>
              </div>
              {saving === key && (
                <RefreshCw size={13} className="animate-spin text-indigo-400" />
              )}
            </div>
            <TagList
              items={items}
              onAdd={(v) => handleAdd(key, v)}
              onRemove={(v) => handleRemove(key, v)}
              placeholder={placeholder}
              isAdmin={isAdmin}
            />
          </div>
        ))}
      </div>

      {!isAdmin && (
        <div className="mt-6 flex items-start gap-2 px-3.5 py-3 bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800 rounded-xl text-[12.5px] text-amber-700 dark:text-amber-300">
          <Info size={14} className="flex-shrink-0 mt-0.5" />
          <span>You can view these lists. Only admins can add or remove items.</span>
        </div>
      )}
    </div>
  );
}

function ServicesSection() {
  const { services, addService, deleteService, authUser } = useAppStore(
    useShallow((s) => ({ services: s.services, addService: s.addService, deleteService: s.deleteService, authUser: s.authUser }))
  );
  const isAdmin = authUser?.role === 'admin';
  const [showModal, setShowModal] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      await deleteService(id);
      toast.success('Service removed');
    } catch {
      toast.error('Failed to delete service');
    } finally {
      setDeletingId(null);
    }
  };

  const grouped = services.reduce((acc, sv) => {
    const cat = sv.category || 'General';
    (acc[cat] = acc[cat] || []).push(sv);
    return acc;
  }, {});

  return (
    <div>
      <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-700/60 mb-5">
        <div>
          <h4 className="text-[15px] font-bold text-slate-800 dark:text-slate-200">Corporate Service Catalog</h4>
        </div>
        {isAdmin && (
          <Button variant="primary" size="sm" onClick={() => setShowModal(true)}>
            <Plus size={13} /> Add Service
          </Button>
        )}
      </div>

      {services.length === 0 ? (
        <div className="py-12 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
          <Layers size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-[14px] font-semibold">No services configured yet</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">{cat}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {items.map((sv) => (
                  <div key={sv._id} className="relative p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-[18px]" style={{ background: sv.color + '15', color: sv.color }}>
                        {sv.icon || '⚡'}
                      </div>
                      <div>
                        <p className="text-[13.5px] font-bold text-slate-800 dark:text-slate-200">{sv.name}</p>
                        {sv.description && <p className="text-[12px] text-slate-550 dark:text-slate-400 mt-0.5">{sv.description}</p>}
                      </div>
                    </div>
                    {isAdmin && (
                      <button onClick={() => handleDelete(sv._id)} disabled={deletingId === sv._id} className="text-slate-400 hover:text-red-500 p-1">
                        {deletingId === sv._id ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <AddServiceModal onClose={() => setShowModal(false)} onSave={async (body) => { await addService(body); toast.success('Service added!'); }} />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// ── Lead Importer Subcomponent (Spreadsheet Data Clean Flow)
// ───────────────────────────────────────────────────────────────────
function LeadImporterSection() {
  const navigate = useNavigate();
  const bulkCreateLeads = useAppStore((s) => s.bulkCreateLeads);

  const [step, setStep] = useState(1); // 1: Ingest/Upload, 2: Mapping, 3: Spreadsheet/Editing
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvLines, setCsvLines] = useState([]);
  
  // Mapping state: key is target B2B field, value is index of matched CSV column
  const [mapping, setMapping] = useState({
    companyName: '',
    contactPerson: '',
    dealValue: '',
    email: '',
    phone: '',
    website: ''
  });

  // Table editor data
  const [importRows, setImportRows] = useState([]);

  // File states
  const [fileName, setFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);

  // Download simple B2B CSV template
  const handleDownloadTemplate = () => {
    const templateRows = [
      ['Company Name', 'Contact Person', 'Deal Value', 'Email', 'Phone', 'Website'],
      ['Acme Corp', 'Alice Smith', '5000', 'alice@acme.com', '123-456-7890', 'acme.com'],
      ['Apex Solutions', 'Bob Johnson', '₹12,000', 'bob@apex.co', '9876543210', 'apex.co'],
      ['Global Partners Ltd', '', 'invalid-value', 'invalid-email', '555', ''], // row with errors / warnings
    ];
    downloadCSV(templateRows, 'lead_import_template.csv');
    toast.success('B2B Template CSV downloaded successfully!');
  };

  // Parse CSV file content
  const processCSVFile = (file) => {
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean);
        if (rawLines.length <= 1) {
          toast.error('The selected CSV file has no records');
          return;
        }

        // Parse headers from the first line
        const parsedHeaders = rawLines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
        setCsvHeaders(parsedHeaders);

        // Store CSV rows parsed by split commas
        const linesData = [];
        for (let i = 1; i < rawLines.length; i++) {
          const rowData = rawLines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
          linesData.push(rowData);
        }
        setCsvLines(linesData);

        // Pre-fill mapping automatically by scanning header names
        const initialMapping = {
          companyName: '',
          contactPerson: '',
          dealValue: '',
          email: '',
          phone: '',
          website: ''
        };

        parsedHeaders.forEach((h, idx) => {
          const l = h.toLowerCase();
          if (l.includes('company') || l.includes('title') || l.includes('org') || l.includes('firm')) {
            initialMapping.companyName = idx;
          } else if (l.includes('contact') || l.includes('person') || l.includes('name')) {
            initialMapping.contactPerson = idx;
          } else if (l.includes('value') || l.includes('deal') || l.includes('size') || l.includes('budget') || l.includes('worth')) {
            initialMapping.dealValue = idx;
          } else if (l.includes('email') || l.includes('mail')) {
            initialMapping.email = idx;
          } else if (l.includes('phone') || l.includes('mobile') || l.includes('cell') || l.includes('contact no')) {
            initialMapping.phone = idx;
          } else if (l.includes('website') || l.includes('site') || l.includes('link') || l.includes('web')) {
            initialMapping.website = idx;
          }
        });

        setMapping(initialMapping);
        setStep(2); // Go to step 2 (Mapping)
        toast.success('CSV uploaded successfully! Please verify column mappings.');
      } catch (err) {
        console.error(err);
        toast.error('Failed to parse CSV file. Ensure it is comma-separated.');
      }
    };
    reader.readAsText(file);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    processCSVFile(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    processCSVFile(file);
  };

  // Convert raw CSV lines to Lead objects based on mappings
  const handleConfirmMapping = () => {
    if (mapping.companyName === '') {
      toast.error('You must map the Company Name field (Required)');
      return;
    }

    const rows = csvLines.map((cols) => {
      const companyName = cols[mapping.companyName] || '';
      const contactPerson = mapping.contactPerson !== '' ? cols[mapping.contactPerson] || '' : '';
      const dealValue = mapping.dealValue !== '' ? cols[mapping.dealValue] || '' : '';
      const email = mapping.email !== '' ? cols[mapping.email] || '' : '';
      const phone = mapping.phone !== '' ? cols[mapping.phone] || '' : '';
      const website = mapping.website !== '' ? cols[mapping.website] || '' : '';

      return {
        companyName,
        contactPerson,
        dealValue,
        email,
        phone,
        website
      };
    });

    setImportRows(rows);
    setStep(3); // Go to step 3 (Spreadsheet validation)
    toast.success('Leads structured! Please review and fix any validation warnings.');
  };

  // Inline row validation
  const validateRow = (row) => {
    const errors = [];
    const warnings = [];

    if (!row.companyName || !row.companyName.trim()) {
      errors.push('Company name is required');
    }

    if (!row.contactPerson || !row.contactPerson.trim() || row.contactPerson.trim() === 'Undecided') {
      warnings.push('Contact person is blank (will default to "Undecided")');
    }

    const cleanedVal = String(row.dealValue).replace(/[^0-9.]/g, '');
    const numVal = Number(cleanedVal);
    if (isNaN(numVal) || numVal < 0 || String(row.dealValue).trim() === '') {
      warnings.push('Deal value is invalid or negative (will default to 0)');
    } else if (cleanedVal !== String(row.dealValue).trim()) {
      warnings.push('Value contains non-numeric formatting (will be cleaned)');
    }

    if (row.email && row.email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(row.email.trim())) {
        warnings.push('Email address format is invalid');
      }
    }

    if (row.phone && row.phone.trim()) {
      const digits = row.phone.replace(/[^0-9]/g, '');
      if (digits.length < 6) {
        warnings.push('Phone number is too short');
      }
    }

    let status = 'clean';
    if (errors.length > 0) status = 'error';
    else if (warnings.length > 0) status = 'warning';

    return { status, errors, warnings };
  };

  // Live evaluated data rows with validations added on top
  const evaluatedRows = useMemo(() => {
    return importRows.map(row => ({
      data: row,
      val: validateRow(row)
    }));
  }, [importRows]);

  const stats = useMemo(() => {
    let clean = 0;
    let warning = 0;
    let error = 0;

    evaluatedRows.forEach(r => {
      if (r.val.status === 'clean') clean++;
      else if (r.val.status === 'warning') warning++;
      else if (r.val.status === 'error') error++;
    });

    return { clean, warning, error, total: evaluatedRows.length };
  }, [evaluatedRows]);

  // Edit in-place
  const handleCellChange = (rowIndex, field, value) => {
    const updated = [...importRows];
    updated[rowIndex] = { ...updated[rowIndex], [field]: value };
    setImportRows(updated);
  };

  // Delete row from import
  const handleDeleteRow = (rowIndex) => {
    setImportRows(importRows.filter((_, i) => i !== rowIndex));
  };

  // Auto-resolve warnings in bulk
  const handleAutoResolve = () => {
    const resolved = importRows.map(row => {
      const updated = { ...row };

      // 1. Contact Person fallback
      if (!updated.contactPerson || !updated.contactPerson.trim()) {
        updated.contactPerson = 'Undecided';
      }

      // 2. Deal Value numeric extraction
      const cleanVal = String(updated.dealValue).replace(/[^0-9.]/g, '');
      const parsedVal = Number(cleanVal);
      updated.dealValue = isNaN(parsedVal) || cleanVal === '' ? 0 : parsedVal;

      // 3. Email & Phone trim
      if (updated.email) updated.email = updated.email.trim();
      if (updated.phone) updated.phone = updated.phone.trim();

      return updated;
    });

    setImportRows(resolved);
    toast.success('Auto-resolved and sanitized warnings in-bulk!');
  };

  // Submit complete ingestion to database
  const handleCompleteImport = async () => {
    if (stats.error > 0) {
      toast.error('Please fix all Company Name errors before completing the ingestion.');
      return;
    }

    // Sanitize values for the final payload
    const finalLeads = importRows.map(row => {
      const cleanVal = String(row.dealValue).replace(/[^0-9.]/g, '');
      const parsedVal = Number(cleanVal);

      return {
        companyName: row.companyName.trim(),
        contactPerson: row.contactPerson.trim() || 'Undecided',
        dealValue: isNaN(parsedVal) || cleanVal === '' ? 0 : parsedVal,
        email: row.email ? row.email.trim() : '',
        phone: row.phone ? row.phone.trim() : '',
        website: row.website ? row.website.trim() : '',
        status: 'New Lead',
        source: 'Import'
      };
    });

    try {
      await bulkCreateLeads(finalLeads);
      navigate('/leads');
    } catch {}
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Tab Title */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-700/60">
        <h3 className="text-[16px] font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Database size={18} className="text-indigo-500" /> B2B Leads Ingestion Importer
        </h3>
        <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="flex items-center gap-1 text-[12px] text-indigo-600 border-indigo-200 dark:text-indigo-400 dark:border-indigo-950">
          <Download size={13} />
          <span>Download Template CSV</span>
        </Button>
      </div>

      {/* Progress timeline */}
      <div className="flex items-center justify-center gap-2 text-[12.5px] font-bold py-2 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-slate-200 dark:border-slate-800">
        <span className={cn("px-3 py-1 rounded-full transition-all", step >= 1 ? "bg-indigo-500 text-white" : "text-slate-450")}>1. Ingest File</span>
        <span className="text-slate-400">➔</span>
        <span className={cn("px-3 py-1 rounded-full transition-all", step >= 2 ? "bg-indigo-500 text-white" : "text-slate-450")}>2. Column Mapping</span>
        <span className="text-slate-400">➔</span>
        <span className={cn("px-3 py-1 rounded-full transition-all", step >= 3 ? "bg-indigo-500 text-white" : "text-slate-450")}>3. Interactive Clean-up</span>
      </div>

      {/* STEP 1: Upload Dropzone */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="bg-slate-50 dark:bg-slate-900/30 p-4 rounded-xl border border-slate-200 dark:border-slate-800 text-[13px] text-slate-550 flex gap-2.5">
            <Info size={16} className="text-indigo-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-slate-700 dark:text-slate-350 mb-0.5">Prepare clean B2B sheets for error-free importing</p>
              <p>Drag in your CSV file. Standard comma layouts work immediately. We automatically map columns for company, contact representatives, and deal value sizes, let you edit records inline, and resolve warnings before committing to the catalog.</p>
            </div>
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={cn(
              "border-2 border-dashed rounded-3xl p-12 text-center relative cursor-pointer transition-all min-h-[220px] flex flex-col justify-center items-center",
              dragOver 
                ? "border-indigo-500 bg-indigo-500/[0.04]" 
                : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/10"
            )}
          >
            <input
              type="file" accept=".csv"
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              onChange={handleFileChange}
            />
            <Database size={40} className="text-indigo-500 mb-3.5 opacity-80" />
            <p className="text-[13.5px] font-bold text-slate-800 dark:text-slate-200">
              Drag your sales CSV sheet here or <span className="text-indigo-650 dark:text-indigo-400 underline">browse computer</span>
            </p>
            <p className="text-[11.5px] text-slate-400 mt-1">Supports standard comma-separated sheets up to 500 records</p>
          </div>
        </div>
      )}

      {/* STEP 2: Mapping Header columns */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="p-4 rounded-xl bg-indigo-500/[0.02] border border-indigo-500/10 text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-400 space-y-1">
            <p className="font-bold text-indigo-650 dark:text-indigo-400 flex items-center gap-1.5">
              <ArrowUpRight size={15} /> Header Column Alignment:
            </p>
            <p>Align the column headers from your file <strong className="text-slate-700 dark:text-slate-300">({fileName})</strong> to the CRM B2B Lead fields. We pre-mapped fields that matched closely.</p>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden text-[13px]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 font-bold text-slate-400 uppercase tracking-widest text-[10.5px]">
                  <th className="px-5 py-3">Lead Database Target Field</th>
                  <th className="px-5 py-3">CSV Header Match Selection</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-105 dark:divide-slate-800 font-semibold text-slate-800 dark:text-slate-200">
                {[
                  { key: 'companyName', label: 'Company Name (Required)', required: true },
                  { key: 'contactPerson', label: 'Contact Person', required: false },
                  { key: 'dealValue', label: 'Deal Value (Budget)', required: false },
                  { key: 'email', label: 'Email Address', required: false },
                  { key: 'phone', label: 'Phone Number', required: false },
                  { key: 'website', label: 'Website Link', required: false }
                ].map((f) => (
                  <tr key={f.key}>
                    <td className="px-5 py-4">{f.label}</td>
                    <td className="px-5 py-4">
                      <select
                        className="form-input text-[13px] py-1.5 w-64 font-sans font-medium"
                        value={mapping[f.key]}
                        onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value === '' ? '' : Number(e.target.value) })}
                      >
                        <option value="">-- Do Not Import --</option>
                        {csvHeaders.map((h, i) => (
                          <option key={i} value={i}>Column #{i + 1}: "{h}"</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-3 text-[13px]">
            <Button variant="outline" onClick={() => setStep(1)}>Go Back</Button>
            <Button variant="primary" onClick={handleConfirmMapping} disabled={mapping.companyName === ''}>
              Align Columns & Structure Data
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3: Spreadsheet interactive review and validator */}
      {step === 3 && (
        <div className="space-y-5 animate-fadeIn">
          {/* Summary dashboard */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/30 border border-slate-250 dark:border-slate-800 text-[12px] font-semibold text-slate-450">
              <span>Total rows parsed</span>
              <p className="text-[20px] font-bold text-slate-800 dark:text-white mt-1">{stats.total}</p>
            </div>
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[12px] font-semibold text-emerald-600 dark:text-emerald-450">
              <span>Clean rows (🟢 Ready)</span>
              <p className="text-[20px] font-bold mt-1">{stats.clean}</p>
            </div>
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[12px] font-semibold text-amber-600 dark:text-amber-450">
              <span>Warnings (🟡 Flagged)</span>
              <p className="text-[20px] font-bold mt-1">{stats.warning}</p>
            </div>
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-[12px] font-semibold text-red-500">
              <span>Errors (🔴 Critical)</span>
              <p className="text-[20px] font-bold mt-1">{stats.error}</p>
            </div>
          </div>

          {/* Interactive controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[12.5px] p-4 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-slate-200 dark:border-slate-800">
            <div>
              <p className="font-bold text-slate-800 dark:text-slate-200">Interactive Spreadsheet Editor</p>
              <p className="text-[11.5px] text-slate-400">Click on any cell to edit details inline. Clear all errors before completing.</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleAutoResolve} className="text-amber-605 border-amber-200 hover:bg-amber-50 dark:border-amber-950 dark:hover:bg-amber-950/20">
                ⚡ Auto-Resolve Warnings
              </Button>
              <Button size="sm" variant="outline" onClick={() => setStep(2)}>
                Change Mapping
              </Button>
            </div>
          </div>

          {/* Interactive Spreadsheet Grid */}
          <div className="border border-slate-200 dark:border-slate-850 rounded-2xl overflow-hidden bg-white dark:bg-slate-900 shadow-md">
            <div className="overflow-x-auto max-h-[440px]">
              <table className="w-full text-left border-collapse text-[12.5px] font-sans">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-855 border-b border-slate-200 dark:border-slate-800 font-bold text-slate-400 uppercase tracking-widest text-[10px]">
                    <th className="px-4 py-3 text-center w-16">Status</th>
                    <th className="px-4 py-3 min-w-[90px]">Lead ID</th>
                    <th className="px-4 py-3 min-w-[140px]">Company Name *</th>
                    <th className="px-4 py-3 min-w-[120px]">Contact Person</th>
                    <th className="px-4 py-3 min-w-[100px]">Deal Value (₹)</th>
                    <th className="px-4 py-3 min-w-[150px]">Email</th>
                    <th className="px-4 py-3 min-w-[110px]">Phone</th>
                    <th className="px-4 py-3 min-w-[120px]">Website</th>
                    <th className="px-4 py-3 text-center w-12">Delete</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-150 dark:divide-slate-850">
                  {evaluatedRows.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="px-4 py-8 text-center text-slate-450 italic">
                        No records loaded in import grid list.
                      </td>
                    </tr>
                  ) : (
                    evaluatedRows.map((row, idx) => {
                      const isErr = row.val.status === 'error';
                      const isWarn = row.val.status === 'warning';
                      const hasAlert = isErr || isWarn;

                      return (
                        <tr key={idx} className={cn(
                          "transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/10",
                          isErr ? "bg-red-500/[0.02]" : isWarn ? "bg-amber-500/[0.01]" : ""
                        )}>
                          <td className="px-4 py-2.5 text-center">
                            <span 
                              className={cn(
                                "text-[10px] font-bold px-1.5 py-0.5 rounded-full cursor-help",
                                isErr 
                                  ? "bg-red-500/15 text-red-500" 
                                  : isWarn 
                                    ? "bg-amber-500/15 text-amber-500" 
                                    : "bg-emerald-500/15 text-emerald-500"
                              )}
                              title={hasAlert ? [...row.val.errors, ...row.val.warnings].join(' | ') : 'Ready to import!'}
                            >
                              {isErr ? '🔴 Err' : isWarn ? '🟡 Warn' : '🟢 Ready'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[11.5px] font-bold text-slate-450 dark:text-slate-500 italic select-none">
                            <span>[Auto]</span>
                          </td>
                          <td className="px-2 py-1">
                            <input
                              className={cn(
                                "bg-transparent border border-transparent focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800 rounded px-2 py-1 w-full outline-none transition-all",
                                isErr && !row.data.companyName?.trim() ? "border-red-500/40 bg-red-500/[0.01]" : ""
                              )}
                              value={row.data.companyName}
                              onChange={(e) => handleCellChange(idx, 'companyName', e.target.value)}
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input
                              className="bg-transparent border border-transparent focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800 rounded px-2 py-1 w-full outline-none transition-all"
                              value={row.data.contactPerson}
                              onChange={(e) => handleCellChange(idx, 'contactPerson', e.target.value)}
                              placeholder="e.g. John Doe"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input
                              className={cn(
                                "bg-transparent border border-transparent focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-855 hover:bg-slate-50 dark:hover:bg-slate-800 rounded px-2 py-1 w-full outline-none transition-all text-right font-mono",
                                isWarn && isNaN(Number(String(row.data.dealValue).replace(/[^0-9.]/g, ''))) ? "border-amber-500/30" : ""
                              )}
                              value={row.data.dealValue}
                              onChange={(e) => handleCellChange(idx, 'dealValue', e.target.value)}
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input
                              className="bg-transparent border border-transparent focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800 rounded px-2 py-1 w-full outline-none transition-all font-mono"
                              value={row.data.email}
                              onChange={(e) => handleCellChange(idx, 'email', e.target.value)}
                              placeholder="client@company.com"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input
                              className="bg-transparent border border-transparent focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800 rounded px-2 py-1 w-full outline-none transition-all font-mono"
                              value={row.data.phone}
                              onChange={(e) => handleCellChange(idx, 'phone', e.target.value)}
                              placeholder="12345"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input
                              className="bg-transparent border border-transparent focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800 rounded px-2 py-1 w-full outline-none transition-all"
                              value={row.data.website}
                              onChange={(e) => handleCellChange(idx, 'website', e.target.value)}
                              placeholder="company.com"
                            />
                          </td>
                          <td className="px-4 py-2 text-center">
                            <button
                              onClick={() => handleDeleteRow(idx)}
                              className="text-slate-400 hover:text-red-500 transition-colors p-1"
                              title="Delete row from imports"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-between items-center text-[12.5px] mt-2">
            <span className="text-slate-450 italic">
              * Company Name is required. Hover over warnings / error tags to inspect alerts.
            </span>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(2)}>Go Back</Button>
              <Button 
                variant="primary" 
                onClick={handleCompleteImport} 
                disabled={stats.error > 0 || stats.total === 0}
                className={cn(stats.error > 0 ? "opacity-50 cursor-not-allowed" : "")}
              >
                ✓ Complete Ingestion ({stats.clean + stats.warning} Clean Leads)
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}