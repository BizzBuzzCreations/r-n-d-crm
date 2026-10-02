import { useState, useMemo } from 'react';
import { AlertCircle, Layers, Plus } from 'lucide-react';

import { AvatarContent } from '../components/ui';
const STAGES = ['New Lead', 'First Contact', 'Proposal Sent', 'Won', 'Lost'];

const STAGE_COLORS = {
  'New Lead': '#3b82f6',
  'First Contact': '#f59e0b',
  'Proposal Sent': '#8b5cf6',
  'Won': '#10b981',
  'Lost': '#ef4444',
};

// ── Kanban Card ───────────────────────────────────────────────
function KanbanCard({ lead, onClick, onReassign, users, currentDraggedId, setCurrentDraggedId }) {
  const isHighValue = lead.dealValue >= 5000;
  const isStuck = useMemo(() => {
    if (lead.status !== 'First Contact') return false;
    const diffDays = Math.ceil(Math.abs(Date.now() - new Date(lead.createdAt).getTime()) / 86400000);
    return diffDays > 5;
  }, [lead.status, lead.createdAt]);

  const [assignOpen, setAssignOpen] = useState(false);
  const assignee = lead.assignedTo;
  const hasActivity = lead.notes && lead.notes.length > 0;

  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', lead._id); setCurrentDraggedId(lead._id); }}
      onDragEnd={() => setCurrentDraggedId(null)}
      onClick={() => onClick(lead)}
      className={[
        'group relative p-4 rounded-xl border bg-white dark:bg-slate-900 shadow-sm hover:shadow-md transition-all duration-200 cursor-grab active:cursor-grabbing select-none',
        currentDraggedId === lead._id ? 'opacity-40 scale-95' : '',
        isHighValue
          ? 'border-emerald-500/40 dark:border-emerald-500/30 ring-1 ring-emerald-500/10 bg-gradient-to-br from-emerald-500/[0.02] to-transparent'
          : 'border-slate-200 dark:border-slate-800',
      ].join(' ')}
    >
      {/* High-value pulse dot */}
      {isHighValue && (
        <span className="absolute top-3 right-3 flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
      )}

      {/* Title row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="text-[13.5px] font-bold text-slate-850 dark:text-slate-100 group-hover:text-indigo-650 dark:group-hover:text-indigo-400 transition-colors leading-tight flex items-center flex-wrap gap-1.5">
          <span className="text-[10px] font-mono font-bold text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-1.5 py-0.5 rounded border border-indigo-100 dark:border-indigo-900/30">
            {lead.leadId || (lead._id ? `LD-${lead._id.slice(-4).toUpperCase()}` : 'LD-TBD')}
          </span>
          <span>{lead.companyName}</span>
        </h4>
      </div>

      <p className="text-[12px] text-slate-500 dark:text-slate-450 font-medium">
        Contact: {lead.contactPerson}
      </p>

      {/* Stuck indicator */}
      {isStuck && (
        <div className="mt-2 py-1 px-2 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 bg-amber-500/10 text-amber-500 border border-amber-500/20">
          <AlertCircle size={11} /> ⚠️ stuck 5d+
        </div>
      )}

      {/* Status badges */}
      <div className="flex items-center gap-1.5 flex-wrap mt-2">
        {hasActivity ? (
          <span className="py-0.5 px-2 rounded-md text-[10.5px] font-bold inline-flex items-center gap-1 bg-emerald-500/10 text-emerald-600 border border-emerald-500/15">
            ✓ Active logs
          </span>
        ) : (
          <span className="py-0.5 px-2 rounded-md text-[10.5px] font-bold inline-flex items-center gap-1 bg-amber-500/10 text-amber-600 border border-amber-500/15">
            <AlertCircle size={10.5} /> No activity
          </span>
        )}
        <span className="py-0.5 px-2 rounded-md text-[10.5px] font-bold inline-flex items-center gap-1 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/15">
          <Layers size={10.5} /> {lead.source || 'Manual'}
        </span>
      </div>

      {/* Footer row */}
      <div className="mt-4 pt-3.5 border-t border-slate-100 dark:border-slate-850 flex items-center justify-between">
        <div>
          <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Deal Value</span>
          <p className="text-[13.5px] font-bold text-slate-800 dark:text-slate-100">
            ₹{(lead.dealValue || 0).toLocaleString()}
          </p>
        </div>

        {/* Assignee avatar / picker */}
        <div className="relative">
          <div
            onClick={(e) => { e.stopPropagation(); setAssignOpen(o => !o); }}
            className="cursor-pointer transition-transform hover:scale-105"
            title={assignee ? `Assigned: ${assignee.name}` : 'Unassigned — click to assign'}
          >
            {assignee ? (
              <div className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px] text-white overflow-hidden"
                style={{ background: assignee.avatar ? 'transparent' : (assignee.color || '#6366f1') }}>
                <AvatarContent user={assignee} fallback={assignee.initials || assignee.name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)} />
              </div>
            ) : (
              <div className="w-7 h-7 rounded-full bg-slate-150 dark:bg-slate-800 flex items-center justify-center text-slate-450 hover:bg-indigo-50 hover:text-indigo-500 border border-dashed border-slate-350 dark:border-slate-700">
                <Plus size={12} />
              </div>
            )}
          </div>

          {assignOpen && (
            <div className="absolute right-0 bottom-8 z-[200] w-48 py-1 rounded-xl shadow-xl bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-750 text-[12.5px]">
              <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Delegate Rep</p>
              <button
                onClick={(e) => { e.stopPropagation(); onReassign(lead._id, null); setAssignOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 text-red-500"
              >
                Remove assignee
              </button>
              {users.map(u => (
                <button key={u._id}
                  onClick={(e) => { e.stopPropagation(); onReassign(lead._id, u._id); setAssignOpen(false); }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
                >
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: u.color }} />
                  <span className="truncate">{u.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Health score */}
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[10px] text-slate-450 font-semibold">Health Index</span>
        <span className={[
          'text-[10px] font-bold px-2 py-0.5 rounded-full',
          lead.healthScore >= 80 ? 'bg-emerald-500/10 text-emerald-500'
            : lead.healthScore >= 50 ? 'bg-amber-500/10 text-amber-500'
              : 'bg-red-500/10 text-red-500',
        ].join(' ')}>
          {lead.healthScore >= 80 ? '🔥 Hot' : lead.healthScore >= 50 ? '🟢 Warm' : '⚪ Cold'} ({lead.healthScore})
        </span>
      </div>
    </div>
  );
}

// ── Main Kanban View ──────────────────────────────────────────
export default function LeadsKanbanView({ filteredLeads, users, onSelectLead, onReassign, onDrop }) {
  const [currentDraggedId, setCurrentDraggedId] = useState(null);
  const [dragOverColumn, setDragOverColumn] = useState(null);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-5 items-start">
      {STAGES.map(col => {
        const isOver = dragOverColumn === col;
        const columnLeads = filteredLeads.filter(l => l.status === col);

        return (
          <div
            key={col}
            onDragOver={(e) => { e.preventDefault(); setDragOverColumn(col); }}
            onDragLeave={() => setDragOverColumn(null)}
            onDrop={(e) => { setDragOverColumn(null); onDrop(e, col); }}
            className={[
              'flex flex-col rounded-2xl p-3 border min-h-[500px] transition-colors',
              isOver
                ? 'bg-indigo-500/[0.04] border-dashed border-indigo-500/50'
                : 'bg-slate-50/50 dark:bg-slate-900/10 border-slate-200 dark:border-slate-800',
            ].join(' ')}
          >
            {/* Column header */}
            <div className="flex items-center justify-between pb-3.5 mb-3 border-b border-slate-200 dark:border-slate-800/80 text-[12.5px] font-bold">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: STAGE_COLORS[col] }} />
                <span className="text-slate-800 dark:text-slate-200">{col}</span>
              </div>
              <span className="bg-slate-200 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded-full font-bold">
                {columnLeads.length}
              </span>
            </div>

            {/* Cards */}
            <div className="space-y-3.5 flex-1 overflow-y-auto max-h-[700px] p-0.5">
              {columnLeads.map(lead => (
                <KanbanCard
                  key={lead._id}
                  lead={lead}
                  onClick={onSelectLead}
                  onReassign={onReassign}
                  users={users}
                  currentDraggedId={currentDraggedId}
                  setCurrentDraggedId={setCurrentDraggedId}
                />
              ))}
              {columnLeads.length === 0 && (
                <div className="h-32 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-400 italic text-[12px]">
                  Empty lane
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
